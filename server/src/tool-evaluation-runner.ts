import { execFile } from "node:child_process";
import { buildSanitizedEnv } from "./process-env.ts";
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync } from "node:fs";
import { basename, extname, join, relative, resolve, sep } from "node:path";
import { runJudge } from "./evaluation-common.ts";
import { evaluationError, unknownEvaluationError } from "./evaluation-errors.ts";
import { validateExtractionInput, type RegisteredExtractionTool } from "../tools/registry.ts";
import type { EvaluationError } from "./types.ts";

export type ToolExpectation =
  | { kind: "golden"; goldenDir: string; ignorePaths?: string[]; normalizeWhitespace?: boolean }
  | { kind: "schema"; jsonPath: string; schema: Record<string, unknown> }
  | { kind: "field-presence"; jsonPath: string; requiredKeys: string[] }
  | { kind: "must-fail"; expectedErrorPattern?: string }
  | { kind: "llm-judge"; rubric: string; model: string; minScore?: number };

export interface ToolEvalCase {
  id: string;
  name: string;
  inputPath: string;
  expected: ToolExpectation;
  timeoutMs?: number;
  params?: Record<string, string | number | boolean>;
}

export interface ToolEvaluationRunnerOptions {
  evaluationId: string;
  workspaceId: string;
  workspaceRoot: string;
  tool: RegisteredExtractionTool;
  cases: ToolEvalCase[];
  repeat: number;
  runRoot?: string;
  runTool?: ToolEvalRunTool;
  judgeOutput?: ToolEvalJudgeOutput;
}

export interface ToolEvalRunToolOptions {
  tool: RegisteredExtractionTool;
  inputPath: string;
  outputPath: string;
  summaryPath: string;
  timeoutMs: number;
  params?: Record<string, string | number | boolean>;
}

export interface ToolEvalToolRun {
  code: number | null;
  stdout: string;
  stderr: string;
}

export type ToolEvalRunTool = (options: ToolEvalRunToolOptions) => Promise<ToolEvalToolRun>;

export interface ToolEvalJudgeOutputOptions {
  judgeDir: string;
  workspaceId: string;
  resultId: string;
  task: string;
  rubric: string;
  output: string;
  model: string;
}

export type ToolEvalJudgeOutput = (options: ToolEvalJudgeOutputOptions) => Promise<{ score: number | null; details: string }>;

export interface ToolEvaluationRunResult {
  id: string;
  caseId: string;
  caseName: string;
  attempt: number;
  status: "success" | "failed";
  startedAt: number;
  endedAt: number;
  durationSec: number;
  inputPath: string;
  outputPath: string;
  stdout: string;
  stderr: string;
  summary: ToolRunSummary | null;
  expectation: ToolExpectation;
  error: EvaluationError | null;
}

export interface ToolEvaluationRunSummary {
  evaluationId: string;
  workspaceId: string;
  toolId: string;
  repeat: number;
  status: "success" | "failed";
  startedAt: number;
  endedAt: number;
  durationSec: number;
  cases: ToolEvalCase[];
  results: ToolEvaluationRunResult[];
  caseSummaries: ToolCaseSummary[];
}

export interface ToolCaseSummary {
  caseId: string;
  caseName: string;
  total: number;
  success: number;
  failed: number;
  avgDurationSec: number;
}

export interface ToolRunSummary {
  success?: number;
  failed?: number;
  error?: string;
  results?: Array<{ outputs?: string[]; error?: string; [key: string]: unknown }>;
  [key: string]: unknown;
}

const DEFAULT_TIMEOUT_MS = 60_000;

export async function runToolEvaluation(options: ToolEvaluationRunnerOptions): Promise<ToolEvaluationRunSummary> {
  validateToolEvaluationOptions(options);
  const startedAt = Date.now();
  const runRoot = options.runRoot ?? join(options.workspaceRoot, "evaluations", "tools", options.evaluationId);
  mkdirSync(runRoot, { recursive: true });
  const results: ToolEvaluationRunResult[] = [];

  for (const testCase of options.cases) {
    for (let attempt = 1; attempt <= options.repeat; attempt++) {
      results.push(await runToolCase(options, runRoot, testCase, attempt));
    }
  }

  const endedAt = Date.now();
  const status = results.some((result) => result.status === "failed") ? "failed" : "success";
  return {
    evaluationId: options.evaluationId,
    workspaceId: options.workspaceId,
    toolId: options.tool.id,
    repeat: options.repeat,
    status,
    startedAt,
    endedAt,
    durationSec: (endedAt - startedAt) / 1000,
    cases: options.cases,
    results,
    caseSummaries: summarizeToolCases(results),
  };
}

export function summarizeToolCases(results: ToolEvaluationRunResult[]): ToolCaseSummary[] {
  const byCase = new Map<string, ToolEvaluationRunResult[]>();
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

async function runToolCase(
  options: ToolEvaluationRunnerOptions,
  runRoot: string,
  testCase: ToolEvalCase,
  attempt: number,
): Promise<ToolEvaluationRunResult> {
  const startedAt = Date.now();
  const id = `${sanitizeId(testCase.id)}-${attempt}`;
  const caseDir = join(runRoot, id);
  const outputPath = join(caseDir, "output");
  mkdirSync(outputPath, { recursive: true });
  const summaryPath = join(caseDir, "summary.json");
  const timeoutMs = testCase.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  try {
    validateExtractionInput(options.tool, testCase.inputPath);
    const toolRun = await (options.runTool ?? runExtractionToolProcess)({
      tool: options.tool,
      inputPath: testCase.inputPath,
      outputPath,
      summaryPath,
      timeoutMs,
      params: testCase.params,
    });
    const summary = readToolSummary(summaryPath);
    const error = await evaluateExpectation(testCase.expected, {
      code: toolRun.code,
      stderr: toolRun.stderr,
      outputPath,
      summary,
      workspaceId: options.workspaceId,
      resultId: id,
      caseName: testCase.name,
      inputPath: testCase.inputPath,
      judgeDir: join(caseDir, "judge"),
      judgeOutput: options.judgeOutput,
    });
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
      inputPath: testCase.inputPath,
      outputPath,
      stdout: toolRun.stdout,
      stderr: toolRun.stderr,
      summary,
      expectation: testCase.expected,
      error,
    };
  } catch (err) {
    const endedAt = Date.now();
    const error = testCase.expected.kind === "must-fail"
      ? matchExpectedFailure(testCase.expected, String(err))
      : unknownEvaluationError(err, "Inspect the tool evaluation case output directory and tool stderr.");
    return {
      id,
      caseId: testCase.id,
      caseName: testCase.name,
      attempt,
      status: error ? "failed" : "success",
      startedAt,
      endedAt,
      durationSec: (endedAt - startedAt) / 1000,
      inputPath: testCase.inputPath,
      outputPath,
      stdout: "",
      stderr: "",
      summary: null,
      expectation: testCase.expected,
      error,
    };
  }
}

export function runExtractionToolProcess(options: ToolEvalRunToolOptions): Promise<ToolEvalToolRun> {
  return new Promise((resolveRun) => {
    const args = [
      options.tool.entryPath,
      "--input",
      options.inputPath,
      "--output",
      options.outputPath,
      "--json-summary",
      options.summaryPath,
    ];
    for (const param of options.tool.parameters ?? []) {
      const value = options.params?.[param.name] ?? param.default;
      if (value !== undefined && value !== "") args.push(`--param-${param.name}`, String(value));
    }
    execFile(options.tool.runtime, args, { 
      maxBuffer: 4 * 1024 * 1024, 
      timeout: options.timeoutMs,
      cwd: options.outputPath,
      env: buildSanitizedEnv(),
    }, (err, stdout, stderr) => {
      const code = typeof (err as { code?: unknown } | null)?.code === "number"
        ? (err as { code: number }).code
        : err
          ? 1
          : 0;
      resolveRun({ code, stdout, stderr });
    });
  });
}

async function evaluateExpectation(
  expectation: ToolExpectation,
  result: {
    code: number | null;
    stderr: string;
    outputPath: string;
    summary: ToolRunSummary;
    workspaceId: string;
    resultId: string;
    caseName: string;
    inputPath: string;
    judgeDir: string;
    judgeOutput?: ToolEvalJudgeOutput;
  },
): Promise<EvaluationError | null> {
  if (expectation.kind === "must-fail") {
    const message = result.summary.error || firstResultError(result.summary) || result.stderr;
    if (result.code === 0 && !result.summary.error && !firstResultError(result.summary)) {
      return evaluationError("unknown", "tool was expected to fail but completed successfully");
    }
    return matchExpectedFailure(expectation, message);
  }
  if (result.code !== 0 || result.summary.error) {
    return evaluationError("process_exit", result.summary.error || `tool exited with code ${String(result.code)}`, "Review tool stdout/stderr and summary.json.");
  }
  if (expectation.kind === "field-presence") return evaluateFieldPresence(expectation, result.outputPath);
  if (expectation.kind === "schema") return evaluateSchema(expectation, result.outputPath);
  if (expectation.kind === "golden") return evaluateGolden(expectation, result.outputPath);
  if (expectation.kind === "llm-judge") return evaluateLlmJudge(expectation, result);
  return evaluationError("unknown", "unsupported tool expectation");
}

function evaluateFieldPresence(expectation: Extract<ToolExpectation, { kind: "field-presence" }>, outputPath: string): EvaluationError | null {
  const loaded = readExpectedJson(outputPath, expectation.jsonPath);
  if (!loaded.ok) return loaded.error;
  const parsed = loaded.value;
  const missing = expectation.requiredKeys.filter((key) => !hasDeepKey(parsed, key));
  return missing.length
    ? evaluationError("unknown", `missing required JSON keys: ${missing.join(", ")}`)
    : null;
}

function evaluateSchema(expectation: Extract<ToolExpectation, { kind: "schema" }>, outputPath: string): EvaluationError | null {
  const loaded = readExpectedJson(outputPath, expectation.jsonPath);
  if (!loaded.ok) return loaded.error;
  const errors = validateJsonSchemaSubset(loaded.value, expectation.schema, "$");
  return errors.length
    ? evaluationError("unknown", `schema validation failed: ${errors.slice(0, 8).join("; ")}`)
    : null;
}

function readExpectedJson(outputPath: string, jsonPath: string): { ok: true; value: unknown } | { ok: false; error: EvaluationError } {
  const resolvedJsonPath = resolveOutputPath(outputPath, jsonPath);
  if (!existsSync(resolvedJsonPath)) return { ok: false, error: evaluationError("unknown", `expected JSON output not found: ${jsonPath}`) };
  try {
    return { ok: true, value: JSON.parse(readFileSync(resolvedJsonPath, "utf8")) as unknown };
  } catch (err) {
    return { ok: false, error: unknownEvaluationError(err, `Invalid JSON output: ${jsonPath}`) };
  }
}

function evaluateGolden(expectation: Extract<ToolExpectation, { kind: "golden" }>, outputPath: string): EvaluationError | null {
  const goldenDir = resolve(expectation.goldenDir);
  if (!statSync(goldenDir).isDirectory()) return evaluationError("unknown", `goldenDir is not a directory: ${expectation.goldenDir}`);
  const mismatches: string[] = [];
  for (const file of listFiles(goldenDir)) {
    const rel = relative(goldenDir, file);
    const actual = join(outputPath, rel);
    if (!existsSync(actual)) {
      mismatches.push(`missing ${rel}`);
      continue;
    }
    const diff = compareGoldenFile(file, actual, rel, expectation);
    if (diff) mismatches.push(diff);
  }
  return mismatches.length
    ? evaluationError("unknown", `golden output mismatch: ${mismatches.slice(0, 5).join("; ")}`)
    : null;
}

function compareGoldenFile(
  expectedPath: string,
  actualPath: string,
  rel: string,
  expectation: Extract<ToolExpectation, { kind: "golden" }>,
): string | null {
  const ext = extname(expectedPath).toLowerCase();
  const expectedText = readFileSync(expectedPath, "utf8");
  const actualText = readFileSync(actualPath, "utf8");
  if (ext === ".json") {
    try {
      const errors = compareJsonValue(
        JSON.parse(expectedText) as unknown,
        JSON.parse(actualText) as unknown,
        "$",
        normalizeIgnorePaths(expectation.ignorePaths ?? []),
      );
      return errors.length ? `diff ${rel}: ${errors.slice(0, 3).join(", ")}` : null;
    } catch (err) {
      return `invalid JSON ${rel}: ${String(err)}`;
    }
  }
  const expectedComparable = expectation.normalizeWhitespace ? normalizeWhitespace(expectedText) : expectedText;
  const actualComparable = expectation.normalizeWhitespace ? normalizeWhitespace(actualText) : actualText;
  return expectedComparable === actualComparable
    ? null
    : `diff ${rel}: ${textDiffHint(expectedComparable, actualComparable)}`;
}

async function evaluateLlmJudge(
  expectation: Extract<ToolExpectation, { kind: "llm-judge" }>,
  result: {
    outputPath: string;
    workspaceId: string;
    resultId: string;
    caseName: string;
    inputPath: string;
    judgeDir: string;
    judgeOutput?: ToolEvalJudgeOutput;
  },
): Promise<EvaluationError | null> {
  const output = readToolOutputText(result.outputPath);
  if (!output.trim()) return evaluationError("unknown", "llm-judge could not find readable tool output");
  const judge = result.judgeOutput ?? defaultJudgeOutput;
  const judged = await judge({
    judgeDir: result.judgeDir,
    workspaceId: result.workspaceId,
    resultId: result.resultId,
    task: `Evaluate tool output for case "${result.caseName}" from input ${result.inputPath}.`,
    rubric: expectation.rubric,
    output,
    model: expectation.model,
  });
  if (judged.score === null) {
    return evaluationError("judge_failed", "llm-judge did not return a numeric score", judged.details);
  }
  const minScore = expectation.minScore ?? 70;
  return judged.score >= minScore
    ? null
    : evaluationError("unknown", `llm-judge score ${judged.score.toFixed(1)} below minimum ${minScore.toFixed(1)}`, judged.details);
}

function defaultJudgeOutput(options: ToolEvalJudgeOutputOptions): Promise<{ score: number | null; details: string }> {
  return runJudge(options.judgeDir, options.workspaceId, options.resultId, options.task, options.rubric, options.output, options.model);
}

function matchExpectedFailure(expectation: Extract<ToolExpectation, { kind: "must-fail" }>, message: string): EvaluationError | null {
  if (!expectation.expectedErrorPattern) return null;
  try {
    return new RegExp(expectation.expectedErrorPattern).test(message)
      ? null
      : evaluationError("unknown", `expected failure pattern not found: ${expectation.expectedErrorPattern}`, message);
  } catch {
    return message.includes(expectation.expectedErrorPattern)
      ? null
      : evaluationError("unknown", `expected failure text not found: ${expectation.expectedErrorPattern}`, message);
  }
}

function validateJsonSchemaSubset(value: unknown, schema: Record<string, unknown>, path: string): string[] {
  const errors: string[] = [];
  const type = schema.type;
  if (typeof type === "string" && !matchesJsonType(value, type)) {
    errors.push(`${path} expected ${type}, got ${jsonTypeOf(value)}`);
    return errors;
  }
  const enumValues = schema.enum;
  if (Array.isArray(enumValues) && !enumValues.some((item) => deepEqualJson(item, value))) {
    errors.push(`${path} expected one of ${JSON.stringify(enumValues)}`);
  }
  const required = schema.required;
  if (Array.isArray(required)) {
    if (!isPlainObject(value)) {
      errors.push(`${path} required keys need object value`);
    } else {
      for (const key of required) {
        if (typeof key === "string" && !(key in value)) errors.push(`${path}.${key} is required`);
      }
    }
  }
  const properties = schema.properties;
  if (isPlainObject(properties)) {
    if (!isPlainObject(value)) {
      errors.push(`${path} properties need object value`);
    } else {
      for (const [key, childSchema] of Object.entries(properties)) {
        if (!(key in value) || !isPlainObject(childSchema)) continue;
        errors.push(...validateJsonSchemaSubset(value[key], childSchema, `${path}.${key}`));
      }
    }
  }
  const items = schema.items;
  if (isPlainObject(items)) {
    if (!Array.isArray(value)) {
      errors.push(`${path} items need array value`);
    } else {
      value.forEach((item, index) => {
        errors.push(...validateJsonSchemaSubset(item, items, `${path}[${index}]`));
      });
    }
  }
  return errors;
}

function matchesJsonType(value: unknown, type: string): boolean {
  if (type === "array") return Array.isArray(value);
  if (type === "object") return isPlainObject(value);
  if (type === "null") return value === null;
  if (type === "integer") return Number.isInteger(value);
  return jsonTypeOf(value) === type;
}

function jsonTypeOf(value: unknown): string {
  if (Array.isArray(value)) return "array";
  if (value === null) return "null";
  if (Number.isInteger(value)) return "integer";
  return typeof value;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function deepEqualJson(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function compareJsonValue(expected: unknown, actual: unknown, path: string, ignorePaths: Set<string>): string[] {
  if (isIgnoredJsonPath(path, ignorePaths)) return [];
  if (Array.isArray(expected) || Array.isArray(actual)) {
    if (!Array.isArray(expected) || !Array.isArray(actual)) {
      return [`${path} expected ${jsonTypeOf(expected)}, got ${jsonTypeOf(actual)}`];
    }
    const errors: string[] = [];
    if (expected.length !== actual.length) errors.push(`${path} length expected ${expected.length}, got ${actual.length}`);
    for (let index = 0; index < Math.min(expected.length, actual.length); index++) {
      errors.push(...compareJsonValue(expected[index], actual[index], `${path}[${index}]`, ignorePaths));
      if (errors.length >= 8) break;
    }
    return errors;
  }
  if (isPlainObject(expected) || isPlainObject(actual)) {
    if (!isPlainObject(expected) || !isPlainObject(actual)) {
      return [`${path} expected ${jsonTypeOf(expected)}, got ${jsonTypeOf(actual)}`];
    }
    const errors: string[] = [];
    const keys = new Set([...Object.keys(expected), ...Object.keys(actual)]);
    for (const key of keys) {
      const childPath = `${path}.${key}`;
      if (isIgnoredJsonPath(childPath, ignorePaths)) continue;
      if (!(key in expected)) errors.push(`${childPath} unexpected`);
      else if (!(key in actual)) errors.push(`${childPath} missing`);
      else errors.push(...compareJsonValue(expected[key], actual[key], childPath, ignorePaths));
      if (errors.length >= 8) break;
    }
    return errors;
  }
  return deepEqualJson(expected, actual) ? [] : [`${path} expected ${shortJson(expected)}, got ${shortJson(actual)}`];
}

function normalizeIgnorePaths(paths: string[]): Set<string> {
  return new Set(paths.map(normalizeJsonPath).filter(Boolean));
}

function isIgnoredJsonPath(path: string, ignorePaths: Set<string>): boolean {
  const normalized = normalizeJsonPath(path);
  for (const ignored of ignorePaths) {
    if (normalized === ignored || normalized.startsWith(`${ignored}.`) || normalized.startsWith(`${ignored}[`)) return true;
  }
  return false;
}

function normalizeJsonPath(path: string): string {
  return path.trim().replace(/^\$\.?/, "").replace(/^\./, "");
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

function shortJson(value: unknown): string {
  return quoteShort(JSON.stringify(value));
}

function quoteShort(value: string | undefined): string {
  const raw = value ?? "";
  const singleLine = raw.replace(/\s+/g, " ").trim();
  return JSON.stringify(singleLine.length > 140 ? `${singleLine.slice(0, 140)}...` : singleLine);
}

function readToolSummary(summaryPath: string): ToolRunSummary {
  if (!existsSync(summaryPath)) return { success: 0, failed: 1, error: "summary.json was not written", results: [] };
  return JSON.parse(readFileSync(summaryPath, "utf8")) as ToolRunSummary;
}

function readToolOutputText(outputPath: string): string {
  const readableExts = new Set([".json", ".md", ".markdown", ".txt", ".csv"]);
  const chunks: string[] = [];
  let remaining = 60_000;
  for (const file of listFiles(outputPath)) {
    if (remaining <= 0) break;
    if (!readableExts.has(extname(file).toLowerCase())) continue;
    const stat = statSync(file);
    if (!stat.isFile()) continue;
    const rel = relative(outputPath, file);
    const text = readFileSync(file, "utf8").slice(0, remaining);
    remaining -= text.length;
    chunks.push(`# ${rel}\n${text}`);
  }
  return chunks.join("\n\n");
}

function resolveOutputPath(outputPath: string, requestedPath: string): string {
  if (!requestedPath.trim()) throw new Error("jsonPath required");
  if (requestedPath.includes("*")) {
    const match = findFirstByBasename(outputPath, requestedPath.replaceAll("*", ""));
    if (match) return match;
  }
  const absolute = resolve(outputPath, requestedPath);
  if (absolute !== outputPath && !absolute.startsWith(outputPath + sep)) throw new Error("jsonPath must stay inside output directory");
  return absolute;
}

function findFirstByBasename(root: string, suffix: string): string | null {
  for (const file of listFiles(root)) {
    if (basename(file).endsWith(suffix) || extname(file) === suffix) return file;
  }
  return null;
}

function listFiles(root: string): string[] {
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const path = join(root, entry.name);
    return entry.isDirectory() ? listFiles(path) : [path];
  });
}

function firstResultError(summary: ToolRunSummary): string {
  const item = summary.results?.find((row) => typeof row.error === "string");
  return typeof item?.error === "string" ? item.error : "";
}

function hasDeepKey(value: unknown, key: string): boolean {
  const parts = key.split(".").filter(Boolean);
  let current = value;
  for (const part of parts) {
    if (Array.isArray(current)) current = current[0];
    if (typeof current !== "object" || current === null || !(part in current)) return false;
    current = (current as Record<string, unknown>)[part];
  }
  return true;
}

function validateToolEvaluationOptions(options: ToolEvaluationRunnerOptions): void {
  if (!options.evaluationId.trim()) throw new Error("evaluationId is required");
  if (!options.workspaceId.trim()) throw new Error("workspaceId is required");
  if (!options.workspaceRoot.trim()) throw new Error("workspaceRoot is required");
  if (!Number.isInteger(options.repeat) || options.repeat < 1 || options.repeat > 5) throw new Error("repeat must be an integer between 1 and 5");
  if (options.cases.length === 0) throw new Error("cases must not be empty");
  const caseIds = new Set<string>();
  for (const testCase of options.cases) {
    if (!testCase.id.trim()) throw new Error("case.id is required");
    if (caseIds.has(testCase.id)) throw new Error(`duplicate case id: ${testCase.id}`);
    caseIds.add(testCase.id);
    if (!testCase.name.trim()) throw new Error(`case.name is required: ${testCase.id}`);
    if (!testCase.inputPath.trim()) throw new Error(`case.inputPath is required: ${testCase.id}`);
  }
}

function sanitizeId(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]+/g, "_").slice(0, 80) || "case";
}
