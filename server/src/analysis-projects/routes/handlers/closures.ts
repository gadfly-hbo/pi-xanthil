/**
 * S3.x Business Closure HTTP handlers (T0021 revised).
 *
 * Exposes closure cycle commands and read models via workspace-scoped routes.
 * Uses existing idempotency patterns: validateIdempotencyKey, claimOn,
 * recordSuccessInTx, sendCommandResult.
 *
 * Authority: docs/workcanger-s3-business-closure-structure-ledger.md §20 C1R/C2R.
 */
import type { RequestContext } from "../router.ts";
import { sendJson, sendCommandResult } from "../envelope.ts";
import { successEnvelope, ApplicationError } from "../../contracts/envelope.ts";
import {
  readRequestBody, parseJsonStrict, validateObjectBody,
  validateUuidPathParam, validateNonEmptyString, validatePositiveInteger,
  validateIdempotencyKey,
} from "../body.ts";
import { claimOn, recordSuccessInTx, recordFailure } from "../../application/idempotency/idempotency-service.ts";
import { computeRequestHash } from "../../application/shared/runtime.ts";
import type { CommandResult } from "../../application/shared/command.ts";
import {
  initiateClosureCycle,
  recordS31Translation,
  recordS32Deployment,
  recordS33Execution,
  appendS34Feedback,
  recordS35Evaluation,
  recordS36Trigger,
} from "../../application/closure/closure-service.ts";
import {
  queryClosureDetail,
  queryClosureList,
} from "../../application/closure/closure-read-model.ts";
import {
  TRANSLATION_STATUSES,
  DOWNSTREAM_SYSTEMS,
  DEPLOYMENT_STATUSES,
  FEEDBACK_SOURCES,
  SIGNIFICANCE_STATUSES,
  REVIEW_STATUSES,
  HYPOTHESIS_RESULTS,
  EFFECTIVENESS_RATINGS,
  ITERATION_BRANCHES,
  TARGET_STATES,
} from "../../contracts/closure.ts";
import { now } from "../../application/shared/runtime.ts";

const JSON_MAX_BYTES = 64 * 1024;

function requireJsonContentType(headers: Record<string, string | string[] | undefined>): void {
  const ct = headers["content-type"];
  if (typeof ct !== "string" || !ct.toLowerCase().startsWith("application/json")) {
    throw new ApplicationError("unsupported_media_type", "Content-Type must be application/json.");
  }
}

function assertEnum<T extends readonly string[]>(set: T, value: unknown, fieldPath: string): T[number] {
  if (typeof value !== "string" || !set.includes(value)) {
    throw new ApplicationError("validation_failed", `${fieldPath} must be one of: ${set.join(", ")}.`, {
      fieldErrors: [{ fieldPath, code: "invalid_enum", summary: `${fieldPath} must be one of: ${set.join(", ")}` }],
    });
  }
  return value;
}

function validateSha256(value: unknown, fieldPath: string): string {
  if (typeof value !== "string" || !/^[0-9a-f]{64}$/.test(value)) {
    throw new ApplicationError("validation_failed", `${fieldPath} must be a 64-char lowercase hex SHA-256.`, {
      fieldErrors: [{ fieldPath, code: "format", summary: `${fieldPath} must be a valid SHA-256 hex` }],
    });
  }
  return value;
}

function validateJsonString(value: unknown, fieldPath: string): string {
  if (typeof value !== "string") {
    throw new ApplicationError("validation_failed", `${fieldPath} must be a string.`, {
      fieldErrors: [{ fieldPath, code: "type", summary: `${fieldPath} must be a string` }],
    });
  }
  try { JSON.parse(value); } catch {
    throw new ApplicationError("validation_failed", `${fieldPath} must be valid JSON.`, {
      fieldErrors: [{ fieldPath, code: "format", summary: `${fieldPath} must be valid JSON` }],
    });
  }
  return value;
}

function handleClaim(claim: ReturnType<typeof claimOn>): CommandResult<never> | null {
  if (claim.kind === "in_progress") return { kind: "in_progress", recordId: claim.recordId };
  if (claim.kind === "conflict") return { kind: "conflict", recordId: claim.recordId };
  if (claim.kind === "replay_success") return { kind: "replayed_success", httpStatus: claim.record.responseHttpStatus!, resultResourceType: claim.record.resultResourceType!, resultResourceId: claim.record.resultResourceId!, recordId: claim.record.idempotencyRecordId };
  if (claim.kind === "replay_failed") return { kind: "failed", httpStatus: claim.record.responseHttpStatus!, errorCode: claim.record.errorCode!, errorSummary: claim.record.errorSummary!, fieldErrors: [], recordId: claim.record.idempotencyRecordId };
  return null;
}

function mapErr(err: unknown): ApplicationError {
  if (err instanceof ApplicationError) return err;
  const msg = (err as Error).message ?? "internal error";
  if (/UNIQUE/i.test(msg)) return new ApplicationError("validation_failed", msg);
  return new ApplicationError("internal_error", "An internal error occurred.", { cause: err });
}

// ---------------------------------------------------------------------------
// Closure cycle commands (idempotent)
// ---------------------------------------------------------------------------

export async function handleInitiateClosureCycle(ctx: RequestContext): Promise<void> {
  requireJsonContentType(ctx.headers);
  const projectId = validateUuidPathParam(ctx.pathParams.projectId, "projectId");
  const idempotencyKey = validateIdempotencyKey(ctx.headers["idempotency-key"] as string | undefined);
  const body = await readRequestBody(ctx.req, JSON_MAX_BYTES);
  const parsed = parseJsonStrict(body);
  const obj = validateObjectBody(parsed,
    ["lockedReportVersionId", "closureOrdinal"],
    ["lockedReportVersionId", "closureOrdinal"]);
  const lockedReportVersionId = validateUuidPathParam(obj.lockedReportVersionId as string, "lockedReportVersionId");
  const closureOrdinal = validatePositiveInteger(obj.closureOrdinal, "/closureOrdinal");
  const requestHash = computeRequestHash("POST", `/api/analysis-projects/v1/workspaces/${ctx.workspaceId}/projects/${projectId}/closure-cycles:initiate`, obj);
  const claim = claimOn(ctx.db, { actorId: ctx.actorContext.actorId, commandType: "closure.initiate_cycle", idempotencyKey, requestHash });
  const pre = handleClaim(claim);
  if (pre) { sendCommandResult(ctx.res, ctx.requestId, pre); return; }
  const cycleId = crypto.randomUUID();
  const ts = now();
  ctx.db.exec("BEGIN");
  try {
    const cycle = initiateClosureCycle(ctx.db, {
      closureCycleId: cycleId, analysisProjectId: projectId, workspaceId: ctx.workspaceId,
      lockedReportVersionId, closureOrdinal, initiatedByActorId: ctx.actorContext.actorId,
    });
    recordSuccessInTx(ctx.db, claim.recordId, { httpStatus: 201, resultResourceType: "ClosureCycle", resultResourceId: cycleId });
    ctx.db.exec("COMMIT");
    sendCommandResult(ctx.res, ctx.requestId, { kind: "executed", httpStatus: 201, resultResourceType: "ClosureCycle", resultResourceId: cycleId, data: cycle, recordId: claim.recordId });
  } catch (err) {
    ctx.db.exec("ROLLBACK");
    const appErr = mapErr(err);
    recordFailure(ctx.db, claim.recordId, { httpStatus: appErr.httpStatus, errorCode: appErr.code, errorSummary: appErr.message });
    sendCommandResult(ctx.res, ctx.requestId, { kind: "failed", httpStatus: appErr.httpStatus, errorCode: appErr.code, errorSummary: appErr.message, fieldErrors: appErr.fieldErrors, recordId: claim.recordId });
  }
}

function makeClosureStageHandler(
  commandType: Parameters<typeof claimOn>[1]["commandType"],
  resourceType: "ClosureCycle" | "ClosureStageFact",
  allowedFields: readonly string[],
  requiredFields: readonly string[],
  execute: (db: RequestContext["db"], obj: Record<string, unknown>, ctx: RequestContext) => { id: string; data: unknown },
) {
  return async (ctx: RequestContext) => {
    requireJsonContentType(ctx.headers);
    const cycleId = validateUuidPathParam(ctx.pathParams.closureCycleId, "closureCycleId");
    const idempotencyKey = validateIdempotencyKey(ctx.headers["idempotency-key"] as string | undefined);
    const body = await readRequestBody(ctx.req, JSON_MAX_BYTES);
    const parsed = parseJsonStrict(body);
    const obj = validateObjectBody(parsed, allowedFields, requiredFields);
    const requestHash = computeRequestHash("POST", ctx.normalizedPath, obj);
    const claim = claimOn(ctx.db, { actorId: ctx.actorContext.actorId, commandType, idempotencyKey, requestHash });
    const pre = handleClaim(claim);
    if (pre) { sendCommandResult(ctx.res, ctx.requestId, pre); return; }
    ctx.db.exec("BEGIN");
    try {
      const result = execute(ctx.db, obj, ctx);
      recordSuccessInTx(ctx.db, claim.recordId, { httpStatus: 201, resultResourceType: resourceType, resultResourceId: result.id });
      ctx.db.exec("COMMIT");
      sendCommandResult(ctx.res, ctx.requestId, { kind: "executed", httpStatus: 201, resultResourceType: resourceType, resultResourceId: result.id, data: result.data, recordId: claim.recordId });
    } catch (err) {
      ctx.db.exec("ROLLBACK");
      const appErr = mapErr(err);
      recordFailure(ctx.db, claim.recordId, { httpStatus: appErr.httpStatus, errorCode: appErr.code, errorSummary: appErr.message });
      sendCommandResult(ctx.res, ctx.requestId, { kind: "failed", httpStatus: appErr.httpStatus, errorCode: appErr.code, errorSummary: appErr.message, fieldErrors: appErr.fieldErrors, recordId: claim.recordId });
    }
  };
}

export const handleRecordS31Translation = makeClosureStageHandler(
  "closure.record_s31_translation", "ClosureStageFact",
  ["businessActionArtifactRef", "businessActionContentSha256", "selectedRecommendationsJson",
   "businessRulesJson", "thresholdsJson", "segmentsJson", "grayReleaseTargetsJson",
   "feedbackMetricDefinitionsJson", "translationStatus"],
  ["businessActionArtifactRef", "businessActionContentSha256", "selectedRecommendationsJson",
   "businessRulesJson", "thresholdsJson", "segmentsJson", "grayReleaseTargetsJson",
   "feedbackMetricDefinitionsJson", "translationStatus"],
  (db, obj, ctx) => {
    const cycleId = ctx.pathParams.closureCycleId!;
    const row = recordS31Translation(db, {
      translationId: crypto.randomUUID(), closureCycleId: cycleId, workspaceId: ctx.workspaceId,
      businessActionArtifactRef: validateNonEmptyString(obj.businessActionArtifactRef, "/businessActionArtifactRef"),
      businessActionContentSha256: validateSha256(obj.businessActionContentSha256, "/businessActionContentSha256"),
      selectedRecommendationsJson: validateJsonString(obj.selectedRecommendationsJson, "/selectedRecommendationsJson"),
      businessRulesJson: validateJsonString(obj.businessRulesJson, "/businessRulesJson"),
      thresholdsJson: validateJsonString(obj.thresholdsJson, "/thresholdsJson"),
      segmentsJson: validateJsonString(obj.segmentsJson, "/segmentsJson"),
      grayReleaseTargetsJson: validateJsonString(obj.grayReleaseTargetsJson, "/grayReleaseTargetsJson"),
      feedbackMetricDefinitionsJson: validateJsonString(obj.feedbackMetricDefinitionsJson, "/feedbackMetricDefinitionsJson"),
      translationStatus: assertEnum(TRANSLATION_STATUSES, obj.translationStatus, "/translationStatus"),
      confirmedAt: null, confirmedByActorId: null,
    });
    return { id: row.translation_id, data: row };
  },
);

export const handleRecordS32Deployment = makeClosureStageHandler(
  "closure.record_s32_deployment", "ClosureStageFact",
  ["downstreamSystem", "deploymentTicketRef", "grayConfigJson", "rollbackPath", "deploymentStatus"],
  ["downstreamSystem", "deploymentTicketRef", "grayConfigJson", "rollbackPath", "deploymentStatus"],
  (db, obj, ctx) => {
    const cycleId = ctx.pathParams.closureCycleId!;
    const row = recordS32Deployment(db, {
      deploymentId: crypto.randomUUID(), closureCycleId: cycleId, workspaceId: ctx.workspaceId,
      downstreamSystem: assertEnum(DOWNSTREAM_SYSTEMS, obj.downstreamSystem, "/downstreamSystem"),
      deploymentTicketRef: validateNonEmptyString(obj.deploymentTicketRef, "/deploymentTicketRef"),
      grayConfigJson: validateJsonString(obj.grayConfigJson, "/grayConfigJson"),
      rollbackPath: validateNonEmptyString(obj.rollbackPath, "/rollbackPath"),
      deploymentStatus: assertEnum(DEPLOYMENT_STATUSES, obj.deploymentStatus, "/deploymentStatus"),
      confirmedAt: null, confirmedByActorId: null,
    });
    return { id: row.deployment_id, data: row };
  },
);

export const handleRecordS33Execution = makeClosureStageHandler(
  "closure.record_s33_execution", "ClosureStageFact",
  ["businessScopeJson", "ownerRole", "executionWindowStart", "executionWindowEnd", "actionVersion", "feedbackSource", "touchedPopulation", "executionLogRef"],
  ["businessScopeJson", "ownerRole", "executionWindowStart", "executionWindowEnd", "actionVersion", "feedbackSource"],
  (db, obj, ctx) => {
    const cycleId = ctx.pathParams.closureCycleId!;
    const row = recordS33Execution(db, {
      executionId: crypto.randomUUID(), closureCycleId: cycleId, workspaceId: ctx.workspaceId,
      businessScopeJson: validateJsonString(obj.businessScopeJson, "/businessScopeJson"),
      ownerRole: validateNonEmptyString(obj.ownerRole, "/ownerRole"),
      executionWindowStart: validateNonEmptyString(obj.executionWindowStart, "/executionWindowStart"),
      executionWindowEnd: validateNonEmptyString(obj.executionWindowEnd, "/executionWindowEnd"),
      actionVersion: validateNonEmptyString(obj.actionVersion, "/actionVersion"),
      touchedPopulation: obj.touchedPopulation != null ? (typeof obj.touchedPopulation === "number" ? obj.touchedPopulation : null) : null,
      executionLogRef: obj.executionLogRef != null ? String(obj.executionLogRef) : null,
      feedbackSource: assertEnum(FEEDBACK_SOURCES, obj.feedbackSource, "/feedbackSource"),
    });
    return { id: row.execution_id, data: row };
  },
);

export const handleAppendS34Feedback = makeClosureStageHandler(
  "closure.append_s34_feedback", "ClosureStageFact",
  ["feedbackOrdinal", "feedbackDatasetRef", "metricsJson", "statisticalSignificance", "antigravityReviewStatus", "piHandoffRef", "reviewedAt", "reviewedByActorId"],
  ["feedbackOrdinal", "feedbackDatasetRef", "metricsJson", "statisticalSignificance", "antigravityReviewStatus"],
  (db, obj, ctx) => {
    const cycleId = ctx.pathParams.closureCycleId!;
    const feedbackOrdinal = validatePositiveInteger(obj.feedbackOrdinal, "/feedbackOrdinal");
    const row = appendS34Feedback(db, {
      ingestionId: crypto.randomUUID(), closureCycleId: cycleId, workspaceId: ctx.workspaceId,
      feedbackOrdinal,
      feedbackDatasetRef: validateNonEmptyString(obj.feedbackDatasetRef, "/feedbackDatasetRef"),
      metricsJson: validateJsonString(obj.metricsJson, "/metricsJson"),
      statisticalSignificance: assertEnum(SIGNIFICANCE_STATUSES, obj.statisticalSignificance, "/statisticalSignificance"),
      piHandoffRef: obj.piHandoffRef != null ? String(obj.piHandoffRef) : null,
      antigravityReviewStatus: assertEnum(REVIEW_STATUSES, obj.antigravityReviewStatus, "/antigravityReviewStatus"),
      reviewedAt: obj.reviewedAt != null ? String(obj.reviewedAt) : null,
      reviewedByActorId: obj.reviewedByActorId != null ? String(obj.reviewedByActorId) : null,
    });
    return { id: row.ingestion_id, data: row };
  },
);

export const handleRecordS35Evaluation = makeClosureStageHandler(
  "closure.record_s35_evaluation", "ClosureStageFact",
  ["evaluationReportRef", "evaluationReportSha256", "deviationAnalysisJson", "hypothesisResult", "effectivenessRating"],
  ["evaluationReportRef", "evaluationReportSha256", "deviationAnalysisJson", "hypothesisResult", "effectivenessRating"],
  (db, obj, ctx) => {
    const cycleId = ctx.pathParams.closureCycleId!;
    const row = recordS35Evaluation(db, {
      evaluationId: crypto.randomUUID(), closureCycleId: cycleId, workspaceId: ctx.workspaceId,
      evaluationReportRef: validateNonEmptyString(obj.evaluationReportRef, "/evaluationReportRef"),
      evaluationReportSha256: validateSha256(obj.evaluationReportSha256, "/evaluationReportSha256"),
      deviationAnalysisJson: validateJsonString(obj.deviationAnalysisJson, "/deviationAnalysisJson"),
      hypothesisResult: assertEnum(HYPOTHESIS_RESULTS, obj.hypothesisResult, "/hypothesisResult"),
      effectivenessRating: assertEnum(EFFECTIVENESS_RATINGS, obj.effectivenessRating, "/effectivenessRating"),
      reviewerActorId: ctx.actorContext.actorId, reviewedAt: now(),
    });
    return { id: row.evaluation_id, data: row };
  },
);

export const handleRecordS36Trigger = makeClosureStageHandler(
  "closure.record_s36_trigger", "ClosureStageFact",
  ["branch", "targetState", "successorProjectId", "workOrderRef", "knowledgeBaseUpdateRef"],
  ["branch"],
  (db, obj, ctx) => {
    const cycleId = ctx.pathParams.closureCycleId!;
    const branch = assertEnum(ITERATION_BRANCHES, obj.branch, "/branch");
    const targetState = obj.targetState != null ? assertEnum(TARGET_STATES, obj.targetState, "/targetState") : null;
    const row = recordS36Trigger(db, {
      triggerId: crypto.randomUUID(), closureCycleId: cycleId, workspaceId: ctx.workspaceId,
      branch: branch as "archive" | "iterate",
      targetState: targetState as "S1.1" | "S2.3" | null,
      successorProjectId: obj.successorProjectId != null ? String(obj.successorProjectId) : null,
      workOrderRef: obj.workOrderRef != null ? String(obj.workOrderRef) : null,
      knowledgeBaseUpdateRef: obj.knowledgeBaseUpdateRef != null ? String(obj.knowledgeBaseUpdateRef) : null,
      triggeredAt: now(), triggeredByActorId: ctx.actorContext.actorId,
    });
    return { id: row.trigger_id, data: row };
  },
);

// ---------------------------------------------------------------------------
// Closure read routes (not idempotent — read-only)
// ---------------------------------------------------------------------------

export async function handleClosureDetail(ctx: RequestContext): Promise<void> {
  const cycleId = validateUuidPathParam(ctx.pathParams.closureCycleId, "closureCycleId");
  const result = queryClosureDetail({ db: ctx.db, workspaceId: ctx.workspaceId, closureCycleId: cycleId });
  sendJson(ctx.res, 200, { requestId: ctx.requestId, ...result }, { requestId: ctx.requestId });
}

export async function handleClosureList(ctx: RequestContext): Promise<void> {
  const projectId = validateUuidPathParam(ctx.pathParams.projectId, "projectId");
  const result = queryClosureList({ db: ctx.db, workspaceId: ctx.workspaceId, analysisProjectId: projectId });
  sendJson(ctx.res, 200, { requestId: ctx.requestId, ...result }, { requestId: ctx.requestId });
}
