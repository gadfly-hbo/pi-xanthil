/**
 * Application-level idempotency service (standalone DB-aware functions).
 *
 * Contract (application-api-readmodels-v1.md §4, §15, API-009/API-049/API-055):
 * - scope = (auditActorId, commandType, idempotencyKey); idempotencyKey is UUID v4.
 * - request hash covers method/normalized path/canonical JSON body (JSON commands).
 * - same scope/key + same hash: in-progress -> 202; terminal -> limited replay receipt.
 * - same scope/key + different hash: 409 idempotency_key_reused (conflict).
 * - second concurrent claim cannot gain execution (UNIQUE constraint).
 * - in_progress -> terminal; terminal never mutates again.
 * - startup orphan recovery: in_progress -> interrupted (new key required).
 * - success receipt and business facts share ONE SQLite transaction.
 * - records never store body, fieldErrors, diagnostic, token, stack, or secrets.
 */
import type { DatabaseSync } from "node:sqlite";
import {
  assertCommandType,
  isExecutionStatus,
  isResultResourceType,
  type CommandType,
  type ExecutionStatus,
  type ResultResourceType,
} from "../../contracts/registries.ts";
import { isSha256Hex, isUuidV4, now, uuid } from "../shared/runtime.ts";

export interface IdempotencyRecord {
  readonly idempotencyRecordId: string;
  readonly auditActorId: string;
  readonly commandType: CommandType;
  readonly idempotencyKey: string;
  readonly requestSha256: string;
  readonly executionStatus: ExecutionStatus;
  readonly responseHttpStatus: number | null;
  readonly resultResourceType: ResultResourceType | null;
  readonly resultResourceId: string | null;
  readonly errorCode: string | null;
  readonly errorSummary: string | null;
  readonly createdAt: string;
  readonly completedAt: string | null;
}

/**
 * Claim result.
 * - execute: no prior record; caller has exclusive execution right.
 * - in_progress: same key+hash already executing (202).
 * - replay_success: terminal succeeded; return limited receipt.
 * - replay_failed: terminal failed/interrupted; return safe error receipt.
 * - conflict: same key, different request hash (409 idempotency_key_reused).
 */
export type ClaimResult =
  | { readonly kind: "execute"; readonly recordId: string }
  | { readonly kind: "in_progress"; readonly recordId: string }
  | { readonly kind: "replay_success"; readonly recordId: string; readonly record: IdempotencyRecord }
  | { readonly kind: "replay_failed"; readonly recordId: string; readonly record: IdempotencyRecord }
  | { readonly kind: "conflict"; readonly recordId: string; readonly record: IdempotencyRecord };

export class IdempotencyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "IdempotencyError";
  }
}

interface ClaimInput {
  readonly actorId: string;
  readonly commandType: CommandType;
  readonly idempotencyKey: string;
  readonly requestHash: string;
}

function validateClaimInput(input: ClaimInput): void {
  assertCommandType(input.commandType);
  if (!isUuidV4(input.actorId))
    throw new IdempotencyError(`actorId must be a UUID v4: ${input.actorId}`);
  if (!isUuidV4(input.idempotencyKey))
    throw new IdempotencyError(`idempotencyKey must be a UUID v4: ${input.idempotencyKey}`);
  if (!isSha256Hex(input.requestHash))
    throw new IdempotencyError(`requestHash must be 64-char lowercase hex`);
}

const SELECT_COLS =
  "idempotency_record_id, audit_actor_id, command_type, idempotency_key, " +
  "request_sha256, execution_status, response_http_status, " +
  "result_resource_type, result_resource_id, error_code, error_summary, " +
  "created_at, completed_at";

interface RowShape {
  idempotency_record_id: string;
  audit_actor_id: string;
  command_type: string;
  idempotency_key: string;
  request_sha256: string;
  execution_status: string;
  response_http_status: number | null;
  result_resource_type: string | null;
  result_resource_id: string | null;
  error_code: string | null;
  error_summary: string | null;
  created_at: string;
  completed_at: string | null;
}

function rowToRecord(row: RowShape): IdempotencyRecord {
  if (!isExecutionStatus(row.execution_status))
    throw new IdempotencyError(`Corrupt record: unknown execution_status ${row.execution_status}`);
  return {
    idempotencyRecordId: row.idempotency_record_id,
    auditActorId: row.audit_actor_id,
    commandType: assertCommandType(row.command_type),
    idempotencyKey: row.idempotency_key,
    requestSha256: row.request_sha256,
    executionStatus: row.execution_status,
    responseHttpStatus: row.response_http_status,
    resultResourceType: (row.result_resource_type as ResultResourceType | null),
    resultResourceId: row.result_resource_id,
    errorCode: row.error_code,
    errorSummary: row.error_summary,
    createdAt: row.created_at,
    completedAt: row.completed_at,
  };
}

/** Claim or replay an idempotency record. Atomic against concurrent claims. */
export function claimOn(db: DatabaseSync, input: ClaimInput): ClaimResult {
  validateClaimInput(input);
  const recordId = uuid();
  const createdAt = now();
  let insertErr: unknown = null;
  try {
    db.prepare(
      `INSERT INTO api_idempotency_records
         (idempotency_record_id, audit_actor_id, command_type, idempotency_key,
          request_sha256, execution_status, created_at)
       VALUES (?, ?, ?, ?, ?, 'in_progress', ?)`,
    ).run(recordId, input.actorId, input.commandType, input.idempotencyKey, input.requestHash, createdAt);
    return { kind: "execute", recordId };
  } catch (err) {
    insertErr = err;
  }
  // The INSERT failed. The only legitimate recoverable case is a scope UNIQUE
  // conflict (an existing record for the same actor+command+key). Any other
  // failure (FK/CHECK/etc.) must NOT be treated as a conflict and must NOT
  // recurse. Look up the scope record: if it exists, this is a real
  // replay/conflict; if it does not, re-throw the original error.
  const existing = db
    .prepare(`SELECT ${SELECT_COLS} FROM api_idempotency_records WHERE audit_actor_id = ? AND command_type = ? AND idempotency_key = ?`)
    .get(input.actorId, input.commandType, input.idempotencyKey) as RowShape | undefined;
  if (!existing) {
    // Not a scope conflict (e.g. FK/CHECK failure). Re-throw the original error
    // instead of recursing, so callers see the real cause.
    throw insertErr;
  }
  const rec = rowToRecord(existing);
  if (rec.requestSha256 !== input.requestHash) return { kind: "conflict", recordId: rec.idempotencyRecordId, record: rec };
  if (rec.executionStatus === "in_progress") return { kind: "in_progress", recordId: rec.idempotencyRecordId };
  if (rec.executionStatus === "succeeded") return { kind: "replay_success", recordId: rec.idempotencyRecordId, record: rec };
  return { kind: "replay_failed", recordId: rec.idempotencyRecordId, record: rec };
}

/**
 * Record terminal SUCCESS inside the caller's business transaction.
 * Issues only the UPDATE; caller manages BEGIN/COMMIT so business facts and
 * this receipt commit atomically.
 */
export function recordSuccessInTx(
  db: DatabaseSync,
  recordId: string,
  result: { readonly httpStatus: number; readonly resultResourceType: ResultResourceType; readonly resultResourceId: string },
): void {
  if (!isResultResourceType(result.resultResourceType))
    throw new IdempotencyError(`resultResourceType must be a registered type`);
  if (typeof result.resultResourceId !== "string" || result.resultResourceId.length === 0)
    throw new IdempotencyError("resultResourceId must be a non-empty string");
  terminalUpdate(db, recordId, "succeeded", {
    httpStatus: result.httpStatus,
    resultResourceType: result.resultResourceType,
    resultResourceId: result.resultResourceId,
  });
}

/** Record terminal FAILURE (business validation failure). Own transaction. */
export function recordFailure(
  db: DatabaseSync,
  recordId: string,
  result: { readonly httpStatus: number; readonly errorCode: string; readonly errorSummary: string },
): void {
  recordTerminalOwnTx(db, recordId, "failed", result);
}

/** Record INTERRUPTED outcome (startup orphan recovery). Own transaction. */
export function recordInterrupted(
  db: DatabaseSync,
  recordId: string,
  result: { readonly httpStatus: number; readonly errorCode: string; readonly errorSummary: string },
): void {
  recordTerminalOwnTx(db, recordId, "interrupted", result);
}

function recordTerminalOwnTx(
  db: DatabaseSync,
  recordId: string,
  status: "failed" | "interrupted",
  result: { readonly httpStatus: number; readonly errorCode: string; readonly errorSummary: string },
): void {
  db.exec("BEGIN");
  try {
    terminalUpdate(db, recordId, status, { httpStatus: result.httpStatus, errorCode: result.errorCode, errorSummary: result.errorSummary });
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
}

function terminalUpdate(
  db: DatabaseSync,
  recordId: string,
  status: ExecutionStatus,
  fields: {
    readonly httpStatus: number;
    readonly resultResourceType?: ResultResourceType;
    readonly resultResourceId?: string;
    readonly errorCode?: string;
    readonly errorSummary?: string;
  },
): void {
  const existing = getRecord(db, recordId);
  if (!existing) throw new IdempotencyError(`idempotency record not found: ${recordId}`);
  if (existing.executionStatus !== "in_progress")
    throw new IdempotencyError(`record ${recordId} already terminal (${existing.executionStatus}); terminal records are immutable`);
  if (typeof fields.httpStatus !== "number" || fields.httpStatus < 100 || fields.httpStatus > 599)
    throw new IdempotencyError(`httpStatus must be a valid HTTP status: ${fields.httpStatus}`);
  const completedAt = now();
  db.prepare(
    `UPDATE api_idempotency_records
       SET execution_status = ?, response_http_status = ?, result_resource_type = ?,
           result_resource_id = ?, error_code = ?, error_summary = ?, completed_at = ?
     WHERE idempotency_record_id = ? AND execution_status = 'in_progress'`,
  ).run(
    status, fields.httpStatus, fields.resultResourceType ?? null, fields.resultResourceId ?? null,
    fields.errorCode ?? null, fields.errorSummary ?? null, completedAt, recordId,
  );
  const updated = getRecord(db, recordId);
  if (!updated || updated.executionStatus !== status)
    throw new IdempotencyError(`record ${recordId} could not be terminalized to ${status}`);
}

/** Startup orphan recovery: sweep in_progress records to interrupted. Returns count. */
export function recoverOrphans(db: DatabaseSync): number {
  const orphans = db
    .prepare(`SELECT idempotency_record_id FROM api_idempotency_records WHERE execution_status = 'in_progress' ORDER BY created_at ASC`)
    .all() as Array<{ idempotency_record_id: string }>;
  let count = 0;
  const completedAt = now();
  for (const row of orphans) {
    db.prepare(
      `UPDATE api_idempotency_records
         SET execution_status = 'interrupted', response_http_status = 503,
             error_code = 'command_interrupted',
             error_summary = 'Command was in progress when the process stopped; retry with a new idempotency key.',
             completed_at = ?
       WHERE idempotency_record_id = ? AND execution_status = 'in_progress'`,
    ).run(completedAt, row.idempotency_record_id);
    count++;
  }
  return count;
}

/** Read a record by ID (for command execution projection). */
export function getRecord(db: DatabaseSync, recordId: string): IdempotencyRecord | null {
  const row = db
    .prepare(`SELECT ${SELECT_COLS} FROM api_idempotency_records WHERE idempotency_record_id = ?`)
    .get(recordId) as RowShape | undefined;
  return row ? rowToRecord(row) : null;
}
