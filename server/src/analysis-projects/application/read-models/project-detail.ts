/**
 * ProjectDetailReadModel (§7.2, API-022).
 * Non-materialized, single SQLite read snapshot.
 * - Project lifecycle, source relation, Request, visible input Evidence metadata.
 * - Sources + latest checks, current Requirement/Plan, latest Run/Report,
 *   LockedReport, pending Gate, commands.
 * - Does NOT embed normative body, RunEvents, or full Gate history.
 * - system_only excluded; restricted_raw metadata only (no contentHref).
 * - EvidenceRef never carries storageRef; RunRef never carries piSessionRef.
 */
import type { DatabaseSync } from "node:sqlite";
import { ApplicationError } from "../../contracts/envelope.ts";
import { getProjectById, hasEnteredAuditChain, countActiveRuns } from "../projects/project-queries.ts";
import { deriveProjectStage, derivePendingGate, deriveLatestRun, deriveLockedReportId, deriveProjectCommands } from "./project-derivation.ts";
import type { ReadModelEnvelope, CommandAffordance, EvidenceRef, SourceRef, VersionRef, RunRef, ReportRef } from "../../contracts/dto.ts";
import type { TrustedActorContext } from "../shared/runtime.ts";

const READ_MODEL_VERSION = "1.0";

export interface ProjectDetailData {
  readonly project: {
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
  };
  readonly analysisRequest: {
    readonly analysisRequestId: string;
    readonly rawRequestText: string;
    readonly submittedAt: string;
    readonly locale: string;
    readonly timezone: string;
  } | null;
  readonly inputEvidence: readonly EvidenceRef[];
  readonly sources: readonly (SourceRef & { readonly latestCheck: { readonly availabilityStatus: string; readonly checkedAt: string } | null })[];
  readonly currentRequirement: VersionRef | null;
  readonly currentPlan: VersionRef | null;
  readonly latestRun: RunRef | null;
  readonly latestReport: ReportRef | null;
  readonly lockedReportId: string | null;
  readonly pendingGate: "requirement_confirmation" | "plan_confirmation" | "report_review" | null;
  readonly availableCommands: readonly CommandAffordance[];
}

export interface ProjectDetailQuery {
  readonly db: DatabaseSync;
  readonly workspaceId: string;
  readonly projectId: string;
  readonly actorContext: TrustedActorContext;
  /** Whether the current actor is authorized to receive contentHref on Evidence. */
  readonly authorizedForContent: boolean;
}

export function queryProjectDetail(query: ProjectDetailQuery): ReadModelEnvelope<ProjectDetailData> {
  const { db, workspaceId, projectId, actorContext, authorizedForContent } = query;
  const actorActiveHuman = actorContext.actorKind === "human" && actorContext.active;
  // Single read snapshot: project lookup AND all relations in one transaction.
  db.exec("BEGIN");
  try {
    const project = getProjectById(db, workspaceId, projectId);
    if (!project) {
      throw new ApplicationError("resource_not_found", "Project not found.");
    }
    const data = buildDetail(db, project, actorActiveHuman, authorizedForContent);
    db.exec("COMMIT");
    return { readModelVersion: READ_MODEL_VERSION, generatedAt: new Date().toISOString(), data };
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
}

function buildDetail(db: DatabaseSync, project: NonNullable<ReturnType<typeof getProjectById>>, actorActiveHuman: boolean, authorizedForContent: boolean): ProjectDetailData {
  const p = project;
  const wsId = p.workspaceId;
  const WS_SCOPE = `AND analysis_project_id IN (SELECT analysis_project_id FROM analysis_projects WHERE workspace_id = ?)`;
  const stage = deriveProjectStage(db, wsId, p.analysisProjectId);
  const pendingGate = derivePendingGate(db, wsId, p.analysisProjectId);
  const latestRun = deriveLatestRun(db, wsId, p.analysisProjectId);
  const lockedReportId = deriveLockedReportId(db, wsId, p.analysisProjectId);

  // AnalysisRequest (immutable, one per project).
  const reqRow = db.prepare(`SELECT analysis_request_id, raw_request_text, submitted_at, locale, timezone FROM analysis_requests WHERE analysis_project_id = ? ${WS_SCOPE}`).get(p.analysisProjectId, wsId) as
    | { analysis_request_id: string; raw_request_text: string; submitted_at: string; locale: string; timezone: string }
    | undefined;
  const analysisRequest = reqRow ? {
    analysisRequestId: reqRow.analysis_request_id, rawRequestText: reqRow.raw_request_text,
    submittedAt: reqRow.submitted_at, locale: reqRow.locale, timezone: reqRow.timezone,
  } : null;

  // Visible INPUT Evidence: project-level input only (analysis_run_id IS NULL,
  // i.e. not produced by a Run). Run-produced outputs are projected by
  // RunProgress/ReportReview, not here. system_only excluded; restricted_raw
  // metadata only (no contentHref).
  const evidenceRows = db.prepare(
    `SELECT evidence_artifact_id, display_name, artifact_kind, safety_class, visibility, media_type, byte_size, content_sha256, created_at
     FROM evidence_artifacts WHERE analysis_project_id = ? ${WS_SCOPE} AND analysis_run_id IS NULL AND visibility != 'system_only' ORDER BY created_at ASC`,
  ).all(p.analysisProjectId, wsId) as Array<{
    evidence_artifact_id: string; display_name: string; artifact_kind: string; safety_class: string;
    visibility: string; media_type: string; byte_size: number; content_sha256: string; created_at: string;
  }>;
  const inputEvidence: EvidenceRef[] = evidenceRows.map((e) => ({
    evidenceArtifactId: e.evidence_artifact_id, displayName: e.display_name, artifactKind: e.artifact_kind,
    safetyClass: e.safety_class as EvidenceRef["safetyClass"], visibility: e.visibility as EvidenceRef["visibility"],
    mediaType: e.media_type, byteSize: e.byte_size, contentSha256: e.content_sha256, createdAt: e.created_at,
    // restricted_raw never gets contentHref; others only when authorized.
    contentHref: e.safety_class === "restricted_raw" ? null : (authorizedForContent ? `/api/v1/projects/${p.analysisProjectId}/evidence/${e.evidence_artifact_id}/content` : null),
  }));

  // Sources + latest check.
  const sourceRows = db.prepare(
    `SELECT source_reference_id, source_kind, display_name, description, declared_data_scope, safety_handling_policy, archived_at, created_at
     FROM source_references WHERE analysis_project_id = ? ${WS_SCOPE} ORDER BY created_at ASC`,
  ).all(p.analysisProjectId, wsId) as Array<{
    source_reference_id: string; source_kind: string; display_name: string; description: string;
    declared_data_scope: string; safety_handling_policy: string; archived_at: string | null; created_at: string;
  }>;
  const sources = sourceRows.map((s) => {
    const checkRow = db.prepare(`SELECT availability_status, checked_at FROM source_checks WHERE source_reference_id = ? ORDER BY checked_at DESC LIMIT 1`).get(s.source_reference_id) as
      | { availability_status: string; checked_at: string } | undefined;
    return {
      sourceReferenceId: s.source_reference_id, sourceKind: s.source_kind as SourceRef["sourceKind"],
      displayName: s.display_name, description: s.description, declaredDataScope: s.declared_data_scope,
      safetyHandlingPolicy: s.safety_handling_policy as SourceRef["safetyHandlingPolicy"],
      archivedAt: s.archived_at, createdAt: s.created_at,
      latestCheck: checkRow ? { availabilityStatus: checkRow.availability_status, checkedAt: checkRow.checked_at } : null,
    };
  });

  // Current Requirement / Plan (metadata only, no body).
  const currentRequirement = versionRef(db, wsId, p.currentRequirementVersionId, "structured_requirement_versions", "structured_requirement_version_id");
  const currentPlan = versionRef(db, wsId, p.currentPlanVersionId, "analysis_plan_versions", "analysis_plan_version_id");

  // Latest Run (no piSessionRef). startedAt now populated from snapshot.
  let latestRunRef: RunRef | null = null;
  if (latestRun) {
    const actorRow = db.prepare(`SELECT a.audit_actor_id, a.actor_kind, a.display_name FROM audit_actors a JOIN analysis_runs r ON r.triggered_by_actor_id = a.audit_actor_id WHERE r.analysis_run_id = ?`).get(latestRun.runId) as
      | { audit_actor_id: string; actor_kind: string; display_name: string } | undefined;
    latestRunRef = {
      runId: latestRun.runId, runOrdinal: latestRun.runOrdinal,
      currentAnalysisStage: latestRun.currentAnalysisStage as RunRef["currentAnalysisStage"],
      currentRunStatus: latestRun.currentRunStatus as RunRef["currentRunStatus"],
      queuedAt: latestRun.queuedAt, startedAt: latestRun.startedAt, endedAt: latestRun.endedAt,
      triggeredBy: actorRow ? { actorId: actorRow.audit_actor_id, actorKind: actorRow.actor_kind as RunRef["triggeredBy"]["actorKind"], displayName: actorRow.display_name } : { actorId: "", actorKind: "system", displayName: "" },
    };
  }

  // Latest Report (metadata only).
  let latestReport: ReportRef | null = null;
  const reportRow = db.prepare(`SELECT report_version_id, version_ordinal, schema_version, content_sha256, created_at, created_by_actor_id FROM report_versions WHERE analysis_project_id = ? ${WS_SCOPE} ORDER BY version_ordinal DESC LIMIT 1`).get(p.analysisProjectId, wsId) as
    | { report_version_id: string; version_ordinal: number; schema_version: string; content_sha256: string; created_at: string; created_by_actor_id: string } | undefined;
  if (reportRow) {
    const actorRow = db.prepare(`SELECT audit_actor_id, actor_kind, display_name FROM audit_actors WHERE audit_actor_id = ?`).get(reportRow.created_by_actor_id) as
      | { audit_actor_id: string; actor_kind: string; display_name: string } | undefined;
    latestReport = {
      reportVersionId: reportRow.report_version_id, versionOrdinal: reportRow.version_ordinal,
      schemaVersion: reportRow.schema_version, contentSha256: reportRow.content_sha256, createdAt: reportRow.created_at,
      createdBy: actorRow ? { actorId: actorRow.audit_actor_id, actorKind: actorRow.actor_kind as ReportRef["createdBy"]["actorKind"], displayName: actorRow.display_name } : { actorId: "", actorKind: "system", displayName: "" },
    };
  }

  // availableCommands: only the 7 project lifecycle commands, derived for the
  // current actor and the same snapshot. Unimplemented commands are NOT listed.
  const availableCommands = deriveProjectCommands({
    status: p.projectStatus,
    archived: p.archivedAt !== null,
    hasActiveRun: countActiveRuns(db, wsId, p.analysisProjectId) > 0,
    auditChainEntered: hasEnteredAuditChain(db, wsId, p.analysisProjectId),
    actorActiveHuman,
  });

  return {
    project: {
      projectId: p.analysisProjectId, kind: p.projectKind, title: p.title, slug: p.slug, status: p.projectStatus,
      stage, createdAt: p.createdAt, updatedAt: p.updatedAt, completedAt: p.completedAt,
      rejectedAt: p.rejectedAt, cancelledAt: p.cancelledAt, archivedAt: p.archivedAt,
      sourceProjectId: p.sourceProjectId, sourceRelationType: p.sourceRelationType,
    },
    analysisRequest, inputEvidence, sources, currentRequirement, currentPlan,
    latestRun: latestRunRef, latestReport, lockedReportId, pendingGate, availableCommands,
  };
}

function versionRef(db: DatabaseSync, workspaceId: string, versionId: string | null, table: string, idCol: string): VersionRef | null {
  if (!versionId) return null;
  const WS_SCOPE = `AND analysis_project_id IN (SELECT analysis_project_id FROM analysis_projects WHERE workspace_id = ?)`;
  const row = db.prepare(`SELECT ${idCol} AS id, version_ordinal, schema_version, content_sha256, created_at, created_by_actor_id, supersedes_version_id FROM ${table} WHERE ${idCol} = ? ${WS_SCOPE}`).get(versionId, workspaceId) as
    | { id: string; version_ordinal: number; schema_version: string; content_sha256: string; created_at: string; created_by_actor_id: string; supersedes_version_id: string | null } | undefined;
  if (!row) return null;
  const actorRow = db.prepare(`SELECT audit_actor_id, actor_kind, display_name FROM audit_actors WHERE audit_actor_id = ?`).get(row.created_by_actor_id) as
    | { audit_actor_id: string; actor_kind: string; display_name: string } | undefined;
  return {
    versionId: row.id, versionOrdinal: row.version_ordinal, schemaVersion: row.schema_version,
    contentSha256: row.content_sha256, createdAt: row.created_at,
    createdBy: actorRow ? { actorId: actorRow.audit_actor_id, actorKind: actorRow.actor_kind as VersionRef["createdBy"]["actorKind"], displayName: actorRow.display_name } : { actorId: "", actorKind: "system", displayName: "" },
    supersedesVersionId: row.supersedes_version_id,
  };
}
