/**
 * ReportReviewReadModel (§7.6, API-027).
 *
 * Non-materialized, single SQLite read snapshot.
 * - Project summary, complete canonical Report content, ReportVersion ref.
 * - Run/Requirement/Plan bindings, latest passed InternalReview summary/ref.
 * - Ordered cited Evidence refs + ReportVersionEvidence refs.
 * - Gate target/decision (if exists), version chain, reviewEligibility, commands.
 *
 * Safety (§7.8):
 * - EvidenceRef never carries storageRef; contentHref only when authorized and
 *   visible (user_visible + not restricted_raw).
 * - review_only internal review: summary/ref only, no content href.
 * - system_only excluded from business ReadModel.
 * - restricted_raw: metadata only, no content href.
 * - Does NOT return storageRef, piSessionRef, prompt, token, absolute path,
 *   raw pi event, stdout/stderr, SQL/stack, hidden reasoning, or Evidence content.
 *
 * Eligibility reason codes (§7.6):
 * project_not_active, project_archived, report_not_latest, run_not_succeeded,
 * internal_review_missing, internal_review_not_passed, schema_mismatch,
 * hash_mismatch, evidence_missing, evidence_not_authorized, citation_invalid,
 * report_already_reviewed, approved_report_conflict.
 */
import type { DatabaseSync } from "node:sqlite";
import { ApplicationError } from "../../contracts/envelope.ts";
import { getProjectById } from "../projects/project-queries.ts";
import type { ReadModelEnvelope, CommandAffordance, EvidenceRef, GateRef, ReportRef, RunRef, ActorRef, Eligibility, VersionRef } from "../../contracts/dto.ts";
import type { TrustedActorContext } from "../shared/runtime.ts";
import { getReportVersionById, getLatestReportVersion } from "../reports/report-service.ts";
import { getActorById } from "../actors/actor-service.ts";
import { readBlob } from "../../persistence/blob-writer.ts";
import { sha256HexBytes } from "../../persistence/sha256.ts";
import type { DataRootLayout } from "../../persistence/data-root.ts";

const READ_MODEL_VERSION = "1.0";

export interface ReportReviewData {
  readonly project: {
    readonly projectId: string;
    readonly kind: string;
    readonly title: string;
    readonly slug: string;
    readonly status: string;
    readonly createdAt: string;
    readonly updatedAt: string;
  };
  readonly reportVersion: {
    readonly versionId: string;
    readonly versionOrdinal: number;
    readonly schemaVersion: string;
    readonly contentSha256: string;
    readonly createdAt: string;
    readonly createdBy: ActorRef;
    readonly supersedesVersionId: string | null;
  };
  readonly reportContent: unknown;
  readonly run: RunRef | null;
  readonly requirementVersion: VersionRef | null;
  readonly planVersion: VersionRef | null;
  readonly latestInternalReview: {
    readonly evidenceArtifactId: string;
    readonly displayName: string;
    readonly createdAt: string;
  } | null;
  readonly citedEvidence: readonly EvidenceRef[];
  readonly reportVersionEvidence: readonly EvidenceRef[];
  readonly gate: GateRef | null;
  readonly gateTarget: {
    readonly schemaVersion: string;
    readonly contentSha256: string;
  };
  readonly versionChain: {
    readonly previous: ReportRef | null;
    readonly next: ReportRef | null;
  };
  readonly commands: readonly CommandAffordance[];
  readonly reviewEligibility: Eligibility;
}

export interface ReportReviewQuery {
  readonly db: DatabaseSync;
  readonly layout: DataRootLayout;
  readonly projectId: string;
  readonly workspaceId: string;
  readonly reportVersionId: string;
  readonly actorContext: TrustedActorContext;
  readonly authorizedForContent: boolean;
}

// Placeholder; implementation appended below.
export function queryReportReview(query: ReportReviewQuery): ReadModelEnvelope<ReportReviewData> {
  const { db, layout, workspaceId, projectId, reportVersionId, actorContext, authorizedForContent } = query;
  const actorActiveHuman = actorContext.actorKind === "human" && actorContext.active;

  db.exec("BEGIN");
  try {
    const project = getProjectById(db, workspaceId, projectId);
    if (!project) throw new ApplicationError("resource_not_found", "Project not found.");

    const reportVersion = getReportVersionById(db, workspaceId, reportVersionId);
    if (!reportVersion || reportVersion.analysisProjectId !== projectId) {
      throw new ApplicationError("resource_not_found", "Report version not found.");
    }

    // Read canonical Report content from blob
    const contentBytes = readBlob(layout.blobsDir, reportVersion.storageRef);
    const contentJson = new TextDecoder().decode(contentBytes);
    const reportContent = JSON.parse(contentJson);

    // Build creator ActorRef
    const creator = getActorById(db, reportVersion.createdByActorId);
    const creatorRef: ActorRef = {
      actorId: reportVersion.createdByActorId,
      actorKind: creator?.actorKind ?? "system",
      displayName: creator?.displayName ?? "Unknown",
    };

    // Run binding (no piSessionRef)
    const run = buildRunRef(db, reportVersion.analysisRunId);

    // Requirement version binding
    const requirementVersion = buildVersionRef(db, reportVersion.structuredRequirementVersionId, "structured_requirement_versions", "structured_requirement_version_id");
    // Plan version binding
    const planVersion = buildVersionRef(db, reportVersion.analysisPlanVersionId, "analysis_plan_versions", "analysis_plan_version_id");

    // Latest internal review (intermediate_result + review_only for this run)
    const reviewRow = db.prepare(
      `SELECT evidence_artifact_id, display_name, created_at
       FROM evidence_artifacts
       WHERE analysis_run_id = ? AND artifact_kind = 'intermediate_result' AND visibility = 'review_only'
       ORDER BY created_at DESC LIMIT 1`,
    ).get(reportVersion.analysisRunId) as { evidence_artifact_id: string; display_name: string; created_at: string } | undefined;
    const latestInternalReview = reviewRow
      ? { evidenceArtifactId: reviewRow.evidence_artifact_id, displayName: reviewRow.display_name, createdAt: reviewRow.created_at }
      : null;

    // Cited Evidence + ReportVersionEvidence refs (ordered by evidence_ordinal)
    const evidenceRows = db.prepare(
      `SELECT ea.evidence_artifact_id, ea.display_name, ea.artifact_kind, ea.safety_class,
              ea.visibility, ea.media_type, ea.byte_size, ea.content_sha256, ea.created_at,
              ea.analysis_run_id, ea.analysis_project_id
       FROM report_version_evidence rve
       JOIN evidence_artifacts ea ON rve.evidence_artifact_id = ea.evidence_artifact_id
       WHERE rve.report_version_id = ?
       ORDER BY rve.evidence_ordinal ASC`,
    ).all(reportVersionId) as Array<{
      evidence_artifact_id: string; display_name: string; artifact_kind: string;
      safety_class: string; visibility: string; media_type: string;
      byte_size: number; content_sha256: string; created_at: string;
      analysis_run_id: string | null; analysis_project_id: string;
    }>;
    // Safe projection: system_only excluded; restricted_raw metadata only;
    // review_only no content href; user_visible gets content href when authorized.
    const citedEvidence: EvidenceRef[] = evidenceRows
      .filter((e) => e.visibility !== "system_only")
      .map((e) => ({
        evidenceArtifactId: e.evidence_artifact_id,
        displayName: e.display_name,
        artifactKind: e.artifact_kind,
        safetyClass: e.safety_class as EvidenceRef["safetyClass"],
        visibility: e.visibility as EvidenceRef["visibility"],
        mediaType: e.media_type,
        byteSize: e.byte_size,
        contentSha256: e.content_sha256,
        createdAt: e.created_at,
        contentHref: buildContentHref(projectId, e.evidence_artifact_id, e.safety_class, e.visibility, authorizedForContent),
      }));
    const reportVersionEvidence = citedEvidence; // same set, same safe projection

    // Gate decision for this report version
    const gateRow = db.prepare(
      `SELECT gate_decision_id, decision, decided_at, decided_by_actor_id, actor_display_name_snapshot,
              target_schema_version, target_content_sha256, requested_changes_json, rejection_reason, comment
       FROM gate_decisions WHERE analysis_project_id = ? AND gate_type = 'report_review' AND target_object_id = ?`,
    ).get(projectId, reportVersionId) as {
      gate_decision_id: string; decision: string; decided_at: string;
      decided_by_actor_id: string; actor_display_name_snapshot: string;
      target_schema_version: string; target_content_sha256: string;
      requested_changes_json: string; rejection_reason: string | null; comment: string | null;
    } | undefined;
    let gate: GateRef | null = null;
    if (gateRow) {
      const gateDecidedBy = getActorById(db, gateRow.decided_by_actor_id);
      gate = {
        gateDecisionId: gateRow.gate_decision_id,
        gateType: "report_review",
        targetObjectType: "report_version",
        targetObjectId: reportVersionId,
        decision: gateRow.decision as GateRef["decision"],
        decidedAt: gateRow.decided_at,
        decidedBy: {
          actorId: gateRow.decided_by_actor_id,
          actorKind: gateDecidedBy?.actorKind ?? "system",
          displayName: gateRow.actor_display_name_snapshot,
        },
      };
    }

    // Version chain (previous/next by ordinal)
    const versionChain = {
      previous: buildReportRefByOrdinal(db, projectId, reportVersion.versionOrdinal - 1),
      next: buildReportRefByOrdinal(db, projectId, reportVersion.versionOrdinal + 1),
    };

    // Eligibility and commands
    const latest = getLatestReportVersion(db, workspaceId, projectId);
    const isLatest = latest?.reportVersionId === reportVersionId;
    const hasGate = gate !== null;
    const hasInternalReview = latestInternalReview !== null;

    const reasons: string[] = [];
    if (!actorActiveHuman) reasons.push("actor_not_active_human");
    if (project.projectStatus !== "active") reasons.push("project_not_active");
    if (project.archivedAt !== null) reasons.push("project_archived");
    if (!isLatest) reasons.push("report_not_latest");
    if (run && run.currentRunStatus !== "succeeded") reasons.push("run_not_succeeded");
    if (!hasInternalReview) reasons.push("internal_review_missing");
    // internal_review_not_passed: independently check if run is succeeded AND
    // internal review evidence exists AND run_succeeded event confirms passed.
    // This is independent of run_not_succeeded.
    if (hasInternalReview && run) {
      const runSucceeded = run.currentRunStatus === "succeeded";
      if (runSucceeded) {
        // Run is succeeded - verify internal review actually passed via run_succeeded event
        const successEvent = db.prepare(
          "SELECT payload_json FROM run_events WHERE analysis_run_id = ? AND event_type = 'run_succeeded' ORDER BY sequence DESC LIMIT 1",
        ).get(run.runId) as { payload_json: string } | undefined;
        if (!successEvent) {
          reasons.push("internal_review_not_passed");
        } else {
          try {
            const payload = JSON.parse(successEvent.payload_json) as { internalReviewEvidenceArtifactId?: string };
            if (!payload.internalReviewEvidenceArtifactId) {
              reasons.push("internal_review_not_passed");
            }
          } catch {
            reasons.push("internal_review_not_passed");
          }
        }
      }
      // If run is not succeeded, internal_review_not_passed is not independently
      // surfaced because run_not_succeeded already covers the blocking condition.
    }
    if (hasGate) reasons.push("report_already_reviewed");
    const approvedOther = db.prepare(
      "SELECT gate_decision_id FROM gate_decisions WHERE analysis_project_id = ? AND gate_type = 'report_review' AND decision = 'approved' AND target_object_id != ?",
    ).get(projectId, reportVersionId) as { gate_decision_id: string } | undefined;
    if (approvedOther) reasons.push("approved_report_conflict");

    // Schema/hash mismatch: ReportVersion schema must be "1.0" and content hash
    // must match the blob's actual hash (fail closed on drift)
    if (reportVersion.schemaVersion !== "1.0") reasons.push("schema_mismatch");
    const actualContentHash = sha256HexBytes(new TextEncoder().encode(contentJson));
    if (reportVersion.contentSha256 !== actualContentHash) reasons.push("hash_mismatch");

    // Evidence missing: ReportVersionEvidence must have at least one row
    const evLinkCount = (db.prepare("SELECT COUNT(*) AS c FROM report_version_evidence WHERE report_version_id = ?").get(reportVersionId) as { c: number }).c;
    if (evLinkCount === 0) reasons.push("evidence_missing");

    // Evidence not authorized: restricted_raw or system_only evidence in cited set
    // should not support business conclusions (P0-46)
    const hasUnauthorizedEvidence = evidenceRows.some((e) => e.safety_class === "restricted_raw" || e.visibility === "system_only");
    if (hasUnauthorizedEvidence) reasons.push("evidence_not_authorized");

    // Citation invalid: cited evidence must belong to the same project and be
    // produced by the current Run or admitted as Plan input
    if (run && evLinkCount > 0) {
      const invalidCitation = evidenceRows.some((e) => {
        if (e.analysis_project_id !== projectId) return true;
        const isRunOutput = e.analysis_run_id === reportVersion.analysisRunId;
        const isPlanInput = e.analysis_run_id === null && isAdmittedPlanInput(db, reportVersion.analysisRunId, e.evidence_artifact_id);
        return !isRunOutput && !isPlanInput;
      });
      if (invalidCitation) reasons.push("citation_invalid");
    }

    const canDecide = reasons.length === 0;
    const commands: CommandAffordance[] = [{
      commandType: "report.decide_review",
      available: canDecide,
      unavailableReasons: canDecide ? [] : reasons,
    }];

    db.exec("COMMIT");

    const data: ReportReviewData = {
      project: {
        projectId: project.analysisProjectId,
        kind: project.projectKind,
        title: project.title,
        slug: project.slug,
        status: project.projectStatus,
        createdAt: project.createdAt,
        updatedAt: project.updatedAt,
      },
      reportVersion: {
        versionId: reportVersion.reportVersionId,
        versionOrdinal: reportVersion.versionOrdinal,
        schemaVersion: reportVersion.schemaVersion,
        contentSha256: reportVersion.contentSha256,
        createdAt: reportVersion.createdAt,
        createdBy: creatorRef,
        supersedesVersionId: reportVersion.supersedesVersionId,
      },
      reportContent,
      run,
      requirementVersion,
      planVersion,
      latestInternalReview,
      citedEvidence,
      reportVersionEvidence,
      gate,
      gateTarget: {
        schemaVersion: reportVersion.schemaVersion,
        contentSha256: reportVersion.contentSha256,
      },
      versionChain,
      commands,
      reviewEligibility: { eligible: canDecide, reasons: canDecide ? [] : reasons },
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

/** Build a safe content href: only for authorized + user_visible + not restricted_raw. */
function buildContentHref(
  projectId: string,
  evidenceArtifactId: string,
  safetyClass: string,
  visibility: string,
  authorizedForContent: boolean,
): string | null {
  if (safetyClass === "restricted_raw") return null;
  if (visibility !== "user_visible") return null; // review_only gets no content href
  if (!authorizedForContent) return null;
  return `/api/v1/projects/${projectId}/evidence/${evidenceArtifactId}/content`;
}

function buildRunRef(db: DatabaseSync, runId: string): RunRef | null {
  const runRow = db.prepare(
    "SELECT analysis_run_id, run_ordinal, current_analysis_stage, current_run_status, queued_at, started_at, ended_at, triggered_by_actor_id FROM analysis_runs WHERE analysis_run_id = ?",
  ).get(runId) as {
    analysis_run_id: string; run_ordinal: number; current_analysis_stage: string;
    current_run_status: string; queued_at: string; started_at: string | null;
    ended_at: string | null; triggered_by_actor_id: string;
  } | undefined;
  if (!runRow) return null;
  const triggeredBy = getActorById(db, runRow.triggered_by_actor_id);
  return {
    runId: runRow.analysis_run_id,
    runOrdinal: runRow.run_ordinal,
    currentAnalysisStage: runRow.current_analysis_stage as RunRef["currentAnalysisStage"],
    currentRunStatus: runRow.current_run_status as RunRef["currentRunStatus"],
    queuedAt: runRow.queued_at,
    startedAt: runRow.started_at,
    endedAt: runRow.ended_at,
    triggeredBy: {
      actorId: runRow.triggered_by_actor_id,
      actorKind: triggeredBy?.actorKind ?? "system",
      displayName: triggeredBy?.displayName ?? "Unknown",
    },
  };
}

function buildVersionRef(db: DatabaseSync, versionId: string, table: string, idCol: string): VersionRef | null {
  const row = db.prepare(`SELECT ${idCol} AS id, version_ordinal, schema_version, content_sha256, created_at, created_by_actor_id, supersedes_version_id FROM ${table} WHERE ${idCol} = ?`).get(versionId) as
    | { id: string; version_ordinal: number; schema_version: string; content_sha256: string; created_at: string; created_by_actor_id: string; supersedes_version_id: string | null }
    | undefined;
  if (!row) return null;
  const actor = getActorById(db, row.created_by_actor_id);
  return {
    versionId: row.id, versionOrdinal: row.version_ordinal, schemaVersion: row.schema_version,
    contentSha256: row.content_sha256, createdAt: row.created_at,
    createdBy: { actorId: row.created_by_actor_id, actorKind: actor?.actorKind ?? "system", displayName: actor?.displayName ?? "Unknown" },
    supersedesVersionId: row.supersedes_version_id,
  };
}

function buildReportRefByOrdinal(db: DatabaseSync, projectId: string, ordinal: number): ReportRef | null {
  const row = db.prepare(
    "SELECT report_version_id, version_ordinal, schema_version, content_sha256, created_at, created_by_actor_id FROM report_versions WHERE analysis_project_id = ? AND version_ordinal = ?",
  ).get(projectId, ordinal) as {
    report_version_id: string; version_ordinal: number; schema_version: string;
    content_sha256: string; created_at: string; created_by_actor_id: string;
  } | undefined;
  if (!row) return null;
  const actor = getActorById(db, row.created_by_actor_id);
  return {
    reportVersionId: row.report_version_id, versionOrdinal: row.version_ordinal,
    schemaVersion: row.schema_version, contentSha256: row.content_sha256, createdAt: row.created_at,
    createdBy: { actorId: row.created_by_actor_id, actorKind: actor?.actorKind ?? "system", displayName: actor?.displayName ?? "Unknown" },
  };
}

/** Check if an evidence artifact is an admitted plan input for a given run. */
function isAdmittedPlanInput(db: DatabaseSync, runId: string, evidenceArtifactId: string): boolean {
  const row = db.prepare(
    "SELECT evidence_artifact_id FROM analysis_run_input_evidence WHERE analysis_run_id = ? AND evidence_artifact_id = ?",
  ).get(runId, evidenceArtifactId) as { evidence_artifact_id: string } | undefined;
  return row !== undefined;
}
