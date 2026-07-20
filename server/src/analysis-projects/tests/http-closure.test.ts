/**
 * S3.x Business Closure HTTP integration tests (T0021 revised per idempotency).
 *
 * Tests the closure routes through the HTTP layer using the runtime factory.
 * Covers: positive chain flow, wrong workspace, missing prerequisite,
 * duplicate S3.4 ordinal, append-only S3.4 list, closure detail/list,
 * validation error paths, and idempotency behavior.
 */
import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createAnalysisProjectsRuntime, type AnalysisProjectsRuntimeHandle } from "../runtime/index.ts";
import { createFakeWorkspacePort, TEST_WORKSPACE_ID, TEST_WORKSPACE_ID_2 } from "./application-helpers.ts";

let runtime: AnalysisProjectsRuntimeHandle;
let baseUrl: string;
let wsPath: string;
let wsPath2: string;

beforeEach(async () => {
  const dataRoot = mkdtempSync(join(tmpdir(), "xanthil-closure-http-"));
  const workspacePort = createFakeWorkspacePort();
  runtime = await createAnalysisProjectsRuntime({
    dataRoot,
    workspacePort,
    host: "127.0.0.1",
    port: 0,
  });
  const addr = runtime.address!;
  baseUrl = `http://${addr.host}:${addr.port}`;
  wsPath = `/api/analysis-projects/v1/workspaces/${TEST_WORKSPACE_ID}`;
  wsPath2 = `/api/analysis-projects/v1/workspaces/${TEST_WORKSPACE_ID_2}`;
});
afterEach(async () => { await runtime.close(); });

async function fetchJson(path: string, options?: RequestInit) {
  const res = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers: { "Content-Type": "application/json", ...options?.headers },
  });
  const body = await res.json();
  return { status: res.status, body };
}

function sha256(): string { return "a".repeat(64); }
function now(): string { return new Date().toISOString(); }
function idk(): string { return randomUUID(); } // Idempotency-Key

/** Seed a locked project with report directly in DB. */
function seedLockedProject(ws: string = TEST_WORKSPACE_ID): { projectId: string; reportId: string } {
  const db = runtime.db;
  const actorId = runtime.actorContext.actorId;
  const projectId = randomUUID();
  const reqId = randomUUID(); const rvId = randomUUID(); const pvId = randomUUID();
  const runId = randomUUID(); const repId = randomUUID();
  const ts = now();
  db.prepare(`INSERT INTO analysis_projects (analysis_project_id, workspace_id, project_kind, title, slug, project_status, created_at, created_by_actor_id, updated_at) VALUES (?, ?, 'daily_analysis', 'Seed', ?, 'active', ?, ?, ?)`).run(projectId, ws, `seed-${projectId.slice(0, 8)}`, ts, actorId, ts);
  db.prepare(`INSERT INTO analysis_requests (analysis_request_id, analysis_project_id, raw_request_text, submitted_context_evidence_ids_json, submitted_at, submitted_by_actor_id, submitted_via, locale, timezone) VALUES (?, ?, 'seed', '[]', ?, ?, 'web_ui', 'en', 'UTC')`).run(reqId, projectId, ts, actorId);
  db.prepare(`INSERT INTO structured_requirement_versions (structured_requirement_version_id, analysis_project_id, analysis_request_id, version_ordinal, schema_version, content_sha256, storage_ref, created_at, created_by_actor_id) VALUES (?, ?, ?, 1, '1.0', ?, 'blobs/a', ?, ?)`).run(rvId, projectId, reqId, sha256(), ts, actorId);
  db.prepare(`INSERT INTO analysis_plan_versions (analysis_plan_version_id, analysis_project_id, structured_requirement_version_id, version_ordinal, schema_version, content_sha256, storage_ref, created_at, created_by_actor_id) VALUES (?, ?, ?, 1, '1.0', ?, 'blobs/b', ?, ?)`).run(pvId, projectId, rvId, sha256(), ts, actorId);
  db.prepare(`INSERT INTO analysis_runs (analysis_run_id, analysis_project_id, analysis_plan_version_id, run_ordinal, current_analysis_stage, current_run_status, queued_at, started_at, ended_at, triggered_by_actor_id) VALUES (?, ?, ?, 1, 'S2.4', 'succeeded', ?, ?, ?, ?)`).run(runId, projectId, pvId, ts, ts, ts, actorId);
  db.prepare(`INSERT INTO report_versions (report_version_id, analysis_project_id, analysis_run_id, structured_requirement_version_id, analysis_plan_version_id, version_ordinal, schema_version, content_sha256, storage_ref, created_at, created_by_actor_id) VALUES (?, ?, ?, ?, ?, 1, '1.0', ?, 'blobs/c', ?, ?)`).run(repId, projectId, runId, rvId, pvId, sha256(), ts, actorId);
  db.prepare(`INSERT INTO gate_decisions (gate_decision_id, analysis_project_id, gate_type, target_object_type, target_object_id, target_schema_version, target_content_sha256, decision, decided_at, decided_by_actor_id, actor_display_name_snapshot, comment, requested_changes_json, submitted_via) VALUES (?, ?, 'report_review', 'report_version', ?, '1.0', ?, 'approved', ?, ?, 'Test', NULL, '[]', 'web_ui')`).run(randomUUID(), projectId, repId, sha256(), ts, actorId);
  return { projectId, reportId: repId };
}

/** Seed full S3.1-S3.3 prerequisites via HTTP. */
async function seedPrerequisites(cycleId: string): Promise<void> {
  await fetchJson(`${wsPath}/closure-cycles/${cycleId}/s31-translations`, {
    method: "POST", headers: { "Idempotency-Key": idk() },
    body: JSON.stringify({
      businessActionArtifactRef: "r", businessActionContentSha256: sha256(),
      selectedRecommendationsJson: "[]", businessRulesJson: "[]",
      thresholdsJson: "[]", segmentsJson: "[]", grayReleaseTargetsJson: "[]",
      feedbackMetricDefinitionsJson: "[]", translationStatus: "draft",
    }),
  });
  await fetchJson(`${wsPath}/closure-cycles/${cycleId}/s32-deployments`, {
    method: "POST", headers: { "Idempotency-Key": idk() },
    body: JSON.stringify({ downstreamSystem: "cdp_tag_engine", deploymentTicketRef: "T", grayConfigJson: "{}", rollbackPath: "rb", deploymentStatus: "fully_deployed" }),
  });
  await fetchJson(`${wsPath}/closure-cycles/${cycleId}/s33-executions`, {
    method: "POST", headers: { "Idempotency-Key": idk() },
    body: JSON.stringify({ businessScopeJson: "{}", ownerRole: "r", executionWindowStart: now(), executionWindowEnd: now(), actionVersion: "v1", feedbackSource: "execution_log" }),
  });
}

// ---------------------------------------------------------------------------
// Validation error tests
// ---------------------------------------------------------------------------

describe("closure HTTP validation", () => {
  test("closure routes registered (not 404 route_not_found)", async () => {
    const res = await fetchJson(`${wsPath}/closure-cycles/${randomUUID()}`);
    assert.equal(res.status, 404);
    assert.equal((res.body as { error: { code: string } }).error.code, "resource_not_found");
  });

  test("closure list returns empty for project with no cycles", async () => {
    const { projectId } = seedLockedProject();
    const res = await fetchJson(`${wsPath}/projects/${projectId}/closure-cycles`);
    assert.equal(res.status, 200);
    assert.equal((res.body as { data: unknown[] }).data.length, 0);
  });

  test("closure detail rejects nonexistent cycle", async () => {
    const res = await fetchJson(`${wsPath}/closure-cycles/${randomUUID()}`);
    assert.equal(res.status, 404);
  });

  test("initiate rejects missing Idempotency-Key", async () => {
    const { projectId, reportId } = seedLockedProject();
    const res = await fetchJson(`${wsPath}/projects/${projectId}/closure-cycles:initiate`, {
      method: "POST",
      body: JSON.stringify({ lockedReportVersionId: reportId, closureOrdinal: 1 }),
    });
    assert.equal(res.status, 400);
    assert.equal((res.body as { error: { code: string } }).error.code, "validation_failed");
  });

  test("initiate rejects missing body fields", async () => {
    const { projectId } = seedLockedProject();
    const res = await fetchJson(`${wsPath}/projects/${projectId}/closure-cycles:initiate`, {
      method: "POST", headers: { "Idempotency-Key": idk() },
      body: JSON.stringify({}),
    });
    assert.equal(res.status, 400);
  });

  test("initiate rejects unknown fields", async () => {
    const { projectId, reportId } = seedLockedProject();
    const res = await fetchJson(`${wsPath}/projects/${projectId}/closure-cycles:initiate`, {
      method: "POST", headers: { "Idempotency-Key": idk() },
      body: JSON.stringify({ lockedReportVersionId: reportId, closureOrdinal: 1, badField: "x" }),
    });
    assert.equal(res.status, 400);
  });

  test("S3.1 rejects invalid translation_status", async () => {
    const res = await fetchJson(`${wsPath}/closure-cycles/${randomUUID()}/s31-translations`, {
      method: "POST", headers: { "Idempotency-Key": idk() },
      body: JSON.stringify({
        businessActionArtifactRef: "ref", businessActionContentSha256: sha256(),
        selectedRecommendationsJson: "[]", businessRulesJson: "[]",
        thresholdsJson: "[]", segmentsJson: "[]", grayReleaseTargetsJson: "[]",
        feedbackMetricDefinitionsJson: "[]", translationStatus: "bad",
      }),
    });
    assert.equal(res.status, 400);
  });

  test("S3.2 rejects invalid downstream_system", async () => {
    const res = await fetchJson(`${wsPath}/closure-cycles/${randomUUID()}/s32-deployments`, {
      method: "POST", headers: { "Idempotency-Key": idk() },
      body: JSON.stringify({ downstreamSystem: "bad", deploymentTicketRef: "T", grayConfigJson: "{}", rollbackPath: "rb", deploymentStatus: "pending" }),
    });
    assert.equal(res.status, 400);
  });

  test("S3.4 rejects non-positive ordinal", async () => {
    const res = await fetchJson(`${wsPath}/closure-cycles/${randomUUID()}/s34-feedback`, {
      method: "POST", headers: { "Idempotency-Key": idk() },
      body: JSON.stringify({ feedbackOrdinal: 0, feedbackDatasetRef: "ds", metricsJson: "[]", statisticalSignificance: "pending", antigravityReviewStatus: "pending" }),
    });
    assert.equal(res.status, 400);
  });

  test("S3.6 rejects invalid branch", async () => {
    const res = await fetchJson(`${wsPath}/closure-cycles/${randomUUID()}/s36-triggers`, {
      method: "POST", headers: { "Idempotency-Key": idk() },
      body: JSON.stringify({ branch: "bad" }),
    });
    assert.equal(res.status, 400);
  });
});

// ---------------------------------------------------------------------------
// Positive chain flow + read model tests
// ---------------------------------------------------------------------------

describe("closure HTTP positive chain flow", () => {
  test("full S3.1-S3.6 chain via HTTP", async () => {
    const { projectId, reportId } = seedLockedProject();

    const initRes = await fetchJson(`${wsPath}/projects/${projectId}/closure-cycles:initiate`, {
      method: "POST", headers: { "Idempotency-Key": idk() },
      body: JSON.stringify({ lockedReportVersionId: reportId, closureOrdinal: 1 }),
    });
    assert.equal(initRes.status, 201);
    const cycleId = (initRes.body as { data: { closure_cycle_id: string } }).data.closure_cycle_id;

    // S3.1
    assert.equal((await fetchJson(`${wsPath}/closure-cycles/${cycleId}/s31-translations`, {
      method: "POST", headers: { "Idempotency-Key": idk() },
      body: JSON.stringify({
        businessActionArtifactRef: "blobs/s31/a", businessActionContentSha256: sha256(),
        selectedRecommendationsJson: "[]", businessRulesJson: "[]",
        thresholdsJson: "[]", segmentsJson: "[]", grayReleaseTargetsJson: "[]",
        feedbackMetricDefinitionsJson: "[]", translationStatus: "draft",
      }),
    })).status, 201);

    // S3.2
    assert.equal((await fetchJson(`${wsPath}/closure-cycles/${cycleId}/s32-deployments`, {
      method: "POST", headers: { "Idempotency-Key": idk() },
      body: JSON.stringify({ downstreamSystem: "cdp_tag_engine", deploymentTicketRef: "TICKET-1", grayConfigJson: "{}", rollbackPath: "rollback", deploymentStatus: "pending" }),
    })).status, 201);

    // S3.3
    assert.equal((await fetchJson(`${wsPath}/closure-cycles/${cycleId}/s33-executions`, {
      method: "POST", headers: { "Idempotency-Key": idk() },
      body: JSON.stringify({ businessScopeJson: "{}", ownerRole: "marketing", executionWindowStart: now(), executionWindowEnd: now(), actionVersion: "v1", feedbackSource: "combined" }),
    })).status, 201);

    // S3.4 (2 entries)
    assert.equal((await fetchJson(`${wsPath}/closure-cycles/${cycleId}/s34-feedback`, {
      method: "POST", headers: { "Idempotency-Key": idk() },
      body: JSON.stringify({ feedbackOrdinal: 1, feedbackDatasetRef: "ds-1", metricsJson: "[1]", statisticalSignificance: "not_reached", antigravityReviewStatus: "pending" }),
    })).status, 201);
    assert.equal((await fetchJson(`${wsPath}/closure-cycles/${cycleId}/s34-feedback`, {
      method: "POST", headers: { "Idempotency-Key": idk() },
      body: JSON.stringify({ feedbackOrdinal: 2, feedbackDatasetRef: "ds-2", metricsJson: "[2]", statisticalSignificance: "reached", antigravityReviewStatus: "passed" }),
    })).status, 201);

    // S3.5
    assert.equal((await fetchJson(`${wsPath}/closure-cycles/${cycleId}/s35-evaluations`, {
      method: "POST", headers: { "Idempotency-Key": idk() },
      body: JSON.stringify({ evaluationReportRef: "blobs/s35/r", evaluationReportSha256: sha256(), deviationAnalysisJson: "{}", hypothesisResult: "confirmed", effectivenessRating: "met_expectations" }),
    })).status, 201);

    // S3.6
    assert.equal((await fetchJson(`${wsPath}/closure-cycles/${cycleId}/s36-triggers`, {
      method: "POST", headers: { "Idempotency-Key": idk() },
      body: JSON.stringify({ branch: "archive" }),
    })).status, 201);

    // Verify detail
    const detail = await fetchJson(`${wsPath}/closure-cycles/${cycleId}`);
    assert.equal(detail.status, 200);
    const data = (detail.body as { data: { cycle: { closureCycleId: string }; s31: unknown; s32: unknown; s33: unknown; s34: unknown[]; s35: unknown; s36: unknown } }).data;
    assert.equal(data.cycle.closureCycleId, cycleId);
    assert.ok(data.s31); assert.ok(data.s32); assert.ok(data.s33);
    assert.equal(data.s34.length, 2);
    assert.ok(data.s35); assert.ok(data.s36);

    // Verify list
    const list = await fetchJson(`${wsPath}/projects/${projectId}/closure-cycles`);
    assert.equal((list.body as { data: unknown[] }).data.length, 1);
  });

  test("S3.4 append-only: multiple entries preserved in order", async () => {
    const { projectId, reportId } = seedLockedProject();
    const initRes = await fetchJson(`${wsPath}/projects/${projectId}/closure-cycles:initiate`, {
      method: "POST", headers: { "Idempotency-Key": idk() },
      body: JSON.stringify({ lockedReportVersionId: reportId, closureOrdinal: 1 }),
    });
    const cycleId = (initRes.body as { data: { closure_cycle_id: string } }).data.closure_cycle_id;
    await seedPrerequisites(cycleId);

    for (let i = 1; i <= 3; i++) {
      const res = await fetchJson(`${wsPath}/closure-cycles/${cycleId}/s34-feedback`, {
        method: "POST", headers: { "Idempotency-Key": idk() },
        body: JSON.stringify({ feedbackOrdinal: i, feedbackDatasetRef: `ds-${i}`, metricsJson: `[${i}]`, statisticalSignificance: "pending", antigravityReviewStatus: "pending" }),
      });
      assert.equal(res.status, 201);
    }

    const detail = await fetchJson(`${wsPath}/closure-cycles/${cycleId}`);
    const s34 = (detail.body as { data: { s34: { feedbackOrdinal: number; feedbackDatasetRef: string }[] } }).data.s34;
    assert.equal(s34.length, 3);
    assert.equal(s34[0]!.feedbackOrdinal, 1);
    assert.equal(s34[0]!.feedbackDatasetRef, "ds-1");
  });

  test("S3.4 rejects duplicate ordinal", async () => {
    const { projectId, reportId } = seedLockedProject();
    const initRes = await fetchJson(`${wsPath}/projects/${projectId}/closure-cycles:initiate`, {
      method: "POST", headers: { "Idempotency-Key": idk() },
      body: JSON.stringify({ lockedReportVersionId: reportId, closureOrdinal: 1 }),
    });
    const cycleId = (initRes.body as { data: { closure_cycle_id: string } }).data.closure_cycle_id;
    await seedPrerequisites(cycleId);

    await fetchJson(`${wsPath}/closure-cycles/${cycleId}/s34-feedback`, {
      method: "POST", headers: { "Idempotency-Key": idk() },
      body: JSON.stringify({ feedbackOrdinal: 1, feedbackDatasetRef: "ds1", metricsJson: "[]", statisticalSignificance: "pending", antigravityReviewStatus: "pending" }),
    });
    const dup = await fetchJson(`${wsPath}/closure-cycles/${cycleId}/s34-feedback`, {
      method: "POST", headers: { "Idempotency-Key": idk() },
      body: JSON.stringify({ feedbackOrdinal: 1, feedbackDatasetRef: "ds2", metricsJson: "[]", statisticalSignificance: "pending", antigravityReviewStatus: "pending" }),
    });
    assert.equal(dup.status, 400);
    assert.equal((dup.body as { error: { code: string } }).error.code, "validation_failed");
  });

  test("S3.2 rejects missing prerequisite (no S3.1)", async () => {
    const { projectId, reportId } = seedLockedProject();
    const initRes = await fetchJson(`${wsPath}/projects/${projectId}/closure-cycles:initiate`, {
      method: "POST", headers: { "Idempotency-Key": idk() },
      body: JSON.stringify({ lockedReportVersionId: reportId, closureOrdinal: 1 }),
    });
    const cycleId = (initRes.body as { data: { closure_cycle_id: string } }).data.closure_cycle_id;

    const res = await fetchJson(`${wsPath}/closure-cycles/${cycleId}/s32-deployments`, {
      method: "POST", headers: { "Idempotency-Key": idk() },
      body: JSON.stringify({ downstreamSystem: "cdp_tag_engine", deploymentTicketRef: "T", grayConfigJson: "{}", rollbackPath: "rb", deploymentStatus: "pending" }),
    });
    assert.equal(res.status, 400);
    assert.equal((res.body as { error: { code: string } }).error.code, "validation_failed");
  });

  test("wrong workspace returns not-found without leaking existence", async () => {
    const { projectId, reportId } = seedLockedProject();
    const initRes = await fetchJson(`${wsPath}/projects/${projectId}/closure-cycles:initiate`, {
      method: "POST", headers: { "Idempotency-Key": idk() },
      body: JSON.stringify({ lockedReportVersionId: reportId, closureOrdinal: 1 }),
    });
    const cycleId = (initRes.body as { data: { closure_cycle_id: string } }).data.closure_cycle_id;

    const detail = await fetchJson(`${wsPath2}/closure-cycles/${cycleId}`);
    assert.equal(detail.status, 404);

    const list = await fetchJson(`${wsPath2}/projects/${projectId}/closure-cycles`);
    assert.equal(list.status, 200);
    assert.equal((list.body as { data: unknown[] }).data.length, 0);

    const s31 = await fetchJson(`${wsPath2}/closure-cycles/${cycleId}/s31-translations`, {
      method: "POST", headers: { "Idempotency-Key": idk() },
      body: JSON.stringify({
        businessActionArtifactRef: "r", businessActionContentSha256: sha256(),
        selectedRecommendationsJson: "[]", businessRulesJson: "[]",
        thresholdsJson: "[]", segmentsJson: "[]", grayReleaseTargetsJson: "[]",
        feedbackMetricDefinitionsJson: "[]", translationStatus: "draft",
      }),
    });
    assert.equal(s31.status, 404);
  });

  test("S3.6 iterate with targetState accepted", async () => {
    const { projectId, reportId } = seedLockedProject();
    const initRes = await fetchJson(`${wsPath}/projects/${projectId}/closure-cycles:initiate`, {
      method: "POST", headers: { "Idempotency-Key": idk() },
      body: JSON.stringify({ lockedReportVersionId: reportId, closureOrdinal: 1 }),
    });
    const cycleId = (initRes.body as { data: { closure_cycle_id: string } }).data.closure_cycle_id;

    // Full chain S3.1-S3.5
    await seedPrerequisites(cycleId);
    await fetchJson(`${wsPath}/closure-cycles/${cycleId}/s34-feedback`, {
      method: "POST", headers: { "Idempotency-Key": idk() },
      body: JSON.stringify({ feedbackOrdinal: 1, feedbackDatasetRef: "ds", metricsJson: "[]", statisticalSignificance: "pending", antigravityReviewStatus: "pending" }),
    });
    await fetchJson(`${wsPath}/closure-cycles/${cycleId}/s35-evaluations`, {
      method: "POST", headers: { "Idempotency-Key": idk() },
      body: JSON.stringify({ evaluationReportRef: "r", evaluationReportSha256: sha256(), deviationAnalysisJson: "{}", hypothesisResult: "confirmed", effectivenessRating: "met_expectations" }),
    });

    // S3.6 iterate
    const s36 = await fetchJson(`${wsPath}/closure-cycles/${cycleId}/s36-triggers`, {
      method: "POST", headers: { "Idempotency-Key": idk() },
      body: JSON.stringify({ branch: "iterate", targetState: "S1.1" }),
    });
    assert.equal(s36.status, 201);

    const detail = await fetchJson(`${wsPath}/closure-cycles/${cycleId}`);
    const s36Data = (detail.body as { data: { s36: { branch: string; targetState: string | null } } }).data.s36;
    assert.ok(s36Data);
    assert.equal(s36Data.branch, "iterate");
    assert.equal(s36Data.targetState, "S1.1");
  });
});

// ---------------------------------------------------------------------------
// Idempotency tests
// ---------------------------------------------------------------------------

describe("closure HTTP idempotency", () => {
  test("initiate: same key+body replays success", async () => {
    const { projectId, reportId } = seedLockedProject();
    const key = idk();
    const body = JSON.stringify({ lockedReportVersionId: reportId, closureOrdinal: 1 });

    const first = await fetchJson(`${wsPath}/projects/${projectId}/closure-cycles:initiate`, {
      method: "POST", headers: { "Idempotency-Key": key }, body,
    });
    assert.equal(first.status, 201);
    const cycleId = (first.body as { data: { closure_cycle_id: string } }).data.closure_cycle_id;

    // Replay with same key+body returns original status (201)
    const replay = await fetchJson(`${wsPath}/projects/${projectId}/closure-cycles:initiate`, {
      method: "POST", headers: { "Idempotency-Key": key }, body,
    });
    assert.equal(replay.status, 201); // replayed_success with original httpStatus

    // Only 1 cycle exists
    const list = await fetchJson(`${wsPath}/projects/${projectId}/closure-cycles`);
    assert.equal((list.body as { data: unknown[] }).data.length, 1);
  });

  test("initiate: same key+diff body returns 409 conflict", async () => {
    const { projectId, reportId } = seedLockedProject();
    const key = idk();

    await fetchJson(`${wsPath}/projects/${projectId}/closure-cycles:initiate`, {
      method: "POST", headers: { "Idempotency-Key": key },
      body: JSON.stringify({ lockedReportVersionId: reportId, closureOrdinal: 1 }),
    });

    const conflict = await fetchJson(`${wsPath}/projects/${projectId}/closure-cycles:initiate`, {
      method: "POST", headers: { "Idempotency-Key": key },
      body: JSON.stringify({ lockedReportVersionId: reportId, closureOrdinal: 2 }),
    });
    assert.equal(conflict.status, 409);
    assert.equal((conflict.body as { error: { code: string } }).error.code, "idempotency_key_reused");
  });

  test("S3.4 append: same key+body replays without duplicating row", async () => {
    const { projectId, reportId } = seedLockedProject();
    const initRes = await fetchJson(`${wsPath}/projects/${projectId}/closure-cycles:initiate`, {
      method: "POST", headers: { "Idempotency-Key": idk() },
      body: JSON.stringify({ lockedReportVersionId: reportId, closureOrdinal: 1 }),
    });
    const cycleId = (initRes.body as { data: { closure_cycle_id: string } }).data.closure_cycle_id;
    await seedPrerequisites(cycleId);

    const key = idk();
    const body = JSON.stringify({ feedbackOrdinal: 1, feedbackDatasetRef: "ds", metricsJson: "[]", statisticalSignificance: "pending", antigravityReviewStatus: "pending" });

    const first = await fetchJson(`${wsPath}/closure-cycles/${cycleId}/s34-feedback`, {
      method: "POST", headers: { "Idempotency-Key": key }, body,
    });
    assert.equal(first.status, 201);

    // Replay returns original status (201)
    const replay = await fetchJson(`${wsPath}/closure-cycles/${cycleId}/s34-feedback`, {
      method: "POST", headers: { "Idempotency-Key": key }, body,
    });
    assert.equal(replay.status, 201); // replayed_success with original httpStatus

    // Only 1 feedback entry exists
    const detail = await fetchJson(`${wsPath}/closure-cycles/${cycleId}`);
    assert.equal((detail.body as { data: { s34: unknown[] } }).data.s34.length, 1);
  });
});
