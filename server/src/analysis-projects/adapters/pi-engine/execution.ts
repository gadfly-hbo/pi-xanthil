import {
  ENGINE_PORT_VERSION,
  runEventSchemaVersion,
  type EngineErrorCode,
  type EngineOutcome,
} from "../../contracts/registries.ts";
import {
  EnginePortContractError,
  type EnginePortRequest,
  type EnginePortResultEnvelope,
  validateEnginePortRequest,
  validateEnginePortResult,
} from "../../contracts/engine-port.ts";
import { validateRunEventPayload } from "../../contracts/run-event.ts";

export interface RunExecutionRuntimeMetadata {
  readonly producerName: string;
  readonly producerVersion: string;
  readonly mode: "fake" | "pi-agent";
}

export interface RunExecutionRunnerRequest {
  readonly operation: "executeQueuedRun";
  readonly runId: string;
  readonly planVersionId: string;
  readonly expectedPreviousSequence: number;
  readonly inputHash: string;
  readonly instruction: string;
}

export type RunExecutionRunnerResult =
  | {
      readonly outcome: "succeeded";
      readonly stdoutJson: string;
      readonly runtime: RunExecutionRuntimeMetadata;
    }
  | {
      readonly outcome: "spawn_failed";
      readonly safeRuntime?: RunExecutionRuntimeMetadata;
      readonly rawDiagnostic?: string;
    }
  | {
      readonly outcome: "failed";
      readonly exitCode?: number | null;
      readonly signal?: string | null;
      readonly safeRuntime?: RunExecutionRuntimeMetadata;
      readonly rawDiagnostic?: string;
    };

export interface RunExecutionRunnerHandle {
  readonly done: Promise<RunExecutionRunnerResult>;
  /**
   * Terminate the underlying execution. The returned promise (if any) must
   * settle only after termination is confirmed; handlers await it before
   * returning an aborted/timed_out result.
   */
  readonly cancel: () => void | Promise<unknown>;
  readonly isRunning: () => boolean;
}

export interface RunExecutionRunner {
  start(request: RunExecutionRunnerRequest): RunExecutionRunnerHandle;
}

export interface AnalysisEngineExecutionHandlerOptions {
  readonly runner: RunExecutionRunner;
  readonly now?: () => Date;
  readonly defaultTimeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 30_000;
const ALLOWED_STAGES = new Set(["S2.1", "S2.2", "S2.3", "S2.4"]);
const STAGE_ORDER = ["S2.1", "S2.2", "S2.3", "S2.4"] as const;
// Engine may only suggest mid-run observational events. Backend-owned lifecycle
// events (run_started/run_failed/run_aborted/run_blocked) and durable-ID events
// (evidence_registered) are written by RunCoordinator and are prohibited here.
const ALLOWED_EVENT_TYPES = new Set([
  "stage_started",
  "stage_completed",
  "plan_step_started",
  "plan_step_completed",
  "warning_recorded",
]);
const ALLOWED_EVIDENCE_KINDS = new Set(["intermediate_result", "analysis_result", "aggregate_result", "chart", "notebook"]);
const FORBIDDEN_OUTPUT_KEYS = new Set([
  "prompt",
  "hiddenReasoning",
  "rawPiEvent",
  "rawPiEvents",
  "token",
  "accessToken",
  "apiKey",
  "storageRef",
  "piSessionRef",
  "absolutePath",
  "path",
  "stdout",
  "stderr",
  "stack",
  "sql",
  "evidenceContent",
  "content",
]);
const ABSOLUTE_PATH_RE = /(?:^|\s)(?:\/[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._ -]+)+|[A-Za-z]:\\[^\s]+)/;
const TOKEN_LIKE_RE = /[A-Za-z0-9_-]{40,}/;
const INTERNAL_PATH_RE = /(?:\.workcanger|\.pi-sessions|node_modules|apps\/server|server\/src|src\/analysis-engine|adapters\/pi-engine)/;

export function createAnalysisEngineExecutionHandler(options: AnalysisEngineExecutionHandlerOptions) {
  const now = options.now ?? (() => new Date());
  const defaultTimeoutMs = options.defaultTimeoutMs ?? DEFAULT_TIMEOUT_MS;

  return async function handleExecution(request: EnginePortRequest): Promise<EnginePortResultEnvelope> {
    validateEnginePortRequest(request);
    if (request.operation !== "executeQueuedRun") {
      throw new EnginePortContractError(`Unsupported execution operation: ${request.operation}`);
    }
    if (request.runId !== request.input.runId) {
      throw new EnginePortContractError("request runId must match input.runId");
    }

    const startedAt = now().toISOString();
    if (request.abortSignal?.aborted) {
      return validatedResult(request, startedAt, now().toISOString(), "aborted", undefined, {
        code: "aborted",
        summary: "Run execution was aborted before analysis runner completion.",
      });
    }
    if (isDeadlineExpired(request.deadlineAt, now())) {
      return validatedResult(request, startedAt, now().toISOString(), "timed_out", undefined, {
        code: "deadline_exceeded",
        summary: "Run execution did not complete before its deadline.",
      });
    }

    let handle: RunExecutionRunnerHandle;
    try {
      handle = options.runner.start(compileRunnerRequest(request));
    } catch {
      return validatedResult(request, startedAt, now().toISOString(), "failed", undefined, {
        code: "pi_spawn_failed",
        summary: "analysis runner process could not be started.",
      });
    }

    const abortPromise = new Promise<"aborted">((resolve) => {
      request.abortSignal?.addEventListener("abort", () => resolve("aborted"), { once: true });
    });
    const timeoutMs = deadlineTimeoutMs(request.deadlineAt, now(), defaultTimeoutMs);
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const timeoutPromise = new Promise<"timed_out">((resolve) => {
      timeout = setTimeout(() => resolve("timed_out"), timeoutMs);
    });

    try {
      const safeDone = handle.done.catch((): RunExecutionRunnerResult => ({ outcome: "failed" }));
      const race = await Promise.race([safeDone, abortPromise, timeoutPromise]);
      if (race === "aborted") {
        if (handle.isRunning()) await handle.cancel();
        return validatedResult(request, startedAt, now().toISOString(), "aborted", undefined, {
          code: "aborted",
          summary: "Run execution was aborted before analysis runner completion.",
        });
      }
      if (race === "timed_out") {
        if (handle.isRunning()) await handle.cancel();
        return validatedResult(request, startedAt, now().toISOString(), "timed_out", undefined, {
          code: "deadline_exceeded",
          summary: "Run execution did not complete before its deadline.",
        });
      }
      return mapRunnerResult(request, startedAt, now().toISOString(), race);
    } finally {
      if (timeout !== undefined) clearTimeout(timeout);
    }
  };
}

function compileRunnerRequest(request: EnginePortRequest & { readonly operation: "executeQueuedRun" }): RunExecutionRunnerRequest {
  return {
    operation: "executeQueuedRun",
    runId: request.input.runId,
    planVersionId: request.input.planVersionId,
    expectedPreviousSequence: request.input.expectedPreviousSequence,
    inputHash: request.inputHash,
    instruction: "Execute the queued Analysis Run through S2.1-S2.4 and return only normalized candidate suggestions. Do not include raw pi events, prompts, hidden reasoning, stdout, stderr, paths, tokens, storage refs, pi session refs, SQL, stack traces, or Evidence content.",
  };
}

function mapRunnerResult(
  request: EnginePortRequest & { readonly operation: "executeQueuedRun" },
  startedAt: string,
  completedAt: string,
  result: RunExecutionRunnerResult,
): EnginePortResultEnvelope {
  if (result.outcome === "spawn_failed") {
    return validatedResult(request, startedAt, completedAt, "failed", undefined, {
      code: "pi_spawn_failed",
      summary: "analysis runner process could not be started.",
    });
  }
  if (result.outcome === "failed") {
    return validatedResult(request, startedAt, completedAt, "failed", undefined, {
      code: "pi_execution_failed",
      summary: "analysis runner execution did not complete successfully.",
    });
  }

  const parsed = parseRunnerJson(result.stdoutJson);
  if (parsed === undefined || !isSafeRunExecutionOutput(request, parsed, result.runtime)) {
    return validatedResult(request, startedAt, completedAt, "failed", undefined, {
      code: "output_schema_invalid",
      summary: "analysis runner output did not match the expected safe execution candidate schema.",
    });
  }
  return validatedResult(request, startedAt, completedAt, "succeeded", parsed, undefined);
}

function parseRunnerJson(stdoutJson: string): unknown | undefined {
  try {
    return JSON.parse(stdoutJson) as unknown;
  } catch {
    return undefined;
  }
}

function isSafeRunExecutionOutput(
  request: EnginePortRequest & { readonly operation: "executeQueuedRun" },
  output: unknown,
  runtime: RunExecutionRuntimeMetadata,
): boolean {
  if (!isPlainRecord(output) || !onlyKeys(output, [
    "candidateType", "schemaVersion", "runId", "planVersionId", "expectedPreviousSequence", "producer", "executionSummary", "eventSuggestions", "evidenceRegistrationSuggestions", "internalReviewSuggestion", "reportDraftCandidate", "warnings",
  ]) || !doesNotLeak(output)) return false;
  if (output.candidateType !== "run_execution_candidate") return false;
  if (output.schemaVersion !== "1.0") return false;
  if (output.runId !== request.input.runId || output.planVersionId !== request.input.planVersionId) return false;
  if (output.expectedPreviousSequence !== request.input.expectedPreviousSequence) return false;
  if (!isProducer(output.producer, runtime)) return false;
  if (!isExecutionSummary(output.executionSummary)) return false;
  if (!Array.isArray(output.eventSuggestions) || output.eventSuggestions.length === 0) return false;
  if (!output.eventSuggestions.every(isEventSuggestion)) return false;
  if (!Array.isArray(output.evidenceRegistrationSuggestions) || output.evidenceRegistrationSuggestions.length === 0) return false;
  if (!output.evidenceRegistrationSuggestions.every(isEvidenceSuggestion)) return false;
  if (!isInternalReviewSuggestion(output.internalReviewSuggestion)) return false;
  if (!isReportDraftCandidate(output.reportDraftCandidate)) return false;
  if (!Array.isArray(output.warnings) || !output.warnings.every((warning) => typeof warning === "string")) return false;
  return satisfiesCrossReferenceInvariants(
    output.executionSummary as Record<string, unknown>,
    output.eventSuggestions,
    output.evidenceRegistrationSuggestions as Array<Record<string, unknown>>,
    output.internalReviewSuggestion as Record<string, unknown>,
    output.reportDraftCandidate as Record<string, unknown>,
  );
}

/**
 * Cross-field invariants consumed by the downstream durable mapping
 * (run-coordinator): summary counts against actual arrays, unique candidate
 * evidence handles, and every referenced handle resolvable.
 */
/**
 * Fail-closed event-sequence validator derived from the existing Analysis
 * Stage / RunEvent contracts and the four-step S2.1-S2.4 execution contract
 * (executionSummary.analysisOpsStages is already pinned to that order):
 * - analysisStageAfter must be non-decreasing through the declared stage order;
 * - every declared stage must have exactly one stage_started, in declared order;
 * - stage payload.stage must equal analysisStageAfter;
 * - a stage_completed requires a prior stage_started for the same stage;
 * - planStepId <-> stepOrdinal is a bijection across all plan_step events;
 * - plan_step_started must precede plan_step_completed for the same step;
 * - plan_step_completed stepOrdinals are unique and contiguous starting at 1.
 */
function isCoherentEventSequence(events: Array<Record<string, unknown>>, declaredStages: string[]): boolean {
  let lastStageIndex = -1;
  const stageStartedSeen: string[] = [];
  const stageStartedAt = new Map<string, number>();
  const stageCompletedAt = new Map<string, number>();
  const stepOrdinalById = new Map<string, number>();
  const stepIdByOrdinal = new Map<number, string>();
  const stepStartedAt = new Map<string, number>();
  const stepCompletedAt = new Map<string, number>();
  const completedOrdinals = new Set<number>();

  for (let i = 0; i < events.length; i++) {
    const event = events[i]!;
    const stageIndex = STAGE_ORDER.indexOf(event.analysisStageAfter as (typeof STAGE_ORDER)[number]);
    if (stageIndex < 0 || stageIndex < lastStageIndex) return false;
    lastStageIndex = stageIndex;
    const eventType = event.eventType as string;
    const payload = event.payload as Record<string, unknown>;

    if (eventType === "stage_started" || eventType === "stage_completed") {
      if (payload.stage !== event.analysisStageAfter) return false;
      const stage = payload.stage as string;
      if (eventType === "stage_started") {
        if (stageStartedAt.has(stage) || stageCompletedAt.has(stage)) return false;
        stageStartedAt.set(stage, i);
        stageStartedSeen.push(stage);
      } else {
        if (!stageStartedAt.has(stage) || stageCompletedAt.has(stage)) return false;
        stageCompletedAt.set(stage, i);
      }
      continue;
    }

    if (eventType === "plan_step_started" || eventType === "plan_step_completed") {
      const planStepId = payload.planStepId as string;
      const stepOrdinal = payload.stepOrdinal as number;
      const existingOrdinal = stepOrdinalById.get(planStepId);
      if (existingOrdinal !== undefined && existingOrdinal !== stepOrdinal) return false;
      const existingId = stepIdByOrdinal.get(stepOrdinal);
      if (existingId !== undefined && existingId !== planStepId) return false;
      stepOrdinalById.set(planStepId, stepOrdinal);
      stepIdByOrdinal.set(stepOrdinal, planStepId);
      if (eventType === "plan_step_started") {
        if (stepStartedAt.has(planStepId) || stepCompletedAt.has(planStepId)) return false;
        stepStartedAt.set(planStepId, i);
      } else {
        if (stepCompletedAt.has(planStepId) || completedOrdinals.has(stepOrdinal)) return false;
        stepCompletedAt.set(planStepId, i);
        completedOrdinals.add(stepOrdinal);
      }
    }
  }

  for (const [planStepId, startedIndex] of stepStartedAt) {
    const completedIndex = stepCompletedAt.get(planStepId);
    if (completedIndex !== undefined && startedIndex > completedIndex) return false;
  }

  if (stageStartedSeen.length !== declaredStages.length) return false;
  for (let i = 0; i < declaredStages.length; i++) {
    if (stageStartedSeen[i] !== declaredStages[i]) return false;
  }

  const sortedOrdinals = [...completedOrdinals].sort((a, b) => a - b);
  if (sortedOrdinals.length === 0) return false;
  for (let i = 0; i < sortedOrdinals.length; i++) {
    if (sortedOrdinals[i] !== i + 1) return false;
  }
  return true;
}

function satisfiesCrossReferenceInvariants(
  summary: Record<string, unknown>,
  events: Array<Record<string, unknown>>,
  evidence: Array<Record<string, unknown>>,
  review: Record<string, unknown>,
  report: Record<string, unknown>,
): boolean {
  if (summary.eventSuggestionCount !== events.length) return false;
  if (summary.evidenceSuggestionCount !== evidence.length) return false;
  // idx_run_events_producer_idempotency is unique on (run, producer, producer_event_id).
  const producerEventIds = events.map((e) => e.producerEventId as string);
  if (new Set(producerEventIds).size !== producerEventIds.length) return false;
  if (!isCoherentEventSequence(events, summary.analysisOpsStages as string[])) return false;
  const completedStepIds = new Set(
    events
      .filter((e) => e.eventType === "plan_step_completed")
      .map((e) => (e.payload as Record<string, unknown>).planStepId as string),
  );
  if (summary.planStepCount !== completedStepIds.size) return false;
  const handles = new Set(evidence.map((s) => s.candidateEvidenceHandle as string));
  if (handles.size !== evidence.length) return false;
  const reviewHandle = review.reviewEvidenceHandle as string;
  if (!handles.has(reviewHandle)) return false;
  const reviewEvidence = evidence.find((s) => s.candidateEvidenceHandle === reviewHandle) as Record<string, unknown>;
  if (reviewEvidence.artifactKind !== "intermediate_result" || reviewEvidence.visibility !== "review_only") return false;
  if (!(review.reviewedEvidenceHandles as string[]).every((handle) => handles.has(handle))) return false;
  if (!(report.citedEvidenceHandles as string[]).every((handle) => handles.has(handle))) return false;
  return true;
}

function isProducer(value: unknown, runtime: RunExecutionRuntimeMetadata): boolean {
  return isPlainRecord(value)
    && onlyKeys(value, ["name", "version", "mode"])
    && value.name === runtime.producerName
    && value.version === runtime.producerVersion
    && value.mode === runtime.mode;
}

function isExecutionSummary(value: unknown): boolean {
  return isPlainRecord(value)
    && onlyKeys(value, ["runStartAcknowledged", "analysisOpsStages", "planStepCount", "eventSuggestionCount", "evidenceSuggestionCount", "internalReviewOutcome", "reportDraftReady"])
    && value.runStartAcknowledged === true
    && Array.isArray(value.analysisOpsStages)
    && value.analysisOpsStages.join("|") === "S2.1|S2.2|S2.3|S2.4"
    && isPositiveInteger(value.planStepCount)
    && isPositiveInteger(value.eventSuggestionCount)
    && isPositiveInteger(value.evidenceSuggestionCount)
    && value.internalReviewOutcome === "passed"
    && value.reportDraftReady === true;
}

function isEventSuggestion(value: unknown): boolean {
  if (!isPlainRecord(value) || !onlyKeys(value, ["eventType", "payloadSchemaVersion", "analysisStageAfter", "runStatusAfter", "producerEventId", "payload"])) return false;
  if (typeof value.eventType !== "string" || !ALLOWED_EVENT_TYPES.has(value.eventType)) return false;
  if (value.payloadSchemaVersion !== runEventSchemaVersion(value.eventType)) return false;
  if (typeof value.analysisStageAfter !== "string" || !ALLOWED_STAGES.has(value.analysisStageAfter)) return false;
  if (value.runStatusAfter !== "running") return false;
  if (typeof value.producerEventId !== "string" || value.producerEventId.length === 0) return false;
  if (!isPlainRecord(value.payload) || !doesNotLeak(value.payload)) return false;
  // Engine suggestions must not embed durable evidence IDs: the backend maps
  // candidate handles to durable IDs itself.
  if (value.eventType === "warning_recorded") {
    const ids = (value.payload as Record<string, unknown>).evidenceArtifactIds;
    if (!Array.isArray(ids) || ids.length !== 0) return false;
  }
  if (value.eventType === "plan_step_completed") {
    const ids = (value.payload as Record<string, unknown>).outputEvidenceArtifactIds;
    if (!Array.isArray(ids) || ids.length !== 0) return false;
  }
  try {
    validateRunEventPayload(value.eventType, value.payloadSchemaVersion, value.payload);
  } catch {
    return false;
  }
  return true;
}

function isEvidenceSuggestion(value: unknown): boolean {
  return isPlainRecord(value)
    && onlyKeys(value, ["candidateEvidenceHandle", "sourceAdmittedEvidenceHandle", "planStepId", "artifactKind", "safetyClass", "visibility", "displayName", "contentSha256"])
    && isSafeHandle(value.candidateEvidenceHandle)
    && isSafeHandle(value.sourceAdmittedEvidenceHandle)
    && typeof value.planStepId === "string"
    && value.planStepId.length > 0
    && typeof value.artifactKind === "string"
    && ALLOWED_EVIDENCE_KINDS.has(value.artifactKind)
    && value.safetyClass === "derived"
    && (value.visibility === "review_only" || value.visibility === "user_visible")
    && typeof value.displayName === "string"
    && value.displayName.length > 0
    && typeof value.contentSha256 === "string"
    && /^[0-9a-f]{64}$/.test(value.contentSha256);
}

function isInternalReviewSuggestion(value: unknown): boolean {
  return isPlainRecord(value)
    && onlyKeys(value, ["schemaVersion", "reviewOrdinal", "planStepId", "outcome", "reviewEvidenceHandle", "reviewedEvidenceHandles", "qualityChecks", "limitations", "misinterpretationRisks"])
    && value.schemaVersion === "1.0"
    && value.reviewOrdinal === 1
    && typeof value.planStepId === "string"
    && value.planStepId.length > 0
    && value.outcome === "passed"
    && isSafeHandle(value.reviewEvidenceHandle)
    && Array.isArray(value.reviewedEvidenceHandles)
    && value.reviewedEvidenceHandles.every(isSafeHandle)
    && Array.isArray(value.qualityChecks)
    && value.qualityChecks.length > 0
    && value.qualityChecks.every(isQualityCheck)
    && Array.isArray(value.limitations)
    && value.limitations.every((item) => typeof item === "string")
    && Array.isArray(value.misinterpretationRisks)
    && value.misinterpretationRisks.every((item) => typeof item === "string");
}

function isQualityCheck(value: unknown): boolean {
  return isPlainRecord(value)
    && onlyKeys(value, ["checkId", "outcome", "summary"])
    && typeof value.checkId === "string"
    && value.checkId.length > 0
    && value.outcome === "passed"
    && typeof value.summary === "string"
    && value.summary.length > 0;
}

function isReportDraftCandidate(value: unknown): boolean {
  return isPlainRecord(value)
    && onlyKeys(value, ["schemaVersion", "title", "executiveSummary", "methodSummary", "keyConclusionCount", "citedEvidenceHandles", "confidence", "confidenceRationale", "limitations", "misinterpretationRisks", "actionableRecommendationCount"])
    && value.schemaVersion === "1.0"
    && typeof value.title === "string"
    && value.title.length > 0
    && typeof value.executiveSummary === "string"
    && value.executiveSummary.length > 0
    && typeof value.methodSummary === "string"
    && value.methodSummary.length > 0
    && isPositiveInteger(value.keyConclusionCount)
    && Array.isArray(value.citedEvidenceHandles)
    && value.citedEvidenceHandles.length > 0
    && value.citedEvidenceHandles.every(isSafeHandle)
    && (value.confidence === "high" || value.confidence === "medium" || value.confidence === "low")
    && typeof value.confidenceRationale === "string"
    && value.confidenceRationale.length > 0
    && Array.isArray(value.limitations)
    && value.limitations.every((item) => typeof item === "string")
    && Array.isArray(value.misinterpretationRisks)
    && value.misinterpretationRisks.every((item) => typeof item === "string")
    && isNonNegativeInteger(value.actionableRecommendationCount);
}

function doesNotLeak(value: unknown): boolean {
  if (typeof value === "string") {
    if (/^[0-9a-f]{64}$/.test(value)) return true;
    return !ABSOLUTE_PATH_RE.test(value)
      && !TOKEN_LIKE_RE.test(value)
      && !INTERNAL_PATH_RE.test(value)
      && !/\b(?:SELECT|INSERT|UPDATE|DELETE|CREATE TABLE|PRAGMA)\b/i.test(value);
  }
  if (Array.isArray(value)) return value.every(doesNotLeak);
  if (isPlainRecord(value)) {
    for (const [key, child] of Object.entries(value)) {
      if (FORBIDDEN_OUTPUT_KEYS.has(key)) return false;
      if (!doesNotLeak(child)) return false;
    }
  }
  return true;
}

function isDeadlineExpired(deadlineAt: string | null | undefined, now: Date): boolean {
  if (!deadlineAt) return false;
  const deadlineMs = new Date(deadlineAt).getTime();
  if (!Number.isFinite(deadlineMs)) return false;
  return deadlineMs <= now.getTime();
}

function deadlineTimeoutMs(deadlineAt: string | null | undefined, now: Date, fallbackMs: number): number {
  if (!deadlineAt) return fallbackMs;
  const diff = new Date(deadlineAt).getTime() - now.getTime();
  if (!Number.isFinite(diff)) return fallbackMs;
  return Math.max(0, Math.min(diff, fallbackMs));
}

function validatedResult(
  request: EnginePortRequest,
  startedAt: string,
  completedAt: string,
  outcome: EngineOutcome,
  output: unknown | undefined,
  error: { readonly code: EngineErrorCode; readonly summary: string } | undefined,
): EnginePortResultEnvelope {
  const envelope: EnginePortResultEnvelope = {
    version: ENGINE_PORT_VERSION,
    operation: request.operation,
    operationId: request.operationId,
    projectId: request.projectId,
    runId: request.runId ?? null,
    startedAt,
    completedAt,
    outcome,
    ...(output === undefined ? {} : { output }),
    ...(error === undefined ? {} : { error }),
  };
  validateEnginePortResult(envelope);
  return envelope;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function onlyKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const allowed = new Set(keys);
  return Object.keys(value).every((key) => allowed.has(key)) && keys.every((key) => key in value);
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

function isSafeHandle(value: unknown): value is string {
  return typeof value === "string" && /^[a-z0-9][a-z0-9:._-]{2,80}$/.test(value) && doesNotLeak(value);
}
