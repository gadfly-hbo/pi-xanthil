/**
 * Actor service tests (§3, API-048, API-061, P0-68/70).
 * - bootstrap system actor: only first can have no registeredBy.
 * - local human setup: one-time only.
 * - disabled/non-human actor cannot run human profile/project commands.
 * - profile update requires expectedDisplayName (optimistic concurrency).
 * - historical Gate snapshot not changed by current displayName update.
 */
import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createMigratedDb } from "./persistence-helpers.ts";
import {
  bootstrapSystemActor, setupLocalHuman, updateProfile,
  getSystemActor, getHumanActor, getActorById,
} from "../application/actors/actor-service.ts";
import type { TrustedActorContext } from "../application/shared/runtime.ts";
import type { DatabaseSync } from "node:sqlite";

let db: DatabaseSync;
let cleanup: () => void;

beforeEach(async () => {
  const env = await createMigratedDb();
  db = env.db;
  cleanup = env.cleanup;
});

afterEach(() => cleanup());

describe("bootstrapSystemActor", () => {
  test("creates first system actor with no registeredBy", () => {
    const sys = bootstrapSystemActor(db);
    assert.equal(sys.actorKind, "system");
    assert.equal(sys.registeredByActorId, null, "first system actor must have no registeredBy");
  });

  test("idempotent: returns same actor on second call", () => {
    const sys1 = bootstrapSystemActor(db);
    const sys2 = bootstrapSystemActor(db);
    assert.equal(sys1.auditActorId, sys2.auditActorId);
    assert.equal(getSystemActor(db)!.auditActorId, sys1.auditActorId);
  });
});

describe("setupLocalHuman", () => {
  test("creates unique human registered by system actor", () => {
    const sys = bootstrapSystemActor(db);
    const sysCtx: TrustedActorContext = { actorId: sys.auditActorId, actorKind: "system", submittedVia: "local_api", clientVersion: null, active: true };
    const res = setupLocalHuman({ db, actorContext: sysCtx, idempotencyKey: randomUUID(), body: { displayName: "Alice", actorKey: "alice" } });
    assert.equal(res.kind, "executed");
    const human = getHumanActor(db)!;
    assert.equal(human.displayName, "Alice");
    assert.equal(human.registeredByActorId, sys.auditActorId);
  });

  test("one-time: second setup fails with invalid_state_transition", () => {
    const sys = bootstrapSystemActor(db);
    const sysCtx: TrustedActorContext = { actorId: sys.auditActorId, actorKind: "system", submittedVia: "local_api", clientVersion: null, active: true };
    setupLocalHuman({ db, actorContext: sysCtx, idempotencyKey: randomUUID(), body: { displayName: "Alice", actorKey: "alice" } });
    const res = setupLocalHuman({ db, actorContext: sysCtx, idempotencyKey: randomUUID(), body: { displayName: "Bob", actorKey: "bob" } });
    assert.equal(res.kind, "failed");
    if (res.kind === "failed") assert.equal(res.errorCode, "invalid_state_transition");
  });

  test("non-human/non-system actor cannot run setup", () => {
    const sys = bootstrapSystemActor(db);
    const sysCtx: TrustedActorContext = { actorId: sys.auditActorId, actorKind: "system", submittedVia: "local_api", clientVersion: null, active: true };
    setupLocalHuman({ db, actorContext: sysCtx, idempotencyKey: randomUUID(), body: { displayName: "Alice", actorKey: "alice" } });
    const human = getHumanActor(db)!;
    const humanCtx: TrustedActorContext = { actorId: human.auditActorId, actorKind: "human", submittedVia: "web_ui", clientVersion: null, active: true };
    assert.throws(() => setupLocalHuman({ db, actorContext: humanCtx, idempotencyKey: randomUUID(), body: { displayName: "X", actorKey: "x" } }), /actor_kind_forbidden|system actor/);
  });

  test("disabled actor cannot run setup", () => {
    const sys = bootstrapSystemActor(db);
    const disabledCtx: TrustedActorContext = { actorId: sys.auditActorId, actorKind: "system", submittedVia: "local_api", clientVersion: null, active: false };
    assert.throws(() => setupLocalHuman({ db, actorContext: disabledCtx, idempotencyKey: randomUUID(), body: { displayName: "X", actorKey: "x" } }), /system actor/);
  });

  test("empty displayName rejected", () => {
    const sys = bootstrapSystemActor(db);
    const sysCtx: TrustedActorContext = { actorId: sys.auditActorId, actorKind: "system", submittedVia: "local_api", clientVersion: null, active: true };
    assert.throws(() => setupLocalHuman({ db, actorContext: sysCtx, idempotencyKey: randomUUID(), body: { displayName: "   ", actorKey: "alice" } }), /displayName/);
  });
});

describe("updateProfile", () => {
  function setupHuman(): { humanCtx: TrustedActorContext; humanId: string } {
    const sys = bootstrapSystemActor(db);
    const sysCtx: TrustedActorContext = { actorId: sys.auditActorId, actorKind: "system", submittedVia: "local_api", clientVersion: null, active: true };
    setupLocalHuman({ db, actorContext: sysCtx, idempotencyKey: randomUUID(), body: { displayName: "Alice", actorKey: "alice" } });
    const human = getHumanActor(db)!;
    return {
      humanCtx: { actorId: human.auditActorId, actorKind: "human", submittedVia: "web_ui", clientVersion: null, active: true },
      humanId: human.auditActorId,
    };
  }

  test("updates displayName with correct expectedDisplayName", () => {
    const { humanCtx } = setupHuman();
    const res = updateProfile({ db, actorContext: humanCtx, idempotencyKey: randomUUID(), body: { displayName: "Alice Smith", expectedDisplayName: "Alice" } });
    assert.equal(res.kind, "executed");
    assert.equal(getActorById(db, humanCtx.actorId)!.displayName, "Alice Smith");
  });

  test("stale expectedDisplayName fails concurrent_modification", () => {
    const { humanCtx } = setupHuman();
    const res = updateProfile({ db, actorContext: humanCtx, idempotencyKey: randomUUID(), body: { displayName: "X", expectedDisplayName: "WrongName" } });
    assert.equal(res.kind, "failed");
    if (res.kind === "failed") assert.equal(res.errorCode, "concurrent_modification");
  });

  test("non-human actor cannot update profile", () => {
    const sys = bootstrapSystemActor(db);
    const sysCtx: TrustedActorContext = { actorId: sys.auditActorId, actorKind: "system", submittedVia: "local_api", clientVersion: null, active: true };
    assert.throws(() => updateProfile({ db, actorContext: sysCtx, idempotencyKey: randomUUID(), body: { displayName: "X", expectedDisplayName: "System" } }), /human actor/);
  });

  test("historical Gate snapshot not changed by displayName update", () => {
    const { humanCtx, humanId } = setupHuman();
    const projectId = randomUUID();
    const ts = new Date().toISOString();
    db.prepare(`INSERT INTO analysis_projects (analysis_project_id, workspace_id, project_kind, title, slug, project_status, created_at, created_by_actor_id, updated_at) VALUES (?, 'ws-test', 'daily_analysis', 'P', 'p1', 'active', ?, ?, ?)`).run(projectId, ts, humanId, ts);
    const gateId = randomUUID();
    db.prepare(`INSERT INTO gate_decisions (gate_decision_id, analysis_project_id, gate_type, target_object_type, target_object_id, target_schema_version, target_content_sha256, decision, decided_at, decided_by_actor_id, actor_display_name_snapshot, requested_changes_json, submitted_via) VALUES (?, ?, 'requirement_confirmation', 'structured_requirement_version', ?, '1.0', ?, 'approved', ?, ?, 'Alice', '[]', 'web_ui')`).run(gateId, projectId, randomUUID(), "a".repeat(64), ts, humanId);
    updateProfile({ db, actorContext: humanCtx, idempotencyKey: randomUUID(), body: { displayName: "Alice Renamed", expectedDisplayName: "Alice" } });
    const snap = (db.prepare(`SELECT actor_display_name_snapshot FROM gate_decisions WHERE gate_decision_id = ?`).get(gateId) as { actor_display_name_snapshot: string }).actor_display_name_snapshot;
    assert.equal(snap, "Alice", "historical Gate actor snapshot must not change");
    assert.equal(getActorById(db, humanId)!.displayName, "Alice Renamed");
  });
});
