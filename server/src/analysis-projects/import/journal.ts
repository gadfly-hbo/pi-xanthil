/**
 * Import journal and manifest persistence (target-side only).
 *
 * Contract (T0014 brief requirements 8, 10, 11; revision 1 review):
 * - The journal is the crash-recovery artifact: attempt state, planned
 *   project IDs, the pre-publish existence snapshot (ownership-safe
 *   rollback), and ONLY the blob references this attempt created, so
 *   rollback can restore the pre-call state without touching pre-existing
 *   deduplicated blobs.
 * - The pre-publish snapshot closes the crash window between linking a blob
 *   and recording it: recovery never relies on per-blob journal flushes;
 *   "created by this attempt" is derived as {plan refs on disk} minus
 *   {refs in the snapshot}.
 * - Corrupted or unreadable journals are never silently skipped: they are
 *   reported separately and fail the import closed, preserving all target
 *   artifacts for manual/retry handling.
 * - The manifest is the audit artifact: source fingerprint, target workspace
 *   ID, per-table counts, blob count, hash-set digest, timestamps, result.
 *   It never contains raw content, absolute paths, storage_refs, SQL, or
 *   individual blob hashes.
 */
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { canonicalJsonStringify } from "../persistence/canonical-json.ts";
import { sha256Hex } from "../persistence/sha256.ts";
import { isSha256Hex, isUuidV4 } from "../application/shared/runtime.ts";

export const IMPORTS_DIR_NAME = "imports";

export type JournalState =
  | "started"
  | "staged"
  | "publishing"
  | "published"
  | "db_committed";

export interface ImportJournal {
  readonly attemptId: string;
  readonly state: JournalState;
  readonly startedAt: string;
  readonly sourceFingerprint: string;
  /** Planned analysis_project_id set; used by crash recovery. Internal only. */
  readonly plannedProjectIds: readonly string[];
  /**
   * Ownership snapshot: plan blob refs that already existed in the target
   * store BEFORE publishing began. Recovery may never delete these.
   */
  readonly preExistingBlobRefs: readonly string[];
  /** Blob storage_refs created by THIS attempt (fast-path rollback scope). */
  readonly createdBlobRefs: readonly string[];
  /** Staging directory name relative to the target artifacts/tmp dir. */
  readonly stagingDirName: string;
}

export interface ImportManifest {
  readonly manifestVersion: 1;
  readonly attemptId: string;
  readonly sourceFingerprint: string;
  readonly targetWorkspaceId: string;
  /** Per-table inserted row counts (actors already present are excluded). */
  readonly tableCounts: Readonly<Record<string, number>>;
  readonly blobCount: number;
  readonly deduplicatedBlobCount: number;
  /** SHA-256 over the canonical sorted unique blob hash set (not the hashes). */
  readonly blobHashSetDigest: string;
  readonly startedAt: string;
  readonly completedAt: string;
  readonly result: "completed" | "failed";
  readonly errorCode?: string;
  readonly errorCategory?: string;
}

export interface JournalListing {
  /** Well-formed journals, recoverable. */
  readonly journals: readonly ImportJournal[];
  /** File names that look like journals but are unreadable/invalid. */
  readonly corrupted: readonly string[];
}

export function importsDir(targetRoot: string): string {
  return join(targetRoot, IMPORTS_DIR_NAME);
}

function journalPath(dir: string, attemptId: string): string {
  return join(dir, `import-${attemptId}.journal.json`);
}

function manifestPath(dir: string, attemptId: string): string {
  return join(dir, `import-${attemptId}.manifest.json`);
}

/** Atomic JSON write (temp file + rename) within the same directory. */
function writeJsonAtomic(filePath: string, value: unknown): void {
  const tmpPath = `${filePath}.tmp`;
  writeFileSync(tmpPath, JSON.stringify(value, null, 2), "utf8");
  renameSync(tmpPath, filePath);
}

const JOURNAL_STATES: readonly JournalState[] = [
  "started",
  "staged",
  "publishing",
  "published",
  "db_committed",
];

/** Controlled blob storage_ref shape: blobs/<hex2>/<hex64> with shard match. */
function isValidBlobRef(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const match = /^blobs\/([0-9a-f]{2})\/([0-9a-f]{64})$/.exec(value);
  return match !== null && match[1] === match[2]!.slice(0, 2);
}

function isUuidArray(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.every((entry) => isUuidV4(entry));
}

function isBlobRefArray(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.every((entry) => isValidBlobRef(entry));
}

function isUniqueArray(value: readonly string[]): boolean {
  const seen = new Set<string>();
  for (const entry of value) {
    if (seen.has(entry)) return false;
    seen.add(entry);
  }
  return true;
}

/**
 * Tighten journal semantic validation (revision 3 + 4 reviews): in addition
 * to shape (JSON-parsable, every field has the right type), state-owned
 * arrays must be (a) internally unique, (b) disjoint across the two blob
 * ownership sets (a ref cannot be both pre-existing and created), (c) the
 * journal filename must match the embedded attemptId so a journal renamed
 * onto disk does not get trusted, and (d) pre-snapshot states
 * (started/staged) must carry EMPTY ownership arrays - the snapshot only
 * exists from the `publishing` transition on, so a non-empty array in a
 * pre-snapshot state contradicts the state machine. Any violation marks the
 * file as corrupted and forces the importer to fail closed before any
 * recovery mutation.
 */
export function isValidJournalShape(
  parsed: unknown,
  filename: string,
): parsed is ImportJournal {
  if (typeof parsed !== "object" || parsed === null) return false;
  const candidate = parsed as Record<string, unknown>;
  if (!isUuidV4(candidate.attemptId)) return false;
  if (filename !== `import-${candidate.attemptId}.journal.json`) return false;
  if (typeof candidate.state !== "string") return false;
  if (!JOURNAL_STATES.includes(candidate.state as JournalState)) return false;
  if (typeof candidate.startedAt !== "string" || candidate.startedAt.length === 0) return false;
  if (!isSha256Hex(candidate.sourceFingerprint)) return false;
  if (!isUuidArray(candidate.plannedProjectIds)) return false;
  if (!isUniqueArray(candidate.plannedProjectIds)) return false;
  if (!isBlobRefArray(candidate.preExistingBlobRefs)) return false;
  if (!isUniqueArray(candidate.preExistingBlobRefs)) return false;
  if (!isBlobRefArray(candidate.createdBlobRefs)) return false;
  if (!isUniqueArray(candidate.createdBlobRefs)) return false;
  // Disjointness: a blob cannot be both pre-existing and created.
  const preSet = new Set(candidate.preExistingBlobRefs);
  for (const ref of candidate.createdBlobRefs) {
    if (preSet.has(ref)) return false;
  }
  // State-bound ownership invariant (R4): the ownership snapshot and the
  // created-refs list only exist from the `publishing` transition onward.
  // A pre-snapshot state carrying non-empty arrays contradicts the state
  // machine (see hasOwnershipSnapshot) and must fail closed as corrupted.
  if (
    (candidate.state === "started" || candidate.state === "staged") &&
    (candidate.preExistingBlobRefs.length > 0 || candidate.createdBlobRefs.length > 0)
  ) {
    return false;
  }
  if (candidate.stagingDirName !== `import-${candidate.attemptId}`) return false;
  return true;
}

export function createJournal(
  targetRoot: string,
  journal: Omit<ImportJournal, "createdBlobRefs" | "preExistingBlobRefs">,
): ImportJournal {
  const dir = importsDir(targetRoot);
  mkdirSync(dir, { recursive: true });
  const full: ImportJournal = { ...journal, preExistingBlobRefs: [], createdBlobRefs: [] };
  writeJsonAtomic(journalPath(dir, journal.attemptId), full);
  return full;
}

export function updateJournal(
  targetRoot: string,
  journal: ImportJournal,
  update: Partial<Pick<ImportJournal, "state" | "createdBlobRefs" | "preExistingBlobRefs">>,
): ImportJournal {
  const next: ImportJournal = {
    ...journal,
    state: update.state ?? journal.state,
    createdBlobRefs: update.createdBlobRefs ?? journal.createdBlobRefs,
    preExistingBlobRefs: update.preExistingBlobRefs ?? journal.preExistingBlobRefs,
  };
  writeJsonAtomic(journalPath(importsDir(targetRoot), journal.attemptId), next);
  return next;
}

export function deleteJournal(targetRoot: string, attemptId: string): void {
  rmSync(journalPath(importsDir(targetRoot), attemptId), { force: true });
}

/**
 * Whether the journal's preExistingBlobRefs is a real ownership snapshot.
 * The snapshot is only taken at the `publishing` transition, so journals in
 * `started`/`staged` state have the initializer empty array - which must
 * never be interpreted as "nothing pre-existed". Recovery must not delete
 * any blob for pre-snapshot states: publishing never began, so the attempt
 * could not have created any blob.
 */
export function hasOwnershipSnapshot(journal: ImportJournal): boolean {
  return (
    journal.state === "publishing" ||
    journal.state === "published" ||
    journal.state === "db_committed"
  );
}

/**
 * List recovery journals. Files matching the journal pattern that cannot be
 * parsed or fail shape validation are returned as corrupted - callers must
 * fail closed, never silently skip them.
 */
export function listJournals(targetRoot: string): JournalListing {
  const dir = importsDir(targetRoot);
  if (!existsSync(dir)) return { journals: [], corrupted: [] };
  const journals: ImportJournal[] = [];
  const corrupted: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (!entry.endsWith(".journal.json")) continue;
    try {
      const parsed: unknown = JSON.parse(readFileSync(join(dir, entry), "utf8"));
      if (isValidJournalShape(parsed, entry)) {
        journals.push(parsed);
      } else {
        corrupted.push(entry);
      }
    } catch {
      corrupted.push(entry);
    }
  }
  return { journals, corrupted };
}

export function writeManifest(targetRoot: string, manifest: ImportManifest): void {
  const dir = importsDir(targetRoot);
  mkdirSync(dir, { recursive: true });
  writeJsonAtomic(manifestPath(dir, manifest.attemptId), manifest);
}

export function listManifests(targetRoot: string): readonly ImportManifest[] {
  const dir = importsDir(targetRoot);
  if (!existsSync(dir)) return [];
  const manifests: ImportManifest[] = [];
  for (const entry of readdirSync(dir)) {
    if (!entry.endsWith(".manifest.json")) continue;
    try {
      const parsed = JSON.parse(readFileSync(join(dir, entry), "utf8")) as ImportManifest;
      if (
        parsed.manifestVersion === 1 &&
        typeof parsed.sourceFingerprint === "string" &&
        (parsed.result === "completed" || parsed.result === "failed")
      ) {
        manifests.push(parsed);
      }
    } catch {
      // Corrupt manifest: ignore for lookup purposes (manifests are audit
      // artifacts, not recovery state; journals gate recovery).
    }
  }
  return manifests;
}

/** Find a completed manifest for the exact source fingerprint. */
export function findCompletedManifest(
  targetRoot: string,
  sourceFingerprint: string,
): ImportManifest | null {
  for (const manifest of listManifests(targetRoot)) {
    if (manifest.result === "completed" && manifest.sourceFingerprint === sourceFingerprint) {
      return manifest;
    }
  }
  return null;
}

/** Digest over the sorted unique blob hash set (never the hashes themselves). */
export function computeBlobHashSetDigest(hashes: readonly string[]): string {
  const uniqueSorted = [...new Set(hashes)].sort();
  return sha256Hex(canonicalJsonStringify(uniqueSorted));
}
