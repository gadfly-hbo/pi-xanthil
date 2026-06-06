import type { BiDatasetDetail } from "@/types";

function norm(s: string): string {
  return String(s ?? "").toLowerCase().replace(/[\s_\-\/]+/g, "");
}

// Fuzzy match a column name against candidate aliases.
// Returns the actual column name from `columns` that best matches one of `aliases`,
// or undefined if no candidate matches.
export function matchColumn(columns: string[], aliases: string[]): string | undefined {
  const normAliases = aliases.map(norm);
  // exact (normalized) match
  for (const col of columns) {
    if (normAliases.includes(norm(col))) return col;
  }
  // contains match (alias is a substring of column or vice versa)
  for (const col of columns) {
    const nc = norm(col);
    for (const a of normAliases) {
      if (a.length >= 2 && (nc.includes(a) || a.includes(nc))) return col;
    }
  }
  return undefined;
}

export function toNumber(value: unknown): number | null {
  if (value == null || value === "") return null;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const s = String(value).trim().replace(/,/g, "").replace(/%$/, "");
  const n = Number(s);
  if (!Number.isFinite(n)) return null;
  // If original string ended with %, convert to ratio. (We already stripped it.)
  if (typeof value === "string" && value.trim().endsWith("%")) return n / 100;
  return n;
}

// Convert raw retention/rate values into 0..1 ratio.
// If a value looks like a percentage (> 1.5 or contains '%'), divide by 100.
export function toRatio(value: unknown): number | null {
  if (value == null || value === "") return null;
  const isPercentString = typeof value === "string" && value.trim().endsWith("%");
  const n = toNumber(value);
  if (n == null) return null;
  if (isPercentString) return n;
  return n > 1.5 ? n / 100 : n;
}

// ---- Slot: member_retention ----
// Expected columns (fuzzy): cohort | newUsers | M+1 ... M+6
export interface RetentionRow {
  cohort: string;
  newUsers: number;
  retention: (number | null)[];
}

const COHORT_ALIASES = ["cohort", "首单月份", "月份", "分组", "群组", "month"];
const NEW_USERS_ALIASES = ["newUsers", "新客数", "新客总数", "新增用户", "新增", "new_users"];

export function parseRetentionRows(detail: BiDatasetDetail): {
  rows: RetentionRow[];
  periodLabels: string[];
} {
  const cohortKey = matchColumn(detail.columns, COHORT_ALIASES);
  const newUsersKey = matchColumn(detail.columns, NEW_USERS_ALIASES);
  // Period columns: anything not cohort/newUsers, preserved in original order.
  const periodKeys = detail.columns.filter(
    (c) => c !== cohortKey && c !== newUsersKey,
  );
  const rows: RetentionRow[] = detail.rows.map((r, idx) => {
    const cohort = cohortKey ? String(r[cohortKey] ?? `row_${idx + 1}`) : `row_${idx + 1}`;
    const newUsers = newUsersKey ? Number(toNumber(r[newUsersKey]) ?? 0) : 0;
    const retention = periodKeys.map((k) => toRatio(r[k]));
    return { cohort, newUsers, retention };
  });
  return { rows, periodLabels: periodKeys };
}

// ---- Slot: member_recall ----
// Expected columns (fuzzy): month | repurchaseUsers | M-1 ... M-12
// Semantics: each row = a calendar month; columns are lookback periods,
// representing "what share of this month's repurchasing old customers last
// purchased N months ago".
export interface RecallRow {
  month: string;
  repurchaseUsers: number;
  recall: (number | null)[];
}

const MONTH_ALIASES = ["month", "当月", "统计月份", "月份", "归属月", "月"];
const REPURCHASE_ALIASES = [
  "repurchaseUsers",
  "总回购老客",
  "回购老客数",
  "回购老客",
  "老客回购数",
  "老客数",
  "复购老客",
  "复购人数",
  "repurchase_users",
];

export function parseRecallRows(detail: BiDatasetDetail): {
  rows: RecallRow[];
  periodLabels: string[];
} {
  const monthKey = matchColumn(detail.columns, MONTH_ALIASES);
  const repurchaseKey = matchColumn(detail.columns, REPURCHASE_ALIASES);
  // Lookback columns: anything not month/repurchase, preserved in original order.
  const periodKeys = detail.columns.filter(
    (c) => c !== monthKey && c !== repurchaseKey,
  );
  const rows: RecallRow[] = detail.rows.map((r, idx) => {
    const month = monthKey ? String(r[monthKey] ?? `row_${idx + 1}`) : `row_${idx + 1}`;
    const repurchaseUsers = repurchaseKey
      ? Number(toNumber(r[repurchaseKey]) ?? 0)
      : 0;
    const recall = periodKeys.map((k) => toRatio(r[k]));
    return { month, repurchaseUsers, recall };
  });
  return { rows, periodLabels: periodKeys };
}