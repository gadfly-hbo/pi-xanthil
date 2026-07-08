import assert from "node:assert/strict";
import test from "node:test";
import type { ToolRecommendationManifest } from "./tool-recommendation.ts";
import {
  aggregateToolLabStats,
  aggregateToolRunLedgerStats,
  buildPathContext,
  recommendTools,
} from "./tool-recommendation.ts";

const baseTool: ToolRecommendationManifest = {
  id: "duckdb-aggregate",
  category: "analysis",
  tags: ["aggregate", "csv"],
  aiExposure: ["mcp", "command", "subagent", "workflow", "manual_confirmed"],
  riskLevel: "L1",
  outputContract: { tableShape: "aggregate" },
  inputAccept: [".csv", ".tsv"],
  allowedUse: "aggregate metrics from clean_data",
};

const rowLevelTool: ToolRecommendationManifest = {
  id: "row-level-inspector",
  category: "analysis",
  tags: ["row", "detail"],
  aiExposure: ["command", "manual_confirmed"],
  riskLevel: "L2",
  outputContract: { tableShape: "row_level" },
  inputAccept: [".csv"],
};

const deprecatedTool: ToolRecommendationManifest = {
  id: "old-aggregate",
  category: "analysis",
  tags: ["aggregate"],
  aiExposure: ["mcp", "command", "manual_confirmed"],
  deprecated: true,
  replacementToolId: "duckdb-aggregate",
  outputContract: { tableShape: "aggregate" },
  inputAccept: [".csv"],
};

const l3Tool: ToolRecommendationManifest = {
  id: "l3-sensitive",
  category: "analysis",
  tags: ["sensitive"],
  aiExposure: ["manual_confirmed"],
  riskLevel: "L3",
  inputAccept: [".csv"],
};

const ingestionTool: ToolRecommendationManifest = {
  id: "csv-ingestion",
  category: "ingestion",
  inputAccept: [".csv"],
};

test("recommendTools returns tag/allowedUse/input extension matches first", () => {
  const result = recommendTools({
    entry: "mcp",
    intent: "aggregate csv metrics",
    tools: [baseTool, rowLevelTool, ingestionTool],
    pathContext: buildPathContext([
      { path: "/ws/clean_data/sales.csv", folder: "clean_data", kind: "file" },
      { path: "/ws/clean_data", folder: "clean_data", kind: "dir" },
    ]),
  });

  assert.equal(result.entry, "mcp");
  assert.equal(result.blockers.length, 0);
  assert.equal(result.candidates[0]?.toolId, "duckdb-aggregate");
  assert.ok(
    result.candidates[0]?.reasons.some((r) => r.includes("tag match")),
    "expected tag match reason"
  );
  assert.ok(
    result.candidates[0]?.reasons.some((r) => r.includes("input format match")),
    "expected input format match reason"
  );
  assert.ok(
    result.candidates[0]?.reasons.some((r) => r.includes("use-case match")),
    "expected use-case match reason"
  );
});

test("recommendTools filters out tools not exposed to entry", () => {
  const result = recommendTools({
    entry: "mcp",
    tools: [baseTool, rowLevelTool, ingestionTool],
  });

  assert.ok(result.candidates.every((c) => c.toolId !== "row-level-inspector"));
  assert.ok(result.candidates.every((c) => c.toolId !== "csv-ingestion"));
  assert.equal(result.candidates[0]?.toolId, "duckdb-aggregate");
});

test("recommendTools blocks deprecated tools from automated entry", () => {
  const result = recommendTools({
    entry: "mcp",
    tools: [deprecatedTool, baseTool],
  });

  assert.ok(result.candidates.every((c) => c.toolId !== "old-aggregate"));
  const deprecated = result.candidates.find((c) => c.toolId === "old-aggregate");
  assert.equal(deprecated, undefined);
  const blockerResult = recommendTools({
    entry: "mcp",
    tools: [deprecatedTool],
  });
  assert.equal(blockerResult.candidates.length, 0);
  assert.ok(
    blockerResult.blockers.some((b) =>
      b.includes("deprecated and cannot be recommended")
    )
  );
});

test("recommendTools blocks L3 and row-level for autonomous MCP", () => {
  const result = recommendTools({
    entry: "mcp",
    tools: [l3Tool, rowLevelTool],
    pathContext: buildPathContext([
      { path: "/ws/clean_data/sales.csv", folder: "clean_data", kind: "file" },
    ]),
  });

  assert.equal(result.candidates.length, 0);
  assert.ok(
    result.blockers.some((b) => b.includes("not exposed to mcp")),
    "expected not exposed blocker"
  );
  assert.ok(
    result.blockers.some((b) =>
      b.includes("row-level output and cannot be used")
    ),
    "expected row-level blocker"
  );
});

test("recommendTools returns manual_confirmed for deprecated/L3 tools", () => {
  const result = recommendTools({
    entry: "manual_confirmed",
    tools: [deprecatedTool, l3Tool],
  });

  assert.equal(result.candidates.length, 2);
  assert.ok(result.candidates.every((c) => c.allowed));
  // deprecated/L3 工具在 manual_confirmed 下允许，但 reasons 中保留提醒
  assert.ok(
    result.candidates.some((c) =>
      c.toolId === "old-aggregate" ? c.reasons.some((r) => r.includes("deprecated")) : false
    )
  );
});

test("recommendTools returns empty with blocker when no compliant candidates", () => {
  const result = recommendTools({
    entry: "mcp",
    tools: [ingestionTool],
  });

  assert.equal(result.candidates.length, 0);
  assert.ok(result.blockers.length > 0);
  assert.ok(result.blockers.some((b) => b.includes("no compliant") || b.includes("not exposed")));
});

test("recommendTools rejects invalid entry", () => {
  const result = recommendTools({
    entry: "invalid" as any,
    tools: [baseTool],
  });

  assert.equal(result.candidates.length, 0);
  assert.ok(result.blockers[0]?.includes("invalid entry"));
});

test("ledger stats boost tools with higher success rate", () => {
  const result = recommendTools({
    entry: "command",
    intent: "aggregate",
    tools: [baseTool, rowLevelTool],
    ledgerStats: {
      "duckdb-aggregate": {
        totalRuns: 10,
        successRuns: 9,
        failedRuns: 1,
        lastRunAt: 1,
        lastStatus: "success",
      },
      "row-level-inspector": {
        totalRuns: 10,
        successRuns: 5,
        failedRuns: 5,
        lastRunAt: 2,
        lastStatus: "failed",
      },
    },
  });

  assert.equal(result.candidates[0]?.toolId, "duckdb-aggregate");
  assert.ok(
    result.candidates[0]?.reasons.some((r) => r.includes("ledger 9/10 success"))
  );
  assert.ok(
    result.candidates[1]?.warnings.some((w) => w.includes("last ledger run failed"))
  );
});

test("tool lab stats boost tools with higher pass rate", () => {
  const result = recommendTools({
    entry: "command",
    intent: "aggregate",
    tools: [baseTool, rowLevelTool],
    toolLabStats: {
      "duckdb-aggregate": {
        total: 4,
        success: 4,
        failed: 0,
        lastEvaluationAt: 1,
      },
      "row-level-inspector": {
        total: 4,
        success: 1,
        failed: 3,
        lastEvaluationAt: 2,
      },
    },
  });

  assert.equal(result.candidates[0]?.toolId, "duckdb-aggregate");
  assert.ok(
    result.candidates[0]?.reasons.some((r) => r.includes("lab 4/4 pass"))
  );
});

test("aggregateToolRunLedgerStats groups by toolId and computes totals", () => {
  const stats = aggregateToolRunLedgerStats([
    { toolId: "a", status: "success", time: 1 },
    { toolId: "a", status: "failed", time: 2 },
    { toolId: "b", status: "success", time: 3 },
  ]);

  assert.equal(stats["a"]?.totalRuns, 2);
  assert.equal(stats["a"]?.successRuns, 1);
  assert.equal(stats["a"]?.failedRuns, 1);
  assert.equal(stats["a"]?.lastStatus, "failed");
  assert.equal(stats["b"]?.totalRuns, 1);
  assert.equal(stats["b"]?.lastStatus, "success");
});

test("aggregateToolLabStats groups by toolId", () => {
  const stats = aggregateToolLabStats([
    { toolId: "a", status: "success", startedAt: 1 },
    { toolId: "a", status: "failed", startedAt: 2 },
    { toolId: "b", status: "success", startedAt: 3 },
  ]);

  assert.equal(stats["a"]?.total, 2);
  assert.equal(stats["a"]?.success, 1);
  assert.equal(stats["a"]?.failed, 1);
  assert.equal(stats["a"]?.lastEvaluationAt, 2);
  assert.equal(stats["b"]?.total, 1);
});

test("buildPathContext extracts extensions and directory categories", () => {
  const ctx = buildPathContext([
    { path: "/ws/clean_data/sales.csv", folder: "clean_data", kind: "file" },
    { path: "/ws/clean_data/products.tsv", folder: "clean_data", kind: "file" },
    { path: "/ws/clean_data/retention", folder: "clean_data", kind: "dir" },
  ]);

  assert.deepEqual(ctx.extensions.sort(), [".csv", ".tsv"]);
  assert.deepEqual(ctx.folderKinds, ["clean_data"]);
  assert.deepEqual(ctx.dirCategories, ["retention"]);
});

test("recommendTools does not read file content or draw_data rows", () => {
  // 纯函数边界：输入只包含元数据，函数不访问 fs 或 LLM。
  const result = recommendTools({
    entry: "mcp",
    intent: "aggregate csv",
    tools: [baseTool],
    pathContext: buildPathContext([
      { path: "/ws/draw_data/secret.csv", folder: "draw_data", kind: "file" },
    ]),
  });

  assert.equal(result.candidates.length, 1);
  assert.ok(result.candidates[0]?.reasons.some((r) => r.includes("input format match")));
  assert.ok(result.candidates[0]?.reasons.every((r) => !r.includes("secret")));
});

// 空 pathContext 不应导致崩溃，且不应把 draw_data 内容带进 reasons。
test("recommendTools handles missing pathContext and ledger gracefully", () => {
  const result = recommendTools({
    entry: "command",
    tools: [baseTool],
  });

  assert.equal(result.candidates.length, 1);
  assert.equal(result.candidates[0]?.toolId, "duckdb-aggregate");
  assert.equal(result.candidates[0]?.allowed, true);
});

// 未声明 riskLevel 时 scorer 给出默认理由。
test("recommendTools reports unset risk level", () => {
  const tool: ToolRecommendationManifest = { id: "no-risk", category: "analysis", inputAccept: [".csv"] };
  const result = recommendTools({
    entry: "command",
    tools: [tool],
  });

  assert.equal(result.candidates.length, 1);
  assert.ok(
    result.candidates[0]?.reasons.some((r) => r.includes("risk level unset"))
  );
});
