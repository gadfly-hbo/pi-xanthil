/**
 * Atomic target import lock (T0014 brief; revision 3 + 4 reviews).
 *
 * Contract:
 * - A single exclusive lock per target root serializes real import attempts.
 * - The lock file is created with O_EXCL (mkstemp-style): EEXIST means another
 *   attempt is in progress or a previous attempt crashed without releasing it.
 * - Failure to acquire is fail-closed and distinguished by cause (R4):
 *   EEXIST -> target_import_locked (contention); any other open/write error
 *   (missing parent, permissions, ...) -> target_root_invalid. The caller is
 *   responsible for establishing the lock parent (mkdir) only AFTER the
 *   journal gates have passed.
 * - The lock FILE itself is created only after it is acquired; it is a small
 *   JSON payload with diagnostic fields (attemptId, acquiredAt, host) and
 *   never contains blob content, SQL, row data, or ABSOLUTE PATHS (R4).
 * - Release is best-effort (rmSync): if the process crashes between acquire
 *   and release, the lock stays and the next run must reject it; this is
 *   intentional fail-closed semantics, identical to journal-retained recovery
 *   state, and consistent with how a corrupt/crashed journal is handled.
 */
import { closeSync, openSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ImportError } from "./errors.ts";

export const TARGET_IMPORT_LOCK_FILENAME = ".import.lock";

export interface ImportLock {
  readonly path: string;
  readonly attemptId: string;
  readonly acquiredAt: string;
}

/**
 * On-disk lock metadata. Diagnostic only (never used for ownership
 * decisions); deliberately carries NO absolute paths (R4) so the artifact
 * stays safe to log and share.
 */
export interface ImportLockContents {
  readonly attemptId: string;
  readonly acquiredAt: string;
  /** diagnostic tag (not used for ownership decisions). */
  readonly host: "kimi-import";
}

/**
 * Attempt to acquire the target import lock. Returns the lock on success or
 * a structured ImportError on failure. The caller MUST call releaseImportLock
 * in a `finally` block to avoid leaving a stale lock that blocks future runs.
 *
 * Lock lives at <targetRoot>/.import.lock - outside the imports/ subdirectory
 * so that a target_not_initialized / target_locked / target_busy check that
 * never touches the imports/ directory does not accidentally create it.
 * Atomic by filesystem O_EXCL: two concurrent `runImport` calls cannot both
 * observe success (at least one gets EEXIST → fail-closed).
 *
 * The lock parent (targetRoot) must already exist: the caller establishes it
 * after the journal gates, so a genuinely absent target root is not
 * misreported as lock contention (ENOENT maps to target_root_invalid here).
 */
export function acquireImportLock(
  targetRoot: string,
  attemptId: string,
  now: () => Date,
): ImportLock {
  const path = join(targetRoot, TARGET_IMPORT_LOCK_FILENAME);
  const acquiredAt = now().toISOString();
  let fd: number;
  try {
    fd = openSync(path, "wx");
  } catch (err) {
    if ((err as { code?: string }).code === "EEXIST") {
      throw new ImportError(
        "target_import_locked",
        "target_schema",
        "Another import attempt holds the target lock; " +
          "wait for it to finish or remove the lock file after inspecting its holder metadata.",
      );
    }
    throw new ImportError(
      "target_root_invalid",
      "target_schema",
      "Target import lock could not be created; the target root is missing or not writable.",
    );
  }
  try {
    const payload: ImportLockContents = {
      attemptId,
      acquiredAt,
      host: "kimi-import",
    };
    writeFileSync(fd, JSON.stringify(payload, null, 2), "utf8");
  } catch (err) {
    // Payload write failed: do not leave a half-written lock behind.
    try {
      closeSync(fd);
    } catch {
      // Best-effort close.
    }
    rmSync(path, { force: true });
    throw err instanceof ImportError
      ? err
      : new ImportError(
          "target_root_invalid",
          "target_schema",
          "Target import lock metadata could not be written; the target root is not writable.",
        );
  }
  try {
    closeSync(fd);
  } catch {
    // Best-effort close; the lock is already persisted.
  }
  return { path, attemptId, acquiredAt };
}

/**
 * Release the lock best-effort. If the file is missing or unlinkable, this
 * is a no-op; the next acquire attempt would observe a clean state and may
 * succeed (a different crash may have already removed it via targeted fs
 * repair). Callers must NEVER throw here.
 */
export function releaseImportLock(lock: ImportLock): void {
  try {
    rmSync(lock.path, { force: true });
  } catch {
    // Best-effort: stale locks are operator-resolved on the next acquisition.
  }
}
