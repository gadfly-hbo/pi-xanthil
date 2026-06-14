import { useCallback, useEffect, useState } from "react";
import { ChevronDown, ChevronLeft, ChevronRight, CircleAlert, FileText, Folder, PanelLeftClose, RefreshCw } from "lucide-react";
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
 *
 * 展示层级与「聚合数据」一致：顶层为已登记的文件/文件夹，文件夹可逐级折叠展开；
 * 文件夹与文件均支持一键复制其绝对路径，可直接贴进 pi 对话框供 agent 读取。
 */

interface Selected {
  pathId: number;
  relPath: string;
  name: string;
}

function basename(p: string): string {
  return p.split(/[\\/]/).filter(Boolean).at(-1) ?? p;
}

function joinPath(rootAbs: string, rel: string): string {
  return `${rootAbs.replace(/[\\/]+$/, "")}/${rel}`;
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

/** 已登记文件夹内部的递归节点（文件夹可折叠；文件夹/文件均可复制绝对路径）。 */
function TreeNode({
  node,
  depth,
  rootAbs,
  pathId,
  onPreview,
}: {
  node: FlowTreeNode;
  depth: number;
  rootAbs: string;
  pathId: number;
  onPreview: (sel: Selected) => void;
}) {
  const [open, setOpen] = useState(false);
  const paddingLeft = `${8 + depth * 12}px`;
  const absPath = joinPath(rootAbs, node.path);

  if (node.kind === "file") {
    return (
      <div className="group flex items-center gap-1 rounded hover:bg-neutral-100 dark:hover:bg-neutral-800">
        <button
          onClick={() => onPreview({ pathId, relPath: node.path, name: node.name })}
          style={{ paddingLeft }}
          className="flex min-w-0 flex-1 items-center gap-1.5 py-1 pr-1 text-left text-[12px] text-neutral-700 dark:text-neutral-300"
        >
          <FileText className="h-3.5 w-3.5 shrink-0 text-neutral-400" strokeWidth={1.75} />
          <span className="min-w-0 flex-1 truncate" title={node.name}>{node.name}</span>
        </button>
        <span className="shrink-0 opacity-0 group-hover:opacity-100" title={absPath}>
          <CopyButton text={absPath} />
        </span>
      </div>
    );
  }

  return (
    <div>
      <div className="group flex items-center gap-1 rounded hover:bg-neutral-100 dark:hover:bg-neutral-800">
        <button
          onClick={() => setOpen((v) => !v)}
          style={{ paddingLeft }}
          className="flex min-w-0 flex-1 items-center gap-1 py-1 pr-1 text-left text-[12px] text-neutral-700 dark:text-neutral-300"
        >
          {open ? <ChevronDown className="h-3 w-3 shrink-0" /> : <ChevronRight className="h-3 w-3 shrink-0" />}
          <Folder className="h-3.5 w-3.5 shrink-0 text-neutral-400" strokeWidth={1.75} />
          <span className="min-w-0 flex-1 truncate" title={node.name}>{node.name}</span>
        </button>
        <span className="shrink-0 opacity-0 group-hover:opacity-100" title={absPath}>
          <CopyButton text={absPath} />
        </span>
      </div>
      {open && (node.children ?? []).map((child) => (
        <TreeNode key={child.path} node={child} depth={depth + 1} rootAbs={rootAbs} pathId={pathId} onPreview={onPreview} />
      ))}
    </div>
  );
}

export function CleanDataDocsColumn({ scope }: { scope: FolderScope }) {
  const [collapsed, setCollapsed] = useState(false);
  const [paths, setPaths] = useState<WorkspacePath[]>([]);
  const [loading, setLoading] = useState(false);
  const [trees, setTrees] = useState<Record<number, FlowTreeNode>>({});
  const [treeErrors, setTreeErrors] = useState<Record<number, string>>({});
  const [openDirs, setOpenDirs] = useState<Set<number>>(new Set());
  const [selected, setSelected] = useState<Selected | null>(null);
  const [content, setContent] = useState("");
  const [contentLoading, setContentLoading] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      setPaths(await listPaths(scope));
      setTrees({});
      setTreeErrors({});
      setOpenDirs(new Set());
    } catch (err) {
      setError(String(err));
      setPaths([]);
    } finally {
      setLoading(false);
    }
  }, [scope]);

  useEffect(() => {
    void load();
    setSelected(null);
    setContent("");
  }, [load]);

  const toggleDir = useCallback(async (id: number) => {
    if (openDirs.has(id)) {
      setOpenDirs((cur) => {
        const next = new Set(cur);
        next.delete(id);
        return next;
      });
      return;
    }
    setOpenDirs((cur) => new Set(cur).add(id));
    if (trees[id]) return;
    try {
      const tree = await api.workspacePathTree(id);
      setTrees((cur) => ({ ...cur, [id]: tree }));
      setTreeErrors((cur) => {
        const next = { ...cur };
        delete next[id];
        return next;
      });
    } catch (err) {
      setTreeErrors((cur) => ({ ...cur, [id]: String(err) }));
    }
  }, [openDirs, trees]);

  const openFile = useCallback(async (sel: Selected) => {
    setSelected(sel);
    setContent("");
    setContentLoading(true);
    setError("");
    try {
      const res = await api.workspacePathFileGet(sel.pathId, sel.relPath);
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
          {paths.map((p) => (
            <div key={p.id}>
              {p.kind === "dir" ? (
                <>
                  <div className="group flex items-center gap-1 rounded hover:bg-neutral-100 dark:hover:bg-neutral-800">
                    <button
                      onClick={() => void toggleDir(p.id)}
                      className="flex min-w-0 flex-1 items-center gap-1 px-2 py-1.5 text-left text-[12px] text-neutral-700 dark:text-neutral-300"
                    >
                      {openDirs.has(p.id) ? <ChevronDown className="h-3 w-3 shrink-0" /> : <ChevronRight className="h-3 w-3 shrink-0" />}
                      <Folder className="h-3.5 w-3.5 shrink-0 text-neutral-400" strokeWidth={1.75} />
                      <span className="min-w-0 flex-1 truncate" title={p.path}>{basename(p.path)}</span>
                    </button>
                    <span className="shrink-0 opacity-0 group-hover:opacity-100" title={p.path}>
                      <CopyButton text={p.path} />
                    </span>
                  </div>
                  {openDirs.has(p.id) && (
                    <div className="ml-1 border-l border-neutral-200 dark:border-neutral-800">
                      {treeErrors[p.id] ? (
                        <p className="px-2 py-1 text-[11px] text-rose-500">{treeErrors[p.id]}</p>
                      ) : trees[p.id] ? (
                        (trees[p.id]?.children ?? []).map((node) => (
                          <TreeNode key={node.path} node={node} depth={1} rootAbs={p.path} pathId={p.id} onPreview={openFile} />
                        ))
                      ) : (
                        <p className="px-2 py-1 text-[11px] text-neutral-400">正在读取...</p>
                      )}
                    </div>
                  )}
                </>
              ) : (
                <div className="group flex items-center gap-1 rounded hover:bg-neutral-100 dark:hover:bg-neutral-800">
                  <button
                    onClick={() => void openFile({ pathId: p.id, relPath: "", name: basename(p.path) })}
                    className="flex min-w-0 flex-1 items-center gap-1.5 px-2 py-1.5 text-left text-[12px] text-neutral-700 dark:text-neutral-300"
                  >
                    <FileText className="h-3.5 w-3.5 shrink-0 text-neutral-400" strokeWidth={1.75} />
                    <span className="min-w-0 flex-1 truncate" title={p.path}>{basename(p.path)}</span>
                  </button>
                  <span className="shrink-0 opacity-0 group-hover:opacity-100" title={p.path}>
                    <CopyButton text={p.path} />
                  </span>
                </div>
              )}
            </div>
          ))}
          {!loading && paths.length === 0 && !error && (
            <p className="px-2 py-6 text-center text-[11.5px] leading-5 text-neutral-400">
              暂无聚合数据文档。请在「聚合数据」子页添加。
            </p>
          )}
        </div>
      )}
    </aside>
  );
}
