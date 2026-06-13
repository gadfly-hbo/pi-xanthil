import { test } from "node:test";
import assert from "node:assert/strict";
import { deterministicRedLineCheck, evaluateGate, evaluateSqlGate, enforceGate, extractVerdict } from "./anax-gate.ts";

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

test("pass: verdict block tolerates marker directly followed by JSON", () => {
  const v = evaluateGate(
    "```anax-verdict{\"stage\":\"data_gate\",\"redLines\":[],\"stages\":[{\"stage\":\"data\",\"confidence\":\"medium\",\"evidence\":2,\"dataQuality\":8}],\"modelVerdict\":\"pass\"}\n```",
    "data_gate",
  );
  assert.equal(v.verdict, "pass");
  assert.equal(v.blockers, 0);
});

test("pass: verdict parser skips invalid examples before the final block", () => {
  const v = evaluateGate(
    [
      "模型先复述了一个坏示例：",
      "```anax-verdict",
      "{\"stage\":\"data_gate\", // invalid comment",
      "```",
      "最终裁决：",
      "```anax-verdict{\"stage\":\"data_gate\",\"redLines\":[],\"stages\":[{\"stage\":\"data\",\"confidence\":\"medium\",\"evidence\":2,\"dataQuality\":8}],\"modelVerdict\":\"pass\"}```",
    ].join("\n"),
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

test("pass: data_gate does not block on non-aggregate subdimension scores", () => {
  const v = evaluateGate(
    block({
      stage: "data_gate",
      redLines: [],
      stages: [
        { stage: "结构完整性审查", confidence: "high", evidence: 4, dataQuality: 10 },
        { stage: "时效性与观测窗口核查", confidence: "medium", evidence: 2, dataQuality: 6 },
        { stage: "口径异常识别", confidence: "medium", evidence: 3, dataQuality: 6 },
      ],
      modelVerdict: "pass",
    }),
    "data_gate",
  );
  assert.equal(v.verdict, "pass");
  assert.equal(v.blockers, 0);
});

test("pass: data_gate does not block on low evidence in non-aggregate subdimensions", () => {
  const v = evaluateGate(
    block({
      stage: "data_gate",
      redLines: [],
      stages: [
        { stage: "结构完整性", confidence: "high", evidence: 4, dataQuality: 10 },
        { stage: "时效性", confidence: "medium", evidence: 1, dataQuality: 6 },
        { stage: "口径清晰度", confidence: "medium", evidence: 1, dataQuality: 6 },
      ],
      modelVerdict: "pass",
    }),
    "data_gate",
  );
  assert.equal(v.verdict, "pass");
  assert.equal(v.blockers, 0);
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

test("pass: redLines entries that explicitly say pass are not blockers", () => {
  const v = evaluateGate(
    block({
      stage: "review_gate",
      redLines: [
        { id: "RL01", desc: "数据质量评分 8/10 ≥ 7 阈值，PASS" },
        { id: "RL02", desc: "未触发红线，通过" },
      ],
      stages: [{ stage: "recommend", confidence: "high", evidence: 5 }],
      modelVerdict: "pass",
    }),
    "review_gate",
  );
  assert.equal(v.verdict, "pass");
  assert.deepEqual(v.redLines, []);
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

test("sql_gate passes only when execution succeeds with rows and required fields", () => {
  const v = evaluateSqlGate({
    run_sql: JSON.stringify({
      kind: "sql_tool",
      code: 0,
      success: true,
      columns: ["customer_id", "gmv"],
      rows: [{ customer_id: "C1", gmv: 100 }],
      rowCount: 1,
      requiredFields: ["customer_id", "gmv"],
    }),
  });

  assert.equal(v.verdict, "pass");
  assert.equal(v.blockers, 0);
});

test("sql_gate blocks on failed execution, empty result, and missing required fields", () => {
  const v = evaluateSqlGate({
    run_sql: JSON.stringify({
      kind: "sql_tool",
      code: 1,
      success: false,
      error: "no such column: gmv",
      columns: ["customer_id"],
      rows: [],
      rowCount: 0,
      requiredFields: ["customer_id", "gmv"],
    }),
  });

  assert.equal(v.verdict, "blocked");
  assert.equal(v.blockers, 3);
  assert.ok(v.reasons.some((reason) => reason.includes("code=1")));
  assert.ok(v.reasons.some((reason) => reason.includes("rowCount=0")));
  assert.ok(v.reasons.some((reason) => reason.includes("gmv")));
});
