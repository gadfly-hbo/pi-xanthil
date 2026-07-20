/**
 * Run coordinator service tests (§14, API-049/API-050/API-052).
 *
 * Coverage:
 * - executeRun happy path: queued -> running -> succeeded with ReportVersion + Evidence + events
 * - executeRun failure path: engine failed/timeout/abort -> terminal
 * - abortRun: queued abort (synchronous), running abort (via AbortSignal)
 * - retryRun: terminal -> new queued run with retry_of
 * - RunProgressReadModel: events page, evidence refs, report ref, no leak
 * - security: no storageRef/piSessionRef/path/token in output
 */
import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createMigratedDb } from "./application-helpers.ts";
import { bootstrapSystemActor, setupLocalHuman, getHumanActor } from "../application/actors/actor-service.ts";
import { createProject } from "../application/projects/project-service.ts";
import { submitAnalysisRequest } from "../application/requests/request-service.ts";
import { generateRequirement, decideRequirementConfirmation } from "../application/requirements/requirement-service.ts";
import { generatePlan, decidePlanConfirmation } from "../application/plans/plan-service.ts";
import { RunCoordinator, getRunById } from "../application/runs/run-coordinator.ts";
import { queryRunProgress } from "../application/read-models/run-progress.ts";
import type { TrustedActorContext } from "../application/shared/runtime.ts";
import type { WorkspaceExistencePort } from "../contracts/workspace-port.ts";
import { ENGINE_PORT_VERSION } from "../contracts/registries.ts";
import type { DatabaseSync } from "node:sqlite";
import type { DataRootLayout } from "../persistence/data-root.ts";
import type { EnginePortRequest, EnginePortResultEnvelope } from "../contracts/engine-port.ts";

let db: DatabaseSync;
let layout: DataRootLayout;
let cleanup: () => void;
let humanCtx: TrustedActorContext;
let humanId: string;
let workspaceId: string;
let workspacePort: WorkspaceExistencePort;
let projectId: string;
let runId: string;
let coordinator: RunCoordinator;

async function setup(): Promise<void> {
  const env = await createMigratedDb();
  workspaceId = env.workspaceId;
  workspacePort = env.workspacePort;
  db = env.db; layout = env.layout; cleanup = env.cleanup;
  const sys = bootstrapSystemActor(db);
  const sysCtx: TrustedActorContext = { actorId: sys.auditActorId, actorKind: "system", submittedVia: "local_api", clientVersion: null, active: true };
  setupLocalHuman({ db, actorContext: sysCtx, idempotencyKey: randomUUID(), body: { displayName: "Test User", actorKey: "testuser" } });
  const human = getHumanActor(db)!;
  humanId = human.auditActorId;
  humanCtx = { actorId: human.auditActorId, actorKind: "human", submittedVia: "web_ui", clientVersion: null, active: true };
  const projRes = createProject({ db, workspacePort, workspaceId, actorContext: humanCtx, idempotencyKey: randomUUID(), body: { title: "Test Project", slug: "test-run-" + randomUUID().slice(0, 8) } });
  if (projRes.kind !== "executed") throw new Error("project creation failed");
  projectId = projRes.resultResourceId;
  const sourceId = randomUUID(); const evidenceId = randomUUID(); const evidenceTs = new Date().toISOString();
  db.exec("BEGIN");
  db.prepare(`INSERT INTO source_references (source_reference_id, analysis_project_id, source_kind, display_name, description, initial_evidence_artifact_id, declared_data_scope, usage_constraints_json, safety_handling_policy, created_at, created_by_actor_id) VALUES (?, ?, 'user_provided', 'Test Source', 'Test', ?, 'input', '[]', 'local_transform_required', ?, ?)`).run(sourceId, projectId, evidenceId, evidenceTs, humanId);
  db.prepare(`INSERT INTO evidence_artifacts (evidence_artifact_id, analysis_project_id, source_reference_id, origin_kind, artifact_kind, display_name, storage_ref, content_sha256, media_type, byte_size, safety_class, visibility, created_at, created_by_actor_id) VALUES (?, ?, ?, 'user_provided', 'input_material', 'Test Evidence', 'blobs/00/0000000000000000000000000000000000000000000000000000000000000000', 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855', 'text/plain', 0, 'controlled', 'user_visible', ?, ?)`).run(evidenceId, projectId, sourceId, evidenceTs, humanId);
  db.exec("COMMIT");
  submitAnalysisRequest({ db, workspaceId, actorContext: humanCtx, idempotencyKey: randomUUID(), projectId, body: { rawRequestText: "Analyze daily sales trends", contextEvidenceArtifactIds: [evidenceId], locale: "en-US", timezone: "America/New_York" }, submittedVia: "web_ui", clientVersion: null });
  const engineHandler = makeFakeEngineHandler("happy");
  const reqResult = await generateRequirement({ db, layout, workspaceId, actorContext: humanCtx, idempotencyKey: randomUUID(), projectId, body: {}, engineHandler });
  if (reqResult.kind !== "executed") throw new Error("requirement generation failed");
  decideRequirementConfirmation({ db, workspaceId, actorContext: humanCtx, idempotencyKey: randomUUID(), projectId, body: { requirementVersionId: reqResult.data.structuredRequirementVersionId, targetSchemaVersion: "1.0", targetContentSha256: reqResult.data.contentSha256, decision: "approved", comment: null, requestedChanges: [], rejectionReason: null } });
  const planResult = await generatePlan({ db, layout, workspaceId, actorContext: humanCtx, idempotencyKey: randomUUID(), projectId, body: {}, engineHandler });
  if (planResult.kind !== "executed") throw new Error("plan generation failed");
  const planGate = decidePlanConfirmation({ db, layout, workspaceId, actorContext: humanCtx, idempotencyKey: randomUUID(), projectId, body: { planVersionId: planResult.data.analysisPlanVersionId, targetSchemaVersion: "1.0", targetContentSha256: planResult.data.contentSha256, decision: "approved", comment: "Plan confirmed", requestedChanges: [], rejectionReason: null } });
  if (planGate.kind !== "executed" || !planGate.data.queuedRun) throw new Error("plan gate failed");
  runId = planGate.data.queuedRun.analysisRunId;
  coordinator = new RunCoordinator({ db, layout, engineHandler });
}

function makeFakeEngineHandler(execScenario: "happy" | "spawn_failed" | "execution_failed" | "malformed_json" | "invalid_candidate" | "never" = "happy") {
  return async (request: EnginePortRequest): Promise<EnginePortResultEnvelope> => {
    const now = new Date().toISOString();
    if (request.operation === "executeQueuedRun") {
      if (execScenario === "never") {
        return new Promise((resolve) => {
          request.abortSignal?.addEventListener("abort", () => {
            resolve({ version: ENGINE_PORT_VERSION, operation: request.operation, operationId: request.operationId, projectId: request.projectId, runId: request.runId ?? null, generationId: request.generationId, startedAt: now, completedAt: new Date().toISOString(), outcome: "aborted", error: { code: "aborted", summary: "Run was aborted." } });
          }, { once: true });
        });
      }
      if (execScenario === "spawn_failed") return { version: ENGINE_PORT_VERSION, operation: request.operation, operationId: request.operationId, projectId: request.projectId, runId: request.runId ?? null, generationId: request.generationId, startedAt: now, completedAt: now, outcome: "failed", error: { code: "pi_spawn_failed", summary: "Failed to spawn." } };
      if (execScenario === "execution_failed") return { version: ENGINE_PORT_VERSION, operation: request.operation, operationId: request.operationId, projectId: request.projectId, runId: request.runId ?? null, generationId: request.generationId, startedAt: now, completedAt: now, outcome: "failed", error: { code: "pi_execution_failed", summary: "Execution failed." } };
      if (execScenario === "malformed_json") return { version: ENGINE_PORT_VERSION, operation: request.operation, operationId: request.operationId, projectId: request.projectId, runId: request.runId ?? null, generationId: request.generationId, startedAt: now, completedAt: now, outcome: "succeeded", output: "{not-json" };
      if (execScenario === "invalid_candidate") return { version: ENGINE_PORT_VERSION, operation: request.operation, operationId: request.operationId, projectId: request.projectId, runId: request.runId ?? null, generationId: request.generationId, startedAt: now, completedAt: now, outcome: "succeeded", output: { prompt: "leaked" } };
      const analysisEvidenceHandle = "candidate-evidence:analysis-summary";
      const reviewEvidenceHandle = "candidate-evidence:internal-review";
      return {
        version: ENGINE_PORT_VERSION, operation: request.operation, operationId: request.operationId, projectId: request.projectId, runId: request.runId ?? null, generationId: request.generationId, startedAt: now, completedAt: now, outcome: "succeeded",
        output: {
          eventSuggestions: [
            { eventType: "run_started", payloadSchemaVersion: "workcanger.run-event.run_started/1.0", analysisStageAfter: "S2.1", runStatusAfter: "running", producerEventId: "fake-run-started", payload: {} },
            { eventType: "stage_started", payloadSchemaVersion: "workcanger.run-event.stage_started/1.0", analysisStageAfter: "S2.1", runStatusAfter: "running", producerEventId: "fake-S2.1-started", payload: { stage: "S2.1" } },
            { eventType: "plan_step_completed", payloadSchemaVersion: "workcanger.run-event.plan_step_completed/1.0", analysisStageAfter: "S2.1", runStatusAfter: "running", producerEventId: "fake-step-1", payload: { planStepId: "step-1", stepOrdinal: 1, outcome: "completed", outputEvidenceArtifactIds: [] } },
            { eventType: "stage_started", payloadSchemaVersion: "workcanger.run-event.stage_started/1.0", analysisStageAfter: "S2.2", runStatusAfter: "running", producerEventId: "fake-S2.2-started", payload: { stage: "S2.2" } },
            { eventType: "plan_step_completed", payloadSchemaVersion: "workcanger.run-event.plan_step_completed/1.0", analysisStageAfter: "S2.2", runStatusAfter: "running", producerEventId: "fake-step-2", payload: { planStepId: "step-2", stepOrdinal: 2, outcome: "completed", outputEvidenceArtifactIds: [] } },
            { eventType: "stage_started", payloadSchemaVersion: "workcanger.run-event.stage_started/1.0", analysisStageAfter: "S2.3", runStatusAfter: "running", producerEventId: "fake-S2.3-started", payload: { stage: "S2.3" } },
            { eventType: "plan_step_completed", payloadSchemaVersion: "workcanger.run-event.plan_step_completed/1.0", analysisStageAfter: "S2.3", runStatusAfter: "running", producerEventId: "fake-step-3", payload: { planStepId: "step-3", stepOrdinal: 3, outcome: "completed", outputEvidenceArtifactIds: [] } },
            { eventType: "stage_started", payloadSchemaVersion: "workcanger.run-event.stage_started/1.0", analysisStageAfter: "S2.4", runStatusAfter: "running", producerEventId: "fake-S2.4-started", payload: { stage: "S2.4" } },
            { eventType: "plan_step_completed", payloadSchemaVersion: "workcanger.run-event.plan_step_completed/1.0", analysisStageAfter: "S2.4", runStatusAfter: "running", producerEventId: "fake-step-4", payload: { planStepId: "step-4", stepOrdinal: 4, outcome: "completed", outputEvidenceArtifactIds: [] } },
          ],
          evidenceRegistrationSuggestions: [
            { candidateEvidenceHandle: analysisEvidenceHandle, planStepId: "step-3", artifactKind: "analysis_result", safetyClass: "derived", visibility: "user_visible", displayName: "Analysis", contentSha256: "1".repeat(64) },
            { candidateEvidenceHandle: reviewEvidenceHandle, planStepId: "step-4", artifactKind: "intermediate_result", safetyClass: "derived", visibility: "review_only", displayName: "Review", contentSha256: "2".repeat(64) },
          ],
          internalReviewSuggestion: { schemaVersion: "1.0", reviewOrdinal: 1, planStepId: "step-4", outcome: "passed", reviewEvidenceHandle, reviewedEvidenceHandles: [analysisEvidenceHandle], qualityChecks: [], limitations: [], misinterpretationRisks: [] },
          reportDraftCandidate: { schemaVersion: "1.0", title: "Draft", executiveSummary: "Test", methodSummary: "Fake", keyConclusionCount: 1, citedEvidenceHandles: [analysisEvidenceHandle], confidence: "medium", confidenceRationale: "fake", limitations: [], misinterpretationRisks: [], actionableRecommendationCount: 1 },
        },
      };
    }
    // Generation handler
    return {
      version: ENGINE_PORT_VERSION, operation: request.operation, operationId: request.operationId, projectId: request.projectId, generationId: request.generationId, startedAt: now, completedAt: now, outcome: "succeeded",
      output: { candidate: request.operation === "generateAnalysisPlan" ? { analysisObjective: "Analyze", successCriteria: ["OK"], steps: [{ planStepId: "step-1", sequence: 1, analysisStage: "S2.1", purpose: "Gather" }] } : { businessQuestion: "Question?", scope: { inScope: ["A"], outOfScope: ["B"] }, acceptanceCriteria: ["AC"] } },
    };
  };
}

describe("RunCoordinator.executeRun", () => {
  beforeEach(setup);
  afterEach(() => cleanup());

  test("happy path: queued -> running -> succeeded with ReportVersion and Evidence", async () => {
    const result = await coordinator.executeRun(runId, workspaceId);
    assert.equal(result.kind, "succeeded");
    if (result.kind === "succeeded") assert.ok(result.reportVersionId);
    const run = getRunById(db, workspaceId, runId);
    assert.equal(run!.currentRunStatus, "succeeded");
    assert.equal(run!.currentAnalysisStage, "S2.4");
    assert.ok(run!.endedAt);
    // ReportVersion exists
    const reportRow = db.prepare("SELECT report_version_id, version_ordinal FROM report_versions WHERE analysis_run_id = ?").get(runId) as { report_version_id: string; version_ordinal: number };
    assert.ok(reportRow);
    assert.equal(reportRow.version_ordinal, 1);
    // ReportVersionEvidence links exist
    const evCount = (db.prepare("SELECT COUNT(*) AS c FROM report_version_evidence WHERE report_version_id = ?").get(reportRow.report_version_id) as { c: number }).c;
    assert.ok(evCount > 0);
    // Derived Evidence exists
    const derivedCount = (db.prepare("SELECT COUNT(*) AS c FROM evidence_artifacts WHERE analysis_run_id = ? AND origin_kind = 'analysis_run'").get(runId) as { c: number }).c;
    assert.ok(derivedCount >= 2);
    // Internal review Evidence is intermediate_result/review_only
    const reviewRow = db.prepare("SELECT evidence_artifact_id FROM evidence_artifacts WHERE analysis_run_id = ? AND artifact_kind = 'intermediate_result' AND visibility = 'review_only'").get(runId) as { evidence_artifact_id: string } | undefined;
    assert.ok(reviewRow);
    // run_succeeded event exists
    const successEvent = db.prepare("SELECT sequence, event_type, payload_json FROM run_events WHERE analysis_run_id = ? AND event_type = 'run_succeeded'").get(runId) as { sequence: number; event_type: string; payload_json: string };
    assert.equal(successEvent.event_type, "run_succeeded");
    const payload = JSON.parse(successEvent.payload_json);
    assert.ok(payload.reportVersionId);
    assert.ok(payload.internalReviewEvidenceArtifactId);
    // Events sequence is contiguous
    const events = db.prepare("SELECT sequence FROM run_events WHERE analysis_run_id = ? ORDER BY sequence ASC").all(runId) as Array<{ sequence: number }>;
    for (let i = 0; i < events.length; i++) assert.equal(events[i]!.sequence, i + 1);
    // pi_session_ref is null
    assert.equal(run!.piSessionRef, null);
  });

  test("candidate handles not in RunEvent payload", async () => {
    await coordinator.executeRun(runId, workspaceId);
    const events = db.prepare("SELECT payload_json FROM run_events WHERE analysis_run_id = ?").all(runId) as Array<{ payload_json: string }>;
    for (const e of events) {
      assert.ok(!e.payload_json.includes("candidate-evidence:"), `Event payload must not contain candidate handles: ${e.payload_json}`);
    }
  });

  test("engine spawn_failed -> run_failed", async () => {
    const failCoord = new RunCoordinator({ db, layout, engineHandler: makeFakeEngineHandler("spawn_failed") });
    const result = await failCoord.executeRun(runId, workspaceId);
    assert.equal(result.kind, "failed");
    assert.equal(getRunById(db, workspaceId, runId)!.currentRunStatus, "failed");
  });

  test("engine execution_failed -> run_failed", async () => {
    const failCoord = new RunCoordinator({ db, layout, engineHandler: makeFakeEngineHandler("execution_failed") });
    const result = await failCoord.executeRun(runId, workspaceId);
    assert.equal(result.kind, "failed");
    assert.equal(getRunById(db, workspaceId, runId)!.currentRunStatus, "failed");
  });

  test("engine malformed output -> run_failed", async () => {
    const failCoord = new RunCoordinator({ db, layout, engineHandler: makeFakeEngineHandler("malformed_json") });
    const result = await failCoord.executeRun(runId, workspaceId);
    assert.equal(result.kind, "failed");
    assert.equal(getRunById(db, workspaceId, runId)!.currentRunStatus, "failed");
  });

  test("not found: non-existent run", async () => {
    const result = await coordinator.executeRun(randomUUID(), workspaceId);
    assert.equal(result.kind, "not_found");
  });

  test("not queued: already succeeded run", async () => {
    await coordinator.executeRun(runId, workspaceId);
    const result = await coordinator.executeRun(runId, workspaceId);
    assert.equal(result.kind, "not_queued");
  });
});

describe("RunCoordinator.abortRun", () => {
  beforeEach(setup);
  afterEach(() => cleanup());

  test("queued abort: directly terminates to aborted", () => {
    const result = coordinator.abortRun(runId, workspaceId, "User requested abort");
    assert.ok(result.ok);
    const run = getRunById(db, workspaceId, runId);
    assert.equal(run!.currentRunStatus, "aborted");
    assert.ok(run!.endedAt);
    const abortEvent = db.prepare("SELECT event_type FROM run_events WHERE analysis_run_id = ? AND event_type = 'run_aborted'").get(runId) as { event_type: string } | undefined;
    assert.ok(abortEvent);
  });

  test("running abort: signals AbortController (never scenario)", async () => {
    const neverCoord = new RunCoordinator({ db, layout, engineHandler: makeFakeEngineHandler("never"), defaultDeadlineMs: 10_000 });
    const execPromise = neverCoord.executeRun(runId, workspaceId);
    await new Promise((resolve) => setTimeout(resolve, 100));
    const abortResult = neverCoord.abortRun(runId, workspaceId, "User requested abort");
    assert.ok(abortResult.ok);
    const execResult = await execPromise;
    assert.equal(execResult.kind, "aborted");
    assert.equal(getRunById(db, workspaceId, runId)!.currentRunStatus, "aborted");
  });

  test("terminal run abort: rejected", async () => {
    await coordinator.executeRun(runId, workspaceId);
    const result = coordinator.abortRun(runId, workspaceId, null);
    assert.ok(!result.ok);
    assert.equal(result.errorCode, "invalid_state_transition");
  });
});

describe("RunCoordinator.retryRun", () => {
  beforeEach(setup);
  afterEach(() => cleanup());

  test("retry failed run: creates new queued run with retry_of", async () => {
    const failCoord = new RunCoordinator({ db, layout, engineHandler: makeFakeEngineHandler("execution_failed") });
    await failCoord.executeRun(runId, workspaceId);
    assert.equal(getRunById(db, workspaceId, runId)!.currentRunStatus, "failed");
    const result = coordinator.retryRun({ db, workspaceId, layout, actorContext: humanCtx, idempotencyKey: randomUUID(), projectId, runId, body: {} });
    assert.equal(result.kind, "executed");
    if (result.kind === "executed") {
      assert.equal(result.data.predecessorRunId, runId);
      assert.equal(result.data.runRelationType, "retry_of");
      assert.equal(result.data.currentRunStatus, "queued");
      const newRun = getRunById(db, workspaceId, result.data.analysisRunId);
      assert.equal(newRun!.currentRunStatus, "queued");
      assert.equal(newRun!.predecessorRunId, runId);
      assert.equal(newRun!.runRelationType, "retry_of");
      const queuedEvent = db.prepare("SELECT payload_json FROM run_events WHERE analysis_run_id = ? AND event_type = 'run_queued'").get(result.data.analysisRunId) as { payload_json: string };
      assert.equal(JSON.parse(queuedEvent.payload_json).queueCause, "retry");
    }
  });

  test("retry succeeded run: rejected", async () => {
    await coordinator.executeRun(runId, workspaceId);
    const result = coordinator.retryRun({ db, workspaceId, layout, actorContext: humanCtx, idempotencyKey: randomUUID(), projectId, runId, body: {} });
    assert.equal(result.kind, "failed");
    if (result.kind === "failed") assert.equal(result.errorCode, "invalid_state_transition");
  });

  test("retry queued run: rejected (not terminal)", () => {
    const result = coordinator.retryRun({ db, workspaceId, layout, actorContext: humanCtx, idempotencyKey: randomUUID(), projectId, runId, body: {} });
    assert.equal(result.kind, "failed");
  });

  test("retry: new run has no piSessionRef", async () => {
    const failCoord = new RunCoordinator({ db, layout, engineHandler: makeFakeEngineHandler("execution_failed") });
    await failCoord.executeRun(runId, workspaceId);
    const result = coordinator.retryRun({ db, workspaceId, layout, actorContext: humanCtx, idempotencyKey: randomUUID(), projectId, runId, body: {} });
    if (result.kind === "executed") {
      assert.equal(getRunById(db, workspaceId, result.data.analysisRunId)!.piSessionRef, null);
    }
  });
});

describe("RunProgressReadModel", () => {
  beforeEach(setup);
  afterEach(() => cleanup());

  test("succeeded run: shows events, evidence, report, no leak", async () => {
    await coordinator.executeRun(runId, workspaceId);
    const rm = queryRunProgress({ db, workspaceId, projectId, runId, actorContext: humanCtx });
    assert.equal(rm.readModelVersion, "1.0");
    assert.equal(rm.data.run.currentRunStatus, "succeeded");
    assert.equal(rm.data.run.currentAnalysisStage, "S2.4");
    assert.ok(rm.data.reportVersion !== null);
    assert.ok(rm.data.producedEvidence.length >= 2);
    assert.ok(rm.data.latestInternalReview !== null);
    assert.ok(rm.data.events.items.length > 0);
    const rmJson = JSON.stringify(rm);
    assert.ok(!rmJson.includes("storageRef"));
    assert.ok(!rmJson.includes("piSessionRef"));
    assert.ok(!rmJson.includes("prompt"));
    assert.ok(!rmJson.includes("rawPiEvent"));
    assert.ok(!rmJson.includes("/Users/"));
    assert.ok(!rmJson.includes("candidate-evidence:"));
  });

  test("events pagination: afterSequence + limit", async () => {
    await coordinator.executeRun(runId, workspaceId);
    const rm1 = queryRunProgress({ db, workspaceId, projectId, runId, actorContext: humanCtx, afterSequence: 0, limit: 5 });
    assert.ok(rm1.data.events.items.length <= 5);
    if (rm1.data.events.hasMore) {
      const lastSeq = rm1.data.events.items[rm1.data.events.items.length - 1]!.sequence;
      const rm2 = queryRunProgress({ db, workspaceId, projectId, runId, actorContext: humanCtx, afterSequence: lastSeq, limit: 100 });
      assert.ok(rm2.data.events.items.length > 0);
      assert.ok(rm2.data.events.items[0]!.sequence > lastSeq);
    }
  });

  test("queued run: shows input evidence, no produced evidence", () => {
    const rm = queryRunProgress({ db, workspaceId, projectId, runId, actorContext: humanCtx });
    assert.equal(rm.data.run.currentRunStatus, "queued");
    assert.ok(rm.data.inputEvidence.length >= 1);
    assert.equal(rm.data.producedEvidence.length, 0);
    assert.equal(rm.data.reportVersion, null);
    assert.ok(rm.data.events.items.length >= 1);
    assert.equal(rm.data.events.items[0]!.eventType, "run_queued");
  });

  test("commands: abort available for queued, retry not available", () => {
    const rm = queryRunProgress({ db, workspaceId, projectId, runId, actorContext: humanCtx });
    const abortCmd = rm.data.commands.find((c) => c.commandType === "run.abort");
    const retryCmd = rm.data.commands.find((c) => c.commandType === "run.retry");
    assert.ok(abortCmd?.available);
    assert.ok(!retryCmd?.available);
  });
});
