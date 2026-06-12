import { useCallback, useEffect, useState } from "react";
import { Check, ChevronDown, ChevronRight, CircleAlert, Copy, FileText, Folder, FolderOpen, Loader2, Plus, RefreshCw, ShieldAlert, Sparkles, Trash2 } from "lucide-react";
import { Markdown } from "@/components/Markdown";
import { api } from "@/lib/api";
import type { FlowTreeNode, WorkspaceFolderName, WorkspacePath, WorkspacePathKind } from "@/types";

type Scope =
  | { type: "workspace"; workspaceId: string }
  | { type: "session"; sessionId: string }
  | { type: "flow"; flowId: string };

interface Props {
  scope: Scope | null;
  folder: WorkspaceFolderName;
  onPathsChange?: (paths: WorkspacePath[]) => void;
}

const META: Record<WorkspaceFolderName, { title: string; hint: string }> = {
  draw_data: { title: "原始数据", hint: "添加待分析的原始数据文件或文件夹" },
  clean_data: { title: "聚合数据", hint: "添加已聚合处理的数据文件或文件夹" },
  report: { title: "报告输出", hint: "优先添加内容输出目录；未设置时默认输出到最近加载的数据源目录" },
};

interface PreviewState {
  entryId: number;
  name: string;
  relPath?: string;
  size: number;
  loading: boolean;
  previewable: boolean;
  truncated: boolean;
  content?: string;
  error?: string;
}

function formatBytes(size: number): string {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}

function isMarkdown(name: string): boolean {
  const lower = name.toLowerCase();
  return lower.endsWith(".md") || lower.endsWith(".markdown");
}

function PathTreeNode({ node, depth, onPreview }: { node: FlowTreeNode; depth: number; onPreview: (path: string) => void }) {
  const [open, setOpen] = useState(depth < 1);
  const paddingLeft = `${12 + depth * 14}px`;
  if (node.kind === "file") {
    return (
      <button
        onClick={() => onPreview(node.path)}
        style={{ paddingLeft }}
        className="flex w-full items-center gap-1.5 rounded py-1 pr-2 text-left text-[12px] text-neutral-700 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-800"
      >
        <FileText className="h-3.5 w-3.5 shrink-0 text-neutral-400" strokeWidth={1.75} />
        <span className="truncate">{node.name}</span>
      </button>
    );
  }
  return (
    <div>
      <button
        onClick={() => setOpen((value) => !value)}
        style={{ paddingLeft }}
        className="flex w-full items-center gap-1 rounded py-1 pr-2 text-left text-[12px] text-neutral-700 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-800"
      >
        {open ? <ChevronDown className="h-3 w-3 shrink-0" /> : <ChevronRight className="h-3 w-3 shrink-0" />}
        <Folder className="h-3.5 w-3.5 shrink-0 text-neutral-400" strokeWidth={1.75} />
        <span className="truncate">{node.name}</span>
      </button>
      {open && (node.children ?? []).map((child) => (
        <PathTreeNode key={child.path} node={child} depth={depth + 1} onPreview={onPreview} />
      ))}
    </div>
  );
}

export function FolderPathsPane({ scope, folder, onPathsChange }: Props) {
  const [paths, setPaths] = useState<WorkspacePath[]>([]);
  const [addingKind, setAddingKind] = useState<WorkspacePathKind | null>(null);
  const [draft, setDraft] = useState("");
  const [picking, setPicking] = useState(false);
  const [trees, setTrees] = useState<Record<number, FlowTreeNode>>({});
  const [openDirs, setOpenDirs] = useState<Set<number>>(new Set());
  const [treeErrors, setTreeErrors] = useState<Record<number, string>>({});
  const [preview, setPreview] = useState<PreviewState | null>(null);
  const [addError, setAddError] = useState("");
  const [copiedPathId, setCopiedPathId] = useState<number | null>(null);
  const [loadingPaths, setLoadingPaths] = useState(false);

  const [htmlGenerating, setHtmlGenerating] = useState(false);
  const [htmlGenerateResult, setHtmlGenerateResult] = useState<{ path: string } | null>(null);
  const [htmlGenerateError, setHtmlGenerateError] = useState("");

  const load = useCallback(async () => {
    if (!scope) return;
    const updatePaths = (nextPaths: WorkspacePath[]) => {
      setPaths(nextPaths);
      onPathsChange?.(nextPaths);
    };
    setLoadingPaths(true);
    try {
      switch (scope.type) {
        case "workspace":
          updatePaths(await api.listWorkspacePaths(scope.workspaceId, folder));
          break;
        case "session":
          updatePaths(await api.listSessionPaths(scope.sessionId, folder));
          break;
        case "flow":
          updatePaths(await api.listFlowPaths(scope.flowId, folder));
          break;
      }
    } catch {
      updatePaths([]);
    } finally {
      setLoadingPaths(false);
    }
  }, [scope, folder, onPathsChange]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    setHtmlGenerateResult(null);
    setHtmlGenerateError("");
  }, [preview?.entryId, preview?.name]);

  const startAdding = (kind: WorkspacePathKind) => {
    setDraft("");
    setAddError("");
    setAddingKind(kind);
  };

  const confirm = async () => {
    const p = draft.trim();
    if (!scope || !p || !addingKind) return;
    try {
      switch (scope.type) {
        case "workspace":
          await api.addWorkspacePath(scope.workspaceId, folder, p, addingKind);
          break;
        case "session":
          await api.addSessionPath(scope.sessionId, folder, p, addingKind);
          break;
        case "flow":
          await api.addFlowPath(scope.flowId, folder, p, addingKind);
          break;
      }
      setDraft("");
      setAddingKind(null);
      void load();
    } catch (err) {
      setAddError(String(err));
    }
  };

  const pick = async () => {
    if (!addingKind) return;
    setPicking(true);
    try {
      // Default the dialog to this task's standard dir (session/flow scope; the
      // standard is task-bound, workspace scope has no standard dir).
      const taskScope = scope?.type === "session" ? { sessionId: scope.sessionId }
        : scope?.type === "flow" ? { flowId: scope.flowId }
        : {};
      const { path } = await api.pickLocalPath(addingKind === "dir" ? "dir" : "file", { folder, ...taskScope });
      setDraft(path);
    } catch {
      // user cancelled — no-op
    } finally {
      setPicking(false);
    }
  };

  const remove = async (id: number) => {
    if (!scope) return;
    switch (scope.type) {
      case "workspace":
        await api.removeWorkspacePath(scope.workspaceId, id);
        break;
      case "session":
        await api.removeSessionPath(scope.sessionId, id);
        break;
      case "flow":
        await api.removeFlowPath(scope.flowId, id);
        break;
    }
    const nextPaths = paths.filter((path) => path.id !== id);
    setPaths(nextPaths);
    onPathsChange?.(nextPaths);
    setOpenDirs((cur) => {
      const next = new Set(cur);
      next.delete(id);
      return next;
    });
    setTrees((cur) => {
      const next = { ...cur };
      delete next[id];
      return next;
    });
    setTreeErrors((cur) => {
      const next = { ...cur };
      delete next[id];
      return next;
    });
    setPreview((cur) => cur?.entryId === id ? null : cur);
  };

  const refreshOpenTrees = async (ids: number[]) => {
    const nextTrees: Record<number, FlowTreeNode> = {};
    const nextErrors: Record<number, string> = {};
    await Promise.all(ids.map(async (id) => {
      try {
        nextTrees[id] = await api.workspacePathTree(id);
      } catch (err) {
        nextErrors[id] = String(err);
      }
    }));
    setTrees((cur) => ({ ...cur, ...nextTrees }));
    setTreeErrors((cur) => {
      const next = { ...cur };
      for (const id of ids) delete next[id];
      return { ...next, ...nextErrors };
    });
  };

  const refreshAll = async () => {
    await load();
    const ids = Array.from(openDirs);
    if (ids.length > 0) await refreshOpenTrees(ids);
  };

  const copyPath = async (path: WorkspacePath) => {
    await navigator.clipboard.writeText(path.path);
    setCopiedPathId(path.id);
    window.setTimeout(() => {
      setCopiedPathId((current) => current === path.id ? null : current);
    }, 1500);
  };

  const previewFile = async (entryId: number, path = "") => {
    setPreview({ entryId, name: path || "加载中", relPath: path, size: 0, loading: true, previewable: true, truncated: false });
    try {
      const file = await api.workspacePathFileGet(entryId, path);
      setPreview({ entryId, ...file, relPath: path, loading: false });
    } catch (err) {
      setPreview({ entryId, name: path || "无法预览", relPath: path, size: 0, loading: false, previewable: false, truncated: false, error: String(err) });
    }
  };

  const toggleDir = async (entryId: number) => {
    if (openDirs.has(entryId)) {
      setOpenDirs((cur) => {
        const next = new Set(cur);
        next.delete(entryId);
        return next;
      });
      return;
    }
    setOpenDirs((cur) => new Set(cur).add(entryId));
    try {
      const tree = await api.workspacePathTree(entryId);
      setTrees((cur) => ({ ...cur, [entryId]: tree }));
      setTreeErrors((cur) => {
        const next = { ...cur };
        delete next[entryId];
        return next;
      });
    } catch (err) {
      setTreeErrors((cur) => ({ ...cur, [entryId]: String(err) }));
    }
  };

  const { title, hint } = META[folder];

  if (!scope) {
    return (
      <div className="flex flex-1 items-center justify-center text-[12.5px] text-neutral-400 dark:text-neutral-500">
        请先选择工作区
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5 p-6">
      {/* header */}
      <div className="flex items-start justify-between">
        <div>
          <h2 className="text-[15px] font-semibold text-neutral-900 dark:text-neutral-100">{title}</h2>
          <p className="mt-0.5 text-[12.5px] text-neutral-500 dark:text-neutral-400">{hint}</p>
          {folder === "draw_data" && (
            <p className="mt-2 inline-flex items-center gap-1.5 text-[12px] text-red-600 dark:text-red-500">
              <ShieldAlert className="h-3.5 w-3.5 shrink-0" strokeWidth={2} />
              数据安全：原始数据不得被 LLM 读取
            </p>
          )}
          {folder === "clean_data" && (
            <p className="mt-2 inline-flex items-center gap-1.5 text-[12px] text-amber-600 dark:text-amber-500">
              <CircleAlert className="h-3.5 w-3.5 shrink-0" strokeWidth={2} />
              数据安全：可被 LLM 读取，不要放入明细数据
            </p>
          )}
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => void refreshAll()}
            disabled={loadingPaths}
            title="刷新路径和文件树"
            className="inline-flex h-8 shrink-0 items-center justify-center rounded-md border border-neutral-200 bg-white px-2.5 text-neutral-600 hover:bg-neutral-100 disabled:opacity-50 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-300 dark:hover:bg-neutral-800"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loadingPaths ? "animate-spin" : ""}`} strokeWidth={1.75} />
          </button>
          <button
            onClick={() => startAdding("file")}
            className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md bg-neutral-900 px-3 text-[12.5px] font-medium text-white hover:bg-neutral-700 dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-neutral-200"
          >
            <Plus className="h-3.5 w-3.5" strokeWidth={1.75} />
            添加文件
          </button>
          <button
            onClick={() => startAdding("dir")}
            className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md border border-neutral-200 bg-white px-3 text-[12.5px] font-medium text-neutral-700 hover:bg-neutral-100 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-200 dark:hover:bg-neutral-800"
          >
            <Plus className="h-3.5 w-3.5" strokeWidth={1.75} />
            添加文件夹
          </button>
        </div>
      </div>

      {/* inline add row */}
      {addingKind && (
        <div className="rounded-lg border border-neutral-200 bg-white px-3 py-2 dark:border-neutral-700 dark:bg-neutral-900">
          <div className="flex items-center gap-2">
            <input
              autoFocus
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void confirm();
                if (e.key === "Escape") setAddingKind(null);
              }}
              placeholder={addingKind === "dir" ? "/path/to/folder" : "/path/to/file"}
              className="min-w-0 flex-1 bg-transparent font-mono text-[12.5px] text-neutral-900 outline-none placeholder:text-neutral-400 dark:text-neutral-100 dark:placeholder:text-neutral-600"
            />
            <button
              onClick={() => void pick()}
              disabled={picking}
              title={addingKind === "dir" ? "选取本地文件夹" : "选取本地文件"}
              className="inline-flex h-7 items-center gap-1 rounded px-2 text-[11px] text-neutral-600 hover:bg-neutral-100 disabled:opacity-50 dark:text-neutral-400 dark:hover:bg-neutral-800"
            >
              <FolderOpen className="h-3.5 w-3.5" strokeWidth={1.75} />
              选取
            </button>
            <button
              onClick={() => void confirm()}
              className="inline-flex h-7 items-center rounded px-2 text-[11px] font-medium text-neutral-900 hover:bg-neutral-100 dark:text-neutral-100 dark:hover:bg-neutral-800"
            >
              确认
            </button>
            <button
              onClick={() => setAddingKind(null)}
              className="inline-flex h-7 items-center rounded px-2 text-[11px] text-neutral-500 hover:bg-neutral-100 dark:text-neutral-400 dark:hover:bg-neutral-800"
            >
              取消
            </button>
          </div>
          {addError && <p className="mt-1 text-[11px] text-red-500">{addError}</p>}
        </div>
      )}

      <div className="grid min-h-0 grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(320px,0.9fr)]">
        {/* path list */}
        <div className="space-y-1">
          {paths.map((p) => (
            <div key={p.id}>
              <div className="group flex items-center gap-2 rounded-md px-3 py-2 hover:bg-neutral-100 dark:hover:bg-neutral-800/60">
                <button
                  onClick={() => p.kind === "dir" ? void toggleDir(p.id) : void previewFile(p.id)}
                  className="flex min-w-0 flex-1 items-center gap-2 text-left"
                >
                  {p.kind === "dir" ? (
                    openDirs.has(p.id) ? <ChevronDown className="h-3.5 w-3.5 shrink-0 text-neutral-400" /> : <ChevronRight className="h-3.5 w-3.5 shrink-0 text-neutral-400" />
                  ) : <span className="w-3.5 shrink-0" />}
                  {p.kind === "dir" ? <Folder className="h-4 w-4 shrink-0 text-neutral-500" strokeWidth={1.75} /> : <FileText className="h-4 w-4 shrink-0 text-neutral-500" strokeWidth={1.75} />}
                  <span className="min-w-0 flex-1 truncate font-mono text-[12.5px] text-neutral-800 dark:text-neutral-200">{p.path}</span>
                  {p.status === "missing" && (
                    <span className="shrink-0 rounded bg-red-50 px-1.5 py-0.5 text-[10.5px] text-red-600 dark:bg-red-950/40 dark:text-red-400">路径不存在</span>
                  )}
                  {p.status === "kind_mismatch" && (
                    <span className="shrink-0 rounded bg-amber-50 px-1.5 py-0.5 text-[10.5px] text-amber-700 dark:bg-amber-950/40 dark:text-amber-300">类型已变化</span>
                  )}
                </button>
                <button
                  onClick={() => void copyPath(p)}
                  title={copiedPathId === p.id ? "已复制" : "复制路径"}
                  className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded text-neutral-400 opacity-0 hover:bg-neutral-200 hover:text-neutral-700 group-hover:opacity-100 dark:text-neutral-500 dark:hover:bg-neutral-700 dark:hover:text-neutral-200"
                >
                  {copiedPathId === p.id
                    ? <Check className="h-3.5 w-3.5" strokeWidth={1.75} />
                    : <Copy className="h-3.5 w-3.5" strokeWidth={1.75} />}
                </button>
                <button
                  onClick={() => void remove(p.id)}
                  title="移除"
                  className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded text-neutral-400 opacity-0 hover:bg-neutral-200 hover:text-neutral-700 group-hover:opacity-100 dark:text-neutral-500 dark:hover:bg-neutral-700 dark:hover:text-neutral-200"
                >
                  <Trash2 className="h-3.5 w-3.5" strokeWidth={1.75} />
                </button>
              </div>
              {p.kind === "dir" && openDirs.has(p.id) && (
                <div className="ml-3 border-l border-neutral-200 py-1 dark:border-neutral-800">
                  {treeErrors[p.id] ? (
                    <p className="px-3 py-1 text-[11px] text-red-500">{treeErrors[p.id]}</p>
                  ) : trees[p.id] ? (
                    (trees[p.id]?.children ?? []).map((node) => (
                      <PathTreeNode key={node.path} node={node} depth={0} onPreview={(path) => void previewFile(p.id, path)} />
                    ))
                  ) : (
                    <p className="px-3 py-1 text-[11px] text-neutral-400">正在读取...</p>
                  )}
                </div>
              )}
            </div>
          ))}
          {paths.length === 0 && !addingKind && (
            <p className="px-3 py-6 text-center text-[12.5px] text-neutral-400 dark:text-neutral-500">
              还没有文档或文件夹，点击上方按钮添加。
            </p>
          )}
        </div>

        {/* preview */}
        <div className="min-h-[240px] rounded-lg border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
          {!preview ? (
            <p className="flex h-full items-center justify-center text-[12.5px] text-neutral-400">选择文件后在这里预览</p>
          ) : preview.loading ? (
            <p className="text-[12.5px] text-neutral-400">正在读取...</p>
          ) : (
            <>
              {folder === "report" && isMarkdown(preview.name) && (
                <div className="mb-4 rounded-lg border border-violet-100 bg-violet-50/50 p-3.5 dark:border-violet-950/40 dark:bg-violet-950/20">
                  <div className="flex flex-col gap-2.5 sm:flex-row sm:items-center sm:justify-between">
                    <div className="flex items-center gap-2">
                      <Sparkles className="h-4 w-4 text-violet-500 shrink-0" />
                      <div>
                        <h3 className="text-[12.5px] font-semibold text-violet-900 dark:text-violet-200">生成高质量 HTML 报告</h3>
                        <p className="text-[11px] text-violet-600 dark:text-violet-400">将此 Markdown 报告渲染为带侧边栏目录的精美 HTML 页面</p>
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        onClick={async () => {
                          setHtmlGenerating(true);
                          setHtmlGenerateError("");
                          setHtmlGenerateResult(null);
                          try {
                            const result = await api.generateHighQualityHtmlReport({
                              pathId: preview.entryId,
                              relPath: preview.relPath,
                            });
                            setHtmlGenerateResult(result);
                            if (scope && result.absPath) {
                              try {
                                if (scope.type === "workspace") {
                                  await api.addWorkspacePath(scope.workspaceId, "report", result.absPath, "file");
                                } else if (scope.type === "session") {
                                  await api.addSessionPath(scope.sessionId, "report", result.absPath, "file");
                                } else if (scope.type === "flow") {
                                  await api.addFlowPath(scope.flowId, "report", result.absPath, "file");
                                }
                              } catch (addErr) {
                                console.error("Failed to auto-register generated report path:", addErr);
                              }
                            }
                            void refreshAll();
                          } catch (err) {
                            setHtmlGenerateError(String(err));
                          } finally {
                            setHtmlGenerating(false);
                          }
                        }}
                        disabled={htmlGenerating}
                        className="inline-flex h-8 items-center gap-1.5 rounded-md bg-violet-600 px-3 text-[12px] font-medium text-white hover:bg-violet-700 disabled:opacity-50 dark:bg-violet-700 dark:hover:bg-violet-600"
                      >
                        {htmlGenerating ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Sparkles className="h-3.5 w-3.5" />
                        )}
                        {htmlGenerating ? "生成中..." : "生成 HTML 报告"}
                      </button>
                    </div>
                  </div>

                  {htmlGenerateError && (
                    <p className="mt-2 text-[11.5px] text-red-500">{htmlGenerateError}</p>
                  )}

                  {htmlGenerateResult && (
                    <div className="mt-2.5 flex items-center justify-between rounded bg-emerald-50 px-2.5 py-1.5 text-[11.5px] text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-400">
                      <span className="truncate">🎉 生成成功：{htmlGenerateResult.path}</span>
                      <button
                        onClick={async () => {
                          await navigator.clipboard.writeText(htmlGenerateResult.path);
                        }}
                        className="ml-2 shrink-0 text-emerald-600 underline hover:text-emerald-800 dark:text-emerald-400"
                      >
                        复制路径
                      </button>
                    </div>
                  )}
                </div>
              )}
              <div className="mb-3 border-b border-neutral-200 pb-2 dark:border-neutral-800">
                <p className="truncate font-mono text-[12.5px] font-medium text-neutral-800 dark:text-neutral-200">{preview.name}</p>
                <p className="mt-1 text-[11px] text-neutral-400">
                  {formatBytes(preview.size)}
                  {preview.truncated ? " · 内容已截断至 2 MB" : ""}
                </p>
              </div>
              {preview.error ? (
                <p className="text-[12px] text-red-500">{preview.error}</p>
              ) : !preview.previewable ? (
                <p className="text-[12.5px] text-neutral-500 dark:text-neutral-400">该文件类型暂不支持内容预览。</p>
              ) : isMarkdown(preview.name) ? (
                <Markdown>{preview.content || "_（空文件）_"}</Markdown>
              ) : (
                <pre className="max-h-[520px] overflow-auto whitespace-pre-wrap break-words font-mono text-[12px] leading-5 text-neutral-700 dark:text-neutral-300">{preview.content || "（空文件）"}</pre>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
