import test from "node:test";
import assert from "node:assert/strict";
import {
  buildChangeManifestFromEvalRecord,
  buildEvalRecordFromFinding,
  buildFlowFailureTrajectory,
  buildMonitorFindingTrajectory,
  sanitizeTrajectoryText,
  shouldCreateEvalFromFinding,
} from "./evolve-engine.ts";
import type { HealthFinding, MonitorRun } from "./types.ts";

const run: MonitorRun = {
  id: "run-1",
  workspaceId: "ws-1",
  suite: "monthly",
  metricSystemId: "ms-1",
  startedAt: 1,
  finishedAt: 2,
  problemCount: 1,
  riskCount: 0,
  status: "done",
};

function finding(lifecycle: HealthFinding["lifecycle"]): HealthFinding {
  return {
    id: `finding-${lifecycle}`,
    runId: "run-1",
    ruleId: "R-GAP-TARGET",
    category: "指标异常",
    kind: "问题",
    severity: "critical",
    lifecycle,
    signature: "R-GAP-TARGET::ds-source::revenue",
    firstSeenRunId: lifecycle === "new" ? null : "run-0",
    title: "收入低于目标",
    evidence: {
      threshold: 0.1,
      rows: [{ revenue: 100 }],
      nested: { draw_data: "/workspace/draw_data/raw.csv", sample: "secret row" },
    },
    boundTo: { datasetPathId: "ds-source", metricId: "revenue", column: "revenue" },
    comparisons: [{ kind: "target", label: "目标", currentValue: 100, baselineValue: 150, delta: -50, deltaRate: -0.33 }],
    suggestion: "检查目标差距",
    detectedAt: 3,
  };
}

test("shouldCreateEvalFromFinding only accepts recurring or worsening findings", () => {
  assert.equal(shouldCreateEvalFromFinding(finding("new")), false);
  assert.equal(shouldCreateEvalFromFinding(finding("resolved")), false);
  assert.equal(shouldCreateEvalFromFinding(finding("recurring")), true);
  assert.equal(shouldCreateEvalFromFinding(finding("worsening")), true);
});

test("buildMonitorFindingTrajectory redacts row-level and draw_data payloads", () => {
  const trajectory = buildMonitorFindingTrajectory(run, finding("recurring"));
  assert.equal(trajectory.module, "monitor");
  assert.equal(trajectory.outcome, "fail");
  const text = JSON.stringify(trajectory);
  assert.equal(text.includes("secret row"), false);
  assert.equal(text.includes("/workspace/draw_data/raw.csv"), false);
  assert.equal(text.includes("R-GAP-TARGET::ds-source::revenue"), true);
});

test("buildEvalRecordFromFinding creates candidate eval record payload", () => {
  const f = finding("worsening");
  const trajectory = buildMonitorFindingTrajectory(run, f);
  const record = buildEvalRecordFromFinding(f, trajectory);
  assert.equal(record.sourceFindingId, f.id);
  assert.equal(record.annotationStatus, "candidate");
  assert.equal(record.failingTrace.runId, run.id);
  assert.match(record.passCondition, /raw row-level data/);
});

test("buildChangeManifestFromEvalRecord reuses AHE manifest with human gate", () => {
  const f = finding("recurring");
  const trajectory = buildMonitorFindingTrajectory(run, f);
  const partial = buildEvalRecordFromFinding(f, trajectory);
  const manifest = buildChangeManifestFromEvalRecord({
    record: { id: "eval-1", createdAt: 10, ...partial },
    component: "skill",
  });
  assert.equal(manifest.component, "skill");
  assert.equal(manifest.outcome, "defer");
  assert.deepEqual(manifest.predictedFix, ["eval-1"]);
  assert.deepEqual(manifest.predictedRegression, []);
  assert.match(manifest.outcomeReason ?? "", /Human gate/);
});

test("buildFlowFailureTrajectory stores bounded output preview only", () => {
  const trajectory = buildFlowFailureTrajectory({
    runId: "flow-run-1",
    module: "anax",
    flowId: "flow-1",
    flowName: "AnaX v3.0",
    code: 1,
    aborted: false,
    blackboard: { insight: "x".repeat(5000), archive: "done" },
  });
  assert.equal(trajectory.module, "anax");
  assert.equal(trajectory.steps[0]!.output.length <= 2400, true);
  assert.match(trajectory.steps[0]!.input, /blackboardKeys/);
});

test("sanitizeTrajectoryText redacts direct draw_data strings", () => {
  assert.equal(sanitizeTrajectoryText("read /tmp/draw_data/raw.csv please").includes("raw.csv"), false);
});

test("sanitizeTrajectoryText redacts compound row-level keys and raw-folder paths", () => {
  const text = sanitizeTrajectoryText({
    sampleRows: [{ revenue: 1 }],
    rawValue: "secret-detail",
    topRecords: ["leak-a", "leak-b"],
    rowSamples: { revenue: 999 },
    note: "open /workspace/sessions/abc/010_raw/orders.csv here",
    safeMetric: 42,
  });
  assert.equal(text.includes("secret-detail"), false);
  assert.equal(text.includes("leak-a"), false);
  assert.equal(text.includes("orders.csv"), false);
  assert.equal(text.includes("42"), true); // 聚合字段保留
});
