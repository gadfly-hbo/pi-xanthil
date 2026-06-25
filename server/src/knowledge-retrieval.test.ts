import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

process.env.XANTHIL_DATA_DIR = mkdtempSync(join(tmpdir(), "pi-xanthil-knowledge-test-"));

const db = await import("./db.ts");
const data = await import("./db/data.ts");
const retrieval = await import("./knowledge-retrieval.ts");
const injection = await import("./knowledge-injection.ts");
const promptBlocks = await import("./prompt-blocks.ts");

test("chunkKnowledgeText: short text returns single chunk verbatim", () => {
  const t = "段落一只有一行。";
  assert.deepEqual(data.chunkKnowledgeText(t), [t]);
});

test("chunkKnowledgeText: long text splits on paragraph boundary, no slice mid-sentence", () => {
  const para1 = "复购率口径定义。".repeat(120); // ~960 chars
  const para2 = "新客复购需要按自然月统计。".repeat(40); // ~480 chars
  const text = `${para1}\n\n${para2}`;
  const chunks = data.chunkKnowledgeText(text);
  assert.ok(chunks.length >= 2, "should split into multiple chunks");
  // 末片不应是孤立短碎片（< overlap），合并后才算完整
  const last = chunks[chunks.length - 1]!;
  assert.ok(last.length >= 60, `last chunk too short: ${last.length}`);
  // 拼回去字符数 >= 原文（含 overlap）
  const joined = chunks.join("");
  assert.ok(joined.length >= text.length);
});

test("chunkKnowledgeText: no chunk fully contains another (no duplicate tail) on varied content", () => {
  // 用不同的标记位让每片有差异，验证修复后不会再产出"chunk N+1 是 N 的子串"。
  // 见 review: 修复前 1201 chars no-break 会产 [1200, 121, 239]，最后两片是同一段 tail 重复。
  const lines: string[] = [];
  for (let i = 0; i < 200; i++) lines.push(`第 ${i.toString().padStart(4, "0")} 行：复购率分析样本，行内 marker=${i}`);
  const text = lines.join("\n");
  const chunks = data.chunkKnowledgeText(text);
  assert.ok(chunks.length >= 2, "should split");
  for (let i = 0; i < chunks.length; i++) {
    for (let j = 0; j < chunks.length; j++) {
      if (i === j) continue;
      assert.ok(
        !chunks[i]!.includes(chunks[j]!),
        `chunk ${i} fully contains chunk ${j} (duplicate-tail bug regressed); lens=${chunks.map((c) => c.length).join(",")}`,
      );
    }
  }
});

test("chunkKnowledgeText: tail just over budget does not spawn micro-fragment", () => {
  // 修复前：text.length = budget + 1 会产 [1200, 121, 239] 三片，最后两片是同一 tail 的重复。
  // 修复后：尾片 <= overlap 直接并入前片，单纯的 1201 应只出 1 片。
  const text = "x".repeat(1201);
  const chunks = data.chunkKnowledgeText(text);
  assert.equal(chunks.length, 1, `expected 1 chunk, got ${chunks.length}: ${chunks.map((c) => c.length).join(",")}`);
});

test("knowledge CRUD: create doc writes chunks; delete cascades", () => {
  const ws = db.createWorkspace("knowledge crud");
  const doc = data.createKnowledgeDoc({
    workspaceId: ws.id,
    title: "复购率分析口径",
    content: "复购率定义为同一会员在同一自然月内发生两次及以上购买行为。\n\n指标计算窗口固定为 30 天。",
    tags: ["指标", "复购"],
  });
  assert.ok(doc.id);
  assert.equal(doc.title, "复购率分析口径");
  const chunks = data.listKnowledgeChunks(doc.id);
  assert.ok(chunks.length >= 1);
  const list = data.listKnowledgeDocs(ws.id);
  assert.equal(list.length, 1);

  data.deleteKnowledgeDoc(doc.id);
  assert.equal(data.listKnowledgeChunks(doc.id).length, 0);
  assert.equal(data.listKnowledgeDocs(ws.id).length, 0);
});

test("knowledge CRUD: update content rewrites chunks", () => {
  const ws = db.createWorkspace("knowledge update");
  const doc = data.createKnowledgeDoc({
    workspaceId: ws.id,
    title: "口径文档",
    content: "原始定义。",
  });
  const before = data.listKnowledgeChunks(doc.id);
  assert.equal(before.length, 1);
  data.updateKnowledgeDoc(doc.id, { content: "新版定义：复购率按自然月。\n\n新增章节：维度切分。" });
  const after = data.listKnowledgeChunks(doc.id);
  assert.equal(after.length, 1); // small content; key is that texts changed
  assert.notEqual(after[0]!.text, before[0]!.text);
});

test("knowledge search: BM25 ranks query-matching chunk above unrelated", () => {
  const ws = db.createWorkspace("knowledge bm25");
  data.createKnowledgeDoc({
    workspaceId: ws.id,
    title: "复购率分析",
    content: "复购率口径以自然月为统计窗口，会员在同月内两次以上购买视为复购。",
  });
  data.createKnowledgeDoc({
    workspaceId: ws.id,
    title: "天气模块说明",
    content: "天气数据来自第三方 API，每小时刷新一次，与业务数据无关。",
  });
  const hits = retrieval.searchKnowledgeChunks(ws.id, "复购率 自然月");
  assert.ok(hits.length >= 1);
  assert.match(hits[0]!.doc.title, /复购率/);
  // BM25 主信号应 > 0
  assert.ok(hits[0]!.signals.relevance > 0);
});

test("knowledge search: empty query returns no hits", () => {
  const ws = db.createWorkspace("knowledge empty");
  data.createKnowledgeDoc({ workspaceId: ws.id, title: "随便", content: "无关内容。" });
  assert.equal(retrieval.searchKnowledgeChunks(ws.id, "   ").length, 0);
});

test("knowledge search: docIds filter restricts corpus", () => {
  const ws = db.createWorkspace("knowledge filter");
  const a = data.createKnowledgeDoc({ workspaceId: ws.id, title: "A", content: "复购率定义条目 alpha。" });
  data.createKnowledgeDoc({ workspaceId: ws.id, title: "B", content: "复购率定义条目 beta。" });
  const hits = retrieval.searchKnowledgeChunks(ws.id, "复购率", { docIds: [a.id], topK: 5 });
  assert.ok(hits.length >= 1);
  for (const h of hits) assert.equal(h.doc.id, a.id);
});

test("knowledge search: topK caps result size", () => {
  const ws = db.createWorkspace("knowledge topk");
  for (let i = 0; i < 5; i++) {
    data.createKnowledgeDoc({ workspaceId: ws.id, title: `doc ${i}`, content: `复购率口径 sample ${i}` });
  }
  const hits = retrieval.searchKnowledgeChunks(ws.id, "复购率", { topK: 2 });
  assert.equal(hits.length, 2);
});

test("knowledge search: channel heading match surfaces the exact mapping section", () => {
  const ws = db.createWorkspace("knowledge channel heading");
  data.createKnowledgeDoc({
    workspaceId: ws.id,
    title: "森马三大人群算法_标准执行Prompt_v2.0.1.md",
    content: "森马三大人群算法用于多渠道分析。渠道字段包括天猫、京东、抖音，但这里不含权重表。",
    tags: ["森马三大人群"],
  });
  data.createKnowledgeDoc({
    workspaceId: ws.id,
    title: "三大人群×全渠道标签映射表_v2.0.2.md",
    content: [
      "# 三大人群 × 全渠道标签映射表 v2.0.2",
      "品牌：森马。",
      "### 4.2 天猫 / 线下：六大行业特色人群 → A/B/C",
      "| 六大标签 | A权重 | B权重 | C权重 |",
      "|---|---:|---:|---:|",
      "| 潮流人群 | 1.00 | 0.00 | 0.00 |",
      "| 高阶时尚 | 0.40 | 0.60 | 0.00 |",
      "| 品质生活 | 0.00 | 1.00 | 0.00 |",
      "| 大众实用 | 0.00 | 0.25 | 0.75 |",
      "| 低价实惠 | 0.00 | 0.00 | 1.00 |",
      "| 低价有颜 | 0.00 | 0.00 | 1.00 |",
    ].join("\n"),
    tags: ["森马三大人群"],
  });

  const prompt = injection.buildKnowledgePrompt(ws.id, "森马三大人群算法 天猫渠道");
  assert.match(prompt, /4\.2 天猫 \/ 线下/);
  assert.match(prompt, /潮流人群 \| 1\.00 \| 0\.00 \| 0\.00/);
  assert.match(prompt, /低价有颜 \| 0\.00 \| 0\.00 \| 1\.00/);
});

test("knowledge injection: disabled or unmatched query preserves the existing prompt", () => {
  const ws = db.createWorkspace("knowledge injection disabled");
  data.createKnowledgeDoc({ workspaceId: ws.id, title: "复购口径", content: "复购率按自然月统计。" });
  assert.equal(injection.withKnowledgePrompt(ws.id, false, "复购率", "role prompt"), "role prompt");
  assert.equal(injection.withKnowledgePrompt(ws.id, true, "完全不相关的火星地质", "role prompt"), "role prompt");
});

test("knowledge injection: formats visible citations and keeps workspace isolation", () => {
  const target = db.createWorkspace("knowledge injection target");
  const other = db.createWorkspace("knowledge injection other");
  data.createKnowledgeDoc({
    workspaceId: target.id,
    title: "会员复购 SOP",
    path: "/knowledge/member-repurchase.md",
    content: "会员复购率必须按自然月统计，并排除退款订单。",
  });
  data.createKnowledgeDoc({
    workspaceId: other.id,
    title: "其他工作区私密资料",
    content: "会员复购率使用滚动九十天窗口。",
  });

  const prompt = injection.buildKnowledgePrompt(target.id, "会员复购率 自然月");
  assert.match(prompt, /知识库检索上下文｜用户资料｜仅作参考/);
  assert.match(prompt, /\[KB1\] 会员复购 SOP · \/knowledge\/member-repurchase\.md/);
  assert.match(prompt, /必须在相关结论后标注 \[KB1\]/);
  assert.match(prompt, /排除退款订单/);
  assert.doesNotMatch(prompt, /滚动九十天|其他工作区私密资料/);

  const assembled = promptBlocks.assembleSystemPrompt(prompt);
  assert.ok(assembled.indexOf(promptBlocks.BLOCK_SAFETY) < assembled.indexOf("[知识库检索上下文"));
  assert.ok(assembled.indexOf(promptBlocks.BLOCK_BASE_BEHAVIOR) < assembled.indexOf("[知识库检索上下文"));
});

// E-KB4: fullDocMode 高置信单篇场景全文注入
test("E-KB4: fullDocMode injects full content when single high-confidence doc dominates", () => {
  const ws = db.createWorkspace("kb4 full doc mode");
  // 长文档（~8k 字 → 多 chunk）；query 主要命中标题与首段（headingBoost +40）
  // 后续段不重复 query 词，使 top1 chunk 远超 top2，满足 score*2 阈值。
  const head = [
    "# 天猫六大行业特色人群 SOP",
    "## 天猫六大行业特色人群",
    "本文档定义天猫六大行业特色人群算法的完整执行 SOP。",
    "标签包括潮流、品质、大众、低价等六大类。",
  ].join("\n");
  // 后续段全部用无关词（避免 query term 出现）
  const filler = "标签权重分布按行业差异化映射。".repeat(300);
  const ending = "适用范围覆盖电商主流类目。".repeat(200);
  const longBody = `${head}\n\n${filler}\n\n${ending}`;
  data.createKnowledgeDoc({
    workspaceId: ws.id,
    title: "天猫六大行业特色人群 SOP",
    content: longBody,
    tags: ["天猫"],
  });
  // 干扰文档：与 query 完全无关
  data.createKnowledgeDoc({
    workspaceId: ws.id,
    title: "客单价口径",
    content: "客单价 = 销售额 / 订单数；按月口径统计。",
    tags: ["客单价"],
  });

  const query = "天猫六大行业特色人群";
  const chunkPrompt = injection.buildKnowledgePrompt(ws.id, query);
  const fullPrompt = injection.buildKnowledgePrompt(ws.id, query, { fullDocMode: true });

  // 现有行为：chunk 注入受 maxChars=6000 截断
  assert.match(chunkPrompt, /\[知识库检索上下文/);
  // 新行为：fullDocMode 命中高置信单篇 → 走全文分支（40000 上限）
  assert.match(fullPrompt, /\[知识库·全文引用｜高置信匹配\]/);
  // 全文注入应包含整篇所有章节（含末尾段，chunk 注入会因 maxChars 截断）
  assert.match(fullPrompt, /适用范围覆盖电商主流类目/);
  // 全文 > chunk 注入长度
  assert.ok(
    fullPrompt.length > chunkPrompt.length,
    `fullDocMode prompt (${fullPrompt.length}) should be longer than chunk prompt (${chunkPrompt.length})`,
  );
});

// E-KB4: 默认 fullDocMode=false 保持原有行为不变
test("E-KB4: fullDocMode defaults to false; existing chunk behavior unchanged", () => {
  const ws = db.createWorkspace("kb4 default behavior");
  data.createKnowledgeDoc({
    workspaceId: ws.id,
    title: "复购率 SOP",
    content: "复购率按自然月统计，排除退款。",
  });
  const a = injection.buildKnowledgePrompt(ws.id, "复购率");
  const b = injection.buildKnowledgePrompt(ws.id, "复购率", {});
  assert.equal(a, b);
  assert.doesNotMatch(a, /\[知识库·全文引用/);
});

// E-KB4: 多文档分数接近时 fullDocMode 不应触发全文（落回 chunk 注入）
test("E-KB4: fullDocMode falls back to chunks when top1 does not dominate top2", () => {
  const ws = db.createWorkspace("kb4 close scores");
  // 两篇都强匹配「会员复购」的文档：top1 不会显著领先 top2
  data.createKnowledgeDoc({
    workspaceId: ws.id,
    title: "会员复购口径 A",
    content: "会员复购统计按自然月。会员复购统计按自然月。会员复购统计按自然月。",
  });
  data.createKnowledgeDoc({
    workspaceId: ws.id,
    title: "会员复购口径 B",
    content: "会员复购统计按月度。会员复购统计按月度。会员复购统计按月度。",
  });
  const prompt = injection.buildKnowledgePrompt(ws.id, "会员复购", { fullDocMode: true });
  // 应回退到 chunk 注入（chunk header），不是全文 header
  assert.match(prompt, /\[知识库检索上下文/);
  assert.doesNotMatch(prompt, /\[知识库·全文引用/);
});

// D-KB1: searchKnowledgeDocs doc-level aggregation
test("D-KB1: searchKnowledgeDocs groups chunks by doc and returns doc-level results", () => {
  const ws = db.createWorkspace("kb1 docs");
  data.createKnowledgeDoc({
    workspaceId: ws.id,
    title: "复购率分析口径",
    content: "复购率定义为同一会员在同一自然月内发生两次及以上购买行为。\n\n指标计算窗口固定为 30 天。",
    tags: ["指标", "复购"],
  });
  data.createKnowledgeDoc({
    workspaceId: ws.id,
    title: "天气模块说明",
    content: "天气数据来自第三方 API，每小时刷新一次，与业务数据无关。",
  });
  const results = retrieval.searchKnowledgeDocs(ws.id, "复购率 自然月");
  assert.ok(results.length >= 1);
  assert.equal(results[0]!.doc.title, "复购率分析口径");
  assert.ok(results[0]!.score > 0);
  assert.ok(results[0]!.snippet.length > 0);
  assert.ok(results[0]!.snippet.length <= 200);
  assert.ok(results[0]!.matchedChunkCount >= 1);
  assert.ok(results[0]!.signals.relevance >= 0);
  assert.ok(results[0]!.signals.recency >= 0);
});

test("D-KB1: searchKnowledgeDocs topK caps result count", () => {
  const ws = db.createWorkspace("kb1 topk");
  for (let i = 0; i < 5; i++) {
    data.createKnowledgeDoc({ workspaceId: ws.id, title: `doc ${i}`, content: `复购率口径 sample ${i}` });
  }
  const results = retrieval.searchKnowledgeDocs(ws.id, "复购率", { topK: 2 });
  assert.equal(results.length, 2);
});

test("D-KB1: searchKnowledgeDocs empty query returns no results", () => {
  const ws = db.createWorkspace("kb1 empty");
  data.createKnowledgeDoc({ workspaceId: ws.id, title: "随便", content: "无关内容。" });
  assert.equal(retrieval.searchKnowledgeDocs(ws.id, "   ").length, 0);
});

// D-KB2: weighted tokenization — title match should rank above body-only match
test("D-KB2: weighted tokenization ranks title match above body-only match", () => {
  const ws = db.createWorkspace("kb2 weighted");
  // Doc A: query term only in body
  data.createKnowledgeDoc({
    workspaceId: ws.id,
    title: "无关标题",
    content: "本文讨论了复购率分析的一些方法。",
  });
  // Doc B: query term in title
  data.createKnowledgeDoc({
    workspaceId: ws.id,
    title: "复购率分析口径",
    content: "一些背景说明文字。",
  });
  const results = retrieval.searchKnowledgeDocs(ws.id, "复购率", { tokenizationMode: "weighted" });
  assert.ok(results.length >= 2);
  // Doc B (title match) should rank above Doc A (body-only match)
  const idxA = results.findIndex((r) => r.doc.title === "无关标题");
  const idxB = results.findIndex((r) => r.doc.title === "复购率分析口径");
  assert.ok(idxB < idxA, `title match (idx=${idxB}) should rank above body-only (idx=${idxA})`);
});

// D-KB2: tag exact-match boost
test("D-KB2: tag exact match boosts doc score", () => {
  const ws = db.createWorkspace("kb2 tag boost");
  data.createKnowledgeDoc({
    workspaceId: ws.id,
    title: "复购率文档",
    content: "复购率定义。",
    tags: ["复购率"],
  });
  data.createKnowledgeDoc({
    workspaceId: ws.id,
    title: "另一个复购率文档",
    content: "复购率定义。",
    tags: ["其他"],
  });
  const results = retrieval.searchKnowledgeDocs(ws.id, "复购率", { tokenizationMode: "weighted" });
  assert.ok(results.length >= 2);
  // Tagged doc should rank higher
  const idxTagged = results.findIndex((r) => r.doc.title === "复购率文档");
  const idxOther = results.findIndex((r) => r.doc.title === "另一个复购率文档");
  assert.ok(idxTagged < idxOther, `tagged doc (idx=${idxTagged}) should rank above untagged (idx=${idxOther})`);
});
