import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

process.env.XANTHIL_DATA_DIR = mkdtempSync(join(tmpdir(), "pi-xanthil-tool-run-ledger-test-"));

const db = await import("./db.ts");

test("listToolRuns returns sanitized success ledger fields", () => {
  const workspace = db.createWorkspace("tool ledger success");
  db.addTraceEvent({
    workspaceId: workspace.id,
    targetKind: "extraction_tool",
    targetId: "duckdb-aggregate",
    type: "tool_run",
    target: "DuckDB Aggregate",
    status: "success",
    detail: "ok",
    payload: {
      runId: "run-success",
      toolId: "duckdb-aggregate",
      caller: "mcp",
      source: "ai",
      targetKind: "session",
      targetId: "s1",
      inputPathKind: "clean_data",
      inputPathBasename: "sales.csv",
      outputArtifacts: ["result.csv"],
      success: 1,
      failed: 0,
      rowGuard: { blocked: false },
      metricSnapshotsCount: 2,
      durationMs: 12,
    },
  });

  const [run] = db.listToolRuns(workspace.id, { toolId: "duckdb-aggregate", caller: "mcp", source: "ai", status: "success", limit: 10 });
  assert.ok(run);
  assert.equal(run.runId, "run-success");
  assert.equal(run.workspaceId, workspace.id);
  assert.equal(run.toolId, "duckdb-aggregate");
  assert.equal(run.caller, "mcp");
  assert.equal(run.source, "ai");
  assert.equal(run.targetKind, "session");
  assert.equal(run.targetId, "s1");
  assert.equal(run.inputPathKind, "clean_data");
  assert.equal(run.inputPathBasename, "sales.csv");
  assert.deepEqual(run.outputArtifacts, ["result.csv"]);
  assert.deepEqual(run.rowGuard, { blocked: false });
  assert.equal(run.metricSnapshotsCount, 2);
  assert.equal(run.errorCode, null);
});

test("listToolRuns records failed row guard and isolates workspaces", () => {
  const workspace = db.createWorkspace("tool ledger failure");
  const other = db.createWorkspace("tool ledger other");
  db.addTraceEvent({
    workspaceId: workspace.id,
    targetKind: "extraction_tool",
    targetId: "duckdb-aggregate",
    type: "tool_run",
    target: "DuckDB Aggregate",
    status: "failed",
    detail: "row guard",
    payload: {
      runId: "run-guard",
      toolId: "duckdb-aggregate",
      caller: "chat",
      source: "ai",
      inputPath: "/secret/raw/customer-level.csv",
      inputPathKind: "clean_data",
      outputArtifacts: [],
      failed: 1,
      rowGuard: { blocked: true, rowLimit: 100, maxRowsSeen: 101 },
      metricSnapshotsCount: 0,
      errorCode: "row_guard",
    },
  });
  db.addTraceEvent({
    workspaceId: other.id,
    targetKind: "extraction_tool",
    targetId: "duckdb-aggregate",
    type: "tool_run",
    target: "DuckDB Aggregate",
    status: "success",
    detail: "other",
    payload: { runId: "other-run", toolId: "duckdb-aggregate", caller: "manual", source: "manual" },
  });

  const failed = db.listToolRuns(workspace.id, { status: "failed", caller: "chat", limit: 10 });
  assert.equal(failed.length, 1);
  assert.equal(failed[0]!.runId, "run-guard");
  assert.equal(failed[0]!.inputPathBasename, "customer-level.csv");
  assert.equal(failed[0]!.errorCode, "row_guard");
  assert.deepEqual(failed[0]!.rowGuard, { blocked: true, rowLimit: 100, maxRowsSeen: 101 });

  const otherRuns = db.listToolRuns(other.id, { limit: 10 });
  assert.equal(otherRuns.length, 1);
  assert.equal(otherRuns[0]!.runId, "other-run");
});

test("listToolRuns exposes validation failures without raw paths", () => {
  const workspace = db.createWorkspace("tool ledger validation");
  db.addTraceEvent({
    workspaceId: workspace.id,
    targetKind: "extraction_tool",
    targetId: "duckdb-aggregate",
    type: "tool_run",
    target: "DuckDB Aggregate",
    status: "failed",
    detail: "parameter sql is required",
    payload: {
      runId: "run-validation",
      toolId: "duckdb-aggregate",
      caller: "chat",
      source: "ai",
      targetKind: "session",
      targetId: "s2",
      inputPathKind: "clean_data",
      inputPathBasename: "sales.csv",
      outputArtifacts: [],
      status: "failed",
      errorCode: "validation_error",
      metricSnapshotsCount: 0,
    },
  });

  const [run] = db.listToolRuns(workspace.id, { status: "failed", caller: "chat", source: "ai", limit: 10 });
  assert.ok(run);
  assert.equal(run.runId, "run-validation");
  assert.equal(run.errorCode, "validation_error");
  assert.equal(run.inputPathBasename, "sales.csv");
  assert.equal(run.inputPathKind, "clean_data");
  assert.deepEqual(run.outputArtifacts, []);
  assert.equal(run.durationMs, null);
});
