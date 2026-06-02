import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { mkdirSync, statSync } from "node:fs";
import { DB_PATH, WORKSPACES_ROOT, ensureDirs } from "./config.ts";
import type { AnalysisStandard, AnalysisStandardKind, CreateRuleResult, EvaluationFlowConfig, EvaluationResultStatus, EvaluationStatus, FileAnalysis, Flow, FlowGenerationStatus, FlowKind, FlowRun, FlowRunStatus, PiUsage, Role, RuleMemory, Session, SessionRuntime, SessionRuntimeStatus, SessionTokenStats, StoredFlowMessage, StoredMessage, TraceErrorType, TraceEvent, TraceFailure, TraceOverview, TraceRuleSuggestion, TraceTimelineItem, TraceTrendPoint, WorkflowEvaluation, WorkflowEvaluationDetail, WorkflowEvaluationResult, WorkflowFavorite, Workspace, WorkspaceFolderName, WorkspacePath, WorkspacePathKind } from "./types.ts";

ensureDirs(); // DB opens at import time — guarantee the data dir exists first.
const db = new DatabaseSync(DB_PATH);

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
  CREATE TABLE IF NOT EXISTS workspace_paths (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    workspace_id TEXT NOT NULL REFERENCES workspaces(id),
    session_id   TEXT,
    flow_id      TEXT,
    folder       TEXT NOT NULL,
    path         TEXT NOT NULL,
    kind         TEXT NOT NULL DEFAULT 'file',
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
  CREATE TABLE IF NOT EXISTS rule_memories (
    id           TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL REFERENCES workspaces(id),
    title        TEXT NOT NULL,
    evidence     TEXT NOT NULL,
    source       TEXT NOT NULL,
    severity     TEXT NOT NULL,
    scope        TEXT NOT NULL DEFAULT 'global',
    enabled      INTEGER NOT NULL DEFAULT 1,
    created_at   INTEGER NOT NULL,
    updated_at   INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_rule_memories_ws ON rule_memories(workspace_id, updated_at DESC);
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
`);

try {
  const cols = db.prepare("PRAGMA table_info(messages)").all() as Array<{ name: string }>;
  if (!cols.some((c) => c.name === "error_message")) {
    db.exec("ALTER TABLE messages ADD COLUMN error_message TEXT");
  }
} catch {
  // ignore
}

// ---- workspaces ----

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
      "SELECT id, workspace_id AS workspaceId, title, workflow_id AS workflowId, created_at AS createdAt, updated_at AS updatedAt FROM sessions WHERE workspace_id = ? ORDER BY updated_at DESC",
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
  ).all(id) as unknown as WorkflowEvaluationResult[];
  return { ...evaluation, results };
}

function parseEvaluationFlowConfigs(
  row: Omit<WorkflowEvaluation, "flowConfigs"> & { flowConfigs: string },
): WorkflowEvaluation {
  try {
    return { ...row, flowConfigs: JSON.parse(row.flowConfigs) as Record<string, EvaluationFlowConfig> };
  } catch {
    return { ...row, flowConfigs: {} };
  }
}

export function updateWorkflowEvaluation(id: string, status: EvaluationStatus, error: string | null = null): void {
  db.prepare("UPDATE workflow_evaluations SET status = ?, ended_at = ?, error = ? WHERE id = ?")
    .run(status, Date.now(), error, id);
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
  db.prepare(`UPDATE workflow_evaluation_results SET ${sql} WHERE id = ?`)
    .run(...valid.map(([, value]) => value), id);
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

// ---- rule memories ----

function mapRuleMemory(row: Omit<RuleMemory, "enabled"> & { enabled: number }): RuleMemory {
  return { ...row, scope: row.scope ?? "global", enabled: Boolean(row.enabled) };
}

export function listRuleMemories(workspaceId: string): RuleMemory[] {
  const rows = db.prepare(`
    SELECT id, workspace_id AS workspaceId, title, evidence, source, severity, scope, enabled, created_at AS createdAt, updated_at AS updatedAt
    FROM rule_memories WHERE workspace_id = ? ORDER BY updated_at DESC
  `).all(workspaceId) as unknown as Array<Omit<RuleMemory, "enabled"> & { enabled: number }>;
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
    SELECT id, workspace_id AS workspaceId, title, evidence, source, severity, scope, enabled, created_at AS createdAt, updated_at AS updatedAt
    FROM rule_memories WHERE workspace_id = ? AND title = ? LIMIT 1
  `).get(input.workspaceId, input.title) as unknown as (Omit<RuleMemory, "enabled"> & { enabled: number }) | undefined;
  if (existing) return { rule: mapRuleMemory(existing), created: false };
  const id = randomUUID();
  const now = Date.now();
  db.prepare(`
    INSERT INTO rule_memories (id, workspace_id, title, evidence, source, severity, scope, enabled, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
  `).run(id, input.workspaceId, input.title, input.evidence, input.source, input.severity, input.scope, now, now);
  return { rule: { id, workspaceId: input.workspaceId, title: input.title, evidence: input.evidence, source: input.source, severity: input.severity, scope: input.scope, enabled: true, createdAt: now, updatedAt: now }, created: true };
}

export function updateRuleMemory(input: {
  id: string;
  title: string;
  evidence: string;
  severity: RuleMemory["severity"];
  scope: RuleMemory["scope"];
}): void {
  db.prepare("UPDATE rule_memories SET title = ?, evidence = ?, severity = ?, scope = ?, updated_at = ? WHERE id = ?")
    .run(input.title, input.evidence, input.severity, input.scope, Date.now(), input.id);
}

export function updateRuleMemoryEnabled(id: string, enabled: boolean): void {
  db.prepare("UPDATE rule_memories SET enabled = ?, updated_at = ? WHERE id = ?").run(enabled ? 1 : 0, Date.now(), id);
}

export function updateRuleMemoriesEnabled(ids: string[], enabled: boolean): void {
  const now = Date.now();
  const stmt = db.prepare("UPDATE rule_memories SET enabled = ?, updated_at = ? WHERE id = ?");
  for (const id of ids) stmt.run(enabled ? 1 : 0, now, id);
}

export function deleteRuleMemory(id: string): void {
  db.prepare("DELETE FROM rule_memories WHERE id = ?").run(id);
}

export function buildEnabledRulesPrompt(workspaceId: string, targetScope?: "chat" | "workflow"): { prompt: string; count: number; updatedAt: number | null } {
  const enabledRules = listRuleMemories(workspaceId).filter((rule) => rule.enabled && (!targetScope || rule.scope === "global" || rule.scope === targetScope));
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

export function listAnalysisStandards(workspaceId: string): AnalysisStandard[] {
  const rows = db.prepare(`
    SELECT ${ANALYSIS_STANDARD_COLUMNS}
    FROM analysis_standards WHERE workspace_id = ? ORDER BY updated_at DESC
  `).all(workspaceId) as unknown as Array<Omit<AnalysisStandard, "enabled"> & { enabled: number }>;
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

export function updateAnalysisStandardEnabled(id: string, enabled: boolean): void {
  db.prepare("UPDATE analysis_standards SET enabled = ?, updated_at = ? WHERE id = ?").run(enabled ? 1 : 0, Date.now(), id);
}

export function deleteAnalysisStandard(id: string): void {
  db.prepare("DELETE FROM analysis_standards WHERE id = ?").run(id);
}

export function buildEnabledStandardsPrompt(workspaceId: string): { prompt: string; count: number; updatedAt: number | null } {
  const enabled = listAnalysisStandards(workspaceId).filter((s) => s.enabled);
  if (enabled.length === 0) return { prompt: "", count: 0, updatedAt: null };

  const metrics = enabled.filter((s) => s.kind === "metric");
  const files = enabled.filter((s) => s.kind === "reference_file");
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
  return {
    prompt: lines.join("\n"),
    count: enabled.length,
    updatedAt: Math.max(...enabled.map((s) => s.updatedAt)),
  };
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
