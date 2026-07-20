/**
 * Importer revision 4 tests (T0014 controller review round 4):
 * - (1) Journal plannedProjectIds must equal source.projectIds EXACTLY: a
 *   completed target plus a matching-fingerprint journal carrying an empty
 *   or subset project set must fail closed with ZERO blob/row deletion
 *   (previously recoverJournals read present===0 as "uncommitted attempt"
 *   and deleted every source-plan blob under committed rows).
 * - (1) State-bound ownership invariant: pre-snapshot states
 *   (started/staged) carrying non-empty ownership arrays are corrupted.
 * - (2) checkAlreadyImported reconciles the COMPLETE durable imported state
 *   (every table's row identities + every planned blob SHA-256) before
 *   returning already_imported; a deleted non-project row or blob fails
 *   closed, and a source non-ID mutation never reuses the prior success.
 * - (3) acquireImportLock: genuinely absent target root is not misreported
 *   as contention (EEXIST vs other fs errors), the lock parent is only
 *   established after the journal gates, lock metadata persists no absolute
 *   paths, and journal-list I/O failures become safe structured failures.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  runImport,
  type DryRunReport,
  type ImportCompleted,
  type ImportFailure,
} from "../import/importer.ts";
import { importsDir } from "../import/journal.ts";
import {
  acquireImportLock,
  releaseImportLock,
  TARGET_IMPORT_LOCK_FILENAME,
} from "../import/import-lock.ts";
import { ImportError } from "../import/errors.ts";
import { buildLayout } from "../persistence/data-root.ts";
import { blobAbsolutePath, blobStorageRef } from "../persistence/blob-writer.ts";
import {
  WORKSPACE_ID,
  createDonorFixture,
  createTargetRoot,
  fakeWorkspacePort,
  openTarget,
  snapshotTree,
  tableCount,
  uid,
  type DonorFixture,
  type TargetRoot,
} from "./import-helpers.ts";

async function withFixtures(
  fn: (source: DonorFixture, target: TargetRoot) => Promise<void>,
): Promise<void> {
  const source = await createDonorFixture();
  const target = await createTargetRoot();
  try {
    await fn(source, target);
  } finally {
    source.cleanup();
    target.cleanup();
  }
}

function baseOptions(source: DonorFixture, target: TargetRoot) {
  return {
    sourceDataRoot: source.root,
    targetDataRoot: target.root,
    targetWorkspaceId: WORKSPACE_ID,
    workspacePort: fakeWorkspacePort(true),
  };
}

function fabricateJournal(target: TargetRoot, journal: object): void {
  const dir = importsDir(target.root);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, `import-${(journal as { attemptId: string }).attemptId}.journal.json`),
    JSON.stringify(journal),
  );
}

function blobFileCount(target: TargetRoot): number {
  return snapshotTree(target.layout.blobsDir).size;
}

// ---------------------------------------------------------------------------
// (1) Exact plannedProjectIds equality: completed target + empty/subset journal
// ---------------------------------------------------------------------------

test("completed target + matching journal with EMPTY plannedProjectIds: fail-closed, zero deletion", async () => {
  await withFixtures(async (source, target) => {
    const first = (await runImport(baseOptions(source, target))) as ImportCompleted;
    assert.equal(first.status, "completed");
    assert.equal(blobFileCount(target), 8);

    // A journal that claims this source's fingerprint but plans NO projects.
    // Pre-R4 this passed the subset check; recovery then read present===0 as
    // an uncommitted attempt and deleted every source-plan blob even though
    // the completed import's rows reference them.
    const att = uid(850);
    fabricateJournal(target, {
      attemptId: att,
      state: "published",
      startedAt: "2026-01-06T00:00:00.000Z",
      sourceFingerprint: first.manifest.sourceFingerprint,
      plannedProjectIds: [],
      preExistingBlobRefs: [],
      createdBlobRefs: [],
      stagingDirName: `import-${att}`,
    });

    const result = (await runImport(baseOptions(source, target))) as ImportFailure;
    assert.equal(result.status, "failed");
    assert.equal(result.error.code, "recovery_journal_corrupt");
    assert.equal(result.phase, "recovery");

    // Zero deletion: every published blob and every committed row survives.
    assert.equal(blobFileCount(target), 8, "no source-plan blob deleted");
    const db = openTarget(target.layout);
    try {
      assert.equal(tableCount(db, "analysis_projects"), 2, "committed rows intact");
      assert.equal(tableCount(db, "run_events"), 5, "non-project rows intact");
    } finally {
      db.close();
    }
    assert.ok(
      existsSync(join(importsDir(target.root), `import-${att}.journal.json`)),
      "source-inconsistent journal retained for manual review",
    );
  });
});

test("completed target + matching journal with SUBSET plannedProjectIds: fail-closed, zero deletion", async () => {
  await withFixtures(async (source, target) => {
    const first = (await runImport(baseOptions(source, target))) as ImportCompleted;
    assert.equal(first.status, "completed");

    const att = uid(851);
    fabricateJournal(target, {
      attemptId: att,
      state: "published",
      startedAt: "2026-01-06T00:00:00.000Z",
      sourceFingerprint: first.manifest.sourceFingerprint,
      plannedProjectIds: [source.ids.p1], // proper subset of [p1, p2]
      preExistingBlobRefs: [],
      createdBlobRefs: [],
      stagingDirName: `import-${att}`,
    });

    const result = (await runImport(baseOptions(source, target))) as ImportFailure;
    assert.equal(result.status, "failed");
    assert.equal(result.error.code, "recovery_journal_corrupt");

    assert.equal(blobFileCount(target), 8, "no source-plan blob deleted");
    const db = openTarget(target.layout);
    try {
      assert.equal(tableCount(db, "analysis_projects"), 2, "committed rows intact");
    } finally {
      db.close();
    }
    assert.ok(existsSync(join(importsDir(target.root), `import-${att}.journal.json`)));
  });
});

test("journal in pre-snapshot state (started) with non-empty ownership arrays is semantic-corrupt", async () => {
  await withFixtures(async (source, target) => {
    const dry = (await runImport({
      ...baseOptions(source, target),
      dryRun: true,
    })) as DryRunReport;
    const fp = dry.source!.fingerprint;
    const att = uid(852);
    fabricateJournal(target, {
      attemptId: att,
      state: "started", // snapshot cannot exist yet; arrays must be empty
      startedAt: "2026-01-06T00:00:00.000Z",
      sourceFingerprint: fp,
      plannedProjectIds: [source.ids.p1, source.ids.p2],
      preExistingBlobRefs: [],
      createdBlobRefs: [blobStorageRef("c".repeat(64))],
      stagingDirName: `import-${att}`,
    });

    const result = (await runImport(baseOptions(source, target))) as ImportFailure;
    assert.equal(result.status, "failed");
    assert.equal(result.error.code, "recovery_journal_corrupt");
    assert.ok(existsSync(join(importsDir(target.root), `import-${att}.journal.json`)));
  });
});

test("journal in pre-snapshot state (staged) with non-empty preExistingBlobRefs is semantic-corrupt", async () => {
  await withFixtures(async (source, target) => {
    const dry = (await runImport({
      ...baseOptions(source, target),
      dryRun: true,
    })) as DryRunReport;
    const fp = dry.source!.fingerprint;
    const att = uid(853);
    fabricateJournal(target, {
      attemptId: att,
      state: "staged", // ownership snapshot only exists from `publishing` on
      startedAt: "2026-01-06T00:00:00.000Z",
      sourceFingerprint: fp,
      plannedProjectIds: [source.ids.p1, source.ids.p2],
      preExistingBlobRefs: [blobStorageRef("d".repeat(64))],
      createdBlobRefs: [],
      stagingDirName: `import-${att}`,
    });

    const result = (await runImport(baseOptions(source, target))) as ImportFailure;
    assert.equal(result.status, "failed");
    assert.equal(result.error.code, "recovery_journal_corrupt");
    assert.ok(existsSync(join(importsDir(target.root), `import-${att}.journal.json`)));
  });
});

// ---------------------------------------------------------------------------
// (2) checkAlreadyImported full durable-state + blob reconciliation
// ---------------------------------------------------------------------------

test("deleted non-project row after a completed import: no already_imported short-circuit", async () => {
  await withFixtures(async (source, target) => {
    const first = (await runImport(baseOptions(source, target))) as ImportCompleted;
    assert.equal(first.status, "completed");

    // Damage the target: remove one run_events row (project rows untouched).
    const db = openTarget(target.layout);
    db.prepare(`DELETE FROM run_events WHERE run_event_id = ?`).run(uid(200));
    db.close();

    const result = (await runImport(baseOptions(source, target))) as ImportFailure;
    assert.equal(result.status, "failed");
    assert.equal(result.error.code, "conflict_partial_state");
    assert.equal(result.phase, "already_imported");

    // Fail closed: the importer did not attempt a repair/re-insert.
    const db2 = openTarget(target.layout);
    try {
      assert.equal(tableCount(db2, "run_events"), 4, "damaged state preserved for manual resolution");
      assert.equal(tableCount(db2, "analysis_projects"), 2);
    } finally {
      db2.close();
    }
  });
});

test("deleted referenced blob after a completed import: no already_imported short-circuit", async () => {
  await withFixtures(async (source, target) => {
    const first = (await runImport(baseOptions(source, target))) as ImportCompleted;
    assert.equal(first.status, "completed");

    // Damage the target: remove one referenced blob from the target store.
    const e0Ref = source.blobRefs[4]!;
    const targetBlob = blobAbsolutePath(target.layout.blobsDir, e0Ref);
    rmSync(targetBlob);
    assert.equal(blobFileCount(target), 7);

    const result = (await runImport(baseOptions(source, target))) as ImportFailure;
    assert.equal(result.status, "failed");
    assert.equal(result.error.code, "conflict_partial_state");
    assert.equal(result.phase, "already_imported");

    // Fail closed before staging: the blob is NOT silently re-published.
    assert.equal(existsSync(targetBlob), false, "no silent blob repair");
    const db = openTarget(target.layout);
    try {
      assert.equal(tableCount(db, "analysis_projects"), 2, "rows untouched");
    } finally {
      db.close();
    }
  });
});

test("source non-ID mutation after a completed import does not reuse the prior success", async () => {
  await withFixtures(async (source, target) => {
    const first = (await runImport(baseOptions(source, target))) as ImportCompleted;
    assert.equal(first.status, "completed");

    // Mutate a non-ID scalar in the donor (fingerprint drifts; IDs unchanged).
    const tamper = new DatabaseSync(source.layout.sqlitePath);
    tamper.exec("PRAGMA ignore_check_constraints = ON");
    tamper.prepare(
      `UPDATE analysis_projects SET title = ? WHERE analysis_project_id = ?`,
    ).run("Mutated Title", source.ids.p1);
    tamper.close();

    // The drifted source must NOT see the prior completed manifest; the
    // durable IDs already exist, so the run fails closed on conflict instead
    // of returning already_imported or duplicating rows.
    const result = (await runImport(baseOptions(source, target))) as ImportFailure;
    assert.equal(result.status, "failed");
    assert.equal(result.error.code, "conflict_durable_id");
    assert.equal(result.phase, "conflict");

    const db = openTarget(target.layout);
    try {
      assert.equal(tableCount(db, "analysis_projects"), 2, "no duplicate rows");
      const row = db.prepare(
        `SELECT title FROM analysis_projects WHERE analysis_project_id = ?`,
      ).get(source.ids.p1) as { title: string };
      assert.equal(row.title, "Donor Project One", "target content not overwritten");
    } finally {
      db.close();
    }
  });
});

// ---------------------------------------------------------------------------
// (3) Import lock: absent target root, error discrimination, safe metadata,
//     journal-list I/O structured failures
// ---------------------------------------------------------------------------

test("end-to-end allowTargetInit with a genuinely absent target root completes", async () => {
  const source = await createDonorFixture();
  const probe = await createTargetRoot();
  const absentRoot = `${probe.root}-absent`;
  probe.cleanup();
  const options = {
    sourceDataRoot: source.root,
    targetDataRoot: absentRoot,
    targetWorkspaceId: WORKSPACE_ID,
    workspacePort: fakeWorkspacePort(true),
    allowTargetInit: true,
  };
  try {
    assert.equal(existsSync(absentRoot), false, "target root genuinely absent");

    // Dry-run stays read-only: it must not create the target root.
    const dry = (await runImport({ ...options, dryRun: true })) as DryRunReport;
    assert.equal(dry.ok, true);
    assert.equal(dry.target?.plannedInit, true);
    assert.equal(existsSync(absentRoot), false, "dry-run created nothing");

    // Real run: lock parent is established after the journal gates, then
    // initDataRoot + migrations proceed under the held lock.
    const result = (await runImport(options)) as ImportCompleted;
    assert.equal(result.status, "completed");
    const layout = buildLayout(absentRoot);
    assert.ok(existsSync(layout.sqlitePath), "target DB created under the new root");
    assert.equal(
      existsSync(join(absentRoot, TARGET_IMPORT_LOCK_FILENAME)),
      false,
      "lock released after completion",
    );

    // Re-run against the now-initialized root: already_imported.
    const second = await runImport(options);
    assert.equal(second.status, "already_imported");
  } finally {
    rmSync(absentRoot, { recursive: true, force: true });
    source.cleanup();
  }
});

test("acquireImportLock: absent parent is target_root_invalid, contention is target_import_locked, metadata has no absolute path", () => {
  const root = mkdtempSync(join(tmpdir(), "xanthil-import-lock-"));
  try {
    // A genuinely absent parent is NOT lock contention.
    assert.throws(
      () => acquireImportLock(join(root, "does-not-exist"), uid(860), () => new Date()),
      (err: unknown) =>
        err instanceof ImportError && err.code === "target_root_invalid",
    );

    // Successful acquire; a second acquire on the same root is contention.
    const now = () => new Date("2026-07-19T14:00:00.000Z");
    const lock = acquireImportLock(root, uid(861), now);
    assert.throws(
      () => acquireImportLock(root, uid(862), now),
      (err: unknown) =>
        err instanceof ImportError && err.code === "target_import_locked",
    );

    // Persisted metadata: diagnostic fields only, never absolute paths.
    const raw = readFileSync(join(root, TARGET_IMPORT_LOCK_FILENAME), "utf8");
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    assert.equal(parsed.attemptId, uid(861));
    assert.equal(parsed.acquiredAt, "2026-07-19T14:00:00.000Z");
    assert.equal(parsed.host, "kimi-import");
    assert.ok(!("path" in parsed), "lock metadata must not persist the absolute path");
    assert.ok(!raw.includes(root), "lock metadata contains no absolute path");

    releaseImportLock(lock);
    assert.equal(existsSync(join(root, TARGET_IMPORT_LOCK_FILENAME)), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("imports path as a plain file: journal-list I/O fails structured, never a raw throw", async () => {
  await withFixtures(async (source, target) => {
    // Make imports/ unreadable as a directory: listJournals cannot readdir it.
    writeFileSync(join(target.root, "imports"), "not-a-directory");

    // runImport must RESOLVE with a structured failure, not reject.
    const result = (await runImport(baseOptions(source, target))) as ImportFailure;
    assert.equal(result.status, "failed");
    assert.equal(result.error.code, "recovery_journal_corrupt");
    assert.equal(result.phase, "recovery");

    const dry = (await runImport({
      ...baseOptions(source, target),
      dryRun: true,
    })) as DryRunReport;
    assert.equal(dry.ok, false);
    assert.equal(dry.errors[0]?.code, "recovery_journal_corrupt");

    // No mutation beyond the planted file: no DB rows imported.
    const db = openTarget(target.layout);
    try {
      assert.equal(tableCount(db, "analysis_projects"), 0);
    } finally {
      db.close();
    }
  });
});
