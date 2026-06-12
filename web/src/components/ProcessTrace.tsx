import { useState } from "react";
import { ChevronRight, Terminal, FileSearch, FilePen, Globe, Wrench, CheckCircle2, XCircle, Loader2, Eye, type LucideIcon } from "lucide-react";
import { api } from "@/lib/api";
import type { ContentBlock } from "@/types";

// Map common pi tool names to an icon for a glanceable trace.
const TOOL_ICONS: Record<string, LucideIcon> = {
  bash: Terminal,
  read: FileSearch,
  write: FilePen,
  edit: FilePen,
  web_fetch: Globe,
  web_search: Globe,
};

function toolIcon(name?: string): LucideIcon {
  if (!name) return Wrench;
  return TOOL_ICONS[name] ?? Wrench;
}

function preview(value: unknown, max = 2000): string {
  if (value == null) return "";
  if (typeof value === "string") return value.slice(0, max);
  try {
    return JSON.stringify(value, null, 2).slice(0, max);
  } catch {
    return String(value).slice(0, max);
  }
}

type ToolRunSummary = {
  runId?: string;
  toolId?: string;
  success?: number;
  failed?: number;
  error?: string;
  stdout?: string;
  stderr?: string;
  results?: Array<{ outputs?: string[]; [key: string]: unknown }>;
  [key: string]: unknown;
};

type PreviewState =
  | { status: "idle" }
  | { status: "loading"; path: string }
  | { status: "ready"; path: string; name: string; content: string; truncated: boolean }
  | { status: "unpreviewable"; path: string; name: string; size: number }
  | { status: "error"; path: string; message: string };

function parseJsonString(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function normalizeToolContent(content: unknown): unknown {
  if (typeof content === "string") return parseJsonString(content);
  if (Array.isArray(content)) {
    const text = content
      .map((item) => {
        if (typeof item === "string") return item;
        if (item && typeof item === "object" && "text" in item && typeof item.text === "string") return item.text;
        return "";
      })
      .filter(Boolean)
      .join("\n");
    return text ? parseJsonString(text) : content;
  }
  return content;
}

function asToolRunSummary(content: unknown): ToolRunSummary | null {
  const value = normalizeToolContent(content);
  return value && typeof value === "object" && !Array.isArray(value) ? value as ToolRunSummary : null;
}

function outputFiles(summary: ToolRunSummary | null): string[] {
  const files = new Set<string>();
  for (const result of summary?.results ?? []) {
    for (const path of result.outputs ?? []) {
      if (typeof path === "string" && path.trim()) files.add(path);
    }
  }
  return [...files];
}

function basename(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).at(-1) ?? path;
}

export function ToolUse({ block }: { block: Extract<ContentBlock, { type: "tool_use" }> }) {
  const Icon = toolIcon(block.name);
  const arg = preview(block.input, 240).replace(/\s+/g, " ");
  const status = block.status ?? "completed";
  const statusLabel = status === "running" ? "调用中" : status === "error" ? "失败" : "完成";
  const StatusIcon = status === "running" ? Loader2 : status === "error" ? XCircle : CheckCircle2;
  return (
    <details open={status === "running"} className="group min-w-0 rounded-md border border-neutral-200 bg-white p-2 text-[13px] shadow-sm dark:border-neutral-800 dark:bg-neutral-950">
      <summary className="flex cursor-pointer select-none items-center gap-1.5 text-neutral-600 hover:text-neutral-800 dark:text-neutral-300 dark:hover:text-neutral-100">
        <ChevronRight className="h-3.5 w-3.5 shrink-0 transition-transform group-open:rotate-90" strokeWidth={2} />
        <Icon className="h-3.5 w-3.5 shrink-0" strokeWidth={1.75} />
        <span className="font-medium">{block.name ?? "tool"}</span>
        <span className="inline-flex items-center gap-1 rounded bg-neutral-100 px-1.5 py-0.5 text-[10.5px] text-neutral-500 dark:bg-neutral-800 dark:text-neutral-400">
          <StatusIcon className={`h-3 w-3 ${status === "running" ? "animate-spin" : status === "error" ? "text-red-500" : "text-emerald-500"}`} strokeWidth={2} />
          {statusLabel}
        </span>
        {arg && <span className="truncate font-mono text-[11px] text-neutral-400 dark:text-neutral-500">{arg}</span>}
      </summary>
      <pre className="scrollbar-thin mt-1.5 max-h-72 overflow-auto rounded-md border border-neutral-200 bg-neutral-50 p-2 font-mono text-[11px] leading-relaxed text-neutral-700 dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-300">
        {preview(block.input)}
      </pre>
    </details>
  );
}

export function ToolResult({ block }: { block: Extract<ContentBlock, { type: "tool_result" }> }) {
  const isError = block.is_error === true;
  const summary = asToolRunSummary(block.content);
  const files = outputFiles(summary);
  const body = preview(normalizeToolContent(block.content));
  const Icon = isError ? XCircle : CheckCircle2;
  const [filePreview, setFilePreview] = useState<PreviewState>({ status: "idle" });

  async function openPreview(path: string): Promise<void> {
    setFilePreview({ status: "loading", path });
    try {
      const result = await api.previewExtractionFile(path, path);
      if (!result.previewable) {
        setFilePreview({ status: "unpreviewable", path, name: result.name, size: result.size });
      } else {
        setFilePreview({ status: "ready", path, name: result.name, content: result.content ?? "", truncated: result.truncated });
      }
    } catch (err) {
      setFilePreview({ status: "error", path, message: String(err) });
    }
  }

  return (
    <details open className="group min-w-0 rounded-md border border-neutral-200 bg-white p-2 text-[13px] shadow-sm dark:border-neutral-800 dark:bg-neutral-950">
      <summary className="flex cursor-pointer select-none items-center gap-1.5 text-neutral-600 hover:text-neutral-800 dark:text-neutral-300 dark:hover:text-neutral-100">
        <ChevronRight className="h-3.5 w-3.5 shrink-0 transition-transform group-open:rotate-90" strokeWidth={2} />
        <Icon className={isError ? "h-3.5 w-3.5 shrink-0 text-red-500" : "h-3.5 w-3.5 shrink-0 text-emerald-500"} strokeWidth={2} />
        <span className="font-medium">{block.name ?? summary?.toolId ?? "工具结果"}</span>
        <span className={`rounded px-1.5 py-0.5 text-[10.5px] ${isError ? "bg-red-50 text-red-600 dark:bg-red-950/40 dark:text-red-300" : "bg-emerald-50 text-emerald-600 dark:bg-emerald-950/40 dark:text-emerald-300"}`}>
          {isError ? "失败" : "完成"}
        </span>
        {summary?.runId && <span className="font-mono text-[10.5px] text-neutral-400">{summary.runId}</span>}
      </summary>
      {summary && (
        <div className="mt-2 grid gap-2 text-[12px] text-neutral-600 dark:text-neutral-300">
          <div className="flex flex-wrap gap-2">
            {typeof summary.success === "number" && <span className="rounded bg-neutral-100 px-2 py-1 dark:bg-neutral-900">成功 {summary.success}</span>}
            {typeof summary.failed === "number" && <span className="rounded bg-neutral-100 px-2 py-1 dark:bg-neutral-900">失败 {summary.failed}</span>}
            {summary.error && <span className="rounded bg-red-50 px-2 py-1 text-red-600 dark:bg-red-950/40 dark:text-red-300">{summary.error}</span>}
          </div>
          {files.length > 0 && (
            <div className="rounded-md border border-neutral-200 bg-neutral-50 p-2 dark:border-neutral-800 dark:bg-neutral-900">
              <div className="mb-1 text-[11px] font-medium text-neutral-500 dark:text-neutral-400">产物</div>
              <div className="grid gap-1">
                {files.map((path) => (
                  <button
                    type="button"
                    key={path}
                    onClick={() => void openPreview(path)}
                    className="flex min-w-0 items-center gap-1.5 rounded px-1.5 py-1 text-left font-mono text-[11px] text-neutral-600 hover:bg-white hover:text-neutral-900 dark:text-neutral-300 dark:hover:bg-neutral-800 dark:hover:text-neutral-100"
                    title={path}
                  >
                    <Eye className="h-3.5 w-3.5 shrink-0" strokeWidth={1.75} />
                    <span className="truncate">{basename(path)}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
          {filePreview.status !== "idle" && (
            <div className="rounded-md border border-neutral-200 bg-neutral-50 dark:border-neutral-800 dark:bg-neutral-900">
              <div className="flex items-center justify-between gap-2 border-b border-neutral-200 px-2 py-1.5 dark:border-neutral-800">
                <span className="truncate font-mono text-[11px] text-neutral-500" title={filePreview.status === "loading" ? filePreview.path : filePreview.path}>
                  {filePreview.status === "loading" ? basename(filePreview.path) : filePreview.status === "ready" || filePreview.status === "unpreviewable" ? filePreview.name : basename(filePreview.path)}
                </span>
                <button type="button" onClick={() => setFilePreview({ status: "idle" })} className="text-[11px] text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200">关闭</button>
              </div>
              {filePreview.status === "loading" ? (
                <div className="flex items-center gap-2 px-2 py-3 text-[12px] text-neutral-400"><Loader2 className="h-3.5 w-3.5 animate-spin" />加载中</div>
              ) : filePreview.status === "error" ? (
                <div className="px-2 py-3 text-[12px] text-red-500">{filePreview.message}</div>
              ) : filePreview.status === "unpreviewable" ? (
                <div className="px-2 py-3 text-[12px] text-neutral-400">该文件类型暂不支持预览（{(filePreview.size / 1024).toFixed(1)} KB）</div>
              ) : (
                <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words px-2 py-2 font-mono text-[11px] leading-5 text-neutral-700 dark:text-neutral-300">
                  {filePreview.content || "（空文件）"}{filePreview.truncated ? "\n\n（预览已截断）" : ""}
                </pre>
              )}
            </div>
          )}
        </div>
      )}
      <pre className="scrollbar-thin mt-1.5 max-h-72 overflow-auto rounded-md border-l-2 border-neutral-300 bg-neutral-50 p-2 pl-3 font-mono text-[11px] leading-relaxed text-neutral-600 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-400">
        {body}
      </pre>
    </details>
  );
}

export function Thinking({ text }: { text: string }) {
  return (
    <details className="group min-w-0 text-[13px]">
      <summary className="flex cursor-pointer select-none items-center gap-1.5 italic text-neutral-400 hover:text-neutral-600 dark:text-neutral-500 dark:hover:text-neutral-300">
        <ChevronRight className="h-3.5 w-3.5 shrink-0 transition-transform group-open:rotate-90" strokeWidth={2} />
        <span>思考过程</span>
      </summary>
      <div className="mt-1.5 whitespace-pre-wrap border-l-2 border-neutral-200 pl-3 text-[12.5px] italic leading-relaxed text-neutral-500 dark:border-neutral-800 dark:text-neutral-400">
        {text}
      </div>
    </details>
  );
}
