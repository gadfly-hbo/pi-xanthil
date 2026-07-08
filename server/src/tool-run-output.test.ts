import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import {
  adaptToolRunOutput,
  buildArtifactsFromOutputs,
  buildLegacyCompatibleResponse,
  checkRunPolicy,
  isNativeToolRunOutput,
  mapCallerToExposure,
  validateToolRunOutput,
  type AdapterContext,
} from "./tool-run-output.ts";
import type { MetricSnapshot, ToolRunOutput } from "./types.ts";

function makeCtx(partial: Partial<AdapterContext> = {}): AdapterContext {
  return {
    runId: "run-1",
    toolId: "test-tool",
    toolName: "测试工具",
    outputDir: "/tmp/out",
    summary: {},
    stdout: "",
    stderr: "",
    durationMs: 100,
    error: null,
    rowGuard: { blocked: false },
    caller: "manual",
    source: "manual",
    ...partial,
  };
}

function makeMetric(name: string, value: number): MetricSnapshot {
  return {
    name,
    value,
    period: "2026-06",
    status: "normal",
    source: "extraction_tool",
    evidenceLevel: "A",
  };
}

test("isNativeToolRunOutput: recognizes native shape", () => {
  assert.equal(isNativeToolRunOutput({ success: 1, failed: 0 }), false);
  assert.equal(
    isNativeToolRunOutput({
      status: "success",
      summary: "ok",
      metrics: [],
      artifacts: [],
      rowGuard: { blocked: false },
    }),
    true,
  );
  assert.equal(
    isNativeToolRunOutput({
      status: "failed",
      summary: "error",
      metrics: [makeMetric("x", 1)],
      artifacts: [{ id: "a1", title: "report", basename: "r.md", relPath: "r.md", kind: "report" }],
      rowGuard: null,
    }),
    true,
  );
});

test("validateToolRunOutput: accepts valid output", () => {
  const out: ToolRunOutput = {
    runId: "run-1",
    toolId: "t1",
    toolName: "T1",
    status: "success",
    summary: "ok",
    metrics: [makeMetric("x", 1)],
    artifacts: [{ id: "a1", title: "report", basename: "r.md", relPath: "r.md", kind: "report" }],
    rowGuard: { blocked: false },
  };
  const { valid, errors } = validateToolRunOutput(out, "/tmp/out");
  assert.equal(valid, true);
  assert.deepEqual(errors, []);
});

test("validateToolRunOutput: rejects missing fields", () => {
  const { valid, errors } = validateToolRunOutput({ summary: "ok" } as unknown as ToolRunOutput, "/tmp/out");
  assert.equal(valid, false);
  assert.ok(errors.some((e) => e.includes("runId")));
  assert.ok(errors.some((e) => e.includes("toolId")));
  assert.ok(errors.some((e) => e.includes("status")));
  assert.ok(errors.some((e) => e.includes("metrics")));
  assert.ok(errors.some((e) => e.includes("artifacts")));
});

test("validateToolRunOutput: rejects invalid metric snapshot", () => {
  const out: ToolRunOutput = {
    runId: "run-1",
    toolId: "t1",
    toolName: "T1",
    status: "success",
    summary: "ok",
    metrics: [{ name: "x" } as MetricSnapshot],
    artifacts: [],
    rowGuard: { blocked: false },
  };
  const { valid, errors } = validateToolRunOutput(out, "/tmp/out");
  assert.equal(valid, false);
  assert.ok(errors.some((e) => e.includes("metrics[0]")));
});

test("buildArtifactsFromOutputs: converts absolute paths inside outputDir", () => {
  const dir = mkdtempSync(join(tmpdir(), "tro-test-"));
  const inside = join(dir, "nested", "report.md");
  mkdirSync(join(dir, "nested"), { recursive: true });
  writeFileSync(inside, "# r");
  const outside = join(tmpdir(), "outside.json");
  writeFileSync(outside, "{}");

  const { artifacts, errors } = buildArtifactsFromOutputs([inside, outside, inside], dir);
  assert.equal(artifacts.length, 2); // duplicates deduped by caller via Set, but here we keep both
  assert.equal(errors.length, 1);
  assert.ok(errors[0]?.includes("outside output directory"));
  const a = artifacts[0];
  assert.equal(a?.basename, "report.md");
  assert.equal(a?.relPath, join("nested", "report.md"));
  assert.equal(a?.kind, "report");
});

test("buildArtifactsFromOutputs: rejects path traversal", () => {
  const dir = "/tmp/out";
  const { artifacts, errors } = buildArtifactsFromOutputs(["/tmp/out/../etc/passwd"], dir);
  assert.equal(artifacts.length, 0);
  assert.equal(errors.length, 1);
  assert.ok(errors[0]?.includes("outside output directory"));
});

test("adaptToolRunOutput: legacy summary conversion", () => {
  const result = adaptToolRunOutput(
    makeCtx({
      summary: {
        success: 1,
        failed: 0,
        results: [{ file: "data.csv", outputs: ["/tmp/out/data_report.md"] }],
      },
      outputDir: "/tmp/out",
      outputContract: { tableShape: "aggregate", llmSafeSummary: true },
    }),
  );
  assert.equal(result.blockers.length, 0);
  assert.equal(result.isNative, false);
  assert.equal(result.output.status, "success");
  assert.equal(result.output.summary, "成功 1 个文件；产出 data_report.md");
  assert.equal(result.output.artifacts.length, 1);
  assert.equal(result.output.artifacts[0]?.basename, "data_report.md");
  assert.ok(result.warnings.some((w) => w.includes("legacy summary.json adapter")));
});

test("adaptToolRunOutput: native ToolRunOutput pass-through", () => {
  const result = adaptToolRunOutput(
    makeCtx({
      summary: {
        status: "success",
        summary: "native ok",
        metrics: [makeMetric("m1", 42)],
        artifacts: [{ id: "a1", title: "r", basename: "r.md", relPath: "r.md", kind: "report" }],
        rowGuard: { blocked: false },
      },
      outputDir: "/tmp/out",
      outputContract: { tableShape: "aggregate", llmSafeSummary: true },
    }),
  );
  assert.equal(result.blockers.length, 0);
  assert.equal(result.isNative, true);
  assert.equal(result.output.status, "success");
  assert.equal(result.output.metrics.length, 1);
  assert.equal(result.output.metrics[0]?.value, 42);
  assert.ok(!result.warnings.some((w) => w.includes("legacy summary.json adapter")));
});

test("adaptToolRunOutput: artifact path traversal is rejected", () => {
  const result = adaptToolRunOutput(
    makeCtx({
      summary: {
        success: 1,
        failed: 0,
        results: [{ file: "data.csv", outputs: ["/tmp/out/../secret.json"] }],
      },
      outputDir: "/tmp/out",
      outputContract: { tableShape: "aggregate" },
    }),
  );
  assert.ok(result.blockers.some((b) => b.includes("outside output directory")));
});

test("adaptToolRunOutput: row guard conflict with aggregate contract is blocked", () => {
  const result = adaptToolRunOutput(
    makeCtx({
      summary: { status: "success", summary: "ok", metrics: [], artifacts: [], rowGuard: { blocked: true, rowLimit: 100, maxRowsSeen: 200 } },
      outputDir: "/tmp/out",
      outputContract: { tableShape: "aggregate" },
      rowGuard: { blocked: true, rowLimit: 100, maxRowsSeen: 200 },
    }),
  );
  assert.ok(result.blockers.some((b) => b.includes("row guard blocked") && b.includes("aggregate")));
});

test("adaptToolRunOutput: row_level contract allows row guard blocked", () => {
  const result = adaptToolRunOutput(
    makeCtx({
      summary: { status: "success", summary: "ok", metrics: [], artifacts: [], rowGuard: { blocked: true, rowLimit: 100, maxRowsSeen: 200 } },
      outputDir: "/tmp/out",
      outputContract: { tableShape: "row_level" },
      rowGuard: { blocked: true, rowLimit: 100, maxRowsSeen: 200 },
    }),
  );
  assert.ok(!result.blockers.some((b) => b.includes("row guard blocked")));
  assert.ok(result.warnings.some((w) => w.includes("row_level") && w.includes("artifact content must not be injected")));
});

test("adaptToolRunOutput: AI MCP blocks unknown shape without llmSafeSummary", () => {
  const result = adaptToolRunOutput(
    makeCtx({
      summary: { success: 1, failed: 0, results: [] },
      outputDir: "/tmp/out",
      outputContract: { tableShape: "unknown" },
      source: "ai",
      caller: "mcp",
    }),
  );
  assert.ok(result.blockers.some((b) => b.includes("unknown output shape")));
});

test("adaptToolRunOutput: deprecated tool blocks automation", () => {
  const result = adaptToolRunOutput(
    makeCtx({
      summary: { success: 1, failed: 0, results: [] },
      outputDir: "/tmp/out",
      outputContract: { tableShape: "aggregate" },
      source: "ai",
      caller: "mcp",
      category: "analysis",
      deprecated: true,
      aiExposure: ["manual_confirmed", "mcp"],
    }),
  );
  assert.ok(result.blockers.some((b) => b.includes("deprecated")));
});

test("mapCallerToExposure: maps source/caller correctly", () => {
  // source=manual 表示控制台直接调用，不进入 AI 入口 policy。
  assert.equal(mapCallerToExposure("manual", "manual"), null);
  assert.equal(mapCallerToExposure("mcp", "ai"), "mcp");
  assert.equal(mapCallerToExposure("workflow", "ai"), "workflow");
  assert.equal(mapCallerToExposure("chat", "ai"), "manual_confirmed");
  assert.equal(mapCallerToExposure("unknown", "ai"), null);
});

test("checkRunPolicy: L3 tool blocks automation", () => {
  const check = checkRunPolicy(
    { id: "t1", category: "analysis", riskLevel: "L3" },
    "mcp",
  );
  assert.equal(check.allowed, false);
  assert.ok(check.blockers.some((b) => b.includes("is not exposed to mcp")));
});

test("buildLegacyCompatibleResponse: preserves old fields", () => {
  const output: ToolRunOutput = {
    runId: "run-1",
    toolId: "t1",
    toolName: "T1",
    status: "success",
    summary: "ok",
    metrics: [],
    artifacts: [],
    rowGuard: { blocked: false },
  };
  const legacy = { success: 1, failed: 0, results: [{ file: "x.csv", outputs: ["x.md"] }] };
  const resp = buildLegacyCompatibleResponse(output, legacy, "stdout", "stderr");
  assert.equal(resp.runId, "run-1");
  assert.equal(resp.success, 1);
  assert.equal(resp.failed, 0);
  assert.equal(resp.stdout, "stdout");
});
