import { existsSync, readFileSync, writeFileSync, mkdirSync, appendFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { Client as PgClient } from "pg";
import mysql from "mysql2/promise";
import { SQL_CONNECTIONS_PATH } from "./config.ts";

export type DbType = "sqlite" | "postgresql" | "mysql";

export type RiskLevel = "L0" | "L1" | "L2" | "L3";

export interface SqlValidateResult {
  safe: boolean;
  risks: string[];
  suggestions: string[];
  riskLevel: RiskLevel;
}

export interface ToolParameter {
  name: string;
  label: string;
  type: "string" | "number" | "boolean" | "select" | "date";
  required?: boolean;
  default?: string | number | boolean;
  options?: string[];
  description?: string;
}

export interface SavedQuery {
  id: string;
  name: string;
  sql: string;
  description?: string;
  parameters?: ToolParameter[];
}

export interface SqlConnection {
  id: string;
  name: string;
  type: DbType;
  filePath?: string;   // sqlite
  host?: string;
  port?: number;
  database?: string;
  username?: string;
  password?: string;
  ssl?: boolean;
  lastTestedAt?: number;
  lastTestOk?: boolean;
  createdAt: number;
  queries?: SavedQuery[];
}

export interface SchemaColumn {
  name: string;
  type: string;
  nullable: boolean;
}

export interface SchemaTable {
  schema?: string;
  name: string;
  columns: SchemaColumn[];
}

export interface QueryResult {
  columns: string[];
  rows: Record<string, unknown>[];
  rowCount: number;
  executionMs: number;
  capped: boolean;
  summary?: QuerySummary;
}

export interface QuerySummary {
  numericColumns: Array<{ name: string; min: number; max: number; avg: number; sum: number }>;
  categoricalColumns: Array<{ name: string; uniqueCount: number; topValue: string }>;
  dateRange?: { min: string; max: string };
}

// ---- connection storage ----

function load(): SqlConnection[] {
  if (!existsSync(SQL_CONNECTIONS_PATH)) return [];
  try {
    return JSON.parse(readFileSync(SQL_CONNECTIONS_PATH, "utf8")) as SqlConnection[];
  } catch {
    return [];
  }
}

function save(conns: SqlConnection[]): void {
  writeFileSync(SQL_CONNECTIONS_PATH, JSON.stringify(conns, null, 2));
}

export function listConnections(): SqlConnection[] {
  return load();
}

export function getConnection(id: string): SqlConnection | null {
  return load().find((c) => c.id === id) ?? null;
}

export function upsertConnection(data: Omit<SqlConnection, "id" | "createdAt"> & { id?: string }): SqlConnection {
  const conns = load();
  const existing = data.id ? conns.find((c) => c.id === data.id) : null;
  const conn: SqlConnection = {
    ...data,
    id: existing?.id ?? randomUUID(),
    createdAt: existing?.createdAt ?? Date.now(),
  };
  const next = existing ? conns.map((c) => (c.id === conn.id ? conn : c)) : [...conns, conn];
  save(next);
  return conn;
}

export function deleteConnection(id: string): boolean {
  const conns = load();
  const next = conns.filter((c) => c.id !== id);
  if (next.length === conns.length) return false;
  save(next);
  return true;
}

function updateTestResult(id: string, ok: boolean): void {
  const conns = load();
  save(conns.map((c) => c.id === id ? { ...c, lastTestedAt: Date.now(), lastTestOk: ok } : c));
}

// ---- connection helpers ----

async function withPg<T>(conn: SqlConnection, fn: (client: PgClient) => Promise<T>): Promise<T> {
  const client = new PgClient({
    host: conn.host ?? "localhost",
    port: conn.port ?? 5432,
    database: conn.database,
    user: conn.username,
    password: conn.password,
    ssl: conn.ssl ? { rejectUnauthorized: false } : false,
    connectionTimeoutMillis: 10_000,
    query_timeout: 60_000,
  });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end().catch(() => undefined);
  }
}

async function withMysql<T>(conn: SqlConnection, fn: (c: mysql.Connection) => Promise<T>): Promise<T> {
  const c = await mysql.createConnection({
    host: conn.host ?? "localhost",
    port: conn.port ?? 3306,
    database: conn.database,
    user: conn.username,
    password: conn.password,
    ssl: conn.ssl ? {} : undefined,
    connectTimeout: 10_000,
  });
  try {
    return await fn(c);
  } finally {
    await c.end().catch(() => undefined);
  }
}

function withSqlite<T>(conn: SqlConnection, fn: (db: DatabaseSync) => T): T {
  const db = new DatabaseSync(conn.filePath ?? ":memory:");
  try {
    return fn(db);
  } finally {
    db.close();
  }
}

// ---- test connection ----

export async function testConnection(conn: SqlConnection): Promise<{ ok: boolean; message: string; latencyMs: number }> {
  const start = Date.now();
  try {
    if (conn.type === "sqlite") {
      withSqlite(conn, (db) => db.prepare("SELECT 1").get());
    } else if (conn.type === "postgresql") {
      await withPg(conn, async (client) => {
        await client.query("SELECT 1");
      });
    } else {
      await withMysql(conn, async (c) => {
        await c.execute("SELECT 1");
      });
    }
    const latencyMs = Date.now() - start;
    updateTestResult(conn.id, true);
    return { ok: true, message: "连接成功", latencyMs };
  } catch (err) {
    updateTestResult(conn.id, false);
    return { ok: false, message: String(err), latencyMs: Date.now() - start };
  }
}

// ---- schema ----

async function pgSchema(conn: SqlConnection): Promise<SchemaTable[]> {
  return withPg(conn, async (client) => {
    const tablesRes = await client.query<{ table_schema: string, table_name: string }>(
      `SELECT table_schema, table_name FROM information_schema.tables
       WHERE table_schema NOT IN ('pg_catalog', 'information_schema') AND table_type = 'BASE TABLE'
       ORDER BY table_schema, table_name`,
    );
    const tables: SchemaTable[] = [];
    for (const row of tablesRes.rows) {
      const colsRes = await client.query<{ column_name: string; data_type: string; is_nullable: string }>(
        `SELECT column_name, data_type, is_nullable
         FROM information_schema.columns
         WHERE table_schema = $1 AND table_name = $2
         ORDER BY ordinal_position`,
        [row.table_schema, row.table_name],
      );
      tables.push({
        schema: row.table_schema,
        name: row.table_name,
        columns: colsRes.rows.map((c) => ({ name: c.column_name, type: c.data_type, nullable: c.is_nullable === "YES" })),
      });
    }
    return tables;
  });
}

async function mysqlSchema(conn: SqlConnection): Promise<SchemaTable[]> {
  return withMysql(conn, async (c) => {
    const [tableRows] = await c.execute<mysql.RowDataPacket[]>("SHOW TABLES");
    const tables: SchemaTable[] = [];
    for (const row of tableRows) {
      const tableName = String(Object.values(row)[0]);
      const [colRows] = await c.execute<mysql.RowDataPacket[]>(`DESCRIBE \`${tableName}\``);
      tables.push({
        name: tableName,
        columns: colRows.map((r) => ({ name: String(r.Field), type: String(r.Type), nullable: r.Null === "YES" })),
      });
    }
    return tables;
  });
}

function sqliteSchema(conn: SqlConnection): SchemaTable[] {
  return withSqlite(conn, (db) => {
    const tableRows = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
    ).all() as { name: string }[];
    return tableRows.map((t) => {
      const cols = db.prepare(`PRAGMA table_info("${t.name}")`).all() as {
        name: string; type: string; notnull: number;
      }[];
      return {
        name: t.name,
        columns: cols.map((c) => ({ name: c.name, type: c.type || "text", nullable: c.notnull === 0 })),
      };
    });
  });
}

export async function getSchema(conn: SqlConnection): Promise<SchemaTable[]> {
  if (conn.type === "sqlite") return sqliteSchema(conn);
  if (conn.type === "postgresql") return pgSchema(conn);
  return mysqlSchema(conn);
}

export function prepareSql(connType: DbType, sql: string, params?: Record<string, unknown>): { text: string; values: unknown[] } {
  if (!params || Object.keys(params).length === 0) return { text: sql, values: [] };
  const values: unknown[] = [];
  let paramIndex = 1;
  const text = sql.replace(/\{\{([a-zA-Z0-9_]+)\}\}/g, (_, key) => {
    values.push(params[key] ?? null);
    if (connType === "postgresql") return `$${paramIndex++}`;
    return "?";
  });
  return { text, values };
}

// ---- SQL validation ----

const DANGEROUS_KEYWORDS = [
  "DROP", "DELETE", "UPDATE", "INSERT", "ALTER", "CREATE", "TRUNCATE",
  "GRANT", "REVOKE", "EXEC", "EXECUTE", "MERGE", "REPLACE",
];

const WARNING_PATTERNS: Array<{ pattern: RegExp; message: string }> = [
  { pattern: /\bSELECT\s+\*\b/i, message: "SELECT * 可能导致大量数据传输，建议指定具体列" },
  { pattern: /\bFROM\s+\w+\s*$/i, message: "缺少 LIMIT 子句，可能返回大量数据" },
  { pattern: /\bCROSS\s+JOIN\b/i, message: "CROSS JOIN 可能产生笛卡尔积，请确认意图" },
  { pattern: /\bLIKE\s+'%[^']*%'/i, message: "前缀通配 LIKE 查询可能无法使用索引" },
];

export function validateSql(sql: string): SqlValidateResult {
  const risks: string[] = [];
  const suggestions: string[] = [];
  const upperSql = sql.toUpperCase().trim();

  for (const kw of DANGEROUS_KEYWORDS) {
    const regex = new RegExp(`\\b${kw}\\b`, "i");
    if (regex.test(upperSql)) {
      risks.push(`检测到危险操作: ${kw}`);
    }
  }

  for (const { pattern, message } of WARNING_PATTERNS) {
    if (pattern.test(sql)) {
      suggestions.push(message);
    }
  }

  if (upperSql.startsWith("SELECT") && !/\bLIMIT\b/i.test(upperSql)) {
    suggestions.push("建议添加 LIMIT 子句限制返回行数");
  }

  const safe = risks.length === 0;
  const riskLevel: RiskLevel = safe ? "L1" : "L3";

  return { safe, risks, suggestions, riskLevel };
}

// ---- query ----

const PREVIEW_CAP = 500;

function serializeRow(row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) {
    if (v instanceof Date) out[k] = v.toISOString();
    else if (typeof v === "bigint") out[k] = v.toString();
    else if (Buffer.isBuffer(v)) out[k] = `<binary ${v.length}B>`;
    else out[k] = v;
  }
  return out;
}

async function pgQuery(conn: SqlConnection, sql: string, params: unknown[], cap: number): Promise<QueryResult> {
  return withPg(conn, async (client) => {
    const start = Date.now();
    const res = await client.query(sql, params);
    const executionMs = Date.now() - start;
    const columns = res.fields.map((f) => f.name);
    const allRows = res.rows.map((r) => serializeRow(r as Record<string, unknown>));
    return { columns, rows: allRows.slice(0, cap), rowCount: allRows.length, executionMs, capped: allRows.length > cap };
  });
}

async function mysqlQuery(conn: SqlConnection, sql: string, params: unknown[], cap: number): Promise<QueryResult> {
  return withMysql(conn, async (c) => {
    const start = Date.now();
    const [rows, fields] = await c.execute<mysql.RowDataPacket[]>(sql, params as any[]);
    const executionMs = Date.now() - start;
    const columns = (fields as mysql.FieldPacket[]).map((f) => f.name ?? "");
    const allRows = rows.map((r) => serializeRow(r as Record<string, unknown>));
    return { columns, rows: allRows.slice(0, cap), rowCount: allRows.length, executionMs, capped: allRows.length > cap };
  });
}

function sqliteQuery(conn: SqlConnection, sql: string, params: unknown[], cap: number): QueryResult {
  return withSqlite(conn, (db) => {
    const start = Date.now();
    const stmt = db.prepare(sql);
    const allRows = stmt.all(...(params as any[])) as Record<string, unknown>[];
    const executionMs = Date.now() - start;
    const columns = allRows.length > 0 ? Object.keys(allRows[0]!) : [];
    return { columns, rows: allRows.slice(0, cap), rowCount: allRows.length, executionMs, capped: allRows.length > cap };
  });
}

export async function executeQuery(conn: SqlConnection, sql: string, cap = PREVIEW_CAP, params?: Record<string, unknown>): Promise<QueryResult> {
  const { text, values } = prepareSql(conn.type, sql, params);
  let result: QueryResult;
  if (conn.type === "sqlite") result = sqliteQuery(conn, text, values, cap);
  else if (conn.type === "postgresql") result = await pgQuery(conn, text, values, cap);
  else result = await mysqlQuery(conn, text, values, cap);
  result.summary = computeSummary(result);
  return result;
}

function computeSummary(result: QueryResult): QuerySummary | undefined {
  if (result.rows.length === 0 || result.columns.length === 0) return undefined;
  const numericColumns: QuerySummary["numericColumns"] = [];
  const categoricalColumns: QuerySummary["categoricalColumns"] = [];
  let dateRange: QuerySummary["dateRange"] | undefined;

  for (const col of result.columns) {
    const values = result.rows.map((r) => r[col]);
    const nonNull = values.filter((v) => v !== null && v !== undefined);

    if (nonNull.length === 0) continue;

    if (nonNull.every((v) => typeof v === "number" && Number.isFinite(v))) {
      const nums = nonNull as number[];
      numericColumns.push({
        name: col,
        min: Math.min(...nums),
        max: Math.max(...nums),
        avg: nums.reduce((a, b) => a + b, 0) / nums.length,
        sum: nums.reduce((a, b) => a + b, 0),
      });
    } else if (nonNull.some((v) => v instanceof Date || (typeof v === "string" && !Number.isNaN(Date.parse(v))))) {
      const dates = nonNull
        .map((v) => (v instanceof Date ? v : new Date(v as string)))
        .filter((d) => !Number.isNaN(d.getTime()))
        .sort((a, b) => a.getTime() - b.getTime());
      if (dates.length > 0) {
        dateRange = {
          min: dates[0]!.toISOString().slice(0, 10),
          max: dates[dates.length - 1]!.toISOString().slice(0, 10),
        };
      }
    } else {
      const freq = new Map<string, number>();
      for (const v of nonNull) {
        const key = String(v);
        freq.set(key, (freq.get(key) ?? 0) + 1);
      }
      let topValue = "";
      let topCount = 0;
      for (const [k, c] of freq) {
        if (c > topCount) { topValue = k; topCount = c; }
      }
      categoricalColumns.push({ name: col, uniqueCount: freq.size, topValue });
    }
  }

  return { numericColumns, categoricalColumns, dateRange };
}

// ---- export to CSV ----

function toCsvRow(values: unknown[]): string {
  return values.map((v) => {
    if (v === null || v === undefined) return "";
    const s = String(v);
    return s.includes(",") || s.includes('"') || s.includes("\n") ? `"${s.replace(/"/g, '""')}"` : s;
  }).join(",");
}

export interface WatermarkConfig {
  column: string;
  initialValue?: unknown;
}

export async function exportQueryToCsv(
  conn: SqlConnection,
  sql: string,
  outputPath: string,
  params?: Record<string, unknown>,
  watermark?: WatermarkConfig
): Promise<{ rowCount: number, appended: boolean }> {
  let finalSql = sql;
  const statePath = `${outputPath}.state`;
  const appending = !!watermark && existsSync(outputPath) && existsSync(statePath);
  let effectiveParams = params ?? {};

  let watermarkVal: unknown = undefined;
  if (appending) {
    try {
      const state = JSON.parse(readFileSync(statePath, "utf8")) as { lastWatermark?: unknown };
      watermarkVal = state.lastWatermark;
    } catch { /* ignore */ }
  } else if (watermark && watermark.initialValue !== undefined && watermark.initialValue !== "") {
    watermarkVal = watermark.initialValue;
  }

  if (watermark && watermarkVal !== undefined && watermarkVal !== null) {
    finalSql = `SELECT * FROM (${sql}) AS __watermark_wrapper WHERE __watermark_wrapper.${watermark.column} > {{__last_watermark}} ORDER BY __watermark_wrapper.${watermark.column} ASC`;
    effectiveParams = { ...effectiveParams, __last_watermark: watermarkVal };
  } else if (watermark) {
    finalSql = `SELECT * FROM (${sql}) AS __watermark_wrapper ORDER BY __watermark_wrapper.${watermark.column} ASC`;
  }

  const result = await executeQuery(conn, finalSql, Infinity as unknown as number, effectiveParams);

  if (result.rowCount === 0) {
    return { rowCount: 0, appended: appending };
  }

  if (watermark) {
    const maxWatermark = result.rows[result.rows.length - 1]?.[watermark.column];
    if (maxWatermark !== undefined) {
      writeFileSync(statePath, JSON.stringify({ lastWatermark: maxWatermark }), "utf8");
    }
  }

  const lines = appending ? [] : [toCsvRow(result.columns)];
  lines.push(...result.rows.map((row) => toCsvRow(result.columns.map((col) => row[col]))));
  
  const content = (appending ? "\n" : "﻿") + lines.join("\n");
  const { dirname } = await import("node:path");
  mkdirSync(dirname(outputPath), { recursive: true });
  
  if (appending) {
    appendFileSync(outputPath, content, "utf8");
  } else {
    writeFileSync(outputPath, content, "utf8");
  }
  return { rowCount: result.rowCount, appended: appending };
}
