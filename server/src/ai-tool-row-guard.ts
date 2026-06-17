export const DEFAULT_AI_TOOL_MAX_RESULT_ROWS = 100;

const DETAIL_ARRAY_KEYS = new Set(["rows", "records", "data"]);
const ROW_COUNT_KEYS = new Set(["rowCount", "rowsTotal", "totalRows"]);

export interface AiToolRowGuardResult {
  blocked: boolean;
  summary: unknown;
  maxRowsSeen: number;
}

export function aiToolRowGuardMessage(limit: number): string {
  return `结果超 ${limit} 行，疑似明细输出，请加 GROUP BY/COUNT 聚合`;
}

export function parseAiToolMaxRows(value: unknown): number {
  const n = Number(value ?? DEFAULT_AI_TOOL_MAX_RESULT_ROWS);
  return Number.isFinite(n) && n > 0 ? Math.trunc(n) : DEFAULT_AI_TOOL_MAX_RESULT_ROWS;
}

function numericValue(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return undefined;
}

export function guardAiToolRows(value: unknown, limit = DEFAULT_AI_TOOL_MAX_RESULT_ROWS): AiToolRowGuardResult {
  let blocked = false;
  let maxRowsSeen = 0;

  const visit = (node: unknown, keyHint = ""): unknown => {
    if (Array.isArray(node)) {
      maxRowsSeen = Math.max(maxRowsSeen, node.length);
      const looksLikeDetailRows = DETAIL_ARRAY_KEYS.has(keyHint)
        || node.some((item) => typeof item === "object" && item !== null && !Array.isArray(item));
      if (looksLikeDetailRows && node.length > limit) {
        blocked = true;
        return node.slice(0, limit);
      }
      return node.map((item) => visit(item));
    }
    if (typeof node !== "object" || node === null) return node;

    const out: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(node as Record<string, unknown>)) {
      const n = ROW_COUNT_KEYS.has(key) ? numericValue(child) : undefined;
      if (n !== undefined) {
        maxRowsSeen = Math.max(maxRowsSeen, n);
        if (n > limit) blocked = true;
      }
      out[key] = visit(child, key);
    }
    return out;
  };

  const summary = visit(value);
  return { blocked, summary, maxRowsSeen };
}

export function guardToolRunSummaryForSource(
  source: "ai" | "manual",
  summary: unknown,
  limit = DEFAULT_AI_TOOL_MAX_RESULT_ROWS,
): AiToolRowGuardResult {
  if (source !== "ai") return { blocked: false, summary, maxRowsSeen: 0 };
  return guardAiToolRows(summary, limit);
}
