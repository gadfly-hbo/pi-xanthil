import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowRight,
  AlertCircle,
  GitBranch,
  CheckCircle2,
  Copy,
  Loader2,
  MessageSquare,
  Play,
  Plus,
  Save,
  Square,
  Trash2,
  Users,
  Workflow,
  Wrench,
  XCircle,
} from "lucide-react";
import { Markdown } from "@/components/Markdown";
import { CreationPane } from "@/components/CreationPane";
import { RunOutputPanel } from "@/components/RunOutputPanel";
import { WorkflowDagEditor } from "@/components/WorkflowDagEditor";
import { api } from "@/lib/api";
import { gateway } from "@/lib/ws";
import { cn } from "@/lib/cn";
import type { ExtractionTool, Flow, FlowRun, FlowTreeNode, PiEvent, PiModel, ServerMessage, WorkflowDef, WorkflowNode } from "@/types";

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

interface ToolStepOutput {
  kind: "tool";
  toolId: string;
  outputPath: string;
  summaryPath: string;
  success: boolean;
  artifacts: string[];
}

type CenterTab = "flow" | "logs";

type View = "chat" | "execute";

type WorkflowNodeKind = NonNullable<WorkflowNode["kind"]>;
type WorkflowIssueLevel = "warning" | "error";

interface WorkflowIssue {
  level: WorkflowIssueLevel;
  nodeId?: string;
  edgeId?: string;
  message: string;
}

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

1. 直接生成可执行工作流，不要中途提问，不要等待用户确认推荐方案。只有在缺少必要信息且完全无法继续时，才提出一个可回答的问题
2. 将工作流拆解为多个独立 agent 节点，每个节点有明确的角色和输出
3. 为每个节点设计执行 prompt，使用 {{task}} 作为任务占位符
4. 最终必须生成 workflow.json 到当前工作目录，也就是本次 flow 的根目录。用户需求里的"输出到某项目目录/报告目录/绝对路径"只适用于业务产物，不适用于 workflow.json；workflow.json 是 pi-Xanthil UI 载体，永远写在当前工作目录
5. workflow.json 格式：
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
  if (node.kind === "tool") return "\u{1F6E0}";
  if (node.kind === "gate") return "\u{1F6A6}";
  return "\u{1F916}"; // 🤖 default
}

function normalizedNodeKind(node: WorkflowNode): WorkflowNodeKind {
  return node.kind ?? "agent";
}

function nodeKindLabel(kind: WorkflowNodeKind): string {
  if (kind === "tool") return "tool";
  if (kind === "gate") return "gate";
  return "agent";
}

function nextUniqueId(base: string, used: Set<string>): string {
  const cleaned = base.trim().replace(/[^a-zA-Z0-9_-]+/g, "-").replace(/^-+|-+$/g, "") || "node";
  if (!used.has(cleaned)) return cleaned;
  for (let i = 2; i < 1000; i += 1) {
    const candidate = `${cleaned}-${i}`;
    if (!used.has(candidate)) return candidate;
  }
  return `${cleaned}-${Date.now().toString(36)}`;
}

function makeEdgeId(source: string, target: string, used: Set<string>): string {
  return nextUniqueId(`e-${source}-${target}`, used);
}

function validateWorkflowEditor(workflow: WorkflowDef | null): WorkflowIssue[] {
  if (!workflow) return [];
  const issues: WorkflowIssue[] = [];
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const node of workflow.nodes) {
    if (!node.id.trim()) issues.push({ level: "error", nodeId: node.id, message: "node id 不能为空" });
    if (seen.has(node.id)) duplicates.add(node.id);
    seen.add(node.id);
    if (!node.label.trim()) issues.push({ level: "warning", nodeId: node.id, message: `${node.id || "未命名节点"} 缺少节点名称` });
    if (normalizedNodeKind(node) === "tool") {
      if (!node.toolId?.trim()) issues.push({ level: "error", nodeId: node.id, message: `${node.id} 缺少 toolId` });
      if (!node.inputPath?.trim()) issues.push({ level: "error", nodeId: node.id, message: `${node.id} 缺少 inputPath` });
    }
  }
  for (const id of duplicates) issues.push({ level: "error", nodeId: id, message: `node id 重复：${id}` });
  const nodeIds = new Set(workflow.nodes.map((node) => node.id));
  for (const edge of workflow.edges) {
    if (!nodeIds.has(edge.source)) issues.push({ level: "error", edgeId: edge.id, message: `${edge.id} source 不存在：${edge.source}` });
    if (!nodeIds.has(edge.target)) issues.push({ level: "error", edgeId: edge.id, message: `${edge.id} target 不存在：${edge.target}` });
    if (edge.source === edge.target) issues.push({ level: "warning", edgeId: edge.id, message: `${edge.id} 指向自身` });
  }
  return issues;
}

function parseToolStepOutput(text: string): ToolStepOutput | null {
  if (!text.trim()) return null;
  try {
    const value = JSON.parse(text) as Partial<ToolStepOutput>;
    if (
      value.kind !== "tool"
      || typeof value.toolId !== "string"
      || typeof value.outputPath !== "string"
      || typeof value.summaryPath !== "string"
      || typeof value.success !== "boolean"
      || !Array.isArray(value.artifacts)
      || !value.artifacts.every((item) => typeof item === "string")
    ) {
      return null;
    }
    return value as ToolStepOutput;
  } catch {
    return null;
  }
}

function toRunRelativePath(runRoot: string | null, absoluteOrRelative: string): string | null {
  const value = absoluteOrRelative.trim();
  if (!value) return null;
  if (!runRoot) return value.startsWith("/") ? null : value;
  const normalizedRoot = runRoot.replace(/\/+$/, "");
  if (value === normalizedRoot) return "";
  if (value.startsWith(normalizedRoot + "/")) return value.slice(normalizedRoot.length + 1);
  return value.startsWith("/") ? null : value;
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
  const [workflowDirty, setWorkflowDirty] = useState(false);
  const [savingWorkflow, setSavingWorkflow] = useState(false);
  const [workflowSaveError, setWorkflowSaveError] = useState<string | null>(null);
  const [workflowSaveMessage, setWorkflowSaveMessage] = useState<string | null>(null);
  const [tools, setTools] = useState<ExtractionTool[]>([]);
  const [loadingTools, setLoadingTools] = useState(false);

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
  const [requestedOutputFile, setRequestedOutputFile] = useState<{ path: string; nonce: number } | null>(null);
  const [showDagEditor, setShowDagEditor] = useState(false);

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
      setWorkflowDirty(false);
      setWorkflowSaveError(null);
      setWorkflowSaveMessage(null);
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [flowId, p.refreshKey, workflowRefreshKey]);

  useEffect(() => {
    let cancelled = false;
    setLoadingTools(true);
    api.listExtractionTools()
      .then((items) => {
        if (!cancelled) setTools(items);
      })
      .catch(() => {
        if (!cancelled) setTools([]);
      })
      .finally(() => {
        if (!cancelled) setLoadingTools(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

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

  const updateWorkflowNode = useCallback((nodeId: string, patch: Partial<WorkflowNode>) => {
    setWorkflow((cur) => {
      if (!cur) return cur;
      return {
        ...cur,
        nodes: cur.nodes.map((node) => (node.id === nodeId ? { ...node, ...patch } : node)),
      };
    });
    setWorkflowDirty(true);
    setWorkflowSaveError(null);
    setWorkflowSaveMessage(null);
  }, []);

  const renameWorkflowNodeId = useCallback((nodeId: string, nextIdRaw: string) => {
    const nextId = nextIdRaw.trim();
    setWorkflow((cur) => {
      if (!cur) return cur;
      return {
        ...cur,
        nodes: cur.nodes.map((node) => (node.id === nodeId ? { ...node, id: nextId } : node)),
        edges: cur.edges.map((edge) => ({
          ...edge,
          source: edge.source === nodeId ? nextId : edge.source,
          target: edge.target === nodeId ? nextId : edge.target,
        })),
      };
    });
    setExpandedNode(nextId || nodeId);
    setWorkflowDirty(true);
    setWorkflowSaveError(null);
    setWorkflowSaveMessage(null);
  }, []);

  const addWorkflowNode = useCallback((kind: WorkflowNodeKind) => {
    const cur = workflow;
    const id = nextUniqueId(kind === "tool" ? "tool-step" : "step", new Set(cur?.nodes.map((node) => node.id) ?? []));
    const previous = cur?.nodes.at(-1);
    const nextNode: WorkflowNode = {
      id,
      label: kind === "tool" ? "Tool Step" : "New Step",
      prompt: kind === "tool" ? "" : "{{task}}",
      model: "",
      kind,
      ...(kind === "tool" ? { inputPath: "{{input.file}}", outputDir: "output", timeoutMs: 60000 } : {}),
    };
    const edgeIds = new Set(cur?.edges.map((edge) => edge.id) ?? []);
    const nextEdges = previous
      ? [...(cur?.edges ?? []), { id: makeEdgeId(previous.id, id, edgeIds), source: previous.id, target: id }]
      : cur?.edges ?? [];
    setWorkflow({
      version: cur?.version ?? 1,
      defaultModel: cur?.defaultModel ?? "",
      ...cur,
      nodes: [...(cur?.nodes ?? []), nextNode],
      edges: nextEdges,
    });
    setExpandedNode(id);
    setWorkflowDirty(true);
    setWorkflowSaveError(null);
    setWorkflowSaveMessage(null);
  }, [workflow]);

  const deleteWorkflowNode = useCallback((nodeId: string) => {
    setWorkflow((cur) => {
      if (!cur) return cur;
      return {
        ...cur,
        nodes: cur.nodes.filter((node) => node.id !== nodeId),
        edges: cur.edges.filter((edge) => edge.source !== nodeId && edge.target !== nodeId),
      };
    });
    setExpandedNode((cur) => (cur === nodeId ? null : cur));
    setWorkflowDirty(true);
    setWorkflowSaveError(null);
    setWorkflowSaveMessage(null);
  }, []);

  const updateWorkflowEdge = useCallback((edgeId: string, patch: Partial<WorkflowDef["edges"][number]>) => {
    setWorkflow((cur) => {
      if (!cur) return cur;
      return { ...cur, edges: cur.edges.map((edge) => (edge.id === edgeId ? { ...edge, ...patch } : edge)) };
    });
    setWorkflowDirty(true);
    setWorkflowSaveError(null);
    setWorkflowSaveMessage(null);
  }, []);

  const addWorkflowEdge = useCallback((source: string, target: string) => {
    if (!source || !target) return;
    setWorkflow((cur) => {
      if (!cur) return cur;
      return { ...cur, edges: [...cur.edges, { id: makeEdgeId(source, target, new Set(cur.edges.map((edge) => edge.id))), source, target }] };
    });
    setWorkflowDirty(true);
    setWorkflowSaveError(null);
    setWorkflowSaveMessage(null);
  }, []);

  const deleteWorkflowEdge = useCallback((edgeId: string) => {
    setWorkflow((cur) => cur ? { ...cur, edges: cur.edges.filter((edge) => edge.id !== edgeId) } : cur);
    setWorkflowDirty(true);
    setWorkflowSaveError(null);
    setWorkflowSaveMessage(null);
  }, []);

  const applyToolTemplateToNode = useCallback((nodeId: string, tool: ExtractionTool) => {
    updateWorkflowNode(nodeId, {
      kind: "tool",
      toolId: tool.id,
      label: tool.name || tool.id,
      inputPath: "{{input.file}}",
      outputDir: "output",
      timeoutMs: 60000,
    });
  }, [updateWorkflowNode]);

  const handleSaveWorkflow = useCallback(async () => {
    if (!flowId || !workflow || savingWorkflow) return;
    const firstError = validateWorkflowEditor(workflow).find((issue) => issue.level === "error");
    if (firstError) {
      setWorkflowSaveError(firstError.message);
      return;
    }
    setSavingWorkflow(true);
    setWorkflowSaveError(null);
    setWorkflowSaveMessage(null);
    try {
      await api.flowWorkflowPut(flowId, workflow);
      setWorkflowDirty(false);
      setWorkflowSaveMessage("已保存 workflow.json");
    } catch (err) {
      setWorkflowSaveError(err instanceof Error ? err.message : String(err));
    } finally {
      setSavingWorkflow(false);
    }
  }, [flowId, workflow, savingWorkflow]);

  // ---- execute actions ----
  const handleRun = useCallback(() => {
    if (!flowId || !workflow || running) return;
    const firstError = validateWorkflowEditor(workflow).find((issue) => issue.level === "error");
    if (firstError) {
      setLogs((cur) => [...cur, `✖ workflow 无法运行：${firstError.message}`]);
      return;
    }
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
  const openRunOutputFile = useCallback((path: string) => {
    setRequestedOutputFile({ path, nonce: Date.now() });
  }, []);
  const workflowIssues = useMemo(() => validateWorkflowEditor(workflow), [workflow]);
  const workflowHasErrors = workflowIssues.some((issue) => issue.level === "error");
  const issueByNodeId = useMemo(() => {
    const out = new Map<string, WorkflowIssue[]>();
    for (const issue of workflowIssues) {
      if (!issue.nodeId) continue;
      out.set(issue.nodeId, [...(out.get(issue.nodeId) ?? []), issue]);
    }
    return out;
  }, [workflowIssues]);

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
                    disabled={!workflow || workflowHasErrors}
                    className={cn(
                      "flex w-full items-center justify-center gap-1.5 rounded-md h-8 text-[12.5px] font-medium transition-colors",
                      !workflow || workflowHasErrors
                        ? "bg-neutral-100 text-neutral-400 cursor-not-allowed dark:bg-neutral-800 dark:text-neutral-600"
                        : "bg-sky-500 text-white hover:bg-sky-600 dark:bg-sky-600 dark:hover:bg-sky-700",
                    )}
                    title={workflowHasErrors ? workflowIssues.find((issue) => issue.level === "error")?.message : undefined}
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
                {centerTab === "flow" && (
                  <div className="ml-auto flex items-center gap-2">
                    <button
                      onClick={() => setShowDagEditor(true)}
                      disabled={!workflow}
                      title="打开图形化 DAG 编辑器"
                      className="inline-flex h-6 items-center gap-1 rounded-md border border-sky-200 px-2 text-[10.5px] font-medium text-sky-600 hover:bg-sky-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-sky-800 dark:text-sky-400 dark:hover:bg-sky-950/30"
                    >
                      <GitBranch className="h-3 w-3" strokeWidth={1.75} />
                      DAG 视图
                    </button>
                    <button
                      onClick={() => addWorkflowNode("agent")}
                      disabled={running}
                      className="inline-flex h-6 items-center gap-1 rounded-md border border-neutral-200 px-2 text-[10.5px] font-medium text-neutral-600 hover:bg-neutral-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800/50"
                    >
                      <Plus className="h-3 w-3" strokeWidth={1.75} />
                      agent
                    </button>
                    <button
                      onClick={() => addWorkflowNode("tool")}
                      disabled={running}
                      className="inline-flex h-6 items-center gap-1 rounded-md border border-emerald-200 px-2 text-[10.5px] font-medium text-emerald-700 hover:bg-emerald-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-emerald-800 dark:text-emerald-300 dark:hover:bg-emerald-950/30"
                    >
                      <Wrench className="h-3 w-3" strokeWidth={1.75} />
                      tool
                    </button>
                    {(workflowDirty || savingWorkflow || workflowSaveMessage || workflowSaveError) && (
                      <span
                        className={cn(
                          "max-w-[220px] truncate text-[10px]",
                          workflowSaveError ? "text-rose-500" : workflowDirty ? "text-amber-600" : "text-emerald-600",
                        )}
                        title={workflowSaveError ?? workflowSaveMessage ?? "有未保存改动"}
                      >
                        {workflowSaveError ?? (savingWorkflow ? "保存中…" : workflowDirty ? "未保存" : workflowSaveMessage)}
                      </span>
                    )}
                    <button
                      onClick={() => void handleSaveWorkflow()}
                      disabled={!workflowDirty || savingWorkflow || running || workflowHasErrors}
                      className={cn(
                        "inline-flex h-6 items-center gap-1 rounded-md px-2 text-[10.5px] font-medium",
                        !workflowDirty || savingWorkflow || running || workflowHasErrors
                          ? "cursor-not-allowed bg-neutral-100 text-neutral-400 dark:bg-neutral-800 dark:text-neutral-600"
                          : "bg-neutral-900 text-white hover:bg-neutral-700 dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-white",
                      )}
                      title={workflowHasErrors ? workflowIssues.find((issue) => issue.level === "error")?.message : undefined}
                    >
                      {savingWorkflow ? <Loader2 className="h-3 w-3 animate-spin" strokeWidth={1.75} /> : <Save className="h-3 w-3" strokeWidth={1.75} />}
                      保存
                    </button>
                    {orderedNodes.length > 0 && (
                      <>
                        <span className="text-[10px] tabular-nums text-neutral-400">
                          {doneCount}/{orderedNodes.length}
                        </span>
                        <div className="h-1 w-20 overflow-hidden rounded-full bg-neutral-200 dark:bg-neutral-700">
                          <div
                            className={cn("h-full rounded-full transition-all", running ? "bg-amber-400" : "bg-emerald-500")}
                            style={{ width: `${(doneCount / orderedNodes.length) * 100}%` }}
                          />
                        </div>
                      </>
                    )}
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
                        const refs = upstreamRefs(`${node.prompt ?? ""}\n${node.inputPath ?? ""}\n${node.outputDir ?? ""}`, nodeIdSet);
                        const isExpanded = expandedNode === node.id;
                        const isActive = activeNodeId === node.id;
                        const color = colorForNode(node, idx);
                        const kind = normalizedNodeKind(node);
                        const selectedTool = tools.find((tool) => tool.id === node.toolId) ?? null;
                        const toolOutput = kind === "tool" && state?.output ? parseToolStepOutput(state.output) : null;
                        const nodeIssues = issueByNodeId.get(node.id) ?? [];
                        const hasNodeError = nodeIssues.some((issue) => issue.level === "error");
                        return (
                          <div
                            key={node.id}
                            className={cn(
                              "rounded-md border",
                              hasNodeError
                                ? "border-rose-300 dark:border-rose-800"
                                : isActive
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
                              {hasNodeError && (
                                <AlertCircle className="h-3.5 w-3.5 shrink-0 text-rose-500" strokeWidth={1.75} />
                              )}
                              <span
                                className={cn(
                                  "inline-flex shrink-0 items-center gap-1 rounded-full px-1.5 py-0.5 text-[9px] font-medium",
                                  kind === "tool"
                                    ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300"
                                    : kind === "gate"
                                      ? "bg-amber-50 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300"
                                      : "bg-neutral-100 text-neutral-500 dark:bg-neutral-800 dark:text-neutral-400",
                                )}
                              >
                                {kind === "tool" && <Wrench className="h-2.5 w-2.5" strokeWidth={1.75} />}
                                {nodeKindLabel(kind)}
                              </span>
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
                              <div className="flex flex-col gap-3 border-t border-neutral-100 px-3 py-2 dark:border-neutral-800">
                                <div className="grid gap-2 md:grid-cols-2">
                                  <label className="flex flex-col gap-1">
                                    <span className="text-[10px] font-medium text-neutral-500">node id</span>
                                    <input
                                      value={node.id}
                                      disabled={running}
                                      onChange={(e) => renameWorkflowNodeId(node.id, e.target.value)}
                                      className="h-8 rounded-md border border-neutral-200 bg-transparent px-2 font-mono text-[11px] text-neutral-900 outline-none focus:border-neutral-400 disabled:opacity-50 dark:border-neutral-700 dark:text-neutral-100 dark:focus:border-neutral-500"
                                    />
                                  </label>
                                  <label className="flex flex-col gap-1">
                                    <span className="text-[10px] font-medium text-neutral-500">节点类型</span>
                                    <select
                                      value={kind}
                                      disabled={running}
                                      onChange={(e) => updateWorkflowNode(node.id, { kind: e.target.value as WorkflowNodeKind })}
                                      className="h-8 rounded-md border border-neutral-200 bg-transparent px-2 text-[12px] text-neutral-900 outline-none focus:border-neutral-400 disabled:opacity-50 dark:border-neutral-700 dark:text-neutral-100 dark:focus:border-neutral-500"
                                    >
                                      <option value="agent">agent</option>
                                      <option value="gate">gate</option>
                                      <option value="tool">tool</option>
                                    </select>
                                  </label>
                                  <label className="flex flex-col gap-1">
                                    <span className="text-[10px] font-medium text-neutral-500">节点名称</span>
                                    <input
                                      value={node.label}
                                      disabled={running}
                                      onChange={(e) => updateWorkflowNode(node.id, { label: e.target.value })}
                                      className="h-8 rounded-md border border-neutral-200 bg-transparent px-2 text-[12px] text-neutral-900 outline-none focus:border-neutral-400 disabled:opacity-50 dark:border-neutral-700 dark:text-neutral-100 dark:focus:border-neutral-500"
                                    />
                                  </label>
                                  <label className="flex flex-col gap-1">
                                    <span className="text-[10px] font-medium text-neutral-500">model</span>
                                    <input
                                      value={node.model ?? ""}
                                      disabled={running}
                                      onChange={(e) => updateWorkflowNode(node.id, { model: e.target.value })}
                                      placeholder="留空继承默认模型"
                                      className="h-8 rounded-md border border-neutral-200 bg-transparent px-2 font-mono text-[11px] text-neutral-900 outline-none focus:border-neutral-400 disabled:opacity-50 dark:border-neutral-700 dark:text-neutral-100 dark:focus:border-neutral-500"
                                    />
                                  </label>
                                  <label className="flex flex-col gap-1 md:col-span-2">
                                    <span className="text-[10px] font-medium text-neutral-500">inputs</span>
                                    <input
                                      value={(node.inputs ?? []).join(", ")}
                                      disabled={running}
                                      onChange={(e) => updateWorkflowNode(node.id, {
                                        inputs: e.target.value.split(",").map((item) => item.trim()).filter(Boolean),
                                      })}
                                      placeholder="可选，逗号分隔上游 node id；留空则按 edges"
                                      className="h-8 rounded-md border border-neutral-200 bg-transparent px-2 font-mono text-[11px] text-neutral-900 outline-none focus:border-neutral-400 disabled:opacity-50 dark:border-neutral-700 dark:text-neutral-100 dark:focus:border-neutral-500"
                                    />
                                  </label>
                                  {kind !== "tool" && (
                                    <label className="flex flex-col gap-1 md:col-span-2">
                                      <span className="text-[10px] font-medium text-neutral-500">prompt</span>
                                      <textarea
                                        value={node.prompt ?? ""}
                                        disabled={running}
                                        onChange={(e) => updateWorkflowNode(node.id, { prompt: e.target.value })}
                                        className="min-h-24 resize-y rounded-md border border-neutral-200 bg-transparent px-2 py-1.5 font-mono text-[11px] leading-4 text-neutral-900 outline-none focus:border-neutral-400 disabled:opacity-50 dark:border-neutral-700 dark:text-neutral-100 dark:focus:border-neutral-500"
                                      />
                                    </label>
                                  )}
                                </div>
                                <div className="flex flex-col gap-1.5 rounded-md border border-neutral-100 bg-neutral-50/60 p-2 dark:border-neutral-800 dark:bg-neutral-900/30">
                                  <div className="flex items-center gap-2">
                                    <span className="text-[10px] font-medium text-neutral-500">edges</span>
                                    <button
                                      onClick={() => {
                                        const target = orderedNodes.find((candidate) => candidate.id !== node.id)?.id;
                                        if (target) addWorkflowEdge(node.id, target);
                                      }}
                                      disabled={running || orderedNodes.length < 2}
                                      className="ml-auto inline-flex h-6 items-center gap-1 rounded border border-neutral-200 bg-white px-1.5 text-[10px] text-neutral-600 hover:bg-neutral-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-neutral-700 dark:bg-neutral-950 dark:text-neutral-300 dark:hover:bg-neutral-900"
                                    >
                                      <Plus className="h-3 w-3" strokeWidth={1.75} />
                                      edge
                                    </button>
                                  </div>
                                  {(workflow?.edges.filter((edge) => edge.source === node.id || edge.target === node.id) ?? []).length === 0 ? (
                                    <p className="text-[10.5px] text-neutral-400">无关联 edge</p>
                                  ) : (
                                    workflow?.edges.filter((edge) => edge.source === node.id || edge.target === node.id).map((edge) => (
                                      <div key={edge.id} className="grid grid-cols-[1fr_1fr_auto] gap-1">
                                        <select
                                          value={edge.source}
                                          disabled={running}
                                          onChange={(e) => updateWorkflowEdge(edge.id, { source: e.target.value })}
                                          className="h-7 min-w-0 rounded border border-neutral-200 bg-white px-1.5 font-mono text-[10.5px] text-neutral-900 outline-none disabled:opacity-50 dark:border-neutral-700 dark:bg-neutral-950 dark:text-neutral-100"
                                        >
                                          {orderedNodes.map((candidate) => (
                                            <option key={candidate.id} value={candidate.id}>{candidate.id}</option>
                                          ))}
                                        </select>
                                        <select
                                          value={edge.target}
                                          disabled={running}
                                          onChange={(e) => updateWorkflowEdge(edge.id, { target: e.target.value })}
                                          className="h-7 min-w-0 rounded border border-neutral-200 bg-white px-1.5 font-mono text-[10.5px] text-neutral-900 outline-none disabled:opacity-50 dark:border-neutral-700 dark:bg-neutral-950 dark:text-neutral-100"
                                        >
                                          {orderedNodes.map((candidate) => (
                                            <option key={candidate.id} value={candidate.id}>{candidate.id}</option>
                                          ))}
                                        </select>
                                        <button
                                          onClick={() => deleteWorkflowEdge(edge.id)}
                                          disabled={running}
                                          className="flex h-7 w-7 items-center justify-center rounded border border-neutral-200 bg-white text-neutral-400 hover:text-rose-500 disabled:cursor-not-allowed disabled:opacity-50 dark:border-neutral-700 dark:bg-neutral-950"
                                          title="删除 edge"
                                        >
                                          <Trash2 className="h-3.5 w-3.5" strokeWidth={1.75} />
                                        </button>
                                      </div>
                                    ))
                                  )}
                                </div>
                                {nodeIssues.length > 0 && (
                                  <div className="flex flex-col gap-1">
                                    {nodeIssues.map((issue) => (
                                      <div
                                        key={issue.message}
                                        className={cn(
                                          "flex items-center gap-1 text-[10.5px]",
                                          issue.level === "error" ? "text-rose-600 dark:text-rose-300" : "text-amber-700 dark:text-amber-300",
                                        )}
                                      >
                                        <AlertCircle className="h-3 w-3 shrink-0" strokeWidth={1.75} />
                                        {issue.message}
                                      </div>
                                    ))}
                                  </div>
                                )}
                                {kind === "tool" && (
                                  <div className="grid gap-2 rounded-md border border-emerald-100 bg-emerald-50/40 p-2 dark:border-emerald-900/40 dark:bg-emerald-950/20 md:grid-cols-2">
                                    <label className="flex flex-col gap-1">
                                      <span className="text-[10px] font-medium text-emerald-700 dark:text-emerald-300">toolId</span>
                                      <select
                                        value={node.toolId ?? ""}
                                        disabled={running || loadingTools}
                                        onChange={(e) => updateWorkflowNode(node.id, { toolId: e.target.value })}
                                        className="h-8 rounded-md border border-emerald-200 bg-white px-2 text-[12px] text-neutral-900 outline-none focus:border-emerald-400 disabled:opacity-50 dark:border-emerald-800 dark:bg-neutral-950 dark:text-neutral-100"
                                      >
                                        <option value="">{loadingTools ? "加载工具中…" : "选择 registered tool"}</option>
                                        {tools.map((tool) => (
                                          <option key={tool.id} value={tool.id}>{tool.id}</option>
                                        ))}
                                      </select>
                                    </label>
                                    <label className="flex flex-col gap-1">
                                      <span className="text-[10px] font-medium text-emerald-700 dark:text-emerald-300">timeoutMs</span>
                                      <input
                                        type="number"
                                        min={1}
                                        value={node.timeoutMs ?? ""}
                                        disabled={running}
                                        onChange={(e) => updateWorkflowNode(node.id, { timeoutMs: e.target.value ? Number(e.target.value) : undefined })}
                                        placeholder="60000"
                                        className="h-8 rounded-md border border-emerald-200 bg-white px-2 text-[12px] text-neutral-900 outline-none focus:border-emerald-400 disabled:opacity-50 dark:border-emerald-800 dark:bg-neutral-950 dark:text-neutral-100"
                                      />
                                    </label>
                                    <label className="flex flex-col gap-1 md:col-span-2">
                                      <span className="text-[10px] font-medium text-emerald-700 dark:text-emerald-300">inputPath</span>
                                      <input
                                        value={node.inputPath ?? ""}
                                        disabled={running}
                                        onChange={(e) => updateWorkflowNode(node.id, { inputPath: e.target.value })}
                                        placeholder="{{input.file}} 或上游节点产出的路径"
                                        className="h-8 rounded-md border border-emerald-200 bg-white px-2 font-mono text-[11px] text-neutral-900 outline-none focus:border-emerald-400 disabled:opacity-50 dark:border-emerald-800 dark:bg-neutral-950 dark:text-neutral-100"
                                      />
                                    </label>
                                    <label className="flex flex-col gap-1 md:col-span-2">
                                      <span className="text-[10px] font-medium text-emerald-700 dark:text-emerald-300">outputDir</span>
                                      <input
                                        value={node.outputDir ?? ""}
                                        disabled={running}
                                        onChange={(e) => updateWorkflowNode(node.id, { outputDir: e.target.value || undefined })}
                                        placeholder="留空则写入当前 node run directory"
                                        className="h-8 rounded-md border border-emerald-200 bg-white px-2 font-mono text-[11px] text-neutral-900 outline-none focus:border-emerald-400 disabled:opacity-50 dark:border-emerald-800 dark:bg-neutral-950 dark:text-neutral-100"
                                      />
                                    </label>
                                    {selectedTool && (
                                      <div className="flex items-center gap-2 md:col-span-2">
                                        <div className="min-w-0 flex-1 truncate text-[10.5px] leading-4 text-emerald-700 dark:text-emerald-300">
                                          {selectedTool.name} · input {selectedTool.input.modes.join("/")} · accept {selectedTool.input.accept.join(", ")} · output {selectedTool.output.join(", ")}
                                        </div>
                                        <button
                                          onClick={() => applyToolTemplateToNode(node.id, selectedTool)}
                                          disabled={running}
                                          className="inline-flex h-6 shrink-0 items-center gap-1 rounded border border-emerald-200 bg-white px-1.5 text-[10px] font-medium text-emerald-700 hover:bg-emerald-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-emerald-800 dark:bg-neutral-950 dark:text-emerald-300 dark:hover:bg-emerald-950/30"
                                        >
                                          <Copy className="h-3 w-3" strokeWidth={1.75} />
                                          套用
                                        </button>
                                      </div>
                                    )}
                                    {(!node.toolId || !node.inputPath) && (
                                      <div className="flex items-center gap-1 md:col-span-2 text-[10.5px] text-amber-700 dark:text-amber-300">
                                        <AlertCircle className="h-3 w-3 shrink-0" strokeWidth={1.75} />
                                        tool node 运行前需要保存有效的 toolId 和 inputPath。
                                      </div>
                                    )}
                                  </div>
                                )}
                                <div className="flex justify-end">
                                  <button
                                    onClick={() => {
                                      if (window.confirm(`删除节点 ${node.id}？关联 edges 会同时删除。`)) deleteWorkflowNode(node.id);
                                    }}
                                    disabled={running}
                                    className="inline-flex h-7 items-center gap-1 rounded-md border border-rose-200 px-2 text-[10.5px] font-medium text-rose-600 hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-rose-900/60 dark:text-rose-300 dark:hover:bg-rose-950/30"
                                  >
                                    <Trash2 className="h-3 w-3" strokeWidth={1.75} />
                                    删除节点
                                  </button>
                                </div>
                                {toolOutput && (
                                  <div className="rounded-md border border-emerald-100 bg-emerald-50/40 p-2 dark:border-emerald-900/40 dark:bg-emerald-950/20">
                                    <div className="flex items-center gap-2">
                                      <Wrench className="h-3.5 w-3.5 shrink-0 text-emerald-600 dark:text-emerald-300" strokeWidth={1.75} />
                                      <span className="min-w-0 flex-1 truncate text-[11px] font-medium text-emerald-700 dark:text-emerald-300">
                                        {toolOutput.toolId} · {toolOutput.success ? "success" : "failed"}
                                      </span>
                                      {(() => {
                                        const summaryPath = toRunRelativePath(currentOutputDir, toolOutput.summaryPath);
                                        return summaryPath ? (
                                          <button
                                            onClick={() => openRunOutputFile(summaryPath)}
                                            className="shrink-0 rounded border border-emerald-200 px-1.5 py-0.5 font-mono text-[10px] text-emerald-700 hover:bg-emerald-100 dark:border-emerald-800 dark:text-emerald-300 dark:hover:bg-emerald-950/50"
                                          >
                                            summary.json
                                          </button>
                                        ) : null;
                                      })()}
                                    </div>
                                    {toolOutput.artifacts.length > 0 ? (
                                      <div className="mt-2 flex flex-wrap gap-1">
                                        {toolOutput.artifacts.map((artifact) => {
                                          const outputDir = toRunRelativePath(currentOutputDir, toolOutput.outputPath);
                                          const path = outputDir ? `${outputDir.replace(/\/+$/, "")}/${artifact}` : artifact;
                                          return (
                                            <button
                                              key={artifact}
                                              onClick={() => openRunOutputFile(path)}
                                              className="max-w-full truncate rounded border border-emerald-200 bg-white px-1.5 py-0.5 font-mono text-[10px] text-emerald-700 hover:bg-emerald-50 dark:border-emerald-800 dark:bg-neutral-950 dark:text-emerald-300 dark:hover:bg-emerald-950/30"
                                              title={path}
                                            >
                                              {artifact}
                                            </button>
                                          );
                                        })}
                                      </div>
                                    ) : (
                                      <p className="mt-1 text-[10.5px] text-emerald-700/70 dark:text-emerald-300/70">
                                        tool 未记录产物文件
                                      </p>
                                    )}
                                  </div>
                                )}
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
              requestedFile={requestedOutputFile}
            />
          </div>
        )}
      </div>

      {/* ---- DAG editor overlay ---- */}
      {showDagEditor && workflow && (
        <WorkflowDagEditor
          workflow={workflow}
          models={p.models}
          tools={tools}
          flowName={p.flow?.name ?? ""}
          running={running}
          onWorkflowChange={(wf) => {
            setWorkflow(wf);
            setWorkflowDirty(true);
            setWorkflowSaveError(null);
            setWorkflowSaveMessage(null);
          }}
          onClose={() => setShowDagEditor(false)}
        />
      )}
    </div>
  );
}
