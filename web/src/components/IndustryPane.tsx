import { useCallback, useMemo, useState, lazy, Suspense } from "react";
import { Factory, Search, Loader2, TrendingUp, AlertTriangle, Lightbulb, Gauge } from "lucide-react";
import { cn } from "@/lib/cn";
import { api } from "@/lib/api";
import { useResumableTask } from "@/lib/resumableTask";
import type { IndustryIntel } from "@/types";

const ReactECharts = lazy(() => import("echarts-for-react"));

const ChartFallback = () => (
  <div className="flex h-[260px] items-center justify-center text-neutral-300">
    <Loader2 className="h-4 w-4 animate-spin" />
  </div>
);

const PRESET_INDUSTRIES = [
  "新能源汽车", "预制菜", "美妆个护", "咖啡连锁", "宠物经济",
  "在线教育", "智能家居", "运动户外", "母婴", "医美",
];

interface IndustryPaneProps {
  workspaceId: string;
  model: string;
}

export function IndustryPane({ workspaceId, model }: IndustryPaneProps) {
  const [industry, setIndustry] = useState("");
  const taskKey = "industry:" + workspaceId;
  const { status, data, error, start } = useResumableTask<IndustryIntel>(taskKey);
  const loading = status === "running";
  const [localError, setLocalError] = useState("");

  const run = useCallback(async (name: string) => {
    const target = name.trim();
    if (!target) return;
    if (!workspaceId) {
      setLocalError("请先选择一个工作区");
      return;
    }
    setLocalError("");
    void start(() => api.analyzeIndustry(workspaceId, target, model || undefined));
  }, [workspaceId, model, start]);

  const displayError = localError || error || "";

  const forcesOption = useMemo(() => {
    if (!data || data.forces.length === 0) return null;
    return {
      tooltip: {},
      radar: {
        indicator: data.forces.map((f) => ({ name: f.label, max: 100 })),
        radius: "62%",
        axisName: { fontSize: 11, color: "#737373" },
        splitLine: { lineStyle: { color: "rgba(120,120,120,0.18)" } },
        splitArea: { areaStyle: { color: ["rgba(99,102,241,0.03)", "rgba(99,102,241,0.07)"] } },
      },
      series: [
        {
          type: "radar" as const,
          data: [
            {
              value: data.forces.map((f) => f.score),
              name: "压力强度",
              areaStyle: { color: "rgba(99,102,241,0.18)" },
              lineStyle: { color: "#6366f1", width: 2 },
              itemStyle: { color: "#6366f1" },
            },
          ],
        },
      ],
    };
  }, [data]);

  return (
    <div className="flex min-h-0 flex-1 overflow-auto bg-neutral-50/60 p-5 dark:bg-neutral-950">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-4">
        {/* Header */}
        <div className="rounded-xl border border-neutral-200 bg-white p-4 shadow-sm dark:border-neutral-800 dark:bg-neutral-900">
          <h1 className="flex items-center gap-2 text-base font-semibold text-neutral-900 dark:text-neutral-100">
            <Factory className="h-4 w-4" /> 行业情报
          </h1>
          <p className="mt-1 text-[12.5px] text-neutral-500">
            由 pi agent 联网检索生成的行业大盘情报（市场规模 / 集中度 / 五力 / 趋势）。数值为公开信息估算，仅供分析参考。
          </p>
        </div>

        {/* Controls */}
        <div className="rounded-xl border border-neutral-200 bg-white p-4 shadow-sm dark:border-neutral-800 dark:bg-neutral-900">
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative flex-1 min-w-[200px]">
              <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-neutral-400" />
              <input
                value={industry}
                onChange={(e) => setIndustry(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") void run(industry); }}
                placeholder="输入行业名，如 新能源汽车、预制菜…"
                className="h-8 w-full rounded-md border border-neutral-200 bg-neutral-50 pl-8 pr-2 text-[13px] outline-none placeholder:text-neutral-400 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100"
              />
            </div>
            <button
              onClick={() => void run(industry)}
              disabled={loading || !industry.trim()}
              className={cn(
                "inline-flex h-8 items-center gap-1.5 rounded-md px-4 text-[13px] font-medium transition-colors",
                "bg-indigo-600 text-white hover:bg-indigo-500",
                "disabled:cursor-not-allowed disabled:opacity-50",
              )}
            >
              {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Gauge className="h-3.5 w-3.5" />}
              {loading ? "分析中..." : "生成情报"}
            </button>
          </div>
          <div className="mt-2.5 flex flex-wrap gap-1.5">
            {PRESET_INDUSTRIES.map((name) => (
              <button
                key={name}
                onClick={() => { setIndustry(name); void run(name); }}
                disabled={loading}
                className="rounded-full border border-neutral-200 bg-white px-2.5 py-1 text-[11.5px] text-neutral-600 hover:bg-neutral-50 disabled:opacity-50 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-300 dark:hover:bg-neutral-700"
              >
                {name}
              </button>
            ))}
          </div>
        </div>

        {displayError && (
          <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-[12px] text-red-600 dark:border-red-800 dark:bg-red-950 dark:text-red-400">
            {displayError}
          </div>
        )}

        {loading && (
          <div className="flex items-center justify-center rounded-xl border border-neutral-200 bg-white p-12 shadow-sm dark:border-neutral-800 dark:bg-neutral-900">
            <Loader2 className="h-5 w-5 animate-spin text-neutral-400" />
            <span className="ml-2 text-[13px] text-neutral-400">pi 正在检索行业情报，可能需要 1-2 分钟...</span>
          </div>
        )}

        {data && !loading && (
          <>
            {/* Summary + key metrics */}
            <div className="rounded-xl border border-neutral-200 bg-white p-4 shadow-sm dark:border-neutral-800 dark:bg-neutral-900">
              <h2 className="text-[14px] font-semibold text-neutral-900 dark:text-neutral-100">{data.industry}</h2>
              {data.summary && <p className="mt-1.5 text-[12.5px] leading-relaxed text-neutral-600 dark:text-neutral-400">{data.summary}</p>}
              <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
                <MetricCard label="市场规模" value={data.marketSize} />
                <MetricCard label="增速" value={data.marketGrowth} />
                <MetricCard label="集中度" value={data.concentration} />
              </div>
            </div>

            {/* Five forces radar + benchmarks */}
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              <div className="rounded-xl border border-neutral-200 bg-white p-4 shadow-sm dark:border-neutral-800 dark:bg-neutral-900">
                <h2 className="mb-2 text-[13px] font-medium text-neutral-700 dark:text-neutral-300">波特五力模型</h2>
                <Suspense fallback={<ChartFallback />}>
                  {forcesOption && <ReactECharts option={forcesOption} style={{ height: 260 }} notMerge lazyUpdate />}
                </Suspense>
                {data.forces.length > 0 && (
                  <div className="mt-1 flex flex-col gap-1">
                    {data.forces.map((f) => (
                      <div key={f.label} className="flex items-baseline gap-2 text-[11.5px]">
                        <span className="w-20 shrink-0 text-neutral-500">{f.label}</span>
                        <span className="font-medium text-indigo-600 dark:text-indigo-400">{f.score}</span>
                        <span className="text-neutral-400">{f.note}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="rounded-xl border border-neutral-200 bg-white p-4 shadow-sm dark:border-neutral-800 dark:bg-neutral-900">
                <h2 className="mb-2 flex items-center gap-1.5 text-[13px] font-medium text-neutral-700 dark:text-neutral-300">
                  <TrendingUp className="h-3.5 w-3.5" /> 关键趋势
                </h2>
                <ul className="flex flex-col gap-1.5">
                  {data.trends.map((t, i) => (
                    <li key={i} className="flex gap-2 text-[12.5px] text-neutral-600 dark:text-neutral-400">
                      <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-indigo-400" />
                      {t}
                    </li>
                  ))}
                </ul>
                {data.benchmarks.length > 0 && (
                  <div className="mt-3 border-t border-neutral-100 pt-3 dark:border-neutral-800">
                    <p className="mb-1.5 text-[11.5px] font-medium text-neutral-400">关键指标基准</p>
                    <div className="grid grid-cols-2 gap-2">
                      {data.benchmarks.map((b, i) => (
                        <div key={i} className="flex items-baseline justify-between rounded-md bg-neutral-50 px-2.5 py-1.5 dark:bg-neutral-800/60">
                          <span className="text-[11.5px] text-neutral-500">{b.name}</span>
                          <span className="text-[12px] font-medium text-neutral-800 dark:text-neutral-200">{b.value}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Risks + opportunities */}
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              <ListCard icon={AlertTriangle} title="风险" items={data.risks} tone="amber" />
              <ListCard icon={Lightbulb} title="机会" items={data.opportunities} tone="emerald" />
            </div>

            <p className="text-center text-[11px] text-neutral-400">由 pi agent 生成，内容可能存在偏差，请结合权威来源核实。</p>
          </>
        )}
      </div>
    </div>
  );
}

function MetricCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-neutral-50 p-3 dark:bg-neutral-800/60">
      <p className="text-[11.5px] text-neutral-500">{label}</p>
      <p className="mt-1 text-[14px] font-semibold text-neutral-900 dark:text-neutral-100">{value || "—"}</p>
    </div>
  );
}

function ListCard({ icon: Icon, title, items, tone }: { icon: typeof AlertTriangle; title: string; items: string[]; tone: "amber" | "emerald" }) {
  const dot = tone === "amber" ? "bg-amber-400" : "bg-emerald-400";
  return (
    <div className="rounded-xl border border-neutral-200 bg-white p-4 shadow-sm dark:border-neutral-800 dark:bg-neutral-900">
      <h2 className="mb-2 flex items-center gap-1.5 text-[13px] font-medium text-neutral-700 dark:text-neutral-300">
        <Icon className="h-3.5 w-3.5" /> {title}
      </h2>
      {items.length === 0 ? (
        <p className="text-[12px] text-neutral-400">—</p>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {items.map((t, i) => (
            <li key={i} className="flex gap-2 text-[12.5px] text-neutral-600 dark:text-neutral-400">
              <span className={cn("mt-1.5 h-1 w-1 shrink-0 rounded-full", dot)} />
              {t}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
