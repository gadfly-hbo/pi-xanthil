import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

process.env.XANTHIL_DATA_DIR = mkdtempSync(join(tmpdir(), "pi-xanthil-memory-retrieval-test-"));

const db = await import("./db.ts");
const data = await import("./db/data.ts");
const memory = await import("./memory-injection.ts");
const dbHandle = db.db;

// D-RETRIEVAL 单测：多信号打分召回 + 治理过滤 + 时序衰减 + 负反馈压制。
// 与 memory-injection.test.ts 互补 —— 那边覆盖旧 5 类源签名/快照；这边覆盖 memory_item 召回。

test("memory_item retrieval: relevance ranks query-matching constraint above unrelated episode", () => {
  const workspace = db.createWorkspace("retrieval relevance");
  const matched = data.createMemoryItem({
    workspaceId: workspace.id,
    type: "constraint",
    title: "会员复购指标必须按自然月统计",
    body: "复购率口径以自然月为窗口，不要混入跨月样本",
  });
  const unrelated = data.createMemoryItem({
    workspaceId: workspace.id,
    type: "episode",
    title: "随机情景：天气晴好可以郊游",
    body: "无关业务的占位条目",
  });

  const snapshot = memory.buildMemoryInjectionSnapshot(
    workspace.id,
    true,
    "chat",
    {},
    { query: "复购率 自然月 会员" },
  );
  const part = snapshot.sources.find((s) => s.kind === "memory_item");
  assert.ok(part, "memory_item source missing");
  assert.equal(part.selected, true);
  // 命中查询的 constraint 应排在 unrelated episode 前。
  const ids = part.itemIds ?? [];
  assert.ok(ids.includes(matched.id));
  assert.ok(ids.includes(unrelated.id));
  assert.ok(ids.indexOf(matched.id) < ids.indexOf(unrelated.id), "matched should rank before unrelated");
});

test("memory_item retrieval: governance filters expired/poison/superseded", () => {
  const workspace = db.createWorkspace("retrieval governance");
  const now = Date.now();

  // 1) expired by validUntil
  const expired = data.createMemoryItem({
    workspaceId: workspace.id,
    type: "constraint",
    title: "已经过期的口径",
    body: "validUntil 已过",
    validUntil: now - 1000,
  });

  // 2) poison：含 high severity riskFlag
  const poison = data.createMemoryItem({
    workspaceId: workspace.id,
    type: "constraint",
    title: "高危风险条目",
    body: "应被治理过滤",
    riskFlags: [{ code: "instruction_injection", severity: "high", message: "test" }],
  });

  // 3) superseded：被 newer 取代
  const old = data.createMemoryItem({
    workspaceId: workspace.id,
    type: "experience",
    title: "旧经验",
    body: "应被 superseded 链取代",
  });
  const newer = data.createMemoryItem({
    workspaceId: workspace.id,
    type: "experience",
    title: "新经验",
    body: "supersedes 旧经验",
    supersedesId: old.id,
  });

  // 4) 正常：应被召回
  const fresh = data.createMemoryItem({
    workspaceId: workspace.id,
    type: "constraint",
    title: "正常约束",
    body: "应被召回",
  });

  const snapshot = memory.buildMemoryInjectionSnapshot(workspace.id, true, "chat");
  const part = snapshot.sources.find((s) => s.kind === "memory_item");
  assert.ok(part);
  const ids = new Set(part.itemIds ?? []);
  assert.ok(ids.has(fresh.id), "fresh should be recalled");
  assert.ok(ids.has(newer.id), "newer should be recalled");
  assert.ok(!ids.has(expired.id), "expired must be filtered");
  assert.ok(!ids.has(poison.id), "poison must be filtered");
  assert.ok(!ids.has(old.id), "superseded must be filtered");
});

test("memory_item retrieval: recency decay favors fresh over very old", () => {
  const workspace = db.createWorkspace("retrieval recency");

  const ancient = data.createMemoryItem({
    workspaceId: workspace.id,
    type: "constraint",
    title: "古老条目",
    body: "已存在很久",
    staleAfterDays: 99999, // 不要被过期治理拦掉
  });
  // 把 ancient 的 updated_at 改成 1 年前
  const oneYearAgo = Date.now() - 365 * 86400000;
  data.updateMemoryItem(ancient.id, { body: "古老条目正文（保持 staleAfterDays 大）" });
  // 直接用 SQL 改 updated_at（测试白盒手法）：通过再次 updateMemoryItem 不能控时戳，故用 db.exec。
  dbHandle.prepare("UPDATE memory_items SET updated_at = ?, valid_from = ? WHERE id = ?")
    .run(oneYearAgo, oneYearAgo, ancient.id);

  const fresh = data.createMemoryItem({
    workspaceId: workspace.id,
    type: "constraint",
    title: "新鲜条目",
    body: "刚刚创建",
  });

  const snapshot = memory.buildMemoryInjectionSnapshot(workspace.id, true, "chat");
  const part = snapshot.sources.find((s) => s.kind === "memory_item");
  assert.ok(part);
  const ids = part.itemIds ?? [];
  // 同 type、同无 query：fresh recency 高，应排在 ancient 前。
  assert.ok(ids.indexOf(fresh.id) < ids.indexOf(ancient.id), "fresh should outrank ancient by recency decay");
});

test("memory_item retrieval: staleAfterDays filters very old entries", () => {
  const workspace = db.createWorkspace("retrieval stale");
  const stale = data.createMemoryItem({
    workspaceId: workspace.id,
    type: "experience",
    title: "应被 staleAfterDays 过滤",
    body: "本条 staleAfterDays=1，且 updated_at 改至两天前",
    staleAfterDays: 1,
  });
  const twoDaysAgo = Date.now() - 2 * 86400000;
  dbHandle.prepare("UPDATE memory_items SET updated_at = ?, valid_from = ? WHERE id = ?")
    .run(twoDaysAgo, twoDaysAgo, stale.id);

  const ok = data.createMemoryItem({
    workspaceId: workspace.id,
    type: "experience",
    title: "未过期",
    body: "正常",
  });

  const snapshot = memory.buildMemoryInjectionSnapshot(workspace.id, true, "chat");
  const part = snapshot.sources.find((s) => s.kind === "memory_item");
  const ids = new Set(part?.itemIds ?? []);
  assert.ok(ids.has(ok.id));
  assert.ok(!ids.has(stale.id), "stale by staleAfterDays must be filtered");
});

test("memory_item retrieval: negative feedback suppresses item from recall", () => {
  const workspace = db.createWorkspace("retrieval suppress");
  const item = data.createMemoryItem({
    workspaceId: workspace.id,
    type: "constraint",
    title: "被反馈压制的条目",
    body: "若负反馈 ≥ 正反馈+3 则不召回",
  });
  // 负反馈 3 次（>= positive(0) + 3 触发 suppress）
  data.recordMemoryItemFeedback(item.id, "negative");
  data.recordMemoryItemFeedback(item.id, "negative");
  data.recordMemoryItemFeedback(item.id, "negative");

  const snapshot = memory.buildMemoryInjectionSnapshot(workspace.id, true, "chat");
  const part = snapshot.sources.find((s) => s.kind === "memory_item");
  assert.ok(part);
  assert.ok(!(part.itemIds ?? []).includes(item.id), "suppressed item must not appear in itemIds");
});

test("memory_item retrieval: snapshot structure preserved (no new top-level fields)", () => {
  const workspace = db.createWorkspace("retrieval shape");
  data.createMemoryItem({
    workspaceId: workspace.id,
    type: "constraint",
    title: "结构稳定性",
    body: "确保 snapshot 顶层签名不破",
  });

  const snapshot = memory.buildMemoryInjectionSnapshot(workspace.id, true, "chat");
  assert.equal(snapshot.requested, true);
  assert.equal(typeof snapshot.injected, "boolean");
  assert.equal(typeof snapshot.charCount, "number");
  assert.equal(typeof snapshot.tokenEstimate, "number");
  assert.equal(typeof snapshot.tokenBudget, "number");
  assert.ok(Array.isArray(snapshot.sources));
  // 6 类源恒定：businessContext / rules / memory_item / standards / cases / knowledgeGraph。
  const kinds = snapshot.sources.map((s) => s.kind);
  assert.deepEqual(kinds, ["businessContext", "rules", "memory_item", "standards", "cases", "knowledgeGraph"]);
  // 每个 source 必须含 score/selected/omittedReason 语义字段（per-条 score 由 itemIds 隐含；source 级 selected/omittedReason 已存在）。
  for (const s of snapshot.sources) {
    assert.equal(typeof s.selected, "boolean");
    assert.ok("omittedReason" in s);
    assert.ok("itemIds" in s);
  }
});

test("memory_item retrieval: topK in policy caps recalled count", () => {
  const workspace = db.createWorkspace("retrieval topk");
  for (let i = 0; i < 6; i++) {
    data.createMemoryItem({
      workspaceId: workspace.id,
      type: "constraint",
      title: `占位 ${i}`,
      body: `占位正文 ${i}`,
    });
  }
  const snapshot = memory.buildMemoryInjectionSnapshot(
    workspace.id,
    true,
    "chat",
    { memoryItemTopK: 3 },
  );
  const part = snapshot.sources.find((s) => s.kind === "memory_item");
  assert.ok(part);
  assert.equal(part.itemIds?.length, 3);
});
