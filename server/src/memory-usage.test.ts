import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

process.env.XANTHIL_DATA_DIR = mkdtempSync(join(tmpdir(), "pi-xanthil-memory-usage-test-"));

const db = await import("./db.ts");
const memory = await import("./memory-injection.ts");

test("recordMemoryInjectionUsage increments selected source usage", () => {
  const workspace = db.createWorkspace("memory usage");
  db.createRuleMemory({
    workspaceId: workspace.id,
    title: "先核对输入路径",
    evidence: "manual evidence",
    source: "manual",
    severity: "medium",
    scope: "global",
  });

  const snapshot = memory.buildMemoryInjectionSnapshot(workspace.id, true, "chat");
  db.recordMemoryInjectionUsage(workspace.id, snapshot, 12345);

  const rules = db.getMemoryUsageStats(workspace.id, "rules");
  assert.equal(rules?.usedCount, 1);
  assert.equal(rules?.lastUsedAt, 12345);
  assert.equal(rules?.positiveSignals, 0);
  assert.equal(rules?.negativeSignals, 0);
});

test("negative feedback suppresses a memory source in selection policy", () => {
  const workspace = db.createWorkspace("memory usage negative");
  db.createRuleMemory({
    workspaceId: workspace.id,
    title: "报告必须包含行动建议",
    evidence: "manual evidence",
    source: "manual",
    severity: "medium",
    scope: "global",
  });
  db.recordMemoryFeedback(workspace.id, "rules", "negative");
  db.recordMemoryFeedback(workspace.id, "rules", "negative");
  db.recordMemoryFeedback(workspace.id, "rules", "negative");

  const snapshot = memory.buildMemoryInjectionSnapshot(workspace.id, true, "chat");
  const rules = snapshot.sources.find((source) => source.kind === "rules");
  assert.equal(rules?.selected, false);
  assert.match(rules?.omittedReason ?? "", /negative feedback/);
  assert.equal(rules?.usage?.negativeSignals, 3);
  assert.doesNotMatch(memory.buildMemoryPrompt(workspace.id, "chat"), /xanthil-rules/);

  db.recordMemoryFeedback(workspace.id, "rules", "positive");
  db.recordMemoryFeedback(workspace.id, "rules", "positive");
  db.recordMemoryFeedback(workspace.id, "rules", "positive");
  const restored = memory.buildMemoryInjectionSnapshot(workspace.id, true, "chat");
  assert.equal(restored.sources.find((source) => source.kind === "rules")?.selected, true);
});
