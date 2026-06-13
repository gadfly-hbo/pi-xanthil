import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowRight,
  AlertCircle,
  GitBranch,
  CheckCircle2,
  Loader2,
  MessageSquare,
  Plus,
  Save,
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
import { cn } from "@/lib/cn";
import type { ExtractionTool, Flow, PiModel, WorkflowDef, WorkflowNode } from "@/types";
import type { CenterTab, EditableWorkflowDef, EditableWorkflowNode, WorkflowIssue, WorkflowNodeKind } from "@/components/multi-agent/types";
import { RunControlPanel } from "@/components/multi-agent/RunControlPanel";
import { ToolNodeConfig } from "@/components/multi-agent/ToolNodeConfig";
import { useMultiAgentRun } from "@/components/multi-agent/useMultiAgentRun";
import {
  gateMaxIterations,
  makeEdgeId,
  nextUniqueId,
  nodeKindLabel,
  nodesBeforeGate,
  normalizedNodeKind,
  parseToolStepOutput,
  toRunRelativePath,
  upstreamRefs,
  validateWorkflowEditor,
} from "@/components/multi-agent/workflow-utils";

interface Props {
  flow: Flow | null;
  models: PiModel[];
  model: string;
  onModelChange: (m: string) => void;
  refreshKey?: number;
  rulesPromptEnabled: boolean;
}

type View = "chat" | "execute";

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

export function MultiAgentExecutionPane(p: Props) {
  const flowId = p.flow?.id ?? "";
  const [view, setView] = useState<View>("chat");
  const [workflowRefreshKey, setWorkflowRefreshKey] = useState(0);
  const [workflow, setWorkflow] = useState<EditableWorkflowDef | null>(null);
  const [loading, setLoading] = useState(true);
  const [workflowDirty, setWorkflowDirty] = useState(false);
  const [savingWorkflow, setSavingWorkflow] = useState(false);
  const [workflowSaveError, setWorkflowSaveError] = useState<string | null>(null);
  const [workflowSaveMessage, setWorkflowSaveMessage] = useState<string | null>(null);
  const [tools, setTools] = useState<ExtractionTool[]>([]);
  const [loadingTools, setLoadingTools] = useState(false);

  const [centerTab, setCenterTab] = useState<CenterTab>("flow");
  const [expandedNode, setExpandedNode] = useState<string | null>(null);
  const [showDagEditor, setShowDagEditor] = useState(false);
  const {
    taskText,
    setTaskText,
    runId,
    running,
    activeNodeId,
    stepStates,
    gateIterations,
    logs,
    runs,
    requestedOutputFile,
    currentOutputDir,
    handleRun,
    handleAbortRun,
    openRunOutputFile,
  } = useMultiAgentRun({
    flow: p.flow,
    workflow,
    model: p.model,
    rulesPromptEnabled: p.rulesPromptEnabled,
  });

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

  // ---- Load workflow.json on flow change / refresh ----
  useEffect(() => {
    if (!flowId) return;
    let cancelled = false;
    setLoading(true);
    api.flowWorkflowGet(flowId).then((r) => {
      if (cancelled) return;
      setWorkflow(r.workflow as EditableWorkflowDef);
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

  // ---- apply to editor ----
  const applyToEditor = useCallback(() => {
    setView("execute");
    setWorkflowRefreshKey((k) => k + 1);
  }, []);

  const updateWorkflowNode = useCallback((nodeId: string, patch: Partial<EditableWorkflowNode>) => {
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
        nodes: cur.nodes.map((node) => {
          if (node.id === nodeId) return { ...node, id: nextId };
          if (node.onBlock?.retryFromNodeId === nodeId) {
            return { ...node, onBlock: { ...node.onBlock, retryFromNodeId: nextId } };
          }
          return node;
        }),
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
        nodes: cur.nodes
          .filter((node) => node.id !== nodeId)
          .map((node) => node.onBlock?.retryFromNodeId === nodeId ? { ...node, onBlock: undefined } : node),
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
      await api.flowWorkflowPut(flowId, workflow as WorkflowDef);
      setWorkflowDirty(false);
      setWorkflowSaveMessage("已保存 workflow.json");
    } catch (err) {
      setWorkflowSaveError(err instanceof Error ? err.message : String(err));
    } finally {
      setSavingWorkflow(false);
    }
  }, [flowId, workflow, savingWorkflow]);

  const orderedNodes = useMemo(() => workflow?.nodes ?? [], [workflow]);
  const nodeIdSet = useMemo(() => new Set(orderedNodes.map((n) => n.id)), [orderedNodes]);
  const doneCount = useMemo(
    () => orderedNodes.filter((n) => stepStates[n.id]?.status === "done").length,
    [orderedNodes, stepStates],
  );
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
            <RunControlPanel
              width={leftWidth}
              runId={runId}
              running={running}
              taskText={taskText}
              currentOutputDir={currentOutputDir}
              workflowReady={Boolean(workflow)}
              workflowHasErrors={workflowHasErrors}
              workflowIssues={workflowIssues}
              onTaskTextChange={setTaskText}
              onRun={handleRun}
              onAbort={handleAbortRun}
              onResizeStart={onLeftDragStart}
            />

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
                        const gateRetryCandidates = kind === "gate" ? nodesBeforeGate(workflow, node.id) : [];
                        const gateIteration = kind === "gate" && node.onBlock
                          ? gateIterations[node.id] ?? (running ? 1 : 0)
                          : 0;
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
                              {kind === "gate" && node.onBlock && (
                                <span
                                  className="shrink-0 rounded-full bg-amber-50 px-1.5 py-0.5 font-mono text-[9px] font-medium text-amber-700 dark:bg-amber-900/30 dark:text-amber-300"
                                  title={`blocked 回跳到 ${node.onBlock.retryFromNodeId}`}
                                >
                                  iter {gateIteration}/{gateMaxIterations(node)}
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
                                      onChange={(e) => {
                                        const nextKind = e.target.value as WorkflowNodeKind;
                                        updateWorkflowNode(node.id, nextKind === "gate" ? { kind: nextKind } : { kind: nextKind, onBlock: undefined });
                                      }}
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
                                {kind === "gate" && (
                                  <div className="grid gap-2 rounded-md border border-amber-100 bg-amber-50/40 p-2 dark:border-amber-900/40 dark:bg-amber-950/20 md:grid-cols-2">
                                    <label className="flex items-center gap-2 md:col-span-2">
                                      <input
                                        type="checkbox"
                                        checked={Boolean(node.onBlock)}
                                        disabled={running || gateRetryCandidates.length === 0}
                                        onChange={(e) => {
                                          if (!e.target.checked) {
                                            updateWorkflowNode(node.id, { onBlock: undefined });
                                            return;
                                          }
                                          const fallback = gateRetryCandidates.at(-1)?.id;
                                          if (fallback) updateWorkflowNode(node.id, { onBlock: { retryFromNodeId: fallback, maxIterations: 3 } });
                                        }}
                                        className="h-3.5 w-3.5"
                                      />
                                      <span className="text-[10.5px] font-medium text-amber-800 dark:text-amber-200">blocked 时回跳重试</span>
                                      {node.onBlock && (
                                        <span className="ml-auto font-mono text-[10px] text-amber-700 dark:text-amber-300">
                                          iter {gateIteration}/{gateMaxIterations(node)}
                                        </span>
                                      )}
                                    </label>
                                    {gateRetryCandidates.length === 0 && (
                                      <p className="text-[10.5px] text-amber-700/70 dark:text-amber-300/70 md:col-span-2">
                                        当前 gate 前没有可回跳节点。
                                      </p>
                                    )}
                                    {node.onBlock && (
                                      <>
                                        <label className="flex flex-col gap-1">
                                          <span className="text-[10px] font-medium text-amber-700 dark:text-amber-300">retryFromNodeId</span>
                                          <select
                                            value={node.onBlock.retryFromNodeId}
                                            disabled={running}
                                            onChange={(e) => updateWorkflowNode(node.id, { onBlock: { ...node.onBlock!, retryFromNodeId: e.target.value } })}
                                            className="h-8 rounded-md border border-amber-200 bg-white px-2 font-mono text-[11px] text-neutral-900 outline-none focus:border-amber-400 disabled:opacity-50 dark:border-amber-800 dark:bg-neutral-950 dark:text-neutral-100"
                                          >
                                            {gateRetryCandidates.map((candidate) => (
                                              <option key={candidate.id} value={candidate.id}>{candidate.id}</option>
                                            ))}
                                          </select>
                                        </label>
                                        <label className="flex flex-col gap-1">
                                          <span className="text-[10px] font-medium text-amber-700 dark:text-amber-300">maxIterations</span>
                                          <input
                                            type="number"
                                            min={1}
                                            step={1}
                                            value={node.onBlock.maxIterations ?? ""}
                                            disabled={running}
                                            placeholder="3"
                                            onChange={(e) => updateWorkflowNode(node.id, {
                                              onBlock: {
                                                ...node.onBlock!,
                                                maxIterations: e.target.value ? Number(e.target.value) : undefined,
                                              },
                                            })}
                                            className="h-8 rounded-md border border-amber-200 bg-white px-2 text-[12px] text-neutral-900 outline-none focus:border-amber-400 disabled:opacity-50 dark:border-amber-800 dark:bg-neutral-950 dark:text-neutral-100"
                                          />
                                        </label>
                                        <label className="flex flex-col gap-1 md:col-span-2">
                                          <span className="text-[10px] font-medium text-amber-700 dark:text-amber-300">feedbackVar</span>
                                          <input
                                            value={node.onBlock.feedbackVar ?? ""}
                                            disabled={running}
                                            placeholder={`${node.id}__feedback`}
                                            onChange={(e) => updateWorkflowNode(node.id, {
                                              onBlock: {
                                                ...node.onBlock!,
                                                feedbackVar: e.target.value.trim() || undefined,
                                              },
                                            })}
                                            className="h-8 rounded-md border border-amber-200 bg-white px-2 font-mono text-[11px] text-neutral-900 outline-none focus:border-amber-400 disabled:opacity-50 dark:border-amber-800 dark:bg-neutral-950 dark:text-neutral-100"
                                          />
                                        </label>
                                      </>
                                    )}
                                  </div>
                                )}
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
                                  <ToolNodeConfig
                                    node={node}
                                    tools={tools}
                                    loadingTools={loadingTools}
                                    running={running}
                                    selectedTool={selectedTool}
                                    onNodeChange={updateWorkflowNode}
                                    onApplyTemplate={applyToolTemplateToNode}
                                  />
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
            setWorkflow(wf as EditableWorkflowDef);
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
