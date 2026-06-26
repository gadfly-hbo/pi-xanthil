import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { buildOutputPathInstructions } from "./output-paths.ts";
import { runPiTurn, type PiRun, type RunPiOptions } from "./pi-adapter.ts";
import { buildDataContextBlock } from "./prompt-blocks.ts";
import { collectEvent, emptyMetrics, extractText, type EvaluationMetrics } from "./evaluation-common.ts";
import { evaluationError, unknownEvaluationError } from "./evaluation-errors.ts";
import type { EvaluationError, PiEvent } from "./types.ts";
import { detectSkillActivation, type SkillActivationResult } from "./skill-activation.ts";
import { retrieveSkills } from "./skill-retrieval.ts";

export type SkillEvalRunTurn = (opts: RunPiOptions) => PiRun;
export type SkillPairwiseJudge = (options: SkillPairwiseJudgeOptions) => Promise<SkillPairwiseResult>;

export interface SkillVariant {
  id: string;
  label: string;
  skillPaths: string[];
  retrievalMode?: boolean;
  retrievalTopK?: number;
}

export interface SkillEvalTask {
  id: string;
  prompt: string;
  expectedPoints?: string[];
  rubric?: string;
}

export interface SkillEvaluationRunnerOptions {
  workspaceRoot: string;
  evaluationId: string;
  workspaceId: string;
  model: string;
  variants: SkillVariant[];
  tasks: SkillEvalTask[];
  repeat: number;
  judgeRepeat?: number;
  runRoot?: string;
  contextPrefix?: string;
  dataContextPaths?: string[];
  runTurn?: SkillEvalRunTurn;
  judgePairwise?: SkillPairwiseJudge;
  onResult?: (result: SkillEvaluationRunResult) => void;
}

export type SkillEvaluationRunStatus = "success" | "failed";

export interface SkillEvaluationRunResult {
  id: string;
  variantId: string;
  variantLabel: string;
  taskId: string;
  attempt: number;
  status: SkillEvaluationRunStatus;
  startedAt: number;
  endedAt: number;
  durationSec: number;
  skillPaths: string[];
  totalTokens: number;
  totalCost: number;
  toolCalls: number;
  outputChars: number;
  output: string;
  activation: SkillActivationResult;
  pairwise: SkillPairwiseResult | null;
  error: EvaluationError | null;
}

export type SkillPairwiseVerdict = "win" | "tie" | "loss" | "not_judged";

export interface SkillPairwiseResult {
  baselineResultId: string;
  variantResultId: string;
  taskId: string;
  attempt: number;
  verdict: SkillPairwiseVerdict;
  scoreDelta: number | null;
  baselineScore: number | null;
  variantScore: number | null;
  confidence: number | null;
  reason: string;
  error: EvaluationError | null;
  judgeRuns?: SkillPairwiseResult[];
}

export interface SkillPairwiseSummary {
  variantId: string;
  variantLabel: string;
  judged: number;
  skipped: number;
  win: number;
  tie: number;
  loss: number;
  avgScoreDelta: number;
  avgConfidence: number | null;
}

export interface SkillPairwiseJudgeOptions {
  judgeDir: string;
  workspaceId: string;
  evaluationId: string;
  model: string;
  task: SkillEvalTask;
  baseline: SkillEvaluationRunResult;
  variant: SkillEvaluationRunResult;
}

export interface SkillEvaluationRunSummary {
  evaluationId: string;
  status: SkillEvaluationRunStatus;
  startedAt: number;
  endedAt: number;
  durationSec: number;
  results: SkillEvaluationRunResult[];
  variantSummaries: SkillVariantSummary[];
  taskSummaries: SkillTaskSummary[];
  pairwiseSummaries: SkillPairwiseSummary[];
}

export interface SkillVariantSummary {
  variantId: string;
  variantLabel: string;
  total: number;
  success: number;
  failed: number;
  activationRate: number;
  avgDurationSec: number;
  avgTotalTokens: number;
  avgTotalCost: number;
  avgToolCalls: number;
  avgOutputChars: number;
}

export interface SkillTaskSummary {
  taskId: string;
  total: number;
  success: number;
  failed: number;
  activationRate: number;
}

export interface SkillEvaluationResultSummaries {
  variantSummaries: SkillVariantSummary[];
  taskSummaries: SkillTaskSummary[];
  pairwiseSummaries: SkillPairwiseSummary[];
}

export async function runSkillEvaluation(options: SkillEvaluationRunnerOptions): Promise<SkillEvaluationRunSummary> {
  validateSkillEvaluationOptions(options);
  const startedAt = Date.now();
  const runRoot = options.runRoot ?? join(options.workspaceRoot, "evaluations", "skills", options.evaluationId);
  mkdirSync(runRoot, { recursive: true });

  const results: SkillEvaluationRunResult[] = [];
  for (const variant of options.variants) {
    for (const task of options.tasks) {
      for (let attempt = 1; attempt <= options.repeat; attempt++) {
        const result = await runSkillCase(options, runRoot, variant, task, attempt);
        results.push(result);
        options.onResult?.(result);
      }
    }
  }

  await judgeSkillPairwiseResults(options, runRoot, results);

  const endedAt = Date.now();
  const hasFailure = results.some((result) => result.status === "failed");
  return {
    evaluationId: options.evaluationId,
    status: hasFailure ? "failed" : "success",
    startedAt,
    endedAt,
    durationSec: (endedAt - startedAt) / 1000,
    results,
    ...summarizeSkillEvaluationResults(results),
  };
}

export function summarizeSkillEvaluationResults(results: SkillEvaluationRunResult[]): SkillEvaluationResultSummaries {
  return {
    variantSummaries: summarizeVariants(results),
    taskSummaries: summarizeTasks(results),
    pairwiseSummaries: summarizePairwise(results),
  };
}

async function runSkillCase(
  options: SkillEvaluationRunnerOptions,
  runRoot: string,
  variant: SkillVariant,
  task: SkillEvalTask,
  attempt: number,
): Promise<SkillEvaluationRunResult> {
  const startedAt = Date.now();
  const id = `${sanitizeId(variant.id)}-${sanitizeId(task.id)}-${attempt}`;
  const caseDir = join(runRoot, id);
  mkdirSync(caseDir, { recursive: true });
  const metrics = emptyMetrics();
  const events: PiEvent[] = [];

  let effectiveSkillPaths = variant.skillPaths;
  if (variant.retrievalMode) {
    const retrieved = retrieveSkills(task.prompt, options.workspaceRoot, variant.retrievalTopK ?? 3);
    effectiveSkillPaths = retrieved.map((s) => s.path);
  }

  try {
    const output = await runSkillPiTurn(options, caseDir, id, variant, task, metrics, events, effectiveSkillPaths);
    const endedAt = Date.now();
    const activation = detectSkillActivation({ skillPaths: effectiveSkillPaths, output, events });
    return {
      id,
      variantId: variant.id,
      variantLabel: variant.label,
      taskId: task.id,
      attempt,
      status: "success",
      startedAt,
      endedAt,
      durationSec: (endedAt - startedAt) / 1000,
      skillPaths: effectiveSkillPaths,
      totalTokens: metrics.totalTokens,
      totalCost: metrics.totalCost,
      toolCalls: metrics.toolCalls,
      outputChars: output.length,
      output,
      activation,
      pairwise: null,
      error: null,
    };
  } catch (err) {
    const endedAt = Date.now();
    const error = unknownEvaluationError(err, "Inspect the skill evaluation case directory and pi stderr events.");
    const activation = detectSkillActivation({ skillPaths: effectiveSkillPaths, output: metrics.output, events });
    return {
      id,
      variantId: variant.id,
      variantLabel: variant.label,
      taskId: task.id,
      attempt,
      status: "failed",
      startedAt,
      endedAt,
      durationSec: (endedAt - startedAt) / 1000,
      skillPaths: effectiveSkillPaths,
      totalTokens: metrics.totalTokens,
      totalCost: metrics.totalCost,
      toolCalls: metrics.toolCalls,
      outputChars: metrics.output.length,
      output: metrics.output,
      activation,
      pairwise: null,
      error,
    };
  }
}

async function judgeSkillPairwiseResults(
  options: SkillEvaluationRunnerOptions,
  runRoot: string,
  results: SkillEvaluationRunResult[],
): Promise<void> {
  const baseline = options.variants.find((variant) => variant.skillPaths.length === 0) ?? options.variants.find((variant) => variant.id === "baseline");
  if (!baseline) return;
  const baselineResults = new Map<string, SkillEvaluationRunResult>();
  for (const result of results) {
    if (result.variantId === baseline.id) baselineResults.set(pairwiseKey(result.taskId, result.attempt), result);
  }
  const judgePairwise = options.judgePairwise ?? runDefaultPairwiseJudge;
  const tasks = new Map(options.tasks.map((task) => [task.id, task]));
  for (const result of results) {
    if (result.variantId === baseline.id) continue;
    const base = baselineResults.get(pairwiseKey(result.taskId, result.attempt));
    const task = tasks.get(result.taskId);
    if (!base || !task || base.status !== "success" || result.status !== "success") {
      result.pairwise = {
        baselineResultId: base?.id ?? "",
        variantResultId: result.id,
        taskId: result.taskId,
        attempt: result.attempt,
        verdict: "not_judged",
        scoreDelta: null,
        baselineScore: null,
        variantScore: null,
        confidence: null,
        reason: "Baseline or variant run was not successful.",
        error: null,
      };
      continue;
    }
    const judgeDir = join(runRoot, "pairwise", sanitizeId(result.id));
    mkdirSync(judgeDir, { recursive: true });
    result.pairwise = await runRepeatedPairwiseJudge(options, judgePairwise, {
      judgeDir,
      workspaceId: options.workspaceId,
      evaluationId: options.evaluationId,
      model: options.model,
      task,
      baseline: base,
      variant: result,
    });
  }
}

async function runRepeatedPairwiseJudge(
  runnerOptions: SkillEvaluationRunnerOptions,
  judgePairwise: SkillPairwiseJudge,
  options: SkillPairwiseJudgeOptions,
): Promise<SkillPairwiseResult> {
  const judgeRepeat = runnerOptions.judgeRepeat ?? 1;
  const runs: SkillPairwiseResult[] = [];
  for (let judgeAttempt = 1; judgeAttempt <= judgeRepeat; judgeAttempt += 1) {
    const judgeDir = judgeRepeat === 1 ? options.judgeDir : join(options.judgeDir, `judge-${judgeAttempt}`);
    mkdirSync(judgeDir, { recursive: true });
    try {
      runs.push(await judgePairwise({ ...options, judgeDir }));
    } catch (err) {
      runs.push({
        baselineResultId: options.baseline.id,
        variantResultId: options.variant.id,
        taskId: options.task.id,
        attempt: options.variant.attempt,
        verdict: "not_judged",
        scoreDelta: null,
        baselineScore: null,
        variantScore: null,
        confidence: null,
        reason: "Pairwise judge failed.",
        error: unknownEvaluationError(err, "Review the pairwise judge run directory and model configuration."),
      });
    }
  }
  if (runs.length === 1) return runs[0]!;
  return aggregatePairwiseJudgeRuns(options, runs);
}

function aggregatePairwiseJudgeRuns(options: SkillPairwiseJudgeOptions, runs: SkillPairwiseResult[]): SkillPairwiseResult {
  const judged = runs.filter((run) => run.verdict !== "not_judged");
  if (judged.length === 0) {
    const first = runs[0];
    return {
      baselineResultId: options.baseline.id,
      variantResultId: options.variant.id,
      taskId: options.task.id,
      attempt: options.variant.attempt,
      verdict: "not_judged",
      scoreDelta: null,
      baselineScore: null,
      variantScore: null,
      confidence: null,
      reason: "No successful pairwise judge runs.",
      error: first?.error ?? evaluationError("judge_failed", "No successful pairwise judge runs.", "Review judge model availability and judge run directories."),
      judgeRuns: runs,
    };
  }
  const verdict = majorityVerdict(judged);
  const baselineScores = judged.map((run) => run.baselineScore).filter((value): value is number => typeof value === "number");
  const variantScores = judged.map((run) => run.variantScore).filter((value): value is number => typeof value === "number");
  const scoreDeltas = judged.map((run) => run.scoreDelta).filter((value): value is number => typeof value === "number");
  const confidences = judged.map((run) => run.confidence).filter((value): value is number => typeof value === "number");
  const voteText = ["win", "tie", "loss"].map((item) => `${item}:${judged.filter((run) => run.verdict === item).length}`).join(", ");
  return {
    baselineResultId: options.baseline.id,
    variantResultId: options.variant.id,
    taskId: options.task.id,
    attempt: options.variant.attempt,
    verdict,
    scoreDelta: avgOrNull(scoreDeltas),
    baselineScore: avgOrNull(baselineScores),
    variantScore: avgOrNull(variantScores),
    confidence: avgOrNull(confidences),
    reason: `Aggregated ${judged.length}/${runs.length} judge runs (${voteText}).`,
    error: null,
    judgeRuns: runs,
  };
}

async function runDefaultPairwiseJudge(options: SkillPairwiseJudgeOptions): Promise<SkillPairwiseResult> {
  let text = "";
  const contextPrefix = buildOutputPathInstructions(options.judgeDir, "Skill pairwise judge 运行目录");
  const prompt = `${contextPrefix}${buildPairwiseJudgePrompt(options)}`;
  const run = runPiTurn({
    workspaceRoot: options.judgeDir,
    piSessionId: `skill-pairwise-${options.evaluationId}-${options.variant.id}`,
    text: prompt,
    model: options.model || undefined,
    allowWeb: false,
    onEvent: (event) => {
      collectEvent(emptyMetrics(), event, {
        workspaceId: options.workspaceId,
        targetId: `skill-pairwise-${options.variant.id}`,
        title: "Skill Pairwise Judge",
      });
      const message = event.type === "message_end" ? (event as { message?: { role?: string; content?: unknown } }).message : undefined;
      if (message?.role === "assistant") {
        const next = extractText(message.content);
        if (next) text = next;
      }
    },
  });
  const code = await run.done;
  if (code !== 0) {
    return pairwiseJudgeFailure(options, evaluationError("judge_failed", `Pairwise judge failed with code ${String(code)}`, "Review judge model availability and judge stderr."));
  }
  return parsePairwiseJudgeResponse(options, text);
}

export function buildPairwiseJudgePrompt(options: SkillPairwiseJudgeOptions): string {
  const rubric = options.task.rubric?.trim() || [
    "Correctness: the answer satisfies the original task without unsupported claims.",
    "Completeness: the answer covers the requested scope and expected points.",
    "Actionability: the answer is concrete enough for the user to use.",
    "Skill value: credit the variant only when it improves the answer in task-relevant ways.",
  ].join("\n");
  const expectedPoints = options.task.expectedPoints?.filter((point) => point.trim()).map((point) => `- ${point.trim()}`).join("\n") || "- No explicit expected points were provided.";
  return `你是严格的 Skill A/B 评估员。请比较 baseline 输出和 variant 输出，判断 variant 是否相对 baseline 提升了任务质量。

评分规则：
- 只根据“原始任务”“预期要点”“评分标准”和两份输出判断。
- 不要因为 variant 使用了更多文字、格式更复杂或声称使用了 skill 就给高分。
- 如果两份输出都满足或都不满足关键要求且差异很小，返回 tie。
- 如果 variant 遗漏关键要点、引入错误、偏离任务或降低可执行性，返回 loss。
- baselineScore 和 variantScore 必须是 0 到 100 的数字。
- confidence 必须是 0 到 1 的数字，表示你对 verdict 的置信度；证据不足或差异很小用较低置信度。

# 原始任务
${options.task.prompt}

# 预期要点
${expectedPoints}

# 评分标准
${rubric}

# Baseline 输出
${options.baseline.output.slice(0, 12000)}

# Variant 输出
${options.variant.output.slice(0, 12000)}

只输出 JSON 对象，不要输出 Markdown，不要包裹代码块：
{"verdict":"win|tie|loss","baselineScore":0,"variantScore":0,"confidence":0.8,"reason":"用一句话说明关键差异，必须引用预期要点或评分标准"}`;
}

function parsePairwiseJudgeResponse(options: SkillPairwiseJudgeOptions, text: string): SkillPairwiseResult {
  try {
    const parsed = JSON.parse(extractJsonObjectText(text)) as {
      verdict?: unknown;
      baselineScore?: unknown;
      variantScore?: unknown;
      confidence?: unknown;
      reason?: unknown;
    };
    const verdict = parsed.verdict === "win" || parsed.verdict === "tie" || parsed.verdict === "loss" ? parsed.verdict : "not_judged";
    const baselineScore = typeof parsed.baselineScore === "number" ? clampScore(parsed.baselineScore) : null;
    const variantScore = typeof parsed.variantScore === "number" ? clampScore(parsed.variantScore) : null;
    const confidence = typeof parsed.confidence === "number" ? clampConfidence(parsed.confidence) : null;
    return {
      baselineResultId: options.baseline.id,
      variantResultId: options.variant.id,
      taskId: options.task.id,
      attempt: options.variant.attempt,
      verdict,
      scoreDelta: baselineScore !== null && variantScore !== null ? variantScore - baselineScore : null,
      baselineScore,
      variantScore,
      confidence,
      reason: typeof parsed.reason === "string" ? parsed.reason : text,
      error: verdict === "not_judged" ? evaluationError("judge_failed", "Pairwise judge returned an invalid verdict.", "Expected verdict to be win, tie, or loss.") : null,
    };
  } catch {
    return pairwiseJudgeFailure(options, evaluationError("judge_failed", "Pairwise judge returned invalid JSON.", text.slice(0, 500)));
  }
}

function extractJsonObjectText(text: string): string {
  const cleaned = text.replace(/```json|```/g, "").trim();
  if (cleaned.startsWith("{") && cleaned.endsWith("}")) return cleaned;
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start >= 0 && end > start) return cleaned.slice(start, end + 1);
  return cleaned;
}

function pairwiseJudgeFailure(options: SkillPairwiseJudgeOptions, error: EvaluationError): SkillPairwiseResult {
  return {
    baselineResultId: options.baseline.id,
    variantResultId: options.variant.id,
    taskId: options.task.id,
    attempt: options.variant.attempt,
    verdict: "not_judged",
    scoreDelta: null,
    baselineScore: null,
    variantScore: null,
    confidence: null,
    reason: error.message,
    error,
  };
}

async function runSkillPiTurn(
  options: SkillEvaluationRunnerOptions,
  caseDir: string,
  caseId: string,
  variant: SkillVariant,
  task: SkillEvalTask,
  metrics: EvaluationMetrics,
  events: PiEvent[],
  effectiveSkillPaths: string[],
): Promise<string> {
  const runTurn = options.runTurn ?? runPiTurn;
  const dataBlock = options.dataContextPaths?.length ? buildDataContextBlock(options.dataContextPaths) : "";
  const contextPrefix = [
    buildOutputPathInstructions(caseDir, "Skill 评测运行目录"),
    dataBlock,
    options.contextPrefix,
  ].filter(Boolean).join("\n\n");
  const run = runTurn({
    workspaceRoot: caseDir,
    piSessionId: `${options.evaluationId}-${caseId}`,
    text: `${contextPrefix}${task.prompt}`,
    model: options.model || undefined,
    skillPaths: effectiveSkillPaths,
    allowWeb: false,
    onEvent: (event) => {
      events.push(event);
      collectEvent(metrics, event, {
        workspaceId: options.workspaceId,
        targetId: caseId,
        title: `Skill Evaluation: ${variant.label}`,
      });
    },
  });
  const code = await run.done;
  if (code !== 0) {
    throw evaluationError("process_exit", `pi exited with code ${String(code)}`, "Check stderr and process_start events for this skill evaluation case.");
  }
  return metrics.output;
}

function validateSkillEvaluationOptions(options: SkillEvaluationRunnerOptions): void {
  if (!options.workspaceRoot.trim()) throw new Error("workspaceRoot is required");
  if (!options.evaluationId.trim()) throw new Error("evaluationId is required");
  if (!options.workspaceId.trim()) throw new Error("workspaceId is required");
  if (!Number.isInteger(options.repeat) || options.repeat < 1) throw new Error("repeat must be a positive integer");
  if (options.judgeRepeat !== undefined && (!Number.isInteger(options.judgeRepeat) || options.judgeRepeat < 1 || options.judgeRepeat > 5)) {
    throw new Error("judgeRepeat must be an integer between 1 and 5");
  }
  if (options.variants.length === 0) throw new Error("variants must not be empty");
  if (options.tasks.length === 0) throw new Error("tasks must not be empty");
  const variantIds = new Set<string>();
  for (const variant of options.variants) {
    if (!variant.id.trim()) throw new Error("variant.id is required");
    if (variantIds.has(variant.id)) throw new Error(`duplicate variant id: ${variant.id}`);
    variantIds.add(variant.id);
    if (!variant.label.trim()) throw new Error(`variant.label is required: ${variant.id}`);
    if (!Array.isArray(variant.skillPaths) || !variant.skillPaths.every((path) => typeof path === "string")) {
      throw new Error(`variant.skillPaths must be a string array: ${variant.id}`);
    }
  }
  const taskIds = new Set<string>();
  for (const task of options.tasks) {
    if (!task.id.trim()) throw new Error("task.id is required");
    if (taskIds.has(task.id)) throw new Error(`duplicate task id: ${task.id}`);
    taskIds.add(task.id);
    if (!task.prompt.trim()) throw new Error(`task.prompt is required: ${task.id}`);
  }
}

function summarizeVariants(results: SkillEvaluationRunResult[]): SkillVariantSummary[] {
  const grouped = new Map<string, SkillEvaluationRunResult[]>();
  for (const result of results) grouped.set(result.variantId, [...(grouped.get(result.variantId) ?? []), result]);
  return Array.from(grouped.entries()).map(([variantId, rows]) => {
    const successful = rows.filter((result) => result.status === "success");
    const divisor = successful.length || 1;
    return {
      variantId,
      variantLabel: rows[0]?.variantLabel ?? variantId,
      total: rows.length,
      success: successful.length,
      failed: rows.length - successful.length,
      activationRate: activationRate(rows),
      avgDurationSec: sum(successful, "durationSec") / divisor,
      avgTotalTokens: sum(successful, "totalTokens") / divisor,
      avgTotalCost: sum(successful, "totalCost") / divisor,
      avgToolCalls: sum(successful, "toolCalls") / divisor,
      avgOutputChars: sum(successful, "outputChars") / divisor,
    };
  });
}

function summarizeTasks(results: SkillEvaluationRunResult[]): SkillTaskSummary[] {
  const grouped = new Map<string, SkillEvaluationRunResult[]>();
  for (const result of results) grouped.set(result.taskId, [...(grouped.get(result.taskId) ?? []), result]);
  return Array.from(grouped.entries()).map(([taskId, rows]) => {
    const success = rows.filter((result) => result.status === "success").length;
    return {
      taskId,
      total: rows.length,
      success,
      failed: rows.length - success,
      activationRate: activationRate(rows),
    };
  });
}

function activationRate(rows: SkillEvaluationRunResult[]): number {
  if (rows.length === 0) return 0;
  return rows.filter((result) => result.activation.activated).length / rows.length;
}

function summarizePairwise(results: SkillEvaluationRunResult[]): SkillPairwiseSummary[] {
  const grouped = new Map<string, SkillEvaluationRunResult[]>();
  for (const result of results) {
    if (!result.pairwise) continue;
    grouped.set(result.variantId, [...(grouped.get(result.variantId) ?? []), result]);
  }
  return Array.from(grouped.entries()).map(([variantId, rows]) => {
    const judged = rows.filter((result) => result.pairwise?.verdict !== "not_judged");
    const deltas = judged
      .map((result) => result.pairwise?.scoreDelta)
      .filter((value): value is number => typeof value === "number");
    const confidences = judged
      .map((result) => result.pairwise?.confidence)
      .filter((value): value is number => typeof value === "number");
    return {
      variantId,
      variantLabel: rows[0]?.variantLabel ?? variantId,
      judged: judged.length,
      skipped: rows.length - judged.length,
      win: judged.filter((result) => result.pairwise?.verdict === "win").length,
      tie: judged.filter((result) => result.pairwise?.verdict === "tie").length,
      loss: judged.filter((result) => result.pairwise?.verdict === "loss").length,
      avgScoreDelta: deltas.length ? deltas.reduce((acc, value) => acc + value, 0) / deltas.length : 0,
      avgConfidence: confidences.length ? confidences.reduce((acc, value) => acc + value, 0) / confidences.length : null,
    };
  });
}

function sum(rows: SkillEvaluationRunResult[], key: "durationSec" | "totalTokens" | "totalCost" | "toolCalls" | "outputChars"): number {
  return rows.reduce((acc, row) => acc + row[key], 0);
}

function sanitizeId(id: string): string {
  return id.replace(/[^a-zA-Z0-9_\-\u4e00-\u9fff]/g, "_").slice(0, 80) || "item";
}

function pairwiseKey(taskId: string, attempt: number): string {
  return `${taskId}#${attempt}`;
}

function clampScore(value: number): number {
  return Math.max(0, Math.min(100, value));
}

function clampConfidence(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function avgOrNull(values: number[]): number | null {
  return values.length ? values.reduce((acc, value) => acc + value, 0) / values.length : null;
}

function majorityVerdict(runs: SkillPairwiseResult[]): SkillPairwiseVerdict {
  const verdicts: Array<Exclude<SkillPairwiseVerdict, "not_judged">> = ["win", "tie", "loss"];
  const counts = new Map(verdicts.map((verdict) => [verdict, runs.filter((run) => run.verdict === verdict).length]));
  const maxCount = Math.max(...verdicts.map((verdict) => counts.get(verdict) ?? 0));
  const tied = verdicts.filter((verdict) => (counts.get(verdict) ?? 0) === maxCount);
  if (tied.length === 1) return tied[0]!;
  const avgDelta = (verdict: Exclude<SkillPairwiseVerdict, "not_judged">): number => {
    const deltas = runs.filter((run) => run.verdict === verdict).map((run) => run.scoreDelta).filter((value): value is number => typeof value === "number");
    return deltas.length ? deltas.reduce((acc, value) => acc + value, 0) / deltas.length : 0;
  };
  return tied.sort((a, b) => Math.abs(avgDelta(b)) - Math.abs(avgDelta(a)))[0] ?? "tie";
}
