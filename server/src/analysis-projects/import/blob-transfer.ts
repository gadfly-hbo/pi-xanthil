/**
 * Blob staging, publishing, and rollback for the importer.
 *
 * Contract (T0014 brief requirements 3, 8; revision 1 review):
 * - Source blobs are read-only; bytes are copied to target staging, hash
 *   verified, then atomically hard-linked into the content-addressed store
 *   (reusing the transplanted donor blob writer semantics).
 * - Rollback is ownership-safe: pre-existing deduplicated blobs are never
 *   deleted. The pre-publish existence snapshot (journal) plus disk state
 *   defines exactly which blobs an attempt created, closing the crash
 *   window between linking a blob and recording it.
 * - Cleanup failures are never swallowed: every rollback helper reports
 *   exactly which refs could not be removed so the caller can retain
 *   recovery state and surface incomplete cleanup.
 */
import { copyFileSync, existsSync, mkdirSync, rmSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import {
  blobAbsolutePath,
  linkBlobFromFile,
} from "../persistence/blob-writer.ts";
import { ImportError } from "./errors.ts";
import { hashFileStreamingSync } from "./fs-hash.ts";
import type { BlobPlanEntry } from "./source-reader.ts";

/**
 * Mutable publish tracker: the caller owns the rollback scope even when
 * publishing fails halfway (createdRefs holds the partial created set).
 */
export interface BlobPublishTracker {
  /** storage_refs physically created by this attempt (rollback scope). */
  createdRefs: string[];
  /** Count of refs that already existed with identical hash (kept as-is). */
  deduplicatedCount: number;
}

export interface BlobRollbackResult {
  /** Refs successfully removed. */
  readonly deletedCount: number;
  /** Refs that could not be removed (cleanup incomplete). Internal only. */
  readonly failedRefs: readonly string[];
}

/**
 * Stage all planned source blobs into the attempt staging directory and
 * verify each staged copy against its expected hash.
 */
export function stageBlobs(
  sourceBlobsDir: string,
  stagingDir: string,
  plan: ReadonlyMap<string, BlobPlanEntry>,
): void {
  mkdirSync(stagingDir, { recursive: true });
  for (const entry of plan.values()) {
    const sourcePath = blobAbsolutePath(sourceBlobsDir, entry.ref);
    const stagedPath = join(stagingDir, entry.hash);
    try {
      copyFileSync(sourcePath, stagedPath);
    } catch {
      throw new ImportError(
        "blob_publish_failed",
        "blob",
        "Failed to stage a source blob into the target staging area.",
      );
    }
    const stagedHash = hashFileStreamingSync(stagedPath);
    if (stagedHash !== entry.hash) {
      throw new ImportError(
        "blob_hash_mismatch",
        "blob",
        "A staged blob failed SHA-256 verification.",
      );
    }
  }
}

/**
 * Publish staged blobs into the target content-addressed store.
 * Appends created refs to the tracker as it goes; onBlobPublished (if given)
 * runs synchronously after each blob - including immediately after the
 * first one, which the crash-simulation test hook uses.
 * Throws ImportError on failure; the tracker retains the partial state.
 */
export async function publishBlobs(
  targetBlobsDir: string,
  stagingDir: string,
  plan: ReadonlyMap<string, BlobPlanEntry>,
  tracker: BlobPublishTracker,
  onBlobPublished?: (entry: BlobPlanEntry, tracker: BlobPublishTracker) => void,
): Promise<void> {
  for (const entry of plan.values()) {
    const stagedPath = join(stagingDir, entry.hash);
    let result;
    try {
      result = await linkBlobFromFile(targetBlobsDir, stagedPath, entry.hash);
    } catch {
      throw new ImportError(
        "blob_publish_failed",
        "blob",
        "Failed to publish a staged blob into the target store.",
      );
    }
    if (result.deduplicated) {
      tracker.deduplicatedCount += 1;
    } else {
      tracker.createdRefs.push(result.storageRef);
    }
    if (onBlobPublished) {
      onBlobPublished(entry, tracker);
    }
  }
}

/**
 * Compute which plan refs already exist in the target store (the pre-publish
 * ownership snapshot recorded in the recovery journal).
 */
export function snapshotExistingBlobRefs(
  targetBlobsDir: string,
  plan: ReadonlyMap<string, BlobPlanEntry>,
): readonly string[] {
  const existing: string[] = [];
  for (const entry of plan.values()) {
    if (existsSync(blobAbsolutePath(targetBlobsDir, entry.ref))) {
      existing.push(entry.ref);
    }
  }
  return existing;
}

/**
 * Delete exactly the given refs, reporting per-ref failures. Pre-existing
 * blobs are the caller's responsibility to exclude. Missing files count as
 * deleted (idempotent cleanup).
 */
export function deleteBlobRefs(
  targetBlobsDir: string,
  refs: readonly string[],
): BlobRollbackResult {
  const failedRefs: string[] = [];
  let deletedCount = 0;
  for (const ref of refs) {
    try {
      const absPath = blobAbsolutePath(targetBlobsDir, ref);
      if (existsSync(absPath)) {
        unlinkSync(absPath);
      }
      deletedCount += 1;
    } catch {
      failedRefs.push(ref);
    }
  }
  return { deletedCount, failedRefs };
}

/**
 * Ownership-safe crash-recovery rollback: delete every plan ref that exists
 * on disk and was NOT present in the pre-publish snapshot. Refs in the
 * snapshot pre-date the attempt and are never deleted.
 */
export function rollbackOwnedBlobs(
  targetBlobsDir: string,
  planRefs: readonly string[],
  preExistingRefs: readonly string[],
): BlobRollbackResult {
  const preExisting = new Set(preExistingRefs);
  const owned = planRefs.filter(
    (ref) => !preExisting.has(ref) && existsSync(blobAbsolutePath(targetBlobsDir, ref)),
  );
  return deleteBlobRefs(targetBlobsDir, owned);
}

/** Remove the attempt staging directory (idempotent). Returns success. */
export function removeStagingDir(stagingDir: string): boolean {
  try {
    rmSync(stagingDir, { recursive: true, force: true });
    return true;
  } catch {
    return false;
  }
}
