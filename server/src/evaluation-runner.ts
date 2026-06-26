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
import type { EvaluationFlowConfig, WorkflowEvaluationResult } from "./types.ts";
import { evaluationError, unknownEvaluationError } from "./evaluation-errors.ts";
import { collectEvent, emptyMetrics, runJudge, type EvaluationMetrics } from "./evaluation-common.ts";

export async function runWorkflowEvaluation(evaluationId: string): Promise<void> {
  const evaluation = getWorkflowEvaluation(evaluationId);
  if (!evaluation) return;
  const workspace = getWorkspace(evaluation.workspaceId);
  if (!workspace) {
    updateWorkflowEvaluation(evaluation.id, "failed", evaluationError(
      "workspace_not_found",
      "workspace not found",
      "The workspace may have been deleted before the evaluation finished.",
    ));
    return;
  }

  try {
    const root = join(workspace.rootPath, "evaluations", evaluation.id);
    mkdirSync(root, { recursive: true });

    for (const result of evaluation.results) {
      await runCandidate(result, root, evaluation.workspaceId, evaluation.prompt, evaluation.model, evaluation.flowConfigs[result.flowId]);
    }

    if (evaluation.rubric.trim()) {
      await scoreCandidates(evaluation.id, root, evaluation.prompt, evaluation.rubric, evaluation.judgeModel);
    }
    updateWorkflowEvaluation(evaluation.id, "success");
  } catch (err) {
    updateWorkflowEvaluation(evaluation.id, "failed", unknownEvaluationError(err, "Check failed candidate rows for more detail."));
  }
}

async function runCandidate(
  result: WorkflowEvaluationResult,
  evaluationRoot: string,
  workspaceId: string,
  prompt: string,
  model: string,
  flowConfig?: EvaluationFlowConfig,
): Promise<void> {
  const flow = getFlow(result.flowId);
  if (!flow) {
    updateWorkflowEvaluationResult(result.id, {
      status: "failed",
      error: evaluationError("flow_not_found", "flow not found", "The candidate workflow may have been deleted."),
      endedAt: Date.now(),
    });
    return;
  }

  const startedAt = Date.now();
  updateWorkflowEvaluationResult(result.id, { status: "running", startedAt });
  const runDir = join(evaluationRoot, result.id);
  mkdirSync(runDir, { recursive: true });
  copyFlowSnapshot(flow.folderPath, runDir);

  try {
    const metrics = flow.kind === "multi"
      ? await runMultiWorkflow(runDir, result.id, workspaceId, result.flowName, prompt, flowConfig)
      : await runSingleWorkflow(runDir, result.id, workspaceId, result.flowName, prompt, model);
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
    const error = unknownEvaluationError(err, "Open the candidate output directory and inspect the run logs.");
    updateWorkflowEvaluationResult(result.id, {
      status: "failed",
      endedAt: Date.now(),
      durationSec: (Date.now() - startedAt) / 1000,
      error,
    });
  }
}

async function runSingleWorkflow(runDir: string, runId: string, workspaceId: string, title: string, prompt: string, model: string): Promise<EvaluationMetrics> {
  const metrics = emptyMetrics();
  const contextPrefix = buildOutputPathInstructions(runDir, "评估运行目录");
  const run = runPiTurn({
    workspaceRoot: runDir,
    piSessionId: runId,
    text: `${contextPrefix}${prompt}`,
    model: model || undefined,
    allowWeb: false,
    onEvent: (event) => collectEvent(metrics, event, { workspaceId, targetId: runId, title }),
  });
  const code = await run.done;
  if (code !== 0) throw evaluationError("process_exit", `pi exited with code ${String(code)}`, "Check stderr and process_start events for the failed candidate.");
  return metrics;
}

async function runMultiWorkflow(runDir: string, runId: string, workspaceId: string, title: string, prompt: string, flowConfig?: EvaluationFlowConfig): Promise<EvaluationMetrics> {
  const workflow = readWorkflow(runDir);
  if (!workflow) throw evaluationError("workflow_invalid", "workflow.json not found or invalid", "Ask pi to regenerate workflow.json or fix node/edge schema errors.");
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
    onStepEvent: (_nodeId, event) => collectEvent(metrics, event, { workspaceId, targetId: runId, title }),
    onStepEnd: () => undefined,
    onBlackboardUpdate: () => undefined,
  });
  if (result.code !== 0) throw evaluationError("process_exit", `workflow exited with code ${String(result.code)}`, "Inspect the failed node output and gate verdict files.");
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
    const response = await runJudge(judgeDir, evaluation.workspaceId, result.id, prompt, rubric, result.output, model);
    updateWorkflowEvaluationResult(result.id, {
      judgeScore: response.score,
      judgeDetails: response.details,
    });
  }
}
