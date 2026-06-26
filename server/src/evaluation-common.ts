import { buildOutputPathInstructions } from "./output-paths.ts";
import { runPiTurn } from "./pi-adapter.ts";
import { trackWorkspaceUsage } from "./cache.ts";
import type { PiEvent, PiUsage } from "./types.ts";
import { evaluationError, formatEvaluationError } from "./evaluation-errors.ts";

export interface EvaluationMetrics {
  totalTokens: number;
  totalCost: number;
  toolCalls: number;
  output: string;
}

export interface EvaluationUsageTarget {
  workspaceId: string;
  targetId: string;
  title: string;
}

export function emptyMetrics(): EvaluationMetrics {
  return { totalTokens: 0, totalCost: 0, toolCalls: 0, output: "" };
}

export function collectEvent(metrics: EvaluationMetrics, event: PiEvent, target?: EvaluationUsageTarget): void {
  const message = messageOf(event);
  if (!message || message.role !== "assistant") return;
  if (message.usage) {
    metrics.totalTokens += message.usage.totalTokens;
    metrics.totalCost += message.usage.cost.total;
    if (target) {
      trackWorkspaceUsage({
        workspaceId: target.workspaceId,
        targetKind: "evaluation",
        targetId: target.targetId,
        title: `实验室：${target.title}`,
      }, message.usage);
    }
  }
  if (Array.isArray(message.content)) {
    metrics.toolCalls += message.content.filter((block) => {
      if (typeof block !== "object" || block === null) return false;
      const type = (block as { type?: string }).type;
      return type === "toolCall" || type === "tool_use";
    }).length;
  }
  const text = extractText(message.content);
  if (text) metrics.output = text;
}

export async function runJudge(
  judgeDir: string,
  workspaceId: string,
  resultId: string,
  task: string,
  rubric: string,
  output: string,
  model: string,
): Promise<{ score: number | null; details: string }> {
  let text = "";
  const contextPrefix = buildOutputPathInstructions(judgeDir, "评估 judge 运行目录");
  const prompt = `${contextPrefix}你是严格的工作流输出评估员。请根据评分标准评估候选输出。

# 原始任务
${task}

# 评分标准
${rubric}

# 候选输出
${output.slice(0, 12000)}

只输出 JSON，不要输出 Markdown：
{"score": <0到100的数字>, "reason": "<简要理由>"}`;
  const run = runPiTurn({
    workspaceRoot: judgeDir,
    piSessionId: `judge-${resultId}`,
    text: prompt,
    model: model || undefined,
    allowWeb: false,
    onEvent: (event) => {
      collectEvent(emptyMetrics(), event, {
        workspaceId,
        targetId: `judge-${resultId}`,
        title: "Evaluation Judge",
      });
      const message = messageOf(event);
      if (message?.role === "assistant") {
        const next = extractText(message.content);
        if (next) text = next;
      }
    },
  });
  const code = await run.done;
  if (code !== 0) {
    return {
      score: null,
      details: formatEvaluationError(evaluationError(
        "judge_failed",
        `Judge failed with code ${String(code)}`,
        "Review judge model availability and judge run stderr.",
      )),
    };
  }
  try {
    const json = JSON.parse(text.replace(/```json|```/g, "").trim()) as { score?: unknown; reason?: unknown };
    const score = typeof json.score === "number" ? Math.max(0, Math.min(100, json.score)) : null;
    return { score, details: typeof json.reason === "string" ? json.reason : text };
  } catch {
    return { score: null, details: text };
  }
}

export function messageOf(event: PiEvent): { role?: string; content?: unknown; usage?: PiUsage } | undefined {
  if (event.type !== "message_end") return undefined;
  return (event as { message?: { role?: string; content?: unknown; usage?: PiUsage } }).message;
}

export function extractText(content: unknown): string {
  if (!Array.isArray(content)) return "";
  return content
    .filter((block): block is { type: "text"; text: string } =>
      typeof block === "object" && block !== null && (block as { type?: string }).type === "text")
    .map((block) => block.text)
    .join("\n")
    .trim();
}
