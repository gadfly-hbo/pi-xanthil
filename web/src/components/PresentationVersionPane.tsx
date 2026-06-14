import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, FileText, Loader2, RefreshCw, Sparkles } from "lucide-react";
import { Markdown } from "@/components/Markdown";
import { useBusinessRequirementContexts } from "@/components/useBusinessRequirementContexts";
import { api } from "@/lib/api";
import { useResumableTask } from "@/lib/resumableTask";
import type { FlowTreeNode, WorkspacePath } from "@/types";

type Scope =
  | { type: "workspace"; workspaceId: string }
  | { type: "session"; sessionId: string }
  | { type: "flow"; flowId: string };

interface Props {
  scope: Scope | null;
  model?: string;
  onGenerated?: () => void;
}

interface ReportOption {
  id: string;
  label: string;
  pathId: number;
  relPath: string;
}

const DEFAULT_PROMPT = "请基于原详细报告，提炼一份用于汇报和沟通的简化 Markdown 版本。保留核心结论、关键数据支撑、风险与下一步建议，语言简洁清晰。";

interface PresentationTaskResult {
  path: string;
  content: string;
  storylinePath: string;
  storylineHtml: string;
}

function isReportFile(name: string): boolean {
  return /\.(md|markdown|txt)$/i.test(name);
}

function flattenFiles(node: FlowTreeNode): FlowTreeNode[] {
  if (node.kind === "file") return [node];
  return (node.children ?? []).flatMap(flattenFiles);
}

function basenamePath(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).pop() ?? path;
}

function displayGenerateError(error: unknown): string {
  const message = String(error);
  if (message.includes("LLM response is not valid JSON")) {
    return "模型输出格式不符合要求，已无法自动修复。请缩短原报告或提示词后重试。";
  }
  return message;
}

export function PresentationVersionPane({ scope, model, onGenerated }: Props) {
  const {
    contexts: businessRequirementContexts,
    selectedId: selectedBusinessRequirementId,
    setSelectedId: setSelectedBusinessRequirementId,
    selectedContext: selectedBusinessRequirement,
    loading: loadingBusinessRequirementContexts,
  } = useBusinessRequirementContexts(scope);
  const [paths, setPaths] = useState<WorkspacePath[]>([]);
  const [reports, setReports] = useState<ReportOption[]>([]);
  const [selectedReportId, setSelectedReportId] = useState("");
  const [prompt, setPrompt] = useState(DEFAULT_PROMPT);
  const [generatedPath, setGeneratedPath] = useState("");
  const [generatedContent, setGeneratedContent] = useState("");
  const [storylinePath, setStorylinePath] = useState("");
  const [storylineHtml, setStorylineHtml] = useState("");
  const [activeResult, setActiveResult] = useState<"presentation" | "storyline">("presentation");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const scopeKeyPart = scope
    ? scope.type === "workspace" ? scope.workspaceId
      : scope.type === "session" ? scope.sessionId
      : scope.flowId
    : "__no_scope__";
  const task = useResumableTask<PresentationTaskResult>("presentation:" + scopeKeyPart);
  const generating = task.status === "running";

  const selectedReport = useMemo(
    () => reports.find((report) => report.id === selectedReportId) ?? null,
    [reports, selectedReportId],
  );

  const loadReports = useCallback(async () => {
    setLoading(true);
    setError("");
    setGeneratedPath("");
    setGeneratedContent("");
    setStorylinePath("");
    setStorylineHtml("");
    setActiveResult("presentation");
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

  const generate = useCallback(async () => {
    if (!selectedReport || !prompt.trim() || generating) return;
    setError("");
    setGeneratedPath("");
    setGeneratedContent("");
    setStorylinePath("");
    setStorylineHtml("");
    setActiveResult("presentation");
    await task.start(async () => {
      const result = await api.generatePresentationVersion({
        pathId: selectedReport.pathId,
        relPath: selectedReport.relPath,
        prompt: prompt.trim(),
        model: model || undefined,
        businessRequirementContext: selectedBusinessRequirement ? {
          pathId: selectedBusinessRequirement.pathId,
          markdownPath: selectedBusinessRequirement.markdownPath,
          jsonPath: selectedBusinessRequirement.jsonPath,
        } : undefined,
      });
      onGenerated?.();
      return {
        path: result.path,
        content: result.content,
        storylinePath: result.storylinePath,
        storylineHtml: result.storylineHtml,
      };
    });
  }, [generating, model, onGenerated, prompt, selectedBusinessRequirement, selectedReport, task]);

  useEffect(() => {
    if (task.status !== "done" || !task.data) return;
    setGeneratedPath(task.data.path);
    setGeneratedContent(task.data.content);
    setStorylinePath(task.data.storylinePath);
    setStorylineHtml(task.data.storylineHtml);
  }, [task.status, task.data]);

  const emptyHint = paths.length === 0
    ? "请先在「报告输出」tab 添加报告输出文件夹或文件"
    : "报告输出路径中尚未发现 Markdown 或文本报告（请先在「报告输出」tab 添加文件夹或文件）";

  return (
    <div className="flex h-full min-h-0 flex-col bg-white dark:bg-neutral-950">
      <div className="flex h-12 shrink-0 items-center gap-3 border-b border-neutral-200 px-4 dark:border-neutral-800">
        <div className="flex items-center gap-2 text-[13px] font-semibold text-neutral-900 dark:text-neutral-100">
          <FileText className="h-4 w-4 text-neutral-500" strokeWidth={1.75} />
          汇报版本
        </div>
        <select
          value={selectedReportId}
          onChange={(event) => setSelectedReportId(event.target.value)}
          disabled={loading || generating || reports.length === 0}
          className="h-8 min-w-0 flex-1 rounded-md border border-neutral-200 bg-transparent px-2 text-[12px] text-neutral-700 outline-none disabled:opacity-50 dark:border-neutral-700 dark:text-neutral-200"
        >
          {reports.length === 0 ? (
            <option value="">{loading ? "正在扫描报告..." : emptyHint}</option>
          ) : (
            reports.map((report) => <option key={report.id} value={report.id}>{report.label}</option>)
          )}
        </select>
        <button
          onClick={() => void loadReports()}
          disabled={loading || generating}
          className="inline-flex h-8 items-center gap-1.5 rounded-md px-2 text-[12px] text-neutral-500 hover:bg-neutral-100 disabled:opacity-50 dark:text-neutral-400 dark:hover:bg-neutral-800"
        >
          <RefreshCw className={loading ? "h-3.5 w-3.5 animate-spin" : "h-3.5 w-3.5"} strokeWidth={1.75} />
          刷新
        </button>
        <button
          onClick={() => void generate()}
          disabled={!selectedReport || !prompt.trim() || loading || generating}
          className="inline-flex h-8 items-center gap-1.5 rounded-md bg-neutral-900 px-3 text-[12px] font-medium text-white hover:bg-neutral-700 disabled:opacity-50 dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-white"
        >
          {generating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" strokeWidth={1.75} />}
          {generating ? "生成中..." : "生成汇报版本"}
        </button>
      </div>

      {(error || task.error) && (
        <div className="flex items-center gap-1.5 border-b border-rose-100 bg-rose-50 px-4 py-2 text-[12px] text-rose-600 dark:border-rose-950 dark:bg-rose-950/30 dark:text-rose-300">
          <AlertTriangle className="h-3.5 w-3.5" />
          {error || (task.error ? displayGenerateError(task.error) : "")}
        </div>
      )}

      <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 p-6 lg:grid-cols-[minmax(280px,0.8fr)_minmax(0,1.2fr)]">
        <div className="flex min-h-0 flex-col gap-3">
          <div>
            <label className="text-[12px] font-medium text-neutral-700 dark:text-neutral-300">业务需求上下文</label>
            <select
              value={selectedBusinessRequirementId}
              onChange={(event) => setSelectedBusinessRequirementId(event.target.value)}
              disabled={generating || loadingBusinessRequirementContexts || businessRequirementContexts.length === 0}
              className="mt-2 h-9 w-full rounded-md border border-neutral-200 bg-white px-2.5 text-[12.5px] text-neutral-700 outline-none disabled:opacity-50 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-200"
            >
              <option value="">{loadingBusinessRequirementContexts ? "正在读取业务需求..." : "不使用业务需求"}</option>
              {businessRequirementContexts.map((item) => (
                <option key={item.id} value={item.id}>{item.label}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-[12px] font-medium text-neutral-700 dark:text-neutral-300">提示词</label>
            <textarea
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
              disabled={generating}
              className="mt-2 h-56 w-full resize-none rounded-lg border border-neutral-200 bg-white p-3 text-[12.5px] leading-5 text-neutral-800 outline-none focus:border-neutral-400 disabled:opacity-50 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-200 dark:focus:border-neutral-500"
            />
          </div>
          <p className="text-[12px] leading-5 text-neutral-500 dark:text-neutral-400">
            生成结果会同时保存为 Markdown 汇报稿和 HTML 故事线，位置在「报告输出」已登记路径下的 presentation_versions 目录。
          </p>
        </div>

        <div className="min-h-0 rounded-lg border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
          {generatedContent || storylineHtml ? (
            <div className="flex h-full min-h-0 flex-col">
              <div className="mb-3 flex shrink-0 items-center justify-between gap-3 border-b border-neutral-200 pb-2 dark:border-neutral-800">
                <div className="inline-flex h-8 rounded-md border border-neutral-200 bg-neutral-50 p-0.5 dark:border-neutral-700 dark:bg-neutral-950">
                  <button
                    onClick={() => setActiveResult("presentation")}
                    className={activeResult === "presentation"
                      ? "rounded px-2.5 text-[12px] font-medium text-neutral-900 shadow-sm dark:bg-neutral-800 dark:text-neutral-100"
                      : "rounded px-2.5 text-[12px] text-neutral-500 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-neutral-100"}
                  >
                    汇报版本
                  </button>
                  <button
                    onClick={() => setActiveResult("storyline")}
                    className={activeResult === "storyline"
                      ? "rounded px-2.5 text-[12px] font-medium text-neutral-900 shadow-sm dark:bg-neutral-800 dark:text-neutral-100"
                      : "rounded px-2.5 text-[12px] text-neutral-500 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-neutral-100"}
                  >
                    故事线
                  </button>
                </div>
                <p
                  className="min-w-0 flex-1 truncate text-right font-mono text-[12px] font-medium text-neutral-700 dark:text-neutral-300"
                  title={activeResult === "presentation" ? generatedPath : storylinePath}
                >
                  {activeResult === "presentation" ? generatedPath : storylinePath}
                </p>
              </div>
              <div className="min-h-0 flex-1 overflow-auto">
                {activeResult === "presentation" ? (
                  <Markdown>{generatedContent}</Markdown>
                ) : (
                  <iframe
                    title="故事线预览"
                    srcDoc={storylineHtml}
                    sandbox=""
                    className="h-full min-h-[520px] w-full rounded-md border border-neutral-200 bg-white dark:border-neutral-700"
                  />
                )}
              </div>
            </div>
          ) : (
            <p className="flex h-full items-center justify-center text-[12.5px] text-neutral-400">
              {generating ? "正在生成汇报版本和故事线..." : "生成后在这里预览"}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
