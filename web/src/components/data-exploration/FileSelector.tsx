// LLM_FORBIDDEN: this module must never call any LLM API.
// File selector: drag-and-drop upload (csv/xlsx) + registered path file tree.

import { useCallback, useEffect, useRef, useState } from "react";
import { Check, ChevronDown, ChevronRight, FileText, Folder, RefreshCw, Upload } from "lucide-react";
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
  onToggle: (choice: FileChoice) => void;
  loadedKeys: Set<string>; // keys = `${pathId}:${relativePath}` or `upload:${fileName}`
  onUpload?: (fileName: string, bytes: Uint8Array) => void;
}

const ALLOWED_EXTENSIONS = [".csv", ".tsv", ".xlsx", ".xls"];
const ALLOWED_MIME = new Set([
  "text/csv",
  "text/tab-separated-values",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-excel",
]);

function hasAllowedExtension(name: string): boolean {
  const lower = name.toLowerCase();
  return ALLOWED_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

function isAllowedFile(file: File): boolean {
  const extOk = hasAllowedExtension(file.name);
  const mimeOk = ALLOWED_MIME.has(file.type);
  return extOk || mimeOk;
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
  onToggle: (choice: FileChoice) => void;
  loadedKeys: Set<string>;
}

function FileTree({ pathId, pathLabel, folder, node, depth, onToggle, loadedKeys }: FileTreeProps) {
  const [open, setOpen] = useState(depth < 1);
  const paddingLeft = `${8 + depth * 14}px`;

  if (node.kind === "file") {
    if (!hasAllowedExtension(node.name)) return null;
    const isLoaded = loadedKeys.has(`${pathId}:${node.path}`);
    return (
      <button
        onClick={() => onToggle({ pathId, pathLabel, folder, fileName: node.name, relativePath: node.path })}
        style={{ paddingLeft }}
        className={`flex w-full items-center gap-1.5 rounded py-1 pr-2 text-left text-[12px] ${
          isLoaded
            ? "bg-blue-50 text-blue-700 dark:bg-blue-950 dark:text-blue-300"
            : "text-neutral-700 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-800"
        }`}
        title={isLoaded ? "已加载（点击移除）" : "点击加载"}
      >
        {isLoaded
          ? <Check className="h-3.5 w-3.5 shrink-0 text-blue-600 dark:text-blue-400" strokeWidth={2.25} />
          : <FileText className="h-3.5 w-3.5 shrink-0 text-neutral-400" strokeWidth={1.75} />}
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
        onToggle={onToggle}
        loadedKeys={loadedKeys}
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

export function FileSelector({ scope, onToggle, loadedKeys, onUpload }: Props) {
  const [paths, setPaths] = useState<{ entry: WorkspacePath; tree: FlowTreeNode | null; error?: string }[]>([]);
  const [loading, setLoading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

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

  const handleFiles = useCallback(async (files: FileList | File[]) => {
    if (!onUpload) return;
    const allowed = Array.from(files).filter(isAllowedFile);
    if (allowed.length === 0) return;
    setUploading(true);
    try {
      for (const file of allowed) {
        const buf = await file.arrayBuffer();
        onUpload(file.name, new Uint8Array(buf));
      }
    } finally {
      setUploading(false);
    }
  }, [onUpload]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    if (e.dataTransfer.files.length > 0) void handleFiles(e.dataTransfer.files);
  }, [handleFiles]);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
  }, []);

  const handleClickUpload = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handleInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      void handleFiles(e.target.files);
      e.target.value = "";
    }
  }, [handleFiles]);

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

      {onUpload && (
        <>
          <div
            onDrop={handleDrop}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onClick={handleClickUpload}
            className={`mx-2 mt-2 flex cursor-pointer flex-col items-center justify-center gap-1 rounded-lg border-2 border-dashed px-3 py-3 text-center transition-colors ${
              dragOver
                ? "border-blue-400 bg-blue-50 dark:border-blue-500 dark:bg-blue-950/30"
                : "border-neutral-300 bg-white hover:border-blue-300 hover:bg-blue-50/50 dark:border-neutral-700 dark:bg-neutral-900 dark:hover:border-blue-700 dark:hover:bg-blue-950/20"
            }`}
          >
            {uploading ? (
              <RefreshCw className="h-4 w-4 animate-spin text-blue-500" strokeWidth={1.75} />
            ) : (
              <Upload className="h-4 w-4 text-neutral-400" strokeWidth={1.75} />
            )}
            <span className="text-[10px] text-neutral-500">
              {uploading ? "上传中..." : "拖拽 CSV / Excel 文件到此处"}
            </span>
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv,.tsv,.xlsx,.xls"
            multiple
            onChange={handleInputChange}
            className="hidden"
          />
        </>
      )}

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
                  onToggle={onToggle}
                  loadedKeys={loadedKeys}
                />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
