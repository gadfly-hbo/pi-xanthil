/**
 * Durable Run coordinator service (§14, API-049/API-050/API-052).
 *
 * Backend is the sole business persistence writer. The Analysis Engine returns
 * execution candidate/suggestion only; Backend maps candidate handles to durable
 * IDs, writes blobs, inserts EvidenceArtifact/RunEvent/ReportVersion rows, and
 * owns transaction atomicity.
 *
 * Responsibilities:
 * - claim next queued Run (queuedAt ASC, runId ASC); re-validate preconditions
 *   in the claim transaction; atomically write run_started + snapshot running.
 * - call Engine execution handler (executeQueuedRun) with AbortSignal.
 * - map Engine success output to durable facts: derived Evidence (blobs +
 *   evidence_artifacts), validated RunEvents (contiguous sequence, schema
 *   validation, stage monotonicity), internal review Evidence, ReportVersion +
 *   ReportVersionEvidence, run_succeeded, snapshot succeeded.
 * - map Engine failure/timeout/abort/policy_blocked to terminal run state with
 *   safe (redacted) payloads.
 * - abort queued/running Run; retry failed/aborted/blocked Run.
 *
 * Contract:
 * - §13 RunEvent taxonomy: 12 types, payload schema workcanger.run-event.<type>/1.0.
 * - §14 durable Run coordinator: single active Run per project; Engine start
 *   failure terminates failed (no queued rollback); terminal after terminal
 *   rejected.
 * - §12.4 Backend allocates durable IDs, writes blob/hash/metadata; Engine
 *   candidate handles never enter RunEvent payloads.
 * - §7.5 RunProgressReadModel: safe projection, no raw payload/piSessionRef.
 * - §6.4 abort: queued terminated by Backend; running via AbortSignal.
 * - §6.4 retry: only failed/aborted/blocked; new queued Run with retry_of.
 *
 * Safety:
 * - Terminal payloads must be redacted: no raw stack/stdout/stderr/path/token.
 * - Candidate Evidence handles never enter durable RunEvent payloads; Backend
 *   maps them to durable evidenceArtifactIds before writing events.
 * - Evidence admission is fail-closed: only controlled/derived.
 */
import type { DatabaseSync } from "node:sqlite";
import { claimOn, recordSuccessInTx, recordFailure } from "../idempotency/idempotency-service.ts";
import { computeRequestHash, now, uuid, isUuidV4, type TrustedActorContext } from "../shared/runtime.ts";
import { ApplicationError } from "../../contracts/envelope.ts";
import type { CommandResult } from "../shared/command.ts";
import { requireProject, assertActiveHuman, handleClaim, failWith, mapErr } from "../projects/project-service.ts";
import { countActiveRuns, getProjectById } from "../projects/project-queries.ts";
import type { EnginePortRequest, EnginePortResultEnvelope } from "../../contracts/engine-port.ts";
import { ENGINE_PORT_VERSION, runEventSchemaVersion, type RunStatus } from "../../contracts/registries.ts";
import { validateRunEventPayload } from "../../contracts/run-event.ts";
import { writeCanonicalJsonBlob, readBlob } from "../../persistence/blob-writer.ts";
import { canonicalJsonStringify } from "../../persistence/canonical-json.ts";
import { sha256HexBytes } from "../../persistence/sha256.ts";
import type { DataRootLayout } from "../../persistence/data-root.ts";
import { getPlanVersionById, type AnalysisPlanContent, type AnalysisPlanVersionRow } from "../plans/plan-service.ts";
import { getRequirementVersionById } from "../requirements/requirement-service.ts";
import { getActorById } from "../actors/actor-service.ts";
import { collectAdmissibleEvidence } from "../plans/plan-service.ts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AnalysisRunRow {
  readonly analysisRunId: string;
  readonly analysisProjectId: string;
  readonly analysisPlanVersionId: string;
  readonly runOrdinal: number;
  readonly predecessorRunId: string | null;
  readonly runRelationType: "retry_of" | "report_revision_of" | null;
  readonly triggeringGateDecisionId: string | null;
  readonly currentAnalysisStage: "S2.1" | "S2.2" | "S2.3" | "S2.4";
  readonly currentRunStatus: RunStatus;
  readonly queuedAt: string;
  readonly startedAt: string | null;
  readonly endedAt: string | null;
  readonly terminalReasonCode: string | null;
  readonly terminalSummary: string | null;
  readonly piSessionRef: string | null;
  readonly triggeredByActorId: string;
}

interface RunRowShape {
  analysis_run_id: string;
  analysis_project_id: string;
  analysis_plan_version_id: string;
  run_ordinal: number;
  predecessor_run_id: string | null;
  run_relation_type: string | null;
  triggering_gate_decision_id: string | null;
  current_analysis_stage: string;
  current_run_status: string;
  queued_at: string;
  started_at: string | null;
  ended_at: string | null;
  terminal_reason_code: string | null;
  terminal_summary: string | null;
  pi_session_ref: string | null;
  triggered_by_actor_id: string;
}

const RUN_SELECT =
  "analysis_run_id, analysis_project_id, analysis_plan_version_id, " +
  "run_ordinal, predecessor_run_id, run_relation_type, triggering_gate_decision_id, " +
  "current_analysis_stage, current_run_status, queued_at, started_at, ended_at, " +
  "terminal_reason_code, terminal_summary, pi_session_ref, triggered_by_actor_id";

function rowToRun(row: RunRowShape): AnalysisRunRow {
  return {
    analysisRunId: row.analysis_run_id,
    analysisProjectId: row.analysis_project_id,
    analysisPlanVersionId: row.analysis_plan_version_id,
    runOrdinal: row.run_ordinal,
    predecessorRunId: row.predecessor_run_id,
    runRelationType: row.run_relation_type as "retry_of" | "report_revision_of" | null,
    triggeringGateDecisionId: row.triggering_gate_decision_id,
    currentAnalysisStage: row.current_analysis_stage as AnalysisRunRow["currentAnalysisStage"],
    currentRunStatus: row.current_run_status as RunStatus,
    queuedAt: row.queued_at,
    startedAt: row.started_at,
    endedAt: row.ended_at,
    terminalReasonCode: row.terminal_reason_code,
    terminalSummary: row.terminal_summary,
    piSessionRef: row.pi_session_ref,
    triggeredByActorId: row.triggered_by_actor_id,
  };
}

export function getRunById(db: DatabaseSync, workspaceId: string, runId: string): AnalysisRunRow | null {
  const row = db.prepare(`SELECT ${RUN_SELECT} FROM analysis_runs WHERE analysis_run_id = ? AND analysis_project_id IN (SELECT analysis_project_id FROM analysis_projects WHERE workspace_id = ?)`).get(runId, workspaceId) as RunRowShape | undefined;
  return row ? rowToRun(row) : null;
}

// ---------------------------------------------------------------------------
// Engine execution handler type (injected)
// ---------------------------------------------------------------------------

export type RunExecutionEngineHandler = (request: EnginePortRequest) => Promise<EnginePortResultEnvelope>;

// ---------------------------------------------------------------------------
// Execute result types
// ---------------------------------------------------------------------------

const RETRYABLE_STATUSES = new Set<RunStatus>(["failed", "aborted", "blocked"]);

export type ExecuteRunResult =
  | { readonly kind: "succeeded"; readonly runId: string; readonly reportVersionId: string }
  | { readonly kind: "failed"; readonly runId: string; readonly errorCode: string }
  | { readonly kind: "aborted"; readonly runId: string }
  | { readonly kind: "blocked"; readonly runId: string; readonly blockCode: string }
  | { readonly kind: "not_found"; readonly runId: string }
  | { readonly kind: "not_queued"; readonly runId: string; readonly currentStatus: string }
  | { readonly kind: "claim_failed"; readonly runId: string; readonly errorCode: string; readonly errorSummary: string };

// ---------------------------------------------------------------------------
// retryRun types
// ---------------------------------------------------------------------------

export interface RetryRunBody {
  readonly expectedPlanVersionId?: string;
}

export interface RetryRunInput {
  readonly db: DatabaseSync;
  readonly layout: DataRootLayout;
  readonly actorContext: TrustedActorContext;
  readonly idempotencyKey: string;
  readonly projectId: string;
  readonly workspaceId: string;
  readonly runId: string;
  readonly body: RetryRunBody;
}

export interface RetryRunResult {
  readonly analysisRunId: string;
  readonly analysisProjectId: string;
  readonly runOrdinal: number;
  readonly predecessorRunId: string;
  readonly runRelationType: "retry_of";
  readonly currentAnalysisStage: "S2.1";
  readonly currentRunStatus: "queued";
  readonly queuedAt: string;
  readonly inputEvidenceCount: number;
}

// ---------------------------------------------------------------------------
// abortRun types (idempotent command via HTTP)
// ---------------------------------------------------------------------------

export interface AbortRunBody {
  readonly expectedStatus: RunStatus;
  readonly expectedLastSequence: number;
  readonly reason: string | null;
}

export interface AbortRunInput {
  readonly db: DatabaseSync;
  readonly actorContext: TrustedActorContext;
  readonly idempotencyKey: string;
  readonly projectId: string;
  readonly workspaceId: string;
  readonly runId: string;
  readonly body: AbortRunBody;
  readonly coordinator: RunCoordinator;
}

// ---------------------------------------------------------------------------
// Coordinator: holds engine handler + in-memory abort controllers
// ---------------------------------------------------------------------------

export interface RunCoordinatorOptions {
  readonly db: DatabaseSync;
  readonly layout: DataRootLayout;
  readonly engineHandler: RunExecutionEngineHandler;
  readonly now?: () => string;
  readonly defaultDeadlineMs?: number;
}

export class RunCoordinator {
  readonly db: DatabaseSync;
  readonly layout: DataRootLayout;
  readonly engineHandler: RunExecutionEngineHandler;
  private readonly nowFn: () => string;
  private readonly defaultDeadlineMs: number;
  private readonly abortControllers: Map<string, AbortController> = new Map();

  constructor(options: RunCoordinatorOptions) {
    this.db = options.db;
    this.layout = options.layout;
    this.engineHandler = options.engineHandler;
    this.nowFn = options.now ?? now;
    this.defaultDeadlineMs = options.defaultDeadlineMs ?? 30_000;
  }

  /** Find next queued run by (queuedAt ASC, runId ASC). */
  claimNextQueuedRun(): AnalysisRunRow | null {
    const row = this.db.prepare(
      `SELECT ${RUN_SELECT} FROM analysis_runs
       WHERE current_run_status = 'queued'
       ORDER BY queued_at ASC, analysis_run_id ASC
       LIMIT 1`,
    ).get() as RunRowShape | undefined;
    return row ? rowToRun(row) : null;
  }

  private getLastRunEventSequence(runId: string): number {
    const row = this.db.prepare(
      "SELECT COALESCE(MAX(sequence), 0) AS max_seq FROM run_events WHERE analysis_run_id = ?",
    ).get(runId) as { max_seq: number };
    return row.max_seq;
  }

  // -------------------------------------------------------------------------
  // executeRun: claim + Engine call + map candidate + terminal
  // -------------------------------------------------------------------------

  async executeRun(runId: string, workspaceId: string): Promise<ExecuteRunResult> {
    const run = getRunById(this.db, workspaceId, runId);
    if (!run) return { kind: "not_found", runId };
    if (run.currentRunStatus !== "queued") {
      return { kind: "not_queued", runId, currentStatus: run.currentRunStatus };
    }

    // 1. Claim transaction: re-validate preconditions, write run_started, snapshot running
    try {
      this.claimRunInTx(run, workspaceId);
    } catch (err) {
      if (err instanceof ApplicationError) {
        return { kind: "claim_failed", runId, errorCode: err.code, errorSummary: err.message };
      }
      throw err;
    }

    // 2. Call Engine execution handler with AbortSignal
    const abortController = new AbortController();
    this.abortControllers.set(runId, abortController);
    try {
      const planVersion = getPlanVersionById(this.db, workspaceId, run.analysisPlanVersionId);
      if (!planVersion) {
        this.terminateRunInTx(runId, workspaceId, "failed", "plan_contract_mismatch", "Analysis plan version is no longer available.");
        return { kind: "failed", runId, errorCode: "plan_contract_mismatch" };
      }

      const expectedPreviousSequence = this.getLastRunEventSequence(runId);
      const requestedAt = this.nowFn();
      const deadlineAt = new Date(Date.now() + this.defaultDeadlineMs).toISOString();
      const inputHash = sha256HexBytes(new TextEncoder().encode(canonicalJsonStringify({
        runId,
        planVersionId: run.analysisPlanVersionId,
        expectedPreviousSequence,
      })));

      const engineRequest: EnginePortRequest = {
        version: ENGINE_PORT_VERSION,
        operation: "executeQueuedRun",
        operationId: uuid(),
        projectId: run.analysisProjectId,
        runId,
        caller: "workcanger-backend",
        requestedAt,
        deadlineAt,
        inputHash,
        abortSignal: abortController.signal,
        input: {
          runId,
          planVersionId: run.analysisPlanVersionId,
          expectedPreviousSequence,
        },
      };

      let engineResult: EnginePortResultEnvelope;
      try {
        engineResult = await this.engineHandler(engineRequest);
      } catch {
        this.terminateRunInTx(runId, workspaceId, "failed", "engine_unavailable", "Analysis Engine is not available.");
        return { kind: "failed", runId, errorCode: "engine_unavailable" };
      }

      // 3. Map Engine result to terminal state
      if (engineResult.outcome === "succeeded") {
        return this.mapEngineSuccessToDurable(run, workspaceId, planVersion, engineResult);
      }
      return this.mapEngineFailureToTerminal(run, workspaceId, engineResult);
    } finally {
      this.abortControllers.delete(runId);
    }
  }

  // -------------------------------------------------------------------------
  // abortRun: signal an in-progress run or directly terminate a queued run
  // -------------------------------------------------------------------------

  abortRun(runId: string, workspaceId: string, reason: string | null): { ok: boolean; errorCode?: string; currentStatus?: string } {
    const run = getRunById(this.db, workspaceId, runId);
    if (!run) return { ok: false, errorCode: "resource_not_found" };
    if (run.currentRunStatus === "queued") {
      this.terminateRunInTx(runId, workspaceId, "aborted", "aborted", reason ?? "Run aborted by request.", { reason: reason ?? "Run aborted by request.", requestedByActorId: null });
      return { ok: true };
    }
    if (run.currentRunStatus === "running") {
      const controller = this.abortControllers.get(runId);
      if (controller) {
        controller.abort();
        return { ok: true };
      }
      // Running but no in-memory controller (process restart). Mark blocked
      // for manual inspection per §14 startup recovery semantics.
      this.terminateRunInTx(runId, workspaceId, "blocked", "abort_controller_missing", "Run is running but no abort controller is available; manual inspection required.");
      return { ok: false, errorCode: "abort_controller_missing" };
    }
    return { ok: false, errorCode: "invalid_state_transition", currentStatus: run.currentRunStatus };
  }

  /**
   * Signal the AbortController for a running Run WITHOUT any DB writes.
   * Returns true if the signal was sent, false if no in-memory controller exists.
   * Used by abortRunCommand to keep DB mutations inside the idempotency transaction.
   */
  signalRunningAbort(runId: string): boolean {
    const controller = this.abortControllers.get(runId);
    if (controller) {
      controller.abort();
      return true;
    }
    return false;
  }

  // -------------------------------------------------------------------------
  // retryRun: create a new queued Run from a terminal Run (§6.4)
  // -------------------------------------------------------------------------

  retryRun(input: RetryRunInput): CommandResult<RetryRunResult> {
    const { db, layout, workspaceId, actorContext, idempotencyKey, projectId, runId, body } = input;
    assertActiveHuman(actorContext);
    const requestHash = computeRequestHash("POST", `/api/v1/projects/${projectId}/runs/${runId}:retry`, body);
    const claim = claimOn(db, { actorId: actorContext.actorId, commandType: "run.retry", idempotencyKey, requestHash });
    const pre = handleClaim(claim);
    if (pre) return pre;

    let proj;
    try { proj = requireProject(db, workspaceId, projectId); } catch (err) {
      if (err instanceof ApplicationError) return failWith(db, claim.recordId, err);
      throw err;
    }
    if (proj.projectStatus !== "active") return failWith(db, claim.recordId, new ApplicationError("invalid_state_transition", "Cannot retry run for a non-active project."));
    if (proj.archivedAt !== null) return failWith(db, claim.recordId, new ApplicationError("invalid_state_transition", "Cannot retry run for an archived project."));

    const predecessorRun = getRunById(db, workspaceId, runId);
    if (!predecessorRun || predecessorRun.analysisProjectId !== projectId) return failWith(db, claim.recordId, new ApplicationError("resource_not_found", "Predecessor run not found."));
    if (!RETRYABLE_STATUSES.has(predecessorRun.currentRunStatus)) return failWith(db, claim.recordId, new ApplicationError("invalid_state_transition", `Run is in status ${predecessorRun.currentRunStatus}; only failed/aborted/blocked runs can be retried.`));
    if (body.expectedPlanVersionId !== undefined && body.expectedPlanVersionId !== predecessorRun.analysisPlanVersionId) return failWith(db, claim.recordId, new ApplicationError("concurrent_modification", "expectedPlanVersionId does not match predecessor run's plan version."));

    if (proj.currentPlanVersionId === null) return failWith(db, claim.recordId, new ApplicationError("invalid_state_transition", "No current plan version exists."));
    const planVersion = getPlanVersionById(db, workspaceId, proj.currentPlanVersionId);
    if (!planVersion || planVersion.analysisProjectId !== projectId) return failWith(db, claim.recordId, new ApplicationError("invalid_state_transition", "Current plan version is not valid."));
    const planGateRow = db.prepare(`SELECT gate_decision_id FROM gate_decisions WHERE analysis_project_id = ? AND analysis_project_id IN (SELECT analysis_project_id FROM analysis_projects WHERE workspace_id = ?) AND gate_type = 'plan_confirmation' AND target_object_id = ? AND decision = 'approved'`).get(projectId, workspaceId, proj.currentPlanVersionId) as { gate_decision_id: string } | undefined;
    if (!planGateRow) return failWith(db, claim.recordId, new ApplicationError("invalid_state_transition", "Current plan has not been approved."));
    if (countActiveRuns(db, workspaceId, projectId) > 0) return failWith(db, claim.recordId, new ApplicationError("active_run_exists", "An active run already exists."));
    const admissible = collectAdmissibleEvidence(db, workspaceId, projectId);
    if (admissible.length === 0) return failWith(db, claim.recordId, new ApplicationError("unsafe_evidence", "No admissible controlled or derived evidence is available."));

    let planContent: AnalysisPlanContent;
    try {
      const contentBytes = readBlob(layout.blobsDir, planVersion.storageRef);
      planContent = JSON.parse(new TextDecoder().decode(contentBytes)) as AnalysisPlanContent;
    } catch { return failWith(db, claim.recordId, new ApplicationError("storage_unavailable", "Plan content could not be loaded.")); }
    const firstPlanStepId = planContent.steps[0]!.planStepId;
    const maxOrdinalRow = db.prepare(`SELECT COALESCE(MAX(run_ordinal), 0) AS max_ord FROM analysis_runs WHERE analysis_project_id = ? AND analysis_project_id IN (SELECT analysis_project_id FROM analysis_projects WHERE workspace_id = ?)`).get(projectId, workspaceId) as { max_ord: number };
    const nextRunOrdinal = maxOrdinalRow.max_ord + 1;
    const newRunId = uuid();
    const ts = this.nowFn();
    db.exec("BEGIN");
    try {
      const projNow = db.prepare(`SELECT project_status, archived_at, current_plan_version_id FROM analysis_projects WHERE analysis_project_id = ? AND workspace_id = ?`).get(projectId, workspaceId) as { project_status: string; archived_at: string | null; current_plan_version_id: string | null };
      if (projNow.project_status !== "active") throw new ApplicationError("invalid_state_transition", "Project is no longer active.");
      if (projNow.archived_at !== null) throw new ApplicationError("invalid_state_transition", "Project is archived.");
      if (projNow.current_plan_version_id !== planVersion.analysisPlanVersionId) throw new ApplicationError("invalid_state_transition", "Plan is no longer the current version.");
      const activeRunCount = (db.prepare(`SELECT COUNT(*) AS c FROM analysis_runs WHERE analysis_project_id = ? AND analysis_project_id IN (SELECT analysis_project_id FROM analysis_projects WHERE workspace_id = ?) AND current_run_status IN ('queued', 'running')`).get(projectId, workspaceId) as { c: number }).c;
      if (activeRunCount > 0) throw new ApplicationError("active_run_exists", "An active run already exists.");
      const admittedNow = collectAdmissibleEvidence(db, workspaceId, projectId);
      if (admittedNow.length === 0) throw new ApplicationError("unsafe_evidence", "No admissible evidence.");

      db.prepare(`INSERT INTO analysis_runs (analysis_run_id, analysis_project_id, analysis_plan_version_id, run_ordinal, predecessor_run_id, run_relation_type, triggering_gate_decision_id, current_analysis_stage, current_run_status, queued_at, started_at, ended_at, terminal_reason_code, terminal_summary, pi_session_ref, triggered_by_actor_id) VALUES (?, ?, ?, ?, ?, 'retry_of', NULL, 'S2.1', 'queued', ?, NULL, NULL, NULL, NULL, NULL, ?)`).run(newRunId, projectId, planVersion.analysisPlanVersionId, nextRunOrdinal, runId, ts, actorContext.actorId);
      for (let i = 0; i < admittedNow.length; i++) {
        db.prepare(`INSERT INTO analysis_run_input_evidence (analysis_run_id, evidence_artifact_id, input_role, input_ordinal, plan_step_id, admitted_at) VALUES (?, ?, 'plan_input', ?, ?, ?)`).run(newRunId, admittedNow[i]!.evidenceArtifactId, i + 1, firstPlanStepId, ts);
      }
      const runEventId = uuid();
      db.prepare(`INSERT INTO run_events (run_event_id, analysis_run_id, sequence, event_type, analysis_stage_after, run_status_after, occurred_at, recorded_at, producer_name, producer_version, producer_event_id, payload_schema_version, payload_json, raw_diagnostic_artifact_id) VALUES (?, ?, 1, 'run_queued', 'S2.1', 'queued', ?, ?, 'workcanger-backend', NULL, NULL, ?, ?, NULL)`).run(runEventId, newRunId, ts, ts, runEventSchemaVersion("run_queued"), JSON.stringify({ inputEvidenceCount: admittedNow.length, queueCause: "retry" }));
      recordSuccessInTx(db, claim.recordId, { httpStatus: 201, resultResourceType: "Run", resultResourceId: newRunId });
      db.exec("COMMIT");
      return { kind: "executed", httpStatus: 201, resultResourceType: "Run", resultResourceId: newRunId, recordId: claim.recordId, data: { analysisRunId: newRunId, analysisProjectId: projectId, runOrdinal: nextRunOrdinal, predecessorRunId: runId, runRelationType: "retry_of", currentAnalysisStage: "S2.1", currentRunStatus: "queued", queuedAt: ts, inputEvidenceCount: admittedNow.length } };
    } catch (err) {
      db.exec("ROLLBACK");
      if (err instanceof ApplicationError) return failWith(db, claim.recordId, err);
      return failWith(db, claim.recordId, mapErr(err));
    }
  }

  // -------------------------------------------------------------------------
  // Private: claimRunInTx - re-validate preconditions, write run_started (§14)
  // -------------------------------------------------------------------------

  private claimRunInTx(run: AnalysisRunRow, workspaceId: string): void {
    const db = this.db;
    const ts = this.nowFn();
    const wsScope = `AND analysis_project_id IN (SELECT analysis_project_id FROM analysis_projects WHERE workspace_id = ?)`;
    db.exec("BEGIN");
    try {
      const projNow = db.prepare(`SELECT project_status, archived_at, current_plan_version_id, current_requirement_version_id FROM analysis_projects WHERE analysis_project_id = ? AND workspace_id = ?`).get(run.analysisProjectId, workspaceId) as { project_status: string; archived_at: string | null; current_plan_version_id: string | null; current_requirement_version_id: string | null };
      if (projNow.project_status !== "active") throw new ApplicationError("invalid_state_transition", "Project is no longer active.");
      if (projNow.archived_at !== null) throw new ApplicationError("invalid_state_transition", "Project is archived.");
      if (projNow.current_plan_version_id !== run.analysisPlanVersionId) throw new ApplicationError("invalid_state_transition", "Plan is no longer the current version.");
      const planGateRow = db.prepare(`SELECT gate_decision_id FROM gate_decisions WHERE analysis_project_id = ? ${wsScope} AND gate_type = 'plan_confirmation' AND target_object_id = ? AND decision = 'approved'`).get(run.analysisProjectId, workspaceId, run.analysisPlanVersionId) as { gate_decision_id: string } | undefined;
      if (!planGateRow) throw new ApplicationError("invalid_state_transition", "Plan is no longer approved.");
      if (projNow.current_requirement_version_id === null) throw new ApplicationError("invalid_state_transition", "Requirement is no longer available.");
      const reqGateRow = db.prepare(`SELECT gate_decision_id FROM gate_decisions WHERE analysis_project_id = ? ${wsScope} AND gate_type = 'requirement_confirmation' AND target_object_id = ? AND decision = 'approved'`).get(run.analysisProjectId, workspaceId, projNow.current_requirement_version_id) as { gate_decision_id: string } | undefined;
      if (!reqGateRow) throw new ApplicationError("invalid_state_transition", "Requirement is no longer approved.");
      const runNow = db.prepare(`SELECT current_run_status FROM analysis_runs WHERE analysis_run_id = ? ${wsScope}`).get(run.analysisRunId, workspaceId) as { current_run_status: string };
      if (runNow.current_run_status !== "queued") throw new ApplicationError("invalid_state_transition", `Run is no longer queued (status: ${runNow.current_run_status}).`);
      const admittedNow = collectAdmissibleEvidence(db, workspaceId, run.analysisProjectId);
      if (admittedNow.length === 0) throw new ApplicationError("unsafe_evidence", "No admissible controlled or derived evidence is available.");

      const lastSeq = (db.prepare("SELECT COALESCE(MAX(sequence), 0) AS max_seq FROM run_events WHERE analysis_run_id = ?").get(run.analysisRunId) as { max_seq: number }).max_seq;
      const runEventId = uuid();
      db.prepare(`INSERT INTO run_events (run_event_id, analysis_run_id, sequence, event_type, analysis_stage_after, run_status_after, occurred_at, recorded_at, producer_name, producer_version, producer_event_id, payload_schema_version, payload_json, raw_diagnostic_artifact_id) VALUES (?, ?, ?, 'run_started', 'S2.1', 'running', ?, ?, 'workcanger-backend', NULL, NULL, ?, '{}', NULL)`).run(runEventId, run.analysisRunId, lastSeq + 1, ts, ts, runEventSchemaVersion("run_started"));
      db.prepare(`UPDATE analysis_runs SET current_run_status = 'running', started_at = ? WHERE analysis_run_id = ? AND current_run_status = 'queued' ${wsScope}`).run(ts, run.analysisRunId, workspaceId);
      db.exec("COMMIT");
    } catch (err) {
      db.exec("ROLLBACK");
      throw err;
    }
  }

  // -------------------------------------------------------------------------
  // Private: terminateRunInTx - write terminal event + update snapshot (§14)
  // -------------------------------------------------------------------------

  private terminateRunInTx(
    runId: string,
    workspaceId: string,
    terminalStatus: "failed" | "aborted" | "blocked",
    reasonCode: string,
    safeSummary: string,
    payloadExtra?: { readonly reason?: string | null; readonly requestedByActorId?: string | null },
  ): void {
    const db = this.db;
    const ts = this.nowFn();
    const wsScope = `AND analysis_project_id IN (SELECT analysis_project_id FROM analysis_projects WHERE workspace_id = ?)`;
    db.exec("BEGIN");
    try {
      const runRow = db.prepare(`SELECT current_run_status, current_analysis_stage FROM analysis_runs WHERE analysis_run_id = ? ${wsScope}`).get(runId, workspaceId) as { current_run_status: string; current_analysis_stage: string } | undefined;
      if (!runRow) { db.exec("ROLLBACK"); return; }
      // Terminal after terminal rejected (§14)
      if (runRow.current_run_status !== "running" && runRow.current_run_status !== "queued") { db.exec("ROLLBACK"); return; }
      const stage = runRow.current_analysis_stage as "S2.1" | "S2.2" | "S2.3" | "S2.4";
      const lastSeq = (db.prepare("SELECT COALESCE(MAX(sequence), 0) AS max_seq FROM run_events WHERE analysis_run_id = ?").get(runId) as { max_seq: number }).max_seq;
      const eventType = terminalStatus === "failed" ? "run_failed" : terminalStatus === "aborted" ? "run_aborted" : "run_blocked";
      let payload: Record<string, unknown>;
      if (terminalStatus === "failed") {
        payload = { errorCode: reasonCode, errorSummary: safeSummary, failedPlanStepId: null, retryable: true };
      } else if (terminalStatus === "aborted") {
        payload = { reason: payloadExtra?.reason ?? safeSummary, requestedByActorId: payloadExtra?.requestedByActorId ?? null };
      } else {
        payload = { blockCode: reasonCode, blockSummary: safeSummary, blockedPlanStepId: null, requiredAction: "Manual inspection required." };
      }
      // Validate payload against contract schema before inserting
      validateRunEventPayload(eventType, runEventSchemaVersion(eventType), payload);
      const runEventId = uuid();
      db.prepare(`INSERT INTO run_events (run_event_id, analysis_run_id, sequence, event_type, analysis_stage_after, run_status_after, occurred_at, recorded_at, producer_name, producer_version, producer_event_id, payload_schema_version, payload_json, raw_diagnostic_artifact_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'workcanger-backend', NULL, NULL, ?, ?, NULL)`).run(runEventId, runId, lastSeq + 1, eventType, stage, terminalStatus, ts, ts, runEventSchemaVersion(eventType), JSON.stringify(payload));
      db.prepare(`UPDATE analysis_runs SET current_run_status = ?, ended_at = ?, terminal_reason_code = ?, terminal_summary = ? WHERE analysis_run_id = ? ${wsScope}`).run(terminalStatus, ts, reasonCode, safeSummary, runId, workspaceId);
      db.exec("COMMIT");
    } catch (err) {
      db.exec("ROLLBACK");
      throw err;
    }
  }

  // -------------------------------------------------------------------------
  // Private: mapEngineFailureToTerminal - map Engine failure outcome to terminal
  // -------------------------------------------------------------------------

  private mapEngineFailureToTerminal(run: AnalysisRunRow, workspaceId: string, engineResult: EnginePortResultEnvelope): ExecuteRunResult {
    const outcome = engineResult.outcome;
    const errorCode = engineResult.error?.code ?? "engine_unavailable";
    const safeSummary = engineResult.error?.summary ?? "Analysis Engine failed.";

    if (outcome === "aborted") {
      this.terminateRunInTx(run.analysisRunId, workspaceId, "aborted", "aborted", "Run execution was aborted.", { reason: "Run execution was aborted.", requestedByActorId: null });
      return { kind: "aborted", runId: run.analysisRunId };
    }
    if (outcome === "timed_out") {
      this.terminateRunInTx(run.analysisRunId, workspaceId, "failed", "deadline_exceeded", "Run execution did not complete before its deadline.");
      return { kind: "failed", runId: run.analysisRunId, errorCode: "deadline_exceeded" };
    }
    if (outcome === "policy_blocked") {
      const blockCode = errorCode === "evidence_not_admitted" ? "evidence_not_admitted" : errorCode === "plan_contract_mismatch" ? "plan_contract_mismatch" : "policy_blocked";
      this.terminateRunInTx(run.analysisRunId, workspaceId, "blocked", blockCode, safeSummary);
      return { kind: "blocked", runId: run.analysisRunId, blockCode };
    }
    // outcome === "failed" or "conflict" or unknown
    const mappedCode = errorCode === "pi_spawn_failed" ? "pi_spawn_failed"
      : errorCode === "pi_execution_failed" ? "pi_execution_failed"
      : errorCode === "output_schema_invalid" ? "output_schema_invalid"
      : "engine_unavailable";
    this.terminateRunInTx(run.analysisRunId, workspaceId, "failed", mappedCode, safeSummary);
    return { kind: "failed", runId: run.analysisRunId, errorCode: mappedCode };
  }

  // -------------------------------------------------------------------------
  // Private: mapEngineSuccessToDurable - map Engine success to durable facts
  // Registers Evidence, appends RunEvents, creates ReportVersion, writes
  // run_succeeded, updates snapshot. All in ONE transaction (§12.4, §13, §14).
  // -------------------------------------------------------------------------

  private mapEngineSuccessToDurable(
    run: AnalysisRunRow,
    workspaceId: string,
    planVersion: AnalysisPlanVersionRow,
    engineResult: EnginePortResultEnvelope,
  ): ExecuteRunResult {
    const wsScope = `AND analysis_project_id IN (SELECT analysis_project_id FROM analysis_projects WHERE workspace_id = ?)`;
    const output = engineResult.output as Record<string, unknown> | undefined;
    if (!output || typeof output !== "object") {
      this.terminateRunInTx(run.analysisRunId, workspaceId, "failed", "output_schema_invalid", "Engine output is not a valid object.");
      return { kind: "failed", runId: run.analysisRunId, errorCode: "output_schema_invalid" };
    }
    const eventSuggestions = (output as { eventSuggestions?: unknown[] }).eventSuggestions;
    const evidenceSuggestions = (output as { evidenceRegistrationSuggestions?: unknown[] }).evidenceRegistrationSuggestions;
    const internalReviewSuggestion = (output as Record<string, unknown>).internalReviewSuggestion as Record<string, unknown> | undefined;
    const reportDraftCandidate = (output as Record<string, unknown>).reportDraftCandidate as Record<string, unknown> | undefined;
    if (!Array.isArray(eventSuggestions) || !Array.isArray(evidenceSuggestions) || !internalReviewSuggestion || !reportDraftCandidate) {
      this.terminateRunInTx(run.analysisRunId, workspaceId, "failed", "output_schema_invalid", "Engine output missing required suggestion fields.");
      return { kind: "failed", runId: run.analysisRunId, errorCode: "output_schema_invalid" };
    }

    const ts = this.nowFn();
    const db = this.db;
    const layout = this.layout;
    let reportVersionId: string | null = null;

    try {
      db.exec("BEGIN");
      // 1. Register all derived Evidence; build handle -> durableId map
      const handleToDurableId = new Map<string, string>();
      const evidenceByStep = new Map<string, string[]>();
      for (const suggestion of evidenceSuggestions) {
        const s = suggestion as Record<string, unknown>;
        const candidateHandle = s.candidateEvidenceHandle as string;
        const planStepId = s.planStepId as string;
        const artifactKind = s.artifactKind as string;
        const safetyClass = s.safetyClass as string;
        const visibility = s.visibility as string;
        const displayName = s.displayName as string;
        if (safetyClass !== "derived") throw new ApplicationError("generation_output_invalid", "Derived evidence must have safety_class='derived'.");
        if (artifactKind === "intermediate_result" && visibility !== "review_only") throw new ApplicationError("generation_output_invalid", "Internal review evidence must have visibility='review_only'.");
        // Backend-owned canonical evidence content (not Engine content)
        const evidenceContent = { schemaVersion: "1.0", runId: run.analysisRunId, planStepId, artifactKind, displayName, producer: "workcanger-fake-run-execution-runner", origin: "analysis_run", createdAt: ts };
        const blobResult = writeCanonicalJsonBlob(layout.blobsDir, layout.tmpDir, evidenceContent);
        const evidenceId = uuid();
        db.prepare(`INSERT INTO evidence_artifacts (evidence_artifact_id, analysis_project_id, analysis_run_id, source_reference_id, source_check_id, origin_kind, artifact_kind, display_name, storage_ref, content_sha256, media_type, byte_size, safety_class, visibility, retrieved_at, observed_source_version, created_at, created_by_actor_id, producer_name, producer_version) VALUES (?, ?, ?, NULL, NULL, 'analysis_run', ?, ?, ?, ?, 'application/json', ?, ?, ?, NULL, NULL, ?, ?, ?, NULL)`).run(evidenceId, run.analysisProjectId, run.analysisRunId, artifactKind, displayName, blobResult.storageRef, blobResult.contentSha256, blobResult.byteSize, safetyClass, visibility, ts, run.triggeredByActorId, "workcanger-fake-run-execution-runner");
        handleToDurableId.set(candidateHandle, evidenceId);
        const arr = evidenceByStep.get(planStepId) ?? [];
        arr.push(evidenceId);
        evidenceByStep.set(planStepId, arr);
      }

      // 2. Identify internal review evidence; validate passed + intermediate_result/review_only
      const reviewHandle = internalReviewSuggestion.reviewEvidenceHandle as string;
      const internalReviewEvidenceId = handleToDurableId.get(reviewHandle);
      if (!internalReviewEvidenceId) throw new ApplicationError("generation_output_invalid", "Internal review evidence handle not found.");
      const reviewRow = db.prepare(`SELECT artifact_kind, visibility FROM evidence_artifacts WHERE evidence_artifact_id = ? ${wsScope}`).get(internalReviewEvidenceId, workspaceId) as { artifact_kind: string; visibility: string };
      if (reviewRow.artifact_kind !== "intermediate_result" || reviewRow.visibility !== "review_only") throw new ApplicationError("generation_output_invalid", "Internal review evidence must be intermediate_result/review_only.");
      if (internalReviewSuggestion.outcome !== "passed") throw new ApplicationError("internal_review_not_passed", "Internal review did not pass.");

      // 3. Append RunEvents: Engine suggestions (with durable IDs) + evidence_registered
      let currentSeq = this.getLastRunEventSequence(run.analysisRunId);
      for (const eventSuggestion of eventSuggestions) {
        const es = eventSuggestion as Record<string, unknown>;
        const eventType = es.eventType as string;
        const payloadSchemaVersion = es.payloadSchemaVersion as string;
        const analysisStageAfter = es.analysisStageAfter as string;
        const producerEventId = es.producerEventId as string;
        let payload = es.payload as Record<string, unknown>;
        // Map candidate handles to durable IDs in plan_step_completed payload
        if (eventType === "plan_step_completed") {
          const stepId = payload.planStepId as string;
          const stepEvidence = evidenceByStep.get(stepId) ?? [];
          payload = { ...payload, outputEvidenceArtifactIds: stepEvidence };
        }
        // Validate payload against contract schema
        validateRunEventPayload(eventType, payloadSchemaVersion, payload);
        currentSeq += 1;
        const runEventId = uuid();
        db.prepare(`INSERT INTO run_events (run_event_id, analysis_run_id, sequence, event_type, analysis_stage_after, run_status_after, occurred_at, recorded_at, producer_name, producer_version, producer_event_id, payload_schema_version, payload_json, raw_diagnostic_artifact_id) VALUES (?, ?, ?, ?, ?, 'running', ?, ?, 'workcanger-backend', NULL, ?, ?, ?, NULL)`).run(runEventId, run.analysisRunId, currentSeq, eventType, analysisStageAfter, ts, ts, producerEventId, payloadSchemaVersion, JSON.stringify(payload));
        // After plan_step_completed, append evidence_registered events for this step's evidence
        if (eventType === "plan_step_completed") {
          const stepId = payload.planStepId as string;
          const stepEvidence = evidenceByStep.get(stepId) ?? [];
          for (const evId of stepEvidence) {
            const evRow = db.prepare(`SELECT artifact_kind FROM evidence_artifacts WHERE evidence_artifact_id = ? ${wsScope}`).get(evId, workspaceId) as { artifact_kind: string };
            const regPayload = { evidenceArtifactId: evId, planStepId: stepId, artifactKind: evRow.artifact_kind };
            validateRunEventPayload("evidence_registered", runEventSchemaVersion("evidence_registered"), regPayload);
            currentSeq += 1;
            const regEventId = uuid();
            db.prepare(`INSERT INTO run_events (run_event_id, analysis_run_id, sequence, event_type, analysis_stage_after, run_status_after, occurred_at, recorded_at, producer_name, producer_version, producer_event_id, payload_schema_version, payload_json, raw_diagnostic_artifact_id) VALUES (?, ?, ?, 'evidence_registered', ?, 'running', ?, ?, 'workcanger-backend', NULL, ?, ?, ?, NULL)`).run(regEventId, run.analysisRunId, currentSeq, analysisStageAfter, ts, ts, `backend-evidence-reg-${currentSeq}`, runEventSchemaVersion("evidence_registered"), JSON.stringify(regPayload));
          }
        }
      }

      // 4. Create ReportVersion: blob + row + ReportVersionEvidence links
      const reportContent = {
        schemaVersion: "1.0",
        title: reportDraftCandidate.title as string,
        executiveSummary: reportDraftCandidate.executiveSummary as string,
        methodSummary: reportDraftCandidate.methodSummary as string,
        keyConclusionCount: reportDraftCandidate.keyConclusionCount as number,
        citedEvidenceArtifactIds: (reportDraftCandidate.citedEvidenceHandles as string[]).map((h) => handleToDurableId.get(h)).filter((id): id is string => id !== undefined),
        confidence: reportDraftCandidate.confidence as string,
        confidenceRationale: reportDraftCandidate.confidenceRationale as string,
        limitations: reportDraftCandidate.limitations as string[],
        misinterpretationRisks: reportDraftCandidate.misinterpretationRisks as string[],
        actionableRecommendationCount: reportDraftCandidate.actionableRecommendationCount as number,
        runId: run.analysisRunId,
        createdAt: ts,
      };
      const reportBlob = writeCanonicalJsonBlob(layout.blobsDir, layout.tmpDir, reportContent);
      reportVersionId = uuid();
      // Determine report version ordinal
      const maxReportOrdinal = (db.prepare(`SELECT COALESCE(MAX(version_ordinal), 0) AS max_ord FROM report_versions WHERE analysis_project_id = ? ${wsScope}`).get(run.analysisProjectId, workspaceId) as { max_ord: number }).max_ord;
      // Get requirement version for report binding
      const projRow = db.prepare(`SELECT current_requirement_version_id FROM analysis_projects WHERE analysis_project_id = ? AND workspace_id = ?`).get(run.analysisProjectId, workspaceId) as { current_requirement_version_id: string | null };
      if (!projRow.current_requirement_version_id) throw new ApplicationError("invalid_state_transition", "Requirement is no longer available.");
      db.prepare(`INSERT INTO report_versions (report_version_id, analysis_project_id, analysis_run_id, structured_requirement_version_id, analysis_plan_version_id, version_ordinal, supersedes_version_id, schema_version, content_sha256, storage_ref, created_at, created_by_actor_id) VALUES (?, ?, ?, ?, ?, ?, NULL, '1.0', ?, ?, ?, ?)`).run(reportVersionId, run.analysisProjectId, run.analysisRunId, projRow.current_requirement_version_id, run.analysisPlanVersionId, maxReportOrdinal + 1, reportBlob.contentSha256, reportBlob.storageRef, ts, run.triggeredByActorId);
      // ReportVersionEvidence: link all produced evidence (cited evidence)
      const citedEvidenceIds = reportContent.citedEvidenceArtifactIds;
      for (let i = 0; i < citedEvidenceIds.length; i++) {
        db.prepare(`INSERT INTO report_version_evidence (report_version_id, evidence_artifact_id, evidence_ordinal) VALUES (?, ?, ?)`).run(reportVersionId, citedEvidenceIds[i]!, i + 1);
      }

      // 5. Append run_succeeded event
      const successPayload = { reportVersionId, internalReviewEvidenceArtifactId: internalReviewEvidenceId };
      validateRunEventPayload("run_succeeded", runEventSchemaVersion("run_succeeded"), successPayload);
      currentSeq += 1;
      const successEventId = uuid();
      db.prepare(`INSERT INTO run_events (run_event_id, analysis_run_id, sequence, event_type, analysis_stage_after, run_status_after, occurred_at, recorded_at, producer_name, producer_version, producer_event_id, payload_schema_version, payload_json, raw_diagnostic_artifact_id) VALUES (?, ?, ?, 'run_succeeded', 'S2.4', 'succeeded', ?, ?, 'workcanger-backend', NULL, NULL, ?, ?, NULL)`).run(successEventId, run.analysisRunId, currentSeq, ts, ts, runEventSchemaVersion("run_succeeded"), JSON.stringify(successPayload));

      // 6. Update Run snapshot: succeeded, ended_at, stage S2.4
      db.prepare(`UPDATE analysis_runs SET current_run_status = 'succeeded', current_analysis_stage = 'S2.4', ended_at = ? WHERE analysis_run_id = ? ${wsScope}`).run(ts, run.analysisRunId, workspaceId);

      db.exec("COMMIT");
      return { kind: "succeeded", runId: run.analysisRunId, reportVersionId };
    } catch (err) {
      db.exec("ROLLBACK");
      // On any failure during durable mapping, terminate the run as failed
      const failCode = err instanceof ApplicationError ? err.code : "output_schema_invalid";
      const failSummary = err instanceof ApplicationError ? err.message : "Engine output mapping failed.";
      this.terminateRunInTx(run.analysisRunId, workspaceId, "failed", failCode, failSummary);
      return { kind: "failed", runId: run.analysisRunId, errorCode: failCode };
    }
  }
}

// ---------------------------------------------------------------------------
// abortRunCommand: idempotent HTTP command wrapper for run.abort (§6.4)
// ---------------------------------------------------------------------------

export function abortRunCommand(input: AbortRunInput): CommandResult<AbortRunResult> {
  const { db, workspaceId, actorContext, idempotencyKey, projectId, runId, body, coordinator } = input;
  assertActiveHuman(actorContext);
  const requestHash = computeRequestHash("POST", `/api/v1/projects/${projectId}/runs/${runId}:abort`, body);
  const claim = claimOn(db, { actorId: actorContext.actorId, commandType: "run.abort", idempotencyKey, requestHash });
  const pre = handleClaim(claim);
  if (pre) return pre;

  let proj;
  try { proj = requireProject(db, workspaceId, projectId); } catch (err) {
    if (err instanceof ApplicationError) return failWith(db, claim.recordId, err);
    throw err;
  }
  if (proj.projectStatus !== "active") return failWith(db, claim.recordId, new ApplicationError("invalid_state_transition", "Cannot abort run for a non-active project."));

  const run = getRunById(db, workspaceId, runId);
  if (!run || run.analysisProjectId !== projectId) return failWith(db, claim.recordId, new ApplicationError("resource_not_found", "Run not found."));

  // Precondition: expected status and last sequence must match
  if (body.expectedStatus !== run.currentRunStatus) {
    return failWith(db, claim.recordId, new ApplicationError("concurrent_modification", `expectedStatus '${body.expectedStatus}' does not match current status '${run.currentRunStatus}'.`));
  }
  const lastSeq = (db.prepare("SELECT COALESCE(MAX(sequence), 0) AS max_seq FROM run_events WHERE analysis_run_id = ?").get(runId) as { max_seq: number }).max_seq;
  if (body.expectedLastSequence !== lastSeq) {
    return failWith(db, claim.recordId, new ApplicationError("concurrent_modification", "expectedLastSequence does not match current last event sequence."));
  }

  // Terminal runs cannot be aborted
  if (run.currentRunStatus === "succeeded" || run.currentRunStatus === "failed" || run.currentRunStatus === "aborted" || run.currentRunStatus === "blocked") {
    return failWith(db, claim.recordId, new ApplicationError("invalid_state_transition", `Run is already terminal (status: ${run.currentRunStatus}).`));
  }

  const ts = new Date().toISOString();
  const reason = body.reason ?? "Run aborted by request.";

  if (run.currentRunStatus === "queued") {
    // Queued abort: terminate + idempotency receipt in ONE transaction (§4 atomic command semantics)
    const stage = run.currentAnalysisStage;
    const abortPayload = { reason, requestedByActorId: actorContext.actorId };
    try {
      validateRunEventPayload("run_aborted", runEventSchemaVersion("run_aborted"), abortPayload);
    } catch {
      return failWith(db, claim.recordId, new ApplicationError("internal_error", "Failed to validate abort payload."));
    }
    db.exec("BEGIN");
    try {
      const wsScope = `AND analysis_project_id IN (SELECT analysis_project_id FROM analysis_projects WHERE workspace_id = ?)`;
      // Re-validate run is still queued inside transaction
      const runNow = db.prepare(`SELECT current_run_status FROM analysis_runs WHERE analysis_run_id = ? ${wsScope}`).get(runId, workspaceId) as { current_run_status: string };
      if (runNow.current_run_status !== "queued") throw new ApplicationError("concurrent_modification", "Run is no longer queued.");
      const seqRow = db.prepare("SELECT COALESCE(MAX(sequence), 0) AS max_seq FROM run_events WHERE analysis_run_id = ?").get(runId) as { max_seq: number };
      const nextSeq = seqRow.max_seq + 1;
      const runEventId = uuid();
      db.prepare(`INSERT INTO run_events (run_event_id, analysis_run_id, sequence, event_type, analysis_stage_after, run_status_after, occurred_at, recorded_at, producer_name, producer_version, producer_event_id, payload_schema_version, payload_json, raw_diagnostic_artifact_id) VALUES (?, ?, ?, 'run_aborted', ?, 'aborted', ?, ?, 'workcanger-backend', NULL, NULL, ?, ?, NULL)`).run(runEventId, runId, nextSeq, stage, ts, ts, runEventSchemaVersion("run_aborted"), JSON.stringify(abortPayload));
      db.prepare(`UPDATE analysis_runs SET current_run_status = 'aborted', ended_at = ?, terminal_reason_code = 'aborted', terminal_summary = ? WHERE analysis_run_id = ? ${wsScope}`).run(ts, reason, runId, workspaceId);
      recordSuccessInTx(db, claim.recordId, { httpStatus: 200, resultResourceType: "Run", resultResourceId: runId });
      db.exec("COMMIT");
    } catch (err) {
      db.exec("ROLLBACK");
      if (err instanceof ApplicationError) return failWith(db, claim.recordId, err);
      return failWith(db, claim.recordId, mapErr(err));
    }
    return { kind: "executed", httpStatus: 200, resultResourceType: "Run", resultResourceId: runId, recordId: claim.recordId, data: { analysisRunId: runId, analysisProjectId: projectId, currentRunStatus: "aborted", endedAt: ts } };
  }

  // Running abort: signal AbortController (no DB writes), then record receipt in transaction
  // The actual run termination happens when executeRun completes (§6.4).
  const signaled = coordinator.signalRunningAbort(runId);
  if (!signaled) {
    return failWith(db, claim.recordId, new ApplicationError("command_interrupted", "Run is running but no abort controller is available; manual inspection required."));
  }
  db.exec("BEGIN");
  try {
    recordSuccessInTx(db, claim.recordId, { httpStatus: 200, resultResourceType: "Run", resultResourceId: runId });
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    return failWith(db, claim.recordId, mapErr(err));
  }
  return { kind: "executed", httpStatus: 200, resultResourceType: "Run", resultResourceId: runId, recordId: claim.recordId, data: { analysisRunId: runId, analysisProjectId: projectId, currentRunStatus: "running", endedAt: ts } };
}

export interface AbortRunResult {
  readonly analysisRunId: string;
  readonly analysisProjectId: string;
  readonly currentRunStatus: string;
  readonly endedAt: string;
}
