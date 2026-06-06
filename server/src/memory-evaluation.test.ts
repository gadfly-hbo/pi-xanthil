import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

process.env.XANTHIL_DATA_DIR = mkdtempSync(join(tmpdir(), "pi-xanthil-memory-evaluation-test-"));

const db = await import("./db.ts");
const memory = await import("./memory-injection.ts");

test("createMemoryEvaluation creates baseline and memory result rows", () => {
  const workspace = db.createWorkspace("memory eval");
  db.createRuleMemory({
    workspaceId: workspace.id,
    title: "输出必须引用规则",
    evidence: "manual",
    source: "manual",
    severity: "medium",
    scope: "global",
  });
  const evaluation = db.createMemoryEvaluation(
    workspace.id,
    "请生成一段分析结论",
    "是否遵守规则",
    "fake-model",
    "fake-judge",
    "chat",
    2,
  );

  assert.equal(evaluation.status, "running");
  assert.equal(evaluation.results.length, 4);
  assert.equal(evaluation.results.filter((result) => result.variant === "baseline").length, 2);
  assert.equal(evaluation.results.filter((result) => result.variant === "memory").length, 2);

  const listed = db.listMemoryEvaluations(workspace.id);
  assert.equal(listed.length, 1);
  assert.equal(listed[0]?.id, evaluation.id);

  const detail = db.getMemoryEvaluation(evaluation.id);
  assert.equal(detail?.results.length, 4);
});

test("updateMemoryEvaluationResult stores parsed memory snapshots", () => {
  const workspace = db.createWorkspace("memory eval snapshot");
  db.createRuleMemory({
    workspaceId: workspace.id,
    title: "需要行动建议",
    evidence: "manual",
    source: "manual",
    severity: "low",
    scope: "global",
  });
  const evaluation = db.createMemoryEvaluation(workspace.id, "任务", "", "", "", "workflow", 1);
  const result = evaluation.results.find((item) => item.variant === "memory");
  assert.ok(result);
  const snapshot = memory.buildMemoryInjectionSnapshot(workspace.id, true, "workflow");

  db.updateMemoryEvaluationResult(result.id, {
    status: "success",
    output: "完成",
    outputChars: 2,
    memorySnapshot: snapshot,
  });

  const detail = db.getMemoryEvaluation(evaluation.id);
  const updated = detail?.results.find((item) => item.id === result.id);
  assert.equal(updated?.status, "success");
  assert.equal(updated?.memorySnapshot?.promptHash, snapshot.promptHash);
  assert.equal(updated?.memorySnapshot?.sources.find((source) => source.kind === "rules")?.count, 1);
});
