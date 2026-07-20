/**
 * Plan application service (§6.3, API-047/API-048).
 *
 * - plan.generate: Engine candidate -> validated Plan version -> atomic blob + version + current pointer.
 * - plan.decide_confirmation: Gate decision on current Plan version; approved atomically
 *   creates queued Run + RunInputEvidence + run_queued event in the same transaction.
 *
 * Contract:
 * - Backend is the sole business persistence writer; Engine returns candidate only.
 * - Idempotency: claimOn -> execute -> recordSuccessInTx/recordFailure.
 * - Version creation: canonical JSON -> SHA-256 -> controlled blob -> atomic transaction.
 * - Plan version chain is linear: same-project ordinal contiguous, revision supersedes
 *   current previous Plan version, driven by changes_requested plan_confirmation Gate.
 * - Gate: active human, project active, target identity/schema/hash, decision conditions.
 * - Same target only one GateDecision; fail closed on duplicate.
 * - Plan approved: GateDecision + queued AnalysisRun + RunInputEvidence + run_queued RunEvent
 *   in ONE transaction. Re-validates Project/Plan/Requirement/Source/Evidence state.
 * - RunInputEvidence only admits submitted authorized controlled/derived Evidence;
 *   restricted_raw is never sent to LLM. Fail closed if no admissible Evidence.
 */
import type { DatabaseSync } from "node:sqlite";
import { claimOn, recordSuccessInTx, recordFailure } from "../idempotency/idempotency-service.ts";
import { computeRequestHash, now, uuid, isUuidV4, type TrustedActorContext } from "../shared/runtime.ts";
import { ApplicationError } from "../../contracts/envelope.ts";
import type { CommandResult } from "../shared/command.ts";
import { requireProject, assertActiveHuman, handleClaim, failWith, mapErr } from "../projects/project-service.ts";
import { countActiveRuns } from "../projects/project-queries.ts";
import type { EnginePortRequest, EnginePortResultEnvelope } from "../../contracts/engine-port.ts";
import { ENGINE_PORT_VERSION, runEventSchemaVersion } from "../../contracts/registries.ts";
import { writeCanonicalJsonBlob, readBlob } from "../../persistence/blob-writer.ts";
import { canonicalJsonStringify } from "../../persistence/canonical-json.ts";
import { sha256HexBytes } from "../../persistence/sha256.ts";
import type { DataRootLayout } from "../../persistence/data-root.ts";
import { getRequirementVersionById } from "../requirements/requirement-service.ts";
import { getActorById } from "../actors/actor-service.ts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AnalysisPlanStep {
  readonly planStepId: string;
  readonly sequence: number;
  readonly analysisStage: "S2.1" | "S2.2" | "S2.3" | "S2.4";
  readonly purpose: string;
}

export interface AnalysisPlanContent {
  readonly analysisObjective: string;
  readonly successCriteria: readonly string[];
  readonly steps: readonly AnalysisPlanStep[];
  readonly limitations: readonly string[];
  readonly expectedOutputs: readonly string[];
  readonly inputEvidenceBindings: readonly {
    readonly evidenceArtifactId: string;
    readonly planStepId: string;
  }[];
}

export interface AnalysisPlanVersionRow {
  readonly analysisPlanVersionId: string;
  readonly analysisProjectId: string;
  readonly structuredRequirementVersionId: string;
  readonly versionOrdinal: number;
  readonly supersedesVersionId: string | null;
  readonly schemaVersion: string;
  readonly contentSha256: string;
  readonly storageRef: string;
  readonly createdAt: string;
  readonly createdByActorId: string;
}

interface PlanVersionRowShape {
  analysis_plan_version_id: string;
  analysis_project_id: string;
  structured_requirement_version_id: string;
  version_ordinal: number;
  supersedes_version_id: string | null;
  schema_version: string;
  content_sha256: string;
  storage_ref: string;
  created_at: string;
  created_by_actor_id: string;
}

const PLAN_VERSION_SELECT =
  "analysis_plan_version_id, analysis_project_id, structured_requirement_version_id, " +
  "version_ordinal, supersedes_version_id, schema_version, content_sha256, " +
  "storage_ref, created_at, created_by_actor_id";

function rowToPlanVersion(row: PlanVersionRowShape): AnalysisPlanVersionRow {
  return {
    analysisPlanVersionId: row.analysis_plan_version_id,
    analysisProjectId: row.analysis_project_id,
    structuredRequirementVersionId: row.structured_requirement_version_id,
    versionOrdinal: row.version_ordinal,
    supersedesVersionId: row.supersedes_version_id,
    schemaVersion: row.schema_version,
    contentSha256: row.content_sha256,
    storageRef: row.storage_ref,
    createdAt: row.created_at,
    createdByActorId: row.created_by_actor_id,
  };
}

export function getPlanVersionById(db: DatabaseSync, workspaceId: string, versionId: string): AnalysisPlanVersionRow | null {
  const row = db.prepare(`SELECT ${PLAN_VERSION_SELECT} FROM analysis_plan_versions WHERE analysis_plan_version_id = ? AND analysis_project_id IN (SELECT analysis_project_id FROM analysis_projects WHERE workspace_id = ?)`).get(versionId, workspaceId) as PlanVersionRowShape | undefined;
  return row ? rowToPlanVersion(row) : null;
}

// ---------------------------------------------------------------------------
// Normative schema validation
// ---------------------------------------------------------------------------

const PLAN_SCHEMA_VERSION = "1.0";

const FORBIDDEN_CONTENT_KEYS = new Set([
  "prompt", "hiddenReasoning", "rawPiEvent", "rawPiEvents",
  "token", "accessToken", "apiKey", "storageRef", "absolutePath", "path", "evidenceContent",
]);
const ABSOLUTE_PATH_RE = /(?:^|\s)(?:\/[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._ -]+)+|[A-Za-z]:\\[^\s]+)/;
const TOKEN_LIKE_RE = /[A-Za-z0-9_-]{40,}/;
const ALLOWED_ANALYSIS_STAGES = new Set(["S2.1", "S2.2", "S2.3", "S2.4"]);

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
  "analysisObjective", "successCriteria", "steps",
  "limitations", "expectedOutputs", "inputEvidenceBindings",
]);
const ALLOWED_STEP_KEYS = new Set(["planStepId", "sequence", "analysisStage", "purpose"]);
const ALLOWED_BINDING_KEYS = new Set(["evidenceArtifactId", "planStepId"]);

function validateStringArray(value: unknown, fieldPath: string): string[] {
  if (!Array.isArray(value)) {
    throw new ApplicationError("generation_output_invalid", `${fieldPath} must be an array.`);
  }
  for (let i = 0; i < value.length; i++) {
    if (typeof value[i] !== "string" || (value[i] as string).trim().length === 0) {
      throw new ApplicationError("generation_output_invalid", `${fieldPath}[${i}] must be a non-empty string.`);
    }
  }
  return [...value];
}

function validatePlanContent(candidate: unknown): AnalysisPlanContent {
  if (candidate === null || typeof candidate !== "object" || Array.isArray(candidate)) {
    throw new ApplicationError("generation_output_invalid", "Plan candidate must be an object.");
  }
  const obj = candidate as Record<string, unknown>;

  // Safety: reject forbidden keys, absolute paths, token-like secrets
  assertContentSafe(obj);

  // Fail closed on unknown root fields
  for (const key of Object.keys(obj)) {
    if (!ALLOWED_CANDIDATE_ROOT_KEYS.has(key)) {
      throw new ApplicationError("generation_output_invalid", "Plan candidate contains unknown field.");
    }
  }

  // analysisObjective: required, non-empty string (covers analysisQuestion/objective)
  if (typeof obj.analysisObjective !== "string" || obj.analysisObjective.trim().length === 0) {
    throw new ApplicationError("generation_output_invalid", "Plan candidate missing or empty analysisObjective.");
  }

  // successCriteria: required, non-empty array of strings (covers validation/checks)
  if (!Array.isArray(obj.successCriteria) || obj.successCriteria.length === 0) {
    throw new ApplicationError("generation_output_invalid", "Plan candidate must have non-empty successCriteria.");
  }
  const successCriteria = validateStringArray(obj.successCriteria, "successCriteria");

  // steps: required, non-empty array, ordered by sequence (covers ordered steps)
  if (!Array.isArray(obj.steps) || obj.steps.length === 0) {
    throw new ApplicationError("generation_output_invalid", "Plan candidate must have non-empty steps.");
  }
  const steps: AnalysisPlanStep[] = [];
  const seenStepIds = new Set<string>();
  for (let i = 0; i < obj.steps.length; i++) {
    const s = obj.steps[i];
    if (s === null || typeof s !== "object" || Array.isArray(s)) {
      throw new ApplicationError("generation_output_invalid", `steps[${i}] must be an object.`);
    }
    const stepObj = s as Record<string, unknown>;
    for (const key of Object.keys(stepObj)) {
      if (!ALLOWED_STEP_KEYS.has(key)) {
        throw new ApplicationError("generation_output_invalid", `steps[${i}] contains unknown field.`);
      }
    }
    if (typeof stepObj.planStepId !== "string" || stepObj.planStepId.trim().length === 0) {
      throw new ApplicationError("generation_output_invalid", `steps[${i}].planStepId must be a non-empty string.`);
    }
    if (seenStepIds.has(stepObj.planStepId)) {
      throw new ApplicationError("generation_output_invalid", `steps[${i}].planStepId is duplicate.`);
    }
    seenStepIds.add(stepObj.planStepId);
    if (typeof stepObj.sequence !== "number" || !Number.isInteger(stepObj.sequence) || stepObj.sequence < 1) {
      throw new ApplicationError("generation_output_invalid", `steps[${i}].sequence must be a positive integer.`);
    }
    if (typeof stepObj.analysisStage !== "string" || !ALLOWED_ANALYSIS_STAGES.has(stepObj.analysisStage)) {
      throw new ApplicationError("generation_output_invalid", `steps[${i}].analysisStage must be one of S2.1-S2.4.`);
    }
    if (typeof stepObj.purpose !== "string" || stepObj.purpose.trim().length === 0) {
      throw new ApplicationError("generation_output_invalid", `steps[${i}].purpose must be a non-empty string.`);
    }
    steps.push({
      planStepId: stepObj.planStepId,
      sequence: stepObj.sequence,
      analysisStage: stepObj.analysisStage as AnalysisPlanStep["analysisStage"],
      purpose: stepObj.purpose,
    });
  }
  // Verify ordered by sequence (ascending, contiguous starting at 1)
  const sortedSeqs = steps.map(s => s.sequence).sort((a, b) => a - b);
  for (let i = 0; i < sortedSeqs.length; i++) {
    if (sortedSeqs[i] !== i + 1) {
      throw new ApplicationError("generation_output_invalid", "steps sequence must be contiguous starting at 1.");
    }
  }

  // limitations: optional array of strings (covers limitations)
  const limitations: string[] = [];
  if (obj.limitations !== undefined) {
    limitations.push(...validateStringArray(obj.limitations, "limitations"));
  }

  // expectedOutputs: optional array of strings (covers expected outputs)
  const expectedOutputs: string[] = [];
  if (obj.expectedOutputs !== undefined) {
    expectedOutputs.push(...validateStringArray(obj.expectedOutputs, "expectedOutputs"));
  }

  // inputEvidenceBindings: optional array (covers input Evidence bindings)
  const inputEvidenceBindings: { evidenceArtifactId: string; planStepId: string }[] = [];
  if (obj.inputEvidenceBindings !== undefined) {
    if (!Array.isArray(obj.inputEvidenceBindings)) {
      throw new ApplicationError("generation_output_invalid", "inputEvidenceBindings must be an array.");
    }
    const validStepIds = new Set(steps.map(s => s.planStepId));
    for (let i = 0; i < obj.inputEvidenceBindings.length; i++) {
      const b = obj.inputEvidenceBindings[i];
      if (b === null || typeof b !== "object" || Array.isArray(b)) {
        throw new ApplicationError("generation_output_invalid", `inputEvidenceBindings[${i}] must be an object.`);
      }
      const bObj = b as Record<string, unknown>;
      for (const key of Object.keys(bObj)) {
        if (!ALLOWED_BINDING_KEYS.has(key)) {
          throw new ApplicationError("generation_output_invalid", `inputEvidenceBindings[${i}] contains unknown field.`);
        }
      }
      if (!isUuidV4(bObj.evidenceArtifactId)) {
        throw new ApplicationError("generation_output_invalid", `inputEvidenceBindings[${i}].evidenceArtifactId must be a UUID v4.`);
      }
      if (typeof bObj.planStepId !== "string" || !validStepIds.has(bObj.planStepId)) {
        throw new ApplicationError("generation_output_invalid", `inputEvidenceBindings[${i}].planStepId must reference an existing step.`);
      }
      inputEvidenceBindings.push({
        evidenceArtifactId: bObj.evidenceArtifactId,
        planStepId: bObj.planStepId,
      });
    }
  }

  return {
    analysisObjective: obj.analysisObjective.trim(),
    successCriteria,
    steps,
    limitations,
    expectedOutputs,
    inputEvidenceBindings,
  };
}

// ---------------------------------------------------------------------------
// Engine handler type (injected)
// ---------------------------------------------------------------------------

export type PlanEngineHandler = (request: EnginePortRequest) => Promise<EnginePortResultEnvelope>;

// ---------------------------------------------------------------------------
// plan.generate
// ---------------------------------------------------------------------------

export interface GeneratePlanBody {
  readonly expectedProjectUpdatedAt?: string;
  /** For revision: the previous version ID that was given changes_requested. */
  readonly previousPlanVersionId?: string;
  /** For revision: the gate decision ID that triggered this revision. */
  readonly triggeringGateDecisionId?: string;
}

export interface GeneratePlanInput {
  readonly db: DatabaseSync;
  readonly layout: DataRootLayout;
  readonly workspaceId: string;
  readonly actorContext: TrustedActorContext;
  readonly idempotencyKey: string;
  readonly projectId: string;
  readonly body: GeneratePlanBody;
  readonly engineHandler: PlanEngineHandler;
}

export interface GeneratePlanResult {
  readonly analysisPlanVersionId: string;
  readonly analysisProjectId: string;
  readonly structuredRequirementVersionId: string;
  readonly versionOrdinal: number;
  readonly supersedesVersionId: string | null;
  readonly schemaVersion: string;
  readonly contentSha256: string;
  readonly createdAt: string;
}

export async function generatePlan(input: GeneratePlanInput): Promise<CommandResult<GeneratePlanResult>> {
  const { db, layout, workspaceId, actorContext, idempotencyKey, projectId, body, engineHandler } = input;

  // 1. Actor validation
  assertActiveHuman(actorContext);

  // 2. Idempotency claim FIRST (before business state checks to allow replays)
  const requestHash = computeRequestHash("POST", `/api/v1/projects/${projectId}/plans:generate`, body);
  const claim = claimOn(db, { actorId: actorContext.actorId, commandType: "plan.generate", idempotencyKey, requestHash });
  const pre = handleClaim(claim);
  if (pre) return pre;

  // 3. Project validation (after claim; business failures recorded via failWith)
  let proj;
  try {
    proj = requireProject(db, workspaceId, projectId);
  } catch (err) {
    if (err instanceof ApplicationError) return failWith(db, claim.recordId, err);
    throw err;
  }
  if (proj.projectStatus !== "active") {
    return failWith(db, claim.recordId, new ApplicationError("invalid_state_transition", "Cannot generate plan for a non-active project."));
  }
  if (proj.archivedAt !== null) {
    return failWith(db, claim.recordId, new ApplicationError("invalid_state_transition", "Cannot generate plan for an archived project."));
  }

  // 4. Requirement must exist, be current, and be approved
  if (proj.currentRequirementVersionId === null) {
    return failWith(db, claim.recordId, new ApplicationError("invalid_state_transition", "No approved requirement exists for this project."));
  }
  const requirementVersion = getRequirementVersionById(db, workspaceId, proj.currentRequirementVersionId);
  if (!requirementVersion || requirementVersion.analysisProjectId !== projectId) {
    return failWith(db, claim.recordId, new ApplicationError("invalid_state_transition", "Current requirement version is not valid."));
  }
  // Requirement must have an approved gate decision
  const reqGateRow = db.prepare(
    `SELECT gate_decision_id FROM gate_decisions WHERE analysis_project_id = ? AND analysis_project_id IN (SELECT analysis_project_id FROM analysis_projects WHERE workspace_id = ?) AND gate_type = 'requirement_confirmation' AND target_object_id = ? AND decision = 'approved'`
  ).get(projectId, workspaceId, proj.currentRequirementVersionId) as { gate_decision_id: string } | undefined;
  if (!reqGateRow) {
    return failWith(db, claim.recordId, new ApplicationError("invalid_state_transition", "Current requirement has not been approved."));
  }

  // 5. expectedProjectUpdatedAt precondition
  if (body.expectedProjectUpdatedAt !== undefined) {
    if (proj.updatedAt !== body.expectedProjectUpdatedAt) {
      return failWith(db, claim.recordId, new ApplicationError("concurrent_modification", "expectedProjectUpdatedAt does not match; refresh and retry."));
    }
  }

  // 6. Determine if this is a first version or revision
  const isRevision = body.previousPlanVersionId !== undefined;
  let previousVersion: AnalysisPlanVersionRow | null = null;
  let nextOrdinal = 1;
  let supersedesVersionId: string | null = null;

  if (isRevision) {
    // Revision path: previous version must exist, be current, and have changes_requested gate
    if (!isUuidV4(body.previousPlanVersionId!)) {
      return failWith(db, claim.recordId, new ApplicationError("validation_failed", "previousPlanVersionId must be a valid UUID.", { fieldErrors: [{ fieldPath: "/previousPlanVersionId", code: "invalid_uuid", summary: "Must be a UUID v4" }] }));
    }
    previousVersion = getPlanVersionById(db, workspaceId, body.previousPlanVersionId!);
    if (!previousVersion) {
      return failWith(db, claim.recordId, new ApplicationError("resource_not_found", "Previous plan version not found."));
    }
    if (previousVersion.analysisProjectId !== projectId) {
      return failWith(db, claim.recordId, new ApplicationError("resource_not_found", "Previous plan version does not belong to this project."));
    }
    // Must be the current version
    if (proj.currentPlanVersionId !== previousVersion.analysisPlanVersionId) {
      return failWith(db, claim.recordId, new ApplicationError("invalid_state_transition", "Previous plan version is not the current version."));
    }
    // Must have a changes_requested gate decision
    const gateRow = db.prepare(
      `SELECT gate_decision_id FROM gate_decisions WHERE analysis_project_id = ? AND analysis_project_id IN (SELECT analysis_project_id FROM analysis_projects WHERE workspace_id = ?) AND gate_type = 'plan_confirmation' AND target_object_id = ? AND decision = 'changes_requested'`
    ).get(projectId, workspaceId, previousVersion.analysisPlanVersionId) as { gate_decision_id: string } | undefined;
    if (!gateRow) {
      return failWith(db, claim.recordId, new ApplicationError("invalid_state_transition", "Previous plan version does not have a changes_requested gate decision."));
    }
    // triggeringGateDecisionId is required on revision
    if (body.triggeringGateDecisionId === undefined) {
      return failWith(db, claim.recordId, new ApplicationError("validation_failed", "triggeringGateDecisionId is required for revision.", { fieldErrors: [{ fieldPath: "/triggeringGateDecisionId", code: "required", summary: "triggeringGateDecisionId is required when previousPlanVersionId is present" }] }));
    }
    if (!isUuidV4(body.triggeringGateDecisionId)) {
      return failWith(db, claim.recordId, new ApplicationError("validation_failed", "triggeringGateDecisionId must be a valid UUID.", { fieldErrors: [{ fieldPath: "/triggeringGateDecisionId", code: "invalid_uuid", summary: "Must be a UUID v4" }] }));
    }
    if (body.triggeringGateDecisionId !== gateRow.gate_decision_id) {
      return failWith(db, claim.recordId, new ApplicationError("invalid_state_transition", "triggeringGateDecisionId does not match the changes_requested gate decision."));
    }
    nextOrdinal = previousVersion.versionOrdinal + 1;
    supersedesVersionId = previousVersion.analysisPlanVersionId;
  } else {
    // First version: no existing current plan
    if (proj.currentPlanVersionId !== null) {
      return failWith(db, claim.recordId, new ApplicationError("invalid_state_transition", "A plan version already exists for this project. Use revision to generate a new version."));
    }
  }

  // 7. Call Engine handler
  const generationId = uuid();
  const startedAt = now();
  const engineRequest: EnginePortRequest = {
    version: ENGINE_PORT_VERSION,
    operation: "generateAnalysisPlan",
    operationId: uuid(),
    projectId,
    generationId,
    caller: "workcanger-backend",
    requestedAt: startedAt,
    inputHash: sha256HexBytes(new TextEncoder().encode(canonicalJsonStringify({
      projectId,
      requirementVersionId: proj.currentRequirementVersionId,
      targetSchemaVersion: PLAN_SCHEMA_VERSION,
      previousPlanVersionId: supersedesVersionId,
    }))),
    input: {
      requirementVersionId: proj.currentRequirementVersionId,
      targetSchemaVersion: PLAN_SCHEMA_VERSION,
    },
  };

  let engineResult: EnginePortResultEnvelope;
  try {
    engineResult = await engineHandler(engineRequest);
  } catch {
    return failWith(db, claim.recordId, new ApplicationError("engine_unavailable", "Analysis Engine is not available."));
  }

  // 8. Map engine outcome
  if (engineResult.outcome !== "succeeded") {
    const errorCode = engineResult.error?.code ?? "engine_unavailable";
    const errorSummary = mapEngineErrorCodeToSummary(errorCode);
    return failWith(db, claim.recordId, new ApplicationError(mapEngineErrorToApiCode(errorCode), errorSummary));
  }

  // 9. Extract and validate candidate from engine output
  const output = engineResult.output as Record<string, unknown> | undefined;
  if (!output || typeof output !== "object") {
    return failWith(db, claim.recordId, new ApplicationError("generation_output_invalid", "Engine output is not a valid object."));
  }

  // The engine returns a typed candidate envelope; extract the candidate
  const candidate = (output as Record<string, unknown>).candidate;
  let validatedContent: AnalysisPlanContent;
  try {
    validatedContent = validatePlanContent(candidate);
  } catch (err) {
    if (err instanceof ApplicationError) {
      return failWith(db, claim.recordId, err);
    }
    return failWith(db, claim.recordId, new ApplicationError("generation_output_invalid", "Plan candidate failed validation."));
  }

  // 10. Canonicalize, hash, write blob
  const canonicalBytes = new TextEncoder().encode(canonicalJsonStringify(validatedContent));
  const contentSha256 = sha256HexBytes(canonicalBytes);

  let blobResult: { storageRef: string; contentSha256: string };
  try {
    blobResult = writeCanonicalJsonBlob(layout.blobsDir, layout.tmpDir, validatedContent);
  } catch {
    return failWith(db, claim.recordId, new ApplicationError("storage_unavailable", "Plan content could not be published to secure storage."));
  }

  // 11. Atomic transaction: insert version + update current pointer
  const versionId = uuid();
  const ts = now();
  db.exec("BEGIN");
  try {
    db.prepare(
      `INSERT INTO analysis_plan_versions (
        analysis_plan_version_id, analysis_project_id, structured_requirement_version_id,
        version_ordinal, supersedes_version_id, schema_version, content_sha256,
        storage_ref, created_at, created_by_actor_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      versionId, projectId, proj.currentRequirementVersionId,
      nextOrdinal, supersedesVersionId, PLAN_SCHEMA_VERSION, contentSha256,
      blobResult.storageRef, ts, actorContext.actorId,
    );

    db.prepare(
      `UPDATE analysis_projects SET current_plan_version_id = ?, updated_at = ? WHERE analysis_project_id = ? AND workspace_id = ?`
    ).run(versionId, ts, projectId, workspaceId);

    recordSuccessInTx(db, claim.recordId, { httpStatus: 201, resultResourceType: "Plan", resultResourceId: versionId });
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    return failWith(db, claim.recordId, mapErr(err));
  }

  return {
    kind: "executed",
    httpStatus: 201,
    resultResourceType: "Plan",
    resultResourceId: versionId,
    recordId: claim.recordId,
    data: {
      analysisPlanVersionId: versionId,
      analysisProjectId: projectId,
      structuredRequirementVersionId: proj.currentRequirementVersionId,
      versionOrdinal: nextOrdinal,
      supersedesVersionId,
      schemaVersion: PLAN_SCHEMA_VERSION,
      contentSha256,
      createdAt: ts,
    },
  };
}

// ---------------------------------------------------------------------------
// plan.decide_confirmation
// ---------------------------------------------------------------------------

export type PlanDecision = "approved" | "changes_requested" | "rejected";

export interface PlanRequestedChange {
  readonly summary: string;
  readonly rationale: string | null;
  readonly affectedFieldPaths: readonly string[];
}

export interface DecidePlanConfirmationBody {
  readonly planVersionId: string;
  readonly targetSchemaVersion: string;
  readonly targetContentSha256: string;
  readonly decision: PlanDecision;
  readonly comment: string | null;
  readonly requestedChanges: readonly PlanRequestedChange[];
  readonly rejectionReason: string | null;
}

export interface DecidePlanConfirmationInput {
  readonly db: DatabaseSync;
  readonly layout: DataRootLayout;
  readonly workspaceId: string;
  readonly actorContext: TrustedActorContext;
  readonly idempotencyKey: string;
  readonly projectId: string;
  readonly body: DecidePlanConfirmationBody;
}

export interface PlanGateDecisionResult {
  readonly gateDecisionId: string;
  readonly analysisProjectId: string;
  readonly gateType: "plan_confirmation";
  readonly targetObjectType: "analysis_plan_version";
  readonly targetObjectId: string;
  readonly decision: PlanDecision;
  readonly decidedAt: string;
  readonly decidedByActorId: string;
  /** Present only when decision is approved (queued Run created atomically). */
  readonly queuedRun: {
    readonly analysisRunId: string;
    readonly runOrdinal: number;
    readonly currentAnalysisStage: string;
    readonly currentRunStatus: string;
    readonly queuedAt: string;
    readonly inputEvidenceCount: number;
    readonly firstRunEventId: string;
  } | null;
}

export function decidePlanConfirmation(input: DecidePlanConfirmationInput): CommandResult<PlanGateDecisionResult> {
  const { db, layout, workspaceId, actorContext, idempotencyKey, projectId, body } = input;

  // 1. Actor validation
  assertActiveHuman(actorContext);

  // 2. Idempotency claim FIRST (before business state checks to allow replays)
  const requestHash = computeRequestHash("POST", `/api/v1/projects/${projectId}/plans/${body.planVersionId}:decide-confirmation`, body);
  const claim = claimOn(db, { actorId: actorContext.actorId, commandType: "plan.decide_confirmation", idempotencyKey, requestHash });
  const pre = handleClaim(claim);
  if (pre) return pre;

  // 3. Project validation (after claim; business failures recorded via failWith)
  let proj;
  try {
    proj = requireProject(db, workspaceId, projectId);
  } catch (err) {
    if (err instanceof ApplicationError) return failWith(db, claim.recordId, err);
    throw err;
  }
  if (proj.projectStatus !== "active") {
    return failWith(db, claim.recordId, new ApplicationError("invalid_state_transition", "Cannot decide plan for a non-active project."));
  }

  // 4. Plan version validation
  if (!isUuidV4(body.planVersionId)) {
    return failWith(db, claim.recordId, new ApplicationError("validation_failed", "planVersionId must be a valid UUID.", { fieldErrors: [{ fieldPath: "/planVersionId", code: "invalid_uuid", summary: "Must be a UUID v4" }] }));
  }
  const planVersion = getPlanVersionById(db, workspaceId, body.planVersionId);
  if (!planVersion) {
    return failWith(db, claim.recordId, new ApplicationError("resource_not_found", "Plan version not found."));
  }
  if (planVersion.analysisProjectId !== projectId) {
    return failWith(db, claim.recordId, new ApplicationError("resource_not_found", "Plan version does not belong to this project."));
  }

  // 5. Must be the current version
  if (proj.currentPlanVersionId !== planVersion.analysisPlanVersionId) {
    return failWith(db, claim.recordId, new ApplicationError("invalid_state_transition", "Can only decide on the current plan version."));
  }

  // 6. Target identity/schema/hash validation
  if (body.targetSchemaVersion !== planVersion.schemaVersion) {
    return failWith(db, claim.recordId, new ApplicationError("content_hash_mismatch", "Target schema version does not match."));
  }
  if (body.targetContentSha256 !== planVersion.contentSha256) {
    return failWith(db, claim.recordId, new ApplicationError("content_hash_mismatch", "Target content hash does not match."));
  }

  // 7. Check no existing gate decision for this target
  const existingGate = db.prepare(
    `SELECT gate_decision_id FROM gate_decisions WHERE gate_type = 'plan_confirmation' AND target_object_type = 'analysis_plan_version' AND target_object_id = ? AND analysis_project_id IN (SELECT analysis_project_id FROM analysis_projects WHERE workspace_id = ?)`
  ).get(body.planVersionId, workspaceId) as { gate_decision_id: string } | undefined;
  if (existingGate) {
    return failWith(db, claim.recordId, new ApplicationError("gate_already_decided", "A gate decision already exists for this plan version."));
  }

  // 8. Decision condition validation
  try {
    validateDecisionConditions(body.decision, body.requestedChanges, body.rejectionReason);
  } catch (err) {
    if (err instanceof ApplicationError) {
      return failWith(db, claim.recordId, err);
    }
    throw err;
  }

  // 9. For approved: pre-validate run eligibility (re-validated inside the transaction)
  let planContent: AnalysisPlanContent | null = null;
  if (body.decision === "approved") {
    // Re-check Requirement current/approved
    if (proj.currentRequirementVersionId === null) {
      return failWith(db, claim.recordId, new ApplicationError("invalid_state_transition", "Cannot approve plan without an approved current requirement."));
    }
    const reqGateRow = db.prepare(
      `SELECT gate_decision_id FROM gate_decisions WHERE analysis_project_id = ? AND analysis_project_id IN (SELECT analysis_project_id FROM analysis_projects WHERE workspace_id = ?) AND gate_type = 'requirement_confirmation' AND target_object_id = ? AND decision = 'approved'`
    ).get(projectId, workspaceId, proj.currentRequirementVersionId) as { gate_decision_id: string } | undefined;
    if (!reqGateRow) {
      return failWith(db, claim.recordId, new ApplicationError("invalid_state_transition", "Current requirement has not been approved."));
    }
    // No active run
    if (countActiveRuns(db, workspaceId, projectId) > 0) {
      return failWith(db, claim.recordId, new ApplicationError("active_run_exists", "An active run already exists for this project."));
    }
    // Read plan content to determine first step
    try {
      planContent = readPlanContent(layout, planVersion);
    } catch {
      return failWith(db, claim.recordId, new ApplicationError("storage_unavailable", "Plan content could not be loaded for run admission."));
    }
    // Admissible submitted Evidence
    const admissible = collectAdmissibleEvidence(db, workspaceId, projectId);
    if (admissible.length === 0) {
      return failWith(db, claim.recordId, new ApplicationError("unsafe_evidence", "No admissible controlled or derived evidence is available for the run."));
    }
  }

  // 10. Get actor display name snapshot
  const actor = getActorById(db, actorContext.actorId);
  const actorDisplayName = actor?.displayName ?? "Unknown";

  // 11. Build requestedChangesJson with Backend-assigned UUIDs
  const requestedChangesJson = body.requestedChanges.map((rc) => ({
    requestedChangeId: uuid(),
    summary: rc.summary,
    rationale: rc.rationale,
    affectedFieldPaths: rc.affectedFieldPaths,
  }));

  // 12. Atomic transaction
  const gateId = uuid();
  const ts = now();
  db.exec("BEGIN");
  try {
    // Re-validate Project active/not archived inside the transaction
    const projNow = db.prepare(`SELECT project_status, archived_at, current_plan_version_id, current_requirement_version_id FROM analysis_projects WHERE analysis_project_id = ? AND workspace_id = ?`).get(projectId, workspaceId) as {
      project_status: string; archived_at: string | null; current_plan_version_id: string | null; current_requirement_version_id: string | null;
    };
    if (projNow.project_status !== "active") throw new ApplicationError("invalid_state_transition", "Project is no longer active.");
    if (projNow.archived_at !== null) throw new ApplicationError("invalid_state_transition", "Project is archived.");
    if (projNow.current_plan_version_id !== body.planVersionId) throw new ApplicationError("invalid_state_transition", "Plan is no longer the current version.");

    // Insert gate decision
    db.prepare(
      `INSERT INTO gate_decisions (
        gate_decision_id, analysis_project_id, gate_type, target_object_type,
        target_object_id, target_schema_version, target_content_sha256,
        decision, decided_at, decided_by_actor_id, actor_display_name_snapshot,
        comment, requested_changes_json, rejection_reason, submitted_via, client_version
      ) VALUES (?, ?, 'plan_confirmation', 'analysis_plan_version', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      gateId, projectId, body.planVersionId,
      body.targetSchemaVersion, body.targetContentSha256,
      body.decision, ts, actorContext.actorId, actorDisplayName,
      body.comment, JSON.stringify(requestedChangesJson),
      body.rejectionReason, actorContext.submittedVia, actorContext.clientVersion,
    );

    let queuedRun: PlanGateDecisionResult["queuedRun"] = null;

    if (body.decision === "approved") {
      queuedRun = createQueuedRunInTx(db, workspaceId, projectId, body.planVersionId, planVersion.structuredRequirementVersionId, gateId, ts, actorContext.actorId, planContent!);
    }

    // Record idempotency success: approved -> Run (meaningful new artifact);
    // changes_requested/rejected -> Gate.
    const resultResourceType = body.decision === "approved" ? "Run" : "Gate";
    const resultResourceId = body.decision === "approved" ? queuedRun!.analysisRunId : gateId;
    recordSuccessInTx(db, claim.recordId, { httpStatus: 201, resultResourceType, resultResourceId });
    db.exec("COMMIT");

    return {
      kind: "executed",
      httpStatus: 201,
      resultResourceType,
      resultResourceId,
      recordId: claim.recordId,
      data: {
        gateDecisionId: gateId,
        analysisProjectId: projectId,
        gateType: "plan_confirmation",
        targetObjectType: "analysis_plan_version",
        targetObjectId: body.planVersionId,
        decision: body.decision,
        decidedAt: ts,
        decidedByActorId: actorContext.actorId,
        queuedRun,
      },
    };
  } catch (err) {
    db.exec("ROLLBACK");
    if (err instanceof ApplicationError) {
      return failWith(db, claim.recordId, err);
    }
    return failWith(db, claim.recordId, mapErr(err));
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface AdmissibleEvidence {
  readonly evidenceArtifactId: string;
  readonly safetyClass: string;
  readonly visibility: string;
}

/** Collect submitted Evidence that is safe to admit into a Run.
 * Fail-closed: only admit evidence with safety_class 'controlled' or 'derived'
 * and visibility 'user_visible' or 'review_only' (not system_only).
 * Unknown safety classes are rejected. */
export function collectAdmissibleEvidence(db: DatabaseSync, workspaceId: string, projectId: string): AdmissibleEvidence[] {
  const wsScope = `AND analysis_project_id IN (SELECT analysis_project_id FROM analysis_projects WHERE workspace_id = ?)`;
  const requestRow = db.prepare(
    `SELECT submitted_context_evidence_ids_json FROM analysis_requests WHERE analysis_project_id = ? ${wsScope}`
  ).get(projectId, workspaceId) as { submitted_context_evidence_ids_json: string } | undefined;
  if (!requestRow) return [];
  let submittedIds: string[] = [];
  try {
    submittedIds = JSON.parse(requestRow.submitted_context_evidence_ids_json);
  } catch {
    return [];
  }
  if (!Array.isArray(submittedIds) || submittedIds.length === 0) return [];
  const placeholders = submittedIds.map(() => "?").join(",");
  const rows = db.prepare(
    `SELECT evidence_artifact_id, safety_class, visibility
     FROM evidence_artifacts WHERE evidence_artifact_id IN (${placeholders}) ${wsScope}`
  ).all(...submittedIds, workspaceId) as Array<{ evidence_artifact_id: string; safety_class: string; visibility: string }>;
  // Preserve submitted order; fail-closed: only admit controlled/derived (not restricted_raw or unknown)
  // and not system_only visibility.
  const ADMISSIBLE_SAFETY = new Set(["controlled", "derived"]);
  const map = new Map(rows.map(r => [r.evidence_artifact_id, r]));
  const result: AdmissibleEvidence[] = [];
  for (const id of submittedIds) {
    const r = map.get(id);
    if (!r) continue;
    if (r.visibility === "system_only") continue;
    if (!ADMISSIBLE_SAFETY.has(r.safety_class)) continue;
    result.push({ evidenceArtifactId: r.evidence_artifact_id, safetyClass: r.safety_class, visibility: r.visibility });
  }
  return result;
}

/** Read and parse Plan content from blob. Throws on I/O or parse failure. */
function readPlanContent(layout: DataRootLayout, planVersion: AnalysisPlanVersionRow): AnalysisPlanContent {
  const contentBytes = readBlob(layout.blobsDir, planVersion.storageRef);
  const contentJson = new TextDecoder().decode(contentBytes);
  const raw = JSON.parse(contentJson);
  return validatePlanContent(raw);
}

/**
 * Create the queued Run + RunInputEvidence + run_queued RunEvent inside the
 * caller's transaction. All preconditions are re-validated against the
 * transaction's view. Throws ApplicationError on any failure so the caller's
 * transaction rolls back, leaving no approved Gate or partial Run.
 */
function createQueuedRunInTx(
  db: DatabaseSync,
  workspaceId: string,
  projectId: string,
  planVersionId: string,
  planRequirementVersionId: string,
  gateId: string,
  ts: string,
  triggeredByActorId: string,
  planContent: AnalysisPlanContent,
): NonNullable<PlanGateDecisionResult["queuedRun"]> {
  const wsScope = `AND analysis_project_id IN (SELECT analysis_project_id FROM analysis_projects WHERE workspace_id = ?)`;
  // Re-validate Requirement current/approved inside transaction
  const projNow = db.prepare(
    `SELECT current_requirement_version_id FROM analysis_projects WHERE analysis_project_id = ? AND workspace_id = ?`
  ).get(projectId, workspaceId) as { current_requirement_version_id: string | null };
  if (projNow.current_requirement_version_id === null) {
    throw new ApplicationError("invalid_state_transition", "Requirement is no longer available.");
  }
  // Fix 3: The Plan's bound Requirement must still be the current Requirement.
  // If the Requirement was revised after the Plan was generated, the Plan is stale
  // and must not queue a Run.
  if (projNow.current_requirement_version_id !== planRequirementVersionId) {
    throw new ApplicationError("invalid_state_transition", "Plan is bound to a requirement version that is no longer current.");
  }
  const reqGateNow = db.prepare(
    `SELECT gate_decision_id FROM gate_decisions WHERE analysis_project_id = ? ${wsScope} AND gate_type = 'requirement_confirmation' AND target_object_id = ? AND decision = 'approved'`
  ).get(projectId, workspaceId, projNow.current_requirement_version_id) as { gate_decision_id: string } | undefined;
  if (!reqGateNow) throw new ApplicationError("invalid_state_transition", "Current requirement is no longer approved.");

  // Re-validate no active run inside transaction (single-active partial unique index)
  const activeRunCount = (db.prepare(
    `SELECT COUNT(*) AS c FROM analysis_runs WHERE analysis_project_id = ? ${wsScope} AND current_run_status IN ('queued', 'running')`
  ).get(projectId, workspaceId) as { c: number }).c;
  if (activeRunCount > 0) throw new ApplicationError("active_run_exists", "An active run already exists for this project.");

  // Re-validate admissible Evidence inside transaction (fresh read)
  const admittedNow = collectAdmissibleEvidence(db, workspaceId, projectId);
  if (admittedNow.length === 0) throw new ApplicationError("unsafe_evidence", "No admissible controlled or derived evidence is available for the run.");

  // Determine next run ordinal
  const maxOrdinalRow = db.prepare(
    `SELECT COALESCE(MAX(run_ordinal), 0) AS max_ord FROM analysis_runs WHERE analysis_project_id = ? ${wsScope}`
  ).get(projectId, workspaceId) as { max_ord: number };
  const nextRunOrdinal = maxOrdinalRow.max_ord + 1;

  // Create queued Run (schema v1: current_analysis_stage='S2.1', current_run_status='queued')
  const runId = uuid();
  const firstPlanStepId = planContent.steps[0]!.planStepId;
  db.prepare(
    `INSERT INTO analysis_runs (
      analysis_run_id, analysis_project_id, analysis_plan_version_id,
      run_ordinal, predecessor_run_id, run_relation_type, triggering_gate_decision_id,
      current_analysis_stage, current_run_status, queued_at, started_at, ended_at,
      terminal_reason_code, terminal_summary, pi_session_ref, triggered_by_actor_id
    ) VALUES (?, ?, ?, ?, NULL, NULL, ?, 'S2.1', 'queued', ?, NULL, NULL, NULL, NULL, NULL, ?)`
  ).run(runId, projectId, planVersionId, nextRunOrdinal, gateId, ts, triggeredByActorId);

  // Create RunInputEvidence for each admissible evidence (plan_input role, bound to first step)
  for (let i = 0; i < admittedNow.length; i++) {
    const ev = admittedNow[i]!;
    db.prepare(
      `INSERT INTO analysis_run_input_evidence (
        analysis_run_id, evidence_artifact_id, input_role, input_ordinal, plan_step_id, admitted_at
      ) VALUES (?, ?, 'plan_input', ?, ?, ?)`
    ).run(runId, ev.evidenceArtifactId, i + 1, firstPlanStepId, ts);
  }

  // Create first run_queued RunEvent (sequence=1, payload schema workcanger.run-event.run_queued/1.0)
  const runEventId = uuid();
  const runQueuedPayload = {
    inputEvidenceCount: admittedNow.length,
    queueCause: "initial",
  };
  db.prepare(
    `INSERT INTO run_events (
      run_event_id, analysis_run_id, sequence, event_type,
      analysis_stage_after, run_status_after,
      occurred_at, recorded_at, producer_name, producer_version, producer_event_id,
      payload_schema_version, payload_json, raw_diagnostic_artifact_id
    ) VALUES (?, ?, 1, 'run_queued', 'S2.1', 'queued', ?, ?, 'workcanger-backend', NULL, NULL, ?, ?, NULL)`
  ).run(
    runEventId, runId, ts, ts,
    runEventSchemaVersion("run_queued"),
    JSON.stringify(runQueuedPayload),
  );

  return {
    analysisRunId: runId,
    runOrdinal: nextRunOrdinal,
    currentAnalysisStage: "S2.1",
    currentRunStatus: "queued",
    queuedAt: ts,
    inputEvidenceCount: admittedNow.length,
    firstRunEventId: runEventId,
  };
}

function validateDecisionConditions(
  decision: PlanDecision,
  requestedChanges: readonly PlanRequestedChange[],
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
        if (typeof rc.affectedFieldPaths[j] !== "string" || !rc.affectedFieldPaths[j].startsWith("/")) {
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
