import { useCallback, useEffect, useMemo, useState } from "react";
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
import { AlertTriangle, FileText, GitBranch, Loader2, RefreshCw, Sparkles } from "lucide-react";
import { api } from "@/lib/api";
import { cn } from "@/lib/cn";
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

const DEFAULT_MODEL = "minimax-cn/MiniMax-M3";

export function DecisionTreePane({ scope, models }: { scope: Scope; models: PiModel[] }) {
  const [reports, setReports] = useState<ReportOption[]>([]);
  const [selectedReportId, setSelectedReportId] = useState("");
  const [content, setContent] = useState("");
  const [tree, setTree] = useState<DecisionTreeNode[]>([]);
  const [selectedModel, setSelectedModel] = useState(DEFAULT_MODEL);
  const [loadingReports, setLoadingReports] = useState(false);
  const [loadingContent, setLoadingContent] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState("");

  const selectedReport = reports.find((r) => r.id === selectedReportId) ?? null;

  useEffect(() => {
    if (models.some((item) => item.id === selectedModel)) return;
    const next = models.find((item) => item.id === DEFAULT_MODEL) ?? models.find((item) => item.isDefault) ?? models[0];
    if (next) setSelectedModel(next.id);
  }, [models, selectedModel]);

  const loadReports = useCallback(async () => {
    setLoadingReports(true);
    setError("");
    setReports([]);
    setSelectedReportId("");
    setContent("");
    setTree([]);
    try {
      if (scope.type === "session") {
        if (!scope.sessionId) return;
        const artifacts = await api.sessionArtifactTree(scope.sessionId);
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
      if (!scope.flow) return;
      const runs = await api.listFlowRuns(scope.flow.id);
      const found = await Promise.all(
        runs.map(async (run) => {
          const runTree = await api.flowRunTree(scope.flow!.id, run.id);
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
  }, [scope]);

  useEffect(() => {
    void loadReports();
  }, [loadReports]);

  useEffect(() => {
    setContent("");
    setTree([]);
    if (!selectedReport) return;
    setLoadingContent(true);
    setError("");
    const req =
      selectedReport.source === "session"
        ? scope.type === "session" && scope.sessionId
          ? api.sessionArtifactFileGet(scope.sessionId, selectedReport.path).then((r) => r.content ?? "")
          : Promise.resolve("")
        : scope.type === "flow" && scope.flow && selectedReport.runId
          ? api.flowRunFileGet(scope.flow.id, selectedReport.runId, selectedReport.path).then((r) => r.content)
          : Promise.resolve("");
    req.then(setContent).catch((err) => setError(String(err))).finally(() => setLoadingContent(false));
  }, [scope, selectedReport]);

  const generate = useCallback(async () => {
    if (!selectedReport || !content.trim()) return;
    setGenerating(true);
    setError("");
    try {
      const result = await api.generateDecisionTree({
        source: selectedReport.source,
        sessionId: scope.type === "session" ? scope.sessionId ?? undefined : undefined,
        flowId: scope.type === "flow" ? scope.flow?.id : undefined,
        runId: selectedReport.runId,
        path: selectedReport.path,
        model: selectedModel || DEFAULT_MODEL,
      });
      setTree(result.nodes);
      setSelectedModel(result.model);
    } catch (err) {
      setError(String(err));
    } finally {
      setGenerating(false);
    }
  }, [content, scope, selectedModel, selectedReport]);

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

      {error && (
        <div className="flex items-center gap-1.5 border-b border-rose-100 bg-rose-50 px-4 py-2 text-[12px] text-rose-600 dark:border-rose-950 dark:bg-rose-950/30 dark:text-rose-300">
          <AlertTriangle className="h-3.5 w-3.5" />
          {error}
        </div>
      )}

      <div className="flex min-h-0 flex-1">
        <aside className="w-80 shrink-0 border-r border-neutral-200 p-4 dark:border-neutral-800">
          <div className="flex items-center gap-2 text-[12px] font-medium text-neutral-700 dark:text-neutral-200">
            <FileText className="h-3.5 w-3.5 text-neutral-400" strokeWidth={1.75} />
            报告内容预览
          </div>
          <div className="mt-3 h-[calc(100%-2rem)] overflow-y-auto rounded-lg border border-neutral-200 bg-neutral-50 p-3 text-[11.5px] leading-5 text-neutral-600 dark:border-neutral-800 dark:bg-neutral-900/60 dark:text-neutral-300">
            {loadingContent ? (
              <Loader2 className="mx-auto mt-12 h-5 w-5 animate-spin text-neutral-400" />
            ) : content ? (
              content.slice(0, 3000)
            ) : (
              "请选择报告后生成决策树。"
            )}
          </div>
        </aside>
        <main className="min-w-0 flex-1">
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
