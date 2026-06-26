/**
 * BiAggregation/MonitorFinding → MetricSnapshot 适配层（D-METRIC3, 2026-06-25）。
 *
 * 监测链路（runMonitorChecks → MonitorFinding[]）与 tool-use 链路（ExtractionTool → /run 响应）
 * 共用 X-METRIC0 的 MetricSnapshot 中间层，让 LLM 注入两条管道格式一致、数字锁口径一致。
 *
 * 红线（E-MONITOR8 安全口径）：
 *   - 本模块只读 MonitorFinding 衍生字段（comparisons / boundTo / severity / evidence.thresholds 等）
 *   - 严禁读 BiAggregationDataset.rows / cells / 原始 draw_data
 *   - grep `dataset\.rows|BiCell|draw_data` 在本文件应为空
 */
import type {
  HealthFinding,
  MetricComparison,
  MetricComparisonKind,
  MetricSnapshot,
  MetricSourceRef,
  MonitorComparison,
} from "./types.ts";
import { renderSourceLabel } from "./metric-source-label.ts";

/** finding.severity → MetricSnapshot.status（X-METRIC0 契约细化口径）。 */
function severityToStatus(severity: HealthFinding["severity"]): MetricSnapshot["status"] {
  if (severity === "critical") return "alert";
  if (severity === "warn") return "warning";
  return "normal";
}

/** MonitorComparison.kind → MetricComparison.kind（history 按 window/label 细分 mom|yoy|ma）。 */
function mapComparisonKind(c: MonitorComparison): MetricComparisonKind {
  if (c.kind === "target") return "target";
  if (c.kind === "industry") return "benchmark";
  if (c.kind === "competitor") return "competitor";
  // history：靠 window/label 关键字推断
  const hint = `${c.window ?? ""} ${c.label ?? ""}`;
  if (/环比|上一期|上月|上周|mom/i.test(hint)) return "mom";
  if (/同比|去年|上年|yoy/i.test(hint)) return "yoy";
  if (/移动均值|移动平均|ma|moving/i.test(hint)) return "ma";
  return "other";
}

function adaptComparison(c: MonitorComparison): MetricComparison {
  const out: MetricComparison = {
    kind: mapComparisonKind(c),
    label: c.label,
    currentValue: c.currentValue,
    baselineValue: c.baselineValue,
    delta: c.delta,
    deltaRate: c.deltaRate,
  };
  if (c.window) out.window = c.window;
  return out;
}

/** 从 finding 推断 period：comparisons.window 取首个非空，否则空串。 */
function inferPeriod(finding: HealthFinding): string {
  const w = finding.comparisons?.find((c) => c.window && c.window.trim())?.window;
  return w ? w.trim() : "";
}

/** evidence.thresholds 摘要为人类可读字符串，无 thresholds → undefined。 */
function summarizeThresholds(finding: HealthFinding): string | undefined {
  const ev = finding.evidence;
  if (!ev || typeof ev !== "object") return undefined;
  const t = (ev as Record<string, unknown>).thresholds;
  if (t && typeof t === "object" && !Array.isArray(t)) {
    const parts: string[] = [];
    for (const [k, v] of Object.entries(t as Record<string, unknown>)) {
      if (typeof v === "number" && Number.isFinite(v)) parts.push(`${k}=${v}`);
    }
    if (parts.length > 0) return parts.join(" / ");
  }
  const tw = (ev as Record<string, unknown>).thresholdWarn;
  const tc = (ev as Record<string, unknown>).thresholdCritical;
  const parts: string[] = [];
  if (typeof tw === "number" && Number.isFinite(tw)) parts.push(`warn=${tw}`);
  if (typeof tc === "number" && Number.isFinite(tc)) parts.push(`critical=${tc}`);
  return parts.length > 0 ? parts.join(" / ") : undefined;
}

/** evidence.current 兜底取当期 value + 置信度等级。
 *  - evidence.current 直接取值 → A
 *  - 兜底从 comparisons[0].currentValue → B
 *  - 两者皆无 → null（跳过该 finding） */
function inferCurrentValue(finding: HealthFinding): { value: number; level: "A" | "B" } | null {
  const ev = finding.evidence;
  if (ev && typeof ev === "object") {
    const cur = (ev as Record<string, unknown>).current;
    if (typeof cur === "number" && Number.isFinite(cur)) return { value: cur, level: "A" };
  }
  const c = finding.comparisons?.find((x) => typeof x.currentValue === "number" && Number.isFinite(x.currentValue));
  if (c && typeof c.currentValue === "number") return { value: c.currentValue, level: "B" };
  return null;
}

/**
 * 把一组 finding 转 MetricSnapshot[]。
 * - 只读 finding 衍生字段（不接触 dataset.rows）。
 * - 无 comparisons 且 evidence 无 current → 跳过该 finding（无可靠 value，避免造数）。
 * - 同名 metric 多 finding 时各自独立成 snapshot（不去重，调用方按需聚合）。
 */
export function biAggregationToMetricSnapshots(findings: HealthFinding[]): MetricSnapshot[] {
  const out: MetricSnapshot[] = [];
  for (const f of findings) {
    const cur = inferCurrentValue(f);
    if (cur === null) continue;
    const metricName = f.boundTo?.metricId ?? f.boundTo?.column ?? f.category ?? f.title;
    const comparisons = (f.comparisons ?? []).map(adaptComparison);
    const period = inferPeriod(f);
    const sourceRef: MetricSourceRef = {
      kind: "bi_aggregation",
      ...(f.runId ? { runId: f.runId } : {}),
      findingId: f.id,
      ...(f.boundTo?.metricId ? { metricId: f.boundTo.metricId } : {}),
      ...(period ? { window: period } : {}),
    };
    const snapshot: MetricSnapshot = {
      name: metricName,
      value: cur.value,
      period,
      status: severityToStatus(f.severity),
      source: "bi_aggregation",
      evidenceLevel: cur.level,
      sourceRef,
      ...(f.boundTo?.metricId ? { metricId: f.boundTo.metricId } : {}),
    };
    if (comparisons.length > 0) snapshot.comparisons = comparisons;
    const tn = summarizeThresholds(f);
    if (tn) snapshot.thresholdNote = tn;
    out.push(snapshot);
  }
  return out;
}

/**
 * 渲染数字锁注入块（与 D-METRIC1 MCP 注入 / E-METRIC2 system prompt 同口径）。
 * snapshots 空数组返回空串，调用方根据空串决定是否走 fallback。
 * 每条 snapshot 前附加来源标签，让 LLM 原样引用，禁止自创来源。
 */
export function renderMetricSnapshotsBlock(snapshots: MetricSnapshot[]): string {
  if (snapshots.length === 0) return "";
  const lines = [
    "[指标快照·代码确定性计算值·禁止重新推导]",
    "以下 MetricSnapshot 由监测引擎纯函数计算得出（value/delta/deltaRate/status 均代码确定）；",
    "模型只可解读业务现象、推断根因、提供策略建议，不得修改或自行算术。",
    "每条指标均带确定性 [来源:...·证据等级] 标签，引用时请保留来源标签，禁止自创来源。",
  ];
  for (const s of snapshots) {
    lines.push(renderSourceLabel(s));
    lines.push(JSON.stringify(s));
  }
  return lines.join("\n");
}
