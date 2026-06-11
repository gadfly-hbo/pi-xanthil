import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, Clock, FileText, Loader2, MessageSquareText, Pencil, RefreshCw, Sparkles, Wand2, GitCompare } from "lucide-react";
import { Markdown } from "@/components/Markdown";
import { api } from "@/lib/api";
import { useResumableTask } from "@/lib/resumableTask";
import type { FlowTreeNode, PiModel, WorkspacePath } from "@/types";

type Scope =
  | { type: "workspace"; workspaceId: string }
  | { type: "session"; sessionId: string }
  | { type: "flow"; flowId: string };

interface Props {
  scope: Scope | null;
  model?: string;
  models: PiModel[];
  onGenerated?: () => void;
}

interface ReportOption {
  id: string;
  label: string;
  pathId: number;
  relPath: string;
}

interface Annotation {
  quote: string;
  issue: string;
  suggestion: string;
  severity: "P0" | "P1" | "P2";
}

interface HistoryEntry {
  id: string;
  reportName: string;
  reviewedAt: number;
  model: string;
  totalScore: number;
  pathId: number;
  relPath: string;
  reviewMarkdown: string;
  annotations: Annotation[];
}

type ResultTab = "review" | "annotations" | "diff" | "edit";

interface ReviewTaskResult {
  content: string;
  annotations: Annotation[];
  totalScore: number;
  reportContent: string;
}

interface AutoFixTaskResult {
  path: string;
  content: string;
}

const DEFAULT_REVIEW_PROMPT = `你是一名专业的数据分析报告评审专家。请从以下维度对报告进行结构化评审：

1. 逻辑完整性：分析目标→数据→方法→发现→结论→建议的闭环是否完整？
2. 数据准确性：数据引用是否准确、可追溯？是否存在矛盾或错误？
3. 结论合理性：结论是否基于数据推导？有无过度推断？
4. 表达清晰度：结构是否清晰？关键信息是否突出？
5. 行动指导性：是否有明确可执行的下一步建议？

按"总体评价→分维度打分(每项X/10)→综合评分(XX/50)→P0/P1/P2修改建议→修改方向总结"的格式输出。`;

function isReportFile(name: string): boolean {
  return /\.(md|markdown|txt|html)$/i.test(name);
}

function flattenFiles(node: FlowTreeNode): FlowTreeNode[] {
  if (node.kind === "file") return [node];
  return (node.children ?? []).flatMap(flattenFiles);
}

function basenamePath(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).pop() ?? path;
}

function buildLineDiff(previous: string, current: string): string {
  const before = previous.split(/\r?\n/);
  const after = current.split(/\r?\n/);
  const dp = Array.from({ length: before.length + 1 }, () => Array<number>(after.length + 1).fill(0));
  const score = (i: number, j: number) => dp[i]?.[j] ?? 0;
  for (let i = before.length - 1; i >= 0; i -= 1) {
    for (let j = after.length - 1; j >= 0; j -= 1) {
      const row = dp[i];
      if (row) row[j] = (before[i] ?? "") === (after[j] ?? "") ? score(i + 1, j + 1) + 1 : Math.max(score(i + 1, j), score(i, j + 1));
    }
  }
  const out: string[] = [];
  let i = 0;
  let j = 0;
  while (i < before.length && j < after.length) {
    if (before[i] === after[j]) {
      out.push(`  ${before[i]}`);
      i += 1;
      j += 1;
    } else if (score(i + 1, j) >= score(i, j + 1)) {
      out.push(`- ${before[i]}`);
      i += 1;
    } else {
      out.push(`+ ${after[j]}`);
      j += 1;
    }
  }
  while (i < before.length) { out.push(`- ${before[i] ?? ""}`); i += 1; }
  while (j < after.length) { out.push(`+ ${after[j] ?? ""}`); j += 1; }
  return out.join("\n");
}

const SEVERITY_COLORS: Record<string, string> = {
  P0: "bg-rose-100 text-rose-700 dark:bg-rose-950 dark:text-rose-300",
  P1: "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300",
  P2: "bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300",
};

const SEVERITY_LABELS: Record<string, string> = {
  P0: "必须修改",
  P1: "建议修改",
  P2: "锦上添花",
};

const DEFAULT_MODEL = "minimax-cn/MiniMax-M3";

function defaultModelId(models: PiModel[]): string {
  return models.find((m) => m.id === DEFAULT_MODEL)?.id
    ?? models.find((m) => m.isDefault)?.id
    ?? models[0]?.id
    ?? DEFAULT_MODEL;
}

export function ReportReviewPane({ scope, model, models, onGenerated }: Props) {
  const [paths, setPaths] = useState<WorkspacePath[]>([]);
  const [reports, setReports] = useState<ReportOption[]>([]);
  const [selectedReportId, setSelectedReportId] = useState("");
  const [prompt, setPrompt] = useState(DEFAULT_REVIEW_PROMPT);
  const [reviewContent, setReviewContent] = useState("");
  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  const [totalScore, setTotalScore] = useState(0);
  const [originalContent, setOriginalContent] = useState("");
  const [fixedPath, setFixedPath] = useState("");
  const [fixedContent, setFixedContent] = useState("");
  const [editingContent, setEditingContent] = useState("");
  const [activeTab, setActiveTab] = useState<ResultTab>("review");
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [selectedModel, setSelectedModel] = useState(() => model || defaultModelId(models));

  const selectedReport = useMemo(
    () => reports.find((report) => report.id === selectedReportId) ?? null,
    [reports, selectedReportId],
  );

  const reviewKey = selectedReport
    ? "report-review:" + selectedReport.pathId + ":" + selectedReport.relPath
    : "report-review:__inactive__";
  const fixKey = selectedReport
    ? "report-autofix:" + selectedReport.pathId + ":" + selectedReport.relPath
    : "report-autofix:__inactive__";
  const reviewTask = useResumableTask<ReviewTaskResult>(reviewKey);
  const fixTask = useResumableTask<AutoFixTaskResult>(fixKey);
  const reviewing = reviewTask.status === "running";
  const fixing = fixTask.status === "running";


  useEffect(() => {
    if (model) setSelectedModel(model);
  }, [model]);

  useEffect(() => {
    if (!model && models.length > 0 && !models.some((m) => m.id === selectedModel)) {
      setSelectedModel(defaultModelId(models));
    }
  }, [models, model, selectedModel]);

  const isMdReport = useMemo(() => {
    if (!selectedReport) return false;
    return /\.(md|markdown|txt)$/i.test(selectedReport.label);
  }, [selectedReport]);

  const diffText = useMemo(() => {
    if (!originalContent || !fixedContent) return "";
    return buildLineDiff(originalContent, fixedContent);
  }, [originalContent, fixedContent]);

  const loadReports = useCallback(async () => {
    setLoading(true);
    setError("");
    setReviewContent("");
    setAnnotations([]);
    setTotalScore(0);
    setOriginalContent("");
    setFixedPath("");
    setFixedContent("");
    setEditingContent("");
    setActiveTab("review");
    setHistory([]);
    try {
      if (!scope) {
        setPaths([]);
        setReports([]);
        setSelectedReportId("");
        return;
      }
      const nextPaths = scope.type === "workspace"
        ? await api.listWorkspacePaths(scope.workspaceId, "report")
        : scope.type === "session"
          ? await api.listSessionPaths(scope.sessionId, "report")
          : await api.listFlowPaths(scope.flowId, "report");
      setPaths(nextPaths);
      const found = await Promise.all(nextPaths.map(async (path) => {
        if (path.kind === "file") {
          return isReportFile(path.path)
            ? [{ id: `${path.id}:`, label: basenamePath(path.path), pathId: path.id, relPath: "" }]
            : [];
        }
        const tree = await api.workspacePathTree(path.id);
        return flattenFiles(tree)
          .filter((file) => isReportFile(file.name))
          .map((file) => ({
            id: `${path.id}:${file.path}`,
            label: file.path,
            pathId: path.id,
            relPath: file.path,
          }));
      }));
      const nextReports = found.flat();
      setReports(nextReports);
      setSelectedReportId(nextReports[0]?.id ?? "");
    } catch (err) {
      setError(String(err));
      setReports([]);
      setSelectedReportId("");
    } finally {
      setLoading(false);
    }
  }, [scope]);

  useEffect(() => {
    void loadReports();
  }, [loadReports]);

  const loadHistory = useCallback(async () => {
    if (!selectedReport) return;
    try {
      const result = await api.listReviewHistory({
        pathId: selectedReport.pathId,
        relPath: selectedReport.relPath,
      });
      setHistory(result.entries);
    } catch {
      setHistory([]);
    }
  }, [selectedReport]);

  useEffect(() => {
    if (selectedReport) void loadHistory();
  }, [selectedReport, loadHistory]);

  const startReview = useCallback(async () => {
    if (!selectedReport || !prompt.trim() || reviewing) return;
    setError("");
    setReviewContent("");
    setAnnotations([]);
    setTotalScore(0);
    setOriginalContent("");
    setFixedPath("");
    setFixedContent("");
    setEditingContent("");
    setActiveTab("review");
    await reviewTask.start(async () => {
      const result = await api.reviewReport({
        pathId: selectedReport.pathId,
        relPath: selectedReport.relPath,
        prompt: prompt.trim(),
        model: selectedModel || undefined,
      });
      return {
        content: result.content,
        annotations: result.annotations ?? [],
        totalScore: result.totalScore ?? 0,
        reportContent: result.reportContent,
      };
    });
    void loadHistory();
  }, [reviewing, selectedModel, prompt, selectedReport, reviewTask, loadHistory]);

  useEffect(() => {
    if (reviewTask.status !== "done" || !reviewTask.data) return;
    const data = reviewTask.data;
    setReviewContent(data.content);
    setAnnotations(data.annotations);
    setTotalScore(data.totalScore);
    setOriginalContent(data.reportContent);
    setEditingContent(data.reportContent);
  }, [reviewTask.status, reviewTask.data]);

  const autoFix = useCallback(async () => {
    if (!selectedReport || !reviewContent || fixing) return;
    setError("");
    await fixTask.start(async () => {
      const result = await api.autoFixReport({
        pathId: selectedReport.pathId,
        relPath: selectedReport.relPath,
        reviewContent,
        prompt: prompt.trim(),
        model: selectedModel || undefined,
      });
      onGenerated?.();
      return { path: result.path, content: result.content };
    });
  }, [fixing, selectedModel, onGenerated, prompt, reviewContent, selectedReport, fixTask]);

  useEffect(() => {
    if (fixTask.status !== "done" || !fixTask.data) return;
    setFixedPath(fixTask.data.path);
    setFixedContent(fixTask.data.content);
    setEditingContent(fixTask.data.content);
    setActiveTab("diff");
  }, [fixTask.status, fixTask.data]);

  const saveManualEdit = useCallback(async () => {
    if (!selectedReport || !editingContent.trim()) return;
    try {
      await api.workspacePathFilePut(selectedReport.pathId, selectedReport.relPath, editingContent);
      onGenerated?.();
    } catch (err) {
      setError(String(err));
    }
  }, [editingContent, onGenerated, selectedReport]);

  const loadHistoryEntry = useCallback((entry: HistoryEntry) => {
    setReviewContent(entry.reviewMarkdown);
    setAnnotations(entry.annotations ?? []);
    setTotalScore(entry.totalScore ?? 0);
    setActiveTab("review");
  }, []);

  const emptyHint = paths.length === 0
    ? "请先在「报告输出」tab 添加报告输出文件夹或文件"
    : "报告输出路径中尚未发现 Markdown、HTML 或文本报告";

  return (
    <div className="flex h-full min-h-0 flex-col bg-white dark:bg-neutral-950">
      <div className="flex h-12 shrink-0 items-center gap-3 border-b border-neutral-200 px-4 dark:border-neutral-800">
        <div className="flex items-center gap-2 text-[13px] font-semibold text-neutral-900 dark:text-neutral-100">
          <FileText className="h-4 w-4 text-neutral-500" strokeWidth={1.75} />
          报告审核
        </div>
        <select
          value={selectedReportId}
          onChange={(event) => setSelectedReportId(event.target.value)}
          disabled={loading || reviewing || fixing || reports.length === 0}
          className="h-8 min-w-0 flex-1 rounded-md border border-neutral-200 bg-transparent px-2 text-[12px] text-neutral-700 outline-none disabled:opacity-50 dark:border-neutral-700 dark:text-neutral-200"
        >
          {reports.length === 0 ? (
            <option value="">{loading ? "正在扫描报告..." : emptyHint}</option>
          ) : (
            reports.map((report) => <option key={report.id} value={report.id}>{report.label}</option>)
          )}
        </select>
        <select
          value={selectedModel}
          onChange={(event) => setSelectedModel(event.target.value)}
          disabled={reviewing || fixing}
          className="h-8 w-52 rounded-md border border-neutral-200 bg-transparent px-2 text-[12px] text-neutral-700 outline-none disabled:opacity-50 dark:border-neutral-700 dark:text-neutral-200"
        >
          {(models.length > 0 ? models : [{ id: DEFAULT_MODEL, provider: "minimax-cn", model: "MiniMax-M3", isDefault: true }]).map((item) => (
            <option key={item.id} value={item.id}>{item.id}</option>
          ))}
        </select>
        <button
          onClick={() => void loadReports()}
          disabled={loading || reviewing || fixing}
          className="inline-flex h-8 items-center gap-1.5 rounded-md px-2 text-[12px] text-neutral-500 hover:bg-neutral-100 disabled:opacity-50 dark:text-neutral-400 dark:hover:bg-neutral-800"
        >
          <RefreshCw className={loading ? "h-3.5 w-3.5 animate-spin" : "h-3.5 w-3.5"} strokeWidth={1.75} />
          刷新
        </button>
        <button
          onClick={() => void startReview()}
          disabled={!selectedReport || !prompt.trim() || loading || reviewing}
          className="inline-flex h-8 items-center gap-1.5 rounded-md bg-neutral-900 px-3 text-[12px] font-medium text-white hover:bg-neutral-700 disabled:opacity-50 dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-white"
        >
          {reviewing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" strokeWidth={1.75} />}
          {reviewing ? "评审中..." : "开始评审"}
        </button>
      </div>

      {(error || reviewTask.error || fixTask.error) && (
        <div className="flex items-center gap-1.5 border-b border-rose-100 bg-rose-50 px-4 py-2 text-[12px] text-rose-600 dark:border-rose-950 dark:bg-rose-950/30 dark:text-rose-300">
          <AlertTriangle className="h-3.5 w-3.5" />
          {error || reviewTask.error || fixTask.error}
        </div>
      )}

      <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 p-6 lg:grid-cols-[minmax(280px,0.8fr)_minmax(0,1.2fr)]">
        <div className="flex min-h-0 flex-col gap-3">
          <div>
            <label className="text-[12px] font-medium text-neutral-700 dark:text-neutral-300">评审提示词</label>
            <textarea
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
              disabled={reviewing || fixing}
              className="mt-2 h-48 w-full resize-none rounded-lg border border-neutral-200 bg-white p-3 text-[12.5px] leading-5 text-neutral-800 outline-none focus:border-neutral-400 disabled:opacity-50 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-200 dark:focus:border-neutral-500"
            />
          </div>
          {reviewContent && (
            <div className="flex flex-col gap-2">
              {isMdReport && (
                <button
                  onClick={() => setActiveTab(activeTab === "edit" ? "review" : "edit")}
                  disabled={fixing}
                  className="inline-flex h-8 items-center justify-center gap-1.5 rounded-md border border-neutral-200 px-3 text-[12px] font-medium text-neutral-700 hover:bg-neutral-50 disabled:opacity-50 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800"
                >
                  <Pencil className="h-3.5 w-3.5" strokeWidth={1.75} />
                  {activeTab === "edit" ? "查看评审结果" : "手动编辑报告"}
                </button>
              )}
              <button
                onClick={() => void autoFix()}
                disabled={fixing}
                className="inline-flex h-8 items-center justify-center gap-1.5 rounded-md bg-neutral-900 px-3 text-[12px] font-medium text-white hover:bg-neutral-700 disabled:opacity-50 dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-white"
              >
                {fixing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Wand2 className="h-3.5 w-3.5" strokeWidth={1.75} />}
                {fixing ? "AI 修改中..." : "AI 自动修改"}
              </button>
            </div>
          )}
          <p className="text-[12px] leading-5 text-neutral-500 dark:text-neutral-400">
            评审提示词为空时使用系统内置的默认评审标准。
            {isMdReport && " Markdown 报告支持手动编辑和 AI 自动修改。"}
            {!isMdReport && " 该报告格式仅支持 AI 自动修改。"}
          </p>

          {history.length > 0 && (
            <div className="min-h-0 flex-1 overflow-auto">
              <div className="mb-2 flex items-center gap-1.5 text-[12px] font-medium text-neutral-700 dark:text-neutral-300">
                <Clock className="h-3.5 w-3.5" strokeWidth={1.75} />
                审核历史
              </div>
              <div className="flex flex-col gap-1">
                {history.map((entry) => (
                  <button
                    key={entry.id}
                    onClick={() => loadHistoryEntry(entry)}
                    className="flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-[12px] hover:bg-neutral-50 dark:hover:bg-neutral-800"
                  >
                    <span className="min-w-0 flex-1 truncate text-neutral-700 dark:text-neutral-300">
                      {new Date(entry.reviewedAt).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })}
                    </span>
                    <span className={entry.totalScore >= 40 ? "font-medium text-emerald-600 dark:text-emerald-400" : entry.totalScore >= 25 ? "font-medium text-amber-600 dark:text-amber-400" : "font-medium text-rose-600 dark:text-rose-400"}>
                      {entry.totalScore}/50
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="min-h-0 rounded-lg border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
          {activeTab === "edit" && isMdReport ? (
            <div className="flex h-full min-h-0 flex-col">
              <div className="mb-3 flex shrink-0 items-center justify-between gap-3">
                <span className="text-[12px] font-medium text-neutral-700 dark:text-neutral-300">编辑报告内容</span>
                <button
                  onClick={() => void saveManualEdit()}
                  className="inline-flex h-7 items-center gap-1 rounded-md bg-neutral-900 px-2.5 text-[11px] font-medium text-white hover:bg-neutral-700 dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-white"
                >
                  保存修改
                </button>
              </div>
              <textarea
                value={editingContent}
                onChange={(event) => setEditingContent(event.target.value)}
                className="min-h-0 flex-1 resize-none rounded-lg border border-neutral-200 bg-white p-3 font-mono text-[12.5px] leading-5 text-neutral-800 outline-none focus:border-neutral-400 dark:border-neutral-700 dark:bg-neutral-950 dark:text-neutral-200 dark:focus:border-neutral-500"
              />
            </div>
          ) : reviewContent ? (
            <div className="flex h-full min-h-0 flex-col">
              <div className="mb-3 flex shrink-0 items-center justify-between gap-3 border-b border-neutral-200 pb-2 dark:border-neutral-800">
                <div className="inline-flex h-8 rounded-md border border-neutral-200 bg-neutral-50 p-0.5 dark:border-neutral-700 dark:bg-neutral-950">
                  <button
                    onClick={() => setActiveTab("review")}
                    className={activeTab === "review"
                      ? "rounded px-2.5 text-[12px] font-medium text-neutral-900 shadow-sm dark:bg-neutral-800 dark:text-neutral-100"
                      : "rounded px-2.5 text-[12px] text-neutral-500 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-neutral-100"}
                  >
                    评审结果
                  </button>
                  <button
                    onClick={() => setActiveTab("annotations")}
                    className={activeTab === "annotations"
                      ? "rounded px-2.5 text-[12px] font-medium text-neutral-900 shadow-sm dark:bg-neutral-800 dark:text-neutral-100"
                      : "rounded px-2.5 text-[12px] text-neutral-500 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-neutral-100"}
                  >
                    <MessageSquareText className="mr-1 inline h-3 w-3" strokeWidth={1.75} />
                    行内批注
                    {annotations.length > 0 && (
                      <span className="ml-1 text-[11px] text-neutral-400">{annotations.length}</span>
                    )}
                  </button>
                  {fixedContent && (
                    <button
                      onClick={() => setActiveTab("diff")}
                      className={activeTab === "diff"
                        ? "rounded px-2.5 text-[12px] font-medium text-neutral-900 shadow-sm dark:bg-neutral-800 dark:text-neutral-100"
                        : "rounded px-2.5 text-[12px] text-neutral-500 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-neutral-100"}
                    >
                      <GitCompare className="mr-1 inline h-3 w-3" strokeWidth={1.75} />
                      修改对比
                    </button>
                  )}
                </div>
                <div className="flex items-center gap-3">
                  {totalScore > 0 && (
                    <span className={totalScore >= 40 ? "text-[12px] font-medium text-emerald-600 dark:text-emerald-400" : totalScore >= 25 ? "text-[12px] font-medium text-amber-600 dark:text-amber-400" : "text-[12px] font-medium text-rose-600 dark:text-rose-400"}>
                      {totalScore}/50
                    </span>
                  )}
                  {fixedPath && (
                    <span className="font-mono text-[11px] text-emerald-600 dark:text-emerald-400">
                      已保存: {fixedPath}
                    </span>
                  )}
                </div>
              </div>
              <div className="min-h-0 flex-1 overflow-auto">
                {activeTab === "review" && <Markdown>{reviewContent}</Markdown>}
                {activeTab === "annotations" && (
                  <div className="flex flex-col gap-3">
                    {annotations.length === 0 ? (
                      <p className="text-[12.5px] text-neutral-400">暂无行内批注</p>
                    ) : (
                      annotations.map((a, idx) => (
                        <div key={idx} className="rounded-lg border border-neutral-200 p-3 dark:border-neutral-700">
                          <div className="mb-2 flex items-center gap-2">
                            <span className={`inline-flex h-5 items-center rounded px-1.5 text-[11px] font-medium ${SEVERITY_COLORS[a.severity] ?? ""}`}>
                              {a.severity} {SEVERITY_LABELS[a.severity] ?? ""}
                            </span>
                          </div>
                          <blockquote className="mb-2 border-l-2 border-neutral-300 pl-3 text-[12px] italic text-neutral-600 dark:border-neutral-600 dark:text-neutral-400">
                            "{a.quote}"
                          </blockquote>
                          <div className="mb-1.5 text-[12px]">
                            <span className="font-medium text-rose-600 dark:text-rose-400">问题：</span>
                            <span className="text-neutral-700 dark:text-neutral-300">{a.issue}</span>
                          </div>
                          <div className="text-[12px]">
                            <span className="font-medium text-emerald-600 dark:text-emerald-400">建议：</span>
                            <span className="text-neutral-700 dark:text-neutral-300">{a.suggestion}</span>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                )}
                {activeTab === "diff" && (
                  <pre className="whitespace-pre-wrap font-mono text-[12px] leading-5 text-neutral-700 dark:text-neutral-300">
                    {diffText.split("\n").map((line, idx) => {
                      if (line.startsWith("- ")) {
                        return <div key={idx} className="bg-rose-50 text-rose-700 dark:bg-rose-950/30 dark:text-rose-300">{line}</div>;
                      }
                      if (line.startsWith("+ ")) {
                        return <div key={idx} className="bg-emerald-50 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-300">{line}</div>;
                      }
                      return <div key={idx} className="text-neutral-500 dark:text-neutral-500">{line}</div>;
                    })}
                  </pre>
                )}
              </div>
            </div>
          ) : (
            <p className="flex h-full items-center justify-center text-[12.5px] text-neutral-400">
              {reviewing ? "正在评审报告..." : "选择报告并点击「开始评审」"}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}