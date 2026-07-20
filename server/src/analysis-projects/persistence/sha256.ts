/**
 * SHA-256 helper.
 *
 * Contract (schema-v1-and-migrations.md):
 * - 64-character lowercase hexadecimal TEXT.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

/**
 * Compute SHA-256 of a string and return lowercase hex.
 */
export function sha256Hex(data: string): string {
  return createHash("sha256").update(data, "utf8").digest("hex");
}

/**
 * Compute SHA-256 of a Uint8Array and return lowercase hex.
 */
export function sha256HexBytes(data: Uint8Array): string {
  return createHash("sha256").update(data).digest("hex");
}

/**
 * Compute SHA-256 of a file's content and return lowercase hex.
 * Uses streaming to handle large files.
 */
export function sha256File(filePath: string): string {
  const buf = readFileSync(filePath);
  return createHash("sha256").update(buf).digest("hex");
}
