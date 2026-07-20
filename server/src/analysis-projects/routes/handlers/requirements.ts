/**
 * Requirement HTTP handlers.
 *
 * - POST /api/v1/projects/{projectId}/requirements:generate
 * - POST /api/v1/projects/{projectId}/requirements/{requirementVersionId}:decide-confirmation
 * - GET /api/v1/projects/{projectId}/requirements/{requirementVersionId}
 */
import type { RequestContext } from "../router.ts";
import { sendJson, sendCommandResult, computeCanonicalDataEtag, matchesEtag } from "../envelope.ts";
import { BodyValidationError, readRequestBody, parseJsonStrict, validateObjectBody, validateIdempotencyKey, validateUuidPathParam } from "../body.ts";
import { ApplicationError } from "../../contracts/envelope.ts";
import type { TrustedActorContext } from "../../application/shared/runtime.ts";
import { generateRequirement, decideRequirementConfirmation } from "../../application/requirements/requirement-service.ts";
import { queryRequirementReview } from "../../application/read-models/requirement-review.ts";
import type { RequirementEngineHandler } from "../../application/requirements/requirement-service.ts";
import { deriveClientVersion } from "../auth/context.ts";

const JSON_MAX_BYTES = 64 * 1024;

function requireJsonContentType(headers: Record<string, string | string[] | undefined>) {
  const ct = headers["content-type"];
  if (typeof ct !== "string" || !ct.toLowerCase().startsWith("application/json")) {
    throw new BodyValidationError("unsupported_media_type", "Content-Type must be application/json.");
  }
}

/**
 * Create requirement handlers with injected engine handler.
 * The engine handler is injected at server startup, not per-request.
 */
export function createRequirementHandlers(engineHandler: RequirementEngineHandler) {
  async function handleGenerateRequirement(ctx: RequestContext): Promise<void> {
    requireJsonContentType(ctx.headers);
    const actorContext = ctx.actorContext;
    const projectId = validateUuidPathParam(ctx.pathParams.projectId, "projectId");
    const body = await readRequestBody(ctx.req, JSON_MAX_BYTES);
    const parsed = parseJsonStrict(body);
    const obj = validateObjectBody(parsed, [
      "expectedProjectUpdatedAt", "previousRequirementVersionId", "triggeringGateDecisionId",
    ], []);
    const idempotencyKey = validateIdempotencyKey(ctx.headers["idempotency-key"] as string | undefined);
    const clientVersion = deriveClientVersion(ctx.headers);
    const generateBody: Record<string, unknown> = {};
    if (obj.expectedProjectUpdatedAt !== undefined) generateBody.expectedProjectUpdatedAt = obj.expectedProjectUpdatedAt;
    if (obj.previousRequirementVersionId !== undefined) generateBody.previousRequirementVersionId = obj.previousRequirementVersionId;
    if (obj.triggeringGateDecisionId !== undefined) generateBody.triggeringGateDecisionId = obj.triggeringGateDecisionId;
    const result = await generateRequirement({
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

  async function handleDecideRequirementConfirmation(ctx: RequestContext): Promise<void> {
    requireJsonContentType(ctx.headers);
    const actorContext = ctx.actorContext;
    const projectId = validateUuidPathParam(ctx.pathParams.projectId, "projectId");
    const requirementVersionId = validateUuidPathParam(ctx.pathParams.requirementVersionId, "requirementVersionId");
    const body = await readRequestBody(ctx.req, JSON_MAX_BYTES);
    const parsed = parseJsonStrict(body);
    const obj = validateObjectBody(parsed, [
      "targetSchemaVersion", "targetContentSha256",
      "decision", "comment", "requestedChanges", "rejectionReason",
    ], [
      "targetSchemaVersion", "targetContentSha256",
      "decision", "requestedChanges",
    ]);
    if (!Array.isArray(obj.requestedChanges)) {
      throw new BodyValidationError("invalid_json", "requestedChanges must be an array.");
    }
    const idempotencyKey = validateIdempotencyKey(ctx.headers["idempotency-key"] as string | undefined);
    const clientVersion = deriveClientVersion(ctx.headers);
    const result = decideRequirementConfirmation({
      db: ctx.db, workspaceId: ctx.workspaceId,
      actorContext: { ...actorContext, clientVersion },
      idempotencyKey,
      projectId,
      body: {
        requirementVersionId,
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
    sendCommandResult(ctx.res, ctx.requestId, result, () => (result.kind === "executed" ? result.data : {}));
  }

  async function handleRequirementReview(ctx: RequestContext): Promise<void> {
    const actorContext = ctx.actorContext;
    const projectId = validateUuidPathParam(ctx.pathParams.projectId, "projectId");
    const requirementVersionId = validateUuidPathParam(ctx.pathParams.requirementVersionId, "requirementVersionId");

    let envelope: ReturnType<typeof queryRequirementReview>;
    try {
      envelope = queryRequirementReview({
        db: ctx.db, workspaceId: ctx.workspaceId,
        layout: ctx.layout,
        projectId,
        requirementVersionId,
        actorContext,
        authorizedForContent: true,
      });
    } catch (err) {
      if (err instanceof ApplicationError) throw err;
      throw new ApplicationError("read_model_unavailable", "Requirement review read model is not available.");
    }

    const etag = computeCanonicalDataEtag(envelope.data);
    if (matchesEtag(ctx.req, etag)) {
      sendJson(ctx.res, 304, {}, { requestId: ctx.requestId, etag, cacheControl: "private, no-cache" });
      return;
    }
    sendJson(ctx.res, 200, envelope, { requestId: ctx.requestId, etag, cacheControl: "private, no-cache" });
  }

  return { handleGenerateRequirement, handleDecideRequirementConfirmation, handleRequirementReview };
}
