import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowRight,
  CheckCircle2,
  Loader2,
  MessageSquare,
  Play,
  Square,
  Users,
  Workflow,
  XCircle,
} from "lucide-react";
import { Markdown } from "@/components/Markdown";
import { CreationPane } from "@/components/CreationPane";
import { RunOutputPanel } from "@/components/RunOutputPanel";
import { api } from "@/lib/api";
import { gateway } from "@/lib/ws";
import { cn } from "@/lib/cn";
import type { Flow, FlowRun, FlowTreeNode, PiEvent, PiModel, ServerMessage, WorkflowDef, WorkflowNode } from "@/types";

interface Props {
  flow: Flow | null;
  models: PiModel[];
  model: string;
  onModelChange: (m: string) => void;
  refreshKey?: number;
  rulesPromptEnabled: boolean;
}

type StepStatus = "pending" | "running" | "done" | "failed";

interface StepState {
  status: StepStatus;
  output: string;
  events: PiEvent[];
}

type CenterTab = "flow" | "logs";

type View = "chat" | "execute";

const PLACEHOLDER_RE = /\{\{\s*([a-zA-Z0-9_\-一-鿿.]+)\s*\}\}/g;
/** Built-in injected keys that are not upstream node references. */
const INPUT_KEYS = new Set(["task", "prompt", "query"]);

/** Parse a node's prompt for {{nodeId}} placeholders referencing upstream nodes. */
function upstreamRefs(prompt: string | undefined, nodeIds: Set<string>): string[] {
  if (!prompt) return [];
  const out = new Set<string>();
  for (const m of prompt.matchAll(PLACEHOLDER_RE)) {
    const key = m[1]!;
    if (key.startsWith("input.") || INPUT_KEYS.has(key)) continue;
    if (nodeIds.has(key)) out.add(key);
  }
  return [...out];
}

const CREATION_SYSTEM_PROMPT = `你是一个多智能体工作流设计师。用户描述需求后，你需要：

1. 提出 1-2 个关键澄清问题，理解核心需求
2. 将工作流拆解为多个独立 agent 节点，每个节点有明确的角色和输出
3. 为每个节点设计执行 prompt，使用 {{task}} 作为任务占位符
4. 最终生成 workflow.json 到当前工作目录，格式：
   { "version": 1, "defaultModel": "", "nodes": [{ "id": "...", "label": "节点名", "prompt": "执行指令，支持{{task}}占位符", "model": "", "role": "角色标签", "icon": "🔍", "desc": "节点简介" }], "edges": [...] }

节点之间通过 edges 串联，后续节点可通过 {{前序节点id}} 引用前一步产出。始终专注于工作流设计。`;

const PRIMING_PROMPT = `你是一个多智能体工作流编排器。请：

1. 用 Read/LS 扫描当前工作目录的所有文件，理解工作流的意图、步骤、模板和依赖。
2. 判断它是否已具备清晰的多步骤工作流结构。
3. 若需要改造：补全缺失的说明文档、把流程描述重写成多 agent 逐步执行的格式、整理 templates/。
4. 若任何环节你无法仅凭文件理解原意，请直接向我提问。
5. 最后，请在当前目录下生成或更新 workflow.json，格式如下：
   { "version": 1, "defaultModel": "<推荐模型id>", "nodes": [
     { "id": "step1", "label": "步骤名称", "prompt": "该步骤的提示词模板（支持{{node_id}}占位符）", "model": "", "role": "角色标签(如researcher/writer)", "icon": "🔍", "color": "#0ea5e9", "desc": "该节点的简短描述" }
   ], "edges": [{ "id": "e1", "source": "step1", "target": "step2" }] }
   每个节点对应一个 agent 步骤，edges 按执行顺序串联。为每个节点设置合适的 role/icon/color/desc 字段以便前端渲染。
   如果 workflow.json 已存在且内容合理则无需覆盖。`;

function makeRunId(): string {
  return `r${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

function basename(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).at(-1) ?? path;
}

function collectTreeDirs(node: FlowTreeNode, out = new Set<string>()): Set<string> {
  if (node.kind === "dir") out.add(node.path);
  for (const child of node.children ?? []) collectTreeDirs(child, out);
  return out;
}

/** Pick a deterministic fallback color when the node doesn't specify one. */
const FALLBACK_COLORS = [
  "#0ea5e9", // sky
  "#10b981", // emerald
  "#f59e0b", // amber
  "#ef4444", // rose
  "#8b5cf6", // violet
  "#ec4899", // pink
  "#14b8a6", // teal
  "#f97316", // orange
];
function colorForNode(node: WorkflowNode, index: number): string {
  if (node.color) return node.color;
  return FALLBACK_COLORS[index % FALLBACK_COLORS.length]!;
}

function iconForNode(node: WorkflowNode): string {
  if (node.icon) return node.icon;
  return "\u{1F916}"; // 🤖 default
}

/** Extract text from pi message_end events for the live dialog tab. */
function extractEventText(event: PiEvent): string {
  if (event.type !== "message_end") return "";
  const msg = (event as { message?: { role?: string; content?: unknown } }).message;
  if (!msg || msg.role !== "assistant") return "";
  if (!Array.isArray(msg.content)) return "";
  return msg.content
    .filter(
      (b): b is { type: "text"; text: string } =>
        typeof b === "object" && b !== null && (b as { type?: string }).type === "text",
    )
    .map((b) => b.text)
    .join("\n")
    .trim();
}

function describePiEvent(event: PiEvent): string | null {
  if (event.type === "process_start") {
    const cwd = typeof event.cwd === "string" ? event.cwd : "";
    const command = typeof event.command === "string" ? event.command : "pi";
    return `启动 ${command} cwd=${cwd}`;
  }
  if (event.type === "spawn_error") {
    return `spawn_error: ${typeof event.message === "string" ? event.message : JSON.stringify(event)}`;
  }
  if (event.type === "stderr") {
    const text = typeof event.text === "string" ? event.text.trim() : JSON.stringify(event);
    return text ? `stderr: ${text}` : null;
  }
  if (event.type === "turn_start") return "pi turn_start";
  if (event.type === "agent_start") return "pi agent_start";
  return null;
}

export function MultiAgentExecutionPane(p: Props) {
  const flowId = p.flow?.id ?? "";
  const [view, setView] = useState<View>("chat");
  const [workflowRefreshKey, setWorkflowRefreshKey] = useState(0);
  const [workflow, setWorkflow] = useState<WorkflowDef | null>(null);
  const [loading, setLoading] = useState(true);

  // ---- execute state ----
  const [taskText, setTaskText] = useState("");
  const [runId, setRunId] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [activeNodeId, setActiveNodeId] = useState<string | null>(null);
  const [stepStates, setStepStates] = useState<Record<string, StepState>>({});
  const [logs, setLogs] = useState<string[]>([]);

  const [runs, setRuns] = useState<FlowRun[]>([]);
  const [centerTab, setCenterTab] = useState<CenterTab>("flow");
  const [expandedNode, setExpandedNode] = useState<string | null>(null);

  // ---- resizable left rail ----
  const [leftWidth, setLeftWidth] = useState(() => Number(localStorage.getItem("xanthil-magent-left-w")) || 288);
  const dragRef = useRef<{ startX: number; startW: number } | null>(null);
  const onLeftDragStart = useCallback((e: React.MouseEvent) => {
    dragRef.current = { startX: e.clientX, startW: leftWidth };
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  }, [leftWidth]);
  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!dragRef.current) return;
      const next = Math.max(240, Math.min(560, dragRef.current.startW + e.clientX - dragRef.current.startX));
      setLeftWidth(next);
    };
    const onUp = () => {
      if (!dragRef.current) return;
      dragRef.current = null;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      setLeftWidth((w) => {
        localStorage.setItem("xanthil-magent-left-w", String(w));
        return w;
      });
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, []);

  const runIdRef = useRef<string | null>(null);
  runIdRef.current = runId;

  const flowIdRef = useRef<string | null>(null);
  flowIdRef.current = flowId;

  // ---- Load workflow.json on flow change / refresh ----
  useEffect(() => {
    if (!flowId) return;
    let cancelled = false;
    setLoading(true);
    api.flowWorkflowGet(flowId).then((r) => {
      if (cancelled) return;
      setWorkflow(r.workflow);
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [flowId, p.refreshKey, workflowRefreshKey]);

  // ---- Load run history ----
  useEffect(() => {
    if (!flowId) return;
    api.listFlowRuns(flowId).then((rows) => {
      setRuns(rows);
      const active = rows.find((r) => r.status === "running");
      if (active) {
        const restoredRunId = basename(active.outputDir);
        setRunId(restoredRunId);
        setRunning(true);
        setLogs((cur) => cur.length > 0 ? cur : [`─ 已从历史恢复运行状态 ${restoredRunId}`]);
        api.flowRunTree(flowId, active.id).then((tree) => {
          const dirs = collectTreeDirs(tree);
          setStepStates((cur) => {
            const next = { ...cur };
            const created = (workflow?.nodes ?? []).filter((node) => dirs.has(node.id));
            created.forEach((node, idx) => {
              const isLastCreated = idx === created.length - 1;
              next[node.id] = next[node.id] ?? { status: isLastCreated ? "running" : "done", output: "", events: [] };
            });
            return next;
          });
          const activeNode = [...(workflow?.nodes ?? [])].reverse().find((node) => dirs.has(node.id));
          if (activeNode) setActiveNodeId(activeNode.id);
        }).catch(() => undefined);
      }
    }).catch(() => setRuns([]));
  }, [flowId, workflow]);

  // ---- Subscribe to multi-agent execution events ----
  useEffect(() => {
    return gateway.subscribe((msg: ServerMessage) => {
      if (!("flowId" in msg) || msg.flowId !== flowId) return;
      if (!("runId" in msg) || msg.runId !== runIdRef.current) return;

      switch (msg.type) {
        case "run_start":
          // The DB run row now exists — pull it so the output panel can resolve run.id.
          api.listFlowRuns(flowId).then(setRuns).catch(() => undefined);
          break;
        case "agent_step_start":
          setActiveNodeId(msg.nodeId);
          setStepStates((cur) => ({
            ...cur,
            [msg.nodeId]: { status: "running", output: "", events: [] },
          }));
          setLogs((cur) => [...cur, `▶ ${msg.nodeId} 开始执行`]);
          break;
        case "agent_event": {
          const line = describePiEvent(msg.event);
          if (line) setLogs((cur) => [...cur, `[${msg.nodeId}] ${line}`]);
          setStepStates((cur) => {
            const prev = cur[msg.nodeId] ?? { status: "running" as StepStatus, output: "", events: [] };
            const text = extractEventText(msg.event);
            return {
              ...cur,
              [msg.nodeId]: {
                ...prev,
                events: [...prev.events, msg.event],
                output: text || prev.output,
              },
            };
          });
          break;
        }
        case "agent_step_end":
          setStepStates((cur) => {
            const prev = cur[msg.nodeId] ?? { status: "done" as StepStatus, output: "", events: [] };
            return {
              ...cur,
              [msg.nodeId]: { ...prev, status: msg.code === 0 ? "done" : "failed" },
            };
          });
          setLogs((cur) => [...cur, msg.code === 0 ? `✔ ${msg.nodeId} 完成` : `✖ ${msg.nodeId} 失败 (code=${msg.code})`]);
          break;
        case "blackboard_update":
          // Final per-node text — fold into stepStates as the authoritative output.
          setStepStates((cur) => {
            const prev = cur[msg.key] ?? { status: "done" as StepStatus, output: "", events: [] };
            return { ...cur, [msg.key]: { ...prev, output: msg.value || prev.output } };
          });
          break;
        case "run_end":
          setRunning(false);
          setActiveNodeId(null);
          setLogs((cur) => [...cur, msg.aborted ? "─ 已强制停止" : `─ 运行结束 (code=${msg.code})`]);
          api.listFlowRuns(flowId).then(setRuns).catch(() => undefined);
          break;
        case "error":
          setRunning(false);
          setLogs((cur) => [...cur, `✖ ${msg.message}`]);
          break;
      }
    });
  }, [flowId]);

  // ---- apply to editor ----
  const applyToEditor = useCallback(() => {
    setView("execute");
    setWorkflowRefreshKey((k) => k + 1);
  }, []);

  // ---- execute actions ----
  const handleRun = useCallback(() => {
    if (!flowId || !workflow || running) return;
    const newRunId = makeRunId();
    setRunId(newRunId);
    setRunning(true);
    setStepStates({});
    setLogs([`─ 启动运行 ${newRunId}`]);
    setActiveNodeId(null);
    const inputs = taskText.trim()
      ? { task: taskText.trim(), prompt: taskText.trim(), query: taskText.trim() }
      : undefined;
    gateway.send({
      type: "execute_multi_agent",
      flowId,
      runId: newRunId,
      inputs,
      model: p.model || undefined,
      injectRulesPrompt: p.rulesPromptEnabled,
    });
  }, [flowId, workflow, running, p.model, p.rulesPromptEnabled, taskText]);

  const handleAbortRun = useCallback(() => {
    if (!flowId || !runId || !running) return;
    gateway.send({ type: "abort_multi_agent", flowId, runId });
    setLogs((cur) => [...cur, "─ 正在强制停止当前工作流…"]);
  }, [flowId, runId, running]);

  const orderedNodes = useMemo(() => workflow?.nodes ?? [], [workflow]);
  const nodeIdSet = useMemo(() => new Set(orderedNodes.map((n) => n.id)), [orderedNodes]);
  const doneCount = useMemo(
    () => orderedNodes.filter((n) => stepStates[n.id]?.status === "done").length,
    [orderedNodes, stepStates],
  );
  const currentOutputDir = p.flow && runId ? `${p.flow.folderPath}/runs/${runId}` : null;

  const CENTER_TABS: { id: CenterTab; label: string }[] = [
    { id: "flow", label: "执行流" },
    { id: "logs", label: "日志" },
  ];

  if (!p.flow) {
    return (
      <div className="flex flex-1 items-center justify-center text-neutral-400 dark:text-neutral-500">
        <div className="flex flex-col items-center gap-2">
          <Users className="h-8 w-8" strokeWidth={1.5} />
          <span className="text-[13px]">在左侧选择一个多智能体工作流</span>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* sub-view switcher */}
      <div className="flex h-10 shrink-0 items-center gap-1 border-b border-neutral-200 px-4 dark:border-neutral-800">
        <button
          onClick={() => setView("chat")}
          className={cn(
            "inline-flex h-7 items-center gap-1.5 rounded-md px-2.5 text-[12.5px]",
            view === "chat"
              ? "bg-neutral-100 font-medium text-neutral-900 dark:bg-neutral-800 dark:text-neutral-100"
              : "text-neutral-500 hover:bg-neutral-100 hover:text-neutral-900 dark:text-neutral-400 dark:hover:bg-neutral-800/60 dark:hover:text-neutral-100",
          )}
        >
          <MessageSquare className="h-3.5 w-3.5" strokeWidth={1.75} />
          创建
        </button>
        <button
          onClick={() => { setView("execute"); setWorkflowRefreshKey((k) => k + 1); }}
          className={cn(
            "inline-flex h-7 items-center gap-1.5 rounded-md px-2.5 text-[12.5px]",
            view === "execute"
              ? "bg-neutral-100 font-medium text-neutral-900 dark:bg-neutral-800 dark:text-neutral-100"
              : "text-neutral-500 hover:bg-neutral-100 hover:text-neutral-900 dark:text-neutral-400 dark:hover:bg-neutral-800/60 dark:hover:text-neutral-100",
          )}
        >
          <Workflow className="h-3.5 w-3.5" strokeWidth={1.75} />
          执行
        </button>
        <span className="ml-auto truncate text-[11px] text-neutral-400 dark:text-neutral-500">
          {p.flow.folderPath}
        </span>
      </div>

      <div className="flex min-h-0 flex-1">
        {view === "chat" ? (
          <CreationPane
            flow={p.flow}
            kind="multi"
            models={p.models}
            model={p.model}
            onModelChange={p.onModelChange}
            onApplyToEditor={applyToEditor}
            systemPrompt={CREATION_SYSTEM_PROMPT}
            primingPrompt={PRIMING_PROMPT}
            rulesPromptEnabled={p.rulesPromptEnabled}
          />
        ) : loading ? (
          <div className="flex flex-1 items-center justify-center text-neutral-400">
            <Loader2 className="h-6 w-6 animate-spin" strokeWidth={1.75} />
          </div>
        ) : (
          <div className="flex min-h-0 flex-1">
            {/* ---- Left: run control + task brief ---- */}
            <aside
              style={{ width: leftWidth }}
              className="relative flex shrink-0 flex-col border-r border-neutral-200 dark:border-neutral-800"
            >
              {/* run header */}
              <div className="flex h-10 shrink-0 items-center gap-2 border-b border-neutral-200 px-3 dark:border-neutral-800">
                <span className="min-w-0 truncate text-[11px] font-medium text-neutral-500">{runId ?? "等待运行"}</span>
                {runId && (
                  <span className={cn(
                    "ml-auto text-[10px] font-medium",
                    running ? "text-amber-600" : "text-neutral-400",
                  )}>
                    {running ? "运行中" : "已结束"}
                  </span>
                )}
              </div>

              {/* task brief — fills the rail, drag the right edge to widen */}
              <div className="flex min-h-0 flex-1 flex-col gap-1.5 px-3 py-3">
                <label className="shrink-0 text-[11px] font-medium text-neutral-500">任务说明</label>
                <textarea
                  value={taskText}
                  onChange={(e) => setTaskText(e.target.value)}
                  disabled={running}
                  placeholder="描述本次工作流的任务目标、输入数据范围、关键约束与期望产出。内容将作为 {{task}} 注入各节点。"
                  className="min-h-0 w-full flex-1 resize-none rounded-md border border-neutral-200 bg-transparent px-2.5 py-2 text-[12px] leading-5 text-neutral-900 outline-none placeholder:text-neutral-400 focus:border-neutral-400 disabled:opacity-50 dark:border-neutral-700 dark:text-neutral-100 dark:focus:border-neutral-500"
                />
              </div>

              {/* run button + output path */}
              <div className="flex shrink-0 flex-col gap-1 border-t border-neutral-200 px-3 py-2 dark:border-neutral-800">
                {running ? (
                  <button
                    onClick={handleAbortRun}
                    className="flex h-8 w-full items-center justify-center gap-1.5 rounded-md bg-rose-500 text-[12.5px] font-medium text-white transition-colors hover:bg-rose-600 dark:bg-rose-600 dark:hover:bg-rose-700"
                  >
                    <Square className="h-3.5 w-3.5" strokeWidth={2} fill="currentColor" />
                    强制停止
                  </button>
                ) : (
                  <button
                    onClick={handleRun}
                    disabled={!workflow}
                    className={cn(
                      "flex w-full items-center justify-center gap-1.5 rounded-md h-8 text-[12.5px] font-medium transition-colors",
                      !workflow
                        ? "bg-neutral-100 text-neutral-400 cursor-not-allowed dark:bg-neutral-800 dark:text-neutral-600"
                        : "bg-sky-500 text-white hover:bg-sky-600 dark:bg-sky-600 dark:hover:bg-sky-700",
                    )}
                  >
                    <Play className="h-3.5 w-3.5" strokeWidth={2} />
                    运行工作流
                  </button>
                )}
                {currentOutputDir && (
                  <div className="truncate font-mono text-[9px] text-neutral-400" title={currentOutputDir}>
                    输出：{currentOutputDir}
                  </div>
                )}
              </div>

              {/* resize handle */}
              <div
                onMouseDown={onLeftDragStart}
                className="absolute right-0 top-0 h-full w-1 cursor-col-resize hover:bg-neutral-300 dark:hover:bg-neutral-700"
              />
            </aside>

            {/* ---- Center: dialog / blackboard / logs ---- */}
            <div className="flex min-h-0 min-w-0 flex-1 flex-col">
              {/* center tab strip */}
              <div className="flex h-9 shrink-0 items-center gap-1 border-b border-neutral-200 px-3 dark:border-neutral-800">
                {CENTER_TABS.map((t) => (
                  <button
                    key={t.id}
                    onClick={() => setCenterTab(t.id)}
                    className={cn(
                      "inline-flex h-7 items-center rounded-md px-2.5 text-[11.5px] transition-colors",
                      centerTab === t.id
                        ? "bg-neutral-100 font-medium text-neutral-900 dark:bg-neutral-800 dark:text-neutral-100"
                        : "text-neutral-500 hover:bg-neutral-50 hover:text-neutral-900 dark:text-neutral-400 dark:hover:bg-neutral-800/50",
                    )}
                  >
                    {t.label}
                  </button>
                ))}
                {centerTab === "flow" && orderedNodes.length > 0 && (
                  <div className="ml-auto flex items-center gap-2">
                    <span className="text-[10px] tabular-nums text-neutral-400">
                      {doneCount}/{orderedNodes.length}
                    </span>
                    <div className="h-1 w-20 overflow-hidden rounded-full bg-neutral-200 dark:bg-neutral-700">
                      <div
                        className={cn("h-full rounded-full transition-all", running ? "bg-amber-400" : "bg-emerald-500")}
                        style={{ width: `${(doneCount / orderedNodes.length) * 100}%` }}
                      />
                    </div>
                  </div>
                )}
              </div>

              {/* center content */}
              <div className="flex min-h-0 flex-1 overflow-y-auto">
                {centerTab === "flow" && (
                  <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto p-3">
                    {orderedNodes.length === 0 ? (
                      <div className="flex flex-1 items-center justify-center text-[12px] text-neutral-400">
                        工作流暂无节点
                      </div>
                    ) : (
                      orderedNodes.map((node, idx) => {
                        const state = stepStates[node.id];
                        const refs = upstreamRefs(node.prompt, nodeIdSet);
                        const isExpanded = expandedNode === node.id;
                        const isActive = activeNodeId === node.id;
                        const color = colorForNode(node, idx);
                        return (
                          <div
                            key={node.id}
                            className={cn(
                              "rounded-md border",
                              isActive
                                ? "border-sky-300 dark:border-sky-800"
                                : "border-neutral-200 dark:border-neutral-700",
                            )}
                          >
                            <button
                              onClick={() => setExpandedNode(isExpanded ? null : node.id)}
                              className="flex w-full items-center gap-2 px-3 py-2 text-left"
                            >
                              <span
                                className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px]"
                                style={{ backgroundColor: color + "22", color }}
                              >
                                {state?.status === "done" ? (
                                  <CheckCircle2 className="h-3.5 w-3.5" strokeWidth={2.5} />
                                ) : state?.status === "failed" ? (
                                  <XCircle className="h-3.5 w-3.5" strokeWidth={2.5} />
                                ) : state?.status === "running" ? (
                                  <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={2.5} />
                                ) : (
                                  <span>{iconForNode(node)}</span>
                                )}
                              </span>
                              <span className="text-[12px] font-medium text-neutral-800 dark:text-neutral-100">{node.label}</span>
                              {node.role && (
                                <span
                                  className="shrink-0 rounded-full px-1.5 py-0.5 text-[9px] font-medium"
                                  style={{ backgroundColor: color + "22", color }}
                                >
                                  {node.role}
                                </span>
                              )}
                              {refs.length > 0 && (
                                <span className="flex shrink-0 items-center gap-0.5 text-[10px] text-neutral-400" title={`引用上游节点：${refs.join(", ")}`}>
                                  <ArrowRight className="h-3 w-3" strokeWidth={1.75} />
                                  {refs.join(", ")}
                                </span>
                              )}
                              <span className="ml-auto shrink-0 text-[10px] text-neutral-400">
                                {state?.status === "running" ? "执行中" : state?.status === "done" ? "完成" : state?.status === "failed" ? "失败" : "待执行"}
                              </span>
                            </button>
                            {isExpanded && (
                              <div className="border-t border-neutral-100 px-3 py-2 dark:border-neutral-800">
                                {state?.output ? (
                                  <div className="prose prose-sm dark:prose-invert max-w-none text-[13px]">
                                    <Markdown>{state.output}</Markdown>
                                  </div>
                                ) : (
                                  <p className="text-[11.5px] text-neutral-400">
                                    {state?.status === "running" ? "等待节点输出…" : "暂无产出"}
                                  </p>
                                )}
                              </div>
                            )}
                          </div>
                        );
                      })
                    )}
                  </div>
                )}

                {centerTab === "logs" && (
                  <div className="flex min-h-0 flex-1 flex-col overflow-y-auto p-3">
                    {logs.length === 0 ? (
                      <div className="flex flex-1 items-center justify-center text-[12px] text-neutral-400">
                        暂无日志
                      </div>
                    ) : (
                      <div className="flex flex-col gap-0.5 font-mono text-[11px] text-neutral-600 dark:text-neutral-400">
                        {logs.map((line, i) => (
                          <div key={i} className="flex items-start gap-2">
                            <span className="shrink-0 text-neutral-300 dark:text-neutral-600">{i + 1}</span>
                            <span className="whitespace-pre-wrap">{line}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>

            {/* ---- Right: editable run output preview ---- */}
            <RunOutputPanel
              flowId={flowId}
              runs={runs}
              currentRunId={runId}
              running={running}
            />
          </div>
        )}
      </div>
    </div>
  );
}
