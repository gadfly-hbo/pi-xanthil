-- Business Closure persistence migration (v1, 0004)
-- Implements S3.x Business Closure tables per corrected T0018 structure gate
-- (docs/workcanger-s3-business-closure-structure-ledger.md §20 C1R/C2R/C3-C10).
-- Authoritative S3.1-S3.6 definitions from user-provided artifacts:
--   /Users/huangbo/Desktop/工作流程/analysisops-s1-s3-flow.html
--   /Users/huangbo/Downloads/AI分析工作台三要素.docx
-- This file is immutable after first application. Forward-only; no down migration.

-- ============================================================================
-- closure_cycles (root cycle identity, C4 multiple cycles, C7 no project_status change)
-- ============================================================================
CREATE TABLE closure_cycles (
  closure_cycle_id            TEXT PRIMARY KEY,
  analysis_project_id         TEXT NOT NULL,
  workspace_id                TEXT NOT NULL,
  locked_report_version_id    TEXT NOT NULL,
  closure_ordinal             INTEGER NOT NULL CHECK (closure_ordinal > 0),
  cycle_status                TEXT NOT NULL CHECK (cycle_status IN ('initiated', 'in_progress', 'archived', 'iterating')),
  current_stage               TEXT CHECK (current_stage IS NULL OR current_stage IN ('S3.1', 'S3.2', 'S3.3', 'S3.4', 'S3.5', 'S3.6')),
  initiated_at                TEXT NOT NULL,
  initiated_by_actor_id       TEXT NOT NULL,
  updated_at                  TEXT NOT NULL,
  UNIQUE (analysis_project_id, closure_ordinal),
  FOREIGN KEY (analysis_project_id) REFERENCES analysis_projects (analysis_project_id)
    ON DELETE RESTRICT,
  FOREIGN KEY (locked_report_version_id) REFERENCES report_versions (report_version_id)
    ON DELETE RESTRICT,
  FOREIGN KEY (initiated_by_actor_id) REFERENCES audit_actors (audit_actor_id)
    ON DELETE RESTRICT
);

CREATE INDEX idx_closure_cycles_workspace_project_ordinal
  ON closure_cycles (workspace_id, analysis_project_id, closure_ordinal);

-- ============================================================================
-- s31_conclusion_translations (S3.1 conclusion_translation)
-- Inputs: locked conclusions, downstream system interfaces, business rule templates
-- Outputs: business-action.md, business rule drafts, tag thresholds, segments,
--          gray-release targets, feedback metric definitions
-- Transition: rule drafts confirmed -> S3.2
-- ============================================================================
CREATE TABLE s31_conclusion_translations (
  translation_id              TEXT PRIMARY KEY,
  closure_cycle_id            TEXT NOT NULL,
  business_action_artifact_ref TEXT NOT NULL,
  business_action_content_sha256 TEXT NOT NULL CHECK (length(business_action_content_sha256) = 64),
  selected_recommendations_json TEXT NOT NULL CHECK (json_valid(selected_recommendations_json)),
  business_rules_json         TEXT NOT NULL CHECK (json_valid(business_rules_json)),
  thresholds_json             TEXT NOT NULL CHECK (json_valid(thresholds_json)),
  segments_json               TEXT NOT NULL CHECK (json_valid(segments_json)),
  gray_release_targets_json   TEXT NOT NULL CHECK (json_valid(gray_release_targets_json)),
  feedback_metric_definitions_json TEXT NOT NULL CHECK (json_valid(feedback_metric_definitions_json)),
  translation_status          TEXT NOT NULL CHECK (translation_status IN ('draft', 'confirmed')),
  confirmed_at                TEXT,
  confirmed_by_actor_id       TEXT,
  created_at                  TEXT NOT NULL,
  updated_at                  TEXT NOT NULL,
  UNIQUE (closure_cycle_id),
  FOREIGN KEY (closure_cycle_id) REFERENCES closure_cycles (closure_cycle_id)
    ON DELETE CASCADE,
  FOREIGN KEY (confirmed_by_actor_id) REFERENCES audit_actors (audit_actor_id)
    ON DELETE RESTRICT
);

CREATE INDEX idx_s31_cycle
  ON s31_conclusion_translations (closure_cycle_id);

-- ============================================================================
-- s32_system_deployments (S3.2 system_deployment)
-- Inputs: business rules, CDP tag engine interface, marketing automation interface
-- Outputs: deployment ticket, gray config, go-live confirmation
-- Transition: deployment complete + gray verification passes -> S3.3
-- downstream_system enum from DOCX: CDP tag engine, marketing automation, BI
-- deployment_status from DOCX: 测试->灰度->全量 release flow
-- ============================================================================
CREATE TABLE s32_system_deployments (
  deployment_id               TEXT PRIMARY KEY,
  closure_cycle_id            TEXT NOT NULL,
  downstream_system           TEXT NOT NULL CHECK (downstream_system IN ('cdp_tag_engine', 'marketing_automation', 'bi_reports', 'other')),
  deployment_ticket_ref       TEXT NOT NULL,
  gray_config_json            TEXT NOT NULL CHECK (json_valid(gray_config_json)),
  rollback_path               TEXT NOT NULL,
  deployment_status           TEXT NOT NULL CHECK (deployment_status IN ('pending', 'test_verified', 'gray_verified', 'fully_deployed', 'failed', 'rolled_back')),
  confirmed_at                TEXT,
  confirmed_by_actor_id       TEXT,
  created_at                  TEXT NOT NULL,
  updated_at                  TEXT NOT NULL,
  UNIQUE (closure_cycle_id),
  FOREIGN KEY (closure_cycle_id) REFERENCES closure_cycles (closure_cycle_id)
    ON DELETE CASCADE,
  FOREIGN KEY (confirmed_by_actor_id) REFERENCES audit_actors (audit_actor_id)
    ON DELETE RESTRICT
);

CREATE INDEX idx_s32_cycle
  ON s32_system_deployments (closure_cycle_id);

-- ============================================================================
-- s33_business_executions (S3.3 business_execution)
-- Inputs: deployed tags/rules, marketing plan, operations strategy
-- Outputs: business action record, reached population, execution log
-- Transition: trackable data produced -> S3.4
-- ============================================================================
CREATE TABLE s33_business_executions (
  execution_id                TEXT PRIMARY KEY,
  closure_cycle_id            TEXT NOT NULL,
  business_scope_json         TEXT NOT NULL CHECK (json_valid(business_scope_json)),
  owner_role                  TEXT NOT NULL CHECK (length(owner_role) > 0),
  execution_window_start      TEXT NOT NULL,
  execution_window_end        TEXT NOT NULL,
  action_version              TEXT NOT NULL CHECK (length(action_version) > 0),
  touched_population          INTEGER,
  execution_log_ref           TEXT,
  feedback_source             TEXT NOT NULL CHECK (feedback_source IN ('execution_log', 'conversion_data', 'tag_hit_log', 'combined')),
  created_at                  TEXT NOT NULL,
  updated_at                  TEXT NOT NULL,
  UNIQUE (closure_cycle_id),
  FOREIGN KEY (closure_cycle_id) REFERENCES closure_cycles (closure_cycle_id)
    ON DELETE CASCADE
);

CREATE INDEX idx_s33_cycle
  ON s33_business_executions (closure_cycle_id);

-- ============================================================================
-- s34_feedback_ingestions (S3.4 feedback_ingestion, owned by Pi)
-- C6: append-only feedback entries preserving feedback history.
-- Multiple rows per cycle ordered by feedback_ordinal.
-- Inputs: execution logs, conversion data, tag hit logs
-- Outputs: handoff.md, structured feedback dataset, metrics
-- Transition: statistical significance reached + Antigravity review passes -> S3.5
-- ============================================================================
CREATE TABLE s34_feedback_ingestions (
  ingestion_id                TEXT PRIMARY KEY,
  closure_cycle_id            TEXT NOT NULL,
  feedback_ordinal            INTEGER NOT NULL CHECK (feedback_ordinal > 0),
  feedback_dataset_ref        TEXT NOT NULL,
  metrics_json                TEXT NOT NULL CHECK (json_valid(metrics_json)),
  statistical_significance   TEXT NOT NULL CHECK (statistical_significance IN ('not_reached', 'reached', 'pending')),
  pi_handoff_ref              TEXT,
  antigravity_review_status   TEXT NOT NULL CHECK (antigravity_review_status IN ('pending', 'passed', 'rejected')),
  reviewed_at                 TEXT,
  reviewed_by_actor_id        TEXT,
  created_at                  TEXT NOT NULL,
  updated_at                  TEXT NOT NULL,
  UNIQUE (closure_cycle_id, feedback_ordinal),
  FOREIGN KEY (closure_cycle_id) REFERENCES closure_cycles (closure_cycle_id)
    ON DELETE CASCADE,
  FOREIGN KEY (reviewed_by_actor_id) REFERENCES audit_actors (audit_actor_id)
    ON DELETE RESTRICT
);

CREATE INDEX idx_s34_cycle_ordinal
  ON s34_feedback_ingestions (closure_cycle_id, feedback_ordinal);

-- ============================================================================
-- s35_effect_evaluations (S3.5 effect_evaluation)
-- Inputs: structured feedback data, expected metrics, baseline comparison
-- Outputs: feedback-evaluation.md, deviation analysis, failure warning
-- Transition: met expectations -> S3.6 archive; significant deviation -> S3.6 iterate
-- ============================================================================
CREATE TABLE s35_effect_evaluations (
  evaluation_id               TEXT PRIMARY KEY,
  closure_cycle_id            TEXT NOT NULL,
  evaluation_report_ref       TEXT NOT NULL,
  evaluation_report_sha256    TEXT NOT NULL CHECK (length(evaluation_report_sha256) = 64),
  deviation_analysis_json     TEXT NOT NULL CHECK (json_valid(deviation_analysis_json)),
  hypothesis_result           TEXT NOT NULL CHECK (hypothesis_result IN ('confirmed', 'rejected', 'inconclusive')),
  effectiveness_rating        TEXT NOT NULL CHECK (effectiveness_rating IN ('met_expectations', 'significant_deviation', 'warning')),
  reviewer_actor_id           TEXT NOT NULL,
  reviewed_at                 TEXT NOT NULL,
  created_at                  TEXT NOT NULL,
  updated_at                  TEXT NOT NULL,
  UNIQUE (closure_cycle_id),
  FOREIGN KEY (closure_cycle_id) REFERENCES closure_cycles (closure_cycle_id)
    ON DELETE CASCADE,
  FOREIGN KEY (reviewer_actor_id) REFERENCES audit_actors (audit_actor_id)
    ON DELETE RESTRICT
);

CREATE INDEX idx_s35_cycle
  ON s35_effect_evaluations (closure_cycle_id);

-- ============================================================================
-- s36_iteration_triggers (S3.6 iteration_trigger)
-- Inputs: evaluation report, deviation root cause, corrected hypotheses
-- Outputs: iteration project, tag update ticket, knowledge base update
-- Transition: iterate -> back to S1.1 or S2.3; archive -> flow ends
-- ============================================================================
CREATE TABLE s36_iteration_triggers (
  trigger_id                  TEXT PRIMARY KEY,
  closure_cycle_id            TEXT NOT NULL,
  branch                      TEXT NOT NULL CHECK (branch IN ('archive', 'iterate')),
  target_state                TEXT CHECK (target_state IS NULL OR target_state IN ('S1.1', 'S2.3')),
  successor_project_id        TEXT,
  work_order_ref              TEXT,
  knowledge_base_update_ref   TEXT,
  triggered_at                TEXT NOT NULL,
  triggered_by_actor_id       TEXT NOT NULL,
  created_at                  TEXT NOT NULL,
  updated_at                  TEXT NOT NULL,
  UNIQUE (closure_cycle_id),
  -- archive branch: target_state must be null (flow ends)
  -- iterate branch: target_state must be S1.1 or S2.3
  CHECK (
    (branch = 'archive' AND target_state IS NULL)
    OR
    (branch = 'iterate' AND target_state IS NOT NULL)
  ),
  FOREIGN KEY (closure_cycle_id) REFERENCES closure_cycles (closure_cycle_id)
    ON DELETE CASCADE,
  FOREIGN KEY (triggered_by_actor_id) REFERENCES audit_actors (audit_actor_id)
    ON DELETE RESTRICT
);

CREATE INDEX idx_s36_cycle
  ON s36_iteration_triggers (closure_cycle_id);
