// LLM_FORBIDDEN: this module must never call any LLM API.
// Cross-table joins for data exploration. A join is materialized into a real
// duckdb table so the rest of the BI pipeline (profiling / charts / insights)
// can treat it as a normal single table. Pure SQL; nothing leaves the browser.

import { quoteIdent, runQuery, type QueryRow } from "./duckdb";
import type { FieldSchema, FieldKind } from "./profiling";

export type JoinType = "inner" | "left";

// One chained step: join `table` onto an already-present `leftTable`.
export interface JoinStep {
  table: string;
  leftTable: string;
  leftColumn: string;
  rightColumn: string;
  type: JoinType;
}

function joinKeyword(type: JoinType): string {
  return type === "left" ? "LEFT JOIN" : "JOIN";
}

/**
 * Materialize a chained join into a new `__joined_<ts>` table and return its name.
 * Column-name collisions across tables are disambiguated as "<table>.<col>".
 */
export async function materializeJoin(
  baseTable: string,
  steps: JoinStep[],
  tableColumns: Record<string, string[]>,
): Promise<string> {
  const orderedTables = [baseTable, ...steps.map((s) => s.table)];

  // Build SELECT list with collision-safe aliases.
  const seen = new Set<string>();
  const selectParts: string[] = [];
  for (const table of orderedTables) {
    for (const col of tableColumns[table] ?? []) {
      const alias = seen.has(col) ? `${table}.${col}` : col;
      seen.add(col);
      selectParts.push(`${quoteIdent(table)}.${quoteIdent(col)} AS ${quoteIdent(alias)}`);
    }
  }
  if (selectParts.length === 0) throw new Error("no columns to select for join");

  const fromParts: string[] = [quoteIdent(baseTable)];
  for (const step of steps) {
    fromParts.push(
      `${joinKeyword(step.type)} ${quoteIdent(step.table)} ` +
        `ON ${quoteIdent(step.leftTable)}.${quoteIdent(step.leftColumn)} = ` +
        `${quoteIdent(step.table)}.${quoteIdent(step.rightColumn)}`,
    );
  }

  const newName = `__joined_${Date.now()}`;
  await runQuery(
    `CREATE TABLE ${quoteIdent(newName)} AS SELECT ${selectParts.join(", ")} FROM ${fromParts.join(" ")}`,
  );
  return newName;
}

// ---- Join-candidate detection (distinct-value overlap) ----

export interface JoinCandidate {
  leftTable: string;
  leftColumn: string;
  rightTable: string;
  rightColumn: string;
  overlap: number; // |distinct(A) ∩ distinct(B)| / min(|distinct A|, |distinct B|)
}

const JOINABLE_KINDS: ReadonlySet<FieldKind> = new Set<FieldKind>(["id", "category", "number", "boolean"]);

function normalizeName(name: string): string {
  return name.toLowerCase().replace(/[\s_-]/g, "");
}

// Likely a key pair if names match/contain, or both end in id with similar names.
function namesLookRelated(a: string, b: string): boolean {
  const na = normalizeName(a);
  const nb = normalizeName(b);
  if (na.length < 2 || nb.length < 2) return false;
  return na === nb || na.includes(nb) || nb.includes(na);
}

export async function detectJoinCandidates(
  tables: { tableName: string; fields: FieldSchema[] }[],
  minOverlap = 0.3,
): Promise<JoinCandidate[]> {
  const candidates: JoinCandidate[] = [];
  for (let i = 0; i < tables.length; i++) {
    for (let j = i + 1; j < tables.length; j++) {
      const a = tables[i]!;
      const b = tables[j]!;
      for (const fa of a.fields) {
        if (!JOINABLE_KINDS.has(fa.kind)) continue;
        for (const fb of b.fields) {
          if (!JOINABLE_KINDS.has(fb.kind)) continue;
          if (!namesLookRelated(fa.name, fb.name)) continue;
          const overlap = await distinctOverlap(a.tableName, fa.name, b.tableName, fb.name);
          if (overlap >= minOverlap) {
            candidates.push({
              leftTable: a.tableName,
              leftColumn: fa.name,
              rightTable: b.tableName,
              rightColumn: fb.name,
              overlap,
            });
          }
        }
      }
    }
  }
  candidates.sort((x, y) => y.overlap - x.overlap);
  return candidates;
}

async function distinctOverlap(
  ta: string,
  ca: string,
  tb: string,
  cb: string,
): Promise<number> {
  // Cast to VARCHAR so overlap works across differing column types.
  const sql = `
    WITH a AS (SELECT DISTINCT CAST(${quoteIdent(ca)} AS VARCHAR) AS v FROM ${quoteIdent(ta)} WHERE ${quoteIdent(ca)} IS NOT NULL),
         b AS (SELECT DISTINCT CAST(${quoteIdent(cb)} AS VARCHAR) AS v FROM ${quoteIdent(tb)} WHERE ${quoteIdent(cb)} IS NOT NULL)
    SELECT
      (SELECT COUNT(*) FROM a) AS da,
      (SELECT COUNT(*) FROM b) AS db,
      (SELECT COUNT(*) FROM a JOIN b USING (v)) AS inter
  `;
  const row = (await runQuery(sql))[0] as QueryRow | undefined;
  const da = Number(row?.da ?? 0);
  const db = Number(row?.db ?? 0);
  const inter = Number(row?.inter ?? 0);
  const denom = Math.min(da, db);
  return denom > 0 ? inter / denom : 0;
}
