/**
 * 体检引擎（V-HEALTH1）——确定性规则巡检，零 LLM、零 IO。
 *
 * 设计照 anax-gate 范式（确定性重算 / 硬阈值），纯函数好测：
 *   - 数据 ctx 注入，引擎内部不 fetch / 不 spawn / 不 read file
 *   - evidence 自解释到可手工复算
 *   - 跨 run 比对靠 finding.signature 稳定指纹
 *
 * 数据画像三件套（SPIKE 结论落地）：
 *   normalizeTimeColumn  —— Excel 序列号 / ISO 字符串 / 时间戳 三格式归一
 *   classifyAggregation  —— 时序 / 快照 / 维度三态启发式
 *   inferFrequency       —— stride 众数推断频率，不硬编码白名单
 *
 * 红线：本文件 grep `runPiPrompt|spawn|fetch|readFileSync|writeFileSync` 应为空。
 */

import type {
  BiCell,
  DatasetShape,
  FindingLifecycle,
  HealthFinding,
  HealthRuleMeta,
  HealthRuleNeeds,
  HealthSuite,
  LinkType,
  ObjectType,
  OntologyGap,
  PropertyType,
} from "./types.ts";

// ────────────────────────────────────────────────────────────
// 1. 数据画像
// ────────────────────────────────────────────────────────────

const EXCEL_EPOCH_MS = Date.UTC(1899, 11, 30); // Excel serial day 0 = 1899-12-30
const MS_PER_DAY = 86_400_000;

/**
 * 把单个单元格值归一为 epoch ms（number）或 null（无法解析）。
 * 支持三种格式（SPIKE① 实测：cohort_month=45658 即 Excel 序列号）：
 *   - number 1..2958465 → Excel 序列号（1900-01-01 ~ 9999-12-31）
 *   - string ISO / YYYY-MM-DD / YYYY/MM/DD → Date.parse
 *   - number > 1e12 → epoch ms 时间戳
 */
export function normalizeTimeValue(v: unknown): number | null {
  if (v == null || v === "") return null;
  if (typeof v === "number") {
    if (v > 1e12) return v; // epoch ms
    if (v >= 1 && v <= 2_958_465) return Math.round(EXCEL_EPOCH_MS + v * MS_PER_DAY); // Excel serial
    return null;
  }
  if (typeof v === "boolean") return null;
  const s = String(v).trim();
  if (s === "") return null;
  const t = Date.parse(s);
  return Number.isNaN(t) ? null : t;
}

/** 归一一列值，返回有效时间戳数组（跳过 null）。 */
export function normalizeTimeColumn(values: unknown[]): number[] {
  const out: number[] = [];
  for (const v of values) {
    const t = normalizeTimeValue(v);
    if (t != null) out.push(t);
  }
  return out;
}

const TIME_COL_RE =
  /cohort|date|day|month|quarter|year|period|week|账期|周期|月份|日期|年|季|周|hour|时间|timestamp/i;
const PERIOD_IN_COLNAME_RE = /\d{2,4}[.\-/]\d{1,2}/;

function findTimeColumn(columns: string[]): string | null {
  for (const c of columns) {
    if (TIME_COL_RE.test(c)) return c;
  }
  return null;
}

/**
 * 判定聚合集形态（SPIKE②）。
 *   timeseries — 有时间列 + 该列不同值 > 1
 *   snapshot   — 无时间列但列名嵌入期段标记
 *   dimension  — 其余（静态主数据）
 */
export function classifyAggregation(
  columns: string[],
  rows: Array<Record<string, unknown>>,
): DatasetShape {
  const timeCol = findTimeColumn(columns);
  if (timeCol) {
    const distinct = new Set<unknown>();
    for (const r of rows) {
      const v = r[timeCol];
      if (v != null && v !== "") distinct.add(v);
      if (distinct.size > 1) break;
    }
    if (distinct.size > 1) return "timeseries";
  }
  for (const c of columns) {
    if (PERIOD_IN_COLNAME_RE.test(c)) return "snapshot";
  }
  return "dimension";
}

export type InferredFrequency = "daily" | "weekly" | "monthly" | "quarterly" | "yearly" | "irregular";

/**
 * 用 stride 众数推断频率（SPIKE②，不硬编码白名单）。
 *   1       → daily
 *   6-8     → weekly
 *   28-31   → monthly
 *   89-93   → quarterly
 *   360-366 → yearly
 *   其它    → irregular
 */
export function inferFrequency(timestamps: number[]): InferredFrequency {
  if (timestamps.length < 2) return "irregular";
  const uniq = Array.from(new Set(timestamps)).sort((a, b) => a - b);
  if (uniq.length < 2) return "irregular";
  const strides: number[] = [];
  for (let i = 1; i < uniq.length; i++) {
    const days = Math.round((uniq[i]! - uniq[i - 1]!) / MS_PER_DAY);
    if (days > 0) strides.push(days);
  }
  if (strides.length === 0) return "irregular";
  const counts = new Map<number, number>();
  for (const s of strides) counts.set(s, (counts.get(s) ?? 0) + 1);
  let modeDays = 0;
  let modeCount = 0;
  for (const [d, c] of counts) {
    if (c > modeCount) {
      modeDays = d;
      modeCount = c;
    }
  }
  if (modeDays <= 1) return "daily";
  if (modeDays >= 6 && modeDays <= 8) return "weekly";
  if (modeDays >= 28 && modeDays <= 31) return "monthly";
  if (modeDays >= 89 && modeDays <= 93) return "quarterly";
  if (modeDays >= 360 && modeDays <= 366) return "yearly";
  return "irregular";
}

// ────────────────────────────────────────────────────────────
// 2. 引擎上下文与规则
// ────────────────────────────────────────────────────────────

export interface HealthDatasetInput {
  pathId: string;
  columns: string[];
  rows: Array<Record<string, BiCell>>;
}

export interface HealthRunContext {
  suite: HealthSuite;
  datasets: HealthDatasetInput[];
  metrics: unknown[];
  links: LinkType[];
  objects: ObjectType[];
  properties?: PropertyType[];
  businessContexts: unknown[];
  thresholds?: Record<string, number>;
  priorFindings?: HealthFinding[];
}

export interface HealthRunResult {
  findings: HealthFinding[];
  gaps: OntologyGap[];
}

export interface HealthRule {
  meta: HealthRuleMeta;
  evaluate(ctx: HealthRunContext): Omit<HealthFinding, "lifecycle" | "firstSeenRunId" | "signature" | "detectedAt">[];
}

function datasetShape(d: HealthDatasetInput): DatasetShape {
  return classifyAggregation(d.columns, d.rows);
}

function buildSignature(ruleId: string, pathId: string, column?: string, extra?: string): string {
  const parts = [ruleId, pathId];
  if (column) parts.push(column);
  if (extra) parts.push(extra);
  return parts.join("::");
}

const SEV_RANK = { info: 0, warn: 1, critical: 2 } as const;

function classifyLifecycle(
  signature: string,
  priorFindings: HealthFinding[] | undefined,
  currentSeverity: "info" | "warn" | "critical",
): { lifecycle: FindingLifecycle; firstSeenRunId: string | null } {
  const prior = priorFindings?.find((f) => f.signature === signature);
  if (!prior) return { lifecycle: "new", firstSeenRunId: null };
  if (SEV_RANK[currentSeverity] > SEV_RANK[prior.severity]) {
    return { lifecycle: "worsening", firstSeenRunId: prior.firstSeenRunId ?? prior.runId };
  }
  return { lifecycle: "recurring", firstSeenRunId: prior.firstSeenRunId ?? prior.runId };
}

// ────────────────────────────────────────────────────────────
// 3. 种子规则
// ────────────────────────────────────────────────────────────

const DEFAULT_THRESHOLDS: Record<string, number> = {
  nullRateWarn: 0.05,
  nullRateCritical: 0.2,
  freshnessStaleDays: 35,
  momChangeWarn: 0.2,
  momChangeCritical: 0.5,
  trendConsecutive: 3,
  trendExtrapPeriods: 3,
  trendBoundaryMargin: 0.1,
};

function getThreshold(ctx: HealthRunContext, key: string): number {
  return ctx.thresholds?.[key] ?? DEFAULT_THRESHOLDS[key] ?? 0;
}

function asNumber(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function findTimeCol(d: HealthDatasetInput): string | null {
  return findTimeColumn(d.columns);
}

type PartialFinding = Omit<HealthFinding, "lifecycle" | "firstSeenRunId" | "signature" | "detectedAt">;

// ── R-DQ-01: 空值率（数据质量，截面，零本体依赖） ──
const ruleNullRate: HealthRule = {
  meta: {
    id: "R-DQ-01",
    category: "数据质量",
    title: "空值率过高",
    description: "某列空值（null/空串）占比超过阈值 → 问题",
    suites: ["daily", "weekly", "monthly", "quarterly", "yearly"],
    kind: "问题",
    needs: { timeSeries: false },
    thresholds: DEFAULT_THRESHOLDS,
    enabled: true,
  },
  evaluate(ctx) {
    const findings: PartialFinding[] = [];
    const warn = getThreshold(ctx, "nullRateWarn");
    const crit = getThreshold(ctx, "nullRateCritical");
    for (const ds of ctx.datasets) {
      const total = ds.rows.length;
      if (total === 0) continue;
      for (const col of ds.columns) {
        let nullCount = 0;
        for (const r of ds.rows) {
          const v = r[col];
          if (v == null || v === "") nullCount++;
        }
        const rate = nullCount / total;
        if (rate >= warn) {
          findings.push({
            id: `f-${ds.pathId}-DQ01-${col}`,
            runId: "",
            ruleId: "R-DQ-01",
            category: "数据质量",
            kind: "问题",
            severity: rate >= crit ? "critical" : "warn",
            title: `${col} 空值率 ${(rate * 100).toFixed(1)}%`,
            evidence: { pathId: ds.pathId, column: col, nullCount, total, rate: Number(rate.toFixed(4)), thresholdWarn: warn, thresholdCritical: crit },
            boundTo: { datasetPathId: ds.pathId, column: col },
            suggestion: rate >= crit ? "空值率过高，检查数据源采集链路或补数" : "空值率偏高，建议关注数据质量",
          });
        }
      }
    }
    return findings;
  },
};

// ── R-DQ-02: 数据新鲜度（数据质量，需时序，零本体依赖） ──
const ruleFreshness: HealthRule = {
  meta: {
    id: "R-DQ-02",
    category: "数据质量",
    title: "数据不新鲜",
    description: "时序数据最新时间点距 now 超过阈值 → 问题",
    suites: ["daily", "weekly", "monthly", "quarterly", "yearly"],
    kind: "问题",
    needs: { timeSeries: true },
    thresholds: DEFAULT_THRESHOLDS,
    enabled: true,
  },
  evaluate(ctx) {
    const findings: PartialFinding[] = [];
    const staleDays = getThreshold(ctx, "freshnessStaleDays");
    const now = Date.now();
    for (const ds of ctx.datasets) {
      if (datasetShape(ds) !== "timeseries") continue;
      const timeCol = findTimeCol(ds);
      if (!timeCol) continue;
      const ts = normalizeTimeColumn(ds.rows.map((r) => r[timeCol]));
      if (ts.length === 0) continue;
      const latest = Math.max(...ts);
      const ageDays = (now - latest) / MS_PER_DAY;
      if (ageDays > staleDays) {
        findings.push({
          id: `f-${ds.pathId}-DQ02`,
          runId: "",
          ruleId: "R-DQ-02",
          category: "数据质量",
          kind: "问题",
          severity: ageDays > staleDays * 2 ? "critical" : "warn",
          title: `数据集 ${ds.pathId} 最新数据距今 ${Math.round(ageDays)} 天`,
          evidence: { pathId: ds.pathId, latestTs: latest, latestIso: new Date(latest).toISOString(), ageDays: Math.round(ageDays), thresholdDays: staleDays },
          boundTo: { datasetPathId: ds.pathId },
          suggestion: "数据已过期，检查上游同步任务是否中断",
        });
      }
    }
    return findings;
  },
};

// ── R-AN-01: 环比突变（指标异常，需时序） ──
const ruleMomSpike: HealthRule = {
  meta: {
    id: "R-AN-01",
    category: "指标异常",
    title: "环比突变",
    description: "时序数值列最近一期环比变化幅度超阈值 → 问题",
    suites: ["daily", "weekly", "monthly", "quarterly", "yearly"],
    kind: "问题",
    needs: { timeSeries: true },
    thresholds: DEFAULT_THRESHOLDS,
    enabled: true,
  },
  evaluate(ctx) {
    const findings: PartialFinding[] = [];
    const warn = getThreshold(ctx, "momChangeWarn");
    const crit = getThreshold(ctx, "momChangeCritical");
    for (const ds of ctx.datasets) {
      if (datasetShape(ds) !== "timeseries") continue;
      const timeCol = findTimeCol(ds);
      if (!timeCol) continue;
      const indexed = ds.rows
        .map((r) => ({ ts: normalizeTimeValue(r[timeCol]), row: r }))
        .filter((x): x is { ts: number; row: Record<string, BiCell> } => x.ts != null)
        .sort((a, b) => a.ts - b.ts);
      if (indexed.length < 2) continue;
      for (const col of ds.columns) {
        if (col === timeCol) continue;
        const series = indexed.map((x) => asNumber(x.row[col])).filter((n): n is number => n != null);
        if (series.length < 2) continue;
        const last = series[series.length - 1]!;
        const prev = series[series.length - 2]!;
        if (prev === 0) continue;
        const change = (last - prev) / Math.abs(prev);
        if (Math.abs(change) >= warn) {
          findings.push({
            id: `f-${ds.pathId}-AN01-${col}`,
            runId: "",
            ruleId: "R-AN-01",
            category: "指标异常",
            kind: "问题",
            severity: Math.abs(change) >= crit ? "critical" : "warn",
            title: `${col} 环比 ${change > 0 ? "+" : ""}${(change * 100).toFixed(1)}%`,
            evidence: { pathId: ds.pathId, column: col, last, prev, change: Number(change.toFixed(4)), thresholdWarn: warn, thresholdCritical: crit },
            boundTo: { datasetPathId: ds.pathId, column: col },
            suggestion: "环比变化幅度大，检查业务原因或数据异常",
          });
        }
      }
    }
    return findings;
  },
};

// ── R-TR-01: 趋势外推越界风险（趋势风险，需时序） ──
const ruleTrendExtrap: HealthRule = {
  meta: {
    id: "R-TR-01",
    category: "趋势风险",
    title: "趋势外推越界风险",
    description: "时序数值列连续同向变化 + 线性外推 N 期后越界 → 风险",
    suites: ["daily", "weekly", "monthly", "quarterly", "yearly"],
    kind: "风险",
    needs: { timeSeries: true },
    thresholds: DEFAULT_THRESHOLDS,
    enabled: true,
  },
  evaluate(ctx) {
    const findings: PartialFinding[] = [];
    const consecutive = getThreshold(ctx, "trendConsecutive");
    const extrapPeriods = getThreshold(ctx, "trendExtrapPeriods");
    const margin = getThreshold(ctx, "trendBoundaryMargin");
    for (const ds of ctx.datasets) {
      if (datasetShape(ds) !== "timeseries") continue;
      const timeCol = findTimeCol(ds);
      if (!timeCol) continue;
      const indexed = ds.rows
        .map((r) => ({ ts: normalizeTimeValue(r[timeCol]), row: r }))
        .filter((x): x is { ts: number; row: Record<string, BiCell> } => x.ts != null)
        .sort((a, b) => a.ts - b.ts);
      if (indexed.length < consecutive + 1) continue;
      for (const col of ds.columns) {
        if (col === timeCol) continue;
        const series = indexed.map((x) => asNumber(x.row[col])).filter((n): n is number => n != null);
        if (series.length < consecutive + 1) continue;
        // 检查最近 N 期是否同向
        const tail = series.slice(-consecutive - 1);
        let allIncreasing = true;
        let allDecreasing = true;
        for (let i = 1; i < tail.length; i++) {
          if (tail[i]! <= tail[i - 1]!) allIncreasing = false;
          if (tail[i]! >= tail[i - 1]!) allDecreasing = false;
        }
        if (!allIncreasing && !allDecreasing) continue;
        // 线性回归外推
        const n = tail.length;
        const xMean = (n - 1) / 2;
        const yMean = tail.reduce((a, b) => a + b, 0) / n;
        let num = 0;
        let den = 0;
        for (let i = 0; i < n; i++) {
          num += (i - xMean) * (tail[i]! - yMean);
          den += (i - xMean) ** 2;
        }
        if (den === 0) continue;
        const slope = num / den;
        const intercept = yMean - slope * xMean;
        const projected = intercept + slope * (n - 1 + extrapPeriods);
        // 越界检测：外推值与最近值偏差超过 margin
        const lastVal = tail[tail.length - 1]!;
        const deviation = lastVal === 0 ? Math.abs(projected) : Math.abs((projected - lastVal) / Math.abs(lastVal));
        if (deviation > margin) {
          findings.push({
            id: `f-${ds.pathId}-TR01-${col}`,
            runId: "",
            ruleId: "R-TR-01",
            category: "趋势风险",
            kind: "风险",
            severity: deviation > margin * 2 ? "critical" : "warn",
            title: `${col} 连续${allIncreasing ? "上升" : "下降"}${consecutive}期，外推${extrapPeriods}期后偏离${(deviation * 100).toFixed(0)}%`,
            evidence: {
              pathId: ds.pathId,
              column: col,
              direction: allIncreasing ? "up" : "down",
              consecutive,
              tailValues: tail,
              slope: Number(slope.toFixed(6)),
              intercept: Number(intercept.toFixed(6)),
              projected,
              lastVal,
              deviation: Number(deviation.toFixed(4)),
              extrapPeriods,
              margin,
            },
            boundTo: { datasetPathId: ds.pathId, column: col },
            suggestion: `按当前趋势，${col} 将在 ${extrapPeriods} 期后越界，建议提前干预`,
          });
        }
      }
    }
    return findings;
  },
};

// ── R-CR-01: 跨集悬挂（勾稽一致，需 link + crossDataset）
//   SPIKE④：当前本体零自动 link，此类多退化跳过 + 记 gap。
const ruleCrossRefDangling: HealthRule = {
  meta: {
    id: "R-CR-01",
    category: "勾稽一致",
    title: "跨集引用悬挂",
    description: "link.joinKeys 跨集关联时，源列值在目标集中找不到 → 问题",
    suites: ["daily", "weekly", "monthly", "quarterly", "yearly"],
    kind: "问题",
    needs: { timeSeries: false, crossDataset: true, ontologyRefs: ["link"] },
    thresholds: DEFAULT_THRESHOLDS,
    enabled: true,
  },
  evaluate(ctx) {
    const findings: PartialFinding[] = [];
    // SPIKE④：当前本体零自动 link → 退化跳过
    // 若有 link，检查 joinKeys 源列值是否在目标数据集中存在
    for (const link of ctx.links) {
      if (link.kind !== "join" && link.kind !== "fk") continue;
      if (!link.joinKeys || link.joinKeys.length === 0) continue;
      const sourceObj = ctx.objects.find((o) => o.id === link.sourceObjectId);
      const targetObj = ctx.objects.find((o) => o.id === link.targetObjectId);
      if (!sourceObj || !targetObj) continue;
      if (!sourceObj.boundPathId || !targetObj.boundPathId) continue;
      const sourceDs = ctx.datasets.find((d) => d.pathId === sourceObj.boundPathId);
      const targetDs = ctx.datasets.find((d) => d.pathId === targetObj.boundPathId);
      if (!sourceDs || !targetDs) continue;
      for (const jk of link.joinKeys) {
        if (!sourceDs.columns.includes(jk.source) || !targetDs.columns.includes(jk.target)) continue;
        const targetValues = new Set<unknown>();
        for (const r of targetDs.rows) targetValues.add(r[jk.target]);
        let danglingCount = 0;
        const danglingSamples: unknown[] = [];
        for (const r of sourceDs.rows) {
          if (!targetValues.has(r[jk.source])) {
            danglingCount++;
            if (danglingSamples.length < 3) danglingSamples.push(r[jk.source]);
          }
        }
        if (danglingCount > 0) {
          findings.push({
            id: `f-${sourceDs.pathId}-CR01-${jk.source}-${jk.target}`,
            runId: "",
            ruleId: "R-CR-01",
            category: "勾稽一致",
            kind: "问题",
            severity: danglingCount > sourceDs.rows.length * 0.1 ? "critical" : "warn",
            title: `${jk.source}→${jk.target} 悬挂引用 ${danglingCount} 条`,
            evidence: {
              sourcePathId: sourceDs.pathId,
              targetPathId: targetDs.pathId,
              joinKey: jk,
              danglingCount,
              sourceTotal: sourceDs.rows.length,
              danglingSamples,
            },
            boundTo: { datasetPathId: sourceDs.pathId, column: jk.source },
            suggestion: "检查跨集数据完整性，补齐目标集缺失的关联记录",
          });
        }
      }
    }
    return findings;
  },
};

// ────────────────────────────────────────────────────────────
// 4. 规则注册表 + 引擎入口
// ────────────────────────────────────────────────────────────

const ALL_RULES: HealthRule[] = [
  ruleNullRate,
  ruleFreshness,
  ruleMomSpike,
  ruleTrendExtrap,
  ruleCrossRefDangling,
];

/** 导出规则元数据（含 needs，供体检台展示与匹配）。 */
export function listHealthRules(): HealthRuleMeta[] {
  return ALL_RULES.filter((r) => r.meta.enabled).map((r) => r.meta);
}

/**
 * 检测本体缺口（SPIKE④）：dataset 列名无匹配 concept → gap。
 * ponytail: 简单子串匹配，将来可升级到拼音/语义相似度。
 */
export function detectOntologyGaps(
  datasets: HealthDatasetInput[],
  objects: ObjectType[],
): OntologyGap[] {
  const gaps: OntologyGap[] = [];
  const conceptNames = objects
    .filter((o) => o.kind === "concept")
    .map((o) => ({ id: o.id, nameCn: o.nameCn, nameEn: o.nameEn ?? "" }));
  for (const ds of datasets) {
    for (const col of ds.columns) {
      const colLower = col.toLowerCase();
      const matched = conceptNames.some(
        (c) =>
          c.nameCn.includes(col) ||
          colLower.includes(c.nameCn.toLowerCase()) ||
          (c.nameEn && colLower.includes(c.nameEn.toLowerCase())),
      );
      if (!matched) {
        gaps.push({
          datasetPathId: ds.pathId,
          column: col,
          reason: "无匹配本体概念",
        });
      }
    }
  }
  return gaps;
}

/**
 * 引擎入口：跑体检套件，返回 findings + gaps。
 * - 按 suite 过滤规则（suite ∈ rule.suits）
 * - 按 rule.needs vs dataset 形态匹配；不匹配跳过
 * - 跨 run 比对：prior 有 current 无 → resolved；prior 有 current 有 → recurring/worsening
 * - 退化安全：空数据/快照集/维度集 → 跳过对应规则，不崩
 */
export function runHealthSuite(ctx: HealthRunContext): HealthRunResult {
  const now = Date.now();
  const rawFindings: PartialFinding[] = [];
  const gaps: OntologyGap[] = [];

  for (const rule of ALL_RULES) {
    if (!rule.meta.enabled) continue;
    if (!rule.meta.suites.includes(ctx.suite)) continue;
    try {
      const results = rule.evaluate(ctx);
      rawFindings.push(...results);
    } catch {
      // 退化安全：单规则异常不影响其他规则
    }
  }

  // 本体缺口检测
  gaps.push(...detectOntologyGaps(ctx.datasets, ctx.objects));

  // 填充 lifecycle / signature / detectedAt
  const findings: HealthFinding[] = rawFindings.map((f) => {
    const signature = buildSignature(
      f.ruleId,
      f.boundTo?.datasetPathId ?? "",
      f.boundTo?.column,
    );
    const { lifecycle, firstSeenRunId } = classifyLifecycle(
      signature,
      ctx.priorFindings,
      f.severity,
    );
    return {
      ...f,
      signature,
      lifecycle,
      firstSeenRunId,
      detectedAt: now,
    };
  });

  // 补 resolved：prior 有但 current 无
  if (ctx.priorFindings) {
    const currentSigs = new Set(findings.map((f) => f.signature));
    for (const prior of ctx.priorFindings) {
      if (!currentSigs.has(prior.signature) && prior.lifecycle !== "resolved") {
        findings.push({
          ...prior,
          lifecycle: "resolved",
          detectedAt: now,
        });
      }
    }
  }

  return { findings, gaps };
}
