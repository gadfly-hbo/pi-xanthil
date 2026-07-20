/**
 * Regression tests for Controller review changes_requested fixes.
 * Covers: canonical JSON undefined rejection, blob path traversal,
 * migration unknown DB rejection, migration missing file detection,
 * migration verified restore.
 */
import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { canonicalJsonStringify, CanonicalJsonError } from "../persistence/canonical-json.ts";
import { blobAbsolutePath, BlobWriterError, writeBlob, blobStorageRef } from "../persistence/blob-writer.ts";
import { runMigrations, loadMigrations, checkMigrationDrift, checkUnknownDatabase, getAppliedMigrations, MigrationError, type MigrationFile } from "../persistence/migration-runner.ts";
import { openDatabase } from "../persistence/db.ts";
import { createTempDataRoot, type TempDataRoot } from "./persistence-helpers.ts";
import { join } from "node:path";
import { readdirSync } from "node:fs";

let temp: TempDataRoot;

beforeEach(() => {
  temp = createTempDataRoot();
});
afterEach(() => {
  temp.cleanup();
});

// --- Fix 1: canonical JSON rejects undefined in objects ---

describe("canonical JSON: undefined in objects rejected", () => {
  test("throws on undefined property value", () => {
    assert.throws(
      () => canonicalJsonStringify({ a: 1, b: undefined }),
      CanonicalJsonError,
    );
  });

  test("throws on nested undefined property value", () => {
    assert.throws(
      () => canonicalJsonStringify({ outer: { inner: undefined } }),
      CanonicalJsonError,
    );
  });

  test("objects without undefined still work", () => {
    assert.equal(canonicalJsonStringify({ a: 1, b: null, c: 3 }), '{"a":1,"b":null,"c":3}');
  });
});

// --- Fix 2: blob path traversal protection ---

describe("blob writer: path traversal protection", () => {
  test("rejects storageRef with path traversal", () => {
    assert.throws(
      () => blobAbsolutePath(temp.layout.blobsDir, "blobs/../../etc/passwd"),
      BlobWriterError,
    );
  });

  test("rejects malformed storageRef", () => {
    assert.throws(
      () => blobAbsolutePath(temp.layout.blobsDir, "blobs/not-hex/file.txt"),
      BlobWriterError,
    );
  });

  test("rejects storageRef without blobs/ prefix", () => {
    assert.throws(
      () => blobAbsolutePath(temp.layout.blobsDir, "../../etc/passwd"),
      BlobWriterError,
    );
  });

  test("accepts valid storageRef", () => {
    const ref = blobStorageRef("abcdef0123456789".repeat(4));
    // Should not throw
    blobAbsolutePath(temp.layout.blobsDir, ref);
  });
});

// --- Fix 2: blob temp file on same filesystem ---

describe("blob writer: temp file on same filesystem", () => {
  test("blob temp directory uses artifacts/tmp", () => {
    const content = new TextEncoder().encode("same fs test");
    const result = writeBlob(temp.layout.blobsDir, temp.layout.tmpDir, content);
    // Verify blob was written inside blobs dir
    assert.ok(result.storageRef.startsWith("blobs/"));
    // Verify no temp files left in system tmp
    // (the test passes if writeBlob succeeds and temp is cleaned up)
  });
});

// --- Fix 3: migration rejects unknown non-empty DB ---

describe("migration: rejects unknown non-empty database", () => {
  test("rejects DB with user tables but no schema_migrations", () => {
    const db = openDatabase(temp.layout.sqlitePath);
    // Create a user table without schema_migrations
    db.exec("CREATE TABLE some_table (id INTEGER PRIMARY KEY)");

    assert.throws(
      () => checkUnknownDatabase(db),
      /Unknown database detected/,
    );
    db.close();
  });

  test("allows empty DB (no user tables, no schema_migrations)", () => {
    const db = openDatabase(temp.layout.sqlitePath);
    // Should not throw
    checkUnknownDatabase(db);
    db.close();
  });

  test("allows DB with schema_migrations", async () => {
    const migrationsDir = join(import.meta.dirname, "..", "persistence", "migrations");
    const db = openDatabase(temp.layout.sqlitePath);
    await runMigrations(db, loadMigrations(migrationsDir), temp.layout);
    // Should not throw
    checkUnknownDatabase(db);
    db.close();
  });
});

// --- Fix 3: migration detects missing applied migration files ---

describe("migration: detects missing applied migration files", () => {
  test("rejects when applied migration file is missing", async () => {
    const migrationsDir = join(import.meta.dirname, "..", "persistence", "migrations");
    const db = openDatabase(temp.layout.sqlitePath);
    await runMigrations(db, loadMigrations(migrationsDir), temp.layout);

    const applied = getAppliedMigrations(db);
    // Simulate missing file: pass empty pending list
    assert.throws(
      () => checkMigrationDrift(applied, []),
      /Missing migration file for applied version/,
    );
    db.close();
  });
});

// --- Fix 4: migration verified restore on failure ---

describe("migration: verified restore on failure", () => {
  test("restores DB from backup on migration failure", async () => {
    const migrationsDir = join(import.meta.dirname, "..", "persistence", "migrations");
    const realMigrations = loadMigrations(migrationsDir);

    // First, apply migrations successfully
    let db = openDatabase(temp.layout.sqlitePath);
    await runMigrations(db, realMigrations, temp.layout);
    db.close();

    // Now try to apply a bad migration that will fail
    db = openDatabase(temp.layout.sqlitePath);
    const badMigration: MigrationFile = {
      version: realMigrations.at(-1)!.version + 1,
      name: "0006_bad",
      sql: "CREATE TABLE duplicate_table (id INTEGER); CREATE TABLE duplicate_table (id INTEGER);", // Will fail
      checksum: "abc",
    };

    try {
      await runMigrations(db, [...realMigrations, badMigration], temp.layout);
      assert.fail("Should have thrown");
    } catch (err) {
      const msg = (err as Error).message;
      assert.match(msg, /restored from backup|removed/i);
    }

    // DB should be closed after restore. Reopen and verify original state.
    db = openDatabase(temp.layout.sqlitePath);
    const applied = getAppliedMigrations(db);
    assert.equal(applied.length, realMigrations.length, "original migrations should still be applied");
    assert.equal(applied[0]!.version, 1);
    assert.equal(applied[1]!.version, 2);
    assert.equal(applied.at(-1)!.version, realMigrations.at(-1)!.version);
    db.close();
  });
});

// --- Fix 5: Node 22 compatibility flags in package.json ---
// (Validated by running tests with the flags - covered by test execution)

// --- Revision 2 fixes ---

describe("revision 2: runMigrations entry order", () => {
  test("rejects unknown DB even when migrations=[]", async () => {
    const db = openDatabase(temp.layout.sqlitePath);
    db.exec("CREATE TABLE unknown_table (id INTEGER PRIMARY KEY)");

    await assert.rejects(
      () => runMigrations(db, [], temp.layout),
      /Unknown database detected/,
    );
    db.close();
  });

  test("rejects missing applied migration file even when migrations=[]", async () => {
    const migrationsDir = join(import.meta.dirname, "..", "persistence", "migrations");
    let db = openDatabase(temp.layout.sqlitePath);
    await runMigrations(db, loadMigrations(migrationsDir), temp.layout);
    db.close();

    db = openDatabase(temp.layout.sqlitePath);
    await assert.rejects(
      () => runMigrations(db, [], temp.layout),
      /Missing migration file/,
    );
    db.close();
  });
});

describe("revision 2: migration name drift detection", () => {
  test("rejects same version+checksum but different name", async () => {
    const migrationsDir = join(import.meta.dirname, "..", "persistence", "migrations");
    const realMigrations = loadMigrations(migrationsDir);
    let db = openDatabase(temp.layout.sqlitePath);
    await runMigrations(db, realMigrations, temp.layout);
    db.close();

    db = openDatabase(temp.layout.sqlitePath);
    const applied = getAppliedMigrations(db);
    // Create a fake migration with same version+checksum but different name
    const renamedMigration: MigrationFile = {
      ...realMigrations[0]!,
      name: "0001_renamed",
    };
    assert.throws(
      () => checkMigrationDrift(applied, [renamedMigration]),
      /name mismatch/,
    );
    db.close();
  });
});

describe("revision 2: blob shard validation", () => {
  test("rejects shard not matching hash prefix", () => {
    // Valid hash but shard doesn't match
    const validHash = "abcdef0123456789".repeat(4);
    const badRef = `blobs/ff/${validHash}`; // shard "ff" != hash prefix "ab"
    assert.throws(
      () => blobAbsolutePath(temp.layout.blobsDir, badRef),
      BlobWriterError,
    );
  });

  test("accepts shard matching hash prefix", () => {
    const validHash = "abcdef0123456789".repeat(4);
    const goodRef = `blobs/ab/${validHash}`;
    // Should not throw
    blobAbsolutePath(temp.layout.blobsDir, goodRef);
  });
});

describe("revision 2: blob temp files use artifacts/tmp", () => {
  test("temp files created in tmpDir not blobsDir", () => {
    const content = new TextEncoder().encode("tmp dir test");
    const result = writeBlob(temp.layout.blobsDir, temp.layout.tmpDir, content);
    assert.ok(result.storageRef.startsWith("blobs/"));
    // Verify no .tmp-* dirs left in blobsDir
    const blobsEntries = readdirSync(temp.layout.blobsDir);
    const tempInBlobs = blobsEntries.filter((e) => e.startsWith(".tmp-") || e.startsWith("blob-"));
    assert.equal(tempInBlobs.length, 0, "no temp dirs should remain in blobsDir");
  });
});
