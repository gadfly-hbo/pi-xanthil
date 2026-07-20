/**
 * Importer CLI end-to-end tests: flag parsing, read-only xanthil.db
 * workspace port, safe JSON output, and exit codes.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
import {
  WORKSPACE_ID,
  createDonorFixture,
  createTargetRoot,
} from "./import-helpers.ts";

const CLI_PATH = join(import.meta.dirname, "..", "import", "cli.ts");

function createXanthilDb(): { path: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), "xanthil-import-xdb-"));
  const dbPath = join(dir, "xanthil.db");
  const db = new DatabaseSync(dbPath);
  db.exec(
    `CREATE TABLE workspaces (id TEXT PRIMARY KEY, name TEXT NOT NULL, root_path TEXT NOT NULL, created_at INTEGER)`,
  );
  db.prepare(`INSERT INTO workspaces (id, name, root_path, created_at) VALUES (?, ?, ?, ?)`).run(
    WORKSPACE_ID,
    "WorkCanger 迁移",
    "/tmp/ws",
    1,
  );
  db.close();
  return { path: dbPath, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

function runCli(args: readonly string[]): { code: number; stdout: string; stderr: string } {
  const proc = spawnSync(
    process.execPath,
    ["--experimental-sqlite", "--experimental-strip-types", CLI_PATH, ...args],
    { encoding: "utf8", timeout: 120_000 },
  );
  return {
    code: proc.status ?? -1,
    stdout: proc.stdout ?? "",
    stderr: proc.stderr ?? "",
  };
}

test("CLI dry-run exits 0 with a safe ok report", async () => {
  const source = await createDonorFixture();
  const target = await createTargetRoot();
  const xdb = createXanthilDb();
  try {
    const { code, stdout, stderr } = runCli([
      "--source-root", source.root,
      "--target-root", target.root,
      "--workspace-id", WORKSPACE_ID,
      "--xanthil-db", xdb.path,
      "--dry-run",
    ]);
    assert.equal(code, 0, `stderr: ${stderr}`);
    const parsed = JSON.parse(stdout.trim()) as { kind: string; ok: boolean };
    assert.equal(parsed.kind, "dry_run");
    assert.equal(parsed.ok, true);
    assert.ok(!stdout.includes(source.root), "CLI output must not contain absolute paths");
  } finally {
    source.cleanup();
    target.cleanup();
    xdb.cleanup();
  }
});

test("CLI real import exits 0 and completes", async () => {
  const source = await createDonorFixture();
  const target = await createTargetRoot();
  const xdb = createXanthilDb();
  try {
    const { code, stdout, stderr } = runCli([
      "--source-root", source.root,
      "--target-root", target.root,
      "--workspace-id", WORKSPACE_ID,
      "--xanthil-db", xdb.path,
    ]);
    assert.equal(code, 0, `stderr: ${stderr}`);
    const parsed = JSON.parse(stdout.trim()) as { status: string };
    assert.equal(parsed.status, "completed");
    assert.ok(!stdout.includes(source.root));
  } finally {
    source.cleanup();
    target.cleanup();
    xdb.cleanup();
  }
});

test("CLI exits 1 with workspace_not_found for an unknown workspace", async () => {
  const source = await createDonorFixture();
  const target = await createTargetRoot();
  const xdb = createXanthilDb();
  try {
    const { code, stdout } = runCli([
      "--source-root", source.root,
      "--target-root", target.root,
      "--workspace-id", "ws-does-not-exist",
      "--xanthil-db", xdb.path,
    ]);
    assert.equal(code, 1);
    const parsed = JSON.parse(stdout.trim()) as { status: string; error: { code: string } };
    assert.equal(parsed.status, "failed");
    assert.equal(parsed.error.code, "workspace_not_found");
  } finally {
    source.cleanup();
    target.cleanup();
    xdb.cleanup();
  }
});

test("CLI exits 2 on usage error", () => {
  const { code, stdout } = runCli(["--source-root", "/tmp/x"]);
  assert.equal(code, 2);
  const parsed = JSON.parse(stdout.trim()) as { kind: string };
  assert.equal(parsed.kind, "usage_error");
});
