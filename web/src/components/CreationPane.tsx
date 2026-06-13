import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowRight,
  ArrowUp,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Circle,
  Cpu,
  FolderUp,
  Loader2,
  Play,
  RefreshCw,
  Square,
} from "lucide-react";
import { type UiMessage } from "@/components/MessageRow";
import { cn } from "@/lib/cn";
import { api } from "@/lib/api";
import { gateway } from "@/lib/ws";
import { asBlocks, textOf, type Flow, type PiEvent, type PiModel, type ServerMessage, type StoredFlowMessage, type WorkflowDef, type WorkflowNode } from "@/types";

interface Props {
  flow: Flow;
  kind: "multi";
  models: PiModel[];
  model: string;
  onModelChange: (m: string) => void;
  onApplyToEditor: () => void;
  systemPrompt?: string;
  primingPrompt?: string;
  rulesPromptEnabled: boolean;
}

declare module "react" {
  interface InputHTMLAttributes<T> {
    webkitdirectory?: string;
    directory?: string;
  }
}

type MilestoneStatus = "done" | "active" | "pending";

interface Milestone {
  label: string;
  status: MilestoneStatus;
}

const FALLBACK_COLORS = ["#0ea5e9", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6", "#ec4899", "#14b8a6", "#f97316"];
const WORKFLOW_REFRESH_ATTEMPTS = 6;
const WORKFLOW_REFRESH_DELAY_MS = 700;
const WORKFLOW_WAIT_TIMEOUT_MS = 45_000;

function nodeColor(node: WorkflowNode, idx: number): string {
  return node.color || FALLBACK_COLORS[idx % FALLBACK_COLORS.length]!;
}

function nodeIcon(node: WorkflowNode): string {
  return node.icon || "\u{1F916}";
}

function isQuestion(text: string): boolean {
  if (text.length > 300) return false;
  return /[？?]/.test(text) || /^(请|能否|可以|是否|怎么|如何|什么|哪|谁|几点|多少)/.test(text.trim());
}

function lastAssistantQuestion(messages: UiMessage[]): string | null {
  for (const message of [...messages].reverse()) {
    if (message.role !== "assistant") continue;
    const text = textOf(message.content).trim();
    if (text && isQuestion(text)) return text;
  }
  return null;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

async function readWorkflowWithRetry(flowId: string): Promise<WorkflowDef | null> {
  let last: WorkflowDef | null = null;
  for (let i = 0; i < WORKFLOW_REFRESH_ATTEMPTS; i += 1) {
    const result = await api.flowWorkflowGet(flowId);
    last = result.workflow;
    if (last && last.nodes.length > 0) return last;
    if (i < WORKFLOW_REFRESH_ATTEMPTS - 1) await delay(WORKFLOW_REFRESH_DELAY_MS);
  }
  return last;
}

function inferProgress(
  workflow: WorkflowDef | null,
  messages: UiMessage[],
  chatRunning: boolean,
): { milestones: Milestone[]; hint: string } {
  const milestones: Milestone[] = [
    { label: "需求分析", status: "pending" },
    { label: "节点设计", status: "pending" },
    { label: "提示词编写", status: "pending" },
    { label: "验证完成", status: "pending" },
  ];

  if (!workflow || workflow.nodes.length === 0) {
    if (chatRunning) milestones[0]!.status = "active";
    return { milestones, hint: chatRunning ? "pi 正在分析需求…" : "描述你的需求，pi 将开始设计" };
  }

  milestones[0]!.status = "done";
  milestones[1]!.status = "done";

  const allHavePrompts = workflow.nodes.every((n) => n.prompt?.trim().length > 0);
  if (!allHavePrompts) {
    if (chatRunning) milestones[2]!.status = "active";
    return { milestones, hint: chatRunning ? "pi 正在编写节点提示词…" : "等待 pi 完成节点提示词" };
  }

  milestones[2]!.status = "done";

  const lastAssistant = [...messages].reverse().find((m) => m.role === "assistant");
  const lastText = lastAssistant ? textOf(lastAssistant.content) : "";
  const isComplete = /完成|已生成|workflow\.json|可以.*执行|可以.*运行|已就绪|切换到.*执行/.test(lastText);

  if (isComplete) {
    milestones[3]!.status = "done";
    return { milestones, hint: "工作流已就绪，可切换到执行视图运行" };
  }

  if (chatRunning) milestones[3]!.status = "active";
  return { milestones, hint: chatRunning ? "pi 正在验证工作流…" : "等待 pi 确认完成" };
}

function ModelSelect({ models, value, onChange }: { models: PiModel[]; value: string; onChange: (v: string) => void }) {
  const groups = models.reduce<Record<string, PiModel[]>>((acc, m) => {
    (acc[m.provider] ??= []).push(m);
    return acc;
  }, {});
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="h-6 rounded border border-neutral-200 bg-transparent px-1 text-[10px] outline-none focus:border-neutral-400 dark:border-neutral-700 dark:focus:border-neutral-500"
    >
      {Object.entries(groups).map(([provider, items]) => (
        <optgroup key={provider} label={provider}>
          {items.map((m) => (
            <option key={m.id} value={m.id}>{m.model}</option>
          ))}
        </optgroup>
      ))}
    </select>
  );
}

let uid = 0;
const nextId = () => `c${++uid}`;

export function CreationPane(p: Props) {
  const [messages, setMessages] = useState<UiMessage[]>([]);
  const [chatRunning, setChatRunning] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importHint, setImportHint] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [workflow, setWorkflow] = useState<WorkflowDef | null>(null);
  const [editingNodeId, setEditingNodeId] = useState<string | null>(null);
  const [expandedMsgIds, setExpandedMsgIds] = useState<Set<string>>(new Set());
  const [flowState, setFlowState] = useState<Flow>(p.flow);
  const [activeSince, setActiveSince] = useState<number | null>(null);
  const [clock, setClock] = useState(() => Date.now());

  const flowIdRef = useRef(p.flow.id);
  flowIdRef.current = p.flow.id;
  const bottomRef = useRef<HTMLDivElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const generationRunning = flowState.generationStatus === "generating";

  useEffect(() => {
    api.listFlowMessages(p.flow.id).then((rows: StoredFlowMessage[]) => {
      setMessages(rows.map((r) => ({ id: nextId(), role: r.role, content: asBlocks(r.content) })));
    }).catch(() => setMessages([]));
  }, [p.flow.id]);

  useEffect(() => {
    api.flowWorkflowGet(p.flow.id).then((r) => setWorkflow(r.workflow)).catch(() => setWorkflow(null));
  }, [p.flow.id]);

  useEffect(() => {
    setFlowState(p.flow);
    if (p.flow.generationStatus !== "generating") return;
    let cancelled = false;
    let timer: ReturnType<typeof setInterval> | undefined;
    const refresh = async () => {
      try {
        const nextFlow = await api.getFlow(p.flow.id);
        if (cancelled) return;
        setFlowState(nextFlow);
        if (nextFlow.generationStatus !== "generating") {
          if (timer) clearInterval(timer);
          const [messageRows, workflowResult] = await Promise.all([
            api.listFlowMessages(p.flow.id),
            readWorkflowWithRetry(p.flow.id),
          ]);
          if (cancelled) return;
          setMessages(messageRows.map((row) => ({ id: nextId(), role: row.role, content: asBlocks(row.content) })));
          setWorkflow(workflowResult);
        }
      } catch {
        // Keep polling; the local dev server may be restarting.
      }
    };
    void refresh();
    timer = setInterval(() => void refresh(), 1200);
    return () => {
      cancelled = true;
      if (timer) clearInterval(timer);
    };
  }, [p.flow]);

  useEffect(() => {
    return gateway.subscribe((msg: ServerMessage) => {
      if (msg.type === "run_start" && !msg.runId && msg.flowId === flowIdRef.current) {
        setChatRunning(true);
      } else if (msg.type === "run_end" && !msg.runId && msg.flowId === flowIdRef.current) {
        setChatRunning(false);
        readWorkflowWithRetry(flowIdRef.current).then((next) => setWorkflow(next)).catch(() => {});
      } else if (msg.type === "error" && !msg.runId && msg.flowId === flowIdRef.current) {
        setChatRunning(false);
        setMessages((m) => [...m, { id: nextId(), role: "assistant", content: [], error: msg.message }]);
      } else if (msg.type === "flow_event" && msg.flowId === flowIdRef.current) {
        const ev = msg.event;
        if (ev.type === "message_end") {
          const { message: m } = ev as Extract<PiEvent, { type: "message_end" }>;
          if (m.role === "user") return;
          const blocks = asBlocks(m.content);
          setMessages((cur) => [...cur, { id: nextId(), role: m.role, content: blocks, error: m.errorMessage }]);
          api.flowWorkflowGet(flowIdRef.current).then((r) => setWorkflow(r.workflow)).catch(() => {});
        }
      }
    });
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    if (!chatRunning && !generationRunning) {
      setActiveSince(null);
      setClock(Date.now());
      return;
    }
    setActiveSince((current) => current ?? Date.now());
    const timer = window.setInterval(() => setClock(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [chatRunning, generationRunning]);

  function autosize() {
    const ta = taRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = `${Math.min(ta.scrollHeight, 100)}px`;
  }

  const pendingQuestion = lastAssistantQuestion(messages);
  const canReplyDuringGeneration = generationRunning && !chatRunning && Boolean(pendingQuestion);

  const sendText = useCallback(
    (text: string) => {
      setMessages((cur) => [...cur, { id: nextId(), role: "user", content: [{ type: "text", text }] }]);
      gateway.send({
        type: "send_flow",
        flowId: p.flow.id,
        text,
        model: p.model || undefined,
        systemPrompt: p.systemPrompt,
        injectRulesPrompt: p.rulesPromptEnabled,
      });
    },
    [p.flow.id, p.model, p.rulesPromptEnabled, p.systemPrompt],
  );

  const stopChat = useCallback(() => {
    gateway.send({ type: "abort_flow", flowId: p.flow.id });
  }, [p.flow.id]);

  const submit = useCallback(() => {
    const text = input.trim();
    if (!text || chatRunning || (generationRunning && !canReplyDuringGeneration)) return;
    sendText(text);
    setInput("");
    requestAnimationFrame(autosize);
  }, [input, chatRunning, generationRunning, canReplyDuringGeneration, sendText]);

  const onImport = useCallback(
    async (files: FileList) => {
      setImporting(true);
      setImportHint(`正在上传 ${files.length} 个文件…`);
      try {
        const r = await api.importFlowFolder(p.flow.id, files);
        setImportHint(`已导入「${r.sourceName}」共 ${r.count} 个文件`);
        if (p.primingPrompt) sendText(p.primingPrompt);
      } catch (err) {
        setImportHint(`导入失败：${String(err)}`);
      } finally {
        setImporting(false);
      }
    },
    [p.flow.id, p.primingPrompt, sendText],
  );

  const updateNodeModel = useCallback(
    async (nodeId: string, newModel: string) => {
      if (!workflow) return;
      const updated: WorkflowDef = {
        ...workflow,
        nodes: workflow.nodes.map((n) => (n.id === nodeId ? { ...n, model: newModel } : n)),
      };
      setWorkflow(updated);
      try {
        await api.flowWorkflowPut(p.flow.id, updated);
      } catch {
        setWorkflow(workflow);
      }
    },
    [workflow, p.flow.id],
  );

  const toggleMsg = useCallback((id: string) => {
    setExpandedMsgIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const progress = inferProgress(workflow, messages, chatRunning);
  const hasNodes = workflow && workflow.nodes.length > 0;
  const activeWaitMs = activeSince ? clock - activeSince : 0;
  const showWorkflowTimeout = !hasNodes && (chatRunning || generationRunning) && activeWaitMs > WORKFLOW_WAIT_TIMEOUT_MS;
  const showStoppedEmpty = !hasNodes && messages.length > 0 && !chatRunning && !generationRunning;

  // Compute node card sizing based on count
  const nodeCount = workflow?.nodes.length ?? 0;
  const cardWidth = useMemo(() => {
    if (nodeCount <= 2) return "min-w-[180px] max-w-[220px]";
    if (nodeCount <= 4) return "min-w-[150px] max-w-[180px]";
    if (nodeCount <= 6) return "min-w-[130px] max-w-[160px]";
    return "min-w-[110px] max-w-[140px]";
  }, [nodeCount]);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {generationRunning && (
        <div className="flex shrink-0 items-center gap-2 border-b border-amber-200 bg-amber-50 px-4 py-2 text-[11.5px] text-amber-700 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-300">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          正在根据探索对话生成工作流，输入路径和报告目录会自动参数化。
        </div>
      )}
      {flowState.generationStatus === "failed" && (
        <div className="shrink-0 border-b border-rose-200 bg-rose-50 px-4 py-2 text-[11.5px] text-rose-600 dark:border-rose-900 dark:bg-rose-950/30 dark:text-rose-300">
          工作流生成失败：{flowState.generationError ?? "未知错误"}。可以在下方对话中补充要求后重试。
        </div>
      )}
      {!hasNodes && pendingQuestion && !chatRunning && (
        <div className="shrink-0 border-b border-amber-200 bg-amber-50 px-4 py-2 text-[11.5px] text-amber-700 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-300">
          pi 正在等待回复：{pendingQuestion}
        </div>
      )}
      {showWorkflowTimeout && (
        <div className="shrink-0 border-b border-amber-200 bg-amber-50 px-4 py-2 text-[11.5px] text-amber-700 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-300">
          已等待 {Math.floor(activeWaitMs / 1000)} 秒仍未读取到 workflow.json。若 pi 停在确认问题，请在下方直接回复；若已生成到其它目录，可点击「导入」选择该文件夹。
        </div>
      )}
      {/* ── Top half: Architecture + Progress ── */}
      <div className="flex min-h-0 flex-1 flex-col border-b border-neutral-200 dark:border-neutral-800">
        <div className="flex h-7 shrink-0 items-center gap-2 px-4">
          <span className="text-[10px] font-medium uppercase tracking-wide text-neutral-400 dark:text-neutral-500">架构</span>
          {hasNodes && <span className="text-[10px] text-neutral-400">{nodeCount} 节点</span>}
          <div className="ml-auto flex items-center gap-1">
            <input
              ref={fileRef}
              type="file"
              webkitdirectory=""
              directory=""
              multiple
              hidden
              onChange={(e) => {
                const f = e.target.files;
                if (f && f.length > 0) onImport(f);
                e.target.value = "";
              }}
            />
            <button
              onClick={() => fileRef.current?.click()}
              disabled={importing}
              className="inline-flex h-5 items-center gap-1 rounded px-1.5 text-[10px] text-neutral-400 hover:bg-neutral-100 disabled:opacity-50 dark:hover:bg-neutral-800"
            >
              {importing ? <RefreshCw className="h-3 w-3 animate-spin" /> : <FolderUp className="h-3 w-3" />}
              导入
            </button>
            {hasNodes && (
              <button
                onClick={p.onApplyToEditor}
                className="inline-flex h-5 items-center gap-1 rounded bg-neutral-900 px-2 text-[10px] font-medium text-white hover:bg-neutral-700 dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-white"
              >
                <Play className="h-3 w-3" strokeWidth={2} />
                切换到执行
              </button>
            )}
          </div>
        </div>

        {/* Architecture diagram */}
        <div className="min-h-0 flex-1 overflow-auto p-4">
          {!hasNodes ? (
            <div className="flex h-full items-center justify-center text-[12px] text-neutral-400 dark:text-neutral-500">
              {pendingQuestion && !chatRunning ? (
                <div className="flex max-w-md flex-col items-center gap-2 text-center">
                  <span className="font-medium text-amber-600 dark:text-amber-400">pi 正在等待你的回复</span>
                  <span className="leading-5 text-neutral-500 dark:text-neutral-400">{pendingQuestion}</span>
                </div>
              ) : chatRunning || generationRunning ? (
                <div className="flex max-w-md flex-col items-center gap-2 text-center">
                  <span className="flex items-center gap-2">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    pi 正在设计工作流架构…
                  </span>
                  {showWorkflowTimeout && (
                    <span className="text-[11px] leading-4 text-amber-600 dark:text-amber-400">
                      如果 pi 已经停下提问，直接在下方回复；如果 workflow.json 被写到业务输出目录，使用右上角「导入」载入该目录。
                    </span>
                  )}
                </div>
              ) : messages.length === 0 ? (
                "在下方描述需求，pi 将自动设计工作流"
              ) : showStoppedEmpty ? (
                <div className="flex max-w-md flex-col items-center gap-2 text-center">
                  <span className="font-medium text-neutral-700 dark:text-neutral-200">未读取到 workflow.json</span>
                  <span className="leading-5 text-neutral-500 dark:text-neutral-400">
                    可以让 pi 继续生成并明确写入当前 flow 根目录；如果文件已生成到其它项目目录，请导入包含 workflow.json 的文件夹。
                  </span>
                  <button
                    onClick={() => fileRef.current?.click()}
                    disabled={importing}
                    className="inline-flex h-7 items-center gap-1.5 rounded border border-neutral-200 px-2.5 text-[11px] text-neutral-600 hover:bg-neutral-50 disabled:opacity-50 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800"
                  >
                    {importing ? <RefreshCw className="h-3 w-3 animate-spin" /> : <FolderUp className="h-3 w-3" />}
                    导入 workflow 文件夹
                  </button>
                </div>
              ) : (
                "等待 pi 生成工作流节点…"
              )}
            </div>
          ) : (
            <div className="flex h-full items-center justify-center">
              <div className="flex flex-wrap items-center justify-center gap-2">
                {workflow.nodes.map((node, idx) => {
                  const isEditing = editingNodeId === node.id;
                  const color = nodeColor(node, idx);
                  const modelName = node.model
                    ? node.model.split("/").pop()
                    : (workflow.defaultModel || p.model).split("/").pop();

                  return (
                    <div key={node.id} className="flex items-center gap-2">
                      <div
                        onClick={() => setEditingNodeId(isEditing ? null : node.id)}
                        className={cn(
                          cardWidth,
                          "flex shrink-0 cursor-pointer flex-col gap-1.5 rounded-xl border px-4 py-3 text-left shadow-sm transition-all",
                          isEditing
                            ? "border-neutral-400 bg-neutral-50 shadow-md dark:border-neutral-500 dark:bg-neutral-800"
                            : "border-neutral-200 bg-white hover:border-neutral-300 hover:shadow-md dark:border-neutral-700 dark:bg-neutral-900 dark:hover:border-neutral-600",
                        )}
                        style={{ borderLeftWidth: 4, borderLeftColor: color }}
                      >
                        <div className="flex items-center gap-2">
                          <span className="text-xl leading-none">{nodeIcon(node)}</span>
                          <div className="min-w-0 flex-1">
                            <div className="text-[13px] font-semibold text-neutral-800 dark:text-neutral-100">
                              {node.label}
                            </div>
                            {node.role && (
                              <span
                                className="mt-0.5 inline-block rounded-full px-2 py-px text-[9px] font-medium"
                                style={{ backgroundColor: color + "22", color }}
                              >
                                {node.role}
                              </span>
                            )}
                          </div>
                        </div>
                        {node.desc && (
                          <p className="text-[11px] leading-relaxed text-neutral-500 dark:text-neutral-400">
                            {node.desc}
                          </p>
                        )}
                        <div className="flex items-center gap-1.5">
                          <span className="text-[10px] text-neutral-400">模型</span>
                          {isEditing ? (
                            /* eslint-disable-next-line jsx-a11y/no-static-element-interactions */
                            <span onClick={(e) => e.stopPropagation()}>
                              <ModelSelect
                                models={p.models}
                                value={node.model || workflow.defaultModel || p.model}
                                onChange={(v) => {
                                  updateNodeModel(node.id, v);
                                  setEditingNodeId(null);
                                }}
                              />
                            </span>
                          ) : (
                            <span
                              className={cn(
                                "rounded bg-neutral-100 px-1.5 py-0.5 font-mono text-[10px]",
                                node.model
                                  ? "text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300"
                                  : "italic text-neutral-400 dark:bg-neutral-800 dark:text-neutral-500",
                              )}
                            >
                              {modelName}
                            </span>
                          )}
                        </div>
                      </div>
                      {idx < workflow.nodes.length - 1 && (
                        <ArrowRight className="h-5 w-5 shrink-0 text-neutral-300 dark:text-neutral-600" strokeWidth={1.5} />
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {/* Progress bar */}
        <div className="shrink-0 border-t border-neutral-100 px-4 py-1.5 dark:border-neutral-800">
          <div className="flex items-center gap-1">
            {progress.milestones.map((m, i) => (
              <div key={m.label} className="flex items-center gap-0.5">
                {m.status === "done" ? (
                  <CheckCircle2 className="h-3 w-3 text-emerald-500" strokeWidth={2} />
                ) : m.status === "active" ? (
                  <Loader2 className="h-3 w-3 animate-spin text-amber-500" strokeWidth={2} />
                ) : (
                  <Circle className="h-3 w-3 text-neutral-300 dark:text-neutral-600" strokeWidth={1.5} />
                )}
                <span
                  className={cn(
                    "text-[10px]",
                    m.status === "done"
                      ? "text-emerald-600 dark:text-emerald-400"
                      : m.status === "active"
                        ? "font-medium text-amber-600 dark:text-amber-400"
                        : "text-neutral-400 dark:text-neutral-500",
                  )}
                >
                  {m.label}
                </span>
                {i < progress.milestones.length - 1 && (
                  <ArrowRight className="h-2.5 w-2.5 text-neutral-300 dark:text-neutral-600" strokeWidth={1.5} />
                )}
              </div>
            ))}
            <span className="ml-auto truncate text-[9.5px] text-neutral-400 dark:text-neutral-500">
              {progress.hint}
            </span>
          </div>
        </div>
      </div>

      {/* ── Bottom half: Chat ── */}
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="flex h-6 shrink-0 items-center gap-2 border-b border-neutral-100 px-4 dark:border-neutral-800">
          <span className="text-[9.5px] font-medium uppercase tracking-wide text-neutral-400 dark:text-neutral-500">对话</span>
          {(chatRunning || generationRunning) && !canReplyDuringGeneration && (
            <span className="flex items-center gap-1 text-[9.5px] text-amber-500">
              <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-amber-400" />
              pi 工作中
            </span>
          )}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {messages.length === 0 && !chatRunning ? (
            <div className="flex flex-col items-center gap-2 px-4 py-6">
              <p className="text-[11.5px] text-neutral-400 dark:text-neutral-500">
                描述你想创建的多智能体，pi 会引导你完成设计
              </p>
              <div className="flex flex-wrap gap-1.5">
                {[
                  { label: "数据分析", text: "帮我设计一个数据分析工作流：读取 CSV，清洗数据，统计分析，生成报告。" },
                  { label: "内容创作", text: "构建一个内容创作智能体：调研主题，制定大纲，撰写初稿，润色输出。" },
                  { label: "代码审查", text: "设计一个代码审查工作流：分析代码质量、安全漏洞、可维护性，输出审查报告。" },
                ].map((q) => (
                  <button
                    key={q.label}
                    onClick={() => {
                      setInput(q.text);
                      taRef.current?.focus();
                    }}
                    className="rounded-full border border-neutral-200 px-2 py-0.5 text-[10.5px] text-neutral-500 hover:border-neutral-300 hover:bg-neutral-50 dark:border-neutral-700 dark:text-neutral-400 dark:hover:border-neutral-600 dark:hover:bg-neutral-800/50"
                  >
                    {q.label}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="space-y-1 px-4 py-2">
              {messages.map((m) => {
                if (m.role === "user") {
                  return (
                    <div key={m.id} className="flex justify-end">
                      <div className="max-w-[75%] rounded-xl bg-neutral-100 px-3 py-1.5 text-[12px] leading-relaxed text-neutral-800 dark:bg-neutral-800 dark:text-neutral-200">
                        {textOf(m.content)}
                      </div>
                    </div>
                  );
                }
                const text = textOf(m.content);
                const ask = isQuestion(text);
                const expanded = expandedMsgIds.has(m.id);

                if (ask) {
                  return (
                    <div key={m.id} className="flex justify-start">
                      <div className="max-w-[75%] rounded-xl border border-amber-200 bg-amber-50 px-3 py-1.5 text-[12px] leading-relaxed text-neutral-800 dark:border-amber-800 dark:bg-amber-950/30 dark:text-neutral-200">
                        {text}
                      </div>
                    </div>
                  );
                }

                const preview = text.slice(0, 100).replace(/\n/g, " ");
                return (
                  <div key={m.id} className="flex justify-start">
                    <button
                      onClick={() => toggleMsg(m.id)}
                      className="group flex max-w-[75%] items-start gap-1.5 rounded-xl px-3 py-1.5 text-left text-[12px] leading-relaxed text-neutral-400 transition-colors hover:bg-neutral-50 dark:text-neutral-500 dark:hover:bg-neutral-800/50"
                    >
                      {expanded ? (
                        <ChevronUp className="mt-0.5 h-3 w-3 shrink-0 text-neutral-300 dark:text-neutral-600" strokeWidth={1.75} />
                      ) : (
                        <ChevronDown className="mt-0.5 h-3 w-3 shrink-0 text-neutral-300 dark:text-neutral-600" strokeWidth={1.75} />
                      )}
                      <span className={cn(expanded ? "text-neutral-700 dark:text-neutral-300" : "italic")}>
                        {expanded ? text : (preview || "pi 正在处理…")}
                      </span>
                    </button>
                  </div>
                );
              })}
              {(chatRunning || generationRunning) && !canReplyDuringGeneration && (
                <div className="flex items-center gap-2 text-[11px] text-neutral-400">
                  <span className="inline-block h-2.5 w-1.5 animate-pulse bg-neutral-300 dark:bg-neutral-600" />
                  pi 正在处理…
                </div>
              )}
              <div ref={bottomRef} />
            </div>
          )}
        </div>

        {importHint && (
          <div className="border-t border-neutral-100 bg-neutral-50 px-4 py-1 text-[10px] text-neutral-500 dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-400">
            {importHint}
          </div>
        )}

        <div className="shrink-0 border-t border-neutral-100 px-3 py-2 dark:border-neutral-800">
          <div className="flex items-end gap-2">
            <div className="flex min-h-[30px] flex-1 items-center rounded-lg border border-neutral-200 bg-white dark:border-neutral-700 dark:bg-neutral-900">
              <textarea
                ref={taRef}
                value={input}
                disabled={generationRunning && !canReplyDuringGeneration}
                onChange={(e) => {
                  setInput(e.target.value);
                  autosize();
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && e.shiftKey && !e.nativeEvent.isComposing) {
                    e.preventDefault();
                    submit();
                  }
                }}
                rows={1}
                placeholder={canReplyDuringGeneration ? "回复 pi 的问题，Shift+Enter 发送" : generationRunning ? "正在从探索对话生成工作流..." : "描述需求或告诉 pi 修复问题，Shift+Enter 发送"}
                className="min-h-[30px] w-full resize-none bg-transparent px-3 py-1.5 text-[12.5px] leading-5 text-neutral-900 outline-none placeholder:text-neutral-400 disabled:opacity-50 dark:text-neutral-100 dark:placeholder:text-neutral-500"
              />
            </div>
            <div className="flex items-center gap-1">
              <label className="flex items-center gap-1 text-[10px] text-neutral-400">
                <Cpu className="h-3 w-3" strokeWidth={1.75} />
                {p.models.length > 0 ? (
                  <ModelSelect models={p.models} value={p.model} onChange={p.onModelChange} />
                ) : (
                  <input
                    value={p.model}
                    onChange={(e) => p.onModelChange(e.target.value)}
                    placeholder="加载中…"
                    className="w-28 rounded bg-transparent px-1 py-0.5 text-[10px] outline-none placeholder:text-neutral-400 focus:bg-neutral-100 dark:focus:bg-neutral-800"
                  />
                )}
              </label>
              <button
                onClick={chatRunning ? stopChat : submit}
                disabled={(generationRunning && !canReplyDuringGeneration) || (!chatRunning && !input.trim())}
                className={cn(
                  "inline-flex h-7 w-7 items-center justify-center rounded-full transition-colors",
                  (generationRunning && !canReplyDuringGeneration) || (!chatRunning && !input.trim())
                    ? "bg-neutral-200 text-neutral-400 dark:bg-neutral-800 dark:text-neutral-600"
                    : "bg-neutral-900 text-white hover:bg-neutral-700 dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-white",
                )}
              >
                {chatRunning ? (
                  <Square className="h-3 w-3" strokeWidth={2.5} fill="currentColor" />
                ) : (
                  <ArrowUp className="h-3.5 w-3.5" strokeWidth={2} />
                )}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
