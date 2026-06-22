import { runPiPrompt } from "./pi-adapter.ts";
import type { PiEvent, PromptDraft, StoredMessage } from "./types.ts";

export interface PromptDistillationOptions {
  workspaceRoot: string;
  sessionId: string;
  messages: StoredMessage[];
  model?: string;
  timeoutMs?: number;
  distillText?: (prompt: string) => Promise<string>;
  onEvent?: (event: PiEvent) => void;
}

export const PROMPT_DISTILLATION_SYSTEM_PROMPT =
  "你是可复用 prompt 提炼助手。只从已成功完成的对话中提炼真正驱动成功结果的用户指令，"
  + "删除一次性上下文，把具体文件名、日期、地区、指标和数值抽象成 {{variable}} 占位符。"
  + "不得复述原始数据行、样本值、PII、密钥、token 或 cookie。只输出指定 frontmatter 和正文，不输出解释或代码围栏。";

export const DEFAULT_PROMPT_DISTILLATION_MODEL = "minimax-cn/MiniMax-M3";

const VARIABLE_RE = /\{\{\s*([a-zA-Z_][\w.-]*)\s*\}\}/g;
const VARIABLE_NAME_RE = /^[a-zA-Z_][\w.-]*$/;

export async function runPromptDistillation(options: PromptDistillationOptions): Promise<PromptDraft | null> {
  const turn = collectLatestSuccessfulTurn(options.messages);
  if (!turn) return null;
  const prompt = buildPromptDistillationPrompt(turn);
  const raw = options.distillText
    ? await options.distillText(prompt)
    : await runPiPrompt({
      workspaceRoot: options.workspaceRoot,
      text: prompt,
      model: options.model ?? DEFAULT_PROMPT_DISTILLATION_MODEL,
      systemPrompt: PROMPT_DISTILLATION_SYSTEM_PROMPT,
      timeoutMs: options.timeoutMs ?? 180_000,
      onEvent: options.onEvent,
    });
  return parsePromptDraft(raw, options.sessionId);
}

export function collectLatestSuccessfulTurn(messages: StoredMessage[]): { user: string; assistant: string } | null {
  let userIndex = -1;
  for (let index = messages.length - 1; index >= 0; index--) {
    if (messages[index]?.role === "user" && storedMessageText(messages[index]?.content)) {
      userIndex = index;
      break;
    }
  }
  if (userIndex < 0) return null;

  const user = storedMessageText(messages[userIndex]?.content).slice(-12_000);
  const assistant = messages
    .slice(userIndex + 1)
    .filter((message) => message.role === "assistant" && !message.errorMessage)
    .map((message) => storedMessageText(message.content))
    .filter(Boolean)
    .join("\n\n")
    .slice(-12_000);
  return user && assistant ? { user, assistant } : null;
}

export function buildPromptDistillationPrompt(turn: { user: string; assistant: string }): string {
  return `请把下面最新一轮成功对话提炼为一条可直接复用的 prompt 模板。

【用户任务】
${turn.user}

【成功结果】
${turn.assistant}

【提炼要求】
- body 必须是一条完整、可独立使用的用户指令，而不是对本次对话的总结。
- 保留让任务成功的目标、步骤、输出格式、质量要求和必要约束。
- 具体文件名、日期、地区、品牌、指标和数值若属于一次性输入，改成 {{variable}}；变量名只用英文、数字、下划线、点或连字符，且不能以数字开头。
- 不要虚构不需要的变量；无需参数化时 variables 可为空。
- 不输出原始数据行、样本值、PII、密钥、token 或 cookie。
- 没有可复用的成功任务时只输出 NO_DRAFT。

【输出格式】
---
title: 简短模板名
category: 分类
variables: variable_one, variable_two
tags: 标签一, 标签二
---
这里写完整 prompt body，可包含 {{variable_one}}。

只输出上述格式或 NO_DRAFT。`;
}

export function parsePromptDraft(raw: string, sessionId: string): PromptDraft | null {
  const text = raw.trim().replace(/^```(?:markdown|md)?\s*/i, "").replace(/```\s*$/i, "").trim();
  if (!text || /^NO_DRAFT\.?$/i.test(text)) return null;
  const matches = [...text.matchAll(/(?:^|\n)---\s*\n([\s\S]*?)\n---\s*\n([\s\S]*?)(?=\n---\s*\n|$)/g)];
  for (let index = matches.length - 1; index >= 0; index--) {
    const metadata = matches[index]?.[1] ?? "";
    const body = (matches[index]?.[2] ?? "").trim();
    const title = metadataValue(metadata, "title").slice(0, 120);
    if (!title || !body) continue;
    const category = metadataValue(metadata, "category").slice(0, 80);
    const declaredVariables = csvValues(metadataValue(metadata, "variables"))
      .filter((name) => VARIABLE_NAME_RE.test(name));
    const bodyVariables = extractVariables(body);
    const variables = unique([...bodyVariables, ...declaredVariables.filter((name) => bodyVariables.includes(name))]);
    return {
      title,
      category,
      body: body.slice(0, 12_000),
      variables,
      tags: unique(csvValues(metadataValue(metadata, "tags"))).slice(0, 12),
      sourceSessionId: sessionId,
    };
  }
  throw new Error(`Prompt distillation response is not valid frontmatter: ${text.slice(0, 300)}`);
}

function storedMessageText(content: unknown): string {
  if (typeof content === "string") return content.trim();
  if (!Array.isArray(content)) return "";
  return content.flatMap((block) => {
    if (typeof block !== "object" || block === null) return [];
    const value = block as { type?: unknown; text?: unknown };
    return value.type === "text" && typeof value.text === "string" ? [value.text] : [];
  }).join("\n").trim();
}

function metadataValue(metadata: string, key: string): string {
  const line = metadata.split("\n").find((item) => item.trimStart().startsWith(`${key}:`));
  return line ? line.trimStart().slice(key.length + 1).trim().replace(/^["']|["']$/g, "") : "";
}

function csvValues(value: string): string[] {
  return value.split(",").map((item) => item.trim()).filter(Boolean).map((item) => item.slice(0, 80));
}

function extractVariables(body: string): string[] {
  return unique([...body.matchAll(VARIABLE_RE)].flatMap((match) => match[1] ? [match[1]] : []));
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}
