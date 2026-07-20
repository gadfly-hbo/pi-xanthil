/**
 * RequirementReviewReadModel (§7.3, API-023).
 *
 * Non-materialized, single SQLite read snapshot.
 * - Project, Request, submitted Evidence, complete validated Requirement content.
 * - Precise Source/Evidence refs, Gate target/decision, adjacent versions,
 *   prior requested changes, commands/eligibility.
 * - Old versions read-only; only current active pending version can be decided.
 * - Does NOT return storageRef, raw prompt, raw pi event, hidden reasoning,
 *   token, absolute path, or unauthorized Evidence content.
 */
import type { DatabaseSync } from "node:sqlite";
import { ApplicationError } from "../../contracts/envelope.ts";
import { getProjectById } from "../projects/project-queries.ts";
import type { ReadModelEnvelope, CommandAffordance, EvidenceRef, GateRef, VersionRef, ActorRef, Eligibility } from "../../contracts/dto.ts";
import type { TrustedActorContext } from "../shared/runtime.ts";
import type { StructuredRequirementContent } from "../requirements/requirement-service.ts";
import { getRequirementVersionById } from "../requirements/requirement-service.ts";
import { getActorById } from "../actors/actor-service.ts";
import { readBlob, blobAbsolutePath } from "../../persistence/blob-writer.ts";
import { canonicalJsonStringify } from "../../persistence/canonical-json.ts";
import type { DataRootLayout } from "../../persistence/data-root.ts";

const READ_MODEL_VERSION = "1.0";

export interface RequirementReviewData {
  readonly project: {
    readonly projectId: string;
    readonly kind: string;
    readonly title: string;
    readonly slug: string;
    readonly status: string;
    readonly createdAt: string;
    readonly updatedAt: string;
  };
  readonly analysisRequest: {
    readonly analysisRequestId: string;
    readonly rawRequestText: string;
    readonly submittedAt: string;
    readonly locale: string;
    readonly timezone: string;
  } | null;
  readonly submittedEvidence: readonly EvidenceRef[];
  readonly requirementVersion: {
    readonly versionId: string;
    readonly versionOrdinal: number;
    readonly schemaVersion: string;
    readonly contentSha256: string;
    readonly createdAt: string;
    readonly createdBy: ActorRef;
    readonly supersedesVersionId: string | null;
  };
  readonly requirementContent: StructuredRequirementContent;
  readonly gate: GateRef | null;
  readonly gateTarget: {
    readonly schemaVersion: string;
    readonly contentSha256: string;
  };
  readonly adjacentVersions: {
    readonly previous: VersionRef | null;
    readonly next: VersionRef | null;
  };
  readonly priorRequestedChanges: readonly {
    readonly gateDecisionId: string;
    readonly decidedAt: string;
    readonly requestedChanges: readonly {
      readonly requestedChangeId: string;
      readonly summary: string;
      readonly rationale: string | null;
      readonly affectedFieldPaths: readonly string[];
    }[];
  }[];
  readonly commands: readonly CommandAffordance[];
  readonly confirmationEligibility: Eligibility;
}

export interface RequirementReviewQuery {
  readonly db: DatabaseSync;
  readonly layout: DataRootLayout;
  readonly projectId: string;
  readonly workspaceId: string;
  readonly requirementVersionId: string;
  readonly actorContext: TrustedActorContext;
  readonly authorizedForContent: boolean;
}

export function queryRequirementReview(query: RequirementReviewQuery): ReadModelEnvelope<RequirementReviewData> {
  const { db, layout, workspaceId, projectId, requirementVersionId, actorContext, authorizedForContent } = query;
  const actorActiveHuman = actorContext.actorKind === "human" && actorContext.active;

  db.exec("BEGIN");
  try {
    const project = getProjectById(db, workspaceId, projectId);
    if (!project) {
      throw new ApplicationError("resource_not_found", "Project not found.");
    }

    const reqVersion = getRequirementVersionById(db, workspaceId, requirementVersionId);
    if (!reqVersion || reqVersion.analysisProjectId !== projectId) {
      throw new ApplicationError("resource_not_found", "Requirement version not found.");
    }

    // Read requirement content from blob
    const contentBytes = readBlob(layout.blobsDir, reqVersion.storageRef);
    const contentJson = new TextDecoder().decode(contentBytes);
    const requirementContent = JSON.parse(contentJson) as StructuredRequirementContent;

    // AnalysisRequest
    const requestRow = db.prepare(
      "SELECT analysis_request_id, raw_request_text, submitted_context_evidence_ids_json, submitted_at, locale, timezone FROM analysis_requests WHERE analysis_project_id = ?"
    ).get(projectId) as { analysis_request_id: string; raw_request_text: string; submitted_context_evidence_ids_json: string; submitted_at: string; locale: string; timezone: string } | undefined;

    // Submitted Evidence only (from AnalysisRequest, preserving submitted order)
    let evidenceRows: Array<{
      evidence_artifact_id: string; display_name: string; artifact_kind: string;
      safety_class: string; visibility: string; media_type: string;
      byte_size: number; content_sha256: string; created_at: string;
    }> = [];
    if (requestRow) {
      const submittedIds: string[] = JSON.parse(requestRow.submitted_context_evidence_ids_json);
      if (submittedIds.length > 0) {
        const placeholders = submittedIds.map(() => "?").join(",");
        const allEvidence = db.prepare(
          `SELECT evidence_artifact_id, display_name, artifact_kind, safety_class, visibility, media_type, byte_size, content_sha256, created_at
           FROM evidence_artifacts WHERE evidence_artifact_id IN (${placeholders})`
        ).all(...submittedIds) as Array<{
          evidence_artifact_id: string; display_name: string; artifact_kind: string;
          safety_class: string; visibility: string; media_type: string;
          byte_size: number; content_sha256: string; created_at: string;
        }>;
        // Preserve submitted order, exclude system_only
        const evidenceMap = new Map(allEvidence.map(e => [e.evidence_artifact_id, e]));
        evidenceRows = submittedIds
          .map(id => evidenceMap.get(id))
          .filter((e): e is NonNullable<typeof e> => e !== undefined && e.visibility !== "system_only");
      }
    }

    // Gate decision for this version
    const gateRow = db.prepare(
      `SELECT gate_decision_id, decision, decided_at, decided_by_actor_id, actor_display_name_snapshot,
              target_schema_version, target_content_sha256, requested_changes_json
       FROM gate_decisions WHERE analysis_project_id = ? AND gate_type = 'requirement_confirmation' AND target_object_id = ?`
    ).get(projectId, requirementVersionId) as {
      gate_decision_id: string; decision: string; decided_at: string;
      decided_by_actor_id: string; actor_display_name_snapshot: string;
      target_schema_version: string; target_content_sha256: string;
      requested_changes_json: string | null;
    } | undefined;

    // Adjacent versions
    const prevRow = db.prepare(
      `SELECT ${REQ_VERSION_SELECT} FROM structured_requirement_versions WHERE analysis_project_id = ? AND version_ordinal = ?`
    ).get(projectId, reqVersion.versionOrdinal - 1) as RequirementVersionRowShape | undefined;

    const nextRow = db.prepare(
      `SELECT ${REQ_VERSION_SELECT} FROM structured_requirement_versions WHERE analysis_project_id = ? AND version_ordinal = ?`
    ).get(projectId, reqVersion.versionOrdinal + 1) as RequirementVersionRowShape | undefined;

    // Prior requested changes (changes_requested gates on previous versions)
    const priorGates = db.prepare(
      `SELECT gate_decision_id, decided_at, requested_changes_json
       FROM gate_decisions
       WHERE analysis_project_id = ? AND gate_type = 'requirement_confirmation' AND decision = 'changes_requested' AND target_object_id != ?
       ORDER BY decided_at ASC`
    ).all(projectId, requirementVersionId) as Array<{
      gate_decision_id: string; decided_at: string; requested_changes_json: string | null;
    }>;

    // Build creator ActorRef
    const creator = getActorById(db, reqVersion.createdByActorId);
    const creatorRef: ActorRef = {
      actorId: reqVersion.createdByActorId,
      actorKind: creator?.actorKind ?? "system",
      displayName: creator?.displayName ?? "Unknown",
    };

    // Build EvidenceRefs (no storageRef, conditional contentHref)
    const submittedEvidence: EvidenceRef[] = evidenceRows.map((e) => ({
      evidenceArtifactId: e.evidence_artifact_id,
      displayName: e.display_name,
      artifactKind: e.artifact_kind,
      safetyClass: e.safety_class as EvidenceRef["safetyClass"],
      visibility: e.visibility as EvidenceRef["visibility"],
      mediaType: e.media_type,
      byteSize: e.byte_size,
      contentSha256: e.content_sha256,
      createdAt: e.created_at,
      contentHref: authorizedForContent && e.visibility === "user_visible" && e.safety_class !== "restricted_raw"
        ? `/api/v1/projects/${projectId}/evidence/${e.evidence_artifact_id}/content`
        : null,
    }));

    // Build GateRef
    let gate: GateRef | null = null;
    if (gateRow) {
      const gateDecidedBy = getActorById(db, gateRow.decided_by_actor_id);
      gate = {
        gateDecisionId: gateRow.gate_decision_id,
        gateType: "requirement_confirmation",
        targetObjectType: "structured_requirement_version",
        targetObjectId: requirementVersionId,
        decision: gateRow.decision as GateRef["decision"],
        decidedAt: gateRow.decided_at,
        decidedBy: {
          actorId: gateRow.decided_by_actor_id,
          actorKind: gateDecidedBy?.actorKind ?? "system",
          displayName: gateRow.actor_display_name_snapshot,
        },
      };
    }

    // Adjacent versions
    const prevVersion = prevRow ? buildVersionRefFromRow(prevRow, db) : null;
    const nextVersion = nextRow ? buildVersionRefFromRow(nextRow, db) : null;

    // Prior requested changes
    const priorRequestedChanges = priorGates.map((pg) => ({
      gateDecisionId: pg.gate_decision_id,
      decidedAt: pg.decided_at,
      requestedChanges: parseRequestedChanges(pg.requested_changes_json),
    }));

    // Commands and eligibility
    const isCurrent = project.currentRequirementVersionId === requirementVersionId;
    const hasGate = gate !== null;
    const canDecide = isCurrent && !hasGate && actorActiveHuman && project.projectStatus === "active";

    const commands: CommandAffordance[] = [];
    if (canDecide) {
      commands.push({ commandType: "requirement.decide_confirmation", available: true, unavailableReasons: [] });
    } else {
      const reasons: string[] = [];
      if (!isCurrent) reasons.push("version_not_current");
      if (hasGate) reasons.push("gate_already_decided");
      if (!actorActiveHuman) reasons.push("actor_not_active_human");
      if (project.projectStatus !== "active") reasons.push("project_not_active");
      commands.push({ commandType: "requirement.decide_confirmation", available: false, unavailableReasons: reasons });
    }

    const confirmationEligibility: Eligibility = {
      eligible: canDecide,
      reasons: canDecide ? [] : (() => {
        const r: string[] = [];
        if (!isCurrent) r.push("version_not_current");
        if (hasGate) r.push("gate_already_decided");
        if (!actorActiveHuman) r.push("actor_not_active_human");
        if (project.projectStatus !== "active") r.push("project_not_active");
        return r;
      })(),
    };

    db.exec("COMMIT");

    const data: RequirementReviewData = {
      project: {
        projectId: project.analysisProjectId,
        kind: project.projectKind,
        title: project.title,
        slug: project.slug,
        status: project.projectStatus,
        createdAt: project.createdAt,
        updatedAt: project.updatedAt,
      },
      analysisRequest: requestRow ? {
        analysisRequestId: requestRow.analysis_request_id,
        rawRequestText: requestRow.raw_request_text,
        submittedAt: requestRow.submitted_at,
        locale: requestRow.locale,
        timezone: requestRow.timezone,
      } : null,
      submittedEvidence,
      requirementVersion: {
        versionId: reqVersion.structuredRequirementVersionId,
        versionOrdinal: reqVersion.versionOrdinal,
        schemaVersion: reqVersion.schemaVersion,
        contentSha256: reqVersion.contentSha256,
        createdAt: reqVersion.createdAt,
        createdBy: creatorRef,
        supersedesVersionId: reqVersion.supersedesVersionId,
      },
      requirementContent,
      gate,
      gateTarget: {
        schemaVersion: reqVersion.schemaVersion,
        contentSha256: reqVersion.contentSha256,
      },
      adjacentVersions: {
        previous: prevVersion,
        next: nextVersion,
      },
      priorRequestedChanges,
      commands,
      confirmationEligibility,
    };

    return { readModelVersion: READ_MODEL_VERSION, generatedAt: new Date().toISOString(), data };
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const REQ_VERSION_SELECT =
  "structured_requirement_version_id, analysis_project_id, analysis_request_id, " +
  "version_ordinal, supersedes_version_id, schema_version, content_sha256, " +
  "storage_ref, created_at, created_by_actor_id";

interface RequirementVersionRowShape {
  structured_requirement_version_id: string;
  analysis_project_id: string;
  analysis_request_id: string;
  version_ordinal: number;
  supersedes_version_id: string | null;
  schema_version: string;
  content_sha256: string;
  storage_ref: string;
  created_at: string;
  created_by_actor_id: string;
}

function buildVersionRefFromRow(row: RequirementVersionRowShape, db: DatabaseSync): VersionRef {
  const actor = getActorById(db, row.created_by_actor_id);
  return {
    versionId: row.structured_requirement_version_id,
    versionOrdinal: row.version_ordinal,
    schemaVersion: row.schema_version,
    contentSha256: row.content_sha256,
    createdAt: row.created_at,
    createdBy: {
      actorId: row.created_by_actor_id,
      actorKind: actor?.actorKind ?? "system",
      displayName: actor?.displayName ?? "Unknown",
    },
    supersedesVersionId: row.supersedes_version_id,
  };
}

function parseRequestedChanges(json: string | null): readonly {
  readonly requestedChangeId: string;
  readonly summary: string;
  readonly rationale: string | null;
  readonly affectedFieldPaths: readonly string[];
}[] {
  if (!json) return [];
  try {
    const parsed = JSON.parse(json) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.map((item) => {
      const rc = item as Record<string, unknown>;
      return {
        requestedChangeId: typeof rc.requestedChangeId === "string" ? rc.requestedChangeId : "",
        summary: typeof rc.summary === "string" ? rc.summary : "",
        rationale: typeof rc.rationale === "string" ? rc.rationale : null,
        affectedFieldPaths: Array.isArray(rc.affectedFieldPaths) ? rc.affectedFieldPaths.filter((p): p is string => typeof p === "string") : [],
      };
    });
  } catch {
    return [];
  }
}
