// Mirror of server/src/types.ts (protocol contract).

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
  fileHash: string | null;
  addedAt: number;
}

export interface FileAnalysis {
  fileHash: string;
  content: string;
  updatedAt: number;
}

export interface ExtractionTool {
  id: string;
  name: string;
  version: string;
  description: string;
  entry: string;
  runtime: "python3";
  input: {
    accept: string[];
    modes: Array<"file" | "directory">;
  };
  output: string[];
}

export interface ExtractionRunResult {
  file: string;
  crowdName?: string;
  totalTags?: number;
  matchedTags?: number;
  newCities?: number;
  matchRate?: string;
  error?: string;
  outputs: string[];
}

export interface ExtractionRun {
  runId: string;
  toolId: string;
  success: number;
  failed: number;
  error?: string;
  stdout: string;
  stderr: string;
  results: ExtractionRunResult[];
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

export type AnalysisStandardKind = "metric" | "reference_file";

export interface AnalysisStandard {
  id: string;
  workspaceId: string;
  kind: AnalysisStandardKind;
  name: string;
  category: string;
  description: string;
  formula: string;
  caliber: string;
  unit: string;
  filePath: string;
  fileHash: string | null;
  enabled: boolean;
  createdAt: number;
  updatedAt: number;
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
}

export interface CreateRuleResult {
  rule: RuleMemory;
  created: boolean;
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

export interface SessionCompactResult {
  runtime: SessionRuntime;
  compacted: boolean;
  message: string;
}

export interface SessionArtifactTree {
  rootPath: string;
  source: string;
  hasConfiguredReportPath: boolean;
  tree: FlowTreeNode;
}

export type FlowKind = "single" | "multi";
export type FlowGenerationStatus = "draft" | "generating" | "ready" | "failed";

export interface Flow {
  id: string;
  workspaceId: string;
  name: string;
  folderPath: string;
  sourceName: string | null;
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

// ---- Workflow definition (stored as workflow.json in flow folder) ----

export interface WorkflowNode {
  id: string;
  /** Human-readable name shown in the flow chart */
  label: string;
  /** System / user prompt template. Supports {{node_id}} placeholders. */
  prompt: string;
  /** Model id like "anthropic/claude-sonnet-4", empty = inherit from flow default */
  model: string;
  /** Position on the canvas (auto-calculated if omitted) */
  position?: { x: number; y: number };
  // ---- Optional descriptive fields for multi-agent rendering. ----
  // All are optional so existing workflow.json files and inferred ones stay valid.
  /** Free-form role tag shown as a badge (e.g. "researcher", "writer"). */
  role?: string;
  /** Emoji or single-char icon shown on the agent card (e.g. "🔍"). */
  icon?: string;
  /** Accent color for the agent card / timeline dot. Any CSS color string. */
  color?: string;
  /** One-line description for tooltips and cards. Falls back to prompt's first line. */
  desc?: string;
  /** Explicit list of upstream node ids this node depends on. Optional — when omitted the executor uses `edges`. */
  inputs?: string[];
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
  /** Execution strategy. Defaults to "sequential" (topo-sorted single line). */
  layout?: "sequential" | "dag";
}

export interface FlowTreeNode {
  name: string;
  path: string;
  kind: "file" | "dir";
  size?: number;
  mtime: number;
  children?: FlowTreeNode[];
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

export interface PiSkill {
  name: string;
  description: string;
  path: string;
  source: "global" | "project";
  available: boolean;
  error?: string;
}

export interface StoredMessage {
  id: number;
  sessionId: string;
  role: Role;
  content: unknown[];
  usage: PiUsage | null;
  errorMessage: string | null;
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
  | { type: "run_end"; sessionId?: string; flowId?: string; runId?: string; code: number | null; aborted?: boolean }
  | { type: "error"; sessionId?: string; flowId?: string; runId?: string; message: string }
  | { type: "agent_step_start"; flowId: string; runId: string; nodeId: string }
  | { type: "agent_step_end"; flowId: string; runId: string; nodeId: string; code: number | null }
  | { type: "agent_event"; flowId: string; runId: string; nodeId: string; event: PiEvent }
  | { type: "blackboard_update"; flowId: string; runId: string; key: string; value: string };

export type ClientMessage =
  | { type: "send"; sessionId: string; text: string; model?: string; skillPaths?: string[]; injectRulesPrompt?: boolean }
  | { type: "abort"; sessionId: string }
  | { type: "send_flow"; flowId: string; text: string; model?: string; systemPrompt?: string; skillPaths?: string[]; injectRulesPrompt?: boolean }
  | { type: "abort_flow"; flowId: string }
  | { type: "abort_multi_agent"; flowId: string; runId: string }
  | { type: "execute_flow"; flowId: string; runId: string; text: string; model?: string; injectRulesPrompt?: boolean }
  | { type: "execute_multi_agent"; flowId: string; runId: string; inputs?: Record<string, string>; model?: string; injectRulesPrompt?: boolean };

/** Helper: extract concatenated text from pi content blocks. */
export function textOf(content: unknown[]): string {
  return content
    .filter((b): b is PiTextBlock => typeof b === "object" && b !== null && (b as PiTextBlock).type === "text")
    .map((b) => b.text)
    .join("");
}
