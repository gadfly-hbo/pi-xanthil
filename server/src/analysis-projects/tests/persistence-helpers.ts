/**
 * Test helper: create a temporary data root for isolated testing.
 * Adapted from WorkCanger apps/server/test/helpers.ts for pi-Xanthil analysis-projects module.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { initDataRoot, type DataRootLayout } from "../persistence/data-root.ts";
import { openDatabase, type OpenDatabaseOptions } from "../persistence/db.ts";
import { runMigrations, loadMigrations } from "../persistence/migration-runner.ts";
import type { DatabaseSync } from "node:sqlite";

export interface TempDataRoot {
  layout: DataRootLayout;
  cleanup: () => void;
}

export function createTempDataRoot(): TempDataRoot {
  const dir = mkdtempSync(join(tmpdir(), "xanthil-analysis-projects-test-"));
  const layout = initDataRoot(dir);
  return {
    layout,
    cleanup: () => {
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

/**
 * Create a temp data root, run all migrations, and return an open DB + layout.
 * The caller is responsible for closing the DB; cleanup closes & removes the dir.
 */
export async function createMigratedDb(options?: {
  migrations?: "all" | "0001-only";
  dbOptions?: OpenDatabaseOptions;
}): Promise<{ db: DatabaseSync; layout: DataRootLayout; cleanup: () => void }> {
  const temp = createTempDataRoot();
  const db = openDatabase(temp.layout.sqlitePath, options?.dbOptions);
  const migrationsDir = join(import.meta.dirname, "..", "persistence", "migrations");
  let migrations = loadMigrations(migrationsDir);
  if (options?.migrations === "0001-only") {
    migrations = migrations.filter((m) => m.version === 1);
  }
  await runMigrations(db, migrations, temp.layout);
  return {
    db,
    layout: temp.layout,
    cleanup: () => {
      try { db.close(); } catch { /* already closed */ }
      temp.cleanup();
    },
  };
}
