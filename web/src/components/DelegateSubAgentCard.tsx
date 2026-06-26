import { useEffect, useMemo, useState } from "react";
import { ArrowLeftRight, Bot, ChevronDown, ChevronRight, ExternalLink, FileText, Hammer, HelpCircle, Lightbulb, Loader2, NotebookPen, RefreshCw, Square, XCircle } from "lucide-react";
import { api } from "@/lib/api";
import { cn } from "@/lib/cn";
import { gateway } from "@/lib/ws";
import { SkillSelector } from "@/components/SkillSelector";
import type { PiEvent, PiModel, ServerMessage, SubAgentTask, SubAgentTemplate, SubAgentTraceKind, WorkspacePath } from "@/types";

function ModelSelect({ models, value, onChange }: { models: PiModel[]; value: string; onChange: (value: string) => void }) {
  const groups = models.reduce<Record<string, PiModel[]>>((acc, model) => {
    (acc[model.provider] ??= []).push(model);
    return acc;
  }, {});

  return (
    <select
      value={value}
      onChange={(event) => onChange(event.target.value)}
      className="min-w-0 max-w-full w-full rounded-md border border-neutral-200 bg-transparent px-2 py-1.5 text-[12px] outline-none dark:border-neutral-700"
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
  if (task.status === "waiting_for_help") return "等待人工修正";
  return "已中止";
}

function personaSummary(persona: string): string {
  const normalized = persona.trim().replace(/\s+/g, " ");
  return normalized.length > 80 ? `${normalized.slice(0, 80)}…` : normalized;
}

type TraceRow = {
  id: string;
  kind: SubAgentTraceKind;
  title: string;
  body: string;
  createdAt: number;
};

function stringifyTraceValue(value: unknown): string {
  if (typeof value === "string") return value;
  if (value == null) return "";
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function messageText(event: PiEvent): string {
  if (event.type !== "message_end") return "";
  const message = (event as Extract<PiEvent, { type: "message_end" }>).message;
  if (message.role === "user") return "";
  return message.content
    .map((block) => {
      if (typeof block === "string") return block;
      if (block && typeof block === "object" && "text" in block && typeof block.text === "string") return block.text;
      if (block && typeof block === "object" && "thinking" in block && typeof block.thinking === "string") return block.thinking;
      return "";
    })
    .filter(Boolean)
    .join("\n");
}

function eventName(event: PiEvent): string {
  return "name" in event && typeof event.name === "string" ? event.name : "";
}

function traceTitle(kind: SubAgentTraceKind, event: PiEvent): string {
  const name = eventName(event);
  if (kind === "thinking") return "思考";
  if (kind === "tool_call") return `工具调用${name ? ` · ${name}` : ""}`;
  if (kind === "tool_result") return `结果${name ? ` · ${name}` : ""}`;
  if (kind === "write_report") return `写报告${name ? ` · ${name}` : ""}`;
  if (kind === "message") return "消息";
  if (kind === "process") return "进程";
  if (kind === "turn") return "轮次";
  return String(event.type || "事件");
}

function traceBody(kind: SubAgentTraceKind, event: PiEvent): string {
  if (kind === "message" || kind === "thinking") return messageText(event) || stringifyTraceValue(event);
  if (kind === "tool_call") return stringifyTraceValue((event as Extract<PiEvent, { type: "tool_call" }>).input);
  if (kind === "tool_result") return stringifyTraceValue((event as Extract<PiEvent, { type: "tool_result" }>).content);
  return stringifyTraceValue(event);
}

let traceSeq = 0;

function toTraceRow(message: Extract<ServerMessage, { type: "subagent_event" }>): TraceRow {
  return {
    id: `${message.taskId}:${message.createdAt}:${message.event.type}:${++traceSeq}`,
    kind: message.traceKind,
    title: traceTitle(message.traceKind, message.event),
    body: traceBody(message.traceKind, message.event),
    createdAt: message.createdAt,
  };
}

function traceIcon(kind: SubAgentTraceKind) {
  if (kind === "thinking") return <Lightbulb className="h-3.5 w-3.5" />;
  if (kind === "tool_call") return <Hammer className="h-3.5 w-3.5" />;
  if (kind === "tool_result") return <NotebookPen className="h-3.5 w-3.5" />;
  if (kind === "write_report") return <FileText className="h-3.5 w-3.5" />;
  return <Bot className="h-3.5 w-3.5" />;
}

function TraceList({ rows }: { rows: TraceRow[] }) {
  if (rows.length === 0) {
    return <div className="rounded-md border border-dashed border-neutral-200 px-3 py-2 text-[12px] text-neutral-400 dark:border-neutral-800">等待运行日志…</div>;
  }
  return (
    <div className="max-h-72 space-y-2 overflow-y-auto rounded-md border border-neutral-200 bg-neutral-50 p-2 dark:border-neutral-800 dark:bg-neutral-950/40">
      {rows.map((row) => (
        <div key={row.id} className="rounded-md bg-white px-2.5 py-2 dark:bg-neutral-900">
          <div className="flex items-center gap-2 text-[11px] font-medium text-neutral-600 dark:text-neutral-300">
            <span className="text-neutral-400">{traceIcon(row.kind)}</span>
            <span>{row.title}</span>
            <span className="ml-auto font-normal text-neutral-400">{new Date(row.createdAt).toLocaleTimeString()}</span>
          </div>
          {row.body && <pre className="mt-1 max-h-32 overflow-auto whitespace-pre-wrap break-words text-[11px] leading-4 text-neutral-500 dark:text-neutral-400">{row.body}</pre>}
        </div>
      ))}
    </div>
  );
}

interface Props {
  sessionId: string;
  workspaceId: string | null;
  model: string;
  models: PiModel[];
  onBackflow: (text: string) => void;
  embedded?: boolean;
}

export function DelegateSubAgentCard({ sessionId, workspaceId, model, models, onBackflow, embedded = false }: Props) {
  const [brief, setBrief] = useState("");
  const [selectedModel, setSelectedModel] = useState(model);
  const [templates, setTemplates] = useState<SubAgentTemplate[]>([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState("");
  const [loadingTemplates, setLoadingTemplates] = useState(false);
  const [skillMode, setSkillMode] = useState<"default" | "specified">("default");
  const [specifiedSkillPaths, setSpecifiedSkillPaths] = useState<string[]>([]);
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
  const [expandedTaskIds, setExpandedTaskIds] = useState<string[]>([]);
  const [traceRows, setTraceRows] = useState<Record<string, TraceRow[]>>({});
  const [resumeDrafts, setResumeDrafts] = useState<Record<string, { correction: string; correctedResult: string }>>({});
  const [resumingTaskId, setResumingTaskId] = useState("");

  const running = useMemo(() => tasks.some((task) => task.status === "running"), [tasks]);
  const selectedTemplate = useMemo(
    () => templates.find((template) => template.id === selectedTemplateId) ?? null,
    [selectedTemplateId, templates],
  );
  const canSubmit = brief.trim().length > 0 && !submitting && (skillMode !== "specified" || specifiedSkillPaths.length > 0);

  async function refreshTasks() {
    const next = await api.listSubAgentTasks(sessionId);
    setTasks(next);
  }

  useEffect(() => {
    setSelectedModel(model);
  }, [model]);

  useEffect(() => {
    let cancelled = false;
    setLoadingTemplates(true);
    api.listSubAgents()
      .then((items) => {
        if (!cancelled) setTemplates(items.filter((item) => item.enabled));
      })
      .catch((err) => {
        if (!cancelled) setError(`加载 agent 模版失败：${String(err)}`);
      })
      .finally(() => {
        if (!cancelled) setLoadingTemplates(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    setBrief("");
    setSelectedTemplateId("");
    setSkillMode("default");
    setSpecifiedSkillPaths([]);
    setSelectedFiles([]);
    setTasks([]);
    setError("");
    setPreview(null);
    setBackflowTask(null);
    setExpandedTaskIds([]);
    setTraceRows({});
    setResumeDrafts({});
    setResumingTaskId("");
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

  useEffect(() => {
    gateway.connect();
    return gateway.subscribe((msg: ServerMessage) => {
      if (msg.type !== "subagent_event" || msg.parentSessionId !== sessionId) return;
      const row = toTraceRow(msg);
      setTraceRows((current) => ({
        ...current,
        [msg.taskId]: [...(current[msg.taskId] ?? []), row].slice(-80),
      }));
      setExpandedTaskIds((current) => current.includes(msg.taskId) ? current : [...current, msg.taskId]);
      if (msg.event.type === "subagent_run_end") {
        void api.getSubAgentTask(msg.taskId)
          .then((next) => {
            setTasks((current) => current.map((task) => task.id === next.id ? next : task));
          })
          .catch(() => refreshTasks().catch((err) => setError(String(err))));
      }
    });
  }, [sessionId]);

  useEffect(() => {
    const activeIds = new Set(tasks.filter((t) => t.status === "waiting_for_help").map((t) => t.id));
    setResumeDrafts((current) => {
      const keys = Object.keys(current);
      if (keys.every((k) => activeIds.has(k))) return current;
      const next: Record<string, { correction: string; correctedResult: string }> = {};
      for (const k of keys) {
        const draft = current[k];
        if (activeIds.has(k) && draft) next[k] = draft;
      }
      return next;
    });
  }, [tasks]);

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
        templateId: selectedTemplateId || undefined,
        skillPaths: skillMode === "default" ? undefined : specifiedSkillPaths,
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

  async function resume(task: SubAgentTask) {
    const draft = resumeDrafts[task.id] ?? { correction: "", correctedResult: "" };
    if (resumingTaskId) return;
    setResumingTaskId(task.id);
    setError("");
    try {
      const result = await api.resumeSubAgent(task.id, {
        correction: draft.correction.trim(),
        correctedResult: draft.correctedResult.trim(),
      });
      setTasks((current) => current.map((item) => item.id === result.task.id ? result.task : item));
      setExpandedTaskIds((current) => current.includes(task.id) ? current : [...current, task.id]);
    } catch (err) {
      setError(String(err));
    } finally {
      setResumingTaskId("");
    }
  }

  function updateResumeDraft(taskId: string, patch: Partial<{ correction: string; correctedResult: string }>) {
    setResumeDrafts((current) => ({
      ...current,
      [taskId]: { correction: "", correctedResult: "", ...current[taskId], ...patch },
    }));
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

  function toggleExpanded(taskId: string) {
    setExpandedTaskIds((current) =>
      current.includes(taskId) ? current.filter((id) => id !== taskId) : [...current, taskId],
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
    <div className={cn(
      embedded ? "h-full" : "rounded-lg border border-neutral-200 bg-neutral-50 p-3 dark:border-neutral-800 dark:bg-neutral-950",
    )}>
      <div className="flex items-center justify-end gap-2">
        <button
          onClick={() => void refreshTasks()}
          title="刷新任务"
          className="inline-flex h-7 w-7 items-center justify-center rounded-md text-neutral-500 hover:bg-neutral-200 dark:hover:bg-neutral-800"
        >
          <RefreshCw className="h-3.5 w-3.5" strokeWidth={1.75} />
        </button>
      </div>

      <div className={cn(
        "mt-3 grid min-w-0 gap-3",
        embedded ? "grid-cols-[minmax(0,1fr)]" : "md:grid-cols-[minmax(0,1fr)_220px]",
      )}>
        <div className="min-w-0">
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
              disabled={!canSubmit}
              className="inline-flex h-8 items-center gap-1.5 rounded-md bg-neutral-900 px-3 text-[12px] text-white disabled:opacity-40 dark:bg-neutral-100 dark:text-neutral-900"
            >
              {submitting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Bot className="h-3.5 w-3.5" />}
              开始委派
            </button>
          </div>
        </div>
        <div className="min-w-0 space-y-3">
          <ModelSelect models={models} value={selectedModel} onChange={setSelectedModel} />
          <div className="rounded-md border border-neutral-200 bg-white p-2 dark:border-neutral-800 dark:bg-neutral-900">
            <label className="block text-[12px] text-neutral-500 dark:text-neutral-400">
              agent 模版
              <select
                value={selectedTemplateId}
                onChange={(event) => setSelectedTemplateId(event.target.value)}
                disabled={loadingTemplates}
                className="mt-1 min-w-0 w-full rounded-md border border-neutral-200 bg-transparent px-2 py-1.5 text-[12px] text-neutral-700 outline-none disabled:opacity-50 dark:border-neutral-700 dark:text-neutral-200"
              >
                <option value="">{loadingTemplates ? "正在加载模版…" : "默认（引擎内置 persona）"}</option>
                {templates.map((template) => (
                  <option key={template.id} value={template.id}>
                    {template.name} · {personaSummary(template.persona)} · {template.toolIds.length} 个工具
                  </option>
                ))}
              </select>
            </label>
            {selectedTemplate ? (
              <div className="mt-2 space-y-1 text-[10.5px] leading-4 text-neutral-400">
                <p title={selectedTemplate.persona}>{personaSummary(selectedTemplate.persona)}</p>
                <p title={selectedTemplate.toolIds.join(", ")}>
                  计算工具：{selectedTemplate.toolIds.length > 0 ? selectedTemplate.toolIds.join("、") : "无"}
                </p>
              </div>
            ) : (
              <p className="mt-2 text-[10.5px] leading-4 text-neutral-400">使用引擎内置 persona，不额外挂载模版计算工具。</p>
            )}
            <p className="mt-1 text-[10.5px] leading-4 text-neutral-400">
              模版提供 persona 与计算工具；模型、skill 子集和数据文件仍由本卡设置。
            </p>
          </div>
          <div className="rounded-md border border-neutral-200 bg-white p-2 dark:border-neutral-800 dark:bg-neutral-900">
            <div className="mb-2 flex items-center justify-between gap-2">
              <span className="text-[12px] text-neutral-500 dark:text-neutral-400">skill 子集</span>
              {!embedded && skillMode === "specified" && (
                <SkillSelector
                  scope={workspaceId ? { type: "workspace", workspaceId } : null}
                  selectedPaths={specifiedSkillPaths}
                  onChange={setSpecifiedSkillPaths}
                />
              )}
            </div>
            <div className="grid grid-cols-2 gap-1">
              <button
                type="button"
                onClick={() => setSkillMode("default")}
                className={cn(
                  "h-7 rounded border px-2 text-[10.5px]",
                  skillMode === "default"
                    ? "border-neutral-900 bg-neutral-900 text-white dark:border-neutral-100 dark:bg-neutral-100 dark:text-neutral-900"
                    : "border-neutral-200 text-neutral-500 hover:bg-neutral-100 dark:border-neutral-700 dark:text-neutral-400 dark:hover:bg-neutral-800",
                )}
                title="不传 skillPaths，后端默认按空白名单执行"
              >
                默认
              </button>
              <button
                type="button"
                onClick={() => setSkillMode("specified")}
                className={cn(
                  "h-7 rounded border px-2 text-[10.5px]",
                  skillMode === "specified"
                    ? "border-neutral-900 bg-neutral-900 text-white dark:border-neutral-100 dark:bg-neutral-100 dark:text-neutral-900"
                    : "border-neutral-200 text-neutral-500 hover:bg-neutral-100 dark:border-neutral-700 dark:text-neutral-400 dark:hover:bg-neutral-800",
                )}
                title="只给子 agent 注入选中的 skill"
              >
                指定{specifiedSkillPaths.length > 0 ? ` ${specifiedSkillPaths.length}` : ""}
              </button>
            </div>
            {embedded && skillMode === "specified" && (
              <div className="mt-2 flex min-w-0 items-center">
                <SkillSelector
                  scope={workspaceId ? { type: "workspace", workspaceId } : null}
                  selectedPaths={specifiedSkillPaths}
                  onChange={setSpecifiedSkillPaths}
                  align="left"
                  direction="down"
                />
              </div>
            )}
            <p className="mt-1 text-[10.5px] leading-4 text-neutral-400">
              {skillMode === "default"
                ? "子 agent 默认不加载任何 skill。"
                : specifiedSkillPaths.length > 0
                  ? "子 agent 本轮仅加载已勾选 skill。"
                  : "请至少选择 1 个 skill。"}
            </p>
          </div>
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
                    task.status === "waiting_for_help" ? "bg-amber-500/10 text-amber-600" :
                    task.status === "aborted" ? "bg-neutral-500/10 text-neutral-500" :
                    "bg-blue-500/10 text-blue-600",
                )}>
                  {task.status === "running" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : task.status === "waiting_for_help" ? <HelpCircle className="h-3.5 w-3.5" /> : <Bot className="h-3.5 w-3.5" />}
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
                  {(task.status === "running" || (traceRows[task.id]?.length ?? 0) > 0) && (
                    <div className="mt-2">
                      <button
                        onClick={() => toggleExpanded(task.id)}
                        className="inline-flex items-center gap-1.5 rounded-md px-1 py-0.5 text-[12px] text-neutral-500 hover:bg-neutral-100 hover:text-neutral-800 dark:text-neutral-400 dark:hover:bg-neutral-800 dark:hover:text-neutral-100"
                        aria-expanded={expandedTaskIds.includes(task.id)}
                      >
                        {expandedTaskIds.includes(task.id) ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                        计算过程
                        <span className="text-[11px] text-neutral-400">{traceRows[task.id]?.length ?? 0}</span>
                      </button>
                      {expandedTaskIds.includes(task.id) && <div className="mt-2"><TraceList rows={traceRows[task.id] ?? []} /></div>}
                    </div>
                  )}
                  {task.summary && <div className="mt-2 whitespace-pre-wrap text-[12px] leading-5 text-neutral-700 dark:text-neutral-200">{task.summary}</div>}
                  {task.status === "waiting_for_help" && (
                    <div className="mt-3 rounded-md border border-amber-200 bg-amber-50 p-3 dark:border-amber-900/70 dark:bg-amber-950/25">
                      <div className="flex items-start gap-2 text-[12px] text-amber-800 dark:text-amber-200">
                        <HelpCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                        <div>
                          <div className="font-medium">子 Agent 已暂停，等待人工修正</div>
                          <div className="mt-1 text-amber-700/80 dark:text-amber-200/75">请修正错误上下文中的 SQL、工具参数或结果，再继续任务。</div>
                        </div>
                      </div>
                      {task.error && <pre className="mt-2 max-h-32 overflow-auto whitespace-pre-wrap break-words rounded-md border border-amber-200 bg-white/70 px-2.5 py-2 text-[11px] leading-4 text-amber-900 dark:border-amber-900/60 dark:bg-neutral-950/40 dark:text-amber-100">{task.error}</pre>}
                      <label className="mt-2 block text-[11px] font-medium text-amber-900 dark:text-amber-100">
                        修正说明
                        <textarea
                          value={resumeDrafts[task.id]?.correction ?? ""}
                          onChange={(event) => updateResumeDraft(task.id, { correction: event.target.value })}
                          rows={2}
                          placeholder="例如：上一轮 SQL 字段名写错，已改为正确字段。"
                          className="mt-1 w-full resize-y rounded-md border border-amber-200 bg-white px-2.5 py-2 text-[12px] leading-5 text-neutral-800 outline-none placeholder:text-neutral-400 dark:border-amber-900/60 dark:bg-neutral-950 dark:text-neutral-100"
                        />
                      </label>
                      <label className="mt-2 block text-[11px] font-medium text-amber-900 dark:text-amber-100">
                        正确结果 / 参数 / SQL
                        <textarea
                          value={resumeDrafts[task.id]?.correctedResult ?? ""}
                          onChange={(event) => updateResumeDraft(task.id, { correctedResult: event.target.value })}
                          rows={5}
                          placeholder="粘贴修正后的 SQL、工具参数或人工确认的正确结果。"
                          className="mt-1 w-full resize-y rounded-md border border-amber-200 bg-white px-2.5 py-2 font-mono text-[12px] leading-5 text-neutral-800 outline-none placeholder:font-sans placeholder:text-neutral-400 dark:border-amber-900/60 dark:bg-neutral-950 dark:text-neutral-100"
                        />
                      </label>
                      <div className="mt-2 flex justify-end">
                        <button
                          onClick={() => void resume(task)}
                          disabled={resumingTaskId === task.id}
                          className="inline-flex h-8 items-center gap-1.5 rounded-md bg-amber-700 px-3 text-[12px] text-white disabled:opacity-40 dark:bg-amber-300 dark:text-amber-950"
                        >
                          {resumingTaskId === task.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
                          修正并继续
                        </button>
                      </div>
                    </div>
                  )}
                  {task.status !== "waiting_for_help" && task.error && <div className="mt-2 text-[12px] text-red-500">{task.error}</div>}
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
