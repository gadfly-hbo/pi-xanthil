import { useCallback, useEffect, useMemo, useState } from "react";
import { Wrench, ShieldCheck, Bot, FlaskConical, RefreshCw, Activity } from "lucide-react";
import { cn } from "@/lib/cn";
import { api } from "@/lib/api";
import type { ExtractionTool, ToolEvalCase, ToolRunRecord } from "@/types";
import type { FolderScope } from "@/tabs/types";

interface Props {
  scope: FolderScope;
  workspaceId: string | null;
}

type Category = "ingestion" | "analysis";

type EvalState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "loaded"; cases: ToolEvalCase[] }
  | { status: "error"; message: string };

const CATEGORY_LABEL: Record<Category, string> = {
  ingestion: "摄取",
  analysis: "分析",
};

function categoryOf(tool: ExtractionTool): Category {
  return tool.category === "analysis" ? "analysis" : "ingestion";
}

function isAiExposed(tool: ExtractionTool): boolean {
  return categoryOf(tool) === "analysis";
}

export function ToolUsePane({ workspaceId }: Props) {
  const [tools, setTools] = useState<ExtractionTool[]>([]);
  const [loadError, setLoadError] = useState("");
  const [reloading, setReloading] = useState(false);
  const [toolId, setToolId] = useState<string>("");
  const [filter, setFilter] = useState<"all" | Category>("all");
  const [evalState, setEvalState] = useState<EvalState>({ status: "idle" });
  const [view, setView] = useState<"console" | "board">("console");

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
    if (filter === "all") return tools;
    return tools.filter((t) => categoryOf(t) === filter);
  }, [tools, filter]);

  const counts = useMemo(() => {
    let ingestion = 0;
    let analysis = 0;
    for (const t of tools) {
      if (categoryOf(t) === "analysis") analysis += 1;
      else ingestion += 1;
    }
    return { ingestion, analysis, total: tools.length };
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

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-auto bg-neutral-50/60 p-5 dark:bg-neutral-950">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-4">
        <div>
          <h1 className="flex items-center gap-2 text-base font-semibold text-neutral-900 dark:text-neutral-100">
            <Wrench className="h-4 w-4" /> 计算工具 · tool-use（管理控制台）
          </h1>
          <p className="mt-1 text-[12.5px] text-neutral-500">
            统一查看本仓库注册的本地工具：用途分类（摄取 / 分析）、AI 暴露（仅 analysis 类经 MCP 暴露给 pi-agent）、参数 / 风险 / 适用场景。
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
              <b>分析类（analysis）</b>工具经 MCP 暴露给 pi-agent，由模型按需调用；输入路径可为已登记的
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
                  共 {counts.total} · 摄取 {counts.ingestion} · 分析 {counts.analysis}
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

            <div className="mt-2 space-y-1.5">
              {filteredTools.map((item) => {
                const active = item.id === toolId;
                const cat = categoryOf(item);
                const aiExposed = isAiExposed(item);
                return (
                  <button
                    key={item.id}
                    onClick={() => setToolId(item.id)}
                    className={
                      "w-full rounded-md border px-3 py-2 text-left text-[12px] " +
                      (active
                        ? "border-neutral-900 bg-neutral-900 text-white dark:border-neutral-100 dark:bg-neutral-100 dark:text-neutral-900"
                        : "border-neutral-200 hover:bg-neutral-50 dark:border-neutral-700 dark:hover:bg-neutral-800")
                    }
                  >
                    <div className="flex items-center gap-1.5">
                      <span className="block flex-1 font-medium">{item.name}</span>
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
                      <span>· {item.input.accept.join(", ")}</span>
                      {aiExposed && (
                        <span className="inline-flex items-center gap-0.5 rounded bg-blue-500/15 px-1 py-[1px] text-[9.5px] text-blue-700 dark:text-blue-300">
                          <Bot className="h-2.5 w-2.5" /> AI
                        </span>
                      )}
                    </span>
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
              <ToolDetail tool={tool} evalState={evalState} onLoadCases={loadCases} />
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
  evalState: EvalState;
  onLoadCases: () => void;
}

function ToolDetail({ tool, evalState, onLoadCases }: ToolDetailProps) {
  const cat = categoryOf(tool);
  const aiExposed = isAiExposed(tool);
  return (
    <>
      <section className="rounded-lg border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-[13px] font-semibold">{tool.name}</h2>
            <p className="mt-1 text-[12px] text-neutral-500">{tool.description}</p>
            <p className="mt-2 font-mono text-[11px] text-neutral-400">
              {tool.id} · v{tool.version} · {tool.runtime}
              {tool.timeoutMs ? " · 超时 " + tool.timeoutMs + "ms" : ""}
            </p>
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
            {aiExposed ? (
              <span className="inline-flex items-center gap-0.5 rounded bg-blue-500/15 px-1.5 py-[1px] text-[10px] text-blue-700 dark:text-blue-300">
                <Bot className="h-2.5 w-2.5" /> 经 MCP 暴露给 AI
              </span>
            ) : (
              <span className="text-[10px] text-neutral-400">不向 AI 暴露</span>
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

  const summary = useMemo(() => {
    const map = new Map<string, ToolRunAgg>();
    for (const r of runs) {
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
  }, [runs]);

  const totals = useMemo(() => {
    const failed = runs.filter((r) => r.status === "failed").length;
    return { total: runs.length, success: runs.length - failed, failed };
  }, [runs]);

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

      {error && (
        <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-[12px] text-red-600 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300">{error}</p>
      )}

      <section className="rounded-lg border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
        <h3 className="flex items-center gap-1.5 text-[12.5px] font-semibold text-neutral-700 dark:text-neutral-200"><Wrench className="h-3.5 w-3.5" /> 按工具汇总</h3>
        {summary.length === 0 ? (
          <p className="mt-3 text-[12px] text-neutral-400">{loading ? "加载中…" : "本工作区暂无工具运行记录。手动运行在「数据提取」面板，AI 调用经 MCP。"}</p>
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
        {runs.length === 0 ? (
          <p className="mt-3 text-[12px] text-neutral-400">{loading ? "加载中…" : "暂无运行记录。"}</p>
        ) : (
          <table className="mt-2 w-full text-[11.5px]">
            <thead className="text-neutral-500 dark:text-neutral-400">
              <tr className="border-b border-neutral-200 dark:border-neutral-700">
                <th className="px-2 py-1.5 text-left font-normal">时间</th>
                <th className="px-2 py-1.5 text-left font-normal">工具</th>
                <th className="px-2 py-1.5 text-left font-normal">来源</th>
                <th className="px-2 py-1.5 text-left font-normal">状态</th>
                <th className="px-2 py-1.5 text-right font-normal">成功/失败</th>
                <th className="px-2 py-1.5 text-right font-normal">耗时</th>
              </tr>
            </thead>
            <tbody>
              {runs.map((r) => (
                <tr key={r.id} className="border-b border-neutral-100 last:border-0 dark:border-neutral-800">
                  <td className="px-2 py-1.5 tabular-nums text-neutral-500">{formatRunTime(r.time)}</td>
                  <td className="px-2 py-1.5 text-neutral-800 dark:text-neutral-100">{r.toolName || r.toolId}</td>
                  <td className="px-2 py-1.5">
                    <span className={cn("rounded px-1.5 py-[1px] text-[10px]", r.source === "ai" ? "bg-blue-500/15 text-blue-700 dark:text-blue-300" : "bg-neutral-200/70 text-neutral-600 dark:bg-neutral-700 dark:text-neutral-300")}>
                      {SOURCE_LABEL[r.source]}
                    </span>
                  </td>
                  <td className="px-2 py-1.5">
                    <span className={cn("font-medium", r.status === "failed" ? "text-red-500" : "text-emerald-600 dark:text-emerald-400")}>
                      {r.status === "failed" ? "失败" : "成功"}
                    </span>
                  </td>
                  <td className="px-2 py-1.5 text-right tabular-nums text-neutral-500">{r.success ?? "-"}/{r.failed ?? "-"}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums text-neutral-500">{r.durationMs != null ? `${r.durationMs}ms` : "-"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
