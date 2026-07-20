/**
 * Report HTTP handlers.
 *
 * - GET  /api/v1/projects/{projectId}/reports/{reportVersionId}
 * - POST /api/v1/projects/{projectId}/reports/{reportVersionId}:decide-review
 * - GET  /api/v1/projects/{projectId}/locked-report
 *
 * Contract (§5.1, §5.3, §6.4, §7.6, §7.7):
 * - Path reportVersionId is authoritative; not duplicated in body.
 * - Body strictly rejects unknown fields.
 * - Idempotency key required for POST; GET has no side effects.
 * - Safe error envelope; no storageRef/path/token/prompt/raw pi leak.
 */
import type { RequestContext } from "../router.ts";
import { sendJson, sendCommandResult, computeCanonicalDataEtag, matchesEtag } from "../envelope.ts";
import { BodyValidationError, readRequestBody, parseJsonStrict, validateObjectBody, validateIdempotencyKey, validateUuidPathParam } from "../body.ts";
import { ApplicationError } from "../../contracts/envelope.ts";
import type { TrustedActorContext } from "../../application/shared/runtime.ts";
import { decideReview, type DecideReviewBody, type ReportDecision, type RevisionScope, type ReportRequestedChange } from "../../application/reports/report-service.ts";
import { queryReportReview } from "../../application/read-models/report-review.ts";
import { queryLockedReport } from "../../application/read-models/locked-report.ts";
import { deriveClientVersion } from "../auth/context.ts";

const JSON_MAX_BYTES = 64 * 1024;

function requireJsonContentType(headers: Record<string, string | string[] | undefined>) {
  const ct = headers["content-type"];
  if (typeof ct !== "string" || !ct.toLowerCase().startsWith("application/json")) {
    throw new BodyValidationError("unsupported_media_type", "Content-Type must be application/json.");
  }
}

/**
 * Create report handlers. No injection needed (service functions are standalone,
 * using ctx.db and ctx.layout per request).
 */
export function createReportHandlers() {
  async function handleReportReview(ctx: RequestContext): Promise<void> {
    const actorContext = ctx.actorContext;
    const projectId = validateUuidPathParam(ctx.pathParams.projectId, "projectId");
    const reportVersionId = validateUuidPathParam(ctx.pathParams.reportVersionId, "reportVersionId");

    let envelope: ReturnType<typeof queryReportReview>;
    try {
      envelope = queryReportReview({
        db: ctx.db, workspaceId: ctx.workspaceId,
        layout: ctx.layout,
        projectId,
        reportVersionId,
        actorContext: { ...actorContext, clientVersion: deriveClientVersion(ctx.headers) },
        authorizedForContent: true,
      });
    } catch (err) {
      if (err instanceof ApplicationError) throw err;
      throw new ApplicationError("read_model_unavailable", "Report review read model is not available.");
    }

    const etag = computeCanonicalDataEtag(envelope.data);
    if (matchesEtag(ctx.req, etag)) {
      sendJson(ctx.res, 304, {}, { requestId: ctx.requestId, etag, cacheControl: "private, no-cache" });
      return;
    }
    sendJson(ctx.res, 200, envelope, { requestId: ctx.requestId, etag, cacheControl: "private, no-cache" });
  }

  async function handleDecideReview(ctx: RequestContext): Promise<void> {
    requireJsonContentType(ctx.headers);
    const actorContext = ctx.actorContext;
    const projectId = validateUuidPathParam(ctx.pathParams.projectId, "projectId");
    const reportVersionId = validateUuidPathParam(ctx.pathParams.reportVersionId, "reportVersionId");
    const body = await readRequestBody(ctx.req, JSON_MAX_BYTES);
    const parsed = parseJsonStrict(body);
    // Body fields: targetSchemaVersion, targetContentSha256, decision, comment,
    // requestedChanges, rejectionReason, revisionScope. Path reportVersionId is
    // authoritative and must NOT appear in body.
    const obj = validateObjectBody(
      parsed,
      ["targetSchemaVersion", "targetContentSha256", "decision", "comment", "requestedChanges", "rejectionReason", "revisionScope"],
      ["targetSchemaVersion", "targetContentSha256", "decision", "requestedChanges"],
    );
    const idempotencyKey = validateIdempotencyKey(ctx.headers["idempotency-key"] as string | undefined);
    const clientVersion = deriveClientVersion(ctx.headers);

    // Validate decision enum
    const decision = obj.decision as string;
    if (decision !== "approved" && decision !== "changes_requested" && decision !== "rejected") {
      throw new BodyValidationError("validation_failed", "decision must be approved, changes_requested, or rejected.", {
        fieldErrors: [{ fieldPath: "/decision", code: "invalid_enum", summary: "Must be approved, changes_requested, or rejected" }],
      });
    }

    // Validate revisionScope enum (if present)
    let revisionScope: RevisionScope | null = null;
    if (obj.revisionScope !== undefined && obj.revisionScope !== null) {
      const rs = obj.revisionScope as string;
      if (rs !== "report_revision" && rs !== "plan_revision" && rs !== "requirement_revision") {
        throw new BodyValidationError("validation_failed", "revisionScope must be report_revision, plan_revision, or requirement_revision.", {
          fieldErrors: [{ fieldPath: "/revisionScope", code: "invalid_enum", summary: "Must be report_revision, plan_revision, or requirement_revision" }],
        });
      }
      revisionScope = rs as RevisionScope;
    }

    // Validate requestedChanges array
    if (!Array.isArray(obj.requestedChanges)) {
      throw new BodyValidationError("validation_failed", "requestedChanges must be an array.", {
        fieldErrors: [{ fieldPath: "/requestedChanges", code: "type", summary: "requestedChanges must be an array" }],
      });
    }
    const requestedChanges: ReportRequestedChange[] = [];
    for (let i = 0; i < obj.requestedChanges.length; i++) {
      const rc = obj.requestedChanges[i] as Record<string, unknown>;
      if (rc === null || typeof rc !== "object" || Array.isArray(rc)) {
        throw new BodyValidationError("validation_failed", `requestedChanges[${i}] must be an object.`, {
          fieldErrors: [{ fieldPath: `/requestedChanges/${i}`, code: "type", summary: "Must be an object" }],
        });
      }
      // Validate allowed fields in each requested change
      for (const key of Object.keys(rc)) {
        if (key !== "summary" && key !== "rationale" && key !== "affectedFieldPaths") {
          throw new BodyValidationError("validation_failed", `requestedChanges[${i}] contains unknown field: ${key}.`, {
            fieldErrors: [{ fieldPath: `/requestedChanges/${i}/${key}`, code: "unknown_field", summary: `Unknown field: ${key}` }],
          });
        }
      }
      if (typeof rc.summary !== "string" || (rc.summary as string).trim().length === 0) {
        throw new BodyValidationError("validation_failed", `requestedChanges[${i}].summary must be non-empty.`, {
          fieldErrors: [{ fieldPath: `/requestedChanges/${i}/summary`, code: "empty", summary: "summary must be non-empty" }],
        });
      }
      if (!Array.isArray(rc.affectedFieldPaths) || rc.affectedFieldPaths.length === 0) {
        throw new BodyValidationError("validation_failed", `requestedChanges[${i}].affectedFieldPaths must be non-empty.`, {
          fieldErrors: [{ fieldPath: `/requestedChanges/${i}/affectedFieldPaths`, code: "empty", summary: "affectedFieldPaths must be non-empty" }],
        });
      }
      for (let j = 0; j < rc.affectedFieldPaths.length; j++) {
        if (typeof rc.affectedFieldPaths[j] !== "string" || !(rc.affectedFieldPaths[j] as string).startsWith("/")) {
          throw new BodyValidationError("validation_failed", `requestedChanges[${i}].affectedFieldPaths[${j}] must be a valid RFC 6901 JSON Pointer.`, {
            fieldErrors: [{ fieldPath: `/requestedChanges/${i}/affectedFieldPaths/${j}`, code: "invalid_pointer", summary: "Must be a valid JSON Pointer starting with /" }],
          });
        }
      }
      requestedChanges.push({
        summary: rc.summary as string,
        rationale: typeof rc.rationale === "string" ? rc.rationale : null,
        affectedFieldPaths: rc.affectedFieldPaths as string[],
      });
    }

    const decideBody: DecideReviewBody = {
      targetSchemaVersion: obj.targetSchemaVersion as string,
      targetContentSha256: obj.targetContentSha256 as string,
      decision: decision as ReportDecision,
      comment: typeof obj.comment === "string" ? obj.comment : null,
      requestedChanges,
      rejectionReason: typeof obj.rejectionReason === "string" ? obj.rejectionReason : null,
      revisionScope,
    };

    const result = decideReview({
      db: ctx.db, workspaceId: ctx.workspaceId,
      layout: ctx.layout,
      actorContext: { ...actorContext, clientVersion },
      idempotencyKey,
      projectId,
      reportVersionId,
      body: decideBody,
    });
    sendCommandResult(ctx.res, ctx.requestId, result, () => (result.kind === "executed" ? result.data : {}));
  }

  async function handleLockedReport(ctx: RequestContext): Promise<void> {
    const actorContext = ctx.actorContext;
    const projectId = validateUuidPathParam(ctx.pathParams.projectId, "projectId");

    let envelope: ReturnType<typeof queryLockedReport>;
    try {
      envelope = queryLockedReport({
        db: ctx.db, workspaceId: ctx.workspaceId,
        layout: ctx.layout,
        projectId,
        actorContext: { actorKind: actorContext.actorKind, active: actorContext.active },
        authorizedForContent: true,
      });
    } catch (err) {
      if (err instanceof ApplicationError) throw err;
      throw new ApplicationError("read_model_unavailable", "Locked report read model is not available.");
    }

    const etag = computeCanonicalDataEtag(envelope.data);
    if (matchesEtag(ctx.req, etag)) {
      sendJson(ctx.res, 304, {}, { requestId: ctx.requestId, etag, cacheControl: "private, no-cache" });
      return;
    }
    sendJson(ctx.res, 200, envelope, { requestId: ctx.requestId, etag, cacheControl: "private, no-cache" });
  }

  return { handleReportReview, handleDecideReview, handleLockedReport };
}
