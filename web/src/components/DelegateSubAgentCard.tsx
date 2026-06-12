import { useEffect, useMemo, useState } from "react";
import { ArrowLeftRight, Bot, ExternalLink, FileText, Loader2, RefreshCw, Square, XCircle } from "lucide-react";
import { api } from "@/lib/api";
import { cn } from "@/lib/cn";
import type { PiModel, SubAgentTask, WorkspacePath } from "@/types";

function ModelSelect({ models, value, onChange }: { models: PiModel[]; value: string; onChange: (value: string) => void }) {
  const groups = models.reduce<Record<string, PiModel[]>>((acc, model) => {
    (acc[model.provider] ??= []).push(model);
    return acc;
  }, {});

  return (
    <select
      value={value}
      onChange={(event) => onChange(event.target.value)}
      className="w-full rounded-md border border-neutral-200 bg-transparent px-2 py-1.5 text-[12px] outline-none dark:border-neutral-700"
    >
      <option value="">默认模型</option>
      {Object.entries(groups).map(([provider, items]) => (
        <optgroup key={provider} label={provider}>
          {items.map((item) => (
            <option key={item.id} value={item.id}>{item.model}</option>
          ))}
        </optgroup>
      ))}
    </select>
  );
}

function statusLabel(task: SubAgentTask): string {
  if (task.status === "running") return "运行中";
  if (task.status === "success") return "已完成";
  if (task.status === "failed") return "失败";
  return "已中止";
}

interface Props {
  sessionId: string;
  workspaceId: string | null;
  model: string;
  models: PiModel[];
  onBackflow: (text: string) => void;
}

export function DelegateSubAgentCard({ sessionId, workspaceId, model, models, onBackflow }: Props) {
  const [brief, setBrief] = useState("");
  const [selectedModel, setSelectedModel] = useState(model);
  const [cleanFiles, setCleanFiles] = useState<WorkspacePath[]>([]);
  const [selectedFiles, setSelectedFiles] = useState<string[]>([]);
  const [tasks, setTasks] = useState<SubAgentTask[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [loadingFiles, setLoadingFiles] = useState(false);
  const [error, setError] = useState("");
  const [previewTaskId, setPreviewTaskId] = useState("");
  const [preview, setPreview] = useState<{ title: string; content: string } | null>(null);
  const [backflowTask, setBackflowTask] = useState<SubAgentTask | null>(null);
  const [backflowText, setBackflowText] = useState("");

  const running = useMemo(() => tasks.some((task) => task.status === "running"), [tasks]);

  async function refreshTasks() {
    const next = await api.listSubAgentTasks(sessionId);
    setTasks(next);
  }

  useEffect(() => {
    setSelectedModel(model);
  }, [model]);

  useEffect(() => {
    setBrief("");
    setSelectedFiles([]);
    setTasks([]);
    setError("");
    setPreview(null);
    setBackflowTask(null);
    void refreshTasks().catch((err) => setError(String(err)));
  }, [sessionId]);

  useEffect(() => {
    let cancelled = false;
    if (!workspaceId) {
      setCleanFiles([]);
      return;
    }
    setLoadingFiles(true);
    api.listWorkspacePaths(workspaceId, "clean_data")
      .then((paths) => {
        if (!cancelled) setCleanFiles(paths.filter((path) => path.kind === "file"));
      })
      .catch((err) => {
        if (!cancelled) setError(String(err));
      })
      .finally(() => {
        if (!cancelled) setLoadingFiles(false);
      });
    return () => {
      cancelled = true;
    };
  }, [workspaceId]);

  useEffect(() => {
    if (!running) return;
    const timer = window.setInterval(() => {
      void refreshTasks().catch((err) => setError(String(err)));
    }, 3000);
    return () => window.clearInterval(timer);
  }, [running, sessionId]);

  async function submit() {
    const text = brief.trim();
    if (!text || submitting) return;
    setSubmitting(true);
    setError("");
    try {
      const task = await api.delegateSubAgent(sessionId, {
        brief: text,
        dataFiles: selectedFiles,
        model: selectedModel || undefined,
      });
      setTasks((current) => [task, ...current.filter((item) => item.id !== task.id)]);
      setBrief("");
    } catch (err) {
      setError(String(err));
    } finally {
      setSubmitting(false);
    }
  }

  async function abort(taskId: string) {
    setError("");
    try {
      await api.abortSubAgent(taskId);
      await refreshTasks();
    } catch (err) {
      setError(String(err));
    }
  }

  async function openPreview(task: SubAgentTask) {
    if (!task.reportPath) return;
    setPreviewTaskId(task.id);
    setPreview(null);
    setError("");
    try {
      const file = await api.sessionArtifactFileGet(sessionId, task.reportPath);
      setPreview({
        title: file.name,
        content: file.previewable ? file.content ?? "" : "该文件不可文本预览。",
      });
    } catch (err) {
      setError(String(err));
    } finally {
      setPreviewTaskId("");
    }
  }

  function toggleFile(path: string) {
    setSelectedFiles((current) =>
      current.includes(path) ? current.filter((item) => item !== path) : [...current, path],
    );
  }

  function openBackflow(task: SubAgentTask) {
    const reportLine = task.reportPath ? `\n\n报告：${task.reportPath}` : "";
    setBackflowTask(task);
    setBackflowText(`${task.summary ?? ""}${reportLine}`.trim());
  }

  function submitBackflow() {
    const text = backflowText.trim();
    if (!text) return;
    onBackflow(text);
    setBackflowTask(null);
  }

  return (
    <div className="rounded-lg border border-neutral-200 bg-neutral-50 p-3 dark:border-neutral-800 dark:bg-neutral-950">
      <div className="flex items-center gap-2">
        <Bot className="h-4 w-4 text-neutral-500" strokeWidth={1.75} />
        <div className="min-w-0 flex-1 text-[13px] font-medium text-neutral-800 dark:text-neutral-100">委派子 agent</div>
        <button
          onClick={() => void refreshTasks()}
          title="刷新任务"
          className="inline-flex h-7 w-7 items-center justify-center rounded-md text-neutral-500 hover:bg-neutral-200 dark:hover:bg-neutral-800"
        >
          <RefreshCw className="h-3.5 w-3.5" strokeWidth={1.75} />
        </button>
      </div>

      <div className="mt-3 grid gap-3 md:grid-cols-[minmax(0,1fr)_220px]">
        <div>
          <textarea
            value={brief}
            onChange={(event) => setBrief(event.target.value)}
            rows={4}
            placeholder="写清子 agent 要分析的问题、口径和输出要求"
            className="w-full resize-y rounded-md border border-neutral-200 bg-white px-3 py-2 text-[13px] leading-5 outline-none dark:border-neutral-700 dark:bg-neutral-900"
          />
          <div className="mt-2 flex justify-end">
            <button
              onClick={() => void submit()}
              disabled={!brief.trim() || submitting}
              className="inline-flex h-8 items-center gap-1.5 rounded-md bg-neutral-900 px-3 text-[12px] text-white disabled:opacity-40 dark:bg-neutral-100 dark:text-neutral-900"
            >
              {submitting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Bot className="h-3.5 w-3.5" />}
              开始委派
            </button>
          </div>
        </div>
        <div className="space-y-3">
          <ModelSelect models={models} value={selectedModel} onChange={setSelectedModel} />
          <div className="rounded-md border border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900">
            <div className="flex items-center gap-1.5 border-b border-neutral-200 px-2.5 py-2 text-[12px] text-neutral-500 dark:border-neutral-800 dark:text-neutral-400">
              <FileText className="h-3.5 w-3.5" />
              020_clean 数据文件
            </div>
            <div className="max-h-36 overflow-y-auto p-2">
              {loadingFiles && <div className="text-[12px] text-neutral-400">正在加载…</div>}
              {!loadingFiles && cleanFiles.length === 0 && <div className="text-[12px] text-neutral-400">暂无 clean_data 文件</div>}
              {cleanFiles.map((file) => (
                <label key={file.id} className="flex min-w-0 items-center gap-2 rounded px-1.5 py-1 text-[12px] text-neutral-600 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-800">
                  <input
                    type="checkbox"
                    checked={selectedFiles.includes(file.path)}
                    onChange={() => toggleFile(file.path)}
                    className="h-3.5 w-3.5"
                  />
                  <span className="truncate" title={file.path}>{file.path}</span>
                </label>
              ))}
            </div>
          </div>
        </div>
      </div>

      {error && <div className="mt-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-[12px] text-red-600 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300">{error}</div>}

      {tasks.length > 0 && (
        <div className="mt-3 space-y-2">
          {tasks.map((task) => (
            <div key={task.id} className="rounded-md border border-neutral-200 bg-white p-3 dark:border-neutral-800 dark:bg-neutral-900">
              <div className="flex items-start gap-3">
                <div className={cn(
                  "mt-0.5 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md",
                  task.status === "success" ? "bg-emerald-500/10 text-emerald-600" :
                    task.status === "failed" ? "bg-red-500/10 text-red-600" :
                    task.status === "aborted" ? "bg-neutral-500/10 text-neutral-500" :
                    "bg-blue-500/10 text-blue-600",
                )}>
                  {task.status === "running" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Bot className="h-3.5 w-3.5" />}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-[12px] font-medium text-neutral-800 dark:text-neutral-100">{statusLabel(task)}</span>
                    {task.model && <span className="rounded bg-neutral-100 px-1.5 py-0.5 text-[10.5px] text-neutral-500 dark:bg-neutral-800">{task.model}</span>}
                  </div>
                  <div className="mt-1 line-clamp-2 text-[12px] leading-5 text-neutral-500 dark:text-neutral-400">{task.brief}</div>
                  {task.dataFiles.length > 0 && (
                    <div className="mt-1 truncate text-[11px] text-neutral-400" title={task.dataFiles.join(", ")}>{task.dataFiles.join(", ")}</div>
                  )}
                  {task.summary && <div className="mt-2 whitespace-pre-wrap text-[12px] leading-5 text-neutral-700 dark:text-neutral-200">{task.summary}</div>}
                  {task.error && <div className="mt-2 text-[12px] text-red-500">{task.error}</div>}
                  {task.reportPath && (
                    <button
                      onClick={() => void openPreview(task)}
                      className="mt-2 inline-flex items-center gap-1.5 text-[12px] text-neutral-600 hover:text-neutral-900 dark:text-neutral-300 dark:hover:text-white"
                    >
                      {previewTaskId === task.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ExternalLink className="h-3.5 w-3.5" />}
                      {task.reportPath}
                    </button>
                  )}
                </div>
                <div className="flex shrink-0 gap-1">
                  {task.status === "running" && (
                    <button
                      onClick={() => void abort(task.id)}
                      title="中止"
                      className="inline-flex h-7 w-7 items-center justify-center rounded-md text-neutral-500 hover:bg-neutral-100 dark:hover:bg-neutral-800"
                    >
                      <Square className="h-3.5 w-3.5" fill="currentColor" />
                    </button>
                  )}
                  {task.status === "success" && (
                    <button
                      onClick={() => openBackflow(task)}
                      className="inline-flex h-7 items-center gap-1.5 rounded-md border border-neutral-200 px-2 text-[12px] text-neutral-600 hover:bg-neutral-100 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800"
                    >
                      <ArrowLeftRight className="h-3.5 w-3.5" />
                      回流
                    </button>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {preview && (
        <div className="mt-3 rounded-md border border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900">
          <div className="flex items-center justify-between border-b border-neutral-200 px-3 py-2 dark:border-neutral-800">
            <div className="truncate text-[12px] font-medium text-neutral-700 dark:text-neutral-200">{preview.title}</div>
            <button onClick={() => setPreview(null)} className="text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200">
              <XCircle className="h-4 w-4" />
            </button>
          </div>
          <pre className="max-h-72 overflow-auto whitespace-pre-wrap px-3 py-2 text-[12px] leading-5 text-neutral-700 dark:text-neutral-200">{preview.content}</pre>
        </div>
      )}

      {backflowTask && (
        <div className="mt-3 rounded-md border border-neutral-200 bg-white p-3 dark:border-neutral-800 dark:bg-neutral-900">
          <div className="text-[12px] font-medium text-neutral-700 dark:text-neutral-200">回流到主对话</div>
          <textarea
            value={backflowText}
            onChange={(event) => setBackflowText(event.target.value)}
            rows={5}
            className="mt-2 w-full resize-y rounded-md border border-neutral-200 bg-transparent px-3 py-2 text-[13px] leading-5 outline-none dark:border-neutral-700"
          />
          <div className="mt-2 flex justify-end gap-2">
            <button onClick={() => setBackflowTask(null)} className="rounded-md px-3 py-1.5 text-[12px] text-neutral-500 hover:bg-neutral-100 dark:hover:bg-neutral-800">取消</button>
            <button onClick={submitBackflow} disabled={!backflowText.trim()} className="rounded-md bg-neutral-900 px-3 py-1.5 text-[12px] text-white disabled:opacity-40 dark:bg-neutral-100 dark:text-neutral-900">发送回主线</button>
          </div>
        </div>
      )}
    </div>
  );
}
