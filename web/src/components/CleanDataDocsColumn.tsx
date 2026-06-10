import { useCallback, useEffect, useState } from "react";
import { ChevronLeft, ChevronRight, CircleAlert, FileText, Folder, PanelLeftClose, RefreshCw } from "lucide-react";
import { CopyButton } from "@/components/CopyButton";
import { Markdown } from "@/components/Markdown";
import { api } from "@/lib/api";
import { cn } from "@/lib/cn";
import type { FolderScope } from "@/tabs/types";
import type { FlowTreeNode, WorkspacePath } from "@/types";

/**
 * 探索·工作视图左侧的「聚合数据」只读文档竖栏 —— owner: Claude(总控)。
 *
 * 数据安全红线（AGENTS.md §一）：本组件**只读取并展示** clean_data 文档供人工查阅 / 复制，
 * 绝不接入任何 LLM、不写 draw_data / clean_data、不提供删除。clean_data 由 FolderPathsPane 管理。
 */

interface FileLeaf {
  pathId: number;
  relPath: string;
  name: string;
}

function flattenFiles(pathId: number, node: FlowTreeNode | null): FileLeaf[] {
  const out: FileLeaf[] = [];
  const walk = (n: FlowTreeNode) => {
    if (n.kind === "file") out.push({ pathId, relPath: n.path, name: n.name });
    for (const child of n.children ?? []) walk(child);
  };
  if (node) walk(node);
  return out;
}

function isMarkdown(name: string): boolean {
  const lower = name.toLowerCase();
  return lower.endsWith(".md") || lower.endsWith(".markdown");
}

function listPaths(scope: FolderScope): Promise<WorkspacePath[]> {
  if (!scope) return Promise.resolve([]);
  if (scope.type === "session") return api.listSessionPaths(scope.sessionId, "clean_data");
  if (scope.type === "workspace") return api.listWorkspacePaths(scope.workspaceId, "clean_data");
  return api.listFlowPaths(scope.flowId, "clean_data");
}

export function CleanDataDocsColumn({ scope }: { scope: FolderScope }) {
  const [collapsed, setCollapsed] = useState(false);
  const [files, setFiles] = useState<FileLeaf[]>([]);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<FileLeaf | null>(null);
  const [content, setContent] = useState("");
  const [contentLoading, setContentLoading] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const paths = await listPaths(scope);
      const collected: FileLeaf[] = [];
      for (const p of paths) {
        if (p.kind === "file") {
          collected.push({ pathId: p.id, relPath: "", name: p.path.split(/[\\/]/).filter(Boolean).at(-1) ?? p.path });
        } else {
          try {
            const tree = await api.workspacePathTree(p.id);
            collected.push(...flattenFiles(p.id, tree));
          } catch {
            /* skip unreadable dir */
          }
        }
      }
      setFiles(collected);
    } catch (err) {
      setError(String(err));
      setFiles([]);
    } finally {
      setLoading(false);
    }
  }, [scope]);

  useEffect(() => {
    void load();
    setSelected(null);
    setContent("");
  }, [load]);

  const openFile = useCallback(async (file: FileLeaf) => {
    setSelected(file);
    setContent("");
    setContentLoading(true);
    setError("");
    try {
      const res = await api.workspacePathFileGet(file.pathId, file.relPath);
      setContent(res.previewable ? (res.content ?? "") : "（该文件类型暂不支持预览）");
    } catch (err) {
      setError(String(err));
    } finally {
      setContentLoading(false);
    }
  }, []);

  if (collapsed) {
    return (
      <button
        onClick={() => setCollapsed(false)}
        title="展开聚合数据文档"
        className="flex w-9 shrink-0 items-center justify-center border-r border-neutral-200 text-neutral-500 hover:bg-neutral-100 hover:text-neutral-900 dark:border-neutral-800 dark:text-neutral-400 dark:hover:bg-neutral-800 dark:hover:text-neutral-100"
      >
        <ChevronRight className="h-4 w-4" strokeWidth={1.75} />
      </button>
    );
  }

  return (
    <aside className="flex w-72 shrink-0 flex-col border-r border-neutral-200 bg-neutral-50/40 dark:border-neutral-800 dark:bg-neutral-950/40">
      <div className="flex h-9 shrink-0 items-center gap-1.5 border-b border-neutral-200 px-3 dark:border-neutral-800">
        <CircleAlert className="h-3.5 w-3.5 shrink-0 text-amber-500" strokeWidth={2} />
        <span className="flex-1 truncate text-[12px] font-medium text-neutral-700 dark:text-neutral-300">聚合数据文档</span>
        <button
          onClick={() => void load()}
          disabled={loading}
          title="刷新"
          className="inline-flex h-6 w-6 items-center justify-center rounded text-neutral-400 hover:bg-neutral-200 hover:text-neutral-700 disabled:opacity-50 dark:hover:bg-neutral-700 dark:hover:text-neutral-200"
        >
          <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} strokeWidth={1.75} />
        </button>
        <button
          onClick={() => setCollapsed(true)}
          title="收起"
          className="inline-flex h-6 w-6 items-center justify-center rounded text-neutral-400 hover:bg-neutral-200 hover:text-neutral-700 dark:hover:bg-neutral-700 dark:hover:text-neutral-200"
        >
          <PanelLeftClose className="h-3.5 w-3.5" strokeWidth={1.75} />
        </button>
      </div>

      {selected ? (
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="flex h-8 shrink-0 items-center gap-1 border-b border-neutral-200 px-2 dark:border-neutral-800">
            <button
              onClick={() => { setSelected(null); setContent(""); }}
              title="返回列表"
              className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded text-neutral-400 hover:bg-neutral-200 hover:text-neutral-700 dark:hover:bg-neutral-700 dark:hover:text-neutral-200"
            >
              <ChevronLeft className="h-3.5 w-3.5" strokeWidth={1.75} />
            </button>
            <span className="min-w-0 flex-1 truncate font-mono text-[11.5px] text-neutral-700 dark:text-neutral-300">{selected.name}</span>
            <CopyButton text={content} />
          </div>
          <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto p-3">
            {contentLoading ? (
              <p className="text-[12px] text-neutral-400">正在读取...</p>
            ) : error ? (
              <p className="text-[12px] text-rose-500">{error}</p>
            ) : isMarkdown(selected.name) ? (
              <Markdown>{content || "_（空文件）_"}</Markdown>
            ) : (
              <pre className="whitespace-pre-wrap break-words font-mono text-[11.5px] leading-5 text-neutral-700 dark:text-neutral-300">{content || "（空文件）"}</pre>
            )}
          </div>
        </div>
      ) : (
        <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto p-2">
          {error && <p className="px-2 py-1 text-[11.5px] text-rose-500">{error}</p>}
          {files.map((file) => (
            <button
              key={`${file.pathId}:${file.relPath}`}
              onClick={() => void openFile(file)}
              className="flex w-full items-center gap-1.5 rounded px-2 py-1.5 text-left text-[12px] text-neutral-700 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-800"
            >
              {file.relPath.includes("/") ? (
                <Folder className="h-3.5 w-3.5 shrink-0 text-neutral-400" strokeWidth={1.75} />
              ) : (
                <FileText className="h-3.5 w-3.5 shrink-0 text-neutral-400" strokeWidth={1.75} />
              )}
              <span className="min-w-0 flex-1 truncate" title={file.relPath || file.name}>{file.relPath || file.name}</span>
            </button>
          ))}
          {!loading && files.length === 0 && !error && (
            <p className="px-2 py-6 text-center text-[11.5px] leading-5 text-neutral-400">
              暂无聚合数据文档。请在「聚合数据」子页添加。
            </p>
          )}
        </div>
      )}
    </aside>
  );
}
