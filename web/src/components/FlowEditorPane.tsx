import { useEffect, useState } from "react";
import { ChevronRight, ChevronDown, FileText, Folder, RefreshCw, Save, Pencil, Eye, Code2, ChevronUp, Wrench, GitBranch, Layers3, Sparkles, PlayCircle, Settings2, CheckCircle2, FolderInput } from "lucide-react";
import { Markdown } from "@/components/Markdown";
import { cn } from "@/lib/cn";
import { api } from "@/lib/api";
import type { FlowTreeNode } from "@/types";

interface Props {
  flowId: string;
  refreshKey?: number;
}

type ViewMode = "preview" | "edit" | "structured";

interface FileState {
  path: string;
  content: string;
  dirty: boolean;
  truncated: boolean;
  loading: boolean;
  saving: boolean;
  viewMode: ViewMode;
  error?: string;
}

type FileCategory = "markdown" | "jsonl" | "json" | "text";

function fileCategory(path: string): FileCategory {
  const lower = path.toLowerCase();
  if (lower.endsWith(".md") || lower.endsWith(".markdown")) return "markdown";
  if (lower.endsWith(".jsonl")) return "jsonl";
  if (lower.endsWith(".json") || lower.endsWith(".jsonc")) return "json";
  return "text";
}

function defaultViewMode(cat: FileCategory): ViewMode {
  switch (cat) {
    case "markdown": return "preview";
    case "jsonl": return "structured";
    case "json": return "preview";
    case "text": return "edit";
  }
}

function findBestFile(nodes: FlowTreeNode[]): string | null {
  const skipDir = (name: string) => name.startsWith(".") || name === "runs";
  for (const n of nodes) {
    if (n.kind === "file" && n.name.toLowerCase() === "readme.md") return n.path;
  }
  for (const n of nodes) {
    if (n.kind === "file" && n.name.toLowerCase() === "operation-guide.md") return n.path;
  }
  for (const n of nodes) {
    if (n.kind === "file" && n.path.startsWith("templates/") && n.name.endsWith(".md")) return n.path;
    if (n.kind === "dir" && !skipDir(n.name) && n.children) {
      const found = findBestFile(n.children);
      if (found) return found;
    }
  }
  for (const n of nodes) {
    if (n.kind === "file" && !n.path.startsWith(".pi-sessions/") && !n.path.startsWith("runs/")) return n.path;
    if (n.kind === "dir" && !skipDir(n.name) && n.children) {
      const found = findBestFile(n.children);
      if (found) return found;
    }
  }
  return null;
}

function parentDirPaths(filePath: string): string[] {
  const parts = filePath.split("/");
  const dirs: string[] = [];
  for (let i = 1; i < parts.length; i++) {
    dirs.push(parts.slice(0, i).join("/"));
  }
  return dirs;
}

interface FlowArtifact {
  id: string;
  title: string;
  caption: string;
  path?: string;
  tone: "entry" | "spec" | "template" | "config" | "output";
  count?: number;
}

function visibleFlowNodes(nodes: FlowTreeNode[]): FlowTreeNode[] {
  return nodes.filter((n) => !(n.path === ".pi-sessions" || n.path.startsWith(".pi-sessions/") || n.path === "runs" || n.path.startsWith("runs/")));
}

function flattenVisibleFiles(nodes: FlowTreeNode[]): FlowTreeNode[] {
  const files: FlowTreeNode[] = [];
  const walk = (items: FlowTreeNode[]) => {
    for (const n of visibleFlowNodes(items)) {
      if (n.kind === "file") files.push(n);
      else walk(n.children ?? []);
    }
  };
  walk(nodes);
  return files;
}

function findNode(nodes: FlowTreeNode[], predicate: (node: FlowTreeNode) => boolean): FlowTreeNode | null {
  for (const n of visibleFlowNodes(nodes)) {
    if (predicate(n)) return n;
    if (n.children) {
      const child = findNode(n.children, predicate);
      if (child) return child;
    }
  }
  return null;
}

function countFiles(node: FlowTreeNode | null): number {
  if (!node) return 0;
  if (node.kind === "file") return 1;
  return (node.children ?? []).reduce((sum, child) => sum + countFiles(child), 0);
}

function buildArtifacts(root: FlowTreeNode | null): FlowArtifact[] {
  const children = root?.children ?? [];
  const files = flattenVisibleFiles(children);
  const readme = findNode(children, (n) => n.kind === "file" && n.name.toLowerCase() === "readme.md");
  const guide = findNode(children, (n) => n.kind === "file" && /operation-guide\.md$/i.test(n.path));
  const piConfig = findNode(children, (n) => n.path === ".pi" || n.path.startsWith(".pi/"));
  const templates = findNode(children, (n) => n.kind === "dir" && n.name.toLowerCase() === "templates");
  const examples = findNode(children, (n) => n.kind === "dir" && /examples?|samples?/i.test(n.name));
  const firstFallback = files[0] ?? null;

  const artifacts: FlowArtifact[] = [
    {
      id: "intent",
      title: "入口说明",
      caption: readme ? "README 已识别，可作为工作流意图与调用入口" : "尚未识别 README，建议补齐入口说明",
      path: readme?.path ?? firstFallback?.path,
      tone: "entry",
    },
    {
      id: "protocol",
      title: "执行协议",
      caption: guide ? "OPERATION-GUIDE 已连接到执行步骤" : "可补充 OPERATION-GUIDE 固化执行 SOP",
      path: guide?.path,
      tone: "spec",
    },
    {
      id: "inputs",
      title: "参数 / 配置",
      caption: piConfig ? ".pi 配置存在，执行参数可被结构化读取" : "未发现 .pi 配置，当前以自由 prompt 驱动",
      path: piConfig?.kind === "file" ? piConfig.path : undefined,
      tone: "config",
      count: countFiles(piConfig),
    },
    {
      id: "templates",
      title: "模板资产",
      caption: templates ? `${countFiles(templates)} 个模板文件可供编排复用` : "暂无 templates/，适合沉淀可复用提示词与产物结构",
      path: templates?.kind === "file" ? templates.path : undefined,
      tone: "template",
      count: countFiles(templates),
    },
    {
      id: "outputs",
      title: "示例 / 产物",
      caption: examples ? `${countFiles(examples)} 个样例文件帮助校验结果形态` : `${files.length} 个工作流文件待整理为可执行资产`,
      path: examples?.kind === "file" ? examples.path : firstFallback?.path,
      tone: "output",
      count: files.length,
    },
  ];

  return artifacts;
}

function artifactToneClass(tone: FlowArtifact["tone"]): string {
  switch (tone) {
    case "entry": return "border-sky-200 bg-sky-50/80 text-sky-950 dark:border-sky-500/25 dark:bg-sky-500/10 dark:text-sky-100";
    case "spec": return "border-violet-200 bg-violet-50/80 text-violet-950 dark:border-violet-500/25 dark:bg-violet-500/10 dark:text-violet-100";
    case "template": return "border-amber-200 bg-amber-50/80 text-amber-950 dark:border-amber-500/25 dark:bg-amber-500/10 dark:text-amber-100";
    case "config": return "border-emerald-200 bg-emerald-50/80 text-emerald-950 dark:border-emerald-500/25 dark:bg-emerald-500/10 dark:text-emerald-100";
    case "output": return "border-neutral-200 bg-white/85 text-neutral-900 dark:border-neutral-700 dark:bg-neutral-900/75 dark:text-neutral-100";
  }
}

function normalizeLocalPath(raw: string): string {
  const withoutScheme = raw.replace(/^file:\/\//, "");
  try {
    return decodeURI(withoutScheme);
  } catch {
    return withoutScheme;
  }
}

function extractLocalFolderRefs(content: string): string[] {
  const matches = content.match(/(?:file:\/\/\/Users\/|\/Users\/)[^\s`)>'\"]+/g) ?? [];
  const cleaned = matches
    .map((m) => normalizeLocalPath(m).replace(/[.,;:，。；：]+$/, ""))
    .filter((m) => m.startsWith("/Users/"));
  return Array.from(new Set(cleaned));
}

interface JsonlEntry {
  role?: string;
  content?: unknown;
  model?: string;
  timestamp?: number;
  raw: string;
  parseError?: boolean;
}

function parseJsonl(content: string): JsonlEntry[] {
  return content
    .split(/\r?\n/)
    .filter((l) => l.trim())
    .map((line) => {
      try {
        const obj = JSON.parse(line) as Record<string, unknown>;
        return {
          role: typeof obj.role === "string" ? obj.role : undefined,
          content: obj.content,
          model: typeof obj.model === "string" ? obj.model : undefined,
          timestamp: typeof obj.timestamp === "number" ? obj.timestamp : undefined,
          raw: line,
        };
      } catch {
        return { raw: line, parseError: true };
      }
    });
}

function extractText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .filter((b): b is Record<string, unknown> => typeof b === "object" && b !== null)
      .filter((b) => b.type === "text" && typeof b.text === "string")
      .map((b) => b.text as string)
      .join("");
  }
  return "";
}

function extractToolUses(content: unknown): Array<{ name?: string; input?: unknown }> {
  if (!Array.isArray(content)) return [];
  return content
    .filter((b): b is Record<string, unknown> => typeof b === "object" && b !== null && b.type === "tool_use")
    .map((b) => ({ name: typeof b.name === "string" ? b.name : undefined, input: b.input }));
}

const ROLE_COLORS: Record<string, string> = {
  user: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300",
  assistant: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300",
  system: "bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-300",
  tool: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300",
};

function prettyJson(content: string): string | null {
  try {
    return JSON.stringify(JSON.parse(content), null, 2);
  } catch {
    return null;
  }
}

function OrchestrationMap({ tree, active, onPick }: { tree: FlowTreeNode | null; active: string | null; onPick: (path: string) => void }) {
  const artifacts = buildArtifacts(tree);
  const files = tree?.children ? flattenVisibleFiles(tree.children) : [];
  const readyCount = artifacts.filter((a) => a.path || (a.count ?? 0) > 0).length;

  return (
    <div className="relative overflow-hidden border-b border-neutral-200 bg-[radial-gradient(circle_at_18%_15%,rgba(14,165,233,0.13),transparent_28%),radial-gradient(circle_at_82%_20%,rgba(245,158,11,0.14),transparent_24%),linear-gradient(180deg,rgba(250,250,250,0.96),rgba(245,245,245,0.62))] px-5 py-4 dark:border-neutral-800 dark:bg-[radial-gradient(circle_at_18%_15%,rgba(14,165,233,0.18),transparent_28%),radial-gradient(circle_at_82%_20%,rgba(245,158,11,0.12),transparent_24%),linear-gradient(180deg,rgba(10,10,10,0.96),rgba(23,23,23,0.72))]">
      <div className="pointer-events-none absolute inset-0 opacity-[0.32] [background-image:linear-gradient(to_right,rgba(115,115,115,0.18)_1px,transparent_1px),linear-gradient(to_bottom,rgba(115,115,115,0.14)_1px,transparent_1px)] [background-size:28px_28px]" />
      <div className="relative mb-4 flex items-start justify-between gap-4">
        <div>
          <div className="inline-flex items-center gap-2 rounded-full border border-neutral-200 bg-white/70 px-2.5 py-1 text-[11px] font-medium uppercase tracking-[0.18em] text-neutral-500 shadow-sm backdrop-blur dark:border-neutral-700 dark:bg-neutral-950/55 dark:text-neutral-400">
            <GitBranch className="h-3.5 w-3.5" strokeWidth={1.75} />
            Visual orchestration
          </div>
          <h2 className="mt-2 text-[18px] font-semibold tracking-tight text-neutral-950 dark:text-neutral-50">工作流编排地图</h2>
          <p className="mt-1 max-w-2xl text-[12.5px] leading-5 text-neutral-500 dark:text-neutral-400">
            把文件夹资产转换成可执行链路：入口 → 协议 → 参数 → 模板 → 产物。点击节点可跳转到对应文件继续编辑。
          </p>
        </div>
        <div className="grid grid-cols-2 gap-2 text-right">
          <div className="rounded-xl border border-neutral-200 bg-white/75 px-3 py-2 shadow-sm backdrop-blur dark:border-neutral-700 dark:bg-neutral-950/55">
            <div className="text-[18px] font-semibold text-neutral-950 dark:text-neutral-50">{files.length}</div>
            <div className="text-[10.5px] text-neutral-500">文件资产</div>
          </div>
          <div className="rounded-xl border border-neutral-200 bg-white/75 px-3 py-2 shadow-sm backdrop-blur dark:border-neutral-700 dark:bg-neutral-950/55">
            <div className="text-[18px] font-semibold text-neutral-950 dark:text-neutral-50">{readyCount}/5</div>
            <div className="text-[10.5px] text-neutral-500">链路就绪</div>
          </div>
        </div>
      </div>

      <div className="relative grid gap-3 lg:grid-cols-5">
        <div className="pointer-events-none absolute left-[8%] right-[8%] top-1/2 hidden h-px -translate-y-1/2 bg-gradient-to-r from-transparent via-neutral-300 to-transparent dark:via-neutral-700 lg:block" />
        {artifacts.map((item, index) => {
          const Icon = index === 0 ? Sparkles : index === 1 ? GitBranch : index === 2 ? Settings2 : index === 3 ? Layers3 : CheckCircle2;
          const selected = !!item.path && item.path === active;
          return (
            <button
              key={item.id}
              onClick={() => item.path && onPick(item.path)}
              disabled={!item.path}
              className={cn(
                "group relative min-h-[136px] rounded-2xl border p-3 text-left shadow-sm backdrop-blur transition-all hover:-translate-y-0.5 hover:shadow-md disabled:cursor-default disabled:opacity-80",
                artifactToneClass(item.tone),
                selected && "ring-2 ring-neutral-900/80 dark:ring-white/80",
              )}
            >
              <div className="mb-3 flex items-center justify-between gap-2">
                <span className="inline-flex h-8 w-8 items-center justify-center rounded-xl bg-white/70 shadow-sm dark:bg-neutral-950/45">
                  <Icon className="h-4 w-4" strokeWidth={1.9} />
                </span>
                <span className="rounded-full bg-white/70 px-2 py-0.5 font-mono text-[10px] text-neutral-500 dark:bg-neutral-950/45 dark:text-neutral-400">0{index + 1}</span>
              </div>
              <div className="text-[13px] font-semibold">{item.title}</div>
              <div className="mt-1.5 line-clamp-3 text-[11.5px] leading-4 opacity-75">{item.caption}</div>
              <div className="mt-3 flex items-center gap-1 text-[10.5px] opacity-60">
                <PlayCircle className="h-3 w-3" strokeWidth={1.75} />
                <span className="truncate">{item.path ?? "待补齐"}</span>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function FlowEditorPane({ flowId, refreshKey }: Props) {
  const [tree, setTree] = useState<FlowTreeNode | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set([""]));
  const [active, setActive] = useState<string | null>(null);
  const [file, setFile] = useState<FileState | null>(null);
  const [reloading, setReloading] = useState(false);
  const [localImporting, setLocalImporting] = useState<string | null>(null);
  const [localImportHint, setLocalImportHint] = useState<string | null>(null);

  function openFile(path: string) {
    const cat = fileCategory(path);
    setActive(path);
    setFile({ path, content: "", dirty: false, truncated: false, loading: true, saving: false, viewMode: defaultViewMode(cat) });
    api
      .flowFileGet(flowId, path)
      .then((r) => setFile({ path, content: r.content, dirty: false, truncated: r.truncated, loading: false, saving: false, viewMode: defaultViewMode(cat) }))
      .catch((err) => setFile({ path, content: "", dirty: false, truncated: false, loading: false, saving: false, viewMode: "edit", error: String(err) }));
  }

  useEffect(() => {
    let cancelled = false;
    setActive(null);
    setFile(null);
    setReloading(true);
    api.flowTree(flowId).then((t) => {
      if (cancelled) return;
      setTree(t);
      setReloading(false);
      if (t.children && t.children.length > 0) {
        const best = findBestFile(t.children);
        if (best) {
          setActive(best);
          const cat = fileCategory(best);
          const dirs = parentDirPaths(best);
          if (dirs.length > 0) {
            setExpanded((s) => {
              const n = new Set(s);
              dirs.forEach((d) => n.add(d));
              return n;
            });
          }
          setFile({ path: best, content: "", dirty: false, truncated: false, loading: true, saving: false, viewMode: defaultViewMode(cat) });
          api.flowFileGet(flowId, best).then((r) => {
            if (cancelled) return;
            setFile({ path: best, content: r.content, dirty: false, truncated: r.truncated, loading: false, saving: false, viewMode: defaultViewMode(cat) });
          }).catch(() => {});
        }
      }
    }).catch(() => {
      if (!cancelled) setReloading(false);
    });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flowId, refreshKey]);

  function save() {
    if (!file || !file.dirty || file.saving) return;
    setFile({ ...file, saving: true });
    api
      .flowFilePut(flowId, file.path, file.content)
      .then(() => setFile((f) => (f ? { ...f, dirty: false, saving: false } : f)))
      .catch((err) => setFile((f) => (f ? { ...f, saving: false, error: String(err) } : f)));
  }

  function loadTree() {
    setReloading(true);
    api
      .flowTree(flowId)
      .then((t) => setTree(t))
      .finally(() => setReloading(false));
  }

  async function importLocalFolder(path: string): Promise<void> {
    setLocalImporting(path);
    setLocalImportHint(null);
    try {
      const result = await api.importLocalFolder(flowId, path);
      setLocalImportHint(`已导入「${result.sourceName}」${result.count} 个文件`);
      const nextTree = await api.flowTree(flowId);
      setTree(nextTree);
      const best = findBestFile(nextTree.children ?? []);
      if (best) openFile(best);
    } catch (err) {
      setLocalImportHint(`导入失败：${String(err)}`);
    } finally {
      setLocalImporting(null);
    }
  }

  const cat = file ? fileCategory(file.path) : "text";
  const localRefs = file ? extractLocalFolderRefs(file.content) : [];

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-neutral-50/40 dark:bg-neutral-950/40">
      <OrchestrationMap tree={tree} active={active} onPick={openFile} />
      <div className="flex min-h-0 flex-1">
      <aside className="flex w-72 shrink-0 flex-col border-r border-neutral-200 bg-white/75 backdrop-blur dark:border-neutral-800 dark:bg-neutral-950/40">
        <div className="flex h-10 shrink-0 items-center justify-between px-3 text-[12px] text-neutral-500 dark:text-neutral-400">
          <span>工作流文件</span>
          <button
            onClick={loadTree}
            disabled={reloading}
            title="刷新"
            className="inline-flex h-6 w-6 items-center justify-center rounded-md hover:bg-neutral-100 hover:text-neutral-900 disabled:opacity-40 dark:hover:bg-neutral-800 dark:hover:text-neutral-100"
          >
            <RefreshCw className={cn("h-3.5 w-3.5", reloading && "animate-spin")} strokeWidth={1.75} />
          </button>
        </div>
        <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto px-1 pb-2">
          {!tree || !tree.children || tree.children.length === 0 ? (
            <div className="px-3 py-6 text-center text-[12px] text-neutral-400 dark:text-neutral-500">
              文件夹为空 — 在「pi 对话」中导入本地工作流文件夹
            </div>
          ) : (
            <TreeView
              nodes={tree.children}
              depth={0}
              expanded={expanded}
              onToggle={(p) => {
                setExpanded((s) => {
                  const n = new Set(s);
                  if (n.has(p)) n.delete(p);
                  else n.add(p);
                  return n;
                });
              }}
              active={active}
              onPick={openFile}
            />
          )}
        </div>
      </aside>

      <section className="flex min-w-0 flex-1 flex-col bg-white/80 dark:bg-neutral-950/20">
        {!file ? (
          <div className="flex flex-1 items-center justify-center text-[13px] text-neutral-400 dark:text-neutral-500">
            从左侧选择一个文件查看 / 编辑
          </div>
        ) : (
          <>
            <div className="flex h-10 shrink-0 items-center gap-2 border-b border-neutral-200 px-4 text-[12.5px] dark:border-neutral-800">
              <span className="min-w-0 flex-1 truncate font-mono text-neutral-700 dark:text-neutral-300">{file.path}</span>
              {file.truncated && <span className="shrink-0 text-[11px] text-amber-600 dark:text-amber-400">已截断</span>}
              {file.dirty && <span className="shrink-0 text-[11px] text-neutral-400">●未保存</span>}

              {cat === "markdown" && (
                <button
                  onClick={() => setFile((f) => (f ? { ...f, viewMode: f.viewMode === "preview" ? "edit" : "preview" } : f))}
                  className="inline-flex h-7 items-center gap-1 rounded-md border border-neutral-200 bg-white px-2 text-[12px] text-neutral-700 hover:bg-neutral-50 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-300 dark:hover:bg-neutral-800"
                  title={file.viewMode === "preview" ? "切换到编辑模式" : "切换到预览模式"}
                >
                  {file.viewMode === "preview" ? <Pencil className="h-3 w-3" strokeWidth={1.75} /> : <Eye className="h-3 w-3" strokeWidth={1.75} />}
                  {file.viewMode === "preview" ? "编辑" : "预览"}
                </button>
              )}
              {cat === "jsonl" && (
                <button
                  onClick={() => setFile((f) => (f ? { ...f, viewMode: f.viewMode === "structured" ? "edit" : "structured" } : f))}
                  className="inline-flex h-7 items-center gap-1 rounded-md border border-neutral-200 bg-white px-2 text-[12px] text-neutral-700 hover:bg-neutral-50 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-300 dark:hover:bg-neutral-800"
                  title={file.viewMode === "structured" ? "查看原始 JSONL" : "查看结构化视图"}
                >
                  {file.viewMode === "structured" ? <Code2 className="h-3 w-3" strokeWidth={1.75} /> : <Eye className="h-3 w-3" strokeWidth={1.75} />}
                  {file.viewMode === "structured" ? "源码" : "结构化"}
                </button>
              )}
              {cat === "json" && (
                <button
                  onClick={() => setFile((f) => (f ? { ...f, viewMode: f.viewMode === "preview" ? "edit" : "preview" } : f))}
                  className="inline-flex h-7 items-center gap-1 rounded-md border border-neutral-200 bg-white px-2 text-[12px] text-neutral-700 hover:bg-neutral-50 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-300 dark:hover:bg-neutral-800"
                  title={file.viewMode === "preview" ? "切换到编辑模式" : "切换到预览模式"}
                >
                  {file.viewMode === "preview" ? <Pencil className="h-3 w-3" strokeWidth={1.75} /> : <Eye className="h-3 w-3" strokeWidth={1.75} />}
                  {file.viewMode === "preview" ? "编辑" : "预览"}
                </button>
              )}

              <button
                onClick={save}
                disabled={!file.dirty || file.saving}
                className={cn(
                  "inline-flex h-7 items-center gap-1 rounded-md px-2 text-[12px]",
                  file.dirty && !file.saving
                    ? "bg-neutral-900 text-white hover:bg-neutral-700 dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-white"
                    : "bg-neutral-200 text-neutral-400 dark:bg-neutral-800 dark:text-neutral-600",
                )}
              >
                <Save className="h-3.5 w-3.5" strokeWidth={1.75} />
                {file.saving ? "保存中" : "保存"}
              </button>
            </div>

            {(localRefs.length > 0 || localImportHint) && (
              <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-sky-200/70 bg-sky-50 px-4 py-2 text-[12px] text-sky-800 dark:border-sky-900/40 dark:bg-sky-950/30 dark:text-sky-200">
                <FolderInput className="h-3.5 w-3.5 shrink-0" strokeWidth={1.75} />
                {localImportHint ? <span>{localImportHint}</span> : <span>检测到本机目录引用，当前编辑器只显示工作流沙盒内文件，可导入后编辑：</span>}
                {localRefs.slice(0, 3).map((path) => (
                  <button
                    key={path}
                    onClick={() => void importLocalFolder(path)}
                    disabled={!!localImporting}
                    className="inline-flex max-w-[420px] items-center gap-1 rounded-md border border-sky-200 bg-white/80 px-2 py-1 font-mono text-[11px] text-sky-900 hover:bg-white disabled:opacity-60 dark:border-sky-800 dark:bg-sky-950/50 dark:text-sky-100"
                    title={path}
                  >
                    {localImporting === path && <RefreshCw className="h-3 w-3 animate-spin" strokeWidth={1.75} />}
                    <span className="truncate">导入 {path}</span>
                  </button>
                ))}
              </div>
            )}

            <div className="min-h-0 flex-1">
              {file.loading ? (
                <div className="flex h-full items-center justify-center text-[13px] text-neutral-400">加载中…</div>
              ) : file.error ? (
                <div className="p-4 text-[13px] text-red-500">{file.error}</div>
              ) : cat === "markdown" && file.viewMode === "preview" ? (
                <div className="scrollbar-thin h-full overflow-y-auto px-8 py-6">
                  <Markdown>{file.content || "_（空文件）_"}</Markdown>
                </div>
              ) : cat === "jsonl" && file.viewMode === "structured" ? (
                <JsonlStructuredView content={file.content} />
              ) : cat === "json" && file.viewMode === "preview" ? (
                <div className="scrollbar-thin h-full overflow-y-auto p-4">
                  <pre className="whitespace-pre-wrap font-mono text-[12.5px] leading-6 text-neutral-800 dark:text-neutral-200">
                    {prettyJson(file.content) || file.content}
                  </pre>
                </div>
              ) : (
                <textarea
                  value={file.content}
                  onChange={(e) => setFile({ ...file, content: e.target.value, dirty: true })}
                  onKeyDown={(e) => {
                    if ((e.metaKey || e.ctrlKey) && e.key === "s") {
                      e.preventDefault();
                      save();
                    }
                    if (e.key === "Tab") {
                      e.preventDefault();
                      const ta = e.currentTarget;
                      const start = ta.selectionStart;
                      const end = ta.selectionEnd;
                      const next = file.content.slice(0, start) + "  " + file.content.slice(end);
                      setFile({ ...file, content: next, dirty: true });
                      requestAnimationFrame(() => {
                        ta.selectionStart = ta.selectionEnd = start + 2;
                      });
                    }
                  }}
                  spellCheck={false}
                  className="block h-full w-full resize-none bg-transparent p-4 font-mono text-[12.5px] leading-6 text-neutral-900 outline-none dark:text-neutral-100"
                />
              )}
            </div>
          </>
        )}
      </section>
      </div>
    </div>
  );
}

function JsonlStructuredView({ content }: { content: string }) {
  const entries = parseJsonl(content);
  if (entries.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-[13px] text-neutral-400">
        空文件
      </div>
    );
  }
  return (
    <div className="scrollbar-thin h-full overflow-y-auto px-6 py-4">
      <div className="mx-auto max-w-[820px] space-y-2.5">
        <div className="pb-2 text-[11px] text-neutral-400 dark:text-neutral-500">
          共 {entries.length} 条记录 · 只读视图（切换到「源码」可编辑）
        </div>
        {entries.map((entry, i) => (
          <JsonlEntryCard key={i} entry={entry} index={i} />
        ))}
      </div>
    </div>
  );
}

function JsonlEntryCard({ entry, index }: { entry: JsonlEntry; index: number }) {
  const [open, setOpen] = useState(false);
  if (entry.parseError) {
    return (
      <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-[12px] text-red-700 dark:border-red-900/40 dark:bg-red-950/30 dark:text-red-300">
        <span className="font-mono opacity-60">#{index + 1}</span> 解析失败：
        <span className="ml-1 font-mono">{entry.raw.slice(0, 200)}</span>
      </div>
    );
  }
  const role = entry.role || "unknown";
  const text = entry.content !== undefined ? extractText(entry.content) : "";
  const tools = entry.content !== undefined ? extractToolUses(entry.content) : [];
  const roleColor = ROLE_COLORS[role] || "bg-neutral-100 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-400";
  const shortText = text.length > 400 && !open ? text.slice(0, 400) + "…" : text;

  return (
    <div className="rounded-lg border border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900/40">
      <div className="flex items-start gap-2.5 px-3.5 py-2.5">
        <span className={cn("mt-0.5 inline-flex h-5 shrink-0 items-center rounded px-1.5 text-[10px] font-medium uppercase tracking-wide", roleColor)}>
          {role}
        </span>
        <div className="min-w-0 flex-1">
          {text && (
            <div className="whitespace-pre-wrap break-words text-[13px] leading-relaxed text-neutral-800 dark:text-neutral-200">
              {shortText}
            </div>
          )}
          {tools.length > 0 && (
            <div className="mt-1.5 space-y-1">
              {tools.map((t, i) => (
                <div key={i} className="flex items-center gap-1.5 text-[11.5px] text-neutral-500 dark:text-neutral-400">
                  <Wrench className="h-3 w-3 shrink-0" strokeWidth={1.75} />
                  <span className="font-mono">{t.name || "tool"}</span>
                  <span className="truncate font-mono opacity-70">({JSON.stringify(t.input).slice(0, 100)})</span>
                </div>
              ))}
            </div>
          )}
          {(entry.model || entry.timestamp) && (
            <div className="mt-1.5 flex items-center gap-2 text-[10.5px] text-neutral-400 dark:text-neutral-500">
              <span className="font-mono opacity-60">#{index + 1}</span>
              {entry.model && <span>{entry.model}</span>}
              {entry.timestamp && <span>{new Date(entry.timestamp).toLocaleString("zh-CN")}</span>}
            </div>
          )}
        </div>
        {(text.length > 400 || tools.length > 0) && (
          <button
            onClick={() => setOpen((v) => !v)}
            className="shrink-0 text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200"
            title={open ? "收起" : "展开"}
          >
            {open ? <ChevronUp className="h-3.5 w-3.5" strokeWidth={1.75} /> : <ChevronDown className="h-3.5 w-3.5" strokeWidth={1.75} />}
          </button>
        )}
      </div>
    </div>
  );
}

function TreeView({
  nodes,
  depth,
  expanded,
  onToggle,
  active,
  onPick,
}: {
  nodes: FlowTreeNode[];
  depth: number;
  expanded: Set<string>;
  onToggle: (p: string) => void;
  active: string | null;
  onPick: (p: string) => void;
}) {
  const visibleNodes = nodes.filter((n) => !(n.path === ".pi-sessions" || n.path.startsWith(".pi-sessions/") || n.path === "runs" || n.path.startsWith("runs/")));
  return (
    <ul className="select-none">
      {visibleNodes.map((n) => {
        const isDir = n.kind === "dir";
        const isOpen = expanded.has(n.path);
        const isActive = active === n.path;
        return (
          <li key={n.path}>
            <button
              onClick={() => (isDir ? onToggle(n.path) : onPick(n.path))}
              className={cn(
                "flex w-full items-center gap-1 rounded-md px-1.5 py-1 text-left text-[12.5px]",
                isActive
                  ? "bg-neutral-200/70 text-neutral-900 dark:bg-neutral-800 dark:text-neutral-100"
                  : "text-neutral-700 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-800/60",
              )}
              style={{ paddingLeft: 6 + depth * 12 }}
            >
              {isDir ? (
                isOpen ? (
                  <ChevronDown className="h-3.5 w-3.5 shrink-0 text-neutral-400" strokeWidth={1.75} />
                ) : (
                  <ChevronRight className="h-3.5 w-3.5 shrink-0 text-neutral-400" strokeWidth={1.75} />
                )
              ) : (
                <span className="w-3.5 shrink-0" />
              )}
              {isDir ? (
                <Folder className="h-3.5 w-3.5 shrink-0 text-neutral-500" strokeWidth={1.75} />
              ) : (
                <FileText className="h-3.5 w-3.5 shrink-0 text-neutral-400" strokeWidth={1.75} />
              )}
              <span className="min-w-0 flex-1 truncate">{n.name}</span>
            </button>
            {isDir && isOpen && n.children && n.children.length > 0 && (
              <TreeView
                nodes={n.children}
                depth={depth + 1}
                expanded={expanded}
                onToggle={onToggle}
                active={active}
                onPick={onPick}
              />
            )}
          </li>
        );
      })}
    </ul>
  );
}
