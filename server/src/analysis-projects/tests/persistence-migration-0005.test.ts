/**
 * Migration 0005 tests: extend idempotency CHECK constraints for closure commands.
 *
 * Proves:
 * 1. Fresh DB accepts 7 closure command types and 2 closure result resource types.
 * 2. Existing DB with old records migrates without data loss (upgrade path).
 * 3. Old command types still work after migration.
 */
import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { runMigrations, loadMigrations, loadMigrationFile } from "../persistence/migration-runner.ts";
import { openDatabase } from "../persistence/db.ts";
import { createTempDataRoot, type TempDataRoot } from "./persistence-helpers.ts";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

let temp: TempDataRoot;
let db: DatabaseSync;

beforeEach(async () => {
  temp = createTempDataRoot();
  const migrationsDir = join(import.meta.dirname, "..", "persistence", "migrations");
  db = openDatabase(temp.layout.sqlitePath);
  await runMigrations(db, loadMigrations(migrationsDir), temp.layout);
});
afterEach(() => { db.close(); temp.cleanup(); });

function uuid(): string { return randomUUID(); }
function sha256(): string { return "a".repeat(64); }
function now(): string { return new Date().toISOString(); }

function insertActor(): string {
  const id = uuid();
  db.prepare(`INSERT INTO audit_actors (audit_actor_id, actor_kind, actor_key, display_name, created_at) VALUES (?, 'human', ?, ?, ?)`).run(id, `k-${id}`, `A ${id}`, now());
  return id;
}

describe("migration 0005: idempotency CHECK extension for closure", () => {
  test("fresh DB accepts all 7 closure command types", () => {
    const actor = insertActor();
    const commands = [
      "closure.initiate_cycle",
      "closure.record_s31_translation",
      "closure.record_s32_deployment",
      "closure.record_s33_execution",
      "closure.append_s34_feedback",
      "closure.record_s35_evaluation",
      "closure.record_s36_trigger",
    ];
    for (const cmd of commands) {
      const id = uuid();
      db.prepare(`INSERT INTO api_idempotency_records (idempotency_record_id, audit_actor_id, command_type, idempotency_key, request_sha256, execution_status, created_at) VALUES (?, ?, ?, ?, ?, 'in_progress', ?)`).run(id, actor, cmd, uuid(), sha256(), now());
      const row = db.prepare(`SELECT command_type FROM api_idempotency_records WHERE idempotency_record_id = ?`).get(id) as { command_type: string };
      assert.equal(row.command_type, cmd);
    }
  });

  test("fresh DB accepts ClosureCycle and ClosureStageFact result resource types", () => {
    const actor = insertActor();
    for (const rtype of ["ClosureCycle", "ClosureStageFact"]) {
      const id = uuid();
      db.prepare(`INSERT INTO api_idempotency_records (idempotency_record_id, audit_actor_id, command_type, idempotency_key, request_sha256, execution_status, response_http_status, result_resource_type, result_resource_id, completed_at, created_at) VALUES (?, ?, 'closure.initiate_cycle', ?, ?, 'succeeded', 201, ?, ?, ?, ?)`).run(id, actor, uuid(), sha256(), rtype, uuid(), now(), now());
      const row = db.prepare(`SELECT result_resource_type FROM api_idempotency_records WHERE idempotency_record_id = ?`).get(id) as { result_resource_type: string };
      assert.equal(row.result_resource_type, rtype);
    }
  });

  test("old command types still work after migration", () => {
    const actor = insertActor();
    const id = uuid();
    db.prepare(`INSERT INTO api_idempotency_records (idempotency_record_id, audit_actor_id, command_type, idempotency_key, request_sha256, execution_status, created_at) VALUES (?, ?, 'project.create', ?, ?, 'in_progress', ?)`).run(id, actor, uuid(), sha256(), now());
    const row = db.prepare(`SELECT command_type FROM api_idempotency_records WHERE idempotency_record_id = ?`).get(id) as { command_type: string };
    assert.equal(row.command_type, "project.create");
  });

  test("old result resource types still work after migration", () => {
    const actor = insertActor();
    const id = uuid();
    db.prepare(`INSERT INTO api_idempotency_records (idempotency_record_id, audit_actor_id, command_type, idempotency_key, request_sha256, execution_status, response_http_status, result_resource_type, result_resource_id, completed_at, created_at) VALUES (?, ?, 'project.create', ?, ?, 'succeeded', 201, 'Project', ?, ?, ?)`).run(id, actor, uuid(), sha256(), uuid(), now(), now());
    const row = db.prepare(`SELECT result_resource_type FROM api_idempotency_records WHERE idempotency_record_id = ?`).get(id) as { result_resource_type: string };
    assert.equal(row.result_resource_type, "Project");
  });

  test("unknown command type still rejected", () => {
    const actor = insertActor();
    assert.throws(() => {
      db.prepare(`INSERT INTO api_idempotency_records (idempotency_record_id, audit_actor_id, command_type, idempotency_key, request_sha256, execution_status, created_at) VALUES (?, ?, 'unknown.command', ?, ?, 'in_progress', ?)`).run(uuid(), actor, uuid(), sha256(), now());
    }, /CHECK/);
  });

  test("unknown result resource type still rejected", () => {
    const actor = insertActor();
    assert.throws(() => {
      db.prepare(`INSERT INTO api_idempotency_records (idempotency_record_id, audit_actor_id, command_type, idempotency_key, request_sha256, execution_status, response_http_status, result_resource_type, result_resource_id, completed_at, created_at) VALUES (?, ?, 'project.create', ?, ?, 'succeeded', 201, 'Unknown', ?, ?, ?)`).run(uuid(), actor, uuid(), sha256(), uuid(), now(), now());
    }, /CHECK/  );
  });

  test("unique constraint preserved on (actor, command, key)", () => {
    const actor = insertActor();
    const key = uuid();
    db.prepare(`INSERT INTO api_idempotency_records (idempotency_record_id, audit_actor_id, command_type, idempotency_key, request_sha256, execution_status, created_at) VALUES (?, ?, 'closure.initiate_cycle', ?, ?, 'in_progress', ?)`).run(uuid(), actor, key, sha256(), now());
    assert.throws(() => {
      db.prepare(`INSERT INTO api_idempotency_records (idempotency_record_id, audit_actor_id, command_type, idempotency_key, request_sha256, execution_status, created_at) VALUES (?, ?, 'closure.initiate_cycle', ?, ?, 'in_progress', ?)`).run(uuid(), actor, key, sha256(), now());
    }, /UNIQUE/);
  });

  test("all terminal status invariants preserved", () => {
    const actor = insertActor();
    // in_progress: no terminal fields
    const id1 = uuid();
    db.prepare(`INSERT INTO api_idempotency_records (idempotency_record_id, audit_actor_id, command_type, idempotency_key, request_sha256, execution_status, created_at) VALUES (?, ?, 'closure.initiate_cycle', ?, ?, 'in_progress', ?)`).run(id1, actor, uuid(), sha256(), now());
    const r1 = db.prepare(`SELECT * FROM api_idempotency_records WHERE idempotency_record_id = ?`).get(id1) as Record<string, unknown>;
    assert.equal(r1.response_http_status, null);
    assert.equal(r1.completed_at, null);

    // succeeded: must have response status + completed_at
    const id2 = uuid();
    db.prepare(`INSERT INTO api_idempotency_records (idempotency_record_id, audit_actor_id, command_type, idempotency_key, request_sha256, execution_status, response_http_status, result_resource_type, result_resource_id, completed_at, created_at) VALUES (?, ?, 'closure.record_s31_translation', ?, ?, 'succeeded', 201, 'ClosureStageFact', ?, ?, ?)`).run(id2, actor, uuid(), sha256(), uuid(), now(), now());
    const r2 = db.prepare(`SELECT * FROM api_idempotency_records WHERE idempotency_record_id = ?`).get(id2) as Record<string, unknown>;
    assert.equal(r2.execution_status, "succeeded");
    assert.equal(r2.response_http_status, 201);
    assert.ok(r2.completed_at);
  });

  test("upgrade path: 0004 DB with old rows → apply 0005 → old data preserved, new closure values work", async () => {
    // Step 1: Create a fresh DB with only migrations 0001-0004
    const upgradeTemp = createTempDataRoot();
    const migrationsDir = join(import.meta.dirname, "..", "persistence", "migrations");
    const upgradeDb = openDatabase(upgradeTemp.layout.sqlitePath);
    const allMigrations = loadMigrations(migrationsDir);
    const migrationsBefore0005 = allMigrations.filter((m) => m.version < 5);
    await runMigrations(upgradeDb, migrationsBefore0005, upgradeTemp.layout);

    // Step 2: Insert old-style idempotency records (only original command types)
    const actorId = uuid();
    upgradeDb.prepare(`INSERT INTO audit_actors (audit_actor_id, actor_kind, actor_key, display_name, created_at) VALUES (?, 'human', ?, ?, ?)`).run(actorId, `k-${actorId}`, `A ${actorId}`, now());

    const oldRecordId = uuid();
    const oldKey = uuid();
    upgradeDb.prepare(`INSERT INTO api_idempotency_records (idempotency_record_id, audit_actor_id, command_type, idempotency_key, request_sha256, execution_status, response_http_status, result_resource_type, result_resource_id, completed_at, created_at) VALUES (?, ?, 'project.create', ?, ?, 'succeeded', 201, 'Project', ?, ?, ?)`).run(oldRecordId, actorId, oldKey, sha256(), uuid(), now(), now());

    const oldInProgressId = uuid();
    upgradeDb.prepare(`INSERT INTO api_idempotency_records (idempotency_record_id, audit_actor_id, command_type, idempotency_key, request_sha256, execution_status, created_at) VALUES (?, ?, 'report.decide_review', ?, ?, 'in_progress', ?)`).run(oldInProgressId, actorId, uuid(), sha256(), now());

    // Verify old records exist before migration
    const beforeCount = (upgradeDb.prepare(`SELECT COUNT(*) AS c FROM api_idempotency_records`).get() as { c: number }).c;
    assert.equal(beforeCount, 2, "Should have 2 old records before migration");

    // Step 3: Apply migration 0005
    const migration0005 = loadMigrationFile(join(migrationsDir, "0005_extend_idempotency_for_closure.sql"));
    upgradeDb.exec(migration0005.sql);

    // Step 4: Verify old records are preserved
    const afterCount = (upgradeDb.prepare(`SELECT COUNT(*) AS c FROM api_idempotency_records`).get() as { c: number }).c;
    assert.equal(afterCount, 2, "Should still have 2 old records after migration");

    const preservedOld = upgradeDb.prepare(`SELECT * FROM api_idempotency_records WHERE idempotency_record_id = ?`).get(oldRecordId) as Record<string, unknown>;
    assert.equal(preservedOld.command_type, "project.create");
    assert.equal(preservedOld.result_resource_type, "Project");
    assert.equal(preservedOld.execution_status, "succeeded");

    const preservedInProgress = upgradeDb.prepare(`SELECT * FROM api_idempotency_records WHERE idempotency_record_id = ?`).get(oldInProgressId) as Record<string, unknown>;
    assert.equal(preservedInProgress.command_type, "report.decide_review");
    assert.equal(preservedInProgress.execution_status, "in_progress");

    // Step 5: Verify new closure command types work
    const newRecordId = uuid();
    upgradeDb.prepare(`INSERT INTO api_idempotency_records (idempotency_record_id, audit_actor_id, command_type, idempotency_key, request_sha256, execution_status, created_at) VALUES (?, ?, 'closure.initiate_cycle', ?, ?, 'in_progress', ?)`).run(newRecordId, actorId, uuid(), sha256(), now());
    const newRecord = upgradeDb.prepare(`SELECT command_type FROM api_idempotency_records WHERE idempotency_record_id = ?`).get(newRecordId) as { command_type: string };
    assert.equal(newRecord.command_type, "closure.initiate_cycle");

    // Step 6: Verify new result resource types work
    const newSucceededId = uuid();
    upgradeDb.prepare(`INSERT INTO api_idempotency_records (idempotency_record_id, audit_actor_id, command_type, idempotency_key, request_sha256, execution_status, response_http_status, result_resource_type, result_resource_id, completed_at, created_at) VALUES (?, ?, 'closure.record_s31_translation', ?, ?, 'succeeded', 201, 'ClosureStageFact', ?, ?, ?)`).run(newSucceededId, actorId, uuid(), sha256(), uuid(), now(), now());
    const newSucceeded = upgradeDb.prepare(`SELECT result_resource_type FROM api_idempotency_records WHERE idempotency_record_id = ?`).get(newSucceededId) as { result_resource_type: string };
    assert.equal(newSucceeded.result_resource_type, "ClosureStageFact");

    // Step 7: Verify unknown types still rejected
    assert.throws(() => {
      upgradeDb.prepare(`INSERT INTO api_idempotency_records (idempotency_record_id, audit_actor_id, command_type, idempotency_key, request_sha256, execution_status, created_at) VALUES (?, ?, 'unknown.command', ?, ?, 'in_progress', ?)`).run(uuid(), actorId, uuid(), sha256(), now());
    }, /CHECK/);

    upgradeDb.close();
    upgradeTemp.cleanup();
  });
});
