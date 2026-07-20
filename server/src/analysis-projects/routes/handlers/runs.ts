/**
 * Run HTTP handlers.
 *
 * - POST /api/v1/projects/{projectId}/runs/{runId}:abort
 * - POST /api/v1/projects/{projectId}/runs/{runId}:retry
 * - GET  /api/v1/projects/{projectId}/runs/{runId}
 *
 * Note: run.execute is NOT in the 27-command registry (§5.1); the durable Run
 * coordinator's executeRun is an internal service entrypoint called by the
 * coordinator or tests, not an HTTP command. See handoff CONTRACT_CHANGE_REQUEST.
 */
import type { RequestContext } from "../router.ts";
import { sendJson, sendCommandResult, computeCanonicalDataEtag, matchesEtag } from "../envelope.ts";
import { BodyValidationError, readRequestBody, parseJsonStrict, validateObjectBody, validateIdempotencyKey, validateUuidPathParam, validateNonNegativeInteger } from "../body.ts";
import { ApplicationError } from "../../contracts/envelope.ts";
import type { TrustedActorContext } from "../../application/shared/runtime.ts";
import { abortRunCommand, type RunCoordinator, type AbortRunBody, type RetryRunBody } from "../../application/runs/run-coordinator.ts";
import { queryRunProgress } from "../../application/read-models/run-progress.ts";
import { deriveClientVersion } from "../auth/context.ts";

const JSON_MAX_BYTES = 64 * 1024;

function requireJsonContentType(headers: Record<string, string | string[] | undefined>) {
  const ct = headers["content-type"];
  if (typeof ct !== "string" || !ct.toLowerCase().startsWith("application/json")) {
    throw new BodyValidationError("unsupported_media_type", "Content-Type must be application/json.");
  }
}

/**
 * Create run handlers with injected RunCoordinator.
 * The coordinator is injected at server startup, not per-request.
 */
export function createRunHandlers(coordinator: RunCoordinator) {
  async function handleAbortRun(ctx: RequestContext): Promise<void> {
    requireJsonContentType(ctx.headers);
    const actorContext = ctx.actorContext;
    const projectId = validateUuidPathParam(ctx.pathParams.projectId, "projectId");
    const runId = validateUuidPathParam(ctx.pathParams.runId, "runId");
    const body = await readRequestBody(ctx.req, JSON_MAX_BYTES);
    const parsed = parseJsonStrict(body);
    const obj = validateObjectBody(parsed, ["expectedStatus", "expectedLastSequence", "reason"], ["expectedStatus", "expectedLastSequence"]);
    const idempotencyKey = validateIdempotencyKey(ctx.headers["idempotency-key"] as string | undefined);
    const clientVersion = deriveClientVersion(ctx.headers);
    const expectedStatus = obj.expectedStatus as string;
    if (expectedStatus !== "queued" && expectedStatus !== "running") {
      throw new BodyValidationError("validation_failed", "expectedStatus must be 'queued' or 'running'.", {
        fieldErrors: [{ fieldPath: "/expectedStatus", code: "invalid_enum", summary: "Must be queued or running" }],
      });
    }
    const expectedLastSequence = validateNonNegativeInteger(obj.expectedLastSequence, "/expectedLastSequence");
    const abortBody: AbortRunBody = {
      expectedStatus: expectedStatus as "queued" | "running",
      expectedLastSequence,
      reason: (obj.reason as string | null) ?? null,
    };
    const result = abortRunCommand({
      db: ctx.db, workspaceId: ctx.workspaceId,
      actorContext: { ...actorContext, clientVersion },
      idempotencyKey,
      projectId,
      runId,
      body: abortBody,
      coordinator,
    });
    sendCommandResult(ctx.res, ctx.requestId, result, () => (result.kind === "executed" ? result.data : {}));
  }

  async function handleRetryRun(ctx: RequestContext): Promise<void> {
    requireJsonContentType(ctx.headers);
    const actorContext = ctx.actorContext;
    const projectId = validateUuidPathParam(ctx.pathParams.projectId, "projectId");
    const runId = validateUuidPathParam(ctx.pathParams.runId, "runId");
    const body = await readRequestBody(ctx.req, JSON_MAX_BYTES);
    const parsed = parseJsonStrict(body);
    const obj = validateObjectBody(parsed, ["expectedPlanVersionId"], []);
    const idempotencyKey = validateIdempotencyKey(ctx.headers["idempotency-key"] as string | undefined);
    const clientVersion = deriveClientVersion(ctx.headers);
    const retryBody: RetryRunBody = obj.expectedPlanVersionId !== undefined
      ? { expectedPlanVersionId: obj.expectedPlanVersionId as string }
      : {};
    const result = coordinator.retryRun({
      db: ctx.db, workspaceId: ctx.workspaceId,
      layout: ctx.layout,
      actorContext: { ...actorContext, clientVersion },
      idempotencyKey,
      projectId,
      runId,
      body: retryBody,
    });
    sendCommandResult(ctx.res, ctx.requestId, result, () => (result.kind === "executed" ? result.data : {}));
  }

  async function handleRunProgress(ctx: RequestContext): Promise<void> {
    const actorContext = ctx.actorContext;
    const projectId = validateUuidPathParam(ctx.pathParams.projectId, "projectId");
    const runId = validateUuidPathParam(ctx.pathParams.runId, "runId");
    // Parse optional query params: afterSequence, limit
    let afterSequence = 0;
    let limit = 100;
    if (ctx.queryParams.afterSequence !== undefined) {
      const parsed = parseInt(ctx.queryParams.afterSequence, 10);
      if (!Number.isInteger(parsed) || parsed < 0) {
        throw new ApplicationError("invalid_cursor", "afterSequence must be a non-negative integer.");
      }
      afterSequence = parsed;
    }
    if (ctx.queryParams.limit !== undefined) {
      const parsed = parseInt(ctx.queryParams.limit, 10);
      if (!Number.isInteger(parsed) || parsed < 1 || parsed > 500) {
        throw new ApplicationError("validation_failed", "limit must be an integer between 1 and 500.");
      }
      limit = parsed;
    }

    let envelope: ReturnType<typeof queryRunProgress>;
    try {
      envelope = queryRunProgress({ db: ctx.db, workspaceId: ctx.workspaceId, projectId, runId, actorContext, afterSequence, limit });
    } catch (err) {
      if (err instanceof ApplicationError) throw err;
      throw new ApplicationError("read_model_unavailable", "Run progress read model is not available.");
    }

    const etag = computeCanonicalDataEtag(envelope.data);
    if (matchesEtag(ctx.req, etag)) {
      sendJson(ctx.res, 304, {}, { requestId: ctx.requestId, etag, cacheControl: "private, no-cache" });
      return;
    }
    sendJson(ctx.res, 200, envelope, { requestId: ctx.requestId, etag, cacheControl: "private, no-cache" });
  }

  return { handleAbortRun, handleRetryRun, handleRunProgress };
}
