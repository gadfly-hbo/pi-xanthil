import { useEffect, useMemo, useRef, useState } from "react";
import { dataApi } from "@/lib/api/data";
import { vizApi, type MonitorWatchlist, type MonitorWatchlistInput, type MonitorWatchlistType } from "@/lib/api/viz";
import type { BiAggregationDataset, HealthRuleMeta, HealthSuite, MonitorDatasetBinding, MonitorMetricSystemEntry, MonitorSourceRole, TargetPlan } from "@/types";

const TYPES: { id: MonitorWatchlistType; label: string; name: string }[] = [
  { id: "daily", label: "日常经营", name: "日常经营" },
  { id: "campaign", label: "大促", name: "大促监测" },
  { id: "member", label: "会员复购", name: "会员复购" },
  { id: "store", label: "门店", name: "门店经营" },
  { id: "custom", label: "自定义", name: "自定义监测" },
];

const SUITES: { id: HealthSuite; label: string }[] = [
  { id: "daily", label: "日度" },
  { id: "weekly", label: "周度" },
  { id: "monthly", label: "月度" },
  { id: "quarterly", label: "季度" },
  { id: "yearly", label: "年度" },
];

const ROLE_LABEL: Record<MonitorSourceRole, string> = {
  source: "经营数据",
  goal: "运营目标",
  industry: "行业大盘",
  competitor: "竞品数据",
};

const THRESHOLD_POLICY = [
  { id: "sensitive", label: "敏感", factor: 0.75 },
  { id: "standard", label: "标准", factor: 1 },
  { id: "conservative", label: "保守", factor: 1.25 },
];

function withDefaultOption(workspaceId: string | null, items: MonitorWatchlist[]): MonitorWatchlist[] {
  if (items.some((item) => item.id === "default")) return items;
  return [{
    id: "default",
    workspaceId: workspaceId ?? "",
    name: "默认监测",
    description: "兼容旧 monitor config 的默认计划",
    type: "custom",
    suite: "monthly",
    frequency: "manual",
    status: "active",
    datasetBindings: [],
    thresholdPolicy: "legacy-config",
    createdAt: Date.now(),
    updatedAt: Date.now(),
    archivedAt: null,
    virtual: true,
  }, ...items];
}

export function MonitorWatchlistSelector({
  workspaceId,
  value,
  onChange,
  onSaved,
  onWatchlistsChange,
  compact = false,
}: {
  workspaceId: string | null;
  value: string;
  onChange: (id: string) => void;
  onSaved?: () => void;
  onWatchlistsChange?: (items: MonitorWatchlist[]) => void;
  compact?: boolean;
}) {
  const [watchlists, setWatchlists] = useState<MonitorWatchlist[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const requestSeq = useRef(0);

  const refresh = async () => {
    if (!workspaceId) return;
    const token = ++requestSeq.current;
    setLoading(true);
    setError("");
    try {
      const list = withDefaultOption(workspaceId, await vizApi.listMonitorWatchlists(workspaceId));
      if (token !== requestSeq.current) return;
      setWatchlists(list);
      onWatchlistsChange?.(list);
      if (!list.some((item) => item.id === value) && value !== "default") onChange(list[0]?.id ?? "default");
    } catch (e) {
      if (token !== requestSeq.current) return;
      setError("加载监测计划失败: " + String(e));
    } finally {
      if (token === requestSeq.current) setLoading(false);
    }
  };

  useEffect(() => {
    if (!workspaceId) {
      setWatchlists([]);
      requestSeq.current += 1;
      return;
    }
    void refresh();
    return () => { requestSeq.current += 1; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceId]);

  const current = watchlists.find((item) => item.id === value) ?? watchlists[0];

  return (
    <div className="space-y-2 rounded-lg border border-neutral-200 bg-white p-3 dark:border-neutral-800 dark:bg-neutral-900">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[12px] font-medium text-neutral-800 dark:text-neutral-100">监测计划</span>
        <select
          value={current?.id ?? value}
          disabled={loading || !workspaceId}
          onChange={(e) => onChange(e.target.value || "default")}
          className="h-8 min-w-[220px] flex-1 rounded-md border border-neutral-200 bg-white px-2 text-[12px] dark:border-neutral-700 dark:bg-neutral-950"
        >
          {watchlists.length === 0 ? <option value="default">默认监测</option> : watchlists.map((item) => (
            <option key={item.id} value={item.id}>{item.name}{item.virtual ? "（默认）" : ""}</option>
          ))}
        </select>
        <button onClick={() => setOpen(true)} disabled={!workspaceId} className="h-8 rounded-md bg-neutral-900 px-3 text-[12px] font-medium text-white disabled:opacity-50 dark:bg-neutral-100 dark:text-neutral-900">
          新建计划
        </button>
      </div>
      {!compact && current && (
        <div className="flex flex-wrap gap-2 text-[11px] text-neutral-500">
          <span>{TYPES.find((item) => item.id === current.type)?.label ?? current.type}</span>
          <span>· {current.suite}</span>
          <span>· 数据角色 {current.datasetBindings.length}</span>
          {current.metricSystemId && <span>· 指标体系 {current.metricSystemId.slice(0, 8)}</span>}
          {current.targetPlanId && <span>· 目标计划 {current.targetPlanId.slice(0, 8)}</span>}
        </div>
      )}
      {error && <div className="text-[11px] text-rose-600 dark:text-rose-300">{error}</div>}
      {open && workspaceId && (
        <WatchlistWizard
          workspaceId={workspaceId}
          base={current}
          onClose={() => setOpen(false)}
          onSaved={(nextId) => {
            setOpen(false);
            void refresh();
            onChange(nextId);
            onSaved?.();
          }}
        />
      )}
    </div>
  );
}

function WatchlistWizard({
  workspaceId,
  base,
  onClose,
  onSaved,
}: {
  workspaceId: string;
  base?: MonitorWatchlist;
  onClose: () => void;
  onSaved: (id: string) => void;
}) {
  const [datasets, setDatasets] = useState<BiAggregationDataset[]>([]);
  const [plans, setPlans] = useState<TargetPlan[]>([]);
  const [systems, setSystems] = useState<MonitorMetricSystemEntry[]>([]);
  const [rules, setRules] = useState<HealthRuleMeta[]>([]);
  const [type, setType] = useState<MonitorWatchlistType>("daily");
  const [name, setName] = useState("日常经营");
  const [suite, setSuite] = useState<HealthSuite>(base?.suite ?? "monthly");
  const [roles, setRoles] = useState<Record<string, MonitorSourceRole | "">>({});
  const [targetPlanId, setTargetPlanId] = useState(base?.targetPlanId ?? "");
  const [metricSystemId, setMetricSystemId] = useState(base?.metricSystemId ?? "");
  const [thresholdPolicy, setThresholdPolicy] = useState(base?.thresholdPolicy ?? "standard");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      dataApi.listMonitorImports(workspaceId),
      vizApi.listTargetPlans(workspaceId),
      vizApi.listMonitorMetricSystems(workspaceId),
      vizApi.listHealthRules(workspaceId),
    ]).then(([ds, tps, mss, hrs]) => {
      if (cancelled) return;
      setDatasets(ds);
      setPlans(tps);
      setSystems(mss);
      setRules(hrs.rules);
      const nextRoles: Record<string, MonitorSourceRole | ""> = {};
      for (const binding of base?.datasetBindings ?? []) nextRoles[binding.datasetPathId] = binding.role;
      setRoles(nextRoles);
      if (!metricSystemId) setMetricSystemId(base?.metricSystemId ?? mss[0]?.id ?? "");
      if (!targetPlanId) setTargetPlanId(base?.targetPlanId ?? tps.find((plan) => plan.status === "adopted")?.id ?? "");
    }).catch((e) => setError("加载向导数据失败: " + String(e)));
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceId]);

  const targetPlan = plans.find((plan) => plan.id === targetPlanId);
  const concreteThresholds = useMemo(() => {
    const defaults: Record<string, number> = {};
    for (const rule of rules) for (const [key, value] of Object.entries(rule.thresholds)) if (!(key in defaults)) defaults[key] = value;
    const policy = THRESHOLD_POLICY.find((item) => item.id === thresholdPolicy) ?? THRESHOLD_POLICY[1]!;
    const out: Record<string, number> = {};
    for (const [key, value] of Object.entries(defaults)) out[key] = Number((value * policy.factor).toFixed(4));
    return Object.keys(out).length > 0 ? out : undefined;
  }, [rules, thresholdPolicy]);
  const datasetBindings = useMemo<MonitorDatasetBinding[]>(() => Object.entries(roles)
    .filter(([, role]) => role)
    .map(([datasetPathId, role]) => ({
      datasetPathId,
      role: role as MonitorSourceRole,
      label: datasets.find((ds) => ds.pathId === datasetPathId)?.name,
      updatedAt: Date.now(),
    })), [datasets, roles]);

  const save = async (runAfterSave: boolean) => {
    setSaving(true);
    setError("");
    try {
      const body: MonitorWatchlistInput = {
        name: name.trim() || TYPES.find((item) => item.id === type)?.name || "监测计划",
        description: "",
        type,
        suite,
        frequency: "manual",
        datasetBindings,
        targetPlanId: targetPlanId || undefined,
        goalDatasetPathId: targetPlan?.goalDatasetPathId,
        metricSystemId: metricSystemId || undefined,
        thresholdPolicy,
        thresholds: concreteThresholds,
      };
      const created = await vizApi.createMonitorWatchlist(workspaceId, body);
      if (runAfterSave) await vizApi.runMonitorWatchlist(workspaceId, created.id);
      onSaved(created.id);
    } catch (e) {
      setError("保存监测计划失败: " + String(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4">
      <div className="max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-xl border border-neutral-200 bg-white p-4 shadow-xl dark:border-neutral-800 dark:bg-neutral-950">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="text-base font-semibold text-neutral-900 dark:text-neutral-100">创建监测计划</h3>
            <p className="mt-1 text-[12px] text-neutral-500">首版只做配置切换与手动运行，不含定时调度。</p>
          </div>
          <button onClick={onClose} className="text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200">关闭</button>
        </div>

        {error && <div className="mt-3 rounded border border-rose-200 bg-rose-50 px-2 py-1 text-[12px] text-rose-700 dark:border-rose-900 dark:bg-rose-950/30 dark:text-rose-300">{error}</div>}

        <div className="mt-4 space-y-4 text-[12px]">
          <section className="space-y-2">
            <div className="font-medium">1. 选择场景类型</div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
              {TYPES.map((item) => (
                <button key={item.id} onClick={() => { setType(item.id); setName(item.name); }} className={`rounded-md border px-2 py-2 ${type === item.id ? "border-neutral-900 bg-neutral-900 text-white dark:border-neutral-100 dark:bg-neutral-100 dark:text-neutral-900" : "border-neutral-200 bg-neutral-50 text-neutral-700 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-200"}`}>{item.label}</button>
              ))}
            </div>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <input value={name} onChange={(e) => setName(e.target.value)} className="h-8 rounded-md border border-neutral-200 bg-white px-2 dark:border-neutral-700 dark:bg-neutral-950" placeholder="计划名称" />
              <select value={suite} onChange={(e) => setSuite(e.target.value as HealthSuite)} className="h-8 rounded-md border border-neutral-200 bg-white px-2 dark:border-neutral-700 dark:bg-neutral-950">
                {SUITES.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
              </select>
            </div>
          </section>

          <section className="space-y-2">
            <div className="font-medium">2. 选择/绑定数据角色</div>
            <div className="max-h-56 space-y-1 overflow-y-auto rounded-md border border-neutral-200 p-2 dark:border-neutral-800">
              {datasets.length === 0 ? <p className="text-neutral-400">暂无监测聚合数据，先到初始化导入。</p> : datasets.map((ds) => (
                <div key={ds.pathId} className="flex items-center gap-2 rounded border border-neutral-100 px-2 py-1 dark:border-neutral-800">
                  <span className="min-w-0 flex-1 truncate">{ds.name}</span>
                  <select value={roles[ds.pathId] ?? ""} onChange={(e) => setRoles((prev) => ({ ...prev, [ds.pathId]: e.target.value as MonitorSourceRole | "" }))} className="h-7 rounded border border-neutral-200 bg-white px-2 text-[11px] dark:border-neutral-700 dark:bg-neutral-950">
                    <option value="">不绑定</option>
                    {Object.entries(ROLE_LABEL).map(([role, label]) => <option key={role} value={role}>{label}</option>)}
                  </select>
                </div>
              ))}
            </div>
          </section>

          <section className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <label className="space-y-1">
              <span className="font-medium">3. 目标计划</span>
              <select value={targetPlanId} onChange={(e) => setTargetPlanId(e.target.value)} className="h-8 w-full rounded-md border border-neutral-200 bg-white px-2 dark:border-neutral-700 dark:bg-neutral-950">
                <option value="">不绑定</option>
                {plans.map((plan) => <option key={plan.id} value={plan.id}>{plan.name}{plan.status === "adopted" ? "（已采纳）" : ""}</option>)}
              </select>
            </label>
            <label className="space-y-1">
              <span className="font-medium">4. 指标体系</span>
              <select value={metricSystemId} onChange={(e) => setMetricSystemId(e.target.value)} className="h-8 w-full rounded-md border border-neutral-200 bg-white px-2 dark:border-neutral-700 dark:bg-neutral-950">
                <option value="">不绑定</option>
                {systems.map((sys) => <option key={sys.id} value={sys.id}>{sys.name}</option>)}
              </select>
            </label>
            <label className="space-y-1">
              <span className="font-medium">5. 阈值策略</span>
              <select value={thresholdPolicy} onChange={(e) => setThresholdPolicy(e.target.value)} className="h-8 w-full rounded-md border border-neutral-200 bg-white px-2 dark:border-neutral-700 dark:bg-neutral-950">
                {THRESHOLD_POLICY.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
              </select>
            </label>
          </section>
        </div>

        <div className="mt-4 flex justify-end gap-2 border-t border-neutral-200 pt-3 dark:border-neutral-800">
          <button onClick={onClose} className="rounded-md border border-neutral-300 px-3 py-1.5 text-[12px] dark:border-neutral-700">取消</button>
          <button onClick={() => void save(false)} disabled={saving} className="rounded-md border border-neutral-300 px-3 py-1.5 text-[12px] dark:border-neutral-700 disabled:opacity-50">保存</button>
          <button onClick={() => void save(true)} disabled={saving || !metricSystemId} className="rounded-md bg-neutral-900 px-3 py-1.5 text-[12px] font-medium text-white disabled:opacity-50 dark:bg-neutral-100 dark:text-neutral-900">保存并运行</button>
        </div>
      </div>
    </div>
  );
}
