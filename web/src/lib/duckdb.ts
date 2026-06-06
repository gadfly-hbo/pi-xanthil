// LLM_FORBIDDEN: this module must never call any LLM API.
// duckdb-wasm singleton loaded lazily on first use.
// All computation happens in the browser; data never leaves the local machine.

import type { AsyncDuckDB, AsyncDuckDBConnection } from "@duckdb/duckdb-wasm";

let dbPromise: Promise<AsyncDuckDB> | null = null;

async function initDuckDB(): Promise<AsyncDuckDB> {
  const duckdb = await import("@duckdb/duckdb-wasm");
  const bundles = duckdb.getJsDelivrBundles();
  const bundle = await duckdb.selectBundle(bundles);
  const workerUrl = URL.createObjectURL(
    new Blob([`importScripts("${bundle.mainWorker!}");`], { type: "text/javascript" }),
  );
  const worker = new Worker(workerUrl);
  const logger = new duckdb.ConsoleLogger(duckdb.LogLevel.WARNING);
  const db = new duckdb.AsyncDuckDB(logger, worker);
  await db.instantiate(bundle.mainModule, bundle.pthreadWorker);
  URL.revokeObjectURL(workerUrl);
  return db;
}

export async function getDuckDB(): Promise<AsyncDuckDB> {
  if (!dbPromise) dbPromise = initDuckDB();
  return dbPromise;
}

export async function openConnection(): Promise<AsyncDuckDBConnection> {
  const db = await getDuckDB();
  return db.connect();
}

export interface RegisterFileOptions {
  tableName: string;
  fileName: string;
  bytes: Uint8Array;
  sheetName?: string;
}

export interface RegisterFileResult {
  tableName: string;
  rowCount: number;
  columns: { name: string; sqlType: string }[];
  sheets?: string[];
}

function escapeIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

async function registerCsv(
  conn: AsyncDuckDBConnection,
  db: AsyncDuckDB,
  options: RegisterFileOptions,
): Promise<RegisterFileResult> {
  const virtualName = `__upload_${Date.now()}_${options.fileName}`;
  await db.registerFileBuffer(virtualName, options.bytes);
  const ident = escapeIdent(options.tableName);
  await conn.query(`DROP TABLE IF EXISTS ${ident}`);
  await conn.query(
    `CREATE TABLE ${ident} AS SELECT * FROM read_csv_auto('${virtualName}', SAMPLE_SIZE=-1, ALL_VARCHAR=FALSE)`,
  );
  return finalizeTable(conn, options.tableName);
}

async function registerXlsx(
  conn: AsyncDuckDBConnection,
  options: RegisterFileOptions,
): Promise<RegisterFileResult> {
  const XLSX = await import("xlsx");
  const workbook = XLSX.read(options.bytes, { type: "array" });
  const sheets = workbook.SheetNames;
  if (sheets.length === 0) throw new Error("xlsx has no sheets");
  const sheetName = options.sheetName && sheets.includes(options.sheetName)
    ? options.sheetName
    : sheets[0]!;
  const sheet = workbook.Sheets[sheetName]!;
  const json = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: null, raw: true });
  const ident = escapeIdent(options.tableName);
  await conn.query(`DROP TABLE IF EXISTS ${ident}`);
  if (json.length === 0) {
    await conn.query(`CREATE TABLE ${ident} (placeholder VARCHAR)`);
    const result = await finalizeTable(conn, options.tableName);
    return { ...result, sheets };
  }
  const columns = Array.from(
    json.reduce<Set<string>>((set, row) => {
      Object.keys(row).forEach((key) => set.add(key));
      return set;
    }, new Set<string>()),
  );
  const normalizedRows = json.map((row) => {
    const out: Record<string, unknown> = {};
    for (const col of columns) {
      const value = row[col];
      out[col] = value === undefined ? null : value;
    }
    return out;
  });
  const jsonText = JSON.stringify(normalizedRows);
  const virtualName = `__upload_${Date.now()}_${options.fileName}.json`;
  await conn.bindings.registerFileText(virtualName, jsonText);
  await conn.query(
    `CREATE TABLE ${ident} AS SELECT * FROM read_json_auto('${virtualName}', maximum_object_size=104857600)`,
  );
  const result = await finalizeTable(conn, options.tableName);
  return { ...result, sheets };
}

async function finalizeTable(
  conn: AsyncDuckDBConnection,
  tableName: string,
): Promise<RegisterFileResult> {
  const ident = escapeIdent(tableName);
  const describe = await conn.query(`DESCRIBE ${ident}`);
  const columns = describe
    .toArray()
    .map((row: { column_name?: string; column_type?: string; name?: string; type?: string }) => ({
      name: String(row.column_name ?? row.name ?? ""),
      sqlType: String(row.column_type ?? row.type ?? ""),
    }))
    .filter((col) => col.name);
  const countResult = await conn.query(`SELECT COUNT(*) AS c FROM ${ident}`);
  const rowCount = Number(countResult.toArray()[0]?.c ?? 0);
  return { tableName, rowCount, columns };
}

export async function registerFile(options: RegisterFileOptions): Promise<RegisterFileResult> {
  const conn = await openConnection();
  try {
    const ext = options.fileName.toLowerCase().split(".").pop() ?? "";
    if (ext === "csv" || ext === "tsv") {
      return await registerCsv(conn, await getDuckDB(), options);
    }
    if (ext === "xlsx" || ext === "xls") {
      return await registerXlsx(conn, options);
    }
    throw new Error(`unsupported file extension: ${ext}`);
  } finally {
    await conn.close();
  }
}

export type QueryRow = Record<string, unknown>;

export async function runQuery(sql: string): Promise<QueryRow[]> {
  const conn = await openConnection();
  try {
    const result = await conn.query(sql);
    return result.toArray().map((row) => ({ ...row })) as QueryRow[];
  } finally {
    await conn.close();
  }
}

export function quoteIdent(name: string): string {
  return escapeIdent(name);
}

export function quoteString(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}
