// Client-side DTO types mirroring server/src/analysis-projects/contracts/dto.ts
// and registries.ts. These are read-only display types; no mutation logic.

// ---------------------------------------------------------------------------
// Registry enums (mirrors server registries.ts)
// ---------------------------------------------------------------------------

export type ProjectKind = "goal_decomposition" | "daily_analysis" | "topic_research";
export type ProjectStatus = "active" | "completed" | "rejected" | "cancelled";
export type ProjectStage =
  | "S1.1" | "S1.2" | "S1.4"
  | "S2.1" | "S2.2" | "S2.3" | "S2.4"
  | "S2.5" | "S2.6"
  | "S3.1" | "S3.2" | "S3.3" | "S3.4" | "S3.5" | "S3.6";
export type RunStatus = "queued" | "running" | "succeeded" | "failed" | "aborted" | "blocked";
export type AnalysisStage = "S2.1" | "S2.2" | "S2.3" | "S2.4";
export type GateType = "requirement_confirmation" | "plan_confirmation" | "report_review";
export type GateDecision = "approved" | "changes_requested" | "rejected";
export type SafetyClass = "restricted_raw" | "controlled" | "derived";

// ---------------------------------------------------------------------------
// Actor / identity
// ---------------------------------------------------------------------------

export interface ActorRef {
  readonly actorId: string;
  readonly actorKind: "human" | "system" | "agent";
  readonly displayName: string;
}

// ---------------------------------------------------------------------------
// ProjectRef
// ---------------------------------------------------------------------------

export interface ProjectRef {
  readonly projectId: string;
  readonly kind: ProjectKind;
  readonly title: string;
  readonly slug: string;
  readonly status: ProjectStatus;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly archivedAt: string | null;
}

// ---------------------------------------------------------------------------
// VersionRef (Requirement / Plan / Report)
// ---------------------------------------------------------------------------

export interface VersionRef {
  readonly versionId: string;
  readonly versionOrdinal: number;
  readonly schemaVersion: string;
  readonly contentSha256: string;
  readonly createdAt: string;
  readonly createdBy: ActorRef;
  readonly supersedesVersionId: string | null;
}

// ---------------------------------------------------------------------------
// EvidenceRef (never carries storageRef or raw content)
// ---------------------------------------------------------------------------

export interface EvidenceRef {
  readonly evidenceArtifactId: string;
  readonly displayName: string;
  readonly artifactKind: string;
  readonly safetyClass: SafetyClass;
  readonly visibility: "user_visible" | "review_only" | "system_only";
  readonly mediaType: string;
  readonly byteSize: number;
  readonly contentSha256: string;
  readonly createdAt: string;
  readonly contentHref: string | null;
}

// ---------------------------------------------------------------------------
// SourceRef
// ---------------------------------------------------------------------------

export interface SourceRef {
  readonly sourceReferenceId: string;
  readonly sourceKind: "user_provided" | "agentharness";
  readonly displayName: string;
  readonly description: string;
  readonly declaredDataScope: string;
  readonly safetyHandlingPolicy:
    | "local_transform_required"
    | "controlled_or_derived_allowed"
    | "derived_only_allowed";
  readonly archivedAt: string | null;
  readonly createdAt: string;
}

// ---------------------------------------------------------------------------
// GateRef
// ---------------------------------------------------------------------------

export interface GateRef {
  readonly gateDecisionId: string;
  readonly gateType: GateType;
  readonly targetObjectType:
    | "structured_requirement_version"
    | "analysis_plan_version"
    | "report_version";
  readonly targetObjectId: string;
  readonly decision: GateDecision;
  readonly decidedAt: string;
  readonly decidedBy: ActorRef;
}

// ---------------------------------------------------------------------------
// RunRef (never carries piSessionRef)
// ---------------------------------------------------------------------------

export interface RunRef {
  readonly runId: string;
  readonly runOrdinal: number;
  readonly currentAnalysisStage: AnalysisStage;
  readonly currentRunStatus: RunStatus;
  readonly queuedAt: string;
  readonly startedAt: string | null;
  readonly endedAt: string | null;
  readonly triggeredBy: ActorRef;
}

// ---------------------------------------------------------------------------
// ReportRef
// ---------------------------------------------------------------------------

export interface ReportRef {
  readonly reportVersionId: string;
  readonly versionOrdinal: number;
  readonly schemaVersion: string;
  readonly contentSha256: string;
  readonly createdAt: string;
  readonly createdBy: ActorRef;
}

// ---------------------------------------------------------------------------
// CommandAffordance
// ---------------------------------------------------------------------------

export interface CommandAffordance {
  readonly commandType: string;
  readonly available: boolean;
  readonly unavailableReasons: readonly string[];
}

// ---------------------------------------------------------------------------
// ProjectListReadModel
// ---------------------------------------------------------------------------

export interface ProjectListItem {
  readonly projectId: string;
  readonly kind: ProjectKind;
  readonly title: string;
  readonly slug: string;
  readonly status: ProjectStatus;
  readonly stage: string;
  readonly pendingGate: GateType | null;
  readonly latestRun: {
    readonly runId: string;
    readonly runOrdinal: number;
    readonly currentRunStatus: string;
    readonly currentAnalysisStage: string;
  } | null;
  readonly lockedReportId: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly archivedAt: string | null;
  readonly availableCommands: readonly CommandAffordance[];
}

export interface ProjectListData {
  readonly items: readonly ProjectListItem[];
  readonly nextCursor: string | null;
  readonly hasMore: boolean;
  readonly limit: number;
}

export interface ProjectListReadModel {
  readonly readModelVersion: string;
  readonly generatedAt: string;
  readonly data: ProjectListData;
}

// ---------------------------------------------------------------------------
// ProjectDetailReadModel
// ---------------------------------------------------------------------------

export interface ProjectDetailProject {
  readonly projectId: string;
  readonly kind: string;
  readonly title: string;
  readonly slug: string;
  readonly status: string;
  readonly stage: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly completedAt: string | null;
  readonly rejectedAt: string | null;
  readonly cancelledAt: string | null;
  readonly archivedAt: string | null;
  readonly sourceProjectId: string | null;
  readonly sourceRelationType: string | null;
}

export interface AnalysisRequestSummary {
  readonly analysisRequestId: string;
  readonly rawRequestText: string;
  readonly locale: string;
  readonly timezone: string;
  readonly submittedAt: string;
}

export interface SourceWithCheck extends SourceRef {
  readonly latestCheck: {
    readonly availabilityStatus: string;
    readonly checkedAt: string;
  } | null;
}

export interface ProjectDetailData {
  readonly project: ProjectDetailProject;
  readonly analysisRequest: AnalysisRequestSummary | null;
  readonly inputEvidence: readonly EvidenceRef[];
  readonly sources: readonly SourceWithCheck[];
  readonly currentRequirement: VersionRef | null;
  readonly currentPlan: VersionRef | null;
  readonly latestRun: RunRef | null;
  readonly latestReport: ReportRef | null;
  readonly lockedReportId: string | null;
  readonly pendingGate: GateType | null;
  readonly availableCommands: readonly CommandAffordance[];
}

export interface ProjectDetailReadModel {
  readonly readModelVersion: string;
  readonly generatedAt: string;
  readonly data: ProjectDetailData;
}

// ---------------------------------------------------------------------------
// Capabilities response
// ---------------------------------------------------------------------------

export interface AgentHarnessCapability {
  readonly capabilityId: string;
  readonly contractVersion: string;
  readonly displayName: string;
  readonly allowedSafetyClasses: readonly string[];
  readonly readOnly: boolean;
}

export interface CapabilitiesData {
  readonly version: string;
  readonly apiVersion: string;
  readonly appVersion: string;
  readonly enabledDailyKinds: readonly string[];
  readonly supportedSchemaVersions: readonly string[];
  readonly sourceCapabilities: {
    readonly user: readonly { readonly kind: string; readonly scope: string; readonly artifactKind: string }[];
    readonly agentHarness: readonly AgentHarnessCapability[];
  };
  readonly engine: {
    readonly status: "available" | "unavailable";
    readonly adapter?: string;
    readonly reason?: string;
  };
  readonly upload: {
    readonly maxBytes: number;
    readonly allowedMediaTypes: readonly string[];
    readonly tmpAvailable: boolean;
  };
  readonly representationFormats: readonly unknown[];
  readonly exportContracts: readonly unknown[];
}

export interface CapabilitiesResponse {
  readonly schemaVersion: string;
  readonly requestId: string;
  readonly data: CapabilitiesData;
}

// ---------------------------------------------------------------------------
// Success/Error envelope
// ---------------------------------------------------------------------------

export interface SuccessEnvelope<T> {
  readonly schemaVersion: string;
  readonly requestId: string;
  readonly data: T;
}

export interface ApiErrorDetail {
  readonly code: string;
  readonly summary: string;
  readonly fieldErrors: readonly { readonly fieldPath: string; readonly code: string; readonly summary: string }[];
  readonly retryDirective: string;
  readonly diagnosticEvidenceArtifactId: string | null;
}

export interface ErrorEnvelope {
  readonly schemaVersion: string;
  readonly requestId: string;
  readonly error: ApiErrorDetail;
}

// ---------------------------------------------------------------------------
// S3.x Business Closure types (mirrors server contracts/closure.ts)
// ---------------------------------------------------------------------------

export type ClosureCycleStatus = "initiated" | "in_progress" | "archived" | "iterating";
export type ClosureStage = "S3.1" | "S3.2" | "S3.3" | "S3.4" | "S3.5" | "S3.6";

export type TranslationStatus = "draft" | "confirmed";
export type DownstreamSystem = "cdp_tag_engine" | "marketing_automation" | "bi_reports" | "other";
export type DeploymentStatus = "pending" | "test_verified" | "gray_verified" | "fully_deployed" | "failed" | "rolled_back";
export type FeedbackSource = "execution_log" | "conversion_data" | "tag_hit_log" | "combined";
export type SignificanceStatus = "not_reached" | "reached" | "pending";
export type ReviewStatus = "pending" | "passed" | "rejected";
export type HypothesisResult = "confirmed" | "rejected" | "inconclusive";
export type EffectivenessRating = "met_expectations" | "significant_deviation" | "warning";
export type IterationBranch = "archive" | "iterate";
export type TargetState = "S1.1" | "S2.3";

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

export interface ClosureDetailReadModel {
  readonly readModelVersion: string;
  readonly generatedAt: string;
  readonly data: ClosureDetailData;
}

export interface ClosureListReadModel {
  readonly readModelVersion: string;
  readonly generatedAt: string;
  readonly data: readonly ClosureCycleRef[];
}

// ---------------------------------------------------------------------------
// Closure command result (normalized from backend success/error envelopes)
// ---------------------------------------------------------------------------

export interface ClosureCommandResult {
  readonly kind: "executed" | "replayed_success" | "in_progress" | "conflict" | "failed";
  readonly data?: unknown;
  readonly recordId?: string;
  readonly resultResourceType?: string;
  readonly resultResourceId?: string;
  readonly errorCode?: string;
  readonly errorSummary?: string;
  readonly fieldErrors?: readonly { readonly fieldPath: string; readonly code: string; readonly summary: string }[];
}
