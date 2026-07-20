/**
 * Project lifecycle and ReadModel handlers (pi-Xanthil).
 * Workspace-scoped: workspaceId from route path, actorContext injected by runtime.
 */
import type { RequestContext } from "../router.ts";
import { sendJson, sendCommandResult, computeCanonicalDataEtag, matchesEtag } from "../envelope.ts";
import { BodyValidationError, readRequestBody, parseJsonStrict, validateObjectBody, validateIdempotencyKey, validateUuidPathParam } from "../body.ts";
import { ApplicationError } from "../../contracts/envelope.ts";
import type { TrustedActorContext } from "../../application/shared/runtime.ts";
import { createProject, updateProjectMetadata, deleteDraftProject } from "../../application/projects/project-service.ts";
import type { AnalysisProjectRow } from "../../application/projects/project-queries.ts";
import type { CommandResult } from "../../application/shared/command.ts";
import { cancelProject, archiveProject, unarchiveProject, reopenProject } from "../../application/projects/project-lifecycle-service.ts";
import { PROJECT_KINDS, PROJECT_STATUSES } from "../../contracts/registries.ts";
import { queryProjectList } from "../../application/read-models/project-list.ts";
import { queryProjectDetail } from "../../application/read-models/project-detail.ts";

const JSON_MAX_BYTES = 64 * 1024;

function requireJsonContentType(headers: Record<string, string | string[] | undefined>) {
  const ct = headers["content-type"];
  if (typeof ct !== "string" || !ct.toLowerCase().startsWith("application/json")) {
    throw new BodyValidationError("unsupported_media_type", "Content-Type must be application/json.");
  }
}

function projectCommandData(result: CommandResult<AnalysisProjectRow | { projectId: string; deletedAt: string }>): unknown {
  if (result.kind !== "executed") return {};
  const data = result.data as AnalysisProjectRow & { projectId?: string; deletedAt?: string };
  if ("analysisProjectId" in data) {
    return { ...data, projectId: data.analysisProjectId };
  }
  return data;
}

export async function handleCreateProject(ctx: RequestContext): Promise<void> {
  requireJsonContentType(ctx.headers);
  const body = await readRequestBody(ctx.req, JSON_MAX_BYTES);
  const parsed = parseJsonStrict(body);
  const obj = validateObjectBody(parsed, ["title", "slug"], ["title", "slug"]);
  const idempotencyKey = validateIdempotencyKey(ctx.headers["idempotency-key"] as string | undefined);
  const result = createProject({
    db: ctx.db,
    workspacePort: ctx.workspacePort,
    workspaceId: ctx.workspaceId,
    actorContext: ctx.actorContext,
    idempotencyKey,
    body: { title: obj.title as string, slug: obj.slug as string },
  });
  sendCommandResult(ctx.res, ctx.requestId, result, () => projectCommandData(result));
}

export async function handleListProjects(ctx: RequestContext): Promise<void> {
  const kind = (ctx.queryParams.kind ?? undefined) as (typeof PROJECT_KINDS)[number] | undefined;
  const status = (ctx.queryParams.status ?? undefined) as (typeof PROJECT_STATUSES)[number] | undefined;
  const archiveState = (ctx.queryParams.archiveState ?? "unarchived") as "archived" | "unarchived" | "all";
  const limit = ctx.queryParams.limit ? Math.min(100, Math.max(1, parseInt(ctx.queryParams.limit, 10) || 20)) : 20;
  const cursor = ctx.queryParams.cursor ?? null;

  const result = queryProjectList({
    db: ctx.db,
    workspaceId: ctx.workspaceId,
    actorContext: ctx.actorContext,
    filter: { kind, status, archiveState },
    limit,
    cursor,
  });
  sendJson(ctx.res, 200, { requestId: ctx.requestId, ...result }, { requestId: ctx.requestId });
}

export async function handleProjectDetail(ctx: RequestContext): Promise<void> {
  const projectId = validateUuidPathParam(ctx.pathParams.projectId, "projectId");
  const result = queryProjectDetail({
    db: ctx.db,
    workspaceId: ctx.workspaceId,
    projectId,
    actorContext: ctx.actorContext,
    authorizedForContent: true,
  });
  sendJson(ctx.res, 200, { requestId: ctx.requestId, ...result }, { requestId: ctx.requestId });
}

export async function handleUpdateProject(ctx: RequestContext): Promise<void> {
  requireJsonContentType(ctx.headers);
  const projectId = validateUuidPathParam(ctx.pathParams.projectId, "projectId");
  const body = await readRequestBody(ctx.req, JSON_MAX_BYTES);
  const parsed = parseJsonStrict(body);
  const obj = validateObjectBody(parsed, ["title", "slug", "expectedUpdatedAt"], ["title", "slug", "expectedUpdatedAt"]);
  const idempotencyKey = validateIdempotencyKey(ctx.headers["idempotency-key"] as string | undefined);
  const result = updateProjectMetadata({
    db: ctx.db,
    workspacePort: ctx.workspacePort,
    workspaceId: ctx.workspaceId,
    actorContext: ctx.actorContext,
    idempotencyKey,
    body: { title: obj.title as string, slug: obj.slug as string, expectedUpdatedAt: obj.expectedUpdatedAt as string },
    projectId,
  });
  sendCommandResult(ctx.res, ctx.requestId, result, () => projectCommandData(result));
}

export async function handleDeleteProject(ctx: RequestContext): Promise<void> {
  requireJsonContentType(ctx.headers);
  const projectId = validateUuidPathParam(ctx.pathParams.projectId, "projectId");
  const body = await readRequestBody(ctx.req, JSON_MAX_BYTES);
  const parsed = parseJsonStrict(body);
  const obj = validateObjectBody(parsed, ["confirmPermanentDeletion"], ["confirmPermanentDeletion"]);
  const idempotencyKey = validateIdempotencyKey(ctx.headers["idempotency-key"] as string | undefined);
  const result = deleteDraftProject({
    db: ctx.db,
    workspacePort: ctx.workspacePort,
    workspaceId: ctx.workspaceId,
    actorContext: ctx.actorContext,
    idempotencyKey,
    body: { confirmPermanentDeletion: obj.confirmPermanentDeletion as boolean },
    projectId,
  });
  sendCommandResult(ctx.res, ctx.requestId, result, () => projectCommandData(result));
}

function handleLifecycleCommand(
  handler: (input: { db: DatabaseSync; workspacePort: WorkspaceExistencePort; workspaceId: string; actorContext: TrustedActorContext; idempotencyKey: string; body: { expectedUpdatedAt: string }; projectId: string }) => CommandResult<AnalysisProjectRow>,
) {
  return async (ctx: RequestContext) => {
    requireJsonContentType(ctx.headers);
    const projectId = validateUuidPathParam(ctx.pathParams.projectId, "projectId");
    const body = await readRequestBody(ctx.req, JSON_MAX_BYTES);
    const parsed = parseJsonStrict(body);
    const obj = validateObjectBody(parsed, ["expectedUpdatedAt"], ["expectedUpdatedAt"]);
    const idempotencyKey = validateIdempotencyKey(ctx.headers["idempotency-key"] as string | undefined);
    const result = handler({
      db: ctx.db,
      workspacePort: ctx.workspacePort,
      workspaceId: ctx.workspaceId,
      actorContext: ctx.actorContext,
      idempotencyKey,
      body: { expectedUpdatedAt: obj.expectedUpdatedAt as string },
      projectId,
    });
    sendCommandResult(ctx.res, ctx.requestId, result, () => projectCommandData(result));
  };
}

export const handleCancelProject = handleLifecycleCommand(cancelProject);
export const handleArchiveProject = handleLifecycleCommand(archiveProject);
export const handleUnarchiveProject = handleLifecycleCommand(unarchiveProject);

export async function handleReopenProject(ctx: RequestContext): Promise<void> {
  requireJsonContentType(ctx.headers);
  const projectId = validateUuidPathParam(ctx.pathParams.projectId, "projectId");
  const body = await readRequestBody(ctx.req, JSON_MAX_BYTES);
  const parsed = parseJsonStrict(body);
  const obj = validateObjectBody(parsed, ["title", "slug", "expectedUpdatedAt"], ["title", "slug", "expectedUpdatedAt"]);
  const idempotencyKey = validateIdempotencyKey(ctx.headers["idempotency-key"] as string | undefined);
  const result = reopenProject({
    db: ctx.db,
    workspacePort: ctx.workspacePort,
    workspaceId: ctx.workspaceId,
    actorContext: ctx.actorContext,
    idempotencyKey,
    body: { title: obj.title as string, slug: obj.slug as string, expectedUpdatedAt: obj.expectedUpdatedAt as string },
    projectId,
  });
  sendCommandResult(ctx.res, ctx.requestId, result, () => projectCommandData(result));
}

import type { DatabaseSync } from "node:sqlite";
import type { WorkspaceExistencePort } from "../../contracts/workspace-port.ts";
