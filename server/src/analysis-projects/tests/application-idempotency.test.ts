/**
 * Idempotency service tests (§4, §15, API-009/API-049/API-055).
 * - same actor/command/key + same hash: no duplicate business write.
 * - different hash: conflict (409 idempotency_key_reused).
 * - second concurrent claim cannot gain execution.
 * - in_progress recovers to interrupted on startup.
 * - terminal receipt cannot be updated again.
 * - business tx failure: facts + succeeded receipt both not committed.
 */
import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createMigratedDb } from "./application-helpers.ts";
import {
  claimOn, recordSuccessInTx, recordFailure, recoverOrphans, getRecord,
} from "../application/idempotency/idempotency-service.ts";
import { bootstrapSystemActor } from "../application/actors/actor-service.ts";
import type { DatabaseSync } from "node:sqlite";

const HASH = "0".repeat(64);

let db: DatabaseSync;
let cleanup: () => void;
let actorId: string;

beforeEach(async () => {
  const env = await createMigratedDb();
  db = env.db;
  cleanup = env.cleanup;
  actorId = bootstrapSystemActor(db).auditActorId;
});

afterEach(() => cleanup());

describe("claimOn", () => {
  test("first claim returns execute", () => {
    const claim = claimOn(db, { actorId, commandType: "project.create", idempotencyKey: randomUUID(), requestHash: HASH });
    assert.equal(claim.kind, "execute");
    assert.ok(claim.recordId);
  });

  test("same key + same hash replay returns in_progress (before terminal)", () => {
    const key = randomUUID();
    claimOn(db, { actorId, commandType: "project.create", idempotencyKey: key, requestHash: HASH });
    const claim2 = claimOn(db, { actorId, commandType: "project.create", idempotencyKey: key, requestHash: HASH });
    assert.equal(claim2.kind, "in_progress");
  });

  test("same key + different hash returns conflict", () => {
    const key = randomUUID();
    claimOn(db, { actorId, commandType: "project.create", idempotencyKey: key, requestHash: HASH });
    const claim2 = claimOn(db, { actorId, commandType: "project.create", idempotencyKey: key, requestHash: "1".repeat(64) });
    assert.equal(claim2.kind, "conflict");
  });

  test("second concurrent claim cannot gain execution (UNIQUE)", () => {
    const key = randomUUID();
    const c1 = claimOn(db, { actorId, commandType: "project.create", idempotencyKey: key, requestHash: HASH });
    assert.equal(c1.kind, "execute");
    const c2 = claimOn(db, { actorId, commandType: "project.create", idempotencyKey: key, requestHash: HASH });
    assert.notEqual(c2.kind, "execute");
    assert.equal(c2.kind, "in_progress");
  });

  test("rejects invalid actorId / key / hash", () => {
    assert.throws(() => claimOn(db, { actorId: "not-uuid", commandType: "project.create", idempotencyKey: randomUUID(), requestHash: HASH }), /UUID v4/);
    assert.throws(() => claimOn(db, { actorId, commandType: "project.create", idempotencyKey: "not-uuid", requestHash: HASH }), /UUID v4/);
    assert.throws(() => claimOn(db, { actorId, commandType: "project.create", idempotencyKey: randomUUID(), requestHash: "short" }), /64-char lowercase hex/);
  });

  test("FK failure (non-existent actor) re-throws instead of recursing", () => {
    // Valid UUID v4 format but no such actor -> FK constraint failure on INSERT.
    // Must re-throw the original error, NOT recurse or be treated as a conflict.
    const phantomActor = randomUUID();
    assert.throws(
      () => claimOn(db, { actorId: phantomActor, commandType: "project.create", idempotencyKey: randomUUID(), requestHash: HASH }),
      /FOREIGN KEY constraint failed/i,
    );
  });
});

describe("terminal transitions", () => {
  test("recordSuccessInTx terminalizes in_progress to succeeded", () => {
    const claim = claimOn(db, { actorId, commandType: "project.create", idempotencyKey: randomUUID(), requestHash: HASH });
    db.exec("BEGIN");
    recordSuccessInTx(db, claim.recordId, { httpStatus: 201, resultResourceType: "Project", resultResourceId: randomUUID() });
    db.exec("COMMIT");
    const rec = getRecord(db, claim.recordId)!;
    assert.equal(rec.executionStatus, "succeeded");
    assert.equal(rec.responseHttpStatus, 201);
    assert.equal(rec.resultResourceType, "Project");
    assert.equal(rec.errorCode, null);
  });

  test("terminal receipt cannot be updated again", () => {
    const claim = claimOn(db, { actorId, commandType: "project.create", idempotencyKey: randomUUID(), requestHash: HASH });
    db.exec("BEGIN");
    recordSuccessInTx(db, claim.recordId, { httpStatus: 201, resultResourceType: "Project", resultResourceId: randomUUID() });
    db.exec("COMMIT");
    // second terminalization must throw
    assert.throws(() => recordSuccessInTx(db, claim.recordId, { httpStatus: 201, resultResourceType: "Project", resultResourceId: randomUUID() }), /already terminal|immutable/);
  });

  test("recordFailure terminalizes to failed", () => {
    const claim = claimOn(db, { actorId, commandType: "project.create", idempotencyKey: randomUUID(), requestHash: HASH });
    recordFailure(db, claim.recordId, { httpStatus: 409, errorCode: "active_run_exists", errorSummary: "blocked" });
    const rec = getRecord(db, claim.recordId)!;
    assert.equal(rec.executionStatus, "failed");
    assert.equal(rec.errorCode, "active_run_exists");
    assert.equal(rec.resultResourceType, null);
  });

  test("succeeded replay returns replay_success", () => {
    const key = randomUUID();
    const claim = claimOn(db, { actorId, commandType: "project.create", idempotencyKey: key, requestHash: HASH });
    db.exec("BEGIN");
    recordSuccessInTx(db, claim.recordId, { httpStatus: 201, resultResourceType: "Project", resultResourceId: randomUUID() });
    db.exec("COMMIT");
    const replay = claimOn(db, { actorId, commandType: "project.create", idempotencyKey: key, requestHash: HASH });
    assert.equal(replay.kind, "replay_success");
  });

  test("failed replay returns replay_failed", () => {
    const key = randomUUID();
    const claim = claimOn(db, { actorId, commandType: "project.create", idempotencyKey: key, requestHash: HASH });
    recordFailure(db, claim.recordId, { httpStatus: 409, errorCode: "active_run_exists", errorSummary: "blocked" });
    const replay = claimOn(db, { actorId, commandType: "project.create", idempotencyKey: key, requestHash: HASH });
    assert.equal(replay.kind, "replay_failed");
  });
});

describe("orphan recovery", () => {
  test("in_progress recovered to interrupted on startup", () => {
    const claim = claimOn(db, { actorId, commandType: "project.create", idempotencyKey: randomUUID(), requestHash: HASH });
    // leave it in_progress (simulating crash)
    const swept = recoverOrphans(db);
    assert.equal(swept, 1);
    const rec = getRecord(db, claim.recordId)!;
    assert.equal(rec.executionStatus, "interrupted");
    assert.equal(rec.errorCode, "command_interrupted");
    assert.equal(rec.responseHttpStatus, 503);
  });

  test("recoverOrphans idempotent (no orphans -> 0)", () => {
    recoverOrphans(db);
    assert.equal(recoverOrphans(db), 0);
  });

  test("interrupted record requires new key (replay returns replay_failed)", () => {
    const key = randomUUID();
    const claim = claimOn(db, { actorId, commandType: "project.create", idempotencyKey: key, requestHash: HASH });
    recoverOrphans(db);
    const replay = claimOn(db, { actorId, commandType: "project.create", idempotencyKey: key, requestHash: HASH });
    assert.equal(replay.kind, "replay_failed");
    void claim;
  });
});

describe("business transaction atomicity", () => {
  test("business tx failure: facts and succeeded receipt both not committed", () => {
    const claim = claimOn(db, { actorId, commandType: "project.create", idempotencyKey: randomUUID(), requestHash: HASH });
    db.exec("BEGIN");
    try {
      // write a business fact
      db.prepare(`INSERT INTO analysis_projects (analysis_project_id, workspace_id, project_kind, title, slug, project_status, created_at, created_by_actor_id, updated_at) VALUES (?, 'ws-test', 'daily_analysis', 'T', 's1', 'active', ?, ?, ?)`).run(randomUUID(), new Date().toISOString(), actorId, new Date().toISOString());
      recordSuccessInTx(db, claim.recordId, { httpStatus: 201, resultResourceType: "Project", resultResourceId: randomUUID() });
      // force a failure before commit
      throw new Error("simulated business failure");
    } catch {
      db.exec("ROLLBACK");
    }
    // record should still be in_progress (not committed), project should not exist
    const rec = getRecord(db, claim.recordId)!;
    assert.equal(rec.executionStatus, "in_progress");
    const projects = (db.prepare(`SELECT COUNT(*) AS c FROM analysis_projects`).get() as { c: number }).c;
    assert.equal(projects, 0);
  });

  test("business tx success: facts and receipt both committed in same tx", () => {
    const claim = claimOn(db, { actorId, commandType: "project.create", idempotencyKey: randomUUID(), requestHash: HASH });
    const pid = randomUUID();
    const ts = new Date().toISOString();
    db.exec("BEGIN");
    db.prepare(`INSERT INTO analysis_projects (analysis_project_id, workspace_id, project_kind, title, slug, project_status, created_at, created_by_actor_id, updated_at) VALUES (?, 'ws-test', 'daily_analysis', 'T', 's2', 'active', ?, ?, ?)`).run(pid, ts, actorId, ts);
    recordSuccessInTx(db, claim.recordId, { httpStatus: 201, resultResourceType: "Project", resultResourceId: pid });
    db.exec("COMMIT");
    // both visible
    const rec = getRecord(db, claim.recordId)!;
    assert.equal(rec.executionStatus, "succeeded");
    assert.equal(rec.resultResourceId, pid);
    const projects = (db.prepare(`SELECT COUNT(*) AS c FROM analysis_projects WHERE analysis_project_id = ?`).get(pid) as { c: number }).c;
    assert.equal(projects, 1);
  });
});
