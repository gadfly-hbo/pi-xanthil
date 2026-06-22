import { useEffect, useState } from "react";
import type { SubTab } from "@/lib/constants";
import { vizApi } from "@/lib/api/viz";
import { dataApi } from "@/lib/api/data";
import { setHealthSelectedRunId } from "@/lib/health-ui-state";
import type { BiAggregationDataset, HealthRuleMeta, HealthSuite } from "@/types";

const SUITES: { id: HealthSuite; label: string }[] = [
  { id: "daily", label: "日检" },
  { id: "weekly", label: "周检" },
  { id: "monthly", label: "月检" },
  { id: "quarterly", label: "季检" },
  { id: "yearly", label: "年检" },
];

export function HealthDashboardPane({
  workspaceId,
  setActiveSubTab,
}: {
  workspaceId: string | null;
  setActiveSubTab: (sub: SubTab) => void;
}) {
  const [datasets, setDatasets] = useState<BiAggregationDataset[]>([]);
  const [rules, setRules] = useState<HealthRuleMeta[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [suite, setSuite] = useState<HealthSuite>("monthly");
  const [thresholds, setThresholds] = useState<Record<string, number>>({});
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!workspaceId) return;
    dataApi.getBiAggregations(workspaceId).then(setDatasets).catch(() => {});
    vizApi.listHealthRules(workspaceId).then((r) => {
      setRules(r.rules);
      // 从规则元数据提取所有阈值 key 初始化阈值表单
      const t0: Record<string, number> = {};
      for (const rule of r.rules) {
        for (const [k, v] of Object.entries(rule.thresholds)) {
          if (!(k in t0)) t0[k] = v;
        }
      }
      setThresholds(t0);
    }).catch(() => {});
  }, [workspaceId]);

  const toggle = (pathId: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(pathId)) next.delete(pathId);
      else next.add(pathId);
      return next;
    });
  };

  const runHealth = async () => {
    if (!workspaceId || selected.size === 0) return;
    setRunning(true);
    setError(null);
    try {
      const r = await vizApi.runHealthSuite(workspaceId, suite, {
        datasetPathIds: Array.from(selected),
        thresholds,
      });
      setHealthSelectedRunId(r.run.id);
      setActiveSubTab("health_report");
    } catch (e) {
      setError(String(e));
    } finally {
      setRunning(false);
    }
  };

  const applicableRules = rules.filter((r) => r.suites.includes(suite));
  const allThresholdKeys = Array.from(new Set(applicableRules.flatMap((r) => Object.keys(r.thresholds))));

  return (
    <div className="p-4 space-y-4 max-w-3xl">
      <h2 className="text-lg font-semibold">体检台</h2>

      {/* 套餐 */}
      <div className="space-y-2">
        <label className="text-sm font-medium">套餐</label>
        <div className="flex gap-2">
          {SUITES.map((s) => (
            <button
              key={s.id}
              onClick={() => setSuite(s.id)}
              className={`px-3 py-1.5 rounded-md text-sm ${suite === s.id ? "bg-blue-600 text-white" : "bg-neutral-100 dark:bg-neutral-800"}`}
            >
              {s.label}
            </button>
          ))}
        </div>
        <p className="text-xs text-neutral-400">当前仅月粒度有数据支撑；日/周/季/年零数据但引擎通用探测。</p>
      </div>

      {/* 选数据集 */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <label className="text-sm font-medium">选数据集</label>
          <button
            onClick={() => setActiveSubTab("health_data")}
            className="text-xs text-blue-500 hover:underline"
          >
            接入更多（SQL / 提取）→
          </button>
        </div>
        <div className="space-y-1">
          {datasets.map((ds) => (
            <label key={ds.pathId} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={selected.has(ds.pathId)}
                onChange={() => toggle(ds.pathId)}
                className="rounded"
              />
              <span>{ds.name}</span>
              <span className="text-xs text-neutral-400">({ds.rowCount}行 · {ds.columns.length}列)</span>
            </label>
          ))}
          {datasets.length === 0 && (
            <p className="text-xs text-neutral-400">暂无聚合数据，请先在「聚合数据入口」接入。</p>
          )}
        </div>
      </div>

      {/* 阈值表单 */}
      <div className="space-y-2">
        <label className="text-sm font-medium">阈值（可调整）</label>
        <div className="grid grid-cols-2 gap-2">
          {allThresholdKeys.map((key) => (
            <label key={key} className="flex items-center gap-2 text-xs">
              <span className="text-neutral-500 w-40 truncate">{key}</span>
              <input
                type="number"
                step="any"
                value={thresholds[key] ?? 0}
                onChange={(e) => setThresholds((prev) => ({ ...prev, [key]: Number(e.target.value) }))}
                className="w-24 border rounded px-1 py-0.5 text-xs"
              />
            </label>
          ))}
        </div>
      </div>

      {/* 将执行的规则 */}
      <div className="space-y-2">
        <label className="text-sm font-medium">将执行的规则（{applicableRules.length}条）</label>
        <div className="space-y-1 max-h-40 overflow-y-auto">
          {applicableRules.map((r) => (
            <div key={r.id} className="text-xs flex items-center gap-2">
              <span className={`font-mono ${r.kind === "问题" ? "text-red-500" : "text-amber-500"}`}>{r.kind}</span>
              <span className="text-neutral-600 dark:text-neutral-300">{r.title}</span>
              {r.needs.timeSeries && <span className="text-neutral-400">[需时序]</span>}
              {r.needs.crossDataset && <span className="text-neutral-400">[需跨集]</span>}
            </div>
          ))}
        </div>
      </div>

      {/* 触发 */}
      <button
        onClick={runHealth}
        disabled={running || selected.size === 0 || !workspaceId}
        className="px-4 py-2 bg-blue-600 text-white rounded-md text-sm disabled:opacity-50"
      >
        {running ? "体检中…" : "立即体检"}
      </button>

      {error && <p className="text-sm text-red-500">{error}</p>}
    </div>
  );
}
