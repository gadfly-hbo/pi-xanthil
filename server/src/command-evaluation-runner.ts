import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { expandCommand } from "./command-expand.ts";
import { buildOutputPathInstructions } from "./output-paths.ts";
import { runPiTurn, type PiRun, type RunPiOptions } from "./pi-adapter.ts";
import { collectEvent, emptyMetrics, extractText, messageOf, runJudge } from "./evaluation-common.ts";
import { evaluationError, unknownEvaluationError } from "./evaluation-errors.ts";
import type {
  CommandCaseSummary,
  CommandEvalCase,
  CommandExpectation,
  CommandEvaluationRunResult,
  EvaluationError,
  XanCommand,
} from "./types.ts";

export type CommandEvalRunTurn = (opts: RunPiOptions) => PiRun;
export interface CommandEvalJudgeOutputOptions {
  judgeDir: string;
  workspaceId: string;
  resultId: string;
  task: string;
  rubric: string;
  output: string;
  model: string;
}
export type CommandEvalJudgeOutput = (options: CommandEvalJudgeOutputOptions) => Promise<{ score: number | null; details: string }>;

export interface CommandEvaluationRunnerOptions {
  workspaceRoot: string;
  evaluationId: string;
  workspaceId: string;
  command: XanCommand;
  allCommands: XanCommand[];
  cases: CommandEvalCase[];
  repeat: number;
  model?: string;
  runRoot?: string;
  runTurn?: CommandEvalRunTurn;
  judgeOutput?: CommandEvalJudgeOutput;
  onResult?: (result: CommandEvaluationRunResult) => void;
}

export interface CommandEvaluationRunSummary {
  evaluationId: string;
  workspaceId: string;
  commandId: string;
  repeat: number;
  status: "success" | "failed";
  startedAt: number;
  endedAt: number;
  durationSec: number;
  cases: CommandEvalCase[];
  results: CommandEvaluationRunResult[];
  caseSummaries: CommandCaseSummary[];
}

export async function runCommandEvaluation(options: CommandEvaluationRunnerOptions): Promise<CommandEvaluationRunSummary> {
  validateOptions(options);
  const startedAt = Date.now();
  const runRoot = options.runRoot ?? join(options.workspaceRoot, "evaluations", "commands", options.evaluationId);
  mkdirSync(runRoot, { recursive: true });
  const results: CommandEvaluationRunResult[] = [];

  for (const testCase of options.cases) {
    for (let attempt = 1; attempt <= options.repeat; attempt++) {
      const result = await runCommandCase(options, runRoot, testCase, attempt);
      results.push(result);
      options.onResult?.(result);
    }
  }

  const endedAt = Date.now();
  const status = results.some((result) => result.status === "failed") ? "failed" : "success";
  return {
    evaluationId: options.evaluationId,
    workspaceId: options.workspaceId,
    commandId: options.command.id,
    repeat: options.repeat,
    status,
    startedAt,
    endedAt,
    durationSec: (endedAt - startedAt) / 1000,
    cases: options.cases,
    results,
    caseSummaries: summarizeCommandCases(results),
  };
}

export function summarizeCommandCases(results: CommandEvaluationRunResult[]): CommandCaseSummary[] {
  const byCase = new Map<string, CommandEvaluationRunResult[]>();
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
    };
  });
}

async function runCommandCase(
  options: CommandEvaluationRunnerOptions,
  runRoot: string,
  testCase: CommandEvalCase,
  attempt: number,
): Promise<CommandEvaluationRunResult> {
  const startedAt = Date.now();
  const id = `${sanitizeId(testCase.id)}-${attempt}`;
  const composeLine = `/${options.command.name}${testCase.argsText ? ` ${testCase.argsText}` : ""}`;

  try {
    const { expandedText, skillSlugs } = expandCommand(composeLine, options.allCommands);
    let output = "";
    if (testCase.expected.kind === "run-contains" || testCase.expected.kind === "run-llm-judge") {
      const caseDir = join(runRoot, id);
      mkdirSync(caseDir, { recursive: true });
      output = await runExpandedTurn(options, caseDir, id, expandedText);
    }
    const error = await evaluateExpectation(options, runRoot, id, testCase, expandedText, skillSlugs, output);
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
      expandedText,
      skillSlugs,
      output,
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
      expandedText: "",
      skillSlugs: [],
      output: "",
      expectation: testCase.expected,
      error: unknownEvaluationError(err, "Inspect the command evaluation case directory and pi stderr events."),
    };
  }
}

async function runExpandedTurn(
  options: CommandEvaluationRunnerOptions,
  caseDir: string,
  caseId: string,
  expandedText: string,
): Promise<string> {
  const runTurn = options.runTurn ?? runPiTurn;
  const metrics = emptyMetrics();
  let text = "";
  const contextPrefix = buildOutputPathInstructions(caseDir, "Command 评测运行目录");
  const run = runTurn({
    workspaceRoot: caseDir,
    piSessionId: `${options.evaluationId}-${caseId}`,
    text: `${contextPrefix}${expandedText}`,
    model: options.model || undefined,
    allowWeb: false,
    onEvent: (event) => {
      collectEvent(metrics, event, {
        workspaceId: options.workspaceId,
        targetId: caseId,
        title: `Command Evaluation: ${options.command.name}`,
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
    throw evaluationError("process_exit", `pi exited with code ${String(code)}`, "Check stderr and process_start events for this command evaluation case.");
  }
  return text || metrics.output;
}

async function evaluateExpectation(
  options: CommandEvaluationRunnerOptions,
  runRoot: string,
  resultId: string,
  testCase: CommandEvalCase,
  expandedText: string,
  skillSlugs: string[],
  output: string,
): Promise<EvaluationError | null> {
  const expectation = testCase.expected;
  if (expectation.kind === "expand-contains") {
    const missing = expectation.substrings.filter((needle) => !expandedText.includes(needle));
    if (missing.length) return evaluationError("unknown", `expanded text missing substrings: ${missing.join(", ")}`);
    if (expectation.forbidUnresolved && /\{\{.*?\}\}/.test(expandedText)) {
      return evaluationError("unknown", "expanded text still contains unresolved placeholders ({{...}})");
    }
    return null;
  }
  if (expectation.kind === "expand-golden") {
    const expected = expectation.normalizeWhitespace ? normalizeWhitespace(expectation.goldenText) : expectation.goldenText;
    const actual = expectation.normalizeWhitespace ? normalizeWhitespace(expandedText) : expandedText;
    return expected === actual ? null : evaluationError("unknown", `golden mismatch: ${textDiffHint(expected, actual)}`);
  }
  if (expectation.kind === "skill-attached") {
    const actual = new Set(skillSlugs);
    const missing = expectation.expectedSkillSlugs.filter((slug) => !actual.has(slug));
    if (missing.length) return evaluationError("unknown", `missing expected skill slugs: ${missing.join(", ")}`);
    if (expectation.exact) {
      const expectedSet = new Set(expectation.expectedSkillSlugs);
      const extra = skillSlugs.filter((slug) => !expectedSet.has(slug));
      if (extra.length) return evaluationError("unknown", `unexpected skill slugs (exact): ${extra.join(", ")}`);
    }
    return null;
  }
  if (expectation.kind === "run-contains") {
    const missing = expectation.substrings.filter((needle) => !output.includes(needle));
    return missing.length ? evaluationError("unknown", `run output missing substrings: ${missing.join(", ")}`) : null;
  }
  if (expectation.kind === "run-llm-judge") {
    return evaluateLlmJudge(options, runRoot, resultId, testCase, expectation, output);
  }
  return evaluationError("unknown", "unsupported command expectation");
}

async function evaluateLlmJudge(
  options: CommandEvaluationRunnerOptions,
  runRoot: string,
  resultId: string,
  testCase: CommandEvalCase,
  expectation: Extract<CommandExpectation, { kind: "run-llm-judge" }>,
  output: string,
): Promise<EvaluationError | null> {
  if (!output.trim()) return evaluationError("unknown", "run-llm-judge could not find readable run output");
  const judge = options.judgeOutput ?? defaultJudgeOutput;
  const judgeDir = join(runRoot, sanitizeId(resultId), "judge");
  mkdirSync(judgeDir, { recursive: true });
  const judged = await judge({
    judgeDir,
    workspaceId: options.workspaceId,
    resultId,
    task: `Evaluate command "${options.command.name}" run output for case "${testCase.name}".`,
    rubric: expectation.rubric,
    output,
    model: expectation.model,
  });
  if (judged.score === null) {
    return evaluationError("judge_failed", "run-llm-judge did not return a numeric score", judged.details);
  }
  const minScore = expectation.minScore ?? 70;
  return judged.score >= minScore
    ? null
    : evaluationError("unknown", `run-llm-judge score ${judged.score.toFixed(1)} below minimum ${minScore.toFixed(1)}`, judged.details);
}

function defaultJudgeOutput(options: CommandEvalJudgeOutputOptions): Promise<{ score: number | null; details: string }> {
  return runJudge(options.judgeDir, options.workspaceId, options.resultId, options.task, options.rubric, options.output, options.model);
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function textDiffHint(expected: string, actual: string): string {
  const expectedLines = expected.split(/\r?\n/);
  const actualLines = actual.split(/\r?\n/);
  const max = Math.max(expectedLines.length, actualLines.length);
  for (let index = 0; index < max; index++) {
    if ((expectedLines[index] ?? "") !== (actualLines[index] ?? "")) {
      return `line ${index + 1} expected ${quoteShort(expectedLines[index] ?? "")}, got ${quoteShort(actualLines[index] ?? "")}`;
    }
  }
  return "content differs";
}

function quoteShort(value: string): string {
  const singleLine = value.replace(/\s+/g, " ").trim();
  return JSON.stringify(singleLine.length > 140 ? `${singleLine.slice(0, 140)}...` : singleLine);
}

function validateOptions(options: CommandEvaluationRunnerOptions): void {
  if (!options.workspaceRoot.trim()) throw new Error("workspaceRoot is required");
  if (!options.evaluationId.trim()) throw new Error("evaluationId is required");
  if (!options.workspaceId.trim()) throw new Error("workspaceId is required");
  if (!options.command.id.trim()) throw new Error("command.id is required");
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
