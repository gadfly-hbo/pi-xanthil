/**
 * Shared ReadModel DTOs - Contract §7.8 / API-057.
 *
 * Seven non-materialized ReadModels share these public DTOs. Each DTO carries
 * identity/hash/schema/time and controlled relation summaries with consistent
 * null/array semantics. Fields always appear; nullable uses null; arrays use [].
 *
 * Safety (§7.8 / §8):
 * - EvidenceRef never carries storageRef; contentHref only when authorized.
 * - RunRef never carries piSessionRef.
 * - SourceRef never carries adapter path.
 * - GateRef uses historical actor display snapshot.
 * - availableCommands is UI guidance only; execution re-validates.
 *
 * Phase 1 (T0003) implements ProjectListReadModel and ProjectDetailReadModel;
 * the remaining five ReadModels reuse these DTOs in later tasks.
 */

import type {
  ProjectKind,
  ProjectStatus,
  AnalysisStage,
  RunStatus,
} from "./registries.ts";

// ---------------------------------------------------------------------------
// ActorRef
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
// EvidenceRef
// ---------------------------------------------------------------------------

export interface EvidenceRef {
  readonly evidenceArtifactId: string;
  readonly displayName: string;
  readonly artifactKind: string;
  readonly safetyClass: "restricted_raw" | "controlled" | "derived";
  readonly visibility: "user_visible" | "review_only" | "system_only";
  readonly mediaType: string;
  readonly byteSize: number;
  readonly contentSha256: string;
  readonly createdAt: string;
  /** Only present when the current actor is authorized to read content. */
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
  readonly gateType:
    | "requirement_confirmation"
    | "plan_confirmation"
    | "report_review";
  readonly targetObjectType:
    | "structured_requirement_version"
    | "analysis_plan_version"
    | "report_version";
  readonly targetObjectId: string;
  readonly decision: "approved" | "changes_requested" | "rejected";
  readonly decidedAt: string;
  /** Historical actor display snapshot, not the current displayName. */
  readonly decidedBy: ActorRef;
}

// ---------------------------------------------------------------------------
// RunRef
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
// Eligibility
// ---------------------------------------------------------------------------

export interface Eligibility {
  readonly eligible: boolean;
  /** Stable reason codes when not eligible; empty when eligible. */
  readonly reasons: readonly string[];
}

// ---------------------------------------------------------------------------
// CommandAffordance
// ---------------------------------------------------------------------------

export interface CommandAffordance {
  readonly commandType: string;
  /** UI guidance only; execution re-validates against current state. */
  readonly available: boolean;
  readonly unavailableReasons: readonly string[];
}

// ---------------------------------------------------------------------------
// ReadModel envelope
// ---------------------------------------------------------------------------

export interface ReadModelEnvelope<T> {
  readonly readModelVersion: string;
  readonly generatedAt: string;
  readonly data: T;
}

// ---------------------------------------------------------------------------
// Pagination (ProjectList)
// ---------------------------------------------------------------------------

export interface CursorPagination {
  readonly items: readonly unknown[];
  readonly nextCursor: string | null;
  readonly hasMore: boolean;
  readonly limit: number;
}
