import { useEffect, useState } from "react";
import { vizApi } from "@/lib/api/viz";
import type { HealthRun, HealthFinding } from "@/types";

const LIFECYCLE_LABEL: Record<string, string> = {
  new: "新发",
  recurring: "复现",
  worsening: "恶化",
  resolved: "已修复",
};

const LIFECYCLE_COLOR: Record<string, string> = {
  new: "text-red-500",
  recurring: "text-amber-500",
  worsening: "text-red-700 font-semibold",
  resolved: "text-green-500",
};

export function HealthTrendPane({ workspaceId }: { workspaceId: string | null }) {
  const [runs, setRuns] = useState<HealthRun[]>([]);
  const [findingsByRun, setFindingsByRun] = useState<Record<string, HealthFinding[]>>({});
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!workspaceId) return;
    setLoading(true);
    vizApi.listHealthRuns(workspaceId).then(async (rs) => {
      setRuns(rs);
      const map: Record<string, HealthFinding[]> = {};
      for (const r of rs.slice(0, 10)) {
        try {
          const { findings } = await vizApi.listHealthFindings(workspaceId, r.id);
          map[r.id] = findings;
        } catch { map[r.id] = []; }
      }
      setFindingsByRun(map);
    }).finally(() => setLoading(false));
  }, [workspaceId]);

  return (
    <div className="p-4 space-y-4">
      <h2 className="text-lg font-semibold">趋势</h2>
      <p className="text-sm text-neutral-500">历次体检 finding 生命周期流，体现健康档案演变。</p>
      {loading && <p className="text-sm text-neutral-400">加载中…</p>}
      {runs.length === 0 && !loading && <p className="text-sm text-neutral-400">暂无体检历史。</p>}
      <div className="space-y-3">
        {runs.map((run) => {
          const fs = findingsByRun[run.id] ?? [];
          const lcCount: Record<string, number> = {};
          for (const f of fs) lcCount[f.lifecycle] = (lcCount[f.lifecycle] ?? 0) + 1;
          return (
            <div key={run.id} className="border rounded-lg p-3">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">
                  {new Date(run.startedAt).toLocaleString()} · {run.suite}
                </span>
                <span className="text-xs text-neutral-400">
                  {run.problemCount} 问题 / {run.riskCount} 风险
                </span>
              </div>
              <div className="mt-2 flex gap-3 text-xs">
                {Object.entries(LIFECYCLE_LABEL).map(([k, label]) => (
                  <span key={k} className={LIFECYCLE_COLOR[k]}>
                    {label}: {lcCount[k] ?? 0}
                  </span>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
