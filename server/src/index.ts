import { existsSync, mkdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { execFile, execFileSync } from "node:child_process";
import { homedir } from "node:os";
import { basename, extname, join, resolve, sep } from "node:path";
import { randomUUID } from "node:crypto";
import express from "express";
import cors from "cors";
import multer from "multer";
import { WebSocketServer, type WebSocket } from "ws";
import { EXTRACTION_RUNS_ROOT, FAVORITES_ROOT, PORT, UPLOAD_TMP_ROOT, ensureDirs } from "./config.ts";
import {
  addFlowMessage,
  addMessage,
  addTraceEvent,
  addWorkspacePath,
  buildEnabledRulesPrompt,
  buildEnabledStandardsPrompt,
  listAnalysisStandards,
  createAnalysisStandard,
  updateAnalysisStandard,
  updateAnalysisStandardEnabled,
  deleteAnalysisStandard,
  createFlow,
  createFlowRun,
  createRuleMemory,
  createSession,
  createWorkflowFavorite,
  createWorkflowEvaluation,
  createWorkspace,
  deleteFlow,
  deleteRuleMemory,
  deleteSession,
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
  getWorkspace,
  getWorkspacePath,
  listFlowMessages,
  listFlowRuns,
  listFlows,
  listMessages,
  listRuleMemories,
  getTraceOverview,
  getTraceTimeline,
  getTraceTrend,
  generateTraceRuleSuggestions,
  listTraceFailures,
  listTraceRecentEvents,
  listSessions,
  listWorkflowFavorites,
  listWorkflowEvaluations,
  listWorkspacePaths,
  listWorkspaces,
  removeWorkspacePath,
  removeWorkflowFavorite,
  renameFlow,
  renameSession,
  renameWorkspace,
  setFileAnalysis,
  updateFlowGeneration,
  updateFlowSourceName,
  updateSessionRuntime,
  updateWorkflowFavorite,
  updateRuleMemory,
  updateRuleMemoryEnabled,
  updateRuleMemoriesEnabled,
  updateWorkspacePathHash,
} from "./db.ts";
import { computeFileHash } from "./file-hash.ts";
import { runWorkflowEvaluation } from "./evaluation-runner.ts";
import { copyFlowSnapshot, copyLocalFolderIntoFlow, inferWorkflow, moveAllFiles, readFlowFile, readTree, safeResolve, writeFlowFile } from "./flow-fs.ts";
import { compactPiSession, getPiSessionStats, runPiPrompt, runPiTurn, type PiRun } from "./pi-adapter.ts";
import { readWorkflow, renderPrompt, runMultiAgent, topoOrder } from "./multi-agent-runner.ts";
import { buildRegisteredPathContext, resolveOutputTarget } from "./output-paths.ts";
import { listSkills, validateSkillPaths } from "./skills.ts";
import { getSessionTokenStats, getWorkspaceTokenStats, trackSessionUsage } from "./cache.ts";
import { listRawSessionTokenStatsWithTitles } from "./db.ts";
import type { ClientMessage, DecisionTreeNode, PiEvent, ServerMessage, WorkspacePath } from "./types.ts";
import type { EvaluationFlowConfig } from "./types.ts";
import { getExtractionTool, listExtractionTools, validateExtractionInput } from "../tools/registry.ts";

ensureDirs();

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

// Combined "记忆/标准" injection: enabled rules + enabled analysis standards.
// Both ride the same injectRulesPrompt toggle.
function buildMemoryPrompt(workspaceId: string, targetScope?: "chat" | "workflow"): string {
  return [buildEnabledRulesPrompt(workspaceId, targetScope).prompt, buildEnabledStandardsPrompt(workspaceId).prompt]
    .filter(Boolean)
    .join("\n\n");
}

type MemoryInjectionAudit = {
  requested: boolean;
  rulesCount: number;
  rulesUpdatedAt: number | null;
  standardsCount: number;
  standardsUpdatedAt: number | null;
  injected: boolean;
};

function getMemoryInjectionAudit(workspaceId: string, requested: boolean | undefined, targetScope: "chat" | "workflow"): MemoryInjectionAudit {
  if (!requested) return { requested: false, rulesCount: 0, rulesUpdatedAt: null, standardsCount: 0, standardsUpdatedAt: null, injected: false };
  const rules = buildEnabledRulesPrompt(workspaceId, targetScope);
  const standards = buildEnabledStandardsPrompt(workspaceId);
  return {
    requested: true,
    rulesCount: rules.count,
    rulesUpdatedAt: rules.updatedAt,
    standardsCount: standards.count,
    standardsUpdatedAt: standards.updatedAt,
    injected: rules.count + standards.count > 0,
  };
}

function withRulesPrompt(workspaceId: string, targetScope: "chat" | "workflow", systemPrompt?: string): string | undefined {
  const memoryPrompt = buildMemoryPrompt(workspaceId, targetScope);
  if (!memoryPrompt) return systemPrompt;
  return [memoryPrompt, systemPrompt].filter(Boolean).join("\n\n");
}

const app = express();
app.use(cors());
app.use(express.json({ limit: "8mb" }));

const DEFAULT_DECISION_TREE_MODEL = "minimax-cn/MiniMax-M3";

type WorkflowLike = {
  defaultModel?: unknown;
  nodes?: Array<{ id?: unknown; model?: unknown }>;
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

async function repairJsonObject(rawOutput: string, schemaHint: string, workspaceRoot: string, model: string, sourceContext?: string): Promise<unknown> {
  const repaired = await runPiPrompt({
    workspaceRoot,
    model,
    systemPrompt: "你是 JSON 修复器。只输出严格 JSON，不要解释。",
    text: `请把下面模型输出改写为符合 schema 的严格 JSON。如果原输出没有足够信息，请结合来源内容重新分析并生成保守版本。\n每个 body 必须填写基于来源内容的具体说明，禁止返回空字符串、"..."、"…"、"待补充"、schema 示例文本或其他占位文本。\n\nschema：\n${schemaHint}\n\n原输出：\n${rawOutput.slice(0, 8000)}${sourceContext ? `\n\n来源内容：\n${sourceContext.slice(0, 30_000)}` : ""}`,
    timeoutMs: 120_000,
  });
  return extractJsonObject(repaired);
}

function buildTocPrompt(reportName: string, content: string): string {
  return `你是 TOC（Theory of Constraints，高德拉特约束理论）业务诊断专家。请基于报告内容，推理生成一张业务约束推理图。\n\n要求：\n1. 不要做普通目录，不要复述全文。\n2. 找出业务目标、症状/UDE、当前主约束、根因链、TOC五步法动作、监控指标。\n3. 节点必须形成从 goal 到 monitor 的因果/行动链。\n4. 输出严格 JSON，不要 Markdown，不要解释。\n5. 每个 body 必须填写基于报告的具体分析，禁止输出空字符串、"..."、"…"、"待补充"或其他占位文本。\n6. JSON 格式：{\"nodes\":[{\"id\":\"goal\",\"title\":\"业务目标\",\"body\":\"具体业务目标\",\"kind\":\"goal\"},{\"id\":\"symptom_1\",\"title\":\"症状/UDE 1\",\"body\":\"具体症状说明\",\"kind\":\"symptom\",\"parentId\":\"goal\"},{\"id\":\"constraint\",\"title\":\"当前主约束\",\"body\":\"具体约束说明\",\"kind\":\"constraint\",\"parentId\":\"symptom_1\"},{\"id\":\"cause_1\",\"title\":\"根因链 1\",\"body\":\"具体根因说明\",\"kind\":\"root_cause\",\"parentId\":\"constraint\"},{\"id\":\"step_1\",\"title\":\"1 识别约束\",\"body\":\"具体动作说明\",\"kind\":\"action\",\"parentId\":\"cause_1\"},{\"id\":\"step_2\",\"title\":\"2 充分利用约束\",\"body\":\"具体动作说明\",\"kind\":\"action\",\"parentId\":\"step_1\"},{\"id\":\"step_3\",\"title\":\"3 其他环节服从约束\",\"body\":\"具体动作说明\",\"kind\":\"action\",\"parentId\":\"step_2\"},{\"id\":\"step_4\",\"title\":\"4 提升约束能力\",\"body\":\"具体动作说明\",\"kind\":\"action\",\"parentId\":\"step_3\"},{\"id\":\"step_5\",\"title\":\"5 重新寻找新约束\",\"body\":\"具体动作说明\",\"kind\":\"action\",\"parentId\":\"step_4\"},{\"id\":\"monitor\",\"title\":\"监控指标\",\"body\":\"具体监控指标\",\"kind\":\"monitor\",\"parentId\":\"step_5\"}]}\n\n报告名：${reportName}\n\n报告内容：\n${sanitizeReportForLlm(content).slice(0, 30000)}`;
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
    const response = await runPiPrompt({
      workspaceRoot: workspace?.rootPath ?? process.cwd(),
      model: resolvedModel || undefined,
      systemPrompt: "你是 TOC 约束理论业务诊断专家，只输出符合用户 schema 的 JSON。",
      text: buildTocPrompt(reportName, content),
      timeoutMs: 180_000,
    });
    let graph: TocGraphItem[];
    try {
      graph = validateTocGraph(extractJsonObject(response));
    } catch {
      const repaired = await repairJsonObject(response, "{\"nodes\":[{\"id\":\"goal\",\"title\":\"业务目标\",\"body\":\"根据原输出填写具体业务目标\",\"kind\":\"goal\"},{\"id\":\"constraint\",\"title\":\"当前主约束\",\"body\":\"根据原输出填写具体约束说明\",\"kind\":\"constraint\",\"parentId\":\"goal\"},{\"id\":\"monitor\",\"title\":\"监控指标\",\"body\":\"根据原输出填写具体监控指标\",\"kind\":\"monitor\",\"parentId\":\"constraint\"}]}", workspace?.rootPath ?? process.cwd(), resolvedModel || requestedModel, sanitizeReportForLlm(content));
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

// ---- REST: workspaces ----
app.get("/api/workspaces", (_req, res) => res.json(listWorkspaces()));
app.post("/api/workspaces", (req, res) => {
  const name = String(req.body?.name ?? "").trim();
  if (!name) return res.status(400).json({ error: "name required" });
  res.json(createWorkspace(name));
});

app.patch("/api/workspaces/:id", (req, res) => {
  if (!getWorkspace(req.params.id)) return res.status(404).json({ error: "workspace not found" });
  const name = String(req.body?.name ?? "").trim();
  if (!name) return res.status(400).json({ error: "name required" });
  renameWorkspace(req.params.id, name);
  res.json({ ok: true });
});
app.delete("/api/workspaces/:id", (req, res) => {
  if (!getWorkspace(req.params.id)) return res.status(404).json({ error: "workspace not found" });
  deleteWorkspace(req.params.id);
  res.json({ ok: true });
});

// ---- REST: sessions ----
app.get("/api/workspaces/:id/sessions", (req, res) => {
  if (!getWorkspace(req.params.id)) return res.status(404).json({ error: "workspace not found" });
  res.json(listSessions(req.params.id));
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
  if (!getSession(req.params.id)) return res.status(404).json({ error: "session not found" });
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
  if (typeof req.body?.enabled === "boolean") {
    updateRuleMemoryEnabled(req.params.id, req.body.enabled);
    return res.json({ ok: true });
  }
  const title = String(req.body?.title ?? "").trim();
  const evidence = String(req.body?.evidence ?? "").trim();
  const severity = ["low", "medium", "high"].includes(String(req.body?.severity)) ? String(req.body.severity) as "low" | "medium" | "high" : "medium";
  const scope = ["global", "chat", "workflow"].includes(String(req.body?.scope)) ? String(req.body.scope) as "global" | "chat" | "workflow" : "global";
  if (!title) return res.status(400).json({ error: "title required" });
  updateRuleMemory({ id: req.params.id, title, evidence, severity, scope });
  res.json({ ok: true });
});

app.patch("/api/workspaces/:id/rules", (req, res) => {
  if (!getWorkspace(req.params.id)) return res.status(404).json({ error: "workspace not found" });
  const ids = Array.isArray(req.body?.ids) ? req.body.ids.filter((id: unknown): id is string => typeof id === "string" && id.trim().length > 0) : [];
  if (ids.length === 0) return res.status(400).json({ error: "ids required" });
  updateRuleMemoriesEnabled(ids, Boolean(req.body?.enabled));
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
  if (typeof req.body?.enabled === "boolean" && Object.keys(req.body).length === 1) {
    updateAnalysisStandardEnabled(req.params.id, req.body.enabled);
    return res.json({ ok: true });
  }
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

app.get("/api/workspaces/:id/token-stats-by-session", (req, res) => {
  if (!getWorkspace(req.params.id)) return res.status(404).json({ error: "workspace not found" });
  const rows = listRawSessionTokenStatsWithTitles(req.params.id);
  res.json(rows.map((r) => ({
    ...r,
    cacheHitRate: r.inputTokens + r.cacheReadTokens + r.cacheWriteTokens > 0
      ? r.cacheReadTokens / (r.inputTokens + r.cacheReadTokens + r.cacheWriteTokens)
      : 0,
  })));
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
    fallbackOutputDir: workspace.rootPath,
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
    fallbackOutputDir: workspace.rootPath,
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

function readArtifactTree(rootPath: string): ReturnType<typeof readTree> {
  const filter = (node: ReturnType<typeof readTree>): ReturnType<typeof readTree> => ({
    ...node,
    children: node.children
      ?.filter((child) => !child.name.startsWith(".") && child.name !== "flows")
      .map((child) => filter(child)),
  });
  return filter(readTree(rootPath));
}

function validateArtifactPath(path: string, source: string): void {
  const segments = path.split(/[\\/]/).filter(Boolean);
  if (segments.some((segment) => segment.startsWith("."))) throw new Error("hidden artifact paths are not accessible");
  if (source === "当前工作目录 fallback" && segments[0] === "flows") throw new Error("internal workflow paths are not accessible");
}

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

async function generateDecisionTreeWithLlm(reportName: string, reportContent: string, workspaceRoot: string, model: string): Promise<DecisionTreeNode[]> {
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
  });
  let nodes: DecisionTreeNode[];
  try {
    nodes = validateDecisionTreeResult(parseJsonObject(output));
  } catch {
    const repaired = await repairJsonObject(output, "{\"nodes\":[{\"id\":\"root\",\"title\":\"报告输入\",\"body\":\"根据原输出填写具体报告摘要\",\"kind\":\"root\"},{\"id\":\"factor-1\",\"title\":\"推理因子 1\",\"body\":\"根据原输出填写具体推理因子\",\"kind\":\"factor\",\"parentId\":\"root\"},{\"id\":\"evidence-1-1\",\"title\":\"依据 1\",\"body\":\"根据原输出填写具体证据依据\",\"kind\":\"evidence\",\"parentId\":\"factor-1\"},{\"id\":\"conclusion\",\"title\":\"决策结论建议\",\"body\":\"根据原输出填写具体决策建议\",\"kind\":\"conclusion\",\"parentId\":\"factor-1\"}]}", workspaceRoot, model, sanitizeReportForLlm(reportContent));
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
        fallbackOutputDir: workspace.rootPath,
      });
      validateArtifactPath(path, target.source);
      const report = readFlowFile(target.outputDir, path).content;
      const nodes = await generateDecisionTreeWithLlm(basename(path), report, workspace.rootPath, model);
      return res.json({ nodes, model });
    }
    if (source === "flow-run") {
      const flow = getFlow(String(req.body?.flowId ?? ""));
      if (!flow) return res.status(404).json({ error: "flow not found" });
      const run = getFlowRun(String(req.body?.runId ?? ""));
      if (!run || run.flowId !== flow.id) return res.status(404).json({ error: "run not found" });
      const report = readFlowFile(run.outputDir, path).content;
      const nodes = await generateDecisionTreeWithLlm(basename(path), report, flow.folderPath, model);
      return res.json({ nodes, model });
    }
    return res.status(400).json({ error: "source must be session or flow-run" });
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
app.patch("/api/flows/:id", (req, res) => {
  if (!getFlow(req.params.id)) return res.status(404).json({ error: "flow not found" });
  const name = String(req.body?.name ?? "").trim();
  if (!name) return res.status(400).json({ error: "name required" });
  renameFlow(req.params.id, name);
  res.json({ ok: true });
});
app.delete("/api/flows/:id", (req, res) => {
  if (!getFlow(req.params.id)) return res.status(404).json({ error: "flow not found" });
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

// ---- REST: workspace paths ----
app.get("/api/workspaces/:id/paths", (req, res) => {
  if (!getWorkspace(String(req.params.id ?? ""))) return res.status(404).json({ error: "workspace not found" });
  const folder = String(req.query.folder ?? "") || undefined;
  res.json(listWorkspacePaths(String(req.params.id ?? ""), folder));
});

app.post("/api/workspaces/:id/paths", async (req, res) => {
  if (!getWorkspace(String(req.params.id ?? ""))) return res.status(404).json({ error: "workspace not found" });
  const folder = String(req.body?.folder ?? "").trim();
  const path = String(req.body?.path ?? "").trim();
  const kind = String(req.body?.kind ?? "").trim();
  if (!folder || !path || !kind) return res.status(400).json({ error: "folder, path and kind required" });
  try {
    const fileHash = kind === "file" ? await computeFileHash(path) : null;
    res.json(addWorkspacePath(String(req.params.id ?? ""), folder, path, kind, null, null, fileHash));
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
  res.json(listWorkspacePaths(session.workspaceId, folder, session.id));
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
  res.json(listWorkspacePaths(flow.workspaceId, folder, undefined, flow.id));
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

// ---- macOS native file/folder picker ----
app.post("/api/pick-path", (req, res) => {
  const mode = String(req.body?.mode ?? "file");
  const script =
    mode === "dir"
      ? "POSIX path of (choose folder)"
      : "POSIX path of (choose file)";
  execFile("osascript", ["-e", script], (err, stdout) => {
    if (err) return res.status(400).json({ error: "cancelled" });
    res.json({ path: stdout.trim() });
  });
});

// ---- registered local extraction tools ----
app.get("/api/extraction-tools", (_req, res) => {
  res.json(listExtractionTools());
});

app.post("/api/extraction-tools/:id/run", (req, res) => {
  const tool = getExtractionTool(String(req.params.id ?? ""));
  if (!tool) return res.status(404).json({ error: "extraction tool not found" });
  const inputPath = resolve(String(req.body?.inputPath ?? ""));
  const outputPath = resolve(String(req.body?.outputPath ?? ""));
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
  execFile(
    tool.runtime,
    [tool.entryPath, "--input", inputPath, "--output", outputPath, "--json-summary", summaryPath],
    { maxBuffer: 4 * 1024 * 1024 },
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
        res.status(err ? 400 : 200).json({
          runId,
          toolId: tool.id,
          stdout,
          stderr,
          ...summary,
        });
      } catch (summaryError) {
        res.status(500).json({ error: `extraction failed: ${String(err ?? summaryError)}`, stdout, stderr });
      }
    },
  );
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

const server = app.listen(PORT, () => {
  console.log(`[xanthil] gateway listening on http://localhost:${PORT}`);
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
  currentRun: PiRun | null;
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

function observeSessionEvent(sessionId: string, event: PiEvent): void {
  if (event.type === "compaction_start") {
    updateSessionRuntime(sessionId, { status: "compacting", lastError: null });
    return;
  }
  if (event.type === "compaction_end") {
    const current = getSessionRuntime(sessionId);
    const errorMessage = typeof event.errorMessage === "string" ? event.errorMessage : null;
    updateSessionRuntime(sessionId, {
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
  updateSessionRuntime(sessionId, {
    status: "running",
    contextTokens: message.usage.totalTokens,
    lastError: message.errorMessage ?? null,
  });
  trackSessionUsage(sessionId, message.usage);
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
      active.currentRun?.kill();
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

  const memoryInjection = getMemoryInjectionAudit(session.workspaceId, msg.injectRulesPrompt, "chat");

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
    fallbackOutputDir: ws_.rootPath,
  }, sessionAnalyses);
  const textForPi = `${contextPrefix}${msg.text}`;

  const systemPrompt = msg.injectRulesPrompt
    ? withRulesPrompt(session.workspaceId, "chat", session.workflowId ? WORKFLOW_SYSTEM_PROMPTS[session.workflowId] : undefined)
    : session.workflowId ? WORKFLOW_SYSTEM_PROMPTS[session.workflowId] : undefined;

  const run = runPiTurn({
    workspaceRoot: ws_.rootPath,
    piSessionId: session.id,
    text: textForPi,
    model: msg.model,
    systemPrompt,
    skillPaths,
    onEvent: (event: PiEvent) => {
      observeSessionEvent(session.id, event);
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

  const memoryInjection = getMemoryInjectionAudit(flow.workspaceId, msg.injectRulesPrompt, "workflow");

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
    fallbackOutputDir: flow.folderPath,
  }, flowChatAnalyses);

  const run = runPiTurn({
    // pi runs *inside* the flow folder so its file tools see the workflow as cwd.
    workspaceRoot: flow.folderPath,
    piSessionId: flow.id,
    text: `${contextPrefix}${msg.text}`,
    model: msg.model,
    systemPrompt: msg.injectRulesPrompt ? withRulesPrompt(flow.workspaceId, "workflow", msg.systemPrompt) : msg.systemPrompt,
    skillPaths,
    onEvent: (event: PiEvent) => {
      send(ws, { type: "flow_event", flowId: flow.id, event });
      if (event.type === "message_end") {
        const { message: m } = event as Extract<PiEvent, { type: "message_end" }>;
        if (m.role !== "user") addFlowMessage(flow.id, m.role, m.content, m.usage ?? null);
        if (m.errorMessage) traceFlowEvent(flow.id, "message_error", "failed", m.errorMessage, { role: m.role, stopReason: m.stopReason });
      }
    },
  });
  const active = { run, aborted: false, startedAt: Date.now() };
  activeFlowRuns.set(flow.id, active);
  try {
    const code = await run.done;
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
  const memoryInjection = getMemoryInjectionAudit(flow.workspaceId, msg.injectRulesPrompt, "workflow");
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
  const contextPrefix = buildRegisteredPathContext(multiAgentPaths, {
    workspaceId: flow.workspaceId,
    flowId: flow.id,
    fallbackOutputDir: runDir,
  }, multiAgentAnalyses);
  const clientRunId = msg.runId;
  const active: ActiveMultiAgentRun = { currentRun: null, aborted: false, dbRunId: runRow.id, flowId: flow.id, ws };
  activeMultiAgentRuns.set(clientRunId, active);
  const memoryInjection = getMemoryInjectionAudit(flow.workspaceId, msg.injectRulesPrompt, "workflow");
  traceFlowEvent(flow.id, "run_start", "running", "multi-agent execution", { model: msg.model, inputs: msg.inputs, memoryInjection }, runRow.id);
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
        active.currentRun = run;
      },
      onStepEvent: (nodeId, event) => {
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
      },
      isAborted: () => active.aborted,
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
