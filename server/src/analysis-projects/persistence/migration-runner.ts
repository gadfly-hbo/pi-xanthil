/**
 * Forward-only migration runner.
 *
 * Contract (P0-76, schema-v1-and-migrations.md):
 * - schema_migrations is the migration source of truth.
 * - append-only migration files; published files are immutable.
 * - checksum change or DB version higher than app version => reject startup.
 * - Pre-migration: create consistency SQLite backup + blob hash manifest.
 * - Failure: rollback using pre-migration backup.
 * - No automatic down migration; rollback uses old app + pre-migration backup.
 * - After migration: verify FK integrity, blob/hash, ordinals, constraints.
 * - Unknown existing databases are NOT auto-imported.
 */
import { DatabaseSync, backup } from "node:sqlite";
import { readFileSync, existsSync, writeFileSync, readdirSync, statSync, copyFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { sha256Hex } from "./sha256.ts";
import type { DataRootLayout } from "./data-root.ts";
import { assertForeignKeyIntegrity } from "./db.ts";

export class MigrationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MigrationError";
  }
}

export interface MigrationFile {
  version: number;
  name: string;
  sql: string;
  checksum: string;
}

export interface MigrationRecord {
  version: number;
  name: string;
  checksum: string;
  applied_at: string;
  application_version: string;
}

/**
 * Default application version recorded in schema_migrations.application_version.
 * Namespaced with "xanthil-" prefix to distinguish from WorkCanger donor's "0.0.0".
 * Callers may override via runMigrations/applyMigration applicationVersion parameter.
 * Matches pi-Xanthil server package.json version at transplant time.
 */
export const DEFAULT_APPLICATION_VERSION = "xanthil-0.1.0";

/**
 * Compute a checksum for a migration SQL file.
 * Uses SHA-256 of the file content.
 */
export function computeMigrationChecksum(sql: string): string {
  return sha256Hex(sql);
}

/**
 * Load a migration file from disk.
 */
export function loadMigrationFile(filePath: string): MigrationFile {
  const sql = readFileSync(filePath, "utf8");
  const fileName = filePath.split("/").pop()!;
  const version = parseInt(fileName.split("_")[0]!, 10);
  if (!Number.isInteger(version) || version <= 0) {
    throw new MigrationError(`Invalid migration version in filename: ${fileName}`);
  }
  const name = fileName.replace(/\.sql$/, "");
  return {
    version,
    name,
    sql,
    checksum: computeMigrationChecksum(sql),
  };
}

/**
 * Load all migration files from a directory, sorted by version.
 */
export function loadMigrations(migrationsDir: string): MigrationFile[] {
  const files = readdirSync(migrationsDir)
    .filter((f) => f.endsWith(".sql"))
    .sort();
  return files.map((f) => loadMigrationFile(join(migrationsDir, f)));
}

/**
 * Get all applied migration records from the database.
 */
export function getAppliedMigrations(db: DatabaseSync): MigrationRecord[] {
  // Check if schema_migrations table exists
  const tableExists = db
    .prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='schema_migrations'",
    )
    .get();

  if (!tableExists) {
    return [];
  }

  const rows = db
    .prepare(
      "SELECT version, name, checksum, applied_at, application_version FROM schema_migrations ORDER BY version",
    )
    .all() as unknown as MigrationRecord[];

  return rows;
}

/**
 * Create a pre-migration backup of the database.
 * Uses SQLite Online Backup API for consistency.
 */
export function createDatabaseBackup(
  db: DatabaseSync,
  backupPath: string,
): Promise<void> {
  return backup(db, backupPath) as Promise<void>;
}

/**
 * Create a blob hash manifest file before migration.
 */
export function createBlobHashManifest(
  blobsDir: string,
  manifestPath: string,
): void {
  const manifest: Record<string, { size: number; sha256: string }> = {};

  function walkDir(dir: string, prefix: string): void {
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }
    for (const entry of entries) {
      const fullPath = join(dir, entry);
      const relPath = prefix ? `${prefix}/${entry}` : entry;
      const stat = statSync(fullPath);
      if (stat.isDirectory()) {
        walkDir(fullPath, relPath);
      } else {
        const content = readFileSync(fullPath);
        const hash = createHash("sha256").update(content).digest("hex");
        manifest[relPath] = { size: stat.size, sha256: hash };
      }
    }
  }

  walkDir(blobsDir, "");
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), "utf8");
}

/**
 * Check for migration drift:
 * - Applied migration with different checksum => reject.
 * - DB version higher than highest app migration => reject.
 * - Applied migration whose file is missing (deleted/renamed) => reject.
 */
export function checkMigrationDrift(
  applied: MigrationRecord[],
  pending: MigrationFile[],
): void {
  const appliedMap = new Map(applied.map((a) => [a.version, a]));
  const pendingMap = new Map(pending.map((p) => [p.version, p]));

  // Check checksum drift and missing files on already-applied migrations
  for (const record of applied) {
    const file = pendingMap.get(record.version);
    if (!file) {
      throw new MigrationError(
        `Missing migration file for applied version ${record.version} (${record.name}). ` +
          `Published migration files are append-only and must not be deleted or renamed.`,
      );
    }
    if (file.checksum !== record.checksum) {
      throw new MigrationError(
        `Migration drift detected: version ${record.version} ` +
          `checksum mismatch. Applied: ${record.checksum}, file: ${file.checksum}. ` +
          `Published migrations are immutable.`,
      );
    }
    if (file.name !== record.name) {
      throw new MigrationError(
        `Migration drift detected: version ${record.version} ` +
          `name mismatch. Applied: ${record.name}, file: ${file.name}. ` +
          `Published migration names are immutable.`,
      );
    }
  }

  // Check if DB has versions higher than the app supports
  const maxAppVersion = pending.length > 0
    ? Math.max(...pending.map((p) => p.version))
    : 0;
  for (const record of applied) {
    if (record.version > maxAppVersion) {
      throw new MigrationError(
        `Database version ${record.version} (${record.name}) is higher than ` +
          `the highest migration supported by this application (${maxAppVersion}). ` +
          `Refusing to start.`,
      );
    }
  }
}

/**
 * Check if the database has user tables but no schema_migrations table.
 * Such databases are unknown and must NOT be auto-imported.
 */
export function checkUnknownDatabase(db: DatabaseSync): void {
  const schemaMigrationsExists = db
    .prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='schema_migrations'",
    )
    .get();

  if (schemaMigrationsExists) {
    return; // schema_migrations exists, this is a known database
  }

  // Check for any user tables (excluding sqlite_* internal tables)
  const userTables = db
    .prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'",
    )
    .all() as Array<{ name: string }>;

  if (userTables.length > 0) {
    throw new MigrationError(
      `Unknown database detected: ${userTables.length} table(s) exist but schema_migrations is missing. ` +
        `Unknown existing databases are not auto-imported. Tables: ${userTables.map((t) => t.name).join(", ")}`,
    );
  }
}

/**
 * Apply a single migration in a transaction.
 * The SQL must include the INSERT into schema_migrations.
 * @param applicationVersion - Application version to record (defaults to DEFAULT_APPLICATION_VERSION).
 */
export function applyMigration(
  db: DatabaseSync,
  migration: MigrationFile,
  applicationVersion: string = DEFAULT_APPLICATION_VERSION,
): void {
  const now = new Date().toISOString();

  db.exec("BEGIN");
  try {
    // Execute the migration SQL
    db.exec(migration.sql);

    // Insert the schema_migrations record (if not already in the SQL)
    // The migration SQL itself handles the INSERT per the contract design.
    // But we also verify it was inserted.
    const record = db
      .prepare(
        "SELECT version FROM schema_migrations WHERE version = ?",
      )
      .get(migration.version);

    if (!record) {
      // Insert the record ourselves
      db.prepare(
        "INSERT INTO schema_migrations (version, name, checksum, applied_at, application_version) VALUES (?, ?, ?, ?, ?)",
      ).run(
        migration.version,
        migration.name,
        migration.checksum,
        now,
        applicationVersion,
      );
    }

    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw new MigrationError(
      `Migration ${migration.version} (${migration.name}) failed: ${(err as Error).message}`,
    );
  }
}

/**
 * Run all pending migrations.
 *
 * Process:
 * 1. If database already has migrations, check for drift.
 * 2. If there are pending migrations, create a backup + blob manifest.
 * 3. Apply each migration in order.
 * 4. Verify foreign key integrity.
 * 5. On failure, restore from backup.
 */
export async function runMigrations(
  db: DatabaseSync,
  migrations: MigrationFile[],
  layout: DataRootLayout,
  applicationVersion: string = DEFAULT_APPLICATION_VERSION,
): Promise<{ applied: number; skipped: number }> {
  // Always check for unknown databases first, even if no migrations provided
  checkUnknownDatabase(db);

  // Sort migrations by version
  const sorted = [...migrations].sort((a, b) => a.version - b.version);
  const applied = getAppliedMigrations(db);

  // Always check for drift (checksum/name mismatch, missing files, high DB version)
  // This runs even when migrations=[] to catch missing-file drift on applied DBs
  checkMigrationDrift(applied, sorted);

  // If no migration files and no applied migrations, nothing to do
  if (sorted.length === 0 && applied.length === 0) {
    return { applied: 0, skipped: 0 };
  }

  // Determine which migrations need to be applied
  const appliedVersions = new Set(applied.map((a) => a.version));
  const pendingMigrations = sorted.filter(
    (m) => !appliedVersions.has(m.version),
  );

  if (pendingMigrations.length === 0) {
    return { applied: 0, skipped: sorted.length };
  }

  // Create pre-migration backup if database already has applied migrations
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupPath = join(layout.backupsDir, `pre-migration-${timestamp}.sqlite`);
  let backupCreated = false;

  if (applied.length > 0) {
    try {
      await createDatabaseBackup(db, backupPath);
      backupCreated = true;
    } catch (err) {
      throw new MigrationError(
        `Failed to create pre-migration backup: ${(err as Error).message}`,
      );
    }
  }

  // Create blob hash manifest
  const manifestPath = join(
    layout.backupsDir,
    `blob-manifest-${timestamp}.json`,
  );
  createBlobHashManifest(layout.blobsDir, manifestPath);

  // Apply migrations
  try {
    for (const migration of pendingMigrations) {
      applyMigration(db, migration, applicationVersion);
    }

    // Post-migration verification
    assertForeignKeyIntegrity(db);

    return { applied: pendingMigrations.length, skipped: applied.length };
  } catch (err) {
    const errMsg = (err as Error).message;

    // Verified restore: if a backup was created, restore it
    if (backupCreated && existsSync(backupPath)) {
      try {
        // Close the database to release the file handle
        db.close();

        // Overwrite the corrupted database with the backup
        copyFileSync(backupPath, layout.sqlitePath);

        throw new MigrationError(
          `Migration failed and database was restored from backup. ` +
            `The caller must reopen the database. ` +
            `Error: ${errMsg}. Backup: ${backupPath}`,
        );
      } catch (restoreErr) {
        if (restoreErr instanceof MigrationError) throw restoreErr;
        throw new MigrationError(
          `Migration failed (${errMsg}) and restore from backup also failed: ` +
            `${(restoreErr as Error).message}. ` +
            `Manual recovery required. Backup: ${backupPath}`,
        );
      }
    }

    // No backup was created (first migration on empty DB) - just remove the DB file
    if (existsSync(layout.sqlitePath) && applied.length === 0) {
      try {
        db.close();
        rmSync(layout.sqlitePath, { force: true });
        throw new MigrationError(
          `Migration failed on fresh database, partially created DB was removed. ` +
            `The caller must reopen the database. Error: ${errMsg}`,
        );
      } catch (rmErr) {
        if (rmErr instanceof MigrationError) throw rmErr;
        throw new MigrationError(
          `Migration failed (${errMsg}) and cleanup also failed: ` +
            `${(rmErr as Error).message}. Manual recovery required.`,
        );
      }
    }

    throw err;
  }
}
