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

export type WorkspaceFolderName = "draw_data" | "clean_data" | "report" | "knowledge";
export type WorkspacePathKind = "file" | "dir";

// 知识库（knowledge_base 模块 · 总控 X 接缝审定）。CRUD+分块+检索由 Agent-D 实装。
export interface KnowledgeDoc {
  id: string;
  workspaceId: string;
  title: string;
  sourceType: "upload" | "path";
  path: string | null;
  content: string | null;
  tags: string[];
  createdAt: number;
  updatedAt: number;
}
export interface KnowledgeChunk {
  id: string;
  docId: string;
  idx: number;
  text: string;
  tokens: number | null;
}
export interface KnowledgeDocInput {
  workspaceId: string;
  title: string;
  sourceType?: "upload" | "path";
  path?: string | null;
  content: string;
  tags?: string[];
}
export interface KnowledgeDocPatch {
  title?: string;
  path?: string | null;
  content?: string;
  tags?: string[];
}
export interface KnowledgeChunkHit {
  chunk: KnowledgeChunk;
  doc: { id: string; title: string; path: string | null; tags: string[]; updatedAt: number };
  score: number;
  signals: { relevance: number; recency: number; idfBoost: number };
}

// prompts 管理（prompts_mgmt 模块 · 总控 X 接缝审定）。CRUD/聚合由 Agent-D 实装。
// workspaceId=null 视为全局模板（跨工作区可见）；body 内 {{变量}} 仅存储，渲染由调用方做。
export interface PromptTemplate {
  id: string;
  workspaceId: string | null;
  title: string;
  category: string;
  body: string;
  variables: string[];
  tags: string[];
  createdAt: number;
  updatedAt: number;
}
export interface PromptTemplateInput {
  workspaceId?: string | null;
  title: string;
  category?: string;
  body: string;
  variables?: string[];
  tags?: string[];
}
export interface PromptTemplatePatch {
  title?: string;
  category?: string;
  body?: string;
  variables?: string[];
  tags?: string[];
}

// 系统 prompt 聚合（只读 · server/src/system-prompts.ts:listSystemPromptOverviews）。
export interface SystemPromptOverview {
  source: string;
  label: string;
  scope: string;
  preview: string;
}

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

export type ExtractionToolCategory = "ingestion" | "analysis";

export interface ExtractionTool {
  id: string;
  name: string;
  version: string;
  description: string;
  entry: string;
  runtime: "python3";
  category?: ExtractionToolCategory;
  timeoutMs?: number;
  parameters?: ToolParameter[];
  resultColumns?: Array<{ key: string; label: string }>;
  // 期望输入数据表单字段，用于前端生成可下载 CSV 模板（仅 tabular 输入工具提供）。
  inputTemplate?: {
    columns: Array<{ name: string; required?: boolean; description?: string; example?: string }>;
    note?: string;
  };
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

// 计算工具·LLM 接入管理 —— pi LLM provider/模型接入契约（详见 docs/LLM管理模块设计方案.md）。
// 真源=~/.pi/agent/{models.json,settings.json,auth.json}；apiKey 绝不进出网类型（只给 hasApiKey 布尔）。
export type LlmApiKind = "openai-completions";

export interface LlmModelEntry {
  id: string;
  name: string;
  input?: string[];
  contextWindow?: number;
  maxTokens?: number;
  reasoning?: boolean;
  baseUrl?: string;        // model 级覆盖（minimax 态）
  api?: LlmApiKind;
}

export interface LlmProviderView {
  id: string;
  baseUrl?: string;        // provider 级（volcengine 态）
  api?: LlmApiKind;
  hasApiKey: boolean;      // apiKey 不回显，只暴露是否已配置
  models: LlmModelEntry[];
  oauth?: boolean;         // auth.json 命中 OAuth → 已授权
}

export interface LlmProviderInput {
  id: string;
  baseUrl?: string;
  api?: LlmApiKind;
  apiKey?: string;         // 新值覆盖；空/缺省/"****" 哨兵=保留旧（后端 coerce 处理）
  models: LlmModelEntry[];
}

export interface LlmSettingsView {
  enabledModels: string[];   // "provider/model"
  defaultProvider?: string;
  defaultModel?: string;
}

export interface LlmAuthStatus {
  providerId: string;
  type: string;
  authorized: boolean;
}

export interface LlmTestResult {
  ok: boolean;
  status?: number;
  latencyMs?: number;
  message?: string;
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
  | "repair"
  | "skill";

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

// "memory_item"：规则记忆重构 v2 统一记忆维度（D-RETRIEVAL 把召回的 memory_items 写入 snapshot.sources）。
export type MemorySourceKind = "businessContext" | "rules" | "standards" | "cases" | "knowledgeGraph" | "memory_item";

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
  | "skill"            // skill_registry 项目级 skill（全局池 + 按工作区启用）
  | "memory_item"      // 统一记忆 memory_items（规则记忆重构 v2，全局池 + 按工作区启用）
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

// ============================================================================
// 统一记忆模型（规则记忆重构 v2 契约 · 2026-06-18 · 总控 X-CONTRACT）
// clean-slate 重建：constraint/experience/episode 三类入 memory_items 表；
// fact 由 adapter 从 business_contexts / metric_definitions / reference 文件投影，不入表。
// 旧类型(RuleMemory/MemoryProposal/RuleConflict/AnalysisCase/MemoryUsageStats)在各域替代物落地后清理。
// ============================================================================
export type MemoryItemType = "constraint" | "experience" | "episode";
export type MemoryItemSource = "manual" | "trace" | "derived";

export interface MemoryRiskFlag {
  code: "instruction_injection" | "pii" | "weak_evidence" | "overbroad";
  severity: "low" | "medium" | "high";
  message: string;
}

export interface MemoryItem {
  id: string;
  workspaceId: string;
  type: MemoryItemType;
  title: string;
  body: string;
  source: MemoryItemSource;
  sourceEventIds: string[];
  confidence: number;            // [0,1]
  riskFlags: MemoryRiskFlag[];
  validFrom: number;
  validUntil: number | null;     // 时序衰减：过期不召回
  supersedesId: string | null;   // 状态演化：取代旧条目（防 semantic drift）
  usedCount: number;
  lastUsedAt: number | null;
  positiveSignals: number;
  negativeSignals: number;
  staleAfterDays: number;
  scope: "global" | "chat" | "workflow";
  enabled: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface MemoryItemInput {
  workspaceId: string;
  type: MemoryItemType;
  title: string;
  body: string;
  source?: MemoryItemSource;
  sourceEventIds?: string[];
  confidence?: number;
  riskFlags?: MemoryRiskFlag[];
  validUntil?: number | null;
  supersedesId?: string | null;
  staleAfterDays?: number;
  scope?: "global" | "chat" | "workflow";
}

// 沉淀蒸馏候选：E 蒸馏 runner 产出 → D 门禁(风险/dedup/置信度)入库
export interface MemoryCandidate {
  type: MemoryItemType;
  title: string;
  body: string;
  scope: "global" | "chat" | "workflow";
  sourceEventIds: string[];
  confidence: number;
  riskFlags: MemoryRiskFlag[];
}

// D-INGEST 复核队列条目（候选未自动入库时进入，等待 D-PANEL 一键采纳/拒绝）。
export type MemoryReviewStatus = "pending" | "accepted" | "rejected";
export interface MemoryReview {
  id: string;
  workspaceId: string;
  type: MemoryItemType;
  title: string;
  body: string;
  scope: "global" | "chat" | "workflow";
  sourceEventIds: string[];
  confidence: number;
  riskFlags: MemoryRiskFlag[];
  targetKind: string | null;
  targetId: string | null;
  reason: string;
  status: MemoryReviewStatus;
  decidedItemId: string | null;
  decidedReason: string;
  createdAt: number;
  updatedAt: number;
}

// fact adapter 投影（business_context / metric_definition / reference_file），仅前端展示用。
export type ProjectedFactKind = "business_context" | "metric_definition" | "reference_file";
export interface ProjectedFactItem {
  id: string;
  workspaceId: string;
  type: "fact";
  factKind: ProjectedFactKind;
  sourceId: string;
  title: string;
  body: string;
  meta: Record<string, string | number | null>;
  enabled: boolean;
  confidence: number;
  validFrom: number;
  validUntil: number | null;
  createdAt: number;
  updatedAt: number;
}

export interface MemoryItemListResponse {
  items: MemoryItem[];
  facts: ProjectedFactItem[];
}

export interface MemoryPromptPreview {
  prompt: string;
  charCount: number;
  tokenEstimate: number;
  itemCount: number;
  factCount: number;
}

// 多信号检索入参：D-RETRIEVAL 实装打分召回。契约期冻结为注入函数末位可选参，
// ctx 为 undefined 时注入行为不变（D 实装前的向后兼容）。
export interface RetrievalContext {
  query: string;
  recentMessages?: string[];
  dataPaths?: string[];
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
// 日常(explore) tab「黄金策」后的「行动」二级 tab：报告 →①提取行动项 →②采纳建任务 →③执行反馈 → 回流知识。
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

// "waiting_for_help"：自愈重试耗尽后挂起求助（P3 HITL），人工修正后 resume 续跑，非终态 failed。
export type SubAgentTaskStatus = "running" | "success" | "failed" | "aborted" | "waiting_for_help";

export interface SubAgentTask {
  id: string;
  parentSessionId: string;
  workspaceId?: string;
  brief: string;
  dataFiles: string[]; // 020_clean 标准目录内的相对/绝对路径
  model?: string;
  status: SubAgentTaskStatus;
  templateId?: string; // 委派时所用模板（持久化，供 resume/retry 恢复 toolIds 最小权限 + persona）
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
  templateId?: string; // 指定子 agent 模板（缺省=回退引擎默认 systemPrompt，行为同现状）
  skillPaths?: string[]; // undefined=继承 pi 默认 skill 策略；[]=禁用；非空=指定子集
}

// 子 agent 模板：剥离 runner 硬编码 systemPrompt 的图形化配置（subagents.json）。
// dataScope 锁死 "clean_data" 字面量 —— **不得放开 draw_data**（AGENTS.md §一红线，编译期堵死）。
export interface SubAgentTemplate {
  id: string;
  name: string;
  enabled: boolean;
  persona: string; // 角色 prompt，替换 runner 中硬编码角色段；引擎红线尾注恒定追加、不可被其覆盖
  toolIds: string[]; // 挂载的 ExtractionTool id 白名单子集（细粒度装配；空=不挂计算工具）
  dataScope: "clean_data"; // 数据域沙箱，恒为 clean_data
  maxRetries: number; // 自愈重试上限（P3），耗尽转 waiting_for_help
  source: "custom";
}

// ---- 工作流 agent 看板（只读投影：从各 flow 的 workflow.json nodes + flow_runs 聚合，供 SubAgentBoard 展示；不落库、不触运行路径） ----
export interface WorkflowAgentEntry {
  flowId: string;
  flowName: string;
  nodeId: string;
  label: string;
  role?: string;
  kind: "agent" | "gate" | "tool";
}

export interface WorkflowRunView {
  id: string;
  flowId: string;
  flowName: string;
  workspaceId: string;
  status: string; // FlowRunStatus 的宽松投影
  startedAt: number;
  endedAt?: number;
  outputDir: string;
}

export interface WorkflowAgentsBoard {
  agents: WorkflowAgentEntry[];
  runs: WorkflowRunView[];
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

export type SubAgentTraceKind = "tool_call" | "tool_result" | "write_report" | "message" | "turn" | "thinking" | "process" | "other";

export type ServerMessage =
  | { type: "pi_event"; sessionId: string; event: PiEvent }
  | { type: "flow_event"; flowId: string; event: PiEvent }
  | { type: "flow_run_event"; flowId: string; runId: string; event: PiEvent }
  | { type: "subagent_event"; taskId: string; parentSessionId: string; workspaceId: string; traceKind: SubAgentTraceKind; event: PiEvent; createdAt: number }
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
  | { type: "send"; sessionId: string; text: string; model?: string; skillPaths?: string[]; injectRulesPrompt?: boolean; injectKnowledgePrompt?: boolean; businessRequirementContext?: { pathId: number; markdownPath: string; jsonPath?: string } }
  | { type: "abort"; sessionId: string }
  | { type: "send_flow"; flowId: string; text: string; model?: string; systemPrompt?: string; skillPaths?: string[]; injectRulesPrompt?: boolean; injectKnowledgePrompt?: boolean }
  | { type: "abort_flow"; flowId: string }
  | { type: "abort_multi_agent"; flowId: string; runId: string }
  | { type: "execute_multi_agent"; flowId: string; runId: string; inputs?: Record<string, string>; model?: string; injectRulesPrompt?: boolean; injectKnowledgePrompt?: boolean; resumeFromNodeId?: string; previousRunId?: string }
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

export type KgNodeType = "rule" | "metric" | "ref_file" | "biz_ctx" | "report" | "concept" | "constraint" | "experience" | "episode" | "fact";
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

// 计算工具·hooks 管理 —— pi 声明式 hook 契约（详见 docs/wiki.html「计算工具·hooks 管理」卡）。
// pi 的 hook = px-hook-runner 扩展运行时读 hooks.json，对 pi 生命周期事件匹配规则并执行动作。
export type HookEvent =
  | "session_start" | "session_shutdown"
  | "before_agent_start" | "agent_start" | "agent_end"
  | "turn_start" | "turn_end"
  | "tool_execution_start" | "tool_execution_end" | "tool_call"
  | "message_end";

// command/log/notify 任意事件可用；block/mutate 仅 tool_call 事件生效（pi 的拦截/改参点）。
export type HookActionKind = "command" | "log" | "block" | "mutate" | "notify";

export interface HookAction {
  kind: HookActionKind;
  command?: string;             // kind==="command"：本地 shell 命令（外发 HTTP 动作不支持，数据安全）
  reason?: string;              // kind==="block"/"notify"：拒绝原因 / 通知文案
  set?: Record<string, string>; // kind==="mutate"：浅合并进 tool input 的字段覆盖（仅 tool_call）
}

export interface HookMatch {
  toolName?: string; // 仅对 tool_* 事件生效：toolName 精确匹配
  pattern?: string;  // 正则，匹配事件参数预览字符串
}

export interface Hook {
  id: string;
  name: string;
  enabled: boolean;
  event: HookEvent;
  match?: HookMatch;
  action: HookAction;
}

// px-hook-runner 每次触发写入 hooks-triggers.jsonl 的一行（已脱敏：不含完整 message/tool 内容）。
export interface HookTriggerRecord {
  ts: number;
  hookId: string;
  event: HookEvent;
  matched: boolean;
  actionKind: HookActionKind;
  ok: boolean;
  exitCode?: number;
  durationMs: number;
  sessionId?: string;
  argsPreview?: string;
  reason?: string;   // block/notify 的原因/文案，供看板展示
  blocked?: boolean; // 该触发是否实际拦截了工具调用
}

// 计算工具·tool-use 运行看板：单次工具运行记录（来自 trace_events，target_kind=extraction_tool / type=tool_run）。
export interface ToolRunRecord {
  id: string;
  time: number;
  toolId: string;
  toolName: string;
  source: "manual" | "ai";       // 手动（数据提取面板）/ AI（经 MCP 调用）
  status: "success" | "failed";
  success: number | null;        // 工具产物中成功条数
  failed: number | null;
  durationMs: number | null;
}

// 计算工具·command 管理 —— pi-xanthil 自有的「斜杠命令注册表」契约（详见 docs/wiki.html「command 管理」卡）。
// 实证：pi 在 -p positional 模式不展开 prompt 里的 /command（slash 为交互式 TUI/RPC 特性），故命令解析/展开
// 由 pi-xanthil 服务端做（command-expand.ts），不依赖 pi 扩展。真源 = COMMANDS_CONFIG_PATH(commands.json)。
//
// 展开占位语法（注册表 UI / 服务端展开器 / 向导前端 三方共用）：
//   {{args}}        全部参数原文（/name 之后的整串）
//   {{1}} {{2}} …   位置参数（按空白切分，引号包裹的整体算一个）
//   {{param.key}}   具名参数（来自 params[].key；向导表单或命令行 --key=value 提供）
// 具名参数命令行编码：/name --key=value，值含空格用双引号（--key="a b"）；未提供的占位替换为空串。
export type XanCommandParamType = "text" | "select" | "file";

export interface XanCommandParam {
  key: string;                 // 占位 {{param.key}} 与命令行 --key= 的键
  label: string;               // 向导表单字段标签
  required?: boolean;          // 向导表单必填校验
  type?: XanCommandParamType;  // 表单控件类型（缺省 text）
  options?: string[];          // type==="select"：候选项
  source?: "clean_data";       // type==="file"：候选来源（如 clean_data 下文件名），由向导前端拉取
}

export interface XanCommand {
  id: string;
  name: string;                // 斜杠命令名（不含前导 /）
  enabled: boolean;
  description?: string;        // 补全下拉与注册表展示
  argumentHint?: string;       // 补全下拉里的参数提示（如 "<数据集> [口径]"）
  template: string;            // 展开目标 prompt 模板，含上述占位
  params?: XanCommandParam[];  // 具名参数定义（驱动向导表单 + {{param.key}} 展开）
  skillSlugs?: string[];       // 触发该命令时一并启用的 skill（并入该 turn 的 skillPaths）
  source: "custom";            // MVP 仅自定义命令；extension/skill 类命令为后续只读展示
}

// 计算工具·skill 管理 —— 项目级 skill 生命周期注册表（详见 docs/wiki.html「skill 管理」卡）。
// 内容真源 = <workspace>/.pi/skills/<slug>/SKILL.md；本表(skill_registry)存元数据/生命周期态。
// 启用关系走 WorkspaceMemoryEnablement(itemKind="skill")，全局池 + 按工作区启用。
export type SkillStatus = "draft" | "candidate" | "active" | "archived";
export type SkillSource = "manual" | "distilled" | "curated" | "imported";
export type SkillRegressionStatus = "none" | "regression";

export interface SkillRegistryEntry {
  id: string;
  workspaceId: string;
  slug: string;                   // <workspace>/.pi/skills/<slug>/SKILL.md
  name: string;
  status: SkillStatus;
  version: number;
  supersedesId: string | null;
  source: SkillSource;
  score: number | null;           // 最近评测综合分（实验室回写）
  activationRate: number | null;  // 最近评测激活率（实验室回写）
  usageCount: number;             // 注入使用次数（埋点累计，含评测/注入路径）
  prodInjectedCount: number;      // A：生产真实运行注入次数
  prodActivatedCount: number;     // A：生产 run 完成后 detectSkillActivation 命中次数
  prodActivationRate: number | null; // A 派生：prodActivatedCount/prodInjectedCount，注入为 0 时 null
  regressionStatus: SkillRegressionStatus; // 连续评测：最近一次是否相对历史基线回归
  lastRegressionAt: number | null;
  regressionReason: string | null;
  regressionScoreDelta: number | null;
  regressionActivationDelta: number | null;
  lastEvaluationId: string | null;
  originSessionId: string | null; // 蒸馏/策展出处（可追溯）
  createdAt: number;
  updatedAt: number;
}

export interface SkillRegistryInput {
  slug: string;
  name: string;
  source: SkillSource;
  status?: SkillStatus;
  originSessionId?: string | null;
}

// G 卡（消费 C 后端历史）：每次 registry skill 评测的回归比对快照。
// 真源 = skill_registry_eval_history 表；前端仅做时间线/徽章渲染，不重算。
export type SkillRegistryRetestTrigger = "manual_evaluate" | "version_bump" | "model_upgrade" | "retest_all_active";

export interface SkillRegistryEvalHistoryEntry {
  id: string;
  workspaceId: string;
  registryId: string;
  slug: string;
  skillVersion: number;
  evaluationId: string;
  model: string;
  triggerKind: SkillRegistryRetestTrigger;
  score: number | null;
  activationRate: number | null;
  previousEvaluationId: string | null;
  previousScore: number | null;
  previousActivationRate: number | null;
  scoreDelta: number | null;
  activationDelta: number | null;
  regressionStatus: SkillRegressionStatus;
  regressionReason: string | null;
  createdAt: number;
}

export interface SkillRegistryEvalHistoryResult {
  workspaceId: string;
  items: SkillRegistryEvalHistoryEntry[];
}

// G 卡：retest-active 端点的返回结构。仅暴露汇总，不外泄完整 evaluation/history。
export interface SkillRegistryRetestActiveResult {
  workspaceId: string;
  triggerKind: SkillRegistryRetestTrigger;
  scanned: number;
  succeeded: number;
  failed: number;
  results: Array<
    | { skillId: string; slug: string; status: "success" }
    | { skillId: string; slug: string; status: "failed"; error: string }
  >;
}

// B 卡：手动一键自动沉淀 sweep 的返回（POST /api/workspaces/:id/skill-auto-distill）。
// 与 routes/engine.ts 的 SkillAutoDistillSessionResult 同形（消费侧最小子集）。
export interface SkillAutoDistillSessionResult {
  sessionId: string;
  title: string;
  status: "created" | "dry_run" | "skipped" | "failed";
  slug?: string;
  name?: string;
  reason?: string;
  error?: string;
}

export interface SkillAutoDistillResult {
  workspaceId: string;
  since: number;
  limit: number;
  model: string;
  dryRun: boolean;
  scanned: number;
  created: number;
  skipped: number;
  failed: number;
  results: SkillAutoDistillSessionResult[];
}

export interface SkillCoverageGapTask {
  id: string;
  sessionId: string;
  title: string;
  text: string;
  updatedAt: number;
  topScore: number;
  matches: RetrievedSkill[];
}

export interface SkillCoverageGapCluster {
  id: string;
  title: string;
  taskCount: number;
  avgTopScore: number;
  keywords: string[];
  tasks: SkillCoverageGapTask[];
}

export interface SkillCoverageGapResult {
  workspaceId: string;
  since: number;
  limit: number;
  scanned: number;
  lowScoreThreshold: number;
  minClusterSize: number;
  clusters: SkillCoverageGapCluster[];
}

export interface SkillCoverageGapDistillResult {
  workspaceId: string;
  clusterId: string;
  dryRun: boolean;
  result:
    | { status: "created"; slug: string; name: string; entry: SkillRegistryEntry; skillPath: string }
    | { status: "dry_run"; slug: string; name: string }
    | { status: "skipped"; reason: string; slug?: string; name?: string; similarSkill?: SkillRegistryConflict }
    | { status: "failed"; error: string };
}

// P1-a：某历史版本的内容快照（回滚前预览/查看历史版本内容）。
export interface SkillVersionContent {
  version: number;
  content: string;
}

export interface SkillRegistryCreateBody {
  slug: string;
  name?: string;
  source: SkillSource;
  status?: SkillStatus;
  version?: number;
  supersedesId?: string | null;
  originSessionId?: string | null;
  content: string;
}

export interface SkillRegistryEvaluateBody {
  model: string;
  repeat?: number;
  judgeRepeat?: number;
  contextPrefix?: string;
  dataContextPaths?: string[];
  tasks: SkillEvalTask[];
}

export interface SkillRegistryEvaluateResult {
  evaluation: SkillEvaluationDetail;
  entry: SkillRegistryEntry;
  metrics: { score: number | null; activationRate: number | null };
}

// P1-B：冲突检测（A 域端点 GET /api/workspaces/:id/skill-registry/conflicts）
// 用于采纳/新建前展示"疑似重复"提示，不阻断流程，供人决策。
export interface SkillRegistryConflict {
  id: string;
  workspaceId: string;
  itemKind: "skill";
  itemId: string;
  slug: string;
  name: string;
  version: number;
  status: SkillStatus;
  score: number;
  severity: "low" | "medium" | "high";
  reason: string;
  snippet: string;
}

export interface SkillRegistryConflictsResult {
  querySlug: string | null;
  conflicts: SkillRegistryConflict[];
}

// 汇报可视化契约（2026-06-19 冻结 · 2026-06-20 校准对齐实现）—— 接 BI dataset + 复用 echarts，LLM 不喂明细行
export interface PresentationChartSpec {
  id: string;
  title: string;
  option: Record<string, unknown>; // echarts option，前端 ReactECharts 直接透传
}

export interface PresentationDatasetMeta {
  id: string;
  slot: string;
  filename: string;
  rowCount: number;
  columnCount: number;
  columns: string[];
}

// 生成请求入参（冻结自 api.ts inline；datasetId = BI dataset id 字符串）
export interface PresentationGenerateInput {
  pathId: number;
  relPath?: string;
  prompt: string;
  model?: string;
  datasetId?: string; // 关联 BI dataset id（biset，按 slot 出图）；不传=纯文本如旧（行为不变）
  cleanDataPathId?: string; // 关联 clean_data 聚合的登记项 workspace_paths.id（通用出图）；与 datasetId 二选一
  cleanDataRelPath?: string; // 登记项为目录时，定位子文件的相对路径；单文件登记可省略
  businessRequirementContext?: { pathId: number; markdownPath: string; jsonPath?: string };
}

// 生成结果（提升自 PresentationVersionPane 本地类型；chartSpecs/datasetMeta 服务端确定性产出）
export interface PresentationTaskResult {
  path: string;
  content: string;
  storylinePath: string;
  storylineHtml: string;
  chartSpecs?: PresentationChartSpec[]; // dataset 出图；缺省=无图
  datasetMeta?: PresentationDatasetMeta | null;
}
