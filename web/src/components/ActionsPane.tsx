import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, Check, Loader2, RefreshCw, Sparkles, Play, CheckCircle } from "lucide-react";
import { api } from "@/lib/api";
import { vizApi, type ActionItem, type ActionItemDraft, type ActionTask, type ActionFeedback } from "@/lib/api/viz";
import { cn } from "@/lib/cn";
import { useResumableTask } from "@/lib/resumableTask";
import type { Flow, FlowTreeNode, PiModel } from "@/types";

type Scope =
  | { type: "session"; sessionId: string | null }
  | { type: "flow"; flow: Flow | null }
  | { type: "workspace"; workspaceId: string };

interface ReportOption {
  id: string;
  label: string;
  pathId: number;
  relPath: string;
}

function basenamePath(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).at(-1) ?? path;
}

function flattenFiles(node: FlowTreeNode | null): FlowTreeNode[] {
  const out: FlowTreeNode[] = [];
  const walk = (n: FlowTreeNode) => {
    if (n.kind === "file") out.push(n);
    for (const child of n.children ?? []) walk(child);
  };
  if (node) walk(node);
  return out;
}

function isReportFile(name: string): boolean {
  return /\.(md|markdown|txt)$/i.test(name)
    && (/report|summary|result|insight|分析|报告|结论|洞察|建议/i.test(name)
      || /\.(md|markdown)$/i.test(name));
}

const DEFAULT_MODEL = "minimax-cn/MiniMax-M3";

function defaultModelId(models: PiModel[]): string {
  return models.find((model) => model.id === DEFAULT_MODEL)?.id
    ?? models.find((model) => model.isDefault)?.id
    ?? models[0]?.id
    ?? DEFAULT_MODEL;
}

export function ActionsPane({
  scope,
  models,
}: {
  scope: Scope;
  models: PiModel[];
}) {
  const [reports, setReports] = useState<ReportOption[]>([]);
  const [selectedReportId, setSelectedReportId] = useState("");
  const [model, setModel] = useState(DEFAULT_MODEL);
  const [prompt] = useState("");
  const [loadingReports, setLoadingReports] = useState(false);
  const [error, setError] = useState("");
  
  const scopeRef = useRef(scope);
  scopeRef.current = scope;

  const scopeType = scope.type;
  const scopeSessionId = scope.type === "session" ? scope.sessionId : null;
  const scopeFlowId = scope.type === "flow" ? scope.flow?.id ?? null : null;
  const scopeWorkspaceId = scope.type === "workspace" ? scope.workspaceId : null;

  const selectedReport = reports.find((report) => report.id === selectedReportId) ?? null;
  const currentScopeId = scopeSessionId || scopeFlowId || (scopeWorkspaceId ? String(scopeWorkspaceId) : "");
  // 统一报告身份 key（pathId:relPath）：action-items 按它关联、去重；旧 artifact-path key 的历史 items 向前失联（已决策）。
  const reportPathKey = selectedReport ? `${selectedReport.pathId}:${selectedReport.relPath}` : "";
  const sourceKind: "session" | "flow-run" = scope.type === "flow" ? "flow-run" : "session";

  const taskKey = useMemo(
    () =>
      selectedReport
        ? "actions:" + currentScopeId + ":" + reportPathKey
        : "actions:__inactive__",
    [currentScopeId, reportPathKey, selectedReport],
  );

  const extractTask = useResumableTask<ActionItemDraft[]>(taskKey);
  const generating = extractTask.status === "running";
  const drafts = extractTask.data ?? [];
  const taskError = extractTask.error;

  const [items, setItems] = useState<ActionItem[]>([]);
  const [tasks, setTasks] = useState<ActionTask[]>([]);
  const [feedbacks, setFeedbacks] = useState<Record<string, ActionFeedback>>({});

  const loadReports = useCallback(async () => {
    const sc = scopeRef.current;
    setLoadingReports(true);
    setError("");
    setReports([]);
    setSelectedReportId("");
    try {
      // 统一数据源：扫「报告输出」登记路径（与汇报版本/报告审核一致），不再扫 session/flow 原生 artifact tree。
      const paths = sc.type === "session"
        ? sc.sessionId ? await api.listSessionPaths(sc.sessionId, "report") : []
        : sc.type === "workspace"
          ? sc.workspaceId ? await api.listWorkspacePaths(sc.workspaceId, "report") : []
          : sc.flow ? await api.listFlowPaths(sc.flow.id, "report") : [];
      const found = await Promise.all(paths.map(async (path) => {
        if (path.kind === "file") {
          return isReportFile(basenamePath(path.path))
            ? [{ id: `${path.id}:`, label: basenamePath(path.path), pathId: path.id, relPath: "" }]
            : [];
        }
        const tree = await api.workspacePathTree(path.id);
        return flattenFiles(tree)
          .filter((file) => isReportFile(file.name))
          .map((file) => ({
            id: `${path.id}:${file.path}`,
            label: file.path,
            pathId: path.id,
            relPath: file.path,
          }));
      }));
      const next = found.flat();
      setReports(next);
      setSelectedReportId(next[0]?.id ?? "");
    } catch (err) {
      setError(String(err));
    } finally {
      setLoadingReports(false);
    }
  }, [scopeType, scopeSessionId, scopeFlowId, scopeWorkspaceId]);

  useEffect(() => {
    void loadReports();
  }, [loadReports]);

  const loadData = useCallback(async () => {
    if (!currentScopeId) return;
    try {
      const fetchedItems = await vizApi.listActionItems(currentScopeId, reportPathKey || undefined);
      setItems(fetchedItems);
      const fetchedTasks = await vizApi.listActionTasks({ scopeId: currentScopeId });
      setTasks(fetchedTasks);
      
      const doneTaskIds = fetchedTasks.filter(t => t.status === "done").map(t => t.id);
      const newFeedbacks: Record<string, ActionFeedback> = {};
      for (const tid of doneTaskIds) {
        try {
          const fb = await vizApi.getActionFeedback(tid);
          if (fb) newFeedbacks[tid] = fb;
        } catch {
          // ignore not found
        }
      }
      setFeedbacks(newFeedbacks);
    } catch (err) {
      console.error("Failed to load actions data", err);
    }
  }, [currentScopeId, reportPathKey, selectedReport]);

  useEffect(() => {
    void loadData();
  }, [loadData, selectedReport?.id]);

  useEffect(() => {
    if (models.some((item) => item.id === model)) return;
    setModel(defaultModelId(models));
  }, [model, models]);

  const extract = useCallback(async () => {
    if (!selectedReport || generating) return;
    setError("");
    await extractTask.start(async () => {
      const res = await vizApi.extractActions({
        pathId: selectedReport.pathId,
        relPath: selectedReport.relPath,
        prompt,
        model,
      });
      return res;
    });
  }, [selectedReport, generating, extractTask, prompt, model]);

  const adoptDraft = async (draft: ActionItemDraft) => {
    if (!selectedReport) return;
    try {
      const newItem = await vizApi.createActionItem({
        sourceKind,
        scopeId: currentScopeId,
        reportPath: reportPathKey,
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
      setItems(prev => [newItem, ...prev]);
      
      // Auto create task
      const newTask = await vizApi.createActionTask({
        actionItemId: newItem.id,
        title: `执行: ${draft.title}`,
        owner: "当前用户",
        status: "todo",
        priority: draft.priority,
        note: draft.rationale,
      });
      setTasks(prev => [newTask, ...prev]);
    } catch (err) {
      setError(String(err));
    }
  };

  const dismissDraft = async (draft: ActionItemDraft) => {
    if (!selectedReport) return;
    try {
      const newItem = await vizApi.createActionItem({
        sourceKind,
        scopeId: currentScopeId,
        reportPath: reportPathKey,
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
      setItems(prev => [newItem, ...prev]);
    } catch (err) {
      setError(String(err));
    }
  };

  const updateTaskStatus = async (id: string, status: ActionTask["status"]) => {
    try {
      const updated = await vizApi.updateActionTask(id, { status });
      setTasks(prev => prev.map(t => t.id === id ? updated : t));
    } catch (err) {
      setError(String(err));
    }
  };

  const [feedbackFormTaskId, setFeedbackFormTaskId] = useState<string | null>(null);
  const [feedbackForm, setFeedbackForm] = useState({ outcome: "", metricDelta: "", score: 5 });

  const submitFeedback = async (taskId: string) => {
    try {
      const fb = await vizApi.submitActionFeedback(taskId, {
        adopted: true,
        outcome: feedbackForm.outcome,
        metricDelta: feedbackForm.metricDelta,
        review: "Review submitted via UI",
        score: feedbackForm.score,
      });
      setFeedbacks(prev => ({ ...prev, [taskId]: fb }));
      setFeedbackFormTaskId(null);
    } catch (err) {
      setError(String(err));
    }
  };

  const emptyHint = "请先在「报告输出」tab 添加报告输出文件夹或文件";

  const pendingDrafts = drafts.filter(d => !items.some(i => i.title === d.title && i.reportPath === reportPathKey));

  return (
    <div className="flex h-full min-h-0 flex-col bg-white dark:bg-neutral-950">
      <div className="flex shrink-0 flex-col gap-2 border-b border-neutral-200 px-4 py-3 dark:border-neutral-800">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 text-[13px] font-semibold text-neutral-900 dark:text-neutral-100">
            <Sparkles className="h-4 w-4 text-emerald-500" strokeWidth={1.75} />
            业务行动
          </div>
          <select
            value={selectedReportId}
            onChange={(event) => setSelectedReportId(event.target.value)}
            disabled={loadingReports || reports.length === 0 || generating}
            className="h-8 min-w-0 flex-1 rounded-md border border-neutral-200 bg-transparent px-2 text-[12px] text-neutral-700 outline-none disabled:opacity-50 dark:border-neutral-700 dark:text-neutral-200"
          >
            {reports.length === 0 ? (
              <option value="">{loadingReports ? "正在扫描报告…" : emptyHint}</option>
            ) : (
              reports.map((report) => (
                <option key={report.id} value={report.id}>{report.label}</option>
              ))
            )}
          </select>
          <select
            value={model}
            onChange={(event) => setModel(event.target.value)}
            disabled={generating}
            className="h-8 w-52 rounded-md border border-neutral-200 bg-transparent px-2 text-[12px] text-neutral-700 outline-none disabled:opacity-50 dark:border-neutral-700 dark:text-neutral-200"
          >
            {(models.length > 0 ? models : [{ id: DEFAULT_MODEL, provider: "minimax-cn", model: "MiniMax-M3", isDefault: true }]).map((item) => (
              <option key={item.id} value={item.id}>{item.id}</option>
            ))}
          </select>
          <button
            onClick={() => void loadReports()}
            disabled={loadingReports || generating}
            className="inline-flex h-8 items-center gap-1.5 rounded-md px-2 text-[12px] text-neutral-500 hover:bg-neutral-100 disabled:opacity-50 dark:text-neutral-400 dark:hover:bg-neutral-800"
          >
            <RefreshCw className={cn("h-3.5 w-3.5", loadingReports && "animate-spin")} strokeWidth={1.75} />
            刷新
          </button>
          <button
            onClick={() => void extract()}
            disabled={!selectedReport || generating}
            className="inline-flex h-8 items-center gap-1.5 rounded-md bg-emerald-600 px-3 text-[12px] font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
          >
            {generating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" strokeWidth={1.75} />}
            提取行动项
          </button>
        </div>
      </div>

      {(error || taskError) && (
        <div className="flex items-center gap-1.5 border-b border-rose-100 bg-rose-50 px-4 py-2 text-[12px] text-rose-600 dark:border-rose-950 dark:bg-rose-950/30 dark:text-rose-300">
          <AlertTriangle className="h-3.5 w-3.5" />
          {error || taskError}
        </div>
      )}

      <div className="flex min-h-0 flex-1 divide-x divide-neutral-200 dark:divide-neutral-800 overflow-x-auto">
        {/* Step 1: 提取的行动项 */}
        <div className="flex-1 min-w-[320px] flex flex-col min-h-0">
          <div className="px-4 py-3 border-b border-neutral-100 dark:border-neutral-800 bg-neutral-50/50 dark:bg-neutral-900/50 font-medium text-[13px] sticky top-0 flex justify-between items-center">
            <span>① 分析与提炼</span>
            <span className="text-[11px] text-neutral-500 bg-white dark:bg-neutral-800 px-2 py-0.5 rounded-full border dark:border-neutral-700">
              {pendingDrafts.length} 待处理
            </span>
          </div>
          <div className="p-4 overflow-y-auto flex-1 flex flex-col gap-3">
            {pendingDrafts.length === 0 ? (
              <div className="text-center text-neutral-400 text-[12px] py-10">
                暂无待处理的行动项。请提取或选择其他报告。
              </div>
            ) : pendingDrafts.map((draft, idx) => (
              <div key={idx} className="border border-amber-200 dark:border-amber-900 bg-amber-50/50 dark:bg-amber-950/30 rounded-lg p-3 shadow-sm flex flex-col gap-2">
                <div className="font-semibold text-[13px] text-amber-950 dark:text-amber-100">{draft.title}</div>
                <div className="text-[12px] text-amber-800/80 dark:text-amber-200/80">{draft.rationale}</div>
                
                {(draft.scene || draft.lifecycle) && (
                  <div className="flex flex-wrap gap-1 mt-1">
                    {draft.scene && <span className="text-[10px] bg-amber-100 dark:bg-amber-900 text-amber-800 dark:text-amber-200 px-1.5 py-0.5 rounded">场景: {draft.scene}</span>}
                    {draft.lifecycle && <span className="text-[10px] bg-amber-100 dark:bg-amber-900 text-amber-800 dark:text-amber-200 px-1.5 py-0.5 rounded">阶段: {draft.lifecycle}</span>}
                  </div>
                )}
                <div className="text-[11px] text-emerald-600 dark:text-emerald-400 mt-1">
                  预期: {draft.expectedImpact}
                </div>
                
                <div className="flex justify-end gap-2 mt-2">
                  <button onClick={() => void dismissDraft(draft)} className="text-[11px] px-2 py-1 rounded hover:bg-amber-200 dark:hover:bg-amber-800 text-amber-700 dark:text-amber-300 transition-colors">
                    忽略
                  </button>
                  <button onClick={() => void adoptDraft(draft)} className="text-[11px] px-3 py-1 rounded bg-amber-500 text-white hover:bg-amber-600 shadow-sm transition-colors flex items-center gap-1">
                    <Check className="h-3 w-3" />
                    采纳并建任务
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Step 2: 任务执行 */}
        <div className="flex-1 min-w-[320px] flex flex-col min-h-0 bg-neutral-50/30 dark:bg-neutral-900/30">
          <div className="px-4 py-3 border-b border-neutral-100 dark:border-neutral-800 bg-neutral-50/50 dark:bg-neutral-900/50 font-medium text-[13px] sticky top-0 flex justify-between items-center">
            <span>② 任务执行</span>
            <span className="text-[11px] text-neutral-500 bg-white dark:bg-neutral-800 px-2 py-0.5 rounded-full border dark:border-neutral-700">
              {tasks.filter(t => t.status !== 'done').length} 进行中
            </span>
          </div>
          <div className="p-4 overflow-y-auto flex-1 flex flex-col gap-3">
            {tasks.length === 0 ? (
              <div className="text-center text-neutral-400 text-[12px] py-10">
                暂无任务。采纳行动项后会自动创建。
              </div>
            ) : tasks.map((task) => (
              <div key={task.id} className="border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 rounded-lg p-3 shadow-sm flex flex-col gap-2">
                <div className="flex justify-between items-start gap-2">
                  <div className="font-semibold text-[13px] text-neutral-800 dark:text-neutral-200">{task.title}</div>
                  <select
                    value={task.status}
                    onChange={(e) => void updateTaskStatus(task.id, e.target.value as ActionTask["status"])}
                    className={cn(
                      "text-[11px] px-2 py-0.5 rounded border outline-none",
                      task.status === "todo" && "bg-neutral-100 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300 dark:border-neutral-700",
                      task.status === "doing" && "bg-blue-50 text-blue-600 border-blue-200 dark:bg-blue-900/30 dark:text-blue-400 dark:border-blue-800",
                      task.status === "done" && "bg-emerald-50 text-emerald-600 border-emerald-200 dark:bg-emerald-900/30 dark:text-emerald-400 dark:border-emerald-800"
                    )}
                  >
                    <option value="todo">待处理</option>
                    <option value="doing">执行中</option>
                    <option value="done">已完成</option>
                    <option value="cancelled">已取消</option>
                  </select>
                </div>
                <div className="text-[11px] text-neutral-500 dark:text-neutral-400 line-clamp-2">{task.note}</div>
                <div className="flex justify-between items-center mt-1 pt-2 border-t border-neutral-100 dark:border-neutral-800">
                  <span className="text-[10px] text-neutral-400">负责人: {task.owner}</span>
                  {task.status === "done" && !feedbacks[task.id] && (
                    <button onClick={() => setFeedbackFormTaskId(task.id)} className="text-[11px] text-indigo-600 hover:text-indigo-700 dark:text-indigo-400 dark:hover:text-indigo-300 font-medium">
                      记录反馈 ➔
                    </button>
                  )}
                  {feedbacks[task.id] && (
                    <span className="text-[10px] text-emerald-600 dark:text-emerald-400 flex items-center gap-1">
                      <CheckCircle className="w-3 h-3" /> 已闭环
                    </span>
                  )}
                </div>

                {/* Feedback inline form */}
                {feedbackFormTaskId === task.id && (
                  <div className="mt-2 pt-2 border-t border-neutral-200 dark:border-neutral-800 flex flex-col gap-2">
                    <input
                      placeholder="执行结果概述"
                      value={feedbackForm.outcome}
                      onChange={e => setFeedbackForm(prev => ({...prev, outcome: e.target.value}))}
                      className="text-[11px] px-2 py-1 rounded border dark:border-neutral-700 bg-transparent outline-none"
                    />
                    <input
                      placeholder="指标变化 (如: 转化率+2%)"
                      value={feedbackForm.metricDelta}
                      onChange={e => setFeedbackForm(prev => ({...prev, metricDelta: e.target.value}))}
                      className="text-[11px] px-2 py-1 rounded border dark:border-neutral-700 bg-transparent outline-none"
                    />
                    <div className="flex justify-end gap-2 mt-1">
                      <button onClick={() => setFeedbackFormTaskId(null)} className="text-[11px] text-neutral-500 hover:text-neutral-700 dark:hover:text-neutral-300">取消</button>
                      <button onClick={() => void submitFeedback(task.id)} className="text-[11px] bg-indigo-600 text-white px-3 py-1 rounded hover:bg-indigo-700">提交</button>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Step 3: 效果反馈 */}
        <div className="flex-1 min-w-[320px] flex flex-col min-h-0 bg-emerald-50/10 dark:bg-emerald-900/5">
          <div className="px-4 py-3 border-b border-neutral-100 dark:border-neutral-800 bg-neutral-50/50 dark:bg-neutral-900/50 font-medium text-[13px] sticky top-0 flex justify-between items-center">
            <span>③ 效果反馈</span>
            <span className="text-[11px] text-emerald-600 bg-emerald-50 dark:bg-emerald-900/30 px-2 py-0.5 rounded-full border border-emerald-200 dark:border-emerald-800">
              {Object.keys(feedbacks).length} 已闭环
            </span>
          </div>
          <div className="p-4 overflow-y-auto flex-1 flex flex-col gap-3">
            {Object.keys(feedbacks).length === 0 ? (
              <div className="text-center text-neutral-400 text-[12px] py-10">
                暂无反馈。完成任务后可记录反馈。
              </div>
            ) : Object.values(feedbacks).map((fb) => {
              const task = tasks.find(t => t.id === fb.taskId);
              return (
                <div key={fb.id} className="border border-emerald-200 dark:border-emerald-900 bg-emerald-50 dark:bg-emerald-950/20 rounded-lg p-3 shadow-sm flex flex-col gap-1.5">
                  <div className="font-semibold text-[12px] text-emerald-900 dark:text-emerald-100 truncate">
                    {task?.title ?? "未知任务"}
                  </div>
                  <div className="text-[11px] text-emerald-800/80 dark:text-emerald-200/80">
                    <span className="font-medium">结果:</span> {fb.outcome || "无"}
                  </div>
                  <div className="text-[11px] text-emerald-800/80 dark:text-emerald-200/80">
                    <span className="font-medium">指标:</span> <span className="text-rose-600 dark:text-rose-400 font-semibold">{fb.metricDelta || "无数据"}</span>
                  </div>
                  <div className="mt-1 pt-1.5 border-t border-emerald-100 dark:border-emerald-800/50 flex justify-between items-center">
                    <span className="text-[10px] text-emerald-600/70 dark:text-emerald-400/70">评分: {fb.score}/10</span>
                    <span className="text-[10px] text-emerald-600/70 dark:text-emerald-400/70">{new Date(fb.createdAt).toLocaleDateString()}</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
