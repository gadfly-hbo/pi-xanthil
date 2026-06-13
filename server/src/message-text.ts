/**
 * 从 pi 消息 content 数组抽取纯文本（接缝层 · T-C2b）。
 *
 * 仅取 type==="text" 且 text 为字符串的块，用换行连接（不 trim）。
 * 被 flow 聊天 handler 与 subagent 委派 run 共用，故从 index.ts 上移为共享。
 */
export function flowMessageText(content: unknown): string {
  if (!Array.isArray(content)) return "";
  return content
    .filter((c): c is { type: string; text: string } => !!c && typeof c === "object" && (c as { type?: unknown }).type === "text" && typeof (c as { text?: unknown }).text === "string")
    .map((c) => c.text)
    .join("\n");
}
