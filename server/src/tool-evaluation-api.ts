import { resolve, sep } from "node:path";
import type { ToolEvalCase } from "./tool-evaluation-runner.ts";

export interface ToolEvaluationRunRequest {
  toolId: string;
  repeat: number;
  cases: ToolEvalCase[];
}

export type ParsedToolEvaluationRunRequest =
  | { ok: true; value: ToolEvaluationRunRequest }
  | { ok: false; error: string };

export function parseToolEvaluationRunRequest(body: unknown): ParsedToolEvaluationRunRequest {
  const raw = typeof body === "object" && body !== null ? body as Record<string, unknown> : {};
  const toolId = String(raw.toolId ?? "").trim();
  const repeat = Number(raw.repeat ?? 1);
  const cases = parseToolEvaluationCases(raw.cases);

  if (!toolId) return { ok: false, error: "toolId required" };
  if (!Number.isInteger(repeat) || repeat < 1 || repeat > 5) {
    return { ok: false, error: "repeat must be an integer between 1 and 5" };
  }
  if (cases.length === 0) return { ok: false, error: "cases must not be empty" };

  return { ok: true, value: { toolId, repeat, cases } };
}

export function parseToolEvaluationCases(value: unknown): ToolEvalCase[] {
  if (!Array.isArray(value)) return [];
  const cases: ToolEvalCase[] = [];
  const seen = new Set<string>();
  for (const [index, item] of value.entries()) {
    if (typeof item !== "object" || item === null) continue;
    const raw = item as Record<string, unknown>;
    const id = String(raw.id ?? `case_${index + 1}`).trim();
    if (!id || seen.has(id)) continue;
    const name = String(raw.name ?? id).trim() || id;
    const inputPath = String(raw.inputPath ?? "").trim();
    const expected = parseExpectation(raw.expected);
    const timeoutMs = Number(raw.timeoutMs ?? 0);
    if (!inputPath || !expected) continue;
    seen.add(id);
    cases.push({
      id,
      name,
      inputPath,
      expected,
      ...(Number.isInteger(timeoutMs) && timeoutMs > 0 ? { timeoutMs } : {}),
    });
  }
  return cases;
}

export function resolveToolEvaluationCasePaths(cases: ToolEvalCase[], rootPath: string): ToolEvalCase[] {
  return cases.map((testCase) => ({
    ...testCase,
    inputPath: resolveTemplatePath(testCase.inputPath, rootPath),
    expected: testCase.expected.kind === "golden"
      ? { ...testCase.expected, goldenDir: resolveTemplatePath(testCase.expected.goldenDir, rootPath) }
      : testCase.expected,
  }));
}

function parseExpectation(value: unknown): ToolEvalCase["expected"] | null {
  if (typeof value !== "object" || value === null) return null;
  const raw = value as Record<string, unknown>;
  const kind = String(raw.kind ?? "").trim();
  if (kind === "golden") {
    const goldenDir = String(raw.goldenDir ?? "").trim();
    const ignorePaths = stringArray(raw.ignorePaths);
    const normalizeWhitespace = raw.normalizeWhitespace === true;
    return goldenDir ? { kind, goldenDir, ...(ignorePaths.length ? { ignorePaths } : {}), ...(normalizeWhitespace ? { normalizeWhitespace } : {}) } : null;
  }
  if (kind === "field-presence") {
    const jsonPath = String(raw.jsonPath ?? "").trim();
    const requiredKeys = stringArray(raw.requiredKeys);
    return jsonPath && requiredKeys.length ? { kind, jsonPath, requiredKeys } : null;
  }
  if (kind === "must-fail") {
    const expectedErrorPattern = String(raw.expectedErrorPattern ?? "").trim();
    return expectedErrorPattern ? { kind, expectedErrorPattern } : { kind };
  }
  if (kind === "schema") {
    const jsonPath = String(raw.jsonPath ?? "").trim();
    const schema = typeof raw.schema === "object" && raw.schema !== null ? raw.schema as Record<string, unknown> : null;
    return jsonPath && schema ? { kind, jsonPath, schema } : null;
  }
  if (kind === "llm-judge") {
    const rubric = String(raw.rubric ?? "").trim();
    const model = String(raw.model ?? "").trim();
    const minScore = Number(raw.minScore ?? 70);
    return rubric && model ? { kind, rubric, model, ...(Number.isFinite(minScore) ? { minScore } : {}) } : null;
  }
  return null;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    : [];
}

function resolveTemplatePath(value: string, rootPath: string): string {
  if (value.startsWith("/")) return value;
  const root = resolve(rootPath);
  const absolute = resolve(root, value);
  if (absolute !== root && !absolute.startsWith(root + sep)) {
    throw new Error(`template path must stay inside tool folder: ${value}`);
  }
  return absolute;
}
