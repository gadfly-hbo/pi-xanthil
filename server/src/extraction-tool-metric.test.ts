import { test } from "node:test";
import { strict as assert } from "node:assert";
import {
  buildMetricSnapshotsFromHints,
  coerceMetricHints,
  inferPeriodFromPath,
  lookupSummaryValue,
} from "./extraction-tool-metric.ts";

test("lookupSummaryValue: dot path with array index", () => {
  const summary = { kpis: [{ value: 42 }, { value: 7 }], total: { count: 100 } };
  assert.equal(lookupSummaryValue(summary, "kpis.0.value"), 42);
  assert.equal(lookupSummaryValue(summary, "kpis.1.value"), 7);
  assert.equal(lookupSummaryValue(summary, "total.count"), 100);
  assert.equal(lookupSummaryValue(summary, "missing.path"), undefined);
  assert.equal(lookupSummaryValue(summary, "kpis.99.value"), undefined);
  assert.equal(lookupSummaryValue(null, "x"), undefined);
});

test("inferPeriodFromPath: YYYY-MM / YYYY-MM-DD / compact", () => {
  assert.equal(inferPeriodFromPath("/data/sales_2026-06.csv"), "2026-06");
  assert.equal(inferPeriodFromPath("/data/sales_2026-06-15.csv"), "2026-06-15");
  assert.equal(inferPeriodFromPath("/data/202606.csv"), "2026-06");
  assert.equal(inferPeriodFromPath("/data/20260615.csv"), "2026-06-15");
  assert.equal(inferPeriodFromPath("/data/no-date.csv"), "");
});

test("coerceMetricHints: drops invalid entries", () => {
  const out = coerceMetricHints([
    { summaryKey: "a.b", name: "X" },
    { summaryKey: "", name: "miss key" },
    { summaryKey: "x", name: "" },
    { summaryKey: "y", name: "Y", unit: "人", statusThresholds: { warning: 10, alert: 20 } },
    { summaryKey: "z", name: "Z", statusThresholds: { warning: "bad", alert: 5 } },
  ]) ?? [];
  assert.equal(out.length, 3);
  const [first, second, third] = out;
  assert.equal(first?.summaryKey, "a.b");
  assert.deepEqual(second?.statusThresholds, { warning: 10, alert: 20 });
  assert.equal(third?.statusThresholds, undefined);
  assert.equal(coerceMetricHints("nope"), undefined);
  assert.equal(coerceMetricHints([]), undefined);
});

test("buildMetricSnapshotsFromHints: status thresholds (high-value alert)", () => {
  const summary = { activeUsers: 1500, churnRate: 0.08 };
  const snaps = buildMetricSnapshotsFromHints({
    summary,
    hints: [
      { summaryKey: "activeUsers", name: "活跃用户", unit: "人", statusThresholds: { warning: 1000, alert: 2000 } },
      { summaryKey: "churnRate", name: "流失率", statusThresholds: { warning: 0.05, alert: 0.1 } },
    ],
    inputPath: "/tmp/dataset_2026-06.csv",
  });
  assert.equal(snaps.length, 2);
  const [s0, s1] = snaps;
  assert.equal(s0?.value, 1500);
  assert.equal(s0?.status, "warning");
  assert.equal(s0?.period, "2026-06");
  assert.equal(s0?.source, "extraction_tool");
  assert.equal(s0?.thresholdNote, "warning=1000 / alert=2000");
  assert.equal(s1?.status, "warning"); // 0.08 ≥ 0.05 but < 0.1
});

test("buildMetricSnapshotsFromHints: low-value alert (alert < warning)", () => {
  const snaps = buildMetricSnapshotsFromHints({
    summary: { score: 65 },
    hints: [{ summaryKey: "score", name: "评分", statusThresholds: { warning: 80, alert: 60 } }],
    inputPath: "",
  });
  assert.equal(snaps[0]?.status, "warning");
  const alertSnaps = buildMetricSnapshotsFromHints({
    summary: { score: 55 },
    hints: [{ summaryKey: "score", name: "评分", statusThresholds: { warning: 80, alert: 60 } }],
    inputPath: "",
  });
  assert.equal(alertSnaps[0]?.status, "alert");
});

test("buildMetricSnapshotsFromHints: period from params overrides path", () => {
  const snaps = buildMetricSnapshotsFromHints({
    summary: { x: 10 },
    hints: [{ summaryKey: "x", name: "X" }],
    inputPath: "/tmp/data_2026-01.csv",
    params: { period: "2026-Q2" },
  });
  assert.equal(snaps[0]?.period, "2026-Q2");
  assert.equal(snaps[0]?.status, "normal");
});

test("buildMetricSnapshotsFromHints: skip non-numeric and missing values", () => {
  const snaps = buildMetricSnapshotsFromHints({
    summary: { a: "not a number", b: null, c: 42, d: "3.14" },
    hints: [
      { summaryKey: "a", name: "A" },
      { summaryKey: "b", name: "B" },
      { summaryKey: "missing", name: "M" },
      { summaryKey: "c", name: "C" },
      { summaryKey: "d", name: "D" },
    ],
    inputPath: "",
  });
  assert.equal(snaps.length, 2);
  const [c, d] = snaps;
  assert.equal(c?.name, "C");
  assert.equal(c?.value, 42);
  assert.equal(d?.name, "D");
  assert.equal(d?.value, 3.14);
});

test("buildMetricSnapshotsFromHints: empty / undefined hints → empty array", () => {
  assert.deepEqual(buildMetricSnapshotsFromHints({ summary: { x: 1 }, hints: undefined, inputPath: "" }), []);
  assert.deepEqual(buildMetricSnapshotsFromHints({ summary: { x: 1 }, hints: [], inputPath: "" }), []);
});
