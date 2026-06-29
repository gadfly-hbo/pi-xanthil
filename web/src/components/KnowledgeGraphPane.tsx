import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertCircle, BarChart2, BookOpen, EyeOff, Eye, FileText,
  Globe, Network, RefreshCw, Search, Sparkles, Tag, X, Trash2,
  ShieldAlert,
} from "lucide-react";
import { cn } from "@/lib/cn";
import { api } from "@/lib/api";
import { GraphCanvas, type GraphCanvasNode, type GraphCanvasEdge } from "@/components/GraphCanvas";
import type { KgEdge, KgExtractResult, KgNode, KgNodeType, KgRelation, KgSyncResult } from "@/types";

// ---- constants ----

const TYPE_COLORS: Record<KgNodeType, string> = {
  rule: "#6366f1",
  metric: "#10b981",
  ref_file: "#f59e0b",
  biz_ctx: "#3b82f6",
  report: "#ec4899",
  concept: "#a78bfa",
  constraint: "#ef4444",
  experience: "#8b5cf6",
  episode: "#14b8a6",
  fact: "#eab308",
};

const TYPE_LABELS: Record<KgNodeType, string> = {
  rule: "规则",
  metric: "指标",
  ref_file: "参照文件",
  biz_ctx: "业务环境",
  report: "报告",
  concept: "概念",
  constraint: "约束",
  experience: "经验",
  episode: "情景",
  fact: "事实",
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
  constraint: <BookOpen className="h-3 w-3" />,
  experience: <Sparkles className="h-3 w-3" />,
  episode: <FileText className="h-3 w-3" />,
  fact: <BarChart2 className="h-3 w-3" />,
};

const CLUSTER_CENTERS: Record<KgNodeType, [number, number]> = {
  rule: [0, 0],
  metric: [480, -280],
  ref_file: [-480, -280],
  biz_ctx: [-480, 280],
  report: [480, 280],
  concept: [0, -480],
  constraint: [0, 0],
  experience: [0, -480],
  episode: [480, 280],
  fact: [-480, -280],
};

const ALL_RELATIONS: KgRelation[] = ["related_to", "references", "supports", "derived_from"];

const KG_LEGEND = (Object.entries(TYPE_LABELS) as [KgNodeType, string][]).map(([group, label]) => ({
  group, label, color: TYPE_COLORS[group],
}));

const KG_FEATURES = [
  { title: "多来源节点", body: "从 rules、指标体系、业务环境、workflow 报告和语义提取结果中沉淀规则、指标、事实、概念、经验等节点。" },
  { title: "关联边", body: "支持 related_to、references、supports、derived_from 四类关系，自动同步边和人工拖拽添加的边会用不同样式展示。" },
  { title: "图谱视图", body: "按节点类型聚类展示，可搜索高亮、点击节点看详情、点击边后删除人工维护的关系。" },
  { title: "节点浏览", body: "用列表方式按类型、关键词、隐藏状态筛选节点，适合快速检查图谱内容和管理注入范围。" },
  { title: "AI 语义提取", body: "从报告输出中提取概念、事实、经验、情景等补充节点，每次处理有限数量，已处理且内容未变化的报告会跳过。" },
  { title: "注入控制", body: "隐藏节点不会进入 AI 注入链路，可用于临时排除噪声节点或不稳定经验。" },
];

const KG_USAGE_STEPS = [
  { title: "先更新图谱", body: "点击“更新图谱”同步结构化来源，确认 rules、指标、业务环境和报告节点是否齐全。" },
  { title: "再做语义提取", body: "需要从报告正文沉淀概念和经验时，再点击“AI 语义提取”，并关注新增节点、边和跳过数量。" },
  { title: "最后收敛注入", body: "在图谱视图或节点浏览里检查噪声节点，必要时隐藏，避免后续对话注入无关知识。" },
];

const KG_ITERATION_IDEAS = [
  { title: "关系筛选", body: "增加按 relation 类型和自动 / 手工来源过滤边，便于排查引用链和支撑链。" },
  { title: "节点质量评分", body: "结合来源数量、最近更新时间、被隐藏状态和引用次数，给出低置信节点提示。" },
  { title: "提取预览", body: "AI 语义提取前先展示将处理的报告列表和预计范围，减少误触发成本。" },
  { title: "变更历史", body: "记录节点新增、隐藏、恢复和人工连边操作，方便回看图谱演进。" },
];

function getNodeQualityHints(node: KgNode, edges: KgEdge[]) {
  const hints: string[] = [];
  let incoming = 0;
  let outgoing = 0;
  for (const e of edges) {
    if (e.toId === node.id) incoming++;
    if (e.fromId === node.id) outgoing++;
  }
  const total = incoming + outgoing;

  if (total === 0) {
    hints.push("孤立节点（建议检查）");
  } else {
    if (total === 1) hints.push("低关联（仅1条边）");
    if (incoming === 0 && total > 0) hints.push("无入边");
    if (outgoing === 0 && total > 0) hints.push("无出边");
  }

  const thirtyDays = Date.now() - 30 * 86400 * 1000;
  if (node.updatedAt < thirtyDays) {
    hints.push("较久未更新");
  }

  return hints;
}

function KnowledgeGraphReadme() {
  return (
    <div className="h-full overflow-y-auto bg-neutral-50 p-5 dark:bg-neutral-950">
      <div className="mx-auto max-w-6xl space-y-4">
        <section className="rounded-xl border border-neutral-200 bg-white p-5 shadow-sm dark:border-neutral-800 dark:bg-neutral-900">
          <div className="flex items-start gap-3">
            <BookOpen className="mt-0.5 h-4 w-4 shrink-0 text-neutral-700 dark:text-neutral-200" />
            <div className="min-w-0">
              <h2 className="text-[15px] font-semibold text-neutral-900 dark:text-neutral-100">知识图谱是什么</h2>
              <p className="mt-2 text-[13px] leading-6 text-neutral-600 dark:text-neutral-300">
                知识图谱是规则记忆的结构化视图，用节点和关系把规则、指标、业务环境、报告产物和从报告中提取的语义知识串起来。它服务于后续 AI 注入和人工治理，不是原始数据探索工具。
              </p>
            </div>
          </div>
        </section>

        <section className="rounded-xl border border-neutral-200 bg-white p-5 shadow-sm dark:border-neutral-800 dark:bg-neutral-900">
          <h2 className="text-[14px] font-semibold text-neutral-900 dark:text-neutral-100">现在已经实现了什么</h2>
          <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {KG_FEATURES.map((item) => (
              <div key={item.title} className="rounded-lg border border-neutral-200 bg-neutral-50 p-3 dark:border-neutral-800 dark:bg-neutral-950/40">
                <h3 className="text-[12px] font-semibold text-neutral-900 dark:text-neutral-100">{item.title}</h3>
                <p className="mt-1 text-[11.5px] leading-5 text-neutral-600 dark:text-neutral-300">{item.body}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="rounded-xl border border-neutral-200 bg-white p-5 shadow-sm dark:border-neutral-800 dark:bg-neutral-900">
          <h2 className="text-[14px] font-semibold text-neutral-900 dark:text-neutral-100">怎么用</h2>
          <div className="mt-3 grid gap-2 sm:grid-cols-3">
            {KG_USAGE_STEPS.map((item) => (
              <div key={item.title} className="rounded-lg border border-neutral-200 bg-neutral-50 p-3 dark:border-neutral-800 dark:bg-neutral-950/40">
                <h3 className="text-[12px] font-semibold text-neutral-900 dark:text-neutral-100">{item.title}</h3>
                <p className="mt-1 text-[11.5px] leading-5 text-neutral-600 dark:text-neutral-300">{item.body}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="rounded-xl border border-neutral-200 bg-white p-5 shadow-sm dark:border-neutral-800 dark:bg-neutral-900">
          <h2 className="text-[14px] font-semibold text-neutral-900 dark:text-neutral-100">后续值得优化的方向</h2>
          <p className="mt-1 text-[12px] text-neutral-500">下面是本次检查发现的迭代建议，不表示已经上线。</p>
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            {KG_ITERATION_IDEAS.map((item) => (
              <div key={item.title} className="rounded-lg border border-neutral-200 bg-neutral-50 p-3 dark:border-neutral-800 dark:bg-neutral-950/40">
                <h3 className="text-[12px] font-semibold text-neutral-900 dark:text-neutral-100">{item.title}</h3>
                <p className="mt-1 text-[11.5px] leading-5 text-neutral-600 dark:text-neutral-300">{item.body}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="rounded-xl border border-amber-200 bg-amber-50 p-5 text-amber-900 shadow-sm dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
          <h2 className="flex items-center gap-2 text-[14px] font-semibold"><ShieldAlert className="h-4 w-4" /> 安全边界</h2>
          <p className="mt-2 text-[12px] leading-5">
            知识图谱可以使用 rules、业务环境、指标定义、报告产物和经授权的语义提取结果；不要把 draw_data 原始行级内容、客户明细、订单样本或数据探索结果直接送入 AI 提取或注入链路。
          </p>
        </section>
      </div>
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

function DetailPanel({ node, rawEdges, onClose, onToggleHidden }: { node: KgNode; rawEdges: KgEdge[]; onClose: () => void; onToggleHidden: (hidden: boolean) => void }) {
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
        
        {(() => {
          const hints = getNodeQualityHints(node, rawEdges);
          if (hints.length > 0) {
            return (
              <div className="mt-4 flex flex-col gap-1.5 rounded-lg border border-amber-200 bg-amber-50 p-3 dark:border-amber-900/30 dark:bg-amber-900/10">
                <div className="flex items-center gap-1.5 text-[11.5px] font-semibold text-amber-800 dark:text-amber-400">
                  <AlertCircle className="h-3.5 w-3.5" /> 质量提示
                </div>
                <div className="mt-1 flex flex-wrap gap-1.5">
                  {hints.map((h, i) => (
                    <span key={i} className="rounded bg-amber-100/50 px-1.5 py-0.5 text-[11px] text-amber-700 dark:bg-amber-900/40 dark:text-amber-300">
                      {h}
                    </span>
                  ))}
                </div>
              </div>
            );
          }
          return null;
        })()}
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

function NodeListView({ nodes, rawEdges, onSelectNode, onToggleHidden }: { nodes: KgNode[]; rawEdges: KgEdge[]; onSelectNode: (n: KgNode) => void; onToggleHidden: (n: KgNode, hidden: boolean) => void }) {
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
                <th className="px-3 py-2.5 font-medium">质量提示</th>
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
                    {(() => {
                      const hints = getNodeQualityHints(n, rawEdges);
                      if (hints.length === 0) return <span className="text-neutral-400">-</span>;
                      return (
                        <div className="flex flex-wrap gap-1">
                          {hints.map((h, i) => (
                            <span key={i} className="rounded border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-[10px] text-amber-700 dark:border-amber-900/30 dark:bg-amber-900/20 dark:text-amber-400">
                              {h}
                            </span>
                          ))}
                        </div>
                      );
                    })()}
                  </td>
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
  const [rawNodes, setRawNodes] = useState<KgNode[]>([]);
  const [rawEdges, setRawEdges] = useState<KgEdge[]>([]);
  const [syncing, setSyncing] = useState(false);
  const [extracting, setExtracting] = useState(false);
  const [lastSync, setLastSync] = useState<KgSyncResult | null>(null);
  const [lastExtract, setLastExtract] = useState<KgExtractResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedNode, setSelectedNode] = useState<KgNode | null>(null);
  const [selectedEdge, setSelectedEdge] = useState<KgEdge | null>(null);
  const [view, setView] = useState<"graph" | "list" | "readme">("graph");
  const [searchQuery, setSearchQuery] = useState("");
  const [edgeRelationFilter, setEdgeRelationFilter] = useState<KgRelation | "all">("all");
  const [edgeSourceFilter, setEdgeSourceFilter] = useState<"all" | "auto" | "manual">("all");
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
      setError(null);
    } catch (err) {
      setError(String(err));
    }
  }, [workspaceId]);

  useEffect(() => { void load(true); }, [load]);

  // KgNode/KgEdge → GraphCanvas 视图契约
  const gcNodes = useMemo<GraphCanvasNode[]>(() => rawNodes.map((n) => ({
    id: n.id,
    title: n.title,
    group: n.type,
    color: TYPE_COLORS[n.type],
    icon: TYPE_ICONS[n.type],
    groupLabel: TYPE_LABELS[n.type],
  })), [rawNodes]);

  const gcEdges = useMemo<GraphCanvasEdge[]>(() => rawEdges.filter((e) => {
    if (edgeRelationFilter !== "all" && e.relation !== edgeRelationFilter) return false;
    if (edgeSourceFilter !== "all") {
      const isAuto = e.auto;
      if (edgeSourceFilter === "auto" && !isAuto) return false;
      if (edgeSourceFilter === "manual" && isAuto) return false;
    }
    return true;
  }).map((e) => ({
    id: e.id,
    from: e.fromId,
    to: e.toId,
    label: RELATION_LABELS[e.relation],
    color: e.auto ? "#94a3b8" : "#6366f1",
    dashed: !e.auto,
    animated: e.relation === "references",
    width: Math.max(1, e.weight * 0.8),
  })), [rawEdges, edgeRelationFilter, edgeSourceFilter]);

  const hiddenIds = useMemo(() => new Set(rawNodes.filter((n) => n.hidden).map((n) => n.id)), [rawNodes]);

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

  const handleNodeClick = useCallback((id: string) => {
    const kgNode = rawNodes.find((n) => n.id === id);
    if (kgNode) { setSelectedNode(kgNode); setSelectedEdge(null); }
  }, [rawNodes]);

  const handleEdgeClick = useCallback((id: string) => {
    const kgEdge = rawEdges.find((e) => e.id === id);
    if (kgEdge) { setSelectedEdge(kgEdge); setSelectedNode(null); }
  }, [rawEdges]);

  const handleConnect = useCallback((fromId: string, toId: string) => {
    setPendingConn({ fromId, toId });
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
          {([
            { id: "graph" as const, label: "图谱视图" },
            { id: "list" as const, label: "节点浏览" },
            { id: "readme" as const, label: "说明" },
          ]).map((tab, index, tabs) => (
            <button
              key={tab.id}
              onClick={() => setView(tab.id)}
              className={cn(
                "px-3 py-1 text-[12px] transition-colors",
                view === tab.id ? "bg-neutral-900 text-white dark:bg-neutral-100 dark:text-neutral-900" : "text-neutral-500 hover:bg-neutral-100 dark:text-neutral-400 dark:hover:bg-neutral-800",
                index === 0 && "rounded-l-md",
                index === tabs.length - 1 && "rounded-r-md",
              )}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* search & filters — only in graph view */}
        {view === "graph" && (
          <div className="flex flex-wrap items-center gap-2">
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
            <select
              value={edgeRelationFilter}
              onChange={(e) => setEdgeRelationFilter(e.target.value as KgRelation | "all")}
              className="h-7 rounded-md border border-neutral-300 bg-white px-2 text-[12px] text-neutral-700 outline-none focus:border-neutral-500 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-300"
            >
              <option value="all">关系：全部</option>
              {ALL_RELATIONS.map(r => <option key={r} value={r}>关系：{RELATION_LABELS[r]}</option>)}
            </select>
            <select
              value={edgeSourceFilter}
              onChange={(e) => setEdgeSourceFilter(e.target.value as "all" | "auto" | "manual")}
              className="h-7 rounded-md border border-neutral-300 bg-white px-2 text-[12px] text-neutral-700 outline-none focus:border-neutral-500 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-300"
            >
              <option value="all">来源：全部</option>
              <option value="auto">来源：自动同步</option>
              <option value="manual">来源：人工维护</option>
            </select>
          </div>
        )}

        {view !== "readme" && <div className="ml-auto flex items-center gap-3">
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
        </div>}
      </div>

      {error && (
        <div className="flex shrink-0 items-center gap-2 border-b border-red-100 bg-red-50 px-4 py-2 text-[12px] text-red-700 dark:border-red-900/30 dark:bg-red-900/20 dark:text-red-400">
          <AlertCircle className="h-3.5 w-3.5 shrink-0" />{error}
        </div>
      )}

      <div className="relative flex-1 overflow-hidden">
        {view === "readme" ? (
          <KnowledgeGraphReadme />
        ) : view === "graph" ? (
          <GraphCanvas
            nodes={gcNodes}
            edges={gcEdges}
            clusterCenters={CLUSTER_CENTERS}
            legend={KG_LEGEND}
            searchQuery={searchQuery}
            hiddenIds={hiddenIds}
            onNodeClick={handleNodeClick}
            onEdgeClick={handleEdgeClick}
            onConnect={handleConnect}
            emptyHint={
              <div className="flex flex-col items-center gap-3">
                <Network className="h-10 w-10 opacity-25" strokeWidth={1} />
                <p className="text-[13px]">图谱为空</p>
                <p className="text-[12px]">点击「更新图谱」从 rules / 指标体系 / 业务环境 / workflow 报告中摄入节点</p>
              </div>
            }
          />
        ) : (
          <NodeListView nodes={rawNodes} rawEdges={rawEdges} onSelectNode={setSelectedNode} onToggleHidden={handleToggleHidden} />
        )}

        {view !== "readme" && selectedNode && (
          <DetailPanel
            node={selectedNode}
            rawEdges={rawEdges}
            onClose={() => setSelectedNode(null)}
            onToggleHidden={(hidden) => handleToggleHidden(selectedNode, hidden)}
          />
        )}

        {view !== "readme" && pendingConn && fromNode && toNode && (
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
