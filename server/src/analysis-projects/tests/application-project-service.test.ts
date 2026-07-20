/**
 * Project lifecycle service tests (§6.1, API-042, P0-17/20/21/85).
 */
import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createMigratedDb, TEST_WORKSPACE_ID } from "./application-helpers.ts";
import { createProject, updateProjectMetadata, deleteDraftProject } from "../application/projects/project-service.ts";
import { cancelProject, archiveProject, unarchiveProject, reopenProject } from "../application/projects/project-lifecycle-service.ts";
import { getProjectById } from "../application/projects/project-queries.ts";
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
  if (res.kind !== "executed") throw new Error(`create failed: ${JSON.stringify(res)}`);
  return res.resultResourceId;
}

describe("project.create", () => {
  test("creates active daily_analysis project", () => {
    const id = makeProject("p1");
    const p = getProjectById(db, workspaceId, id)!;
    assert.equal(p.projectKind, "daily_analysis");
    assert.equal(p.projectStatus, "active");
    assert.equal(p.title, "T");
    assert.equal(p.slug, "p1");
    assert.equal(p.createdByActorId, humanId);
  });

  test("rejects empty title", () => {
    assert.throws(() => createProject({ db, workspacePort, workspaceId, actorContext: humanCtx, idempotencyKey: randomUUID(), body: { title: "", slug: "x" } }), /title/);
  });

  test("rejects invalid slug", () => {
    assert.throws(() => createProject({ db, workspacePort, workspaceId, actorContext: humanCtx, idempotencyKey: randomUUID(), body: { title: "T", slug: "Invalid Slug" } }), /slug/);
  });

  test("rejects duplicate slug (case-insensitive)", () => {
    makeProject("my-project");
    assert.throws(() => makeProject("MY-PROJECT"), /slug/);
  });
});

describe("project.update_metadata", () => {
  test("updates title and slug with correct expectedUpdatedAt", () => {
    const id = makeProject("p1");
    const p = getProjectById(db, workspaceId, id)!;
    const res = updateProjectMetadata({ db, workspacePort, workspaceId, actorContext: humanCtx, idempotencyKey: randomUUID(), body: { title: "New Title", slug: "new-slug", expectedUpdatedAt: p.updatedAt }, projectId: id });
    assert.equal(res.kind, "executed");
    assert.equal(getProjectById(db, workspaceId, id)!.title, "New Title");
  });

  test("stale expectedUpdatedAt fails concurrent_modification", () => {
    const id = makeProject("p1");
    const res = updateProjectMetadata({ db, workspacePort, workspaceId, actorContext: humanCtx, idempotencyKey: randomUUID(), body: { title: "X", slug: "x", expectedUpdatedAt: "stale" }, projectId: id });
    assert.equal(res.kind, "failed");
    if (res.kind === "failed") assert.equal(res.errorCode, "concurrent_modification");
  });
});

describe("project.delete_draft", () => {
  test("deletes pure draft project", () => {
    const id = makeProject("draft-1");
    const res = deleteDraftProject({ db, workspacePort, workspaceId, actorContext: humanCtx, idempotencyKey: randomUUID(), body: { confirmPermanentDeletion: true }, projectId: id });
    assert.equal(res.kind, "executed");
    assert.equal(getProjectById(db, workspaceId, id), null);
  });

  test("rejects if audit chain entered", () => {
    const id = makeProject("p1");
    db.prepare(`INSERT INTO analysis_requests (analysis_request_id, analysis_project_id, raw_request_text, submitted_context_evidence_ids_json, submitted_at, submitted_by_actor_id, submitted_via, locale, timezone) VALUES (?, ?, 'req', '[]', ?, ?, 'web_ui', 'en-US', 'UTC')`).run(randomUUID(), id, new Date().toISOString(), humanId);
    const res = deleteDraftProject({ db, workspacePort, workspaceId, actorContext: humanCtx, idempotencyKey: randomUUID(), body: { confirmPermanentDeletion: true }, projectId: id });
    assert.equal(res.kind, "failed");
    if (res.kind === "failed") assert.equal(res.errorCode, "invalid_state_transition");
  });
});

describe("project.cancel", () => {
  test("cancels active project", () => {
    const id = makeProject("p1");
    const p = getProjectById(db, workspaceId, id)!;
    const res = cancelProject({ db, workspacePort, workspaceId, actorContext: humanCtx, idempotencyKey: randomUUID(), body: { expectedUpdatedAt: p.updatedAt }, projectId: id });
    assert.equal(res.kind, "executed");
    assert.equal(getProjectById(db, workspaceId, id)!.projectStatus, "cancelled");
  });

  test("rejects cancel of non-active project", () => {
    const id = makeProject("p1");
    const p = getProjectById(db, workspaceId, id)!;
    cancelProject({ db, workspacePort, workspaceId, actorContext: humanCtx, idempotencyKey: randomUUID(), body: { expectedUpdatedAt: p.updatedAt }, projectId: id });
    const res = cancelProject({ db, workspacePort, workspaceId, actorContext: humanCtx, idempotencyKey: randomUUID(), body: { expectedUpdatedAt: p.updatedAt }, projectId: id });
    assert.equal(res.kind, "failed");
    if (res.kind === "failed") assert.equal(res.errorCode, "invalid_state_transition");
  });
});

describe("project.archive / unarchive", () => {
  test("archives active project", () => {
    const id = makeProject("p1");
    const p = getProjectById(db, workspaceId, id)!;
    const res = archiveProject({ db, workspacePort, workspaceId, actorContext: humanCtx, idempotencyKey: randomUUID(), body: { expectedUpdatedAt: p.updatedAt }, projectId: id });
    assert.equal(res.kind, "executed");
    assert.ok(getProjectById(db, workspaceId, id)!.archivedAt);
  });

  test("unarchives archived project", () => {
    const id = makeProject("p1");
    let p = getProjectById(db, workspaceId, id)!;
    archiveProject({ db, workspacePort, workspaceId, actorContext: humanCtx, idempotencyKey: randomUUID(), body: { expectedUpdatedAt: p.updatedAt }, projectId: id });
    p = getProjectById(db, workspaceId, id)!;
    const res = unarchiveProject({ db, workspacePort, workspaceId, actorContext: humanCtx, idempotencyKey: randomUUID(), body: { expectedUpdatedAt: p.updatedAt }, projectId: id });
    assert.equal(res.kind, "executed");
    assert.equal(getProjectById(db, workspaceId, id)!.archivedAt, null);
  });
});

describe("project.reopen", () => {
  test("reopens rejected project into a new empty project with reopened_from", () => {
    const id = makeProject("p1");
    db.prepare(`UPDATE analysis_projects SET project_status = 'rejected', rejected_at = ? WHERE analysis_project_id = ?`).run(new Date().toISOString(), id);
    const p = getProjectById(db, workspaceId, id)!;
    const res = reopenProject({ db, workspacePort, workspaceId, actorContext: humanCtx, idempotencyKey: randomUUID(), body: { title: "Reopened", slug: "p1-reopened", expectedUpdatedAt: p.updatedAt }, projectId: id });
    assert.equal(res.kind, "executed");
    const newId = res.kind === "executed" ? res.resultResourceId : null;
    assert.ok(newId);
    const newP = getProjectById(db, workspaceId, newId!);
    assert.ok(newP);
    assert.equal(newP!.sourceProjectId, id);
    assert.equal(newP!.sourceRelationType, "reopened_from");
  });

  test("non-rejected project cannot be reopened", () => {
    const id = makeProject("p1");
    const p = getProjectById(db, workspaceId, id)!;
    const res = reopenProject({ db, workspacePort, workspaceId, actorContext: humanCtx, idempotencyKey: randomUUID(), body: { title: "Reopened", slug: "p1-reopened", expectedUpdatedAt: p.updatedAt }, projectId: id });
    assert.equal(res.kind, "failed");
    if (res.kind === "failed") assert.equal(res.errorCode, "invalid_state_transition");
  });
});
