/**
 * Analysis Request submission application service.
 *
 * Contract (API-044):
 * - One immutable AnalysisRequest per project.
 * - rawRequestText trim-non-empty.
 * - contextEvidenceArtifactIds non-empty, ordered, all belong to the same project,
 *   are user-provided input material, and are user_visible.
 * - locale is BCP 47; timezone is IANA.
 * - actor/submittedAt/submittedVia/clientVersion injected from trusted context.
 */
import type { DatabaseSync } from "node:sqlite";
import { claimOn, recordSuccessInTx, recordFailure } from "../idempotency/idempotency-service.ts";
import { computeRequestHash, now, uuid } from "../shared/runtime.ts";
import { ApplicationError } from "../../contracts/envelope.ts";
import type { CommandResult } from "../shared/command.ts";
import type { SubmittedVia } from "../../contracts/registries.ts";
import { requireProject } from "../projects/project-service.ts";
import type { TrustedActorContext } from "../shared/runtime.ts";

export interface SubmitAnalysisRequestBody {
  readonly rawRequestText: string;
  readonly contextEvidenceArtifactIds: readonly string[];
  readonly locale: string;
  readonly timezone: string;
}

export interface SubmitAnalysisRequestInput {
  readonly db: DatabaseSync;
  readonly workspaceId: string;
  readonly actorContext: TrustedActorContext;
  readonly idempotencyKey: string;
  readonly projectId: string;
  readonly body: SubmitAnalysisRequestBody;
  readonly submittedVia: SubmittedVia;
  readonly clientVersion: string | null;
}

export interface SubmitAnalysisRequestResult {
  readonly analysisRequestId: string;
  readonly rawRequestText: string;
  readonly contextEvidenceArtifactIds: readonly string[];
  readonly submittedAt: string;
  readonly locale: string;
  readonly timezone: string;
}

function validateBcp47Locale(value: string): string {
  if (!/^[a-zA-Z]{2,3}(-[a-zA-Z0-9]{2,8})*$/.test(value)) {
    throw new ApplicationError("validation_failed", "locale must be a valid BCP 47 language tag.", {
      fieldErrors: [{ fieldPath: "/locale", code: "format", summary: "locale must be a valid BCP 47 tag" }],
    });
  }
  return value;
}

function validateIanaTimezone(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    throw new ApplicationError("validation_failed", "timezone must be a non-empty IANA timezone identifier.", {
      fieldErrors: [{ fieldPath: "/timezone", code: "required", summary: "timezone must be a non-empty IANA identifier" }],
    });
  }
  try {
    Intl.DateTimeFormat(undefined, { timeZone: trimmed });
  } catch {
    throw new ApplicationError("validation_failed", "timezone is not a valid IANA timezone identifier.", {
      fieldErrors: [{ fieldPath: "/timezone", code: "invalid_timezone", summary: "timezone is not a valid IANA identifier" }],
    });
  }
  return trimmed;
}

export function submitAnalysisRequest(input: SubmitAnalysisRequestInput): CommandResult<SubmitAnalysisRequestResult> {
  const { db, workspaceId, actorContext, idempotencyKey, projectId, body, submittedVia, clientVersion } = input;
  if (actorContext.actorKind !== "human" || !actorContext.active) {
    return { kind: "failed", httpStatus: 403, errorCode: "actor_kind_forbidden", errorSummary: "Only an active human actor may submit an analysis request.", fieldErrors: [], recordId: "" };
  }
  const proj = requireProject(db, workspaceId, projectId);
  if (proj.archivedAt !== null) {
    return { kind: "failed", httpStatus: 409, errorCode: "invalid_state_transition", errorSummary: "Cannot submit an analysis request for an archived project.", fieldErrors: [], recordId: "" };
  }

  const rawRequestText = body.rawRequestText.trim();
  if (rawRequestText.length === 0) {
    return { kind: "failed", httpStatus: 400, errorCode: "validation_failed", errorSummary: "rawRequestText must be non-empty after trim.", fieldErrors: [{ fieldPath: "/rawRequestText", code: "empty", summary: "rawRequestText must be non-empty after trim" }], recordId: "" };
  }
  if (!Array.isArray(body.contextEvidenceArtifactIds) || body.contextEvidenceArtifactIds.length === 0) {
    return { kind: "failed", httpStatus: 400, errorCode: "validation_failed", errorSummary: "contextEvidenceArtifactIds must be a non-empty array.", fieldErrors: [{ fieldPath: "/contextEvidenceArtifactIds", code: "empty", summary: "contextEvidenceArtifactIds must be non-empty" }], recordId: "" };
  }
  for (let i = 0; i < body.contextEvidenceArtifactIds.length; i++) {
    const id = body.contextEvidenceArtifactIds[i];
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(id)) {
      return { kind: "failed", httpStatus: 400, errorCode: "validation_failed", errorSummary: `contextEvidenceArtifactIds[${i}] is not a valid UUID v4.`, fieldErrors: [{ fieldPath: `/contextEvidenceArtifactIds[${i}]`, code: "invalid_uuid", summary: "Evidence ID must be a UUID v4" }], recordId: "" };
    }
  }
  const locale = validateBcp47Locale(body.locale);
  const timezone = validateIanaTimezone(body.timezone);
  const evidenceIds = body.contextEvidenceArtifactIds.slice();

  // Verify all evidence IDs belong to the project and are user-provided input material.
  const placeholders = evidenceIds.map(() => "?").join(",");
  const wsScope = `AND analysis_project_id IN (SELECT analysis_project_id FROM analysis_projects WHERE workspace_id = ?)`;
  const evidenceRows = db.prepare(`SELECT evidence_artifact_id, analysis_project_id, origin_kind, artifact_kind, visibility
    FROM evidence_artifacts WHERE evidence_artifact_id IN (${placeholders}) ${wsScope}`).all(...evidenceIds, workspaceId) as Array<{
      evidence_artifact_id: string;
      analysis_project_id: string;
      origin_kind: string;
      artifact_kind: string;
      visibility: string;
    }>;
  if (evidenceRows.length !== evidenceIds.length) {
    return { kind: "failed", httpStatus: 400, errorCode: "validation_failed", errorSummary: "One or more evidence IDs are unknown or do not belong to the project.", fieldErrors: [{ fieldPath: "/contextEvidenceArtifactIds", code: "invalid_reference", summary: "Evidence reference invalid" }], recordId: "" };
  }
  for (const row of evidenceRows) {
    if (row.analysis_project_id !== projectId) {
      return { kind: "failed", httpStatus: 400, errorCode: "validation_failed", errorSummary: "Evidence does not belong to the project.", fieldErrors: [{ fieldPath: "/contextEvidenceArtifactIds", code: "invalid_reference", summary: "Evidence does not belong to the project" }], recordId: "" };
    }
    if (row.origin_kind !== "user_provided" || row.artifact_kind !== "input_material" || row.visibility !== "user_visible") {
      return { kind: "failed", httpStatus: 422, errorCode: "unsafe_evidence", errorSummary: "Evidence is not admissible as analysis input.", fieldErrors: [{ fieldPath: "/contextEvidenceArtifactIds", code: "inadmissible", summary: "Evidence is not admissible as analysis input" }], recordId: "" };
    }
  }
  // Ensure uniqueness and ordering (body order is preserved, but duplicates are rejected).
  const seen = new Set<string>();
  for (const id of evidenceIds) {
    if (seen.has(id)) {
      return { kind: "failed", httpStatus: 400, errorCode: "validation_failed", errorSummary: "Duplicate evidence ID in contextEvidenceArtifactIds.", fieldErrors: [{ fieldPath: "/contextEvidenceArtifactIds", code: "duplicate", summary: "Duplicate evidence ID" }], recordId: "" };
    }
    seen.add(id);
  }

  const requestHash = computeRequestHash("POST", `/api/v1/projects/${projectId}/analysis-request:submit`, body);
  const claim = claimOn(db, { actorId: actorContext.actorId, commandType: "request.submit", idempotencyKey, requestHash });
  if (claim.kind === "in_progress") return { kind: "in_progress", recordId: claim.recordId };
  if (claim.kind === "conflict") return { kind: "conflict", recordId: claim.recordId };
  if (claim.kind === "replay_success") return { kind: "replayed_success", httpStatus: claim.record.responseHttpStatus!, resultResourceType: "Request", resultResourceId: claim.record.resultResourceId!, recordId: claim.record.idempotencyRecordId };
  if (claim.kind === "replay_failed") return { kind: "failed", httpStatus: claim.record.responseHttpStatus!, errorCode: claim.record.errorCode!, errorSummary: claim.record.errorSummary!, fieldErrors: [], recordId: claim.record.idempotencyRecordId };

  // Verify there is no existing request for this project (one per project, immutable).
  const existing = db.prepare(`SELECT analysis_request_id FROM analysis_requests WHERE analysis_project_id = ? AND analysis_project_id IN (SELECT analysis_project_id FROM analysis_projects WHERE workspace_id = ?)`).get(projectId, workspaceId) as
    | { analysis_request_id: string }
    | undefined;
  if (existing) {
    const err = new ApplicationError("invalid_state_transition", "An analysis request has already been submitted for this project.");
    recordFailure(db, claim.recordId, { httpStatus: err.httpStatus, errorCode: err.code, errorSummary: err.message });
    return { kind: "failed", httpStatus: err.httpStatus, errorCode: err.code, errorSummary: err.message, fieldErrors: [], recordId: claim.recordId };
  }

  const requestId = uuid();
  const ts = now();
  db.exec("BEGIN");
  try {
    db.prepare(`INSERT INTO analysis_requests (
      analysis_request_id, analysis_project_id, raw_request_text, submitted_context_evidence_ids_json,
      submitted_at, submitted_by_actor_id, submitted_via, client_version, locale, timezone
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      requestId, projectId, rawRequestText, JSON.stringify(evidenceIds), ts, actorContext.actorId, submittedVia, clientVersion, locale, timezone,
    );
    recordSuccessInTx(db, claim.recordId, { httpStatus: 201, resultResourceType: "Request", resultResourceId: requestId });
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    // Stable safe summary: SQLite errors may expose SQL/schema/internal details.
    recordFailure(db, claim.recordId, { httpStatus: 503, errorCode: "storage_unavailable", errorSummary: "Analysis request could not be recorded." });
    return { kind: "failed", httpStatus: 503, errorCode: "storage_unavailable", errorSummary: "Analysis request could not be recorded.", fieldErrors: [], recordId: claim.recordId };
  }

  return {
    kind: "executed",
    httpStatus: 201,
    resultResourceType: "Request",
    resultResourceId: requestId,
    recordId: claim.recordId,
    data: {
      analysisRequestId: requestId,
      rawRequestText,
      contextEvidenceArtifactIds: evidenceIds,
      submittedAt: ts,
      locale,
      timezone,
    },
  };
}
