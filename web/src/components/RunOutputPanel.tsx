import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Circle,
  Eye,
  FileText,
  Folder,
  Loader2,
  Pencil,
  RefreshCw,
  Save,
  XCircle,
} from "lucide-react";
import { Markdown } from "@/components/Markdown";
import { api } from "@/lib/api";
import { cn } from "@/lib/cn";
import type { FlowRun, FlowTreeNode } from "@/types";

interface Props {
  flowId: string;
  runs: FlowRun[];
  /** Client-side runId (basename of outputDir) of the active/just-finished run. */
  currentRunId: string | null;
  running: boolean;
  requestedFile?: { path: string; nonce: number } | null;
}

interface FileState {
  path: string;
  name: string;
  loading: boolean;
  content: string;
  draft: string;
  truncated: boolean;
  size: number;
  editing: boolean;
  saving: boolean;
  dirty: boolean;
  error?: string;
}

function basename(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).at(-1) ?? path;
}

function isMarkdown(name: string): boolean {
  const lower = name.toLowerCase();
  return lower.endsWith(".md") || lower.endsWith(".markdown");
}

/** Files that look like a final report float to the eye with a subtle accent. */
function isReportish(name: string): boolean {
  return /report|报告|result|结论|summary/i.test(name) || isMarkdown(name);
}

function RunFileTree({
  node,
  depth,
  selectedPath,
  onSelect,
}: {
  node: FlowTreeNode;
  depth: number;
  selectedPath: string | null;
  onSelect: (path: string, name: string) => void;
}) {
  const [open, setOpen] = useState(depth < 1);
  const paddingLeft = `${8 + depth * 12}px`;

  if (node.kind === "file") {
    const active = selectedPath === node.path;
    return (
      <button
        onClick={() => onSelect(node.path, node.name)}
        style={{ paddingLeft }}
        className={cn(
          "flex w-full items-center gap-1.5 rounded py-1 pr-2 text-left text-[11.5px]",
          active
            ? "bg-sky-100 text-sky-900 dark:bg-sky-950/40 dark:text-sky-200"
            : "text-neutral-700 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-800",
        )}
      >
        <FileText
          className={cn("h-3.5 w-3.5 shrink-0", isReportish(node.name) ? "text-amber-500" : "text-neutral-400")}
          strokeWidth={1.75}
        />
        <span className="truncate">{node.name}</span>
      </button>
    );
  }

  const children = node.children ?? [];
  return (
    <div>
      <button
        onClick={() => setOpen((v) => !v)}
        style={{ paddingLeft }}
        className="flex w-full items-center gap-1 rounded py-1 pr-2 text-left text-[11.5px] text-neutral-700 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-800"
      >
        {open ? <ChevronDown className="h-3 w-3 shrink-0" /> : <ChevronRight className="h-3 w-3 shrink-0" />}
        <Folder className="h-3.5 w-3.5 shrink-0 text-neutral-400" strokeWidth={1.75} />
        <span className="truncate">{node.name}</span>
      </button>
      {open && children.map((child) => (
        <RunFileTree key={child.path} node={child} depth={depth + 1} selectedPath={selectedPath} onSelect={onSelect} />
      ))}
    </div>
  );
}

export function RunOutputPanel(p: Props) {
  // Resolve the DB run row to query (tree/file APIs key off run.id).
  const currentRun = useMemo(
    () => (p.currentRunId ? p.runs.find((r) => basename(r.outputDir) === p.currentRunId) ?? null : null),
    [p.runs, p.currentRunId],
  );
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const selectedRun = useMemo(
    () => p.runs.find((r) => r.id === selectedRunId) ?? currentRun ?? p.runs[0] ?? null,
    [p.runs, selectedRunId, currentRun],
  );

  const [tree, setTree] = useState<FlowTreeNode | null>(null);
  const [treeLoading, setTreeLoading] = useState(false);
  const [treeError, setTreeError] = useState<string | null>(null);
  const [file, setFile] = useState<FileState | null>(null);

  const runId = selectedRun?.id ?? null;

  const loadTree = useCallback(() => {
    if (!runId) {
      setTree(null);
      return;
    }
    setTreeLoading(true);
    setTreeError(null);
    api.flowRunTree(p.flowId, runId)
      .then((t) => setTree(t))
      .catch((err) => setTreeError(String(err)))
      .finally(() => setTreeLoading(false));
  }, [p.flowId, runId]);

  // Reload the tree when the run changes or the run is still producing files.
  useEffect(() => {
    loadTree();
  }, [loadTree]);

  useEffect(() => {
    if (!p.running || !runId) return;
    const timer = window.setInterval(loadTree, 4000);
    return () => window.clearInterval(timer);
  }, [p.running, runId, loadTree]);

  const openFile = useCallback((path: string, name: string) => {
    if (!runId) return;
    setFile({ path, name, loading: true, content: "", draft: "", truncated: false, size: 0, editing: false, saving: false, dirty: false });
    api.flowRunFileGet(p.flowId, runId, path)
      .then((r) => setFile({
        path, name, loading: false, content: r.content, draft: r.content,
        truncated: r.truncated, size: r.size, editing: false, saving: false, dirty: false,
      }))
      .catch((err) => setFile({
        path, name, loading: false, content: "", draft: "", truncated: false, size: 0,
        editing: false, saving: false, dirty: false, error: String(err),
      }));
  }, [p.flowId, runId]);

  useEffect(() => {
    if (!p.requestedFile || !runId) return;
    openFile(p.requestedFile.path, basename(p.requestedFile.path));
  }, [openFile, p.requestedFile, runId]);

  const save = useCallback(async () => {
    if (!file || !runId || !file.dirty) return;
    setFile((cur) => (cur ? { ...cur, saving: true } : cur));
    try {
      await api.flowRunFilePut(p.flowId, runId, file.path, file.draft);
      setFile((cur) => (cur ? { ...cur, content: cur.draft, dirty: false, saving: false } : cur));
    } catch (err) {
      setFile((cur) => (cur ? { ...cur, saving: false, error: String(err) } : cur));
    }
  }, [file, p.flowId, runId]);

  // ---- run picker header ----
  const header = (
    <div className="flex h-9 shrink-0 items-center gap-2 border-b border-neutral-200 px-3 dark:border-neutral-800">
      <span className="text-[11px] font-medium text-neutral-500">产出预览</span>
      {p.runs.length > 0 && (
        <select
          value={runId ?? ""}
          onChange={(e) => { setSelectedRunId(e.target.value); setFile(null); }}
          className="ml-auto max-w-[150px] truncate rounded border border-neutral-200 bg-transparent px-1 py-0.5 text-[10px] text-neutral-600 outline-none dark:border-neutral-700 dark:text-neutral-300"
        >
          {p.runs.map((r) => (
            <option key={r.id} value={r.id}>
              {basename(r.outputDir)}{r.status === "running" ? " · 运行中" : ""}
            </option>
          ))}
        </select>
      )}
      <button
        onClick={loadTree}
        title="刷新"
        className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700 dark:hover:bg-neutral-800 dark:hover:text-neutral-200"
      >
        <RefreshCw className={cn("h-3.5 w-3.5", treeLoading && "animate-spin")} strokeWidth={1.75} />
      </button>
    </div>
  );

  if (!selectedRun) {
    return (
      <aside className="flex w-80 shrink-0 flex-col border-l border-neutral-200 dark:border-neutral-800">
        {header}
        <div className="flex flex-1 items-center justify-center text-[12px] text-neutral-400">
          运行后在此查看产出
        </div>
      </aside>
    );
  }

  // ---- file view ----
  if (file) {
    const md = isMarkdown(file.name);
    return (
      <aside className="flex w-80 shrink-0 flex-col border-l border-neutral-200 dark:border-neutral-800">
        {header}
        <div className="flex h-9 shrink-0 items-center gap-1.5 border-b border-neutral-200 px-2 dark:border-neutral-800">
          <button
            onClick={() => setFile(null)}
            title="返回文件列表"
            className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700 dark:hover:bg-neutral-800 dark:hover:text-neutral-200"
          >
            <ArrowLeft className="h-3.5 w-3.5" strokeWidth={1.75} />
          </button>
          <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-neutral-700 dark:text-neutral-200" title={file.path}>
            {file.name}
            {file.dirty && <span className="ml-1 text-amber-500">●</span>}
          </span>
          {file.editing ? (
            <>
              <button
                onClick={() => void save()}
                disabled={!file.dirty || file.saving}
                title="保存"
                className="inline-flex h-6 items-center gap-1 rounded px-1.5 text-[11px] font-medium text-emerald-600 hover:bg-emerald-50 disabled:opacity-40 dark:text-emerald-400 dark:hover:bg-emerald-950/30"
              >
                {file.saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" strokeWidth={1.75} />}
                保存
              </button>
              <button
                onClick={() => setFile((cur) => (cur ? { ...cur, editing: false, draft: cur.content, dirty: false } : cur))}
                title="切换到只读"
                className="inline-flex h-6 items-center gap-1 rounded px-1.5 text-[11px] text-neutral-500 hover:bg-neutral-100 dark:text-neutral-400 dark:hover:bg-neutral-800"
              >
                <Eye className="h-3.5 w-3.5" strokeWidth={1.75} />
                只读
              </button>
            </>
          ) : (
            <button
              onClick={() => setFile((cur) => (cur ? { ...cur, editing: true } : cur))}
              title="编辑"
              className="inline-flex h-6 items-center gap-1 rounded px-1.5 text-[11px] text-neutral-500 hover:bg-neutral-100 dark:text-neutral-400 dark:hover:bg-neutral-800"
            >
              <Pencil className="h-3.5 w-3.5" strokeWidth={1.75} />
              编辑
            </button>
          )}
        </div>

        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          {file.loading ? (
            <div className="flex flex-1 items-center justify-center text-neutral-400">
              <Loader2 className="h-5 w-5 animate-spin" strokeWidth={1.75} />
            </div>
          ) : file.error ? (
            <p className="p-3 text-[12px] text-rose-500">{file.error}</p>
          ) : file.editing ? (
            <textarea
              value={file.draft}
              onChange={(e) => setFile((cur) => (cur ? { ...cur, draft: e.target.value, dirty: e.target.value !== cur.content } : cur))}
              spellCheck={false}
              className="min-h-0 flex-1 resize-none bg-transparent p-3 font-mono text-[12px] leading-5 text-neutral-800 outline-none dark:text-neutral-200"
            />
          ) : (
            <div className="min-h-0 flex-1 overflow-y-auto p-3">
              {md ? (
                <div className="prose prose-sm dark:prose-invert max-w-none text-[13px]">
                  <Markdown>{file.content || "_（空文件）_"}</Markdown>
                </div>
              ) : (
                <pre className="whitespace-pre-wrap break-words font-mono text-[12px] leading-5 text-neutral-700 dark:text-neutral-300">
                  {file.content || "（空文件）"}
                </pre>
              )}
            </div>
          )}
          {file.truncated && (
            <div className="shrink-0 border-t border-neutral-100 px-3 py-1 text-[10px] text-amber-500 dark:border-neutral-800">
              内容已截断至 2 MB
            </div>
          )}
        </div>
      </aside>
    );
  }

  // ---- tree view ----
  return (
    <aside className="flex w-80 shrink-0 flex-col border-l border-neutral-200 dark:border-neutral-800">
      {header}
      <div className="flex shrink-0 items-center gap-2 border-b border-neutral-100 px-3 py-2 dark:border-neutral-800">
        {selectedRun.status === "success" ? (
          <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" strokeWidth={1.75} />
        ) : selectedRun.status === "failed" || selectedRun.status === "aborted" ? (
          <XCircle className="h-3.5 w-3.5 text-rose-500" strokeWidth={1.75} />
        ) : (
          <Circle className="h-3.5 w-3.5 text-amber-400" strokeWidth={1.75} />
        )}
        <span className="min-w-0 flex-1 truncate font-mono text-[10px] text-neutral-400" title={selectedRun.outputDir}>
          {selectedRun.outputDir}
        </span>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {treeLoading && !tree ? (
          <div className="flex items-center justify-center py-6 text-neutral-400">
            <Loader2 className="h-4 w-4 animate-spin" strokeWidth={1.75} />
          </div>
        ) : treeError ? (
          <p className="px-2 py-2 text-[11px] text-rose-500">{treeError}</p>
        ) : tree && (tree.children?.length ?? 0) > 0 ? (
          (tree.children ?? []).map((child) => (
            <RunFileTree key={child.path} node={child} depth={0} selectedPath={null} onSelect={openFile} />
          ))
        ) : (
          <p className="px-2 py-6 text-center text-[11.5px] text-neutral-400">暂无产出文件</p>
        )}
      </div>
    </aside>
  );
}
