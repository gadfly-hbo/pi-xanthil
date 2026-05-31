import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { mkdirSync } from "node:fs";
import { DB_PATH, WORKSPACES_ROOT, ensureDirs } from "./config.ts";
import type { Flow, FlowKind, FlowRun, FlowRunStatus, PiUsage, Role, Session, StoredFlowMessage, StoredMessage, Workspace, WorkspaceFolderName, WorkspacePath } from "./types.ts";

ensureDirs(); // DB opens at import time — guarantee the data dir exists first.
const db = new DatabaseSync(DB_PATH);

// ---- migrations ----
try {
  const cols = db.prepare("PRAGMA table_info(flows)").all() as Array<{ name: string }>;
  if (!cols.some((c) => c.name === "kind")) {
    db.exec("ALTER TABLE flows ADD COLUMN kind TEXT NOT NULL DEFAULT 'single'");
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
  const cols = db.prepare("PRAGMA table_info(workspace_paths)").all() as Array<{ name: string }>;
  if (!cols.some((c) => c.name === "session_id")) {
    db.exec("ALTER TABLE workspace_paths ADD COLUMN session_id TEXT");
  }
  if (!cols.some((c) => c.name === "flow_id")) {
    db.exec("ALTER TABLE workspace_paths ADD COLUMN flow_id TEXT");
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
  CREATE TABLE IF NOT EXISTS flows (
    id           TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL REFERENCES workspaces(id),
    name         TEXT NOT NULL,
    folder_path  TEXT NOT NULL,
    source_name  TEXT,
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
  CREATE TABLE IF NOT EXISTS workspace_paths (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    workspace_id TEXT NOT NULL REFERENCES workspaces(id),
    folder       TEXT NOT NULL,
    path         TEXT NOT NULL,
    added_at     INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_ws_paths_ws ON workspace_paths(workspace_id, folder);
`);

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
  for (const s of sessions) delMsgs.run(s.id);
  // Cascade: delete paths belonging to sessions in this workspace
  const delSessionPaths = db.prepare("DELETE FROM workspace_paths WHERE session_id = ?");
  for (const s of sessions) delSessionPaths.run(s.id);
  // Cascade: delete paths belonging to flows in this workspace
  const flows = db.prepare("SELECT id FROM flows WHERE workspace_id = ?").all(id) as unknown as Array<{ id: string }>;
  const delFlowPaths = db.prepare("DELETE FROM workspace_paths WHERE flow_id = ?");
  for (const f of flows) delFlowPaths.run(f.id);
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
  db.prepare("DELETE FROM sessions WHERE id = ?").run(id);
}

// ---- messages ----

export function addMessage(
  sessionId: string,
  role: Role,
  content: unknown,
  usage: PiUsage | null = null,
): void {
  db.prepare(
    "INSERT INTO messages (session_id, role, content, usage, created_at) VALUES (?, ?, ?, ?, ?)",
  ).run(sessionId, role, JSON.stringify(content), usage ? JSON.stringify(usage) : null, Date.now());
  touchSession(sessionId);
}

export function listMessages(sessionId: string): StoredMessage[] {
  const rows = db
    .prepare(
      "SELECT id, session_id AS sessionId, role, content, usage, created_at AS createdAt FROM messages WHERE session_id = ? ORDER BY id ASC",
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

export function createFlow(workspaceId: string, name: string, sourceName: string | null = null, kind: FlowKind = "single"): Flow {
  const id = randomUUID();
  const ws = getWorkspace(workspaceId);
  if (!ws) throw new Error("workspace not found");
  const folderPath = join(ws.rootPath, "flows", id);
  mkdirSync(folderPath, { recursive: true });
  const now = Date.now();
  db.prepare(
    "INSERT INTO flows (id, workspace_id, name, folder_path, source_name, kind, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
  ).run(id, workspaceId, name, folderPath, sourceName, kind, now, now);
  return { id, workspaceId, name, folderPath, sourceName, kind, createdAt: now, updatedAt: now };
}

export function listFlows(workspaceId: string): Flow[] {
  return db
    .prepare(
      "SELECT id, workspace_id AS workspaceId, name, folder_path AS folderPath, source_name AS sourceName, kind, created_at AS createdAt, updated_at AS updatedAt FROM flows WHERE workspace_id = ? ORDER BY updated_at DESC",
    )
    .all(workspaceId) as unknown as Flow[];
}

export function getFlow(id: string): Flow | undefined {
  return db
    .prepare(
      "SELECT id, workspace_id AS workspaceId, name, folder_path AS folderPath, source_name AS sourceName, kind, created_at AS createdAt, updated_at AS updatedAt FROM flows WHERE id = ?",
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

export function deleteFlow(id: string): void {
  // DB only — folder on disk is intentionally retained (mirrors workspace delete semantics).
  db.prepare("DELETE FROM flow_messages WHERE flow_id = ?").run(id);
  db.prepare("DELETE FROM flow_runs WHERE flow_id = ?").run(id);
  db.prepare("DELETE FROM workspace_paths WHERE flow_id = ?").run(id);
  db.prepare("DELETE FROM flows WHERE id = ?").run(id);
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

// ---- workspace paths ----

const VALID_FOLDERS = new Set<string>(["draw_data", "clean_data", "report"]);

export function addWorkspacePath(workspaceId: string, folder: string, path: string, sessionId: string | null = null, flowId: string | null = null): WorkspacePath {
  if (!VALID_FOLDERS.has(folder)) throw new Error(`invalid folder: ${folder}`);
  const now = Date.now();
  const result = db
    .prepare("INSERT INTO workspace_paths (workspace_id, session_id, flow_id, folder, path, added_at) VALUES (?, ?, ?, ?, ?, ?)")
    .run(workspaceId, sessionId, flowId, folder, path, now);
  return { id: Number(result.lastInsertRowid), workspaceId, sessionId, flowId, folder: folder as WorkspaceFolderName, path, addedAt: now };
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
      `SELECT id, workspace_id AS workspaceId, session_id AS sessionId, flow_id AS flowId, folder, path, added_at AS addedAt FROM workspace_paths WHERE ${where} ORDER BY folder, added_at ASC`,
    )
    .all(...params) as unknown as WorkspacePath[];
}

export function removeWorkspacePath(id: number): void {
  db.prepare("DELETE FROM workspace_paths WHERE id = ?").run(id);
}
