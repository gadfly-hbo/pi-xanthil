/**
 * ReadModel tests (§7.1/§7.2, API-019/API-021/API-022).
 * ProjectList: fixed sort, ID tie-break, cursor filter binding, limit, default excludes archived.
 * ProjectDetail: empty draft + safe projection (no storageRef, system_only excluded).
 */
import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createMigratedDb } from "./application-helpers.ts";
import { createProject } from "../application/projects/project-service.ts";
import { archiveProject } from "../application/projects/project-lifecycle-service.ts";
import { getProjectById } from "../application/projects/project-queries.ts";
import { queryProjectList } from "../application/read-models/project-list.ts";
import { queryProjectDetail } from "../application/read-models/project-detail.ts";
import type { TrustedActorContext } from "../application/shared/runtime.ts";
import type { WorkspaceExistencePort } from "../contracts/workspace-port.ts";
import type { DatabaseSync } from "node:sqlite";

let db: DatabaseSync;
let cleanup: () => void;
let humanCtx: TrustedActorContext;
let humanId: string;
let workspaceId: string;
let workspacePort: WorkspaceExistencePort;

beforeEach(async () => {
  const env = await createMigratedDb();
  db = env.db;
  cleanup = env.cleanup;
  humanCtx = env.humanCtx;
  humanId = env.humanActorId;
  workspaceId = env.workspaceId;
  workspacePort = env.workspacePort;
});

afterEach(() => cleanup());

function makeProject(slug: string): string {
  const res = createProject({ db, workspacePort, workspaceId, actorContext: humanCtx, idempotencyKey: randomUUID(), body: { title: "T", slug } });
  if (res.kind !== "executed") throw new Error("create failed");
  return res.resultResourceId;
}

describe("ProjectListReadModel", () => {
  test("fixed sort updatedAt DESC, projectId DESC", () => {
    const a = makeProject("s-a");
    const b = makeProject("s-b");
    db.prepare(`UPDATE analysis_projects SET updated_at = ? WHERE analysis_project_id = ?`).run("2026-01-01T00:00:00.000Z", a);
    db.prepare(`UPDATE analysis_projects SET updated_at = ? WHERE analysis_project_id = ?`).run("2026-01-02T00:00:00.000Z", b);
    const list = queryProjectList({ db, workspaceId, actorContext: humanCtx, filter: {}, limit: 10 });
    assert.equal(list.data.items.length, 2);
    assert.equal(list.data.items[0]!.projectId, b);
    assert.equal(list.data.items[1]!.projectId, a);
  });

  test("same updatedAt ties break by projectId DESC", () => {
    const a = makeProject("t-a");
    const b = makeProject("t-b");
    const sameTs = "2026-01-01T00:00:00.000Z";
    db.prepare(`UPDATE analysis_projects SET updated_at = ? WHERE analysis_project_id IN (?, ?)`).run(sameTs, a, b);
    const list = queryProjectList({ db, workspaceId, actorContext: humanCtx, filter: {}, limit: 10 });
    const expected = a > b ? a : b;
    assert.equal(list.data.items[0]!.projectId, expected);
  });

  test("default excludes archived", () => {
    const a = makeProject("ar-a");
    makeProject("ar-b");
    const p = getProjectById(db, workspaceId, a)!;
    archiveProject({ db, workspacePort, workspaceId, actorContext: humanCtx, idempotencyKey: randomUUID(), body: { expectedUpdatedAt: p.updatedAt }, projectId: a });
    const list = queryProjectList({ db, workspaceId, actorContext: humanCtx, filter: {}, limit: 10 });
    assert.equal(list.data.items.length, 1);
    assert.equal(list.data.items[0]!.slug, "ar-b");
  });

  test("archiveState=archived returns only archived", () => {
    const a = makeProject("ar2-a");
    makeProject("ar2-b");
    const p = getProjectById(db, workspaceId, a)!;
    archiveProject({ db, workspacePort, workspaceId, actorContext: humanCtx, idempotencyKey: randomUUID(), body: { expectedUpdatedAt: p.updatedAt }, projectId: a });
    const list = queryProjectList({ db, workspaceId, actorContext: humanCtx, filter: { archiveState: "archived" }, limit: 10 });
    assert.equal(list.data.items.length, 1);
    assert.equal(list.data.items[0]!.slug, "ar2-a");
  });

  test("limit clamps to 1-100", () => {
    makeProject("l1");
    makeProject("l2");
    const list = queryProjectList({ db, workspaceId, actorContext: humanCtx, filter: {}, limit: 1 });
    assert.equal(list.data.items.length, 1);
    assert.equal(list.data.limit, 1);
    assert.equal(list.data.hasMore, true);
    assert.ok(list.data.nextCursor);
  });

  test("cursor pagination returns next page", () => {
    makeProject("p1");
    makeProject("p2");
    const first = queryProjectList({ db, workspaceId, actorContext: humanCtx, filter: {}, limit: 1 });
    assert.equal(first.data.items.length, 1);
    assert.ok(first.data.nextCursor);
    const second = queryProjectList({ db, workspaceId, actorContext: humanCtx, filter: {}, limit: 1, cursor: first.data.nextCursor });
    assert.equal(second.data.items.length, 1);
    assert.notEqual(second.data.items[0]!.projectId, first.data.items[0]!.projectId);
  });

  test("cursor filter binding mismatch rejected", () => {
    makeProject("cb1");
    makeProject("cb2");
    const first = queryProjectList({ db, workspaceId, actorContext: humanCtx, filter: {}, limit: 1 });
    assert.ok(first.data.nextCursor, "need a non-null cursor to test binding");
    assert.throws(() => queryProjectList({ db, workspaceId, actorContext: humanCtx, filter: { status: "active" }, limit: 1, cursor: first.data.nextCursor! }), /invalid_cursor/);
  });

  test("item includes derived stage and availableCommands", () => {
    makeProject("ic1");
    const list = queryProjectList({ db, workspaceId, actorContext: humanCtx, filter: {}, limit: 10 });
    assert.equal(list.data.items[0]!.stage, "S1.1");
    assert.ok(list.data.items[0]!.availableCommands.length > 0);
    assert.equal(list.data.items[0]!.pendingGate, null);
    assert.equal(list.data.items[0]!.lockedReportId, null);
  });
});

describe("ProjectDetailReadModel", () => {
  test("empty draft: project + null/empty relations", () => {
    const id = makeProject("ed1");
    const detail = queryProjectDetail({ db, workspaceId, actorContext: humanCtx, projectId: id, authorizedForContent: false });
    assert.equal(detail.data.project.projectId, id);
    assert.equal(detail.data.project.stage, "S1.1");
    assert.equal(detail.data.analysisRequest, null);
    assert.equal(detail.data.inputEvidence.length, 0);
    assert.equal(detail.data.sources.length, 0);
    assert.equal(detail.data.currentRequirement, null);
    assert.equal(detail.data.currentPlan, null);
    assert.equal(detail.data.latestRun, null);
    assert.equal(detail.data.latestReport, null);
    assert.equal(detail.data.lockedReportId, null);
    assert.equal(detail.data.pendingGate, null);
    assert.ok(detail.data.availableCommands.length > 0);
  });

  test("non-existent project throws", () => {
    assert.throws(() => queryProjectDetail({ db, workspaceId, actorContext: humanCtx, projectId: randomUUID(), authorizedForContent: false }), (err: unknown) => (err as { code?: string }).code === "resource_not_found");
  });

  test("EvidenceRef excludes storageRef; system_only excluded", () => {
    const id = makeProject("ev1");
    const ts = new Date().toISOString();
    const evVisible = randomUUID();
    const evSystem = randomUUID();
    const srcId = randomUUID();
    db.exec("BEGIN");
    db.prepare(`INSERT INTO source_references (source_reference_id, analysis_project_id, source_kind, display_name, description, declared_data_scope, usage_constraints_json, safety_handling_policy, created_at, created_by_actor_id, initial_evidence_artifact_id) VALUES (?, ?, 'user_provided', 'S', 'd', 'scope', '[]', 'controlled_or_derived_allowed', ?, ?, ?)`).run(srcId, id, ts, humanId, evVisible);
    db.prepare(`INSERT INTO evidence_artifacts (evidence_artifact_id, analysis_project_id, source_reference_id, origin_kind, artifact_kind, display_name, storage_ref, content_sha256, media_type, byte_size, safety_class, visibility, created_at, created_by_actor_id) VALUES (?, ?, ?, 'user_provided', 'input_material', 'V', ?, ?, 'text/plain', 10, 'controlled', 'user_visible', ?, ?)`).run(evVisible, id, srcId, "blobs/dd/" + "d".repeat(64), "d".repeat(64), ts, humanId);
    db.prepare(`INSERT INTO evidence_artifacts (evidence_artifact_id, analysis_project_id, source_reference_id, origin_kind, artifact_kind, display_name, storage_ref, content_sha256, media_type, byte_size, safety_class, visibility, created_at, created_by_actor_id) VALUES (?, ?, ?, 'user_provided', 'diagnostic', 'Sys', ?, ?, 'text/plain', 5, 'derived', 'system_only', ?, ?)`).run(evSystem, id, srcId, "blobs/ee/" + "e".repeat(64), "e".repeat(64), ts, humanId);
    db.exec("COMMIT");
    const detail = queryProjectDetail({ db, workspaceId, actorContext: humanCtx, projectId: id, authorizedForContent: true });
    assert.equal(detail.data.inputEvidence.length, 1);
    const ev = detail.data.inputEvidence[0]!;
    assert.equal((ev as unknown as Record<string, unknown>).storageRef, undefined);
    assert.equal(ev.evidenceArtifactId, evVisible);
    assert.ok(ev.contentHref !== null);
  });

  test("complete fixture: version/Gate/Run/Report/Evidence projected + stage/locked report derivation", () => {
    const id = makeProject("cf1");
    const ts = new Date().toISOString();
    const reqId = randomUUID();
    const rvId = randomUUID();
    const pvId = randomUUID();
    const gd1 = randomUUID();
    const gd2 = randomUUID();
    const runId = randomUUID();
    const srId = randomUUID();
    const evInId = randomUUID();
    const evOutId = randomUUID();
    const repId = randomUUID();
    const gd3 = randomUUID();

    db.exec("BEGIN");
    db.prepare(`INSERT INTO analysis_requests (analysis_request_id, analysis_project_id, raw_request_text, submitted_context_evidence_ids_json, submitted_at, submitted_by_actor_id, submitted_via, locale, timezone) VALUES (?, ?, 'req', '[]', ?, ?, 'web_ui', 'en-US', 'UTC')`).run(randomUUID(), id, ts, humanId);
    const arId = (db.prepare(`SELECT analysis_request_id FROM analysis_requests WHERE analysis_project_id = ?`).get(id) as { analysis_request_id: string }).analysis_request_id;
    db.prepare(`INSERT INTO structured_requirement_versions (structured_requirement_version_id, analysis_project_id, analysis_request_id, version_ordinal, schema_version, content_sha256, storage_ref, created_at, created_by_actor_id) VALUES (?, ?, ?, 1, '1.0', ?, ?, ?, ?)`).run(rvId, id, arId, "a".repeat(64), "blobs/aa/" + "a".repeat(64), ts, humanId);
    db.prepare(`INSERT INTO analysis_plan_versions (analysis_plan_version_id, analysis_project_id, structured_requirement_version_id, version_ordinal, schema_version, content_sha256, storage_ref, created_at, created_by_actor_id) VALUES (?, ?, ?, 1, '1.0', ?, ?, ?, ?)`).run(pvId, id, rvId, "b".repeat(64), "blobs/bb/" + "b".repeat(64), ts, humanId);
    db.prepare(`INSERT INTO gate_decisions (gate_decision_id, analysis_project_id, gate_type, target_object_type, target_object_id, target_schema_version, target_content_sha256, decision, decided_at, decided_by_actor_id, actor_display_name_snapshot, requested_changes_json, submitted_via) VALUES (?, ?, 'requirement_confirmation', 'structured_requirement_version', ?, '1.0', ?, 'approved', ?, ?, 'Alice', '[]', 'web_ui')`).run(gd1, id, rvId, "a".repeat(64), ts, humanId);
    db.prepare(`INSERT INTO gate_decisions (gate_decision_id, analysis_project_id, gate_type, target_object_type, target_object_id, target_schema_version, target_content_sha256, decision, decided_at, decided_by_actor_id, actor_display_name_snapshot, requested_changes_json, submitted_via) VALUES (?, ?, 'plan_confirmation', 'analysis_plan_version', ?, '1.0', ?, 'approved', ?, ?, 'Alice', '[]', 'web_ui')`).run(gd2, id, pvId, "b".repeat(64), ts, humanId);
    db.prepare(`INSERT INTO source_references (source_reference_id, analysis_project_id, source_kind, display_name, description, declared_data_scope, usage_constraints_json, safety_handling_policy, created_at, created_by_actor_id, initial_evidence_artifact_id) VALUES (?, ?, 'user_provided', 'S', 'd', 'scope', '[]', 'controlled_or_derived_allowed', ?, ?, ?)`).run(srId, id, ts, humanId, evInId);
    db.prepare(`INSERT INTO evidence_artifacts (evidence_artifact_id, analysis_project_id, source_reference_id, origin_kind, artifact_kind, display_name, storage_ref, content_sha256, media_type, byte_size, safety_class, visibility, created_at, created_by_actor_id) VALUES (?, ?, ?, 'user_provided', 'input_material', 'In', ?, ?, 'text/plain', 10, 'controlled', 'user_visible', ?, ?)`).run(evInId, id, srId, "blobs/cc/" + "c".repeat(64), "c".repeat(64), ts, humanId);
    db.prepare(`INSERT INTO analysis_runs (analysis_run_id, analysis_project_id, analysis_plan_version_id, run_ordinal, current_analysis_stage, current_run_status, queued_at, started_at, ended_at, triggering_gate_decision_id, triggered_by_actor_id) VALUES (?, ?, ?, 1, 'S2.4', 'succeeded', ?, ?, ?, ?, ?)`).run(runId, id, pvId, ts, ts, ts, gd2, humanId);
    db.prepare(`INSERT INTO evidence_artifacts (evidence_artifact_id, analysis_project_id, analysis_run_id, origin_kind, artifact_kind, display_name, storage_ref, content_sha256, media_type, byte_size, safety_class, visibility, created_at, created_by_actor_id) VALUES (?, ?, ?, 'analysis_run', 'analysis_result', 'Out', ?, ?, 'text/plain', 20, 'derived', 'user_visible', ?, ?)`).run(evOutId, id, runId, "blobs/dd/" + "d".repeat(64), "d".repeat(64), ts, humanId);
    db.prepare(`INSERT INTO analysis_run_input_evidence (analysis_run_id, evidence_artifact_id, input_role, input_ordinal, plan_step_id, admitted_at) VALUES (?, ?, 'plan_input', 1, 'step-1', ?)`).run(runId, evInId, ts);
    db.prepare(`INSERT INTO report_versions (report_version_id, analysis_project_id, analysis_run_id, structured_requirement_version_id, analysis_plan_version_id, version_ordinal, schema_version, content_sha256, storage_ref, created_at, created_by_actor_id) VALUES (?, ?, ?, ?, ?, 1, '1.0', ?, ?, ?, ?)`).run(repId, id, runId, rvId, pvId, "e".repeat(64), "blobs/ee/" + "e".repeat(64), ts, humanId);
    db.prepare(`INSERT INTO report_version_evidence (report_version_id, evidence_artifact_id, evidence_ordinal) VALUES (?, ?, 1)`).run(repId, evOutId);
    db.prepare(`INSERT INTO gate_decisions (gate_decision_id, analysis_project_id, gate_type, target_object_type, target_object_id, target_schema_version, target_content_sha256, decision, decided_at, decided_by_actor_id, actor_display_name_snapshot, requested_changes_json, submitted_via) VALUES (?, ?, 'report_review', 'report_version', ?, '1.0', ?, 'approved', ?, ?, 'Alice', '[]', 'web_ui')`).run(gd3, id, repId, "e".repeat(64), ts, humanId);
    db.prepare(`UPDATE analysis_projects SET current_requirement_version_id = ?, current_plan_version_id = ?, project_status = 'completed', completed_at = ?, updated_at = ? WHERE analysis_project_id = ?`).run(rvId, pvId, ts, ts, id);
    db.exec("COMMIT");

    const detail = queryProjectDetail({ db, workspaceId, actorContext: humanCtx, projectId: id, authorizedForContent: true });
    assert.equal(detail.data.project.stage, "S2.6");
    assert.equal(detail.data.lockedReportId, repId);
    assert.equal(detail.data.pendingGate, null);
    assert.equal(detail.data.currentRequirement!.versionId, rvId);
    assert.equal(detail.data.currentPlan!.versionId, pvId);
    assert.equal(detail.data.latestRun!.runId, runId);
    assert.equal(detail.data.latestRun!.currentRunStatus, "succeeded");
    assert.ok(detail.data.latestRun!.startedAt !== null, "startedAt must be projected");
    assert.equal(detail.data.latestReport!.reportVersionId, repId);
    const visibleIds = detail.data.inputEvidence.map((e) => e.evidenceArtifactId);
    assert.ok(visibleIds.includes(evInId), "input evidence evInId must be projected");
    assert.ok(!visibleIds.includes(evOutId), "run-produced evOutId must NOT be in inputEvidence");
    const del = detail.data.availableCommands.find((c) => c.commandType === "project.delete_draft");
    assert.equal(del!.available, false, "delete_draft must be unavailable (audit chain entered)");
    const reopen = detail.data.availableCommands.find((c) => c.commandType === "project.reopen");
    assert.equal(reopen!.available, false, "reopen only for rejected");
  });
});
