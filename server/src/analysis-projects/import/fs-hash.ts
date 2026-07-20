/**
 * Streaming synchronous file hasher.
 *
 * Hashes file content in fixed-size chunks so blob bytes (including
 * restricted_raw Evidence) are never fully materialized in importer memory.
 * The importer never parses blob bytes - hashing is the only read.
 */
import { closeSync, openSync, readSync } from "node:fs";
import { createHash } from "node:crypto";

const CHUNK_SIZE = 1024 * 1024; // 1 MiB

/** Compute the SHA-256 of a file's content as lowercase hex, streaming. */
export function hashFileStreamingSync(filePath: string): string {
  const hash = createHash("sha256");
  const fd = openSync(filePath, "r");
  try {
    const buffer = Buffer.allocUnsafe(CHUNK_SIZE);
    let bytesRead = 0;
    while ((bytesRead = readSync(fd, buffer, 0, CHUNK_SIZE, null)) > 0) {
      hash.update(buffer.subarray(0, bytesRead));
    }
    return hash.digest("hex");
  } finally {
    closeSync(fd);
  }
}
