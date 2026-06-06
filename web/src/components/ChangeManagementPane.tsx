import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, CircleDot, Plus, RefreshCw, Trash2, XCircle } from "lucide-react";
import { api } from "@/lib/api";
import { cn } from "@/lib/cn";
import type { ChangeProposal, ChangeProposalStatus, FlowRun, StaleNode } from "@/types";

interface Props {
  workspaceId: string | null;
}

const ANAX_SOURCE = "AnaX v3.0";

const STATUS_LABEL: Record<ChangeProposalStatus, string> = {
  proposed: "待审批",
  approved: "已批准",
  applied: "已落地",
  rejected: "已驳回",
};

const STATUS_COLOR: Record<ChangeProposalStatus, string> = {
  proposed: "text-amber-600 bg-amber-50 dark:text-amber-400 dark:bg-amber-950/30",
  approved: "text-blue-600 bg-blue-50 dark:text-blue-400 dark:bg-blue-950/30",
  applied: "text-green-600 bg-green-50 dark:text-green-700/30 dark:bg-green-950/30",
  rejected: "text-neutral-500 bg-neutral-100 dark:text-neutral-400 dark:bg-neutral-800/50",
};

const NODE_LABEL: Record<string, string> = {
  business: "B 商务定义",
  plan: "A 分析规划",
  data: "D 数据评估",
  data_gate: "数据门禁",
  insight: "I 洞察",
  recommend: "R 建议",
  review_gate: "复核门禁",
  verify: "X 交叉验证",
  archive: "归档",
};

const EMPTY_FORM = { title: "", description: "", expectedImpact: "", sourceNodeId: "" };

export function ChangeManagementPane({ workspaceId }: Props) {
  const [proposals, setProposals] = useState<ChangeProposal[]>([]);
  const [staleNodes, setStaleNodes] = useState<StaleNode[]>([]);
  const [latestRunId, setLatestRunId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [applyingId, setApplyingId] = useState<string | null>(null);
  const [appliedResultDraft, setAppliedResultDraft] = useState("");

  const refresh = useCallback(async () => {
    if (!workspaceId) return;
    setLoading(true);
    try {
      const [props, flows] = await Promise.all([
        api.listChangeProposals(workspaceId),
        api.listFlows(workspaceId),
      ]);
      setProposals(props);
      const anaxFlow = flows.find((f) => f.sourceName === ANAX_SOURCE);
      if (anaxFlow) {
        const runs = await api.listFlowRuns(anaxFlow.id);
        const latest: FlowRun | undefined = runs[0];
        if (latest) {
          setLatestRunId(latest.id);
          const stale = await api.getStaleNodes(latest.id);
          setStaleNodes(stale);
        } else {
          setLatestRunId(null);
          setStaleNodes([]);
        }
      } else {
        setLatestRunId(null);
        setStaleNodes([]);
      }
    } finally {
      setLoading(false);
    }
  }, [workspaceId]);

  useEffect(() => {
    setProposals([]);
    setStaleNodes([]);
    setLatestRunId(null);
    if (workspaceId) refresh();
  }, [workspaceId, refresh]);

  async function handleCreate() {
    if (!workspaceId || !form.title.trim()) return;
    setSaving(true);
    try {
      await api.createChangeProposal(workspaceId, {
        title: form.title.trim(),
        description: form.description,
        expectedImpact: form.expectedImpact,
        sourceNodeId: form.sourceNodeId || null,
        runId: latestRunId,
      });
      setForm(EMPTY_FORM);
      setAdding(false);
      await refresh();
    } finally {
      setSaving(false);
    }
  }

  async function handleStatusChange(id: string, status: ChangeProposalStatus) {
    await api.updateChangeProposal(id, { status });
    setProposals((cur) => cur.map((p) => p.id === id ? { ...p, status } : p));
  }

  async function handleApplyConfirm(id: string) {
    await api.updateChangeProposal(id, { status: "applied", appliedResult: appliedResultDraft });
    setApplyingId(null);
    setAppliedResultDraft("");
    await refresh();
  }

  async function handleDelete(id: string) {
    await api.deleteChangeProposal(id);
    setProposals((cur) => cur.filter((p) => p.id !== id));
  }

  async function handleCascadeFromNode(nodeId: string) {
    if (!latestRunId) return;
    await api.cascadeFromNode(latestRunId, nodeId);
    await refresh();
  }

  const staleByReason = staleNodes.reduce<Record<string, StaleNode[]>>((acc, n) => {
    (acc[n.reason] ??= []).push(n);
    return acc;
  }, {});

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
      <div className="mx-auto w-full max-w-3xl px-6 py-6">

        {/* Header */}
        <div className="mb-5 flex items-center gap-2">
          <CircleDot className="h-4 w-4 text-neutral-500" strokeWidth={1.75} />
          <h2 className="text-[14px] font-semibold text-neutral-900 dark:text-neutral-100">变更管理</h2>
          <span className="text-[11px] text-neutral-400">追踪分析建议的落地状态</span>
          <button onClick={refresh} className="ml-auto rounded p-1 text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-300">
            <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} strokeWidth={1.75} />
          </button>
        </div>

        {/* Stale nodes banner */}
        {staleNodes.length > 0 && (
          <div className="mb-4 rounded-md border border-amber-200 bg-amber-50 px-3.5 py-2.5 dark:border-amber-800 dark:bg-amber-950/30">
            <div className="flex items-start gap-2">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-600 dark:text-amber-400" strokeWidth={1.75} />
              <div className="min-w-0 flex-1">
                <p className="text-[12px] font-medium text-amber-800 dark:text-amber-300">
                  {staleByReason["data_changed"] ? "数据文件已更新，" : "节点已手动修改，"}
                  以下 {staleNodes.length} 个节点需要重跑
                </p>
                <div className="mt-1 flex flex-wrap gap-1.5">
                  {staleNodes.map((n) => (
                    <span key={n.id} className="rounded bg-amber-100 px-1.5 py-0.5 text-[11px] text-amber-700 dark:bg-amber-900/40 dark:text-amber-300">
                      {NODE_LABEL[n.nodeId] ?? n.nodeId}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Proposals list */}
        <div className="space-y-2">
          {proposals.length === 0 && !adding && (
            <p className="py-6 text-center text-[12px] text-neutral-400">暂无变更提案</p>
          )}

          {proposals.map((p) => (
            <div key={p.id} className="rounded-md border border-neutral-200 bg-white p-3.5 dark:border-neutral-700 dark:bg-neutral-900">
              <div className="flex items-start gap-2">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-[13px] font-medium text-neutral-900 dark:text-neutral-100">{p.title}</span>
                    <span className={cn("rounded px-1.5 py-0.5 text-[10.5px] font-medium", STATUS_COLOR[p.status])}>
                      {STATUS_LABEL[p.status]}
                    </span>
                    {p.sourceNodeId && (
                      <span className="rounded bg-neutral-100 px-1.5 py-0.5 text-[10.5px] text-neutral-500 dark:bg-neutral-800 dark:text-neutral-400">
                        来源: {NODE_LABEL[p.sourceNodeId] ?? p.sourceNodeId}
                      </span>
                    )}
                  </div>
                  {p.description && (
                    <p className="mt-1 text-[12px] text-neutral-500 dark:text-neutral-400">{p.description}</p>
                  )}
                  {p.expectedImpact && (
                    <p className="mt-0.5 text-[11.5px] text-neutral-400">预期影响: {p.expectedImpact}</p>
                  )}
                  {p.status === "applied" && p.appliedResult && (
                    <p className="mt-1 text-[11.5px] text-green-600 dark:text-green-400">落地结果: {p.appliedResult}</p>
                  )}
                  <p className="mt-1 text-[10.5px] text-neutral-300 dark:text-neutral-600">
                    {new Date(p.createdAt).toLocaleDateString("zh-CN")}
                  </p>
                </div>

                {/* Actions */}
                <div className="flex shrink-0 items-center gap-1">
                  {p.status === "proposed" && (
                    <>
                      <button
                        onClick={() => handleStatusChange(p.id, "approved")}
                        className="rounded px-2 py-1 text-[11px] text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-950/30"
                      >
                        批准
                      </button>
                      <button
                        onClick={() => handleStatusChange(p.id, "rejected")}
                        className="rounded px-2 py-1 text-[11px] text-neutral-500 hover:bg-neutral-100 dark:hover:bg-neutral-800"
                      >
                        驳回
                      </button>
                    </>
                  )}
                  {p.status === "approved" && (
                    <button
                      onClick={() => { setApplyingId(p.id); setAppliedResultDraft(""); }}
                      className="rounded px-2 py-1 text-[11px] text-green-600 hover:bg-green-50 dark:hover:bg-green-950/30"
                    >
                      记录落地
                    </button>
                  )}
                  {p.status !== "applied" && (
                    <button
                      onClick={() => handleCascadeFromNode(p.sourceNodeId ?? "recommend")}
                      title="从此节点向下标记 stale"
                      className="rounded p-1 text-neutral-400 hover:text-amber-500"
                    >
                      <AlertTriangle className="h-3 w-3" strokeWidth={1.75} />
                    </button>
                  )}
                  <button
                    onClick={() => handleDelete(p.id)}
                    className="rounded p-1 text-neutral-300 hover:text-red-500 dark:text-neutral-600"
                  >
                    <Trash2 className="h-3 w-3" strokeWidth={1.75} />
                  </button>
                </div>
              </div>

              {/* Apply result inline form */}
              {applyingId === p.id && (
                <div className="mt-2.5 rounded bg-neutral-50 p-2.5 dark:bg-neutral-800">
                  <textarea
                    className="w-full resize-none rounded border border-neutral-200 bg-white px-2 py-1.5 text-[12px] text-neutral-900 outline-none focus:ring-1 focus:ring-neutral-400 dark:border-neutral-600 dark:bg-neutral-900 dark:text-neutral-100"
                    rows={2}
                    placeholder="记录实际落地结果（如：已于 6.1 版本上线，留存提升 2.1%）"
                    value={appliedResultDraft}
                    onChange={(e) => setAppliedResultDraft(e.target.value)}
                  />
                  <div className="mt-1.5 flex gap-1.5">
                    <button
                      onClick={() => handleApplyConfirm(p.id)}
                      className="flex items-center gap-1 rounded bg-green-600 px-2.5 py-1 text-[11px] text-white hover:bg-green-700"
                    >
                      <CheckCircle2 className="h-3 w-3" strokeWidth={2} /> 确认落地
                    </button>
                    <button
                      onClick={() => setApplyingId(null)}
                      className="flex items-center gap-1 rounded px-2.5 py-1 text-[11px] text-neutral-500 hover:bg-neutral-200 dark:hover:bg-neutral-700"
                    >
                      <XCircle className="h-3 w-3" strokeWidth={2} /> 取消
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>

        {/* New proposal form */}
        {adding ? (
          <div className="mt-3 rounded-md border border-neutral-200 bg-neutral-50 p-3.5 dark:border-neutral-700 dark:bg-neutral-800/50">
            <p className="mb-2.5 text-[12px] font-medium text-neutral-700 dark:text-neutral-300">新建变更提案</p>
            <input
              className="mb-2 w-full rounded border border-neutral-200 bg-white px-2.5 py-1.5 text-[12px] text-neutral-900 outline-none focus:ring-1 focus:ring-neutral-400 dark:border-neutral-600 dark:bg-neutral-900 dark:text-neutral-100"
              placeholder="提案标题（必填）"
              value={form.title}
              onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
            />
            <textarea
              className="mb-2 w-full resize-none rounded border border-neutral-200 bg-white px-2.5 py-1.5 text-[12px] text-neutral-900 outline-none focus:ring-1 focus:ring-neutral-400 dark:border-neutral-600 dark:bg-neutral-900 dark:text-neutral-100"
              rows={2}
              placeholder="变更描述（可选）"
              value={form.description}
              onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
            />
            <div className="mb-2 flex gap-2">
              <input
                className="flex-1 rounded border border-neutral-200 bg-white px-2.5 py-1.5 text-[12px] text-neutral-900 outline-none focus:ring-1 focus:ring-neutral-400 dark:border-neutral-600 dark:bg-neutral-900 dark:text-neutral-100"
                placeholder="预期影响（如：留存率 +3%）"
                value={form.expectedImpact}
                onChange={(e) => setForm((f) => ({ ...f, expectedImpact: e.target.value }))}
              />
              <select
                className="rounded border border-neutral-200 bg-white px-2 py-1.5 text-[12px] text-neutral-700 outline-none focus:ring-1 focus:ring-neutral-400 dark:border-neutral-600 dark:bg-neutral-900 dark:text-neutral-300"
                value={form.sourceNodeId}
                onChange={(e) => setForm((f) => ({ ...f, sourceNodeId: e.target.value }))}
              >
                <option value="">来源节点（可选）</option>
                {Object.entries(NODE_LABEL).map(([id, label]) => (
                  <option key={id} value={id}>{label}</option>
                ))}
              </select>
            </div>
            <div className="flex gap-1.5">
              <button
                disabled={!form.title.trim() || saving}
                onClick={handleCreate}
                className="flex items-center gap-1 rounded bg-neutral-900 px-3 py-1.5 text-[11px] text-white disabled:opacity-40 hover:bg-neutral-700 dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-neutral-300"
              >
                <Plus className="h-3 w-3" strokeWidth={2} /> 创建
              </button>
              <button
                onClick={() => { setAdding(false); setForm(EMPTY_FORM); }}
                className="rounded px-3 py-1.5 text-[11px] text-neutral-500 hover:bg-neutral-200 dark:hover:bg-neutral-700"
              >
                取消
              </button>
            </div>
          </div>
        ) : (
          <button
            onClick={() => setAdding(true)}
            className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-md border border-dashed border-neutral-300 py-2.5 text-[12px] text-neutral-500 hover:border-neutral-400 hover:text-neutral-700 dark:border-neutral-600 dark:hover:border-neutral-500"
          >
            <Plus className="h-3.5 w-3.5" strokeWidth={1.75} /> 新建变更提案
          </button>
        )}
      </div>
    </div>
  );
}
