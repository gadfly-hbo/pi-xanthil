import { useCallback, useEffect, useState } from "react";
import { BarChart3, Database, DollarSign, RefreshCw, Hash, Layers, TrendingUp, Cpu } from "lucide-react";
import { api } from "@/lib/api";
import type { SessionTokenStats } from "@/types";

interface TokenStatsRow extends SessionTokenStats {
  title: string;
}

function fmt(n: number): string {
  return n.toLocaleString();
}

function costFmt(n: number): string {
  if (n < 0.01) return `$${n.toFixed(6)}`;
  if (n < 1) return `$${n.toFixed(4)}`;
  return `$${n.toFixed(2)}`;
}

function pct(n: number): string {
  return `${(n * 100).toFixed(1)}%`;
}

function barWidth(ratio: number): string {
  return `${Math.max(2, Math.min(100, ratio * 100))}%`;
}

interface StatCardProps {
  icon: React.ReactNode;
  label: string;
  value: string;
  sub?: string;
  color: string;
}

function StatCard(p: StatCardProps) {
  return (
    <div className="flex items-center gap-3 rounded-lg border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
      <div className={`flex h-10 w-10 items-center justify-center rounded-lg ${p.color}`}>
        {p.icon}
      </div>
      <div className="min-w-0">
        <div className="text-[11px] text-neutral-500">{p.label}</div>
        <div className="truncate text-[15px] font-semibold tabular-nums text-neutral-900 dark:text-neutral-100">
          {p.value}
        </div>
        {p.sub && <div className="text-[11px] text-neutral-400">{p.sub}</div>}
      </div>
    </div>
  );
}

export function TokenStatsPane({ workspaceId }: { workspaceId: string | null }) {
  const [rows, setRows] = useState<TokenStatsRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const fetchData = useCallback(async () => {
    if (!workspaceId) return;
    setLoading(true);
    setError("");
    try {
      const data = await api.getWorkspaceTokenStatsBySession(workspaceId);
      setRows(data);
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }, [workspaceId]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const total = rows.reduce(
    (acc, r) => ({
      inputTokens: acc.inputTokens + r.inputTokens,
      outputTokens: acc.outputTokens + r.outputTokens,
      cacheReadTokens: acc.cacheReadTokens + r.cacheReadTokens,
      cacheWriteTokens: acc.cacheWriteTokens + r.cacheWriteTokens,
      turnCount: acc.turnCount + r.turnCount,
      totalCost: acc.totalCost + r.totalCost,
    }),
    { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, turnCount: 0, totalCost: 0 },
  );

  const totalTokens = total.inputTokens + total.outputTokens + total.cacheReadTokens + total.cacheWriteTokens;
  const cacheTotal = total.inputTokens + total.cacheReadTokens + total.cacheWriteTokens;
  const cacheHitRate = cacheTotal > 0 ? total.cacheReadTokens / cacheTotal : 0;

  return (
    <div className="flex min-h-0 flex-1 overflow-auto bg-neutral-50/60 p-5 dark:bg-neutral-950">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-4">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="flex items-center gap-2 text-base font-semibold text-neutral-900 dark:text-neutral-100">
              <BarChart3 className="h-4 w-4" /> Token 使用统计
            </h1>
            <p className="mt-1 text-[12.5px] text-neutral-500">
              全工作区 token 消耗概览，按会话维度汇总
            </p>
          </div>
          <button
            onClick={fetchData}
            disabled={loading}
            className="inline-flex items-center gap-1.5 rounded-md border border-neutral-200 bg-white px-3 py-2 text-[12px] font-medium text-neutral-700 hover:bg-neutral-50 disabled:opacity-50 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-300"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
            刷新
          </button>
        </div>

        {error && (
          <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-[12px] text-red-600 dark:border-red-900 dark:bg-red-950/30">
            {error}
          </div>
        )}

        {/* Summary cards */}
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard
            icon={<Database className="h-5 w-5 text-white" />}
            label="总 Token 消耗"
            value={fmt(totalTokens)}
            sub={`${fmt(total.inputTokens)} input / ${fmt(total.outputTokens)} output`}
            color="bg-blue-500"
          />
          <StatCard
            icon={<DollarSign className="h-5 w-5 text-white" />}
            label="总成本 (USD)"
            value={costFmt(total.totalCost)}
            sub={`${fmt(total.turnCount)} 轮对话`}
            color="bg-emerald-500"
          />
          <StatCard
            icon={<Cpu className="h-5 w-5 text-white" />}
            label="缓存命中率"
            value={pct(cacheHitRate)}
            sub={`${fmt(total.cacheReadTokens)} cacheRead / ${fmt(total.cacheWriteTokens)} cacheWrite`}
            color="bg-violet-500"
          />
          <StatCard
            icon={<Layers className="h-5 w-5 text-white" />}
            label="会话数"
            value={fmt(rows.length)}
            sub={rows.length > 0 ? `最近更新: ${new Date(Math.max(...rows.map((r) => r.updatedAt))).toLocaleString()}` : ""}
            color="bg-amber-500"
          />
        </div>

        {/* Token distribution bar */}
        {totalTokens > 0 && (
          <div className="rounded-lg border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
            <h2 className="flex items-center gap-1.5 text-[13px] font-semibold text-neutral-900 dark:text-neutral-100">
              <TrendingUp className="h-3.5 w-3.5" /> Token 分布
            </h2>
            <div className="mt-3 flex h-5 w-full overflow-hidden rounded-full bg-neutral-100 dark:bg-neutral-800">
              {total.inputTokens > 0 && (
                <div
                  className="flex items-center justify-center bg-blue-400 text-[10px] font-medium text-white transition-all"
                  style={{ width: barWidth(total.inputTokens / totalTokens) }}
                  title={`input: ${fmt(total.inputTokens)}`}
                >
                  {total.inputTokens / totalTokens > 0.12 && `input ${fmt(total.inputTokens)}`}
                </div>
              )}
              {total.outputTokens > 0 && (
                <div
                  className="flex items-center justify-center bg-emerald-400 text-[10px] font-medium text-white transition-all"
                  style={{ width: barWidth(total.outputTokens / totalTokens) }}
                  title={`output: ${fmt(total.outputTokens)}`}
                >
                  {total.outputTokens / totalTokens > 0.12 && `output ${fmt(total.outputTokens)}`}
                </div>
              )}
              {total.cacheReadTokens > 0 && (
                <div
                  className="flex items-center justify-center bg-violet-400 text-[10px] font-medium text-white transition-all"
                  style={{ width: barWidth(total.cacheReadTokens / totalTokens) }}
                  title={`cacheRead: ${fmt(total.cacheReadTokens)}`}
                >
                  {total.cacheReadTokens / totalTokens > 0.12 && `cache ${fmt(total.cacheReadTokens)}`}
                </div>
              )}
              {total.cacheWriteTokens > 0 && (
                <div
                  className="flex items-center justify-center bg-amber-400 text-[10px] font-medium text-white transition-all"
                  style={{ width: barWidth(total.cacheWriteTokens / totalTokens) }}
                  title={`cacheWrite: ${fmt(total.cacheWriteTokens)}`}
                >
                  {total.cacheWriteTokens / totalTokens > 0.12 && `write ${fmt(total.cacheWriteTokens)}`}
                </div>
              )}
            </div>
            <div className="mt-2 flex flex-wrap gap-3 text-[11px] text-neutral-500">
              <span className="flex items-center gap-1"><span className="inline-block h-2.5 w-2.5 rounded bg-blue-400" /> input</span>
              <span className="flex items-center gap-1"><span className="inline-block h-2.5 w-2.5 rounded bg-emerald-400" /> output</span>
              <span className="flex items-center gap-1"><span className="inline-block h-2.5 w-2.5 rounded bg-violet-400" /> cacheRead</span>
              <span className="flex items-center gap-1"><span className="inline-block h-2.5 w-2.5 rounded bg-amber-400" /> cacheWrite</span>
            </div>
          </div>
        )}

        {/* Per-session table */}
        <div className="rounded-lg border border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900">
          <div className="flex items-center gap-2 border-b border-neutral-200 px-4 py-3 dark:border-neutral-800">
            <Hash className="h-3.5 w-3.5 text-neutral-500" />
            <h2 className="text-[13px] font-semibold text-neutral-900 dark:text-neutral-100">
              会话明细
            </h2>
            <span className="text-[11px] text-neutral-400">({rows.length} 个会话)</span>
          </div>
          {rows.length === 0 ? (
            <div className="flex min-h-32 items-center justify-center text-[13px] text-neutral-400">
              {loading ? "加载中..." : "暂无 token 统计数据"}
            </div>
          ) : (
            <div className="overflow-auto">
              <table className="w-full text-left text-[12px]">
                <thead>
                  <tr className="border-b border-neutral-100 text-neutral-500 dark:border-neutral-800">
                    <th className="sticky left-0 bg-white px-4 py-2.5 font-medium dark:bg-neutral-900">会话</th>
                    <th className="px-3 py-2.5 font-medium text-right">input</th>
                    <th className="px-3 py-2.5 font-medium text-right">output</th>
                    <th className="px-3 py-2.5 font-medium text-right">cacheRead</th>
                    <th className="px-3 py-2.5 font-medium text-right">cacheWrite</th>
                    <th className="px-3 py-2.5 font-medium text-right">总 token</th>
                    <th className="px-3 py-2.5 font-medium text-right">轮次</th>
                    <th className="px-3 py-2.5 font-medium text-right">成本</th>
                    <th className="px-3 py-2.5 font-medium text-right">缓存率</th>
                    <th className="px-3 py-2.5 font-medium text-right">最后更新</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => {
                    const sessionTotal = r.inputTokens + r.outputTokens + r.cacheReadTokens + r.cacheWriteTokens;
                    return (
                      <tr
                        key={r.sessionId}
                        className="border-b border-neutral-50 text-neutral-700 hover:bg-neutral-50 dark:border-neutral-800/50 dark:text-neutral-300 dark:hover:bg-neutral-800/30"
                      >
                        <td className="sticky left-0 max-w-[14rem] truncate bg-white px-4 py-2.5 font-medium dark:bg-neutral-900">
                          {r.title || r.sessionId.slice(0, 8)}
                        </td>
                        <td className="px-3 py-2.5 text-right tabular-nums">{fmt(r.inputTokens)}</td>
                        <td className="px-3 py-2.5 text-right tabular-nums">{fmt(r.outputTokens)}</td>
                        <td className="px-3 py-2.5 text-right tabular-nums">{fmt(r.cacheReadTokens)}</td>
                        <td className="px-3 py-2.5 text-right tabular-nums">{fmt(r.cacheWriteTokens)}</td>
                        <td className="px-3 py-2.5 text-right tabular-nums font-medium">{fmt(sessionTotal)}</td>
                        <td className="px-3 py-2.5 text-right tabular-nums">{r.turnCount}</td>
                        <td className="px-3 py-2.5 text-right tabular-nums">{costFmt(r.totalCost)}</td>
                        <td className="px-3 py-2.5 text-right tabular-nums">
                          <span
                            className={
                              r.cacheHitRate >= 0.5
                                ? "text-emerald-600 dark:text-emerald-400"
                                : r.cacheHitRate >= 0.2
                                  ? "text-amber-500"
                                  : ""
                            }
                          >
                            {pct(r.cacheHitRate)}
                          </span>
                        </td>
                        <td className="px-3 py-2.5 text-right tabular-nums text-neutral-400">
                          {new Date(r.updatedAt).toLocaleDateString()}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
