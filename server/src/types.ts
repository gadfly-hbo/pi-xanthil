// Domain + protocol types shared conceptually with the web client.
// (Duplicated in web/src/types.ts to keep the two packages decoupled.)

import type { GateVerdict } from "./anax-gate.ts";

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

export interface EvaluationArchiveResult {
  markdownPath: string;
  jsonPath: string;
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
  | { type: "send"; sessionId: string; text: string; model?: string; skillPaths?: string[]; injectRulesPrompt?: boolean; businessRequirementContext?: { pathId: number; markdownPath: string; jsonPath?: string } }
  | { type: "abort"; sessionId: string }
  | { type: "send_flow"; flowId: string; text: string; model?: string; systemPrompt?: string; skillPaths?: string[]; injectRulesPrompt?: boolean }
  | { type: "abort_flow"; flowId: string }
  | { type: "abort_multi_agent"; flowId: string; runId: string }
  | { type: "execute_flow"; flowId: string; runId: string; text: string; model?: string; injectRulesPrompt?: boolean }
  | { type: "execute_multi_agent"; flowId: string; runId: string; inputs?: Record<string, string>; model?: string; injectRulesPrompt?: boolean; resumeFromNodeId?: string; previousRunId?: string }
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

// ---- Knowledge Graph ----

export type KgNodeType = "rule" | "metric" | "ref_file" | "biz_ctx" | "report" | "concept";
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
