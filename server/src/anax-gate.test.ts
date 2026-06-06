import { test } from "node:test";
import assert from "node:assert/strict";
import { deterministicRedLineCheck, evaluateGate, enforceGate, extractVerdict } from "./anax-gate.ts";

function block(json: unknown): string {
  return "审查说明……\n\n```anax-verdict\n" + JSON.stringify(json) + "\n```";
}

test("pass: clean verdict, no blockers", () => {
  const v = evaluateGate(
    block({
      stage: "data_gate",
      redLines: [],
      stages: [{ stage: "data", confidence: "high", evidence: 3, dataQuality: 8.2 }],
      summary: "ok",
      modelVerdict: "pass",
    }),
    "data_gate",
  );
  assert.equal(v.verdict, "pass");
  assert.equal(v.blockers, 0);
});

test("blocked: low evidence + low confidence + low data quality", () => {
  const v = evaluateGate(
    block({
      stage: "data_gate",
      redLines: [],
      stages: [{ stage: "data", confidence: "low", evidence: 1, dataQuality: 4.5 }],
    }),
    "data_gate",
  );
  assert.equal(v.verdict, "blocked");
  assert.equal(v.blockers, 3); // confidence + evidence + dataQuality
});

test("blocked: red line wins even if model says pass", () => {
  const v = evaluateGate(
    block({
      stage: "review_gate",
      redLines: [{ id: "RL07", desc: "建议缺少负责人" }],
      stages: [{ stage: "recommend", confidence: "high", evidence: 5 }],
      modelVerdict: "pass",
    }),
    "review_gate",
  );
  assert.equal(v.verdict, "blocked");
  assert.equal(v.blockers, 1);
  assert.match(v.reasons[0]!, /RL07/);
});

test("blocked: missing verdict block is itself a blocker", () => {
  assert.equal(extractVerdict("no block here"), null);
  const v = evaluateGate("the model forgot to emit a verdict", "data_gate");
  assert.equal(v.verdict, "blocked");
  assert.equal(v.blockers, 1);
});

test("enforceGate ignores out-of-range confidence gracefully", () => {
  const v = enforceGate({ stages: [{ stage: "x", confidence: "bogus" as never, evidence: 2 }] }, "g");
  assert.equal(v.verdict, "pass");
});

// deterministicRedLineCheck

test("deterministic RL03: 综合评分 < 5 blocks even if LLM says pass", () => {
  const extra = deterministicRedLineCheck(
    { data: "结论：数据整体较差。\n综合评分: 4.2/10\n后续建议..." },
    "data_gate",
  );
  assert.equal(extra.length, 1);
  assert.match(extra[0]!, /RL03/);
});

test("deterministic RL06: crossValidate hypothesis without cross-validation in insight", () => {
  const planText = [
    "分析规范内容...",
    "```anax-hypotheses-plan",
    JSON.stringify([{ id: "H1", hypothesis: "留存率下降因短信过度触达", crossValidate: true }]),
    "```",
  ].join("\n");
  const extra = deterministicRedLineCheck(
    { plan: planText, insight: "H1 验证结果：p=0.03，效应量 r=0.58", recommend: "负责人: 市场部\n成功标准: 取关率降15%\n验证方案: A/B测试" },
    "review_gate",
  );
  // insight has no "交叉验证" → RL06 fires
  assert.ok(extra.some((r) => r.includes("RL06")));
});

test("deterministic RL07: missing required elements in recommend", () => {
  const planText = [
    "```anax-hypotheses-plan",
    JSON.stringify([{ id: "H1", crossValidate: false }]),
    "```",
  ].join("\n");
  const extra = deterministicRedLineCheck(
    {
      plan: planText,
      insight: "交叉验证完成",
      recommend: "建议缩减短信频次，预期降低取关率15%。",
    },
    "review_gate",
  );
  // missing 负责人, 成功标准, 验证方案
  assert.ok(extra.some((r) => r.includes("RL07")));
  assert.ok(extra.some((r) => r.includes("负责人")));
});
