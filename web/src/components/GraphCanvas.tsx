import React, { useCallback, useEffect, useMemo } from "react";
import {
  ReactFlow,
  Background,
  BackgroundVariant,
  Controls,
  Handle,
  Position,
  useEdgesState,
  useNodesState,
  type Connection,
  type Edge,
  type Node,
  type NodeProps,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { cn } from "@/lib/cn";

/**
 * GraphCanvas —— 通用力导向图渲染层（详见 docs/onto-xanthil-design.md §3 R1）。
 * 从 KnowledgeGraphPane 抽出的纯展示组件：聚类布局 + 自定义节点 + 连边 + 搜索高亮 + Legend。
 * KG（记忆层）与 onto（数据层）共用此底座；各自外壳负责工具栏/详情/数据装配。
 */

export interface GraphCanvasNode {
  id: string;
  title: string;
  group: string; // 用于聚类布局与配色键
  color: string;
  icon?: React.ReactNode;
  groupLabel?: string;
}

export interface GraphCanvasEdge {
  id: string;
  from: string;
  to: string;
  label?: string;
  color?: string;
  dashed?: boolean;
  animated?: boolean;
  width?: number;
}

export interface GraphCanvasLegendItem {
  group: string;
  label: string;
  color: string;
}

interface GraphCanvasProps {
  nodes: GraphCanvasNode[];
  edges: GraphCanvasEdge[];
  /** 每个 group 的聚类中心；未提供的 group 退化为单环布局 */
  clusterCenters?: Record<string, [number, number]>;
  legend?: GraphCanvasLegendItem[];
  searchQuery?: string;
  hiddenIds?: Set<string>;
  onNodeClick?: (id: string) => void;
  onEdgeClick?: (id: string) => void;
  onConnect?: (fromId: string, toId: string) => void;
  emptyHint?: React.ReactNode;
}

// ---- layout: 按 group 聚类，无中心则放到默认环 ----
function layoutNodes(nodes: GraphCanvasNode[], clusterCenters?: Record<string, [number, number]>): Node[] {
  const byGroup = new Map<string, GraphCanvasNode[]>();
  for (const n of nodes) {
    if (!byGroup.has(n.group)) byGroup.set(n.group, []);
    byGroup.get(n.group)!.push(n);
  }
  const groups = [...byGroup.keys()];
  const positioned: Node[] = [];
  groups.forEach((group, gi) => {
    const list = byGroup.get(group)!;
    const center = clusterCenters?.[group] ?? defaultCenter(gi, groups.length);
    const [cx, cy] = center;
    const count = list.length;
    const radius = count <= 1 ? 0 : Math.max(90, Math.sqrt(count) * 58);
    list.forEach((n, i) => {
      const angle = count <= 1 ? 0 : (2 * Math.PI * i) / count - Math.PI / 2;
      positioned.push({
        id: n.id,
        type: "gcNode",
        position: { x: cx + radius * Math.cos(angle) - 70, y: cy + radius * Math.sin(angle) - 20 },
        data: { node: n },
      });
    });
  });
  return positioned;
}

function defaultCenter(index: number, total: number): [number, number] {
  if (total <= 1) return [0, 0];
  const R = Math.max(280, total * 90);
  const a = (2 * Math.PI * index) / total - Math.PI / 2;
  return [R * Math.cos(a), R * Math.sin(a)];
}

function toRFEdges(edges: GraphCanvasEdge[]): Edge[] {
  return edges.map((e) => ({
    id: e.id,
    source: e.from,
    target: e.to,
    label: e.label,
    style: {
      stroke: e.color ?? "#94a3b8",
      strokeWidth: e.width ?? 1.2,
      strokeDasharray: e.dashed ? "4 2" : undefined,
    },
    labelStyle: { fontSize: 10, fill: "#94a3b8" },
    labelBgStyle: { fill: "transparent" },
    animated: !!e.animated,
  }));
}

// ---- custom node ----
interface GCNodeData extends Record<string, unknown> { node: GraphCanvasNode }
type GCRFNode = Node<GCNodeData>;

function GCNodeComponent({ data, selected }: NodeProps<GCRFNode>) {
  const { node } = data;
  return (
    <div
      className={cn("w-36 rounded-lg border-2 bg-white px-2.5 py-2 shadow-sm transition-opacity dark:bg-neutral-900", selected && "shadow-md")}
      style={{ borderColor: node.color }}
    >
      <Handle type="target" position={Position.Left} style={{ background: node.color, width: 6, height: 6 }} />
      {(node.icon || node.groupLabel) && (
        <div className="flex items-center gap-1.5">
          {node.icon && <span style={{ color: node.color }} className="shrink-0">{node.icon}</span>}
          {node.groupLabel && <span className="text-[10px] font-medium" style={{ color: node.color }}>{node.groupLabel}</span>}
        </div>
      )}
      <p className="mt-1 line-clamp-2 text-[11.5px] font-medium text-neutral-800 dark:text-neutral-200">{node.title}</p>
      <Handle type="source" position={Position.Right} style={{ background: node.color, width: 6, height: 6 }} />
    </div>
  );
}

const nodeTypes = { gcNode: GCNodeComponent as React.ComponentType<NodeProps> };

function Legend({ items }: { items: GraphCanvasLegendItem[] }) {
  return (
    <div className="absolute bottom-4 left-4 z-10 flex flex-col gap-1.5 rounded-lg border border-neutral-200 bg-white/90 p-3 text-[11px] backdrop-blur-sm dark:border-neutral-700 dark:bg-neutral-900/90">
      {items.map((it) => (
        <div key={it.group} className="flex items-center gap-2">
          <span className="h-2.5 w-2.5 rounded-full" style={{ background: it.color }} />
          <span className="text-neutral-600 dark:text-neutral-400">{it.label}</span>
        </div>
      ))}
    </div>
  );
}

export function GraphCanvas({
  nodes, edges, clusterCenters, legend, searchQuery, hiddenIds,
  onNodeClick, onEdgeClick, onConnect, emptyHint,
}: GraphCanvasProps) {
  const visibleNodes = useMemo(
    () => nodes.filter((n) => !hiddenIds?.has(n.id)),
    [nodes, hiddenIds],
  );
  const visibleNodeIds = useMemo(() => new Set(visibleNodes.map((n) => n.id)), [visibleNodes]);
  const visibleEdges = useMemo(
    () => edges.filter((e) => visibleNodeIds.has(e.from) && visibleNodeIds.has(e.to)),
    [edges, visibleNodeIds],
  );

  const [rfNodes, setRfNodes, onNodesChange] = useNodesState<Node>([]);
  const [rfEdges, setRfEdges, onEdgesChange] = useEdgesState<Edge>([]);

  useEffect(() => {
    setRfNodes(layoutNodes(visibleNodes, clusterCenters));
    setRfEdges(toRFEdges(visibleEdges));
  }, [visibleNodes, visibleEdges, clusterCenters, setRfNodes, setRfEdges]);

  // search highlight
  useEffect(() => {
    const q = searchQuery?.trim().toLowerCase();
    setRfNodes((prev) => prev.map((n) => {
      if (!q) return { ...n, style: {} };
      const raw = (n.data as GCNodeData).node;
      const matches = raw.title.toLowerCase().includes(q) || raw.group.toLowerCase().includes(q);
      return { ...n, style: { opacity: matches ? 1 : 0.15, transition: "opacity 0.15s" } };
    }));
  }, [searchQuery, setRfNodes]);

  const handleNodeClick = useCallback((_: React.MouseEvent, n: Node) => onNodeClick?.(n.id), [onNodeClick]);
  const handleEdgeClick = useCallback((_: React.MouseEvent, e: Edge) => onEdgeClick?.(e.id), [onEdgeClick]);
  const handleConnect = useCallback((c: Connection) => {
    if (c.source && c.target) onConnect?.(c.source, c.target);
  }, [onConnect]);

  if (visibleNodes.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 text-neutral-400">
        {emptyHint ?? <p className="text-[13px]">图谱为空</p>}
      </div>
    );
  }

  return (
    <ReactFlow
      nodes={rfNodes}
      edges={rfEdges}
      onNodesChange={onNodesChange}
      onEdgesChange={onEdgesChange}
      onNodeClick={handleNodeClick}
      onEdgeClick={handleEdgeClick}
      onConnect={handleConnect}
      nodeTypes={nodeTypes}
      fitView
      fitViewOptions={{ padding: 0.15 }}
      minZoom={0.2}
      maxZoom={2}
    >
      <Background variant={BackgroundVariant.Dots} gap={20} size={1} color="#e5e7eb" />
      <Controls />
      {legend && legend.length > 0 && <Legend items={legend} />}
    </ReactFlow>
  );
}
