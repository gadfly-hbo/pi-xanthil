import React, { useCallback, useEffect, useMemo, useState } from "react";
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
import {
  AlertCircle, BarChart2, BookOpen, EyeOff, Eye, FileText,
  Globe, Network, RefreshCw, Search, Sparkles, Tag, X, Trash2,
} from "lucide-react";
import { cn } from "@/lib/cn";
import { api } from "@/lib/api";
import type { KgEdge, KgExtractResult, KgNode, KgNodeType, KgRelation, KgSyncResult } from "@/types";

// ---- constants ----

const TYPE_COLORS: Record<KgNodeType, string> = {
  rule: "#6366f1",
  metric: "#10b981",
  ref_file: "#f59e0b",
  biz_ctx: "#3b82f6",
  report: "#ec4899",
  concept: "#a78bfa",
};

const TYPE_LABELS: Record<KgNodeType, string> = {
  rule: "规则",
  metric: "指标",
  ref_file: "参照文件",
  biz_ctx: "业务环境",
  report: "报告",
  concept: "概念",
};

const RELATION_LABELS: Record<KgRelation, string> = {
  related_to: "相关",
  references: "引用",
  supports: "支撑",
  derived_from: "衍生自",
};

const TYPE_ICONS: Record<KgNodeType, React.ReactNode> = {
  rule: <BookOpen className="h-3 w-3" />,
  metric: <BarChart2 className="h-3 w-3" />,
  ref_file: <FileText className="h-3 w-3" />,
  biz_ctx: <Globe className="h-3 w-3" />,
  report: <FileText className="h-3 w-3" />,
  concept: <Sparkles className="h-3 w-3" />,
};

const CLUSTER_CENTERS: Record<KgNodeType, [number, number]> = {
  rule: [0, 0],
  metric: [480, -280],
  ref_file: [-480, -280],
  biz_ctx: [-480, 280],
  report: [480, 280],
  concept: [0, -480],
};

const ALL_RELATIONS: KgRelation[] = ["related_to", "references", "supports", "derived_from"];

// ---- layout ----

function layoutNodes(nodes: KgNode[]): Node[] {
  const byType = new Map<KgNodeType, KgNode[]>();
  for (const n of nodes) {
    if (!byType.has(n.type)) byType.set(n.type, []);
    byType.get(n.type)!.push(n);
  }
  const positioned: Node[] = [];
  for (const [type, group] of byType) {
    const [cx, cy] = CLUSTER_CENTERS[type];
    const count = group.length;
    const radius = count <= 1 ? 0 : Math.max(90, Math.sqrt(count) * 58);
    group.forEach((n, i) => {
      const angle = count <= 1 ? 0 : (2 * Math.PI * i) / count - Math.PI / 2;
      positioned.push({
        id: n.id,
        type: "kgNode",
        position: { x: cx + radius * Math.cos(angle) - 70, y: cy + radius * Math.sin(angle) - 20 },
        data: { node: n },
      });
    });
  }
  return positioned;
}

function toRFEdges(edges: KgEdge[]): Edge[] {
  return edges.map((e) => ({
    id: e.id,
    source: e.fromId,
    target: e.toId,
    label: RELATION_LABELS[e.relation],
    style: { stroke: e.auto ? "#94a3b8" : "#6366f1", strokeWidth: Math.max(1, e.weight * 0.8), strokeDasharray: e.auto ? undefined : "4 2" },
    labelStyle: { fontSize: 10, fill: "#94a3b8" },
    labelBgStyle: { fill: "transparent" },
    animated: e.relation === "references",
    data: { edge: e },
  }));
}

// ---- custom node ----

interface KgNodeData extends Record<string, unknown> { node: KgNode }
type KgRFNode = Node<KgNodeData>;

function KgNodeComponent({ data, selected }: NodeProps<KgRFNode>) {
  const { node } = data;
  const color = TYPE_COLORS[node.type];
  return (
    <div
      className={cn("w-36 rounded-lg border-2 bg-white px-2.5 py-2 shadow-sm transition-opacity dark:bg-neutral-900", selected && "shadow-md")}
      style={{ borderColor: color }}
    >
      <Handle type="target" position={Position.Left} style={{ background: color, width: 6, height: 6 }} />
      <div className="flex items-center gap-1.5">
        <span style={{ color }} className="shrink-0">{TYPE_ICONS[node.type]}</span>
        <span className="text-[10px] font-medium" style={{ color }}>{TYPE_LABELS[node.type]}</span>
      </div>
      <p className="mt-1 line-clamp-2 text-[11.5px] font-medium text-neutral-800 dark:text-neutral-200">{node.title}</p>
      <Handle type="source" position={Position.Right} style={{ background: color, width: 6, height: 6 }} />
    </div>
  );
}

const nodeTypes = { kgNode: KgNodeComponent as React.ComponentType<NodeProps> };

// ---- legend ----

function Legend() {
  return (
    <div className="absolute bottom-4 left-4 z-10 flex flex-col gap-1.5 rounded-lg border border-neutral-200 bg-white/90 p-3 text-[11px] backdrop-blur-sm dark:border-neutral-700 dark:bg-neutral-900/90">
      {(Object.entries(TYPE_LABELS) as [KgNodeType, string][]).map(([type, label]) => (
        <div key={type} className="flex items-center gap-2">
          <span className="h-2.5 w-2.5 rounded-full" style={{ background: TYPE_COLORS[type] }} />
          <span className="text-neutral-600 dark:text-neutral-400">{label}</span>
        </div>
      ))}
    </div>
  );
}

// ---- connection modal ----

function ConnectionModal({
  fromNode, toNode, onConfirm, onCancel,
}: { fromNode: KgNode; toNode: KgNode; onConfirm: (relation: KgRelation) => void; onCancel: () => void }) {
  const [relation, setRelation] = useState<KgRelation>("related_to");
  return (
    <div className="absolute inset-0 z-30 flex items-center justify-center bg-black/20 backdrop-blur-sm">
      <div className="w-72 rounded-xl border border-neutral-200 bg-white p-5 shadow-xl dark:border-neutral-700 dark:bg-neutral-900">
        <h3 className="text-[13px] font-semibold text-neutral-900 dark:text-neutral-100">添加关联</h3>
        <p className="mt-1 text-[12px] text-neutral-500">
          「{fromNode.title}」→「{toNode.title}」
        </p>
        <div className="mt-4 grid grid-cols-2 gap-2">
          {ALL_RELATIONS.map((r) => (
            <button
              key={r}
              onClick={() => setRelation(r)}
              className={cn(
                "rounded-md border px-3 py-1.5 text-[12px] transition-colors",
                relation === r
                  ? "border-indigo-500 bg-indigo-50 text-indigo-700 dark:bg-indigo-950/40 dark:text-indigo-300"
                  : "border-neutral-200 text-neutral-600 hover:border-neutral-300 dark:border-neutral-700 dark:text-neutral-400",
              )}
            >
              {RELATION_LABELS[r]}
            </button>
          ))}
        </div>
        <div className="mt-5 flex gap-2">
          <button onClick={onCancel} className="flex-1 rounded-md border border-neutral-200 px-3 py-1.5 text-[12px] text-neutral-600 hover:bg-neutral-50 dark:border-neutral-700 dark:text-neutral-400">
            取消
          </button>
          <button onClick={() => onConfirm(relation)} className="flex-1 rounded-md bg-neutral-900 px-3 py-1.5 text-[12px] font-medium text-white hover:bg-neutral-700 dark:bg-neutral-100 dark:text-neutral-900">
            确认
          </button>
        </div>
      </div>
    </div>
  );
}

// ---- detail panel ----

function DetailPanel({ node, onClose, onToggleHidden }: { node: KgNode; onClose: () => void; onToggleHidden: (hidden: boolean) => void }) {
  const color = TYPE_COLORS[node.type];
  return (
    <div className="absolute right-0 top-0 z-20 flex h-full w-72 flex-col border-l border-neutral-200 bg-white shadow-lg dark:border-neutral-800 dark:bg-neutral-900">
      <div className="flex items-center justify-between border-b border-neutral-200 px-4 py-3 dark:border-neutral-800">
        <div className="flex items-center gap-2">
          <span className="h-2.5 w-2.5 rounded-full" style={{ background: color }} />
          <span className="text-[12px] font-semibold text-neutral-900 dark:text-neutral-100">{TYPE_LABELS[node.type]}</span>
        </div>
        <button onClick={onClose} className="rounded-md p-1 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700 dark:hover:bg-neutral-800">
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
      <div className="flex-1 overflow-y-auto p-4 text-[12.5px]">
        <p className="font-semibold text-neutral-900 dark:text-neutral-100">{node.title}</p>
        {node.summary && (
          <p className="mt-2 leading-relaxed text-neutral-600 dark:text-neutral-400">{node.summary}</p>
        )}
        {node.tags.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {node.tags.map((tag) => (
              <span key={tag} className="flex items-center gap-1 rounded-full bg-neutral-100 px-2 py-0.5 text-[11px] text-neutral-600 dark:bg-neutral-800 dark:text-neutral-400">
                <Tag className="h-2.5 w-2.5" />{tag}
              </span>
            ))}
          </div>
        )}
        <p className="mt-4 text-[11px] text-neutral-400">{new Date(node.updatedAt).toLocaleString()}</p>
      </div>
      <div className="border-t border-neutral-200 p-3 dark:border-neutral-800">
        <button
          onClick={() => onToggleHidden(!node.hidden)}
          className={cn(
            "flex w-full items-center gap-2 rounded-md px-3 py-2 text-[12px] transition-colors",
            node.hidden
              ? "bg-emerald-50 text-emerald-700 hover:bg-emerald-100 dark:bg-emerald-950/40 dark:text-emerald-300"
              : "bg-neutral-50 text-neutral-600 hover:bg-neutral-100 dark:bg-neutral-800 dark:text-neutral-400",
          )}
        >
          {node.hidden ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
          {node.hidden ? "恢复显示" : "隐藏节点（不注入 AI）"}
        </button>
      </div>
    </div>
  );
}

// ---- node list view ----

function NodeListView({ nodes, onSelectNode, onToggleHidden }: { nodes: KgNode[]; onSelectNode: (n: KgNode) => void; onToggleHidden: (n: KgNode, hidden: boolean) => void }) {
  const [filterType, setFilterType] = useState<KgNodeType | "all">("all");
  const [query, setQuery] = useState("");
  const [showHidden, setShowHidden] = useState(false);

  const filtered = useMemo(() => nodes.filter((n) => {
    if (!showHidden && n.hidden) return false;
    if (filterType !== "all" && n.type !== filterType) return false;
    if (query && !n.title.toLowerCase().includes(query.toLowerCase()) && !n.summary.toLowerCase().includes(query.toLowerCase())) return false;
    return true;
  }), [nodes, filterType, query, showHidden]);

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b border-neutral-200 px-4 py-3 dark:border-neutral-800">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="搜索节点…"
          className="h-7 min-w-32 flex-1 rounded-md border border-neutral-300 bg-white px-2.5 text-[12px] outline-none focus:border-neutral-500 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100"
        />
        {(["all", ...Object.keys(TYPE_LABELS)] as Array<KgNodeType | "all">).map((type) => (
          <button
            key={type}
            onClick={() => setFilterType(type)}
            className={cn(
              "rounded-full px-2.5 py-0.5 text-[11.5px] transition-colors",
              filterType === type ? "bg-neutral-900 text-white dark:bg-neutral-100 dark:text-neutral-900" : "bg-neutral-100 text-neutral-600 hover:bg-neutral-200 dark:bg-neutral-800 dark:text-neutral-400",
            )}
            style={filterType === type && type !== "all" ? { background: TYPE_COLORS[type as KgNodeType] } : {}}
          >
            {type === "all" ? `全部 (${nodes.filter(n => showHidden || !n.hidden).length})` : TYPE_LABELS[type as KgNodeType]}
          </button>
        ))}
        <button
          onClick={() => setShowHidden((v) => !v)}
          className={cn("rounded-full px-2.5 py-0.5 text-[11.5px] transition-colors", showHidden ? "bg-amber-100 text-amber-700" : "bg-neutral-100 text-neutral-500 hover:bg-neutral-200")}
        >
          {showHidden ? "显示隐藏" : "含隐藏"}
        </button>
      </div>
      <div className="flex-1 overflow-y-auto">
        {filtered.length === 0 ? (
          <div className="flex items-center justify-center py-16 text-[13px] text-neutral-400">暂无节点</div>
        ) : (
          <table className="w-full text-left text-[12px]">
            <thead>
              <tr className="border-b border-neutral-100 text-neutral-500 dark:border-neutral-800">
                <th className="px-4 py-2.5 font-medium">标题</th>
                <th className="px-3 py-2.5 font-medium">类型</th>
                <th className="px-3 py-2.5 font-medium">标签</th>
                <th className="px-3 py-2.5 font-medium">状态</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((n) => (
                <tr
                  key={n.id}
                  onClick={() => onSelectNode(n)}
                  className={cn(
                    "cursor-pointer border-b border-neutral-50 hover:bg-neutral-50 dark:border-neutral-800/50 dark:hover:bg-neutral-800/30",
                    n.hidden ? "opacity-40" : "text-neutral-700 dark:text-neutral-300",
                  )}
                >
                  <td className="max-w-[14rem] truncate px-4 py-2.5 font-medium">{n.title}</td>
                  <td className="px-3 py-2.5">
                    <span className="rounded-full px-2 py-0.5 text-[10.5px] text-white" style={{ background: TYPE_COLORS[n.type] }}>
                      {TYPE_LABELS[n.type]}
                    </span>
                  </td>
                  <td className="max-w-[8rem] truncate px-3 py-2.5 text-neutral-500">{n.tags.join(", ")}</td>
                  <td className="px-3 py-2.5">
                    <button
                      onClick={(e) => { e.stopPropagation(); onToggleHidden(n, !n.hidden); }}
                      className="rounded p-0.5 text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200"
                      title={n.hidden ? "恢复显示" : "隐藏"}
                    >
                      {n.hidden ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

// ---- main pane ----

export function KnowledgeGraphPane({ workspaceId, onSynced }: { workspaceId: string | null; onSynced?: () => void }) {
  const [rfNodes, setRfNodes, onNodesChange] = useNodesState<Node>([]);
  const [rfEdges, setRfEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [rawNodes, setRawNodes] = useState<KgNode[]>([]);
  const [rawEdges, setRawEdges] = useState<KgEdge[]>([]);
  const [syncing, setSyncing] = useState(false);
  const [extracting, setExtracting] = useState(false);
  const [lastSync, setLastSync] = useState<KgSyncResult | null>(null);
  const [lastExtract, setLastExtract] = useState<KgExtractResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedNode, setSelectedNode] = useState<KgNode | null>(null);
  const [selectedEdge, setSelectedEdge] = useState<KgEdge | null>(null);
  const [view, setView] = useState<"graph" | "list">("graph");
  const [searchQuery, setSearchQuery] = useState("");
  const [pendingConn, setPendingConn] = useState<{ fromId: string; toId: string } | null>(null);

  const load = useCallback(async (includeHidden = false) => {
    if (!workspaceId) return;
    try {
      const [kgNodes, kgEdges] = await Promise.all([
        api.listKgNodes(workspaceId, includeHidden),
        api.listKgEdges(workspaceId),
      ]);
      setRawNodes(kgNodes);
      setRawEdges(kgEdges);
      setRfNodes(layoutNodes(kgNodes));
      setRfEdges(toRFEdges(kgEdges));
      setError(null);
    } catch (err) {
      setError(String(err));
    }
  }, [workspaceId, setRfNodes, setRfEdges]);

  useEffect(() => { void load(true); }, [load]);

  // Apply search highlight to ReactFlow nodes
  useEffect(() => {
    if (!searchQuery.trim()) {
      setRfNodes((prev) => prev.map((n) => ({ ...n, style: {} })));
      return;
    }
    const q = searchQuery.toLowerCase();
    setRfNodes((prev) => prev.map((n) => {
      const raw = rawNodes.find((r) => r.id === n.id);
      const matches = raw && (raw.title.toLowerCase().includes(q) || raw.summary.toLowerCase().includes(q) || raw.tags.some((t) => t.toLowerCase().includes(q)));
      return { ...n, style: { opacity: matches ? 1 : 0.15, transition: "opacity 0.15s" } };
    }));
  }, [searchQuery, setRfNodes, rawNodes]);

  const handleSync = useCallback(async () => {
    if (!workspaceId || syncing) return;
    setSyncing(true);
    setError(null);
    try {
      const result = await api.syncKnowledgeGraph(workspaceId);
      setLastSync(result);
      await load(true);
      onSynced?.();
    } catch (err) {
      setError(String(err));
    } finally {
      setSyncing(false);
    }
  }, [workspaceId, syncing, load, onSynced]);

  const handleExtract = useCallback(async () => {
    if (!workspaceId || extracting) return;
    setExtracting(true);
    setError(null);
    try {
      const result = await api.extractKgEntities(workspaceId);
      setLastExtract(result);
      await load(true);
      onSynced?.();
    } catch (err) {
      setError(String(err));
    } finally {
      setExtracting(false);
    }
  }, [workspaceId, extracting, load, onSynced]);

  const handleNodeClick = useCallback((_: React.MouseEvent, rfNode: Node) => {
    const kgNode = rawNodes.find((n) => n.id === rfNode.id);
    if (kgNode) { setSelectedNode(kgNode); setSelectedEdge(null); }
  }, [rawNodes]);

  const handleEdgeClick = useCallback((_: React.MouseEvent, edge: Edge) => {
    const kgEdge = rawEdges.find((e) => e.id === edge.id);
    if (kgEdge) { setSelectedEdge(kgEdge); setSelectedNode(null); }
  }, [rawEdges]);

  const handleConnect = useCallback((conn: Connection) => {
    if (conn.source && conn.target) setPendingConn({ fromId: conn.source, toId: conn.target });
  }, []);

  const confirmConnection = useCallback(async (relation: KgRelation) => {
    if (!workspaceId || !pendingConn) return;
    try {
      await api.addKgEdge(workspaceId, pendingConn.fromId, pendingConn.toId, relation);
      setPendingConn(null);
      await load(true);
    } catch (err) {
      setError(String(err));
    }
  }, [workspaceId, pendingConn, load]);

  const handleDeleteEdge = useCallback(async () => {
    if (!selectedEdge) return;
    try {
      await api.deleteKgEdge(selectedEdge.id);
      setSelectedEdge(null);
      await load(true);
    } catch (err) {
      setError(String(err));
    }
  }, [selectedEdge, load]);

  const handleToggleHidden = useCallback(async (node: KgNode, hidden: boolean) => {
    try {
      await api.setKgNodeHidden(node.id, hidden);
      setSelectedNode((prev) => prev?.id === node.id ? { ...prev, hidden } : prev);
      await load(true);
    } catch (err) {
      setError(String(err));
    }
  }, [load]);

  const visibleNodes = useMemo(() => rawNodes.filter((n) => !n.hidden), [rawNodes]);
  const fromNode = pendingConn ? rawNodes.find((n) => n.id === pendingConn.fromId) : null;
  const toNode = pendingConn ? rawNodes.find((n) => n.id === pendingConn.toId) : null;

  if (!workspaceId) {
    return <div className="flex h-full items-center justify-center text-[13px] text-neutral-400">请先选择工作区</div>;
  }

  return (
    <div className="flex h-full flex-col">
      {/* toolbar */}
      <div className="flex shrink-0 flex-wrap items-center gap-3 border-b border-neutral-200 px-4 py-2.5 dark:border-neutral-800">
        <Network className="h-4 w-4 shrink-0 text-neutral-500" strokeWidth={1.5} />
        <h1 className="shrink-0 text-[13px] font-semibold text-neutral-900 dark:text-neutral-100">知识图谱</h1>
        <div className="flex rounded-md border border-neutral-200 dark:border-neutral-700">
          {(["graph", "list"] as const).map((v) => (
            <button
              key={v}
              onClick={() => setView(v)}
              className={cn(
                "px-3 py-1 text-[12px] transition-colors",
                view === v ? "bg-neutral-900 text-white dark:bg-neutral-100 dark:text-neutral-900" : "text-neutral-500 hover:bg-neutral-100 dark:text-neutral-400 dark:hover:bg-neutral-800",
                v === "graph" ? "rounded-l-md" : "rounded-r-md",
              )}
            >
              {v === "graph" ? "图谱视图" : "节点浏览"}
            </button>
          ))}
        </div>

        {/* search — only in graph view */}
        {view === "graph" && (
          <div className="relative">
            <Search className="absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2 text-neutral-400" />
            <input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="搜索高亮…"
              className="h-7 w-40 rounded-md border border-neutral-300 bg-white pl-6 pr-2.5 text-[12px] outline-none focus:border-neutral-500 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100"
            />
            {searchQuery && (
              <button onClick={() => setSearchQuery("")} className="absolute right-2 top-1/2 -translate-y-1/2 text-neutral-400 hover:text-neutral-700">
                <X className="h-3 w-3" />
              </button>
            )}
          </div>
        )}

        <div className="ml-auto flex items-center gap-3">
          {lastExtract ? (
            <span className="text-[11.5px] text-violet-500">
              +{lastExtract.newNodes} 概念 · +{lastExtract.newEdges} 边 · 处理 {lastExtract.processedReports} 篇{lastExtract.skippedReports > 0 ? ` · 跳过 ${lastExtract.skippedReports} 篇（内容未变）` : ""}
            </span>
          ) : lastSync ? (
            <span className="text-[11.5px] text-neutral-500">
              {lastSync.nodeCount} 节点 · {lastSync.edgeCount} 边 · {new Date(lastSync.syncedAt).toLocaleTimeString()}
            </span>
          ) : visibleNodes.length > 0 && (
            <span className="text-[11.5px] text-neutral-500">{visibleNodes.length} 节点</span>
          )}
          {selectedEdge && (
            <button
              onClick={handleDeleteEdge}
              className="flex items-center gap-1.5 rounded-md border border-red-200 bg-red-50 px-3 py-1.5 text-[12px] font-medium text-red-700 hover:bg-red-100 dark:border-red-900/30 dark:bg-red-900/20 dark:text-red-400"
            >
              <Trash2 className="h-3.5 w-3.5" />
              删除所选边
            </button>
          )}
          <button
            onClick={() => void handleExtract()}
            disabled={!workspaceId || extracting || syncing}
            title="AI 语义提取：用 MiniMax-M3 从报告中提取概念节点和关联边（每次最多处理 5 篇）"
            className="flex items-center gap-1.5 rounded-md border border-violet-300 bg-violet-50 px-3 py-1.5 text-[12px] font-medium text-violet-700 hover:bg-violet-100 disabled:opacity-50 dark:border-violet-700/40 dark:bg-violet-900/20 dark:text-violet-300"
          >
            <Sparkles className={cn("h-3.5 w-3.5", extracting && "animate-pulse")} />
            {extracting ? "提取中…" : "AI 语义提取"}
          </button>
          <button
            onClick={handleSync}
            disabled={syncing}
            className="flex items-center gap-1.5 rounded-md bg-neutral-900 px-3 py-1.5 text-[12px] font-medium text-white hover:bg-neutral-700 disabled:opacity-50 dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-neutral-300"
          >
            <RefreshCw className={cn("h-3.5 w-3.5", syncing && "animate-spin")} />
            {syncing ? "同步中…" : "更新图谱"}
          </button>
        </div>
      </div>

      {error && (
        <div className="flex shrink-0 items-center gap-2 border-b border-red-100 bg-red-50 px-4 py-2 text-[12px] text-red-700 dark:border-red-900/30 dark:bg-red-900/20 dark:text-red-400">
          <AlertCircle className="h-3.5 w-3.5 shrink-0" />{error}
        </div>
      )}

      <div className="relative flex-1 overflow-hidden">
        {view === "graph" ? (
          visibleNodes.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center gap-3 text-neutral-400">
              <Network className="h-10 w-10 opacity-25" strokeWidth={1} />
              <p className="text-[13px]">图谱为空</p>
              <p className="text-[12px]">点击「更新图谱」从 rules / 指标体系 / 业务环境 / workflow 报告中摄入节点</p>
            </div>
          ) : (
            <ReactFlow
              nodes={rfNodes.filter((n) => !rawNodes.find((r) => r.id === n.id)?.hidden)}
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
              <Legend />
            </ReactFlow>
          )
        ) : (
          <NodeListView nodes={rawNodes} onSelectNode={setSelectedNode} onToggleHidden={handleToggleHidden} />
        )}

        {selectedNode && (
          <DetailPanel
            node={selectedNode}
            onClose={() => setSelectedNode(null)}
            onToggleHidden={(hidden) => handleToggleHidden(selectedNode, hidden)}
          />
        )}

        {pendingConn && fromNode && toNode && (
          <ConnectionModal
            fromNode={fromNode}
            toNode={toNode}
            onConfirm={confirmConnection}
            onCancel={() => setPendingConn(null)}
          />
        )}
      </div>
    </div>
  );
}
