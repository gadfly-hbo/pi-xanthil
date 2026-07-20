/**
 * Analysis Request submit handler.
 */
import type { RequestContext } from "../router.ts";
import { sendCommandResult } from "../envelope.ts";
import { BodyValidationError, readRequestBody, parseJsonStrict, validateObjectBody, validateIdempotencyKey, validateUuidPathParam } from "../body.ts";
import { ApplicationError } from "../../contracts/envelope.ts";
import type { TrustedActorContext } from "../../application/shared/runtime.ts";
import { submitAnalysisRequest } from "../../application/requests/request-service.ts";
import { deriveClientVersion } from "../auth/context.ts";

const JSON_MAX_BYTES = 64 * 1024;

export async function handleSubmitAnalysisRequest(ctx: RequestContext): Promise<void> {
  const ct = ctx.headers["content-type"];
  if (typeof ct !== "string" || !ct.toLowerCase().startsWith("application/json")) {
    throw new BodyValidationError("unsupported_media_type", "Content-Type must be application/json.");
  }
  const actorContext = ctx.actorContext;
  const projectId = validateUuidPathParam(ctx.pathParams.projectId, "projectId");
  const body = await readRequestBody(ctx.req, JSON_MAX_BYTES);
  const parsed = parseJsonStrict(body);
  const obj = validateObjectBody(parsed, [
    "rawRequestText", "contextEvidenceArtifactIds", "locale", "timezone",
  ], ["rawRequestText", "contextEvidenceArtifactIds", "locale", "timezone"]);
  if (!Array.isArray(obj.contextEvidenceArtifactIds) || obj.contextEvidenceArtifactIds.some((id) => typeof id !== "string")) {
    throw new BodyValidationError("invalid_json", "contextEvidenceArtifactIds must be an array of strings.");
  }
  const idempotencyKey = validateIdempotencyKey(ctx.headers["idempotency-key"] as string | undefined);
  const clientVersion = deriveClientVersion(ctx.headers);
  const result = submitAnalysisRequest({
    db: ctx.db, workspaceId: ctx.workspaceId,
    actorContext: { ...actorContext, clientVersion },
    idempotencyKey,
    projectId,
    body: {
      rawRequestText: obj.rawRequestText as string,
      contextEvidenceArtifactIds: obj.contextEvidenceArtifactIds as string[],
      locale: obj.locale as string,
      timezone: obj.timezone as string,
    },
    submittedVia: actorContext.submittedVia,
    clientVersion,
  });
  sendCommandResult(ctx.res, ctx.requestId, result, () => (result.kind === "executed" ? result.data : {}));
}
