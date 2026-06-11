import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

process.env.XANTHIL_DATA_DIR = mkdtempSync(join(tmpdir(), "pi-xanthil-memory-injection-test-"));

const db = await import("./db.ts");
const memory = await import("./memory-injection.ts");

test("buildMemoryInjectionSnapshot records five memory sources and stable hashes", () => {
  const workspace = db.createWorkspace("memory snapshot");
  db.createBusinessContext(workspace.id, { category: "org", title: "主体", content: "森马会员" });
  db.createRuleMemory({
    workspaceId: workspace.id,
    title: "先核对指标口径",
    evidence: "manual",
    source: "manual",
    severity: "medium",
    scope: "global",
  });
  db.createAnalysisStandard(workspace.id, {
    kind: "metric",
    name: "复购率",
    category: "会员",
    description: "周期内复购会员占比",
    formula: "复购会员数 / 购买会员数",
    caliber: "按自然月统计",
    unit: "%",
    filePath: "",
    fileHash: null,
  });
  db.createAnalysisCase(workspace.id, {
    title: "会员留存分析",
    category: "会员",
    scenario: "会员复购下降",
    approach: "分层对比新老会员",
    conclusion: "输出核心原因和动作建议",
  });

  const snapshot = memory.buildMemoryInjectionSnapshot(workspace.id, true, "chat");
  assert.equal(snapshot.requested, true);
  assert.equal(snapshot.injected, true);
  assert.equal(snapshot.sources.length, 5);
  assert.deepEqual(snapshot.sources.map((source) => source.kind), [
    "businessContext",
    "rules",
    "standards",
    "cases",
    "knowledgeGraph",
  ]);
  assert.equal(snapshot.sources.find((source) => source.kind === "knowledgeGraph")?.injected, false);
  assert.ok(snapshot.promptHash);
  assert.ok(snapshot.charCount > 0);
  assert.ok(snapshot.tokenEstimate > 0);

  const same = memory.buildMemoryInjectionSnapshot(workspace.id, true, "chat");
  assert.equal(same.promptHash, snapshot.promptHash);

  db.createRuleMemory({
    workspaceId: workspace.id,
    title: "报告必须包含行动建议",
    evidence: "manual",
    source: "manual",
    severity: "low",
    scope: "global",
  });
  const changed = memory.buildMemoryInjectionSnapshot(workspace.id, true, "chat");
  assert.notEqual(changed.promptHash, snapshot.promptHash);
});

test("buildMemoryInjectionSnapshot records disabled injection without reading sources", () => {
  const workspace = db.createWorkspace("memory snapshot disabled");
  db.createRuleMemory({
    workspaceId: workspace.id,
    title: "不会被读取",
    evidence: "manual",
    source: "manual",
    severity: "low",
    scope: "global",
  });
  const snapshot = memory.buildMemoryInjectionSnapshot(workspace.id, false, "workflow");
  assert.equal(snapshot.requested, false);
  assert.equal(snapshot.injected, false);
  assert.equal(snapshot.promptHash, null);
  assert.equal(snapshot.sources.length, 0);
});

test("listMemoryInjectionRecords reads snapshots from trace event payloads", () => {
  const workspace = db.createWorkspace("memory snapshot trace");
  db.createRuleMemory({
    workspaceId: workspace.id,
    title: "trace 中应可回放注入快照",
    evidence: "manual",
    source: "manual",
    severity: "medium",
    scope: "global",
  });
  const snapshot = memory.buildMemoryInjectionSnapshot(workspace.id, true, "workflow");
  const event = db.addTraceEvent({
    workspaceId: workspace.id,
    targetKind: "flow_run",
    targetId: "run-1",
    type: "run_start",
    target: "memory run",
    status: "running",
    payload: { memoryInjection: snapshot },
  });

  const records = db.listMemoryInjectionRecords(workspace.id, 10);
  assert.equal(records.length, 1);
  assert.equal(records[0]?.eventId, event.id);
  assert.equal(records[0]?.snapshot.promptHash, snapshot.promptHash);
  assert.equal(records[0]?.snapshot.sources.find((source) => source.kind === "rules")?.count, 1);
});

test("memory selection policy omits lower-priority sources when token budget is exceeded", () => {
  const workspace = db.createWorkspace("memory snapshot budget");
  db.createBusinessContext(workspace.id, { category: "org", title: "主体", content: "森马会员" });
  db.createRuleMemory({
    workspaceId: workspace.id,
    title: "必须先核对会员指标口径",
    evidence: "manual evidence with enough content",
    source: "manual",
    severity: "high",
    scope: "global",
  });
  db.createAnalysisStandard(workspace.id, {
    // 注入 standards 走 reference_file（metric 真源已切 metric_definitions，P2b'）；用长描述制造 token 压力
    kind: "reference_file",
    name: "会员复购率",
    category: "会员",
    description: "这是一个较长的指标描述，用于制造 token budget 压力。".repeat(20),
    formula: "复购会员数 / 购买会员数",
    caliber: "自然月",
    unit: "%",
    filePath: "",
    fileHash: null,
  });
  db.createAnalysisCase(workspace.id, {
    title: "会员留存分析案例",
    category: "会员",
    scenario: "会员复购下降",
    approach: "按新老客分层、渠道分层、品类分层逐步排查。".repeat(20),
    conclusion: "必须输出核心原因、证据和行动建议。".repeat(20),
  });

  const snapshot = memory.buildMemoryInjectionSnapshot(workspace.id, true, "chat", { tokenBudget: 120 });
  const businessContext = snapshot.sources.find((source) => source.kind === "businessContext");
  const rules = snapshot.sources.find((source) => source.kind === "rules");
  const standards = snapshot.sources.find((source) => source.kind === "standards");
  const cases = snapshot.sources.find((source) => source.kind === "cases");

  assert.equal(businessContext?.selected, true);
  assert.equal(rules?.selected, true);
  assert.equal(standards?.selected, false);
  assert.equal(cases?.selected, false);
  assert.match(standards?.omittedReason ?? "", /token budget exceeded/);
  assert.ok(snapshot.tokenEstimate <= 120);

  const prompt = memory.buildMemoryPrompt(workspace.id, "chat", { tokenBudget: 120 });
  assert.match(prompt, /xanthil-business-context/);
  assert.match(prompt, /xanthil-rules/);
  assert.doesNotMatch(prompt, /xanthil-standards/);
  assert.doesNotMatch(prompt, /xanthil-cases/);
});
