import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { mkdirSync, statSync } from "node:fs";
import { DB_PATH, WORKSPACES_ROOT, ensureDirs } from "./config.ts";
import type { AnalysisCase, AnalysisCaseInput, AnaxGateConfig, AnalysisStandard, AnalysisStandardKind, BiDatasetDetail, BiDatasetSlot, BiDatasetSummary, BusinessContext, BusinessContextCategory, ChangeProposal, ChangeProposalInput, ChangeProposalStatus, CreateRuleResult, HypothesisEntry, HypothesisEntryInput, EvaluationFlowConfig, EvaluationResultStatus, EvaluationStatus, FileAnalysis, Flow, FlowGenerationStatus, FlowKind, FlowRun, FlowRunStatus, KgEdge, KgNode, KgNodeType, KgRelation, MemoryEvalVariant, MemoryEvaluation, MemoryEvaluationDetail, MemoryEvaluationResult, MemoryInjectionRecord, MemoryInjectionSnapshot, MemoryProposal, MemoryProposalRiskFlag, MemoryFailureAttribution, MemoryProposalStatus, MemorySourceKind, MemoryUsageStats, RuleConflict, ModelLabRunDetail, ModelLabRunSummary, ModelLabStats, PiUsage, PredictionResult, Role, RuleMemory, Session, SessionRuntime, SessionRuntimeStatus, SessionTokenStats, SkillCurationProposalRecord, SkillEvaluation, SkillEvaluationDetail, SkillEvaluationRunResult, SkillEvalSet, SkillEvalTask, SkillPairwiseResult, SkillPairwiseSummary, SkillTaskSummary, SkillVariant, SkillVariantSummary, StaleNode, StaleNodeReason, StoredFlowMessage, StoredMessage, TokenUsageStats, TokenUsageTargetKind, ToolCaseSet, ToolCaseSummary, ToolEvalCase, ToolEvaluation, ToolEvaluationDetail, ToolEvaluationRunResult, TraceErrorType, TraceEvent, TraceFailure, TraceOverview, TraceRuleSuggestion, TraceTimelineItem, TraceTrendPoint, WorkflowEvaluation, WorkflowEvaluationDetail, WorkflowEvaluationResult, WorkflowFavorite, Workspace, WorkspaceFolderName, WorkspacePath, WorkspacePathKind } from "./types.ts";
import { parseEvaluationError, serializeEvaluationError } from "./evaluation-errors.ts";
import { initSharedTables, backfillMemoryEnablements, listEnabledItemIds, enableForOrigin } from "./db/shared.ts";
import { initDataTables } from "./db/data.ts";
import { initEngineTables } from "./db/engine.ts";
import { initVizTables } from "./db/viz.ts";
import type { MetricDefinition, MemoryItemKind } from "./types.ts";

// 全局池模型：按本工作区启用集合过滤池条目（共享单实例；启用关系见 db/shared.ts）。
function enabledIds(workspaceId: string, kind: MemoryItemKind): Set<string> {
  return new Set(listEnabledItemIds(workspaceId, kind));
}

ensureDirs(); // DB opens at import time — guarantee the data dir exists first.
export const db = new DatabaseSync(DB_PATH);

// ---- migrations ----
try {
  const cols = db.prepare("PRAGMA table_info(flows)").all() as Array<{ name: string }>;
  if (!cols.some((c) => c.name === "kind")) {
    db.exec("ALTER TABLE flows ADD COLUMN kind TEXT NOT NULL DEFAULT 'single'");
  }
  if (!cols.some((c) => c.name === "source_session_id")) {
    db.exec("ALTER TABLE flows ADD COLUMN source_session_id TEXT");
  }
  if (!cols.some((c) => c.name === "generation_status")) {
    db.exec("ALTER TABLE flows ADD COLUMN generation_status TEXT NOT NULL DEFAULT 'draft'");
  }
  if (!cols.some((c) => c.name === "generation_error")) {
    db.exec("ALTER TABLE flows ADD COLUMN generation_error TEXT");
  }
} catch {
  // ignore
}
try {
  const cols = db.prepare("PRAGMA table_info(sessions)").all() as Array<{ name: string }>;
  if (!cols.some((c) => c.name === "workflow_id")) {
    db.exec("ALTER TABLE sessions ADD COLUMN workflow_id TEXT");
  }
} catch {
  // ignore
}

try {
  const cols = db.prepare("PRAGMA table_info(rule_memories)").all() as Array<{ name: string }>;
  if (!cols.some((c) => c.name === "scope")) {
    db.exec("ALTER TABLE rule_memories ADD COLUMN scope TEXT NOT NULL DEFAULT 'global'");
  }
  if (!cols.some((c) => c.name === "version")) {
    db.exec("ALTER TABLE rule_memories ADD COLUMN version INTEGER NOT NULL DEFAULT 1");
  }
  if (!cols.some((c) => c.name === "supersedes_rule_id")) {
    db.exec("ALTER TABLE rule_memories ADD COLUMN supersedes_rule_id TEXT");
  }
  if (!cols.some((c) => c.name === "change_reason")) {
    db.exec("ALTER TABLE rule_memories ADD COLUMN change_reason TEXT NOT NULL DEFAULT ''");
  }
} catch {
  // ignore
}

try {
  const cols = db.prepare("PRAGMA table_info(workspace_paths)").all() as Array<{ name: string }>;
  if (!cols.some((c) => c.name === "session_id")) {
    db.exec("ALTER TABLE workspace_paths ADD COLUMN session_id TEXT");
  }
  if (!cols.some((c) => c.name === "flow_id")) {
    db.exec("ALTER TABLE workspace_paths ADD COLUMN flow_id TEXT");
  }
  if (!cols.some((c) => c.name === "kind")) {
    db.exec("ALTER TABLE workspace_paths ADD COLUMN kind TEXT NOT NULL DEFAULT 'file'");
    const rows = db.prepare("SELECT id, path FROM workspace_paths").all() as Array<{ id: number; path: string }>;
    const markDirectory = db.prepare("UPDATE workspace_paths SET kind = 'dir' WHERE id = ?");
    for (const row of rows) {
      try {
        if (statSync(row.path).isDirectory()) markDirectory.run(row.id);
      } catch {
        // Keep missing legacy paths as files; users can remove stale entries.
      }
    }
  }
  if (!cols.some((c) => c.name === "file_hash")) {
    db.exec("ALTER TABLE workspace_paths ADD COLUMN file_hash TEXT");
  }
} catch {
  // ignore
}
try {
  db.exec("CREATE INDEX IF NOT EXISTS idx_ws_paths_session ON workspace_paths(session_id, folder)");
  db.exec("CREATE INDEX IF NOT EXISTS idx_ws_paths_flow ON workspace_paths(flow_id, folder)");
} catch {
  // ignore
}
try {
  const cols = db.prepare("PRAGMA table_info(workflow_evaluations)").all() as Array<{ name: string }>;
  if (cols.length > 0 && !cols.some((c) => c.name === "judge_model")) {
    db.exec("ALTER TABLE workflow_evaluations ADD COLUMN judge_model TEXT NOT NULL DEFAULT ''");
  }
  if (cols.length > 0 && !cols.some((c) => c.name === "flow_configs")) {
    db.exec("ALTER TABLE workflow_evaluations ADD COLUMN flow_configs TEXT NOT NULL DEFAULT '{}'");
  }
} catch {
  // ignore
}

db.exec(`
  CREATE TABLE IF NOT EXISTS workspaces (
    id         TEXT PRIMARY KEY,
    name       TEXT NOT NULL,
    root_path  TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS sessions (
    id           TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL REFERENCES workspaces(id),
    title        TEXT NOT NULL,
    workflow_id  TEXT,
    created_at   INTEGER NOT NULL,
    updated_at   INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS messages (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT NOT NULL REFERENCES sessions(id),
    role       TEXT NOT NULL,
    content    TEXT NOT NULL,
    usage      TEXT,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_sessions_ws ON sessions(workspace_id);
  CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(session_id);
  CREATE TABLE IF NOT EXISTS session_runtime (
    session_id              TEXT PRIMARY KEY REFERENCES sessions(id),
    status                  TEXT NOT NULL DEFAULT 'idle',
    context_tokens          INTEGER,
    context_window          INTEGER,
    context_percent         REAL,
    compact_count           INTEGER NOT NULL DEFAULT 0,
    last_compacted_at       INTEGER,
    auto_compaction_enabled INTEGER NOT NULL DEFAULT 1,
    last_error              TEXT,
    updated_at              INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS flows (
    id           TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL REFERENCES workspaces(id),
    name         TEXT NOT NULL,
    folder_path  TEXT NOT NULL,
    source_name  TEXT,
    source_session_id TEXT,
    generation_status TEXT NOT NULL DEFAULT 'draft',
    generation_error  TEXT,
    kind         TEXT NOT NULL DEFAULT 'single',
    created_at   INTEGER NOT NULL,
    updated_at   INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS flow_messages (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    flow_id    TEXT NOT NULL REFERENCES flows(id),
    role       TEXT NOT NULL,
    content    TEXT NOT NULL,
    usage      TEXT,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_flows_ws ON flows(workspace_id);
  CREATE INDEX IF NOT EXISTS idx_flow_messages_flow ON flow_messages(flow_id);
  CREATE TABLE IF NOT EXISTS flow_runs (
    id         TEXT PRIMARY KEY,
    flow_id    TEXT NOT NULL REFERENCES flows(id),
    inputs     TEXT NOT NULL,
    status     TEXT NOT NULL,
    started_at INTEGER NOT NULL,
    ended_at   INTEGER,
    output_dir TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_flow_runs_flow ON flow_runs(flow_id);
  CREATE INDEX IF NOT EXISTS idx_flow_runs_started ON flow_runs(started_at DESC);
  CREATE TABLE IF NOT EXISTS workflow_favorites (
    id                    TEXT PRIMARY KEY,
    name                  TEXT NOT NULL,
    source_flow_id        TEXT NOT NULL UNIQUE,
    source_workspace_id   TEXT NOT NULL,
    source_workspace_name TEXT NOT NULL,
    snapshot_path         TEXT NOT NULL,
    kind                  TEXT NOT NULL,
    created_at            INTEGER NOT NULL,
    updated_at            INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_workflow_favorites_updated ON workflow_favorites(updated_at DESC);
  CREATE TABLE IF NOT EXISTS workflow_evaluations (
    id           TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL REFERENCES workspaces(id),
    prompt       TEXT NOT NULL,
    rubric       TEXT NOT NULL,
    model        TEXT NOT NULL,
    judge_model  TEXT NOT NULL DEFAULT '',
    flow_configs TEXT NOT NULL DEFAULT '{}',
    repeat       INTEGER NOT NULL,
    status       TEXT NOT NULL,
    created_at   INTEGER NOT NULL,
    ended_at     INTEGER,
    error        TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_workflow_evaluations_ws ON workflow_evaluations(workspace_id, created_at DESC);
  CREATE TABLE IF NOT EXISTS workflow_evaluation_results (
    id            TEXT PRIMARY KEY,
    evaluation_id TEXT NOT NULL REFERENCES workflow_evaluations(id),
    flow_id       TEXT NOT NULL REFERENCES flows(id),
    flow_name     TEXT NOT NULL,
    attempt       INTEGER NOT NULL,
    status        TEXT NOT NULL,
    started_at    INTEGER,
    ended_at      INTEGER,
    duration_sec  REAL NOT NULL DEFAULT 0,
    total_tokens  INTEGER NOT NULL DEFAULT 0,
    total_cost    REAL NOT NULL DEFAULT 0,
    tool_calls    INTEGER NOT NULL DEFAULT 0,
    output_chars  INTEGER NOT NULL DEFAULT 0,
    output        TEXT NOT NULL DEFAULT '',
    error         TEXT,
    judge_score   REAL,
    judge_details TEXT NOT NULL DEFAULT ''
  );
  CREATE INDEX IF NOT EXISTS idx_workflow_evaluation_results_eval ON workflow_evaluation_results(evaluation_id);
  CREATE TABLE IF NOT EXISTS memory_evaluations (
    id           TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL REFERENCES workspaces(id),
    prompt       TEXT NOT NULL,
    rubric       TEXT NOT NULL,
    model        TEXT NOT NULL,
    judge_model  TEXT NOT NULL DEFAULT '',
    target_scope TEXT NOT NULL,
    repeat       INTEGER NOT NULL,
    status       TEXT NOT NULL,
    created_at   INTEGER NOT NULL,
    ended_at     INTEGER,
    error        TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_memory_evaluations_ws ON memory_evaluations(workspace_id, created_at DESC);
  CREATE TABLE IF NOT EXISTS memory_evaluation_results (
    id              TEXT PRIMARY KEY,
    evaluation_id   TEXT NOT NULL REFERENCES memory_evaluations(id),
    variant         TEXT NOT NULL,
    attempt         INTEGER NOT NULL,
    status          TEXT NOT NULL,
    started_at      INTEGER,
    ended_at        INTEGER,
    duration_sec    REAL NOT NULL DEFAULT 0,
    total_tokens    INTEGER NOT NULL DEFAULT 0,
    total_cost      REAL NOT NULL DEFAULT 0,
    tool_calls      INTEGER NOT NULL DEFAULT 0,
    output_chars    INTEGER NOT NULL DEFAULT 0,
    output          TEXT NOT NULL DEFAULT '',
    error           TEXT,
    judge_score     REAL,
    judge_details   TEXT NOT NULL DEFAULT '',
    memory_snapshot TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_memory_evaluation_results_eval ON memory_evaluation_results(evaluation_id);
  CREATE TABLE IF NOT EXISTS workspace_paths (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    workspace_id TEXT NOT NULL REFERENCES workspaces(id),
    session_id   TEXT,
    flow_id      TEXT,
    folder       TEXT NOT NULL,
    path         TEXT NOT NULL,
    kind         TEXT NOT NULL DEFAULT 'file',
    file_hash    TEXT,
    added_at     INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_ws_paths_ws ON workspace_paths(workspace_id, folder);
  CREATE INDEX IF NOT EXISTS idx_ws_paths_session ON workspace_paths(session_id, folder);
  CREATE INDEX IF NOT EXISTS idx_ws_paths_flow ON workspace_paths(flow_id, folder);
  CREATE TABLE IF NOT EXISTS session_token_stats (
    session_id          TEXT PRIMARY KEY,
    input_tokens        INTEGER NOT NULL DEFAULT 0,
    output_tokens       INTEGER NOT NULL DEFAULT 0,
    cache_read_tokens   INTEGER NOT NULL DEFAULT 0,
    cache_write_tokens  INTEGER NOT NULL DEFAULT 0,
    turn_count          INTEGER NOT NULL DEFAULT 0,
    total_cost          REAL NOT NULL DEFAULT 0,
    updated_at          INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_session_token_stats_session ON session_token_stats(session_id);
  CREATE TABLE IF NOT EXISTS token_usage_stats (
    workspace_id        TEXT NOT NULL REFERENCES workspaces(id),
    target_kind         TEXT NOT NULL,
    target_id           TEXT NOT NULL,
    title               TEXT NOT NULL,
    input_tokens        INTEGER NOT NULL DEFAULT 0,
    output_tokens       INTEGER NOT NULL DEFAULT 0,
    cache_read_tokens   INTEGER NOT NULL DEFAULT 0,
    cache_write_tokens  INTEGER NOT NULL DEFAULT 0,
    turn_count          INTEGER NOT NULL DEFAULT 0,
    total_cost          REAL NOT NULL DEFAULT 0,
    updated_at          INTEGER NOT NULL,
    PRIMARY KEY (workspace_id, target_kind, target_id)
  );
  CREATE INDEX IF NOT EXISTS idx_token_usage_stats_ws ON token_usage_stats(workspace_id, updated_at DESC);
  CREATE TABLE IF NOT EXISTS token_usage_daily_stats (
    day                 TEXT NOT NULL,
    workspace_id        TEXT NOT NULL REFERENCES workspaces(id),
    input_tokens        INTEGER NOT NULL DEFAULT 0,
    output_tokens       INTEGER NOT NULL DEFAULT 0,
    cache_read_tokens   INTEGER NOT NULL DEFAULT 0,
    cache_write_tokens  INTEGER NOT NULL DEFAULT 0,
    turn_count          INTEGER NOT NULL DEFAULT 0,
    total_cost          REAL NOT NULL DEFAULT 0,
    updated_at          INTEGER NOT NULL,
    PRIMARY KEY (day, workspace_id)
  );
  CREATE INDEX IF NOT EXISTS idx_token_usage_daily_stats_ws_day ON token_usage_daily_stats(workspace_id, day DESC);
  CREATE TABLE IF NOT EXISTS file_analysis_cache (
    file_hash  TEXT PRIMARY KEY,
    content    TEXT NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS trace_events (
    id          TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL REFERENCES workspaces(id),
    target_kind TEXT NOT NULL,
    target_id   TEXT NOT NULL,
    type        TEXT NOT NULL,
    target      TEXT NOT NULL,
    status      TEXT NOT NULL,
    detail      TEXT,
    payload     TEXT,
    created_at  INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_trace_events_ws_time ON trace_events(workspace_id, created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_trace_events_target ON trace_events(target_kind, target_id);
  CREATE INDEX IF NOT EXISTS idx_trace_events_type ON trace_events(type);
  CREATE TABLE IF NOT EXISTS memory_proposals (
    id               TEXT PRIMARY KEY,
    workspace_id     TEXT NOT NULL REFERENCES workspaces(id),
    kind             TEXT NOT NULL,
    title            TEXT NOT NULL,
    evidence         TEXT NOT NULL,
    source           TEXT NOT NULL,
    severity         TEXT NOT NULL,
    scope            TEXT NOT NULL,
    source_event_ids TEXT NOT NULL DEFAULT '[]',
    confidence       REAL NOT NULL DEFAULT 0,
    risk_flags       TEXT NOT NULL DEFAULT '[]',
    status           TEXT NOT NULL,
    rejection_reason TEXT NOT NULL DEFAULT '',
    approved_rule_id TEXT,
    created_at       INTEGER NOT NULL,
    updated_at       INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_memory_proposals_ws_status ON memory_proposals(workspace_id, status, updated_at DESC);
  CREATE TABLE IF NOT EXISTS memory_usage_stats (
    workspace_id      TEXT NOT NULL REFERENCES workspaces(id),
    source_kind       TEXT NOT NULL,
    source_id         TEXT NOT NULL DEFAULT '*',
    used_count        INTEGER NOT NULL DEFAULT 0,
    last_used_at      INTEGER,
    positive_signals  INTEGER NOT NULL DEFAULT 0,
    negative_signals  INTEGER NOT NULL DEFAULT 0,
    stale_after_days  INTEGER NOT NULL DEFAULT 90,
    updated_at        INTEGER NOT NULL,
    PRIMARY KEY (workspace_id, source_kind, source_id)
  );
  CREATE INDEX IF NOT EXISTS idx_memory_usage_stats_ws ON memory_usage_stats(workspace_id, updated_at DESC);
  CREATE TABLE IF NOT EXISTS rule_memories (
    id           TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL REFERENCES workspaces(id),
    title        TEXT NOT NULL,
    evidence     TEXT NOT NULL,
    source       TEXT NOT NULL,
    severity     TEXT NOT NULL,
    scope        TEXT NOT NULL DEFAULT 'global',
    enabled      INTEGER NOT NULL DEFAULT 1,
    version      INTEGER NOT NULL DEFAULT 1,
    supersedes_rule_id TEXT,
    change_reason TEXT NOT NULL DEFAULT '',
    created_at   INTEGER NOT NULL,
    updated_at   INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_rule_memories_ws ON rule_memories(workspace_id, updated_at DESC);
  CREATE TABLE IF NOT EXISTS rule_conflicts (
    id           TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL REFERENCES workspaces(id),
    rule_a_id    TEXT NOT NULL REFERENCES rule_memories(id),
    rule_b_id    TEXT NOT NULL REFERENCES rule_memories(id),
    reason       TEXT NOT NULL,
    severity     TEXT NOT NULL,
    status       TEXT NOT NULL DEFAULT 'open',
    created_at   INTEGER NOT NULL,
    updated_at   INTEGER NOT NULL,
    UNIQUE(rule_a_id, rule_b_id)
  );
  CREATE INDEX IF NOT EXISTS idx_rule_conflicts_ws ON rule_conflicts(workspace_id, status, updated_at DESC);
  CREATE TABLE IF NOT EXISTS memory_failure_attributions (
    id           TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL REFERENCES workspaces(id),
    target_kind  TEXT NOT NULL,
    target_id    TEXT NOT NULL,
    cause        TEXT NOT NULL,
    source_kind  TEXT,
    source_id    TEXT,
    note         TEXT NOT NULL DEFAULT '',
    created_at   INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_memory_failure_attributions_ws ON memory_failure_attributions(workspace_id, created_at DESC);
  CREATE TABLE IF NOT EXISTS analysis_standards (
    id           TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL REFERENCES workspaces(id),
    kind         TEXT NOT NULL,
    name         TEXT NOT NULL,
    category     TEXT NOT NULL DEFAULT '',
    description  TEXT NOT NULL DEFAULT '',
    formula      TEXT NOT NULL DEFAULT '',
    caliber      TEXT NOT NULL DEFAULT '',
    unit         TEXT NOT NULL DEFAULT '',
    file_path    TEXT NOT NULL DEFAULT '',
    file_hash    TEXT,
    enabled      INTEGER NOT NULL DEFAULT 1,
    created_at   INTEGER NOT NULL,
    updated_at   INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_analysis_standards_ws ON analysis_standards(workspace_id, updated_at DESC);
  CREATE TABLE IF NOT EXISTS business_contexts (
    id           TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL REFERENCES workspaces(id),
    category     TEXT NOT NULL,
    title        TEXT NOT NULL,
    content      TEXT NOT NULL DEFAULT '',
    enabled      INTEGER NOT NULL DEFAULT 1,
    created_at   INTEGER NOT NULL,
    updated_at   INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_business_contexts_ws ON business_contexts(workspace_id, updated_at DESC);
  CREATE TABLE IF NOT EXISTS analysis_cases (
    id           TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL REFERENCES workspaces(id),
    title        TEXT NOT NULL,
    category     TEXT NOT NULL DEFAULT '',
    scenario     TEXT NOT NULL DEFAULT '',
    approach     TEXT NOT NULL DEFAULT '',
    conclusion   TEXT NOT NULL DEFAULT '',
    enabled      INTEGER NOT NULL DEFAULT 1,
    created_at   INTEGER NOT NULL,
    updated_at   INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_analysis_cases_ws ON analysis_cases(workspace_id, updated_at DESC);
  CREATE TABLE IF NOT EXISTS hypothesis_library (
    id           TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL REFERENCES workspaces(id),
    scene        TEXT NOT NULL,
    hypothesis   TEXT NOT NULL,
    verdict      TEXT NOT NULL,
    evidence     TEXT NOT NULL DEFAULT '',
    impact       TEXT NOT NULL DEFAULT '',
    source       TEXT NOT NULL DEFAULT 'manual',
    enabled      INTEGER NOT NULL DEFAULT 1,
    created_at   INTEGER NOT NULL,
    updated_at   INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_hypothesis_library_ws ON hypothesis_library(workspace_id, updated_at DESC);
  CREATE TABLE IF NOT EXISTS change_proposals (
    id              TEXT PRIMARY KEY,
    workspace_id    TEXT NOT NULL REFERENCES workspaces(id),
    run_id          TEXT,
    source_node_id  TEXT,
    title           TEXT NOT NULL,
    description     TEXT NOT NULL DEFAULT '',
    expected_impact TEXT NOT NULL DEFAULT '',
    status          TEXT NOT NULL DEFAULT 'proposed',
    applied_result  TEXT NOT NULL DEFAULT '',
    created_at      INTEGER NOT NULL,
    updated_at      INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_change_proposals_ws ON change_proposals(workspace_id, updated_at DESC);
  CREATE TABLE IF NOT EXISTS anax_gate_config (
    workspace_id          TEXT PRIMARY KEY,
    min_confidence        TEXT NOT NULL DEFAULT 'medium',
    min_evidence_count    INTEGER NOT NULL DEFAULT 2,
    min_data_quality_score REAL NOT NULL DEFAULT 7
  );
  CREATE TABLE IF NOT EXISTS stale_nodes (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    run_id       TEXT NOT NULL,
    node_id      TEXT NOT NULL,
    reason       TEXT NOT NULL,
    triggered_at INTEGER NOT NULL,
    UNIQUE(run_id, node_id)
  );
  CREATE INDEX IF NOT EXISTS idx_stale_nodes_run ON stale_nodes(run_id);
  CREATE TABLE IF NOT EXISTS model_lab_runs (
    id          TEXT PRIMARY KEY,
    model_id    TEXT NOT NULL,
    model       TEXT NOT NULL,
    status      TEXT NOT NULL,
    row_count   INTEGER NOT NULL,
    rows_total  INTEGER NOT NULL,
    rows_capped INTEGER NOT NULL,
    duration_ms INTEGER NOT NULL,
    result      TEXT NOT NULL,
    raw_output  TEXT NOT NULL,
    created_at  INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_model_lab_runs_created ON model_lab_runs(created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_model_lab_runs_model ON model_lab_runs(model_id, created_at DESC);
  CREATE TABLE IF NOT EXISTS bi_datasets (
    id            TEXT PRIMARY KEY,
    slot          TEXT NOT NULL,
    filename      TEXT NOT NULL,
    storage_path  TEXT NOT NULL,
    columns_json  TEXT NOT NULL,
    rows_json     TEXT NOT NULL,
    row_count     INTEGER NOT NULL,
    column_count  INTEGER NOT NULL,
    size_bytes    INTEGER NOT NULL,
    uploaded_at   INTEGER NOT NULL,
    active        INTEGER NOT NULL DEFAULT 1
  );
  CREATE INDEX IF NOT EXISTS idx_bi_datasets_slot_uploaded ON bi_datasets(slot, uploaded_at DESC);
  CREATE INDEX IF NOT EXISTS idx_bi_datasets_slot_active ON bi_datasets(slot, active);
  CREATE TABLE IF NOT EXISTS report_favorites (
    id          TEXT PRIMARY KEY,
    created_at  INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS report_tags (
    report_id   TEXT NOT NULL,
    tag         TEXT NOT NULL,
    created_at  INTEGER NOT NULL,
    PRIMARY KEY (report_id, tag)
  );
  CREATE INDEX IF NOT EXISTS idx_report_tags_tag ON report_tags(tag);
  CREATE INDEX IF NOT EXISTS idx_report_tags_report ON report_tags(report_id);
`);

try {
  const cols = db.prepare("PRAGMA table_info(workspace_paths)").all() as Array<{ name: string }>;
  if (!cols.some((c) => c.name === "session_id")) {
    db.exec("ALTER TABLE workspace_paths ADD COLUMN session_id TEXT");
  }
  if (!cols.some((c) => c.name === "flow_id")) {
    db.exec("ALTER TABLE workspace_paths ADD COLUMN flow_id TEXT");
  }
  if (!cols.some((c) => c.name === "kind")) {
    db.exec("ALTER TABLE workspace_paths ADD COLUMN kind TEXT NOT NULL DEFAULT 'file'");
  }
  if (!cols.some((c) => c.name === "file_hash")) {
    db.exec("ALTER TABLE workspace_paths ADD COLUMN file_hash TEXT");
  }
} catch {
  // ignore
}

try {
  const cols = db.prepare("PRAGMA table_info(model_lab_runs)").all() as Array<{ name: string }>;
  if (!cols.some((c) => c.name === "error_message")) {
    db.exec("ALTER TABLE model_lab_runs ADD COLUMN error_message TEXT");
  }
} catch {
  // ignore
}

try {
  db.exec(`
    CREATE TABLE IF NOT EXISTS skill_eval_sets (
      id           TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL REFERENCES workspaces(id),
      name         TEXT NOT NULL,
      tasks        TEXT NOT NULL,
      created_at   INTEGER NOT NULL,
      updated_at   INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_skill_eval_sets_ws ON skill_eval_sets(workspace_id, updated_at DESC);
    CREATE TABLE IF NOT EXISTS skill_evaluations (
      id                TEXT PRIMARY KEY,
      workspace_id      TEXT NOT NULL REFERENCES workspaces(id),
      model             TEXT NOT NULL,
      repeat            INTEGER NOT NULL,
      status            TEXT NOT NULL,
      started_at        INTEGER NOT NULL,
      ended_at          INTEGER NOT NULL,
      duration_sec      REAL NOT NULL DEFAULT 0,
      variants          TEXT NOT NULL,
      tasks             TEXT NOT NULL,
      context_prefix    TEXT NOT NULL DEFAULT '',
      variant_summaries TEXT NOT NULL,
      task_summaries    TEXT NOT NULL,
      pairwise_summaries TEXT NOT NULL DEFAULT '[]'
    );
    CREATE INDEX IF NOT EXISTS idx_skill_evaluations_ws ON skill_evaluations(workspace_id, started_at DESC);
    CREATE TABLE IF NOT EXISTS skill_evaluation_results (
      id            TEXT PRIMARY KEY,
      evaluation_id TEXT NOT NULL REFERENCES skill_evaluations(id),
      variant_id    TEXT NOT NULL,
      variant_label TEXT NOT NULL,
      task_id       TEXT NOT NULL,
      attempt       INTEGER NOT NULL,
      status        TEXT NOT NULL,
      started_at    INTEGER NOT NULL,
      ended_at      INTEGER NOT NULL,
      duration_sec  REAL NOT NULL DEFAULT 0,
      skill_paths   TEXT NOT NULL,
      total_tokens  INTEGER NOT NULL DEFAULT 0,
      total_cost    REAL NOT NULL DEFAULT 0,
      tool_calls    INTEGER NOT NULL DEFAULT 0,
      output_chars  INTEGER NOT NULL DEFAULT 0,
      output        TEXT NOT NULL DEFAULT '',
      activation    TEXT NOT NULL,
      pairwise      TEXT,
      error         TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_skill_evaluation_results_eval ON skill_evaluation_results(evaluation_id);
  `);
  try { db.exec("ALTER TABLE skill_evaluations ADD COLUMN pairwise_summaries TEXT NOT NULL DEFAULT '[]'"); } catch { /* column exists or read-only */ }
  try { db.exec("ALTER TABLE skill_evaluation_results ADD COLUMN pairwise TEXT"); } catch { /* column exists or read-only */ }
} catch {
  // Read-only test sandboxes may import db only for unrelated helpers.
}

try {
  db.exec(`
    CREATE TABLE IF NOT EXISTS tool_case_sets (
      id           TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL REFERENCES workspaces(id),
      name         TEXT NOT NULL,
      tool_id      TEXT NOT NULL,
      cases        TEXT NOT NULL,
      created_at   INTEGER NOT NULL,
      updated_at   INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_tool_case_sets_ws_tool ON tool_case_sets(workspace_id, tool_id, updated_at DESC);
    CREATE TABLE IF NOT EXISTS tool_evaluations (
      id             TEXT PRIMARY KEY,
      workspace_id   TEXT NOT NULL REFERENCES workspaces(id),
      tool_id        TEXT NOT NULL,
      repeat         INTEGER NOT NULL,
      status         TEXT NOT NULL,
      started_at     INTEGER NOT NULL,
      ended_at       INTEGER NOT NULL,
      duration_sec   REAL NOT NULL DEFAULT 0,
      cases          TEXT NOT NULL,
      case_summaries TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_tool_evaluations_ws ON tool_evaluations(workspace_id, started_at DESC);
    CREATE TABLE IF NOT EXISTS tool_evaluation_results (
      id            TEXT PRIMARY KEY,
      evaluation_id TEXT NOT NULL REFERENCES tool_evaluations(id),
      case_id       TEXT NOT NULL,
      case_name     TEXT NOT NULL,
      attempt       INTEGER NOT NULL,
      status        TEXT NOT NULL,
      started_at    INTEGER NOT NULL,
      ended_at      INTEGER NOT NULL,
      duration_sec  REAL NOT NULL DEFAULT 0,
      input_path    TEXT NOT NULL,
      output_path   TEXT NOT NULL,
      stdout        TEXT NOT NULL DEFAULT '',
      stderr        TEXT NOT NULL DEFAULT '',
      summary       TEXT,
      expectation   TEXT NOT NULL,
      error         TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_tool_evaluation_results_eval ON tool_evaluation_results(evaluation_id);
  `);
} catch {
  // Read-only test sandboxes may import db only for unrelated helpers.
}

try {
  db.exec(`
    CREATE TABLE IF NOT EXISTS skill_curation_proposals (
      id                TEXT PRIMARY KEY,
      workspace_id      TEXT NOT NULL REFERENCES workspaces(id),
      evaluation_id     TEXT NOT NULL,
      type              TEXT NOT NULL,
      target_path       TEXT NOT NULL,
      suggested_content TEXT NOT NULL DEFAULT '',
      rationale         TEXT NOT NULL DEFAULT '',
      confidence        REAL NOT NULL DEFAULT 0,
      evidence          TEXT NOT NULL DEFAULT '[]',
      status            TEXT NOT NULL DEFAULT 'pending',
      created_at        INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_skill_curation_proposals_ws ON skill_curation_proposals(workspace_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_skill_curation_proposals_eval ON skill_curation_proposals(evaluation_id);
  `);
} catch {
  // Read-only test sandboxes may import db only for unrelated helpers.
}

try {
  db.exec(`
    INSERT OR IGNORE INTO token_usage_stats
      (workspace_id, target_kind, target_id, title, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, turn_count, total_cost, updated_at)
    SELECT s.workspace_id, 'session', sts.session_id, s.title,
           sts.input_tokens, sts.output_tokens, sts.cache_read_tokens, sts.cache_write_tokens,
           sts.turn_count, sts.total_cost, sts.updated_at
    FROM session_token_stats sts
    JOIN sessions s ON s.id = sts.session_id
  `);
} catch {
  // ignore
}

try {
  const cols = db.prepare("PRAGMA table_info(messages)").all() as Array<{ name: string }>;
  if (!cols.some((c) => c.name === "error_message")) {
    db.exec("ALTER TABLE messages ADD COLUMN error_message TEXT");
  }
} catch {
  // ignore
}

try {
  const hcols = db.prepare("PRAGMA table_info(hypothesis_library)").all() as Array<{ name: string }>;
  if (!hcols.some((c) => c.name === "confirm_count")) {
    db.exec("ALTER TABLE hypothesis_library ADD COLUMN confirm_count INTEGER NOT NULL DEFAULT 0");
  }
  if (!hcols.some((c) => c.name === "reject_count")) {
    db.exec("ALTER TABLE hypothesis_library ADD COLUMN reject_count INTEGER NOT NULL DEFAULT 0");
  }
  if (!hcols.some((c) => c.name === "partial_count")) {
    db.exec("ALTER TABLE hypothesis_library ADD COLUMN partial_count INTEGER NOT NULL DEFAULT 0");
  }
} catch {
  // ignore
}

// ---- workspaces ----

// ---- domain table slots (绞杀者接缝层; 各域新表建在 db/<域>.ts) ----
initSharedTables();
initDataTables();
initEngineTables();
initVizTables();
migrateMetricStandardsToDefinitions();
// 全局池启用关系 backfill（幂等，须在定义表建好后）。
backfillMemoryEnablements();

/**
 * P2b' metric 完全切源迁移（一次性·幂等·先拷后删）：
 * 把 analysis_standards(kind='metric') 拷入 metric_definitions（同名跳过），
 * 再删除已确认拷贝的旧 metric 行。此后 metric 唯一真源 = metric_definitions。
 * 幂等：删除后无 metric 行可迁移；reference_file 行不受影响。
 */
function migrateMetricStandardsToDefinitions(): void {
  try {
    const rows = db.prepare(
      "SELECT workspace_id AS wid, name, category, description, formula, caliber, unit, enabled, created_at AS createdAt, updated_at AS updatedAt FROM analysis_standards WHERE kind = 'metric'"
    ).all() as unknown as Array<{
      wid: string; name: string; category: string; description: string; formula: string;
      caliber: string; unit: string; enabled: number; createdAt: number; updatedAt: number;
    }>;
    if (rows.length === 0) return;
    const insert = db.prepare(
      "INSERT INTO metric_definitions (id, workspace_id, name, category, description, formula, caliber, unit, object_type_id, bound_columns, enabled, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?, ?)"
    );
    const exists = db.prepare("SELECT 1 FROM metric_definitions WHERE workspace_id = ? AND name = ? LIMIT 1");
    const delRow = db.prepare("DELETE FROM analysis_standards WHERE workspace_id = ? AND kind = 'metric' AND name = ?");
    db.exec("BEGIN");
    try {
      for (const r of rows) {
        if (!exists.get(r.wid, r.name)) {
          insert.run(randomUUID(), r.wid, r.name, r.category, r.description, r.formula, r.caliber, r.unit, r.enabled, r.createdAt, r.updatedAt);
        }
        delRow.run(r.wid, r.name); // 已确认存在于 metric_definitions 后再删旧行
      }
      db.exec("COMMIT");
    } catch (e) {
      db.exec("ROLLBACK");
      throw e;
    }
    console.log(`[xanthil] metric migration: moved ${rows.length} metric standards → metric_definitions`);
  } catch (err) {
    console.error("[xanthil] metric migration failed (non-fatal):", err);
  }
}

export function createWorkspace(name: string): Workspace {
  const id = randomUUID();
  const rootPath = join(WORKSPACES_ROOT, id);
  mkdirSync(rootPath, { recursive: true });
  mkdirSync(join(rootPath, "files"), { recursive: true });
  mkdirSync(join(rootPath, ".pi-sessions"), { recursive: true });
  const createdAt = Date.now();
  db.prepare(
    "INSERT INTO workspaces (id, name, root_path, created_at) VALUES (?, ?, ?, ?)",
  ).run(id, name, rootPath, createdAt);
  return { id, name, rootPath, createdAt };
}

export function listWorkspaces(): Workspace[] {
  return db
    .prepare("SELECT id, name, root_path AS rootPath, created_at AS createdAt FROM workspaces ORDER BY created_at DESC")
    .all() as unknown as Workspace[];
}

export function getWorkspace(id: string): Workspace | undefined {
  return db
    .prepare("SELECT id, name, root_path AS rootPath, created_at AS createdAt FROM workspaces WHERE id = ?")
    .get(id) as unknown as Workspace | undefined;
}

export function renameWorkspace(id: string, name: string): void {
  db.prepare("UPDATE workspaces SET name = ? WHERE id = ?").run(name, id);
}

export function deleteWorkspace(id: string): void {
  // Remove DB rows for the workspace and its sessions/messages. Files on disk
  // under the workspace root are intentionally left in place.
  const sessions = db.prepare("SELECT id FROM sessions WHERE workspace_id = ?").all(id) as unknown as Array<{ id: string }>;
  const delMsgs = db.prepare("DELETE FROM messages WHERE session_id = ?");
  const delRuntime = db.prepare("DELETE FROM session_runtime WHERE session_id = ?");
  for (const s of sessions) delMsgs.run(s.id);
  for (const s of sessions) delRuntime.run(s.id);
  // Cascade: delete paths belonging to sessions in this workspace
  const delSessionPaths = db.prepare("DELETE FROM workspace_paths WHERE session_id = ?");
  for (const s of sessions) delSessionPaths.run(s.id);
  const evaluations = db.prepare("SELECT id FROM workflow_evaluations WHERE workspace_id = ?").all(id) as unknown as Array<{ id: string }>;
  const delEvaluationResults = db.prepare("DELETE FROM workflow_evaluation_results WHERE evaluation_id = ?");
  for (const evaluation of evaluations) delEvaluationResults.run(evaluation.id);
  db.prepare("DELETE FROM workflow_evaluations WHERE workspace_id = ?").run(id);
  const memoryEvaluations = db.prepare("SELECT id FROM memory_evaluations WHERE workspace_id = ?").all(id) as unknown as Array<{ id: string }>;
  const delMemoryEvaluationResults = db.prepare("DELETE FROM memory_evaluation_results WHERE evaluation_id = ?");
  for (const evaluation of memoryEvaluations) delMemoryEvaluationResults.run(evaluation.id);
  db.prepare("DELETE FROM memory_evaluations WHERE workspace_id = ?").run(id);
  const skillEvaluations = db.prepare("SELECT id FROM skill_evaluations WHERE workspace_id = ?").all(id) as unknown as Array<{ id: string }>;
  const delSkillEvaluationResults = db.prepare("DELETE FROM skill_evaluation_results WHERE evaluation_id = ?");
  for (const evaluation of skillEvaluations) delSkillEvaluationResults.run(evaluation.id);
  db.prepare("DELETE FROM skill_evaluations WHERE workspace_id = ?").run(id);
  const toolEvaluations = db.prepare("SELECT id FROM tool_evaluations WHERE workspace_id = ?").all(id) as unknown as Array<{ id: string }>;
  const delToolEvaluationResults = db.prepare("DELETE FROM tool_evaluation_results WHERE evaluation_id = ?");
  for (const evaluation of toolEvaluations) delToolEvaluationResults.run(evaluation.id);
  db.prepare("DELETE FROM tool_evaluations WHERE workspace_id = ?").run(id);
  db.prepare("DELETE FROM skill_eval_sets WHERE workspace_id = ?").run(id);
  db.prepare("DELETE FROM tool_case_sets WHERE workspace_id = ?").run(id);
  db.prepare("DELETE FROM skill_curation_proposals WHERE workspace_id = ?").run(id);
  db.prepare("DELETE FROM memory_proposals WHERE workspace_id = ?").run(id);
  db.prepare("DELETE FROM memory_usage_stats WHERE workspace_id = ?").run(id);
  db.prepare("DELETE FROM rule_conflicts WHERE workspace_id = ?").run(id);
  db.prepare("DELETE FROM memory_failure_attributions WHERE workspace_id = ?").run(id);
  // Cascade: delete flows and their dependent records in this workspace.
  const flows = db.prepare("SELECT id FROM flows WHERE workspace_id = ?").all(id) as unknown as Array<{ id: string }>;
  for (const flow of flows) deleteFlow(flow.id);
  db.prepare("DELETE FROM sessions WHERE workspace_id = ?").run(id);
  db.prepare("DELETE FROM workspace_paths WHERE workspace_id = ?").run(id);
  db.prepare("DELETE FROM workspaces WHERE id = ?").run(id);
}

// ---- sessions ----

export function createSession(workspaceId: string, title: string, workflowId: string | null = null): Session {
  const id = randomUUID();
  const now = Date.now();
  db.prepare(
    "INSERT INTO sessions (id, workspace_id, title, workflow_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
  ).run(id, workspaceId, title, workflowId, now, now);
  return { id, workspaceId, title, workflowId, createdAt: now, updatedAt: now };
}

export function listSessions(workspaceId: string): Session[] {
  return db
    .prepare(
      "SELECT id, workspace_id AS workspaceId, title, workflow_id AS workflowId, created_at AS createdAt, updated_at AS updatedAt FROM sessions WHERE workspace_id = ? AND workflow_id IS NULL ORDER BY updated_at DESC",
    )
    .all(workspaceId) as unknown as Session[];
}

export function getSession(id: string): Session | undefined {
  return db
    .prepare(
      "SELECT id, workspace_id AS workspaceId, title, workflow_id AS workflowId, created_at AS createdAt, updated_at AS updatedAt FROM sessions WHERE id = ?",
    )
    .get(id) as unknown as Session | undefined;
}

export function touchSession(id: string): void {
  db.prepare("UPDATE sessions SET updated_at = ? WHERE id = ?").run(Date.now(), id);
}

export function renameSession(id: string, title: string): void {
  db.prepare("UPDATE sessions SET title = ? WHERE id = ?").run(title, id);
}

export function deleteSession(id: string): void {
  db.prepare("DELETE FROM messages WHERE session_id = ?").run(id);
  db.prepare("DELETE FROM workspace_paths WHERE session_id = ?").run(id);
  db.prepare("DELETE FROM session_runtime WHERE session_id = ?").run(id);
  db.prepare("DELETE FROM sessions WHERE id = ?").run(id);
}

// ---- session runtime ----

export function getSessionRuntime(sessionId: string): SessionRuntime {
  const row = db.prepare(
    `SELECT session_id AS sessionId, status, context_tokens AS contextTokens,
      context_window AS contextWindow, context_percent AS contextPercent,
      compact_count AS compactCount, last_compacted_at AS lastCompactedAt,
      auto_compaction_enabled AS autoCompactionEnabled, last_error AS lastError,
      updated_at AS updatedAt
    FROM session_runtime WHERE session_id = ?`,
  ).get(sessionId) as unknown as (Omit<SessionRuntime, "autoCompactionEnabled"> & { autoCompactionEnabled: number }) | undefined;
  if (row) return { ...row, autoCompactionEnabled: Boolean(row.autoCompactionEnabled) };
  return {
    sessionId,
    status: "idle",
    contextTokens: null,
    contextWindow: null,
    contextPercent: null,
    compactCount: 0,
    lastCompactedAt: null,
    autoCompactionEnabled: true,
    lastError: null,
    updatedAt: Date.now(),
  };
}

export function updateSessionRuntime(
  sessionId: string,
  patch: Partial<Omit<SessionRuntime, "sessionId" | "updatedAt">>,
): SessionRuntime {
  const current = getSessionRuntime(sessionId);
  const next = { ...current, ...patch, sessionId, updatedAt: Date.now() };
  db.prepare(
    `INSERT INTO session_runtime (
      session_id, status, context_tokens, context_window, context_percent,
      compact_count, last_compacted_at, auto_compaction_enabled, last_error, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(session_id) DO UPDATE SET
      status = excluded.status,
      context_tokens = excluded.context_tokens,
      context_window = excluded.context_window,
      context_percent = excluded.context_percent,
      compact_count = excluded.compact_count,
      last_compacted_at = excluded.last_compacted_at,
      auto_compaction_enabled = excluded.auto_compaction_enabled,
      last_error = excluded.last_error,
      updated_at = excluded.updated_at`,
  ).run(
    next.sessionId,
    next.status satisfies SessionRuntimeStatus,
    next.contextTokens,
    next.contextWindow,
    next.contextPercent,
    next.compactCount,
    next.lastCompactedAt,
    next.autoCompactionEnabled ? 1 : 0,
    next.lastError,
    next.updatedAt,
  );
  return next;
}

// ---- messages ----

export function addMessage(
  sessionId: string,
  role: Role,
  content: unknown,
  usage: PiUsage | null = null,
  errorMessage: string | null = null,
): void {
  db.prepare(
    "INSERT INTO messages (session_id, role, content, usage, error_message, created_at) VALUES (?, ?, ?, ?, ?, ?)",
  ).run(sessionId, role, JSON.stringify(content), usage ? JSON.stringify(usage) : null, errorMessage, Date.now());
  touchSession(sessionId);
}

export function listMessages(sessionId: string): StoredMessage[] {
  const rows = db
    .prepare(
      "SELECT id, session_id AS sessionId, role, content, usage, error_message AS errorMessage, created_at AS createdAt FROM messages WHERE session_id = ? ORDER BY id ASC",
    )
    .all(sessionId) as unknown as Array<
      Omit<StoredMessage, "content" | "usage"> & { content: string; usage: string | null }
    >;
  return rows.map((r) => ({
    ...r,
    content: JSON.parse(r.content),
    usage: r.usage ? (JSON.parse(r.usage) as PiUsage) : null,
  }));
}

// ---- flows ----

export function createFlow(
  workspaceId: string,
  name: string,
  sourceName: string | null = null,
  kind: FlowKind = "single",
  sourceSessionId: string | null = null,
  generationStatus: FlowGenerationStatus = "draft",
): Flow {
  const id = randomUUID();
  const ws = getWorkspace(workspaceId);
  if (!ws) throw new Error("workspace not found");
  const folderPath = join(ws.rootPath, "flows", id);
  mkdirSync(folderPath, { recursive: true });
  const now = Date.now();
  db.prepare(
    "INSERT INTO flows (id, workspace_id, name, folder_path, source_name, source_session_id, generation_status, generation_error, kind, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
  ).run(id, workspaceId, name, folderPath, sourceName, sourceSessionId, generationStatus, null, kind, now, now);
  return { id, workspaceId, name, folderPath, sourceName, sourceSessionId, generationStatus, generationError: null, kind, createdAt: now, updatedAt: now };
}

export function listFlows(workspaceId: string): Flow[] {
  return db
    .prepare(
      "SELECT id, workspace_id AS workspaceId, name, folder_path AS folderPath, source_name AS sourceName, source_session_id AS sourceSessionId, generation_status AS generationStatus, generation_error AS generationError, kind, created_at AS createdAt, updated_at AS updatedAt FROM flows WHERE workspace_id = ? ORDER BY updated_at DESC",
    )
    .all(workspaceId) as unknown as Flow[];
}

export function getFlow(id: string): Flow | undefined {
  return db
    .prepare(
      "SELECT id, workspace_id AS workspaceId, name, folder_path AS folderPath, source_name AS sourceName, source_session_id AS sourceSessionId, generation_status AS generationStatus, generation_error AS generationError, kind, created_at AS createdAt, updated_at AS updatedAt FROM flows WHERE id = ?",
    )
    .get(id) as unknown as Flow | undefined;
}

export function renameFlow(id: string, name: string): void {
  db.prepare("UPDATE flows SET name = ?, updated_at = ? WHERE id = ?").run(name, Date.now(), id);
}

export function touchFlow(id: string): void {
  db.prepare("UPDATE flows SET updated_at = ? WHERE id = ?").run(Date.now(), id);
}

export function updateFlowSourceName(id: string, sourceName: string): void {
  db.prepare("UPDATE flows SET source_name = ?, updated_at = ? WHERE id = ?").run(sourceName, Date.now(), id);
}

export function updateFlowGeneration(id: string, status: FlowGenerationStatus, error: string | null = null): void {
  db.prepare("UPDATE flows SET generation_status = ?, generation_error = ?, updated_at = ? WHERE id = ?")
    .run(status, error, Date.now(), id);
}

export function deleteFlow(id: string): void {
  // DB only — folder on disk is intentionally retained (mirrors workspace delete semantics).
  db.prepare("DELETE FROM flow_messages WHERE flow_id = ?").run(id);
  db.prepare("DELETE FROM flow_runs WHERE flow_id = ?").run(id);
  db.prepare("DELETE FROM workspace_paths WHERE flow_id = ?").run(id);
  db.prepare("DELETE FROM flows WHERE id = ?").run(id);
}

// ---- workflow favorites ----

export function createWorkflowFavorite(flow: Flow, workspace: Workspace, snapshotPath: string): WorkflowFavorite {
  const id = randomUUID();
  const now = Date.now();
  db.prepare(
    "INSERT INTO workflow_favorites (id, name, source_flow_id, source_workspace_id, source_workspace_name, snapshot_path, kind, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
  ).run(id, flow.name, flow.id, workspace.id, workspace.name, snapshotPath, flow.kind, now, now);
  return { id, name: flow.name, sourceFlowId: flow.id, sourceWorkspaceId: workspace.id, sourceWorkspaceName: workspace.name, snapshotPath, kind: flow.kind, createdAt: now, updatedAt: now };
}

export function listWorkflowFavorites(): WorkflowFavorite[] {
  return db
    .prepare(
      "SELECT id, name, source_flow_id AS sourceFlowId, source_workspace_id AS sourceWorkspaceId, source_workspace_name AS sourceWorkspaceName, snapshot_path AS snapshotPath, kind, created_at AS createdAt, updated_at AS updatedAt FROM workflow_favorites ORDER BY updated_at DESC",
    )
    .all() as unknown as WorkflowFavorite[];
}

export function getWorkflowFavorite(id: string): WorkflowFavorite | undefined {
  return db
    .prepare(
      "SELECT id, name, source_flow_id AS sourceFlowId, source_workspace_id AS sourceWorkspaceId, source_workspace_name AS sourceWorkspaceName, snapshot_path AS snapshotPath, kind, created_at AS createdAt, updated_at AS updatedAt FROM workflow_favorites WHERE id = ?",
    )
    .get(id) as unknown as WorkflowFavorite | undefined;
}

export function getWorkflowFavoriteBySourceFlowId(flowId: string): WorkflowFavorite | undefined {
  return db
    .prepare(
      "SELECT id, name, source_flow_id AS sourceFlowId, source_workspace_id AS sourceWorkspaceId, source_workspace_name AS sourceWorkspaceName, snapshot_path AS snapshotPath, kind, created_at AS createdAt, updated_at AS updatedAt FROM workflow_favorites WHERE source_flow_id = ?",
    )
    .get(flowId) as unknown as WorkflowFavorite | undefined;
}

export function updateWorkflowFavorite(id: string, flow: Flow, workspace: Workspace): void {
  db.prepare(
    "UPDATE workflow_favorites SET name = ?, source_workspace_id = ?, source_workspace_name = ?, kind = ?, updated_at = ? WHERE id = ?",
  ).run(flow.name, workspace.id, workspace.name, flow.kind, Date.now(), id);
}

export function removeWorkflowFavorite(id: string): void {
  db.prepare("DELETE FROM workflow_favorites WHERE id = ?").run(id);
}

// ---- flow messages ----

export function addFlowMessage(
  flowId: string,
  role: Role,
  content: unknown,
  usage: PiUsage | null = null,
): void {
  db.prepare(
    "INSERT INTO flow_messages (flow_id, role, content, usage, created_at) VALUES (?, ?, ?, ?, ?)",
  ).run(flowId, role, JSON.stringify(content), usage ? JSON.stringify(usage) : null, Date.now());
  touchFlow(flowId);
}

export function listFlowMessages(flowId: string): StoredFlowMessage[] {
  const rows = db
    .prepare(
      "SELECT id, flow_id AS flowId, role, content, usage, created_at AS createdAt FROM flow_messages WHERE flow_id = ? ORDER BY id ASC",
    )
    .all(flowId) as unknown as Array<
      Omit<StoredFlowMessage, "content" | "usage"> & { content: string; usage: string | null }
    >;
  return rows.map((r) => ({
    ...r,
    content: JSON.parse(r.content),
    usage: r.usage ? (JSON.parse(r.usage) as PiUsage) : null,
  }));
}

// ---- flow runs ----

export function createFlowRun(flowId: string, inputs: unknown, outputDir: string): FlowRun {
  const id = randomUUID();
  const startedAt = Date.now();
  const status: FlowRunStatus = "running";
  db.prepare(
    "INSERT INTO flow_runs (id, flow_id, inputs, status, started_at, ended_at, output_dir) VALUES (?, ?, ?, ?, ?, ?, ?)",
  ).run(id, flowId, JSON.stringify(inputs ?? {}), status, startedAt, null, outputDir);
  touchFlow(flowId);
  return { id, flowId, inputs: inputs ?? {}, status, startedAt, endedAt: null, outputDir };
}

export function finishFlowRun(id: string, status: FlowRunStatus): void {
  db.prepare("UPDATE flow_runs SET status = ?, ended_at = ? WHERE id = ?").run(status, Date.now(), id);
}

export function listFlowRuns(flowId: string): FlowRun[] {
  const rows = db
    .prepare(
      "SELECT id, flow_id AS flowId, inputs, status, started_at AS startedAt, ended_at AS endedAt, output_dir AS outputDir FROM flow_runs WHERE flow_id = ? ORDER BY started_at DESC",
    )
    .all(flowId) as unknown as Array<Omit<FlowRun, "inputs"> & { inputs: string }>;
  return rows.map((r) => ({ ...r, inputs: JSON.parse(r.inputs) }));
}

export function getFlowRun(id: string): FlowRun | undefined {
  const row = db
    .prepare(
      "SELECT id, flow_id AS flowId, inputs, status, started_at AS startedAt, ended_at AS endedAt, output_dir AS outputDir FROM flow_runs WHERE id = ?",
    )
    .get(id) as unknown as (Omit<FlowRun, "inputs"> & { inputs: string }) | undefined;
  if (!row) return undefined;
  return { ...row, inputs: JSON.parse(row.inputs) };
}

// ---- workflow evaluations ----

export function createWorkflowEvaluation(
  workspaceId: string,
  prompt: string,
  rubric: string,
  model: string,
  judgeModel: string,
  flowConfigs: Record<string, EvaluationFlowConfig>,
  repeat: number,
  flows: Flow[],
): WorkflowEvaluationDetail {
  const id = randomUUID();
  const createdAt = Date.now();
  const status: EvaluationStatus = "running";
  db.prepare(
    "INSERT INTO workflow_evaluations (id, workspace_id, prompt, rubric, model, judge_model, flow_configs, repeat, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
  ).run(id, workspaceId, prompt, rubric, model, judgeModel, JSON.stringify(flowConfigs), repeat, status, createdAt);
  const insert = db.prepare(
    "INSERT INTO workflow_evaluation_results (id, evaluation_id, flow_id, flow_name, attempt, status) VALUES (?, ?, ?, ?, ?, ?)",
  );
  const results: WorkflowEvaluationResult[] = [];
  for (const flow of flows) {
    for (let attempt = 1; attempt <= repeat; attempt++) {
      const result = {
        id: randomUUID(),
        evaluationId: id,
        flowId: flow.id,
        flowName: flow.name,
        attempt,
        status: "pending" as const,
        startedAt: null,
        endedAt: null,
        durationSec: 0,
        totalTokens: 0,
        totalCost: 0,
        toolCalls: 0,
        outputChars: 0,
        output: "",
        error: null,
        judgeScore: null,
        judgeDetails: "",
      };
      insert.run(result.id, id, flow.id, flow.name, attempt, result.status);
      results.push(result);
    }
  }
  return { id, workspaceId, prompt, rubric, model, judgeModel, flowConfigs, repeat, status, createdAt, endedAt: null, error: null, results };
}

export function listWorkflowEvaluations(workspaceId: string): WorkflowEvaluation[] {
  const rows = db.prepare(
    "SELECT id, workspace_id AS workspaceId, prompt, rubric, model, COALESCE(NULLIF(judge_model, ''), model) AS judgeModel, flow_configs AS flowConfigs, repeat, status, created_at AS createdAt, ended_at AS endedAt, error FROM workflow_evaluations WHERE workspace_id = ? ORDER BY created_at DESC",
  ).all(workspaceId) as unknown as Array<Omit<WorkflowEvaluation, "flowConfigs"> & { flowConfigs: string }>;
  return rows.map(parseEvaluationFlowConfigs);
}

export function getWorkflowEvaluation(id: string): WorkflowEvaluationDetail | undefined {
  const row = db.prepare(
    "SELECT id, workspace_id AS workspaceId, prompt, rubric, model, COALESCE(NULLIF(judge_model, ''), model) AS judgeModel, flow_configs AS flowConfigs, repeat, status, created_at AS createdAt, ended_at AS endedAt, error FROM workflow_evaluations WHERE id = ?",
  ).get(id) as unknown as (Omit<WorkflowEvaluation, "flowConfigs"> & { flowConfigs: string }) | undefined;
  if (!row) return undefined;
  const evaluation = parseEvaluationFlowConfigs(row);
  const results = db.prepare(
    "SELECT id, evaluation_id AS evaluationId, flow_id AS flowId, flow_name AS flowName, attempt, status, started_at AS startedAt, ended_at AS endedAt, duration_sec AS durationSec, total_tokens AS totalTokens, total_cost AS totalCost, tool_calls AS toolCalls, output_chars AS outputChars, output, error, judge_score AS judgeScore, judge_details AS judgeDetails FROM workflow_evaluation_results WHERE evaluation_id = ? ORDER BY flow_name, attempt",
  ).all(id) as unknown as Array<Omit<WorkflowEvaluationResult, "error"> & { error: unknown }>;
  const parsedResults: WorkflowEvaluationResult[] = results.map((result) => ({
    ...result,
    error: parseEvaluationError(result.error),
  }));
  return { ...evaluation, results: parsedResults };
}

function parseEvaluationFlowConfigs(
  row: Omit<WorkflowEvaluation, "flowConfigs"> & { flowConfigs: string },
): WorkflowEvaluation {
  const error = parseEvaluationError(row.error);
  try {
    return { ...row, error, flowConfigs: JSON.parse(row.flowConfigs) as Record<string, EvaluationFlowConfig> };
  } catch {
    return { ...row, error, flowConfigs: {} };
  }
}

export function updateWorkflowEvaluation(id: string, status: EvaluationStatus, error: WorkflowEvaluation["error"] | string | null = null): void {
  db.prepare("UPDATE workflow_evaluations SET status = ?, ended_at = ?, error = ? WHERE id = ?")
    .run(status, Date.now(), serializeEvaluationError(error), id);
}

export function updateWorkflowEvaluationResult(
  id: string,
  fields: Partial<Omit<WorkflowEvaluationResult, "id" | "evaluationId" | "flowId" | "flowName" | "attempt">>,
): void {
  const entries = Object.entries(fields);
  if (entries.length === 0) return;
  const columns: Record<string, string> = {
    status: "status",
    startedAt: "started_at",
    endedAt: "ended_at",
    durationSec: "duration_sec",
    totalTokens: "total_tokens",
    totalCost: "total_cost",
    toolCalls: "tool_calls",
    outputChars: "output_chars",
    output: "output",
    error: "error",
    judgeScore: "judge_score",
    judgeDetails: "judge_details",
  };
  const valid = entries.filter(([key]) => columns[key]);
  if (valid.length === 0) return;
  const sql = valid.map(([key]) => `${columns[key]} = ?`).join(", ");
  const values = valid.map(([key, value]) => {
    if (key === "error") return serializeEvaluationError(value as WorkflowEvaluationResult["error"] | string | null);
    if (value === undefined) return null;
    if (typeof value === "object" && value !== null) return JSON.stringify(value);
    return value;
  });
  db.prepare(`UPDATE workflow_evaluation_results SET ${sql} WHERE id = ?`)
    .run(...values, id);
}

// ---- memory evaluations ----

const MEMORY_EVAL_VARIANTS: MemoryEvalVariant[] = ["baseline", "memory"];

function parseMemoryEvaluationRow(row: Omit<MemoryEvaluation, "error"> & { error: unknown }): MemoryEvaluation {
  return { ...row, error: parseEvaluationError(row.error) };
}

function parseMemoryEvaluationResultRow(row: Omit<MemoryEvaluationResult, "error" | "memorySnapshot"> & { error: unknown; memorySnapshot: string | null }): MemoryEvaluationResult {
  let memorySnapshot: MemoryInjectionSnapshot | null = null;
  if (row.memorySnapshot) {
    try {
      memorySnapshot = JSON.parse(row.memorySnapshot) as MemoryInjectionSnapshot;
    } catch {
      memorySnapshot = null;
    }
  }
  return { ...row, error: parseEvaluationError(row.error), memorySnapshot };
}

export function createMemoryEvaluation(
  workspaceId: string,
  prompt: string,
  rubric: string,
  model: string,
  judgeModel: string,
  targetScope: "chat" | "workflow",
  repeat: number,
): MemoryEvaluationDetail {
  const id = randomUUID();
  const createdAt = Date.now();
  const status: EvaluationStatus = "running";
  db.prepare(`
    INSERT INTO memory_evaluations
      (id, workspace_id, prompt, rubric, model, judge_model, target_scope, repeat, status, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, workspaceId, prompt, rubric, model, judgeModel, targetScope, repeat, status, createdAt);

  const insert = db.prepare(`
    INSERT INTO memory_evaluation_results (id, evaluation_id, variant, attempt, status)
    VALUES (?, ?, ?, ?, ?)
  `);
  const results: MemoryEvaluationResult[] = [];
  for (const variant of MEMORY_EVAL_VARIANTS) {
    for (let attempt = 1; attempt <= repeat; attempt++) {
      const result: MemoryEvaluationResult = {
        id: randomUUID(),
        evaluationId: id,
        variant,
        attempt,
        status: "pending",
        startedAt: null,
        endedAt: null,
        durationSec: 0,
        totalTokens: 0,
        totalCost: 0,
        toolCalls: 0,
        outputChars: 0,
        output: "",
        error: null,
        judgeScore: null,
        judgeDetails: "",
        memorySnapshot: null,
      };
      insert.run(result.id, id, variant, attempt, result.status);
      results.push(result);
    }
  }
  return { id, workspaceId, prompt, rubric, model, judgeModel, targetScope, repeat, status, createdAt, endedAt: null, error: null, results };
}

export function listMemoryEvaluations(workspaceId: string): MemoryEvaluation[] {
  const rows = db.prepare(`
    SELECT id, workspace_id AS workspaceId, prompt, rubric, model, COALESCE(NULLIF(judge_model, ''), model) AS judgeModel,
           target_scope AS targetScope, repeat, status, created_at AS createdAt, ended_at AS endedAt, error
    FROM memory_evaluations
    WHERE workspace_id = ?
    ORDER BY created_at DESC
  `).all(workspaceId) as unknown as Array<Omit<MemoryEvaluation, "error"> & { error: unknown }>;
  return rows.map(parseMemoryEvaluationRow);
}

export function getMemoryEvaluation(id: string): MemoryEvaluationDetail | undefined {
  const row = db.prepare(`
    SELECT id, workspace_id AS workspaceId, prompt, rubric, model, COALESCE(NULLIF(judge_model, ''), model) AS judgeModel,
           target_scope AS targetScope, repeat, status, created_at AS createdAt, ended_at AS endedAt, error
    FROM memory_evaluations
    WHERE id = ?
  `).get(id) as unknown as (Omit<MemoryEvaluation, "error"> & { error: unknown }) | undefined;
  if (!row) return undefined;
  const results = db.prepare(`
    SELECT id, evaluation_id AS evaluationId, variant, attempt, status, started_at AS startedAt,
           ended_at AS endedAt, duration_sec AS durationSec, total_tokens AS totalTokens,
           total_cost AS totalCost, tool_calls AS toolCalls, output_chars AS outputChars,
           output, error, judge_score AS judgeScore, judge_details AS judgeDetails,
           memory_snapshot AS memorySnapshot
    FROM memory_evaluation_results
    WHERE evaluation_id = ?
    ORDER BY variant, attempt
  `).all(id) as unknown as Array<Omit<MemoryEvaluationResult, "error" | "memorySnapshot"> & { error: unknown; memorySnapshot: string | null }>;
  return { ...parseMemoryEvaluationRow(row), results: results.map(parseMemoryEvaluationResultRow) };
}

export function updateMemoryEvaluation(id: string, status: EvaluationStatus, error: MemoryEvaluation["error"] | string | null = null): void {
  db.prepare("UPDATE memory_evaluations SET status = ?, ended_at = ?, error = ? WHERE id = ?")
    .run(status, Date.now(), serializeEvaluationError(error), id);
}

export function updateMemoryEvaluationResult(
  id: string,
  fields: Partial<Omit<MemoryEvaluationResult, "id" | "evaluationId" | "variant" | "attempt">>,
): void {
  const entries = Object.entries(fields);
  if (entries.length === 0) return;
  const columns: Record<string, string> = {
    status: "status",
    startedAt: "started_at",
    endedAt: "ended_at",
    durationSec: "duration_sec",
    totalTokens: "total_tokens",
    totalCost: "total_cost",
    toolCalls: "tool_calls",
    outputChars: "output_chars",
    output: "output",
    error: "error",
    judgeScore: "judge_score",
    judgeDetails: "judge_details",
    memorySnapshot: "memory_snapshot",
  };
  const valid = entries.filter(([key]) => columns[key]);
  if (valid.length === 0) return;
  const sql = valid.map(([key]) => `${columns[key]} = ?`).join(", ");
  const values = valid.map(([key, value]) => {
    if (key === "error") return serializeEvaluationError(value as MemoryEvaluationResult["error"] | string | null);
    if (key === "memorySnapshot") return value ? JSON.stringify(value) : null;
    if (value === undefined) return null;
    if (typeof value === "object" && value !== null) return JSON.stringify(value);
    return value;
  });
  db.prepare(`UPDATE memory_evaluation_results SET ${sql} WHERE id = ?`)
    .run(...values, id);
}

// ---- skill evaluations ----

export function createSkillEvalSet(workspaceId: string, name: string, tasks: SkillEvalTask[]): SkillEvalSet {
  const now = Date.now();
  const id = randomUUID();
  db.prepare(
    "INSERT INTO skill_eval_sets (id, workspace_id, name, tasks, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
  ).run(id, workspaceId, name, JSON.stringify(tasks), now, now);
  return { id, workspaceId, name, tasks, createdAt: now, updatedAt: now };
}

export function getSkillEvalSet(id: string): SkillEvalSet | undefined {
  const row = db.prepare(
    "SELECT id, workspace_id AS workspaceId, name, tasks, created_at AS createdAt, updated_at AS updatedAt FROM skill_eval_sets WHERE id = ?",
  ).get(id) as unknown as SkillEvalSetRow | undefined;
  return row ? parseSkillEvalSetRow(row) : undefined;
}

export function listSkillEvalSets(workspaceId: string): SkillEvalSet[] {
  const rows = db.prepare(
    "SELECT id, workspace_id AS workspaceId, name, tasks, created_at AS createdAt, updated_at AS updatedAt FROM skill_eval_sets WHERE workspace_id = ? ORDER BY updated_at DESC",
  ).all(workspaceId) as unknown as SkillEvalSetRow[];
  return rows.map(parseSkillEvalSetRow);
}

export function updateSkillEvalSet(id: string, name: string, tasks: SkillEvalTask[]): SkillEvalSet | undefined {
  const existing = getSkillEvalSet(id);
  if (!existing) return undefined;
  const updatedAt = Date.now();
  db.prepare("UPDATE skill_eval_sets SET name = ?, tasks = ?, updated_at = ? WHERE id = ?")
    .run(name, JSON.stringify(tasks), updatedAt, id);
  return { ...existing, name, tasks, updatedAt };
}

export function deleteSkillEvalSet(id: string): boolean {
  const result = db.prepare("DELETE FROM skill_eval_sets WHERE id = ?").run(id);
  return result.changes > 0;
}

type SkillEvalSetRow = Omit<SkillEvalSet, "tasks"> & {
  tasks: string;
};

function parseSkillEvalSetRow(row: SkillEvalSetRow): SkillEvalSet {
  return {
    ...row,
    tasks: parseJsonArray<SkillEvalTask>(row.tasks),
  };
}

export function saveSkillEvaluation(
  workspaceId: string,
  model: string,
  repeat: number,
  variants: SkillVariant[],
  tasks: SkillEvalTask[],
  contextPrefix: string | undefined,
  summary: Omit<SkillEvaluationDetail, "workspaceId" | "model" | "repeat" | "variants" | "tasks" | "contextPrefix">,
): SkillEvaluationDetail {
  db.prepare(
    "INSERT INTO skill_evaluations (id, workspace_id, model, repeat, status, started_at, ended_at, duration_sec, variants, tasks, context_prefix, variant_summaries, task_summaries, pairwise_summaries) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
  ).run(
    summary.evaluationId,
    workspaceId,
    model,
    repeat,
    summary.status,
    summary.startedAt,
    summary.endedAt,
    summary.durationSec,
    JSON.stringify(variants),
    JSON.stringify(tasks),
    contextPrefix ?? "",
    JSON.stringify(summary.variantSummaries),
    JSON.stringify(summary.taskSummaries),
    JSON.stringify(summary.pairwiseSummaries),
  );
  const insert = db.prepare(
    "INSERT INTO skill_evaluation_results (id, evaluation_id, variant_id, variant_label, task_id, attempt, status, started_at, ended_at, duration_sec, skill_paths, total_tokens, total_cost, tool_calls, output_chars, output, activation, pairwise, error) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
  );
  for (const result of summary.results) {
    insert.run(
      result.id,
      summary.evaluationId,
      result.variantId,
      result.variantLabel,
      result.taskId,
      result.attempt,
      result.status,
      result.startedAt,
      result.endedAt,
      result.durationSec,
      JSON.stringify(result.skillPaths),
      result.totalTokens,
      result.totalCost,
      result.toolCalls,
      result.outputChars,
      result.output,
      JSON.stringify(result.activation),
      result.pairwise ? JSON.stringify(result.pairwise) : null,
      serializeEvaluationError(result.error),
    );
  }
  return {
    evaluationId: summary.evaluationId,
    workspaceId,
    model,
    repeat,
    status: summary.status,
    startedAt: summary.startedAt,
    endedAt: summary.endedAt,
    durationSec: summary.durationSec,
    variants,
    tasks,
    contextPrefix: contextPrefix ?? "",
    results: summary.results,
    variantSummaries: summary.variantSummaries,
    taskSummaries: summary.taskSummaries,
    pairwiseSummaries: summary.pairwiseSummaries,
  };
}

export function listSkillEvaluations(workspaceId: string): SkillEvaluation[] {
  const rows = db.prepare(
    "SELECT id AS evaluationId, workspace_id AS workspaceId, model, repeat, status, started_at AS startedAt, ended_at AS endedAt, duration_sec AS durationSec, variants, tasks, context_prefix AS contextPrefix, variant_summaries AS variantSummaries, task_summaries AS taskSummaries, pairwise_summaries AS pairwiseSummaries FROM skill_evaluations WHERE workspace_id = ? ORDER BY started_at DESC",
  ).all(workspaceId) as unknown as SkillEvaluationRow[];
  return rows.map(parseSkillEvaluationRow);
}

export function getSkillEvaluation(id: string): SkillEvaluationDetail | undefined {
  const row = db.prepare(
    "SELECT id AS evaluationId, workspace_id AS workspaceId, model, repeat, status, started_at AS startedAt, ended_at AS endedAt, duration_sec AS durationSec, variants, tasks, context_prefix AS contextPrefix, variant_summaries AS variantSummaries, task_summaries AS taskSummaries, pairwise_summaries AS pairwiseSummaries FROM skill_evaluations WHERE id = ?",
  ).get(id) as unknown as SkillEvaluationRow | undefined;
  if (!row) return undefined;
  const evaluation = parseSkillEvaluationRow(row);
  const results = db.prepare(
    "SELECT id, variant_id AS variantId, variant_label AS variantLabel, task_id AS taskId, attempt, status, started_at AS startedAt, ended_at AS endedAt, duration_sec AS durationSec, skill_paths AS skillPaths, total_tokens AS totalTokens, total_cost AS totalCost, tool_calls AS toolCalls, output_chars AS outputChars, output, activation, pairwise, error FROM skill_evaluation_results WHERE evaluation_id = ? ORDER BY variant_label, task_id, attempt",
  ).all(id) as unknown as SkillEvaluationResultRow[];
  return {
    ...evaluation,
    results: results.map(parseSkillEvaluationResultRow),
  };
}

type SkillEvaluationRow = Omit<SkillEvaluation, "variants" | "tasks" | "variantSummaries" | "taskSummaries" | "pairwiseSummaries"> & {
  variants: string;
  tasks: string;
  variantSummaries: string;
  taskSummaries: string;
  pairwiseSummaries: string;
};

type SkillEvaluationResultRow = Omit<SkillEvaluationRunResult, "skillPaths" | "activation" | "pairwise" | "error"> & {
  skillPaths: string;
  activation: string;
  pairwise: string | null;
  error: unknown;
};

function parseSkillEvaluationRow(row: SkillEvaluationRow): SkillEvaluation {
  return {
    ...row,
    status: row.status === "failed" ? "failed" : "success",
    variants: parseJsonArray<SkillVariant>(row.variants),
    tasks: parseJsonArray<SkillEvalTask>(row.tasks),
    variantSummaries: parseJsonArray<SkillVariantSummary>(row.variantSummaries),
    taskSummaries: parseJsonArray<SkillTaskSummary>(row.taskSummaries),
    pairwiseSummaries: parseJsonArray<SkillPairwiseSummary>(row.pairwiseSummaries),
  };
}

function parseSkillEvaluationResultRow(row: SkillEvaluationResultRow): SkillEvaluationRunResult {
  return {
    ...row,
    status: row.status === "failed" ? "failed" : "success",
    skillPaths: parseJsonArray<string>(row.skillPaths),
    activation: parseJsonObject(row.activation, {
      activated: false,
      matchedKeywords: [],
      matchedSkillPaths: [],
      evidence: [],
    }),
    pairwise: row.pairwise ? parseJsonObject<SkillPairwiseResult | null>(row.pairwise, null) : null,
    error: parseEvaluationError(row.error),
  };
}

function parseJsonArray<T>(value: string): T[] {
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed as T[] : [];
  } catch {
    return [];
  }
}

function parseJsonObject<T>(value: string, fallback: T): T {
  try {
    const parsed = JSON.parse(value) as unknown;
    return typeof parsed === "object" && parsed !== null ? parsed as T : fallback;
  } catch {
    return fallback;
  }
}

// ---- tool evaluations ----

export function createToolCaseSet(workspaceId: string, name: string, toolId: string, cases: ToolEvalCase[]): ToolCaseSet {
  const now = Date.now();
  const id = randomUUID();
  db.prepare(
    "INSERT INTO tool_case_sets (id, workspace_id, name, tool_id, cases, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
  ).run(id, workspaceId, name, toolId, JSON.stringify(cases), now, now);
  return { id, workspaceId, name, toolId, cases, createdAt: now, updatedAt: now };
}

export function getToolCaseSet(id: string): ToolCaseSet | undefined {
  const row = db.prepare(
    "SELECT id, workspace_id AS workspaceId, name, tool_id AS toolId, cases, created_at AS createdAt, updated_at AS updatedAt FROM tool_case_sets WHERE id = ?",
  ).get(id) as unknown as ToolCaseSetRow | undefined;
  return row ? parseToolCaseSetRow(row) : undefined;
}

export function listToolCaseSets(workspaceId: string, toolId?: string): ToolCaseSet[] {
  const rows = toolId
    ? db.prepare(
      "SELECT id, workspace_id AS workspaceId, name, tool_id AS toolId, cases, created_at AS createdAt, updated_at AS updatedAt FROM tool_case_sets WHERE workspace_id = ? AND tool_id = ? ORDER BY updated_at DESC",
    ).all(workspaceId, toolId) as unknown as ToolCaseSetRow[]
    : db.prepare(
      "SELECT id, workspace_id AS workspaceId, name, tool_id AS toolId, cases, created_at AS createdAt, updated_at AS updatedAt FROM tool_case_sets WHERE workspace_id = ? ORDER BY updated_at DESC",
    ).all(workspaceId) as unknown as ToolCaseSetRow[];
  return rows.map(parseToolCaseSetRow);
}

export function updateToolCaseSet(id: string, name: string, toolId: string, cases: ToolEvalCase[]): ToolCaseSet | undefined {
  const existing = getToolCaseSet(id);
  if (!existing) return undefined;
  const updatedAt = Date.now();
  db.prepare("UPDATE tool_case_sets SET name = ?, tool_id = ?, cases = ?, updated_at = ? WHERE id = ?")
    .run(name, toolId, JSON.stringify(cases), updatedAt, id);
  return { ...existing, name, toolId, cases, updatedAt };
}

export function deleteToolCaseSet(id: string): boolean {
  const result = db.prepare("DELETE FROM tool_case_sets WHERE id = ?").run(id);
  return result.changes > 0;
}

type ToolCaseSetRow = Omit<ToolCaseSet, "cases"> & {
  cases: string;
};

function parseToolCaseSetRow(row: ToolCaseSetRow): ToolCaseSet {
  return {
    ...row,
    cases: parseJsonArray<ToolEvalCase>(row.cases),
  };
}

export function saveToolEvaluation(
  workspaceId: string,
  toolId: string,
  repeat: number,
  cases: ToolEvalCase[],
  summary: Omit<ToolEvaluationDetail, "workspaceId" | "toolId" | "repeat" | "cases">,
): ToolEvaluationDetail {
  db.prepare(
    "INSERT INTO tool_evaluations (id, workspace_id, tool_id, repeat, status, started_at, ended_at, duration_sec, cases, case_summaries) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
  ).run(
    summary.evaluationId,
    workspaceId,
    toolId,
    repeat,
    summary.status,
    summary.startedAt,
    summary.endedAt,
    summary.durationSec,
    JSON.stringify(cases),
    JSON.stringify(summary.caseSummaries),
  );
  const insert = db.prepare(
    "INSERT INTO tool_evaluation_results (id, evaluation_id, case_id, case_name, attempt, status, started_at, ended_at, duration_sec, input_path, output_path, stdout, stderr, summary, expectation, error) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
  );
  for (const result of summary.results) {
    insert.run(
      result.id,
      summary.evaluationId,
      result.caseId,
      result.caseName,
      result.attempt,
      result.status,
      result.startedAt,
      result.endedAt,
      result.durationSec,
      result.inputPath,
      result.outputPath,
      result.stdout,
      result.stderr,
      result.summary ? JSON.stringify(result.summary) : null,
      JSON.stringify(result.expectation),
      serializeEvaluationError(result.error),
    );
  }
  return {
    evaluationId: summary.evaluationId,
    workspaceId,
    toolId,
    repeat,
    status: summary.status,
    startedAt: summary.startedAt,
    endedAt: summary.endedAt,
    durationSec: summary.durationSec,
    cases,
    caseSummaries: summary.caseSummaries,
    results: summary.results,
  };
}

export function listToolEvaluations(workspaceId: string): ToolEvaluation[] {
  const rows = db.prepare(
    "SELECT id AS evaluationId, workspace_id AS workspaceId, tool_id AS toolId, repeat, status, started_at AS startedAt, ended_at AS endedAt, duration_sec AS durationSec, cases, case_summaries AS caseSummaries FROM tool_evaluations WHERE workspace_id = ? ORDER BY started_at DESC",
  ).all(workspaceId) as unknown as ToolEvaluationRow[];
  return rows.map(parseToolEvaluationRow);
}

export function getToolEvaluation(id: string): ToolEvaluationDetail | undefined {
  const row = db.prepare(
    "SELECT id AS evaluationId, workspace_id AS workspaceId, tool_id AS toolId, repeat, status, started_at AS startedAt, ended_at AS endedAt, duration_sec AS durationSec, cases, case_summaries AS caseSummaries FROM tool_evaluations WHERE id = ?",
  ).get(id) as unknown as ToolEvaluationRow | undefined;
  if (!row) return undefined;
  const evaluation = parseToolEvaluationRow(row);
  const results = db.prepare(
    "SELECT id, case_id AS caseId, case_name AS caseName, attempt, status, started_at AS startedAt, ended_at AS endedAt, duration_sec AS durationSec, input_path AS inputPath, output_path AS outputPath, stdout, stderr, summary, expectation, error FROM tool_evaluation_results WHERE evaluation_id = ? ORDER BY case_name, attempt",
  ).all(id) as unknown as ToolEvaluationResultRow[];
  return {
    ...evaluation,
    results: results.map(parseToolEvaluationResultRow),
  };
}

type ToolEvaluationRow = Omit<ToolEvaluation, "cases" | "caseSummaries"> & {
  cases: string;
  caseSummaries: string;
};

type ToolEvaluationResultRow = Omit<ToolEvaluationRunResult, "summary" | "expectation" | "error"> & {
  summary: string | null;
  expectation: string;
  error: unknown;
};

function parseToolEvaluationRow(row: ToolEvaluationRow): ToolEvaluation {
  return {
    ...row,
    status: row.status === "failed" ? "failed" : "success",
    cases: parseJsonArray<ToolEvalCase>(row.cases),
    caseSummaries: parseJsonArray<ToolCaseSummary>(row.caseSummaries),
  };
}

function parseToolEvaluationResultRow(row: ToolEvaluationResultRow): ToolEvaluationRunResult {
  return {
    ...row,
    status: row.status === "failed" ? "failed" : "success",
    summary: row.summary ? parseJsonObject(row.summary, {}) : null,
    expectation: parseJsonObject(row.expectation, { kind: "must-fail" }),
    error: parseEvaluationError(row.error),
  };
}

// ---- workspace paths ----

const VALID_FOLDERS = new Set<string>(["draw_data", "clean_data", "report"]);
const VALID_PATH_KINDS = new Set<string>(["file", "dir"]);

export function addWorkspacePath(workspaceId: string, folder: string, path: string, kind: string, sessionId: string | null = null, flowId: string | null = null, fileHash: string | null = null): WorkspacePath {
  if (!VALID_FOLDERS.has(folder)) throw new Error(`invalid folder: ${folder}`);
  if (!VALID_PATH_KINDS.has(kind)) throw new Error(`invalid path kind: ${kind}`);
  const now = Date.now();
  const result = db
    .prepare("INSERT INTO workspace_paths (workspace_id, session_id, flow_id, folder, path, kind, file_hash, added_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
    .run(workspaceId, sessionId, flowId, folder, path, kind, fileHash, now);
  return { id: Number(result.lastInsertRowid), workspaceId, sessionId, flowId, folder: folder as WorkspaceFolderName, path, kind: kind as WorkspacePathKind, fileHash, addedAt: now };
}

export function updateWorkspacePathHash(id: number, fileHash: string): void {
  db.prepare("UPDATE workspace_paths SET file_hash = ? WHERE id = ?").run(fileHash, id);
}

export function listWorkspacePaths(workspaceId: string, folder?: string, sessionId?: string, flowId?: string): WorkspacePath[] {
  const conditions: string[] = ["workspace_id = ?"];
  const params: (string | number)[] = [workspaceId];
  if (folder) {
    conditions.push("folder = ?");
    params.push(folder);
  }
  if (sessionId !== undefined) {
    conditions.push("session_id = ?");
    params.push(sessionId);
  }
  if (flowId !== undefined) {
    conditions.push("flow_id = ?");
    params.push(flowId);
  }
  const where = conditions.join(" AND ");
  return db
    .prepare(
      `SELECT id, workspace_id AS workspaceId, session_id AS sessionId, flow_id AS flowId, folder, path, kind, file_hash AS fileHash, added_at AS addedAt FROM workspace_paths WHERE ${where} ORDER BY folder, added_at ASC`,
    )
    .all(...params) as unknown as WorkspacePath[];
}

export function getWorkspacePath(id: number): WorkspacePath | undefined {
  return db
    .prepare("SELECT id, workspace_id AS workspaceId, session_id AS sessionId, flow_id AS flowId, folder, path, kind, file_hash AS fileHash, added_at AS addedAt FROM workspace_paths WHERE id = ?")
    .get(id) as unknown as WorkspacePath | undefined;
}

export function removeWorkspacePath(id: number): void {
  db.prepare("DELETE FROM workspace_paths WHERE id = ?").run(id);
}

// ---- file analysis cache ----

export function getFileAnalysis(fileHash: string): FileAnalysis | null {
  const row = db.prepare(
    "SELECT file_hash AS fileHash, content, updated_at AS updatedAt FROM file_analysis_cache WHERE file_hash = ?",
  ).get(fileHash) as unknown as FileAnalysis | undefined;
  return row ?? null;
}

export function setFileAnalysis(fileHash: string, content: string): void {
  db.prepare(`
    INSERT INTO file_analysis_cache (file_hash, content, updated_at) VALUES (?, ?, ?)
    ON CONFLICT(file_hash) DO UPDATE SET content = excluded.content, updated_at = excluded.updated_at
  `).run(fileHash, content, Date.now());
}

/** Returns a map of workspace_path.id → analysis content for all paths that have a hash with cached analysis. */
export function getFileAnalysesByPathIds(pathIds: number[]): Map<number, string> {
  if (pathIds.length === 0) return new Map();
  const placeholders = pathIds.map(() => "?").join(",");
  const rows = db.prepare(`
    SELECT wp.id, fac.content
    FROM workspace_paths wp
    JOIN file_analysis_cache fac ON fac.file_hash = wp.file_hash
    WHERE wp.id IN (${placeholders}) AND wp.file_hash IS NOT NULL
  `).all(...pathIds) as Array<{ id: number; content: string }>;
  return new Map(rows.map((r) => [r.id, r.content]));
}

// ---- session token stats ----

type RawSessionTokenStats = Omit<SessionTokenStats, "cacheHitRate">;

export function accumulateSessionTokenStats(
  sessionId: string,
  delta: { input: number; output: number; cacheRead: number; cacheWrite: number; cost: number },
): void {
  db.prepare(`
    INSERT INTO session_token_stats
      (session_id, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, turn_count, total_cost, updated_at)
    VALUES (?, ?, ?, ?, ?, 1, ?, ?)
    ON CONFLICT(session_id) DO UPDATE SET
      input_tokens       = input_tokens + excluded.input_tokens,
      output_tokens      = output_tokens + excluded.output_tokens,
      cache_read_tokens  = cache_read_tokens + excluded.cache_read_tokens,
      cache_write_tokens = cache_write_tokens + excluded.cache_write_tokens,
      turn_count         = turn_count + 1,
      total_cost         = total_cost + excluded.total_cost,
      updated_at         = excluded.updated_at
  `).run(
    sessionId,
    delta.input,
    delta.output,
    delta.cacheRead,
    delta.cacheWrite,
    delta.cost,
    Date.now(),
  );
}

export function getRawSessionTokenStats(sessionId: string): RawSessionTokenStats | undefined {
  return db.prepare(`
    SELECT session_id AS sessionId, input_tokens AS inputTokens, output_tokens AS outputTokens,
           cache_read_tokens AS cacheReadTokens, cache_write_tokens AS cacheWriteTokens,
           turn_count AS turnCount, total_cost AS totalCost, updated_at AS updatedAt
    FROM session_token_stats WHERE session_id = ?
  `).get(sessionId) as unknown as RawSessionTokenStats | undefined;
}

export function listRawSessionTokenStatsByWorkspace(workspaceId: string): RawSessionTokenStats[] {
  return db.prepare(`
    SELECT sts.session_id AS sessionId, sts.input_tokens AS inputTokens, sts.output_tokens AS outputTokens,
           sts.cache_read_tokens AS cacheReadTokens, sts.cache_write_tokens AS cacheWriteTokens,
           sts.turn_count AS turnCount, sts.total_cost AS totalCost, sts.updated_at AS updatedAt
    FROM session_token_stats sts
    JOIN sessions s ON s.id = sts.session_id
    WHERE s.workspace_id = ?
  `).all(workspaceId) as unknown as RawSessionTokenStats[];
}

export function listRawSessionTokenStatsWithTitles(workspaceId: string): (RawSessionTokenStats & { title: string })[] {
  return db.prepare(`
    SELECT sts.session_id AS sessionId, sts.input_tokens AS inputTokens, sts.output_tokens AS outputTokens,
           sts.cache_read_tokens AS cacheReadTokens, sts.cache_write_tokens AS cacheWriteTokens,
           sts.turn_count AS turnCount, sts.total_cost AS totalCost, sts.updated_at AS updatedAt,
           s.title
    FROM session_token_stats sts
    JOIN sessions s ON s.id = sts.session_id
    WHERE s.workspace_id = ?
    ORDER BY sts.updated_at DESC
  `).all(workspaceId) as unknown as (RawSessionTokenStats & { title: string })[];
}

type RawTokenUsageStats = Omit<TokenUsageStats, "cacheHitRate">;

function dayKey(ts = Date.now()): string {
  return new Date(ts).toISOString().slice(0, 10);
}

export function accumulateTokenUsageStats(
  target: { workspaceId: string; targetKind: TokenUsageTargetKind; targetId: string; title: string },
  delta: { input: number; output: number; cacheRead: number; cacheWrite: number; cost: number },
): void {
  const now = Date.now();
  db.prepare(`
    INSERT INTO token_usage_stats
      (workspace_id, target_kind, target_id, title, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, turn_count, total_cost, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
    ON CONFLICT(workspace_id, target_kind, target_id) DO UPDATE SET
      title              = excluded.title,
      input_tokens       = input_tokens + excluded.input_tokens,
      output_tokens      = output_tokens + excluded.output_tokens,
      cache_read_tokens  = cache_read_tokens + excluded.cache_read_tokens,
      cache_write_tokens = cache_write_tokens + excluded.cache_write_tokens,
      turn_count         = turn_count + 1,
      total_cost         = total_cost + excluded.total_cost,
      updated_at         = excluded.updated_at
  `).run(
    target.workspaceId,
    target.targetKind,
    target.targetId,
    target.title,
    delta.input,
    delta.output,
    delta.cacheRead,
    delta.cacheWrite,
    delta.cost,
    now,
  );
  db.prepare(`
    INSERT INTO token_usage_daily_stats
      (day, workspace_id, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, turn_count, total_cost, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)
    ON CONFLICT(day, workspace_id) DO UPDATE SET
      input_tokens       = input_tokens + excluded.input_tokens,
      output_tokens      = output_tokens + excluded.output_tokens,
      cache_read_tokens  = cache_read_tokens + excluded.cache_read_tokens,
      cache_write_tokens = cache_write_tokens + excluded.cache_write_tokens,
      turn_count         = turn_count + 1,
      total_cost         = total_cost + excluded.total_cost,
      updated_at         = excluded.updated_at
  `).run(
    dayKey(now),
    target.workspaceId,
    delta.input,
    delta.output,
    delta.cacheRead,
    delta.cacheWrite,
    delta.cost,
    now,
  );
}

export function listRawTokenUsageStatsByWorkspace(workspaceId: string): RawTokenUsageStats[] {
  return db.prepare(`
    SELECT workspace_id AS workspaceId, target_kind AS targetKind, target_id AS targetId, title,
           input_tokens AS inputTokens, output_tokens AS outputTokens,
           cache_read_tokens AS cacheReadTokens, cache_write_tokens AS cacheWriteTokens,
           turn_count AS turnCount, total_cost AS totalCost, updated_at AS updatedAt
    FROM token_usage_stats
    WHERE workspace_id = ?
    ORDER BY updated_at DESC
  `).all(workspaceId) as unknown as RawTokenUsageStats[];
}

export function getRawTokenUsageStatsByTarget(
  workspaceId: string,
  targetKind: TokenUsageTargetKind,
  targetId: string,
): RawTokenUsageStats | undefined {
  return db.prepare(`
    SELECT workspace_id AS workspaceId, target_kind AS targetKind, target_id AS targetId, title,
           input_tokens AS inputTokens, output_tokens AS outputTokens,
           cache_read_tokens AS cacheReadTokens, cache_write_tokens AS cacheWriteTokens,
           turn_count AS turnCount, total_cost AS totalCost, updated_at AS updatedAt
    FROM token_usage_stats
    WHERE workspace_id = ? AND target_kind = ? AND target_id = ?
  `).get(workspaceId, targetKind, targetId) as unknown as RawTokenUsageStats | undefined;
}

export function getRawTokenUsageDailyStats(workspaceId: string, day = dayKey()): RawSessionTokenStats | undefined {
  return db.prepare(`
    SELECT workspace_id AS sessionId, input_tokens AS inputTokens, output_tokens AS outputTokens,
           cache_read_tokens AS cacheReadTokens, cache_write_tokens AS cacheWriteTokens,
           turn_count AS turnCount, total_cost AS totalCost, updated_at AS updatedAt
    FROM token_usage_daily_stats
    WHERE workspace_id = ? AND day = ?
  `).get(workspaceId, day) as unknown as RawSessionTokenStats | undefined;
}

// ---- memory usage / feedback ----

function mapMemoryUsageStats(row: MemoryUsageStats): MemoryUsageStats {
  return {
    ...row,
    lastUsedAt: row.lastUsedAt ?? null,
    usedCount: row.usedCount ?? 0,
    positiveSignals: row.positiveSignals ?? 0,
    negativeSignals: row.negativeSignals ?? 0,
    staleAfterDays: row.staleAfterDays ?? 90,
  };
}

export function listMemoryUsageStats(workspaceId: string): MemoryUsageStats[] {
  const rows = db.prepare(`
    SELECT workspace_id AS workspaceId, source_kind AS sourceKind, source_id AS sourceId,
           used_count AS usedCount, last_used_at AS lastUsedAt,
           positive_signals AS positiveSignals, negative_signals AS negativeSignals,
           stale_after_days AS staleAfterDays, updated_at AS updatedAt
    FROM memory_usage_stats
    WHERE workspace_id = ?
    ORDER BY updated_at DESC
  `).all(workspaceId) as unknown as MemoryUsageStats[];
  return rows.map(mapMemoryUsageStats);
}

export function getMemoryUsageStats(workspaceId: string, sourceKind: MemorySourceKind, sourceId = "*"): MemoryUsageStats | null {
  const row = db.prepare(`
    SELECT workspace_id AS workspaceId, source_kind AS sourceKind, source_id AS sourceId,
           used_count AS usedCount, last_used_at AS lastUsedAt,
           positive_signals AS positiveSignals, negative_signals AS negativeSignals,
           stale_after_days AS staleAfterDays, updated_at AS updatedAt
    FROM memory_usage_stats
    WHERE workspace_id = ? AND source_kind = ? AND source_id = ?
  `).get(workspaceId, sourceKind, sourceId) as unknown as MemoryUsageStats | undefined;
  return row ? mapMemoryUsageStats(row) : null;
}

function ensureMemoryUsageStats(workspaceId: string, sourceKind: MemorySourceKind, sourceId = "*"): MemoryUsageStats {
  const existing = getMemoryUsageStats(workspaceId, sourceKind, sourceId);
  if (existing) return existing;
  const now = Date.now();
  db.prepare(`
    INSERT INTO memory_usage_stats
      (workspace_id, source_kind, source_id, used_count, last_used_at, positive_signals, negative_signals, stale_after_days, updated_at)
    VALUES (?, ?, ?, 0, NULL, 0, 0, 90, ?)
  `).run(workspaceId, sourceKind, sourceId, now);
  return {
    workspaceId,
    sourceKind,
    sourceId,
    usedCount: 0,
    lastUsedAt: null,
    positiveSignals: 0,
    negativeSignals: 0,
    staleAfterDays: 90,
    updatedAt: now,
  };
}

export function recordMemorySourceUsed(workspaceId: string, sourceKind: MemorySourceKind, sourceId = "*", usedAt = Date.now()): MemoryUsageStats {
  ensureMemoryUsageStats(workspaceId, sourceKind, sourceId);
  db.prepare(`
    UPDATE memory_usage_stats
    SET used_count = used_count + 1, last_used_at = ?, updated_at = ?
    WHERE workspace_id = ? AND source_kind = ? AND source_id = ?
  `).run(usedAt, usedAt, workspaceId, sourceKind, sourceId);
  return getMemoryUsageStats(workspaceId, sourceKind, sourceId) as MemoryUsageStats;
}

export function recordMemoryInjectionUsage(workspaceId: string, snapshot: MemoryInjectionSnapshot, usedAt = Date.now()): void {
  for (const source of snapshot.sources) {
    if (!source.injected) continue;
    recordMemorySourceUsed(workspaceId, source.kind, "*", usedAt);
    for (const itemId of source.itemIds ?? []) {
      recordMemorySourceUsed(workspaceId, source.kind, itemId, usedAt);
    }
  }
}

export function recordMemoryFeedback(workspaceId: string, sourceKind: MemorySourceKind, signal: "positive" | "negative", sourceId = "*"): MemoryUsageStats {
  ensureMemoryUsageStats(workspaceId, sourceKind, sourceId);
  const now = Date.now();
  const column = signal === "positive" ? "positive_signals" : "negative_signals";
  db.prepare(`
    UPDATE memory_usage_stats
    SET ${column} = ${column} + 1, updated_at = ?
    WHERE workspace_id = ? AND source_kind = ? AND source_id = ?
  `).run(now, workspaceId, sourceKind, sourceId);
  return getMemoryUsageStats(workspaceId, sourceKind, sourceId) as MemoryUsageStats;
}

export function createMemoryFailureAttribution(input: {
  workspaceId: string;
  targetKind: string;
  targetId: string;
  cause: MemoryFailureAttribution["cause"];
  sourceKind?: MemorySourceKind | null;
  sourceId?: string | null;
  note?: string;
}): MemoryFailureAttribution {
  const id = randomUUID();
  const createdAt = Date.now();
  db.prepare(`
    INSERT INTO memory_failure_attributions
      (id, workspace_id, target_kind, target_id, cause, source_kind, source_id, note, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    input.workspaceId,
    input.targetKind,
    input.targetId,
    input.cause,
    input.sourceKind ?? null,
    input.sourceId ?? null,
    input.note ?? "",
    createdAt,
  );
  if (input.sourceKind) recordMemoryFeedback(input.workspaceId, input.sourceKind, "negative", input.sourceId ?? "*");
  return {
    id,
    workspaceId: input.workspaceId,
    targetKind: input.targetKind,
    targetId: input.targetId,
    cause: input.cause,
    sourceKind: input.sourceKind ?? null,
    sourceId: input.sourceId ?? null,
    note: input.note ?? "",
    createdAt,
  };
}

export function listMemoryFailureAttributions(workspaceId: string, targetKind?: string, targetId?: string): MemoryFailureAttribution[] {
  const rows = targetKind && targetId
    ? db.prepare(`
      SELECT id, workspace_id AS workspaceId, target_kind AS targetKind, target_id AS targetId,
             cause, source_kind AS sourceKind, source_id AS sourceId, note, created_at AS createdAt
      FROM memory_failure_attributions
      WHERE workspace_id = ? AND target_kind = ? AND target_id = ?
      ORDER BY created_at DESC
    `).all(workspaceId, targetKind, targetId)
    : db.prepare(`
      SELECT id, workspace_id AS workspaceId, target_kind AS targetKind, target_id AS targetId,
             cause, source_kind AS sourceKind, source_id AS sourceId, note, created_at AS createdAt
      FROM memory_failure_attributions
      WHERE workspace_id = ?
      ORDER BY created_at DESC
    `).all(workspaceId);
  return rows as unknown as MemoryFailureAttribution[];
}

// ---- memory proposals ----

export interface RuleMemoryProposalInput {
  workspaceId: string;
  title: string;
  evidence: string;
  severity: RuleMemory["severity"];
  scope: RuleMemory["scope"];
  sourceEventIds?: string[];
}

function detectMemoryProposalRisk(input: Pick<RuleMemoryProposalInput, "title" | "evidence" | "sourceEventIds">): { confidence: number; riskFlags: MemoryProposalRiskFlag[] } {
  const text = `${input.title}\n${input.evidence}`;
  const riskFlags: MemoryProposalRiskFlag[] = [];
  if (/(ignore|disregard|override).{0,30}(previous|above|system|developer|instruction)|jailbreak|system prompt|developer message|忽略.{0,12}(以上|之前|系统|规则)|无视.{0,12}(以上|之前|系统|规则)|覆盖.{0,12}(系统|规则|指令)/i.test(text)) {
    riskFlags.push({ code: "instruction_injection", severity: "high", message: "疑似包含覆盖系统/开发者指令或 jailbreak 内容" });
  }
  if (/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i.test(text) || /\b1[3-9]\d{9}\b/.test(text) || /\b\d{17}[\dXx]\b/.test(text)) {
    riskFlags.push({ code: "pii", severity: "high", message: "疑似包含 email、手机号或身份证号等 PII" });
  }
  if (input.evidence.trim().length < 12 || (input.sourceEventIds ?? []).length === 0) {
    riskFlags.push({ code: "weak_evidence", severity: "medium", message: "证据不足，缺少可追溯 trace event 或 evidence 过短" });
  }
  if (input.title.trim().length < 6 || /^(注意|优化|改进|提升|处理|分析|遵守)$/.test(input.title.trim())) {
    riskFlags.push({ code: "overbroad", severity: "medium", message: "规则标题过宽泛，可能污染后续 prompt" });
  }
  const penalty = riskFlags.reduce((sum, flag) => sum + (flag.severity === "high" ? 0.45 : flag.severity === "medium" ? 0.2 : 0.1), 0);
  return { confidence: Math.max(0, Math.min(1, 0.85 - penalty)), riskFlags };
}

function mapMemoryProposal(row: Omit<MemoryProposal, "sourceEventIds" | "riskFlags"> & { sourceEventIds: string; riskFlags: string }): MemoryProposal {
  let sourceEventIds: string[] = [];
  let riskFlags: MemoryProposalRiskFlag[] = [];
  try {
    const parsed = JSON.parse(row.sourceEventIds) as unknown;
    sourceEventIds = Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    sourceEventIds = [];
  }
  try {
    const parsed = JSON.parse(row.riskFlags) as unknown;
    riskFlags = Array.isArray(parsed) ? parsed as MemoryProposalRiskFlag[] : [];
  } catch {
    riskFlags = [];
  }
  return { ...row, sourceEventIds, riskFlags };
}

export function createRuleMemoryProposal(input: RuleMemoryProposalInput): MemoryProposal {
  const now = Date.now();
  const id = randomUUID();
  const sourceEventIds = input.sourceEventIds ?? [];
  const { confidence, riskFlags } = detectMemoryProposalRisk({ title: input.title, evidence: input.evidence, sourceEventIds });
  db.prepare(`
    INSERT INTO memory_proposals
      (id, workspace_id, kind, title, evidence, source, severity, scope, source_event_ids, confidence, risk_flags, status, created_at, updated_at)
    VALUES (?, ?, 'rule', ?, ?, 'trace', ?, ?, ?, ?, ?, 'pending', ?, ?)
  `).run(
    id,
    input.workspaceId,
    input.title,
    input.evidence,
    input.severity,
    input.scope,
    JSON.stringify(sourceEventIds),
    confidence,
    JSON.stringify(riskFlags),
    now,
    now,
  );
  return {
    id,
    workspaceId: input.workspaceId,
    kind: "rule",
    title: input.title,
    evidence: input.evidence,
    source: "trace",
    severity: input.severity,
    scope: input.scope,
    sourceEventIds,
    confidence,
    riskFlags,
    status: "pending",
    rejectionReason: "",
    approvedRuleId: null,
    createdAt: now,
    updatedAt: now,
  };
}

export function listMemoryProposals(workspaceId: string, status?: MemoryProposalStatus): MemoryProposal[] {
  const rows = (status
    ? db.prepare(`
      SELECT id, workspace_id AS workspaceId, kind, title, evidence, source, severity, scope,
             source_event_ids AS sourceEventIds, confidence, risk_flags AS riskFlags, status,
             rejection_reason AS rejectionReason, approved_rule_id AS approvedRuleId,
             created_at AS createdAt, updated_at AS updatedAt
      FROM memory_proposals WHERE workspace_id = ? AND status = ? ORDER BY updated_at DESC
    `).all(workspaceId, status)
    : db.prepare(`
      SELECT id, workspace_id AS workspaceId, kind, title, evidence, source, severity, scope,
             source_event_ids AS sourceEventIds, confidence, risk_flags AS riskFlags, status,
             rejection_reason AS rejectionReason, approved_rule_id AS approvedRuleId,
             created_at AS createdAt, updated_at AS updatedAt
      FROM memory_proposals WHERE workspace_id = ? ORDER BY updated_at DESC
    `).all(workspaceId)) as unknown as Array<Omit<MemoryProposal, "sourceEventIds" | "riskFlags"> & { sourceEventIds: string; riskFlags: string }>;
  return rows.map(mapMemoryProposal);
}

export function getMemoryProposal(id: string): MemoryProposal | undefined {
  const row = db.prepare(`
    SELECT id, workspace_id AS workspaceId, kind, title, evidence, source, severity, scope,
           source_event_ids AS sourceEventIds, confidence, risk_flags AS riskFlags, status,
           rejection_reason AS rejectionReason, approved_rule_id AS approvedRuleId,
           created_at AS createdAt, updated_at AS updatedAt
    FROM memory_proposals WHERE id = ?
  `).get(id) as unknown as (Omit<MemoryProposal, "sourceEventIds" | "riskFlags"> & { sourceEventIds: string; riskFlags: string }) | undefined;
  return row ? mapMemoryProposal(row) : undefined;
}

export function approveMemoryProposal(id: string): CreateRuleResult {
  const proposal = getMemoryProposal(id);
  if (!proposal) throw new Error("memory proposal not found");
  if (proposal.status !== "pending") throw new Error("memory proposal is not pending");
  if (proposal.riskFlags.some((flag) => flag.severity === "high")) throw new Error("memory proposal has high-risk guardrail flags");
  const result = createRuleMemory({
    workspaceId: proposal.workspaceId,
    title: proposal.title,
    evidence: proposal.evidence,
    source: "trace",
    severity: proposal.severity,
    scope: proposal.scope,
  });
  db.prepare("UPDATE memory_proposals SET status = 'approved', approved_rule_id = ?, updated_at = ? WHERE id = ?")
    .run(result.rule.id, Date.now(), id);
  return result;
}

export function rejectMemoryProposal(id: string, reason: string): void {
  const proposal = getMemoryProposal(id);
  if (!proposal) throw new Error("memory proposal not found");
  if (proposal.status !== "pending") throw new Error("memory proposal is not pending");
  db.prepare("UPDATE memory_proposals SET status = 'rejected', rejection_reason = ?, updated_at = ? WHERE id = ?")
    .run(reason, Date.now(), id);
}

// ---- rule memories ----

function mapRuleMemory(row: Omit<RuleMemory, "enabled"> & { enabled: number }): RuleMemory {
  return {
    ...row,
    scope: row.scope ?? "global",
    enabled: Boolean(row.enabled),
    version: row.version ?? 1,
    supersedesRuleId: row.supersedesRuleId ?? null,
    changeReason: row.changeReason ?? "",
  };
}

// 全局池：返回所有工作区的规则定义（共享单实例）。"本工作区是否启用" 见 enablement 表。
export function listRuleMemories(_workspaceId?: string): RuleMemory[] {
  const rows = db.prepare(`
    SELECT id, workspace_id AS workspaceId, title, evidence, source, severity, scope, enabled,
           version, supersedes_rule_id AS supersedesRuleId, change_reason AS changeReason,
           created_at AS createdAt, updated_at AS updatedAt
    FROM rule_memories ORDER BY updated_at DESC
  `).all() as unknown as Array<Omit<RuleMemory, "enabled"> & { enabled: number }>;
  return rows.map(mapRuleMemory);
}

export function createRuleMemory(input: {
  workspaceId: string;
  title: string;
  evidence: string;
  source: RuleMemory["source"];
  severity: RuleMemory["severity"];
  scope: RuleMemory["scope"];
}): CreateRuleResult {
  const existing = db.prepare(`
    SELECT id, workspace_id AS workspaceId, title, evidence, source, severity, scope, enabled,
           version, supersedes_rule_id AS supersedesRuleId, change_reason AS changeReason,
           created_at AS createdAt, updated_at AS updatedAt
    FROM rule_memories WHERE workspace_id = ? AND title = ? LIMIT 1
  `).get(input.workspaceId, input.title) as unknown as (Omit<RuleMemory, "enabled"> & { enabled: number }) | undefined;
  if (existing) return { rule: mapRuleMemory(existing), created: false };
  const id = randomUUID();
  const now = Date.now();
  db.prepare(`
    INSERT INTO rule_memories (id, workspace_id, title, evidence, source, severity, scope, enabled, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
  `).run(id, input.workspaceId, input.title, input.evidence, input.source, input.severity, input.scope, now, now);
  enableForOrigin(input.workspaceId, "rule", id); // 新池条目：origin 工作区默认启用
  return { rule: { id, workspaceId: input.workspaceId, title: input.title, evidence: input.evidence, source: input.source, severity: input.severity, scope: input.scope, enabled: true, version: 1, supersedesRuleId: null, changeReason: "", createdAt: now, updatedAt: now }, created: true };
}

export function updateRuleMemory(input: {
  id: string;
  title: string;
  evidence: string;
  severity: RuleMemory["severity"];
  scope: RuleMemory["scope"];
}): void {
  db.prepare("UPDATE rule_memories SET title = ?, evidence = ?, severity = ?, scope = ?, version = version + 1, change_reason = 'manual update', updated_at = ? WHERE id = ?")
    .run(input.title, input.evidence, input.severity, input.scope, Date.now(), input.id);
}

export function deleteRuleMemory(id: string): void {
  db.prepare("DELETE FROM rule_memories WHERE id = ?").run(id);
}

function normalizeRuleText(value: string): string {
  return value.toLowerCase().replace(/[^\p{L}\p{N}\u4e00-\u9fa5]+/gu, "");
}

function detectRuleConflictReason(a: RuleMemory, b: RuleMemory): { reason: string; severity: RuleConflict["severity"] } | null {
  const aText = `${a.title} ${a.evidence}`;
  const bText = `${b.title} ${b.evidence}`;
  const normalizedA = normalizeRuleText(a.title);
  const normalizedB = normalizeRuleText(b.title);
  const sameTopic = normalizedA && normalizedB && (normalizedA.includes(normalizedB) || normalizedB.includes(normalizedA) || normalizedA.slice(0, 8) === normalizedB.slice(0, 8));
  const aNegative = /(禁止|不要|不得|避免|不能|不应|disable|never|must not)/i.test(aText);
  const bNegative = /(禁止|不要|不得|避免|不能|不应|disable|never|must not)/i.test(bText);
  const aPositive = /(必须|需要|应当|优先|启用|使用|must|should|enable|always)/i.test(aText);
  const bPositive = /(必须|需要|应当|优先|启用|使用|must|should|enable|always)/i.test(bText);
  if (sameTopic && aNegative !== bNegative && (aPositive || bPositive)) {
    return { reason: "同一主题下存在禁止/必须方向冲突", severity: "high" };
  }
  if (sameTopic && a.severity !== b.severity) {
    return { reason: "同一主题下 severity 不一致，需确认是否为版本替代关系", severity: "medium" };
  }
  return null;
}

function mapRuleConflict(row: RuleConflict): RuleConflict {
  return row;
}

export function detectRuleConflicts(workspaceId: string): RuleConflict[] {
  const ids = enabledIds(workspaceId, "rule");
  const rules = listRuleMemories().filter((rule) => ids.has(rule.id));
  const now = Date.now();
  const insert = db.prepare(`
    INSERT OR IGNORE INTO rule_conflicts
      (id, workspace_id, rule_a_id, rule_b_id, reason, severity, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, 'open', ?, ?)
  `);
  for (let i = 0; i < rules.length; i++) {
    for (let j = i + 1; j < rules.length; j++) {
      const a = rules[i];
      const b = rules[j];
      if (!a || !b) continue;
      const conflict = detectRuleConflictReason(a, b);
      if (!conflict) continue;
      const [ruleAId, ruleBId] = [a.id, b.id].sort() as [string, string];
      insert.run(randomUUID(), workspaceId, ruleAId, ruleBId, conflict.reason, conflict.severity, now, now);
    }
  }
  return listRuleConflicts(workspaceId, "open");
}

export function listRuleConflicts(workspaceId: string, status?: RuleConflict["status"]): RuleConflict[] {
  const rows = (status
    ? db.prepare(`
      SELECT id, workspace_id AS workspaceId, rule_a_id AS ruleAId, rule_b_id AS ruleBId,
             reason, severity, status, created_at AS createdAt, updated_at AS updatedAt
      FROM rule_conflicts WHERE workspace_id = ? AND status = ? ORDER BY updated_at DESC
    `).all(workspaceId, status)
    : db.prepare(`
      SELECT id, workspace_id AS workspaceId, rule_a_id AS ruleAId, rule_b_id AS ruleBId,
             reason, severity, status, created_at AS createdAt, updated_at AS updatedAt
      FROM rule_conflicts WHERE workspace_id = ? ORDER BY updated_at DESC
    `).all(workspaceId)) as unknown as RuleConflict[];
  return rows.map(mapRuleConflict);
}

export function updateRuleConflictStatus(id: string, status: RuleConflict["status"]): void {
  db.prepare("UPDATE rule_conflicts SET status = ?, updated_at = ? WHERE id = ?").run(status, Date.now(), id);
}

export function buildEnabledRulesPrompt(workspaceId: string, targetScope?: "chat" | "workflow"): { prompt: string; count: number; updatedAt: number | null } {
  const ids = enabledIds(workspaceId, "rule");
  const enabledRules = listRuleMemories().filter((rule) => ids.has(rule.id) && (!targetScope || rule.scope === "global" || rule.scope === targetScope));
  if (enabledRules.length === 0) return { prompt: "", count: 0, updatedAt: null };
  return {
    prompt: [
      "<xanthil-rules>",
      "以下规则来自 pi-xanthil 规则记忆，请在执行任务时遵守：",
      ...enabledRules.map((rule, index) => `${index + 1}. ${rule.title}\n   - evidence: ${rule.evidence || "manual"}\n   - severity: ${rule.severity}\n   - scope: ${rule.scope}`),
      "</xanthil-rules>",
    ].join("\n"),
    count: enabledRules.length,
    updatedAt: Math.max(...enabledRules.map((rule) => rule.updatedAt)),
  };
}

// ---- analysis standards (指标体系) ----

function mapAnalysisStandard(row: Omit<AnalysisStandard, "enabled"> & { enabled: number }): AnalysisStandard {
  return { ...row, enabled: Boolean(row.enabled) };
}

const ANALYSIS_STANDARD_COLUMNS = `
  id, workspace_id AS workspaceId, kind, name, category, description,
  formula, caliber, unit, file_path AS filePath, file_hash AS fileHash,
  enabled, created_at AS createdAt, updated_at AS updatedAt
`;

// 全局池：返回所有工作区的标准定义。"本工作区是否启用" 见 enablement 表(kind='standard')。
export function listAnalysisStandards(_workspaceId?: string): AnalysisStandard[] {
  const rows = db.prepare(`
    SELECT ${ANALYSIS_STANDARD_COLUMNS}
    FROM analysis_standards ORDER BY updated_at DESC
  `).all() as unknown as Array<Omit<AnalysisStandard, "enabled"> & { enabled: number }>;
  return rows.map(mapAnalysisStandard);
}

export interface AnalysisStandardInput {
  kind: AnalysisStandardKind;
  name: string;
  category: string;
  description: string;
  formula: string;
  caliber: string;
  unit: string;
  filePath: string;
  fileHash: string | null;
}

export function createAnalysisStandard(workspaceId: string, input: AnalysisStandardInput): AnalysisStandard {
  const id = randomUUID();
  const now = Date.now();
  db.prepare(`
    INSERT INTO analysis_standards
      (id, workspace_id, kind, name, category, description, formula, caliber, unit, file_path, file_hash, enabled, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
  `).run(
    id, workspaceId, input.kind, input.name, input.category, input.description,
    input.formula, input.caliber, input.unit, input.filePath, input.fileHash, now, now,
  );
  enableForOrigin(workspaceId, "standard", id); // 新池条目：origin 工作区默认启用
  return { id, workspaceId, ...input, enabled: true, createdAt: now, updatedAt: now };
}

export function updateAnalysisStandard(id: string, input: AnalysisStandardInput): void {
  db.prepare(`
    UPDATE analysis_standards
    SET kind = ?, name = ?, category = ?, description = ?, formula = ?, caliber = ?, unit = ?, file_path = ?, file_hash = ?, updated_at = ?
    WHERE id = ?
  `).run(
    input.kind, input.name, input.category, input.description,
    input.formula, input.caliber, input.unit, input.filePath, input.fileHash, Date.now(), id,
  );
}

export function deleteAnalysisStandard(id: string): void {
  db.prepare("DELETE FROM analysis_standards WHERE id = ?").run(id);
}

/**
 * metric 真源 = metric_definitions（P2b' 完全切源）。db.ts 内裸查避免 base→slot 循环依赖。
 */
export function listEnabledMetricDefinitions(workspaceId: string): MetricDefinition[] {
  // 全局池 + 本工作区启用(kind='metric')：从池里筛出本工作区已启用的指标。
  const ids = enabledIds(workspaceId, "metric");
  const rows = db.prepare(
    "SELECT id, workspace_id AS workspaceId, name, category, description, formula, caliber, unit, object_type_id AS objectTypeId, bound_columns AS boundColumns, enabled, created_at AS createdAt, updated_at AS updatedAt FROM metric_definitions ORDER BY category, name"
  ).all() as unknown as Array<Omit<MetricDefinition, "enabled" | "boundColumns" | "objectTypeId"> & { enabled: number; boundColumns: string | null; objectTypeId: string | null }>;
  return rows.filter((r) => ids.has(r.id)).map((r) => ({
    ...r,
    objectTypeId: r.objectTypeId ?? undefined,
    boundColumns: r.boundColumns ? (JSON.parse(r.boundColumns) as string[]) : undefined,
    enabled: Boolean(r.enabled),
  }));
}

export function buildEnabledStandardsPrompt(workspaceId: string): { prompt: string; count: number; updatedAt: number | null } {
  const metrics = listEnabledMetricDefinitions(workspaceId);
  const sids = enabledIds(workspaceId, "standard");
  const files = listAnalysisStandards().filter((s) => sids.has(s.id) && s.kind === "reference_file");
  if (metrics.length === 0 && files.length === 0) return { prompt: "", count: 0, updatedAt: null };

  const lines: string[] = ["<xanthil-standards>", "以下为本工作区的分析标准与口径，分析时须严格遵守："];

  if (metrics.length > 0) {
    lines.push("", "[指标口径]");
    metrics.forEach((m, i) => {
      const head = [m.name, m.category && `[${m.category}]`, m.unit && `单位:${m.unit}`].filter(Boolean).join(" ");
      lines.push(`${i + 1}. ${head}`);
      if (m.description) lines.push(`   - 含义: ${m.description}`);
      if (m.formula) lines.push(`   - 公式: ${m.formula}`);
      if (m.caliber) lines.push(`   - 口径: ${m.caliber}`);
    });
  }

  if (files.length > 0) {
    lines.push(
      "",
      "[参照标准文件]",
      "以下文件为业务标准参照资料（非用户隐私原始数据），可使用工具读取其内容用于分析：",
    );
    files.forEach((f, i) => {
      const head = [f.name, f.category && `[${f.category}]`].filter(Boolean).join(" ");
      lines.push(`${i + 1}. ${head}`);
      if (f.filePath) lines.push(`   - 路径: ${f.filePath}`);
      if (f.description) lines.push(`   - 用途: ${f.description}`);
    });
  }

  lines.push("</xanthil-standards>");
  const all = [...metrics, ...files];
  return {
    prompt: lines.join("\n"),
    count: all.length,
    updatedAt: Math.max(...all.map((s) => s.updatedAt)),
  };
}

// ---- business context (业务环境) ----

const BUSINESS_CONTEXT_LABELS: Record<BusinessContextCategory, string> = {
  org: "组织/主体",
  status: "业务现状",
  glossary: "术语/口径",
  constraint: "约束/红线",
  history: "历史/背景",
  goal: "目标/期望",
};

function mapBusinessContext(row: Omit<BusinessContext, "enabled"> & { enabled: number }): BusinessContext {
  return { ...row, enabled: Boolean(row.enabled) };
}

// 全局池：返回所有工作区的业务环境定义。"本工作区是否启用" 见 enablement 表(kind='business_context')。
export function listBusinessContexts(_workspaceId?: string): BusinessContext[] {
  const rows = db.prepare(`
    SELECT id, workspace_id AS workspaceId, category, title, content, enabled, created_at AS createdAt, updated_at AS updatedAt
    FROM business_contexts ORDER BY updated_at DESC
  `).all() as unknown as Array<Omit<BusinessContext, "enabled"> & { enabled: number }>;
  return rows.map(mapBusinessContext);
}

export interface BusinessContextInput {
  category: BusinessContextCategory;
  title: string;
  content: string;
}

export function createBusinessContext(workspaceId: string, input: BusinessContextInput): BusinessContext {
  const id = randomUUID();
  const now = Date.now();
  db.prepare(`
    INSERT INTO business_contexts (id, workspace_id, category, title, content, enabled, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, 1, ?, ?)
  `).run(id, workspaceId, input.category, input.title, input.content, now, now);
  enableForOrigin(workspaceId, "business_context", id); // 新池条目：origin 工作区默认启用
  return { id, workspaceId, ...input, enabled: true, createdAt: now, updatedAt: now };
}

export function updateBusinessContext(id: string, input: BusinessContextInput): void {
  db.prepare("UPDATE business_contexts SET category = ?, title = ?, content = ?, updated_at = ? WHERE id = ?")
    .run(input.category, input.title, input.content, Date.now(), id);
}

export function deleteBusinessContext(id: string): void {
  db.prepare("DELETE FROM business_contexts WHERE id = ?").run(id);
}

export function buildEnabledBusinessContextPrompt(workspaceId: string): { prompt: string; count: number; updatedAt: number | null } {
  const ids = enabledIds(workspaceId, "business_context");
  const enabled = listBusinessContexts().filter((c) => ids.has(c.id));
  if (enabled.length === 0) return { prompt: "", count: 0, updatedAt: null };

  const order: BusinessContextCategory[] = ["org", "status", "glossary", "constraint", "history", "goal"];
  const lines: string[] = [
    "<xanthil-business-context>",
    "以下是当前业务的真实背景。做任何分析、判断与决策前都必须纳入考虑，不得凭空假设：",
  ];
  for (const category of order) {
    const items = enabled.filter((c) => c.category === category);
    if (items.length === 0) continue;
    lines.push("", `[${BUSINESS_CONTEXT_LABELS[category]}]`);
    items.forEach((item) => {
      lines.push(`- ${item.title}${item.content ? `：${item.content}` : ""}`);
    });
  }
  lines.push("</xanthil-business-context>");
  return {
    prompt: lines.join("\n"),
    count: enabled.length,
    updatedAt: Math.max(...enabled.map((c) => c.updatedAt)),
  };
}

// ---- analysis cases (分析案例库) ----

function mapAnalysisCase(row: Omit<AnalysisCase, "enabled"> & { enabled: number }): AnalysisCase {
  return { ...row, enabled: Boolean(row.enabled) };
}

// 全局池：返回所有工作区的项目记忆定义。"本工作区是否启用" 见 enablement 表(kind='case')。
export function listAnalysisCases(_workspaceId?: string): AnalysisCase[] {
  const rows = db.prepare(`
    SELECT id, workspace_id AS workspaceId, title, category, scenario, approach, conclusion, enabled, created_at AS createdAt, updated_at AS updatedAt
    FROM analysis_cases ORDER BY updated_at DESC
  `).all() as unknown as Array<Omit<AnalysisCase, "enabled"> & { enabled: number }>;
  return rows.map(mapAnalysisCase);
}

export function createAnalysisCase(workspaceId: string, input: AnalysisCaseInput): AnalysisCase {
  const id = randomUUID();
  const now = Date.now();
  db.prepare(
    "INSERT INTO analysis_cases (id, workspace_id, title, category, scenario, approach, conclusion, enabled, created_at, updated_at) VALUES (?,?,?,?,?,?,?,1,?,?)"
  ).run(id, workspaceId, input.title, input.category, input.scenario, input.approach, input.conclusion, now, now);
  enableForOrigin(workspaceId, "case", id); // 新池条目：origin 工作区默认启用
  return { id, workspaceId, ...input, enabled: true, createdAt: now, updatedAt: now };
}

export function updateAnalysisCase(id: string, input: AnalysisCaseInput): void {
  db.prepare(
    "UPDATE analysis_cases SET title=?, category=?, scenario=?, approach=?, conclusion=?, updated_at=? WHERE id=?"
  ).run(input.title, input.category, input.scenario, input.approach, input.conclusion, Date.now(), id);
}

export function deleteAnalysisCase(id: string): void {
  db.prepare("DELETE FROM analysis_cases WHERE id=?").run(id);
}

export function buildEnabledCasesPrompt(workspaceId: string): { prompt: string; count: number; updatedAt: number | null } {
  const ids = enabledIds(workspaceId, "case");
  const enabled = listAnalysisCases().filter((c) => ids.has(c.id));
  if (enabled.length === 0) return { prompt: "", count: 0, updatedAt: null };
  const blocks = enabled.map((c) =>
    [
      `[案例：${c.title}${c.category ? `（${c.category}）` : ""}]`,
      c.scenario ? `场景：${c.scenario}` : null,
      c.approach ? `分析思路：${c.approach}` : null,
      c.conclusion ? `结论格式：${c.conclusion}` : null,
    ].filter(Boolean).join("\n")
  ).join("\n\n");
  return {
    prompt: `<xanthil-cases>\n以下是已验证的分析案例，可作为 few-shot 参考，复用其中的分析框架和结论格式：\n\n${blocks}\n</xanthil-cases>`,
    count: enabled.length,
    updatedAt: Math.max(...enabled.map((c) => c.updatedAt)),
  };
}

// ---- AnaX hypothesis library (归档飞轮) ----

const HYPOTHESIS_VERDICT_LABELS: Record<HypothesisEntry["verdict"], string> = {
  confirmed: "✅ 成立",
  rejected: "❌ 不成立",
  partial: "⚠️ 部分成立",
};

type HypothesisRow = Omit<HypothesisEntry, "enabled"> & { enabled: number };

function mapHypothesis(row: HypothesisRow): HypothesisEntry {
  return {
    ...row,
    enabled: Boolean(row.enabled),
    confirmCount: row.confirmCount ?? 0,
    rejectCount: row.rejectCount ?? 0,
    partialCount: row.partialCount ?? 0,
  };
}

export function listHypotheses(workspaceId: string): HypothesisEntry[] {
  const rows = db.prepare(`
    SELECT id, workspace_id AS workspaceId, scene, hypothesis, verdict, evidence, impact, source, enabled,
           confirm_count AS confirmCount, reject_count AS rejectCount, partial_count AS partialCount,
           created_at AS createdAt, updated_at AS updatedAt
    FROM hypothesis_library WHERE workspace_id = ? ORDER BY updated_at DESC
  `).all(workspaceId) as unknown as HypothesisRow[];
  return rows.map(mapHypothesis);
}

export function createHypothesis(workspaceId: string, input: HypothesisEntryInput, source: HypothesisEntry["source"] = "manual"): HypothesisEntry {
  const id = randomUUID();
  const now = Date.now();
  db.prepare(`
    INSERT INTO hypothesis_library (id, workspace_id, scene, hypothesis, verdict, evidence, impact, source, enabled, confirm_count, reject_count, partial_count, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, 0, 0, 0, ?, ?)
  `).run(id, workspaceId, input.scene, input.hypothesis, input.verdict, input.evidence, input.impact, source, now, now);
  return { id, workspaceId, ...input, source, enabled: true, confirmCount: 0, rejectCount: 0, partialCount: 0, createdAt: now, updatedAt: now };
}

/**
 * Upsert a hypothesis from an archive flywheel run.
 * If an entry with the same (workspace, scene, hypothesis) already exists,
 * increments the corresponding verdict counter and updates the latest verdict/evidence.
 * Otherwise creates a new entry with an initial count of 1.
 */
export function upsertHypothesisFromArchive(workspaceId: string, input: HypothesisEntryInput): void {
  const existing = db.prepare(
    "SELECT id FROM hypothesis_library WHERE workspace_id = ? AND lower(trim(scene)) = lower(trim(?)) AND lower(trim(hypothesis)) = lower(trim(?)) LIMIT 1"
  ).get(workspaceId, input.scene, input.hypothesis) as { id: string } | undefined;

  const now = Date.now();
  if (existing) {
    const countCol = input.verdict === "confirmed" ? "confirm_count" : input.verdict === "rejected" ? "reject_count" : "partial_count";
    db.prepare(`UPDATE hypothesis_library SET verdict = ?, evidence = ?, impact = ?, ${countCol} = ${countCol} + 1, updated_at = ? WHERE id = ?`)
      .run(input.verdict, input.evidence || "", input.impact || "", now, existing.id);
  } else {
    const id = randomUUID();
    const confirmCount = input.verdict === "confirmed" ? 1 : 0;
    const rejectCount = input.verdict === "rejected" ? 1 : 0;
    const partialCount = input.verdict === "partial" ? 1 : 0;
    db.prepare(`
      INSERT INTO hypothesis_library (id, workspace_id, scene, hypothesis, verdict, evidence, impact, source, enabled, confirm_count, reject_count, partial_count, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'archive', 1, ?, ?, ?, ?, ?)
    `).run(id, workspaceId, input.scene, input.hypothesis, input.verdict, input.evidence || "", input.impact || "", confirmCount, rejectCount, partialCount, now, now);
  }
}

export function updateHypothesisEnabled(id: string, enabled: boolean): void {
  db.prepare("UPDATE hypothesis_library SET enabled = ?, updated_at = ? WHERE id = ?").run(enabled ? 1 : 0, Date.now(), id);
}

export function deleteHypothesis(id: string): void {
  db.prepare("DELETE FROM hypothesis_library WHERE id = ?").run(id);
}

// ---- hypothesis library context pruning ----

/** Library size below which we skip scoring and inject everything. */
const HYPO_PRUNE_THRESHOLD = 20;
/** Target number of entries to inject when pruning. */
const HYPO_PRUNE_TARGET = 10;

const STOP_TOKENS_ZH = new Set(["的", "了", "在", "是", "有", "和", "与", "或", "但", "因", "为", "以", "从", "到", "个", "该", "这", "那", "其", "此", "之"]);
const STOP_TOKENS_EN = new Set(["a", "the", "is", "in", "of", "to", "and", "or", "for", "by", "at", "an", "be", "it", "on", "as"]);

export function tokenizeQuery(text: string): string[] {
  return text.toLowerCase()
    .split(/[\s\p{P}，。！？、；：""''（）【】「」《》\d]+/u)
    .flatMap((t) => {
      const trimmed = t.trim();
      // For mixed CJK+Latin, also yield 2-gram CJK sub-tokens for short segments
      const cjk = [...trimmed.matchAll(/[一-鿿]{2,}/g)].map((m) => m[0]);
      return [trimmed, ...cjk];
    })
    .filter((t) => t.length >= 2 && !STOP_TOKENS_ZH.has(t) && !STOP_TOKENS_EN.has(t));
}

export function scoreHypothesis(entry: HypothesisEntry, queryTokens: string[]): number {
  const sceneHay = entry.scene.toLowerCase();
  const hypoHay = entry.hypothesis.toLowerCase();
  const evidHay = entry.evidence.toLowerCase();
  // scene matches are weighted 3× — scene relevance is the primary signal.
  // hypothesis matches are 1×; evidence matches 0.5× (supporting detail).
  let keywordScore = 0;
  for (const t of queryTokens) {
    if (sceneHay.includes(t)) keywordScore += 3;
    if (hypoHay.includes(t)) keywordScore += 1;
    if (evidHay.includes(t)) keywordScore += 0.5;
  }
  // Hypotheses confirmed multiple times across runs earn a small boost.
  const trustBonus = (entry.confirmCount ?? 0) * 0.5;
  return keywordScore + trustBonus;
}

/**
 * Build the hypothesis library context block to prepend to AnaX runs.
 *
 * Two-phase filtering when `query` is provided:
 * 1. Scene pre-filter (always runs): compute per-scene token overlap; if any
 *    scene is relevant, drop hypotheses from zero-score scenes. Falls back to
 *    injecting all when no scene matches (prevents empty context).
 * 2. Size-based pruning (only when filtered set > HYPO_PRUNE_THRESHOLD):
 *    score individual entries and keep the top HYPO_PRUNE_TARGET.
 */
export function buildHypothesisLibraryContext(workspaceId: string, query?: string): string {
  const enabled = listHypotheses(workspaceId).filter((h) => h.enabled);
  if (enabled.length === 0) return "";

  let selected = enabled;
  if (query) {
    const tokens = tokenizeQuery(query);
    if (tokens.length > 0) {
      // Phase 1: scene-level pre-filter.
      const sceneScores = new Map<string, number>();
      for (const h of enabled) {
        if (!sceneScores.has(h.scene)) {
          const hay = h.scene.toLowerCase();
          sceneScores.set(h.scene, tokens.filter((t) => hay.includes(t)).length);
        }
      }
      if ([...sceneScores.values()].some((s) => s > 0)) {
        selected = enabled.filter((h) => (sceneScores.get(h.scene) ?? 0) > 0);
      }

      // Phase 2: size-based pruning on the already-filtered set.
      if (selected.length > HYPO_PRUNE_THRESHOLD) {
        const scored = selected
          .map((h) => ({ h, score: scoreHypothesis(h, tokens) }))
          .sort((a, b) => b.score - a.score || (b.h.confirmCount ?? 0) - (a.h.confirmCount ?? 0) || b.h.updatedAt - a.h.updatedAt);

        const taken = new Set<string>();
        const result: HypothesisEntry[] = [];

        // First: entries with any keyword overlap, up to target
        for (const { h, score } of scored) {
          if (result.length >= HYPO_PRUNE_TARGET) break;
          if (score > 0) { result.push(h); taken.add(h.id); }
        }
        // Fill remainder with most-recent unselected entries
        for (const { h } of scored) {
          if (result.length >= HYPO_PRUNE_TARGET) break;
          if (!taken.has(h.id)) { result.push(h); taken.add(h.id); }
        }

        selected = result;
      }
    }
  }

  const byScene = new Map<string, HypothesisEntry[]>();
  for (const h of selected) {
    const arr = byScene.get(h.scene) ?? [];
    if (arr.length === 0) byScene.set(h.scene, arr);
    arr.push(h);
  }
  const lines: string[] = [
    "[历史假设库 — 本工作区过往验证过的假设，规范阶段应优先复用/排除，不要从零重猜]",
  ];
  for (const [scene, items] of byScene) {
    lines.push(`场景「${scene}」：`);
    for (const h of items) {
      const impact = h.impact ? `（影响：${h.impact}）` : "";
      const evidence = h.evidence ? ` — ${h.evidence}` : "";
      const totalRuns = (h.confirmCount ?? 0) + (h.rejectCount ?? 0) + (h.partialCount ?? 0);
      const runBadge = totalRuns >= 2 ? `（${totalRuns}次验证）` : "";
      lines.push(`  - ${HYPOTHESIS_VERDICT_LABELS[h.verdict]}${runBadge} ${h.hypothesis}${impact}${evidence}`);
    }
  }
  if (selected.length < enabled.length) {
    lines.push(`（已按场景相关性筛选，显示 ${selected.length}/${enabled.length} 条；其余可在「假设库」tab 查看）`);
  }
  return lines.join("\n");
}

// ---- trace ----

export function addTraceEvent(input: {
  workspaceId: string;
  targetKind: string;
  targetId: string;
  type: string;
  target: string;
  status: string;
  detail?: string | null;
  payload?: unknown;
}): TraceEvent {
  const id = randomUUID();
  const createdAt = Date.now();
  db.prepare(`
    INSERT INTO trace_events (id, workspace_id, target_kind, target_id, type, target, status, detail, payload, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    input.workspaceId,
    input.targetKind,
    input.targetId,
    input.type,
    input.target,
    input.status,
    input.detail ?? null,
    input.payload === undefined ? null : JSON.stringify(input.payload),
    createdAt,
  );
  return {
    id,
    time: createdAt,
    type: input.type,
    target: input.target,
    targetKind: input.targetKind as TraceEvent["targetKind"],
    targetId: input.targetId,
    status: input.status as TraceEvent["status"],
    detail: input.detail ?? null,
  };
}

export function pruneTraceEvents(workspaceId: string, retainDays: number): number {
  const cutoff = Date.now() - retainDays * 24 * 60 * 60 * 1000;
  return Number(db.prepare("DELETE FROM trace_events WHERE workspace_id = ? AND created_at < ?").run(workspaceId, cutoff).changes);
}

export function pruneAllTraceEvents(retainDays: number): number {
  const cutoff = Date.now() - retainDays * 24 * 60 * 60 * 1000;
  return Number(db.prepare("DELETE FROM trace_events WHERE created_at < ?").run(cutoff).changes);
}

function parseMemoryInjectionSnapshot(payload: string | null): MemoryInjectionSnapshot | null {
  if (!payload) return null;
  try {
    const parsed = JSON.parse(payload) as { memoryInjection?: unknown };
    const snapshot = parsed.memoryInjection;
    if (!snapshot || typeof snapshot !== "object") return null;
    const candidate = snapshot as Partial<MemoryInjectionSnapshot>;
    if (typeof candidate.requested !== "boolean" || typeof candidate.injected !== "boolean") return null;
    if (candidate.targetScope !== "chat" && candidate.targetScope !== "workflow") return null;
    if (!Array.isArray(candidate.sources)) return null;
    return candidate as MemoryInjectionSnapshot;
  } catch {
    return null;
  }
}

export function listMemoryInjectionRecords(workspaceId: string, limit = 50): MemoryInjectionRecord[] {
  const rows = db.prepare(`
    SELECT id, workspace_id AS workspaceId, target_kind AS targetKind, target_id AS targetId,
           target, status, payload, created_at AS createdAt
    FROM trace_events
    WHERE workspace_id = ? AND type = 'run_start' AND payload IS NOT NULL
    ORDER BY created_at DESC
    LIMIT ?
  `).all(workspaceId, Math.max(1, Math.min(200, limit))) as Array<{
    id: string;
    workspaceId: string;
    targetKind: string;
    targetId: string;
    target: string;
    status: string;
    payload: string | null;
    createdAt: number;
  }>;
  return rows.flatMap((row) => {
    const snapshot = parseMemoryInjectionSnapshot(row.payload);
    if (!snapshot) return [];
    return [{
      eventId: row.id,
      workspaceId: row.workspaceId,
      targetKind: row.targetKind,
      targetId: row.targetId,
      target: row.target,
      status: row.status,
      createdAt: row.createdAt,
      snapshot,
    }];
  });
}

function classifyTraceError(text: string | null | undefined, source = ""): TraceErrorType {
  const value = `${source}\n${text ?? ""}`.toLowerCase();
  if (/aborted|abort|cancelled|canceled|stop/.test(value)) return "aborted";
  if (/stream ended|finish_reason|stream.*interrupt|response.*ended/.test(value)) return "stream_interrupt";
  if (/model|enabled|configured|allowed models|not enabled/.test(value)) return "model_config";
  if (/path|required|enoent|no such file|not found|output.*dir|report.*path|file.*missing/.test(value)) return "path_missing";
  if (/upstream|dependency|depends|input.*missing|missing.*input|blackboard|empty result/.test(value)) return "dependency_missing";
  if (/validation|schema|invalid|must be|expected|required/.test(value)) return "validation";
  if (/runtime|context|compaction|compact/.test(value)) return "runtime";
  return "unknown";
}

function startOfToday(): number {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
}

export function getTraceOverview(workspaceId: string): TraceOverview {
  const today = startOfToday();
  const sessionsRow = db.prepare("SELECT COUNT(*) AS count FROM sessions WHERE workspace_id = ? AND created_at >= ?").get(workspaceId, today) as { count: number };
  const runsRow = db.prepare(`
    SELECT
      COUNT(*) AS total,
      SUM(CASE WHEN fr.status = 'running' THEN 1 ELSE 0 END) AS running,
      SUM(CASE WHEN fr.status = 'success' THEN 1 ELSE 0 END) AS success,
      SUM(CASE WHEN fr.status = 'failed' THEN 1 ELSE 0 END) AS failed
    FROM flow_runs fr
    JOIN flows f ON f.id = fr.flow_id
    WHERE f.workspace_id = ? AND fr.started_at >= ?
  `).get(workspaceId, today) as { total: number; running: number | null; success: number | null; failed: number | null };
  const messageErrors = db.prepare(`
    SELECT COUNT(*) AS count
    FROM messages m
    JOIN sessions s ON s.id = m.session_id
    WHERE s.workspace_id = ? AND m.error_message IS NOT NULL AND m.created_at >= ?
  `).get(workspaceId, today) as { count: number };
  const runtimeErrors = db.prepare(`
    SELECT COUNT(*) AS count
    FROM session_runtime sr
    JOIN sessions s ON s.id = sr.session_id
    WHERE s.workspace_id = ? AND sr.status = 'error' AND sr.updated_at >= ?
  `).get(workspaceId, today) as { count: number };
  const traceErrors = db.prepare("SELECT COUNT(*) AS count FROM trace_events WHERE workspace_id = ? AND status = 'failed' AND created_at >= ?").get(workspaceId, today) as { count: number };
  const recent = db.prepare(`
    SELECT MAX(ts) AS recentActivityAt FROM (
      SELECT updated_at AS ts FROM sessions WHERE workspace_id = ?
      UNION ALL
      SELECT f.updated_at AS ts FROM flows f WHERE f.workspace_id = ?
      UNION ALL
      SELECT fr.started_at AS ts FROM flow_runs fr JOIN flows f ON f.id = fr.flow_id WHERE f.workspace_id = ?
      UNION ALL
      SELECT COALESCE(fr.ended_at, fr.started_at) AS ts FROM flow_runs fr JOIN flows f ON f.id = fr.flow_id WHERE f.workspace_id = ?
      UNION ALL
      SELECT created_at AS ts FROM trace_events WHERE workspace_id = ?
    )
  `).get(workspaceId, workspaceId, workspaceId, workspaceId, workspaceId) as { recentActivityAt: number | null };
  return {
    todaySessions: sessionsRow.count,
    todayFlowRuns: runsRow.total,
    runningRuns: runsRow.running ?? 0,
    successRuns: runsRow.success ?? 0,
    failedRuns: runsRow.failed ?? 0,
    errorEvents: messageErrors.count + runtimeErrors.count + traceErrors.count + (runsRow.failed ?? 0),
    recentActivityAt: recent.recentActivityAt,
  };
}

export function listTraceRecentEvents(workspaceId: string, limit = 30): TraceEvent[] {
  return db.prepare(`
    SELECT * FROM (
      SELECT 'session-' || s.id AS id, s.created_at AS time, 'session_created' AS type, s.title AS target, 'session' AS targetKind, s.id AS targetId, 'success' AS status, s.id AS detail
      FROM sessions s WHERE s.workspace_id = ?
      UNION ALL
      SELECT 'session-update-' || s.id AS id, s.updated_at AS time, 'session_updated' AS type, s.title AS target, 'session' AS targetKind, s.id AS targetId, 'success' AS status, s.id AS detail
      FROM sessions s WHERE s.workspace_id = ?
      UNION ALL
      SELECT 'runtime-' || sr.session_id AS id, sr.updated_at AS time, 'runtime_' || sr.status AS type, s.title AS target, 'runtime' AS targetKind, sr.session_id AS targetId, CASE WHEN sr.status = 'error' THEN 'failed' ELSE sr.status END AS status, sr.last_error AS detail
      FROM session_runtime sr JOIN sessions s ON s.id = sr.session_id WHERE s.workspace_id = ?
      UNION ALL
      SELECT 'flow-' || f.id AS id, f.created_at AS time, 'flow_created' AS type, f.name AS target, 'flow' AS targetKind, f.id AS targetId, 'success' AS status, f.kind AS detail
      FROM flows f WHERE f.workspace_id = ?
      UNION ALL
      SELECT 'run-' || fr.id AS id, fr.started_at AS time, 'run_start' AS type, f.name AS target, 'flow_run' AS targetKind, fr.id AS targetId, 'running' AS status, fr.id AS detail
      FROM flow_runs fr JOIN flows f ON f.id = fr.flow_id WHERE f.workspace_id = ?
      UNION ALL
      SELECT 'run-end-' || fr.id AS id, COALESCE(fr.ended_at, fr.started_at) AS time, 'run_end' AS type, f.name AS target, 'flow_run' AS targetKind, fr.id AS targetId, fr.status AS status, fr.id AS detail
      FROM flow_runs fr JOIN flows f ON f.id = fr.flow_id WHERE f.workspace_id = ?
      UNION ALL
      SELECT 'msg-error-' || m.id AS id, m.created_at AS time, 'message_error' AS type, s.title AS target, 'message' AS targetKind, CAST(m.id AS TEXT) AS targetId, 'failed' AS status, m.error_message AS detail
      FROM messages m JOIN sessions s ON s.id = m.session_id WHERE s.workspace_id = ? AND m.error_message IS NOT NULL
      UNION ALL
      SELECT id, created_at AS time, type, target, target_kind AS targetKind, target_id AS targetId, status, detail
      FROM trace_events WHERE workspace_id = ?
    ) ORDER BY time DESC LIMIT ?
  `).all(workspaceId, workspaceId, workspaceId, workspaceId, workspaceId, workspaceId, workspaceId, workspaceId, limit) as unknown as TraceEvent[];
}

function listPersistedTraceTimeline(workspaceId: string, targetKind: string, targetId: string): TraceTimelineItem[] {
  return db.prepare(`
    SELECT id, created_at AS time, type, target AS title, detail, status
    FROM trace_events
    WHERE workspace_id = ? AND target_kind = ? AND target_id = ?
  `).all(workspaceId, targetKind, targetId) as unknown as TraceTimelineItem[];
}

export function getTraceTimeline(workspaceId: string, targetKind: string, targetId: string): TraceTimelineItem[] {
  if (targetKind === "session" || targetKind === "runtime") {
    const session = getSession(targetId);
    if (!session || session.workspaceId !== workspaceId) return [];
    const messages = db.prepare(`
      SELECT 'message-' || id AS id, created_at AS time,
             CASE WHEN error_message IS NOT NULL THEN 'message_error' ELSE 'message_' || role END AS type,
             role AS title,
             COALESCE(error_message, substr(content, 1, 240)) AS detail,
             CASE WHEN error_message IS NOT NULL THEN 'failed' ELSE 'success' END AS status
      FROM messages WHERE session_id = ?
    `).all(targetId) as unknown as TraceTimelineItem[];
    const runtime = db.prepare(`
      SELECT 'runtime-' || session_id AS id, updated_at AS time, 'runtime_' || status AS type,
             'runtime' AS title, last_error AS detail,
             CASE WHEN status = 'error' THEN 'failed' ELSE status END AS status
      FROM session_runtime WHERE session_id = ?
    `).all(targetId) as unknown as TraceTimelineItem[];
    const persisted = listPersistedTraceTimeline(workspaceId, targetKind, targetId);
    const result: TraceTimelineItem[] = [
      { id: `session-${session.id}`, time: session.createdAt, type: "session_created", title: session.title, detail: session.id, status: "success" },
      ...messages,
      ...runtime,
      ...persisted,
      { id: `session-updated-${session.id}`, time: session.updatedAt, type: "session_updated", title: session.title, detail: session.id, status: "success" },
    ];
    return result.sort((a, b) => a.time - b.time);
  }

  if (targetKind === "flow") {
    const flow = getFlow(targetId);
    if (!flow || flow.workspaceId !== workspaceId) return [];
    const runs = db.prepare(`
      SELECT 'run-' || fr.id AS id, fr.started_at AS time, 'run_' || fr.status AS type,
             'flow run' AS title, fr.id AS detail, fr.status AS status
      FROM flow_runs fr WHERE fr.flow_id = ?
    `).all(targetId) as unknown as TraceTimelineItem[];
    const persisted = listPersistedTraceTimeline(workspaceId, targetKind, targetId);
    const result: TraceTimelineItem[] = [
      { id: `flow-${flow.id}`, time: flow.createdAt, type: "flow_created", title: flow.name, detail: flow.kind, status: "success" },
      ...runs,
      ...persisted,
      { id: `flow-updated-${flow.id}`, time: flow.updatedAt, type: "flow_updated", title: flow.name, detail: flow.generationError, status: flow.generationStatus === "failed" ? "failed" : "success" },
    ];
    return result.sort((a, b) => a.time - b.time);
  }

  if (targetKind === "flow_run") {
    const run = getFlowRun(targetId);
    if (!run) return [];
    const flow = getFlow(run.flowId);
    if (!flow || flow.workspaceId !== workspaceId) return [];
    const persisted = listPersistedTraceTimeline(workspaceId, targetKind, targetId);
    const result: TraceTimelineItem[] = [
      { id: `run-start-${run.id}`, time: run.startedAt, type: "run_start", title: flow.name, detail: run.id, status: "running" },
      ...persisted,
      { id: `run-end-${run.id}`, time: run.endedAt ?? run.startedAt, type: "run_end", title: flow.name, detail: run.outputDir, status: run.status },
    ];
    return result.sort((a, b) => a.time - b.time);
  }

  if (targetKind === "message") {
    const row = db.prepare(`
      SELECT m.id, m.session_id AS sessionId, m.role, m.content, m.error_message AS errorMessage, m.created_at AS createdAt, s.workspace_id AS workspaceId
      FROM messages m JOIN sessions s ON s.id = m.session_id WHERE m.id = ?
    `).get(Number(targetId)) as unknown as { id: number; sessionId: string; role: string; content: string; errorMessage: string | null; createdAt: number; workspaceId: string } | undefined;
    if (!row || row.workspaceId !== workspaceId) return [];
    const result: TraceTimelineItem[] = [{
      id: `message-${row.id}`,
      time: row.createdAt,
      type: row.errorMessage ? "message_error" : `message_${row.role}`,
      title: row.role,
      detail: row.errorMessage ?? row.content.slice(0, 500),
      status: row.errorMessage ? "failed" : "success",
    }];
    return result;
  }

  return [];
}

export function listTraceFailures(workspaceId: string, limit = 10): TraceFailure[] {
  const messageFailures = db.prepare(`
    SELECT 'message:' || COALESCE(error_message, 'unknown') AS id,
           COALESCE(error_message, 'unknown') AS title,
           COUNT(*) AS count,
           'session message' AS source,
           MAX(m.created_at) AS lastSeenAt
    FROM messages m
    JOIN sessions s ON s.id = m.session_id
    WHERE s.workspace_id = ? AND m.error_message IS NOT NULL
    GROUP BY error_message
  `).all(workspaceId) as unknown as Omit<TraceFailure, "errorType">[];
  const runFailures = db.prepare(`
    SELECT 'flow-run:' || f.id AS id,
           'Flow run failed: ' || f.name AS title,
           COUNT(*) AS count,
           'flow run' AS source,
           MAX(COALESCE(fr.ended_at, fr.started_at)) AS lastSeenAt
    FROM flow_runs fr
    JOIN flows f ON f.id = fr.flow_id
    WHERE f.workspace_id = ? AND fr.status = 'failed'
    GROUP BY f.id, f.name
  `).all(workspaceId) as unknown as Omit<TraceFailure, "errorType">[];
  const runtimeFailures = db.prepare(`
    SELECT 'runtime:' || COALESCE(sr.last_error, sr.status) AS id,
           COALESCE(sr.last_error, 'Session runtime error') AS title,
           COUNT(*) AS count,
           'session runtime' AS source,
           MAX(sr.updated_at) AS lastSeenAt
    FROM session_runtime sr
    JOIN sessions s ON s.id = sr.session_id
    WHERE s.workspace_id = ? AND sr.status = 'error'
    GROUP BY sr.last_error
  `).all(workspaceId) as unknown as Omit<TraceFailure, "errorType">[];
  const persistedFailures = db.prepare(`
    SELECT 'trace:' || type || ':' || COALESCE(detail, target) AS id,
           COALESCE(detail, type || ': ' || target) AS title,
           COUNT(*) AS count,
           type AS source,
           MAX(created_at) AS lastSeenAt
    FROM trace_events
    WHERE workspace_id = ? AND status = 'failed'
    GROUP BY type, detail, target
  `).all(workspaceId) as unknown as Omit<TraceFailure, "errorType">[];
  return [...messageFailures, ...runFailures, ...runtimeFailures, ...persistedFailures]
    .map((failure) => ({ ...failure, errorType: classifyTraceError(failure.title, failure.source) }))
    .sort((a, b) => b.count - a.count || b.lastSeenAt - a.lastSeenAt)
    .slice(0, limit);
}

export function getTraceTrend(workspaceId: string, days = 14): TraceTrendPoint[] {
  const safeDays = Math.min(60, Math.max(1, days));
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - safeDays + 1).getTime();
  const dayKeys = Array.from({ length: safeDays }, (_, index) => {
    const d = new Date(start + index * 86400000);
    return d.toISOString().slice(0, 10);
  });
  const points = new Map(dayKeys.map((day) => [day, { day, sessions: 0, runs: 0, failures: 0, events: 0 }]));
  const dayExpr = "date(created_at / 1000, 'unixepoch', 'localtime')";
  const sessions = db.prepare(`SELECT ${dayExpr} AS day, COUNT(*) AS count FROM sessions WHERE workspace_id = ? AND created_at >= ? GROUP BY day`).all(workspaceId, start) as Array<{ day: string; count: number }>;
  const runs = db.prepare(`
    SELECT date(fr.started_at / 1000, 'unixepoch', 'localtime') AS day, COUNT(*) AS count
    FROM flow_runs fr JOIN flows f ON f.id = fr.flow_id
    WHERE f.workspace_id = ? AND fr.started_at >= ? GROUP BY day
  `).all(workspaceId, start) as Array<{ day: string; count: number }>;
  const failedRuns = db.prepare(`
    SELECT date(COALESCE(fr.ended_at, fr.started_at) / 1000, 'unixepoch', 'localtime') AS day, COUNT(*) AS count
    FROM flow_runs fr JOIN flows f ON f.id = fr.flow_id
    WHERE f.workspace_id = ? AND fr.status = 'failed' AND COALESCE(fr.ended_at, fr.started_at) >= ? GROUP BY day
  `).all(workspaceId, start) as Array<{ day: string; count: number }>;
  const traceEvents = db.prepare(`
    SELECT date(created_at / 1000, 'unixepoch', 'localtime') AS day,
           COUNT(*) AS events,
           SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failures
    FROM trace_events WHERE workspace_id = ? AND created_at >= ? GROUP BY day
  `).all(workspaceId, start) as Array<{ day: string; events: number; failures: number | null }>;
  for (const row of sessions) if (points.has(row.day)) points.get(row.day)!.sessions = row.count;
  for (const row of runs) if (points.has(row.day)) points.get(row.day)!.runs = row.count;
  for (const row of failedRuns) if (points.has(row.day)) points.get(row.day)!.failures += row.count;
  for (const row of traceEvents) if (points.has(row.day)) {
    points.get(row.day)!.events = row.events;
    points.get(row.day)!.failures += row.failures ?? 0;
  }
  return [...points.values()];
}

export function generateTraceRuleSuggestions(workspaceId: string): TraceRuleSuggestion[] {
  const now = Date.now();
  const failures = listTraceFailures(workspaceId, 20);
  const events = listTraceRecentEvents(workspaceId, 50);
  const suggestions: TraceRuleSuggestion[] = [];
  const push = (rule: Omit<TraceRuleSuggestion, "createdAt">) => suggestions.push({ ...rule, createdAt: now });

  const flowRunFailures = failures.filter((item) => item.source === "flow run");
  const runtimeFailures = failures.filter((item) => item.source === "session runtime");
  const messageFailures = failures.filter((item) => item.source === "session message");
  const failedRunEvents = events.filter((event) => event.type === "run_end" && event.status === "failed");
  const runtimeErrorEvents = events.filter((event) => event.type === "runtime_error" || event.status === "failed");

  const topFlowRun = flowRunFailures[0];
  if (topFlowRun) {
    push({
      id: `flow-run-${topFlowRun.id}`,
      title: "执行 workflow 前必须验证 inputs、输出目录和上游依赖；出现 failed run_end 时先读取 trace 再重试。",
      evidence: `${topFlowRun.title} 出现 ${topFlowRun.count} 次；分类 ${topFlowRun.errorType}；最近发生于 ${new Date(topFlowRun.lastSeenAt).toLocaleString()}。`,
      severity: topFlowRun.count >= 3 ? "high" : "medium",
      sourceEventIds: failedRunEvents.slice(0, 5).map((event) => event.id),
    });
  }

  const topRuntime = runtimeFailures[0];
  if (topRuntime) {
    push({
      id: `runtime-${topRuntime.id}`,
      title: "session runtime 为 error/compacting 时不得继续长任务，必须先刷新 runtime 或完成 compact 恢复。",
      evidence: `${topRuntime.title.slice(0, 120)}；分类 ${topRuntime.errorType}；累计 ${topRuntime.count} 次。`,
      severity: topRuntime.count >= 2 ? "high" : "medium",
      sourceEventIds: runtimeErrorEvents.slice(0, 5).map((event) => event.id),
    });
  }

  const topMessage = messageFailures[0];
  if (topMessage) {
    push({
      id: `message-${topMessage.id}`,
      title: "assistant message 出现 error_message 后，下一步必须转为排错清单，不允许沿用同一执行路径盲重试。",
      evidence: `${topMessage.title.slice(0, 120)}；分类 ${topMessage.errorType}；来源 ${topMessage.source}，累计 ${topMessage.count} 次。`,
      severity: topMessage.count >= 3 ? "high" : "medium",
      sourceEventIds: events.filter((event) => event.type === "message_error").slice(0, 5).map((event) => event.id),
    });
  }

  if (failedRunEvents.length >= 2) {
    push({
      id: "pattern-failed-run-end",
      title: "连续多个 run_end 为 failed 时，应暂停生成内容，先汇总最近事件流与失败聚合再给修复方案。",
      evidence: `最近 ${events.length} 条事件中发现 ${failedRunEvents.length} 条 failed run_end。`,
      severity: "high",
      sourceEventIds: failedRunEvents.slice(0, 5).map((event) => event.id),
    });
  }

  return suggestions.slice(0, 6);
}

// ---- change proposals ----

export function createChangeProposal(workspaceId: string, input: ChangeProposalInput): ChangeProposal {
  const id = randomUUID();
  const now = Date.now();
  db.prepare(
    "INSERT INTO change_proposals (id, workspace_id, run_id, source_node_id, title, description, expected_impact, status, applied_result, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, 'proposed', '', ?, ?)",
  ).run(id, workspaceId, input.runId ?? null, input.sourceNodeId ?? null, input.title, input.description ?? "", input.expectedImpact ?? "", now, now);
  return { id, workspaceId, runId: input.runId ?? null, sourceNodeId: input.sourceNodeId ?? null, title: input.title, description: input.description ?? "", expectedImpact: input.expectedImpact ?? "", status: "proposed", appliedResult: "", createdAt: now, updatedAt: now };
}

export function listChangeProposals(workspaceId: string): ChangeProposal[] {
  return db.prepare(
    "SELECT id, workspace_id AS workspaceId, run_id AS runId, source_node_id AS sourceNodeId, title, description, expected_impact AS expectedImpact, status, applied_result AS appliedResult, created_at AS createdAt, updated_at AS updatedAt FROM change_proposals WHERE workspace_id = ? ORDER BY updated_at DESC",
  ).all(workspaceId) as unknown as ChangeProposal[];
}

export function updateChangeProposal(id: string, patch: { status?: ChangeProposalStatus; appliedResult?: string; title?: string; description?: string; expectedImpact?: string }): boolean {
  const now = Date.now();
  const fields: string[] = ["updated_at = ?"];
  const values: Array<string | number | null> = [now];
  if (patch.status !== undefined) { fields.push("status = ?"); values.push(patch.status); }
  if (patch.appliedResult !== undefined) { fields.push("applied_result = ?"); values.push(patch.appliedResult); }
  if (patch.title !== undefined) { fields.push("title = ?"); values.push(patch.title); }
  if (patch.description !== undefined) { fields.push("description = ?"); values.push(patch.description); }
  if (patch.expectedImpact !== undefined) { fields.push("expected_impact = ?"); values.push(patch.expectedImpact); }
  const result = db.prepare(`UPDATE change_proposals SET ${fields.join(", ")} WHERE id = ?`).run(...values, id);
  return result.changes > 0;
}

export function deleteChangeProposal(id: string): boolean {
  return db.prepare("DELETE FROM change_proposals WHERE id = ?").run(id).changes > 0;
}

// ---- stale nodes ----

export function markNodesStale(runId: string, nodeIds: string[], reason: StaleNodeReason): void {
  const now = Date.now();
  const stmt = db.prepare(
    "INSERT INTO stale_nodes (run_id, node_id, reason, triggered_at) VALUES (?, ?, ?, ?) ON CONFLICT(run_id, node_id) DO UPDATE SET reason = excluded.reason, triggered_at = excluded.triggered_at",
  );
  for (const nodeId of nodeIds) stmt.run(runId, nodeId, reason, now);
}

export function getStaleNodes(runId: string): StaleNode[] {
  return db.prepare(
    "SELECT id, run_id AS runId, node_id AS nodeId, reason, triggered_at AS triggeredAt FROM stale_nodes WHERE run_id = ? ORDER BY id ASC",
  ).all(runId) as unknown as StaleNode[];
}

export function clearStaleNodes(runId: string): void {
  db.prepare("DELETE FROM stale_nodes WHERE run_id = ?").run(runId);
}

// ---- AnaX gate config ----

export function getAnaxGateConfig(workspaceId: string): AnaxGateConfig {
  const row = db.prepare(
    "SELECT workspace_id AS workspaceId, min_confidence AS minConfidence, min_evidence_count AS minEvidenceCount, min_data_quality_score AS minDataQualityScore FROM anax_gate_config WHERE workspace_id = ?"
  ).get(workspaceId) as AnaxGateConfig | undefined;
  return row ?? { workspaceId, minConfidence: "medium", minEvidenceCount: 2, minDataQualityScore: 7 };
}

export function upsertAnaxGateConfig(workspaceId: string, patch: { minConfidence?: string; minEvidenceCount?: number; minDataQualityScore?: number }): AnaxGateConfig {
  const current = getAnaxGateConfig(workspaceId);
  const minConfidence = (patch.minConfidence ?? current.minConfidence) as AnaxGateConfig["minConfidence"];
  const minEvidenceCount = patch.minEvidenceCount ?? current.minEvidenceCount;
  const minDataQualityScore = patch.minDataQualityScore ?? current.minDataQualityScore;
  db.prepare(
    "INSERT INTO anax_gate_config (workspace_id, min_confidence, min_evidence_count, min_data_quality_score) VALUES (?, ?, ?, ?) ON CONFLICT(workspace_id) DO UPDATE SET min_confidence = excluded.min_confidence, min_evidence_count = excluded.min_evidence_count, min_data_quality_score = excluded.min_data_quality_score"
  ).run(workspaceId, minConfidence, minEvidenceCount, minDataQualityScore);
  return { workspaceId, minConfidence, minEvidenceCount, minDataQualityScore };
}

// ---- skill curation proposals ----

export function saveSkillCurationProposals(
  workspaceId: string,
  evaluationId: string,
  proposals: Array<{ type: string; targetPath: string; suggestedContent: string; rationale: string; confidence: number; evidence: string[] }>,
): void {
  const stmt = db.prepare(
    "INSERT INTO skill_curation_proposals (id, workspace_id, evaluation_id, type, target_path, suggested_content, rationale, confidence, evidence, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)",
  );
  const now = Date.now();
  for (const p of proposals) {
    stmt.run(randomUUID(), workspaceId, evaluationId, p.type, p.targetPath, p.suggestedContent, p.rationale, p.confidence, JSON.stringify(p.evidence), now);
  }
}

export function listSkillCurationProposals(workspaceId: string, status?: string): SkillCurationProposalRecord[] {
  const query = status
    ? "SELECT id, workspace_id AS workspaceId, evaluation_id AS evaluationId, type, target_path AS targetPath, suggested_content AS suggestedContent, rationale, confidence, evidence, status, created_at AS createdAt FROM skill_curation_proposals WHERE workspace_id = ? AND status = ? ORDER BY created_at DESC"
    : "SELECT id, workspace_id AS workspaceId, evaluation_id AS evaluationId, type, target_path AS targetPath, suggested_content AS suggestedContent, rationale, confidence, evidence, status, created_at AS createdAt FROM skill_curation_proposals WHERE workspace_id = ? ORDER BY created_at DESC";
  const rows = (status ? db.prepare(query).all(workspaceId, status) : db.prepare(query).all(workspaceId)) as unknown as Array<Omit<SkillCurationProposalRecord, "evidence"> & { evidence: string }>;
  return rows.map((r) => ({ ...r, evidence: parseJsonArray(r.evidence) }));
}

export function updateSkillCurationProposalStatus(id: string, status: string): boolean {
  return db.prepare("UPDATE skill_curation_proposals SET status = ? WHERE id = ?").run(status, id).changes > 0;
}

// ---- Knowledge Graph ----

try {
  db.exec(`
    CREATE TABLE IF NOT EXISTS kg_nodes (
      id          TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      type        TEXT NOT NULL,
      source_key  TEXT NOT NULL,
      title       TEXT NOT NULL,
      summary     TEXT NOT NULL DEFAULT '',
      tags        TEXT NOT NULL DEFAULT '[]',
      content_hash TEXT,
      hidden      INTEGER NOT NULL DEFAULT 0,
      created_at  INTEGER NOT NULL,
      updated_at  INTEGER NOT NULL,
      UNIQUE(workspace_id, source_key)
    );
    CREATE INDEX IF NOT EXISTS idx_kg_nodes_ws ON kg_nodes(workspace_id, type);
    CREATE TABLE IF NOT EXISTS kg_edges (
      id          TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      from_id     TEXT NOT NULL,
      to_id       TEXT NOT NULL,
      relation    TEXT NOT NULL,
      weight      REAL NOT NULL DEFAULT 1.0,
      auto        INTEGER NOT NULL DEFAULT 1,
      created_at  INTEGER NOT NULL,
      UNIQUE(from_id, to_id, relation)
    );
    CREATE INDEX IF NOT EXISTS idx_kg_edges_ws ON kg_edges(workspace_id);
  `);
  // Migrate existing tables that lack the hidden column
  try { db.exec("ALTER TABLE kg_nodes ADD COLUMN hidden INTEGER NOT NULL DEFAULT 0"); } catch { /* column exists */ }
  try { db.exec("ALTER TABLE kg_nodes ADD COLUMN ai_extracted_hash TEXT"); } catch { /* column exists */ }
} catch {
  // ignore (read-only test env)
}

interface KgNodeRow {
  id: string;
  workspaceId: string;
  type: KgNodeType;
  sourceKey: string;
  title: string;
  summary: string;
  tags: string;
  contentHash: string | null;
  aiExtractedHash: string | null;
  hidden: number;
  createdAt: number;
  updatedAt: number;
}

function parseKgNode(row: KgNodeRow): KgNode {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    type: row.type,
    sourceKey: row.sourceKey,
    title: row.title,
    summary: row.summary,
    tags: parseJsonArray<string>(row.tags),
    contentHash: row.contentHash,
    aiExtractedHash: row.aiExtractedHash ?? null,
    hidden: row.hidden === 1,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export interface KgNodeInput {
  workspaceId: string;
  type: KgNodeType;
  sourceKey: string;
  title: string;
  summary: string;
  tags: string[];
  contentHash: string | null;
}

export function upsertKgNode(input: KgNodeInput): KgNode {
  const now = Date.now();
  const existing = db.prepare(
    "SELECT id, created_at AS createdAt FROM kg_nodes WHERE workspace_id = ? AND source_key = ?",
  ).get(input.workspaceId, input.sourceKey) as { id: string; createdAt: number } | undefined;

  if (existing) {
    db.prepare(
      "UPDATE kg_nodes SET type = ?, title = ?, summary = ?, tags = ?, content_hash = ?, updated_at = ? WHERE id = ?",
    ).run(input.type, input.title, input.summary, JSON.stringify(input.tags), input.contentHash, now, existing.id);
    return {
      id: existing.id,
      workspaceId: input.workspaceId,
      type: input.type,
      sourceKey: input.sourceKey,
      title: input.title,
      summary: input.summary,
      tags: input.tags,
      contentHash: input.contentHash,
      aiExtractedHash: null,
      hidden: false,
      createdAt: existing.createdAt,
      updatedAt: now,
    };
  }

  const id = randomUUID();
  db.prepare(
    "INSERT INTO kg_nodes (id, workspace_id, type, source_key, title, summary, tags, content_hash, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
  ).run(id, input.workspaceId, input.type, input.sourceKey, input.title, input.summary, JSON.stringify(input.tags), input.contentHash, now, now);
  return { id, workspaceId: input.workspaceId, type: input.type, sourceKey: input.sourceKey, title: input.title, summary: input.summary, tags: input.tags, contentHash: input.contentHash, aiExtractedHash: null, hidden: false, createdAt: now, updatedAt: now };
}

export function listKgNodes(workspaceId: string, includeHidden = false): KgNode[] {
  const sql = includeHidden
    ? "SELECT id, workspace_id AS workspaceId, type, source_key AS sourceKey, title, summary, tags, content_hash AS contentHash, ai_extracted_hash AS aiExtractedHash, hidden, created_at AS createdAt, updated_at AS updatedAt FROM kg_nodes WHERE workspace_id = ? ORDER BY type, title"
    : "SELECT id, workspace_id AS workspaceId, type, source_key AS sourceKey, title, summary, tags, content_hash AS contentHash, ai_extracted_hash AS aiExtractedHash, hidden, created_at AS createdAt, updated_at AS updatedAt FROM kg_nodes WHERE workspace_id = ? AND hidden = 0 ORDER BY type, title";
  return (db.prepare(sql).all(workspaceId) as unknown as KgNodeRow[]).map(parseKgNode);
}

export function setKgNodeHidden(id: string, hidden: boolean): boolean {
  return db.prepare("UPDATE kg_nodes SET hidden = ?, updated_at = ? WHERE id = ?").run(hidden ? 1 : 0, Date.now(), id).changes > 0;
}

export function setKgNodeAiExtractedHash(id: string, hash: string): void {
  db.prepare("UPDATE kg_nodes SET ai_extracted_hash = ? WHERE id = ?").run(hash, id);
}

export function insertManualKgEdge(workspaceId: string, fromId: string, toId: string, relation: KgRelation, weight = 1.0): KgEdge {
  const id = randomUUID();
  const now = Date.now();
  db.prepare(
    "INSERT OR REPLACE INTO kg_edges (id, workspace_id, from_id, to_id, relation, weight, auto, created_at) VALUES (?, ?, ?, ?, ?, ?, 0, ?)",
  ).run(id, workspaceId, fromId, toId, relation, weight, now);
  return { id, workspaceId, fromId, toId, relation, weight, auto: false, createdAt: now };
}

export function deleteKgEdge(id: string): boolean {
  return db.prepare("DELETE FROM kg_edges WHERE id = ?").run(id).changes > 0;
}

export function deleteKgNodesForSource(workspaceId: string, sourceKeyPrefix: string): void {
  db.prepare("DELETE FROM kg_nodes WHERE workspace_id = ? AND source_key LIKE ?").run(workspaceId, `${sourceKeyPrefix}%`);
}

export function deleteKgNodesByType(workspaceId: string, type: string): void {
  db.prepare("DELETE FROM kg_nodes WHERE workspace_id = ? AND type = ?").run(workspaceId, type);
}

export function clearKgAutoEdges(workspaceId: string): void {
  db.prepare("DELETE FROM kg_edges WHERE workspace_id = ? AND auto = 1").run(workspaceId);
}

export interface KgEdgeInput {
  workspaceId: string;
  fromId: string;
  toId: string;
  relation: KgRelation;
  weight: number;
}

export function insertKgEdges(edges: KgEdgeInput[]): void {
  const stmt = db.prepare(
    "INSERT OR IGNORE INTO kg_edges (id, workspace_id, from_id, to_id, relation, weight, auto, created_at) VALUES (?, ?, ?, ?, ?, ?, 1, ?)",
  );
  const now = Date.now();
  for (const e of edges) {
    stmt.run(randomUUID(), e.workspaceId, e.fromId, e.toId, e.relation, e.weight, now);
  }
}

export function listKgEdges(workspaceId: string): KgEdge[] {
  const rows = db.prepare(
    "SELECT id, workspace_id AS workspaceId, from_id AS fromId, to_id AS toId, relation, weight, auto, created_at AS createdAt FROM kg_edges WHERE workspace_id = ? ORDER BY weight DESC",
  ).all(workspaceId) as unknown as Array<Omit<KgEdge, "auto"> & { auto: number }>;
  return rows.map((r) => ({ ...r, auto: r.auto === 1 }));
}

export function deleteKgData(workspaceId: string): void {
  db.prepare("DELETE FROM kg_edges WHERE workspace_id = ?").run(workspaceId);
  db.prepare("DELETE FROM kg_nodes WHERE workspace_id = ?").run(workspaceId);
}

type ModelLabRunRow = Omit<ModelLabRunDetail, "result" | "rawOutput" | "rowsCapped" | "rowsTotal" | "rowCount" | "durationMs" | "createdAt" | "errorMessage"> & {
  rowCount: number;
  rowsTotal: number;
  rowsCapped: number;
  durationMs: number;
  result: string;
  rawOutput: string;
  createdAt: number;
  errorMessage: string | null;
};

function parseModelLabRunRow(row: ModelLabRunRow): ModelLabRunDetail {
  let result: PredictionResult | null = null;
  if (row.result && row.result.length > 0) {
    try {
      result = JSON.parse(row.result) as PredictionResult;
    } catch {
      result = null;
    }
  }
  return {
    id: row.id,
    modelId: row.modelId,
    model: row.model,
    status: row.status,
    rowCount: row.rowCount,
    rowsTotal: row.rowsTotal,
    rowsCapped: row.rowsCapped === 1,
    durationMs: row.durationMs,
    result,
    rawOutput: row.rawOutput,
    createdAt: row.createdAt,
    errorMessage: row.errorMessage,
  };
}

export function createModelLabRun(input: {
  modelId: string;
  model: string;
  status: ModelLabRunSummary["status"];
  rowCount: number;
  rowsTotal: number;
  rowsCapped: boolean;
  durationMs: number;
  result: PredictionResult | null;
  rawOutput: string;
  errorMessage?: string | null;
}): ModelLabRunDetail {
  const id = randomUUID();
  const createdAt = Date.now();
  const resultJson = input.result ? JSON.stringify(input.result) : "";
  const errorMessage = input.errorMessage ?? null;
  db.prepare(
    "INSERT INTO model_lab_runs (id, model_id, model, status, row_count, rows_total, rows_capped, duration_ms, result, raw_output, created_at, error_message) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
  ).run(id, input.modelId, input.model, input.status, input.rowCount, input.rowsTotal, input.rowsCapped ? 1 : 0, input.durationMs, resultJson, input.rawOutput, createdAt, errorMessage);
  return {
    id,
    modelId: input.modelId,
    model: input.model,
    status: input.status,
    rowCount: input.rowCount,
    rowsTotal: input.rowsTotal,
    rowsCapped: input.rowsCapped,
    durationMs: input.durationMs,
    result: input.result,
    rawOutput: input.rawOutput,
    createdAt,
    errorMessage,
  };
}

export function listModelLabRuns(limit = 30): ModelLabRunSummary[] {
  const safeLimit = Math.min(100, Math.max(1, limit));
  const rows = db.prepare(
    "SELECT id, model_id AS modelId, model, status, row_count AS rowCount, rows_total AS rowsTotal, rows_capped AS rowsCapped, duration_ms AS durationMs, created_at AS createdAt, error_message AS errorMessage FROM model_lab_runs ORDER BY created_at DESC LIMIT ?",
  ).all(safeLimit) as unknown as Array<Omit<ModelLabRunSummary, "rowsCapped" | "errorMessage"> & { rowsCapped: number; errorMessage: string | null }>;
  return rows.map((row) => ({ ...row, rowsCapped: row.rowsCapped === 1 }));
}

export function getModelLabRun(id: string): ModelLabRunDetail | undefined {
  const row = db.prepare(
    "SELECT id, model_id AS modelId, model, status, row_count AS rowCount, rows_total AS rowsTotal, rows_capped AS rowsCapped, duration_ms AS durationMs, result, raw_output AS rawOutput, created_at AS createdAt, error_message AS errorMessage FROM model_lab_runs WHERE id = ?",
  ).get(id) as unknown as ModelLabRunRow | undefined;
  return row ? parseModelLabRunRow(row) : undefined;
}

export function getModelLabStats(): ModelLabStats {
  const totals = db.prepare(
    "SELECT COUNT(*) AS totalRuns, COALESCE(SUM(row_count), 0) AS totalRows, COALESCE(AVG(duration_ms), 0) AS avgDuration FROM model_lab_runs WHERE status = 'success'",
  ).get() as { totalRuns: number; totalRows: number; avgDuration: number };

  const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const recent = db.prepare(
    "SELECT COUNT(*) AS c FROM model_lab_runs WHERE status = 'success' AND created_at >= ?",
  ).get(sevenDaysAgo) as { c: number };

  const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;
  const trendRows = db.prepare(
    "SELECT strftime('%Y-%m-%d', created_at / 1000, 'unixepoch', 'localtime') AS date, COUNT(*) AS count FROM model_lab_runs WHERE status = 'success' AND created_at >= ? GROUP BY date ORDER BY date ASC",
  ).all(thirtyDaysAgo) as Array<{ date: string; count: number }>;

  const topRows = db.prepare(
    "SELECT model_id AS modelId, model, COUNT(*) AS count, AVG(duration_ms) AS avgDurationMs FROM model_lab_runs WHERE status = 'success' GROUP BY model_id, model ORDER BY count DESC LIMIT 10",
  ).all() as Array<{ modelId: string; model: string; count: number; avgDurationMs: number }>;

  return {
    totalRuns: totals.totalRuns,
    recentRuns7d: recent.c,
    avgDurationMs: Math.round(totals.avgDuration),
    totalRowsProcessed: totals.totalRows,
    dailyTrend: trendRows.map((r) => ({ date: r.date, count: r.count })),
    topModels: topRows.map((r) => ({
      modelId: r.modelId,
      model: r.model,
      count: r.count,
      avgDurationMs: Math.round(r.avgDurationMs),
    })),
  };
}

export function deleteModelLabRun(id: string): boolean {
  const info = db.prepare("DELETE FROM model_lab_runs WHERE id = ?").run(id);
  return Number(info.changes) > 0;
}

export function deleteModelLabRunsBefore(input: {
  beforeTs: number;
  onlyFailed: boolean;
}): number {
  const { beforeTs, onlyFailed } = input;
  const sql = onlyFailed
    ? "DELETE FROM model_lab_runs WHERE status = 'failed' AND created_at < ?"
    : "DELETE FROM model_lab_runs WHERE created_at < ?";
  const info = db.prepare(sql).run(beforeTs);
  return Number(info.changes);
}

// ---- BI Datasets ----

const VALID_BI_SLOTS = new Set<BiDatasetSlot>(["member_retention", "member_recall"]);

function rowToBiDatasetSummary(row: Record<string, unknown>): BiDatasetSummary {
  return {
    id: String(row.id),
    slot: row.slot as BiDatasetSlot,
    filename: String(row.filename),
    rowCount: Number(row.rowCount ?? 0),
    columnCount: Number(row.columnCount ?? 0),
    sizeBytes: Number(row.sizeBytes ?? 0),
    uploadedAt: Number(row.uploadedAt ?? 0),
    active: Number(row.active ?? 0),
  };
}

export function insertBiDataset(input: {
  slot: BiDatasetSlot;
  filename: string;
  storagePath: string;
  columns: string[];
  rows: Array<Record<string, unknown>>;
  sizeBytes: number;
}): BiDatasetDetail {
  if (!VALID_BI_SLOTS.has(input.slot)) throw new Error(`invalid slot: ${input.slot}`);
  const id = randomUUID();
  const uploadedAt = Date.now();
  const columnsJson = JSON.stringify(input.columns);
  const rowsJson = JSON.stringify(input.rows);
  const rowCount = input.rows.length;
  const columnCount = input.columns.length;
  db.exec("BEGIN");
  try {
    db.prepare("UPDATE bi_datasets SET active = 0 WHERE slot = ?").run(input.slot);
    db.prepare(
      "INSERT INTO bi_datasets (id, slot, filename, storage_path, columns_json, rows_json, row_count, column_count, size_bytes, uploaded_at, active) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)",
    ).run(id, input.slot, input.filename, input.storagePath, columnsJson, rowsJson, rowCount, columnCount, input.sizeBytes, uploadedAt);
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
  return {
    id,
    slot: input.slot,
    filename: input.filename,
    rowCount,
    columnCount,
    sizeBytes: input.sizeBytes,
    uploadedAt,
    active: 1,
    columns: input.columns,
    rows: input.rows,
  };
}

export function listBiDatasets(slot?: BiDatasetSlot): BiDatasetSummary[] {
  const sql = slot
    ? "SELECT id, slot, filename, row_count AS rowCount, column_count AS columnCount, size_bytes AS sizeBytes, uploaded_at AS uploadedAt, active FROM bi_datasets WHERE slot = ? ORDER BY uploaded_at DESC"
    : "SELECT id, slot, filename, row_count AS rowCount, column_count AS columnCount, size_bytes AS sizeBytes, uploaded_at AS uploadedAt, active FROM bi_datasets ORDER BY uploaded_at DESC";
  const stmt = db.prepare(sql);
  const rows = slot ? (stmt.all(slot) as Array<Record<string, unknown>>) : (stmt.all() as Array<Record<string, unknown>>);
  return rows.map(rowToBiDatasetSummary);
}

export function getBiDatasetById(id: string): BiDatasetDetail | undefined {
  const row = db
    .prepare(
      "SELECT id, slot, filename, storage_path AS storagePath, columns_json AS columnsJson, rows_json AS rowsJson, row_count AS rowCount, column_count AS columnCount, size_bytes AS sizeBytes, uploaded_at AS uploadedAt, active FROM bi_datasets WHERE id = ?",
    )
    .get(id) as Record<string, unknown> | undefined;
  if (!row) return undefined;
  const summary = rowToBiDatasetSummary(row);
  let columns: string[] = [];
  let rows: Array<Record<string, unknown>> = [];
  try {
    columns = JSON.parse(String(row.columnsJson ?? "[]")) as string[];
  } catch {
    columns = [];
  }
  try {
    rows = JSON.parse(String(row.rowsJson ?? "[]")) as Array<Record<string, unknown>>;
  } catch {
    rows = [];
  }
  return { ...summary, columns, rows };
}

export function getActiveBiDataset(slot: BiDatasetSlot): BiDatasetDetail | undefined {
  const row = db
    .prepare(
      "SELECT id FROM bi_datasets WHERE slot = ? AND active = 1 ORDER BY uploaded_at DESC LIMIT 1",
    )
    .get(slot) as { id: string } | undefined;
  if (!row) return undefined;
  return getBiDatasetById(row.id);
}

export function deleteBiDataset(id: string): { deleted: boolean; storagePath: string | null } {
  const row = db.prepare("SELECT storage_path AS storagePath FROM bi_datasets WHERE id = ?").get(id) as { storagePath: string } | undefined;
  if (!row) return { deleted: false, storagePath: null };
  const info = db.prepare("DELETE FROM bi_datasets WHERE id = ?").run(id);
  return { deleted: Number(info.changes) > 0, storagePath: row.storagePath };
}

export function setActiveBiDataset(slot: BiDatasetSlot, id: string): boolean {
  const target = db.prepare("SELECT id FROM bi_datasets WHERE id = ? AND slot = ?").get(id, slot) as { id: string } | undefined;
  if (!target) return false;
  db.exec("BEGIN");
  try {
    db.prepare("UPDATE bi_datasets SET active = 0 WHERE slot = ?").run(slot);
    db.prepare("UPDATE bi_datasets SET active = 1 WHERE id = ?").run(id);
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
  return true;
}

// ---- Report Favorites (Dashboard Report History) ----
export function listReportFavoriteIds(): string[] {
  const rows = db.prepare("SELECT id FROM report_favorites").all() as Array<{ id: string }>;
  return rows.map((r) => r.id);
}

export function addReportFavorite(id: string): void {
  db.prepare("INSERT OR IGNORE INTO report_favorites (id, created_at) VALUES (?, ?)").run(id, Date.now());
}

export function removeReportFavorite(id: string): boolean {
  const info = db.prepare("DELETE FROM report_favorites WHERE id = ?").run(id);
  return Number(info.changes) > 0;
}

// ---- Report Tags (Dashboard Report History V2) ----
export function listAllReportTags(): Array<{ tag: string; count: number }> {
  const rows = db.prepare("SELECT tag, COUNT(*) AS cnt FROM report_tags GROUP BY tag ORDER BY cnt DESC, tag ASC").all() as Array<{ tag: string; cnt: number }>;
  return rows.map((r) => ({ tag: r.tag, count: Number(r.cnt) }));
}

export function listTagsForReports(): Map<string, string[]> {
  const rows = db.prepare("SELECT report_id, tag FROM report_tags ORDER BY tag ASC").all() as Array<{ report_id: string; tag: string }>;
  const map = new Map<string, string[]>();
  for (const r of rows) {
    const arr = map.get(r.report_id) ?? [];
    arr.push(r.tag);
    map.set(r.report_id, arr);
  }
  return map;
}

export function addReportTag(reportId: string, tag: string): void {
  const cleaned = tag.trim();
  if (!cleaned) return;
  db.prepare("INSERT OR IGNORE INTO report_tags (report_id, tag, created_at) VALUES (?, ?, ?)").run(reportId, cleaned, Date.now());
}

export function removeReportTag(reportId: string, tag: string): boolean {
  const info = db.prepare("DELETE FROM report_tags WHERE report_id = ? AND tag = ?").run(reportId, tag);
  return Number(info.changes) > 0;
}
