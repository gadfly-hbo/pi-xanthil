/**
 * ExtractionTool → MetricSnapshot 适配层（D-METRIC1, 2026-06-25）。
 *
 * 设计原则（X-METRIC0 契约）：
 *   value / status 等数字字段全部来自工具确定性产物（summary.json），代码侧只做读取与归一化，
 *   不调 LLM、不二次推导。Snapshot 数组作为 /api/extraction-tools/:id/run 响应附加字段产出，
 *   再由 MCP 层贴上数字锁前缀注入 LLM。
 *
 * 红线：本模块不读 inputPath 文件内容，不接触 draw_data；仅消费 summary（已经过 row guard），
 * 故行级泄漏责任仍由 row guard + 工具自身负责，与本模块独立。
 */
import { basename } from "node:path";
import type { MetricSnapshot } from "./types.ts";

export interface MetricHint {
  summaryKey: string;
  name: string;
  unit?: string;
  /** 阈值打标：
   *  - alert ≥ warning（默认）：value ≥ alert → "alert"，value ≥ warning → "warning"，否则 "normal"
   *  - alert < warning（倒序，低值告警）：value ≤ alert → "alert"，value ≤ warning → "warning"，否则 "normal"
   */
  statusThresholds?: { warning: number; alert: number };
  /** 可选覆盖 period 推断（params.period 与文件名都无法识别时兜底）。 */
  periodFallback?: string;
}

/** 解析 "a.b.0.value" 点路径，遇到数字段做数组下标。命中失败返回 undefined。 */
export function lookupSummaryValue(summary: unknown, path: string): unknown {
  if (!summary || typeof summary !== "object" || !path) return undefined;
  const segments = path.split(".").filter((seg) => seg.length > 0);
  let cur: unknown = summary;
  for (const seg of segments) {
    if (cur === null || cur === undefined) return undefined;
    if (Array.isArray(cur)) {
      const idx = Number(seg);
      if (!Number.isInteger(idx) || idx < 0 || idx >= cur.length) return undefined;
      cur = cur[idx];
    } else if (typeof cur === "object") {
      cur = (cur as Record<string, unknown>)[seg];
    } else {
      return undefined;
    }
  }
  return cur;
}

function toFiniteNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return null;
    const n = Number(trimmed);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/** 从 inputPath 文件名抽取 period（YYYY-MM / YYYY-MM-DD / YYYYMM / YYYYMMDD）。无命中返回 ""。 */
export function inferPeriodFromPath(inputPath: string): string {
  if (!inputPath) return "";
  const name = basename(inputPath);
  const dash = name.match(/(\d{4}-\d{2}(?:-\d{2})?)/);
  if (dash) return dash[1]!;
  const compact = name.match(/(\d{4})(\d{2})(\d{2})?/);
  if (compact) {
    const [, y, m, d] = compact;
    return d ? `${y!}-${m!}-${d}` : `${y!}-${m!}`;
  }
  return "";
}

function inferPeriod(params: Record<string, unknown> | undefined, inputPath: string, hintFallback?: string): string {
  const fromParams = params && typeof params.period === "string" ? params.period.trim() : "";
  if (fromParams) return fromParams;
  const fromPath = inferPeriodFromPath(inputPath);
  if (fromPath) return fromPath;
  return hintFallback ?? "";
}

function classifyStatus(value: number, thresholds?: MetricHint["statusThresholds"]): MetricSnapshot["status"] {
  if (!thresholds) return "normal";
  const { warning, alert } = thresholds;
  if (!Number.isFinite(warning) || !Number.isFinite(alert)) return "normal";
  // alert ≥ warning：高值告警（默认）
  if (alert >= warning) {
    if (value >= alert) return "alert";
    if (value >= warning) return "warning";
    return "normal";
  }
  // alert < warning：低值告警（倒序）
  if (value <= alert) return "alert";
  if (value <= warning) return "warning";
  return "normal";
}

export interface BuildSnapshotsContext {
  summary: unknown;
  hints: MetricHint[] | undefined;
  inputPath: string;
  params?: Record<string, unknown>;
}

/** 主入口：按 hints 读 summary 构造 MetricSnapshot[]。无 hints 或全部命中失败 → 空数组（调用方按需丢弃）。 */
export function buildMetricSnapshotsFromHints(ctx: BuildSnapshotsContext): MetricSnapshot[] {
  if (!ctx.hints || ctx.hints.length === 0) return [];
  const out: MetricSnapshot[] = [];
  for (const hint of ctx.hints) {
    const raw = lookupSummaryValue(ctx.summary, hint.summaryKey);
    const value = toFiniteNumber(raw);
    if (value === null) continue;
    const status = classifyStatus(value, hint.statusThresholds);
    const snapshot: MetricSnapshot = {
      name: hint.name,
      value,
      ...(hint.unit ? { unit: hint.unit } : {}),
      period: inferPeriod(ctx.params, ctx.inputPath, hint.periodFallback),
      status,
      source: "extraction_tool",
    };
    if (hint.statusThresholds) {
      const { warning, alert } = hint.statusThresholds;
      snapshot.thresholdNote = `warning=${warning} / alert=${alert}`;
    }
    out.push(snapshot);
  }
  return out;
}

/** manifest.metricHints 校验：保留合法项，丢弃非法项（registry 加载期校验，运行时不再过滤）。 */
export function coerceMetricHints(value: unknown): MetricHint[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const out: MetricHint[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const obj = item as Record<string, unknown>;
    const summaryKey = typeof obj.summaryKey === "string" ? obj.summaryKey.trim() : "";
    const name = typeof obj.name === "string" ? obj.name.trim() : "";
    if (!summaryKey || !name) continue;
    const hint: MetricHint = { summaryKey, name };
    if (typeof obj.unit === "string" && obj.unit) hint.unit = obj.unit;
    if (typeof obj.periodFallback === "string" && obj.periodFallback) hint.periodFallback = obj.periodFallback;
    const t = obj.statusThresholds;
    if (t && typeof t === "object") {
      const warning = Number((t as Record<string, unknown>).warning);
      const alert = Number((t as Record<string, unknown>).alert);
      if (Number.isFinite(warning) && Number.isFinite(alert)) {
        hint.statusThresholds = { warning, alert };
      }
    }
    out.push(hint);
  }
  return out.length > 0 ? out : undefined;
}
