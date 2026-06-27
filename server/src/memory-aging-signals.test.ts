import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { MemoryItem } from "./types.ts";

// §二·五 铁律：被测模块 import 链触发 db.ts boot（import 期即 open DB_PATH）。
// 必须先设临时 XANTHIL_DATA_DIR + 动态 import，否则多文件同进程合并跑 `database is locked` 且污染真实库。
process.env.XANTHIL_DATA_DIR = mkdtempSync(join(tmpdir(), "aging-signals-test-"));
const { computeMemoryAgingSignals } = await import("./memory-aging-signals.ts");

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

test("aging signals: detects high-similarity conflict pair", () => {
  const a = makeItem({ id: "a", confidence: 0.9, positiveSignals: 4 });
  const b = makeItem({
    id: "b",
    title: "复购口径按自然月",
    body: "会员复购率统一按自然月统计，跨月样本不能混入。",
    confidence: 0.45,
    negativeSignals: 2,
  });

  const result = computeMemoryAgingSignals({ workspaceId: "ws1", items: [a, b], now: NOW });

  assert.equal(result.conflicts.length, 1);
  const pair = result.conflicts[0]!;
  // 稳定排序：a < b 字典序
  assert.equal(pair.itemAId, "a");
  assert.equal(pair.itemBId, "b");
  assert.equal(pair.pairId, "a:b");
  assert.equal(pair.severity, "warn");
  assert.ok(pair.reasons.includes("high-similarity"));
  assert.ok(pair.reasons.includes("confidence-divergence"));
  assert.ok(pair.reasons.includes("signal-divergence"));
});

test("aging signals: ignores items below similarity floor", () => {
  const a = makeItem({ id: "a", title: "复购口径", body: "按自然月统计", tags: ["task:retention"] });
  const b = makeItem({
    id: "b",
    title: "广告投放节奏",
    body: "新品上市第一周加投信息流",
    tags: ["task:advertising"],
  });

  const result = computeMemoryAgingSignals({ workspaceId: "ws1", items: [a, b], now: NOW });
  assert.equal(result.conflicts.length, 0);
});

test("aging signals: skips supersede chain in conflicts (it is revision territory)", () => {
  const oldF = makeItem({ id: "old", title: "预算上限 100 万", body: "预算 100 万" });
  const newF = makeItem({
    id: "new",
    title: "预算上限 80 万",
    body: "预算修订为 80 万",
    supersedesId: "old",
  });
  const result = computeMemoryAgingSignals({ workspaceId: "ws1", items: [oldF, newF], now: NOW });
  // 不应作为干扰对计入
  assert.equal(result.conflicts.length, 0);
});

test("aging signals: revision sweep flags critical when older still active and referenced", () => {
  const oldF = makeItem({
    id: "old",
    title: "预算上限是 100 万",
    body: "活动预算上限是 100 万。",
    updatedAt: NOW - 20 * DAY,
  });
  const newF = makeItem({
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

  const result = computeMemoryAgingSignals({
    workspaceId: "ws1",
    items: [oldF, newF, derived],
    now: NOW,
  });

  assert.equal(result.staleRefs.length, 1);
  const ref = result.staleRefs[0]!;
  assert.equal(ref.newerId, "new");
  assert.equal(ref.olderId, "old");
  assert.equal(ref.olderStillActive, true);
  assert.equal(ref.severity, "critical");
  assert.deepEqual(ref.referencerIds, ["derived"]);
});

test("aging signals: revision sweep warn when older retired but still referenced", () => {
  const oldF = makeItem({
    id: "old",
    title: "返佣比例 5 个点",
    body: "渠道返佣 5%",
    validUntil: NOW - DAY,
    enabled: false,
  });
  const newF = makeItem({
    id: "new",
    title: "返佣比例 3 个点",
    body: "渠道返佣 3%",
    supersedesId: "old",
  });
  const derived = makeItem({
    id: "derived",
    type: "experience",
    title: "返佣测算",
    body: "测算时按返佣比例 5 个点估算上限。",
  });

  const result = computeMemoryAgingSignals({
    workspaceId: "ws1",
    items: [oldF, newF, derived],
    now: NOW,
  });

  assert.equal(result.staleRefs.length, 1);
  const ref = result.staleRefs[0]!;
  assert.equal(ref.olderStillActive, false);
  assert.equal(ref.severity, "warn");
  assert.deepEqual(ref.referencerIds, ["derived"]);
});

test("aging signals: revision sweep skipped when older retired and no references", () => {
  const oldF = makeItem({
    id: "old",
    title: "旧规则 A",
    body: "已废弃口径 A",
    enabled: false,
  });
  const newF = makeItem({
    id: "new",
    title: "新规则 A",
    body: "新口径 A",
    supersedesId: "old",
  });
  const unrelated = makeItem({
    id: "u",
    title: "B 模块说明",
    body: "和 A 完全无关。",
  });
  const result = computeMemoryAgingSignals({
    workspaceId: "ws1",
    items: [oldF, newF, unrelated],
    now: NOW,
  });
  assert.equal(result.staleRefs.length, 0);
});

test("aging signals: truncation flag flips when items exceed MAX_ITEMS", () => {
  // 600 条阈值上限；造 601 条最简 item
  const items: MemoryItem[] = Array.from({ length: 601 }, (_, i) =>
    makeItem({ id: `n${i}`, title: `条目${i}`, body: `内容${i}`, updatedAt: NOW - i * 1000 }),
  );
  const result = computeMemoryAgingSignals({ workspaceId: "ws1", items, now: NOW });
  assert.equal(result.truncated, true);
  assert.equal(result.scanned, 600);
});

test("aging signals: ignores type mismatch in conflicts", () => {
  const a = makeItem({ id: "a", type: "constraint", title: "T", body: "X" });
  const b = makeItem({ id: "b", type: "experience", title: "T", body: "X" });
  const result = computeMemoryAgingSignals({ workspaceId: "ws1", items: [a, b], now: NOW });
  assert.equal(result.conflicts.length, 0);
});
