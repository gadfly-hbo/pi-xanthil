import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { Activity, AlertTriangle, BarChart3, CircleCheck, Clock, Copy, Database, Download, ListOrdered, RefreshCw, Search, TrendingUp, Trash2, X, ArrowLeft, ArrowRight, GitCompare } from "lucide-react";
import { api } from "@/lib/api";
import type { ModelLabRunSummary, ModelLabStats, PredictionResult, PredictionRowResult, ModelLabRunDetail } from "@/types";
import { OPERATIONAL_MODEL_IDS } from "@/data/models";
import { cn } from "@/lib/cn";

function formatNumber(n: number): string {
  return n.toLocaleString("en-US");
}

function formatDuration(ms: number): string {
  if (!ms || ms <= 0) return "0 ms";
  if (ms < 1000) return `${Math.round(ms)} ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)} s`;
  return `${(ms / 60_000).toFixed(1)} min`;
}

function formatRelativeTime(ts: number): string {
  const diff = Date.now() - ts;
  if (diff < 60_000) return "刚刚";
  if (diff < 3600_000) return `${Math.floor(diff / 60_000)} 分钟前`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3600_000)} 小时前`;
  if (diff < 7 * 86_400_000) return `${Math.floor(diff / 86_400_000)} 天前`;
  return new Date(ts).toLocaleDateString("zh-CN", { month: "2-digit", day: "2-digit" });
}

function modeOf(modelId: string): "prediction" | "operational" {
  return OPERATIONAL_MODEL_IDS.has(modelId) ? "operational" : "prediction";
}

function exportRunsToCsv(rows: ModelLabRunSummary[]): void {
  const headers = ["modelId", "model", "status", "mode", "createdAt", "rowCount", "rowsTotal", "durationMs", "errorMessage"];
  const lines = [headers.join(",")];
  for (const r of rows) {
    const mode = modeOf(r.modelId);
    const createdAt = new Date(r.createdAt).toISOString();
    const err = (r.errorMessage ?? "").replace(/"/g, '""');
    lines.push([
      r.modelId, r.model, r.status, mode, createdAt,
      r.rowCount, r.rowsTotal, r.durationMs,
      `"${err}"`
    ].join(","));
  }
  const bom = "\uFEFF";
  const blob = new Blob([bom + lines.join("\n")], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `model-lab-runs-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

interface KpiCardProps {
  icon: typeof Activity;
  label: string;
  value: string;
  hint?: string;
}

function KpiCard({ icon: Icon, label, value, hint }: KpiCardProps) {
  return (
    <div className="rounded-xl border border-neutral-200 bg-white p-5 dark:border-neutral-800 dark:bg-neutral-900">
      <div className="flex items-center gap-2 text-[11px] font-medium uppercase tracking-[0.14em] text-neutral-500 dark:text-neutral-400">
        <Icon className="h-3.5 w-3.5" strokeWidth={2} />
        {label}
      </div>
      <div className="mt-3 text-[26px] font-semibold tracking-tight text-neutral-950 dark:text-neutral-50">{value}</div>
      {hint && <div className="mt-1 text-[11.5px] text-neutral-400">{hint}</div>}
    </div>
  );
}

interface TrendChartProps {
  data: Array<{ date: string; count: number }>;
}

function TrendChart({ data }: TrendChartProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const instanceRef = useRef<unknown>(null);

  useEffect(() => {
    if (!containerRef.current || data.length === 0) return;
    let cancelled = false;
    void import("echarts").then((echarts) => {
      if (cancelled || !containerRef.current) return;
      let instance = instanceRef.current as ReturnType<typeof echarts.init> | null;
      if (!instance) {
        instance = echarts.init(containerRef.current);
        instanceRef.current = instance;
      }
      instance.setOption({
        grid: { left: 40, right: 16, top: 16, bottom: 32 },
        tooltip: { trigger: "axis" },
        xAxis: {
          type: "category",
          data: data.map((d) => d.date),
          axisLabel: { fontSize: 10, color: "#737373" },
          axisLine: { lineStyle: { color: "#e5e5e5" } },
        },
        yAxis: {
          type: "value",
          axisLabel: { fontSize: 10, color: "#737373" },
          splitLine: { lineStyle: { color: "#f5f5f5" } },
        },
        series: [
          {
            type: "line",
            data: data.map((d) => d.count),
            smooth: true,
            symbol: "circle",
            symbolSize: 6,
            lineStyle: { color: "#171717", width: 2 },
            itemStyle: { color: "#171717" },
            areaStyle: { color: "rgba(23, 23, 23, 0.06)" },
          },
        ],
      }, true);
      const resize = () => instance?.resize();
      window.addEventListener("resize", resize);
      return () => window.removeEventListener("resize", resize);
    });
    return () => { cancelled = true; };
  }, [data]);

  useEffect(() => {
    return () => {
      const inst = instanceRef.current as { dispose?: () => void } | null;
      inst?.dispose?.();
      instanceRef.current = null;
    };
  }, []);

  if (data.length === 0) {
    return (
      <div className="flex h-64 items-center justify-center text-[12.5px] text-neutral-400">
        最近 30 天暂无运行记录
      </div>
    );
  }

  return <div ref={containerRef} className="h-64 w-full" />;
}

interface TopModelsChartProps {
  data: Array<{ modelId: string; model: string; count: number; avgDurationMs: number }>;
}

function TopModelsChart({ data }: TopModelsChartProps) {
  if (data.length === 0) {
    return (
      <div className="flex h-64 items-center justify-center text-[12.5px] text-neutral-400">
        暂无模型调用记录
      </div>
    );
  }
  const maxCount = Math.max(...data.map((d) => d.count));
  return (
    <div className="space-y-2.5">
      {data.map((row) => {
        const widthPct = maxCount > 0 ? (row.count / maxCount) * 100 : 0;
        return (
          <div key={row.modelId} className="grid grid-cols-12 items-center gap-3 text-[12.5px]">
            <div className="col-span-4 truncate font-medium text-neutral-800 dark:text-neutral-200" title={row.modelId}>
              {row.modelId}
            </div>
            <div className="col-span-6 relative h-6 rounded bg-neutral-100 dark:bg-neutral-800">
              <div
                className="absolute inset-y-0 left-0 rounded bg-neutral-900 transition-all dark:bg-neutral-100"
                style={{ width: `${widthPct}%` }}
              />
              <div className="absolute inset-0 flex items-center justify-end pr-2 text-[11px] font-medium text-neutral-700 dark:text-neutral-300">
                {row.count}
              </div>
            </div>
            <div className="col-span-2 text-right text-[11px] tabular-nums text-neutral-500">
              {formatDuration(row.avgDurationMs)}
            </div>
          </div>
        );
      })}
    </div>
  );
}

interface RecentRunsTableProps {
  rows: ModelLabRunSummary[];
  onRowClick?: (runId: string) => void;
  onFailureDetail?: (runId: string) => void;
  onDeleteRow?: (runId: string) => void;
  busyDeleteId?: string | null;
  emptyHint?: string;
}

function RecentRunsTable({ rows, onRowClick, onFailureDetail, onDeleteRow, busyDeleteId, emptyHint }: RecentRunsTableProps) {
  if (rows.length === 0) {
    return (
      <div className="flex h-32 items-center justify-center text-[12.5px] text-neutral-400">
        {emptyHint || "暂无运行记录"}
      </div>
    );
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-[12.5px]">
        <thead>
          <tr className="border-b border-neutral-200 text-left text-[11px] font-medium uppercase tracking-[0.1em] text-neutral-500 dark:border-neutral-800 dark:text-neutral-400">
            <th className="py-2 pr-4 font-medium">模型</th>
            <th className="py-2 pr-4 font-medium">类型</th>
            <th className="py-2 pr-4 font-medium">状态</th>
            <th className="py-2 pr-4 font-medium">时间</th>
            <th className="py-2 pr-4 text-right font-medium">行数</th>
            <th className="py-2 pr-4 text-right font-medium">耗时</th>
            <th className="py-2 pr-2 text-right font-medium">操作</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const mode = modeOf(row.modelId);
            const isOperational = mode === "operational";
            const isFailed = row.status === "failed";
            const canRestore = !isFailed && Boolean(onRowClick);
            const isDeleting = busyDeleteId === row.id;
            return (
              <tr
                key={row.id}
                onClick={() => {
                  if (canRestore) onRowClick?.(row.id);
                }}
                className={cn(
                  "group border-b border-neutral-100 transition-colors dark:border-neutral-900",
                  canRestore && "cursor-pointer hover:bg-neutral-50 dark:hover:bg-neutral-900/60",
                  isFailed && "hover:bg-red-50/30 dark:hover:bg-red-950/10",
                )}
              >
                <td className="py-2.5 pr-4">
                  <div className="font-medium text-neutral-900 dark:text-neutral-100">{row.modelId}</div>
                  <div className="text-[11px] text-neutral-500">{row.model}</div>
                </td>
                <td className="py-2.5 pr-4">
                  <span
                    className={cn(
                      "inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium",
                      isOperational
                        ? "border-purple-200 bg-purple-50 text-purple-700 dark:border-purple-900 dark:bg-purple-950/40 dark:text-purple-300"
                        : "border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-900 dark:bg-blue-950/40 dark:text-blue-300",
                    )}
                  >
                    {isOperational ? "运营" : "预测"}
                  </span>
                </td>
                <td className="py-2.5 pr-4">
                  {isFailed ? (
                    <span className="inline-flex items-center gap-1 rounded-full border border-red-200 bg-red-50 px-2 py-0.5 text-[11px] font-medium text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
                      <AlertTriangle className="h-3 w-3" strokeWidth={2} />
                      失败
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300">
                      <CircleCheck className="h-3 w-3" strokeWidth={2} />
                      成功
                    </span>
                  )}
                </td>
                <td className="py-2.5 pr-4 text-neutral-500" title={new Date(row.createdAt).toLocaleString("zh-CN")}>
                  {formatRelativeTime(row.createdAt)}
                </td>
                <td className="py-2.5 pr-4 text-right tabular-nums text-neutral-700 dark:text-neutral-300">
                  {row.rowCount}
                  {row.rowsCapped && <span className="ml-1 text-[10px] text-amber-600">capped</span>}
                </td>
                <td className="py-2.5 pr-4 text-right tabular-nums text-neutral-700 dark:text-neutral-300">
                  {formatDuration(row.durationMs)}
                </td>
                <td className="py-2.5 pr-2 text-right">
                  <div className="inline-flex items-center justify-end gap-1.5">
                    {canRestore ? (
                      <span className="text-[11.5px] font-medium text-neutral-900 underline-offset-2 hover:underline dark:text-neutral-100">
                        恢复 →
                      </span>
                    ) : isFailed ? (
                      <button
                        onClick={(e) => { e.stopPropagation(); onFailureDetail?.(row.id); }}
                        className="inline-flex items-center rounded-md border border-red-200 bg-white px-2 py-0.5 text-[11.5px] font-medium text-red-700 transition-colors hover:bg-red-50 dark:border-red-900 dark:bg-neutral-900 dark:text-red-300 dark:hover:bg-red-950/20"
                      >
                        查看错误
                      </button>
                    ) : null}
                    {isFailed && onDeleteRow && (
                      <button
                        onClick={(e) => { e.stopPropagation(); onDeleteRow(row.id); }}
                        disabled={isDeleting}
                        title="删除此条失败记录"
                        className={cn(
                          "inline-flex h-6 w-6 items-center justify-center rounded-md text-neutral-400 opacity-0 transition-all hover:bg-red-50 hover:text-red-600 group-hover:opacity-100 dark:hover:bg-red-950/20",
                          isDeleting && "opacity-100",
                        )}
                      >
                        <Trash2 className={cn("h-3.5 w-3.5", isDeleting && "animate-pulse")} strokeWidth={2} />
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/* ── Run Detail Drawer (Failure + Success Compare 入口) ── */

interface RunDetailDrawerProps {
  runId: string | null;
  failedIds: string[];
  onClose: () => void;
  onSelectRun: (id: string) => void;
  onCompare: (id: string) => void;
}

function RunDetailDrawer({ runId, failedIds, onClose, onSelectRun, onCompare }: RunDetailDrawerProps) {
  const [detail, setDetail] = useState<{ loading: boolean; data?: ModelLabRunDetail; error?: string }>({ loading: false });

  useEffect(() => {
    if (!runId) return;
    setDetail({ loading: true });
    api.getModelLabRun(runId)
      .then((d) => setDetail({ loading: false, data: d }))
      .catch((err: unknown) => setDetail({ loading: false, error: String(err) }));
  }, [runId]);

  useEffect(() => {
    if (!runId) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowDown" || e.key === "ArrowRight") goNext();
      if (e.key === "ArrowUp" || e.key === "ArrowLeft") goPrev();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runId, failedIds]);

  const copyText = (text: string | undefined | null) => {
    if (!text) return;
    navigator.clipboard.writeText(text).catch(() => {});
  };

  const currentIdx = runId ? failedIds.indexOf(runId) : -1;
  const hasPrev = currentIdx > 0;
  const hasNext = currentIdx >= 0 && currentIdx < failedIds.length - 1;

  const goPrev = useCallback(() => {
    const prev = failedIds[currentIdx - 1];
    if (currentIdx > 0 && prev) onSelectRun(prev);
  }, [currentIdx, failedIds, onSelectRun]);
  const goNext = useCallback(() => {
    const next = failedIds[currentIdx + 1];
    if (currentIdx >= 0 && next) onSelectRun(next);
  }, [currentIdx, failedIds, onSelectRun]);

  return (
    <div
      className={cn(
        "fixed inset-0 z-50 flex justify-end transition-all duration-200",
        runId ? "visible" : "pointer-events-none invisible",
      )}
    >
      <div
        className={cn(
          "absolute inset-0 bg-black/20 transition-opacity duration-200 dark:bg-black/50",
          runId ? "opacity-100" : "opacity-0",
        )}
        onClick={onClose}
      />
      <div
        className={cn(
          "relative flex h-full w-full max-w-2xl flex-col bg-white shadow-2xl transition-transform duration-200 dark:bg-neutral-900",
          runId ? "translate-x-0" : "translate-x-full",
        )}
      >
        <div className="sticky top-0 z-10 flex items-center justify-between gap-2 border-b border-neutral-200 bg-white px-5 py-3 dark:border-neutral-800 dark:bg-neutral-900">
          <div className="flex min-w-0 items-center gap-2">
            <AlertTriangle className="h-4 w-4 flex-none text-red-600" strokeWidth={2} />
            <h3 className="truncate text-[13px] font-semibold text-neutral-900 dark:text-neutral-100">
              失败详情
              {failedIds.length > 1 && currentIdx >= 0 && (
                <span className="ml-2 text-[11px] font-normal text-neutral-500">
                  {currentIdx + 1} / {failedIds.length}
                </span>
              )}
            </h3>
          </div>
          <div className="flex items-center gap-1">
            {failedIds.length > 1 && (
              <>
                <button
                  onClick={goPrev}
                  disabled={!hasPrev}
                  title="上一条 (↑/←)"
                  className="inline-flex h-7 w-7 items-center justify-center rounded-md text-neutral-500 hover:bg-neutral-100 hover:text-neutral-900 disabled:cursor-not-allowed disabled:opacity-30 dark:hover:bg-neutral-800 dark:hover:text-neutral-100"
                >
                  <ArrowLeft className="h-4 w-4" strokeWidth={2} />
                </button>
                <button
                  onClick={goNext}
                  disabled={!hasNext}
                  title="下一条 (↓/→)"
                  className="inline-flex h-7 w-7 items-center justify-center rounded-md text-neutral-500 hover:bg-neutral-100 hover:text-neutral-900 disabled:cursor-not-allowed disabled:opacity-30 dark:hover:bg-neutral-800 dark:hover:text-neutral-100"
                >
                  <ArrowRight className="h-4 w-4" strokeWidth={2} />
                </button>
                <span className="mx-1 h-4 w-px bg-neutral-200 dark:bg-neutral-700" />
              </>
            )}
            {runId && (
              <button
                onClick={() => onCompare(runId)}
                title="选另一次运行做对比"
                className="inline-flex items-center gap-1 rounded-md border border-neutral-200 bg-white px-2 py-1 text-[11.5px] font-medium text-neutral-700 transition-colors hover:bg-neutral-50 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-200 dark:hover:bg-neutral-700"
              >
                <GitCompare className="h-3.5 w-3.5" strokeWidth={2} />
                对比
              </button>
            )}
            <button
              onClick={onClose}
              title="关闭 (Esc)"
              className="inline-flex h-7 w-7 items-center justify-center rounded-md text-neutral-500 hover:bg-neutral-100 hover:text-neutral-900 dark:hover:bg-neutral-800 dark:hover:text-neutral-100"
            >
              <X className="h-4 w-4" strokeWidth={2} />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto">
          {detail.loading && (
            <div className="flex items-center justify-center py-20 text-[13px] text-neutral-400">加载中…</div>
          )}

          {detail.error && (
            <div className="mx-5 mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-[12.5px] text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
              加载失败：{detail.error}
            </div>
          )}

          {!detail.loading && !detail.error && detail.data && (
            <div className="space-y-5 p-5">
              <div className="text-[11.5px] text-neutral-500">
                <span className="font-medium text-neutral-800 dark:text-neutral-200">{detail.data.modelId}</span>
                <span className="mx-1.5 text-neutral-300">·</span>
                {detail.data.model}
                <span className="mx-1.5 text-neutral-300">·</span>
                {new Date(detail.data.createdAt).toLocaleString("zh-CN")}
              </div>
              <section>
                <div className="mb-2 flex items-center justify-between">
                  <h4 className="text-[11px] font-semibold uppercase tracking-[0.12em] text-red-700 dark:text-red-300">错误信息</h4>
                  <button
                    onClick={() => copyText(detail.data?.errorMessage)}
                    className="inline-flex items-center gap-1 text-[11px] text-neutral-500 hover:text-neutral-700 dark:hover:text-neutral-300"
                  >
                    <Copy className="h-3 w-3" strokeWidth={2} />
                    复制
                  </button>
                </div>
                <pre className="overflow-x-auto whitespace-pre-wrap break-words rounded-lg border border-red-200 bg-red-50/50 p-3 text-[12px] leading-relaxed text-red-800 dark:border-red-900 dark:bg-red-950/20 dark:text-red-200">
{detail.data.errorMessage || "（无错误信息）"}
                </pre>
              </section>

              <section>
                <div className="mb-2 flex items-center justify-between">
                  <h4 className="text-[11px] font-semibold uppercase tracking-[0.12em] text-neutral-500">LLM 原始输出</h4>
                  <button
                    onClick={() => copyText(detail.data?.rawOutput)}
                    className="inline-flex items-center gap-1 text-[11px] text-neutral-500 hover:text-neutral-700 dark:hover:text-neutral-300"
                  >
                    <Copy className="h-3 w-3" strokeWidth={2} />
                    复制
                  </button>
                </div>
                <pre className="overflow-x-auto whitespace-pre-wrap break-words rounded-lg border border-neutral-200 bg-neutral-50 p-3 text-[12px] leading-relaxed text-neutral-800 dark:border-neutral-800 dark:bg-neutral-950 dark:text-neutral-200">
{detail.data.rawOutput || "（无输出）"}
                </pre>
              </section>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* ── Diff View (左右两栏字段级 PredictionResult 对比) ── */

interface DiffViewProps {
  leftId: string;
  rightId: string | null;
  candidates: ModelLabRunSummary[];
  onPickRight: (id: string) => void;
  onClose: () => void;
}

interface DiffRow {
  field: string;
  left: string;
  right: string;
  changed: boolean;
}

function summarizeResult(r: PredictionResult | null): Record<string, string> {
  if (!r) return { "result": "（无结果，运行失败或无数据）" };
  const out: Record<string, string> = {};
  out["modelId"] = r.modelId;
  out["model"] = r.model || "";
  out["rowsTotal"] = String(r.rowsTotal ?? r.rows.length);
  out["rowsCapped"] = String(Boolean(r.rowsCapped));
  out["kpis.count"] = String(r.summary.kpis.length);
  r.summary.kpis.forEach((k, i) => {
    out[`kpis[${i}].label`] = k.label;
    out[`kpis[${i}].value`] = k.value;
    if (k.sub) out[`kpis[${i}].sub`] = k.sub;
    if (k.variant) out[`kpis[${i}].variant`] = k.variant;
  });
  r.summary.keyInsights.forEach((s, i) => { out[`insights[${i}]`] = s; });
  r.summary.recommendations.forEach((s, i) => { out[`recommendations[${i}]`] = s; });
  out["rows.count"] = String(r.rows.length);
  const tierCounts = new Map<string, number>();
  for (const row of r.rows) tierCounts.set(row.tierLabel, (tierCounts.get(row.tierLabel) ?? 0) + 1);
  Array.from(tierCounts.entries()).sort().forEach(([k, v]) => { out[`tier.${k}`] = String(v); });
  const scores = r.rows.map((x) => x.score);
  if (scores.length > 0) {
    const avg = scores.reduce((a, b) => a + b, 0) / scores.length;
    out["score.avg"] = avg.toFixed(2);
    out["score.min"] = String(Math.min(...scores));
    out["score.max"] = String(Math.max(...scores));
  }
  return out;
}

function buildDiff(left: ModelLabRunDetail | null, right: ModelLabRunDetail | null): DiffRow[] {
  const l = summarizeResult(left?.result ?? null);
  const r = summarizeResult(right?.result ?? null);
  const allKeys = new Set([...Object.keys(l), ...Object.keys(r)]);
  const sorted = Array.from(allKeys).sort();
  return sorted.map((field) => {
    const lv = l[field] ?? "";
    const rv = r[field] ?? "";
    return { field, left: lv, right: rv, changed: lv !== rv };
  });
}

/* ── Row-level diff ── */

interface RowDiffEntry {
  key: string;
  leftLabel: string | null;
  rightLabel: string | null;
  fields: { field: string; left: string; right: string; changed: boolean }[];
  changedCount: number;
  presence: "both" | "left-only" | "right-only";
}

function summarizeRow(row: PredictionRowResult | null | undefined): Record<string, string> {
  if (!row) return {};
  const out: Record<string, string> = {
    label: row.label ?? "",
    score: String(row.score),
    tier: row.tier,
    tierLabel: row.tierLabel,
    tierColor: row.tierColor,
    primaryConclusion: row.primaryConclusion,
  };
  if (row.attributes) {
    for (const a of row.attributes) out[`attr.${a.key}`] = a.value;
  }
  return out;
}

function buildRowDiff(left: ModelLabRunDetail | null, right: ModelLabRunDetail | null): RowDiffEntry[] {
  const lRows = left?.result?.rows ?? [];
  const rRows = right?.result?.rows ?? [];
  if (lRows.length === 0 && rRows.length === 0) return [];

  const lHasIds = lRows.every((r) => Boolean(r.id));
  const rHasIds = rRows.every((r) => Boolean(r.id));
  const useIdAlignment = lHasIds && rHasIds;

  const pairs: { key: string; left?: PredictionRowResult; right?: PredictionRowResult }[] = [];

  if (useIdAlignment) {
    const rMap = new Map(rRows.map((r) => [r.id, r]));
    const seenRight = new Set<string>();
    for (const lr of lRows) {
      const rr = rMap.get(lr.id);
      if (rr) seenRight.add(lr.id);
      pairs.push({ key: lr.id, left: lr, right: rr });
    }
    for (const rr of rRows) {
      if (!seenRight.has(rr.id)) pairs.push({ key: rr.id, right: rr });
    }
  } else {
    const maxLen = Math.max(lRows.length, rRows.length);
    for (let i = 0; i < maxLen; i++) {
      pairs.push({ key: `#${i + 1}`, left: lRows[i], right: rRows[i] });
    }
  }

  return pairs.map(({ key, left: lr, right: rr }) => {
    const lMap = summarizeRow(lr);
    const rMap = summarizeRow(rr);
    const allKeys = new Set([...Object.keys(lMap), ...Object.keys(rMap)]);
    const fields = Array.from(allKeys).sort().map((field) => {
      const lv = lMap[field] ?? "";
      const rv = rMap[field] ?? "";
      return { field, left: lv, right: rv, changed: lv !== rv };
    });
    const changedCount = fields.filter((f) => f.changed).length;
    const presence: RowDiffEntry["presence"] = lr && rr ? "both" : lr ? "left-only" : "right-only";
    return {
      key,
      leftLabel: lr ? (lr.label || lr.id) : null,
      rightLabel: rr ? (rr.label || rr.id) : null,
      fields,
      changedCount,
      presence,
    };
  });
}

/* ── Diff export to Markdown ── */

function escapeMarkdownCell(s: string): string {
  return s.replace(/\|/g, "\\|").replace(/\n/g, " ").replace(/\r/g, "");
}

function exportDiffToMarkdown(
  left: ModelLabRunDetail | null,
  right: ModelLabRunDetail | null,
  fieldDiff: DiffRow[],
  rowDiff: RowDiffEntry[],
  changedOnly: boolean,
): string {
  const lines: string[] = [];
  lines.push("# 模型运行结果对比");
  lines.push("");
  lines.push(`- 生成时间: ${new Date().toLocaleString("zh-CN")}`);
  lines.push(`- 筛选: ${changedOnly ? "仅看差异" : "全部字段"}`);
  lines.push("");

  lines.push("## 运行元信息");
  lines.push("");
  lines.push("| 维度 | 左 (基准) | 右 (对比) |");
  lines.push("| --- | --- | --- |");
  const meta = (d: ModelLabRunDetail | null, k: (x: ModelLabRunDetail) => string): string =>
    d ? escapeMarkdownCell(k(d)) : "—";
  lines.push(`| 运行 ID | ${meta(left, (d) => d.id)} | ${meta(right, (d) => d.id)} |`);
  lines.push(`| 模型 ID | ${meta(left, (d) => d.modelId)} | ${meta(right, (d) => d.modelId)} |`);
  lines.push(`| 模型名称 | ${meta(left, (d) => d.model)} | ${meta(right, (d) => d.model)} |`);
  lines.push(`| 状态 | ${meta(left, (d) => d.status)} | ${meta(right, (d) => d.status)} |`);
  lines.push(`| 创建时间 | ${meta(left, (d) => new Date(d.createdAt).toLocaleString("zh-CN"))} | ${meta(right, (d) => new Date(d.createdAt).toLocaleString("zh-CN"))} |`);
  lines.push(`| 耗时 | ${meta(left, (d) => formatDuration(d.durationMs))} | ${meta(right, (d) => formatDuration(d.durationMs))} |`);
  lines.push(`| 行数 | ${meta(left, (d) => String(d.rowCount))} | ${meta(right, (d) => String(d.rowCount))} |`);
  lines.push("");

  const fields = changedOnly ? fieldDiff.filter((f) => f.changed) : fieldDiff;
  const totalChanged = fieldDiff.filter((f) => f.changed).length;
  lines.push(`## 字段级差异（共 ${fieldDiff.length} 项，差异 ${totalChanged}）`);
  lines.push("");
  if (fields.length === 0) {
    lines.push("_无字段差异_");
  } else {
    lines.push("| 字段 | 左 | 右 | 状态 |");
    lines.push("| --- | --- | --- | --- |");
    for (const f of fields) {
      lines.push(`| \`${escapeMarkdownCell(f.field)}\` | ${escapeMarkdownCell(f.left) || "∅"} | ${escapeMarkdownCell(f.right) || "∅"} | ${f.changed ? "**变更**" : "—"} |`);
    }
  }
  lines.push("");

  const rows = changedOnly ? rowDiff.filter((r) => r.changedCount > 0 || r.presence !== "both") : rowDiff;
  const totalRowChanged = rowDiff.filter((r) => r.changedCount > 0 || r.presence !== "both").length;
  lines.push(`## 行级差异（共 ${rowDiff.length} 行，变更 ${totalRowChanged}）`);
  lines.push("");
  if (rows.length === 0) {
    lines.push("_无行级差异_");
  } else {
    for (const r of rows) {
      const presenceLabel = r.presence === "both" ? "双方存在" : r.presence === "left-only" ? "仅左侧" : "仅右侧";
      const title = r.leftLabel || r.rightLabel || r.key;
      lines.push(`### \`${escapeMarkdownCell(r.key)}\` · ${escapeMarkdownCell(title)} (${presenceLabel}, ${r.changedCount} 处变更)`);
      lines.push("");
      lines.push("| 字段 | 左 | 右 |");
      lines.push("| --- | --- | --- |");
      const fs = changedOnly ? r.fields.filter((f) => f.changed) : r.fields;
      for (const f of fs) {
        lines.push(`| \`${escapeMarkdownCell(f.field)}\` | ${escapeMarkdownCell(f.left) || "∅"} | ${escapeMarkdownCell(f.right) || "∅"} |`);
      }
      lines.push("");
    }
  }
  return lines.join("\n");
}

function downloadMarkdown(filename: string, content: string): void {
  const blob = new Blob([content], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function RunDiffView({ leftId, rightId, candidates, onPickRight, onClose }: DiffViewProps) {
  const [leftDetail, setLeftDetail] = useState<ModelLabRunDetail | null>(null);
  const [rightDetail, setRightDetail] = useState<ModelLabRunDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [showChangedOnly, setShowChangedOnly] = useState(false);
  const [showRowDetails, setShowRowDetails] = useState(false);
  const [expandedRowKeys, setExpandedRowKeys] = useState<Set<string>>(new Set());

  useEffect(() => {
    setLoading(true);
    const promises: Promise<unknown>[] = [
      api.getModelLabRun(leftId).then((d) => setLeftDetail(d)).catch(() => setLeftDetail(null)),
    ];
    if (rightId) {
      promises.push(api.getModelLabRun(rightId).then((d) => setRightDetail(d)).catch(() => setRightDetail(null)));
    } else {
      setRightDetail(null);
    }
    Promise.all(promises).finally(() => setLoading(false));
  }, [leftId, rightId]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const diff = useMemo(() => buildDiff(leftDetail, rightDetail), [leftDetail, rightDetail]);
  const filteredDiff = useMemo(() => showChangedOnly ? diff.filter((r) => r.changed) : diff, [diff, showChangedOnly]);
  const changedCount = useMemo(() => diff.filter((r) => r.changed).length, [diff]);
  const rowDiff = useMemo(() => buildRowDiff(leftDetail, rightDetail), [leftDetail, rightDetail]);
  const visibleRowDiff = useMemo(
    () => showChangedOnly ? rowDiff.filter((r) => r.changedCount > 0 || r.presence !== "both") : rowDiff,
    [rowDiff, showChangedOnly],
  );
  const rowChangedCount = useMemo(
    () => rowDiff.filter((r) => r.changedCount > 0 || r.presence !== "both").length,
    [rowDiff],
  );
  const modelMismatch = Boolean(
    leftDetail && rightDetail && leftDetail.modelId !== rightDetail.modelId,
  );

  const toggleRow = useCallback((key: string) => {
    setExpandedRowKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const handleExportMd = useCallback(() => {
    const md = exportDiffToMarkdown(leftDetail, rightDetail, diff, rowDiff, showChangedOnly);
    const ts = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
    const leftTag = leftDetail?.modelId ?? "left";
    const rightTag = rightDetail?.modelId ?? "right";
    downloadMarkdown(`model-lab-diff-${leftTag}-vs-${rightTag}-${ts}.md`, md);
  }, [leftDetail, rightDetail, diff, rowDiff, showChangedOnly]);

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-white dark:bg-neutral-900">
      <div className="flex items-center justify-between gap-3 border-b border-neutral-200 bg-white px-5 py-3 dark:border-neutral-800 dark:bg-neutral-900">
        <div className="flex items-center gap-2">
          <GitCompare className="h-4 w-4 text-neutral-500" strokeWidth={2} />
          <h3 className="text-[13px] font-semibold text-neutral-900 dark:text-neutral-100">运行结果对比</h3>
          {!loading && rightId && (
            <span className="text-[11px] text-neutral-500">
              共 {diff.length} 字段 · <span className="font-medium text-amber-700 dark:text-amber-400">{changedCount} 处差异</span>
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {rightId && (
            <>
              <label className="inline-flex items-center gap-1.5 text-[11.5px] text-neutral-600 dark:text-neutral-300">
                <input
                  type="checkbox"
                  checked={showChangedOnly}
                  onChange={(e) => setShowChangedOnly(e.target.checked)}
                  className="h-3.5 w-3.5"
                />
                仅看差异
              </label>
              <label className="inline-flex items-center gap-1.5 text-[11.5px] text-neutral-600 dark:text-neutral-300">
                <input
                  type="checkbox"
                  checked={showRowDetails}
                  onChange={(e) => setShowRowDetails(e.target.checked)}
                  className="h-3.5 w-3.5"
                />
                展开行级
              </label>
              <button
                onClick={handleExportMd}
                disabled={loading || !rightDetail}
                title="导出 Markdown"
                className="inline-flex items-center gap-1 rounded-md border border-neutral-200 bg-white px-2 py-1 text-[11.5px] font-medium text-neutral-700 hover:bg-neutral-50 disabled:opacity-50 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-200 dark:hover:bg-neutral-700"
              >
                <Download className="h-3.5 w-3.5" strokeWidth={2} />
                导出 MD
              </button>
            </>
          )}
          <button
            onClick={onClose}
            title="关闭 (Esc)"
            className="inline-flex h-7 w-7 items-center justify-center rounded-md text-neutral-500 hover:bg-neutral-100 hover:text-neutral-900 dark:hover:bg-neutral-800 dark:hover:text-neutral-100"
          >
            <X className="h-4 w-4" strokeWidth={2} />
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-px border-b border-neutral-200 bg-neutral-100 px-0 py-0 text-[12px] dark:border-neutral-800 dark:bg-neutral-800">
        <div className="bg-white px-5 py-3 dark:bg-neutral-900">
          <div className="text-[10.5px] font-semibold uppercase tracking-[0.12em] text-neutral-500">左 (基准)</div>
          <div className="mt-1 truncate font-medium text-neutral-900 dark:text-neutral-100">{leftDetail?.modelId ?? "…"}</div>
          <div className="text-[11px] text-neutral-500">
            {leftDetail ? `${leftDetail.model} · ${new Date(leftDetail.createdAt).toLocaleString("zh-CN")}` : "加载中…"}
          </div>
        </div>
        <div className="bg-white px-5 py-3 dark:bg-neutral-900">
          <div className="flex items-center gap-2">
            <div className="text-[10.5px] font-semibold uppercase tracking-[0.12em] text-neutral-500">右 (对比)</div>
            <select
              value={rightId ?? ""}
              onChange={(e) => onPickRight(e.target.value)}
              className="h-6 max-w-[260px] truncate rounded border border-neutral-200 bg-white px-1.5 text-[11.5px] focus:border-neutral-400 focus:outline-none dark:border-neutral-700 dark:bg-neutral-800"
            >
              <option value="">— 选择一次运行 —</option>
              {candidates.filter((c) => c.id !== leftId).map((c) => (
                <option key={c.id} value={c.id}>
                  {c.modelId} · {c.status === "failed" ? "✕" : "✓"} · {new Date(c.createdAt).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })}
                </option>
              ))}
            </select>
          </div>
          <div className="mt-1 truncate font-medium text-neutral-900 dark:text-neutral-100">{rightDetail?.modelId ?? "—"}</div>
          <div className="text-[11px] text-neutral-500">
            {rightDetail ? `${rightDetail.model} · ${new Date(rightDetail.createdAt).toLocaleString("zh-CN")}` : (rightId ? "加载中…" : "请选择对比对象")}
          </div>
        </div>
      </div>

      {modelMismatch && rightId && (
        <div className="flex items-start gap-2 border-b border-amber-200 bg-amber-50 px-5 py-2 text-[11.5px] text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
          <AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0" strokeWidth={2} />
          <span>
            两次运行使用了不同的模型 ID（<span className="font-mono font-semibold">{leftDetail?.modelId}</span> vs <span className="font-mono font-semibold">{rightDetail?.modelId}</span>），KPI 标签与 tier 编码可能不一致，差异结果仅供参考。建议对比相同 modelId 的运行。
          </span>
        </div>
      )}

      <div className="flex-1 overflow-auto">
        {!rightId ? (
          <div className="flex h-full items-center justify-center text-[12.5px] text-neutral-400">
            从上方下拉框选择一次运行进行对比
          </div>
        ) : (
          <div className="flex flex-col">
            <div className="border-b border-neutral-200 bg-neutral-50 px-5 py-2 text-[10.5px] font-semibold uppercase tracking-[0.12em] text-neutral-500 dark:border-neutral-800 dark:bg-neutral-950 dark:text-neutral-400">
              字段级差异
            </div>
            <table className="w-full text-[12px]">
              <thead className="sticky top-0 bg-neutral-50 text-left text-[10.5px] font-medium uppercase tracking-[0.1em] text-neutral-500 dark:bg-neutral-950 dark:text-neutral-400">
                <tr className="border-b border-neutral-200 dark:border-neutral-800">
                  <th className="w-[24%] py-2 pl-5 pr-3 font-medium">字段</th>
                  <th className="w-[38%] py-2 pr-3 font-medium">左</th>
                  <th className="w-[38%] py-2 pr-5 font-medium">右</th>
                </tr>
              </thead>
              <tbody>
                {filteredDiff.length === 0 ? (
                  <tr><td colSpan={3} className="py-12 text-center text-[12.5px] text-neutral-400">{showChangedOnly ? "无差异" : "无数据"}</td></tr>
                ) : filteredDiff.map((row) => (
                  <tr key={row.field} className={cn(
                    "border-b border-neutral-100 align-top dark:border-neutral-900",
                    row.changed && "bg-amber-50/40 dark:bg-amber-950/10",
                  )}>
                    <td className="py-2 pl-5 pr-3 font-mono text-[11px] text-neutral-700 dark:text-neutral-300">{row.field}</td>
                    <td className={cn("py-2 pr-3 break-words", row.changed && "text-rose-700 dark:text-rose-300")}>{row.left || <span className="text-neutral-300">∅</span>}</td>
                    <td className={cn("py-2 pr-5 break-words", row.changed && "text-emerald-700 dark:text-emerald-300")}>{row.right || <span className="text-neutral-300">∅</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            {showRowDetails && (
              <>
                <div className="border-y border-neutral-200 bg-neutral-50 px-5 py-2 text-[10.5px] font-semibold uppercase tracking-[0.12em] text-neutral-500 dark:border-neutral-800 dark:bg-neutral-950 dark:text-neutral-400">
                  行级差异 · 共 {rowDiff.length} 行，{rowChangedCount} 处变更
                </div>
                {visibleRowDiff.length === 0 ? (
                  <div className="py-12 text-center text-[12.5px] text-neutral-400">{showChangedOnly ? "无行级差异" : "无行数据"}</div>
                ) : (
                  <div className="divide-y divide-neutral-100 dark:divide-neutral-900">
                    {visibleRowDiff.map((entry) => {
                      const expanded = expandedRowKeys.has(entry.key);
                      const presenceBadge = entry.presence === "both"
                        ? null
                        : entry.presence === "left-only"
                          ? <span className="rounded bg-rose-100 px-1.5 py-0.5 text-[10px] font-medium text-rose-700 dark:bg-rose-950 dark:text-rose-300">仅左</span>
                          : <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">仅右</span>;
                      const fieldsToShow = showChangedOnly ? entry.fields.filter((f) => f.changed) : entry.fields;
                      const title = entry.leftLabel || entry.rightLabel || entry.key;
                      return (
                        <div key={entry.key}>
                          <button
                            type="button"
                            onClick={() => toggleRow(entry.key)}
                            className="flex w-full items-center gap-2 px-5 py-2 text-left text-[12px] hover:bg-neutral-50 dark:hover:bg-neutral-900"
                          >
                            <span className={cn(
                              "inline-block h-2 w-2 shrink-0 rotate-0 border-y-[4px] border-l-[5px] border-y-transparent border-l-neutral-400 transition-transform",
                              expanded && "rotate-90",
                            )} />
                            <span className="font-mono text-[11px] text-neutral-500">{entry.key}</span>
                            <span className="truncate font-medium text-neutral-900 dark:text-neutral-100">{title}</span>
                            {presenceBadge}
                            {entry.changedCount > 0 && (
                              <span className="ml-auto rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-700 dark:bg-amber-950 dark:text-amber-300">
                                {entry.changedCount} 处变更
                              </span>
                            )}
                            {entry.changedCount === 0 && entry.presence === "both" && (
                              <span className="ml-auto text-[10px] text-neutral-400">无变化</span>
                            )}
                          </button>
                          {expanded && (
                            <div className="bg-neutral-50/60 px-5 pb-3 pt-1 dark:bg-neutral-950/40">
                              {fieldsToShow.length === 0 ? (
                                <div className="py-3 text-center text-[11.5px] text-neutral-400">无差异</div>
                              ) : (
                                <table className="w-full text-[12px]">
                                  <thead className="text-left text-[10.5px] font-medium uppercase tracking-[0.1em] text-neutral-500">
                                    <tr>
                                      <th className="w-[24%] py-1.5 pr-3 font-medium">字段</th>
                                      <th className="w-[38%] py-1.5 pr-3 font-medium">左</th>
                                      <th className="w-[38%] py-1.5 font-medium">右</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {fieldsToShow.map((f) => (
                                      <tr key={f.field} className={cn(
                                        "border-t border-neutral-100 align-top dark:border-neutral-900",
                                        f.changed && "bg-amber-50/40 dark:bg-amber-950/10",
                                      )}>
                                        <td className="py-1.5 pr-3 font-mono text-[11px] text-neutral-700 dark:text-neutral-300">{f.field}</td>
                                        <td className={cn("py-1.5 pr-3 break-words", f.changed && "text-rose-700 dark:text-rose-300")}>{f.left || <span className="text-neutral-300">∅</span>}</td>
                                        <td className={cn("py-1.5 break-words", f.changed && "text-emerald-700 dark:text-emerald-300")}>{f.right || <span className="text-neutral-300">∅</span>}</td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/* ── Confirm Dialog ── */

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  message: string;
  confirmText?: string;
  destructive?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  busy?: boolean;
}

function ConfirmDialog({ open, title, message, confirmText = "确认", destructive, onConfirm, onCancel, busy }: ConfirmDialogProps) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onCancel(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onCancel]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/30 dark:bg-black/60" onClick={onCancel}>
      <div className="w-full max-w-sm rounded-xl bg-white p-5 shadow-2xl dark:bg-neutral-900" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-[14px] font-semibold text-neutral-900 dark:text-neutral-100">{title}</h3>
        <p className="mt-2 text-[12.5px] leading-relaxed text-neutral-600 dark:text-neutral-300">{message}</p>
        <div className="mt-5 flex justify-end gap-2">
          <button
            onClick={onCancel}
            disabled={busy}
            className="rounded-md border border-neutral-200 bg-white px-3 py-1.5 text-[12px] font-medium text-neutral-700 hover:bg-neutral-50 disabled:opacity-50 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-200 dark:hover:bg-neutral-700"
          >
            取消
          </button>
          <button
            onClick={onConfirm}
            disabled={busy}
            className={cn(
              "rounded-md px-3 py-1.5 text-[12px] font-medium text-white disabled:opacity-50",
              destructive ? "bg-red-600 hover:bg-red-700" : "bg-neutral-900 hover:bg-neutral-800 dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-neutral-200",
            )}
          >
            {busy ? "处理中…" : confirmText}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ── Bulk Cleanup Dialog ── */

interface BulkCleanupDialogProps {
  open: boolean;
  onClose: () => void;
  onDone: (deleted: number, includeSuccess: boolean) => void;
}

function BulkCleanupDialog({ open, onClose, onDone }: BulkCleanupDialogProps) {
  const [days, setDays] = useState(7);
  const [includeSuccess, setIncludeSuccess] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) { setError(null); setBusy(false); setDays(7); setIncludeSuccess(false); }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape" && !busy) onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, busy, onClose]);

  if (!open) return null;

  const handleConfirm = () => {
    if (!Number.isFinite(days) || days <= 0) { setError("请输入正整数"); return; }
    setBusy(true);
    setError(null);
    api.deleteModelLabRunsBefore(days, !includeSuccess)
      .then((r) => { onDone(r.deleted, includeSuccess); onClose(); })
      .catch((err: unknown) => { setError(String(err)); })
      .finally(() => setBusy(false));
  };

  const targetLabel = includeSuccess ? "全部" : "失败";

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/30 dark:bg-black/60" onClick={() => !busy && onClose()}>
      <div className="w-full max-w-sm rounded-xl bg-white p-5 shadow-2xl dark:bg-neutral-900" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-[14px] font-semibold text-neutral-900 dark:text-neutral-100">
          批量清理{includeSuccess ? "运行记录" : "失败记录"}
        </h3>
        <p className="mt-2 text-[12.5px] leading-relaxed text-neutral-600 dark:text-neutral-300">
          {includeSuccess
            ? "删除所有创建时间早于以下天数的运行记录，包括成功记录。此操作不可撤销。"
            : "删除所有状态为「失败」且创建时间早于以下天数的运行记录。成功记录不会被删除。"}
        </p>
        <div className="mt-4 flex items-center gap-2">
          <span className="text-[12.5px] text-neutral-700 dark:text-neutral-200">删除超过</span>
          <input
            type="number"
            min={1}
            value={days}
            onChange={(e) => setDays(Number(e.target.value))}
            disabled={busy}
            className="h-7 w-20 rounded-md border border-neutral-200 bg-white px-2 text-[12.5px] focus:border-neutral-400 focus:outline-none dark:border-neutral-700 dark:bg-neutral-800"
          />
          <span className="text-[12.5px] text-neutral-700 dark:text-neutral-200">天前的{targetLabel}记录</span>
        </div>
        <label className={cn(
          "mt-3 flex items-start gap-2 rounded-md border px-3 py-2 text-[12px] transition-colors",
          includeSuccess
            ? "border-red-300 bg-red-50 dark:border-red-900 dark:bg-red-950/40"
            : "border-neutral-200 bg-neutral-50 dark:border-neutral-800 dark:bg-neutral-900",
        )}>
          <input
            type="checkbox"
            checked={includeSuccess}
            onChange={(e) => setIncludeSuccess(e.target.checked)}
            disabled={busy}
            className="mt-0.5 h-3.5 w-3.5 accent-red-600"
          />
          <span className={cn(
            "leading-relaxed",
            includeSuccess
              ? "text-red-700 dark:text-red-300"
              : "text-neutral-600 dark:text-neutral-400",
          )}>
            <span className="font-medium">同时清理成功记录</span>
            <span className="ml-1 text-[11px] opacity-80">（不可撤销 · 成功记录承载历史价值，请慎重）</span>
          </span>
        </label>
        {error && (
          <div className="mt-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-[11.5px] text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
            {error}
          </div>
        )}
        <div className="mt-5 flex justify-end gap-2">
          <button
            onClick={onClose}
            disabled={busy}
            className="rounded-md border border-neutral-200 bg-white px-3 py-1.5 text-[12px] font-medium text-neutral-700 hover:bg-neutral-50 disabled:opacity-50 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-200 dark:hover:bg-neutral-700"
          >
            取消
          </button>
          <button
            onClick={handleConfirm}
            disabled={busy}
            className={cn(
              "rounded-md px-3 py-1.5 text-[12px] font-medium text-white disabled:opacity-50",
              includeSuccess ? "bg-red-700 hover:bg-red-800" : "bg-red-600 hover:bg-red-700",
            )}
          >
            {busy ? "清理中…" : (includeSuccess ? "确认清理全部" : "确认清理")}
          </button>
        </div>
      </div>
    </div>
  );
}

interface ModelRunHistoryDashboardProps {
  onRequestRestore?: (runId: string) => void;
}

export function ModelRunHistoryDashboard({ onRequestRestore }: ModelRunHistoryDashboardProps = {}) {
  const [stats, setStats] = useState<ModelLabStats | null>(null);
  const [recentRuns, setRecentRuns] = useState<ModelLabRunSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [modeFilter, setModeFilter] = useState<"all" | "prediction" | "operational">("all");
  const [statusFilter, setStatusFilter] = useState<"all" | "success" | "failed">("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [drawerRunId, setDrawerRunId] = useState<string | null>(null);
  const [diffState, setDiffState] = useState<{ leftId: string; rightId: string | null } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<{ id: string; modelId: string } | null>(null);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [busyDeleteId, setBusyDeleteId] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const fetchStats = () => {
    setLoading(true);
    setError(null);
    Promise.all([api.getModelLabStats(), api.listModelLabRuns(100)])
      .then(([statsData, runs]) => {
        setStats(statsData);
        setRecentRuns(runs);
      })
      .catch((err: unknown) => {
        setError(String(err));
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    fetchStats();
  }, []);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 2400);
    return () => clearTimeout(t);
  }, [toast]);

  const trendDataFilled = useMemo(() => {
    if (!stats) return [];
    const map = new Map(stats.dailyTrend.map((d) => [d.date, d.count]));
    const result: Array<{ date: string; count: number }> = [];
    const today = new Date();
    for (let i = 29; i >= 0; i--) {
      const d = new Date(today);
      d.setDate(today.getDate() - i);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
      result.push({ date: key.slice(5), count: map.get(key) ?? 0 });
    }
    return result;
  }, [stats]);

  const filteredRuns = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    return recentRuns.filter((row) => {
      if (statusFilter !== "all" && row.status !== statusFilter) return false;
      if (modeFilter !== "all" && modeOf(row.modelId) !== modeFilter) return false;
      if (query && !row.modelId.toLowerCase().includes(query) && !row.model.toLowerCase().includes(query)) return false;
      return true;
    });
  }, [recentRuns, modeFilter, statusFilter, searchQuery]);

  const filteredFailedIds = useMemo(
    () => filteredRuns.filter((r) => r.status === "failed").map((r) => r.id),
    [filteredRuns],
  );

  const hasFilters = modeFilter !== "all" || statusFilter !== "all" || searchQuery.trim().length > 0;
  const resetFilters = () => {
    setModeFilter("all");
    setStatusFilter("all");
    setSearchQuery("");
  };

  const handleExport = () => {
    if (filteredRuns.length === 0) { setToast("没有可导出的记录"); return; }
    exportRunsToCsv(filteredRuns);
    setToast(`已导出 ${filteredRuns.length} 条`);
  };

  const handleDelete = (id: string) => {
    setBusyDeleteId(id);
    api.deleteModelLabRun(id)
      .then(() => {
        setRecentRuns((rs) => rs.filter((r) => r.id !== id));
        if (drawerRunId === id) setDrawerRunId(null);
        if (diffState?.leftId === id || diffState?.rightId === id) setDiffState(null);
        setToast("已删除 1 条记录");
      })
      .catch((err: unknown) => setToast(`删除失败：${err}`))
      .finally(() => { setBusyDeleteId(null); setConfirmDelete(null); });
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto bg-neutral-50/70 dark:bg-neutral-950">
      <div className="border-b border-neutral-200 bg-white px-6 py-4 dark:border-neutral-800 dark:bg-neutral-900">
        <div className="flex items-center justify-between gap-4">
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-neutral-400">Model Lab</div>
            <h1 className="mt-1 text-[20px] font-semibold tracking-tight text-neutral-950 dark:text-neutral-50">
              运行历史
            </h1>
            <p className="mt-1 text-[12.5px] text-neutral-500 dark:text-neutral-400">
              28 个模型的调用统计与趋势 · 聚合指标仅含成功运行，最近运行包含失败
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setBulkOpen(true)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-neutral-200 bg-white px-3 py-1.5 text-[12px] font-medium text-neutral-700 transition-colors hover:bg-neutral-50 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-200 dark:hover:bg-neutral-700"
            >
              <Trash2 className="h-3.5 w-3.5" strokeWidth={2} />
              批量清理失败
            </button>
            <button
              onClick={fetchStats}
              disabled={loading}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-lg border border-neutral-200 bg-white px-3 py-1.5 text-[12px] font-medium text-neutral-700 transition-colors hover:bg-neutral-50",
                "dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-200 dark:hover:bg-neutral-700",
                loading && "opacity-50",
              )}
            >
              <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} strokeWidth={2} />
              刷新
            </button>
          </div>
        </div>
      </div>

      {error && (
        <div className="mx-6 mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-[12.5px] text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
          加载失败：{error}
        </div>
      )}

      {!stats && loading && (
        <div className="flex flex-1 items-center justify-center text-[13px] text-neutral-400">
          加载中…
        </div>
      )}

      {stats && (
        <div className="space-y-4 p-6">
          <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
            <KpiCard icon={Activity} label="总调用次数" value={formatNumber(stats.totalRuns)} />
            <KpiCard icon={TrendingUp} label="最近 7 天" value={formatNumber(stats.recentRuns7d)} />
            <KpiCard icon={Clock} label="平均耗时" value={formatDuration(stats.avgDurationMs)} />
            <KpiCard icon={Database} label="累计处理行数" value={formatNumber(stats.totalRowsProcessed)} />
          </div>

          <section className="rounded-xl border border-neutral-200 bg-white p-5 dark:border-neutral-800 dark:bg-neutral-900">
            <div className="mb-4 flex items-center gap-2">
              <TrendingUp className="h-4 w-4 text-neutral-500" strokeWidth={2} />
              <h2 className="text-[14px] font-semibold text-neutral-900 dark:text-neutral-100">
                调用趋势
              </h2>
              <span className="text-[11px] text-neutral-400">最近 30 天</span>
            </div>
            <TrendChart data={trendDataFilled} />
          </section>

          <section className="rounded-xl border border-neutral-200 bg-white p-5 dark:border-neutral-800 dark:bg-neutral-900">
            <div className="mb-4 flex items-center gap-2">
              <BarChart3 className="h-4 w-4 text-neutral-500" strokeWidth={2} />
              <h2 className="text-[14px] font-semibold text-neutral-900 dark:text-neutral-100">
                Top 10 高频模型
              </h2>
              <span className="text-[11px] text-neutral-400">按调用次数排序</span>
            </div>
            <TopModelsChart data={stats.topModels} />
          </section>

          <section className="rounded-xl border border-neutral-200 bg-white p-5 dark:border-neutral-800 dark:bg-neutral-900">
            <div className="mb-4 flex flex-wrap items-center gap-2">
              <ListOrdered className="h-4 w-4 text-neutral-500" strokeWidth={2} />
              <h2 className="text-[14px] font-semibold text-neutral-900 dark:text-neutral-100">
                最近运行
              </h2>
              <span className="text-[11px] text-neutral-400">
                {hasFilters
                  ? `${filteredRuns.length} / ${recentRuns.length} 条`
                  : `共 ${recentRuns.length} 条`}
                {onRequestRestore && " · 点击行恢复至实验室"}
              </span>
              <div className="ml-auto flex flex-wrap items-center gap-2">
                <div className="relative">
                  <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-neutral-400" strokeWidth={2} />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="搜索模型 id 或名称"
                    className="h-7 w-48 rounded-md border border-neutral-200 bg-white pl-7 pr-2 text-[12px] text-neutral-800 placeholder:text-neutral-400 focus:border-neutral-400 focus:outline-none dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-200 dark:placeholder:text-neutral-500"
                  />
                </div>
                <select
                  value={modeFilter}
                  onChange={(e) => setModeFilter(e.target.value as typeof modeFilter)}
                  className="h-7 rounded-md border border-neutral-200 bg-white px-2 text-[12px] text-neutral-800 focus:border-neutral-400 focus:outline-none dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-200"
                >
                  <option value="all">全部类型</option>
                  <option value="prediction">预测</option>
                  <option value="operational">运营</option>
                </select>
                <select
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value as typeof statusFilter)}
                  className="h-7 rounded-md border border-neutral-200 bg-white px-2 text-[12px] text-neutral-800 focus:border-neutral-400 focus:outline-none dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-200"
                >
                  <option value="all">全部状态</option>
                  <option value="success">成功</option>
                  <option value="failed">失败</option>
                </select>
                {hasFilters && (
                  <button
                    onClick={resetFilters}
                    className="inline-flex h-7 items-center gap-1 rounded-md border border-neutral-200 bg-white px-2 text-[11.5px] font-medium text-neutral-600 transition-colors hover:bg-neutral-50 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-300 dark:hover:bg-neutral-700"
                  >
                    <X className="h-3 w-3" strokeWidth={2} />
                    重置
                  </button>
                )}
                <button
                  onClick={handleExport}
                  title="按当前筛选条件导出 CSV"
                  className="inline-flex h-7 items-center gap-1 rounded-md border border-neutral-200 bg-white px-2 text-[11.5px] font-medium text-neutral-700 transition-colors hover:bg-neutral-50 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-200 dark:hover:bg-neutral-700"
                >
                  <Download className="h-3 w-3" strokeWidth={2} />
                  导出
                </button>
              </div>
            </div>
            <RecentRunsTable
              rows={filteredRuns}
              onRowClick={onRequestRestore}
              onFailureDetail={(id) => setDrawerRunId(id)}
              onDeleteRow={(id) => {
                const row = recentRuns.find((r) => r.id === id);
                setConfirmDelete({ id, modelId: row?.modelId ?? id });
              }}
              busyDeleteId={busyDeleteId}
              emptyHint={hasFilters ? "没有匹配当前筛选条件的记录" : undefined}
            />
          </section>
        </div>
      )}

      <RunDetailDrawer
        runId={drawerRunId}
        failedIds={filteredFailedIds}
        onClose={() => setDrawerRunId(null)}
        onSelectRun={(id) => setDrawerRunId(id)}
        onCompare={(id) => { setDrawerRunId(null); setDiffState({ leftId: id, rightId: null }); }}
      />

      {diffState && (
        <RunDiffView
          leftId={diffState.leftId}
          rightId={diffState.rightId}
          candidates={recentRuns}
          onPickRight={(id) => setDiffState((s) => s ? { ...s, rightId: id || null } : s)}
          onClose={() => setDiffState(null)}
        />
      )}

      <ConfirmDialog
        open={Boolean(confirmDelete)}
        title="删除失败记录"
        message={`确定删除运行 ${confirmDelete?.modelId ?? ""} 的失败记录吗？此操作不可撤销。`}
        confirmText="删除"
        destructive
        busy={busyDeleteId === confirmDelete?.id}
        onConfirm={() => confirmDelete && handleDelete(confirmDelete.id)}
        onCancel={() => setConfirmDelete(null)}
      />

      <BulkCleanupDialog
        open={bulkOpen}
        onClose={() => setBulkOpen(false)}
        onDone={(deleted, includeSuccess) => {
          const label = includeSuccess ? "条记录（含成功）" : "条失败记录";
          setToast(deleted > 0 ? `已清理 ${deleted} ${label}` : "无符合条件的记录");
          if (deleted > 0) fetchStats();
        }}
      />

      {toast && (
        <div className="fixed bottom-6 left-1/2 z-[70] -translate-x-1/2 rounded-lg bg-neutral-900 px-4 py-2 text-[12.5px] text-white shadow-lg dark:bg-neutral-100 dark:text-neutral-900">
          {toast}
        </div>
      )}
    </div>
  );
}
