/**
 * SQLite database connection wrapper.
 *
 * Contract (workcanger-absorption-contract.md WCA-01, schema-v1-and-migrations.md):
 * - Database: ${XANTHIL_DATA_DIR}/analysis-projects/workcanger.sqlite
 * - PRAGMA foreign_keys = ON must be enabled on every connection.
 * - All business IDs: lowercase UUID v4 TEXT.
 * - Time: UTC RFC 3339 TEXT.
 * - SHA-256: 64-char lowercase hex TEXT.
 */
import { DatabaseSync } from "node:sqlite";
import type { DataRootLayout } from "./data-root.ts";

export class DatabaseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DatabaseError";
  }
}

export interface OpenDatabaseOptions {
  /** Open in read-only mode (default false). */
  readOnly?: boolean;
}

/**
 * Open a SQLite database connection.
 * Always enables PRAGMA foreign_keys = ON.
 * When readOnly is true, the database is opened via DatabaseSync's readOnly
 * option so that write operations are rejected at the SQLite layer.
 */
export function openDatabase(
  sqlitePath: string,
  options?: OpenDatabaseOptions,
): DatabaseSync {
  const db = new DatabaseSync(sqlitePath, { readOnly: options?.readOnly });

  // Critical: enable foreign key enforcement on every connection.
  // This pragma works in both read-write and read-only modes.
  db.exec("PRAGMA foreign_keys = ON");

  if (!options?.readOnly) {
    // Use WAL for better concurrency (single-writer, but readers don't block).
    // WAL mode cannot be set in read-only mode (it requires a write).
    db.exec("PRAGMA journal_mode = WAL");
  }

  return db;
}

/**
 * Open the database from a data-root layout.
 */
export function openDatabaseFromLayout(
  layout: DataRootLayout,
  options?: OpenDatabaseOptions,
): DatabaseSync {
  return openDatabase(layout.sqlitePath, options);
}

/**
 * Run PRAGMA foreign_key_check and return any violations.
 * Returns empty array if all FK constraints are satisfied.
 */
export function foreignKeyCheck(db: DatabaseSync): Array<{
  table: string;
  rowid: number;
  parent: string;
  fkid: number;
}> {
  const rows = db
    .prepare(
      "PRAGMA foreign_key_check",
    )
    .all() as Array<{ table: string; rowid: number; parent: string; fkid: number }>;
  return rows;
}

/**
 * Assert that foreign_key_check passes (no violations).
 * Throws DatabaseError if violations exist.
 */
export function assertForeignKeyIntegrity(db: DatabaseSync): void {
  const violations = foreignKeyCheck(db);
  if (violations.length > 0) {
    const details = violations
      .map((v) => `${v.table} rowid=${v.rowid} -> ${v.parent} fkid=${v.fkid}`)
      .join("; ");
    throw new DatabaseError(
      `Foreign key check failed (${violations.length} violations): ${details}`,
    );
  }
}

/**
 * List all user tables (excluding sqlite_* internal tables).
 */
export function listTables(db: DatabaseSync): string[] {
  const rows = db
    .prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
    )
    .all() as Array<{ name: string }>;
  return rows.map((r) => r.name);
}

/**
 * List all indexes for a given table.
 */
export function listIndexes(db: DatabaseSync, tableName: string): string[] {
  const rows = db
    .prepare(
      "SELECT name FROM sqlite_master WHERE type='index' AND tbl_name=? ORDER BY name",
    )
    .all(tableName) as Array<{ name: string }>;
  return rows.map((r) => r.name);
}

/**
 * List all indexes in the database.
 */
export function listAllIndexes(db: DatabaseSync): string[] {
  const rows = db
    .prepare(
      "SELECT name FROM sqlite_master WHERE type='index' AND name NOT LIKE 'sqlite_%' ORDER BY name",
    )
    .all() as Array<{ name: string }>;
  return rows.map((r) => r.name);
}
