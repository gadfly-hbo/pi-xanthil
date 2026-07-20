/**
 * Minimal multipart/form-data parser for user Evidence upload.
 *
 * Contract (API-012, API-044): exactly one typed JSON metadata part and one
 * binary content part. No base64, no arbitrary paths, no multiple files.
 *
 * Streams the binary content part to disk instead of buffering the whole
 * upload in memory.
 */
import { createHash, randomUUID } from "node:crypto";
import { createWriteStream, unlinkSync, openSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { ApplicationError } from "../contracts/envelope.ts";

export class MultipartError extends ApplicationError {}

export interface MultipartPart {
  readonly name: string;
  readonly filename: string | null;
  readonly contentType: string;
  readonly body: Buffer;
}

export interface ParsedMultipart {
  readonly metadataPart: MultipartPart;
  readonly contentPart: MultipartPart;
}

export interface StreamingContentPart {
  readonly tmpPath: string;
  readonly sha256: string;
  readonly byteSize: number;
  readonly contentType: string;
  readonly filename: string | null;
}

export interface StreamingMultipartResult {
  readonly metadataBytes: Buffer;
  readonly content: StreamingContentPart;
}

export function parseContentTypeBoundary(contentType: string | undefined): string {
  if (!contentType || !contentType.startsWith("multipart/form-data")) {
    throw new MultipartError("unsupported_media_type", "Evidence upload requires multipart/form-data.");
  }
  const match = /boundary=([^;\s]+)/.exec(contentType);
  if (!match) throw new MultipartError("unsupported_media_type", "Missing multipart boundary.");
  let boundary = match[1]!.trim();
  if (boundary.startsWith('"') && boundary.endsWith('"')) {
    boundary = boundary.slice(1, -1).replace(/\\"/g, '"');
  }
  if (boundary.length === 0) throw new MultipartError("unsupported_media_type", "Empty multipart boundary.");
  return boundary;
}

export function parseMultipart(body: Buffer, boundary: string): ParsedMultipart {
  const delimiter = Buffer.from(`--${boundary}`);
  const parts: MultipartPart[] = [];

  let idx = body.indexOf(delimiter);
  if (idx < 0) throw new MultipartError("unsupported_media_type", "Invalid multipart body: boundary not found.");
  idx += delimiter.length;
  if (idx + 2 <= body.length && body[idx] === 0x0d && body[idx + 1] === 0x0a) idx += 2;
  else if (idx < body.length && body[idx] === 0x0a) idx += 1;

  while (idx < body.length) {
    const nextIdx = body.indexOf(delimiter, idx);
    if (nextIdx < 0) break;
    const partBody = body.slice(idx, nextIdx);
    let end = partBody.length;
    if (end >= 2 && partBody[end - 2] === 0x0d && partBody[end - 1] === 0x0a) end -= 2;
    else if (end >= 1 && partBody[end - 1] === 0x0a) end -= 1;
    const part = parsePart(partBody.slice(0, end));
    if (part) parts.push(part);
    idx = nextIdx + delimiter.length;
    if (idx + 2 <= body.length && body[idx] === 0x2d && body[idx + 1] === 0x2d) break;
    if (idx + 2 <= body.length && body[idx] === 0x0d && body[idx + 1] === 0x0a) idx += 2;
    else if (idx < body.length && body[idx] === 0x0a) idx += 1;
  }

  if (parts.length !== 2) {
    throw new MultipartError("validation_failed", "Evidence upload requires exactly one metadata part and one content part.");
  }
  const metadataParts = parts.filter((p) => p.name === "metadata");
  const contentParts = parts.filter((p) => p.name === "content");
  if (metadataParts.length !== 1 || contentParts.length !== 1) {
    throw new MultipartError("validation_failed", "Multipart parts must be named 'metadata' and 'content'.");
  }
  return { metadataPart: metadataParts[0]!, contentPart: contentParts[0]! };
}

export async function parseMultipartStream(
  stream: Readable,
  boundary: string,
  options: { maxBytes: number; tmpDir?: string },
): Promise<StreamingMultipartResult> {
  const delimiter = Buffer.from(`\r\n--${boundary}`);
  const preamble = Buffer.from(`--${boundary}`);
  const crlf = Buffer.from("\r\n\r\n");
  const lf = Buffer.from("\n\n");

  let buffer = Buffer.alloc(0);
  let totalRead = 0;
  let state: "preamble" | "headers" | "body" | "content" | "done" = "preamble";
  let currentPartName: string | null = null;
  let currentFilename: string | null = null;
  let currentContentType = "application/octet-stream";
  let foundMetadata = false;
  let foundContent = false;
  let metadataBody = Buffer.alloc(0);
  let contentWriter: ReturnType<typeof createContentWriter> | null = null;
  let contentTmpPath: string | null = null;

  function createContentWriter(tmpPath: string) {
    const fd = openSync(tmpPath, "w");
    const ws = createWriteStream("", { fd });
    const hash = createHash("sha256");
    let bytes = 0;
    let errored: Error | null = null;
    let draining = false;

    ws.on("error", (err: Error) => { errored = err; });

    async function write(buf: Buffer): Promise<void> {
      if (errored) throw errored;
      hash.update(buf);
      bytes += buf.length;
      if (draining) {
        await new Promise<void>((resolve) => ws.once("drain", resolve));
        draining = false;
      }
      const ok = ws.write(buf);
      if (!ok) {
        draining = true;
        await new Promise<void>((resolve, reject) => {
          const onDrain = () => { cleanup(); resolve(); };
          const onError = (err: Error) => { cleanup(); reject(err); };
          ws.once("drain", onDrain);
          ws.once("error", onError);
          function cleanup() {
            ws.off("drain", onDrain);
            ws.off("error", onError);
          }
        });
        draining = false;
      }
    }

    async function end(): Promise<void> {
      if (errored) throw errored;
      return new Promise<void>((resolve, reject) => {
        ws.on("finish", () => resolve());
        ws.on("error", (err) => reject(err));
        ws.end();
      });
    }

    return {
      write,
      end,
      destroy() { ws.destroy(); },
      digest() { return hash.digest("hex"); },
      byteSize() { return bytes; },
    };
  }

  for await (const chunk of stream) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    totalRead += buf.length;
    if (totalRead > options.maxBytes) {
      await cleanup();
      throw new MultipartError("payload_too_large", `Multipart body exceeds ${options.maxBytes} bytes.`);
    }
    buffer = Buffer.concat([buffer, buf]);

    let consumed = true;
    while (consumed && buffer.length > 0) {
      consumed = false;
      if (state === "preamble") {
        const idx = buffer.indexOf(preamble);
        if (idx >= 0) {
          // Need at least 2 bytes after preamble to decide next token.
          if (buffer.length < idx + preamble.length + 2) {
            buffer = buffer.slice(idx);
            break;
          }
          let cursor = idx + preamble.length;
          if (buffer[cursor] === 0x2d && buffer[cursor + 1] === 0x2d) {
            // Closing boundary immediately after preamble: empty multipart.
            buffer = buffer.slice(cursor + 2);
            state = "done";
            consumed = true;
            break;
          }
          if (buffer[cursor] === 0x0d && buffer[cursor + 1] === 0x0a) cursor += 2;
          else if (buffer[cursor] === 0x0a) cursor += 1;
          buffer = buffer.slice(cursor);
          state = "headers";
          consumed = true;
        } else {
          // Keep only last (preamble.length - 1) bytes for spanning boundary.
          buffer = buffer.length > preamble.length - 1 ? buffer.slice(buffer.length - (preamble.length - 1)) : buffer;
          break;
        }
      } else if (state === "headers") {
        let headerEnd = -1;
        let sepLen = 4;
        for (let i = 0; i < buffer.length - 1; i++) {
          if (buffer[i] === 0x0d && buffer[i + 1] === 0x0a && i + 3 < buffer.length && buffer[i + 2] === 0x0d && buffer[i + 3] === 0x0a) {
            headerEnd = i;
            sepLen = 4;
            break;
          }
          if (buffer[i] === 0x0a && buffer[i + 1] === 0x0a) {
            headerEnd = i;
            sepLen = 2;
            break;
          }
        }
        if (headerEnd >= 0) {
          const headers = parseHeaders(buffer.slice(0, headerEnd));
          const disp = headers["content-disposition"] || "";
          currentPartName = parseDispositionField(disp, "name");
          currentFilename = parseDispositionField(disp, "filename");
          currentContentType = headers["content-type"] || "application/octet-stream";
          buffer = buffer.slice(headerEnd + sepLen);
          if (currentPartName === "content") {
            if (foundContent) {
              await cleanup();
              throw new MultipartError("validation_failed", "Evidence upload requires exactly one content part.");
            }
            contentTmpPath = join(options.tmpDir ?? tmpdir(), `wc-evidence-${randomUUID()}.tmp`);
            contentWriter = createContentWriter(contentTmpPath);
            foundContent = true;
            state = "content";
          } else if (currentPartName === "metadata") {
            if (foundMetadata) {
              await cleanup();
              throw new MultipartError("validation_failed", "Evidence upload requires exactly one metadata part.");
            }
            foundMetadata = true;
            state = "body";
          } else {
            await cleanup();
            throw new MultipartError("validation_failed", "Multipart parts must be named 'metadata' or 'content'.");
          }
          consumed = true;
        } else {
          // Header not complete yet; keep all accumulated bytes.
          break;
        }
      } else if (state === "body" || state === "content") {
        const idx = buffer.indexOf(delimiter);
        if (idx >= 0) {
          // Need at least 2 bytes after delimiter to decide closing vs next part.
          if (buffer.length < idx + delimiter.length + 2) {
            buffer = buffer.slice(idx);
            break;
          }
          let end = idx;
          if (end >= 2 && buffer[end - 2] === 0x0d && buffer[end - 1] === 0x0a) end -= 2;
          else if (end >= 1 && buffer[end - 1] === 0x0a) end -= 1;
          if (end > 0) {
            const data = buffer.slice(0, end);
            if (state === "body" && currentPartName === "metadata") {
              metadataBody = Buffer.concat([metadataBody, data]);
            } else if (state === "content") {
              await contentWriter!.write(data);
            }
          }
          buffer = buffer.slice(idx + delimiter.length);
          // Check for closing boundary.
          if (buffer[0] === 0x2d && buffer[1] === 0x2d) {
            buffer = buffer.slice(2);
            if (state === "content") await contentWriter!.end();
            state = "done";
            consumed = true;
            break;
          }
          // Skip CRLF or LF after boundary.
          if (buffer.length >= 2 && buffer[0] === 0x0d && buffer[1] === 0x0a) buffer = buffer.slice(2);
          else if (buffer[0] === 0x0a) buffer = buffer.slice(1);
          if (state === "content") await contentWriter!.end();
          state = "headers";
          consumed = true;
        } else {
          // No boundary yet. Save all but trailing delimiter-length bytes.
          const safeLen = Math.max(0, buffer.length - delimiter.length + 1);
          if (safeLen > 0) {
            const data = buffer.slice(0, safeLen);
            if (state === "body" && currentPartName === "metadata") {
              metadataBody = Buffer.concat([metadataBody, data]);
            } else if (state === "content") {
              await contentWriter!.write(data);
            }
            buffer = buffer.slice(safeLen);
          }
          break;
        }
      }
    }

    if (state === "done") break;
  }

  if (state !== "done") {
    await cleanup();
    throw new MultipartError("validation_failed", "Malformed multipart/form-data stream: missing final boundary.");
  }

  if (state !== "done" || !foundMetadata || !foundContent || !contentTmpPath || !contentWriter) {
    await cleanup();
    throw new MultipartError("validation_failed", "Evidence upload requires exactly one metadata part and one content part.");
  }

  return {
    metadataBytes: metadataBody,
    content: {
      tmpPath: contentTmpPath,
      sha256: contentWriter.digest(),
      byteSize: contentWriter.byteSize(),
      contentType: currentContentType,
      filename: currentFilename,
    },
  };

  async function cleanup() {
    if (contentWriter) {
      try { contentWriter.destroy(); } catch {}
    }
    if (contentTmpPath) {
      try { unlinkSync(contentTmpPath); } catch {}
    }
  }
}

function parsePart(part: Buffer): MultipartPart | null {
  let headerEnd = -1;
  for (let i = 0; i < part.length - 1; i++) {
    if (part[i] === 0x0d && part[i + 1] === 0x0a && i + 3 < part.length && part[i + 2] === 0x0d && part[i + 3] === 0x0a) {
      headerEnd = i;
      break;
    }
    if (part[i] === 0x0a && part[i + 1] === 0x0a) {
      headerEnd = i;
      break;
    }
  }
  if (headerEnd < 0) return null;
  const headerBuf = part.slice(0, headerEnd);
  const body = part.slice(headerEnd + (part[headerEnd] === 0x0d ? 4 : 2));
  const headers = parseHeaders(headerBuf);
  const disp = headers["content-disposition"];
  if (!disp) return null;
  const name = parseDispositionField(disp, "name");
  const filename = parseDispositionField(disp, "filename");
  if (!name) return null;
  return { name, filename, contentType: headers["content-type"] || "application/octet-stream", body };
}

function parseHeaders(headerBuf: Buffer): Record<string, string> {
  const headers: Record<string, string> = {};
  const text = headerBuf.toString("latin1");
  const lines = text.split(/\r?\n/);
  for (const line of lines) {
    const colon = line.indexOf(":");
    if (colon < 0) continue;
    const name = line.slice(0, colon).trim().toLowerCase();
    const value = line.slice(colon + 1).trim();
    headers[name] = value;
  }
  return headers;
}

function parseDispositionField(disp: string, field: string): string | null {
  const regex = new RegExp(`${field}="([^"]*)"`);
  const match = regex.exec(disp);
  if (match) return match[1] ?? null;
  const unquoted = new RegExp(`${field}=([^;\\s]+)`).exec(disp);
  if (unquoted) return unquoted[1] ?? null;
  return null;
}
