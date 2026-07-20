/**
 * Shared application runtime helpers.
 *
 * - Trusted actor context (API-004): actor identity and channel come from the
 *   server-side trusted request context, never from the business payload.
 * - UUID v4 generation (P0-74).
 * - UTC RFC 3339 timestamps (P0 schema baseline).
 * - Idempotency request hash (§4 / API-049): canonical hash over method,
 *   normalized path, and canonical JSON body.
 */

import { randomUUID } from "node:crypto";
import { createHash } from "node:crypto";
import { canonicalJsonStringify } from "../../persistence/canonical-json.ts";
import type { ActorKind, SubmittedVia } from "../../contracts/registries.ts";

// ---------------------------------------------------------------------------
// Identity & time
// ---------------------------------------------------------------------------

/** Generate a lowercase UUID v4 string (P0-74). */
export function uuid(): string {
  return randomUUID();
}

/** Current time as UTC RFC 3339 (ISO 8601 with milliseconds). */
export function now(): string {
  return new Date().toISOString();
}

/** Strict UUID v4 format check (lowercase). */
const UUID_V4_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export function isUuidV4(value: unknown): value is string {
  return typeof value === "string" && UUID_V4_RE.test(value);
}

/** Strict 64-char lowercase hex SHA-256 check. */
export function isSha256Hex(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{64}$/.test(value);
}

// ---------------------------------------------------------------------------
// Trusted actor context (API-004)
// ---------------------------------------------------------------------------

/**
 * Trusted actor context. The transport layer (future task) derives this from
 * the authenticated request; application services accept it as-is and never
 * read actorId/submittedVia from the business payload.
 */
export interface TrustedActorContext {
  readonly actorId: string;
  readonly actorKind: ActorKind;
  readonly submittedVia: SubmittedVia;
  readonly clientVersion: string | null;
  /** Whether the actor is currently active (not disabled). */
  readonly active: boolean;
}

// ---------------------------------------------------------------------------
// Idempotency request hash (§4 / API-049)
// ---------------------------------------------------------------------------

/**
 * Compute the idempotency request SHA-256 hash.
 *
 * Covers: method, normalized path, and canonical JSON body. Multipart uses a
 * separate path (canonical metadata + binary hash) handled by the upload
 * command; this helper is for JSON commands.
 */
export function computeRequestHash(
  method: string,
  normalizedPath: string,
  body: unknown,
): string {
  const canonicalBody = canonicalJsonStringify(body);
  const material = `${method.toUpperCase()}\n${normalizedPath}\n${canonicalBody}`;
  return createHash("sha256").update(material, "utf8").digest("hex");
}

/**
 * Compute idempotency request hash for multipart uploads.
 *
 * Covers canonical metadata + actual binary SHA-256 (API-049).
 */
export function computeMultipartRequestHash(metadata: Record<string, unknown>, binarySha256: string): string {
  const canonicalBody = canonicalJsonStringify(metadata);
  const material = `${canonicalBody}\n${binarySha256}`;
  return createHash("sha256").update(material, "utf8").digest("hex");
}

/** Normalize a URL path to a single slash and no trailing slash except root. */
export function normalizePath(path: string): string {
  return path.replace(/\/+/g, "/") || "/";
}
