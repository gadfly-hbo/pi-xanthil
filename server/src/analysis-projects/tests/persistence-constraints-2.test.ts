/**
 * P0 database constraint tests - Part 2: deferred FK, run input evidence, evidence.
 */
import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { runMigrations, loadMigrations } from "../persistence/migration-runner.ts";
import { openDatabase } from "../persistence/db.ts";
import { createTempDataRoot, type TempDataRoot } from "./persistence-helpers.ts";
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

afterEach(() => {
  db.close();
  temp.cleanup();
});

function uuid(): string { return randomUUID(); }
function now(): string { return new Date().toISOString(); }

function insertActor(id: string = uuid()): string {
  db.prepare(
    `INSERT INTO audit_actors (audit_actor_id, actor_kind, actor_key, display_name, created_at) VALUES (?, ?, ?, ?, ?)`,
  ).run(id, "human", `key-${id}`, `Actor ${id}`, now());
  return id;
}

function insertProject(id: string = uuid()): string {
  const actorId = insertActor();
  db.prepare(
    `INSERT INTO analysis_projects (analysis_project_id, workspace_id, project_kind, title, slug, project_status, created_at, created_by_actor_id, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(id, "ws-test", "daily_analysis", "Test Project", `slug-${id}`, "active", now(), actorId, now());
  return id;
}

describe("deferred FK: circular references", () => {
  test("legal circular reference commits in one transaction", () => {
    const p1Id = uuid();
    const p2Id = uuid();
    const actorId = insertActor();

    // p1 -> p2 (derived_from), p2 -> p1 (derived_from) - but this would be a cycle
    // Better test: p2 has source_project_id = p1, both inserted in one transaction
    db.exec("BEGIN");
    db.prepare(
      `INSERT INTO analysis_projects (analysis_project_id, workspace_id, project_kind, title, slug, project_status, created_at, created_by_actor_id, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(p1Id, "ws-test", "daily_analysis", "P1", `slug-${p1Id}`, "active", now(), actorId, now());

    db.prepare(
      `INSERT INTO analysis_projects (analysis_project_id, workspace_id, project_kind, title, slug, project_status, created_at, created_by_actor_id, updated_at, source_project_id, source_relation_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(p2Id, "ws-test", "daily_analysis", "P2", `slug-${p2Id}`, "active", now(), actorId, now(), p1Id, "derived_from");

    db.exec("COMMIT");

    // Verify both exist
    const count = db.prepare("SELECT COUNT(*) as c FROM analysis_projects").get() as { c: number };
    assert.equal(count.c, 2);
  });

  test("uncommitted deferred FK fails on commit", () => {
    const actorId = insertActor();
    const missingProjectId = uuid();

    db.exec("BEGIN");
    // Insert a project that references a non-existent source project
    db.prepare(
      `INSERT INTO analysis_projects (analysis_project_id, workspace_id, project_kind, title, slug, project_status, created_at, created_by_actor_id, updated_at, source_project_id, source_relation_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(uuid(), "ws-test", "daily_analysis", "P2", `slug-${uuid()}`, "active", now(), actorId, now(), missingProjectId, "derived_from");

    // Commit should fail because source_project_id doesn't exist
    assert.throws(
      () => db.exec("COMMIT"),
      /FOREIGN KEY constraint failed/,
    );
    // Rollback to clean state
    try { db.exec("ROLLBACK"); } catch { /* already rolled back */ }
  });
});

describe("deferred FK: project current pointer", () => {
  test("project current pointer to requirement version in same transaction", () => {
    const projectId = insertProject();
    const reqId = uuid();
    const reqVerId = uuid();
    const actorId = insertActor();

    db.exec("BEGIN");
    db.prepare(
      `INSERT INTO analysis_requests (analysis_request_id, analysis_project_id, raw_request_text, submitted_context_evidence_ids_json, submitted_at, submitted_by_actor_id, submitted_via, locale, timezone) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(reqId, projectId, "text", "[]", now(), actorId, "web_ui", "en-US", "America/New_York");

    db.prepare(
      `INSERT INTO structured_requirement_versions (structured_requirement_version_id, analysis_project_id, analysis_request_id, version_ordinal, schema_version, content_sha256, storage_ref, created_at, created_by_actor_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(reqVerId, projectId, reqId, 1, "1.0", "a".repeat(64), "blobs/aa/aaa", now(), actorId);

    // Update project current pointer in same transaction
    db.prepare(
      `UPDATE analysis_projects SET current_requirement_version_id = ?, updated_at = ? WHERE analysis_project_id = ?`,
    ).run(reqVerId, now(), projectId);

    db.exec("COMMIT");

    // Verify
    const row = db.prepare("SELECT current_requirement_version_id FROM analysis_projects WHERE analysis_project_id = ?").get(projectId) as { current_requirement_version_id: string };
    assert.equal(row.current_requirement_version_id, reqVerId);
  });
});

describe("constraint: unique Run input Evidence", () => {
  function setupRunWithEvidence(): { runId: string; evidenceId: string } {
    const projectId = insertProject();
    const actorId = insertActor();
    const reqId = uuid();
    const reqVerId = uuid();
    const planVerId = uuid();
    const runId = uuid();
    const sourceRefId = uuid();
    const evidenceId = uuid();

    db.exec("BEGIN");
    db.prepare(
      `INSERT INTO analysis_requests (analysis_request_id, analysis_project_id, raw_request_text, submitted_context_evidence_ids_json, submitted_at, submitted_by_actor_id, submitted_via, locale, timezone) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(reqId, projectId, "text", "[]", now(), actorId, "web_ui", "en-US", "America/New_York");

    db.prepare(
      `INSERT INTO structured_requirement_versions (structured_requirement_version_id, analysis_project_id, analysis_request_id, version_ordinal, schema_version, content_sha256, storage_ref, created_at, created_by_actor_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(reqVerId, projectId, reqId, 1, "1.0", "a".repeat(64), "blobs/aa/aaa", now(), actorId);

    db.prepare(
      `INSERT INTO analysis_plan_versions (analysis_plan_version_id, analysis_project_id, structured_requirement_version_id, version_ordinal, schema_version, content_sha256, storage_ref, created_at, created_by_actor_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(planVerId, projectId, reqVerId, 1, "1.0", "b".repeat(64), "blobs/bb/bbb", now(), actorId);

    db.prepare(
      `INSERT INTO analysis_runs (analysis_run_id, analysis_project_id, analysis_plan_version_id, run_ordinal, current_analysis_stage, current_run_status, queued_at, triggered_by_actor_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(runId, projectId, planVerId, 1, "S2.1", "queued", now(), actorId);

    // Create evidence with source_reference (deferred circular)
    db.prepare(
      `INSERT INTO evidence_artifacts (evidence_artifact_id, analysis_project_id, analysis_run_id, origin_kind, artifact_kind, display_name, storage_ref, content_sha256, media_type, byte_size, safety_class, visibility, created_at, created_by_actor_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(evidenceId, projectId, runId, "analysis_run", "intermediate_result", "test", "blobs/aa/aaa", "h".repeat(64), "application/json", 100, "derived", "review_only", now(), actorId);

    db.exec("COMMIT");
    return { runId, evidenceId };
  }

  test("rejects duplicate (run_id, evidence_id)", () => {
    const { runId, evidenceId } = setupRunWithEvidence();

    // First input evidence
    db.prepare(
      `INSERT INTO analysis_run_input_evidence (analysis_run_id, evidence_artifact_id, input_role, input_ordinal, plan_step_id, admitted_at) VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(runId, evidenceId, "plan_input", 1, "step1", now());

    // Duplicate (run_id, evidence_id)
    assert.throws(
      () => db.prepare(
        `INSERT INTO analysis_run_input_evidence (analysis_run_id, evidence_artifact_id, input_role, input_ordinal, plan_step_id, admitted_at) VALUES (?, ?, ?, ?, ?, ?)`,
      ).run(runId, evidenceId, "source_snapshot", 2, "step2", now()),
      /UNIQUE constraint failed/,
    );
  });

  test("rejects duplicate (run_id, input_ordinal)", () => {
    const { runId, evidenceId } = setupRunWithEvidence();

    db.prepare(
      `INSERT INTO analysis_run_input_evidence (analysis_run_id, evidence_artifact_id, input_role, input_ordinal, plan_step_id, admitted_at) VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(runId, evidenceId, "plan_input", 1, "step1", now());

    // Create another evidence for the same run
    const evidenceId2 = uuid();
    const projectId = db.prepare("SELECT analysis_project_id FROM analysis_runs WHERE analysis_run_id = ?").get(runId) as { analysis_project_id: string };
    const actorId = insertActor();
    db.prepare(
      `INSERT INTO evidence_artifacts (evidence_artifact_id, analysis_project_id, analysis_run_id, origin_kind, artifact_kind, display_name, storage_ref, content_sha256, media_type, byte_size, safety_class, visibility, created_at, created_by_actor_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(evidenceId2, projectId.analysis_project_id, runId, "analysis_run", "query", "test2", "blobs/cc/ccc", "i".repeat(64), "text/plain", 50, "derived", "review_only", now(), actorId);

    // Same ordinal, different evidence
    assert.throws(
      () => db.prepare(
        `INSERT INTO analysis_run_input_evidence (analysis_run_id, evidence_artifact_id, input_role, input_ordinal, plan_step_id, admitted_at) VALUES (?, ?, ?, ?, ?, ?)`,
      ).run(runId, evidenceId2, "source_snapshot", 1, "step2", now()),
      /UNIQUE constraint failed/,
    );
  });
});

describe("constraint: evidence_artifacts run/source not both null", () => {
  test("rejects evidence with both analysis_run_id and source_reference_id null", () => {
    const projectId = insertProject();
    const actorId = insertActor();
    assert.throws(
      () => db.prepare(
        `INSERT INTO evidence_artifacts (evidence_artifact_id, analysis_project_id, origin_kind, artifact_kind, display_name, storage_ref, content_sha256, media_type, byte_size, safety_class, visibility, created_at, created_by_actor_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(uuid(), projectId, "system_generated", "diagnostic", "test", "blobs/aa/aaa", "j".repeat(64), "text/plain", 10, "derived", "system_only", now(), actorId),
      /CHECK constraint failed/,
    );
  });
});

describe("constraint: source_references identity mutually exclusive", () => {
  test("rejects both AgentHarness identity and user evidence", () => {
    const projectId = insertProject();
    const actorId = insertActor();
    const evidenceId = uuid();

    // Need a valid evidence first - create one with analysis_run_id set to avoid both-null
    // Actually we can't easily create an evidence without a source_ref or run...
    // Let's create an evidence referencing a run
    const reqId = uuid();
    const reqVerId = uuid();
    const planVerId = uuid();
    const runId = uuid();

    db.exec("BEGIN");
    db.prepare(
      `INSERT INTO analysis_requests (analysis_request_id, analysis_project_id, raw_request_text, submitted_context_evidence_ids_json, submitted_at, submitted_by_actor_id, submitted_via, locale, timezone) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(reqId, projectId, "text", "[]", now(), actorId, "web_ui", "en-US", "America/New_York");
    db.prepare(
      `INSERT INTO structured_requirement_versions (structured_requirement_version_id, analysis_project_id, analysis_request_id, version_ordinal, schema_version, content_sha256, storage_ref, created_at, created_by_actor_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(reqVerId, projectId, reqId, 1, "1.0", "a".repeat(64), "blobs/aa/aaa", now(), actorId);
    db.prepare(
      `INSERT INTO analysis_plan_versions (analysis_plan_version_id, analysis_project_id, structured_requirement_version_id, version_ordinal, schema_version, content_sha256, storage_ref, created_at, created_by_actor_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(planVerId, projectId, reqVerId, 1, "1.0", "b".repeat(64), "blobs/bb/bbb", now(), actorId);
    db.prepare(
      `INSERT INTO analysis_runs (analysis_run_id, analysis_project_id, analysis_plan_version_id, run_ordinal, current_analysis_stage, current_run_status, queued_at, triggered_by_actor_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(runId, projectId, planVerId, 1, "S2.1", "succeeded", now(), actorId);
    db.prepare(
      `INSERT INTO evidence_artifacts (evidence_artifact_id, analysis_project_id, analysis_run_id, origin_kind, artifact_kind, display_name, storage_ref, content_sha256, media_type, byte_size, safety_class, visibility, created_at, created_by_actor_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(evidenceId, projectId, runId, "analysis_run", "intermediate_result", "ev", "blobs/aa/aaa", "k".repeat(64), "application/json", 100, "derived", "review_only", now(), actorId);
    db.exec("COMMIT");

    // Now try to create a source_reference with BOTH agentharness identity AND initial_evidence
    assert.throws(
      () => db.prepare(
        `INSERT INTO source_references (source_reference_id, analysis_project_id, source_kind, display_name, description, capability_id, contract_version, source_object_key, initial_evidence_artifact_id, declared_data_scope, usage_constraints_json, safety_handling_policy, created_at, created_by_actor_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(uuid(), projectId, "agentharness", "test", "desc", "cap1", "1.0", "key1", evidenceId, "scope", "[]", "derived_only_allowed", now(), actorId),
      /CHECK constraint failed/,
    );
  });

  test("rejects neither AgentHarness identity nor user evidence", () => {
    const projectId = insertProject();
    const actorId = insertActor();
    assert.throws(
      () => db.prepare(
        `INSERT INTO source_references (source_reference_id, analysis_project_id, source_kind, display_name, description, declared_data_scope, usage_constraints_json, safety_handling_policy, created_at, created_by_actor_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(uuid(), projectId, "user_provided", "test", "desc", "scope", "[]", "derived_only_allowed", now(), actorId),
      /CHECK constraint failed/,
    );
  });
});
