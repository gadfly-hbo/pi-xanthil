/**
 * AnalysisProject row type and read helpers.
 * Contract (schema-v1-and-migrations.md, P0-02/03/17/60/61, WCA-02).
 * WCA-02: every query must scope by workspaceId at the SQL root level.
 */
import type { DatabaseSync } from "node:sqlite";
import type { ProjectKind, ProjectStatus } from "../../contracts/registries.ts";

export interface AnalysisProjectRow {
  readonly analysisProjectId: string;
  readonly workspaceId: string;
  readonly projectKind: ProjectKind;
  readonly title: string;
  readonly slug: string;
  readonly projectStatus: ProjectStatus;
  readonly currentRequirementVersionId: string | null;
  readonly currentPlanVersionId: string | null;
  readonly sourceProjectId: string | null;
  readonly sourceRelationType: "derived_from" | "reopened_from" | null;
  readonly createdAt: string;
  readonly createdByActorId: string;
  readonly updatedAt: string;
  readonly completedAt: string | null;
  readonly rejectedAt: string | null;
  readonly cancelledAt: string | null;
  readonly archivedAt: string | null;
}

export interface ProjectRowShape {
  analysis_project_id: string;
  workspace_id: string;
  project_kind: string;
  title: string;
  slug: string;
  project_status: string;
  current_requirement_version_id: string | null;
  current_plan_version_id: string | null;
  source_project_id: string | null;
  source_relation_type: string | null;
  created_at: string;
  created_by_actor_id: string;
  updated_at: string;
  completed_at: string | null;
  rejected_at: string | null;
  cancelled_at: string | null;
  archived_at: string | null;
}

export const PROJECT_SELECT =
  "analysis_project_id, workspace_id, project_kind, title, slug, project_status, " +
  "current_requirement_version_id, current_plan_version_id, source_project_id, " +
  "source_relation_type, created_at, created_by_actor_id, updated_at, " +
  "completed_at, rejected_at, cancelled_at, archived_at";

export function rowToProject(row: ProjectRowShape): AnalysisProjectRow {
  return {
    analysisProjectId: row.analysis_project_id,
    workspaceId: row.workspace_id,
    projectKind: row.project_kind as ProjectKind,
    title: row.title,
    slug: row.slug,
    projectStatus: row.project_status as ProjectStatus,
    currentRequirementVersionId: row.current_requirement_version_id,
    currentPlanVersionId: row.current_plan_version_id,
    sourceProjectId: row.source_project_id,
    sourceRelationType: row.source_relation_type as "derived_from" | "reopened_from" | null,
    createdAt: row.created_at,
    createdByActorId: row.created_by_actor_id,
    updatedAt: row.updated_at,
    completedAt: row.completed_at,
    rejectedAt: row.rejected_at,
    cancelledAt: row.cancelled_at,
    archivedAt: row.archived_at,
  };
}

/**
 * Get a project by ID, scoped to a workspace.
 * WCA-02: filters by BOTH workspace_id AND analysis_project_id at the SQL root.
 * Returns null if the project doesn't exist or doesn't belong to the workspace.
 */
export function getProjectById(db: DatabaseSync, workspaceId: string, projectId: string): AnalysisProjectRow | null {
  const row = db.prepare(`SELECT ${PROJECT_SELECT} FROM analysis_projects WHERE workspace_id = ? AND analysis_project_id = ?`).get(workspaceId, projectId) as ProjectRowShape | undefined;
  return row ? rowToProject(row) : null;
}

/**
 * Count non-terminal (queued/running) runs for a project (P0-73).
 * WCA-02: scopes by workspace via subquery to prevent cross-workspace leakage.
 */
export function countActiveRuns(db: DatabaseSync, workspaceId: string, projectId: string): number {
  const row = db
    .prepare(`SELECT COUNT(*) AS c FROM analysis_runs WHERE analysis_project_id = ? AND analysis_project_id IN (SELECT analysis_project_id FROM analysis_projects WHERE workspace_id = ?) AND current_run_status IN ('queued', 'running')`)
    .get(projectId, workspaceId) as { c: number };
  return row.c;
}

/**
 * Whether a project has entered the audit chain (§6.1, P0-20/P0-21).
 * WCA-02: scopes by workspace via subquery.
 */
export function hasEnteredAuditChain(db: DatabaseSync, workspaceId: string, projectId: string): boolean {
  const wsSubquery = `AND analysis_project_id IN (SELECT analysis_project_id FROM analysis_projects WHERE workspace_id = ?)`;
  const requests = (db.prepare(`SELECT COUNT(*) AS c FROM analysis_requests WHERE analysis_project_id = ? ${wsSubquery}`).get(projectId, workspaceId) as { c: number }).c;
  if (requests > 0) return true;
  const gates = (db.prepare(`SELECT COUNT(*) AS c FROM gate_decisions WHERE analysis_project_id = ? ${wsSubquery}`).get(projectId, workspaceId) as { c: number }).c;
  if (gates > 0) return true;
  const runs = (db.prepare(`SELECT COUNT(*) AS c FROM analysis_runs WHERE analysis_project_id = ? ${wsSubquery}`).get(projectId, workspaceId) as { c: number }).c;
  if (runs > 0) return true;
  const reports = (db.prepare(`SELECT COUNT(*) AS c FROM report_versions WHERE analysis_project_id = ? ${wsSubquery}`).get(projectId, workspaceId) as { c: number }).c;
  if (reports > 0) return true;
  // child projects referencing this one as source (must be same workspace)
  const children = (db.prepare(`SELECT COUNT(*) AS c FROM analysis_projects WHERE source_project_id = ? AND workspace_id = ?`).get(projectId, workspaceId) as { c: number }).c;
  if (children > 0) return true;
  return false;
}

/** Whether a project has a derivable LockedReport (approved report_review).
 * WCA-02: scopes by workspace via subquery.
 */
export function hasLockedReport(db: DatabaseSync, workspaceId: string, projectId: string): boolean {
  const row = db
    .prepare(`SELECT COUNT(*) AS c FROM gate_decisions WHERE analysis_project_id = ? AND analysis_project_id IN (SELECT analysis_project_id FROM analysis_projects WHERE workspace_id = ?) AND gate_type = 'report_review' AND decision = 'approved'`)
    .get(projectId, workspaceId) as { c: number };
  return row.c > 0;
}
