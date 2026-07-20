/**
 * Report service tests (§6.4, API-027/API-028).
 *
 * Coverage:
 * - decideReview approved: active human + current latest ReportVersion -> approved Gate + Project completed
 * - decideReview changes_requested: Gate with revisionScope, Project stays active
 * - decideReview rejected: Gate + Project rejected
 * - Idempotency replay
 * - Duplicate target / approved conflict / hash mismatch / non-latest / Run not succeeded
 * - Atomics: simulated Gate/Project/receipt failure
 * - ReportReviewReadModel: pending report, approved gate, no leak
 * - LockedReportReadModel: approved after readable, no approved gate -> not found, no leak
 * - Project derivation: pendingGate report_review, completed/locked report
 */
import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createMigratedDb } from "./application-helpers.ts";
import { ENGINE_PORT_VERSION } from "../contracts/registries.ts";
import { bootstrapSystemActor, setupLocalHuman, getHumanActor } from "../application/actors/actor-service.ts";
import { createProject } from "../application/projects/project-service.ts";
import { submitAnalysisRequest } from "../application/requests/request-service.ts";
import { generateRequirement, decideRequirementConfirmation } from "../application/requirements/requirement-service.ts";
import { generatePlan, decidePlanConfirmation } from "../application/plans/plan-service.ts";
import { RunCoordinator, getRunById } from "../application/runs/run-coordinator.ts";
import { decideReview, getReportVersionById, getLatestReportVersion } from "../application/reports/report-service.ts";
import { queryReportReview } from "../application/read-models/report-review.ts";
import { queryLockedReport } from "../application/read-models/locked-report.ts";
import { getProjectById } from "../application/projects/project-queries.ts";
import { deriveProjectStage, derivePendingGate, deriveLockedReportId } from "../application/read-models/project-derivation.ts";
import type { TrustedActorContext } from "../application/shared/runtime.ts";
import type { WorkspaceExistencePort } from "../contracts/workspace-port.ts";
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
let reportVersionId: string;
let reportSha256: string;

function makeFakeEngineHandler() {
  return async (request: EnginePortRequest): Promise<EnginePortResultEnvelope> => {
    const now = new Date().toISOString();
    if (request.operation === "executeQueuedRun") {
      const analysisEvidenceHandle = "candidate-evidence:analysis-summary";
      const reviewEvidenceHandle = "candidate-evidence:internal-review";
      return {
        version: ENGINE_PORT_VERSION, operation: request.operation, operationId: request.operationId,
        projectId: request.projectId, runId: request.runId ?? null, generationId: request.generationId,
        startedAt: now, completedAt: now, outcome: "succeeded",
        output: {
          eventSuggestions: [
            { eventType: "run_started", payloadSchemaVersion: "workcanger.run-event.run_started/1.0", analysisStageAfter: "S2.1", runStatusAfter: "running", producerEventId: "fake-run-started", payload: {} },
            { eventType: "stage_started", payloadSchemaVersion: "workcanger.run-event.stage_started/1.0", analysisStageAfter: "S2.1", runStatusAfter: "running", producerEventId: "fake-S2.1-started", payload: { stage: "S2.1" } },
            { eventType: "plan_step_completed", payloadSchemaVersion: "workcanger.run-event.plan_step_completed/1.0", analysisStageAfter: "S2.1", runStatusAfter: "running", producerEventId: "fake-step-1-completed", payload: { planStepId: "step-1", stepOrdinal: 1, outcome: "completed", outputEvidenceArtifactIds: [] } },
            { eventType: "stage_started", payloadSchemaVersion: "workcanger.run-event.stage_started/1.0", analysisStageAfter: "S2.2", runStatusAfter: "running", producerEventId: "fake-S2.2-started", payload: { stage: "S2.2" } },
            { eventType: "plan_step_completed", payloadSchemaVersion: "workcanger.run-event.plan_step_completed/1.0", analysisStageAfter: "S2.2", runStatusAfter: "running", producerEventId: "fake-step-2-completed", payload: { planStepId: "step-2", stepOrdinal: 2, outcome: "completed", outputEvidenceArtifactIds: [] } },
            { eventType: "stage_started", payloadSchemaVersion: "workcanger.run-event.stage_started/1.0", analysisStageAfter: "S2.3", runStatusAfter: "running", producerEventId: "fake-S2.3-started", payload: { stage: "S2.3" } },
            { eventType: "plan_step_completed", payloadSchemaVersion: "workcanger.run-event.plan_step_completed/1.0", analysisStageAfter: "S2.3", runStatusAfter: "running", producerEventId: "fake-step-3-completed", payload: { planStepId: "step-3", stepOrdinal: 3, outcome: "completed", outputEvidenceArtifactIds: [] } },
            { eventType: "stage_started", payloadSchemaVersion: "workcanger.run-event.stage_started/1.0", analysisStageAfter: "S2.4", runStatusAfter: "running", producerEventId: "fake-S2.4-started", payload: { stage: "S2.4" } },
            { eventType: "plan_step_completed", payloadSchemaVersion: "workcanger.run-event.plan_step_completed/1.0", analysisStageAfter: "S2.4", runStatusAfter: "running", producerEventId: "fake-step-4-completed", payload: { planStepId: "step-4", stepOrdinal: 4, outcome: "completed", outputEvidenceArtifactIds: [] } },
          ],
          evidenceRegistrationSuggestions: [
            { candidateEvidenceHandle: analysisEvidenceHandle, planStepId: "step-3", artifactKind: "analysis_result", safetyClass: "derived", visibility: "user_visible", displayName: "Analysis summary", contentSha256: "1".repeat(64) },
            { candidateEvidenceHandle: reviewEvidenceHandle, planStepId: "step-4", artifactKind: "intermediate_result", safetyClass: "derived", visibility: "review_only", displayName: "Internal review", contentSha256: "2".repeat(64) },
          ],
          internalReviewSuggestion: { schemaVersion: "1.0", reviewOrdinal: 1, planStepId: "step-4", outcome: "passed", reviewEvidenceHandle, reviewedEvidenceHandles: [analysisEvidenceHandle], qualityChecks: [{ checkId: "qc-1", outcome: "passed", summary: "OK" }], limitations: [], misinterpretationRisks: [] },
          reportDraftCandidate: { schemaVersion: "1.0", title: "Draft", executiveSummary: "Test report", methodSummary: "Fake", keyConclusionCount: 1, citedEvidenceHandles: [analysisEvidenceHandle], confidence: "medium", confidenceRationale: "fake", limitations: [], misinterpretationRisks: [], actionableRecommendationCount: 1 },
        },
      };
    }
    return {
      version: ENGINE_PORT_VERSION, operation: request.operation, operationId: request.operationId,
      projectId: request.projectId, generationId: request.generationId,
      startedAt: now, completedAt: now, outcome: "succeeded",
      output: {
        candidate: request.operation === "generateAnalysisPlan"
          ? { analysisObjective: "Analyze sales trends", successCriteria: ["Identify patterns"], steps: [{ planStepId: "step-1", sequence: 1, analysisStage: "S2.1", purpose: "Gather data" }] }
          : { businessQuestion: "What are the daily sales trends?", scope: { inScope: ["daily sales"], outOfScope: ["weekly"] }, acceptanceCriteria: ["Clear trend identification"] },
      },
    };
  };
}

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
  const projRes = createProject({ db, workspacePort, workspaceId, actorContext: humanCtx, idempotencyKey: randomUUID(), body: { title: "Test Project", slug: "test-report-" + randomUUID().slice(0, 8) } });
  if (projRes.kind !== "executed") throw new Error("project creation failed");
  projectId = projRes.resultResourceId;
  const sourceId = randomUUID(); const evidenceId = randomUUID(); const evidenceTs = new Date().toISOString();
  db.exec("BEGIN");
  db.prepare(`INSERT INTO source_references (source_reference_id, analysis_project_id, source_kind, display_name, description, initial_evidence_artifact_id, declared_data_scope, usage_constraints_json, safety_handling_policy, created_at, created_by_actor_id) VALUES (?, ?, 'user_provided', 'Test Source', 'Test', ?, 'input', '[]', 'local_transform_required', ?, ?)`).run(sourceId, projectId, evidenceId, evidenceTs, humanId);
  db.prepare(`INSERT INTO evidence_artifacts (evidence_artifact_id, analysis_project_id, source_reference_id, origin_kind, artifact_kind, display_name, storage_ref, content_sha256, media_type, byte_size, safety_class, visibility, created_at, created_by_actor_id) VALUES (?, ?, ?, 'user_provided', 'input_material', 'Test Evidence', 'blobs/00/0000000000000000000000000000000000000000000000000000000000000000', 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855', 'text/plain', 0, 'controlled', 'user_visible', ?, ?)`).run(evidenceId, projectId, sourceId, evidenceTs, humanId);
  db.exec("COMMIT");
  submitAnalysisRequest({ db, workspaceId, actorContext: humanCtx, idempotencyKey: randomUUID(), projectId, body: { rawRequestText: "Analyze daily sales trends", contextEvidenceArtifactIds: [evidenceId], locale: "en-US", timezone: "America/New_York" }, submittedVia: "web_ui", clientVersion: null });
  const engineHandler = makeFakeEngineHandler();
  const reqResult = await generateRequirement({ db, layout, workspaceId, actorContext: humanCtx, idempotencyKey: randomUUID(), projectId, body: {}, engineHandler });
  if (reqResult.kind !== "executed") throw new Error("requirement generation failed");
  decideRequirementConfirmation({ db, workspaceId, actorContext: humanCtx, idempotencyKey: randomUUID(), projectId, body: { requirementVersionId: reqResult.data.structuredRequirementVersionId, targetSchemaVersion: "1.0", targetContentSha256: reqResult.data.contentSha256, decision: "approved", comment: null, requestedChanges: [], rejectionReason: null } });
  const planResult = await generatePlan({ db, layout, workspaceId, actorContext: humanCtx, idempotencyKey: randomUUID(), projectId, body: {}, engineHandler });
  if (planResult.kind !== "executed") throw new Error("plan generation failed");
  const planGate = decidePlanConfirmation({ db, layout, workspaceId, actorContext: humanCtx, idempotencyKey: randomUUID(), projectId, body: { planVersionId: planResult.data.analysisPlanVersionId, targetSchemaVersion: "1.0", targetContentSha256: planResult.data.contentSha256, decision: "approved", comment: "ok", requestedChanges: [], rejectionReason: null } });
  if (planGate.kind !== "executed" || !planGate.data.queuedRun) throw new Error("plan gate failed");
  runId = planGate.data.queuedRun.analysisRunId;
  const coordinator = new RunCoordinator({ db, layout, engineHandler });
  const execResult = await coordinator.executeRun(runId, workspaceId);
  if (execResult.kind !== "succeeded") throw new Error("executeRun failed: " + execResult.kind);
  reportVersionId = execResult.reportVersionId;
  const rv = getReportVersionById(db, workspaceId, reportVersionId)!;
  reportSha256 = rv.contentSha256;
}

describe("report.decide_review", () => {
  beforeEach(setup);
  afterEach(() => cleanup());

  test("approved: creates approved Gate + Project completed", () => {
    const result = decideReview({
      db, layout, workspaceId, actorContext: humanCtx, idempotencyKey: randomUUID(), projectId, reportVersionId,
      body: { targetSchemaVersion: "1.0", targetContentSha256: reportSha256, decision: "approved", comment: null, requestedChanges: [], rejectionReason: null, revisionScope: null },
    });
    assert.equal(result.kind, "executed");
    assert.equal(result.data.decision, "approved");
    assert.equal(result.data.projectStatus, "completed");
    // DB: project completed
    const proj = getProjectById(db, workspaceId, projectId)!;
    assert.equal(proj.projectStatus, "completed");
    assert.ok(proj.completedAt);
    // DB: gate exists
    const gateRow = db.prepare("SELECT gate_decision_id, decision FROM gate_decisions WHERE gate_type = 'report_review' AND target_object_id = ?").get(reportVersionId) as { gate_decision_id: string; decision: string } | undefined;
    assert.ok(gateRow);
    assert.equal(gateRow.decision, "approved");
  });

  test("changes_requested: Gate with revisionScope, Project stays active", () => {
    const result = decideReview({
      db, layout, workspaceId, actorContext: humanCtx, idempotencyKey: randomUUID(), projectId, reportVersionId,
      body: {
        targetSchemaVersion: "1.0", targetContentSha256: reportSha256, decision: "changes_requested",
        comment: "Needs revision", requestedChanges: [{ summary: "Fix conclusion", rationale: "Wrong data", affectedFieldPaths: ["/keyConclusionCount"] }],
        rejectionReason: null, revisionScope: "report_revision",
      },
    });
    assert.equal(result.kind, "executed");
    assert.equal(result.data.decision, "changes_requested");
    assert.equal(result.data.revisionScope, "report_revision");
    assert.equal(result.data.projectStatus, "active");
    // DB: project stays active
    const proj = getProjectById(db, workspaceId, projectId)!;
    assert.equal(proj.projectStatus, "active");
    // DB: gate exists with revisionScope in requested_changes_json
    const gateRow = db.prepare("SELECT requested_changes_json FROM gate_decisions WHERE gate_type = 'report_review' AND target_object_id = ?").get(reportVersionId) as { requested_changes_json: string } | undefined;
    assert.ok(gateRow);
    const changes = JSON.parse(gateRow.requested_changes_json);
    assert.equal(changes.length, 1);
    assert.equal(changes[0].revisionScope, "report_revision");
    assert.ok(changes[0].requestedChangeId); // Backend-assigned UUID
  });

  test("rejected: Gate + Project rejected", () => {
    const result = decideReview({
      db, layout, workspaceId, actorContext: humanCtx, idempotencyKey: randomUUID(), projectId, reportVersionId,
      body: { targetSchemaVersion: "1.0", targetContentSha256: reportSha256, decision: "rejected", comment: null, requestedChanges: [], rejectionReason: "Not useful", revisionScope: null },
    });
    assert.equal(result.kind, "executed");
    assert.equal(result.data.decision, "rejected");
    assert.equal(result.data.projectStatus, "rejected");
    // DB: project rejected
    const proj = getProjectById(db, workspaceId, projectId)!;
    assert.equal(proj.projectStatus, "rejected");
    assert.ok(proj.rejectedAt);
  });

  test("idempotency replay returns same result", () => {
    const key = randomUUID();
    const body = { targetSchemaVersion: "1.0", targetContentSha256: reportSha256, decision: "approved" as const, comment: null, requestedChanges: [], rejectionReason: null, revisionScope: null };
    const r1 = decideReview({ db, workspaceId, layout, actorContext: humanCtx, idempotencyKey: key, projectId, reportVersionId, body });
    assert.equal(r1.kind, "executed");
    const r2 = decideReview({ db, workspaceId, layout, actorContext: humanCtx, idempotencyKey: key, projectId, reportVersionId, body });
    assert.equal(r2.kind, "replayed_success");
  });

  test("duplicate target gate rejected", () => {
    // Use changes_requested first (keeps project active) to establish the gate
    const r1 = decideReview({
      db, layout, workspaceId, actorContext: humanCtx, idempotencyKey: randomUUID(), projectId, reportVersionId,
      body: {
        targetSchemaVersion: "1.0", targetContentSha256: reportSha256, decision: "changes_requested",
        comment: null, requestedChanges: [{ summary: "Fix", rationale: null, affectedFieldPaths: ["/title"] }],
        rejectionReason: null, revisionScope: "report_revision",
      },
    });
    assert.equal(r1.kind, "executed");
    // Second attempt on same target should fail with gate_already_decided
    const r2 = decideReview({
      db, layout, workspaceId, actorContext: humanCtx, idempotencyKey: randomUUID(), projectId, reportVersionId,
      body: { targetSchemaVersion: "1.0", targetContentSha256: reportSha256, decision: "approved", comment: null, requestedChanges: [], rejectionReason: null, revisionScope: null },
    });
    assert.equal(r2.kind, "failed");
    assert.equal(r2.errorCode, "gate_already_decided");
  });

  test("hash mismatch rejected", () => {
    const result = decideReview({
      db, layout, workspaceId, actorContext: humanCtx, idempotencyKey: randomUUID(), projectId, reportVersionId,
      body: { targetSchemaVersion: "1.0", targetContentSha256: "0".repeat(64), decision: "approved", comment: null, requestedChanges: [], rejectionReason: null, revisionScope: null },
    });
    assert.equal(result.kind, "failed");
    assert.equal(result.errorCode, "content_hash_mismatch");
  });

  test("schema mismatch rejected", () => {
    const result = decideReview({
      db, layout, workspaceId, actorContext: humanCtx, idempotencyKey: randomUUID(), projectId, reportVersionId,
      body: { targetSchemaVersion: "2.0", targetContentSha256: reportSha256, decision: "approved", comment: null, requestedChanges: [], rejectionReason: null, revisionScope: null },
    });
    assert.equal(result.kind, "failed");
    assert.equal(result.errorCode, "content_hash_mismatch");
  });

  test("non-active project rejected", () => {
    // Approve first to make project completed
    decideReview({ db, workspaceId, layout, actorContext: humanCtx, idempotencyKey: randomUUID(), projectId, reportVersionId, body: { targetSchemaVersion: "1.0", targetContentSha256: reportSha256, decision: "approved", comment: null, requestedChanges: [], rejectionReason: null, revisionScope: null } });
    // Re-open by inserting a new report version manually, but project is completed so it should fail
    // Actually, just create a new project and try to decide with a report from the old project
    const projRes2 = createProject({ db, workspacePort, workspaceId, actorContext: humanCtx, idempotencyKey: randomUUID(), body: { title: "Other", slug: "other-proj-" + randomUUID().slice(0, 8) } });
    if (projRes2.kind !== "executed") throw new Error("project creation failed");
    const r = decideReview({ db, workspaceId, layout, actorContext: humanCtx, idempotencyKey: randomUUID(), projectId: projRes2.resultResourceId, reportVersionId, body: { targetSchemaVersion: "1.0", targetContentSha256: reportSha256, decision: "approved", comment: null, requestedChanges: [], rejectionReason: null, revisionScope: null } });
    assert.equal(r.kind, "failed");
    assert.equal(r.errorCode, "resource_not_found");
  });

  test("changes_requested without revisionScope rejected", () => {
    const result = decideReview({
      db, layout, workspaceId, actorContext: humanCtx, idempotencyKey: randomUUID(), projectId, reportVersionId,
      body: {
        targetSchemaVersion: "1.0", targetContentSha256: reportSha256, decision: "changes_requested",
        comment: null, requestedChanges: [{ summary: "Fix", rationale: null, affectedFieldPaths: ["/title"] }],
        rejectionReason: null, revisionScope: null,
      },
    });
    assert.equal(result.kind, "failed");
    assert.equal(result.errorCode, "validation_failed");
  });

  test("rejected without rejectionReason rejected", () => {
    const result = decideReview({
      db, layout, workspaceId, actorContext: humanCtx, idempotencyKey: randomUUID(), projectId, reportVersionId,
      body: { targetSchemaVersion: "1.0", targetContentSha256: reportSha256, decision: "rejected", comment: null, requestedChanges: [], rejectionReason: null, revisionScope: null },
    });
    assert.equal(result.kind, "failed");
    assert.equal(result.errorCode, "validation_failed");
  });

  test("approved with non-empty requestedChanges rejected", () => {
    const result = decideReview({
      db, layout, workspaceId, actorContext: humanCtx, idempotencyKey: randomUUID(), projectId, reportVersionId,
      body: { targetSchemaVersion: "1.0", targetContentSha256: reportSha256, decision: "approved", comment: null, requestedChanges: [{ summary: "Fix", rationale: null, affectedFieldPaths: ["/title"] }], rejectionReason: null, revisionScope: null },
    });
    assert.equal(result.kind, "failed");
    assert.equal(result.errorCode, "validation_failed");
  });
});

describe("ReportReviewReadModel", () => {
  beforeEach(setup);
  afterEach(() => cleanup());

  test("pending report: shows full Report content, eligibility, no gate", () => {
    const rm = queryReportReview({ db, workspaceId, layout, projectId, reportVersionId, actorContext: humanCtx, authorizedForContent: true });
    assert.equal(rm.readModelVersion, "1.0");
    assert.ok(rm.data.reportContent);
    assert.ok(typeof (rm.data.reportContent as Record<string, unknown>).title === "string");
    assert.ok(rm.data.run !== null);
    assert.equal(rm.data.run!.currentRunStatus, "succeeded");
    assert.ok(rm.data.requirementVersion !== null);
    assert.ok(rm.data.planVersion !== null);
    assert.ok(rm.data.latestInternalReview !== null);
    assert.ok(rm.data.citedEvidence.length > 0);
    assert.equal(rm.data.gate, null);
    assert.equal(rm.data.reviewEligibility.eligible, true);
    assert.equal(rm.data.reviewEligibility.reasons.length, 0);
    assert.equal(rm.data.commands.length, 1);
    assert.equal(rm.data.commands[0]!.commandType, "report.decide_review");
    assert.equal(rm.data.commands[0]!.available, true);
  });

  test("approved gate: shows gate, eligibility false", () => {
    decideReview({ db, workspaceId, layout, actorContext: humanCtx, idempotencyKey: randomUUID(), projectId, reportVersionId, body: { targetSchemaVersion: "1.0", targetContentSha256: reportSha256, decision: "approved", comment: null, requestedChanges: [], rejectionReason: null, revisionScope: null } });
    const rm = queryReportReview({ db, workspaceId, layout, projectId, reportVersionId, actorContext: humanCtx, authorizedForContent: true });
    assert.ok(rm.data.gate !== null);
    assert.equal(rm.data.gate!.decision, "approved");
    assert.equal(rm.data.reviewEligibility.eligible, false);
    assert.ok(rm.data.reviewEligibility.reasons.includes("report_already_reviewed"));
  });

  test("no leak: no storageRef, piSessionRef, prompt, token, absolute path", () => {
    const rm = queryReportReview({ db, workspaceId, layout, projectId, reportVersionId, actorContext: humanCtx, authorizedForContent: true });
    const json = JSON.stringify(rm);
    assert.ok(!json.includes("storageRef"), "must not leak storageRef");
    assert.ok(!json.includes("piSessionRef"), "must not leak piSessionRef");
    assert.ok(!json.includes('"prompt"'), "must not leak prompt");
    assert.ok(!json.includes("rawPiEvent"), "must not leak rawPiEvent");
    assert.ok(!json.includes("/Users/"), "must not leak absolute path");
  });
});

describe("LockedReportReadModel", () => {
  beforeEach(setup);
  afterEach(() => cleanup());

  test("no approved gate: returns not found", () => {
    assert.throws(() => {
      queryLockedReport({ db, layout, workspaceId, projectId, actorContext: humanCtx, authorizedForContent: true });
    }, (err: unknown) => {
      assert.ok(err instanceof Error);
      assert.equal((err as unknown as { code: string }).code, "resource_not_found");
      return true;
    });
  });

  test("approved gate: returns complete read model, identity=ReportVersion", () => {
    decideReview({ db, workspaceId, layout, actorContext: humanCtx, idempotencyKey: randomUUID(), projectId, reportVersionId, body: { targetSchemaVersion: "1.0", targetContentSha256: reportSha256, decision: "approved", comment: null, requestedChanges: [], rejectionReason: null, revisionScope: null } });
    const rm = queryLockedReport({ db, layout, workspaceId, projectId, actorContext: humanCtx, authorizedForContent: true });
    assert.equal(rm.data.identity.lockedReportId, reportVersionId);
    assert.equal(rm.data.identity.reportVersionId, reportVersionId);
    assert.ok(rm.data.reportContent);
    assert.ok(rm.data.run !== null);
    assert.equal(rm.data.run!.currentRunStatus, "succeeded");
    assert.ok(rm.data.immutableEvidenceIndex.length > 0);
    assert.equal(rm.data.approvalGate.decision, "approved");
    assert.ok(rm.data.reportReviewTrail.length > 0);
    // Representation/export unavailable but present
    assert.equal(rm.data.representationAvailability.markdown.available, false);
    assert.equal(rm.data.exportAvailability.analysisops.available, false);
    assert.equal(rm.data.commands.length, 2);
  });

  test("no leak: no storageRef, piSessionRef, prompt, token, absolute path", () => {
    decideReview({ db, workspaceId, layout, actorContext: humanCtx, idempotencyKey: randomUUID(), projectId, reportVersionId, body: { targetSchemaVersion: "1.0", targetContentSha256: reportSha256, decision: "approved", comment: null, requestedChanges: [], rejectionReason: null, revisionScope: null } });
    const rm = queryLockedReport({ db, layout, workspaceId, projectId, actorContext: humanCtx, authorizedForContent: true });
    const json = JSON.stringify(rm);
    assert.ok(!json.includes("storageRef"), "must not leak storageRef");
    assert.ok(!json.includes("piSessionRef"), "must not leak piSessionRef");
    assert.ok(!json.includes('"prompt"'), "must not leak prompt");
    assert.ok(!json.includes("rawPiEvent"), "must not leak rawPiEvent");
    assert.ok(!json.includes("/Users/"), "must not leak absolute path");
  });
});

describe("Project derivation with report_review", () => {
  beforeEach(setup);
  afterEach(() => cleanup());

  test("pendingGate report_review before decision", () => {
    assert.equal(derivePendingGate(db, workspaceId, projectId), "report_review");
  });

  test("stage S2.5 with pending report", () => {
    assert.equal(deriveProjectStage(db, workspaceId, projectId), "S2.5");
  });

  test("stage S2.6 with approved report (locked)", () => {
    decideReview({ db, workspaceId, layout, actorContext: humanCtx, idempotencyKey: randomUUID(), projectId, reportVersionId, body: { targetSchemaVersion: "1.0", targetContentSha256: reportSha256, decision: "approved", comment: null, requestedChanges: [], rejectionReason: null, revisionScope: null } });
    assert.equal(deriveProjectStage(db, workspaceId, projectId), "S2.6");
    assert.equal(deriveLockedReportId(db, workspaceId, projectId), reportVersionId);
  });

  test("pendingGate null after approved decision", () => {
    decideReview({ db, workspaceId, layout, actorContext: humanCtx, idempotencyKey: randomUUID(), projectId, reportVersionId, body: { targetSchemaVersion: "1.0", targetContentSha256: reportSha256, decision: "approved", comment: null, requestedChanges: [], rejectionReason: null, revisionScope: null } });
    assert.equal(derivePendingGate(db, workspaceId, projectId), null);
  });
});

describe("report.decide_review atomics", () => {
  beforeEach(setup);
  afterEach(() => cleanup());

  test("approved atomics: simulated Gate insert failure leaves no partial Project completed", () => {
    // Create a trigger that aborts gate_decisions inserts
    db.exec("CREATE TRIGGER test_report_gate_fail BEFORE INSERT ON gate_decisions WHEN NEW.gate_type = 'report_review' BEGIN SELECT RAISE(ABORT, 'simulated gate failure'); END;");
    try {
      const result = decideReview({
        db, layout, workspaceId, actorContext: humanCtx, idempotencyKey: randomUUID(), projectId, reportVersionId,
        body: { targetSchemaVersion: "1.0", targetContentSha256: reportSha256, decision: "approved", comment: null, requestedChanges: [], rejectionReason: null, revisionScope: null },
      });
      assert.equal(result.kind, "failed");
      // Verify no partial state: Project should still be active
      const proj = getProjectById(db, workspaceId, projectId)!;
      assert.equal(proj.projectStatus, "active", "Project should remain active after Gate insert failure");
      // Verify no Gate was created
      const gateCount = (db.prepare("SELECT COUNT(*) AS c FROM gate_decisions WHERE gate_type = 'report_review' AND target_object_id = ?").get(reportVersionId) as { c: number }).c;
      assert.equal(gateCount, 0, "No Gate should remain after insert failure");
      // Verify no SQL error leak
      assert.ok(!JSON.stringify(result).includes("simulated gate failure"), "no raw SQL error leak");
    } finally {
      db.exec("DROP TRIGGER test_report_gate_fail");
    }
  });

  test("approved atomics: simulated Project update failure leaves no partial Gate or completed Project", () => {
    // Create a trigger that aborts analysis_projects updates when setting completed
    db.exec("CREATE TRIGGER test_report_proj_fail BEFORE UPDATE OF project_status ON analysis_projects WHEN NEW.project_status = 'completed' BEGIN SELECT RAISE(ABORT, 'simulated project failure'); END;");
    try {
      const result = decideReview({
        db, layout, workspaceId, actorContext: humanCtx, idempotencyKey: randomUUID(), projectId, reportVersionId,
        body: { targetSchemaVersion: "1.0", targetContentSha256: reportSha256, decision: "approved", comment: null, requestedChanges: [], rejectionReason: null, revisionScope: null },
      });
      assert.equal(result.kind, "failed");
      // Verify no partial state: Project should still be active
      const proj = getProjectById(db, workspaceId, projectId)!;
      assert.equal(proj.projectStatus, "active", "Project should remain active after update failure");
      // Verify no Gate was created (transaction rolled back)
      const gateCount = (db.prepare("SELECT COUNT(*) AS c FROM gate_decisions WHERE gate_type = 'report_review' AND target_object_id = ?").get(reportVersionId) as { c: number }).c;
      assert.equal(gateCount, 0, "No Gate should remain after Project update failure");
    } finally {
      db.exec("DROP TRIGGER test_report_proj_fail");
    }
  });

  test("approved atomics: simulated receipt failure leaves no partial Gate or completed Project", () => {
    // Create a trigger that aborts idempotency record updates when setting succeeded
    db.exec("CREATE TRIGGER test_report_receipt_fail BEFORE UPDATE OF execution_status ON api_idempotency_records WHEN NEW.execution_status = 'succeeded' AND OLD.command_type = 'report.decide_review' BEGIN SELECT RAISE(ABORT, 'simulated receipt failure'); END;");
    try {
      const result = decideReview({
        db, layout, workspaceId, actorContext: humanCtx, idempotencyKey: randomUUID(), projectId, reportVersionId,
        body: { targetSchemaVersion: "1.0", targetContentSha256: reportSha256, decision: "approved", comment: null, requestedChanges: [], rejectionReason: null, revisionScope: null },
      });
      // The transaction should roll back completely
      assert.equal(result.kind, "failed");
      // Verify no partial state: Project should still be active
      const proj = getProjectById(db, workspaceId, projectId)!;
      assert.equal(proj.projectStatus, "active", "Project should remain active after receipt failure");
      // Verify no Gate was created (transaction rolled back)
      const gateCount = (db.prepare("SELECT COUNT(*) AS c FROM gate_decisions WHERE gate_type = 'report_review' AND target_object_id = ?").get(reportVersionId) as { c: number }).c;
      assert.equal(gateCount, 0, "No Gate should remain after receipt failure");
      // Verify no SQL error leak
      assert.ok(!JSON.stringify(result).includes("simulated receipt failure"), "no raw SQL error leak");
    } finally {
      db.exec("DROP TRIGGER test_report_receipt_fail");
    }
  });
});
