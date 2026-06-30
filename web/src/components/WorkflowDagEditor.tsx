import { useCallback, useMemo, useRef, useState } from "react";
import {
  ReactFlow,
  Background,
  BackgroundVariant,
  Controls,
  Handle,
  MarkerType,
  Position,
  addEdge,
  useEdgesState,
  useNodesState,
  type Connection,
  type Edge,
  type EdgeChange,
  type Node,
  type NodeChange,
  type NodeProps,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { Shield, Trash2, Wrench, X } from "lucide-react";
import { cn } from "@/lib/cn";
import type { ExtractionTool, PiModel, WorkflowDef, WorkflowNode } from "@/types";

// ---- types ----
type NodeKind = NonNullable<WorkflowNode["kind"]>;

function isAiExposedTool(tool: ExtractionTool): boolean {
  return tool.category === "analysis";
}

interface GateOnBlock {
  retryFromNodeId: string;
  maxIterations?: number;
  feedbackVar?: string;
}

type EditableWorkflowNode = WorkflowNode & { onBlock?: GateOnBlock };
type EditableWorkflowDef = Omit<WorkflowDef, "nodes"> & { nodes: EditableWorkflowNode[] };

interface DagNodeData extends Record<string, unknown> {
  label: string;
  kind: NodeKind;
  role?: string;
}

type RFNode = Node<DagNodeData>;

// ---- layout constants ----
const NODE_W = 180;
const NODE_H = 72;
const COL_GAP = 260;
const ROW_GAP = 110;

// ---- helpers ----
function kindColor(kind: NodeKind): string {
  if (kind === "gate") return "#f59e0b";
  if (kind === "tool") return "#10b981";
  return "#6366f1";
}

function autoLayout(
  nodes: WorkflowNode[],
  edges: WorkflowDef["edges"],
): Map<string, { x: number; y: number }> {
  if (nodes.length === 0) return new Map();
  const inDegree = new Map(nodes.map((n) => [n.id, 0]));
  const adj = new Map(nodes.map((n) => [n.id, [] as string[]]));
  for (const e of edges) {
    adj.get(e.source)?.push(e.target);
    inDegree.set(e.target, (inDegree.get(e.target) ?? 0) + 1);
  }
  const queue = nodes.filter((n) => !inDegree.get(n.id)).map((n) => n.id);
  const level = new Map(queue.map((id) => [id, 0]));
  for (let i = 0; i < queue.length; i++) {
    const cur = queue[i]!;
    for (const next of adj.get(cur) ?? []) {
      const nl = (level.get(cur) ?? 0) + 1;
      if ((level.get(next) ?? -1) < nl) level.set(next, nl);
      if (!queue.includes(next)) queue.push(next);
    }
  }
  const byLevel = new Map<number, string[]>();
  for (const [id, lv] of level) byLevel.set(lv, [...(byLevel.get(lv) ?? []), id]);
  // Linear chains (all levels have 1 node, 4+ levels) get vertical layout to avoid
  // extreme aspect ratio that makes fitView zoom out too much.
  const isLinearChain = byLevel.size >= 4 && [...byLevel.values()].every((ids) => ids.length === 1);
  const pos = new Map<string, { x: number; y: number }>();
  for (const [lv, ids] of byLevel) {
    if (isLinearChain) {
      ids.forEach((id) => pos.set(id, { x: 0, y: lv * ROW_GAP }));
    } else {
      const offset = -((ids.length - 1) * ROW_GAP) / 2;
      ids.forEach((id, idx) => pos.set(id, { x: lv * COL_GAP, y: offset + idx * ROW_GAP }));
    }
  }
  nodes.forEach((n, i) => {
    if (!pos.has(n.id)) pos.set(n.id, { x: 0, y: i * ROW_GAP });
  });
  return pos;
}

function initRFNodes(wf: WorkflowDef): RFNode[] {
  const needsLayout = wf.nodes.some((n) => !n.position);
  const positions = needsLayout
    ? autoLayout(wf.nodes, wf.edges)
    : new Map(wf.nodes.map((n) => [n.id, n.position!]));
  return wf.nodes.map((n) => ({
    id: n.id,
    type: "workflowNode",
    position: positions.get(n.id) ?? { x: 0, y: 0 },
    width: NODE_W,
    height: NODE_H,
    data: { label: n.label, kind: n.kind ?? "agent", role: n.role },
  }));
}

function initRFEdges(wf: WorkflowDef): Edge[] {
  const arrowColor = "#94a3b8";
  return wf.edges.map((e) => ({
    id: e.id,
    source: e.source,
    target: e.target,
    type: "smoothstep",
    style: { stroke: arrowColor, strokeWidth: 1.5 },
    markerEnd: { type: MarkerType.ArrowClosed, color: arrowColor },
  }));
}

function topoOrder(workflow: EditableWorkflowDef): EditableWorkflowNode[] {
  const idToNode = new Map(workflow.nodes.map((n) => [n.id, n] as const));
  const indeg = new Map<string, number>(workflow.nodes.map((n) => [n.id, 0]));
  const fwd = new Map<string, string[]>(workflow.nodes.map((n) => [n.id, []]));
  for (const e of workflow.edges) {
    if (!idToNode.has(e.source) || !idToNode.has(e.target)) continue;
    indeg.set(e.target, (indeg.get(e.target) ?? 0) + 1);
    fwd.get(e.source)!.push(e.target);
  }
  const queue: string[] = [];
  for (const n of workflow.nodes) if ((indeg.get(n.id) ?? 0) === 0) queue.push(n.id);
  const out: EditableWorkflowNode[] = [];
  const seen = new Set<string>();
  while (queue.length > 0) {
    const id = queue.shift()!;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(idToNode.get(id)!);
    for (const nxt of fwd.get(id) ?? []) {
      indeg.set(nxt, (indeg.get(nxt) ?? 1) - 1);
      if ((indeg.get(nxt) ?? 0) <= 0) queue.push(nxt);
    }
  }
  for (const n of workflow.nodes) if (!seen.has(n.id)) out.push(n);
  return out;
}

function nodesBeforeGate(workflow: EditableWorkflowDef, gateId: string): EditableWorkflowNode[] {
  const ordered = topoOrder(workflow);
  const gateIndex = ordered.findIndex((n) => n.id === gateId);
  return gateIndex > 0 ? ordered.slice(0, gateIndex) : [];
}

// ---- custom ReactFlow node ----
function WorkflowNodeCard({ data, selected }: NodeProps<RFNode>) {
  const kind = data.kind as NodeKind;
  const color = kindColor(kind);
  return (
    <div
      className="flex h-[72px] w-[180px] flex-col justify-center rounded-xl border-2 bg-white px-3 shadow-sm dark:bg-neutral-900"
      style={{ borderColor: selected ? color : `${color}44` }}
    >
      <Handle
        type="target"
        position={Position.Left}
        className="!h-3 !w-3 !rounded-full !border-2 !bg-white dark:!bg-neutral-900"
        style={{ borderColor: color }}
      />
      <div className="flex items-center gap-2">
        <span
          className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full"
          style={{ backgroundColor: color }}
        >
          {kind === "tool" ? (
            <Wrench className="h-3 w-3 text-white" strokeWidth={2.5} />
          ) : kind === "gate" ? (
            <Shield className="h-3 w-3 text-white" strokeWidth={2.5} />
          ) : (
            <span className="text-[9px] font-bold text-white">A</span>
          )}
        </span>
        <span className="min-w-0 flex-1 truncate text-[12px] font-medium text-neutral-800 dark:text-neutral-100">
          {data.label as string}
        </span>
      </div>
      {data.role && (
        <p className="mt-0.5 truncate pl-7 text-[9px]" style={{ color }}>
          {data.role as string}
        </p>
      )}
      <Handle
        type="source"
        position={Position.Right}
        className="!h-3 !w-3 !rounded-full !border-2 !bg-white dark:!bg-neutral-900"
        style={{ borderColor: color }}
      />
    </div>
  );
}

const nodeTypes = { workflowNode: WorkflowNodeCard };

// ---- main component ----
interface WorkflowDagEditorProps {
  workflow: WorkflowDef;
  models: PiModel[];
  tools: ExtractionTool[];
  flowName: string;
  running: boolean;
  onWorkflowChange: (wf: WorkflowDef) => void;
  onClose: () => void;
}

export function WorkflowDagEditor(p: WorkflowDagEditorProps) {
  const wfRef = useRef<EditableWorkflowDef>(p.workflow as EditableWorkflowDef);
  const [localWf, setLocalWf] = useState<EditableWorkflowDef>(p.workflow as EditableWorkflowDef);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);

  // Initialized once on mount — intentionally not re-derived from prop updates
  const initialNodes = useMemo(() => initRFNodes(p.workflow), []); // eslint-disable-line react-hooks/exhaustive-deps
  const initialEdges = useMemo(() => initRFEdges(p.workflow), []); // eslint-disable-line react-hooks/exhaustive-deps

  const [rfNodes, setRfNodes, onRfNodesChange] = useNodesState<RFNode>(initialNodes);
  const [rfEdges, setRfEdges, onRfEdgesChange] = useEdgesState<Edge>(initialEdges);

  const applyWfChange = useCallback(
    (updater: (wf: EditableWorkflowDef) => EditableWorkflowDef) => {
      setLocalWf((cur) => {
        const next = updater(cur);
        wfRef.current = next;
        p.onWorkflowChange(next as WorkflowDef);
        return next;
      });
    },
    [p.onWorkflowChange],
  );

  const onConnect = useCallback(
    (conn: Connection) => {
      const newEdge: Edge = {
        id: `${conn.source}-${conn.target}-${Date.now()}`,
        source: conn.source!,
        target: conn.target!,
        type: "smoothstep",
        style: { stroke: "#94a3b8", strokeWidth: 1.5 },
        markerEnd: { type: MarkerType.ArrowClosed, color: "#94a3b8" },
      };
      setRfEdges((eds) => addEdge(newEdge, eds));
      applyWfChange((wf) => ({
        ...wf,
        edges: [...wf.edges, { id: newEdge.id, source: conn.source!, target: conn.target! }],
      }));
    },
    [setRfEdges, applyWfChange],
  );

  const onNodesChange = useCallback(
    (changes: NodeChange[]) => {
      onRfNodesChange(changes as NodeChange<RFNode>[]);
      const removed = new Set(
        changes
          .filter((c): c is NodeChange & { type: "remove"; id: string } => c.type === "remove")
          .map((c) => c.id),
      );
      if (removed.size > 0) {
        applyWfChange((wf) => ({
          ...wf,
          nodes: wf.nodes
            .filter((n) => !removed.has(n.id))
            .map((n) => n.onBlock && removed.has(n.onBlock.retryFromNodeId) ? { ...n, onBlock: undefined } : n),
          edges: wf.edges.filter((e) => !removed.has(e.source) && !removed.has(e.target)),
        }));
        setRfEdges((eds) => eds.filter((e) => !removed.has(e.source) && !removed.has(e.target)));
        setSelectedNodeId((id) => (id && removed.has(id) ? null : id));
      }
    },
    [onRfNodesChange, applyWfChange, setRfEdges],
  );

  const onEdgesChange = useCallback(
    (changes: EdgeChange[]) => {
      onRfEdgesChange(changes);
      const removed = new Set(
        changes
          .filter((c): c is EdgeChange & { type: "remove"; id: string } => c.type === "remove")
          .map((c) => c.id),
      );
      if (removed.size > 0) {
        applyWfChange((wf) => ({
          ...wf,
          edges: wf.edges.filter((e) => !removed.has(e.id)),
        }));
      }
    },
    [onRfEdgesChange, applyWfChange],
  );

  const onNodeDragStop = useCallback(
    (_: unknown, node: RFNode) => {
      applyWfChange((wf) => ({
        ...wf,
        nodes: wf.nodes.map((n) => (n.id === node.id ? { ...n, position: node.position } : n)),
      }));
    },
    [applyWfChange],
  );

  const onNodeClick = useCallback((_: unknown, node: RFNode) => {
    setSelectedNodeId((cur) => (cur === node.id ? null : node.id));
  }, []);

  const onPaneClick = useCallback(() => {
    setSelectedNodeId(null);
  }, []);

  const updateNodeProp = useCallback(
    (nodeId: string, patch: Partial<EditableWorkflowNode>) => {
      applyWfChange((wf) => ({
        ...wf,
        nodes: wf.nodes.map((n) => (n.id === nodeId ? { ...n, ...patch } : n)),
      }));
      if (patch.label !== undefined || patch.kind !== undefined || patch.role !== undefined) {
        setRfNodes((rns) =>
          rns.map((rn) =>
            rn.id === nodeId
              ? {
                  ...rn,
                  data: {
                    ...rn.data,
                    ...(patch.label !== undefined && { label: patch.label }),
                    ...(patch.kind !== undefined && { kind: patch.kind as NodeKind }),
                    ...(patch.role !== undefined && { role: patch.role }),
                  },
                }
              : rn,
          ),
        );
      }
    },
    [applyWfChange, setRfNodes],
  );

  const deleteNode = useCallback(
    (nodeId: string) => {
      setRfNodes((rns) => rns.filter((rn) => rn.id !== nodeId));
      setRfEdges((eds) => eds.filter((e) => e.source !== nodeId && e.target !== nodeId));
      applyWfChange((wf) => ({
        ...wf,
        nodes: wf.nodes
          .filter((n) => n.id !== nodeId)
          .map((n) => n.onBlock?.retryFromNodeId === nodeId ? { ...n, onBlock: undefined } : n),
        edges: wf.edges.filter((e) => e.source !== nodeId && e.target !== nodeId),
      }));
      setSelectedNodeId((id) => (id === nodeId ? null : id));
    },
    [setRfNodes, setRfEdges, applyWfChange],
  );

  const selectedNode = localWf.nodes.find((n) => n.id === selectedNodeId) ?? null;
  const retryCandidates = selectedNode?.kind === "gate" ? nodesBeforeGate(localWf, selectedNode.id) : [];

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-neutral-50 dark:bg-neutral-950">
      {/* header */}
      <div className="flex h-12 shrink-0 items-center gap-3 border-b border-neutral-200 bg-white px-4 dark:border-neutral-800 dark:bg-neutral-900">
        <span className="text-sm font-semibold text-neutral-800 dark:text-neutral-100">
          DAG 编辑器
        </span>
        <span className="truncate text-xs text-neutral-400">{p.flowName}</span>
        <span className="tabular-nums text-[11px] text-neutral-400">
          {localWf.nodes.length} 节点 · {localWf.edges.length} 边
        </span>
        <span className="ml-auto hidden text-[11px] text-neutral-400 lg:block">
          从右端点拖出连线 · 选中后按 Delete 删除 · 拖拽调整布局
        </span>
        <button
          onClick={p.onClose}
          className="ml-2 flex h-7 items-center gap-1 rounded-md px-2.5 text-xs text-neutral-500 hover:bg-neutral-100 hover:text-neutral-900 dark:hover:bg-neutral-800 dark:hover:text-neutral-100"
        >
          <X className="h-3.5 w-3.5" strokeWidth={2} />
          关闭
        </button>
      </div>

      {/* body */}
      <div className="flex min-h-0 flex-1">
        {/* ReactFlow canvas */}
        <div className="min-h-0 flex-1">
          <ReactFlow
            nodes={rfNodes}
            edges={rfEdges}
            nodeTypes={nodeTypes}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onNodeClick={onNodeClick}
            onNodeDragStop={onNodeDragStop}
            onPaneClick={onPaneClick}
            fitView
            fitViewOptions={{ padding: 0.3 }}
            deleteKeyCode="Delete"
            style={{ width: "100%", height: "100%" }}
          >
            <Background variant={BackgroundVariant.Dots} gap={24} size={1} color="#e2e8f0" />
            <Controls showInteractive={false} />
          </ReactFlow>
        </div>

        {/* right panel */}
        <aside className="w-[300px] shrink-0 overflow-y-auto border-l border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
          {selectedNode ? (
            <NodePropertyPanel
              node={selectedNode}
              retryCandidates={retryCandidates}
              models={p.models}
              tools={p.tools}
              running={p.running}
              onChange={(patch) => updateNodeProp(selectedNode.id, patch)}
              onDelete={() => deleteNode(selectedNode.id)}
            />
          ) : (
            <div className="flex h-full flex-col items-center justify-center gap-3 py-12 text-center">
              <p className="text-xs text-neutral-400">点击节点查看和编辑属性</p>
              <div className="mt-2 space-y-1.5 text-[11px] leading-5 text-neutral-300 dark:text-neutral-600">
                <p>连线：从节点右侧端点拖向目标</p>
                <p>删除节点/边：选中后按 Delete</p>
                <p>布局：拖拽节点自由调整位置</p>
              </div>
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}

// ---- node property panel ----
interface NodePropertyPanelProps {
  node: EditableWorkflowNode;
  retryCandidates: EditableWorkflowNode[];
  models: PiModel[];
  tools: ExtractionTool[];
  running: boolean;
  onChange: (patch: Partial<EditableWorkflowNode>) => void;
  onDelete: () => void;
}

function NodePropertyPanel({ node, retryCandidates, models, tools, running, onChange, onDelete }: NodePropertyPanelProps) {
  const kind = node.kind ?? "agent";
  const color = kindColor(kind);
  const onBlockEnabled = kind === "gate" && Boolean(node.onBlock);
  const onBlock = node.onBlock;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <span
          className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full"
          style={{ backgroundColor: color }}
        >
          {kind === "tool" ? (
            <Wrench className="h-3.5 w-3.5 text-white" strokeWidth={2.5} />
          ) : kind === "gate" ? (
            <Shield className="h-3.5 w-3.5 text-white" strokeWidth={2.5} />
          ) : (
            <span className="text-[10px] font-bold text-white">A</span>
          )}
        </span>
        <span className="min-w-0 flex-1 truncate text-sm font-semibold text-neutral-800 dark:text-neutral-100">
          {node.label}
        </span>
        <button
          onClick={onDelete}
          disabled={running}
          className="flex h-6 shrink-0 items-center gap-1 rounded-md px-2 text-[11px] text-rose-500 hover:bg-rose-50 disabled:opacity-40 dark:hover:bg-rose-950/30"
        >
          <Trash2 className="h-3 w-3" strokeWidth={2} />
          删除
        </button>
      </div>

      <PropField label="节点名称">
        <input
          value={node.label}
          disabled={running}
          onChange={(e) => onChange({ label: e.target.value })}
          className={fieldInputCls}
        />
      </PropField>

      <div className="grid grid-cols-2 gap-2">
        <PropField label="类型">
          <select
            value={kind}
            disabled={running}
            onChange={(e) => {
              const nextKind = e.target.value as NodeKind;
              onChange(nextKind === "gate" ? { kind: nextKind } : { kind: nextKind, onBlock: undefined });
            }}
            className={fieldInputCls}
          >
            <option value="agent">agent</option>
            <option value="gate">gate</option>
            <option value="tool">tool</option>
          </select>
        </PropField>
        <PropField label="模型">
          <select
            value={node.model ?? ""}
            disabled={running}
            onChange={(e) => onChange({ model: e.target.value })}
            className={fieldInputCls}
          >
            <option value="">流程默认</option>
            {models.map((m) => (
              <option key={m.id} value={m.id}>{m.id}</option>
            ))}
          </select>
        </PropField>
      </div>

      {kind === "tool" ? (
        <>
          <PropField label="Tool ID">
            <select
              value={node.toolId ?? ""}
              disabled={running}
              onChange={(e) => {
                const t = tools.filter(isAiExposedTool).find((tool) => tool.id === e.target.value);
                onChange(
                  t
                    ? { toolId: t.id, label: t.name || t.id, inputPath: "{{input.file}}", outputDir: "output", timeoutMs: 60000 }
                    : { toolId: e.target.value },
                );
              }}
              className={fieldInputCls}
            >
              <option value="">— 选择 tool —</option>
              {tools.filter(isAiExposedTool).map((t) => (
                <option key={t.id} value={t.id}>{t.name || t.id}{t.tags?.length ? ` · ${t.tags.join(",")}` : ""}</option>
              ))}
            </select>
          </PropField>
          <PropField label="输入路径">
            <input
              value={node.inputPath ?? ""}
              disabled={running}
              placeholder="{{input.file}}"
              onChange={(e) => onChange({ inputPath: e.target.value })}
              className={cn(fieldInputCls, "font-mono")}
            />
          </PropField>
          <PropField label="输出目录">
            <input
              value={node.outputDir ?? ""}
              disabled={running}
              placeholder="output"
              onChange={(e) => onChange({ outputDir: e.target.value })}
              className={cn(fieldInputCls, "font-mono")}
            />
          </PropField>
        </>
      ) : (
        <PropField label="Prompt">
          <textarea
            value={node.prompt ?? ""}
            disabled={running}
            rows={7}
            placeholder="支持 {{task}} / {{node_id}} 占位符"
            onChange={(e) => onChange({ prompt: e.target.value })}
            className={cn(fieldInputCls, "resize-y")}
          />
        </PropField>
      )}

      {kind === "gate" && (
        <div className="rounded-md border border-amber-100 bg-amber-50/40 p-2 dark:border-amber-900/40 dark:bg-amber-950/20">
          <label className="flex items-center gap-2 text-[11px] font-medium text-amber-800 dark:text-amber-200">
            <input
              type="checkbox"
              checked={onBlockEnabled}
              disabled={running || retryCandidates.length === 0}
              onChange={(e) => {
                if (!e.target.checked) {
                  onChange({ onBlock: undefined });
                  return;
                }
                const fallback = retryCandidates.at(-1)?.id;
                if (fallback) onChange({ onBlock: { retryFromNodeId: fallback, maxIterations: 3 } });
              }}
              className="h-3.5 w-3.5"
            />
            blocked 时回跳重试
          </label>
          {retryCandidates.length === 0 && (
            <p className="mt-1 text-[10px] text-amber-700/70 dark:text-amber-300/70">
              当前 gate 前没有可回跳节点。
            </p>
          )}
          {onBlockEnabled && onBlock && (
            <div className="mt-2 grid gap-2">
              <PropField label="retryFromNodeId">
                <select
                  value={onBlock.retryFromNodeId}
                  disabled={running}
                  onChange={(e) => onChange({ onBlock: { ...onBlock, retryFromNodeId: e.target.value } })}
                  className={cn(fieldInputCls, "font-mono")}
                >
                  {retryCandidates.map((candidate) => (
                    <option key={candidate.id} value={candidate.id}>{candidate.id}</option>
                  ))}
                </select>
              </PropField>
              <PropField label="maxIterations">
                <input
                  type="number"
                  min={1}
                  step={1}
                  value={onBlock.maxIterations ?? ""}
                  disabled={running}
                  placeholder="3"
                  onChange={(e) => onChange({
                    onBlock: {
                      ...onBlock,
                      maxIterations: e.target.value ? Number(e.target.value) : undefined,
                    },
                  })}
                  className={fieldInputCls}
                />
              </PropField>
              <PropField label="feedbackVar">
                <input
                  value={onBlock.feedbackVar ?? ""}
                  disabled={running}
                  placeholder={`${node.id}__feedback`}
                  onChange={(e) => onChange({
                    onBlock: {
                      ...onBlock,
                      feedbackVar: e.target.value.trim() || undefined,
                    },
                  })}
                  className={cn(fieldInputCls, "font-mono")}
                />
              </PropField>
            </div>
          )}
        </div>
      )}

      <p className="text-[10px] leading-4 text-neutral-400">
        role / icon / skillPaths 等高级字段请在「表单视图」编辑。
      </p>
    </div>
  );
}

function PropField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[10px] font-medium text-neutral-500">{label}</span>
      {children}
    </label>
  );
}

const fieldInputCls =
  "w-full rounded-md border border-neutral-200 bg-transparent px-2 py-1.5 text-xs text-neutral-900 outline-none focus:border-neutral-400 disabled:opacity-50 dark:border-neutral-700 dark:text-neutral-100 dark:focus:border-neutral-500";
