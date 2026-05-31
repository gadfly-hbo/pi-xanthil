import { useEffect, useMemo, useRef, useState } from "react";
import {
  ReactFlow,
  ReactFlowProvider,
  Handle,
  Position,
  type Node,
  type Edge,
  type NodeProps,
  Background,
  Controls,
  MiniMap,
} from "@xyflow/react";
import {
  Bot,
  Loader2,
  Play,
  Workflow,
  CheckCircle2,
  XCircle,
  FileText,
  Folder,
  ChevronRight,
  Eye,
} from "lucide-react";
import { Placeholder } from "@/components/Placeholder";
import { api } from "@/lib/api";
import { gateway } from "@/lib/ws";
import { cn } from "@/lib/cn";
import type {
  Flow,
  FlowRun,
  FlowTreeNode,
  PiEvent,
  PiModel,
  ServerMessage,
  WorkflowDef,
  WorkflowNode,
} from "@/types";

interface Props {
  flow: Flow | null;
  models: PiModel[];
  model: string;
  onModelChange: (m: string) => void;
  refreshKey?: number;
}

type AgentNodeData = {
  label: string;
  description: string;
  model: string;
};

function nodeDescription(n: WorkflowNode): string {
  if (!n.prompt) return "";
  const first = n.prompt.split("\n").find((l) => l.trim().length > 0) ?? "";
  return first.length > 40 ? first.slice(0, 40) + "\u2026" : first;
}

function toFlowNodes(nodes: WorkflowNode[]): Node[] {
  return nodes.map((n, i) => ({
    id: n.id,
    type: "agent",
    position: n.position ?? { x: 80 + (i % 4) * 220, y: 60 + Math.floor(i / 4) * 140 },
    data: {
      label: n.label,
      description: nodeDescription(n),
      model: n.model,
    } satisfies AgentNodeData,
  }));
}

function toFlowEdges(edges: WorkflowDef["edges"]): Edge[] {
  return edges.map((e) => ({
    id: e.id,
    source: e.source,
    target: e.target,
    type: "smoothstep",
    animated: true,
  }));
}

function AgentNodeCard({ data }: NodeProps) {
  const d = data as unknown as AgentNodeData;
  return (
    <div className="min-w-[140px] max-w-[200px] rounded-lg border border-neutral-200 bg-white px-3 py-2 shadow-sm dark:border-neutral-700 dark:bg-neutral-900">
      <Handle type="target" position={Position.Top} className="!h-1.5 !w-1.5 !bg-neutral-300 !border-none" />
      <div className="flex items-center gap-1.5">
        <Bot className="h-3 w-3 text-neutral-500 dark:text-neutral-400" strokeWidth={1.75} />
        <span className="truncate text-[11.5px] font-medium text-neutral-800 dark:text-neutral-200">
          {d.label}
        </span>
      </div>
      {d.description && (
        <p className="mt-1 line-clamp-1 text-[10px] leading-3.5 text-neutral-400 dark:text-neutral-500">
          {d.description}
        </p>
      )}
      {d.model && (
        <span className="mt-1 inline-block rounded-full bg-sky-50 px-1.5 py-px font-mono text-[8.5px] text-sky-600 dark:bg-sky-900/30 dark:text-sky-300">
          {d.model.split("/").pop()}
        </span>
      )}
      <Handle type="source" position={Position.Bottom} className="!h-1.5 !w-1.5 !bg-neutral-300 !border-none" />
    </div>
  );
}

const nodeTypes = { agent: AgentNodeCard };

function extractTextFromEvents(content: unknown[]): string {
  return content
    .filter(
      (b): b is { type: "text"; text: string } =>
        typeof b === "object" && b !== null && (b as { type?: string }).type === "text",
    )
    .map((b) => b.text)
    .join("\n");
}

function flattenFiles(node: FlowTreeNode): FlowTreeNode[] {
  const out: FlowTreeNode[] = [];
  const walk = (n: FlowTreeNode) => {
    if (n.kind === "file") out.push(n);
    for (const c of n.children ?? []) walk(c);
  };
  walk(node);
  return out;
}

function RunTreeView({ node, onPick }: { node: FlowTreeNode; onPick: (path: string) => void }) {
  return (
    <div className="text-xs">
      {(node.children ?? []).map((c) => (
        <RunTreeNode key={c.path} node={c} depth={0} onPick={onPick} />
      ))}
    </div>
  );
}

function RunTreeNode({ node, depth, onPick }: { node: FlowTreeNode; depth: number; onPick: (path: string) => void }) {
  const [open, setOpen] = useState(depth < 1);
  const pad = { paddingLeft: `${8 + depth * 12}px` };
  if (node.kind === "file") {
    return (
      <button onClick={() => onPick(node.path)} style={pad} className="flex w-full items-center gap-1 rounded py-1 text-left hover:bg-neutral-100 dark:hover:bg-neutral-800">
        <FileText className="h-3.5 w-3.5 shrink-0 text-neutral-500" strokeWidth={1.75} />
        <span className="truncate">{node.name}</span>
      </button>
    );
  }
  return (
    <div>
      <button onClick={() => setOpen((v) => !v)} style={pad} className="flex w-full items-center gap-1 rounded py-1 text-left hover:bg-neutral-100 dark:hover:bg-neutral-800">
        <ChevronRight className={cn("h-3.5 w-3.5 shrink-0 text-neutral-500 transition-transform", open && "rotate-90")} strokeWidth={1.75} />
        <Folder className="h-3.5 w-3.5 shrink-0 text-neutral-500" strokeWidth={1.75} />
        <span className="truncate">{node.name}</span>
      </button>
      {open && (node.children ?? []).map((c) => <RunTreeNode key={c.path} node={c} depth={depth + 1} onPick={onPick} />)}
    </div>
  );
}

function FlowWorkflowPaneInner(p: Props) {
  const [workflow, setWorkflow] = useState<WorkflowDef | null>(null);
  const [inferred, setInferred] = useState(false);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [events, setEvents] = useState<PiEvent[]>([]);
  const [runs, setRuns] = useState<FlowRun[]>([]);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [runTree, setRunTree] = useState<FlowTreeNode | null>(null);
  const [selectedFilePath, setSelectedFilePath] = useState<string | null>(null);
  const [fileContent, setFileContent] = useState<string>("");

  const runIdRef = useRef<string | null>(null);
  const flowId = p.flow?.id ?? "";

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api.flowWorkflowGet(flowId).then((r) => {
      if (cancelled) return;
      setWorkflow(r.workflow);
      setInferred(!!r.inferred);
      setLoading(false);
    });
    return () => { cancelled = true; };
  }, [flowId, p.refreshKey]);

  useEffect(() => {
    if (!flowId) return;
    api.listFlowRuns(flowId).then(setRuns).catch(() => setRuns([]));
  }, [flowId]);

  useEffect(() => {
    return gateway.subscribe((msg: ServerMessage) => {
      if (msg.type === "run_start" && msg.flowId === flowId && msg.runId) {
        runIdRef.current = msg.runId;
        setSelectedRunId(msg.runId);
        setEvents([]);
        setRunning(true);
      } else if (msg.type === "flow_run_event" && msg.flowId === flowId && msg.runId === runIdRef.current) {
        setEvents((cur) => [...cur, msg.event]);
      } else if (msg.type === "run_end" && msg.flowId === flowId && msg.runId) {
        setRunning(false);
        api.listFlowRuns(flowId).then(setRuns).catch(() => undefined);
        void loadRunTree(msg.runId);
      }
    });
  }, [flowId]);

  const flowNodes = useMemo(() => {
    if (!workflow) return [];
    return toFlowNodes(workflow.nodes);
  }, [workflow]);

  const flowEdges = useMemo(() => {
    if (!workflow) return [];
    return toFlowEdges(workflow.edges);
  }, [workflow]);

  const renderedOutput = useMemo(() => {
    const text = events
      .filter((e) => e.type === "message_end")
      .map((e) => extractTextFromEvents((e as Extract<PiEvent, { type: "message_end" }>).message.content))
      .filter(Boolean)
      .join("\n\n");
    return text || null;
  }, [events]);

  async function loadRunTree(id: string): Promise<void> {
    setSelectedRunId(id);
    setSelectedFilePath(null);
    setFileContent("");
    const tree = await api.flowRunTree(flowId, id);
    setRunTree(tree);
    const files = flattenFiles(tree);
    if (files[0]) {
      setSelectedFilePath(files[0].path);
      const f = await api.flowRunFileGet(flowId, id, files[0].path);
      setFileContent(f.content);
    }
  }

  async function pickFile(path: string): Promise<void> {
    if (!selectedRunId) return;
    setSelectedFilePath(path);
    const f = await api.flowRunFileGet(flowId, selectedRunId, path);
    setFileContent(f.content);
  }

  function startRun() {
    const id = crypto.randomUUID();
    gateway.send({ type: "execute_flow", flowId, runId: id, text: "run", model: p.model || undefined });
  }

  if (!p.flow) return <Placeholder icon={Workflow} title="\u5de5\u4f5c\u6d41" hint="\u5148\u5728\u5de6\u4fa7\u9009\u62e9\u4e00\u4e2a\u5de5\u4f5c\u6d41" />;

  if (loading) {
    return (
      <div className="flex flex-1 items-center justify-center text-[13px] text-neutral-400 dark:text-neutral-500">
        \u52a0\u8f7d\u5de5\u4f5c\u6d41\u2026
      </div>
    );
  }

  if (!workflow || workflow.nodes.length === 0) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 text-neutral-400 dark:text-neutral-500">
        <Workflow className="h-10 w-10" strokeWidth={1.5} />
        <div className="text-[13px]">\u6682\u65e0\u5de5\u4f5c\u6d41\u8282\u70b9</div>
        <div className="text-[12px]">\u5728\u300cpi \u5bf9\u8bdd\u300d\u4e2d\u8ba9 ai \u751f\u6210\u5de5\u4f5c\u6d41</div>
      </div>
    );
  }

  const hasOutput = runTree || renderedOutput;

  return (
    <div className="flex min-h-0 flex-1">
      {/* Left: workflow canvas (read-only preview) */}
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex h-9 shrink-0 items-center gap-2 border-b border-neutral-200 px-3 dark:border-neutral-800">
          <Eye className="h-3.5 w-3.5 text-neutral-400" strokeWidth={1.75} />
          <span className="text-[12px] text-neutral-500 dark:text-neutral-400">\u9884\u89c8\u6a21\u5f0f \u00b7 \u5728\u300cpi \u5bf9\u8bdd\u300d\u4e2d\u7f16\u8f91</span>
          {inferred && (
            <span className="rounded-full bg-amber-50 px-2 py-px font-mono text-[9px] text-amber-700 dark:bg-amber-900/30 dark:text-amber-300">
              \u81ea\u52a8\u63a8\u65ad
            </span>
          )}
          <span className="ml-auto text-[11px] text-neutral-400">{workflow.nodes.length} \u8282\u70b9</span>
        </div>
        <div className="flex-1">
          <ReactFlow
            nodes={flowNodes}
            edges={flowEdges}
            nodeTypes={nodeTypes}
            nodesDraggable={false}
            nodesConnectable={false}
            elementsSelectable={false}
            fitView
            proOptions={{ hideAttribution: true }}
          >
            <Background gap={16} size={1} />
            <Controls showInteractive={false} />
            <MiniMap
              nodeStrokeWidth={3}
              pannable
              zoomable
              className="!rounded-lg !border !border-neutral-200 !shadow-sm dark:!border-neutral-700"
            />
          </ReactFlow>
        </div>
        <div className="flex shrink-0 items-center gap-3 border-t border-neutral-200 bg-white/90 px-3 py-1.5 backdrop-blur dark:border-neutral-800 dark:bg-neutral-950/90">
          <select
            value={p.model}
            onChange={(e) => p.onModelChange(e.target.value)}
            className="h-7 rounded-md border border-neutral-300 bg-transparent px-2 text-[11px] dark:border-neutral-700"
          >
            {p.models.map((m) => (
              <option key={m.id} value={m.id}>{m.id}</option>
            ))}
          </select>
          <button
            onClick={startRun}
            disabled={running}
            className={cn(
              "inline-flex h-7 items-center gap-1.5 rounded-md px-3 text-[11px]",
              running
                ? "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300"
                : "bg-neutral-900 text-white hover:bg-neutral-700 dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-white",
            )}
          >
            {running ? <Loader2 className="h-3 w-3 animate-spin" strokeWidth={1.75} /> : <Play className="h-3 w-3" strokeWidth={1.75} />}
            {running ? "\u8fd0\u884c\u4e2d\u2026" : "\u8fd0\u884c"}
          </button>
          {running && (
            <span className="inline-flex items-center gap-1 text-[10px] text-amber-600 dark:text-amber-400">
              <Loader2 className="h-3 w-3 animate-spin" strokeWidth={1.75} />
              \u6267\u884c\u4e2d
            </span>
          )}
          {!running && runs.length > 0 && (
            <span className="text-[10px] text-neutral-400">{runs.length} \u6b21\u8fd0\u884c</span>
          )}
        </div>
      </div>

      {/* Right: output preview */}
      <aside className="flex w-[360px] shrink-0 flex-col border-l border-neutral-200 bg-white/80 dark:border-neutral-800 dark:bg-neutral-950/60">
        <div className="flex h-9 shrink-0 items-center gap-2 border-b border-neutral-200 px-3 dark:border-neutral-800">
          <FileText className="h-3.5 w-3.5 text-neutral-500" strokeWidth={1.75} />
          <span className="text-[12px] font-medium text-neutral-900 dark:text-neutral-100">\u4ea7\u51fa\u9884\u89c8</span>
          {selectedRunId && (
            <span className="ml-auto font-mono text-[10px] text-neutral-400">{selectedRunId.slice(0, 8)}</span>
          )}
        </div>

        {!hasOutput && !running && runs.length === 0 && (
          <div className="flex flex-1 flex-col items-center justify-center gap-2 text-neutral-400 dark:text-neutral-500">
            <FileText className="h-8 w-8" strokeWidth={1.25} />
            <div className="text-[12px]">\u8fd0\u884c\u540e\u5728\u6b64\u67e5\u770b\u4ea7\u51fa</div>
          </div>
        )}

        <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto">
          {renderedOutput && (
            <div className="border-b border-neutral-100 p-3 dark:border-neutral-800">
              <div className="mb-1.5 text-[10px] font-medium uppercase tracking-wide text-neutral-400 dark:text-neutral-500">\u5b9e\u65f6\u8f93\u51fa</div>
              <pre className="max-h-[200px] overflow-auto rounded-md border border-neutral-200 bg-neutral-50 p-2.5 text-[11px] leading-5 text-neutral-800 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-200">
                {renderedOutput}
              </pre>
            </div>
          )}

          {runs.length > 0 && (
            <div className="border-b border-neutral-100 p-3 dark:border-neutral-800">
              <div className="mb-1.5 text-[10px] font-medium uppercase tracking-wide text-neutral-400 dark:text-neutral-500">\u8fd0\u884c\u5386\u53f2</div>
              <div className="space-y-0.5">
                {runs.map((r) => (
                  <button
                    key={r.id}
                    onClick={() => void loadRunTree(r.id)}
                    className={cn(
                      "flex w-full items-center gap-2 rounded-md px-2 py-1 text-left text-[11px] hover:bg-neutral-100 dark:hover:bg-neutral-800",
                      selectedRunId === r.id && "bg-neutral-100 dark:bg-neutral-800",
                    )}
                  >
                    {r.status === "success" ? <CheckCircle2 className="h-3 w-3 shrink-0 text-emerald-500" /> : r.status === "failed" ? <XCircle className="h-3 w-3 shrink-0 text-rose-500" /> : <Loader2 className="h-3 w-3 shrink-0" />}
                    <span className="truncate">{r.id.slice(0, 8)} \u00b7 {new Date(r.startedAt).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {runTree && (
            <div className="p-3">
              <div className="mb-1.5 text-[10px] font-medium uppercase tracking-wide text-neutral-400 dark:text-neutral-500">\u4ea7\u51fa\u76ee\u5f55</div>
              <div className="max-h-[200px] overflow-auto rounded-md border border-neutral-200 bg-neutral-50 p-2 dark:border-neutral-700 dark:bg-neutral-900">
                <RunTreeView node={runTree} onPick={(path) => void pickFile(path)} />
              </div>
              {selectedFilePath && (
                <div className="mt-2">
                  <div className="mb-1 text-[10px] text-neutral-500">{selectedFilePath}</div>
                  <pre className="max-h-[300px] overflow-auto rounded-md border border-neutral-200 bg-neutral-50 p-2.5 text-[11px] leading-5 dark:border-neutral-700 dark:bg-neutral-900">{fileContent}</pre>
                </div>
              )}
            </div>
          )}
        </div>
      </aside>
    </div>
  );
}

export function FlowWorkflowPane(p: Props) {
  return (
    <ReactFlowProvider>
      <FlowWorkflowPaneInner {...p} />
    </ReactFlowProvider>
  );
}
