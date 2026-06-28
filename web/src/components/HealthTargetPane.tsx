import { useState, useMemo } from "react";
import type { SubTab } from "@/lib/constants";
import type {
  TargetScenarioKind,
  TargetMetricKind,
  TargetCase,
  TargetAssumptions,
  TargetCalculationInput,
  TargetCaseResult,
} from "@/types";
import { calculateTarget } from "@/lib/monitor-target-calculator";
import { vizApi } from "@/lib/api/viz";
import { Markdown } from "@/components/Markdown";
import { cn } from "@/lib/cn";
import readmeContent from "@/docs/health-target-readme.md?raw";

const SCENARIOS: { id: TargetScenarioKind; label: string }[] = [
  { id: "yearly_kpi", label: "全年 KPI" },
  { id: "campaign", label: "大促活动" },
  { id: "rolling_monthly", label: "月度滚动目标" },
];

const METRICS: { id: TargetMetricKind; label: string; unit: string }[] = [
  { id: "gmv", label: "GMV", unit: "元" },
  { id: "revenue", label: "销售额", unit: "元" },
  { id: "gross_profit", label: "毛利", unit: "元" },
  { id: "profit", label: "利润", unit: "元" },
  { id: "orders", label: "订单量", unit: "单" },
];

const CASE_LABELS: Record<TargetCase, string> = {
  conservative: "保守",
  baseline: "基准",
  stretch: "冲刺",
};

const CASE_COLORS: Record<TargetCase, string> = {
  conservative: "border-blue-300 bg-blue-50 dark:border-blue-800 dark:bg-blue-950/30",
  baseline: "border-neutral-300 bg-neutral-50 dark:border-neutral-700 dark:bg-neutral-900/50",
  stretch: "border-rose-300 bg-rose-50 dark:border-rose-800 dark:bg-rose-950/30",
};

const CASE_BADGE: Record<TargetCase, string> = {
  conservative: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300",
  baseline: "bg-neutral-200 text-neutral-700 dark:bg-neutral-700 dark:text-neutral-200",
  stretch: "bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300",
};

function fmtNum(v: number | null | undefined): string {
  if (v === null || v === undefined || !isFinite(v)) return "—";
  if (Math.abs(v) >= 1e8) return (v / 1e8).toFixed(2) + "亿";
  if (Math.abs(v) >= 1e4) return (v / 1e4).toFixed(2) + "万";
  if (Math.abs(v) >= 1000) return v.toFixed(0);
  if (Math.abs(v) >= 1) return v.toFixed(2);
  return v.toFixed(4);
}

function fmtPct(v: number | null | undefined): string {
  if (v === null || v === undefined || !isFinite(v)) return "—";
  return (v * 100).toFixed(1) + "%";
}

function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

function yearEnd(): string {
  const y = new Date().getFullYear();
  return `${y}-12-31`;
}

function defaultPeriodStart(kind: TargetScenarioKind): string {
  if (kind === "campaign") return todayStr();
  return `${new Date().getFullYear()}-01-01`;
}

function defaultPeriodEnd(kind: TargetScenarioKind): string {
  if (kind === "campaign") {
    const d = new Date();
    d.setDate(d.getDate() + 7);
    return d.toISOString().slice(0, 10);
  }
  return yearEnd();
}

export function HealthTargetPane({
  workspaceId,
  setActiveSubTab,
}: {
  workspaceId: string | null;
  setActiveSubTab: (sub: SubTab) => void;
}) {
  const [view, setView] = useState<"main" | "readme">("main");
  const [scenario, setScenario] = useState<TargetScenarioKind>("yearly_kpi");
  const [metric, setMetric] = useState<TargetMetricKind>("gmv");
  const [periodStart, setPeriodStart] = useState(defaultPeriodStart("yearly_kpi"));
  const [periodEnd, setPeriodEnd] = useState(defaultPeriodEnd("yearly_kpi"));
  const [targetValue, setTargetValue] = useState(10000000);
  const [saving, setSaving] = useState(false);
  const [savedPlan, setSavedPlan] = useState<{ name: string; planId: string } | null>(null);
  const [pendingReplacePlan, setPendingReplacePlan] = useState<{ name: string; planId: string } | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [assumptions, setAssumptions] = useState<TargetAssumptions>({
    traffic: 100000,
    conversionRate: 0.03,
    aov: 300,
    refundRate: 0.05,
    grossMarginRate: 0.4,
    marketingCost: 500000,
    fixedCost: 200000,
    upliftFactor: 1,
  });

  const input: TargetCalculationInput = useMemo(
    () => ({ scenarioKind: scenario, metric, periodStart, periodEnd, targetValue, assumptions }),
    [scenario, metric, periodStart, periodEnd, targetValue, assumptions],
  );

  const result = useMemo(() => calculateTarget(input), [input]);

  const updateAssumption = (key: keyof TargetAssumptions, v: string) => {
    const n = parseFloat(v);
    setAssumptions((prev) => ({ ...prev, [key]: isFinite(n) ? n : undefined }));
  };

  const handleScenarioChange = (s: TargetScenarioKind) => {
    setScenario(s);
    setPeriodStart(defaultPeriodStart(s));
    setPeriodEnd(defaultPeriodEnd(s));
    setSavedPlan(null);
    setPendingReplacePlan(null);
    setSaveError(null);
  };

  const isExistingGoalError = (error: unknown): boolean => String(error).includes("409");

  const handleSave = async () => {
    if (!workspaceId) return;
    setSaving(true);
    setSaveError(null);
    setPendingReplacePlan(null);
    try {
      const planName = `${SCENARIOS.find((s) => s.id === scenario)!.label} · ${selectedMetric.label}`;
      const plan = await vizApi.createTargetPlan(workspaceId, {
        name: planName,
        input,
        result,
      });
      try {
        await vizApi.adoptTargetPlan(workspaceId, plan.id);
      } catch (e) {
        if (isExistingGoalError(e)) {
          setPendingReplacePlan({ name: planName, planId: plan.id });
          return;
        }
        throw e;
      }
      setSavedPlan({ name: planName, planId: plan.id });
    } catch (e) {
      setSaveError(`保存失败: ${String(e)}`);
    } finally {
      setSaving(false);
    }
  };

  const handleConfirmReplace = async () => {
    if (!workspaceId || !pendingReplacePlan) return;
    setSaving(true);
    setSaveError(null);
    try {
      await vizApi.adoptTargetPlan(workspaceId, pendingReplacePlan.planId, { replaceExisting: true });
      setSavedPlan(pendingReplacePlan);
      setPendingReplacePlan(null);
    } catch (e) {
      setSaveError(`替换失败: ${String(e)}`);
    } finally {
      setSaving(false);
    }
  };

  const selectedMetric = METRICS.find((m) => m.id === metric)!;

  const showDailyBreakdown = scenario === "campaign";

  if (!workspaceId) {
    return (
      <div className="h-full min-h-0 flex-1 overflow-y-auto bg-neutral-50/40 text-[12.5px] dark:bg-neutral-950/40">
        <div className="mx-auto w-full max-w-5xl space-y-4 p-5">
          <h2 className="text-base font-semibold text-neutral-900 dark:text-neutral-100">目标测算</h2>
          <p className="text-neutral-500">请选择工作区后进行目标测算</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col bg-neutral-50/40 text-[12.5px] dark:bg-neutral-950/40">
      <div className="flex items-center justify-end border-b border-neutral-200 bg-white px-4 py-2 dark:border-neutral-800 dark:bg-neutral-900">
        <div className="flex rounded-md bg-neutral-100 p-0.5 dark:bg-neutral-900">
          <button
            type="button"
            onClick={() => setView("main")}
            className={cn("rounded px-2.5 py-1 text-[12px]", view === "main" ? "bg-white text-neutral-900 shadow-sm dark:bg-neutral-800 dark:text-neutral-100" : "text-neutral-500")}
          >
            功能
          </button>
          <button
            type="button"
            onClick={() => setView("readme")}
            className={cn("rounded px-2.5 py-1 text-[12px]", view === "readme" ? "bg-white text-neutral-900 shadow-sm dark:bg-neutral-800 dark:text-neutral-100" : "text-neutral-500")}
          >
            readme
          </button>
        </div>
      </div>
      {view === "readme" ? (
        <div className="flex-1 overflow-auto p-5">
          <div className="mx-auto w-full max-w-4xl rounded-lg border border-neutral-200 bg-white p-6 dark:border-neutral-800 dark:bg-neutral-900">
            <Markdown>{readmeContent}</Markdown>
          </div>
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto">
          <div className="mx-auto w-full max-w-5xl space-y-4 p-5">
            <h2 className="text-base font-semibold text-neutral-900 dark:text-neutral-100">目标测算</h2>

        {/* 场景选择 */}
        <div className="space-y-2">
          <label className="text-sm font-medium">测算场景</label>
          <div className="flex gap-2">
            {SCENARIOS.map((s) => (
              <button
                key={s.id}
                onClick={() => handleScenarioChange(s.id)}
                className={`h-8 rounded-md px-3 text-[12px] transition-colors ${
                  scenario === s.id
                    ? "bg-neutral-900 font-medium text-white dark:bg-neutral-100 dark:text-neutral-900"
                    : "border border-neutral-200 bg-white text-neutral-600 hover:bg-neutral-100 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-300"
                }`}
              >
                {s.label}
              </button>
            ))}
          </div>
        </div>

        {/* 指标选择 */}
        <div className="space-y-2">
          <label className="text-sm font-medium">目标指标</label>
          <div className="flex gap-2">
            {METRICS.map((m) => (
              <button
                key={m.id}
                onClick={() => setMetric(m.id)}
                className={`h-8 rounded-md px-3 text-[12px] transition-colors ${
                  metric === m.id
                    ? "bg-neutral-900 font-medium text-white dark:bg-neutral-100 dark:text-neutral-900"
                    : "border border-neutral-200 bg-white text-neutral-600 hover:bg-neutral-100 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-300"
                }`}
              >
                {m.label}
              </button>
            ))}
          </div>
        </div>

        {/* 参数输入 */}
        <div className="space-y-3 rounded-lg border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
          <h3 className="text-sm font-medium">测算参数</h3>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <label className="flex flex-col gap-1 text-xs">
              <span className="text-neutral-500">目标值（{selectedMetric.unit}）</span>
              <input
                type="number"
                min={0}
                step="any"
                value={targetValue}
                onChange={(e) => setTargetValue(parseFloat(e.target.value) || 0)}
                className="h-8 rounded-md border border-neutral-200 bg-white px-2 text-[12px] dark:border-neutral-700 dark:bg-neutral-950"
              />
            </label>

            <label className="flex flex-col gap-1 text-xs">
              <span className="text-neutral-500">开始日期</span>
              <input
                type="date"
                value={periodStart}
                onChange={(e) => setPeriodStart(e.target.value)}
                className="h-8 rounded-md border border-neutral-200 bg-white px-2 text-[12px] dark:border-neutral-700 dark:bg-neutral-950"
              />
            </label>

            <label className="flex flex-col gap-1 text-xs">
              <span className="text-neutral-500">结束日期</span>
              <input
                type="date"
                value={periodEnd}
                onChange={(e) => setPeriodEnd(e.target.value)}
                className="h-8 rounded-md border border-neutral-200 bg-white px-2 text-[12px] dark:border-neutral-700 dark:bg-neutral-950"
              />
            </label>

            <label className="flex flex-col gap-1 text-xs">
              <span className="text-neutral-500">流量（traffic）</span>
              <input
                type="number"
                min={0}
                step="any"
                value={assumptions.traffic ?? ""}
                onChange={(e) => updateAssumption("traffic", e.target.value)}
                className="h-8 rounded-md border border-neutral-200 bg-white px-2 text-[12px] dark:border-neutral-700 dark:bg-neutral-950"
              />
            </label>

            <label className="flex flex-col gap-1 text-xs">
              <span className="text-neutral-500">转化率（conversionRate）</span>
              <input
                type="number"
                min={0}
                max={1}
                step="0.001"
                value={assumptions.conversionRate ?? ""}
                onChange={(e) => updateAssumption("conversionRate", e.target.value)}
                className="h-8 rounded-md border border-neutral-200 bg-white px-2 text-[12px] dark:border-neutral-700 dark:bg-neutral-950"
              />
            </label>

            <label className="flex flex-col gap-1 text-xs">
              <span className="text-neutral-500">客单价 AOV（元）</span>
              <input
                type="number"
                min={0}
                step="any"
                value={assumptions.aov ?? ""}
                onChange={(e) => updateAssumption("aov", e.target.value)}
                className="h-8 rounded-md border border-neutral-200 bg-white px-2 text-[12px] dark:border-neutral-700 dark:bg-neutral-950"
              />
            </label>

            <label className="flex flex-col gap-1 text-xs">
              <span className="text-neutral-500">退款率（refundRate）</span>
              <input
                type="number"
                min={0}
                max={1}
                step="0.01"
                value={assumptions.refundRate ?? ""}
                onChange={(e) => updateAssumption("refundRate", e.target.value)}
                className="h-8 rounded-md border border-neutral-200 bg-white px-2 text-[12px] dark:border-neutral-700 dark:bg-neutral-950"
              />
            </label>

            <label className="flex flex-col gap-1 text-xs">
              <span className="text-neutral-500">毛利率（grossMarginRate）</span>
              <input
                type="number"
                min={0}
                max={1}
                step="0.01"
                value={assumptions.grossMarginRate ?? ""}
                onChange={(e) => updateAssumption("grossMarginRate", e.target.value)}
                className="h-8 rounded-md border border-neutral-200 bg-white px-2 text-[12px] dark:border-neutral-700 dark:bg-neutral-950"
              />
            </label>

            <label className="flex flex-col gap-1 text-xs">
              <span className="text-neutral-500">营销费用（元）</span>
              <input
                type="number"
                min={0}
                step="any"
                value={assumptions.marketingCost ?? ""}
                onChange={(e) => updateAssumption("marketingCost", e.target.value)}
                className="h-8 rounded-md border border-neutral-200 bg-white px-2 text-[12px] dark:border-neutral-700 dark:bg-neutral-950"
              />
            </label>

            <label className="flex flex-col gap-1 text-xs">
              <span className="text-neutral-500">固定成本（元）</span>
              <input
                type="number"
                min={0}
                step="any"
                value={assumptions.fixedCost ?? ""}
                onChange={(e) => updateAssumption("fixedCost", e.target.value)}
                className="h-8 rounded-md border border-neutral-200 bg-white px-2 text-[12px] dark:border-neutral-700 dark:bg-neutral-950"
              />
            </label>

            <label className="flex flex-col gap-1 text-xs">
              <span className="text-neutral-500">提升系数（upliftFactor）</span>
              <input
                type="number"
                min={0}
                step="0.01"
                value={assumptions.upliftFactor ?? ""}
                onChange={(e) => updateAssumption("upliftFactor", e.target.value)}
                className="h-8 rounded-md border border-neutral-200 bg-white px-2 text-[12px] dark:border-neutral-700 dark:bg-neutral-950"
              />
            </label>
          </div>
        </div>

        {/* 三情景结果 */}
        <div className="space-y-3">
          <h3 className="text-sm font-medium">情景测算结果</h3>
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
            {result.cases.map((c) => (
              <CaseCard key={c.case} c={c} metric={metric} selectedMetric={selectedMetric} />
            ))}
          </div>
        </div>

        {/* 目标拆解 */}
        {result.breakdown.length > 0 && (
          <div className="space-y-3">
            <h3 className="text-sm font-medium">
              目标拆解（{showDailyBreakdown ? "按日" : "按月"}）
            </h3>
            <div className="overflow-x-auto rounded-lg border border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900">
              <table className="w-full text-[12px]">
                <thead>
                  <tr className="border-b border-neutral-200 bg-neutral-50 text-left dark:border-neutral-700 dark:bg-neutral-900">
                    <th className="px-3 py-2 font-medium text-neutral-500">周期</th>
                    <th className="px-3 py-2 font-medium text-neutral-500">情景</th>
                    <th className="px-3 py-2 text-right font-medium text-neutral-500">
                      目标值（{selectedMetric.unit}）
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {result.breakdown.map((b, i) => (
                    <tr
                      key={`${b.period}-${b.case}`}
                      className={`border-b border-neutral-100 dark:border-neutral-800 ${
                        i % 2 === 0 ? "bg-white dark:bg-neutral-900" : "bg-neutral-50/50 dark:bg-neutral-900/50"
                      }`}
                    >
                      <td className="px-3 py-1.5 font-mono text-neutral-700 dark:text-neutral-300">
                        {b.period}
                      </td>
                      <td className="px-3 py-1.5">
                        <span
                          className={`rounded px-1.5 py-0.5 text-[11px] ${CASE_BADGE[b.case]}`}
                        >
                          {CASE_LABELS[b.case]}
                        </span>
                      </td>
                      <td className="px-3 py-1.5 text-right font-mono text-neutral-800 dark:text-neutral-200">
                        {fmtNum(b.targetValue)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* 保存结果 */}
        {savedPlan && (
          <div className="flex items-center justify-between rounded-lg border border-emerald-300 bg-emerald-50 p-3 dark:border-emerald-700 dark:bg-emerald-950/30">
            <span className="text-[12px] text-emerald-700 dark:text-emerald-300">
              已保存为监测目标：{savedPlan.name}
            </span>
            <button
              onClick={() => setActiveSubTab("health_dashboard")}
              className="h-8 rounded-md bg-emerald-600 px-3 text-[12px] font-medium text-white hover:bg-emerald-700 dark:bg-emerald-500 dark:hover:bg-emerald-600"
            >
              去观星台 →
            </button>
          </div>
        )}

        {pendingReplacePlan && !savedPlan && (
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-amber-300 bg-amber-50 p-3 dark:border-amber-700 dark:bg-amber-950/30">
            <span className="text-[12px] text-amber-700 dark:text-amber-200">
              当前已绑定监测目标，是否替换为：{pendingReplacePlan.name}
            </span>
            <div className="ml-auto flex items-center gap-2">
              <button
                onClick={() => setPendingReplacePlan(null)}
                disabled={saving}
                className="h-8 rounded-md border border-amber-300 bg-white px-3 text-[12px] text-amber-700 disabled:opacity-50 dark:border-amber-700 dark:bg-amber-950/30 dark:text-amber-200"
              >
                取消
              </button>
              <button
                onClick={handleConfirmReplace}
                disabled={saving}
                className="h-8 rounded-md bg-amber-600 px-3 text-[12px] font-medium text-white disabled:opacity-50 dark:bg-amber-500"
              >
                {saving ? "替换中…" : "确认替换"}
              </button>
            </div>
          </div>
        )}

        {saveError && (
          <div className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-[12px] text-red-700 dark:border-red-700 dark:bg-red-950/40 dark:text-red-300">
            {saveError}
          </div>
        )}

        {!savedPlan && !pendingReplacePlan && (
          <div className="flex items-center justify-between rounded-lg border border-neutral-200 bg-white p-3 dark:border-neutral-800 dark:bg-neutral-900">
            <span className="text-[11px] text-neutral-400">
              保存为监测目标，供观星台引用
            </span>
            <button
              onClick={handleSave}
              disabled={saving || !workspaceId}
              className="h-8 rounded-md bg-neutral-900 px-4 text-[12px] font-medium text-white disabled:opacity-50 dark:bg-neutral-100 dark:text-neutral-900"
            >
              {saving ? "保存中…" : "保存目标"}
            </button>
          </div>
        )}
      </div>
        </div>
      )}
    </div>
  );
}

function CaseCard({
  c,
  metric,
  selectedMetric,
}: {
  c: TargetCaseResult;
  metric: TargetMetricKind;
  selectedMetric: { label: string; unit: string };
}) {
  const isTarget = (m: TargetMetricKind) => metric === m;

  return (
    <div className={`rounded-lg border p-3 ${CASE_COLORS[c.case]}`}>
      <div className="mb-2 flex items-center justify-between">
        <span
          className={`rounded px-1.5 py-0.5 text-[11px] font-medium ${CASE_BADGE[c.case]}`}
        >
          {CASE_LABELS[c.case]}
        </span>
        <span className="text-[11px] text-neutral-500">
          {c.case === "conservative" ? "×0.85" : c.case === "stretch" ? "×1.15" : "基准"}
        </span>
      </div>

      <div className="space-y-1.5">
        <MetricRow
          label={`目标${selectedMetric.label}`}
          value={c.targetValue}
          unit={selectedMetric.unit}
          highlight={true}
        />

        {c.requiredTraffic != null && (
          <MetricRow label="所需流量" value={c.requiredTraffic} unit="" />
        )}
        {c.requiredOrders != null && (
          <MetricRow label="所需订单" value={c.requiredOrders} unit="单" />
        )}
        {c.requiredAov != null && (
          <MetricRow label="所需 AOV" value={c.requiredAov} unit="元" />
        )}
        {c.requiredConversionRate != null && (
          <MetricRow label="所需转化率" value={c.requiredConversionRate} unit="" isPct />
        )}

        <div className="my-1.5 border-t border-neutral-200 dark:border-neutral-700" />

        {!isTarget("gmv") && c.gmv != null && (
          <MetricRow label="GMV" value={c.gmv} unit="元" />
        )}
        {!isTarget("revenue") && c.revenue != null && (
          <MetricRow label="销售额" value={c.revenue} unit="元" />
        )}
        {!isTarget("gross_profit") && c.grossProfit != null && (
          <MetricRow label="毛利" value={c.grossProfit} unit="元" />
        )}
        {!isTarget("profit") && c.profit != null && (
          <MetricRow label="利润" value={c.profit} unit="元" />
        )}
        {c.roi != null && <MetricRow label="ROI" value={c.roi} unit="" />}
      </div>
    </div>
  );
}

function MetricRow({
  label,
  value,
  unit,
  highlight,
  isPct,
}: {
  label: string;
  value: number;
  unit: string;
  highlight?: boolean;
  isPct?: boolean;
}) {
  return (
    <div className="flex items-center justify-between text-[12px]">
      <span className="text-neutral-500">{label}</span>
      <span
        className={`font-mono ${
          highlight
            ? "font-semibold text-neutral-900 dark:text-neutral-100"
            : "text-neutral-700 dark:text-neutral-300"
        }`}
      >
        {isPct ? fmtPct(value) : fmtNum(value)}
        {unit && !isPct ? ` ${unit}` : ""}
      </span>
    </div>
  );
}
