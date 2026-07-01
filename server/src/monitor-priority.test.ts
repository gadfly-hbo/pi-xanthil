import { test } from "node:test";
import { strict as assert } from "node:assert";
import type { HealthFinding, MonitorComparison } from "./types.ts";
import {
  prioritizeMonitorFindings,
  scoreMonitorFindingPriority,
  summarizeMonitorRun,
} from "./monitor-priority.ts";

function comparison(kind: MonitorComparison["kind"], deltaRate: number): MonitorComparison {
  return {
    kind,
    label: kind,
    currentValue: 80,
    baselineValue: 100,
    delta: -20,
    deltaRate,
  };
}

function finding(opts: Partial<HealthFinding> & { id: string }): HealthFinding {
  return {
    id: opts.id,
    runId: opts.runId ?? "run-1",
    ruleId: opts.ruleId ?? "R-GAP-HISTORY",
    category: opts.category ?? "指标异常",
    kind: opts.kind ?? "问题",
    severity: opts.severity ?? "warn",
    lifecycle: opts.lifecycle ?? "new",
    signature: opts.signature ?? `sig-${opts.id}`,
    firstSeenRunId: opts.firstSeenRunId ?? null,
    title: opts.title ?? `finding ${opts.id}`,
    evidence: opts.evidence ?? {},
    boundTo: opts.boundTo,
    comparisons: opts.comparisons,
    diagnosis: opts.diagnosis,
    suggestion: opts.suggestion ?? "check",
    detectedAt: opts.detectedAt ?? 1,
  };
}

test("critical worsening findings sort before lower-severity findings", () => {
  const urgent = finding({
    id: "urgent",
    severity: "critical",
    lifecycle: "worsening",
    comparisons: [comparison("history", -0.35)],
    detectedAt: 2,
  });
  const medium = finding({
    id: "medium",
    severity: "warn",
    lifecycle: "new",
    comparisons: [comparison("history", -0.12)],
    detectedAt: 3,
  });
  const sorted = prioritizeMonitorFindings([medium, urgent]);
  assert.equal(sorted[0]?.finding.id, "urgent");
  assert.equal(sorted[0]?.priority.priorityBand, "urgent");
  assert.ok(sorted[0]?.priority.reasons.some((reason) => reason.includes("worsening")));
});

test("resolved findings are capped and downgraded", () => {
  const resolved = finding({
    id: "resolved",
    severity: "critical",
    lifecycle: "resolved",
    comparisons: [comparison("target", -0.5)],
    ruleId: "R-GAP-TARGET",
  });
  const priority = scoreMonitorFindingPriority(resolved);
  assert.equal(priority.priorityScore, 25);
  assert.equal(priority.priorityBand, "low");
  assert.ok(priority.reasons.includes("resolved cap"));
});

test("target gaps receive deterministic priority boost", () => {
  const target = finding({
    id: "target",
    ruleId: "R-GAP-TARGET",
    comparisons: [comparison("target", -0.18)],
  });
  const history = finding({
    id: "history",
    ruleId: "R-GAP-HISTORY",
    comparisons: [comparison("history", -0.18)],
  });
  const targetPriority = scoreMonitorFindingPriority(target);
  const historyPriority = scoreMonitorFindingPriority(history);
  assert.ok(targetPriority.priorityScore > historyPriority.priorityScore);
  assert.ok(targetPriority.reasons.includes("target gap"));
});

test("adopted action marks finding as in progress and lowers score", () => {
  const item = finding({
    id: "with-action",
    severity: "critical",
    lifecycle: "worsening",
    firstSeenRunId: "run-0",
    comparisons: [comparison("target", -0.4)],
    ruleId: "R-GAP-TARGET",
  });
  const raw = scoreMonitorFindingPriority(item);
  const withAction = scoreMonitorFindingPriority(item, {
    "with-action": { status: "adopted", actionId: "action-1" },
  });
  assert.ok(withAction.priorityScore < raw.priorityScore);
  assert.ok(withAction.reasons.includes("action adopted"));
});

test("summarizeMonitorRun returns counts, top buckets, and deterministic focus text", () => {
  const findings = [
    finding({ id: "p1", kind: "问题", severity: "critical", lifecycle: "worsening", ruleId: "R-GAP-TARGET", comparisons: [comparison("target", -0.3)], title: "收入落后目标" }),
    finding({ id: "r1", kind: "风险", severity: "warn", lifecycle: "new", comparisons: [comparison("history", 0.2)], title: "转化率历史偏离" }),
    finding({ id: "p2", kind: "问题", severity: "info", lifecycle: "resolved", title: "库存已恢复" }),
  ];
  const summary = summarizeMonitorRun(findings);
  assert.equal(summary.topProblems[0]?.findingId, "p1");
  assert.equal(summary.topRisks[0]?.findingId, "r1");
  assert.equal(summary.counts.new, 1);
  assert.equal(summary.counts.worsening, 1);
  assert.equal(summary.counts.resolved, 1);
  assert.equal(summary.counts.targetGap, 1);
  assert.match(summary.suggestedFocus, /优先处理「收入落后目标」/);
  assert.match(summary.suggestedFocus, /1 个目标差距/);
});
