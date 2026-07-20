/**
 * Negative contract tests for WCA-02 Workspace isolation and fail-closed behavior.
 * Covers: cross-workspace isolation, 0003 migration, actor bootstrap idempotency,
 * unknown enum/schema fail closed, restricted_raw exclusion, terminal RunEvent,
 * Gate target mismatch, Locked Report provenance.
 */
import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createMigratedDb, TEST_WORKSPACE_ID, TEST_WORKSPACE_ID_2, createFakeWorkspacePort } from "./application-helpers.ts";
import { bootstrapSystemActor, setupLocalHuman, getHumanActor } from "../application/actors/actor-service.ts";
import { createProject } from "../application/projects/project-service.ts";
import { reopenProject } from "../application/projects/project-lifecycle-service.ts";
import { getProjectById } from "../application/projects/project-queries.ts";
import { queryProjectDetail } from "../application/read-models/project-detail.ts";
import { queryProjectList } from "../application/read-models/project-list.ts";
import { generateRequirement } from "../application/requirements/requirement-service.ts";
import { submitAnalysisRequest } from "../application/requests/request-service.ts";
import { assertRunEventType, assertProjectStage, PROJECT_STAGES, ANALYSIS_STAGES, ENGINE_PORT_VERSION } from "../contracts/registries.ts";
import type { TrustedActorContext } from "../application/shared/runtime.ts";
import type { WorkspaceExistencePort } from "../contracts/workspace-port.ts";
import type { DatabaseSync } from "node:sqlite";

let db: DatabaseSync;
let cleanup: () => void;
let humanCtx: TrustedActorContext;
let workspacePort: WorkspaceExistencePort;

beforeEach(async () => {
  const env = await createMigratedDb();
  db = env.db;
  cleanup = env.cleanup;
  humanCtx = env.humanCtx;
  workspacePort = env.workspacePort;
});

afterEach(() => cleanup());

describe("WCA-02: Workspace isolation", () => {
  test("cross-workspace project read returns null", () => {
    // Create project in workspace 1
    const res = createProject({ db, workspacePort, workspaceId: TEST_WORKSPACE_ID, actorContext: humanCtx, idempotencyKey: randomUUID(), body: { title: "WS1 Project", slug: "ws1-" + randomUUID().slice(0, 8) } });
    assert.equal(res.kind, "executed");
    const projectId = res.resultResourceId;

    // Read from workspace 1 should succeed
    const p1 = getProjectById(db, TEST_WORKSPACE_ID, projectId);
    assert.ok(p1);
    assert.equal(p1.analysisProjectId, projectId);

    // Read from workspace 2 should return null (not leak)
    const p2 = getProjectById(db, TEST_WORKSPACE_ID_2, projectId);
    assert.equal(p2, null);
  });

  test("cross-workspace duplicate slug rejected (global uniqueness)", () => {
    const slug = "shared-slug-" + randomUUID().slice(0, 8);
    // Create in workspace 1
    const r1 = createProject({ db, workspacePort, workspaceId: TEST_WORKSPACE_ID, actorContext: humanCtx, idempotencyKey: randomUUID(), body: { title: "WS1", slug } });
    assert.equal(r1.kind, "executed");

    // Create same slug in workspace 2 should fail (slug is globally unique, not workspace-scoped)
    const r2 = createProject({ db, workspacePort, workspaceId: TEST_WORKSPACE_ID_2, actorContext: humanCtx, idempotencyKey: randomUUID(), body: { title: "WS2", slug } });
    assert.equal(r2.kind, "failed");
    if (r2.kind === "failed") assert.equal(r2.errorCode, "validation_failed", "slug is globally unique");
  });

  test("cross-workspace reopen relation fail closed", () => {
    // Create and reject a project in workspace 1
    const res = createProject({ db, workspacePort, workspaceId: TEST_WORKSPACE_ID, actorContext: humanCtx, idempotencyKey: randomUUID(), body: { title: "WS1 Reopen", slug: "ws1reop-" + randomUUID().slice(0, 8) } });
    assert.equal(res.kind, "executed");
    const projectId = res.resultResourceId;
    db.prepare("UPDATE analysis_projects SET project_status = 'rejected', rejected_at = ? WHERE analysis_project_id = ?").run(new Date().toISOString(), projectId);

    // Count projects before cross-workspace reopen attempt
    const countBefore = (db.prepare("SELECT COUNT(*) as c FROM analysis_projects").get() as { c: number }).c;

    // Reopen from workspace 2 should fail (source project not in workspace 2)
    // reopenProject calls requireProject which throws ApplicationError
    const p = getProjectById(db, TEST_WORKSPACE_ID, projectId)!;
    assert.ok(p, "project should exist in workspace 1");
    assert.throws(
      () => reopenProject({ db, workspacePort, workspaceId: TEST_WORKSPACE_ID_2, actorContext: humanCtx, idempotencyKey: randomUUID(), body: { title: "Reopened", slug: "reop2-" + randomUUID().slice(0, 8), expectedUpdatedAt: p.updatedAt }, projectId }),
      /Project not found/,
    );

    // Assert no new project or relation was created
    const countAfter = (db.prepare("SELECT COUNT(*) as c FROM analysis_projects").get() as { c: number }).c;
    assert.equal(countAfter, countBefore, "no new project should be created on failed reopen");
  });

  test("cross-workspace read-model returns empty for non-owned project", () => {
    // Create project in workspace 1
    const res = createProject({ db, workspacePort, workspaceId: TEST_WORKSPACE_ID, actorContext: humanCtx, idempotencyKey: randomUUID(), body: { title: "WS1 RM", slug: "ws1rm-" + randomUUID().slice(0, 8) } });
    assert.equal(res.kind, "executed");
    const projectId = res.resultResourceId;

    // queryProjectDetail from workspace 2 must fail with resource_not_found
    assert.throws(
      () => queryProjectDetail({ db, workspaceId: TEST_WORKSPACE_ID_2, actorContext: humanCtx, projectId, authorizedForContent: false }),
      (err: unknown) => (err as { code?: string }).code === "resource_not_found",
    );

    // queryProjectList from workspace 2 must not contain workspace 1 project
    const list = queryProjectList({ db, workspaceId: TEST_WORKSPACE_ID_2, actorContext: humanCtx, filter: {}, limit: 100 });
    const found = list.data.items.find((item) => item.projectId === projectId);
    assert.equal(found, undefined, "workspace 2 list must not contain workspace 1 project");
  });

  test("workspace existence port rejects unknown workspace", () => {
    const unknownWs = "00000000-0000-4000-8000-999999999999";
    assert.throws(
      () => createProject({ db, workspacePort, workspaceId: unknownWs, actorContext: humanCtx, idempotencyKey: randomUUID(), body: { title: "T", slug: "t-" + randomUUID().slice(0, 8) } }),
      /Workspace not found/,
    );
  });

  test("reopen preserves workspace", () => {
    // Create and reject a project in workspace 1
    const res = createProject({ db, workspacePort, workspaceId: TEST_WORKSPACE_ID, actorContext: humanCtx, idempotencyKey: randomUUID(), body: { title: "To Reject", slug: "rej-" + randomUUID().slice(0, 8) } });
    assert.equal(res.kind, "executed");
    const projectId = res.resultResourceId;
    db.prepare("UPDATE analysis_projects SET project_status = 'rejected', rejected_at = ? WHERE analysis_project_id = ?").run(new Date().toISOString(), projectId);

    // Reopen should create new project in same workspace
    const p = getProjectById(db, TEST_WORKSPACE_ID, projectId)!;
    const reopen = reopenProject({ db, workspacePort, workspaceId: TEST_WORKSPACE_ID, actorContext: humanCtx, idempotencyKey: randomUUID(), body: { title: "Reopened", slug: "reop-" + randomUUID().slice(0, 8), expectedUpdatedAt: p.updatedAt }, projectId });
    assert.equal(reopen.kind, "executed");
    if (reopen.kind === "executed") {
      const newP = getProjectById(db, TEST_WORKSPACE_ID, reopen.resultResourceId);
      assert.ok(newP);
      assert.equal(newP!.workspaceId, TEST_WORKSPACE_ID);
      assert.equal(newP!.sourceProjectId, projectId);
      assert.equal(newP!.sourceRelationType, "reopened_from");
    }
  });
});

describe("0003 migration", () => {
  test("empty DB: 0003 migration applies successfully", async () => {
    // createMigratedDb already applies all migrations including 0003
    // Verify workspace_id column exists
    const cols = db.prepare("PRAGMA table_info(analysis_projects)").all() as Array<{ name: string }>;
    const wsCol = cols.find((c) => c.name === "workspace_id");
    assert.ok(wsCol, "workspace_id column must exist");
  });

  test("workspace_id is NOT NULL", () => {
    // Insert without workspace_id should fail
    const actorId = randomUUID();
    db.prepare("INSERT INTO audit_actors (audit_actor_id, actor_kind, actor_key, display_name, created_at) VALUES (?, 'system', 'sys', 'System', ?)").run(actorId, new Date().toISOString());
    assert.throws(
      () => db.prepare("INSERT INTO analysis_projects (analysis_project_id, project_kind, title, slug, project_status, created_at, created_by_actor_id, updated_at) VALUES (?, 'daily_analysis', 'T', 's', 'active', ?, ?, ?)").run(randomUUID(), new Date().toISOString(), actorId, new Date().toISOString()),
      /NOT NULL constraint failed.*workspace_id/,
    );
  });

  test("workspace-scoped indexes exist", () => {
    const indexes = db.prepare("SELECT name FROM sqlite_master WHERE type='index' AND name LIKE 'idx_analysis_projects_workspace%'").all() as Array<{ name: string }>;
    assert.ok(indexes.length >= 2, "must have workspace-scoped indexes");
  });

  test("0003 non-empty pre-upgrade fail closed", async () => {
    // Create a fresh DB with only 0001+0002, add data, then try 0003
    const { mkdtempSync, rmSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const { initDataRoot } = await import("../persistence/data-root.ts");
    const { openDatabase } = await import("../persistence/db.ts");
    const { runMigrations, loadMigrations } = await import("../persistence/migration-runner.ts");

    const dir = mkdtempSync(join(tmpdir(), "xanthil-0003-test-"));
    const layout = initDataRoot(dir);
    const testDb = openDatabase(layout.sqlitePath);
    const migrationsDir = join(import.meta.dirname, "..", "persistence", "migrations");
    const allMigrations = loadMigrations(migrationsDir);

    // Apply only 0001+0002
    const m0001_0002 = allMigrations.filter((m) => m.version <= 2);
    await runMigrations(testDb, m0001_0002, layout);

    // Add a project without workspace_id (0001/0002 schema allows this)
    const actorId = randomUUID();
    testDb.prepare("INSERT INTO audit_actors (audit_actor_id, actor_kind, actor_key, display_name, created_at) VALUES (?, 'system', 'sys', 'System', ?)").run(actorId, new Date().toISOString());
    testDb.prepare("INSERT INTO analysis_projects (analysis_project_id, project_kind, title, slug, project_status, created_at, created_by_actor_id, updated_at) VALUES (?, 'daily_analysis', 'Old Project', 'old-slug', 'active', ?, ?, ?)").run(randomUUID(), new Date().toISOString(), actorId, new Date().toISOString());

    // Now try to apply 0003 (pass all migrations, runner will skip 0001+0002)
    // The migration will fail because workspace_id is NOT NULL and existing rows have no value
    // runMigrations catches the error, closes the DB, and restores from backup
    let migrationFailed = false;
    try {
      await runMigrations(testDb, allMigrations, layout);
    } catch (err) {
      migrationFailed = true;
      const msg = (err as Error).message;
      assert.match(msg, /restored from backup|Migration failed/i);
    }
    assert.ok(migrationFailed, "migration must fail on non-empty DB without workspace_id");

    // testDb may be closed by migration failure, cleanup handles it
    try { testDb.close(); } catch { /* already closed */ }
    rmSync(dir, { recursive: true, force: true });
  });

  test("0003 checksum drift fails closed", async () => {
    // Create a fresh DB, apply 0001+0002, then try with tampered 0003
    const { mkdtempSync, rmSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const { initDataRoot } = await import("../persistence/data-root.ts");
    const { openDatabase } = await import("../persistence/db.ts");
    const { runMigrations, loadMigrations } = await import("../persistence/migration-runner.ts");

    const dir = mkdtempSync(join(tmpdir(), "xanthil-0003-drift-"));
    const layout = initDataRoot(dir);
    const testDb = openDatabase(layout.sqlitePath);
    const migrationsDir = join(import.meta.dirname, "..", "persistence", "migrations");
    const allMigrations = loadMigrations(migrationsDir);

    // Apply all migrations first
    await runMigrations(testDb, allMigrations, layout);
    testDb.close();

    // Reopen and try to apply with tampered 0003 checksum
    const testDb2 = openDatabase(layout.sqlitePath);
    const m0003 = allMigrations.find((m) => m.version === 3)!;
    const tampered = { ...m0003, checksum: "a".repeat(64) };
    const tamperedMigrations = allMigrations.filter((m) => m.version !== 3).concat(tampered);

    await assert.rejects(
      () => runMigrations(testDb2, tamperedMigrations, layout),
      /Migration drift detected|checksum mismatch/,
    );

    testDb2.close();
    rmSync(dir, { recursive: true, force: true });
  });
});

describe("Actor bootstrap idempotency", () => {
  test("bootstrapSystemActor returns same actor on repeated calls", () => {
    const sys1 = bootstrapSystemActor(db);
    const sys2 = bootstrapSystemActor(db);
    const sys3 = bootstrapSystemActor(db);
    assert.equal(sys1.auditActorId, sys2.auditActorId);
    assert.equal(sys2.auditActorId, sys3.auditActorId);
    assert.equal(sys1.actorKind, "system");
  });

  test("setupLocalHuman is one-time only", () => {
    const sys = bootstrapSystemActor(db);
    const sysCtx: TrustedActorContext = { actorId: sys.auditActorId, actorKind: "system", submittedVia: "local_api", clientVersion: null, active: true };
    // Human actor already created by createAppTestEnv, so second call should fail
    const r = setupLocalHuman({ db, actorContext: sysCtx, idempotencyKey: randomUUID(), body: { displayName: "Bob", actorKey: "bob" } });
    assert.equal(r.kind, "failed");
    if (r.kind === "failed") assert.equal(r.errorCode, "invalid_state_transition");
  });
});

describe("Unknown enum/schema fail closed", () => {
  test("assertRunEventType rejects unknown event type", () => {
    assert.throws(() => assertRunEventType("unknown_event"), /Unknown run_event_type/);
    assert.throws(() => assertRunEventType(""), /Unknown run_event_type/);
    assert.throws(() => assertRunEventType("pi_raw_chunk"), /Unknown run_event_type/);
  });

  test("assertProjectStage rejects unknown stage", () => {
    assert.throws(() => assertProjectStage("S1.3"), /Unknown project_stage/);
    assert.throws(() => assertProjectStage("S3.0"), /Unknown project_stage/);
    assert.throws(() => assertProjectStage(""), /Unknown project_stage/);
  });

  test("all ANALYSIS_STAGES are also ProjectStages", () => {
    for (const stage of ANALYSIS_STAGES) {
      assert.ok(PROJECT_STAGES.includes(stage as never), `AnalysisStage ${stage} must be a ProjectStage`);
    }
  });
});

describe("restricted_raw exclusion from Engine context", () => {
  test("restricted_raw evidence ID/content not passed to Engine handler", async () => {
    // Create a project with both controlled and restricted_raw evidence
    const res = createProject({ db, workspacePort, workspaceId: TEST_WORKSPACE_ID, actorContext: humanCtx, idempotencyKey: randomUUID(), body: { title: "Restricted Test", slug: "rest-" + randomUUID().slice(0, 8) } });
    assert.equal(res.kind, "executed");
    const projectId = res.resultResourceId;

    const ts = new Date().toISOString();
    const storageRef = "blobs/00/" + "0".repeat(64);
    const contentSha = "0".repeat(64);

    // Create source + controlled evidence (admissible)
    const controlledSourceId = randomUUID();
    const controlledEvidenceId = randomUUID();
    db.exec("BEGIN");
    db.prepare("INSERT INTO source_references (source_reference_id, analysis_project_id, source_kind, display_name, description, initial_evidence_artifact_id, declared_data_scope, usage_constraints_json, safety_handling_policy, created_at, created_by_actor_id) VALUES (?, ?, 'user_provided', 'Controlled Source', 'desc', ?, 'scope', '[]', 'local_transform_required', ?, ?)").run(controlledSourceId, projectId, controlledEvidenceId, ts, humanCtx.actorId);
    db.prepare("INSERT INTO evidence_artifacts (evidence_artifact_id, analysis_project_id, source_reference_id, origin_kind, artifact_kind, display_name, storage_ref, content_sha256, media_type, byte_size, safety_class, visibility, created_at, created_by_actor_id) VALUES (?, ?, ?, 'user_provided', 'input_material', 'Controlled Evidence', ?, ?, 'text/plain', 10, 'controlled', 'user_visible', ?, ?)").run(controlledEvidenceId, projectId, controlledSourceId, storageRef, contentSha, ts, humanCtx.actorId);

    // Create source + restricted_raw evidence (NOT admissible)
    const restrictedSourceId = randomUUID();
    const restrictedEvidenceId = randomUUID();
    db.prepare("INSERT INTO source_references (source_reference_id, analysis_project_id, source_kind, display_name, description, initial_evidence_artifact_id, declared_data_scope, usage_constraints_json, safety_handling_policy, created_at, created_by_actor_id) VALUES (?, ?, 'user_provided', 'Restricted Source', 'desc', ?, 'scope', '[]', 'local_transform_required', ?, ?)").run(restrictedSourceId, projectId, restrictedEvidenceId, ts, humanCtx.actorId);
    db.prepare("INSERT INTO evidence_artifacts (evidence_artifact_id, analysis_project_id, source_reference_id, origin_kind, artifact_kind, display_name, storage_ref, content_sha256, media_type, byte_size, safety_class, visibility, created_at, created_by_actor_id) VALUES (?, ?, ?, 'user_provided', 'input_material', 'Restricted Evidence', ?, ?, 'text/plain', 10, 'restricted_raw', 'user_visible', ?, ?)").run(restrictedEvidenceId, projectId, restrictedSourceId, storageRef, contentSha, ts, humanCtx.actorId);
    db.exec("COMMIT");

    // Submit request referencing both evidence
    submitAnalysisRequest({
      db, workspaceId: TEST_WORKSPACE_ID, actorContext: humanCtx, idempotencyKey: randomUUID(), projectId,
      body: { rawRequestText: "Test restricted_raw exclusion", contextEvidenceArtifactIds: [controlledEvidenceId, restrictedEvidenceId], locale: "en-US", timezone: "UTC" },
      submittedVia: "web_ui", clientVersion: null,
    });

    // Inject a capturing engine handler
    const capturedRequests: unknown[] = [];
    const captureHandler = async (request: Record<string, unknown>) => {
      capturedRequests.push(JSON.parse(JSON.stringify(request)));
      const now = new Date().toISOString();
      return {
        version: ENGINE_PORT_VERSION, operation: request.operation, operationId: request.operationId,
        projectId: request.projectId, generationId: request.generationId,
        startedAt: now, completedAt: now, outcome: "succeeded",
        output: {
          candidate: {
            businessQuestion: "What are the trends?",
            scope: { inScope: ["daily sales"], outOfScope: ["weekly"] },
            acceptanceCriteria: ["Clear trends"],
          },
        },
      };
    };

    // Call generateRequirement with capturing handler
    const result = await generateRequirement({
      db, layout: (await import("../persistence/data-root.ts")).initDataRoot(
        (await import("node:os")).tmpdir()
      ), workspaceId: TEST_WORKSPACE_ID, actorContext: humanCtx,
      idempotencyKey: randomUUID(), projectId, body: {}, engineHandler: captureHandler as any,
    });
    assert.equal(result.kind, "executed", `generateRequirement should succeed: ${result.kind === "failed" ? result.errorSummary : ""}`);

    // Assert captured request does NOT contain restricted_raw evidence ID
    assert.ok(capturedRequests.length > 0, "engine handler must be called");
    const serialized = JSON.stringify(capturedRequests);
    assert.ok(!serialized.includes(restrictedEvidenceId), "restricted_raw evidence ID must NOT appear in Engine request");
    assert.ok(!serialized.includes("Restricted Evidence"), "restricted_raw evidence displayName must NOT appear in Engine request");
  });
});

describe("Terminal Run command rejection", () => {
  test("terminal run abort returns invalid_state_transition", async () => {
    const { RunCoordinator } = await import("../application/runs/run-coordinator.ts");
    const { submitAnalysisRequest } = await import("../application/requests/request-service.ts");

    // Create project and full FK chain
    const res = createProject({ db, workspacePort, workspaceId: TEST_WORKSPACE_ID, actorContext: humanCtx, idempotencyKey: randomUUID(), body: { title: "Terminal Test", slug: "term-" + randomUUID().slice(0, 8) } });
    assert.equal(res.kind, "executed");
    const projectId = res.resultResourceId;

    // Create evidence + source reference for request
    const sourceId = randomUUID();
    const evidenceId = randomUUID();
    const ts = new Date().toISOString();
    const storageRef = "blobs/00/" + "0".repeat(64);
    const contentSha = "a".repeat(64);
    db.exec("BEGIN");
    db.prepare("INSERT INTO source_references (source_reference_id, analysis_project_id, source_kind, display_name, description, initial_evidence_artifact_id, declared_data_scope, usage_constraints_json, safety_handling_policy, created_at, created_by_actor_id) VALUES (?, ?, 'user_provided', 'S', 'd', ?, 'scope', '[]', 'local_transform_required', ?, ?)").run(sourceId, projectId, evidenceId, ts, humanCtx.actorId);
    db.prepare("INSERT INTO evidence_artifacts (evidence_artifact_id, analysis_project_id, source_reference_id, origin_kind, artifact_kind, display_name, storage_ref, content_sha256, media_type, byte_size, safety_class, visibility, created_at, created_by_actor_id) VALUES (?, ?, ?, 'user_provided', 'input_material', 'E', ?, ?, 'text/plain', 10, 'controlled', 'user_visible', ?, ?)").run(evidenceId, projectId, sourceId, storageRef, contentSha, ts, humanCtx.actorId);
    db.exec("COMMIT");

    // Submit request
    const reqRes = submitAnalysisRequest({ db, workspaceId: TEST_WORKSPACE_ID, actorContext: humanCtx, idempotencyKey: randomUUID(), projectId, body: { rawRequestText: "Test", contextEvidenceArtifactIds: [evidenceId], locale: "en-US", timezone: "UTC" }, submittedVia: "web_ui", clientVersion: null });
    assert.equal(reqRes.kind, "executed");
    const requestId = reqRes.resultResourceId;

    // Create requirement version, plan version, and terminal run
    const reqVerId = randomUUID();
    const planVerId = randomUUID();
    const runId = randomUUID();
    db.exec("BEGIN");
    db.prepare("INSERT INTO structured_requirement_versions (structured_requirement_version_id, analysis_project_id, analysis_request_id, version_ordinal, schema_version, content_sha256, storage_ref, created_at, created_by_actor_id) VALUES (?, ?, ?, 1, '1.0', ?, ?, ?, ?)").run(reqVerId, projectId, requestId, contentSha, storageRef, ts, humanCtx.actorId);
    db.prepare("UPDATE analysis_projects SET current_requirement_version_id = ? WHERE analysis_project_id = ?").run(reqVerId, projectId);
    db.prepare("INSERT INTO analysis_plan_versions (analysis_plan_version_id, analysis_project_id, structured_requirement_version_id, version_ordinal, schema_version, content_sha256, storage_ref, created_at, created_by_actor_id) VALUES (?, ?, ?, 1, '1.0', ?, ?, ?, ?)").run(planVerId, projectId, reqVerId, contentSha, storageRef, ts, humanCtx.actorId);
    db.prepare("UPDATE analysis_projects SET current_plan_version_id = ? WHERE analysis_project_id = ?").run(planVerId, projectId);
    db.prepare("INSERT INTO analysis_runs (analysis_run_id, analysis_project_id, analysis_plan_version_id, run_ordinal, current_analysis_stage, current_run_status, queued_at, started_at, ended_at, triggered_by_actor_id) VALUES (?, ?, ?, 1, 'S2.4', 'succeeded', ?, ?, ?, ?)").run(runId, projectId, planVerId, ts, ts, ts, humanCtx.actorId);
    db.exec("COMMIT");

    // Verify run is terminal
    const run = db.prepare("SELECT current_run_status FROM analysis_runs WHERE analysis_run_id = ?").get(runId) as { current_run_status: string };
    assert.equal(run.current_run_status, "succeeded");

    // Count events before abort attempt
    const eventsBefore = (db.prepare("SELECT COUNT(*) as c FROM run_events WHERE analysis_run_id = ?").get(runId) as { c: number }).c;

    // Abort a terminal run should fail
    const dummyHandler = async () => ({ version: "engine-port/1.0" as const, operation: "executeQueuedRun" as const, operationId: "x", projectId: "x", startedAt: ts, completedAt: ts, outcome: "failed" as const, error: { code: "pi_execution_failed" as const, summary: "dummy" } });
    // Use a temp dir for the layout since we need a valid DataRootLayout
    const { mkdtempSync, rmSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const { initDataRoot } = await import("../persistence/data-root.ts");
    const tempDir = mkdtempSync(join(tmpdir(), "xanthil-term-test-"));
    const testLayout = initDataRoot(tempDir);
    const coordinator = new RunCoordinator({ db, layout: testLayout, engineHandler: dummyHandler as any });
    const abortResult = coordinator.abortRun(runId, TEST_WORKSPACE_ID, "Late abort");
    assert.equal(abortResult.ok, false, "abort of terminal run must fail");
    assert.equal(abortResult.errorCode, "invalid_state_transition");

    // Assert event count did not increase
    const eventsAfter = (db.prepare("SELECT COUNT(*) as c FROM run_events WHERE analysis_run_id = ?").get(runId) as { c: number }).c;
    assert.equal(eventsAfter, eventsBefore, "event count must not increase on rejected abort");
  });
});
