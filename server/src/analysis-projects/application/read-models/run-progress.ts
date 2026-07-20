/**
 * RunProgressReadModel (§7.5, API-025).
 *
 * Non-materialized, single SQLite read snapshot.
 * - Run snapshot, derived stages/steps/current step, inputs/outputs.
 * - latest InternalReview, safe events page, commands/eligibility.
 * - afterSequence default 0; limit default 100, max 500.
 * - Does NOT return raw payload, piSessionRef, stdout/stderr, prompt, token,
 *   hidden reasoning, absolute path, or Evidence content.
 */
import type { DatabaseSync } from "node:sqlite";
import { ApplicationError } from "../../contracts/envelope.ts";
import { getProjectById, countActiveRuns } from "../projects/project-queries.ts";
import type { ReadModelEnvelope, EvidenceRef, RunRef, ReportRef, ActorRef, Eligibility, CommandAffordance } from "../../contracts/dto.ts";
import type { TrustedActorContext } from "../shared/runtime.ts";
import { getRunById } from "../runs/run-coordinator.ts";
import { getPlanVersionById } from "../plans/plan-service.ts";
import { getRequirementVersionById } from "../requirements/requirement-service.ts";
import { getActorById } from "../actors/actor-service.ts";

const READ_MODEL_VERSION = "1.0";
const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 500;
const WS_SCOPE = `AND analysis_project_id IN (SELECT analysis_project_id FROM analysis_projects WHERE workspace_id = ?)`;

export interface RunProgressData {
  readonly project: {
    readonly projectId: string;
    readonly kind: string;
    readonly title: string;
    readonly slug: string;
    readonly status: string;
  };
  readonly run: RunRef;
  readonly planVersion: {
    readonly versionId: string;
    readonly versionOrdinal: number;
    readonly schemaVersion: string;
    readonly contentSha256: string;
  } | null;
  readonly requirementVersion: {
    readonly versionId: string;
    readonly versionOrdinal: number;
    readonly schemaVersion: string;
    readonly contentSha256: string;
  } | null;
  readonly currentStage: string;
  readonly currentStep: { readonly planStepId: string; readonly stepOrdinal: number } | null;
  readonly inputEvidence: readonly EvidenceRef[];
  readonly producedEvidence: readonly EvidenceRef[];
  readonly latestInternalReview: {
    readonly evidenceArtifactId: string;
    readonly displayName: string;
    readonly createdAt: string;
  } | null;
  readonly reportVersion: ReportRef | null;
  readonly events: {
    readonly items: readonly SafeRunEvent[];
    readonly afterSequence: number;
    readonly limit: number;
    readonly hasMore: boolean;
    readonly nextAfterSequence: number | null;
  };
  readonly commands: readonly CommandAffordance[];
  readonly abortEligibility: Eligibility;
  readonly retryEligibility: Eligibility;
}

export interface SafeRunEvent {
  readonly sequence: number;
  readonly eventType: string;
  readonly analysisStageAfter: string;
  readonly runStatusAfter: string;
  readonly occurredAt: string;
  readonly recordedAt: string;
  readonly producerName: string;
  readonly payloadSchemaVersion: string;
  /** Safe payload: no raw diagnostics, no forbidden keys. */
  readonly payload: unknown;
}

export interface RunProgressQuery {
  readonly db: DatabaseSync;
  readonly workspaceId: string;
  readonly projectId: string;
  readonly runId: string;
  readonly actorContext: TrustedActorContext;
  readonly afterSequence?: number;
  readonly limit?: number;
}

export function queryRunProgress(query: RunProgressQuery): ReadModelEnvelope<RunProgressData> {
  const { db, workspaceId, projectId, runId, actorContext, afterSequence = 0, limit = DEFAULT_LIMIT } = query;

  // Validate pagination
  if (!Number.isInteger(afterSequence) || afterSequence < 0) {
    throw new ApplicationError("invalid_cursor", "afterSequence must be a non-negative integer.");
  }
  const effectiveLimit = Math.min(Math.max(1, limit), MAX_LIMIT);

  db.exec("BEGIN");
  try {
    const project = getProjectById(db, workspaceId, projectId);
    if (!project) throw new ApplicationError("resource_not_found", "Project not found.");

    const run = getRunById(db, workspaceId, runId);
    if (!run || run.analysisProjectId !== projectId) {
      throw new ApplicationError("resource_not_found", "Run not found.");
    }

    // Build RunRef (no piSessionRef)
    const triggeredBy = getActorById(db, run.triggeredByActorId);
    const runRef: RunRef = {
      runId: run.analysisRunId,
      runOrdinal: run.runOrdinal,
      currentAnalysisStage: run.currentAnalysisStage,
      currentRunStatus: run.currentRunStatus,
      queuedAt: run.queuedAt,
      startedAt: run.startedAt,
      endedAt: run.endedAt,
      triggeredBy: {
        actorId: run.triggeredByActorId,
        actorKind: triggeredBy?.actorKind ?? "system",
        displayName: triggeredBy?.displayName ?? "Unknown",
      },
    };

    // Plan version binding
    let planVersion: RunProgressData["planVersion"] = null;
    const planRow = getPlanVersionById(db, workspaceId, run.analysisPlanVersionId);
    if (planRow && planRow.analysisProjectId === projectId) {
      planVersion = {
        versionId: planRow.analysisPlanVersionId,
        versionOrdinal: planRow.versionOrdinal,
        schemaVersion: planRow.schemaVersion,
        contentSha256: planRow.contentSha256,
      };
    }

    // Requirement version binding
    let requirementVersion: RunProgressData["requirementVersion"] = null;
    if (project.currentRequirementVersionId) {
      const reqRow = getRequirementVersionById(db, workspaceId, project.currentRequirementVersionId);
      if (reqRow && reqRow.analysisProjectId === projectId) {
        requirementVersion = {
          versionId: reqRow.structuredRequirementVersionId,
          versionOrdinal: reqRow.versionOrdinal,
          schemaVersion: reqRow.schemaVersion,
          contentSha256: reqRow.contentSha256,
        };
      }
    }

    // Input Evidence (from analysis_run_input_evidence, safe projection)
    const inputEvidenceRows = db.prepare(
      `SELECT ea.evidence_artifact_id, ea.display_name, ea.artifact_kind, ea.safety_class,
              ea.visibility, ea.media_type, ea.byte_size, ea.content_sha256, ea.created_at
       FROM analysis_run_input_evidence rie
       JOIN evidence_artifacts ea ON rie.evidence_artifact_id = ea.evidence_artifact_id
       WHERE rie.analysis_run_id = ?
       ORDER BY rie.input_ordinal ASC`,
    ).all(runId) as Array<{
      evidence_artifact_id: string; display_name: string; artifact_kind: string;
      safety_class: string; visibility: string; media_type: string;
      byte_size: number; content_sha256: string; created_at: string;
    }>;
    const inputEvidence: EvidenceRef[] = inputEvidenceRows.map((e) => ({
      evidenceArtifactId: e.evidence_artifact_id,
      displayName: e.display_name,
      artifactKind: e.artifact_kind,
      safetyClass: e.safety_class as EvidenceRef["safetyClass"],
      visibility: e.visibility as EvidenceRef["visibility"],
      mediaType: e.media_type,
      byteSize: e.byte_size,
      contentSha256: e.content_sha256,
      createdAt: e.created_at,
      contentHref: null,
    }));

    // Produced Evidence (from evidence_artifacts where analysis_run_id = runId)
    const producedEvidenceRows = db.prepare(
      `SELECT evidence_artifact_id, display_name, artifact_kind, safety_class,
              visibility, media_type, byte_size, content_sha256, created_at
       FROM evidence_artifacts
       WHERE analysis_run_id = ?
       ORDER BY created_at ASC`,
    ).all(runId) as Array<{
      evidence_artifact_id: string; display_name: string; artifact_kind: string;
      safety_class: string; visibility: string; media_type: string;
      byte_size: number; content_sha256: string; created_at: string;
    }>;
    const producedEvidence: EvidenceRef[] = producedEvidenceRows.map((e) => ({
      evidenceArtifactId: e.evidence_artifact_id,
      displayName: e.display_name,
      artifactKind: e.artifact_kind,
      safetyClass: e.safety_class as EvidenceRef["safetyClass"],
      visibility: e.visibility as EvidenceRef["visibility"],
      mediaType: e.media_type,
      byteSize: e.byte_size,
      contentSha256: e.content_sha256,
      createdAt: e.created_at,
      contentHref: null,
    }));

    // Latest internal review (intermediate_result + review_only)
    const reviewRow = db.prepare(
      `SELECT evidence_artifact_id, display_name, created_at
       FROM evidence_artifacts
       WHERE analysis_run_id = ? AND artifact_kind = 'intermediate_result' AND visibility = 'review_only'
       ORDER BY created_at DESC LIMIT 1`,
    ).get(runId) as { evidence_artifact_id: string; display_name: string; created_at: string } | undefined;
    const latestInternalReview = reviewRow
      ? { evidenceArtifactId: reviewRow.evidence_artifact_id, displayName: reviewRow.display_name, createdAt: reviewRow.created_at }
      : null;

    // ReportVersion ref
    let reportVersion: ReportRef | null = null;
    const reportRow = db.prepare(
      `SELECT report_version_id, version_ordinal, schema_version, content_sha256, created_at, created_by_actor_id
       FROM report_versions WHERE analysis_run_id = ? ORDER BY version_ordinal DESC LIMIT 1`,
    ).get(runId) as { report_version_id: string; version_ordinal: number; schema_version: string; content_sha256: string; created_at: string; created_by_actor_id: string } | undefined;
    if (reportRow) {
      const reportCreator = getActorById(db, reportRow.created_by_actor_id);
      reportVersion = {
        reportVersionId: reportRow.report_version_id,
        versionOrdinal: reportRow.version_ordinal,
        schemaVersion: reportRow.schema_version,
        contentSha256: reportRow.content_sha256,
        createdAt: reportRow.created_at,
        createdBy: {
          actorId: reportRow.created_by_actor_id,
          actorKind: reportCreator?.actorKind ?? "system",
          displayName: reportCreator?.displayName ?? "Unknown",
        },
      };
    }

    // Events page (afterSequence, limit)
    const eventRows = db.prepare(
      `SELECT sequence, event_type, analysis_stage_after, run_status_after,
              occurred_at, recorded_at, producer_name, payload_schema_version, payload_json
       FROM run_events
       WHERE analysis_run_id = ? AND sequence > ?
       ORDER BY sequence ASC
       LIMIT ?`,
    ).all(runId, afterSequence, effectiveLimit + 1) as Array<{
      sequence: number; event_type: string; analysis_stage_after: string;
      run_status_after: string; occurred_at: string; recorded_at: string;
      producer_name: string; payload_schema_version: string; payload_json: string;
    }>;
    const hasMore = eventRows.length > effectiveLimit;
    const pageRows = hasMore ? eventRows.slice(0, effectiveLimit) : eventRows;
    const safeEvents: SafeRunEvent[] = pageRows.map((e) => {
      let payload: unknown;
      try { payload = JSON.parse(e.payload_json); } catch { payload = {}; }
      return {
        sequence: e.sequence,
        eventType: e.event_type,
        analysisStageAfter: e.analysis_stage_after,
        runStatusAfter: e.run_status_after,
        occurredAt: e.occurred_at,
        recordedAt: e.recorded_at,
        producerName: e.producer_name,
        payloadSchemaVersion: e.payload_schema_version,
        payload: sanitizePayload(e.event_type, payload),
      };
    });
    const nextAfterSequence = hasMore && pageRows.length > 0 ? pageRows[pageRows.length - 1]!.sequence : null;

    // Current step: derived from latest plan_step_started or plan_step_completed event
    const currentStepRow = db.prepare(
      `SELECT payload_json FROM run_events
       WHERE analysis_run_id = ? AND event_type IN ('plan_step_started', 'plan_step_completed')
       ORDER BY sequence DESC LIMIT 1`,
    ).get(runId) as { payload_json: string } | undefined;
    let currentStep: { planStepId: string; stepOrdinal: number } | null = null;
    if (currentStepRow) {
      try {
        const p = JSON.parse(currentStepRow.payload_json) as { planStepId?: string; stepOrdinal?: number };
        if (typeof p.planStepId === "string" && typeof p.stepOrdinal === "number") {
          currentStep = { planStepId: p.planStepId, stepOrdinal: p.stepOrdinal };
        }
      } catch { /* ignore */ }
    }

    // Eligibility
    const actorActiveHuman = actorContext.actorKind === "human" && actorContext.active;
    const projectActive = project.projectStatus === "active" && project.archivedAt === null;
    const isTerminal = run.currentRunStatus === "succeeded" || run.currentRunStatus === "failed" || run.currentRunStatus === "aborted" || run.currentRunStatus === "blocked";
    const abortReasons: string[] = [];
    if (!actorActiveHuman) abortReasons.push("actor_not_active_human");
    if (!projectActive) abortReasons.push("project_not_active");
    if (isTerminal) abortReasons.push("run_terminal");
    const retryReasons: string[] = [];
    if (!actorActiveHuman) retryReasons.push("actor_not_active_human");
    if (!projectActive) retryReasons.push("project_not_active");
    if (!isTerminal) retryReasons.push("run_not_terminal");
    if (countActiveRuns(db, workspaceId, projectId) > 0) retryReasons.push("active_run");

    const commands: CommandAffordance[] = [
      { commandType: "run.abort", available: abortReasons.length === 0, unavailableReasons: abortReasons },
      { commandType: "run.retry", available: retryReasons.length === 0, unavailableReasons: retryReasons },
    ];

    db.exec("COMMIT");

    const data: RunProgressData = {
      project: {
        projectId: project.analysisProjectId,
        kind: project.projectKind,
        title: project.title,
        slug: project.slug,
        status: project.projectStatus,
      },
      run: runRef,
      planVersion,
      requirementVersion,
      currentStage: run.currentAnalysisStage,
      currentStep,
      inputEvidence,
      producedEvidence,
      latestInternalReview,
      reportVersion,
      events: {
        items: safeEvents,
        afterSequence,
        limit: effectiveLimit,
        hasMore,
        nextAfterSequence,
      },
      commands,
      abortEligibility: { eligible: abortReasons.length === 0, reasons: abortReasons },
      retryEligibility: { eligible: retryReasons.length === 0, reasons: retryReasons },
    };

    return { readModelVersion: READ_MODEL_VERSION, generatedAt: new Date().toISOString(), data };
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
}

/**
 * Sanitize a RunEvent payload for safe projection.
 * Strips any raw diagnostic fields and ensures no forbidden keys leak.
 */
function sanitizePayload(eventType: string, payload: unknown): unknown {
  if (payload === null || typeof payload !== "object" || Array.isArray(payload)) return payload;
  const obj = payload as Record<string, unknown>;
  // Remove any forbidden keys that should never appear in safe projections
  const FORBIDDEN = new Set(["rawDiagnostic", "rawPiEvent", "rawPiEvents", "prompt", "hiddenReasoning", "token", "storageRef", "piSessionRef", "stdout", "stderr", "stack", "sql", "path", "absolutePath"]);
  const safe: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (!FORBIDDEN.has(key)) safe[key] = value;
  }
  return safe;
}
