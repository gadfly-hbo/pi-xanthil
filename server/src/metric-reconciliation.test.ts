import { test } from "node:test";
import { strict as assert } from "node:assert";
import { reconcileMetricSnapshots, renderReconciliationBlock } from "./metric-reconciliation.ts";
import type { MetricSnapshot } from "./types.ts";

function mkSnapshot(overrides: Partial<MetricSnapshot> & { name: string; value: number; source: MetricSnapshot["source"] }): MetricSnapshot {
  return {
    period: "2026-06",
    status: "normal",
    evidenceLevel: "A",
    ...overrides,
  };
}

test("reconcileMetricSnapshots: matched", () => {
  const ext = [mkSnapshot({ name: "gmv", value: 10000, source: "extraction_tool", metricId: "gmv", period: "2026-06" })];
  const bi = [mkSnapshot({ name: "gmv", value: 10000, source: "bi_aggregation", metricId: "gmv", period: "2026-06" })];
  const result = reconcileMetricSnapshots(ext, bi);
  assert.equal(result.verdict, "matched");
  assert.equal(result.pairs.length, 1);
  assert.equal(result.pairs[0]?.extraction?.value, 10000);
  assert.equal(result.pairs[0]?.biAggregation?.value, 10000);
});

test("reconcileMetricSnapshots: mismatch (over threshold)", () => {
  const ext = [mkSnapshot({ name: "gmv", value: 10000, source: "extraction_tool", metricId: "gmv", period: "2026-06" })];
  const bi = [mkSnapshot({ name: "gmv", value: 10500, source: "bi_aggregation", metricId: "gmv", period: "2026-06" })];
  const result = reconcileMetricSnapshots(ext, bi);
  assert.equal(result.verdict, "mismatch");
  assert.ok(result.warnings.some((w) => w.includes("mismatch")));
});

test("reconcileMetricSnapshots: within epsilon (0.5%)", () => {
  const ext = [mkSnapshot({ name: "gmv", value: 10000, source: "extraction_tool", metricId: "gmv", period: "2026-06" })];
  const bi = [mkSnapshot({ name: "gmv", value: 10030, source: "bi_aggregation", metricId: "gmv", period: "2026-06" })];
  const result = reconcileMetricSnapshots(ext, bi);
  assert.equal(result.verdict, "matched");
});

test("reconcileMetricSnapshots: missing_pair (extraction only)", () => {
  const ext = [mkSnapshot({ name: "gmv", value: 10000, source: "extraction_tool", metricId: "gmv", period: "2026-06" })];
  const result = reconcileMetricSnapshots(ext, []);
  assert.equal(result.verdict, "missing_pair");
  assert.ok(result.warnings.some((w) => w.includes("missing_pair")));
  assert.equal(result.pairs[0]?.extraction?.value, 10000);
  assert.equal(result.pairs[0]?.biAggregation, undefined);
});

test("reconcileMetricSnapshots: missing_pair (bi only)", () => {
  const bi = [mkSnapshot({ name: "gmv", value: 10000, source: "bi_aggregation", metricId: "gmv", period: "2026-06" })];
  const result = reconcileMetricSnapshots([], bi);
  assert.equal(result.verdict, "missing_pair");
  assert.equal(result.pairs[0]?.biAggregation?.value, 10000);
  assert.equal(result.pairs[0]?.extraction, undefined);
});

test("reconcileMetricSnapshots: unregistered (no metricId)", () => {
  const ext = [mkSnapshot({ name: "gmv", value: 10000, source: "extraction_tool", period: "2026-06" })];
  const bi = [mkSnapshot({ name: "gmv", value: 10000, source: "bi_aggregation", period: "2026-06" })];
  const result = reconcileMetricSnapshots(ext, bi);
  assert.equal(result.verdict, "unregistered");
  assert.ok(result.warnings.some((w) => w.includes("无 metricId")));
});

test("reconcileMetricSnapshots: skips non-metricId snapshots", () => {
  const ext = [
    mkSnapshot({ name: "gmv", value: 10000, source: "extraction_tool", metricId: "gmv", period: "2026-06" }),
    mkSnapshot({ name: "other", value: 500, source: "extraction_tool", period: "2026-06" }),
  ];
  const bi = [mkSnapshot({ name: "gmv", value: 10000, source: "bi_aggregation", metricId: "gmv", period: "2026-06" })];
  const result = reconcileMetricSnapshots(ext, bi);
  assert.equal(result.verdict, "matched");
  assert.equal(result.pairs.length, 1);
});

test("reconcileMetricSnapshots: multiple periods", () => {
  const ext = [
    mkSnapshot({ name: "gmv", value: 10000, source: "extraction_tool", metricId: "gmv", period: "2026-05" }),
    mkSnapshot({ name: "gmv", value: 11000, source: "extraction_tool", metricId: "gmv", period: "2026-06" }),
  ];
  const bi = [
    mkSnapshot({ name: "gmv", value: 10000, source: "bi_aggregation", metricId: "gmv", period: "2026-05" }),
    mkSnapshot({ name: "gmv", value: 11500, source: "bi_aggregation", metricId: "gmv", period: "2026-06" }),
  ];
  const result = reconcileMetricSnapshots(ext, bi);
  assert.equal(result.verdict, "mismatch");
  assert.equal(result.pairs.length, 2);
  assert.ok(result.warnings.some((w) => w.includes("2026-06")));
});

test("reconcileMetricSnapshots: duplicate metricId+period raises mismatch warning", () => {
  const ext = [
    mkSnapshot({ name: "gmv", value: 10000, source: "extraction_tool", metricId: "gmv", period: "2026-06" }),
    mkSnapshot({ name: "gmv-alt", value: 12000, source: "extraction_tool", metricId: "gmv", period: "2026-06" }),
  ];
  const bi = [mkSnapshot({ name: "gmv", value: 10000, source: "bi_aggregation", metricId: "gmv", period: "2026-06" })];
  const result = reconcileMetricSnapshots(ext, bi);
  assert.equal(result.verdict, "mismatch");
  assert.ok(result.warnings.some((w) => w.includes("duplicate")));
});

test("renderReconciliationBlock: matched → empty", () => {
  assert.equal(renderReconciliationBlock({ verdict: "matched", pairs: [], warnings: [] }), "");
});

test("renderReconciliationBlock: unregistered → warning block", () => {
  const block = renderReconciliationBlock({ verdict: "unregistered", pairs: [], warnings: ["无 metricId"] });
  assert.ok(block.includes("[关键指标双路径对账]"));
  assert.ok(block.includes("口径未登记"));
  assert.ok(block.includes("无 metricId"));
});

test("renderReconciliationBlock: mismatch → block", () => {
  const block = renderReconciliationBlock({
    verdict: "mismatch",
    pairs: [],
    warnings: ["不一致"],
  });
  assert.ok(block.includes("[关键指标双路径对账]"));
  assert.ok(block.includes("不一致"));
});

test("renderReconciliationBlock: missing_pair → block", () => {
  const block = renderReconciliationBlock({
    verdict: "missing_pair",
    pairs: [],
    warnings: ["仅单路径"],
  });
  assert.ok(block.includes("[关键指标双路径对账]"));
  assert.ok(block.includes("仅单路径"));
});
