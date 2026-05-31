// Domain + protocol types shared conceptually with the web client.
// (Duplicated in web/src/types.ts to keep the two packages decoupled.)

export interface Workspace {
  id: string;
  name: string;
  rootPath: string;
  createdAt: number;
}

export type WorkspaceFolderName = "draw_data" | "clean_data" | "report";

export interface WorkspacePath {
  id: number;
  workspaceId: string;
  sessionId: string | null;
  flowId: string | null;
  folder: WorkspaceFolderName;
  path: string;
  addedAt: number;
}

export interface Session {
  id: string;
  workspaceId: string;
  title: string;
  workflowId: string | null;
  createdAt: number;
  updatedAt: number;
}

export type Role = "user" | "assistant" | "system" | "tool";

export interface StoredMessage {
  id: number;
  sessionId: string;
  role: Role;
  content: unknown; // pi content blocks (text / tool_use / tool_result ...)
  usage: PiUsage | null;
  createdAt: number;
}

// ---- AgentFlow ----

export type FlowKind = "single" | "multi";

export interface Flow {
  id: string;
  workspaceId: string;
  name: string;
  folderPath: string;       // <workspace_root>/flows/<id>/
  sourceName: string | null; // imported source folder display name (if any)
  kind: FlowKind;
  createdAt: number;
  updatedAt: number;
}

export interface StoredFlowMessage {
  id: number;
  flowId: string;
  role: Role;
  content: unknown;
  usage: PiUsage | null;
  createdAt: number;
}

export type FlowRunStatus = "running" | "success" | "failed" | "aborted";

export interface FlowRun {
  id: string;
  flowId: string;
  inputs: unknown;
  status: FlowRunStatus;
  startedAt: number;
  endedAt: number | null;
  outputDir: string;
}

// ---- pi cli `--mode json` NDJSON event envelope (observed from pi 0.77.0) ----

export interface PiCost {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  total: number;
}

export interface PiUsage {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  totalTokens: number;
  cost: PiCost;
}

export interface PiMessage {
  role: Role;
  content: unknown[];
  timestamp: number;
  api?: string;
  provider?: string;
  model?: string;
  usage?: PiUsage;
  stopReason?: string;
  errorMessage?: string;
}

// Tolerant: we type the events we act on, pass the rest through untouched.
export type PiEvent =
  | { type: "session"; version: number; id: string; timestamp: string; cwd: string }
  | { type: "agent_start" }
  | { type: "turn_start" }
  | { type: "message_start"; message: PiMessage }
  | { type: "message_end"; message: PiMessage }
  | { type: "turn_end"; message: PiMessage; toolResults: unknown[] }
  | { type: "agent_end"; messages: PiMessage[]; willRetry: boolean }
  | { type: string; [k: string]: unknown };

// ---- WebSocket protocol: client <-> gateway ----

export type ClientMessage =
  | { type: "send"; sessionId: string; text: string; model?: string }
  | { type: "send_flow"; flowId: string; text: string; model?: string }
  | { type: "execute_flow"; flowId: string; runId: string; text: string; model?: string }
  | { type: "subscribe"; sessionId: string };

export type ServerMessage =
  | { type: "pi_event"; sessionId: string; event: PiEvent }
  | { type: "flow_event"; flowId: string; event: PiEvent }
  | { type: "flow_run_event"; flowId: string; runId: string; event: PiEvent }
  | { type: "run_start"; sessionId?: string; flowId?: string; runId?: string }
  | { type: "run_end"; sessionId?: string; flowId?: string; runId?: string; code: number | null }
  | { type: "error"; sessionId?: string; flowId?: string; runId?: string; message: string };
