import { test } from "node:test";
import { strict as assert } from "node:assert";
import {
  biAggregationToMetricSnapshots,
  renderMetricSnapshotsBlock,
} from "./monitor-metric-snapshot.ts";
import { buildDraftPrompt } from "./monitor-llm.ts";
import type { HealthFinding, MonitorComparison } from "./types.ts";

function mkComparison(kind: MonitorComparison["kind"], label: string, cur: number, base: number, window_?: string): MonitorComparison {
  const delta = cur - base;
  const rate = base === 0 ? null : delta / Math.abs(base);
  return { kind, label, currentValue: cur, baselineValue: base, delta, deltaRate: rate, window: window_ };
}

function mkFinding(opts: Partial<HealthFinding> & { id: string }): HealthFinding {
  return {
    id: opts.id,
    runId: "r1",
    ruleId: "R-TEST",
    category: "指标异常",
    kind: "问题",
    severity: opts.severity ?? "warn",
    lifecycle: opts.lifecycle ?? "new",
    signature: opts.signature ?? `sig-${opts.id}`,
    firstSeenRunId: null,
    title: opts.title ?? "test finding",
    evidence: opts.evidence ?? {},
    boundTo: opts.boundTo,
    comparisons: opts.comparisons,
    suggestion: opts.suggestion ?? "",
    detectedAt: Date.now(),
  };
}

test("biAggregationToMetricSnapshots: severity → status mapping", () => {
  const findings: HealthFinding[] = [
    mkFinding({ id: "f1", severity: "critical", evidence: { current: 100 }, boundTo: { metricId: "revenue" } }),
    mkFinding({ id: "f2", severity: "warn", evidence: { current: 80 }, boundTo: { metricId: "users" } }),
    mkFinding({ id: "f3", severity: "info", evidence: { current: 50 }, boundTo: { metricId: "orders" } }),
  ];
  const snaps = biAggregationToMetricSnapshots(findings);
  assert.equal(snaps.length, 3);
  assert.equal(snaps[0]?.status, "alert");
  assert.equal(snaps[1]?.status, "warning");
  assert.equal(snaps[2]?.status, "normal");
  assert.equal(snaps[0]?.source, "bi_aggregation");
  assert.equal(snaps[0]?.name, "revenue");
});

test("biAggregationToMetricSnapshots: history comparison kind subtyping", () => {
  const finding = mkFinding({
    id: "f1",
    severity: "warn",
    evidence: { current: 120 },
    boundTo: { metricId: "gmv" },
    comparisons: [
      mkComparison("target", "运营目标", 120, 150),
      mkComparison("history", "上一期（环比）", 120, 100, "2026-06-15"),
      mkComparison("history", "去年同期（同比）", 120, 110),
      mkComparison("history", "3期移动均值", 120, 105, "2026-06-15"),
      mkComparison("history", "近期窗口", 120, 115, "rolling"),
      mkComparison("industry", "行业基准", 120, 130),
      mkComparison("competitor", "竞品 A", 120, 140),
    ],
  });
  const snaps = biAggregationToMetricSnapshots([finding]);
  const cmp = snaps[0]?.comparisons ?? [];
  assert.equal(cmp.length, 7);
  assert.equal(cmp[0]?.kind, "target");
  assert.equal(cmp[1]?.kind, "mom");
  assert.equal(cmp[2]?.kind, "yoy");
  assert.equal(cmp[3]?.kind, "ma");
  assert.equal(cmp[4]?.kind, "other"); // 无 mom/yoy/ma 关键字
  assert.equal(cmp[5]?.kind, "benchmark");
  assert.equal(cmp[6]?.kind, "competitor");
});

test("biAggregationToMetricSnapshots: skips findings without value", () => {
  const findings: HealthFinding[] = [
    mkFinding({ id: "skip", severity: "warn", evidence: {}, boundTo: { metricId: "x" } }),
    mkFinding({ id: "ok", severity: "warn", evidence: { current: 42 }, boundTo: { metricId: "y" } }),
  ];
  const snaps = biAggregationToMetricSnapshots(findings);
  assert.equal(snaps.length, 1);
  assert.equal(snaps[0]?.value, 42);
});

test("biAggregationToMetricSnapshots: fallback value from comparison", () => {
  const f = mkFinding({
    id: "f1",
    severity: "warn",
    evidence: {},
    boundTo: { metricId: "x" },
    comparisons: [mkComparison("target", "目标", 99, 100)],
  });
  const snaps = biAggregationToMetricSnapshots([f]);
  assert.equal(snaps[0]?.value, 99);
});

test("biAggregationToMetricSnapshots: thresholdNote summarized", () => {
  const f = mkFinding({
    id: "f1",
    severity: "warn",
    evidence: { current: 10, thresholds: { momWarn: 0.1, yoyWarn: 0.2, maWindow: 3 } },
    boundTo: { metricId: "x" },
  });
  const snaps = biAggregationToMetricSnapshots([f]);
  const note = snaps[0]?.thresholdNote ?? "";
  assert.ok(note.includes("momWarn=0.1"));
  assert.ok(note.includes("yoyWarn=0.2"));
});

test("renderMetricSnapshotsBlock: injects 数字锁 prefix + JSON", () => {
  const block = renderMetricSnapshotsBlock([
    { name: "revenue", value: 100, period: "2026-06", status: "warning", source: "bi_aggregation" },
  ]);
  assert.ok(block.includes("[指标快照·代码确定性计算值·禁止重新推导]"));
  assert.ok(block.includes("禁止"));
  assert.ok(block.includes(`"name":"revenue"`));
  assert.ok(block.includes(`"value":100`));
});

test("renderMetricSnapshotsBlock: empty → empty string", () => {
  assert.equal(renderMetricSnapshotsBlock([]), "");
});

test("buildDraftPrompt: with findings → snapshot block prepended", () => {
  const findings: HealthFinding[] = [
    mkFinding({
      id: "f1",
      severity: "critical",
      evidence: { current: 12500 },
      boundTo: { metricId: "mau" },
      comparisons: [mkComparison("target", "运营目标", 12500, 15000)],
    }),
  ];
  const prompt = buildDraftPrompt({
    aggregations: [{ pathId: "p1", name: "sales", columns: ["date", "amount"], rowCount: 100 }],
    objects: [],
    metrics: [],
    links: [],
    logicRules: [],
    findings,
  });
  assert.ok(prompt.includes("[指标快照·代码确定性计算值·禁止重新推导]"));
  assert.ok(prompt.includes(`"name":"mau"`));
  assert.ok(prompt.includes("## 可用的聚合数据集"), "fallback block should still exist as context");
});

test("buildDraftPrompt: without findings → backward compatible (no snapshot block)", () => {
  const prompt = buildDraftPrompt({
    aggregations: [{ pathId: "p1", name: "sales", columns: ["date", "amount"], rowCount: 100 }],
    objects: [],
    metrics: [],
    links: [],
    logicRules: [],
  });
  assert.ok(!prompt.includes("[指标快照"));
  assert.ok(prompt.includes("## 可用的聚合数据集"));
});

test("buildDraftPrompt: empty findings → backward compatible", () => {
  const prompt = buildDraftPrompt({
    aggregations: [],
    objects: [],
    metrics: [],
    links: [],
    logicRules: [],
    findings: [],
  });
  assert.ok(!prompt.includes("[指标快照"));
});
