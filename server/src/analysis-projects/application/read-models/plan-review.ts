/**
 * PlanReviewReadModel (§7.4, API-024).
 *
 * Non-materialized, single SQLite read snapshot.
 * - Project, approved Requirement summary, complete Plan content.
 * - Precise Source/Evidence refs, Gate target/decision, adjacent versions,
 *   prior requested changes, commands/eligibility.
 * - Real-time derived confirmationEligibility and runEligibility.
 * - Old versions read-only; only current active pending version can be decided.
 * - Does NOT return storageRef, raw prompt, raw pi event, hidden reasoning,
 *   token, absolute path, piSessionRef, or unauthorized Evidence content.
 */
import type { DatabaseSync } from "node:sqlite";
import { ApplicationError } from "../../contracts/envelope.ts";
import { getProjectById, countActiveRuns } from "../projects/project-queries.ts";
import type { ReadModelEnvelope, CommandAffordance, EvidenceRef, GateRef, VersionRef, ActorRef, Eligibility, RunRef } from "../../contracts/dto.ts";
import type { TrustedActorContext } from "../shared/runtime.ts";
import type { AnalysisPlanContent } from "../plans/plan-service.ts";
import { getPlanVersionById } from "../plans/plan-service.ts";
import { getRequirementVersionById } from "../requirements/requirement-service.ts";
import { getActorById } from "../actors/actor-service.ts";
import { readBlob } from "../../persistence/blob-writer.ts";

const READ_MODEL_VERSION = "1.0";

const PLAN_VERSION_SELECT =
  "analysis_plan_version_id, analysis_project_id, structured_requirement_version_id, " +
  "version_ordinal, supersedes_version_id, schema_version, content_sha256, " +
  "storage_ref, created_at, created_by_actor_id";

interface PlanVersionRowShape {
  analysis_plan_version_id: string;
  analysis_project_id: string;
  structured_requirement_version_id: string;
  version_ordinal: number;
  supersedes_version_id: string | null;
  schema_version: string;
  content_sha256: string;
  storage_ref: string;
  created_at: string;
  created_by_actor_id: string;
}

export interface PlanReviewData {
  readonly project: {
    readonly projectId: string;
    readonly kind: string;
    readonly title: string;
    readonly slug: string;
    readonly status: string;
    readonly createdAt: string;
    readonly updatedAt: string;
  };
  readonly approvedRequirementSummary: {
    readonly requirementVersionId: string;
    readonly versionOrdinal: number;
    readonly schemaVersion: string;
    readonly contentSha256: string;
    readonly businessQuestion: string;
  } | null;
  readonly submittedEvidence: readonly EvidenceRef[];
  readonly planVersion: {
    readonly versionId: string;
    readonly versionOrdinal: number;
    readonly schemaVersion: string;
    readonly contentSha256: string;
    readonly createdAt: string;
    readonly createdBy: ActorRef;
    readonly supersedesVersionId: string | null;
  };
  readonly planContent: AnalysisPlanContent;
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
  readonly queuedRun: RunRef | null;
  readonly commands: readonly CommandAffordance[];
  readonly confirmationEligibility: Eligibility;
  readonly runEligibility: Eligibility;
}

export interface PlanReviewQuery {
  readonly db: DatabaseSync;
  readonly layout: import("../../persistence/data-root.ts").DataRootLayout;
  readonly projectId: string;
  readonly workspaceId: string;
  readonly planVersionId: string;
  readonly actorContext: TrustedActorContext;
  readonly authorizedForContent: boolean;
}

export function queryPlanReview(query: PlanReviewQuery): ReadModelEnvelope<PlanReviewData> {
  const { db, layout, workspaceId, projectId, planVersionId, actorContext, authorizedForContent } = query;
  const actorActiveHuman = actorContext.actorKind === "human" && actorContext.active;

  db.exec("BEGIN");
  try {
    const project = getProjectById(db, workspaceId, projectId);
    if (!project) {
      throw new ApplicationError("resource_not_found", "Project not found.");
    }

    const planVersion = getPlanVersionById(db, workspaceId, planVersionId);
    if (!planVersion || planVersion.analysisProjectId !== projectId) {
      throw new ApplicationError("resource_not_found", "Plan version not found.");
    }

    // Read plan content from blob
    const contentBytes = readBlob(layout.blobsDir, planVersion.storageRef);
    const contentJson = new TextDecoder().decode(contentBytes);
    const planContent = JSON.parse(contentJson) as AnalysisPlanContent;

    // Approved Requirement summary
    let approvedRequirementSummary: PlanReviewData["approvedRequirementSummary"] = null;
    if (project.currentRequirementVersionId) {
      const reqVersion = getRequirementVersionById(db, workspaceId, project.currentRequirementVersionId);
      if (reqVersion && reqVersion.analysisProjectId === projectId) {
        // Verify it has an approved gate
        const reqGateRow = db.prepare(
          "SELECT gate_decision_id FROM gate_decisions WHERE analysis_project_id = ? AND gate_type = 'requirement_confirmation' AND target_object_id = ? AND decision = 'approved'"
        ).get(projectId, reqVersion.structuredRequirementVersionId) as { gate_decision_id: string } | undefined;
        if (reqGateRow) {
          // Read requirement content to extract businessQuestion
          let businessQuestion = "";
          try {
            const reqBytes = readBlob(layout.blobsDir, reqVersion.storageRef);
            const reqJson = new TextDecoder().decode(reqBytes);
            const reqContent = JSON.parse(reqJson) as { businessQuestion?: string };
            businessQuestion = typeof reqContent.businessQuestion === "string" ? reqContent.businessQuestion : "";
          } catch {
            businessQuestion = "";
          }
          approvedRequirementSummary = {
            requirementVersionId: reqVersion.structuredRequirementVersionId,
            versionOrdinal: reqVersion.versionOrdinal,
            schemaVersion: reqVersion.schemaVersion,
            contentSha256: reqVersion.contentSha256,
            businessQuestion,
          };
        }
      }
    }

    // Submitted Evidence (from AnalysisRequest, preserving submitted order, excluding system_only)
    let evidenceRows: Array<{
      evidence_artifact_id: string; display_name: string; artifact_kind: string;
      safety_class: string; visibility: string; media_type: string;
      byte_size: number; content_sha256: string; created_at: string;
    }> = [];
    const requestRow = db.prepare(
      "SELECT submitted_context_evidence_ids_json FROM analysis_requests WHERE analysis_project_id = ?"
    ).get(projectId) as { submitted_context_evidence_ids_json: string } | undefined;
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
        const evidenceMap = new Map(allEvidence.map(e => [e.evidence_artifact_id, e]));
        evidenceRows = submittedIds
          .map(id => evidenceMap.get(id))
          .filter((e): e is NonNullable<typeof e> => e !== undefined && e.visibility !== "system_only");
      }
    }

    // Gate decision for this plan version
    const gateRow = db.prepare(
      `SELECT gate_decision_id, decision, decided_at, decided_by_actor_id, actor_display_name_snapshot,
              target_schema_version, target_content_sha256, requested_changes_json
       FROM gate_decisions WHERE analysis_project_id = ? AND gate_type = 'plan_confirmation' AND target_object_id = ?`
    ).get(projectId, planVersionId) as {
      gate_decision_id: string; decision: string; decided_at: string;
      decided_by_actor_id: string; actor_display_name_snapshot: string;
      target_schema_version: string; target_content_sha256: string;
      requested_changes_json: string | null;
    } | undefined;

    // Adjacent versions
    const prevRow = db.prepare(
      `SELECT ${PLAN_VERSION_SELECT} FROM analysis_plan_versions WHERE analysis_project_id = ? AND version_ordinal = ?`
    ).get(projectId, planVersion.versionOrdinal - 1) as PlanVersionRowShape | undefined;

    const nextRow = db.prepare(
      `SELECT ${PLAN_VERSION_SELECT} FROM analysis_plan_versions WHERE analysis_project_id = ? AND version_ordinal = ?`
    ).get(projectId, planVersion.versionOrdinal + 1) as PlanVersionRowShape | undefined;

    // Prior requested changes (changes_requested gates on previous versions)
    const priorGates = db.prepare(
      `SELECT gate_decision_id, decided_at, requested_changes_json
       FROM gate_decisions
       WHERE analysis_project_id = ? AND gate_type = 'plan_confirmation' AND decision = 'changes_requested' AND target_object_id != ?
       ORDER BY decided_at ASC`
    ).all(projectId, planVersionId) as Array<{
      gate_decision_id: string; decided_at: string; requested_changes_json: string | null;
    }>;

    // Queued/running Run for this plan version (if any)
    const runRow = db.prepare(
      `SELECT analysis_run_id, run_ordinal, current_analysis_stage, current_run_status,
              queued_at, started_at, ended_at, triggered_by_actor_id
       FROM analysis_runs WHERE analysis_plan_version_id = ?
       ORDER BY run_ordinal DESC LIMIT 1`
    ).get(planVersionId) as {
      analysis_run_id: string; run_ordinal: number; current_analysis_stage: string;
      current_run_status: string; queued_at: string; started_at: string | null;
      ended_at: string | null; triggered_by_actor_id: string;
    } | undefined;

    // Build creator ActorRef
    const creator = getActorById(db, planVersion.createdByActorId);
    const creatorRef: ActorRef = {
      actorId: planVersion.createdByActorId,
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
        gateType: "plan_confirmation",
        targetObjectType: "analysis_plan_version",
        targetObjectId: planVersionId,
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

    // Queued Run ref (no piSessionRef)
    let queuedRun: RunRef | null = null;
    if (runRow) {
      const runTriggeredBy = getActorById(db, runRow.triggered_by_actor_id);
      queuedRun = {
        runId: runRow.analysis_run_id,
        runOrdinal: runRow.run_ordinal,
        currentAnalysisStage: runRow.current_analysis_stage as RunRef["currentAnalysisStage"],
        currentRunStatus: runRow.current_run_status as RunRef["currentRunStatus"],
        queuedAt: runRow.queued_at,
        startedAt: runRow.started_at,
        endedAt: runRow.ended_at,
        triggeredBy: {
          actorId: runRow.triggered_by_actor_id,
          actorKind: runTriggeredBy?.actorKind ?? "system",
          displayName: runTriggeredBy?.displayName ?? "Unknown",
        },
      };
    }

    // Eligibility derivation
    const isCurrent = project.currentPlanVersionId === planVersionId;
    const hasGate = gate !== null;
    const projectActive = project.projectStatus === "active" && project.archivedAt === null;
    const requirementApproved = approvedRequirementSummary !== null;
    const hasActiveRun = countActiveRuns(db, workspaceId, projectId) > 0;
    // Fail-closed: only controlled/derived evidence (not restricted_raw or unknown) is admissible.
    const ADMISSIBLE_SAFETY = new Set(["controlled", "derived"]);
    const hasAdmissibleEvidence = evidenceRows.some(e => ADMISSIBLE_SAFETY.has(e.safety_class));

    // confirmationEligibility: can the actor decide this plan?
    const canDecide = isCurrent && !hasGate && actorActiveHuman && projectActive;
    const confirmReasons: string[] = [];
    if (!isCurrent) confirmReasons.push("version_not_current");
    if (hasGate) confirmReasons.push("gate_already_decided");
    if (!actorActiveHuman) confirmReasons.push("actor_not_active_human");
    if (!projectActive) confirmReasons.push("project_not_active");

    // runEligibility: can an approved plan start a Run? (only meaningful before gate decided)
    const runReasons: string[] = [];
    if (!projectActive) runReasons.push("project_inactive");
    if (!isCurrent) runReasons.push("version_not_current");
    if (!requirementApproved) runReasons.push("requirement_not_approved");
    if (hasGate && gate!.decision !== "approved") runReasons.push("plan_not_approved");
    if (!hasGate) runReasons.push("plan_not_approved");
    if (hasActiveRun) runReasons.push("active_run");
    if (!hasAdmissibleEvidence) runReasons.push("input_missing_or_unsafe");

    const commands: CommandAffordance[] = [];
    commands.push({
      commandType: "plan.decide_confirmation",
      available: canDecide,
      unavailableReasons: confirmReasons,
    });

    const confirmationEligibility: Eligibility = { eligible: canDecide, reasons: confirmReasons };
    const runEligibility: Eligibility = { eligible: false, reasons: runReasons };

    db.exec("COMMIT");

    const data: PlanReviewData = {
      project: {
        projectId: project.analysisProjectId,
        kind: project.projectKind,
        title: project.title,
        slug: project.slug,
        status: project.projectStatus,
        createdAt: project.createdAt,
        updatedAt: project.updatedAt,
      },
      approvedRequirementSummary,
      submittedEvidence,
      planVersion: {
        versionId: planVersion.analysisPlanVersionId,
        versionOrdinal: planVersion.versionOrdinal,
        schemaVersion: planVersion.schemaVersion,
        contentSha256: planVersion.contentSha256,
        createdAt: planVersion.createdAt,
        createdBy: creatorRef,
        supersedesVersionId: planVersion.supersedesVersionId,
      },
      planContent,
      gate,
      gateTarget: {
        schemaVersion: planVersion.schemaVersion,
        contentSha256: planVersion.contentSha256,
      },
      adjacentVersions: {
        previous: prevVersion,
        next: nextVersion,
      },
      priorRequestedChanges,
      queuedRun,
      commands,
      confirmationEligibility,
      runEligibility,
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

function buildVersionRefFromRow(row: PlanVersionRowShape, db: DatabaseSync): VersionRef {
  const actor = getActorById(db, row.created_by_actor_id);
  return {
    versionId: row.analysis_plan_version_id,
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
