import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { CounterfactualProbeRun } from "./memory-aging-inspector.ts";
import type { MemoryItem } from "./types.ts";

// §二·五 铁律：被测模块 import 链触发 db.ts boot（import 期即 open DB_PATH）。
// 必须先设临时 XANTHIL_DATA_DIR + 动态 import，否则多文件同进程合并跑 `database is locked` 且污染真实库。
process.env.XANTHIL_DATA_DIR = mkdtempSync(join(tmpdir(), "aging-inspector-test-"));
const { computeCounterfactualAttribution, runMemoryAgingInspection } = await import("./memory-aging-inspector.ts");

const NOW = 1_700_000_000_000;
const DAY = 24 * 60 * 60 * 1000;

function makeItem(overrides: Partial<MemoryItem> = {}): MemoryItem {
  return {
    id: overrides.id ?? "m1",
    workspaceId: "ws1",
    type: "constraint",
    title: "会员复购按自然月统计",
    body: "复购率必须按自然月窗口统计，不要混入跨月样本。",
    tags: ["task:retention", "method:metric-caliber"],
    source: "manual",
    sourceEventIds: [],
    confidence: 0.8,
    riskFlags: [],
    validFrom: NOW - 30 * DAY,
    validUntil: null,
    supersedesId: null,
    usedCount: 0,
    lastUsedAt: NOW,
    positiveSignals: 0,
    negativeSignals: 0,
    staleAfterDays: 90,
    scope: "global",
    enabled: true,
    createdAt: NOW - 30 * DAY,
    updatedAt: NOW - 10 * DAY,
    ...overrides,
  };
}

test("aging inspector detects similar active memories as interference risk", () => {
  const a = makeItem({ id: "a", confidence: 0.9, positiveSignals: 4 });
  const b = makeItem({
    id: "b",
    title: "复购口径按自然月",
    body: "会员复购率统一按自然月统计，跨月样本不能混入。",
    confidence: 0.45,
    negativeSignals: 2,
  });

  const result = runMemoryAgingInspection({ workspaceId: "ws1", items: [a, b], now: NOW, scoreSeries: [1, 0.8, 0.45] });

  const finding = result.findings.find((item) => item.kind === "interference");
  assert.ok(finding);
  assert.equal(finding.likelyStage, "read");
  assert.equal(finding.severity, "warn");
  assert.ok(finding.itemIds.includes("a"));
  assert.ok(finding.itemIds.includes("b"));
  assert.equal(finding.metric.halfLife, 2);
  assert.ok(result.recommendations.some((line) => line.includes("干扰 profile")));
});

test("aging inspector detects revision when superseded memory is still active and referenced", () => {
  const oldFact = makeItem({
    id: "old",
    title: "预算上限是 100 万",
    body: "活动预算上限是 100 万。",
    updatedAt: NOW - 20 * DAY,
  });
  const newFact = makeItem({
    id: "new",
    title: "预算上限是 80 万",
    body: "活动预算上限已修订为 80 万。",
    supersedesId: "old",
    updatedAt: NOW - DAY,
  });
  const derived = makeItem({
    id: "derived",
    type: "experience",
    title: "预算校验经验",
    body: "执行活动时继续引用预算上限是 100 万这条旧记忆。",
    tags: ["task:budget"],
  });

  const result = runMemoryAgingInspection({ workspaceId: "ws1", items: [oldFact, newFact, derived], now: NOW });

  const finding = result.findings.find((item) => item.kind === "revision");
  assert.ok(finding);
  assert.equal(finding.severity, "critical");
  assert.equal(finding.likelyStage, "util");
  assert.deepEqual(new Set(finding.itemIds), new Set(["old", "new", "derived"]));
  assert.equal(finding.metric.accumulatorError, 2);
  assert.equal(finding.metric.forgetAccuracy, 0);
  assert.ok(result.recommendations.some((line) => line.includes("修订 profile")));
});

test("counterfactual attribution follows P1/P2/P3 accuracy deltas", () => {
  const probes: CounterfactualProbeRun[] = [
    { id: "P1", write: "agent", read: "agent", accuracy: 0.4 },
    { id: "P2", write: "agent", read: "oracle", accuracy: 0.7 },
    { id: "P3", write: "oracle", read: "oracle", accuracy: 0.9 },
  ];

  assert.deepEqual(computeCounterfactualAttribution(probes), {
    readErr: 0.3,
    writeErr: 0.2,
    utilErr: 0.1,
  });
});

test("aging inspector emits targeted recommendation for dominant read attribution", () => {
  const probes: CounterfactualProbeRun[] = [
    { id: "P1", write: "agent", read: "agent", accuracy: 0.2 },
    { id: "P2", write: "agent", read: "oracle", accuracy: 0.8 },
    { id: "P3", write: "oracle", read: "oracle", accuracy: 0.9 },
  ];

  const result = runMemoryAgingInspection({ workspaceId: "ws1", items: [], now: NOW, probes });

  assert.deepEqual(result.attribution, { readErr: 0.6, writeErr: 0.1, utilErr: 0.1 });
  assert.ok(result.recommendations.some((line) => line.includes("读取")));
});
