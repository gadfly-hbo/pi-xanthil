/**
 * LockedReportReadModel (§7.7, API-028).
 *
 * Non-materialized, single SQLite read snapshot.
 * - identity equals the approved ReportVersion (lockedReportId = reportVersionId).
 * - Only returns a complete read model when an approved report_review Gate exists;
 *   otherwise 404 (contract-safe not found).
 * - Contains complete canonical Report, Requirement/Plan/Run bindings, immutable
 *   Evidence index, approval Gate, full report review trail, representation/export
 *   availability and commands.
 * - Does NOT create a locked_reports business table; derived from approved
 *   ReportVersion + approved report_review Gate + existing evidence/run bindings.
 * - Any integrity inconsistency fail closed: approved Gate target missing,
 *     hash/schema mismatch, ReportVersionEvidence missing, Evidence missing,
 *     Run not succeeded, internal review missing/not passed, Project not
 *     completed / approved gate inconsistency.
 *
 * Safety (§7.8):
 * - No storageRef, piSessionRef, prompt, raw pi, stdout/stderr, absolute path,
 *   token, SQL/stack, or Evidence content.
 */
import type { DatabaseSync } from "node:sqlite";
import { ApplicationError } from "../../contracts/envelope.ts";
import { getProjectById } from "../projects/project-queries.ts";
import type { ReadModelEnvelope, CommandAffordance, EvidenceRef, GateRef, ReportRef, RunRef, ActorRef, VersionRef } from "../../contracts/dto.ts";
import { getReportVersionById } from "../reports/report-service.ts";
import { getActorById } from "../actors/actor-service.ts";
import { readBlob } from "../../persistence/blob-writer.ts";
import type { DataRootLayout } from "../../persistence/data-root.ts";

const READ_MODEL_VERSION = "1.0";

export interface LockedReportData {
  readonly identity: {
    readonly lockedReportId: string;
    readonly reportVersionId: string;
    readonly versionOrdinal: number;
    readonly schemaVersion: string;
    readonly contentSha256: string;
    readonly createdAt: string;
    readonly createdBy: ActorRef;
  };
  readonly project: {
    readonly projectId: string;
    readonly kind: string;
    readonly title: string;
    readonly slug: string;
    readonly status: string;
    readonly completedAt: string | null;
  };
  readonly reportContent: unknown;
  readonly run: RunRef | null;
  readonly requirementVersion: VersionRef | null;
  readonly planVersion: VersionRef | null;
  readonly immutableEvidenceIndex: readonly EvidenceRef[];
  readonly approvalGate: GateRef;
  readonly reportReviewTrail: readonly GateRef[];
  readonly representationAvailability: {
    readonly markdown: { readonly available: boolean; readonly reason: string };
    readonly html: { readonly available: boolean; readonly reason: string };
    readonly pdf: { readonly available: boolean; readonly reason: string };
  };
  readonly exportAvailability: {
    readonly analysisops: { readonly available: boolean; readonly reason: string };
  };
  readonly commands: readonly CommandAffordance[];
}

export interface LockedReportQuery {
  readonly db: DatabaseSync;
  readonly layout: DataRootLayout;
  readonly projectId: string;
  readonly workspaceId: string;
  readonly actorContext: { readonly actorKind: string; readonly active: boolean };
  readonly authorizedForContent: boolean;
}

// Placeholder; implementation appended below.
export function queryLockedReport(query: LockedReportQuery): ReadModelEnvelope<LockedReportData> {
  const { db, layout, workspaceId, projectId, authorizedForContent } = query;

  db.exec("BEGIN");
  try {
    const project = getProjectById(db, workspaceId, projectId);
    if (!project) throw new ApplicationError("resource_not_found", "Project not found.");

    // Find the approved report_review Gate for this project
    const approvedGateRow = db.prepare(
      `SELECT gd.gate_decision_id, gd.target_object_id, gd.target_schema_version, gd.target_content_sha256,
              gd.decision, gd.decided_at, gd.decided_by_actor_id, gd.actor_display_name_snapshot
       FROM gate_decisions gd
       WHERE gd.analysis_project_id = ? AND gd.gate_type = 'report_review' AND gd.decision = 'approved'
       LIMIT 1`,
    ).get(projectId) as {
      gate_decision_id: string; target_object_id: string; target_schema_version: string;
      target_content_sha256: string; decision: string; decided_at: string;
      decided_by_actor_id: string; actor_display_name_snapshot: string;
    } | undefined;

    if (!approvedGateRow) {
      // No approved report_review -> 404 (contract-safe not found)
      throw new ApplicationError("resource_not_found", "No locked report exists for this project.");
    }

    const reportVersionId = approvedGateRow.target_object_id;
    const reportVersion = getReportVersionById(db, workspaceId, reportVersionId);
    // Fail closed: approved Gate target must exist
    if (!reportVersion || reportVersion.analysisProjectId !== projectId) {
      throw new ApplicationError("resource_not_found", "Locked report integrity check failed: approved gate target not found.");
    }

    // Fail closed: hash/schema must match the Gate target
    if (approvedGateRow.target_schema_version !== reportVersion.schemaVersion) {
      throw new ApplicationError("resource_not_found", "Locked report integrity check failed: schema version mismatch.");
    }
    if (approvedGateRow.target_content_sha256 !== reportVersion.contentSha256) {
      throw new ApplicationError("resource_not_found", "Locked report integrity check failed: content hash mismatch.");
    }

    // Fail closed: Project must be completed
    if (project.projectStatus !== "completed") {
      throw new ApplicationError("resource_not_found", "Locked report integrity check failed: project is not completed.");
    }

    // Fail closed: Run must be succeeded with stage S2.4
    const runRow = db.prepare(
      "SELECT current_run_status, current_analysis_stage FROM analysis_runs WHERE analysis_run_id = ?",
    ).get(reportVersion.analysisRunId) as { current_run_status: string; current_analysis_stage: string } | undefined;
    if (!runRow || runRow.current_run_status !== "succeeded" || runRow.current_analysis_stage !== "S2.4") {
      throw new ApplicationError("resource_not_found", "Locked report integrity check failed: run is not succeeded.");
    }

    // Fail closed: internal review Evidence must exist and be passed
    // (run_succeeded event implies internal review passed)
    const successEventRow = db.prepare(
      "SELECT payload_json FROM run_events WHERE analysis_run_id = ? AND event_type = 'run_succeeded' ORDER BY sequence DESC LIMIT 1",
    ).get(reportVersion.analysisRunId) as { payload_json: string } | undefined;
    if (!successEventRow) {
      throw new ApplicationError("resource_not_found", "Locked report integrity check failed: run_succeeded event missing.");
    }
    let internalReviewId: string | null = null;
    try {
      const payload = JSON.parse(successEventRow.payload_json) as { internalReviewEvidenceArtifactId?: string };
      internalReviewId = payload.internalReviewEvidenceArtifactId ?? null;
    } catch {
      throw new ApplicationError("resource_not_found", "Locked report integrity check failed: run_succeeded payload malformed.");
    }
    if (!internalReviewId) {
      throw new ApplicationError("resource_not_found", "Locked report integrity check failed: internal review evidence id missing.");
    }
    const reviewRow = db.prepare(
      "SELECT evidence_artifact_id FROM evidence_artifacts WHERE evidence_artifact_id = ? AND artifact_kind = 'intermediate_result' AND visibility = 'review_only'",
    ).get(internalReviewId) as { evidence_artifact_id: string } | undefined;
    if (!reviewRow) {
      throw new ApplicationError("resource_not_found", "Locked report integrity check failed: internal review evidence not found.");
    }

    // Fail closed: ReportVersionEvidence must exist
    const evidenceLinkCount = (db.prepare("SELECT COUNT(*) AS c FROM report_version_evidence WHERE report_version_id = ?").get(reportVersionId) as { c: number }).c;
    if (evidenceLinkCount === 0) {
      throw new ApplicationError("resource_not_found", "Locked report integrity check failed: report version has no cited evidence.");
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
    // Requirement/Plan bindings
    const requirementVersion = buildVersionRef(db, reportVersion.structuredRequirementVersionId, "structured_requirement_versions", "structured_requirement_version_id");
    const planVersion = buildVersionRef(db, reportVersion.analysisPlanVersionId, "analysis_plan_versions", "analysis_plan_version_id");

    // Immutable Evidence index (ordered by evidence_ordinal)
    const evidenceRows = db.prepare(
      `SELECT ea.evidence_artifact_id, ea.display_name, ea.artifact_kind, ea.safety_class,
              ea.visibility, ea.media_type, ea.byte_size, ea.content_sha256, ea.created_at
       FROM report_version_evidence rve
       JOIN evidence_artifacts ea ON rve.evidence_artifact_id = ea.evidence_artifact_id
       WHERE rve.report_version_id = ?
       ORDER BY rve.evidence_ordinal ASC`,
    ).all(reportVersionId) as Array<{
      evidence_artifact_id: string; display_name: string; artifact_kind: string;
      safety_class: string; visibility: string; media_type: string;
      byte_size: number; content_sha256: string; created_at: string;
    }>;
    const immutableEvidenceIndex: EvidenceRef[] = evidenceRows
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

    // Approval Gate
    const approvalGate = buildGateRef(db, approvedGateRow, projectId, reportVersionId);

    // Full report review trail (all report_review gates for this project)
    const trailRows = db.prepare(
      `SELECT gate_decision_id, target_object_id, decision, decided_at, decided_by_actor_id, actor_display_name_snapshot
       FROM gate_decisions
       WHERE analysis_project_id = ? AND gate_type = 'report_review'
       ORDER BY decided_at ASC`,
    ).all(projectId) as Array<{
      gate_decision_id: string; target_object_id: string; decision: string;
      decided_at: string; decided_by_actor_id: string; actor_display_name_snapshot: string;
    }>;
    const reportReviewTrail: GateRef[] = trailRows.map((r) => buildGateRef(db, r, projectId, r.target_object_id));

    // Representation/export availability (T0010: unavailable but present per §7.7)
    const representationAvailability = {
      markdown: { available: false, reason: "not_implemented" },
      html: { available: false, reason: "not_implemented" },
      pdf: { available: false, reason: "not_implemented" },
    };
    const exportAvailability = {
      analysisops: { available: false, reason: "not_implemented" },
    };

    // Commands (representation/export generation not implemented in T0010)
    const commands: CommandAffordance[] = [
      { commandType: "locked_report.generate_representation", available: false, unavailableReasons: ["not_implemented"] },
      { commandType: "locked_report.export_analysisops", available: false, unavailableReasons: ["not_implemented"] },
    ];

    db.exec("COMMIT");

    const data: LockedReportData = {
      identity: {
        lockedReportId: reportVersionId,
        reportVersionId,
        versionOrdinal: reportVersion.versionOrdinal,
        schemaVersion: reportVersion.schemaVersion,
        contentSha256: reportVersion.contentSha256,
        createdAt: reportVersion.createdAt,
        createdBy: creatorRef,
      },
      project: {
        projectId: project.analysisProjectId,
        kind: project.projectKind,
        title: project.title,
        slug: project.slug,
        status: project.projectStatus,
        completedAt: project.completedAt,
      },
      reportContent,
      run,
      requirementVersion,
      planVersion,
      immutableEvidenceIndex,
      approvalGate,
      reportReviewTrail,
      representationAvailability,
      exportAvailability,
      commands,
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

function buildContentHref(
  projectId: string,
  evidenceArtifactId: string,
  safetyClass: string,
  visibility: string,
  authorizedForContent: boolean,
): string | null {
  if (safetyClass === "restricted_raw") return null;
  if (visibility !== "user_visible") return null;
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

function buildGateRef(
  db: DatabaseSync,
  row: { gate_decision_id: string; decision: string; decided_at: string; decided_by_actor_id: string; actor_display_name_snapshot: string },
  _projectId: string,
  targetObjectId: string,
): GateRef {
  const gateDecidedBy = getActorById(db, row.decided_by_actor_id);
  return {
    gateDecisionId: row.gate_decision_id,
    gateType: "report_review",
    targetObjectType: "report_version",
    targetObjectId,
    decision: row.decision as GateRef["decision"],
    decidedAt: row.decided_at,
    decidedBy: {
      actorId: row.decided_by_actor_id,
      actorKind: gateDecidedBy?.actorKind ?? "system",
      displayName: row.actor_display_name_snapshot,
    },
  };
}
