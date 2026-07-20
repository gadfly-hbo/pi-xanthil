/**
 * P0 database constraint tests - Part 1: schema introspection, slug, run, event, gate.
 */
import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { runMigrations, loadMigrations } from "../persistence/migration-runner.ts";
import { openDatabase, listTables, listAllIndexes } from "../persistence/db.ts";
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

function insertActor(id: string = uuid(), kind: string = "human"): string {
  db.prepare(
    `INSERT INTO audit_actors (audit_actor_id, actor_kind, actor_key, display_name, created_at) VALUES (?, ?, ?, ?, ?)`,
  ).run(id, kind, `key-${id}`, `Actor ${id}`, now());
  return id;
}

function insertProject(id: string = uuid(), opts: { slug?: string; status?: string } = {}): string {
  const actorId = insertActor();
  db.prepare(
    `INSERT INTO analysis_projects (analysis_project_id, workspace_id, project_kind, title, slug, project_status, created_at, created_by_actor_id, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(id, "ws-test", "daily_analysis", "Test Project", opts.slug ?? `slug-${id}`, opts.status ?? "active", now(), actorId, now());
  return id;
}

function insertRequest(projectId: string): string {
  const id = uuid();
  const actorId = insertActor();
  db.prepare(
    `INSERT INTO analysis_requests (analysis_request_id, analysis_project_id, raw_request_text, submitted_context_evidence_ids_json, submitted_at, submitted_by_actor_id, submitted_via, locale, timezone) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(id, projectId, "raw text", "[]", now(), actorId, "web_ui", "en-US", "America/New_York");
  return id;
}

function insertReqVersion(projectId: string, requestId: string, ordinal: number = 1): string {
  const id = uuid();
  const actorId = insertActor();
  db.prepare(
    `INSERT INTO structured_requirement_versions (structured_requirement_version_id, analysis_project_id, analysis_request_id, version_ordinal, schema_version, content_sha256, storage_ref, created_at, created_by_actor_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(id, projectId, requestId, ordinal, "1.0", "a".repeat(64), "blobs/aa/aaa", now(), actorId);
  return id;
}

function insertPlanVersion(projectId: string, reqVersionId: string, ordinal: number = 1): string {
  const id = uuid();
  const actorId = insertActor();
  db.prepare(
    `INSERT INTO analysis_plan_versions (analysis_plan_version_id, analysis_project_id, structured_requirement_version_id, version_ordinal, schema_version, content_sha256, storage_ref, created_at, created_by_actor_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(id, projectId, reqVersionId, ordinal, "1.0", "b".repeat(64), "blobs/bb/bbb", now(), actorId);
  return id;
}

function insertRun(projectId: string, planVersionId: string, opts: { status?: string; ordinal?: number } = {}): string {
  const id = uuid();
  const actorId = insertActor();
  db.prepare(
    `INSERT INTO analysis_runs (analysis_run_id, analysis_project_id, analysis_plan_version_id, run_ordinal, current_analysis_stage, current_run_status, queued_at, triggered_by_actor_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(id, projectId, planVersionId, opts.ordinal ?? 1, "S2.1", opts.status ?? "queued", now(), actorId);
  return id;
}

describe("schema introspection", () => {
  test("lists all v1 tables", () => {
    const tables = listTables(db);
    const expected = ["schema_migrations","audit_actors","analysis_projects","analysis_requests","structured_requirement_versions","analysis_plan_versions","source_references","source_checks","analysis_runs","analysis_run_input_evidence","run_events","evidence_artifacts","report_versions","report_version_evidence","gate_decisions"];
    for (const t of expected) assert.ok(tables.includes(t), `table ${t} should exist`);
  });

  test("lists key indexes", () => {
    const indexes = listAllIndexes(db);
    assert.ok(indexes.includes("idx_analysis_runs_single_active"));
    assert.ok(indexes.includes("idx_gate_decisions_single_approved_report"));
    assert.ok(indexes.includes("idx_source_references_agentharness_identity"));
    assert.ok(indexes.includes("idx_run_events_producer_idempotency"));
    assert.ok(indexes.includes("idx_analysis_projects_status_archived_updated"));
    assert.ok(indexes.includes("idx_evidence_artifacts_content_hash"));
    assert.ok(indexes.includes("idx_run_events_run_sequence"));
  });
});

describe("constraint: case-insensitive unique slug", () => {
  test("rejects duplicate slug differing only in case", () => {
    insertProject("p1", { slug: "my-project" });
    assert.throws(() => insertProject("p2", { slug: "MY-PROJECT" }), /UNIQUE constraint failed/);
  });
  test("allows different slugs", () => {
    insertProject("p1", { slug: "project-a" });
    insertProject("p2", { slug: "project-b" });
  });
});

describe("constraint: single non-terminal Run per project", () => {
  test("rejects second queued/running run in same project", () => {
    const projectId = insertProject();
    const reqId = insertRequest(projectId);
    const reqVerId = insertReqVersion(projectId, reqId);
    const planVerId = insertPlanVersion(projectId, reqVerId);
    insertRun(projectId, planVerId, { status: "queued", ordinal: 1 });
    assert.throws(
      () => insertRun(projectId, planVerId, { status: "running", ordinal: 2 }),
      /UNIQUE constraint failed/,
    );
  });
  test("allows new run after previous run reached terminal state", () => {
    const projectId = insertProject();
    const reqId = insertRequest(projectId);
    const reqVerId = insertReqVersion(projectId, reqId);
    const planVerId = insertPlanVersion(projectId, reqVerId);
    insertRun(projectId, planVerId, { status: "succeeded", ordinal: 1 });
    insertRun(projectId, planVerId, { status: "queued", ordinal: 2 });
  });
});

describe("constraint: unique Run Event sequence", () => {
  test("rejects duplicate sequence number for same run", () => {
    const projectId = insertProject();
    const reqId = insertRequest(projectId);
    const reqVerId = insertReqVersion(projectId, reqId);
    const planVerId = insertPlanVersion(projectId, reqVerId);
    const runId = insertRun(projectId, planVerId);

    db.prepare(
      `INSERT INTO run_events (run_event_id, analysis_run_id, sequence, event_type, analysis_stage_after, run_status_after, occurred_at, recorded_at, producer_name, payload_schema_version, payload_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(uuid(), runId, 1, "run_queued", "S2.1", "queued", now(), now(), "test", "1.0", "{}");

    assert.throws(
      () => db.prepare(
        `INSERT INTO run_events (run_event_id, analysis_run_id, sequence, event_type, analysis_stage_after, run_status_after, occurred_at, recorded_at, producer_name, payload_schema_version, payload_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(uuid(), runId, 1, "run_started", "S2.1", "running", now(), now(), "test", "1.0", "{}"),
      /UNIQUE constraint failed/,
    );
  });
});

describe("constraint: single approved report_review per project", () => {
  test("rejects second approved report_review in same project", () => {
    const projectId = insertProject();
    const actorId = insertActor();
    db.prepare(
      `INSERT INTO gate_decisions (gate_decision_id, analysis_project_id, gate_type, target_object_type, target_object_id, target_schema_version, target_content_sha256, decision, decided_at, decided_by_actor_id, actor_display_name_snapshot, requested_changes_json, submitted_via) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(uuid(), projectId, "report_review", "report_version", "rv1", "1.0", "c".repeat(64), "approved", now(), actorId, "Tester", "[]", "web_ui");

    assert.throws(
      () => db.prepare(
        `INSERT INTO gate_decisions (gate_decision_id, analysis_project_id, gate_type, target_object_type, target_object_id, target_schema_version, target_content_sha256, decision, decided_at, decided_by_actor_id, actor_display_name_snapshot, requested_changes_json, submitted_via) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(uuid(), projectId, "report_review", "report_version", "rv2", "1.0", "d".repeat(64), "approved", now(), actorId, "Tester", "[]", "web_ui"),
      /UNIQUE constraint failed/,
    );
  });
  test("allows changes_requested and rejected in same project", () => {
    const projectId = insertProject();
    const actorId = insertActor();
    for (const decision of ["changes_requested", "rejected"]) {
      const changesJson = decision === "changes_requested" ? '[{"issue":"x"}]' : "[]";
      const rejectionReason = decision === "rejected" ? "bad" : null;
      db.prepare(
        `INSERT INTO gate_decisions (gate_decision_id, analysis_project_id, gate_type, target_object_type, target_object_id, target_schema_version, target_content_sha256, decision, decided_at, decided_by_actor_id, actor_display_name_snapshot, requested_changes_json, rejection_reason, submitted_via) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(uuid(), projectId, "report_review", "report_version", `rv-${decision}`, "1.0", "e".repeat(64), decision, now(), actorId, "Tester", changesJson, rejectionReason, "web_ui");
    }
  });
});

describe("constraint: gate decision condition fields", () => {
  test("approved with non-empty requested_changes is rejected", () => {
    const projectId = insertProject();
    const actorId = insertActor();
    assert.throws(
      () => db.prepare(
        `INSERT INTO gate_decisions (gate_decision_id, analysis_project_id, gate_type, target_object_type, target_object_id, target_schema_version, target_content_sha256, decision, decided_at, decided_by_actor_id, actor_display_name_snapshot, requested_changes_json, submitted_via) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(uuid(), projectId, "requirement_confirmation", "structured_requirement_version", "rv1", "1.0", "f".repeat(64), "approved", now(), actorId, "Tester", '[{"issue":"x"}]', "web_ui"),
      /CHECK constraint failed/,
    );
  });
  test("rejected with empty rejection_reason is rejected", () => {
    const projectId = insertProject();
    const actorId = insertActor();
    assert.throws(
      () => db.prepare(
        `INSERT INTO gate_decisions (gate_decision_id, analysis_project_id, gate_type, target_object_type, target_object_id, target_schema_version, target_content_sha256, decision, decided_at, decided_by_actor_id, actor_display_name_snapshot, requested_changes_json, rejection_reason, submitted_via) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(uuid(), projectId, "requirement_confirmation", "structured_requirement_version", "rv1", "1.0", "g".repeat(64), "rejected", now(), actorId, "Tester", "[]", null, "web_ui"),
      /CHECK constraint failed/,
    );
  });
});

describe("constraint: audit chain FK deletion (RESTRICT)", () => {
  test("rejects deleting audit actor referenced by project", () => {
    const projectId = insertProject();
    // Find the actor that created the project
    const row = db.prepare("SELECT created_by_actor_id FROM analysis_projects WHERE analysis_project_id = ?").get(projectId) as { created_by_actor_id: string };
    assert.throws(
      () => db.prepare("DELETE FROM audit_actors WHERE audit_actor_id = ?").run(row.created_by_actor_id),
      /FOREIGN KEY constraint failed/,
    );
  });
});

describe("constraint: source_checks non-available requires diagnostics", () => {
  test("non-available without diagnostic_code is rejected", () => {
    const projectId = insertProject();
    const actorId = insertActor();
    const sourceRefId = uuid();
    const evidenceId = uuid();
    // Create minimal evidence+source_ref with deferred FK
    db.exec("BEGIN");
    db.prepare(
      `INSERT INTO evidence_artifacts (evidence_artifact_id, analysis_project_id, source_reference_id, origin_kind, artifact_kind, display_name, storage_ref, content_sha256, media_type, byte_size, safety_class, visibility, created_at, created_by_actor_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(evidenceId, projectId, sourceRefId, "user_provided", "input_material", "test", "blobs/aa/aaa", "h".repeat(64), "text/plain", 10, "derived", "user_visible", now(), actorId);
    db.prepare(
      `INSERT INTO source_references (source_reference_id, analysis_project_id, source_kind, display_name, description, initial_evidence_artifact_id, declared_data_scope, usage_constraints_json, safety_handling_policy, created_at, created_by_actor_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(sourceRefId, projectId, "user_provided", "test", "desc", evidenceId, "scope", "[]", "derived_only_allowed", now(), actorId);
    db.exec("COMMIT");

    assert.throws(
      () => db.prepare(
        `INSERT INTO source_checks (source_check_id, source_reference_id, checked_at, availability_status, adapter_name, adapter_version) VALUES (?, ?, ?, ?, ?, ?)`,
      ).run(uuid(), sourceRefId, now(), "access_denied", "adapter", "1.0"),
      /CHECK constraint failed/,
    );
  });
});
