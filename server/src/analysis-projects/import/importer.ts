/**
 * One-time WorkCanger data importer (WCA-03, WCA-08).
 *
 * Orchestration contract (T0014 brief):
 * - Fail closed, no partial results: full preflight before any write; blob
 *   staging -> content-addressed publish -> single DB transaction -> explicit
 *   rollback/recovery via journal; post-import reconciliation + safe manifest.
 * - Dry-run executes the same preflight and mapping with zero writes.
 * - No LLM, Engine, HTTP API, Data Exploration, or AgentHarness calls.
 *   restricted_raw Evidence bytes are only streamed for hashing/copying -
 *   never parsed, logged, or included in any output.
 */
import { existsSync, mkdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { openDatabase, foreignKeyCheck } from "../persistence/db.ts";
import {
  getAppliedMigrations,
  loadMigrations,
  runMigrations,
  type MigrationFile,
  type MigrationRecord,
} from "../persistence/migration-runner.ts";
import { buildLayout, initDataRoot, type DataRootLayout } from "../persistence/data-root.ts";
import { blobAbsolutePath } from "../persistence/blob-writer.ts";
import { uuid, isUuidV4 } from "../application/shared/runtime.ts";
import type { WorkspaceExistencePort } from "../contracts/workspace-port.ts";
import { ImportError, toSafeImportError, type SafeImportError } from "./errors.ts";
import { hashFileStreamingSync } from "./fs-hash.ts";
import {
  TABLE_SPECS,
  WORKSPACE_ID_COLUMN,
  buildExpectedSchema,
  type TableSpec,
} from "./schema-plan.ts";
import {
  readAndValidateSource,
  rowValue,
  type SourceData,
  type SourceRow,
} from "./source-reader.ts";
import {
  classifyActors,
  checkAlreadyImported,
  scanConflicts,
  validateTargetSchema,
  type ConflictReport,
} from "./preflight.ts";
import {
  deleteBlobRefs,
  publishBlobs,
  removeStagingDir,
  rollbackOwnedBlobs,
  snapshotExistingBlobRefs,
  stageBlobs,
  type BlobPublishTracker,
} from "./blob-transfer.ts";
import {
  createJournal,
  deleteJournal,
  findCompletedManifest,
  hasOwnershipSnapshot,
  listJournals,
  updateJournal,
  writeManifest,
  computeBlobHashSetDigest,
  type ImportJournal,
  type ImportManifest,
  type JournalListing,
} from "./journal.ts";
import { acquireImportLock, releaseImportLock, type ImportLock } from "./import-lock.ts";

// ---------------------------------------------------------------------------
// Public API types
// ---------------------------------------------------------------------------

export interface ImportOptions {
  /** Explicit donor source data root (donor layout). Never mutated. */
  readonly sourceDataRoot: string;
  /** Explicit target Analysis Projects data root (WCA-01 layout). */
  readonly targetDataRoot: string;
  /** Existing pi-Xanthil Workspace ID that owns every imported project. */
  readonly targetWorkspaceId: string;
  /** Injected Workspace existence port (WCA-02). */
  readonly workspacePort: WorkspaceExistencePort;
  /** Same preflight and mapping, zero writes. */
  readonly dryRun?: boolean;
  /** Allow creating + migrating the target DB when missing (real run only). */
  readonly allowTargetInit?: boolean;
  /** Override for the target repo migrations directory (tests). */
  readonly migrationsDir?: string;
  readonly now?: () => Date;
  readonly newAttemptId?: () => string;
  /** Test-only fault injection. Never used by the CLI. */
  readonly internalTestHooks?: {
    /**
     * When set, the transaction fails at commit time. If a function is
     * provided it runs first (e.g. to sabotage cleanup), then the commit
     * fails. Test-only; the CLI never sets this.
     */
    readonly failBeforeCommit?: boolean | (() => void);
    /**
     * Simulates a process crash immediately after the first blob publish:
     * runImport rejects with SimulatedCrashError and performs NO cleanup,
     * leaving journal/blobs exactly as a real crash would. Test-only.
     */
    readonly crashAfterFirstPublish?: boolean;
    /**
     * Simulates a post-commit verification failure (deterministic, before
     * the real verification queries run). Test-only.
     */
    readonly failPostCommitVerify?: boolean;
    /**
     * Simulates DB compensation that cannot delete the committed rows:
     * compensateCommittedImport returns a failure count without deleting.
     * Test-only.
     */
    readonly failCompensation?: boolean;
  };
}

/**
 * Thrown only when internalTestHooks.crashAfterFirstPublish simulates a
 * process crash. runImport deliberately performs no cleanup so recovery can
 * be exercised deterministically.
 */
export class SimulatedCrashError extends Error {
  constructor() {
    super("Simulated process crash (internalTestHooks)");
    this.name = "SimulatedCrashError";
  }
}

export type ImportPhase =
  | "preflight_source"
  | "workspace"
  | "preflight_target"
  | "already_imported"
  | "recovery"
  | "conflict"
  | "staging"
  | "publish"
  | "transaction"
  | "verification";

export interface RecoverySummary {
  readonly rolledBackJournals: number;
  readonly finalizedJournals: number;
  readonly foreignJournals: number;
}

export interface ImportCompleted {
  readonly status: "completed";
  readonly manifest: ImportManifest;
  readonly recovery: RecoverySummary;
}

export interface ImportAlreadyImported {
  readonly status: "already_imported";
  readonly manifest: ImportManifest;
  readonly recovery: RecoverySummary;
}

export interface ImportFailure {
  readonly status: "failed";
  readonly phase: ImportPhase;
  readonly error: SafeImportError;
  readonly sourceFingerprint?: string;
  /** True only when the target was fully restored to the pre-call state. */
  readonly rolledBack: boolean;
  /**
   * True when cleanup itself failed: the recovery journal (and any
   * unrecoverable blobs/rows) are retained for retry/manual recovery, and
   * the error reports rollback_incomplete or recovery_cleanup_failed.
   */
  readonly cleanupIncomplete: boolean;
  readonly recovery: RecoverySummary;
}

export type ImportRunResult = ImportCompleted | ImportAlreadyImported | ImportFailure;

export interface DryRunReport {
  readonly kind: "dry_run";
  readonly ok: boolean;
  readonly alreadyImported: boolean;
  readonly source?: {
    readonly migrations: readonly { version: number; name: string; checksum: string }[];
    readonly fingerprint: string;
    readonly tableCounts: Readonly<Record<string, number>>;
    readonly totalPlannedIds: number;
    readonly blobCount: number;
    readonly totalBlobBytes: number;
  };
  readonly target?: {
    readonly dbPresent: boolean;
    readonly plannedInit: boolean;
    readonly migrations?: readonly { version: number; name: string; checksum: string }[];
    readonly workspaceExists: boolean;
    readonly preExistingCounts?: Readonly<Record<string, number>>;
    readonly pendingJournals: number;
    readonly foreignJournals: number;
    readonly corruptedJournals: number;
  };
  readonly plan?: {
    readonly insertCounts: Readonly<Record<string, number>>;
    readonly actorSkips: number;
    readonly blobsToStage: number;
  };
  readonly conflicts?: {
    readonly durableId: number;
    readonly uniqueKey: number;
    readonly actorIdentity: number;
  };
  readonly errors: readonly SafeImportError[];
}

// ---------------------------------------------------------------------------
// Orchestration
// ---------------------------------------------------------------------------

const NO_RECOVERY: RecoverySummary = {
  rolledBackJournals: 0,
  finalizedJournals: 0,
  foreignJournals: 0,
};

function defaultMigrationsDir(): string {
  return new URL("../persistence/migrations", import.meta.url).pathname;
}

/**
 * Open the target database. The one-time importer requires a cleanly closed
 * target (no uncheckpointed WAL): a non-empty -wal file means another writer
 * (e.g. a running server) may be active, and dry-run immutable reads would
 * silently see a stale image. Fail closed with target_busy.
 * Dry-run opens with immutable=1 so zero files are created on the target.
 */
function openTargetDatabase(sqlitePath: string, dryRun: boolean): DatabaseSync {
  const walPath = `${sqlitePath}-wal`;
  if (existsSync(walPath) && statSync(walPath).size > 0) {
    throw new ImportError(
      "target_busy",
      "target_schema",
      "Target database has uncheckpointed WAL data or is in use; close it cleanly before import.",
    );
  }
  if (dryRun) {
    const uri = `${pathToFileURL(sqlitePath).href}?immutable=1`;
    const db = new DatabaseSync(uri, { readOnly: true });
    db.exec("PRAGMA foreign_keys = ON");
    return db;
  }
  return openDatabase(sqlitePath);
}

/**
 * Run the one-time import (or dry-run). Expected fail-closed outcomes are
 * returned as structured results; ImportError is never thrown to callers.
 */
export async function runImport(options: ImportOptions & { dryRun: true }): Promise<DryRunReport>;
export async function runImport(options: ImportOptions): Promise<ImportRunResult>;
export async function runImport(options: ImportOptions): Promise<ImportRunResult | DryRunReport> {
  const dryRun = options.dryRun === true;
  const realRun = !dryRun;
  const now = options.now ?? (() => new Date());

  if (
    typeof options.sourceDataRoot !== "string" ||
    options.sourceDataRoot.trim().length === 0 ||
    typeof options.targetDataRoot !== "string" ||
    options.targetDataRoot.trim().length === 0 ||
    typeof options.targetWorkspaceId !== "string" ||
    options.targetWorkspaceId.trim().length === 0 ||
    !options.workspacePort
  ) {
    const error = new ImportError(
      "invalid_options",
      "options",
      "sourceDataRoot, targetDataRoot, targetWorkspaceId, and workspacePort are required.",
    );
    return dryRun
      ? { kind: "dry_run", ok: false, alreadyImported: false, errors: [toSafeImportError(error)] }
      : failureResult("preflight_source", error, undefined, NO_RECOVERY, {
          rolledBack: false,
          cleanupIncomplete: false,
        });
  }

  const allMigrations = loadMigrations(options.migrationsDir ?? defaultMigrationsDir());
  const sourceMigrations = allMigrations.filter((m) => m.version <= 2);

  // -- Phase: source preflight (read-only) --------------------------------
  let source: SourceData;
  try {
    source = readAndValidateSource(options.sourceDataRoot, sourceMigrations);
  } catch (err) {
    return phaseFailure(dryRun, "preflight_source", err, undefined, NO_RECOVERY);
  }

  // -- Phase: workspace existence (before any target write) ---------------
  try {
    assertWorkspace(options);
  } catch (err) {
    return phaseFailure(dryRun, "workspace", err, source, NO_RECOVERY);
  }

  // -- Rev3: attemptId UUID v4 validation BEFORE any path is constructed --
  // The attempt ID is used to derive staging and journal paths; an invalid
  // or injected value would escape the attempt-owned directories.
  const rawAttemptId = (options.newAttemptId ?? uuid)();
  if (!isUuidV4(rawAttemptId)) {
    const error = new ImportError(
      "invalid_options",
      "options",
      "newAttemptId must produce a lowercase UUID v4 value.",
    );
    return dryRun
      ? { kind: "dry_run", ok: false, alreadyImported: false, errors: [toSafeImportError(error)] }
      : failureResult("preflight_source", error, source, NO_RECOVERY, {
          rolledBack: false,
          cleanupIncomplete: false,
        });
  }
  const attemptId = rawAttemptId;
  const startedAt = now().toISOString();

  // -- Rev3: pre-mutation journal gate runs BEFORE any target init/open ----
  // Classify journals by shape + filename + set disjointness (corrupted),
  // by source fingerprint (foreign), and by source-bound consistency
  // (matching but with project IDs or blob refs outside this source's
  // planned set). The gate must settle all three before init/recovery can
  // ever touch target state, so a foreign attempt's recovery can never
  // delete a same-hash blob the current source just published.
  // R4: journal-list I/O failures (e.g. imports/ unreadable) become safe
  // structured failures instead of raw throws out of runImport.
  let journalListing: JournalListing;
  try {
    journalListing = listJournals(options.targetDataRoot);
  } catch (err) {
    return phaseFailure(
      dryRun,
      "recovery",
      err instanceof ImportError
        ? err
        : new ImportError(
            "recovery_journal_corrupt",
            "recovery",
            "Recovery journal directory could not be read; import blocked with all target artifacts preserved.",
          ),
      source,
      NO_RECOVERY,
    );
  }
  const classification = classifyAndCheckJournals(journalListing, source);
  if (classification.corrupted.length > 0 || classification.sourceBoundInconsistent.length > 0) {
    const total = classification.corrupted.length + classification.sourceBoundInconsistent.length;
    return phaseFailure(
      dryRun,
      "recovery",
      new ImportError(
        "recovery_journal_corrupt",
        "recovery",
        `${total} corrupted or source-inconsistent recovery journal(s) detected; ` +
          `import blocked and all target artifacts preserved for manual handling.`,
      ),
      source,
      NO_RECOVERY,
      journalListing,
    );
  }
  if (classification.foreign.length > 0) {
    const err = new ImportError(
      "recovery_foreign_journal",
      "recovery",
      `${classification.foreign.length} unfinished import attempt(s) from a different source detected; ` +
        `finish or recover them before importing this source.`,
    );
    return dryRun
      ? {
          kind: "dry_run",
          ok: false,
          alreadyImported: false,
          errors: [toSafeImportError(err)],
          source: drySourceSummary(source),
          target: {
            dbPresent: existsSync(buildLayout(options.targetDataRoot).sqlitePath),
            plannedInit: false,
            workspaceExists: true,
            pendingJournals: classification.matching.length,
            foreignJournals: classification.foreign.length,
            corruptedJournals: 0,
          },
        }
      : failureResult("recovery", err, source, NO_RECOVERY, {
          rolledBack: false,
          cleanupIncomplete: false,
        });
  }

  // -- Rev3: atomic target import lock BEFORE target init (real runs) ------
  // Prevents two concurrent real import attempts from racing through the
  // gate + init + recovery + transaction. Dry-run is read-only.
  // R4: the lock parent may genuinely not exist yet (first import into a
  // fresh target root with allowTargetInit). Establish it only AFTER the
  // journal gates have passed, so a gate-blocked import never creates target
  // directories; acquisition failures stay structured (never raw throws).
  let lock: ImportLock | null = null;
  if (realRun) {
    try {
      mkdirSync(options.targetDataRoot, { recursive: true });
      lock = acquireImportLock(options.targetDataRoot, attemptId, now);
    } catch (err) {
      const safeErr =
        err instanceof ImportError
          ? err
          : new ImportError(
              "target_root_invalid",
              "target_schema",
              "Target data root is not writable; the import lock could not be established.",
            );
      return failureResult("preflight_target", safeErr, source, NO_RECOVERY, {
        rolledBack: false,
        cleanupIncomplete: false,
      });
    }
  }

  // -- Phase: target open / optional init + schema validation -------------
  // Everything below runs inside a single try-block whose `finally` releases
  // the target import lock (real runs only). This keeps the lock lifecycle
  // correct across every early-exit `return` path, including thrown errors
  // out of recovery, transaction, verify, or the simulated crash hook.
  try {
  const layout = buildLayout(options.targetDataRoot);
  const dbExisted = existsSync(layout.sqlitePath);
  let db: DatabaseSync | null = null;
  let targetApplied: readonly MigrationRecord[] = [];
  try {
    if (!dbExisted) {
      if (!options.allowTargetInit) {
        throw new ImportError(
          "target_not_initialized",
          "target_schema",
          "Target database does not exist and target initialization was not allowed.",
        );
      }
      if (!dryRun) {
        initDataRoot(options.targetDataRoot);
        db = openDatabase(layout.sqlitePath);
        await runMigrations(db, allMigrations, layout);
      }
    } else {
      db = openTargetDatabase(layout.sqlitePath, dryRun);
    }
    if (db) {
      validateTargetSchema(db, allMigrations);
      targetApplied = getAppliedMigrations(db);
    }
  } catch (err) {
    closeQuietly(db);
    return phaseFailure(dryRun, "preflight_target", err, source, NO_RECOVERY);
  }

  const preCounts = db ? readTableCounts(db) : zeroCounts();

  // -- Phase: actor classification (shared by conflicts, tx, recovery) ----
  const actorClassification = db
    ? classifyActors(db, source.rows.get("audit_actors")!)
    : { skipIds: new Set<string>(), conflictCount: 0 };

  // -- Phase: crash recovery sweep (real runs mutate; dry-run reports) -----
  // Runs BEFORE already-imported so a stale same-fingerprint journal is
  // finalized/rolled back first. Only same-source journals are swept; any
  // foreign journal blocks the import afterwards (cross-source ownership).
  let recovery: RecoverySummary = NO_RECOVERY;
  try {
    if (db && !dryRun) {
      const sweep = await recoverJournals({
        options,
        layout,
        db,
        source,
        journals: classification.matching,
        actorSkipIds: actorClassification.skipIds,
        now,
      });
      recovery = sweep.summary;
      if (sweep.finalizedManifest) {
        closeQuietly(db);
        return {
          status: "already_imported",
          manifest: sweep.finalizedManifest,
          recovery,
        };
      }
    }
  } catch (err) {
    closeQuietly(db);
    return phaseFailure(dryRun, "recovery", err, source, NO_RECOVERY);
  }

  // -- Phase: already-imported detection ----------------------------------
  try {
    if (db) {
      const check = checkAlreadyImported(
        db,
        findCompletedManifest(options.targetDataRoot, source.fingerprint),
        source,
        layout.blobsDir,
      );
      if (check.kind === "already_imported") {
        closeQuietly(db);
        if (dryRun) {
          return dryReportFromAlreadyImported(source, dbExisted, classification.matching);
        }
        return {
          status: "already_imported",
          manifest: check.manifest,
          recovery: NO_RECOVERY,
        };
      }
    }
  } catch (err) {
    closeQuietly(db);
    return phaseFailure(dryRun, "already_imported", err, source, NO_RECOVERY);
  }

  // -- Phase: conflict scan ------------------------------------------------
  let conflicts: ConflictReport;
  try {
    conflicts = db
      ? scanConflicts(db, source, actorClassification.skipIds, actorClassification.conflictCount)
      : emptyConflicts(actorClassification);
    if (conflicts.total > 0) {
      const code = actorClassification.conflictCount > 0
        ? "conflict_actor_identity"
        : Object.values(conflicts.durableId).some((n) => n > 0)
          ? "conflict_durable_id"
          : "conflict_unique_key";
      throw new ImportError(
        code,
        "conflict",
        `Preflight conflict: ${conflicts.total} conflicting row(s) ` +
          `(durableId=${sumValues(conflicts.durableId)}, uniqueKey=${sumValues(conflicts.uniqueKey)}, actorIdentity=${conflicts.actorIdentity}).`,
      );
    }
  } catch (err) {
    closeQuietly(db);
    const result = phaseFailure(dryRun, "conflict", err, source, recovery);
    if (!dryRun) {
      writeFailedManifestBestEffort(options, attemptId, source, startedAt, now, err);
    }
    return result;
  }

  // -- Dry-run: report only, zero writes ----------------------------------
  if (dryRun) {
    const report = buildDryReport({
      source,
      options,
      dbExisted,
      targetApplied,
      preCounts: db ? preCounts : undefined,
      journals: classification.matching,
      actorSkips: actorClassification.skipIds.size,
      conflicts,
    });
    closeQuietly(db);
    return report;
  }

  // -- Real run: staging -> publish -> transaction -> verify -> manifest --
  const realDb = db!;
  const stagingDir = join(layout.tmpDir, `import-${attemptId}`);
  const tracker: BlobPublishTracker = { createdRefs: [], deduplicatedCount: 0 };
  let journal: ImportJournal;
  try {
    journal = createJournal(options.targetDataRoot, {
      attemptId,
      state: "started",
      startedAt,
      sourceFingerprint: source.fingerprint,
      plannedProjectIds: source.projectIds,
      stagingDirName: `import-${attemptId}`,
    });
  } catch (err) {
    closeQuietly(realDb);
    return phaseFailure(false, "staging", err, source, recovery);
  }

  try {
    // Stage + verify
    try {
      stageBlobs(buildLayout(options.sourceDataRoot).blobsDir, stagingDir, source.blobPlan);
    } catch (err) {
      throw withPhase("staging", err);
    }
    journal = updateJournal(options.targetDataRoot, journal, { state: "staged" });

    // Ownership snapshot BEFORE publishing: recovery never relies on
    // per-blob journal flushes. "Created by this attempt" is derived as
    // {plan refs on disk} minus {refs in this snapshot}, which closes the
    // crash window between linking a blob and recording it.
    const preExistingRefs = snapshotExistingBlobRefs(layout.blobsDir, source.blobPlan);
    journal = updateJournal(options.targetDataRoot, journal, {
      state: "publishing",
      preExistingBlobRefs: preExistingRefs,
    });

    // Publish (crash-simulation hook runs synchronously per blob)
    const testHooks = options.internalTestHooks;
    try {
      await publishBlobs(layout.blobsDir, stagingDir, source.blobPlan, tracker, (_entry, t) => {
        if (testHooks?.crashAfterFirstPublish && t.createdRefs.length === 1) {
          throw new SimulatedCrashError();
        }
      });
    } catch (err) {
      throw withPhase("publish", err);
    }
    journal = updateJournal(options.targetDataRoot, journal, {
      state: "published",
      createdBlobRefs: tracker.createdRefs,
    });

    // Single transaction
    const insertedCounts = computeInsertedCounts(source, actorClassification.skipIds);
    try {
      executeImportTransaction(
        realDb,
        source,
        options.targetWorkspaceId,
        actorClassification.skipIds,
        preCounts,
        insertedCounts,
        allMigrations,
        options.internalTestHooks,
      );
    } catch (err) {
      throw withPhase("transaction", err);
    }
    journal = updateJournal(options.targetDataRoot, journal, { state: "db_committed" });

    // Post-commit reconciliation: FK, counts, ID sets, ordinals, workspace, blobs
    try {
      if (options.internalTestHooks?.failPostCommitVerify) {
        throw new ImportError(
          "verify_failed",
          "verification",
          "Synthetic post-commit verification failure (internalTestHooks).",
        );
      }
      verifyState(realDb, source, options.targetWorkspaceId, actorClassification.skipIds, {
        expectedTotalCounts: expectedTotals(preCounts, insertedCounts),
        checkCounts: true,
      });
      verifyBlobs(layout.blobsDir, source);
    } catch (err) {
      throw withPhase("verification", err);
    }

    const completedAt = now().toISOString();
    const manifest: ImportManifest = {
      manifestVersion: 1,
      attemptId,
      sourceFingerprint: source.fingerprint,
      targetWorkspaceId: options.targetWorkspaceId,
      tableCounts: insertedCounts,
      blobCount: source.blobCount,
      deduplicatedBlobCount: tracker.deduplicatedCount,
      blobHashSetDigest: computeBlobHashSetDigest(
        [...source.blobPlan.values()].map((entry) => entry.hash),
      ),
      startedAt,
      completedAt,
      result: "completed",
    };
    writeManifest(options.targetDataRoot, manifest);
    removeStagingDir(stagingDir);
    deleteJournal(options.targetDataRoot, attemptId);
    closeQuietly(realDb);
    return { status: "completed", manifest, recovery };
  } catch (err) {
    // A simulated crash performs NO cleanup: journal, blobs, and rows are
    // left exactly as a real crash would, for deterministic recovery tests.
    if (err instanceof SimulatedCrashError) {
      closeQuietly(realDb);
      throw err;
    }

    // Roll back to the pre-call state: DB transaction (if still open), then
    // exactly the blobs this attempt created, then attempt artifacts.
    // Cleanup failures are never swallowed: the journal is retained with the
    // unrecoverable refs, and the result reports cleanupIncomplete instead of
    // claiming rollback success.
    const phase = (err as { phase?: ImportPhase }).phase ?? "transaction";
    try {
      realDb.exec("ROLLBACK");
    } catch {
      // No open transaction or already rolled back.
    }
    let compensationFailed = 0;
    let blobsPreservedForRecovery = false;
    if (phase === "verification") {
      // Post-commit verification failure: compensate by deleting the rows
      // this attempt inserted (identities are known).
      compensationFailed = compensateCommittedImport(
        realDb,
        source,
        actorClassification.skipIds,
        options.internalTestHooks,
      );
      if (compensationFailed > 0) {
        // Committed rows REMAIN. The created blobs must stay too: deleting
        // them would make the retained journal un-finalizable (verifyBlobs
        // would fail), destroying recoverability.
        blobsPreservedForRecovery = true;
      }
    }
    const blobCleanup = blobsPreservedForRecovery
      ? { deletedCount: 0, failedRefs: [] as readonly string[] }
      : deleteBlobRefs(layout.blobsDir, tracker.createdRefs);
    const stagingRemoved = removeStagingDir(stagingDir);
    const cleanupComplete =
      compensationFailed === 0 &&
      !blobsPreservedForRecovery &&
      blobCleanup.failedRefs.length === 0 &&
      stagingRemoved;

    if (cleanupComplete) {
      deleteJournal(options.targetDataRoot, attemptId);
    } else {
      // Retain recovery state scoped to what still needs cleanup (or, when
      // compensation failed, the full created set so recovery can finalize).
      try {
        updateJournal(options.targetDataRoot, journal, {
          createdBlobRefs: blobsPreservedForRecovery
            ? tracker.createdRefs
            : blobCleanup.failedRefs,
        });
      } catch {
        // Journal retention itself failed; nothing more can be done here.
      }
    }
    writeFailedManifestBestEffort(options, attemptId, source, startedAt, now, err);
    closeQuietly(realDb);
    if (cleanupComplete) {
      return {
        status: "failed",
        phase,
        error: toSafeImportError(err),
        sourceFingerprint: source.fingerprint,
        rolledBack: true,
        cleanupIncomplete: false,
        recovery,
      };
    }
    return {
      status: "failed",
      phase,
      error: {
        code: "rollback_incomplete",
        category: "transaction",
        message: blobsPreservedForRecovery
          ? `Import failed after commit and DB compensation was incomplete; ` +
            `committed rows and their blobs are preserved so recovery can re-verify and finalize ` +
            `(journal retained).`
          : `Import failed and cleanup was incomplete ` +
            `(${blobCleanup.failedRefs.length} blob ref(s), ${compensationFailed} row group(s)` +
            `${stagingRemoved ? "" : ", staging dir"} could not be removed); ` +
            `recovery journal retained for retry/manual cleanup.`,
      },
      sourceFingerprint: source.fingerprint,
      rolledBack: false,
      cleanupIncomplete: true,
      recovery,
    };
  }
  } finally {
    // Release the atomic target import lock (real runs only). On every
    // return path the finally runs, so the lock cannot outlive the call.
    if (lock !== null) {
      releaseImportLock(lock);
    }
  }
}

// ---------------------------------------------------------------------------
// Phases and small helpers
// ---------------------------------------------------------------------------

export interface JournalClassification {
  /**
   * Shape- and filename-valid journals whose ownership/identity/sets are all
   * consistent with the current source: plannedProjectIds equals
   * source.projectIds EXACTLY (R4), and both blob ref sets are subsets of
   * the current plan. Only these are eligible for recovery.
   */
  readonly matching: readonly ImportJournal[];
  /**
   * Shape-valid journals whose sourceFingerprint differs from the current
   * source. Same hash-space ownership makes their in-flight blobs unsafe to
   * touch from this run.
   */
  readonly foreign: readonly ImportJournal[];
  /** Filenames that fail shape/semantic/disjoint/filename checks. */
  readonly corrupted: readonly string[];
  /**
   * Matching-fingerprint journals whose planned project set is not exactly
   * this source's set, or whose blob refs fall outside the current plan;
   * evidence of staged content outside this donor, even if the fingerprint
   * was right.
   */
  readonly sourceBoundInconsistent: readonly ImportJournal[];
}

/**
 * Rev3 gate: classify shape-valid journals by fingerprint and re-check the
 * matching ones against the current source's planned set. The foreign /
 * source-inconsistent / corrupted partitions MUST be settled before any
 * target mutation (init/open/recovery/run) so a foreign attempt's recovery
 * can never delete a same-hash blob the current source just published,
 * and so a missing target is never created by `initDataRoot` before the
 * foreign gate has had a chance to block.
 */
export function classifyAndCheckJournals(
  listing: JournalListing,
  source: SourceData,
): JournalClassification {
  const sourceProjectSet = new Set(source.projectIds);
  const planRefs = new Set(source.blobPlan.keys());
  const matching: ImportJournal[] = [];
  const foreign: ImportJournal[] = [];
  const sourceBoundInconsistent: ImportJournal[] = [];
  for (const journal of listing.journals) {
    if (journal.sourceFingerprint !== source.fingerprint) {
      foreign.push(journal);
      continue;
    }
    // Source-bound (R4): planned projects must equal this source's project
    // set EXACTLY (canonical, order-insensitive set equality). A subset -
    // including the empty set - would make recovery treat a COMPLETED import
    // as an uncommitted attempt (present === 0) and delete live source-plan
    // blobs out from under committed rows.
    if (
      journal.plannedProjectIds.length !== sourceProjectSet.size ||
      !journal.plannedProjectIds.every((pid) => sourceProjectSet.has(pid))
    ) {
      sourceBoundInconsistent.push(journal);
      continue;
    }
    // Blob refs must come from the current plan. Subset (not equality) is
    // correct here: dedup and partial-publish crashes legitimately leave the
    // created set smaller than the plan. Anything out of range is rejected -
    // even with the right fingerprint, an attachment to a different donor
    // would be unsafe to recover against this source.
    let ok = true;
    for (const ref of journal.preExistingBlobRefs) {
      if (!planRefs.has(ref)) {
        ok = false;
        break;
      }
    }
    if (ok) {
      for (const ref of journal.createdBlobRefs) {
        if (!planRefs.has(ref)) {
          ok = false;
          break;
        }
      }
    }
    if (!ok) {
      sourceBoundInconsistent.push(journal);
      continue;
    }
    matching.push(journal);
  }
  return {
    matching,
    foreign,
    corrupted: listing.corrupted,
    sourceBoundInconsistent,
  };
}

function withPhase(phase: ImportPhase, err: unknown): unknown {
  (err as { phase?: ImportPhase }).phase = phase;
  return err;
}

function phaseFailure(
  dryRun: boolean,
  phase: ImportPhase,
  err: unknown,
  source: SourceData | undefined,
  recovery: RecoverySummary,
  listing?: JournalListing,
): ImportRunResult | DryRunReport {
  const safe = toSafeImportError(err);
  if (dryRun) {
    return {
      kind: "dry_run",
      ok: false,
      alreadyImported: false,
      errors: [safe],
      source: source ? drySourceSummary(source) : undefined,
      target: listing
        ? {
            dbPresent: true,
            plannedInit: false,
            workspaceExists: true,
            pendingJournals: listing.journals.length,
            foreignJournals: 0,
            corruptedJournals: listing.corrupted.length,
          }
        : undefined,
    };
  }
  return failureResult(phase, err, source, recovery, {
    rolledBack: false,
    cleanupIncomplete: false,
  });
}

function failureResult(
  phase: ImportPhase,
  err: unknown,
  source: SourceData | undefined,
  recovery: RecoverySummary,
  cleanup: { rolledBack: boolean; cleanupIncomplete: boolean },
): ImportFailure {
  return {
    status: "failed",
    phase,
    error: toSafeImportError(err),
    sourceFingerprint: source?.fingerprint,
    rolledBack: cleanup.rolledBack,
    cleanupIncomplete: cleanup.cleanupIncomplete,
    recovery,
  };
}

function closeQuietly(db: DatabaseSync | null): void {
  if (!db) return;
  try {
    db.close();
  } catch {
    // Already closed.
  }
}

function assertWorkspace(options: ImportOptions): void {
  let exists: boolean;
  try {
    exists = options.workspacePort.workspaceExists(options.targetWorkspaceId);
  } catch (err) {
    if (err instanceof ImportError) throw err;
    throw new ImportError(
      "workspace_check_unavailable",
      "workspace",
      "Workspace existence check failed.",
    );
  }
  if (!exists) {
    throw new ImportError(
      "workspace_not_found",
      "workspace",
      "Target Workspace does not exist.",
    );
  }
}

function sumValues(record: Record<string, number> | Readonly<Record<string, number>>): number {
  return Object.values(record).reduce((acc, n) => acc + n, 0);
}

function zeroCounts(): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const spec of TABLE_SPECS) counts[spec.table] = 0;
  return counts;
}

function emptyConflicts(
  classification: { skipIds: ReadonlySet<string>; conflictCount: number },
): ConflictReport {
  return {
    durableId: {},
    uniqueKey: {},
    actorIdentity: classification.conflictCount,
    actorSkips: classification.skipIds.size,
    total: classification.conflictCount,
  };
}

function readTableCounts(db: DatabaseSync): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const spec of TABLE_SPECS) {
    const row = db.prepare(`SELECT COUNT(*) AS n FROM ${spec.table}`).get() as { n: number };
    counts[spec.table] = row.n;
  }
  return counts;
}

function computeInsertedCounts(
  source: SourceData,
  actorSkipIds: ReadonlySet<string>,
): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const spec of TABLE_SPECS) {
    const rows = source.rows.get(spec.table)!.length;
    counts[spec.table] = spec.table === "audit_actors" ? rows - actorSkipIds.size : rows;
  }
  return counts;
}

function expectedTotals(
  preCounts: Record<string, number>,
  insertedCounts: Record<string, number>,
): Record<string, number> {
  const totals: Record<string, number> = {};
  for (const spec of TABLE_SPECS) {
    totals[spec.table] = (preCounts[spec.table] ?? 0) + (insertedCounts[spec.table] ?? 0);
  }
  return totals;
}

function writeFailedManifestBestEffort(
  options: ImportOptions,
  attemptId: string,
  source: SourceData,
  startedAt: string,
  now: () => Date,
  err: unknown,
): void {
  try {
    const safe = toSafeImportError(err);
    writeManifest(options.targetDataRoot, {
      manifestVersion: 1,
      attemptId,
      sourceFingerprint: source.fingerprint,
      targetWorkspaceId: options.targetWorkspaceId,
      tableCounts: zeroCounts(),
      blobCount: 0,
      deduplicatedBlobCount: 0,
      blobHashSetDigest: computeBlobHashSetDigest([]),
      startedAt,
      completedAt: now().toISOString(),
      result: "failed",
      errorCode: safe.code,
      errorCategory: safe.category,
    });
  } catch {
    // Best-effort audit artifact; never mask the original failure.
  }
}

// ---------------------------------------------------------------------------
// Transaction
// ---------------------------------------------------------------------------

function executeImportTransaction(
  db: DatabaseSync,
  source: SourceData,
  workspaceId: string,
  actorSkipIds: ReadonlySet<string>,
  preCounts: Record<string, number>,
  insertedCounts: Record<string, number>,
  allMigrations: readonly MigrationFile[],
  testHooks: ImportOptions["internalTestHooks"],
): void {
  const targetSchema = buildExpectedSchema(allMigrations);
  const statements = new Map<string, { stmt: ReturnType<DatabaseSync["prepare"]>; columns: readonly string[] }>();
  for (const spec of TABLE_SPECS) {
    const columns = targetSchema.tables.get(spec.table)!.map((col) => col.name);
    const placeholders = columns.map(() => "?").join(", ");
    statements.set(spec.table, {
      stmt: db.prepare(`INSERT INTO ${spec.table} (${columns.join(", ")}) VALUES (${placeholders})`),
      columns,
    });
  }

  const insertRow = (spec: TableSpec, row: SourceRow) => {
    const { stmt, columns } = statements.get(spec.table)!;
    const values = columns.map((col) =>
      spec.table === "analysis_projects" && col === WORKSPACE_ID_COLUMN
        ? workspaceId
        : rowValue(row, col),
    );
    stmt.run(...values);
  };

  db.exec("BEGIN IMMEDIATE");
  try {
    const actorRowsById = new Map(
      source.rows.get("audit_actors")!.map((row) => [row.audit_actor_id as string, row]),
    );
    const actorSpec = TABLE_SPECS.find((s) => s.table === "audit_actors")!;
    for (const actorId of source.orderedActorIds) {
      if (actorSkipIds.has(actorId)) continue;
      insertRow(actorSpec, actorRowsById.get(actorId)!);
    }
    for (const spec of TABLE_SPECS) {
      if (spec.table === "audit_actors") continue;
      for (const row of source.rows.get(spec.table)!) {
        insertRow(spec, row);
      }
    }

    // In-transaction reconciliation before commit.
    verifyState(db, source, workspaceId, actorSkipIds, {
      expectedTotalCounts: expectedTotals(preCounts, insertedCounts),
      checkCounts: true,
    });

    try {
      const failHook = testHooks?.failBeforeCommit;
      if (failHook) {
        if (typeof failHook === "function") {
          failHook();
        }
        throw new Error("synthetic commit failure (internalTestHooks)");
      }
      db.exec("COMMIT");
    } catch (commitErr) {
      try {
        db.exec("ROLLBACK");
      } catch {
        // Best-effort rollback.
      }
      throw new ImportError(
        "commit_failed",
        "transaction",
        "Database commit failed; the transaction was rolled back.",
      );
    }
  } catch (err) {
    if (err instanceof ImportError && err.code === "commit_failed") throw err;
    try {
      db.exec("ROLLBACK");
    } catch {
      // Best-effort rollback.
    }
    if (err instanceof ImportError) throw err;
    throw new ImportError(
      "tx_failed",
      "transaction",
      "Database transaction failed; the transaction was rolled back.",
    );
  }
}

// ---------------------------------------------------------------------------
// Post-import reconciliation
// ---------------------------------------------------------------------------

export interface VerifyOptions {
  readonly expectedTotalCounts?: Record<string, number>;
  readonly checkCounts: boolean;
}

/**
 * Reconcile target state against the source: FK integrity, per-table counts,
 * full durable-ID set containment, ordinal/event-sequence equality per
 * group, and workspace ownership of every imported project.
 */
export function verifyState(
  db: DatabaseSync,
  source: SourceData,
  workspaceId: string,
  actorSkipIds: ReadonlySet<string>,
  options: VerifyOptions,
): void {
  const violations = foreignKeyCheck(db);
  if (violations.length > 0) {
    throw new ImportError(
      "verify_failed",
      "verification",
      `Post-import foreign_key_check reports ${violations.length} violation(s).`,
    );
  }

  if (options.checkCounts && options.expectedTotalCounts) {
    const actual = readTableCounts(db);
    for (const spec of TABLE_SPECS) {
      if (actual[spec.table] !== options.expectedTotalCounts[spec.table]) {
        throw new ImportError(
          "verify_failed",
          "verification",
          `Post-import row count mismatch on table ${spec.table}.`,
        );
      }
    }
  }

  // Full durable-ID set containment + ordinal/sequence equality per group.
  for (const spec of TABLE_SPECS) {
    const rows = source.rows.get(spec.table)!;
    const pkPredicate = spec.identity.map((col) => `${col} = ?`).join(" AND ");
    const pkStmt = db.prepare(`SELECT 1 FROM ${spec.table} WHERE ${pkPredicate} LIMIT 1`);
    for (const row of rows) {
      if (pkStmt.get(...spec.identity.map((col) => rowValue(row, col))) === undefined) {
        throw new ImportError(
          "verify_failed",
          "verification",
          `Post-import ID set reconciliation failed on table ${spec.table}.`,
        );
      }
    }

    if (spec.ordinal && rows.length > 0) {
      const { groupColumn, ordinalColumn } = spec.ordinal;
      const groups = new Set(rows.map((row) => String(row[groupColumn])));
      const ordinalStmt = db.prepare(
        `SELECT ${ordinalColumn} AS ord FROM ${spec.table} WHERE ${groupColumn} = ? ORDER BY ${ordinalColumn} ASC`,
      );
      for (const group of groups) {
        const sourceOrdinals = rows
          .filter((row) => String(row[groupColumn]) === group)
          .map((row) => Number(row[ordinalColumn]))
          .sort((a, b) => a - b);
        const targetOrdinals = (ordinalStmt.all(group) as Array<{ ord: number }>).map(
          (r) => r.ord,
        );
        if (
          sourceOrdinals.length !== targetOrdinals.length ||
          sourceOrdinals.some((ord, i) => ord !== targetOrdinals[i])
        ) {
          throw new ImportError(
            "verify_failed",
            "verification",
            `Post-import ordinal/sequence reconciliation failed on table ${spec.table}.`,
          );
        }
      }
    }
  }

  // Workspace ownership of every imported project (WCA-02).
  const workspaceStmt = db.prepare(
    `SELECT ${WORKSPACE_ID_COLUMN} AS ws FROM analysis_projects WHERE analysis_project_id = ?`,
  );
  for (const projectId of source.projectIds) {
    const row = workspaceStmt.get(projectId) as { ws: string } | undefined;
    if (!row || row.ws !== workspaceId) {
      throw new ImportError(
        "verify_failed",
        "verification",
        "Post-import workspace ownership reconciliation failed.",
      );
    }
  }
}

/** Re-verify every referenced blob in the target store by SHA-256. */
export function verifyBlobs(targetBlobsDir: string, source: SourceData): void {
  for (const entry of source.blobPlan.values()) {
    const absPath = blobAbsolutePath(targetBlobsDir, entry.ref);
    if (!existsSync(absPath)) {
      throw new ImportError(
        "verify_failed",
        "verification",
        "Post-import blob verification failed: a referenced blob is missing.",
      );
    }
    if (hashFileStreamingSync(absPath) !== entry.hash) {
      throw new ImportError(
        "verify_failed",
        "verification",
        "Post-import blob verification failed: SHA-256 mismatch.",
      );
    }
  }
}

/**
 * Compensation for a post-commit verification failure: delete exactly the
 * rows this attempt inserted, in reverse insert order. Returns the number
 * of table groups whose deletions could not be completed (0 = full
 * compensation). Callers must treat non-zero as incomplete cleanup and
 * retain recovery state instead of claiming rollback success.
 */
function compensateCommittedImport(
  db: DatabaseSync,
  source: SourceData,
  actorSkipIds: ReadonlySet<string>,
  testHooks?: ImportOptions["internalTestHooks"],
): number {
  if (testHooks?.failCompensation) {
    // Test-only: simulate compensation that cannot delete the committed rows.
    return 1;
  }
  let failedGroups = 0;
  try {
    db.exec("BEGIN IMMEDIATE");
    for (const spec of [...TABLE_SPECS].reverse()) {
      try {
        const pkPredicate = spec.identity.map((col) => `${col} = ?`).join(" AND ");
        const stmt = db.prepare(`DELETE FROM ${spec.table} WHERE ${pkPredicate}`);
        for (const row of source.rows.get(spec.table)!) {
          if (spec.table === "audit_actors" && actorSkipIds.has(row.audit_actor_id as string)) {
            continue;
          }
          stmt.run(...spec.identity.map((col) => rowValue(row, col)));
        }
      } catch {
        failedGroups += 1;
      }
    }
    if (failedGroups === 0) {
      db.exec("COMMIT");
    } else {
      // Partial compensation would leave an incoherent mix; undo it all and
      // report incomplete cleanup (the committed import stays in place).
      db.exec("ROLLBACK");
      return failedGroups;
    }
  } catch {
    try {
      db.exec("ROLLBACK");
    } catch {
      // Nothing more can be done at this layer.
    }
    return Math.max(failedGroups, 1);
  }
  return 0;
}

// ---------------------------------------------------------------------------
// Crash recovery sweep
// ---------------------------------------------------------------------------

interface SweepResult {
  readonly summary: RecoverySummary;
  readonly finalizedManifest: ImportManifest | null;
}

async function recoverJournals(input: {
  options: ImportOptions;
  layout: DataRootLayout;
  db: DatabaseSync;
  source: SourceData;
  journals: readonly ImportJournal[];
  actorSkipIds: ReadonlySet<string>;
  now: () => Date;
}): Promise<SweepResult> {
  const { options, layout, db, source, journals, actorSkipIds, now } = input;
  let rolledBackJournals = 0;
  let finalizedJournals = 0;
  let foreignJournals = 0;
  let finalizedManifest: ImportManifest | null = null;

  for (const journal of journals) {
    if (journal.sourceFingerprint !== source.fingerprint) {
      // Belongs to a different source dataset; its own import run recovers it.
      foreignJournals += 1;
      continue;
    }
    const stmt = db.prepare(
      `SELECT 1 FROM analysis_projects WHERE analysis_project_id = ? LIMIT 1`,
    );
    let present = 0;
    for (const id of journal.plannedProjectIds) {
      if (stmt.get(id) !== undefined) present += 1;
    }

    if (present === 0) {
      // Blob cleanup is state-sensitive: the ownership snapshot only exists
      // from the `publishing` transition on. Pre-snapshot states
      // (started/staged) never reached publishing, so the attempt created NO
      // blobs and ONLY staging + journal are removed - the initializer empty
      // preExistingBlobRefs must never be read as "nothing pre-existed".
      let failedRefs: readonly string[] = [];
      if (hasOwnershipSnapshot(journal)) {
        const rollback = rollbackOwnedBlobs(
          layout.blobsDir,
          [...source.blobPlan.keys()],
          journal.preExistingBlobRefs,
        );
        failedRefs = rollback.failedRefs;
      }
      const stagingRemoved = removeStagingDir(join(layout.tmpDir, journal.stagingDirName));
      if (failedRefs.length > 0 || !stagingRemoved) {
        // Cleanup incomplete: retain the journal (scoped to the unrecoverable
        // refs) and fail closed; the import must not proceed or claim success.
        try {
          updateJournal(options.targetDataRoot, journal, {
            createdBlobRefs: failedRefs,
          });
        } catch {
          // Journal retention failed; still fail closed below.
        }
        throw new ImportError(
          "recovery_cleanup_failed",
          "recovery",
          `Recovery cleanup incomplete (${failedRefs.length} blob ref(s)` +
            `${stagingRemoved ? "" : ", staging dir"} could not be removed); ` +
            `journal and target artifacts retained for retry/manual cleanup.`,
        );
      }
      deleteJournal(options.targetDataRoot, journal.attemptId);
      rolledBackJournals += 1;
      writeFailedManifestBestEffort(
        options,
        journal.attemptId,
        source,
        journal.startedAt,
        now,
        new ImportError(
          "tx_failed",
          "transaction",
          "Recovered an interrupted import attempt; created blobs were rolled back.",
        ),
      );
      continue;
    }
    if (present !== journal.plannedProjectIds.length || !hasOwnershipSnapshot(journal)) {
      // Partial presence is impossible for a single transaction; committed
      // rows with a pre-snapshot journal contradict the state machine. Both
      // fail closed with everything preserved.
      throw new ImportError(
        "recovery_partial_state",
        "recovery",
        "A previous import attempt left an inconsistent target state; manual resolution required.",
      );
    }

    // Committed but not finalized (crash between commit and manifest):
    // re-run reconciliation, then write the manifest and clean up.
    verifyState(db, source, options.targetWorkspaceId, actorSkipIds, { checkCounts: false });
    verifyBlobs(layout.blobsDir, source);
    const insertedCounts = computeInsertedCounts(source, actorSkipIds);
    // Deduplicated = plan refs that already existed before the attempt.
    const preExistingSet = new Set(journal.preExistingBlobRefs);
    const deduplicatedCount = [...source.blobPlan.keys()].filter((ref) =>
      preExistingSet.has(ref),
    ).length;
    const manifest: ImportManifest = {
      manifestVersion: 1,
      attemptId: journal.attemptId,
      sourceFingerprint: source.fingerprint,
      targetWorkspaceId: options.targetWorkspaceId,
      tableCounts: insertedCounts,
      blobCount: source.blobCount,
      deduplicatedBlobCount: deduplicatedCount,
      blobHashSetDigest: computeBlobHashSetDigest(
        [...source.blobPlan.values()].map((entry) => entry.hash),
      ),
      startedAt: journal.startedAt,
      completedAt: now().toISOString(),
      result: "completed",
    };
    writeManifest(options.targetDataRoot, manifest);
    removeStagingDir(join(layout.tmpDir, journal.stagingDirName));
    deleteJournal(options.targetDataRoot, journal.attemptId);
    finalizedJournals += 1;
    finalizedManifest = manifest;
  }

  return { summary: { rolledBackJournals, finalizedJournals, foreignJournals }, finalizedManifest };
}

// ---------------------------------------------------------------------------
// Dry-run reporting
// ---------------------------------------------------------------------------

function drySourceSummary(source: SourceData): NonNullable<DryRunReport["source"]> {
  return {
    migrations: source.appliedMigrations.map((m) => ({
      version: m.version,
      name: m.name,
      checksum: m.checksum,
    })),
    fingerprint: source.fingerprint,
    tableCounts: source.tableCounts,
    totalPlannedIds: Object.values(source.tableCounts).reduce((acc, n) => acc + n, 0),
    blobCount: source.blobCount,
    totalBlobBytes: source.totalBlobBytes,
  };
}

function buildDryReport(input: {
  source: SourceData;
  options: ImportOptions;
  dbExisted: boolean;
  targetApplied: readonly MigrationRecord[];
  preCounts?: Record<string, number>;
  journals: readonly ImportJournal[];
  actorSkips: number;
  conflicts: ConflictReport;
}): DryRunReport {
  const { source, options, dbExisted, targetApplied, preCounts, journals, actorSkips, conflicts } = input;
  const matchingJournals = journals.filter(
    (j) => j.sourceFingerprint === source.fingerprint,
  ).length;
  const insertCounts: Record<string, number> = {};
  for (const spec of TABLE_SPECS) {
    const rows = source.rows.get(spec.table)!.length;
    insertCounts[spec.table] = spec.table === "audit_actors" ? rows - actorSkips : rows;
  }
  return {
    kind: "dry_run",
    ok: conflicts.total === 0,
    alreadyImported: false,
    source: drySourceSummary(source),
    target: {
      dbPresent: dbExisted,
      plannedInit: !dbExisted && options.allowTargetInit === true,
      migrations:
        targetApplied.length > 0
          ? targetApplied.map((m) => ({
              version: m.version,
              name: m.name,
              checksum: m.checksum,
            }))
          : undefined,
      workspaceExists: true,
      preExistingCounts: preCounts,
      pendingJournals: matchingJournals,
      foreignJournals: journals.length - matchingJournals,
      // Corrupted journals fail closed earlier (recovery_journal_corrupt).
      corruptedJournals: 0,
    },
    plan: {
      insertCounts,
      actorSkips,
      blobsToStage: source.blobCount,
    },
    conflicts: {
      durableId: sumValues(conflicts.durableId),
      uniqueKey: sumValues(conflicts.uniqueKey),
      actorIdentity: conflicts.actorIdentity,
    },
    errors: [],
  };
}

function dryReportFromAlreadyImported(
  source: SourceData,
  dbExisted: boolean,
  journals: readonly ImportJournal[],
): DryRunReport {
  return {
    kind: "dry_run",
    ok: true,
    alreadyImported: true,
    source: drySourceSummary(source),
    target: {
      dbPresent: dbExisted,
      plannedInit: false,
      workspaceExists: true,
      pendingJournals: journals.length,
      foreignJournals: 0,
      corruptedJournals: 0,
    },
    plan: { insertCounts: {}, actorSkips: 0, blobsToStage: 0 },
    conflicts: { durableId: 0, uniqueKey: 0, actorIdentity: 0 },
    errors: [],
  };
}
