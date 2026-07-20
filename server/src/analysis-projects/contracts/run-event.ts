/**
 * RunEvent typed payload schemas (12) - Contract §13 / API-051.
 *
 * Each event type uses `workcanger.run-event.<event-type>/1.0`.
 * Outer fields (sequence, event type, stage/status after, time, producer,
 * raw diagnostic pointer) are owned by the run_events table, not the payload.
 *
 * Unknown event type, unknown schema version, or unknown payload field fail
 * closed. Payloads never carry stack, prompt, token, pi raw content, or paths.
 */

import {
  RUN_EVENT_TYPES,
  runEventSchemaVersion,
  type RunEventType,
} from "./registries.ts";

// ---------------------------------------------------------------------------
// Payload shapes
// ---------------------------------------------------------------------------

export interface RunQueuedPayload {
  readonly inputEvidenceCount: number;
  readonly queueCause: "initial" | "retry" | "report_revision";
}

export interface RunStartedPayload {
  // empty object
}

export interface RunSucceededPayload {
  readonly reportVersionId: string;
  readonly internalReviewEvidenceArtifactId: string;
}

export interface RunFailedPayload {
  readonly errorCode: string;
  readonly errorSummary: string;
  readonly failedPlanStepId?: string | null;
  readonly retryable: boolean;
}

export interface RunAbortedPayload {
  readonly reason?: string | null;
  readonly requestedByActorId?: string | null;
}

export interface RunBlockedPayload {
  readonly blockCode: string;
  readonly blockSummary: string;
  readonly blockedPlanStepId?: string | null;
  readonly requiredAction: string;
}

export interface StageEventPayload {
  readonly stage: "S2.1" | "S2.2" | "S2.3" | "S2.4";
}

export interface PlanStepStartedPayload {
  readonly planStepId: string;
  readonly stepOrdinal: number;
}

export interface PlanStepCompletedPayload {
  readonly planStepId: string;
  readonly stepOrdinal: number;
  readonly outcome: string;
  readonly outputEvidenceArtifactIds: readonly string[];
}

export interface EvidenceRegisteredPayload {
  readonly evidenceArtifactId: string;
  readonly planStepId: string;
  readonly artifactKind: string;
}

export interface WarningRecordedPayload {
  readonly warningCode: string;
  readonly summary: string;
  readonly planStepId?: string | null;
  readonly evidenceArtifactIds: readonly string[];
}

export type RunEventPayload =
  | { readonly eventType: "run_queued"; readonly payload: RunQueuedPayload }
  | { readonly eventType: "run_started"; readonly payload: RunStartedPayload }
  | { readonly eventType: "run_succeeded"; readonly payload: RunSucceededPayload }
  | { readonly eventType: "run_failed"; readonly payload: RunFailedPayload }
  | { readonly eventType: "run_aborted"; readonly payload: RunAbortedPayload }
  | { readonly eventType: "run_blocked"; readonly payload: RunBlockedPayload }
  | { readonly eventType: "stage_started"; readonly payload: StageEventPayload }
  | { readonly eventType: "stage_completed"; readonly payload: StageEventPayload }
  | { readonly eventType: "plan_step_started"; readonly payload: PlanStepStartedPayload }
  | { readonly eventType: "plan_step_completed"; readonly payload: PlanStepCompletedPayload }
  | { readonly eventType: "evidence_registered"; readonly payload: EvidenceRegisteredPayload }
  | { readonly eventType: "warning_recorded"; readonly payload: WarningRecordedPayload };

const ALLOWED_PAYLOAD_KEYS: Record<RunEventType, ReadonlySet<string>> = {
  run_queued: new Set(["inputEvidenceCount", "queueCause"]),
  run_started: new Set([]),
  run_succeeded: new Set(["reportVersionId", "internalReviewEvidenceArtifactId"]),
  run_failed: new Set(["errorCode", "errorSummary", "failedPlanStepId", "retryable"]),
  run_aborted: new Set(["reason", "requestedByActorId"]),
  run_blocked: new Set(["blockCode", "blockSummary", "blockedPlanStepId", "requiredAction"]),
  stage_started: new Set(["stage"]),
  stage_completed: new Set(["stage"]),
  plan_step_started: new Set(["planStepId", "stepOrdinal"]),
  plan_step_completed: new Set(["planStepId", "stepOrdinal", "outcome", "outputEvidenceArtifactIds"]),
  evidence_registered: new Set(["evidenceArtifactId", "planStepId", "artifactKind"]),
  warning_recorded: new Set(["warningCode", "summary", "planStepId", "evidenceArtifactIds"]),
};

const QUEUE_CAUSES = new Set(["initial", "retry", "report_revision"]);
const STAGES = new Set(["S2.1", "S2.2", "S2.3", "S2.4"]);

export class RunEventPayloadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RunEventPayloadError";
  }
}

/**
 * Validate a RunEvent payload against its typed schema.
 * Fail-closed on unknown event type, unknown schema version, unknown field,
 * or type/range violations.
 *
 * @param eventType - one of the 12 RunEvent types
 * @param schemaVersion - must equal `workcanger.run-event.<type>/1.0`
 * @param payload - the parsed payload object
 */
export function validateRunEventPayload(
  eventType: string,
  schemaVersion: string,
  payload: unknown,
): RunEventPayload {
  if (!RUN_EVENT_TYPES.includes(eventType as RunEventType)) {
    throw new RunEventPayloadError(
      `Unknown run event type: ${JSON.stringify(eventType)}`,
    );
  }
  const type = eventType as RunEventType;
  const expectedVersion = runEventSchemaVersion(type);
  if (schemaVersion !== expectedVersion) {
    throw new RunEventPayloadError(
      `Unsupported run-event schema version for ${type}: expected ${expectedVersion}, got ${schemaVersion}`,
    );
  }
  if (payload === null || typeof payload !== "object" || Array.isArray(payload)) {
    throw new RunEventPayloadError(
      `Run event payload for ${type} must be a JSON object`,
    );
  }
  const obj = payload as Record<string, unknown>;
  const allowed = ALLOWED_PAYLOAD_KEYS[type];
  for (const key of Object.keys(obj)) {
    if (!allowed.has(key)) {
      throw new RunEventPayloadError(
        `Unknown field '${key}' in run event payload for ${type}`,
      );
    }
  }
  return validateTypedPayload(type, obj) as RunEventPayload;
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

function isStringArray(v: unknown): v is readonly string[] {
  return Array.isArray(v) && v.every((x) => typeof x === "string");
}

function validateTypedPayload(
  type: RunEventType,
  o: Record<string, unknown>,
): RunEventPayload {
  switch (type) {
    case "run_queued": {
      if (!isNonNegativeInteger(o.inputEvidenceCount))
        throw fieldError("inputEvidenceCount", "non-negative integer");
      if (!isNonEmptyString(o.queueCause) || !QUEUE_CAUSES.has(o.queueCause))
        throw fieldError("queueCause", "one of initial|retry|report_revision");
      return { eventType: type, payload: { inputEvidenceCount: o.inputEvidenceCount, queueCause: o.queueCause as RunQueuedPayload["queueCause"] } };
    }
    case "run_started":
      return { eventType: type, payload: {} };
    case "run_succeeded": {
      if (!isNonEmptyString(o.reportVersionId)) throw fieldError("reportVersionId", "non-empty string");
      if (!isNonEmptyString(o.internalReviewEvidenceArtifactId)) throw fieldError("internalReviewEvidenceArtifactId", "non-empty string");
      return { eventType: type, payload: { reportVersionId: o.reportVersionId, internalReviewEvidenceArtifactId: o.internalReviewEvidenceArtifactId } };
    }
    case "run_failed": {
      if (!isNonEmptyString(o.errorCode)) throw fieldError("errorCode", "non-empty string");
      if (typeof o.errorSummary !== "string") throw fieldError("errorSummary", "string");
      if (o.failedPlanStepId !== undefined && o.failedPlanStepId !== null && !isNonEmptyString(o.failedPlanStepId)) throw fieldError("failedPlanStepId", "non-empty string or null");
      if (typeof o.retryable !== "boolean") throw fieldError("retryable", "boolean");
      return { eventType: type, payload: { errorCode: o.errorCode, errorSummary: o.errorSummary, failedPlanStepId: (o.failedPlanStepId as string | null | undefined) ?? null, retryable: o.retryable } };
    }
    case "run_aborted": {
      if (o.reason !== undefined && o.reason !== null && typeof o.reason !== "string") throw fieldError("reason", "string or null");
      if (o.requestedByActorId !== undefined && o.requestedByActorId !== null && !isNonEmptyString(o.requestedByActorId)) throw fieldError("requestedByActorId", "non-empty string or null");
      return { eventType: type, payload: { reason: (o.reason as string | null | undefined) ?? null, requestedByActorId: (o.requestedByActorId as string | null | undefined) ?? null } };
    }
    case "run_blocked": {
      if (!isNonEmptyString(o.blockCode)) throw fieldError("blockCode", "non-empty string");
      if (typeof o.blockSummary !== "string") throw fieldError("blockSummary", "string");
      if (o.blockedPlanStepId !== undefined && o.blockedPlanStepId !== null && !isNonEmptyString(o.blockedPlanStepId)) throw fieldError("blockedPlanStepId", "non-empty string or null");
      if (!isNonEmptyString(o.requiredAction)) throw fieldError("requiredAction", "non-empty string");
      return { eventType: type, payload: { blockCode: o.blockCode, blockSummary: o.blockSummary, blockedPlanStepId: (o.blockedPlanStepId as string | null | undefined) ?? null, requiredAction: o.requiredAction } };
    }
    case "stage_started":
    case "stage_completed": {
      if (!isNonEmptyString(o.stage) || !STAGES.has(o.stage)) throw fieldError("stage", "one of S2.1|S2.2|S2.3|S2.4");
      return { eventType: type, payload: { stage: o.stage as StageEventPayload["stage"] } };
    }
    case "plan_step_started": {
      if (!isNonEmptyString(o.planStepId)) throw fieldError("planStepId", "non-empty string");
      if (!isPositiveInteger(o.stepOrdinal)) throw fieldError("stepOrdinal", "positive integer");
      return { eventType: type, payload: { planStepId: o.planStepId, stepOrdinal: o.stepOrdinal } };
    }
    case "plan_step_completed": {
      if (!isNonEmptyString(o.planStepId)) throw fieldError("planStepId", "non-empty string");
      if (!isPositiveInteger(o.stepOrdinal)) throw fieldError("stepOrdinal", "positive integer");
      if (typeof o.outcome !== "string") throw fieldError("outcome", "string");
      if (!isStringArray(o.outputEvidenceArtifactIds)) throw fieldError("outputEvidenceArtifactIds", "string array");
      return { eventType: type, payload: { planStepId: o.planStepId, stepOrdinal: o.stepOrdinal, outcome: o.outcome, outputEvidenceArtifactIds: o.outputEvidenceArtifactIds } };
    }
    case "evidence_registered": {
      if (!isNonEmptyString(o.evidenceArtifactId)) throw fieldError("evidenceArtifactId", "non-empty string");
      if (!isNonEmptyString(o.planStepId)) throw fieldError("planStepId", "non-empty string");
      if (!isNonEmptyString(o.artifactKind)) throw fieldError("artifactKind", "non-empty string");
      return { eventType: type, payload: { evidenceArtifactId: o.evidenceArtifactId, planStepId: o.planStepId, artifactKind: o.artifactKind } };
    }
    case "warning_recorded": {
      if (!isNonEmptyString(o.warningCode)) throw fieldError("warningCode", "non-empty string");
      if (typeof o.summary !== "string") throw fieldError("summary", "string");
      if (o.planStepId !== undefined && o.planStepId !== null && !isNonEmptyString(o.planStepId)) throw fieldError("planStepId", "non-empty string or null");
      if (!isStringArray(o.evidenceArtifactIds)) throw fieldError("evidenceArtifactIds", "string array");
      return { eventType: type, payload: { warningCode: o.warningCode, summary: o.summary, planStepId: (o.planStepId as string | null | undefined) ?? null, evidenceArtifactIds: o.evidenceArtifactIds } };
    }
  }
}

function fieldError(field: string, expected: string): RunEventPayloadError {
  return new RunEventPayloadError(
    `Invalid field '${field}': expected ${expected}`,
  );
}
