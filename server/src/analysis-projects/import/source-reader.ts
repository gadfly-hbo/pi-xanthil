/**
 * Read-only donor source reader with full preflight validation.
 *
 * Contract (T0014 brief requirements 2-4, 6-7, 9):
 * - The source SQLite is opened read-only; no migration, PRAGMA write,
 *   backup, chmod, rename, delete, or any source-side mutation ever runs.
 * - Donor schema/migration versions and checksums are identified and must
 *   exactly match the expected migration set; unknown tables, columns,
 *   enums, or safety classes fail closed.
 * - Source FK integrity, ordinal/event-sequence continuity, and version
 *   chains are validated before any target write.
 * - Every referenced blob is validated for storage_ref shape, existence,
 *   declared byte size, and SHA-256. Blob bytes are only streamed for
 *   hashing - never parsed as JSON, never logged, never sent anywhere.
 */
import { existsSync, statSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { foreignKeyCheck } from "../persistence/db.ts";
import {
  getAppliedMigrations,
  type MigrationFile,
  type MigrationRecord,
} from "../persistence/migration-runner.ts";
import { blobAbsolutePath, blobStorageRef } from "../persistence/blob-writer.ts";
import { canonicalJsonStringify } from "../persistence/canonical-json.ts";
import { sha256Hex } from "../persistence/sha256.ts";
import { buildLayout } from "../persistence/data-root.ts";
import { isSha256Hex, isUuidV4 } from "../application/shared/runtime.ts";
import { ImportError } from "./errors.ts";
import { hashFileStreamingSync } from "./fs-hash.ts";
import {
  TABLE_SPECS,
  buildExpectedSchema,
  sameColumnSet,
  type ColumnShape,
  type OrdinalGroupSpec,
  type TableSpec,
} from "./schema-plan.ts";

export type SourceRow = Record<string, string | number | null>;

/**
 * Fail-closed row accessor: source column presence is guaranteed by the
 * schema preflight, so an undefined value indicates structural drift.
 * Narrows the type for SQL parameter binding (no undefined).
 */
export function rowValue(row: SourceRow, column: string): string | number | null {
  const value = row[column];
  if (value === undefined) {
    throw new ImportError(
      "source_integrity_structure",
      "source_integrity",
      "Source row is missing a contract column.",
    );
  }
  return value;
}

export interface BlobPlanEntry {
  /** Controlled relative storage_ref (blobs/<hex2>/<hex64>). Never logged. */
  readonly ref: string;
  readonly hash: string;
  readonly size: number;
}

export interface SourceData {
  /**
   * SHA-256 over the canonical source identity: schema, per-table ID sets,
   * AND per-table SHA-256 of the canonical full persisted row content. Two
   * source datasets that differ in any persisted non-ID scalar or any
   * persisted content hash/ref produce different fingerprints - so
   * already-imported detection and journal recovery can distinguish real
   * content drift from database churn. Raw row values are never included.
   */
  readonly fingerprint: string;
  readonly appliedMigrations: readonly MigrationRecord[];
  /** Table name -> rows, present for every TABLE_SPECS table. */
  readonly rows: ReadonlyMap<string, readonly SourceRow[]>;
  /** audit_actors rows topologically ordered by registered_by_actor_id. */
  readonly orderedActorIds: readonly string[];
  /** Unique blob references across all storage_ref-carrying tables. */
  readonly blobPlan: ReadonlyMap<string, BlobPlanEntry>;
  readonly tableCounts: Readonly<Record<string, number>>;
  readonly blobCount: number;
  readonly totalBlobBytes: number;
  /** analysis_project_id set (used by recovery and already-imported checks). */
  readonly projectIds: readonly string[];
}

/**
 * Open the donor source read-only and run the complete source preflight.
 * Returns all rows and the blob plan on success; throws ImportError otherwise.
 *
 * @param sourceDataRoot Explicit donor data root (donor layout).
 * @param expectedSourceMigrations Target repo migration files 0001+0002,
 *   byte-identical to donor commit e2807d5 (checksum authority).
 */
export function readAndValidateSource(
  sourceDataRoot: string,
  expectedSourceMigrations: readonly MigrationFile[],
): SourceData {
  const layout = buildLayout(sourceDataRoot);
  assertSourceLayout(sourceDataRoot, layout.sqlitePath, layout.blobsDir);

  let db: DatabaseSync;
  try {
    db = openSourceImmutable(layout.sqlitePath);
  } catch (err) {
    if (err instanceof ImportError) throw err;
    throw new ImportError(
      "source_db_open_failed",
      "source_schema",
      "Source database could not be opened read-only.",
    );
  }

  try {
    const applied = validateSourceMigrations(db, expectedSourceMigrations);
    validateSourceTables(db, expectedSourceMigrations);
    validateSourceForeignKeys(db);

    const rows = new Map<string, readonly SourceRow[]>();
    for (const spec of TABLE_SPECS) {
      rows.set(spec.table, readTableRows(db, spec));
    }

    for (const spec of TABLE_SPECS) {
      const tableRows = rows.get(spec.table)!;
      validateIdentityFormat(spec, tableRows);
      validateEnumDomains(spec, tableRows);
      if (spec.ordinal) {
        validateOrdinalContinuity(spec, tableRows, spec.ordinal);
      }
    }

    const orderedActorIds = orderActorsTopologically(rows.get("audit_actors")!);
    const blobPlan = buildBlobPlan(rows, layout.blobsDir);
    const tableCounts: Record<string, number> = {};
    for (const spec of TABLE_SPECS) {
      tableCounts[spec.table] = rows.get(spec.table)!.length;
    }

    let totalBlobBytes = 0;
    for (const entry of blobPlan.values()) {
      totalBlobBytes += entry.size;
    }


    const projectIds = rows
      .get("analysis_projects")!
      .map((row) => row.analysis_project_id as string)
      .sort();

    const fingerprint = computeSourceFingerprint(applied, rows);

    return {
      fingerprint,
      appliedMigrations: applied,
      rows,
      orderedActorIds,
      blobPlan,
      tableCounts,
      blobCount: blobPlan.size,
      totalBlobBytes,
      projectIds,
    };
  } catch (err) {
    // Corrupt or unreadable source databases fail closed with a safe code;
    // structured ImportErrors pass through unchanged.
    if (err instanceof ImportError) throw err;
    throw new ImportError(
      "source_db_open_failed",
      "source_schema",
      "Source database could not be read; it may be corrupt.",
    );
  } finally {
    db.close();
  }
}

// ---------------------------------------------------------------------------
// Layout, migration, and schema validation
// ---------------------------------------------------------------------------

function assertSourceLayout(root: string, sqlitePath: string, blobsDir: string): void {
  const invalid = () =>
    new ImportError(
      "source_root_invalid",
      "source_schema",
      "Source data root is missing or does not match the donor layout.",
    );
  if (!existsSync(root) || !statSync(root).isDirectory()) throw invalid();
  if (!existsSync(sqlitePath) || !statSync(sqlitePath).isFile()) throw invalid();
  if (!existsSync(blobsDir) || !statSync(blobsDir).isDirectory()) throw invalid();
}

/**
 * Open the source database with SQLite's immutable=1 flag (plus readOnly).
 * A plain readOnly open of a WAL-mode database still creates -shm/-wal
 * files in the source directory, which would be a source-side mutation;
 * immutable=1 performs zero writes and creates zero files.
 *
 * Fail closed if the donor database has uncheckpointed WAL content: with
 * immutable=1 SQLite would silently read the stale main-file image, so a
 * non-empty -wal file means the donor was not cleanly shut down.
 */
export function openSourceImmutable(sqlitePath: string): DatabaseSync {
  const walPath = `${sqlitePath}-wal`;
  if (existsSync(walPath) && statSync(walPath).size > 0) {
    throw new ImportError(
      "source_root_invalid",
      "source_schema",
      "Source database has uncheckpointed WAL data; the donor must be cleanly shut down before import.",
    );
  }
  const uri = `${pathToFileURL(sqlitePath).href}?immutable=1`;
  const db = new DatabaseSync(uri, { readOnly: true });
  db.exec("PRAGMA foreign_keys = ON");
  return db;
}

function validateSourceMigrations(
  db: DatabaseSync,
  expected: readonly MigrationFile[],
): readonly MigrationRecord[] {
  const migrationsTable = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='schema_migrations'")
    .get();
  if (!migrationsTable) {
    throw new ImportError(
      "source_schema_unknown",
      "source_schema",
      "Source database has no schema_migrations table; unknown databases fail closed.",
    );
  }

  const applied = getAppliedMigrations(db);
  const expectedByVersion = new Map(expected.map((m) => [m.version, m]));

  if (applied.length !== expected.length) {
    throw new ImportError(
      "source_schema_drift",
      "source_schema",
      `Source migration set drift: expected ${expected.length} migration(s), found ${applied.length}.`,
    );
  }
  for (const record of applied) {
    const file = expectedByVersion.get(record.version);
    if (!file || file.name !== record.name || file.checksum !== record.checksum) {
      throw new ImportError(
        "source_schema_drift",
        "source_schema",
        `Source migration drift at schema version ${record.version}.`,
      );
    }
  }
  return applied;
}

function validateSourceTables(
  db: DatabaseSync,
  expected: readonly MigrationFile[],
): void {
  const expectedSchema = buildExpectedSchema(expected);
  const actualTables = db
    .prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
    )
    .all() as Array<{ name: string }>;
  const actualNames = new Set(actualTables.map((t) => t.name));

  for (const name of expectedSchema.tables.keys()) {
    if (!actualNames.has(name)) {
      throw new ImportError(
        "source_unknown_table",
        "source_schema",
        "Source database is missing a contract table.",
      );
    }
  }
  for (const name of actualNames) {
    if (!expectedSchema.tables.has(name)) {
      throw new ImportError(
        "source_unknown_table",
        "source_schema",
        "Source database contains an unknown table; unknown schema fails closed.",
      );
    }
  }

  for (const [name, expectedCols] of expectedSchema.tables) {
    const info = db.prepare(`PRAGMA table_info(${name})`).all() as Array<{
      name: string;
      type: string;
      notnull: number;
      pk: number;
    }>;
    const actualCols: ColumnShape[] = info.map((col) => ({
      name: col.name,
      type: col.type.toUpperCase(),
      notNull: col.notnull === 1,
      pk: col.pk > 0,
    }));
    if (!sameColumnSet(expectedCols, actualCols)) {
      throw new ImportError(
        "source_unknown_column",
        "source_schema",
        "Source database column drift on a contract table; unknown columns fail closed.",
      );
    }
  }
}

function validateSourceForeignKeys(db: DatabaseSync): void {
  const violations = foreignKeyCheck(db);
  if (violations.length > 0) {
    throw new ImportError(
      "source_integrity_fk",
      "source_integrity",
      `Source foreign_key_check reports ${violations.length} violation(s).`,
    );
  }
}

// ---------------------------------------------------------------------------
// Row reads and content validation
// ---------------------------------------------------------------------------

function readTableRows(db: DatabaseSync, spec: TableSpec): readonly SourceRow[] {
  const rows = db.prepare(`SELECT * FROM ${spec.table}`).all() as unknown as SourceRow[];
  return rows;
}

function validateIdentityFormat(spec: TableSpec, rows: readonly SourceRow[]): void {
  for (const row of rows) {
    for (const col of spec.identity) {
      if (!isUuidV4(row[col])) {
        throw new ImportError(
          "source_integrity_structure",
          "source_integrity",
          "Source contains a durable ID that is not a canonical UUID v4.",
        );
      }
    }
  }
}

function validateEnumDomains(spec: TableSpec, rows: readonly SourceRow[]): void {
  for (const [column, domain] of Object.entries(spec.enumColumns)) {
    for (const row of rows) {
      const value = row[column];
      if (value === null) continue;
      if (typeof value !== "string" || !domain.includes(value)) {
        if (column === "safety_class") {
          // WCA-03: unknown safety class must fail closed, never downgrade.
          throw new ImportError(
            "source_unknown_safety_class",
            "source_integrity",
            "Source contains an unknown Evidence safety class.",
          );
        }
        throw new ImportError(
          "source_unknown_enum",
          "source_integrity",
          `Source contains an unknown enum value in column ${column}.`,
        );
      }
    }
  }
}

function validateOrdinalContinuity(
  spec: TableSpec,
  rows: readonly SourceRow[],
  ordinal: OrdinalGroupSpec,
): void {
  const fail = () => {
    throw new ImportError(
      "source_integrity_structure",
      "source_integrity",
      `Source ordinal/sequence chain is not contiguous from 1 in table ${spec.table}.`,
    );
  };
  const groups = new Map<string, SourceRow[]>();
  for (const row of rows) {
    const groupKey = String(row[ordinal.groupColumn]);
    const group = groups.get(groupKey) ?? [];
    group.push(row);
    groups.set(groupKey, group);
  }
  for (const group of groups.values()) {
    const sorted = [...group].sort(
      (a, b) => Number(a[ordinal.ordinalColumn]) - Number(b[ordinal.ordinalColumn]),
    );
    for (let i = 0; i < sorted.length; i++) {
      const row = sorted[i]!;
      const expectedOrdinal = i + 1;
      if (row[ordinal.ordinalColumn] !== expectedOrdinal) fail();
      if (ordinal.supersedesColumn && ordinal.identityColumn) {
        const supersedes = row[ordinal.supersedesColumn];
        if (expectedOrdinal === 1) {
          if (supersedes !== null) fail();
        } else {
          const predecessor = sorted[i - 1]!;
          if (supersedes !== predecessor[ordinal.identityColumn]) fail();
        }
      }
    }
  }
}

function orderActorsTopologically(rows: readonly SourceRow[]): readonly string[] {
  const byId = new Map(rows.map((row) => [row.audit_actor_id as string, row]));
  const ordered: string[] = [];
  const placed = new Set<string>();
  let remaining = [...byId.keys()];
  while (remaining.length > 0) {
    const next = remaining.filter((id) => {
      const registeredBy = byId.get(id)!.registered_by_actor_id;
      return registeredBy === null || placed.has(registeredBy as string);
    });
    if (next.length === 0) {
      throw new ImportError(
        "source_integrity_structure",
        "source_integrity",
        "Source audit_actors registration chain is unresolvable.",
      );
    }
    for (const id of next) {
      ordered.push(id);
      placed.add(id);
    }
    remaining = remaining.filter((id) => !placed.has(id));
  }
  return ordered;
}

// ---------------------------------------------------------------------------
// Blob plan
// ---------------------------------------------------------------------------

function buildBlobPlan(
  rows: ReadonlyMap<string, readonly SourceRow[]>,
  sourceBlobsDir: string,
): ReadonlyMap<string, BlobPlanEntry> {
  const plan = new Map<string, BlobPlanEntry>();
  for (const spec of TABLE_SPECS) {
    if (!spec.storageRef) continue;
    const { refColumn, hashColumn, sizeColumn } = spec.storageRef;
    for (const row of rows.get(spec.table)!) {
      const ref = row[refColumn];
      const hash = row[hashColumn];
      if (typeof ref !== "string" || typeof hash !== "string" || !isSha256Hex(hash)) {
        throw new ImportError(
          "blob_ref_invalid",
          "blob",
          "Source contains a malformed blob reference or content hash.",
        );
      }
      // Content-addressed invariant: ref must be exactly derived from the hash.
      // This also enforces the blobs/<hex2>/<hex64> shape and shard match.
      if (ref !== blobStorageRef(hash)) {
        throw new ImportError(
          "blob_ref_invalid",
          "blob",
          "Source blob reference does not match its content address.",
        );
      }
      if (plan.has(ref)) continue;

      let absPath: string;
      try {
        absPath = blobAbsolutePath(sourceBlobsDir, ref);
      } catch {
        throw new ImportError(
          "blob_ref_invalid",
          "blob",
          "Source blob reference violates the controlled-path constraint.",
        );
      }
      if (!existsSync(absPath)) {
        throw new ImportError("blob_missing", "blob", "A referenced source blob is missing.");
      }
      const { size } = statSync(absPath);
      if (sizeColumn !== undefined) {
        const declared = row[sizeColumn];
        if (typeof declared !== "number" || declared !== size) {
          throw new ImportError(
            "blob_size_mismatch",
            "blob",
            "A source blob's byte size does not match its Evidence metadata.",
          );
        }
      }
      const actualHash = hashFileStreamingSync(absPath);
      if (actualHash !== hash) {
        throw new ImportError(
          "blob_hash_mismatch",
          "blob",
          "A source blob's SHA-256 does not match its metadata.",
        );
      }
      plan.set(ref, { ref, hash, size });
    }
  }
  return plan;
}

// ---------------------------------------------------------------------------
// Fingerprint (revision 3 review: includes full canonical row content)
// ---------------------------------------------------------------------------

/**
 * A row reduced to its persisted columns in stable alphabetical order. This
 * canonical form makes the fingerprint sensitive to every persisted field:
 * project title/status/timestamps/actor provenance and report/requirement/
 * plan content_sha256/storage_ref. A change in any persisted non-ID value
 * changes the digest.
 */
function canonicalizeRow(
  row: SourceRow,
  columns: readonly string[],
): Record<string, string | number | null> {
  const out: Record<string, string | number | null> = {};
  for (const col of columns) {
    const v = row[col];
    out[col] = v === undefined ? null : v;
  }
  return out;
}

function computeSourceFingerprint(
  applied: readonly MigrationRecord[],
  rows: ReadonlyMap<string, readonly SourceRow[]>,
): string {
  const tables: Record<string, {
    count: number;
    ids: readonly string[];
    rowsDigest: string;
  }> = {};
  for (const spec of TABLE_SPECS) {
    const tableRows = rows.get(spec.table)!;
    // Stable column order from the first row of the table (rows are guaranteed
    // to share the same column set by the schema preflight). Alphabetical so
    // the order is independent of SQLite's PRAGMA table_info enumeration.
    const columns =
      tableRows.length > 0 ? Object.keys(tableRows[0]!).slice().sort() : [];

    // Deterministic row order: by canonical identity JSON.
    const sorted = [...tableRows].sort((a, b) => {
      const ka = canonicalJsonStringify(spec.identity.map((c) => a[c]));
      const kb = canonicalJsonStringify(spec.identity.map((c) => b[c]));
      return ka < kb ? -1 : ka > kb ? 1 : 0;
    });

    const ids = sorted
      .map((r) => canonicalJsonStringify(spec.identity.map((c) => r[c])))
      .sort();
    const canonicalRows = sorted.map((r) =>
      canonicalJsonStringify(canonicalizeRow(r, columns)),
    );
    const rowsDigest = sha256Hex(canonicalRows.join("\n"));

    tables[spec.table] = { count: sorted.length, ids, rowsDigest };
  }
  const evidenceHashes = [
    ...new Set(rows.get("evidence_artifacts")!.map((row) => row.content_sha256 as string)),
  ].sort();
  const material = canonicalJsonStringify({
    schema: applied.map((r) => ({ version: r.version, name: r.name, checksum: r.checksum })),
    tables,
    evidence_hashes: evidenceHashes,
  });
  return sha256Hex(material);
}
