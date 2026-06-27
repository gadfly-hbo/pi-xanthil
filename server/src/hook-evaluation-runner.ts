import { evaluateHookFixture, type Hook, type HookVerdict } from "../../pi-extensions/px-hook-runner/hook-eval-core.ts";
import { coerceEfcDifficulty, scoreEfcRuns, type EfcScoreDetail } from "./efc-scoring.ts";
import { evaluationError, unknownEvaluationError } from "./evaluation-errors.ts";
import type {
  EvaluationError,
  HookCaseSummary,
  HookEvalCase,
  HookEvaluationDetail,
  HookEvaluationRunResult,
  HookExpectation,
} from "./types.ts";

// hooks lab 是护栏单测：纯判定，零 spawn / 零 fs / 零 record。verdict 一律走 evaluateHookFixture（D.4 唯一真源）。
export type HookEvaluateFixture = (hooks: Hook[], eventName: string, payload: Record<string, unknown>) => HookVerdict;
export type HookCaseSummaryWithEfc = HookCaseSummary & { efc?: EfcScoreDetail };

export interface HookEvaluationRunnerOptions {
  evaluationId: string;
  workspaceId: string;
  hooks: Hook[];               // 全局 hooks.json（已 coerce 成 Hook[]）
  cases: HookEvalCase[];
  repeat: number;
  evaluate?: HookEvaluateFixture;  // 单测注入点；默认 evaluateHookFixture（真实纯函数）
  onResult?: (result: HookEvaluationRunResult) => void;
}

export interface HookEvaluationRunSummary {
  evaluationId: string;
  workspaceId: string;
  repeat: number;
  status: "success" | "failed";
  startedAt: number;
  endedAt: number;
  durationSec: number;
  cases: HookEvalCase[];
  results: HookEvaluationRunResult[];
  caseSummaries: HookCaseSummaryWithEfc[];
}

export function runHookEvaluation(options: HookEvaluationRunnerOptions): HookEvaluationRunSummary {
  validateOptions(options);
  const evaluate = options.evaluate ?? evaluateHookFixture;
  const startedAt = Date.now();
  const results: HookEvaluationRunResult[] = [];

  for (const testCase of options.cases) {
    const subset = selectHooks(options.hooks, testCase.hookIds);
    for (let attempt = 1; attempt <= options.repeat; attempt++) {
      const result = runHookCase(evaluate, subset, testCase, attempt);
      results.push(result);
      options.onResult?.(result);
    }
  }

  const endedAt = Date.now();
  const status = results.some((result) => result.status === "failed") ? "failed" : "success";
  return {
    evaluationId: options.evaluationId,
    workspaceId: options.workspaceId,
    repeat: options.repeat,
    status,
    startedAt,
    endedAt,
    durationSec: (endedAt - startedAt) / 1000,
    cases: options.cases,
    results,
    caseSummaries: summarizeHookCases(results, options.cases),
  };
}

// 缺省=全部 enabled；有 hookIds=按集合过滤（仍只取 enabled）。
function selectHooks(hooks: Hook[], hookIds: string[] | undefined): Hook[] {
  const enabled = hooks.filter((hook) => hook.enabled);
  if (!hookIds || hookIds.length === 0) return enabled;
  const wanted = new Set(hookIds);
  return enabled.filter((hook) => wanted.has(hook.id));
}

function runHookCase(
  evaluate: HookEvaluateFixture,
  subset: Hook[],
  testCase: HookEvalCase,
  attempt: number,
): HookEvaluationRunResult {
  const startedAt = Date.now();
  const id = `${sanitizeId(testCase.id)}-${attempt}`;
  try {
    const verdict = evaluate(subset, testCase.event, testCase.payload);
    const error = evaluateExpectation(testCase.expected, verdict);
    const endedAt = Date.now();
    return {
      id,
      caseId: testCase.id,
      caseName: testCase.name,
      attempt,
      status: error ? "failed" : "success",
      startedAt,
      endedAt,
      durationSec: (endedAt - startedAt) / 1000,
      ...verdict,
      expectation: testCase.expected,
      error,
    };
  } catch (err) {
    const endedAt = Date.now();
    return {
      id,
      caseId: testCase.id,
      caseName: testCase.name,
      attempt,
      status: "failed",
      startedAt,
      endedAt,
      durationSec: (endedAt - startedAt) / 1000,
      matchedHookIds: [],
      blocked: false,
      blockReason: null,
      mutatedInput: null,
      sideEffectKinds: [],
      triggerCount: 0,
      expectation: testCase.expected,
      error: unknownEvaluationError(err, "Inspect the hook fixture payload and selected hook subset."),
    };
  }
}

function evaluateExpectation(expectation: HookExpectation, verdict: HookVerdict): EvaluationError | null {
  if (expectation.kind === "must-block") {
    if (!verdict.blocked) return evaluationError("unknown", "expected tool_call to be blocked, but it was allowed");
    if (expectation.reasonPattern) {
      let regex: RegExp;
      try {
        regex = new RegExp(expectation.reasonPattern);
      } catch {
        return evaluationError("unknown", `invalid reasonPattern regex: ${expectation.reasonPattern}`);
      }
      if (!regex.test(verdict.blockReason ?? "")) {
        return evaluationError("unknown", `block reason ${JSON.stringify(verdict.blockReason)} does not match /${expectation.reasonPattern}/`);
      }
    }
    return null;
  }
  if (expectation.kind === "must-allow") {
    return verdict.blocked ? evaluationError("unknown", `expected allow, but blocked: ${verdict.blockReason ?? "(no reason)"}`) : null;
  }
  if (expectation.kind === "golden-mutation") {
    if (verdict.mutatedInput === null) return evaluationError("unknown", "expected a mutated input, but no mutate hook applied");
    return deepEqual(verdict.mutatedInput, expectation.expectedInput)
      ? null
      : evaluationError("unknown", `golden mutation mismatch: got ${JSON.stringify(verdict.mutatedInput)}, expected ${JSON.stringify(expectation.expectedInput)}`);
  }
  if (expectation.kind === "match") {
    return setEqual(verdict.matchedHookIds, expectation.expectedHookIds)
      ? null
      : evaluationError("unknown", `matched hooks mismatch: got [${verdict.matchedHookIds.join(", ")}], expected [${expectation.expectedHookIds.join(", ")}]`);
  }
  if (expectation.kind === "trigger-count") {
    return verdict.triggerCount === expectation.count
      ? null
      : evaluationError("unknown", `trigger count ${verdict.triggerCount} !== expected ${expectation.count}`);
  }
  return evaluationError("unknown", "unsupported hook expectation");
}

export function summarizeHookCases(results: HookEvaluationRunResult[], cases: HookEvalCase[] = []): HookCaseSummaryWithEfc[] {
  const byCase = new Map<string, HookEvaluationRunResult[]>();
  for (const result of results) {
    byCase.set(result.caseId, [...(byCase.get(result.caseId) ?? []), result]);
  }
  return Array.from(byCase.entries()).map(([caseId, rows]) => {
    const successful = rows.filter((row) => row.status === "success");
    const divisor = successful.length || 1;
    return {
      caseId,
      caseName: rows[0]?.caseName ?? caseId,
      total: rows.length,
      success: successful.length,
      failed: rows.length - successful.length,
      avgDurationSec: successful.reduce((acc, row) => acc + row.durationSec, 0) / divisor,
      efc: scoreEfcRuns(rows.map((row) => ({
        status: row.status,
        validity: row.status === "success" ? "passing" : "assertion",
        hasOutput: row.matchedHookIds.length > 0 || Boolean(row.blockReason) || row.mutatedInput !== null,
        totalTokens: 0,
        toolCalls: row.triggerCount,
        memorySignal: row.mutatedInput !== null ? "changed_plan" : "unknown",
        signature: `${row.caseId}:${row.status}:${row.blockReason ?? ""}:${row.matchedHookIds.join(",")}`,
      })), {
        difficulty: coerceEfcDifficulty((cases.find((testCase) => testCase.id === caseId) as unknown as { efcDifficulty?: unknown } | undefined)?.efcDifficulty),
      }),
    };
  });
}

function setEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const setA = new Set(a);
  if (setA.size !== new Set(b).size) return false;
  return b.every((item) => setA.has(item));
}

function deepEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(sortKeys(a)) === JSON.stringify(sortKeys(b));
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value as Record<string, unknown>)
        .sort()
        .map((key) => [key, sortKeys((value as Record<string, unknown>)[key])]),
    );
  }
  return value;
}

function validateOptions(options: HookEvaluationRunnerOptions): void {
  if (!options.evaluationId.trim()) throw new Error("evaluationId is required");
  if (!options.workspaceId.trim()) throw new Error("workspaceId is required");
  if (!Number.isInteger(options.repeat) || options.repeat < 1 || options.repeat > 5) throw new Error("repeat must be an integer between 1 and 5");
  if (options.cases.length === 0) throw new Error("cases must not be empty");
  const caseIds = new Set<string>();
  for (const testCase of options.cases) {
    if (!testCase.id.trim()) throw new Error("case.id is required");
    if (caseIds.has(testCase.id)) throw new Error(`duplicate case id: ${testCase.id}`);
    caseIds.add(testCase.id);
    if (!testCase.name.trim()) throw new Error(`case.name is required: ${testCase.id}`);
  }
}

function sanitizeId(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]+/g, "_").slice(0, 80) || "case";
}
