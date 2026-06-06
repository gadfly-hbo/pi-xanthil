import assert from "node:assert/strict";
import test from "node:test";
import { tokenizeQuery, scoreHypothesis } from "./db.ts";
import type { HypothesisEntry } from "./types.ts";

function makeEntry(scene: string, hypothesis: string, evidence = "", updatedAt = 0, confirmCount = 0): HypothesisEntry {
  return {
    id: Math.random().toString(36),
    workspaceId: "ws1",
    scene,
    hypothesis,
    verdict: "confirmed",
    evidence,
    impact: "",
    source: "archive",
    enabled: true,
    confirmCount,
    rejectCount: 0,
    partialCount: 0,
    createdAt: 0,
    updatedAt,
  };
}

test("tokenizeQuery splits on punctuation and filters short tokens", () => {
  const tokens = tokenizeQuery("留存率下降，华南区拉新预算");
  // Splits on Chinese comma → two full-word segments
  assert.ok(tokens.includes("留存率下降"), "should include first segment");
  assert.ok(tokens.includes("华南区拉新预算"), "should include second segment");
  assert.ok(tokens.every((t) => t.length >= 2), "all tokens >= 2 chars");
});

test("tokenizeQuery filters Chinese stopwords", () => {
  const tokens = tokenizeQuery("这是一个测试的假设");
  assert.ok(!tokens.includes("这"), "stopword 这 should be filtered");
  assert.ok(!tokens.includes("的"), "stopword 的 should be filtered");
  assert.ok(!tokens.includes("一"), "single char should be filtered");
});

test("tokenizeQuery handles English terms", () => {
  const tokens = tokenizeQuery("retention rate declining in south region");
  assert.ok(tokens.includes("retention"), "should keep content words");
  assert.ok(tokens.includes("declining"), "should keep content words");
  assert.ok(!tokens.includes("in"), "stopword 'in' should be filtered");
});

test("scoreHypothesis returns higher score for more token matches", () => {
  const tokens = tokenizeQuery("留存率下降 华南区");
  const high = makeEntry("留存率下降", "华南区拉新预算不足导致留存率下降", "留存率 r=0.7");
  const low = makeEntry("客单价", "促销频次过高导致客单价下降", "客单价分析");
  assert.ok(scoreHypothesis(high, tokens) > scoreHypothesis(low, tokens));
});

test("scoreHypothesis returns 0 for no overlap", () => {
  const tokens = tokenizeQuery("留存率下降");
  const unrelated = makeEntry("转化率", "优惠券设计不当", "");
  assert.equal(scoreHypothesis(unrelated, tokens), 0);
});

test("scoreHypothesis matches tokens across scene + hypothesis + evidence fields", () => {
  const tokens = tokenizeQuery("触达频次 取关率");
  const entry = makeEntry(
    "留存",                              // scene: no match
    "过度短信触达推高取关率",            // hypothesis: 触达 + 取关率
    "触达频次与取关率正相关 r=0.62",    // evidence: 触达频次 + 取关率
  );
  assert.ok(scoreHypothesis(entry, tokens) >= 2, "should match tokens in multiple fields");
});

test("scoreHypothesis is case-insensitive for English tokens", () => {
  const tokens = tokenizeQuery("Retention Rate");
  const entry = makeEntry("留存", "retention rate correlates with notification frequency", "");
  assert.ok(scoreHypothesis(entry, tokens) >= 1);
});

test("scoreHypothesis weights scene field higher than hypothesis-only match", () => {
  const tokens = tokenizeQuery("留存率 华南区");
  // scene hit → weight 3 per token
  const sceneMatch = makeEntry("留存率分析", "促销力度不足导致转化率下降", "");
  // only hypothesis hits → weight 1 per token each
  const hypoMatch = makeEntry("转化率", "华南区留存率低于全国均值", "");
  assert.ok(
    scoreHypothesis(sceneMatch, tokens) > scoreHypothesis(hypoMatch, tokens),
    "scene match should outscore equivalent hypothesis-only match",
  );
});

test("scoreHypothesis accumulates score across multiple fields for the same token", () => {
  const tokens = tokenizeQuery("留存率");
  // token appears in both scene and hypothesis
  const entry = makeEntry("留存率下降", "华南区留存率持续低于均值", "");
  // scene(3) + hypothesis(1) = 4 per token occurrence
  assert.ok(scoreHypothesis(entry, tokens) >= 4, "scene+hypothesis match should accumulate");
});
