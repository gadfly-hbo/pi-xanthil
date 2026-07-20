/**
 * Real-time derivation helpers for ReadModels (§7, P0-84).
 * All derived from the current read snapshot; nothing persisted.
 * WCA-02: all queries scope by workspaceId at the SQL root.
 * Stage drift fix: deriveProjectStage returns ProjectStage (not string),
 * with all values defined in the PROJECT_STAGES registry.
 * T0020: extends to S3.1-S3.6 from closure facts after locked report.
 */
import type { DatabaseSync } from "node:sqlite";
import { hasLockedReport } from "../projects/project-queries.ts";
import type { ProjectStage } from "../../contracts/registries.ts";

/** Workspace-scoped subquery for non-project tables. */
const WS_SCOPE = `AND analysis_project_id IN (SELECT analysis_project_id FROM analysis_projects WHERE workspace_id = ?)`;

/**
 * Derive the current AnalysisOps project stage S1.1–S3.6 for a project.
 * Returns a registry-defined ProjectStage (not an arbitrary string).
 * S3.1-S3.6 are derived from closure cycle facts when a locked report exists.
 * If multiple closure cycles exist, uses the latest (highest ordinal).
 */
export function deriveProjectStage(db: DatabaseSync, workspaceId: string, projectId: string): ProjectStage {
  if (hasLockedReport(db, workspaceId, projectId)) {
    // T0020: check for closure cycle stages S3.1-S3.6
    const closureStage = deriveClosureStage(db, workspaceId, projectId);
    if (closureStage) return closureStage;
    return "S2.6";
  }
  const report = (db.prepare(`SELECT COUNT(*) AS c FROM report_versions WHERE analysis_project_id = ? ${WS_SCOPE}`).get(projectId, workspaceId) as { c: number }).c;
  if (report > 0) return "S2.5";
  const run = db.prepare(`SELECT current_analysis_stage, current_run_status FROM analysis_runs WHERE analysis_project_id = ? ${WS_SCOPE} ORDER BY run_ordinal DESC LIMIT 1`).get(projectId, workspaceId) as { current_analysis_stage: string; current_run_status: string } | undefined;
  if (run) {
    if (run.current_run_status === "succeeded") return "S2.5";
    // run.current_analysis_stage is S2.1-S2.4, all in PROJECT_STAGES
    return run.current_analysis_stage as ProjectStage;
  }
  const plan = (db.prepare(`SELECT COUNT(*) AS c FROM analysis_plan_versions pv JOIN analysis_projects p ON p.current_plan_version_id = pv.analysis_plan_version_id WHERE p.analysis_project_id = ? AND p.workspace_id = ?`).get(projectId, workspaceId) as { c: number }).c;
  if (plan > 0) return "S2.1";
  const planExists = (db.prepare(`SELECT COUNT(*) AS c FROM analysis_plan_versions WHERE analysis_project_id = ? ${WS_SCOPE}`).get(projectId, workspaceId) as { c: number }).c;
  if (planExists > 0) return "S1.4";
  const req = (db.prepare(`SELECT COUNT(*) AS c FROM structured_requirement_versions WHERE analysis_project_id = ? ${WS_SCOPE}`).get(projectId, workspaceId) as { c: number }).c;
  if (req > 0) return "S1.2";
  const request = (db.prepare(`SELECT COUNT(*) AS c FROM analysis_requests WHERE analysis_project_id = ? ${WS_SCOPE}`).get(projectId, workspaceId) as { c: number }).c;
  if (request > 0) return "S1.1";
  return "S1.1";
}

/**
 * Derive the highest completed S3.x stage from closure cycle facts.
 * Returns the stage of the most recently inserted fact in the latest cycle,
 * or null if no closure cycle exists.
 *
 * Stage precedence: S3.6 > S3.5 > S3.4 > S3.3 > S3.2 > S3.1.
 * S3.4 counts as present if at least one feedback entry exists.
 */
function deriveClosureStage(db: DatabaseSync, workspaceId: string, projectId: string): ProjectStage | null {
  // Find the latest closure cycle for this project
  const cycle = db.prepare(
    `SELECT closure_cycle_id, current_stage FROM closure_cycles WHERE analysis_project_id = ? AND workspace_id = ? ORDER BY closure_ordinal DESC LIMIT 1`,
  ).get(projectId, workspaceId) as { closure_cycle_id: string; current_stage: string | null } | undefined;
  if (!cycle) return null;

  const cycleId = cycle.closure_cycle_id;

  // Check stages from highest to lowest
  const s36 = db.prepare(`SELECT 1 FROM s36_iteration_triggers WHERE closure_cycle_id = ?`).get(cycleId);
  if (s36) return "S3.6";

  const s35 = db.prepare(`SELECT 1 FROM s35_effect_evaluations WHERE closure_cycle_id = ?`).get(cycleId);
  if (s35) return "S3.5";

  const s34 = db.prepare(`SELECT 1 FROM s34_feedback_ingestions WHERE closure_cycle_id = ? LIMIT 1`).get(cycleId);
  if (s34) return "S3.4";

  const s33 = db.prepare(`SELECT 1 FROM s33_business_executions WHERE closure_cycle_id = ?`).get(cycleId);
  if (s33) return "S3.3";

  const s32 = db.prepare(`SELECT 1 FROM s32_system_deployments WHERE closure_cycle_id = ?`).get(cycleId);
  if (s32) return "S3.2";

  const s31 = db.prepare(`SELECT 1 FROM s31_conclusion_translations WHERE closure_cycle_id = ?`).get(cycleId);
  if (s31) return "S3.1";

  // Cycle exists but no stage facts yet — still at S2.6
  return null;
}

/** Derive the pending Gate type for a project, or null. */
export function derivePendingGate(db: DatabaseSync, workspaceId: string, projectId: string): "requirement_confirmation" | "plan_confirmation" | "report_review" | null {
  const reqRow = db.prepare(`SELECT current_requirement_version_id FROM analysis_projects WHERE analysis_project_id = ? AND workspace_id = ?`).get(projectId, workspaceId) as { current_requirement_version_id: string | null } | undefined;
  if (reqRow?.current_requirement_version_id) {
    const decided = (db.prepare(`SELECT COUNT(*) AS c FROM gate_decisions WHERE analysis_project_id = ? ${WS_SCOPE} AND gate_type = 'requirement_confirmation' AND target_object_id = ?`).get(projectId, workspaceId, reqRow.current_requirement_version_id) as { c: number }).c;
    if (decided === 0) return "requirement_confirmation";
  }
  const planRow = db.prepare(`SELECT current_plan_version_id FROM analysis_projects WHERE analysis_project_id = ? AND workspace_id = ?`).get(projectId, workspaceId) as { current_plan_version_id: string | null } | undefined;
  if (planRow?.current_plan_version_id) {
    const decided = (db.prepare(`SELECT COUNT(*) AS c FROM gate_decisions WHERE analysis_project_id = ? ${WS_SCOPE} AND gate_type = 'plan_confirmation' AND target_object_id = ?`).get(projectId, workspaceId, planRow.current_plan_version_id) as { c: number }).c;
    if (decided === 0) return "plan_confirmation";
  }
  const reportRow = db.prepare(`SELECT report_version_id FROM report_versions WHERE analysis_project_id = ? ${WS_SCOPE} ORDER BY version_ordinal DESC LIMIT 1`).get(projectId, workspaceId) as { report_version_id: string } | undefined;
  if (reportRow?.report_version_id) {
    const decided = (db.prepare(`SELECT COUNT(*) AS c FROM gate_decisions WHERE analysis_project_id = ? ${WS_SCOPE} AND gate_type = 'report_review' AND target_object_id = ?`).get(projectId, workspaceId, reportRow.report_version_id) as { c: number }).c;
    if (decided === 0) return "report_review";
  }
  return null;
}

export interface LatestRunSummary {
  readonly runId: string;
  readonly runOrdinal: number;
  readonly currentAnalysisStage: string;
  readonly currentRunStatus: string;
  readonly queuedAt: string;
  readonly startedAt: string | null;
  readonly endedAt: string | null;
}

export function deriveLatestRun(db: DatabaseSync, workspaceId: string, projectId: string): LatestRunSummary | null {
  const row = db.prepare(`SELECT analysis_run_id, run_ordinal, current_analysis_stage, current_run_status, queued_at, started_at, ended_at FROM analysis_runs WHERE analysis_project_id = ? ${WS_SCOPE} ORDER BY run_ordinal DESC LIMIT 1`).get(projectId, workspaceId) as
    | { analysis_run_id: string; run_ordinal: number; current_analysis_stage: string; current_run_status: string; queued_at: string; started_at: string | null; ended_at: string | null }
    | undefined;
  if (!row) return null;
  return {
    runId: row.analysis_run_id, runOrdinal: row.run_ordinal,
    currentAnalysisStage: row.current_analysis_stage, currentRunStatus: row.current_run_status,
    queuedAt: row.queued_at, startedAt: row.started_at, endedAt: row.ended_at,
  };
}

/** Derive lockedReportId (= approved report_version_id) or null. */
export function deriveLockedReportId(db: DatabaseSync, workspaceId: string, projectId: string): string | null {
  const row = db.prepare(
    `SELECT rv.report_version_id FROM gate_decisions gd JOIN report_versions rv ON rv.report_version_id = gd.target_object_id
     WHERE gd.analysis_project_id = ? AND gd.analysis_project_id IN (SELECT analysis_project_id FROM analysis_projects WHERE workspace_id = ?) AND gd.gate_type = 'report_review' AND gd.decision = 'approved' LIMIT 1`,
  ).get(projectId, workspaceId) as { report_version_id: string } | undefined;
  return row?.report_version_id ?? null;
}

/**
 * Derive available project lifecycle commands for the current actor and snapshot
 * (§7.8, API-057). UI guidance only; execution re-validates.
 */
export function deriveProjectCommands(input: {
  readonly status: string;
  readonly archived: boolean;
  readonly hasActiveRun: boolean;
  readonly auditChainEntered: boolean;
  readonly actorActiveHuman: boolean;
}): readonly import("../../contracts/dto.ts").CommandAffordance[] {
  const { status, archived, hasActiveRun, auditChainEntered, actorActiveHuman } = input;
  type Cmd = import("../../contracts/dto.ts").CommandAffordance;
  const mk = (commandType: string, available: boolean, reason: string): Cmd => ({
    commandType,
    available: available && actorActiveHuman,
    unavailableReasons: available && actorActiveHuman ? [] : [actorActiveHuman ? reason : "actor_not_active_human"],
  });
  const cmds: Cmd[] = [];
  cmds.push(mk("project.update_metadata", !archived, archived ? "project_archived" : ""));
  cmds.push(mk("project.delete_draft", !auditChainEntered, auditChainEntered ? "audit_chain_entered" : ""));
  cmds.push(mk("project.cancel", status === "active" && !hasActiveRun, status !== "active" ? "not_active" : "active_run_exists"));
  cmds.push(mk("project.archive", !archived && !hasActiveRun, archived ? "already_archived" : "active_run_exists"));
  cmds.push(mk("project.unarchive", archived, "not_archived"));
  cmds.push(mk("project.reopen", status === "rejected", "not_rejected"));
  return cmds;
}
