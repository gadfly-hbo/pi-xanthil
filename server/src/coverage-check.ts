/**
 * 数据充分性预检（D-ZH6, 2026-06-26）。
 *
 * 在 LLM 写报告/指标体系草案前，先判断数据是否足够支撑结论。
 * 只读聚合文件元信息（BiAggregationDataset）、字段字典、已登记指标与 finding 衍生字段；
 * 禁止读 draw_data 原始行 / BiAggregationData.rows / BiCell。
 *
 * 红线：grep `dataset\.rows|BiCell|draw_data` 在本文件应为空。
 */
import type { BiAggregationDataset, HealthFinding, MetricDefinition } from "./types.ts";

export interface CoverageCheckInput {
  aggregations: BiAggregationDataset[];
  findings?: HealthFinding[];
  metrics?: MetricDefinition[];
}

export interface CoverageCheckResult {
  verdict: "pass" | "warn" | "fail";
  rowCount?: number;
  periodCoverage?: { periods: string[]; minPeriods: number; hasBaseline: boolean };
  baselineAvailable?: boolean;
  metricCoverage?: { registered: number; covered: number };
  warnings: string[];
}

const MIN_ROWS_FAIL = 10;
const MIN_ROWS_WARN = 100;
const MIN_PERIODS = 2;

export function checkCoverage(input: CoverageCheckInput): CoverageCheckResult {
  const warnings: string[] = [];
  let hasFail = false;

  // 1. Row count
  const totalRows = input.aggregations.reduce((sum, a) => sum + a.rowCount, 0);
  if (totalRows < MIN_ROWS_FAIL) {
    warnings.push(`数据总量仅 ${totalRows} 行，不足以支撑任何统计结论。请补充数据后重试。`);
    hasFail = true;
  } else if (totalRows < MIN_ROWS_WARN) {
    warnings.push(`数据总量仅 ${totalRows} 行，结论置信度有限。建议补充更多数据。`);
  }

  // 2. Period coverage (from findings or aggregations)
  const hasFindings = input.findings && input.findings.length > 0;
  const periods = extractPeriods(input);
  const hasBaseline = input.findings?.some((f) =>
    f.comparisons?.some((c) => c.kind === "history" || c.kind === "target"),
  ) ?? false;

  if (hasFindings && periods.length < MIN_PERIODS && !hasBaseline) {
    warnings.push(`仅覆盖 ${periods.length} 个周期，缺少基线对比，无法判断趋势或异常。请提供至少 ${MIN_PERIODS} 期数据。`);
  }

  // 3. Baseline
  if (hasFindings && !hasBaseline) {
    warnings.push("当前 finding 缺少基线对比（无 history/target comparison），无法评估偏离程度。");
  }

  // 4. Metric coverage
  if (input.metrics && input.metrics.length > 0 && input.findings) {
    const coveredMetricIds = new Set(
      input.findings.map((f) => f.boundTo?.metricId).filter(Boolean) as string[],
    );
    const covered = input.metrics.filter((m) => coveredMetricIds.has(m.id)).length;
    if (covered < input.metrics.length) {
      warnings.push(
        `已登记 ${input.metrics.length} 个指标，但仅 ${covered} 个有监测 finding 覆盖。` +
        `缺失覆盖的指标结论将标注「口径未登记」。`,
      );
    }
  }

  // 5. Column count
  const allColumns = new Set(input.aggregations.flatMap((a) => a.columns));
  if (allColumns.size === 0 && input.aggregations.length > 0) {
    warnings.push("聚合数据集未包含任何字段，无法进行分析。");
    hasFail = true;
  }

  const verdict = hasFail ? "fail" : warnings.length > 0 ? "warn" : "pass";

  return {
    verdict,
    rowCount: totalRows,
    periodCoverage: periods.length > 0 ? { periods, minPeriods: MIN_PERIODS, hasBaseline } : undefined,
    baselineAvailable: hasBaseline,
    metricCoverage: input.metrics
      ? {
          registered: input.metrics.length,
          covered: input.findings
            ? input.metrics.filter((m) =>
                input.findings!.some((f) => f.boundTo?.metricId === m.id),
              ).length
            : 0,
        }
      : undefined,
    warnings,
  };
}

function extractPeriods(input: CoverageCheckInput): string[] {
  const periods = new Set<string>();
  for (const f of input.findings ?? []) {
    for (const c of f.comparisons ?? []) {
      if (c.window && c.window.trim()) periods.add(c.window.trim());
    }
  }
  return [...periods].sort();
}

export function renderCoverageBlock(result: CoverageCheckResult): string {
  if (result.verdict === "pass") return "";

  const lines = ["[数据充分性预检]"];
  if (result.verdict === "fail") {
    lines.push("⚠️ 数据不足以支撑任何结论。请勿生成报告或指标体系，仅输出数据缺口说明。");
  } else {
    lines.push("⚠️ 数据存在以下限制，请在结论中标注置信度并列出限制条件：");
  }
  for (const w of result.warnings) {
    lines.push(`  - ${w}`);
  }
  if (result.rowCount !== undefined) lines.push(`  总行数: ${result.rowCount}`);
  if (result.periodCoverage) {
    lines.push(`  覆盖周期: ${result.periodCoverage.periods.join(", ") || "(无)"}`);
    lines.push(`  基线可用: ${result.periodCoverage.hasBaseline ? "是" : "否"}`);
  }
  if (result.metricCoverage) {
    lines.push(`  指标覆盖: ${result.metricCoverage.covered}/${result.metricCoverage.registered}`);
  }
  return lines.join("\n");
}
