import { mkdirSync } from "node:fs";
import { join } from "node:path";
import {
  getMemoryEvaluation,
  getWorkspace,
  updateMemoryEvaluation,
  updateMemoryEvaluationResult,
} from "./db.ts";
import { buildOutputPathInstructions } from "./output-paths.ts";
import { runPiTurn } from "./pi-adapter.ts";
import { buildMemoryInjectionSnapshot, buildMemoryPrompt } from "./memory-injection.ts";
import { collectEvent, emptyMetrics, runJudge, type EvaluationMetrics } from "./evaluation-common.ts";
import { evaluationError, unknownEvaluationError } from "./evaluation-errors.ts";
import type { MemoryEvaluationResult, RetrievalContext } from "./types.ts";

export function buildMemoryEvaluationRetrievalContext(prompt: string): RetrievalContext {
  return { query: prompt.trim() };
}

export async function runMemoryEvaluation(evaluationId: string): Promise<void> {
  const evaluation = getMemoryEvaluation(evaluationId);
  if (!evaluation) return;
  const workspace = getWorkspace(evaluation.workspaceId);
  if (!workspace) {
    updateMemoryEvaluation(evaluation.id, "failed", evaluationError(
      "workspace_not_found",
      "workspace not found",
      "The workspace may have been deleted before the evaluation finished.",
    ));
    return;
  }

  try {
    const root = join(workspace.rootPath, "evaluations", "memory", evaluation.id);
    mkdirSync(root, { recursive: true });
    for (const result of evaluation.results) {
      await runCandidate(result, root, evaluation.workspaceId, evaluation.prompt, evaluation.model, evaluation.targetScope);
    }
    if (evaluation.rubric.trim()) {
      await scoreCandidates(evaluation.id, root, evaluation.prompt, evaluation.rubric, evaluation.judgeModel);
    }
    updateMemoryEvaluation(evaluation.id, "success");
  } catch (err) {
    updateMemoryEvaluation(evaluation.id, "failed", unknownEvaluationError(err, "Check failed memory evaluation rows for detail."));
  }
}

async function runCandidate(
  result: MemoryEvaluationResult,
  evaluationRoot: string,
  workspaceId: string,
  prompt: string,
  model: string,
  targetScope: "chat" | "workflow",
): Promise<void> {
  const startedAt = Date.now();
  updateMemoryEvaluationResult(result.id, { status: "running", startedAt });
  const runDir = join(evaluationRoot, result.id);
  mkdirSync(runDir, { recursive: true });
  const memoryRequested = result.variant === "memory";
  const retrievalContext = buildMemoryEvaluationRetrievalContext(prompt);
  const memorySnapshot = buildMemoryInjectionSnapshot(workspaceId, memoryRequested, targetScope, {}, retrievalContext);

  try {
    const metrics = await runPi(runDir, result.id, workspaceId, result.variant, prompt, model, targetScope, memoryRequested, retrievalContext);
    updateMemoryEvaluationResult(result.id, {
      status: "success",
      endedAt: Date.now(),
      durationSec: (Date.now() - startedAt) / 1000,
      totalTokens: metrics.totalTokens,
      totalCost: metrics.totalCost,
      toolCalls: metrics.toolCalls,
      outputChars: metrics.output.length,
      output: metrics.output,
      memorySnapshot,
    });
  } catch (err) {
    updateMemoryEvaluationResult(result.id, {
      status: "failed",
      endedAt: Date.now(),
      durationSec: (Date.now() - startedAt) / 1000,
      error: unknownEvaluationError(err, "Inspect the memory evaluation candidate output directory."),
      memorySnapshot,
    });
  }
}

async function runPi(
  runDir: string,
  resultId: string,
  workspaceId: string,
  variant: string,
  prompt: string,
  model: string,
  targetScope: "chat" | "workflow",
  memoryRequested: boolean,
  retrievalContext: RetrievalContext,
): Promise<EvaluationMetrics> {
  const metrics = emptyMetrics();
  const contextPrefix = buildOutputPathInstructions(runDir, "记忆评估运行目录");
  const systemPrompt = memoryRequested ? buildMemoryPrompt(workspaceId, targetScope, {}, retrievalContext) || undefined : undefined;
  const run = runPiTurn({
    workspaceRoot: runDir,
    piSessionId: resultId,
    text: `${contextPrefix}${prompt}`,
    model: model || undefined,
    systemPrompt,
    onEvent: (event) => collectEvent(metrics, event, {
      workspaceId,
      targetId: resultId,
      title: `Memory Eval ${variant}`,
    }),
  });
  const code = await run.done;
  if (code !== 0) throw evaluationError("process_exit", `pi exited with code ${String(code)}`, "Check stderr and process_start events for the failed memory evaluation candidate.");
  return metrics;
}

async function scoreCandidates(
  evaluationId: string,
  evaluationRoot: string,
  prompt: string,
  rubric: string,
  model: string,
): Promise<void> {
  const evaluation = getMemoryEvaluation(evaluationId);
  if (!evaluation) return;
  for (const result of evaluation.results) {
    if (result.status !== "success" || !result.output.trim()) continue;
    const judgeDir = join(evaluationRoot, "judge", result.id);
    mkdirSync(judgeDir, { recursive: true });
    const response = await runJudge(judgeDir, evaluation.workspaceId, result.id, prompt, rubric, result.output, model);
    updateMemoryEvaluationResult(result.id, {
      judgeScore: response.score,
      judgeDetails: response.details,
    });
  }
}
