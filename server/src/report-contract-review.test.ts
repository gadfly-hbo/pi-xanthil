import test from "node:test";
import assert from "node:assert/strict";
import {
  buildContractAutoFixPrompt,
  buildContractReviewPrompt,
  buildReviewPrompt,
  reviewReportAgainstContract,
  validateContractRevisionResult,
} from "./report-review.ts";
import type { ReportContractContext } from "./business-requirement-communication.ts";

function contract(): ReportContractContext {
  return {
    projectName: "复购分析",
    source: { jsonPath: "business_requirements/复购-分析框架-20260703-101500.json", kind: "analysis_framework" },
    fallback: false,
    objective: "解释复购率下降原因",
    decisionScenario: "运营复盘会决定下周会员触达策略",
    requiredQuestions: ["复购率为什么下降？", "主要下降来源是什么？"],
    sections: [
      {
        title: "执行摘要",
        purpose: "概述结论和限制",
        keyQuestions: ["主要下降来源是什么？"],
        requiredEvidence: ["复购率", "渠道拆解"],
        outputGuidance: "先结论后证据",
        zeroHallucinationCheck: "数字标注来源",
      },
      {
        title: "风险与待确认",
        purpose: "列出限制",
        keyQuestions: ["是否包含私域？"],
        requiredEvidence: ["口径说明"],
        outputGuidance: "写明不确定性",
        zeroHallucinationCheck: "不得把待确认问题写成事实",
      },
    ],
    styleRules: [],
    forbiddenPatterns: ["不得把 openQuestions 写成事实"],
    acceptanceCriteria: ["解释下降来源"],
    openQuestions: ["是否包含私域？"],
    risks: ["私域范围待确认"],
    confirmedFacts: ["目标：解释复购率下降原因"],
    confirmedAssumptions: ["沿用复购率口径"],
  };
}

test("contract review detects missing sections", () => {
  const result = reviewReportAgainstContract("# 结论\n复购率为什么下降？复购率下降主要来自渠道拆解。", contract());
  assert.ok(result.sectionResults.some((item) => item.title === "风险与待确认" && item.status === "missing"));
  assert.match(result.rewritePlan.join("\n"), /风险与待确认/);
});

test("contract review detects missing evidence", () => {
  const result = reviewReportAgainstContract("# 执行摘要\n主要下降来源是什么？结论来自复购率变化。\n# 风险与待确认\n是否包含私域需待确认。", contract());
  assert.ok(result.evidenceGaps.some((item) => item.title === "渠道拆解"));
  assert.ok(result.evidenceGaps.some((item) => item.title === "口径说明"));
});

test("contract review detects open question misuse as fact", () => {
  const result = reviewReportAgainstContract("# 执行摘要\n私域已经包含在本次统计中，因此建议加大触达。\n# 风险与待确认\n口径说明已补充。", contract());
  assert.ok(result.openQuestionMisuse.some((item) => item.title === "是否包含私域？"));
  assert.match(result.rewritePlan.join("\n"), /待确认问题/);
});

test("contract review passes fully covered report", () => {
  const result = reviewReportAgainstContract([
    "# 执行摘要",
    "主要下降来源是什么？复购率下降主要来自渠道拆解，复购率=-3.2pp，来源：MetricSnapshot。",
    "本结论用于运营复盘会决定下周会员触达策略。",
    "# 风险与待确认",
    "是否包含私域？待确认。口径说明：当前仅覆盖已登记聚合数据。",
    "下一步行动：运营 owner 在下周复盘会前确认私域范围。",
  ].join("\n"), contract());
  assert.equal(result.evidenceGaps.length, 0);
  assert.equal(result.openQuestionMisuse.length, 0);
  assert.equal(result.actionability.status, "covered");
  assert.ok(result.totalScore >= 90);
});

test("contract review and auto-fix prompts carry contract constraints", () => {
  const c = contract();
  const review = reviewReportAgainstContract("# 报告\n建议加大触达。", c);
  const reviewPrompt = buildContractReviewPrompt("# 报告\n建议加大触达。", c);
  assert.match(reviewPrompt, /requiredQuestionsCoverage/);
  assert.match(reviewPrompt, /不得读取或推断 draw_data/);
  const fixPrompt = buildContractAutoFixPrompt("# 报告\n建议加大触达。", c, review);
  assert.match(fixPrompt, /不得新增无来源数字/);
  assert.match(fixPrompt, /openQuestions\/deferredQuestions/);
  const parsed = validateContractRevisionResult({
    revisedMarkdown: "# 执行摘要\n未新增数字。是否包含私域？待确认。",
    revisionSummary: ["补充待确认事项"],
    unresolvedGaps: ["渠道拆解未覆盖"],
  }, "# 原报告", review);
  assert.match(parsed.revisedMarkdown, /待确认/);
  assert.deepEqual(parsed.revisionSummary, ["补充待确认事项"]);
});

test("ordinary report review prompt remains unchanged for legacy path", () => {
  const prompt = buildReviewPrompt("# 普通报告", "检查逻辑");
  assert.match(prompt, /annotations/);
  assert.doesNotMatch(prompt, /ReportContractContext/);
});
