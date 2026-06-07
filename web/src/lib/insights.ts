// LLM_FORBIDDEN: this module must never call any LLM API.
// Layer 2 auto-insights: correlation matrix, category↔numeric association (η²),
// and data-quality flags. All computation is pure algorithm in duckdb-wasm /
// local JS. No data, column names, or results ever go to an LLM.

import { quoteIdent, runQuery, type QueryRow } from "./duckdb";
import type { ColumnProfile } from "./profiling";

// ---- Pearson correlation matrix ----

export interface CorrelationMatrix {
  columns: string[];
  // Symmetric NxN; diagonal = 1; null when undefined (constant column / no pairs).
  matrix: (number | null)[][];
}

function toNum(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  const n = typeof v === "bigint" ? Number(v) : Number(v);
  return Number.isFinite(n) ? n : null;
}

export async function computeCorrelationMatrix(
  tableName: string,
  numericCols: string[],
): Promise<CorrelationMatrix> {
  const cols = numericCols.slice();
  const n = cols.length;
  const matrix: (number | null)[][] = cols.map((_, i) =>
    cols.map((__, j) => (i === j ? 1 : null)),
  );
  if (n < 2) return { columns: cols, matrix };

  const ident = quoteIdent(tableName);
  const selects: string[] = [];
  const pairKeys: Array<{ i: number; j: number; key: string }> = [];
  let p = 0;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const key = `c${p++}`;
      // duckdb native corr(y, x); returns NULL when a column has no variance.
      selects.push(`corr(${quoteIdent(cols[i]!)}, ${quoteIdent(cols[j]!)}) AS ${key}`);
      pairKeys.push({ i, j, key });
    }
  }
  const row = (await runQuery(`SELECT ${selects.join(", ")} FROM ${ident}`))[0] as QueryRow | undefined;
  for (const { i, j, key } of pairKeys) {
    const v = toNum(row?.[key]);
    matrix[i]![j] = v;
    matrix[j]![i] = v;
  }
  return { columns: cols, matrix };
}

// ---- Category ↔ numeric association (correlation ratio η²) ----

export interface CategoryNumericAssoc {
  category: string;
  numeric: string;
  eta2: number; // 0..1 (share of numeric variance explained by the category)
}

export async function computeCategoryNumericAssociation(
  tableName: string,
  catCols: string[],
  numCols: string[],
): Promise<CategoryNumericAssoc[]> {
  const ident = quoteIdent(tableName);
  const out: CategoryNumericAssoc[] = [];
  for (const cat of catCols) {
    const catId = quoteIdent(cat);
    for (const num of numCols) {
      const numId = quoteIdent(num);
      // η² = SS_between / SS_total.
      // SS_total = Σx² − n·grandMean²; SS_between = Σ n_g·(mean_g − grandMean)².
      const sql = `
        WITH base AS (
          SELECT ${catId} AS k, ${numId} AS x
          FROM ${ident}
          WHERE ${numId} IS NOT NULL AND ${catId} IS NOT NULL
        ),
        o AS (SELECT COUNT(*) AS n, AVG(x) AS m, SUM(x*x) AS sxx FROM base),
        g AS (SELECT k, COUNT(*) AS n_g, AVG(x) AS m_g FROM base GROUP BY k)
        SELECT
          (SELECT SUM(n_g * (m_g - (SELECT m FROM o)) * (m_g - (SELECT m FROM o))) FROM g) AS ss_between,
          ((SELECT sxx FROM o) - (SELECT n FROM o) * (SELECT m FROM o) * (SELECT m FROM o)) AS ss_total
      `;
      const row = (await runQuery(sql))[0] as QueryRow | undefined;
      const ssBetween = toNum(row?.ss_between);
      const ssTotal = toNum(row?.ss_total);
      if (ssBetween === null || ssTotal === null || ssTotal <= 0) continue;
      const eta2 = Math.max(0, Math.min(1, ssBetween / ssTotal));
      out.push({ category: cat, numeric: num, eta2 });
    }
  }
  out.sort((a, b) => b.eta2 - a.eta2);
  return out;
}

// ---- Data-quality flags (pure JS over existing column profiles) ----

export type QualitySeverity = "high" | "medium" | "low";

export interface QualityFlag {
  column: string;
  severity: QualitySeverity;
  message: string;
}

const SEVERITY_RANK: Record<QualitySeverity, number> = { high: 0, medium: 1, low: 2 };

export function detectDataQualityFlags(rowCount: number, columns: ColumnProfile[]): QualityFlag[] {
  const flags: QualityFlag[] = [];
  for (const col of columns) {
    if (col.nullRatio > 0.5) {
      flags.push({ column: col.name, severity: "high", message: `缺失率 ${(col.nullRatio * 100).toFixed(1)}%` });
    } else if (col.nullRatio > 0.3) {
      flags.push({ column: col.name, severity: "medium", message: `缺失率偏高 ${(col.nullRatio * 100).toFixed(1)}%` });
    }
    if (col.distinctCount === 1) {
      flags.push({ column: col.name, severity: "high", message: "恒定列（仅 1 个唯一值）" });
    } else if (col.kind !== "id" && rowCount >= 10 && col.distinctCount / rowCount > 0.95) {
      flags.push({ column: col.name, severity: "medium", message: `近似唯一（独立值占比 ${((col.distinctCount / rowCount) * 100).toFixed(0)}%，疑似 ID/无聚合价值）` });
    }
    if (col.kind === "number") {
      if (col.outlierCount !== undefined && col.outlierCount !== null && rowCount > 0 && col.outlierCount / rowCount > 0.1) {
        flags.push({ column: col.name, severity: "medium", message: `离群点占比 ${((col.outlierCount / rowCount) * 100).toFixed(1)}%（IQR 法）` });
      }
      const { mean, median, stddev } = col;
      if (mean != null && median != null && stddev != null && stddev > 0 && Math.abs(mean - median) / stddev > 1) {
        flags.push({ column: col.name, severity: "low", message: "分布强偏斜（均值与中位差异大）" });
      }
    }
  }
  flags.sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity]);
  return flags;
}
