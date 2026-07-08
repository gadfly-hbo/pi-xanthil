import assert from "node:assert/strict";
import test from "node:test";
import type { ToolAiExposure } from "./types.ts";
import {
  applyDeprecatedFilter,
  applyRiskLevelCap,
  canExposeTo,
  checkToolPolicy,
  deriveAiExposure,
  deriveOutputContract,
  filterAiExposedTools,
  getEffectiveAiExposure,
  getToolGovernanceWarnings,
  isAiExposedTool,
  isToolBindable,
  listAiExposedToolIds,
  renderToolManifestSummary,
  validateToolReplacement,
} from "./tool-policy.ts";

const analysis = {
  id: "analysis-tool",
  category: "analysis" as const,
  tags: ["cohort", "retention"],
  riskLevel: "L1" as const,
  allowedUse: "aggregate metrics",
  forbiddenUse: "raw rows",
  outputContract: undefined,
};

const ingestion = { id: "ingestion-tool", category: "ingestion" as const };

const explicitManual = {
  id: "manual-only-tool",
  category: "analysis" as const,
  aiExposure: ["manual_confirmed"] as ToolAiExposure[],
};

const explicitEmpty = {
  id: "explicit-empty-tool",
  category: "analysis" as const,
  aiExposure: [] as ToolAiExposure[],
};

const deprecatedAnalysis = {
  id: "deprecated-analysis-tool",
  category: "analysis" as const,
  deprecated: true,
  replacementToolId: "analysis-tool",
};

const l2Analysis = {
  id: "l2-analysis-tool",
  category: "analysis" as const,
  riskLevel: "L2" as const,
};

const l3Analysis = {
  id: "l3-analysis-tool",
  category: "analysis" as const,
  riskLevel: "L3" as const,
};

const rowLevelTool = {
  id: "row-level-tool",
  category: "analysis" as const,
  outputContract: { tableShape: "row_level" as const },
};

const unknownShapeTool = {
  id: "unknown-shape-tool",
  category: "analysis" as const,
  outputContract: { tableShape: "unknown" as const },
};

test("tool policy exposes only analysis tools to AI surfaces by default", () => {
  assert.equal(isAiExposedTool(analysis), true);
  assert.equal(isToolBindable(analysis), true);
  assert.equal(isAiExposedTool(ingestion), false);
  assert.equal(isToolBindable(ingestion), false);
  assert.deepEqual(filterAiExposedTools([analysis, ingestion]).map((tool) => tool.id), ["analysis-tool"]);
  assert.deepEqual([...listAiExposedToolIds([analysis, ingestion])], ["analysis-tool"]);
});

test("explicit aiExposure fully overrides category derivation", () => {
  assert.deepEqual(deriveAiExposure(explicitManual), ["manual_confirmed"]);
  assert.equal(isAiExposedTool(explicitManual), false); // manual_confirmed 不算自动化入口
  assert.equal(canExposeTo(explicitManual, "manual_confirmed"), true);
  assert.equal(canExposeTo(explicitManual, "mcp"), false);
  assert.deepEqual(deriveAiExposure(explicitEmpty), []);
  assert.equal(isAiExposedTool(explicitEmpty), false);
});

test("deprecated tools keep manual_confirmed and eval only, not automation candidates", () => {
  const effective = getEffectiveAiExposure(deprecatedAnalysis);
  assert.deepEqual(effective, ["manual_confirmed", "eval"]);
  assert.equal(isAiExposedTool(deprecatedAnalysis), false); // eval 不算自动化候选
  assert.equal(isToolBindable(deprecatedAnalysis), false);
  assert.equal(canExposeTo(deprecatedAnalysis, "mcp"), false);
  assert.equal(canExposeTo(deprecatedAnalysis, "command"), false);
  assert.equal(canExposeTo(deprecatedAnalysis, "manual_confirmed"), true);
  assert.equal(canExposeTo(deprecatedAnalysis, "eval"), true);
});

test("riskLevel L2 blocks mcp", () => {
  const effective = getEffectiveAiExposure(l2Analysis);
  assert.equal(effective.includes("mcp"), false);
  assert.equal(effective.includes("command"), true);
  assert.equal(isAiExposedTool(l2Analysis), true);
  assert.equal(canExposeTo(l2Analysis, "mcp"), false);
  assert.equal(canExposeTo(l2Analysis, "subagent"), true);
});

test("riskLevel L3 only allows manual_confirmed and eval, excluding automation candidates", () => {
  const effective = getEffectiveAiExposure(l3Analysis);
  assert.deepEqual(effective, ["manual_confirmed", "eval"]);
  assert.equal(isAiExposedTool(l3Analysis), false); // eval 不算自动化候选
  assert.equal(isToolBindable(l3Analysis), false);
  assert.equal(canExposeTo(l3Analysis, "mcp"), false);
  assert.equal(canExposeTo(l3Analysis, "command"), false);
  assert.equal(canExposeTo(l3Analysis, "manual_confirmed"), true);
  assert.equal(canExposeTo(l3Analysis, "eval"), true);
});

test("eval-only tool can expose to eval but is not an automation candidate", () => {
  const evalOnly = {
    id: "eval-only-tool",
    category: "analysis" as const,
    aiExposure: ["eval"] as ToolAiExposure[],
  };
  assert.equal(isAiExposedTool(evalOnly), false);
  assert.equal(isToolBindable(evalOnly), false);
  assert.equal(canExposeTo(evalOnly, "eval"), true);
  assert.equal(canExposeTo(evalOnly, "mcp"), false);
});

test("listAiExposedToolIds excludes deprecated and L3 tools even if eval remains", () => {
  const tools = [analysis, deprecatedAnalysis, l3Analysis, l2Analysis];
  assert.deepEqual([...listAiExposedToolIds(tools)].sort(), ["analysis-tool", "l2-analysis-tool"]);
  assert.deepEqual(filterAiExposedTools(tools).map((tool) => tool.id).sort(), ["analysis-tool", "l2-analysis-tool"]);
});

test("renderToolManifestSummary includes compact tags and policy", () => {
  const summary = renderToolManifestSummary(analysis);
  assert.match(summary, /tags=cohort,retention/);
  assert.match(summary, /risk=L1/);
  assert.match(summary, /适用: aggregate metrics/);
  assert.match(summary, /禁止: raw rows/);
});

test("renderToolManifestSummary includes deprecated and replacement", () => {
  const summary = renderToolManifestSummary(deprecatedAnalysis);
  assert.match(summary, /deprecated=true/);
  assert.match(summary, /replacement=analysis-tool/);
});

test("deriveOutputContract defaults to unknown", () => {
  assert.deepEqual(deriveOutputContract(analysis), { tableShape: "unknown" });
  assert.deepEqual(deriveOutputContract(rowLevelTool), { tableShape: "row_level" });
});

test("checkToolPolicy blocks unknown output for autonomous MCP/subagent", () => {
  const mcpCheck = checkToolPolicy(unknownShapeTool, "mcp");
  assert.equal(mcpCheck.allowed, false);
  assert.ok(mcpCheck.blockers.some((b) => b.includes("unknown output shape")));

  const subagentCheck = checkToolPolicy(unknownShapeTool, "subagent");
  assert.equal(subagentCheck.allowed, false);
});

test("checkToolPolicy allows unknown output with llmSafeSummary", () => {
  const safeTool = { ...unknownShapeTool, outputContract: { tableShape: "unknown" as const, llmSafeSummary: true } };
  const mcpCheck = checkToolPolicy(safeTool, "mcp");
  assert.equal(mcpCheck.allowed, true);
  assert.equal(mcpCheck.blockers.length, 0);
});

test("checkToolPolicy blocks row-level output for autonomous MCP/subagent", () => {
  const mcpCheck = checkToolPolicy(rowLevelTool, "mcp");
  assert.equal(mcpCheck.allowed, false);
  assert.ok(mcpCheck.blockers.some((b) => b.includes("row-level output")));

  const subagentCheck = checkToolPolicy(rowLevelTool, "subagent");
  assert.equal(subagentCheck.allowed, false);
});

test("checkToolPolicy allows command/workflow with warning", () => {
  const commandCheck = checkToolPolicy(unknownShapeTool, "command");
  assert.equal(commandCheck.allowed, true);
  assert.ok(commandCheck.warnings.some((w) => w.includes("artifact content must not be injected")));

  const workflowCheck = checkToolPolicy(rowLevelTool, "workflow");
  assert.equal(workflowCheck.allowed, true);
  assert.ok(workflowCheck.warnings.some((w) => w.includes("row_level")));
});

test("validateToolReplacement warns on missing or deprecated replacement", () => {
  const allTools = [analysis, deprecatedAnalysis];
  assert.deepEqual(validateToolReplacement(deprecatedAnalysis, allTools), []);

  const missingReplacement = { id: "bad", replacementToolId: "missing-tool" };
  const warnings = validateToolReplacement(missingReplacement, allTools);
  assert.equal(warnings.length, 1);
  assert.ok(warnings[0]?.includes("missing replacement"));

  const deprecatedReplacement = { id: "bad2", replacementToolId: "deprecated-analysis-tool" };
  const warnings2 = validateToolReplacement(deprecatedReplacement, allTools);
  assert.equal(warnings2.length, 1);
  assert.ok(warnings2[0]?.includes("deprecated replacement"));
});

test("getToolGovernanceWarnings reports riskLevel and deprecated conflicts", () => {
  const warnings = getToolGovernanceWarnings(l2Analysis);
  assert.ok(warnings.some((w) => w.includes("riskLevel=L2 removes exposures: mcp")));

  const depWarnings = getToolGovernanceWarnings(deprecatedAnalysis);
  assert.ok(depWarnings.some((w) => w.includes("deprecated and removes automation exposures")));
});
