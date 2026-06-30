import assert from "node:assert/strict";
import test from "node:test";
import { filterAiExposedTools, isAiExposedTool, isToolBindable, listAiExposedToolIds, renderToolManifestSummary } from "./tool-policy.ts";

const analysis = { id: "analysis-tool", category: "analysis" as const, tags: ["cohort", "retention"], riskLevel: "L1" as const, allowedUse: "aggregate metrics", forbiddenUse: "raw rows" };
const ingestion = { id: "ingestion-tool", category: "ingestion" as const };

test("tool policy exposes only analysis tools to AI surfaces", () => {
  assert.equal(isAiExposedTool(analysis), true);
  assert.equal(isToolBindable(analysis), true);
  assert.equal(isAiExposedTool(ingestion), false);
  assert.equal(isToolBindable(ingestion), false);
  assert.deepEqual(filterAiExposedTools([analysis, ingestion]).map((tool) => tool.id), ["analysis-tool"]);
  assert.deepEqual([...listAiExposedToolIds([analysis, ingestion])], ["analysis-tool"]);
});

test("renderToolManifestSummary includes compact tags and policy", () => {
  const summary = renderToolManifestSummary(analysis);
  assert.match(summary, /tags=cohort,retention/);
  assert.match(summary, /risk=L1/);
  assert.match(summary, /适用: aggregate metrics/);
  assert.match(summary, /禁止: raw rows/);
});
