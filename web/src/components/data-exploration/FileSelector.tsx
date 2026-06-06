// LLM_FORBIDDEN: this module must never call any LLM API.
// File selector: picks csv/xlsx from registered draw_data / clean_data paths only.

import { useCallback, useEffect, useState } from "react";
import { ChevronDown, ChevronRight, FileText, Folder, RefreshCw } from "lucide-react";
import { api } from "@/lib/api";
import type { FlowTreeNode, WorkspaceFolderName, WorkspacePath } from "@/types";

export type Scope =
  | { type: "workspace"; workspaceId: string }
  | { type: "session"; sessionId: string }
  | { type: "flow"; flowId: string };

export interface FileChoice {
  pathId: number;
  pathLabel: string;
  folder: WorkspaceFolderName;
  fileName: string;
  relativePath: string;
}

interface Props {
  scope: Scope | null;
  onSelect: (choice: FileChoice) => void;
  selected?: FileChoice | null;
}

const ALLOWED_EXTENSIONS = [".csv", ".tsv", ".xlsx", ".xls"];

function hasAllowedExtension(name: string): boolean {
  const lower = name.toLowerCase();
  return ALLOWED_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

async function loadPaths(scope: Scope, folder: WorkspaceFolderName): Promise<WorkspacePath[]> {
  switch (scope.type) {
    case "workspace":
      return api.listWorkspacePaths(scope.workspaceId, folder);
    case "session":
      return api.listSessionPaths(scope.sessionId, folder);
    case "flow":
      return api.listFlowPaths(scope.flowId, folder);
  }
}

interface FileTreeProps {
  pathId: number;
  pathLabel: string;
  folder: WorkspaceFolderName;
  node: FlowTreeNode;
  depth: number;
  onSelect: (choice: FileChoice) => void;
  selected?: FileChoice | null;
}

function FileTree({ pathId, pathLabel, folder, node, depth, onSelect, selected }: FileTreeProps) {
  const [open, setOpen] = useState(depth < 1);
  const paddingLeft = `${8 + depth * 14}px`;

  if (node.kind === "file") {
    if (!hasAllowedExtension(node.name)) return null;
    const isSelected = selected?.pathId === pathId && selected?.relativePath === node.path;
    return (
      <button
        onClick={() => onSelect({ pathId, pathLabel, folder, fileName: node.name, relativePath: node.path })}
        style={{ paddingLeft }}
        className={`flex w-full items-center gap-1.5 rounded py-1 pr-2 text-left text-[12px] ${
          isSelected
            ? "bg-blue-50 text-blue-700 dark:bg-blue-950 dark:text-blue-300"
            : "text-neutral-700 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-800"
        }`}
      >
        <FileText className="h-3.5 w-3.5 shrink-0 text-neutral-400" strokeWidth={1.75} />
        <span className="truncate">{node.name}</span>
      </button>
    );
  }

  const children = node.children ?? [];
  const visibleChildren = children
    .map((child) => (
      <FileTree
        key={child.path}
        pathId={pathId}
        pathLabel={pathLabel}
        folder={folder}
        node={child}
        depth={depth + 1}
        onSelect={onSelect}
        selected={selected}
      />
    ))
    .filter(Boolean);

  if (visibleChildren.length === 0 && depth > 0) return null;

  return (
    <div>
      <button
        onClick={() => setOpen((v) => !v)}
        style={{ paddingLeft }}
        className="flex w-full items-center gap-1 rounded py-1 pr-2 text-left text-[12px] text-neutral-700 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-800"
      >
        {open ? <ChevronDown className="h-3 w-3 shrink-0" /> : <ChevronRight className="h-3 w-3 shrink-0" />}
        <Folder className="h-3.5 w-3.5 shrink-0 text-neutral-400" strokeWidth={1.75} />
        <span className="truncate">{node.name}</span>
      </button>
      {open && <div>{visibleChildren}</div>}
    </div>
  );
}

export function FileSelector({ scope, onSelect, selected }: Props) {
  const [paths, setPaths] = useState<{ entry: WorkspacePath; tree: FlowTreeNode | null; error?: string }[]>([]);
  const [loading, setLoading] = useState(false);

  const reload = useCallback(async () => {
    if (!scope) return;
    setLoading(true);
    try {
      const [drawPaths, cleanPaths] = await Promise.all([
        loadPaths(scope, "draw_data"),
        loadPaths(scope, "clean_data"),
      ]);
      const allEntries = [...drawPaths, ...cleanPaths];
      const enriched = await Promise.all(
        allEntries.map(async (entry) => {
          try {
            const tree = await api.workspacePathTree(entry.id);
            return { entry, tree };
          } catch (err) {
            return { entry, tree: null, error: String(err) };
          }
        }),
      );
      setPaths(enriched);
    } finally {
      setLoading(false);
    }
  }, [scope]);

  useEffect(() => {
    void reload();
  }, [reload]);

  return (
    <div className="flex h-full flex-col border-r border-neutral-200 bg-neutral-50/40 dark:border-neutral-800 dark:bg-neutral-900/40">
      <div className="flex items-center justify-between border-b border-neutral-200 px-3 py-2 dark:border-neutral-800">
        <div className="text-[11px] font-medium uppercase tracking-wide text-neutral-500">数据源</div>
        <button
          onClick={() => void reload()}
          disabled={loading}
          className="rounded p-1 text-neutral-500 hover:bg-neutral-100 disabled:opacity-50 dark:hover:bg-neutral-800"
          title="刷新"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} strokeWidth={1.75} />
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {paths.length === 0 && !loading && (
          <div className="px-2 py-4 text-[11px] text-neutral-500">
            尚未登记 draw_data / clean_data 路径。请到「原始数据」或「聚合数据」tab 添加。
          </div>
        )}
        {paths.map(({ entry, tree, error }) => {
          const label = entry.path.split("/").pop() || entry.path;
          const folderLabel = entry.folder === "draw_data" ? "原始" : "聚合";
          return (
            <div key={entry.id} className="mb-2">
              <div className="px-2 py-1 text-[10px] font-medium uppercase tracking-wide text-neutral-400">
                [{folderLabel}] {label}
              </div>
              {error && <div className="px-2 text-[11px] text-red-500">{error}</div>}
              {tree && (
                <FileTree
                  pathId={entry.id}
                  pathLabel={label}
                  folder={entry.folder}
                  node={tree}
                  depth={0}
                  onSelect={onSelect}
                  selected={selected}
                />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
