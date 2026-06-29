import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

process.env.XANTHIL_DATA_DIR = mkdtempSync(join(tmpdir(), "pi-xanthil-trace-inspection-test-"));

const db = await import("./db.ts");

const day = 86400000;

function addFailedTrace(workspaceId: string, ageDays: number, input: { type: string; targetKind?: string; targetId?: string; detail?: string }) {
  const event = db.addTraceEvent({
    workspaceId,
    targetKind: input.targetKind ?? "flow_run",
    targetId: input.targetId ?? `target-${ageDays}-${Math.random()}`,
    type: input.type,
    target: "safe target label",
    status: "failed",
    detail: input.detail ?? "raw stderr should not be emitted",
  });
  const createdAt = Date.now() - ageDays * day;
  db.db.prepare("UPDATE trace_events SET created_at = ? WHERE id = ?").run(createdAt, event.id);
  return event.id;
}

function addMemoryOmission(workspaceId: string, ageDays: number, omittedReason: string) {
  const event = db.addTraceEvent({
    workspaceId,
    targetKind: "flow_run",
    targetId: `memory-target-${ageDays}-${Math.random()}`,
    type: "run_start",
    target: "memory injection",
    status: "running",
    payload: {
      memoryInjection: {
        requested: true,
        targetScope: "workflow",
        injected: false,
        promptHash: null,
        charCount: 0,
        tokenEstimate: 0,
        sourceCount: 1,
        sources: [{ kind: "rules", label: "Rules", count: 1, updatedAt: null, charCount: 0, tokenEstimate: 0, promptHash: null, injected: false, omittedReason }],
      },
    },
  });
  db.db.prepare("UPDATE trace_events SET created_at = ? WHERE id = ?").run(Date.now() - ageDays * day, event.id);
}

test("empty workspace returns no trace inspection findings", () => {
  const workspace = db.createWorkspace("trace inspection empty");
  assert.deepEqual(db.listTraceInspectionFindings(workspace.id, 14), []);
});

test("detects failure_spike and error_type_spike from metadata only", () => {
  const workspace = db.createWorkspace("trace inspection spike");
  addFailedTrace(workspace.id, 20, { type: "validation_error" });
  for (let i = 0; i < 3; i++) addFailedTrace(workspace.id, 1, { type: "validation_error" });

  const findings = db.listTraceInspectionFindings(workspace.id, 14);
  assert.ok(findings.some((finding) => finding.kind === "failure_spike"));
  const errorTypeSpike = findings.find((finding) => finding.kind === "error_type_spike");
  assert.equal(errorTypeSpike?.evidence[0]?.errorType, "validation");
});

test("does not emit spike finding when current window matches baseline", () => {
  const workspace = db.createWorkspace("trace inspection no spike");
  for (let i = 0; i < 3; i++) addFailedTrace(workspace.id, 20, { type: "validation_error" });
  for (let i = 0; i < 3; i++) addFailedTrace(workspace.id, 1, { type: "validation_error" });

  const findings = db.listTraceInspectionFindings(workspace.id, 14);
  assert.equal(findings.some((finding) => finding.kind === "failure_spike"), false);
});

test("detects repeated_target_failure", () => {
  const workspace = db.createWorkspace("trace inspection repeated target");
  for (let i = 0; i < 3; i++) addFailedTrace(workspace.id, 1, { type: "runtime_error", targetKind: "flow", targetId: "flow-1" });

  const finding = db.listTraceInspectionFindings(workspace.id, 14).find((item) => item.kind === "repeated_target_failure");
  assert.equal(finding?.evidence[0]?.targetKind, "flow");
  assert.equal(finding?.evidence[0]?.targetId, "flow-1");
});

test("detects repeated memory_injection_omission", () => {
  const workspace = db.createWorkspace("trace inspection memory omission");
  for (let i = 0; i < 3; i++) addMemoryOmission(workspace.id, 1, "token budget exceeded");

  const finding = db.listTraceInspectionFindings(workspace.id, 14).find((item) => item.kind === "memory_injection_omission");
  assert.equal(finding?.count, 3);
  assert.equal(finding?.evidence[0]?.omittedReason, "token budget exceeded");
});

test("detects stale_open_failure and ignores fixed failures", () => {
  const workspace = db.createWorkspace("trace inspection stale open");
  addFailedTrace(workspace.id, 10, { type: "runtime_error", detail: "sensitive stdout raw row 123" });
  const openFinding = db.listTraceInspectionFindings(workspace.id, 14).find((item) => item.kind === "stale_open_failure");
  assert.equal(openFinding?.evidence[0]?.status, "open");

  const failure = db.listTraceFailures(workspace.id, 10, "open")[0];
  assert.ok(failure);
  db.updateTraceFailureStatus(workspace.id, failure.id, "fixed", "verified", "test");
  const findings = db.listTraceInspectionFindings(workspace.id, 14);
  assert.equal(findings.some((item) => item.kind === "stale_open_failure"), false);
});

test("findings never include raw detail text and clamp days to 90", () => {
  const workspace = db.createWorkspace("trace inspection safe evidence");
  for (let i = 0; i < 3; i++) addFailedTrace(workspace.id, 1, { type: "validation_error", detail: "raw row stderr phone 13800000000" });

  const findings = db.listTraceInspectionFindings(workspace.id, 999);
  assert.equal(findings[0]?.window.days, 90);
  const serialized = JSON.stringify(findings);
  assert.equal(serialized.includes("13800000000"), false);
  assert.equal(serialized.includes("raw row"), false);
  assert.equal(serialized.includes("stderr"), false);
});
