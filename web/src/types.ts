// Mirror of server/src/types.ts (protocol contract).

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

export interface PiModel {
  id: string;       // "provider/modelId" — passed as-is to pi --model
  provider: string;
  model: string;
  isDefault: boolean;
}

export interface Workspace {
  id: string;
  name: string;
  rootPath: string;
  createdAt: number;
}

export interface Session {
  id: string;
  workspaceId: string;
  title: string;
  workflowId: string | null;
  createdAt: number;
  updatedAt: number;
}

export type FlowKind = "single" | "multi";

export interface Flow {
  id: string;
  workspaceId: string;
  name: string;
  folderPath: string;
  sourceName: string | null;
  kind: FlowKind;
  createdAt: number;
  updatedAt: number;
}

// ---- Workflow definition (stored as workflow.json in flow folder) ----

export interface WorkflowNode {
  id: string;
  /** Human-readable name shown in the flow chart */
  label: string;
  /** System / user prompt template. Supports {{input_name}} placeholders. */
  prompt: string;
  /** Model id like "anthropic/claude-sonnet-4", empty = inherit from flow default */
  model: string;
  /** Position on the canvas (auto-calculated if omitted) */
  position?: { x: number; y: number };
}

export interface WorkflowEdge {
  id: string;
  source: string;
  target: string;
}

export interface WorkflowDef {
  version: 1;
  /** Default model for nodes that don't specify one */
  defaultModel: string;
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
}

export interface FlowTreeNode {
  name: string;
  path: string;
  kind: "file" | "dir";
  size?: number;
  mtime: number;
  children?: FlowTreeNode[];
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

export type Role = "user" | "assistant" | "system" | "tool";

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

export interface PiTextBlock {
  type: "text";
  text: string;
}

// pi content blocks (tolerant — render known kinds, pass the rest through).
export type ContentBlock =
  | { type: "text"; text: string }
  | { type: "tool_use"; id?: string; name?: string; input?: unknown }
  | { type: "tool_result"; tool_use_id?: string; content?: unknown; is_error?: boolean }
  | { type: "thinking"; thinking?: string; text?: string }
  | { type: string; [k: string]: unknown };

export function asBlocks(content: unknown): ContentBlock[] {
  return Array.isArray(content) ? (content as ContentBlock[]) : [];
}

export interface PiMessage {
  role: Role;
  content: unknown[];
  timestamp: number;
  model?: string;
  provider?: string;
  usage?: PiUsage;
  stopReason?: string;
  errorMessage?: string;
}

export interface StoredMessage {
  id: number;
  sessionId: string;
  role: Role;
  content: unknown[];
  usage: PiUsage | null;
  createdAt: number;
}

export interface StoredFlowMessage {
  id: number;
  flowId: string;
  role: Role;
  content: unknown[];
  usage: PiUsage | null;
  createdAt: number;
}

export type PiEvent =
  | { type: "session"; id: string; cwd: string }
  | { type: "agent_start" }
  | { type: "turn_start" }
  | { type: "message_start"; message: PiMessage }
  | { type: "message_end"; message: PiMessage }
  | { type: "turn_end"; message: PiMessage; toolResults: unknown[] }
  | { type: "agent_end"; messages: PiMessage[]; willRetry: boolean }
  | { type: string; [k: string]: unknown };

export type ServerMessage =
  | { type: "pi_event"; sessionId: string; event: PiEvent }
  | { type: "flow_event"; flowId: string; event: PiEvent }
  | { type: "flow_run_event"; flowId: string; runId: string; event: PiEvent }
  | { type: "run_start"; sessionId?: string; flowId?: string; runId?: string }
  | { type: "run_end"; sessionId?: string; flowId?: string; runId?: string; code: number | null }
  | { type: "error"; sessionId?: string; flowId?: string; runId?: string; message: string };

export type ClientMessage =
  | { type: "send"; sessionId: string; text: string; model?: string }
  | { type: "send_flow"; flowId: string; text: string; model?: string }
  | { type: "execute_flow"; flowId: string; runId: string; text: string; model?: string };

/** Helper: extract concatenated text from pi content blocks. */
export function textOf(content: unknown[]): string {
  return content
    .filter((b): b is PiTextBlock => typeof b === "object" && b !== null && (b as PiTextBlock).type === "text")
    .map((b) => b.text)
    .join("");
}
