import { useMemo, useState } from "react";
import { TrendingUp, Repeat2, Calendar, UsersRound, Database, Upload } from "lucide-react";
import { cn } from "@/lib/cn";
import { useBiDataset } from "@/lib/useBiDataset";
import { parseRecallRows, type RecallRow } from "@/lib/biDatasetParser";
import { BiImportDialog } from "@/components/BiImportDialog";

const PERIOD_LABELS = [
  "M-1", "M-2", "M-3", "M-4", "M-5", "M-6",
  "M-7", "M-8", "M-9", "M-10", "M-11", "M-12",
];

const MOCK_SEGMENTS: RecallRow[] = [
  { month: "2025-07", repurchaseUsers: 6240, recall: [0.318, 0.182, 0.112, 0.078, 0.058, 0.046, 0.038, 0.032, 0.028, 0.024, 0.021, 0.019] },
  { month: "2025-08", repurchaseUsers: 6580, recall: [0.325, 0.188, 0.118, 0.082, 0.061, 0.048, 0.040, 0.034, 0.029, 0.025, 0.022, null] },
  { month: "2025-09", repurchaseUsers: 7120, recall: [0.332, 0.195, 0.122, 0.085, 0.063, 0.050, 0.041, 0.035, 0.030, 0.026, null, null] },
  { month: "2025-10", repurchaseUsers: 6890, recall: [0.328, 0.190, 0.119, 0.083, 0.062, 0.049, 0.041, 0.035, 0.030, null, null, null] },
  { month: "2025-11", repurchaseUsers: 7480, recall: [0.341, 0.201, 0.126, 0.088, 0.065, 0.052, 0.043, 0.036, null, null, null, null] },
  { month: "2025-12", repurchaseUsers: 7250, recall: [0.336, 0.197, 0.123, 0.086, 0.064, 0.051, 0.042, null, null, null, null, null] },
  { month: "2026-01", repurchaseUsers: 7820, recall: [0.348, 0.208, 0.131, 0.092, 0.068, 0.054, null, null, null, null, null, null] },
  { month: "2026-02", repurchaseUsers: 6810, recall: [0.312, 0.178, 0.108, 0.074, 0.054, null, null, null, null, null, null, null] },
  { month: "2026-03", repurchaseUsers: 8240, recall: [0.362, 0.220, 0.140, 0.099, null, null, null, null, null, null, null, null] },
  { month: "2026-04", repurchaseUsers: 7960, recall: [0.354, 0.213, 0.135, null, null, null, null, null, null, null, null, null] },
  { month: "2026-05", repurchaseUsers: 7620, recall: [0.345, 0.205, null, null, null, null, null, null, null, null, null, null] },
  { month: "2026-06", repurchaseUsers: 8420, recall: [0.358, null, null, null, null, null, null, null, null, null, null, null] },
];

function rateColor(value: number | null): string {
  if (value == null) return "bg-neutral-50 text-neutral-300 dark:bg-neutral-900 dark:text-neutral-700";
  if (value >= 0.30) return "bg-emerald-600 text-white";
  if (value >= 0.20) return "bg-emerald-400 text-white";
  if (value >= 0.12) return "bg-emerald-200 text-emerald-900 dark:text-emerald-950";
  if (value >= 0.07) return "bg-amber-200 text-amber-900 dark:text-amber-950";
  if (value >= 0.04) return "bg-orange-200 text-orange-900 dark:text-orange-950";
  return "bg-red-200 text-red-900 dark:text-red-950";
}

function formatPercent(value: number | null): string {
  if (value == null) return "—";
  return `${(value * 100).toFixed(1)}%`;
}

function formatCount(value: number | null): string {
  if (value == null) return "—";
  return Math.round(value).toLocaleString();
}

export function OldMemberRecallPane() {
  const [showAbsolute, setShowAbsolute] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);

  const { dataset, history, importing, importFile, switchTo, remove } = useBiDataset("member_recall");

  const parsed = useMemo(() => {
    if (!dataset) return null;
    try {
      return parseRecallRows(dataset);
    } catch {
      return null;
    }
  }, [dataset]);

  const isRealData = !!dataset && !!parsed && parsed.rows.length > 0;
  const segments: RecallRow[] = isRealData && parsed ? parsed.rows : MOCK_SEGMENTS;
  const periodLabels = isRealData && parsed && parsed.periodLabels.length > 0
    ? parsed.periodLabels
    : PERIOD_LABELS;

  const visiblePeriods = periodLabels.length;
  const visibleLabels = periodLabels;

  const kpis = useMemo(() => {
    const totalRepurchase = segments.reduce((s, r) => s + r.repurchaseUsers, 0);
    const m1Values = segments.map((r) => r.recall[0]).filter((v): v is number => v != null);
    const avgM1 = m1Values.length ? m1Values.reduce((s, v) => s + v, 0) / m1Values.length : 0;
    const m3Values = segments.map((r) => r.recall[2]).filter((v): v is number => v != null);
    const avgM3 = m3Values.length ? m3Values.reduce((s, v) => s + v, 0) / m3Values.length : 0;
    const m12Values = segments.map((r) => r.recall[11]).filter((v): v is number => v != null);
    const avgM12 = m12Values.length ? m12Values.reduce((s, v) => s + v, 0) / m12Values.length : 0;
    return { totalRepurchase, avgM1, avgM3, avgM12, monthCount: segments.length };
  }, [segments]);

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
                Recall Lookback
              </span>
              <span className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium", dataSourceColor)}>
                <Database className="h-3 w-3" strokeWidth={1.75} />
                {dataSourceLabel}
              </span>
            </div>
            <h1 className="mt-2 text-[24px] font-semibold tracking-tight text-neutral-950 dark:text-neutral-50">
              会员老客复购召回表
            </h1>
            <p className="mt-1 text-[13px] text-neutral-500 dark:text-neutral-400">
              按当月分群回看 M-1 ~ M-12 月老客的复购来源占比。
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
          <KpiCard icon={UsersRound} label="总回购老客" value={kpis.totalRepurchase.toLocaleString()} sub={`${kpis.monthCount} 个统计月`} tone="neutral" />
          <KpiCard icon={Repeat2} label="M-1 平均占比" value={formatPercent(kpis.avgM1)} sub="上月复购" tone="success" />
          <KpiCard icon={TrendingUp} label="M-3 平均占比" value={formatPercent(kpis.avgM3)} sub="季度复购" tone="warning" />
          <KpiCard icon={Calendar} label="M-12 平均占比" value={formatPercent(kpis.avgM12)} sub="年度召回" tone="danger" />
        </div>

        {/* recall matrix */}
        <div className="overflow-hidden rounded-2xl border border-neutral-200 bg-white shadow-sm dark:border-neutral-800 dark:bg-neutral-900">
          <div className="flex items-center justify-between border-b border-neutral-200 px-5 py-3 dark:border-neutral-800">
            <h2 className="text-[14px] font-semibold text-neutral-900 dark:text-neutral-100">{showAbsolute ? "召回来源矩阵 · 人数" : "召回来源矩阵 · 占比"}</h2>
            <div className="flex items-center gap-3 text-[11px] text-neutral-500 dark:text-neutral-400">
              <LegendItem color="bg-red-200" label="< 4%" />
              <LegendItem color="bg-amber-200" label="7-12%" />
              <LegendItem color="bg-emerald-200" label="12-20%" />
              <LegendItem color="bg-emerald-600" label=">= 30%" />
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-[12.5px]">
              <thead className="bg-neutral-50 text-[11.5px] uppercase tracking-wider text-neutral-500 dark:bg-neutral-950/50 dark:text-neutral-400">
                <tr>
                  <th className="sticky left-0 z-10 bg-neutral-50 px-4 py-2.5 text-left font-medium dark:bg-neutral-950/50">
                    当月
                  </th>
                  <th className="px-3 py-2.5 text-right font-medium">总回购老客</th>
                  {visibleLabels.map((label) => (
                    <th key={label} className="px-3 py-2.5 text-center font-medium">{label}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {segments.map((row) => (
                  <tr key={row.month} className="border-t border-neutral-100 dark:border-neutral-800">
                    <td className="sticky left-0 bg-white px-4 py-2.5 font-medium text-neutral-800 dark:bg-neutral-900 dark:text-neutral-200">
                      {row.month}
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-neutral-700 dark:text-neutral-300">
                      {row.repurchaseUsers.toLocaleString()}
                    </td>
                    {row.recall.slice(0, visiblePeriods).map((value, idx) => {
                      const displayValue = showAbsolute && value != null
                        ? Math.round(row.repurchaseUsers * value)
                        : value;
                      return (
                        <td key={idx} className="px-1.5 py-1.5">
                          <div className={cn("flex h-9 items-center justify-center rounded-md text-[12px] font-medium tabular-nums", rateColor(value))}>
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
              "M-1 占比稳定在 32%-36%，表明月复购是老客复购最主要的来源",
              "M-2 ~ M-3 占比递减但仍超过 10%，是度过“静默期”的关键窗口",
              "M-6 以后占比快速衰减至 5% 以下，需依靠召回动作才能重启",
            ]}
          />
          <InsightCard
            title="行动建议"
            tone="action"
            items={[
              "M-1 老客是高忠诚群体，优先推高客单价产品与会员权益",
              "M-2 ~ M-6 是主战场，需设计差异化优惠券防着距离加深",
              "M-6 后不均衡召回当月交互备份，带动重财权益提醒复购",
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

/* ---- subcomponents ---- */
interface KpiCardProps {
  icon: typeof UsersRound;
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
