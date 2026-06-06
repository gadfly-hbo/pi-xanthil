import { useMemo, useState } from "react";
import { TrendingUp, Users, Repeat2, Calendar, Database, Upload } from "lucide-react";
import { cn } from "@/lib/cn";
import { useBiDataset } from "@/lib/useBiDataset";
import { parseRetentionRows, type RetentionRow } from "@/lib/biDatasetParser";
import { BiImportDialog } from "@/components/BiImportDialog";

const PERIOD_LABELS = [
  "M+1", "M+2", "M+3", "M+4", "M+5", "M+6",
  "M+7", "M+8", "M+9", "M+10", "M+11", "M+12",
];

const MOCK_COHORTS: RetentionRow[] = [
  { cohort: "2025-07", newUsers: 4512, retention: [0.371, 0.234, 0.161, 0.118, 0.092, 0.078, 0.068, 0.061, 0.055, 0.050, 0.046, 0.043] },
  { cohort: "2025-08", newUsers: 4687, retention: [0.385, 0.243, 0.169, 0.124, 0.097, 0.081, 0.071, 0.063, 0.057, 0.052, 0.048, null] },
  { cohort: "2025-09", newUsers: 5021, retention: [0.392, 0.251, 0.174, 0.128, 0.101, 0.084, 0.073, 0.065, 0.058, 0.053, null, null] },
  { cohort: "2025-10", newUsers: 4893, retention: [0.376, 0.238, 0.165, 0.121, 0.095, 0.079, 0.069, 0.062, 0.056, null, null, null] },
  { cohort: "2025-11", newUsers: 5248, retention: [0.398, 0.255, 0.177, 0.130, 0.103, 0.086, 0.075, 0.067, null, null, null, null] },
  { cohort: "2025-12", newUsers: 4820, retention: [0.382, 0.241, 0.168, 0.124, 0.098, 0.082, 0.071, null, null, null, null, null] },
  { cohort: "2026-01", newUsers: 5634, retention: [0.401, 0.258, 0.179, 0.131, 0.104, 0.087, null, null, null, null, null, null] },
  { cohort: "2026-02", newUsers: 4218, retention: [0.358, 0.221, 0.152, 0.108, 0.082, null, null, null, null, null, null, null] },
  { cohort: "2026-03", newUsers: 6102, retention: [0.412, 0.272, 0.191, 0.142, null, null, null, null, null, null, null, null] },
  { cohort: "2026-04", newUsers: 5847, retention: [0.395, 0.249, 0.173, null, null, null, null, null, null, null, null, null] },
  { cohort: "2026-05", newUsers: 5391, retention: [0.378, 0.240, null, null, null, null, null, null, null, null, null, null] },
  { cohort: "2026-06", newUsers: 4956, retention: [null, null, null, null, null, null, null, null, null, null, null, null] },
];

function retentionColor(value: number | null): string {
  if (value == null) return "bg-neutral-50 text-neutral-300 dark:bg-neutral-900 dark:text-neutral-700";
  if (value >= 0.35) return "bg-emerald-600 text-white";
  if (value >= 0.25) return "bg-emerald-400 text-white";
  if (value >= 0.18) return "bg-emerald-200 text-emerald-900 dark:text-emerald-950";
  if (value >= 0.12) return "bg-amber-200 text-amber-900 dark:text-amber-950";
  if (value >= 0.08) return "bg-orange-200 text-orange-900 dark:text-orange-950";
  return "bg-red-200 text-red-900 dark:text-red-950";
}

function formatPercent(value: number | null): string {
  if (value == null) return "\u2014";
  return `${(value * 100).toFixed(1)}%`;
}

function formatCount(value: number | null): string {
  if (value == null) return "\u2014";
  return Math.round(value).toLocaleString();
}

export function NewMemberRetentionPane() {
  const [showAbsolute, setShowAbsolute] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);

  const {
    dataset,
    history,
    importing,
    importFile,
    switchTo,
    remove,
  } = useBiDataset("member_retention");

  const parsed = useMemo(() => {
    if (!dataset) return null;
    try {
      return parseRetentionRows(dataset);
    } catch {
      return null;
    }
  }, [dataset]);

  const isRealData = !!dataset;
  const cohorts = isRealData && parsed ? parsed.rows : MOCK_COHORTS;
  const periodLabels = isRealData && parsed ? parsed.periodLabels : PERIOD_LABELS;

  const visiblePeriods = periodLabels.length;
  const visibleLabels = periodLabels;

  const kpis = useMemo(() => {
    const totalNewUsers = cohorts.reduce((sum, row) => sum + row.newUsers, 0);
    const m1Values = cohorts.map((row) => row.retention[0]).filter((v): v is number => v != null);
    const avgM1 = m1Values.length ? m1Values.reduce((s, v) => s + v, 0) / m1Values.length : 0;
    const m3Values = cohorts.map((row) => row.retention[2]).filter((v): v is number => v != null);
    const avgM3 = m3Values.length ? m3Values.reduce((s, v) => s + v, 0) / m3Values.length : 0;
    const m6Values = cohorts.map((row) => row.retention[5]).filter((v): v is number => v != null);
    const avgM6 = m6Values.length ? m6Values.reduce((s, v) => s + v, 0) / m6Values.length : 0;
    return { totalNewUsers, avgM1, avgM3, avgM6, cohortCount: cohorts.length };
  }, [cohorts]);

  const dataSourceLabel = isRealData ? dataset?.filename ?? "已导入数据" : "模拟数据";
  const dataSourceColor = isRealData
    ? "bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300"
    : "bg-neutral-100 text-neutral-500 dark:bg-neutral-800 dark:text-neutral-400";

  return (
    <div className="p-6 lg:p-8">
      <div className="mx-auto max-w-6xl">
        {/* header */}
        <div className="mb-6 flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div>
            <div className="flex items-center gap-2">
              <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-neutral-400">
                Retention Cohort
              </span>
              <span className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium", dataSourceColor)}>
                <Database className="h-3 w-3" strokeWidth={1.75} />
                {dataSourceLabel}
              </span>
            </div>
            <h1 className="mt-2 text-[24px] font-semibold tracking-tight text-neutral-950 dark:text-neutral-50">
              {isRealData ? "会员新客复购留存表" : "会员新客复购留存表"}
            </h1>
            <p className="mt-1 text-[13px] text-neutral-500 dark:text-neutral-400">
              按首单月份分群追踪新客后续 M+1 ~ M+12 的复购留存表现。
            </p>
          </div>
          <div className="flex items-center gap-2">
            <div className="inline-flex rounded-lg border border-neutral-200 bg-white p-0.5 dark:border-neutral-800 dark:bg-neutral-900">
              <button
                onClick={() => setShowAbsolute(false)}
                className={cn(
                  "rounded-md px-3 py-1.5 text-[12px] transition-colors",
                  !showAbsolute
                    ? "bg-neutral-900 text-white dark:bg-neutral-100 dark:text-neutral-900"
                    : "text-neutral-500 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-neutral-100",
                )}
              >
                占比
              </button>
              <button
                onClick={() => setShowAbsolute(true)}
                className={cn(
                  "rounded-md px-3 py-1.5 text-[12px] transition-colors",
                  showAbsolute
                    ? "bg-neutral-900 text-white dark:bg-neutral-100 dark:text-neutral-900"
                    : "text-neutral-500 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-neutral-100",
                )}
              >
                人数
              </button>
            </div>
            <button
              onClick={() => setDialogOpen(true)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-neutral-200 bg-white px-3 py-1.5 text-[12px] text-neutral-700 hover:bg-neutral-50 dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-300 dark:hover:bg-neutral-800"
            >
              <Upload className="h-3.5 w-3.5" strokeWidth={1.75} />
              导入数据
            </button>
          </div>
        </div>

        {/* KPI cards */}
        <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4">
          <KpiCard icon={Users} label="新客总数" value={kpis.totalNewUsers.toLocaleString()} sub={`${kpis.cohortCount} 个 cohort`} tone="neutral" />
          <KpiCard icon={Repeat2} label="M+1 平均复购率" value={formatPercent(kpis.avgM1)} sub="首月复购" tone="success" />
          <KpiCard icon={TrendingUp} label="M+3 平均留存" value={formatPercent(kpis.avgM3)} sub="3 月内复购" tone="warning" />
          <KpiCard icon={Calendar} label="M+6 平均留存" value={formatPercent(kpis.avgM6)} sub="长期留存" tone="danger" />
        </div>

        {/* cohort table */}
        <div className="overflow-hidden rounded-2xl border border-neutral-200 bg-white shadow-sm dark:border-neutral-800 dark:bg-neutral-900">
          <div className="flex items-center justify-between border-b border-neutral-200 px-5 py-3 dark:border-neutral-800">
            <h2 className="text-[14px] font-semibold text-neutral-900 dark:text-neutral-100">{showAbsolute ? "复购留存矩阵 · 人数" : "复购留存矩阵 · 占比"}</h2>
            <div className="flex items-center gap-3 text-[11px] text-neutral-500 dark:text-neutral-400">
              <LegendItem color="bg-red-200" label="< 8%" />
              <LegendItem color="bg-amber-200" label="12-18%" />
              <LegendItem color="bg-emerald-200" label="18-25%" />
              <LegendItem color="bg-emerald-600" label=">= 35%" />
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-[12.5px]">
              <thead className="bg-neutral-50 text-[11.5px] uppercase tracking-wider text-neutral-500 dark:bg-neutral-950/50 dark:text-neutral-400">
                <tr>
                  <th className="sticky left-0 z-10 bg-neutral-50 px-4 py-2.5 text-left font-medium dark:bg-neutral-950/50">
                    首单月份
                  </th>
                  <th className="px-3 py-2.5 text-right font-medium">新客数</th>
                  {visibleLabels.map((label) => (
                    <th key={label} className="px-3 py-2.5 text-center font-medium">{label}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {cohorts.map((row) => (
                  <tr key={row.cohort} className="border-t border-neutral-100 dark:border-neutral-800">
                    <td className="sticky left-0 bg-white px-4 py-2.5 font-medium text-neutral-800 dark:bg-neutral-900 dark:text-neutral-200">
                      {row.cohort}
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-neutral-700 dark:text-neutral-300">
                      {row.newUsers.toLocaleString()}
                    </td>
                    {row.retention.slice(0, visiblePeriods).map((value, idx) => {
                      const displayValue = showAbsolute && value != null
                        ? Math.round(row.newUsers * value)
                        : value;
                      return (
                        <td key={idx} className="px-1.5 py-1.5">
                          <div className={cn("flex h-9 items-center justify-center rounded-md text-[12px] font-medium tabular-nums", retentionColor(value))}>
                            {showAbsolute ? formatCount(displayValue as number | null) : formatPercent(displayValue as number | null)}
                          </div>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* insights */}
        <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-2">
          <InsightCard
            title="关键洞察"
            items={[
              "2026-03 cohort 首月复购达 41.2%，环比上升 5.4pp，与该月新人券改版同步",
              "2026-02 cohort 表现最差，M+1 仅 35.8%，需复盘获客渠道质量",
              "整体 M+6 留存稳定在 8% 左右，长期复购漏斗仍有提升空间",
            ]}
          />
          <InsightCard
            title="行动建议"
            tone="action"
            items={[
              "复制 2026-03 cohort 的新人权益设计到后续月份",
              "对 2026-02 cohort 的沉默用户启动定向召回（参考老客召回看板）",
              "在 M+2 ~ M+3 节点加注高频复购品类的种草内容",
            ]}
          />
        </div>

        <div className="mt-4 text-[11px] text-neutral-400 dark:text-neutral-500">
          {isRealData ? "* 数据来源: 已导入文件" : "* 当前数据为示意 mock，可点击「导入数据」上传真实数据"}
        </div>
      </div>

      <BiImportDialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        onImport={importFile}
        onSwitch={switchTo}
        onDelete={remove}
        currentId={dataset?.id}
        history={history}
        importing={importing}
      />
    </div>
  );
}

/* ---- subcomponents (unchanged) ---- */
interface KpiCardProps {
  icon: typeof Users;
  label: string;
  value: string;
  sub: string;
  tone: "neutral" | "success" | "warning" | "danger";
}
function KpiCard({ icon: Icon, label, value, sub, tone }: KpiCardProps) {
  const toneClasses = {
    neutral: "bg-neutral-100 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300",
    success: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300",
    warning: "bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300",
    danger: "bg-red-100 text-red-700 dark:bg-red-950/40 dark:text-red-300",
  }[tone];
  return (
    <div className="rounded-xl border border-neutral-200 bg-white p-4 shadow-sm dark:border-neutral-800 dark:bg-neutral-900">
      <div className="flex items-center gap-2">
        <div className={cn("flex h-7 w-7 items-center justify-center rounded-md", toneClasses)}>
          <Icon className="h-4 w-4" strokeWidth={1.75} />
        </div>
        <span className="text-[11.5px] text-neutral-500 dark:text-neutral-400">{label}</span>
      </div>
      <div className="mt-2 text-[20px] font-semibold tabular-nums text-neutral-950 dark:text-neutral-50">{value}</div>
      <div className="mt-0.5 text-[11px] text-neutral-400 dark:text-neutral-500">{sub}</div>
    </div>
  );
}
function LegendItem({ color, label }: { color: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1">
      <span className={cn("inline-block h-2.5 w-2.5 rounded-sm", color)} />
      {label}
    </span>
  );
}
interface InsightCardProps { title: string; items: string[]; tone?: "default" | "action"; }
function InsightCard({ title, items, tone = "default" }: InsightCardProps) {
  return (
    <div className="rounded-xl border border-neutral-200 bg-white p-5 shadow-sm dark:border-neutral-800 dark:bg-neutral-900">
      <h3 className="mb-3 text-[13px] font-semibold text-neutral-900 dark:text-neutral-100">{title}</h3>
      <ul className="space-y-2">
        {items.map((item, idx) => (
          <li key={idx} className="flex items-start gap-2 text-[12.5px] leading-5 text-neutral-600 dark:text-neutral-400">
            <span className={cn("mt-1.5 inline-block h-1.5 w-1.5 shrink-0 rounded-full", tone === "action" ? "bg-emerald-500" : "bg-neutral-400")} />
            <span>{item}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
