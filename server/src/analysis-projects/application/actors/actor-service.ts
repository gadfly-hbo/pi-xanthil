/**
 * Bootstrap and profile application service (§3, API-048, API-061, P0-68/70).
 * - bootstrapSystemActor: startup, creates unique system actor (no registeredBy).
 * - setup.bootstrap_local_human: one-time, by system actor, creates unique human.
 * - actor.update_profile: active human updates own displayName (NFC/trim/non-empty)
 *   with optimistic concurrency; historical Gate snapshots unchanged.
 * Phase 1: no cookie, bearer token, or credentials file.
 */
import type { DatabaseSync } from "node:sqlite";
import { claimOn, recordFailure, recordSuccessInTx, type IdempotencyRecord } from "../idempotency/idempotency-service.ts";
import { computeRequestHash, isUuidV4, now, uuid, type TrustedActorContext } from "../shared/runtime.ts";
import { ApplicationError } from "../../contracts/envelope.ts";
import type { CommandResult } from "../shared/command.ts";
import type { ActorKind } from "../../contracts/registries.ts";

export interface AuditActorRow {
  readonly auditActorId: string;
  readonly actorKind: ActorKind;
  readonly actorKey: string;
  readonly displayName: string;
  readonly createdAt: string;
  readonly registeredByActorId: string | null;
  readonly disabledAt: string | null;
}
interface ActorRowShape {
  audit_actor_id: string; actor_kind: string; actor_key: string; display_name: string;
  created_at: string; registered_by_actor_id: string | null; disabled_at: string | null;
}
const ACTOR_SELECT = "audit_actor_id, actor_kind, actor_key, display_name, created_at, registered_by_actor_id, disabled_at";
function rowToActor(row: ActorRowShape): AuditActorRow {
  return {
    auditActorId: row.audit_actor_id, actorKind: row.actor_kind as ActorKind, actorKey: row.actor_key,
    displayName: row.display_name, createdAt: row.created_at,
    registeredByActorId: row.registered_by_actor_id, disabledAt: row.disabled_at,
  };
}

export function getActorById(db: DatabaseSync, actorId: string): AuditActorRow | null {
  const row = db.prepare(`SELECT ${ACTOR_SELECT} FROM audit_actors WHERE audit_actor_id = ?`).get(actorId) as ActorRowShape | undefined;
  return row ? rowToActor(row) : null;
}
export function getSystemActor(db: DatabaseSync): AuditActorRow | null {
  const row = db.prepare(`SELECT ${ACTOR_SELECT} FROM audit_actors WHERE actor_kind = 'system' ORDER BY created_at ASC LIMIT 1`).get() as ActorRowShape | undefined;
  return row ? rowToActor(row) : null;
}
export function getHumanActor(db: DatabaseSync): AuditActorRow | null {
  const row = db.prepare(`SELECT ${ACTOR_SELECT} FROM audit_actors WHERE actor_kind = 'human' ORDER BY created_at ASC LIMIT 1`).get() as ActorRowShape | undefined;
  return row ? rowToActor(row) : null;
}

/** Create the unique bootstrap system actor if none exists. Idempotent. */
export function bootstrapSystemActor(db: DatabaseSync): AuditActorRow {
  const existing = getSystemActor(db);
  if (existing) return existing;
  const actorId = uuid();
  db.prepare(`INSERT INTO audit_actors (audit_actor_id, actor_kind, actor_key, display_name, created_at, registered_by_actor_id) VALUES (?, 'system', ?, ?, ?, NULL)`).run(actorId, "bootstrap-system", "System", now());
  return getActorById(db, actorId)!;
}

export interface SetupLocalHumanBody { readonly displayName: string; readonly actorKey: string }
export interface SetupLocalHumanInput { readonly db: DatabaseSync; readonly actorContext: TrustedActorContext; readonly idempotencyKey: string; readonly body: SetupLocalHumanBody }

/** One-time local human setup, executed by the bootstrap system actor. */
export function setupLocalHuman(input: SetupLocalHumanInput): CommandResult<AuditActorRow> {
  const { db, actorContext, idempotencyKey, body } = input;
  assertActiveSystem(actorContext);
  const displayName = normalizeDisplayName(body.displayName);
  const actorKey = normalizeActorKey(body.actorKey);
  const requestHash = computeRequestHash("POST", "/api/v1/setup/local-human", body);
  const claim = claimOn(db, { actorId: actorContext.actorId, commandType: "setup.bootstrap_local_human", idempotencyKey, requestHash });
  if (claim.kind === "in_progress") return { kind: "in_progress", recordId: claim.recordId };
  if (claim.kind === "conflict") return { kind: "conflict", recordId: claim.recordId };
  if (claim.kind === "replay_success") return { kind: "replayed_success", httpStatus: claim.record.responseHttpStatus!, resultResourceType: claim.record.resultResourceType!, resultResourceId: claim.record.resultResourceId!, recordId: claim.record.idempotencyRecordId };
  if (claim.kind === "replay_failed") return { kind: "failed", httpStatus: claim.record.responseHttpStatus!, errorCode: claim.record.errorCode!, errorSummary: claim.record.errorSummary!, fieldErrors: [], recordId: claim.record.idempotencyRecordId };

  if (getHumanActor(db) !== null) {
    const err = new ApplicationError("invalid_state_transition", "Local human setup is already complete; setup is permanently closed.");
    recordFailure(db, claim.recordId, { httpStatus: err.httpStatus, errorCode: err.code, errorSummary: err.message });
    return { kind: "failed", httpStatus: err.httpStatus, errorCode: err.code, errorSummary: err.message, fieldErrors: [], recordId: claim.recordId };
  }
  const humanId = uuid();
  db.exec("BEGIN");
  try {
    db.prepare(`INSERT INTO audit_actors (audit_actor_id, actor_kind, actor_key, display_name, created_at, registered_by_actor_id) VALUES (?, 'human', ?, ?, ?, ?)`).run(humanId, actorKey, displayName, now(), actorContext.actorId);
    recordSuccessInTx(db, claim.recordId, { httpStatus: 201, resultResourceType: "AuditActor", resultResourceId: humanId });
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    const appErr = mapToApplicationError(err);
    recordFailure(db, claim.recordId, { httpStatus: appErr.httpStatus, errorCode: appErr.code, errorSummary: appErr.message });
    return { kind: "failed", httpStatus: appErr.httpStatus, errorCode: appErr.code, errorSummary: appErr.message, fieldErrors: appErr.fieldErrors, recordId: claim.recordId };
  }
  return { kind: "executed", httpStatus: 201, resultResourceType: "AuditActor", resultResourceId: humanId, data: getActorById(db, humanId)!, recordId: claim.recordId };
}

export interface UpdateProfileBody { readonly displayName: string; readonly expectedDisplayName: string }
export interface UpdateProfileInput { readonly db: DatabaseSync; readonly actorContext: TrustedActorContext; readonly idempotencyKey: string; readonly body: UpdateProfileBody }

/** Active human updates own displayName with optimistic concurrency. */
export function updateProfile(input: UpdateProfileInput): CommandResult<AuditActorRow> {
  const { db, actorContext, idempotencyKey, body } = input;
  assertActiveHuman(actorContext);
  const newDisplayName = normalizeDisplayName(body.displayName);
  const expectedDisplayName = normalizeDisplayName(body.expectedDisplayName);
  const requestHash = computeRequestHash("PATCH", "/api/v1/session/profile", body);
  const claim = claimOn(db, { actorId: actorContext.actorId, commandType: "actor.update_profile", idempotencyKey, requestHash });
  if (claim.kind === "in_progress") return { kind: "in_progress", recordId: claim.recordId };
  if (claim.kind === "conflict") return { kind: "conflict", recordId: claim.recordId };
  if (claim.kind === "replay_success") return { kind: "replayed_success", httpStatus: claim.record.responseHttpStatus!, resultResourceType: claim.record.resultResourceType!, resultResourceId: claim.record.resultResourceId!, recordId: claim.record.idempotencyRecordId };
  if (claim.kind === "replay_failed") return { kind: "failed", httpStatus: claim.record.responseHttpStatus!, errorCode: claim.record.errorCode!, errorSummary: claim.record.errorSummary!, fieldErrors: [], recordId: claim.record.idempotencyRecordId };

  const actor = getActorById(db, actorContext.actorId);
  if (!actor || actor.actorKind !== "human") {
    const err = new ApplicationError("actor_kind_forbidden", "Only a human actor can update a human profile.");
    recordFailure(db, claim.recordId, { httpStatus: err.httpStatus, errorCode: err.code, errorSummary: err.message });
    return { kind: "failed", httpStatus: err.httpStatus, errorCode: err.code, errorSummary: err.message, fieldErrors: [], recordId: claim.recordId };
  }
  if (actor.displayName !== expectedDisplayName) {
    const err = new ApplicationError("concurrent_modification", "expectedDisplayName does not match the current displayName; refresh and retry.");
    recordFailure(db, claim.recordId, { httpStatus: err.httpStatus, errorCode: err.code, errorSummary: err.message });
    return { kind: "failed", httpStatus: err.httpStatus, errorCode: err.code, errorSummary: err.message, fieldErrors: [], recordId: claim.recordId };
  }
  db.exec("BEGIN");
  try {
    const res = db.prepare(`UPDATE audit_actors SET display_name = ? WHERE audit_actor_id = ? AND display_name = ? AND disabled_at IS NULL`).run(newDisplayName, actorContext.actorId, expectedDisplayName);
    if (res.changes !== 1) throw new ApplicationError("concurrent_modification", "Profile was concurrently modified; refresh and retry.");
    recordSuccessInTx(db, claim.recordId, { httpStatus: 200, resultResourceType: "AuditActor", resultResourceId: actorContext.actorId });
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    const appErr = mapToApplicationError(err);
    recordFailure(db, claim.recordId, { httpStatus: appErr.httpStatus, errorCode: appErr.code, errorSummary: appErr.message });
    return { kind: "failed", httpStatus: appErr.httpStatus, errorCode: appErr.code, errorSummary: appErr.message, fieldErrors: appErr.fieldErrors, recordId: claim.recordId };
  }
  return { kind: "executed", httpStatus: 200, resultResourceType: "AuditActor", resultResourceId: actorContext.actorId, data: getActorById(db, actorContext.actorId)!, recordId: claim.recordId };
}

function normalizeDisplayName(value: unknown): string {
  if (typeof value !== "string") throw new ApplicationError("validation_failed", "displayName must be a string.", { fieldErrors: [{ fieldPath: "/displayName", code: "type", summary: "displayName must be a string" }] });
  const trimmed = value.normalize("NFC").trim();
  if (trimmed.length === 0) throw new ApplicationError("validation_failed", "displayName must be non-empty after trim.", { fieldErrors: [{ fieldPath: "/displayName", code: "empty", summary: "displayName must be non-empty after trim" }] });
  return trimmed;
}
function normalizeActorKey(value: unknown): string {
  if (typeof value !== "string" || value.trim().length === 0) throw new ApplicationError("validation_failed", "actorKey must be a non-empty string.", { fieldErrors: [{ fieldPath: "/actorKey", code: "empty", summary: "actorKey must be non-empty" }] });
  return value.trim();
}
function assertActiveSystem(ctx: TrustedActorContext): void {
  if (!isUuidV4(ctx.actorId)) throw new ApplicationError("authentication_required", "Invalid actor context.");
  if (ctx.actorKind !== "system" || !ctx.active) throw new ApplicationError("actor_kind_forbidden", "Only an active system actor may run setup.");
}
function assertActiveHuman(ctx: TrustedActorContext): void {
  if (!isUuidV4(ctx.actorId)) throw new ApplicationError("authentication_required", "Invalid actor context.");
  if (ctx.actorKind !== "human" || !ctx.active) throw new ApplicationError("actor_kind_forbidden", "Only an active human actor may update profile.");
}
function mapToApplicationError(err: unknown): ApplicationError {
  if (err instanceof ApplicationError) return err;
  const msg = (err as Error).message ?? "internal error";
  if (/UNIQUE|constraint/i.test(msg)) return new ApplicationError("concurrent_modification", "A concurrent modification occurred; refresh and retry.");
  return new ApplicationError("internal_error", "An internal error occurred.", { cause: err });
}

export type { IdempotencyRecord };
