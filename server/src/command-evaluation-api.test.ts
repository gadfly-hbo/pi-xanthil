import assert from "node:assert/strict";
import test from "node:test";
import { parseCommandEvaluationRunRequest, parseCommandEvaluationCases } from "./command-evaluation-api.ts";

test("parseCommandEvaluationRunRequest parses commandId, repeat and cases", () => {
  const parsed = parseCommandEvaluationRunRequest({
    commandId: "cmd-1",
    repeat: 2,
    cases: [{
      id: "golden",
      name: "Golden expansion",
      argsText: "数据集A --口径=月",
      expected: { kind: "expand-golden", goldenText: "分析 数据集A 按 月", normalizeWhitespace: true },
    }],
  });
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;
  assert.equal(parsed.value.commandId, "cmd-1");
  assert.equal(parsed.value.repeat, 2);
  assert.equal(parsed.value.model, undefined);
  assert.equal(parsed.value.cases[0]?.argsText, "数据集A --口径=月");
  assert.deepEqual(parsed.value.cases[0]?.expected, { kind: "expand-golden", goldenText: "分析 数据集A 按 月", normalizeWhitespace: true });
});

test("parseCommandEvaluationRunRequest enforces commandId, bounded repeat and non-empty cases", () => {
  assert.deepEqual(
    parseCommandEvaluationRunRequest({ repeat: 1, cases: [{ id: "c", expected: { kind: "expand-contains", substrings: ["x"] } }] }),
    { ok: false, error: "commandId required" },
  );
  assert.deepEqual(
    parseCommandEvaluationRunRequest({ commandId: "c", repeat: 6, cases: [{ id: "c", expected: { kind: "expand-contains", substrings: ["x"] } }] }),
    { ok: false, error: "repeat must be an integer between 1 and 5" },
  );
  assert.deepEqual(
    parseCommandEvaluationRunRequest({ commandId: "c", repeat: 1, cases: [] }),
    { ok: false, error: "cases must not be empty" },
  );
});

test("parseCommandEvaluationRunRequest requires model only when a run-* expectation is present", () => {
  const base = { commandId: "c", repeat: 1 };
  // run-llm-judge without model -> rejected at needsModel gate.
  assert.deepEqual(
    parseCommandEvaluationRunRequest({ ...base, cases: [{ id: "r", expected: { kind: "run-llm-judge", rubric: "good", model: "m" } }] }),
    { ok: false, error: "model required when any case uses a run-* expectation" },
  );
  // run-contains without model -> rejected.
  assert.deepEqual(
    parseCommandEvaluationRunRequest({ ...base, cases: [{ id: "r", expected: { kind: "run-contains", substrings: ["ok"] } }] }),
    { ok: false, error: "model required when any case uses a run-* expectation" },
  );
  // run-* with model -> ok.
  const withModel = parseCommandEvaluationRunRequest({ ...base, model: "doubao", cases: [{ id: "r", expected: { kind: "run-contains", substrings: ["ok"] } }] });
  assert.equal(withModel.ok, true);
  if (withModel.ok) assert.equal(withModel.value.model, "doubao");
  // pure expand-* needs no model.
  const expandOnly = parseCommandEvaluationRunRequest({ ...base, cases: [{ id: "e", expected: { kind: "expand-contains", substrings: ["x"] } }] });
  assert.equal(expandOnly.ok, true);
});

test("parseCommandEvaluationCases parses all five expectation kinds and drops malformed ones", () => {
  const cases = parseCommandEvaluationCases([
    { id: "a", expected: { kind: "expand-contains", substrings: ["x"], forbidUnresolved: true } },
    { id: "b", expected: { kind: "skill-attached", expectedSkillSlugs: ["s1"], exact: true } },
    { id: "c", expected: { kind: "run-llm-judge", rubric: "r", model: "m", minScore: 80 } },
    // malformed: skill-attached without slugs -> dropped.
    { id: "d", expected: { kind: "skill-attached", expectedSkillSlugs: [] } },
    // malformed: run-llm-judge missing model -> dropped.
    { id: "e", expected: { kind: "run-llm-judge", rubric: "r" } },
    // malformed: unknown kind -> dropped.
    { id: "f", expected: { kind: "nope" } },
    // duplicate id -> dropped.
    { id: "a", expected: { kind: "expand-golden", goldenText: "z" } },
  ]);
  assert.deepEqual(cases.map((item) => item.id), ["a", "b", "c"]);
  assert.deepEqual(cases[0]?.expected, { kind: "expand-contains", substrings: ["x"], forbidUnresolved: true });
  assert.deepEqual(cases[1]?.expected, { kind: "skill-attached", expectedSkillSlugs: ["s1"], exact: true });
  assert.deepEqual(cases[2]?.expected, { kind: "run-llm-judge", rubric: "r", model: "m", minScore: 80 });
});
