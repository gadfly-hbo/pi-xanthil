/**
 * Requirement service tests (§6.3, API-045/API-046).
 *
 * Coverage:
 * - happy path: Project + Evidence + Request → Requirement generation → version + blob + current pointer + idempotency
 * - idempotency: same key/same hash replay; same key/different body conflict
 * - validation fail closed: no request, project archived/cancelled, stale pointer, existing pending, invalid engine output, engine failed/timed_out
 * - revision path: changes_requested gate → next version; non-changes_requested or stale previous forbidden
 * - requirement decision: approved/changes_requested/rejected conditions; same target rejected; only current version
 * - RequirementReviewReadModel: current/historical versions, content, gate, commands, no storageRef leak
 * - security: engine candidate with prompt/token/path → safe error
 */
import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createMigratedDb } from "./application-helpers.ts";
import { bootstrapSystemActor, setupLocalHuman, getHumanActor } from "../application/actors/actor-service.ts";
import { createProject } from "../application/projects/project-service.ts";
import { submitAnalysisRequest } from "../application/requests/request-service.ts";
import { generateRequirement, decideRequirementConfirmation, getRequirementVersionById } from "../application/requirements/requirement-service.ts";
import { queryRequirementReview } from "../application/read-models/requirement-review.ts";
import type { TrustedActorContext } from "../application/shared/runtime.ts";
import type { WorkspaceExistencePort } from "../contracts/workspace-port.ts";
import type { DatabaseSync } from "node:sqlite";
import type { DataRootLayout } from "../persistence/data-root.ts";
import type { EnginePortRequest, EnginePortResultEnvelope } from "../contracts/engine-port.ts";
import { ENGINE_PORT_VERSION } from "../contracts/registries.ts";

let db: DatabaseSync;
let layout: DataRootLayout;
let cleanup: () => void;
let humanCtx: TrustedActorContext;
let humanId: string;
let workspaceId: string;
let workspacePort: WorkspaceExistencePort;
let projectId: string;

async function setup() {
  const env = await createMigratedDb();
  workspaceId = env.workspaceId;
  workspacePort = env.workspacePort;
  db = env.db;
  layout = env.layout;
  cleanup = env.cleanup;
  const sys = bootstrapSystemActor(db);
  const sysCtx: TrustedActorContext = { actorId: sys.auditActorId, actorKind: "system", submittedVia: "local_api", clientVersion: null, active: true };
  setupLocalHuman({ db, actorContext: sysCtx, idempotencyKey: randomUUID(), body: { displayName: "Test User", actorKey: "testuser" } });
  const human = getHumanActor(db)!;
  humanId = human.auditActorId;
  humanCtx = { actorId: human.auditActorId, actorKind: "human", submittedVia: "web_ui", clientVersion: null, active: true };

  // Create a project
  const projRes = createProject({ db, workspacePort, workspaceId, actorContext: humanCtx, idempotencyKey: randomUUID(), body: { title: "Test Project", slug: "test-req-" + randomUUID().slice(0, 8) } });
  if (projRes.kind !== "executed") throw new Error("project creation failed");
  projectId = projRes.resultResourceId;

  // Upload evidence and submit request (deferred FK for circular reference)
  const sourceId = randomUUID();
  const evidenceId = randomUUID();
  const evidenceTs = new Date().toISOString();
  db.exec("BEGIN");
  db.prepare(`INSERT INTO source_references (
    source_reference_id, analysis_project_id, source_kind, display_name, description,
    initial_evidence_artifact_id, declared_data_scope, usage_constraints_json, safety_handling_policy, created_at, created_by_actor_id
  ) VALUES (?, ?, 'user_provided', 'Test Source', 'Test', ?, 'input', '[]', 'local_transform_required', ?, ?)`).run(sourceId, projectId, evidenceId, evidenceTs, humanId);
  db.prepare(`INSERT INTO evidence_artifacts (
    evidence_artifact_id, analysis_project_id, source_reference_id, origin_kind, artifact_kind,
    display_name, storage_ref, content_sha256, media_type, byte_size,
    safety_class, visibility, created_at, created_by_actor_id
  ) VALUES (?, ?, ?, 'user_provided', 'input_material', 'Test Evidence', 'blobs/00/0000000000000000000000000000000000000000000000000000000000000000', 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855', 'text/plain', 0, 'controlled', 'user_visible', ?, ?)`).run(evidenceId, projectId, sourceId, evidenceTs, humanId);
  db.exec("COMMIT");

  submitAnalysisRequest({
    db, workspaceId, actorContext: humanCtx, idempotencyKey: randomUUID(), projectId,
    body: { rawRequestText: "Analyze daily sales trends", contextEvidenceArtifactIds: [evidenceId], locale: "en-US", timezone: "America/New_York" },
    submittedVia: "web_ui", clientVersion: null,
  });
}

function makeFakeEngineHandler(scenario: "happy" | "spawn_failed" | "execution_failed" | "malformed_json" | "invalid_candidate" = "happy") {
  return async (request: EnginePortRequest): Promise<EnginePortResultEnvelope> => {
    const now = new Date().toISOString();
    if (scenario === "spawn_failed") {
      return { version: ENGINE_PORT_VERSION, operation: request.operation, operationId: request.operationId, projectId: request.projectId, generationId: request.generationId, startedAt: now, completedAt: now, outcome: "failed", error: { code: "pi_spawn_failed", summary: "Failed to spawn pi-agent process." } };
    }
    if (scenario === "execution_failed") {
      return { version: ENGINE_PORT_VERSION, operation: request.operation, operationId: request.operationId, projectId: request.projectId, generationId: request.generationId, startedAt: now, completedAt: now, outcome: "failed", error: { code: "pi_execution_failed", summary: "pi-agent execution did not complete successfully." } };
    }
    if (scenario === "malformed_json") {
      return { version: ENGINE_PORT_VERSION, operation: request.operation, operationId: request.operationId, projectId: request.projectId, generationId: request.generationId, startedAt: now, completedAt: now, outcome: "succeeded", output: "not valid json" };
    }
    if (scenario === "invalid_candidate") {
      return { version: ENGINE_PORT_VERSION, operation: request.operation, operationId: request.operationId, projectId: request.projectId, generationId: request.generationId, startedAt: now, completedAt: now, outcome: "succeeded", output: { invalid: "structure" } };
    }
    // happy path - return valid requirement candidate
    return { version: ENGINE_PORT_VERSION, operation: request.operation, operationId: request.operationId, projectId: request.projectId, generationId: request.generationId, startedAt: now, completedAt: now, outcome: "succeeded", output: { candidate: { businessQuestion: "What are the daily sales trends?", scope: { inScope: ["daily sales", "trends"], outOfScope: ["weekly", "monthly"] }, acceptanceCriteria: ["Clear trend identification"] } } };
  };
}

function makeInjectionEngineHandler(output: unknown, outcome: "succeeded" | "failed" = "succeeded") {
  return async (request: EnginePortRequest): Promise<EnginePortResultEnvelope> => {
    if (outcome === "failed") {
      return {
        version: ENGINE_PORT_VERSION,
        operation: request.operation,
        operationId: request.operationId,
        projectId: request.projectId,
        generationId: request.generationId,
        startedAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
        outcome: "failed",
        error: { code: "pi_execution_failed", summary: "pi-agent execution did not complete successfully." },
      };
    }
    return {
      version: ENGINE_PORT_VERSION,
      operation: request.operation,
      operationId: request.operationId,
      projectId: request.projectId,
      generationId: request.generationId,
      startedAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
      outcome: "succeeded",
      output,
    };
  };
}

describe("requirement.generate", () => {
  beforeEach(setup);
  afterEach(() => cleanup());

  test("happy path: generates requirement version with blob and current pointer", async () => {
    const engineHandler = makeFakeEngineHandler("happy");
    const result = await generateRequirement({
      db, layout, workspaceId, actorContext: humanCtx, idempotencyKey: randomUUID(),
      projectId, body: {}, engineHandler,
    });
    if (result.kind === "failed") console.log("FAILED:", result.errorCode, result.errorSummary);
    assert.equal(result.kind, "executed");
    assert.equal(result.httpStatus, 201);
    assert.equal(result.resultResourceType, "Requirement");
    if (result.kind === "executed") {
      const data = result.data;
      assert.ok(data.structuredRequirementVersionId);
      assert.equal(data.analysisProjectId, projectId);
      assert.ok(data.analysisRequestId);
      assert.equal(data.versionOrdinal, 1);
      assert.equal(data.supersedesVersionId, null);
      assert.equal(data.schemaVersion, "1.0");
      assert.ok(data.contentSha256);
      assert.ok(data.createdAt);

      // Verify blob exists
      const version = getRequirementVersionById(db, workspaceId, data.structuredRequirementVersionId);
      assert.ok(version);
      assert.ok(version.storageRef);

      // Verify current pointer updated
      const proj = db.prepare("SELECT current_requirement_version_id FROM analysis_projects WHERE analysis_project_id = ?").get(projectId) as { current_requirement_version_id: string | null };
      assert.equal(proj.current_requirement_version_id, data.structuredRequirementVersionId);
    }
  });

  test("idempotency: same key/same hash replays without re-calling engine", async () => {
    const callCount = { value: 0 };
    const engineHandler = async (request: EnginePortRequest): Promise<EnginePortResultEnvelope> => {
      callCount.value++;
      const now = new Date().toISOString();
      return { version: ENGINE_PORT_VERSION, operation: request.operation, operationId: request.operationId, projectId: request.projectId, generationId: request.generationId, startedAt: now, completedAt: now, outcome: "succeeded", output: { candidate: { businessQuestion: "What are the daily sales trends?", scope: { inScope: ["daily sales", "trends"], outOfScope: ["weekly", "monthly"] }, acceptanceCriteria: ["Clear trend identification"] } } };
    };
    const key = randomUUID();
    const body = {};
    const input = { db, layout, workspaceId, actorContext: humanCtx, idempotencyKey: key, projectId, body, engineHandler };
    const r1 = await generateRequirement(input);
    assert.equal(r1.kind, "executed");
    const callsAfterFirst = callCount.value;
    const r2 = await generateRequirement(input);
    assert.equal(r2.kind, "replayed_success");
    assert.equal(callCount.value, callsAfterFirst, "Engine should not be called again on replay");
  });

  test("idempotency: same key/different body returns conflict", async () => {
    const engineHandler = makeFakeEngineHandler("happy");
    const key = randomUUID();
    const r1 = await generateRequirement({ db, layout, workspaceId, actorContext: humanCtx, idempotencyKey: key, projectId, body: {}, engineHandler });
    assert.equal(r1.kind, "executed");
    const r2 = await generateRequirement({ db, layout, workspaceId, actorContext: humanCtx, idempotencyKey: key, projectId, body: { previousRequirementVersionId: randomUUID() }, engineHandler });
    assert.equal(r2.kind, "conflict");
  });

  test("fail closed: no analysis request", async () => {
    // Create a second project without request
    const p2 = createProject({ db, workspacePort, workspaceId, actorContext: humanCtx, idempotencyKey: randomUUID(), body: { title: "No Request", slug: "no-req-" + randomUUID().slice(0, 8) } });
    if (p2.kind !== "executed") throw new Error("failed");
    const engineHandler = makeFakeEngineHandler("happy");
    const result = await generateRequirement({ db, layout, workspaceId, actorContext: humanCtx, idempotencyKey: randomUUID(), projectId: p2.resultResourceId, body: {}, engineHandler });
    assert.equal(result.kind, "failed");
    if (result.kind === "failed") {
      assert.equal(result.errorCode, "invalid_state_transition");
    }
  });

  test("fail closed: project archived", async () => {
    db.prepare("UPDATE analysis_projects SET archived_at = ? WHERE analysis_project_id = ?").run(new Date().toISOString(), projectId);
    const engineHandler = makeFakeEngineHandler("happy");
    const result = await generateRequirement({ db, layout, workspaceId, actorContext: humanCtx, idempotencyKey: randomUUID(), projectId, body: {}, engineHandler });
    assert.equal(result.kind, "failed");
    if (result.kind === "failed") {
      assert.equal(result.errorCode, "invalid_state_transition");
    }
  });

  test("fail closed: project cancelled", async () => {
    db.prepare("UPDATE analysis_projects SET project_status = 'cancelled', cancelled_at = ? WHERE analysis_project_id = ?").run(new Date().toISOString(), projectId);
    const engineHandler = makeFakeEngineHandler("happy");
    const result = await generateRequirement({ db, layout, workspaceId, actorContext: humanCtx, idempotencyKey: randomUUID(), projectId, body: {}, engineHandler });
    assert.equal(result.kind, "failed");
    if (result.kind === "failed") {
      assert.equal(result.errorCode, "invalid_state_transition");
    }
  });

  test("fail closed: existing pending requirement blocks first version", async () => {
    const engineHandler = makeFakeEngineHandler("happy");
    const r1 = await generateRequirement({ db, layout, workspaceId, actorContext: humanCtx, idempotencyKey: randomUUID(), projectId, body: {}, engineHandler });
    assert.equal(r1.kind, "executed");
    const r2 = await generateRequirement({ db, layout, workspaceId, actorContext: humanCtx, idempotencyKey: randomUUID(), projectId, body: {}, engineHandler });
    assert.equal(r2.kind, "failed");
    if (r2.kind === "failed") {
      assert.equal(r2.errorCode, "invalid_state_transition");
    }
  });

  test("fail closed: engine failed", async () => {
    const engineHandler = makeFakeEngineHandler("execution_failed");
    const result = await generateRequirement({ db, layout, workspaceId, actorContext: humanCtx, idempotencyKey: randomUUID(), projectId, body: {}, engineHandler });
    assert.equal(result.kind, "failed");
    if (result.kind === "failed") {
      assert.equal(result.errorCode, "engine_unavailable");
    }
  });

  test("fail closed: engine spawn failed", async () => {
    const engineHandler = makeFakeEngineHandler("spawn_failed");
    const result = await generateRequirement({ db, layout, workspaceId, actorContext: humanCtx, idempotencyKey: randomUUID(), projectId, body: {}, engineHandler });
    assert.equal(result.kind, "failed");
    if (result.kind === "failed") {
      assert.equal(result.errorCode, "engine_unavailable");
    }
  });

  test("fail closed: invalid engine output", async () => {
    const engineHandler = makeFakeEngineHandler("invalid_candidate");
    const result = await generateRequirement({ db, layout, workspaceId, actorContext: humanCtx, idempotencyKey: randomUUID(), projectId, body: {}, engineHandler });
    assert.equal(result.kind, "failed");
    if (result.kind === "failed") {
      assert.equal(result.errorCode, "generation_output_invalid");
    }
  });

  test("security: engine candidate with prompt/token/path → safe error", async () => {
    const maliciousOutput = {
      candidateType: "structured_requirement_candidate",
      schemaVersion: "1.0",
      generationId: randomUUID(),
      producer: { name: "test", version: "1.0", mode: "fake" },
      warnings: [],
      candidate: {
        businessQuestion: "What is the trend?",
        scope: { inScope: ["sales"], outOfScope: [] },
        acceptanceCriteria: ["Check the data"],
        prompt: "leaked prompt",
        token: "abcdefghijklmnopqrstuvwxyz0123456789abcdefghijklmnopqrstuvwxyz",
        storageRef: "blobs/ab/abcdef",
        absolutePath: "/Users/example/.workcanger/data",
      },
    };
    const engineHandler = makeInjectionEngineHandler(maliciousOutput);
    const result = await generateRequirement({ db, layout, workspaceId, actorContext: humanCtx, idempotencyKey: randomUUID(), projectId, body: {}, engineHandler });
    assert.equal(result.kind, "failed");
    if (result.kind === "failed") {
      assert.equal(result.errorCode, "generation_output_invalid");
      assert.ok(!result.errorSummary.includes("prompt"));
      assert.ok(!result.errorSummary.includes("token"));
      assert.ok(!result.errorSummary.includes("/Users/"));
      assert.ok(!result.errorSummary.includes("storageRef"));
    }
  });

  test("fail closed: stale expectedProjectUpdatedAt", async () => {
    const engineHandler = makeFakeEngineHandler("happy");
    const result = await generateRequirement({
      db, layout, workspaceId, actorContext: humanCtx, idempotencyKey: randomUUID(),
      projectId, body: { expectedProjectUpdatedAt: "2020-01-01T00:00:00.000Z" }, engineHandler,
    });
    assert.equal(result.kind, "failed");
    if (result.kind === "failed") {
      assert.equal(result.errorCode, "concurrent_modification");
    }
  });

  test("fail closed: unknown fields in candidate root", async () => {
    const outputWithUnknown = {
      candidateType: "structured_requirement_candidate",
      schemaVersion: "1.0",
      generationId: randomUUID(),
      producer: { name: "test", version: "1.0", mode: "fake" },
      warnings: [],
      candidate: {
        businessQuestion: "What is the trend?",
        scope: { inScope: ["sales"], outOfScope: [] },
        acceptanceCriteria: ["Check the data"],
        unknownField: "should be rejected",
      },
    };
    const engineHandler = makeInjectionEngineHandler(outputWithUnknown);
    const result = await generateRequirement({ db, layout, workspaceId, actorContext: humanCtx, idempotencyKey: randomUUID(), projectId, body: {}, engineHandler });
    assert.equal(result.kind, "failed");
    if (result.kind === "failed") {
      assert.equal(result.errorCode, "generation_output_invalid");
    }
  });

  test("fail closed: unknown fields in candidate scope", async () => {
    const outputWithUnknownScope = {
      candidateType: "structured_requirement_candidate",
      schemaVersion: "1.0",
      generationId: randomUUID(),
      producer: { name: "test", version: "1.0", mode: "fake" },
      warnings: [],
      candidate: {
        businessQuestion: "What is the trend?",
        scope: { inScope: ["sales"], outOfScope: [], extraField: "bad" },
        acceptanceCriteria: ["Check the data"],
      },
    };
    const engineHandler = makeInjectionEngineHandler(outputWithUnknownScope);
    const result = await generateRequirement({ db, layout, workspaceId, actorContext: humanCtx, idempotencyKey: randomUUID(), projectId, body: {}, engineHandler });
    assert.equal(result.kind, "failed");
    if (result.kind === "failed") {
      assert.equal(result.errorCode, "generation_output_invalid");
    }
  });
});

describe("requirement.decide_confirmation", () => {
  beforeEach(setup);
  afterEach(() => cleanup());

  let reqVersionId: string;
  let reqContentSha256: string;

  async function generateFirstRequirement() {
    const engineHandler = makeFakeEngineHandler("happy");
    const result = await generateRequirement({ db, layout, workspaceId, actorContext: humanCtx, idempotencyKey: randomUUID(), projectId, body: {}, engineHandler });
    if (result.kind !== "executed") throw new Error("generate failed");
    reqVersionId = result.data.structuredRequirementVersionId;
    reqContentSha256 = result.data.contentSha256;
  }

  test("happy path: approved decision", async () => {
    await generateFirstRequirement();
    const result = decideRequirementConfirmation({
      db, workspaceId, actorContext: humanCtx, idempotencyKey: randomUUID(), projectId,
      body: {
        requirementVersionId: reqVersionId,
        targetSchemaVersion: "1.0",
        targetContentSha256: reqContentSha256,
        decision: "approved",
        comment: "Looks good",
        requestedChanges: [],
        rejectionReason: null,
      },
    });
    assert.equal(result.kind, "executed");
    assert.equal(result.httpStatus, 201);
    if (result.kind === "executed") {
      assert.equal(result.data.decision, "approved");
      assert.equal(result.data.gateType, "requirement_confirmation");
    }
  });

  test("happy path: changes_requested decision", async () => {
    await generateFirstRequirement();
    const result = decideRequirementConfirmation({
      db, workspaceId, actorContext: humanCtx, idempotencyKey: randomUUID(), projectId,
      body: {
        requirementVersionId: reqVersionId,
        targetSchemaVersion: "1.0",
        targetContentSha256: reqContentSha256,
        decision: "changes_requested",
        comment: null,
        requestedChanges: [{ summary: "Need more detail", rationale: "Too vague", affectedFieldPaths: ["/scope"] }],
        rejectionReason: null,
      },
    });
    assert.equal(result.kind, "executed");
    if (result.kind === "executed") {
      assert.equal(result.data.decision, "changes_requested");
    }
  });

  test("happy path: rejected decision", async () => {
    await generateFirstRequirement();
    const result = decideRequirementConfirmation({
      db, workspaceId, actorContext: humanCtx, idempotencyKey: randomUUID(), projectId,
      body: {
        requirementVersionId: reqVersionId,
        targetSchemaVersion: "1.0",
        targetContentSha256: reqContentSha256,
        decision: "rejected",
        comment: null,
        requestedChanges: [],
        rejectionReason: "Out of scope for this quarter",
      },
    });
    assert.equal(result.kind, "executed");
    if (result.kind === "executed") {
      assert.equal(result.data.decision, "rejected");
    }
  });

  test("fail closed: same target already decided", async () => {
    await generateFirstRequirement();
    const key1 = randomUUID();
    const r1 = decideRequirementConfirmation({
      db, workspaceId, actorContext: humanCtx, idempotencyKey: key1, projectId,
      body: {
        requirementVersionId: reqVersionId,
        targetSchemaVersion: "1.0",
        targetContentSha256: reqContentSha256,
        decision: "approved",
        comment: null,
        requestedChanges: [],
        rejectionReason: null,
      },
    });
    assert.equal(r1.kind, "executed");
    const r2 = decideRequirementConfirmation({
      db, workspaceId, actorContext: humanCtx, idempotencyKey: randomUUID(), projectId,
      body: {
        requirementVersionId: reqVersionId,
        targetSchemaVersion: "1.0",
        targetContentSha256: reqContentSha256,
        decision: "approved",
        comment: null,
        requestedChanges: [],
        rejectionReason: null,
      },
    });
    assert.equal(r2.kind, "failed");
    if (r2.kind === "failed") {
      assert.equal(r2.errorCode, "gate_already_decided");
    }
  });

  test("fail closed: can only decide current version", async () => {
    // Generate first requirement and request changes
    await generateFirstRequirement();
    const gateResult = decideRequirementConfirmation({
      db, workspaceId, actorContext: humanCtx, idempotencyKey: randomUUID(), projectId,
      body: {
        requirementVersionId: reqVersionId,
        targetSchemaVersion: "1.0",
        targetContentSha256: reqContentSha256,
        decision: "changes_requested",
        comment: null,
        requestedChanges: [{ summary: "Change needed", rationale: null, affectedFieldPaths: ["/scope"] }],
        rejectionReason: null,
      },
    });
    if (gateResult.kind !== "executed") throw new Error("gate decision failed");
    const gateId = gateResult.data.gateDecisionId;

    // Generate second requirement
    const engineHandler = makeFakeEngineHandler("happy");
    const r2 = await generateRequirement({
      db, layout, workspaceId, actorContext: humanCtx, idempotencyKey: randomUUID(), projectId,
      body: { previousRequirementVersionId: reqVersionId, triggeringGateDecisionId: gateId }, engineHandler,
    });
    if (r2.kind !== "executed") throw new Error("second generate failed");

    // Try to decide the old version (now not current)
    const r3 = decideRequirementConfirmation({
      db, workspaceId, actorContext: humanCtx, idempotencyKey: randomUUID(), projectId,
      body: {
        requirementVersionId: reqVersionId,
        targetSchemaVersion: "1.0",
        targetContentSha256: reqContentSha256,
        decision: "approved",
        comment: null,
        requestedChanges: [],
        rejectionReason: null,
      },
    });
    assert.equal(r3.kind, "failed");
    if (r3.kind === "failed") {
      assert.equal(r3.errorCode, "invalid_state_transition");
    }
  });

  test("fail closed: approved with non-empty requestedChanges", async () => {
    await generateFirstRequirement();
    const result = decideRequirementConfirmation({
      db, workspaceId, actorContext: humanCtx, idempotencyKey: randomUUID(), projectId,
      body: {
        requirementVersionId: reqVersionId,
        targetSchemaVersion: "1.0",
        targetContentSha256: reqContentSha256,
        decision: "approved",
        comment: null,
        requestedChanges: [{ summary: "This should fail", rationale: null, affectedFieldPaths: ["/scope"] }],
        rejectionReason: null,
      },
    });
    assert.equal(result.kind, "failed");
    if (result.kind === "failed") {
      assert.equal(result.errorCode, "validation_failed");
    }
  });

  test("fail closed: changes_requested with empty requestedChanges", async () => {
    await generateFirstRequirement();
    const result = decideRequirementConfirmation({
      db, workspaceId, actorContext: humanCtx, idempotencyKey: randomUUID(), projectId,
      body: {
        requirementVersionId: reqVersionId,
        targetSchemaVersion: "1.0",
        targetContentSha256: reqContentSha256,
        decision: "changes_requested",
        comment: null,
        requestedChanges: [],
        rejectionReason: null,
      },
    });
    assert.equal(result.kind, "failed");
    if (result.kind === "failed") {
      assert.equal(result.errorCode, "validation_failed");
    }
  });

  test("fail closed: rejected with empty rejectionReason", async () => {
    await generateFirstRequirement();
    const result = decideRequirementConfirmation({
      db, workspaceId, actorContext: humanCtx, idempotencyKey: randomUUID(), projectId,
      body: {
        requirementVersionId: reqVersionId,
        targetSchemaVersion: "1.0",
        targetContentSha256: reqContentSha256,
        decision: "rejected",
        comment: null,
        requestedChanges: [],
        rejectionReason: null,
      },
    });
    assert.equal(result.kind, "failed");
    if (result.kind === "failed") {
      assert.equal(result.errorCode, "validation_failed");
    }
  });

  test("fail closed: content hash mismatch", async () => {
    await generateFirstRequirement();
    const result = decideRequirementConfirmation({
      db, workspaceId, actorContext: humanCtx, idempotencyKey: randomUUID(), projectId,
      body: {
        requirementVersionId: reqVersionId,
        targetSchemaVersion: "1.0",
        targetContentSha256: "0000000000000000000000000000000000000000000000000000000000000000",
        decision: "approved",
        comment: null,
        requestedChanges: [],
        rejectionReason: null,
      },
    });
    assert.equal(result.kind, "failed");
    if (result.kind === "failed") {
      assert.equal(result.errorCode, "content_hash_mismatch");
    }
  });
});

describe("requirement revision", () => {
  beforeEach(setup);
  afterEach(() => cleanup());

  test("revision path: changes_requested gate allows next version", async () => {
    const engineHandler = makeFakeEngineHandler("happy");

    // Generate first version
    const r1 = await generateRequirement({ db, layout, workspaceId, actorContext: humanCtx, idempotencyKey: randomUUID(), projectId, body: {}, engineHandler });
    if (r1.kind !== "executed") throw new Error("first generate failed");
    const v1Id = r1.data.structuredRequirementVersionId;

    // Request changes
    const gateResult = decideRequirementConfirmation({
      db, workspaceId, actorContext: humanCtx, idempotencyKey: randomUUID(), projectId,
      body: {
        requirementVersionId: v1Id,
        targetSchemaVersion: "1.0",
        targetContentSha256: r1.data.contentSha256,
        decision: "changes_requested",
        comment: null,
        requestedChanges: [{ summary: "Add more scope", rationale: null, affectedFieldPaths: ["/scope"] }],
        rejectionReason: null,
      },
    });
    if (gateResult.kind !== "executed") throw new Error("gate decision failed");
    const gateId = gateResult.data.gateDecisionId;

    // Generate revision with triggeringGateDecisionId
    const r2 = await generateRequirement({
      db, layout, workspaceId, actorContext: humanCtx, idempotencyKey: randomUUID(), projectId,
      body: { previousRequirementVersionId: v1Id, triggeringGateDecisionId: gateId }, engineHandler,
    });
    assert.equal(r2.kind, "executed");
    if (r2.kind === "executed") {
      assert.equal(r2.data.versionOrdinal, 2);
      assert.equal(r2.data.supersedesVersionId, v1Id);
    }
  });

  test("fail closed: revision without changes_requested gate", async () => {
    const engineHandler = makeFakeEngineHandler("happy");

    // Generate first version
    const r1 = await generateRequirement({ db, layout, workspaceId, actorContext: humanCtx, idempotencyKey: randomUUID(), projectId, body: {}, engineHandler });
    if (r1.kind !== "executed") throw new Error("first generate failed");

    // Try revision without gate decision (no triggeringGateDecisionId since no gate exists)
    const r2 = await generateRequirement({
      db, layout, workspaceId, actorContext: humanCtx, idempotencyKey: randomUUID(), projectId,
      body: { previousRequirementVersionId: r1.data.structuredRequirementVersionId, triggeringGateDecisionId: randomUUID() }, engineHandler,
    });
    assert.equal(r2.kind, "failed");
    if (r2.kind === "failed") {
      assert.equal(r2.errorCode, "invalid_state_transition");
    }
  });

  test("fail closed: revision with stale previous version", async () => {
    const engineHandler = makeFakeEngineHandler("happy");

    // Generate v1
    const r1 = await generateRequirement({ db, layout, workspaceId, actorContext: humanCtx, idempotencyKey: randomUUID(), projectId, body: {}, engineHandler });
    if (r1.kind !== "executed") throw new Error("first generate failed");
    const v1Id = r1.data.structuredRequirementVersionId;

    // Request changes on v1
    const gateResult = decideRequirementConfirmation({
      db, workspaceId, actorContext: humanCtx, idempotencyKey: randomUUID(), projectId,
      body: {
        requirementVersionId: v1Id,
        targetSchemaVersion: "1.0",
        targetContentSha256: r1.data.contentSha256,
        decision: "changes_requested",
        comment: null,
        requestedChanges: [{ summary: "Change", rationale: null, affectedFieldPaths: ["/scope"] }],
        rejectionReason: null,
      },
    });
    if (gateResult.kind !== "executed") throw new Error("gate decision failed");
    const gateId = gateResult.data.gateDecisionId;

    // Generate v2
    const r2 = await generateRequirement({
      db, layout, workspaceId, actorContext: humanCtx, idempotencyKey: randomUUID(), projectId,
      body: { previousRequirementVersionId: v1Id, triggeringGateDecisionId: gateId }, engineHandler,
    });
    if (r2.kind !== "executed") throw new Error("second generate failed");

    // Try to generate another version using stale v1
    const r3 = await generateRequirement({
      db, layout, workspaceId, actorContext: humanCtx, idempotencyKey: randomUUID(), projectId,
      body: { previousRequirementVersionId: v1Id, triggeringGateDecisionId: gateId }, engineHandler,
    });
    assert.equal(r3.kind, "failed");
    if (r3.kind === "failed") {
      assert.equal(r3.errorCode, "invalid_state_transition");
    }
  });

  test("fail closed: triggeringGateDecisionId mismatch on revision", async () => {
    const engineHandler = makeFakeEngineHandler("happy");

    // Generate v1
    const r1 = await generateRequirement({ db, layout, workspaceId, actorContext: humanCtx, idempotencyKey: randomUUID(), projectId, body: {}, engineHandler });
    if (r1.kind !== "executed") throw new Error("first generate failed");
    const v1Id = r1.data.structuredRequirementVersionId;

    // Request changes
    decideRequirementConfirmation({
      db, workspaceId, actorContext: humanCtx, idempotencyKey: randomUUID(), projectId,
      body: {
        requirementVersionId: v1Id,
        targetSchemaVersion: "1.0",
        targetContentSha256: r1.data.contentSha256,
        decision: "changes_requested",
        comment: null,
        requestedChanges: [{ summary: "Change", rationale: null, affectedFieldPaths: ["/scope"] }],
        rejectionReason: null,
      },
    });

    // Try revision with wrong triggeringGateDecisionId
    const r2 = await generateRequirement({
      db, layout, workspaceId, actorContext: humanCtx, idempotencyKey: randomUUID(), projectId,
      body: { previousRequirementVersionId: v1Id, triggeringGateDecisionId: randomUUID() }, engineHandler,
    });
    assert.equal(r2.kind, "failed");
    if (r2.kind === "failed") {
      assert.equal(r2.errorCode, "invalid_state_transition");
    }
  });

  test("fail closed: missing triggeringGateDecisionId on revision", async () => {
    const engineHandler = makeFakeEngineHandler("happy");

    // Generate v1
    const r1 = await generateRequirement({ db, layout, workspaceId, actorContext: humanCtx, idempotencyKey: randomUUID(), projectId, body: {}, engineHandler });
    if (r1.kind !== "executed") throw new Error("first generate failed");
    const v1Id = r1.data.structuredRequirementVersionId;

    // Request changes
    decideRequirementConfirmation({
      db, workspaceId, actorContext: humanCtx, idempotencyKey: randomUUID(), projectId,
      body: {
        requirementVersionId: v1Id,
        targetSchemaVersion: "1.0",
        targetContentSha256: r1.data.contentSha256,
        decision: "changes_requested",
        comment: null,
        requestedChanges: [{ summary: "Change", rationale: null, affectedFieldPaths: ["/scope"] }],
        rejectionReason: null,
      },
    });

    // Try revision without triggeringGateDecisionId
    const r2 = await generateRequirement({
      db, layout, workspaceId, actorContext: humanCtx, idempotencyKey: randomUUID(), projectId,
      body: { previousRequirementVersionId: v1Id }, engineHandler,
    });
    assert.equal(r2.kind, "failed");
    if (r2.kind === "failed") {
      assert.equal(r2.errorCode, "validation_failed");
    }
  });
});

describe("RequirementReviewReadModel", () => {
  beforeEach(setup);
  afterEach(() => cleanup());

  test("returns complete requirement content and gate info", async () => {
    const engineHandler = makeFakeEngineHandler("happy");
    const genResult = await generateRequirement({ db, layout, workspaceId, actorContext: humanCtx, idempotencyKey: randomUUID(), projectId, body: {}, engineHandler });
    if (genResult.kind !== "executed") throw new Error("generate failed");

    const envelope = queryRequirementReview({
      db, layout, workspaceId, projectId,
      requirementVersionId: genResult.data.structuredRequirementVersionId,
      actorContext: humanCtx, authorizedForContent: true,
    });

    assert.equal(envelope.readModelVersion, "1.0");
    assert.ok(envelope.generatedAt);
    assert.ok(envelope.data.requirementContent);
    assert.ok(envelope.data.requirementContent.businessQuestion);
    assert.ok(envelope.data.requirementContent.scope);
    assert.ok(envelope.data.requirementContent.acceptanceCriteria.length > 0);
    assert.equal(envelope.data.gate, null, "No gate yet");
    assert.equal(envelope.data.requirementVersion.versionOrdinal, 1);
    assert.ok(envelope.data.commands.length > 0);
    assert.equal(envelope.data.commands[0]!.commandType, "requirement.decide_confirmation");
    assert.equal(envelope.data.commands[0]!.available, true);
    assert.equal(envelope.data.confirmationEligibility.eligible, true);
  });

  test("shows gate decision after confirmation", async () => {
    const engineHandler = makeFakeEngineHandler("happy");
    const genResult = await generateRequirement({ db, layout, workspaceId, actorContext: humanCtx, idempotencyKey: randomUUID(), projectId, body: {}, engineHandler });
    if (genResult.kind !== "executed") throw new Error("generate failed");

    decideRequirementConfirmation({
      db, workspaceId, actorContext: humanCtx, idempotencyKey: randomUUID(), projectId,
      body: {
        requirementVersionId: genResult.data.structuredRequirementVersionId,
        targetSchemaVersion: "1.0",
        targetContentSha256: genResult.data.contentSha256,
        decision: "approved",
        comment: "LGTM",
        requestedChanges: [],
        rejectionReason: null,
      },
    });

    const envelope = queryRequirementReview({
      db, layout, workspaceId, projectId,
      requirementVersionId: genResult.data.structuredRequirementVersionId,
      actorContext: humanCtx, authorizedForContent: true,
    });

    assert.ok(envelope.data.gate);
    assert.equal(envelope.data.gate!.decision, "approved");
    assert.equal(envelope.data.gate!.gateType, "requirement_confirmation");
    assert.equal(envelope.data.commands[0]!.available, false, "Already decided");
    assert.equal(envelope.data.confirmationEligibility.eligible, false);
    assert.ok(envelope.data.confirmationEligibility.reasons.includes("gate_already_decided"));
  });

  test("no storageRef, prompt, token, path, or raw pi event in output", async () => {
    const engineHandler = makeFakeEngineHandler("happy");
    const genResult = await generateRequirement({ db, layout, workspaceId, actorContext: humanCtx, idempotencyKey: randomUUID(), projectId, body: {}, engineHandler });
    if (genResult.kind !== "executed") throw new Error("generate failed");

    const envelope = queryRequirementReview({
      db, layout, workspaceId, projectId,
      requirementVersionId: genResult.data.structuredRequirementVersionId,
      actorContext: humanCtx, authorizedForContent: true,
    });

    const json = JSON.stringify(envelope);
    assert.ok(!json.includes("storageRef"), "Must not contain storageRef");
    assert.ok(!json.includes('"prompt"'), "Must not contain prompt key");
    assert.ok(!json.includes("hiddenReasoning"), "Must not contain hiddenReasoning");
    assert.ok(!json.includes("rawPiEvent"), "Must not contain rawPiEvent");
    assert.ok(!json.includes("/Users/"), "Must not contain absolute paths");
  });

  test("prior requested changes are visible on subsequent versions", async () => {
    const engineHandler = makeFakeEngineHandler("happy");

    // v1
    const r1 = await generateRequirement({ db, layout, workspaceId, actorContext: humanCtx, idempotencyKey: randomUUID(), projectId, body: {}, engineHandler });
    if (r1.kind !== "executed") throw new Error("generate failed");

    // changes_requested on v1
    const gateResult = decideRequirementConfirmation({
      db, workspaceId, actorContext: humanCtx, idempotencyKey: randomUUID(), projectId,
      body: {
        requirementVersionId: r1.data.structuredRequirementVersionId,
        targetSchemaVersion: "1.0",
        targetContentSha256: r1.data.contentSha256,
        decision: "changes_requested",
        comment: null,
        requestedChanges: [{ summary: "More detail needed", rationale: "Too vague", affectedFieldPaths: ["/scope"] }],
        rejectionReason: null,
      },
    });
    if (gateResult.kind !== "executed") throw new Error("gate decision failed");
    const gateId = gateResult.data.gateDecisionId;

    // v2
    const r2 = await generateRequirement({
      db, layout, workspaceId, actorContext: humanCtx, idempotencyKey: randomUUID(), projectId,
      body: { previousRequirementVersionId: r1.data.structuredRequirementVersionId, triggeringGateDecisionId: gateId }, engineHandler,
    });
    if (r2.kind !== "executed") throw new Error("second generate failed");

    const envelope = queryRequirementReview({
      db, layout, workspaceId, projectId,
      requirementVersionId: r2.data.structuredRequirementVersionId,
      actorContext: humanCtx, authorizedForContent: true,
    });

    assert.equal(envelope.data.priorRequestedChanges.length, 1);
    assert.equal(envelope.data.priorRequestedChanges[0]!.requestedChanges[0]!.summary, "More detail needed");
    assert.equal(envelope.data.adjacentVersions.previous?.versionId, r1.data.structuredRequirementVersionId);
    assert.equal(envelope.data.adjacentVersions.next, null);
  });

  test("submitted Evidence only shows request Evidence, not all project Evidence", async () => {
    // Add an extra evidence to the project that is NOT in the request
    const extraSourceId = randomUUID();
    const extraEvidenceId = randomUUID();
    const ts = new Date().toISOString();
    db.exec("BEGIN");
    db.prepare(`INSERT INTO source_references (
      source_reference_id, analysis_project_id, source_kind, display_name, description,
      initial_evidence_artifact_id, declared_data_scope, usage_constraints_json, safety_handling_policy, created_at, created_by_actor_id
    ) VALUES (?, ?, 'user_provided', 'Extra Source', 'Extra', ?, 'input', '[]', 'local_transform_required', ?, ?)`).run(extraSourceId, projectId, extraEvidenceId, ts, humanId);
    db.prepare(`INSERT INTO evidence_artifacts (
      evidence_artifact_id, analysis_project_id, source_reference_id, origin_kind, artifact_kind,
      display_name, storage_ref, content_sha256, media_type, byte_size,
      safety_class, visibility, created_at, created_by_actor_id
    ) VALUES (?, ?, ?, 'user_provided', 'input_material', 'Extra Evidence', 'blobs/00/0000000000000000000000000000000000000000000000000000000000000000', 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855', 'text/plain', 0, 'controlled', 'user_visible', ?, ?)`).run(extraEvidenceId, projectId, extraSourceId, ts, humanId);
    db.exec("COMMIT");

    const engineHandler = makeFakeEngineHandler("happy");
    const genResult = await generateRequirement({ db, layout, workspaceId, actorContext: humanCtx, idempotencyKey: randomUUID(), projectId, body: {}, engineHandler });
    if (genResult.kind !== "executed") throw new Error("generate failed");

    const envelope = queryRequirementReview({
      db, layout, workspaceId, projectId,
      requirementVersionId: genResult.data.structuredRequirementVersionId,
      actorContext: humanCtx, authorizedForContent: true,
    });

    // Should only contain the submitted Evidence, not the extra one
    const evidenceIds = envelope.data.submittedEvidence.map(e => e.evidenceArtifactId);
    assert.ok(!evidenceIds.includes(extraEvidenceId), "Extra Evidence must not appear in submitted Evidence");
    assert.ok(evidenceIds.length > 0, "Must have at least one submitted Evidence");
  });

  test("404 for non-existent requirement version", () => {
    assert.throws(() => {
      queryRequirementReview({
        db, layout, workspaceId, projectId,
        requirementVersionId: randomUUID(),
        actorContext: humanCtx, authorizedForContent: true,
      });
    }, (err: unknown) => {
      return err instanceof Error && err.message.includes("not found");
    });
  });
});
