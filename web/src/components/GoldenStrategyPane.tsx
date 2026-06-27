import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Background,
  Controls,
  Handle,
  Position,
  ReactFlow,
  ReactFlowProvider,
  type Edge,
  type Node,
  type NodeProps,
} from "@xyflow/react";
import { AlertTriangle, BrainCircuit, Check, Loader2, RefreshCw, Sparkles, FlaskConical } from "lucide-react";
import { useBusinessRequirementContexts, type BusinessRequirementContextScope } from "@/components/useBusinessRequirementContexts";
import { api } from "@/lib/api";
import { engineApi } from "@/lib/api/engine";
import { cn } from "@/lib/cn";
import { useResumableTask } from "@/lib/resumableTask";
import type { Flow, FlowTreeNode, GoldenStrategyError, GoldenStrategyModelId, GoldenStrategyNode, GoldenStrategyResult, PiModel } from "@/types";

interface GoldenStrategyBatchResult {
  results: GoldenStrategyResult[];
  errors: GoldenStrategyError[];
}

type Scope =
  | { type: "session"; sessionId: string | null }
  | { type: "flow"; flow: Flow | null }
  | { type: "workspace"; workspaceId: string };

interface ReportOption {
  id: string;
  label: string;
  pathId: number;
  relPath: string;
}

interface AnalysisModelOption {
  id: GoldenStrategyModelId;
  label: string;
  hint: string;
  keywords: string[];
}

type NodeData = Pick<GoldenStrategyNode, "title" | "body" | "kind">;

const DEFAULT_MODEL = "minimax-cn/MiniMax-M3";
const MAX_SELECTED_MODELS = 3;

const ANALYSIS_MODELS: AnalysisModelOption[] = [
  { id: "decision_tree", label: "决策树分析", hint: "拆解决策因子、证据与结论建议", keywords: ["决策", "选择", "方案", "建议", "判断", "取舍", "优先级", "结论"] },
  { id: "toc", label: "TOC 约束理论", hint: "识别主约束、根因链与五步法动作", keywords: ["约束", "瓶颈", "产能", "流程", "效率", "卡点", "延迟", "吞吐", "根因"] },
  { id: "swot", label: "SWOT 分析", hint: "梳理优势、劣势、机会与威胁", keywords: ["优势", "劣势", "机会", "威胁", "竞争力", "风险", "内外部", "战略"] },
  { id: "pestel", label: "PESTEL 分析", hint: "扫描宏观环境的六类影响因素", keywords: ["政策", "监管", "宏观", "经济", "社会", "技术", "环境", "法律", "法规"] },
  { id: "porter_five_forces", label: "Porter 五力模型", hint: "评估行业竞争结构与压力来源", keywords: ["行业", "竞争", "供应商", "买方", "客户议价", "替代品", "进入者", "市场格局"] },
  { id: "value_chain", label: "价值链分析", hint: "拆解主要活动、支持活动与价值杠杆", keywords: ["价值链", "成本", "运营", "生产", "交付", "服务", "采购", "活动", "效率"] },
  { id: "bcg_matrix", label: "BCG 矩阵", hint: "判断业务组合与资源配置优先级", keywords: ["业务组合", "市场份额", "增长率", "资源配置", "明星", "现金牛", "问题业务", "产品线"] },
  { id: "ansoff_matrix", label: "Ansoff 增长矩阵", hint: "推演市场与产品增长路径", keywords: ["增长", "新市场", "现有市场", "新产品", "市场渗透", "市场开发", "产品开发", "多元化"] },
  { id: "marketing_4p", label: "4P 营销组合", hint: "分析产品、价格、渠道与推广策略", keywords: ["营销", "产品", "价格", "渠道", "推广", "销售", "促销", "品牌", "投放"] },
  { id: "business_model_canvas", label: "商业模式画布", hint: "刻画九宫格商业模式要素", keywords: ["商业模式", "客户细分", "价值主张", "收入", "渠道", "伙伴", "资源", "成本结构"] },
];
const DEFAULT_ANALYSIS_MODEL = ANALYSIS_MODELS[0]!;

function basenamePath(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).at(-1) ?? path;
}

function flattenFiles(node: FlowTreeNode | null): FlowTreeNode[] {
  const out: FlowTreeNode[] = [];
  const walk = (n: FlowTreeNode) => {
    if (n.kind === "file") out.push(n);
    for (const child of n.children ?? []) walk(child);
  };
  if (node) walk(node);
  return out;
}

function isReportFile(name: string): boolean {
  return /\.(md|markdown|txt)$/i.test(name)
    && (/report|summary|result|insight|分析|报告|结论|洞察|建议/i.test(name)
      || /\.(md|markdown)$/i.test(name));
}

interface ModelRecommendation {
  model: AnalysisModelOption;
  reason: string;
}

function countMatches(text: string, keyword: string): number {
  if (!keyword) return 0;
  let count = 0;
  let index = text.indexOf(keyword);
  while (index >= 0) {
    count += 1;
    index = text.indexOf(keyword, index + keyword.length);
  }
  return count;
}

function recommendAnalysisModels(reportName: string, content: string): ModelRecommendation[] {
  const source = `${reportName}\n${content.slice(0, 8000)}`.toLowerCase();
  const scored = ANALYSIS_MODELS.map((model, index) => {
    const hits = model.keywords
      .map((keyword) => ({ keyword, count: countMatches(source, keyword.toLowerCase()) }))
      .filter((item) => item.count > 0);
    const score = hits.reduce((sum, item) => sum + item.count, 0);
    return { model, score, index, hits };
  }).sort((a, b) => b.score - a.score || a.index - b.index);
  const picked = scored.slice(0, 3);
  return picked.map((item) => {
    const topKeywords = item.hits.slice(0, 3).map((hit) => hit.keyword);
    const reason = topKeywords.length > 0
      ? `报告提到 ${topKeywords.join("、")}`
      : item.model.hint;
    return { model: item.model, reason };
  });
}

function toFlowNodes(items: GoldenStrategyNode[]): { nodes: Node[]; edges: Edge[] } {
  const byId = new Map(items.map((item) => [item.id, item]));
  const depthCache = new Map<string, number>();
  const depthOf = (item: GoldenStrategyNode): number => {
    const cached = depthCache.get(item.id);
    if (cached !== undefined) return cached;
    if (!item.parentId) {
      depthCache.set(item.id, 0);
      return 0;
    }
    const parent = byId.get(item.parentId);
    const depth = parent ? depthOf(parent) + 1 : 0;
    depthCache.set(item.id, depth);
    return depth;
  };
  const levels = new Map<number, GoldenStrategyNode[]>();
  items.forEach((item) => {
    const depth = depthOf(item);
    levels.set(depth, [...(levels.get(depth) ?? []), item]);
  });
  const nodes: Node[] = items.map((item) => {
    const depth = depthOf(item);
    const level = levels.get(depth) ?? [];
    const index = level.findIndex((candidate) => candidate.id === item.id);
    return {
      id: item.id,
      type: "strategy",
      position: { x: 48 + depth * 310, y: 64 + index * 150 },
      data: { title: item.title, body: item.body, kind: item.kind } satisfies NodeData,
    };
  });
  const edges: Edge[] = items
    .filter((item) => item.parentId)
    .map((item) => ({
      id: `${item.parentId}-${item.id}`,
      source: item.parentId!,
      target: item.id,
      type: "smoothstep",
      animated: item.kind === "conclusion" || item.kind === "action" || item.kind === "monitor",
    }));
  return { nodes, edges };
}

function nodeTheme(kind: string): string {
  if (["root", "goal", "customer_segment", "value_proposition"].includes(kind)) {
    return "border-sky-200 bg-sky-50 text-sky-950 dark:border-sky-900 dark:bg-sky-950/30 dark:text-sky-100";
  }
  if (["conclusion", "action", "opportunity", "star", "cash_cow", "market_penetration"].includes(kind)) {
    return "border-emerald-200 bg-emerald-50 text-emerald-950 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-100";
  }
  if (["weakness", "threat", "constraint", "rivalry", "substitute", "new_entrant", "dog"].includes(kind)) {
    return "border-rose-200 bg-rose-50 text-rose-950 dark:border-rose-900 dark:bg-rose-950/30 dark:text-rose-100";
  }
  if (["factor", "evidence", "root_cause", "question_mark", "price", "cost_structure"].includes(kind)) {
    return "border-amber-200 bg-amber-50 text-amber-950 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-100";
  }
  return "border-neutral-200 bg-white text-neutral-800 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-200";
}

function StrategyCard({ data }: NodeProps) {
  const d = data as unknown as NodeData;
  return (
    <div className={cn("w-64 rounded-xl border px-3 py-2 shadow-sm", nodeTheme(d.kind))}>
      <Handle type="target" position={Position.Left} className="!h-2 !w-2 !border-none !bg-neutral-400" />
      <div className="flex items-center gap-1.5 text-[12px] font-semibold">
        <BrainCircuit className="h-3.5 w-3.5 shrink-0" strokeWidth={1.75} />
        <span className="truncate">{d.title}</span>
      </div>
      <p className="mt-1.5 line-clamp-5 whitespace-pre-line text-[11px] leading-4 opacity-80">{d.body}</p>
      <Handle type="source" position={Position.Right} className="!h-2 !w-2 !border-none !bg-neutral-400" />
    </div>
  );
}

const nodeTypes = { strategy: StrategyCard };

function StrategyCanvas({ nodes }: { nodes: GoldenStrategyNode[] }) {
  const flow = useMemo(() => toFlowNodes(nodes), [nodes]);
  return (
    <ReactFlowProvider>
      <ReactFlow nodes={flow.nodes} edges={flow.edges} nodeTypes={nodeTypes} fitView minZoom={0.2} maxZoom={1.5}>
        <Background gap={18} size={1} />
        <Controls />
      </ReactFlow>
    </ReactFlowProvider>
  );
}

function defaultModelId(models: PiModel[]): string {
  return models.find((model) => model.id === DEFAULT_MODEL)?.id
    ?? models.find((model) => model.isDefault)?.id
    ?? models[0]?.id
    ?? DEFAULT_MODEL;
}

export function GoldenStrategyPane({
  scope,
  models,
  onGenerated,
  onNavigateToActions,
}: {
  scope: Scope;
  models: PiModel[];
  onGenerated?: () => void;
  onNavigateToActions?: () => void;
}) {
  const [reports, setReports] = useState<ReportOption[]>([]);
  const [selectedReportId, setSelectedReportId] = useState("");
  const [content, setContent] = useState("");
  const [selectedAnalysisModels, setSelectedAnalysisModels] = useState<GoldenStrategyModelId[]>(["decision_tree"]);
  const [model, setModel] = useState(DEFAULT_MODEL);
  const [prompt, setPrompt] = useState("");
  const [loadingReports, setLoadingReports] = useState(false);
  const [loadingContent, setLoadingContent] = useState(false);
  const [error, setError] = useState("");
  const scopeRef = useRef(scope);
  scopeRef.current = scope;

  const scopeType = scope.type;
  const scopeSessionId = scope.type === "session" ? scope.sessionId : null;
  const scopeFlowId = scope.type === "flow" ? scope.flow?.id ?? null : null;
  const scopeWorkspaceId = scope.type === "workspace" ? scope.workspaceId : null;

  const selectedReport = reports.find((report) => report.id === selectedReportId) ?? null;
  const taskKey = useMemo(
    () =>
      selectedReport
        ? "golden:" + (scopeSessionId ?? scopeFlowId ?? scopeWorkspaceId ?? "") + ":" + selectedReport.pathId + ":" + selectedReport.relPath
        : "golden:__inactive__",
    [scopeSessionId, scopeFlowId, scopeWorkspaceId, selectedReport],
  );
  const task = useResumableTask<GoldenStrategyBatchResult>(taskKey);
  const generating = task.status === "running";
  const results = task.data?.results ?? [];
  const resultErrors = task.data?.errors ?? [];
  const taskError = task.error;
  const [activeResultModel, setActiveResultModel] = useState<GoldenStrategyModelId | null>(null);

  // D-EVOLVE2: eval candidate state
  const [evalSubmitting, setEvalSubmitting] = useState(false);
  const [evalSubmitted, setEvalSubmitted] = useState(false);

  const workspaceId = scope.type === "workspace" ? scope.workspaceId : null;

  useEffect(() => {
    if (task.status !== "done") return;
    setActiveResultModel((current) => current ?? task.data?.results[0]?.analysisModel ?? null);
    const firstModel = task.data?.results[0]?.model;
    if (firstModel) setModel((prev) => prev === firstModel ? prev : firstModel);
  }, [task.status, task.data]);

  const primarySelectedAnalysis = ANALYSIS_MODELS.find((item) => item.id === selectedAnalysisModels[0]) ?? DEFAULT_ANALYSIS_MODEL;
  const recommendations = useMemo(
    () => selectedReport && content.trim() ? recommendAnalysisModels(basenamePath(selectedReport.label), content) : [],
    [content, selectedReport],
  );
  const activeResult = results.find((item) => item.analysisModel === activeResultModel) ?? results[0] ?? null;
  const businessRequirementScope = useMemo<BusinessRequirementContextScope | null>(() => {
    if (scopeType === "session") return scopeSessionId ? { type: "session", sessionId: scopeSessionId } : null;
    if (scopeType === "workspace") return scopeWorkspaceId ? { type: "workspace", workspaceId: scopeWorkspaceId } : null;
    return scopeFlowId ? { type: "flow", flowId: scopeFlowId } : null;
  }, [scopeFlowId, scopeSessionId, scopeType, scopeWorkspaceId]);
  const {
    contexts: businessRequirementContexts,
    selectedId: selectedBusinessRequirementId,
    setSelectedId: setSelectedBusinessRequirementId,
    selectedContext: selectedBusinessRequirement,
    loading: loadingBusinessRequirementContexts,
  } = useBusinessRequirementContexts(businessRequirementScope);

  useEffect(() => {
    if (models.some((item) => item.id === model)) return;
    setModel(defaultModelId(models));
  }, [model, models]);

  const loadReports = useCallback(async () => {
    const sc = scopeRef.current;
    setLoadingReports(true);
    setError("");
    setReports([]);
    setSelectedReportId("");
    setContent("");
    setActiveResultModel(null);
    try {
      // 统一数据源：扫「报告输出」登记路径（与汇报版本/报告审核一致），不再扫 session/flow 原生 artifact tree。
      const paths = sc.type === "session"
        ? sc.sessionId ? await api.listSessionPaths(sc.sessionId, "report") : []
        : sc.type === "workspace"
          ? sc.workspaceId ? await api.listWorkspacePaths(sc.workspaceId, "report") : []
          : sc.flow ? await api.listFlowPaths(sc.flow.id, "report") : [];
      const found = await Promise.all(paths.map(async (path) => {
        if (path.kind === "file") {
          return isReportFile(basenamePath(path.path))
            ? [{ id: `${path.id}:`, label: basenamePath(path.path), pathId: path.id, relPath: "" }]
            : [];
        }
        const tree = await api.workspacePathTree(path.id);
        return flattenFiles(tree)
          .filter((file) => isReportFile(file.name))
          .map((file) => ({
            id: `${path.id}:${file.path}`,
            label: file.path,
            pathId: path.id,
            relPath: file.path,
          }));
      }));
      const next = found.flat();
      setReports(next);
      setSelectedReportId(next[0]?.id ?? "");
    } catch (err) {
      setError(String(err));
    } finally {
      setLoadingReports(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scopeType, scopeSessionId, scopeFlowId, scopeWorkspaceId]);

  useEffect(() => {
    void loadReports();
  }, [loadReports]);

  useEffect(() => {
    setContent("");
    setActiveResultModel(null);
    if (!selectedReport) return;
    setLoadingContent(true);
    setError("");
    api.workspacePathFileGet(selectedReport.pathId, selectedReport.relPath)
      .then((result) => setContent(result.content ?? ""))
      .catch((err) => setError(String(err)))
      .finally(() => setLoadingContent(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedReport?.id]);

  useEffect(() => {
    if (!selectedReport || !content.trim()) return;
    const next = recommendAnalysisModels(basenamePath(selectedReport.label), content).map((item) => item.model.id);
    if (next.length > 0) setSelectedAnalysisModels(next);
  }, [content, selectedReport]);

  const toggleAnalysisModel = useCallback((id: GoldenStrategyModelId) => {
    setSelectedAnalysisModels((current) => {
      if (current.includes(id)) {
        return current.length > 1 ? current.filter((item) => item !== id) : current;
      }
      return current.length >= MAX_SELECTED_MODELS ? [...current.slice(1), id] : [...current, id];
    });
  }, []);

  const generate = useCallback(async () => {
    if (!selectedReport || !content.trim() || generating || selectedAnalysisModels.length === 0) return;
    setError("");
    setActiveResultModel(null);
    setEvalSubmitted(false);
    await task.start(async () => {
      const result = await api.generateGoldenStrategyBatch({
        pathId: selectedReport.pathId,
        relPath: selectedReport.relPath,
        analysisModels: selectedAnalysisModels,
        prompt,
        model: model || DEFAULT_MODEL,
        businessRequirementContext: selectedBusinessRequirement ? {
          pathId: selectedBusinessRequirement.pathId,
          markdownPath: selectedBusinessRequirement.markdownPath,
          jsonPath: selectedBusinessRequirement.jsonPath,
        } : undefined,
      });
      if (result.results.length > 0) onGenerated?.();
      if (result.results.length === 0 && result.errors.length > 0) {
        throw new Error(result.errors.map((item) => `${item.analysisModel}: ${item.error}`).join("\n"));
      }
      return { results: result.results, errors: result.errors };
    });
  }, [content, generating, model, onGenerated, prompt, selectedAnalysisModels, selectedBusinessRequirement, selectedReport, task]);

  // D-EVOLVE2: submit golden strategy result as eval candidate
  const submitStrategyAsEval = async () => {
    if (!workspaceId || !activeResult || !selectedReport) return;
    setEvalSubmitting(true);
    try {
      const modelLabel = ANALYSIS_MODELS.find((m) => m.id === activeResult.analysisModel)?.label ?? activeResult.analysisModel;
      await engineApi.createEvalRecord(workspaceId, {
        failingTrace: {
          runId: `golden:${workspaceId}:${selectedReport.pathId}:${selectedReport.relPath}`,
          module: "chat",
          outcome: "fail",
          steps: [{
            stage: "golden-strategy-generation",
            input: JSON.stringify({ reportPath: selectedReport.relPath, analysisModel: activeResult.analysisModel, model }),
            output: JSON.stringify({ nodeCount: activeResult.nodes.length, topNodes: activeResult.nodes.slice(0, 5).map((n) => ({ title: n.title, kind: n.kind })) }),
            citation: activeResult.analysisModel,
          }],
        },
        expectedOutput: `Improve golden strategy analysis for ${modelLabel} on report ${selectedReport.label}`,
        passCondition: "The strategy analysis should produce actionable conclusions and clear decision factors without hallucinated data.",
      });
      setEvalSubmitted(true);
    } catch (e) {
      setError("提交 eval 候选失败: " + String(e));
    } finally {
      setEvalSubmitting(false);
    }
  };

  const emptyHint = "请先在「报告输出」tab 添加报告输出文件夹或文件";

  return (
    <div className="flex h-full min-h-0 flex-col bg-white dark:bg-neutral-950">
      <div className="flex shrink-0 flex-col gap-2 border-b border-neutral-200 px-4 py-3 dark:border-neutral-800">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 text-[13px] font-semibold text-neutral-900 dark:text-neutral-100">
            <BrainCircuit className="h-4 w-4 text-neutral-500" strokeWidth={1.75} />
            黄金策
          </div>
          <select
            value={selectedReportId}
            onChange={(event) => setSelectedReportId(event.target.value)}
            disabled={loadingReports || reports.length === 0 || generating}
            className="h-8 min-w-0 flex-1 rounded-md border border-neutral-200 bg-transparent px-2 text-[12px] text-neutral-700 outline-none disabled:opacity-50 dark:border-neutral-700 dark:text-neutral-200"
          >
            {reports.length === 0 ? (
              <option value="">{loadingReports ? "正在扫描报告…" : emptyHint}</option>
            ) : (
              reports.map((report) => (
                <option key={report.id} value={report.id}>{report.label}</option>
              ))
            )}
          </select>
          <select
            value={model}
            onChange={(event) => setModel(event.target.value)}
            disabled={generating}
            className="h-8 w-52 rounded-md border border-neutral-200 bg-transparent px-2 text-[12px] text-neutral-700 outline-none disabled:opacity-50 dark:border-neutral-700 dark:text-neutral-200"
          >
            {(models.length > 0 ? models : [{ id: DEFAULT_MODEL, provider: "minimax-cn", model: "MiniMax-M3", isDefault: true }]).map((item) => (
              <option key={item.id} value={item.id}>{item.id}</option>
            ))}
          </select>
          <button
            onClick={() => void loadReports()}
            disabled={loadingReports || generating}
            className="inline-flex h-8 items-center gap-1.5 rounded-md px-2 text-[12px] text-neutral-500 hover:bg-neutral-100 disabled:opacity-50 dark:text-neutral-400 dark:hover:bg-neutral-800"
          >
            <RefreshCw className={cn("h-3.5 w-3.5", loadingReports && "animate-spin")} strokeWidth={1.75} />
            刷新
          </button>
          <button
            onClick={() => void generate()}
            disabled={!selectedReport || !content.trim() || loadingContent || generating || selectedAnalysisModels.length === 0}
            className="inline-flex h-8 items-center gap-1.5 rounded-md bg-neutral-900 px-3 text-[12px] font-medium text-white hover:bg-neutral-700 disabled:opacity-50 dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-white"
          >
            {generating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" strokeWidth={1.75} />}
            {generating ? "并行推理中…" : `生成 ${selectedAnalysisModels.length} 个图示`}
          </button>
        </div>

        <div className="grid grid-cols-1 gap-2 lg:grid-cols-[minmax(180px,260px)_minmax(220px,320px)_1fr]">
          <select
            value={selectedBusinessRequirementId}
            onChange={(event) => setSelectedBusinessRequirementId(event.target.value)}
            disabled={generating || loadingBusinessRequirementContexts || businessRequirementContexts.length === 0}
            className="h-8 min-w-0 rounded-md border border-neutral-200 bg-transparent px-2 text-[12px] text-neutral-700 outline-none disabled:opacity-50 dark:border-neutral-700 dark:text-neutral-200"
          >
            <option value="">{loadingBusinessRequirementContexts ? "读取业务需求..." : "不使用业务需求"}</option>
            {businessRequirementContexts.map((item) => (
              <option key={item.id} value={item.id}>{item.label}</option>
            ))}
          </select>
          <div className="flex h-8 items-center rounded-md border border-neutral-200 px-2 text-[12px] text-neutral-500 dark:border-neutral-700 dark:text-neutral-400">
            已选 {selectedAnalysisModels.length}/{MAX_SELECTED_MODELS} 个模型
          </div>
          <input
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            disabled={generating}
            placeholder={`${primarySelectedAnalysis.hint}；可输入本次模拟分析重点`}
            className="h-8 rounded-md border border-neutral-200 bg-transparent px-2 text-[12px] text-neutral-700 outline-none placeholder:text-neutral-400 disabled:opacity-50 dark:border-neutral-700 dark:text-neutral-200"
          />
        </div>

        {recommendations.length > 0 && (
          <div className="grid grid-cols-3 gap-2">
            {recommendations.map((item) => {
              const selected = selectedAnalysisModels.includes(item.model.id);
              return (
                <button
                  key={item.model.id}
                  onClick={() => toggleAnalysisModel(item.model.id)}
                  disabled={generating}
                  className={cn(
                    "min-h-14 rounded-md border px-3 py-2 text-left disabled:opacity-50",
                    selected
                      ? "border-emerald-300 bg-emerald-50 text-emerald-950 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-100"
                      : "border-neutral-200 bg-transparent text-neutral-700 hover:bg-neutral-50 dark:border-neutral-800 dark:text-neutral-200 dark:hover:bg-neutral-900",
                  )}
                >
                  <div className="flex items-center gap-1.5 text-[12px] font-semibold">
                    {selected && <Check className="h-3.5 w-3.5" strokeWidth={1.75} />}
                    {item.model.label}
                  </div>
                  <div className="mt-1 line-clamp-2 text-[11px] leading-4 opacity-70">{item.reason}</div>
                </button>
              );
            })}
          </div>
        )}

        <div className="flex flex-wrap gap-1.5">
          {ANALYSIS_MODELS.map((item) => {
            const selected = selectedAnalysisModels.includes(item.id);
            return (
              <button
                key={item.id}
                onClick={() => toggleAnalysisModel(item.id)}
                disabled={generating}
                title={item.hint}
                className={cn(
                  "inline-flex h-7 items-center gap-1 rounded-md border px-2 text-[11px] disabled:opacity-50",
                  selected
                    ? "border-neutral-900 bg-neutral-900 text-white dark:border-neutral-100 dark:bg-neutral-100 dark:text-neutral-900"
                    : "border-neutral-200 text-neutral-600 hover:bg-neutral-50 dark:border-neutral-800 dark:text-neutral-300 dark:hover:bg-neutral-900",
                )}
              >
                {selected && <Check className="h-3 w-3" strokeWidth={1.75} />}
                {item.label}
              </button>
            );
          })}
        </div>
      </div>

      {(error || taskError) && (
        <div className="flex items-center gap-1.5 border-b border-rose-100 bg-rose-50 px-4 py-2 text-[12px] text-rose-600 dark:border-rose-950 dark:bg-rose-950/30 dark:text-rose-300">
          <AlertTriangle className="h-3.5 w-3.5" />
          {error || taskError}
        </div>
      )}
      {results.length > 0 && (
        <div className="flex items-center gap-2 border-b border-emerald-100 bg-emerald-50 px-4 py-2 text-[12px] text-emerald-700 dark:border-emerald-950 dark:bg-emerald-950/30 dark:text-emerald-300">
          <span className="shrink-0">已保存 {results.length} 个黄金策图示</span>
          <div className="flex min-w-0 flex-1 flex-wrap gap-1">
            {results.map((result) => {
              const option = ANALYSIS_MODELS.find((item) => item.id === result.analysisModel);
              return (
                <button
                  key={result.analysisModel}
                  onClick={() => setActiveResultModel(result.analysisModel)}
                  className={cn(
                    "h-6 rounded-md px-2 text-[11px]",
                    activeResult?.analysisModel === result.analysisModel
                      ? "bg-emerald-700 text-white dark:bg-emerald-300 dark:text-emerald-950"
                      : "bg-emerald-100 text-emerald-800 hover:bg-emerald-200 dark:bg-emerald-900 dark:text-emerald-100",
                  )}
                >
                  {option?.label ?? result.analysisModel}
                </button>
              );
            })}
          </div>
          {activeResult && <span className="truncate">{activeResult.path}</span>}
        </div>
      )}
      {resultErrors.length > 0 && (
        <div className="border-b border-amber-100 bg-amber-50 px-4 py-2 text-[12px] text-amber-700 dark:border-amber-950 dark:bg-amber-950/30 dark:text-amber-300">
          {resultErrors.length} 个模型生成失败：{resultErrors.map((item) => item.analysisModel).join("、")}
        </div>
      )}

      <div className="flex min-h-0 flex-1">
        <main className="h-full min-w-0 flex-1">
          {activeResult ? (
            <StrategyCanvas nodes={activeResult.nodes} />
          ) : (
            <div className="flex h-full items-center justify-center px-6 text-center text-[12px] leading-5 text-neutral-400">
              选择报告和最多 3 个分析模型后生成黄金策图示；结果会保存到报告输出目录的 golden_strategy/
            </div>
          )}
        </main>
        {/* 业务洞见：基于当前决策模型演绎结果提炼（脚手架，LLM 提炼下一轮接入） */}
        <aside className="flex w-80 shrink-0 flex-col border-l border-neutral-200 bg-neutral-50/40 dark:border-neutral-800 dark:bg-neutral-950/40">
          <div className="flex h-10 shrink-0 items-center gap-1.5 border-b border-neutral-200 px-3 text-[12.5px] font-semibold text-neutral-800 dark:border-neutral-800 dark:text-neutral-200">
            <Sparkles className="h-3.5 w-3.5 text-violet-500" strokeWidth={1.75} />
            业务洞见
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto p-3 flex flex-col justify-between">
            <div>
              {activeResult ? (
                <div className="space-y-3">
                  <p className="text-[12px] leading-5 text-neutral-400">
                    基于「{ANALYSIS_MODELS.find((item) => item.id === activeResult.analysisModel)?.label ?? activeResult.analysisModel}」决策模型演绎结果提炼业务洞见，即将推出。
                  </p>
                  {evalSubmitted ? (
                    <div className="flex items-center gap-1.5 rounded-md border border-violet-200 bg-violet-50 px-3 py-2 text-[11px] text-violet-700 dark:border-violet-800 dark:bg-violet-950/30 dark:text-violet-300">
                      <Check className="h-3 w-3" /> 已提为 eval 候选
                    </div>
                  ) : (
                    <button
                      onClick={() => void submitStrategyAsEval()}
                      disabled={evalSubmitting}
                      className="w-full flex items-center justify-center gap-1.5 rounded-md border border-violet-200 bg-white px-3 py-2 text-[11px] text-violet-600 hover:bg-violet-50 disabled:opacity-50 dark:border-violet-800 dark:bg-neutral-900 dark:text-violet-400 dark:hover:bg-violet-950/40"
                      title="将此分析结果提为 eval 候选，供后续评测改进"
                    >
                      {evalSubmitting ? <Loader2 className="h-3 w-3 animate-spin" /> : <FlaskConical className="h-3 w-3" />}
                      纠正并提为 eval 候选
                    </button>
                  )}
                </div>
              ) : (
                <p className="text-[12px] leading-5 text-neutral-400">
                  生成决策模型图示后，这里将基于演绎结果自动提炼业务洞见。
                </p>
              )}
            </div>
            
            {onNavigateToActions && (
              <div className="mt-4 pt-4 border-t border-neutral-200 dark:border-neutral-800">
                <button
                  onClick={onNavigateToActions}
                  className="w-full flex items-center justify-center gap-1.5 py-2 px-3 rounded-md bg-emerald-50 text-emerald-700 hover:bg-emerald-100 dark:bg-emerald-950/30 dark:text-emerald-300 dark:hover:bg-emerald-900/40 transition-colors text-[12px] font-medium border border-emerald-200 dark:border-emerald-800"
                >
                  <Sparkles className="h-3.5 w-3.5" />
                  去提取行动项 ➔
                </button>
              </div>
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}
