/**
 * Plan HTTP handlers.
 *
 * - POST /api/v1/projects/{projectId}/plans:generate
 * - POST /api/v1/projects/{projectId}/plans/{planVersionId}:decide-confirmation
 * - GET /api/v1/projects/{projectId}/plans/{planVersionId}
 */
import type { RequestContext } from "../router.ts";
import { sendJson, sendCommandResult, computeCanonicalDataEtag, matchesEtag } from "../envelope.ts";
import { BodyValidationError, readRequestBody, parseJsonStrict, validateObjectBody, validateIdempotencyKey, validateUuidPathParam } from "../body.ts";
import { ApplicationError } from "../../contracts/envelope.ts";
import type { TrustedActorContext } from "../../application/shared/runtime.ts";
import { generatePlan, decidePlanConfirmation } from "../../application/plans/plan-service.ts";
import { queryPlanReview } from "../../application/read-models/plan-review.ts";
import type { PlanEngineHandler } from "../../application/plans/plan-service.ts";
import type { RunDispatcher } from "../../application/runs/run-dispatcher.ts";
import { deriveClientVersion } from "../auth/context.ts";

const JSON_MAX_BYTES = 64 * 1024;

function requireJsonContentType(headers: Record<string, string | string[] | undefined>) {
  const ct = headers["content-type"];
  if (typeof ct !== "string" || !ct.toLowerCase().startsWith("application/json")) {
    throw new BodyValidationError("unsupported_media_type", "Content-Type must be application/json.");
  }
}

/**
 * Create plan handlers with injected engine handler.
 * The engine handler is injected at server startup, not per-request.
 * The optional dispatcher is notified after a successful plan approval that creates a queued Run.
 */
export function createPlanHandlers(engineHandler: PlanEngineHandler, dispatcher?: RunDispatcher | null) {
  async function handleGeneratePlan(ctx: RequestContext): Promise<void> {
    requireJsonContentType(ctx.headers);
    const actorContext = ctx.actorContext;
    const projectId = validateUuidPathParam(ctx.pathParams.projectId, "projectId");
    const body = await readRequestBody(ctx.req, JSON_MAX_BYTES);
    const parsed = parseJsonStrict(body);
    const obj = validateObjectBody(parsed, [
      "expectedProjectUpdatedAt", "previousPlanVersionId", "triggeringGateDecisionId",
    ], []);
    const idempotencyKey = validateIdempotencyKey(ctx.headers["idempotency-key"] as string | undefined);
    const clientVersion = deriveClientVersion(ctx.headers);
    const generateBody: Record<string, unknown> = {};
    if (obj.expectedProjectUpdatedAt !== undefined) generateBody.expectedProjectUpdatedAt = obj.expectedProjectUpdatedAt;
    if (obj.previousPlanVersionId !== undefined) generateBody.previousPlanVersionId = obj.previousPlanVersionId;
    if (obj.triggeringGateDecisionId !== undefined) generateBody.triggeringGateDecisionId = obj.triggeringGateDecisionId;
    const result = await generatePlan({
      db: ctx.db, workspaceId: ctx.workspaceId,
      layout: ctx.layout,
      actorContext: { ...actorContext, clientVersion },
      idempotencyKey,
      projectId,
      body: generateBody,
      engineHandler,
    });
    sendCommandResult(ctx.res, ctx.requestId, result, () => (result.kind === "executed" ? result.data : {}));
  }

  async function handleDecidePlanConfirmation(ctx: RequestContext): Promise<void> {
    requireJsonContentType(ctx.headers);
    const actorContext = ctx.actorContext;
    const projectId = validateUuidPathParam(ctx.pathParams.projectId, "projectId");
    const planVersionId = validateUuidPathParam(ctx.pathParams.planVersionId, "planVersionId");
    const body = await readRequestBody(ctx.req, JSON_MAX_BYTES);
    const parsed = parseJsonStrict(body);
    const obj = validateObjectBody(parsed, [
      "planVersionId", "targetSchemaVersion", "targetContentSha256",
      "decision", "comment", "requestedChanges", "rejectionReason",
    ], [
      "targetSchemaVersion", "targetContentSha256",
      "decision", "requestedChanges",
    ]);
    // Path ID is authoritative; if body contains planVersionId, it must match the path.
    if (obj.planVersionId !== undefined && obj.planVersionId !== planVersionId) {
      throw new BodyValidationError("validation_failed", "planVersionId in body does not match path.", {
        fieldErrors: [{ fieldPath: "/planVersionId", code: "mismatch", summary: "planVersionId must match the path parameter" }],
      });
    }
    if (!Array.isArray(obj.requestedChanges)) {
      throw new BodyValidationError("invalid_json", "requestedChanges must be an array.");
    }
    const idempotencyKey = validateIdempotencyKey(ctx.headers["idempotency-key"] as string | undefined);
    const clientVersion = deriveClientVersion(ctx.headers);
    const result = decidePlanConfirmation({
      db: ctx.db, workspaceId: ctx.workspaceId,
      layout: ctx.layout,
      actorContext: { ...actorContext, clientVersion },
      idempotencyKey,
      projectId,
      body: {
        planVersionId,
        targetSchemaVersion: obj.targetSchemaVersion as string,
        targetContentSha256: obj.targetContentSha256 as string,
        decision: obj.decision as "approved" | "changes_requested" | "rejected",
        comment: (obj.comment as string | null) ?? null,
        requestedChanges: obj.requestedChanges as Array<{
          summary: string;
          rationale: string | null;
          affectedFieldPaths: string[];
        }>,
        rejectionReason: (obj.rejectionReason as string | null) ?? null,
      },
    });
    // Wake dispatcher after successful plan approval that creates a queued Run
    if (result.kind === "executed" && result.data.queuedRun && dispatcher) {
      dispatcher.wakeup(ctx.workspaceId);
    }
    sendCommandResult(ctx.res, ctx.requestId, result, () => (result.kind === "executed" ? result.data : {}));
  }

  async function handlePlanReview(ctx: RequestContext): Promise<void> {
    const actorContext = ctx.actorContext;
    const projectId = validateUuidPathParam(ctx.pathParams.projectId, "projectId");
    const planVersionId = validateUuidPathParam(ctx.pathParams.planVersionId, "planVersionId");

    let envelope: ReturnType<typeof queryPlanReview>;
    try {
      envelope = queryPlanReview({
        db: ctx.db, workspaceId: ctx.workspaceId,
        layout: ctx.layout,
        projectId,
        planVersionId,
        actorContext,
        authorizedForContent: true,
      });
    } catch (err) {
      if (err instanceof ApplicationError) throw err;
      throw new ApplicationError("read_model_unavailable", "Plan review read model is not available.");
    }

    const etag = computeCanonicalDataEtag(envelope.data);
    if (matchesEtag(ctx.req, etag)) {
      sendJson(ctx.res, 304, {}, { requestId: ctx.requestId, etag, cacheControl: "private, no-cache" });
      return;
    }
    sendJson(ctx.res, 200, envelope, { requestId: ctx.requestId, etag, cacheControl: "private, no-cache" });
  }

  return { handleGeneratePlan, handleDecidePlanConfirmation, handlePlanReview };
}
