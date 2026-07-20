/**
 * Project lifecycle application service (§6.1, API-042, P0-17/20/21/85).
 * Part 1: shared helpers + create/update_metadata/delete_draft.
 * WCA-02: all commands require workspaceId; all SQL scopes by workspace_id.
 */
import type { DatabaseSync } from "node:sqlite";
import { claimOn, recordFailure, recordSuccessInTx, type ClaimResult } from "../idempotency/idempotency-service.ts";
import { computeRequestHash, isUuidV4, now, uuid, type TrustedActorContext } from "../shared/runtime.ts";
import { ApplicationError } from "../../contracts/envelope.ts";
import type { CommandResult } from "../shared/command.ts";
import { getProjectById, countActiveRuns, hasEnteredAuditChain, type AnalysisProjectRow } from "./project-queries.ts";
import { assertWorkspaceExists, type WorkspaceExistencePort } from "../../contracts/workspace-port.ts";

const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export interface ProjectCommandInput<B> {
  readonly db: DatabaseSync;
  readonly workspacePort: WorkspaceExistencePort;
  readonly workspaceId: string;
  readonly actorContext: TrustedActorContext;
  readonly idempotencyKey: string;
  readonly body: B;
  readonly projectId?: string;
}

// --- shared helpers (exported for the lifecycle module) ---

export function assertActiveHuman(ctx: TrustedActorContext): void {
  if (!isUuidV4(ctx.actorId)) throw new ApplicationError("authentication_required", "Invalid actor context.");
  if (ctx.actorKind !== "human" || !ctx.active) throw new ApplicationError("actor_kind_forbidden", "Only an active human actor may run project commands.");
}
export function validateTitle(v: unknown): string {
  if (typeof v !== "string" || v.trim().length === 0) throw new ApplicationError("validation_failed", "title must be a non-empty string.", { fieldErrors: [{ fieldPath: "/title", code: "empty", summary: "title must be non-empty" }] });
  return v.trim();
}
export function validateSlug(v: unknown): string {
  if (typeof v !== "string" || !SLUG_RE.test(v)) throw new ApplicationError("validation_failed", "slug must be kebab-case [a-z0-9-]+.", { fieldErrors: [{ fieldPath: "/slug", code: "format", summary: "slug must be kebab-case" }] });
  return v;
}
/** WCA-02: requireProject scopes by workspace at SQL level via getProjectById. */
export function requireProject(db: DatabaseSync, workspaceId: string, projectId: string | undefined): AnalysisProjectRow {
  if (!projectId || !isUuidV4(projectId)) throw new ApplicationError("resource_not_found", "Project not found.");
  const p = getProjectById(db, workspaceId, projectId);
  if (!p) throw new ApplicationError("resource_not_found", "Project not found.");
  return p;
}
export function requireExpectedUpdatedAt(v: unknown): string {
  if (typeof v !== "string") throw new ApplicationError("validation_failed", "expectedUpdatedAt must be a string.", { fieldErrors: [{ fieldPath: "/expectedUpdatedAt", code: "type", summary: "expectedUpdatedAt must be a string" }] });
  return v;
}
export function handleClaim(claim: ClaimResult): CommandResult<never> | null {
  if (claim.kind === "in_progress") return { kind: "in_progress", recordId: claim.recordId };
  if (claim.kind === "conflict") return { kind: "conflict", recordId: claim.recordId };
  if (claim.kind === "replay_success") return { kind: "replayed_success", httpStatus: claim.record.responseHttpStatus!, resultResourceType: claim.record.resultResourceType!, resultResourceId: claim.record.resultResourceId!, recordId: claim.record.idempotencyRecordId };
  if (claim.kind === "replay_failed") return { kind: "failed", httpStatus: claim.record.responseHttpStatus!, errorCode: claim.record.errorCode!, errorSummary: claim.record.errorSummary!, fieldErrors: [], recordId: claim.record.idempotencyRecordId };
  return null;
}
export function failWith(db: DatabaseSync, recordId: string, err: ApplicationError): CommandResult<never> {
  recordFailure(db, recordId, { httpStatus: err.httpStatus, errorCode: err.code, errorSummary: err.message });
  return { kind: "failed", httpStatus: err.httpStatus, errorCode: err.code, errorSummary: err.message, fieldErrors: err.fieldErrors, recordId };
}
export function mapErr(err: unknown): ApplicationError {
  if (err instanceof ApplicationError) return err;
  const msg = (err as Error).message ?? "internal error";
  if (/UNIQUE.*slug|slug.*UNIQUE/i.test(msg)) return new ApplicationError("validation_failed", "slug already exists (case-insensitive).", { fieldErrors: [{ fieldPath: "/slug", code: "duplicate", summary: "slug already exists" }] });
  if (/UNIQUE|constraint/i.test(msg)) return new ApplicationError("concurrent_modification", "A concurrent modification occurred; refresh and retry.");
  return new ApplicationError("internal_error", "An internal error occurred.", { cause: err });
}
export { getProjectById, countActiveRuns, hasEnteredAuditChain, now, uuid, assertWorkspaceExists };

// --- project.create ---
export interface CreateProjectBody { readonly title: string; readonly slug: string }
export function createProject(input: ProjectCommandInput<CreateProjectBody>): CommandResult<AnalysisProjectRow> {
  const { db, workspacePort, workspaceId, actorContext, idempotencyKey, body } = input;
  assertActiveHuman(actorContext);
  assertWorkspaceExists(workspacePort, workspaceId);
  const title = validateTitle(body.title);
  const slug = validateSlug(body.slug);
  const requestHash = computeRequestHash("POST", "/api/v1/projects", body);
  const claim = claimOn(db, { actorId: actorContext.actorId, commandType: "project.create", idempotencyKey, requestHash });
  const pre = handleClaim(claim);
  if (pre) return pre;
  const projectId = uuid();
  const ts = now();
  db.exec("BEGIN");
  try {
    db.prepare(`INSERT INTO analysis_projects (analysis_project_id, workspace_id, project_kind, title, slug, project_status, created_at, created_by_actor_id, updated_at) VALUES (?, ?, 'daily_analysis', ?, ?, 'active', ?, ?, ?)`).run(projectId, workspaceId, title, slug, ts, actorContext.actorId, ts);
    recordSuccessInTx(db, claim.recordId, { httpStatus: 201, resultResourceType: "Project", resultResourceId: projectId });
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    return failWith(db, claim.recordId, mapErr(err));
  }
  return { kind: "executed", httpStatus: 201, resultResourceType: "Project", resultResourceId: projectId, data: getProjectById(db, workspaceId, projectId)!, recordId: claim.recordId };
}

// --- project.update_metadata ---
export interface UpdateMetadataBody { readonly title: string; readonly slug: string; readonly expectedUpdatedAt: string }
export function updateProjectMetadata(input: ProjectCommandInput<UpdateMetadataBody>): CommandResult<AnalysisProjectRow> {
  const { db, workspaceId, actorContext, idempotencyKey, body, projectId } = input;
  assertActiveHuman(actorContext);
  const title = validateTitle(body.title);
  const slug = validateSlug(body.slug);
  const expectedUpdatedAt = requireExpectedUpdatedAt(body.expectedUpdatedAt);
  const proj = requireProject(db, workspaceId, projectId);
  const requestHash = computeRequestHash("PATCH", `/api/v1/projects/${projectId}`, body);
  const claim = claimOn(db, { actorId: actorContext.actorId, commandType: "project.update_metadata", idempotencyKey, requestHash });
  const pre = handleClaim(claim);
  if (pre) return pre;
  if (proj.updatedAt !== expectedUpdatedAt) return failWith(db, claim.recordId, new ApplicationError("concurrent_modification", "expectedUpdatedAt does not match; refresh and retry."));
  const ts = now();
  db.exec("BEGIN");
  try {
    const res = db.prepare(`UPDATE analysis_projects SET title = ?, slug = ?, updated_at = ? WHERE analysis_project_id = ? AND workspace_id = ? AND updated_at = ?`).run(title, slug, ts, projectId!, workspaceId, expectedUpdatedAt);
    if (res.changes !== 1) throw new ApplicationError("concurrent_modification", "Project was concurrently modified; refresh and retry.");
    recordSuccessInTx(db, claim.recordId, { httpStatus: 200, resultResourceType: "Project", resultResourceId: projectId! });
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    return failWith(db, claim.recordId, mapErr(err));
  }
  return { kind: "executed", httpStatus: 200, resultResourceType: "Project", resultResourceId: projectId!, data: getProjectById(db, workspaceId, projectId!)!, recordId: claim.recordId };
}

// --- project.delete_draft ---
export interface DeleteDraftBody { readonly confirmPermanentDeletion: boolean }
export function deleteDraftProject(input: ProjectCommandInput<DeleteDraftBody>): CommandResult<{ readonly projectId: string; readonly deletedAt: string }> {
  const { db, workspaceId, actorContext, idempotencyKey, body, projectId } = input;
  assertActiveHuman(actorContext);
  if (body.confirmPermanentDeletion !== true) throw new ApplicationError("validation_failed", "confirmPermanentDeletion must be true.", { fieldErrors: [{ fieldPath: "/confirmPermanentDeletion", code: "required", summary: "confirmPermanentDeletion must be true" }] });
  requireProject(db, workspaceId, projectId);
  const requestHash = computeRequestHash("DELETE", `/api/v1/projects/${projectId}`, body);
  const claim = claimOn(db, { actorId: actorContext.actorId, commandType: "project.delete_draft", idempotencyKey, requestHash });
  const pre = handleClaim(claim);
  if (pre) return pre;
  if (hasEnteredAuditChain(db, workspaceId, projectId!)) return failWith(db, claim.recordId, new ApplicationError("invalid_state_transition", "Project has entered the audit chain and cannot be hard-deleted."));
  const ts = now();
  const pid = projectId!;
  const wsScope = `AND analysis_project_id IN (SELECT analysis_project_id FROM analysis_projects WHERE workspace_id = ?)`;
  db.exec("BEGIN");
  try {
    db.prepare(`DELETE FROM evidence_artifacts WHERE analysis_project_id = ? ${wsScope}`).run(pid, workspaceId);
    db.prepare(`DELETE FROM source_checks WHERE source_reference_id IN (SELECT source_reference_id FROM source_references WHERE analysis_project_id = ? ${wsScope})`).run(pid, workspaceId);
    db.prepare(`DELETE FROM source_references WHERE analysis_project_id = ? ${wsScope}`).run(pid, workspaceId);
    const res = db.prepare(`DELETE FROM analysis_projects WHERE analysis_project_id = ? AND workspace_id = ?`).run(pid, workspaceId);
    if (res.changes !== 1) throw new ApplicationError("resource_not_found", "Project not found.");
    recordSuccessInTx(db, claim.recordId, { httpStatus: 200, resultResourceType: "Project", resultResourceId: pid });
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    return failWith(db, claim.recordId, mapErr(err));
  }
  return { kind: "executed", httpStatus: 200, resultResourceType: "Project", resultResourceId: pid, data: { projectId: pid, deletedAt: ts }, recordId: claim.recordId };
}
