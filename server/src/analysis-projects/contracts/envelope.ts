/**
 * HTTP envelope and fixed ApiError registry.
 *
 * Contract (application-api-readmodels-v1.md §2.2-§2.3, API-011):
 * - Success envelope: schemaVersion, requestId, data.
 * - Error envelope: schemaVersion, requestId, error{code,summary,fieldErrors,retryDirective,diagnosticEvidenceArtifactId}.
 * - Fixed 38 ApiErrorCode registry mapping code -> HTTP status + retryDirective.
 * - Same error code must not change status code or retryDirective across endpoints.
 * - Errors must not contain stack, SQL, path, secret, prompt, pi raw content, or hidden reasoning.
 */

import { API_SCHEMA_VERSION } from "./registries.ts";

// ---------------------------------------------------------------------------
// Retry directive
// ---------------------------------------------------------------------------

export const RETRY_DIRECTIVES = [
  "do_not_retry",
  "retry_same_request",
  "retry_with_new_idempotency_key",
  "refresh_then_retry",
  "human_action_required",
] as const;

export type RetryDirective = (typeof RETRY_DIRECTIVES)[number];

// ---------------------------------------------------------------------------
// Field error (RFC 6901 JSON Pointer)
// ---------------------------------------------------------------------------

export interface FieldError {
  /** RFC 6901 JSON Pointer, e.g. "/title" or "/evidence/0/displayName". */
  readonly fieldPath: string;
  /** Stable snake_case field-level code. */
  readonly code: string;
  /** Safe summary (no stack/SQL/secret). */
  readonly summary: string;
}

// ---------------------------------------------------------------------------
// ApiError registry (38 codes) - §2.3
// ---------------------------------------------------------------------------

export interface ApiErrorSpec {
  readonly code: string;
  readonly httpStatus: number;
  readonly retryDirective: RetryDirective;
}

/**
 * Fixed ApiErrorCode registry. Order follows the contract table.
 * Each code maps to exactly one HTTP status and one retryDirective.
 */
export const API_ERROR_REGISTRY: readonly ApiErrorSpec[] = [
  { code: "invalid_json", httpStatus: 400, retryDirective: "do_not_retry" },
  { code: "validation_failed", httpStatus: 400, retryDirective: "do_not_retry" },
  { code: "unsupported_schema_version", httpStatus: 400, retryDirective: "do_not_retry" },
  { code: "invalid_cursor", httpStatus: 400, retryDirective: "do_not_retry" },
  { code: "authentication_required", httpStatus: 401, retryDirective: "human_action_required" },
  { code: "invalid_session", httpStatus: 401, retryDirective: "human_action_required" },
  { code: "invalid_local_api_token", httpStatus: 401, retryDirective: "human_action_required" },
  { code: "origin_forbidden", httpStatus: 403, retryDirective: "do_not_retry" },
  { code: "actor_disabled", httpStatus: 403, retryDirective: "human_action_required" },
  { code: "actor_kind_forbidden", httpStatus: 403, retryDirective: "do_not_retry" },
  { code: "evidence_access_denied", httpStatus: 403, retryDirective: "human_action_required" },
  { code: "resource_not_found", httpStatus: 404, retryDirective: "do_not_retry" },
  { code: "export_file_omitted", httpStatus: 404, retryDirective: "do_not_retry" },
  { code: "idempotency_key_reused", httpStatus: 409, retryDirective: "retry_with_new_idempotency_key" },
  { code: "concurrent_modification", httpStatus: 409, retryDirective: "refresh_then_retry" },
  { code: "invalid_state_transition", httpStatus: 409, retryDirective: "refresh_then_retry" },
  { code: "gate_already_decided", httpStatus: 409, retryDirective: "refresh_then_retry" },
  { code: "active_run_exists", httpStatus: 409, retryDirective: "refresh_then_retry" },
  { code: "plan_not_valid", httpStatus: 409, retryDirective: "human_action_required" },
  { code: "source_version_conflict", httpStatus: 409, retryDirective: "human_action_required" },
  { code: "content_hash_mismatch", httpStatus: 409, retryDirective: "refresh_then_retry" },
  { code: "payload_too_large", httpStatus: 413, retryDirective: "do_not_retry" },
  { code: "unsupported_media_type", httpStatus: 415, retryDirective: "do_not_retry" },
  { code: "capability_not_supported", httpStatus: 422, retryDirective: "human_action_required" },
  { code: "capability_contract_mismatch", httpStatus: 422, retryDirective: "human_action_required" },
  { code: "source_unavailable", httpStatus: 422, retryDirective: "human_action_required" },
  { code: "unsafe_evidence", httpStatus: 422, retryDirective: "human_action_required" },
  { code: "evidence_integrity_failed", httpStatus: 422, retryDirective: "human_action_required" },
  { code: "citation_invalid", httpStatus: 422, retryDirective: "human_action_required" },
  { code: "internal_review_not_passed", httpStatus: 422, retryDirective: "human_action_required" },
  { code: "generation_output_invalid", httpStatus: 422, retryDirective: "retry_with_new_idempotency_key" },
  { code: "too_many_requests", httpStatus: 429, retryDirective: "retry_same_request" },
  { code: "internal_error", httpStatus: 500, retryDirective: "human_action_required" },
  { code: "command_interrupted", httpStatus: 503, retryDirective: "retry_with_new_idempotency_key" },
  { code: "engine_unavailable", httpStatus: 503, retryDirective: "retry_with_new_idempotency_key" },
  { code: "storage_unavailable", httpStatus: 503, retryDirective: "retry_with_new_idempotency_key" },
  { code: "read_model_unavailable", httpStatus: 503, retryDirective: "retry_same_request" },
  { code: "command_timed_out", httpStatus: 504, retryDirective: "retry_with_new_idempotency_key" },
];

const API_ERROR_MAP: ReadonlyMap<string, ApiErrorSpec> = new Map(
  API_ERROR_REGISTRY.map((spec) => [spec.code, spec]),
);

/** All ApiError codes (38). */
export const API_ERROR_CODES: readonly string[] = API_ERROR_REGISTRY.map(
  (s) => s.code,
);

/** Fail-closed lookup. Throws on unknown error code. */
export function getApiErrorSpec(code: string): ApiErrorSpec {
  const spec = API_ERROR_MAP.get(code);
  if (!spec) {
    throw new Error(
      `Unknown ApiErrorCode: ${code}. Registry has ${API_ERROR_REGISTRY.length} fixed codes; unknown codes fail closed.`,
    );
  }
  return spec;
}

export function isApiErrorCode(code: unknown): boolean {
  return typeof code === "string" && API_ERROR_MAP.has(code);
}

// ---------------------------------------------------------------------------
// Envelopes
// ---------------------------------------------------------------------------

export interface SuccessEnvelope<T = unknown> {
  readonly schemaVersion: typeof API_SCHEMA_VERSION;
  readonly requestId: string;
  readonly data: T;
}

export interface ApiErrorEnvelope {
  readonly code: string;
  readonly summary: string;
  readonly fieldErrors: readonly FieldError[];
  readonly retryDirective: RetryDirective;
  readonly diagnosticEvidenceArtifactId: string | null;
}

export interface ErrorEnvelope {
  readonly schemaVersion: typeof API_SCHEMA_VERSION;
  readonly requestId: string;
  readonly error: ApiErrorEnvelope;
}

/**
 * Build a success envelope. requestId is Backend-generated.
 */
export function successEnvelope<T>(
  requestId: string,
  data: T,
): SuccessEnvelope<T> {
  return {
    schemaVersion: API_SCHEMA_VERSION,
    requestId,
    data,
  };
}

/**
 * Build an error envelope from a registered ApiError code.
 * `diagnosticEvidenceArtifactId` is null unless the actor is authorized to read
 * the controlled diagnostic Evidence (caller decides).
 */
export function errorEnvelope(
  requestId: string,
  code: string,
  summary: string,
  options: {
    fieldErrors?: readonly FieldError[];
    diagnosticEvidenceArtifactId?: string | null;
  } = {},
): ErrorEnvelope {
  const spec = getApiErrorSpec(code);
  return {
    schemaVersion: API_SCHEMA_VERSION,
    requestId,
    error: {
      code: spec.code,
      summary,
      fieldErrors: options.fieldErrors ?? [],
      retryDirective: spec.retryDirective,
      diagnosticEvidenceArtifactId: options.diagnosticEvidenceArtifactId ?? null,
    },
  };
}

/**
 * A typed application error carrying a registered ApiError code.
 * Service layers throw this; the (future) transport layer maps it to an envelope.
 */
export class ApplicationError extends Error {
  readonly code: string;
  readonly httpStatus: number;
  readonly retryDirective: RetryDirective;
  readonly fieldErrors: readonly FieldError[];
  readonly diagnosticEvidenceArtifactId: string | null;

  constructor(
    code: string,
    summary: string,
    options: {
      fieldErrors?: readonly FieldError[];
      diagnosticEvidenceArtifactId?: string | null;
      cause?: unknown;
    } = {},
  ) {
    const spec = getApiErrorSpec(code);
    super(summary, { cause: options.cause });
    this.name = "ApplicationError";
    this.code = spec.code;
    this.httpStatus = spec.httpStatus;
    this.retryDirective = spec.retryDirective;
    this.fieldErrors = options.fieldErrors ?? [];
    this.diagnosticEvidenceArtifactId = options.diagnosticEvidenceArtifactId ?? null;
  }
}
