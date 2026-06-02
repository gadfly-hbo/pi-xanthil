import { memo } from "react";
import { AlertTriangle } from "lucide-react";
import { Markdown } from "@/components/Markdown";
import { CopyButton } from "@/components/CopyButton";
import { ToolUse, ToolResult, Thinking } from "@/components/ProcessTrace";
import type { ContentBlock, Role } from "@/types";

export interface UiMessage {
  id: string;
  role: Role;
  content: ContentBlock[];
  error?: string;
}

function textOfBlocks(blocks: ContentBlock[]): string {
  return blocks
    .filter((b): b is { type: "text"; text: string } => b.type === "text")
    .map((b) => b.text)
    .join("");
}

export function hasTraceBlocks(m: UiMessage): boolean {
  return m.role === "tool" || m.content.some((block) => block.type !== "text");
}

export const MessageRow = memo(function MessageRow({ m, showTrace = false }: { m: UiMessage; showTrace?: boolean }) {
  if (m.error) {
    return (
      <div className="flex gap-3">
        <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-red-500/10 text-red-500">
          <AlertTriangle className="h-3.5 w-3.5" strokeWidth={2} />
        </div>
        <div className="min-w-0 flex-1 pt-0.5 text-[14px] leading-relaxed text-red-500">{m.error}</div>
      </div>
    );
  }

  // User: text → pill bubble; any tool_result blocks (agent-loop results) → trace.
  if (m.role === "user") {
    const text = textOfBlocks(m.content);
    const results = m.content.filter((b) => b.type === "tool_result");
    return (
      <>
        {text && (
          <div className="flex w-full justify-end">
            <div className="min-w-0 max-w-[78%] overflow-hidden rounded-[22px] bg-neutral-100 px-4 py-2.5 text-[14px] leading-relaxed text-neutral-900 dark:bg-neutral-800 dark:text-neutral-100">
              <Markdown>{text}</Markdown>
            </div>
          </div>
        )}
        {showTrace && results.map((b, i) => (
          <ToolResult key={i} block={b as Extract<ContentBlock, { type: "tool_result" }>} />
        ))}
      </>
    );
  }

  if (m.role === "tool") {
    if (!showTrace) return null;
    return (
      <>
        {m.content.map((b, i) =>
          b.type === "tool_result" ? (
            <ToolResult key={i} block={b as Extract<ContentBlock, { type: "tool_result" }>} />
          ) : null,
        )}
      </>
    );
  }

  // Assistant: render blocks in order (thinking / text prose / tool calls).
  const assistantText = textOfBlocks(m.content);
  return (
    <div className="group min-w-0">
      {m.content.map((b, i) => {
        if (b.type === "text") {
          const text = (b as { text?: string }).text ?? "";
          return text ? (
            <div key={i} className="text-[14px] leading-relaxed text-neutral-900 dark:text-neutral-100">
              <Markdown>{text}</Markdown>
            </div>
          ) : null;
        }
        if (b.type === "tool_use") return showTrace ? <ToolUse key={i} block={b as Extract<ContentBlock, { type: "tool_use" }>} /> : null;
        if (b.type === "tool_result") return showTrace ? <ToolResult key={i} block={b as Extract<ContentBlock, { type: "tool_result" }>} /> : null;
        if (b.type === "thinking") {
          const t = (b as { thinking?: string; text?: string }).thinking ?? (b as { text?: string }).text ?? "";
          return showTrace && t ? <Thinking key={i} text={t} /> : null;
        }
        return null;
      })}
      {assistantText && (
        <div className="mt-1 flex justify-start opacity-0 transition-opacity group-hover:opacity-100">
          <CopyButton text={assistantText} />
        </div>
      )}
    </div>
  );
});
