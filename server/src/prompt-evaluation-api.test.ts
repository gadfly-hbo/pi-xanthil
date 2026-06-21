import assert from "node:assert/strict";
import test from "node:test";
import { parsePromptEvaluationRunRequest } from "./prompt-evaluation-api.ts";

test("parsePromptEvaluationRunRequest parses prompt variants and tasks", () => {
  const parsed = parsePromptEvaluationRunRequest({
    model: "model-a",
    repeat: 2,
    judgeRepeat: 3,
    variants: [
      { id: "baseline", label: "Baseline", promptBody: "Be concise", role: "system", templateId: "template-a" },
      { id: "variant", label: "Variant", promptBody: "Use evidence", role: "prefix" },
    ],
    tasks: [{ id: "task", prompt: "Analyze retention", expectedPoints: ["churn"], rubric: "Be correct" }],
    dataContextPaths: [" /clean/data.csv ", ""],
  });
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;
  assert.equal(parsed.value.variants[0]?.role, "system");
  assert.equal(parsed.value.variants[0]?.templateId, "template-a");
  assert.equal(parsed.value.variants[1]?.role, "prefix");
  assert.deepEqual(parsed.value.dataContextPaths, ["/clean/data.csv"]);
});

test("parsePromptEvaluationRunRequest rejects invalid bounds and empty prompt variants", () => {
  assert.deepEqual(parsePromptEvaluationRunRequest({ repeat: 0 }), {
    ok: false,
    error: "repeat must be an integer between 1 and 5",
  });
  assert.deepEqual(parsePromptEvaluationRunRequest({ repeat: 1, judgeRepeat: 6 }), {
    ok: false,
    error: "judgeRepeat must be an integer between 1 and 5",
  });
  assert.deepEqual(parsePromptEvaluationRunRequest({
    repeat: 1,
    judgeRepeat: 1,
    variants: [{ id: "bad", promptBody: "", role: "system" }],
    tasks: [{ prompt: "Task" }],
  }), { ok: false, error: "variants must not be empty" });
});
