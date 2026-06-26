/**
 * 关键指标双路径对账（D-ZH8, 2026-06-26）。
 *
 * 按 metricId+period 配对 extraction_tool 与 bi_aggregation 的 MetricSnapshot，
 * 只对已声明 metricId 的关键指标做对账，避免全量同名指标误报。
 *
 * 红线：只读 MetricSnapshot 衍生字段，不接触 draw_data / BiCell / dataset.rows。
 */
import type {
  MetricReconciliationPair,
  MetricReconciliationResult,
  MetricSnapshot,
  ReconciliationVerdict,
} from "./types.ts";

const EPSILON = 0.005;

function relativeDiff(a: number, b: number): number {
  if (a === b) return 0;
  const denominator = Math.max(Math.abs(a), Math.abs(b), Number.EPSILON);
  return Math.abs(a - b) / denominator;
}

function pairKey(s: MetricSnapshot): string | null {
  if (!s.metricId) return null;
  return `${s.metricId}\u0000${s.period}`;
}

/**
 * 对两组 MetricSnapshot 按 metricId+period 配对对账。
 * - 只对双方都有 metricId 的 snapshot 做配对（无 metricId 的不参与对账）。
 * - 配对成功 → 比较 value 差异：≤0.5% → matched，>0.5% → mismatch。
 * - 仅一侧有 → missing_pair。
 * - 无任何可配对 snapshot → unregistered。
 */
export function reconcileMetricSnapshots(
  extractionSnapshots: MetricSnapshot[],
  biSnapshots: MetricSnapshot[],
): MetricReconciliationResult {
  const extMap = new Map<string, MetricSnapshot>();
  const warnings: string[] = [];
  let hasDuplicate = false;
  for (const s of extractionSnapshots) {
    const key = pairKey(s);
    if (!key) continue;
    if (extMap.has(key)) {
      hasDuplicate = true;
      warnings.push(`[duplicate] ${s.metricId} (${s.period}): extraction_tool 存在多条快照，无法确认唯一口径。`);
      continue;
    }
    extMap.set(key, s);
  }

  const biMap = new Map<string, MetricSnapshot>();
  for (const s of biSnapshots) {
    const key = pairKey(s);
    if (!key) continue;
    if (biMap.has(key)) {
      hasDuplicate = true;
      warnings.push(`[duplicate] ${s.metricId} (${s.period}): bi_aggregation 存在多条快照，无法确认唯一口径。`);
      continue;
    }
    biMap.set(key, s);
  }

  const allKeys = new Set([...extMap.keys(), ...biMap.keys()]);
  if (allKeys.size === 0) {
    return { verdict: "unregistered", pairs: [], warnings: ["无可对账指标：双方均无 metricId 绑定，无法进行双路径对账。"] };
  }

  const pairs: MetricReconciliationPair[] = [];
  let hasMismatch = false;
  let hasMissingPair = false;

  for (const key of [...allKeys].sort()) {
    const [metricId, period] = key.split("\u0000") as [string, string];
    const ext = extMap.get(key);
    const bi = biMap.get(key);

    if (ext && bi) {
      const diff = relativeDiff(ext.value, bi.value);
      const matched = diff <= EPSILON;
      if (!matched) {
        hasMismatch = true;
        warnings.push(
          `[mismatch] ${metricId} (${period}): extraction_tool=${ext.value}${ext.unit ?? ""} vs bi_aggregation=${bi.value}${bi.unit ?? ""} (相对差 ${(diff * 100).toFixed(2)}%)`,
        );
      }
      pairs.push({
        metricId,
        period,
        extraction: {
          value: ext.value,
          unit: ext.unit,
          evidenceLevel: ext.evidenceLevel,
          sourceRef: ext.sourceRef,
        },
        biAggregation: {
          value: bi.value,
          unit: bi.unit,
          evidenceLevel: bi.evidenceLevel,
          sourceRef: bi.sourceRef,
        },
      });
    } else if (ext && !bi) {
      hasMissingPair = true;
      warnings.push(`[missing_pair] ${metricId} (${period}): 仅 extraction_tool 有值 (${ext.value}${ext.unit ?? ""})，bi_aggregation 无对应数据。`);
      pairs.push({
        metricId,
        period,
        extraction: {
          value: ext.value,
          unit: ext.unit,
          evidenceLevel: ext.evidenceLevel,
          sourceRef: ext.sourceRef,
        },
      });
    } else if (!ext && bi) {
      hasMissingPair = true;
      warnings.push(`[missing_pair] ${metricId} (${period}): 仅 bi_aggregation 有值 (${bi.value}${bi.unit ?? ""})，extraction_tool 无对应数据。`);
      pairs.push({
        metricId,
        period,
        biAggregation: {
          value: bi.value,
          unit: bi.unit,
          evidenceLevel: bi.evidenceLevel,
          sourceRef: bi.sourceRef,
        },
      });
    }
  }

  let verdict: ReconciliationVerdict;
  if (hasDuplicate || hasMismatch) {
    verdict = "mismatch";
    warnings.unshift("⚠️ 关键指标双路径对账发现不一致或重复口径，请核查口径差异。");
  } else if (hasMissingPair) {
    verdict = "missing_pair";
    warnings.unshift("⚠️ 部分关键指标仅单路径有数据，无法完成双路径对账。");
  } else {
    verdict = "matched";
  }

  return { verdict, pairs, warnings };
}

/**
 * 渲染对账结果块，供 UI/报告入口展示。
 * matched → 空串（无告警不展示）；其他状态 → 告警文本。
 */
export function renderReconciliationBlock(result: MetricReconciliationResult): string {
  if (result.verdict === "matched") return "";
  const lines = ["[关键指标双路径对账]"];
  if (result.verdict === "unregistered") {
    lines.push("  ⚠️ 口径未登记或 metricId 缺失，无法进行双路径对账。");
  }
  for (const w of result.warnings) {
    lines.push(`  ${w}`);
  }
  return lines.join("\n");
}
