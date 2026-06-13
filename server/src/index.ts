import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { execFile, execFileSync } from "node:child_process";
import { homedir, tmpdir } from "node:os";
import { basename, dirname, extname, join, resolve, sep } from "node:path";
import { randomUUID } from "node:crypto";
import { sessionDir, standardDirIn } from "./workspace-dirs.ts";
import {
  createForkBranch,
  listForkBranches,
  listBranchSessionIds,
  getForkBranchByBranchSession,
  markForkBranchSeeded,
  setForkBranchStatus,
  createSubAgentTask,
  listSubAgentTasks,
  getSubAgentTask,
  finishSubAgentTask,
} from "./db/shared.ts";
import { moveManagedDirToTrash } from "./trash.ts";
import { registerDomainRoutes } from "./routes/index.ts";
import { parseAggregationBuffer } from "./bi-dataset-parser.ts";
import express from "express";
import cors from "cors";
import multer from "multer";
import mammoth from "mammoth";
import * as XLSX from "xlsx";
import { WebSocketServer, type WebSocket } from "ws";
import { BI_DATASETS_ROOT, DIRECT_LLM_ROOT, EXTRACTION_RUNS_ROOT, FAVORITES_ROOT, PORT, UPLOAD_TMP_ROOT, WORKSPACES_ROOT, ensureDirs } from "./config.ts";
import {
  addFlowMessage,
  addMessage,
  addTraceEvent,
  pruneTraceEvents,
  pruneAllTraceEvents,
  addWorkspacePath,
  buildEnabledRulesPrompt,
  buildEnabledStandardsPrompt,
  buildEnabledBusinessContextPrompt,
  listBusinessContexts,
  createBusinessContext,
  updateBusinessContext,
  deleteBusinessContext,
  buildEnabledCasesPrompt,
  listAnalysisCases,
  createAnalysisCase,
  updateAnalysisCase,
  deleteAnalysisCase,
  listAnalysisStandards,
  createAnalysisStandard,
  updateAnalysisStandard,
  deleteAnalysisStandard,
  listHypotheses,
  createHypothesis,
  updateHypothesisEnabled,
  deleteHypothesis,
  upsertHypothesisFromArchive,
  buildHypothesisLibraryContext,
  approveMemoryProposal,
  createMemoryFailureAttribution,
  createFlow,
  createFlowRun,
  createMemoryEvaluation,
  createRuleMemoryProposal,
  createRuleMemory,
  createSession,
  createSkillEvalSet,
  createToolCaseSet,
  createWorkflowFavorite,
  createWorkflowEvaluation,
  createWorkspace,
  deleteFlow,
  deleteRuleMemory,
  deleteSession,
  deleteSkillEvalSet,
  deleteToolCaseSet,
  deleteWorkspace,
  finishFlowRun,
  getFileAnalysis,
  getFileAnalysesByPathIds,
  getFlow,
  getFlowRun,
  getSession,
  getSessionRuntime,
  getWorkflowFavorite,
  getWorkflowFavoriteBySourceFlowId,
  getWorkflowEvaluation,
  getMemoryEvaluation,
  getMemoryProposal,
  getSkillEvaluation,
  getSkillEvalSet,
  getToolEvaluation,
  getToolCaseSet,
  getWorkspace,
  getWorkspacePath,
  listFlowMessages,
  listFlowRuns,
  listFlows,
  listMessages,
  listRuleMemories,
  listSkillEvalSets,
  getTraceOverview,
  getTraceTimeline,
  getTraceTrend,
  generateTraceRuleSuggestions,
  listTraceFailures,
  listMemoryInjectionRecords,
  listTraceRecentEvents,
  listSessions,
  listWorkflowFavorites,
  listWorkflowEvaluations,
  listMemoryEvaluations,
  listMemoryProposals,
  listMemoryUsageStats,
  listMemoryFailureAttributions,
  detectRuleConflicts,
  listRuleConflicts,
  listSkillEvaluations,
  listToolEvaluations,
  listToolCaseSets,
  listWorkspacePaths,
  listWorkspaces,
  recordMemoryFeedback,
  recordMemoryInjectionUsage,
  removeWorkspacePath,
  removeWorkflowFavorite,
  renameFlow,
  renameSession,
  renameWorkspace,
  setFileAnalysis,
  saveSkillEvaluation,
  saveToolEvaluation,
  updateFlowGeneration,
  updateFlowSourceName,
  updateSessionRuntime,
  updateSkillEvalSet,
  updateToolCaseSet,
  updateWorkflowFavorite,
  updateRuleMemory,
  updateWorkspacePathHash,
  createChangeProposal,
  getAnaxGateConfig,
  upsertAnaxGateConfig,
  listChangeProposals,
  updateChangeProposal,
  deleteChangeProposal,
  markNodesStale,
  getStaleNodes,
  clearStaleNodes,
  createModelLabRun,
  getModelLabRun,
  getModelLabStats,
  listModelLabRuns,
  deleteModelLabRun,
  deleteModelLabRunsBefore,
  insertBiDataset,
  listBiDatasets,
  getBiDatasetById,
  getActiveBiDataset,
  deleteBiDataset,
  setActiveBiDataset,
  listSkillCurationProposals,
  updateSkillCurationProposalStatus,
  updateRuleConflictStatus,
  rejectMemoryProposal,
  listReportFavoriteIds,
  addReportFavorite,
  removeReportFavorite,
  listAllReportTags,
  listTagsForReports,
  addReportTag,
  removeReportTag,
} from "./db.ts";
import { scanAllReports } from "./reports.ts";
import { getDownstreamNodeIds } from "./change-management.ts";
import { computeFileHash } from "./file-hash.ts";
import { renderMarkdownReportToHtml } from "./html-report.ts";
import { runWorkflowEvaluation } from "./evaluation-runner.ts";
import { runMemoryEvaluation } from "./memory-evaluation-runner.ts";
import { archiveSkillEvaluation, archiveToolEvaluation, listEvaluationArchives } from "./evaluation-archive.ts";
import { runSkillEvaluation } from "./skill-evaluation-runner.ts";
import { parseSkillEvaluationRunRequest } from "./skill-evaluation-api.ts";
import { applySkillCurationProposals, autoTriggerCuration, curateSkillEvaluation } from "./skill-curator.ts";
import { runToolEvaluation } from "./tool-evaluation-runner.ts";
import { parseToolEvaluationCases, parseToolEvaluationRunRequest, resolveToolEvaluationCasePaths } from "./tool-evaluation-api.ts";
import { DEFAULT_REVIEW_PROMPT, buildReviewPrompt, buildAutoFixPrompt, AUTO_FIX_SYSTEM_PROMPT, parseReviewScore, type ReviewAnnotation, type ReviewHistoryEntry } from "./report-review.ts";
import { copyFlowSnapshot, copyLocalFolderIntoFlow, inferWorkflow, moveAllFiles, readFlowFile, readTree, safeResolve, writeFlowFile } from "./flow-fs.ts";
import { compactPiSession, getPiSessionStats, runPiPrompt, runPiTurn, type PiRun } from "./pi-adapter.ts";

import { readWorkflow, renderPrompt, runMultiAgent, topoOrder } from "./multi-agent-runner.ts";
import { buildAnaxQuickWorkflow, buildAnaxWorkflow } from "./anax-template.ts";
import { buildModelLabPrompt, SUPPORTED_MODELS, type ModelLabId } from "./model-lab.ts";
import { buildRegisteredPathContext, resolveOutputTarget } from "./output-paths.ts";
import { listSkills, validateSkillPaths } from "./skills.ts";
import { retrieveSkills } from "./skill-retrieval.ts";
import { buildSkillDistillationPrompt, extractSkillMarkdown, parseSkillName, SKILL_DISTILL_SYSTEM_PROMPT, slugifySkillName } from "./skill-distillation.ts";
import { runAutonomousTask } from "./autonomous-runner.ts";
import { getSessionTokenStats, getWorkspaceTodayTokenStats, getWorkspaceTokenStats, listWorkspaceTokenUsageStats, trackSessionWorkspaceUsage, trackWorkspaceUsage } from "./cache.ts";
import { buildKgPrompt, extractKgEntitiesFromReports, syncKnowledgeGraph } from "./knowledge-graph.ts";
import { deleteKgEdge, insertManualKgEdge, listKgEdges, listKgNodes, setKgNodeHidden } from "./db.ts";
import { buildMemoryInjectionSnapshot, buildMemoryPrompt } from "./memory-injection.ts";
import type { BiDatasetSlot, ClientMessage, DecisionTreeNode, PiEvent, PredictionResult, PredictionTierColor, PredictionVariant, ServerMessage, Session, TokenUsageTargetKind, TraceRuleSuggestion, WorkspacePath } from "./types.ts";
import type { EvaluationFlowConfig } from "./types.ts";
import { getExtractionTool, listExtractionTools, validateExtractionInput } from "../tools/registry.ts";
import { ensureWorkspaceMcpConfig, registerAllWorkspaceMcp } from "./mcp/register.ts";
import { registerChildProcess } from "./child-processes.ts";
import { buildSanitizedEnv } from "./process-env.ts";

ensureDirs();
XLSX.set_fs({ readFileSync });

// System prompts injected via --system-prompt on the first (and every) pi turn for workflow sessions.
const WORKFLOW_SYSTEM_PROMPTS: Record<string, string> = {
  explore:
    "你是一个数据探查专家。帮助用户快速了解数据集的基本情况、分布与数据质量。用户提供数据文件路径后，主动分析：行列数、数据类型、缺失值统计、各列基本统计量（均值/中位数/最大最小值），以及潜在的质量问题。请等待用户提供数据。",
  clean:
    "你是一个数据清洗专家。帮助用户处理缺失值、异常值与格式不一致问题。先诊断数据质量问题，提出清洗方案并请用户确认，再执行清洗操作并输出清洗后的数据。请等待用户提供数据。",
  eda: "你是一个探索性数据分析（EDA）专家。深入挖掘数据中的规律、异常与变量间关联，提出有价值的洞察与假设。请等待用户提供数据。",
  viz: "你是一个数据可视化专家。为用户的数据选择合适的图表类型（折线图、柱状图、散点图、热力图等），生成清晰的可视化图表并提供可执行代码。请等待用户提供数据和可视化需求。",
  stats:
    "你是一个统计分析专家。提供描述性统计、假设检验、相关性分析等。分析时给出统计量、p 值、置信区间等关键指标，并解释其实际意义。请等待用户提供数据。",
  report:
    "你是一个数据分析报告专家。将分析结论整理为结构清晰的报告，包含执行摘要、核心发现、方法说明与行动建议，输出 Markdown 格式。写入较长报告文件时，禁止在单次 write 工具调用中传递完整长文；优先使用 bash heredoc 分块写入，或先创建文件再按章节追加，每块控制在合理长度。请等待用户提供分析结果或数据。",
  timeseries:
    "你是一个时间序列分析专家。分析时序数据的趋势、周期性、季节性和异常，提供分解分析或预测。请等待用户提供时序数据。",
  anomaly:
    "你是一个异常检测专家。使用统计方法或机器学习算法识别数据中的异常点与离群值，并解释其可能原因。请等待用户提供数据。",
  correlation:
    "你是一个相关性分析专家。量化变量间的关联强度与方向，区分相关性与因果性，提供相关矩阵与可视化。请等待用户提供数据。",
  compare:
    "你是一个分组对比分析专家。对多组数据进行差异分析，使用适当的统计检验（t 检验、方差分析等）验证差异显著性。请等待用户提供数据和分组信息。",
  modeling:
    "你是一个预测建模专家。帮助用户构建回归或分类预测模型，包括特征工程、模型选择、训练与评估。请等待用户提供数据和建模目标。",
  text: "你是一个文本分析专家。从文本数据中提取特征、分析情感倾向、识别关键词与主题。请等待用户提供文本数据。",
};

function withRulesPrompt(workspaceId: string, targetScope: "chat" | "workflow", systemPrompt?: string): string | undefined {
  const memoryPrompt = buildMemoryPrompt(workspaceId, targetScope);
  if (!memoryPrompt) return systemPrompt;
  return [memoryPrompt, systemPrompt].filter(Boolean).join("\n\n");
}

const app = express();
app.use(cors());
app.use(express.json({ limit: "8mb" }));

const DEFAULT_DECISION_TREE_MODEL = "minimax-cn/MiniMax-M3";
const DEFAULT_PRESENTATION_VERSION_MODEL = "minimax-cn/MiniMax-M3";
const DEFAULT_GOLDEN_STRATEGY_MODEL = "minimax-cn/MiniMax-M3";
const DEFAULT_BUSINESS_REQUIREMENT_MODEL = "minimax-cn/MiniMax-M3";
const MAX_GOLDEN_STRATEGY_BATCH_MODELS = 3;

type WorkflowLike = {
  defaultModel?: unknown;
  defaultSkillPaths?: unknown;
  nodes?: Array<{ id?: unknown; model?: unknown; skillPaths?: unknown }>;
};

function listConfiguredModelIds(): string[] {
  try {
    const settingsPath = join(homedir(), ".pi", "agent", "settings.json");
    const settings = JSON.parse(readFileSync(settingsPath, "utf8")) as { enabledModels?: unknown };
    return Array.isArray(settings.enabledModels) ? settings.enabledModels.filter((id): id is string => typeof id === "string") : [];
  } catch {
    return [];
  }
}

function resolveConfiguredModelId(model: string, configured: string[]): string | null {
  const trimmed = model.trim();
  if (!trimmed) return "";
  if (configured.includes(trimmed)) return trimmed;

  const rawModel = trimmed.includes("/") ? trimmed.slice(trimmed.lastIndexOf("/") + 1) : trimmed;
  const matches = configured.filter((id) => id.slice(id.lastIndexOf("/") + 1) === rawModel);
  return matches.length === 1 ? matches[0]! : null;
}

function normalizeWorkflowModels<T extends WorkflowLike>(workflow: T): T {
  const configured = listConfiguredModelIds();
  if (configured.length === 0) return workflow;

  const normalize = (value: unknown, label: string): string | undefined => {
    if (value == null) return undefined;
    if (typeof value !== "string") throw new Error(`${label} must be a string`);
    const resolved = resolveConfiguredModelId(value, configured);
    if (resolved == null) {
      throw new Error(`${label} is not enabled in pi CLI: ${value}. Allowed models: ${configured.join(", ")}`);
    }
    return resolved || undefined;
  };

  const defaultModel = normalize(workflow.defaultModel, "defaultModel");
  if (defaultModel !== undefined) workflow.defaultModel = defaultModel;
  for (const node of workflow.nodes ?? []) {
    const nodeId = typeof node.id === "string" ? node.id : "unknown";
    const model = normalize(node.model, `nodes.${nodeId}.model`);
    if (model !== undefined) node.model = model;
  }
  return workflow;
}

function normalizeWorkflowSkills<T extends WorkflowLike>(flowRoot: string, workflow: T): T {
  if (workflow.defaultSkillPaths !== undefined) {
    workflow.defaultSkillPaths = validateWorkflowSkillList(flowRoot, workflow.defaultSkillPaths, "defaultSkillPaths");
  }
  for (const node of workflow.nodes ?? []) {
    if (node.skillPaths === undefined) continue;
    const nodeId = typeof node.id === "string" ? node.id : "unknown";
    node.skillPaths = validateWorkflowSkillList(flowRoot, node.skillPaths, `nodes.${nodeId}.skillPaths`);
  }
  return workflow;
}

function validateWorkflowSkillList(flowRoot: string, value: unknown, label: string): string[] {
  if (!Array.isArray(value) || !value.every((item) => typeof item === "string")) {
    throw new Error(`${label} must be a string array`);
  }
  return validateSkillPaths(flowRoot, value, { mode: "lenient" }) ?? [];
}

type PromoteScope = "latest_task" | "full_conversation";

function extractStoredMessageText(content: unknown): string {
  if (!Array.isArray(content)) return "";
  return content
    .filter(
      (block): block is { type: "text"; text: string } =>
        typeof block === "object"
        && block !== null
        && (block as { type?: unknown }).type === "text"
        && typeof (block as { text?: unknown }).text === "string",
    )
    .map((block) => block.text)
    .join("\n")
    .trim();
}

type TocGraphKind = "goal" | "symptom" | "constraint" | "root_cause" | "action" | "monitor";

interface TocGraphItem {
  id: string;
  title: string;
  body: string;
  kind: TocGraphKind;
  parentId?: string;
}

const TOC_GRAPH_KINDS = new Set<TocGraphKind>(["goal", "symptom", "constraint", "root_cause", "action", "monitor"]);
const DEFAULT_TOC_MODEL = "minimax-cn/MiniMax-M3";

type GoldenStrategyModelId =
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

type GoldenStrategyNodeKind =
  | "root" | "factor" | "evidence" | "conclusion"
  | "goal" | "symptom" | "constraint" | "root_cause" | "action" | "monitor"
  | "strength" | "weakness" | "opportunity" | "threat"
  | "political" | "economic" | "social" | "technological" | "environmental" | "legal"
  | "rivalry" | "supplier" | "buyer" | "substitute" | "new_entrant"
  | "primary_activity" | "support_activity"
  | "star" | "cash_cow" | "question_mark" | "dog"
  | "market_penetration" | "market_development" | "product_development" | "diversification"
  | "product" | "price" | "place" | "promotion"
  | "customer_segment" | "value_proposition" | "channel" | "customer_relationship" | "revenue_stream"
  | "key_resource" | "key_activity" | "key_partner" | "cost_structure";

interface GoldenStrategyNode {
  id: string;
  title: string;
  body: string;
  kind: GoldenStrategyNodeKind;
  parentId?: string;
}

interface GoldenStrategyModelDefinition {
  id: GoldenStrategyModelId;
  label: string;
  expertRole: string;
  objective: string;
  requiredKinds: GoldenStrategyNodeKind[];
  allowedKinds: GoldenStrategyNodeKind[];
  schemaExample: string;
}

const GOLDEN_STRATEGY_MODELS: Record<GoldenStrategyModelId, GoldenStrategyModelDefinition> = {
  decision_tree: {
    id: "decision_tree",
    label: "决策树分析",
    expertRole: "决策推理分析师",
    objective: "拆解决策推理因子、证据依据和最终决策结论建议，形成从报告输入到结论的推导链路。",
    requiredKinds: ["root", "conclusion"],
    allowedKinds: ["root", "factor", "evidence", "conclusion"],
    schemaExample: "{\"nodes\":[{\"id\":\"root\",\"title\":\"报告输入\",\"body\":\"具体报告摘要\",\"kind\":\"root\"},{\"id\":\"factor_1\",\"title\":\"推理因子 1\",\"body\":\"具体推理因子\",\"kind\":\"factor\",\"parentId\":\"root\"},{\"id\":\"evidence_1\",\"title\":\"依据 1\",\"body\":\"具体证据依据\",\"kind\":\"evidence\",\"parentId\":\"factor_1\"},{\"id\":\"conclusion\",\"title\":\"决策结论建议\",\"body\":\"具体决策建议\",\"kind\":\"conclusion\",\"parentId\":\"factor_1\"}]}",
  },
  toc: {
    id: "toc",
    label: "TOC 约束理论",
    expertRole: "TOC 约束理论业务诊断专家",
    objective: "识别业务目标、症状/UDE、当前主约束、根因链、TOC 五步法动作和监控指标。",
    requiredKinds: ["goal", "constraint"],
    allowedKinds: ["goal", "symptom", "constraint", "root_cause", "action", "monitor"],
    schemaExample: "{\"nodes\":[{\"id\":\"goal\",\"title\":\"业务目标\",\"body\":\"具体业务目标\",\"kind\":\"goal\"},{\"id\":\"constraint\",\"title\":\"当前主约束\",\"body\":\"具体约束说明\",\"kind\":\"constraint\",\"parentId\":\"goal\"},{\"id\":\"monitor\",\"title\":\"监控指标\",\"body\":\"具体监控指标\",\"kind\":\"monitor\",\"parentId\":\"constraint\"}]}",
  },
  swot: {
    id: "swot",
    label: "SWOT 分析",
    expertRole: "战略分析顾问",
    objective: "把报告中的内部优势、内部劣势、外部机会、外部威胁整理成可行动的战略判断。",
    requiredKinds: ["strength", "weakness", "opportunity", "threat", "conclusion"],
    allowedKinds: ["root", "strength", "weakness", "opportunity", "threat", "action", "conclusion"],
    schemaExample: "{\"nodes\":[{\"id\":\"root\",\"title\":\"分析对象\",\"body\":\"具体对象和情境\",\"kind\":\"root\"},{\"id\":\"strength\",\"title\":\"优势\",\"body\":\"具体优势\",\"kind\":\"strength\",\"parentId\":\"root\"},{\"id\":\"weakness\",\"title\":\"劣势\",\"body\":\"具体劣势\",\"kind\":\"weakness\",\"parentId\":\"root\"},{\"id\":\"opportunity\",\"title\":\"机会\",\"body\":\"具体机会\",\"kind\":\"opportunity\",\"parentId\":\"root\"},{\"id\":\"threat\",\"title\":\"威胁\",\"body\":\"具体威胁\",\"kind\":\"threat\",\"parentId\":\"root\"},{\"id\":\"conclusion\",\"title\":\"策略建议\",\"body\":\"具体策略建议\",\"kind\":\"conclusion\",\"parentId\":\"opportunity\"}]}",
  },
  pestel: {
    id: "pestel",
    label: "PESTEL 分析",
    expertRole: "宏观环境分析师",
    objective: "从政治、经济、社会、技术、环境、法律六个维度识别外部环境影响和策略含义。",
    requiredKinds: ["political", "economic", "social", "technological", "environmental", "legal"],
    allowedKinds: ["root", "political", "economic", "social", "technological", "environmental", "legal", "conclusion"],
    schemaExample: "{\"nodes\":[{\"id\":\"root\",\"title\":\"外部环境对象\",\"body\":\"具体对象\",\"kind\":\"root\"},{\"id\":\"political\",\"title\":\"Political\",\"body\":\"政治因素\",\"kind\":\"political\",\"parentId\":\"root\"},{\"id\":\"economic\",\"title\":\"Economic\",\"body\":\"经济因素\",\"kind\":\"economic\",\"parentId\":\"root\"},{\"id\":\"social\",\"title\":\"Social\",\"body\":\"社会因素\",\"kind\":\"social\",\"parentId\":\"root\"},{\"id\":\"technological\",\"title\":\"Technological\",\"body\":\"技术因素\",\"kind\":\"technological\",\"parentId\":\"root\"},{\"id\":\"environmental\",\"title\":\"Environmental\",\"body\":\"环境因素\",\"kind\":\"environmental\",\"parentId\":\"root\"},{\"id\":\"legal\",\"title\":\"Legal\",\"body\":\"法律因素\",\"kind\":\"legal\",\"parentId\":\"root\"}]}",
  },
  porter_five_forces: {
    id: "porter_five_forces",
    label: "Porter 五力模型",
    expertRole: "行业竞争分析师",
    objective: "评估现有竞争、供应商议价、买方议价、替代品威胁和新进入者威胁。",
    requiredKinds: ["rivalry", "supplier", "buyer", "substitute", "new_entrant"],
    allowedKinds: ["root", "rivalry", "supplier", "buyer", "substitute", "new_entrant", "conclusion"],
    schemaExample: "{\"nodes\":[{\"id\":\"root\",\"title\":\"行业/业务范围\",\"body\":\"具体范围\",\"kind\":\"root\"},{\"id\":\"rivalry\",\"title\":\"现有竞争\",\"body\":\"竞争强度\",\"kind\":\"rivalry\",\"parentId\":\"root\"},{\"id\":\"supplier\",\"title\":\"供应商议价\",\"body\":\"供应商压力\",\"kind\":\"supplier\",\"parentId\":\"root\"},{\"id\":\"buyer\",\"title\":\"买方议价\",\"body\":\"买方压力\",\"kind\":\"buyer\",\"parentId\":\"root\"},{\"id\":\"substitute\",\"title\":\"替代品威胁\",\"body\":\"替代压力\",\"kind\":\"substitute\",\"parentId\":\"root\"},{\"id\":\"new_entrant\",\"title\":\"新进入者威胁\",\"body\":\"进入威胁\",\"kind\":\"new_entrant\",\"parentId\":\"root\"}]}",
  },
  value_chain: {
    id: "value_chain",
    label: "价值链分析",
    expertRole: "经营效率分析师",
    objective: "拆解主要活动和支持活动，定位价值创造、成本消耗和改进杠杆。",
    requiredKinds: ["primary_activity", "support_activity", "conclusion"],
    allowedKinds: ["root", "primary_activity", "support_activity", "factor", "action", "conclusion"],
    schemaExample: "{\"nodes\":[{\"id\":\"root\",\"title\":\"价值链对象\",\"body\":\"具体对象\",\"kind\":\"root\"},{\"id\":\"primary_1\",\"title\":\"主要活动\",\"body\":\"主要活动表现\",\"kind\":\"primary_activity\",\"parentId\":\"root\"},{\"id\":\"support_1\",\"title\":\"支持活动\",\"body\":\"支持活动表现\",\"kind\":\"support_activity\",\"parentId\":\"root\"},{\"id\":\"conclusion\",\"title\":\"价值杠杆\",\"body\":\"具体改进杠杆\",\"kind\":\"conclusion\",\"parentId\":\"primary_1\"}]}",
  },
  bcg_matrix: {
    id: "bcg_matrix",
    label: "BCG 矩阵",
    expertRole: "业务组合分析师",
    objective: "按增长潜力和相对竞争地位判断明星、现金牛、问题和瘦狗业务，并给出资源配置建议。",
    requiredKinds: ["star", "cash_cow", "question_mark", "dog"],
    allowedKinds: ["root", "star", "cash_cow", "question_mark", "dog", "action", "conclusion"],
    schemaExample: "{\"nodes\":[{\"id\":\"root\",\"title\":\"业务组合\",\"body\":\"具体组合\",\"kind\":\"root\"},{\"id\":\"star\",\"title\":\"明星业务\",\"body\":\"具体判断\",\"kind\":\"star\",\"parentId\":\"root\"},{\"id\":\"cash_cow\",\"title\":\"现金牛业务\",\"body\":\"具体判断\",\"kind\":\"cash_cow\",\"parentId\":\"root\"},{\"id\":\"question_mark\",\"title\":\"问题业务\",\"body\":\"具体判断\",\"kind\":\"question_mark\",\"parentId\":\"root\"},{\"id\":\"dog\",\"title\":\"瘦狗业务\",\"body\":\"具体判断\",\"kind\":\"dog\",\"parentId\":\"root\"}]}",
  },
  ansoff_matrix: {
    id: "ansoff_matrix",
    label: "Ansoff 增长矩阵",
    expertRole: "增长战略顾问",
    objective: "围绕现有/新市场与现有/新产品，推演市场渗透、市场开发、产品开发和多元化路径。",
    requiredKinds: ["market_penetration", "market_development", "product_development", "diversification"],
    allowedKinds: ["root", "market_penetration", "market_development", "product_development", "diversification", "action", "conclusion"],
    schemaExample: "{\"nodes\":[{\"id\":\"root\",\"title\":\"增长目标\",\"body\":\"具体目标\",\"kind\":\"root\"},{\"id\":\"penetration\",\"title\":\"市场渗透\",\"body\":\"具体路径\",\"kind\":\"market_penetration\",\"parentId\":\"root\"},{\"id\":\"market_dev\",\"title\":\"市场开发\",\"body\":\"具体路径\",\"kind\":\"market_development\",\"parentId\":\"root\"},{\"id\":\"product_dev\",\"title\":\"产品开发\",\"body\":\"具体路径\",\"kind\":\"product_development\",\"parentId\":\"root\"},{\"id\":\"diversification\",\"title\":\"多元化\",\"body\":\"具体路径\",\"kind\":\"diversification\",\"parentId\":\"root\"}]}",
  },
  marketing_4p: {
    id: "marketing_4p",
    label: "4P 营销组合",
    expertRole: "营销策略分析师",
    objective: "从产品、价格、渠道、推广四个维度分析营销组合质量和调整建议。",
    requiredKinds: ["product", "price", "place", "promotion"],
    allowedKinds: ["root", "product", "price", "place", "promotion", "action", "conclusion"],
    schemaExample: "{\"nodes\":[{\"id\":\"root\",\"title\":\"营销对象\",\"body\":\"具体对象\",\"kind\":\"root\"},{\"id\":\"product\",\"title\":\"Product 产品\",\"body\":\"产品分析\",\"kind\":\"product\",\"parentId\":\"root\"},{\"id\":\"price\",\"title\":\"Price 价格\",\"body\":\"价格分析\",\"kind\":\"price\",\"parentId\":\"root\"},{\"id\":\"place\",\"title\":\"Place 渠道\",\"body\":\"渠道分析\",\"kind\":\"place\",\"parentId\":\"root\"},{\"id\":\"promotion\",\"title\":\"Promotion 推广\",\"body\":\"推广分析\",\"kind\":\"promotion\",\"parentId\":\"root\"}]}",
  },
  business_model_canvas: {
    id: "business_model_canvas",
    label: "商业模式画布",
    expertRole: "商业模式设计顾问",
    objective: "用九宫格梳理客户细分、价值主张、渠道、客户关系、收入、资源、活动、伙伴和成本。",
    requiredKinds: ["customer_segment", "value_proposition", "channel", "customer_relationship", "revenue_stream", "key_resource", "key_activity", "key_partner", "cost_structure"],
    allowedKinds: ["root", "customer_segment", "value_proposition", "channel", "customer_relationship", "revenue_stream", "key_resource", "key_activity", "key_partner", "cost_structure", "conclusion"],
    schemaExample: "{\"nodes\":[{\"id\":\"root\",\"title\":\"商业模式对象\",\"body\":\"具体对象\",\"kind\":\"root\"},{\"id\":\"segments\",\"title\":\"客户细分\",\"body\":\"具体客户\",\"kind\":\"customer_segment\",\"parentId\":\"root\"},{\"id\":\"value\",\"title\":\"价值主张\",\"body\":\"具体价值\",\"kind\":\"value_proposition\",\"parentId\":\"root\"},{\"id\":\"channels\",\"title\":\"渠道\",\"body\":\"具体渠道\",\"kind\":\"channel\",\"parentId\":\"root\"},{\"id\":\"relationship\",\"title\":\"客户关系\",\"body\":\"具体关系\",\"kind\":\"customer_relationship\",\"parentId\":\"root\"},{\"id\":\"revenue\",\"title\":\"收入来源\",\"body\":\"具体收入\",\"kind\":\"revenue_stream\",\"parentId\":\"root\"},{\"id\":\"resources\",\"title\":\"关键资源\",\"body\":\"具体资源\",\"kind\":\"key_resource\",\"parentId\":\"root\"},{\"id\":\"activities\",\"title\":\"关键活动\",\"body\":\"具体活动\",\"kind\":\"key_activity\",\"parentId\":\"root\"},{\"id\":\"partners\",\"title\":\"关键伙伴\",\"body\":\"具体伙伴\",\"kind\":\"key_partner\",\"parentId\":\"root\"},{\"id\":\"cost\",\"title\":\"成本结构\",\"body\":\"具体成本\",\"kind\":\"cost_structure\",\"parentId\":\"root\"}]}",
  },
};

function sanitizeReportForLlm(content: string): string {
  return content
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "[图片已省略]")
    .replace(/<img\b[^>]*>/gi, "[图片已省略]")
    .replace(/\S+\.(?:png|jpe?g|gif|webp|heic|svg)(?:\?\S*)?/gi, "[图片路径已省略]");
}

function extractJsonObject(text: string): unknown {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
  const raw = fenced?.[1] ?? text;
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error(`LLM response does not contain JSON object: ${raw.slice(0, 300)}`);
  return JSON.parse(raw.slice(start, end + 1)) as unknown;
}

function isMeaningfulGraphText(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const text = value.trim();
  return Boolean(text) && !/^(?:\.{3}|…+|未提供说明|待补充|暂无|根据原输出填写|具体(?:业务目标|症状说明|约束说明|根因说明|动作说明|监控指标|报告摘要|推理因子|证据依据|决策建议))$/i.test(text);
}

function validateTocGraph(value: unknown): TocGraphItem[] {
  const nodes = typeof value === "object" && value !== null && Array.isArray((value as { nodes?: unknown }).nodes)
    ? (value as { nodes: unknown[] }).nodes
    : Array.isArray(value)
      ? value
      : [];
  const cleaned = nodes.map((node, index) => {
    const source = typeof node === "object" && node !== null ? node as Record<string, unknown> : {};
    const id = typeof source.id === "string" && source.id.trim() ? source.id.trim().replace(/[^a-zA-Z0-9_-]/g, "_") : `node_${index + 1}`;
    const kind = typeof source.kind === "string" && TOC_GRAPH_KINDS.has(source.kind as TocGraphKind) ? source.kind as TocGraphKind : "symptom";
    const title = typeof source.title === "string" && source.title.trim() ? source.title.trim().slice(0, 80) : id;
    if (!isMeaningfulGraphText(source.body)) throw new Error(`TOC graph node ${id} must include meaningful body text`);
    const body = source.body.trim().slice(0, 600);
    const parentId = typeof source.parentId === "string" && source.parentId.trim() ? source.parentId.trim().replace(/[^a-zA-Z0-9_-]/g, "_") : undefined;
    return { id, title, body, kind, parentId } satisfies TocGraphItem;
  });
  if (!cleaned.some((node) => node.kind === "goal")) throw new Error("TOC graph must include a goal node");
  if (!cleaned.some((node) => node.kind === "constraint")) throw new Error("TOC graph must include a constraint node");
  const ids = new Set(cleaned.map((node) => node.id));
  return cleaned.map((node) => node.parentId && ids.has(node.parentId) ? node : { ...node, parentId: undefined });
}

async function repairJsonObject(
  rawOutput: string,
  schemaHint: string,
  workspaceRoot: string,
  model: string,
  sourceContext?: string,
  usageTarget?: { workspaceId: string; targetKind: TokenUsageTargetKind; targetId: string; title: string },
): Promise<unknown> {
  const repaired = await runPiPrompt({
    workspaceRoot,
    model,
    systemPrompt: "你是 JSON 修复器。只输出严格 JSON，不要解释。",
    text: `请把下面模型输出改写为符合 schema 的严格 JSON。如果原输出没有足够信息，请结合来源内容重新分析并生成保守版本。\n每个 body 必须填写基于来源内容的具体说明，禁止返回空字符串、"..."、"…"、"待补充"、schema 示例文本或其他占位文本。\n\nschema：\n${schemaHint}\n\n原输出：\n${rawOutput.slice(0, 8000)}${sourceContext ? `\n\n来源内容：\n${sourceContext.slice(0, 30_000)}` : ""}`,
    timeoutMs: 120_000,
    onEvent: (event) => trackUsageEvent(usageTarget ?? null, event),
  });
  return extractJsonObject(repaired);
}

function trackUsageEvent(
  target: { workspaceId: string; targetKind: TokenUsageTargetKind; targetId: string; title: string } | null,
  event: PiEvent,
): void {
  if (!target || event.type !== "message_end") return;
  const { message } = event as Extract<PiEvent, { type: "message_end" }>;
  if (message.role !== "assistant" || !message.usage) return;
  trackWorkspaceUsage(target, message.usage);
}

function buildTocPrompt(reportName: string, content: string): string {
  return `你是 TOC（Theory of Constraints，高德拉特约束理论）业务诊断专家。请基于报告内容，推理生成一张业务约束推理图。\n\n要求：\n1. 不要做普通目录，不要复述全文。\n2. 找出业务目标、症状/UDE、当前主约束、根因链、TOC五步法动作、监控指标。\n3. 节点必须形成从 goal 到 monitor 的因果/行动链。\n4. 输出严格 JSON，不要 Markdown，不要解释。\n5. 每个 body 必须填写基于报告的具体分析，禁止输出空字符串、"..."、"…"、"待补充"或其他占位文本。\n6. JSON 格式：{\"nodes\":[{\"id\":\"goal\",\"title\":\"业务目标\",\"body\":\"具体业务目标\",\"kind\":\"goal\"},{\"id\":\"symptom_1\",\"title\":\"症状/UDE 1\",\"body\":\"具体症状说明\",\"kind\":\"symptom\",\"parentId\":\"goal\"},{\"id\":\"constraint\",\"title\":\"当前主约束\",\"body\":\"具体约束说明\",\"kind\":\"constraint\",\"parentId\":\"symptom_1\"},{\"id\":\"cause_1\",\"title\":\"根因链 1\",\"body\":\"具体根因说明\",\"kind\":\"root_cause\",\"parentId\":\"constraint\"},{\"id\":\"step_1\",\"title\":\"1 识别约束\",\"body\":\"具体动作说明\",\"kind\":\"action\",\"parentId\":\"cause_1\"},{\"id\":\"step_2\",\"title\":\"2 充分利用约束\",\"body\":\"具体动作说明\",\"kind\":\"action\",\"parentId\":\"step_1\"},{\"id\":\"step_3\",\"title\":\"3 其他环节服从约束\",\"body\":\"具体动作说明\",\"kind\":\"action\",\"parentId\":\"step_2\"},{\"id\":\"step_4\",\"title\":\"4 提升约束能力\",\"body\":\"具体动作说明\",\"kind\":\"action\",\"parentId\":\"step_3\"},{\"id\":\"step_5\",\"title\":\"5 重新寻找新约束\",\"body\":\"具体动作说明\",\"kind\":\"action\",\"parentId\":\"step_4\"},{\"id\":\"monitor\",\"title\":\"监控指标\",\"body\":\"具体监控指标\",\"kind\":\"monitor\",\"parentId\":\"step_5\"}]}\n\n报告名：${reportName}\n\n报告内容：\n${sanitizeReportForLlm(content).slice(0, 30000)}`;
}

function resolveGoldenStrategyModel(value: unknown): GoldenStrategyModelDefinition {
  const id = String(value ?? "decision_tree").trim() as GoldenStrategyModelId;
  return GOLDEN_STRATEGY_MODELS[id] ?? GOLDEN_STRATEGY_MODELS.decision_tree;
}

function parseGoldenStrategyModelIds(value: unknown): GoldenStrategyModelId[] {
  if (!Array.isArray(value)) return [];
  const ids = value.map((item) => resolveGoldenStrategyModel(item).id);
  return [...new Set(ids)];
}

function validateGoldenStrategyNodes(value: unknown, definition: GoldenStrategyModelDefinition): GoldenStrategyNode[] {
  const rawNodes = typeof value === "object" && value !== null && Array.isArray((value as { nodes?: unknown }).nodes)
    ? (value as { nodes: unknown[] }).nodes
    : Array.isArray(value)
      ? value
      : [];
  if (rawNodes.length === 0) throw new Error(`${definition.label} result must contain nodes`);
  const allowed = new Set<GoldenStrategyNodeKind>(definition.allowedKinds);
  const cleaned = rawNodes.slice(0, 24).map((node, index) => {
    const source = typeof node === "object" && node !== null ? node as Record<string, unknown> : {};
    const id = typeof source.id === "string" && source.id.trim()
      ? source.id.trim().replace(/[^a-zA-Z0-9_-]/g, "_")
      : `node_${index + 1}`;
    const fallbackKind = definition.allowedKinds[0] ?? "root";
    const kind = typeof source.kind === "string" && allowed.has(source.kind as GoldenStrategyNodeKind)
      ? source.kind as GoldenStrategyNodeKind
      : fallbackKind;
    const title = typeof source.title === "string" && source.title.trim() ? source.title.trim().slice(0, 80) : id;
    if (!isMeaningfulGraphText(source.body)) throw new Error(`${definition.label} node ${id} must include meaningful body text`);
    const body = source.body.trim().slice(0, 700);
    const parentId = typeof source.parentId === "string" && source.parentId.trim()
      ? source.parentId.trim().replace(/[^a-zA-Z0-9_-]/g, "_")
      : undefined;
    return { id, title, body, kind, parentId } satisfies GoldenStrategyNode;
  });
  for (const kind of definition.requiredKinds) {
    if (!cleaned.some((node) => node.kind === kind)) throw new Error(`${definition.label} result must include ${kind}`);
  }
  const ids = new Set(cleaned.map((node) => node.id));
  return cleaned.map((node) => node.parentId && ids.has(node.parentId) ? node : { ...node, parentId: undefined });
}

function buildGoldenStrategyPrompt(definition: GoldenStrategyModelDefinition, reportName: string, reportContent: string, userPrompt: string, businessRequirementContext = ""): string {
  const focus = userPrompt.trim() ? `\n\n本次模拟分析重点：\n${userPrompt.trim()}` : "";
  const requirementContext = businessRequirementContext.trim() ? `\n\n${businessRequirementContext.trim()}` : "";
  return `你是${definition.expertRole}。请基于已生成报告进行「${definition.label}」模拟分析，并输出一张可视化图示所需的结构化节点。

分析目标：
${definition.objective}${focus}${requirementContext}

硬性要求：
1. 只输出严格 JSON，不要输出 Markdown fence 或解释文字。
2. JSON schema 示例：${definition.schemaExample}
3. kind 只能使用：${definition.allowedKinds.join("、")}。
4. 必须包含这些 kind：${definition.requiredKinds.join("、")}。
5. 节点之间用 parentId 表示推理、因果、组合或行动关系，形成可读的图示链路。
6. 节点数量控制在 8-18 个；如果报告信息不足，也要明确写出不确定性和待验证事项。
7. 每个 body 必须填写基于报告的具体分析，禁止输出空字符串、"..."、"…"、"待补充"或 schema 示例文本。
8. 不要编造报告外的数据。

报告文件：${reportName}

报告内容：
${sanitizeReportForLlm(reportContent).slice(0, 50_000)}`;
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function goldenKindClass(kind: GoldenStrategyNodeKind): string {
  if (["root", "goal", "customer_segment", "value_proposition"].includes(kind)) return "sky";
  if (["conclusion", "action", "opportunity", "star", "cash_cow", "market_penetration"].includes(kind)) return "emerald";
  if (["weakness", "threat", "constraint", "rivalry", "substitute", "new_entrant", "dog"].includes(kind)) return "rose";
  if (["factor", "evidence", "root_cause", "question_mark", "price", "cost_structure"].includes(kind)) return "amber";
  return "neutral";
}

function generateGoldenStrategyHtml(title: string, nodes: GoldenStrategyNode[]): string {
  const depthCache = new Map<string, number>();
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const depthOf = (node: GoldenStrategyNode): number => {
    const cached = depthCache.get(node.id);
    if (cached !== undefined) return cached;
    if (!node.parentId) {
      depthCache.set(node.id, 0);
      return 0;
    }
    const parent = byId.get(node.parentId);
    const depth = parent ? depthOf(parent) + 1 : 0;
    depthCache.set(node.id, depth);
    return depth;
  };
  const levels = new Map<number, GoldenStrategyNode[]>();
  nodes.forEach((node) => {
    const depth = depthOf(node);
    levels.set(depth, [...(levels.get(depth) ?? []), node]);
  });
  const positioned = nodes.map((node) => {
    const depth = depthOf(node);
    const level = levels.get(depth) ?? [];
    const index = level.findIndex((item) => item.id === node.id);
    return { node, x: 56 + depth * 310, y: 72 + index * 150 };
  });
  const width = Math.max(960, Math.max(...positioned.map((item) => item.x)) + 330);
  const height = Math.max(520, Math.max(...positioned.map((item) => item.y)) + 170);
  const positionById = new Map(positioned.map((item) => [item.node.id, item]));
  const edges = positioned
    .filter((item) => item.node.parentId)
    .map((item) => {
      const parent = positionById.get(item.node.parentId!);
      if (!parent) return "";
      const x1 = parent.x + 256;
      const y1 = parent.y + 58;
      const x2 = item.x;
      const y2 = item.y + 58;
      const mx = (x1 + x2) / 2;
      return `<path d="M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2},${y2}" fill="none" stroke="#94a3b8" stroke-width="1.5"/>`;
    })
    .join("\n      ");
  const nodeHtml = positioned.map(({ node, x, y }) => {
    const body = escapeHtml(node.body).replace(/\n/g, "<br>");
    return `<div class="node ${goldenKindClass(node.kind)}" style="left:${x}px;top:${y}px">
  <div class="node-title">${escapeHtml(node.title)}</div>
  <div class="node-kind">${escapeHtml(node.kind)}</div>
  <div class="node-body">${body}</div>
</div>`;
  }).join("\n");
  return `<!DOCTYPE html>
<html lang="zh">
<head>
<meta charset="UTF-8">
<title>${escapeHtml(title)}</title>
<style>
  body { margin: 0; padding: 24px; background: #f9fafb; color: #111827; }
  .title { font: 600 18px/1.4 -apple-system, BlinkMacSystemFont, 'PingFang SC', 'Noto Sans CJK SC', 'Helvetica Neue', Arial, sans-serif; margin: 0 0 18px; }
  .canvas { position: relative; width: ${width}px; height: ${height}px; }
  .edges { position: absolute; top: 0; left: 0; pointer-events: none; overflow: visible; }
  .node { position: absolute; width: 256px; min-height: 112px; border-radius: 10px; padding: 10px 12px; border: 1.5px solid; box-sizing: border-box; box-shadow: 0 1px 3px rgba(0,0,0,.08); font-family: -apple-system, BlinkMacSystemFont, 'PingFang SC', 'Noto Sans CJK SC', 'Helvetica Neue', Arial, sans-serif; }
  .node-title { font-size: 12px; font-weight: 700; line-height: 1.4; }
  .node-kind { margin-top: 3px; font-size: 10px; line-height: 1.2; opacity: .56; }
  .node-body { margin-top: 7px; font-size: 11px; line-height: 1.5; opacity: .82; }
  .sky { border-color: #bae6fd; background: #f0f9ff; color: #0c4a6e; }
  .emerald { border-color: #a7f3d0; background: #ecfdf5; color: #064e3b; }
  .rose { border-color: #fecaca; background: #fef2f2; color: #7f1d1d; }
  .amber { border-color: #fde68a; background: #fffbeb; color: #78350f; }
  .neutral { border-color: #e5e7eb; background: #ffffff; color: #1f2937; }
</style>
</head>
<body>
<h1 class="title">${escapeHtml(title)}</h1>
<div class="canvas">
  <svg class="edges" width="${width}" height="${height}">
      ${edges}
  </svg>
${nodeHtml}
</div>
</body>
</html>`;
}

async function generateGoldenStrategyWithLlm(
  definition: GoldenStrategyModelDefinition,
  reportName: string,
  reportContent: string,
  userPrompt: string,
  businessRequirementContext: string,
  workspaceRoot: string,
  model: string,
  usageTarget?: { workspaceId: string; targetKind: TokenUsageTargetKind; targetId: string; title: string },
): Promise<GoldenStrategyNode[]> {
  const output = await runPiPrompt({
    workspaceRoot,
    text: buildGoldenStrategyPrompt(definition, reportName, reportContent, userPrompt, businessRequirementContext),
    model,
    systemPrompt: `你是${definition.expertRole}。你只输出严格 JSON，用于前端解析。不要输出 Markdown fence。`,
    timeoutMs: 180_000,
    onEvent: (event) => trackUsageEvent(usageTarget ?? null, event),
  });
  try {
    return validateGoldenStrategyNodes(extractJsonObject(output), definition);
  } catch {
    const repaired = await repairJsonObject(
      output,
      definition.schemaExample,
      workspaceRoot,
      model,
      `分析模型：${definition.label}\n分析目标：${definition.objective}\n用户重点：${userPrompt}\n${businessRequirementContext}\n报告文件：${reportName}\n\n报告内容：\n${sanitizeReportForLlm(reportContent)}`,
      usageTarget ? {
        ...usageTarget,
        targetKind: "repair",
        targetId: `repair:${usageTarget.targetId}:golden_strategy`,
        title: `Repair 黄金策：${definition.label}：${reportName}`,
      } : undefined,
    );
    return validateGoldenStrategyNodes(repaired, definition);
  }
}

async function generateGoldenStrategyArtifact(params: {
  source: string;
  path: string;
  sessionId?: string;
  flowId?: string;
  runId?: string;
  definition: GoldenStrategyModelDefinition;
  model: string;
  prompt: string;
  businessRequirementContext: string;
}): Promise<{ analysisModel: GoldenStrategyModelId; nodes: GoldenStrategyNode[]; model: string; path: string; html: string }> {
  const { source, path, sessionId, flowId, runId, definition, model, prompt, businessRequirementContext } = params;

  if (source === "session") {
    const session = getSession(String(sessionId ?? ""));
    if (!session) throw new Error("session not found");
    const workspace = getWorkspace(session.workspaceId);
    if (!workspace) throw new Error("workspace not found");
    const target = resolveOutputTarget(listWorkspacePaths(session.workspaceId), {
      workspaceId: session.workspaceId,
      sessionId: session.id,
      fallbackOutputDir: standardDirIn(sessionDir(workspace.rootPath, session.id), "report"),
    });
    validateArtifactPath(path, target.source);
    const report = readFlowFile(target.outputDir, path).content;
    const reportName = basename(path);
    const nodes = await generateGoldenStrategyWithLlm(definition, reportName, report, prompt, businessRequirementContext, workspace.rootPath, model, {
      workspaceId: workspace.id,
      targetKind: "golden_strategy",
      targetId: `${session.id}:${definition.id}:${path}`,
      title: `黄金策：${definition.label}：${reportName}`,
    });
    const title = `黄金策 - ${definition.label} - ${reportName}`;
    const html = generateGoldenStrategyHtml(title, nodes);
    const outputRelPath = `golden_strategy/${sanitizeFilenamePart(reportName)}-${definition.id}-${timestampForFilename()}.html`;
    writeFlowFile(target.outputDir, outputRelPath, html.endsWith("\n") ? html : `${html}\n`);
    return { analysisModel: definition.id, nodes, model, path: outputRelPath, html };
  }

  if (source === "flow-run") {
    const flow = getFlow(String(flowId ?? ""));
    if (!flow) throw new Error("flow not found");
    const run = getFlowRun(String(runId ?? ""));
    if (!run || run.flowId !== flow.id) throw new Error("run not found");
    validateArtifactPath(path, "工作流 run 输出目录");
    const report = readFlowFile(run.outputDir, path).content;
    const reportName = basename(path);
    const nodes = await generateGoldenStrategyWithLlm(definition, reportName, report, prompt, businessRequirementContext, flow.folderPath, model, {
      workspaceId: flow.workspaceId,
      targetKind: "golden_strategy",
      targetId: `${run.id}:${definition.id}:${path}`,
      title: `黄金策：${definition.label}：${reportName}`,
    });
    const title = `黄金策 - ${definition.label} - ${reportName}`;
    const html = generateGoldenStrategyHtml(title, nodes);
    const outputRelPath = `golden_strategy/${sanitizeFilenamePart(reportName)}-${definition.id}-${timestampForFilename()}.html`;
    writeFlowFile(run.outputDir, outputRelPath, html.endsWith("\n") ? html : `${html}\n`);
    return { analysisModel: definition.id, nodes, model, path: outputRelPath, html };
  }

  throw new Error("source must be session or flow-run");
}

function buildPromoteTranscript(sessionId: string, scope: PromoteScope): string {
  const messages = listMessages(sessionId)
    .filter((message) => message.role === "user" || message.role === "assistant");
  const start = scope === "latest_task"
    ? Math.max(0, messages.findLastIndex((message) => message.role === "user"))
    : 0;
  const transcript = messages
    .slice(start)
    .map((message) => {
      const text = extractStoredMessageText(message.content);
      return text ? `${message.role === "user" ? "用户" : "助手"}:\n${text}` : "";
    })
    .filter(Boolean)
    .join("\n\n");
  return transcript.slice(-24_000);
}

function hasLocalAbsolutePath(value: unknown): boolean {
  if (typeof value === "string") {
    return /(^|[\s"'`(])\/(?:Users|home|tmp|private|var|Volumes)\//.test(value)
      || /(^|[\s"'`(])[a-zA-Z]:\\/.test(value);
  }
  if (Array.isArray(value)) return value.some(hasLocalAbsolutePath);
  if (typeof value === "object" && value !== null) return Object.values(value).some(hasLocalAbsolutePath);
  return false;
}

function validatePromotedWorkflow(flowRoot: string): void {
  const raw = readFlowFile(flowRoot, "workflow.json").content;
  const workflow = normalizeWorkflowModels(JSON.parse(raw) as WorkflowLike & {
    nodes?: Array<{ id?: unknown; label?: unknown; prompt?: unknown; model?: unknown }>;
    edges?: unknown;
  });
  if (!Array.isArray(workflow.nodes) || workflow.nodes.length === 0) throw new Error("workflow.json must contain at least one node");
  if (!Array.isArray(workflow.edges)) throw new Error("workflow.json edges must be an array");
  for (const node of workflow.nodes) {
    if (typeof node.id !== "string" || !node.id.trim()) throw new Error("workflow node id required");
    if (typeof node.label !== "string" || !node.label.trim()) throw new Error(`workflow node ${String(node.id)} label required`);
    if (typeof node.prompt !== "string" || !node.prompt.trim()) throw new Error(`workflow node ${String(node.id)} prompt required`);
  }
  if (hasLocalAbsolutePath(workflow)) throw new Error("workflow.json contains a local absolute path; use {{input.*}} placeholders");
  writeFlowFile(flowRoot, "workflow.json", JSON.stringify(workflow, null, 2));
}

// 从一段文本解析出合法 workflow（nodes 非空 + edges 为数组），失败返回 null。
function parseWorkflowCandidate(raw: string): WorkflowLike | null {
  let obj: unknown;
  try { obj = JSON.parse(raw); } catch { return null; }
  if (typeof obj !== "object" || obj === null) return null;
  const wf = obj as { nodes?: unknown; edges?: unknown };
  if (!Array.isArray(wf.nodes) || wf.nodes.length === 0) return null;
  if (!Array.isArray(wf.edges)) return null;
  try { return normalizeWorkflowModels(obj as WorkflowLike); } catch { return null; }
}

// 创建链路兜底：pi 可能因用户的输出目录约束把 workflow.json 写到别处、或只在对话里给出 JSON。
// 从本轮 assistant 输出捕获 workflow：① fenced 代码块 ② pi 自报的 .../workflow.json 绝对路径文件 ③ 整段裸 JSON。
function captureWorkflowFromText(text: string): WorkflowLike | null {
  if (!text || !text.trim()) return null;
  const candidates: string[] = [];
  const fence = /```(?:json|workflow|JSON)?\s*([\s\S]*?)```/g;
  let fm: RegExpExecArray | null;
  while ((fm = fence.exec(text))) { if (fm[1]) candidates.push(fm[1].trim()); }
  const pathRe = /(\/[^\s"'`)]+?workflow\.json)/g;
  let pm: RegExpExecArray | null;
  while ((pm = pathRe.exec(text))) {
    const p = pm[1];
    try { if (p && existsSync(p) && statSync(p).isFile()) candidates.push(readFileSync(p, "utf8")); } catch { /* ignore unreadable path */ }
  }
  const trimmed = text.trim();
  if (trimmed.startsWith("{")) candidates.push(trimmed);
  for (const raw of candidates) {
    const wf = parseWorkflowCandidate(raw);
    if (wf) return wf;
  }
  return null;
}

// 取 pi 消息内容里的文本部分用于捕获。
function flowMessageText(content: unknown): string {
  if (!Array.isArray(content)) return "";
  return content
    .filter((c): c is { type: string; text: string } => !!c && typeof c === "object" && (c as { type?: unknown }).type === "text" && typeof (c as { text?: unknown }).text === "string")
    .map((c) => c.text)
    .join("\n");
}

async function compileSessionWorkflow(
  flowId: string,
  sessionId: string,
  scope: PromoteScope,
  model?: string,
): Promise<void> {
  const flow = getFlow(flowId);
  const session = getSession(sessionId);
  if (!flow || !session) return;
  const transcript = buildPromoteTranscript(session.id, scope);
  const prompt = `请将下面已完成的探索任务沉淀为可重复运行的多智能体工作流。

[硬性要求]
1. 提取可复用的方法、步骤、判断规则和输出格式，不要复述本次具体结论。
2. 禁止将本次数据文件路径、报告目录或任何本机绝对路径写入工作流。
3. 输入数据路径统一使用 {{input.data_path}}，报告输出目录统一使用 {{input.report_dir}}。
4. 不得复制或读取原始数据文件；仅根据对话文本提炼流程。
5. 在当前工作目录生成 workflow.json 和 README.md。
6. workflow.json 格式：
   { "version": 1, "defaultModel": "", "nodes": [{ "id": "...", "label": "...", "prompt": "...", "model": "", "role": "...", "icon": "...", "desc": "..." }], "edges": [{ "id": "...", "source": "...", "target": "..." }] }
7. 节点之间通过 edges 串联，后续节点可以使用 {{前序节点id}} 引用前一步产出。
8. README.md 说明用途、运行参数、输出和注意事项。

[探索对话文本]
${transcript}`;
  try {
    const run = runPiTurn({
      workspaceRoot: flow.folderPath,
      piSessionId: `compiler-${flow.id}`,
      text: prompt,
      model,
      systemPrompt: "你是 workflow compiler。只根据提供的对话文本提炼可复用工作流，严格参数化输入和输出路径。直接生成 workflow.json 和 README.md，不要提问。",
      onEvent: (event: PiEvent) => {
        trackUsageEvent({
          workspaceId: flow.workspaceId,
          targetKind: "workflow_promotion",
          targetId: flow.id,
          title: `工作流沉淀：${flow.name}`,
        }, event);
        if (event.type !== "message_end") return;
        const { message } = event as Extract<PiEvent, { type: "message_end" }>;
        if (message.role !== "user") addFlowMessage(flow.id, message.role, message.content, message.usage ?? null);
      },
    });
    const code = await run.done;
    if (code !== 0) throw new Error(`workflow compiler exited with code ${String(code)}`);
    validatePromotedWorkflow(flow.folderPath);
    if (!existsSync(join(flow.folderPath, "README.md"))) {
      writeFlowFile(flow.folderPath, "README.md", `# ${flow.name}\n\n## 用途\n\n由探索对话沉淀的可复用工作流。\n\n## 运行参数\n\n- \`{{input.data_path}}\`：聚合数据输入路径\n- \`{{input.report_dir}}\`：报告输出目录\n\n## 注意事项\n\n运行前检查节点 prompt 和路径参数，不要输入原始明细数据。\n`);
    }
    updateFlowGeneration(flow.id, "ready");
    addFlowMessage(flow.id, "assistant", [{ type: "text", text: "工作流已从探索对话生成。请检查节点 prompt、输入参数和报告输出目录后再运行。" }]);
  } catch (err) {
    const message = String(err);
    updateFlowGeneration(flow.id, "failed", message);
    addFlowMessage(flow.id, "assistant", [{ type: "text", text: `工作流生成失败：${message}` }]);
  }
}

// ---- REST: models ----
app.get("/api/health", (_req, res) => {
  res.json({ ok: true });
});

app.get("/api/models", (_req, res) => {
  try {
    const settingsPath = join(homedir(), ".pi", "agent", "settings.json");
    const settings = JSON.parse(readFileSync(settingsPath, "utf8")) as {
      enabledModels?: string[];
      defaultProvider?: string;
      defaultModel?: string;
    };
    const enabled = listConfiguredModelIds();
    const defaultId =
      settings.defaultProvider && settings.defaultModel
        ? `${settings.defaultProvider}/${settings.defaultModel}`
        : null;
    const models = enabled.map((id) => {
      const slash = id.indexOf("/");
      return {
        id,
        provider: slash >= 0 ? id.slice(0, slash) : id,
        model: slash >= 0 ? id.slice(slash + 1) : id,
        isDefault: id === defaultId,
      };
    });
    res.json(models);
  } catch {
    res.json([]);
  }
});

app.post("/api/toc/generate", async (req, res) => {
  try {
    const reportName = String(req.body?.reportName ?? "report").trim() || "report";
    const content = String(req.body?.content ?? "").trim();
    if (!content) return res.status(400).json({ error: "content required" });
    const requestedModel = String(req.body?.model ?? DEFAULT_TOC_MODEL).trim() || DEFAULT_TOC_MODEL;
    const configured = listConfiguredModelIds();
    const resolvedModel = configured.length > 0 ? resolveConfiguredModelId(requestedModel, configured) : requestedModel;
    if (resolvedModel == null) return res.status(400).json({ error: `model is not enabled in pi CLI: ${requestedModel}` });
    const sessionId = String(req.body?.sessionId ?? "").trim();
    const flowId = String(req.body?.flowId ?? "").trim();
    const session = sessionId ? getSession(sessionId) : null;
    const flow = flowId ? getFlow(flowId) : null;
    const workspace = session ? getWorkspace(session.workspaceId) : flow ? getWorkspace(flow.workspaceId) : null;
    const usageTarget = workspace ? {
      workspaceId: workspace.id,
      targetKind: "toc" as const,
      targetId: session?.id ?? flow?.id ?? `toc-${Date.now()}`,
      title: `TOC: ${reportName}`,
    } : null;
    const response = await runPiPrompt({
      workspaceRoot: workspace?.rootPath ?? process.cwd(),
      model: resolvedModel || undefined,
      systemPrompt: "你是 TOC 约束理论业务诊断专家，只输出符合用户 schema 的 JSON。",
      text: buildTocPrompt(reportName, content),
      timeoutMs: 180_000,
      onEvent: (event) => trackUsageEvent(usageTarget, event),
    });
    let graph: TocGraphItem[];
    try {
      graph = validateTocGraph(extractJsonObject(response));
    } catch {
      const repaired = await repairJsonObject(response, "{\"nodes\":[{\"id\":\"goal\",\"title\":\"业务目标\",\"body\":\"根据原输出填写具体业务目标\",\"kind\":\"goal\"},{\"id\":\"constraint\",\"title\":\"当前主约束\",\"body\":\"根据原输出填写具体约束说明\",\"kind\":\"constraint\",\"parentId\":\"goal\"},{\"id\":\"monitor\",\"title\":\"监控指标\",\"body\":\"根据原输出填写具体监控指标\",\"kind\":\"monitor\",\"parentId\":\"constraint\"}]}", workspace?.rootPath ?? process.cwd(), resolvedModel || requestedModel, sanitizeReportForLlm(content), usageTarget ? { ...usageTarget, targetKind: "repair", targetId: `repair:${usageTarget.targetId}:toc`, title: `Repair TOC: ${reportName}` } : undefined);
      graph = validateTocGraph(repaired);
    }
    res.json({ nodes: graph, model: resolvedModel });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// ---- REST: skills ----
app.get("/api/workspaces/:id/skills", (req, res) => {
  const workspace = getWorkspace(String(req.params.id ?? ""));
  if (!workspace) return res.status(404).json({ error: "workspace not found" });
  res.json(listSkills(workspace.rootPath));
});

app.get("/api/flows/:id/skills", (req, res) => {
  const flow = getFlow(String(req.params.id ?? ""));
  if (!flow) return res.status(404).json({ error: "flow not found" });
  res.json(listSkills(flow.folderPath));
});

app.post("/api/workspaces/:id/skills/retrieve", (req, res) => {
  const workspace = getWorkspace(String(req.params.id ?? ""));
  if (!workspace) return res.status(404).json({ error: "workspace not found" });
  const query = typeof req.body?.query === "string" ? req.body.query.trim() : "";
  if (!query) return res.status(400).json({ error: "query is required" });
  const topK = typeof req.body?.topK === "number" ? Math.max(1, Math.min(20, req.body.topK)) : 5;
  res.json(retrieveSkills(query, workspace.rootPath, topK));
});

app.post("/api/workspaces/:id/autonomous-run", (req, res) => {
  const workspace = getWorkspace(String(req.params.id ?? ""));
  if (!workspace) return res.status(404).json({ error: "workspace not found" });
  const query = typeof req.body?.query === "string" ? req.body.query.trim() : "";
  if (!query) return res.status(400).json({ error: "query is required" });
  const model = typeof req.body?.model === "string" ? req.body.model : undefined;
  const topK = typeof req.body?.topK === "number" ? Math.max(1, Math.min(10, req.body.topK)) : 3;
  runAutonomousTask({ workspaceRoot: workspace.rootPath, workspaceId: workspace.id, query, model, topK })
    .then((result) => res.json(result))
    .catch((err: unknown) => res.status(500).json({ error: String(err) }));
});

// ---- REST: workspaces ----
app.get("/api/workspaces", (_req, res) => res.json(listWorkspaces()));
app.post("/api/workspaces", (req, res) => {
  const name = String(req.body?.name ?? "").trim();
  if (!name) return res.status(400).json({ error: "name required" });
  const ws = createWorkspace(name);
  // 数据分析 tool-use：把 ExtractionTool MCP server 注册进新工作区 .mcp.json（pi-mcp-adapter 读 cwd）
  try { ensureWorkspaceMcpConfig(ws.rootPath, ws.id); } catch { /* best-effort */ }
  res.json(ws);
});

app.patch("/api/workspaces/:id", (req, res) => {
  if (!getWorkspace(req.params.id)) return res.status(404).json({ error: "workspace not found" });
  const name = String(req.body?.name ?? "").trim();
  if (!name) return res.status(400).json({ error: "name required" });
  renameWorkspace(req.params.id, name);
  res.json({ ok: true });
});
app.delete("/api/workspaces/:id", (req, res) => {
  const workspace = getWorkspace(req.params.id);
  if (!workspace) return res.status(404).json({ error: "workspace not found" });
  if (req.query.deleteFiles === "true") {
    try { moveManagedDirToTrash(workspace.rootPath); }
    catch (err) { return res.status(500).json({ error: String(err) }); }
  }
  deleteWorkspace(req.params.id);
  res.json({ ok: true });
});

// ---- REST: sessions ----
app.get("/api/workspaces/:id/sessions", (req, res) => {
  if (!getWorkspace(req.params.id)) return res.status(404).json({ error: "workspace not found" });
  // 排除 fork 分支 session（分支是主任务的子产物，不作为独立任务呈现）。
  const branchIds = new Set(listBranchSessionIds());
  res.json(listSessions(req.params.id).filter((s) => !branchIds.has(s.id)));
});
app.post("/api/workspaces/:id/sessions", (req, res) => {
  if (!getWorkspace(req.params.id)) return res.status(404).json({ error: "workspace not found" });
  const title = String(req.body?.title ?? "新会话").trim() || "新会话";
  const workflowId = typeof req.body?.workflowId === "string" ? req.body.workflowId : null;
  res.json(createSession(req.params.id, title, workflowId));
});

app.patch("/api/sessions/:id", (req, res) => {
  if (!getSession(req.params.id)) return res.status(404).json({ error: "session not found" });
  const title = String(req.body?.title ?? "").trim();
  if (!title) return res.status(400).json({ error: "title required" });
  renameSession(req.params.id, title);
  res.json({ ok: true });
});
app.delete("/api/sessions/:id", (req, res) => {
  const session = getSession(req.params.id);
  if (!session) return res.status(404).json({ error: "session not found" });
  if (req.query.deleteFiles === "true") {
    const ws = getWorkspace(session.workspaceId);
    if (ws) {
      try { moveManagedDirToTrash(sessionDir(ws.rootPath, session.id)); }
      catch (err) { return res.status(500).json({ error: String(err) }); }
    }
  }
  deleteSession(req.params.id);
  res.json({ ok: true });
});

// ---- REST: messages (history) ----
app.get("/api/sessions/:id/messages", (req, res) => {
  if (!getSession(req.params.id)) return res.status(404).json({ error: "session not found" });
  res.json(listMessages(req.params.id));
});

app.get("/api/workspaces/:id/rules", (req, res) => {
  if (!getWorkspace(req.params.id)) return res.status(404).json({ error: "workspace not found" });
  res.json(listRuleMemories(req.params.id));
});

app.post("/api/workspaces/:id/rules", (req, res) => {
  if (!getWorkspace(req.params.id)) return res.status(404).json({ error: "workspace not found" });
  const title = String(req.body?.title ?? "").trim();
  const evidence = String(req.body?.evidence ?? "").trim();
  const source = req.body?.source === "manual" ? "manual" : "trace";
  const severity = ["low", "medium", "high"].includes(String(req.body?.severity)) ? String(req.body.severity) as "low" | "medium" | "high" : "medium";
  const scope = ["global", "chat", "workflow"].includes(String(req.body?.scope)) ? String(req.body.scope) as "global" | "chat" | "workflow" : "global";
  if (!title) return res.status(400).json({ error: "title required" });
  res.json(createRuleMemory({ workspaceId: req.params.id, title, evidence, source, severity, scope }));
});

app.patch("/api/rules/:id", (req, res) => {
  const title = String(req.body?.title ?? "").trim();
  const evidence = String(req.body?.evidence ?? "").trim();
  const severity = ["low", "medium", "high"].includes(String(req.body?.severity)) ? String(req.body.severity) as "low" | "medium" | "high" : "medium";
  const scope = ["global", "chat", "workflow"].includes(String(req.body?.scope)) ? String(req.body.scope) as "global" | "chat" | "workflow" : "global";
  if (!title) return res.status(400).json({ error: "title required" });
  updateRuleMemory({ id: req.params.id, title, evidence, severity, scope });
  res.json({ ok: true });
});

app.delete("/api/rules/:id", (_req, res) => {
  deleteRuleMemory(_req.params.id);
  res.json({ ok: true });
});

app.get("/api/workspaces/:id/rules-prompt", (req, res) => {
  if (!getWorkspace(req.params.id)) return res.status(404).json({ error: "workspace not found" });
  res.json(buildEnabledRulesPrompt(req.params.id));
});

app.get("/api/workspaces/:id/rule-conflicts", (req, res) => {
  if (!getWorkspace(req.params.id)) return res.status(404).json({ error: "workspace not found" });
  const status = req.query.status === "ignored" || req.query.status === "resolved" || req.query.status === "open" ? req.query.status : undefined;
  res.json(listRuleConflicts(req.params.id, status));
});

app.post("/api/workspaces/:id/rule-conflicts/detect", (req, res) => {
  if (!getWorkspace(req.params.id)) return res.status(404).json({ error: "workspace not found" });
  res.json(detectRuleConflicts(req.params.id));
});

app.patch("/api/rule-conflicts/:id", (req, res) => {
  const status = req.body?.status;
  if (status !== "open" && status !== "ignored" && status !== "resolved") return res.status(400).json({ error: "invalid status" });
  updateRuleConflictStatus(req.params.id, status);
  res.json({ ok: true });
});

// ---- memory write proposals ----
app.get("/api/workspaces/:id/memory/proposals", (req, res) => {
  if (!getWorkspace(req.params.id)) return res.status(404).json({ error: "workspace not found" });
  const status = req.query.status === "approved" || req.query.status === "rejected" || req.query.status === "pending"
    ? req.query.status
    : undefined;
  res.json(listMemoryProposals(req.params.id, status));
});

app.post("/api/workspaces/:id/memory/proposals/from-trace-rules", (req, res) => {
  if (!getWorkspace(req.params.id)) return res.status(404).json({ error: "workspace not found" });
  const rules = Array.isArray(req.body?.rules) ? req.body.rules : [];
  if (rules.length === 0) return res.status(400).json({ error: "rules required" });
  const proposals = rules.map((raw: unknown) => {
    const rule = raw as Partial<TraceRuleSuggestion>;
    const title = String(rule.title ?? "").trim();
    const evidence = String(rule.evidence ?? "").trim();
    const severity = rule.severity === "high" || rule.severity === "medium" || rule.severity === "low" ? rule.severity : "medium";
    const sourceEventIds = Array.isArray(rule.sourceEventIds) ? rule.sourceEventIds.filter((id): id is string => typeof id === "string") : [];
    if (!title) throw new Error("proposal title required");
    return createRuleMemoryProposal({ workspaceId: req.params.id, title, evidence, severity, scope: "global", sourceEventIds });
  });
  res.json(proposals);
});

app.post("/api/memory/proposals/:id/approve", (req, res) => {
  const proposal = getMemoryProposal(req.params.id);
  if (!proposal) return res.status(404).json({ error: "memory proposal not found" });
  try {
    res.json(approveMemoryProposal(req.params.id));
  } catch (err) {
    res.status(400).json({ error: String(err) });
  }
});

app.post("/api/memory/proposals/:id/reject", (req, res) => {
  const proposal = getMemoryProposal(req.params.id);
  if (!proposal) return res.status(404).json({ error: "memory proposal not found" });
  try {
    rejectMemoryProposal(req.params.id, String(req.body?.reason ?? "").trim());
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: String(err) });
  }
});

app.get("/api/workspaces/:id/memory/usage", (req, res) => {
  if (!getWorkspace(req.params.id)) return res.status(404).json({ error: "workspace not found" });
  res.json(listMemoryUsageStats(req.params.id));
});

app.post("/api/workspaces/:id/memory/feedback", (req, res) => {
  if (!getWorkspace(req.params.id)) return res.status(404).json({ error: "workspace not found" });
  const sourceKind = req.body?.sourceKind;
  const signal = req.body?.signal;
  if (!["businessContext", "rules", "standards", "cases", "knowledgeGraph"].includes(sourceKind)) {
    return res.status(400).json({ error: "invalid sourceKind" });
  }
  if (signal !== "positive" && signal !== "negative") {
    return res.status(400).json({ error: "signal must be positive or negative" });
  }
  res.json(recordMemoryFeedback(req.params.id, sourceKind, signal, String(req.body?.sourceId ?? "*")));
});

app.get("/api/workspaces/:id/memory/failure-attributions", (req, res) => {
  if (!getWorkspace(req.params.id)) return res.status(404).json({ error: "workspace not found" });
  const targetKind = typeof req.query.targetKind === "string" ? req.query.targetKind : undefined;
  const targetId = typeof req.query.targetId === "string" ? req.query.targetId : undefined;
  res.json(listMemoryFailureAttributions(req.params.id, targetKind, targetId));
});

app.post("/api/workspaces/:id/memory/failure-attributions", (req, res) => {
  if (!getWorkspace(req.params.id)) return res.status(404).json({ error: "workspace not found" });
  const cause = req.body?.cause;
  if (!["rule_missing", "rule_wrong", "case_misleading", "business_context_stale", "kg_wrong", "model_noncompliance"].includes(cause)) {
    return res.status(400).json({ error: "invalid cause" });
  }
  const sourceKind = req.body?.sourceKind ?? null;
  if (sourceKind !== null && !["businessContext", "rules", "standards", "cases", "knowledgeGraph"].includes(sourceKind)) {
    return res.status(400).json({ error: "invalid sourceKind" });
  }
  const targetKind = String(req.body?.targetKind ?? "").trim();
  const targetId = String(req.body?.targetId ?? "").trim();
  if (!targetKind || !targetId) return res.status(400).json({ error: "targetKind and targetId required" });
  res.json(createMemoryFailureAttribution({
    workspaceId: req.params.id,
    targetKind,
    targetId,
    cause,
    sourceKind,
    sourceId: req.body?.sourceId === undefined ? null : String(req.body.sourceId),
    note: String(req.body?.note ?? ""),
  }));
});

// ---- analysis standards (指标体系) ----

async function parseStandardInput(body: unknown): Promise<{ ok: true; value: import("./db.ts").AnalysisStandardInput } | { ok: false; error: string }> {
  const b = (body ?? {}) as Record<string, unknown>;
  const str = (v: unknown) => String(v ?? "").trim();
  const kind = b.kind === "reference_file" ? "reference_file" : "metric";
  const name = str(b.name);
  if (!name) return { ok: false, error: "name required" };
  const filePath = str(b.filePath);
  if (kind === "reference_file" && !filePath) return { ok: false, error: "filePath required for reference_file" };
  const fileHash = kind === "reference_file" && filePath ? await computeFileHash(filePath) : null;
  return {
    ok: true,
    value: {
      kind,
      name,
      category: str(b.category),
      description: str(b.description),
      formula: str(b.formula),
      caliber: str(b.caliber),
      unit: str(b.unit),
      filePath,
      fileHash,
    },
  };
}

app.get("/api/workspaces/:id/standards", (req, res) => {
  if (!getWorkspace(req.params.id)) return res.status(404).json({ error: "workspace not found" });
  res.json(listAnalysisStandards(req.params.id));
});

app.post("/api/workspaces/:id/standards", async (req, res) => {
  if (!getWorkspace(req.params.id)) return res.status(404).json({ error: "workspace not found" });
  const parsed = await parseStandardInput(req.body);
  if (!parsed.ok) return res.status(400).json({ error: parsed.error });
  res.json(createAnalysisStandard(req.params.id, parsed.value));
});

app.patch("/api/standards/:id", async (req, res) => {
  const parsed = await parseStandardInput(req.body);
  if (!parsed.ok) return res.status(400).json({ error: parsed.error });
  updateAnalysisStandard(req.params.id, parsed.value);
  res.json({ ok: true });
});

app.delete("/api/standards/:id", (req, res) => {
  deleteAnalysisStandard(req.params.id);
  res.json({ ok: true });
});

app.get("/api/workspaces/:id/standards-prompt", (req, res) => {
  if (!getWorkspace(req.params.id)) return res.status(404).json({ error: "workspace not found" });
  res.json(buildEnabledStandardsPrompt(req.params.id));
});

// ---- AnaX hypothesis library (归档飞轮) ----

const HYPOTHESIS_VERDICTS = ["confirmed", "rejected", "partial"] as const;

function parseHypothesisInput(body: unknown): { ok: true; value: import("./types.ts").HypothesisEntryInput } | { ok: false; error: string } {
  const b = (body ?? {}) as Record<string, unknown>;
  const scene = String(b.scene ?? "").trim();
  const hypothesis = String(b.hypothesis ?? "").trim();
  if (!scene) return { ok: false, error: "scene required" };
  if (!hypothesis) return { ok: false, error: "hypothesis required" };
  const verdict = HYPOTHESIS_VERDICTS.includes(b.verdict as never)
    ? (b.verdict as import("./types.ts").HypothesisVerdict)
    : "partial";
  return {
    ok: true,
    value: { scene, hypothesis, verdict, evidence: String(b.evidence ?? "").trim(), impact: String(b.impact ?? "").trim() },
  };
}

app.get("/api/workspaces/:id/hypotheses", (req, res) => {
  if (!getWorkspace(req.params.id)) return res.status(404).json({ error: "workspace not found" });
  res.json(listHypotheses(req.params.id));
});
app.post("/api/workspaces/:id/hypotheses", (req, res) => {
  if (!getWorkspace(req.params.id)) return res.status(404).json({ error: "workspace not found" });
  const parsed = parseHypothesisInput(req.body);
  if (!parsed.ok) return res.status(400).json({ error: parsed.error });
  res.json(createHypothesis(req.params.id, parsed.value, "manual"));
});
app.patch("/api/hypotheses/:id", (req, res) => {
  if (typeof req.body?.enabled !== "boolean") return res.status(400).json({ error: "enabled required" });
  updateHypothesisEnabled(req.params.id, req.body.enabled);
  res.json({ ok: true });
});
app.delete("/api/hypotheses/:id", (req, res) => {
  deleteHypothesis(req.params.id);
  res.json({ ok: true });
});

// ---- AnaX P3 change management ----

const CHANGE_PROPOSAL_STATUSES = ["proposed", "approved", "applied", "rejected"] as const;

app.get("/api/workspaces/:id/change-proposals", (req, res) => {
  if (!getWorkspace(req.params.id)) return res.status(404).json({ error: "workspace not found" });
  res.json(listChangeProposals(req.params.id));
});

app.post("/api/workspaces/:id/change-proposals", (req, res) => {
  if (!getWorkspace(req.params.id)) return res.status(404).json({ error: "workspace not found" });
  const b = (req.body ?? {}) as Record<string, unknown>;
  const title = String(b.title ?? "").trim();
  if (!title) return res.status(400).json({ error: "title required" });
  res.json(createChangeProposal(req.params.id, {
    runId: typeof b.runId === "string" ? b.runId : null,
    sourceNodeId: typeof b.sourceNodeId === "string" ? b.sourceNodeId : null,
    title,
    description: String(b.description ?? "").trim(),
    expectedImpact: String(b.expectedImpact ?? "").trim(),
  }));
});

app.patch("/api/change-proposals/:id", (req, res) => {
  const b = (req.body ?? {}) as Record<string, unknown>;
  const patch: Parameters<typeof updateChangeProposal>[1] = {};
  if (typeof b.status === "string" && CHANGE_PROPOSAL_STATUSES.includes(b.status as never))
    patch.status = b.status as import("./types.ts").ChangeProposalStatus;
  if (typeof b.appliedResult === "string") patch.appliedResult = b.appliedResult;
  if (typeof b.title === "string") patch.title = b.title.trim();
  if (typeof b.description === "string") patch.description = b.description;
  if (typeof b.expectedImpact === "string") patch.expectedImpact = b.expectedImpact;
  if (!updateChangeProposal(req.params.id, patch)) return res.status(404).json({ error: "proposal not found" });
  res.json({ ok: true });
});

app.delete("/api/change-proposals/:id", (req, res) => {
  deleteChangeProposal(req.params.id);
  res.json({ ok: true });
});

// Stale nodes: read and cascade-trigger endpoints.
app.get("/api/runs/:runId/stale-nodes", (req, res) => {
  res.json(getStaleNodes(req.params.runId));
});

// Manually mark downstream nodes stale from a given node (manual_edit cascade).
app.post("/api/runs/:runId/cascade", (req, res) => {
  const fromNodeId = String(req.body?.fromNodeId ?? "").trim();
  if (!fromNodeId) return res.status(400).json({ error: "fromNodeId required" });
  const downstream = getDownstreamNodeIds(fromNodeId);
  if (downstream.length === 0) return res.status(400).json({ error: "no downstream nodes" });
  markNodesStale(req.params.runId, downstream, "manual_edit");
  res.json({ ok: true, markedNodes: downstream });
});

// ---- AnaX gate config ----

app.get("/api/workspaces/:id/anax-gate-config", (req, res) => {
  if (!getWorkspace(req.params.id)) return res.status(404).json({ error: "workspace not found" });
  res.json(getAnaxGateConfig(req.params.id));
});

app.put("/api/workspaces/:id/anax-gate-config", (req, res) => {
  if (!getWorkspace(req.params.id)) return res.status(404).json({ error: "workspace not found" });
  const b = (req.body ?? {}) as Record<string, unknown>;
  const CONFIDENCES = ["low", "medium", "high"];
  const minConfidence = typeof b.minConfidence === "string" && CONFIDENCES.includes(b.minConfidence) ? b.minConfidence : undefined;
  const minEvidenceCount = typeof b.minEvidenceCount === "number" && b.minEvidenceCount >= 0 ? b.minEvidenceCount : undefined;
  const minDataQualityScore = typeof b.minDataQualityScore === "number" && b.minDataQualityScore >= 0 && b.minDataQualityScore <= 10 ? b.minDataQualityScore : undefined;
  res.json(upsertAnaxGateConfig(req.params.id, { minConfidence, minEvidenceCount, minDataQualityScore }));
});

// ---- business context (业务环境) ----

const BUSINESS_CONTEXT_CATEGORIES = ["org", "status", "glossary", "constraint", "history", "goal"] as const;

function parseBusinessContextInput(body: unknown): { ok: true; value: import("./db.ts").BusinessContextInput } | { ok: false; error: string } {
  const b = (body ?? {}) as Record<string, unknown>;
  const title = String(b.title ?? "").trim();
  if (!title) return { ok: false, error: "title required" };
  const category = BUSINESS_CONTEXT_CATEGORIES.includes(b.category as never)
    ? (b.category as import("./db.ts").BusinessContextInput["category"])
    : "status";
  return { ok: true, value: { category, title, content: String(b.content ?? "").trim() } };
}

app.get("/api/workspaces/:id/business-contexts", (req, res) => {
  if (!getWorkspace(req.params.id)) return res.status(404).json({ error: "workspace not found" });
  res.json(listBusinessContexts(req.params.id));
});

app.post("/api/workspaces/:id/business-contexts", (req, res) => {
  if (!getWorkspace(req.params.id)) return res.status(404).json({ error: "workspace not found" });
  const parsed = parseBusinessContextInput(req.body);
  if (!parsed.ok) return res.status(400).json({ error: parsed.error });
  res.json(createBusinessContext(req.params.id, parsed.value));
});

app.patch("/api/business-contexts/:id", (req, res) => {
  const parsed = parseBusinessContextInput(req.body);
  if (!parsed.ok) return res.status(400).json({ error: parsed.error });
  updateBusinessContext(req.params.id, parsed.value);
  res.json({ ok: true });
});

app.delete("/api/business-contexts/:id", (req, res) => {
  deleteBusinessContext(req.params.id);
  res.json({ ok: true });
});

app.get("/api/workspaces/:id/business-context-prompt", (req, res) => {
  if (!getWorkspace(req.params.id)) return res.status(404).json({ error: "workspace not found" });
  res.json(buildEnabledBusinessContextPrompt(req.params.id));
});

// ---- analysis cases (分析案例库) ----

app.get("/api/workspaces/:id/cases", (req, res) => {
  if (!getWorkspace(req.params.id)) return res.status(404).json({ error: "workspace not found" });
  res.json(listAnalysisCases(req.params.id));
});

app.post("/api/workspaces/:id/cases", (req, res) => {
  if (!getWorkspace(req.params.id)) return res.status(404).json({ error: "workspace not found" });
  const title = String(req.body?.title ?? "").trim();
  if (!title) return res.status(400).json({ error: "title required" });
  const input = {
    title,
    category: String(req.body?.category ?? "").trim(),
    scenario: String(req.body?.scenario ?? "").trim(),
    approach: String(req.body?.approach ?? "").trim(),
    conclusion: String(req.body?.conclusion ?? "").trim(),
  };
  res.json(createAnalysisCase(req.params.id, input));
});

app.patch("/api/cases/:id", (req, res) => {
  const title = String(req.body?.title ?? "").trim();
  if (!title) return res.status(400).json({ error: "title required" });
  updateAnalysisCase(req.params.id, {
    title,
    category: String(req.body?.category ?? "").trim(),
    scenario: String(req.body?.scenario ?? "").trim(),
    approach: String(req.body?.approach ?? "").trim(),
    conclusion: String(req.body?.conclusion ?? "").trim(),
  });
  res.json({ ok: true });
});

app.delete("/api/cases/:id", (req, res) => {
  deleteAnalysisCase(req.params.id);
  res.json({ ok: true });
});

app.get("/api/workspaces/:id/cases-prompt", (req, res) => {
  if (!getWorkspace(req.params.id)) return res.status(404).json({ error: "workspace not found" });
  res.json(buildEnabledCasesPrompt(req.params.id));
});

app.get("/api/sessions/:id/run-status", (req, res) => {
  if (!getSession(req.params.id)) return res.status(404).json({ error: "session not found" });
  const active = getActiveChatRun(activeSessionRuns, req.params.id);
  res.json({ running: Boolean(active), startedAt: active?.startedAt ?? null });
});

app.get("/api/sessions/:id/runtime", async (req, res) => {
  const session = getSession(req.params.id);
  if (!session) return res.status(404).json({ error: "session not found" });
  const active = getActiveChatRun(activeSessionRuns, session.id);
  if (active || activeSessionControls.has(session.id) || req.query.refresh !== "1") {
    return res.json({
      ...getSessionRuntime(session.id),
      status: active ? "running" : getSessionRuntime(session.id).status,
    });
  }
  const workspace = getWorkspace(session.workspaceId);
  if (!workspace) return res.status(404).json({ error: "workspace not found" });
  activeSessionControls.add(session.id);
  try {
    const stats = await getPiSessionStats(workspace.rootPath, session.id);
    const usage = stats.contextUsage;
    res.json(updateSessionRuntime(session.id, {
      status: "idle",
      contextTokens: usage?.tokens ?? null,
      contextWindow: usage?.contextWindow ?? null,
      contextPercent: usage?.percent ?? null,
      lastError: null,
    }));
  } catch {
    // A new session may not have a pi JSONL file yet. Keep the last known state.
    res.json(getSessionRuntime(session.id));
  } finally {
    activeSessionControls.delete(session.id);
  }
});

app.get("/api/sessions/:id/token-stats", (req, res) => {
  if (!getSession(req.params.id)) return res.status(404).json({ error: "session not found" });
  res.json(getSessionTokenStats(req.params.id) ?? { sessionId: req.params.id, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, turnCount: 0, totalCost: 0, cacheHitRate: 0, updatedAt: 0 });
});

app.get("/api/workspaces/:id/token-stats", (req, res) => {
  if (!getWorkspace(req.params.id)) return res.status(404).json({ error: "workspace not found" });
  res.json(getWorkspaceTokenStats(req.params.id));
});

app.get("/api/workspaces/:id/token-stats/today", (req, res) => {
  if (!getWorkspace(req.params.id)) return res.status(404).json({ error: "workspace not found" });
  res.json(getWorkspaceTodayTokenStats(req.params.id));
});

app.get("/api/workspaces/:id/token-stats-by-session", (req, res) => {
  if (!getWorkspace(req.params.id)) return res.status(404).json({ error: "workspace not found" });
  res.json(listWorkspaceTokenUsageStats(req.params.id));
});

app.get("/api/workspaces/:id/trace/overview", (req, res) => {
  if (!getWorkspace(req.params.id)) return res.status(404).json({ error: "workspace not found" });
  res.json(getTraceOverview(req.params.id));
});

app.get("/api/workspaces/:id/trace/recent-events", (req, res) => {
  if (!getWorkspace(req.params.id)) return res.status(404).json({ error: "workspace not found" });
  const limit = Math.min(100, Math.max(1, Number(req.query.limit ?? 30) || 30));
  res.json(listTraceRecentEvents(req.params.id, limit));
});

app.get("/api/workspaces/:id/trace/trend", (req, res) => {
  if (!getWorkspace(req.params.id)) return res.status(404).json({ error: "workspace not found" });
  const days = Math.min(60, Math.max(1, Number(req.query.days ?? 14) || 14));
  res.json(getTraceTrend(req.params.id, days));
});

app.get("/api/workspaces/:id/trace/timeline", (req, res) => {
  if (!getWorkspace(req.params.id)) return res.status(404).json({ error: "workspace not found" });
  const targetKind = String(req.query.targetKind ?? "");
  const targetId = String(req.query.targetId ?? "");
  if (!targetKind || !targetId) return res.status(400).json({ error: "targetKind and targetId required" });
  res.json(getTraceTimeline(req.params.id, targetKind, targetId));
});

app.get("/api/workspaces/:id/trace/failures", (req, res) => {
  if (!getWorkspace(req.params.id)) return res.status(404).json({ error: "workspace not found" });
  const limit = Math.min(50, Math.max(1, Number(req.query.limit ?? 10) || 10));
  res.json(listTraceFailures(req.params.id, limit));
});

app.post("/api/workspaces/:id/trace/rule-suggestions", (req, res) => {
  if (!getWorkspace(req.params.id)) return res.status(404).json({ error: "workspace not found" });
  res.json(generateTraceRuleSuggestions(req.params.id));
});

app.delete("/api/workspaces/:id/trace/events", (req, res) => {
  if (!getWorkspace(req.params.id)) return res.status(404).json({ error: "workspace not found" });
  const retainDays = Math.max(1, Number(req.query.retainDays ?? 30) || 30);
  const deleted = pruneTraceEvents(req.params.id, retainDays);
  res.json({ deleted, retainedDays: retainDays });
});

app.get("/api/workspaces/:id/memory/injections", (req, res) => {
  if (!getWorkspace(req.params.id)) return res.status(404).json({ error: "workspace not found" });
  const limit = Math.min(200, Math.max(1, Number(req.query.limit ?? 50) || 50));
  res.json(listMemoryInjectionRecords(req.params.id, limit));
});

app.post("/api/sessions/:id/compact", async (req, res) => {
  const session = getSession(req.params.id);
  if (!session) return res.status(404).json({ error: "session not found" });
  if (listMessages(session.id).length === 0) {
    return res.status(400).json({ error: "session has no context to compact" });
  }
  if (getActiveChatRun(activeSessionRuns, session.id) || activeSessionControls.has(session.id)) {
    return res.status(409).json({ error: "session is running; wait for the current turn before compacting" });
  }
  const workspace = getWorkspace(session.workspaceId);
  if (!workspace) return res.status(404).json({ error: "workspace not found" });
  activeSessionControls.add(session.id);
  updateSessionRuntime(session.id, { status: "compacting", lastError: null });
  try {
    await compactPiSession(workspace.rootPath, session.id);
    const current = getSessionRuntime(session.id);
    let contextTokens: number | null = null;
    let contextWindow = current.contextWindow;
    let contextPercent: number | null = null;
    try {
      const stats = await getPiSessionStats(workspace.rootPath, session.id);
      contextTokens = stats.contextUsage?.tokens ?? null;
      contextWindow = stats.contextUsage?.contextWindow ?? contextWindow;
      contextPercent = stats.contextUsage?.percent ?? null;
    } catch {
      // Pi reports null usage directly after compaction until the next response.
    }
    res.json({
      runtime: updateSessionRuntime(session.id, {
        status: "idle",
        contextTokens,
        contextWindow,
        contextPercent,
        compactCount: current.compactCount + 1,
        lastCompactedAt: Date.now(),
        lastError: null,
      }),
      compacted: true,
      message: "上下文整理完成",
    });
  } catch (err) {
    const message = String(err);
    if (isCompactNoop(message)) {
      return res.json({
        runtime: updateSessionRuntime(session.id, { status: "idle", lastError: null }),
        compacted: false,
        message: compactNoopMessage(message),
      });
    }
    updateSessionRuntime(session.id, { status: "error", lastError: message });
    res.status(500).json({ error: message });
  } finally {
    activeSessionControls.delete(session.id);
  }
});

function isCompactNoop(message: string): boolean {
  return message.includes("Compaction cancelled")
    || message.includes("Nothing to compact")
    || message.includes("Already compacted");
}

function compactNoopMessage(message: string): string {
  if (message.includes("Already compacted")) return "当前上下文已经整理，无需重复操作";
  if (message.includes("Nothing to compact")) return "当前上下文较短，暂无可整理的历史内容";
  return "本次整理未产生变更，请稍后重试";
}

app.get("/api/sessions/:id/artifacts/tree", (req, res) => {
  const session = getSession(req.params.id);
  if (!session) return res.status(404).json({ error: "session not found" });
  const workspace = getWorkspace(session.workspaceId);
  if (!workspace) return res.status(404).json({ error: "workspace not found" });
  const target = resolveOutputTarget(listWorkspacePaths(session.workspaceId), {
    workspaceId: session.workspaceId,
    sessionId: session.id,
    fallbackOutputDir: standardDirIn(sessionDir(workspace.rootPath, session.id), "report"),
  });
  try {
    res.json({ rootPath: target.outputDir, source: target.source, hasConfiguredReportPath: target.hasConfiguredReportPath, tree: readArtifactTree(target.outputDir) });
  } catch (err) {
    res.status(400).json({ error: String(err) });
  }
});

app.get("/api/sessions/:id/artifacts/file", (req, res) => {
  const session = getSession(req.params.id);
  if (!session) return res.status(404).json({ error: "session not found" });
  const workspace = getWorkspace(session.workspaceId);
  if (!workspace) return res.status(404).json({ error: "workspace not found" });
  const path = String(req.query.path ?? "");
  if (!path) return res.status(400).json({ error: "path required" });
  const target = resolveOutputTarget(listWorkspacePaths(session.workspaceId), {
    workspaceId: session.workspaceId,
    sessionId: session.id,
    fallbackOutputDir: standardDirIn(sessionDir(workspace.rootPath, session.id), "report"),
  });
  try {
    validateArtifactPath(path, target.source);
    const abs = safeResolve(target.outputDir, path);
    const stat = statSync(abs);
    if (!stat.isFile()) throw new Error("not a file");
    const previewable = TEXT_PREVIEW_EXTENSIONS.has(extname(abs).toLowerCase());
    if (!previewable) return res.json({ name: basename(abs), size: stat.size, previewable: false, truncated: false });
    res.json({ name: basename(abs), previewable: true, ...readFlowFile(target.outputDir, path) });
  } catch (err) {
    res.status(400).json({ error: String(err) });
  }
});

// ---- Fork 分支 & 委派子 agent（数据分析对话防上下文撑爆）----
// 心智：开子 pi session 干重活，只把结论回流主 session。回流由前端编排（给主 session 发普通消息）。

const subagentRuns = new Map<string, PiRun>();

// Fork：分支是一个真实 session（复用 messages/runtime/send），首轮 handleSend 检测到未播种→用 --fork 播种。
app.post("/api/sessions/:id/fork", (req, res) => {
  const session = getSession(req.params.id);
  if (!session) return res.status(404).json({ error: "session not found" });
  const title = String(req.body?.title ?? "").trim() || `分支：${session.title}`;
  const branch = createSession(session.workspaceId, title, session.workflowId ?? null);
  res.json(createForkBranch(session.id, branch.id, title));
});

app.get("/api/sessions/:id/fork-branches", (req, res) => {
  res.json(listForkBranches(req.params.id));
});

app.get("/api/sessions/:id/subagent-tasks", (req, res) => {
  res.json(listSubAgentTasks(req.params.id));
});

app.get("/api/subagent-tasks/:id", (req, res) => {
  const task = getSubAgentTask(req.params.id);
  if (!task) return res.status(404).json({ error: "task not found" });
  res.json(task);
});

app.post("/api/subagent-tasks/:id/abort", (req, res) => {
  const run = subagentRuns.get(req.params.id);
  if (run) run.kill();
  const task = getSubAgentTask(req.params.id);
  if (task && task.status === "running") finishSubAgentTask(task.id, { status: "aborted" });
  res.json({ ok: true });
});

app.post("/api/sessions/:id/delegate", (req, res) => {
  const session = getSession(req.params.id);
  if (!session) return res.status(404).json({ error: "session not found" });
  const workspace = getWorkspace(session.workspaceId);
  if (!workspace) return res.status(404).json({ error: "workspace not found" });
  const brief = String(req.body?.brief ?? "").trim();
  if (!brief) return res.status(400).json({ error: "brief required" });
  const dataFiles = Array.isArray(req.body?.dataFiles) ? (req.body.dataFiles as unknown[]).map(String) : [];
  const model = req.body?.model ? String(req.body.model) : undefined;
  const task = createSubAgentTask(session.id, brief, dataFiles, model);
  void runDelegatedSubAgent(task.id, session.id, workspace.rootPath, brief, dataFiles, model);
  res.json(task);
});

// 后台跑子 agent：全新聚焦 session（无主历史），读 020_clean 指定数据、写 060_reports，末条结论作摘要。
async function runDelegatedSubAgent(
  taskId: string,
  parentSessionId: string,
  workspaceRoot: string,
  brief: string,
  dataFiles: string[],
  model?: string,
): Promise<void> {
  const reportDir = standardDirIn(sessionDir(workspaceRoot, parentSessionId), "report");
  const cleanDir = standardDirIn(sessionDir(workspaceRoot, parentSessionId), "clean_data");
  mkdirSync(reportDir, { recursive: true });
  const startedAt = Date.now();
  // 仅放行落在 020_clean 内的数据文件（防越界 / 防读原始明细）。
  const allowed = dataFiles
    .map((f) => { try { return safeResolve(cleanDir, basename(f)); } catch { return ""; } })
    .filter((abs) => abs !== "" && (() => { try { return statSync(abs).isFile(); } catch { return false; } })());
  const fileList = allowed.length > 0 ? allowed.map((p) => `- ${p}`).join("\n") : "（未指定数据文件，请在报告中说明缺数据）";
  const systemPrompt = `你是数据分析子 agent，独立完成一项被委派的分析子任务，不依赖主对话历史。
[硬性约束]
1. 只允许用 read 工具读取下列指定数据文件，禁止读取其他任何数据或原始明细：
${fileList}
2. 必须把分析报告用 write 工具写入目录：${reportDir}（文件名自拟，建议 .md）。不得写到其他位置。
3. 完成后，最后一条消息用 2-4 句话给出结论摘要（供回流主对话），不要复述报告全文。
4. 不要提问，自主完成。`;
  let summaryText = "";
  try {
    const run = runPiTurn({
      workspaceRoot,
      piSessionId: `subagent-${taskId}`,
      text: brief,
      model,
      systemPrompt,
      onEvent: (event: PiEvent) => {
        if (event.type !== "message_end") return;
        const { message: m } = event as Extract<PiEvent, { type: "message_end" }>;
        if (m.role === "assistant") {
          const t = flowMessageText(m.content).trim();
          if (t) summaryText = t;
        }
      },
    });
    subagentRuns.set(taskId, run);
    const code = await run.done;
    if (getSubAgentTask(taskId)?.status === "aborted") return;
    // 取本次新产出报告（mtime ≥ 开始时间，最新者）。
    let reportPath: string | undefined;
    try {
      const newest = readdirSync(reportDir)
        .map((name) => ({ name, mt: statSync(join(reportDir, name)).mtimeMs }))
        .filter((f) => f.mt >= startedAt - 1000)
        .sort((a, b) => b.mt - a.mt)[0];
      if (newest) reportPath = newest.name;
    } catch { /* 目录读不到则无报告 */ }
    finishSubAgentTask(taskId, {
      status: code === 0 ? "success" : "failed",
      summary: summaryText || undefined,
      reportPath,
      error: code === 0 ? undefined : `pi exited with code ${String(code)}`,
    });
  } catch (err) {
    finishSubAgentTask(taskId, { status: "failed", error: String(err) });
  } finally {
    subagentRuns.delete(taskId);
  }
}

function readArtifactTree(rootPath: string): ReturnType<typeof readTree> {
  // The report fallback now points at the standard 060_reports dir, which may
  // not exist yet (legacy workspaces, or no report written). Treat missing as
  // an empty tree instead of letting readTree's statSync throw.
  if (!existsSync(rootPath)) return { name: "", path: "", kind: "dir", mtime: 0, children: [] };
  const filter = (node: ReturnType<typeof readTree>): ReturnType<typeof readTree> => ({
    ...node,
    children: node.children
      ?.filter((child) => !child.name.startsWith(".") && child.name !== "flows")
      .map((child) => filter(child)),
  });
  return filter(readTree(rootPath));
}

function withWorkspacePathStatus(path: WorkspacePath): WorkspacePath {
  try {
    const stat = statSync(path.path);
    const currentKind = stat.isDirectory() ? "dir" : stat.isFile() ? "file" : null;
    return {
      ...path,
      exists: true,
      currentKind,
      size: stat.isFile() ? stat.size : null,
      mtime: stat.mtimeMs,
      status: currentKind === path.kind ? "ok" : "kind_mismatch",
    };
  } catch {
    return {
      ...path,
      exists: false,
      currentKind: null,
      size: null,
      mtime: null,
      status: "missing",
    };
  }
}

function withWorkspacePathStatuses(paths: WorkspacePath[]): WorkspacePath[] {
  return paths.map(withWorkspacePathStatus);
}

function validateArtifactPath(path: string, source: string): void {
  const segments = path.split(/[\\/]/).filter(Boolean);
  if (segments.some((segment) => segment.startsWith("."))) throw new Error("hidden artifact paths are not accessible");
  if (source === "当前工作目录 fallback" && segments[0] === "flows") throw new Error("internal workflow paths are not accessible");
}

function sanitizeFilenamePart(value: string): string {
  const cleaned = value
    .replace(/\.[^.]+$/, "")
    .replace(/[\\/:*?"<>|]+/g, "-")
    .replace(/\s+/g, "-")
    .replace(/^-+|-+$/g, "");
  return cleaned.slice(0, 80) || "report";
}

function timestampForFilename(): string {
  return new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

function stripMarkdownFence(content: string): string {
  const trimmed = content.trim();
  const match = trimmed.match(/^```(?:markdown|md)?\s*([\s\S]*?)```$/i);
  return (match?.[1] ?? trimmed).trim();
}

function stripHtmlFence(content: string): string {
  const trimmed = content.trim();
  // Extract the contents of a ```html fence even when the model prefixes it
  // with explanatory text (the old anchored ^...$ regex failed on any prefix).
  const fenceMatch = trimmed.match(/```(?:html)?\s*\n([\s\S]*?)\n?```/i);
  if (fenceMatch?.[1]) return fenceMatch[1].trim();
  return trimmed;
}

interface BusinessRequirementInput {
  projectName: string;
  businessBackground: string;
  businessGoal: string;
  businessQuestions: string;
  decisionScenario: string;
  stakeholders: string;
  knownData: string;
  constraints: string;
  outputPreference: string;
  extraPrompt: string;
}

interface BusinessRequirementStructuredOutput {
  projectName: string;
  businessFacts: string[];
  inferredNeeds: string[];
  analysisQuestions: string[];
  metrics: Array<{ name: string; definition: string; source?: string }>;
  dimensions: string[];
  dataNeeds: Array<{ name: string; fields: string[]; purpose: string; priority: "P0" | "P1" | "P2" }>;
  analysisFramework: Array<{ businessQuestion: string; hypothesis: string; method: string; requiredData: string[]; expectedOutput: string }>;
  deliverables: string[];
  openQuestions: string[];
  risks: string[];
  sourceRefs?: Record<string, BusinessRequirementSourceRef[]>;
  sourceDocuments?: RequirementDocumentMetadata[];
  version?: BusinessRequirementVersionMetadata;
}

interface BusinessRequirementSourceRef {
  documentId: string;
  quote: string;
}

interface BusinessRequirementVersionMetadata {
  generatedAt: number;
  model: string;
  markdownPath: string;
  jsonPath: string;
  requirementInput: BusinessRequirementInput;
  markdownEditedAt?: number;
  jsonStaleReason?: string;
}

interface BusinessRequirementVersionListItem {
  id: string;
  projectName: string;
  markdownPath: string;
  jsonPath: string;
  generatedAt: number;
  model: string;
  sourceDocumentCount: number;
  markdownEditedAt: number | null;
  jsonStale: boolean;
  jsonStaleReason: string | null;
}

interface BusinessRequirementClarifyingQuestion {
  question: string;
  reason: string;
  expectedAnswer: string;
  priority: "P0" | "P1" | "P2";
}

interface BusinessRequirementDraftExtraction {
  projectName: string;
  businessBackground: string;
  businessGoal: string;
  businessQuestions: string;
  decisionScenario: string;
  stakeholders: string;
  knownData: string;
  constraints: string;
  outputPreference: string;
  extraPrompt: string;
}

type RequirementDocumentSource =
  | { source: "workspace_path"; pathId: number; relPath: string }
  | { source: "local_path"; path: string };

interface ImportedRequirementDocument {
  name: string;
  path: string;
  size: number;
  mtimeMs: number;
  content: string;
  truncated: boolean;
  source: "workspace_path" | "local_path";
  extension: string;
}

interface RequirementDocumentMetadata {
  name: string;
  path: string;
  size: number;
  mtimeMs: number;
  source: "workspace_path" | "local_path";
  extension: string;
  truncated: boolean;
}

const REQUIREMENT_DOCUMENT_EXTENSIONS = new Set([".md", ".markdown", ".txt", ".csv", ".docx", ".xlsx", ".xls"]);
const MAX_REQUIREMENT_DOCUMENTS = 8;
const MAX_REQUIREMENT_DOCUMENT_BYTES = 50 * 1024 * 1024;
const MAX_REQUIREMENT_DOCUMENT_CHARS = 80_000;
const MAX_REQUIREMENT_DOCUMENT_PREVIEW_CHARS = 6_000;

function parseBusinessRequirementInput(value: unknown): BusinessRequirementInput {
  const input = typeof value === "object" && value !== null ? value as Record<string, unknown> : {};
  const result: BusinessRequirementInput = {
    projectName: String(input.projectName ?? "").trim(),
    businessBackground: String(input.businessBackground ?? "").trim(),
    businessGoal: String(input.businessGoal ?? "").trim(),
    businessQuestions: String(input.businessQuestions ?? "").trim(),
    decisionScenario: String(input.decisionScenario ?? "").trim(),
    stakeholders: String(input.stakeholders ?? "").trim(),
    knownData: String(input.knownData ?? "").trim(),
    constraints: String(input.constraints ?? "").trim(),
    outputPreference: String(input.outputPreference ?? "").trim(),
    extraPrompt: String(input.extraPrompt ?? "").trim(),
  };
  if (!result.projectName) throw new Error("projectName required");
  return result;
}

function validateBusinessRequirementDraftExtraction(value: unknown): BusinessRequirementDraftExtraction {
  if (typeof value !== "object" || value === null) throw new Error("business requirement draft must be an object");
  const input = value as Record<string, unknown>;
  return {
    projectName: String(input.projectName ?? "").trim(),
    businessBackground: String(input.businessBackground ?? "").trim(),
    businessGoal: String(input.businessGoal ?? "").trim(),
    businessQuestions: String(input.businessQuestions ?? "").trim(),
    decisionScenario: String(input.decisionScenario ?? "").trim(),
    stakeholders: String(input.stakeholders ?? "").trim(),
    knownData: String(input.knownData ?? "").trim(),
    constraints: String(input.constraints ?? "").trim(),
    outputPreference: String(input.outputPreference ?? "").trim(),
    extraPrompt: String(input.extraPrompt ?? "").trim(),
  };
}

function parseRequirementDocumentSources(value: unknown): RequirementDocumentSource[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw new Error("documents must be an array");
  if (value.length > MAX_REQUIREMENT_DOCUMENTS) throw new Error(`documents supports at most ${MAX_REQUIREMENT_DOCUMENTS} files`);
  return value.map((item, index) => {
    if (typeof item !== "object" || item === null) throw new Error(`documents.${index} must be an object`);
    const record = item as Record<string, unknown>;
    if (record.source === "workspace_path") {
      const pathId = Number(record.pathId);
      if (!Number.isFinite(pathId)) throw new Error(`documents.${index}.pathId required`);
      return { source: "workspace_path", pathId, relPath: String(record.relPath ?? "") };
    }
    if (record.source === "local_path") {
      const path = String(record.path ?? "").trim();
      if (!path) throw new Error(`documents.${index}.path required`);
      return { source: "local_path", path };
    }
    throw new Error(`documents.${index}.source must be workspace_path or local_path`);
  });
}

function validateRequirementDocumentPath(absPath: string): void {
  const ext = extname(absPath).toLowerCase();
  if (!REQUIREMENT_DOCUMENT_EXTENSIONS.has(ext)) {
    throw new Error(`unsupported requirement document type: ${ext || "(none)"}`);
  }
  const stat = statSync(absPath);
  if (!stat.isFile()) throw new Error("requirement document must be a file");
  if (stat.size > MAX_REQUIREMENT_DOCUMENT_BYTES) {
    throw new Error(`requirement document is too large: ${stat.size} bytes, limit ${MAX_REQUIREMENT_DOCUMENT_BYTES} bytes`);
  }
}

async function extractRequirementDocumentText(absPath: string): Promise<string> {
  validateRequirementDocumentPath(absPath);
  const ext = extname(absPath).toLowerCase();
  if (ext === ".docx") {
    const result = await mammoth.extractRawText({ path: absPath });
    return result.value.trim();
  }
  if (ext === ".xlsx" || ext === ".xls") {
    const workbook = XLSX.readFile(absPath, { cellDates: true });
    return workbook.SheetNames.map((sheetName) => {
      const sheet = workbook.Sheets[sheetName];
      const csv = sheet ? XLSX.utils.sheet_to_csv(sheet, { FS: ",", RS: "\n" }).trim() : "";
      return [`# Sheet: ${sheetName}`, csv || "（空 sheet）"].join("\n");
    }).join("\n\n").trim();
  }
  return readFileSync(absPath, "utf8").trim();
}

function truncateRequirementDocumentContent(content: string): { content: string; truncated: boolean } {
  if (content.length <= MAX_REQUIREMENT_DOCUMENT_CHARS) return { content, truncated: false };
  return { content: content.slice(0, MAX_REQUIREMENT_DOCUMENT_CHARS), truncated: true };
}

async function loadRequirementDocuments(sources: RequirementDocumentSource[]): Promise<ImportedRequirementDocument[]> {
  const documents: ImportedRequirementDocument[] = [];
  for (const source of sources) {
    if (source.source === "workspace_path") {
      const entry = getWorkspacePath(source.pathId);
      if (!entry) throw new Error("requirement document path not found");
      if (entry.folder !== "clean_data" && entry.folder !== "report") {
        throw new Error("requirement documents can only be loaded from clean_data or report paths");
      }
      const root = entry.kind === "dir" ? resolve(entry.path) : dirname(resolve(entry.path));
      const relPath = entry.kind === "dir" ? source.relPath : basename(entry.path);
      if (entry.kind === "dir" && !relPath) throw new Error("relPath required for directory requirement documents");
      if (entry.kind === "file" && source.relPath) throw new Error("file requirement documents do not accept relPath");
      validateArtifactPath(relPath, "需求文档登记路径");
      const absPath = safeResolve(root, relPath);
      if (!existsSync(absPath)) throw new Error(`requirement document not found: ${relPath}`);
      const stat = statSync(absPath);
      if (!stat.isFile()) throw new Error(`requirement document must be a file: ${relPath}`);
      const extracted = truncateRequirementDocumentContent(await extractRequirementDocumentText(absPath));
      documents.push({ name: basename(absPath), path: absPath, size: stat.size, mtimeMs: stat.mtimeMs, source: "workspace_path", extension: extname(absPath).toLowerCase(), ...extracted });
      continue;
    }
    const absPath = resolve(source.path);
    if (!existsSync(absPath)) throw new Error(`requirement document not found: ${source.path}`);
    const stat = statSync(absPath);
    if (!stat.isFile()) throw new Error(`requirement document must be a file: ${source.path}`);
    const extracted = truncateRequirementDocumentContent(await extractRequirementDocumentText(absPath));
    documents.push({ name: basename(absPath), path: absPath, size: stat.size, mtimeMs: stat.mtimeMs, source: "local_path", extension: extname(absPath).toLowerCase(), ...extracted });
  }
  return documents;
}

function requirementDocumentMetadata(documents: ImportedRequirementDocument[]): RequirementDocumentMetadata[] {
  return documents.map((document) => ({
    name: document.name,
    path: document.path,
    size: document.size,
    mtimeMs: document.mtimeMs,
    source: document.source,
    extension: document.extension,
    truncated: document.truncated,
  }));
}

function formatRequirementDocumentSource(source: RequirementDocumentMetadata["source"]): string {
  return source === "workspace_path" ? "登记路径" : "本地文件";
}

function resolveBusinessRequirementOutputDir(pathId: number): { outputDir: string; workspaceId: string } {
  const entry = getWorkspacePath(pathId);
  if (!entry) throw new Error("path not found");
  if (entry.folder !== "report") throw new Error("only report output paths can store business requirements");
  return {
    outputDir: entry.kind === "dir" ? resolve(entry.path) : dirname(resolve(entry.path)),
    workspaceId: entry.workspaceId,
  };
}

function listBusinessRequirementVersions(pathId: number): BusinessRequirementVersionListItem[] {
  const { outputDir } = resolveBusinessRequirementOutputDir(pathId);
  const dir = safeResolve(outputDir, "business_requirements");
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((name) => name.endsWith(".json"))
    .map((name): BusinessRequirementVersionListItem | null => {
      const jsonPath = `business_requirements/${name}`;
      try {
        const abs = safeResolve(outputDir, jsonPath);
        const stat = statSync(abs);
        const value = JSON.parse(readFileSync(abs, "utf8")) as Partial<BusinessRequirementStructuredOutput>;
        const version = value.version;
        const markdownPath = version?.markdownPath ?? jsonPath.replace(/\.json$/, ".md");
        return {
          id: jsonPath,
          projectName: typeof value.projectName === "string" ? value.projectName : name.replace(/\.json$/, ""),
          markdownPath,
          jsonPath,
          generatedAt: typeof version?.generatedAt === "number" ? version.generatedAt : stat.mtimeMs,
          model: typeof version?.model === "string" ? version.model : "",
          sourceDocumentCount: Array.isArray(value.sourceDocuments) ? value.sourceDocuments.length : 0,
          markdownEditedAt: typeof version?.markdownEditedAt === "number" ? version.markdownEditedAt : null,
          jsonStale: typeof version?.markdownEditedAt === "number",
          jsonStaleReason: typeof version?.jsonStaleReason === "string" ? version.jsonStaleReason : null,
        };
      } catch {
        return null;
      }
    })
    .filter((item): item is BusinessRequirementVersionListItem => item !== null)
    .sort((a, b) => b.generatedAt - a.generatedAt);
}

async function previewRequirementDocuments(sources: RequirementDocumentSource[]): Promise<Array<ImportedRequirementDocument & { error?: string }>> {
  const results: Array<ImportedRequirementDocument & { error?: string }> = [];
  for (const source of sources) {
    try {
      const [document] = await loadRequirementDocuments([source]);
      if (!document) throw new Error("document not found");
      results.push({
        ...document,
        content: document.content.slice(0, MAX_REQUIREMENT_DOCUMENT_PREVIEW_CHARS),
        truncated: document.truncated || document.content.length > MAX_REQUIREMENT_DOCUMENT_PREVIEW_CHARS,
      });
    } catch (err) {
      const path = source.source === "local_path" ? source.path : `workspace_path:${source.pathId}:${source.relPath}`;
      results.push({ name: basename(path), path, size: 0, mtimeMs: 0, source: source.source, extension: extname(path).toLowerCase(), content: "", truncated: false, error: String(err) });
    }
  }
  return results;
}

function formatBusinessRequirementInput(input: BusinessRequirementInput): string {
  return [
    ["项目名称", input.projectName],
    ["业务背景", input.businessBackground],
    ["业务目标", input.businessGoal],
    ["核心业务问题", input.businessQuestions],
    ["决策场景", input.decisionScenario],
    ["使用对象", input.stakeholders],
    ["已知数据", input.knownData],
    ["限制与风险", input.constraints],
    ["输出偏好", input.outputPreference],
    ["补充要求", input.extraPrompt],
  ]
    .map(([label, content]) => `## ${label}\n${content || "未提供"}`)
    .join("\n\n");
}

function formatRequirementDocuments(documents: ImportedRequirementDocument[]): string {
  if (documents.length === 0) return "未导入需求调研文档";
  let remaining = MAX_REQUIREMENT_DOCUMENT_CHARS;
  return documents.map((document, index) => {
    const content = document.content.slice(0, Math.max(0, remaining));
    remaining -= content.length;
    return [
      `## 文档 D${index + 1}: ${document.name}`,
      `来源：${document.path}`,
      content || "（无可提取文本）",
    ].join("\n");
  }).join("\n\n");
}

function normalizeBusinessRequirementSourceRefs(value: unknown): Record<string, BusinessRequirementSourceRef[]> | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  const output: Record<string, BusinessRequirementSourceRef[]> = {};
  for (const [fieldPath, rawRefs] of Object.entries(value as Record<string, unknown>)) {
    if (!/^(businessFacts|inferredNeeds|analysisQuestions|metrics|dataNeeds|analysisFramework|deliverables|openQuestions|risks)\.\d+$/.test(fieldPath)) continue;
    if (!Array.isArray(rawRefs)) continue;
    const refs = rawRefs
      .filter((entry): entry is Record<string, unknown> => typeof entry === "object" && entry !== null)
      .map((entry) => ({
        documentId: String(entry.documentId ?? "").trim().toUpperCase(),
        quote: String(entry.quote ?? "").trim().slice(0, 240),
      }))
      .filter((entry) => /^D\d+$/.test(entry.documentId) && entry.quote.length > 0)
      .slice(0, 3);
    if (refs.length > 0) output[fieldPath] = refs;
  }
  return Object.keys(output).length > 0 ? output : undefined;
}

function filterBusinessRequirementSourceRefs(
  refs: Record<string, BusinessRequirementSourceRef[]> | undefined,
  documentCount: number,
): Record<string, BusinessRequirementSourceRef[]> | undefined {
  if (!refs || documentCount <= 0) return undefined;
  const allowed = new Set(Array.from({ length: documentCount }, (_, index) => `D${index + 1}`));
  const output: Record<string, BusinessRequirementSourceRef[]> = {};
  for (const [fieldPath, entries] of Object.entries(refs)) {
    const next = entries.filter((entry) => allowed.has(entry.documentId));
    if (next.length > 0) output[fieldPath] = next;
  }
  return Object.keys(output).length > 0 ? output : undefined;
}

function validateBusinessRequirementStructuredOutput(value: unknown, fallbackProjectName: string): BusinessRequirementStructuredOutput {
  if (typeof value !== "object" || value === null) throw new Error("business requirement result must be an object");
  const item = value as Record<string, unknown>;
  const strings = (key: string): string[] => Array.isArray(item[key])
    ? item[key].filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0).map((entry) => entry.trim())
    : [];
  const metrics = Array.isArray(item.metrics)
    ? item.metrics
      .filter((entry): entry is Record<string, unknown> => typeof entry === "object" && entry !== null)
      .map((entry) => ({
        name: String(entry.name ?? "").trim(),
        definition: String(entry.definition ?? "").trim(),
        ...(typeof entry.source === "string" && entry.source.trim() ? { source: entry.source.trim() } : {}),
      }))
      .filter((entry) => entry.name && entry.definition)
    : [];
  const dataNeeds = Array.isArray(item.dataNeeds)
    ? item.dataNeeds
      .filter((entry): entry is Record<string, unknown> => typeof entry === "object" && entry !== null)
      .map((entry) => {
        const priority: "P0" | "P1" | "P2" = entry.priority === "P0" || entry.priority === "P1" || entry.priority === "P2" ? entry.priority : "P1";
        return {
          name: String(entry.name ?? "").trim(),
          fields: Array.isArray(entry.fields) ? entry.fields.filter((field): field is string => typeof field === "string" && field.trim().length > 0).map((field) => field.trim()) : [],
          purpose: String(entry.purpose ?? "").trim(),
          priority,
        };
      })
      .filter((entry) => entry.name && entry.purpose)
    : [];
  const analysisFramework = Array.isArray(item.analysisFramework)
    ? item.analysisFramework
      .filter((entry): entry is Record<string, unknown> => typeof entry === "object" && entry !== null)
      .map((entry) => ({
        businessQuestion: String(entry.businessQuestion ?? "").trim(),
        hypothesis: String(entry.hypothesis ?? "").trim(),
        method: String(entry.method ?? "").trim(),
        requiredData: Array.isArray(entry.requiredData) ? entry.requiredData.filter((field): field is string => typeof field === "string" && field.trim().length > 0).map((field) => field.trim()) : [],
        expectedOutput: String(entry.expectedOutput ?? "").trim(),
      }))
      .filter((entry) => entry.businessQuestion && entry.method && entry.expectedOutput)
    : [];
  const sourceRefs = normalizeBusinessRequirementSourceRefs(item.sourceRefs);
  return {
    projectName: typeof item.projectName === "string" && item.projectName.trim() ? item.projectName.trim() : fallbackProjectName,
    businessFacts: strings("businessFacts"),
    inferredNeeds: strings("inferredNeeds"),
    analysisQuestions: strings("analysisQuestions"),
    metrics,
    dimensions: strings("dimensions"),
    dataNeeds,
    analysisFramework,
    deliverables: strings("deliverables"),
    openQuestions: strings("openQuestions"),
    risks: strings("risks"),
    ...(sourceRefs ? { sourceRefs } : {}),
  };
}

function renderBusinessRequirementMarkdown(result: BusinessRequirementStructuredOutput): string {
  const list = (items: string[]) => items.length ? items.map((item) => `- ${item}`).join("\n") : "- 待确认";
  const sourceDocuments = result.sourceDocuments?.length
    ? result.sourceDocuments.map((document, index) => {
      const details = [
        formatRequirementDocumentSource(document.source),
        document.extension || "未知类型",
        `${document.size} bytes`,
        document.truncated ? "内容已截断" : "",
      ].filter(Boolean).join(" · ");
      return `- [D${index + 1}] ${document.name}（${details}）\n  - 路径：${document.path}`;
    }).join("\n")
    : "- 未导入需求调研文档";
  const sourceRefs = result.sourceRefs && Object.keys(result.sourceRefs).length > 0
    ? Object.entries(result.sourceRefs).flatMap(([fieldPath, refs]) =>
      refs.map((ref) => `| ${fieldPath} | ${ref.documentId} | ${ref.quote.replace(/\|/g, "\\|")} |`),
    ).join("\n")
    : "| 待补充 | 待补充 | 待补充 |";
  const metrics = result.metrics.length
    ? result.metrics.map((item) => `| ${item.name} | ${item.definition} | ${item.source ?? "待确认"} |`).join("\n")
    : "| 待确认 | 待确认 | 待确认 |";
  const dataNeeds = result.dataNeeds.length
    ? result.dataNeeds.map((item) => `| ${item.priority} | ${item.name} | ${item.fields.join("、") || "待确认"} | ${item.purpose} |`).join("\n")
    : "| P1 | 待确认 | 待确认 | 待确认 |";
  const framework = result.analysisFramework.length
    ? result.analysisFramework.map((item) => `| ${item.businessQuestion} | ${item.hypothesis || "待确认"} | ${item.method} | ${item.requiredData.join("、") || "待确认"} | ${item.expectedOutput} |`).join("\n")
    : "| 待确认 | 待确认 | 待确认 | 待确认 | 待确认 |";
  return [
    `# ${result.projectName} 业务需求与分析框架`,
    "",
    "## 来源文档",
    sourceDocuments,
    "",
    "## 字段来源引用",
    "| 字段 | 文档 | 片段 |",
    "|---|---|---|",
    sourceRefs,
    "",
    "## 1. 业务需求整理",
    "### 已明确业务事实",
    list(result.businessFacts),
    "",
    "### 从会议纪要/文档推断出的需求",
    list(result.inferredNeeds),
    "",
    "## 2. 数据分析需求转译",
    list(result.analysisQuestions),
    "",
    "## 3. 核心指标与分析维度",
    "| 指标 | 定义 | 来源/口径 |",
    "|---|---|---|",
    metrics,
    "",
    "### 分析维度",
    list(result.dimensions),
    "",
    "## 4. 分析框架与路径",
    "| 业务问题 | 分析假设 | 验证方法 | 所需数据 | 预期输出 |",
    "|---|---|---|---|---|",
    framework,
    "",
    "## 5. 数据需求清单",
    "| 优先级 | 数据/表 | 字段/维度 | 用途 |",
    "|---|---|---|---|",
    dataNeeds,
    "",
    "## 6. 交付物建议",
    list(result.deliverables),
    "",
    "## 7. 风险、不确定性与待确认问题",
    "### 风险与不确定性",
    list(result.risks),
    "",
    "### 待确认问题",
    list(result.openQuestions),
    "",
  ].join("\n");
}

function validateBusinessRequirementClarifyingQuestions(value: unknown): BusinessRequirementClarifyingQuestion[] {
  if (typeof value !== "object" || value === null) throw new Error("clarifying questions result must be an object");
  const questions = (value as { questions?: unknown }).questions;
  if (!Array.isArray(questions) || questions.length === 0) throw new Error("clarifying questions result must contain questions");
  return questions
    .filter((entry): entry is Record<string, unknown> => typeof entry === "object" && entry !== null)
    .map((entry) => {
      const priority: "P0" | "P1" | "P2" = entry.priority === "P0" || entry.priority === "P1" || entry.priority === "P2" ? entry.priority : "P1";
      return {
        question: String(entry.question ?? "").trim(),
        reason: String(entry.reason ?? "").trim(),
        expectedAnswer: String(entry.expectedAnswer ?? "").trim(),
        priority,
      };
    })
    .filter((entry) => entry.question && entry.reason)
    .slice(0, 10);
}

function renderBusinessRequirementClarifyingQuestions(projectName: string, questions: BusinessRequirementClarifyingQuestion[]): string {
  const rows = questions.length
    ? questions.map((item) => `| ${item.priority} | ${item.question} | ${item.reason} | ${item.expectedAnswer || "业务方补充具体口径/范围/决策偏好"} |`).join("\n")
    : "| P0 | 待补充业务问题 | 当前需求信息不足 | 请补充业务目标、决策场景和可用数据 |";
  return [
    `# ${projectName} 需求澄清问题`,
    "",
    "| 优先级 | 需要追问的问题 | 为什么必须确认 | 期望业务方回答什么 |",
    "|---|---|---|---|",
    rows,
    "",
  ].join("\n");
}

async function extractBusinessRequirementDraftWithLlm(
  documents: ImportedRequirementDocument[],
  workspaceRoot: string,
  model: string,
  usageTarget?: { workspaceId: string; targetKind: TokenUsageTargetKind; targetId: string; title: string },
): Promise<BusinessRequirementDraftExtraction> {
  const prompt = `请从下面导入的需求调研文档、会议纪要或表格中，提取可直接填入“业务需求”表单的草稿字段。

[导入的需求调研文档]
${formatRequirementDocuments(documents)}

[硬性要求]
1. 只输出严格 JSON，不要输出 Markdown fence 或解释性前后缀。
2. 不要编造文档里没有的信息；不能确定的字段留空字符串。
3. 如果文档中有多个候选项目名称，选择最能代表本次分析任务的名称。
4. businessQuestions 可用换行分隔多个问题；knownData 可列出数据表、字段、指标、时间范围、文件名。
5. constraints 记录口径争议、数据缺口、时间范围、合规限制、业务假设风险。
6. JSON schema:
{
  "projectName": "项目名称",
  "businessBackground": "业务背景",
  "businessGoal": "业务目标",
  "businessQuestions": "核心业务问题",
  "decisionScenario": "决策场景",
  "stakeholders": "使用对象",
  "knownData": "已知数据",
  "constraints": "限制与风险",
  "outputPreference": "输出偏好",
  "extraPrompt": "补充要求"
}`;
  const output = await runPiPrompt({
    workspaceRoot,
    text: prompt,
    model,
    systemPrompt: "你是资深数据分析需求顾问，擅长从会议纪要和需求文档中抽取业务需求字段。你只输出严格 JSON。",
    timeoutMs: 120_000,
    onEvent: (event) => trackUsageEvent(usageTarget ?? null, event),
  });
  try {
    return validateBusinessRequirementDraftExtraction(parseJsonObject(output));
  } catch {
    const repaired = await repairJsonObject(
      output,
      "{\"projectName\":\"\",\"businessBackground\":\"\",\"businessGoal\":\"\",\"businessQuestions\":\"\",\"decisionScenario\":\"\",\"stakeholders\":\"\",\"knownData\":\"\",\"constraints\":\"\",\"outputPreference\":\"\",\"extraPrompt\":\"\"}",
      workspaceRoot,
      model,
      `导入文档：\n${formatRequirementDocuments(documents)}`,
      usageTarget ? {
        ...usageTarget,
        targetKind: "repair",
        targetId: `repair:${usageTarget.targetId}:business_requirement_extract`,
        title: "Repair 业务需求草稿提取",
      } : undefined,
    );
    return validateBusinessRequirementDraftExtraction(repaired);
  }
}

async function generateBusinessRequirementClarifyingQuestionsWithLlm(
  input: BusinessRequirementInput,
  documents: ImportedRequirementDocument[],
  workspaceRoot: string,
  model: string,
  usageTarget?: { workspaceId: string; targetKind: TokenUsageTargetKind; targetId: string; title: string },
): Promise<BusinessRequirementClarifyingQuestion[]> {
  const prompt = `请基于下面的业务沟通信息和导入文档，生成 5-10 个在正式分析框架生成前必须追问业务方的澄清问题。

[业务沟通信息]
${formatBusinessRequirementInput(input)}

[导入的需求调研文档]
${formatRequirementDocuments(documents)}

[硬性要求]
1. 只输出严格 JSON，不要输出 Markdown fence 或解释性前后缀。
2. 问题必须用于消除需求歧义、确认业务目标、分析范围、指标口径、数据可用性、决策场景和交付物期望。
3. 不要问已经明确的信息；优先追问会影响分析路径和结论有效性的关键问题。
4. priority 只能是 P0、P1、P2；P0 表示不确认就不应进入正式分析。
5. JSON schema:
{"questions":[{"priority":"P0","question":"需要追问业务方的问题","reason":"为什么必须确认","expectedAnswer":"期望业务方给出什么信息"}]}`;
  const output = await runPiPrompt({
    workspaceRoot,
    text: prompt,
    model,
    systemPrompt: "你是资深数据分析需求顾问。你只输出严格 JSON，帮助用户在分析前补齐关键业务澄清问题。",
    timeoutMs: 120_000,
    onEvent: (event) => trackUsageEvent(usageTarget ?? null, event),
  });
  try {
    return validateBusinessRequirementClarifyingQuestions(parseJsonObject(output));
  } catch {
    const repaired = await repairJsonObject(
      output,
      "{\"questions\":[{\"priority\":\"P0\",\"question\":\"需要追问业务方的问题\",\"reason\":\"为什么必须确认\",\"expectedAnswer\":\"期望业务方给出什么信息\"}]}",
      workspaceRoot,
      model,
      `业务沟通信息：\n${formatBusinessRequirementInput(input)}\n\n导入文档：\n${formatRequirementDocuments(documents)}`,
      usageTarget ? {
        ...usageTarget,
        targetKind: "repair",
        targetId: `repair:${usageTarget.targetId}:business_requirement_clarify`,
        title: `Repair 业务需求澄清：${input.projectName}`,
      } : undefined,
    );
    return validateBusinessRequirementClarifyingQuestions(repaired);
  }
}

async function generateBusinessRequirementWithLlm(
  input: BusinessRequirementInput,
  documents: ImportedRequirementDocument[],
  workspaceRoot: string,
  model: string,
  usageTarget?: { workspaceId: string; targetKind: TokenUsageTargetKind; targetId: string; title: string },
): Promise<BusinessRequirementStructuredOutput> {
  const prompt = `请基于下面的业务沟通信息，完成“业务需求 → 数据分析需求”的转译，并输出结构化 JSON。

[业务沟通信息]
${formatBusinessRequirementInput(input)}

[导入的需求调研文档]
${formatRequirementDocuments(documents)}

[硬性要求]
1. 只输出严格 JSON，不要输出 Markdown fence 或解释性前后缀。
2. 不要编造用户未提供的事实、数据或指标数值；缺失信息要写入“待确认问题”。
3. 需要把业务表达转成数据分析语言，明确分析目标、分析对象、指标、维度、数据需求、方法路径和交付物。
4. 分析框架要能指导后续数据提取、聚合计算、报告输出和黄金策二次分析。
5. 如果导入文档和手工填写内容冲突，要列入 risks，不能擅自合并成确定事实。
6. 需要区分 businessFacts、inferredNeeds、openQuestions。
7. 如果某个字段来自导入文档，必须在 sourceRefs 中按字段路径引用文档编号和短片段；字段路径格式如 businessFacts.0、metrics.0、dataNeeds.0、analysisFramework.0。
8. documentId 只能使用导入文档区显示的 D1、D2 等编号；quote 必须是原文中的短片段，不要编造。
9. JSON schema:
{
  "projectName": "${input.projectName}",
  "businessFacts": ["已明确业务事实"],
  "inferredNeeds": ["从会议纪要/文档推断出的需求"],
  "analysisQuestions": ["转译后的数据分析问题"],
  "metrics": [{"name":"指标名","definition":"指标定义/口径","source":"来源或待确认"}],
  "dimensions": ["分析维度"],
  "dataNeeds": [{"name":"数据/表/文件","fields":["字段或维度"],"purpose":"用途","priority":"P0"}],
  "analysisFramework": [{"businessQuestion":"业务问题","hypothesis":"分析假设","method":"验证方法","requiredData":["所需数据"],"expectedOutput":"预期输出"}],
  "deliverables": ["建议交付物"],
  "openQuestions": ["待确认问题"],
  "risks": ["风险或不确定性"],
  "sourceRefs": {"businessFacts.0":[{"documentId":"D1","quote":"原文短片段"}],"metrics.0":[{"documentId":"D1","quote":"原文短片段"}]}
}`;
  const output = await runPiPrompt({
    workspaceRoot,
    text: prompt,
    model,
    systemPrompt: "你是资深数据分析顾问，擅长把业务需求沟通转译为可执行的数据分析需求和分析框架。只输出严格 JSON。",
    timeoutMs: 300_000,
    onEvent: (event) => trackUsageEvent(usageTarget ?? null, event),
  });
  try {
    return validateBusinessRequirementStructuredOutput(parseJsonObject(output), input.projectName);
  } catch {
    const repaired = await repairJsonObject(
      output,
      "{\"projectName\":\"项目名称\",\"businessFacts\":[],\"inferredNeeds\":[],\"analysisQuestions\":[],\"metrics\":[{\"name\":\"指标名\",\"definition\":\"指标定义\",\"source\":\"来源\"}],\"dimensions\":[],\"dataNeeds\":[{\"name\":\"数据名\",\"fields\":[],\"purpose\":\"用途\",\"priority\":\"P0\"}],\"analysisFramework\":[{\"businessQuestion\":\"业务问题\",\"hypothesis\":\"分析假设\",\"method\":\"验证方法\",\"requiredData\":[],\"expectedOutput\":\"预期输出\"}],\"deliverables\":[],\"openQuestions\":[],\"risks\":[],\"sourceRefs\":{}}",
      workspaceRoot,
      model,
      `业务沟通信息：\n${formatBusinessRequirementInput(input)}\n\n导入文档：\n${formatRequirementDocuments(documents)}`,
      usageTarget ? {
        ...usageTarget,
        targetKind: "repair",
        targetId: `repair:${usageTarget.targetId}:business_requirement`,
        title: `Repair 业务需求：${input.projectName}`,
      } : undefined,
    );
    return validateBusinessRequirementStructuredOutput(repaired, input.projectName);
  }
}

function sanitizeStorylineHtml(content: string): string {
  return stripHtmlFence(content)
    .replace(/<script\b[\s\S]*?<\/script>/gi, "")
    .replace(/\son[a-z]+\s*=\s*(['"]).*?\1/gi, "")
    .trim();
}

interface PresentationVersionResult {
  presentationMarkdown: string;
  storylineHtml: string;
}

function validatePresentationVersionResult(value: unknown): PresentationVersionResult {
  if (typeof value !== "object" || value === null) throw new Error("presentation result must be an object");
  const item = value as Record<string, unknown>;
  const presentationMarkdown = typeof item.presentationMarkdown === "string" ? stripMarkdownFence(item.presentationMarkdown) : "";
  const storylineHtml = typeof item.storylineHtml === "string" ? sanitizeStorylineHtml(item.storylineHtml) : "";
  if (!presentationMarkdown) throw new Error("presentationMarkdown required");
  if (!storylineHtml) throw new Error("storylineHtml required");
  if (!/<html[\s>]/i.test(storylineHtml) || !/<body[\s>]/i.test(storylineHtml)) {
    throw new Error("storylineHtml must be a complete HTML document");
  }
  return { presentationMarkdown, storylineHtml };
}

async function generatePresentationVersionWithLlm(
  reportName: string,
  reportContent: string,
  userPrompt: string,
  businessRequirementContext: string,
  workspaceRoot: string,
  model: string,
  usageTarget?: { workspaceId: string; targetKind: TokenUsageTargetKind; targetId: string; title: string },
): Promise<PresentationVersionResult> {
  const requirementContext = businessRequirementContext.trim() ? `\n\n${businessRequirementContext.trim()}` : "";
  const prompt = `请基于下面的详细报告，同时生成：
1. 一份用于汇报和沟通的简化 Markdown 版本。
2. 一份极简故事线 HTML，用流程化视觉结构呈现讲解内容和顺序，帮助用户快速理清汇报思路。

[用户偏好和使用场景]
${userPrompt}${requirementContext}

[硬性要求]
1. 只输出严格 JSON，不要输出 Markdown fence 或解释文字。
2. JSON schema：{"presentationMarkdown":"...","storylineHtml":"..."}。
3. presentationMarkdown 必须是 Markdown 正文，保留关键结论、关键数据支撑、风险/不确定性和下一步建议。
4. storylineHtml 必须是完整自包含 HTML 文档，包含 <!DOCTYPE html>、html、head、body。
5. storylineHtml 禁止使用 script、外链 CSS、外链图片、远程字体或任何外部资源；只使用内联 CSS、文字、色块、箭头、卡片、时间线、简单 SVG。
6. 故事线要极简，突出讲解顺序和故事脉络，不要复刻完整报告。建议包含 5-7 个步骤：开场目标、关键问题、核心发现、证据支撑、影响判断、建议行动、决策点。
7. 删除冗长过程、内部执行细节和不适合汇报沟通的内容。
8. 如果原报告证据不足，请明确写出“不确定”或“需补充验证”。

报告文件：${reportName}

详细报告：
${sanitizeReportForLlm(reportContent).slice(0, 80_000)}`;
  const output = await runPiPrompt({
    workspaceRoot,
    text: prompt,
    model,
    systemPrompt: "你是资深数据分析汇报编辑。你的任务是把详细分析报告提炼为简洁、准确、适合沟通的 Markdown 汇报稿。",
    timeoutMs: 180_000,
    onEvent: (event) => trackUsageEvent(usageTarget ?? null, event),
  });
  try {
    return validatePresentationVersionResult(parseJsonObject(output));
  } catch {
    const repaired = await repairJsonObject(
      output,
      "{\"presentationMarkdown\":\"Markdown 汇报稿正文\",\"storylineHtml\":\"完整自包含 HTML 文档，含 <!DOCTYPE html><html><head><style>...</style></head><body>...</body></html>\"}",
      workspaceRoot,
      model,
      `用户偏好和使用场景：\n${userPrompt}\n${requirementContext}\n\n报告文件：${reportName}\n\n详细报告：\n${sanitizeReportForLlm(reportContent)}`,
      usageTarget ? {
        ...usageTarget,
        targetKind: "repair",
        targetId: `repair:${usageTarget.targetId}:report_version`,
        title: `Repair 汇报版本：${reportName}`,
      } : undefined,
    );
    return validatePresentationVersionResult(repaired);
  }
}

app.post("/api/business-requirements/generate", async (req, res) => {
  const pathId = Number(req.body?.pathId);
  if (!Number.isFinite(pathId)) return res.status(400).json({ error: "pathId required" });
  try {
    const requirement = parseBusinessRequirementInput(req.body?.requirement);
    const documents = await loadRequirementDocuments(parseRequirementDocumentSources(req.body?.documents));
    if (documents.length === 0 && !requirement.businessGoal) return res.status(400).json({ error: "businessGoal required when no documents are imported" });
    if (documents.length === 0 && !requirement.businessQuestions) return res.status(400).json({ error: "businessQuestions required when no documents are imported" });
    const entry = getWorkspacePath(pathId);
    if (!entry) return res.status(404).json({ error: "path not found" });
    if (entry.folder !== "report") return res.status(400).json({ error: "only report output paths can store business requirements" });

    const workspace = getWorkspace(entry.workspaceId);
    if (!workspace) return res.status(404).json({ error: "workspace not found" });
    const model = resolveRequestedModel(req.body?.model, DEFAULT_BUSINESS_REQUIREMENT_MODEL);
    const outputDir = entry.kind === "dir" ? resolve(entry.path) : dirname(resolve(entry.path));
    const structured = await generateBusinessRequirementWithLlm(requirement, documents, workspace.rootPath, model, {
      workspaceId: workspace.id,
      targetKind: "business_requirement",
      targetId: `${pathId}:${requirement.projectName}`,
      title: `业务需求：${requirement.projectName}`,
    });
    structured.sourceDocuments = requirementDocumentMetadata(documents);
    structured.sourceRefs = filterBusinessRequirementSourceRefs(structured.sourceRefs, structured.sourceDocuments.length);
    const timestamp = timestampForFilename();
    const outputRelPath = `business_requirements/${sanitizeFilenamePart(requirement.projectName)}-分析框架-${timestamp}.md`;
    const jsonRelPath = `business_requirements/${sanitizeFilenamePart(requirement.projectName)}-分析框架-${timestamp}.json`;
    structured.version = {
      generatedAt: Date.now(),
      model,
      markdownPath: outputRelPath,
      jsonPath: jsonRelPath,
      requirementInput: requirement,
    };
    const content = renderBusinessRequirementMarkdown(structured);
    writeFlowFile(outputDir, outputRelPath, content.endsWith("\n") ? content : `${content}\n`);
    writeFlowFile(outputDir, jsonRelPath, `${JSON.stringify(structured, null, 2)}\n`);
    res.json({ path: outputRelPath, jsonPath: jsonRelPath, content, structured, model });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

app.get("/api/business-requirements/versions", (req, res) => {
  const pathId = Number(req.query.pathId);
  if (!Number.isFinite(pathId)) return res.status(400).json({ error: "pathId required" });
  try {
    res.json({ versions: listBusinessRequirementVersions(pathId) });
  } catch (err) {
    res.status(400).json({ error: String(err) });
  }
});

app.get("/api/business-requirements/version", (req, res) => {
  const pathId = Number(req.query.pathId);
  const markdownPath = String(req.query.markdownPath ?? "");
  const jsonPath = String(req.query.jsonPath ?? "");
  if (!Number.isFinite(pathId)) return res.status(400).json({ error: "pathId required" });
  if (!markdownPath) return res.status(400).json({ error: "markdownPath required" });
  try {
    const { outputDir } = resolveBusinessRequirementOutputDir(pathId);
    validateArtifactPath(markdownPath, "业务需求版本");
    if (!markdownPath.startsWith("business_requirements/")) throw new Error("version markdown path must be under business_requirements");
    const content = readFlowFile(outputDir, markdownPath).content;
    let structured: unknown = null;
    if (jsonPath) {
      validateArtifactPath(jsonPath, "业务需求版本");
      if (!jsonPath.startsWith("business_requirements/")) throw new Error("version json path must be under business_requirements");
      structured = JSON.parse(readFlowFile(outputDir, jsonPath).content) as unknown;
    }
    res.json({ content, structured });
  } catch (err) {
    res.status(400).json({ error: String(err) });
  }
});

app.put("/api/business-requirements/version", (req, res) => {
  const pathId = Number(req.body?.pathId);
  const markdownPath = String(req.body?.markdownPath ?? "");
  const content = String(req.body?.content ?? "");
  if (!Number.isFinite(pathId)) return res.status(400).json({ error: "pathId required" });
  if (!markdownPath) return res.status(400).json({ error: "markdownPath required" });
  try {
    const { outputDir } = resolveBusinessRequirementOutputDir(pathId);
    validateArtifactPath(markdownPath, "业务需求版本");
    if (!markdownPath.startsWith("business_requirements/") || !markdownPath.endsWith(".md")) {
      throw new Error("version markdown path must be a markdown file under business_requirements");
    }
    writeFlowFile(outputDir, markdownPath, content.endsWith("\n") ? content : `${content}\n`);
    const jsonPath = markdownPath.replace(/\.md$/i, ".json");
    const jsonAbs = safeResolve(outputDir, jsonPath);
    if (jsonPath.startsWith("business_requirements/") && existsSync(jsonAbs)) {
      const structured = JSON.parse(readFileSync(jsonAbs, "utf8")) as Partial<BusinessRequirementStructuredOutput>;
      const currentVersion = typeof structured.version === "object" && structured.version !== null ? structured.version : undefined;
      structured.version = {
        generatedAt: typeof currentVersion?.generatedAt === "number" ? currentVersion.generatedAt : Date.now(),
        model: typeof currentVersion?.model === "string" ? currentVersion.model : "",
        markdownPath: typeof currentVersion?.markdownPath === "string" ? currentVersion.markdownPath : markdownPath,
        jsonPath: typeof currentVersion?.jsonPath === "string" ? currentVersion.jsonPath : jsonPath,
        requirementInput: currentVersion?.requirementInput ?? {
          projectName: typeof structured.projectName === "string" ? structured.projectName : "",
          businessBackground: "",
          businessGoal: "",
          businessQuestions: "",
          decisionScenario: "",
          stakeholders: "",
          knownData: "",
          constraints: "",
          outputPreference: "",
          extraPrompt: "",
        },
        markdownEditedAt: Date.now(),
        jsonStaleReason: "Markdown was edited manually after this structured JSON was generated.",
      };
      writeFlowFile(outputDir, jsonPath, `${JSON.stringify(structured, null, 2)}\n`);
    }
    res.json({ ok: true, path: markdownPath });
  } catch (err) {
    res.status(400).json({ error: String(err) });
  }
});

function loadBusinessRequirementContextForChat(ref: unknown): string {
  if (typeof ref !== "object" || ref === null) return "";
  const record = ref as Record<string, unknown>;
  const pathId = Number(record.pathId);
  const markdownPath = String(record.markdownPath ?? "");
  if (!Number.isFinite(pathId) || !markdownPath) return "";
  const { outputDir } = resolveBusinessRequirementOutputDir(pathId);
  validateArtifactPath(markdownPath, "业务需求上下文");
  if (!markdownPath.startsWith("business_requirements/") || !markdownPath.endsWith(".md")) {
    throw new Error("business requirement context must be a markdown file under business_requirements");
  }
  const content = readFlowFile(outputDir, markdownPath).content.trim();
  if (!content) return "";
  return [
    "[业务需求上下文]",
    "下面是用户选择的业务需求与分析框架。后续任务应优先围绕该需求目标、指标口径、数据需求、风险和待确认问题展开；不要把待确认问题当成已确认事实。",
    content.slice(0, 40_000),
    "[/业务需求上下文]",
    "",
  ].join("\n");
}

app.post("/api/business-requirements/documents/preview", async (req, res) => {
  try {
    const documents = await previewRequirementDocuments(parseRequirementDocumentSources(req.body?.documents));
    res.json({ documents });
  } catch (err) {
    res.status(400).json({ error: String(err) });
  }
});

app.post("/api/business-requirements/extract", async (req, res) => {
  try {
    const pathId = Number(req.body?.pathId);
    if (!Number.isFinite(pathId)) return res.status(400).json({ error: "pathId required" });
    const { workspaceId } = resolveBusinessRequirementOutputDir(pathId);
    const workspace = getWorkspace(workspaceId);
    if (!workspace) return res.status(404).json({ error: "workspace not found" });
    const documents = await loadRequirementDocuments(parseRequirementDocumentSources(req.body?.documents));
    if (documents.length === 0) return res.status(400).json({ error: "documents required" });
    const model = String(req.body?.model || DEFAULT_BUSINESS_REQUIREMENT_MODEL);
    const draft = await extractBusinessRequirementDraftWithLlm(documents, workspace.rootPath, model, {
      workspaceId: workspace.id,
      targetKind: "business_requirement",
      targetId: `business_requirement_extract:${Date.now()}`,
      title: "业务需求草稿提取",
    });
    res.json({ draft, model });
  } catch (err) {
    res.status(400).json({ error: String(err) });
  }
});

app.post("/api/business-requirements/clarify", async (req, res) => {
  try {
    const requirement = parseBusinessRequirementInput(req.body?.requirement);
    const documents = await loadRequirementDocuments(parseRequirementDocumentSources(req.body?.documents));
    if (
      documents.length === 0
      && !requirement.businessBackground
      && !requirement.businessGoal
      && !requirement.businessQuestions
    ) {
      return res.status(400).json({ error: "business context, goal, questions or documents required" });
    }
    const workspacePathId = Number(req.body?.pathId);
    const workspace = Number.isFinite(workspacePathId)
      ? (() => {
        const entry = getWorkspacePath(workspacePathId);
        return entry ? getWorkspace(entry.workspaceId) : undefined;
      })()
      : listWorkspaces()[0];
    if (!workspace) return res.status(404).json({ error: "workspace not found" });
    const model = resolveRequestedModel(req.body?.model, DEFAULT_BUSINESS_REQUIREMENT_MODEL);
    const questions = await generateBusinessRequirementClarifyingQuestionsWithLlm(requirement, documents, workspace.rootPath, model, {
      workspaceId: workspace.id,
      targetKind: "business_requirement",
      targetId: `clarify:${requirement.projectName}:${Date.now()}`,
      title: `业务需求澄清：${requirement.projectName}`,
    });
    res.json({ content: renderBusinessRequirementClarifyingQuestions(requirement.projectName, questions), questions, model });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

app.post("/api/report-versions/generate", async (req, res) => {
  const pathId = Number(req.body?.pathId);
  const relPath = String(req.body?.relPath ?? "");
  const userPrompt = String(req.body?.prompt ?? "").trim();
  if (!Number.isFinite(pathId)) return res.status(400).json({ error: "pathId required" });
  if (!userPrompt) return res.status(400).json({ error: "prompt required" });
  try {
    const entry = getWorkspacePath(pathId);
    if (!entry) return res.status(404).json({ error: "path not found" });
    if (entry.folder !== "report") return res.status(400).json({ error: "only report output paths can generate presentation versions" });

    const workspace = getWorkspace(entry.workspaceId);
    if (!workspace) return res.status(404).json({ error: "workspace not found" });
    const model = resolveRequestedModel(req.body?.model, DEFAULT_PRESENTATION_VERSION_MODEL);
    const outputDir = entry.kind === "dir" ? resolve(entry.path) : dirname(resolve(entry.path));
    const sourceRelPath = entry.kind === "dir" ? relPath : basename(entry.path);
    if (entry.kind === "dir" && !sourceRelPath) return res.status(400).json({ error: "relPath required for directory report paths" });
    if (entry.kind === "file" && relPath) return res.status(400).json({ error: "file report paths do not accept relPath" });
    validateArtifactPath(sourceRelPath, "报告 tab 登记路径");
    const report = readFlowFile(outputDir, sourceRelPath);
    const sourceName = sourceRelPath ? basename(sourceRelPath) : basename(entry.path);
    if (!TEXT_PREVIEW_EXTENSIONS.has(extname(sourceName).toLowerCase())) {
      return res.status(400).json({ error: "selected report is not a text or markdown file" });
    }
    const businessRequirementContext = loadBusinessRequirementContextForChat(req.body?.businessRequirementContext);
    const result = await generatePresentationVersionWithLlm(sourceName, report.content, userPrompt, businessRequirementContext, workspace.rootPath, model, {
      workspaceId: workspace.id,
      targetKind: "report_version",
      targetId: `${pathId}:${sourceRelPath}`,
      title: `汇报版本：${sourceName}`,
    });
    const timestamp = timestampForFilename();
    const outputRelPath = `presentation_versions/${sanitizeFilenamePart(sourceName)}-汇报版本-${timestamp}.md`;
    const storylineRelPath = `presentation_versions/${sanitizeFilenamePart(sourceName)}-故事线-${timestamp}.html`;
    writeFlowFile(outputDir, outputRelPath, result.presentationMarkdown.endsWith("\n") ? result.presentationMarkdown : `${result.presentationMarkdown}\n`);
    writeFlowFile(outputDir, storylineRelPath, result.storylineHtml.endsWith("\n") ? result.storylineHtml : `${result.storylineHtml}\n`);
    res.json({
      path: outputRelPath,
      content: result.presentationMarkdown,
      storylinePath: storylineRelPath,
      storylineHtml: result.storylineHtml,
      model,
    });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

app.post("/api/html-reports/generate", async (req, res) => {
  const pathId = Number(req.body?.pathId);
  const relPath = String(req.body?.relPath ?? "");

  if (!Number.isFinite(pathId)) return res.status(400).json({ error: "pathId required" });

  try {
    const entry = getWorkspacePath(pathId);
    if (!entry) return res.status(404).json({ error: "path not found" });
    if (entry.folder !== "report") return res.status(400).json({ error: "only report output paths can generate html reports" });

    const outputDir = entry.kind === "dir" ? resolve(entry.path) : dirname(resolve(entry.path));
    const sourceRelPath = entry.kind === "dir" ? relPath : basename(entry.path);
    if (entry.kind === "dir" && !sourceRelPath) return res.status(400).json({ error: "relPath required for directory report paths" });
    if (entry.kind === "file" && relPath) return res.status(400).json({ error: "file report paths do not accept relPath" });
    validateArtifactPath(sourceRelPath, "报告 tab 登记路径");

    const report = readFlowFile(outputDir, sourceRelPath);
    const sourceName = sourceRelPath ? basename(sourceRelPath) : basename(entry.path);

    if (!TEXT_PREVIEW_EXTENSIONS.has(extname(sourceName).toLowerCase())) {
      return res.status(400).json({ error: "selected report is not a text or markdown file" });
    }

    // Deterministic Markdown -> HTML rendering (no LLM): instant and 100% reliable.
    const htmlContent = renderMarkdownReportToHtml(sourceName, report.content);

    const timestamp = timestampForFilename();
    const cleanName = sanitizeFilenamePart(sourceName.replace(/\.(md|markdown|txt)$/i, ""));
    const outputRelPath = `high_quality_reports/${cleanName}-高质量报告-${timestamp}.html`;

    writeFlowFile(outputDir, outputRelPath, htmlContent.endsWith("\n") ? htmlContent : `${htmlContent}\n`);

    res.json({
      path: outputRelPath,
      absPath: resolve(outputDir, outputRelPath),
      content: htmlContent,
    });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

app.post("/api/report-review/review", async (req, res) => {
  const pathId = Number(req.body?.pathId);
  const relPath = String(req.body?.relPath ?? "");
  const userPrompt = String(req.body?.prompt ?? "").trim();
  if (!Number.isFinite(pathId)) return res.status(400).json({ error: "pathId required" });
  try {
    const entry = getWorkspacePath(pathId);
    if (!entry) return res.status(404).json({ error: "path not found" });
    if (entry.folder !== "report") return res.status(400).json({ error: "only report output paths can be reviewed" });

    const workspace = getWorkspace(entry.workspaceId);
    if (!workspace) return res.status(404).json({ error: "workspace not found" });
    const model = resolveRequestedModel(req.body?.model, DEFAULT_PRESENTATION_VERSION_MODEL);
    const outputDir = entry.kind === "dir" ? resolve(entry.path) : dirname(resolve(entry.path));
    const sourceRelPath = entry.kind === "dir" ? relPath : basename(entry.path);
    if (entry.kind === "dir" && !sourceRelPath) return res.status(400).json({ error: "relPath required for directory report paths" });
    if (entry.kind === "file" && relPath) return res.status(400).json({ error: "file report paths do not accept relPath" });
    validateArtifactPath(sourceRelPath, "报告 tab 登记路径");
    const report = readFlowFile(outputDir, sourceRelPath);
    const sourceName = sourceRelPath ? basename(sourceRelPath) : basename(entry.path);
    if (!TEXT_PREVIEW_EXTENSIONS.has(extname(sourceName).toLowerCase())) {
      return res.status(400).json({ error: "selected report is not a text file" });
    }

    const prompt = buildReviewPrompt(sanitizeReportForLlm(report.content), userPrompt || DEFAULT_REVIEW_PROMPT);
    const rawOutput = await runPiPrompt({
      workspaceRoot: workspace.rootPath,
      text: prompt,
      model,
      systemPrompt: "你是资深数据分析报告评审专家。请基于评审标准对报告进行结构化评审，输出严格 JSON 格式的评审结果。所有评审内容必须使用简体中文，仅代码、数字、JSON 字段名和技术缩写保留英文。",
      timeoutMs: 180_000,
      onEvent: (event) => trackUsageEvent({
        workspaceId: workspace.id,
        targetKind: "report_version",
        targetId: `${pathId}:${sourceRelPath}`,
        title: `报告评审：${sourceName}`,
      }, event),
    });

    let reviewMarkdown = rawOutput;
    let annotations: ReviewAnnotation[] = [];
    let totalScore = 0;
    try {
      const parsed = extractJsonObject(rawOutput) as Record<string, unknown>;
      if (typeof parsed.reviewMarkdown === "string") reviewMarkdown = parsed.reviewMarkdown;
      if (Array.isArray(parsed.annotations)) {
        annotations = parsed.annotations.filter((a: unknown) =>
          typeof a === "object" && a !== null &&
          typeof (a as Record<string, unknown>).quote === "string" &&
          typeof (a as Record<string, unknown>).issue === "string" &&
          typeof (a as Record<string, unknown>).suggestion === "string"
        ).map((a: unknown) => {
          const item = a as Record<string, unknown>;
          return {
            quote: String(item.quote),
            issue: String(item.issue),
            suggestion: String(item.suggestion),
            severity: (item.severity === "P0" || item.severity === "P1" || item.severity === "P2") ? item.severity as "P0" | "P1" | "P2" : "P1",
          };
        });
      }
      if (typeof parsed.totalScore === "number") totalScore = parsed.totalScore;
    } catch {
      totalScore = parseReviewScore(reviewMarkdown);
    }

    const historyEntry: ReviewHistoryEntry = {
      id: randomUUID(),
      reportName: sourceName,
      reviewedAt: Date.now(),
      model,
      totalScore,
      pathId,
      relPath: sourceRelPath,
      reviewMarkdown,
      annotations,
    };
    const historyRelPath = `review_history/${sanitizeFilenamePart(sourceName)}-审核-${timestampForFilename()}.json`;
    writeFlowFile(outputDir, historyRelPath, `${JSON.stringify(historyEntry, null, 2)}\n`);

    res.json({ content: reviewMarkdown, annotations, totalScore, model, reportContent: report.content });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

app.post("/api/report-review/auto-fix", async (req, res) => {
  const pathId = Number(req.body?.pathId);
  const relPath = String(req.body?.relPath ?? "");
  const reviewContent = String(req.body?.reviewContent ?? "");
  const userPrompt = String(req.body?.prompt ?? "").trim();
  if (!Number.isFinite(pathId)) return res.status(400).json({ error: "pathId required" });
  if (!reviewContent) return res.status(400).json({ error: "reviewContent required" });
  try {
    const entry = getWorkspacePath(pathId);
    if (!entry) return res.status(404).json({ error: "path not found" });
    if (entry.folder !== "report") return res.status(400).json({ error: "only report output paths can be auto-fixed" });

    const workspace = getWorkspace(entry.workspaceId);
    if (!workspace) return res.status(404).json({ error: "workspace not found" });
    const model = resolveRequestedModel(req.body?.model, DEFAULT_PRESENTATION_VERSION_MODEL);
    const outputDir = entry.kind === "dir" ? resolve(entry.path) : dirname(resolve(entry.path));
    const sourceRelPath = entry.kind === "dir" ? relPath : basename(entry.path);
    if (entry.kind === "dir" && !sourceRelPath) return res.status(400).json({ error: "relPath required for directory report paths" });
    if (entry.kind === "file" && relPath) return res.status(400).json({ error: "file report paths do not accept relPath" });
    validateArtifactPath(sourceRelPath, "报告 tab 登记路径");
    const report = readFlowFile(outputDir, sourceRelPath);
    const sourceName = sourceRelPath ? basename(sourceRelPath) : basename(entry.path);
    const ext = extname(sourceName).toLowerCase();
    if (!TEXT_PREVIEW_EXTENSIONS.has(ext) && ext !== ".docx" && ext !== ".xlsx") {
      return res.status(400).json({ error: `unsupported file format: ${ext}` });
    }

    const formatLabel = ext === ".md" || ext === ".markdown" ? "Markdown" : ext === ".html" ? "HTML" : ext === ".docx" ? "Word (docx)" : ext === ".xlsx" ? "Excel (xlsx)" : "纯文本";
    const fixPrompt = buildAutoFixPrompt(sanitizeReportForLlm(report.content), reviewContent, formatLabel);
    const fixedContent = await runPiPrompt({
      workspaceRoot: workspace.rootPath,
      text: fixPrompt,
      model,
      systemPrompt: AUTO_FIX_SYSTEM_PROMPT,
      timeoutMs: 300_000,
      onEvent: (event) => trackUsageEvent({
        workspaceId: workspace.id,
        targetKind: "report_version",
        targetId: `fix:${pathId}:${sourceRelPath}`,
        title: `报告自动修改：${sourceName}`,
      }, event),
    });

    const timestamp = timestampForFilename();
    const cleanName = sanitizeFilenamePart(sourceName.replace(/\.[^.]+$/, ""));
    const outputRelPath = `reviewed_versions/${cleanName}-审核修改-${timestamp}${ext}`;
    writeFlowFile(outputDir, outputRelPath, fixedContent.endsWith("\n") ? fixedContent : `${fixedContent}\n`);

    res.json({ path: outputRelPath, content: fixedContent, model });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

app.get("/api/report-review/history", (req, res) => {
  const pathId = Number(req.query.pathId);
  const relPath = String(req.query.relPath ?? "");
  if (!Number.isFinite(pathId)) return res.status(400).json({ error: "pathId required" });
  try {
    const entry = getWorkspacePath(pathId);
    if (!entry) return res.status(404).json({ error: "path not found" });
    if (entry.folder !== "report") return res.status(400).json({ error: "only report output paths have review history" });
    const outputDir = entry.kind === "dir" ? resolve(entry.path) : dirname(resolve(entry.path));
    const historyDir = safeResolve(outputDir, "review_history");
    const entries: ReviewHistoryEntry[] = [];
    if (existsSync(historyDir)) {
      for (const name of readdirSync(historyDir)) {
        if (!name.endsWith(".json")) continue;
        try {
          const raw = readFileSync(join(historyDir, name), "utf8");
          const entry = JSON.parse(raw) as ReviewHistoryEntry;
          if (relPath && entry.relPath !== relPath) continue;
          entries.push(entry);
        } catch { /* skip corrupted files */ }
      }
    }
    entries.sort((a, b) => b.reviewedAt - a.reviewedAt);
    res.json({ entries });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

function resolveRequestedModel(model: unknown, fallback: string): string {
  const requested = typeof model === "string" && model.trim() ? model.trim() : fallback;
  const configured = listConfiguredModelIds();
  if (configured.length === 0) return requested;
  const resolved = resolveConfiguredModelId(requested, configured);
  if (resolved == null) throw new Error(`model is not enabled in pi CLI: ${requested}. Allowed models: ${configured.join(", ")}`);
  return resolved || fallback;
}

function parseJsonObject(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
  const raw = (fenced ?? text).trim();
  try {
    return JSON.parse(raw);
  } catch {
    const start = raw.indexOf("{");
    const end = raw.lastIndexOf("}");
    if (start >= 0 && end > start) return JSON.parse(raw.slice(start, end + 1));
    throw new Error("LLM response is not valid JSON");
  }
}

function validateDecisionTreeResult(value: unknown): DecisionTreeNode[] {
  if (typeof value !== "object" || value === null) throw new Error("decision tree result must be an object");
  const nodes = (value as { nodes?: unknown }).nodes;
  if (!Array.isArray(nodes) || nodes.length === 0) throw new Error("decision tree result must contain nodes");
  const ids = new Set<string>();
  const validKinds = new Set(["root", "factor", "evidence", "conclusion"]);
  const result = nodes.map((node, index) => {
    if (typeof node !== "object" || node === null) throw new Error(`node ${index} must be an object`);
    const item = node as Record<string, unknown>;
    const id = typeof item.id === "string" && item.id.trim() ? item.id.trim() : `node-${index + 1}`;
    const title = typeof item.title === "string" && item.title.trim() ? item.title.trim() : id;
    if (!isMeaningfulGraphText(item.body)) throw new Error(`decision tree node ${id} must include meaningful body text`);
    const body = item.body.trim();
    const kind = typeof item.kind === "string" && validKinds.has(item.kind) ? item.kind as DecisionTreeNode["kind"] : "factor";
    const parentId = typeof item.parentId === "string" && item.parentId.trim() ? item.parentId.trim() : undefined;
    ids.add(id);
    return { id, title, body, kind, parentId };
  });
  if (!result.some((node) => node.kind === "root")) throw new Error("decision tree result must include a root node");
  if (!result.some((node) => node.kind === "conclusion")) throw new Error("decision tree result must include a conclusion node");
  return result.map((node) => node.parentId && ids.has(node.parentId) ? node : { ...node, parentId: undefined });
}

async function generateDecisionTreeWithLlm(
  reportName: string,
  reportContent: string,
  workspaceRoot: string,
  model: string,
  usageTarget?: { workspaceId: string; targetKind: TokenUsageTargetKind; targetId: string; title: string },
): Promise<DecisionTreeNode[]> {
  const prompt = `你是一个决策推理分析师。请基于下面报告内容，拆解决策推理因子、证据依据和最终决策结论建议，并用决策树节点结构输出。

硬性要求：
1. 只输出 JSON，不要输出 Markdown 或解释。
2. JSON 格式必须为：{"nodes":[{"id":"root","title":"报告输入","body":"具体报告摘要","kind":"root"},{"id":"factor-1","title":"推理因子 1","body":"具体推理因子","kind":"factor","parentId":"root"},{"id":"evidence-1-1","title":"依据 1","body":"具体证据依据","kind":"evidence","parentId":"factor-1"},{"id":"conclusion","title":"决策结论建议","body":"具体决策建议","kind":"conclusion","parentId":"factor-1"}]}
3. kind 只能是 root、factor、evidence、conclusion。
4. 必须体现从报告输入→推理因子→证据依据→结论建议的推导链路。
5. 不要编造报告外的数据；如果报告依据不足，要在对应节点说明不确定性。
6. 节点数量控制在 8-16 个。
7. 每个 body 必须填写基于报告的具体分析，禁止输出空字符串、"..."、"…"、"待补充"或其他占位文本。

报告文件：${reportName}

报告内容：
${sanitizeReportForLlm(reportContent).slice(0, 40_000)}`;
  const output = await runPiPrompt({
    workspaceRoot,
    text: prompt,
    model,
    systemPrompt: "你只输出严格 JSON，用于前端解析。不要输出 Markdown fence。",
    timeoutMs: 180_000,
    onEvent: (event) => trackUsageEvent(usageTarget ?? null, event),
  });
  let nodes: DecisionTreeNode[];
  try {
    nodes = validateDecisionTreeResult(parseJsonObject(output));
  } catch {
    const repaired = await repairJsonObject(output, "{\"nodes\":[{\"id\":\"root\",\"title\":\"报告输入\",\"body\":\"根据原输出填写具体报告摘要\",\"kind\":\"root\"},{\"id\":\"factor-1\",\"title\":\"推理因子 1\",\"body\":\"根据原输出填写具体推理因子\",\"kind\":\"factor\",\"parentId\":\"root\"},{\"id\":\"evidence-1-1\",\"title\":\"依据 1\",\"body\":\"根据原输出填写具体证据依据\",\"kind\":\"evidence\",\"parentId\":\"factor-1\"},{\"id\":\"conclusion\",\"title\":\"决策结论建议\",\"body\":\"根据原输出填写具体决策建议\",\"kind\":\"conclusion\",\"parentId\":\"factor-1\"}]}", workspaceRoot, model, sanitizeReportForLlm(reportContent), usageTarget ? { ...usageTarget, targetKind: "repair", targetId: `repair:${usageTarget.targetId}:decision_tree`, title: `Repair 决策树：${reportName}` } : undefined);
    nodes = validateDecisionTreeResult(repaired);
  }
  return nodes;
}

app.post("/api/decision-tree/generate", async (req, res) => {
  const source = String(req.body?.source ?? "");
  const path = String(req.body?.path ?? "");
  if (!path) return res.status(400).json({ error: "path required" });
  try {
    const model = resolveRequestedModel(req.body?.model, DEFAULT_DECISION_TREE_MODEL);
    if (source === "session") {
      const session = getSession(String(req.body?.sessionId ?? ""));
      if (!session) return res.status(404).json({ error: "session not found" });
      const workspace = getWorkspace(session.workspaceId);
      if (!workspace) return res.status(404).json({ error: "workspace not found" });
      const target = resolveOutputTarget(listWorkspacePaths(session.workspaceId), {
        workspaceId: session.workspaceId,
        sessionId: session.id,
        fallbackOutputDir: standardDirIn(sessionDir(workspace.rootPath, session.id), "report"),
      });
      validateArtifactPath(path, target.source);
      const report = readFlowFile(target.outputDir, path).content;
      const nodes = await generateDecisionTreeWithLlm(basename(path), report, workspace.rootPath, model, {
        workspaceId: workspace.id,
        targetKind: "decision_tree",
        targetId: session.id,
        title: `决策树：${basename(path)}`,
      });
      return res.json({ nodes, model });
    }
    if (source === "flow-run") {
      const flow = getFlow(String(req.body?.flowId ?? ""));
      if (!flow) return res.status(404).json({ error: "flow not found" });
      const run = getFlowRun(String(req.body?.runId ?? ""));
      if (!run || run.flowId !== flow.id) return res.status(404).json({ error: "run not found" });
      const report = readFlowFile(run.outputDir, path).content;
      const nodes = await generateDecisionTreeWithLlm(basename(path), report, flow.folderPath, model, {
        workspaceId: flow.workspaceId,
        targetKind: "decision_tree",
        targetId: run.id,
        title: `决策树：${basename(path)}`,
      });
      return res.json({ nodes, model });
    }
    return res.status(400).json({ error: "source must be session or flow-run" });
  } catch (err) {
    return res.status(500).json({ error: String(err) });
  }
});

app.post("/api/golden-strategy/generate", async (req, res) => {
  const source = String(req.body?.source ?? "");
  const path = String(req.body?.path ?? "");
  if (!path) return res.status(400).json({ error: "path required" });
  try {
    const definition = resolveGoldenStrategyModel(req.body?.analysisModel);
    const model = resolveRequestedModel(req.body?.model, DEFAULT_GOLDEN_STRATEGY_MODEL);
    const prompt = String(req.body?.prompt ?? "").trim();
    const businessRequirementContext = loadBusinessRequirementContextForChat(req.body?.businessRequirementContext);
    const result = await generateGoldenStrategyArtifact({
      source,
      path,
      sessionId: String(req.body?.sessionId ?? ""),
      flowId: String(req.body?.flowId ?? ""),
      runId: String(req.body?.runId ?? ""),
      definition,
      model,
      prompt,
      businessRequirementContext,
    });
    return res.json(result);
  } catch (err) {
    return res.status(500).json({ error: String(err) });
  }
});

app.post("/api/golden-strategy/generate-batch", async (req, res) => {
  const source = String(req.body?.source ?? "");
  const path = String(req.body?.path ?? "");
  if (!path) return res.status(400).json({ error: "path required" });
  try {
    const uniqueIds = parseGoldenStrategyModelIds(req.body?.analysisModels);
    if (uniqueIds.length === 0) return res.status(400).json({ error: "analysisModels required" });
    if (uniqueIds.length > MAX_GOLDEN_STRATEGY_BATCH_MODELS) {
      return res.status(400).json({ error: `analysisModels supports at most ${MAX_GOLDEN_STRATEGY_BATCH_MODELS} models` });
    }
    const model = resolveRequestedModel(req.body?.model, DEFAULT_GOLDEN_STRATEGY_MODEL);
    const prompt = String(req.body?.prompt ?? "").trim();
    const businessRequirementContext = loadBusinessRequirementContextForChat(req.body?.businessRequirementContext);
    const settled = await Promise.allSettled(uniqueIds.map((id) => {
      const definition = GOLDEN_STRATEGY_MODELS[id];
      return generateGoldenStrategyArtifact({
        source,
        path,
        sessionId: String(req.body?.sessionId ?? ""),
        flowId: String(req.body?.flowId ?? ""),
        runId: String(req.body?.runId ?? ""),
        definition,
        model,
        prompt,
        businessRequirementContext,
      });
    }));
    const results = settled
      .filter((item): item is PromiseFulfilledResult<Awaited<ReturnType<typeof generateGoldenStrategyArtifact>>> => item.status === "fulfilled")
      .map((item) => item.value);
    const errors = settled
      .map((item, index) => item.status === "rejected"
        ? { analysisModel: uniqueIds[index], error: String(item.reason) }
        : null)
      .filter((item): item is { analysisModel: GoldenStrategyModelId; error: string } => item !== null);
    return res.json({ results, errors });
  } catch (err) {
    return res.status(500).json({ error: String(err) });
  }
});

app.post("/api/sessions/:id/promote-to-flow", (req, res) => {
  const session = getSession(req.params.id);
  if (!session) return res.status(404).json({ error: "session not found" });
  const name = String(req.body?.name ?? session.title).trim() || session.title;
  const scope = req.body?.scope === "full_conversation" ? "full_conversation" : "latest_task";
  const model = String(req.body?.model ?? "").trim() || undefined;
  const messages = listMessages(session.id);
  if (!messages.some((message) => message.role === "assistant" && extractStoredMessageText(message.content))) {
    return res.status(400).json({ error: "session has no completed assistant response" });
  }
  const flow = createFlow(session.workspaceId, name, `探索：${session.title}`, "multi", session.id, "generating");
  addFlowMessage(flow.id, "user", [{ type: "text", text: `从探索会话「${session.title}」沉淀可复用工作流。` }]);
  res.json(flow);
  void compileSessionWorkflow(flow.id, session.id, scope, model);
});

// Distill a completed exploration conversation into a reusable SKILL.md.
// Returns the generated markdown for preview/editing; saving is a separate step.
app.post("/api/sessions/:id/distill-skill", async (req, res) => {
  const session = getSession(req.params.id);
  if (!session) return res.status(404).json({ error: "session not found" });
  const workspace = getWorkspace(session.workspaceId);
  if (!workspace) return res.status(404).json({ error: "workspace not found" });
  const scope: PromoteScope = req.body?.scope === "full_conversation" ? "full_conversation" : "latest_task";
  const model = String(req.body?.model ?? "").trim() || undefined;
  const transcript = buildPromoteTranscript(session.id, scope);
  if (!transcript.trim()) {
    return res.status(400).json({ error: "session has no conversation to distill" });
  }
  try {
    const rawOutput = await runPiPrompt({
      workspaceRoot: workspace.rootPath,
      text: buildSkillDistillationPrompt(transcript),
      model,
      systemPrompt: SKILL_DISTILL_SYSTEM_PROMPT,
      timeoutMs: 180_000,
      onEvent: (event) => trackUsageEvent({
        workspaceId: workspace.id,
        targetKind: "session",
        targetId: session.id,
        title: `沉淀 Skill：${session.title}`,
      }, event),
    });
    const content = extractSkillMarkdown(rawOutput);
    res.json({ content, name: parseSkillName(content) ?? "", model: model ?? "" });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// Persist an (optionally hand-edited) SKILL.md under <workspace>/.pi/skills/<slug>/
// so listSkills() can discover it as a project-scoped skill.
app.post("/api/sessions/:id/save-skill", (req, res) => {
  const session = getSession(req.params.id);
  if (!session) return res.status(404).json({ error: "session not found" });
  const workspace = getWorkspace(session.workspaceId);
  if (!workspace) return res.status(404).json({ error: "workspace not found" });
  const content = String(req.body?.content ?? "");
  if (!content.trim()) return res.status(400).json({ error: "skill content required" });
  const name = String(req.body?.name ?? "").trim() || parseSkillName(content) || "";
  if (!name) return res.status(400).json({ error: "skill name required" });
  const slug = slugifySkillName(name);
  const skillDir = join(workspace.rootPath, ".pi", "skills", slug);
  const skillFile = join(skillDir, "SKILL.md");
  if (existsSync(skillFile)) {
    return res.status(409).json({ error: `skill already exists: ${slug}` });
  }
  mkdirSync(skillDir, { recursive: true });
  writeFileSync(skillFile, content.endsWith("\n") ? content : `${content}\n`, "utf8");
  res.json({ path: skillFile, name, slug });
});

// ---- REST: flows ----
app.get("/api/workspaces/:id/flows", (req, res) => {
  if (!getWorkspace(req.params.id)) return res.status(404).json({ error: "workspace not found" });
  res.json(listFlows(req.params.id));
});
app.get("/api/flows/:id", (req, res) => {
  const flow = getFlow(req.params.id);
  if (!flow) return res.status(404).json({ error: "flow not found" });
  res.json(flow);
});
app.post("/api/workspaces/:id/flows", (req, res) => {
  if (!getWorkspace(req.params.id)) return res.status(404).json({ error: "workspace not found" });
  const name = String(req.body?.name ?? "新工作流").trim() || "新工作流";
  const kind = req.body?.kind === "multi" ? "multi" : "single";
  res.json(createFlow(req.params.id, name, null, kind));
});
// Materialise the built-in AnaX商业分析 methodology as a runnable multi-agent flow.
app.post("/api/workspaces/:id/anax/instantiate", (req, res) => {
  if (!getWorkspace(req.params.id)) return res.status(404).json({ error: "workspace not found" });
  const name = String(req.body?.name ?? "AnaX 商业分析").trim() || "AnaX 商业分析";
  const flow = createFlow(req.params.id, name, "AnaX v3.0", "multi", null, "ready");
  writeFlowFile(flow.folderPath, "workflow.json", JSON.stringify(buildAnaxWorkflow(), null, 2));
  res.json(flow);
});
app.post("/api/workspaces/:id/anax/instantiate-quick", (req, res) => {
  if (!getWorkspace(req.params.id)) return res.status(404).json({ error: "workspace not found" });
  const name = String(req.body?.name ?? "AnaX 快速分析").trim() || "AnaX 快速分析";
  const flow = createFlow(req.params.id, name, "AnaX v3.0 Quick", "multi", null, "ready");
  writeFlowFile(flow.folderPath, "workflow.json", JSON.stringify(buildAnaxQuickWorkflow(), null, 2));
  res.json(flow);
});
app.patch("/api/flows/:id", (req, res) => {
  if (!getFlow(req.params.id)) return res.status(404).json({ error: "flow not found" });
  const name = String(req.body?.name ?? "").trim();
  if (!name) return res.status(400).json({ error: "name required" });
  renameFlow(req.params.id, name);
  res.json({ ok: true });
});
app.delete("/api/flows/:id", (req, res) => {
  const flow = getFlow(req.params.id);
  if (!flow) return res.status(404).json({ error: "flow not found" });
  if (req.query.deleteFiles === "true") {
    try { moveManagedDirToTrash(flow.folderPath); }
    catch (err) { return res.status(500).json({ error: String(err) }); }
  }
  deleteFlow(req.params.id);
  res.json({ ok: true });
});

// ---- REST: workflow favorites ----
function assertFavoriteSnapshotPath(snapshotPath: string): string {
  const root = resolve(FAVORITES_ROOT);
  const absolutePath = resolve(snapshotPath);
  if (!absolutePath.startsWith(`${root}${sep}`)) throw new Error("invalid favorite snapshot path");
  return absolutePath;
}

function replaceFavoriteSnapshot(sourcePath: string, snapshotPath: string): void {
  const target = assertFavoriteSnapshotPath(snapshotPath);
  rmSync(target, { recursive: true, force: true });
  copyFlowSnapshot(sourcePath, target);
}

app.get("/api/workflow-favorites", (_req, res) => {
  res.json(listWorkflowFavorites());
});

app.post("/api/flows/:id/favorite", (req, res) => {
  const flow = getFlow(req.params.id);
  if (!flow) return res.status(404).json({ error: "flow not found" });
  const workspace = getWorkspace(flow.workspaceId);
  if (!workspace) return res.status(404).json({ error: "workspace not found" });
  const existing = getWorkflowFavoriteBySourceFlowId(flow.id);
  try {
    if (existing) {
      replaceFavoriteSnapshot(flow.folderPath, existing.snapshotPath);
      updateWorkflowFavorite(existing.id, flow, workspace);
      return res.json(getWorkflowFavorite(existing.id));
    }
    const snapshotPath = join(FAVORITES_ROOT, randomUUID());
    replaceFavoriteSnapshot(flow.folderPath, snapshotPath);
    try {
      return res.json(createWorkflowFavorite(flow, workspace, snapshotPath));
    } catch (err) {
      rmSync(snapshotPath, { recursive: true, force: true });
      throw err;
    }
  } catch (err) {
    res.status(400).json({ error: String(err) });
  }
});

app.delete("/api/workflow-favorites/:id", (req, res) => {
  const favorite = getWorkflowFavorite(req.params.id);
  if (!favorite) return res.status(404).json({ error: "favorite not found" });
  try {
    rmSync(assertFavoriteSnapshotPath(favorite.snapshotPath), { recursive: true, force: true });
    removeWorkflowFavorite(favorite.id);
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: String(err) });
  }
});

app.post("/api/workflow-favorites/:id/reuse", (req, res) => {
  const favorite = getWorkflowFavorite(req.params.id);
  if (!favorite) return res.status(404).json({ error: "favorite not found" });
  const workspaceId = String(req.body?.workspaceId ?? "").trim();
  if (!getWorkspace(workspaceId)) return res.status(404).json({ error: "workspace not found" });
  const name = String(req.body?.name ?? `${favorite.name} 副本`).trim() || `${favorite.name} 副本`;
  let flow;
  try {
    const snapshotPath = assertFavoriteSnapshotPath(favorite.snapshotPath);
    if (!statSync(snapshotPath).isDirectory()) throw new Error("favorite snapshot is not a directory");
    flow = createFlow(workspaceId, name, favorite.name, favorite.kind);
    copyFlowSnapshot(snapshotPath, flow.folderPath);
    res.json(flow);
  } catch (err) {
    if (flow) {
      deleteFlow(flow.id);
      rmSync(flow.folderPath, { recursive: true, force: true });
    }
    res.status(400).json({ error: String(err) });
  }
});

app.get("/api/flows/:id/messages", (req, res) => {
  if (!getFlow(req.params.id)) return res.status(404).json({ error: "flow not found" });
  res.json(listFlowMessages(req.params.id));
});

app.get("/api/flows/:id/tree", (req, res) => {
  const flow = getFlow(req.params.id);
  if (!flow) return res.status(404).json({ error: "flow not found" });
  try {
    res.json(readTree(flow.folderPath));
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

app.get("/api/flows/:id/file", (req, res) => {
  const flow = getFlow(req.params.id);
  if (!flow) return res.status(404).json({ error: "flow not found" });
  const path = String(req.query.path ?? "");
  if (!path) return res.status(400).json({ error: "path required" });
  try {
    res.json(readFlowFile(flow.folderPath, path));
  } catch (err) {
    res.status(400).json({ error: String(err) });
  }
});

app.put("/api/flows/:id/file", (req, res) => {
  const flow = getFlow(req.params.id);
  if (!flow) return res.status(404).json({ error: "flow not found" });
  const path = String(req.body?.path ?? "");
  const content = typeof req.body?.content === "string" ? req.body.content : null;
  if (!path || content === null) return res.status(400).json({ error: "path & content required" });
  try {
    writeFlowFile(flow.folderPath, path, content);
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: String(err) });
  }
});

app.post("/api/flows/:id/import-local", (req, res) => {
  const flow = getFlow(req.params.id);
  if (!flow) return res.status(404).json({ error: "flow not found" });
  const sourcePath = String(req.body?.path ?? "").trim();
  if (!sourcePath) return res.status(400).json({ error: "path required" });
  try {
    const result = copyLocalFolderIntoFlow(sourcePath, flow.folderPath);
    updateFlowSourceName(flow.id, result.sourceName);
    res.json({ ok: true, ...result });
  } catch (err) {
    res.status(400).json({ error: String(err) });
  }
});

// Read workflow.json — auto-infer from directory structure if not present
app.get("/api/flows/:id/workflow", (req, res) => {
  const flow = getFlow(req.params.id);
  if (!flow) return res.status(404).json({ error: "flow not found" });
  try {
    const content = readFlowFile(flow.folderPath, "workflow.json").content;
    if (content === null) {
      res.json({ workflow: inferWorkflow(flow.folderPath), inferred: true });
    } else {
      res.json({ workflow: normalizeWorkflowModels(JSON.parse(content) as WorkflowLike), inferred: false });
    }
  } catch {
    res.json({ workflow: inferWorkflow(flow.folderPath), inferred: true });
  }
});

// Write workflow.json
app.put("/api/flows/:id/workflow", (req, res) => {
  const flow = getFlow(req.params.id);
  if (!flow) return res.status(404).json({ error: "flow not found" });
  try {
    const workflow = normalizeWorkflowModels(req.body as WorkflowLike);
    writeFlowFile(flow.folderPath, "workflow.json", JSON.stringify(workflow, null, 2));
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: String(err) });
  }
});

app.get("/api/flows/:id/runs", (req, res) => {
  const flow = getFlow(req.params.id);
  if (!flow) return res.status(404).json({ error: "flow not found" });
  res.json(listFlowRuns(flow.id));
});

app.get("/api/flows/:id/runs/:runId/tree", (req, res) => {
  const flow = getFlow(req.params.id);
  if (!flow) return res.status(404).json({ error: "flow not found" });
  const run = getFlowRun(req.params.runId);
  if (!run || run.flowId !== flow.id) return res.status(404).json({ error: "run not found" });
  try {
    res.json(readTree(run.outputDir));
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

app.get("/api/flows/:id/runs/:runId/file", (req, res) => {
  const flow = getFlow(req.params.id);
  if (!flow) return res.status(404).json({ error: "flow not found" });
  const run = getFlowRun(req.params.runId);
  if (!run || run.flowId !== flow.id) return res.status(404).json({ error: "run not found" });
  const path = String(req.query.path ?? "");
  if (!path) return res.status(400).json({ error: "path required" });
  try {
    res.json(readFlowFile(run.outputDir, path));
  } catch (err) {
    res.status(400).json({ error: String(err) });
  }
});

app.put("/api/flows/:id/runs/:runId/file", (req, res) => {
  const flow = getFlow(req.params.id);
  if (!flow) return res.status(404).json({ error: "flow not found" });
  const run = getFlowRun(req.params.runId);
  if (!run || run.flowId !== flow.id) return res.status(404).json({ error: "run not found" });
  const path = String(req.body?.path ?? "");
  const content = typeof req.body?.content === "string" ? req.body.content : null;
  if (!path || content === null) return res.status(400).json({ error: "path & content required" });
  try {
    writeFlowFile(run.outputDir, path, content);
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: String(err) });
  }
});

// ---- REST: workflow evaluations ----
app.get("/api/workspaces/:id/evaluations", (req, res) => {
  if (!getWorkspace(req.params.id)) return res.status(404).json({ error: "workspace not found" });
  res.json(listWorkflowEvaluations(req.params.id));
});

app.get("/api/evaluations/:id", (req, res) => {
  const evaluation = getWorkflowEvaluation(req.params.id);
  if (!evaluation) return res.status(404).json({ error: "evaluation not found" });
  res.json(evaluation);
});

app.post("/api/workspaces/:id/evaluations", (req, res) => {
  if (!getWorkspace(req.params.id)) return res.status(404).json({ error: "workspace not found" });
  const prompt = String(req.body?.prompt ?? "").trim();
  const rubric = String(req.body?.rubric ?? "").trim();
  const model = String(req.body?.model ?? "").trim();
  const judgeModel = String(req.body?.judgeModel ?? "").trim() || model;
  const flowConfigs = parseEvaluationFlowConfigs(req.body?.flowConfigs);
  const repeat = Number(req.body?.repeat ?? 1);
  const flowIds: string[] = Array.isArray(req.body?.flowIds)
    ? [...new Set<string>(req.body.flowIds.map((id: unknown) => String(id)))]
    : [];
  if (!prompt) return res.status(400).json({ error: "prompt required" });
  if (flowIds.length < 2) return res.status(400).json({ error: "select at least two workflows" });
  if (!Number.isInteger(repeat) || repeat < 1 || repeat > 3) {
    return res.status(400).json({ error: "repeat must be an integer between 1 and 3" });
  }
  const flows = flowIds.map((id) => getFlow(id));
  if (flows.some((flow) => !flow || flow.workspaceId !== req.params.id)) {
    return res.status(400).json({ error: "invalid workflow selection" });
  }
  const evaluation = createWorkflowEvaluation(
    req.params.id,
    prompt,
    rubric,
    model,
    judgeModel,
    flowConfigs,
    repeat,
    flows.filter((flow) => flow !== undefined),
  );
  res.json(evaluation);
  void runWorkflowEvaluation(evaluation.id);
});

// ---- REST: memory evaluations ----
app.get("/api/workspaces/:id/memory-evaluations", (req, res) => {
  if (!getWorkspace(req.params.id)) return res.status(404).json({ error: "workspace not found" });
  res.json(listMemoryEvaluations(req.params.id));
});

app.get("/api/memory-evaluations/:id", (req, res) => {
  const evaluation = getMemoryEvaluation(req.params.id);
  if (!evaluation) return res.status(404).json({ error: "memory evaluation not found" });
  res.json(evaluation);
});

app.post("/api/workspaces/:id/memory-evaluations", (req, res) => {
  if (!getWorkspace(req.params.id)) return res.status(404).json({ error: "workspace not found" });
  const prompt = String(req.body?.prompt ?? "").trim();
  const rubric = String(req.body?.rubric ?? "").trim();
  const model = String(req.body?.model ?? "").trim();
  const judgeModel = String(req.body?.judgeModel ?? "").trim() || model;
  const targetScope = req.body?.targetScope === "workflow" ? "workflow" : "chat";
  const repeat = Number(req.body?.repeat ?? 1);
  if (!prompt) return res.status(400).json({ error: "prompt required" });
  if (!Number.isInteger(repeat) || repeat < 1 || repeat > 3) {
    return res.status(400).json({ error: "repeat must be an integer between 1 and 3" });
  }
  const evaluation = createMemoryEvaluation(req.params.id, prompt, rubric, model, judgeModel, targetScope, repeat);
  res.json(evaluation);
  void runMemoryEvaluation(evaluation.id);
});

app.get("/api/workspaces/:id/skill-evaluations", (req, res) => {
  if (!getWorkspace(req.params.id)) return res.status(404).json({ error: "workspace not found" });
  res.json(listSkillEvaluations(req.params.id));
});

app.get("/api/workspaces/:id/skill-eval-sets", (req, res) => {
  if (!getWorkspace(req.params.id)) return res.status(404).json({ error: "workspace not found" });
  res.json(listSkillEvalSets(req.params.id));
});

app.post("/api/workspaces/:id/skill-eval-sets", (req, res) => {
  if (!getWorkspace(req.params.id)) return res.status(404).json({ error: "workspace not found" });
  const name = String(req.body?.name ?? "").trim();
  const tasks = parseSkillEvalSetTasks(req.body?.tasks);
  if (!name) return res.status(400).json({ error: "name required" });
  if (tasks.length === 0) return res.status(400).json({ error: "tasks required" });
  res.json(createSkillEvalSet(req.params.id, name, tasks));
});

app.patch("/api/skill-eval-sets/:id", (req, res) => {
  const existing = getSkillEvalSet(req.params.id);
  if (!existing) return res.status(404).json({ error: "skill eval set not found" });
  const name = req.body?.name === undefined ? existing.name : String(req.body.name ?? "").trim();
  const tasks = req.body?.tasks === undefined ? existing.tasks : parseSkillEvalSetTasks(req.body.tasks);
  if (!name) return res.status(400).json({ error: "name required" });
  if (tasks.length === 0) return res.status(400).json({ error: "tasks required" });
  res.json(updateSkillEvalSet(existing.id, name, tasks));
});

app.delete("/api/skill-eval-sets/:id", (req, res) => {
  const existing = getSkillEvalSet(req.params.id);
  if (!existing) return res.status(404).json({ error: "skill eval set not found" });
  res.json({ ok: deleteSkillEvalSet(existing.id) });
});

app.get("/api/skill-evaluations/:id", (req, res) => {
  const evaluation = getSkillEvaluation(req.params.id);
  if (!evaluation) return res.status(404).json({ error: "skill evaluation not found" });
  res.json(evaluation);
});

app.post("/api/workspaces/:id/skill-evaluations/run", async (req, res) => {
  const workspace = getWorkspace(req.params.id);
  if (!workspace) return res.status(404).json({ error: "workspace not found" });
  const parsed = parseSkillEvaluationRunRequest(req.body);
  if (!parsed.ok) return res.status(400).json({ error: parsed.error });
  try {
    const variants = parsed.value.variants.map((variant) => ({
      ...variant,
      skillPaths: validateSkillPaths(workspace.rootPath, variant.skillPaths, { mode: "strict" }) ?? [],
    }));
    const summary = await runSkillEvaluation({
      workspaceRoot: workspace.rootPath,
      workspaceId: workspace.id,
      evaluationId: randomUUID(),
      model: parsed.value.model,
      variants,
      tasks: parsed.value.tasks,
      repeat: parsed.value.repeat,
      judgeRepeat: parsed.value.judgeRepeat,
      contextPrefix: parsed.value.contextPrefix,
      dataContextPaths: parsed.value.dataContextPaths,
    });
    const evaluation = saveSkillEvaluation(
      workspace.id,
      parsed.value.model,
      parsed.value.repeat,
      variants,
      parsed.value.tasks,
      parsed.value.contextPrefix,
      summary,
    );
    res.json(evaluation);
    autoTriggerCuration({
      workspaceRoot: workspace.rootPath,
      workspaceId: workspace.id,
      model: parsed.value.model,
      evaluation,
    });
  } catch (err) {
    res.status(400).json({ error: String(err) });
  }
});

app.post("/api/workspaces/:id/tool-evaluations/run", async (req, res) => {
  const workspace = getWorkspace(req.params.id);
  if (!workspace) return res.status(404).json({ error: "workspace not found" });
  const parsed = parseToolEvaluationRunRequest(req.body);
  if (!parsed.ok) return res.status(400).json({ error: parsed.error });
  const tool = getExtractionTool(parsed.value.toolId);
  if (!tool) return res.status(404).json({ error: "extraction tool not found" });
  try {
    const summary = await runToolEvaluation({
      workspaceRoot: workspace.rootPath,
      workspaceId: workspace.id,
      evaluationId: randomUUID(),
      tool,
      cases: parsed.value.cases,
      repeat: parsed.value.repeat,
    });
    const evaluation = saveToolEvaluation(
      workspace.id,
      parsed.value.toolId,
      parsed.value.repeat,
      parsed.value.cases,
      summary,
    );
    res.json(evaluation);
  } catch (err) {
    res.status(400).json({ error: String(err) });
  }
});

app.get("/api/workspaces/:id/tool-evaluations", (req, res) => {
  if (!getWorkspace(req.params.id)) return res.status(404).json({ error: "workspace not found" });
  res.json(listToolEvaluations(req.params.id));
});

app.get("/api/workspaces/:id/tool-case-sets", (req, res) => {
  if (!getWorkspace(req.params.id)) return res.status(404).json({ error: "workspace not found" });
  const toolId = typeof req.query.toolId === "string" && req.query.toolId.trim() ? req.query.toolId.trim() : undefined;
  res.json(listToolCaseSets(req.params.id, toolId));
});

app.post("/api/workspaces/:id/tool-case-sets", (req, res) => {
  if (!getWorkspace(req.params.id)) return res.status(404).json({ error: "workspace not found" });
  const name = String(req.body?.name ?? "").trim();
  const toolId = String(req.body?.toolId ?? "").trim();
  if (!name) return res.status(400).json({ error: "name required" });
  if (!toolId) return res.status(400).json({ error: "toolId required" });
  if (!getExtractionTool(toolId)) return res.status(404).json({ error: "extraction tool not found" });
  const cases = parseToolEvaluationCases(req.body?.cases);
  if (cases.length === 0) return res.status(400).json({ error: "cases required" });
  res.json(createToolCaseSet(req.params.id, name, toolId, cases));
});

app.patch("/api/tool-case-sets/:id", (req, res) => {
  const existing = getToolCaseSet(req.params.id);
  if (!existing) return res.status(404).json({ error: "tool case set not found" });
  const name = req.body?.name === undefined ? existing.name : String(req.body.name ?? "").trim();
  const toolId = req.body?.toolId === undefined ? existing.toolId : String(req.body.toolId ?? "").trim();
  const cases = req.body?.cases === undefined ? existing.cases : parseToolEvaluationCases(req.body.cases);
  if (!name) return res.status(400).json({ error: "name required" });
  if (!toolId) return res.status(400).json({ error: "toolId required" });
  if (!getExtractionTool(toolId)) return res.status(404).json({ error: "extraction tool not found" });
  if (cases.length === 0) return res.status(400).json({ error: "cases required" });
  res.json(updateToolCaseSet(existing.id, name, toolId, cases));
});

app.delete("/api/tool-case-sets/:id", (req, res) => {
  const existing = getToolCaseSet(req.params.id);
  if (!existing) return res.status(404).json({ error: "tool case set not found" });
  res.json({ ok: deleteToolCaseSet(existing.id) });
});

app.get("/api/tool-evaluations/:id", (req, res) => {
  const evaluation = getToolEvaluation(req.params.id);
  if (!evaluation) return res.status(404).json({ error: "tool evaluation not found" });
  res.json(evaluation);
});

app.get("/api/workspaces/:id/evaluation-archives", (req, res) => {
  const workspace = getWorkspace(req.params.id);
  if (!workspace) return res.status(404).json({ error: "workspace not found" });
  res.json(listEvaluationArchives(workspace.rootPath));
});

app.get("/api/workspaces/:id/evaluation-archives/:baseName/:format", (req, res) => {
  const workspace = getWorkspace(req.params.id);
  if (!workspace) return res.status(404).json({ error: "workspace not found" });
  const format = String(req.params.format ?? "");
  if (format !== "md" && format !== "json") return res.status(400).json({ error: "format must be md or json" });
  const baseName = String(req.params.baseName ?? "");
  const archive = listEvaluationArchives(workspace.rootPath).find((item) => item.baseName === baseName);
  if (!archive) return res.status(404).json({ error: "archive not found" });
  const filePath = format === "md" ? archive.markdownPath : archive.jsonPath;
  const stat = statSync(filePath);
  if (!stat.isFile()) return res.status(404).json({ error: "archive file not found" });
  res.setHeader("content-type", format === "md" ? "text/markdown; charset=utf-8" : "application/json; charset=utf-8");
  res.setHeader("content-disposition", `attachment; filename="${baseName}.${format}"`);
  res.send(readFileSync(filePath, "utf8"));
});

app.post("/api/skill-evaluations/:id/curate", async (req, res) => {
  const evaluation = getSkillEvaluation(req.params.id);
  if (!evaluation) return res.status(404).json({ error: "skill evaluation not found" });
  const workspace = getWorkspace(evaluation.workspaceId);
  if (!workspace) return res.status(404).json({ error: "workspace not found" });
  const body = req.body as Record<string, unknown>;
  const model = typeof body?.model === "string" && body.model.trim() ? body.model.trim() : evaluation.model;
  try {
    const result = await curateSkillEvaluation({
      workspaceRoot: workspace.rootPath,
      workspaceId: evaluation.workspaceId,
      model,
      evaluation,
    });
    return res.json(result);
  } catch (err) {
    return res.status(500).json({ error: String(err) });
  }
});

app.post("/api/workspaces/:id/skill-curator/apply", (req, res) => {
  const workspace = getWorkspace(req.params.id);
  if (!workspace) return res.status(404).json({ error: "workspace not found" });
  const body = req.body as Record<string, unknown>;
  const proposals = parseIncomingCurationProposals(body?.proposals);
  if (!proposals) return res.status(400).json({ error: "proposals must be a non-empty array of valid proposals" });
  return res.json(applySkillCurationProposals({ workspaceRoot: workspace.rootPath, proposals }));
});

app.get("/api/workspaces/:id/skill-curation-proposals", (req, res) => {
  const workspace = getWorkspace(req.params.id);
  if (!workspace) return res.status(404).json({ error: "workspace not found" });
  const status = typeof req.query.status === "string" && req.query.status ? req.query.status : undefined;
  return res.json(listSkillCurationProposals(workspace.id, status));
});

app.patch("/api/skill-curation-proposals/:id", (req, res) => {
  const body = req.body as Record<string, unknown>;
  const status = typeof body?.status === "string" ? body.status : null;
  if (!status || !["pending", "approved", "rejected", "applied"].includes(status)) {
    return res.status(400).json({ error: "status must be pending, approved, rejected, or applied" });
  }
  const ok = updateSkillCurationProposalStatus(req.params.id, status);
  return ok ? res.json({ ok: true }) : res.status(404).json({ error: "proposal not found" });
});

app.post("/api/workspaces/:id/skill-curation-proposals/apply", (req, res) => {
  const workspace = getWorkspace(req.params.id);
  if (!workspace) return res.status(404).json({ error: "workspace not found" });
  const approved = listSkillCurationProposals(workspace.id, "approved");
  if (approved.length === 0) return res.json({ applied: [], errors: [] });
  const result = applySkillCurationProposals({ workspaceRoot: workspace.rootPath, proposals: approved });
  for (const path of result.applied) {
    const match = approved.find((p) => p.targetPath === path);
    if (match) updateSkillCurationProposalStatus(match.id, "applied");
  }
  return res.json(result);
});

app.post("/api/evaluations/:kind/:id/archive", (req, res) => {
  const kind = String(req.params.kind ?? "");
  if (kind === "skill") {
    const evaluation = getSkillEvaluation(req.params.id);
    if (!evaluation) return res.status(404).json({ error: "skill evaluation not found" });
    const workspace = getWorkspace(evaluation.workspaceId);
    if (!workspace) return res.status(404).json({ error: "workspace not found" });
    return res.json(archiveSkillEvaluation(workspace.rootPath, evaluation));
  }
  if (kind === "tool") {
    const evaluation = getToolEvaluation(req.params.id);
    if (!evaluation) return res.status(404).json({ error: "tool evaluation not found" });
    const workspace = getWorkspace(evaluation.workspaceId);
    if (!workspace) return res.status(404).json({ error: "workspace not found" });
    return res.json(archiveToolEvaluation(workspace.rootPath, evaluation));
  }
  return res.status(400).json({ error: "evaluation kind must be skill or tool" });
});

function parseIncomingCurationProposals(value: unknown): import("./types.ts").SkillCurationProposal[] | null {
  if (!Array.isArray(value) || value.length === 0) return null;
  const proposals: import("./types.ts").SkillCurationProposal[] = [];
  for (const item of value) {
    if (typeof item !== "object" || item === null) continue;
    const raw = item as Record<string, unknown>;
    const type = raw.type === "create" || raw.type === "update" ? raw.type : null;
    const targetPath = typeof raw.targetPath === "string" && raw.targetPath.trim() ? raw.targetPath.trim() : null;
    if (!type || !targetPath) continue;
    proposals.push({
      type,
      targetPath,
      suggestedContent: typeof raw.suggestedContent === "string" ? raw.suggestedContent : "",
      rationale: typeof raw.rationale === "string" ? raw.rationale : "",
      confidence: typeof raw.confidence === "number" ? Math.max(0, Math.min(1, raw.confidence)) : 0,
      evidence: Array.isArray(raw.evidence) ? raw.evidence.filter((e): e is string => typeof e === "string") : [],
    });
  }
  return proposals.length > 0 ? proposals : null;
}

function parseEvaluationFlowConfigs(value: unknown): Record<string, EvaluationFlowConfig> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return {};
  const out: Record<string, EvaluationFlowConfig> = {};
  for (const [flowId, raw] of Object.entries(value)) {
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) continue;
    const config = raw as { defaultModel?: unknown; nodeModels?: unknown };
    const nodeModels: Record<string, string> = {};
    if (typeof config.nodeModels === "object" && config.nodeModels !== null && !Array.isArray(config.nodeModels)) {
      for (const [nodeId, nodeModel] of Object.entries(config.nodeModels)) {
        if (typeof nodeModel === "string" && nodeModel.trim()) nodeModels[nodeId] = nodeModel.trim();
      }
    }
    out[flowId] = {
      defaultModel: typeof config.defaultModel === "string" ? config.defaultModel.trim() : undefined,
      nodeModels,
    };
  }
  return out;
}

function parseSkillEvalSetTasks(value: unknown): Array<{ id: string; prompt: string; expectedPoints?: string[]; rubric?: string }> {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item, index) => {
    if (typeof item !== "object" || item === null) return [];
    const raw = item as Record<string, unknown>;
    const prompt = String(raw.prompt ?? "").trim();
    if (!prompt) return [];
    const id = String(raw.id ?? `task_${index + 1}`).trim() || `task_${index + 1}`;
    const expectedPoints = Array.isArray(raw.expectedPoints)
      ? raw.expectedPoints.map((point) => String(point).trim()).filter(Boolean)
      : [];
    const rubric = String(raw.rubric ?? "").trim();
    return [{
      id,
      prompt,
      ...(expectedPoints.length ? { expectedPoints } : {}),
      ...(rubric ? { rubric } : {}),
    }];
  });
}

// ---- REST: workspace paths ----
app.get("/api/workspaces/:id/paths", (req, res) => {
  if (!getWorkspace(String(req.params.id ?? ""))) return res.status(404).json({ error: "workspace not found" });
  const folder = String(req.query.folder ?? "") || undefined;
  res.json(withWorkspacePathStatuses(listWorkspacePaths(String(req.params.id ?? ""), folder)));
});

app.post("/api/workspaces/:id/paths", async (req, res) => {
  const workspaceId = String(req.params.id ?? "");
  if (!getWorkspace(workspaceId)) return res.status(404).json({ error: "workspace not found" });
  const folder = String(req.body?.folder ?? "").trim();
  const path = String(req.body?.path ?? "").trim();
  const kind = String(req.body?.kind ?? "").trim();
  if (!folder || !path || !kind) return res.status(400).json({ error: "folder, path and kind required" });
  try {
    const fileHash = kind === "file" ? await computeFileHash(path) : null;
    const entry = addWorkspacePath(workspaceId, folder, path, kind, null, null, fileHash);
    res.json(entry);
    // data_changed cascade: when a clean_data file is registered, mark AnaX downstream stale.
    if (folder === "clean_data" && kind === "file") {
      const anaxFlow = listFlows(workspaceId).find((f) => f.sourceName === "AnaX v3.0");
      if (anaxFlow) {
        const runs = listFlowRuns(anaxFlow.id);
        const latestRun = runs[0]; // ordered by started_at DESC
        if (latestRun) {
          const downstream = getDownstreamNodeIds("data");
          markNodesStale(latestRun.id, downstream, "data_changed");
        }
      }
    }
  } catch (err) {
    res.status(400).json({ error: String(err) });
  }
});

app.delete("/api/workspaces/:id/paths/:pathId", (req, res) => {
  removeWorkspacePath(Number(req.params.pathId));
  res.json({ ok: true });
});

// ---- REST: session paths ----
app.get("/api/sessions/:id/paths", (req, res) => {
  const session = getSession(String(req.params.id ?? ""));
  if (!session) return res.status(404).json({ error: "session not found" });
  const folder = String(req.query.folder ?? "") || undefined;
  res.json(withWorkspacePathStatuses(listWorkspacePaths(session.workspaceId, folder, session.id)));
});

app.post("/api/sessions/:id/paths", async (req, res) => {
  const session = getSession(String(req.params.id ?? ""));
  if (!session) return res.status(404).json({ error: "session not found" });
  const folder = String(req.body?.folder ?? "").trim();
  const path = String(req.body?.path ?? "").trim();
  const kind = String(req.body?.kind ?? "").trim();
  if (!folder || !path || !kind) return res.status(400).json({ error: "folder, path and kind required" });
  try {
    const fileHash = kind === "file" ? await computeFileHash(path) : null;
    res.json(addWorkspacePath(session.workspaceId, folder, path, kind, session.id, null, fileHash));
  } catch (err) {
    res.status(400).json({ error: String(err) });
  }
});

app.delete("/api/sessions/:id/paths/:pathId", (req, res) => {
  removeWorkspacePath(Number(req.params.pathId));
  res.json({ ok: true });
});

// ---- REST: flow paths ----
app.get("/api/flows/:id/paths", (req, res) => {
  const flow = getFlow(String(req.params.id ?? ""));
  if (!flow) return res.status(404).json({ error: "flow not found" });
  const folder = String(req.query.folder ?? "") || undefined;
  res.json(withWorkspacePathStatuses(listWorkspacePaths(flow.workspaceId, folder, undefined, flow.id)));
});

app.post("/api/flows/:id/paths", async (req, res) => {
  const flow = getFlow(String(req.params.id ?? ""));
  if (!flow) return res.status(404).json({ error: "flow not found" });
  const folder = String(req.body?.folder ?? "").trim();
  const path = String(req.body?.path ?? "").trim();
  const kind = String(req.body?.kind ?? "").trim();
  if (!folder || !path || !kind) return res.status(400).json({ error: "folder, path and kind required" });
  try {
    const fileHash = kind === "file" ? await computeFileHash(path) : null;
    res.json(addWorkspacePath(flow.workspaceId, folder, path, kind, null, flow.id, fileHash));
  } catch (err) {
    res.status(400).json({ error: String(err) });
  }
});

app.delete("/api/flows/:id/paths/:pathId", (req, res) => {
  removeWorkspacePath(Number(req.params.pathId));
  res.json({ ok: true });
});

// ---- REST: file analysis cache ----

app.get("/api/workspace-paths/:pathId/analysis", (req, res) => {
  const entry = getWorkspacePath(Number(req.params.pathId));
  if (!entry) return res.status(404).json({ error: "path not found" });
  if (!entry.fileHash) return res.json({ fileHash: null, content: null, updatedAt: null });
  const analysis = getFileAnalysis(entry.fileHash);
  res.json(analysis ?? { fileHash: entry.fileHash, content: null, updatedAt: null });
});

app.put("/api/workspace-paths/:pathId/analysis", (req, res) => {
  const entry = getWorkspacePath(Number(req.params.pathId));
  if (!entry) return res.status(404).json({ error: "path not found" });
  if (!entry.fileHash) return res.status(400).json({ error: "path has no file hash — re-register the path to compute one" });
  const content = String(req.body?.content ?? "").trim();
  if (!content) return res.status(400).json({ error: "content required" });
  setFileAnalysis(entry.fileHash, content);
  res.json({ ok: true, fileHash: entry.fileHash });
});

// ---- registered local path previews ----
const TEXT_PREVIEW_EXTENSIONS = new Set([
  "", ".csv", ".css", ".html", ".js", ".json", ".jsonc", ".jsonl", ".jsx",
  ".log", ".md", ".markdown", ".py", ".r", ".sh", ".sql", ".ts", ".tsx",
  ".tsv", ".txt", ".xml", ".yaml", ".yml",
]);
const MAX_PATH_PREVIEW_BYTES = 2 * 1024 * 1024;

app.get("/api/workspace-paths/:pathId/tree", (req, res) => {
  const entry = getWorkspacePath(Number(req.params.pathId));
  if (!entry) return res.status(404).json({ error: "path not found" });
  try {
    const stat = statSync(entry.path);
    if (entry.kind === "file") {
      if (!stat.isFile()) throw new Error("registered path is not a file");
      return res.json({ name: basename(entry.path), path: "", kind: "file", size: stat.size, mtime: stat.mtimeMs });
    }
    if (!stat.isDirectory()) throw new Error("registered path is not a directory");
    res.json(readTree(entry.path));
  } catch (err) {
    res.status(400).json({ error: String(err) });
  }
});

app.get("/api/workspace-paths/:pathId/file", (req, res) => {
  const entry = getWorkspacePath(Number(req.params.pathId));
  if (!entry) return res.status(404).json({ error: "path not found" });
  const relPath = String(req.query.path ?? "");
  try {
    const abs = entry.kind === "dir"
      ? safeResolve(entry.path, relPath)
      : entry.path;
    if (entry.kind === "file" && relPath) throw new Error("file path does not accept a child path");
    const stat = statSync(abs);
    if (!stat.isFile()) throw new Error("not a file");
    const previewable = TEXT_PREVIEW_EXTENSIONS.has(extname(abs).toLowerCase());
    if (!previewable) {
      return res.json({ name: basename(abs), size: stat.size, previewable: false, truncated: false });
    }
    const content = readFileSync(abs).subarray(0, MAX_PATH_PREVIEW_BYTES).toString("utf8");
    res.json({ name: basename(abs), size: stat.size, previewable: true, truncated: stat.size > MAX_PATH_PREVIEW_BYTES, content });
  } catch (err) {
    res.status(400).json({ error: String(err) });
  }
});

app.put("/api/workspace-paths/:pathId/file", (req, res) => {
  const entry = getWorkspacePath(Number(req.params.pathId));
  if (!entry) return res.status(404).json({ error: "path not found" });
  const relPath = String(req.body?.path ?? "");
  const content = String(req.body?.content ?? "");
  if (!relPath) return res.status(400).json({ error: "path required" });
  try {
    if (entry.kind === "file") return res.status(400).json({ error: "cannot write sub-path into a file entry" });
    const abs = safeResolve(entry.path, relPath);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, content, "utf8");
    res.json({ ok: true, path: abs });
  } catch (err) {
    res.status(400).json({ error: String(err) });
  }
});

// ---- binary file streaming for data exploration (LLM-forbidden) ----
// This endpoint streams raw bytes for csv/xlsx/xls files under draw_data / clean_data paths.
// Used by DataExplorationPane to feed duckdb-wasm in the browser. ZERO LLM involvement.
const DATA_EXPLORATION_ALLOWED_EXTENSIONS = new Set([".csv", ".tsv", ".xlsx", ".xls"]);
const DATA_EXPLORATION_MAX_BYTES = 100 * 1024 * 1024;

app.get("/api/workspace-paths/:pathId/file-binary", (req, res) => {
  const entry = getWorkspacePath(Number(req.params.pathId));
  if (!entry) return res.status(404).json({ error: "path not found" });
  if (entry.folder !== "draw_data" && entry.folder !== "clean_data") {
    return res.status(403).json({ error: "binary streaming only allowed for draw_data / clean_data paths" });
  }
  const relPath = String(req.query.path ?? "");
  try {
    const abs = entry.kind === "dir"
      ? safeResolve(entry.path, relPath)
      : entry.path;
    if (entry.kind === "file" && relPath) throw new Error("file path does not accept a child path");
    const stat = statSync(abs);
    if (!stat.isFile()) throw new Error("not a file");
    const ext = extname(abs).toLowerCase();
    if (!DATA_EXPLORATION_ALLOWED_EXTENSIONS.has(ext)) {
      return res.status(415).json({ error: `unsupported extension: ${ext}` });
    }
    if (stat.size > DATA_EXPLORATION_MAX_BYTES) {
      return res.status(413).json({ error: `file too large (${stat.size} bytes, limit ${DATA_EXPLORATION_MAX_BYTES})` });
    }
    res.setHeader("Content-Type", "application/octet-stream");
    res.setHeader("Content-Length", String(stat.size));
    res.setHeader("X-File-Name", encodeURIComponent(basename(abs)));
    res.sendFile(abs);
  } catch (err) {
    res.status(400).json({ error: String(err) });
  }
});

// ---- macOS native file/folder picker ----
app.post("/api/pick-path", (req, res) => {
  const mode = String(req.body?.mode ?? "file");
  // Default the native dialog to the task's standard dir (session/flow scope; the
  // standard is task-bound). Only when it exists — else a plain chooser.
  const folder = req.body?.folder ? String(req.body.folder) : "";
  const sessionId = req.body?.sessionId ? String(req.body.sessionId) : "";
  const flowId = req.body?.flowId ? String(req.body.flowId) : "";
  let defaultLocation = "";
  if (folder === "draw_data" || folder === "clean_data" || folder === "report") {
    let baseDir = "";
    if (flowId) {
      baseDir = getFlow(flowId)?.folderPath ?? "";
    } else if (sessionId) {
      const session = getSession(sessionId);
      const ws = session ? getWorkspace(session.workspaceId) : undefined;
      if (ws) baseDir = sessionDir(ws.rootPath, sessionId);
    }
    if (baseDir) {
      const dir = standardDirIn(baseDir, folder);
      if (existsSync(dir)) defaultLocation = dir;
    }
  }
  const chooser = mode === "dir" ? "choose folder" : "choose file";
  const withDefault = defaultLocation
    ? `${chooser} default location (POSIX file ${JSON.stringify(defaultLocation)})`
    : chooser;
  const script = `POSIX path of (${withDefault})`;
  execFile("osascript", ["-e", script], (err, stdout) => {
    if (err) return res.status(400).json({ error: "cancelled" });
    res.json({ path: stdout.trim() });
  });
});

// ---- SQL connections ----
import { deleteConnection, executeQuery, exportQueryToCsv, getConnection, getSchema, listConnections, testConnection, upsertConnection, validateSql } from "./sql-connections.ts";

app.get("/api/sql-connections", (_req, res) => {
  res.json(listConnections().map((c) => ({ ...c, password: c.password ? "***" : undefined })));
});

app.post("/api/sql-connections", (req, res) => {
  try {
    const conn = upsertConnection(req.body as Parameters<typeof upsertConnection>[0]);
    res.json({ ...conn, password: conn.password ? "***" : undefined });
  } catch (err) {
    res.status(400).json({ error: String(err) });
  }
});

app.patch("/api/sql-connections/:id", (req, res) => {
  const existing = getConnection(String(req.params.id));
  if (!existing) return res.status(404).json({ error: "connection not found" });
  const body = req.body as Partial<typeof existing>;
  if (body.password === "***") body.password = existing.password;
  try {
    const conn = upsertConnection({ ...existing, ...body, id: existing.id });
    res.json({ ...conn, password: conn.password ? "***" : undefined });
  } catch (err) {
    res.status(400).json({ error: String(err) });
  }
});

app.delete("/api/sql-connections/:id", (req, res) => {
  if (!deleteConnection(String(req.params.id))) return res.status(404).json({ error: "connection not found" });
  res.json({ ok: true });
});

app.post("/api/sql-connections/:id/test", (req, res) => {
  const conn = getConnection(String(req.params.id));
  if (!conn) return res.status(404).json({ error: "connection not found" });
  testConnection(conn).then((result) => res.json(result)).catch((err) => res.status(500).json({ error: String(err) }));
});

app.get("/api/sql-connections/:id/schema", (req, res) => {
  const conn = getConnection(String(req.params.id));
  if (!conn) return res.status(404).json({ error: "connection not found" });
  getSchema(conn).then((tables) => res.json({ tables })).catch((err) => res.status(500).json({ error: String(err) }));
});

app.post("/api/sql-connections/:id/validate-sql", (req, res) => {
  const conn = getConnection(String(req.params.id));
  if (!conn) return res.status(404).json({ error: "connection not found" });
  const sql = String(req.body?.sql ?? "").trim();
  if (!sql) return res.status(400).json({ error: "sql required" });
  res.json(validateSql(sql));
});

app.post("/api/sql-connections/:id/query", (req, res) => {
  const conn = getConnection(String(req.params.id));
  if (!conn) return res.status(404).json({ error: "connection not found" });
  const sql = String(req.body?.sql ?? "").trim();
  if (!sql) return res.status(400).json({ error: "sql required" });
  const validation = validateSql(sql);
  if (!validation.safe) {
    return res.status(400).json({ error: "SQL 包含危险操作", validation });
  }
  const workspaceId = typeof req.body?.workspaceId === "string" ? req.body.workspaceId : undefined;
  const params = typeof req.body?.params === "object" && req.body.params !== null ? req.body.params as Record<string, unknown> : undefined;
  const startMs = Date.now();
  executeQuery(conn, sql, undefined, params).then((result) => {
    if (workspaceId) {
      addTraceEvent({
        workspaceId,
        targetKind: "sql_connection",
        targetId: conn.id,
        type: "sql_query",
        target: conn.name,
        status: "success",
        detail: `查询返回 ${result.rowCount} 行 · ${result.executionMs}ms${result.capped ? " (已截断)" : ""}`,
        payload: { sql: sql.slice(0, 500), rowCount: result.rowCount, executionMs: result.executionMs, capped: result.capped, riskLevel: validation.riskLevel },
      });
    }
    res.json({ ...result, validation });
  }).catch((err) => {
    if (workspaceId) {
      addTraceEvent({
        workspaceId,
        targetKind: "sql_connection",
        targetId: conn.id,
        type: "sql_query",
        target: conn.name,
        status: "failed",
        detail: String(err).slice(0, 500),
        payload: { sql: sql.slice(0, 500), riskLevel: validation.riskLevel },
      });
    }
    res.status(500).json({ error: String(err) });
  });
});

app.post("/api/sql-connections/:id/export", (req, res) => {
  const conn = getConnection(String(req.params.id));
  if (!conn) return res.status(404).json({ error: "connection not found" });
  const sql = String(req.body?.sql ?? "").trim();
  const outputPath = String(req.body?.outputPath ?? "").trim();
  const params = typeof req.body?.params === "object" && req.body.params !== null ? req.body.params as Record<string, unknown> : undefined;
  const watermark = typeof req.body?.watermark === "object" && req.body.watermark !== null ? req.body.watermark as { column: string; initialValue?: unknown } : undefined;
  const workspaceId = typeof req.body?.workspaceId === "string" ? req.body.workspaceId : undefined;
  if (!sql) return res.status(400).json({ error: "sql required" });
  if (!outputPath) return res.status(400).json({ error: "outputPath required" });
  const validation = validateSql(sql);
  if (!validation.safe) {
    return res.status(400).json({ error: "SQL 包含危险操作", validation });
  }
  exportQueryToCsv(conn, sql, resolve(outputPath), params, watermark)
    .then((result) => {
      if (workspaceId) {
        addTraceEvent({
          workspaceId,
          targetKind: "sql_connection",
          targetId: conn.id,
          type: "sql_export",
          target: conn.name,
          status: "success",
          detail: `导出 ${result.rowCount} 行 → ${outputPath}${result.appended ? " (追加)" : ""}`,
          payload: { sql: sql.slice(0, 500), outputPath, rowCount: result.rowCount, appended: result.appended, riskLevel: "L2" },
        });
      }
      res.json({ ...result, path: resolve(outputPath) });
    })
    .catch((err) => {
      if (workspaceId) {
        addTraceEvent({
          workspaceId,
          targetKind: "sql_connection",
          targetId: conn.id,
          type: "sql_export",
          target: conn.name,
          status: "failed",
          detail: String(err).slice(0, 500),
          payload: { sql: sql.slice(0, 500), outputPath },
        });
      }
      res.status(500).json({ error: String(err) });
    });
});

app.get("/api/sql-connections/export-state", (req, res) => {
  const outputPath = String(req.query.path ?? "").trim();
  if (!outputPath) return res.status(400).json({ error: "path required" });
  const statePath = `${resolve(outputPath)}.state`;
  if (!existsSync(statePath)) {
    return res.json({ exists: false });
  }
  try {
    const state = JSON.parse(readFileSync(statePath, "utf8")) as { lastWatermark?: unknown };
    res.json({ exists: true, lastWatermark: state.lastWatermark });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

app.post("/api/sql-connections/export-state", (req, res) => {
  const outputPath = String(req.body?.path ?? "").trim();
  const lastWatermark = req.body?.lastWatermark;
  if (!outputPath) return res.status(400).json({ error: "path required" });
  const statePath = `${resolve(outputPath)}.state`;
  try {
    if (lastWatermark === undefined || lastWatermark === null) {
      if (existsSync(statePath)) {
        unlinkSync(statePath);
      }
      res.json({ exists: false });
    } else {
      writeFileSync(statePath, JSON.stringify({ lastWatermark }), "utf8");
      res.json({ exists: true, lastWatermark });
    }
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// ---- direct LLM prompt (tool-free channel) ----
// Uses a fresh pi session per call so there is no accumulated context or skill
// loading. The caller embeds all data as text; pi has no file-path to follow.
app.post("/api/llm/prompt", (req, res) => {
  const text = String(req.body?.text ?? "").trim();
  if (!text) return res.status(400).json({ error: "text required" });
  const model = req.body?.model ? String(req.body.model) : undefined;
  const systemPrompt = req.body?.systemPrompt ? String(req.body.systemPrompt) : undefined;
  runPiPrompt({ workspaceRoot: DIRECT_LLM_ROOT, text, model, systemPrompt })
    .then((output) => res.json({ text: output, model: model ?? "default" }))
    .catch((err) => res.status(500).json({ error: String(err) }));
});

// ---- model lab: business prediction models ----
const PREDICTION_VARIANTS = new Set(["neutral", "success", "warning", "danger"]);
const PREDICTION_TIER_COLORS = new Set(["red", "orange", "amber", "green", "blue", "purple", "neutral"]);

function extractPredictionJsonObject(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/i)?.[1];
  const source = fenced ?? text;
  const start = source.indexOf("{");
  if (start < 0) throw new Error("LLM 返回内容不含有效 JSON");
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < source.length; i++) {
    const ch = source[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return JSON.parse(source.slice(start, i + 1));
    }
  }
  throw new Error("LLM 返回 JSON 未闭合");
}

function asString(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim() ? value : fallback;
}

function asScore(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.min(1, Math.max(0, n));
}

function normalizePredictionResult(value: unknown, expectedModelId: ModelLabId): Omit<PredictionResult, "rowsCapped" | "rowsTotal" | "model" | "runId"> {
  if (!value || typeof value !== "object") throw new Error("LLM JSON 根节点不是对象");
  const input = value as Record<string, unknown>;
  const summary = input.summary && typeof input.summary === "object" ? input.summary as Record<string, unknown> : {};
  const kpis = Array.isArray(summary.kpis) ? summary.kpis : [];
  const rows = Array.isArray(input.rows) ? input.rows : [];
  return {
    modelId: expectedModelId,
    summary: {
      kpis: kpis.slice(0, 4).map((item, index) => {
        const kpi = item && typeof item === "object" ? item as Record<string, unknown> : {};
        const variant: PredictionVariant = typeof kpi.variant === "string" && PREDICTION_VARIANTS.has(kpi.variant) ? kpi.variant as PredictionVariant : "neutral";
        return { label: asString(kpi.label, `指标${index + 1}`), value: asString(kpi.value, "—"), sub: typeof kpi.sub === "string" ? kpi.sub : undefined, variant };
      }),
      keyInsights: Array.isArray(summary.keyInsights) ? summary.keyInsights.map((item) => String(item)).filter(Boolean) : [],
      recommendations: Array.isArray(summary.recommendations) ? summary.recommendations.map((item) => String(item)).filter(Boolean) : [],
    },
    rows: rows.map((item, index) => {
      const row = item && typeof item === "object" ? item as Record<string, unknown> : {};
      const tierColor: PredictionTierColor = typeof row.tierColor === "string" && PREDICTION_TIER_COLORS.has(row.tierColor) ? row.tierColor as PredictionTierColor : "neutral";
      const attributes = Array.isArray(row.attributes) ? row.attributes : [];
      return {
        id: asString(row.id, String(index + 1)),
        label: typeof row.label === "string" ? row.label : undefined,
        score: asScore(row.score),
        tier: asString(row.tier, "unknown"),
        tierLabel: asString(row.tierLabel, "未分级"),
        tierColor,
        primaryConclusion: asString(row.primaryConclusion, "暂无结论"),
        attributes: attributes.map((attr) => {
          const a = attr && typeof attr === "object" ? attr as Record<string, unknown> : {};
          return { key: asString(a.key, "属性"), value: asString(a.value, "—") };
        }),
      };
    }),
  };
}

app.post("/api/model-lab/predict", async (req, res) => {
  const modelId = String(req.body?.modelId ?? "").trim();
  const mappings: Record<string, string> = req.body?.mappings ?? {};
  const rawRows: Record<string, unknown>[] = Array.isArray(req.body?.rows) ? req.body.rows : [];
  const model = req.body?.model ? String(req.body.model) : undefined;

  if (!modelId) return res.status(400).json({ error: "modelId required" });
  if (rawRows.length === 0) return res.status(400).json({ error: "rows required" });
  if (!SUPPORTED_MODELS.has(modelId as ModelLabId)) {
    return res.status(400).json({ error: `unsupported modelId: ${modelId}` });
  }

  const LIMIT = 200;
  const capped = rawRows.length > LIMIT;
  const mappedRows = rawRows.slice(0, LIMIT).map((row) => {
    const out: Record<string, unknown> = {};
    for (const [fieldKey, csvCol] of Object.entries(mappings)) {
      if (csvCol) out[fieldKey] = row[csvCol] ?? "";
    }
    return out;
  });

  const systemPrompt = "你是商业数据分析专家。根据输入数据输出结构化预测，仅输出合法 JSON，不含 markdown 代码块或额外文字。";
  const text = buildModelLabPrompt(modelId as ModelLabId, mappedRows, DIRECT_LLM_ROOT);

  const startedAt = Date.now();
  let rawOutput = "";
  try {
    rawOutput = await runPiPrompt({ workspaceRoot: DIRECT_LLM_ROOT, text, model, systemPrompt, timeoutMs: 180_000 });
    const normalized = normalizePredictionResult(extractPredictionJsonObject(rawOutput), modelId as ModelLabId);
    const result: PredictionResult = { ...normalized, rowsCapped: capped, rowsTotal: rawRows.length, model: model ?? "default" };
    const run = createModelLabRun({
      modelId,
      model: result.model ?? "default",
      status: "success",
      rowCount: mappedRows.length,
      rowsTotal: rawRows.length,
      rowsCapped: capped,
      durationMs: Date.now() - startedAt,
      result,
      rawOutput,
    });
    res.json({ ...result, runId: run.id });
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    try {
      createModelLabRun({
        modelId,
        model: model ?? "default",
        status: "failed",
        rowCount: mappedRows.length,
        rowsTotal: rawRows.length,
        rowsCapped: capped,
        durationMs: Date.now() - startedAt,
        result: null,
        rawOutput,
        errorMessage,
      });
    } catch {
      // ignore persistence error to not mask original failure
    }
    res.status(500).json({ error: errorMessage });
  }
});

  app.get("/api/model-lab/models", (req, res) => {
    try {
      const modelsDir = join(DIRECT_LLM_ROOT, ".pi", "models");
      if (!existsSync(modelsDir)) mkdirSync(modelsDir, { recursive: true });
      const files = readdirSync(modelsDir).filter(f => f.endsWith(".json"));
      const customModels = files.map(f => JSON.parse(readFileSync(join(modelsDir, f), "utf-8")));
      res.json(customModels);
    } catch {
      res.json([]);
    }
  });

  app.put("/api/model-lab/models/:id", (req, res) => {
    try {
      const modelsDir = join(DIRECT_LLM_ROOT, ".pi", "models");
      if (!existsSync(modelsDir)) mkdirSync(modelsDir, { recursive: true });
      const id = String(req.params.id);
      if (!/^[a-z0-9_]+$/.test(id)) return res.status(400).json({ error: "Invalid ID" });
      const p = join(modelsDir, `${id}.json`);
      writeFileSync(p, JSON.stringify(req.body, null, 2), "utf-8");
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

app.get("/api/model-lab/runs", (req, res) => {
  const limit = Number(req.query.limit ?? 30);
  res.json(listModelLabRuns(Number.isFinite(limit) ? limit : 30));
});

app.get("/api/model-lab/stats", (_req, res) => {
  res.json(getModelLabStats());
});

app.get("/api/model-lab/runs/:id", (req, res) => {
  const run = getModelLabRun(String(req.params.id ?? ""));
  if (!run) return res.status(404).json({ error: "model lab run not found" });
  res.json(run);
});

app.delete("/api/model-lab/runs/:id", (req, res) => {
  const id = String(req.params.id ?? "");
  if (!id) return res.status(400).json({ error: "missing id" });
  const ok = deleteModelLabRun(id);
  if (!ok) return res.status(404).json({ error: "model lab run not found" });
  res.json({ success: true, deleted: 1 });
});

app.delete("/api/model-lab/runs", (req, res) => {
  const days = Number(req.query.olderThanDays);
  if (!Number.isFinite(days) || days <= 0) {
    return res.status(400).json({ error: "missing or invalid olderThanDays (must be positive number)" });
  }
  const onlyFailed = req.query.onlyFailed !== "false";
  const beforeTs = Date.now() - days * 24 * 60 * 60 * 1000;
  const deleted = deleteModelLabRunsBefore({ beforeTs, onlyFailed });
  res.json({ success: true, deleted, beforeTs, onlyFailed });
});

// ---- BI Datasets (member retention / member recall import) ----
const VALID_BI_SLOTS_SET = new Set<BiDatasetSlot>(["member_retention", "member_recall"]);

function parseBiSlot(value: unknown): BiDatasetSlot | null {
  const s = String(value ?? "");
  return VALID_BI_SLOTS_SET.has(s as BiDatasetSlot) ? (s as BiDatasetSlot) : null;
}

// \u89E3\u6790\u903B\u8F91\u62BD\u81F3\u5171\u4EAB util bi-dataset-parser.ts\uFF08\u770B\u677F\u805A\u5408\u6570\u636E\u6E90 P0-D \u590D\u7528\uFF09\uFF1B\u6B64\u5904\u4FDD\u7559\u522B\u540D\u4E0D\u6539\u8C03\u7528\u70B9\u3002
const parseBiDatasetFromBuffer = parseAggregationBuffer;

app.post("/api/bi-datasets/upload", multer({ storage: multer.memoryStorage(), limits: { fileSize: 100 * 1024 * 1024 } }).single("file"), (req, res) => {
  const slot = parseBiSlot(req.body?.slot);
  if (!slot) {
    return res.status(400).json({ error: `invalid slot; must be one of: member_retention, member_recall` });
  }
  const file = req.file as Express.Multer.File | undefined;
  if (!file) return res.status(400).json({ error: "missing file (field name: 'file')" });
  const originalName = file.originalname || "upload";
  const ext = extname(originalName).toLowerCase();
  if (![".csv", ".tsv", ".xlsx", ".xls"].includes(ext)) {
    return res.status(415).json({ error: `unsupported extension: ${ext}; accept .csv .tsv .xlsx .xls` });
  }
  try {
    const buf = file.buffer;
    const { columns, rows } = parseBiDatasetFromBuffer(buf, originalName);
    if (columns.length === 0 || rows.length === 0) {
      return res.status(400).json({ error: "no data rows parsed from file" });
    }
    const slotDir = join(BI_DATASETS_ROOT, slot);
    mkdirSync(slotDir, { recursive: true });
    const storedName = `${Date.now()}_${randomUUID()}${ext}`;
    const storagePath = join(slotDir, storedName);
    writeFileSync(storagePath, buf);
    const detail = insertBiDataset({
      slot,
      filename: originalName,
      storagePath,
      columns,
      rows,
      sizeBytes: buf.byteLength,
    });
    res.json({ success: true, dataset: detail });
  } catch (err) {
    res.status(400).json({ error: String((err as Error)?.message ?? err) });
  }
});

app.get("/api/bi-datasets", (req, res) => {
  const slotRaw = req.query.slot;
  let slot: BiDatasetSlot | undefined;
  if (slotRaw !== undefined) {
    const parsed = parseBiSlot(slotRaw);
    if (!parsed) return res.status(400).json({ error: "invalid slot" });
    slot = parsed;
  }
  res.json(listBiDatasets(slot));
});

app.get("/api/bi-datasets/active", (req, res) => {
  const slot = parseBiSlot(req.query.slot);
  if (!slot) return res.status(400).json({ error: "missing or invalid slot" });
  const detail = getActiveBiDataset(slot);
  if (!detail) return res.status(404).json({ error: "no active dataset for slot" });
  res.json(detail);
});

app.get("/api/bi-datasets/:id", (req, res) => {
  const detail = getBiDatasetById(String(req.params.id ?? ""));
  if (!detail) return res.status(404).json({ error: "dataset not found" });
  res.json(detail);
});

app.post("/api/bi-datasets/:id/activate", (req, res) => {
  const id = String(req.params.id ?? "");
  const slot = parseBiSlot(req.body?.slot);
  if (!slot) return res.status(400).json({ error: "missing or invalid slot" });
  const ok = setActiveBiDataset(slot, id);
  if (!ok) return res.status(404).json({ error: "dataset not found or slot mismatch" });
  res.json({ success: true });
});

app.delete("/api/bi-datasets/:id", (req, res) => {
  const id = String(req.params.id ?? "");
  const { deleted, storagePath } = deleteBiDataset(id);
  if (!deleted) return res.status(404).json({ error: "dataset not found" });
  if (storagePath) {
    try { rmSync(storagePath); } catch { /* ignore */ }
  }
  res.json({ success: true });
});

// ---- Report History (Dashboard 二级 tab) ----
app.get("/api/reports/scan", (_req, res) => {
  try {
    const workspaces = listWorkspaces().map((w) => ({ id: w.id, name: w.name }));
    const entries = scanAllReports(workspaces);
    const favoriteIds = new Set(listReportFavoriteIds());
    const tagsMap = listTagsForReports();
    const enriched = entries.map((e) => ({
      ...e,
      isFavorite: favoriteIds.has(e.id),
      tags: tagsMap.get(e.id) ?? [],
    }));
    enriched.sort((a, b) => b.createdAt - a.createdAt);
    res.json({ entries: enriched, scannedAt: Date.now() });
  } catch (err) {
    res.status(500).json({ error: String((err as Error)?.message ?? err) });
  }
});

app.post("/api/reports/favorite", (req, res) => {
  const id = String(req.body?.id ?? "").trim();
  if (!id) return res.status(400).json({ error: "missing id" });
  addReportFavorite(id);
  res.json({ success: true });
});

app.delete("/api/reports/favorite/:id", (req, res) => {
  const id = String(req.params.id ?? "").trim();
  if (!id) return res.status(400).json({ error: "missing id" });
  const ok = removeReportFavorite(id);
  if (!ok) return res.status(404).json({ error: "favorite not found" });
  res.json({ success: true });
});

app.get("/api/reports/file", (req, res) => {
  const path = String(req.query.path ?? "");
  if (!path) return res.status(400).json({ error: "missing path" });
  // 安全校验: 必须在 WORKSPACES_ROOT 下
  const abs = resolve(path);
  if (!abs.startsWith(WORKSPACES_ROOT + sep)) {
    return res.status(403).json({ error: "path outside workspaces root" });
  }
  if (!existsSync(abs)) return res.status(404).json({ error: "file not found" });
  try {
    const content = readFileSync(abs, "utf-8");
    res.type("text/plain; charset=utf-8").send(content);
  } catch (err) {
    res.status(500).json({ error: String((err as Error)?.message ?? err) });
  }
});

app.post("/api/reports/open", (req, res) => {
  const path = String(req.body?.path ?? "");
  if (!path) return res.status(400).json({ error: "missing path" });
  if (process.platform !== "darwin") {
    return res.status(400).json({ error: "open in Finder only supported on macOS" });
  }
  const abs = resolve(path);
  if (!abs.startsWith(WORKSPACES_ROOT + sep)) {
    return res.status(403).json({ error: "path outside workspaces root" });
  }
  if (!existsSync(abs)) return res.status(404).json({ error: "file not found" });
  try {
    execFile("open", ["-R", abs], (err) => {
      if (err) return res.status(500).json({ error: String(err.message) });
      res.json({ success: true });
    });
  } catch (err) {
    res.status(500).json({ error: String((err as Error)?.message ?? err) });
  }
});

// ---- Report Tags ----
app.get("/api/reports/tags", (_req, res) => {
  try {
    res.json(listAllReportTags());
  } catch (err) {
    res.status(500).json({ error: String((err as Error)?.message ?? err) });
  }
});

app.post("/api/reports/:id/tags", (req, res) => {
  const id = String(req.params.id ?? "").trim();
  const tag = String(req.body?.tag ?? "").trim();
  if (!id) return res.status(400).json({ error: "missing id" });
  if (!tag) return res.status(400).json({ error: "missing tag" });
  if (tag.length > 32) return res.status(400).json({ error: "tag too long (max 32 chars)" });
  try {
    addReportTag(id, tag);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: String((err as Error)?.message ?? err) });
  }
});

app.delete("/api/reports/:id/tags/:tag", (req, res) => {
  const id = String(req.params.id ?? "").trim();
  const tag = decodeURIComponent(String(req.params.tag ?? "")).trim();
  if (!id || !tag) return res.status(400).json({ error: "missing id or tag" });
  const ok = removeReportTag(id, tag);
  if (!ok) return res.status(404).json({ error: "tag not found on report" });
  res.json({ success: true });
});

// ---- registered local extraction tools ----
app.get("/api/extraction-tools", (_req, res) => {
  res.json(listExtractionTools());
});

app.get("/api/extraction-tools/:id/test-cases", (req, res) => {
  const tool = getExtractionTool(String(req.params.id ?? ""));
  if (!tool) return res.status(404).json({ error: "extraction tool not found" });
  const casesPath = join(tool.rootPath, "tests", "cases.json");
  if (!existsSync(casesPath)) return res.json({ cases: [] });
  try {
    const raw = JSON.parse(readFileSync(casesPath, "utf8")) as unknown;
    const source = typeof raw === "object" && raw !== null && !Array.isArray(raw)
      ? (raw as Record<string, unknown>).cases
      : raw;
    res.json({ cases: resolveToolEvaluationCasePaths(parseToolEvaluationCases(source), tool.rootPath) });
  } catch (err) {
    res.status(400).json({ error: `invalid test cases: ${String(err)}` });
  }
});

app.post("/api/extraction-tools/:id/run", (req, res) => {
  const tool = getExtractionTool(String(req.params.id ?? ""));
  if (!tool) return res.status(404).json({ error: "extraction tool not found" });
  const inputPath = resolve(String(req.body?.inputPath ?? ""));
  const outputPath = resolve(String(req.body?.outputPath ?? ""));
  const workspaceId = typeof req.body?.workspaceId === "string" ? req.body.workspaceId : undefined;
  // `source` is a provenance marker for AI/MCP-originated calls. Input format
  // validation still happens below; tools are responsible for ensuring their
  // outputs do not include raw row-level draw_data before those outputs reach LLMs.
  const source = req.body?.source === "ai" ? "ai" : "manual";
  try {
    if (!String(req.body?.inputPath ?? "").trim()) throw new Error("inputPath required");
    if (!String(req.body?.outputPath ?? "").trim()) throw new Error("outputPath required");
    validateExtractionInput(tool, inputPath);
    if (!statSync(outputPath).isDirectory()) throw new Error("outputPath must be an existing directory");
  } catch (err) {
    return res.status(400).json({ error: String(err) });
  }
  const runId = randomUUID();
  const runDir = join(EXTRACTION_RUNS_ROOT, runId);
  mkdirSync(runDir, { recursive: true });
  const summaryPath = join(runDir, "summary.json");
  const toolArgs = [tool.entryPath, "--input", inputPath, "--output", outputPath, "--json-summary", summaryPath];

  const paramsObj = typeof req.body?.params === "object" && req.body.params !== null ? req.body.params as Record<string, unknown> : {};
  if (tool.parameters) {
    for (const param of tool.parameters) {
      let val = paramsObj[param.name];
      if (val === undefined || val === "") val = param.default;
      if (param.required && (val === undefined || val === "")) {
        return res.status(400).json({ error: `parameter ${param.name} is required` });
      }
      if (val !== undefined && val !== "") {
        toolArgs.push(`--param-${param.name}`, String(val));
      }
    }
  }

  const startMs = Date.now();
  const child = execFile(
    tool.runtime,
    toolArgs,
    { 
      maxBuffer: 4 * 1024 * 1024,
      timeout: tool.timeoutMs ?? 300_000,
      cwd: outputPath,
      env: buildSanitizedEnv(),
    },
    (err, stdout, stderr) => {
      try {
        const summary = JSON.parse(readFileSync(summaryPath, "utf8")) as {
          success?: number;
          failed?: number;
          error?: string;
          results?: Array<{ outputs?: string[]; [key: string]: unknown }>;
        };
        const normalizedOutputRoot = outputPath.endsWith(sep) ? outputPath : outputPath + sep;
        for (const result of summary.results ?? []) {
          result.outputs = (result.outputs ?? []).filter((path) => {
            const absolute = resolve(path);
            return absolute === outputPath || absolute.startsWith(normalizedOutputRoot);
          });
        }
        const durationMs = Date.now() - startMs;
        if (workspaceId) {
          addTraceEvent({
            workspaceId,
            targetKind: "extraction_tool",
            targetId: tool.id,
            type: "tool_run",
            target: tool.name,
            status: err ? "failed" : "success",
            detail: `成功 ${summary.success ?? 0} · 失败 ${summary.failed ?? 0} · ${durationMs}ms`,
            payload: { runId, toolId: tool.id, source, inputPath, outputPath, success: summary.success, failed: summary.failed, durationMs },
          });
        }
        res.status(err ? 400 : 200).json({
          runId,
          toolId: tool.id,
          stdout,
          stderr,
          ...summary,
        });
      } catch (summaryError) {
        if (workspaceId) {
          addTraceEvent({
            workspaceId,
            targetKind: "extraction_tool",
            targetId: tool.id,
            type: "tool_run",
            target: tool.name,
            status: "failed",
            detail: String(err ?? summaryError).slice(0, 500),
            payload: { runId, toolId: tool.id, source, inputPath, outputPath },
          });
        }
        res.status(500).json({ error: `extraction failed: ${String(err ?? summaryError)}`, stdout, stderr });
      }
    },
  );
  registerChildProcess(child, {
    kind: "tool",
    command: tool.runtime,
    args: toolArgs,
    cwd: process.cwd(),
    label: tool.id,
    runId,
  });
});

app.get("/api/extraction-tools/preview", (req, res) => {
  const filePath = String(req.query.path ?? "").trim();
  const outputRoot = String(req.query.outputRoot ?? "").trim();
  if (!filePath || !outputRoot) return res.status(400).json({ error: "path and outputRoot required" });
  const abs = resolve(filePath);
  const root = resolve(outputRoot);
  const normalizedRoot = root.endsWith(sep) ? root : root + sep;
  if (abs !== root && !abs.startsWith(normalizedRoot)) {
    return res.status(403).json({ error: "path outside output root" });
  }
  try {
    const stat = statSync(abs);
    if (!stat.isFile()) return res.status(400).json({ error: "not a file" });
    const previewable = TEXT_PREVIEW_EXTENSIONS.has(extname(abs).toLowerCase());
    if (!previewable) return res.json({ name: basename(abs), size: stat.size, previewable: false, truncated: false });
    const content = readFileSync(abs).subarray(0, MAX_PATH_PREVIEW_BYTES).toString("utf8");
    res.json({ name: basename(abs), size: stat.size, previewable: true, truncated: stat.size > MAX_PATH_PREVIEW_BYTES, content });
  } catch (err) {
    res.status(400).json({ error: String(err) });
  }
});

// ---- flow import (webkitdirectory upload) ----
// Each part name carries the original relative path (as posted from the browser).
// We stash files in a tmp dir keyed by a random upload id, then move them into
// the flow's folder root preserving the layout.
const uploadDirs = new Map<string, string>();
const upload = multer({
  limits: { fileSize: 50 * 1024 * 1024 },
  storage: multer.diskStorage({
    destination: (req, _file, cb) => {
      let id = (req as express.Request & { _uploadId?: string })._uploadId;
      if (!id) {
        id = randomUUID();
        (req as express.Request & { _uploadId?: string })._uploadId = id;
        const dir = join(UPLOAD_TMP_ROOT, id);
        uploadDirs.set(id, dir);
        try {
          mkdirSync(dir, { recursive: true });
        } catch {
          // ignore — moveAllFiles will recreate as needed
        }
      }
      cb(null, uploadDirs.get(id)!);
    },
    filename: (_req, _file, cb) => cb(null, randomUUID()),
  }),
});

app.post("/api/flows/:id/import", upload.any(), (req, res) => {
  const flowId = String(req.params.id ?? "");
  const flow = getFlow(flowId);
  if (!flow) return res.status(404).json({ error: "flow not found" });

  const files = (req.files ?? []) as Express.Multer.File[];
  if (files.length === 0) return res.status(400).json({ error: "no files" });

  // The browser sends each file's original `webkitRelativePath` in a parallel
  // text field (`paths[]`). multer with `.any()` collects everything into req.body.
  const paths = req.body?.paths;
  const pathList: string[] = Array.isArray(paths) ? paths.map(String) : paths ? [String(paths)] : [];

  const items = files.map((f, i) => ({
    tmpPath: f.path,
    relPath: pathList[i] ?? f.originalname,
  }));

  // Derive a readable source name from the top-level folder of the first item.
  const firstRel = items[0]?.relPath ?? "";
  const topFolder = firstRel.split(/[\\/]/)[0] ?? "imported";

  const uploadId = (req as express.Request & { _uploadId?: string })._uploadId;
  const tmpRoot = uploadId ? uploadDirs.get(uploadId)! : UPLOAD_TMP_ROOT;
  try {
    moveAllFiles(tmpRoot, flow.folderPath, items);
  } catch (err) {
    return res.status(500).json({ error: String(err) });
  } finally {
    if (uploadId) uploadDirs.delete(uploadId);
  }

  updateFlowSourceName(flow.id, topFolder);
  res.json({ ok: true, sourceName: topFolder, count: items.length });
});

// ---- domain route slots (绞杀者接缝层; legacy 路由仍在本文件) ----
registerDomainRoutes(app);

const server = app.listen(PORT, () => {
  console.log(`[xanthil] gateway listening on http://localhost:${PORT}`);
  const pruned = pruneAllTraceEvents(90);
  if (pruned > 0) console.log(`[xanthil] pruned ${pruned} trace events older than 90 days`);
  // 数据分析 tool-use：回填所有既有工作区的 .mcp.json（ExtractionTool MCP server 注册）
  registerAllWorkspaceMcp();
});

// ---- WebSocket gateway ----
const wss = new WebSocketServer({ server, path: "/ws" });

function send(ws: WebSocket, msg: ServerMessage): void {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
}

interface ActiveChatRun {
  run: PiRun;
  aborted: boolean;
  startedAt: number;
}

interface ActiveMultiAgentRun {
  // A Set (not a single ref) so fan-out nodes — which launch several concurrent
  // pi turns under one node — can all be killed on abort.
  currentRuns: Set<PiRun>;
  aborted: boolean;
  dbRunId: string;
  flowId: string;
  ws: WebSocket;
}

const activeSessionRuns = new Map<string, ActiveChatRun>();
const activeSessionControls = new Set<string>();
const activeFlowRuns = new Map<string, ActiveChatRun>();
const activeMultiAgentRuns = new Map<string, ActiveMultiAgentRun>();

function traceSessionEvent(sessionId: string, type: string, status: string, detail?: string | null, payload?: unknown): void {
  const session = getSession(sessionId);
  if (!session) return;
  addTraceEvent({
    workspaceId: session.workspaceId,
    targetKind: "session",
    targetId: session.id,
    type,
    target: session.title,
    status,
    detail,
    payload,
  });
}

function traceFlowEvent(flowId: string, type: string, status: string, detail?: string | null, payload?: unknown, runId?: string): void {
  const flow = getFlow(flowId);
  if (!flow) return;
  addTraceEvent({
    workspaceId: flow.workspaceId,
    targetKind: runId ? "flow_run" : "flow",
    targetId: runId ?? flow.id,
    type,
    target: flow.name,
    status,
    detail,
    payload,
  });
}

function getActiveChatRun(runs: Map<string, ActiveChatRun>, id: string): ActiveChatRun | undefined {
  const active = runs.get(id);
  if (!active) return undefined;
  if (active.run.isRunning()) return active;
  runs.delete(id);
  return undefined;
}

function abortChatRun(runs: Map<string, ActiveChatRun>, id: string): boolean {
  const active = getActiveChatRun(runs, id);
  if (!active) return false;
  runs.delete(id);
  active.aborted = true;
  active.run.kill();
  return true;
}

function extractFieldDicts(text: string): Array<{ path: string; content: string }> {
  const results: Array<{ path: string; content: string }> = [];
  for (const match of text.matchAll(/```field-dict:([^\n]+)\n([\s\S]+?)```/g)) {
    const path = (match[1] ?? "").trim();
    const content = (match[2] ?? "").trim();
    if (path && content) results.push({ path, content });
  }
  return results;
}

function backfillAnalysisFromMessage(workspacePaths: WorkspacePath[], messageText: string): void {
  const dicts = extractFieldDicts(messageText);
  if (dicts.length === 0) return;
  const pathToHash = new Map(workspacePaths.filter((p) => p.fileHash !== null).map((p) => [p.path, p.fileHash!]));
  for (const { path, content } of dicts) {
    const fileHash = pathToHash.get(path);
    if (fileHash) setFileAnalysis(fileHash, content);
  }
}

// AnaX flywheel: extract validated hypotheses from the archive node's structured
// block and persist them into the workspace hypothesis library.
function backfillHypothesesFromArchive(workspaceId: string, archiveText: string): void {
  const match = archiveText.match(/```anax-hypotheses\s*\n([\s\S]+?)```/);
  if (!match?.[1]) return;
  let parsed: unknown;
  try {
    parsed = JSON.parse(match[1].trim());
  } catch {
    return;
  }
  if (!Array.isArray(parsed)) return;
  const verdicts = new Set(["confirmed", "rejected", "partial"]);
  for (const raw of parsed) {
    const e = (raw ?? {}) as Record<string, unknown>;
    const scene = String(e.scene ?? "").trim();
    const hypothesis = String(e.hypothesis ?? "").trim();
    if (!scene || !hypothesis) continue;
    const verdict = verdicts.has(e.verdict as string) ? (e.verdict as "confirmed" | "rejected" | "partial") : "partial";
    upsertHypothesisFromArchive(
      workspaceId,
      { scene, hypothesis, verdict, evidence: String(e.evidence ?? "").trim(), impact: String(e.impact ?? "").trim() },
    );
  }
}

// AnaX P3 V2: extract actionable recommendations from the recommend node's
// structured block and auto-create draft change proposals in the workspace.
function backfillProposalsFromRecommend(workspaceId: string, runId: string, recommendText: string): void {
  const match = recommendText.match(/```anax-recommendations\s*\n([\s\S]+?)```/);
  if (!match?.[1]) return;
  let parsed: unknown;
  try {
    parsed = JSON.parse(match[1].trim());
  } catch {
    return;
  }
  if (!Array.isArray(parsed)) return;
  for (const raw of parsed) {
    const e = (raw ?? {}) as Record<string, unknown>;
    const title = String(e.title ?? "").trim();
    if (!title) continue;
    createChangeProposal(workspaceId, {
      runId,
      sourceNodeId: "recommend",
      title,
      description: String(e.description ?? "").trim(),
      expectedImpact: String(e.expectedImpact ?? "").trim(),
    });
  }
}

function observeSessionEvent(session: Session, event: PiEvent): void {
  if (event.type === "compaction_start") {
    updateSessionRuntime(session.id, { status: "compacting", lastError: null });
    return;
  }
  if (event.type === "compaction_end") {
    const current = getSessionRuntime(session.id);
    const errorMessage = typeof event.errorMessage === "string" ? event.errorMessage : null;
    updateSessionRuntime(session.id, {
      status: errorMessage ? "error" : "running",
      contextTokens: null,
      contextPercent: null,
      compactCount: current.compactCount + (errorMessage ? 0 : 1),
      lastCompactedAt: errorMessage ? current.lastCompactedAt : Date.now(),
      lastError: errorMessage,
    });
    return;
  }
  if (event.type !== "message_end") return;
  const { message } = event as Extract<PiEvent, { type: "message_end" }>;
  if (!message.usage) return;
  updateSessionRuntime(session.id, {
    status: "running",
    contextTokens: message.usage.totalTokens,
    lastError: message.errorMessage ?? null,
  });
  if (message.role === "assistant") {
    trackSessionWorkspaceUsage({
      workspaceId: session.workspaceId,
      sessionId: session.id,
      title: session.title,
    }, message.usage);
  }
}

function killPiProcessesUnder(rootDir: string): number {
  let killed = 0;
  let pids: string[] = [];
  try {
    pids = execFileSync("pgrep", ["-f", "^pi( |$)"], { encoding: "utf8" })
      .split("\n")
      .map((pid) => pid.trim())
      .filter(Boolean);
  } catch {
    return 0;
  }

  for (const pid of pids) {
    try {
      const openFiles = execFileSync("lsof", ["-p", pid], { encoding: "utf8" });
      if (!openFiles.includes(" cwd ") || !openFiles.includes(rootDir)) continue;
      process.kill(Number(pid), "SIGTERM");
      killed += 1;
    } catch {
      // Process may have exited between pgrep/lsof/kill.
    }
  }
  return killed;
}

wss.on("connection", (ws) => {
  ws.on("message", (raw) => {
    let msg: ClientMessage;
    try {
      msg = JSON.parse(String(raw)) as ClientMessage;
    } catch {
      return send(ws, { type: "error", message: "invalid json" });
    }
    if (msg.type === "send") void handleSend(ws, msg);
    else if (msg.type === "abort") {
      abortChatRun(activeSessionRuns, msg.sessionId);
      updateSessionRuntime(msg.sessionId, { status: "idle", lastError: null });
      traceSessionEvent(msg.sessionId, "run_end", "aborted", "aborted by user", { code: null, aborted: true });
      send(ws, { type: "run_end", sessionId: msg.sessionId, code: null, aborted: true });
    }
    else if (msg.type === "send_flow") void handleSendFlow(ws, msg);
    else if (msg.type === "abort_flow") {
      abortChatRun(activeFlowRuns, msg.flowId);
      traceFlowEvent(msg.flowId, "run_end", "aborted", "aborted by user", { code: null, aborted: true });
      send(ws, { type: "run_end", flowId: msg.flowId, code: null, aborted: true });
    }
    else if (msg.type === "execute_flow") void handleExecuteFlow(ws, msg);
    else if (msg.type === "execute_multi_agent") void handleExecuteMultiAgent(ws, msg);
    else if (msg.type === "execute_anax_precheck") void handleAnaxPrecheck(ws, msg);
    else if (msg.type === "abort_anax_precheck") {
      const active = activePrechecks.get(msg.precheckId);
      if (active) { active.run?.kill(); activePrechecks.delete(msg.precheckId); }
    }
    else if (msg.type === "abort_multi_agent") {
      const active = activeMultiAgentRuns.get(msg.runId);
      const runRow = listFlowRuns(msg.flowId).find((run) => run.id === msg.runId || basename(run.outputDir) === msg.runId);
      const killed = runRow ? killPiProcessesUnder(runRow.outputDir) : 0;
      if (!active || active.flowId !== msg.flowId) {
        if (runRow) finishFlowRun(runRow.id, "aborted");
        traceFlowEvent(msg.flowId, "run_end", "aborted", "aborted by user", { code: null, aborted: true }, msg.runId);
        send(ws, { type: "run_end", flowId: msg.flowId, runId: msg.runId, code: null, aborted: true });
        return;
      }
      active.aborted = true;
      for (const run of active.currentRuns) run.kill();
      finishFlowRun(active.dbRunId, "aborted");
      activeMultiAgentRuns.delete(msg.runId);
      if (killed > 0) {
        traceFlowEvent(msg.flowId, "error", "failed", `forced stopped ${killed} orphan pi process(es)`, { killed }, msg.runId);
        send(active.ws, { type: "error", flowId: msg.flowId, runId: msg.runId, message: `forced stopped ${killed} orphan pi process(es)` });
      }
      traceFlowEvent(msg.flowId, "run_end", "aborted", "aborted by user", { code: null, aborted: true }, msg.runId);
      send(active.ws, { type: "run_end", flowId: msg.flowId, runId: msg.runId, code: null, aborted: true });
    }
  });
});

async function handleSend(
  ws: WebSocket,
  msg: Extract<ClientMessage, { type: "send" }>,
): Promise<void> {
  const session = getSession(msg.sessionId);
  if (!session) return send(ws, { type: "error", sessionId: msg.sessionId, message: "session not found" });
  if (activeSessionControls.has(session.id)) {
    return send(ws, { type: "error", sessionId: session.id, message: "session context maintenance is running; retry after it finishes" });
  }
  if (getActiveChatRun(activeSessionRuns, session.id)) {
    send(ws, { type: "run_start", sessionId: session.id });
    return send(ws, { type: "error", sessionId: session.id, message: "session already has a running turn; stop it before sending another message" });
  }
  const ws_ = getWorkspace(session.workspaceId);
  if (!ws_) return send(ws, { type: "error", sessionId: msg.sessionId, message: "workspace not found" });
  let skillPaths: string[] | undefined;
  try {
    skillPaths = validateSkillPaths(ws_.rootPath, msg.skillPaths);
  } catch (err) {
    return send(ws, { type: "error", sessionId: session.id, message: String(err) });
  }

  const memoryInjection = buildMemoryInjectionSnapshot(session.workspaceId, msg.injectRulesPrompt, "chat");
  recordMemoryInjectionUsage(session.workspaceId, memoryInjection);

  // Persist the user turn immediately (original text, without injected context).
  addMessage(session.id, "user", [{ type: "text", text: msg.text }]);
  updateSessionRuntime(session.id, { status: "running", lastError: null });
  traceSessionEvent(session.id, "run_start", "running", msg.text.slice(0, 240), { model: msg.model, memoryInjection });
  send(ws, { type: "run_start", sessionId: session.id });

  const sessionPaths = listWorkspacePaths(session.workspaceId);
  const sessionAnalyses = getFileAnalysesByPathIds(
    sessionPaths.filter((p) => p.folder === "clean_data" && p.kind === "file").map((p) => p.id),
  );
  const contextPrefix = buildRegisteredPathContext(sessionPaths, {
    workspaceId: session.workspaceId,
    sessionId: session.id,
    fallbackOutputDir: standardDirIn(sessionDir(ws_.rootPath, session.id), "report"),
  }, sessionAnalyses);
  let businessRequirementContext = "";
  try {
    businessRequirementContext = loadBusinessRequirementContextForChat(msg.businessRequirementContext);
  } catch (err) {
    return send(ws, { type: "error", sessionId: session.id, message: String(err) });
  }
  const textForPi = `${contextPrefix}${businessRequirementContext}${msg.text}`;

  const systemPrompt = msg.injectRulesPrompt
    ? withRulesPrompt(session.workspaceId, "chat", session.workflowId ? WORKFLOW_SYSTEM_PROMPTS[session.workflowId] : undefined)
    : session.workflowId ? WORKFLOW_SYSTEM_PROMPTS[session.workflowId] : undefined;

  // Fork 分支：若本 session 是未播种的分支，首轮用 --fork 从父 session 播种历史。
  const forkBranch = getForkBranchByBranchSession(session.id);
  const forkFrom = forkBranch && !forkBranch.seeded ? forkBranch.parentSessionId : undefined;
  if (forkBranch) setForkBranchStatus(session.id, "running");

  const run = runPiTurn({
    workspaceRoot: ws_.rootPath,
    piSessionId: session.id,
    text: textForPi,
    model: msg.model,
    systemPrompt,
    skillPaths,
    forkFrom,
    onEvent: (event: PiEvent) => {
      observeSessionEvent(session, event);
      send(ws, { type: "pi_event", sessionId: session.id, event });
      // Persist completed assistant/tool messages with their usage. The user
      // turn is already persisted at send time, so skip pi's user echo to
      // avoid duplicating it.
      if (event.type === "message_end") {
        const { message: m } = event as Extract<PiEvent, { type: "message_end" }>;
        if (m.role !== "user") addMessage(session.id, m.role, m.content, m.usage ?? null, m.errorMessage ?? null);
        if (m.errorMessage) traceSessionEvent(session.id, "message_error", "failed", m.errorMessage, { role: m.role, stopReason: m.stopReason });
        if (m.role === "assistant" && !m.errorMessage) {
          const text = extractStoredMessageText(m.content);
          if (text) backfillAnalysisFromMessage(sessionPaths, text);
        }
      }
    },
  });
  const active = { run, aborted: false, startedAt: Date.now() };
  activeSessionRuns.set(session.id, active);
  try {
    const code = await run.done;
    updateSessionRuntime(session.id, {
      status: code === 0 || active.aborted ? "idle" : "error",
      lastError: code === 0 || active.aborted ? null : `pi exited with code ${String(code)}`,
    });
    traceSessionEvent(session.id, "run_end", active.aborted ? "aborted" : code === 0 ? "success" : "failed", code === 0 ? null : `pi exited with code ${String(code)}`, { code, aborted: active.aborted });
    send(ws, { type: "run_end", sessionId: session.id, code, aborted: active.aborted });
    if (forkFrom) markForkBranchSeeded(session.id);
    if (forkBranch) setForkBranchStatus(session.id, code === 0 || active.aborted ? "done" : "error");
  } finally {
    if (activeSessionRuns.get(session.id) === active) activeSessionRuns.delete(session.id);
  }
}

async function handleSendFlow(
  ws: WebSocket,
  msg: Extract<ClientMessage, { type: "send_flow" }>,
): Promise<void> {
  const flow = getFlow(msg.flowId);
  if (!flow) return send(ws, { type: "error", flowId: msg.flowId, message: "flow not found" });
  if (getActiveChatRun(activeFlowRuns, flow.id)) {
    send(ws, { type: "run_start", flowId: flow.id });
    return send(ws, { type: "error", flowId: flow.id, message: "flow already has a running turn; stop it before sending another message" });
  }
  let skillPaths: string[] | undefined;
  try {
    skillPaths = validateSkillPaths(flow.folderPath, msg.skillPaths);
  } catch (err) {
    return send(ws, { type: "error", flowId: flow.id, message: String(err) });
  }

  const memoryInjection = buildMemoryInjectionSnapshot(flow.workspaceId, msg.injectRulesPrompt, "workflow");
  recordMemoryInjectionUsage(flow.workspaceId, memoryInjection);

  addFlowMessage(flow.id, "user", [{ type: "text", text: msg.text }]);
  traceFlowEvent(flow.id, "run_start", "running", msg.text.slice(0, 240), { model: msg.model, memoryInjection });
  send(ws, { type: "run_start", flowId: flow.id });
  const flowChatPaths = listWorkspacePaths(flow.workspaceId);
  const flowChatAnalyses = getFileAnalysesByPathIds(
    flowChatPaths.filter((p) => p.folder === "clean_data" && p.kind === "file").map((p) => p.id),
  );
  const contextPrefix = buildRegisteredPathContext(flowChatPaths, {
    workspaceId: flow.workspaceId,
    flowId: flow.id,
    fallbackOutputDir: standardDirIn(flow.folderPath, "report"),
  }, flowChatAnalyses);

  let capturedText = "";
  const run = runPiTurn({
    // pi runs *inside* the flow folder so its file tools see the workflow as cwd.
    workspaceRoot: flow.folderPath,
    piSessionId: flow.id,
    text: `${contextPrefix}${msg.text}`,
    model: msg.model,
    systemPrompt: msg.injectRulesPrompt ? withRulesPrompt(flow.workspaceId, "workflow", msg.systemPrompt) : msg.systemPrompt,
    skillPaths,
    onEvent: (event: PiEvent) => {
      trackUsageEvent({
        workspaceId: flow.workspaceId,
        targetKind: "flow",
        targetId: flow.id,
        title: `工作流聊天：${flow.name}`,
      }, event);
      send(ws, { type: "flow_event", flowId: flow.id, event });
      if (event.type === "message_end") {
        const { message: m } = event as Extract<PiEvent, { type: "message_end" }>;
        if (m.role !== "user") addFlowMessage(flow.id, m.role, m.content, m.usage ?? null);
        if (m.role === "assistant") capturedText += "\n" + flowMessageText(m.content);
        if (m.errorMessage) traceFlowEvent(flow.id, "message_error", "failed", m.errorMessage, { role: m.role, stopReason: m.stopReason });
      }
    },
  });
  const active = { run, aborted: false, startedAt: Date.now() };
  activeFlowRuns.set(flow.id, active);
  try {
    const code = await run.done;
    // 兜底：若 flow 目录仍无合法 workflow.json（pi 写错目录/只在对话给出 JSON），从本轮输出捕获并回填。
    // pi 中途提问停住的情形捕获不到（无 workflow 产出），交由前端 CreationPane 提示用户应答。
    if (code === 0 && !active.aborted && !readWorkflow(flow.folderPath)) {
      try {
        const captured = captureWorkflowFromText(capturedText);
        if (captured) {
          writeFlowFile(flow.folderPath, "workflow.json", JSON.stringify(captured, null, 2));
          traceFlowEvent(flow.id, "workflow_captured", "success", "创建链路：从 pi 输出捕获并回填 workflow.json 到 flow 目录", {});
        }
      } catch (err) {
        traceFlowEvent(flow.id, "workflow_capture_failed", "failed", String(err), {});
      }
    }
    traceFlowEvent(flow.id, "run_end", active.aborted ? "aborted" : code === 0 ? "success" : "failed", code === 0 ? null : `pi exited with code ${String(code)}`, { code, aborted: active.aborted });
    send(ws, { type: "run_end", flowId: flow.id, code, aborted: active.aborted });
  } finally {
    if (activeFlowRuns.get(flow.id) === active) activeFlowRuns.delete(flow.id);
  }
}

async function handleExecuteFlow(
  ws: WebSocket,
  msg: Extract<ClientMessage, { type: "execute_flow" }>,
): Promise<void> {
  const flow = getFlow(msg.flowId);
  if (!flow) return send(ws, { type: "error", flowId: msg.flowId, runId: msg.runId, message: "flow not found" });

  const runsRoot = join(flow.folderPath, "runs");
  const runDir = join(runsRoot, msg.runId);
  mkdirSync(runsRoot, { recursive: true });
  mkdirSync(runDir, { recursive: true });
  copyFlowSnapshot(flow.folderPath, runDir);

  const runRow = createFlowRun(flow.id, { text: msg.text }, runDir);
  const memoryInjection = buildMemoryInjectionSnapshot(flow.workspaceId, msg.injectRulesPrompt, "workflow");
  recordMemoryInjectionUsage(flow.workspaceId, memoryInjection);
  traceFlowEvent(flow.id, "run_start", "running", msg.text.slice(0, 240), { model: msg.model, memoryInjection }, runRow.id);
  send(ws, { type: "run_start", flowId: flow.id, runId: runRow.id });

  const userTask = msg.text.trim();
  const execFlowPaths = listWorkspacePaths(flow.workspaceId);
  const execFlowAnalyses = getFileAnalysesByPathIds(
    execFlowPaths.filter((p) => p.folder === "clean_data" && p.kind === "file").map((p) => p.id),
  );
  const contextPrefix = buildRegisteredPathContext(execFlowPaths, {
    workspaceId: flow.workspaceId,
    flowId: flow.id,
    fallbackOutputDir: runDir,
  }, execFlowAnalyses);
  const workflow = readWorkflow(flow.folderPath);
  try {
    if (workflow) normalizeWorkflowModels(workflow as WorkflowLike);
  } catch (err) {
    finishFlowRun(runRow.id, "failed");
    traceFlowEvent(flow.id, "error", "failed", String(err), { phase: "normalize_workflow_models" }, runRow.id);
    send(ws, { type: "error", flowId: flow.id, runId: runRow.id, message: String(err) });
    traceFlowEvent(flow.id, "run_end", "failed", String(err), { code: null }, runRow.id);
    send(ws, { type: "run_end", flowId: flow.id, runId: runRow.id, code: null });
    return;
  }

  if (workflow && workflow.nodes.length > 0) {
    // Node-by-node execution: all nodes share the same pi session so context accumulates.
    const piSessionId = runRow.id;
    const inputs = { task: userTask, prompt: userTask, query: userTask };
    const systemPrompt = msg.injectRulesPrompt
      ? withRulesPrompt(flow.workspaceId, "workflow", "你是一个单智能体工作流执行者。当前工作目录包含工作流所需的全部文件。请严格按照每步说明完成任务，直接行动，不要中途停下来提问。")
      : "你是一个单智能体工作流执行者。当前工作目录包含工作流所需的全部文件。请严格按照每步说明完成任务，直接行动，不要中途停下来提问。";
    const order = topoOrder(workflow);
    let failed = false;

    for (const node of order) {
      traceFlowEvent(flow.id, "agent_step_start", "running", node.id, { nodeId: node.id, label: node.label }, runRow.id);
      send(ws, { type: "agent_step_start", flowId: flow.id, runId: runRow.id, nodeId: node.id });
      const nodePrompt = renderPrompt(node.prompt || node.label, {}, inputs);
      const run = runPiTurn({
        workspaceRoot: runDir,
        piSessionId,
        text: `${contextPrefix}${nodePrompt}`,
        model: msg.model || node.model || undefined,
        systemPrompt,
        onEvent: (event: PiEvent) => {
          trackUsageEvent({
            workspaceId: flow.workspaceId,
            targetKind: "flow_run",
            targetId: runRow.id,
            title: `单智能体执行：${flow.name}`,
          }, event);
          if (event.type === "message_end") {
            const { message: m } = event as Extract<PiEvent, { type: "message_end" }>;
            if (m.errorMessage) traceFlowEvent(flow.id, "message_error", "failed", m.errorMessage, { role: m.role, stopReason: m.stopReason }, runRow.id);
          }
          send(ws, { type: "flow_run_event", flowId: flow.id, runId: runRow.id, event });
        },
      });
      const code = await run.done;
      traceFlowEvent(flow.id, "agent_step_end", code === 0 ? "success" : "failed", node.id, { nodeId: node.id, code }, runRow.id);
      send(ws, { type: "agent_step_end", flowId: flow.id, runId: runRow.id, nodeId: node.id, code });
      if (code !== 0) { failed = true; break; }
    }

    finishFlowRun(runRow.id, failed ? "failed" : "success");
    traceFlowEvent(flow.id, "run_end", failed ? "failed" : "success", failed ? "one or more agent steps failed" : null, { code: failed ? 1 : 0 }, runRow.id);
    send(ws, { type: "run_end", flowId: flow.id, runId: runRow.id, code: failed ? 1 : 0 });
  } else {
    // No workflow.json: single pi turn.
    const run = runPiTurn({
      workspaceRoot: runDir,
      piSessionId: runRow.id,
      text: `${contextPrefix}${userTask || "run"}`,
      model: msg.model,
      systemPrompt: msg.injectRulesPrompt ? withRulesPrompt(flow.workspaceId, "workflow") : undefined,
      onEvent: (event: PiEvent) => {
        trackUsageEvent({
          workspaceId: flow.workspaceId,
          targetKind: "flow_run",
          targetId: runRow.id,
          title: `工作流执行：${flow.name}`,
        }, event);
        if (event.type === "message_end") {
          const { message: m } = event as Extract<PiEvent, { type: "message_end" }>;
          if (m.errorMessage) traceFlowEvent(flow.id, "message_error", "failed", m.errorMessage, { role: m.role, stopReason: m.stopReason }, runRow.id);
        }
        send(ws, { type: "flow_run_event", flowId: flow.id, runId: runRow.id, event });
      },
    });
    const code = await run.done;
    finishFlowRun(runRow.id, code === 0 ? "success" : "failed");
    traceFlowEvent(flow.id, "run_end", code === 0 ? "success" : "failed", code === 0 ? null : `pi exited with code ${String(code)}`, { code }, runRow.id);
    send(ws, { type: "run_end", flowId: flow.id, runId: runRow.id, code });
  }
}

async function handleExecuteMultiAgent(
  ws: WebSocket,
  msg: Extract<ClientMessage, { type: "execute_multi_agent" }>,
): Promise<void> {
  const flow = getFlow(msg.flowId);
  if (!flow) return send(ws, { type: "error", flowId: msg.flowId, runId: msg.runId, message: "flow not found" });

  const workflow = readWorkflow(flow.folderPath);
  if (!workflow) {
    traceFlowEvent(flow.id, "error", "failed", "workflow.json not found or invalid. Ask pi to generate one first.", { phase: "load_workflow", runId: msg.runId });
    return send(ws, {
      type: "error",
      flowId: flow.id,
      runId: msg.runId,
      message: "workflow.json not found or invalid. Ask pi to generate one first.",
    });
  }

  try {
    normalizeWorkflowModels(workflow as WorkflowLike);
    normalizeWorkflowSkills(flow.folderPath, workflow);
  } catch (err) {
    traceFlowEvent(flow.id, "error", "failed", String(err), { phase: "normalize_workflow_models", runId: msg.runId });
    return send(ws, { type: "error", flowId: flow.id, runId: msg.runId, message: String(err) });
  }

  const runsRoot = join(flow.folderPath, "runs");
  const runDir = join(runsRoot, msg.runId);
  mkdirSync(runsRoot, { recursive: true });
  mkdirSync(runDir, { recursive: true });
  copyFlowSnapshot(flow.folderPath, runDir);

  const runRow = createFlowRun(flow.id, { inputs: msg.inputs ?? {} }, runDir);
  const multiAgentPaths = listWorkspacePaths(flow.workspaceId);
  const multiAgentAnalyses = getFileAnalysesByPathIds(
    multiAgentPaths.filter((p) => p.folder === "clean_data" && p.kind === "file").map((p) => p.id),
  );
  const registeredContext = buildRegisteredPathContext(multiAgentPaths, {
    workspaceId: flow.workspaceId,
    flowId: flow.id,
    fallbackOutputDir: runDir,
  }, multiAgentAnalyses);
  // AnaX runs additionally see the workspace hypothesis library (flywheel read half).
  // Both full (v3.0) and quick (v3.0 Quick) flows participate in the flywheel.
  const isAnaxFlow = flow.sourceName === "AnaX v3.0" || flow.sourceName === "AnaX v3.0 Quick";
  const hypothesisContext = isAnaxFlow ? buildHypothesisLibraryContext(flow.workspaceId, msg.inputs?.task) : "";
  const contextPrefix = hypothesisContext ? `${hypothesisContext}\n\n${registeredContext}` : registeredContext;
  // If resuming from a mid-flow node, pre-populate the blackboard from the
  // previous run's spec deliverables so upstream outputs are available for
  // prompt rendering without re-executing those nodes.
  const initialBlackboard: Record<string, string> = {};
  if (msg.resumeFromNodeId && msg.previousRunId) {
    const prevRun = getFlowRun(msg.previousRunId);
    if (prevRun) {
      const order = topoOrder(workflow);
      const resumeIdx = order.findIndex((n) => n.id === msg.resumeFromNodeId);
      for (const node of order.slice(0, Math.max(0, resumeIdx))) {
        if (node.spec) {
          try {
            initialBlackboard[node.id] = readFileSync(join(prevRun.outputDir, "specs", node.spec), "utf8");
          } catch { /* spec not written yet — skip */ }
        }
      }
    }
  }

  const clientRunId = msg.runId;
  const active: ActiveMultiAgentRun = { currentRuns: new Set(), aborted: false, dbRunId: runRow.id, flowId: flow.id, ws };
  activeMultiAgentRuns.set(clientRunId, active);
  const memoryInjection = buildMemoryInjectionSnapshot(flow.workspaceId, msg.injectRulesPrompt, "workflow");
  recordMemoryInjectionUsage(flow.workspaceId, memoryInjection);
  traceFlowEvent(flow.id, "run_start", "running", "multi-agent execution", { model: msg.model, inputs: msg.inputs, memoryInjection, resumeFromNodeId: msg.resumeFromNodeId }, runRow.id);
  send(ws, { type: "run_start", flowId: flow.id, runId: clientRunId });

  try {
    const result = await runMultiAgent(workflow, {
      flowRoot: flow.folderPath,
      runId: runRow.id,
      runDir,
      inputs: msg.inputs,
      defaultModel: msg.model,
      contextPrefix,
      systemPromptPrefix: msg.injectRulesPrompt ? (buildMemoryPrompt(flow.workspaceId, "workflow") || undefined) : undefined,
      onStepStart: (nodeId) => {
        traceFlowEvent(flow.id, "agent_step_start", "running", nodeId, { nodeId }, runRow.id);
        send(ws, { type: "agent_step_start", flowId: flow.id, runId: clientRunId, nodeId });
      },
      onStepRun: (_nodeId, run) => {
        active.currentRuns.add(run);
        void run.done.finally(() => active.currentRuns.delete(run));
      },
      onStepEvent: (nodeId, event) => {
        trackUsageEvent({
          workspaceId: flow.workspaceId,
          targetKind: "flow_run",
          targetId: runRow.id,
          title: `多智能体执行：${flow.name}`,
        }, event);
        if (event.type === "message_end") {
          const { message: m } = event as Extract<PiEvent, { type: "message_end" }>;
          if (m.errorMessage) traceFlowEvent(flow.id, "message_error", "failed", m.errorMessage, { nodeId, role: m.role, stopReason: m.stopReason }, runRow.id);
        }
        send(ws, { type: "agent_event", flowId: flow.id, runId: clientRunId, nodeId, event });
      },
      onStepEnd: (nodeId, code) => {
        traceFlowEvent(flow.id, "agent_step_end", code === 0 ? "success" : "failed", nodeId, { nodeId, code }, runRow.id);
        send(ws, { type: "agent_step_end", flowId: flow.id, runId: clientRunId, nodeId, code });
      },
      onBlackboardUpdate: (key, value) => {
        traceFlowEvent(flow.id, "blackboard_update", "success", key, { key, value: value.slice(0, 1000) }, runRow.id);
        send(ws, { type: "blackboard_update", flowId: flow.id, runId: clientRunId, key, value });
        // AnaX flywheel write half: archive node emits validated hypotheses → library.
        if (isAnaxFlow && key === "archive") backfillHypothesesFromArchive(flow.workspaceId, value);
        // AnaX P3 V2: recommend node emits actionable recommendations → change proposals.
        if (isAnaxFlow && key === "recommend") backfillProposalsFromRecommend(flow.workspaceId, runRow.id, value);
      },
      onStepGate: (nodeId, verdict) => {
        traceFlowEvent(flow.id, "agent_gate", verdict.verdict === "pass" ? "success" : "failed", nodeId, { nodeId, verdict }, runRow.id);
        send(ws, { type: "agent_gate", flowId: flow.id, runId: clientRunId, nodeId, verdict });
      },
      isAborted: () => active.aborted,
      initialBlackboard,
      resumeFromNodeId: msg.resumeFromNodeId,
      gateThresholds: isAnaxFlow ? (() => { const c = getAnaxGateConfig(flow.workspaceId); return { minConfidence: c.minConfidence, minEvidenceCount: c.minEvidenceCount, minDataQualityScore: c.minDataQualityScore }; })() : undefined,
    });
    if (activeMultiAgentRuns.get(clientRunId) === active) activeMultiAgentRuns.delete(clientRunId);
    finishFlowRun(runRow.id, active.aborted ? "aborted" : result.code === 0 ? "success" : "failed");
    traceFlowEvent(flow.id, "run_end", active.aborted ? "aborted" : result.code === 0 ? "success" : "failed", result.code === 0 ? null : `multi-agent exited with code ${String(result.code)}`, { code: result.code, aborted: active.aborted }, runRow.id);
    send(ws, { type: "run_end", flowId: flow.id, runId: clientRunId, code: result.code, aborted: active.aborted });
  } catch (err) {
    if (activeMultiAgentRuns.get(clientRunId) === active) activeMultiAgentRuns.delete(clientRunId);
    finishFlowRun(runRow.id, active.aborted ? "aborted" : "failed");
    traceFlowEvent(flow.id, "error", "failed", String(err), { phase: "multi_agent" }, runRow.id);
    send(ws, { type: "error", flowId: flow.id, runId: clientRunId, message: String(err) });
    traceFlowEvent(flow.id, "run_end", active.aborted ? "aborted" : "failed", String(err), { code: null, aborted: active.aborted }, runRow.id);
    send(ws, { type: "run_end", flowId: flow.id, runId: clientRunId, code: null, aborted: active.aborted });
  }
}

// ---- AnaX data quality precheck ----

const PRECHECK_PROMPT = [
  "你是数据质量快速评估官。请快速评估以下聚合数据文件是否具备 AnaX 商业分析的就绪条件。",
  "",
  "本次分析指定的聚合数据文件：",
  "{{DATA_FILES}}",
  "",
  "重要：只能读取和评估已登记的聚合(clean_data)文件，禁止读取原始明细数据。",
  "请用 Read 工具逐一读取上述文件，然后完成以下评估：",
  "",
  "1. 对每个文件给出 6 维度评分：完整性(25%) / 准确性(25%) / 时效性(20%) / 一致性(15%) / 有效性(10%) / 唯一性(5%)。",
  "2. 计算加权综合评分（0-10），**必须在输出中包含一行 `综合评分: X.X/10`**。",
  "3. 给出是否能通过 AnaX 数据门禁（阈值 ≥ 7）的预判，以及关键风险项（如有）。",
  "4. 给出 1-2 句改善建议（若评分 < 9）。",
  "输出保持简洁，重点突出评分和预判。",
].join("\n");

interface ActivePrecheck {
  run: ReturnType<typeof runPiTurn> | null;
}
const activePrechecks = new Map<string, ActivePrecheck>();

async function handleAnaxPrecheck(
  ws: WebSocket,
  msg: Extract<ClientMessage, { type: "execute_anax_precheck" }>,
): Promise<void> {
  const { precheckId, workspaceId, data_files, model } = msg;

  const paths = listWorkspacePaths(workspaceId);
  const analyses = getFileAnalysesByPathIds(
    paths.filter((p) => p.folder === "clean_data" && p.kind === "file").map((p) => p.id),
  );
  const contextPrefix = buildRegisteredPathContext(paths, { workspaceId, fallbackOutputDir: tmpdir() }, analyses);
  const prompt = PRECHECK_PROMPT.replace("{{DATA_FILES}}", data_files || "（未指定）");

  const sessionDir = join(tmpdir(), `pi-xanthil-precheck-${precheckId}`);
  mkdirSync(sessionDir, { recursive: true });

  const active: ActivePrecheck = { run: null };
  activePrechecks.set(precheckId, active);

  let assistantText = "";
  try {
    const run = runPiTurn({
      workspaceRoot: sessionDir,
      piSessionId: `precheck-${precheckId}`,
      text: `${contextPrefix}${prompt}`,
      model: model || undefined,
      onEvent: (event: PiEvent) => {
        send(ws, { type: "anax_precheck_event", precheckId, event });
        if (event.type === "message_end") {
          const m = (event as { message?: { role?: string; content?: unknown } }).message;
          if (m?.role === "assistant") {
            const parts = Array.isArray(m.content)
              ? (m.content as Array<{ type?: string; text?: string }>)
                  .filter((b) => b.type === "text")
                  .map((b) => b.text ?? "")
                  .join("\n")
                  .trim()
              : "";
            if (parts) assistantText = parts;
          }
        }
      },
    });
    active.run = run;
    await run.done;
  } catch (err) {
    activePrechecks.delete(precheckId);
    send(ws, { type: "anax_precheck_error", precheckId, message: String(err) });
    return;
  }

  activePrechecks.delete(precheckId);

  const scoreMatch = assistantText.match(/综合评分[：:]\s*(\d+(?:\.\d+)?)/);
  const score = scoreMatch?.[1] != null ? parseFloat(scoreMatch[1]) : null;
  const pass = score !== null && score >= 7;

  // Extract a one-line summary (first line that mentions 门禁/预判/pass/fail or first non-empty line).
  const summaryLine = assistantText
    .split("\n")
    .map((l) => l.trim())
    .find((l) => l.length > 10 && /门禁|预判|通过|阻断|建议|评分|风险/.test(l))
    ?? assistantText.split("\n").find((l) => l.trim().length > 10)
    ?? "";

  send(ws, { type: "anax_precheck_done", precheckId, score, pass, summary: summaryLine });
}

// ---- Knowledge Graph API ----

app.get("/api/workspaces/:id/kg/edges", (req, res) => {
  const ws = getWorkspace(req.params.id);
  if (!ws) return res.status(404).json({ error: "workspace not found" });
  res.json(listKgEdges(ws.id));
});

app.post("/api/workspaces/:id/kg/sync", (req, res) => {
  const ws = getWorkspace(req.params.id);
  if (!ws) return res.status(404).json({ error: "workspace not found" });
  try {
    const result = syncKnowledgeGraph(ws.id);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

app.post("/api/workspaces/:id/kg/extract", (req, res) => {
  const ws = getWorkspace(req.params.id);
  if (!ws) return res.status(404).json({ error: "workspace not found" });
  const model = typeof req.body?.model === "string" && req.body.model.trim() ? req.body.model.trim() : undefined;
  extractKgEntitiesFromReports(ws.id, model)
    .then((result) => res.json(result))
    .catch((err: unknown) => res.status(500).json({ error: String(err) }));
});

app.get("/api/workspaces/:id/kg/nodes", (req, res) => {
  const ws = getWorkspace(req.params.id);
  if (!ws) return res.status(404).json({ error: "workspace not found" });
  const includeHidden = req.query.includeHidden === "true";
  res.json(listKgNodes(ws.id, includeHidden));
});

app.patch("/api/kg/nodes/:id", (req, res) => {
  const { hidden } = req.body as { hidden?: boolean };
  if (typeof hidden !== "boolean") return res.status(400).json({ error: "hidden (boolean) required" });
  const ok = setKgNodeHidden(req.params.id, hidden);
  if (!ok) return res.status(404).json({ error: "node not found" });
  res.json({ ok: true });
});

app.post("/api/workspaces/:id/kg/edges", (req, res) => {
  const ws = getWorkspace(req.params.id);
  if (!ws) return res.status(404).json({ error: "workspace not found" });
  const { fromId, toId, relation } = req.body as { fromId?: string; toId?: string; relation?: string };
  if (!fromId || !toId || !relation) return res.status(400).json({ error: "fromId, toId, relation required" });
  const validRelations = ["related_to", "references", "supports", "derived_from"];
  if (!validRelations.includes(relation)) return res.status(400).json({ error: "invalid relation" });
  const edge = insertManualKgEdge(ws.id, fromId, toId, relation as import("./types.ts").KgRelation);
  res.json(edge);
});

app.delete("/api/kg/edges/:id", (req, res) => {
  const ok = deleteKgEdge(req.params.id);
  if (!ok) return res.status(404).json({ error: "edge not found" });
  res.json({ ok: true });
});

app.get("/api/workspaces/:id/kg-prompt", (req, res) => {
  const ws = getWorkspace(req.params.id);
  if (!ws) return res.status(404).json({ error: "workspace not found" });
  const { prompt, reportCount, edgeCount, updatedAt } = buildKgPrompt(ws.id);
  res.json({ prompt, count: reportCount + edgeCount, reportCount, edgeCount, updatedAt });
});
// reload-trigger-antigravity-v2
