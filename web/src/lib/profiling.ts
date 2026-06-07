// LLM_FORBIDDEN: this module must never call any LLM API.
// Pure-algorithm field type inference and column profiling. All results stay local.

import { quoteIdent, runQuery, type QueryRow } from "./duckdb";

export type FieldKind = "number" | "datetime" | "boolean" | "category" | "text" | "id";

export interface FieldSchema {
  name: string;
  sqlType: string;
  kind: FieldKind;
}

export interface ColumnProfile {
  name: string;
  kind: FieldKind;
  sqlType: string;
  rowCount: number;
  nullCount: number;
  nullRatio: number;
  distinctCount: number;
  min?: string | number | null;
  max?: string | number | null;
  mean?: number | null;
  stddev?: number | null;
  median?: number | null;
  q1?: number | null;
  q3?: number | null;
  outlierLowerBound?: number | null;
  outlierUpperBound?: number | null;
  outlierCount?: number | null;
  topValues?: { value: string; count: number; ratio: number }[];
  histogram?: { bucket: string; count: number }[];
}

const NUMERIC_SQL_TYPES = new Set([
  "TINYINT", "SMALLINT", "INTEGER", "BIGINT", "HUGEINT",
  "UTINYINT", "USMALLINT", "UINTEGER", "UBIGINT",
  "FLOAT", "DOUBLE", "DECIMAL", "REAL",
]);

const DATETIME_SQL_TYPES = new Set([
  "DATE", "TIMESTAMP", "TIMESTAMP_S", "TIMESTAMP_MS", "TIMESTAMP_NS",
  "TIMESTAMP WITH TIME ZONE", "TIMESTAMPTZ", "TIME", "INTERVAL",
]);

const BOOLEAN_SQL_TYPES = new Set(["BOOLEAN", "BOOL"]);

function baseSqlType(sqlType: string): string {
  const upper = sqlType.toUpperCase().trim();
  const parenIdx = upper.indexOf("(");
  return parenIdx >= 0 ? upper.slice(0, parenIdx) : upper;
}

export function inferKind(sqlType: string, columnName: string, distinctCount?: number, rowCount?: number): FieldKind {
  const base = baseSqlType(sqlType);
  if (NUMERIC_SQL_TYPES.has(base)) {
    if (distinctCount !== undefined && rowCount !== undefined && rowCount > 0) {
      if (distinctCount === rowCount && /id$|_id$|^id/i.test(columnName)) return "id";
    }
    return "number";
  }
  if (DATETIME_SQL_TYPES.has(base)) return "datetime";
  if (BOOLEAN_SQL_TYPES.has(base)) return "boolean";
  if (distinctCount !== undefined && rowCount !== undefined && rowCount > 0) {
    if (distinctCount === rowCount && rowCount >= 10) return "id";
    if (distinctCount <= 50 || distinctCount / rowCount <= 0.05) return "category";
  }
  return "text";
}

function isNumberKind(kind: FieldKind): boolean {
  return kind === "number";
}

function isDatetimeKind(kind: FieldKind): boolean {
  return kind === "datetime";
}

function toNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "bigint") return Number(value);
  if (typeof value === "string") {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function toDisplay(value: unknown): string | number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "bigint") return Number(value);
  if (typeof value === "number" || typeof value === "string") return value;
  if (value instanceof Date) return value.toISOString();
  return String(value);
}

export async function listColumns(tableName: string): Promise<{ name: string; sqlType: string }[]> {
  const rows = await runQuery(`DESCRIBE ${quoteIdent(tableName)}`);
  return rows
    .map((row) => ({
      name: String(row.column_name ?? row.name ?? ""),
      sqlType: String(row.column_type ?? row.type ?? ""),
    }))
    .filter((col) => col.name);
}

export async function profileTable(
  tableName: string,
  maxColumns = 100,
  kindOverrides?: Record<string, FieldKind>,
): Promise<{
  rowCount: number;
  fields: FieldSchema[];
  columns: ColumnProfile[];
}> {
  const ident = quoteIdent(tableName);
  const countRows = await runQuery(`SELECT COUNT(*) AS c FROM ${ident}`);
  const rowCount = Number(countRows[0]?.c ?? 0);

  const rawColumns = await listColumns(tableName);
  const targetColumns = rawColumns.slice(0, maxColumns);

  const columns: ColumnProfile[] = [];
  const fields: FieldSchema[] = [];

  for (const col of targetColumns) {
    const colIdent = quoteIdent(col.name);
    const statsRow = (await runQuery(
      `SELECT
        COUNT(*) - COUNT(${colIdent}) AS null_count,
        COUNT(DISTINCT ${colIdent}) AS distinct_count
      FROM ${ident}`,
    ))[0] as QueryRow | undefined;
    const nullCount = Number(statsRow?.null_count ?? 0);
    const distinctCount = Number(statsRow?.distinct_count ?? 0);
    const nullRatio = rowCount > 0 ? nullCount / rowCount : 0;

    // A user override (#6 manual type fix) wins over auto inference.
    const kind = kindOverrides?.[col.name] ?? inferKind(col.sqlType, col.name, distinctCount, rowCount);
    fields.push({ name: col.name, sqlType: col.sqlType, kind });
    const baseType = baseSqlType(col.sqlType);

    const profile: ColumnProfile = {
      name: col.name,
      kind,
      sqlType: col.sqlType,
      rowCount,
      nullCount,
      nullRatio,
      distinctCount,
    };

    // Guard stats by the real SQL type so a kind override (e.g. text→number)
    // can never trigger an invalid aggregate; incompatible overrides fall to top-values.
    if (isNumberKind(kind) && NUMERIC_SQL_TYPES.has(baseType)) {
      const numRow = (await runQuery(
        `SELECT
          MIN(${colIdent}) AS mn,
          MAX(${colIdent}) AS mx,
          AVG(${colIdent}) AS mean,
          STDDEV(${colIdent}) AS sd,
          MEDIAN(${colIdent}) AS med,
          QUANTILE_CONT(${colIdent}, 0.25) AS q1,
          QUANTILE_CONT(${colIdent}, 0.75) AS q3
        FROM ${ident}
        WHERE ${colIdent} IS NOT NULL`,
      ))[0] as QueryRow | undefined;
      profile.min = toDisplay(numRow?.mn);
      profile.max = toDisplay(numRow?.mx);
      profile.mean = toNumber(numRow?.mean);
      profile.stddev = toNumber(numRow?.sd);
      profile.median = toNumber(numRow?.med);
      profile.q1 = toNumber(numRow?.q1);
      profile.q3 = toNumber(numRow?.q3);
      if (profile.q1 !== null && profile.q3 !== null && profile.q1 !== undefined && profile.q3 !== undefined) {
        const iqr = profile.q3 - profile.q1;
        const lower = profile.q1 - 1.5 * iqr;
        const upper = profile.q3 + 1.5 * iqr;
        profile.outlierLowerBound = lower;
        profile.outlierUpperBound = upper;
        const outlierRow = (await runQuery(
          `SELECT COUNT(*) AS c FROM ${ident}
            WHERE ${colIdent} IS NOT NULL
              AND (${colIdent} < ${lower} OR ${colIdent} > ${upper})`,
        ))[0] as QueryRow | undefined;
        profile.outlierCount = Number(outlierRow?.c ?? 0);
      }
      if (profile.min !== null && profile.max !== null && distinctCount > 1) {
        const bucketsRows = await runQuery(
          `SELECT
            CAST(FLOOR((${colIdent} - ${profile.min}) / NULLIF((${profile.max} - ${profile.min}) / 10.0, 0)) AS INTEGER) AS bucket,
            COUNT(*) AS c
          FROM ${ident}
          WHERE ${colIdent} IS NOT NULL
          GROUP BY bucket
          ORDER BY bucket`,
        );
        profile.histogram = bucketsRows.map((row) => ({
          bucket: String(row.bucket ?? "?"),
          count: Number(row.c ?? 0),
        }));
      }
    } else if (isDatetimeKind(kind) && DATETIME_SQL_TYPES.has(baseType)) {
      const dtRow = (await runQuery(
        `SELECT MIN(${colIdent}) AS mn, MAX(${colIdent}) AS mx FROM ${ident} WHERE ${colIdent} IS NOT NULL`,
      ))[0] as QueryRow | undefined;
      profile.min = toDisplay(dtRow?.mn);
      profile.max = toDisplay(dtRow?.mx);
    } else {
      const topRows = await runQuery(
        `SELECT ${colIdent} AS v, COUNT(*) AS c
        FROM ${ident}
        WHERE ${colIdent} IS NOT NULL
        GROUP BY ${colIdent}
        ORDER BY c DESC
        LIMIT 10`,
      );
      profile.topValues = topRows.map((row) => ({
        value: String(toDisplay(row.v) ?? ""),
        count: Number(row.c ?? 0),
        ratio: rowCount > 0 ? Number(row.c ?? 0) / rowCount : 0,
      }));
    }

    columns.push(profile);
  }

  return { rowCount, fields, columns };
}
