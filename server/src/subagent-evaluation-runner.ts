import { existsSync, mkdirSync, readFileSync, readdirSync, statSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { collectEvent, emptyMetrics, messageOf, runJudge } from "./evaluation-common.ts";
import { evaluationError, unknownEvaluationError } from "./evaluation-errors.ts";
import {
  DEFAULT_SUBAGENT_PERSONA,
  buildSubAgentSystemPrompt,
  resolveAllowedSubAgentDataFiles,
  resolveSubAgentCwd,
  resolveSubAgentTemplate,
  runSubAgentTurn,
  type SubAgentTurnInput,
} from "./subagent-core.ts";
import type { PiRun } from "./pi-adapter.ts";
import type { EvaluationError, PiEvent, SubAgentCaseSummary, SubAgentEvalCase, SubAgentEvaluationRunResult } from "./types.ts";

export type SubAgentEvalRunTurn = (input: SubAgentTurnInput) => PiRun;
export interface SubAgentJudgeOptions {
  judgeDir: string;
  workspaceId: string;
  resultId: string;
  task: string;
  rubric: string;
  output: string;
  model: string;
}
export type SubAgentJudgeOutput = (options: SubAgentJudgeOptions) => Promise<{ score: number | null; details: string }>;

export interface SubAgentEvaluationRunnerOptions {
  workspaceRoot: string;
  workspaceId: string;
  evaluationId: string;
  model: string;
  repeat: number;
  cases: SubAgentEvalCase[];
  runRoot?: string;
  runTurn?: SubAgentEvalRunTurn;
  judgeOutput?: SubAgentJudgeOutput;
  trackUsage?: boolean;
  onResult?: (result: SubAgentEvaluationRunResult) => void;
}

export interface SubAgentEvaluationRunSummary {
  evaluationId: string;
  workspaceId: string;
  repeat: number;
  status: "success" | "failed";
  startedAt: number;
  endedAt: number;
  durationSec: number;
  cases: SubAgentEvalCase[];
  results: SubAgentEvaluationRunResult[];
  caseSummaries: SubAgentCaseSummary[];
}

export async function runSubAgentEvaluation(options: SubAgentEvaluationRunnerOptions): Promise<SubAgentEvaluationRunSummary> {
  if (!options.model.trim()) throw new Error("model required");
  if (!Number.isInteger(options.repeat) || options.repeat < 1 || options.repeat > 5) throw new Error("repeat must be between 1 and 5");
  if (!options.cases.length) throw new Error("cases required");
  const startedAt = Date.now();
  const runRoot = options.runRoot ?? join(options.workspaceRoot, "evaluations", "subagents", options.evaluationId);
  mkdirSync(runRoot, { recursive: true });
  const results: SubAgentEvaluationRunResult[] = [];
  for (const testCase of options.cases) {
    for (let attempt = 1; attempt <= options.repeat; attempt++) {
      const result = await runCase(options, runRoot, testCase, attempt);
      results.push(result);
      options.onResult?.(result);
    }
  }
  const endedAt = Date.now();
  return {
    evaluationId: options.evaluationId,
    workspaceId: options.workspaceId,
    repeat: options.repeat,
    status: results.some((item) => item.status === "failed") ? "failed" : "success",
    startedAt,
    endedAt,
    durationSec: (endedAt - startedAt) / 1000,
    cases: options.cases,
    results,
    caseSummaries: summarizeSubAgentCases(results),
  };
}

export function summarizeSubAgentCases(results: SubAgentEvaluationRunResult[]): SubAgentCaseSummary[] {
  const groups = new Map<string, SubAgentEvaluationRunResult[]>();
  for (const item of results) groups.set(item.caseId, [...(groups.get(item.caseId) ?? []), item]);
  return Array.from(groups.entries()).map(([caseId, rows]) => {
    const successful = rows.filter((row) => row.status === "success");
    const divisor = successful.length || 1;
    return {
      caseId,
      caseName: rows[0]?.caseName ?? caseId,
      total: rows.length,
      success: successful.length,
      failed: rows.length - successful.length,
      avgDurationSec: successful.reduce((sum, row) => sum + row.durationSec, 0) / divisor,
      avgStepCount: successful.reduce((sum, row) => sum + row.stepCount, 0) / divisor,
      avgTotalTokens: successful.reduce((sum, row) => sum + row.totalTokens, 0) / divisor,
      avgTotalCost: successful.reduce((sum, row) => sum + row.totalCost, 0) / divisor,
    };
  });
}

async function runCase(options: SubAgentEvaluationRunnerOptions, runRoot: string, testCase: SubAgentEvalCase, attempt: number): Promise<SubAgentEvaluationRunResult> {
  const startedAt = Date.now();
  const id = `${safeId(testCase.id)}-${attempt}`;
  const caseRoot = join(runRoot, safeId(testCase.id), String(attempt));
  const reportDir = join(caseRoot, "report");
  mkdirSync(reportDir, { recursive: true });
  const metrics = emptyMetrics();
  const toolTrajectory: string[] = [];
  let stepCount = 0;
  let error: EvaluationError | null = null;
  let reportPath: string | null = null;
  let reportContent = "";
  try {
    const template = testCase.templateId ? resolveSubAgentTemplate(testCase.templateId) : undefined;
    if (testCase.templateId && !template) throw new Error(`subagent template not found or disabled: ${testCase.templateId}`);
    const persona = template?.persona.trim() || testCase.personaOverride?.trim() || DEFAULT_SUBAGENT_PERSONA;
    const toolIds = template ? template.toolIds : testCase.toolIdsOverride;
    const allowedFiles = resolveCaseDataFiles(options.workspaceRoot, testCase.dataFiles);
    if (testCase.dataFiles.length > 0 && allowedFiles.length !== testCase.dataFiles.length) {
      throw new Error("all dataFiles must resolve to existing files inside clean_data");
    }
    const cwd = resolveSubAgentCwd(caseRoot, options.workspaceId, id, options.evaluationId, toolIds);
    const systemPrompt = buildSubAgentSystemPrompt(persona, allowedFiles, reportDir);
    const runTurn = options.runTurn ?? runSubAgentTurn;
    const run = runTurn({
      cwd,
      piSessionId: `subagent-eval-${options.evaluationId}-${id}`,
      text: testCase.brief,
      systemPrompt,
      model: options.model,
      skillPaths: [],
      onEvent: (event) => collectTrajectory(event, metrics, toolTrajectory, () => { stepCount += 1; }, options, id, testCase.name),
    });
    const code = await waitForRun(run, testCase.timeoutMs);
    if (code !== 0) throw new Error(`subagent turn failed with code ${String(code)}`);
    const report = findReport(reportDir, options.workspaceRoot);
    reportPath = report?.path ?? null;
    reportContent = report?.content ?? "";
    error = await assertExpectation(options, testCase, id, metrics.output, reportContent, toolTrajectory, stepCount, metrics.totalTokens, reportPath, caseRoot);
  } catch (caught) {
    error = unknownEvaluationError(caught, "Review the subagent template, data allowlist, model, and tool permissions.");
  }
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
    toolTrajectory,
    stepCount,
    totalTokens: metrics.totalTokens,
    totalCost: metrics.totalCost,
    toolCalls: metrics.toolCalls,
    reportPath,
    output: metrics.output,
    expectation: testCase.expected,
    error,
  };
}

function collectTrajectory(event: PiEvent, metrics: ReturnType<typeof emptyMetrics>, trajectory: string[], incrementStep: () => void, options: SubAgentEvaluationRunnerOptions, resultId: string, title: string): void {
  collectEvent(metrics, event, options.trackUsage === false ? undefined : { workspaceId: options.workspaceId, targetId: resultId, title: `SubAgent ${title}` });
  const message = messageOf(event);
  if (!message || message.role !== "assistant") return;
  incrementStep();
  if (!Array.isArray(message.content)) return;
  for (const block of message.content) {
    if (typeof block !== "object" || block === null) continue;
    const item = block as { type?: string; name?: string; toolName?: string };
    if (item.type !== "tool_use" && item.type !== "toolCall") continue;
    const name = item.name || item.toolName;
    if (name) trajectory.push(name);
  }
}

async function assertExpectation(options: SubAgentEvaluationRunnerOptions, testCase: SubAgentEvalCase, resultId: string, output: string, reportContent: string, trajectory: string[], stepCount: number, totalTokens: number, reportPath: string | null, caseRoot: string): Promise<EvaluationError | null> {
  const expected = testCase.expected;
  if (expected.kind === "tool-sequence") {
    const missing = (expected.required ?? []).filter((name) => !trajectory.includes(name));
    const forbidden = (expected.forbidden ?? []).filter((name) => trajectory.includes(name));
    if (missing.length) return evaluationError("unknown", `Missing required tools: ${missing.join(", ")}`, "Review the brief or template tool allowlist.");
    if (forbidden.length) return evaluationError("unknown", `Forbidden tools called: ${forbidden.join(", ")}`, "Reduce template tool permissions or revise the brief.");
    if (expected.orderedSubsequence && !isSubsequence(expected.required ?? [], trajectory)) return evaluationError("unknown", "Required tools were not called in the expected order", `Actual trajectory: ${trajectory.join(" -> ")}`);
    return null;
  }
  if (expected.kind === "step-budget") return stepCount <= expected.maxSteps ? null : evaluationError("unknown", `Step budget exceeded: ${stepCount} > ${expected.maxSteps}`, "Tighten the brief or simplify the task.");
  if (expected.kind === "token-budget") return totalTokens <= expected.maxTokens ? null : evaluationError("unknown", `Token budget exceeded: ${totalTokens} > ${expected.maxTokens}`, "Tighten the brief or use a smaller context.");
  if (expected.kind === "report-presence") return reportPath ? null : evaluationError("unknown", "Subagent did not create a report", "Ensure write is permitted and the brief requires a report.");
  const judge = options.judgeOutput ?? defaultJudge;
  const judged = await judge({ judgeDir: join(caseRoot, "judge"), workspaceId: options.workspaceId, resultId, task: testCase.brief, rubric: expected.rubric, output: `${output}\n\nReport (${reportPath ?? "none"}):\n${reportContent.slice(0, 12_000)}`, model: expected.model });
  const minimum = expected.minScore ?? 70;
  return judged.score !== null && judged.score >= minimum ? null : evaluationError("judge_failed", `Judge score ${String(judged.score)} below minimum ${minimum}`, judged.details);
}

function defaultJudge(options: SubAgentJudgeOptions): Promise<{ score: number | null; details: string }> {
  mkdirSync(options.judgeDir, { recursive: true });
  return runJudge(options.judgeDir, options.workspaceId, options.resultId, options.task, options.rubric, options.output, options.model);
}

function resolveCaseDataFiles(workspaceRoot: string, dataFiles: string[]): string[] {
  return dataFiles.flatMap((value) => {
    const target = resolve(isAbsolute(value) ? value : join(workspaceRoot, value));
    // 红线加固：target 必须落在 workspaceRoot 内（拒绝指向 workspace 外任意 020_clean 的绝对路径）。
    const rel = relative(workspaceRoot, target);
    if (rel === "" || rel.startsWith("..") || isAbsolute(rel)) return [];
    const cleanDir = findCleanRoot(target);
    if (!cleanDir) return [];
    const resolved = resolveAllowedSubAgentDataFiles(cleanDir, [target]);
    return resolved.length === 1 && resolved[0] === target ? resolved : [];
  });
}

function findCleanRoot(target: string): string | null {
  let current = dirname(target);
  while (true) {
    if (basename(current) === "020_clean") return current;
    const parent = dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

function findReport(reportDir: string, workspaceRoot: string): { path: string; content: string } | null {
  if (!existsSync(reportDir)) return null;
  const file = readdirSync(reportDir, { withFileTypes: true }).find((entry) => entry.isFile() && statSync(join(reportDir, entry.name)).isFile());
  if (!file) return null;
  const absolutePath = join(reportDir, file.name);
  return { path: relative(workspaceRoot, absolutePath), content: readFileSync(absolutePath, "utf8") };
}

async function waitForRun(run: PiRun, timeoutMs?: number): Promise<number | null> {
  if (!timeoutMs) return run.done;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      run.done,
      new Promise<number | null>((_, reject) => { timer = setTimeout(() => { run.kill(); reject(new Error(`subagent evaluation timed out after ${timeoutMs}ms`)); }, timeoutMs); }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function isSubsequence(required: string[], actual: string[]): boolean {
  let index = 0;
  for (const item of actual) if (item === required[index]) index += 1;
  return index === required.length;
}

function safeId(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/gu, "_").slice(0, 80) || "case";
}
