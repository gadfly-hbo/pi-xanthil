import { useCallback, useEffect, useMemo, useState } from "react";
import { Loader2, RefreshCw, ShieldAlert, ShieldCheck, ShieldQuestion } from "lucide-react";
import { api } from "@/lib/api";
import { SummaryTable } from "@/components/eval-shared";
import type { LabKind, LabTimeline, LabTimelinePoint, RegressionGateVerdict } from "@/types";

const LAB_LABELS: Record<LabKind, string> = {
  skill: "skill",
  tool: "tool",
  prompt: "prompt",
  command: "command",
  subagent: "subagent",
  hook: "hook",
};

function pct(value: number | null): string {
  return value === null ? "-" : `${(value * 100).toFixed(1)}%`;
}

// ponytail: 内联 SVG sparkline，不引 ECharts；趋势打磨可派 D 升级为折线图。
function Sparkline({ points }: { points: LabTimelinePoint[] }) {
  const values = points.map((p) => p.score).filter((v): v is number => v !== null);
  if (values.length < 2) return <span className="text-neutral-400">—</span>;
  const w = 80;
  const h = 20;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const step = w / (values.length - 1);
  const d = values
    .map((v, i) => `${i === 0 ? "M" : "L"}${(i * step).toFixed(1)},${(h - ((v - min) / span) * h).toFixed(1)}`)
    .join(" ");
  const last = values[values.length - 1]!;
  const first = values[0]!;
  const stroke = last < first ? "#dc2626" : last > first ? "#059669" : "#737373";
  return (
    <svg width={w} height={h} className="overflow-visible">
      <path d={d} fill="none" stroke={stroke} strokeWidth={1.5} />
    </svg>
  );
}

function GateBadge({ verdict }: { verdict: RegressionGateVerdict | undefined }) {
  if (!verdict) return <span className="text-neutral-400">—</span>;
  if (verdict.decision === "regression") {
    return (
      <span className="inline-flex items-center gap-1 text-red-600" title={verdict.reason ?? ""}>
        <ShieldAlert className="h-3.5 w-3.5" />回归
      </span>
    );
  }
  if (verdict.decision === "insufficient_data") {
    return (
      <span className="inline-flex items-center gap-1 text-neutral-500" title={verdict.reason ?? ""}>
        <ShieldQuestion className="h-3.5 w-3.5" />数据不足
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 text-emerald-600">
      <ShieldCheck className="h-3.5 w-3.5" />通过
    </span>
  );
}

interface Row {
  key: string;
  lab: LabKind;
  resourceId: string;
  timeline: LabTimeline;
  latest: LabTimelinePoint | null;
  verdict: RegressionGateVerdict | undefined;
}

export function RegressionDashboardPane({ workspaceId }: { workspaceId: string | null }) {
  const [timelines, setTimelines] = useState<LabTimeline[]>([]);
  const [verdicts, setVerdicts] = useState<Record<string, RegressionGateVerdict>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!workspaceId) return;
    setLoading(true);
    setError(null);
    try {
      const data = await api.listLabTimelines(workspaceId);
      setTimelines(data);
      // 对有 >=2 个点的资源逐个判门禁
      const targets = data.filter((t) => t.points.length >= 2);
      const results = await Promise.all(
        targets.map((t) =>
          api.evaluateLabRegressionGate(workspaceId, { lab: t.lab, resourceId: t.resourceId }),
        ),
      );
      const map: Record<string, RegressionGateVerdict> = {};
      targets.forEach((t, i) => {
        map[`${t.lab}::${t.resourceId}`] = results[i]!;
      });
      setVerdicts(map);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setLoading(false);
    }
  }, [workspaceId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const rows = useMemo<Row[]>(
    () =>
      timelines.map((t) => {
        const key = `${t.lab}::${t.resourceId}`;
        return {
          key,
          lab: t.lab,
          resourceId: t.resourceId,
          timeline: t,
          latest: t.points.length > 0 ? t.points[t.points.length - 1]! : null,
          verdict: verdicts[key],
        };
      }),
    [timelines, verdicts],
  );

  if (!workspaceId) return <div className="p-6 text-sm text-muted-foreground">请先选择工作区。</div>;

  const regressions = rows.filter((r) => r.verdict?.decision === "regression").length;

  return (
    <main className="min-w-0 flex-1 overflow-y-auto p-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-base font-semibold">跨 lab 回归看板</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            六类评测历史汇成回归时间线；门禁判定 pass/regression（对齐 candidate→active 升级口径）。只读聚合，不触发评测。
          </p>
        </div>
        <button
          type="button"
          onClick={() => void refresh()}
          disabled={loading}
          className="inline-flex h-8 items-center gap-1 rounded-md border border-border px-2 text-xs disabled:opacity-40"
        >
          {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}刷新
        </button>
      </div>
      {regressions > 0 && (
        <div className="mt-4 inline-flex items-center gap-2 rounded-md border border-red-300 bg-red-50 px-3 py-2 text-xs text-red-700">
          <ShieldAlert className="h-4 w-4" />检测到 {regressions} 个资源出现回归
        </div>
      )}
      {error && (
        <div className="mt-4 rounded border border-red-300 bg-red-50 p-3 text-xs text-red-700">加载失败：{error}</div>
      )}
      <SummaryTable
        rows={rows}
        rowKey={(row) => row.key}
        emptyText={loading ? "加载中…" : "暂无评测历史。"}
        columns={[
          { key: "lab", label: "Lab", className: "font-medium", render: (row) => LAB_LABELS[row.lab] },
          { key: "resource", label: "资源", render: (row) => <span className="font-mono text-[11px]">{row.resourceId}</span> },
          { key: "runs", label: "运行数", render: (row) => row.timeline.points.length },
          { key: "trend", label: "score 趋势", render: (row) => <Sparkline points={row.timeline.points} /> },
          { key: "score", label: "最新 score", render: (row) => pct(row.latest?.score ?? null) },
          { key: "pass", label: "通过率", render: (row) => pct(row.latest?.passRate ?? null) },
          { key: "win", label: "胜率", render: (row) => pct(row.latest?.winRate ?? null) },
          { key: "act", label: "激活率", render: (row) => pct(row.latest?.activationRate ?? null) },
          { key: "gate", label: "门禁", render: (row) => <GateBadge verdict={row.verdict} /> },
        ]}
      />
    </main>
  );
}
