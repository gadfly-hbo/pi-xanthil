import type { ChangeManifest, EditVerdict, HarnessVariant, LabKind } from "./types.ts";

interface TaskOutcome {
  taskId: string;
  solved: boolean;
  quality: number;
}

export interface AttributeResult {
  verdict: EditVerdict;
  improvedTasks: string[];
  regressedTasks: string[];
  solvedBeforeTasks: string[];
  seesawPassed: boolean;
  shouldForkVariant: boolean;
  variant?: HarnessVariant;
}

export function attributeHarnessEdit(input: {
  manifest: ChangeManifest;
  lab: LabKind;
  beforeEvaluation: unknown;
  afterEvaluation: unknown;
}): AttributeResult {
  const before = extractTaskOutcomes(input.beforeEvaluation);
  const after = extractTaskOutcomes(input.afterEvaluation);
  const beforeMap = new Map(before.map((item) => [item.taskId, item]));
  const afterMap = new Map(after.map((item) => [item.taskId, item]));
  const taskIds = new Set([...beforeMap.keys(), ...afterMap.keys()]);

  const improvedTasks: string[] = [];
  const regressedTasks: string[] = [];
  const solvedBeforeTasks: string[] = before.filter((item) => item.solved).map((item) => item.taskId);
  const regressedSolvedTasks: string[] = [];

  for (const taskId of taskIds) {
    const prev = beforeMap.get(taskId);
    const next = afterMap.get(taskId);
    if (!next) continue;
    const prevQuality = prev?.quality ?? 0;
    const nextQuality = next.quality;
    if (next.solved && (!prev?.solved || nextQuality > prevQuality)) improvedTasks.push(taskId);
    if (prev?.solved && (!next.solved || nextQuality < prevQuality)) {
      regressedTasks.push(taskId);
      regressedSolvedTasks.push(taskId);
    } else if (prev && nextQuality < prevQuality) {
      regressedTasks.push(taskId);
    }
  }

  const predictedFix = new Set(input.manifest.predictedFix);
  const predictedRegression = new Set(input.manifest.predictedRegression);
  const improved = new Set(improvedTasks);
  const regressed = new Set(regressedTasks);
  const fixedPredicted = intersectionCount(predictedFix, improved);
  const regressedPredicted = intersectionCount(predictedRegression, regressed);

  const verdict: EditVerdict = {
    editId: input.manifest.editId,
    fixPrecision: ratio(fixedPredicted, predictedFix.size),
    fixRecall: ratio(fixedPredicted, improved.size),
    regPrecision: ratio(regressedPredicted, predictedRegression.size),
    regRecall: ratio(regressedPredicted, regressed.size),
    regressedSolvedTasks,
  };

  const shouldForkVariant = improvedTasks.length > 0 && regressedSolvedTasks.length > 0;
  return {
    verdict,
    improvedTasks,
    regressedTasks,
    solvedBeforeTasks,
    seesawPassed: regressedSolvedTasks.length === 0,
    shouldForkVariant,
    variant: shouldForkVariant
      ? {
        variantId: `variant_${input.manifest.editId}`,
        baseEditId: input.manifest.editId,
        perTaskRouting: buildRouting(taskIds, improved, new Set(regressedSolvedTasks), input.manifest.editId),
      }
      : undefined,
  };
}

function extractTaskOutcomes(evaluation: unknown): TaskOutcome[] {
  if (!isRecord(evaluation)) return [];
  if (Array.isArray(evaluation.caseSummaries)) {
    return evaluation.caseSummaries.flatMap((item) => {
      if (!isRecord(item)) return [];
      const taskId = String(item.caseId ?? "").trim();
      if (!taskId) return [];
      const total = numberOf(item.total);
      const success = numberOf(item.success);
      return [{
        taskId,
        solved: total > 0 && success >= total,
        quality: scoreQuality(item, total > 0 ? success / total : 0),
      }];
    });
  }
  if (Array.isArray(evaluation.taskSummaries)) {
    return evaluation.taskSummaries.flatMap((item) => {
      if (!isRecord(item)) return [];
      const taskId = String(item.taskId ?? "").trim();
      if (!taskId) return [];
      const total = numberOf(item.total);
      const success = numberOf(item.success);
      return [{
        taskId,
        solved: total > 0 && success >= total,
        quality: scoreQuality(item, total > 0 ? success / total : 0),
      }];
    });
  }
  return [];
}

function scoreQuality(row: Record<string, unknown>, fallback: number): number {
  const efc = row.efc;
  if (isRecord(efc)) {
    const normalized = numberOf(efc.normalized);
    const raw = numberOf(efc.efc);
    if (normalized > 0) return normalized;
    if (raw > 0) return raw;
  }
  return fallback;
}

function buildRouting(taskIds: Set<string>, improved: Set<string>, regressedSolved: Set<string>, editId: string): Record<string, string> {
  const routing: Record<string, string> = {};
  for (const taskId of taskIds) {
    routing[taskId] = improved.has(taskId) && !regressedSolved.has(taskId) ? `variant_${editId}` : "base";
  }
  return routing;
}

function intersectionCount(left: Set<string>, right: Set<string>): number {
  let count = 0;
  for (const item of left) if (right.has(item)) count += 1;
  return count;
}

function ratio(numerator: number, denominator: number): number {
  return denominator > 0 ? Math.round((numerator / denominator) * 1000) / 1000 : 0;
}

function numberOf(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
