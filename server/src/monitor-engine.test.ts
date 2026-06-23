import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { BiCell, HealthFinding, MonitorMetricBinding, MonitorMetricSystemDraft } from "./types.ts";
import { runMonitorChecks, type MonitorDatasetInput, type MonitorRunContext } from "./monitor-engine.ts";

const T0 = Date.UTC(2026, 5, 15);

function row(val: number, daysAgo: number): Record<string, BiCell> {
  return { revenue: val as unknown as BiCell, month: (T0 - daysAgo * 86_400_000) as unknown as BiCell };
}
function num(v: number): BiCell { return v as unknown as BiCell; }

// Each MonitorMetricBinding's targetMetricId/benchmarkMetricId/competitorMetricId points
// to another MonitorMetricDraft.name. The engine looks that up via the draft's bindings[0].
const ms: MonitorMetricSystemDraft = {
  metrics: [
    { name: "revenue", description: "收入", formula: "", unit: "万", objectIds: [], bindings: [{ metricId: "revenue", datasetPathId: "ds-source", valueColumn: "revenue", timeColumn: "month", targetMetricId: "target_revenue", benchmarkMetricId: "industry_revenue", competitorMetricId: "comp_revenue" }], confidence: 0.9 },
    { name: "target_revenue", description: "目标收入", formula: "", unit: "万", objectIds: [], bindings: [{ metricId: "target_revenue", datasetPathId: "ds-target", valueColumn: "revenue" }], confidence: 0.9 },
    { name: "industry_revenue", description: "行业收入", formula: "", unit: "万", objectIds: [], bindings: [{ metricId: "industry_revenue", datasetPathId: "ds-industry", valueColumn: "revenue" }], confidence: 0.8 },
    { name: "comp_revenue", description: "竞品收入", formula: "", unit: "万", objectIds: [], bindings: [{ metricId: "comp_revenue", datasetPathId: "ds-competitor", valueColumn: "revenue" }], confidence: 0.8 },
    { name: "profit", description: "利润", formula: "", unit: "万", objectIds: [], bindings: [{ metricId: "profit", datasetPathId: "ds-source", valueColumn: "revenue", timeColumn: "month" }], confidence: 0.8 },
  ],
  dependencies: [{ metricId: "revenue", relatedMetricId: "profit", relation: "driver", rationale: "营收驱动利润" }],
  monitorRules: [],
  assumptions: [],
  missingData: [],
};

function ctx(overrides: Partial<MonitorRunContext> = {}): MonitorRunContext {
  return {
    suite: "monthly",
    datasets: [
      { pathId: "ds-source", columns: ["revenue", "month"], rows: [row(120, 0), row(100, 30), row(110, 60), row(90, 90)] },
      { pathId: "ds-target", columns: ["revenue"], rows: [{ revenue: num(150) }] },
      { pathId: "ds-industry", columns: ["revenue"], rows: [{ revenue: num(130) }] },
      { pathId: "ds-competitor", columns: ["revenue"], rows: [{ revenue: num(140) }] },
    ],
    metricSystem: ms,
    metrics: [],
    links: [],
    objects: [],
    logicRules: [],
    ...overrides,
  };
}

describe("monitor-engine", () => {
  describe("R-GAP-TARGET", () => {
    it("落后目标超出阈值", () => {
      const { findings } = runMonitorChecks(ctx({ thresholds: { gapTargetWarn: 0.1 } }), "r1");
      const f = findings.filter((x) => x.ruleId === "R-GAP-TARGET");
      assert.ok(f.length > 0);
      for (const x of f) {
        assert.ok(x.comparisons);
        assert.equal(x.comparisons![0]!.kind, "target");
      }
    });

    it("无目标 link → 降级", () => {
      const no: MonitorMetricSystemDraft = { ...ms, metrics: ms.metrics.filter((m) => m.name === "revenue" || m.name === "profit") };
      const { findings } = runMonitorChecks(ctx({ metricSystem: no }), "r2");
      assert.equal(findings.filter((x) => x.ruleId === "R-GAP-TARGET").length, 0);
    });
  });

  describe("R-GAP-HISTORY", () => {
    it("环比超阈值", () => {
      const { findings } = runMonitorChecks(ctx({ thresholds: { gapHistoryMomWarn: 0.05 } }), "r3");
      assert.ok(findings.filter((x) => x.ruleId === "R-GAP-HISTORY").length > 0);
    });

    it("仅一行 → 跳过", () => {
      const { findings } = runMonitorChecks(ctx({
        datasets: [{ pathId: "ds-source", columns: ["revenue", "month"], rows: [row(100, 0)] }],
      }), "r4");
      assert.equal(findings.filter((x) => x.ruleId === "R-GAP-HISTORY").length, 0);
    });
  });

  describe("R-GAP-INDUSTRY", () => {
    it("落后行业", () => {
      const { findings } = runMonitorChecks(ctx({ thresholds: { gapIndustryWarn: 0.05 } }), "r5");
      assert.ok(findings.filter((x) => x.ruleId === "R-GAP-INDUSTRY").length > 0);
    });

    it("无 benchmark → 降级", () => {
      const no = { ...ms, metrics: ms.metrics.filter((m) => m.name !== "industry_revenue" && m.name !== "comp_revenue") };
      const { findings } = runMonitorChecks(ctx({ metricSystem: no }), "r6");
      assert.equal(findings.filter((x) => x.ruleId === "R-GAP-INDUSTRY").length, 0);
    });
  });

  describe("R-GAP-COMPETITOR", () => {
    it("落后竞品", () => {
      const { findings } = runMonitorChecks(ctx({ thresholds: { gapCompetitorWarn: 0.05 } }), "r7");
      assert.ok(findings.filter((x) => x.ruleId === "R-GAP-COMPETITOR").length > 0);
    });
  });

  describe("ontology 诊断", () => {
    it("依赖关联", () => {
      const { findings } = runMonitorChecks(ctx(), "r8");
      assert.ok(findings.some((f) => f.diagnosis && f.diagnosis.relatedMetricIds.length > 0));
    });
  });

  describe("lifecycle", () => {
    it("无 prior → new", () => {
      const { findings } = runMonitorChecks(ctx(), "r9");
      assert.ok(findings.some((f) => f.lifecycle === "new"));
    });

    it("prior 有 → recurring/worsening", () => {
      const first = runMonitorChecks(ctx(), "r10");
      const second = runMonitorChecks(ctx({ priorFindings: first.findings }), "r11");
      assert.ok(second.findings.some((f) => f.lifecycle === "recurring" || f.lifecycle === "worsening"));
    });

    it("resolved", () => {
      const prior: HealthFinding[] = [{
        id: "px", runId: "rx", ruleId: "R-GAP-TARGET", category: "指标异常", kind: "问题", severity: "warn",
        lifecycle: "recurring", signature: "R-GAP-TARGET::ds-target::revenue", firstSeenRunId: "rx",
        title: "test", evidence: {}, boundTo: { datasetPathId: "ds-target", column: "revenue" },
        suggestion: "", detectedAt: Date.now() - 10000,
      }];
      const { findings } = runMonitorChecks(ctx({ metricSystem: null, datasets: [{ pathId: "ds-target", columns: ["revenue"], rows: [{ revenue: num(100) }] }], priorFindings: prior }), "r12");
      assert.ok(findings.some((f) => f.lifecycle === "resolved"));
    });
  });

  describe("降级安全", () => {
    it("metricSystem==null → 空", () => {
      assert.equal(runMonitorChecks(ctx({ metricSystem: null }), "r13").findings.length, 0);
    });
    it("空数据集 → 不崩", () => {
      assert.ok(Array.isArray(runMonitorChecks(ctx({ datasets: [], metricSystem: null }), "r14").findings));
    });
  });
});