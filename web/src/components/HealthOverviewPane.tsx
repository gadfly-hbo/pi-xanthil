import { useEffect, useMemo, useRef, useState } from "react";
import type { SubTab } from "@/lib/constants";
import { dataApi } from "@/lib/api/data";
import { vizApi, type MonitorWatchlist } from "@/lib/api/viz";
import { getHealthSelectedWatchlistId, setHealthSelectedRunId, setHealthSelectedWatchlistId } from "@/lib/health-ui-state";
import { FindingDetailDrawer } from "@/components/monitor/FindingDetailDrawer";
import { MonitorWatchlistSelector } from "@/components/monitor/MonitorWatchlistSelector";
import type { ActionItem, ActionTask, BiAggregationDataset, HealthFinding, MonitorConfig, MonitorRun, TargetPlan } from "@/types";

const RUN_STALE_MS = 1000 * 60 * 60 * 24 * 14;

const SEVERITY_RANK: Record<string, number> = { critical: 3, warn: 2, info: 1 };
const LIFECYCLE_RANK: Record<string, number> = { worsening: 4, new: 3, recurring: 2, resolved: 1 };

function monitorReportKey(runId: string): string {
  return "monitor:" + runId;
}

function fmtTime(ts?: number | null): string {
  if (!ts) return "-";
  return new Date(ts).toLocaleString();
}

function sortFindings(items: HealthFinding[]): HealthFinding[] {
  return [...items].sort((a, b) =>
    (SEVERITY_RANK[b.severity] ?? 0) - (SEVERITY_RANK[a.severity] ?? 0)
    || (LIFECYCLE_RANK[b.lifecycle] ?? 0) - (LIFECYCLE_RANK[a.lifecycle] ?? 0)
    || b.detectedAt - a.detectedAt,
  );
}

export function HealthOverviewPane({
  workspaceId,
  setActiveSubTab,
}: {
  workspaceId: string | null;
  setActiveSubTab: (sub: SubTab) => void;
}) {
  const [datasets, setDatasets] = useState<BiAggregationDataset[]>([]);
  const [config, setConfig] = useState<MonitorConfig | null>(null);
  const [watchlists, setWatchlists] = useState<MonitorWatchlist[]>([]);
  const [watchlistId, setWatchlistId] = useState(getHealthSelectedWatchlistId());
  const [runs, setRuns] = useState<MonitorRun[]>([]);
  const [findings, setFindings] = useState<HealthFinding[]>([]);
  const [plans, setPlans] = useState<TargetPlan[]>([]);
  const [items, setItems] = useState<ActionItem[]>([]);
  const [tasks, setTasks] = useState<ActionTask[]>([]);
  const [selectedFinding, setSelectedFinding] = useState<HealthFinding | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const requestSeq = useRef(0);

  const latestRun = runs[0] ?? null;

  const refresh = async () => {
    if (!workspaceId) return;
    const token = ++requestSeq.current;
    setLoading(true);
    setError("");
    try {
      const [nextDatasets, nextConfig, nextRuns, nextPlans, nextItems, nextTasks] = await Promise.all([
        dataApi.listMonitorImports(workspaceId),
        vizApi.getMonitorConfig(workspaceId),
        vizApi.listMonitorRuns(workspaceId, { watchlistId }),
        vizApi.listTargetPlans(workspaceId),
        vizApi.listActionItems(workspaceId),
        vizApi.listActionTasks({ scopeId: workspaceId }),
      ]);
      const nextWatchlists = await vizApi.listMonitorWatchlists(workspaceId);
      const run = nextRuns[0];
      const nextFindings = run ? await vizApi.listMonitorFindings(workspaceId, run.id) : [];
      if (token !== requestSeq.current) return;
      setDatasets(nextDatasets);
      setConfig(nextConfig);
      setWatchlists(nextWatchlists);
      setRuns(nextRuns);
      setPlans(nextPlans);
      const runReportPaths = new Set(nextRuns.map((run) => monitorReportKey(run.id)));
      const monitorItems = nextItems.filter((item) => runReportPaths.has(item.reportPath));
      setItems(monitorItems);
      setTasks(nextTasks.filter((task) => monitorItems.some((item) => item.id === task.actionItemId)));
      setFindings(nextFindings);
    } catch (e) {
      if (token !== requestSeq.current) return;
      setError("加载监测总览失败: " + String(e));
    } finally {
      if (token === requestSeq.current) setLoading(false);
    }
  };

  useEffect(() => {
    if (!workspaceId) {
      setDatasets([]);
      setConfig(null);
      setRuns([]);
      setFindings([]);
      setPlans([]);
      setItems([]);
      setTasks([]);
      requestSeq.current += 1;
      return;
    }
    void refresh();
    return () => { requestSeq.current += 1; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceId, watchlistId]);

  const adoptedPlan = plans.find((plan) => plan.status === "adopted") ?? null;
  const currentWatchlist = watchlists.find((item) => item.id === watchlistId);
  const bindings = currentWatchlist?.datasetBindings ?? config?.datasetBindings ?? [];
  const hasSource = bindings.some((binding) => binding.role === "source");
  const hasGoal = bindings.some((binding) => binding.role === "goal") || !!currentWatchlist?.targetPlanId || !!adoptedPlan;
  const hasMetricSystem = !!(currentWatchlist?.metricSystemId ?? config?.metricSystemId);
  const runExpired = !latestRun || latestRun.status === "error" || (!!latestRun.finishedAt && Date.now() - latestRun.finishedAt > RUN_STALE_MS);
  const topFindings = useMemo(() => sortFindings(findings).slice(0, 5), [findings]);
  const latestItems = latestRun ? items.filter((item) => item.reportPath === monitorReportKey(latestRun.id)) : [];
  const openTasks = tasks.filter((task) => task.status !== "done" && task.status !== "cancelled");
  const criticalCount = findings.filter((finding) => finding.severity === "critical").length;
  const warnCount = findings.filter((finding) => finding.severity === "warn").length;

  const checks = [
    { ok: datasets.length > 0, label: "有监测聚合数据", cta: "去初始化", sub: "health_data" as SubTab },
    { ok: hasSource, label: "已绑定 source 经营数据", cta: "去标角色", sub: "health_data" as SubTab },
    { ok: hasGoal, label: "已绑定 goal 或采纳目标计划", cta: "去目标测算", sub: "health_target" as SubTab },
    { ok: hasMetricSystem, label: "已采纳指标体系", cta: "生成指标体系", sub: "health_data" as SubTab },
    { ok: !runExpired, label: "最近一次 run 可用", cta: latestRun ? "重新运行" : "运行监测", sub: "health_dashboard" as SubTab },
  ];

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col bg-neutral-50/40 text-[12.5px] dark:bg-neutral-950/40">
      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-6xl space-y-4 p-5">
          <header className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-base font-semibold text-neutral-900 dark:text-neutral-100">监测总览</h2>
              <p className="mt-1 text-[12px] text-neutral-500 dark:text-neutral-400">当前能不能跑、最近发生了什么、下一步该点哪里。</p>
            </div>
            <button onClick={() => void refresh()} disabled={loading || !workspaceId} className="rounded-md border border-neutral-300 bg-white px-3 py-1.5 text-[12px] text-neutral-700 hover:bg-neutral-50 disabled:opacity-50 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-200">
              {loading ? "刷新中..." : "刷新"}
            </button>
          </header>

          <MonitorWatchlistSelector
            workspaceId={workspaceId}
            value={watchlistId}
            onChange={(id) => {
              setHealthSelectedWatchlistId(id);
              setHealthSelectedRunId(null);
              setRuns([]);
              setFindings([]);
              setItems([]);
              setTasks([]);
              setSelectedFinding(null);
              setWatchlistId(id);
            }}
            onSaved={() => void refresh()}
          />

          {error && <div className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-rose-700 dark:border-rose-900 dark:bg-rose-950/30 dark:text-rose-300">{error}</div>}

          <section className="grid grid-cols-1 gap-3 lg:grid-cols-4">
            <div className="rounded-lg border border-neutral-200 bg-white p-3 dark:border-neutral-800 dark:bg-neutral-900">
              <div className="text-[11px] text-neutral-500">最近 run</div>
              <div className="mt-1 text-[15px] font-semibold text-neutral-900 dark:text-neutral-100">{latestRun ? latestRun.status : "暂无"}</div>
              <div className="mt-1 text-[11px] text-neutral-400">{fmtTime(latestRun?.finishedAt ?? latestRun?.startedAt)}</div>
            </div>
            <div className="rounded-lg border border-neutral-200 bg-white p-3 dark:border-neutral-800 dark:bg-neutral-900">
              <div className="text-[11px] text-neutral-500">问题 / 风险</div>
              <div className="mt-1 text-[15px] font-semibold text-neutral-900 dark:text-neutral-100">{latestRun?.problemCount ?? 0} / {latestRun?.riskCount ?? 0}</div>
              <div className="mt-1 text-[11px] text-red-500">critical {criticalCount} · warn {warnCount}</div>
            </div>
            <div className="rounded-lg border border-neutral-200 bg-white p-3 dark:border-neutral-800 dark:bg-neutral-900">
              <div className="text-[11px] text-neutral-500">目标绑定</div>
              <div className="mt-1 text-[15px] font-semibold text-neutral-900 dark:text-neutral-100">{hasGoal ? "已就绪" : "缺 goal"}</div>
              <div className="mt-1 text-[11px] text-neutral-400">{adoptedPlan?.name ?? "目标计划/goal 角色"}</div>
            </div>
            <div className="rounded-lg border border-neutral-200 bg-white p-3 dark:border-neutral-800 dark:bg-neutral-900">
              <div className="text-[11px] text-neutral-500">指标体系</div>
              <div className="mt-1 text-[15px] font-semibold text-neutral-900 dark:text-neutral-100">{hasMetricSystem ? "已采纳" : "未采纳"}</div>
              <div className="mt-1 font-mono text-[11px] text-neutral-400">{(currentWatchlist?.metricSystemId ?? config?.metricSystemId)?.slice(0, 8) ?? "-"}</div>
            </div>
          </section>

          <section className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_1.2fr]">
            <div className="space-y-2 rounded-lg border border-neutral-200 bg-white p-3 dark:border-neutral-800 dark:bg-neutral-900">
              <h3 className="text-sm font-medium text-neutral-900 dark:text-neutral-100">就绪检查</h3>
              {checks.map((check) => (
                <div key={check.label} className="flex items-center gap-2 rounded-md border border-neutral-100 px-2 py-2 dark:border-neutral-800">
                  <span className={check.ok ? "text-emerald-600" : "text-amber-600"}>{check.ok ? "✓" : "!"}</span>
                  <span className="flex-1 text-neutral-700 dark:text-neutral-200">{check.label}</span>
                  {!check.ok && <button onClick={() => setActiveSubTab(check.sub)} className="text-[11px] text-blue-600 hover:underline dark:text-blue-400">{check.cta} →</button>}
                </div>
              ))}
              <div className="flex flex-wrap gap-2 pt-2">
                <button onClick={() => setActiveSubTab("health_dashboard")} className="rounded-md bg-neutral-900 px-3 py-1.5 text-[12px] font-medium text-white dark:bg-neutral-100 dark:text-neutral-900">运行监测</button>
                <button onClick={() => setActiveSubTab("health_report")} className="rounded-md border border-neutral-300 px-3 py-1.5 text-[12px] text-neutral-700 dark:border-neutral-700 dark:text-neutral-200">查看行动环</button>
              </div>
            </div>

            <div className="space-y-2 rounded-lg border border-neutral-200 bg-white p-3 dark:border-neutral-800 dark:bg-neutral-900">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-medium text-neutral-900 dark:text-neutral-100">Top findings</h3>
                {latestRun && <span className="font-mono text-[11px] text-neutral-400">run {latestRun.id.slice(0, 8)}</span>}
              </div>
              {topFindings.length === 0 ? (
                <p className="py-8 text-center text-[12px] text-neutral-400">暂无 finding。完成配置后去观星台运行监测。</p>
              ) : topFindings.map((finding) => (
                <button key={finding.id} onClick={() => setSelectedFinding(finding)} className="block w-full rounded-md border border-neutral-100 px-2 py-2 text-left hover:bg-neutral-50 dark:border-neutral-800 dark:hover:bg-neutral-900">
                  <div className="flex items-center gap-2">
                    <span className={finding.severity === "critical" ? "text-red-600" : finding.severity === "warn" ? "text-amber-600" : "text-blue-600"}>{finding.severity}</span>
                    <span className="text-[11px] text-neutral-400">{finding.lifecycle}</span>
                    <span className="ml-auto text-[11px] text-neutral-400">详情 →</span>
                  </div>
                  <div className="mt-1 text-[12px] font-medium text-neutral-900 dark:text-neutral-100">{finding.title}</div>
                </button>
              ))}
            </div>
          </section>

          <section className="rounded-lg border border-neutral-200 bg-white p-3 dark:border-neutral-800 dark:bg-neutral-900">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h3 className="text-sm font-medium text-neutral-900 dark:text-neutral-100">待处理行动</h3>
                <p className="mt-0.5 text-[12px] text-neutral-500">monitor:* 下未完成任务 {openTasks.length} 个；最近 run 已登记行动项 {latestItems.length} 个。</p>
              </div>
              <button onClick={() => setActiveSubTab("health_report")} className="rounded-md border border-neutral-300 px-3 py-1.5 text-[12px] text-neutral-700 hover:bg-neutral-50 dark:border-neutral-700 dark:text-neutral-200 dark:hover:bg-neutral-900">进入行动环 →</button>
            </div>
          </section>
        </div>
      </div>

      <FindingDetailDrawer
        workspaceId={workspaceId}
        run={latestRun}
        finding={selectedFinding}
        items={items.filter((item) => item.reportPath === (latestRun ? monitorReportKey(latestRun.id) : ""))}
        tasks={tasks}
        onClose={() => setSelectedFinding(null)}
        onChanged={() => void refresh()}
      />
    </div>
  );
}
