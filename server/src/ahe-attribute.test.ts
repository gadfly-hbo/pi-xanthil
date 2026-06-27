import test from "node:test";
import assert from "node:assert/strict";
import { attributeHarnessEdit } from "./ahe-attribute.ts";
import type { ChangeManifest } from "./types.ts";

const manifest: ChangeManifest = {
  editId: "edit-1",
  component: "prompt",
  failureEvidence: "task-a failed",
  rootCause: "prompt missed constraint",
  targetedFix: "add explicit constraint",
  predictedFix: ["task-a"],
  predictedRegression: ["task-b"],
  outcome: "defer",
  createdAt: 1,
};

test("attributeHarnessEdit uses EFC quality for fix/regression verdict", () => {
  const result = attributeHarnessEdit({
    manifest,
    lab: "prompt",
    beforeEvaluation: {
      taskSummaries: [
        { taskId: "task-a", total: 1, success: 0, efc: { efc: 1, normalized: 1, eta: 0.1 } },
        { taskId: "task-b", total: 1, success: 1, efc: { efc: 6, normalized: 6, eta: 0.2 } },
      ],
    },
    afterEvaluation: {
      taskSummaries: [
        { taskId: "task-a", total: 1, success: 1, efc: { efc: 8, normalized: 8, eta: 0.3 } },
        { taskId: "task-b", total: 1, success: 1, efc: { efc: 3, normalized: 3, eta: 0.1 } },
      ],
    },
  });

  assert.deepEqual(result.improvedTasks, ["task-a"]);
  assert.deepEqual(result.verdict.regressedSolvedTasks, ["task-b"]);
  assert.equal(result.verdict.fixPrecision, 1);
  assert.equal(result.verdict.fixRecall, 1);
  assert.equal(result.verdict.regPrecision, 1);
  assert.equal(result.verdict.regRecall, 1);
  assert.equal(result.seesawPassed, false);
  assert.equal(result.shouldForkVariant, true);
  assert.equal(result.variant?.perTaskRouting["task-a"], "variant_edit-1");
  assert.equal(result.variant?.perTaskRouting["task-b"], "base");
});

test("attributeHarnessEdit passes seesaw gate when no solved task regresses", () => {
  const result = attributeHarnessEdit({
    manifest: { ...manifest, predictedRegression: [] },
    lab: "hook",
    beforeEvaluation: { caseSummaries: [{ caseId: "case-1", total: 1, success: 0, efc: { efc: 1, normalized: 1, eta: 0.1 } }] },
    afterEvaluation: { caseSummaries: [{ caseId: "case-1", total: 1, success: 1, efc: { efc: 4, normalized: 4, eta: 0.2 } }] },
  });

  assert.equal(result.seesawPassed, true);
  assert.equal(result.shouldForkVariant, false);
  assert.deepEqual(result.verdict.regressedSolvedTasks, []);
});
