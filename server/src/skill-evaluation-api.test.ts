import assert from "node:assert/strict";
import test from "node:test";
import { parseSkillEvaluationRunRequest } from "./skill-evaluation-api.ts";

test("parseSkillEvaluationRunRequest parses variants and tasks", () => {
  const parsed = parseSkillEvaluationRunRequest({
    model: "model-a",
    repeat: 2,
    judgeRepeat: 3,
    variants: [
      { id: "baseline", label: "Baseline", skillPaths: [] },
      { id: "with_skill", label: "With Skill", skillPaths: ["/a/SKILL.md", ""] },
    ],
    tasks: [
      { id: "task", prompt: "Run task", expectedPoints: ["point"], rubric: "score it" },
    ],
    contextPrefix: "context",
  });

  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;
  assert.equal(parsed.value.model, "model-a");
  assert.equal(parsed.value.repeat, 2);
  assert.equal(parsed.value.judgeRepeat, 3);
  assert.deepEqual(parsed.value.variants[1]?.skillPaths, ["/a/SKILL.md"]);
  assert.deepEqual(parsed.value.tasks[0]?.expectedPoints, ["point"]);
});

test("parseSkillEvaluationRunRequest rejects invalid repeat and empty collections", () => {
  assert.deepEqual(parseSkillEvaluationRunRequest({ repeat: 0, variants: [{}], tasks: [{}] }), {
    ok: false,
    error: "repeat must be an integer between 1 and 5",
  });
  assert.deepEqual(parseSkillEvaluationRunRequest({ repeat: 1, judgeRepeat: 0, variants: [{}], tasks: [{}] }), {
    ok: false,
    error: "judgeRepeat must be an integer between 1 and 5",
  });
  assert.deepEqual(parseSkillEvaluationRunRequest({ repeat: 1, variants: [], tasks: [{ prompt: "Task" }] }), {
    ok: false,
    error: "variants must not be empty",
  });
  assert.deepEqual(parseSkillEvaluationRunRequest({ repeat: 1, variants: [{ id: "baseline" }], tasks: [] }), {
    ok: false,
    error: "tasks must not be empty",
  });
});
