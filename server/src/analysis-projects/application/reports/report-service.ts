/**
 * Report application service (§6.4, API-027/API-041).
 *
 * - report.decide_review: Human Gate on the latest ReportVersion. approved ->
 *   GateDecision + Project completed in ONE transaction. rejected -> GateDecision
 *   + Project rejected in ONE transaction. changes_requested -> GateDecision
 *   with revisionScope persisted in requested_changes_json; no new Run, no
 *   Project status change.
 *
 * Contract:
 * - Backend is the sole business persistence writer.
 * - Idempotency: claimOn -> execute -> recordSuccessInTx/recordFailure.
 * - Gate target: target_object_type='report_version', target_object_id=reportVersionId,
 *   target_schema_version and target_content_sha256 must match the ReportVersion row.
 * - Same target only one GateDecision (UNIQUE gate_type, target_object_type, target_object_id).
 * - At most one approved report_review per project (partial unique index).
 * - approved + Project completed share ONE transaction; rejected + Project rejected
 *   share ONE transaction. All business mutations INSIDE the same BEGIN/COMMIT as
 *   recordSuccessInTx (T0009 lesson: no cross-transaction business writes).
 * - changes_requested only records the Gate and revision intent; no new Run.
 *   revisionScope must be report_revision | plan_revision | requirement_revision.
 *
 * Safety:
 * - Gate payload (requested_changes_json) never contains forbidden content.
 * - revisionScope persisted per Backend-assigned requested change object.
 */
import type { DatabaseSync } from "node:sqlite";
import { claimOn, recordSuccessInTx } from "../idempotency/idempotency-service.ts";
import { computeRequestHash, now, uuid, isUuidV4, type TrustedActorContext } from "../shared/runtime.ts";
import { ApplicationError } from "../../contracts/envelope.ts";
import type { CommandResult } from "../shared/command.ts";
import { requireProject, assertActiveHuman, handleClaim, failWith, mapErr } from "../projects/project-service.ts";
import { getActorById } from "../actors/actor-service.ts";
import type { DataRootLayout } from "../../persistence/data-root.ts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ReportDecision = "approved" | "changes_requested" | "rejected";

export type RevisionScope = "report_revision" | "plan_revision" | "requirement_revision";

export interface ReportRequestedChange {
  readonly summary: string;
  readonly rationale: string | null;
  readonly affectedFieldPaths: readonly string[];
}

export interface DecideReviewBody {
  readonly targetSchemaVersion: string;
  readonly targetContentSha256: string;
  readonly decision: ReportDecision;
  readonly comment: string | null;
  readonly requestedChanges: readonly ReportRequestedChange[];
  readonly rejectionReason: string | null;
  readonly revisionScope: RevisionScope | null;
}

export interface DecideReviewInput {
  readonly db: DatabaseSync;
  readonly layout: DataRootLayout;
  readonly workspaceId: string;
  readonly actorContext: TrustedActorContext;
  readonly idempotencyKey: string;
  readonly projectId: string;
  readonly reportVersionId: string;
  readonly body: DecideReviewBody;
}

export interface ReportGateDecisionResult {
  readonly gateDecisionId: string;
  readonly analysisProjectId: string;
  readonly gateType: "report_review";
  readonly targetObjectType: "report_version";
  readonly targetObjectId: string;
  readonly decision: ReportDecision;
  readonly decidedAt: string;
  readonly decidedByActorId: string;
  readonly revisionScope: RevisionScope | null;
  readonly projectStatus: string;
}

// ---------------------------------------------------------------------------
// ReportVersion row type
// ---------------------------------------------------------------------------

export interface ReportVersionRow {
  readonly reportVersionId: string;
  readonly analysisProjectId: string;
  readonly analysisRunId: string;
  readonly structuredRequirementVersionId: string;
  readonly analysisPlanVersionId: string;
  readonly versionOrdinal: number;
  readonly supersedesVersionId: string | null;
  readonly schemaVersion: string;
  readonly contentSha256: string;
  readonly storageRef: string;
  readonly createdAt: string;
  readonly createdByActorId: string;
}

interface ReportVersionRowShape {
  report_version_id: string;
  analysis_project_id: string;
  analysis_run_id: string;
  structured_requirement_version_id: string;
  analysis_plan_version_id: string;
  version_ordinal: number;
  supersedes_version_id: string | null;
  schema_version: string;
  content_sha256: string;
  storage_ref: string;
  created_at: string;
  created_by_actor_id: string;
}

const REPORT_VERSION_SELECT =
  "report_version_id, analysis_project_id, analysis_run_id, " +
  "structured_requirement_version_id, analysis_plan_version_id, version_ordinal, " +
  "supersedes_version_id, schema_version, content_sha256, storage_ref, " +
  "created_at, created_by_actor_id";

function rowToReportVersion(row: ReportVersionRowShape): ReportVersionRow {
  return {
    reportVersionId: row.report_version_id,
    analysisProjectId: row.analysis_project_id,
    analysisRunId: row.analysis_run_id,
    structuredRequirementVersionId: row.structured_requirement_version_id,
    analysisPlanVersionId: row.analysis_plan_version_id,
    versionOrdinal: row.version_ordinal,
    supersedesVersionId: row.supersedes_version_id,
    schemaVersion: row.schema_version,
    contentSha256: row.content_sha256,
    storageRef: row.storage_ref,
    createdAt: row.created_at,
    createdByActorId: row.created_by_actor_id,
  };
}

export function getReportVersionById(db: DatabaseSync, workspaceId: string, reportVersionId: string): ReportVersionRow | null {
  const row = db.prepare(`SELECT ${REPORT_VERSION_SELECT} FROM report_versions WHERE report_version_id = ? AND analysis_project_id IN (SELECT analysis_project_id FROM analysis_projects WHERE workspace_id = ?)`).get(reportVersionId, workspaceId) as ReportVersionRowShape | undefined;
  return row ? rowToReportVersion(row) : null;
}

/** Get the latest ReportVersion (highest version_ordinal) for a project. */
export function getLatestReportVersion(db: DatabaseSync, workspaceId: string, projectId: string): ReportVersionRow | null {
  const row = db.prepare(
    `SELECT ${REPORT_VERSION_SELECT} FROM report_versions WHERE analysis_project_id = ? AND analysis_project_id IN (SELECT analysis_project_id FROM analysis_projects WHERE workspace_id = ?) ORDER BY version_ordinal DESC LIMIT 1`,
  ).get(projectId, workspaceId) as ReportVersionRowShape | undefined;
  return row ? rowToReportVersion(row) : null;
}

const REVISION_SCOPES = new Set<RevisionScope>(["report_revision", "plan_revision", "requirement_revision"]);

/** Check if an evidence artifact is an admitted plan input for a given run. */
function isAdmittedPlanInput(db: DatabaseSync, runId: string, evidenceArtifactId: string): boolean {
  const row = db.prepare(
    "SELECT evidence_artifact_id FROM analysis_run_input_evidence WHERE analysis_run_id = ? AND evidence_artifact_id = ?",
  ).get(runId, evidenceArtifactId) as { evidence_artifact_id: string } | undefined;
  return row !== undefined;
}

// ---------------------------------------------------------------------------
// Decision condition validation
// ---------------------------------------------------------------------------

function validateDecisionConditions(
  decision: ReportDecision,
  requestedChanges: readonly ReportRequestedChange[],
  rejectionReason: string | null,
  revisionScope: RevisionScope | null,
): void {
  if (decision === "approved") {
    if (requestedChanges.length > 0) {
      throw new ApplicationError("validation_failed", "approved decision must have empty requestedChanges.", { fieldErrors: [{ fieldPath: "/requestedChanges", code: "must_be_empty", summary: "approved requires no requested changes" }] });
    }
    if (rejectionReason !== null) {
      throw new ApplicationError("validation_failed", "approved decision must have null rejectionReason.", { fieldErrors: [{ fieldPath: "/rejectionReason", code: "must_be_null", summary: "approved requires null rejection reason" }] });
    }
    if (revisionScope !== null) {
      throw new ApplicationError("validation_failed", "approved decision must have null revisionScope.", { fieldErrors: [{ fieldPath: "/revisionScope", code: "must_be_null", summary: "approved requires null revisionScope" }] });
    }
  } else if (decision === "changes_requested") {
    if (requestedChanges.length === 0) {
      throw new ApplicationError("validation_failed", "changes_requested decision must have non-empty requestedChanges.", { fieldErrors: [{ fieldPath: "/requestedChanges", code: "must_be_non_empty", summary: "changes_requested requires at least one requested change" }] });
    }
    if (rejectionReason !== null) {
      throw new ApplicationError("validation_failed", "changes_requested decision must have null rejectionReason.", { fieldErrors: [{ fieldPath: "/rejectionReason", code: "must_be_null", summary: "changes_requested requires null rejection reason" }] });
    }
    if (revisionScope === null) {
      throw new ApplicationError("validation_failed", "changes_requested decision must have non-null revisionScope.", { fieldErrors: [{ fieldPath: "/revisionScope", code: "required", summary: "changes_requested requires a revisionScope" }] });
    }
    if (!REVISION_SCOPES.has(revisionScope)) {
      throw new ApplicationError("validation_failed", "revisionScope must be report_revision, plan_revision, or requirement_revision.", { fieldErrors: [{ fieldPath: "/revisionScope", code: "invalid_enum", summary: "Must be report_revision, plan_revision, or requirement_revision" }] });
    }
    // Validate each requested change
    for (let i = 0; i < requestedChanges.length; i++) {
      const rc = requestedChanges[i]!;
      if (typeof rc.summary !== "string" || rc.summary.trim().length === 0) {
        throw new ApplicationError("validation_failed", `requestedChanges[${i}].summary must be non-empty.`, { fieldErrors: [{ fieldPath: `/requestedChanges/${i}/summary`, code: "empty", summary: "summary must be non-empty" }] });
      }
      if (!Array.isArray(rc.affectedFieldPaths) || rc.affectedFieldPaths.length === 0) {
        throw new ApplicationError("validation_failed", `requestedChanges[${i}].affectedFieldPaths must be non-empty.`, { fieldErrors: [{ fieldPath: `/requestedChanges/${i}/affectedFieldPaths`, code: "empty", summary: "affectedFieldPaths must be non-empty" }] });
      }
      for (let j = 0; j < rc.affectedFieldPaths.length; j++) {
        if (typeof rc.affectedFieldPaths[j] !== "string" || !rc.affectedFieldPaths[j].startsWith("/")) {
          throw new ApplicationError("validation_failed", `requestedChanges[${i}].affectedFieldPaths[${j}] must be a valid RFC 6901 JSON Pointer.`, { fieldErrors: [{ fieldPath: `/requestedChanges/${i}/affectedFieldPaths/${j}`, code: "invalid_pointer", summary: "Must be a valid JSON Pointer starting with /" }] });
        }
      }
    }
  } else if (decision === "rejected") {
    if (requestedChanges.length > 0) {
      throw new ApplicationError("validation_failed", "rejected decision must have empty requestedChanges.", { fieldErrors: [{ fieldPath: "/requestedChanges", code: "must_be_empty", summary: "rejected requires no requested changes" }] });
    }
    if (rejectionReason === null || rejectionReason.trim().length === 0) {
      throw new ApplicationError("validation_failed", "rejected decision must have non-empty rejectionReason.", { fieldErrors: [{ fieldPath: "/rejectionReason", code: "required", summary: "rejected requires a rejection reason" }] });
    }
    if (revisionScope !== null) {
      throw new ApplicationError("validation_failed", "rejected decision must have null revisionScope.", { fieldErrors: [{ fieldPath: "/revisionScope", code: "must_be_null", summary: "rejected requires null revisionScope" }] });
    }
  } else {
    throw new ApplicationError("validation_failed", `Unknown decision: ${decision}.`, { fieldErrors: [{ fieldPath: "/decision", code: "invalid_enum", summary: "Must be approved, changes_requested, or rejected" }] });
  }
}

export { validateDecisionConditions };

// ---------------------------------------------------------------------------
// decideReview: report.decide_review command (§6.4)
// ---------------------------------------------------------------------------

export function decideReview(input: DecideReviewInput): CommandResult<ReportGateDecisionResult> {
  const { db, layout: _layout, workspaceId, actorContext, idempotencyKey, projectId, reportVersionId, body } = input;
  // layout is not used for decide_review (no blob reads needed; hash/schema
  // are validated against the report_versions row). Kept in the input type for
  // API symmetry with other decide commands and future revision-run creation.

  // 1. Actor validation
  assertActiveHuman(actorContext);

  // 2. Idempotency claim FIRST (before business state checks to allow replays)
  const requestHash = computeRequestHash("POST", `/api/v1/projects/${projectId}/reports/${reportVersionId}:decide-review`, body);
  const claim = claimOn(db, { actorId: actorContext.actorId, commandType: "report.decide_review", idempotencyKey, requestHash });
  const pre = handleClaim(claim);
  if (pre) return pre;

  // 3. Project validation (after claim; business failures recorded via failWith)
  let proj;
  try {
    proj = requireProject(db, workspaceId, projectId);
  } catch (err) {
    if (err instanceof ApplicationError) return failWith(db, claim.recordId, err);
    throw err;
  }
  if (proj.projectStatus !== "active") {
    return failWith(db, claim.recordId, new ApplicationError("invalid_state_transition", "Cannot decide report review for a non-active project."));
  }
  if (proj.archivedAt !== null) {
    return failWith(db, claim.recordId, new ApplicationError("invalid_state_transition", "Cannot decide report review for an archived project."));
  }

  // 4. ReportVersion validation
  if (!isUuidV4(reportVersionId)) {
    return failWith(db, claim.recordId, new ApplicationError("resource_not_found", "Report version not found."));
  }
  const reportVersion = getReportVersionById(db, workspaceId, reportVersionId);
  if (!reportVersion || reportVersion.analysisProjectId !== projectId) {
    return failWith(db, claim.recordId, new ApplicationError("resource_not_found", "Report version not found."));
  }

  // 5. Must be the latest ReportVersion (current review target)
  const latest = getLatestReportVersion(db, workspaceId, projectId);
  if (!latest || latest.reportVersionId !== reportVersion.reportVersionId) {
    return failWith(db, claim.recordId, new ApplicationError("invalid_state_transition", "Can only decide on the latest report version."));
  }

  // 6. Target identity/schema/hash validation
  if (body.targetSchemaVersion !== reportVersion.schemaVersion) {
    return failWith(db, claim.recordId, new ApplicationError("content_hash_mismatch", "Target schema version does not match."));
  }
  if (body.targetContentSha256 !== reportVersion.contentSha256) {
    return failWith(db, claim.recordId, new ApplicationError("content_hash_mismatch", "Target content hash does not match."));
  }

  // 7. Run must be succeeded with stage S2.4
  const runRow = db.prepare(`SELECT current_run_status, current_analysis_stage FROM analysis_runs WHERE analysis_run_id = ? AND analysis_project_id IN (SELECT analysis_project_id FROM analysis_projects WHERE workspace_id = ?)`).get(reportVersion.analysisRunId, workspaceId) as
    | { current_run_status: string; current_analysis_stage: string }
    | undefined;
  if (!runRow) {
    return failWith(db, claim.recordId, new ApplicationError("internal_review_not_passed", "Run bound to report version does not exist."));
  }
  if (runRow.current_run_status !== "succeeded") {
    return failWith(db, claim.recordId, new ApplicationError("internal_review_not_passed", "Run bound to report version has not succeeded."));
  }
  if (runRow.current_analysis_stage !== "S2.4") {
    return failWith(db, claim.recordId, new ApplicationError("internal_review_not_passed", "Run bound to report version has not reached S2.4."));
  }

  // 8. Latest internal review passed Evidence must exist.
  // The run_succeeded event payload contains internalReviewEvidenceArtifactId;
  // its existence + run succeeded implies the internal review passed (validated
  // before run_succeeded was written in T0009 mapEngineSuccessToDurable).
  const successEventRow = db.prepare(
    "SELECT payload_json FROM run_events WHERE analysis_run_id = ? AND event_type = 'run_succeeded' ORDER BY sequence DESC LIMIT 1",
  ).get(reportVersion.analysisRunId) as { payload_json: string } | undefined;
  if (!successEventRow) {
    return failWith(db, claim.recordId, new ApplicationError("internal_review_not_passed", "Run succeeded event not found; internal review cannot be verified."));
  }
  let internalReviewEvidenceId: string | null = null;
  try {
    const payload = JSON.parse(successEventRow.payload_json) as { internalReviewEvidenceArtifactId?: string };
    internalReviewEvidenceId = payload.internalReviewEvidenceArtifactId ?? null;
  } catch {
    return failWith(db, claim.recordId, new ApplicationError("internal_review_not_passed", "Run succeeded event payload is malformed."));
  }
  if (!internalReviewEvidenceId) {
    return failWith(db, claim.recordId, new ApplicationError("internal_review_not_passed", "Internal review evidence not recorded in run succeeded event."));
  }
  const reviewEvidenceRow = db.prepare(
    `SELECT evidence_artifact_id, artifact_kind, visibility FROM evidence_artifacts WHERE evidence_artifact_id = ? AND analysis_project_id IN (SELECT analysis_project_id FROM analysis_projects WHERE workspace_id = ?)`,
  ).get(internalReviewEvidenceId, workspaceId) as { evidence_artifact_id: string; artifact_kind: string; visibility: string } | undefined;
  if (!reviewEvidenceRow) {
    return failWith(db, claim.recordId, new ApplicationError("internal_review_not_passed", "Internal review evidence artifact not found."));
  }
  if (reviewEvidenceRow.artifact_kind !== "intermediate_result" || reviewEvidenceRow.visibility !== "review_only") {
    return failWith(db, claim.recordId, new ApplicationError("internal_review_not_passed", "Internal review evidence does not have the expected artifact kind / visibility."));
  }

  // 9. ReportVersionEvidence must be complete (at least one cited evidence link)
  const evidenceLinkCount = (db.prepare("SELECT COUNT(*) AS c FROM report_version_evidence WHERE report_version_id = ?").get(reportVersionId) as { c: number }).c;
  if (evidenceLinkCount === 0) {
    return failWith(db, claim.recordId, new ApplicationError("citation_invalid", "Report version has no cited evidence."));
  }

  // 10. Citation validity (P0-46): each cited evidence must belong to the same
  // project, be produced by the current Run or be an admitted Plan input, and
  // restricted_raw / diagnostic must not support business conclusions.
  const citedEvidenceRows = db.prepare(
    `SELECT ea.evidence_artifact_id, ea.safety_class, ea.artifact_kind, ea.analysis_run_id, ea.analysis_project_id
     FROM report_version_evidence rve
     JOIN evidence_artifacts ea ON rve.evidence_artifact_id = ea.evidence_artifact_id
     WHERE rve.report_version_id = ? AND ea.analysis_project_id IN (SELECT analysis_project_id FROM analysis_projects WHERE workspace_id = ?)
     ORDER BY rve.evidence_ordinal ASC`,
  ).all(reportVersionId, workspaceId) as Array<{
    evidence_artifact_id: string; safety_class: string; artifact_kind: string;
    analysis_run_id: string | null; analysis_project_id: string;
  }>;
  for (const ce of citedEvidenceRows) {
    if (ce.analysis_project_id !== projectId) {
      return failWith(db, claim.recordId, new ApplicationError("citation_invalid", "Cited evidence does not belong to this project."));
    }
    if (ce.safety_class === "restricted_raw") {
      return failWith(db, claim.recordId, new ApplicationError("citation_invalid", "restricted_raw evidence must not support business conclusions."));
    }
    if (ce.artifact_kind === "diagnostic") {
      return failWith(db, claim.recordId, new ApplicationError("citation_invalid", "diagnostic evidence must not support business conclusions."));
    }
    const isRunOutput = ce.analysis_run_id === reportVersion.analysisRunId;
    const isPlanInput = ce.analysis_run_id === null && isAdmittedPlanInput(db, reportVersion.analysisRunId, ce.evidence_artifact_id);
    if (!isRunOutput && !isPlanInput) {
      return failWith(db, claim.recordId, new ApplicationError("citation_invalid", "Cited evidence is not produced by the current run or admitted as plan input."));
    }
  }

  // 11. No existing report_review Gate for this target
  const existingGate = db.prepare(
    `SELECT gate_decision_id FROM gate_decisions WHERE gate_type = 'report_review' AND target_object_type = 'report_version' AND target_object_id = ? AND analysis_project_id IN (SELECT analysis_project_id FROM analysis_projects WHERE workspace_id = ?)`,
  ).get(reportVersionId, workspaceId) as { gate_decision_id: string } | undefined;
  if (existingGate) {
    return failWith(db, claim.recordId, new ApplicationError("gate_already_decided", "A report review gate decision already exists for this report version."));
  }

  // 12. No other approved report_review in this project (partial unique index)
  const existingApproved = db.prepare(
    `SELECT gate_decision_id FROM gate_decisions WHERE analysis_project_id = ? AND analysis_project_id IN (SELECT analysis_project_id FROM analysis_projects WHERE workspace_id = ?) AND gate_type = 'report_review' AND decision = 'approved'`,
  ).get(projectId, workspaceId) as { gate_decision_id: string } | undefined;
  if (existingApproved) {
    return failWith(db, claim.recordId, new ApplicationError("invalid_state_transition", "An approved report review already exists for this project."));
  }

  // 13. Decision condition validation (including revisionScope for changes_requested)
  try {
    validateDecisionConditions(body.decision, body.requestedChanges, body.rejectionReason, body.revisionScope);
  } catch (err) {
    if (err instanceof ApplicationError) return failWith(db, claim.recordId, err);
    throw err;
  }

  // 14. Get actor display name snapshot
  const actor = getActorById(db, actorContext.actorId);
  const actorDisplayName = actor?.displayName ?? "Unknown";

  // 15. Build requestedChangesJson with Backend-assigned UUIDs + revisionScope
  const requestedChangesJson = body.requestedChanges.map((rc) => ({
    requestedChangeId: uuid(),
    summary: rc.summary,
    rationale: rc.rationale,
    affectedFieldPaths: rc.affectedFieldPaths,
    revisionScope: body.revisionScope,
  }));

  // 16. Atomic transaction: Gate insert + Project terminal update (approved/rejected)
  //     + receipt. ALL business mutations INSIDE this BEGIN/COMMIT (T0009 lesson).
  const gateId = uuid();
  const ts = now();
  db.exec("BEGIN");
  try {
    // Re-validate Project active/not archived inside the transaction
    const projNow = db.prepare(`SELECT project_status, archived_at FROM analysis_projects WHERE analysis_project_id = ? AND workspace_id = ?`).get(projectId, workspaceId) as
      | { project_status: string; archived_at: string | null };
    if (projNow.project_status !== "active") throw new ApplicationError("invalid_state_transition", "Project is no longer active.");
    if (projNow.archived_at !== null) throw new ApplicationError("invalid_state_transition", "Project is archived.");

    // Re-validate no existing gate for this target (inside transaction)
    const existingGateNow = db.prepare(
      `SELECT gate_decision_id FROM gate_decisions WHERE gate_type = 'report_review' AND target_object_type = 'report_version' AND target_object_id = ? AND analysis_project_id IN (SELECT analysis_project_id FROM analysis_projects WHERE workspace_id = ?)`,
    ).get(reportVersionId, workspaceId) as { gate_decision_id: string } | undefined;
    if (existingGateNow) throw new ApplicationError("gate_already_decided", "A report review gate decision already exists for this report version.");

    // Re-validate no other approved report_review (inside transaction)
    const existingApprovedNow = db.prepare(
      `SELECT gate_decision_id FROM gate_decisions WHERE analysis_project_id = ? AND analysis_project_id IN (SELECT analysis_project_id FROM analysis_projects WHERE workspace_id = ?) AND gate_type = 'report_review' AND decision = 'approved'`,
    ).get(projectId, workspaceId) as { gate_decision_id: string } | undefined;
    if (existingApprovedNow) throw new ApplicationError("invalid_state_transition", "An approved report review already exists for this project.");

    // Insert gate decision
    db.prepare(
      `INSERT INTO gate_decisions (
        gate_decision_id, analysis_project_id, gate_type, target_object_type,
        target_object_id, target_schema_version, target_content_sha256,
        decision, decided_at, decided_by_actor_id, actor_display_name_snapshot,
        comment, requested_changes_json, rejection_reason, submitted_via, client_version
      ) VALUES (?, ?, 'report_review', 'report_version', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      gateId, projectId, reportVersionId,
      body.targetSchemaVersion, body.targetContentSha256,
      body.decision, ts, actorContext.actorId, actorDisplayName,
      body.comment, JSON.stringify(requestedChangesJson),
      body.rejectionReason, actorContext.submittedVia, actorContext.clientVersion,
    );

    // Project terminal update for approved/rejected (same transaction as Gate)
    let finalProjectStatus: string = proj!.projectStatus;
    if (body.decision === "approved") {
      db.prepare(
        `UPDATE analysis_projects SET project_status = 'completed', completed_at = ?, updated_at = ? WHERE analysis_project_id = ? AND workspace_id = ? AND project_status = 'active'`,
      ).run(ts, ts, projectId, workspaceId);
      finalProjectStatus = "completed";
    } else if (body.decision === "rejected") {
      db.prepare(
        `UPDATE analysis_projects SET project_status = 'rejected', rejected_at = ?, updated_at = ? WHERE analysis_project_id = ? AND workspace_id = ? AND project_status = 'active'`,
      ).run(ts, ts, projectId, workspaceId);
      finalProjectStatus = "rejected";
    }
    // changes_requested: Project stays active, no terminal update.

    // Record idempotency success in the SAME transaction
    recordSuccessInTx(db, claim.recordId, { httpStatus: 201, resultResourceType: "Gate", resultResourceId: gateId });
    db.exec("COMMIT");

    return {
      kind: "executed",
      httpStatus: 201,
      resultResourceType: "Gate",
      resultResourceId: gateId,
      recordId: claim.recordId,
      data: {
        gateDecisionId: gateId,
        analysisProjectId: projectId,
        gateType: "report_review",
        targetObjectType: "report_version",
        targetObjectId: reportVersionId,
        decision: body.decision,
        decidedAt: ts,
        decidedByActorId: actorContext.actorId,
        revisionScope: body.revisionScope,
        projectStatus: finalProjectStatus,
      },
    };
  } catch (err) {
    db.exec("ROLLBACK");
    if (err instanceof ApplicationError) {
      return failWith(db, claim.recordId, err);
    }
    return failWith(db, claim.recordId, mapErr(err));
  }
}
