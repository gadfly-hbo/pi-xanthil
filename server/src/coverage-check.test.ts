import { test } from "node:test";
import { strict as assert } from "node:assert";
import { checkCoverage, renderCoverageBlock } from "./coverage-check.ts";
import type { BiAggregationDataset, HealthFinding, MetricDefinition } from "./types.ts";

function mkAgg(rowCount: number, columns: string[] = ["date", "amount"]): BiAggregationDataset {
  return { pathId: "p1", name: "sales", columns, rowCount };
}

function mkFinding(id: string, metricId?: string, hasBaseline = false): HealthFinding {
  return {
    id,
    runId: "r1",
    ruleId: "R-TEST",
    category: "指标异常",
    kind: "问题",
    severity: "warn",
    lifecycle: "new",
    signature: `sig-${id}`,
    firstSeenRunId: null,
    title: "test",
    evidence: { current: 100 },
    boundTo: metricId ? { metricId } : undefined,
    comparisons: hasBaseline
      ? [{ kind: "history", label: "环比", currentValue: 100, baselineValue: 90, delta: 10, deltaRate: 0.11, window: "2026-06" }]
      : undefined,
    suggestion: "",
    detectedAt: Date.now(),
  };
}

function mkMetric(id: string): MetricDefinition {
  return {
    id,
    workspaceId: "ws1",
    name: id,
    category: "核心",
    description: "",
    formula: "",
    caliber: "",
    unit: "",
    enabled: true,
    createdAt: 0,
    updatedAt: 0,
  };
}

test("checkCoverage: fail on too few rows", () => {
  const result = checkCoverage({ aggregations: [mkAgg(5)] });
  assert.equal(result.verdict, "fail");
  assert.ok(result.warnings.some((w) => w.includes("5 行")));
});

test("checkCoverage: warn on low row count", () => {
  const result = checkCoverage({ aggregations: [mkAgg(50)] });
  assert.equal(result.verdict, "warn");
  assert.ok(result.warnings.some((w) => w.includes("50 行")));
});

test("checkCoverage: pass on sufficient rows", () => {
  const result = checkCoverage({ aggregations: [mkAgg(500)] });
  assert.equal(result.verdict, "pass");
  assert.equal(result.warnings.length, 0);
});

test("checkCoverage: warn on missing baseline", () => {
  const findings = [mkFinding("f1", undefined, false)];
  const result = checkCoverage({ aggregations: [mkAgg(500)], findings });
  assert.equal(result.verdict, "warn");
  assert.ok(result.warnings.some((w) => w.includes("基线")));
});

test("checkCoverage: pass with baseline", () => {
  const findings = [mkFinding("f1", undefined, true)];
  const result = checkCoverage({ aggregations: [mkAgg(500)], findings });
  assert.equal(result.verdict, "pass");
});

test("checkCoverage: warn on metric coverage gap", () => {
  const metrics = [mkMetric("gmv"), mkMetric("orders")];
  const findings = [mkFinding("f1", "gmv", true)];
  const result = checkCoverage({ aggregations: [mkAgg(500)], findings, metrics });
  assert.equal(result.verdict, "warn");
  assert.ok(result.warnings.some((w) => w.includes("仅 1 个有监测")));
  assert.equal(result.metricCoverage?.covered, 1);
  assert.equal(result.metricCoverage?.registered, 2);
});

test("checkCoverage: fail on empty columns", () => {
  const result = checkCoverage({ aggregations: [mkAgg(500, [])] });
  assert.equal(result.verdict, "fail");
  assert.ok(result.warnings.some((w) => w.includes("未包含任何字段")));
});

test("renderCoverageBlock: pass → empty", () => {
  assert.equal(renderCoverageBlock({ verdict: "pass", warnings: [] }), "");
});

test("renderCoverageBlock: fail → 弃答提示", () => {
  const block = renderCoverageBlock({
    verdict: "fail",
    rowCount: 5,
    warnings: ["数据不足"],
  });
  assert.ok(block.includes("数据不足以支撑任何结论"));
  assert.ok(block.includes("请勿生成报告"));
});

test("renderCoverageBlock: warn → 降置信提示", () => {
  const block = renderCoverageBlock({
    verdict: "warn",
    rowCount: 50,
    warnings: ["行数少"],
  });
  assert.ok(block.includes("限制"));
  assert.ok(block.includes("标注置信度"));
});
