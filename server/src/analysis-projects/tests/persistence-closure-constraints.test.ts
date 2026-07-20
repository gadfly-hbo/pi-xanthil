/**
 * S3 Business Closure persistence tests (T0019 revised per C1R/C2R).
 * Covers 7 tables: closure_cycles + S3.1-S3.6 stage facts.
 */
import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { runMigrations, loadMigrations } from "../persistence/migration-runner.ts";
import { openDatabase, listTables, listAllIndexes } from "../persistence/db.ts";
import { createTempDataRoot, type TempDataRoot } from "./persistence-helpers.ts";
import {
  insertClosureCycle, getClosureCycleById, listClosureCyclesByProject, countClosureCyclesByProject,
  insertS31Translation, getS31Translation,
  insertS32Deployment, getS32Deployment,
  insertS33Execution, getS33Execution,
  insertS34Ingestion, getS34IngestionById, listS34FeedbackByCycle,
  insertS35Evaluation, getS35Evaluation,
  insertS36Trigger, getS36Trigger,
} from "../persistence/closure-queries.ts";
import { ApplicationError } from "../contracts/envelope.ts";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

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
  db.prepare(`INSERT INTO structured_requirement_versions (structured_requirement_version_id, analysis_project_id, analysis_request_id, version_ordinal, schema_version, content_sha256, storage_ref, created_at, created_by_actor_id) VALUES (?, ?, ?, 1, '1.0', ?, 'blobs/aa/a', ?, ?)`).run(rvId, projectId, reqId, "a".repeat(64), now(), a);
  db.prepare(`INSERT INTO analysis_plan_versions (analysis_plan_version_id, analysis_project_id, structured_requirement_version_id, version_ordinal, schema_version, content_sha256, storage_ref, created_at, created_by_actor_id) VALUES (?, ?, ?, 1, '1.0', ?, 'blobs/bb/b', ?, ?)`).run(pvId, projectId, rvId, "b".repeat(64), now(), a);
  db.prepare(`INSERT INTO analysis_runs (analysis_run_id, analysis_project_id, analysis_plan_version_id, run_ordinal, current_analysis_stage, current_run_status, queued_at, started_at, ended_at, triggered_by_actor_id) VALUES (?, ?, ?, 1, 'S2.4', 'succeeded', ?, ?, ?, ?)`).run(runId, projectId, pvId, now(), now(), now(), a);
  db.prepare(`INSERT INTO report_versions (report_version_id, analysis_project_id, analysis_run_id, structured_requirement_version_id, analysis_plan_version_id, version_ordinal, schema_version, content_sha256, storage_ref, created_at, created_by_actor_id) VALUES (?, ?, ?, ?, ?, 1, '1.0', ?, 'blobs/cc/c', ?, ?)`).run(repId, projectId, runId, rvId, pvId, "c".repeat(64), now(), a);
  return repId;
}

function makeCycle(projectId: string, reportId: string, ws: string = WS) {
  return { closureCycleId: uuid(), analysisProjectId: projectId, workspaceId: ws, lockedReportVersionId: reportId, closureOrdinal: 1, cycleStatus: "initiated" as const, currentStage: null, initiatedAt: now(), initiatedByActorId: insertActor(), updatedAt: now() };
}
function assertAppError(fn: () => unknown, code: string): void {
  assert.throws(fn, (e: unknown) => e instanceof ApplicationError && (e as ApplicationError).code === code);
}

function setupFullCycle(ws: string = WS): { cycle: ReturnType<typeof makeCycle>; projectId: string } {
  const projectId = insertProject(ws);
  const reportId = insertFullPipeline(projectId);
  const cycle = makeCycle(projectId, reportId, ws);
  insertClosureCycle(db, cycle);
  return { cycle, projectId };
}

function insertAllStages(ws: string = WS): { cycle: ReturnType<typeof makeCycle>; projectId: string } {
  const { cycle, projectId } = setupFullCycle(ws);
  insertS31Translation(db, { translationId: uuid(), closureCycleId: cycle.closureCycleId, workspaceId: ws, businessActionArtifactRef: "blobs/s31/a", businessActionContentSha256: "d".repeat(64), selectedRecommendationsJson: "[]", businessRulesJson: "[]", thresholdsJson: "[]", segmentsJson: "[]", grayReleaseTargetsJson: "[]", feedbackMetricDefinitionsJson: "[]", translationStatus: "confirmed", confirmedAt: now(), confirmedByActorId: insertActor(), createdAt: now(), updatedAt: now() });
  insertS32Deployment(db, { deploymentId: uuid(), closureCycleId: cycle.closureCycleId, workspaceId: ws, downstreamSystem: "cdp_tag_engine", deploymentTicketRef: "TICKET-1", grayConfigJson: "{}", rollbackPath: "rollback", deploymentStatus: "fully_deployed", confirmedAt: now(), confirmedByActorId: insertActor(), createdAt: now(), updatedAt: now() });
  insertS33Execution(db, { executionId: uuid(), closureCycleId: cycle.closureCycleId, workspaceId: ws, businessScopeJson: "{}", ownerRole: "marketing", executionWindowStart: now(), executionWindowEnd: now(), actionVersion: "v1", touchedPopulation: 1000, executionLogRef: "log-ref", feedbackSource: "combined", createdAt: now(), updatedAt: now() });
  insertS34Ingestion(db, { ingestionId: uuid(), closureCycleId: cycle.closureCycleId, workspaceId: ws, feedbackOrdinal: 1, feedbackDatasetRef: "ds-ref", metricsJson: "[]", statisticalSignificance: "reached", piHandoffRef: "handoff-ref", antigravityReviewStatus: "passed", reviewedAt: now(), reviewedByActorId: insertActor(), createdAt: now(), updatedAt: now() });
  insertS35Evaluation(db, { evaluationId: uuid(), closureCycleId: cycle.closureCycleId, workspaceId: ws, evaluationReportRef: "blobs/s35/r", evaluationReportSha256: "e".repeat(64), deviationAnalysisJson: "{}", hypothesisResult: "confirmed", effectivenessRating: "met_expectations", reviewerActorId: insertActor(), reviewedAt: now(), createdAt: now(), updatedAt: now() });
  return { cycle, projectId };
}

describe("schema introspection", () => {
  test("all 7 closure tables exist", () => {
    const tables = listTables(db);
    for (const t of ["closure_cycles","s31_conclusion_translations","s32_system_deployments","s33_business_executions","s34_feedback_ingestions","s35_effect_evaluations","s36_iteration_triggers"])
      assert.ok(tables.includes(t), `${t} should exist`);
  });
  test("closure indexes exist", () => {
    const idx = listAllIndexes(db);
    assert.ok(idx.includes("idx_closure_cycles_workspace_project_ordinal"));
    for (const s of ["s31","s32","s33","s35","s36"])
      assert.ok(idx.includes(`idx_${s}_cycle`), `idx_${s}_cycle missing`);
    assert.ok(idx.includes("idx_s34_cycle_ordinal"), "idx_s34_cycle_ordinal missing");
  });
});

describe("closure_cycles constraints", () => {
  test("accepts valid cycle_status", () => {
    const pid = insertProject(); const rid = insertFullPipeline(pid); let ord = 1;
    for (const s of ["initiated","in_progress","archived","iterating"]) {
      const c = makeCycle(pid, rid); c.closureOrdinal = ord++; c.cycleStatus = s as never;
      assert.equal(insertClosureCycle(db, c).cycle_status, s);
    }
  });
  test("rejects invalid cycle_status at SQL", () => {
    const pid = insertProject(); const rid = insertFullPipeline(pid);
    assert.throws(() => db.prepare(`INSERT INTO closure_cycles (closure_cycle_id, analysis_project_id, workspace_id, locked_report_version_id, closure_ordinal, cycle_status, initiated_at, initiated_by_actor_id, updated_at) VALUES (?, ?, ?, ?, 1, 'bad', ?, ?, ?)`).run(uuid(), pid, WS, rid, now(), insertActor(), now()), /CHECK/);
  });
  test("rejects duplicate ordinal for same project", () => {
    const pid = insertProject(); const rid = insertFullPipeline(pid);
    insertClosureCycle(db, makeCycle(pid, rid));
    assertAppError(() => insertClosureCycle(db, makeCycle(pid, rid)), "validation_failed");
  });
  test("allows same ordinal different projects", () => {
    const p1 = insertProject(); const r1 = insertFullPipeline(p1);
    const p2 = insertProject(); const r2 = insertFullPipeline(p2);
    insertClosureCycle(db, makeCycle(p1, r1)); insertClosureCycle(db, makeCycle(p2, r2));
  });
  test("rejects nonexistent project", () => {
    const pid = insertProject(); const rid = insertFullPipeline(pid);
    const c = makeCycle(pid, rid); c.analysisProjectId = "no-such";
    assertAppError(() => insertClosureCycle(db, c), "resource_not_found");
  });
  test("rejects wrong workspace", () => {
    const pid = insertProject(WS); const rid = insertFullPipeline(pid);
    assertAppError(() => insertClosureCycle(db, makeCycle(pid, rid, WS2)), "resource_not_found");
  });
  test("wrong workspace read returns undefined", () => {
    const { cycle } = setupFullCycle();
    assert.ok(getClosureCycleById(db, WS, cycle.closureCycleId));
    assert.equal(getClosureCycleById(db, WS2, cycle.closureCycleId), undefined);
  });
  test("project delete restricted when cycle exists", () => {
    const { projectId } = setupFullCycle();
    assert.throws(() => db.prepare("DELETE FROM analysis_projects WHERE analysis_project_id = ?").run(projectId), /FOREIGN KEY/);
  });
  test("cycle delete cascades to stages", () => {
    const { cycle } = insertAllStages();
    assert.ok(getS31Translation(db, WS, cycle.closureCycleId));
    db.prepare("DELETE FROM closure_cycles WHERE closure_cycle_id = ?").run(cycle.closureCycleId);
    assert.equal(getS31Translation(db, WS, cycle.closureCycleId), undefined);
  });
  test("countClosureCyclesByProject", () => {
    const pid = insertProject(); const rid = insertFullPipeline(pid);
    assert.equal(countClosureCyclesByProject(db, WS, pid), 0);
    insertClosureCycle(db, makeCycle(pid, rid));
    assert.equal(countClosureCyclesByProject(db, WS, pid), 1);
  });
});

describe("stage fact UNIQUE per cycle", () => {
  test("S3.1 rejects duplicate per cycle", () => {
    const { cycle } = setupFullCycle();
    const b = { translationId: uuid(), closureCycleId: cycle.closureCycleId, workspaceId: WS, businessActionArtifactRef: "r", businessActionContentSha256: "d".repeat(64), selectedRecommendationsJson: "[]", businessRulesJson: "[]", thresholdsJson: "[]", segmentsJson: "[]", grayReleaseTargetsJson: "[]", feedbackMetricDefinitionsJson: "[]", translationStatus: "draft" as const, confirmedAt: null, confirmedByActorId: null, createdAt: now(), updatedAt: now() };
    insertS31Translation(db, b);
    assert.throws(() => insertS31Translation(db, { ...b, translationId: uuid() }), /UNIQUE/);
  });
  test("S3.2 rejects duplicate per cycle", () => {
    const { cycle } = setupFullCycle();
    insertS31Translation(db, { translationId: uuid(), closureCycleId: cycle.closureCycleId, workspaceId: WS, businessActionArtifactRef: "r", businessActionContentSha256: "d".repeat(64), selectedRecommendationsJson: "[]", businessRulesJson: "[]", thresholdsJson: "[]", segmentsJson: "[]", grayReleaseTargetsJson: "[]", feedbackMetricDefinitionsJson: "[]", translationStatus: "draft", confirmedAt: null, confirmedByActorId: null, createdAt: now(), updatedAt: now() });
    const d = { deploymentId: uuid(), closureCycleId: cycle.closureCycleId, workspaceId: WS, downstreamSystem: "cdp_tag_engine" as const, deploymentTicketRef: "t", grayConfigJson: "{}", rollbackPath: "rb", deploymentStatus: "pending" as const, confirmedAt: null, confirmedByActorId: null, createdAt: now(), updatedAt: now() };
    insertS32Deployment(db, d);
    assert.throws(() => insertS32Deployment(db, { ...d, deploymentId: uuid() }), /UNIQUE/);
  });
});

describe("stage prerequisites", () => {
  test("S3.2 requires S3.1", () => { const { cycle } = setupFullCycle(); assertAppError(() => insertS32Deployment(db, { deploymentId: uuid(), closureCycleId: cycle.closureCycleId, workspaceId: WS, downstreamSystem: "cdp_tag_engine", deploymentTicketRef: "t", grayConfigJson: "{}", rollbackPath: "rb", deploymentStatus: "pending", confirmedAt: null, confirmedByActorId: null, createdAt: now(), updatedAt: now() }), "validation_failed"); });
  test("S3.3 requires S3.2", () => { const { cycle } = setupFullCycle(); assertAppError(() => insertS33Execution(db, { executionId: uuid(), closureCycleId: cycle.closureCycleId, workspaceId: WS, businessScopeJson: "{}", ownerRole: "r", executionWindowStart: now(), executionWindowEnd: now(), actionVersion: "v1", touchedPopulation: null, executionLogRef: null, feedbackSource: "execution_log", createdAt: now(), updatedAt: now() }), "validation_failed"); });
  test("S3.4 requires S3.3", () => { const { cycle } = setupFullCycle(); assertAppError(() => insertS34Ingestion(db, { ingestionId: uuid(), closureCycleId: cycle.closureCycleId, workspaceId: WS, feedbackOrdinal: 1, feedbackDatasetRef: "d", metricsJson: "[]", statisticalSignificance: "pending", piHandoffRef: null, antigravityReviewStatus: "pending", reviewedAt: null, reviewedByActorId: null, createdAt: now(), updatedAt: now() }), "validation_failed"); });
  test("S3.5 requires S3.4", () => { const { cycle } = setupFullCycle(); assertAppError(() => insertS35Evaluation(db, { evaluationId: uuid(), closureCycleId: cycle.closureCycleId, workspaceId: WS, evaluationReportRef: "r", evaluationReportSha256: "e".repeat(64), deviationAnalysisJson: "{}", hypothesisResult: "confirmed", effectivenessRating: "met_expectations", reviewerActorId: insertActor(), reviewedAt: now(), createdAt: now(), updatedAt: now() }), "validation_failed"); });
  test("S3.6 requires S3.5", () => { const { cycle } = setupFullCycle(); assertAppError(() => insertS36Trigger(db, { triggerId: uuid(), closureCycleId: cycle.closureCycleId, workspaceId: WS, branch: "archive", targetState: null, successorProjectId: null, workOrderRef: null, knowledgeBaseUpdateRef: null, triggeredAt: now(), triggeredByActorId: insertActor(), createdAt: now(), updatedAt: now() }), "validation_failed"); });
  test("full chain S3.1->S3.6 succeeds", () => {
    const { cycle } = insertAllStages();
    insertS36Trigger(db, { triggerId: uuid(), closureCycleId: cycle.closureCycleId, workspaceId: WS, branch: "archive", targetState: null, successorProjectId: null, workOrderRef: null, knowledgeBaseUpdateRef: null, triggeredAt: now(), triggeredByActorId: insertActor(), createdAt: now(), updatedAt: now() });
    assert.ok(getS36Trigger(db, WS, cycle.closureCycleId));
  });
});

describe("S3.6 branch validation", () => {
  test("archive with null target succeeds", () => { const { cycle } = insertAllStages(); insertS36Trigger(db, { triggerId: uuid(), closureCycleId: cycle.closureCycleId, workspaceId: WS, branch: "archive", targetState: null, successorProjectId: null, workOrderRef: null, knowledgeBaseUpdateRef: null, triggeredAt: now(), triggeredByActorId: insertActor(), createdAt: now(), updatedAt: now() }); assert.ok(getS36Trigger(db, WS, cycle.closureCycleId)); });
  test("iterate with S1.1 succeeds", () => { const { cycle } = insertAllStages(); insertS36Trigger(db, { triggerId: uuid(), closureCycleId: cycle.closureCycleId, workspaceId: WS, branch: "iterate", targetState: "S1.1", successorProjectId: uuid(), workOrderRef: "wo", knowledgeBaseUpdateRef: "kb", triggeredAt: now(), triggeredByActorId: insertActor(), createdAt: now(), updatedAt: now() }); assert.ok(getS36Trigger(db, WS, cycle.closureCycleId)); });
  test("iterate with S2.3 succeeds", () => { const { cycle } = insertAllStages(); insertS36Trigger(db, { triggerId: uuid(), closureCycleId: cycle.closureCycleId, workspaceId: WS, branch: "iterate", targetState: "S2.3", successorProjectId: null, workOrderRef: null, knowledgeBaseUpdateRef: null, triggeredAt: now(), triggeredByActorId: insertActor(), createdAt: now(), updatedAt: now() }); assert.ok(getS36Trigger(db, WS, cycle.closureCycleId)); });
  test("SQL rejects iterate with null target", () => { const { cycle } = insertAllStages(); assert.throws(() => db.prepare(`INSERT INTO s36_iteration_triggers (trigger_id, closure_cycle_id, branch, target_state, triggered_at, triggered_by_actor_id, created_at, updated_at) VALUES (?, ?, 'iterate', NULL, ?, ?, ?, ?)`).run(uuid(), cycle.closureCycleId, now(), insertActor(), now(), now()), /CHECK/); });
  test("SQL rejects archive with non-null target", () => { const { cycle } = insertAllStages(); assert.throws(() => db.prepare(`INSERT INTO s36_iteration_triggers (trigger_id, closure_cycle_id, branch, target_state, triggered_at, triggered_by_actor_id, created_at, updated_at) VALUES (?, ?, 'archive', 'S1.1', ?, ?, ?, ?)`).run(uuid(), cycle.closureCycleId, now(), insertActor(), now(), now()), /CHECK/); });
  test("helper rejects iterate without target", () => { const { cycle } = insertAllStages(); assertAppError(() => insertS36Trigger(db, { triggerId: uuid(), closureCycleId: cycle.closureCycleId, workspaceId: WS, branch: "iterate", targetState: null, successorProjectId: null, workOrderRef: null, knowledgeBaseUpdateRef: null, triggeredAt: now(), triggeredByActorId: insertActor(), createdAt: now(), updatedAt: now() }), "validation_failed"); });
  test("SQL rejects invalid target_state", () => { const { cycle } = insertAllStages(); assert.throws(() => db.prepare(`INSERT INTO s36_iteration_triggers (trigger_id, closure_cycle_id, branch, target_state, triggered_at, triggered_by_actor_id, created_at, updated_at) VALUES (?, ?, 'iterate', 'S2.1', ?, ?, ?, ?)`).run(uuid(), cycle.closureCycleId, now(), insertActor(), now(), now()), /CHECK/); });
});

describe("enum CHECK at SQL", () => {
  test("S3.2 rejects invalid downstream_system", () => { const { cycle } = setupFullCycle(); assert.throws(() => db.prepare(`INSERT INTO s32_system_deployments (deployment_id, closure_cycle_id, downstream_system, deployment_ticket_ref, gray_config_json, rollback_path, deployment_status, created_at, updated_at) VALUES (?, ?, 'bad', 't', '{}', 'rb', 'pending', ?, ?)`).run(uuid(), cycle.closureCycleId, now(), now()), /CHECK/); });
  test("S3.3 rejects invalid feedback_source", () => { const { cycle } = setupFullCycle(); assert.throws(() => db.prepare(`INSERT INTO s33_business_executions (execution_id, closure_cycle_id, business_scope_json, owner_role, execution_window_start, execution_window_end, action_version, feedback_source, created_at, updated_at) VALUES (?, ?, '{}', 'r', ?, ?, 'v1', 'bad', ?, ?)`).run(uuid(), cycle.closureCycleId, now(), now(), now(), now()), /CHECK/); });
  test("S3.4 rejects invalid significance", () => { const { cycle } = setupFullCycle(); assert.throws(() => db.prepare(`INSERT INTO s34_feedback_ingestions (ingestion_id, closure_cycle_id, feedback_ordinal, feedback_dataset_ref, metrics_json, statistical_significance, antigravity_review_status, created_at, updated_at) VALUES (?, ?, 1, 'd', '[]', 'bad', 'pending', ?, ?)`).run(uuid(), cycle.closureCycleId, now(), now()), /CHECK/); });
  test("S3.5 rejects invalid hypothesis_result", () => { const { cycle } = setupFullCycle(); assert.throws(() => db.prepare(`INSERT INTO s35_effect_evaluations (evaluation_id, closure_cycle_id, evaluation_report_ref, evaluation_report_sha256, deviation_analysis_json, hypothesis_result, effectiveness_rating, reviewer_actor_id, reviewed_at, created_at, updated_at) VALUES (?, ?, 'r', ?, '{}', 'bad', 'met_expectations', ?, ?, ?, ?)`).run(uuid(), cycle.closureCycleId, "e".repeat(64), insertActor(), now(), now(), now()), /CHECK/); });
  test("S3.5 rejects invalid effectiveness_rating", () => { const { cycle } = setupFullCycle(); assert.throws(() => db.prepare(`INSERT INTO s35_effect_evaluations (evaluation_id, closure_cycle_id, evaluation_report_ref, evaluation_report_sha256, deviation_analysis_json, hypothesis_result, effectiveness_rating, reviewer_actor_id, reviewed_at, created_at, updated_at) VALUES (?, ?, 'r', ?, '{}', 'confirmed', 'bad', ?, ?, ?, ?)`).run(uuid(), cycle.closureCycleId, "e".repeat(64), insertActor(), now(), now(), now()), /CHECK/); });
});

describe("workspace scoping for stages", () => {
  test("getS31Translation undefined for wrong ws", () => { const { cycle } = insertAllStages(); assert.ok(getS31Translation(db, WS, cycle.closureCycleId)); assert.equal(getS31Translation(db, WS2, cycle.closureCycleId), undefined); });
  test("getS35Evaluation undefined for wrong ws", () => { const { cycle } = insertAllStages(); assert.ok(getS35Evaluation(db, WS, cycle.closureCycleId)); assert.equal(getS35Evaluation(db, WS2, cycle.closureCycleId), undefined); });
  test("insertS32 rejects cycle in wrong ws", () => { const { cycle } = setupFullCycle(); assertAppError(() => insertS32Deployment(db, { deploymentId: uuid(), closureCycleId: cycle.closureCycleId, workspaceId: WS2, downstreamSystem: "cdp_tag_engine", deploymentTicketRef: "t", grayConfigJson: "{}", rollbackPath: "rb", deploymentStatus: "pending", confirmedAt: null, confirmedByActorId: null, createdAt: now(), updatedAt: now() }), "resource_not_found"); });
});

describe("orphan FK rejection", () => {
  test("S3.1 with nonexistent cycle rejected", () => {
    assert.throws(() => db.prepare(`INSERT INTO s31_conclusion_translations (translation_id, closure_cycle_id, business_action_artifact_ref, business_action_content_sha256, selected_recommendations_json, business_rules_json, thresholds_json, segments_json, gray_release_targets_json, feedback_metric_definitions_json, translation_status, created_at, updated_at) VALUES (?, 'no-cycle', 'r', ?, '[]', '[]', '[]', '[]', '[]', '[]', 'draft', ?, ?)`).run(uuid(), "d".repeat(64), now(), now()), /FOREIGN KEY/);
  });
  test("S3.4 with nonexistent cycle rejected", () => {
    assert.throws(() => db.prepare(`INSERT INTO s34_feedback_ingestions (ingestion_id, closure_cycle_id, feedback_ordinal, feedback_dataset_ref, metrics_json, statistical_significance, antigravity_review_status, created_at, updated_at) VALUES (?, 'no-cycle', 1, 'd', '[]', 'pending', 'pending', ?, ?)`).run(uuid(), now(), now()), /FOREIGN KEY/);
  });
  test("S3.6 with nonexistent cycle rejected", () => {
    assert.throws(() => db.prepare(`INSERT INTO s36_iteration_triggers (trigger_id, closure_cycle_id, branch, target_state, triggered_at, triggered_by_actor_id, created_at, updated_at) VALUES (?, 'no-cycle', 'archive', NULL, ?, ?, ?, ?)`).run(uuid(), now(), insertActor(), now(), now()), /FOREIGN KEY/);
  });
});

describe("S3.4 append-only feedback (C6)", () => {
  test("multiple feedback entries preserved in ordinal order", () => {
    const { cycle } = setupFullCycle();
    // Insert S3.1-S3.3 prerequisites
    insertS31Translation(db, { translationId: uuid(), closureCycleId: cycle.closureCycleId, workspaceId: WS, businessActionArtifactRef: "r", businessActionContentSha256: "d".repeat(64), selectedRecommendationsJson: "[]", businessRulesJson: "[]", thresholdsJson: "[]", segmentsJson: "[]", grayReleaseTargetsJson: "[]", feedbackMetricDefinitionsJson: "[]", translationStatus: "confirmed", confirmedAt: now(), confirmedByActorId: insertActor(), createdAt: now(), updatedAt: now() });
    insertS32Deployment(db, { deploymentId: uuid(), closureCycleId: cycle.closureCycleId, workspaceId: WS, downstreamSystem: "cdp_tag_engine", deploymentTicketRef: "t", grayConfigJson: "{}", rollbackPath: "rb", deploymentStatus: "fully_deployed", confirmedAt: now(), confirmedByActorId: insertActor(), createdAt: now(), updatedAt: now() });
    insertS33Execution(db, { executionId: uuid(), closureCycleId: cycle.closureCycleId, workspaceId: WS, businessScopeJson: "{}", ownerRole: "r", executionWindowStart: now(), executionWindowEnd: now(), actionVersion: "v1", touchedPopulation: null, executionLogRef: null, feedbackSource: "execution_log", createdAt: now(), updatedAt: now() });

    // Append 3 feedback entries
    const id1 = uuid(), id2 = uuid(), id3 = uuid();
    insertS34Ingestion(db, { ingestionId: id1, closureCycleId: cycle.closureCycleId, workspaceId: WS, feedbackOrdinal: 1, feedbackDatasetRef: "ds-1", metricsJson: "[1]", statisticalSignificance: "not_reached", piHandoffRef: null, antigravityReviewStatus: "pending", reviewedAt: null, reviewedByActorId: null, createdAt: now(), updatedAt: now() });
    insertS34Ingestion(db, { ingestionId: id2, closureCycleId: cycle.closureCycleId, workspaceId: WS, feedbackOrdinal: 2, feedbackDatasetRef: "ds-2", metricsJson: "[2]", statisticalSignificance: "reached", piHandoffRef: "h-2", antigravityReviewStatus: "passed", reviewedAt: now(), reviewedByActorId: insertActor(), createdAt: now(), updatedAt: now() });
    insertS34Ingestion(db, { ingestionId: id3, closureCycleId: cycle.closureCycleId, workspaceId: WS, feedbackOrdinal: 3, feedbackDatasetRef: "ds-3", metricsJson: "[3]", statisticalSignificance: "reached", piHandoffRef: "h-3", antigravityReviewStatus: "pending", reviewedAt: null, reviewedByActorId: null, createdAt: now(), updatedAt: now() });

    // All 3 preserved in order
    const list = listS34FeedbackByCycle(db, WS, cycle.closureCycleId);
    assert.equal(list.length, 3);
    assert.equal(list[0]!.ingestion_id, id1);
    assert.equal(list[0]!.feedback_ordinal, 1);
    assert.equal(list[1]!.ingestion_id, id2);
    assert.equal(list[1]!.feedback_ordinal, 2);
    assert.equal(list[2]!.ingestion_id, id3);
    assert.equal(list[2]!.feedback_ordinal, 3);

    // Individual read by id
    assert.ok(getS34IngestionById(db, WS, id1));
    assert.ok(getS34IngestionById(db, WS, id3));
  });

  test("duplicate feedback_ordinal rejected", () => {
    const { cycle } = setupFullCycle();
    insertS31Translation(db, { translationId: uuid(), closureCycleId: cycle.closureCycleId, workspaceId: WS, businessActionArtifactRef: "r", businessActionContentSha256: "d".repeat(64), selectedRecommendationsJson: "[]", businessRulesJson: "[]", thresholdsJson: "[]", segmentsJson: "[]", grayReleaseTargetsJson: "[]", feedbackMetricDefinitionsJson: "[]", translationStatus: "confirmed", confirmedAt: now(), confirmedByActorId: insertActor(), createdAt: now(), updatedAt: now() });
    insertS32Deployment(db, { deploymentId: uuid(), closureCycleId: cycle.closureCycleId, workspaceId: WS, downstreamSystem: "cdp_tag_engine", deploymentTicketRef: "t", grayConfigJson: "{}", rollbackPath: "rb", deploymentStatus: "fully_deployed", confirmedAt: now(), confirmedByActorId: insertActor(), createdAt: now(), updatedAt: now() });
    insertS33Execution(db, { executionId: uuid(), closureCycleId: cycle.closureCycleId, workspaceId: WS, businessScopeJson: "{}", ownerRole: "r", executionWindowStart: now(), executionWindowEnd: now(), actionVersion: "v1", touchedPopulation: null, executionLogRef: null, feedbackSource: "execution_log", createdAt: now(), updatedAt: now() });

    insertS34Ingestion(db, { ingestionId: uuid(), closureCycleId: cycle.closureCycleId, workspaceId: WS, feedbackOrdinal: 1, feedbackDatasetRef: "ds-1", metricsJson: "[]", statisticalSignificance: "pending", piHandoffRef: null, antigravityReviewStatus: "pending", reviewedAt: null, reviewedByActorId: null, createdAt: now(), updatedAt: now() });
    assertAppError(() => insertS34Ingestion(db, { ingestionId: uuid(), closureCycleId: cycle.closureCycleId, workspaceId: WS, feedbackOrdinal: 1, feedbackDatasetRef: "ds-dup", metricsJson: "[]", statisticalSignificance: "pending", piHandoffRef: null, antigravityReviewStatus: "pending", reviewedAt: null, reviewedByActorId: null, createdAt: now(), updatedAt: now() }), "validation_failed");
  });

  test("existing entries preserved — no overwrite on new append", () => {
    const { cycle } = setupFullCycle();
    insertS31Translation(db, { translationId: uuid(), closureCycleId: cycle.closureCycleId, workspaceId: WS, businessActionArtifactRef: "r", businessActionContentSha256: "d".repeat(64), selectedRecommendationsJson: "[]", businessRulesJson: "[]", thresholdsJson: "[]", segmentsJson: "[]", grayReleaseTargetsJson: "[]", feedbackMetricDefinitionsJson: "[]", translationStatus: "confirmed", confirmedAt: now(), confirmedByActorId: insertActor(), createdAt: now(), updatedAt: now() });
    insertS32Deployment(db, { deploymentId: uuid(), closureCycleId: cycle.closureCycleId, workspaceId: WS, downstreamSystem: "cdp_tag_engine", deploymentTicketRef: "t", grayConfigJson: "{}", rollbackPath: "rb", deploymentStatus: "fully_deployed", confirmedAt: now(), confirmedByActorId: insertActor(), createdAt: now(), updatedAt: now() });
    insertS33Execution(db, { executionId: uuid(), closureCycleId: cycle.closureCycleId, workspaceId: WS, businessScopeJson: "{}", ownerRole: "r", executionWindowStart: now(), executionWindowEnd: now(), actionVersion: "v1", touchedPopulation: null, executionLogRef: null, feedbackSource: "execution_log", createdAt: now(), updatedAt: now() });

    const id1 = uuid();
    insertS34Ingestion(db, { ingestionId: id1, closureCycleId: cycle.closureCycleId, workspaceId: WS, feedbackOrdinal: 1, feedbackDatasetRef: "original", metricsJson: "[1]", statisticalSignificance: "pending", piHandoffRef: null, antigravityReviewStatus: "pending", reviewedAt: null, reviewedByActorId: null, createdAt: now(), updatedAt: now() });
    // Append a second entry
    insertS34Ingestion(db, { ingestionId: uuid(), closureCycleId: cycle.closureCycleId, workspaceId: WS, feedbackOrdinal: 2, feedbackDatasetRef: "second", metricsJson: "[2]", statisticalSignificance: "pending", piHandoffRef: null, antigravityReviewStatus: "pending", reviewedAt: null, reviewedByActorId: null, createdAt: now(), updatedAt: now() });

    // First entry unchanged
    const row = getS34IngestionById(db, WS, id1);
    assert.ok(row);
    assert.equal(row.feedback_dataset_ref, "original");
    assert.equal(row.feedback_ordinal, 1);
  });

  test("listS34FeedbackByCycle wrong workspace returns empty", () => {
    const { cycle } = insertAllStages();
    assert.equal(listS34FeedbackByCycle(db, WS2, cycle.closureCycleId).length, 0);
  });

  test("SQL rejects feedback_ordinal <= 0", () => {
    const { cycle } = setupFullCycle();
    assert.throws(() => db.prepare(`INSERT INTO s34_feedback_ingestions (ingestion_id, closure_cycle_id, feedback_ordinal, feedback_dataset_ref, metrics_json, statistical_significance, antigravity_review_status, created_at, updated_at) VALUES (?, ?, 0, 'd', '[]', 'pending', 'pending', ?, ?)`).run(uuid(), cycle.closureCycleId, now(), now()), /CHECK/);
  });

  test("helper rejects non-positive feedback_ordinal", () => {
    const { cycle } = setupFullCycle();
    insertS31Translation(db, { translationId: uuid(), closureCycleId: cycle.closureCycleId, workspaceId: WS, businessActionArtifactRef: "r", businessActionContentSha256: "d".repeat(64), selectedRecommendationsJson: "[]", businessRulesJson: "[]", thresholdsJson: "[]", segmentsJson: "[]", grayReleaseTargetsJson: "[]", feedbackMetricDefinitionsJson: "[]", translationStatus: "confirmed", confirmedAt: now(), confirmedByActorId: insertActor(), createdAt: now(), updatedAt: now() });
    insertS32Deployment(db, { deploymentId: uuid(), closureCycleId: cycle.closureCycleId, workspaceId: WS, downstreamSystem: "cdp_tag_engine", deploymentTicketRef: "t", grayConfigJson: "{}", rollbackPath: "rb", deploymentStatus: "fully_deployed", confirmedAt: now(), confirmedByActorId: insertActor(), createdAt: now(), updatedAt: now() });
    insertS33Execution(db, { executionId: uuid(), closureCycleId: cycle.closureCycleId, workspaceId: WS, businessScopeJson: "{}", ownerRole: "r", executionWindowStart: now(), executionWindowEnd: now(), actionVersion: "v1", touchedPopulation: null, executionLogRef: null, feedbackSource: "execution_log", createdAt: now(), updatedAt: now() });

    assertAppError(() => insertS34Ingestion(db, { ingestionId: uuid(), closureCycleId: cycle.closureCycleId, workspaceId: WS, feedbackOrdinal: 0, feedbackDatasetRef: "d", metricsJson: "[]", statisticalSignificance: "pending", piHandoffRef: null, antigravityReviewStatus: "pending", reviewedAt: null, reviewedByActorId: null, createdAt: now(), updatedAt: now() }), "validation_failed");
  });
});

describe("workspace corruption: stage tables have no workspace_id column", () => {
  test("s31 has no workspace_id column", () => {
    assert.throws(() => db.prepare(`SELECT workspace_id FROM s31_conclusion_translations`).get(), /no such column/);
  });
  test("s32 has no workspace_id column", () => {
    assert.throws(() => db.prepare(`SELECT workspace_id FROM s32_system_deployments`).get(), /no such column/);
  });
  test("s33 has no workspace_id column", () => {
    assert.throws(() => db.prepare(`SELECT workspace_id FROM s33_business_executions`).get(), /no such column/);
  });
  test("s34 has no workspace_id column", () => {
    assert.throws(() => db.prepare(`SELECT workspace_id FROM s34_feedback_ingestions`).get(), /no such column/);
  });
  test("s35 has no workspace_id column", () => {
    assert.throws(() => db.prepare(`SELECT workspace_id FROM s35_effect_evaluations`).get(), /no such column/);
  });
  test("s36 has no workspace_id column", () => {
    assert.throws(() => db.prepare(`SELECT workspace_id FROM s36_iteration_triggers`).get(), /no such column/);
  });
});

describe("workspace scoping via JOIN for every stage table", () => {
  test("S3.1 wrong workspace returns undefined via JOIN", () => {
    const { cycle } = insertAllStages();
    assert.ok(getS31Translation(db, WS, cycle.closureCycleId));
    assert.equal(getS31Translation(db, WS2, cycle.closureCycleId), undefined);
  });
  test("S3.2 wrong workspace returns undefined via JOIN", () => {
    const { cycle } = insertAllStages();
    assert.ok(getS32Deployment(db, WS, cycle.closureCycleId));
    assert.equal(getS32Deployment(db, WS2, cycle.closureCycleId), undefined);
  });
  test("S3.3 wrong workspace returns undefined via JOIN", () => {
    const { cycle } = insertAllStages();
    assert.ok(getS33Execution(db, WS, cycle.closureCycleId));
    assert.equal(getS33Execution(db, WS2, cycle.closureCycleId), undefined);
  });
  test("S3.4 wrong workspace returns undefined via JOIN", () => {
    const { cycle } = insertAllStages();
    const feedback = listS34FeedbackByCycle(db, WS, cycle.closureCycleId);
    assert.equal(feedback.length, 1);
    assert.equal(listS34FeedbackByCycle(db, WS2, cycle.closureCycleId).length, 0);
  });
  test("S3.5 wrong workspace returns undefined via JOIN", () => {
    const { cycle } = insertAllStages();
    assert.ok(getS35Evaluation(db, WS, cycle.closureCycleId));
    assert.equal(getS35Evaluation(db, WS2, cycle.closureCycleId), undefined);
  });
  test("S3.6 wrong workspace returns undefined via JOIN", () => {
    const { cycle } = insertAllStages();
    insertS36Trigger(db, { triggerId: uuid(), closureCycleId: cycle.closureCycleId, workspaceId: WS, branch: "archive", targetState: null, successorProjectId: null, workOrderRef: null, knowledgeBaseUpdateRef: null, triggeredAt: now(), triggeredByActorId: insertActor(), createdAt: now(), updatedAt: now() });
    assert.ok(getS36Trigger(db, WS, cycle.closureCycleId));
    assert.equal(getS36Trigger(db, WS2, cycle.closureCycleId), undefined);
  });
  test("direct SQL on stage table bypasses workspace if no JOIN (demonstrates why JOIN is required)", () => {
    const { cycle } = insertAllStages();
    // Direct query without JOIN returns the row regardless of workspace - this is the corruption vector
    const direct = db.prepare(`SELECT * FROM s31_conclusion_translations WHERE closure_cycle_id = ?`).get(cycle.closureCycleId);
    assert.ok(direct, "Direct query without workspace filter returns the row");
    // But helper-based read scopes by workspace via JOIN
    assert.ok(getS31Translation(db, WS, cycle.closureCycleId));
    assert.equal(getS31Translation(db, WS2, cycle.closureCycleId), undefined, "JOIN-based read returns undefined for wrong workspace");
  });
});
