/**
 * Tests for database connection wrapper (db.ts).
 * Covers: read-only mode enforcement via DatabaseSync readOnly option,
 * foreign_keys PRAGMA, and write rejection in read-only mode.
 */
import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { openDatabase } from "../persistence/db.ts";
import { runMigrations, loadMigrations } from "../persistence/migration-runner.ts";
import { createTempDataRoot, type TempDataRoot } from "./persistence-helpers.ts";
import { join } from "node:path";

let temp: TempDataRoot;

beforeEach(() => {
  temp = createTempDataRoot();
});

afterEach(() => {
  temp.cleanup();
});

describe("openDatabase - read-only mode", () => {
  test("write operations are rejected in readOnly mode", async () => {
    // First create and migrate the database
    const migrationsDir = join(import.meta.dirname, "..", "persistence", "migrations");
    const migrations = loadMigrations(migrationsDir);
    let db = openDatabase(temp.layout.sqlitePath);
    await runMigrations(db, migrations, temp.layout);
    db.close();

    // Reopen in read-only mode
    db = openDatabase(temp.layout.sqlitePath, { readOnly: true });

    // Reads should succeed
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
    assert.ok(tables.length > 0, "reads should work in readOnly mode");

    // Writes should be rejected at the SQLite layer
    assert.throws(
      () => db.exec("CREATE TABLE should_fail (id INTEGER)"),
      /readonly|read-only/i,
    );
    assert.throws(
      () => db.prepare("INSERT INTO audit_actors (audit_actor_id, actor_kind, actor_key, display_name, created_at) VALUES (?, ?, ?, ?, ?)").run("x", "human", "k", "n", "2026-01-01T00:00:00Z"),
      /readonly|read-only/i,
    );

    db.close();
  });

  test("readOnly connection still enforces foreign_keys PRAGMA", async () => {
    const migrationsDir = join(import.meta.dirname, "..", "persistence", "migrations");
    const migrations = loadMigrations(migrationsDir);
    let db = openDatabase(temp.layout.sqlitePath);
    await runMigrations(db, migrations, temp.layout);
    db.close();

    db = openDatabase(temp.layout.sqlitePath, { readOnly: true });
    const fk = db.prepare("PRAGMA foreign_keys").get() as { foreign_keys: number };
    assert.equal(fk.foreign_keys, 1, "foreign_keys must be ON even in readOnly mode");
    db.close();
  });

  test("read-write mode allows writes (control test)", async () => {
    const migrationsDir = join(import.meta.dirname, "..", "persistence", "migrations");
    const migrations = loadMigrations(migrationsDir);
    const db = openDatabase(temp.layout.sqlitePath);
    await runMigrations(db, migrations, temp.layout);

    // Write should succeed in read-write mode
    db.prepare(
      "INSERT INTO audit_actors (audit_actor_id, actor_kind, actor_key, display_name, created_at) VALUES (?, ?, ?, ?, ?)",
    ).run("test-id", "human", "key-test", "Test", "2026-01-01T00:00:00Z");

    const row = db.prepare("SELECT display_name FROM audit_actors WHERE audit_actor_id = ?").get("test-id") as { display_name: string };
    assert.equal(row.display_name, "Test");

    db.close();
  });
});
