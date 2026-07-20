/**
 * Canonical command, error, event, and engine-port registries.
 *
 * Contract (application-api-readmodels-v1.md):
 * - API-061: command taxonomy is 34 commands (27 original + 7 closure per T0021 CCR).
 * - §2.3: fixed ApiErrorCode registry (38 codes) with HTTP + retryDirective.
 * - §13 / API-051: 12 RunEvent payload schemas, version `workcanger.run-event.<type>/1.0`.
 * - §12.1 / API-035: 12 Engine port operations.
 * - §12.2: 15 fixed Engine error codes.
 * - §15: 15 result resource types (13 original + 2 closure); 4 execution statuses.
 * - §2.1: unknown path/action/field/enum/schema version/event type fail closed.
 *
 * These registries are the single source of truth for application-layer
 * validation. Unknown values are rejected, never coerced.
 */

// ---------------------------------------------------------------------------
// Schema versions
// ---------------------------------------------------------------------------

export const API_SCHEMA_VERSION = "1.0" as const;
export const ENGINE_PORT_VERSION = "engine-port/1.0" as const;
export const RUN_EVENT_PAYLOAD_VERSION = "1.0" as const;

export function runEventSchemaVersion(eventType: string): string {
  return `workcanger.run-event.${eventType}/${RUN_EVENT_PAYLOAD_VERSION}`;
}

// ---------------------------------------------------------------------------
// Command taxonomy (34 = 27 original + 7 closure) — API-061 extended by T0021
// ---------------------------------------------------------------------------

export const COMMAND_TYPES = [
  "setup.bootstrap_local_human",
  "session.rotate_local_api_token",
  "actor.update_profile",
  "project.create",
  "project.update_metadata",
  "project.delete_draft",
  "project.cancel",
  "project.archive",
  "project.unarchive",
  "project.reopen",
  "evidence.upload_user",
  "source.register_agentharness",
  "source.update_metadata",
  "source.check",
  "source.read",
  "source.archive",
  "source.unarchive",
  "request.submit",
  "requirement.generate",
  "requirement.decide_confirmation",
  "plan.generate",
  "plan.decide_confirmation",
  "run.abort",
  "run.retry",
  "report.decide_review",
  "locked_report.generate_representation",
  "locked_report.export_analysisops",
  "closure.initiate_cycle",
  "closure.record_s31_translation",
  "closure.record_s32_deployment",
  "closure.record_s33_execution",
  "closure.append_s34_feedback",
  "closure.record_s35_evaluation",
  "closure.record_s36_trigger",
] as const;

export type CommandType = (typeof COMMAND_TYPES)[number];

const COMMAND_TYPE_SET: ReadonlySet<string> = new Set(COMMAND_TYPES);

export function isCommandType(value: unknown): value is CommandType {
  return typeof value === "string" && COMMAND_TYPE_SET.has(value);
}

/** Fail-closed command validation. Throws on unknown command type. */
export function assertCommandType(value: unknown): CommandType {
  if (!isCommandType(value)) {
    throw new InvalidRegistryValueError(
      `command_type`,
      value,
      COMMAND_TYPES.length,
    );
  }
  return value;
}

// ---------------------------------------------------------------------------
// Idempotency execution status (4) — §15
// ---------------------------------------------------------------------------

export const EXECUTION_STATUSES = [
  "in_progress",
  "succeeded",
  "failed",
  "interrupted",
] as const;

export type ExecutionStatus = (typeof EXECUTION_STATUSES)[number];

const EXECUTION_STATUS_SET: ReadonlySet<string> = new Set(EXECUTION_STATUSES);

export function isExecutionStatus(value: unknown): value is ExecutionStatus {
  return typeof value === "string" && EXECUTION_STATUS_SET.has(value);
}

// Terminal statuses (record must not change after reaching these).
export const TERMINAL_EXECUTION_STATUSES: ReadonlySet<ExecutionStatus> =
  new Set<ExecutionStatus>(["succeeded", "failed", "interrupted"]);

// ---------------------------------------------------------------------------
// Result resource types (13) — §15
// ---------------------------------------------------------------------------

export const RESULT_RESOURCE_TYPES = [
  "AuditActor",
  "Project",
  "Request",
  "Source",
  "SourceCheck",
  "Evidence",
  "Requirement",
  "Plan",
  "Gate",
  "Run",
  "Report",
  "representation",
  "export",
  "ClosureCycle",
  "ClosureStageFact",
] as const;

export type ResultResourceType = (typeof RESULT_RESOURCE_TYPES)[number];

const RESULT_RESOURCE_TYPE_SET: ReadonlySet<string> = new Set(
  RESULT_RESOURCE_TYPES,
);

export function isResultResourceType(
  value: unknown,
): value is ResultResourceType {
  return typeof value === "string" && RESULT_RESOURCE_TYPE_SET.has(value);
}

// ---------------------------------------------------------------------------
// Engine port outcome (6) — §12.2
// ---------------------------------------------------------------------------

export const ENGINE_OUTCOMES = [
  "succeeded",
  "failed",
  "aborted",
  "timed_out",
  "conflict",
  "policy_blocked",
] as const;

export type EngineOutcome = (typeof ENGINE_OUTCOMES)[number];

const ENGINE_OUTCOME_SET: ReadonlySet<string> = new Set(ENGINE_OUTCOMES);

export function isEngineOutcome(value: unknown): value is EngineOutcome {
  return typeof value === "string" && ENGINE_OUTCOME_SET.has(value);
}

// ---------------------------------------------------------------------------
// Engine port operations (12) — §12.1 / API-035
// ---------------------------------------------------------------------------

export const ENGINE_PORT_OPERATIONS = [
  // Backend -> Engine (generation / execution / abort / recovery)
  "generateStructuredRequirement",
  "generateAnalysisPlan",
  "executeQueuedRun",
  "requestRunAbort",
  "inspectRunningRunRecovery",
  // Engine -> Backend reads
  "getRunExecutionContext",
  "openRunInputEvidence",
  // Engine -> Backend writes
  "appendRunEvent",
  "registerRunEvidence",
  "submitInternalReviewEvidence",
  "completeRunWithReport",
  "terminateRun",
] as const;

export type EnginePortOperation = (typeof ENGINE_PORT_OPERATIONS)[number];

const ENGINE_PORT_OPERATION_SET: ReadonlySet<string> = new Set(
  ENGINE_PORT_OPERATIONS,
);

export function isEnginePortOperation(
  value: unknown,
): value is EnginePortOperation {
  return typeof value === "string" && ENGINE_PORT_OPERATION_SET.has(value);
}

// ---------------------------------------------------------------------------
// Engine error codes (15) — §12.2
// ---------------------------------------------------------------------------

export const ENGINE_ERROR_CODES = [
  "invalid_request",
  "unsupported_contract_version",
  "operation_conflict",
  "deadline_exceeded",
  "aborted",
  "policy_blocked",
  "project_state_conflict",
  "run_state_conflict",
  "plan_contract_mismatch",
  "evidence_not_admitted",
  "evidence_integrity_failed",
  "evidence_unsafe",
  "pi_spawn_failed",
  "pi_execution_failed",
  "output_schema_invalid",
] as const;

export type EngineErrorCode = (typeof ENGINE_ERROR_CODES)[number];

const ENGINE_ERROR_CODE_SET: ReadonlySet<string> = new Set(ENGINE_ERROR_CODES);

export function isEngineErrorCode(value: unknown): value is EngineErrorCode {
  return typeof value === "string" && ENGINE_ERROR_CODE_SET.has(value);
}

// ---------------------------------------------------------------------------
// RunEvent types (12) — §13 / API-051
// ---------------------------------------------------------------------------

export const RUN_EVENT_TYPES = [
  "run_queued",
  "run_started",
  "run_succeeded",
  "run_failed",
  "run_aborted",
  "run_blocked",
  "stage_started",
  "stage_completed",
  "plan_step_started",
  "plan_step_completed",
  "evidence_registered",
  "warning_recorded",
] as const;

export type RunEventType = (typeof RUN_EVENT_TYPES)[number];

const RUN_EVENT_TYPE_SET: ReadonlySet<string> = new Set(RUN_EVENT_TYPES);

export function isRunEventType(value: unknown): value is RunEventType {
  return typeof value === "string" && RUN_EVENT_TYPE_SET.has(value);
}

/** Fail-closed RunEvent type validation. */
export function assertRunEventType(value: unknown): RunEventType {
  if (!isRunEventType(value)) {
    throw new InvalidRegistryValueError(
      `run_event_type`,
      value,
      RUN_EVENT_TYPES.length,
    );
  }
  return value;
}

// ---------------------------------------------------------------------------
// AnalysisStage + RunStatus (from P0-10 / P0-11 / 0001 schema)
// ---------------------------------------------------------------------------

/**
 * Run-level analysis stages stored in analysis_runs.current_analysis_stage.
 * These are the only values valid for the DB column and RunEvent payloads.
 */
export const ANALYSIS_STAGES = ["S2.1", "S2.2", "S2.3", "S2.4"] as const;
export type AnalysisStage = (typeof ANALYSIS_STAGES)[number];

/**
 * Project-level lifecycle stages derived from durable facts (§7, P0-84).
 * These are NOT stored in the DB - they are derived by deriveProjectStage().
 * S1.1 = request submitted; S1.2 = requirement version exists;
 * S1.4 = plan version exists (not yet confirmed); S2.1 = plan confirmed;
 * S2.2-S2.4 = run in progress (mirrors run.current_analysis_stage);
 * S2.5 = run succeeded or report exists; S2.6 = locked report.
 * S1.3 is reserved for "requirement confirmed" (not separately derived in v1).
 */
export const PROJECT_STAGES = [
  "S1.1", "S1.2", "S1.4",
  "S2.1", "S2.2", "S2.3", "S2.4",
  "S2.5", "S2.6",
  "S3.1", "S3.2", "S3.3", "S3.4", "S3.5", "S3.6",
] as const;
export type ProjectStage = (typeof PROJECT_STAGES)[number];

const PROJECT_STAGE_SET: ReadonlySet<string> = new Set(PROJECT_STAGES);

export function isProjectStage(value: unknown): value is ProjectStage {
  return typeof value === "string" && PROJECT_STAGE_SET.has(value);
}

/** Fail-closed project stage validation. */
export function assertProjectStage(value: unknown): ProjectStage {
  if (!isProjectStage(value)) {
    throw new InvalidRegistryValueError(
      `project_stage`,
      value,
      PROJECT_STAGES.length,
    );
  }
  return value;
}

export const RUN_STATUSES = [
  "queued",
  "running",
  "succeeded",
  "failed",
  "aborted",
  "blocked",
] as const;
export type RunStatus = (typeof RUN_STATUSES)[number];

export const PROJECT_STATUSES = [
  "active",
  "completed",
  "rejected",
  "cancelled",
] as const;
export type ProjectStatus = (typeof PROJECT_STATUSES)[number];

export const PROJECT_KINDS = [
  "goal_decomposition",
  "daily_analysis",
  "topic_research",
] as const;
export type ProjectKind = (typeof PROJECT_KINDS)[number];

export const SUBMITTED_VIA = ["web_ui", "local_api"] as const;
export type SubmittedVia = (typeof SUBMITTED_VIA)[number];

export const ACTOR_KINDS = ["human", "system", "agent"] as const;
export type ActorKind = (typeof ACTOR_KINDS)[number];

// ---------------------------------------------------------------------------
// Error
// ---------------------------------------------------------------------------

export class InvalidRegistryValueError extends Error {
  readonly registry: string;
  readonly value: unknown;
  readonly expectedCount: number;
  constructor(registry: string, value: unknown, expectedCount: number) {
    super(
      `Unknown ${registry}: ${JSON.stringify(value)}. ` +
        `Registry has ${expectedCount} fixed values; unknown values fail closed.`,
    );
    this.name = "InvalidRegistryValueError";
    this.registry = registry;
    this.value = value;
    this.expectedCount = expectedCount;
  }
}
