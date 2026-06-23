import { useEffect, useRef, useState } from "react";
import type { SubTab } from "@/lib/constants";
import { vizApi } from "@/lib/api/viz";
import { setHealthSelectedRunId } from "@/lib/health-ui-state";
import type {
  HealthRuleMeta,
  HealthSuite,
  HealthFinding,
  MonitorRun,
  MonitorComparison,
} from "@/types";

const SUITES: { id: HealthSuite; label: string }[] = [
  { id: "daily", label: "日度" },
  { id: "weekly", label: "周度" },
  { id: "monthly", label: "月度" },
  { id: "quarterly", label: "季度" },
  { id: "yearly", label: "年度" },
];

const SEVERITY_COLOR: Record<string, string> = {
  critical: "border-red-300 bg-red-50 dark:border-red-800 dark:bg-red-950/30",
  warn: "border-amber-300 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/30",
  info: "border-blue-300 bg-blue-50 dark:border-blue-800 dark:bg-blue-950/30",
};

const LIFECYCLE_LABEL: Record<string, { text: string; cls: string }> = {
  new: { text: "🆕 新增", cls: "text-red-600 dark:text-red-300" },
  recurring: { text: "🔄 持续", cls: "text-amber-600 dark:text-amber-300" },
  worsening: { text: "⬆️ 加剧", cls: "text-red-700 font-semibold dark:text-red-200" },
  resolved: { text: "✅ 恢复", cls: "text-emerald-600 dark:text-emerald-300" },
};

const COMPARISON_LABEL: Record<string, string> = {
  target: "目标差距",
  history: "历史差距",
  industry: "行业差距",
  competitor: "竞品差距",
};

function fmtNum(v: number | null | undefined): string {
  if (v === null || v === undefined || Number.isNaN(v)) return "—";
  if (Math.abs(v) >= 1000) return v.toFixed(0);
  if (Math.abs(v) >= 1) return v.toFixed(2);
  return v.toFixed(4);
}

function fmtPct(v: number | null | undefined): string {
  if (v === null || v === undefined || Number.isNaN(v)) return "—";
  const sign = v > 0 ? "+" : "";
  return `${sign}${(v * 100).toFixed(1)}%`;
}

function ComparisonRow({ c }: { c: MonitorComparison }) {
  const positive = c.delta !== null && c.delta !== undefined && c.delta > 0;
  const arrow = c.delta === null || c.delta === undefined ? "" : c.delta > 0 ? "↑" : c.delta < 0 ? "↓" : "→";
  return (
    <div className="flex flex-wrap items-center gap-2 text-[11px]">
      <span className="rounded bg-neutral-200 px-1.5 py-0.5 text-neutral-700 dark:bg-neutral-700 dark:text-neutral-200">
        {COMPARISON_LABEL[c.kind] ?? c.kind}
      </span>
      <span className="text-neutral-600 dark:text-neutral-300">{c.label}</span>
      <span className="font-mono text-neutral-800 dark:text-neutral-100">
        {fmtNum(c.currentValue)} vs {fmtNum(c.baselineValue)}
      </span>
      {c.delta !== null && c.delta !== undefined && (
        <span className={`font-medium ${positive ? "text-emerald-600 dark:text-emerald-300" : "text-rose-600 dark:text-rose-300"}`}>
          {arrow} {fmtNum(c.delta)} ({fmtPct(c.deltaRate)})
        </span>
      )}
      {c.window && <span className="text-neutral-400">{c.window}</span>}
    </div>
  );
}

export function HealthDashboardPane({
  workspaceId,
  setActiveSubTab,
}: {
  workspaceId: string | null;
  setActiveSubTab: (sub: SubTab) => void;
}) {
  const [rules, setRules] = useState<HealthRuleMeta[]>([]);
  const [suite, setSuite] = useState<HealthSuite>("monthly");
  const [thresholds, setThresholds] = useState<Record<string, number>>({});
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasMetricSystem, setHasMetricSystem] = useState(false);
  const [runs, setRuns] = useState<MonitorRun[]>([]);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [findings, setFindings] = useState<HealthFinding[]>([]);
  const [loadingFindings, setLoadingFindings] = useState(false);
  const resultRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!workspaceId) {
      setRules([]);
      setRuns([]);
      setSelectedRunId(null);
      setFindings([]);
      setHasMetricSystem(false);
      return;
    }
    let cancelled = false;
    setFindings([]);
    setSelectedRunId(null);

    vizApi.listHealthRules(workspaceId).then((r) => {
      if (cancelled) return;
      setRules(r.rules);
      const t0: Record<string, number> = {};
      for (const rule of r.rules) {
        for (const [k, v] of Object.entries(rule.thresholds)) {
          if (!(k in t0)) t0[k] = v;
        }
      }
      setThresholds(t0);
    }).catch(() => {});

    vizApi.getMonitorConfig(workspaceId).then((cfg) => {
      if (cancelled) return;
      setHasMetricSystem(!!cfg?.metricSystemId);
      if (cfg?.suite) setSuite(cfg.suite);
      if (cfg?.thresholds) setThresholds((prev) => ({ ...prev, ...cfg.thresholds }));
    }).catch(() => {});

    vizApi.listMonitorRuns(workspaceId).then((rs) => {
      if (cancelled) return;
      setRuns(rs);
      if (rs.length > 0) setSelectedRunId(rs[0]!.id);
    }).catch(() => {});

    return () => { cancelled = true; };
  }, [workspaceId]);

  useEffect(() => {
    if (!workspaceId || !selectedRunId) {
      setFindings([]);
      return;
    }
    let cancelled = false;
    setLoadingFindings(true);
    vizApi.listMonitorFindings(workspaceId, selectedRunId)
      .then((fs) => { if (!cancelled) setFindings(fs); })
      .catch((e) => { if (!cancelled) setError(`加载 findings 失败: ${String(e)}`); })
      .finally(() => { if (!cancelled) setLoadingFindings(false); });
    return () => { cancelled = true; };
  }, [workspaceId, selectedRunId]);

  const runMonitor = async () => {
    if (!workspaceId) return;
    setRunning(true);
    setError(null);
    try {
      const r = await vizApi.runMonitorSuite(workspaceId, { suite, thresholds });
      setHealthSelectedRunId(r.run.id);
      const newRuns = await vizApi.listMonitorRuns(workspaceId);
      setRuns(newRuns);
      setSelectedRunId(r.run.id);
      setFindings(r.findings);
      setTimeout(() => resultRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 50);
    } catch (e) {
      setError(`运行监测失败（可能 E-MONITOR2 后端未实装）: ${String(e)}`);
    } finally {
      setRunning(false);
    }
  };

  const applicableRules = rules.filter((r) => r.suites.includes(suite));
  const allThresholdKeys = Array.from(new Set(applicableRules.flatMap((r) => Object.keys(r.thresholds))));

  const trendRuns = runs.slice(0, 5);
  const problems = findings.filter((f) => f.kind === "问题");
  const risks = findings.filter((f) => f.kind === "风险");

  return (
    <div className="h-full min-h-0 flex-1 overflow-y-auto bg-neutral-50/40 text-[12.5px] dark:bg-neutral-950/40">
      <div className="mx-auto w-full max-w-5xl space-y-4 p-5">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold text-neutral-900 dark:text-neutral-100">观星台</h2>
        {!hasMetricSystem && (
          <button
            onClick={() => setActiveSubTab("health_data")}
            className="rounded-md border border-amber-300 bg-amber-50 px-2 py-0.5 text-[11px] text-amber-700 hover:bg-amber-100 dark:border-amber-700 dark:bg-amber-900/40 dark:text-amber-200"
          >
            ⚠ 未配置指标体系，去初始化 →
          </button>
        )}
      </div>

      {error && (
        <div className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-[12.5px] text-red-700 dark:border-red-700 dark:bg-red-950/40 dark:text-red-300">
          {error}
        </div>
      )}

      {/* 监测周期 */}
      <div className="space-y-2">
        <label className="text-sm font-medium">监测周期</label>
        <div className="flex gap-2">
          {SUITES.map((s) => (
            <button
              key={s.id}
              onClick={() => setSuite(s.id)}
              className={`h-8 rounded-md px-3 text-[12px] transition-colors ${suite === s.id ? "bg-neutral-900 font-medium text-white dark:bg-neutral-100 dark:text-neutral-900" : "border border-neutral-200 bg-white text-neutral-600 hover:bg-neutral-100 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-300"}`}
            >
              {s.label}
            </button>
          ))}
        </div>
        <p className="text-xs text-neutral-400">当前仅月粒度有数据支撑；日/周/季/年零数据但引擎通用探测。</p>
      </div>

      {/* 选数据集（已由「初始化」配置） */}

      {/* 阈值表单 */}
      <div className="space-y-2">
        <label className="text-sm font-medium">阈值（可调整）</label>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {allThresholdKeys.map((key) => (
            <label key={key} className="flex items-center gap-2 text-xs">
              <span className="text-neutral-500 w-40 truncate">{key}</span>
              <input
                type="number"
                step="any"
                value={thresholds[key] ?? 0}
                onChange={(e) => setThresholds((prev) => ({ ...prev, [key]: Number(e.target.value) }))}
                className="h-7 w-24 rounded-md border border-neutral-200 bg-white px-2 text-[12px] dark:border-neutral-700 dark:bg-neutral-950"
              />
            </label>
          ))}
        </div>
      </div>

      {/* 将执行的规则 + 触发 */}
      <div className="rounded-lg border border-neutral-200 bg-white p-3 dark:border-neutral-800 dark:bg-neutral-900">
        <details>
          <summary className="cursor-pointer text-[12px] font-medium">将执行的规则（{applicableRules.length}条）</summary>
          <div className="mt-2 max-h-40 space-y-1 overflow-y-auto">
            {applicableRules.map((r) => (
              <div key={r.id} className="flex items-center gap-2 text-xs">
                <span className={`font-mono ${r.kind === "问题" ? "text-red-500" : "text-amber-500"}`}>{r.kind}</span>
                <span className="text-neutral-600 dark:text-neutral-300">{r.title}</span>
                {r.needs.timeSeries && <span className="text-neutral-400">[需时序]</span>}
                {r.needs.crossDataset && <span className="text-neutral-400">[需跨集]</span>}
              </div>
            ))}
          </div>
        </details>
        <div className="mt-3 flex items-center justify-between border-t border-neutral-100 pt-2 dark:border-neutral-800">
          <span className="text-[11px] text-neutral-500">数据角色和指标体系在「初始化」配置</span>
          <button
            onClick={runMonitor}
            disabled={running || !workspaceId}
            className="h-8 rounded-md bg-neutral-900 px-4 text-[12px] font-medium text-white disabled:opacity-50 dark:bg-neutral-100 dark:text-neutral-900"
          >
            {running ? "运行中…" : "运行监测"}
          </button>
        </div>
      </div>

      {/* 趋势摘要 */}
      {trendRuns.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-sm font-medium">趋势摘要（最近 {trendRuns.length} 次）</h3>
          <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2 lg:grid-cols-3">
            {trendRuns.map((run) => (
              <button
                key={run.id}
                onClick={() => setSelectedRunId(run.id)}
                className={`rounded-md border p-2 text-left text-[11px] transition-colors ${run.id === selectedRunId ? "border-neutral-400 bg-white shadow-sm dark:border-neutral-500 dark:bg-neutral-900" : "border-neutral-200 bg-white/60 hover:bg-white dark:border-neutral-800 dark:bg-neutral-900/60 dark:hover:bg-neutral-900"}`}
              >
                <div className="flex items-center justify-between">
                  <span className="font-medium">{new Date(run.startedAt).toLocaleString()}</span>
                  <span className="text-neutral-400">{run.suite}</span>
                </div>
                <div className="mt-0.5 flex gap-2">
                  <span className="text-red-600 dark:text-red-300">问题 {run.problemCount}</span>
                  <span className="text-amber-600 dark:text-amber-300">风险 {run.riskCount}</span>
                  <span className="text-neutral-400">·</span>
                  <span className={run.status === "done" ? "text-emerald-600 dark:text-emerald-300" : run.status === "error" ? "text-rose-600 dark:text-rose-300" : "text-neutral-500"}>{run.status}</span>
                </div>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* 结果区：findings */}
      <div ref={resultRef} className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-medium">
            监测结果
            {selectedRunId && (
              <span className="ml-2 font-mono text-[11px] text-neutral-400">{selectedRunId.slice(0, 8)}…</span>
            )}
          </h3>
          {findings.length > 0 && (
            <button
              onClick={() => setActiveSubTab("health_report")}
              className="text-xs text-blue-500 hover:underline"
            >
              去行动环采纳 →
            </button>
          )}
        </div>

        {loadingFindings && <p className="text-[12px] text-neutral-400">加载中…</p>}
        {!loadingFindings && !selectedRunId && (
          <p className="text-[12px] text-neutral-400">暂无运行历史。点上方「运行监测」开始。</p>
        )}
        {!loadingFindings && selectedRunId && findings.length === 0 && (
          <p className="text-[12px] text-emerald-600 dark:text-emerald-300">✅ 此次监测未发现问题/风险</p>
        )}
        {findings.length > 0 && (
          <>
            <div className="flex gap-3 text-[12px]">
              <span className="font-medium text-red-600 dark:text-red-300">🔴 问题 {problems.length}</span>
              <span className="font-medium text-amber-600 dark:text-amber-300">🟡 风险 {risks.length}</span>
            </div>
            {findings.map((f) => (
              <FindingCard key={f.id} f={f} />
            ))}
          </>
        )}
      </div>
      </div>
    </div>
  );
}

function FindingCard({ f }: { f: HealthFinding }) {
  const lc = LIFECYCLE_LABEL[f.lifecycle] ?? { text: f.lifecycle, cls: "text-neutral-500" };
  const sevCls = SEVERITY_COLOR[f.severity] ?? "border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900";
  return (
    <div className={`space-y-2 rounded-lg border p-3 ${sevCls}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="rounded bg-white/70 px-1.5 py-0.5 text-[10px] uppercase text-neutral-700 dark:bg-black/30 dark:text-neutral-200">{f.severity}</span>
            <span className="text-[11px] text-neutral-500">{f.category}</span>
            <span className={`text-[11px] ${lc.cls}`}>{lc.text}</span>
          </div>
          <p className="mt-1 text-[13px] font-medium text-neutral-900 dark:text-neutral-100">{f.title}</p>
        </div>
      </div>

      {f.comparisons && f.comparisons.length > 0 && (
        <div className="space-y-1 rounded-md bg-white/60 p-2 dark:bg-black/20">
          {f.comparisons.map((c, i) => <ComparisonRow key={i} c={c} />)}
        </div>
      )}

      {f.diagnosis && (
        <div className="space-y-1 rounded-md border border-dashed border-neutral-300 bg-white/40 p-2 text-[11px] dark:border-neutral-700 dark:bg-black/20">
          <p className="text-neutral-700 dark:text-neutral-200">
            <span className="font-medium">诊断：</span>{f.diagnosis.summary}
          </p>
          {f.diagnosis.opportunity && (
            <p className="text-emerald-700 dark:text-emerald-300">
              <span className="font-medium">机会：</span>{f.diagnosis.opportunity}
            </p>
          )}
          {(f.diagnosis.relatedMetricIds.length > 0 || f.diagnosis.ontologyObjectIds.length > 0) && (
            <div className="flex flex-wrap gap-1 text-[10px] text-neutral-500">
              {f.diagnosis.relatedMetricIds.map((id) => (
                <span key={`m-${id}`} className="rounded bg-neutral-200 px-1 dark:bg-neutral-700">指标 {id.slice(0, 8)}</span>
              ))}
              {f.diagnosis.ontologyObjectIds.map((id) => (
                <span key={`o-${id}`} className="rounded bg-neutral-200 px-1 dark:bg-neutral-700">对象 {id.slice(0, 8)}</span>
              ))}
              {(f.diagnosis.ontologyLinkIds ?? []).map((id) => (
                <span key={`l-${id}`} className="rounded bg-neutral-200 px-1 dark:bg-neutral-700">关系 {id.slice(0, 8)}</span>
              ))}
              {(f.diagnosis.logicRuleIds ?? []).map((id) => (
                <span key={`r-${id}`} className="rounded bg-neutral-200 px-1 dark:bg-neutral-700">规则 {id.slice(0, 8)}</span>
              ))}
            </div>
          )}
        </div>
      )}

      {f.suggestion && (
        <p className="text-[11px] text-neutral-600 dark:text-neutral-300">
          <span className="font-medium">建议：</span>{f.suggestion}
        </p>
      )}

      <details className="text-[11px] text-neutral-500">
        <summary className="cursor-pointer">evidence</summary>
        <pre className="mt-1 whitespace-pre-wrap break-all rounded bg-neutral-50 p-1 dark:bg-neutral-950">
          {JSON.stringify(f.evidence, null, 2)}
        </pre>
      </details>
    </div>
  );
}
