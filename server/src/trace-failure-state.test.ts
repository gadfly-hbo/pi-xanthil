import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

process.env.XANTHIL_DATA_DIR = mkdtempSync(join(tmpdir(), "pi-xanthil-trace-failure-state-test-"));

const db = await import("./db.ts");

test("trace failures default to open and can be updated", () => {
  const workspace = db.createWorkspace("trace failure state");
  db.addTraceEvent({
    workspaceId: workspace.id,
    targetKind: "session",
    targetId: "session-1",
    type: "message_error",
    target: "failure session",
    status: "failed",
    detail: "validation failed: required field missing",
  });

  const failure = db.listTraceFailures(workspace.id, 10)[0];
  assert.ok(failure);
  assert.equal(failure.status, "open");

  const updated = db.updateTraceFailureStatus(workspace.id, failure.id, "fixed", "patched validation guard", "test");
  assert.ok(updated);
  assert.equal(updated.status, "fixed");
  assert.equal(updated.statusNote, "patched validation guard");
  assert.equal(updated.statusActor, "test");
  assert.ok(updated.statusUpdatedAt);

  assert.equal(db.listTraceFailures(workspace.id, 10, "open").length, 0);
  assert.equal(db.listTraceFailures(workspace.id, 10, "fixed")[0]?.id, failure.id);
});

test("trace failure status update is workspace isolated", () => {
  const owner = db.createWorkspace("trace failure owner");
  const other = db.createWorkspace("trace failure other");
  db.addTraceEvent({
    workspaceId: owner.id,
    targetKind: "session",
    targetId: "session-1",
    type: "message_error",
    target: "owner failure",
    status: "failed",
    detail: "runtime failed",
  });
  const failure = db.listTraceFailures(owner.id, 10)[0];
  assert.ok(failure);

  assert.equal(db.updateTraceFailureStatus(other.id, failure.id, "ignored", "wrong workspace", "test"), null);
  assert.equal(db.listTraceFailures(owner.id, 10)[0]?.status, "open");
});
