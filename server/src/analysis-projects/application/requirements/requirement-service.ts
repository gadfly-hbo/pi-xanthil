/**
 * Requirement application service (§6.3, API-045/API-046).
 *
 * - requirement.generate: Engine candidate → validated Requirement version → atomic blob + version + current pointer.
 * - requirement.decide_confirmation: Gate decision on current Requirement version.
 *
 * Contract:
 * - Backend is the sole business persistence writer; Engine returns candidate only.
 * - Idempotency: claimOn → execute → recordSuccessInTx/recordFailure.
 * - Version creation: canonical JSON → SHA-256 → controlled blob → atomic transaction.
 * - Gate: active human, project active, target identity/schema/hash, decision conditions.
 * - Same target only one GateDecision; fail closed on duplicate.
 */
import type { DatabaseSync } from "node:sqlite";
import { claimOn, recordSuccessInTx, recordFailure } from "../idempotency/idempotency-service.ts";
import { computeRequestHash, now, uuid, isUuidV4, isSha256Hex, type TrustedActorContext } from "../shared/runtime.ts";
import { ApplicationError } from "../../contracts/envelope.ts";
import type { CommandResult } from "../shared/command.ts";
import { requireProject, assertActiveHuman, handleClaim, failWith, mapErr } from "../projects/project-service.ts";
import type { AnalysisProjectRow } from "../projects/project-queries.ts";
import { getActorById } from "../actors/actor-service.ts";
import { writeCanonicalJsonBlob, readBlob } from "../../persistence/blob-writer.ts";
import { canonicalJsonStringify } from "../../persistence/canonical-json.ts";
import { sha256HexBytes } from "../../persistence/sha256.ts";
import type { DataRootLayout } from "../../persistence/data-root.ts";
import type { EnginePortRequest, EnginePortResultEnvelope } from "../../contracts/engine-port.ts";
import { ENGINE_PORT_VERSION } from "../../contracts/registries.ts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface StructuredRequirementContent {
  readonly businessQuestion: string;
  readonly scope: {
    readonly inScope: readonly string[];
    readonly outOfScope: readonly string[];
  };
  readonly acceptanceCriteria: readonly string[];
  readonly sourceReferenceIds: readonly string[];
  readonly inputEvidenceArtifactIds: readonly string[];
}

export interface StructuredRequirementVersionRow {
  readonly structuredRequirementVersionId: string;
  readonly analysisProjectId: string;
  readonly analysisRequestId: string;
  readonly versionOrdinal: number;
  readonly supersedesVersionId: string | null;
  readonly schemaVersion: string;
  readonly contentSha256: string;
  readonly storageRef: string;
  readonly createdAt: string;
  readonly createdByActorId: string;
}

interface RequirementVersionRowShape {
  structured_requirement_version_id: string;
  analysis_project_id: string;
  analysis_request_id: string;
  version_ordinal: number;
  supersedes_version_id: string | null;
  schema_version: string;
  content_sha256: string;
  storage_ref: string;
  created_at: string;
  created_by_actor_id: string;
}

const REQ_VERSION_SELECT =
  "structured_requirement_version_id, analysis_project_id, analysis_request_id, " +
  "version_ordinal, supersedes_version_id, schema_version, content_sha256, " +
  "storage_ref, created_at, created_by_actor_id";

function rowToReqVersion(row: RequirementVersionRowShape): StructuredRequirementVersionRow {
  return {
    structuredRequirementVersionId: row.structured_requirement_version_id,
    analysisProjectId: row.analysis_project_id,
    analysisRequestId: row.analysis_request_id,
    versionOrdinal: row.version_ordinal,
    supersedesVersionId: row.supersedes_version_id,
    schemaVersion: row.schema_version,
    contentSha256: row.content_sha256,
    storageRef: row.storage_ref,
    createdAt: row.created_at,
    createdByActorId: row.created_by_actor_id,
  };
}

export function getRequirementVersionById(db: DatabaseSync, workspaceId: string, versionId: string): StructuredRequirementVersionRow | null {
  const row = db.prepare(`SELECT ${REQ_VERSION_SELECT} FROM structured_requirement_versions WHERE structured_requirement_version_id = ? AND analysis_project_id IN (SELECT analysis_project_id FROM analysis_projects WHERE workspace_id = ?)`).get(versionId, workspaceId) as RequirementVersionRowShape | undefined;
  return row ? rowToReqVersion(row) : null;
}

// ---------------------------------------------------------------------------
// Normative schema validation
// ---------------------------------------------------------------------------

const REQUIREMENT_SCHEMA_VERSION = "1.0";

const FORBIDDEN_CONTENT_KEYS = new Set([
  "prompt", "hiddenReasoning", "rawPiEvent", "rawPiEvents",
  "token", "accessToken", "apiKey", "storageRef", "absolutePath", "path", "evidenceContent",
]);
const ABSOLUTE_PATH_RE = /(?:^|\s)(?:\/[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._ -]+)+|[A-Za-z]:\\[^\s]+)/;
const TOKEN_LIKE_RE = /[A-Za-z0-9_-]{40,}/;

function assertContentSafe(value: unknown): void {
  const SAFE_SUMMARY = "Generation output did not match the expected safe candidate schema.";
  if (typeof value === "string") {
    if (ABSOLUTE_PATH_RE.test(value)) throw new ApplicationError("generation_output_invalid", SAFE_SUMMARY);
    if (TOKEN_LIKE_RE.test(value)) throw new ApplicationError("generation_output_invalid", SAFE_SUMMARY);
    return;
  }
  if (Array.isArray(value)) { for (const item of value) assertContentSafe(item); return; }
  if (value !== null && typeof value === "object") {
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      if (FORBIDDEN_CONTENT_KEYS.has(key)) throw new ApplicationError("generation_output_invalid", SAFE_SUMMARY);
      assertContentSafe(child);
    }
  }
}

const ALLOWED_CANDIDATE_ROOT_KEYS = new Set([
  "businessQuestion", "scope", "acceptanceCriteria", "sourceReferenceIds", "inputEvidenceArtifactIds",
]);
const ALLOWED_SCOPE_KEYS = new Set(["inScope", "outOfScope"]);

function validateStructuredRequirementContent(candidate: unknown): StructuredRequirementContent {
  if (candidate === null || typeof candidate !== "object" || Array.isArray(candidate)) {
    throw new ApplicationError("generation_output_invalid", "Requirement candidate must be an object.");
  }
  const obj = candidate as Record<string, unknown>;

  // Safety: reject forbidden keys, absolute paths, and token-like secrets
  assertContentSafe(obj);

  // Fail closed on unknown root fields
  for (const key of Object.keys(obj)) {
    if (!ALLOWED_CANDIDATE_ROOT_KEYS.has(key)) {
      throw new ApplicationError("generation_output_invalid", "Requirement candidate contains unknown field.");
    }
  }

  // businessQuestion: required, non-empty string
  if (typeof obj.businessQuestion !== "string" || obj.businessQuestion.trim().length === 0) {
    throw new ApplicationError("generation_output_invalid", "Requirement candidate missing or empty businessQuestion.");
  }

  // scope: required object with inScope/outOfScope arrays
  if (obj.scope === null || typeof obj.scope !== "object" || Array.isArray(obj.scope)) {
    throw new ApplicationError("generation_output_invalid", "Requirement candidate missing or invalid scope.");
  }
  const scope = obj.scope as Record<string, unknown>;
  // Fail closed on unknown scope fields
  for (const key of Object.keys(scope)) {
    if (!ALLOWED_SCOPE_KEYS.has(key)) {
      throw new ApplicationError("generation_output_invalid", "Requirement candidate scope contains unknown field.");
    }
  }
  if (!Array.isArray(scope.inScope) || !Array.isArray(scope.outOfScope)) {
    throw new ApplicationError("generation_output_invalid", "Requirement candidate scope must have inScope and outOfScope arrays.");
  }
  for (const item of scope.inScope) {
    if (typeof item !== "string") throw new ApplicationError("generation_output_invalid", "scope.inScope must contain only strings.");
  }
  for (const item of scope.outOfScope) {
    if (typeof item !== "string") throw new ApplicationError("generation_output_invalid", "scope.outOfScope must contain only strings.");
  }

  // acceptanceCriteria: required, non-empty array of strings
  if (!Array.isArray(obj.acceptanceCriteria) || obj.acceptanceCriteria.length === 0) {
    throw new ApplicationError("generation_output_invalid", "Requirement candidate must have non-empty acceptanceCriteria.");
  }
  for (const item of obj.acceptanceCriteria) {
    if (typeof item !== "string") throw new ApplicationError("generation_output_invalid", "acceptanceCriteria must contain only strings.");
  }

  // sourceReferenceIds: optional array of strings (UUID v4)
  const sourceReferenceIds: string[] = [];
  if (obj.sourceReferenceIds !== undefined) {
    if (!Array.isArray(obj.sourceReferenceIds)) {
      throw new ApplicationError("generation_output_invalid", "sourceReferenceIds must be an array.");
    }
    for (const id of obj.sourceReferenceIds) {
      if (!isUuidV4(id)) throw new ApplicationError("generation_output_invalid", "sourceReferenceIds must contain valid UUIDs.");
      sourceReferenceIds.push(id);
    }
  }

  // inputEvidenceArtifactIds: optional array of strings (UUID v4)
  const inputEvidenceArtifactIds: string[] = [];
  if (obj.inputEvidenceArtifactIds !== undefined) {
    if (!Array.isArray(obj.inputEvidenceArtifactIds)) {
      throw new ApplicationError("generation_output_invalid", "inputEvidenceArtifactIds must be an array.");
    }
    for (const id of obj.inputEvidenceArtifactIds) {
      if (!isUuidV4(id)) throw new ApplicationError("generation_output_invalid", "inputEvidenceArtifactIds must contain valid UUIDs.");
      inputEvidenceArtifactIds.push(id);
    }
  }

  return {
    businessQuestion: obj.businessQuestion.trim(),
    scope: { inScope: [...scope.inScope], outOfScope: [...scope.outOfScope] },
    acceptanceCriteria: [...obj.acceptanceCriteria],
    sourceReferenceIds,
    inputEvidenceArtifactIds,
  };
}

// ---------------------------------------------------------------------------
// Engine handler type (injected)
// ---------------------------------------------------------------------------

export type RequirementEngineHandler = (request: EnginePortRequest) => Promise<EnginePortResultEnvelope>;

// ---------------------------------------------------------------------------
// requirement.generate
// ---------------------------------------------------------------------------

export interface GenerateRequirementBody {
  readonly expectedProjectUpdatedAt?: string;
  /** For revision: the previous version ID that was given changes_requested. */
  readonly previousRequirementVersionId?: string;
  /** For revision: the gate decision ID that triggered this revision. */
  readonly triggeringGateDecisionId?: string;
}

export interface GenerateRequirementInput {
  readonly db: DatabaseSync;
  readonly layout: DataRootLayout;
  readonly workspaceId: string;
  readonly actorContext: TrustedActorContext;
  readonly idempotencyKey: string;
  readonly projectId: string;
  readonly body: GenerateRequirementBody;
  readonly engineHandler: RequirementEngineHandler;
}

export interface GenerateRequirementResult {
  readonly structuredRequirementVersionId: string;
  readonly analysisProjectId: string;
  readonly analysisRequestId: string;
  readonly versionOrdinal: number;
  readonly supersedesVersionId: string | null;
  readonly schemaVersion: string;
  readonly contentSha256: string;
  readonly createdAt: string;
}

export async function generateRequirement(input: GenerateRequirementInput): Promise<CommandResult<GenerateRequirementResult>> {
  const { db, layout, workspaceId, actorContext, idempotencyKey, projectId, body, engineHandler } = input;

  // 1. Actor validation
  assertActiveHuman(actorContext);

  // 2. Project validation
  const proj = requireProject(db, workspaceId, projectId);
  if (proj.projectStatus !== "active") {
    return { kind: "failed", httpStatus: 409, errorCode: "invalid_state_transition", errorSummary: "Cannot generate requirement for a non-active project.", fieldErrors: [], recordId: "" };
  }
  if (proj.archivedAt !== null) {
    return { kind: "failed", httpStatus: 409, errorCode: "invalid_state_transition", errorSummary: "Cannot generate requirement for an archived project.", fieldErrors: [], recordId: "" };
  }

  // 3. Idempotency claim (before state checks to allow replays)
  const requestHash = computeRequestHash("POST", `/api/v1/projects/${projectId}/requirements:generate`, body);
  const claim = claimOn(db, { actorId: actorContext.actorId, commandType: "requirement.generate", idempotencyKey, requestHash });
  const pre = handleClaim(claim);
  if (pre) return pre;

  // 4. AnalysisRequest must exist
  const request = db.prepare(`SELECT analysis_request_id FROM analysis_requests WHERE analysis_project_id = ? AND analysis_project_id IN (SELECT analysis_project_id FROM analysis_projects WHERE workspace_id = ?)`).get(projectId, workspaceId) as { analysis_request_id: string } | undefined;
  if (!request) {
    const err = new ApplicationError("invalid_state_transition", "No analysis request has been submitted for this project.");
    recordFailure(db, claim.recordId, { httpStatus: err.httpStatus, errorCode: err.code, errorSummary: err.message });
    return { kind: "failed", httpStatus: err.httpStatus, errorCode: err.code, errorSummary: err.message, fieldErrors: [], recordId: claim.recordId };
  }

  // 5. expectedProjectUpdatedAt precondition
  if (body.expectedProjectUpdatedAt !== undefined) {
    if (proj.updatedAt !== body.expectedProjectUpdatedAt) {
      const err = new ApplicationError("concurrent_modification", "expectedProjectUpdatedAt does not match; refresh and retry.");
      recordFailure(db, claim.recordId, { httpStatus: err.httpStatus, errorCode: err.code, errorSummary: err.message });
      return { kind: "failed", httpStatus: err.httpStatus, errorCode: err.code, errorSummary: err.message, fieldErrors: [], recordId: claim.recordId };
    }
  }

  // 6. Determine if this is a first version or revision
  const isRevision = body.previousRequirementVersionId !== undefined;
  let previousVersion: StructuredRequirementVersionRow | null = null;
  let nextOrdinal = 1;
  let supersedesVersionId: string | null = null;

  if (isRevision) {
    // Revision path: previous version must exist, be current, and have changes_requested gate
    if (!isUuidV4(body.previousRequirementVersionId!)) {
      const err = new ApplicationError("validation_failed", "previousRequirementVersionId must be a valid UUID.", { fieldErrors: [{ fieldPath: "/previousRequirementVersionId", code: "invalid_uuid", summary: "Must be a UUID v4" }] });
      recordFailure(db, claim.recordId, { httpStatus: err.httpStatus, errorCode: err.code, errorSummary: err.message });
      return { kind: "failed", httpStatus: err.httpStatus, errorCode: err.code, errorSummary: err.message, fieldErrors: err.fieldErrors, recordId: claim.recordId };
    }
    previousVersion = getRequirementVersionById(db, workspaceId, body.previousRequirementVersionId!);
    if (!previousVersion) {
      const err = new ApplicationError("resource_not_found", "Previous requirement version not found.");
      recordFailure(db, claim.recordId, { httpStatus: err.httpStatus, errorCode: err.code, errorSummary: err.message });
      return { kind: "failed", httpStatus: err.httpStatus, errorCode: err.code, errorSummary: err.message, fieldErrors: [], recordId: claim.recordId };
    }
    if (previousVersion.analysisProjectId !== projectId) {
      const err = new ApplicationError("resource_not_found", "Previous requirement version does not belong to this project.");
      recordFailure(db, claim.recordId, { httpStatus: err.httpStatus, errorCode: err.code, errorSummary: err.message });
      return { kind: "failed", httpStatus: err.httpStatus, errorCode: err.code, errorSummary: err.message, fieldErrors: [], recordId: claim.recordId };
    }
    // Must be the current version
    if (proj.currentRequirementVersionId !== previousVersion.structuredRequirementVersionId) {
      const err = new ApplicationError("invalid_state_transition", "Previous requirement version is not the current version.");
      recordFailure(db, claim.recordId, { httpStatus: err.httpStatus, errorCode: err.code, errorSummary: err.message });
      return { kind: "failed", httpStatus: err.httpStatus, errorCode: err.code, errorSummary: err.message, fieldErrors: [], recordId: claim.recordId };
    }
    // Must have a changes_requested gate decision
    const gateRow = db.prepare(
      `SELECT gate_decision_id FROM gate_decisions WHERE analysis_project_id = ? AND analysis_project_id IN (SELECT analysis_project_id FROM analysis_projects WHERE workspace_id = ?) AND gate_type = 'requirement_confirmation' AND target_object_id = ? AND decision = 'changes_requested'`
    ).get(projectId, workspaceId, previousVersion.structuredRequirementVersionId) as { gate_decision_id: string } | undefined;
    if (!gateRow) {
      const err = new ApplicationError("invalid_state_transition", "Previous requirement version does not have a changes_requested gate decision.");
      recordFailure(db, claim.recordId, { httpStatus: err.httpStatus, errorCode: err.code, errorSummary: err.message });
      return { kind: "failed", httpStatus: err.httpStatus, errorCode: err.code, errorSummary: err.message, fieldErrors: [], recordId: claim.recordId };
    }
    // triggeringGateDecisionId is required on revision
    if (body.triggeringGateDecisionId === undefined) {
      const err = new ApplicationError("validation_failed", "triggeringGateDecisionId is required for revision.", { fieldErrors: [{ fieldPath: "/triggeringGateDecisionId", code: "required", summary: "triggeringGateDecisionId is required when previousRequirementVersionId is present" }] });
      recordFailure(db, claim.recordId, { httpStatus: err.httpStatus, errorCode: err.code, errorSummary: err.message });
      return { kind: "failed", httpStatus: err.httpStatus, errorCode: err.code, errorSummary: err.message, fieldErrors: err.fieldErrors, recordId: claim.recordId };
    }
    if (!isUuidV4(body.triggeringGateDecisionId)) {
      const err = new ApplicationError("validation_failed", "triggeringGateDecisionId must be a valid UUID.", { fieldErrors: [{ fieldPath: "/triggeringGateDecisionId", code: "invalid_uuid", summary: "Must be a UUID v4" }] });
      recordFailure(db, claim.recordId, { httpStatus: err.httpStatus, errorCode: err.code, errorSummary: err.message });
      return { kind: "failed", httpStatus: err.httpStatus, errorCode: err.code, errorSummary: err.message, fieldErrors: err.fieldErrors, recordId: claim.recordId };
    }
    if (body.triggeringGateDecisionId !== gateRow.gate_decision_id) {
      const err = new ApplicationError("invalid_state_transition", "triggeringGateDecisionId does not match the changes_requested gate decision.");
      recordFailure(db, claim.recordId, { httpStatus: err.httpStatus, errorCode: err.code, errorSummary: err.message });
      return { kind: "failed", httpStatus: err.httpStatus, errorCode: err.code, errorSummary: err.message, fieldErrors: [], recordId: claim.recordId };
    }
    nextOrdinal = previousVersion.versionOrdinal + 1;
    supersedesVersionId = previousVersion.structuredRequirementVersionId;
  } else {
    // First version: no existing current requirement
    if (proj.currentRequirementVersionId !== null) {
      const err = new ApplicationError("invalid_state_transition", "A requirement version already exists for this project. Use revision to generate a new version.");
      recordFailure(db, claim.recordId, { httpStatus: err.httpStatus, errorCode: err.code, errorSummary: err.message });
      return { kind: "failed", httpStatus: err.httpStatus, errorCode: err.code, errorSummary: err.message, fieldErrors: [], recordId: claim.recordId };
    }
  }

  // 6. Call Engine handler
  const generationId = uuid();
  const startedAt = now();
  const engineRequest: EnginePortRequest = {
    version: ENGINE_PORT_VERSION,
    operation: "generateStructuredRequirement",
    operationId: uuid(),
    projectId,
    generationId,
    caller: "workcanger-backend",
    requestedAt: startedAt,
    inputHash: sha256HexBytes(new TextEncoder().encode(canonicalJsonStringify({
      projectId,
      analysisRequestId: request.analysis_request_id,
      targetSchemaVersion: REQUIREMENT_SCHEMA_VERSION,
      previousRequirementVersionId: supersedesVersionId,
    }))),
    input: { targetSchemaVersion: REQUIREMENT_SCHEMA_VERSION },
  };

  let engineResult: EnginePortResultEnvelope;
  try {
    engineResult = await engineHandler(engineRequest);
  } catch {
    return failWith(db, claim.recordId, new ApplicationError("engine_unavailable", "Analysis Engine is not available."));
  }

  // 7. Map engine outcome
  if (engineResult.outcome !== "succeeded") {
    const errorCode = engineResult.error?.code ?? "engine_unavailable";
    const errorSummary = mapEngineErrorCodeToSummary(errorCode);
    return failWith(db, claim.recordId, new ApplicationError(mapEngineErrorToApiCode(errorCode), errorSummary));
  }

  // 8. Extract and validate candidate from engine output
  const output = engineResult.output as Record<string, unknown> | undefined;
  if (!output || typeof output !== "object") {
    return failWith(db, claim.recordId, new ApplicationError("generation_output_invalid", "Engine output is not a valid object."));
  }

  // The engine returns a typed candidate envelope; extract the candidate
  const candidate = (output as Record<string, unknown>).candidate;
  let validatedContent: StructuredRequirementContent;
  try {
    validatedContent = validateStructuredRequirementContent(candidate);
  } catch (err) {
    if (err instanceof ApplicationError) {
      return failWith(db, claim.recordId, err);
    }
    return failWith(db, claim.recordId, new ApplicationError("generation_output_invalid", "Requirement candidate failed validation."));
  }

  // 9. Canonicalize, hash, write blob
  const canonicalBytes = new TextEncoder().encode(canonicalJsonStringify(validatedContent));
  const contentSha256 = sha256HexBytes(canonicalBytes);

  let blobResult: { storageRef: string; contentSha256: string };
  try {
    blobResult = writeCanonicalJsonBlob(layout.blobsDir, layout.tmpDir, validatedContent);
  } catch {
    return failWith(db, claim.recordId, new ApplicationError("storage_unavailable", "Requirement content could not be published to secure storage."));
  }

  // 10. Atomic transaction: insert version + update current pointer
  const versionId = uuid();
  const ts = now();
  db.exec("BEGIN");
  try {
    db.prepare(
      `INSERT INTO structured_requirement_versions (
        structured_requirement_version_id, analysis_project_id, analysis_request_id,
        version_ordinal, supersedes_version_id, schema_version, content_sha256,
        storage_ref, created_at, created_by_actor_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      versionId, projectId, request.analysis_request_id,
      nextOrdinal, supersedesVersionId, REQUIREMENT_SCHEMA_VERSION, contentSha256,
      blobResult.storageRef, ts, actorContext.actorId,
    );

    db.prepare(
      `UPDATE analysis_projects SET current_requirement_version_id = ?, updated_at = ? WHERE analysis_project_id = ? AND workspace_id = ?`
    ).run(versionId, ts, projectId, workspaceId);

    recordSuccessInTx(db, claim.recordId, { httpStatus: 201, resultResourceType: "Requirement", resultResourceId: versionId });
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    return failWith(db, claim.recordId, mapErr(err));
  }

  return {
    kind: "executed",
    httpStatus: 201,
    resultResourceType: "Requirement",
    resultResourceId: versionId,
    recordId: claim.recordId,
    data: {
      structuredRequirementVersionId: versionId,
      analysisProjectId: projectId,
      analysisRequestId: request.analysis_request_id,
      versionOrdinal: nextOrdinal,
      supersedesVersionId,
      schemaVersion: REQUIREMENT_SCHEMA_VERSION,
      contentSha256,
      createdAt: ts,
    },
  };
}

// ---------------------------------------------------------------------------
// requirement.decide_confirmation
// ---------------------------------------------------------------------------

export type RequirementDecision = "approved" | "changes_requested" | "rejected";

export interface RequestedChange {
  readonly summary: string;
  readonly rationale: string | null;
  readonly affectedFieldPaths: readonly string[];
}

export interface DecideRequirementConfirmationBody {
  readonly requirementVersionId: string;
  readonly targetSchemaVersion: string;
  readonly targetContentSha256: string;
  readonly decision: RequirementDecision;
  readonly comment: string | null;
  readonly requestedChanges: readonly RequestedChange[];
  readonly rejectionReason: string | null;
}

export interface DecideRequirementConfirmationInput {
  readonly db: DatabaseSync;
  readonly workspaceId: string;
  readonly actorContext: TrustedActorContext;
  readonly idempotencyKey: string;
  readonly projectId: string;
  readonly body: DecideRequirementConfirmationBody;
}

export interface GateDecisionResult {
  readonly gateDecisionId: string;
  readonly analysisProjectId: string;
  readonly gateType: "requirement_confirmation";
  readonly targetObjectType: "structured_requirement_version";
  readonly targetObjectId: string;
  readonly decision: RequirementDecision;
  readonly decidedAt: string;
  readonly decidedByActorId: string;
}

export function decideRequirementConfirmation(input: DecideRequirementConfirmationInput): CommandResult<GateDecisionResult> {
  const { db, workspaceId, actorContext, idempotencyKey, projectId, body } = input;

  // 1. Actor validation
  assertActiveHuman(actorContext);

  // 2. Project validation
  const proj = requireProject(db, workspaceId, projectId);
  if (proj.projectStatus !== "active") {
    return { kind: "failed", httpStatus: 409, errorCode: "invalid_state_transition", errorSummary: "Cannot decide requirement for a non-active project.", fieldErrors: [], recordId: "" };
  }

  // 3. Idempotency claim (before state checks to allow replays)
  const requestHash = computeRequestHash("POST", `/api/v1/projects/${projectId}/requirements/${body.requirementVersionId}:decide-confirmation`, body);
  const claim = claimOn(db, { actorId: actorContext.actorId, commandType: "requirement.decide_confirmation", idempotencyKey, requestHash });
  const pre = handleClaim(claim);
  if (pre) return pre;

  // 4. Requirement version validation
  if (!isUuidV4(body.requirementVersionId)) {
    const err = new ApplicationError("validation_failed", "requirementVersionId must be a valid UUID.", { fieldErrors: [{ fieldPath: "/requirementVersionId", code: "invalid_uuid", summary: "Must be a UUID v4" }] });
    recordFailure(db, claim.recordId, { httpStatus: err.httpStatus, errorCode: err.code, errorSummary: err.message });
    return { kind: "failed", httpStatus: err.httpStatus, errorCode: err.code, errorSummary: err.message, fieldErrors: err.fieldErrors, recordId: claim.recordId };
  }
  const reqVersion = getRequirementVersionById(db, workspaceId, body.requirementVersionId);
  if (!reqVersion) {
    const err = new ApplicationError("resource_not_found", "Requirement version not found.");
    recordFailure(db, claim.recordId, { httpStatus: err.httpStatus, errorCode: err.code, errorSummary: err.message });
    return { kind: "failed", httpStatus: err.httpStatus, errorCode: err.code, errorSummary: err.message, fieldErrors: [], recordId: claim.recordId };
  }
  if (reqVersion.analysisProjectId !== projectId) {
    const err = new ApplicationError("resource_not_found", "Requirement version does not belong to this project.");
    recordFailure(db, claim.recordId, { httpStatus: err.httpStatus, errorCode: err.code, errorSummary: err.message });
    return { kind: "failed", httpStatus: err.httpStatus, errorCode: err.code, errorSummary: err.message, fieldErrors: [], recordId: claim.recordId };
  }

  // 5. Must be the current version
  if (proj.currentRequirementVersionId !== reqVersion.structuredRequirementVersionId) {
    const err = new ApplicationError("invalid_state_transition", "Can only decide on the current requirement version.");
    recordFailure(db, claim.recordId, { httpStatus: err.httpStatus, errorCode: err.code, errorSummary: err.message });
    return { kind: "failed", httpStatus: err.httpStatus, errorCode: err.code, errorSummary: err.message, fieldErrors: [], recordId: claim.recordId };
  }

  // 6. Target identity/schema/hash validation
  if (body.targetSchemaVersion !== reqVersion.schemaVersion) {
    const err = new ApplicationError("content_hash_mismatch", "Target schema version does not match.");
    recordFailure(db, claim.recordId, { httpStatus: err.httpStatus, errorCode: err.code, errorSummary: err.message });
    return { kind: "failed", httpStatus: err.httpStatus, errorCode: err.code, errorSummary: err.message, fieldErrors: [], recordId: claim.recordId };
  }
  if (body.targetContentSha256 !== reqVersion.contentSha256) {
    const err = new ApplicationError("content_hash_mismatch", "Target content hash does not match.");
    recordFailure(db, claim.recordId, { httpStatus: err.httpStatus, errorCode: err.code, errorSummary: err.message });
    return { kind: "failed", httpStatus: err.httpStatus, errorCode: err.code, errorSummary: err.message, fieldErrors: [], recordId: claim.recordId };
  }

  // 7. Check no existing gate decision for this target
  const existingGate = db.prepare(
    `SELECT gate_decision_id FROM gate_decisions WHERE gate_type = 'requirement_confirmation' AND target_object_type = 'structured_requirement_version' AND target_object_id = ? AND analysis_project_id IN (SELECT analysis_project_id FROM analysis_projects WHERE workspace_id = ?)`
  ).get(body.requirementVersionId, workspaceId) as { gate_decision_id: string } | undefined;
  if (existingGate) {
    const err = new ApplicationError("gate_already_decided", "A gate decision already exists for this requirement version.");
    recordFailure(db, claim.recordId, { httpStatus: err.httpStatus, errorCode: err.code, errorSummary: err.message });
    return { kind: "failed", httpStatus: err.httpStatus, errorCode: err.code, errorSummary: err.message, fieldErrors: [], recordId: claim.recordId };
  }

  // 8. Decision condition validation
  try {
    validateDecisionConditions(body.decision, body.requestedChanges, body.rejectionReason);
  } catch (err) {
    if (err instanceof ApplicationError) {
      recordFailure(db, claim.recordId, { httpStatus: err.httpStatus, errorCode: err.code, errorSummary: err.message });
      return { kind: "failed", httpStatus: err.httpStatus, errorCode: err.code, errorSummary: err.message, fieldErrors: err.fieldErrors, recordId: claim.recordId };
    }
    throw err;
  }

  // 9. Get actor display name snapshot
  const actor = getActorById(db, actorContext.actorId);
  const actorDisplayName = actor?.displayName ?? "Unknown";

  // 10. Build requestedChangesJson with Backend-assigned UUIDs
  const requestedChangesJson = body.requestedChanges.map((rc) => ({
    requestedChangeId: uuid(),
    summary: rc.summary,
    rationale: rc.rationale,
    affectedFieldPaths: rc.affectedFieldPaths,
  }));

  // 11. Atomic transaction: insert gate decision
  const gateId = uuid();
  const ts = now();
  db.exec("BEGIN");
  try {
    db.prepare(
      `INSERT INTO gate_decisions (
        gate_decision_id, analysis_project_id, gate_type, target_object_type,
        target_object_id, target_schema_version, target_content_sha256,
        decision, decided_at, decided_by_actor_id, actor_display_name_snapshot,
        comment, requested_changes_json, rejection_reason, submitted_via, client_version
      ) VALUES (?, ?, 'requirement_confirmation', 'structured_requirement_version', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      gateId, projectId, body.requirementVersionId,
      body.targetSchemaVersion, body.targetContentSha256,
      body.decision, ts, actorContext.actorId, actorDisplayName,
      body.comment, JSON.stringify(requestedChangesJson),
      body.rejectionReason, actorContext.submittedVia, actorContext.clientVersion,
    );

    recordSuccessInTx(db, claim.recordId, { httpStatus: 201, resultResourceType: "Gate", resultResourceId: gateId });
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    return failWith(db, claim.recordId, mapErr(err));
  }

  return {
    kind: "executed",
    httpStatus: 201,
    resultResourceType: "Gate",
    resultResourceId: gateId,
    recordId: claim.recordId,
    data: {
      gateDecisionId: gateId,
      analysisProjectId: projectId,
      gateType: "requirement_confirmation",
      targetObjectType: "structured_requirement_version",
      targetObjectId: body.requirementVersionId,
      decision: body.decision,
      decidedAt: ts,
      decidedByActorId: actorContext.actorId,
    },
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function validateDecisionConditions(
  decision: RequirementDecision,
  requestedChanges: readonly RequestedChange[],
  rejectionReason: string | null,
): void {
  if (decision === "approved") {
    if (requestedChanges.length > 0) {
      throw new ApplicationError("validation_failed", "approved decision must have empty requestedChanges.", { fieldErrors: [{ fieldPath: "/requestedChanges", code: "must_be_empty", summary: "approved requires no requested changes" }] });
    }
    if (rejectionReason !== null) {
      throw new ApplicationError("validation_failed", "approved decision must have null rejectionReason.", { fieldErrors: [{ fieldPath: "/rejectionReason", code: "must_be_null", summary: "approved requires null rejection reason" }] });
    }
  } else if (decision === "changes_requested") {
    if (requestedChanges.length === 0) {
      throw new ApplicationError("validation_failed", "changes_requested decision must have non-empty requestedChanges.", { fieldErrors: [{ fieldPath: "/requestedChanges", code: "must_be_non_empty", summary: "changes_requested requires at least one requested change" }] });
    }
    if (rejectionReason !== null) {
      throw new ApplicationError("validation_failed", "changes_requested decision must have null rejectionReason.", { fieldErrors: [{ fieldPath: "/rejectionReason", code: "must_be_null", summary: "changes_requested requires null rejection reason" }] });
    }
    // Validate each requested change
    for (let i = 0; i < requestedChanges.length; i++) {
      const rc = requestedChanges[i]!;
      if (typeof rc.summary !== "string" || rc.summary.trim().length === 0) {
        throw new ApplicationError("validation_failed", `requestedChanges[${i}].summary must be non-empty.`, { fieldErrors: [{ fieldPath: `/requestedChanges/${i}/summary`, code: "empty", summary: "summary must be non-empty" }] });
      }
      if (!Array.isArray(rc.affectedFieldPaths) || rc.affectedFieldPaths.length === 0) {
        throw new ApplicationError("validation_failed", `requestedChanges[${i}].affectedFieldPaths must be non-empty.`, { fieldErrors: [{ fieldPath: `/requestedChanges/${i}/affectedFieldPaths`, code: "empty", summary: "affectedFieldPaths must be non-empty" }] });
      }
      for (let j = 0; j < rc.affectedFieldPaths.length; j++) {
        if (typeof rc.affectedFieldPaths[j]! !== "string" || !rc.affectedFieldPaths[j]!.startsWith("/")) {
          throw new ApplicationError("validation_failed", `requestedChanges[${i}].affectedFieldPaths[${j}] must be a valid RFC 6901 JSON Pointer.`, { fieldErrors: [{ fieldPath: `/requestedChanges/${i}/affectedFieldPaths/${j}`, code: "invalid_pointer", summary: "Must be a valid JSON Pointer starting with /" }] });
        }
      }
    }
  } else if (decision === "rejected") {
    if (requestedChanges.length > 0) {
      throw new ApplicationError("validation_failed", "rejected decision must have empty requestedChanges.", { fieldErrors: [{ fieldPath: "/requestedChanges", code: "must_be_empty", summary: "rejected requires no requested changes" }] });
    }
    if (rejectionReason === null || rejectionReason.trim().length === 0) {
      throw new ApplicationError("validation_failed", "rejected decision must have non-empty rejectionReason.", { fieldErrors: [{ fieldPath: "/rejectionReason", code: "required", summary: "rejected requires a rejection reason" }] });
    }
  } else {
    throw new ApplicationError("validation_failed", `Unknown decision: ${decision}.`, { fieldErrors: [{ fieldPath: "/decision", code: "invalid_enum", summary: "Must be approved, changes_requested, or rejected" }] });
  }
}

function mapEngineErrorCodeToSummary(code: string): string {
  switch (code) {
    case "pi_spawn_failed": return "pi-agent process could not be started.";
    case "pi_execution_failed": return "pi-agent execution did not complete successfully.";
    case "output_schema_invalid": return "Engine generation output did not match the expected schema.";
    case "deadline_exceeded": return "Generation did not complete before its deadline.";
    case "aborted": return "Generation was aborted before completion.";
    case "invalid_request": return "Invalid generation request.";
    case "unsupported_contract_version": return "Unsupported engine contract version.";
    case "operation_conflict": return "A conflicting generation operation is in progress.";
    case "policy_blocked": return "Generation was blocked by runtime policy.";
    case "project_state_conflict": return "Project state changed during generation.";
    default: return "Analysis Engine is not available.";
  }
}

function mapEngineErrorToApiCode(engineCode: string): string {
  switch (engineCode) {
    case "pi_spawn_failed":
    case "pi_execution_failed":
    case "operation_conflict":
    case "policy_blocked":
    case "project_state_conflict":
      return "engine_unavailable";
    case "output_schema_invalid":
      return "generation_output_invalid";
    case "deadline_exceeded":
      return "command_timed_out";
    case "aborted":
      return "command_interrupted";
    case "invalid_request":
    case "unsupported_contract_version":
      return "validation_failed";
    default:
      return "engine_unavailable";
  }
}
