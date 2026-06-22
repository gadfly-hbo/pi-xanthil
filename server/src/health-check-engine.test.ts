import { test } from "node:test";
import assert from "node:assert/strict";
import {
  normalizeTimeValue,
  normalizeTimeColumn,
  classifyAggregation,
  inferFrequency,
  runHealthSuite,
  listHealthRules,
  detectOntologyGaps,
  type HealthRunContext,
  type HealthDatasetInput,
} from "./health-check-engine.ts";
import type { BiCell } from "./types.ts";

// ── 1. Excel 日期归一 ──

test("normalizeTimeValue: Excel serial 45658 → 2025-01-01", () => {
  const ts = normalizeTimeValue(45658);
  assert.equal(ts, Date.UTC(2025, 0, 1));
});

test("normalizeTimeValue: ISO string → epoch", () => {
  const ts = normalizeTimeValue("2025-03-15");
  assert.equal(ts, Date.UTC(2025, 2, 15));
});

test("normalizeTimeValue: epoch ms passthrough", () => {
  const now = Date.now();
  assert.equal(normalizeTimeValue(now), now);
});

test("normalizeTimeValue: null/empty/invalid → null", () => {
  assert.equal(normalizeTimeValue(null), null);
  assert.equal(normalizeTimeValue(""), null);
  assert.equal(normalizeTimeValue("not-a-date"), null);
  assert.equal(normalizeTimeValue(true), null);
});

test("normalizeTimeColumn: filters nulls", () => {
  const result = normalizeTimeColumn([45658, null, "", 45689, "2025-03-01"]);
  assert.equal(result.length, 3);
});

// ── 2. 三态分类 ──

test("classifyAggregation: timeseries (cohort_month 多值)", () => {
  const cols = ["cohort_month", "value"];
  const rows = [{ cohort_month: 45658, value: 1 }, { cohort_month: 45689, value: 2 }];
  assert.equal(classifyAggregation(cols, rows), "timeseries");
});

test("classifyAggregation: snapshot (列名嵌期段)", () => {
  const cols = ["标签", "25.5.1-5.31占比"];
  const rows = [{ 标签: "男", "25.5.1-5.31占比": 0.5 }];
  assert.equal(classifyAggregation(cols, rows), "snapshot");
});

test("classifyAggregation: dimension (无时间列无期段)", () => {
  const cols = ["商品ID", "品类", "吊牌价"];
  const rows = [{ 商品ID: "A1", 品类: "裤子", 吊牌价: 199 }];
  assert.equal(classifyAggregation(cols, rows), "dimension");
});

test("classifyAggregation: 单值时间列 → 非 timeseries", () => {
  const cols = ["date", "value"];
  const rows = [{ date: "2025-01-01", value: 1 }];
  assert.notEqual(classifyAggregation(cols, rows), "timeseries");
});

// ── 3. stride 频率推断 ──

test("inferFrequency: 月粒度 (28-31天)", () => {
  const ts = [45658, 45689, 45717, 45748].map((s) => normalizeTimeValue(s)!);
  assert.equal(inferFrequency(ts), "monthly");
});

test("inferFrequency: 周粒度 (7天)", () => {
  const base = Date.UTC(2025, 0, 1);
  const ts = [0, 7, 14, 21].map((d) => base + d * 86400000);
  assert.equal(inferFrequency(ts), "weekly");
});

test("inferFrequency: 日粒度 (1天)", () => {
  const base = Date.UTC(2025, 0, 1);
  const ts = [0, 1, 2, 3].map((d) => base + d * 86400000);
  assert.equal(inferFrequency(ts), "daily");
});

test("inferFrequency: 不规则", () => {
  const base = Date.UTC(2025, 0, 1);
  const ts = [0, 3, 17, 42].map((d) => base + d * 86400000);
  assert.equal(inferFrequency(ts), "irregular");
});

test("inferFrequency: 单值 → irregular", () => {
  assert.equal(inferFrequency([Date.now()]), "irregular");
});

// ── 4. 趋势外推边界 ──

test("趋势外推: 连续下降3期 + 外推越界 → 风险 finding", () => {
  const ds: HealthDatasetInput = {
    pathId: "test-trend",
    columns: ["month", "churn_rate"],
    rows: [
      { month: 45658, churn_rate: 10 },
      { month: 45689, churn_rate: 15 },
      { month: 45717, churn_rate: 22 },
      { month: 45748, churn_rate: 35 },
    ],
  };
  const ctx: HealthRunContext = {
    suite: "monthly",
    datasets: [ds],
    metrics: [],
    links: [],
    objects: [],
    businessContexts: [],
  };
  const result = runHealthSuite(ctx);
  const trendFindings = result.findings.filter((f) => f.ruleId === "R-TR-01");
  assert.ok(trendFindings.length > 0, "应有趋势风险 finding");
  assert.equal(trendFindings[0]!.kind, "风险");
});

test("趋势外推: 稳定数据 → 无风险 finding", () => {
  const ds: HealthDatasetInput = {
    pathId: "test-stable",
    columns: ["month", "value"],
    rows: [
      { month: 45658, value: 100 },
      { month: 45689, value: 101 },
      { month: 45717, value: 100 },
      { month: 45748, value: 101 },
    ],
  };
  const ctx: HealthRunContext = {
    suite: "monthly",
    datasets: [ds],
    metrics: [],
    links: [],
    objects: [],
    businessContexts: [],
  };
  const result = runHealthSuite(ctx);
  const trendFindings = result.findings.filter((f) => f.ruleId === "R-TR-01");
  assert.equal(trendFindings.length, 0);
});

// ── 5. 跨 run 四态 ──

test("跨 run: new → recurring (同 signature 再次出现)", () => {
  const ds: HealthDatasetInput = {
    pathId: "p1",
    columns: ["col1"],
    rows: [{ col1: null }, { col1: "x" }],  // 50% null → warn
  };
  const ctx1: HealthRunContext = {
    suite: "monthly",
    datasets: [ds],
    metrics: [], links: [], objects: [], businessContexts: [],
  };
  const r1 = runHealthSuite(ctx1);
  assert.ok(r1.findings.length > 0);
  const f1 = r1.findings[0]!;
  assert.equal(f1.lifecycle, "new");

  // 第二次 run，带 priorFindings
  const ctx2: HealthRunContext = { ...ctx1, priorFindings: r1.findings };
  const r2 = runHealthSuite(ctx2);
  const f2 = r2.findings.find((f) => f.signature === f1.signature);
  assert.ok(f2);
  assert.equal(f2!.lifecycle, "recurring");
});

test("跨 run: worsening (severity 升级)", () => {
  const ds1: HealthDatasetInput = {
    pathId: "p2",
    columns: ["col1"],
    rows: ((): Array<Record<string, BiCell>> => {
      const r: Array<Record<string, BiCell>> = Array.from({ length: 20 }, () => ({ col1: "x" }));
      r.push({ col1: null });
      return r;
    })(),  // 1/21 ≈ 4.8% → 不过阈值
  };
  const ctx1: HealthRunContext = {
    suite: "monthly",
    datasets: [ds1],
    metrics: [], links: [], objects: [], businessContexts: [],
  };
  const r1 = runHealthSuite(ctx1);
  // 4.8% 低于 warn(5%)，无 finding；改用 10% 触发 warn
  const ds1b: HealthDatasetInput = {
    pathId: "p2",
    columns: ["col1"],
    rows: ((): Array<Record<string, BiCell>> => {
      const r: Array<Record<string, BiCell>> = Array.from({ length: 9 }, () => ({ col1: "x" }));
      r.push({ col1: null });
      return r;
    })(),  // 1/10 = 10% → warn
  };
  const ctx1b: HealthRunContext = {
    suite: "monthly",
    datasets: [ds1b],
    metrics: [], links: [], objects: [], businessContexts: [],
  };
  const r1b = runHealthSuite(ctx1b);
  const f1 = r1b.findings[0]!;
  assert.equal(f1.severity, "warn");

  // 第二次：null 率更高 → critical
  const ds2: HealthDatasetInput = {
    pathId: "p2",
    columns: ["col1"],
    rows: [{ col1: null }, { col1: null }, { col1: null }, { col1: null }, { col1: "x" }],  // 80% → critical
  };
  const ctx2: HealthRunContext = {
    suite: "monthly",
    datasets: [ds2],
    metrics: [], links: [], objects: [], businessContexts: [],
    priorFindings: r1b.findings,
  };
  const r2 = runHealthSuite(ctx2);
  const f2 = r2.findings.find((f) => f.signature === f1.signature);
  assert.ok(f2);
  assert.equal(f2!.severity, "critical");
  assert.equal(f2!.lifecycle, "worsening");
});

test("跨 run: resolved (prior 有 current 无)", () => {
  const dsBad: HealthDatasetInput = {
    pathId: "p3",
    columns: ["col1"],
    rows: [{ col1: null }, { col1: null }, { col1: null }, { col1: null }, { col1: "x" }],  // 80% null
  };
  const ctx1: HealthRunContext = {
    suite: "monthly",
    datasets: [dsBad],
    metrics: [], links: [], objects: [], businessContexts: [],
  };
  const r1 = runHealthSuite(ctx1);
  assert.ok(r1.findings.length > 0);

  // 第二次：数据修复了
  const dsGood: HealthDatasetInput = {
    pathId: "p3",
    columns: ["col1"],
    rows: [{ col1: "a" }, { col1: "b" }, { col1: "c" }],  // 0% null
  };
  const ctx2: HealthRunContext = {
    suite: "monthly",
    datasets: [dsGood],
    metrics: [], links: [], objects: [], businessContexts: [],
    priorFindings: r1.findings,
  };
  const r2 = runHealthSuite(ctx2);
  const resolved = r2.findings.filter((f) => f.lifecycle === "resolved");
  assert.ok(resolved.length > 0, "应有 resolved finding");
});

// ── 6. 种子规则命中/退化 ──

test("R-DQ-01 空值率: 命中", () => {
  const ds: HealthDatasetInput = {
    pathId: "p4",
    columns: ["col1"],
    rows: [{ col1: null }, { col1: null }, { col1: "x" }],  // 66% null
  };
  const ctx: HealthRunContext = {
    suite: "monthly",
    datasets: [ds],
    metrics: [], links: [], objects: [], businessContexts: [],
  };
  const r = runHealthSuite(ctx);
  const dq = r.findings.filter((f) => f.ruleId === "R-DQ-01");
  assert.ok(dq.length > 0);
  assert.equal(dq[0]!.category, "数据质量");
  assert.equal(dq[0]!.kind, "问题");
});

test("R-DQ-01 退化: 空数据集不崩", () => {
  const ds: HealthDatasetInput = { pathId: "p5", columns: ["col1"], rows: [] };
  const ctx: HealthRunContext = {
    suite: "monthly",
    datasets: [ds],
    metrics: [], links: [], objects: [], businessContexts: [],
  };
  const r = runHealthSuite(ctx);
  // 空集不产 finding，不崩
  const dq = r.findings.filter((f) => f.ruleId === "R-DQ-01");
  assert.equal(dq.length, 0);
});

test("R-AN-01 退化: 快照集不跑环比", () => {
  const ds: HealthDatasetInput = {
    pathId: "p6",
    columns: ["标签", "25.5.1占比"],
    rows: [{ 标签: "男", "25.5.1占比": 0.5 }],
  };
  const ctx: HealthRunContext = {
    suite: "monthly",
    datasets: [ds],
    metrics: [], links: [], objects: [], businessContexts: [],
  };
  const r = runHealthSuite(ctx);
  const an = r.findings.filter((f) => f.ruleId === "R-AN-01");
  assert.equal(an.length, 0, "快照集不应跑环比规则");
});

test("R-AN-01: 时序环比突变命中", () => {
  const ds: HealthDatasetInput = {
    pathId: "p7",
    columns: ["month", "sales"],
    rows: [
      { month: 45658, sales: 100 },
      { month: 45689, sales: 100 },
      { month: 45717, sales: 100 },
      { month: 45748, sales: 200 },  // +100% 环比
    ],
  };
  const ctx: HealthRunContext = {
    suite: "monthly",
    datasets: [ds],
    metrics: [], links: [], objects: [], businessContexts: [],
  };
  const r = runHealthSuite(ctx);
  const an = r.findings.filter((f) => f.ruleId === "R-AN-01");
  assert.ok(an.length > 0);
  assert.equal(an[0]!.category, "指标异常");
});

test("R-CR-01 退化: 无 link → 跳过", () => {
  const ds: HealthDatasetInput = {
    pathId: "p8",
    columns: ["id", "val"],
    rows: [{ id: "1", val: 1 }],
  };
  const ctx: HealthRunContext = {
    suite: "monthly",
    datasets: [ds],
    metrics: [], links: [], objects: [], businessContexts: [],
  };
  const r = runHealthSuite(ctx);
  const cr = r.findings.filter((f) => f.ruleId === "R-CR-01");
  assert.equal(cr.length, 0, "无 link 不应跑勾稽规则");
});

// ── 7. listHealthRules + detectOntologyGaps ──

test("listHealthRules: 返回所有启用规则元数据", () => {
  const rules = listHealthRules();
  assert.ok(rules.length >= 4);
  const ids = rules.map((r) => r.id);
  assert.ok(ids.includes("R-DQ-01"));
  assert.ok(ids.includes("R-AN-01"));
  assert.ok(ids.includes("R-TR-01"));
  // 每个规则 needs 都有
  for (const r of rules) {
    assert.ok(typeof r.needs.timeSeries === "boolean");
  }
});

test("detectOntologyGaps: 无匹配概念 → gap", () => {
  const ds: HealthDatasetInput = {
    pathId: "p9",
    columns: ["unknown_col", "sales"],
    rows: [],
  };
  const gaps = detectOntologyGaps([ds], []);
  assert.ok(gaps.length >= 1);
  assert.ok(gaps.some((g) => g.column === "unknown_col"));
});

test("detectOntologyGaps: 有匹配概念 → 无 gap", () => {
  const ds: HealthDatasetInput = {
    pathId: "p10",
    columns: ["销售额"],
    rows: [],
  };
  const objects = [
    { id: "o1", ontologyId: "ont1", kind: "concept" as const, nameCn: "销售额", description: "", confidence: 1, createdAt: 0, updatedAt: 0 },
  ];
  const gaps = detectOntologyGaps([ds], objects);
  assert.equal(gaps.length, 0);
});
