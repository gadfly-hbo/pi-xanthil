/**
 * S3.x Business Closure contracts (T0020).
 *
 * Typed command/input contracts and stage enums for S3.1-S3.6 Business Closure
 * lifecycle, consumed by application services and read models.
 *
 * Authority: docs/workcanger-s3-business-closure-structure-ledger.md §20 C1R/C2R
 * + C3-C10.
 *
 * Closure command types are registered in COMMAND_TYPES (registries.ts) for
 * idempotency support. Result resource types include ClosureCycle and
 * ClosureStageFact.
 */

// ---------------------------------------------------------------------------
// Closure cycle enums
// ---------------------------------------------------------------------------

export const CLOSURE_CYCLE_STATUSES = ["initiated", "in_progress", "archived", "iterating"] as const;
export type ClosureCycleStatus = (typeof CLOSURE_CYCLE_STATUSES)[number];

export const CLOSURE_STAGES = ["S3.1", "S3.2", "S3.3", "S3.4", "S3.5", "S3.6"] as const;
export type ClosureStage = (typeof CLOSURE_STAGES)[number];

// ---------------------------------------------------------------------------
// S3.1 enums
// ---------------------------------------------------------------------------

export const TRANSLATION_STATUSES = ["draft", "confirmed"] as const;
export type TranslationStatus = (typeof TRANSLATION_STATUSES)[number];

// ---------------------------------------------------------------------------
// S3.2 enums
// ---------------------------------------------------------------------------

export const DOWNSTREAM_SYSTEMS = ["cdp_tag_engine", "marketing_automation", "bi_reports", "other"] as const;
export type DownstreamSystem = (typeof DOWNSTREAM_SYSTEMS)[number];

export const DEPLOYMENT_STATUSES = ["pending", "test_verified", "gray_verified", "fully_deployed", "failed", "rolled_back"] as const;
export type DeploymentStatus = (typeof DEPLOYMENT_STATUSES)[number];

// ---------------------------------------------------------------------------
// S3.3 enums
// ---------------------------------------------------------------------------

export const FEEDBACK_SOURCES = ["execution_log", "conversion_data", "tag_hit_log", "combined"] as const;
export type FeedbackSource = (typeof FEEDBACK_SOURCES)[number];

// ---------------------------------------------------------------------------
// S3.4 enums (append-only feedback, C6)
// ---------------------------------------------------------------------------

export const SIGNIFICANCE_STATUSES = ["not_reached", "reached", "pending"] as const;
export type SignificanceStatus = (typeof SIGNIFICANCE_STATUSES)[number];

export const REVIEW_STATUSES = ["pending", "passed", "rejected"] as const;
export type ReviewStatus = (typeof REVIEW_STATUSES)[number];

// ---------------------------------------------------------------------------
// S3.5 enums
// ---------------------------------------------------------------------------

export const HYPOTHESIS_RESULTS = ["confirmed", "rejected", "inconclusive"] as const;
export type HypothesisResult = (typeof HYPOTHESIS_RESULTS)[number];

export const EFFECTIVENESS_RATINGS = ["met_expectations", "significant_deviation", "warning"] as const;
export type EffectivenessRating = (typeof EFFECTIVENESS_RATINGS)[number];

// ---------------------------------------------------------------------------
// S3.6 enums
// ---------------------------------------------------------------------------

export const ITERATION_BRANCHES = ["archive", "iterate"] as const;
export type IterationBranch = (typeof ITERATION_BRANCHES)[number];

export const TARGET_STATES = ["S1.1", "S2.3"] as const;
export type TargetState = (typeof TARGET_STATES)[number];

// ---------------------------------------------------------------------------
// Closure command input contracts
// ---------------------------------------------------------------------------

export interface InitiateClosureCycleInput {
  readonly closureCycleId: string;
  readonly analysisProjectId: string;
  readonly workspaceId: string;
  readonly lockedReportVersionId: string;
  readonly closureOrdinal: number;
  readonly initiatedByActorId: string;
}

export interface RecordS31TranslationInput {
  readonly translationId: string;
  readonly closureCycleId: string;
  readonly workspaceId: string;
  readonly businessActionArtifactRef: string;
  readonly businessActionContentSha256: string;
  readonly selectedRecommendationsJson: string;
  readonly businessRulesJson: string;
  readonly thresholdsJson: string;
  readonly segmentsJson: string;
  readonly grayReleaseTargetsJson: string;
  readonly feedbackMetricDefinitionsJson: string;
  readonly translationStatus: TranslationStatus;
  readonly confirmedAt: string | null;
  readonly confirmedByActorId: string | null;
}

export interface RecordS32DeploymentInput {
  readonly deploymentId: string;
  readonly closureCycleId: string;
  readonly workspaceId: string;
  readonly downstreamSystem: DownstreamSystem;
  readonly deploymentTicketRef: string;
  readonly grayConfigJson: string;
  readonly rollbackPath: string;
  readonly deploymentStatus: DeploymentStatus;
  readonly confirmedAt: string | null;
  readonly confirmedByActorId: string | null;
}

export interface RecordS33ExecutionInput {
  readonly executionId: string;
  readonly closureCycleId: string;
  readonly workspaceId: string;
  readonly businessScopeJson: string;
  readonly ownerRole: string;
  readonly executionWindowStart: string;
  readonly executionWindowEnd: string;
  readonly actionVersion: string;
  readonly touchedPopulation: number | null;
  readonly executionLogRef: string | null;
  readonly feedbackSource: FeedbackSource;
}

export interface AppendS34FeedbackInput {
  readonly ingestionId: string;
  readonly closureCycleId: string;
  readonly workspaceId: string;
  readonly feedbackOrdinal: number;
  readonly feedbackDatasetRef: string;
  readonly metricsJson: string;
  readonly statisticalSignificance: SignificanceStatus;
  readonly piHandoffRef: string | null;
  readonly antigravityReviewStatus: ReviewStatus;
  readonly reviewedAt: string | null;
  readonly reviewedByActorId: string | null;
}

export interface RecordS35EvaluationInput {
  readonly evaluationId: string;
  readonly closureCycleId: string;
  readonly workspaceId: string;
  readonly evaluationReportRef: string;
  readonly evaluationReportSha256: string;
  readonly deviationAnalysisJson: string;
  readonly hypothesisResult: HypothesisResult;
  readonly effectivenessRating: EffectivenessRating;
  readonly reviewerActorId: string;
  readonly reviewedAt: string;
}

export interface RecordS36TriggerInput {
  readonly triggerId: string;
  readonly closureCycleId: string;
  readonly workspaceId: string;
  readonly branch: IterationBranch;
  readonly targetState: TargetState | null;
  readonly successorProjectId: string | null;
  readonly workOrderRef: string | null;
  readonly knowledgeBaseUpdateRef: string | null;
  readonly triggeredAt: string;
  readonly triggeredByActorId: string;
}

// ---------------------------------------------------------------------------
// Closure read model DTOs
// ---------------------------------------------------------------------------

export interface ClosureCycleRef {
  readonly closureCycleId: string;
  readonly analysisProjectId: string;
  readonly closureOrdinal: number;
  readonly cycleStatus: ClosureCycleStatus;
  readonly currentStage: ClosureStage | null;
  readonly initiatedAt: string;
  readonly initiatedByActorId: string;
  readonly updatedAt: string;
}

export interface S31FactRef {
  readonly translationId: string;
  readonly businessActionArtifactRef: string;
  readonly translationStatus: TranslationStatus;
  readonly confirmedAt: string | null;
  readonly createdAt: string;
}

export interface S32FactRef {
  readonly deploymentId: string;
  readonly downstreamSystem: DownstreamSystem;
  readonly deploymentTicketRef: string;
  readonly deploymentStatus: DeploymentStatus;
  readonly confirmedAt: string | null;
  readonly createdAt: string;
}

export interface S33FactRef {
  readonly executionId: string;
  readonly ownerRole: string;
  readonly executionWindowStart: string;
  readonly executionWindowEnd: string;
  readonly feedbackSource: FeedbackSource;
  readonly createdAt: string;
}

export interface S34FactRef {
  readonly ingestionId: string;
  readonly feedbackOrdinal: number;
  readonly feedbackDatasetRef: string;
  readonly statisticalSignificance: SignificanceStatus;
  readonly antigravityReviewStatus: ReviewStatus;
  readonly createdAt: string;
}

export interface S35FactRef {
  readonly evaluationId: string;
  readonly hypothesisResult: HypothesisResult;
  readonly effectivenessRating: EffectivenessRating;
  readonly reviewedAt: string;
  readonly createdAt: string;
}

export interface S36FactRef {
  readonly triggerId: string;
  readonly branch: IterationBranch;
  readonly targetState: TargetState | null;
  readonly triggeredAt: string;
  readonly createdAt: string;
}

export interface ClosureDetailData {
  readonly cycle: ClosureCycleRef;
  readonly s31: S31FactRef | null;
  readonly s32: S32FactRef | null;
  readonly s33: S33FactRef | null;
  readonly s34: readonly S34FactRef[];
  readonly s35: S35FactRef | null;
  readonly s36: S36FactRef | null;
}
