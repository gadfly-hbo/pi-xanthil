/**
 * Backend <-> Analysis Engine process-local ports (12 operations) - Contract §12 / API-035.
 *
 * These are process-local TypeScript discriminated unions. The Engine must NOT
 * directly write SQLite/blob or bypass via HTTP.
 *
 * Envelope (§12.2 / API-037):
 * - version = engine-port/1.0
 * - operationId, projectId, conditional run/generation ID
 * - caller/producer, requested/deadline/started/completed, canonical input hash, AbortSignal
 * - outcome: succeeded|failed|aborted|timed_out|conflict|policy_blocked
 * - structured output and safe error are mutually exclusive
 * - unknown operation/version/outcome fail closed
 * - operationId+inputHash idempotent; no second operation table
 * - no secret, path, raw pi event, hidden reasoning, or unauthorized Evidence content
 *
 * Phase 1 (T0003) defines the contract types and fail-closed validation only;
 * no Engine is wired. Engine availability is reported as unavailable.
 */

import {
  ENGINE_PORT_OPERATIONS,
  ENGINE_PORT_VERSION,
  ENGINE_OUTCOMES,
  ENGINE_ERROR_CODES,
  isEnginePortOperation,
  isEngineOutcome,
  isEngineErrorCode,
  type EnginePortOperation,
  type EngineOutcome,
  type EngineErrorCode,
} from "./registries.ts";

// ---------------------------------------------------------------------------
// Common envelope fields
// ---------------------------------------------------------------------------

export interface EnginePortRequestEnvelope {
  readonly version: typeof ENGINE_PORT_VERSION;
  readonly operation: EnginePortOperation;
  readonly operationId: string;
  readonly projectId: string;
  /** Conditional run/generation ID depending on operation. */
  readonly runId?: string | null;
  readonly generationId?: string | null;
  readonly caller: string;
  readonly producer?: string | null;
  readonly requestedAt: string;
  readonly deadlineAt?: string | null;
  /** Canonical input hash (SHA-256 of canonical input). */
  readonly inputHash: string;
  /** Runtime AbortSignal for cancellation (§12.2); process-local, not serialized. */
  readonly abortSignal?: AbortSignal | null;
}

export interface EnginePortResultEnvelope {
  readonly version: typeof ENGINE_PORT_VERSION;
  readonly operation: EnginePortOperation;
  readonly operationId: string;
  readonly projectId: string;
  readonly runId?: string | null;
  readonly generationId?: string | null;
  readonly startedAt: string;
  readonly completedAt: string;
  readonly outcome: EngineOutcome;
  /** Present iff outcome === succeeded. Mutually exclusive with error. */
  readonly output?: unknown;
  /** Present iff outcome !== succeeded. Mutually exclusive with output. */
  readonly error?: EnginePortError;
}

export interface EnginePortError {
  readonly code: EngineErrorCode;
  readonly summary: string;
}

export class EnginePortContractError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EnginePortContractError";
  }
}

// ---------------------------------------------------------------------------
// Operation taxonomy (12) - discriminated by `operation`
// ---------------------------------------------------------------------------

export type EnginePortRequest =
  | (EnginePortRequestEnvelope & {
      readonly operation: "generateStructuredRequirement";
      readonly input: GenerateRequirementInput;
    })
  | (EnginePortRequestEnvelope & {
      readonly operation: "generateAnalysisPlan";
      readonly input: GeneratePlanInput;
    })
  | (EnginePortRequestEnvelope & {
      readonly operation: "executeQueuedRun";
      readonly input: ExecuteRunInput;
    })
  | (EnginePortRequestEnvelope & {
      readonly operation: "requestRunAbort";
      readonly input: RequestAbortInput;
    })
  | (EnginePortRequestEnvelope & {
      readonly operation: "inspectRunningRunRecovery";
      readonly input: InspectRecoveryInput;
    })
  | (EnginePortRequestEnvelope & {
      readonly operation: "getRunExecutionContext";
      readonly input: GetRunContextInput;
    })
  | (EnginePortRequestEnvelope & {
      readonly operation: "openRunInputEvidence";
      readonly input: OpenEvidenceInput;
    })
  | (EnginePortRequestEnvelope & {
      readonly operation: "appendRunEvent";
      readonly input: AppendEventInput;
    })
  | (EnginePortRequestEnvelope & {
      readonly operation: "registerRunEvidence";
      readonly input: RegisterEvidenceInput;
    })
  | (EnginePortRequestEnvelope & {
      readonly operation: "submitInternalReviewEvidence";
      readonly input: SubmitReviewInput;
    })
  | (EnginePortRequestEnvelope & {
      readonly operation: "completeRunWithReport";
      readonly input: CompleteReportInput;
    })
  | (EnginePortRequestEnvelope & {
      readonly operation: "terminateRun";
      readonly input: TerminateRunInput;
    });

// Input shapes are deliberately minimal in phase 1: they carry the contract
// identity/hash fields. Full normative payload schemas arrive with the
// Requirement/Plan/Run implementation tasks (non-goals for T0003).

export interface GenerateRequirementInput {
  readonly targetSchemaVersion: string;
}
export interface GeneratePlanInput {
  readonly requirementVersionId: string;
  readonly targetSchemaVersion: string;
}
export interface ExecuteRunInput {
  readonly runId: string;
  readonly planVersionId: string;
  readonly expectedPreviousSequence: number;
}
export interface RequestAbortInput {
  readonly runId: string;
  readonly expectedStatus: string;
  readonly expectedLastSequence: number;
}
export interface InspectRecoveryInput {
  readonly runId: string;
}
export interface GetRunContextInput {
  readonly runId: string;
}
export interface OpenEvidenceInput {
  readonly runId: string;
  readonly evidenceArtifactId: string;
  readonly planStepId: string;
  readonly expectedContentSha256: string;
}
export interface AppendEventInput {
  readonly runId: string;
  readonly producerEventId: string | null;
  readonly expectedPreviousSequence: number;
  readonly eventType: string;
  readonly payloadSchemaVersion: string;
  readonly payload: unknown;
}
export interface RegisterEvidenceInput {
  readonly runId: string;
  readonly planStepId: string;
}
export interface SubmitReviewInput {
  readonly runId: string;
  readonly planStepId: string;
  readonly reviewOrdinal: number;
}
export interface CompleteReportInput {
  readonly runId: string;
  readonly reportSchemaVersion: string;
}
export interface TerminateRunInput {
  readonly runId: string;
  readonly terminalOutcome: "failed" | "aborted" | "blocked";
}

// ---------------------------------------------------------------------------
// Strict fail-closed validation (envelope + 12 input shapes)
// ---------------------------------------------------------------------------

const REQUEST_ENVELOPE_KEYS = new Set([
  "version", "operation", "operationId", "projectId", "runId", "generationId",
  "caller", "producer", "requestedAt", "deadlineAt", "inputHash", "abortSignal", "input",
]);
const RESULT_ENVELOPE_KEYS = new Set([
  "version", "operation", "operationId", "projectId", "runId", "generationId",
  "startedAt", "completedAt", "outcome", "output", "error",
]);
const RUN_OPERATIONS = new Set<EnginePortOperation>([
  "executeQueuedRun", "requestRunAbort", "inspectRunningRunRecovery",
  "getRunExecutionContext", "openRunInputEvidence", "appendRunEvent",
  "registerRunEvidence", "submitInternalReviewEvidence", "completeRunWithReport", "terminateRun",
]);
const GENERATION_OPERATIONS = new Set<EnginePortOperation>([
  "generateStructuredRequirement", "generateAnalysisPlan",
]);

// Identity / time format checks (contract: UUID v4, UTC RFC 3339).
const UUID_V4_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const RFC3339_UTC_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(\.\d+)?Z$/;
function isUuidV4(v: unknown): v is string {
  return typeof v === "string" && UUID_V4_RE.test(v);
}
/**
 * Real UTC RFC 3339 calendar validation. The format regex alone accepts
 * out-of-range components like 2026-99-99T99:99:99Z or 2026-02-30T00:00:00Z
 * (the latter rolls over silently in Date). Reject by also requiring the parsed
 * UTC calendar components to round-trip exactly.
 */
function isRfc3339Utc(v: unknown): v is string {
  if (typeof v !== "string") return false;
  const m = v.match(RFC3339_UTC_RE);
  if (!m) return false;
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return false;
  return (
    d.getUTCFullYear() === Number(m[1]) &&
    d.getUTCMonth() + 1 === Number(m[2]) &&
    d.getUTCDate() === Number(m[3]) &&
    d.getUTCHours() === Number(m[4]) &&
    d.getUTCMinutes() === Number(m[5]) &&
    d.getUTCSeconds() === Number(m[6])
  );
}

type FieldType = "string-non-empty" | "uuid-v4" | "string-or-null" | "non-negative-integer" | "positive-integer" | "object" | "terminal-outcome";
interface FieldSpec { readonly type: FieldType; readonly required: boolean }
interface InputSpec { readonly fields: Record<string, FieldSpec> }

const INPUT_SPECS: Record<EnginePortOperation, InputSpec> = {
  generateStructuredRequirement: { fields: { targetSchemaVersion: { type: "string-non-empty", required: true } } },
  generateAnalysisPlan: { fields: { requirementVersionId: { type: "uuid-v4", required: true }, targetSchemaVersion: { type: "string-non-empty", required: true } } },
  executeQueuedRun: { fields: { runId: { type: "uuid-v4", required: true }, planVersionId: { type: "uuid-v4", required: true }, expectedPreviousSequence: { type: "non-negative-integer", required: true } } },
  requestRunAbort: { fields: { runId: { type: "uuid-v4", required: true }, expectedStatus: { type: "string-non-empty", required: true }, expectedLastSequence: { type: "non-negative-integer", required: true } } },
  inspectRunningRunRecovery: { fields: { runId: { type: "uuid-v4", required: true } } },
  getRunExecutionContext: { fields: { runId: { type: "uuid-v4", required: true } } },
  openRunInputEvidence: { fields: { runId: { type: "uuid-v4", required: true }, evidenceArtifactId: { type: "uuid-v4", required: true }, planStepId: { type: "string-non-empty", required: true }, expectedContentSha256: { type: "string-non-empty", required: true } } },
  appendRunEvent: { fields: { runId: { type: "uuid-v4", required: true }, producerEventId: { type: "string-or-null", required: true }, expectedPreviousSequence: { type: "non-negative-integer", required: true }, eventType: { type: "string-non-empty", required: true }, payloadSchemaVersion: { type: "string-non-empty", required: true }, payload: { type: "object", required: true } } },
  registerRunEvidence: { fields: { runId: { type: "uuid-v4", required: true }, planStepId: { type: "string-non-empty", required: true } } },
  submitInternalReviewEvidence: { fields: { runId: { type: "uuid-v4", required: true }, planStepId: { type: "string-non-empty", required: true }, reviewOrdinal: { type: "positive-integer", required: true } } },
  completeRunWithReport: { fields: { runId: { type: "uuid-v4", required: true }, reportSchemaVersion: { type: "string-non-empty", required: true } } },
  terminateRun: { fields: { runId: { type: "uuid-v4", required: true }, terminalOutcome: { type: "terminal-outcome", required: true } } },
};

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}
function isNonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.length > 0;
}
function isNonNegativeInteger(v: unknown): v is number {
  return typeof v === "number" && Number.isInteger(v) && v >= 0;
}
function isPositiveInteger(v: unknown): v is number {
  return typeof v === "number" && Number.isInteger(v) && v > 0;
}
function isAbortSignal(v: unknown): v is AbortSignal {
  return typeof v === "object" && v !== null && v instanceof AbortSignal;
}
function checkField(value: unknown, spec: FieldSpec, path: string): void {
  switch (spec.type) {
    case "string-non-empty": if (!isNonEmptyString(value)) throw new EnginePortContractError(`${path} must be a non-empty string`); break;
    case "uuid-v4": if (!isUuidV4(value)) throw new EnginePortContractError(`${path} must be a UUID v4`); break;
    case "string-or-null": if (value !== null && !isNonEmptyString(value)) throw new EnginePortContractError(`${path} must be a non-empty string or null`); break;
    case "non-negative-integer": if (!isNonNegativeInteger(value)) throw new EnginePortContractError(`${path} must be a non-negative integer`); break;
    case "positive-integer": if (!isPositiveInteger(value)) throw new EnginePortContractError(`${path} must be a positive integer (> 0)`); break;
    case "object": if (!isPlainObject(value)) throw new EnginePortContractError(`${path} must be an object`); break;
    case "terminal-outcome": if (value !== "failed" && value !== "aborted" && value !== "blocked") throw new EnginePortContractError(`${path} must be failed|aborted|blocked`); break;
  }
}

/**
 * Strictly validate an Engine port request envelope + operation input.
 * Fail-closed on unknown version/operation, unknown envelope or input fields,
 * missing required fields, or type violations.
 */
export function validateEnginePortRequest(req: unknown): void {
  if (!isPlainObject(req)) throw new EnginePortContractError("request must be an object");
  for (const key of Object.keys(req)) {
    if (!REQUEST_ENVELOPE_KEYS.has(key)) throw new EnginePortContractError(`unknown request envelope field '${key}'`);
  }
  const o = req as Record<string, unknown>;
  if (o.version !== ENGINE_PORT_VERSION) throw new EnginePortContractError(`Unsupported engine-port version: expected ${ENGINE_PORT_VERSION}, got ${JSON.stringify(o.version)}`);
  const operation = o.operation;
  if (!isEnginePortOperation(operation)) throw new EnginePortContractError(`Unknown engine port operation: ${JSON.stringify(operation)}`);
  if (!isUuidV4(o.operationId)) throw new EnginePortContractError("operationId must be a UUID v4");
  if (!isUuidV4(o.projectId)) throw new EnginePortContractError("projectId must be a UUID v4");
  if (!isNonEmptyString(o.caller)) throw new EnginePortContractError("caller must be a non-empty string");
  if (!isRfc3339Utc(o.requestedAt)) throw new EnginePortContractError("requestedAt must be a UTC RFC 3339 string");
  if (typeof o.inputHash !== "string" || !/^[0-9a-f]{64}$/.test(o.inputHash)) throw new EnginePortContractError("inputHash must be 64-char lowercase hex");
  if (o.producer !== undefined && o.producer !== null && !isNonEmptyString(o.producer)) throw new EnginePortContractError("producer must be a non-empty string or null");
  if (o.deadlineAt !== undefined && o.deadlineAt !== null && !isRfc3339Utc(o.deadlineAt)) throw new EnginePortContractError("deadlineAt must be a UTC RFC 3339 string or null");
  // §12.2 runtime AbortSignal (optional; process-local, not serialized)
  if (o.abortSignal !== undefined && o.abortSignal !== null && !isAbortSignal(o.abortSignal)) throw new EnginePortContractError("abortSignal must be an AbortSignal or null");
  // §12.2 conditional run/generation ID: applicability is mutually exclusive.
  // Run operations require a UUID v4 runId and must NOT carry a generationId;
  // generation operations require a UUID v4 generationId and must NOT carry a runId.
  const isRunOp = RUN_OPERATIONS.has(operation);
  const isGenOp = GENERATION_OPERATIONS.has(operation);
  if (isRunOp) {
    if (!isUuidV4(o.runId)) throw new EnginePortContractError(`operation ${operation} requires a UUID v4 runId`);
    if (o.generationId !== undefined && o.generationId !== null) throw new EnginePortContractError(`operation ${operation} must not carry a generationId`);
  }
  if (isGenOp) {
    if (!isUuidV4(o.generationId)) throw new EnginePortContractError(`operation ${operation} requires a UUID v4 generationId`);
    if (o.runId !== undefined && o.runId !== null) throw new EnginePortContractError(`operation ${operation} must not carry a runId`);
  }
  validateEnginePortInput(operation, o.input);
}

/** Strictly validate an operation input shape. Unknown fields fail closed. */
export function validateEnginePortInput(operation: EnginePortOperation, input: unknown): void {
  const spec = INPUT_SPECS[operation];
  if (!isPlainObject(input)) throw new EnginePortContractError(`input for ${operation} must be an object`);
  for (const key of Object.keys(input)) {
    if (!(key in spec.fields)) throw new EnginePortContractError(`unknown input field '${key}' for operation ${operation}`);
  }
  for (const [field, fieldSpec] of Object.entries(spec.fields)) {
    if (!(field in input)) {
      if (fieldSpec.required) throw new EnginePortContractError(`missing required input field '${field}' for operation ${operation}`);
      continue;
    }
    checkField((input as Record<string, unknown>)[field], fieldSpec, `input.${field}`);
  }
}

/**
 * Strictly validate an Engine port result envelope. Fail-closed on unknown
 * operation/version/outcome, unknown fields, or output/error violations.
 */
export function validateEnginePortResult(res: unknown): void {
  if (!isPlainObject(res)) throw new EnginePortContractError("result must be an object");
  for (const key of Object.keys(res)) {
    if (!RESULT_ENVELOPE_KEYS.has(key)) throw new EnginePortContractError(`unknown result envelope field '${key}'`);
  }
  const o = res as Record<string, unknown>;
  if (o.version !== ENGINE_PORT_VERSION) throw new EnginePortContractError(`Unsupported engine-port version: expected ${ENGINE_PORT_VERSION}, got ${JSON.stringify(o.version)}`);
  if (!isEnginePortOperation(o.operation)) throw new EnginePortContractError(`Unknown engine port operation: ${JSON.stringify(o.operation)}`);
  if (!isUuidV4(o.operationId)) throw new EnginePortContractError("operationId must be a UUID v4");
  if (!isUuidV4(o.projectId)) throw new EnginePortContractError("projectId must be a UUID v4");
  if (!isRfc3339Utc(o.startedAt)) throw new EnginePortContractError("startedAt must be a UTC RFC 3339 string");
  if (!isRfc3339Utc(o.completedAt)) throw new EnginePortContractError("completedAt must be a UTC RFC 3339 string");
  if (RUN_OPERATIONS.has(o.operation)) {
    if (!isUuidV4(o.runId)) throw new EnginePortContractError(`operation ${o.operation} requires a UUID v4 runId`);
    if (o.generationId !== undefined && o.generationId !== null) throw new EnginePortContractError(`operation ${o.operation} must not carry a generationId`);
  }
  if (GENERATION_OPERATIONS.has(o.operation)) {
    if (!isUuidV4(o.generationId)) throw new EnginePortContractError(`operation ${o.operation} requires a UUID v4 generationId`);
    if (o.runId !== undefined && o.runId !== null) throw new EnginePortContractError(`operation ${o.operation} must not carry a runId`);
  }
  if (!isEngineOutcome(o.outcome)) throw new EnginePortContractError(`Unknown engine port outcome: ${JSON.stringify(o.outcome)}`);
  const hasOutput = o.output !== undefined;
  const hasError = o.error !== undefined;
  if (hasOutput && hasError) throw new EnginePortContractError("Engine port result output and error are mutually exclusive");
  if (o.outcome === "succeeded" && !hasOutput) throw new EnginePortContractError("succeeded outcome requires structured output");
  if (o.outcome !== "succeeded" && !hasError) throw new EnginePortContractError("non-succeeded outcome requires a safe error");
  if (hasError) {
    if (!isPlainObject(o.error)) throw new EnginePortContractError("error must be an object");
    for (const k of Object.keys(o.error as Record<string, unknown>)) {
      if (k !== "code" && k !== "summary") throw new EnginePortContractError(`unknown error field '${k}'`);
    }
    const e = o.error as { code: unknown; summary: unknown };
    if (!isEngineErrorCode(e.code)) throw new EnginePortContractError(`Unknown engine error code: ${JSON.stringify(e.code)}`);
    if (typeof e.summary !== "string") throw new EnginePortContractError("engine error summary must be a string");
  }
}

/** Re-export for registry count assertions. */
export {
  ENGINE_PORT_OPERATIONS,
  ENGINE_OUTCOMES,
  ENGINE_ERROR_CODES,
  type EnginePortOperation,
  type EngineOutcome,
  type EngineErrorCode,
};
