import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, Check, CheckCircle, Loader2, Play, Sparkles, FlaskConical } from "lucide-react";
import { vizApi } from "@/lib/api/viz";
import { engineApi } from "@/lib/api/engine";
import { cn } from "@/lib/cn";
import { getHealthSelectedRunId, getHealthSelectedWatchlistId, setHealthSelectedRunId, setHealthSelectedWatchlistId } from "@/lib/health-ui-state";
import { Markdown } from "@/components/Markdown";
import { FindingDetailDrawer } from "@/components/monitor/FindingDetailDrawer";
import { MonitorWatchlistSelector } from "@/components/monitor/MonitorWatchlistSelector";
import readmeContent from "@/docs/health-report-readme.md?raw";
import type {
  HealthFinding,
  MonitorRun,
  ActionItem,
  ActionItemDraft,
  ActionTask,
  ActionFeedback,
} from "@/types";

const LIFECYCLE_LABEL: Record<string, string> = {
  new: "新增",
  recurring: "持续",
  worsening: "加剧",
  resolved: "恢复",
};

const SEVERITY_DOT: Record<string, string> = {
  critical: "bg-red-500",
  warn: "bg-amber-500",
  info: "bg-blue-500",
};

function monitorReportKey(runId: string): string {
  // 复用 ActionItem.reportPath（string）通道作为关联/去重 key，避免扩 types
  return "monitor:" + runId;
}

export function HealthReportPane({ workspaceId }: { workspaceId: string | null }) {
  const [view, setView] = useState<"main" | "readme">("main");
  const [watchlistId, setWatchlistId] = useState(getHealthSelectedWatchlistId());
  const [runs, setRuns] = useState<MonitorRun[]>([]);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [findings, setFindings] = useState<HealthFinding[]>([]);
  const [selectedFindingIds, setSelectedFindingIds] = useState<Set<string>>(new Set());
  const [detailFinding, setDetailFinding] = useState<HealthFinding | null>(null);

  const [drafts, setDrafts] = useState<ActionItemDraft[]>([]);
  const [items, setItems] = useState<ActionItem[]>([]);
  const [tasks, setTasks] = useState<ActionTask[]>([]);
  const [feedbacks, setFeedbacks] = useState<Record<string, ActionFeedback>>({});

  const [extracting, setExtracting] = useState(false);
  const [loadingData, setLoadingData] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [feedbackFormTaskId, setFeedbackFormTaskId] = useState<string | null>(null);
  const [feedbackForm, setFeedbackForm] = useState({ outcome: "", metricDelta: "", score: 5 });

  // D-EVOLVE2: eval candidate submission state
  const [evalSubmitting, setEvalSubmitting] = useState<Set<string>>(new Set());
  const [evalSubmitted, setEvalSubmitted] = useState<Set<string>>(new Set());

  // 加载 runs（workspace 切换重置）
  useEffect(() => {
    if (!workspaceId) {
      setHealthSelectedRunId(null);
      setRuns([]);
      setSelectedRunId(null);
      setFindings([]);
      setDetailFinding(null);
      setSelectedFindingIds(new Set());
      setDrafts([]);
      setItems([]);
      setTasks([]);
      setFeedbacks({});
      return;
    }
    let cancelled = false;
    vizApi.listMonitorRuns(workspaceId, { watchlistId }).then((rs) => {
      if (cancelled) return;
      setRuns(rs);
      const storeId = getHealthSelectedRunId();
      if (storeId && rs.some((r) => r.id === storeId)) {
        setSelectedRunId(storeId);
      } else if (rs.length > 0) {
        setSelectedRunId(rs[0]!.id);
        setHealthSelectedRunId(rs[0]!.id);
      } else {
        setSelectedRunId(null);
        setHealthSelectedRunId(null);
      }
    }).catch((e) => { if (!cancelled) setError("加载 runs 失败: " + String(e)); });
    return () => { cancelled = true; };
  }, [workspaceId, watchlistId]);

  // 切 run 加载 findings + items + tasks
  useEffect(() => {
    if (!workspaceId || !selectedRunId) {
      setFindings([]);
      setItems([]);
      setTasks([]);
      setFeedbacks({});
      setDrafts([]);
      setSelectedFindingIds(new Set());
      return;
    }
    let cancelled = false;
    setLoadingData(true);
    const reportPath = monitorReportKey(selectedRunId);
    Promise.all([
      vizApi.listMonitorFindings(workspaceId, selectedRunId),
      vizApi.listActionItems(workspaceId, reportPath),
      vizApi.listActionTasks({ scopeId: workspaceId }),
    ]).then(async ([fs, its, tks]) => {
      if (cancelled) return;
      setFindings(fs);
      setItems(its);
      setTasks(tks);
      setSelectedFindingIds(new Set(fs.map((f) => f.id)));
      const done = tks.filter((t) => t.status === "done");
      const fbMap: Record<string, ActionFeedback> = {};
      for (const t of done) {
        try {
          const fb = await vizApi.getActionFeedback(t.id);
          if (fb) fbMap[t.id] = fb;
        } catch {
          // ignore not found
        }
      }
      if (!cancelled) setFeedbacks(fbMap);
    }).catch((e) => { if (!cancelled) setError("加载 findings/items 失败: " + String(e)); })
      .finally(() => { if (!cancelled) setLoadingData(false); });
    return () => { cancelled = true; };
  }, [workspaceId, selectedRunId]);

  const reloadRunData = useCallback(async () => {
    if (!workspaceId || !selectedRunId) return;
    const reportPath = monitorReportKey(selectedRunId);
    const [fs, its, tks] = await Promise.all([
      vizApi.listMonitorFindings(workspaceId, selectedRunId),
      vizApi.listActionItems(workspaceId, reportPath),
      vizApi.listActionTasks({ scopeId: workspaceId }),
    ]);
    setFindings(fs);
    setItems(its);
    setTasks(tks);
  }, [workspaceId, selectedRunId]);

  const toggleFinding = (id: string) => {
    setSelectedFindingIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const extractDrafts = useCallback(async () => {
    if (!workspaceId || !selectedRunId || selectedFindingIds.size === 0) return;
    setExtracting(true);
    setError(null);
    try {
      const r = await vizApi.draftMonitorActions(workspaceId, {
        workspaceId,
        runId: selectedRunId,
        findingIds: Array.from(selectedFindingIds),
      });
      setDrafts(r.drafts);
    } catch (e) {
      setError("提取行动项失败（可能 E-MONITOR2 后端未实装）: " + String(e));
    } finally {
      setExtracting(false);
    }
  }, [workspaceId, selectedRunId, selectedFindingIds]);

  const adoptDraft = async (draft: ActionItemDraft) => {
    if (!workspaceId || !selectedRunId) return;
    try {
      const reportPath = monitorReportKey(selectedRunId);
      const newItem = await vizApi.createActionItem({
        sourceKind: "session",
        scopeId: workspaceId,
        reportPath,
        title: draft.title,
        rationale: draft.rationale,
        scene: draft.scene,
        lifecycle: draft.lifecycle,
        expectedImpact: draft.expectedImpact,
        priority: draft.priority,
        effort: draft.effort,
        confidence: draft.confidence,
        status: "adopted",
      });
      setItems((prev) => [newItem, ...prev]);
      const newTask = await vizApi.createActionTask({
        actionItemId: newItem.id,
        title: "执行: " + draft.title,
        owner: "当前用户",
        status: "todo",
        priority: draft.priority,
        note: draft.rationale,
      });
      setTasks((prev) => [newTask, ...prev]);
    } catch (e) {
      setError("采纳行动项失败: " + String(e));
    }
  };

  const dismissDraft = async (draft: ActionItemDraft) => {
    if (!workspaceId || !selectedRunId) return;
    try {
      const reportPath = monitorReportKey(selectedRunId);
      const newItem = await vizApi.createActionItem({
        sourceKind: "session",
        scopeId: workspaceId,
        reportPath,
        title: draft.title,
        rationale: draft.rationale,
        scene: draft.scene,
        lifecycle: draft.lifecycle,
        expectedImpact: draft.expectedImpact,
        priority: draft.priority,
        effort: draft.effort,
        confidence: draft.confidence,
        status: "dismissed",
      });
      setItems((prev) => [newItem, ...prev]);
    } catch (e) {
      setError("忽略失败: " + String(e));
    }
  };

  const updateTaskStatus = async (id: string, status: ActionTask["status"]) => {
    try {
      const updated = await vizApi.updateActionTask(id, { status });
      setTasks((prev) => prev.map((t) => (t.id === id ? updated : t)));
    } catch (e) {
      setError("更新任务失败: " + String(e));
    }
  };

  const submitFeedback = async (taskId: string) => {
    try {
      const fb = await vizApi.submitActionFeedback(taskId, {
        adopted: true,
        outcome: feedbackForm.outcome,
        metricDelta: feedbackForm.metricDelta,
        review: "Submitted via 监测·行动环",
        score: feedbackForm.score,
      });
      setFeedbacks((prev) => ({ ...prev, [taskId]: fb }));
      setFeedbackFormTaskId(null);
      setFeedbackForm({ outcome: "", metricDelta: "", score: 5 });
    } catch (e) {
      setError("提交反馈失败: " + String(e));
    }
  };

  // D-EVOLVE2: submit finding as eval candidate (zero raw data)
  const submitEvalCandidate = async (finding: HealthFinding) => {
    const selectedRun = runs.find((r) => r.id === selectedRunId);
    if (!workspaceId || !selectedRun) return;
    setEvalSubmitting((prev) => new Set(prev).add(finding.id));
    try {
      await engineApi.createEvalRecord(workspaceId, {
        sourceFindingId: finding.id,
        failingTrace: {
          runId: selectedRun.id,
          module: "monitor",
          outcome: "fail",
          steps: [{
            stage: "monitor-finding",
            input: JSON.stringify({ suite: selectedRun.suite, ruleId: finding.ruleId, category: finding.category, kind: finding.kind, severity: finding.severity, lifecycle: finding.lifecycle, signature: finding.signature }),
            // 红线：只发 finding 衍生字段（kind/severity/comparisons 聚合数值/diagnosis 摘要），绝不发原值 finding.evidence（可能含行级明细）
            output: JSON.stringify({ title: finding.title, kind: finding.kind, severity: finding.severity, suggestion: finding.suggestion, comparisons: finding.comparisons, diagnosis: finding.diagnosis }),
            citation: finding.id,
          }],
        },
        expectedOutput: `Detect and explain production finding: ${finding.title}\nrule=${finding.ruleId}\nseverity=${finding.severity}\nlifecycle=${finding.lifecycle}`,
        passCondition: "Reproduce the same finding signature from sanitized evidence and propose a bounded corrective change without raw row-level data.",
      });
      setEvalSubmitted((prev) => new Set(prev).add(finding.id));
    } catch (e) {
      setError("提交 eval 候选失败: " + String(e));
    } finally {
      setEvalSubmitting((prev) => {
        const next = new Set(prev);
        next.delete(finding.id);
        return next;
      });
    }
  };

  // 去重：drafts 已被 items（同 reportPath + title）登记的不再显示
  const pendingDrafts = drafts.filter(
    (d) => !items.some((i) => i.title === d.title),
  );

  // 只展示本 run 的 items 关联的 tasks
  const itemIds = new Set(items.map((i) => i.id));
  const runTasks = tasks.filter((t) => itemIds.has(t.actionItemId));

  const selectedRun = runs.find((r) => r.id === selectedRunId) ?? null;
  const adoptCountForCurrentRun = items.filter((i) => i.status === "adopted").length;

  return (
    <div className="flex h-full min-h-0 flex-col bg-white dark:bg-neutral-950">
      <div className="flex items-center justify-end border-b border-neutral-200 bg-neutral-50 px-4 py-2 dark:border-neutral-800 dark:bg-neutral-900">
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
        <>
      {/* 顶部：run 选择 + 触发提取 */}
      <div className="flex shrink-0 flex-col gap-2 border-b border-neutral-200 px-4 py-3 dark:border-neutral-800">
        <MonitorWatchlistSelector
          workspaceId={workspaceId}
          value={watchlistId}
          onChange={(id) => {
            setHealthSelectedWatchlistId(id);
            setHealthSelectedRunId(null);
            setSelectedRunId(null);
            setFindings([]);
            setSelectedFindingIds(new Set());
            setDetailFinding(null);
            setDrafts([]);
            setItems([]);
            setTasks([]);
            setFeedbacks({});
            setWatchlistId(id);
          }}
          compact
        />
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-2 text-[13px] font-semibold text-neutral-900 dark:text-neutral-100">
            <Sparkles className="h-4 w-4 text-emerald-500" strokeWidth={1.75} />
            监测·行动环
          </div>
          <select
            value={selectedRunId ?? ""}
            onChange={(e) => {
              const next = e.target.value || null;
              setSelectedRunId(next);
              setHealthSelectedRunId(next);
            }}
            disabled={runs.length === 0}
            className="h-8 min-w-[260px] flex-1 rounded-md border border-neutral-200 bg-transparent px-2 text-[12px] text-neutral-700 outline-none disabled:opacity-50 dark:border-neutral-700 dark:text-neutral-200"
          >
            {runs.length === 0 ? (
              <option value="">暂无监测运行，先到观星台运行监测</option>
            ) : (
              runs.map((r) => (
                <option key={r.id} value={r.id}>
                  {new Date(r.startedAt).toLocaleString()} · {r.problemCount}问题/{r.riskCount}风险 · {r.status}
                </option>
              ))
            )}
          </select>
          <button
            onClick={() => void extractDrafts()}
            disabled={!selectedRunId || selectedFindingIds.size === 0 || extracting}
            className="inline-flex h-8 items-center gap-1.5 rounded-md bg-emerald-600 px-3 text-[12px] font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
          >
            {extracting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" strokeWidth={1.75} />}
            从 {selectedFindingIds.size} 个 finding 提取行动项
          </button>
        </div>
      </div>

      {error && (
        <div className="flex items-center gap-1.5 border-b border-rose-100 bg-rose-50 px-4 py-2 text-[12px] text-rose-600 dark:border-rose-950 dark:bg-rose-950/30 dark:text-rose-300">
          <AlertTriangle className="h-3.5 w-3.5" />
          {error}
        </div>
      )}

      {/* findings 选择条 */}
      {selectedRun && findings.length > 0 && (
        <details className="shrink-0 border-b border-neutral-200 px-4 py-2 text-[12px] dark:border-neutral-800">
          <summary className="cursor-pointer text-neutral-600 dark:text-neutral-300">
            选择参与提取的 finding（已选 {selectedFindingIds.size}/{findings.length}）
          </summary>
          <div className="mt-2 max-h-40 space-y-1 overflow-y-auto">
            {findings.map((f) => {
              const checked = selectedFindingIds.has(f.id);
              return (
                <label key={f.id} className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggleFinding(f.id)}
                    className="rounded"
                  />
                  <span className={cn("h-2 w-2 rounded-full", SEVERITY_DOT[f.severity] ?? "bg-neutral-400")} />
                  <span className="flex-1 text-[11px] text-neutral-700 dark:text-neutral-200">{f.title}</span>
                  <span className="text-[10px] text-neutral-400">[{LIFECYCLE_LABEL[f.lifecycle] ?? f.lifecycle}]</span>
                  {evalSubmitted.has(f.id) ? (
                    <span className="inline-flex items-center gap-0.5 rounded bg-violet-100 px-1.5 py-0.5 text-[10px] text-violet-700 dark:bg-violet-900/40 dark:text-violet-300">
                      <Check className="h-2.5 w-2.5" /> 已提为候选
                    </span>
                  ) : (
                    <button
                      onClick={(e) => { e.preventDefault(); void submitEvalCandidate(f); }}
                      disabled={evalSubmitting.has(f.id)}
                      className="inline-flex items-center gap-0.5 rounded border border-violet-200 bg-white px-1.5 py-0.5 text-[10px] text-violet-600 hover:bg-violet-50 disabled:opacity-50 dark:border-violet-800 dark:bg-neutral-900 dark:text-violet-400 dark:hover:bg-violet-950/40"
                      title="将此 finding 提为 eval 候选，供后续评测改进"
                    >
                      {evalSubmitting.has(f.id) ? <Loader2 className="h-2.5 w-2.5 animate-spin" /> : <FlaskConical className="h-2.5 w-2.5" />}
                      提为 eval 候选
                    </button>
                  )}
                  <button
                    onClick={(e) => { e.preventDefault(); setDetailFinding(f); }}
                    className="rounded border border-neutral-200 bg-white px-1.5 py-0.5 text-[10px] text-neutral-600 hover:bg-neutral-50 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-300 dark:hover:bg-neutral-800"
                  >
                    详情 / 处理
                  </button>
                </label>
              );
            })}
          </div>
        </details>
      )}

      <div className="flex min-h-0 flex-1 divide-x divide-neutral-200 overflow-x-auto dark:divide-neutral-800">
        {/* ① 分析与提炼 */}
        <div className="flex min-h-0 flex-1 flex-col" style={{ minWidth: 320 }}>
          <div className="sticky top-0 flex shrink-0 items-center justify-between border-b border-neutral-100 bg-neutral-50/50 px-4 py-3 text-[13px] font-medium dark:border-neutral-800 dark:bg-neutral-900/50">
            <span>① 分析与提炼</span>
            <span className="rounded-full border border-neutral-200 bg-white px-2 py-0.5 text-[11px] text-neutral-500 dark:border-neutral-700 dark:bg-neutral-800">
              {pendingDrafts.length} 待处理
            </span>
          </div>
          <div className="flex flex-1 flex-col gap-3 overflow-y-auto p-4">
            {loadingData && <p className="text-[12px] text-neutral-400">加载中…</p>}
            {!loadingData && pendingDrafts.length === 0 && (
              <div className="py-10 text-center text-[12px] text-neutral-400">
                {selectedRunId
                  ? items.length > 0
                    ? "无新待处理草稿。点上方提取以重新生成。"
                    : "选好 finding 后，点上方按钮提取行动项。"
                  : "请先在观星台运行监测。"}
              </div>
            )}
            {pendingDrafts.map((draft, idx) => (
              <div key={idx} className="flex flex-col gap-2 rounded-lg border border-amber-200 bg-amber-50/50 p-3 shadow-sm dark:border-amber-900 dark:bg-amber-950/30">
                <div className="text-[13px] font-semibold text-amber-950 dark:text-amber-100">{draft.title}</div>
                <div className="text-[12px] text-amber-800/80 dark:text-amber-200/80">{draft.rationale}</div>
                {(draft.scene || draft.lifecycle) && (
                  <div className="mt-1 flex flex-wrap gap-1">
                    {draft.scene && <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] text-amber-800 dark:bg-amber-900 dark:text-amber-200">场景: {draft.scene}</span>}
                    {draft.lifecycle && <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] text-amber-800 dark:bg-amber-900 dark:text-amber-200">阶段: {draft.lifecycle}</span>}
                  </div>
                )}
                <div className="mt-1 text-[11px] text-emerald-600 dark:text-emerald-400">
                  预期: {draft.expectedImpact}
                </div>
                <div className="mt-2 flex justify-end gap-2">
                  <button onClick={() => void dismissDraft(draft)} className="rounded px-2 py-1 text-[11px] text-amber-700 transition-colors hover:bg-amber-200 dark:text-amber-300 dark:hover:bg-amber-800">
                    忽略
                  </button>
                  <button onClick={() => void adoptDraft(draft)} className="flex items-center gap-1 rounded bg-amber-500 px-3 py-1 text-[11px] text-white shadow-sm transition-colors hover:bg-amber-600">
                    <Check className="h-3 w-3" />
                    采纳并建任务
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* ② 任务执行 */}
        <div className="flex min-h-0 flex-1 flex-col bg-neutral-50/30 dark:bg-neutral-900/30" style={{ minWidth: 320 }}>
          <div className="sticky top-0 flex shrink-0 items-center justify-between border-b border-neutral-100 bg-neutral-50/50 px-4 py-3 text-[13px] font-medium dark:border-neutral-800 dark:bg-neutral-900/50">
            <span>② 任务执行</span>
            <span className="rounded-full border border-neutral-200 bg-white px-2 py-0.5 text-[11px] text-neutral-500 dark:border-neutral-700 dark:bg-neutral-800">
              {runTasks.filter((t) => t.status !== "done").length} 进行中
            </span>
          </div>
          <div className="flex flex-1 flex-col gap-3 overflow-y-auto p-4">
            {runTasks.length === 0 ? (
              <div className="py-10 text-center text-[12px] text-neutral-400">
                暂无任务。采纳行动项后自动创建。
              </div>
            ) : runTasks.map((task) => (
              <div key={task.id} className="flex flex-col gap-2 rounded-lg border border-neutral-200 bg-white p-3 shadow-sm dark:border-neutral-800 dark:bg-neutral-900">
                <div className="flex items-start justify-between gap-2">
                  <div className="text-[13px] font-semibold text-neutral-800 dark:text-neutral-200">{task.title}</div>
                  <select
                    value={task.status}
                    onChange={(e) => void updateTaskStatus(task.id, e.target.value as ActionTask["status"])}
                    className={cn(
                      "rounded border px-2 py-0.5 text-[11px] outline-none",
                      task.status === "todo" && "bg-neutral-100 text-neutral-600 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-300",
                      task.status === "doing" && "border-blue-200 bg-blue-50 text-blue-600 dark:border-blue-800 dark:bg-blue-900/30 dark:text-blue-400",
                      task.status === "done" && "border-emerald-200 bg-emerald-50 text-emerald-600 dark:border-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400",
                    )}
                  >
                    <option value="todo">待处理</option>
                    <option value="doing">执行中</option>
                    <option value="done">已完成</option>
                    <option value="cancelled">已取消</option>
                  </select>
                </div>
                <div className="line-clamp-2 text-[11px] text-neutral-500 dark:text-neutral-400">{task.note}</div>
                <div className="mt-1 flex items-center justify-between border-t border-neutral-100 pt-2 dark:border-neutral-800">
                  <span className="text-[10px] text-neutral-400">负责人: {task.owner}</span>
                  {task.status === "done" && !feedbacks[task.id] && (
                    <button onClick={() => setFeedbackFormTaskId(task.id)} className="text-[11px] font-medium text-indigo-600 hover:text-indigo-700 dark:text-indigo-400 dark:hover:text-indigo-300">
                      记录反馈 →
                    </button>
                  )}
                  {feedbacks[task.id] && (
                    <span className="flex items-center gap-1 text-[10px] text-emerald-600 dark:text-emerald-400">
                      <CheckCircle className="h-3 w-3" /> 已闭环
                    </span>
                  )}
                </div>

                {feedbackFormTaskId === task.id && (
                  <div className="mt-2 flex flex-col gap-2 border-t border-neutral-200 pt-2 dark:border-neutral-800">
                    <input
                      placeholder="执行结果概述"
                      value={feedbackForm.outcome}
                      onChange={(e) => setFeedbackForm((prev) => ({ ...prev, outcome: e.target.value }))}
                      className="rounded border bg-transparent px-2 py-1 text-[11px] outline-none dark:border-neutral-700"
                    />
                    <input
                      placeholder="指标变化 (如: 转化率+2%)"
                      value={feedbackForm.metricDelta}
                      onChange={(e) => setFeedbackForm((prev) => ({ ...prev, metricDelta: e.target.value }))}
                      className="rounded border bg-transparent px-2 py-1 text-[11px] outline-none dark:border-neutral-700"
                    />
                    <div className="mt-1 flex justify-end gap-2">
                      <button onClick={() => setFeedbackFormTaskId(null)} className="text-[11px] text-neutral-500 hover:text-neutral-700 dark:hover:text-neutral-300">取消</button>
                      <button onClick={() => void submitFeedback(task.id)} className="rounded bg-indigo-600 px-3 py-1 text-[11px] text-white hover:bg-indigo-700">提交</button>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* ③ 效果反馈 */}
        <div className="flex min-h-0 flex-1 flex-col bg-emerald-50/10 dark:bg-emerald-900/5" style={{ minWidth: 320 }}>
          <div className="sticky top-0 flex shrink-0 items-center justify-between border-b border-neutral-100 bg-neutral-50/50 px-4 py-3 text-[13px] font-medium dark:border-neutral-800 dark:bg-neutral-900/50">
            <span>③ 效果反馈</span>
            <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[11px] text-emerald-600 dark:border-emerald-800 dark:bg-emerald-900/30">
              {Object.keys(feedbacks).length} 已闭环
            </span>
          </div>
          <div className="flex flex-1 flex-col gap-3 overflow-y-auto p-4">
            {Object.keys(feedbacks).length === 0 ? (
              <div className="py-10 text-center text-[12px] text-neutral-400">
                暂无反馈。完成任务后记录反馈以闭环。
              </div>
            ) : Object.values(feedbacks).map((fb) => {
              const task = runTasks.find((t) => t.id === fb.taskId);
              return (
                <div key={fb.id} className="flex flex-col gap-1.5 rounded-lg border border-emerald-200 bg-emerald-50 p-3 shadow-sm dark:border-emerald-900 dark:bg-emerald-950/20">
                  <div className="truncate text-[12px] font-semibold text-emerald-900 dark:text-emerald-100">
                    {task?.title ?? "未知任务"}
                  </div>
                  <div className="text-[11px] text-emerald-800/80 dark:text-emerald-200/80">
                    <span className="font-medium">结果:</span> {fb.outcome || "无"}
                  </div>
                  <div className="text-[11px] text-emerald-800/80 dark:text-emerald-200/80">
                    <span className="font-medium">指标:</span> <span className="font-semibold text-rose-600 dark:text-rose-400">{fb.metricDelta || "无数据"}</span>
                  </div>
                  <div className="mt-1 flex items-center justify-between border-t border-emerald-100 pt-1.5 dark:border-emerald-800/50">
                    <span className="text-[10px] text-emerald-600/70 dark:text-emerald-400/70">评分: {fb.score}/10</span>
                    <span className="text-[10px] text-emerald-600/70 dark:text-emerald-400/70">{new Date(fb.createdAt).toLocaleDateString()}</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* 底部状态条 */}
      {selectedRun && (
        <div className="shrink-0 border-t border-neutral-200 bg-neutral-50/50 px-4 py-1.5 text-[11px] text-neutral-500 dark:border-neutral-800 dark:bg-neutral-900/50">
          run {selectedRun.id.slice(0, 8)}… · {findings.length} findings · {items.length} 行动项（{adoptCountForCurrentRun} 采纳） · {runTasks.length} 任务 · {Object.keys(feedbacks).length} 反馈
        </div>
      )}
      <FindingDetailDrawer
        workspaceId={workspaceId}
        run={selectedRun}
        finding={detailFinding}
        items={items}
        tasks={tasks}
        onClose={() => setDetailFinding(null)}
        onChanged={() => void reloadRunData()}
      />
      </>
      )}
    </div>
  );
}
