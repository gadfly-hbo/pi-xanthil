/**
 * Content-addressed blob writer.
 *
 * Contract (P0-36, P0-64, schema-v1-and-migrations.md):
 * - Content-addressed storage: blob path derived from contentSha256.
 * - Temporary file + hash verification + atomic rename.
 * - Formal blobs are immutable (never overwritten).
 * - Same bytes physically deduplicate (reuse existing blob).
 * - storageRef is a controlled relative reference, never an arbitrary path.
 * - Tests must use temp data root, never ~/.pi-xanthil or the repo.
 */
import {
  writeFileSync,
  existsSync,
  linkSync,
  mkdtempSync,
  rmSync,
  readFileSync,
  mkdirSync,
  createReadStream,
  statSync,
} from "node:fs";
import { createHash } from "node:crypto";
import { Readable } from "node:stream";
import { join, resolve, relative } from "node:path";
import { sha256Hex, sha256HexBytes } from "./sha256.ts";
import { canonicalJsonSerialize } from "./canonical-json.ts";

export class BlobWriterError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BlobWriterError";
  }
}

/**
 * Controlled relative storageRef prefix for content-addressed blobs.
 * Format: "blobs/<first2>/<hash>"
 */
const BLOB_REF_PREFIX = "blobs";

/**
 * Compute the controlled relative storageRef for a given SHA-256 hash.
 * Format: "blobs/ab/abcdef1234..."
 */
export function blobStorageRef(contentSha256: string): string {
  if (!/^[0-9a-f]{64}$/.test(contentSha256)) {
    throw new BlobWriterError(
      `Invalid SHA-256 hash: ${contentSha256}`,
    );
  }
  return `${BLOB_REF_PREFIX}/${contentSha256.slice(0, 2)}/${contentSha256}`;
}

/**
 * Compute the absolute blob path from the blobs directory and storageRef.
 * Validates that the resolved path stays within blobsDir (no path traversal).
 */
export function blobAbsolutePath(blobsDir: string, storageRef: string): string {
  if (!storageRef.startsWith(`${BLOB_REF_PREFIX}/`)) {
    throw new BlobWriterError(
      `Uncontrolled storageRef (must start with '${BLOB_REF_PREFIX}/'): ${storageRef}`,
    );
  }
  const relPart = storageRef.slice(`${BLOB_REF_PREFIX}/`.length);
  // Strict validation: only allow hex chars and slashes in the relative part
  if (!/^[0-9a-f]{2}\/[0-9a-f]{64}$/.test(relPart)) {
    throw new BlobWriterError(
      `Malformed storageRef (expected blobs/<hex2>/<hex64>): ${storageRef}`,
    );
  }
  // Validate shard matches first 2 chars of hash
  const shard = relPart.slice(0, 2);
  const hash = relPart.slice(3); // skip "xx/"
  if (hash.slice(0, 2) !== shard) {
    throw new BlobWriterError(
      `Shard mismatch in storageRef: shard '${shard}' does not match hash prefix '${hash.slice(0, 2)}'`,
    );
  }
  const absPath = join(blobsDir, relPart);
  // Verify resolved path is still within blobsDir (no path traversal escape)
  const rel = relative(blobsDir, absPath);
  if (rel.startsWith("..") || resolve(blobsDir, rel) !== absPath) {
    throw new BlobWriterError(
      `Path traversal detected in storageRef: ${storageRef}`,
    );
  }
  return absPath;
}

export interface WriteBlobResult {
  storageRef: string;
  contentSha256: string;
  byteSize: number;
  deduplicated: boolean;
}

/**
 * Write content to a content-addressed blob.
 *
 * Process:
 * 1. Write to a temp file in the designated tmp directory (P0-38: artifacts/tmp).
 * 2. Compute and verify SHA-256.
 * 3. If target blob already exists (dedup), remove temp and return existing ref.
 * 4. Atomic linkSync temp -> final blob path (same filesystem required).
 *
 * @param blobsDir - The artifacts/blobs directory.
 * @param tmpDir - The artifacts/tmp directory (P0-38 designated temp area).
 * @param content - Raw bytes to write.
 * @param expectedSha256 - Optional expected hash for verification.
 * @returns storageRef, contentSha256, byteSize, deduplicated flag.
 */
export function writeBlob(
  blobsDir: string,
  tmpDir: string,
  content: Uint8Array,
  expectedSha256?: string,
): WriteBlobResult {
  const actualHash = sha256HexBytes(content);

  if (expectedSha256 !== undefined && expectedSha256 !== actualHash) {
    throw new BlobWriterError(
      `SHA-256 mismatch: expected ${expectedSha256}, got ${actualHash}`,
    );
  }

  const storageRef = blobStorageRef(actualHash);
  const finalPath = blobAbsolutePath(blobsDir, storageRef);

  // Ensure parent shard dir exists
  const parentDir = join(finalPath, "..");
  if (!existsSync(parentDir)) {
    mkdirSync(parentDir, { recursive: true });
  }

  // Dedup: if blob already exists, verify and return
  if (existsSync(finalPath)) {
    const existing = readFileSync(finalPath);
    if (existing.length !== content.length) {
      throw new BlobWriterError(
        `Blob hash collision detected at ${storageRef}: length mismatch`,
      );
    }
    const existingHash = sha256HexBytes(new Uint8Array(existing));
    if (existingHash !== actualHash) {
      throw new BlobWriterError(
        `Blob hash collision detected at ${storageRef}: content mismatch`,
      );
    }
    return {
      storageRef,
      contentSha256: actualHash,
      byteSize: content.length,
      deduplicated: true,
    };
  }

  // Create temp file in the designated tmp directory (P0-38: artifacts/tmp).
  // Both artifacts/tmp and artifacts/blobs are under the same artifacts/ root,
  // ensuring same-filesystem atomic linkSync.
  const tempDirName = mkdtempSync(join(tmpDir, "blob-"));
  const tempFile = join(tempDirName, "blob.tmp");
  try {
    writeFileSync(tempFile, content);

    // Verify written content hash
    const written = readFileSync(tempFile);
    const writtenHash = sha256HexBytes(new Uint8Array(written));
    if (writtenHash !== actualHash) {
      throw new BlobWriterError(
        `Temp file hash mismatch after write: expected ${actualHash}, got ${writtenHash}`,
      );
    }

    // Use linkSync for atomic creation: fails with EEXIST if another writer
    // already created the blob (concurrent write race protection).
    try {
      linkSync(tempFile, finalPath);
    } catch (err) {
      const e = err as NodeJS.ErrnoException;
      if (e.code === "EEXIST") {
        // Another writer created the blob concurrently; verify and dedup
        const existing = readFileSync(finalPath);
        const existingHash = sha256HexBytes(new Uint8Array(existing));
        if (existingHash !== actualHash) {
          throw new BlobWriterError(
            `Blob hash collision detected at ${storageRef} during concurrent write: content mismatch`,
          );
        }
        return {
          storageRef,
          contentSha256: actualHash,
          byteSize: content.length,
          deduplicated: true,
        };
      }
      throw err;
    }

    return {
      storageRef,
      contentSha256: actualHash,
      byteSize: content.length,
      deduplicated: false,
    };
  } finally {
    // Clean up temp directory
    rmSync(tempDirName, { recursive: true, force: true });
  }
}

export async function sha256HexFromFile(filePath: string): Promise<string> {
  const hash = createHash("sha256");
  const stream = createReadStream(filePath);
  for await (const chunk of stream) {
    hash.update(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return hash.digest("hex");
}

/**
 * Link an already-written temp file into the content-addressed blob store.
 *
 * Verifies the file hash against the expected value, then atomically links
 * the temp file to the final blob path. The caller is responsible for
 * removing the temp file after this call (on both success and failure).
 */
export async function linkBlobFromFile(
  blobsDir: string,
  tmpFilePath: string,
  expectedSha256: string,
): Promise<WriteBlobResult> {
  const actualHash = await sha256HexFromFile(tmpFilePath);
  if (actualHash !== expectedSha256) {
    throw new BlobWriterError(
      `SHA-256 mismatch: expected ${expectedSha256}, got ${actualHash}`,
    );
  }

  const { size: byteSize } = statSync(tmpFilePath);
  const storageRef = blobStorageRef(actualHash);
  const finalPath = blobAbsolutePath(blobsDir, storageRef);

  const parentDir = join(finalPath, "..");
  if (!existsSync(parentDir)) {
    mkdirSync(parentDir, { recursive: true });
  }

  if (existsSync(finalPath)) {
    const existing = readFileSync(finalPath);
    if (existing.length !== byteSize) {
      throw new BlobWriterError(
        `Blob hash collision detected at ${storageRef}: length mismatch`,
      );
    }
    const existingHash = sha256HexBytes(new Uint8Array(existing));
    if (existingHash !== actualHash) {
      throw new BlobWriterError(
        `Blob hash collision detected at ${storageRef}: content mismatch`,
      );
    }
    return {
      storageRef,
      contentSha256: actualHash,
      byteSize,
      deduplicated: true,
    };
  }

  try {
    linkSync(tmpFilePath, finalPath);
  } catch (err) {
    const e = err as NodeJS.ErrnoException;
    if (e.code === "EEXIST") {
      const existing = readFileSync(finalPath);
      const existingHash = sha256HexBytes(new Uint8Array(existing));
      if (existingHash !== actualHash) {
        throw new BlobWriterError(
          `Blob hash collision detected at ${storageRef} during concurrent write: content mismatch`,
        );
      }
      return {
        storageRef,
        contentSha256: actualHash,
        byteSize,
        deduplicated: true,
      };
    }
    throw err;
  }

  return {
    storageRef,
    contentSha256: actualHash,
    byteSize,
    deduplicated: false,
  };
}

export function writeCanonicalJsonBlob(
  blobsDir: string,
  tmpDir: string,
  value: unknown,
): WriteBlobResult {
  const bytes = canonicalJsonSerialize(value);
  return writeBlob(blobsDir, tmpDir, bytes);
}

/**
 * Read a blob by its storageRef from the blobs directory.
 */
export function readBlob(blobsDir: string, storageRef: string): Uint8Array {
  const absPath = blobAbsolutePath(blobsDir, storageRef);
  if (!existsSync(absPath)) {
    throw new BlobWriterError(`Blob not found: ${storageRef}`);
  }
  return new Uint8Array(readFileSync(absPath));
}

/**
 * Verify that a blob exists and its content matches the expected hash.
 */
export function verifyBlob(
  blobsDir: string,
  storageRef: string,
  expectedSha256: string,
): boolean {
  try {
    const content = readBlob(blobsDir, storageRef);
    const actualHash = sha256HexBytes(content);
    return actualHash === expectedSha256;
  } catch {
    return false;
  }
}
