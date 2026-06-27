import type {
  TargetAssumptions,
  TargetCalculationInput,
  TargetCalculationResult,
  TargetBreakdownItem,
  TargetCase,
  TargetCaseResult,
  TargetMetricKind,
} from "@/types";

const CASES: TargetCase[] = ["conservative", "baseline", "stretch"];

function safeDiv(a: number | null, b: number | null): number | null {
  if (a == null || b == null || !isFinite(a) || b === 0 || !isFinite(b)) return null;
  const r = a / b;
  return isFinite(r) ? r : null;
}

function safeMul(a: number | undefined | null, b: number | undefined | null): number | null {
  if (a == null || b == null || !isFinite(a) || !isFinite(b)) return null;
  const r = a * b;
  return isFinite(r) ? r : null;
}

function orZero(v: number | null | undefined): number {
  return v != null && isFinite(v) ? v : 0;
}

function applyCaseFactor(a: TargetAssumptions, c: TargetCase): TargetAssumptions {
  if (c === "baseline") return a;
  const factor = c === "conservative" ? 0.85 : 1.15;
  if (a.upliftFactor != null) {
    return {
      ...a,
      upliftFactor: safeMul(a.upliftFactor, factor) ?? undefined,
    };
  }
  return {
    ...a,
    conversionRate: safeMul(a.conversionRate, factor) ?? undefined,
    aov: safeMul(a.aov, factor) ?? undefined,
  };
}

function deriveChain(
  targetValue: number,
  metric: TargetMetricKind,
  a: TargetAssumptions,
): TargetCaseResult {
  const traffic = a.traffic ?? null;
  const conversionRate = a.conversionRate ?? null;
  const aov = a.aov ?? null;
  const refundRate = a.refundRate ?? null;
  const grossMarginRate = a.grossMarginRate ?? null;
  const marketingCost = a.marketingCost ?? null;
  const fixedCost = a.fixedCost ?? null;
  const upliftFactor = a.upliftFactor ?? 1;

  const baseOrders = safeMul(traffic, conversionRate);
  const orders = safeMul(baseOrders, upliftFactor);

  const gmv = safeMul(orders, aov);

  const revenue = gmv != null && refundRate != null
    ? gmv * (1 - refundRate) : null;

  const grossProfit = safeMul(revenue, grossMarginRate);

  const profit = grossProfit != null && marketingCost != null && fixedCost != null
    ? grossProfit - marketingCost - fixedCost : null;

  const roi = profit != null && marketingCost != null
    ? safeDiv(profit, marketingCost) : null;

  let requiredOrders: number | null = null;
  let requiredTraffic: number | null = null;
  let requiredAov: number | null = null;
  let requiredConversionRate: number | null = null;

  switch (metric) {
    case "orders":
      requiredOrders = targetValue;
      requiredTraffic = safeDiv(requiredOrders, conversionRate);
      requiredAov = null;
      requiredConversionRate = safeDiv(requiredOrders, traffic);
      break;
    case "gmv":
      requiredOrders = safeDiv(targetValue, aov);
      requiredTraffic = safeDiv(requiredOrders, conversionRate);
      requiredAov = safeDiv(targetValue, orders);
      requiredConversionRate = safeDiv(requiredOrders, traffic);
      break;
    case "revenue":
      requiredOrders = safeDiv(targetValue, safeMul(aov, 1 - orZero(refundRate)));
      requiredTraffic = safeDiv(requiredOrders, conversionRate);
      requiredAov = safeDiv(targetValue, safeMul(orders, 1 - orZero(refundRate)));
      requiredConversionRate = safeDiv(requiredOrders, traffic);
      break;
    case "gross_profit":
      requiredOrders = safeDiv(targetValue, safeMul(safeMul(aov, 1 - orZero(refundRate)), grossMarginRate));
      requiredTraffic = safeDiv(requiredOrders, conversionRate);
      requiredAov = safeDiv(targetValue, safeMul(safeMul(orders, 1 - orZero(refundRate)), grossMarginRate));
      requiredConversionRate = safeDiv(requiredOrders, traffic);
      break;
    case "profit":
      requiredOrders = safeDiv(
        targetValue + orZero(marketingCost) + orZero(fixedCost),
        safeMul(safeMul(aov, 1 - orZero(refundRate)), grossMarginRate),
      );
      requiredTraffic = safeDiv(requiredOrders, conversionRate);
      requiredAov = safeDiv(
        targetValue + orZero(marketingCost) + orZero(fixedCost),
        safeMul(safeMul(orders, 1 - orZero(refundRate)), grossMarginRate),
      );
      requiredConversionRate = safeDiv(requiredOrders, traffic);
      break;
  }

  return {
    case: "baseline",
    targetValue,
    requiredTraffic,
    requiredOrders,
    requiredAov,
    requiredConversionRate,
    gmv,
    revenue,
    grossProfit,
    profit,
    roi,
  };
}

function generatePeriods(input: TargetCalculationInput): string[] {
  const start = new Date(input.periodStart);
  const end = new Date(input.periodEnd);
  const periods: string[] = [];

  if (isNaN(start.getTime()) || isNaN(end.getTime()) || start > end) return [];

  switch (input.scenarioKind) {
    case "yearly_kpi":
    case "rolling_monthly": {
      const cursor = new Date(start);
      while (cursor <= end) {
        periods.push(cursor.toISOString().slice(0, 7));
        cursor.setMonth(cursor.getMonth() + 1);
      }
      break;
    }
    case "campaign": {
      const cursor = new Date(start);
      while (cursor <= end) {
        periods.push(cursor.toISOString().slice(0, 10));
        cursor.setDate(cursor.getDate() + 1);
      }
      break;
    }
  }

  return periods;
}

export function calculateTarget(input: TargetCalculationInput): TargetCalculationResult {
  const cases: TargetCaseResult[] = CASES.map((c) => {
    const adj = applyCaseFactor(input.assumptions, c);
    const base = deriveChain(input.targetValue, input.metric, adj);
    return { ...base, case: c };
  });

  const periods = generatePeriods(input);
  const n = periods.length || 1;

  const breakdown: TargetBreakdownItem[] = [];
  for (const c of CASES) {
    for (const period of periods) {
      breakdown.push({ period, case: c, targetValue: input.targetValue / n });
    }
  }

  return { cases, breakdown };
}
