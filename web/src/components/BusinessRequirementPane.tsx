import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { AlertTriangle, BookOpen, ClipboardList, Compass, FileText, Loader2, Pencil, RefreshCw, Save, Sparkles, X } from "lucide-react";
import { Markdown } from "@/components/Markdown";
import { api } from "@/lib/api";
import type { RequirementCommunicationAssumption, RequirementCommunicationQuestion, RequirementCommunicationResult, RequirementCommunicationScene, RequirementImportDocumentInput, RequirementImportDocumentsResult } from "@/lib/api/engine";
import { useResumableTask } from "@/lib/resumableTask";
import type { BusinessContextCategory, FlowTreeNode, WorkspacePath } from "@/types";

type Scope =
  | { type: "workspace"; workspaceId: string }
  | { type: "session"; sessionId: string }
  | { type: "flow"; flowId: string };

interface Props {
  scope: Scope | null;
  communicationWorkspaceId?: string | null;
  scene?: RequirementCommunicationScene;
  model?: string;
  onGenerated?: () => void;
  onBusinessContextChanged?: () => void;
  // One-way: 业务需求 → 数据探索. Passes field-name hints only (never data).
  onExploreFields?: (fieldHints: string[], source: string) => void;
}

interface RequirementDraft {
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

interface RequirementDocumentOption {
  id: string;
  label: string;
  pathId: number;
  relPath: string;
  folder: WorkspacePath["folder"];
}

interface CommunicationMaterial {
  id: string;
  label: string;
  source: "registered" | "pasted" | "uploaded";
  summary: string;
  suggestedMessage: string;
  extractedQuestions: string[];
  extractedAssumptions: string[];
  riskNotes: string[];
  warnings: string[];
  fallback?: boolean;
}

interface RequirementVersion {
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

interface RequirementSourceDocumentMetadata {
  name: string;
  path: string;
  size: number;
  mtimeMs: number;
  source: "workspace_path" | "local_path";
  extension: string;
  truncated: boolean;
}

interface RequirementSourceRef {
  documentId: string;
  quote: string;
}

interface BusinessRequirementStructuredOutput {
  projectName: string;
  businessFacts?: string[];
  inferredNeeds?: string[];
  analysisQuestions?: string[];
  metrics?: Array<{ name: string; definition: string; source?: string }>;
  dimensions?: string[];
  dataNeeds?: Array<{ name: string; fields?: string[]; purpose: string; priority?: "P0" | "P1" | "P2" }>;
  analysisFramework?: Array<{ businessQuestion: string; hypothesis?: string; method: string; requiredData?: string[]; expectedOutput: string }>;
  reportFramework?: Array<{ section: string; purpose: string; keyQuestions?: string[]; requiredEvidence?: string[]; outputGuidance: string; zeroHallucinationCheck?: string }>;
  deliverables?: string[];
  openQuestions?: string[];
  risks?: string[];
  sourceRefs?: Record<string, RequirementSourceRef[]>;
  sourceDocuments?: RequirementSourceDocumentMetadata[];
  version?: {
    markdownEditedAt?: number;
    jsonStaleReason?: string;
    requirementInput?: Partial<RequirementDraft>;
  };
}

interface ConfirmedRequirementStructured {
  projectName: string;
  businessFacts: string[];
  inferredNeeds: string[];
  analysisQuestions: string[];
  deliverables: string[];
  openQuestions: string[];
  risks: string[];
  confirmedFacts: string[];
  confirmedAssumptions: string[];
  deferredQuestions: string[];
  communication?: { confirmedAt?: number; scene?: RequirementCommunicationScene; recordPath?: string };
  reportFramework?: Array<{ keyQuestions?: string[] }>;
}

interface BusinessContextDraft {
  category: BusinessContextCategory;
  title: string;
  content: string;
}

interface RequirementTemplate {
  id: string;
  label: string;
  draft: Partial<RequirementDraft>;
}

interface CommunicationTurn {
  id: string;
  role: "user" | "system";
  content: string;
}

interface ActiveConfirmedRequirement {
  markdownPath: string;
  jsonPath: string;
  content: string;
  structured: ConfirmedRequirementStructured | null;
  source: "just_confirmed" | "selected_version" | "external";
  scene?: RequirementCommunicationScene;
  confirmedAt?: number;
}

type RequirementSubTab = "communication" | "framework";

const REQUIREMENT_SUB_TABS: Array<{ id: RequirementSubTab; label: string; hint: string }> = [
  { id: "communication", label: "需求沟通", hint: "确认前工作台" },
  { id: "framework", label: "分析框架", hint: "确认后管理台" },
];

const SCENE_META: Record<RequirementCommunicationScene, { label: string; mode: string; note: string }> = {
  daily: { label: "日常", mode: "轻量模式", note: "默认只展示必须确认项，避免把一次分析变成大 brief。" },
  topic: { label: "专题", mode: "完整 brief", note: "补齐 owner、交付物、评审点，适合专题立项前对齐。" },
  recurring: { label: "重复", mode: "模板化", note: "关注与历史需求差异，以及是否值得固化为模板。" },
};

const COMMUNICATION_CATEGORIES = ["目标", "对象", "时间", "指标口径", "维度", "输出物", "成功标准", "风险"];

function isConfirmedRequirementJsonPath(path: string) {
  return /(^|\/)business_requirements\/[^/]*-确认需求-[^/]*\.json$/.test(path);
}

function isCommunicationRecordJsonPath(path: string) {
  return /(^|\/)business_requirements\/communications\//.test(path);
}

function isAnalysisFrameworkJsonPath(path: string) {
  return /(^|\/)business_requirements\/[^/]*-分析框架-[^/]*\.json$/.test(path);
}

function isConfirmedRequirementStructured(value: unknown): value is ConfirmedRequirementStructured {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<ConfirmedRequirementStructured>;
  return typeof item.projectName === "string" && Array.isArray(item.businessFacts) && Array.isArray(item.confirmedAssumptions);
}

function versionKind(version: RequirementVersion): "confirmed" | "framework" | "communication" | "other" {
  if (isCommunicationRecordJsonPath(version.jsonPath)) return "communication";
  if (isConfirmedRequirementJsonPath(version.jsonPath)) return "confirmed";
  if (isAnalysisFrameworkJsonPath(version.jsonPath)) return "framework";
  return "other";
}

const PRIORITY_LABELS: Record<RequirementCommunicationQuestion["priority"], string> = {
  must_confirm: "必须确认",
  should_confirm: "建议确认",
  can_defer: "可后置",
};

const QUESTION_STATUS_LABELS: Record<RequirementCommunicationQuestion["status"], string> = {
  pending: "待回答",
  answered: "已确认",
  skipped: "用户跳过",
  assumed: "系统假设",
  deferred: "后续确认",
};

const ASSUMPTION_STATUS_LABELS: Record<RequirementCommunicationAssumption["status"], string> = {
  proposed: "待处理",
  confirmed: "已采纳",
  rejected: "已删除",
  deferred: "后续确认",
};

function RequirementCommunicationPane({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-0 flex-1 overflow-auto p-6">
      <div className="mx-auto max-w-5xl">{children}</div>
    </div>
  );
}

function AnalysisFrameworkPane({ children }: { children: ReactNode }) {
  return <div className="min-h-0 flex-1 overflow-auto">{children}</div>;
}

const EMPTY_DRAFT: RequirementDraft = {
  projectName: "",
  businessBackground: "",
  businessGoal: "",
  businessQuestions: "",
  decisionScenario: "",
  stakeholders: "",
  knownData: "",
  constraints: "",
  outputPreference: "",
  extraPrompt: "",
};

// Rebuild the left-side draft form from a persisted version's requirementInput, so refreshing the
// page or reopening a version restores the business background instead of losing it to ephemeral state.
function draftFromRequirementInput(input: Partial<RequirementDraft>): RequirementDraft {
  const next = { ...EMPTY_DRAFT };
  for (const key of Object.keys(EMPTY_DRAFT) as Array<keyof RequirementDraft>) {
    const value = input[key];
    if (typeof value === "string") next[key] = value;
  }
  return next;
}

const FIELD_CONFIG: Array<{
  id: keyof RequirementDraft;
  label: string;
  placeholder: string;
  required?: boolean;
}> = [
  { id: "projectName", label: "项目名称", placeholder: "例如：618 活动复盘与增长机会分析", required: true },
  { id: "businessBackground", label: "业务背景", placeholder: "业务所处阶段、近期变化、当前经营现状" },
  { id: "businessGoal", label: "业务目标", placeholder: "希望通过分析支持什么目标或判断", required: true },
  { id: "businessQuestions", label: "核心业务问题", placeholder: "业务方真正想回答的问题，可逐条填写", required: true },
  { id: "decisionScenario", label: "决策场景", placeholder: "谁会基于分析做什么决策，决策时间窗口是什么" },
  { id: "stakeholders", label: "使用对象", placeholder: "老板、业务负责人、运营、销售、产品等" },
  { id: "knownData", label: "已知数据", placeholder: "已有数据表、文件、指标、可用维度、数据时间范围" },
  { id: "constraints", label: "限制与风险", placeholder: "数据缺口、口径争议、合规红线、不能做的分析" },
  { id: "outputPreference", label: "输出偏好", placeholder: "希望输出框架、指标树、分析路径、假设清单、看板草图等" },
  { id: "extraPrompt", label: "补充要求", placeholder: "其他希望模型遵守的风格、粒度或行业背景" },
];

const REQUIREMENT_TEMPLATES: RequirementTemplate[] = [
  {
    id: "campaign_review",
    label: "活动复盘",
    draft: {
      businessGoal: "评估活动整体效果，识别增长来源、转化短板、成本效率和后续优化机会。",
      businessQuestions: "活动是否达成目标？哪些渠道/人群/商品贡献最大？转化链路哪里流失明显？投入产出是否合理？下次活动应如何调整？",
      decisionScenario: "用于活动复盘会、下一轮活动预算分配、投放和商品策略调整。",
      knownData: "活动曝光、点击、访问、加购、下单、支付、退款、优惠券、投放消耗、会员/用户标签、商品维度数据。",
      outputPreference: "输出活动指标树、漏斗拆解、渠道/人群/商品贡献分析、ROI 分析、问题归因和下一轮动作清单。",
      extraPrompt: "优先区分确定结论与待验证假设；不要只看总量，要拆到渠道、人群、商品和时间节奏。",
    },
  },
  {
    id: "user_segmentation",
    label: "用户分群",
    draft: {
      businessGoal: "识别不同用户群体的价值、行为差异和可运营机会，为精细化触达和策略分层提供依据。",
      businessQuestions: "应该按哪些维度分群？哪些用户高价值/高潜力/高流失风险？不同群体的需求和行为差异是什么？每类用户应采取什么运营动作？",
      decisionScenario: "用于会员运营、用户增长、复购提升、流失召回和个性化触达策略制定。",
      knownData: "用户基础属性、注册/入会时间、访问行为、购买频次、客单价、品类偏好、优惠敏感度、最近一次互动、生命周期状态。",
      outputPreference: "输出分群逻辑、核心指标、分群画像、群体规模/价值排序、运营动作和验证指标。",
      extraPrompt: "分群标准要可落地到数据字段，不要只给抽象人群名称。",
    },
  },
  {
    id: "product_analysis",
    label: "商品分析",
    draft: {
      businessGoal: "评估商品结构、销售表现、库存/价格/内容因素和增长机会，支持选品、定价和资源配置。",
      businessQuestions: "哪些商品贡献核心销售？哪些商品有潜力但转化不足？价格、库存、评价、内容或渠道对商品表现有什么影响？应重点优化哪些商品？",
      decisionScenario: "用于选品会、商品运营复盘、价格策略、库存补货和爆品打造。",
      knownData: "商品基础信息、品类、价格、库存、曝光、点击、转化、销售额、毛利、评价、退货、内容/投放资源。",
      outputPreference: "输出商品分层、品类结构、价格带分析、转化漏斗、问题商品清单和商品运营动作。",
      extraPrompt: "需要区分销售贡献、增长潜力和经营质量，不要只按销售额排序。",
    },
  },
  {
    id: "channel_attribution",
    label: "渠道投放",
    draft: {
      businessGoal: "评估各渠道投放效率、转化质量和预算配置合理性，找到可放大和需收缩的渠道。",
      businessQuestions: "哪些渠道带来有效增长？不同渠道用户质量如何？预算是否应该调整？投放链路中是素材、流量、落地页还是商品承接出了问题？",
      decisionScenario: "用于投放复盘、预算分配、渠道组合优化和素材/落地页迭代。",
      knownData: "渠道、计划、素材、曝光、点击、CPC/CPM、转化、成交、ROI、留存/复购、用户质量、落地页行为。",
      outputPreference: "输出渠道效率矩阵、投放漏斗、ROI 拆解、预算调整建议和后续实验计划。",
      extraPrompt: "要避免末次归因的单一判断，明确归因口径和不确定性。",
    },
  },
  {
    id: "member_operation",
    label: "会员运营",
    draft: {
      businessGoal: "诊断会员增长、活跃、复购、留存和价值提升机会，形成可执行会员运营策略。",
      businessQuestions: "会员增长是否健康？不同等级/生命周期会员表现如何？复购和留存的关键影响因素是什么？哪些会员值得重点运营？",
      decisionScenario: "用于会员月报、会员权益设计、复购提升、沉睡唤醒和私域运营策略。",
      knownData: "会员明细、等级、入会渠道、购买记录、积分/权益、活跃行为、复购、流失、触达记录、标签数据。",
      outputPreference: "输出会员漏斗、生命周期分层、等级价值分析、复购/流失诊断和运营动作优先级。",
      extraPrompt: "注意区分新会员、活跃会员、高价值会员和沉睡会员的不同策略。",
    },
  },
  {
    id: "business_diagnosis",
    label: "经营诊断",
    draft: {
      businessGoal: "从经营结果出发定位增长、效率、结构和风险问题，形成经营诊断框架和改进优先级。",
      businessQuestions: "核心经营指标变化是否异常？增长来自哪里、问题卡在哪里？收入、成本、利润、用户、商品、渠道之间的关键矛盾是什么？",
      decisionScenario: "用于经营例会、管理层汇报、专项诊断和季度/月度经营复盘。",
      knownData: "收入、订单、用户、转化、客单价、成本、毛利、渠道、品类、地区、时间序列、预算目标和历史同期数据。",
      outputPreference: "输出经营指标树、异常定位、贡献拆解、关键假设、数据需求清单和行动优先级。",
      extraPrompt: "先做指标树和拆解路径，再给结论；必须明确哪些结论需要进一步数据验证。",
    },
  },
];

function basenamePath(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).pop() ?? path;
}

function flattenFiles(node: FlowTreeNode): FlowTreeNode[] {
  if (node.kind === "file") return [node];
  return (node.children ?? []).flatMap(flattenFiles);
}

function isRequirementDocumentFile(name: string): boolean {
  return /\.(md|markdown|txt|csv|docx|xlsx|xls)$/i.test(name);
}

function formatBytes(size: number): string {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}

function extractCommunicationMaterial(label: string, content: string, source: CommunicationMaterial["source"], warning?: string): CommunicationMaterial {
  const lines = content.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const sentences = content.split(/[。！？!?\n]+/).map((line) => line.trim()).filter(Boolean);
  const questionLines = lines.filter((line) => /[?？]|问题|确认|待定|是否|如何|为什么/.test(line)).slice(0, 6);
  const assumptionLines = lines.filter((line) => /假设|默认|预计|可能|暂按|先按/.test(line)).slice(0, 6);
  const summary = warning ?? (sentences.slice(0, 3).join("；").slice(0, 300) || "已添加材料，暂无可展示摘要。");
  const suggestedMessage = [
    `请基于沟通材料《${label}》补充澄清。`,
    sentences.slice(0, 5).join("；").slice(0, 600),
  ].filter(Boolean).join("\n");
  return {
    id: `${source}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    label,
    source,
    summary,
    suggestedMessage,
    extractedQuestions: questionLines.length > 0 ? questionLines : ["材料中的分析目标、时间范围、指标口径是否已确认？"],
    extractedAssumptions: assumptionLines,
    riskNotes: [],
    warnings: warning ? [warning] : [],
    fallback: true,
  };
}

function materialFromImportResult(label: string, source: CommunicationMaterial["source"], result: RequirementImportDocumentsResult): CommunicationMaterial {
  const warnings = result.documentSummaries.flatMap((item) => item.warnings ?? []);
  return {
    id: `${source}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    label,
    source,
    summary: result.documentSummaries.map((item) => `${item.name}: ${item.summary}`).join("\n") || "服务端已导入材料，但未返回摘要。",
    suggestedMessage: result.suggestedMessage,
    extractedQuestions: result.extractedQuestions.map((item) => item.question),
    extractedAssumptions: result.extractedAssumptions.map((item) => item.text),
    riskNotes: result.riskNotes,
    warnings,
  };
}

function importSourceForOption(option: RequirementDocumentOption): RequirementImportDocumentInput["source"] {
  if (option.folder === "clean_data") return "clean_data";
  return /(^|\/)business_requirements\//.test(option.relPath) || /(^|\/)business_requirements\//.test(option.label)
    ? "business_requirements"
    : "report";
}

function formatTime(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return "更新时间未知";
  return new Date(ms).toLocaleString();
}

function formatDocumentSource(source: RequirementSourceDocumentMetadata["source"]): string {
  return source === "workspace_path" ? "登记路径" : "本地文件";
}

function isStructuredOutput(value: unknown): value is BusinessRequirementStructuredOutput {
  return typeof value === "object" && value !== null && typeof (value as { projectName?: unknown }).projectName === "string";
}

function listText(items: string[] | undefined): string {
  return (items ?? []).filter(Boolean).map((item) => `- ${item}`).join("\n");
}

// Collect field-name hints (metrics / dimensions / dataNeeds.fields) to seed
// 数据探索. Deduped & trimmed; these are business terms, not actual column names.
function collectExploreFieldHints(structured: BusinessRequirementStructuredOutput): string[] {
  const raw: string[] = [
    ...(structured.metrics ?? []).map((m) => m.name),
    ...(structured.dimensions ?? []),
    ...(structured.dataNeeds ?? []).flatMap((d) => d.fields ?? []),
  ];
  const seen = new Set<string>();
  const hints: string[] = [];
  for (const item of raw) {
    const name = (item ?? "").trim();
    if (!name || seen.has(name)) continue;
    seen.add(name);
    hints.push(name);
  }
  return hints;
}

function buildBusinessContextDrafts(structured: BusinessRequirementStructuredOutput): BusinessContextDraft[] {
  const drafts: BusinessContextDraft[] = [];
  const facts = listText(structured.businessFacts);
  if (facts) drafts.push({ category: "status", title: `${structured.projectName}｜业务事实`, content: facts });
  const goals = [
    listText(structured.inferredNeeds),
    listText(structured.analysisQuestions),
  ].filter(Boolean).join("\n\n");
  if (goals) drafts.push({ category: "goal", title: `${structured.projectName}｜分析目标与问题`, content: goals });
  const metricLines = (structured.metrics ?? []).map((metric) => `- ${metric.name}: ${metric.definition}${metric.source ? `（${metric.source}）` : ""}`);
  const dimensionLines = (structured.dimensions ?? []).map((dimension) => `- 维度: ${dimension}`);
  const dataLines = (structured.dataNeeds ?? []).map((item) => `- ${item.name}: ${(item.fields ?? []).join("、") || "字段待确认"}；用途：${item.purpose}`);
  const glossary = [...metricLines, ...dimensionLines, ...dataLines].join("\n");
  if (glossary) drafts.push({ category: "glossary", title: `${structured.projectName}｜指标维度与数据需求`, content: glossary });
  const constraints = [listText(structured.risks), listText(structured.openQuestions)].filter(Boolean).join("\n\n");
  if (constraints) drafts.push({ category: "constraint", title: `${structured.projectName}｜风险与待确认事项`, content: constraints });
  return drafts;
}

function formatCommunicationError(err: unknown): string {
  const raw = String(err);
  if (/JSON|Unexpected token|parse failed|not valid JSON/i.test(raw)) {
    return "需求沟通生成失败：模型返回的 JSON 格式不完整。请重试一次；如果仍失败，缩短诉求或先导入/粘贴更明确的沟通材料。";
  }
  return raw;
}

function renderReportFrameworkMarkdown(structured: BusinessRequirementStructuredOutput | null): string {
  const items = structured?.reportFramework ?? [];
  if (items.length === 0) {
    return [
      "# 报告框架",
      "",
      "当前历史版本尚未包含独立报告框架。请重新生成业务需求，系统会补齐用于后续数据分析报告输出的章节结构、证据要求和零幻觉检查。",
      "",
      "| 报告章节 | 章节目的 | 需要回答的问题 | 必需证据/数据 | 输出要求 | 零幻觉检查 |",
      "|---|---|---|---|---|---|",
      "| 执行摘要 | 概述目标、结论和限制 | 本次分析回答什么问题 | 已验证关键指标、口径、数据范围 | 先给结论，再列证据和限制 | 每个数字标注来源与证据等级，缺证据时写待确认 |",
    ].join("\n");
  }
  return [
    `# ${structured?.projectName ?? "业务需求"} 报告框架`,
    "",
    "这个框架会作为后续数据分析报告的写作约束，重点防止报告缺章节、缺证据、缺口径说明。",
    "",
    "| 报告章节 | 章节目的 | 需要回答的问题 | 必需证据/数据 | 输出要求 | 零幻觉检查 |",
    "|---|---|---|---|---|---|",
    ...items.map((item) => [
      item.section,
      item.purpose,
      (item.keyQuestions ?? []).join("；") || "待确认",
      (item.requiredEvidence ?? []).join("；") || "待确认",
      item.outputGuidance,
      item.zeroHallucinationCheck || "每个数字标注来源与证据等级，缺证据时写待确认",
    ].map((cell) => cell.replace(/\|/g, "\\|")).join(" | ")).map((row) => `| ${row} |`),
  ].join("\n");
}

function buildDefaultReportFramework(): NonNullable<BusinessRequirementStructuredOutput["reportFramework"]> {
  return [
    {
      section: "执行摘要",
      purpose: "概述分析目标、关键结论和限制",
      keyQuestions: ["本次分析回答什么业务问题", "结论可支持什么决策"],
      requiredEvidence: ["已验证关键指标", "指标口径", "数据范围"],
      outputGuidance: "先给结论，再列证据和限制",
      zeroHallucinationCheck: "每个数字标注来源与证据等级，缺证据时写待确认",
    },
    {
      section: "背景与口径",
      purpose: "说明业务背景、分析范围、对象定义和对比基准",
      keyQuestions: ["分析对象如何定义", "时间范围和门店/区域范围是什么", "对比基准是否一致"],
      requiredEvidence: ["业务需求", "字段字典", "口径说明", "已登记聚合数据"],
      outputGuidance: "先列已确认口径，再列待确认口径",
      zeroHallucinationCheck: "不得把待确认口径写成事实",
    },
    {
      section: "观察 Observation",
      purpose: "只呈现数据事实，不写因果判断",
      keyQuestions: ["哪些指标发生变化", "变化集中在哪些维度"],
      requiredEvidence: ["工具计算值", "聚合表字段", "MetricSnapshot", "数据探索验证结果"],
      outputGuidance: "每条观察编号，避免混入推断",
      zeroHallucinationCheck: "观察段禁止因果词；每个数字必须有来源和证据等级",
    },
    {
      section: "推断 Inference",
      purpose: "基于观察形成可证伪假设",
      keyQuestions: ["哪些假设能解释观察", "还需要什么数据证伪"],
      requiredEvidence: ["观察项编号", "对比维度", "可证伪条件"],
      outputGuidance: "每条推断包含假设、支撑观察和证伪条件",
      zeroHallucinationCheck: "推断必须引用观察项编号，不得孤立下判断",
    },
    {
      section: "建议 Action",
      purpose: "把推断转成可执行动作",
      keyQuestions: ["建议对应哪条推断", "谁在什么时候执行", "如何衡量效果"],
      requiredEvidence: ["推断编号", "影响指标", "执行约束"],
      outputGuidance: "每条建议绑定推断和衡量指标",
      zeroHallucinationCheck: "禁止无推断支撑的孤立建议",
    },
    {
      section: "风险与待确认",
      purpose: "列出数据、口径、样本和因果解释的限制",
      keyQuestions: ["哪些结论证据不足", "哪些口径需要业务方确认"],
      requiredEvidence: ["缺失字段", "口径冲突", "样本覆盖", "未完成验证项"],
      outputGuidance: "明确降置信内容和下一步验证动作",
      zeroHallucinationCheck: "证据不足时必须写不确定或待确认",
    },
  ];
}

function renderBusinessRequirementMarkdown(structured: BusinessRequirementStructuredOutput): string {
  const list = (items: string[] | undefined) => (items ?? []).length ? (items ?? []).map((item) => `- ${item}`).join("\n") : "- 待确认";
  const sourceDocuments = structured.sourceDocuments?.length
    ? structured.sourceDocuments.map((document, index) => {
      const details = [
        formatDocumentSource(document.source),
        document.extension || "未知类型",
        `${document.size} bytes`,
        document.truncated ? "内容已截断" : "",
      ].filter(Boolean).join(" · ");
      return `- [D${index + 1}] ${document.name}（${details}）\n  - 路径：${document.path}`;
    }).join("\n")
    : "- 未导入需求调研文档";
  const sourceRefs = structured.sourceRefs && Object.keys(structured.sourceRefs).length > 0
    ? Object.entries(structured.sourceRefs).flatMap(([fieldPath, refs]) =>
      refs.map((ref) => `| ${fieldPath} | ${ref.documentId} | ${ref.quote.replace(/\|/g, "\\|")} |`),
    ).join("\n")
    : "| 待补充 | 待补充 | 待补充 |";
  const metrics = structured.metrics?.length
    ? structured.metrics.map((item) => `| ${item.name} | ${item.definition} | ${item.source ?? "待确认"} |`).join("\n")
    : "| 待确认 | 待确认 | 待确认 |";
  const dataNeeds = structured.dataNeeds?.length
    ? structured.dataNeeds.map((item) => `| ${item.priority ?? "P1"} | ${item.name} | ${(item.fields ?? []).join("、") || "待确认"} | ${item.purpose} |`).join("\n")
    : "| P1 | 待确认 | 待确认 | 待确认 |";
  const analysisFramework = structured.analysisFramework?.length
    ? structured.analysisFramework.map((item) => `| ${item.businessQuestion} | ${item.hypothesis || "待确认"} | ${item.method} | ${(item.requiredData ?? []).join("、") || "待确认"} | ${item.expectedOutput} |`).join("\n")
    : "| 待确认 | 待确认 | 待确认 | 待确认 | 待确认 |";
  const reportFramework = structured.reportFramework?.length
    ? structured.reportFramework.map((item) => `| ${item.section} | ${item.purpose} | ${(item.keyQuestions ?? []).join("；") || "待确认"} | ${(item.requiredEvidence ?? []).join("；") || "待确认"} | ${item.outputGuidance} | ${item.zeroHallucinationCheck || "每个数字标注来源与证据等级，缺证据时写待确认"} |`).join("\n")
    : "| 执行摘要 | 概述分析目标、结论与限制 | 本次分析回答什么问题 | 已验证关键指标、口径、数据范围 | 先给结论，再列证据和限制 | 每个数字标注来源与证据等级，缺证据时写待确认 |";
  return [
    `# ${structured.projectName} 业务需求与分析框架`,
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
    list(structured.businessFacts),
    "",
    "### 从会议纪要/文档推断出的需求",
    list(structured.inferredNeeds),
    "",
    "## 2. 数据分析需求转译",
    list(structured.analysisQuestions),
    "",
    "## 3. 核心指标与分析维度",
    "| 指标 | 定义 | 来源/口径 |",
    "|---|---|---|",
    metrics,
    "",
    "### 分析维度",
    list(structured.dimensions),
    "",
    "## 4. 分析框架与路径",
    "| 业务问题 | 分析假设 | 验证方法 | 所需数据 | 预期输出 |",
    "|---|---|---|---|---|",
    analysisFramework,
    "",
    "## 5. 报告框架",
    "| 报告章节 | 章节目的 | 需要回答的问题 | 必需证据/数据 | 输出要求 | 零幻觉检查 |",
    "|---|---|---|---|---|---|",
    reportFramework,
    "",
    "## 6. 数据需求清单",
    "| 优先级 | 数据/表 | 字段/维度 | 用途 |",
    "|---|---|---|---|",
    dataNeeds,
    "",
    "## 7. 交付物建议",
    list(structured.deliverables),
    "",
    "## 8. 风险、不确定性与待确认问题",
    "### 风险与不确定性",
    list(structured.risks),
    "",
    "### 待确认问题",
    list(structured.openQuestions),
    "",
  ].join("\n");
}

const BUSINESS_REQUIREMENT_GUIDE = [
  "# 业务需求模块说明文档",
  "",
  "## 目的",
  "把业务方的自然语言诉求、会议纪要或需求文档，转成后续数据分析可直接使用的分析框架和报告框架。",
  "",
  "## 使用方式",
  "1. 选择保存位置：通常选择当前任务的 `060_reports` 文件夹，生成结果会写入 `business_requirements/`。",
  "2. 在需求沟通 tab 导入沟通材料：可添加已登记 business_requirements / report 摘要，或粘贴、上传用户显式选择的文本材料。",
  "3. 点击“应用到本轮沟通”：材料只会进入原始诉求、澄清问题和假设区，不会绕过确认直接成为事实。",
  "4. 回答必须确认项并处理假设后，点击“确认成正式需求”。",
  "5. 确认后进入分析框架 tab：系统基于确认需求生成分析框架、报告框架、数据需求、风险与待确认问题。",
  "6. 在数据分析中选择业务需求上下文：后续聊天、报告、黄金策会优先围绕该需求展开。",
  "",
  "## 示例",
  "- 项目名称：森马服饰品牌三大人群 26Q2 新客分析（线下门店）",
  "- 业务目标：判断 B/A 类人群占比提升是否达成，并找出可执行的门店运营策略。",
  "- 核心业务问题：新客定义是什么？25Q2 与 26Q2 标签口径是否一致？哪些门店/区域贡献主要变化？",
  "- 限制与风险：标签口径、门店范围、数据粒度和对比基期未确认时，报告必须降置信或列待确认。",
  "",
  "## 注意事项",
  "- 业务需求可以读取已登记聚合数据和需求文档，但不能把原始 `draw_data` 明细送给 LLM。",
  "- 待确认问题不能当成已确认事实；后续报告应明确标注来源、证据等级和口径限制。",
  "- 人工编辑 Markdown 后，结构化 JSON 会标记为过期；需要沉淀业务环境时请重新生成。",
].join("\n");

function ReportFrameworkTree({
  structured,
  editing,
  onChange,
}: {
  structured: BusinessRequirementStructuredOutput | null;
  editing: boolean;
  onChange: (items: NonNullable<BusinessRequirementStructuredOutput["reportFramework"]>) => void;
}) {
  const items = structured?.reportFramework ?? [];
  if (items.length === 0) {
    return <Markdown>{renderReportFrameworkMarkdown(structured)}</Markdown>;
  }
  const updateItem = (
    index: number,
    patch: Partial<NonNullable<BusinessRequirementStructuredOutput["reportFramework"]>[number]>,
  ) => {
    onChange(items.map((item, itemIndex) => itemIndex === index ? { ...item, ...patch } : item));
  };
  return (
    <div className="space-y-3">
      <div className="rounded-md border border-neutral-200 bg-neutral-50 px-3 py-2 text-[12px] leading-5 text-neutral-600 dark:border-neutral-800 dark:bg-neutral-950 dark:text-neutral-300">
        报告框架会作为后续数据分析报告的章节约束，重点保留证据、来源、证据等级和待确认事项。
      </div>
      <div className="relative pl-5">
        <div className="absolute bottom-4 left-2 top-2 w-px bg-neutral-200 dark:bg-neutral-800" />
        {items.map((item, index) => (
          <div key={`${item.section}:${index}`} className="relative pb-4">
            <div className="absolute left-[-15px] top-4 h-px w-3 bg-neutral-200 dark:bg-neutral-800" />
            <div className="rounded-lg border border-neutral-200 bg-white p-3 shadow-sm dark:border-neutral-800 dark:bg-neutral-900">
              <div className="mb-2 flex items-center gap-2">
                <span className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-neutral-200 bg-neutral-50 font-mono text-[11px] text-neutral-500 dark:border-neutral-700 dark:bg-neutral-950 dark:text-neutral-400">
                  {index + 1}
                </span>
                {editing ? (
                  <input
                    value={item.section}
                    onChange={(event) => updateItem(index, { section: event.target.value })}
                    className="h-8 min-w-0 flex-1 rounded-md border border-neutral-200 bg-white px-2 text-[12.5px] font-semibold text-neutral-900 outline-none focus:border-neutral-400 dark:border-neutral-700 dark:bg-neutral-950 dark:text-neutral-100"
                  />
                ) : (
                  <h3 className="min-w-0 flex-1 truncate text-[13px] font-semibold text-neutral-900 dark:text-neutral-100">{item.section}</h3>
                )}
              </div>
              <div className="grid gap-2 md:grid-cols-2">
                {[
                  { label: "章节目的", value: item.purpose, key: "purpose" as const, multi: false },
                  { label: "输出要求", value: item.outputGuidance, key: "outputGuidance" as const, multi: false },
                  { label: "需要回答的问题", value: (item.keyQuestions ?? []).join("\n"), key: "keyQuestions" as const, multi: true },
                  { label: "必需证据/数据", value: (item.requiredEvidence ?? []).join("\n"), key: "requiredEvidence" as const, multi: true },
                  { label: "零幻觉检查", value: item.zeroHallucinationCheck ?? "", key: "zeroHallucinationCheck" as const, multi: false },
                ].map((field) => (
                  <label key={field.key} className={field.key === "zeroHallucinationCheck" ? "block md:col-span-2" : "block"}>
                    <span className="text-[11px] font-medium text-neutral-500 dark:text-neutral-400">{field.label}</span>
                    {editing ? (
                      <textarea
                        value={field.value}
                        onChange={(event) => {
                          const value = event.target.value;
                          if (field.key === "keyQuestions" || field.key === "requiredEvidence") {
                            updateItem(index, { [field.key]: value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean) });
                          } else {
                            updateItem(index, { [field.key]: value });
                          }
                        }}
                        className="mt-1 min-h-[64px] w-full resize-y rounded-md border border-neutral-200 bg-neutral-50 p-2 text-[12px] leading-5 text-neutral-800 outline-none focus:border-neutral-400 dark:border-neutral-700 dark:bg-neutral-950 dark:text-neutral-200"
                      />
                    ) : (
                      <p className="mt-1 whitespace-pre-wrap rounded-md bg-neutral-50 px-2 py-1.5 text-[12px] leading-5 text-neutral-700 dark:bg-neutral-950 dark:text-neutral-300">
                        {field.value || "待确认"}
                      </p>
                    )}
                  </label>
                ))}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function buildLineDiff(previous: string, current: string): string {
  const before = previous.split(/\r?\n/);
  const after = current.split(/\r?\n/);
  const dp = Array.from({ length: before.length + 1 }, () => Array<number>(after.length + 1).fill(0));
  const score = (i: number, j: number) => dp[i]?.[j] ?? 0;
  for (let i = before.length - 1; i >= 0; i -= 1) {
    for (let j = after.length - 1; j >= 0; j -= 1) {
      const beforeLine = before[i] ?? "";
      const afterLine = after[j] ?? "";
      const row = dp[i];
      if (row) row[j] = beforeLine === afterLine ? score(i + 1, j + 1) + 1 : Math.max(score(i + 1, j), score(i, j + 1));
    }
  }
  const out: string[] = [];
  let i = 0;
  let j = 0;
  while (i < before.length && j < after.length) {
    const beforeLine = before[i] ?? "";
    const afterLine = after[j] ?? "";
    if (beforeLine === afterLine) {
      out.push(`  ${beforeLine}`);
      i += 1;
      j += 1;
    } else if (score(i + 1, j) >= score(i, j + 1)) {
      out.push(`- ${beforeLine}`);
      i += 1;
    } else {
      out.push(`+ ${afterLine}`);
      j += 1;
    }
  }
  while (i < before.length) {
    out.push(`- ${before[i] ?? ""}`);
    i += 1;
  }
  while (j < after.length) {
    out.push(`+ ${after[j] ?? ""}`);
    j += 1;
  }
  return out.join("\n");
}

function scopeWorkspaceId(scope: Scope | null): string | null {
  return scope?.type === "workspace" ? scope.workspaceId : null;
}

function fieldBlock(label: string, values: string[]): string {
  return values.length > 0 ? `${label}: ${values.join("；")}` : "";
}

function communicationMessageFromDraft(input: string, draft: RequirementDraft): string {
  return [
    input.trim() ? `用户原始诉求: ${input.trim()}` : "",
    draft.projectName.trim() ? `项目名称: ${draft.projectName.trim()}` : "",
    draft.businessBackground.trim() ? `业务背景: ${draft.businessBackground.trim()}` : "",
    draft.businessGoal.trim() ? `业务目标: ${draft.businessGoal.trim()}` : "",
    draft.businessQuestions.trim() ? `业务问题: ${draft.businessQuestions.trim()}` : "",
    draft.decisionScenario.trim() ? `决策场景: ${draft.decisionScenario.trim()}` : "",
    draft.stakeholders.trim() ? `相关角色: ${draft.stakeholders.trim()}` : "",
    draft.knownData.trim() ? `已知数据: ${draft.knownData.trim()}` : "",
    draft.constraints.trim() ? `约束: ${draft.constraints.trim()}` : "",
    draft.outputPreference.trim() ? `输出偏好: ${draft.outputPreference.trim()}` : "",
  ].filter(Boolean).join("\n");
}

function communicationHistory(turns: CommunicationTurn[], questions: RequirementCommunicationQuestion[], assumptions: RequirementCommunicationAssumption[]): string {
  return [
    ...turns.map((turn) => `${turn.role === "user" ? "用户" : "系统"}: ${turn.content}`),
    ...questions.filter((item) => item.answer?.trim()).map((item) => `用户回答[${item.category}]: ${item.question} => ${item.answer}`),
    ...assumptions.filter((item) => item.status === "confirmed").map((item) => `已采纳假设: ${item.text}`),
  ].join("\n").slice(0, 8000);
}

function draftFromCommunication(result: RequirementCommunicationResult, current: RequirementDraft): RequirementDraft {
  const rd = result.requirementDraft;
  return {
    ...current,
    businessBackground: rd.background || current.businessBackground,
    businessGoal: rd.objective || current.businessGoal,
    businessQuestions: [fieldBlock("待回答", rd.questions), current.businessQuestions].filter(Boolean).join("\n"),
    decisionScenario: [fieldBlock("范围", rd.scope), current.decisionScenario].filter(Boolean).join("\n"),
    knownData: [fieldBlock("指标", rd.metrics), current.knownData].filter(Boolean).join("\n"),
    constraints: [fieldBlock("风险", [...rd.risks, ...result.riskNotes]), fieldBlock("假设", rd.assumptions), current.constraints].filter(Boolean).join("\n"),
    outputPreference: [fieldBlock("输出物", rd.outputs), fieldBlock("成功标准", rd.successCriteria), current.outputPreference].filter(Boolean).join("\n"),
  };
}

export function BusinessRequirementPane({ scope, communicationWorkspaceId, scene = "daily", model, onGenerated, onBusinessContextChanged, onExploreFields }: Props) {
  const [paths, setPaths] = useState<WorkspacePath[]>([]);
  const [selectedPathId, setSelectedPathId] = useState("");
  const [documentOptions, setDocumentOptions] = useState<RequirementDocumentOption[]>([]);
  const [selectedDocumentId, setSelectedDocumentId] = useState("");
  const [versions, setVersions] = useState<RequirementVersion[]>([]);
  const [selectedVersionId, setSelectedVersionId] = useState("");
  const [selectedTemplateId, setSelectedTemplateId] = useState("");
  const [draft, setDraft] = useState<RequirementDraft>(EMPTY_DRAFT);
  const [generatedPath, setGeneratedPath] = useState("");
  const [generatedJsonPath, setGeneratedJsonPath] = useState("");
  const [generatedContent, setGeneratedContent] = useState("");
  const [generatedStructured, setGeneratedStructured] = useState<BusinessRequirementStructuredOutput | null>(null);
  const [clarificationContent, setClarificationContent] = useState("");
  const [diffContent, setDiffContent] = useState("");
  const [editedContent, setEditedContent] = useState("");
  const [editedClarificationContent, setEditedClarificationContent] = useState("");
  const [activeResult, setActiveResult] = useState<"clarification" | "framework" | "report" | "diff" | "guide">("framework");
  const [editingFramework, setEditingFramework] = useState(false);
  const [editingClarification, setEditingClarification] = useState(false);
  const [editingReportFramework, setEditingReportFramework] = useState(false);
  const [loadingPaths, setLoadingPaths] = useState(false);
  const [diffing, setDiffing] = useState(false);
  const [sinkingContext, setSinkingContext] = useState(false);
  const [savingFramework, setSavingFramework] = useState(false);
  const [sinkMessage, setSinkMessage] = useState("");
  const [saveMessage, setSaveMessage] = useState("");
  const [error, setError] = useState("");
  const [communicationInput, setCommunicationInput] = useState("");
  const [communicationTurns, setCommunicationTurns] = useState<CommunicationTurn[]>([]);
  const [communicationQuestions, setCommunicationQuestions] = useState<RequirementCommunicationQuestion[]>([]);
  const [communicationAssumptions, setCommunicationAssumptions] = useState<RequirementCommunicationAssumption[]>([]);
  const [communicationResult, setCommunicationResult] = useState<RequirementCommunicationResult | null>(null);
  const [communicationError, setCommunicationError] = useState("");
  const [communicationMaterials, setCommunicationMaterials] = useState<CommunicationMaterial[]>([]);
  const [pastedMaterial, setPastedMaterial] = useState("");
  const [communicating, setCommunicating] = useState(false);
  const [importingMaterial, setImportingMaterial] = useState(false);
  const [confirmingCommunication, setConfirmingCommunication] = useState(false);
  const [activeSubTab, setActiveSubTab] = useState<RequirementSubTab>("communication");
  const [activeConfirmedRequirement, setActiveConfirmedRequirement] = useState<ActiveConfirmedRequirement | null>(null);
  const [showLegacyDirectGenerate, setShowLegacyDirectGenerate] = useState(false);
  const materialFileInputRef = useRef<HTMLInputElement | null>(null);

  const taskKeySuffix = selectedPathId || "__no_path__";
  const generateTask = useResumableTask<{
    path: string;
    jsonPath: string;
    content: string;
    structured: unknown;
  }>("bizreq-gen:" + taskKeySuffix);
  const generating = generateTask.status === "running";
  const clarifying = false;
  const requirementCommunicationWorkspaceId = communicationWorkspaceId ?? scopeWorkspaceId(scope);
  const sceneMeta = SCENE_META[scene];
  const lastAppliedGenerateRef = useRef<unknown>(null);
  const autoRestoredPathRef = useRef<number | null>(null);

  const selectedPath = useMemo(
    () => paths.find((path) => String(path.id) === selectedPathId) ?? null,
    [paths, selectedPathId],
  );
  const structuredJsonStale = Boolean(generatedStructured?.version?.markdownEditedAt);
  const activeConfirmedRequirementLabel = activeConfirmedRequirement ? basenamePath(activeConfirmedRequirement.markdownPath) : "";
  const activeConfirmedStructured = activeConfirmedRequirement?.structured ?? null;
  const confirmedSuccessCriteria = activeConfirmedStructured?.reportFramework?.flatMap((item) => item.keyQuestions ?? []) ?? [];
  const sourceDocuments = generatedStructured?.sourceDocuments ?? [];
  const sourceRefEntries = useMemo(
    () => Object.entries(generatedStructured?.sourceRefs ?? {}).flatMap(([fieldPath, refs]) =>
      refs.map((ref) => ({ fieldPath, ...ref })),
    ),
    [generatedStructured],
  );

  const canGenerate = Boolean(
    selectedPath
      && activeConfirmedRequirement
      && !generating,
  );
  const canLegacyGenerate = Boolean(
    selectedPath
      && draft.projectName.trim()
      && draft.businessGoal.trim()
      && draft.businessQuestions.trim()
      && !generating,
  );
  const canCommunicate = Boolean(requirementCommunicationWorkspaceId && (communicationInput.trim() || draft.businessGoal.trim() || draft.businessQuestions.trim()) && !communicating && !generating);
  const displayedCommunicationQuestions = scene === "daily"
    ? communicationQuestions.filter((item) => item.priority === "must_confirm").slice(0, 5)
    : communicationQuestions;
  const pendingMustCount = communicationQuestions.filter((item) => item.priority === "must_confirm" && item.status === "pending").length;
  const canConfirmCommunication = Boolean(requirementCommunicationWorkspaceId && selectedPath && communicationResult && pendingMustCount === 0 && !confirmingCommunication && !communicating && !generating);

  const loadVersions = useCallback(async (pathId: number) => {
    try {
      const result = await api.listBusinessRequirementVersions(pathId);
      const nextVersions = result.versions.filter((version) => versionKind(version) !== "communication");
      setVersions(nextVersions);
      setSelectedVersionId((current) => nextVersions.some((version) => version.id === current) ? current : nextVersions[0]?.id ?? "");
      return nextVersions;
    } catch {
      setVersions([]);
      setSelectedVersionId("");
      return [];
    }
  }, []);

  const loadPaths = useCallback(async () => {
    setLoadingPaths(true);
    setError("");
    try {
      if (!scope) {
        setPaths([]);
        setSelectedPathId("");
        setDocumentOptions([]);
        setSelectedDocumentId("");
        setVersions([]);
        setSelectedVersionId("");
        return;
      }
      const [nextPaths, cleanPaths] = await Promise.all([
        scope.type === "workspace"
          ? api.listWorkspacePaths(scope.workspaceId, "report")
          : scope.type === "session"
            ? api.listSessionPaths(scope.sessionId, "report")
            : api.listFlowPaths(scope.flowId, "report"),
        scope.type === "workspace"
          ? api.listWorkspacePaths(scope.workspaceId, "clean_data")
          : scope.type === "session"
            ? api.listSessionPaths(scope.sessionId, "clean_data")
            : api.listFlowPaths(scope.flowId, "clean_data"),
      ]);
      setPaths(nextPaths);
      setSelectedPathId((current) => nextPaths.some((path) => String(path.id) === current) ? current : String(nextPaths[0]?.id ?? ""));
      const scanned = await Promise.all([...cleanPaths, ...nextPaths].map(async (path) => {
        if (path.kind === "file") {
          return isRequirementDocumentFile(path.path)
            ? [{ id: `${path.id}:`, label: basenamePath(path.path), pathId: path.id, relPath: "", folder: path.folder }]
            : [];
        }
        const tree = await api.workspacePathTree(path.id);
        return flattenFiles(tree)
          .filter((file) => file.kind === "file")
          .filter((file) => isRequirementDocumentFile(file.name))
          .map((file) => ({
            id: `${path.id}:${file.path}`,
            label: `${basenamePath(path.path)}/${file.path}`,
            pathId: path.id,
            relPath: file.path,
            folder: path.folder,
          }));
      }));
      const nextDocuments = scanned.flat();
      setDocumentOptions(nextDocuments);
      setSelectedDocumentId((current) => nextDocuments.some((item) => item.id === current) ? current : nextDocuments[0]?.id ?? "");
    } catch (err) {
      setError(String(err));
      setPaths([]);
      setSelectedPathId("");
      setDocumentOptions([]);
      setSelectedDocumentId("");
      setVersions([]);
      setSelectedVersionId("");
    } finally {
      setLoadingPaths(false);
    }
  }, [scope]);

  useEffect(() => {
    void loadPaths();
  }, [loadPaths]);

  useEffect(() => {
    if (selectedPath) void loadVersions(selectedPath.id);
  }, [loadVersions, selectedPath]);

  const updateField = (field: keyof RequirementDraft, value: string) => {
    setDraft((current) => ({ ...current, [field]: value }));
  };

  const applyTemplate = () => {
    const template = REQUIREMENT_TEMPLATES.find((item) => item.id === selectedTemplateId);
    if (!template) return;
    setDraft((current) => ({
      ...current,
      businessBackground: current.businessBackground || template.draft.businessBackground || "",
      businessGoal: current.businessGoal || template.draft.businessGoal || "",
      businessQuestions: current.businessQuestions || template.draft.businessQuestions || "",
      decisionScenario: current.decisionScenario || template.draft.decisionScenario || "",
      stakeholders: current.stakeholders || template.draft.stakeholders || "",
      knownData: current.knownData || template.draft.knownData || "",
      constraints: current.constraints || template.draft.constraints || "",
      outputPreference: current.outputPreference || template.draft.outputPreference || "",
      extraPrompt: current.extraPrompt || template.draft.extraPrompt || "",
    }));
  };

  const importCommunicationDocuments = async (
    label: string,
    source: CommunicationMaterial["source"],
    documentsInput: RequirementImportDocumentInput[],
    fallbackText: string,
    fallbackWarning?: string,
  ) => {
    setImportingMaterial(true);
    setCommunicationError("");
    try {
      if (!requirementCommunicationWorkspaceId) throw new Error("缺少 workspace id，无法调用导入材料 API");
      const result = await api.runRequirementImportDocuments(requirementCommunicationWorkspaceId, {
        scene,
        documents: documentsInput,
        message: communicationInput.trim() || undefined,
        model: model || undefined,
      });
      setCommunicationMaterials((current) => [...current, materialFromImportResult(label, source, result)]);
    } catch (err) {
      const fallback = extractCommunicationMaterial(label, fallbackText, source, fallbackWarning ?? `本地启发式，未走服务端导入：${String(err)}`);
      setCommunicationMaterials((current) => [...current, fallback]);
    } finally {
      setImportingMaterial(false);
    }
  };

  const addRegisteredDocument = () => {
    const option = documentOptions.find((item) => item.id === selectedDocumentId);
    if (!option || communicationMaterials.some((item) => item.source === "registered" && item.label === option.label)) return;
    const cleanDataWarning = option.folder === "clean_data" ? "clean_data 只传路径元信息，服务端不会读取正文。" : undefined;
    void importCommunicationDocuments(
      option.label,
      "registered",
      [{ source: importSourceForOption(option), pathId: option.pathId, relPath: option.relPath || undefined, name: option.label }],
      cleanDataWarning ?? `登记材料：${option.label}`,
      cleanDataWarning,
    );
  };

  const addPastedMaterial = () => {
    const content = pastedMaterial.trim();
    if (!content) return;
    void importCommunicationDocuments(`粘贴材料 ${communicationMaterials.length + 1}`, "pasted", [{ source: "localText", localText: content, name: `粘贴材料 ${communicationMaterials.length + 1}` }], content);
    setPastedMaterial("");
  };

  const uploadTextMaterial = async (file: File) => {
    try {
      setImportingMaterial(true);
      setCommunicationError("");
      const content = await file.text();
      if (!content.trim()) {
        setCommunicationError("上传文本为空，请选择包含文字内容的 txt/md/csv/json/log 文件。");
        return;
      }
      await importCommunicationDocuments(file.name, "uploaded", [{ source: "localText", localText: content, name: file.name }], content);
    } catch (err) {
      setCommunicationError(`上传文本失败：${String(err)}`);
    } finally {
      setImportingMaterial(false);
    }
  };

  const applyCommunicationMaterial = (material: CommunicationMaterial) => {
    setCommunicationInput((current) => [
      current.trim(),
      material.suggestedMessage,
      material.riskNotes.length > 0 ? `导入材料风险提示（需确认）:\n${material.riskNotes.map((item) => `- ${item}`).join("\n")}` : "",
    ].filter(Boolean).join("\n\n"));
    setCommunicationQuestions((current) => [
      ...current,
      ...material.extractedQuestions.map((question, index): RequirementCommunicationQuestion => ({
        id: `${material.id}-q-${index}`,
        priority: "should_confirm",
        category: "沟通材料",
        question,
        why: `来自沟通材料《${material.label}》，需要用户确认后才可作为事实。`,
        status: "pending",
      })),
    ]);
    setCommunicationAssumptions((current) => [
      ...current,
      ...material.extractedAssumptions.map((text, index): RequirementCommunicationAssumption => ({
        id: `${material.id}-a-${index}`,
        text,
        status: "proposed",
        source: "user",
      })),
    ]);
    setCommunicationTurns((current) => [...current, { id: `${material.id}-apply`, role: "system", content: `已将沟通材料《${material.label}》合入本轮沟通；抽取项仍需确认，不会直接成为事实。` }]);
  };

  const openVersion = useCallback(async () => {
    if (!selectedPath || !selectedVersionId) return;
    const version = versions.find((item) => item.id === selectedVersionId);
    if (!version) return;
    setError("");
    try {
      const result = await api.getBusinessRequirementVersion({
        pathId: selectedPath.id,
        markdownPath: version.markdownPath,
        jsonPath: version.jsonPath,
      });
      const structured = isStructuredOutput(result.structured) ? result.structured : null;
      const confirmedStructured = isConfirmedRequirementStructured(result.structured) ? result.structured : null;
      if (isConfirmedRequirementJsonPath(version.jsonPath)) {
        setActiveConfirmedRequirement({
          markdownPath: version.markdownPath,
          jsonPath: version.jsonPath,
          content: result.content,
          structured: confirmedStructured,
          source: "selected_version",
          scene: confirmedStructured?.communication?.scene,
          confirmedAt: version.generatedAt,
        });
      } else {
        setGeneratedPath(version.markdownPath);
        setGeneratedJsonPath(version.jsonPath);
        setGeneratedContent(result.content);
        setEditedContent(result.content);
        setGeneratedStructured(structured);
      }
      const requirementInput = structured?.version?.requirementInput;
      if (requirementInput) setDraft(draftFromRequirementInput(requirementInput));
      setDiffContent("");
      setActiveResult("framework");
      setEditingFramework(false);
      setEditingClarification(false);
      setEditingReportFramework(false);
      setSaveMessage("");
    } catch (err) {
      setError(String(err));
    }
  }, [selectedPath, selectedVersionId, versions]);

  // On first load of each report path, auto-open the latest saved version so the business background
  // (left draft) and framework preview survive a page refresh / backend restart. One-shot per path:
  // never clobbers an in-progress generate (which sets the ref itself) or a manual version switch.
  useEffect(() => {
    if (!selectedPath || !selectedVersionId || generating || clarifying) return;
    if (autoRestoredPathRef.current === selectedPath.id) return;
    autoRestoredPathRef.current = selectedPath.id;
    void openVersion();
  }, [selectedPath, selectedVersionId, generating, clarifying, openVersion]);

  const generate = useCallback(async () => {
    if (!canGenerate || !selectedPath || !activeConfirmedRequirement || !requirementCommunicationWorkspaceId) return;
    autoRestoredPathRef.current = selectedPath.id;
    setError("");
    setGeneratedPath("");
    setGeneratedJsonPath("");
    setGeneratedContent("");
    setGeneratedStructured(null);
    setDiffContent("");
    setEditedContent("");
    setEditedClarificationContent("");
    setEditingFramework(false);
    setEditingClarification(false);
    setEditingReportFramework(false);
    setSinkMessage("");
    setSaveMessage("");
    await generateTask.start(async () => {
      const result = await api.generateAnalysisFrameworkFromConfirmed(requirementCommunicationWorkspaceId, {
        pathId: selectedPath.id,
        confirmedRequirementJsonPath: activeConfirmedRequirement.jsonPath,
        model: model || undefined,
      });
      void loadVersions(selectedPath.id);
      onGenerated?.();
      return {
        path: result.path,
        jsonPath: result.jsonPath,
        content: result.content,
        structured: result.structured,
      };
    });
  }, [activeConfirmedRequirement, canGenerate, loadVersions, model, onGenerated, requirementCommunicationWorkspaceId, selectedPath, generateTask]);

  const generateLegacyDirect = useCallback(async () => {
    if (!canLegacyGenerate || !selectedPath) return;
    autoRestoredPathRef.current = selectedPath.id;
    setError("");
    setGeneratedPath("");
    setGeneratedJsonPath("");
    setGeneratedContent("");
    setGeneratedStructured(null);
    setDiffContent("");
    setEditedContent("");
    setEditedClarificationContent("");
    setEditingFramework(false);
    setEditingClarification(false);
    setEditingReportFramework(false);
    setSinkMessage("");
    setSaveMessage("");
    await generateTask.start(async () => {
      const result = await api.generateBusinessRequirement({
        pathId: selectedPath.id,
        documents: [],
        requirement: {
          projectName: draft.projectName.trim(),
          businessBackground: draft.businessBackground.trim(),
          businessGoal: draft.businessGoal.trim(),
          businessQuestions: draft.businessQuestions.trim(),
          decisionScenario: draft.decisionScenario.trim(),
          stakeholders: draft.stakeholders.trim(),
          knownData: draft.knownData.trim(),
          constraints: draft.constraints.trim(),
          outputPreference: draft.outputPreference.trim(),
          extraPrompt: draft.extraPrompt.trim(),
        },
        model: model || undefined,
      });
      void loadVersions(selectedPath.id);
      onGenerated?.();
      return {
        path: result.path,
        jsonPath: result.jsonPath,
        content: result.content,
        structured: result.structured,
      };
    });
  }, [canLegacyGenerate, draft, loadVersions, model, onGenerated, selectedPath, generateTask]);

  useEffect(() => {
    if (generateTask.status !== "done" || !generateTask.data) return;
    if (lastAppliedGenerateRef.current === generateTask.data) return;
    lastAppliedGenerateRef.current = generateTask.data;
    const data = generateTask.data;
    setGeneratedPath(data.path);
    setGeneratedJsonPath(data.jsonPath);
    setGeneratedContent(data.content);
    setEditedContent(data.content);
    setGeneratedStructured(isStructuredOutput(data.structured) ? data.structured : null);
    setDiffContent("");
    setActiveResult("framework");
  }, [generateTask.status, generateTask.data]);

  const startEditFramework = () => {
    if (!generatedContent || !generatedPath) return;
    setEditedContent(generatedContent);
    setEditingFramework(true);
    setSaveMessage("");
  };

  const cancelEditFramework = () => {
    setEditedContent(generatedContent);
    setEditingFramework(false);
    setSaveMessage("");
  };

  const compareWithPreviousVersion = async () => {
    if (!selectedPath || !generatedPath || diffing) return;
    const currentIndex = versions.findIndex((version) => version.markdownPath === generatedPath);
    const previousVersion = currentIndex >= 0 ? versions[currentIndex + 1] : undefined;
    if (!previousVersion) {
      setDiffContent("没有可对比的上一版。");
      setActiveResult("diff");
      return;
    }
    setDiffing(true);
    setError("");
    try {
      const previous = await api.getBusinessRequirementVersion({
        pathId: selectedPath.id,
        markdownPath: previousVersion.markdownPath,
        jsonPath: previousVersion.jsonPath,
      });
      const diff = buildLineDiff(previous.content, generatedContent);
      setDiffContent([
        `# 与上一版对比`,
        "",
        `当前版本：${generatedPath}`,
        `上一版本：${previousVersion.markdownPath}`,
        "",
        "```diff",
        diff || "两版内容无差异",
        "```",
      ].join("\n"));
      setActiveResult("diff");
    } catch (err) {
      setError(String(err));
    } finally {
      setDiffing(false);
    }
  };

  const saveFramework = async () => {
    if (!selectedPath || !generatedPath || savingFramework) return;
    setSavingFramework(true);
    setError("");
    setSaveMessage("");
    try {
      await api.updateBusinessRequirementVersion({
        pathId: selectedPath.id,
        markdownPath: generatedPath,
        content: editedContent,
      });
      const nextContent = editedContent.endsWith("\n") ? editedContent : `${editedContent}\n`;
      setGeneratedContent(nextContent);
      setEditedContent(nextContent);
      setGeneratedStructured((current) => current ? {
        ...current,
        version: {
          ...(current.version ?? {}),
          markdownEditedAt: Date.now(),
          jsonStaleReason: "Markdown was edited manually after this structured JSON was generated.",
        },
      } : current);
      setEditingFramework(false);
      setSaveMessage("已保存当前分析框架，结构化 JSON 已标记为过期");
      void loadVersions(selectedPath.id);
      onGenerated?.();
    } catch (err) {
      setError(String(err));
    } finally {
      setSavingFramework(false);
    }
  };

  const sinkToBusinessContext = async () => {
    const workspaceId = selectedPath?.workspaceId;
    if (!workspaceId || !generatedStructured || sinkingContext) return;
    if (structuredJsonStale) {
      setSinkMessage("当前 Markdown 已人工编辑，结构化 JSON 不是最新内容；请重新生成后再沉淀");
      return;
    }
    const drafts = buildBusinessContextDrafts(generatedStructured);
    if (drafts.length === 0) {
      setSinkMessage("没有可沉淀的业务环境条目");
      return;
    }
    setSinkingContext(true);
    setSinkMessage("");
    setError("");
    try {
      await Promise.all(drafts.map((item) => api.createBusinessContext(workspaceId, item)));
      setSinkMessage(`已沉淀 ${drafts.length} 条业务环境`);
      onBusinessContextChanged?.();
    } catch (err) {
      setError(String(err));
    } finally {
      setSinkingContext(false);
    }
  };

  const runCommunication = async () => {
    if (!requirementCommunicationWorkspaceId || !canCommunicate) return;
    const message = communicationMessageFromDraft(communicationInput, draft);
    if (!message.trim()) return;
    setCommunicating(true);
    setCommunicationError("");
    try {
      const history = communicationHistory(communicationTurns, communicationQuestions, communicationAssumptions);
      const result = await api.runRequirementCommunication(requirementCommunicationWorkspaceId, {
        scene,
        message,
        history: history || undefined,
        model: model || undefined,
      });
      setCommunicationTurns((current) => [
        ...current,
        { id: `u-${Date.now()}`, role: "user", content: communicationInput.trim() || draft.businessGoal.trim() || draft.businessQuestions.trim() },
        { id: `s-${Date.now()}`, role: "system", content: `生成 ${result.clarifyingQuestions.length} 个澄清项、${result.assumptions.length} 个假设和 1 份需求草案。` },
      ]);
      setCommunicationQuestions(result.clarifyingQuestions);
      setCommunicationAssumptions(result.assumptions);
      setCommunicationResult(result);
    } catch (err) {
      setCommunicationError(formatCommunicationError(err));
    } finally {
      setCommunicating(false);
    }
  };

  const updateCommunicationQuestion = (id: string, patch: Partial<RequirementCommunicationQuestion>) => {
    setCommunicationQuestions((current) => current.map((item) => item.id === id ? { ...item, ...patch } : item));
  };

  const updateCommunicationAssumption = (id: string, patch: Partial<RequirementCommunicationAssumption>) => {
    setCommunicationAssumptions((current) => current.map((item) => item.id === id ? { ...item, ...patch } : item));
  };

  const applyCommunicationDraft = () => {
    if (!communicationResult) return;
    setDraft((current) => draftFromCommunication({
      ...communicationResult,
      clarifyingQuestions: communicationQuestions,
      assumptions: communicationAssumptions,
      requirementDraft: {
        ...communicationResult.requirementDraft,
        assumptions: communicationAssumptions.filter((item) => item.status === "confirmed").map((item) => item.text),
        questions: communicationQuestions.filter((item) => item.status !== "answered").map((item) => item.question),
      },
    }, current));
    setCommunicationTurns((current) => [...current, { id: `s-${Date.now()}-apply`, role: "system", content: "用户已将沟通草案应用到左侧业务需求表单，尚未写入正式业务需求。" }]);
  };

  const confirmCommunicationAsRequirement = async () => {
    if (!requirementCommunicationWorkspaceId || !selectedPath || !communicationResult || !canConfirmCommunication) return;
    setConfirmingCommunication(true);
    setCommunicationError("");
    try {
      const mergedResult: RequirementCommunicationResult = {
        ...communicationResult,
        clarifyingQuestions: communicationQuestions,
        assumptions: communicationAssumptions,
        requirementDraft: {
          ...communicationResult.requirementDraft,
          assumptions: communicationAssumptions.filter((item) => item.status === "confirmed").map((item) => item.text),
          questions: communicationQuestions.filter((item) => item.status !== "answered").map((item) => item.question),
        },
      };
      const result = await api.confirmRequirementCommunication(requirementCommunicationWorkspaceId, {
        pathId: selectedPath.id,
        scene,
        title: draft.projectName.trim() || mergedResult.requirementDraft.objective || "确认业务需求",
        confirmedBy: "user",
        message: communicationInput.trim(),
        history: communicationHistory(communicationTurns, communicationQuestions, communicationAssumptions) || undefined,
        clarifyingQuestions: communicationQuestions,
        assumptions: communicationAssumptions,
        requirementDraft: mergedResult.requirementDraft,
        riskNotes: mergedResult.riskNotes,
      });
      const confirmedStructured = isConfirmedRequirementStructured(result.structured) ? result.structured : null;
      setDraft((current) => draftFromCommunication(mergedResult, current));
      setGeneratedPath(result.path);
      setGeneratedJsonPath(result.jsonPath);
      setGeneratedContent(result.content);
      setEditedContent(result.content);
      setGeneratedStructured(null);
      setActiveConfirmedRequirement({
        markdownPath: result.path,
        jsonPath: result.jsonPath,
        content: result.content,
        structured: confirmedStructured,
        source: "just_confirmed",
        scene,
        confirmedAt: Date.now(),
      });
      setActiveResult("framework");
      setCommunicationTurns((current) => [...current, { id: `s-${Date.now()}-confirm`, role: "system", content: `用户已确认并写入正式业务需求：${result.path}` }]);
      const nextVersions = await loadVersions(selectedPath.id);
      const confirmedVersion = nextVersions.find((version) => version.jsonPath === result.jsonPath || version.markdownPath === result.path);
      if (confirmedVersion) setSelectedVersionId(confirmedVersion.id);
      setActiveSubTab("framework");
      onGenerated?.();
    } catch (err) {
      setCommunicationError(formatCommunicationError(err));
    } finally {
      setConfirmingCommunication(false);
    }
  };

  const startEditClarification = () => {
    if (!clarificationContent) return;
    setEditedClarificationContent(clarificationContent);
    setEditingClarification(true);
  };

  const saveClarification = () => {
    const next = editedClarificationContent.endsWith("\n") ? editedClarificationContent : `${editedClarificationContent}\n`;
    setClarificationContent(next);
    setEditedClarificationContent(next);
    setEditingClarification(false);
  };

  const updateReportFramework = (items: NonNullable<BusinessRequirementStructuredOutput["reportFramework"]>) => {
    setGeneratedStructured((current) => current ? { ...current, reportFramework: items } : current);
  };

  const startEditReportFramework = () => {
    setGeneratedStructured((current) => {
      if (!current) return current;
      return (current.reportFramework?.length ?? 0) > 0
        ? current
        : { ...current, reportFramework: buildDefaultReportFramework() };
    });
    setEditingReportFramework(true);
  };

  const saveReportFramework = async () => {
    if (!selectedPath || !generatedPath || !generatedStructured || savingFramework) return;
    setSavingFramework(true);
    setError("");
    setSaveMessage("");
    try {
      const nextContent = renderBusinessRequirementMarkdown(generatedStructured);
      await api.updateBusinessRequirementVersion({
        pathId: selectedPath.id,
        markdownPath: generatedPath,
        content: nextContent,
        structured: generatedStructured,
      });
      const contentWithNewline = nextContent.endsWith("\n") ? nextContent : `${nextContent}\n`;
      setGeneratedContent(contentWithNewline);
      setEditedContent(contentWithNewline);
      setEditingReportFramework(false);
      setSaveMessage("已保存报告框架，Markdown 与结构化 JSON 已同步更新");
      void loadVersions(selectedPath.id);
      onGenerated?.();
    } catch (err) {
      setError(String(err));
    } finally {
      setSavingFramework(false);
    }
  };

  const pathHint = paths.length === 0
    ? "请先在「报告输出」tab 添加报告输出文件夹或文件"
    : "选择业务需求分析框架的保存位置";

  return (
    <div className="flex h-full min-h-0 flex-col bg-white dark:bg-neutral-950">
      <div className="flex h-12 shrink-0 items-center gap-4 border-b border-neutral-200 px-4 dark:border-neutral-800">
        <div className="flex items-center gap-2 text-[13px] font-semibold text-neutral-900 dark:text-neutral-100">
          <ClipboardList className="h-4 w-4 text-neutral-500" strokeWidth={1.75} />
          业务需求
        </div>
        <select
          value={selectedPathId}
          onChange={(event) => setSelectedPathId(event.target.value)}
          disabled={loadingPaths || generating || paths.length === 0}
          className="h-8 min-w-[220px] max-w-[360px] flex-1 rounded-md border border-neutral-200 bg-transparent px-2 text-[12px] text-neutral-700 outline-none disabled:opacity-50 dark:border-neutral-700 dark:text-neutral-200"
        >
          {paths.length === 0 ? (
            <option value="">{loadingPaths ? "正在读取报告输出路径..." : pathHint}</option>
          ) : (
            paths.map((path) => (
              <option key={path.id} value={path.id}>
                {basenamePath(path.path)} · {path.kind === "dir" ? "文件夹" : "文件同级目录"}
              </option>
            ))
          )}
        </select>
        <button
          onClick={() => void loadPaths()}
          disabled={loadingPaths || generating}
          className="inline-flex h-8 items-center gap-1.5 rounded-md px-2 text-[12px] text-neutral-500 hover:bg-neutral-100 disabled:opacity-50 dark:text-neutral-400 dark:hover:bg-neutral-800"
        >
          <RefreshCw className={loadingPaths ? "h-3.5 w-3.5 animate-spin" : "h-3.5 w-3.5"} strokeWidth={1.75} />
          刷新
        </button>
        <div className="inline-flex h-8 rounded-md border border-neutral-200 bg-neutral-50 p-0.5 dark:border-neutral-700 dark:bg-neutral-900">
          {REQUIREMENT_SUB_TABS.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveSubTab(tab.id)}
              className={activeSubTab === tab.id
                ? "rounded px-3 text-[12px] font-medium text-neutral-900 shadow-sm dark:bg-neutral-800 dark:text-neutral-100"
                : "rounded px-3 text-[12px] text-neutral-500 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-neutral-100"}
              title={tab.hint}
            >
              {tab.label}
            </button>
          ))}
        </div>
        <div className="min-w-0 flex-1 text-right text-[11.5px] text-neutral-500 dark:text-neutral-400">
          {activeSubTab === "communication" ? "先澄清诉求与假设，再确认正式需求" : "管理已确认需求，生成分析与报告框架"}
        </div>
      </div>

      {(error || generateTask.error) && (
        <div className="flex items-center gap-1.5 border-b border-rose-100 bg-rose-50 px-4 py-2 text-[12px] text-rose-600 dark:border-rose-950 dark:bg-rose-950/30 dark:text-rose-300">
          <AlertTriangle className="h-3.5 w-3.5" />
          {error || generateTask.error}
        </div>
      )}

      {activeSubTab === "communication" ? (
        <RequirementCommunicationPane>
          <div className="rounded-xl border border-blue-100 bg-blue-50/70 p-4 dark:border-blue-950/60 dark:bg-blue-950/20">
            <div className="mb-3 flex items-start justify-between gap-3">
              <div>
                <div className="flex items-center gap-2 text-[12px] font-semibold text-blue-900 dark:text-blue-100">
                  <ClipboardList className="h-3.5 w-3.5" strokeWidth={1.75} />
                  需求沟通 · {sceneMeta.label} · {sceneMeta.mode}
                </div>
                <p className="mt-1 text-[11.5px] leading-4 text-blue-700/80 dark:text-blue-200/80">{sceneMeta.note}</p>
              </div>
              <span className="shrink-0 rounded-full bg-white px-2 py-1 text-[11px] font-medium text-blue-700 dark:bg-blue-950 dark:text-blue-200">
                确认前不写入正式需求
              </span>
            </div>
            <textarea
              value={communicationInput}
              onChange={(event) => setCommunicationInput(event.target.value)}
              disabled={communicating || generating}
              placeholder="先用自然语言写诉求，例如：想分析本月会员复购下降原因，并形成下周运营动作。"
              className="h-20 w-full resize-none rounded-md border border-blue-100 bg-white p-2.5 text-[12.5px] leading-5 text-neutral-800 outline-none focus:border-blue-300 disabled:opacity-50 dark:border-blue-900 dark:bg-neutral-950 dark:text-neutral-200"
            />
            <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap gap-1.5">
                {COMMUNICATION_CATEGORIES.map((category) => (
                  <span key={category} className="rounded-full bg-white px-2 py-1 text-[11px] text-blue-700 dark:bg-blue-950 dark:text-blue-200">{category}</span>
                ))}
              </div>
              <button
                onClick={() => void runCommunication()}
                disabled={!canCommunicate}
                className="inline-flex h-8 items-center gap-1.5 rounded-md bg-blue-700 px-3 text-[12px] font-medium text-white hover:bg-blue-600 disabled:opacity-50 dark:bg-blue-500 dark:hover:bg-blue-400"
              >
                {communicating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" strokeWidth={1.75} />}
                {communicating ? "沟通中..." : "生成澄清清单与草案"}
              </button>
            </div>
            {!requirementCommunicationWorkspaceId && (
              <p className="mt-2 text-[11.5px] text-amber-700 dark:text-amber-300">当前入口缺少 workspace id，需求沟通 API 暂不可用；可继续使用下方手工表单。</p>
            )}
            {communicationError && <p className="mt-2 text-[11.5px] text-rose-600 dark:text-rose-300">{communicationError}</p>}

            <div className="mt-3 rounded-lg border border-blue-100 bg-white/80 p-3 text-[11.5px] leading-4 text-blue-800 dark:border-blue-900 dark:bg-neutral-950/80 dark:text-blue-200">
              <div className="mb-1 font-medium">可用上下文引用</div>
              <p>专用 BRC API 会按当前 workspace 聚合 business_context、metric_definitions、历史需求/报告摘要和登记路径元信息；本页不读取正文、不传 draw_data 原始行。</p>
              <p className="mt-1 text-blue-700/75 dark:text-blue-200/70">当前确认写入路径：{selectedPath ? basenamePath(selectedPath.path) : "未选择"}</p>
            </div>

            <div className="mt-3 rounded-lg border border-blue-100 bg-white p-3 dark:border-blue-900 dark:bg-neutral-950">
              <div className="mb-2 flex items-center justify-between gap-3">
                <div className="flex items-center gap-1.5 text-[12px] font-medium text-neutral-700 dark:text-neutral-200">
                  <FileText className="h-3.5 w-3.5 text-blue-500" strokeWidth={1.75} />
                  导入沟通材料
                </div>
                <span className="text-[11px] text-neutral-400">只合入沟通上下文，不直接生成分析框架</span>
              </div>
              <div className="flex gap-2">
                <select
                  value={selectedDocumentId}
                  onChange={(event) => setSelectedDocumentId(event.target.value)}
                  disabled={loadingPaths || generating || communicating || documentOptions.length === 0}
                  className="h-8 min-w-0 flex-1 rounded-md border border-neutral-200 bg-transparent px-2 text-[12px] text-neutral-700 outline-none disabled:opacity-50 dark:border-neutral-700 dark:text-neutral-200"
                >
                  {documentOptions.length === 0 ? (
                    <option value="">{loadingPaths ? "正在扫描材料..." : "未发现已登记的业务需求/报告材料"}</option>
                  ) : (
                    documentOptions.map((option) => <option key={option.id} value={option.id}>{option.label}{option.folder === "clean_data" ? " · clean_data 元信息" : ""}</option>)
                  )}
                </select>
                <button
                  onClick={addRegisteredDocument}
                  disabled={!selectedDocumentId || generating || communicating}
                  className="h-8 rounded-md bg-neutral-900 px-3 text-[12px] font-medium text-white hover:bg-neutral-700 disabled:opacity-50 dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-white"
                >
                  添加登记文档
                </button>
              </div>
              <div className="mt-2 grid gap-2 md:grid-cols-[minmax(0,1fr)_auto]">
                <textarea
                  value={pastedMaterial}
                  onChange={(event) => setPastedMaterial(event.target.value)}
                  placeholder="粘贴线下沟通纪要、历史需求摘要或人工脱敏后的材料。"
                  className="h-20 resize-none rounded-md border border-neutral-200 bg-neutral-50 p-2 text-[12px] leading-4 text-neutral-800 outline-none focus:border-neutral-400 dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-200"
                />
                <div className="flex flex-row gap-1.5 md:flex-col">
                  <button
                    onClick={addPastedMaterial}
                    disabled={!pastedMaterial.trim()}
                    className="h-8 rounded-md border border-neutral-200 px-2 text-[11.5px] font-medium text-neutral-700 hover:bg-neutral-100 disabled:opacity-50 dark:border-neutral-700 dark:text-neutral-200 dark:hover:bg-neutral-800"
                  >
                    添加粘贴文本
                  </button>
                  <input
                    id="business-requirement-material-upload"
                    ref={materialFileInputRef}
                    type="file"
                    accept=".txt,.md,.markdown,.csv,.tsv,.json,.log,text/*"
                    disabled={importingMaterial || communicating || generating}
                    className="hidden"
                    onChange={(event) => {
                      const file = event.target.files?.[0];
                      event.currentTarget.value = "";
                      if (file) void uploadTextMaterial(file);
                    }}
                  />
                  <label
                    htmlFor="business-requirement-material-upload"
                    className={importingMaterial || communicating || generating
                      ? "inline-flex h-8 cursor-not-allowed items-center justify-center rounded-md border border-neutral-200 px-2 text-[11.5px] font-medium text-neutral-400 opacity-60 dark:border-neutral-700"
                      : "inline-flex h-8 cursor-pointer items-center justify-center rounded-md border border-neutral-200 px-2 text-[11.5px] font-medium text-neutral-700 hover:bg-neutral-100 dark:border-neutral-700 dark:text-neutral-200 dark:hover:bg-neutral-800"}
                  >
                    {importingMaterial ? "上传中..." : "上传文本"}
                  </label>
                </div>
              </div>
              {importingMaterial && (
                <p className="mt-2 text-[11.5px] leading-4 text-blue-600 dark:text-blue-300">
                  正在导入沟通材料...
                </p>
              )}
              <p className="mt-2 text-[11.5px] leading-4 text-neutral-500 dark:text-neutral-400">
                支持历史 business_requirements / report 摘要；不提供 draw_data 或 data_exploration 来源。clean_data 仅展示元信息和聚合数据知情提示。
              </p>
              {communicationMaterials.length > 0 && (
                <div className="mt-3 grid gap-2">
                  {communicationMaterials.map((material) => (
                    <div key={material.id} className="rounded-md border border-neutral-200 bg-neutral-50 p-2 dark:border-neutral-800 dark:bg-neutral-900">
                      <div className="flex items-center justify-between gap-2">
                        <div className="min-w-0">
                          <div className="truncate text-[12px] font-medium text-neutral-800 dark:text-neutral-100" title={material.label}>{material.label}</div>
                          <div className="text-[10.5px] text-neutral-400">
                            {material.source === "registered" ? "登记文档" : material.source === "uploaded" ? "上传文本" : "粘贴文本"}
                            {material.fallback ? " · 本地启发式，未走服务端导入" : " · 服务端导入"}
                          </div>
                        </div>
                        <button
                          onClick={() => applyCommunicationMaterial(material)}
                          className="shrink-0 rounded-md bg-blue-700 px-2 py-1.5 text-[11.5px] font-medium text-white hover:bg-blue-600 dark:bg-blue-500 dark:hover:bg-blue-400"
                        >
                          应用到本轮沟通
                        </button>
                      </div>
                      <p className="mt-2 text-[11.5px] leading-4 text-neutral-600 dark:text-neutral-300">{material.summary}</p>
                      {material.warnings.length > 0 && (
                        <div className="mt-2 rounded-md border border-amber-200 bg-amber-50 px-2 py-1.5 text-[11.5px] leading-4 text-amber-700 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-300">
                          {material.warnings.map((item, index) => <div key={`${material.id}-warning-${index}`}>- {item}</div>)}
                        </div>
                      )}
                      {material.riskNotes.length > 0 && (
                        <div className="mt-2 rounded-md border border-rose-200 bg-rose-50 px-2 py-1.5 text-[11.5px] leading-4 text-rose-700 dark:border-rose-900/60 dark:bg-rose-950/30 dark:text-rose-300">
                          {material.riskNotes.map((item, index) => <div key={`${material.id}-risk-${index}`}>- {item}</div>)}
                        </div>
                      )}
                      <div className="mt-2 grid gap-2 text-[11.5px] leading-4 md:grid-cols-2">
                        <div>
                          <div className="mb-1 font-medium text-neutral-700 dark:text-neutral-200">抽取出的待确认问题</div>
                          <ul className="space-y-1 text-neutral-500 dark:text-neutral-400">
                            {material.extractedQuestions.map((item, index) => <li key={`${material.id}-q-view-${index}`}>- {item}</li>)}
                          </ul>
                        </div>
                        <div>
                          <div className="mb-1 font-medium text-neutral-700 dark:text-neutral-200">抽取出的假设</div>
                          {material.extractedAssumptions.length > 0 ? (
                            <ul className="space-y-1 text-neutral-500 dark:text-neutral-400">
                              {material.extractedAssumptions.map((item, index) => <li key={`${material.id}-a-view-${index}`}>- {item}</li>)}
                            </ul>
                          ) : <p className="text-neutral-400">暂无明确假设。</p>}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {communicationTurns.length > 0 && (
              <div className="mt-3 rounded-lg border border-blue-100 bg-white p-3 dark:border-blue-900 dark:bg-neutral-950">
                <div className="mb-2 text-[12px] font-medium text-neutral-700 dark:text-neutral-200">沟通记录</div>
                <div className="space-y-1.5">
                  {communicationTurns.slice(-4).map((turn) => (
                    <div key={turn.id} className="text-[11.5px] leading-4 text-neutral-600 dark:text-neutral-300">
                      <span className="font-medium text-neutral-900 dark:text-neutral-100">{turn.role === "user" ? "用户" : "系统"}：</span>{turn.content}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {communicationQuestions.length > 0 && (
              <div className="mt-3 rounded-lg border border-blue-100 bg-white p-3 dark:border-blue-900 dark:bg-neutral-950">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <div className="text-[12px] font-medium text-neutral-700 dark:text-neutral-200">澄清清单</div>
                  <span className="text-[11px] text-neutral-500 dark:text-neutral-400">必须待答 {pendingMustCount}</span>
                </div>
                <div className="space-y-2">
                  {displayedCommunicationQuestions.map((item) => (
                    <div key={item.id} className="rounded-md border border-neutral-200 p-2 dark:border-neutral-800">
                      <div className="mb-1 flex flex-wrap items-center gap-1.5">
                        <span className="rounded-full bg-neutral-100 px-1.5 py-0.5 text-[10.5px] text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300">{item.category}</span>
                        <span className={item.priority === "must_confirm" ? "rounded-full bg-rose-50 px-1.5 py-0.5 text-[10.5px] text-rose-700 dark:bg-rose-950/40 dark:text-rose-300" : "rounded-full bg-amber-50 px-1.5 py-0.5 text-[10.5px] text-amber-700 dark:bg-amber-950/40 dark:text-amber-300"}>{PRIORITY_LABELS[item.priority]}</span>
                        <span className="rounded-full bg-neutral-50 px-1.5 py-0.5 text-[10.5px] text-neutral-500 dark:bg-neutral-900 dark:text-neutral-400">{QUESTION_STATUS_LABELS[item.status]}</span>
                      </div>
                      <p className="text-[12px] font-medium leading-5 text-neutral-800 dark:text-neutral-100">{item.question}</p>
                      <p className="mt-1 text-[11.5px] leading-4 text-neutral-500 dark:text-neutral-400">{item.why}</p>
                      <textarea
                        value={item.answer ?? ""}
                        onChange={(event) => updateCommunicationQuestion(item.id, { answer: event.target.value, status: event.target.value.trim() ? "answered" : "pending" })}
                        placeholder="填写回答，或标记跳过 / 后续确认"
                        className="mt-2 h-14 w-full resize-none rounded-md border border-neutral-200 bg-neutral-50 p-2 text-[12px] leading-4 text-neutral-800 outline-none focus:border-neutral-400 dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-200"
                      />
                      <div className="mt-1 flex gap-1.5">
                        <button onClick={() => updateCommunicationQuestion(item.id, { status: "skipped" })} className="rounded px-2 py-1 text-[11px] text-neutral-500 hover:bg-neutral-100 dark:text-neutral-400 dark:hover:bg-neutral-800">跳过</button>
                        <button onClick={() => updateCommunicationQuestion(item.id, { status: "deferred" })} className="rounded px-2 py-1 text-[11px] text-neutral-500 hover:bg-neutral-100 dark:text-neutral-400 dark:hover:bg-neutral-800">后续确认</button>
                        <button onClick={() => updateCommunicationQuestion(item.id, { status: "assumed" })} className="rounded px-2 py-1 text-[11px] text-neutral-500 hover:bg-neutral-100 dark:text-neutral-400 dark:hover:bg-neutral-800">按假设推进</button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {communicationAssumptions.length > 0 && (
              <div className="mt-3 rounded-lg border border-blue-100 bg-white p-3 dark:border-blue-900 dark:bg-neutral-950">
                <div className="mb-2 text-[12px] font-medium text-neutral-700 dark:text-neutral-200">当前假设</div>
                <div className="space-y-2">
                  {communicationAssumptions.map((item) => item.status !== "rejected" && (
                    <div key={item.id} className="rounded-md border border-neutral-200 p-2 dark:border-neutral-800">
                      <textarea
                        value={item.text}
                        onChange={(event) => updateCommunicationAssumption(item.id, { text: event.target.value })}
                        className="h-14 w-full resize-none rounded-md border border-neutral-200 bg-neutral-50 p-2 text-[12px] leading-4 text-neutral-800 outline-none focus:border-neutral-400 dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-200"
                      />
                      <div className="mt-1 flex flex-wrap items-center gap-1.5">
                        <span className="rounded-full bg-neutral-50 px-1.5 py-0.5 text-[10.5px] text-neutral-500 dark:bg-neutral-900 dark:text-neutral-400">{ASSUMPTION_STATUS_LABELS[item.status]}</span>
                        <button onClick={() => updateCommunicationAssumption(item.id, { status: "confirmed" })} className="rounded px-2 py-1 text-[11px] text-emerald-700 hover:bg-emerald-50 dark:text-emerald-300 dark:hover:bg-emerald-950/30">采纳</button>
                        <button onClick={() => updateCommunicationAssumption(item.id, { status: "deferred" })} className="rounded px-2 py-1 text-[11px] text-neutral-500 hover:bg-neutral-100 dark:text-neutral-400 dark:hover:bg-neutral-800">后续确认</button>
                        <button onClick={() => updateCommunicationAssumption(item.id, { status: "rejected" })} className="rounded px-2 py-1 text-[11px] text-rose-600 hover:bg-rose-50 dark:text-rose-300 dark:hover:bg-rose-950/30">删除</button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {communicationResult && (
              <div className="mt-3 rounded-lg border border-blue-100 bg-white p-3 dark:border-blue-900 dark:bg-neutral-950">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <div className="text-[12px] font-medium text-neutral-700 dark:text-neutral-200">需求草案</div>
                  <div className="flex flex-wrap gap-1.5">
                    <button onClick={applyCommunicationDraft} className="rounded-md bg-neutral-900 px-2.5 py-1.5 text-[11.5px] font-medium text-white hover:bg-neutral-700 dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-white">应用到表单</button>
                    <button onClick={() => void confirmCommunicationAsRequirement()} disabled={!canConfirmCommunication} className="inline-flex items-center gap-1 rounded-md bg-emerald-700 px-2.5 py-1.5 text-[11.5px] font-medium text-white hover:bg-emerald-600 disabled:opacity-50 dark:bg-emerald-500 dark:hover:bg-emerald-400">
                      {confirmingCommunication && <Loader2 className="h-3 w-3 animate-spin" />}
                      确认成正式需求
                    </button>
                  </div>
                </div>
                <div className="grid gap-1.5 text-[11.5px] leading-4 text-neutral-600 dark:text-neutral-300">
                  <p><span className="font-medium text-neutral-900 dark:text-neutral-100">目标：</span>{communicationResult.requirementDraft.objective || "待补充"}</p>
                  <p><span className="font-medium text-neutral-900 dark:text-neutral-100">指标：</span>{communicationResult.requirementDraft.metrics.join("、") || "待补充"}</p>
                  <p><span className="font-medium text-neutral-900 dark:text-neutral-100">输出：</span>{communicationResult.requirementDraft.outputs.join("、") || "待补充"}</p>
                  {scene === "topic" && <p><span className="font-medium text-neutral-900 dark:text-neutral-100">专题评审：</span>请在左侧补充 owner / 评审点 / 交付节奏后再确认。</p>}
                  {scene === "recurring" && <p><span className="font-medium text-neutral-900 dark:text-neutral-100">重复提示：</span>对比历史版本差异后，可把稳定字段沉淀为模板。</p>}
                </div>
              </div>
            )}
          </div>
        </RequirementCommunicationPane>
      ) : (
        <AnalysisFrameworkPane>
          <div className={activeConfirmedRequirement
            ? "border-b border-emerald-100 bg-emerald-50 px-4 py-2 text-[12px] text-emerald-700 dark:border-emerald-950/60 dark:bg-emerald-950/20 dark:text-emerald-300"
            : "border-b border-amber-100 bg-amber-50 px-4 py-2 text-[12px] text-amber-700 dark:border-amber-950/60 dark:bg-amber-950/20 dark:text-amber-300"}
          >
            {activeConfirmedRequirement ? (
              <span>
                当前基于确认需求：<span className="font-mono font-medium">{activeConfirmedRequirementLabel}</span>
                {activeConfirmedRequirement.source === "just_confirmed" ? " · 刚确认" : activeConfirmedRequirement.source === "selected_version" ? " · 来自历史版本" : ""}
              </span>
            ) : (
              <button
                onClick={() => setActiveSubTab("communication")}
                className="font-medium underline-offset-2 hover:underline"
              >
                尚未选择确认需求；请先回到需求沟通确认需求，再生成分析框架。
              </button>
            )}
          </div>
          <div className="flex shrink-0 items-center gap-3 border-b border-neutral-200 px-4 py-3 dark:border-neutral-800">
            <div className="min-w-0 flex-1 text-[12px] text-neutral-500 dark:text-neutral-400">
              当前路径：{selectedPath ? basenamePath(selectedPath.path) : pathHint}
            </div>
            <button
              onClick={() => void generate()}
              disabled={!canGenerate}
              className="inline-flex h-8 items-center gap-1.5 rounded-md bg-neutral-900 px-3 text-[12px] font-medium text-white hover:bg-neutral-700 disabled:opacity-50 dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-white"
            >
              {generating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" strokeWidth={1.75} />}
              {generating ? "生成中..." : "基于确认需求生成分析框架"}
            </button>
            <button
              onClick={() => setActiveResult("guide")}
              className="inline-flex h-8 items-center gap-1.5 rounded-md border border-neutral-200 px-3 text-[12px] font-medium text-neutral-700 hover:bg-neutral-100 dark:border-neutral-700 dark:text-neutral-200 dark:hover:bg-neutral-800"
            >
              <BookOpen className="h-3.5 w-3.5" strokeWidth={1.75} />
              说明
            </button>
          </div>
          <div className="grid min-h-0 grid-cols-1 gap-6 p-6 lg:grid-cols-[minmax(360px,0.9fr)_minmax(0,1.1fr)]">
            <div className="min-h-0 overflow-auto rounded-lg border border-neutral-200 bg-neutral-50/70 p-5 dark:border-neutral-800 dark:bg-neutral-900/60">
          <div className="rounded-lg border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-950">
            <div className="mb-3 flex items-center justify-between gap-2">
              <div className="flex items-center gap-1.5 text-[12px] font-medium text-neutral-700 dark:text-neutral-300">
                <ClipboardList className="h-3.5 w-3.5 text-neutral-500" strokeWidth={1.75} />
                确认需求源
              </div>
              {activeConfirmedRequirement && <span className="rounded-full bg-emerald-50 px-2 py-1 text-[11px] text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-300">已确认</span>}
            </div>
            {activeConfirmedRequirement ? (
              <div className="space-y-3 text-[11.5px] leading-4 text-neutral-600 dark:text-neutral-300">
                <div>
                  <div className="font-mono text-[11px] text-neutral-400" title={activeConfirmedRequirement.jsonPath}>{activeConfirmedRequirementLabel}</div>
                  <div className="mt-1 text-neutral-500 dark:text-neutral-400">
                    {activeConfirmedRequirement.confirmedAt ? formatTime(activeConfirmedRequirement.confirmedAt) : "确认时间未知"} · {activeConfirmedRequirement.scene ?? activeConfirmedStructured?.communication?.scene ?? scene} · {activeConfirmedRequirement.source === "just_confirmed" ? "刚确认" : "历史确认版本"}
                  </div>
                </div>
                <div>
                  <div className="font-medium text-neutral-800 dark:text-neutral-100">业务目标</div>
                  <p className="mt-1 whitespace-pre-wrap">{activeConfirmedStructured?.businessFacts.find((item) => item.startsWith("目标：")) ?? activeConfirmedStructured?.projectName ?? "待确认"}</p>
                </div>
                <div>
                  <div className="font-medium text-neutral-800 dark:text-neutral-100">成功标准</div>
                  <ul className="mt-1 space-y-1">{(confirmedSuccessCriteria.length > 0 ? confirmedSuccessCriteria : activeConfirmedStructured?.analysisQuestions ?? []).map((item, index) => <li key={`success-${index}`}>- {item}</li>)}</ul>
                </div>
                <div>
                  <div className="font-medium text-neutral-800 dark:text-neutral-100">confirmed facts</div>
                  <ul className="mt-1 space-y-1">{(activeConfirmedStructured?.confirmedFacts.length ? activeConfirmedStructured.confirmedFacts : activeConfirmedStructured?.businessFacts ?? []).map((item, index) => <li key={`fact-${index}`}>- {item}</li>)}</ul>
                </div>
                <div>
                  <div className="font-medium text-neutral-800 dark:text-neutral-100">confirmed assumptions</div>
                  {activeConfirmedStructured?.confirmedAssumptions.length ? <ul className="mt-1 space-y-1">{activeConfirmedStructured.confirmedAssumptions.map((item, index) => <li key={`assumption-${index}`}>- {item}</li>)}</ul> : <p className="mt-1 text-neutral-400">暂无已确认假设。</p>}
                </div>
                <div>
                  <div className="font-medium text-neutral-800 dark:text-neutral-100">deferred / skipped / assumed / pending open questions</div>
                  {activeConfirmedStructured?.deferredQuestions.length || activeConfirmedStructured?.openQuestions.length ? <ul className="mt-1 space-y-1">{[...(activeConfirmedStructured?.deferredQuestions ?? []), ...(activeConfirmedStructured?.openQuestions ?? [])].map((item, index) => <li key={`open-${index}`}>- {item}</li>)}</ul> : <p className="mt-1 text-neutral-400">暂无待确认问题。</p>}
                </div>
                <div>
                  <div className="font-medium text-neutral-800 dark:text-neutral-100">风险与限制</div>
                  {activeConfirmedStructured?.risks.length ? <ul className="mt-1 space-y-1">{activeConfirmedStructured.risks.map((item, index) => <li key={`risk-${index}`}>- {item}</li>)}</ul> : <p className="mt-1 text-neutral-400">暂无风险记录。</p>}
                </div>
                <div className="flex flex-wrap gap-2 border-t border-neutral-200 pt-3 dark:border-neutral-800">
                  <button onClick={() => setActiveSubTab("communication")} className="rounded-md border border-neutral-200 px-2.5 py-1.5 text-[11.5px] font-medium text-neutral-700 hover:bg-neutral-100 dark:border-neutral-700 dark:text-neutral-200 dark:hover:bg-neutral-800">返回需求沟通继续补充</button>
                  <button onClick={() => setActiveSubTab("communication")} className="rounded-md border border-amber-200 px-2.5 py-1.5 text-[11.5px] font-medium text-amber-700 hover:bg-amber-50 dark:border-amber-900/60 dark:text-amber-300 dark:hover:bg-amber-950/30">基于当前确认需求创建修订版</button>
                </div>
              </div>
            ) : (
              <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-[12px] leading-5 text-amber-700 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-300">
                还没有确认需求源。请回到「需求沟通」完成确认后，再生成分析框架。
              </div>
            )}
          </div>
          <div className="mt-4 rounded-lg border border-dashed border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-950">
            <button onClick={() => setShowLegacyDirectGenerate((current) => !current)} className="text-[12px] font-medium text-neutral-600 hover:text-neutral-900 dark:text-neutral-300 dark:hover:text-neutral-100">旧路径 / 直接生成（不推荐）</button>
            {showLegacyDirectGenerate && (
              <div className="mt-3 space-y-4">
                <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-[11.5px] leading-4 text-amber-700 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-300">旧路径不会绑定确认需求源，仅用于兼容历史手工填表流程。</p>
                <div className="flex gap-2">
                  <select value={selectedTemplateId} onChange={(event) => setSelectedTemplateId(event.target.value)} disabled={generating || clarifying} className="h-8 min-w-0 flex-1 rounded-md border border-neutral-200 bg-transparent px-2 text-[12px] text-neutral-700 outline-none disabled:opacity-50 dark:border-neutral-700 dark:text-neutral-200">
                    <option value="">选择业务场景模板</option>
                    {REQUIREMENT_TEMPLATES.map((template) => <option key={template.id} value={template.id}>{template.label}</option>)}
                  </select>
                  <button onClick={applyTemplate} disabled={!selectedTemplateId || generating || clarifying} className="h-8 rounded-md border border-neutral-200 px-3 text-[12px] font-medium text-neutral-700 hover:bg-neutral-100 disabled:opacity-50 dark:border-neutral-700 dark:text-neutral-200 dark:hover:bg-neutral-800">应用</button>
                </div>
                <div className="grid gap-4">{FIELD_CONFIG.map((field) => <label key={field.id} className="block"><span className="text-[12px] font-medium text-neutral-700 dark:text-neutral-300">{field.label}{field.required ? " *" : ""}</span>{field.id === "projectName" ? <input value={draft[field.id]} onChange={(event) => updateField(field.id, event.target.value)} disabled={generating} placeholder={field.placeholder} className="mt-1.5 h-9 w-full rounded-md border border-neutral-200 bg-white px-2.5 text-[12.5px] text-neutral-800 outline-none focus:border-neutral-400 disabled:opacity-50 dark:border-neutral-700 dark:bg-neutral-950 dark:text-neutral-200" /> : <textarea value={draft[field.id]} onChange={(event) => updateField(field.id, event.target.value)} disabled={generating} placeholder={field.placeholder} className="mt-1.5 h-20 w-full resize-none rounded-md border border-neutral-200 bg-white p-2.5 text-[12.5px] leading-5 text-neutral-800 outline-none focus:border-neutral-400 disabled:opacity-50 dark:border-neutral-700 dark:bg-neutral-950 dark:text-neutral-200" />}</label>)}</div>
                <button onClick={() => void generateLegacyDirect()} disabled={!canLegacyGenerate} className="inline-flex h-8 items-center gap-1.5 rounded-md border border-neutral-200 px-3 text-[12px] font-medium text-neutral-700 hover:bg-neutral-100 disabled:opacity-50 dark:border-neutral-700 dark:text-neutral-200 dark:hover:bg-neutral-800">旧路径直接生成</button>
              </div>
            )}
          </div>
        </div>

        <div className="flex min-h-0 flex-col rounded-lg border border-neutral-200 bg-white p-5 dark:border-neutral-800 dark:bg-neutral-900">
          <div className="mb-3 flex shrink-0 gap-2">
            <select
              value={selectedVersionId}
              onChange={(event) => setSelectedVersionId(event.target.value)}
              disabled={versions.length === 0 || generating || clarifying}
              className="h-8 min-w-0 flex-1 rounded-md border border-neutral-200 bg-transparent px-2 text-[12px] text-neutral-700 outline-none disabled:opacity-50 dark:border-neutral-700 dark:text-neutral-200"
            >
              {versions.length === 0 ? (
                <option value="">暂无业务需求历史版本</option>
              ) : (
                versions.map((version) => (
                  <option key={version.id} value={version.id}>
                    {versionKind(version) === "confirmed" ? "[确认需求]" : versionKind(version) === "framework" ? "[分析框架]" : "[旧版本]"} {formatTime(version.generatedAt)} · {version.projectName}{version.jsonStale ? " · 已编辑" : ""}
                  </option>
                ))
              )}
            </select>
            <button
              onClick={() => void openVersion()}
              disabled={!selectedVersionId || generating || clarifying}
              className="h-8 rounded-md border border-neutral-200 px-3 text-[12px] font-medium text-neutral-700 hover:bg-neutral-100 disabled:opacity-50 dark:border-neutral-700 dark:text-neutral-200 dark:hover:bg-neutral-800"
            >
              打开
            </button>
          </div>
          {generatedContent || clarificationContent || activeResult === "guide" ? (
            <div className="flex h-full min-h-0 flex-col">
              <div className="mb-3 flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-neutral-200 pb-2 dark:border-neutral-800">
                <div className="inline-flex h-8 shrink-0 rounded-md border border-neutral-200 bg-neutral-50 p-0.5 dark:border-neutral-700 dark:bg-neutral-950">
                  <button
                    onClick={() => setActiveResult("clarification")}
                    disabled={!clarificationContent}
                    className={activeResult === "clarification"
                      ? "rounded px-2.5 text-[12px] font-medium text-neutral-900 shadow-sm dark:bg-neutral-800 dark:text-neutral-100"
                      : "rounded px-2.5 text-[12px] text-neutral-500 hover:text-neutral-900 disabled:opacity-40 dark:text-neutral-400 dark:hover:text-neutral-100"}
                  >
                    澄清
                  </button>
                  <button
                    onClick={() => setActiveResult("framework")}
                    disabled={!generatedContent}
                    className={activeResult === "framework"
                      ? "rounded px-2.5 text-[12px] font-medium text-neutral-900 shadow-sm dark:bg-neutral-800 dark:text-neutral-100"
                      : "rounded px-2.5 text-[12px] text-neutral-500 hover:text-neutral-900 disabled:opacity-40 dark:text-neutral-400 dark:hover:text-neutral-100"}
                  >
                    分析
                  </button>
                  <button
                    onClick={() => setActiveResult("report")}
                    disabled={!generatedContent}
                    className={activeResult === "report"
                      ? "rounded px-2.5 text-[12px] font-medium text-neutral-900 shadow-sm dark:bg-neutral-800 dark:text-neutral-100"
                      : "rounded px-2.5 text-[12px] text-neutral-500 hover:text-neutral-900 disabled:opacity-40 dark:text-neutral-400 dark:hover:text-neutral-100"}
                  >
                    报告
                  </button>
                  <button
                    onClick={() => setActiveResult("diff")}
                    disabled={!diffContent}
                    className={activeResult === "diff"
                      ? "rounded px-2.5 text-[12px] font-medium text-neutral-900 shadow-sm dark:bg-neutral-800 dark:text-neutral-100"
                      : "rounded px-2.5 text-[12px] text-neutral-500 hover:text-neutral-900 disabled:opacity-40 dark:text-neutral-400 dark:hover:text-neutral-100"}
                  >
                    差异
                  </button>
                  <button
                    onClick={() => setActiveResult("guide")}
                    className={activeResult === "guide"
                      ? "rounded px-2.5 text-[12px] font-medium text-neutral-900 shadow-sm dark:bg-neutral-800 dark:text-neutral-100"
                      : "rounded px-2.5 text-[12px] text-neutral-500 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-neutral-100"}
                  >
                    说明
                  </button>
                </div>
                {activeResult === "framework" && (
                  <div className="flex min-w-0 flex-1 items-center justify-end gap-3">
                    <div className="min-w-0 text-right">
                      <p className="truncate font-mono text-[12px] font-medium text-neutral-700 dark:text-neutral-300" title={generatedPath}>
                        {generatedPath}
                      </p>
                      {generatedJsonPath && (
                        <p className="mt-1 truncate font-mono text-[11px] text-neutral-400" title={generatedJsonPath}>
                          {generatedJsonPath}{structuredJsonStale ? " · JSON 已过期" : ""}
                        </p>
                      )}
                    </div>
                    {editingFramework ? (
                      <>
                        <button
                          onClick={() => void saveFramework()}
                          disabled={savingFramework}
                          className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md bg-neutral-900 px-2.5 text-[12px] font-medium text-white hover:bg-neutral-700 disabled:opacity-50 dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-white"
                        >
                          {savingFramework ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" strokeWidth={1.75} />}
                          保存
                        </button>
                        <button
                          onClick={cancelEditFramework}
                          disabled={savingFramework}
                          className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md border border-neutral-200 px-2.5 text-[12px] font-medium text-neutral-700 hover:bg-neutral-100 disabled:opacity-50 dark:border-neutral-700 dark:text-neutral-200 dark:hover:bg-neutral-800"
                        >
                          <X className="h-3.5 w-3.5" strokeWidth={1.75} />
                          取消
                        </button>
                      </>
                    ) : (
                      <>
                        <button
                          onClick={() => void compareWithPreviousVersion()}
                          disabled={!generatedContent || !generatedPath || diffing || versions.findIndex((version) => version.markdownPath === generatedPath) < 0}
                          className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md border border-neutral-200 px-2.5 text-[12px] font-medium text-neutral-700 hover:bg-neutral-100 disabled:opacity-50 dark:border-neutral-700 dark:text-neutral-200 dark:hover:bg-neutral-800"
                        >
                          {diffing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FileText className="h-3.5 w-3.5" strokeWidth={1.75} />}
                          对比
                        </button>
                        <button
                          onClick={startEditFramework}
                          disabled={!generatedContent || !generatedPath || savingFramework}
                          className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md border border-neutral-200 px-2.5 text-[12px] font-medium text-neutral-700 hover:bg-neutral-100 disabled:opacity-50 dark:border-neutral-700 dark:text-neutral-200 dark:hover:bg-neutral-800"
                        >
                          <Pencil className="h-3.5 w-3.5" strokeWidth={1.75} />
                          编辑
                        </button>
                      </>
                    )}
                    {onExploreFields && generatedStructured && !structuredJsonStale && collectExploreFieldHints(generatedStructured).length > 0 && (
                      <button
                        onClick={() => onExploreFields(collectExploreFieldHints(generatedStructured), generatedStructured.projectName)}
                        disabled={editingFramework}
                        className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md border border-blue-200 px-2.5 text-[12px] font-medium text-blue-700 hover:bg-blue-50 disabled:opacity-50 dark:border-blue-900/60 dark:text-blue-300 dark:hover:bg-blue-950/40"
                        title="把指标/维度/数据需求字段名带入数据探索（仅字段名，不携带数据）"
                      >
                        <Compass className="h-3.5 w-3.5" strokeWidth={1.75} />
                        在数据探索中验证
                      </button>
                    )}
                    <button
                      onClick={() => void sinkToBusinessContext()}
                      disabled={!generatedStructured || structuredJsonStale || sinkingContext || editingFramework}
                      className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md border border-neutral-200 px-2.5 text-[12px] font-medium text-neutral-700 hover:bg-neutral-100 disabled:opacity-50 dark:border-neutral-700 dark:text-neutral-200 dark:hover:bg-neutral-800"
                    >
                      {sinkingContext ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" strokeWidth={1.75} />}
                      沉淀
                    </button>
                  </div>
                )}
                {activeResult === "clarification" && clarificationContent && (
                  <div className="flex min-w-0 flex-1 items-center justify-end gap-2">
                    {editingClarification ? (
                      <>
                        <button
                          onClick={saveClarification}
                          className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md bg-neutral-900 px-2.5 text-[12px] font-medium text-white hover:bg-neutral-700 dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-white"
                        >
                          <Save className="h-3.5 w-3.5" strokeWidth={1.75} />
                          保存
                        </button>
                        <button
                          onClick={() => {
                            setEditedClarificationContent(clarificationContent);
                            setEditingClarification(false);
                          }}
                          className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md border border-neutral-200 px-2.5 text-[12px] font-medium text-neutral-700 hover:bg-neutral-100 dark:border-neutral-700 dark:text-neutral-200 dark:hover:bg-neutral-800"
                        >
                          <X className="h-3.5 w-3.5" strokeWidth={1.75} />
                          取消
                        </button>
                      </>
                    ) : (
                      <button
                        onClick={startEditClarification}
                        className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md border border-neutral-200 px-2.5 text-[12px] font-medium text-neutral-700 hover:bg-neutral-100 dark:border-neutral-700 dark:text-neutral-200 dark:hover:bg-neutral-800"
                      >
                        <Pencil className="h-3.5 w-3.5" strokeWidth={1.75} />
                        编辑
                      </button>
                    )}
                  </div>
                )}
                {activeResult === "report" && generatedStructured ? (
                  <div className="flex min-w-0 flex-1 items-center justify-end gap-2">
                    <button
                      onClick={() => editingReportFramework ? void saveReportFramework() : startEditReportFramework()}
                      disabled={savingFramework}
                      className={editingReportFramework
                        ? "inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md bg-neutral-900 px-2.5 text-[12px] font-medium text-white hover:bg-neutral-700 disabled:opacity-50 dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-white"
                        : "inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md border border-neutral-200 px-2.5 text-[12px] font-medium text-neutral-700 hover:bg-neutral-100 dark:border-neutral-700 dark:text-neutral-200 dark:hover:bg-neutral-800"}
                    >
                      {savingFramework ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : editingReportFramework ? <Save className="h-3.5 w-3.5" strokeWidth={1.75} /> : <Pencil className="h-3.5 w-3.5" strokeWidth={1.75} />}
                      {editingReportFramework ? "保存" : "编辑树"}
                    </button>
                    {editingReportFramework && (
                      <button
                        onClick={() => {
                          setEditingReportFramework(false);
                          void openVersion();
                        }}
                        disabled={savingFramework}
                        className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md border border-neutral-200 px-2.5 text-[12px] font-medium text-neutral-700 hover:bg-neutral-100 disabled:opacity-50 dark:border-neutral-700 dark:text-neutral-200 dark:hover:bg-neutral-800"
                      >
                        <X className="h-3.5 w-3.5" strokeWidth={1.75} />
                        取消
                      </button>
                    )}
                  </div>
                ) : null}
              </div>
              <div className="min-h-0 flex-1 overflow-auto">
              {activeResult === "framework" && sinkMessage && (
                <p className="mb-2 text-right text-[11.5px] text-emerald-600 dark:text-emerald-400">{sinkMessage}</p>
              )}
              {activeResult === "framework" && saveMessage && (
                <p className="mb-2 text-right text-[11.5px] text-emerald-600 dark:text-emerald-400">{saveMessage}</p>
              )}
              {activeResult === "report" && saveMessage && (
                <p className="mb-2 text-right text-[11.5px] text-emerald-600 dark:text-emerald-400">{saveMessage}</p>
              )}
              {activeResult === "framework" && structuredJsonStale && (
                <p className="mb-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-[11.5px] leading-4 text-amber-700 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-300">
                  当前 Markdown 已人工编辑，结构化 JSON 仍是生成时版本；沉淀业务环境前请重新生成分析框架。
                </p>
              )}
              {activeResult === "framework" && !editingFramework && generatedStructured && (
                <div className="mb-2 grid gap-2">
                  <div className="rounded-md border border-neutral-200 bg-neutral-50 px-3 py-2 dark:border-neutral-800 dark:bg-neutral-950">
                    <div className="mb-1.5 flex items-center gap-1.5 text-[11.5px] font-medium text-neutral-700 dark:text-neutral-300">
                      <FileText className="h-3.5 w-3.5 text-neutral-500" strokeWidth={1.75} />
                      来源文档
                      <span className="text-neutral-400">{sourceDocuments.length} 个</span>
                    </div>
                    {sourceDocuments.length > 0 ? (
                      <div className="grid gap-1.5">
                        {sourceDocuments.map((document, index) => (
                          <div key={`${document.path}:${index}`} className="min-w-0 text-[11.5px] leading-4 text-neutral-600 dark:text-neutral-300">
                            <div className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0.5">
                              <span className="shrink-0 rounded border border-neutral-200 px-1 font-mono text-[10.5px] text-neutral-500 dark:border-neutral-700 dark:text-neutral-400">
                                D{index + 1}
                              </span>
                              <span className="truncate font-medium" title={document.name}>{document.name}</span>
                              <span className="min-w-0 truncate text-neutral-400">
                                {formatDocumentSource(document.source)} · {document.extension || "未知类型"} · {formatBytes(document.size)}{document.truncated ? " · 已截断" : ""}
                              </span>
                            </div>
                            <div className="mt-0.5 truncate pl-8 font-mono text-[10.5px] text-neutral-400" title={document.path}>
                              {document.path}
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="text-[11.5px] leading-4 text-neutral-500 dark:text-neutral-400">
                        当前版本未导入需求调研文档，仅基于手工填写内容生成。
                      </p>
                    )}
                  </div>
                  {sourceRefEntries.length > 0 && (
                    <div className="rounded-md border border-neutral-200 bg-neutral-50 px-3 py-2 dark:border-neutral-800 dark:bg-neutral-950">
                      <div className="mb-1.5 flex items-center gap-1.5 text-[11.5px] font-medium text-neutral-700 dark:text-neutral-300">
                        <FileText className="h-3.5 w-3.5 text-neutral-500" strokeWidth={1.75} />
                        字段来源引用
                        <span className="text-neutral-400">{sourceRefEntries.length} 条</span>
                      </div>
                      <div className="grid gap-1.5">
                        {sourceRefEntries.map((ref, index) => (
                          <div key={`${ref.fieldPath}:${ref.documentId}:${index}`} className="min-w-0 rounded border border-neutral-200 bg-white px-2 py-1.5 text-[11.5px] leading-4 text-neutral-600 dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-300">
                            <div className="flex min-w-0 items-center gap-1.5">
                              <span className="shrink-0 rounded border border-neutral-200 px-1 font-mono text-[10.5px] text-neutral-500 dark:border-neutral-700 dark:text-neutral-400">{ref.documentId}</span>
                              <span className="truncate font-mono text-[10.5px] text-neutral-400" title={ref.fieldPath}>{ref.fieldPath}</span>
                            </div>
                            <p className="mt-1 line-clamp-2 text-neutral-600 dark:text-neutral-300" title={ref.quote}>{ref.quote}</p>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
              <div className="mt-1">
                {activeResult === "framework" && editingFramework ? (
                  <textarea
                    value={editedContent}
                    onChange={(event) => setEditedContent(event.target.value)}
                    disabled={savingFramework}
                    className="h-full min-h-[420px] w-full resize-none rounded-md border border-neutral-200 bg-neutral-50 p-3 font-mono text-[12px] leading-5 text-neutral-800 outline-none focus:border-neutral-400 disabled:opacity-50 dark:border-neutral-700 dark:bg-neutral-950 dark:text-neutral-200"
                  />
                ) : activeResult === "clarification" && editingClarification ? (
                  <textarea
                    value={editedClarificationContent}
                    onChange={(event) => setEditedClarificationContent(event.target.value)}
                    className="h-full min-h-[420px] w-full resize-none rounded-md border border-neutral-200 bg-neutral-50 p-3 font-mono text-[12px] leading-5 text-neutral-800 outline-none focus:border-neutral-400 dark:border-neutral-700 dark:bg-neutral-950 dark:text-neutral-200"
                  />
                ) : activeResult === "report" ? (
                  <ReportFrameworkTree
                    structured={generatedStructured}
                    editing={editingReportFramework}
                    onChange={updateReportFramework}
                  />
                ) : (
                  <Markdown>{activeResult === "clarification" ? clarificationContent : activeResult === "diff" ? diffContent : activeResult === "guide" ? BUSINESS_REQUIREMENT_GUIDE : generatedContent}</Markdown>
                )}
              </div>
              </div>
            </div>
          ) : (
            <div className="flex h-full items-center justify-center px-6 text-center text-[12.5px] text-neutral-400">
              {clarifying ? "正在生成澄清问题..." : generating ? "正在生成业务需求分析框架..." : activeConfirmedRequirement ? "已选中确认需求，可点击上方“生成分析框架”。" : "请先回到需求沟通确认需求；确认后会自动进入这里并作为分析框架输入源。"}
            </div>
          )}
            </div>
          </div>
        </AnalysisFrameworkPane>
      )}
    </div>
  );
}
