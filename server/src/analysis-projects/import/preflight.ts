/**
 * Target-side preflight: schema/version validation, actor identity
 * classification, durable-ID/unique-key conflict scans, and the
 * already-imported check.
 *
 * Contract (T0014 brief requirements 3, 5, 6, 11):
 * - Target schema must be exactly migrations 0001-0003 with matching
 *   checksums; target FK integrity must hold; drift fails closed.
 * - Historical AuditActor rows are provenance: identical rows are skipped;
 *   any ID/unique-identity conflict with different content blocks the import.
 *   No automatic merge or rewrite of historical actors.
 * - Every pending durable ID and natural unique key is checked against the
 *   target before any write; conflicts fail closed with safe counts only.
 * - A repeated import of the same source fingerprint is detected and safely
 *   returns already-imported; a different fingerprint never reuses it.
 */
import type { DatabaseSync } from "node:sqlite";
import { existsSync } from "node:fs";
import { foreignKeyCheck } from "../persistence/db.ts";
import {
  getAppliedMigrations,
  type MigrationFile,
} from "../persistence/migration-runner.ts";
import { blobAbsolutePath } from "../persistence/blob-writer.ts";
import { ImportError } from "./errors.ts";
import { hashFileStreamingSync } from "./fs-hash.ts";
import { findCompletedManifest, type ImportManifest } from "./journal.ts";
import { TABLE_SPECS, type TableSpec, type UniqueKeySpec } from "./schema-plan.ts";
import type { SourceData, SourceRow } from "./source-reader.ts";
import { rowValue } from "./source-reader.ts";

// ---------------------------------------------------------------------------
// Target schema validation
// ---------------------------------------------------------------------------

export function validateTargetSchema(
  db: DatabaseSync,
  expectedTargetMigrations: readonly MigrationFile[],
): void {
  const migrationsTable = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='schema_migrations'")
    .get();
  if (!migrationsTable) {
    throw new ImportError(
      "target_schema_drift",
      "target_schema",
      "Target database has no schema_migrations table.",
    );
  }
  const applied = getAppliedMigrations(db);
  const expectedByVersion = new Map(expectedTargetMigrations.map((m) => [m.version, m]));
  if (applied.length !== expectedTargetMigrations.length) {
    throw new ImportError(
      "target_schema_drift",
      "target_schema",
      `Target migration set drift: expected ${expectedTargetMigrations.length} migration(s), found ${applied.length}.`,
    );
  }
  for (const record of applied) {
    const file = expectedByVersion.get(record.version);
    if (!file || file.name !== record.name || file.checksum !== record.checksum) {
      throw new ImportError(
        "target_schema_drift",
        "target_schema",
        `Target migration drift at schema version ${record.version}.`,
      );
    }
  }
  const violations = foreignKeyCheck(db);
  if (violations.length > 0) {
    throw new ImportError(
      "target_integrity_fk",
      "target_schema",
      `Target foreign_key_check reports ${violations.length} violation(s) before import.`,
    );
  }
}

// ---------------------------------------------------------------------------
// Actor identity classification (brief requirement 6)
// ---------------------------------------------------------------------------

const ACTOR_COLUMNS = [
  "audit_actor_id",
  "actor_kind",
  "actor_key",
  "display_name",
  "created_at",
  "registered_by_actor_id",
  "disabled_at",
  "external_auth_provider",
  "external_subject_id",
] as const;

export interface ActorClassification {
  /** Source actor IDs already present in the target with identical content. */
  readonly skipIds: ReadonlySet<string>;
  /** Count of source actors blocked by ID/unique-identity conflict. */
  readonly conflictCount: number;
}

function actorsIdentical(source: SourceRow, target: SourceRow): boolean {
  return ACTOR_COLUMNS.every((col) => source[col] === target[col]);
}

export function classifyActors(db: DatabaseSync, sourceActors: readonly SourceRow[]): ActorClassification {
  const skipIds = new Set<string>();
  let conflictCount = 0;
  const byIdStmt = db.prepare(`SELECT * FROM audit_actors WHERE audit_actor_id = ?`);
  const byKeyStmt = db.prepare(
    `SELECT * FROM audit_actors WHERE actor_kind = ? AND actor_key = ?`,
  );
  const byExternalStmt = db.prepare(
    `SELECT * FROM audit_actors WHERE external_auth_provider = ? AND external_subject_id = ?`,
  );

  for (const actor of sourceActors) {
    const id = actor.audit_actor_id as string;
    const existing = byIdStmt.get(id) as SourceRow | undefined;
    if (existing) {
      if (actorsIdentical(actor, existing)) {
        skipIds.add(id);
      } else {
        conflictCount += 1;
      }
      continue;
    }
    const sameKey = byKeyStmt.get(
      rowValue(actor, "actor_kind"),
      rowValue(actor, "actor_key"),
    ) as SourceRow | undefined;
    if (sameKey) {
      conflictCount += 1;
      continue;
    }
    const externalProvider = rowValue(actor, "external_auth_provider");
    const externalSubject = rowValue(actor, "external_subject_id");
    if (externalProvider !== null && externalSubject !== null) {
      const sameExternal = byExternalStmt.get(
        externalProvider,
        externalSubject,
      ) as SourceRow | undefined;
      if (sameExternal) {
        conflictCount += 1;
        continue;
      }
    }
  }
  return { skipIds, conflictCount };
}

// ---------------------------------------------------------------------------
// Durable ID / unique key conflict scan (brief requirement 3)
// ---------------------------------------------------------------------------

export interface ConflictReport {
  /** Table -> count of rows whose durable ID already exists in the target. */
  readonly durableId: Readonly<Record<string, number>>;
  /** Table -> count of rows hitting a natural unique key of a different row. */
  readonly uniqueKey: Readonly<Record<string, number>>;
  readonly actorIdentity: number;
  readonly actorSkips: number;
  readonly total: number;
}

function identityKey(spec: TableSpec, row: SourceRow): string {
  return JSON.stringify(spec.identity.map((col) => row[col]));
}

function buildUniquePredicate(spec: UniqueKeySpec): string {
  return spec.columns
    .map((col) => (spec.collation ? `${col} = ? COLLATE ${spec.collation}` : `${col} = ?`))
    .join(" AND ");
}

export function scanConflicts(
  db: DatabaseSync,
  source: SourceData,
  actorSkipIds: ReadonlySet<string>,
  actorConflictCount: number,
): ConflictReport {
  const durableId: Record<string, number> = {};
  const uniqueKey: Record<string, number> = {};

  for (const spec of TABLE_SPECS) {
    if (spec.table === "audit_actors") continue; // handled by classifyActors
    const rows = source.rows.get(spec.table)!;
    if (rows.length === 0) continue;

    const pkPredicate = spec.identity.map((col) => `${col} = ?`).join(" AND ");
    const pkStmt = db.prepare(`SELECT 1 FROM ${spec.table} WHERE ${pkPredicate} LIMIT 1`);
    const uniqueStmts = spec.uniqueKeys.map((uniqueSpec) => ({
      spec: uniqueSpec,
      stmt: db.prepare(
        `SELECT ${spec.identity.join(", ")} FROM ${spec.table} WHERE ${buildUniquePredicate(uniqueSpec)}`,
      ),
    }));

    for (const row of rows) {
      const pkHit = pkStmt.get(...spec.identity.map((col) => rowValue(row, col))) !== undefined;
      if (pkHit) {
        durableId[spec.table] = (durableId[spec.table] ?? 0) + 1;
      }
      for (const { spec: uniqueSpec, stmt } of uniqueStmts) {
        const values = uniqueSpec.columns.map((col) => rowValue(row, col));
        if (uniqueSpec.nullSkip && values.some((value) => value === null)) {
          continue;
        }
        const matches = stmt.all(...values) as unknown as SourceRow[];
        const sourceKey = identityKey(spec, row);
        const conflictsWithOther = matches.some((match) => identityKey(spec, match) !== sourceKey);
        if (conflictsWithOther) {
          uniqueKey[spec.table] = (uniqueKey[spec.table] ?? 0) + 1;
          break; // count a row once even if multiple unique keys hit
        }
      }
    }
  }

  const sum = (record: Record<string, number>) =>
    Object.values(record).reduce((acc, n) => acc + n, 0);
  return {
    durableId,
    uniqueKey,
    actorIdentity: actorConflictCount,
    actorSkips: actorSkipIds.size,
    total: sum(durableId) + sum(uniqueKey) + actorConflictCount,
  };
}

// ---------------------------------------------------------------------------
// Already-imported detection (brief requirement 11)
// ---------------------------------------------------------------------------

export type AlreadyImportedCheck =
  | { readonly kind: "already_imported"; readonly manifest: ImportManifest }
  | { readonly kind: "not_imported" }
  | { readonly kind: "reimport_after_target_reset"; readonly manifest: ImportManifest };

/**
 * A completed manifest for the same fingerprint only short-circuits when the
 * target actually holds the COMPLETE durable imported state (R4): every
 * source row identity in every table, plus every planned blob present in the
 * target store with a matching SHA-256. A manifest over a damaged target
 * (deleted non-project row, missing/corrupt blob) must fail closed instead
 * of returning already_imported. If the DB no longer has any of the planned
 * projects (target reset), the import may proceed; a partial state fails
 * closed.
 */
export function checkAlreadyImported(
  db: DatabaseSync,
  completedManifest: ImportManifest | null,
  source: SourceData,
  targetBlobsDir: string,
): AlreadyImportedCheck {
  if (!completedManifest) return { kind: "not_imported" };
  const stmt = db.prepare(
    `SELECT 1 FROM analysis_projects WHERE analysis_project_id = ? LIMIT 1`,
  );
  let present = 0;
  for (const id of source.projectIds) {
    if (stmt.get(id) !== undefined) present += 1;
  }
  if (source.projectIds.length > 0 && present === 0) {
    return { kind: "reimport_after_target_reset", manifest: completedManifest };
  }
  if (present !== source.projectIds.length) {
    throw new ImportError(
      "conflict_partial_state",
      "conflict",
      "Target already contains a partial subset of this source's projects; manual resolution required.",
    );
  }

  // Full durable-state reconciliation (R4): every source row identity of
  // every table must be present - a completed import inserted or matched
  // them all, so any gap means the target no longer matches the manifest.
  for (const spec of TABLE_SPECS) {
    const rows = source.rows.get(spec.table)!;
    if (rows.length === 0) continue;
    const pkPredicate = spec.identity.map((col) => `${col} = ?`).join(" AND ");
    const pkStmt = db.prepare(`SELECT 1 FROM ${spec.table} WHERE ${pkPredicate} LIMIT 1`);
    for (const row of rows) {
      if (pkStmt.get(...spec.identity.map((col) => rowValue(row, col))) === undefined) {
        throw new ImportError(
          "conflict_partial_state",
          "conflict",
          `Target is missing durable rows of table ${spec.table} recorded by the completed import; ` +
            `manual resolution required.`,
        );
      }
    }
  }

  // Blob plan reconciliation (R4): every referenced blob must exist in the
  // target store with a matching SHA-256.
  for (const entry of source.blobPlan.values()) {
    const absPath = blobAbsolutePath(targetBlobsDir, entry.ref);
    if (!existsSync(absPath) || hashFileStreamingSync(absPath) !== entry.hash) {
      throw new ImportError(
        "conflict_partial_state",
        "conflict",
        "Target is missing referenced blobs recorded by the completed import; manual resolution required.",
      );
    }
  }

  return { kind: "already_imported", manifest: completedManifest };
}

export { findCompletedManifest };
