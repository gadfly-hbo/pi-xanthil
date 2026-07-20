-- Workcanger initial schema migration (v1)
-- Implements all P0-01 to P0-100 tables, constraints, and indexes.
-- This file is immutable after first application. Checksum recorded in schema_migrations.

-- ============================================================================
-- schema_migrations
-- ============================================================================
CREATE TABLE schema_migrations (
  version             INTEGER PRIMARY KEY,
  name                TEXT NOT NULL UNIQUE,
  checksum            TEXT NOT NULL,
  applied_at          TEXT NOT NULL,
  application_version TEXT NOT NULL
);

-- ============================================================================
-- audit_actors (P0-68, P0-69, P0-70)
-- ============================================================================
CREATE TABLE audit_actors (
  audit_actor_id           TEXT PRIMARY KEY,
  actor_kind               TEXT NOT NULL CHECK (actor_kind IN ('human', 'system', 'agent')),
  actor_key                TEXT NOT NULL,
  display_name             TEXT NOT NULL,
  created_at               TEXT NOT NULL,
  registered_by_actor_id   TEXT,
  disabled_at              TEXT,
  external_auth_provider   TEXT,
  external_subject_id      TEXT,
  UNIQUE (actor_kind, actor_key),
  CHECK (
    (external_auth_provider IS NULL AND external_subject_id IS NULL)
    OR
    (external_auth_provider IS NOT NULL AND external_subject_id IS NOT NULL)
  ),
  UNIQUE (external_auth_provider, external_subject_id),
  FOREIGN KEY (registered_by_actor_id) REFERENCES audit_actors (audit_actor_id)
    ON DELETE RESTRICT
);

-- ============================================================================
-- analysis_projects (P0-02, P0-03, P0-04, P0-17, P0-60, P0-61)
-- ============================================================================
CREATE TABLE analysis_projects (
  analysis_project_id              TEXT PRIMARY KEY,
  project_kind                     TEXT NOT NULL CHECK (project_kind IN ('goal_decomposition', 'daily_analysis', 'topic_research')),
  title                            TEXT NOT NULL,
  slug                             TEXT NOT NULL COLLATE NOCASE UNIQUE,
  project_status                   TEXT NOT NULL CHECK (project_status IN ('active', 'completed', 'rejected', 'cancelled')),
  current_requirement_version_id   TEXT,
  current_plan_version_id          TEXT,
  source_project_id                TEXT,
  source_relation_type             TEXT CHECK (source_relation_type IN ('derived_from', 'reopened_from')),
  created_at                       TEXT NOT NULL,
  created_by_actor_id              TEXT NOT NULL,
  updated_at                       TEXT NOT NULL,
  completed_at                     TEXT,
  rejected_at                      TEXT,
  cancelled_at                     TEXT,
  archived_at                      TEXT,
  CHECK (
    (source_project_id IS NULL AND source_relation_type IS NULL)
    OR
    (source_project_id IS NOT NULL AND source_relation_type IS NOT NULL)
  ),
  FOREIGN KEY (source_project_id) REFERENCES analysis_projects (analysis_project_id)
    DEFERRABLE INITIALLY DEFERRED,
  FOREIGN KEY (created_by_actor_id) REFERENCES audit_actors (audit_actor_id)
    ON DELETE RESTRICT,
  FOREIGN KEY (current_requirement_version_id) REFERENCES structured_requirement_versions (structured_requirement_version_id)
    DEFERRABLE INITIALLY DEFERRED,
  FOREIGN KEY (current_plan_version_id) REFERENCES analysis_plan_versions (analysis_plan_version_id)
    DEFERRABLE INITIALLY DEFERRED
);

CREATE INDEX idx_analysis_projects_status_archived_updated
  ON analysis_projects (project_status, archived_at, updated_at);

-- ============================================================================
-- analysis_requests (P0-05, P0-60, P0-61)
-- ============================================================================
CREATE TABLE analysis_requests (
  analysis_request_id                       TEXT PRIMARY KEY,
  analysis_project_id                       TEXT NOT NULL UNIQUE,
  raw_request_text                          TEXT NOT NULL CHECK (length(raw_request_text) > 0),
  submitted_context_evidence_ids_json       TEXT NOT NULL CHECK (json_valid(submitted_context_evidence_ids_json)),
  submitted_at                              TEXT NOT NULL,
  submitted_by_actor_id                     TEXT NOT NULL,
  submitted_via                             TEXT NOT NULL CHECK (submitted_via IN ('web_ui', 'local_api')),
  client_version                            TEXT,
  locale                                    TEXT NOT NULL,
  timezone                                  TEXT NOT NULL,
  FOREIGN KEY (analysis_project_id) REFERENCES analysis_projects (analysis_project_id)
    ON DELETE RESTRICT,
  FOREIGN KEY (submitted_by_actor_id) REFERENCES audit_actors (audit_actor_id)
    ON DELETE RESTRICT
);

-- ============================================================================
-- structured_requirement_versions (P0-05, P0-48, P0-49, P0-67)
-- ============================================================================
CREATE TABLE structured_requirement_versions (
  structured_requirement_version_id   TEXT PRIMARY KEY,
  analysis_project_id                 TEXT NOT NULL,
  analysis_request_id                 TEXT NOT NULL,
  version_ordinal                     INTEGER NOT NULL CHECK (version_ordinal > 0),
  supersedes_version_id               TEXT,
  schema_version                      TEXT NOT NULL,
  content_sha256                      TEXT NOT NULL,
  storage_ref                         TEXT NOT NULL,
  created_at                          TEXT NOT NULL,
  created_by_actor_id                 TEXT NOT NULL,
  UNIQUE (analysis_project_id, version_ordinal),
  FOREIGN KEY (analysis_project_id) REFERENCES analysis_projects (analysis_project_id)
    ON DELETE RESTRICT,
  FOREIGN KEY (analysis_request_id) REFERENCES analysis_requests (analysis_request_id)
    ON DELETE RESTRICT,
  FOREIGN KEY (supersedes_version_id) REFERENCES structured_requirement_versions (structured_requirement_version_id)
    DEFERRABLE INITIALLY DEFERRED,
  FOREIGN KEY (created_by_actor_id) REFERENCES audit_actors (audit_actor_id)
    ON DELETE RESTRICT
);

CREATE INDEX idx_requirement_versions_project_ordinal
  ON structured_requirement_versions (analysis_project_id, version_ordinal);

-- ============================================================================
-- analysis_plan_versions (P0-06, P0-50, P0-51, P0-67)
-- ============================================================================
CREATE TABLE analysis_plan_versions (
  analysis_plan_version_id            TEXT PRIMARY KEY,
  analysis_project_id                 TEXT NOT NULL,
  structured_requirement_version_id   TEXT NOT NULL,
  version_ordinal                     INTEGER NOT NULL CHECK (version_ordinal > 0),
  supersedes_version_id               TEXT,
  schema_version                      TEXT NOT NULL,
  content_sha256                      TEXT NOT NULL,
  storage_ref                         TEXT NOT NULL,
  created_at                          TEXT NOT NULL,
  created_by_actor_id                 TEXT NOT NULL,
  UNIQUE (analysis_project_id, version_ordinal),
  FOREIGN KEY (analysis_project_id) REFERENCES analysis_projects (analysis_project_id)
    ON DELETE RESTRICT,
  FOREIGN KEY (structured_requirement_version_id) REFERENCES structured_requirement_versions (structured_requirement_version_id)
    ON DELETE RESTRICT,
  FOREIGN KEY (supersedes_version_id) REFERENCES analysis_plan_versions (analysis_plan_version_id)
    DEFERRABLE INITIALLY DEFERRED,
  FOREIGN KEY (created_by_actor_id) REFERENCES audit_actors (audit_actor_id)
    ON DELETE RESTRICT
);

CREATE INDEX idx_plan_versions_project_ordinal
  ON analysis_plan_versions (analysis_project_id, version_ordinal);

-- ============================================================================
-- source_references (P0-30, P0-31, P0-34, P0-55, P0-56, P0-57, P0-88)
-- ============================================================================
CREATE TABLE source_references (
  source_reference_id           TEXT PRIMARY KEY,
  analysis_project_id           TEXT NOT NULL,
  source_kind                   TEXT NOT NULL CHECK (source_kind IN ('user_provided', 'agentharness')),
  display_name                  TEXT NOT NULL,
  description                   TEXT NOT NULL,
  capability_id                 TEXT,
  contract_version              TEXT,
  source_object_key             TEXT,
  initial_evidence_artifact_id  TEXT,
  declared_data_scope           TEXT NOT NULL,
  usage_constraints_json        TEXT NOT NULL CHECK (json_valid(usage_constraints_json)),
  safety_handling_policy        TEXT NOT NULL CHECK (safety_handling_policy IN ('local_transform_required', 'controlled_or_derived_allowed', 'derived_only_allowed')),
  created_at                    TEXT NOT NULL,
  created_by_actor_id           TEXT NOT NULL,
  archived_at                   TEXT,
  CHECK (
    (capability_id IS NOT NULL AND contract_version IS NOT NULL AND source_object_key IS NOT NULL AND initial_evidence_artifact_id IS NULL)
    OR
    (capability_id IS NULL AND contract_version IS NULL AND source_object_key IS NULL AND initial_evidence_artifact_id IS NOT NULL)
  ),
  FOREIGN KEY (analysis_project_id) REFERENCES analysis_projects (analysis_project_id)
    ON DELETE RESTRICT,
  FOREIGN KEY (initial_evidence_artifact_id) REFERENCES evidence_artifacts (evidence_artifact_id)
    DEFERRABLE INITIALLY DEFERRED,
  FOREIGN KEY (created_by_actor_id) REFERENCES audit_actors (audit_actor_id)
    ON DELETE RESTRICT
);

CREATE UNIQUE INDEX idx_source_references_agentharness_identity
  ON source_references (analysis_project_id, capability_id, contract_version, source_object_key)
  WHERE capability_id IS NOT NULL;

-- ============================================================================
-- source_checks (P0-56, P0-58)
-- ============================================================================
CREATE TABLE source_checks (
  source_check_id              TEXT PRIMARY KEY,
  source_reference_id          TEXT NOT NULL,
  checked_at                   TEXT NOT NULL,
  availability_status          TEXT NOT NULL CHECK (availability_status IN (
    'available', 'temporarily_unavailable', 'access_denied',
    'contract_mismatch', 'source_not_found', 'unsafe', 'check_failed'
  )),
  adapter_name                 TEXT NOT NULL,
  adapter_version              TEXT NOT NULL,
  observed_contract_version    TEXT,
  observed_source_version      TEXT,
  diagnostic_code              TEXT,
  diagnostic_summary           TEXT,
  CHECK (
    availability_status = 'available'
    OR (diagnostic_code IS NOT NULL AND diagnostic_summary IS NOT NULL)
  ),
  FOREIGN KEY (source_reference_id) REFERENCES source_references (source_reference_id)
    ON DELETE RESTRICT
);

CREATE INDEX idx_source_checks_ref_time
  ON source_checks (source_reference_id, checked_at);

-- ============================================================================
-- analysis_runs (P0-07, P0-09, P0-10, P0-52, P0-53, P0-73)
-- ============================================================================
CREATE TABLE analysis_runs (
  analysis_run_id                  TEXT PRIMARY KEY,
  analysis_project_id              TEXT NOT NULL,
  analysis_plan_version_id         TEXT NOT NULL,
  run_ordinal                      INTEGER NOT NULL CHECK (run_ordinal > 0),
  predecessor_run_id               TEXT,
  run_relation_type                TEXT CHECK (run_relation_type IN ('retry_of', 'report_revision_of')),
  triggering_gate_decision_id      TEXT,
  current_analysis_stage           TEXT NOT NULL CHECK (current_analysis_stage IN ('S2.1', 'S2.2', 'S2.3', 'S2.4')),
  current_run_status               TEXT NOT NULL CHECK (current_run_status IN ('queued', 'running', 'succeeded', 'failed', 'aborted', 'blocked')),
  queued_at                        TEXT NOT NULL,
  started_at                       TEXT,
  ended_at                         TEXT,
  terminal_reason_code             TEXT,
  terminal_summary                 TEXT,
  pi_session_ref                   TEXT,
  triggered_by_actor_id            TEXT NOT NULL,
  UNIQUE (analysis_project_id, run_ordinal),
  CHECK (
    (predecessor_run_id IS NULL AND run_relation_type IS NULL)
    OR
    (predecessor_run_id IS NOT NULL AND run_relation_type IS NOT NULL)
  ),
  FOREIGN KEY (analysis_project_id) REFERENCES analysis_projects (analysis_project_id)
    ON DELETE RESTRICT,
  FOREIGN KEY (analysis_plan_version_id) REFERENCES analysis_plan_versions (analysis_plan_version_id)
    ON DELETE RESTRICT,
  FOREIGN KEY (predecessor_run_id) REFERENCES analysis_runs (analysis_run_id)
    DEFERRABLE INITIALLY DEFERRED,
  FOREIGN KEY (triggering_gate_decision_id) REFERENCES gate_decisions (gate_decision_id)
    DEFERRABLE INITIALLY DEFERRED,
  FOREIGN KEY (triggered_by_actor_id) REFERENCES audit_actors (audit_actor_id)
    ON DELETE RESTRICT
);

CREATE UNIQUE INDEX idx_analysis_runs_single_active
  ON analysis_runs (analysis_project_id)
  WHERE current_run_status IN ('queued', 'running');

CREATE INDEX idx_analysis_runs_project_status_queued
  ON analysis_runs (analysis_project_id, current_run_status, queued_at);

-- ============================================================================
-- analysis_run_input_evidence (P0-100)
-- ============================================================================
CREATE TABLE analysis_run_input_evidence (
  analysis_run_id        TEXT NOT NULL,
  evidence_artifact_id   TEXT NOT NULL,
  input_role             TEXT NOT NULL CHECK (input_role IN ('plan_input', 'source_snapshot', 'carried_forward')),
  input_ordinal          INTEGER NOT NULL CHECK (input_ordinal > 0),
  plan_step_id           TEXT NOT NULL,
  admitted_at            TEXT NOT NULL,
  PRIMARY KEY (analysis_run_id, evidence_artifact_id),
  UNIQUE (analysis_run_id, input_ordinal),
  FOREIGN KEY (analysis_run_id) REFERENCES analysis_runs (analysis_run_id)
    ON DELETE RESTRICT,
  FOREIGN KEY (evidence_artifact_id) REFERENCES evidence_artifacts (evidence_artifact_id)
    ON DELETE RESTRICT
);

CREATE INDEX idx_run_input_evidence_artifact
  ON analysis_run_input_evidence (evidence_artifact_id);

CREATE INDEX idx_run_input_evidence_run_step_ordinal
  ON analysis_run_input_evidence (analysis_run_id, plan_step_id, input_ordinal);

-- ============================================================================
-- run_events (P0-08, P0-52, P0-53, P0-54)
-- ============================================================================
CREATE TABLE run_events (
  run_event_id                TEXT PRIMARY KEY,
  analysis_run_id             TEXT NOT NULL,
  sequence                    INTEGER NOT NULL CHECK (sequence > 0),
  event_type                  TEXT NOT NULL CHECK (event_type IN (
    'run_queued', 'run_started', 'run_succeeded', 'run_failed',
    'run_aborted', 'run_blocked', 'stage_started', 'stage_completed',
    'plan_step_started', 'plan_step_completed', 'evidence_registered', 'warning_recorded'
  )),
  analysis_stage_after        TEXT NOT NULL CHECK (analysis_stage_after IN ('S2.1', 'S2.2', 'S2.3', 'S2.4')),
  run_status_after            TEXT NOT NULL CHECK (run_status_after IN ('queued', 'running', 'succeeded', 'failed', 'aborted', 'blocked')),
  occurred_at                 TEXT NOT NULL,
  recorded_at                 TEXT NOT NULL,
  producer_name               TEXT NOT NULL,
  producer_version            TEXT,
  producer_event_id           TEXT,
  payload_schema_version      TEXT NOT NULL,
  payload_json                TEXT NOT NULL CHECK (json_valid(payload_json)),
  raw_diagnostic_artifact_id  TEXT,
  UNIQUE (analysis_run_id, sequence),
  FOREIGN KEY (analysis_run_id) REFERENCES analysis_runs (analysis_run_id)
    ON DELETE RESTRICT,
  FOREIGN KEY (raw_diagnostic_artifact_id) REFERENCES evidence_artifacts (evidence_artifact_id)
    ON DELETE RESTRICT
);

CREATE UNIQUE INDEX idx_run_events_producer_idempotency
  ON run_events (analysis_run_id, producer_name, producer_event_id)
  WHERE producer_event_id IS NOT NULL;

CREATE INDEX idx_run_events_run_sequence
  ON run_events (analysis_run_id, sequence);

-- ============================================================================
-- evidence_artifacts (P0-22 to P0-29)
-- ============================================================================
CREATE TABLE evidence_artifacts (
  evidence_artifact_id      TEXT PRIMARY KEY,
  analysis_project_id       TEXT NOT NULL,
  analysis_run_id           TEXT,
  source_reference_id       TEXT,
  source_check_id           TEXT,
  origin_kind               TEXT NOT NULL CHECK (origin_kind IN ('user_provided', 'analysis_run', 'agentharness', 'system_generated')),
  artifact_kind             TEXT NOT NULL CHECK (artifact_kind IN (
    'input_material', 'safe_preview', 'query', 'notebook',
    'aggregate_result', 'chart', 'diagnostic', 'intermediate_result', 'analysis_result'
  )),
  display_name              TEXT NOT NULL,
  storage_ref               TEXT NOT NULL,
  content_sha256            TEXT NOT NULL,
  media_type                TEXT NOT NULL,
  byte_size                 INTEGER NOT NULL CHECK (byte_size >= 0),
  safety_class              TEXT NOT NULL CHECK (safety_class IN ('restricted_raw', 'controlled', 'derived')),
  visibility                TEXT NOT NULL CHECK (visibility IN ('user_visible', 'review_only', 'system_only')),
  retrieved_at              TEXT,
  observed_source_version   TEXT,
  created_at                TEXT NOT NULL,
  created_by_actor_id       TEXT NOT NULL,
  producer_name             TEXT,
  producer_version          TEXT,
  CHECK (
    NOT (analysis_run_id IS NULL AND source_reference_id IS NULL)
  ),
  FOREIGN KEY (analysis_project_id) REFERENCES analysis_projects (analysis_project_id)
    ON DELETE RESTRICT,
  FOREIGN KEY (analysis_run_id) REFERENCES analysis_runs (analysis_run_id)
    ON DELETE RESTRICT,
  FOREIGN KEY (source_reference_id) REFERENCES source_references (source_reference_id)
    ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED,
  FOREIGN KEY (source_check_id) REFERENCES source_checks (source_check_id)
    ON DELETE RESTRICT,
  FOREIGN KEY (created_by_actor_id) REFERENCES audit_actors (audit_actor_id)
    ON DELETE RESTRICT
);

CREATE INDEX idx_evidence_artifacts_project
  ON evidence_artifacts (analysis_project_id);
CREATE INDEX idx_evidence_artifacts_run
  ON evidence_artifacts (analysis_run_id);
CREATE INDEX idx_evidence_artifacts_source_ref
  ON evidence_artifacts (source_reference_id);
CREATE INDEX idx_evidence_artifacts_content_hash
  ON evidence_artifacts (content_sha256);

-- ============================================================================
-- report_versions (P0-39, P0-40, P0-41, P0-66)
-- ============================================================================
CREATE TABLE report_versions (
  report_version_id                 TEXT PRIMARY KEY,
  analysis_project_id               TEXT NOT NULL,
  analysis_run_id                   TEXT NOT NULL,
  structured_requirement_version_id TEXT NOT NULL,
  analysis_plan_version_id          TEXT NOT NULL,
  version_ordinal                   INTEGER NOT NULL CHECK (version_ordinal > 0),
  supersedes_version_id             TEXT,
  schema_version                    TEXT NOT NULL,
  content_sha256                    TEXT NOT NULL,
  storage_ref                       TEXT NOT NULL,
  created_at                        TEXT NOT NULL,
  created_by_actor_id               TEXT NOT NULL,
  UNIQUE (analysis_project_id, version_ordinal),
  FOREIGN KEY (analysis_project_id) REFERENCES analysis_projects (analysis_project_id)
    ON DELETE RESTRICT,
  FOREIGN KEY (analysis_run_id) REFERENCES analysis_runs (analysis_run_id)
    ON DELETE RESTRICT,
  FOREIGN KEY (structured_requirement_version_id) REFERENCES structured_requirement_versions (structured_requirement_version_id)
    ON DELETE RESTRICT,
  FOREIGN KEY (analysis_plan_version_id) REFERENCES analysis_plan_versions (analysis_plan_version_id)
    ON DELETE RESTRICT,
  FOREIGN KEY (supersedes_version_id) REFERENCES report_versions (report_version_id)
    DEFERRABLE INITIALLY DEFERRED,
  FOREIGN KEY (created_by_actor_id) REFERENCES audit_actors (audit_actor_id)
    ON DELETE RESTRICT
);

CREATE INDEX idx_report_versions_project_ordinal
  ON report_versions (analysis_project_id, version_ordinal);

-- ============================================================================
-- report_version_evidence (P0-40, P0-46, P0-66)
-- ============================================================================
CREATE TABLE report_version_evidence (
  report_version_id       TEXT NOT NULL,
  evidence_artifact_id    TEXT NOT NULL,
  evidence_ordinal        INTEGER NOT NULL CHECK (evidence_ordinal > 0),
  PRIMARY KEY (report_version_id, evidence_artifact_id),
  UNIQUE (report_version_id, evidence_ordinal),
  FOREIGN KEY (report_version_id) REFERENCES report_versions (report_version_id)
    ON DELETE RESTRICT,
  FOREIGN KEY (evidence_artifact_id) REFERENCES evidence_artifacts (evidence_artifact_id)
    ON DELETE RESTRICT
);

-- ============================================================================
-- gate_decisions (P0-12, P0-13, P0-14, P0-62, P0-63)
-- ============================================================================
CREATE TABLE gate_decisions (
  gate_decision_id              TEXT PRIMARY KEY,
  analysis_project_id           TEXT NOT NULL,
  gate_type                     TEXT NOT NULL CHECK (gate_type IN ('requirement_confirmation', 'plan_confirmation', 'report_review')),
  target_object_type            TEXT NOT NULL CHECK (target_object_type IN ('structured_requirement_version', 'analysis_plan_version', 'report_version')),
  target_object_id              TEXT NOT NULL,
  target_schema_version         TEXT NOT NULL,
  target_content_sha256         TEXT NOT NULL,
  decision                      TEXT NOT NULL CHECK (decision IN ('approved', 'changes_requested', 'rejected')),
  decided_at                    TEXT NOT NULL,
  decided_by_actor_id           TEXT NOT NULL,
  actor_display_name_snapshot   TEXT NOT NULL,
  comment                       TEXT,
  requested_changes_json        TEXT NOT NULL CHECK (json_valid(requested_changes_json)),
  rejection_reason              TEXT,
  submitted_via                 TEXT NOT NULL CHECK (submitted_via IN ('web_ui', 'local_api')),
  client_version                TEXT,
  UNIQUE (gate_type, target_object_type, target_object_id),
  CHECK (
    (decision = 'approved' AND json_array_length(requested_changes_json) = 0 AND rejection_reason IS NULL)
    OR
    (decision = 'changes_requested' AND json_array_length(requested_changes_json) > 0 AND rejection_reason IS NULL)
    OR
    (decision = 'rejected' AND json_array_length(requested_changes_json) = 0 AND rejection_reason IS NOT NULL)
  ),
  FOREIGN KEY (analysis_project_id) REFERENCES analysis_projects (analysis_project_id)
    ON DELETE RESTRICT,
  FOREIGN KEY (decided_by_actor_id) REFERENCES audit_actors (audit_actor_id)
    ON DELETE RESTRICT
);

-- Partial unique: at most one approved report_review per project
CREATE UNIQUE INDEX idx_gate_decisions_single_approved_report
  ON gate_decisions (analysis_project_id)
  WHERE gate_type = 'report_review' AND decision = 'approved';

CREATE INDEX idx_gate_decisions_project_type_decided
  ON gate_decisions (analysis_project_id, gate_type, decided_at);
