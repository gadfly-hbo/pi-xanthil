import assert from "node:assert/strict";
import test from "node:test";
import { parseSubAgentEvaluationRunRequest } from "./subagent-evaluation-api.ts";

test("parseSubAgentEvaluationRunRequest parses template and trajectory expectation", () => {
  const parsed = parseSubAgentEvaluationRunRequest({
    model: "model-a",
    repeat: 2,
    cases: [{
      id: "case-a",
      name: "Trace",
      templateId: "analyst",
      brief: "Read clean data and write a report",
      dataFiles: ["sessions/s1/020_clean/data.csv"],
      expected: { kind: "tool-sequence", required: ["read", "write"], forbidden: ["shell"], orderedSubsequence: true },
    }],
  });
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;
  assert.equal(parsed.value.model, "model-a");
  assert.equal(parsed.value.cases[0]?.templateId, "analyst");
  assert.deepEqual(parsed.value.cases[0]?.expected, { kind: "tool-sequence", required: ["read", "write"], forbidden: ["shell"], orderedSubsequence: true });
});

test("parseSubAgentEvaluationRunRequest requires model, bounded repeat, cases, and persona/template", () => {
  assert.deepEqual(parseSubAgentEvaluationRunRequest({ repeat: 1, cases: [] }), { ok: false, error: "model required" });
  assert.deepEqual(parseSubAgentEvaluationRunRequest({ model: "m", repeat: 6, cases: [] }), { ok: false, error: "repeat must be an integer between 1 and 5" });
  assert.deepEqual(parseSubAgentEvaluationRunRequest({ model: "m", repeat: 1, cases: [{ brief: "x", expected: { kind: "report-presence" } }] }), { ok: false, error: "cases must not be empty" });
});

test("parseSubAgentEvaluationRunRequest rejects invalid expectation payload", () => {
  assert.deepEqual(parseSubAgentEvaluationRunRequest({
    model: "m",
    cases: [{ personaOverride: "analyst", brief: "x", expected: { kind: "step-budget", maxSteps: -1 } }],
  }), { ok: false, error: "cases must not be empty" });
});
