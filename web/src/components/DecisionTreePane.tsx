import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Background,
  Controls,
  Handle,
  Position,
  ReactFlow,
  ReactFlowProvider,
  type Edge,
  type Node,
  type NodeProps,
} from "@xyflow/react";
import { AlertTriangle, Download, GitBranch, Loader2, RefreshCw, Sparkles } from "lucide-react";
import { api } from "@/lib/api";
import { cn } from "@/lib/cn";
import { useResumableTask } from "@/lib/resumableTask";
import type { DecisionTreeNode, Flow, FlowTreeNode, PiModel } from "@/types";

type Scope =
  | { type: "session"; sessionId: string | null }
  | { type: "flow"; flow: Flow | null };

interface ReportOption {
  id: string;
  label: string;
  source: "session" | "flow-run";
  path: string;
  runId?: string;
}

type NodeData = Pick<DecisionTreeNode, "title" | "body" | "kind">;

function basenamePath(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).at(-1) ?? path;
}

function flattenFiles(node: FlowTreeNode | null): FlowTreeNode[] {
  const out: FlowTreeNode[] = [];
  const walk = (n: FlowTreeNode) => {
    if (n.kind === "file") out.push(n);
    for (const child of n.children ?? []) walk(child);
  };
  if (node) walk(node);
  return out;
}

function isReportFile(node: FlowTreeNode): boolean {
  return /\.(md|markdown|txt)$/i.test(node.name)
    && (/report|summary|result|insight|分析|报告|结论|洞察|建议/i.test(node.name)
      || /\.(md|markdown)$/i.test(node.name));
}

function toFlowNodes(tree: DecisionTreeNode[]): { nodes: Node[]; edges: Edge[] } {
  const depthOf = (item: DecisionTreeNode): number => {
    if (!item.parentId) return 0;
    const parent = tree.find((n) => n.id === item.parentId);
    return parent ? depthOf(parent) + 1 : 0;
  };
  const levels = new Map<number, DecisionTreeNode[]>();
  tree.forEach((item) => {
    const d = depthOf(item);
    levels.set(d, [...(levels.get(d) ?? []), item]);
  });
  const nodes: Node[] = tree.map((item) => {
    const d = depthOf(item);
    const level = levels.get(d) ?? [];
    const idx = level.findIndex((n) => n.id === item.id);
    return {
      id: item.id,
      type: "decision",
      position: { x: 60 + d * 330, y: 80 + idx * 145 },
      data: { title: item.title, body: item.body, kind: item.kind } satisfies NodeData,
    };
  });
  const edges: Edge[] = tree
    .filter((item) => item.parentId)
    .map((item) => ({
      id: `${item.parentId}-${item.id}`,
      source: item.parentId!,
      target: item.id,
      type: "smoothstep",
      animated: item.kind === "conclusion",
    }));
  return { nodes, edges };
}

function DecisionCard({ data }: NodeProps) {
  const d = data as unknown as NodeData;
  const theme =
    d.kind === "root"
      ? "border-sky-200 bg-sky-50 text-sky-950 dark:border-sky-900 dark:bg-sky-950/30 dark:text-sky-100"
      : d.kind === "conclusion"
        ? "border-emerald-200 bg-emerald-50 text-emerald-950 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-100"
        : d.kind === "factor"
          ? "border-amber-200 bg-amber-50 text-amber-950 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-100"
          : "border-neutral-200 bg-white text-neutral-800 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-200";
  return (
    <div className={cn("w-64 rounded-xl border px-3 py-2 shadow-sm", theme)}>
      <Handle type="target" position={Position.Left} className="!h-2 !w-2 !border-none !bg-neutral-400" />
      <div className="flex items-center gap-1.5 text-[12px] font-semibold">
        <GitBranch className="h-3.5 w-3.5 shrink-0" strokeWidth={1.75} />
        <span className="truncate">{d.title}</span>
      </div>
      <p className="mt-1.5 line-clamp-5 whitespace-pre-line text-[11px] leading-4 opacity-80">{d.body}</p>
      <Handle type="source" position={Position.Right} className="!h-2 !w-2 !border-none !bg-neutral-400" />
    </div>
  );
}

const nodeTypes = { decision: DecisionCard };

function DecisionCanvas({ tree }: { tree: DecisionTreeNode[] }) {
  const flow = useMemo(() => toFlowNodes(tree), [tree]);
  return (
    <ReactFlowProvider>
      <ReactFlow
        nodes={flow.nodes}
        edges={flow.edges}
        nodeTypes={nodeTypes}
        fitView
        minZoom={0.25}
        maxZoom={1.5}
      >
        <Background gap={18} size={1} />
        <Controls />
      </ReactFlow>
    </ReactFlowProvider>
  );
}

// ---- HTML generation ----

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function generateDecisionTreeHtml(tree: DecisionTreeNode[]): string {
  const { nodes, edges } = toFlowNodes(tree);
  const NODE_W = 256;
  const NODE_MID_Y = 55; // estimated vertical midpoint for edge attachment
  const PAD = 60;

  const xs = nodes.map((n) => n.position.x);
  const ys = nodes.map((n) => n.position.y);
  const minX = Math.min(...xs) - PAD;
  const minY = Math.min(...ys) - PAD;
  const maxX = Math.max(...xs) + NODE_W + PAD;
  const maxY = Math.max(...ys) + NODE_MID_Y * 2 + PAD;
  const W = maxX - minX;
  const H = maxY - minY;

  const nodeMap = new Map(nodes.map((n) => [n.id, n]));

  const edgePaths = edges.map((e) => {
    const src = nodeMap.get(e.source);
    const tgt = nodeMap.get(e.target);
    if (!src || !tgt) return "";
    const x1 = src.position.x + NODE_W - minX;
    const y1 = src.position.y + NODE_MID_Y - minY;
    const x2 = tgt.position.x - minX;
    const y2 = tgt.position.y + NODE_MID_Y - minY;
    const mx = (x1 + x2) / 2;
    const stroke = e.animated ? "#10b981" : "#94a3b8";
    const dash = e.animated ? 'stroke-dasharray="6 3"' : "";
    return `<path d="M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2},${y2}" fill="none" stroke="${stroke}" stroke-width="1.5" ${dash}/>`;
  }).join("\n      ");

  const nodeHtml = nodes.map((n) => {
    const d = n.data as unknown as NodeData;
    const cls =
      d.kind === "root" ? "kind-root"
      : d.kind === "conclusion" ? "kind-conclusion"
      : d.kind === "factor" ? "kind-factor"
      : "kind-default";
    const left = n.position.x - minX;
    const top = n.position.y - minY;
    const body = escapeHtml(String(d.body ?? "")).replace(/\n/g, "<br>");
    return `  <div class="node ${cls}" style="left:${left}px;top:${top}px">
    <div class="node-title">${escapeHtml(String(d.title ?? ""))}</div>
    <div class="node-body">${body}</div>
  </div>`;
  }).join("\n");

  return `<!DOCTYPE html>
<html lang="zh">
<head>
<meta charset="UTF-8">
<title>决策树</title>
<style>
  body { margin: 0; padding: 24px; background: #f9fafb; }
  .canvas { position: relative; width: ${W}px; height: ${H}px; }
  .node {
    position: absolute; width: 256px; border-radius: 10px;
    padding: 10px 12px; border: 1.5px solid; box-sizing: border-box;
    box-shadow: 0 1px 3px rgba(0,0,0,.08);
    font-family: -apple-system, BlinkMacSystemFont, 'PingFang SC', 'Noto Sans CJK SC', 'Helvetica Neue', Arial, sans-serif;
  }
  .node-title { font-size: 12px; font-weight: 600; line-height: 1.4; }
  .node-body { font-size: 11px; line-height: 1.5; opacity: .8; margin-top: 6px; white-space: pre-wrap; }
  .kind-root { border-color: #bae6fd; background: #f0f9ff; color: #0c4a6e; }
  .kind-factor { border-color: #fde68a; background: #fffbeb; color: #78350f; }
  .kind-conclusion { border-color: #a7f3d0; background: #ecfdf5; color: #064e3b; }
  .kind-default { border-color: #e5e7eb; background: #ffffff; color: #1f2937; }
  .edges { position: absolute; top: 0; left: 0; pointer-events: none; overflow: visible; }
</style>
</head>
<body>
<div class="canvas">
  <svg class="edges" width="${W}" height="${H}">
    ${edgePaths}
  </svg>
${nodeHtml}
</div>
</body>
</html>`;
}

// ---- component ----

const DEFAULT_MODEL = "minimax-cn/MiniMax-M3";

export function DecisionTreePane({ scope, models }: { scope: Scope; models: PiModel[] }) {
  const [reports, setReports] = useState<ReportOption[]>([]);
  const [selectedReportId, setSelectedReportId] = useState("");
  const [content, setContent] = useState("");
  const [selectedModel, setSelectedModel] = useState(DEFAULT_MODEL);
  const [loadingReports, setLoadingReports] = useState(false);
  const [loadingContent, setLoadingContent] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState("");
  const [error, setError] = useState("");
  // Keep latest scope in ref so callbacks don't recreate on every parent render
  const scopeRef = useRef(scope);
  scopeRef.current = scope;

  const selectedReport = reports.find((r) => r.id === selectedReportId) ?? null;

  // Stable primitives extracted from scope — avoids object-reference churn
  const scopeType = scope.type;
  const scopeSessionId = scope.type === "session" ? scope.sessionId : null;
  const scopeFlowId = scope.type === "flow" ? scope.flow?.id ?? null : null;

  const taskKey = selectedReport
    ? "dtree:" + (scopeSessionId ?? scopeFlowId ?? "") + ":" + (selectedReport.runId ?? "") + ":" + selectedReport.path
    : "dtree:__inactive__";
  const task = useResumableTask<{ nodes: DecisionTreeNode[]; model: string }>(taskKey);
  const generating = task.status === "running";
  const tree = task.data?.nodes ?? [];

  useEffect(() => {
    if (models.some((item) => item.id === selectedModel)) return;
    const next = models.find((item) => item.id === DEFAULT_MODEL) ?? models.find((item) => item.isDefault) ?? models[0];
    if (next) setSelectedModel(next.id);
  }, [models, selectedModel]);

  const loadReports = useCallback(async () => {
    const sc = scopeRef.current;
    setLoadingReports(true);
    setError("");
    setReports([]);
    setSelectedReportId("");
    setContent("");
    try {
      if (sc.type === "session") {
        if (!sc.sessionId) return;
        const artifacts = await api.sessionArtifactTree(sc.sessionId);
        const next = flattenFiles(artifacts.tree)
          .filter(isReportFile)
          .map((f) => ({
            id: `session:${f.path}`,
            label: f.path,
            source: "session" as const,
            path: f.path,
          }));
        setReports(next);
        setSelectedReportId(next[0]?.id ?? "");
        return;
      }
      if (!sc.flow) return;
      const runs = await api.listFlowRuns(sc.flow.id);
      const found = await Promise.all(
        runs.map(async (run) => {
          const runTree = await api.flowRunTree(sc.flow!.id, run.id);
          return flattenFiles(runTree)
            .filter(isReportFile)
            .map((f) => ({
              id: `flow:${run.id}:${f.path}`,
              label: `${basenamePath(run.outputDir)} / ${f.path}`,
              source: "flow-run" as const,
              path: f.path,
              runId: run.id,
            }));
        }),
      );
      const next = found.flat();
      setReports(next);
      setSelectedReportId(next[0]?.id ?? "");
    } catch (err) {
      setError(String(err));
    } finally {
      setLoadingReports(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scopeType, scopeSessionId, scopeFlowId]);

  useEffect(() => {
    void loadReports();
  }, [loadReports]);

  useEffect(() => {
    setContent("");
    if (!selectedReport) return;
    const sc = scopeRef.current;
    setLoadingContent(true);
    setError("");
    const req =
      selectedReport.source === "session"
        ? sc.type === "session" && sc.sessionId
          ? api.sessionArtifactFileGet(sc.sessionId, selectedReport.path).then((r) => r.content ?? "")
          : Promise.resolve("")
        : sc.type === "flow" && sc.flow && selectedReport.runId
          ? api.flowRunFileGet(sc.flow.id, selectedReport.runId, selectedReport.path).then((r) => r.content)
          : Promise.resolve("");
    req.then(setContent).catch((err) => setError(String(err))).finally(() => setLoadingContent(false));
  // selectedReport identity is stable (new object only when id changes via select)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedReport?.id]);

  const generate = useCallback(async () => {
    const sc = scopeRef.current;
    if (!selectedReport || !content.trim() || generating) return;
    setError("");
    await task.start(async () => {
      const result = await api.generateDecisionTree({
        source: selectedReport.source,
        sessionId: sc.type === "session" ? sc.sessionId ?? undefined : undefined,
        flowId: sc.type === "flow" ? sc.flow?.id : undefined,
        runId: selectedReport.runId,
        path: selectedReport.path,
        model: selectedModel || DEFAULT_MODEL,
      });
      return { nodes: result.nodes, model: result.model };
    });
  }, [content, selectedModel, selectedReport, task, generating]);

  useEffect(() => {
    if (task.status !== "done" || !task.data) return;
    if (task.data.model) setSelectedModel((current) => current === task.data!.model ? current : task.data!.model);
  }, [task.status, task.data]);

  const saveAsImage = useCallback(async () => {
    if (tree.length === 0) return;
    const sc = scopeRef.current;
    setSaving(true);
    setSaveMsg("");
    setError("");
    try {
      const paths =
        sc.type === "session" && sc.sessionId
          ? await api.listSessionPaths(sc.sessionId, "report")
          : sc.type === "flow" && sc.flow
            ? await api.listFlowPaths(sc.flow.id, "report")
            : [];
      const dir = paths.find((p) => p.kind === "dir") ?? paths[0];
      if (!dir) {
        setError("未配置报告输出路径，请先在「报告输出」tab 添加文件夹");
        return;
      }
      const ts = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
      const base = selectedReport ? basenamePath(selectedReport.path).replace(/\.[^.]+$/, "") : "report";
      const relPath = `graphs/decision_tree_${base}_${ts}.html`;
      const html = generateDecisionTreeHtml(tree);
      const result = await api.workspacePathFilePut(dir.id, relPath, html);
      setSaveMsg(`已保存 → ${result.path}`);
    } catch (err) {
      setError(String(err));
    } finally {
      setSaving(false);
    }
  }, [tree, selectedReport]);

  const emptyHint =
    scope.type === "session"
      ? "当前探索任务尚未发现报告文件"
      : "当前工作流尚未发现 run 报告文件";

  return (
    <div className="flex h-full min-h-0 flex-col bg-white dark:bg-neutral-950">
      <div className="flex h-12 shrink-0 items-center gap-3 border-b border-neutral-200 px-4 dark:border-neutral-800">
        <div className="flex items-center gap-2 text-[13px] font-semibold text-neutral-900 dark:text-neutral-100">
          <GitBranch className="h-4 w-4 text-neutral-500" strokeWidth={1.75} />
          决策树
        </div>
        <select
          value={selectedReportId}
          onChange={(e) => setSelectedReportId(e.target.value)}
          disabled={loadingReports || reports.length === 0}
          className="h-8 min-w-0 flex-1 rounded-md border border-neutral-200 bg-transparent px-2 text-[12px] text-neutral-700 outline-none disabled:opacity-50 dark:border-neutral-700 dark:text-neutral-200"
        >
          {reports.length === 0 ? (
            <option value="">{loadingReports ? "正在扫描报告…" : emptyHint}</option>
          ) : (
            reports.map((r) => (
              <option key={r.id} value={r.id}>{r.label}</option>
            ))
          )}
        </select>
        <select
          value={selectedModel}
          onChange={(e) => setSelectedModel(e.target.value)}
          className="h-8 w-52 rounded-md border border-neutral-200 bg-transparent px-2 text-[12px] text-neutral-700 outline-none dark:border-neutral-700 dark:text-neutral-200"
        >
          {(models.length > 0 ? models : [{ id: DEFAULT_MODEL, provider: "minimax-cn", model: "MiniMax-M3", isDefault: true }]).map((item) => (
            <option key={item.id} value={item.id}>{item.id}</option>
          ))}
        </select>
        <button
          onClick={() => void loadReports()}
          disabled={loadingReports}
          className="inline-flex h-8 items-center gap-1.5 rounded-md px-2 text-[12px] text-neutral-500 hover:bg-neutral-100 disabled:opacity-50 dark:text-neutral-400 dark:hover:bg-neutral-800"
        >
          <RefreshCw className={cn("h-3.5 w-3.5", loadingReports && "animate-spin")} strokeWidth={1.75} />
          刷新
        </button>
        <button
          onClick={() => void saveAsImage()}
          disabled={tree.length === 0 || saving}
          title="保存为 SVG 图片到报告输出路径"
          className="inline-flex h-8 items-center gap-1.5 rounded-md px-2 text-[12px] text-neutral-500 hover:bg-neutral-100 disabled:opacity-50 dark:text-neutral-400 dark:hover:bg-neutral-800"
        >
          {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" strokeWidth={1.75} />}
          保存图片
        </button>
        <button
          onClick={() => void generate()}
          disabled={!selectedReport || !content.trim() || loadingContent || generating}
          className="inline-flex h-8 items-center gap-1.5 rounded-md bg-neutral-900 px-3 text-[12px] font-medium text-white hover:bg-neutral-700 disabled:opacity-50 dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-white"
        >
          {generating ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Sparkles className="h-3.5 w-3.5" strokeWidth={1.75} />
          )}
          生成决策树
        </button>
      </div>

      {(error || task.error) && (
        <div className="flex items-center gap-1.5 border-b border-rose-100 bg-rose-50 px-4 py-2 text-[12px] text-rose-600 dark:border-rose-950 dark:bg-rose-950/30 dark:text-rose-300">
          <AlertTriangle className="h-3.5 w-3.5" />
          {error || task.error}
        </div>
      )}
      {saveMsg && (
        <div className="flex items-center gap-1.5 border-b border-emerald-100 bg-emerald-50 px-4 py-2 text-[12px] text-emerald-700 dark:border-emerald-950 dark:bg-emerald-950/30 dark:text-emerald-300">
          {saveMsg}
        </div>
      )}

      <div className="min-h-0 flex-1">
        <main className="h-full min-w-0">
          {tree.length > 0 ? (
            <DecisionCanvas tree={tree} />
          ) : (
            <div className="flex h-full items-center justify-center text-[12px] text-neutral-400">
              选择报告并点击「生成决策树」查看推理过程
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
