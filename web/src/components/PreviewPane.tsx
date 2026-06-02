import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, ArrowLeft, BarChart3, ChevronDown, ChevronRight, FileText, Folder, Loader2, PanelRightClose, RefreshCw, Table2 } from "lucide-react";
import { Markdown } from "@/components/Markdown";
import { api } from "@/lib/api";
import { cn } from "@/lib/cn";
import type { FlowTreeNode, SessionArtifactTree } from "@/types";

interface Props {
  sessionId: string;
  report: string;
  running: boolean;
  refreshKey: number;
  onCollapse: () => void;
}

interface PreviewFile {
  path: string;
  name: string;
  loading: boolean;
  previewable: boolean;
  content: string;
  truncated: boolean;
  size: number;
  error?: string;
}

function formatBytes(size: number): string {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}

function isMarkdown(name: string): boolean {
  return /\.(md|markdown)$/i.test(name);
}

function summarize(text: string): string {
  const compact = text.replace(/\s+/g, " ").trim();
  if (!compact) return "";
  return compact.length > 260 ? `${compact.slice(0, 260)}…` : compact;
}

function countFiles(node: FlowTreeNode | null): number {
  if (!node) return 0;
  if (node.kind === "file") return 1;
  return (node.children ?? []).reduce((sum, child) => sum + countFiles(child), 0);
}

function ArtifactNode({ node, depth, onOpen }: { node: FlowTreeNode; depth: number; onOpen: (path: string, name: string) => void }) {
  const [open, setOpen] = useState(depth < 1);
  const paddingLeft = `${6 + depth * 12}px`;
  if (node.kind === "file") {
    return (
      <button
        onClick={() => onOpen(node.path, node.name)}
        style={{ paddingLeft }}
        className="flex w-full items-center gap-1.5 rounded py-1 pr-2 text-left text-[11.5px] text-neutral-700 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-800"
      >
        <FileText className={cn("h-3.5 w-3.5 shrink-0", isMarkdown(node.name) ? "text-amber-500" : "text-neutral-400")} strokeWidth={1.75} />
        <span className="truncate">{node.name}</span>
      </button>
    );
  }
  return (
    <div>
      <button
        onClick={() => setOpen((current) => !current)}
        style={{ paddingLeft }}
        className="flex w-full items-center gap-1 rounded py-1 pr-2 text-left text-[11.5px] text-neutral-700 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-800"
      >
        {open ? <ChevronDown className="h-3 w-3 shrink-0" /> : <ChevronRight className="h-3 w-3 shrink-0" />}
        <Folder className="h-3.5 w-3.5 shrink-0 text-neutral-400" strokeWidth={1.75} />
        <span className="truncate">{node.name}</span>
      </button>
      {open && (node.children ?? []).map((child) => (
        <ArtifactNode key={child.path} node={child} depth={depth + 1} onOpen={onOpen} />
      ))}
    </div>
  );
}

export function PreviewPane({ sessionId, report, running, refreshKey, onCollapse }: Props) {
  const [artifacts, setArtifacts] = useState<SessionArtifactTree | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [file, setFile] = useState<PreviewFile | null>(null);
  const summary = useMemo(() => summarize(report), [report]);
  const fileCount = countFiles(artifacts?.tree ?? null);

  const load = useCallback(() => {
    setLoading(true);
    setError("");
    api.sessionArtifactTree(sessionId)
      .then(setArtifacts)
      .catch((err) => setError(String(err)))
      .finally(() => setLoading(false));
  }, [sessionId]);

  useEffect(() => {
    setFile(null);
    load();
  }, [load, refreshKey]);

  useEffect(() => {
    if (!running) return;
    const timer = window.setInterval(load, 4000);
    return () => window.clearInterval(timer);
  }, [load, running]);

  const openFile = useCallback((path: string, name: string) => {
    setFile({ path, name, loading: true, previewable: true, content: "", truncated: false, size: 0 });
    api.sessionArtifactFileGet(sessionId, path)
      .then((result) => setFile({ path, name: result.name, loading: false, previewable: result.previewable, content: result.content ?? "", truncated: result.truncated, size: result.size }))
      .catch((err) => setFile({ path, name, loading: false, previewable: false, content: "", truncated: false, size: 0, error: String(err) }));
  }, [sessionId]);

  return (
    <aside className="flex h-full w-[26rem] shrink-0 flex-col border-l border-neutral-200 dark:border-neutral-800">
      <div className="flex h-12 shrink-0 items-center justify-between px-4">
        <div className="flex items-center gap-2 text-[13px] font-medium text-neutral-900 dark:text-neutral-100">
          <FileText className="h-3.5 w-3.5 text-neutral-500 dark:text-neutral-400" strokeWidth={1.75} />
          成果
        </div>
        <div className="flex items-center gap-1">
          <button onClick={load} title="刷新成果" className="inline-flex h-7 w-7 items-center justify-center rounded-md text-neutral-500 hover:bg-neutral-100 dark:text-neutral-400 dark:hover:bg-neutral-800">
            <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} strokeWidth={1.75} />
          </button>
          <button onClick={onCollapse} title="收起成果" className="inline-flex h-7 w-7 items-center justify-center rounded-md text-neutral-500 hover:bg-neutral-100 dark:text-neutral-400 dark:hover:bg-neutral-800">
            <PanelRightClose className="h-4 w-4" strokeWidth={1.75} />
          </button>
        </div>
      </div>
      <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto px-4 pb-4">
        {file ? (
          <div>
            <button onClick={() => setFile(null)} className="mb-3 inline-flex items-center gap-1 text-[12px] text-neutral-500 hover:text-neutral-800 dark:text-neutral-400 dark:hover:text-neutral-100">
              <ArrowLeft className="h-3.5 w-3.5" /> 返回成果列表
            </button>
            <p className="truncate font-mono text-[12px] font-medium text-neutral-800 dark:text-neutral-200" title={file.path}>{file.name}</p>
            <p className="mb-3 mt-1 text-[11px] text-neutral-400">{formatBytes(file.size)}{file.truncated ? " · 内容已截断至 2 MB" : ""}</p>
            {file.loading ? <Loader2 className="mx-auto mt-12 h-5 w-5 animate-spin text-neutral-400" /> : file.error ? (
              <p className="text-[12px] text-rose-500">{file.error}</p>
            ) : !file.previewable ? (
              <p className="text-[12px] text-neutral-400">该文件类型暂不支持在线预览。</p>
            ) : isMarkdown(file.name) ? <Markdown>{file.content || "_（空文件）_"}</Markdown> : (
              <pre className="whitespace-pre-wrap break-words font-mono text-[12px] leading-5 text-neutral-700 dark:text-neutral-300">{file.content || "（空文件）"}</pre>
            )}
          </div>
        ) : (
          <>
            <div className="rounded-lg border border-neutral-200 p-3 dark:border-neutral-800">
              <div className="flex items-center justify-between text-[11.5px] text-neutral-500 dark:text-neutral-400">
                <span>{running ? "任务运行中" : "任务已空闲"}</span>
                <span>{fileCount} 个文件</span>
              </div>
              <p className="mt-2 truncate font-mono text-[10.5px] text-neutral-400" title={artifacts?.rootPath}>{artifacts?.rootPath ?? "正在解析输出目录…"}</p>
              {artifacts && !artifacts.hasConfiguredReportPath && (
                <p className="mt-2 flex items-start gap-1 text-[11px] leading-4 text-amber-600 dark:text-amber-400">
                  <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
                  未配置报告目录，当前使用{artifacts.source}。
                </p>
              )}
            </div>
            {summary && (
              <div className="mt-4">
                <h3 className="text-[12px] font-medium text-neutral-800 dark:text-neutral-200">最新结论摘要</h3>
                <p className="mt-1.5 text-[12px] leading-5 text-neutral-600 dark:text-neutral-400">{summary}</p>
              </div>
            )}
            <div className="mt-4">
              <h3 className="text-[12px] font-medium text-neutral-800 dark:text-neutral-200">产物文件</h3>
              <div className="mt-2">
                {loading && !artifacts ? <Loader2 className="mx-auto mt-8 h-5 w-5 animate-spin text-neutral-400" /> : error ? (
                  <p className="text-[11.5px] text-rose-500">{error}</p>
                ) : artifacts && (artifacts.tree.children?.length ?? 0) > 0 ? (
                  (artifacts.tree.children ?? []).map((node) => <ArtifactNode key={node.path} node={node} depth={0} onOpen={openFile} />)
                ) : (
                  <div className="pt-8 text-center text-[12px] text-neutral-400">
                    <div className="mb-4 flex justify-center gap-5">
                      <BarChart3 className="h-5 w-5" /><Table2 className="h-5 w-5" /><FileText className="h-5 w-5" />
                    </div>
                    任务生成的报告、表格和图表会显示在这里
                  </div>
                )}
              </div>
            </div>
          </>
        )}
      </div>
    </aside>
  );
}
