import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

process.env.XANTHIL_DATA_DIR = mkdtempSync(join(tmpdir(), "pi-xanthil-trace-detail-test-"));

const db = await import("./db.ts");

test("getTraceEventDetail returns event target, bounded timeline, related failures and deterministic summary", () => {
  const workspace = db.createWorkspace("trace detail");
  const session = db.createSession(workspace.id, "trace detail session");
  db.addTraceEvent({
    workspaceId: workspace.id,
    targetKind: "session",
    targetId: session.id,
    type: "tool_call",
    target: session.title,
    status: "success",
    detail: "checked output folder",
  });
  const failed = db.addTraceEvent({
    workspaceId: workspace.id,
    targetKind: "session",
    targetId: session.id,
    type: "message_error",
    target: session.title,
    status: "failed",
    detail: "path missing: report output directory not found",
  });

  const detail = db.getTraceEventDetail(workspace.id, failed.id, { beforeLimit: 1, afterLimit: 1 });

  assert.ok(detail);
  assert.equal(detail.event.id, failed.id);
  assert.equal(detail.target.label, session.title);
  assert.equal(detail.timelineBefore.length, 1);
  assert.ok(detail.relatedFailures.some((failure) => failure.source === "message_error"));
  assert.match(detail.diagnosticSummary, /path_missing/);
  assert.equal(detail.safetyLevel, "safe_metadata");
});

test("getTraceEventDetail enforces workspace isolation", () => {
  const owner = db.createWorkspace("trace detail owner");
  const other = db.createWorkspace("trace detail other");
  const event = db.addTraceEvent({
    workspaceId: owner.id,
    targetKind: "session",
    targetId: "session-1",
    type: "message_error",
    target: "owner session",
    status: "failed",
    detail: "runtime failed",
  });

  assert.equal(db.getTraceEventDetail(other.id, event.id), null);
});

test("getTraceEventDetail clamps timeline limits", () => {
  const workspace = db.createWorkspace("trace detail limit");
  const session = db.createSession(workspace.id, "trace detail limit session");
  let lastEventId = "";
  for (let index = 0; index < 24; index += 1) {
    const event = db.addTraceEvent({
      workspaceId: workspace.id,
      targetKind: "session",
      targetId: session.id,
      type: "tool_call",
      target: session.title,
      status: "success",
      detail: `step ${index}`,
    });
    lastEventId = event.id;
  }

  const detail = db.getTraceEventDetail(workspace.id, lastEventId, { beforeLimit: 999, afterLimit: 999 });

  assert.ok(detail);
  assert.ok(detail.timelineBefore.length <= 10);
  assert.ok(detail.timelineAfter.length <= 10);
});

test("getTraceEventDetail redacts sensitive detail and related failure text", () => {
  const workspace = db.createWorkspace("trace detail safety");
  const session = db.createSession(workspace.id, "trace detail safety session");
  const event = db.addTraceEvent({
    workspaceId: workspace.id,
    targetKind: "session",
    targetId: session.id,
    type: "message_error",
    target: session.title,
    status: "failed",
    detail: "draw_data raw row customer_id=123 order_id=456 should never be returned",
  });

  const detail = db.getTraceEventDetail(workspace.id, event.id);

  assert.ok(detail);
  assert.equal(detail.event.detail, null);
  assert.equal(detail.safetyLevel, "redacted_detail");
  assert.doesNotMatch(JSON.stringify(detail), /customer_id|order_id|raw row/);
});
