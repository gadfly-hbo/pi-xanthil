// Domain + protocol types shared conceptually with the web client.
// (Duplicated in web/src/types.ts to keep the two packages decoupled.)

export interface Workspace {
  id: string;
  name: string;
  rootPath: string;
  createdAt: number;
}

export type WorkspaceFolderName = "draw_data" | "clean_data" | "report";
export type WorkspacePathKind = "file" | "dir";

export interface WorkspacePath {
  id: number;
  workspaceId: string;
  sessionId: string | null;
  flowId: string | null;
  folder: WorkspaceFolderName;
  path: string;
  kind: WorkspacePathKind;
  /** SHA-256 of file content; null for directories or if hash hasn't been computed yet. */
  fileHash: string | null;
  addedAt: number;
}

export interface FileAnalysis {
  fileHash: string;
  /** Free-text analysis to inject into context (field dictionary, schema, summary). */
  content: string;
  updatedAt: number;
}

export interface Session {
  id: string;
  workspaceId: string;
  title: string;
  workflowId: string | null;
  createdAt: number;
  updatedAt: number;
}

export type SessionRuntimeStatus = "idle" | "running" | "compacting" | "error";

export interface SessionRuntime {
  sessionId: string;
  status: SessionRuntimeStatus;
  contextTokens: number | null;
  contextWindow: number | null;
  contextPercent: number | null;
  compactCount: number;
  lastCompactedAt: number | null;
  autoCompactionEnabled: boolean;
  lastError: string | null;
  updatedAt: number;
}

export interface SessionArtifactTree {
  rootPath: string;
  source: string;
  hasConfiguredReportPath: boolean;
  tree: {
    name: string;
    path: string;
    kind: "file" | "dir";
    size?: number;
    mtime: number;
    children?: SessionArtifactTree["tree"][];
  };
}

export type Role = "user" | "assistant" | "system" | "tool";

export interface StoredMessage {
  id: number;
  sessionId: string;
  role: Role;
  content: unknown; // pi content blocks (text / tool_use / tool_result ...)
  usage: PiUsage | null;
  errorMessage: string | null;
  createdAt: number;
}

// ---- AgentFlow ----

export type FlowKind = "single" | "multi";
export type FlowGenerationStatus = "draft" | "generating" | "ready" | "failed";

export interface Flow {
  id: string;
  workspaceId: string;
  name: string;
  folderPath: string;       // <workspace_root>/flows/<id>/
  sourceName: string | null; // imported source folder display name (if any)
  sourceSessionId: string | null;
  generationStatus: FlowGenerationStatus;
  generationError: string | null;
  kind: FlowKind;
  createdAt: number;
  updatedAt: number;
}

export interface WorkflowFavorite {
  id: string;
  name: string;
  sourceFlowId: string;
  sourceWorkspaceId: string;
  sourceWorkspaceName: string;
  snapshotPath: string;
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

export interface DecisionTreeNode {
  id: string;
  title: string;
  body: string;
  kind: "root" | "factor" | "evidence" | "conclusion";
  parentId?: string;
}

export interface DecisionTreeResult {
  nodes: DecisionTreeNode[];
  model: string;
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

// ---- Workflow evaluations ----

export type EvaluationStatus = "running" | "success" | "failed";
export type EvaluationResultStatus = "pending" | "running" | "success" | "failed";

export interface EvaluationFlowConfig {
  defaultModel?: string;
  nodeModels?: Record<string, string>;
}

export interface WorkflowEvaluation {
  id: string;
  workspaceId: string;
  prompt: string;
  rubric: string;
  model: string;
  judgeModel: string;
  flowConfigs: Record<string, EvaluationFlowConfig>;
  repeat: number;
  status: EvaluationStatus;
  createdAt: number;
  endedAt: number | null;
  error: string | null;
}

export interface WorkflowEvaluationResult {
  id: string;
  evaluationId: string;
  flowId: string;
  flowName: string;
  attempt: number;
  status: EvaluationResultStatus;
  startedAt: number | null;
  endedAt: number | null;
  durationSec: number;
  totalTokens: number;
  totalCost: number;
  toolCalls: number;
  outputChars: number;
  output: string;
  error: string | null;
  judgeScore: number | null;
  judgeDetails: string;
}

export interface WorkflowEvaluationDetail extends WorkflowEvaluation {
  results: WorkflowEvaluationResult[];
}

// ---- Token usage / cache stats ----

export interface SessionTokenStats {
  sessionId: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  turnCount: number;
  totalCost: number;
  /** cacheReadTokens / (inputTokens + cacheReadTokens + cacheWriteTokens) */
  cacheHitRate: number;
  updatedAt: number;
}

export interface TraceOverview {
  todaySessions: number;
  todayFlowRuns: number;
  runningRuns: number;
  successRuns: number;
  failedRuns: number;
  errorEvents: number;
  recentActivityAt: number | null;
}

export type TraceTargetKind = "session" | "flow" | "flow_run" | "runtime" | "message";

export interface TraceEvent {
  id: string;
  time: number;
  type: string;
  target: string;
  targetKind: TraceTargetKind;
  targetId: string;
  status: "success" | "failed" | "running" | "idle" | "compacting" | "aborted";
  detail: string | null;
}

export interface TraceTimelineItem {
  id: string;
  time: number;
  type: string;
  title: string;
  detail: string | null;
  status: "success" | "failed" | "running" | "idle" | "compacting" | "aborted";
}

export type TraceErrorType = "validation" | "path_missing" | "stream_interrupt" | "dependency_missing" | "model_config" | "runtime" | "aborted" | "unknown";

export interface TraceFailure {
  id: string;
  title: string;
  count: number;
  source: string;
  errorType: TraceErrorType;
  lastSeenAt: number;
}

export interface TraceRuleSuggestion {
  id: string;
  title: string;
  evidence: string;
  severity: "low" | "medium" | "high";
  sourceEventIds: string[];
  createdAt: number;
}

export interface TraceTrendPoint {
  day: string;
  sessions: number;
  runs: number;
  failures: number;
  events: number;
}

export type RuleMemoryScope = "global" | "chat" | "workflow";

export interface RuleMemory {
  id: string;
  workspaceId: string;
  title: string;
  evidence: string;
  source: "trace" | "manual";
  severity: "low" | "medium" | "high";
  scope: RuleMemoryScope;
  enabled: boolean;
  createdAt: number;
  updatedAt: number;
}

// ---- analysis standards (指标体系) ----
// Unified store for two kinds of analysis assets:
//   - "metric": structured indicator definition (name/formula/caliber), injected in full.
//   - "reference_file": a standard reference document (e.g. brand→category mapping).
//     Only its path + purpose are injected (token-cheap); the agent reads it on demand.
export type AnalysisStandardKind = "metric" | "reference_file";

export interface AnalysisStandard {
  id: string;
  workspaceId: string;
  kind: AnalysisStandardKind;
  name: string;
  category: string;
  description: string;
  // metric-only
  formula: string;
  caliber: string;
  unit: string;
  // reference_file-only
  filePath: string;
  fileHash: string | null;
  enabled: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface CreateRuleResult {
  rule: RuleMemory;
  created: boolean;
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

export interface PiSkill {
  name: string;
  description: string;
  path: string;
  source: "global" | "project";
  available: boolean;
  error?: string;
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
  | { type: "send"; sessionId: string; text: string; model?: string; skillPaths?: string[]; injectRulesPrompt?: boolean }
  | { type: "abort"; sessionId: string }
  | { type: "send_flow"; flowId: string; text: string; model?: string; systemPrompt?: string; skillPaths?: string[]; injectRulesPrompt?: boolean }
  | { type: "abort_flow"; flowId: string }
  | { type: "abort_multi_agent"; flowId: string; runId: string }
  | { type: "execute_flow"; flowId: string; runId: string; text: string; model?: string; injectRulesPrompt?: boolean }
  | { type: "execute_multi_agent"; flowId: string; runId: string; inputs?: Record<string, string>; model?: string; injectRulesPrompt?: boolean }
  | { type: "subscribe"; sessionId: string };

export type ServerMessage =
  | { type: "pi_event"; sessionId: string; event: PiEvent }
  | { type: "flow_event"; flowId: string; event: PiEvent }
  | { type: "flow_run_event"; flowId: string; runId: string; event: PiEvent }
  | { type: "run_start"; sessionId?: string; flowId?: string; runId?: string }
  | { type: "run_end"; sessionId?: string; flowId?: string; runId?: string; code: number | null; aborted?: boolean }
  | { type: "error"; sessionId?: string; flowId?: string; runId?: string; message: string }
  // ---- Multi-agent execution events ----
  | { type: "agent_step_start"; flowId: string; runId: string; nodeId: string }
  | { type: "agent_step_end"; flowId: string; runId: string; nodeId: string; code: number | null }
  | { type: "agent_event"; flowId: string; runId: string; nodeId: string; event: PiEvent }
  | { type: "blackboard_update"; flowId: string; runId: string; key: string; value: string };
