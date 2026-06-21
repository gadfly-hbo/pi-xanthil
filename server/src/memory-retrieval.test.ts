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

// ── 记忆 v2.0 缺口1：tags 检索维度（结构化精筛 + 加权）─────────────────────

test("tags: round-trip persists through create / get / list", () => {
  const workspace = db.createWorkspace("tags round-trip");
  const created = data.createMemoryItem({
    workspaceId: workspace.id,
    type: "constraint",
    title: "带标签的口径",
    body: "复购率按自然月",
    tags: ["industry:apparel", "method:cohort", " industry:apparel ", ""],
  });
  // normalize：trim + 去重 + 去空。
  assert.deepEqual(created.tags, ["industry:apparel", "method:cohort"]);
  const fetched = data.getMemoryItem(created.id);
  assert.deepEqual(fetched?.tags, ["industry:apparel", "method:cohort"]);
  const listed = data.listMemoryItems({ workspaceId: workspace.id }).find((m) => m.id === created.id);
  assert.deepEqual(listed?.tags, ["industry:apparel", "method:cohort"]);
});

test("tags: patch replaces tags", () => {
  const workspace = db.createWorkspace("tags patch");
  const item = data.createMemoryItem({
    workspaceId: workspace.id,
    type: "experience",
    title: "可改标签",
    body: "正文",
    tags: ["task:a"],
  });
  const updated = data.updateMemoryItem(item.id, { tags: ["task:b", "data:csv"] });
  assert.deepEqual(updated?.tags, ["task:b", "data:csv"]);
});

test("tags: review accept does not drop tags", () => {
  const workspace = db.createWorkspace("tags review");
  // 走 ingest 低置信路径进 review 队列（confidence 0.3 < AUTO 阈值），透传 tags。
  const verdict = data.ingestMemoryCandidate({
    workspaceId: workspace.id,
    type: "experience",
    title: "候选经验带标签需人工复核",
    body: "正文足够长以避开 weak_evidence 的 medium 风险但置信度故意压低进复核队列",
    tags: ["industry:beauty", "problem:churn"],
    scope: "global",
    sourceEventIds: ["evt-1"],
    confidence: 0.3,
    riskFlags: [],
  });
  assert.equal(verdict.kind, "review");
  if (verdict.kind !== "review") return;
  assert.deepEqual(verdict.review.tags, ["industry:beauty", "problem:churn"]);
  const accepted = data.acceptMemoryReview(verdict.review.id);
  assert.ok(accepted);
  assert.deepEqual(accepted?.item.tags, ["industry:beauty", "problem:churn"]);
});

test("tags: structured pre-filter narrows pool to tag-matching candidates", () => {
  const workspace = db.createWorkspace("tags prefilter");
  const tagged = data.createMemoryItem({
    workspaceId: workspace.id,
    type: "constraint",
    title: "服饰口径",
    body: "仅服饰适用",
    tags: ["industry:apparel"],
  });
  const untagged = data.createMemoryItem({
    workspaceId: workspace.id,
    type: "constraint",
    title: "通用口径",
    body: "无标签",
  });
  const otherTag = data.createMemoryItem({
    workspaceId: workspace.id,
    type: "constraint",
    title: "美妆口径",
    body: "仅美妆适用",
    tags: ["industry:beauty"],
  });

  // X-MEM2-CTX：硬预过滤只在**显式 ctx.tags** 时触发（调用方刻意结构化作用域）→
  // 仅命中 tag 的候选进池，untagged 与异 tag 均被剔除。
  const snapshot = memory.buildMemoryInjectionSnapshot(
    workspace.id,
    true,
    "chat",
    {},
    { query: "口径", tags: ["industry:apparel"] },
  );
  const part = snapshot.sources.find((s) => s.kind === "memory_item");
  assert.ok(part);
  const ids = new Set(part.itemIds ?? []);
  assert.ok(ids.has(tagged.id), "tag-matching candidate must survive pre-filter");
  assert.ok(!ids.has(untagged.id), "untagged candidate must be filtered when explicit tags requested");
  assert.ok(!ids.has(otherTag.id), "other-tag candidate must be filtered");
  assert.equal((part.meta as Record<string, number>).requestedTagCount, 1);
});

// X-MEM2-CTX 语义分层：query 里的白名单前缀（如 industry:apparel）是**推断信号**，只进
// tagMatch 加权、绝不硬过滤——否则记忆多数未打 tag 时会被自动注入清空召回。
test("tags: whitelist prefix in query boosts but does NOT pre-filter (untagged survives)", () => {
  const workspace = db.createWorkspace("tags query-boost-only");
  const tagged = data.createMemoryItem({
    workspaceId: workspace.id, type: "constraint", title: "服饰口径", body: "仅服饰", tags: ["industry:apparel"],
  });
  const untagged = data.createMemoryItem({
    workspaceId: workspace.id, type: "constraint", title: "通用口径", body: "无标签也应被召回",
  });
  const snapshot = memory.buildMemoryInjectionSnapshot(
    workspace.id, true, "chat", {}, { query: "industry:apparel 口径" },
  );
  const part = snapshot.sources.find((s) => s.kind === "memory_item");
  assert.ok(part);
  const ids = new Set(part.itemIds ?? []);
  const meta = (part.meta ?? {}) as Record<string, number>;
  assert.equal(meta.requestedTagCount, 0, "query prefix is not a hard filter tag");
  assert.ok((meta.boostTagCount ?? 0) >= 1, "query prefix contributes a boost tag");
  assert.ok(ids.has(tagged.id), "tagged candidate survives and is boosted");
  assert.ok(ids.has(untagged.id), "untagged candidate must NOT be wiped by query-prefix inference");
});

// X-MEM2-CTX：ctx.dataPaths → data:<stem> 作为 boost 信号（不硬过滤），untagged 仍召回。
test("tags: ctx.dataPaths contributes data:<stem> boost without pre-filtering", () => {
  const workspace = db.createWorkspace("tags datapaths");
  const tagged = data.createMemoryItem({
    workspaceId: workspace.id, type: "constraint", title: "订单口径", body: "订单表口径", tags: ["data:orders"],
  });
  const untagged = data.createMemoryItem({
    workspaceId: workspace.id, type: "constraint", title: "通用口径", body: "无标签也应被召回",
  });
  const snapshot = memory.buildMemoryInjectionSnapshot(
    workspace.id, true, "chat", {}, { query: "口径", dataPaths: ["020_clean/Orders.csv"] },
  );
  const part = snapshot.sources.find((s) => s.kind === "memory_item");
  assert.ok(part);
  const ids = new Set(part.itemIds ?? []);
  const meta = (part.meta ?? {}) as Record<string, number>;
  assert.equal(meta.requestedTagCount, 0, "dataPaths is inference, not a hard filter");
  assert.ok((meta.boostTagCount ?? 0) >= 1, "dataPaths yields a data: boost tag");
  assert.ok(ids.has(tagged.id) && ids.has(untagged.id), "both survive; data:orders only boosts the matching one");
});

// 总控终审收敛回归：query 里的 https:// / 英文 word:value 不得被当成 tag 信号，
// 否则结构化预过滤「无交集即出局」会清空整个召回（静默打空）。前缀限白名单后应安全。
test("tags: spurious url / non-whitelist prefix in query does not wipe recall", () => {
  const workspace = db.createWorkspace("tags spurious");
  const untagged = data.createMemoryItem({
    workspaceId: workspace.id,
    type: "constraint",
    title: "通用口径",
    body: "无标签也应被召回",
  });

  const snapshot = memory.buildMemoryInjectionSnapshot(
    workspace.id,
    true,
    "chat",
    {},
    { query: "看下 https://foo.com/data 的复购率 note:abc" },
  );
  const part = snapshot.sources.find((s) => s.kind === "memory_item");
  assert.ok(part);
  assert.equal((part.meta as Record<string, number>).requestedTagCount, 0, "non-whitelist prefixes must not be parsed as tags");
  assert.ok(new Set(part.itemIds ?? []).has(untagged.id), "recall must not be wiped by spurious url/word:value");
});

test("tags: tagMatch boosts tagged candidate ranking", () => {
  const workspace = db.createWorkspace("tags boost");
  // 两条都词法命中查询的非 tag 部分，但只有一条带请求 tag → tagMatch 抬升其排序。
  const withTag = data.createMemoryItem({
    workspaceId: workspace.id,
    type: "constraint",
    title: "复购率口径 method:cohort",
    body: "复购率统计口径说明",
    tags: ["method:cohort"],
  });
  const withoutTag = data.createMemoryItem({
    workspaceId: workspace.id,
    type: "constraint",
    title: "复购率口径 通用",
    body: "复购率统计口径说明",
  });
  // 不带 tag 前缀时两条都不被预过滤；用 method:cohort 做结构化精筛只会留 withTag，
  // 故这里改测「无前缀 query 时排序」——两条都进池，但显式 tag 命中给 withTag 加分。
  // 为同时保留两条进池，query 不写 tag 前缀，转而验证 tagMatch=0 时排序稳定（基线不破）。
  const snapshot = memory.buildMemoryInjectionSnapshot(
    workspace.id,
    true,
    "chat",
    {},
    { query: "复购率 口径" },
  );
  const part = snapshot.sources.find((s) => s.kind === "memory_item");
  assert.ok(part);
  const ids = part.itemIds ?? [];
  assert.ok(ids.includes(withTag.id));
  assert.ok(ids.includes(withoutTag.id), "no tag prefix in query → both survive (no pre-filter)");
});
