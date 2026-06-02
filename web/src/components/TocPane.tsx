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
import { AlertTriangle, FileText, Gauge, GitFork, Loader2, RefreshCw, Sparkles, Target } from "lucide-react";
import { api, type TocGraphItem } from "@/lib/api";
import { cn } from "@/lib/cn";
import type { Flow, FlowTreeNode, PiModel } from "@/types";

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

type NodeData = Pick<TocGraphItem, "title" | "body" | "kind">;

const DEFAULT_TOC_MODEL = "minimax-cn/MiniMax-M3";

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

function toFlowNodes(items: TocGraphItem[]): { nodes: Node[]; edges: Edge[] } {
  const depthOf = (item: TocGraphItem): number => {
    if (!item.parentId) return 0;
    const parent = items.find((candidate) => candidate.id === item.parentId);
    return parent ? depthOf(parent) + 1 : 0;
  };
  const levels = new Map<number, TocGraphItem[]>();
  items.forEach((item) => {
    const depth = depthOf(item);
    levels.set(depth, [...(levels.get(depth) ?? []), item]);
  });
  const nodes: Node[] = items.map((item) => {
    const depth = depthOf(item);
    const level = levels.get(depth) ?? [];
    const index = level.findIndex((candidate) => candidate.id === item.id);
    return {
      id: item.id,
      type: "toc",
      position: { x: 50 + depth * 310, y: 70 + index * 150 },
      data: { title: item.title, body: item.body, kind: item.kind } satisfies NodeData,
    };
  });
  const edges: Edge[] = items
    .filter((item) => item.parentId)
    .map((item) => ({
      id: `${item.parentId}-${item.id}`,
      source: item.parentId!,
      target: item.id,
      type: "smoothstep",
      animated: item.kind === "constraint" || item.kind === "monitor",
    }));
  return { nodes, edges };
}

function TocCard({ data }: NodeProps) {
  const d = data as unknown as NodeData;
  const theme =
    d.kind === "goal"
      ? "border-sky-200 bg-sky-50 text-sky-950 dark:border-sky-900 dark:bg-sky-950/30 dark:text-sky-100"
      : d.kind === "constraint"
        ? "border-rose-200 bg-rose-50 text-rose-950 dark:border-rose-900 dark:bg-rose-950/30 dark:text-rose-100"
        : d.kind === "root_cause"
          ? "border-amber-200 bg-amber-50 text-amber-950 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-100"
          : d.kind === "action"
            ? "border-emerald-200 bg-emerald-50 text-emerald-950 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-100"
            : d.kind === "monitor"
              ? "border-violet-200 bg-violet-50 text-violet-950 dark:border-violet-900 dark:bg-violet-950/30 dark:text-violet-100"
              : "border-neutral-200 bg-white text-neutral-800 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-200";
  const Icon = d.kind === "goal" ? Target : d.kind === "monitor" ? Gauge : GitFork;
  return (
    <div className={cn("w-64 rounded-xl border px-3 py-2 shadow-sm", theme)}>
      <Handle type="target" position={Position.Left} className="!h-2 !w-2 !border-none !bg-neutral-400" />
      <div className="flex items-center gap-1.5 text-[12px] font-semibold">
        <Icon className="h-3.5 w-3.5 shrink-0" strokeWidth={1.75} />
        <span className="truncate">{d.title}</span>
      </div>
      <p className="mt-1.5 line-clamp-5 whitespace-pre-line text-[11px] leading-4 opacity-80">{d.body}</p>
      <Handle type="source" position={Position.Right} className="!h-2 !w-2 !border-none !bg-neutral-400" />
    </div>
  );
}

const nodeTypes = { toc: TocCard };

function TocCanvas({ graph }: { graph: TocGraphItem[] }) {
  const flow = useMemo(() => toFlowNodes(graph), [graph]);
  return (
    <ReactFlowProvider>
      <ReactFlow nodes={flow.nodes} edges={flow.edges} nodeTypes={nodeTypes} fitView minZoom={0.2} maxZoom={1.5}>
        <Background gap={18} size={1} />
        <Controls />
      </ReactFlow>
    </ReactFlowProvider>
  );
}

function defaultModelId(models: PiModel[]): string {
  return models.find((model) => model.id === DEFAULT_TOC_MODEL)?.id
    ?? models.find((model) => model.isDefault)?.id
    ?? models[0]?.id
    ?? DEFAULT_TOC_MODEL;
}

export function TocPane({ scope, models }: { scope: Scope; models: PiModel[] }) {
  const [reports, setReports] = useState<ReportOption[]>([]);
  const [selectedReportId, setSelectedReportId] = useState("");
  const [content, setContent] = useState("");
  const [graph, setGraph] = useState<TocGraphItem[]>([]);
  const [model, setModel] = useState(DEFAULT_TOC_MODEL);
  const [loadingReports, setLoadingReports] = useState(false);
  const [loadingContent, setLoadingContent] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState("");

  const selectedReport = reports.find((report) => report.id === selectedReportId) ?? null;

  useEffect(() => {
    if (models.some((item) => item.id === model)) return;
    setModel(defaultModelId(models));
  }, [model, models]);

  const loadReports = useCallback(async () => {
    setLoadingReports(true);
    setError("");
    setReports([]);
    setSelectedReportId("");
    setContent("");
    setGraph([]);
    try {
      if (scope.type === "session") {
        if (!scope.sessionId) return;
        const artifacts = await api.sessionArtifactTree(scope.sessionId);
        const next = flattenFiles(artifacts.tree)
          .filter(isReportFile)
          .map((file) => ({
            id: `session:${file.path}`,
            label: file.path,
            source: "session" as const,
            path: file.path,
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
            .map((file) => ({
              id: `flow:${run.id}:${file.path}`,
              label: `${basenamePath(run.outputDir)} / ${file.path}`,
              source: "flow-run" as const,
              path: file.path,
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
    setGraph([]);
    if (!selectedReport) return;
    setLoadingContent(true);
    setError("");
    const req =
      selectedReport.source === "session"
        ? scope.type === "session" && scope.sessionId
          ? api.sessionArtifactFileGet(scope.sessionId, selectedReport.path).then((result) => result.content ?? "")
          : Promise.resolve("")
        : scope.type === "flow" && scope.flow && selectedReport.runId
          ? api.flowRunFileGet(scope.flow.id, selectedReport.runId, selectedReport.path).then((result) => result.content)
          : Promise.resolve("");
    req.then(setContent).catch((err) => setError(String(err))).finally(() => setLoadingContent(false));
  }, [scope, selectedReport]);

  const generate = useCallback(async () => {
    if (!selectedReport || !content.trim() || generating) return;
    setGenerating(true);
    setError("");
    try {
      const result = await api.generateTocGraph({
        reportName: basenamePath(selectedReport.path),
        content,
        model: model || DEFAULT_TOC_MODEL,
        sessionId: scope.type === "session" ? scope.sessionId ?? undefined : undefined,
        flowId: scope.type === "flow" ? scope.flow?.id : undefined,
      });
      setGraph(result.nodes);
      if (result.model) setModel(result.model);
    } catch (err) {
      setError(String(err));
    } finally {
      setGenerating(false);
    }
  }, [content, generating, model, scope, selectedReport]);

  const emptyHint =
    scope.type === "session"
      ? "当前探索任务尚未发现报告文件"
      : "当前工作流尚未发现 run 报告文件";

  return (
    <div className="flex h-full min-h-0 flex-col bg-white dark:bg-neutral-950">
      <div className="flex h-12 shrink-0 items-center gap-3 border-b border-neutral-200 px-4 dark:border-neutral-800">
        <div className="flex items-center gap-2 text-[13px] font-semibold text-neutral-900 dark:text-neutral-100">
          <GitFork className="h-4 w-4 text-neutral-500" strokeWidth={1.75} />
          TOC约束推理图
        </div>
        <select
          value={selectedReportId}
          onChange={(event) => setSelectedReportId(event.target.value)}
          disabled={loadingReports || reports.length === 0 || generating}
          className="h-8 min-w-0 flex-1 rounded-md border border-neutral-200 bg-transparent px-2 text-[12px] text-neutral-700 outline-none disabled:opacity-50 dark:border-neutral-700 dark:text-neutral-200"
        >
          {reports.length === 0 ? (
            <option value="">{loadingReports ? "正在扫描报告…" : emptyHint}</option>
          ) : (
            reports.map((report) => (
              <option key={report.id} value={report.id}>{report.label}</option>
            ))
          )}
        </select>
        <select
          value={model}
          onChange={(event) => setModel(event.target.value)}
          disabled={generating}
          className="h-8 w-52 rounded-md border border-neutral-200 bg-transparent px-2 text-[12px] text-neutral-700 outline-none disabled:opacity-50 dark:border-neutral-700 dark:text-neutral-200"
        >
          {models.length === 0 ? (
            <option value={DEFAULT_TOC_MODEL}>MiniMax-M3</option>
          ) : (
            models.map((item) => (
              <option key={item.id} value={item.id}>{item.id}</option>
            ))
          )}
        </select>
        <button
          onClick={() => void loadReports()}
          disabled={loadingReports || generating}
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
          {generating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" strokeWidth={1.75} />}
          {generating ? "模型推理中…" : "生成TOC推理图"}
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
              "请选择报告后生成 TOC 约束推理图。"
            )}
          </div>
        </aside>
        <main className="min-w-0 flex-1">
          {graph.length > 0 ? (
            <TocCanvas graph={graph} />
          ) : (
            <div className="flex h-full items-center justify-center px-6 text-center text-[12px] leading-5 text-neutral-400">
              选择报告、选择模型并点击「生成TOC推理图」；模型会基于报告理解推理出目标、症状、主约束、根因链、五步法动作与监控指标
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
