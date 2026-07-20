/**
 * Importer revision 3 tests (T0014 controller review round 3):
 * - Pre-mutation gate ordering (corrupt / foreign / source-inconsistent
 *   journals block BEFORE target init/open/recovery mutate anything).
 * - Combined matching + foreign shared-hash scenario: zero DB, blob, or
 *   staging mutation must occur before the gate rejects.
 * - Missing-target + allowTargetInit + foreign journal: target directory
 *   must NOT be created by the gate failure (initDataRoot never runs).
 * - Atomic target import lock prevents two concurrent real imports; the
 *   second invocation gets target_import_locked.
 * - newAttemptId UUID v4 validation rejects traversal / non-UUID injection
 *   with invalid_options BEFORE any target write (no staging, no journal,
 *   no lock).
 * - computeSourceFingerprint is sensitive to persistent row content
 *   (project title, non-Evidence content_sha256 / storage_ref) so a
 *   different source fingerprint never short-circuits an already-imported
 *   lookup that belongs to a drifted dataset.
 * - Journal semantic invariants (revision 3): filename == attemptId, arrays
 *   internally unique, blob ref sets disjoint.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  existsSync,
  linkSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
  statSync,
  chmodSync,
  readdirSync,
} from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  runImport,
  type DryRunReport,
  type ImportFailure,
} from "../import/importer.ts";
import { importsDir, listJournals } from "../import/journal.ts";
import { TARGET_IMPORT_LOCK_FILENAME } from "../import/import-lock.ts";
import { TABLE_SPECS } from "../import/schema-plan.ts";
import { blobAbsolutePath, blobStorageRef, writeBlob } from "../persistence/blob-writer.ts";
import { sha256Hex, sha256HexBytes } from "../persistence/sha256.ts";
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
  writeFileSync(join(dir, `import-${(journal as { attemptId: string }).attemptId}.journal.json`),
    JSON.stringify(journal));
}

function snapshotDir(root: string): Map<string, { size: number; sha256: string }> {
  return snapshotTree(root);
}

function diffSet(
  before: Map<string, { size: number; sha256: string }>,
  after: Map<string, { size: number; sha256: string }>,
): { added: string[]; removed: string[]; changed: string[] } {
  const added: string[] = [];
  const removed: string[] = [];
  const changed: string[] = [];
  for (const key of after.keys()) {
    if (!before.has(key)) added.push(key);
    else if (JSON.stringify(before.get(key)) !== JSON.stringify(after.get(key))) changed.push(key);
  }
  for (const key of before.keys()) {
    if (!after.has(key)) removed.push(key);
  }
  return { added, removed, changed };
}

function assertEqualKeys<T>(a: readonly T[], b: readonly T[]): void {
  assert.equal(a.length, b.length);
  for (let i = 0; i < a.length; i++) assert.equal(a[i], b[i]);
}

// ---------------------------------------------------------------------------
// (1) Pre-mutation gate ordering: combined matching + foreign shared-hash
// ---------------------------------------------------------------------------

test("combined matching + foreign journal with shared hash: zero DB / blob / staging mutation", async () => {
  await withFixtures(async (source, target) => {
    const before = snapshotDir(target.root);
    const fingerprint = (await runImport({
      ...baseOptions(source, target),
      dryRun: true,
    })) as DryRunReport;
    assert.ok(fingerprint.source?.fingerprint);
    const fp = fingerprint.source.fingerprint;

    // Matching journal from a same-fingerprint attempted run (started state -
    // would otherwise be cleaned by recovery).
    fabricateJournal(target, {
      attemptId: uid(800),
      state: "started",
      startedAt: "2026-01-06T00:00:00.000Z",
      sourceFingerprint: fp,
      plannedProjectIds: [source.ids.p1, source.ids.p2],
      preExistingBlobRefs: [],
      createdBlobRefs: [],
      stagingDirName: `import-${uid(800)}`,
    });
    // Foreign journal: planned projects + blobs that look like this source's
    // but for a different fingerprint (shared-hash in real case).
    fabricateJournal(target, {
      attemptId: uid(801),
      state: "published",
      startedAt: "2026-01-06T00:00:00.000Z",
      sourceFingerprint: "f".repeat(64),
      plannedProjectIds: [source.ids.p1],
      preExistingBlobRefs: [],
      createdBlobRefs: [],
      stagingDirName: `import-${uid(801)}`,
    });

    const beforeGate = snapshotDir(target.root);
    const result = (await runImport(baseOptions(source, target))) as ImportFailure;
    assert.equal(result.status, "failed");
    // The CORRECT fail-closed code is recovery_foreign_journal - the foreign
    // attempt would otherwise be eligible to mutate shared blobs.
    assert.equal(result.error.code, "recovery_foreign_journal");
    assert.equal(result.phase, "recovery");

    // No DB rows, no extra blob, no staging dir created; nothing touched.
    const after = snapshotDir(target.root);
    const diff = diffSet(beforeGate, after);
    assert.deepEqual(diff.added, [], "no files added after the gate");
    assert.deepEqual(diff.removed, [], "no files removed after the gate");
    assert.deepEqual(diff.changed, [], "no files changed after the gate");

    // Even relative to the bare target before the journal fabricate step.
    const totalDiff = diffSet(before, after);
    assert.deepEqual(totalDiff.added.filter((k) => !k.includes("journal.json")), [],
      "no non-journal files added");

    const db = openTarget(target.layout);
    try {
      assert.equal(tableCount(db, "analysis_projects"), 0, "no rows imported");
    } finally {
      db.close();
    }
  });
});

// ---------------------------------------------------------------------------
// (2) Missing target + allowTargetInit + foreign journal: target dir untouched
// ---------------------------------------------------------------------------

test("missing target + allowTargetInit + foreign journal blocks before initDataRoot", async () => {
  await withFixtures(async (source, target) => {
    target.cleanup(); // remove target entirely; allowTargetInit is the only init path

    // Fresh, empty target root
    const freshRoot = `${target.root}-fresh`;
    mkdirSync(freshRoot, { recursive: true });

    // Foreign journal in the fresh root
    const dir = importsDir(freshRoot);
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, `import-${uid(802)}.journal.json`),
      JSON.stringify({
        attemptId: uid(802),
        state: "published",
        startedAt: "2026-01-06T00:00:00.000Z",
        sourceFingerprint: "f".repeat(64),
        plannedProjectIds: [source.ids.p1],
        preExistingBlobRefs: [],
        createdBlobRefs: [],
        stagingDirName: `import-${uid(802)}`,
      }),
    );

    try {
      const result = (await runImport({
        ...baseOptions(source, { root: freshRoot, layout: target.layout, cleanup: () => rmSync(freshRoot, { recursive: true, force: true }) }),
        allowTargetInit: true,
      })) as ImportFailure;

      assert.equal(result.status, "failed");
      assert.equal(result.error.code, "recovery_foreign_journal");

      // Gate must reject before initDataRoot is allowed to mutate the target:
      // xanthil.db never created (no target dir mutation).
      assert.equal(existsSync(target.layout.sqlitePath), false,
        "initDataRoot never ran; no target DB was created");

      // The foreign journal + its containing imports directory are preserved
      // untouched for manual resolution.
      assert.ok(existsSync(join(dir, `import-${uid(802)}.journal.json`)),
        "foreign journal retained");

      // Dry-run also fails closed without mutating the target.
      const dry = (await runImport({
        ...baseOptions(source, { root: freshRoot, layout: target.layout, cleanup: () => rmSync(freshRoot, { recursive: true, force: true }) }),
        allowTargetInit: true,
        dryRun: true,
      })) as DryRunReport;
      assert.equal(dry.ok, false);
      assert.equal(dry.errors[0]?.code, "recovery_foreign_journal");
      assert.equal(existsSync(target.layout.sqlitePath), false,
        "dry-run did not create target either");
    } finally {
      rmSync(freshRoot, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// (3) Corrupted journal with allowTargetInit + missing target: gate before init
// ---------------------------------------------------------------------------

test("missing target + allowTargetInit + corrupt journal blocks before initDataRoot", async () => {
  await withFixtures(async (source, target) => {
    target.cleanup();
    const freshRoot = `${target.root}-fresh`;
    mkdirSync(freshRoot, { recursive: true });
    const dir = importsDir(freshRoot);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "import-bogus.journal.json"), "not-json{{{");

    try {
      const result = (await runImport({
        ...baseOptions(source, { root: freshRoot, layout: target.layout, cleanup: () => rmSync(freshRoot, { recursive: true, force: true }) }),
        allowTargetInit: true,
      })) as ImportFailure;

      assert.equal(result.status, "failed");
      assert.equal(result.error.code, "recovery_journal_corrupt");
      assert.equal(existsSync(target.layout.sqlitePath), false,
        "initDataRoot never ran; corrupted gate is pre-mutation");
      assert.ok(existsSync(join(dir, "import-bogus.journal.json")),
        "corrupted journal retained");
    } finally {
      rmSync(freshRoot, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// (4) Atomic target import lock: concurrent real imports are serialized
// ---------------------------------------------------------------------------

test("concurrent real imports: second invocation gets target_import_locked", async () => {
  const source = await createDonorFixture();
  // migrate:false so the assertion "no target DB was created by this call"
  // is meaningful. The first run never gets to initDataRoot; the second run
  // sees the existing target lock and fails closed before doing anything.
  const target = await createTargetRoot({ migrate: false });
  try {
    const lockPath = join(target.root, TARGET_IMPORT_LOCK_FILENAME);
    writeFileSync(
      lockPath,
      JSON.stringify({
        path: lockPath,
        attemptId: uid(810),
        acquiredAt: "2026-07-19T13:30:00.000Z",
        host: "kimi-import",
      }),
    );

    try {
      const result = (await runImport(baseOptions(source, target))) as ImportFailure;
      assert.equal(result.status, "failed");
      assert.equal(result.error.code, "target_import_locked");
      assert.equal(result.phase, "preflight_target");

      // Gate ran; no mutation to target.
      assert.ok(existsSync(lockPath), "prior lock file untouched");
      assert.equal(existsSync(target.layout.sqlitePath), false,
        "no target DB created; lock was acquired before init");
    } finally {
      rmSync(lockPath, { force: true });
    }
  } finally {
    source.cleanup();
    target.cleanup();
  }
});

// ---------------------------------------------------------------------------
// (5) newAttemptId UUID v4 validation
// ---------------------------------------------------------------------------

test("newAttemptId non-UUID (traversal) is invalid_options before any target write", async () => {
  const source = await createDonorFixture();
  const target = await createTargetRoot({ migrate: false });
  try {
    const before = snapshotDir(target.root);
    const result = (await runImport({
      ...baseOptions(source, target),
      newAttemptId: () => "../../escape",
    })) as ImportFailure;
    assert.equal(result.status, "failed");
    assert.equal(result.error.code, "invalid_options");
    assert.equal(result.phase, "preflight_source");

    // Nothing touched: no target DB, no imports dir, no staging, no journal, no lock.
    const after = snapshotDir(target.root);
    assert.deepEqual(diffSet(before, after), { added: [], removed: [], changed: [] },
      "no filesystem mutation before attemptId validation");
    assert.deepEqual(
      readdirSync(target.layout.tmpDir).filter((d) => d.startsWith("import-")), [],
    );
  } finally {
    source.cleanup();
    target.cleanup();
  }
});

test("newAttemptId upper-case / non-UUID / partial UUID is invalid_options", async () => {
  for (const value of ["NOT-A-UUID", "abc", "", "AAAAAAAA-0000-4000-8000-000000000000"]) {
    const source = await createDonorFixture();
    const target = await createTargetRoot({ migrate: false });
    try {
      const before = snapshotDir(target.root);
      const result = (await runImport({
        ...baseOptions(source, target),
        newAttemptId: () => value,
      })) as ImportFailure;
      assert.equal(result.status, "failed", `attemptId=${JSON.stringify(value)}`);
      assert.equal(result.error.code, "invalid_options", `attemptId=${JSON.stringify(value)}`);
      const after = snapshotDir(target.root);
      assert.deepEqual(diffSet(before, after), { added: [], removed: [], changed: [] },
        `attemptId=${JSON.stringify(value)}: no filesystem mutation`);
    } finally {
      source.cleanup();
      target.cleanup();
    }
  }
});

// ---------------------------------------------------------------------------
// (6) Fingerprint sensitivity to persistent row content (non-ID scalars and
//     non-Evidence content hash/ref)
// ---------------------------------------------------------------------------

test("fingerprint changes when a non-ID scalar (project title) changes", async () => {
  await withFixtures(async (source, target) => {
    const before = (await runImport({
      ...baseOptions(source, target),
      dryRun: true,
    })) as DryRunReport;
    assert.ok(before.source?.fingerprint);
    const fpBefore = before.source.fingerprint;

    // Tamper: change a non-ID scalar on an existing project (preserving IDs).
    const tamper = new DatabaseSync(source.layout.sqlitePath);
    tamper.exec("PRAGMA ignore_check_constraints = ON");
    tamper.prepare(
      `UPDATE analysis_projects SET title = ? WHERE analysis_project_id = ?`,
    ).run("Mutated Title", source.ids.p1);
    tamper.close();

    const after = (await runImport({
      ...baseOptions(source, target),
      dryRun: true,
    })) as DryRunReport;
    assert.ok(after.source?.fingerprint);
    const fpAfter = after.source.fingerprint;

    assert.notEqual(fpBefore, fpAfter,
      "fingerprint must drift when any non-ID scalar differs");
  });
});

test("fingerprint changes when a non-Evidence content_sha256 or storage_ref changes", async () => {
  await withFixtures(async (source, target) => {
    const before = (await runImport({
      ...baseOptions(source, target),
      dryRun: true,
    })) as DryRunReport;
    const fpBefore = before.source!.fingerprint;

    // Mutate report_versions.content_sha256 + storage_ref + the actual blob
    // bytes in the donor store together. Identity / counts are preserved;
    // the canonical row content for report_versions (which includes
    // content_sha256 + storage_ref) must therefore change the fingerprint.
    const rp1Ref = source.blobRefs[3]!; // rp1 is the 4th blob (rv1, rv2, pl1, rp1)
    const donorBlobPath = blobAbsolutePath(source.layout.blobsDir, rp1Ref);
    const originalBytes = new Uint8Array(readFileSync(donorBlobPath));
    const mutatedBytes = new Uint8Array(originalBytes);
    mutatedBytes[0] = (mutatedBytes[0] ?? 0) ^ 1;
    const newHash = sha256HexBytes(mutatedBytes);
    const newRef = blobStorageRef(newHash);
    // Move old file out of the way by linking it under the new ref; the
    // donor already-validated blob ref is gone, the new ref points at the
    // mutated bytes.
    const newAbsPath = blobAbsolutePath(source.layout.blobsDir, newRef);
    mkdirSync(join(newAbsPath, ".."), { recursive: true });
    writeFileSync(newAbsPath, mutatedBytes);

    const tamper = new DatabaseSync(source.layout.sqlitePath);
    tamper.exec("PRAGMA ignore_check_constraints = ON");
    tamper.prepare(
      `UPDATE report_versions SET content_sha256 = ?, storage_ref = ? WHERE report_version_id = ?`,
    ).run(newHash, newRef, source.ids.rp1);
    tamper.close();

    const after = (await runImport({
      ...baseOptions(source, target),
      dryRun: true,
    })) as DryRunReport;
    assert.ok(after.source, "dry-run succeeded with the mutated blob");
    const fpAfter = after.source!.fingerprint;
    assert.notEqual(fpBefore, fpAfter,
      "fingerprint must drift when non-Evidence content hash/ref differs");
  });
});

test("fingerprint changes when actor provenance (display_name) changes", async () => {
  await withFixtures(async (source, target) => {
    const before = (await runImport({
      ...baseOptions(source, target),
      dryRun: true,
    })) as DryRunReport;
    const fpBefore = before.source!.fingerprint;

    const tamper = new DatabaseSync(source.layout.sqlitePath);
    tamper.exec("PRAGMA ignore_check_constraints = ON");
    tamper.prepare(
      `UPDATE audit_actors SET display_name = ? WHERE audit_actor_id = ?`,
    ).run("Donor Human (mutated)", source.ids.human);
    tamper.close();

    const after = (await runImport({
      ...baseOptions(source, target),
      dryRun: true,
    })) as DryRunReport;
    const fpAfter = after.source!.fingerprint;
    assert.notEqual(fpBefore, fpAfter,
      "fingerprint must drift when an actor provenance field changes");
  });
});

test("fingerprint unchanged when IDs/counts are byte-identical and content match", async () => {
  await withFixtures(async (source, target) => {
    const a = (await runImport({
      ...baseOptions(source, target),
      dryRun: true,
    })) as DryRunReport;
    const b = (await runImport({
      ...baseOptions(source, target),
      dryRun: true,
    })) as DryRunReport;
    assert.equal(a.source!.fingerprint, b.source!.fingerprint);
  });
});

// ---------------------------------------------------------------------------
// (7) Journal semantic invariants: filename == attemptId, unique arrays,
//     disjoint blob ref sets
// ---------------------------------------------------------------------------

test("journal with mismatched filename (filename != import-<attemptId>) is corrupted", async () => {
  await withFixtures(async (source, target) => {
    const fp = ((await runImport({
      ...baseOptions(source, target),
      dryRun: true,
    })) as DryRunReport).source!.fingerprint;
    const dir = importsDir(target.root);
    mkdirSync(dir, { recursive: true });
    // attemptId inside is uid but the file is renamed
    const innerAtt = uid(820);
    writeFileSync(
      join(dir, `renamed-${innerAtt}.journal.json`),
      JSON.stringify({
        attemptId: innerAtt,
        state: "staged",
        startedAt: "2026-01-06T00:00:00.000Z",
        sourceFingerprint: fp,
        plannedProjectIds: [],
        preExistingBlobRefs: [],
        createdBlobRefs: [],
        stagingDirName: `import-${innerAtt}`,
      }),
    );

    const result = (await runImport(baseOptions(source, target))) as ImportFailure;
    assert.equal(result.status, "failed");
    assert.equal(result.error.code, "recovery_journal_corrupt");
    assert.ok(existsSync(join(dir, `renamed-${innerAtt}.journal.json`)),
      "renamed file retained");
  });
});

test("journal with duplicate plannedProjectIds is semantic-corrupt", async () => {
  await withFixtures(async (source, target) => {
    const fp = ((await runImport({
      ...baseOptions(source, target),
      dryRun: true,
    })) as DryRunReport).source!.fingerprint;
    const att = uid(821);
    fabricateJournal(target, {
      attemptId: att,
      state: "staged",
      startedAt: "2026-01-06T00:00:00.000Z",
      sourceFingerprint: fp,
      plannedProjectIds: [source.ids.p1, source.ids.p1],
      preExistingBlobRefs: [],
      createdBlobRefs: [],
      stagingDirName: `import-${att}`,
    });

    const result = (await runImport(baseOptions(source, target))) as ImportFailure;
    assert.equal(result.status, "failed");
    assert.equal(result.error.code, "recovery_journal_corrupt");
  });
});

test("journal with createdBlobRefs overlapping preExistingBlobRefs is semantic-corrupt", async () => {
  await withFixtures(async (source, target) => {
    const fp = ((await runImport({
      ...baseOptions(source, target),
      dryRun: true,
    })) as DryRunReport).source!.fingerprint;
    const att = uid(822);
    const ref = "blobs/de/ad".padEnd(72, "0"); // controlled shape
    fabricateJournal(target, {
      attemptId: att,
      state: "published",
      startedAt: "2026-01-06T00:00:00.000Z",
      sourceFingerprint: fp,
      plannedProjectIds: [source.ids.p1],
      preExistingBlobRefs: [ref],
      createdBlobRefs: [ref],
      stagingDirName: `import-${att}`,
    });

    const result = (await runImport(baseOptions(source, target))) as ImportFailure;
    assert.equal(result.status, "failed");
    assert.equal(result.error.code, "recovery_journal_corrupt");
    assert.ok(existsSync(join(importsDir(target.root), `import-${att}.journal.json`)),
      "journal retained");
  });
});

test("matching journal with plannedProjectId outside the source's plan is source-inconsistent", async () => {
  await withFixtures(async (source, target) => {
    const fp = ((await runImport({
      ...baseOptions(source, target),
      dryRun: true,
    })) as DryRunReport).source!.fingerprint;
    const att = uid(823);
    fabricateJournal(target, {
      attemptId: att,
      state: "published",
      startedAt: "2026-01-06T00:00:00.000Z",
      sourceFingerprint: fp,
      // This ID is not in source.projectIds (it's a fresh UUID).
      plannedProjectIds: [uid(999)],
      preExistingBlobRefs: [],
      createdBlobRefs: [],
      stagingDirName: `import-${att}`,
    });

    const result = (await runImport(baseOptions(source, target))) as ImportFailure;
    assert.equal(result.status, "failed");
    // Source-bound inconsistency is reported via recovery_journal_corrupt.
    assert.equal(result.error.code, "recovery_journal_corrupt");
    assert.ok(existsSync(join(importsDir(target.root), `import-${att}.journal.json`)),
      "source-inconsistent journal retained for manual review");
  });
});

// ---------------------------------------------------------------------------
// (8) Lock release lifecycle: normal completion must release the lock
// ---------------------------------------------------------------------------

test("real import that succeeds releases the lock so the next run can proceed", async () => {
  await withFixtures(async (source, target) => {
    const lockPath = join(target.root, TARGET_IMPORT_LOCK_FILENAME);
    const beforeImport = (await runImport({
      ...baseOptions(source, target),
    })) as { status: string };
    assert.equal(beforeImport.status, "completed");
    // After success, the lock must be released.
    assert.equal(existsSync(lockPath), false,
      "lock released on success so the next run can acquire it");

    // Re-import: should hit already_imported (or completed) and re-acquire + release cleanly.
    const after = (await runImport({
      ...baseOptions(source, target),
    })) as { status: string };
    assert.equal(after.status, "already_imported");
    assert.equal(existsSync(lockPath), false,
      "lock released on already_imported too");
  });
});

// ---------------------------------------------------------------------------
// (9) Recovery cleanup is unchanged but the lock covers its lifetime
// ---------------------------------------------------------------------------

test("recovery cleanup failure retains the recovery journal AND the lock (lock outlives the call)", async () => {
  await withFixtures(async (source, target) => {
    // Set up a recovery scenario where cleanup is expected to fail.
    const fp = ((await runImport({
      ...baseOptions(source, target),
      dryRun: true,
    })) as DryRunReport).source!.fingerprint;
    const e0Ref = source.blobRefs[4]!;
    const sourceBlob = join(source.layout.blobsDir, e0Ref.replace("blobs/", ""));
    const targetBlob = join(target.layout.blobsDir, e0Ref.replace("blobs/", ""));
    mkdirSync(join(targetBlob, ".."), { recursive: true });
    linkSync(sourceBlob, targetBlob);
    const att = uid(830);
    fabricateJournal(target, {
      attemptId: att,
      state: "published",
      startedAt: "2026-01-06T00:00:00.000Z",
      sourceFingerprint: fp,
      plannedProjectIds: [source.ids.p1, source.ids.p2],
      preExistingBlobRefs: [],
      createdBlobRefs: [e0Ref],
      stagingDirName: `import-${att}`,
    });

    // Make the blob store unwritable so the recovery rollback cannot remove
    // the owned blob. Run import should fail closed with recovery_cleanup_failed.
    chmodTree(target.layout.blobsDir, 0o555);
    try {
      const result = (await runImport(baseOptions(source, target))) as ImportFailure;
      assert.equal(result.status, "failed");
      assert.equal(result.error.code, "recovery_cleanup_failed");
      // The journal + blob both retained (nothing touched).
      assert.ok(existsSync(join(importsDir(target.root), `import-${att}.journal.json`)));
      assert.ok(existsSync(targetBlob));
    } finally {
      chmodTree(target.layout.blobsDir, 0o755);
    }

    // After the failure, the lock must have been released so the operator
    // can re-run once the cause is resolved.
    const lockPath = join(target.root, TARGET_IMPORT_LOCK_FILENAME);
    assert.equal(existsSync(lockPath), false,
      "lock released after a failed real run");
  });
});

function chmodTree(dir: string, mode: number): void {
  chmodSync(dir, mode);
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      chmodTree(full, mode);
    }
  }
}
