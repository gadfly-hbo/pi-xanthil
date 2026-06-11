import { useCallback, useMemo, useState, lazy, Suspense } from "react";
import { Swords, Search, Loader2, ShieldAlert, Target } from "lucide-react";
import { cn } from "@/lib/cn";
import { api } from "@/lib/api";
import { useResumableTask } from "@/lib/resumableTask";
import type { CompetitorIntel } from "@/types";

const ReactECharts = lazy(() => import("echarts-for-react"));

const ChartFallback = () => (
  <div className="flex h-[260px] items-center justify-center text-neutral-300">
    <Loader2 className="h-4 w-4 animate-spin" />
  </div>
);

interface CompetitorPaneProps {
  workspaceId: string;
  model: string;
}

export function CompetitorPane({ workspaceId, model }: CompetitorPaneProps) {
  const [brand, setBrand] = useState("");
  const [rivals, setRivals] = useState("");
  const taskKey = "competitor:" + workspaceId;
  const { status, data, error, start } = useResumableTask<CompetitorIntel>(taskKey);
  const loading = status === "running";
  const [localError, setLocalError] = useState("");

  const run = useCallback(async () => {
    const target = brand.trim();
    if (!target) return;
    if (!workspaceId) {
      setLocalError("请先选择一个工作区");
      return;
    }
    const competitors = rivals.split(/[,，、\s]+/).map((s) => s.trim()).filter(Boolean);
    setLocalError("");
    void start(() => api.analyzeCompetitor(workspaceId, target, competitors, model || undefined));
  }, [workspaceId, model, brand, rivals, start]);

  const displayError = localError || error || "";

  const shareOption = useMemo(() => {
    if (!data || data.profiles.length === 0) return null;
    const sorted = [...data.profiles].sort((a, b) => b.marketSharePct - a.marketSharePct);
    return {
      tooltip: { trigger: "axis" as const, axisPointer: { type: "shadow" as const } },
      grid: { left: 90, right: 24, top: 16, bottom: 24 },
      xAxis: { type: "value" as const, max: 100, axisLabel: { fontSize: 10, formatter: "{value}%" } },
      yAxis: {
        type: "category" as const,
        data: sorted.map((p) => p.name).reverse(),
        axisLabel: { fontSize: 11, color: "#737373" },
      },
      series: [
        {
          type: "bar" as const,
          data: sorted.map((p) => p.marketSharePct).reverse(),
          barWidth: "55%",
          itemStyle: { color: "#f43f5e", borderRadius: [0, 4, 4, 0] },
          label: { show: true, position: "right" as const, fontSize: 10, formatter: "{c}%" },
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
            <Swords className="h-4 w-4" /> 竞品情报
          </h1>
          <p className="mt-1 text-[12.5px] text-neutral-500">
            由 pi agent 联网检索生成的竞争情报（竞品档案 / 份额估计 / 对标矩阵 / 替代风险）。份额为公开信息估算，仅供分析参考。
          </p>
        </div>

        {/* Controls */}
        <div className="rounded-xl border border-neutral-200 bg-white p-4 shadow-sm dark:border-neutral-800 dark:bg-neutral-900">
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative flex-1 min-w-[160px]">
              <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-neutral-400" />
              <input
                value={brand}
                onChange={(e) => setBrand(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") void run(); }}
                placeholder="本品牌，如 蜜雪冰城"
                className="h-8 w-full rounded-md border border-neutral-200 bg-neutral-50 pl-8 pr-2 text-[13px] outline-none placeholder:text-neutral-400 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100"
              />
            </div>
            <input
              value={rivals}
              onChange={(e) => setRivals(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") void run(); }}
              placeholder="指定竞品(可选，逗号分隔)"
              className="h-8 flex-1 min-w-[160px] rounded-md border border-neutral-200 bg-neutral-50 px-2.5 text-[13px] outline-none placeholder:text-neutral-400 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100"
            />
            <button
              onClick={() => void run()}
              disabled={loading || !brand.trim()}
              className={cn(
                "inline-flex h-8 items-center gap-1.5 rounded-md px-4 text-[13px] font-medium transition-colors",
                "bg-rose-600 text-white hover:bg-rose-500",
                "disabled:cursor-not-allowed disabled:opacity-50",
              )}
            >
              {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Target className="h-3.5 w-3.5" />}
              {loading ? "分析中..." : "生成情报"}
            </button>
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
            <span className="ml-2 text-[13px] text-neutral-400">pi 正在检索竞品情报，可能需要 1-2 分钟...</span>
          </div>
        )}

        {data && !loading && (
          <>
            {/* Summary */}
            <div className="rounded-xl border border-neutral-200 bg-white p-4 shadow-sm dark:border-neutral-800 dark:bg-neutral-900">
              <h2 className="text-[14px] font-semibold text-neutral-900 dark:text-neutral-100">{data.brand} · 竞争格局</h2>
              {data.summary && <p className="mt-1.5 text-[12.5px] leading-relaxed text-neutral-600 dark:text-neutral-400">{data.summary}</p>}
            </div>

            {/* Market share chart */}
            {shareOption && (
              <div className="rounded-xl border border-neutral-200 bg-white p-4 shadow-sm dark:border-neutral-800 dark:bg-neutral-900">
                <h2 className="mb-2 text-[13px] font-medium text-neutral-700 dark:text-neutral-300">估计市场份额</h2>
                <Suspense fallback={<ChartFallback />}>
                  <ReactECharts option={shareOption} style={{ height: Math.max(200, data.profiles.length * 44) }} notMerge lazyUpdate />
                </Suspense>
              </div>
            )}

            {/* Competitor profile cards */}
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              {data.profiles.map((p, i) => (
                <div key={i} className="rounded-xl border border-neutral-200 bg-white p-4 shadow-sm dark:border-neutral-800 dark:bg-neutral-900">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <h3 className="text-[13.5px] font-semibold text-neutral-900 dark:text-neutral-100">{p.name}</h3>
                      <p className="text-[11.5px] text-neutral-500">{p.positioning}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-[15px] font-semibold text-rose-600 dark:text-rose-400">{p.marketSharePct}%</p>
                      <p className="text-[10.5px] text-neutral-400">{p.priceLevel}</p>
                    </div>
                  </div>
                  <div className="mt-2.5 grid grid-cols-2 gap-2 text-[11.5px]">
                    <TagList label="优势" items={p.strengths} tone="emerald" />
                    <TagList label="劣势" items={p.weaknesses} tone="rose" />
                  </div>
                  {p.recentMoves.length > 0 && (
                    <div className="mt-2 border-t border-neutral-100 pt-2 dark:border-neutral-800">
                      <p className="mb-1 text-[11px] font-medium text-neutral-400">近期动作</p>
                      <ul className="flex flex-col gap-0.5">
                        {p.recentMoves.map((m, j) => (
                          <li key={j} className="text-[11.5px] text-neutral-600 dark:text-neutral-400">· {m}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              ))}
            </div>

            {/* Comparison table */}
            {data.comparison.length > 0 && (
              <div className="overflow-hidden rounded-xl border border-neutral-200 bg-white shadow-sm dark:border-neutral-800 dark:bg-neutral-900">
                <h2 className="border-b border-neutral-100 px-4 py-2.5 text-[13px] font-medium text-neutral-700 dark:border-neutral-800 dark:text-neutral-300">对标矩阵</h2>
                <table className="w-full text-[12px]">
                  <thead>
                    <tr className="text-left text-neutral-400">
                      <th className="px-4 py-2 font-medium">维度</th>
                      <th className="px-4 py-2 font-medium">{data.brand}</th>
                      <th className="px-4 py-2 font-medium">竞品对比</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.comparison.map((c, i) => (
                      <tr key={i} className="border-t border-neutral-100 dark:border-neutral-800">
                        <td className="px-4 py-2 font-medium text-neutral-700 dark:text-neutral-300">{c.dimension}</td>
                        <td className="px-4 py-2 text-neutral-600 dark:text-neutral-400">{c.self}</td>
                        <td className="px-4 py-2 text-neutral-600 dark:text-neutral-400">{c.rivals}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {/* Substitution risk + recommendations */}
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              <div className="rounded-xl border border-neutral-200 bg-white p-4 shadow-sm dark:border-neutral-800 dark:bg-neutral-900">
                <h2 className="mb-2 flex items-center gap-1.5 text-[13px] font-medium text-neutral-700 dark:text-neutral-300">
                  <ShieldAlert className="h-3.5 w-3.5" /> 替代风险
                </h2>
                <p className="text-[12.5px] leading-relaxed text-neutral-600 dark:text-neutral-400">{data.substitutionRisk || "—"}</p>
              </div>
              <div className="rounded-xl border border-neutral-200 bg-white p-4 shadow-sm dark:border-neutral-800 dark:bg-neutral-900">
                <h2 className="mb-2 flex items-center gap-1.5 text-[13px] font-medium text-neutral-700 dark:text-neutral-300">
                  <Target className="h-3.5 w-3.5" /> 策略建议
                </h2>
                {data.recommendations.length === 0 ? (
                  <p className="text-[12px] text-neutral-400">—</p>
                ) : (
                  <ul className="flex flex-col gap-1.5">
                    {data.recommendations.map((r, i) => (
                      <li key={i} className="flex gap-2 text-[12.5px] text-neutral-600 dark:text-neutral-400">
                        <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-rose-400" />
                        {r}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>

            <p className="text-center text-[11px] text-neutral-400">由 pi agent 生成，内容可能存在偏差，请结合权威来源核实。</p>
          </>
        )}
      </div>
    </div>
  );
}

function TagList({ label, items, tone }: { label: string; items: string[]; tone: "emerald" | "rose" }) {
  const cls = tone === "emerald"
    ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-400"
    : "bg-rose-50 text-rose-700 dark:bg-rose-950/50 dark:text-rose-400";
  return (
    <div>
      <p className="mb-1 text-[10.5px] font-medium text-neutral-400">{label}</p>
      <div className="flex flex-wrap gap-1">
        {items.length === 0 ? <span className="text-neutral-400">—</span> : items.map((t, i) => (
          <span key={i} className={cn("rounded px-1.5 py-0.5 text-[11px]", cls)}>{t}</span>
        ))}
      </div>
    </div>
  );
}
