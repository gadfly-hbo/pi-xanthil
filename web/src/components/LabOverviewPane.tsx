import { useCallback, useEffect, useState } from "react";
import { ArrowRight, Loader2, RefreshCw } from "lucide-react";
import { api } from "@/lib/api";
import { SummaryTable } from "@/components/eval-shared";

export type LabTarget = "skill" | "tool" | "hooks_lab" | "command_lab" | "subagents_lab" | "prompts_lab";

interface RecentEvaluation {
  evaluationId: string;
  status: "success" | "failed";
  startedAt: number;
  durationSec: number;
}

interface LabOverviewRow {
  id: LabTarget;
  label: string;
  recent: RecentEvaluation | null;
  total: number;
}

const LABS: Array<{ id: LabTarget; label: string; load: (workspaceId: string) => Promise<RecentEvaluation[]> }> = [
  { id: "skill", label: "skill", load: (id) => api.listSkillEvaluations(id) },
  { id: "tool", label: "tool", load: (id) => api.listToolEvaluations(id) },
  { id: "prompts_lab", label: "prompt", load: (id) => api.listPromptEvaluations(id) },
  { id: "command_lab", label: "command", load: (id) => api.listCommandEvaluations(id) },
  { id: "subagents_lab", label: "subagent", load: (id) => api.listSubAgentEvaluations(id) },
  { id: "hooks_lab", label: "hook", load: (id) => api.listHookEvaluations(id) },
];

export function LabOverviewPane({ workspaceId, onNavigate, onOpenRegression }: { workspaceId: string | null; onNavigate: (target: LabTarget) => void; onOpenRegression?: () => void }) {
  const [rows, setRows] = useState<LabOverviewRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!workspaceId) return;
    setLoading(true);
    setError(null);
    try {
      const evaluations = await Promise.all(LABS.map((lab) => lab.load(workspaceId)));
      setRows(LABS.map((lab, index) => {
        const items = evaluations[index] ?? [];
        const recent = items.reduce<RecentEvaluation | null>((latest, item) => !latest || item.startedAt > latest.startedAt ? item : latest, null);
        return { id: lab.id, label: lab.label, recent, total: items.length };
      }));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setLoading(false);
    }
  }, [workspaceId]);

  useEffect(() => { void refresh(); }, [refresh]);

  if (!workspaceId) return <div className="p-6 text-sm text-muted-foreground">请先选择工作区。</div>;

  const success = rows.filter((row) => row.recent?.status === "success").length;
  const failed = rows.filter((row) => row.recent?.status === "failed").length;
  const empty = rows.filter((row) => !row.recent).length;

  return <main className="min-w-0 flex-1 overflow-y-auto p-5">
    <div className="flex items-start justify-between gap-4">
      <div><h2 className="text-base font-semibold">实验场总览</h2><p className="mt-1 text-xs text-muted-foreground">六类评测最近一次运行状态；只读聚合，不触发评测。</p></div>
      <div className="flex items-center gap-2">
        {onOpenRegression && <button type="button" onClick={onOpenRegression} className="inline-flex h-8 items-center gap-1 rounded-md border border-border px-2 text-xs">回归看板</button>}
        <button type="button" onClick={() => void refresh()} disabled={loading} className="inline-flex h-8 items-center gap-1 rounded-md border border-border px-2 text-xs disabled:opacity-40">{loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}刷新</button>
      </div>
    </div>
    <div className="mt-4 grid gap-3 sm:grid-cols-3">
      <Metric label="最近成功" value={success} tone="success" />
      <Metric label="最近失败" value={failed} tone="failed" />
      <Metric label="暂无运行" value={empty} tone="neutral" />
    </div>
    {error && <div className="mt-4 rounded border border-red-300 bg-red-50 p-3 text-xs text-red-700">加载失败：{error}</div>}
    <SummaryTable rows={rows} rowKey={(row) => row.id} emptyText={loading ? "加载中…" : "暂无评测数据。"} columns={[
      { key: "lab", label: "Lab", className: "font-medium", render: (row) => row.label },
      { key: "status", label: "最近状态", render: (row) => row.recent ? <span className={row.recent.status === "success" ? "text-emerald-600" : "text-red-600"}>{row.recent.status}</span> : <span className="text-muted-foreground">未运行</span> },
      { key: "time", label: "最近运行", render: (row) => row.recent ? new Date(row.recent.startedAt).toLocaleString("zh-CN") : "-" },
      { key: "duration", label: "耗时", render: (row) => row.recent ? `${row.recent.durationSec.toFixed(2)}s` : "-" },
      { key: "total", label: "历史数", render: (row) => row.total },
      { key: "action", label: "", render: (row) => <button type="button" onClick={() => onNavigate(row.id)} className="inline-flex items-center gap-1 text-sky-600 hover:text-sky-700">进入 <ArrowRight className="h-3.5 w-3.5" /></button> },
    ]} />
  </main>;
}

function Metric({ label, value, tone }: { label: string; value: number; tone: "success" | "failed" | "neutral" }) {
  const valueClass = tone === "success" ? "text-emerald-600" : tone === "failed" ? "text-red-600" : "text-neutral-500";
  return <div className="rounded-lg border border-border bg-background p-3"><div className="text-xs text-muted-foreground">{label}</div><div className={`mt-1 text-2xl font-semibold ${valueClass}`}>{value}</div></div>;
}
