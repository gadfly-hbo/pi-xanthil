/**
 * S3.x Business Closure application tests (T0020).
 *
 * Covers closure command services, read models, and stage derivation.
 * Authority: docs/workcanger-s3-business-closure-structure-ledger.md §20 C1R/C2R.
 */
import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { runMigrations, loadMigrations } from "../persistence/migration-runner.ts";
import { openDatabase, listTables } from "../persistence/db.ts";
import { createTempDataRoot, type TempDataRoot } from "./persistence-helpers.ts";
import { ApplicationError } from "../contracts/envelope.ts";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

// Application layer imports
import {
  initiateClosureCycle,
  recordS31Translation,
  recordS32Deployment,
  recordS33Execution,
  appendS34Feedback,
  recordS35Evaluation,
  recordS36Trigger,
} from "../application/closure/closure-service.ts";
import {
  queryClosureDetail,
  queryClosureList,
} from "../application/closure/closure-read-model.ts";
import { deriveProjectStage } from "../application/read-models/project-derivation.ts";

let temp: TempDataRoot;
let db: DatabaseSync;

beforeEach(async () => {
  temp = createTempDataRoot();
  const migrationsDir = join(import.meta.dirname, "..", "persistence", "migrations");
  db = openDatabase(temp.layout.sqlitePath);
  await runMigrations(db, loadMigrations(migrationsDir), temp.layout);
});
afterEach(() => { db.close(); temp.cleanup(); });

const WS = "ws-test", WS2 = "ws-other";
function uuid(): string { return randomUUID(); }
function now(): string { return new Date().toISOString(); }
function sha256(): string { return "a".repeat(64); }

function insertActor(): string {
  const id = uuid();
  db.prepare(`INSERT INTO audit_actors (audit_actor_id, actor_kind, actor_key, display_name, created_at) VALUES (?, 'human', ?, ?, ?)`).run(id, `k-${id}`, `A ${id}`, now());
  return id;
}

function insertProject(ws: string = WS): string {
  const id = uuid(); const a = insertActor();
  db.prepare(`INSERT INTO analysis_projects (analysis_project_id, workspace_id, project_kind, title, slug, project_status, created_at, created_by_actor_id, updated_at) VALUES (?, ?, 'daily_analysis', 'T', ?, 'active', ?, ?, ?)`).run(id, ws, `s-${id}`, now(), a, now());
  return id;
}

function insertFullPipeline(projectId: string): string {
  const a = insertActor(); const reqId = uuid(); const rvId = uuid(); const pvId = uuid(); const runId = uuid(); const repId = uuid();
  db.prepare(`INSERT INTO analysis_requests (analysis_request_id, analysis_project_id, raw_request_text, submitted_context_evidence_ids_json, submitted_at, submitted_by_actor_id, submitted_via, locale, timezone) VALUES (?, ?, 'r', '[]', ?, ?, 'web_ui', 'en', 'UTC')`).run(reqId, projectId, now(), a);
  db.prepare(`INSERT INTO structured_requirement_versions (structured_requirement_version_id, analysis_project_id, analysis_request_id, version_ordinal, schema_version, content_sha256, storage_ref, created_at, created_by_actor_id) VALUES (?, ?, ?, 1, '1.0', ?, 'blobs/aa/a', ?, ?)`).run(rvId, projectId, reqId, sha256(), now(), a);
  db.prepare(`INSERT INTO analysis_plan_versions (analysis_plan_version_id, analysis_project_id, structured_requirement_version_id, version_ordinal, schema_version, content_sha256, storage_ref, created_at, created_by_actor_id) VALUES (?, ?, ?, 1, '1.0', ?, 'blobs/bb/b', ?, ?)`).run(pvId, projectId, rvId, sha256(), now(), a);
  db.prepare(`INSERT INTO analysis_runs (analysis_run_id, analysis_project_id, analysis_plan_version_id, run_ordinal, current_analysis_stage, current_run_status, queued_at, started_at, ended_at, triggered_by_actor_id) VALUES (?, ?, ?, 1, 'S2.4', 'succeeded', ?, ?, ?, ?)`).run(runId, projectId, pvId, now(), now(), now(), a);
  db.prepare(`INSERT INTO report_versions (report_version_id, analysis_project_id, analysis_run_id, structured_requirement_version_id, analysis_plan_version_id, version_ordinal, schema_version, content_sha256, storage_ref, created_at, created_by_actor_id) VALUES (?, ?, ?, ?, ?, 1, '1.0', ?, 'blobs/cc/c', ?, ?)`).run(repId, projectId, runId, rvId, pvId, sha256(), now(), a);
  return repId;
}

function insertApprovedGate(projectId: string, reportId: string): void {
  const a = insertActor();
  db.prepare(`INSERT INTO gate_decisions (gate_decision_id, analysis_project_id, gate_type, target_object_type, target_object_id, target_schema_version, target_content_sha256, decision, decided_at, decided_by_actor_id, actor_display_name_snapshot, comment, requested_changes_json, submitted_via) VALUES (?, ?, 'report_review', 'report_version', ?, '1.0', ?, 'approved', ?, ?, 'Test Actor', NULL, '[]', 'web_ui')`).run(uuid(), projectId, reportId, sha256(), now(), a);
}

function setupLockedProject(ws: string = WS): { projectId: string; reportId: string } {
  const projectId = insertProject(ws);
  const reportId = insertFullPipeline(projectId);
  insertApprovedGate(projectId, reportId);
  return { projectId, reportId };
}

function assertAppError(fn: () => unknown, code: string): void {
  assert.throws(fn, (e: unknown) => e instanceof ApplicationError && (e as ApplicationError).code === code);
}

// ---------------------------------------------------------------------------
// Closure command service tests
// ---------------------------------------------------------------------------

describe("closure command services", () => {
  test("initiateClosureCycle creates cycle", () => {
    const { projectId, reportId } = setupLockedProject();
    const cycle = initiateClosureCycle(db, {
      closureCycleId: uuid(), analysisProjectId: projectId, workspaceId: WS,
      lockedReportVersionId: reportId, closureOrdinal: 1, initiatedByActorId: insertActor(),
    });
    assert.ok(cycle.closure_cycle_id);
    assert.equal(cycle.cycle_status, "initiated");
    assert.equal(cycle.current_stage, null);
  });

  test("initiateClosureCycle rejects wrong workspace", () => {
    const { projectId, reportId } = setupLockedProject();
    assertAppError(() => initiateClosureCycle(db, {
      closureCycleId: uuid(), analysisProjectId: projectId, workspaceId: WS2,
      lockedReportVersionId: reportId, closureOrdinal: 1, initiatedByActorId: insertActor(),
    }), "resource_not_found");
  });

  test("initiateClosureCycle rejects duplicate ordinal", () => {
    const { projectId, reportId } = setupLockedProject();
    initiateClosureCycle(db, {
      closureCycleId: uuid(), analysisProjectId: projectId, workspaceId: WS,
      lockedReportVersionId: reportId, closureOrdinal: 1, initiatedByActorId: insertActor(),
    });
    assertAppError(() => initiateClosureCycle(db, {
      closureCycleId: uuid(), analysisProjectId: projectId, workspaceId: WS,
      lockedReportVersionId: reportId, closureOrdinal: 1, initiatedByActorId: insertActor(),
    }), "validation_failed");
  });

  test("full S3.1-S3.6 chain succeeds", () => {
    const { projectId, reportId } = setupLockedProject();
    const actor = insertActor();
    const cycle = initiateClosureCycle(db, {
      closureCycleId: uuid(), analysisProjectId: projectId, workspaceId: WS,
      lockedReportVersionId: reportId, closureOrdinal: 1, initiatedByActorId: actor,
    });
    const cid = cycle.closure_cycle_id;

    recordS31Translation(db, {
      translationId: uuid(), closureCycleId: cid, workspaceId: WS,
      businessActionArtifactRef: "ref", businessActionContentSha256: sha256(),
      selectedRecommendationsJson: "[]", businessRulesJson: "[]",
      thresholdsJson: "[]", segmentsJson: "[]", grayReleaseTargetsJson: "[]",
      feedbackMetricDefinitionsJson: "[]", translationStatus: "confirmed",
      confirmedAt: now(), confirmedByActorId: actor,
    });
    recordS32Deployment(db, {
      deploymentId: uuid(), closureCycleId: cid, workspaceId: WS,
      downstreamSystem: "cdp_tag_engine", deploymentTicketRef: "T",
      grayConfigJson: "{}", rollbackPath: "rb", deploymentStatus: "fully_deployed",
      confirmedAt: now(), confirmedByActorId: actor,
    });
    recordS33Execution(db, {
      executionId: uuid(), closureCycleId: cid, workspaceId: WS,
      businessScopeJson: "{}", ownerRole: "marketing",
      executionWindowStart: now(), executionWindowEnd: now(),
      actionVersion: "v1", touchedPopulation: 100, executionLogRef: null,
      feedbackSource: "combined",
    });
    appendS34Feedback(db, {
      ingestionId: uuid(), closureCycleId: cid, workspaceId: WS,
      feedbackOrdinal: 1, feedbackDatasetRef: "ds", metricsJson: "[]",
      statisticalSignificance: "reached", piHandoffRef: null,
      antigravityReviewStatus: "passed", reviewedAt: now(), reviewedByActorId: actor,
    });
    recordS35Evaluation(db, {
      evaluationId: uuid(), closureCycleId: cid, workspaceId: WS,
      evaluationReportRef: "ref", evaluationReportSha256: sha256(),
      deviationAnalysisJson: "{}", hypothesisResult: "confirmed",
      effectivenessRating: "met_expectations", reviewerActorId: actor, reviewedAt: now(),
    });
    recordS36Trigger(db, {
      triggerId: uuid(), closureCycleId: cid, workspaceId: WS,
      branch: "archive", targetState: null, successorProjectId: null,
      workOrderRef: null, knowledgeBaseUpdateRef: null,
      triggeredAt: now(), triggeredByActorId: actor,
    });
  });

  test("S3.2 requires S3.1 prerequisite", () => {
    const { projectId, reportId } = setupLockedProject();
    const cycle = initiateClosureCycle(db, {
      closureCycleId: uuid(), analysisProjectId: projectId, workspaceId: WS,
      lockedReportVersionId: reportId, closureOrdinal: 1, initiatedByActorId: insertActor(),
    });
    assertAppError(() => recordS32Deployment(db, {
      deploymentId: uuid(), closureCycleId: cycle.closure_cycle_id, workspaceId: WS,
      downstreamSystem: "cdp_tag_engine", deploymentTicketRef: "T",
      grayConfigJson: "{}", rollbackPath: "rb", deploymentStatus: "pending",
      confirmedAt: null, confirmedByActorId: null,
    }), "validation_failed");
  });

  test("S3.4 append-only preserves multiple entries", () => {
    const { projectId, reportId } = setupLockedProject();
    const actor = insertActor();
    const cycle = initiateClosureCycle(db, {
      closureCycleId: uuid(), analysisProjectId: projectId, workspaceId: WS,
      lockedReportVersionId: reportId, closureOrdinal: 1, initiatedByActorId: actor,
    });
    const cid = cycle.closure_cycle_id;

    recordS31Translation(db, {
      translationId: uuid(), closureCycleId: cid, workspaceId: WS,
      businessActionArtifactRef: "ref", businessActionContentSha256: sha256(),
      selectedRecommendationsJson: "[]", businessRulesJson: "[]",
      thresholdsJson: "[]", segmentsJson: "[]", grayReleaseTargetsJson: "[]",
      feedbackMetricDefinitionsJson: "[]", translationStatus: "confirmed",
      confirmedAt: now(), confirmedByActorId: actor,
    });
    recordS32Deployment(db, {
      deploymentId: uuid(), closureCycleId: cid, workspaceId: WS,
      downstreamSystem: "cdp_tag_engine", deploymentTicketRef: "T",
      grayConfigJson: "{}", rollbackPath: "rb", deploymentStatus: "fully_deployed",
      confirmedAt: now(), confirmedByActorId: actor,
    });
    recordS33Execution(db, {
      executionId: uuid(), closureCycleId: cid, workspaceId: WS,
      businessScopeJson: "{}", ownerRole: "marketing",
      executionWindowStart: now(), executionWindowEnd: now(),
      actionVersion: "v1", touchedPopulation: null, executionLogRef: null,
      feedbackSource: "execution_log",
    });

    // Append 3 feedback entries
    const id1 = uuid(), id2 = uuid(), id3 = uuid();
    appendS34Feedback(db, { ingestionId: id1, closureCycleId: cid, workspaceId: WS, feedbackOrdinal: 1, feedbackDatasetRef: "ds-1", metricsJson: "[1]", statisticalSignificance: "not_reached", piHandoffRef: null, antigravityReviewStatus: "pending", reviewedAt: null, reviewedByActorId: null });
    appendS34Feedback(db, { ingestionId: id2, closureCycleId: cid, workspaceId: WS, feedbackOrdinal: 2, feedbackDatasetRef: "ds-2", metricsJson: "[2]", statisticalSignificance: "reached", piHandoffRef: null, antigravityReviewStatus: "passed", reviewedAt: now(), reviewedByActorId: actor });
    appendS34Feedback(db, { ingestionId: id3, closureCycleId: cid, workspaceId: WS, feedbackOrdinal: 3, feedbackDatasetRef: "ds-3", metricsJson: "[3]", statisticalSignificance: "reached", piHandoffRef: null, antigravityReviewStatus: "pending", reviewedAt: null, reviewedByActorId: null });

    // Verify via read model
    const detail = queryClosureDetail({ db, workspaceId: WS, closureCycleId: cid });
    assert.equal(detail.data.s34.length, 3);
    assert.equal(detail.data.s34[0]!.ingestionId, id1);
    assert.equal(detail.data.s34[0]!.feedbackOrdinal, 1);
    assert.equal(detail.data.s34[1]!.ingestionId, id2);
    assert.equal(detail.data.s34[2]!.ingestionId, id3);
  });
});

// ---------------------------------------------------------------------------
// Read model tests
// ---------------------------------------------------------------------------

describe("closure read models", () => {
  test("queryClosureDetail returns cycle and stage facts", () => {
    const { projectId, reportId } = setupLockedProject();
    const actor = insertActor();
    const cycle = initiateClosureCycle(db, {
      closureCycleId: uuid(), analysisProjectId: projectId, workspaceId: WS,
      lockedReportVersionId: reportId, closureOrdinal: 1, initiatedByActorId: actor,
    });
    const cid = cycle.closure_cycle_id;

    // Insert S3.1 fact
    recordS31Translation(db, {
      translationId: uuid(), closureCycleId: cid, workspaceId: WS,
      businessActionArtifactRef: "ref", businessActionContentSha256: sha256(),
      selectedRecommendationsJson: "[]", businessRulesJson: "[]",
      thresholdsJson: "[]", segmentsJson: "[]", grayReleaseTargetsJson: "[]",
      feedbackMetricDefinitionsJson: "[]", translationStatus: "confirmed",
      confirmedAt: now(), confirmedByActorId: actor,
    });

    const detail = queryClosureDetail({ db, workspaceId: WS, closureCycleId: cid });
    assert.equal(detail.data.cycle.closureCycleId, cid);
    assert.equal(detail.data.cycle.cycleStatus, "initiated");
    assert.ok(detail.data.s31);
    assert.equal(detail.data.s31.translationStatus, "confirmed");
    assert.equal(detail.data.s32, null);
    assert.equal(detail.data.s34.length, 0);
  });

  test("queryClosureDetail rejects wrong workspace", () => {
    const { projectId, reportId } = setupLockedProject();
    const cycle = initiateClosureCycle(db, {
      closureCycleId: uuid(), analysisProjectId: projectId, workspaceId: WS,
      lockedReportVersionId: reportId, closureOrdinal: 1, initiatedByActorId: insertActor(),
    });
    assertAppError(() => queryClosureDetail({ db, workspaceId: WS2, closureCycleId: cycle.closure_cycle_id }), "resource_not_found");
  });

  test("queryClosureList returns all cycles for a project", () => {
    const { projectId, reportId } = setupLockedProject();
    initiateClosureCycle(db, {
      closureCycleId: uuid(), analysisProjectId: projectId, workspaceId: WS,
      lockedReportVersionId: reportId, closureOrdinal: 1, initiatedByActorId: insertActor(),
    });
    initiateClosureCycle(db, {
      closureCycleId: uuid(), analysisProjectId: projectId, workspaceId: WS,
      lockedReportVersionId: reportId, closureOrdinal: 2, initiatedByActorId: insertActor(),
    });

    const list = queryClosureList({ db, workspaceId: WS, analysisProjectId: projectId });
    assert.equal(list.data.length, 2);
    assert.equal(list.data[0]!.closureOrdinal, 1);
    assert.equal(list.data[1]!.closureOrdinal, 2);
  });

  test("queryClosureList returns empty for wrong workspace", () => {
    const { projectId, reportId } = setupLockedProject();
    initiateClosureCycle(db, {
      closureCycleId: uuid(), analysisProjectId: projectId, workspaceId: WS,
      lockedReportVersionId: reportId, closureOrdinal: 1, initiatedByActorId: insertActor(),
    });
    const list = queryClosureList({ db, workspaceId: WS2, analysisProjectId: projectId });
    assert.equal(list.data.length, 0);
  });
});

// ---------------------------------------------------------------------------
// Stage derivation tests
// ---------------------------------------------------------------------------

describe("closure stage derivation", () => {
  test("S2.6 when locked report but no closure cycle", () => {
    const { projectId } = setupLockedProject();
    assert.equal(deriveProjectStage(db, WS, projectId), "S2.6");
  });

  test("S3.1 when closure cycle has S3.1 fact", () => {
    const { projectId, reportId } = setupLockedProject();
    const actor = insertActor();
    const cycle = initiateClosureCycle(db, {
      closureCycleId: uuid(), analysisProjectId: projectId, workspaceId: WS,
      lockedReportVersionId: reportId, closureOrdinal: 1, initiatedByActorId: actor,
    });
    recordS31Translation(db, {
      translationId: uuid(), closureCycleId: cycle.closure_cycle_id, workspaceId: WS,
      businessActionArtifactRef: "ref", businessActionContentSha256: sha256(),
      selectedRecommendationsJson: "[]", businessRulesJson: "[]",
      thresholdsJson: "[]", segmentsJson: "[]", grayReleaseTargetsJson: "[]",
      feedbackMetricDefinitionsJson: "[]", translationStatus: "confirmed",
      confirmedAt: now(), confirmedByActorId: actor,
    });
    assert.equal(deriveProjectStage(db, WS, projectId), "S3.1");
  });

  test("S3.4 when closure cycle has feedback entries", () => {
    const { projectId, reportId } = setupLockedProject();
    const actor = insertActor();
    const cycle = initiateClosureCycle(db, {
      closureCycleId: uuid(), analysisProjectId: projectId, workspaceId: WS,
      lockedReportVersionId: reportId, closureOrdinal: 1, initiatedByActorId: actor,
    });
    const cid = cycle.closure_cycle_id;
    recordS31Translation(db, {
      translationId: uuid(), closureCycleId: cid, workspaceId: WS,
      businessActionArtifactRef: "ref", businessActionContentSha256: sha256(),
      selectedRecommendationsJson: "[]", businessRulesJson: "[]",
      thresholdsJson: "[]", segmentsJson: "[]", grayReleaseTargetsJson: "[]",
      feedbackMetricDefinitionsJson: "[]", translationStatus: "confirmed",
      confirmedAt: now(), confirmedByActorId: actor,
    });
    recordS32Deployment(db, {
      deploymentId: uuid(), closureCycleId: cid, workspaceId: WS,
      downstreamSystem: "cdp_tag_engine", deploymentTicketRef: "T",
      grayConfigJson: "{}", rollbackPath: "rb", deploymentStatus: "fully_deployed",
      confirmedAt: now(), confirmedByActorId: actor,
    });
    recordS33Execution(db, {
      executionId: uuid(), closureCycleId: cid, workspaceId: WS,
      businessScopeJson: "{}", ownerRole: "r",
      executionWindowStart: now(), executionWindowEnd: now(),
      actionVersion: "v1", touchedPopulation: null, executionLogRef: null,
      feedbackSource: "execution_log",
    });
    appendS34Feedback(db, {
      ingestionId: uuid(), closureCycleId: cid, workspaceId: WS,
      feedbackOrdinal: 1, feedbackDatasetRef: "ds", metricsJson: "[]",
      statisticalSignificance: "pending", piHandoffRef: null,
      antigravityReviewStatus: "pending", reviewedAt: null, reviewedByActorId: null,
    });
    assert.equal(deriveProjectStage(db, WS, projectId), "S3.4");
  });

  test("S3.6 when full chain completed", () => {
    const { projectId, reportId } = setupLockedProject();
    const actor = insertActor();
    const cycle = initiateClosureCycle(db, {
      closureCycleId: uuid(), analysisProjectId: projectId, workspaceId: WS,
      lockedReportVersionId: reportId, closureOrdinal: 1, initiatedByActorId: actor,
    });
    const cid = cycle.closure_cycle_id;
    recordS31Translation(db, {
      translationId: uuid(), closureCycleId: cid, workspaceId: WS,
      businessActionArtifactRef: "ref", businessActionContentSha256: sha256(),
      selectedRecommendationsJson: "[]", businessRulesJson: "[]",
      thresholdsJson: "[]", segmentsJson: "[]", grayReleaseTargetsJson: "[]",
      feedbackMetricDefinitionsJson: "[]", translationStatus: "confirmed",
      confirmedAt: now(), confirmedByActorId: actor,
    });
    recordS32Deployment(db, {
      deploymentId: uuid(), closureCycleId: cid, workspaceId: WS,
      downstreamSystem: "cdp_tag_engine", deploymentTicketRef: "T",
      grayConfigJson: "{}", rollbackPath: "rb", deploymentStatus: "fully_deployed",
      confirmedAt: now(), confirmedByActorId: actor,
    });
    recordS33Execution(db, {
      executionId: uuid(), closureCycleId: cid, workspaceId: WS,
      businessScopeJson: "{}", ownerRole: "r",
      executionWindowStart: now(), executionWindowEnd: now(),
      actionVersion: "v1", touchedPopulation: null, executionLogRef: null,
      feedbackSource: "execution_log",
    });
    appendS34Feedback(db, {
      ingestionId: uuid(), closureCycleId: cid, workspaceId: WS,
      feedbackOrdinal: 1, feedbackDatasetRef: "ds", metricsJson: "[]",
      statisticalSignificance: "pending", piHandoffRef: null,
      antigravityReviewStatus: "pending", reviewedAt: null, reviewedByActorId: null,
    });
    recordS35Evaluation(db, {
      evaluationId: uuid(), closureCycleId: cid, workspaceId: WS,
      evaluationReportRef: "ref", evaluationReportSha256: sha256(),
      deviationAnalysisJson: "{}", hypothesisResult: "confirmed",
      effectivenessRating: "met_expectations", reviewerActorId: actor, reviewedAt: now(),
    });
    recordS36Trigger(db, {
      triggerId: uuid(), closureCycleId: cid, workspaceId: WS,
      branch: "archive", targetState: null, successorProjectId: null,
      workOrderRef: null, knowledgeBaseUpdateRef: null,
      triggeredAt: now(), triggeredByActorId: actor,
    });
    assert.equal(deriveProjectStage(db, WS, projectId), "S3.6");
  });

  test("uses latest cycle when multiple exist", () => {
    const { projectId, reportId } = setupLockedProject();
    const actor = insertActor();

    // First cycle — only S3.1
    const c1 = initiateClosureCycle(db, {
      closureCycleId: uuid(), analysisProjectId: projectId, workspaceId: WS,
      lockedReportVersionId: reportId, closureOrdinal: 1, initiatedByActorId: actor,
    });
    recordS31Translation(db, {
      translationId: uuid(), closureCycleId: c1.closure_cycle_id, workspaceId: WS,
      businessActionArtifactRef: "ref", businessActionContentSha256: sha256(),
      selectedRecommendationsJson: "[]", businessRulesJson: "[]",
      thresholdsJson: "[]", segmentsJson: "[]", grayReleaseTargetsJson: "[]",
      feedbackMetricDefinitionsJson: "[]", translationStatus: "confirmed",
      confirmedAt: now(), confirmedByActorId: actor,
    });

    // Second cycle — S3.1 + S3.2
    const c2 = initiateClosureCycle(db, {
      closureCycleId: uuid(), analysisProjectId: projectId, workspaceId: WS,
      lockedReportVersionId: reportId, closureOrdinal: 2, initiatedByActorId: actor,
    });
    recordS31Translation(db, {
      translationId: uuid(), closureCycleId: c2.closure_cycle_id, workspaceId: WS,
      businessActionArtifactRef: "ref", businessActionContentSha256: sha256(),
      selectedRecommendationsJson: "[]", businessRulesJson: "[]",
      thresholdsJson: "[]", segmentsJson: "[]", grayReleaseTargetsJson: "[]",
      feedbackMetricDefinitionsJson: "[]", translationStatus: "confirmed",
      confirmedAt: now(), confirmedByActorId: actor,
    });
    recordS32Deployment(db, {
      deploymentId: uuid(), closureCycleId: c2.closure_cycle_id, workspaceId: WS,
      downstreamSystem: "cdp_tag_engine", deploymentTicketRef: "T",
      grayConfigJson: "{}", rollbackPath: "rb", deploymentStatus: "fully_deployed",
      confirmedAt: now(), confirmedByActorId: actor,
    });

    // Should show S3.2 from the latest cycle
    assert.equal(deriveProjectStage(db, WS, projectId), "S3.2");
  });
});

// ---------------------------------------------------------------------------
// Read-model assembly corruption/drift tests
// ---------------------------------------------------------------------------

describe("read-model assembly workspace scoping (corruption/drift)", () => {
  test("child S3.1 fact not returned for wrong workspace via direct detail query", () => {
    const { projectId, reportId } = setupLockedProject();
    const actor = insertActor();
    const cycle = initiateClosureCycle(db, {
      closureCycleId: uuid(), analysisProjectId: projectId, workspaceId: WS,
      lockedReportVersionId: reportId, closureOrdinal: 1, initiatedByActorId: actor,
    });
    recordS31Translation(db, {
      translationId: uuid(), closureCycleId: cycle.closure_cycle_id, workspaceId: WS,
      businessActionArtifactRef: "ref", businessActionContentSha256: sha256(),
      selectedRecommendationsJson: "[]", businessRulesJson: "[]",
      thresholdsJson: "[]", segmentsJson: "[]", grayReleaseTargetsJson: "[]",
      feedbackMetricDefinitionsJson: "[]", translationStatus: "confirmed",
      confirmedAt: now(), confirmedByActorId: actor,
    });

    // Correct workspace returns S3.1
    const detail = queryClosureDetail({ db, workspaceId: WS, closureCycleId: cycle.closure_cycle_id });
    assert.ok(detail.data.s31, "S3.1 should be present for correct workspace");

    // Direct SQL without workspace JOIN returns the row (demonstrates corruption vector)
    const direct = db.prepare(`SELECT * FROM s31_conclusion_translations WHERE closure_cycle_id = ?`).get(cycle.closure_cycle_id);
    assert.ok(direct, "Direct SQL without workspace filter returns the row");

    // But queryClosureDetail with wrong workspace throws resource_not_found at cycle level
    assertAppError(() => queryClosureDetail({ db, workspaceId: WS2, closureCycleId: cycle.closure_cycle_id }), "resource_not_found");
  });

  test("child S3.4 facts workspace-scoped via JOIN", () => {
    const { projectId, reportId } = setupLockedProject();
    const actor = insertActor();
    const cycle = initiateClosureCycle(db, {
      closureCycleId: uuid(), analysisProjectId: projectId, workspaceId: WS,
      lockedReportVersionId: reportId, closureOrdinal: 1, initiatedByActorId: actor,
    });
    const cid = cycle.closure_cycle_id;
    recordS31Translation(db, {
      translationId: uuid(), closureCycleId: cid, workspaceId: WS,
      businessActionArtifactRef: "ref", businessActionContentSha256: sha256(),
      selectedRecommendationsJson: "[]", businessRulesJson: "[]",
      thresholdsJson: "[]", segmentsJson: "[]", grayReleaseTargetsJson: "[]",
      feedbackMetricDefinitionsJson: "[]", translationStatus: "confirmed",
      confirmedAt: now(), confirmedByActorId: actor,
    });
    recordS32Deployment(db, {
      deploymentId: uuid(), closureCycleId: cid, workspaceId: WS,
      downstreamSystem: "cdp_tag_engine", deploymentTicketRef: "T",
      grayConfigJson: "{}", rollbackPath: "rb", deploymentStatus: "fully_deployed",
      confirmedAt: now(), confirmedByActorId: actor,
    });
    recordS33Execution(db, {
      executionId: uuid(), closureCycleId: cid, workspaceId: WS,
      businessScopeJson: "{}", ownerRole: "r",
      executionWindowStart: now(), executionWindowEnd: now(),
      actionVersion: "v1", touchedPopulation: null, executionLogRef: null,
      feedbackSource: "execution_log",
    });
    appendS34Feedback(db, {
      ingestionId: uuid(), closureCycleId: cid, workspaceId: WS,
      feedbackOrdinal: 1, feedbackDatasetRef: "ds-1", metricsJson: "[1]",
      statisticalSignificance: "pending", piHandoffRef: null,
      antigravityReviewStatus: "pending", reviewedAt: null, reviewedByActorId: null,
    });
    appendS34Feedback(db, {
      ingestionId: uuid(), closureCycleId: cid, workspaceId: WS,
      feedbackOrdinal: 2, feedbackDatasetRef: "ds-2", metricsJson: "[2]",
      statisticalSignificance: "reached", piHandoffRef: null,
      antigravityReviewStatus: "passed", reviewedAt: now(), reviewedByActorId: actor,
    });

    // Correct workspace returns 2 feedback entries
    const detail = queryClosureDetail({ db, workspaceId: WS, closureCycleId: cid });
    assert.equal(detail.data.s34.length, 2, "Should return 2 feedback entries for correct workspace");

    // Direct SQL without workspace JOIN returns the rows (demonstrates corruption vector)
    const directRows = db.prepare(`SELECT * FROM s34_feedback_ingestions WHERE closure_cycle_id = ?`).all(cid);
    assert.equal(directRows.length, 2, "Direct SQL without workspace filter returns rows");

    // Wrong workspace at cycle level throws
    assertAppError(() => queryClosureDetail({ db, workspaceId: WS2, closureCycleId: cid }), "resource_not_found");
  });

  test("child S3.5/S3.6 facts workspace-scoped via JOIN", () => {
    const { projectId, reportId } = setupLockedProject();
    const actor = insertActor();
    const cycle = initiateClosureCycle(db, {
      closureCycleId: uuid(), analysisProjectId: projectId, workspaceId: WS,
      lockedReportVersionId: reportId, closureOrdinal: 1, initiatedByActorId: actor,
    });
    const cid = cycle.closure_cycle_id;
    recordS31Translation(db, {
      translationId: uuid(), closureCycleId: cid, workspaceId: WS,
      businessActionArtifactRef: "ref", businessActionContentSha256: sha256(),
      selectedRecommendationsJson: "[]", businessRulesJson: "[]",
      thresholdsJson: "[]", segmentsJson: "[]", grayReleaseTargetsJson: "[]",
      feedbackMetricDefinitionsJson: "[]", translationStatus: "confirmed",
      confirmedAt: now(), confirmedByActorId: actor,
    });
    recordS32Deployment(db, {
      deploymentId: uuid(), closureCycleId: cid, workspaceId: WS,
      downstreamSystem: "cdp_tag_engine", deploymentTicketRef: "T",
      grayConfigJson: "{}", rollbackPath: "rb", deploymentStatus: "fully_deployed",
      confirmedAt: now(), confirmedByActorId: actor,
    });
    recordS33Execution(db, {
      executionId: uuid(), closureCycleId: cid, workspaceId: WS,
      businessScopeJson: "{}", ownerRole: "r",
      executionWindowStart: now(), executionWindowEnd: now(),
      actionVersion: "v1", touchedPopulation: null, executionLogRef: null,
      feedbackSource: "execution_log",
    });
    appendS34Feedback(db, {
      ingestionId: uuid(), closureCycleId: cid, workspaceId: WS,
      feedbackOrdinal: 1, feedbackDatasetRef: "ds", metricsJson: "[]",
      statisticalSignificance: "pending", piHandoffRef: null,
      antigravityReviewStatus: "pending", reviewedAt: null, reviewedByActorId: null,
    });
    recordS35Evaluation(db, {
      evaluationId: uuid(), closureCycleId: cid, workspaceId: WS,
      evaluationReportRef: "ref", evaluationReportSha256: sha256(),
      deviationAnalysisJson: "{}", hypothesisResult: "confirmed",
      effectivenessRating: "met_expectations", reviewerActorId: actor, reviewedAt: now(),
    });
    recordS36Trigger(db, {
      triggerId: uuid(), closureCycleId: cid, workspaceId: WS,
      branch: "archive", targetState: null, successorProjectId: null,
      workOrderRef: null, knowledgeBaseUpdateRef: null,
      triggeredAt: now(), triggeredByActorId: actor,
    });

    const detail = queryClosureDetail({ db, workspaceId: WS, closureCycleId: cid });
    assert.ok(detail.data.s35, "S3.5 should be present");
    assert.ok(detail.data.s36, "S3.6 should be present");

    // Wrong workspace throws at cycle level
    assertAppError(() => queryClosureDetail({ db, workspaceId: WS2, closureCycleId: cid }), "resource_not_found");
  });
});
