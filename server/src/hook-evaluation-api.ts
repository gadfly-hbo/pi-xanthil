import type { HookEvalCase, HookEvent, HookExpectation } from "./types.ts";

export interface HookEvaluationRunRequest {
  repeat: number;
  cases: HookEvalCase[];
}

export type ParsedHookEvaluationRunRequest =
  | { ok: true; value: HookEvaluationRunRequest }
  | { ok: false; error: string };

const HOOK_EVENTS: ReadonlySet<HookEvent> = new Set<HookEvent>([
  "session_start", "session_shutdown",
  "before_agent_start", "agent_start", "agent_end",
  "turn_start", "turn_end",
  "tool_execution_start", "tool_execution_end", "tool_call",
  "message_end",
]);
const EXPECTATION_KINDS = new Set(["must-block", "must-allow", "golden-mutation", "match", "trigger-count"]);

export function parseHookEvaluationRunRequest(body: unknown): ParsedHookEvaluationRunRequest {
  const raw = typeof body === "object" && body !== null ? body as Record<string, unknown> : {};
  const repeat = Number(raw.repeat ?? 1);
  const cases = parseHookEvaluationCases(raw.cases);

  if (!Number.isInteger(repeat) || repeat < 1 || repeat > 5) {
    return { ok: false, error: "repeat must be an integer between 1 and 5" };
  }
  if (cases.length === 0) return { ok: false, error: "cases must not be empty" };

  return { ok: true, value: { repeat, cases } };
}

export function parseHookEvaluationCases(value: unknown): HookEvalCase[] {
  if (!Array.isArray(value)) return [];
  const cases: HookEvalCase[] = [];
  const seen = new Set<string>();
  for (const [index, item] of value.entries()) {
    if (typeof item !== "object" || item === null) continue;
    const raw = item as Record<string, unknown>;
    const id = String(raw.id ?? `case_${index + 1}`).trim();
    if (!id || seen.has(id)) continue;
    const name = String(raw.name ?? id).trim() || id;
    const event = String(raw.event ?? "").trim();
    if (!HOOK_EVENTS.has(event as HookEvent)) continue;
    const payload = typeof raw.payload === "object" && raw.payload !== null && !Array.isArray(raw.payload)
      ? raw.payload as Record<string, unknown>
      : {};
    const expected = parseExpectation(raw.expected);
    if (!expected) continue;
    const hookIds = stringArray(raw.hookIds);
    seen.add(id);
    cases.push({
      id,
      name,
      event: event as HookEvent,
      payload,
      ...(hookIds.length ? { hookIds } : {}),
      expected,
    });
  }
  return cases;
}

function parseExpectation(value: unknown): HookExpectation | null {
  if (typeof value !== "object" || value === null) return null;
  const raw = value as Record<string, unknown>;
  const kind = String(raw.kind ?? "").trim();
  if (!EXPECTATION_KINDS.has(kind)) return null;
  if (kind === "must-block") {
    const reasonPattern = typeof raw.reasonPattern === "string" && raw.reasonPattern.trim() ? raw.reasonPattern : undefined;
    return { kind, ...(reasonPattern ? { reasonPattern } : {}) };
  }
  if (kind === "must-allow") {
    return { kind };
  }
  if (kind === "golden-mutation") {
    if (typeof raw.expectedInput !== "object" || raw.expectedInput === null || Array.isArray(raw.expectedInput)) return null;
    return { kind, expectedInput: raw.expectedInput as Record<string, unknown> };
  }
  if (kind === "match") {
    return { kind, expectedHookIds: stringArray(raw.expectedHookIds) };
  }
  if (kind === "trigger-count") {
    const count = Number(raw.count);
    if (!Number.isInteger(count) || count < 0) return null;
    return { kind, count };
  }
  return null;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    : [];
}
