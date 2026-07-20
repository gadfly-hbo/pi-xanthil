/**
 * AgentHarness read-only adapter port contract (WCA-07).
 *
 * Contract (workcanger-absorption-contract.md WCA-07):
 * - AgentHarness is consumed ONLY through a read-only, strongly typed adapter.
 * - The port exposes exactly three operations:
 *   describeCapability / checkSource / readSource.
 * - No write/update/delete/mutate/sync/push semantics, no direct AgentHarness
 *   DB access, no copy of the "four bases + one console" data structures, and
 *   no write-back to AgentHarness.
 * - Unknown capability, unknown contract version, schema mismatch, missing
 *   source, disallowed safety class, unavailable adapter, and adapter errors
 *   all fail closed onto the fixed ApiError registry codes:
 *   capability_not_supported / capability_contract_mismatch /
 *   source_unavailable / unsafe_evidence.
 * - restricted_raw content may only enter Analysis Projects as an opaque local
 *   blob/reference; the read path must never route raw content to
 *   Engine/LLM/prompt/log/handoff.
 *
 * Identity inputs (capabilityId, contractVersion, sourceObjectKey) are
 * validated in their original form before any use. No hash/namespace
 * conversion may turn an invalid key into a valid identity.
 */

// ---------------------------------------------------------------------------
// Port version
// ---------------------------------------------------------------------------

export const AGENTHARNESS_PORT_VERSION = "agentharness-port/1.0" as const;

// ---------------------------------------------------------------------------
// Safety classes (mirrors evidence safety taxonomy; redeclared to keep the
// contracts layer free of application imports)
// ---------------------------------------------------------------------------

export const AGENTHARNESS_SAFETY_CLASSES = [
  "restricted_raw",
  "controlled",
  "derived",
] as const;

export type AgentHarnessSafetyClass = (typeof AGENTHARNESS_SAFETY_CLASSES)[number];

const SAFETY_CLASS_SET: ReadonlySet<string> = new Set(AGENTHARNESS_SAFETY_CLASSES);

export function isAgentHarnessSafetyClass(value: unknown): value is AgentHarnessSafetyClass {
  return typeof value === "string" && SAFETY_CLASS_SET.has(value);
}

// ---------------------------------------------------------------------------
// Source check status (mirrors source_checks.availability_status registry in
// persistence/migrations/0001_initial_workcanger.sql)
// ---------------------------------------------------------------------------

export const AGENTHARNESS_CHECK_STATUSES = [
  "available",
  "temporarily_unavailable",
  "access_denied",
  "contract_mismatch",
  "source_not_found",
  "unsafe",
  "check_failed",
] as const;

export type AgentHarnessCheckStatus = (typeof AGENTHARNESS_CHECK_STATUSES)[number];

const CHECK_STATUS_SET: ReadonlySet<string> = new Set(AGENTHARNESS_CHECK_STATUSES);

export function isAgentHarnessCheckStatus(value: unknown): value is AgentHarnessCheckStatus {
  return typeof value === "string" && CHECK_STATUS_SET.has(value);
}

// ---------------------------------------------------------------------------
// Identity input validation (fail closed, original form only)
// ---------------------------------------------------------------------------

/** Capability IDs: lowercase slug, bounded length. */
export const CAPABILITY_ID_PATTERN = /^[a-z0-9][a-z0-9._-]{0,127}$/;

/** Contract versions: MAJOR.MINOR, e.g. "1.0". */
export const CONTRACT_VERSION_PATTERN = /^[0-9]+\.[0-9]+$/;

/** Source object keys: non-empty, bounded, no whitespace or control chars. */
export const SOURCE_OBJECT_KEY_MAX_LENGTH = 512;

export function isValidCapabilityId(value: unknown): value is string {
  return typeof value === "string" && CAPABILITY_ID_PATTERN.test(value);
}

export function isValidContractVersion(value: unknown): value is string {
  return typeof value === "string" && CONTRACT_VERSION_PATTERN.test(value);
}

export function isValidSourceObjectKey(value: unknown): value is string {
  if (typeof value !== "string") return false;
  if (value.length === 0 || value.length > SOURCE_OBJECT_KEY_MAX_LENGTH) return false;
  // No whitespace and no C0/C1 control characters.
  return !/[\s\x00-\x1f\x7f-\x9f]/.test(value);
}

// ---------------------------------------------------------------------------
// Port error codes (subset of the fixed ApiError registry)
// ---------------------------------------------------------------------------

export const AGENTHARNESS_PORT_ERROR_CODES = [
  "capability_not_supported",
  "capability_contract_mismatch",
  "source_unavailable",
  "unsafe_evidence",
] as const;

export type AgentHarnessPortErrorCode = (typeof AGENTHARNESS_PORT_ERROR_CODES)[number];

// ---------------------------------------------------------------------------
// Result types (discriminated unions; the port never throws)
// ---------------------------------------------------------------------------

export interface AgentHarnessPortFailure {
  readonly kind: "failure";
  readonly code: AgentHarnessPortErrorCode;
  /** Stable safe summary. Never contains stack, SQL, absolute path, token, prompt, or raw content. */
  readonly summary: string;
}

/**
 * Public capability descriptor. Safe to expose via the capabilities endpoint:
 * no adapter path, no connection detail, no internal DB reference.
 */
export interface AgentHarnessCapabilityDescriptor {
  readonly capabilityId: string;
  readonly contractVersion: string;
  readonly displayName: string;
  /** Safety classes this capability is permitted to yield on read. */
  readonly allowedSafetyClasses: readonly AgentHarnessSafetyClass[];
  /** Always true. The port has no write path by construction. */
  readonly readOnly: true;
}

export type AgentHarnessDescribeResult =
  | { readonly kind: "success"; readonly descriptor: AgentHarnessCapabilityDescriptor }
  | AgentHarnessPortFailure;

export interface AgentHarnessSourceCheck {
  readonly status: AgentHarnessCheckStatus;
  readonly observedContractVersion: string | null;
  readonly observedSourceVersion: string | null;
  /** Stable machine-readable diagnostic code, or null. */
  readonly diagnosticCode: string | null;
  /** Safe diagnostic summary, or null. Must not leak internals. */
  readonly diagnosticSummary: string | null;
}

export type AgentHarnessCheckResult =
  | { readonly kind: "success"; readonly check: AgentHarnessSourceCheck }
  | AgentHarnessPortFailure;

export interface AgentHarnessSourceRead {
  readonly safetyClass: AgentHarnessSafetyClass;
  readonly mediaType: string;
  readonly observedSourceVersion: string | null;
  readonly declaredByteSize: number | null;
  /**
   * Opaque content stream. Bytes must be persisted unchanged to local
   * content-addressed blob storage. The read path must never parse rows,
   * columns, or samples, and must never send content to Engine/LLM/prompt/log.
   */
  readonly openContent: () => AsyncIterable<Uint8Array>;
}

export type AgentHarnessReadResult =
  | { readonly kind: "success"; readonly read: AgentHarnessSourceRead }
  | AgentHarnessPortFailure;

// ---------------------------------------------------------------------------
// The read-only port (exactly three operations)
// ---------------------------------------------------------------------------

export interface AgentHarnessAdapterPort {
  describeCapability(
    capabilityId: string,
    contractVersion: string,
  ): Promise<AgentHarnessDescribeResult>;
  checkSource(
    capabilityId: string,
    contractVersion: string,
    sourceObjectKey: string,
  ): Promise<AgentHarnessCheckResult>;
  readSource(
    capabilityId: string,
    contractVersion: string,
    sourceObjectKey: string,
  ): Promise<AgentHarnessReadResult>;
}

// ---------------------------------------------------------------------------
// Capability registry contract
// ---------------------------------------------------------------------------

/**
 * Low-level source adapter bound to one (capabilityId, contractVersion) pair.
 * Implemented by future real AgentHarness integrations; tests use synthetic
 * fixtures. Adapters report failures by returning values; the port shell maps
 * thrown errors onto safe failure codes.
 */
export interface AgentHarnessSourceAdapter {
  describe(): AgentHarnessCapabilityDescriptor | Promise<AgentHarnessCapabilityDescriptor>;
  check(sourceObjectKey: string): AgentHarnessSourceCheck | Promise<AgentHarnessSourceCheck>;
  read(sourceObjectKey: string): AgentHarnessSourceRead | Promise<AgentHarnessSourceRead>;
}

/**
 * Registry of available AgentHarness capabilities. The default registry is
 * genuinely empty: no fabricated DataBase/OntoBase/MemoryBase/KnowledgeBase/
 * Console capabilities.
 */
export interface AgentHarnessCapabilityRegistry {
  /** Public descriptors of all registered capabilities; [] when none. */
  listCapabilities(): readonly AgentHarnessCapabilityDescriptor[];
  /** Resolve the adapter for one identity pair; null when not registered. */
  resolve(capabilityId: string, contractVersion: string): AgentHarnessSourceAdapter | null;
}
