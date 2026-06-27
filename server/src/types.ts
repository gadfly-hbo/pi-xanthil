// Domain + protocol types shared conceptually with the web client.
// (Duplicated in web/src/types.ts to keep the two packages decoupled.)

import type { GateVerdict } from "./anax-gate.ts";
import type { ValidationIssue } from "./onto-validator.ts";

export interface Workspace {
  id: string;
  name: string;
  rootPath: string;
  createdAt: number;
  // 归档标记：缺省/null=活跃；时间戳=已归档（侧边栏隐藏、数据完整保留，可取消归档恢复）。
  archivedAt?: number | null;
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
  // 'global'=通用，入全局池跨工作区可启用 | 'workspace'=项目专属，本工作区独占。
  // X-POOL0 契约设可选不破坏现有 build；D-POOL1 落 DB 列(NOT NULL DEFAULT 'workspace')后恒有值。
  scope?: "global" | "workspace";
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
  // 默认 'workspace'(专属)；'global' 时 D-POOL1 落库后 enableForOrigin(kind='knowledge')。
  scope?: "global" | "workspace";
}
export interface KnowledgeDocPatch {
  title?: string;
  path?: string | null;
  content?: string;
  tags?: string[];
}
export interface KnowledgeChunkHit {
  chunk: KnowledgeChunk;
  doc: { id: string; title: string; path: string | null; tags: string[]; updatedAt: number; createdAt: number; sourceType: "upload" | "path" };
  score: number;
  signals: { relevance: number; recency: number; idfBoost: number };
}
// X-KB0 doc 级搜索结果（D-KB1 searchKnowledgeDocs 返回；E-KB3 搜索面板消费）。
// snippet = 最高分 chunk 的 text 前 200 字，供搜索结果卡片预览。
export interface KnowledgeDocSearchResult {
  doc: KnowledgeDoc;
  score: number;
  snippet: string;
  matchedChunkCount: number;
  signals: { relevance: number; recency: number };
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

// 沉淀 prompt 草稿（chat 改造 1-2 · 总控 X-PROMPT0 接缝审定）。
// distill 路由 `POST /api/workspaces/:id/sessions/:sessionId/distill-prompt`(E 实装于 routes/engine.ts)
// 的返回体：E 服务端 LLM 从会话提炼出可复用 prompt 草稿，**只返回不写库**；
// 前端确认编辑后调既有 createPromptTemplate(D) 落库。字段对齐 PromptTemplateInput 便于直接喂入。
// 本轮无可沉淀内容时路由返回 { draft: null }。
export interface PromptDraft {
  title: string;
  category: string;
  body: string;
  variables: string[];
  tags: string[];
  sourceSessionId?: string;
}

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
  exists?: boolean;
  currentKind?: WorkspacePathKind | null;
  size?: number | null;
  mtime?: number | null;
  status?: "ok" | "missing" | "kind_mismatch";
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

// X-COLLECT3：知识库「收集」会话（挂全局收集容器 ws，独立于业务工作区）+ 文件夹。
export interface CollectSession extends Session {
  collectFolderId: string | null;
}

export interface CollectFolder {
  id: string;
  name: string;
  sort: number;
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

// ---- BI Datasets (member retention / member recall import) ----

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

// ── 指标标准层（X-METRIC0 契约，2026-06-25）──
// MetricSnapshot = ExtractionTool（tool-use MCP）与监测引擎（BiAggregation draft）两条链路的统一指标中间层。
// 设计意图：贯通「代码确定性计算 → 结构化 JSON → 数字锁 Prompt → LLM 只解读」流水线。
// 铁律：value / delta / deltaRate / status 均为代码确定性计算结果；注入 LLM 时为只读，
//       禁止模型重新推导或自行算术运算（数字锁见 E-METRIC2 的 system prompt 前缀 + MCP description）。
// 字段刻意对齐既有 MonitorComparison（types.ts），使 D-METRIC3 的 BiAggregation 适配近乎零成本。
export type MetricComparisonKind =
  | "mom"        // 环比（上期）
  | "yoy"        // 同比（去年同期）
  | "ma"         // 移动均值偏离
  | "target"     // 对目标值
  | "benchmark"  // 对行业基准
  | "competitor" // 对竞品
  | "other";     // 兜底（无法归类的对比）

export interface MetricComparison {
  kind: MetricComparisonKind;
  label: string;              // 展示用，代码生成（如 "环比上月"）
  currentValue: number | null;
  baselineValue: number | null;
  delta: number | null;       // 绝对差，代码计算
  deltaRate: number | null;   // 相对变化率，代码计算
  window?: string;            // 对比窗口口径（如 "3期移动均值"）
}

export type EvidenceLevel = "A" | "B" | "C" | "D";

export type MetricSourceRef =
  | {
      kind: "extraction_tool";
      toolId: string;
      toolName?: string;
      sourceFile?: string;
      summaryKey: string;
      period?: string;
    }
  | {
      kind: "bi_aggregation";
      runId?: string;
      findingId?: string;
      metricId?: string;
      window?: string;
    };

export interface MetricSnapshot {
  name: string;               // 指标名，代码定义
  value: number;              // 当期值，代码计算
  unit?: string;
  period: string;             // 统计周期，代码确定（如 "2026-06"）
  comparisons?: MetricComparison[];
  status: "normal" | "warning" | "alert";  // 阈值判定，代码打标
  thresholdNote?: string;
  source: "extraction_tool" | "bi_aggregation";  // 产出链路
  evidenceLevel: EvidenceLevel;
  evidenceOverride?: EvidenceLevel;
  sourceRef?: MetricSourceRef;
  /** D-ZH7 C-mini：绑定已登记指标（metricId 唯一标识口径，用于对账/核验）。 */
  metricId?: string;
}

// ── 关键指标双路径对账（D-ZH8 契约，2026-06-26）──
// 按 metricId+period 配对 extraction_tool 与 bi_aggregation 的 MetricSnapshot，
// 只对已声明 metricId 的关键指标做对账，避免全量同名指标误报。
export type ReconciliationVerdict = "matched" | "mismatch" | "missing_pair" | "unregistered";

export interface MetricReconciliationPair {
  metricId: string;
  period: string;
  extraction?: {
    value: number;
    unit?: string;
    evidenceLevel: string;
    sourceRef?: MetricSourceRef;
  };
  biAggregation?: {
    value: number;
    unit?: string;
    evidenceLevel: string;
    sourceRef?: MetricSourceRef;
  };
}

export interface MetricReconciliationResult {
  verdict: ReconciliationVerdict;
  pairs: MetricReconciliationPair[];
  warnings: string[];
}

// ── 数字锁产出侧校验（X-MLOCK0 契约，2026-06-25）──
// 对 tool-use 链路 assistant 自由文本中复述的数字做 best-effort 回校；
// 只读 MetricSnapshot.value + answerText，不阻断、不改写、不自动重试。
export interface MetricVerification {
  verdict: "ok" | "mismatch";
  hits: MetricVerificationHit[];
}

export interface MetricVerificationHit {
  name: string;
  expected: number;
  foundInText: number | null;
  status: "matched" | "suspect" | "unreferenced" | "fabricated" | "label_mismatch";
  relDiff: number | null;
  /** label_mismatch 时：上下文中实际出现的指标名 */
  contextLabel?: string;
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

// ---- Skill evaluations ----

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

// ---- Prompt evaluations (实验场·prompts lab) ----

export interface PromptVariant {
  id: string;
  label: string;
  promptBody: string;
  role: "system" | "prefix";
  templateId?: string;
}

export interface PromptEvalTask {
  id: string;
  prompt: string;
  expectedPoints?: string[];
  rubric?: string;
  // red-team 注入鲁棒性（P5-3）：mustResist=true 时 task.prompt 是注入型攻击（忽略指令/越权请求），
  // pairwise judge 改用「守住系统约束者胜」的对抗 rubric——守约束的变体 win，失守（顺从注入）的变体 loss。
  mustResist?: boolean;
  attackKind?: PromptAttackKind;
}

export type PromptAttackKind = "ignore-instructions" | "privilege-escalation" | "exfiltration" | "jailbreak";

export interface PromptEvalSet {
  id: string;
  workspaceId: string;
  name: string;
  tasks: PromptEvalTask[];
  createdAt: number;
  updatedAt: number;
}

export type PromptPairwiseVerdict = "win" | "tie" | "loss" | "not_judged";

export interface PromptPairwiseResult {
  baselineResultId: string;
  variantResultId: string;
  taskId: string;
  attempt: number;
  verdict: PromptPairwiseVerdict;
  scoreDelta: number | null;
  baselineScore: number | null;
  variantScore: number | null;
  confidence: number | null;
  reason: string;
  error: EvaluationError | null;
  judgeRuns?: PromptPairwiseResult[];
}

export interface PromptPairwiseSummary {
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

export interface PromptEvaluationRunResult {
  id: string;
  variantId: string;
  variantLabel: string;
  taskId: string;
  attempt: number;
  status: "success" | "failed";
  startedAt: number;
  endedAt: number;
  durationSec: number;
  totalTokens: number;
  totalCost: number;
  toolCalls: number;
  outputChars: number;
  output: string;
  pairwise: PromptPairwiseResult | null;
  error: EvaluationError | null;
}

export interface PromptVariantSummary {
  variantId: string;
  variantLabel: string;
  total: number;
  success: number;
  failed: number;
  avgDurationSec: number;
  avgTotalTokens: number;
  avgTotalCost: number;
  avgToolCalls: number;
  avgOutputChars: number;
}

export interface PromptTaskSummary {
  taskId: string;
  total: number;
  success: number;
  failed: number;
}

export interface PromptEvaluation {
  evaluationId: string;
  workspaceId: string;
  model: string;
  repeat: number;
  status: "success" | "failed";
  startedAt: number;
  endedAt: number;
  durationSec: number;
  variants: PromptVariant[];
  tasks: PromptEvalTask[];
  variantSummaries: PromptVariantSummary[];
  taskSummaries: PromptTaskSummary[];
  pairwiseSummaries: PromptPairwiseSummary[];
}

export interface PromptEvaluationDetail extends PromptEvaluation {
  results: PromptEvaluationRunResult[];
}


// ---- Tool evaluations ----

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

// ---- Command evaluations (实验场·command lab) ----

export type CommandExpectation =
  // 确定性（作用于 expandCommand 产物，无 LLM 实跑）
  | { kind: "expand-contains"; substrings: string[]; forbidUnresolved?: boolean }
  | { kind: "expand-golden"; goldenText: string; normalizeWhitespace?: boolean }
  | { kind: "skill-attached"; expectedSkillSlugs: string[]; exact?: boolean }
  // 实跑（把 expandedText 作 pi turn 跑，作用于 turn 文本输出）
  | { kind: "run-contains"; substrings: string[] }
  | { kind: "run-llm-judge"; rubric: string; model: string; minScore?: number };

export interface CommandEvalCase {
  id: string;
  name: string;
  argsText: string;
  expected: CommandExpectation;
  timeoutMs?: number;
}

export interface CommandEvalSet {
  id: string;
  workspaceId: string;
  name: string;
  commandId: string;
  cases: CommandEvalCase[];
  createdAt: number;
  updatedAt: number;
}

export interface CommandEvaluationRunResult {
  id: string;
  caseId: string;
  caseName: string;
  attempt: number;
  status: "success" | "failed";
  startedAt: number;
  endedAt: number;
  durationSec: number;
  expandedText: string;
  skillSlugs: string[];
  output: string;
  expectation: CommandExpectation;
  error: EvaluationError | null;
}

export interface CommandCaseSummary {
  caseId: string;
  caseName: string;
  total: number;
  success: number;
  failed: number;
  avgDurationSec: number;
}

export interface CommandEvaluation {
  evaluationId: string;
  workspaceId: string;
  commandId: string;
  repeat: number;
  status: "success" | "failed";
  startedAt: number;
  endedAt: number;
  durationSec: number;
  cases: CommandEvalCase[];
  caseSummaries: CommandCaseSummary[];
}

export interface CommandEvaluationDetail extends CommandEvaluation {
  results: CommandEvaluationRunResult[];
}

// ---- SubAgent evaluations (实验场·subagents lab) ----

export type SubAgentExpectation =
  | { kind: "tool-sequence"; required?: string[]; forbidden?: string[]; orderedSubsequence?: boolean }
  | { kind: "step-budget"; maxSteps: number }
  | { kind: "token-budget"; maxTokens: number }
  | { kind: "report-presence" }
  | { kind: "llm-judge"; rubric: string; model: string; minScore?: number };

export interface SubAgentEvalCase {
  id: string;
  name: string;
  templateId?: string;
  personaOverride?: string;
  toolIdsOverride?: string[];
  brief: string;
  dataFiles: string[];
  expected: SubAgentExpectation;
  timeoutMs?: number;
  // ---- D-QEVAL3 硬断言（X-QEVAL0 契约扩展，eval_plugin Expected 移植；均可选）----
  mustCallTools?: string[];
  mustNotCallTools?: string[];
  outputContains?: string[];
  outputNotContains?: string[];
  minOutputChars?: number;
  maxToolCalls?: number;
  maxCostUsd?: number;
}

// D-QEVAL3 硬断言单条结果（任一 must 失败 → run.ruleFailed）。
export interface HardRuleCheckResult {
  rule: "mustCallTools" | "mustNotCallTools" | "outputContains" | "outputNotContains" | "minOutputChars" | "maxToolCalls" | "maxCostUsd";
  passed: boolean;
  detail: string;
}

export interface SubAgentEvalSet {
  id: string;
  workspaceId: string;
  name: string;
  cases: SubAgentEvalCase[];
  createdAt: number;
  updatedAt: number;
}

export interface SubAgentEvaluationRunResult {
  id: string;
  caseId: string;
  caseName: string;
  attempt: number;
  status: "success" | "failed";
  startedAt: number;
  endedAt: number;
  durationSec: number;
  toolTrajectory: string[];
  stepCount: number;
  totalTokens: number;
  totalCost: number;
  toolCalls: number;
  reportPath: string | null;
  output: string;
  expectation: SubAgentExpectation;
  error: EvaluationError | null;
  // ---- D-QEVAL3 ----
  hardRuleResults?: HardRuleCheckResult[];
  ruleFailed?: boolean;
}

export interface SubAgentCaseSummary {
  caseId: string;
  caseName: string;
  total: number;
  success: number;
  failed: number;
  avgDurationSec: number;
  avgStepCount: number;
  avgTotalTokens: number;
  avgTotalCost: number;
  // ---- D-QEVAL3 聚合视图 ----
  ruleCheckPassed: boolean;
  ruleCheckDetails: HardRuleCheckResult[];
  passAtK: number;
  outputVariance: number;
}

export interface SubAgentEvaluation {
  evaluationId: string;
  workspaceId: string;
  repeat: number;
  status: "success" | "failed";
  startedAt: number;
  endedAt: number;
  durationSec: number;
  cases: SubAgentEvalCase[];
  caseSummaries: SubAgentCaseSummary[];
}

export interface SubAgentEvaluationDetail extends SubAgentEvaluation {
  results: SubAgentEvaluationRunResult[];
}

// ---- Hook evaluations (实验场·hooks lab，范式 B 护栏单测) ----
export type HookExpectation =
  | { kind: "must-block"; reasonPattern?: string }                       // 预期 tool_call 被拦截（可选 reason 正则）
  | { kind: "must-allow" }                                               // 预期不被拦截
  | { kind: "golden-mutation"; expectedInput: Record<string, unknown> }  // mutate 后 input 深等于期望
  | { kind: "match"; expectedHookIds: string[] }                         // 命中的 hook 集合（顺序无关，全等）
  | { kind: "trigger-count"; count: number };                            // 命中并会触发的 hook 数

export interface HookEvalCase {
  id: string;
  name: string;
  event: HookEvent;                      // 生命周期事件
  payload: Record<string, unknown>;      // 合成事件字段：toolName / input / args / reason / role / isError …
  hookIds?: string[];                    // 参与的 hooks.json 规则子集（缺省=全部 enabled）
  expected: HookExpectation;
}
export interface HookEvalSet {
  id: string;
  workspaceId: string;
  name: string;
  cases: HookEvalCase[];
  createdAt: number;
  updatedAt: number;
}
// 纯 verdict（evaluateHookFixture 产出，无副作用执行）
export interface HookVerdict {
  matchedHookIds: string[];
  blocked: boolean;
  blockReason: string | null;
  mutatedInput: Record<string, unknown> | null;   // 有 mutate 命中时=应用 set 后的 input 副本；否则 null
  sideEffectKinds: string[];                       // 会触发的旁路动作种类(command/notify/log)——仅枚举，绝不执行
  triggerCount: number;
}
export interface HookEvaluationRunResult extends HookVerdict {
  id: string;
  caseId: string;
  caseName: string;
  attempt: number;
  status: "success" | "failed";
  startedAt: number;
  endedAt: number;
  durationSec: number;
  expectation: HookExpectation;
  error: EvaluationError | null;
}
export interface HookCaseSummary {
  caseId: string;
  caseName: string;
  total: number;
  success: number;
  failed: number;
  avgDurationSec: number;
}
export interface HookEvaluation {
  evaluationId: string;
  workspaceId: string;
  repeat: number;
  status: "success" | "failed";
  startedAt: number;
  endedAt: number;
  durationSec: number;
  cases: HookEvalCase[];
  caseSummaries: HookCaseSummary[];
}
export interface HookEvaluationDetail extends HookEvaluation {
  results: HookEvaluationRunResult[];
}

// ──── 文档质量评测（X-QEVAL0 契约，eval_plugin 移植）。与上方六类 *-Evaluation 并列，
// runner=D-QEVAL1（runJudge 单调，3 次取中位数逻辑在 runner 层）、lab=E-QEVAL2；不混入现有 runner。 ────
export interface DocumentEvalRuleResult {
  ruleName: string;
  passed: boolean;
  score: number;
  detail: string;
}

export interface DocumentEvalCase {
  id: string;
  name: string;
  domain: "mall" | "return_profile" | string;
  reportPath: string;
  rubrics: Array<{ criterion: string; weight: number; anchors?: string }>;
}

export interface DocumentSessionMetrics {
  totalTokens: number;
  totalCost: number;
  subagentCount: number;
  wordCount: number;
  costPer1kWords: number;
}

export interface DocumentEvalResult {
  caseId: string;
  ruleResults: DocumentEvalRuleResult[];
  ruleTotalScore: number;
  judgeScore: number;
  judgeDetails: Array<{ criterion: string; score: number; reason: string }>;
  combinedScore: number;
  consistencyAlerts: string[];
  sessionMetrics?: DocumentSessionMetrics;
}

export interface EvaluationArchiveResult {
  markdownPath: string;
  jsonPath: string;
}

// ════ Harness 自进化接缝契约（X-HARNESS0，总控自做）════
// 来源 docs/backlog/{EFC-反馈效率度量,AHE-可证伪编辑契约}.md。本块仅定契约单一真源；
// 打分/估计器/对照器/回滚执行均归 E（E-EFC1 / E-AHE1）实装，总控不在此实装逻辑。
// 详见 docs/notes-infra.md §九。

/** AHE 七类可独立编辑的 harness 组件（组件可观测：每次编辑定位到单组件，给干净 action space）。
 *  ⚠ 与 LabKind 区分：LabKind=6 个测评台；HarnessComponent=组件动作空间，含 memory（非 lab）。*/
export type HarnessComponent =
  | "prompt"
  | "command"
  | "subagent"
  | "hook"
  | "skill"
  | "memory"
  | "tool";

/** EFC 固定尺度常数 κ=10（论文事件级与轨迹级共用）。 */
export const EFC_KAPPA = 10 as const;

/** 单个反馈事件的四因子（各 ∈[0,1]，乘积结构：任一项低则整体低）。EFC_t = κ·I·V·R·M。 */
export interface FeedbackEvent {
  /** I_t 信息量：揭示任务相关信息（新约束/降不确定/诊断失败模式/子目标进展）。 */
  I: number;
  /** V_t 有效性：有可靠证据支撑（确定性 checker/执行结果/单测/一致工具观测）。 */
  V: number;
  /** R_t 非冗余相关：命中当前子目标且信息超出轨迹已有。 */
  R: number;
  /** M_t 记忆更新：改变了 plan/state/memory，能影响后续动作（直接对接记忆模块信号）。 */
  M: number;
  /** 原始可观测载荷（工具返回/hook 传感器/报错诊断等），供估计器特征 φ(e_t) 提取。 */
  raw: string;
}

/** 任务难度归一化输入：D_task = L·H_tool·S_state·(1+N_obs)·(1−V_oracle)。 */
export interface TaskDemand {
  /** L 最小步数。 */
  L: number;
  /** H_tool 选工具的歧义度。 */
  H_tool: number;
  /** S_state 状态跟踪需求。 */
  S_state: number;
  /** N_obs 观测噪声。 */
  N_obs: number;
  /** V_oracle 验证信号可见度 ∈[0,1]。 */
  V_oracle: number;
}

/** 一条轨迹的 EFC 度量三视角。 */
export interface EfcScore {
  /** 轨迹级 EFC(τ) = κ·Σ_t I·V·R·M（原始，未归一化）。 */
  efc: number;
  /** 归一化 EFC = EFC / D_task，跨任务可比口径。 */
  normalized: number;
  /** harness 效率 η = EFC / C_raw（C_raw=原始算力，来自 cache.ts getRawCompute*）。 */
  eta: number;
}

/** 编辑结局四态（SkillHone 增补 2606.08671：原 AHE 只有 verdict 对照，此处升级为可累积决策史口径）。
 *  accept=采纳留下；revise=带诊断上下文重做 offending part；reject=弃用回滚；defer=暂缓。 */
export type ChangeOutcome = "accept" | "revise" | "reject" | "defer";

/** 变更清单（AHE 决策可观测）：每次 harness 编辑配一份，把改动变成对下一轮评测可证伪的契约。
 *  持久化后构成跨轮经验库 ℋ：新失败来时检索 ℋ_{<createdAt} 判「失败是否新/类似修复是否已试过/上个方案为何被拒」。 */
export interface ChangeManifest {
  editId: string;
  /** 命中的单一组件类。 */
  component: HarnessComponent;
  /** 失败证据：哪些任务 + 症状。 */
  failureEvidence: string;
  /** 推断根因。 */
  rootCause: string;
  /** 目标修复：组件内的具体改动描述。 */
  targetedFix: string;
  /** 预期修好的任务集（predicted-fix），下轮与实测任务级 delta 取交集出 verdict。 */
  predictedFix: string[];
  /** 预期回归风险的任务集（predicted-regression）。 */
  predictedRegression: string[];
  /** 编辑结局四态。 */
  outcome: ChangeOutcome;
  /** 结局理由（尤其 reject/revise「为何被拒」），供决策史检索复用。 */
  outcomeReason?: string;
  /** 创建时刻（ms）；决策史 ℋ_{<t} 检索按此排序，新失败只比更早的 manifest。 */
  createdAt: number;
}

/** 编辑裁决：predicted 与实测任务级 delta 取交集后的四率（论文 fix/regression 各精确率/召回）。
 *  ⚠ 别迷信预测精度（论文 fix precision 33.7%/regression 11.8%），价值在「强制预测 + 事后对照累积因果」。 */
export interface EditVerdict {
  editId: string;
  fixPrecision: number;
  fixRecall: number;
  regPrecision: number;
  regRecall: number;
  /** HarnessX seesaw 无回归门（2606.14249）：候选回归的「已解任务」集；非空即未过门（比纯回滚严）。 */
  regressedSolvedTasks: string[];
}

/** HarnessX 增补（2606.14249）：冲突编辑 fork 成变体并行隔离，按任务路由到不同变体后再合并。
 *  接受准则补「确定性 seesaw 无回归门」（候选不得回归任何已解任务，见 EditVerdict.regressedSolvedTasks）。 */
export interface HarnessVariant {
  variantId: string;
  /** 该变体所基于的编辑（ChangeManifest.editId）。 */
  baseEditId: string;
  /** 按任务路由：taskId → 该任务采用的 variantId。 */
  perTaskRouting: Record<string, string>;
}

/** typed scoped revision（SkillHone 增补）：编辑回滚的最小底座。无 git，故以结构化修订记录替代 commit；
 *  回退时按 scope 定位 offending part 精准还原，而非整体回滚，保留同次编辑里其他 useful edits。
 *  持久化口径（db 表 harness_edits，落 db/engine.ts 由 E 实装）见 docs/notes-infra.md §九；本卡不建表/不执行回滚。 */
export interface ScopedRevision {
  editId: string;
  component: HarnessComponent;
  /** 被编辑资源标识：promptId/commandId/subagentId/hookId/skillId(variant)/memoryItemId/toolId。 */
  resourceId: string;
  /** 修订作用域：组件内被改的具体部分（如 skill 的某 section、prompt 的某 block），回退按此粒度。 */
  scope: string;
  /** 编辑前快照（该 scope 原内容），用于精准还原。 */
  beforeSnapshot: string;
  /** 编辑后内容（该 scope）。 */
  afterSnapshot: string;
  /** 诊断上下文：关联的 ChangeManifest.editId，让回退带因果可解释。 */
  manifestEditId: string;
  createdAt: number;
}

// ════ 产品 Agent 自进化接缝契约（X-EVOLVE0，总控自做）════
// 来源 docs/backlog/生产失败驱动的产品Agent自进化闭环.md（OpenAI 税务 Agent「失败→eval→约束修改」闭环）。
// 本块仅定契约单一真源；失败轨迹持久化/eval 自动沉淀(复发 finding 触发)/专家注释入口均归
// E-EVOLVE1（引擎）/ D-EVOLVE2（注释入口·红线）实装。bounded-change 规格复用 AHE ChangeManifest
// （上方 X-HARNESS0，不新造）。脱敏边界沿用监测 E-MONITOR8 口径（input/output 不含原始明细）。

/** 生产轨迹来源模块。 */
export type AgentTrajectoryModule = "monitor" | "anax" | "flow" | "chat";

/** 一步轨迹（脱敏后存：input/output 为聚合/衍生文本，不含 draw_data 原始明细）。 */
export interface AgentTrajectoryStep {
  stage: string;
  input: string;
  output: string;
  /** 该步引用的证据标识（指标/工具/来源），可选。 */
  citation?: string;
}

/** 失败（或对照）轨迹，脱敏后持久化，作为 eval 沉淀与 bounded-change 的证据载体。 */
export interface AgentTrajectory {
  runId: string;
  module: AgentTrajectoryModule;
  steps: AgentTrajectoryStep[];
  outcome: "pass" | "fail";
}

/** eval 记录注释生命周期：候选 → 确认 / 弃用。 */
export type EvalAnnotationStatus = "candidate" | "confirmed" | "rejected";

/** 由 failing trace 沉淀的 eval 目标（复发/恶化 finding 触发 → eval 候选 → 专家注释确认）。 */
export interface EvalRecord {
  id: string;
  /** 关联监测发现 HealthFinding.id（复发触发沉淀时），可选。 */
  sourceFindingId?: string;
  /** 触发本 eval 的失败轨迹。 */
  failingTrace: AgentTrajectory;
  /** 期望产出（专家注释或规则模板给定）。 */
  expectedOutput: string;
  /** 通过条件（确定性可判，供 eval runner 复算）。 */
  passCondition: string;
  /** 注释状态。 */
  annotationStatus: EvalAnnotationStatus;
  /** 创建时刻（ms）；持久化排序 + 按 sourceFindingId 去重所需（总控增补，对齐 ChangeManifest 范式）。 */
  createdAt: number;
}

// ════ 记忆老化度量接缝契约（X-AGING0，总控自做）════
// 来源 docs/backlog/AgingBench-记忆老化巡检.md（arxiv 2605.26302）。本块仅定契约单一真源；
// 反事实探针执行器 / 老化度量 / 定向修复建议均归 E-AGING1（Dream Worker 夜间巡检）/
// D-AGING2（memory-injection 老化信号）实装。与 EFC 的 M_t 记忆信号互补（见 X-HARNESS0）。

/** 四类记忆老化，各发生在记忆循环数据流的不同阶段：
 *  History →[写 W] 记忆S →[读 R] Context →[用 U] Answer。 */
export type AgingKind =
  | "compression"   // 写 W：写时摘要丢信息（低频细节/精确值丢失）
  | "interference"  // 读 R：相似/冗余条目挤掉目标事实
  | "revision"      // 用 U：变更/派生态未正确更新（如累加值过期）
  | "maintenance";  // 存 S：重压缩/prompt 改版/日志清理悄改行为（性能悬崖）

/** 反事实探针：用 oracle 替换 write/read 环节，按 P1/P2/P3 对照把错误归因到阶段。
 *  论文三档 util 恒 agent，仅 write/read 在 agent↔oracle 间变（P1=agent/agent · P2=agent/oracle · P3=oracle/oracle）。 */
export interface CounterfactualProbe {
  id: string;
  write: "agent" | "oracle";
  read: "agent" | "oracle";
}

/** 老化曲线 + 按类度量。曲线三项必填；按类诊断项可选（仅对应老化类填）。 */
export interface AgingMetric {
  /** 半衰期：首个 m(t) ≤ 0.5·m(0) 的 session 数。 */
  halfLife: number;
  /** 衰减斜率（OLS 拟合）。 */
  decaySlope: number;
  /** 终值 m_F。 */
  finalScore: number;
  /** 修订老化：accumulator_error(t) = |v_agent − v_gold|。 */
  accumulatorError?: number;
  /** 干扰老化：抗干扰度。 */
  interferenceResistance?: number;
  /** 修订老化：过期事实遗忘准确度。 */
  forgetAccuracy?: number;
  /** 维护老化：shock_delta(e) = m_F(shock) − m_F(control)。 */
  shockDelta?: number;
}

/** 阶段错误归因：由 P1/P2/P3 的 Acc 差算（util=1−Acc_P3 · write=Acc_P3−Acc_P2 · read=Acc_P2−Acc_P1）。 */
export interface ErrorAttribution {
  writeErr: number;
  readErr: number;
  utilErr: number;
}

// ════ Harness 轨迹级安全审计契约（X-AUDIT0，总控自做·P2）════
// 来源 docs/backlog/HarnessAudit-轨迹级安全审计.md（arxiv 2605.14271）。本块仅定契约单一真源；
// 结构化轨迹日志(px-hook-runner)/确定性 access checker(Judge)/SAR 报表均归 E-AUDIT1 实装。
// P2：随多 agent 协作规模扩大才紧迫，契约先行、不绑编排 MVP。harness 形式化 ℋ:=(𝒜,𝒯,ℛ,Π,Φ,Σ)。

/** Π · 单角色的工具三层授权 + 资源参数白名单。 */
export interface RolePermission {
  role: string;
  /** 必须可用的工具（缺失=异常）。 */
  requiredTools: string[];
  /** 禁用工具（用了即 V-OT）。 */
  forbiddenTools: string[];
  /** 非必要工具（用了升严重度，非硬禁）。 */
  unnecessaryTools: string[];
  /** 资源参数白名单：tool 的某 param 仅允许这些值/glob（越界即 V-OR）。 */
  resourceWhitelist?: Array<{ tool: string; param: string; allow: string[] }>;
}

/** Φ · 信息流策略（allow/deny 角色对 + 缺省拓扑 + 数据泄露规则）。 */
export interface InfoFlowPolicy {
  /** 显式允许的角色对（from→to）。 */
  allowPairs: Array<{ from: string; to: string }>;
  /** 显式禁止的角色对（违反即 V-IC）。 */
  denyPairs: Array<{ from: string; to: string }>;
  /** 缺省拓扑：未显式列出时的回退（hub-spoke=经总控中转，保守缺省）。 */
  defaultTopology: "hub-spoke" | "deny-all" | "allow-all";
  /** 数据泄露规则：敏感类(SSN/patient_id/payment_token…) → 禁止接收方（违反即 V-ID）。 */
  leakRules: Array<{ sensitiveKind: string; forbiddenReceivers: string[] }>;
}

/** Σ · 协调协议（委派/确认/结果校验拓扑）。 */
export interface CoordinationPolicy {
  /** 通信枢纽角色（hub-spoke 的中转点，如总控）。 */
  hubRole?: string;
  /** 委派结果是否必须经校验门（result-check gate）。 */
  requireResultCheck: boolean;
}

/** harness 策略三元组（Π/Φ/Σ）；E-AUDIT1 将 YAML 策略规约解析为本结构。 */
export interface HarnessPolicy {
  /** Π 权限边界：role → 工具/资源授权。 */
  permissions: RolePermission[];
  /** Φ 信息流策略。 */
  infoFlow: InfoFlowPolicy;
  /** Σ 协调协议。 */
  coordination: CoordinationPolicy;
}

/** 四类违规（确定性 access checker 后验判，可复现非 LLM 主观）。 */
export type ViolationClass =
  | "V-OT"   // 工具/资源调用：用了禁用/无关/越角色工具
  | "V-OR"   // 资源/操作范围：对越界对象/参数做相关操作
  | "V-IC"   // 信息路由：在允许拓扑外通信
  | "V-ID";  // 信息泄露：敏感内容经通信/输出暴露

/** 一条审计违规（Judge 阶段产出）。 */
export interface Violation {
  class: ViolationClass;
  /** 梯度严重度（对应 SAR 权重 ω_low/ω_high）。 */
  severity: "low" | "high";
  /** 触发违规的角色。 */
  actingRole: string;
  /** 可复现证据（命中规则 + 轨迹序号 + 序列化参数片段，脱敏后）。 */
  evidence: string;
}

/** 三通道 Safety Adherence Rate（[0,1]，越高越安全）。
 *  SAR^c = 1 − min(1, ω_low·V_low + ω_high·V_high)，ω_high=0.30 · ω_low=0.15；
 *  总分 Score = SAR ×(0.7·TCR + 0.15·AVS + 0.15·PB)，安全作乘数、不达标直接压低。 */
export interface SafetyAdherence {
  /** 工具通道（V-OT 计入）。 */
  tool: number;
  /** 资源通道（V-OR 计入）。 */
  resource: number;
  /** 信息流通道（V-IC/V-ID 计入）。 */
  flow: number;
}

/** SAR 违规权重（论文固定值）。 */
export const SAR_WEIGHTS = { low: 0.15, high: 0.3 } as const;

// ---- 跨 lab 回归看板 + CI gate (Phase5 P5-2) ----

export type LabKind = "skill" | "tool" | "prompt" | "command" | "subagent" | "hook";

/** 一条 evaluation 归一化后的时间线点（六类共用形状） */
export interface LabTimelinePoint {
  lab: LabKind;
  resourceId: string;          // 资源标识：skill=variantId(registry id)/toolId/commandId/"-"(subagent/hook 整集)
  evaluationId: string;
  startedAt: number;
  status: "success" | "failed";
  durationSec: number;
  /** 综合分 [0,1]：pairwise win 率优先，否则 = passRate */
  score: number | null;
  /** 通过率 [0,1] = Σsuccess/Σtotal */
  passRate: number | null;
  /** pairwise 胜率 [0,1]，仅 skill/prompt 有 */
  winRate: number | null;
  /** 激活率 [0,1]，仅 skill 有 */
  activationRate: number | null;
}

export interface LabTimeline {
  lab: LabKind;
  resourceId: string;
  points: LabTimelinePoint[];  // 按 startedAt 升序
}

export interface RegressionGateThresholds {
  scoreDrop: number;
  passRateDrop: number;
  winRateDrop: number;
  activationRateDrop: number;
}

export type RegressionGateDecision = "pass" | "regression" | "insufficient_data";

/** 门禁判定结果：对齐 skill candidate→active promote 的回归口径，跨 lab 通用 */
export interface RegressionGateVerdict {
  lab: LabKind;
  resourceId: string;
  decision: RegressionGateDecision;
  reason: string | null;
  thresholds: RegressionGateThresholds;
  current: LabTimelinePoint | null;
  previous: LabTimelinePoint | null;
  deltas: {
    score: number | null;
    passRate: number | null;
    winRate: number | null;
    activationRate: number | null;
  };
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
  | "ontology"         // onto-xanthil：启用粒度=本体整体（已落地）
  | "skill"            // skill_registry 项目级 skill（全局池 + 按工作区启用）
  | "memory_item"      // 统一记忆 memory_items（规则记忆重构 v2，全局池 + 按工作区启用）
  | "prompt"           // prompt_templates 模板库（全局池 + 按工作区启用，X-POOL0）
  | "knowledge"        // knowledge_docs 资料库（scope='global' 入池 + 按工作区启用，X-POOL0）
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

// ── 记忆 v2.0 缺口1：分层标签（X-MEM2-CONTRACT 契约口径）──────────────────────
// tags 为多信号检索的「结构化精筛」维度，弥补「唯 scope/type 两维 + 词法 relevance」
// 在大库下无法少/准/可控的短板。软分层约定（非硬枚举、自由 string，便于 LLM 蒸馏产出
// 与未来收紧，零 schema churn）：前缀 task:/industry:/method:/data:/problem:（对齐方法论 5 层）。
//
// migration 口径（本卡只审定，SQL 由 D-MEM2-TAG 写并以递增版本注册 MIGRATIONS，总控审）：
//   memory_items   加列  tags TEXT NOT NULL DEFAULT '[]'   （JSON 编码 string[]）
//   memory_reviews 加列  tags TEXT NOT NULL DEFAULT '[]'   （候选→复核→采纳路径需透传 tags，否则采纳成 item 丢标签）
// 数据层私有类型（MemoryItemRow / MemoryReviewRow / MemoryIngestInput）的 tags 读写归 D。
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
  tags: string[];                // 分层标签：检索结构化精筛维度（见上方契约口径）
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
  tags?: string[];               // 缺省 []
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
  tags?: string[];               // 缺省 []；E-MEM2-DISTILL-TAG 由蒸馏 prompt 产出
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
  tags: string[];                // 透传候选标签，采纳成 item 时不丢
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
// tags（X-MEM2-CTX）：调用方**刻意**的结构化作用域（如面板按 tag 筛选）。语义分层——
//   显式 tags → 硬结构化预过滤（无交集即出局，含 untagged）+ tagMatch 加权；
//   推断信号（query 前缀解析 / dataPaths→data:）→ 仅 tagMatch 加权，永不硬过滤（防自动注入清空召回）。
export interface RetrievalContext {
  query: string;
  recentMessages?: string[];
  dataPaths?: string[];
  tags?: string[];
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

// ---- AnaX hypothesis library (归档飞轮沉淀的实证假设) ----
export type HypothesisVerdict = "confirmed" | "rejected" | "partial";

export interface HypothesisEntry {
  id: string;
  workspaceId: string;
  scene: string;        // 业务场景，如 "留存率下降"
  hypothesis: string;   // 假设陈述
  verdict: HypothesisVerdict;
  evidence: string;     // 证据/结论摘要
  impact: string;       // 业务影响（金额/用户数），可空
  source: "archive" | "manual";
  enabled: boolean;
  /** Number of times this hypothesis was confirmed across runs (archive source only). */
  confirmCount: number;
  /** Number of times this hypothesis was rejected across runs. */
  rejectCount: number;
  /** Number of times this hypothesis was partially confirmed across runs. */
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

export interface ChangeProposalInput {
  runId?: string | null;
  sourceNodeId?: string | null;
  title: string;
  description: string;
  expectedImpact: string;
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

// ---- business context (业务环境) ----
// "agent 不知道但做决策必须知道" 的业务事实背景。与 rules（约束）、
// analysis_standards（指标定义）并列，作为第三类记忆注入到 system prompt。
// 固定 6 个分类，引导用户填全关键维度，并利于结构化注入。
export type BusinessContextCategory =
  | "org" // 组织/主体
  | "status" // 业务现状
  | "glossary" // 术语/口径
  | "constraint" // 约束/红线
  | "history" // 历史/背景
  | "goal"; // 目标/期望

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

// ---- analysis cases (分析案例库) ----

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

export interface AnalysisCaseInput {
  title: string;
  category: string;
  scenario: string;
  approach: string;
  conclusion: string;
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
  | { type: "send"; sessionId: string; text: string; model?: string; skillPaths?: string[]; injectRulesPrompt?: boolean; injectKnowledgePrompt?: boolean; collectWeb?: boolean; businessRequirementContext?: { pathId: number; markdownPath: string; jsonPath?: string } }
  | { type: "abort"; sessionId: string }
  | { type: "send_flow"; flowId: string; text: string; model?: string; systemPrompt?: string; skillPaths?: string[]; injectRulesPrompt?: boolean; injectKnowledgePrompt?: boolean }
  | { type: "abort_flow"; flowId: string }
  | { type: "abort_multi_agent"; flowId: string; runId: string }
  | { type: "execute_multi_agent"; flowId: string; runId: string; inputs?: Record<string, string>; model?: string; injectRulesPrompt?: boolean; injectKnowledgePrompt?: boolean; resumeFromNodeId?: string; previousRunId?: string }
  | { type: "subscribe"; sessionId: string }
  | { type: "execute_anax_precheck"; precheckId: string; workspaceId: string; data_files: string; model?: string }
  | { type: "abort_anax_precheck"; precheckId: string };

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
  | { type: "blackboard_update"; flowId: string; runId: string; key: string; value: string }
  | { type: "agent_gate"; flowId: string; runId: string; nodeId: string; verdict: GateVerdict }
  | { type: "anax_precheck_event"; precheckId: string; event: PiEvent }
  | { type: "anax_precheck_done"; precheckId: string; score: number | null; pass: boolean; summary: string }
  | { type: "anax_precheck_error"; precheckId: string; message: string };

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
  skillPaths?: string[]; // 省略/[]=禁用；非空=指定子集
}

export type CompositeSubAgentRole = "planner" | "coder" | "reviewer";
export type CompositeSubAgentRunStatus = "running" | "success" | "failed" | "aborted" | "waiting_for_help";

export interface CompositeSubAgentRun {
  id: string;
  parentSessionId: string;
  workspaceId?: string;
  brief: string;
  dataFiles: string[];
  model?: string;
  status: CompositeSubAgentRunStatus;
  plannerTaskId?: string;
  coderTaskIds: string[];
  reviewerTaskIds: string[];
  currentRole?: CompositeSubAgentRole;
  reviewRounds: number;
  maxReviewRounds: number;
  summary?: string;
  error?: string;
  createdAt: number;
  endedAt?: number;
}

export type SubAgentBlackboardScope = "parent_session";
export type SubAgentBlackboardKind = "metric_definition" | "business_rule" | "finding" | "assumption" | "note";

export interface SubAgentBlackboardEntry {
  id: string;
  workspaceId: string;
  parentSessionId: string;
  sourceTaskId?: string;
  scope: SubAgentBlackboardScope;
  kind: SubAgentBlackboardKind;
  title: string;
  content: string;
  createdAt: number;
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
  source: "custom" | "builtin";
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

export type FlowNodeRunStatus = "running" | "success" | "failed" | "blocked" | "aborted";

export interface FlowNodeRun {
  id: string;
  flowRunId: string;
  flowId: string;
  flowName?: string;
  workspaceId?: string;
  nodeId: string;
  role?: string;
  kind: "agent" | "gate" | "tool";
  status: FlowNodeRunStatus;
  startedAt: number;
  endedAt?: number;
  outputPath?: string;
}

export interface WorkflowAgentsBoard {
  agents: WorkflowAgentEntry[];
  runs: WorkflowRunView[];
  nodeRuns: FlowNodeRun[];
}

// ---- Knowledge Graph ----

export type KgNodeType = "rule" | "metric" | "ref_file" | "biz_ctx" | "report" | "concept" | "constraint" | "experience" | "episode" | "fact";
export type KgRelation = "related_to" | "references" | "supports" | "derived_from";

export interface KgNode {
  id: string;
  workspaceId: string;
  type: KgNodeType;
  /** Stable key: e.g. "rule:{id}", "standard:{id}", "biz_ctx:{id}", "report:{path}" */
  sourceKey: string;
  title: string;
  summary: string;
  tags: string[];
  contentHash: string | null;
  /** contentHash value at the time AI extraction last ran for this report node. Null = never extracted. */
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
  // D-ZH7 C-mini 字段（口径中心化最小闭环）
  displayName?: string;       // 展示名（中文，如「销售额」）
  aggregation?: string;       // 聚合方式（sum/count/avg/max/min/distinct_count）
  periodGrain?: string;       // 周期粒度（day/week/month/quarter/year）
  filters?: string;           // 过滤条件（如 "status='paid'"）
  denominator?: string;       // 分母指标 id（比率类指标，如转化率=订单量/访客量）
  version?: number;           // 口径版本号
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
  displayName?: string;
  aggregation?: string;
  periodGrain?: string;
  filters?: string;
  denominator?: string;
  version?: number;
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
  toolIds?: string[];           // 场景包绑定的 analysis ExtractionTool；仅预填 @工具卡，不自动运行
  toolParamMap?: Record<string, string>; // command param.key -> tool 参数名 / inputPath
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

// P1-a：某历史版本的内容快照（回滚前预览/查看历史版本内容）。
export interface SkillVersionContent {
  version: number;
  content: string;
}

// P1-g：去重/冲突检测结果（采纳/新建时展示"疑似重复"，复用 retrieval BM25 相似度）。
export interface SkillRegistryConflict {
  id: string;
  workspaceId: string;
  itemKind: "skill";
  itemId: string;
  slug: string;
  name: string;
  version: number;
  status: SkillStatus;
  score: number; // BM25 相似度
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

// ── 体检模块契约（X-HEALTH0 接缝，总控审定口径代笔）──
// 确定性规则巡检（零 LLM）：问题=已越界(截面)；风险=趋势指向越界(需时序)。
export type HealthSuite = "daily" | "weekly" | "monthly" | "quarterly" | "yearly";
export type HealthCategory = "数据质量" | "指标异常" | "勾稽一致" | "趋势风险";
export type HealthFindingKind = "问题" | "风险";
export type FindingLifecycle = "new" | "recurring" | "worsening" | "resolved";
export type DatasetShape = "timeseries" | "snapshot" | "dimension";
export type MonitorSourceRole = "goal" | "source" | "industry" | "competitor";
export type MonitorComparisonKind = "target" | "history" | "industry" | "competitor";

export interface MonitorDatasetBinding {
  datasetPathId: string;
  role: MonitorSourceRole;
  label?: string;
  updatedAt?: number;
}

export interface MonitorConfig {
  id: string;
  workspaceId: string;
  suite: HealthSuite;
  datasetBindings: MonitorDatasetBinding[];
  ontologyId?: string;
  metricSystemId?: string;
  thresholds?: Record<string, number>;
  createdAt: number;
  updatedAt: number;
}

export interface MonitorMetricBinding {
  metricId: string;
  datasetPathId: string;
  valueColumn: string;
  timeColumn?: string;
  dimensionColumns?: string[];
  targetMetricId?: string;
  benchmarkMetricId?: string;
  competitorMetricId?: string;
}

export interface MonitorMetricDraft {
  name: string;
  description: string;
  formula?: string;
  unit?: string;
  objectIds?: string[];
  bindings: MonitorMetricBinding[];
  confidence: number;
}

export interface MonitorMetricDependency {
  metricId: string;
  relatedMetricId: string;
  relation: "driver" | "guardrail" | "derived" | "benchmark" | "competing";
  rationale: string;
}

export interface MonitorRuleDraft {
  title: string;
  comparisonKinds: MonitorComparisonKind[];
  metricIds: string[];
  threshold?: number;
  rationale: string;
}

export interface MonitorMetricSystemDraft {
  metrics: MonitorMetricDraft[];
  dependencies: MonitorMetricDependency[];
  monitorRules: MonitorRuleDraft[];
  assumptions: string[];
  missingData: string[];
}

export interface MonitorMetricSystemEntry {
  id: string;
  workspaceId: string;
  name: string;
  draft: MonitorMetricSystemDraft;
  status: "adopted" | "archived" | string;
  createdAt: number;
  updatedAt: number;
}

export interface MonitorRun {
  id: string;
  workspaceId: string;
  suite: HealthSuite;
  metricSystemId: string | null;
  startedAt: number;
  finishedAt: number | null;
  problemCount: number;
  riskCount: number;
  status: "running" | "done" | "error";
}

export interface MonitorComparison {
  kind: MonitorComparisonKind;
  label: string;
  currentValue: number | null;
  baselineValue: number | null;
  delta: number | null;
  deltaRate: number | null;
  window?: string;
  evidence?: Record<string, unknown>;
}

export interface MonitorFindingDiagnosis {
  summary: string;
  relatedMetricIds: string[];
  ontologyObjectIds: string[];
  ontologyLinkIds?: string[];
  logicRuleIds?: string[];
  opportunity?: string;
}

export interface MonitorActionSource {
  workspaceId: string;
  runId: string;
  findingIds: string[];
}

export interface HealthRuleNeeds {
  timeSeries: boolean;
  crossDataset?: boolean;
  ontologyRefs?: Array<"metric" | "link" | "object">;
}

export interface HealthRuleMeta {
  id: string;
  category: HealthCategory;
  title: string;
  description: string;
  suites: HealthSuite[];
  kind: HealthFindingKind;
  needs: HealthRuleNeeds;
  thresholds: Record<string, number>;
  enabled: boolean;
}

export interface HealthFinding {
  id: string;
  runId: string;
  ruleId: string;
  category: HealthCategory;
  kind: HealthFindingKind;
  severity: "info" | "warn" | "critical";
  lifecycle: FindingLifecycle;
  signature: string; // 跨 run 识别同一问题的稳定指纹
  firstSeenRunId: string | null;
  title: string;
  evidence: Record<string, unknown>; // 须自解释到可手工复算
  boundTo?: { datasetPathId?: string; objectId?: string; metricId?: string; column?: string };
  comparisons?: MonitorComparison[];
  diagnosis?: MonitorFindingDiagnosis;
  suggestion: string; // 规则模板，非 LLM
  detectedAt: number;
}

export interface HealthRun {
  id: string;
  workspaceId: string;
  suite: HealthSuite;
  datasetPathIds: string[];
  startedAt: number;
  finishedAt: number | null;
  problemCount: number;
  riskCount: number;
  status: "running" | "done" | "error";
}

export interface OntologyGap {
  datasetPathId: string;
  column: string;
  reason: string;
  suggestedConcept?: string;
}
