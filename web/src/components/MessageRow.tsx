import { memo, type ReactNode } from "react";
import { AlertTriangle } from "lucide-react";
import { Markdown } from "@/components/Markdown";
import { CopyButton } from "@/components/CopyButton";
import { ToolUse, ToolResult, Thinking } from "@/components/ProcessTrace";
import type { ContentBlock, MetricVerification, Role } from "@/types";

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
  return m.role === "tool" || m.content.some((block) => block.type !== "text" && block.type !== "metric_verification");
}

export function hasToolBlocks(m: UiMessage): boolean {
  return m.content.some((block) => block.type === "tool_use" || block.type === "tool_result");
}

function MetricVerificationAlert({ verification }: { verification: MetricVerification }) {
  const suspects = verification.hits.filter((hit) => hit.status === "suspect" || hit.status === "fabricated" || hit.status === "label_mismatch");
  if (suspects.length === 0) return null;
  return (
    <div className="mt-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-[12px] leading-5 text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-200">
      <div className="flex items-center gap-2 font-medium">
        <AlertTriangle className="h-3.5 w-3.5 shrink-0" strokeWidth={2} />
        <span>模型引用数值与代码计算值不符</span>
      </div>
      <div className="mt-1 space-y-0.5">
        {suspects.map((hit) => (
          <div key={`${hit.name}:${hit.expected}:${hit.foundInText ?? "null"}`} className="font-mono text-[11px]">
            {hit.status === "fabricated" && `疑似捏造数字: ${hit.foundInText}`}
            {hit.status === "label_mismatch" && `${hit.name}: expected ${hit.expected}, found ${hit.foundInText} 但上下文指标为「${hit.contextLabel ?? "未知"}」`}
            {hit.status === "suspect" && `${hit.name}: expected ${hit.expected}, found ${hit.foundInText ?? "未引用"}`}
          </div>
        ))}
      </div>
    </div>
  );
}

export const MessageRow = memo(function MessageRow({ m, showTrace = false, action = null }: { m: UiMessage; showTrace?: boolean; action?: ReactNode }) {
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
        {results.map((b, i) => (
          <ToolResult key={i} block={b as Extract<ContentBlock, { type: "tool_result" }>} />
        ))}
      </>
    );
  }

  if (m.role === "tool") {
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
        if (b.type === "tool_use") return <ToolUse key={i} block={b as Extract<ContentBlock, { type: "tool_use" }>} />;
        if (b.type === "tool_result") return <ToolResult key={i} block={b as Extract<ContentBlock, { type: "tool_result" }>} />;
        if (b.type === "metric_verification") {
          return <MetricVerificationAlert key={i} verification={(b as Extract<ContentBlock, { type: "metric_verification" }>).verification} />;
        }
        if (b.type === "thinking") {
          const t = (b as { thinking?: string; text?: string }).thinking ?? (b as { text?: string }).text ?? "";
          return showTrace && t ? <Thinking key={i} text={t} /> : null;
        }
        return null;
      })}
      {(assistantText || action) && (
        <div className="mt-1 flex items-center justify-start gap-1 opacity-0 transition-opacity group-hover:opacity-100">
          {action}
          {assistantText && (
            <CopyButton text={assistantText} />
          )}
        </div>
      )}
    </div>
  );
});
