import { createHash } from "node:crypto";
import { createReadStream, statSync } from "node:fs";

/** Compute SHA-256 of a file's content. Returns null on any I/O error. */
export function computeFileHash(filePath: string): Promise<string | null> {
  return new Promise((resolve) => {
    try {
      const hash = createHash("sha256");
      const stream = createReadStream(filePath);
      stream.on("data", (chunk) => hash.update(chunk as Buffer));
      stream.on("end", () => resolve(hash.digest("hex")));
      stream.on("error", () => resolve(null));
    } catch {
      resolve(null);
    }
  });
}

/** File size in bytes, or null if inaccessible. */
export function getFileSize(filePath: string): number | null {
  try {
    return statSync(filePath).size;
  } catch {
    return null;
  }
}
