/**
 * S3.x Business Closure application service (T0020).
 *
 * Typed command services for S3.1-S3.6 closure lifecycle. Each service
 * validates inputs, delegates to persistence helpers, and returns the created
 * row. Idempotent HTTP wrappers are T0019c scope.
 *
 * Authority: docs/workcanger-s3-business-closure-structure-ledger.md §20 C1R/C2R.
 * Contract: docs/workcanger-absorption-contract.md WCA-09.
 */
import type { DatabaseSync } from "node:sqlite";
import { ApplicationError } from "../../contracts/envelope.ts";
import type {
  InitiateClosureCycleInput,
  RecordS31TranslationInput,
  RecordS32DeploymentInput,
  RecordS33ExecutionInput,
  AppendS34FeedbackInput,
  RecordS35EvaluationInput,
  RecordS36TriggerInput,
} from "../../contracts/closure.ts";
import {
  insertClosureCycle, getClosureCycleById, type ClosureCycleRow,
  insertS31Translation, getS31Translation, type S31TranslationRow,
  insertS32Deployment, getS32Deployment, type S32DeploymentRow,
  insertS33Execution, getS33Execution, type S33ExecutionRow,
  insertS34Ingestion, getS34IngestionById, type S34IngestionRow,
  insertS35Evaluation, getS35Evaluation, type S35EvaluationRow,
  insertS36Trigger, getS36Trigger, type S36TriggerRow,
} from "../../persistence/closure-queries.ts";
import { now, uuid } from "../shared/runtime.ts";

// ---------------------------------------------------------------------------
// Closure cycle
// ---------------------------------------------------------------------------

export function initiateClosureCycle(
  db: DatabaseSync,
  input: InitiateClosureCycleInput,
): ClosureCycleRow {
  return insertClosureCycle(db, {
    closureCycleId: input.closureCycleId,
    analysisProjectId: input.analysisProjectId,
    workspaceId: input.workspaceId,
    lockedReportVersionId: input.lockedReportVersionId,
    closureOrdinal: input.closureOrdinal,
    cycleStatus: "initiated",
    currentStage: null,
    initiatedAt: now(),
    initiatedByActorId: input.initiatedByActorId,
    updatedAt: now(),
  });
}

// ---------------------------------------------------------------------------
// S3.1 conclusion_translation
// ---------------------------------------------------------------------------

export function recordS31Translation(
  db: DatabaseSync,
  input: RecordS31TranslationInput,
): S31TranslationRow {
  return insertS31Translation(db, {
    translationId: input.translationId,
    closureCycleId: input.closureCycleId,
    workspaceId: input.workspaceId,
    businessActionArtifactRef: input.businessActionArtifactRef,
    businessActionContentSha256: input.businessActionContentSha256,
    selectedRecommendationsJson: input.selectedRecommendationsJson,
    businessRulesJson: input.businessRulesJson,
    thresholdsJson: input.thresholdsJson,
    segmentsJson: input.segmentsJson,
    grayReleaseTargetsJson: input.grayReleaseTargetsJson,
    feedbackMetricDefinitionsJson: input.feedbackMetricDefinitionsJson,
    translationStatus: input.translationStatus,
    confirmedAt: input.confirmedAt,
    confirmedByActorId: input.confirmedByActorId,
    createdAt: now(),
    updatedAt: now(),
  });
}

// ---------------------------------------------------------------------------
// S3.2 system_deployment
// ---------------------------------------------------------------------------

export function recordS32Deployment(
  db: DatabaseSync,
  input: RecordS32DeploymentInput,
): S32DeploymentRow {
  return insertS32Deployment(db, {
    deploymentId: input.deploymentId,
    closureCycleId: input.closureCycleId,
    workspaceId: input.workspaceId,
    downstreamSystem: input.downstreamSystem,
    deploymentTicketRef: input.deploymentTicketRef,
    grayConfigJson: input.grayConfigJson,
    rollbackPath: input.rollbackPath,
    deploymentStatus: input.deploymentStatus,
    confirmedAt: input.confirmedAt,
    confirmedByActorId: input.confirmedByActorId,
    createdAt: now(),
    updatedAt: now(),
  });
}

// ---------------------------------------------------------------------------
// S3.3 business_execution
// ---------------------------------------------------------------------------

export function recordS33Execution(
  db: DatabaseSync,
  input: RecordS33ExecutionInput,
): S33ExecutionRow {
  return insertS33Execution(db, {
    executionId: input.executionId,
    closureCycleId: input.closureCycleId,
    workspaceId: input.workspaceId,
    businessScopeJson: input.businessScopeJson,
    ownerRole: input.ownerRole,
    executionWindowStart: input.executionWindowStart,
    executionWindowEnd: input.executionWindowEnd,
    actionVersion: input.actionVersion,
    touchedPopulation: input.touchedPopulation,
    executionLogRef: input.executionLogRef,
    feedbackSource: input.feedbackSource,
    createdAt: now(),
    updatedAt: now(),
  });
}

// ---------------------------------------------------------------------------
// S3.4 feedback_ingestion (append-only, C6)
// ---------------------------------------------------------------------------

export function appendS34Feedback(
  db: DatabaseSync,
  input: AppendS34FeedbackInput,
): S34IngestionRow {
  return insertS34Ingestion(db, {
    ingestionId: input.ingestionId,
    closureCycleId: input.closureCycleId,
    workspaceId: input.workspaceId,
    feedbackOrdinal: input.feedbackOrdinal,
    feedbackDatasetRef: input.feedbackDatasetRef,
    metricsJson: input.metricsJson,
    statisticalSignificance: input.statisticalSignificance,
    piHandoffRef: input.piHandoffRef,
    antigravityReviewStatus: input.antigravityReviewStatus,
    reviewedAt: input.reviewedAt,
    reviewedByActorId: input.reviewedByActorId,
    createdAt: now(),
    updatedAt: now(),
  });
}

// ---------------------------------------------------------------------------
// S3.5 effect_evaluation
// ---------------------------------------------------------------------------

export function recordS35Evaluation(
  db: DatabaseSync,
  input: RecordS35EvaluationInput,
): S35EvaluationRow {
  return insertS35Evaluation(db, {
    evaluationId: input.evaluationId,
    closureCycleId: input.closureCycleId,
    workspaceId: input.workspaceId,
    evaluationReportRef: input.evaluationReportRef,
    evaluationReportSha256: input.evaluationReportSha256,
    deviationAnalysisJson: input.deviationAnalysisJson,
    hypothesisResult: input.hypothesisResult,
    effectivenessRating: input.effectivenessRating,
    reviewerActorId: input.reviewerActorId,
    reviewedAt: input.reviewedAt,
    createdAt: now(),
    updatedAt: now(),
  });
}

// ---------------------------------------------------------------------------
// S3.6 iteration_trigger
// ---------------------------------------------------------------------------

export function recordS36Trigger(
  db: DatabaseSync,
  input: RecordS36TriggerInput,
): S36TriggerRow {
  return insertS36Trigger(db, {
    triggerId: input.triggerId,
    closureCycleId: input.closureCycleId,
    workspaceId: input.workspaceId,
    branch: input.branch,
    targetState: input.targetState,
    successorProjectId: input.successorProjectId,
    workOrderRef: input.workOrderRef,
    knowledgeBaseUpdateRef: input.knowledgeBaseUpdateRef,
    triggeredAt: input.triggeredAt,
    triggeredByActorId: input.triggeredByActorId,
    createdAt: now(),
    updatedAt: now(),
  });
}
