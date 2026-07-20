/**
 * 0002 migration tests (§15, API-055).
 * fresh install 0001+0002, upgrade from 0001-only, idempotent, checksum drift
 * fail closed, and api_idempotency_records CHECK constraints.
 *
 * Adapted from WorkCanger: bootstrapSystemActor (application service, sequence 2 scope)
 * replaced with direct SQL insert of a system audit_actor — this test validates
 * persistence-layer CHECK constraints, not application service behavior.
 */
import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createMigratedDb, createTempDataRoot } from "./persistence-helpers.ts";
import { openDatabase, listTables, assertForeignKeyIntegrity } from "../persistence/db.ts";
import { runMigrations, loadMigrations, getAppliedMigrations, checkMigrationDrift, type MigrationFile } from "../persistence/migration-runner.ts";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";

let temp: ReturnType<typeof createTempDataRoot>;
let migrationsDir: string;

beforeEach(() => {
  temp = createTempDataRoot();
  migrationsDir = join(import.meta.dirname, "..", "persistence", "migrations");
});

afterEach(() => temp.cleanup());

/**
 * Insert a system audit_actor directly via SQL (persistence-layer test setup).
 * Replaces WorkCanger's bootstrapSystemActor application service call, which is
 * out of scope for sequence 1 (application services migration is sequence 2).
 */
function insertSystemActor(db: DatabaseSync): string {
  const id = randomUUID();
  db.prepare(
    `INSERT INTO audit_actors (audit_actor_id, actor_kind, actor_key, display_name, created_at) VALUES (?, ?, ?, ?, ?)`,
  ).run(id, "system", "system", "System", new Date().toISOString());
  return id;
}

describe("0002 migration lifecycle", () => {
  test("fresh install applies 0001 + 0002", async () => {
    const migrations = loadMigrations(migrationsDir);
    const db = openDatabase(temp.layout.sqlitePath);
    const res = await runMigrations(db, migrations, temp.layout);
    assert.equal(res.applied, migrations.length);
    const tables = listTables(db);
    assert.ok(tables.includes("api_idempotency_records"));
    assert.equal(tables.length, 23);
    assertForeignKeyIntegrity(db);
    db.close();
  });

  test("upgrade from 0001-only to 0001+0002 succeeds", async () => {
    const migrations = loadMigrations(migrationsDir);
    const only0001 = migrations.filter((m) => m.version === 1);
    let db = openDatabase(temp.layout.sqlitePath);
    await runMigrations(db, only0001, temp.layout);
    assert.equal(getAppliedMigrations(db).length, 1);
    db.close();
    // now apply all remaining migrations (0002+ pending)
    db = openDatabase(temp.layout.sqlitePath);
    const res = await runMigrations(db, migrations, temp.layout);
    assert.equal(res.applied, migrations.length - 1, "0002 and later migrations should be applied on upgrade");
    assert.equal(res.skipped, 1);
    assert.equal(getAppliedMigrations(db).length, migrations.length);
    assert.ok(listTables(db).includes("api_idempotency_records"));
    db.close();
  });

  test("re-run is idempotent", async () => {
    const migrations = loadMigrations(migrationsDir);
    const db = openDatabase(temp.layout.sqlitePath);
    await runMigrations(db, migrations, temp.layout);
    const res = await runMigrations(db, migrations, temp.layout);
    assert.equal(res.applied, 0);
    assert.equal(res.skipped, migrations.length);
    db.close();
  });

  test("checksum drift on 0002 fails closed", async () => {
    const migrations = loadMigrations(migrationsDir);
    const db = openDatabase(temp.layout.sqlitePath);
    await runMigrations(db, migrations, temp.layout);
    const applied = getAppliedMigrations(db);
    const tampered: MigrationFile = { ...migrations[1]!, checksum: "0".repeat(64) };
    assert.throws(() => checkMigrationDrift(applied, [migrations[0]!, tampered]), /Migration drift detected/);
    db.close();
  });
});

describe("api_idempotency_records CHECK constraints", () => {
  let db: DatabaseSync;
  let cleanup: () => void;
  let actorId: string;

  beforeEach(async () => {
    const env = await createMigratedDb();
    db = env.db;
    cleanup = env.cleanup;
    actorId = insertSystemActor(db);
  });
  afterEach(() => cleanup());

  function insert(status: string, overrides: Record<string, unknown> = {}): void {
    const base: Record<string, unknown> = {
      idempotency_record_id: randomUUID(),
      audit_actor_id: actorId,
      command_type: "project.create",
      idempotency_key: randomUUID(),
      request_sha256: "0".repeat(64),
      execution_status: status,
      created_at: new Date().toISOString(),
    };
    const merged = { ...base, ...overrides };
    const cols = Object.keys(merged);
    const vals = cols.map((c) => merged[c] as string | number | null);
    db.prepare(`INSERT INTO api_idempotency_records (${cols.join(", ")}) VALUES (${cols.map(() => "?").join(", ")})`).run(...vals);
  }

  test("in_progress rejects terminal fields", () => {
    assert.throws(() => insert("in_progress", { response_http_status: 200 }), /CHECK constraint failed/);
    assert.throws(() => insert("in_progress", { completed_at: "2026-01-01T00:00:00.000Z" }), /CHECK constraint failed/);
  });

  test("succeeded requires http status + completed, no error", () => {
    assert.throws(() => insert("succeeded"), /CHECK constraint failed/);
    assert.throws(() => insert("succeeded", { response_http_status: 200, completed_at: "2026-01-01T00:00:00.000Z", error_code: "x", error_summary: "y" }), /CHECK constraint failed/);
    insert("succeeded", { response_http_status: 200, completed_at: "2026-01-01T00:00:00.000Z", result_resource_type: "Project", result_resource_id: randomUUID() });
  });

  test("failed requires http status + completed + error, no result", () => {
    assert.throws(() => insert("failed"), /CHECK constraint failed/);
    assert.throws(() => insert("failed", { response_http_status: 409, completed_at: "2026-01-01T00:00:00.000Z", error_code: "x", error_summary: "y", result_resource_type: "Project", result_resource_id: randomUUID() }), /CHECK constraint failed/);
    insert("failed", { response_http_status: 409, completed_at: "2026-01-01T00:00:00.000Z", error_code: "active_run_exists", error_summary: "y" });
  });

  test("result type/id must both be null or both non-null", () => {
    assert.throws(() => insert("succeeded", { response_http_status: 200, completed_at: "2026-01-01T00:00:00.000Z", result_resource_type: "Project" }), /CHECK constraint failed/);
    assert.throws(() => insert("succeeded", { response_http_status: 200, completed_at: "2026-01-01T00:00:00.000Z", result_resource_id: randomUUID() }), /CHECK constraint failed/);
  });

  test("invalid command_type rejected", () => {
    assert.throws(() => insert("in_progress", { command_type: "project.start" } as unknown as Record<string, unknown>), /CHECK constraint failed/);
  });

  test("invalid request_sha256 rejected", () => {
    assert.throws(() => {
      db.prepare(`INSERT INTO api_idempotency_records (idempotency_record_id, audit_actor_id, command_type, idempotency_key, request_sha256, execution_status, created_at) VALUES (?, ?, 'project.create', ?, 'short', 'in_progress', ?)`).run(randomUUID(), actorId, randomUUID(), new Date().toISOString());
    }, /CHECK constraint failed/);
  });

  test("recovery index exists", () => {
    const idx = db.prepare(`SELECT name FROM sqlite_master WHERE type='index' AND name='idx_api_idempotency_records_status_created'`).get();
    assert.ok(idx);
  });

  test("scope uniqueness (actor, command, key)", () => {
    const key = randomUUID();
    insert("in_progress", { idempotency_key: key });
    assert.throws(() => insert("in_progress", { idempotency_key: key }), /UNIQUE constraint failed/);
  });
});
