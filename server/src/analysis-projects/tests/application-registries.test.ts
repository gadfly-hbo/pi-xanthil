/**
 * Registry tests: exact counts and fail-closed behavior.
 * Contract: 27 commands, 38 ApiError, 12 RunEvent, 12 Engine operation,
 * 15 Engine error codes, 13 result resource types, 4 execution statuses.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  COMMAND_TYPES, EXECUTION_STATUSES, RESULT_RESOURCE_TYPES,
  ENGINE_PORT_OPERATIONS, ENGINE_ERROR_CODES, ENGINE_OUTCOMES,
  RUN_EVENT_TYPES, assertCommandType, assertRunEventType,
  isExecutionStatus, isResultResourceType, isEnginePortOperation, isEngineErrorCode,
  runEventSchemaVersion,
  PROJECT_STAGES, ANALYSIS_STAGES, isProjectStage, assertProjectStage,
} from "../contracts/registries.ts";
import {
  API_ERROR_REGISTRY, API_ERROR_CODES, getApiErrorSpec, isApiErrorCode,
} from "../contracts/envelope.ts";
import { validateRunEventPayload } from "../contracts/run-event.ts";
import { validateEnginePortRequest, validateEnginePortResult, validateEnginePortInput } from "../contracts/engine-port.ts";

describe("command registry", () => {
  test("has exactly 34 command types", () => {
    assert.equal(COMMAND_TYPES.length, 34, "command taxonomy must be 34 (27 original + 7 closure)");
    // no duplicates
    assert.equal(new Set(COMMAND_TYPES).size, 34);
  });

  test("assertCommandType accepts known and rejects unknown", () => {
    assert.equal(assertCommandType("project.create"), "project.create");
    assert.throws(() => assertCommandType("project.start"), /Unknown command_type/);
    assert.throws(() => assertCommandType(""), /Unknown command_type/);
    assert.throws(() => assertCommandType(null), /Unknown command_type/);
  });
});

describe("ApiError registry", () => {
  test("has exactly 38 error codes", () => {
    assert.equal(API_ERROR_REGISTRY.length, 38, "ApiError registry must be 38 codes (§2.3)");
    assert.equal(API_ERROR_CODES.length, 38);
    assert.equal(new Set(API_ERROR_CODES).size, 38);
  });

  test("each code maps to exactly one HTTP status + retryDirective", () => {
    for (const spec of API_ERROR_REGISTRY) {
      assert.ok(spec.httpStatus >= 400 && spec.httpStatus < 600, `${spec.code} httpStatus`);
      assert.ok(["do_not_retry", "retry_same_request", "retry_with_new_idempotency_key", "refresh_then_retry", "human_action_required"].includes(spec.retryDirective), `${spec.code} retryDirective`);
    }
  });

  test("getApiErrorSpec fail-closed on unknown code", () => {
    assert.equal(getApiErrorSpec("validation_failed").httpStatus, 400);
    assert.throws(() => getApiErrorSpec("not_a_real_code"), /Unknown ApiErrorCode/);
    assert.ok(!isApiErrorCode("fake_code"));
    assert.ok(isApiErrorCode("internal_error"));
  });

  test("specific code mappings from contract table", () => {
    assert.deepEqual(getApiErrorSpec("idempotency_key_reused"), { code: "idempotency_key_reused", httpStatus: 409, retryDirective: "retry_with_new_idempotency_key" });
    assert.deepEqual(getApiErrorSpec("command_interrupted"), { code: "command_interrupted", httpStatus: 503, retryDirective: "retry_with_new_idempotency_key" });
    assert.deepEqual(getApiErrorSpec("read_model_unavailable"), { code: "read_model_unavailable", httpStatus: 503, retryDirective: "retry_same_request" });
  });
});

describe("RunEvent registry", () => {
  test("has exactly 12 event types", () => {
    assert.equal(RUN_EVENT_TYPES.length, 12, "RunEvent taxonomy must be 12 (§13)");
    assert.equal(new Set(RUN_EVENT_TYPES).size, 12);
  });

  test("assertRunEventType fail-closed", () => {
    assert.equal(assertRunEventType("run_queued"), "run_queued");
    assert.throws(() => assertRunEventType("run_resumed"), /Unknown run_event_type/);
  });

  test("schema version format", () => {
    assert.equal(runEventSchemaVersion("run_queued"), "workcanger.run-event.run_queued/1.0");
  });

  test("validateRunEventPayload accepts valid and rejects unknown version/field", () => {
    const p = validateRunEventPayload("run_queued", "workcanger.run-event.run_queued/1.0", { inputEvidenceCount: 2, queueCause: "initial" });
    assert.equal(p.eventType, "run_queued");
    // unknown version fail closed
    assert.throws(() => validateRunEventPayload("run_queued", "workcanger.run-event.run_queued/2.0", { inputEvidenceCount: 2, queueCause: "initial" }), /Unsupported run-event schema version/);
    // unknown field fail closed
    assert.throws(() => validateRunEventPayload("run_queued", "workcanger.run-event.run_queued/1.0", { inputEvidenceCount: 2, queueCause: "initial", extra: 1 }), /Unknown field 'extra'/);
    // unknown event type fail closed
    assert.throws(() => validateRunEventPayload("run_resumed", "workcanger.run-event.run_resumed/1.0", {}), /Unknown run event type/);
  });

  test("run_started accepts empty object", () => {
    const p = validateRunEventPayload("run_started", "workcanger.run-event.run_started/1.0", {});
    assert.equal(p.eventType, "run_started");
  });
});

describe("Engine port registry", () => {
  test("has exactly 12 operations", () => {
    assert.equal(ENGINE_PORT_OPERATIONS.length, 12, "Engine port operations must be 12 (§12.1)");
    assert.equal(new Set(ENGINE_PORT_OPERATIONS).size, 12);
  });

  test("has exactly 15 engine error codes", () => {
    assert.equal(ENGINE_ERROR_CODES.length, 15, "Engine error codes must be 15 (§12.2)");
    assert.equal(new Set(ENGINE_ERROR_CODES).size, 15);
  });

  test("has exactly 6 outcomes", () => {
    assert.equal(ENGINE_OUTCOMES.length, 6);
  });

  test("isEnginePortOperation fail-closed", () => {
    assert.ok(isEnginePortOperation("executeQueuedRun"));
    assert.ok(!isEnginePortOperation("startRun"));
  });

  test("validateEnginePortRequest fails closed on unknown version/operation/field/identity/time", () => {
    const opId = randomUUID();
    const projId = randomUUID();
    const runId = randomUUID();
    const planId = randomUUID();
    const ts = "2026-07-17T00:00:00.000Z";
    const validReq = {
      version: "engine-port/1.0", operation: "executeQueuedRun", operationId: opId,
      projectId: projId, runId, caller: "backend", requestedAt: ts,
      inputHash: "0".repeat(64), abortSignal: AbortSignal.timeout(1000),
      input: { runId, planVersionId: planId, expectedPreviousSequence: 0 },
    };
    validateEnginePortRequest(validReq);
    assert.throws(() => validateEnginePortRequest({ ...validReq, version: "engine-port/2.0" }), /Unsupported engine-port version/);
    assert.throws(() => validateEnginePortRequest({ ...validReq, operation: "bogus" }), /Unknown engine port operation/);
    assert.throws(() => validateEnginePortRequest({ ...validReq, inputHash: "short" }), /inputHash/);
    assert.throws(() => validateEnginePortRequest({ ...validReq, extra: 1 } as Record<string, unknown>), /unknown request envelope field 'extra'/);
    assert.throws(() => validateEnginePortRequest({ ...validReq, input: { ...validReq.input, extra: 1 } }), /unknown input field 'extra'/);
    assert.throws(() => validateEnginePortRequest({ ...validReq, input: { runId, expectedPreviousSequence: 0 } }), /missing required input field 'planVersionId'/);
    assert.throws(() => validateEnginePortRequest({ ...validReq, operationId: "not-uuid" }), /operationId must be a UUID v4/);
    assert.throws(() => validateEnginePortRequest({ ...validReq, projectId: "p" }), /projectId must be a UUID v4/);
    assert.throws(() => validateEnginePortRequest({ ...validReq, requestedAt: "t" }), /requestedAt must be a UTC RFC 3339/);
    assert.throws(() => validateEnginePortRequest({ ...validReq, abortSignal: "not-a-signal" as unknown }), /abortSignal must be an AbortSignal/);
    // real RFC 3339 calendar validation (not just shape)
    assert.throws(() => validateEnginePortRequest({ ...validReq, requestedAt: "2026-99-99T99:99:99Z" }), /requestedAt must be a UTC RFC 3339/);
    assert.throws(() => validateEnginePortRequest({ ...validReq, requestedAt: "2026-02-30T00:00:00Z" }), /requestedAt must be a UTC RFC 3339/);
    // run/generation conditional mutual-exclusivity: run op must not carry generationId
    assert.throws(() => validateEnginePortRequest({ ...validReq, generationId: randomUUID() }), /must not carry a generationId/);
    assert.throws(() => validateEnginePortRequest({ ...validReq, generationId: "not-a-uuid" } as Record<string, unknown>), /must not carry a generationId/);
    // generation operation requires generationId (UUID v4)
    const genReq = { ...validReq, operation: "generateAnalysisPlan" as const, generationId: randomUUID(), runId: undefined, input: { requirementVersionId: randomUUID(), targetSchemaVersion: "1.0" } };
    validateEnginePortRequest(genReq);
    assert.throws(() => validateEnginePortRequest({ ...genReq, generationId: "g" }), /requires a UUID v4 generationId/);
    // generation op must not carry runId
    assert.throws(() => validateEnginePortRequest({ ...genReq, runId: randomUUID() }), /must not carry a runId/);
  });

  test("validateEnginePortInput rejects reviewOrdinal=0 (must be > 0)", () => {
    assert.throws(() => validateEnginePortInput("submitInternalReviewEvidence", { runId: randomUUID(), planStepId: "s1", reviewOrdinal: 0 }), /positive integer/);
    validateEnginePortInput("submitInternalReviewEvidence", { runId: randomUUID(), planStepId: "s1", reviewOrdinal: 1 });
  });

  test("validateEnginePortResult enforces output/error mutual exclusion + unknown fields + identity/time", () => {
    const opId = randomUUID();
    const projId = randomUUID();
    const ts = "2026-07-17T00:00:00.000Z";
    const validSucceeded = { version: "engine-port/1.0", operation: "executeQueuedRun", operationId: opId, projectId: projId, runId: randomUUID(), startedAt: ts, completedAt: ts, outcome: "succeeded", output: {} };
    validateEnginePortResult(validSucceeded);
    validateEnginePortResult({ version: "engine-port/1.0", operation: "executeQueuedRun", operationId: opId, projectId: projId, runId: randomUUID(), startedAt: ts, completedAt: ts, outcome: "failed", error: { code: "pi_execution_failed", summary: "s" } });
    assert.throws(() => validateEnginePortResult({ ...validSucceeded, error: { code: "pi_execution_failed", summary: "s" } }), /mutually exclusive/);
    assert.throws(() => validateEnginePortResult({ version: "engine-port/1.0", operation: "executeQueuedRun", operationId: opId, projectId: projId, runId: randomUUID(), startedAt: ts, completedAt: ts, outcome: "succeeded" }), /succeeded outcome requires structured output/);
    assert.throws(() => validateEnginePortResult({ ...validSucceeded, operationId: "x" }), /operationId must be a UUID v4/);
    assert.throws(() => validateEnginePortResult({ ...validSucceeded, startedAt: "t" }), /startedAt must be a UTC RFC 3339/);
    // real RFC 3339 calendar validation on result envelope
    assert.throws(() => validateEnginePortResult({ ...validSucceeded, startedAt: "2026-99-99T99:99:99Z" }), /startedAt must be a UTC RFC 3339/);
    assert.throws(() => validateEnginePortResult({ ...validSucceeded, completedAt: "2026-02-30T00:00:00Z" }), /completedAt must be a UTC RFC 3339/);
    // run op must not carry generationId
    assert.throws(() => validateEnginePortResult({ ...validSucceeded, generationId: randomUUID() }), /must not carry a generationId/);
    // generation op must not carry runId
    const genRes = { version: "engine-port/1.0", operation: "generateAnalysisPlan" as const, operationId: randomUUID(), projectId: randomUUID(), generationId: randomUUID(), runId: undefined, startedAt: ts, completedAt: ts, outcome: "succeeded", output: {} };
    validateEnginePortResult(genRes);
    assert.throws(() => validateEnginePortResult({ ...genRes, runId: randomUUID() }), /must not carry a runId/);
    assert.throws(() => validateEnginePortResult({ version: "engine-port/1.0", operation: "executeQueuedRun", operationId: opId, projectId: projId, runId: randomUUID(), startedAt: ts, completedAt: ts, outcome: "bogus", error: { code: "pi_execution_failed", summary: "s" } }), /Unknown engine port outcome/);
    assert.throws(() => validateEnginePortResult({ version: "engine-port/1.0", operation: "executeQueuedRun", operationId: opId, projectId: projId, runId: randomUUID(), startedAt: ts, completedAt: ts, outcome: "failed", error: { code: "bogus_code", summary: "s" } }), /Unknown engine error code/);
    assert.throws(() => validateEnginePortResult({ ...validSucceeded, extra: 1 } as Record<string, unknown>), /unknown result envelope field 'extra'/);
  });
});

describe("idempotency enums", () => {
  test("has exactly 4 execution statuses", () => {
    assert.equal(EXECUTION_STATUSES.length, 4);
    assert.ok(isExecutionStatus("in_progress"));
    assert.ok(!isExecutionStatus("completed"));
  });

  test("has exactly 15 result resource types", () => {
    assert.equal(RESULT_RESOURCE_TYPES.length, 15, "result resource types must be 15 (13 original + 2 closure)");
    assert.ok(isResultResourceType("Project"));
    assert.ok(isResultResourceType("export"));
    assert.ok(isResultResourceType("ClosureCycle"));
    assert.ok(isResultResourceType("ClosureStageFact"));
    assert.ok(!isResultResourceType("Workspace"));
  });
});

describe("project stage registry", () => {
  test("ANALYSIS_STAGES has exactly 4 run-level stages", () => {
    assert.equal(ANALYSIS_STAGES.length, 4);
    assert.deepEqual([...ANALYSIS_STAGES], ["S2.1", "S2.2", "S2.3", "S2.4"]);
  });

  test("PROJECT_STAGES includes all derived stages S1.1-S2.6", () => {
    assert.ok(PROJECT_STAGES.length >= 8, "project stages must cover S1.1 through S2.6");
    assert.ok(PROJECT_STAGES.includes("S1.1"), "S1.1 (request submitted) must be in registry");
    assert.ok(PROJECT_STAGES.includes("S1.2"), "S1.2 (requirement exists) must be in registry");
    assert.ok(PROJECT_STAGES.includes("S1.4"), "S1.4 (plan exists, not confirmed) must be in registry");
    assert.ok(PROJECT_STAGES.includes("S2.1"), "S2.1 must be in registry");
    assert.ok(PROJECT_STAGES.includes("S2.5"), "S2.5 (report exists) must be in registry");
    assert.ok(PROJECT_STAGES.includes("S2.6"), "S2.6 (locked report) must be in registry");
  });

  test("S1.4 is defined in registry (stage drift fix)", () => {
    assert.ok(isProjectStage("S1.4"), "S1.4 must be a valid ProjectStage");
    assert.equal(assertProjectStage("S1.4"), "S1.4");
  });

  test("unknown stage values fail closed", () => {
    assert.ok(!isProjectStage("S1.3"), "S1.3 is not in registry (reserved)");
    assert.ok(!isProjectStage("S3.0"), "S3.0 is not in registry");
    assert.ok(!isProjectStage(""), "empty string is not a valid stage");
    assert.throws(() => assertProjectStage("S1.3"), /Unknown project_stage/);
    assert.throws(() => assertProjectStage("S9.9"), /Unknown project_stage/);
  });

  test("all ANALYSIS_STAGES are also in PROJECT_STAGES", () => {
    for (const stage of ANALYSIS_STAGES) {
      assert.ok(PROJECT_STAGES.includes(stage as never), `AnalysisStage ${stage} must also be a ProjectStage`);
    }
  });
});
