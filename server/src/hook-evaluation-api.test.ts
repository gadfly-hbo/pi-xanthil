import assert from "node:assert/strict";
import test from "node:test";
import { parseHookEvaluationRunRequest } from "./hook-evaluation-api.ts";

test("parseHookEvaluationRunRequest parses event, payload, hookIds and expectation", () => {
  const parsed = parseHookEvaluationRunRequest({
    repeat: 2,
    cases: [{
      id: "block-rm",
      name: "Block rm -rf",
      event: "tool_call",
      payload: { toolName: "bash", input: { command: "rm -rf /" } },
      hookIds: ["guard-1"],
      expected: { kind: "must-block", reasonPattern: "rm" },
    }],
  });
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;
  assert.equal(parsed.value.repeat, 2);
  assert.equal(parsed.value.cases[0]?.event, "tool_call");
  assert.deepEqual(parsed.value.cases[0]?.hookIds, ["guard-1"]);
  assert.deepEqual(parsed.value.cases[0]?.expected, { kind: "must-block", reasonPattern: "rm" });
});

test("parseHookEvaluationRunRequest enforces bounded repeat and non-empty cases", () => {
  assert.deepEqual(parseHookEvaluationRunRequest({ repeat: 6, cases: [] }), { ok: false, error: "repeat must be an integer between 1 and 5" });
  assert.deepEqual(parseHookEvaluationRunRequest({ repeat: 1, cases: [] }), { ok: false, error: "cases must not be empty" });
});

test("parseHookEvaluationRunRequest drops cases with invalid event or expectation", () => {
  // Invalid HookEvent -> case dropped -> empty -> error.
  assert.deepEqual(parseHookEvaluationRunRequest({
    repeat: 1,
    cases: [{ id: "c1", event: "not_a_real_event", payload: {}, expected: { kind: "must-allow" } }],
  }), { ok: false, error: "cases must not be empty" });

  // golden-mutation without object expectedInput -> case dropped.
  assert.deepEqual(parseHookEvaluationRunRequest({
    repeat: 1,
    cases: [{ id: "c2", event: "tool_call", payload: {}, expected: { kind: "golden-mutation", expectedInput: "nope" } }],
  }), { ok: false, error: "cases must not be empty" });

  // trigger-count with negative count -> case dropped.
  assert.deepEqual(parseHookEvaluationRunRequest({
    repeat: 1,
    cases: [{ id: "c3", event: "tool_call", payload: {}, expected: { kind: "trigger-count", count: -1 } }],
  }), { ok: false, error: "cases must not be empty" });
});

test("parseHookEvaluationRunRequest accepts match and trigger-count", () => {
  const parsed = parseHookEvaluationRunRequest({
    repeat: 1,
    cases: [
      { id: "m", event: "tool_call", payload: {}, expected: { kind: "match", expectedHookIds: ["a", "b"] } },
      { id: "t", event: "tool_call", payload: {}, expected: { kind: "trigger-count", count: 2 } },
    ],
  });
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;
  assert.equal(parsed.value.cases.length, 2);
});
