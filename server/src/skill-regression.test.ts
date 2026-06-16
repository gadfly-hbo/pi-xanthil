import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { SkillEvaluationRunSummary } from "./skill-evaluation-runner.ts";

process.env.XANTHIL_DATA_DIR = mkdtempSync(join(tmpdir(), "pi-xanthil-skill-regression-test-"));

const db = await import("./db.ts");
const engineDb = await import("./db/engine.ts");
const { maybeRunSkillVersionRetest, runSkillRegistryRetest } = await import("./skill-regression.ts");

test("skill version retest records regression against previous evaluation history", async () => {
  const workspace = db.createWorkspace("skill regression");
  const v1 = engineDb.createSkillRegistryEntry(workspace.id, {
    slug: "portable-analysis",
    name: "Portable Analysis",
    source: "manual",
    status: "active",
  });
  const task = { id: "task", prompt: "Use the skill." };

  await runSkillRegistryRetest({
    workspaceRoot: workspace.rootPath,
    entry: v1,
    model: "model-a",
    tasks: [task],
    repeat: 1,
    judgeRepeat: 1,
    triggerKind: "manual_evaluate",
    runEvaluation: async (options) => fakeSummary(options.evaluationId, v1.id, 0.9, 0.9),
    evaluationId: "eval-v1",
  });

  const v2 = engineDb.createSkillRegistryEntry(workspace.id, {
    slug: "portable-analysis",
    name: "Portable Analysis",
    source: "manual",
    status: "active",
    supersedesId: v1.id,
  });
  const result = await maybeRunSkillVersionRetest({
    workspaceRoot: workspace.rootPath,
    entry: v2,
    thresholds: { scoreDrop: 0.1, activationRateDrop: 0.2 },
    runEvaluation: async (options) => {
      assert.equal(options.model, "model-a");
      assert.deepEqual(options.tasks, [task]);
      return fakeSummary(options.evaluationId, v2.id, 0.6, 0.5);
    },
    evaluationId: "eval-v2",
  });

  assert.ok(result);
  assert.equal(result.regression.regressionStatus, "regression");
  assert.equal(result.history.previousEvaluationId, "eval-v1");
  assert.equal(result.history.scoreDelta, -0.30000000000000004);
  assert.equal(result.history.activationDelta, -0.4);
  const updated = engineDb.getSkillRegistryEntry(v2.id);
  assert.equal(updated?.regressionStatus, "regression");
  assert.equal(updated?.lastEvaluationId, "eval-v2");
  assert.match(updated?.regressionReason ?? "", /score dropped/);
  assert.match(updated?.regressionReason ?? "", /activationRate dropped/);
});

function fakeSummary(evaluationId: string, skillId: string, score: number, activationRate: number): SkillEvaluationRunSummary {
  const decided = 10;
  const wins = Math.round(score * decided);
  return {
    evaluationId,
    status: "success",
    startedAt: 1,
    endedAt: 2,
    durationSec: 1,
    results: [],
    variantSummaries: [
      { variantId: "baseline", variantLabel: "Baseline", total: 1, success: 1, failed: 0, activationRate: 0, avgDurationSec: 1, avgTotalTokens: 0, avgTotalCost: 0, avgToolCalls: 0, avgOutputChars: 0 },
      { variantId: skillId, variantLabel: "Skill", total: 1, success: 1, failed: 0, activationRate, avgDurationSec: 1, avgTotalTokens: 0, avgTotalCost: 0, avgToolCalls: 0, avgOutputChars: 0 },
    ],
    taskSummaries: [
      { taskId: "task", total: 2, success: 2, failed: 0, activationRate },
    ],
    pairwiseSummaries: [
      { variantId: skillId, variantLabel: "Skill", judged: decided, skipped: 0, win: wins, tie: 0, loss: decided - wins, avgScoreDelta: 0, avgConfidence: 1 },
    ],
  };
}
