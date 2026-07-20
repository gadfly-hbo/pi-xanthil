/**
 * Importer rollback and crash-recovery tests (T0014 brief validation):
 * transaction failure, blob publish failure, commit failure, and the
 * journal-driven rollback/recovery protocol. After any failure the target
 * DB rows and newly created blobs must return to the pre-call state;
 * pre-existing deduplicated blobs are never deleted.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync, linkSync, chmodSync, statSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  runImport,
  type DryRunReport,
  type ImportAlreadyImported,
  type ImportCompleted,
  type ImportFailure,
} from "../import/importer.ts";
import { importsDir, listJournals, writeManifest, type ImportJournal } from "../import/journal.ts";
import { TABLE_SPECS } from "../import/schema-plan.ts";
import {
  WORKSPACE_ID,
  assertNoLeak,
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

function blobFileCount(target: TargetRoot): number {
  return [...snapshotTree(target.root).keys()].filter((f) =>
    f.startsWith("artifacts/blobs/"),
  ).length;
}

function journalFiles(target: TargetRoot): string[] {
  const dir = importsDir(target.root);
  return existsSync(dir)
    ? readdirSync(dir).filter((f) => f.endsWith(".journal.json"))
    : [];
}

function manifestFiles(target: TargetRoot): string[] {
  const dir = importsDir(target.root);
  return existsSync(dir)
    ? readdirSync(dir).filter((f) => f.endsWith(".manifest.json"))
    : [];
}

function stagingDirs(target: TargetRoot): string[] {
  return readdirSync(target.layout.tmpDir).filter((d) => d.startsWith("import-"));
}

async function assertTargetRestored(target: TargetRoot): Promise<void> {
  const db = openTarget(target.layout);
  try {
    for (const spec of TABLE_SPECS) {
      assert.equal(tableCount(db, spec.table), 0, `empty ${spec.table}`);
    }
  } finally {
    db.close();
  }
  assert.equal(blobFileCount(target), 0, "no leftover blobs");
  assert.deepEqual(journalFiles(target), [], "no leftover journals");
  assert.deepEqual(stagingDirs(target), [], "no leftover staging dirs");
}

function fabricateJournal(target: TargetRoot, journal: ImportJournal): void {
  const dir = importsDir(target.root);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `import-${journal.attemptId}.journal.json`), JSON.stringify(journal));
}

async function sourceFingerprintOf(source: DonorFixture, target: TargetRoot): Promise<string> {
  const report = (await runImport({
    ...baseOptions(source, target),
    dryRun: true,
  })) as DryRunReport;
  const fingerprint = report.source?.fingerprint;
  assert.ok(fingerprint, "dry-run fingerprint present");
  return fingerprint;
}

test("transaction failure rolls back all rows and newly created blobs", async () => {
  await withFixtures(async (source, target) => {
    // Passes importer preflight (text length is not preflight-validated) but
    // violates the CHECK constraint inside the import transaction.
    const tamper = new DatabaseSync(source.layout.sqlitePath);
    tamper.exec("PRAGMA ignore_check_constraints = ON");
    tamper.prepare(`UPDATE analysis_requests SET raw_request_text = '' WHERE analysis_request_id = ?`).run(source.ids.req1);
    tamper.close();

    const result = (await runImport(baseOptions(source, target))) as ImportFailure;
    assert.equal(result.status, "failed");
    assert.equal(result.error.code, "tx_failed");
    assert.equal(result.rolledBack, true);

    await assertTargetRestored(target);

    const manifests = manifestFiles(target);
    assert.equal(manifests.length, 1);
    const parsed = JSON.parse(
      readFileUtf8(join(importsDir(target.root), manifests[0]!)),
    ) as { result: string; errorCode?: string };
    assert.equal(parsed.result, "failed");
    assert.equal(parsed.errorCode, "tx_failed");
  });
});

test("commit failure rolls back rows and created blobs (synthetic hook)", async () => {
  await withFixtures(async (source, target) => {
    const result = (await runImport({
      ...baseOptions(source, target),
      internalTestHooks: { failBeforeCommit: true },
    })) as ImportFailure;
    assert.equal(result.status, "failed");
    assert.equal(result.error.code, "commit_failed");
    assert.equal(result.rolledBack, true);

    await assertTargetRestored(target);
    const manifests = manifestFiles(target);
    assert.equal(manifests.length, 1);
    const parsed = JSON.parse(
      readFileUtf8(join(importsDir(target.root), manifests[0]!)),
    ) as { result: string; errorCode?: string };
    assert.equal(parsed.errorCode, "commit_failed");
  });
});

test("blob publish failure leaves no rows and no created blobs", async () => {
  await withFixtures(async (source, target) => {
    // Pre-create the e2 final blob path as a DIRECTORY so link/read fails.
    const e2Ref = source.blobRefs[6]!;
    const dirPath = join(target.layout.blobsDir, e2Ref.replace("blobs/", ""));
    mkdirSync(dirPath, { recursive: true });

    const result = (await runImport(baseOptions(source, target))) as ImportFailure;
    assert.equal(result.status, "failed");
    assert.equal(result.phase, "publish");
    assert.equal(result.error.code, "blob_publish_failed");
    assert.equal(result.rolledBack, true);

    const db = openTarget(target.layout);
    try {
      for (const spec of TABLE_SPECS) {
        assert.equal(tableCount(db, spec.table), 0, `empty ${spec.table}`);
      }
    } finally {
      db.close();
    }
    // Only the sabotage directory remains; every created blob was removed.
    assert.equal(blobFileCount(target), 0, "no created blobs left");
    assert.deepEqual(journalFiles(target), []);
    assert.deepEqual(stagingDirs(target), []);
  });
});

test("recovery rolls back an interrupted attempt (no committed rows)", async () => {
  await withFixtures(async (source, target) => {
    const fingerprint = await sourceFingerprintOf(source, target);
    // Simulate a crashed attempt: e0 blob published, staging leftover, no rows.
    const e0Ref = source.blobRefs[4]!;
    const sourceBlob = join(source.layout.blobsDir, e0Ref.replace("blobs/", ""));
    const targetBlob = join(target.layout.blobsDir, e0Ref.replace("blobs/", ""));
    mkdirSync(join(targetBlob, ".."), { recursive: true });
    linkSync(sourceBlob, targetBlob);
    mkdirSync(join(target.layout.tmpDir, `import-${uid(500)}`), { recursive: true });
    fabricateJournal(target, {
      attemptId: uid(500),
      state: "published",
      startedAt: "2026-01-06T00:00:00.000Z",
      sourceFingerprint: fingerprint,
      plannedProjectIds: [source.ids.p1, source.ids.p2],
      preExistingBlobRefs: [],
      createdBlobRefs: [e0Ref],
      stagingDirName: `import-${uid(500)}`,
    });

    const result = (await runImport(baseOptions(source, target))) as ImportCompleted;
    assert.equal(result.status, "completed");
    assert.equal(result.recovery.rolledBackJournals, 1);

    // The recovered failed attempt and the completed attempt both have manifests.
    const manifests = manifestFiles(target);
    assert.equal(manifests.length, 2);
    const results = manifests.map(
      (f) => (JSON.parse(readFileUtf8(join(importsDir(target.root), f))) as { result: string }).result,
    );
    assert.ok(results.includes("failed"));
    assert.ok(results.includes("completed"));
    assert.deepEqual(journalFiles(target), []);
    assert.deepEqual(stagingDirs(target), []);
    // e0 blob exists again (re-imported by the completed attempt).
    assert.ok(existsSync(targetBlob));
  });
});

test("recovery finalizes a committed-but-unfinalized attempt", async () => {
  await withFixtures(async (source, target) => {
    const first = (await runImport(baseOptions(source, target))) as ImportCompleted;
    assert.equal(first.status, "completed");

    // Remove the completed manifest and fabricate a db_committed journal,
    // simulating a crash between commit and manifest write.
    rmSync(join(importsDir(target.root), `import-${first.manifest.attemptId}.manifest.json`));
    fabricateJournal(target, {
      attemptId: uid(501),
      state: "db_committed",
      startedAt: "2026-01-06T00:00:00.000Z",
      sourceFingerprint: first.manifest.sourceFingerprint,
      plannedProjectIds: [source.ids.p1, source.ids.p2],
      preExistingBlobRefs: [],
      createdBlobRefs: [],
      stagingDirName: `import-${uid(501)}`,
    });

    const second = (await runImport(baseOptions(source, target))) as ImportAlreadyImported;
    assert.equal(second.status, "already_imported");
    assert.equal(second.recovery.finalizedJournals, 1);
    assert.equal(second.manifest.attemptId, uid(501));
    assert.equal(second.manifest.result, "completed");
    assert.deepEqual(journalFiles(target), []);
    // Row counts unchanged by the finalization.
    const db = openTarget(target.layout);
    try {
      assert.equal(tableCount(db, "analysis_projects"), 2);
      assert.equal(tableCount(db, "run_events"), 5);
    } finally {
      db.close();
    }
  });
});

test("recovery fails closed on a partial prior state and deletes nothing", async () => {
  await withFixtures(async (source, target) => {
    const fingerprint = await sourceFingerprintOf(source, target);
    // One of two planned projects is present: impossible for a single tx.
    const e0Ref = source.blobRefs[4]!;
    const sourceBlob = join(source.layout.blobsDir, e0Ref.replace("blobs/", ""));
    const targetBlob = join(target.layout.blobsDir, e0Ref.replace("blobs/", ""));
    mkdirSync(join(targetBlob, ".."), { recursive: true });
    linkSync(sourceBlob, targetBlob);
    fabricateJournal(target, {
      attemptId: uid(502),
      state: "published",
      startedAt: "2026-01-06T00:00:00.000Z",
      sourceFingerprint: fingerprint,
      plannedProjectIds: [source.ids.p1, source.ids.p2],
      preExistingBlobRefs: [],
      createdBlobRefs: [e0Ref],
      stagingDirName: `import-${uid(502)}`,
    });
    const db = openTarget(target.layout);
    db.prepare(
      `INSERT INTO audit_actors (audit_actor_id, actor_kind, actor_key, display_name, created_at) VALUES (?, 'system', 'other-system', 'Other', '2026-01-01T00:00:00.000Z')`,
    ).run(uid(900));
    db.prepare(
      `INSERT INTO analysis_projects (analysis_project_id, project_kind, title, slug, project_status, created_at, created_by_actor_id, updated_at, workspace_id)
       VALUES (?, 'daily_analysis', 'Partial', 'partial-slug', 'active', '2026-01-01T00:00:00.000Z', ?, '2026-01-01T00:00:00.000Z', ?)`,
    ).run(source.ids.p1, uid(900), WORKSPACE_ID);
    db.close();

    const result = (await runImport(baseOptions(source, target))) as ImportFailure;
    assert.equal(result.status, "failed");
    assert.equal(result.phase, "recovery");
    assert.equal(result.error.code, "recovery_partial_state");

    // Fail closed: journal, blob, and partial rows all left untouched.
    assert.equal(journalFiles(target).length, 1);
    assert.ok(existsSync(targetBlob));
    const db2 = openTarget(target.layout);
    try {
      assert.equal(tableCount(db2, "analysis_projects"), 1);
    } finally {
      db2.close();
    }
  });
});

test("unfinished foreign-source journal blocks the import (cross-source ownership)", async () => {
  await withFixtures(async (source, target) => {
    // A shared-hash blob is already in the target store (as if the other
    // source's attempt had published it).
    const e0Ref = source.blobRefs[4]!;
    const sourceBlob = join(source.layout.blobsDir, e0Ref.replace("blobs/", ""));
    const targetBlob = join(target.layout.blobsDir, e0Ref.replace("blobs/", ""));
    mkdirSync(join(targetBlob, ".."), { recursive: true });
    linkSync(sourceBlob, targetBlob);
    fabricateJournal(target, {
      attemptId: uid(503),
      state: "published",
      startedAt: "2026-01-06T00:00:00.000Z",
      sourceFingerprint: "f".repeat(64),
      plannedProjectIds: [uid(600)],
      preExistingBlobRefs: [],
      createdBlobRefs: [],
      stagingDirName: `import-${uid(503)}`,
    });

    // The import must not proceed: this run's publish/recovery could delete
    // blobs the other attempt owns (and vice versa).
    const result = (await runImport(baseOptions(source, target))) as ImportFailure;
    assert.equal(result.status, "failed");
    assert.equal(result.phase, "recovery");
    assert.equal(result.error.code, "recovery_foreign_journal");
    assert.equal(journalFiles(target).length, 1, "foreign journal retained");
    assert.ok(existsSync(targetBlob), "shared-hash blob untouched");
    const db0 = openTarget(target.layout);
    try {
      assert.equal(tableCount(db0, "analysis_projects"), 0, "no rows imported");
    } finally {
      db0.close();
    }

    // Dry-run also fails closed with the foreign count.
    const dry = (await runImport({ ...baseOptions(source, target), dryRun: true })) as DryRunReport;
    assert.equal(dry.ok, false);
    assert.equal(dry.errors[0]?.code, "recovery_foreign_journal");
    assert.equal(dry.target?.foreignJournals, 1);

    // Operator resolves the foreign attempt (its own source recovers it, or
    // it is removed manually); then this import completes and the shared
    // blob is preserved via dedup.
    deleteJournalFile(target, uid(503));
    const second = (await runImport(baseOptions(source, target))) as ImportCompleted;
    assert.equal(second.status, "completed");
    assert.ok(existsSync(targetBlob), "shared-hash blob preserved");
    assert.equal(second.manifest.deduplicatedBlobCount, 1);
  });
});

function deleteJournalFile(target: TargetRoot, attemptId: string): void {
  rmSync(join(importsDir(target.root), `import-${attemptId}.journal.json`), { force: true });
}

function readFileUtf8(path: string): string {
  return readFileSync(path, "utf8");
}

// ---------------------------------------------------------------------------
// Revision 1 review: crash-safe publish protocol, corrupted journals,
// cleanup-failure detection
// ---------------------------------------------------------------------------

/** Recursively chmod a directory tree (directories only need write perms). */
function chmodTree(dir: string, mode: number): void {
  chmodSync(dir, mode);
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      chmodTree(full, mode);
    }
  }
}

test("crash immediately after the first publish is recovered via the ownership snapshot", async () => {
  await withFixtures(async (source, target) => {
    // First run: simulated process crash right after the first blob link -
    // before ANY created-ref record exists. No cleanup runs.
    await assert.rejects(
      runImport({
        ...baseOptions(source, target),
        internalTestHooks: { crashAfterFirstPublish: true },
      }),
      (err: Error) => err.name === "SimulatedCrashError",
    );

    // Disk mirrors a real crash: journal at `publishing` with the (empty)
    // pre-existing snapshot, zero recorded created refs, first blob on disk,
    // zero committed rows, no manifest.
    const listing = listJournals(target.root);
    assert.equal(listing.journals.length, 1);
    assert.equal(listing.corrupted.length, 0);
    const journal = listing.journals[0]!;
    assert.equal(journal.state, "publishing");
    assert.deepEqual(journal.preExistingBlobRefs, []);
    assert.deepEqual(journal.createdBlobRefs, []);
    const firstRef = source.blobRefs[0]!; // rv1: first in the publish order
    const firstBlobPath = join(target.layout.blobsDir, firstRef.replace("blobs/", ""));
    assert.ok(existsSync(firstBlobPath), "owned-but-untracked blob present");
    const db0 = openTarget(target.layout);
    try {
      assert.equal(tableCount(db0, "analysis_projects"), 0);
    } finally {
      db0.close();
    }
    assert.equal(manifestFiles(target).length, 0);

    // Second run: recovery derives ownership from the snapshot, deletes only
    // the attempt-owned blob, then the import completes end to end.
    const result = (await runImport(baseOptions(source, target))) as ImportCompleted;
    assert.equal(result.status, "completed");
    assert.equal(result.recovery.rolledBackJournals, 1);
    assert.ok(existsSync(firstBlobPath), "blob re-imported after recovery");
    assert.deepEqual(journalFiles(target), []);
    const db = openTarget(target.layout);
    try {
      assert.equal(tableCount(db, "analysis_projects"), 2);
      assert.equal(tableCount(db, "run_events"), 5);
    } finally {
      db.close();
    }
    // Crashed attempt's failed manifest + the new completed manifest.
    assert.equal(manifestFiles(target).length, 2);
  });
});

test("recovery never deletes a pre-existing deduplicated blob (ownership snapshot)", async () => {
  await withFixtures(async (source, target) => {
    // Pre-publish e0 into the target store BEFORE the attempt (dedup case).
    const e0Ref = source.blobRefs[4]!;
    const sourceBlob = join(source.layout.blobsDir, e0Ref.replace("blobs/", ""));
    const targetBlob = join(target.layout.blobsDir, e0Ref.replace("blobs/", ""));
    mkdirSync(join(targetBlob, ".."), { recursive: true });
    linkSync(sourceBlob, targetBlob);

    await assert.rejects(
      runImport({
        ...baseOptions(source, target),
        internalTestHooks: { crashAfterFirstPublish: true },
      }),
      (err: Error) => err.name === "SimulatedCrashError",
    );

    // Recovery: e0 was in the pre-publish snapshot and must survive; the
    // attempt-owned first blob is removed, then the import completes and
    // reports exactly one deduplicated blob.
    const result = (await runImport(baseOptions(source, target))) as ImportCompleted;
    assert.equal(result.status, "completed");
    assert.equal(result.recovery.rolledBackJournals, 1);
    assert.ok(existsSync(targetBlob), "pre-existing blob preserved");
    assert.equal(result.manifest.deduplicatedBlobCount, 1);
    assert.equal(result.manifest.blobCount, 8);
  });
});

test("corrupted journal (garbage bytes) blocks import and preserves all artifacts", async () => {
  await withFixtures(async (source, target) => {
    const dir = importsDir(target.root);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "import-broken.journal.json"), "not-json{{{");

    const result = (await runImport(baseOptions(source, target))) as ImportFailure;
    assert.equal(result.status, "failed");
    assert.equal(result.phase, "recovery");
    assert.equal(result.error.code, "recovery_journal_corrupt");
    assert.equal(result.rolledBack, false);
    assert.equal(result.cleanupIncomplete, false);

    // Nothing touched: corrupted file retained, zero rows, zero blobs, no manifest.
    assert.ok(existsSync(join(dir, "import-broken.journal.json")));
    assert.equal(blobFileCount(target), 0);
    assert.equal(manifestFiles(target).length, 0);
    const db = openTarget(target.layout);
    try {
      assert.equal(tableCount(db, "analysis_projects"), 0);
    } finally {
      db.close();
    }

    // Dry-run also fails closed and reports the corrupted count.
    const dry = (await runImport({ ...baseOptions(source, target), dryRun: true })) as DryRunReport;
    assert.equal(dry.ok, false);
    assert.equal(dry.errors[0]?.code, "recovery_journal_corrupt");
    assert.equal(dry.target?.corruptedJournals, 1);
  });
});

test("invalid-shape journal (valid JSON, wrong shape) blocks import closed", async () => {
  await withFixtures(async (source, target) => {
    const dir = importsDir(target.root);
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, "import-shapeless.journal.json"),
      JSON.stringify({ attemptId: uid(700), state: "published" }),
    );

    const result = (await runImport(baseOptions(source, target))) as ImportFailure;
    assert.equal(result.status, "failed");
    assert.equal(result.error.code, "recovery_journal_corrupt");
    assert.equal(result.phase, "recovery");
    assert.ok(existsSync(join(dir, "import-shapeless.journal.json")));
    assert.equal(manifestFiles(target).length, 0);
  });
});

test("rollback cleanup failure is detectable, retains the journal, and never claims success", async () => {
  await withFixtures(async (source, target) => {
    // Commit fails (hook); before failing, the hook makes the blob store
    // unwritable so the rollback deletions fail too.
    const result = (await runImport({
      ...baseOptions(source, target),
      internalTestHooks: {
        failBeforeCommit: () => chmodTree(target.layout.blobsDir, 0o555),
      },
    })) as ImportFailure;

    assert.equal(result.status, "failed");
    assert.equal(result.error.code, "rollback_incomplete");
    assert.equal(result.rolledBack, false);
    assert.equal(result.cleanupIncomplete, true);
    assertNoLeak(result.error.message, source);

    // Journal retained, scoped to the unrecoverable refs; blobs still on disk.
    const listing = listJournals(target.root);
    assert.equal(listing.journals.length, 1);
    assert.equal(listing.journals[0]!.state, "published");
    assert.equal(listing.journals[0]!.createdBlobRefs.length, 8);
    assert.equal(blobFileCount(target), 8);
    // The DB transaction itself rolled back (independent of fs permissions).
    const db = openTarget(target.layout);
    try {
      for (const spec of TABLE_SPECS) {
        assert.equal(tableCount(db, spec.table), 0, `empty ${spec.table}`);
      }
    } finally {
      db.close();
    }

    // Restore permissions; the next run's recovery finishes the rollback
    // and the import then succeeds.
    chmodTree(target.layout.blobsDir, 0o755);
    const second = (await runImport(baseOptions(source, target))) as ImportCompleted;
    assert.equal(second.status, "completed");
    assert.equal(second.recovery.rolledBackJournals, 1);
    assert.deepEqual(journalFiles(target), []);
  });
});

test("recovery cleanup failure blocks the import and retains everything", async () => {
  await withFixtures(async (source, target) => {
    const fingerprint = await sourceFingerprintOf(source, target);
    const e0Ref = source.blobRefs[4]!;
    const sourceBlob = join(source.layout.blobsDir, e0Ref.replace("blobs/", ""));
    const targetBlob = join(target.layout.blobsDir, e0Ref.replace("blobs/", ""));
    mkdirSync(join(targetBlob, ".."), { recursive: true });
    linkSync(sourceBlob, targetBlob);
    fabricateJournal(target, {
      attemptId: uid(701),
      state: "published",
      startedAt: "2026-01-06T00:00:00.000Z",
      sourceFingerprint: fingerprint,
      plannedProjectIds: [source.ids.p1, source.ids.p2],
      preExistingBlobRefs: [],
      createdBlobRefs: [e0Ref],
      stagingDirName: `import-${uid(701)}`,
    });
    chmodTree(target.layout.blobsDir, 0o555);
    try {
      const result = (await runImport(baseOptions(source, target))) as ImportFailure;
      assert.equal(result.status, "failed");
      assert.equal(result.phase, "recovery");
      assert.equal(result.error.code, "recovery_cleanup_failed");
      assert.equal(result.rolledBack, false);
      // Journal, blob, and (empty) DB all retained; no import performed.
      assert.equal(journalFiles(target).length, 1);
      assert.ok(existsSync(targetBlob));
      const db = openTarget(target.layout);
      try {
        assert.equal(tableCount(db, "analysis_projects"), 0);
      } finally {
        db.close();
      }
    } finally {
      chmodTree(target.layout.blobsDir, 0o755);
    }
  });
});

// ---------------------------------------------------------------------------
// Revision 2 review: journal semantic validation, snapshot-state sensitivity,
// cross-source ownership, compensation-failure ordering
// ---------------------------------------------------------------------------

test("staged journal (crash before snapshot) never deletes pre-existing blobs", async () => {
  await withFixtures(async (source, target) => {
    const fingerprint = await sourceFingerprintOf(source, target);
    // Pre-existing dedup blob in the target store.
    const e0Ref = source.blobRefs[4]!;
    const sourceBlob = join(source.layout.blobsDir, e0Ref.replace("blobs/", ""));
    const targetBlob = join(target.layout.blobsDir, e0Ref.replace("blobs/", ""));
    mkdirSync(join(targetBlob, ".."), { recursive: true });
    linkSync(sourceBlob, targetBlob);
    // Crash after staging but BEFORE the publishing snapshot exists:
    // preExistingBlobRefs is the initializer empty array, which must not be
    // interpreted as "nothing pre-existed".
    fabricateJournal(target, {
      attemptId: uid(504),
      state: "staged",
      startedAt: "2026-01-06T00:00:00.000Z",
      sourceFingerprint: fingerprint,
      plannedProjectIds: [source.ids.p1, source.ids.p2],
      preExistingBlobRefs: [],
      createdBlobRefs: [],
      stagingDirName: `import-${uid(504)}`,
    });
    mkdirSync(join(target.layout.tmpDir, `import-${uid(504)}`), { recursive: true });

    const result = (await runImport(baseOptions(source, target))) as ImportCompleted;
    assert.equal(result.status, "completed");
    assert.equal(result.recovery.rolledBackJournals, 1);
    assert.ok(existsSync(targetBlob), "pre-existing blob preserved (no snapshot, no deletion)");
    // The recovered attempt deduplicates against the pre-existing blob.
    assert.equal(result.manifest.deduplicatedBlobCount, 1);
    assert.deepEqual(journalFiles(target), []);
  });
});

test("started journal is cleaned without touching any blob", async () => {
  await withFixtures(async (source, target) => {
    const fingerprint = await sourceFingerprintOf(source, target);
    const e0Ref = source.blobRefs[4]!;
    const sourceBlob = join(source.layout.blobsDir, e0Ref.replace("blobs/", ""));
    const targetBlob = join(target.layout.blobsDir, e0Ref.replace("blobs/", ""));
    mkdirSync(join(targetBlob, ".."), { recursive: true });
    linkSync(sourceBlob, targetBlob);
    fabricateJournal(target, {
      attemptId: uid(505),
      state: "started",
      startedAt: "2026-01-06T00:00:00.000Z",
      sourceFingerprint: fingerprint,
      plannedProjectIds: [source.ids.p1, source.ids.p2],
      preExistingBlobRefs: [],
      createdBlobRefs: [],
      stagingDirName: `import-${uid(505)}`,
    });

    const result = (await runImport(baseOptions(source, target))) as ImportCompleted;
    assert.equal(result.status, "completed");
    assert.equal(result.recovery.rolledBackJournals, 1);
    assert.ok(existsSync(targetBlob), "pre-existing blob preserved");
    assert.deepEqual(journalFiles(target), []);
  });
});

test("journal with traversal stagingDirName is semantic-corrupt: blocked, nothing deleted", async () => {
  await withFixtures(async (source, target) => {
    // Canary OUTSIDE the attempt staging directory that a traversal delete
    // would destroy if the journal were trusted.
    const canaryDir = join(target.root, "artifacts", "canary");
    mkdirSync(canaryDir, { recursive: true });
    writeFileSync(join(canaryDir, "keep.txt"), "do-not-delete");
    const fingerprint = await sourceFingerprintOf(source, target);
    const dir = importsDir(target.root);
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, `import-${uid(506)}.journal.json`),
      JSON.stringify({
        attemptId: uid(506),
        state: "staged",
        startedAt: "2026-01-06T00:00:00.000Z",
        sourceFingerprint: fingerprint,
        plannedProjectIds: [source.ids.p1, source.ids.p2],
        preExistingBlobRefs: [],
        createdBlobRefs: [],
        stagingDirName: "../canary",
      }),
    );

    const result = (await runImport(baseOptions(source, target))) as ImportFailure;
    assert.equal(result.status, "failed");
    assert.equal(result.phase, "recovery");
    assert.equal(result.error.code, "recovery_journal_corrupt");
    assert.equal(readFileSync(join(canaryDir, "keep.txt"), "utf8"), "do-not-delete");
    assert.ok(existsSync(join(dir, `import-${uid(506)}.journal.json`)), "journal retained");
  });
});

test("journal with non-UUID attemptId or traversal blob ref is semantic-corrupt", async () => {
  await withFixtures(async (source, target) => {
    const dir = importsDir(target.root);
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, "import-not-a-uuid.journal.json"),
      JSON.stringify({
        attemptId: "not-a-uuid",
        state: "staged",
        startedAt: "2026-01-06T00:00:00.000Z",
        sourceFingerprint: "f".repeat(64),
        plannedProjectIds: [],
        preExistingBlobRefs: [],
        createdBlobRefs: [],
        stagingDirName: "import-not-a-uuid",
      }),
    );
    writeFileSync(
      join(dir, `import-${uid(507)}.journal.json`),
      JSON.stringify({
        attemptId: uid(507),
        state: "published",
        startedAt: "2026-01-06T00:00:00.000Z",
        sourceFingerprint: "f".repeat(64),
        plannedProjectIds: [uid(600)],
        preExistingBlobRefs: [],
        createdBlobRefs: ["../../escape"],
        stagingDirName: `import-${uid(507)}`,
      }),
    );

    const result = (await runImport(baseOptions(source, target))) as ImportFailure;
    assert.equal(result.status, "failed");
    assert.equal(result.error.code, "recovery_journal_corrupt");
    assert.equal(journalFiles(target).length, 2, "both corrupted journals retained");
    const db = openTarget(target.layout);
    try {
      assert.equal(tableCount(db, "analysis_projects"), 0, "no rows imported");
    } finally {
      db.close();
    }
  });
});

test("post-commit compensation failure preserves rows AND blobs; recovery finalizes", async () => {
  await withFixtures(async (source, target) => {
    const first = (await runImport({
      ...baseOptions(source, target),
      internalTestHooks: { failPostCommitVerify: true, failCompensation: true },
    })) as ImportFailure;

    assert.equal(first.status, "failed");
    assert.equal(first.phase, "verification");
    assert.equal(first.error.code, "rollback_incomplete");
    assert.equal(first.rolledBack, false);
    assert.equal(first.cleanupIncomplete, true);

    // Committed rows remain, and the created blobs MUST remain too (a delete
    // would make the retained journal un-finalizable).
    const listing = listJournals(target.root);
    assert.equal(listing.journals.length, 1);
    assert.equal(listing.journals[0]!.state, "db_committed");
    assert.equal(listing.journals[0]!.createdBlobRefs.length, 8);
    assert.equal(blobFileCount(target), 8, "blobs preserved for recovery");
    const db0 = openTarget(target.layout);
    try {
      assert.equal(tableCount(db0, "analysis_projects"), 2, "committed rows retained");
      assert.equal(tableCount(db0, "run_events"), 5);
    } finally {
      db0.close();
    }

    // Retry without hooks: recovery re-verifies (blobs intact) and finalizes.
    const second = (await runImport(baseOptions(source, target))) as ImportAlreadyImported;
    assert.equal(second.status, "already_imported");
    assert.equal(second.recovery.finalizedJournals, 1);
    assert.equal(second.manifest.result, "completed");
    assert.equal(second.manifest.blobCount, 8);
    assert.deepEqual(journalFiles(target), []);
    const db = openTarget(target.layout);
    try {
      assert.equal(tableCount(db, "analysis_projects"), 2);
      assert.deepEqual(foreignKeyCheckValues(db), []);
    } finally {
      db.close();
    }
  });
});

function foreignKeyCheckValues(db: DatabaseSync): unknown[] {
  return db.prepare("PRAGMA foreign_key_check").all() as unknown[];
}
