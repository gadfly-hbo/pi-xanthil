import { ChevronRight, Terminal, FileSearch, FilePen, Globe, Wrench, CheckCircle2, XCircle, type LucideIcon } from "lucide-react";
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

export function ToolUse({ block }: { block: Extract<ContentBlock, { type: "tool_use" }> }) {
  const Icon = toolIcon(block.name);
  const arg = preview(block.input, 240).replace(/\s+/g, " ");
  return (
    <details className="group min-w-0 text-[13px]">
      <summary className="flex cursor-pointer select-none items-center gap-1.5 text-neutral-500 hover:text-neutral-700 dark:text-neutral-400 dark:hover:text-neutral-200">
        <ChevronRight className="h-3.5 w-3.5 shrink-0 transition-transform group-open:rotate-90" strokeWidth={2} />
        <Icon className="h-3.5 w-3.5 shrink-0" strokeWidth={1.75} />
        <span className="font-medium">{block.name ?? "tool"}</span>
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
  const body = preview(typeof block.content === "object" ? block.content : block.content);
  const Icon = isError ? XCircle : CheckCircle2;
  return (
    <details className="group min-w-0 text-[13px]">
      <summary className="flex cursor-pointer select-none items-center gap-1.5 text-neutral-500 hover:text-neutral-700 dark:text-neutral-400 dark:hover:text-neutral-200">
        <ChevronRight className="h-3.5 w-3.5 shrink-0 transition-transform group-open:rotate-90" strokeWidth={2} />
        <Icon className={isError ? "h-3.5 w-3.5 shrink-0 text-red-500" : "h-3.5 w-3.5 shrink-0 text-emerald-500"} strokeWidth={2} />
        <span className="font-medium">{isError ? "工具出错" : "工具结果"}</span>
      </summary>
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
