import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

process.env.XANTHIL_DATA_DIR = mkdtempSync(join(tmpdir(), "pi-xanthil-memory-governance-test-"));

const db = await import("./db.ts");
const memory = await import("./memory-injection.ts");

test("recordMemoryInjectionUsage records source-level and item-level usage", () => {
  const workspace = db.createWorkspace("item usage");
  const created = db.createRuleMemory({
    workspaceId: workspace.id,
    title: "必须先检查输入路径",
    evidence: "manual",
    source: "manual",
    severity: "medium",
    scope: "global",
  });

  const snapshot = memory.buildMemoryInjectionSnapshot(workspace.id, true, "chat");
  assert.ok(snapshot.sources.find((source) => source.kind === "rules")?.itemIds?.includes(created.rule.id));
  db.recordMemoryInjectionUsage(workspace.id, snapshot, 67890);

  assert.equal(db.getMemoryUsageStats(workspace.id, "rules", "*")?.usedCount, 1);
  assert.equal(db.getMemoryUsageStats(workspace.id, "rules", created.rule.id)?.usedCount, 1);
});

test("rule versions increment and conflicts can be detected", () => {
  const workspace = db.createWorkspace("rule conflicts");
  const a = db.createRuleMemory({
    workspaceId: workspace.id,
    title: "报告必须包含行动建议",
    evidence: "manual",
    source: "manual",
    severity: "high",
    scope: "global",
  }).rule;
  const b = db.createRuleMemory({
    workspaceId: workspace.id,
    title: "报告必须包含行动建议反例",
    evidence: "不得输出行动建议，避免误导",
    source: "manual",
    severity: "low",
    scope: "global",
  }).rule;

  db.updateRuleMemory({ id: a.id, title: a.title, evidence: "manual updated", severity: "high", scope: "global" });
  assert.equal(db.listRuleMemories(workspace.id).find((rule) => rule.id === a.id)?.version, 2);

  const conflicts = db.detectRuleConflicts(workspace.id);
  assert.ok(conflicts.some((conflict) => [conflict.ruleAId, conflict.ruleBId].includes(a.id) && [conflict.ruleAId, conflict.ruleBId].includes(b.id)));
  db.updateRuleConflictStatus(conflicts[0]!.id, "ignored");
  assert.equal(db.listRuleConflicts(workspace.id, "ignored").length, 1);
});

test("memory failure attribution records negative feedback for linked memory", () => {
  const workspace = db.createWorkspace("failure attribution");
  const rule = db.createRuleMemory({
    workspaceId: workspace.id,
    title: "报告必须包含行动建议",
    evidence: "manual",
    source: "manual",
    severity: "medium",
    scope: "global",
  }).rule;

  const attribution = db.createMemoryFailureAttribution({
    workspaceId: workspace.id,
    targetKind: "flow_run",
    targetId: "run-1",
    cause: "rule_wrong",
    sourceKind: "rules",
    sourceId: rule.id,
    note: "该规则导致输出跑偏",
  });

  assert.equal(attribution.cause, "rule_wrong");
  assert.equal(db.listMemoryFailureAttributions(workspace.id, "flow_run", "run-1").length, 1);
  assert.equal(db.getMemoryUsageStats(workspace.id, "rules", rule.id)?.negativeSignals, 1);
});
