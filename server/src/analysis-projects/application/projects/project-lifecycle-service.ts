/**
 * Project lifecycle application service (§6.1, API-042, P0-17/85).
 * Part 2: cancel, archive, unarchive, reopen.
 * - active Run blocks cancel/archive; three terminal states irreversible.
 * - archive reversible; reopen creates empty new project with reopened_from.
 */
import { claimOn, recordSuccessInTx } from "../idempotency/idempotency-service.ts";
import { computeRequestHash, now, uuid } from "../shared/runtime.ts";
import { ApplicationError } from "../../contracts/envelope.ts";
import type { CommandResult } from "../shared/command.ts";
import {
  assertActiveHuman, requireProject, requireExpectedUpdatedAt, handleClaim, failWith, mapErr,
  getProjectById, countActiveRuns, validateTitle, validateSlug,
  type ProjectCommandInput,
} from "./project-service.ts";
import type { AnalysisProjectRow } from "./project-queries.ts";

export interface LifecycleBody { readonly expectedUpdatedAt: string }

// --- project.cancel ---
export function cancelProject(input: ProjectCommandInput<LifecycleBody>): CommandResult<AnalysisProjectRow> {
  const { db, workspaceId, actorContext, idempotencyKey, body, projectId } = input;
  assertActiveHuman(actorContext);
  const expectedUpdatedAt = requireExpectedUpdatedAt(body.expectedUpdatedAt);
  const proj = requireProject(db, workspaceId, projectId);
  const requestHash = computeRequestHash("POST", `/api/v1/projects/${projectId}:cancel`, body);
  const claim = claimOn(db, { actorId: actorContext.actorId, commandType: "project.cancel", idempotencyKey, requestHash });
  const pre = handleClaim(claim);
  if (pre) return pre;
  if (proj.projectStatus !== "active") return failWith(db, claim.recordId, new ApplicationError("invalid_state_transition", "Only an active project can be cancelled."));
  if (proj.updatedAt !== expectedUpdatedAt) return failWith(db, claim.recordId, new ApplicationError("concurrent_modification", "expectedUpdatedAt does not match; refresh and retry."));
  if (countActiveRuns(db, workspaceId, projectId!) > 0) return failWith(db, claim.recordId, new ApplicationError("active_run_exists", "Cannot cancel a project with an active Run."));
  const ts = now();
  db.exec("BEGIN");
  try {
    const res = db.prepare(`UPDATE analysis_projects SET project_status = 'cancelled', cancelled_at = ?, updated_at = ? WHERE analysis_project_id = ? AND workspace_id = ? AND updated_at = ? AND project_status = 'active'`).run(ts, ts, projectId!, workspaceId, expectedUpdatedAt);
    if (res.changes !== 1) throw new ApplicationError("concurrent_modification", "Project was concurrently modified; refresh and retry.");
    recordSuccessInTx(db, claim.recordId, { httpStatus: 200, resultResourceType: "Project", resultResourceId: projectId! });
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    return failWith(db, claim.recordId, mapErr(err));
  }
  return { kind: "executed", httpStatus: 200, resultResourceType: "Project", resultResourceId: projectId!, data: getProjectById(db, workspaceId, projectId!)!, recordId: claim.recordId };
}

// --- project.archive / project.unarchive ---
export function archiveProject(input: ProjectCommandInput<LifecycleBody>): CommandResult<AnalysisProjectRow> {
  return archiveToggle(input, "archive", "project.archive", ":archive");
}
export function unarchiveProject(input: ProjectCommandInput<LifecycleBody>): CommandResult<AnalysisProjectRow> {
  return archiveToggle(input, "unarchive", "project.unarchive", ":unarchive");
}
function archiveToggle(input: ProjectCommandInput<LifecycleBody>, action: "archive" | "unarchive", commandType: "project.archive" | "project.unarchive", suffix: string): CommandResult<AnalysisProjectRow> {
  const { db, workspaceId, actorContext, idempotencyKey, body, projectId } = input;
  assertActiveHuman(actorContext);
  const expectedUpdatedAt = requireExpectedUpdatedAt(body.expectedUpdatedAt);
  const proj = requireProject(db, workspaceId, projectId);
  const requestHash = computeRequestHash("POST", `/api/v1/projects/${projectId}${suffix}`, body);
  const claim = claimOn(db, { actorId: actorContext.actorId, commandType, idempotencyKey, requestHash });
  const pre = handleClaim(claim);
  if (pre) return pre;
  if (action === "archive" && proj.archivedAt !== null) return failWith(db, claim.recordId, new ApplicationError("invalid_state_transition", "Project is already archived."));
  if (action === "unarchive" && proj.archivedAt === null) return failWith(db, claim.recordId, new ApplicationError("invalid_state_transition", "Project is not archived."));
  if (proj.updatedAt !== expectedUpdatedAt) return failWith(db, claim.recordId, new ApplicationError("concurrent_modification", "expectedUpdatedAt does not match; refresh and retry."));
  if (countActiveRuns(db, workspaceId, projectId!) > 0) return failWith(db, claim.recordId, new ApplicationError("active_run_exists", "Cannot archive a project with an active Run."));
  const ts = now();
  const newArchivedAt = action === "archive" ? ts : null;
  db.exec("BEGIN");
  try {
    const res = db.prepare(`UPDATE analysis_projects SET archived_at = ?, updated_at = ? WHERE analysis_project_id = ? AND workspace_id = ? AND updated_at = ?`).run(newArchivedAt, ts, projectId!, workspaceId, expectedUpdatedAt);
    if (res.changes !== 1) throw new ApplicationError("concurrent_modification", "Project was concurrently modified; refresh and retry.");
    recordSuccessInTx(db, claim.recordId, { httpStatus: 200, resultResourceType: "Project", resultResourceId: projectId! });
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    return failWith(db, claim.recordId, mapErr(err));
  }
  return { kind: "executed", httpStatus: 200, resultResourceType: "Project", resultResourceId: projectId!, data: getProjectById(db, workspaceId, projectId!)!, recordId: claim.recordId };
}

// --- project.reopen ---
export interface ReopenBody { readonly title: string; readonly slug: string; readonly expectedUpdatedAt: string }
export function reopenProject(input: ProjectCommandInput<ReopenBody>): CommandResult<AnalysisProjectRow> {
  const { db, workspaceId, actorContext, idempotencyKey, body, projectId } = input;
  assertActiveHuman(actorContext);
  const title = validateTitle(body.title);
  const slug = validateSlug(body.slug);
  const expectedUpdatedAt = requireExpectedUpdatedAt(body.expectedUpdatedAt);
  const proj = requireProject(db, workspaceId, projectId);
  const requestHash = computeRequestHash("POST", `/api/v1/projects/${projectId}:reopen`, body);
  const claim = claimOn(db, { actorId: actorContext.actorId, commandType: "project.reopen", idempotencyKey, requestHash });
  const pre = handleClaim(claim);
  if (pre) return pre;
  // reopen only allowed for rejected projects (P0-15/P0-16).
  if (proj.projectStatus !== "rejected") return failWith(db, claim.recordId, new ApplicationError("invalid_state_transition", "Only a rejected project can be reopened."));
  if (proj.updatedAt !== expectedUpdatedAt) return failWith(db, claim.recordId, new ApplicationError("concurrent_modification", "expectedUpdatedAt does not match; refresh and retry."));
  const newProjectId = uuid();
  const ts = now();
  db.exec("BEGIN");
  try {
    // Create empty new project with reopened_from source relation; no approval inheritance.
    db.prepare(`INSERT INTO analysis_projects (analysis_project_id, workspace_id, project_kind, title, slug, project_status, source_project_id, source_relation_type, created_at, created_by_actor_id, updated_at) VALUES (?, ?, 'daily_analysis', ?, ?, 'active', ?, 'reopened_from', ?, ?, ?)`).run(newProjectId, workspaceId, title, slug, projectId!, ts, actorContext.actorId, ts);
    recordSuccessInTx(db, claim.recordId, { httpStatus: 201, resultResourceType: "Project", resultResourceId: newProjectId });
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    return failWith(db, claim.recordId, mapErr(err));
  }
  return { kind: "executed", httpStatus: 201, resultResourceType: "Project", resultResourceId: newProjectId, data: getProjectById(db, workspaceId, newProjectId)!, recordId: claim.recordId };
}
