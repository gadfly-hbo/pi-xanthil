import assert from "node:assert/strict";
import test from "node:test";
import type { ExtractionToolManifest } from "../tools/registry.ts";
import {
  applyDeprecatedFilter,
  applyRiskLevelCap,
  deriveAiExposure,
  getEffectiveAiExposure,
  hasAutomationCandidateExposure,
} from "./tool-policy.ts";

test("deriveAiExposure analysis default equals v1 full set", () => {
  const tool = { category: "analysis" as const };
  const exposure = deriveAiExposure(tool);
  assert.deepEqual(exposure, [
    "manual_confirmed",
    "mcp",
    "command",
    "subagent",
    "workflow",
    "eval",
  ]);
});

test("deriveAiExposure ingestion default is empty", () => {
  const tool = { category: "ingestion" as const };
  assert.deepEqual(deriveAiExposure(tool), []);
});

test("deriveAiExposure explicit overrides category", () => {
  const tool: Pick<ExtractionToolManifest, "category" | "aiExposure"> = {
    category: "ingestion",
    aiExposure: ["mcp"],
  };
  assert.deepEqual(deriveAiExposure(tool), ["mcp"]);
});

test("applyRiskLevelCap L0 and L1 are no-ops", () => {
  const all = [
    "manual_confirmed",
    "mcp",
    "command",
    "subagent",
    "workflow",
    "eval",
  ] as const;
  assert.deepEqual(applyRiskLevelCap([...all], "L0"), [...all]);
  assert.deepEqual(applyRiskLevelCap([...all], "L1"), [...all]);
  assert.deepEqual(applyRiskLevelCap([...all], undefined), [...all]);
});

test("applyDeprecatedFilter removes automation but keeps manual and eval", () => {
  const all = [
    "manual_confirmed",
    "mcp",
    "command",
    "subagent",
    "workflow",
    "eval",
  ] as const;
  assert.deepEqual(applyDeprecatedFilter([...all], true), [
    "manual_confirmed",
    "eval",
  ]);
  assert.deepEqual(applyDeprecatedFilter([...all], false), [...all]);
  assert.deepEqual(applyDeprecatedFilter([...all], undefined), [...all]);
});

test("hasAutomationCandidateExposure ignores manual_confirmed and eval", () => {
  assert.equal(hasAutomationCandidateExposure(["manual_confirmed"]), false);
  assert.equal(hasAutomationCandidateExposure(["eval"]), false);
  assert.equal(hasAutomationCandidateExposure(["mcp"]), true);
  assert.equal(hasAutomationCandidateExposure(["mcp", "eval"]), true);
  assert.equal(hasAutomationCandidateExposure([]), false);
});

test("riskLevel and deprecated compose correctly", () => {
  const tool: Pick<ExtractionToolManifest, "category" | "riskLevel" | "deprecated"> = {
    category: "analysis",
    riskLevel: "L2",
    deprecated: true,
  };
  const effective = getEffectiveAiExposure(tool);
  // L2 removes mcp; deprecated removes command/subagent/workflow, leaving manual_confirmed + eval
  assert.deepEqual(effective, ["manual_confirmed", "eval"]);
});

test("explicit empty aiExposure is not backfilled by category", () => {
  const tool: Pick<ExtractionToolManifest, "category" | "aiExposure"> = {
    category: "analysis",
    aiExposure: [],
  };
  assert.deepEqual(deriveAiExposure(tool), []);
  assert.deepEqual(getEffectiveAiExposure(tool), []);
});
