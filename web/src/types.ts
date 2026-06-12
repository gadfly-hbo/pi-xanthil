// Mirror of server/src/types.ts (protocol contract).

// ---- SQL connections ----
export type DbType = "sqlite" | "postgresql" | "mysql";
export type RiskLevel = "L0" | "L1" | "L2" | "L3";

export interface SqlValidateResult {
  safe: boolean;
  risks: string[];
  suggestions: string[];
  riskLevel: RiskLevel;
}

export interface SavedQuery {
  id: string;
  name: string;
  sql: string;
  description?: string;
  parameters?: ToolParameter[];
}

export interface SqlConnection {
  id: string;
  name: string;
  type: DbType;
  filePath?: string;
  host?: string;
  port?: number;
  database?: string;
  username?: string;
  password?: string;
  ssl?: boolean;
  lastTestedAt?: number;
  lastTestOk?: boolean;
  createdAt: number;
  queries?: SavedQuery[];
}

export interface SchemaColumn { name: string; type: string; nullable: boolean }
export interface SchemaTable { schema?: string; name: string; columns: SchemaColumn[] }

export interface SqlQueryResult {
  columns: string[];
  rows: Record<string, unknown>[];
  rowCount: number;
  executionMs: number;
  capped: boolean;
  validation?: SqlValidateResult;
  summary?: QuerySummary;
}

export interface QuerySummary {
  numericColumns: Array<{ name: string; min: number; max: number; avg: number; sum: number }>;
  categoricalColumns: Array<{ name: string; uniqueCount: number; topValue: string }>;
  dateRange?: { min: string; max: string };
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
  fileHash: string | null;
  addedAt: number;
  exists?: boolean;
  currentKind?: WorkspacePathKind | null;
  size?: number | null;
  mtime?: number | null;
  status?: "ok" | "missing" | "kind_mismatch";
}

export interface FileAnalysis {
  fileHash: string;
  content: string;
  updatedAt: number;
}

export interface ToolParameter {
  name: string;
  label: string;
  type: "string" | "number" | "boolean" | "select" | "date";
  required?: boolean;
  default?: string | number | boolean;
  options?: string[];
  description?: string;
}

export interface ExtractionTool {
  id: string;
  name: string;
  version: string;
  description: string;
  entry: string;
  runtime: "python3";
  timeoutMs?: number;
  parameters?: ToolParameter[];
  resultColumns?: Array<{ key: string; label: string }>;
  riskLevel?: RiskLevel;
  allowedUse?: string;
  forbiddenUse?: string;
  failureHandling?: string;
  traceFields?: string[];
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
  [key: string]: unknown;
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

export type TokenUsageTargetKind =
  | "session"
  | "flow"
  | "flow_run"
  | "toc"
  | "decision_tree"
  | "golden_strategy"
  | "business_requirement"
  | "report_version"
  | "workflow_promotion"
  | "evaluation"
  | "repair";

export interface TokenUsageStats {
  workspaceId: string;
  targetKind: TokenUsageTargetKind;
  targetId: string;
  title: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  turnCount: number;
  totalCost: number;
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

export type MemoryProposalStatus = "pending" | "approved" | "rejected";
export type MemoryProposalKind = "rule";

export interface MemoryProposalRiskFlag {
  code: "instruction_injection" | "pii" | "weak_evidence" | "overbroad";
  severity: "low" | "medium" | "high";
  message: string;
}

export interface MemoryProposal {
  id: string;
  workspaceId: string;
  kind: MemoryProposalKind;
  title: string;
  evidence: string;
  source: "trace" | "manual";
  severity: "low" | "medium" | "high";
  scope: RuleMemoryScope;
  sourceEventIds: string[];
  confidence: number;
  riskFlags: MemoryProposalRiskFlag[];
  status: MemoryProposalStatus;
  rejectionReason: string;
  approvedRuleId: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface TraceTrendPoint {
  day: string;
  sessions: number;
  runs: number;
  failures: number;
  events: number;
}

export type MemorySourceKind = "businessContext" | "rules" | "standards" | "cases" | "knowledgeGraph";

export interface MemorySourceSnapshot {
  kind: MemorySourceKind;
  label: string;
  count: number;
  updatedAt: number | null;
  charCount: number;
  tokenEstimate: number;
  promptHash: string | null;
  injected: boolean;
  selected?: boolean;
  selectionReason?: string;
  omittedReason?: string | null;
  usage?: MemoryUsageStats | null;
  itemIds?: string[];
  meta?: Record<string, number | string | null>;
}

export interface MemoryInjectionSnapshot {
  requested: boolean;
  targetScope: "chat" | "workflow";
  injected: boolean;
  promptHash: string | null;
  charCount: number;
  tokenEstimate: number;
  tokenBudget?: number;
  sourceCount: number;
  sources: MemorySourceSnapshot[];
}

export interface MemoryUsageStats {
  workspaceId: string;
  sourceKind: MemorySourceKind;
  sourceId: string;
  usedCount: number;
  lastUsedAt: number | null;
  positiveSignals: number;
  negativeSignals: number;
  staleAfterDays: number;
  updatedAt: number;
}

export interface MemoryInjectionRecord {
  eventId: string;
  workspaceId: string;
  targetKind: string;
  targetId: string;
  target: string;
  status: string;
  createdAt: number;
  snapshot: MemoryInjectionSnapshot;
}

export type MemoryEvalVariant = "baseline" | "memory";

export interface MemoryEvaluation {
  id: string;
  workspaceId: string;
  prompt: string;
  rubric: string;
  model: string;
  judgeModel: string;
  targetScope: "chat" | "workflow";
  repeat: number;
  status: EvaluationStatus;
  createdAt: number;
  endedAt: number | null;
  error: EvaluationError | null;
}

export interface MemoryEvaluationResult {
  id: string;
  evaluationId: string;
  variant: MemoryEvalVariant;
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
  error: EvaluationError | null;
  judgeScore: number | null;
  judgeDetails: string;
  memorySnapshot: MemoryInjectionSnapshot | null;
}

export interface MemoryEvaluationDetail extends MemoryEvaluation {
  results: MemoryEvaluationResult[];
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
  version: number;
  supersedesRuleId: string | null;
  changeReason: string;
  createdAt: number;
  updatedAt: number;
}

// ---- 工作区记忆启用关系（全局池 + 按工作区启用，总控契约）----
// 池内定义为「共享单实例」：编辑全局生效；启用关系仅控本工作区"用不用"。
// 迁移：现有定义按 origin workspace 建启用记录（仅原工作区启用）。
export type MemoryItemKind =
  | "rule"             // rule_memories 偏好记忆
  | "standard"         // analysis_standards 参考文件
  | "business_context" // business_contexts 业务环境
  | "case"             // analysis_cases 项目记忆
  | "metric"           // metric_definitions 指标记忆
  | "ontology"         // onto-xanthil：启用粒度=本体整体（P3 落地）
  | "failure" | "field" | "process"; // 预留占位模块（失败/字段/流程记忆）

export interface WorkspaceMemoryEnablement {
  workspaceId: string;
  itemKind: MemoryItemKind;
  itemId: string;
  enabled: boolean;
  createdAt: number;
}

export interface RuleConflict {
  id: string;
  workspaceId: string;
  ruleAId: string;
  ruleBId: string;
  reason: string;
  severity: "low" | "medium" | "high";
  status: "open" | "ignored" | "resolved";
  createdAt: number;
  updatedAt: number;
}

export interface MemoryFailureAttribution {
  id: string;
  workspaceId: string;
  targetKind: string;
  targetId: string;
  cause: "rule_missing" | "rule_wrong" | "case_misleading" | "business_context_stale" | "kg_wrong" | "model_noncompliance";
  sourceKind: MemorySourceKind | null;
  sourceId: string | null;
  note: string;
  createdAt: number;
}

export type BusinessContextCategory = "org" | "status" | "glossary" | "constraint" | "history" | "goal";

export interface BusinessContext {
  id: string;
  workspaceId: string;
  category: BusinessContextCategory;
  title: string;
  content: string;
  enabled: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface AnalysisCase {
  id: string;
  workspaceId: string;
  title: string;
  category: string;
  scenario: string;
  approach: string;
  conclusion: string;
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

export type HypothesisVerdict = "confirmed" | "rejected" | "partial";

export interface HypothesisEntry {
  id: string;
  workspaceId: string;
  scene: string;
  hypothesis: string;
  verdict: HypothesisVerdict;
  evidence: string;
  impact: string;
  source: "archive" | "manual";
  enabled: boolean;
  confirmCount: number;
  rejectCount: number;
  partialCount: number;
  createdAt: number;
  updatedAt: number;
}

export interface HypothesisEntryInput {
  scene: string;
  hypothesis: string;
  verdict: HypothesisVerdict;
  evidence: string;
  impact: string;
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
  /** Node-level skill override. Empty array disables workflow default skills for this node. */
  skillPaths?: string[];
  /** AnaX: deliverable filename; node output is also written to runDir/specs/<spec>. */
  spec?: string;
  /** AnaX: "gate" nodes parse a structured verdict and may block the flow. Tool nodes run registered extraction tools. */
  kind?: "agent" | "gate" | "tool";
  /** Tool step: registered extraction tool id. */
  toolId?: string;
  /** Tool step: input file/directory path template. Supports {{input.*}} and upstream node placeholders. */
  inputPath?: string;
  /** Tool step: output directory path template. Defaults to the node run directory. */
  outputDir?: string;
  /** Tool step: execution timeout in milliseconds. */
  timeoutMs?: number;
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
  /** Workflow-level skill fallback for nodes without their own skillPaths. */
  defaultSkillPaths?: string[];
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

export type GoldenStrategyModelId =
  | "decision_tree"
  | "toc"
  | "swot"
  | "pestel"
  | "porter_five_forces"
  | "value_chain"
  | "bcg_matrix"
  | "ansoff_matrix"
  | "marketing_4p"
  | "business_model_canvas";

export type GoldenStrategyNodeKind =
  | "root"
  | "factor"
  | "evidence"
  | "conclusion"
  | "goal"
  | "symptom"
  | "constraint"
  | "root_cause"
  | "action"
  | "monitor"
  | "strength"
  | "weakness"
  | "opportunity"
  | "threat"
  | "political"
  | "economic"
  | "social"
  | "technological"
  | "environmental"
  | "legal"
  | "rivalry"
  | "supplier"
  | "buyer"
  | "substitute"
  | "new_entrant"
  | "primary_activity"
  | "support_activity"
  | "star"
  | "cash_cow"
  | "question_mark"
  | "dog"
  | "market_penetration"
  | "market_development"
  | "product_development"
  | "diversification"
  | "product"
  | "price"
  | "place"
  | "promotion"
  | "customer_segment"
  | "value_proposition"
  | "channel"
  | "customer_relationship"
  | "revenue_stream"
  | "key_resource"
  | "key_activity"
  | "key_partner"
  | "cost_structure";

export interface GoldenStrategyNode {
  id: string;
  title: string;
  body: string;
  kind: GoldenStrategyNodeKind;
  parentId?: string;
}

export interface GoldenStrategyResult {
  analysisModel: GoldenStrategyModelId;
  nodes: GoldenStrategyNode[];
  model: string;
  path: string;
  html: string;
}

export interface GoldenStrategyError {
  analysisModel: GoldenStrategyModelId;
  error: string;
}

export interface GoldenStrategyBatchResult {
  results: GoldenStrategyResult[];
  errors: GoldenStrategyError[];
}

// ─── actions（分析→行动→执行 闭环）──────────────────────────────
// 探索 tab「黄金策」后的「行动」二级 tab：报告 →①提取行动项 →②采纳建任务 →③执行反馈 → 回流知识。
export type ActionScene = "开业" | "日常" | "假日" | "大促"; // 单店模型场景运营
export type ActionLifecycle = "A获取" | "A激活" | "R培育" | "R复购" | "R裂变"; // 会员运营 AARRR SOP
export type ActionPriority = "high" | "medium" | "low";
export type ActionEffort = "high" | "medium" | "low";
export type ActionItemStatus = "suggested" | "adopted" | "dismissed";
export type ActionTaskStatus = "todo" | "doing" | "done" | "cancelled";

// LLM 从报告提取的行动项草稿（未落库，前端确认后转 ActionItem）
export interface ActionItemDraft {
  title: string;
  rationale: string; // 依据：命中报告哪条发现
  scene?: ActionScene;
  lifecycle?: ActionLifecycle;
  expectedImpact: string; // 预期效果
  metricRef?: string; // 关联指标（自由文本，下轮接语义层）
  priority: ActionPriority;
  effort: ActionEffort;
  confidence: number; // 0..1
}

export interface ActionItem extends ActionItemDraft {
  id: string;
  sourceKind: "session" | "flow-run";
  scopeId: string; // sessionId 或 flowId
  runId?: string;
  reportPath: string;
  status: ActionItemStatus;
  createdAt: number;
  updatedAt: number;
}

export interface ActionItemInput {
  sourceKind: "session" | "flow-run";
  scopeId: string;
  runId?: string;
  reportPath: string;
  title: string;
  rationale: string;
  scene?: ActionScene;
  lifecycle?: ActionLifecycle;
  expectedImpact: string;
  metricRef?: string;
  priority: ActionPriority;
  effort: ActionEffort;
  confidence: number;
}

export interface ActionTask {
  id: string;
  actionItemId: string;
  title: string;
  owner: string;
  dueDate?: string; // ISO date
  status: ActionTaskStatus;
  priority: ActionPriority;
  note: string;
  createdAt: number;
  updatedAt: number;
}

export interface ActionTaskInput {
  actionItemId: string;
  title: string;
  owner?: string;
  dueDate?: string;
  status?: ActionTaskStatus;
  priority?: ActionPriority;
  note?: string;
}

export interface ActionFeedback {
  id: string;
  taskId: string;
  adopted: boolean; // 是否采纳
  outcome: string; // 执行结果
  metricDelta: string; // 指标变化（自由文本）
  review: string; // 复盘 lessons
  score?: number; // 0..5 评分
  createdAt: number;
}

export interface ActionFeedbackInput {
  adopted: boolean;
  outcome?: string;
  metricDelta?: string;
  review?: string;
  score?: number;
}

// ---- Fork 分支 & 委派子 agent（数据分析对话防上下文撑爆）----
// 心智：开子 pi session 干重活，只把结论回流主 session。回流 = 给主 session 发普通消息（前端编排）。

export interface ForkBranch {
  id: string;
  parentSessionId: string;
  branchSessionId: string; // 分支是一个真实 session（复用 messages/runtime/send 机制）
  title: string;
  seeded: boolean; // 首轮是否已用 --fork 从父 session 播种
  status: "idle" | "running" | "done" | "error";
  createdAt: number;
}

export type SubAgentTaskStatus = "running" | "success" | "failed" | "aborted";

export interface SubAgentTask {
  id: string;
  parentSessionId: string;
  brief: string;
  dataFiles: string[]; // 020_clean 标准目录内的相对/绝对路径
  model?: string;
  status: SubAgentTaskStatus;
  summary?: string; // 子 agent 末条结论（供回流预填）
  reportPath?: string; // 060_reports 内产报告（供回流引用）
  error?: string;
  createdAt: number;
  endedAt?: number;
}

export interface SubAgentTaskInput {
  brief: string;
  dataFiles: string[];
  model?: string;
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
export type EvaluationErrorCode =
  | "workspace_not_found"
  | "flow_not_found"
  | "workflow_invalid"
  | "process_exit"
  | "judge_failed"
  | "unknown";

export interface EvaluationError {
  code: EvaluationErrorCode;
  message: string;
  hint?: string;
  cause?: string;
}

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
  error: EvaluationError | null;
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
  error: EvaluationError | null;
  judgeScore: number | null;
  judgeDetails: string;
}

export interface WorkflowEvaluationDetail extends WorkflowEvaluation {
  results: WorkflowEvaluationResult[];
}

export interface SkillVariant {
  id: string;
  label: string;
  skillPaths: string[];
  retrievalMode?: boolean;
  retrievalTopK?: number;
}

export interface SkillEvalTask {
  id: string;
  prompt: string;
  expectedPoints?: string[];
  rubric?: string;
}

export interface SkillEvalSet {
  id: string;
  workspaceId: string;
  name: string;
  tasks: SkillEvalTask[];
  createdAt: number;
  updatedAt: number;
}

export interface SkillActivationEvidence {
  kind: "output_keyword" | "event_path";
  skillPath: string;
  value: string;
}

export interface SkillActivationResult {
  activated: boolean;
  matchedKeywords: string[];
  matchedSkillPaths: string[];
  evidence: SkillActivationEvidence[];
}

export interface SkillEvaluationRunResult {
  id: string;
  variantId: string;
  variantLabel: string;
  taskId: string;
  attempt: number;
  status: "success" | "failed";
  startedAt: number;
  endedAt: number;
  durationSec: number;
  skillPaths: string[];
  totalTokens: number;
  totalCost: number;
  toolCalls: number;
  outputChars: number;
  output: string;
  activation: SkillActivationResult;
  pairwise: SkillPairwiseResult | null;
  error: EvaluationError | null;
}

export type SkillPairwiseVerdict = "win" | "tie" | "loss" | "not_judged";

export interface SkillPairwiseResult {
  baselineResultId: string;
  variantResultId: string;
  taskId: string;
  attempt: number;
  verdict: SkillPairwiseVerdict;
  scoreDelta: number | null;
  baselineScore: number | null;
  variantScore: number | null;
  confidence: number | null;
  reason: string;
  error: EvaluationError | null;
  judgeRuns?: SkillPairwiseResult[];
}

export interface SkillVariantSummary {
  variantId: string;
  variantLabel: string;
  total: number;
  success: number;
  failed: number;
  activationRate: number;
  avgDurationSec: number;
  avgTotalTokens: number;
  avgTotalCost: number;
  avgToolCalls: number;
  avgOutputChars: number;
}

export interface SkillTaskSummary {
  taskId: string;
  total: number;
  success: number;
  failed: number;
  activationRate: number;
}

export interface SkillPairwiseSummary {
  variantId: string;
  variantLabel: string;
  judged: number;
  skipped: number;
  win: number;
  tie: number;
  loss: number;
  avgScoreDelta: number;
  avgConfidence: number | null;
}

export interface SkillEvaluationRunSummary {
  evaluationId: string;
  status: "success" | "failed";
  startedAt: number;
  endedAt: number;
  durationSec: number;
  results: SkillEvaluationRunResult[];
  variantSummaries: SkillVariantSummary[];
  taskSummaries: SkillTaskSummary[];
  pairwiseSummaries: SkillPairwiseSummary[];
}

export interface SkillEvaluation {
  evaluationId: string;
  workspaceId: string;
  model: string;
  repeat: number;
  status: "success" | "failed";
  startedAt: number;
  endedAt: number;
  durationSec: number;
  variants: SkillVariant[];
  tasks: SkillEvalTask[];
  contextPrefix: string;
  variantSummaries: SkillVariantSummary[];
  taskSummaries: SkillTaskSummary[];
  pairwiseSummaries: SkillPairwiseSummary[];
}

export interface SkillEvaluationDetail extends SkillEvaluation {
  results: SkillEvaluationRunResult[];
}

export type ToolExpectation =
  | { kind: "golden"; goldenDir: string; ignorePaths?: string[]; normalizeWhitespace?: boolean }
  | { kind: "schema"; jsonPath: string; schema: Record<string, unknown> }
  | { kind: "field-presence"; jsonPath: string; requiredKeys: string[] }
  | { kind: "must-fail"; expectedErrorPattern?: string }
  | { kind: "llm-judge"; rubric: string; model: string; minScore?: number };

export interface ToolEvalCase {
  id: string;
  name: string;
  inputPath: string;
  expected: ToolExpectation;
  timeoutMs?: number;
}

export interface ToolCaseSet {
  id: string;
  workspaceId: string;
  name: string;
  toolId: string;
  cases: ToolEvalCase[];
  createdAt: number;
  updatedAt: number;
}

export interface ToolEvalCaseTemplateList {
  cases: ToolEvalCase[];
}

export interface ToolRunSummary {
  success?: number;
  failed?: number;
  error?: string;
  results?: Array<{ outputs?: string[]; error?: string; [key: string]: unknown }>;
  [key: string]: unknown;
}

export interface ToolEvaluationRunResult {
  id: string;
  caseId: string;
  caseName: string;
  attempt: number;
  status: "success" | "failed";
  startedAt: number;
  endedAt: number;
  durationSec: number;
  inputPath: string;
  outputPath: string;
  stdout: string;
  stderr: string;
  summary: ToolRunSummary | null;
  expectation: ToolExpectation;
  error: EvaluationError | null;
}

export interface ToolCaseSummary {
  caseId: string;
  caseName: string;
  total: number;
  success: number;
  failed: number;
  avgDurationSec: number;
}

export interface ToolEvaluation {
  evaluationId: string;
  workspaceId: string;
  toolId: string;
  repeat: number;
  status: "success" | "failed";
  startedAt: number;
  endedAt: number;
  durationSec: number;
  caseSummaries: ToolCaseSummary[];
  cases: ToolEvalCase[];
}

export interface ToolEvaluationDetail extends ToolEvaluation {
  results: ToolEvaluationRunResult[];
}

export interface ToolEvaluationRunSummary extends ToolEvaluationDetail {
}

export interface EvaluationArchiveResult {
  markdownPath: string;
  jsonPath: string;
}

export interface EvaluationArchiveIndexItem {
  kind: "skill" | "tool";
  evaluationId: string;
  baseName: string;
  markdownPath: string;
  jsonPath: string;
  markdownRelPath: string;
  jsonRelPath: string;
  markdownSize: number;
  jsonSize: number;
  updatedAt: number;
}

// ---- Skill curation ----

export type SkillCurationProposalType = "create" | "update";

export interface SkillCurationProposal {
  type: SkillCurationProposalType;
  targetPath: string;
  suggestedContent: string;
  rationale: string;
  confidence: number;
  evidence: string[];
}

export interface SkillCurationResult {
  proposals: SkillCurationProposal[];
  analysisText: string;
  error?: string;
}

export interface SkillCurationApplyResult {
  applied: string[];
  errors: string[];
}

export interface RetrievedSkill {
  path: string;
  name: string;
  score: number;
  snippet: string;
}

export interface AutonomousRunResult {
  output: string;
  skillsUsed: RetrievedSkill[];
  durationSec: number;
  error?: string;
}

export type SkillCurationProposalStatus = "pending" | "approved" | "rejected" | "applied";

export interface SkillCurationProposalRecord extends SkillCurationProposal {
  id: string;
  workspaceId: string;
  evaluationId: string;
  status: SkillCurationProposalStatus;
  createdAt: number;
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
  | { type: "tool_use"; id?: string; name?: string; input?: unknown; status?: "running" | "completed" | "error" }
  | { type: "tool_result"; tool_use_id?: string; name?: string; content?: unknown; is_error?: boolean }
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
  | { type: "tool_call"; id?: string; tool_use_id?: string; name?: string; input?: unknown }
  | { type: "tool_result"; id?: string; tool_use_id?: string; name?: string; content?: unknown; is_error?: boolean }
  | { type: string; [k: string]: unknown };

// ---- AnaX P3 change management ----
export type ChangeProposalStatus = "proposed" | "approved" | "applied" | "rejected";

export interface ChangeProposal {
  id: string;
  workspaceId: string;
  runId: string | null;
  sourceNodeId: string | null;
  title: string;
  description: string;
  expectedImpact: string;
  status: ChangeProposalStatus;
  appliedResult: string;
  createdAt: number;
  updatedAt: number;
}

export type StaleNodeReason = "data_changed" | "manual_edit";

export interface StaleNode {
  id: number;
  runId: string;
  nodeId: string;
  reason: StaleNodeReason;
  triggeredAt: number;
}

export interface AnaxGateConfig {
  workspaceId: string;
  minConfidence: "low" | "medium" | "high";
  minEvidenceCount: number;
  minDataQualityScore: number;
}

// ---- AnaX quality gate (mirror of server/src/anax-gate.ts GateVerdict) ----
export interface AnaxRedLine {
  id: string;
  desc: string;
}
export interface AnaxStageSignal {
  stage: string;
  confidence?: "low" | "medium" | "high";
  evidence?: number;
  dataQuality?: number;
}
export interface GateVerdict {
  stage: string;
  verdict: "pass" | "blocked";
  blockers: number;
  reasons: string[];
  redLines: AnaxRedLine[];
  stages: AnaxStageSignal[];
  summary: string;
}

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
  | { type: "blackboard_update"; flowId: string; runId: string; key: string; value: string }
  | { type: "agent_gate"; flowId: string; runId: string; nodeId: string; verdict: GateVerdict }
  | { type: "anax_precheck_event"; precheckId: string; event: PiEvent }
  | { type: "anax_precheck_done"; precheckId: string; score: number | null; pass: boolean; summary: string }
  | { type: "anax_precheck_error"; precheckId: string; message: string };

export type ClientMessage =
  | { type: "send"; sessionId: string; text: string; model?: string; skillPaths?: string[]; injectRulesPrompt?: boolean; businessRequirementContext?: { pathId: number; markdownPath: string; jsonPath?: string } }
  | { type: "abort"; sessionId: string }
  | { type: "send_flow"; flowId: string; text: string; model?: string; systemPrompt?: string; skillPaths?: string[]; injectRulesPrompt?: boolean }
  | { type: "abort_flow"; flowId: string }
  | { type: "abort_multi_agent"; flowId: string; runId: string }
  | { type: "execute_flow"; flowId: string; runId: string; text: string; model?: string; injectRulesPrompt?: boolean }
  | { type: "execute_multi_agent"; flowId: string; runId: string; inputs?: Record<string, string>; model?: string; injectRulesPrompt?: boolean; resumeFromNodeId?: string; previousRunId?: string }
  | { type: "execute_anax_precheck"; precheckId: string; workspaceId: string; data_files: string; model?: string }
  | { type: "abort_anax_precheck"; precheckId: string };

// ---- Model Lab ----
export type PredictionTierColor = "red" | "orange" | "amber" | "green" | "blue" | "purple" | "neutral";
export type PredictionVariant = "neutral" | "success" | "warning" | "danger";

export interface PredictionKpi {
  label: string;
  value: string;
  sub?: string;
  variant?: PredictionVariant;
}

export interface PredictionRowResult {
  id: string;
  label?: string;
  score: number;
  tier: string;
  tierLabel: string;
  tierColor: PredictionTierColor;
  primaryConclusion: string;
  attributes?: { key: string; value: string }[];
}

export interface PredictionResult {
  modelId: string;
  summary: {
    kpis: PredictionKpi[];
    keyInsights: string[];
    recommendations: string[];
  };
  rows: PredictionRowResult[];
  rowsCapped?: boolean;
  rowsTotal?: number;
  model?: string;
  runId?: string;
}

export interface ModelLabRunSummary {
  id: string;
  modelId: string;
  model: string;
  status: "success" | "failed";
  rowCount: number;
  rowsTotal: number;
  rowsCapped: boolean;
  durationMs: number;
  createdAt: number;
  errorMessage?: string | null;
}

export interface ModelLabRunDetail extends ModelLabRunSummary {
  result: PredictionResult | null;
  rawOutput: string;
}

export type BiDatasetSlot = "member_retention" | "member_recall";

export interface BiDatasetSummary {
  id: string;
  slot: BiDatasetSlot;
  filename: string;
  rowCount: number;
  columnCount: number;
  sizeBytes: number;
  uploadedAt: number;
  active: number;
}

export interface BiDatasetDetail extends BiDatasetSummary {
  columns: string[];
  rows: Array<Record<string, unknown>>;
}

// ── 看板聚合数据源契约（P0-D/P0-B 跨域，总控持有）──
// D 暴露 clean_data 已登记聚合文件为看板可消费的结构化数据源；V 消费走 GET。
// 字段类型(FieldKind)推断在 V 前端用 profiling.ts 完成，契约只给列名+行。
export type BiCell = string | number | boolean | null;

export interface BiAggregationDataset {
  pathId: string; // workspace_paths.id（clean_data & kind=file）
  name: string;
  columns: string[];
  rowCount: number;
}

export interface BiAggregationData {
  columns: string[];
  rows: Array<Record<string, BiCell>>;
}

export interface ModelLabStatsTopModel {
  modelId: string;
  model: string;
  count: number;
  avgDurationMs: number;
}

export interface ModelLabStatsDailyPoint {
  date: string;
  count: number;
}

export interface ModelLabStats {
  totalRuns: number;
  recentRuns7d: number;
  avgDurationMs: number;
  totalRowsProcessed: number;
  dailyTrend: ModelLabStatsDailyPoint[];
  topModels: ModelLabStatsTopModel[];
}

// ---- Knowledge Graph ----

export type KgNodeType = "rule" | "metric" | "ref_file" | "biz_ctx" | "report" | "concept";
export type KgRelation = "related_to" | "references" | "supports" | "derived_from";

export interface KgNode {
  id: string;
  workspaceId: string;
  type: KgNodeType;
  sourceKey: string;
  title: string;
  summary: string;
  tags: string[];
  contentHash: string | null;
  aiExtractedHash: string | null;
  hidden: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface KgEdge {
  id: string;
  workspaceId: string;
  fromId: string;
  toId: string;
  relation: KgRelation;
  weight: number;
  auto: boolean;
  createdAt: number;
}

export interface KgSyncResult {
  nodeCount: number;
  edgeCount: number;
  syncedAt: number;
}

export interface KgExtractResult {
  newNodes: number;
  newEdges: number;
  processedReports: number;
  skippedReports: number;
  extractedAt: number;
}

/** Helper: extract concatenated text from pi content blocks. */
export function textOf(content: unknown[]): string {
  return content
    .filter((b): b is PiTextBlock => typeof b === "object" && b !== null && (b as PiTextBlock).type === "text")
    .map((b) => b.text)
    .join("");
}

// ---- Report History (Dashboard 二级 tab) ----
export type ReportFileType =
  | "final_summary"
  | "draft"
  | "supplement"
  | "handoff_log"
  | "sample_report"
  | "research_report"
  | "presentation"
  | "other";

export type ReportSource = "flow_run" | "workspace_root";

export interface ReportEntry {
  id: string;
  workspaceId: string;
  workspaceName?: string;
  source: ReportSource;
  flowId?: string;
  flowName?: string;
  runId?: string;
  filename: string;
  relativePath: string;
  absolutePath: string;
  extension: "md" | "html";
  reportType: ReportFileType;
  sizeBytes: number;
  createdAt: number;
  isFavorite: boolean;
  tags: string[];
}

// ---- frontend-only UI types (not a server protocol mirror) ----

// One-way seed passed from 业务需求 → 数据探索: only field-name hints, never data.
export interface ExploreSeed {
  fieldHints: string[];
  source: string;
}

// ---- onto-xanthil 数据语义层（详见 docs/onto-xanthil-design.md）----
// 取向：Palantir object/link 绑数据；object=数据集, property=列, link=表间关系。

export interface Ontology {
  id: string;
  workspaceId: string;
  name: string;
  domain: string;
  version: string;
  status: "draft" | "active" | "archived";
  createdAt: number;
  updatedAt: number;
}

export type ValidationIssueSeverity = "fatal" | "error" | "warning" | "info";

export interface ValidationIssue {
  severity: ValidationIssueSeverity;
  code: string;
  message: string;
  location?: Record<string, unknown>;
}

export type ExtractJobStatus = "running" | "success" | "failed" | "aborted";

export interface ExtractJob {
  id: string;
  ontologyId: string;
  status: ExtractJobStatus;
  totalChunks: number;
  doneChunks: number;
  createdObjects: number;
  createdLinks: number;
  createdLogicRules: number;
  createdActions: number;
  skippedObjects: number;
  skippedLinks: number;
  hasFatal: boolean;
  issues: ValidationIssue[];
  error?: string;
  createdAt: number;
  updatedAt: number;
}

export type ObjectKind = "dataset" | "concept";

export interface ObjectType {
  id: string;
  ontologyId: string;
  kind: ObjectKind;
  nameCn: string;
  nameEn?: string;
  description: string;
  boundPathId?: string; // kind=dataset → BiAggregationDataset.pathId（clean_data 聚合集）
  confidence: number;
  createdAt: number;
  updatedAt: number;
}

export type PropertyDataType = "string" | "number" | "boolean" | "date" | "unknown";

export interface PropertyType {
  id: string;
  objectTypeId: string;
  name: string;
  dataType: PropertyDataType;
  boundColumn?: string; // dataset-kind → 聚合集列名
  semanticType?: string; // 语义标注：'金额'/'主键'/'外键' 等
  description?: string;
}

export type LinkKind = "join" | "fk" | "is-a" | "part-of" | "related";

export interface LinkType {
  id: string;
  ontologyId: string;
  sourceObjectId: string;
  targetObjectId: string;
  kind: LinkKind;
  joinKeys?: Array<{ source: string; target: string }>; // kind∈{join,fk} 的字段对
  confidence: number;
  createdAt: number;
}

// metric 真源收敛：AnalysisStandard(kind='metric') 超集 + onto 绑定，成为唯一真源。
export interface MetricDefinition {
  id: string;
  workspaceId: string;
  name: string;
  category: string;
  description: string;
  formula: string;
  caliber: string;
  unit: string;
  objectTypeId?: string; // onto 绑定：归属对象（可空）
  boundColumns?: string[];
  enabled: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface MetricDefinitionInput {
  name: string;
  category: string;
  description: string;
  formula: string;
  caliber: string;
  unit: string;
  objectTypeId?: string;
  boundColumns?: string[];
}

// ─── 本体形式化层（P6，对齐 nano LogicRule/Action）───────────────────────
// LogicRule = 本体的形式化约束/规则；OntoAction = 可触发的可执行动作（含 functionCode）。
export interface LogicRule {
  id: string;
  ontologyId: string;
  nameCn: string;
  nameEn?: string;
  description: string;
  formula: string; // 形式化表达（可空文本）
  linkedObjectIds: string[]; // 关联的对象（object_types.id），双向关联
  confidence: number;
  createdAt: number;
  updatedAt: number;
}
export interface LogicRuleInput {
  nameCn: string;
  nameEn?: string;
  description?: string;
  formula?: string;
  linkedObjectIds?: string[];
  confidence?: number;
}

export interface OntoAction {
  id: string;
  ontologyId: string;
  nameCn: string;
  nameEn?: string;
  description: string;
  executionRule: string; // 触发条件描述
  functionCode: string; // 可执行代码（Python；质检做 AST 语法校验）
  linkedObjectIds: string[];
  linkedLogicIds: string[]; // 关联的逻辑规则（logic_rules.id）
  confidence: number;
  createdAt: number;
  updatedAt: number;
}
export interface OntoActionInput {
  nameCn: string;
  nameEn?: string;
  description?: string;
  executionRule?: string;
  functionCode?: string;
  linkedObjectIds?: string[];
  linkedLogicIds?: string[];
  confidence?: number;
}

// ─── 抽取 Prompt 管理（P8，对齐 nano Prompt 表：命名+版本化+模板复用）──────
export interface OntoPrompt {
  id: string;
  workspaceId: string;
  name: string;
  content: string; // 含 {{content}} 文档正文占位符
  version: string;
  createdAt: number;
  updatedAt: number;
}
export interface OntoPromptInput {
  name: string;
  content: string;
  version?: string;
}

// 图引擎共享视图契约（R1）：onto 对象与记忆 KG 都投影到此形状，喂给 <GraphCanvas>。
export interface GraphNode {
  id: string;
  type: string;
  title: string;
  subtitle?: string;
  group?: string;
  meta?: Record<string, unknown>;
}

export interface GraphEdge {
  id: string;
  from: string;
  to: string;
  label?: string;
  kind: string;
}

export interface OntologyGraph {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

// ── Xan 数据库 · 行业/竞品情报 (pi agent 联网检索生成的结构化外部公开情报) ──

export interface IndustryForce {
  label: string; // 五力维度名 (现有竞争/供应商议价/买方议价/替代品/新进入者)
  score: number; // 0-100 压力强度
  note: string;
}

export interface IndustryBenchmark {
  name: string;
  value: string;
}

export interface IndustryIntel {
  industry: string;
  summary: string;
  marketSize: string;
  marketGrowth: string;
  concentration: string;
  trends: string[];
  forces: IndustryForce[];
  benchmarks: IndustryBenchmark[];
  risks: string[];
  opportunities: string[];
}

export interface CompetitorProfile {
  name: string;
  positioning: string;
  marketSharePct: number; // 0-100 估计份额
  priceLevel: string;
  strengths: string[];
  weaknesses: string[];
  recentMoves: string[];
}

export interface CompetitorCompareRow {
  dimension: string;
  self: string;
  rivals: string;
}

export interface CompetitorIntel {
  brand: string;
  summary: string;
  profiles: CompetitorProfile[];
  comparison: CompetitorCompareRow[];
  substitutionRisk: string;
  recommendations: string[];
}
