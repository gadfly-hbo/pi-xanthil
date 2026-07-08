import { useCallback, useEffect, useMemo, useState } from "react";
import { Wrench, ShieldCheck, Bot, FlaskConical, RefreshCw, Activity, Search, Tags, Copy, Check, AlertTriangle, AlertOctagon, Ban, ArrowRight, User } from "lucide-react";
import { cn } from "@/lib/cn";
import { api } from "@/lib/api";
import type { ExtractionTool, ToolEvalCase, ToolRunRecord, RiskLevel } from "@/types";
import type { FolderScope } from "@/tabs/types";
import type { ToolAiExposure, ToolTableShape } from "@/types";

interface Props {
  scope: FolderScope;
  workspaceId: string | null;
}

type Category = "ingestion" | "analysis";
type RiskFilter = "all" | "L0" | "L1" | "L2" | "L3";
type DeprecatedFilter = "all" | "yes" | "no";
type ReplacementFilter = "all" | "has" | "missing";
type ShapeFilter = "all" | ToolTableShape;
type AiExposureFilter = "all" | "any" | "none" | ToolAiExposure;

type EvalState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "loaded"; cases: ToolEvalCase[] }
  | { status: "error"; message: string };

const CATEGORY_LABEL: Record<Category, string> = {
  ingestion: "摄取",
  analysis: "分析",
};

const AI_EXPOSURE_LABEL: Record<ToolAiExposure, string> = {
  manual_confirmed: "人工确认",
  mcp: "MCP",
  command: "Command",
  subagent: "Subagent",
  workflow: "Workflow",
  eval: "评测",
};

const TABLE_SHAPE_LABEL: Record<ToolTableShape, string> = {
  aggregate: "聚合",
  row_level: "行级",
  unknown: "未知",
};

const AUTOMATION_EXPOSURES: ToolAiExposure[] = ["mcp", "command", "subagent", "workflow"];
const DEFAULT_ANALYSIS_AI_EXPOSURE: ToolAiExposure[] = ["manual_confirmed", "mcp", "command", "subagent", "workflow", "eval"];

function categoryOf(tool: ExtractionTool): Category {
  return tool.category === "analysis" ? "analysis" : "ingestion";
}

function isMcpExposed(tool: ExtractionTool): boolean {
  return canExposeTo(tool, "mcp");
}

function hasNonMcpAutomationExposure(tool: ExtractionTool): boolean {
  return ["command", "subagent", "workflow"].some((e) => canExposeTo(tool, e as ToolAiExposure));
}

function isManualOrEvalExposed(tool: ExtractionTool): boolean {
  return canExposeTo(tool, "manual_confirmed") || canExposeTo(tool, "eval");
}

function exposureSummaryLabel(tool: ExtractionTool): string {
  if (isMcpExposed(tool)) return "经 MCP 暴露给 AI";
  if (hasNonMcpAutomationExposure(tool)) return "可经自动化入口";
  if (isManualOrEvalExposed(tool)) return "仅人工确认 / 评测";
  return "不向 AI 暴露";
}

function normalizeTag(tag: string): string {
  return tag.trim().toLowerCase();
}

function toolTags(tool: ExtractionTool): string[] {
  const explicit = tool.tags ?? [];
  return [...new Set(explicit.map(normalizeTag).filter(Boolean))];
}

function deriveAiExposure(tool: ExtractionTool): ToolAiExposure[] {
  if (tool.aiExposure !== undefined) return [...tool.aiExposure];
  return categoryOf(tool) === "analysis" ? [...DEFAULT_ANALYSIS_AI_EXPOSURE] : [];
}

function applyRiskLevelCap(exposure: ToolAiExposure[], riskLevel: RiskLevel | undefined): ToolAiExposure[] {
  if (!riskLevel || riskLevel === "L0" || riskLevel === "L1") return exposure;
  if (riskLevel === "L2") return exposure.filter((e) => e !== "mcp");
  return exposure.filter((e) => e === "manual_confirmed" || e === "eval");
}

function applyDeprecatedFilter(exposure: ToolAiExposure[], deprecated: boolean | undefined): ToolAiExposure[] {
  if (!deprecated) return exposure;
  return exposure.filter((e) => e === "manual_confirmed" || e === "eval");
}

function getEffectiveAiExposure(tool: ExtractionTool): ToolAiExposure[] {
  const raw = deriveAiExposure(tool);
  const capped = applyRiskLevelCap(raw, tool.riskLevel);
  return applyDeprecatedFilter(capped, tool.deprecated);
}

function hasAutomationCandidateExposure(exposure: ToolAiExposure[]): boolean {
  return exposure.some((e) => AUTOMATION_EXPOSURES.includes(e));
}

function canExposeTo(tool: ExtractionTool, exposure: ToolAiExposure): boolean {
  return getEffectiveAiExposure(tool).includes(exposure);
}

function deriveOutputContract(tool: ExtractionTool): NonNullable<ExtractionTool["outputContract"]> {
  return tool.outputContract ?? { tableShape: "unknown" };
}

function getReplacementTool(allTools: ExtractionTool[], replacementToolId: string | undefined): ExtractionTool | null {
  if (!replacementToolId) return null;
  return allTools.find((t) => t.id === replacementToolId) ?? null;
}

function getToolGovernanceWarnings(tool: ExtractionTool, allTools: ExtractionTool[]): string[] {
  const warnings: string[] = [];
  const raw = deriveAiExposure(tool);
  const capped = applyRiskLevelCap(raw, tool.riskLevel);
  const removedByRiskLevel = raw.filter((e) => !capped.includes(e));
  if (removedByRiskLevel.length > 0) {
    warnings.push(`riskLevel=${tool.riskLevel} 移除了自动化入口：${removedByRiskLevel.map((e) => AI_EXPOSURE_LABEL[e]).join(", ")}`);
  }
  const effective = applyDeprecatedFilter(capped, tool.deprecated);
  const removedByDeprecated = capped.filter((e) => !effective.includes(e));
  if (removedByDeprecated.length > 0) {
    warnings.push(`已退役工具移除了自动化入口：${removedByDeprecated.map((e) => AI_EXPOSURE_LABEL[e]).join(", ")}`);
  }
  if (tool.replacementToolId) {
    const replacement = getReplacementTool(allTools, tool.replacementToolId);
    if (!replacement) {
      warnings.push(`替代工具 ${tool.replacementToolId} 不存在`);
    } else if (replacement.deprecated) {
      warnings.push(`替代工具 ${tool.replacementToolId} 也已退役`);
    }
  }
  const contract = deriveOutputContract(tool);
  if (contract.tableShape === "unknown") {
    warnings.push("输出形态未知，建议人工复核后再接入自动化入口");
  }
  if (contract.tableShape === "row_level") {
    warnings.push("输出为行级数据，禁止把产物正文注入 LLM");
  }
  if (!tool.owner) {
    warnings.push("缺少 owner 字段");
  }
  if (!tool.allowedUse && !tool.description) {
    warnings.push("缺少用途说明（allowedUse / description）");
  }
  if (tool.entry && !tool.entry.endsWith(".py") && tool.runtime !== "python3") {
    warnings.push("legacy adapter：非 python3 入口");
  }
  return warnings;
}

function getToolPolicyBlockers(tool: ExtractionTool): string[] {
  const blockers: string[] = [];
  const contract = deriveOutputContract(tool);
  for (const exposure of AUTOMATION_EXPOSURES) {
    if (!canExposeTo(tool, exposure)) {
      blockers.push(`${AI_EXPOSURE_LABEL[exposure]}：未暴露`);
      continue;
    }
    if (contract.tableShape === "unknown" && (exposure === "mcp" || exposure === "subagent") && !contract.llmSafeSummary) {
      blockers.push(`${AI_EXPOSURE_LABEL[exposure]}：输出形态未知且无 LLM-safe summary`);
    }
    if (contract.tableShape === "row_level" && (exposure === "mcp" || exposure === "subagent")) {
      blockers.push(`${AI_EXPOSURE_LABEL[exposure]}：输出为行级数据`);
    }
  }
  return blockers;
}

function toolSearchText(tool: ExtractionTool): string {
  return [
    tool.id,
    tool.name,
    tool.description,
    tool.category ?? "",
    tool.riskLevel ?? "",
    tool.owner ?? "",
    tool.replacementToolId ?? "",
    tool.input.accept.join(" "),
    tool.output.join(" "),
    tool.allowedUse ?? "",
    tool.forbiddenUse ?? "",
    tool.failureHandling ?? "",
    toolTags(tool).join(" "),
  ].join(" ").toLowerCase();
}

export function ToolUsePane({ workspaceId }: Props) {
  const [tools, setTools] = useState<ExtractionTool[]>([]);
  const [loadError, setLoadError] = useState("");
  const [reloading, setReloading] = useState(false);
  const [toolId, setToolId] = useState<string>("");
  const [filter, setFilter] = useState<"all" | Category>("all");
  const [query, setQuery] = useState("");
  const [tagFilter, setTagFilter] = useState("all");
  const [riskFilter, setRiskFilter] = useState<RiskFilter>("all");
  const [deprecatedFilter, setDeprecatedFilter] = useState<DeprecatedFilter>("all");
  const [replacementFilter, setReplacementFilter] = useState<ReplacementFilter>("all");
  const [shapeFilter, setShapeFilter] = useState<ShapeFilter>("all");
  const [aiExposureFilter, setAiExposureFilter] = useState<AiExposureFilter>("all");
  const [ownerFilter, setOwnerFilter] = useState("all");
  const [evalState, setEvalState] = useState<EvalState>({ status: "idle" });
  const [view, setView] = useState<"console" | "board">("console");
  const [copiedToolId, setCopiedToolId] = useState("");

  const reload = () => {
    setReloading(true);
    setLoadError("");
    api
      .listExtractionTools()
      .then((items) => {
        setTools(items);
        setToolId((cur) => cur || items[0]?.id || "");
      })
      .catch((err) => setLoadError(String(err)))
      .finally(() => setReloading(false));
  };

  useEffect(() => {
    reload();
  }, []);

  const tool = useMemo(() => tools.find((t) => t.id === toolId) ?? null, [tools, toolId]);

  const filteredTools = useMemo(() => {
    const q = query.trim().toLowerCase();
    return tools.filter((t) => {
      if (filter !== "all" && categoryOf(t) !== filter) return false;
      if (riskFilter !== "all" && t.riskLevel !== riskFilter) return false;
      if (tagFilter !== "all" && !toolTags(t).includes(tagFilter)) return false;
      if (deprecatedFilter !== "all") {
        const isDeprecated = !!t.deprecated;
        if (deprecatedFilter === "yes" && !isDeprecated) return false;
        if (deprecatedFilter === "no" && isDeprecated) return false;
      }
      if (replacementFilter !== "all") {
        const hasReplacement = !!t.replacementToolId;
        if (replacementFilter === "has" && !hasReplacement) return false;
        if (replacementFilter === "missing" && hasReplacement) return false;
      }
      if (shapeFilter !== "all") {
        const contract = deriveOutputContract(t);
        if (contract.tableShape !== shapeFilter) return false;
      }
      if (aiExposureFilter !== "all") {
        const effective = getEffectiveAiExposure(t);
        if (aiExposureFilter === "any" && !hasAutomationCandidateExposure(effective)) return false;
        if (aiExposureFilter === "none" && hasAutomationCandidateExposure(effective)) return false;
        if (aiExposureFilter !== "any" && aiExposureFilter !== "none" && !effective.includes(aiExposureFilter)) return false;
      }
      if (ownerFilter !== "all") {
        if ((t.owner ?? "未知") !== ownerFilter) return false;
      }
      if (q && !toolSearchText(t).includes(q)) return false;
      return true;
    });
  }, [tools, filter, query, riskFilter, tagFilter, deprecatedFilter, replacementFilter, shapeFilter, aiExposureFilter, ownerFilter]);

  const allTags = useMemo(() => {
    return [...new Set(tools.flatMap(toolTags))].sort((a, b) => a.localeCompare(b));
  }, [tools]);

  const allOwners = useMemo(() => {
    const set = new Set<string>();
    for (const t of tools) {
      set.add(t.owner ?? "未知");
    }
    return [...set].sort((a, b) => a.localeCompare(b));
  }, [tools]);

  const counts = useMemo(() => {
    let ingestion = 0;
    let analysis = 0;
    let deprecated = 0;
    let aiExposed = 0;
    for (const t of tools) {
      if (categoryOf(t) === "analysis") analysis += 1;
      else ingestion += 1;
      if (t.deprecated) deprecated += 1;
      if (hasAutomationCandidateExposure(getEffectiveAiExposure(t))) aiExposed += 1;
    }
    return { ingestion, analysis, total: tools.length, deprecated, aiExposed };
  }, [tools]);

  useEffect(() => {
    setEvalState({ status: "idle" });
  }, [toolId]);

  const loadCases = async () => {
    if (!toolId) return;
    setEvalState({ status: "loading" });
    try {
      const result = await api.getToolTestCases(toolId);
      setEvalState({ status: "loaded", cases: result.cases ?? [] });
    } catch (err) {
      setEvalState({ status: "error", message: String(err) });
    }
  };

  const copyToolId = async (id: string) => {
    await navigator.clipboard.writeText(id);
    setCopiedToolId(id);
    window.setTimeout(() => {
      setCopiedToolId((current) => current === id ? "" : current);
    }, 1500);
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-auto bg-neutral-50/60 p-5 dark:bg-neutral-950">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-4">
        <div>
          <h1 className="flex items-center gap-2 text-base font-semibold text-neutral-900 dark:text-neutral-100">
            <Wrench className="h-4 w-4" /> 计算工具 · tool-use（管理控制台）
          </h1>
          <p className="mt-1 text-[12.5px] text-neutral-500">
            统一查看本仓库注册的本地工具：用途分类（摄取 / 分析）、AI 暴露（由 aiExposure / riskLevel / deprecated 共同决定生效入口）、标签 / 参数 / 风险 / 适用场景。
          </p>
          <p className="mt-1 text-[11.5px] text-neutral-400">
            本面板只做<b>管理</b>：工具新增 / 修改的代码仍由开发者放在
            <code className="mx-1 font-mono text-[11px]">server/tools/</code>
            ；UI 不写代码、不在此跑用户数据。摄取类工具的手动试跑请使用「数据提取」面板；深度评测请打开「实验室 → tool」。
          </p>
        </div>

        <div className="inline-flex h-8 w-fit rounded-md border border-neutral-200 bg-neutral-100 p-0.5 dark:border-neutral-700 dark:bg-neutral-900">
          {([["console", "工具台账"], ["board", "运行看板"]] as const).map(([key, label]) => (
            <button
              key={key}
              onClick={() => setView(key)}
              className={cn(
                "inline-flex items-center gap-1 rounded px-3 text-[12px] font-medium transition-colors",
                view === key
                  ? "bg-white text-neutral-900 shadow-sm dark:bg-neutral-800 dark:text-neutral-100"
                  : "text-neutral-500 hover:text-neutral-800 dark:hover:text-neutral-200",
              )}
            >
              {key === "board" && <Activity className="h-3.5 w-3.5" />}
              {label}
            </button>
          ))}
        </div>

        {view === "board" && <ToolRunBoard workspaceId={workspaceId} />}

        {view === "console" && (
        <>
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-[12px] text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-200">
          <div className="flex items-center gap-2 font-medium">
            <ShieldCheck className="h-4 w-4" /> 边界声明
          </div>
          <ul className="mt-1 list-disc space-y-0.5 pl-5 text-[11.5px]">
            <li>
              <b>分析类（analysis）</b>工具默认可经 MCP 等入口暴露给 pi-agent，但<b>实际生效入口</b>由 manifest 的
              <code className="mx-1 font-mono text-[11px]">aiExposure</code>
              、
              <code className="mx-1 font-mono text-[11px]">riskLevel</code>
              、
              <code className="mx-1 font-mono text-[11px]">deprecated</code>
              共同决定；输入路径可为已登记的
              <code className="mx-1 font-mono text-[11px]">draw_data</code>
              /
              <code className="mx-1 font-mono text-[11px]">clean_data</code>
              ，但工具产物不得包含原始行级明细。
            </li>
            <li>
              <b>摄取类（ingestion）</b>工具读 HTML / 原始 Excel 等，仅由「数据提取」面板手动触发；不会暴露给 AI，
              避免原始 PII / 半结构化数据落入模型上下文。
            </li>
            <li>
              分类是 manifest 内禀属性，需要在
              <code className="mx-1 font-mono text-[11px]">{"server/tools/<id>/tool.json"}</code>
              中编辑。
            </li>
            <li>
              数据分析 Python 固化代码请在 manifest 维护
              <code className="mx-1 font-mono text-[11px]">tags</code>
              ，用于搜索、筛选、command / subagent / workflow 场景装配。
            </li>
          </ul>
        </div>

        {loadError && (
          <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-[12px] text-red-600 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300">
            {loadError}
          </p>
        )}

        <div className="grid gap-4 lg:grid-cols-[20rem_minmax(0,1fr)]">
          <aside className="rounded-lg border border-neutral-200 bg-white p-3 dark:border-neutral-800 dark:bg-neutral-900">
            <div className="flex items-center justify-between gap-2 px-1">
              <h2 className="flex flex-wrap items-center gap-1.5 text-[12px] font-semibold">
                <Wrench className="h-3.5 w-3.5" /> 已注册工具
                <span className="text-[10.5px] font-normal text-neutral-400">
                  共 {counts.total} · 摄取 {counts.ingestion} · 分析 {counts.analysis} · 退役 {counts.deprecated} · 自动化 {counts.aiExposed}
                </span>
              </h2>
              <button
                onClick={reload}
                disabled={reloading}
                title="刷新工具清单"
                className="inline-flex items-center gap-1 rounded border border-neutral-200 px-2 py-1 text-[10.5px] text-neutral-600 hover:bg-neutral-50 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800"
              >
                <RefreshCw className={"h-3 w-3 " + (reloading ? "animate-spin" : "")} /> 刷新
              </button>
            </div>

            <div className="mt-2 flex gap-1">
              {(["all", "ingestion", "analysis"] as const).map((key) => (
                <button
                  key={key}
                  onClick={() => setFilter(key)}
                  className={
                    "flex-1 rounded border px-2 py-1 text-[10.5px] " +
                    (filter === key
                      ? "border-neutral-900 bg-neutral-900 text-white dark:border-neutral-100 dark:bg-neutral-100 dark:text-neutral-900"
                      : "border-neutral-200 hover:bg-neutral-50 dark:border-neutral-700 dark:hover:bg-neutral-800")
                  }
                >
                  {key === "all" ? "全部" : CATEGORY_LABEL[key]}
                </button>
              ))}
            </div>

            <div className="mt-2 space-y-2">
              <label className="flex items-center gap-1.5 rounded-md border border-neutral-200 bg-neutral-50 px-2 py-1.5 text-[11px] dark:border-neutral-700 dark:bg-neutral-950/40">
                <Search className="h-3.5 w-3.5 text-neutral-400" />
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="搜索名称、id、描述、标签"
                  className="min-w-0 flex-1 bg-transparent outline-none placeholder:text-neutral-400"
                />
              </label>
              <div className="grid grid-cols-2 gap-2">
                <select
                  value={tagFilter}
                  onChange={(e) => setTagFilter(e.target.value)}
                  className="rounded-md border border-neutral-200 bg-transparent px-2 py-1.5 text-[11px] dark:border-neutral-700"
                  title="按标签筛选"
                >
                  <option value="all">全部标签</option>
                  {allTags.map((tag) => <option key={tag} value={tag}>{tag}</option>)}
                </select>
                <select
                  value={riskFilter}
                  onChange={(e) => setRiskFilter(e.target.value as RiskFilter)}
                  className="rounded-md border border-neutral-200 bg-transparent px-2 py-1.5 text-[11px] dark:border-neutral-700"
                  title="按风险等级筛选"
                >
                  <option value="all">全部风险</option>
                  {(["L0", "L1", "L2", "L3"] as const).map((risk) => <option key={risk} value={risk}>{risk}</option>)}
                </select>
              </div>
            </div>

            <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
              <select
                value={deprecatedFilter}
                onChange={(e) => setDeprecatedFilter(e.target.value as DeprecatedFilter)}
                className="rounded-md border border-neutral-200 bg-transparent px-2 py-1.5 text-[11px] dark:border-neutral-700"
                title="按退役状态筛选"
              >
                <option value="all">全部退役状态</option>
                <option value="yes">已退役</option>
                <option value="no">未退役</option>
              </select>
              <select
                value={replacementFilter}
                onChange={(e) => setReplacementFilter(e.target.value as ReplacementFilter)}
                className="rounded-md border border-neutral-200 bg-transparent px-2 py-1.5 text-[11px] dark:border-neutral-700"
                title="按替代工具筛选"
              >
                <option value="all">全部替代状态</option>
                <option value="has">有替代工具</option>
                <option value="missing">无替代工具</option>
              </select>
              <select
                value={shapeFilter}
                onChange={(e) => setShapeFilter(e.target.value as ShapeFilter)}
                className="rounded-md border border-neutral-200 bg-transparent px-2 py-1.5 text-[11px] dark:border-neutral-700"
                title="按输出形态筛选"
              >
                <option value="all">全部输出形态</option>
                {(["aggregate", "row_level", "unknown"] as const).map((shape) => <option key={shape} value={shape}>{TABLE_SHAPE_LABEL[shape]}</option>)}
              </select>
              <select
                value={aiExposureFilter}
                onChange={(e) => setAiExposureFilter(e.target.value as AiExposureFilter)}
                className="rounded-md border border-neutral-200 bg-transparent px-2 py-1.5 text-[11px] dark:border-neutral-700"
                title="按 AI 暴露筛选"
              >
                <option value="all">全部 AI 暴露</option>
                <option value="any">任意自动化入口</option>
                <option value="none">无自动化入口</option>
                {(["manual_confirmed", "mcp", "command", "subagent", "workflow", "eval"] as const).map((e) => <option key={e} value={e}>{AI_EXPOSURE_LABEL[e]}</option>)}
              </select>
              <select
                value={ownerFilter}
                onChange={(e) => setOwnerFilter(e.target.value)}
                className="rounded-md border border-neutral-200 bg-transparent px-2 py-1.5 text-[11px] dark:border-neutral-700"
                title="按 owner 筛选"
              >
                <option value="all">全部 owner</option>
                {allOwners.map((owner) => <option key={owner} value={owner}>{owner}</option>)}
              </select>
            </div>

            <div className="mt-2 space-y-1.5">
              {filteredTools.map((item) => {
                const active = item.id === toolId;
                const cat = categoryOf(item);
                const mcpExposed = isMcpExposed(item);
                const nonMcpAutomation = hasNonMcpAutomationExposure(item);
                const manualOrEval = isManualOrEvalExposed(item);
                const tags = toolTags(item);
                const contract = deriveOutputContract(item);
                const warnings = getToolGovernanceWarnings(item, tools);
                const blockers = getToolPolicyBlockers(item);
                return (
                  <button
                    key={item.id}
                    onClick={() => setToolId(item.id)}
                    className={
                      "w-full rounded-md border px-3 py-2 text-left text-[12px] " +
                      (active
                        ? "border-neutral-900 bg-neutral-900 text-white dark:border-neutral-100 dark:bg-neutral-100 dark:text-neutral-900"
                        : item.deprecated
                          ? "border-red-200 bg-red-50/40 hover:bg-red-50 dark:border-red-900/40 dark:bg-red-950/20 dark:hover:bg-red-950/30"
                          : blockers.length > 0
                            ? "border-amber-200 bg-amber-50/40 hover:bg-amber-50 dark:border-amber-900/40 dark:bg-amber-950/20 dark:hover:bg-amber-950/30"
                            : "border-neutral-200 hover:bg-neutral-50 dark:border-neutral-700 dark:hover:bg-neutral-800")
                    }
                  >
                    <div className="flex items-center gap-1.5">
                      <span className="block flex-1 font-medium">{item.name}</span>
                      {item.deprecated && (
                        <span className="inline-flex items-center gap-0.5 rounded bg-red-500/15 px-1 py-[1px] text-[9.5px] text-red-700 dark:text-red-300">
                          <Ban className="h-2.5 w-2.5" /> 已退役
                        </span>
                      )}
                      <span className={cn("font-mono text-[9.5px]", active ? "text-neutral-300 dark:text-neutral-600" : "text-neutral-400")}>
                        {item.id}
                      </span>
                      <span
                        role="button"
                        tabIndex={0}
                        title={copiedToolId === item.id ? "已复制" : "复制 toolId"}
                        onClick={(event) => {
                          event.stopPropagation();
                          void copyToolId(item.id);
                        }}
                        onKeyDown={(event) => {
                          if (event.key !== "Enter" && event.key !== " ") return;
                          event.preventDefault();
                          event.stopPropagation();
                          void copyToolId(item.id);
                        }}
                        className={cn(
                          "inline-flex h-5 w-5 shrink-0 items-center justify-center rounded border text-[10px]",
                          active
                            ? "border-white/20 text-neutral-200 hover:bg-white/10 dark:border-neutral-500 dark:text-neutral-600"
                            : "border-neutral-200 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700 dark:border-neutral-700 dark:hover:bg-neutral-800 dark:hover:text-neutral-200",
                        )}
                      >
                        {copiedToolId === item.id ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                      </span>
                      <span
                        className={
                          "rounded px-1 py-[1px] text-[9.5px] font-medium " +
                          (cat === "analysis"
                            ? active
                              ? "bg-emerald-200 text-emerald-900"
                              : "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200"
                            : active
                              ? "bg-amber-200 text-amber-900"
                              : "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200")
                        }
                      >
                        {CATEGORY_LABEL[cat]}
                      </span>
                    </div>
                    <span
                      className={
                        "mt-1 flex flex-wrap items-center gap-1 text-[10px] " +
                        (active ? "text-neutral-300 dark:text-neutral-600" : "text-neutral-500")
                      }
                    >
                      <span className="font-mono">{item.id}</span>
                      <span>· v{item.version}</span>
                      <span>· {TABLE_SHAPE_LABEL[contract.tableShape]}</span>
                      {mcpExposed && (
                        <span className="inline-flex items-center gap-0.5 rounded bg-blue-500/15 px-1 py-[1px] text-[9.5px] text-blue-700 dark:text-blue-300">
                          <Bot className="h-2.5 w-2.5" /> MCP
                        </span>
                      )}
                      {!mcpExposed && nonMcpAutomation && (
                        <span className="inline-flex items-center gap-0.5 rounded bg-purple-500/15 px-1 py-[1px] text-[9.5px] text-purple-700 dark:text-purple-300">
                          <Bot className="h-2.5 w-2.5" /> 自动化
                        </span>
                      )}
                      {!mcpExposed && !nonMcpAutomation && manualOrEval && (
                        <span className="inline-flex items-center gap-0.5 rounded bg-neutral-500/15 px-1 py-[1px] text-[9.5px] text-neutral-600 dark:text-neutral-300">
                          人工/评测
                        </span>
                      )}
                      {(warnings.length > 0 || blockers.length > 0) && (
                        <span className="inline-flex items-center gap-0.5 rounded bg-amber-500/15 px-1 py-[1px] text-[9.5px] text-amber-700 dark:text-amber-300">
                          <AlertTriangle className="h-2.5 w-2.5" /> {warnings.length + blockers.length}
                        </span>
                      )}
                    </span>
                    {item.owner && (
                      <span className={cn("mt-1 flex flex-wrap items-center gap-1 text-[9.5px]", active ? "text-neutral-300 dark:text-neutral-600" : "text-neutral-400")}>
                        <User className="h-2.5 w-2.5" /> {item.owner}
                      </span>
                    )}
                    {item.replacementToolId && (
                      <span className={cn("mt-1 flex flex-wrap items-center gap-1 text-[9.5px]", active ? "text-neutral-300 dark:text-neutral-600" : "text-neutral-400")}>
                        <ArrowRight className="h-2.5 w-2.5" /> 替代：{item.replacementToolId}
                      </span>
                    )}
                    {tags.length > 0 && (
                      <span className={cn("mt-1 flex flex-wrap gap-1 text-[9.5px]", active ? "text-neutral-200 dark:text-neutral-600" : "text-neutral-400")}>
                        {tags.slice(0, 4).map((tag) => (
                          <span key={tag} className="rounded bg-neutral-500/10 px-1 py-[1px]">#{tag}</span>
                        ))}
                      </span>
                    )}
                  </button>
                );
              })}
              {filteredTools.length === 0 && !loadError && (
                <p className="px-1 py-4 text-[12px] text-neutral-400">
                  {tools.length === 0 ? "暂无已注册工具" : "当前筛选下没有工具"}
                </p>
              )}
            </div>
          </aside>

          <main className="space-y-4">
            {!tool && (
              <section className="rounded-lg border border-dashed border-neutral-200 bg-white p-8 text-center text-[13px] text-neutral-500 dark:border-neutral-800 dark:bg-neutral-900">
                请从左侧选择一个工具查看详情。
              </section>
            )}

            {tool && (
              <ToolDetail tool={tool} tools={tools} evalState={evalState} copiedToolId={copiedToolId} onCopyToolId={copyToolId} onLoadCases={loadCases} />
            )}
          </main>
        </div>
        </>
        )}
      </div>
    </div>
  );
}

interface ToolDetailProps {
  tool: ExtractionTool;
  tools: ExtractionTool[];
  evalState: EvalState;
  copiedToolId: string;
  onCopyToolId: (id: string) => void;
  onLoadCases: () => void;
}

function ToolDetail({ tool, tools, evalState, copiedToolId, onCopyToolId, onLoadCases }: ToolDetailProps) {
  const cat = categoryOf(tool);
  const mcpExposed = isMcpExposed(tool);
  const exposureLabel = exposureSummaryLabel(tool);
  const tags = toolTags(tool);
  const contract = deriveOutputContract(tool);
  const effective = getEffectiveAiExposure(tool);
  const raw = deriveAiExposure(tool);
  const warnings = getToolGovernanceWarnings(tool, tools);
  const blockers = getToolPolicyBlockers(tool);
  const replacement = getReplacementTool(tools, tool.replacementToolId);
  const matrix = [
    { name: "人工运行", exposure: "manual_confirmed" as const, enabled: true, note: "数据提取面板手动触发" },
    { name: "AI / MCP", exposure: "mcp" as const, enabled: canExposeTo(tool, "mcp"), note: canExposeTo(tool, "mcp") ? "可经 source=ai 网关调用" : "ingestion 或策略已阻断" },
    { name: "command", exposure: "command" as const, enabled: canExposeTo(tool, "command"), note: canExposeTo(tool, "command") ? "可作为场景工具预填 @工具卡" : "不进入 command 工具绑定候选" },
    { name: "subagent", exposure: "subagent" as const, enabled: canExposeTo(tool, "subagent"), note: canExposeTo(tool, "subagent") ? "可进入 template toolIds 白名单" : "不挂载给子 agent" },
    { name: "workflow", exposure: "workflow" as const, enabled: canExposeTo(tool, "workflow"), note: canExposeTo(tool, "workflow") ? "可作为受控计算节点候选" : "只保留人工摄取路径" },
    { name: "eval", exposure: "eval" as const, enabled: canExposeTo(tool, "eval"), note: "复用 tests/cases.json 与实验室 tool 评测" },
  ];
  return (
    <>
      {(tool.deprecated || warnings.length > 0 || blockers.length > 0) && (
        <section className={cn(
          "rounded-lg border p-4",
          tool.deprecated
            ? "border-red-200 bg-red-50 dark:border-red-900/50 dark:bg-red-950/20"
            : blockers.length > 0
              ? "border-amber-200 bg-amber-50 dark:border-amber-900/50 dark:bg-amber-950/20"
              : "border-yellow-200 bg-yellow-50 dark:border-yellow-900/50 dark:bg-yellow-950/20"
        )}>
          <h3 className="flex items-center gap-1.5 text-[12.5px] font-semibold">
            {tool.deprecated ? <Ban className="h-3.5 w-3.5 text-red-600" /> : blockers.length > 0 ? <AlertOctagon className="h-3.5 w-3.5 text-amber-600" /> : <AlertTriangle className="h-3.5 w-3.5 text-yellow-600" />}
            {tool.deprecated ? "已退役工具" : blockers.length > 0 ? "治理阻断" : "治理提示"}
          </h3>
          {tool.deprecated && (
            <p className="mt-1 text-[11.5px] text-red-700 dark:text-red-300">
              该工具已标记 deprecated，自动化入口（MCP / command / subagent / workflow）已被移除；仅在人工确认或评测场景可用。
            </p>
          )}
          {tool.replacementToolId && (
            <div className="mt-2 flex flex-wrap items-center gap-2 text-[11.5px]">
              <span className="text-neutral-600 dark:text-neutral-300">替代工具：</span>
              {replacement ? (
                <span className="inline-flex items-center gap-1 rounded border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-emerald-700 dark:border-emerald-900/50 dark:bg-emerald-950/20 dark:text-emerald-300">
                  {replacement.name} <code className="font-mono text-[10px]">{replacement.id}</code>
                  {replacement.deprecated && <span className="text-red-600 dark:text-red-300">（也已退役）</span>}
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 rounded border border-red-200 bg-red-50 px-2 py-0.5 text-red-700 dark:border-red-900/50 dark:bg-red-950/20 dark:text-red-300">
                  <code className="font-mono text-[10px]">{tool.replacementToolId}</code> 不存在
                </span>
              )}
            </div>
          )}
          {blockers.length > 0 && (
            <ul className="mt-2 list-disc space-y-0.5 pl-5 text-[11.5px] text-amber-800 dark:text-amber-300">
              {blockers.map((b, i) => <li key={i}>{b}</li>)}
            </ul>
          )}
          {warnings.length > 0 && (
            <ul className="mt-2 list-disc space-y-0.5 pl-5 text-[11.5px] text-yellow-800 dark:text-yellow-300">
              {warnings.map((w, i) => <li key={i}>{w}</li>)}
            </ul>
          )}
        </section>
      )}

      <section className="rounded-lg border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-[13px] font-semibold">{tool.name}</h2>
            <p className="mt-1 text-[12px] text-neutral-500">{tool.description}</p>
            <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-neutral-400">
              <span className="inline-flex items-center gap-1.5 rounded border border-neutral-200 bg-neutral-50 px-2 py-1 dark:border-neutral-700 dark:bg-neutral-950">
                <span className="text-[10.5px] text-neutral-400">toolId</span>
                <code className="font-mono text-[11px] text-neutral-700 dark:text-neutral-200">{tool.id}</code>
                <button
                  onClick={() => onCopyToolId(tool.id)}
                  title={copiedToolId === tool.id ? "已复制" : "复制 toolId"}
                  className="inline-flex h-5 w-5 items-center justify-center rounded text-neutral-400 hover:bg-neutral-200 hover:text-neutral-700 dark:hover:bg-neutral-800 dark:hover:text-neutral-200"
                >
                  {copiedToolId === tool.id ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                </button>
              </span>
              <span className="font-mono">
                v{tool.version} · {tool.runtime}
              </span>
              {tool.timeoutMs ? " · 超时 " + tool.timeoutMs + "ms" : ""}
            </div>
            {tags.length > 0 && (
              <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[10.5px] text-neutral-500">
                <Tags className="h-3 w-3" />
                {tags.map((tag) => (
                  <span key={tag} className="rounded bg-neutral-100 px-1.5 py-0.5 font-mono dark:bg-neutral-800">#{tag}</span>
                ))}
              </div>
            )}
          </div>
          <div className="flex shrink-0 flex-col items-end gap-1">
            <span
              className={
                "rounded px-1.5 py-[1px] text-[10px] font-medium " +
                (cat === "analysis"
                  ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200"
                  : "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200")
              }
            >
              {CATEGORY_LABEL[cat]}
            </span>
            {mcpExposed ? (
              <span className="inline-flex items-center gap-0.5 rounded bg-blue-500/15 px-1.5 py-[1px] text-[10px] text-blue-700 dark:text-blue-300">
                <Bot className="h-2.5 w-2.5" /> {exposureLabel}
              </span>
            ) : hasNonMcpAutomationExposure(tool) ? (
              <span className="inline-flex items-center gap-0.5 rounded bg-purple-500/15 px-1.5 py-[1px] text-[10px] text-purple-700 dark:text-purple-300">
                <Bot className="h-2.5 w-2.5" /> {exposureLabel}
              </span>
            ) : isManualOrEvalExposed(tool) ? (
              <span className="inline-flex items-center gap-0.5 rounded bg-neutral-500/15 px-1.5 py-[1px] text-[10px] text-neutral-600 dark:text-neutral-300">
                {exposureLabel}
              </span>
            ) : (
              <span className="text-[10px] text-neutral-400">{exposureLabel}</span>
            )}
          </div>
        </div>

        <dl className="mt-3 grid grid-cols-1 gap-2 text-[11.5px] sm:grid-cols-2">
          <div>
            <dt className="text-neutral-400">输入</dt>
            <dd className="font-mono text-[11px] text-neutral-700 dark:text-neutral-300">
              {tool.input.accept.join(", ")} · {tool.input.modes.join(" / ")}
            </dd>
          </div>
          <div>
            <dt className="text-neutral-400">输出</dt>
            <dd className="font-mono text-[11px] text-neutral-700 dark:text-neutral-300">
              {tool.output.join(", ")}
            </dd>
          </div>
          {tool.riskLevel && (
            <div>
              <dt className="text-neutral-400">风险等级</dt>
              <dd className="text-neutral-700 dark:text-neutral-300">{tool.riskLevel}</dd>
            </div>
          )}
          {tool.failureHandling && (
            <div>
              <dt className="text-neutral-400">失败处理</dt>
              <dd className="text-neutral-700 dark:text-neutral-300">{tool.failureHandling}</dd>
            </div>
          )}
          <div>
            <dt className="text-neutral-400">Owner</dt>
            <dd className="text-neutral-700 dark:text-neutral-300">{tool.owner ?? <span className="text-amber-600 dark:text-amber-400">未填写</span>}</dd>
          </div>
          <div>
            <dt className="text-neutral-400">输出形态</dt>
            <dd className="text-neutral-700 dark:text-neutral-300">
              {TABLE_SHAPE_LABEL[contract.tableShape]}
              {contract.llmSafeSummary && <span className="ml-1.5 text-emerald-600 dark:text-emerald-400">· LLM-safe summary</span>}
              {contract.rowLimit ? <span className="ml-1.5 text-neutral-400">· 行限制 {contract.rowLimit}</span> : null}
            </dd>
          </div>
        </dl>

        {tool.allowedUse && (
          <p className="mt-2 text-[11.5px] text-neutral-500">
            <span className="text-neutral-400">适用：</span>
            {tool.allowedUse}
          </p>
        )}
        {tool.forbiddenUse && (
          <p className="mt-1 text-[11.5px] text-red-500">
            <span className="text-red-400/80">禁止：</span>
            {tool.forbiddenUse}
          </p>
        )}
      </section>

      <section className="rounded-lg border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
        <h3 className="text-[12.5px] font-semibold">AI 暴露与跨模块能力矩阵</h3>
        <p className="mt-0.5 text-[10.5px] text-neutral-400">
          生效入口 = 显式 aiExposure → riskLevel 上限 → deprecated 过滤。实际执行仍统一走 <code className="font-mono text-[10.5px]">/api/extraction-tools/:id/run</code>。
        </p>
        <div className="mt-2 flex flex-wrap gap-1.5 text-[10.5px]">
          <span className="text-neutral-400">声明：</span>
          {raw.length > 0 ? raw.map((e) => AI_EXPOSURE_LABEL[e]).join(", ") : <span className="text-neutral-400">无</span>}
          <span className="mx-1 text-neutral-300">|</span>
          <span className="text-neutral-400">生效：</span>
          {effective.length > 0 ? effective.map((e) => AI_EXPOSURE_LABEL[e]).join(", ") : <span className="text-neutral-400">无</span>}
        </div>
        <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {matrix.map((item) => (
            <div key={item.name} className={cn("rounded-md border px-3 py-2", item.enabled ? "border-emerald-200 bg-emerald-50/60 dark:border-emerald-900 dark:bg-emerald-950/20" : "border-neutral-200 bg-neutral-50 dark:border-neutral-800 dark:bg-neutral-950/40")}>
              <div className="flex items-center justify-between gap-2">
                <span className="text-[11.5px] font-medium text-neutral-800 dark:text-neutral-100">{item.name}</span>
                <span className={cn("rounded px-1.5 py-[1px] text-[10px]", item.enabled ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300" : "bg-neutral-200 text-neutral-500 dark:bg-neutral-800")}>
                  {item.enabled ? "可用" : "关闭"}
                </span>
              </div>
              <p className="mt-1 text-[10.5px] leading-4 text-neutral-500">{item.note}</p>
            </div>
          ))}
        </div>
      </section>

      {tool.parameters && tool.parameters.length > 0 && (
        <section className="rounded-lg border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
          <h3 className="text-[12.5px] font-semibold">参数（只读）</h3>
          <p className="mt-0.5 text-[10.5px] text-neutral-400">
            参数定义在 manifest 内；本控制台不在此跑工具，参数仅供阅读。
          </p>
          <ul className="mt-2 space-y-1.5">
            {tool.parameters.map((param) => (
              <li
                key={param.name}
                className="rounded border border-neutral-200 bg-neutral-50 px-2.5 py-1.5 text-[11.5px] dark:border-neutral-700 dark:bg-neutral-800/40"
              >
                <div className="flex items-center gap-1.5">
                  <span className="font-mono text-[11px] text-neutral-700 dark:text-neutral-200">
                    {param.name}
                  </span>
                  <span className="text-[10px] text-neutral-400">{param.type}</span>
                  {param.required && (
                    <span className="rounded bg-red-500/15 px-1 py-[1px] text-[9.5px] text-red-700 dark:text-red-300">
                      required
                    </span>
                  )}
                  {param.default !== undefined && (
                    <span className="text-[10px] text-neutral-400">
                      默认 {String(param.default)}
                    </span>
                  )}
                </div>
                <div className="mt-0.5 text-[11px] text-neutral-600 dark:text-neutral-300">
                  {param.label}
                  {param.description && (
                    <span className="ml-1.5 text-[10.5px] text-neutral-400">
                      · {param.description}
                    </span>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="rounded-lg border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
        <div className="flex items-center justify-between gap-2">
          <div>
            <h3 className="text-[12.5px] font-semibold">验证 · 评测 cases</h3>
            <p className="mt-0.5 text-[10.5px] text-neutral-400">
              复用既有评测：从 <code className="font-mono text-[10.5px]">server/tools/{tool.id}/tests/cases.json</code>{" "}
              读取 case 列表。深度评测（运行 / 比对 / LLM-judge）请打开「实验室 → tool」面板。
            </p>
          </div>
          <button
            onClick={onLoadCases}
            disabled={evalState.status === "loading"}
            className="inline-flex shrink-0 items-center gap-1.5 rounded border border-neutral-200 px-2.5 py-1 text-[11px] font-medium text-neutral-700 hover:bg-neutral-50 disabled:opacity-40 dark:border-neutral-700 dark:text-neutral-200 dark:hover:bg-neutral-800"
          >
            <FlaskConical className="h-3 w-3" />
            {evalState.status === "loading" ? "加载中…" : "查看 cases"}
          </button>
        </div>

        {evalState.status === "error" && (
          <p className="mt-2 text-[11px] text-red-500">{evalState.message}</p>
        )}
        {evalState.status === "loaded" && evalState.cases.length === 0 && (
          <p className="mt-2 text-[11px] text-neutral-400">该工具暂无测试用例。</p>
        )}
        {evalState.status === "loaded" && evalState.cases.length > 0 && (
          <ul className="mt-3 space-y-1.5">
            {evalState.cases.map((c) => (
              <li
                key={c.id}
                className="rounded border border-neutral-200 bg-neutral-50 px-3 py-2 text-[11.5px] dark:border-neutral-700 dark:bg-neutral-800/40"
              >
                <div className="font-medium text-neutral-700 dark:text-neutral-200">
                  {c.name}
                  <span className="ml-2 font-mono text-[10.5px] text-neutral-400">{c.id}</span>
                </div>
                <div className="mt-1 font-mono text-[10.5px] text-neutral-500">
                  输入：{c.inputPath}
                </div>
                <div className="mt-0.5 text-[10.5px] text-neutral-500">
                  期望：{c.expected.kind}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}

const SOURCE_LABEL: Record<ToolRunRecord["source"], string> = { manual: "手动", ai: "AI" };
type ToolRunSourceFilter = "all" | ToolRunRecord["source"];
type ToolRunCallerFilter = "all" | ToolRunRecord["caller"];
type ToolRunStatusFilter = "all" | ToolRunRecord["status"];

const TOOL_RUN_CALLERS: ToolRunRecord["caller"][] = ["manual", "chat", "mcp", "command", "subagent", "workflow", "eval", "unknown"];

function formatRunTime(ts: number): string {
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return "-";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

interface ToolRunAgg {
  toolId: string;
  toolName: string;
  total: number;
  success: number;
  failed: number;
  manual: number;
  ai: number;
  lastTime: number;
  durSum: number;
  durN: number;
}

// 运行看板：按 trace_events 的工具运行流水汇总（按工具计数）+ 最近运行流水。仅读脱敏字段，不读输入/输出明细。
function ToolRunBoard({ workspaceId }: { workspaceId: string | null }) {
  const [runs, setRuns] = useState<ToolRunRecord[]>([]);
  const [limit, setLimit] = useState(200);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const [filterTool, setFilterTool] = useState("all");
  const [filterSource, setFilterSource] = useState<ToolRunSourceFilter>("all");
  const [filterCaller, setFilterCaller] = useState<ToolRunCallerFilter>("all");
  const [filterStatus, setFilterStatus] = useState<ToolRunStatusFilter>("all");

  const load = useCallback(() => {
    if (!workspaceId) { setRuns([]); return; }
    setLoading(true);
    setError("");
    api.listToolRuns(workspaceId, limit)
      .then(setRuns)
      .catch((err) => setError(String(err)))
      .finally(() => setLoading(false));
  }, [workspaceId, limit]);

  useEffect(() => { load(); }, [load]);

  const toolOptions = useMemo(() => {
    const map = new Map<string, string>();
    for (const run of runs) {
      if (!run.toolId) continue;
      map.set(run.toolId, run.toolName || run.toolId);
    }
    return [...map.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [runs]);

  const filteredRuns = useMemo(() => {
    return runs.filter((r) => {
      if (filterTool !== "all" && r.toolId !== filterTool) return false;
      if (filterSource !== "all" && r.source !== filterSource) return false;
      if (filterCaller !== "all" && r.caller !== filterCaller) return false;
      if (filterStatus !== "all" && r.status !== filterStatus) return false;
      return true;
    });
  }, [runs, filterTool, filterSource, filterCaller, filterStatus]);

  const summary = useMemo(() => {
    const map = new Map<string, ToolRunAgg>();
    for (const r of filteredRuns) {
      const key = r.toolId || r.toolName || r.id;
      let agg = map.get(key);
      if (!agg) {
        agg = { toolId: r.toolId, toolName: r.toolName, total: 0, success: 0, failed: 0, manual: 0, ai: 0, lastTime: 0, durSum: 0, durN: 0 };
        map.set(key, agg);
      }
      agg.total += 1;
      if (r.status === "failed") agg.failed += 1; else agg.success += 1;
      if (r.source === "ai") agg.ai += 1; else agg.manual += 1;
      if (r.time > agg.lastTime) agg.lastTime = r.time;
      if (r.durationMs != null) { agg.durSum += r.durationMs; agg.durN += 1; }
    }
    return [...map.values()].sort((a, b) => b.total - a.total);
  }, [filteredRuns]);

  const totals = useMemo(() => {
    const failed = filteredRuns.filter((r) => r.status === "failed").length;
    return { total: filteredRuns.length, success: filteredRuns.length - failed, failed };
  }, [filteredRuns]);

  if (!workspaceId) {
    return (
      <section className="rounded-lg border border-dashed border-neutral-200 bg-white p-8 text-center text-[13px] text-neutral-500 dark:border-neutral-800 dark:bg-neutral-900">
        请先选择工作区后查看工具运行看板。
      </section>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3 rounded-lg border border-neutral-200 bg-white px-4 py-3 dark:border-neutral-800 dark:bg-neutral-900">
        <span className="text-[12.5px] font-semibold text-neutral-700 dark:text-neutral-200">运行总览</span>
        <span className="text-[12px] text-neutral-500">共 <b className="text-neutral-800 dark:text-neutral-100">{totals.total}</b> 次</span>
        <span className="text-[12px] text-emerald-600 dark:text-emerald-400">成功 {totals.success}</span>
        <span className="text-[12px] text-red-500">失败 {totals.failed}</span>
        <div className="ml-auto flex items-center gap-2">
          <select
            value={limit}
            onChange={(e) => setLimit(Number(e.target.value))}
            className="rounded border border-neutral-200 bg-transparent px-2 py-1 text-[11.5px] dark:border-neutral-700"
          >
            <option value={100}>最近 100</option>
            <option value={200}>最近 200</option>
            <option value={500}>最近 500</option>
            <option value={2000}>最近 2000</option>
          </select>
          <button
            onClick={load}
            disabled={loading}
            className="inline-flex items-center gap-1 rounded border border-neutral-200 px-2 py-1 text-[11px] text-neutral-600 hover:bg-neutral-50 disabled:opacity-40 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800"
          >
            <RefreshCw className={"h-3 w-3 " + (loading ? "animate-spin" : "")} /> 刷新
          </button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-neutral-200 bg-white px-4 py-2 dark:border-neutral-800 dark:bg-neutral-900">
        <span className="text-[12px] font-medium text-neutral-500">过滤：</span>
        <select value={filterTool} onChange={(e) => setFilterTool(e.target.value)} className="rounded border border-neutral-200 bg-transparent px-2 py-1 text-[11px] dark:border-neutral-700 max-w-[140px] truncate">
          <option value="all">所有工具</option>
          {toolOptions.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
        </select>
        <select value={filterSource} onChange={(e) => setFilterSource(e.target.value as ToolRunSourceFilter)} className="rounded border border-neutral-200 bg-transparent px-2 py-1 text-[11px] dark:border-neutral-700">
          <option value="all">所有来源</option>
          <option value="manual">手动 (manual)</option>
          <option value="ai">AI</option>
        </select>
        <select value={filterCaller} onChange={(e) => setFilterCaller(e.target.value as ToolRunCallerFilter)} className="rounded border border-neutral-200 bg-transparent px-2 py-1 text-[11px] dark:border-neutral-700">
          <option value="all">所有 Caller</option>
          {TOOL_RUN_CALLERS.map((caller) => <option key={caller} value={caller}>{caller}</option>)}
        </select>
        <select value={filterStatus} onChange={(e) => setFilterStatus(e.target.value as ToolRunStatusFilter)} className="rounded border border-neutral-200 bg-transparent px-2 py-1 text-[11px] dark:border-neutral-700">
          <option value="all">所有状态</option>
          <option value="success">成功</option>
          <option value="failed">失败</option>
        </select>
        {filteredRuns.length !== runs.length && (
          <span className="ml-2 text-[11px] text-neutral-400">已过滤 {runs.length - filteredRuns.length} 条记录</span>
        )}
      </div>

      {error && (
        <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-[12px] text-red-600 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300">{error}</p>
      )}

      <section className="rounded-lg border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
        <h3 className="flex items-center gap-1.5 text-[12.5px] font-semibold text-neutral-700 dark:text-neutral-200"><Wrench className="h-3.5 w-3.5" /> 按工具汇总</h3>
        {summary.length === 0 ? (
          <p className="mt-3 text-[12px] text-neutral-400">{loading ? "加载中…" : "本工作区当前筛选下暂无工具运行记录。"}</p>
        ) : (
          <table className="mt-2 w-full text-[11.5px]">
            <thead className="text-neutral-500 dark:text-neutral-400">
              <tr className="border-b border-neutral-200 dark:border-neutral-700">
                <th className="px-2 py-1.5 text-left font-normal">工具</th>
                <th className="px-2 py-1.5 text-right font-normal">调用</th>
                <th className="px-2 py-1.5 text-right font-normal">成功</th>
                <th className="px-2 py-1.5 text-right font-normal">失败</th>
                <th className="px-2 py-1.5 text-right font-normal">手动/AI</th>
                <th className="px-2 py-1.5 text-right font-normal">平均耗时</th>
                <th className="px-2 py-1.5 text-right font-normal">最近运行</th>
              </tr>
            </thead>
            <tbody>
              {summary.map((s) => (
                <tr key={s.toolId || s.toolName} className="border-b border-neutral-100 last:border-0 dark:border-neutral-800">
                  <td className="px-2 py-1.5">
                    <span className="font-medium text-neutral-800 dark:text-neutral-100">{s.toolName || s.toolId}</span>
                    {s.toolId && <span className="ml-1.5 font-mono text-[10px] text-neutral-400">{s.toolId}</span>}
                  </td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{s.total}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums text-emerald-600 dark:text-emerald-400">{s.success}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums text-red-500">{s.failed || ""}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums text-neutral-500">{s.manual}/{s.ai}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums text-neutral-500">{s.durN > 0 ? `${Math.round(s.durSum / s.durN)}ms` : "-"}</td>
                  <td className="px-2 py-1.5 text-right text-neutral-500">{s.lastTime ? formatRunTime(s.lastTime) : "-"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="rounded-lg border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
        <h3 className="flex items-center gap-1.5 text-[12.5px] font-semibold text-neutral-700 dark:text-neutral-200"><Activity className="h-3.5 w-3.5" /> 最近运行流水</h3>
        {filteredRuns.length === 0 ? (
          <p className="mt-3 text-[12px] text-neutral-400">{loading ? "加载中…" : "当前筛选下无运行记录。"}</p>
        ) : (
          <div className="mt-2 w-full overflow-x-auto">
            <table className="w-full text-[11.5px]">
              <thead className="text-neutral-500 dark:text-neutral-400">
                <tr className="border-b border-neutral-200 dark:border-neutral-700">
                  <th className="px-2 py-1.5 text-left font-normal w-28 whitespace-nowrap">时间</th>
                  <th className="px-2 py-1.5 text-left font-normal min-w-[120px]">工具</th>
                  <th className="px-2 py-1.5 text-left font-normal w-28 whitespace-nowrap">来源 / Caller</th>
                  <th className="px-2 py-1.5 text-left font-normal w-24 whitespace-nowrap">状态 / 耗时</th>
                  <th className="px-2 py-1.5 text-left font-normal">产物 / 摘要</th>
                </tr>
              </thead>
              <tbody>
                {filteredRuns.map((r) => (
                  <tr key={r.id} className="border-b border-neutral-100 last:border-0 dark:border-neutral-800">
                    <td className="px-2 py-1.5 tabular-nums text-neutral-500 whitespace-nowrap align-top">{formatRunTime(r.time)}</td>
                    <td className="px-2 py-1.5 text-neutral-800 dark:text-neutral-100 break-all align-top">{r.toolName || r.toolId}</td>
                    <td className="px-2 py-1.5 whitespace-nowrap align-top">
                      <div className="flex flex-col items-start gap-1">
                        <span className={cn("rounded px-1.5 py-[1px] text-[10px]", r.source === "ai" ? "bg-blue-500/15 text-blue-700 dark:text-blue-300" : "bg-neutral-200/70 text-neutral-600 dark:bg-neutral-700 dark:text-neutral-300")}>
                          {SOURCE_LABEL[r.source]}
                        </span>
                        <span className="font-mono text-[10px] text-neutral-400">{r.caller}</span>
                      </div>
                    </td>
                    <td className="px-2 py-1.5 whitespace-nowrap align-top">
                      <div className="flex flex-col items-start gap-1">
                        <span className={cn("font-medium", r.status === "failed" ? "text-red-500" : "text-emerald-600 dark:text-emerald-400")}>
                          {r.status === "failed" ? "失败" : "成功"}
                        </span>
                        <span className="tabular-nums text-[10px] text-neutral-400">{r.durationMs != null ? `${r.durationMs}ms` : "-"}</span>
                      </div>
                    </td>
                    <td className="px-2 py-1.5 align-top">
                      <div className="flex flex-wrap items-center gap-1.5 text-[10.5px]">
                        <span className="text-neutral-600 dark:text-neutral-300 whitespace-nowrap" title="成功/失败条数">
                          行: {r.success ?? "-"}/{r.failed ?? "-"}
                        </span>
                        {r.rowGuard && (
                          <span className={cn("rounded border px-1 py-[1px] whitespace-nowrap", r.rowGuard.blocked ? "border-red-200 bg-red-50 text-red-600 dark:border-red-900/50 dark:bg-red-900/20" : "border-emerald-200 bg-emerald-50 text-emerald-600 dark:border-emerald-900/50 dark:bg-emerald-900/20")} title={`已扫描 ${r.rowGuard.maxRowsSeen ?? '-'}，限制 ${r.rowGuard.rowLimit ?? '-'}`}>
                            Guard {r.rowGuard.blocked ? "Blocked" : "Pass"}
                          </span>
                        )}
                        {r.metricSnapshotsCount > 0 && (
                          <span className="rounded border border-blue-200 bg-blue-50 px-1 py-[1px] text-blue-600 whitespace-nowrap dark:border-blue-900/50 dark:bg-blue-900/20 dark:text-blue-400">
                            指标 {r.metricSnapshotsCount}
                          </span>
                        )}
                        {r.errorCode && (
                          <span className="rounded border border-amber-200 bg-amber-50 px-1 py-[1px] font-mono text-[10px] text-amber-700 whitespace-nowrap dark:border-amber-900/50 dark:bg-amber-900/20 dark:text-amber-300">
                            {r.errorCode}
                          </span>
                        )}
                        {r.outputArtifacts && r.outputArtifacts.length > 0 && (
                          <span className="rounded border border-purple-200 bg-purple-50 px-1 py-[1px] text-purple-600 dark:border-purple-900/50 dark:bg-purple-900/20 dark:text-purple-400" title={r.outputArtifacts.join("\n")}>
                            产物 {r.outputArtifacts.length}
                          </span>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
