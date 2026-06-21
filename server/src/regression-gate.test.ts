import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { LabTimelinePoint, SkillEvaluationDetail } from "./types.ts";

process.env.XANTHIL_DATA_DIR = mkdtempSync(join(tmpdir(), "pi-xanthil-regression-gate-test-"));

const {
  compareRegressionGate,
  evaluateRegressionGate,
  parseRegressionGateThresholds,
  DEFAULT_REGRESSION_GATE_THRESHOLDS,
} = await import("./regression-gate.ts");
const { buildLabTimelines } = await import("./lab-timeline.ts");
const db = await import("./db.ts");
const engineDb = await import("./db/engine.ts");

function point(over: Partial<LabTimelinePoint>): LabTimelinePoint {
  return {
    lab: "skill",
    resourceId: "r1",
    evaluationId: "e",
    startedAt: 0,
    status: "success",
    durationSec: 0,
    score: 0.9,
    passRate: 0.9,
    winRate: null,
    activationRate: null,
    ...over,
  };
}

// ---- 阈值边界（核心 CI gate 逻辑）----

test("gate: pass when no metric drop", () => {
  const v = compareRegressionGate("skill", "r1", point({ score: 0.9 }), point({ score: 0.9 }));
  assert.equal(v.decision, "pass");
  assert.equal(v.reason, null);
});

test("gate: score drop beyond threshold triggers regression", () => {
  // delta = -0.15 < -0.1 → regression（避开 0.8-0.9 的浮点边界毛刺）
  const v = compareRegressionGate("skill", "r1", point({ score: 0.75 }), point({ score: 0.9 }));
  assert.equal(v.decision, "regression");
  assert.match(v.reason ?? "", /score dropped/);
});

test("gate: score drop just under threshold passes", () => {
  // delta = -0.05 不触发
  const v = compareRegressionGate("skill", "r1", point({ score: 0.85 }), point({ score: 0.9 }));
  assert.equal(v.decision, "pass");
});

test("gate: activationRate uses its own (larger) threshold", () => {
  // activationRateDrop 默认 0.2；score/passRate 设为不变隔离干扰
  const cur = point({ score: 0.9, passRate: 0.9, activationRate: 0.7 });
  const prev = point({ score: 0.9, passRate: 0.9, activationRate: 0.9 });
  const v = compareRegressionGate("skill", "r1", cur, prev);
  assert.equal(v.decision, "regression");
  assert.match(v.reason ?? "", /activationRate dropped/);
  // -0.19 不触发
  const v2 = compareRegressionGate("skill", "r1", point({ activationRate: 0.71 }), prev);
  assert.equal(v2.decision, "pass");
});

test("gate: null metric on either side is skipped, not regression", () => {
  const v = compareRegressionGate("skill", "r1", point({ winRate: null }), point({ winRate: 0.9 }));
  assert.equal(v.decision, "pass");
  assert.equal(v.deltas.winRate, null);
});

test("gate: insufficient_data when missing current or previous", () => {
  assert.equal(compareRegressionGate("skill", "r1", point({}), null).decision, "insufficient_data");
  assert.equal(compareRegressionGate("skill", "r1", null, point({})).decision, "insufficient_data");
});

test("gate: multiple metric drops listed in reason", () => {
  const cur = point({ score: 0.5, passRate: 0.5, winRate: 0.5, activationRate: 0.5 });
  const prev = point({ score: 0.9, passRate: 0.9, winRate: 0.9, activationRate: 0.9 });
  const v = compareRegressionGate("skill", "r1", cur, prev);
  assert.equal(v.decision, "regression");
  for (const m of ["score", "passRate", "winRate", "activationRate"]) {
    assert.match(v.reason ?? "", new RegExp(m));
  }
});

test("parseRegressionGateThresholds clamps and falls back", () => {
  const t = parseRegressionGateThresholds({ scoreDrop: 0.3, passRateDrop: 5, winRateDrop: -1 });
  assert.equal(t.scoreDrop, 0.3);
  assert.equal(t.passRateDrop, DEFAULT_REGRESSION_GATE_THRESHOLDS.passRateDrop); // 5 out of range → default
  assert.equal(t.winRateDrop, DEFAULT_REGRESSION_GATE_THRESHOLDS.winRateDrop);   // -1 out of range → default
  // nested thresholds object
  const t2 = parseRegressionGateThresholds({ thresholds: { scoreDrop: 0.05 } });
  assert.equal(t2.scoreDrop, 0.05);
});

// ---- 聚合适配器 + 端到端门禁（DB-backed）----

function skillEval(id: string, startedAt: number, success: number, win: number): SkillEvaluationDetail {
  return {
    evaluationId: id,
    workspaceId: "",
    model: "m",
    repeat: 1,
    status: "success",
    startedAt,
    endedAt: startedAt + 1000,
    durationSec: 1,
    variants: [],
    tasks: [],
    contextPrefix: "",
    variantSummaries: [
      { variantId: "baseline", variantLabel: "Baseline", total: 10, success: 10, failed: 0, activationRate: 0, avgDurationSec: 0, avgTotalTokens: 0, avgTotalCost: 0, avgToolCalls: 0, avgOutputChars: 0 },
      { variantId: "skill-x", variantLabel: "Skill X", total: 10, success, failed: 10 - success, activationRate: 0.8, avgDurationSec: 0, avgTotalTokens: 0, avgTotalCost: 0, avgToolCalls: 0, avgOutputChars: 0 },
    ],
    taskSummaries: [],
    pairwiseSummaries: [
      { variantId: "skill-x", variantLabel: "Skill X", judged: 10, skipped: 0, win, tie: 0, loss: 10 - win, avgScoreDelta: 0, avgConfidence: null },
    ],
    results: [],
  };
}

test("aggregator: skill timeline uses pairwise win rate as score, excludes baseline", () => {
  const ws = db.createWorkspace("gate-agg");
  engineDb.saveSkillEvaluation(ws.id, "m", 1, [], [], undefined, skillEval("s1", 1000, 8, 9));
  const timelines = buildLabTimelines(ws.id, { lab: "skill" });
  assert.equal(timelines.length, 1, "baseline variant filtered out");
  const p = timelines[0]!.points[0]!;
  assert.equal(p.resourceId, "skill-x");
  assert.equal(p.winRate, 0.9);   // 9/(9+0+1)
  assert.equal(p.score, 0.9);     // win rate preferred
  assert.equal(p.passRate, 0.8);  // 8/10
  assert.equal(p.activationRate, 0.8);
});

test("end-to-end: evaluateRegressionGate picks latest two and flags regression", () => {
  const ws = db.createWorkspace("gate-e2e");
  engineDb.saveSkillEvaluation(ws.id, "m", 1, [], [], undefined, skillEval("a", 1000, 9, 9)); // win 0.9
  engineDb.saveSkillEvaluation(ws.id, "m", 1, [], [], undefined, skillEval("b", 2000, 6, 6)); // win 0.6 → drop 0.3
  const v = evaluateRegressionGate({ workspaceId: ws.id, lab: "skill", resourceId: "skill-x" });
  assert.equal(v.decision, "regression");
  assert.equal(v.current?.evaluationId, "b");
  assert.equal(v.previous?.evaluationId, "a");
});
