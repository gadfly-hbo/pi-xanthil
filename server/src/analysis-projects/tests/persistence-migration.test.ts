/**
 * Tests for migration runner.
 * Contract: first run succeeds, re-run idempotent, checksum drift fails closed,
 * foreign_key_check empty, backup creation.
 */
import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readdirSync } from "node:fs";
import {
  runMigrations,
  loadMigrations,
  getAppliedMigrations,
  checkMigrationDrift,
  computeMigrationChecksum,
  DEFAULT_APPLICATION_VERSION,
  type MigrationFile,
} from "../persistence/migration-runner.ts";
import { openDatabase, assertForeignKeyIntegrity, listTables } from "../persistence/db.ts";
import { createTempDataRoot, type TempDataRoot } from "./persistence-helpers.ts";
import { existsSync } from "node:fs";
import { join } from "node:path";

let temp: TempDataRoot;
let migrationsDir: string;

beforeEach(() => {
  temp = createTempDataRoot();
  migrationsDir = join(import.meta.dirname, "..", "persistence", "migrations");
});

afterEach(() => {
  temp.cleanup();
});

describe("runMigrations - first run", () => {
  test("applies migration successfully", async () => {
    const migrations = loadMigrations(migrationsDir);
    assert.equal(migrations.length, 5, "should have five migration files");
    assert.equal(migrations[0]!.version, 1);
    assert.equal(migrations[1]!.version, 2);
    assert.equal(migrations[4]!.version, 5);

    const db = openDatabase(temp.layout.sqlitePath);
    const result = await runMigrations(db, migrations, temp.layout);

    assert.equal(result.applied, migrations.length);
    assert.equal(result.skipped, 0);
    db.close();
  });

  test("creates all v1 tables", async () => {
    const migrations = loadMigrations(migrationsDir);
    const db = openDatabase(temp.layout.sqlitePath);
    await runMigrations(db, migrations, temp.layout);

    const tables = listTables(db);
    const expected = [
      "schema_migrations",
      "audit_actors",
      "analysis_projects",
      "analysis_requests",
      "structured_requirement_versions",
      "analysis_plan_versions",
      "source_references",
      "source_checks",
      "analysis_runs",
      "analysis_run_input_evidence",
      "run_events",
      "evidence_artifacts",
      "report_versions",
      "report_version_evidence",
      "gate_decisions",
      "api_idempotency_records",
      "closure_cycles",
      "s31_conclusion_translations",
      "s32_system_deployments",
      "s33_business_executions",
      "s34_feedback_ingestions",
      "s35_effect_evaluations",
      "s36_iteration_triggers",
    ];

    for (const t of expected) {
      assert.ok(tables.includes(t), `table ${t} should exist`);
    }
    assert.equal(tables.length, expected.length, `should have exactly ${expected.length} tables`);

    db.close();
  });

  test("foreign_key_check is empty after migration", async () => {
    const migrations = loadMigrations(migrationsDir);
    const db = openDatabase(temp.layout.sqlitePath);
    await runMigrations(db, migrations, temp.layout);

    // Should not throw
    assertForeignKeyIntegrity(db);
    db.close();
  });

  test("schema_migrations record inserted", async () => {
    const migrations = loadMigrations(migrationsDir);
    const db = openDatabase(temp.layout.sqlitePath);
    await runMigrations(db, migrations, temp.layout);

    const applied = getAppliedMigrations(db);
    assert.equal(applied.length, migrations.length);
    assert.equal(applied[0]!.version, 1);
    assert.equal(applied[0]!.name, "0001_initial_workcanger");
    assert.equal(applied[0]!.checksum, migrations[0]!.checksum);
    assert.equal(applied[0]!.application_version, DEFAULT_APPLICATION_VERSION,
      "application_version must be the pi-Xanthil default, not the donor's 0.0.0");
    assert.equal(applied[1]!.version, 2);
    assert.equal(applied[1]!.name, "0002_create_api_idempotency_records");
    assert.equal(applied[1]!.checksum, migrations[1]!.checksum);
    assert.equal(applied[1]!.application_version, DEFAULT_APPLICATION_VERSION);
    assert.equal(applied[4]!.version, 5);
    assert.equal(applied[4]!.name, "0005_extend_idempotency_for_closure");
    assert.equal(applied[4]!.checksum, migrations[4]!.checksum);
    assert.equal(applied[4]!.application_version, DEFAULT_APPLICATION_VERSION);
    db.close();
  });

  test("application_version is not the donor's 0.0.0", async () => {
    const migrations = loadMigrations(migrationsDir);
    const db = openDatabase(temp.layout.sqlitePath);
    await runMigrations(db, migrations, temp.layout);

    const applied = getAppliedMigrations(db);
    for (const record of applied) {
      assert.notEqual(record.application_version, "0.0.0",
        "application_version must not be the WorkCanger donor's version");
    }
    db.close();
  });

  test("custom applicationVersion is injected and recorded", async () => {
    const migrations = loadMigrations(migrationsDir);
    const db = openDatabase(temp.layout.sqlitePath);
    await runMigrations(db, migrations, temp.layout, "xanthil-9.9.9-test");

    const applied = getAppliedMigrations(db);
    assert.equal(applied.length, migrations.length);
    for (const record of applied) {
      assert.equal(record.application_version, "xanthil-9.9.9-test");
    }
    db.close();
  });
});

describe("runMigrations - idempotency", () => {
  test("re-running migrations skips already applied", async () => {
    const migrations = loadMigrations(migrationsDir);
    const db = openDatabase(temp.layout.sqlitePath);

    const first = await runMigrations(db, migrations, temp.layout);
    assert.equal(first.applied, migrations.length);

    const second = await runMigrations(db, migrations, temp.layout);
    assert.equal(second.applied, 0);
    assert.equal(second.skipped, migrations.length);

    db.close();
  });
});

describe("checkMigrationDrift - checksum verification", () => {
  test("checksum mismatch fails closed", async () => {
    const migrations = loadMigrations(migrationsDir);
    const db = openDatabase(temp.layout.sqlitePath);
    await runMigrations(db, migrations, temp.layout);

    // Create a modified migration with wrong checksum
    const tampered: MigrationFile = {
      ...migrations[0]!,
      checksum: "0".repeat(64),
    };

    const applied = getAppliedMigrations(db);
    assert.throws(
      () => checkMigrationDrift(applied, [tampered]),
      /Migration drift detected/,
    );
    db.close();
  });

  test("database version higher than app version rejected", async () => {
    const migrations = loadMigrations(migrationsDir);
    const db = openDatabase(temp.layout.sqlitePath);
    await runMigrations(db, migrations, temp.layout);

    // Simulate: DB has a future version that the app does not have.
    const futureVersion = migrations.at(-1)!.version + 1;
    // Manually insert a higher version
    db.prepare(
      "INSERT INTO schema_migrations (version, name, checksum, applied_at, application_version) VALUES (?, ?, ?, ?, ?)",
    ).run(futureVersion, "0006_future", "abc", "2026-01-01T00:00:00Z", "0.0.0");

    const appliedWithFuture = getAppliedMigrations(db);
    assert.throws(
      () => checkMigrationDrift(appliedWithFuture, migrations),
      /Missing migration file|higher than the highest migration/,
    );
    db.close();
  });
});

describe("runMigrations - PRAGMA foreign_keys", () => {
  test("foreign keys are enabled on connection", async () => {
    const migrations = loadMigrations(migrationsDir);
    const db = openDatabase(temp.layout.sqlitePath);
    await runMigrations(db, migrations, temp.layout);

    const fk = db.prepare("PRAGMA foreign_keys").get() as { foreign_keys: number };
    assert.equal(fk.foreign_keys, 1, "foreign_keys must be ON");
    db.close();
  });
});

describe("runMigrations - blob manifest", () => {
  test("creates blob hash manifest before migration", async () => {
    const migrations = loadMigrations(migrationsDir);
    const db = openDatabase(temp.layout.sqlitePath);
    await runMigrations(db, migrations, temp.layout);

    // Check that at least one manifest file exists in backups
    const backups = readdirSync(temp.layout.backupsDir);
    const manifests = backups.filter((f) => f.startsWith("blob-manifest-"));
    assert.ok(manifests.length >= 1, "should create at least one blob manifest");
    db.close();
  });
});
