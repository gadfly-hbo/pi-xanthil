// @ts-nocheck -- node --experimental-strip-types requires .ts extension; tsc doesn't.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { calculateTarget } from "./monitor-target-calculator.ts";

describe("calculateTarget", () => {
  const yearlyInput = {
    scenarioKind: "yearly_kpi" as const,
    metric: "gmv" as const,
    periodStart: "2026-01-01",
    periodEnd: "2026-12-31",
    targetValue: 100_000_000,
    assumptions: {
      traffic: 5_000_000,
      conversionRate: 0.03,
      aov: 500,
      refundRate: 0.05,
      grossMarginRate: 0.4,
      marketingCost: 5_000_000,
      fixedCost: 2_000_000,
      upliftFactor: 1.0,
    },
  };

  it("annual KPI gmv target: three cases + 12-month breakdown", () => {
    const r = calculateTarget(yearlyInput);
    assert.equal(r.cases.length, 3);
    assert.equal(r.breakdown.length, 36);

    const baseline = r.cases.find((c) => c.case === "baseline")!;
    assert.ok(baseline.gmv != null);
    assert.ok(baseline.gmv! > 0);
    assert.ok(baseline.requiredOrders != null);
    assert.ok(baseline.requiredTraffic != null);

    const conservative = r.cases.find((c) => c.case === "conservative")!;
    const stretch = r.cases.find((c) => c.case === "stretch")!;
    assert.ok(conservative.gmv! < baseline.gmv!);
    assert.ok(stretch.gmv! > baseline.gmv!);

    const jan = r.breakdown.filter((b) => b.period === "2026-01" && b.case === "baseline");
    assert.equal(jan.length, 1);
    assert.ok(jan[0]!.targetValue > 0);
  });

  it("campaign profit calculation", () => {
    const r = calculateTarget({
      scenarioKind: "campaign",
      metric: "profit",
      periodStart: "2026-06-18",
      periodEnd: "2026-06-20",
      targetValue: 1_000_000,
      assumptions: {
        traffic: 200_000,
        conversionRate: 0.04,
        aov: 600,
        refundRate: 0.03,
        grossMarginRate: 0.35,
        marketingCost: 500_000,
        fixedCost: 100_000,
      },
    });

    const baseline = r.cases.find((c) => c.case === "baseline")!;
    assert.ok(baseline.profit != null);
    assert.ok(baseline.roi != null);
    assert.ok(baseline.requiredOrders != null);

    assert.equal(r.breakdown.length, 9); // 3 cases × 3 days
  });

  it("campaign upliftFactor participates in case scenarios", () => {
    const r = calculateTarget({
      scenarioKind: "campaign",
      metric: "gmv",
      periodStart: "2026-06-18",
      periodEnd: "2026-06-18",
      targetValue: 1_000_000,
      assumptions: {
        traffic: 100_000,
        conversionRate: 0.05,
        aov: 300,
        upliftFactor: 1.2,
      },
    });

    const conservative = r.cases.find((c) => c.case === "conservative")!;
    const baseline = r.cases.find((c) => c.case === "baseline")!;
    const stretch = r.cases.find((c) => c.case === "stretch")!;

    assert.equal(baseline.gmv, 1_800_000);
    assert.ok(conservative.gmv! < baseline.gmv!);
    assert.ok(stretch.gmv! > baseline.gmv!);
  });

  it("marketingCost=0 → roi is null, not Infinity", () => {
    const r = calculateTarget({
      ...yearlyInput,
      assumptions: { ...yearlyInput.assumptions, marketingCost: 0 },
    });
    for (const c of r.cases) {
      assert.equal(c.roi, null);
    }
  });

  it("conversionRate=0 → requiredTraffic is null, not Infinity", () => {
    const r = calculateTarget({
      ...yearlyInput,
      assumptions: { ...yearlyInput.assumptions, conversionRate: 0 },
    });
    for (const c of r.cases) {
      assert.equal(c.requiredTraffic, null);
    }
  });

  it("missing assumptions → derived fields are null", () => {
    const r = calculateTarget({
      scenarioKind: "yearly_kpi",
      metric: "revenue",
      periodStart: "2026-01-01",
      periodEnd: "2026-03-31",
      targetValue: 10_000_000,
      assumptions: { aov: 200 },
    });
    const b = r.cases.find((c) => c.case === "baseline")!;
    assert.equal(b.gmv, null);
    assert.equal(b.revenue, null);
    assert.equal(b.profit, null);
    assert.equal(b.roi, null);
  });

  it("invalid date range → empty breakdown", () => {
    const r = calculateTarget({
      ...yearlyInput,
      periodStart: "2026-12-01",
      periodEnd: "2026-01-01",
    });
    assert.equal(r.breakdown.length, 0);
    assert.equal(r.cases.length, 3);
  });

  it("rolling_monthly: monthly periods", () => {
    const r = calculateTarget({
      ...yearlyInput,
      scenarioKind: "rolling_monthly",
      periodStart: "2026-06-01",
      periodEnd: "2026-08-31",
    });
    assert.equal(r.breakdown.length, 9); // 3 cases × 3 months
    const periods = [...new Set(r.breakdown.map((b) => b.period))];
    assert.deepEqual(periods, ["2026-06", "2026-07", "2026-08"]);
  });

  it("NaN/negative inputs produce null derived fields, not throws", () => {
    const r = calculateTarget({
      scenarioKind: "campaign",
      metric: "gmv",
      periodStart: "2026-06-01",
      periodEnd: "2026-06-01",
      targetValue: -1000,
      assumptions: {
        traffic: NaN,
        conversionRate: -0.1,
        aov: 0,
      },
    });
    const b = r.cases.find((c) => c.case === "baseline")!;
    assert.equal(b.gmv, null);
    assert.equal(b.requiredOrders, null);
    assert.equal(b.requiredTraffic, null);
  });
});
