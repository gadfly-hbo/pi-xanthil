/**
 * 监测引擎（E-MONITOR2）—— 经营差距监测 + ontology 诊断关联，确定性纯函数零 LLM 零 IO。
 *
 * 与 health-check-engine 同范式：ctx 注入全部数据，evidence/comparisons 自解释可手工复算。
 * 差异：监测 = 与目标/历史/行业/竞品的差距 + ontology 关联诊断（看"经营指标偏差"）。
 * 两者共享 HealthFinding 形状，但规则集与执行独立。
 *
 * MonitorMetricBinding 关联契约：
 *   - bindings[0] = 源数据（source）
 *   - targetMetricId → 本体系的另一个 metric，取其绑定的数据集做目标对比
 *   - benchmarkMetricId → 行业基准 metric
 *   - competitorMetricId → 竞品 metric
 *
 * 红线：grep `runPiPrompt|spawn|fetch|readFileSync|writeFileSync` 应为空。
 */

import type {
  BiCell,
  FindingLifecycle,
  HealthFinding,
  HealthFindingKind,
  HealthSuite,
  LinkType,
  LogicRule,
  MetricDefinition,
  MonitorComparison,
  MonitorFindingDiagnosis,
  MonitorMetricBinding,
  MonitorMetricDraft,
  MonitorMetricSystemDraft,
  ObjectType,
} from "./types.ts";
import { normalizeTimeValue } from "./health-check-engine.ts";

export interface MonitorDatasetInput {
  pathId: string;
  columns: string[];
  rows: Array<Record<string, BiCell>>;
}

export interface MonitorRunContext {
  suite: HealthSuite;
  datasets: MonitorDatasetInput[];
  metricSystem: MonitorMetricSystemDraft | null;
  metrics: MetricDefinition[];
  links: LinkType[];
  objects: ObjectType[];
  logicRules: LogicRule[];
  thresholds?: Record<string, number>;
  priorFindings?: HealthFinding[];
}

export interface MonitorRunResult {
  findings: HealthFinding[];
}

const DEFAULT_THRESHOLDS: Record<string, number> = {
  gapTargetWarn: 0.1, gapTargetCritical: 0.25,
  gapHistoryYoyWarn: 0.15, gapHistoryYoyCritical: 0.3,
  gapHistoryMomWarn: 0.2, gapHistoryMomCritical: 0.4,
  gapMaDeviationWarn: 0.2, gapMaDeviationCritical: 0.4,
  gapIndustryWarn: 0.1, gapIndustryCritical: 0.25,
  gapCompetitorWarn: 0.1, gapCompetitorCritical: 0.25,
  maWindow: 3,
};

function thr(ctx: MonitorRunContext, key: string): number {
  return ctx.thresholds?.[key] ?? DEFAULT_THRESHOLDS[key] ?? 0;
}

function asNumber(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") { const n = Number(v); return Number.isFinite(n) ? n : null; }
  return null;
}

const SEV_RANK = { info: 0, warn: 1, critical: 2 } as const;
type PartialFinding = Omit<HealthFinding, "lifecycle" | "firstSeenRunId" | "signature" | "detectedAt">;

function sevOf(absRate: number, warn: number, critical: number): "info" | "warn" | "critical" | null {
  if (absRate >= critical) return "critical";
  if (absRate >= warn) return "warn";
  return null;
}

function pickWorst(s: Array<"info" | "warn" | "critical">): "info" | "warn" | "critical" {
  let w: "info" | "warn" | "critical" = "info";
  for (const x of s) if (SEV_RANK[x] > SEV_RANK[w]) w = x;
  return w;
}

// ── 纯函数数据读取 helpers ──

function readLatestValue(binding: MonitorMetricBinding, datasets: MonitorDatasetInput[]): { value: number | null; timestamp: number | null } {
  const ds = datasets.find((d) => d.pathId === binding.datasetPathId);
  if (!ds || !ds.columns.includes(binding.valueColumn)) return { value: null, timestamp: null };
  if (binding.timeColumn && ds.columns.includes(binding.timeColumn)) {
    let bestTs = -Infinity, bestVal: number | null = null;
    for (const r of ds.rows) {
      const ts = normalizeTimeValue(r[binding.timeColumn]);
      if (ts == null) continue;
      const v = asNumber(r[binding.valueColumn]);
      if (v == null) continue;
      if (ts > bestTs) { bestTs = ts; bestVal = v; }
    }
    return { value: bestVal, timestamp: bestTs === -Infinity ? null : bestTs };
  }
  for (let i = ds.rows.length - 1; i >= 0; i--) {
    const v = asNumber(ds.rows[i]?.[binding.valueColumn]);
    if (v != null) return { value: v, timestamp: null };
  }
  return { value: null, timestamp: null };
}

function readTimeSeries(binding: MonitorMetricBinding, datasets: MonitorDatasetInput[]): Array<{ ts: number; value: number }> {
  const ds = datasets.find((d) => d.pathId === binding.datasetPathId);
  if (!ds || !binding.timeColumn) return [];
  if (!ds.columns.includes(binding.timeColumn) || !ds.columns.includes(binding.valueColumn)) return [];
  const out: Array<{ ts: number; value: number }> = [];
  for (const r of ds.rows) {
    const ts = normalizeTimeValue(r[binding.timeColumn]);
    if (ts == null) continue;
    const v = asNumber(r[binding.valueColumn]);
    if (v == null) continue;
    out.push({ ts, value: v });
  }
  out.sort((a, b) => a.ts - b.ts);
  return out;
}

function buildSignature(ruleId: string, pathId: string, column?: string): string {
  return [ruleId, pathId, column].filter(Boolean).join("::");
}

function classifyLifecycle(sig: string, prior: HealthFinding[] | undefined, sev: "info" | "warn" | "critical"): { lifecycle: FindingLifecycle; firstSeenRunId: string | null } {
  const p = prior?.find((f) => f.signature === sig);
  if (!p) return { lifecycle: "new", firstSeenRunId: null };
  if (SEV_RANK[sev] > SEV_RANK[p.severity]) return { lifecycle: "worsening", firstSeenRunId: p.firstSeenRunId ?? p.runId };
  return { lifecycle: "recurring", firstSeenRunId: p.firstSeenRunId ?? p.runId };
}

function findMetric(ms: MonitorMetricSystemDraft, name: string): MonitorMetricDraft | undefined {
  return ms.metrics.find((m) => m.name === name);
}

function lookupBinding(ms: MonitorMetricSystemDraft, metricId: string | undefined): MonitorMetricBinding | undefined {
  if (!metricId) return undefined;
  const m = findMetric(ms, metricId);
  return m?.bindings[0];
}
function buildCmp(kind: MonitorComparison["kind"], label: string, cur: number | null, base: number | null, delta: number | null, deltaRate: number | null, window_?: string, evidence_?: Record<string, unknown>): MonitorComparison {
  return { kind, label, currentValue: cur, baselineValue: base, delta, deltaRate, window: window_, evidence: evidence_ };
}

function gapKind(delta: number): HealthFindingKind {
  return delta < 0 ? "问题" : "风险";
}

// ── R-GAP-TARGET ──
function ruleGapTarget(ctx: MonitorRunContext, metric: MonitorMetricDraft): PartialFinding | null {
  const sourceB = metric.bindings[0];
  if (!sourceB) return null;
  const targetB = lookupBinding(ctx.metricSystem!, sourceB.targetMetricId);
  if (!targetB) return null;
  const cur = readLatestValue(sourceB, ctx.datasets);
  const tgt = readLatestValue(targetB, ctx.datasets);
  if (cur.value == null || tgt.value == null) return null;
  const delta = cur.value - tgt.value;
  const rate = tgt.value === 0 ? null : delta / Math.abs(tgt.value);
  const absR = rate == null ? 0 : Math.abs(rate);
  const sev = sevOf(absR, thr(ctx, "gapTargetWarn"), thr(ctx, "gapTargetCritical"));
  if (!sev) return null;
  const dir = delta >= 0 ? "超出" : "落后";
  return {
    id: `mf-target-${sourceB.datasetPathId}-${sourceB.valueColumn}`,
    runId: "", ruleId: "R-GAP-TARGET", category: "指标异常", kind: gapKind(delta), severity: sev,
    title: `${metric.name} ${dir}目标 ${(absR * 100).toFixed(1)}%`,
    evidence: { current: cur.value, target: tgt.value, delta, deltaRate: rate, thresholdWarn: thr(ctx, "gapTargetWarn"), thresholdCritical: thr(ctx, "gapTargetCritical") },
    boundTo: { datasetPathId: sourceB.datasetPathId, column: sourceB.valueColumn, metricId: metric.name },
    comparisons: [buildCmp("target", "运营目标", cur.value, tgt.value, delta, rate, cur.timestamp ? new Date(cur.timestamp).toISOString().slice(0, 10) : undefined, { targetPathId: targetB.datasetPathId, targetColumn: targetB.valueColumn })],
    suggestion: delta < 0 ? "未达目标，启动差距溯源" : "已超目标，关注可持续性",
  };
}

// ── R-GAP-HISTORY ──
function ruleGapHistory(ctx: MonitorRunContext, metric: MonitorMetricDraft): PartialFinding | null {
  const sourceB = metric.bindings[0];
  if (!sourceB) return null;
  const series = readTimeSeries(sourceB, ctx.datasets);
  if (series.length < 2) return null;
  const last = series[series.length - 1]!;
  const prev = series[series.length - 2]!;
  const comps: MonitorComparison[] = [];
  const sevs: Array<"info" | "warn" | "critical"> = [];

  if (prev.value !== 0) {
    const d = last.value - prev.value;
    const r = d / Math.abs(prev.value);
    const s = sevOf(Math.abs(r), thr(ctx, "gapHistoryMomWarn"), thr(ctx, "gapHistoryMomCritical"));
    comps.push(buildCmp("history", "上一期（环比）", last.value, prev.value, d, r, new Date(last.ts).toISOString().slice(0, 10)));
    if (s) sevs.push(s);
  }

  const curDate = new Date(last.ts);
  for (const p of series) {
    const pd = new Date(p.ts);
    if (pd.getFullYear() === curDate.getFullYear() - 1 && Math.abs(pd.getMonth() - curDate.getMonth()) <= 1) {
      if (p.value !== 0) {
        const d = last.value - p.value;
        const r = d / Math.abs(p.value);
        const s = sevOf(Math.abs(r), thr(ctx, "gapHistoryYoyWarn"), thr(ctx, "gapHistoryYoyCritical"));
        comps.push(buildCmp("history", "去年同期（同比）", last.value, p.value, d, r, new Date(last.ts).toISOString().slice(0, 10)));
        if (s) sevs.push(s);
      }
      break;
    }
  }

  const maWindow = Math.min(thr(ctx, "maWindow"), series.length);
  if (maWindow >= 2 && series.length >= maWindow) {
    const tail = series.slice(-maWindow);
    const ma = tail.reduce((sum, x) => sum + x.value, 0) / tail.length;
    if (ma !== 0) {
      const d = last.value - ma;
      const r = d / Math.abs(ma);
      const s = sevOf(Math.abs(r), thr(ctx, "gapMaDeviationWarn"), thr(ctx, "gapMaDeviationCritical"));
      comps.push(buildCmp("history", `${maWindow}期移动均值`, last.value, ma, d, r, new Date(last.ts).toISOString().slice(0, 10)));
      if (s) sevs.push(s);
    }
  }

  if (comps.length === 0 || sevs.length === 0) return null;
  return {
    id: `mf-history-${sourceB.datasetPathId}-${sourceB.valueColumn}`,
    runId: "", ruleId: "R-GAP-HISTORY", category: "指标异常", kind: "风险", severity: pickWorst(sevs),
    title: `${metric.name} 历史偏离 (${comps.map((c) => c.label).join("/")})`,
    evidence: { series: series.map((s) => ({ date: new Date(s.ts).toISOString().slice(0, 10), value: s.value })), thresholds: { momWarn: thr(ctx, "gapHistoryMomWarn"), yoyWarn: thr(ctx, "gapHistoryYoyWarn"), maWindow } },
    boundTo: { datasetPathId: sourceB.datasetPathId, column: sourceB.valueColumn, metricId: metric.name },
    comparisons: comps,
    suggestion: "历史趋势出现偏离，关注持续性",
  };
}

// ── R-GAP-INDUSTRY ──
function ruleGapIndustry(ctx: MonitorRunContext, metric: MonitorMetricDraft): PartialFinding | null {
  const sourceB = metric.bindings[0];
  if (!sourceB) return null;
  const indB = lookupBinding(ctx.metricSystem!, sourceB.benchmarkMetricId);
  if (!indB) return null;
  const cur = readLatestValue(sourceB, ctx.datasets);
  const ind = readLatestValue(indB, ctx.datasets);
  if (cur.value == null || ind.value == null) return null;
  const delta = cur.value - ind.value;
  const rate = ind.value === 0 ? null : delta / Math.abs(ind.value);
  const absR = rate == null ? 0 : Math.abs(rate);
  const sev = sevOf(absR, thr(ctx, "gapIndustryWarn"), thr(ctx, "gapIndustryCritical"));
  if (!sev) return null;
  const dir = delta >= 0 ? "领先" : "落后";
  return {
    id: `mf-industry-${sourceB.datasetPathId}-${sourceB.valueColumn}`,
    runId: "", ruleId: "R-GAP-INDUSTRY", category: "指标异常", kind: gapKind(delta), severity: sev,
    title: `${metric.name} ${dir}行业大盘 ${(absR * 100).toFixed(1)}%`,
    evidence: { current: cur.value, industry: ind.value, delta, deltaRate: rate, thresholdWarn: thr(ctx, "gapIndustryWarn"), thresholdCritical: thr(ctx, "gapIndustryCritical") },
    boundTo: { datasetPathId: sourceB.datasetPathId, column: sourceB.valueColumn, metricId: metric.name },
    comparisons: [buildCmp("industry", "行业大盘", cur.value, ind.value, delta, rate, undefined, { industryPathId: indB.datasetPathId })],
    suggestion: delta < 0 ? "落后行业大盘，分析增长瓶颈" : "领先行业，关注差距变化",
  };
}

// ── R-GAP-COMPETITOR ──
function ruleGapCompetitor(ctx: MonitorRunContext, metric: MonitorMetricDraft): PartialFinding | null {
  const sourceB = metric.bindings[0];
  if (!sourceB) return null;
  const compB = lookupBinding(ctx.metricSystem!, sourceB.competitorMetricId);
  if (!compB) return null;
  const cur = readLatestValue(sourceB, ctx.datasets);
  const cmp = readLatestValue(compB, ctx.datasets);
  if (cur.value == null || cmp.value == null) return null;
  const delta = cur.value - cmp.value;
  const rate = cmp.value === 0 ? null : delta / Math.abs(cmp.value);
  const absR = rate == null ? 0 : Math.abs(rate);
  const sev = sevOf(absR, thr(ctx, "gapCompetitorWarn"), thr(ctx, "gapCompetitorCritical"));
  if (!sev) return null;
  const dir = delta >= 0 ? "领先" : "落后";
  return {
    id: `mf-competitor-${sourceB.datasetPathId}-${sourceB.valueColumn}`,
    runId: "", ruleId: "R-GAP-COMPETITOR", category: "指标异常", kind: gapKind(delta), severity: sev,
    title: `${metric.name} ${dir}竞品 ${(absR * 100).toFixed(1)}%`,
    evidence: { current: cur.value, competitor: cmp.value, delta, deltaRate: rate, thresholdWarn: thr(ctx, "gapCompetitorWarn"), thresholdCritical: thr(ctx, "gapCompetitorCritical") },
    boundTo: { datasetPathId: sourceB.datasetPathId, column: sourceB.valueColumn, metricId: metric.name },
    comparisons: [buildCmp("competitor", "竞品", cur.value, cmp.value, delta, rate, undefined, { competitorPathId: compB.datasetPathId })],
    suggestion: delta < 0 ? "落后竞品，做竞品对比分析" : "领先竞品，保持竞争优势",
  };
}

// ── ontology 诊断关联 ──
export function buildDiagnosis(metricName: string, ctx: MonitorRunContext): MonitorFindingDiagnosis | undefined {
  if (!ctx.metricSystem) return undefined;
  const ms = ctx.metricSystem;
  const metric = findMetric(ms, metricName);
  if (!metric) return undefined;

  const relatedMetricIds: string[] = [];
  for (const dep of ms.dependencies) {
    if (dep.metricId === metricName) relatedMetricIds.push(dep.relatedMetricId);
    else if (dep.relatedMetricId === metricName) relatedMetricIds.push(dep.metricId);
  }

  const ontologyObjectIds: string[] = Array.isArray(metric.objectIds) ? [...metric.objectIds] : [];

  const ontologyLinkIds: string[] = [];
  for (const link of ctx.links) {
    if (ontologyObjectIds.includes(link.sourceObjectId) || ontologyObjectIds.includes(link.targetObjectId)) {
      ontologyLinkIds.push(link.id);
    }
  }

  const logicRuleIds: string[] = [];
  for (const rule of ctx.logicRules) {
    if (rule.linkedObjectIds.some((oid) => ontologyObjectIds.includes(oid))) {
      logicRuleIds.push(rule.id);
    }
  }

  if (relatedMetricIds.length === 0 && ontologyObjectIds.length === 0 && logicRuleIds.length === 0) return undefined;

  const summary = `${metricName} 关联指标 ${relatedMetricIds.length} 个 · 对象 ${ontologyObjectIds.length} 个 · 逻辑规则 ${logicRuleIds.length} 条`;
  const opportunityParts: string[] = [];
  if (relatedMetricIds.length > 0) opportunityParts.push(`联动检查 ${relatedMetricIds.slice(0, 3).join("/")} 是否同向异常`);
  if (logicRuleIds.length > 0) opportunityParts.push(`复核 ${logicRuleIds.length} 条逻辑规则是否仍成立`);
  return {
    summary,
    relatedMetricIds,
    ontologyObjectIds,
    ontologyLinkIds: ontologyLinkIds.length > 0 ? ontologyLinkIds : undefined,
    logicRuleIds: logicRuleIds.length > 0 ? logicRuleIds : undefined,
    opportunity: opportunityParts.length > 0 ? opportunityParts.join("；") : undefined,
  };
}

// ── 引擎入口 ──
export function runMonitorChecks(ctx: MonitorRunContext, runId: string): MonitorRunResult {
  const now = Date.now();
  const raw: PartialFinding[] = [];

  if (ctx.metricSystem) {
    for (const metric of ctx.metricSystem.metrics) {
      try {
        const t = ruleGapTarget(ctx, metric);
        if (t) raw.push(t);
      } catch { /* per-rule degrade */ }
      try {
        const h = ruleGapHistory(ctx, metric);
        if (h) raw.push(h);
      } catch { /* */ }
      try {
        const i = ruleGapIndustry(ctx, metric);
        if (i) raw.push(i);
      } catch { /* */ }
      try {
        const c = ruleGapCompetitor(ctx, metric);
        if (c) raw.push(c);
      } catch { /* */ }
    }
  }

  const findings: HealthFinding[] = raw.map((f) => {
    const signature = buildSignature(f.ruleId, f.boundTo?.datasetPathId ?? "", f.boundTo?.column);
    const { lifecycle, firstSeenRunId } = classifyLifecycle(signature, ctx.priorFindings, f.severity);
    const metricName = f.boundTo?.metricId ?? "";
    const diagnosis = metricName ? buildDiagnosis(metricName, ctx) : undefined;
    return {
      ...f,
      runId,
      id: `${runId}-${f.id}`,
      signature,
      lifecycle,
      firstSeenRunId,
      detectedAt: now,
      diagnosis: diagnosis ?? f.diagnosis,
    };
  });

  if (ctx.priorFindings) {
    const currentSigs = new Set(findings.map((f) => f.signature));
    for (const prior of ctx.priorFindings) {
      if (!currentSigs.has(prior.signature) && prior.lifecycle !== "resolved") {
        findings.push({ ...prior, lifecycle: "resolved", detectedAt: now });
      }
    }
  }

  return { findings };
}
