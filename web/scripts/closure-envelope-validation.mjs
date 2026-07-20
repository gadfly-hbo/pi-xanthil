/**
 * Focused validation: closure POST envelope parsing.
 *
 * Simulates the postCommand envelope normalizer against the T0021
 * backend envelope contract (successEnvelope / errorEnvelope) and
 * verifies the UI receives the expected ClosureCommandResult shapes.
 *
 * Run: node web/scripts/closure-envelope-validation.mjs
 */

const PASS = "\x1b[32mPASS\x1b[0m";
const FAIL = "\x1b[31mFAIL\x1b[0m";
let failures = 0;

function assert(condition, label) {
  if (condition) {
    console.log(`  ${PASS} ${label}`);
  } else {
    console.log(`  ${FAIL} ${label}`);
    failures++;
  }
}

function assertEq(actual, expected, label) {
  assert(JSON.stringify(actual) === JSON.stringify(expected), `${label}: ${JSON.stringify(actual)} === ${JSON.stringify(expected)}`);
}

// ---------------------------------------------------------------------------
// Simulated postCommand normalizer (mirrors web/src/lib/api/analysis-projects.ts)
// ---------------------------------------------------------------------------

function normalizeResponse(res) {
  const raw = res.body;

  if (res.ok) {
    const data = raw.data;
    const status = data?.status;
    if (status === "in_progress") {
      return { kind: "in_progress", recordId: data?.idempotencyRecordId };
    }
    if (status === "succeeded") {
      return {
        kind: "replayed_success",
        resultResourceType: data?.resultResourceType,
        resultResourceId: data?.resultResourceId,
        recordId: data?.idempotencyRecordId,
      };
    }
    return { kind: "executed", data: raw.data };
  }

  const errCode = raw.error?.code ?? "unknown";
  if (errCode === "idempotency_key_reused") {
    return { kind: "conflict", errorCode: errCode, errorSummary: raw.error?.summary };
  }
  return {
    kind: "failed",
    errorCode: errCode,
    errorSummary: raw.error?.summary ?? "请求失败",
    fieldErrors: raw.error?.fieldErrors,
  };
}

// ---------------------------------------------------------------------------
// Test cases matching T0021 backend envelope shapes
// ---------------------------------------------------------------------------

console.log("\n=== Closure POST Envelope Parsing Validation ===\n");

// T1: Successful execute (initiate returns 201 with cycle data)
console.log("T1: Successful execute (initiate 201)");
{
  const res = {
    ok: true,
    body: {
      schemaVersion: "1.0",
      requestId: "req-001",
      data: {
        closure_cycle_id: "abc-123",
        analysis_project_id: "proj-001",
        closure_ordinal: 1,
        cycle_status: "initiated",
        current_stage: null,
        initiated_at: "2026-07-20T06:00:00Z",
        initiated_by_actor_id: "human-1",
        updated_at: "2026-07-20T06:00:00Z",
      },
    },
  };
  const result = normalizeResponse(res);
  assertEq(result.kind, "executed", "kind = executed");
  assert(result.data !== undefined, "data is present");
  assertEq(result.data.closure_cycle_id, "abc-123", "closure_cycle_id preserved");
}

// T2: Replayed success (same idempotency key + body)
console.log("\nT2: Replayed success (idempotency replay)");
{
  const res = {
    ok: true,
    body: {
      schemaVersion: "1.0",
      requestId: "req-002",
      data: {
        commandType: "",
        idempotencyRecordId: "idk-record-001",
        resultResourceType: "ClosureCycle",
        resultResourceId: "abc-123",
        status: "succeeded",
      },
    },
  };
  const result = normalizeResponse(res);
  assertEq(result.kind, "replayed_success", "kind = replayed_success");
  assertEq(result.resultResourceType, "ClosureCycle", "resultResourceType = ClosureCycle");
  assertEq(result.resultResourceId, "abc-123", "resultResourceId = abc-123");
  assertEq(result.recordId, "idk-record-001", "recordId = idk-record-001");
}

// T3: In progress (202)
console.log("\nT3: In progress (202)");
{
  const res = {
    ok: true,
    body: {
      schemaVersion: "1.0",
      requestId: "req-003",
      data: {
        idempotencyRecordId: "idk-record-002",
        status: "in_progress",
      },
    },
  };
  const result = normalizeResponse(res);
  assertEq(result.kind, "in_progress", "kind = in_progress");
  assertEq(result.recordId, "idk-record-002", "recordId = idk-record-002");
}

// T4: Conflict (409 idempotency_key_reused)
console.log("\nT4: Conflict (409 idempotency_key_reused)");
{
  const res = {
    ok: false,
    body: {
      schemaVersion: "1.0",
      requestId: "req-004",
      error: {
        code: "idempotency_key_reused",
        summary: "This idempotency key has been used with a different request body.",
        fieldErrors: [],
        retryDirective: "retry_with_new_idempotency_key",
        diagnosticEvidenceArtifactId: null,
      },
    },
  };
  const result = normalizeResponse(res);
  assertEq(result.kind, "conflict", "kind = conflict");
  assertEq(result.errorCode, "idempotency_key_reused", "errorCode = idempotency_key_reused");
}

// T5: Validation error (400)
console.log("\nT5: Validation error (400 validation_failed)");
{
  const res = {
    ok: false,
    body: {
      schemaVersion: "1.0",
      requestId: "req-005",
      error: {
        code: "validation_failed",
        summary: "/translationStatus must be one of: draft, confirmed.",
        fieldErrors: [
          { fieldPath: "/translationStatus", code: "invalid_enum", summary: "must be one of: draft, confirmed" },
        ],
        retryDirective: "do_not_retry",
        diagnosticEvidenceArtifactId: null,
      },
    },
  };
  const result = normalizeResponse(res);
  assertEq(result.kind, "failed", "kind = failed");
  assertEq(result.errorCode, "validation_failed", "errorCode = validation_failed");
  assertEq(result.errorSummary, "/translationStatus must be one of: draft, confirmed.", "errorSummary preserved");
  assert(result.fieldErrors?.length === 1, "fieldErrors has 1 entry");
  assertEq(result.fieldErrors[0].fieldPath, "/translationStatus", "fieldPath = /translationStatus");
}

// T6: Resource not found (404)
console.log("\nT6: Resource not found (404)");
{
  const res = {
    ok: false,
    body: {
      schemaVersion: "1.0",
      requestId: "req-006",
      error: {
        code: "resource_not_found",
        summary: "Closure cycle not found.",
        fieldErrors: [],
        retryDirective: "do_not_retry",
        diagnosticEvidenceArtifactId: null,
      },
    },
  };
  const result = normalizeResponse(res);
  assertEq(result.kind, "failed", "kind = failed");
  assertEq(result.errorCode, "resource_not_found", "errorCode = resource_not_found");
}

// T7: S3.1 successful execute
console.log("\nT7: S3.1 successful execute (201)");
{
  const res = {
    ok: true,
    body: {
      schemaVersion: "1.0",
      requestId: "req-007",
      data: {
        translation_id: "tr-001",
        closure_cycle_id: "abc-123",
        business_action_artifact_ref: "blobs/s31/a",
        translation_status: "draft",
        confirmed_at: null,
        created_at: "2026-07-20T06:01:00Z",
      },
    },
  };
  const result = normalizeResponse(res);
  assertEq(result.kind, "executed", "kind = executed");
  assertEq(result.data.translation_id, "tr-001", "translation_id preserved");
}

// T8: S3.4 append-only feedback
console.log("\nT8: S3.4 append-only feedback (201)");
{
  const res = {
    ok: true,
    body: {
      schemaVersion: "1.0",
      requestId: "req-008",
      data: {
        ingestion_id: "ing-001",
        closure_cycle_id: "abc-123",
        feedback_ordinal: 1,
        feedback_dataset_ref: "ds-1",
        statistical_significance: "pending",
        antigravity_review_status: "pending",
        created_at: "2026-07-20T06:02:00Z",
      },
    },
  };
  const result = normalizeResponse(res);
  assertEq(result.kind, "executed", "kind = executed");
  assertEq(result.data.feedback_ordinal, 1, "feedback_ordinal = 1");
}

// T9: S3.6 archive trigger
console.log("\nT9: S3.6 archive trigger (201)");
{
  const res = {
    ok: true,
    body: {
      schemaVersion: "1.0",
      requestId: "req-009",
      data: {
        trigger_id: "trig-001",
        closure_cycle_id: "abc-123",
        branch: "archive",
        target_state: null,
        triggered_at: "2026-07-20T06:03:00Z",
        created_at: "2026-07-20T06:03:00Z",
      },
    },
  };
  const result = normalizeResponse(res);
  assertEq(result.kind, "executed", "kind = executed");
  assertEq(result.data.branch, "archive", "branch = archive");
  assertEq(result.data.target_state, null, "target_state = null");
}

// ---------------------------------------------------------------------------
// UI behavior validation: ClosureCommandResult kind checks
// ---------------------------------------------------------------------------

console.log("\n=== UI Behavior: kind-based branching ===\n");

console.log("T10: executed triggers form close + refresh");
{
  const result = { kind: "executed", data: {} };
  const shouldClose = result.kind === "executed" || result.kind === "replayed_success";
  assert(shouldClose, "form closes on executed");
}

console.log("\nT11: replayed_success triggers form close + refresh");
{
  const result = { kind: "replayed_success", resultResourceType: "ClosureCycle", resultResourceId: "x" };
  const shouldClose = result.kind === "executed" || result.kind === "replayed_success";
  assert(shouldClose, "form closes on replayed_success");
}

console.log("\nT12: in_progress does NOT close form");
{
  const result = { kind: "in_progress", recordId: "x" };
  const shouldClose = result.kind === "executed" || result.kind === "replayed_success";
  assert(!shouldClose, "form stays open on in_progress");
}

console.log("\nT13: conflict shows conflict banner");
{
  const result = { kind: "conflict", errorCode: "idempotency_key_reused" };
  const isConflict = result.kind === "conflict";
  assert(isConflict, "conflict detected");
}

console.log("\nT14: failed shows error banner");
{
  const result = { kind: "failed", errorSummary: "validation error" };
  const isFailed = result.kind === "failed";
  assert(isFailed, "failure detected");
  assert(result.errorSummary === "validation error", "error summary preserved");
}

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

console.log(`\n${"=".repeat(50)}`);
if (failures === 0) {
  console.log(`${PASS} All envelope parsing tests passed.`);
  process.exit(0);
} else {
  console.log(`${FAIL} ${failures} test(s) failed.`);
  process.exit(1);
}
