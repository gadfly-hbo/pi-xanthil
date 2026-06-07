import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, ClipboardList, Compass, FileText, FolderOpen, Loader2, Pencil, RefreshCw, Save, Sparkles, X } from "lucide-react";
import { Markdown } from "@/components/Markdown";
import { api } from "@/lib/api";
import type { BusinessContextCategory, FlowTreeNode, WorkspacePath } from "@/types";

type Scope =
  | { type: "workspace"; workspaceId: string }
  | { type: "session"; sessionId: string }
  | { type: "flow"; flowId: string };

interface Props {
  scope: Scope | null;
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

type RequirementDocument =
  | { id: string; label: string; source: "workspace_path"; pathId: number; relPath: string }
  | { id: string; label: string; source: "local_path"; path: string };

type RequirementDocumentPayload =
  | { source: "workspace_path"; pathId: number; relPath?: string }
  | { source: "local_path"; path: string };

interface RequirementDocumentPreview {
  loading: boolean;
  name: string;
  path: string;
  size: number;
  mtimeMs: number;
  source: "workspace_path" | "local_path";
  extension: string;
  content: string;
  truncated: boolean;
  error?: string;
}

interface RequirementDocumentOption {
  id: string;
  label: string;
  pathId: number;
  relPath: string;
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
  openQuestions?: string[];
  risks?: string[];
  sourceRefs?: Record<string, RequirementSourceRef[]>;
  sourceDocuments?: RequirementSourceDocumentMetadata[];
  version?: {
    markdownEditedAt?: number;
    jsonStaleReason?: string;
  };
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

interface RequirementQualityItem {
  id: string;
  label: string;
  done: boolean;
  detail: string;
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

function documentPayload(document: RequirementDocument): RequirementDocumentPayload {
  return document.source === "workspace_path"
    ? { source: "workspace_path", pathId: document.pathId, relPath: document.relPath }
    : { source: "local_path", path: document.path };
}

function formatBytes(size: number): string {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}

function buildRequirementQualityItems(
  draft: RequirementDraft,
  documents: RequirementDocument[],
  previews: Record<string, RequirementDocumentPreview>,
): RequirementQualityItem[] {
  const hasDocuments = documents.length > 0;
  const documentPreviews = documents
    .map((document) => previews[document.id])
    .filter((preview): preview is RequirementDocumentPreview => Boolean(preview));
  const hasDocumentError = documentPreviews.some((preview) => preview.error);
  const hasDocumentLoading = documentPreviews.some((preview) => preview.loading);
  return [
    {
      id: "project",
      label: "项目识别",
      done: Boolean(draft.projectName.trim()),
      detail: "项目名称",
    },
    {
      id: "goal",
      label: "目标与问题",
      done: Boolean(draft.businessGoal.trim() && draft.businessQuestions.trim()) || hasDocuments,
      detail: "业务目标、核心业务问题或导入需求文档",
    },
    {
      id: "decision",
      label: "决策场景",
      done: Boolean(draft.decisionScenario.trim()),
      detail: "谁基于分析做什么决策",
    },
    {
      id: "stakeholder",
      label: "使用对象",
      done: Boolean(draft.stakeholders.trim()),
      detail: "老板、运营、销售、产品等",
    },
    {
      id: "data",
      label: "可用数据",
      done: Boolean(draft.knownData.trim()) || (hasDocuments && !hasDocumentError && !hasDocumentLoading),
      detail: "数据表、文件、字段、指标或文档解析结果",
    },
    {
      id: "constraints",
      label: "限制风险",
      done: Boolean(draft.constraints.trim()),
      detail: "数据缺口、口径争议、合规边界",
    },
    {
      id: "output",
      label: "输出偏好",
      done: Boolean(draft.outputPreference.trim()),
      detail: "框架、指标树、假设清单、看板草图等",
    },
  ];
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

export function BusinessRequirementPane({ scope, model, onGenerated, onBusinessContextChanged, onExploreFields }: Props) {
  const [paths, setPaths] = useState<WorkspacePath[]>([]);
  const [selectedPathId, setSelectedPathId] = useState("");
  const [documentOptions, setDocumentOptions] = useState<RequirementDocumentOption[]>([]);
  const [selectedDocumentId, setSelectedDocumentId] = useState("");
  const [documents, setDocuments] = useState<RequirementDocument[]>([]);
  const [documentPreviews, setDocumentPreviews] = useState<Record<string, RequirementDocumentPreview>>({});
  const [versions, setVersions] = useState<RequirementVersion[]>([]);
  const [selectedVersionId, setSelectedVersionId] = useState("");
  const [selectedTemplateId, setSelectedTemplateId] = useState("");
  const [overwriteExtractedDraft, setOverwriteExtractedDraft] = useState(false);
  const [draft, setDraft] = useState<RequirementDraft>(EMPTY_DRAFT);
  const [generatedPath, setGeneratedPath] = useState("");
  const [generatedJsonPath, setGeneratedJsonPath] = useState("");
  const [generatedContent, setGeneratedContent] = useState("");
  const [generatedStructured, setGeneratedStructured] = useState<BusinessRequirementStructuredOutput | null>(null);
  const [clarificationContent, setClarificationContent] = useState("");
  const [diffContent, setDiffContent] = useState("");
  const [editedContent, setEditedContent] = useState("");
  const [activeResult, setActiveResult] = useState<"clarification" | "framework" | "diff">("framework");
  const [editingFramework, setEditingFramework] = useState(false);
  const [loadingPaths, setLoadingPaths] = useState(false);
  const [clarifying, setClarifying] = useState(false);
  const [extractingDraft, setExtractingDraft] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [diffing, setDiffing] = useState(false);
  const [sinkingContext, setSinkingContext] = useState(false);
  const [savingFramework, setSavingFramework] = useState(false);
  const [sinkMessage, setSinkMessage] = useState("");
  const [saveMessage, setSaveMessage] = useState("");
  const [extractMessage, setExtractMessage] = useState("");
  const [error, setError] = useState("");

  const selectedPath = useMemo(
    () => paths.find((path) => String(path.id) === selectedPathId) ?? null,
    [paths, selectedPathId],
  );
  const structuredJsonStale = Boolean(generatedStructured?.version?.markdownEditedAt);
  const sourceDocuments = generatedStructured?.sourceDocuments ?? [];
  const sourceRefEntries = useMemo(
    () => Object.entries(generatedStructured?.sourceRefs ?? {}).flatMap(([fieldPath, refs]) =>
      refs.map((ref) => ({ fieldPath, ...ref })),
    ),
    [generatedStructured],
  );

  const canGenerate = Boolean(
    selectedPath
      && draft.projectName.trim()
      && (documents.length > 0 || (draft.businessGoal.trim() && draft.businessQuestions.trim()))
      && !generating,
  );
  const canClarify = Boolean(
    draft.projectName.trim()
      && (documents.length > 0 || draft.businessBackground.trim() || draft.businessGoal.trim() || draft.businessQuestions.trim())
      && !clarifying
      && !generating,
  );
  const documentPreviewLoading = documents.some((document) => documentPreviews[document.id]?.loading);
  const canExtractDraft = Boolean(
    selectedPath
      && documents.length > 0
      && !documentPreviewLoading
      && !extractingDraft
      && !clarifying
      && !generating,
  );
  const qualityItems = useMemo(
    () => buildRequirementQualityItems(draft, documents, documentPreviews),
    [documentPreviews, documents, draft],
  );
  const completedQualityCount = qualityItems.filter((item) => item.done).length;
  const qualityScore = Math.round((completedQualityCount / qualityItems.length) * 100);
  const missingQualityItems = qualityItems.filter((item) => !item.done);

  const loadVersions = useCallback(async (pathId: number) => {
    try {
      const result = await api.listBusinessRequirementVersions(pathId);
      setVersions(result.versions);
      setSelectedVersionId((current) => result.versions.some((version) => version.id === current) ? current : result.versions[0]?.id ?? "");
    } catch {
      setVersions([]);
      setSelectedVersionId("");
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
            ? [{ id: `${path.id}:`, label: basenamePath(path.path), pathId: path.id, relPath: "" }]
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
          }));
      }));
      const nextDocuments = scanned.flat();
      const nextWorkspaceDocumentIds = new Set(nextDocuments.map((item) => item.id));
      setDocumentOptions(nextDocuments);
      setSelectedDocumentId((current) => nextDocuments.some((item) => item.id === current) ? current : nextDocuments[0]?.id ?? "");
      setDocuments((current) => current.filter((document) => document.source === "local_path" || nextWorkspaceDocumentIds.has(document.id)));
      setDocumentPreviews((current) => {
        const next: Record<string, RequirementDocumentPreview> = {};
        for (const [id, preview] of Object.entries(current)) {
          if (id.startsWith("local:") || nextWorkspaceDocumentIds.has(id)) next[id] = preview;
        }
        return next;
      });
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

  const extractDraftFromDocuments = async () => {
    if (!selectedPath || !canExtractDraft) return;
    setExtractingDraft(true);
    setExtractMessage("");
    setError("");
    try {
      const result = await api.extractBusinessRequirementDraft({
        pathId: selectedPath.id,
        documents: documents.map(documentPayload),
        model: model || undefined,
      });
      const fields: Array<keyof RequirementDraft> = [
        "projectName",
        "businessBackground",
        "businessGoal",
        "businessQuestions",
        "decisionScenario",
        "stakeholders",
        "knownData",
        "constraints",
        "outputPreference",
        "extraPrompt",
      ];
      setDraft((current) => {
        const next = { ...current };
        let changed = 0;
        for (const field of fields) {
          const value = result.draft[field]?.trim() ?? "";
          if (!value) continue;
          if (overwriteExtractedDraft || !next[field].trim()) {
            next[field] = value;
            changed += 1;
          }
        }
        setExtractMessage(changed > 0 ? `已提取 ${changed} 个字段` : "没有可填充的新字段");
        return next;
      });
    } catch (err) {
      setError(String(err));
    } finally {
      setExtractingDraft(false);
    }
  };

  const previewDocument = async (document: RequirementDocument) => {
    setDocumentPreviews((current) => ({
      ...current,
      [document.id]: { loading: true, name: document.label, path: "", size: 0, mtimeMs: 0, source: document.source, extension: "", content: "", truncated: false },
    }));
    try {
      const result = await api.previewBusinessRequirementDocuments({ documents: [documentPayload(document)] });
      const preview = result.documents[0];
      if (!preview) throw new Error("预览结果为空");
      setDocumentPreviews((current) => ({ ...current, [document.id]: { loading: false, ...preview } }));
    } catch (err) {
      setDocumentPreviews((current) => ({
        ...current,
        [document.id]: { loading: false, name: document.label, path: "", size: 0, mtimeMs: 0, source: document.source, extension: "", content: "", truncated: false, error: String(err) },
      }));
    }
  };

  const addRegisteredDocument = () => {
    const option = documentOptions.find((item) => item.id === selectedDocumentId);
    if (!option || documents.some((item) => item.id === option.id)) return;
    const document: RequirementDocument = { ...option, source: "workspace_path" };
    setDocuments((current) => [...current, document]);
    void previewDocument(document);
  };

  const addLocalDocument = async () => {
    try {
      const { path } = await api.pickLocalPath("file");
      if (!isRequirementDocumentFile(path)) {
        setError("仅支持 md、txt、csv、docx、xlsx、xls 需求文档");
        return;
      }
      const id = `local:${path}`;
      if (documents.some((item) => item.id === id)) return;
      const document: RequirementDocument = { id, label: basenamePath(path), source: "local_path", path };
      setDocuments((current) => [...current, document]);
      void previewDocument(document);
    } catch {
      // user cancelled
    }
  };

  const removeDocument = (id: string) => {
    setDocuments((current) => current.filter((item) => item.id !== id));
    setDocumentPreviews((current) => {
      const next = { ...current };
      delete next[id];
      return next;
    });
  };

  const openVersion = async () => {
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
      setGeneratedPath(version.markdownPath);
      setGeneratedJsonPath(version.jsonPath);
      setGeneratedContent(result.content);
      setEditedContent(result.content);
      setGeneratedStructured(isStructuredOutput(result.structured) ? result.structured : null);
      setDiffContent("");
      setActiveResult("framework");
      setEditingFramework(false);
      setSaveMessage("");
    } catch (err) {
      setError(String(err));
    }
  };

  const generate = useCallback(async () => {
    if (!canGenerate || !selectedPath) return;
    setGenerating(true);
    setError("");
    setGeneratedPath("");
    setGeneratedJsonPath("");
    setGeneratedContent("");
    setGeneratedStructured(null);
    setDiffContent("");
    setEditedContent("");
    setEditingFramework(false);
    setSinkMessage("");
    setSaveMessage("");
    try {
      const result = await api.generateBusinessRequirement({
        pathId: selectedPath.id,
        documents: documents.map(documentPayload),
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
      setGeneratedPath(result.path);
      setGeneratedJsonPath(result.jsonPath);
      setGeneratedContent(result.content);
      setEditedContent(result.content);
      setGeneratedStructured(isStructuredOutput(result.structured) ? result.structured : null);
      setDiffContent("");
      setActiveResult("framework");
      void loadVersions(selectedPath.id);
      onGenerated?.();
    } catch (err) {
      setError(String(err));
    } finally {
      setGenerating(false);
    }
  }, [canGenerate, documents, draft, loadVersions, model, onGenerated, selectedPath]);

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

  const clarify = useCallback(async () => {
    if (!canClarify) return;
    setClarifying(true);
    setError("");
    try {
      const result = await api.generateBusinessRequirementClarifyingQuestions({
        pathId: selectedPath?.id,
        documents: documents.map(documentPayload),
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
      setClarificationContent(result.content);
      setActiveResult("clarification");
    } catch (err) {
      setError(String(err));
    } finally {
      setClarifying(false);
    }
  }, [canClarify, documents, draft, model, selectedPath]);

  const pathHint = paths.length === 0
    ? "请先在「报告输出」tab 添加报告输出文件夹或文件"
    : "选择业务需求分析框架的保存位置";

  return (
    <div className="flex h-full min-h-0 flex-col bg-white dark:bg-neutral-950">
      <div className="flex h-12 shrink-0 items-center gap-3 border-b border-neutral-200 px-4 dark:border-neutral-800">
        <div className="flex items-center gap-2 text-[13px] font-semibold text-neutral-900 dark:text-neutral-100">
          <ClipboardList className="h-4 w-4 text-neutral-500" strokeWidth={1.75} />
          业务需求
        </div>
        <select
          value={selectedPathId}
          onChange={(event) => setSelectedPathId(event.target.value)}
          disabled={loadingPaths || generating || extractingDraft || paths.length === 0}
          className="h-8 min-w-0 flex-1 rounded-md border border-neutral-200 bg-transparent px-2 text-[12px] text-neutral-700 outline-none disabled:opacity-50 dark:border-neutral-700 dark:text-neutral-200"
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
          disabled={loadingPaths || generating || extractingDraft}
          className="inline-flex h-8 items-center gap-1.5 rounded-md px-2 text-[12px] text-neutral-500 hover:bg-neutral-100 disabled:opacity-50 dark:text-neutral-400 dark:hover:bg-neutral-800"
        >
          <RefreshCw className={loadingPaths ? "h-3.5 w-3.5 animate-spin" : "h-3.5 w-3.5"} strokeWidth={1.75} />
          刷新
        </button>
        <button
          onClick={() => void clarify()}
          disabled={!canClarify || extractingDraft}
          className="inline-flex h-8 items-center gap-1.5 rounded-md border border-neutral-200 px-3 text-[12px] font-medium text-neutral-700 hover:bg-neutral-100 disabled:opacity-50 dark:border-neutral-700 dark:text-neutral-200 dark:hover:bg-neutral-800"
        >
          {clarifying ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ClipboardList className="h-3.5 w-3.5" strokeWidth={1.75} />}
          {clarifying ? "生成中..." : "澄清问题"}
        </button>
        <button
          onClick={() => void generate()}
          disabled={!canGenerate || extractingDraft}
          className="inline-flex h-8 items-center gap-1.5 rounded-md bg-neutral-900 px-3 text-[12px] font-medium text-white hover:bg-neutral-700 disabled:opacity-50 dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-white"
        >
          {generating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" strokeWidth={1.75} />}
          {generating ? "生成中..." : "生成分析框架"}
        </button>
      </div>

      {error && (
        <div className="flex items-center gap-1.5 border-b border-rose-100 bg-rose-50 px-4 py-2 text-[12px] text-rose-600 dark:border-rose-950 dark:bg-rose-950/30 dark:text-rose-300">
          <AlertTriangle className="h-3.5 w-3.5" />
          {error}
        </div>
      )}

      <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 p-5 lg:grid-cols-[minmax(320px,0.95fr)_minmax(0,1.05fr)]">
        <div className="min-h-0 overflow-auto rounded-lg border border-neutral-200 bg-neutral-50/70 p-4 dark:border-neutral-800 dark:bg-neutral-900/60">
          <div className="mb-4 rounded-lg border border-neutral-200 bg-white p-3 dark:border-neutral-800 dark:bg-neutral-950">
            <div className="mb-2 flex items-center gap-1.5 text-[12px] font-medium text-neutral-700 dark:text-neutral-300">
              <ClipboardList className="h-3.5 w-3.5 text-neutral-500" strokeWidth={1.75} />
              需求模板
            </div>
            <div className="flex gap-2">
              <select
                value={selectedTemplateId}
                onChange={(event) => setSelectedTemplateId(event.target.value)}
                disabled={generating || clarifying || extractingDraft}
                className="h-8 min-w-0 flex-1 rounded-md border border-neutral-200 bg-transparent px-2 text-[12px] text-neutral-700 outline-none disabled:opacity-50 dark:border-neutral-700 dark:text-neutral-200"
              >
                <option value="">选择业务场景模板</option>
                {REQUIREMENT_TEMPLATES.map((template) => (
                  <option key={template.id} value={template.id}>{template.label}</option>
                ))}
              </select>
              <button
                onClick={applyTemplate}
                disabled={!selectedTemplateId || generating || clarifying || extractingDraft}
                className="h-8 rounded-md border border-neutral-200 px-3 text-[12px] font-medium text-neutral-700 hover:bg-neutral-100 disabled:opacity-50 dark:border-neutral-700 dark:text-neutral-200 dark:hover:bg-neutral-800"
              >
                应用
              </button>
            </div>
            <p className="mt-2 text-[11.5px] leading-4 text-neutral-500 dark:text-neutral-400">
              模板只填充空字段，不会覆盖已输入内容。
            </p>
          </div>
          <div className="mb-4 rounded-lg border border-neutral-200 bg-white p-3 dark:border-neutral-800 dark:bg-neutral-950">
            <div className="mb-2 flex items-center justify-between gap-3">
              <div className="flex items-center gap-1.5 text-[12px] font-medium text-neutral-700 dark:text-neutral-300">
                <FileText className="h-3.5 w-3.5 text-neutral-500" strokeWidth={1.75} />
                导入需求文档
              </div>
              <div className="flex items-center gap-1.5">
                <label className="inline-flex h-7 items-center gap-1.5 rounded-md px-1.5 text-[11.5px] text-neutral-500 dark:text-neutral-400">
                  <input
                    type="checkbox"
                    checked={overwriteExtractedDraft}
                    onChange={(event) => setOverwriteExtractedDraft(event.target.checked)}
                    disabled={extractingDraft || generating || clarifying}
                    className="h-3.5 w-3.5 accent-neutral-900 dark:accent-neutral-100"
                  />
                  覆盖已填
                </label>
                <button
                  onClick={() => void extractDraftFromDocuments()}
                  disabled={!canExtractDraft}
                  className="inline-flex h-7 items-center gap-1.5 rounded-md border border-neutral-200 px-2 text-[11.5px] text-neutral-600 hover:bg-neutral-100 disabled:opacity-50 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800"
                >
                  {extractingDraft ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" strokeWidth={1.75} />}
                  {extractingDraft ? "提取中" : "提取草稿"}
                </button>
                <button
                  onClick={() => void addLocalDocument()}
                  disabled={generating || clarifying || extractingDraft}
                  className="inline-flex h-7 items-center gap-1.5 rounded-md border border-neutral-200 px-2 text-[11.5px] text-neutral-600 hover:bg-neutral-100 disabled:opacity-50 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800"
                >
                  <FolderOpen className="h-3.5 w-3.5" strokeWidth={1.75} />
                  本地文件
                </button>
              </div>
            </div>
            <div className="flex gap-2">
              <select
                value={selectedDocumentId}
                onChange={(event) => setSelectedDocumentId(event.target.value)}
                disabled={loadingPaths || generating || clarifying || extractingDraft || documentOptions.length === 0}
                className="h-8 min-w-0 flex-1 rounded-md border border-neutral-200 bg-transparent px-2 text-[12px] text-neutral-700 outline-none disabled:opacity-50 dark:border-neutral-700 dark:text-neutral-200"
              >
                {documentOptions.length === 0 ? (
                  <option value="">{loadingPaths ? "正在扫描需求文档..." : "聚合数据/报告输出中未发现支持的文档"}</option>
                ) : (
                  documentOptions.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)
                )}
              </select>
              <button
                onClick={addRegisteredDocument}
                disabled={!selectedDocumentId || generating || clarifying || extractingDraft}
                className="h-8 rounded-md bg-neutral-900 px-3 text-[12px] font-medium text-white hover:bg-neutral-700 disabled:opacity-50 dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-white"
              >
                添加
              </button>
            </div>
            <p className="mt-2 text-[11.5px] leading-4 text-neutral-500 dark:text-neutral-400">
              支持 md、txt、csv、docx、xlsx、xls。导入内容会和手工填写信息一起用于生成分析框架。
            </p>
            {extractMessage && (
              <p className="mt-2 text-[11.5px] leading-4 text-emerald-600 dark:text-emerald-400">
                {extractMessage}
              </p>
            )}
            {documents.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {documents.map((document) => {
                  const preview = documentPreviews[document.id];
                  return (
                    <div key={document.id} className="w-full rounded-md border border-neutral-200 bg-neutral-50 p-2 text-[11.5px] text-neutral-600 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-300">
                      <div className="flex items-center gap-2">
                        <FileText className="h-3.5 w-3.5 shrink-0 text-neutral-400" strokeWidth={1.75} />
                        <span className="min-w-0 flex-1 truncate font-medium">{document.label}</span>
                        <button onClick={() => removeDocument(document.id)} disabled={generating || clarifying || extractingDraft} className="shrink-0 text-neutral-400 hover:text-neutral-700 disabled:opacity-50 dark:hover:text-neutral-100">
                          <X className="h-3 w-3" />
                        </button>
                      </div>
                      {preview?.loading ? (
                        <div className="mt-2 flex items-center gap-1.5 text-neutral-400">
                          <Loader2 className="h-3 w-3 animate-spin" />
                          正在解析文档...
                        </div>
                      ) : preview?.error ? (
                        <p className="mt-2 text-rose-500">{preview.error}</p>
                      ) : preview ? (
                        <>
                          <p className="mt-1 truncate text-[11px] text-neutral-400" title={preview.path}>
                            {preview.source === "workspace_path" ? "登记路径" : "本地文件"} · {preview.extension || "未知类型"} · {formatBytes(preview.size)} · {formatTime(preview.mtimeMs)}{preview.truncated ? " · 预览已截断" : ""} · {preview.path}
                          </p>
                          <pre className="mt-2 max-h-28 overflow-auto whitespace-pre-wrap rounded bg-white p-2 text-[11px] leading-4 text-neutral-600 dark:bg-neutral-950 dark:text-neutral-300">
                            {preview.content || "（未提取到文本）"}
                          </pre>
                        </>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
          <div className="mb-4 rounded-lg border border-neutral-200 bg-white p-3 dark:border-neutral-800 dark:bg-neutral-950">
            <div className="mb-2 flex items-center justify-between gap-3">
              <div className="flex items-center gap-1.5 text-[12px] font-medium text-neutral-700 dark:text-neutral-300">
                <ClipboardList className="h-3.5 w-3.5 text-neutral-500" strokeWidth={1.75} />
                需求质量
              </div>
              <span className={qualityScore >= 70
                ? "text-[12px] font-semibold text-emerald-600 dark:text-emerald-400"
                : "text-[12px] font-semibold text-amber-600 dark:text-amber-400"}
              >
                {qualityScore}%
              </span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-neutral-100 dark:bg-neutral-800">
              <div
                className={qualityScore >= 70 ? "h-full bg-emerald-500" : "h-full bg-amber-500"}
                style={{ width: `${qualityScore}%` }}
              />
            </div>
            <div className="mt-2 grid grid-cols-2 gap-1.5">
              {qualityItems.map((item) => (
                <div
                  key={item.id}
                  title={item.detail}
                  className={item.done
                    ? "truncate rounded-md border border-emerald-100 bg-emerald-50 px-2 py-1.5 text-[11.5px] text-emerald-700 dark:border-emerald-950 dark:bg-emerald-950/30 dark:text-emerald-300"
                    : "truncate rounded-md border border-neutral-200 bg-neutral-50 px-2 py-1.5 text-[11.5px] text-neutral-500 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-400"}
                >
                  {item.label}
                </div>
              ))}
            </div>
            {missingQualityItems.length > 0 && (
              <p className="mt-2 text-[11.5px] leading-4 text-neutral-500 dark:text-neutral-400">
                待补齐：{missingQualityItems.map((item) => item.label).join("、")}
              </p>
            )}
          </div>
          <div className="grid gap-3">
            {FIELD_CONFIG.map((field) => (
              <label key={field.id} className="block">
                <span className="text-[12px] font-medium text-neutral-700 dark:text-neutral-300">
                  {field.label}{field.required ? " *" : ""}
                </span>
                {field.id === "projectName" ? (
                  <input
                    value={draft[field.id]}
                    onChange={(event) => updateField(field.id, event.target.value)}
                    disabled={generating || extractingDraft}
                    placeholder={field.placeholder}
                    className="mt-1.5 h-9 w-full rounded-md border border-neutral-200 bg-white px-2.5 text-[12.5px] text-neutral-800 outline-none focus:border-neutral-400 disabled:opacity-50 dark:border-neutral-700 dark:bg-neutral-950 dark:text-neutral-200"
                  />
                ) : (
                  <textarea
                    value={draft[field.id]}
                    onChange={(event) => updateField(field.id, event.target.value)}
                    disabled={generating || extractingDraft}
                    placeholder={field.placeholder}
                    className="mt-1.5 h-20 w-full resize-none rounded-md border border-neutral-200 bg-white p-2.5 text-[12.5px] leading-5 text-neutral-800 outline-none focus:border-neutral-400 disabled:opacity-50 dark:border-neutral-700 dark:bg-neutral-950 dark:text-neutral-200"
                  />
                )}
              </label>
            ))}
          </div>
        </div>

        <div className="flex min-h-0 flex-col rounded-lg border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
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
                    {formatTime(version.generatedAt)} · {version.projectName} · {version.sourceDocumentCount} 文档{version.jsonStale ? " · 已编辑" : ""}
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
          {generatedContent || clarificationContent ? (
            <div className="flex h-full min-h-0 flex-col">
              <div className="mb-3 flex shrink-0 items-center justify-between gap-3 border-b border-neutral-200 pb-2 dark:border-neutral-800">
                <div className="inline-flex h-8 rounded-md border border-neutral-200 bg-neutral-50 p-0.5 dark:border-neutral-700 dark:bg-neutral-950">
                  <button
                    onClick={() => setActiveResult("clarification")}
                    disabled={!clarificationContent}
                    className={activeResult === "clarification"
                      ? "rounded px-2.5 text-[12px] font-medium text-neutral-900 shadow-sm dark:bg-neutral-800 dark:text-neutral-100"
                      : "rounded px-2.5 text-[12px] text-neutral-500 hover:text-neutral-900 disabled:opacity-40 dark:text-neutral-400 dark:hover:text-neutral-100"}
                  >
                    澄清问题
                  </button>
                  <button
                    onClick={() => setActiveResult("framework")}
                    disabled={!generatedContent}
                    className={activeResult === "framework"
                      ? "rounded px-2.5 text-[12px] font-medium text-neutral-900 shadow-sm dark:bg-neutral-800 dark:text-neutral-100"
                      : "rounded px-2.5 text-[12px] text-neutral-500 hover:text-neutral-900 disabled:opacity-40 dark:text-neutral-400 dark:hover:text-neutral-100"}
                  >
                    分析框架
                  </button>
                  <button
                    onClick={() => setActiveResult("diff")}
                    disabled={!diffContent}
                    className={activeResult === "diff"
                      ? "rounded px-2.5 text-[12px] font-medium text-neutral-900 shadow-sm dark:bg-neutral-800 dark:text-neutral-100"
                      : "rounded px-2.5 text-[12px] text-neutral-500 hover:text-neutral-900 disabled:opacity-40 dark:text-neutral-400 dark:hover:text-neutral-100"}
                  >
                    版本差异
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
              </div>
              {activeResult === "framework" && sinkMessage && (
                <p className="mb-2 text-right text-[11.5px] text-emerald-600 dark:text-emerald-400">{sinkMessage}</p>
              )}
              {activeResult === "framework" && saveMessage && (
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
              <div className="min-h-0 flex-1 overflow-auto">
                {activeResult === "framework" && editingFramework ? (
                  <textarea
                    value={editedContent}
                    onChange={(event) => setEditedContent(event.target.value)}
                    disabled={savingFramework}
                    className="h-full min-h-[420px] w-full resize-none rounded-md border border-neutral-200 bg-neutral-50 p-3 font-mono text-[12px] leading-5 text-neutral-800 outline-none focus:border-neutral-400 disabled:opacity-50 dark:border-neutral-700 dark:bg-neutral-950 dark:text-neutral-200"
                  />
                ) : (
                  <Markdown>{activeResult === "clarification" ? clarificationContent : activeResult === "diff" ? diffContent : generatedContent}</Markdown>
                )}
              </div>
            </div>
          ) : (
            <p className="flex h-full items-center justify-center text-[12.5px] text-neutral-400">
              {clarifying ? "正在生成澄清问题..." : generating ? "正在生成业务需求分析框架..." : "生成后在这里预览"}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
