import type { SubAgentEvalCase, SubAgentExpectation } from "./types.ts";

export interface SubAgentEvaluationRunRequest {
  model: string;
  repeat: number;
  cases: SubAgentEvalCase[];
}

export type ParsedSubAgentEvaluationRunRequest =
  | { ok: true; value: SubAgentEvaluationRunRequest }
  | { ok: false; error: string };

export function parseSubAgentEvaluationRunRequest(body: unknown): ParsedSubAgentEvaluationRunRequest {
  const raw = recordOf(body);
  const model = stringOf(raw.model);
  const repeat = Number(raw.repeat ?? 1);
  const cases = parseSubAgentEvaluationCases(raw.cases);
  if (!model) return { ok: false, error: "model required" };
  if (!Number.isInteger(repeat) || repeat < 1 || repeat > 5) {
    return { ok: false, error: "repeat must be an integer between 1 and 5" };
  }
  if (cases.length === 0) return { ok: false, error: "cases must not be empty" };
  return { ok: true, value: { model, repeat, cases } };
}

export function parseSubAgentEvaluationCases(value: unknown): SubAgentEvalCase[] {
  if (!Array.isArray(value)) return [];
  const result: SubAgentEvalCase[] = [];
  const seen = new Set<string>();
  for (const [index, item] of value.entries()) {
    const raw = recordOf(item);
    const id = stringOf(raw.id) || `case_${index + 1}`;
    const templateId = stringOf(raw.templateId) || undefined;
    const personaOverride = stringOf(raw.personaOverride) || undefined;
    const brief = stringOf(raw.brief);
    const expected = parseExpectation(raw.expected);
    if (!id || seen.has(id) || (!templateId && !personaOverride) || !brief || !expected) continue;
    seen.add(id);
    const timeoutMs = Number(raw.timeoutMs ?? 0);
    // D-QEVAL3 硬断言字段（均可选）
    const mustCallTools = stringArray(raw.mustCallTools);
    const mustNotCallTools = stringArray(raw.mustNotCallTools);
    const outputContains = stringArray(raw.outputContains);
    const outputNotContains = stringArray(raw.outputNotContains);
    const minOutputChars = Number(raw.minOutputChars);
    const maxToolCalls = Number(raw.maxToolCalls);
    const maxCostUsd = Number(raw.maxCostUsd);
    result.push({
      id,
      name: stringOf(raw.name) || id,
      ...(templateId ? { templateId } : {}),
      ...(personaOverride ? { personaOverride } : {}),
      ...(Array.isArray(raw.toolIdsOverride) ? { toolIdsOverride: stringArray(raw.toolIdsOverride) } : {}),
      brief,
      dataFiles: stringArray(raw.dataFiles),
      expected,
      ...(Number.isInteger(timeoutMs) && timeoutMs > 0 ? { timeoutMs } : {}),
      ...(mustCallTools.length ? { mustCallTools } : {}),
      ...(mustNotCallTools.length ? { mustNotCallTools } : {}),
      ...(outputContains.length ? { outputContains } : {}),
      ...(outputNotContains.length ? { outputNotContains } : {}),
      ...(Number.isFinite(minOutputChars) && minOutputChars > 0 ? { minOutputChars } : {}),
      ...(Number.isFinite(maxToolCalls) && maxToolCalls >= 0 ? { maxToolCalls } : {}),
      ...(Number.isFinite(maxCostUsd) && maxCostUsd >= 0 ? { maxCostUsd } : {}),
    });
  }
  return result;
}

function parseExpectation(value: unknown): SubAgentExpectation | null {
  const raw = recordOf(value);
  const kind = stringOf(raw.kind);
  if (kind === "tool-sequence") {
    const required = stringArray(raw.required);
    const forbidden = stringArray(raw.forbidden);
    if (!required.length && !forbidden.length) return null;
    return { kind, ...(required.length ? { required } : {}), ...(forbidden.length ? { forbidden } : {}), ...(raw.orderedSubsequence === true ? { orderedSubsequence: true } : {}) };
  }
  if (kind === "step-budget") {
    const maxSteps = Number(raw.maxSteps);
    return Number.isInteger(maxSteps) && maxSteps >= 0 ? { kind, maxSteps } : null;
  }
  if (kind === "token-budget") {
    const maxTokens = Number(raw.maxTokens);
    return Number.isInteger(maxTokens) && maxTokens >= 0 ? { kind, maxTokens } : null;
  }
  if (kind === "report-presence") return { kind };
  if (kind === "llm-judge") {
    const rubric = stringOf(raw.rubric);
    const model = stringOf(raw.model);
    const minScore = Number(raw.minScore ?? 70);
    return rubric && model && Number.isFinite(minScore) ? { kind, rubric, model, minScore } : null;
  }
  return null;
}

function recordOf(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? value as Record<string, unknown> : {};
}

function stringOf(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.flatMap((item) => {
    const text = stringOf(item);
    return text ? [text] : [];
  }) : [];
}
