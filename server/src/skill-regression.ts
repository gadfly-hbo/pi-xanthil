import { randomUUID } from "node:crypto";
import { resolve, sep } from "node:path";
import { getSkillEvaluation, saveSkillEvaluation } from "./db.ts";
import {
  getLatestSkillRegistryEvalHistory,
  recordSkillRegistryEvalHistory,
  updateSkillRegistryMetrics,
  updateSkillRegistryRegression,
  type SkillRegistryEvalHistoryEntry,
  type SkillRegistryRetestTrigger,
} from "./db/engine.ts";
import {
  runSkillEvaluation,
  type SkillEvalTask,
  type SkillEvaluationRunnerOptions,
  type SkillEvaluationRunSummary,
  type SkillVariant,
} from "./skill-evaluation-runner.ts";
import type { SkillEvaluationDetail, SkillRegressionStatus, SkillRegistryEntry } from "./types.ts";

export interface SkillRegressionThresholds {
  scoreDrop: number;
  activationRateDrop: number;
}

export interface SkillRegistryEvaluationMetrics {
  score: number | null;
  activationRate: number | null;
}

export interface SkillRegressionComparison {
  previous: SkillRegistryEvalHistoryEntry | null;
  regressionStatus: SkillRegressionStatus;
  regressionReason: string | null;
  scoreDelta: number | null;
  activationDelta: number | null;
}

export interface SkillRegistryRetestResult {
  entry: SkillRegistryEntry | undefined;
  evaluation: SkillEvaluationDetail;
  metrics: SkillRegistryEvaluationMetrics;
  history: SkillRegistryEvalHistoryEntry;
  regression: SkillRegressionComparison;
}

export type SkillRegistryEvalRunner = (options: SkillEvaluationRunnerOptions) => Promise<SkillEvaluationRunSummary>;

export const DEFAULT_SKILL_REGRESSION_THRESHOLDS: SkillRegressionThresholds = {
  scoreDrop: 0.1,
  activationRateDrop: 0.2,
};

export function parseSkillRegressionThresholds(raw: unknown): SkillRegressionThresholds {
  const body = typeof raw === "object" && raw !== null ? raw as Record<string, unknown> : {};
  const thresholds = typeof body.thresholds === "object" && body.thresholds !== null
    ? body.thresholds as Record<string, unknown>
    : body;
  return {
    scoreDrop: parseThreshold(thresholds.scoreDrop, DEFAULT_SKILL_REGRESSION_THRESHOLDS.scoreDrop),
    activationRateDrop: parseThreshold(thresholds.activationRateDrop, DEFAULT_SKILL_REGRESSION_THRESHOLDS.activationRateDrop),
  };
}

export function skillRegistryMetricsFromEvaluation(
  skillId: string,
  summary: SkillEvaluationRunSummary,
): SkillRegistryEvaluationMetrics {
  const variant = summary.variantSummaries.find((item) => item.variantId === skillId);
  if (!variant) return { score: null, activationRate: null };
  const pairwise = summary.pairwiseSummaries.find((item) => item.variantId === skillId);
  const successRate = variant.total > 0 ? variant.success / variant.total : 0;
  const decided = pairwise ? pairwise.win + pairwise.tie + pairwise.loss : 0;
  const score = decided > 0 ? pairwise!.win / decided : successRate;
  return { score: Math.max(0, Math.min(1, score)), activationRate: variant.activationRate };
}

export function compareSkillRegression(
  current: SkillRegistryEvaluationMetrics,
  previous: SkillRegistryEvalHistoryEntry | null,
  thresholds: SkillRegressionThresholds = DEFAULT_SKILL_REGRESSION_THRESHOLDS,
): SkillRegressionComparison {
  const scoreDelta = current.score !== null && previous?.score != null ? current.score - previous.score : null;
  const activationDelta = current.activationRate !== null && previous?.activationRate != null
    ? current.activationRate - previous.activationRate
    : null;
  const reasons: string[] = [];
  if (scoreDelta !== null && scoreDelta <= -thresholds.scoreDrop) {
    reasons.push(`score dropped ${formatDelta(scoreDelta)} (threshold -${thresholds.scoreDrop})`);
  }
  if (activationDelta !== null && activationDelta <= -thresholds.activationRateDrop) {
    reasons.push(`activationRate dropped ${formatDelta(activationDelta)} (threshold -${thresholds.activationRateDrop})`);
  }
  return {
    previous,
    regressionStatus: reasons.length > 0 ? "regression" : "none",
    regressionReason: reasons.length > 0 ? reasons.join("; ") : null,
    scoreDelta,
    activationDelta,
  };
}

export async function runSkillRegistryRetest(input: {
  workspaceRoot: string;
  entry: SkillRegistryEntry;
  model: string;
  tasks: SkillEvalTask[];
  repeat: number;
  judgeRepeat: number;
  contextPrefix?: string;
  dataContextPaths?: string[];
  triggerKind: SkillRegistryRetestTrigger;
  thresholds?: SkillRegressionThresholds;
  previous?: SkillRegistryEvalHistoryEntry | null;
  runEvaluation?: SkillRegistryEvalRunner;
  evaluationId?: string;
}): Promise<SkillRegistryRetestResult> {
  const evaluationId = input.evaluationId ?? randomUUID();
  const skillPath = registrySkillPath(input.workspaceRoot, input.entry.slug);
  const variants = buildRegistryEvaluationVariants(input.entry, skillPath);
  const runner = input.runEvaluation ?? runSkillEvaluation;
  const summary = await runner({
    workspaceRoot: input.workspaceRoot,
    workspaceId: input.entry.workspaceId,
    evaluationId,
    model: input.model,
    variants,
    tasks: input.tasks,
    repeat: input.repeat,
    judgeRepeat: input.judgeRepeat,
    contextPrefix: input.contextPrefix,
    dataContextPaths: input.dataContextPaths,
  });
  const evaluation = saveSkillEvaluation(
    input.entry.workspaceId,
    input.model,
    input.repeat,
    variants,
    input.tasks,
    input.contextPrefix,
    summary,
  );
  const metrics = skillRegistryMetricsFromEvaluation(input.entry.id, summary);
  const previous = input.previous === undefined
    ? getLatestSkillRegistryEvalHistory({
        workspaceId: input.entry.workspaceId,
        slug: input.entry.slug,
        excludeEvaluationId: evaluation.evaluationId,
      }) ?? null
    : input.previous;
  const regression = compareSkillRegression(metrics, previous, input.thresholds);
  updateSkillRegistryMetrics(input.entry.id, metrics);
  const entry = updateSkillRegistryRegression(input.entry.id, {
    evaluationId: evaluation.evaluationId,
    regressionStatus: regression.regressionStatus,
    regressionReason: regression.regressionReason,
    scoreDelta: regression.scoreDelta,
    activationDelta: regression.activationDelta,
  });
  const history = recordSkillRegistryEvalHistory({
    workspaceId: input.entry.workspaceId,
    registryId: input.entry.id,
    slug: input.entry.slug,
    skillVersion: input.entry.version,
    evaluationId: evaluation.evaluationId,
    model: input.model,
    triggerKind: input.triggerKind,
    score: metrics.score,
    activationRate: metrics.activationRate,
    previousEvaluationId: previous?.evaluationId ?? null,
    previousScore: previous?.score ?? null,
    previousActivationRate: previous?.activationRate ?? null,
    scoreDelta: regression.scoreDelta,
    activationDelta: regression.activationDelta,
    regressionStatus: regression.regressionStatus,
    regressionReason: regression.regressionReason,
  });
  return { entry, evaluation, metrics, history, regression };
}

export async function maybeRunSkillVersionRetest(input: {
  workspaceRoot: string;
  entry: SkillRegistryEntry;
  triggerKind?: SkillRegistryRetestTrigger;
  thresholds?: SkillRegressionThresholds;
  runEvaluation?: SkillRegistryEvalRunner;
  evaluationId?: string;
}): Promise<SkillRegistryRetestResult | null> {
  if (input.entry.status !== "active") return null;
  const previous = getLatestSkillRegistryEvalHistory({
    workspaceId: input.entry.workspaceId,
    slug: input.entry.slug,
  });
  if (!previous) return null;
  const previousEvaluation = getSkillEvaluation(previous.evaluationId);
  if (!previousEvaluation) return null;
  return runSkillRegistryRetest({
    workspaceRoot: input.workspaceRoot,
    entry: input.entry,
    model: previousEvaluation.model,
    tasks: previousEvaluation.tasks,
    repeat: previousEvaluation.repeat,
    judgeRepeat: 1,
    contextPrefix: previousEvaluation.contextPrefix || undefined,
    triggerKind: input.triggerKind ?? "version_bump",
    thresholds: input.thresholds,
    previous,
    runEvaluation: input.runEvaluation,
    evaluationId: input.evaluationId,
  });
}

function buildRegistryEvaluationVariants(entry: SkillRegistryEntry, skillPath: string): SkillVariant[] {
  return [
    { id: "baseline", label: "Baseline", skillPaths: [] },
    { id: entry.id, label: `${entry.name} v${String(entry.version)}`, skillPaths: [skillPath] },
  ];
}

function registrySkillPath(workspaceRoot: string, slug: string): string {
  const root = resolve(workspaceRoot, ".pi", "skills");
  const skillPath = resolve(root, slug, "SKILL.md");
  if (!skillPath.startsWith(`${root}${sep}`)) throw new Error("invalid skill slug");
  return skillPath;
}

function parseThreshold(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 && parsed <= 1 ? parsed : fallback;
}

function formatDelta(value: number): string {
  return value.toFixed(3).replace(/0+$/, "").replace(/\.$/, "");
}
