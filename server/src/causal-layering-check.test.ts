import { test } from "node:test";
import { strict as assert } from "node:assert";
import { checkCausalLayering } from "./causal-layering-check.ts";

test("checkCausalLayering: compliant report with all three sections → 0 findings", () => {
  const text = [
    "一、观察 Observation",
    "#1 销售额 12,500（来源: sales_tool, 等级 A）",
    "#2 复购率 12.5%（来源: retention_tool, 等级 B）",
    "",
    "二、推断 Inference",
    "【假设】短信过度触达推高取关率",
    "【支撑：#1 销售额 12,500 + #2 复购率 12.5%】",
    "【证伪条件】若短信频次降至 4 次/月后取关率未下降，则假设不成立",
    "",
    "三、建议 Action",
    "建议将短信频次降至 4 次/月（基于推断 #1）",
  ].join("\n");
  const findings = checkCausalLayering(text);
  assert.equal(findings.length, 0, "compliant report must have 0 findings");
});

test("checkCausalLayering: observation section with causal words → flagged", () => {
  const text = [
    "一、观察 Observation",
    "#1 销售额下降 12,500，因为短信触达过度导致用户流失。",
    "",
    "二、推断 Inference",
    "【假设】短信过度触达推高取关率",
    "【支撑：#1】",
    "【证伪条件】若频次降低后取关率未降",
    "",
    "三、建议 Action",
    "建议降低短信频次（基于推断 #1）",
  ].join("\n");
  const findings = checkCausalLayering(text);
  const causal = findings.filter((f) => f.kind === "observation_causal_word");
  assert.ok(causal.length >= 2, "must detect causal words in observation");
  assert.ok(causal.some((f) => f.segment.includes("因为")));
  assert.ok(causal.some((f) => f.segment.includes("导致")));
});

test("checkCausalLayering: observation section with inference words → flagged", () => {
  const text = [
    "一、观察 Observation",
    "#1 销售额 12,500，说明渠道效率提升，表明策略有效。",
    "",
    "二、推断 Inference",
    "【假设】渠道优化有效",
    "【支撑：#1】",
    "【证伪条件】若其他渠道未同步增长",
    "",
    "三、建议 Action",
    "建议继续优化（基于推断 #1）",
  ].join("\n");
  const findings = checkCausalLayering(text);
  const inference = findings.filter((f) => f.kind === "observation_inference_word");
  assert.ok(inference.length >= 2, "must detect inference words in observation");
  assert.ok(inference.some((f) => f.segment.includes("说明")));
  assert.ok(inference.some((f) => f.segment.includes("表明")));
});

test("checkCausalLayering: inference missing falsification condition → flagged", () => {
  const text = [
    "一、观察 Observation",
    "#1 销售额 12,500（来源: tool, 等级 A）",
    "",
    "二、推断 Inference",
    "【假设】短信过度触达推高取关率",
    "【支撑：#1 销售额 12,500】",
    "",
    "三、建议 Action",
    "建议降低短信频次（基于推断 #1）",
  ].join("\n");
  const findings = checkCausalLayering(text);
  const missing = findings.filter((f) => f.kind === "inference_missing_falsification");
  assert.equal(missing.length, 1, "must detect missing falsification");
});

test("checkCausalLayering: inference missing support reference → flagged", () => {
  const text = [
    "一、观察 Observation",
    "#1 销售额 12,500（来源: tool, 等级 A）",
    "",
    "二、推断 Inference",
    "【假设】短信过度触达推高取关率",
    "【证伪条件】若频次降低后取关率未降",
    "",
    "三、建议 Action",
    "建议降低短信频次（基于推断 #1）",
  ].join("\n");
  const findings = checkCausalLayering(text);
  const missing = findings.filter((f) => f.kind === "inference_missing_support");
  assert.equal(missing.length, 1, "must detect missing support");
});

test("checkCausalLayering: inference support without observation id → flagged", () => {
  const text = [
    "一、观察 Observation",
    "#1 销售额 12,500（来源: tool, 等级 A）",
    "",
    "二、推断 Inference",
    "【假设】短信过度触达推高取关率",
    "【支撑：销售额下降】",
    "【证伪条件】若频次降低后取关率未降",
    "",
    "三、建议 Action",
    "建议降低短信频次（基于推断 #1）",
  ].join("\n");
  const findings = checkCausalLayering(text);
  const missing = findings.filter((f) => f.kind === "inference_missing_support");
  assert.equal(missing.length, 1, "support must cite observation id");
});

test("checkCausalLayering: inference missing both support and falsification → both flagged", () => {
  const text = [
    "一、观察 Observation",
    "#1 销售额 12,500（来源: tool, 等级 A）",
    "",
    "二、推断 Inference",
    "【假设】短信过度触达推高取关率",
    "",
    "三、建议 Action",
    "建议降低短信频次（基于推断 #1）",
  ].join("\n");
  const findings = checkCausalLayering(text);
  assert.equal(findings.filter((f) => f.kind === "inference_missing_support").length, 1);
  assert.equal(findings.filter((f) => f.kind === "inference_missing_falsification").length, 1);
});

test("checkCausalLayering: action without inference reference → orphan flagged", () => {
  const text = [
    "一、观察 Observation",
    "#1 销售额 12,500（来源: tool, 等级 A）",
    "",
    "二、推断 Inference",
    "【假设】短信过度触达推高取关率",
    "【支撑：#1】",
    "【证伪条件】若频次降低后取关率未降",
    "",
    "三、建议 Action",
    "建议降低短信频次",
    "建议增加客服人力",
  ].join("\n");
  const findings = checkCausalLayering(text);
  const orphans = findings.filter((f) => f.kind === "action_orphan");
  assert.equal(orphans.length, 2, "both action items without inference ref must be flagged");
});

test("checkCausalLayering: bullet action without inference reference → orphan flagged", () => {
  const text = [
    "一、观察 Observation",
    "#1 销售额 12,500（来源: tool, 等级 A）",
    "",
    "二、推断 Inference",
    "【假设】短信过度触达推高取关率",
    "【支撑：#1】",
    "【证伪条件】若频次降低后取关率未降",
    "",
    "三、建议 Action",
    "- 建议降低短信频次",
    "1. 建议增加客服人力（基于推断 #1）",
  ].join("\n");
  const findings = checkCausalLayering(text);
  const orphans = findings.filter((f) => f.kind === "action_orphan");
  assert.equal(orphans.length, 1, "bullet action without inference ref must be flagged");
  assert.ok(orphans[0]?.segment.includes("建议降低短信频次"));
});

test("checkCausalLayering: text without section headers → 0 findings (graceful)", () => {
  const text = "这是一段普通的分析文本，没有分层结构。销售额 12,500，因为渠道优化。";
  const findings = checkCausalLayering(text);
  assert.equal(findings.length, 0, "unstructured text must not produce findings");
});

test("checkCausalLayering: multiple inferences with mixed compliance", () => {
  const text = [
    "一、观察 Observation",
    "#1 销售额 12,500（来源: tool, 等级 A）",
    "#2 复购率 12.5%（来源: tool, 等级 B）",
    "",
    "二、推断 Inference",
    "【假设】短信过度触达推高取关率",
    "【支撑：#1】",
    "【证伪条件】若频次降低后取关率未降",
    "",
    "【假设】复购率提升源于会员权益优化",
    "【支撑：#2】",
    "",
    "三、建议 Action",
    "建议降低短信频次（基于推断 #1）",
    "建议维持会员权益（基于推断 #2）",
  ].join("\n");
  const findings = checkCausalLayering(text);
  const missingFals = findings.filter((f) => f.kind === "inference_missing_falsification");
  assert.equal(missingFals.length, 1, "only second inference missing falsification");
  assert.equal(findings.filter((f) => f.kind === "action_orphan").length, 0, "actions with refs must not be orphan");
});
