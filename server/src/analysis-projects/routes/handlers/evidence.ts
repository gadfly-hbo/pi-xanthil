/**
 * Evidence upload and content handlers.
 */
import type { RequestContext } from "../router.ts";
import { sendJson, sendCommandResult } from "../envelope.ts";
import { BodyValidationError, validateIdempotencyKey, validateUuidPathParam } from "../body.ts";
import { ApplicationError } from "../../contracts/envelope.ts";
import type { TrustedActorContext } from "../../application/shared/runtime.ts";
import { uploadUserEvidence, type EvidenceUploadMetadata } from "../../application/evidence/evidence-service.ts";
import { readEvidenceContent } from "../../application/evidence/evidence-content-service.ts";
import { parseContentTypeBoundary, parseMultipartStream, MultipartError } from "../multipart.ts";
import { parseJsonStrict, validateObjectBody } from "../body.ts";
import { deriveClientVersion } from "../auth/context.ts";
import { unlinkSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const MULTIPART_MAX_BYTES = 11 * 1024 * 1024; // 11 MiB (slightly above upload max for header overhead)

export async function handleUploadEvidence(ctx: RequestContext): Promise<void> {
  const actorContext = ctx.actorContext;
  const projectId = validateUuidPathParam(ctx.pathParams.projectId, "projectId");
  const idempotencyKey = validateIdempotencyKey(ctx.headers["idempotency-key"] as string | undefined);
  const contentType = ctx.headers["content-type"];
  if (typeof contentType !== "string" || !contentType.toLowerCase().startsWith("multipart/form-data")) {
    throw new BodyValidationError("unsupported_media_type", "Evidence upload requires multipart/form-data.");
  }
  const boundary = parseContentTypeBoundary(contentType);
  const tmpDir = join(ctx.layout.tmpDir, "uploads");
  mkdirSync(tmpDir, { recursive: true });
  let parsed: Awaited<ReturnType<typeof parseMultipartStream>> | undefined;
  try {
    parsed = await parseMultipartStream(ctx.req, boundary, { maxBytes: MULTIPART_MAX_BYTES, tmpDir });
    const metadataParsed = parseJsonStrict(parsed.metadataBytes);
    const metadataObj = validateObjectBody(metadataParsed, [
      "displayName", "description", "declaredDataScope", "usageConstraints",
      "safetyHandlingPolicy", "safetyClass", "declaredMediaType", "declaredByteSize",
    ], ["displayName", "declaredDataScope", "usageConstraints", "safetyHandlingPolicy", "safetyClass", "declaredMediaType", "declaredByteSize"]);
    const metadata: EvidenceUploadMetadata = {
      displayName: metadataObj.displayName as string,
      description: typeof metadataObj.description === "string" ? metadataObj.description : "",
      declaredDataScope: metadataObj.declaredDataScope as string,
      usageConstraints: Array.isArray(metadataObj.usageConstraints) ? (metadataObj.usageConstraints as string[]) : [],
      safetyHandlingPolicy: metadataObj.safetyHandlingPolicy as EvidenceUploadMetadata["safetyHandlingPolicy"],
      safetyClass: metadataObj.safetyClass as EvidenceUploadMetadata["safetyClass"],
      declaredMediaType: metadataObj.declaredMediaType as string,
      declaredByteSize: metadataObj.declaredByteSize as number,
    };
    const clientVersion = deriveClientVersion(ctx.headers);
    const result = await uploadUserEvidence({
      db: ctx.db, workspaceId: ctx.workspaceId,
      layout: ctx.layout,
      actorContext: { ...actorContext, clientVersion },
      idempotencyKey,
      projectId,
      metadata,
      contentTmpPath: parsed.content.tmpPath,
      contentSha256: parsed.content.sha256,
      contentByteSize: parsed.content.byteSize,
      contentMediaType: parsed.content.contentType,
      submittedVia: actorContext.submittedVia,
      clientVersion,
    });
    sendCommandResult(ctx.res, ctx.requestId, result, () => (result.kind === "executed" ? result.data : {}));
  } catch (err) {
    if (err instanceof BodyValidationError) throw err;
    if (err instanceof MultipartError) throw err;
    if (err instanceof ApplicationError) throw err;
    // Stable safe summary: never expose raw filesystem/parser internals.
    throw new ApplicationError("unsupported_media_type", "Multipart parsing failed.");
  } finally {
    if (parsed?.content.tmpPath) {
      try { unlinkSync(parsed.content.tmpPath); } catch {}
    }
  }
}

export async function handleEvidenceContent(ctx: RequestContext): Promise<void> {
  const actorContext = ctx.actorContext;
  const projectId = validateUuidPathParam(ctx.pathParams.projectId, "projectId");
  const evidenceArtifactId = validateUuidPathParam(ctx.pathParams.evidenceArtifactId, "evidenceArtifactId");
  if (ctx.headers.range) {
    throw new ApplicationError("validation_failed", "Range requests are not supported for evidence content.");
  }
  const content = readEvidenceContent(ctx.db, ctx.layout, ctx.workspaceId, projectId, evidenceArtifactId, actorContext);
  const headers: Record<string, string> = {
    "Content-Type": content.mediaType,
    "X-Content-Sha256": content.contentSha256,
    "Cache-Control": "private, no-store",
  };
  if (content.inlineDisposition) {
    headers["Content-Disposition"] = `inline; filename="${content.filename}"`;
  } else {
    headers["Content-Disposition"] = `attachment; filename="${content.filename}"`;
  }
  ctx.res.writeHead(200, headers);
  ctx.res.end(Buffer.from(content.body));
}
