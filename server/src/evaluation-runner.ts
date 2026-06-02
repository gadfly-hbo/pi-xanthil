import { mkdirSync } from "node:fs";
import { join } from "node:path";
import {
  getFlow,
  getWorkflowEvaluation,
  getWorkspace,
  updateWorkflowEvaluation,
  updateWorkflowEvaluationResult,
} from "./db.ts";
import { copyFlowSnapshot } from "./flow-fs.ts";
import { readWorkflow, runMultiAgent } from "./multi-agent-runner.ts";
import { buildOutputPathInstructions } from "./output-paths.ts";
import { runPiTurn } from "./pi-adapter.ts";
import type { EvaluationFlowConfig, PiEvent, WorkflowEvaluationResult } from "./types.ts";

interface Metrics {
  totalTokens: number;
  totalCost: number;
  toolCalls: number;
  output: string;
}

export async function runWorkflowEvaluation(evaluationId: string): Promise<void> {
  const evaluation = getWorkflowEvaluation(evaluationId);
  if (!evaluation) return;
  const workspace = getWorkspace(evaluation.workspaceId);
  if (!workspace) {
    updateWorkflowEvaluation(evaluation.id, "failed", "workspace not found");
    return;
  }

  try {
    const root = join(workspace.rootPath, "evaluations", evaluation.id);
    mkdirSync(root, { recursive: true });

    for (const result of evaluation.results) {
      await runCandidate(result, root, evaluation.prompt, evaluation.model, evaluation.flowConfigs[result.flowId]);
    }

    if (evaluation.rubric.trim()) {
      await scoreCandidates(evaluation.id, root, evaluation.prompt, evaluation.rubric, evaluation.judgeModel);
    }
    updateWorkflowEvaluation(evaluation.id, "success");
  } catch (err) {
    updateWorkflowEvaluation(evaluation.id, "failed", String(err));
  }
}

async function runCandidate(
  result: WorkflowEvaluationResult,
  evaluationRoot: string,
  prompt: string,
  model: string,
  flowConfig?: EvaluationFlowConfig,
): Promise<void> {
  const flow = getFlow(result.flowId);
  if (!flow) {
    updateWorkflowEvaluationResult(result.id, { status: "failed", error: "flow not found", endedAt: Date.now() });
    return;
  }

  const startedAt = Date.now();
  updateWorkflowEvaluationResult(result.id, { status: "running", startedAt });
  const runDir = join(evaluationRoot, result.id);
  mkdirSync(runDir, { recursive: true });
  copyFlowSnapshot(flow.folderPath, runDir);

  try {
    const metrics = flow.kind === "multi"
      ? await runMultiWorkflow(runDir, result.id, prompt, flowConfig)
      : await runSingleWorkflow(runDir, result.id, prompt, model);
    updateWorkflowEvaluationResult(result.id, {
      status: "success",
      endedAt: Date.now(),
      durationSec: (Date.now() - startedAt) / 1000,
      totalTokens: metrics.totalTokens,
      totalCost: metrics.totalCost,
      toolCalls: metrics.toolCalls,
      outputChars: metrics.output.length,
      output: metrics.output,
    });
  } catch (err) {
    updateWorkflowEvaluationResult(result.id, {
      status: "failed",
      endedAt: Date.now(),
      durationSec: (Date.now() - startedAt) / 1000,
      error: String(err),
    });
  }
}

async function runSingleWorkflow(runDir: string, runId: string, prompt: string, model: string): Promise<Metrics> {
  const metrics = emptyMetrics();
  const contextPrefix = buildOutputPathInstructions(runDir, "评估运行目录");
  const run = runPiTurn({
    workspaceRoot: runDir,
    piSessionId: runId,
    text: `${contextPrefix}${prompt}`,
    model: model || undefined,
    onEvent: (event) => collectEvent(metrics, event),
  });
  const code = await run.done;
  if (code !== 0) throw new Error(`pi exited with code ${String(code)}`);
  return metrics;
}

async function runMultiWorkflow(runDir: string, runId: string, prompt: string, flowConfig?: EvaluationFlowConfig): Promise<Metrics> {
  const workflow = readWorkflow(runDir);
  if (!workflow) throw new Error("workflow.json not found or invalid");
  const metrics = emptyMetrics();
  const contextPrefix = buildOutputPathInstructions(runDir, "评估运行目录");
  const taskPrefix = `[共同评估任务]\n${prompt}\n\n[当前节点指令]\n`;
  const withTask = {
    ...workflow,
    nodes: workflow.nodes.map((node) => ({
      ...node,
      model: flowConfig?.nodeModels?.[node.id] || node.model,
      prompt: taskPrefix + (node.prompt || node.label),
    })),
  };
  const result = await runMultiAgent(withTask, {
    flowRoot: runDir,
    runId,
    runDir,
    inputs: { task: prompt, prompt, query: prompt },
    defaultModel: flowConfig?.defaultModel || undefined,
    contextPrefix,
    onStepStart: () => undefined,
    onStepEvent: (_nodeId, event) => collectEvent(metrics, event),
    onStepEnd: () => undefined,
    onBlackboardUpdate: () => undefined,
  });
  if (result.code !== 0) throw new Error(`workflow exited with code ${String(result.code)}`);
  metrics.output = Object.entries(result.blackboard)
    .map(([nodeId, text]) => `## ${nodeId}\n\n${text}`)
    .join("\n\n");
  return metrics;
}

async function scoreCandidates(
  evaluationId: string,
  evaluationRoot: string,
  prompt: string,
  rubric: string,
  model: string,
): Promise<void> {
  const evaluation = getWorkflowEvaluation(evaluationId);
  if (!evaluation) return;
  for (const result of evaluation.results) {
    if (result.status !== "success" || !result.output.trim()) continue;
    const judgeDir = join(evaluationRoot, "judge", result.id);
    mkdirSync(judgeDir, { recursive: true });
    const response = await runJudge(judgeDir, result.id, prompt, rubric, result.output, model);
    updateWorkflowEvaluationResult(result.id, {
      judgeScore: response.score,
      judgeDetails: response.details,
    });
  }
}

async function runJudge(
  judgeDir: string,
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
    onEvent: (event) => {
      const message = messageOf(event);
      if (message?.role === "assistant") {
        const next = extractText(message.content);
        if (next) text = next;
      }
    },
  });
  const code = await run.done;
  if (code !== 0) return { score: null, details: `Judge failed with code ${String(code)}` };
  try {
    const json = JSON.parse(text.replace(/```json|```/g, "").trim()) as { score?: unknown; reason?: unknown };
    const score = typeof json.score === "number" ? Math.max(0, Math.min(100, json.score)) : null;
    return { score, details: typeof json.reason === "string" ? json.reason : text };
  } catch {
    return { score: null, details: text };
  }
}

function emptyMetrics(): Metrics {
  return { totalTokens: 0, totalCost: 0, toolCalls: 0, output: "" };
}

function collectEvent(metrics: Metrics, event: PiEvent): void {
  const message = messageOf(event);
  if (!message || message.role !== "assistant") return;
  if (message.usage) {
    metrics.totalTokens += message.usage.totalTokens;
    metrics.totalCost += message.usage.cost.total;
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

function messageOf(event: PiEvent): { role?: string; content?: unknown; usage?: { totalTokens: number; cost: { total: number } } } | undefined {
  if (event.type !== "message_end") return undefined;
  return (event as { message?: { role?: string; content?: unknown; usage?: { totalTokens: number; cost: { total: number } } } }).message;
}

function extractText(content: unknown): string {
  if (!Array.isArray(content)) return "";
  return content
    .filter((block): block is { type: "text"; text: string } =>
      typeof block === "object" && block !== null && (block as { type?: string }).type === "text")
    .map((block) => block.text)
    .join("\n")
    .trim();
}
