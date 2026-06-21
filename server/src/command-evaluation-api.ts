import type { CommandEvalCase, CommandExpectation } from "./types.ts";

export interface CommandEvaluationRunRequest {
  commandId: string;
  repeat: number;
  model?: string;
  cases: CommandEvalCase[];
}

export type ParsedCommandEvaluationRunRequest =
  | { ok: true; value: CommandEvaluationRunRequest }
  | { ok: false; error: string };

export function parseCommandEvaluationRunRequest(body: unknown): ParsedCommandEvaluationRunRequest {
  const raw = typeof body === "object" && body !== null ? body as Record<string, unknown> : {};
  const commandId = String(raw.commandId ?? "").trim();
  const repeat = Number(raw.repeat ?? 1);
  const model = typeof raw.model === "string" && raw.model.trim() ? raw.model.trim() : undefined;
  const cases = parseCommandEvaluationCases(raw.cases);

  if (!commandId) return { ok: false, error: "commandId required" };
  if (!Number.isInteger(repeat) || repeat < 1 || repeat > 5) {
    return { ok: false, error: "repeat must be an integer between 1 and 5" };
  }
  if (cases.length === 0) return { ok: false, error: "cases must not be empty" };
  const needsModel = cases.some((testCase) => testCase.expected.kind === "run-contains" || testCase.expected.kind === "run-llm-judge");
  if (needsModel && !model) return { ok: false, error: "model required when any case uses a run-* expectation" };

  return { ok: true, value: { commandId, repeat, model, cases } };
}

export function parseCommandEvaluationCases(value: unknown): CommandEvalCase[] {
  if (!Array.isArray(value)) return [];
  const cases: CommandEvalCase[] = [];
  const seen = new Set<string>();
  for (const [index, item] of value.entries()) {
    if (typeof item !== "object" || item === null) continue;
    const raw = item as Record<string, unknown>;
    const id = String(raw.id ?? `case_${index + 1}`).trim();
    if (!id || seen.has(id)) continue;
    const name = String(raw.name ?? id).trim() || id;
    const argsText = typeof raw.argsText === "string" ? raw.argsText : "";
    const expected = parseExpectation(raw.expected);
    const timeoutMs = Number(raw.timeoutMs ?? 0);
    if (!expected) continue;
    seen.add(id);
    cases.push({
      id,
      name,
      argsText,
      expected,
      ...(Number.isInteger(timeoutMs) && timeoutMs > 0 ? { timeoutMs } : {}),
    });
  }
  return cases;
}

function parseExpectation(value: unknown): CommandExpectation | null {
  if (typeof value !== "object" || value === null) return null;
  const raw = value as Record<string, unknown>;
  const kind = String(raw.kind ?? "").trim();
  if (kind === "expand-contains") {
    const substrings = stringArray(raw.substrings);
    const forbidUnresolved = raw.forbidUnresolved === true;
    return substrings.length || forbidUnresolved ? { kind, substrings, ...(forbidUnresolved ? { forbidUnresolved } : {}) } : null;
  }
  if (kind === "expand-golden") {
    const goldenText = typeof raw.goldenText === "string" ? raw.goldenText : "";
    const normalizeWhitespace = raw.normalizeWhitespace === true;
    return { kind, goldenText, ...(normalizeWhitespace ? { normalizeWhitespace } : {}) };
  }
  if (kind === "skill-attached") {
    const expectedSkillSlugs = stringArray(raw.expectedSkillSlugs);
    const exact = raw.exact === true;
    return expectedSkillSlugs.length ? { kind, expectedSkillSlugs, ...(exact ? { exact } : {}) } : null;
  }
  if (kind === "run-contains") {
    const substrings = stringArray(raw.substrings);
    return substrings.length ? { kind, substrings } : null;
  }
  if (kind === "run-llm-judge") {
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
