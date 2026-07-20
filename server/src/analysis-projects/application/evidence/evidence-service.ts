/**
 * User-provided Evidence upload application service.
 *
 * Contract (API-012, API-044):
 * - Multipart: one typed JSON metadata part + one binary stream.
 * - Fixed originKind=user_provided, artifactKind=input_material, visibility=user_visible.
 * - restricted_raw only accepts local_transform_required.
 * - Stream to controlled tmp, compute actual SHA-256/byte size.
 * - Atomically publish content-addressed blob, then create SourceReference +
 *   EvidenceArtifact in a single transaction with deferred circular FK.
 */
import type { DatabaseSync } from "node:sqlite";
import { claimOn, recordSuccessInTx, recordFailure } from "../idempotency/idempotency-service.ts";
import { computeMultipartRequestHash, now, uuid } from "../shared/runtime.ts";
import { ApplicationError } from "../../contracts/envelope.ts";
import type { CommandResult } from "../shared/command.ts";
import type { SubmittedVia } from "../../contracts/registries.ts";
import { linkBlobFromFile, type WriteBlobResult } from "../../persistence/blob-writer.ts";
import { sha256HexBytes } from "../../persistence/sha256.ts";
import type { DataRootLayout } from "../../persistence/data-root.ts";
import { requireProject } from "../projects/project-service.ts";
import type { TrustedActorContext } from "../shared/runtime.ts";

export const UPLOAD_MAX_BYTES = 10 * 1024 * 1024; // 10 MiB

export type SafetyClass = "restricted_raw" | "controlled" | "derived";
export type SafetyHandlingPolicy = "local_transform_required" | "controlled_or_derived_allowed" | "derived_only_allowed";

export interface EvidenceUploadMetadata {
  readonly displayName: string;
  readonly description?: string;
  readonly declaredDataScope: string;
  readonly usageConstraints: readonly string[];
  readonly safetyHandlingPolicy: SafetyHandlingPolicy;
  readonly safetyClass: SafetyClass;
  readonly declaredMediaType: string;
  readonly declaredByteSize: number;
}

export interface EvidenceUploadInput {
  readonly db: DatabaseSync;
  readonly layout: DataRootLayout;
  readonly workspaceId: string;
  readonly actorContext: TrustedActorContext;
  readonly idempotencyKey: string;
  readonly projectId: string;
  readonly metadata: EvidenceUploadMetadata;
  readonly contentTmpPath: string;
  readonly contentSha256: string;
  readonly contentByteSize: number;
  readonly contentMediaType: string;
  readonly submittedVia: SubmittedVia;
  readonly clientVersion: string | null;
}

export interface EvidenceUploadResult {
  readonly evidenceArtifactId: string;
  readonly sourceReferenceId: string;
  readonly displayName: string;
  readonly contentSha256: string;
  readonly byteSize: number;
  readonly mediaType: string;
  readonly createdAt: string;
}

export const ALLOWED_USER_MEDIA_TYPES = new Set([
  "text/csv",
  "text/plain",
  "text/markdown",
  "application/json",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-excel",
  "application/parquet",
  "application/octet-stream",
]);

function validateMetadata(m: EvidenceUploadMetadata): void {
  if (typeof m.displayName !== "string" || m.displayName.trim().length === 0) {
    throw new ApplicationError("validation_failed", "displayName must be a non-empty string.", {
      fieldErrors: [{ fieldPath: "/displayName", code: "empty", summary: "displayName must be non-empty" }],
    });
  }
  if (typeof m.declaredDataScope !== "string" || m.declaredDataScope.trim().length === 0) {
    throw new ApplicationError("validation_failed", "declaredDataScope must be a non-empty string.", {
      fieldErrors: [{ fieldPath: "/declaredDataScope", code: "empty", summary: "declaredDataScope must be non-empty" }],
    });
  }
  if (!Array.isArray(m.usageConstraints)) {
    throw new ApplicationError("validation_failed", "usageConstraints must be an array.", {
      fieldErrors: [{ fieldPath: "/usageConstraints", code: "type", summary: "usageConstraints must be an array" }],
    });
  }
  for (let i = 0; i < m.usageConstraints.length; i++) {
    if (typeof m.usageConstraints[i] !== "string") {
      throw new ApplicationError("validation_failed", "usageConstraints must be strings.", {
        fieldErrors: [{ fieldPath: `/usageConstraints[${i}]`, code: "type", summary: "usageConstraints element must be a string" }],
      });
    }
  }
  const validPolicies: SafetyHandlingPolicy[] = ["local_transform_required", "controlled_or_derived_allowed", "derived_only_allowed"];
  if (!validPolicies.includes(m.safetyHandlingPolicy)) {
    throw new ApplicationError("validation_failed", "safetyHandlingPolicy is not a recognized value.", {
      fieldErrors: [{ fieldPath: "/safetyHandlingPolicy", code: "invalid_enum", summary: "safetyHandlingPolicy must be a recognized value" }],
    });
  }
  const validClasses: SafetyClass[] = ["restricted_raw", "controlled", "derived"];
  if (!validClasses.includes(m.safetyClass)) {
    throw new ApplicationError("validation_failed", "safetyClass is not a recognized value.", {
      fieldErrors: [{ fieldPath: "/safetyClass", code: "invalid_enum", summary: "safetyClass must be a recognized value" }],
    });
  }
  if (m.safetyClass === "restricted_raw" && m.safetyHandlingPolicy !== "local_transform_required") {
    throw new ApplicationError("validation_failed", "restricted_raw requires local_transform_required policy.", {
      fieldErrors: [{ fieldPath: "/safetyClass", code: "policy_mismatch", summary: "restricted_raw requires local_transform_required policy" }],
    });
  }
  if (m.safetyClass === "controlled" && m.safetyHandlingPolicy === "derived_only_allowed") {
    throw new ApplicationError("validation_failed", "controlled safetyClass is weaker than derived_only_allowed policy.", {
      fieldErrors: [{ fieldPath: "/safetyClass", code: "policy_mismatch", summary: "controlled is weaker than derived_only_allowed policy" }],
    });
  }
  if (typeof m.declaredMediaType !== "string" || !/^[a-zA-Z][a-zA-Z0-9!#$&\^_+.-]*\/[a-zA-Z][a-zA-Z0-9!#$&\^_+.-]*$/.test(m.declaredMediaType)) {
    throw new ApplicationError("validation_failed", "declaredMediaType must be a valid MIME type.", {
      fieldErrors: [{ fieldPath: "/declaredMediaType", code: "format", summary: "declaredMediaType must be a valid MIME type" }],
    });
  }
  if (!ALLOWED_USER_MEDIA_TYPES.has(m.declaredMediaType)) {
    throw new ApplicationError("unsupported_media_type", "declaredMediaType is not an allowed user upload media type.");
  }
  if (typeof m.declaredByteSize !== "number" || !Number.isInteger(m.declaredByteSize) || m.declaredByteSize < 0 || m.declaredByteSize > UPLOAD_MAX_BYTES) {
    throw new ApplicationError("validation_failed", `declaredByteSize must be an integer between 0 and ${UPLOAD_MAX_BYTES}.`, {
      fieldErrors: [{ fieldPath: "/declaredByteSize", code: "range", summary: `declaredByteSize must be between 0 and ${UPLOAD_MAX_BYTES}` }],
    });
  }
}

export async function uploadUserEvidence(input: EvidenceUploadInput): Promise<CommandResult<EvidenceUploadResult>> {
  const { db, layout, workspaceId, actorContext, idempotencyKey, projectId, metadata, contentTmpPath, contentSha256, contentByteSize, contentMediaType, submittedVia, clientVersion } = input;
  if (actorContext.actorKind !== "human" || !actorContext.active) {
    return { kind: "failed", httpStatus: 403, errorCode: "actor_kind_forbidden", errorSummary: "Only an active human actor may upload evidence.", fieldErrors: [], recordId: "" };
  }
  const proj = requireProject(db, workspaceId, projectId);
  if (proj.archivedAt !== null) {
    return { kind: "failed", httpStatus: 409, errorCode: "invalid_state_transition", errorSummary: "Cannot upload evidence to an archived project.", fieldErrors: [], recordId: "" };
  }
  if (contentByteSize > UPLOAD_MAX_BYTES) {
    return { kind: "failed", httpStatus: 413, errorCode: "payload_too_large", errorSummary: `Evidence content exceeds ${UPLOAD_MAX_BYTES} bytes.`, fieldErrors: [], recordId: "" };
  }
  validateMetadata(metadata);
  if (contentMediaType.toLowerCase() !== metadata.declaredMediaType.toLowerCase()) {
    return { kind: "failed", httpStatus: 422, errorCode: "evidence_integrity_failed", errorSummary: "Content media type does not match declared media type.", fieldErrors: [], recordId: "" };
  }
  if (contentByteSize !== metadata.declaredByteSize) {
    return { kind: "failed", httpStatus: 422, errorCode: "evidence_integrity_failed", errorSummary: "Content byte size does not match declared byte size.", fieldErrors: [], recordId: "" };
  }

  const requestHash = computeMultipartRequestHash(metadata as unknown as Record<string, unknown>, contentSha256);

  const claim = claimOn(db, { actorId: actorContext.actorId, commandType: "evidence.upload_user", idempotencyKey, requestHash });
  if (claim.kind === "in_progress") return { kind: "in_progress", recordId: claim.recordId };
  if (claim.kind === "conflict") return { kind: "conflict", recordId: claim.recordId };
  if (claim.kind === "replay_success") return { kind: "replayed_success", httpStatus: claim.record.responseHttpStatus!, resultResourceType: "Evidence", resultResourceId: claim.record.resultResourceId!, recordId: claim.record.idempotencyRecordId };
  if (claim.kind === "replay_failed") return { kind: "failed", httpStatus: claim.record.responseHttpStatus!, errorCode: claim.record.errorCode!, errorSummary: claim.record.errorSummary!, fieldErrors: [], recordId: claim.record.idempotencyRecordId };

  let blob: WriteBlobResult;
  try {
    blob = await linkBlobFromFile(layout.blobsDir, contentTmpPath, contentSha256);
  } catch (err) {
    // Stable safe summary: filesystem/SQLite errors may expose absolute paths or internal details.
    recordFailure(db, claim.recordId, { httpStatus: 503, errorCode: "storage_unavailable", errorSummary: "Evidence content could not be published to secure storage." });
    return { kind: "failed", httpStatus: 503, errorCode: "storage_unavailable", errorSummary: "Evidence content could not be published to secure storage.", fieldErrors: [], recordId: claim.recordId };
  }

  if (blob.contentSha256 !== contentSha256) {
    recordFailure(db, claim.recordId, { httpStatus: 422, errorCode: "content_hash_mismatch", errorSummary: "Published blob hash does not match computed content hash." });
    return { kind: "failed", httpStatus: 422, errorCode: "content_hash_mismatch", errorSummary: "Published blob hash does not match computed content hash.", fieldErrors: [], recordId: claim.recordId };
  }

  const sourceId = uuid();
  const evidenceId = uuid();
  const ts = now();
  const description = (typeof metadata.description === "string" ? metadata.description : "").trim();

  db.exec("BEGIN");
  try {
    // Insert source first with deferred FK to the evidence we are about to create.
    db.prepare(`INSERT INTO source_references (
      source_reference_id, analysis_project_id, source_kind, display_name, description,
      capability_id, contract_version, source_object_key, initial_evidence_artifact_id,
      declared_data_scope, usage_constraints_json, safety_handling_policy, created_at, created_by_actor_id
    ) VALUES (?, ?, 'user_provided', ?, ?, NULL, NULL, NULL, ?, ?, ?, ?, ?, ?)`).run(
      sourceId, projectId, metadata.displayName, description, evidenceId,
      metadata.declaredDataScope, JSON.stringify(metadata.usageConstraints), metadata.safetyHandlingPolicy, ts, actorContext.actorId,
    );
    // Insert evidence bound to the source.
    db.prepare(`INSERT INTO evidence_artifacts (
      evidence_artifact_id, analysis_project_id, analysis_run_id, source_reference_id, source_check_id,
      origin_kind, artifact_kind, display_name, storage_ref, content_sha256, media_type, byte_size,
      safety_class, visibility, retrieved_at, observed_source_version, created_at, created_by_actor_id, producer_name, producer_version
    ) VALUES (?, ?, NULL, ?, NULL, 'user_provided', 'input_material', ?, ?, ?, ?, ?, ?, 'user_visible', NULL, NULL, ?, ?, NULL, ?)`).run(
      evidenceId, projectId, sourceId, metadata.displayName, blob.storageRef, blob.contentSha256,
      metadata.declaredMediaType, blob.byteSize, metadata.safetyClass, ts, actorContext.actorId, clientVersion,
    );
    recordSuccessInTx(db, claim.recordId, { httpStatus: 201, resultResourceType: "Evidence", resultResourceId: evidenceId });
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    // Stable safe summary: SQLite errors may expose SQL/schema/internal details.
    recordFailure(db, claim.recordId, { httpStatus: 503, errorCode: "storage_unavailable", errorSummary: "Evidence metadata could not be recorded." });
    return { kind: "failed", httpStatus: 503, errorCode: "storage_unavailable", errorSummary: "Evidence metadata could not be recorded.", fieldErrors: [], recordId: claim.recordId };
  }

  return {
    kind: "executed",
    httpStatus: 201,
    resultResourceType: "Evidence",
    resultResourceId: evidenceId,
    recordId: claim.recordId,
    data: {
      evidenceArtifactId: evidenceId,
      sourceReferenceId: sourceId,
      displayName: metadata.displayName,
      contentSha256: blob.contentSha256,
      byteSize: blob.byteSize,
      mediaType: metadata.declaredMediaType,
      createdAt: ts,
    },
  };
}
