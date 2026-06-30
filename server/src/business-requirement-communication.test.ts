import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { chmodSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import {
  buildRequirementCommunicationPrompt,
  buildAnalysisFrameworkFromConfirmedPrompt,
  buildRequirementImportDocumentsPrompt,
  buildAnalysisFrameworkFromConfirmedTracePayload,
  buildConfirmedBusinessRequirement,
  buildRequirementConfirmationTracePayload,
  buildRequirementImportTracePayload,
  buildRequirementReviewContext,
  isConfirmedBusinessRequirementJsonPath,
  makeRequirementImportDocumentFromText,
  parseAnalysisFrameworkFromConfirmedRequest,
  parseRequirementImportDocumentsJson,
  parseRequirementImportDocumentsRequest,
  parseRequirementCommunicationJson,
  parseRequirementCommunicationConfirmInput,
  parseRequirementCommunicationRequest,
  renderConfirmedBusinessRequirementMarkdown,
  runAnalysisFrameworkFromConfirmedRequirement,
  runRequirementImportDocuments,
  runRequirementCommunicationClarification,
  validateRequirementImportDocumentAccess,
  validateRequirementImportDocumentsResult,
  validateAnalysisFrameworkFromConfirmedResult,
  validateRequirementCommunicationResult,
} from "./business-requirement-communication.ts";

test("parseRequirementCommunicationRequest validates shape", () => {
  assert.throws(() => parseRequirementCommunicationRequest({ scene: "bad", message: "做个分析" }), /scene/);
  assert.throws(() => parseRequirementCommunicationRequest({ scene: "daily", message: "" }), /message required/);
  assert.deepEqual(parseRequirementCommunicationRequest({ scene: "topic", message: "  分析会员增长  ", contextRefs: ["a", 1] }), {
    scene: "topic",
    message: "分析会员增长",
    contextRefs: ["a"],
    history: undefined,
    model: undefined,
  });
});

test("parseRequirementCommunicationJson repairs loose JSON", () => {
  const parsed = parseRequirementCommunicationJson(`Here is json
  \`\`\`json
  {
    // model comment
    "clarifyingQuestions": [{"priority":"must_confirm","question":"目标是什么？","why":"影响分析路径",}],
    "assumptions": [],
    "requirementDraft": {"background":"","objective":"","scope":[],"metrics":[],"questions":[],"outputs":[],"successCriteria":[],"risks":[],"assumptions":[],},
    "riskNotes": [],
  }
  \`\`\``) as { clarifyingQuestions: Array<{ priority: string }> };
  assert.equal(parsed.clarifyingQuestions[0]?.priority, "must_confirm");
});

test("parseRequirementCommunicationJson ignores trailing non-json text", () => {
  const parsed = parseRequirementCommunicationJson(`{
    "clarifyingQuestions": [{"priority":"must_confirm","question":"目标是什么？","why":"影响分析路径"}],
    "assumptions": [],
    "requirementDraft": {"background":"","objective":"","scope":[],"metrics":[],"questions":[],"outputs":[],"successCriteria":[],"risks":[],"assumptions":[]},
    "riskNotes": []
  }

  说明：上面是 JSON。 {"extra": "should be ignored"}`) as { clarifyingQuestions: Array<{ question: string }> };
  assert.equal(parsed.clarifyingQuestions[0]?.question, "目标是什么？");
});

test("parseRequirementImportDocumentsRequest validates sources and truncates localText", () => {
  assert.throws(() => parseRequirementImportDocumentsRequest({ scene: "daily", documents: [] }), /documents/);
  assert.throws(() => parseRequirementImportDocumentsRequest({ scene: "daily", documents: [{ source: "draw_data" }] }), /document source/);
  assert.throws(() => parseRequirementImportDocumentsRequest({ scene: "daily", documents: [{ source: "report", relPath: "../secret.md" }] }), /relPath/);
  const parsed = parseRequirementImportDocumentsRequest({
    scene: "topic",
    message: "  整理 brief  ",
    documents: [{ source: "localText", name: "会议纪要", localText: "x".repeat(25000) }],
  });
  assert.equal(parsed.scene, "topic");
  assert.equal(parsed.message, "整理 brief");
  assert.equal(parsed.documents[0]?.localText?.length, 24000);
});

test("validateRequirementImportDocumentAccess blocks raw and exploration paths", () => {
  assert.throws(
    () => validateRequirementImportDocumentAccess({ source: "report", pathId: 1 }, { id: 1, folder: "draw_data", kind: "file", name: "orders.csv" }),
    /report registered path/,
  );
  assert.throws(
    () => validateRequirementImportDocumentAccess({ source: "clean_data", pathId: 2 }, { id: 2, folder: "data_exploration", kind: "file", name: "profile.json" }),
    /clean_data registered path/,
  );
  assert.throws(
    () => validateRequirementImportDocumentAccess({ source: "business_requirements", pathId: 3, relPath: "reports/a.md" }, { id: 3, folder: "report", kind: "dir", name: "reports" }),
    /business_requirements\//,
  );
  assert.doesNotThrow(() => validateRequirementImportDocumentAccess({ source: "localText", localText: "用户粘贴 brief" }));
});

test("buildRequirementImportDocumentsPrompt keeps clean_data as metadata only", () => {
  const { systemPrompt, prompt } = buildRequirementImportDocumentsPrompt(
    { scene: "daily", documents: [{ source: "clean_data", pathId: 2 }], message: "整理沟通上下文" },
    [makeRequirementImportDocumentFromText({ source: "clean_data", pathId: 2, name: "retention.csv" }, 0, "仅提供 clean_data 路径元信息，未读取正文。\nname=retention.csv", ["clean_data body not read"])],
  );
  assert.match(systemPrompt, /不得把未确认内容写成事实/);
  assert.match(systemPrompt, /clean_data 首版只能使用路径元信息/);
  assert.match(prompt, /retention\.csv/);
  assert.doesNotMatch(prompt, /手机号|13800000000|订单号/);
});

test("runRequirementImportDocuments repairs JSON and normalizes output", async () => {
  const documents = [makeRequirementImportDocumentFromText({ source: "localText", localText: "会议纪要：目标是提升复购" }, 0, "会议纪要：目标是提升复购")];
  const result = await runRequirementImportDocuments(
    { scene: "daily", documents: [{ source: "localText", localText: "会议纪要：目标是提升复购" }] },
    documents,
    async () => `\`\`\`json
    {
      "documentSummaries": [{"id":"doc-1","name":"会议纪要","source":"localText","summary":"目标是提升复购",}],
      "extractedFacts": ["材料声称目标是提升复购",],
      "extractedQuestions": [{"category":"指标","question":"复购率口径是什么？","why":"影响判断","priority":"P0",}],
      "extractedAssumptions": [{"text":"沿用历史复购口径","source":"doc-1",}],
      "suggestedMessage": "以下来自导入材料，需用户确认：提升复购",
      "riskNotes": ["口径未确认",],
    }
    \`\`\``,
  );
  assert.equal(result.documentSummaries[0]?.summary, "目标是提升复购");
  assert.equal(result.extractedQuestions[0]?.priority, "must_confirm");
  assert.match(result.suggestedMessage, /需用户确认/);
  const tracePayload = JSON.stringify(buildRequirementImportTracePayload({ scene: "daily", documents: [{ source: "localText", localText: "手机号 13800000000" }] }, documents, result));
  assert.match(tracePayload, /documentCount/);
  assert.doesNotMatch(tracePayload, /13800000000|手机号|会议纪要/);
});

test("validateRequirementImportDocumentsResult falls back to imported document metadata", () => {
  const doc = makeRequirementImportDocumentFromText({ source: "clean_data", pathId: 1, name: "agg.csv" }, 0, "仅元信息", ["clean_data body not read"]);
  const result = validateRequirementImportDocumentsResult({ documentSummaries: [], extractedQuestions: [], extractedFacts: [], extractedAssumptions: [], suggestedMessage: "", riskNotes: [] }, [doc]);
  assert.equal(result.documentSummaries[0]?.name, "agg.csv");
  assert.deepEqual(result.documentSummaries[0]?.warnings, ["clean_data body not read"]);
});

test("parseRequirementImportDocumentsJson repairs loose JSON", () => {
  const parsed = parseRequirementImportDocumentsJson(`{"documentSummaries":[],}`) as { documentSummaries: unknown[] };
  assert.deepEqual(parsed.documentSummaries, []);
});

test("validateRequirementCommunicationResult sorts question priority and keeps assumptions", () => {
  const result = validateRequirementCommunicationResult({
    clarifyingQuestions: [
      { priority: "can_defer", category: "交付", question: "要什么输出？", why: "影响交付" },
      { priority: "must_confirm", category: "目标", question: "业务目标是什么？", why: "不确认无法分析" },
    ],
    assumptions: [{ text: "本次只覆盖会员", status: "proposed", source: "model" }],
    requirementDraft: { background: "", objective: "", scope: ["会员"], metrics: [], questions: [], outputs: [], successCriteria: [], risks: [], assumptions: ["本次只覆盖会员"] },
    riskNotes: ["指标口径未确认"],
  });
  assert.equal(result.clarifyingQuestions[0]?.priority, "must_confirm");
  assert.equal(result.assumptions[0]?.status, "proposed");
  assert.equal(result.riskNotes[0], "指标口径未确认");
});

test("build prompt uses only path metadata, not draw_data or clean_data body", () => {
  const rawRow = "手机号,订单号,金额\n13800000000,A001,99";
  const { prompt, systemPrompt } = buildRequirementCommunicationPrompt(
    { scene: "daily", message: "帮我分析复购", contextRefs: [], history: undefined },
    {
      businessContextSummary: "品牌定位：高端会员运营",
      metricSummary: "- 复购率 · 口径:复购人数/购买人数",
      pathMetas: [
        { id: 1, folder: "draw_data", kind: "file", name: "orders.csv" },
        { id: 2, folder: "clean_data", kind: "file", name: "retention_summary.csv", description: "留存聚合表" },
      ],
    },
  );
  assert.match(systemPrompt, /不得读取或推断原始行级数据/);
  assert.match(prompt, /folder=draw_data/);
  assert.match(prompt, /retention_summary\.csv/);
  assert.doesNotMatch(prompt, /13800000000|A001/);
  assert.doesNotMatch(prompt, new RegExp(rawRow));
});

test("runRequirementCommunicationClarification returns stable editable structure", async () => {
  const result = await runRequirementCommunicationClarification(
    { scene: "recurring", message: "每周复盘销售", contextRefs: [], history: undefined },
    { metricSummary: "销售额口径已确认" },
    async () => JSON.stringify({
      clarifyingQuestions: [
        { id: "q-1", priority: "must_confirm", category: "指标", question: "销售额是否含退款？", why: "影响口径", status: "pending" },
        { id: "q-2", priority: "should_confirm", category: "范围", question: "覆盖哪些渠道？", why: "影响数据范围", status: "pending" },
        { id: "q-3", priority: "should_confirm", category: "交付", question: "输出给谁看？", why: "影响呈现粒度", status: "pending" },
      ],
      assumptions: [{ id: "a-1", text: "默认按周复盘", status: "proposed", source: "user" }],
      requirementDraft: { background: "", objective: "销售复盘", scope: [], metrics: ["销售额"], questions: [], outputs: ["周报"], successCriteria: [], risks: [], assumptions: ["默认按周复盘"] },
      riskNotes: ["渠道范围未确认"],
    }),
  );
  assert.equal(result.requirementDraft.objective, "销售复盘");
  assert.equal(result.clarifyingQuestions.length, 3);
  assert.equal(result.assumptions[0]?.source, "user");
});

test("runRequirementCommunicationClarification falls back when model JSON is invalid", async () => {
  const result = await runRequirementCommunicationClarification(
    { scene: "daily", message: "分析本月会员复购率下滑原因，并输出策略" },
    { metricSummary: "", pathMetas: [] },
    async () => `{"clarifyingQuestions": [`,
  );
  assert.ok(result.clarifyingQuestions.length >= 3);
  assert.equal(result.clarifyingQuestions[0]?.priority, "must_confirm");
  assert.match(result.requirementDraft.objective, /复购率下滑/);
  assert.match(result.riskNotes.join("\n"), /兜底/);
});

test("confirmed requirement separates facts, assumptions, and deferred questions", () => {
  const input = parseRequirementCommunicationConfirmInput({
    scene: "topic",
    pathId: 1,
    title: "会员复购分析",
    confirmedBy: "pm",
    message: "分析会员复购，不包含任何数据文件正文",
    clarifyingQuestions: [
      { id: "q-1", priority: "must_confirm", category: "目标", question: "目标是什么？", why: "影响范围", status: "answered", answer: "定位复购下降原因" },
      { id: "q-2", priority: "should_confirm", category: "渠道", question: "是否覆盖私域？", why: "影响范围", status: "deferred" },
      { id: "q-3", priority: "can_defer", category: "输出", question: "是否需要 PPT？", why: "影响交付", status: "skipped" },
    ],
    assumptions: [
      { id: "a-1", text: "先按月度会员口径分析", status: "confirmed", source: "model" },
      { id: "a-2", text: "私域渠道已完整接入", status: "rejected", source: "model" },
      { id: "a-3", text: "后续补充门店维度", status: "deferred", source: "user" },
    ],
    requirementDraft: { background: "复购下降", objective: "定位复购下降原因", scope: ["会员"], metrics: ["复购率"], questions: ["复购为什么下降？"], outputs: ["分析报告"], successCriteria: ["解释主要下降来源"], risks: ["渠道未确认"], assumptions: [] },
    riskNotes: ["私域范围待确认"],
  });
  const structured = buildConfirmedBusinessRequirement(input, "business_requirements/comm.json", 1_700_000_000_000);
  assert.match(structured.businessFacts.join("\n"), /定位复购下降原因/);
  assert.deepEqual(structured.confirmedAssumptions, ["先按月度会员口径分析"]);
  assert.deepEqual(structured.rejectedAssumptions, ["私域渠道已完整接入"]);
  assert.deepEqual(structured.deferredQuestions, ["是否覆盖私域？", "是否需要 PPT？"]);
  assert.doesNotMatch(structured.businessFacts.join("\n"), /是否覆盖私域/);
  assert.match(renderConfirmedBusinessRequirementMarkdown(structured), /## Assumptions/);
  assert.match(buildRequirementReviewContext(structured), /成功标准/);
});

test("confirmation trace payload is metadata only", () => {
  const rawSample = "手机号,订单号\n13800000000,A001";
  const input = parseRequirementCommunicationConfirmInput({
    scene: "daily",
    pathId: 2,
    title: "复购分析",
    confirmedBy: "user",
    message: rawSample,
    clarifyingQuestions: [
      { id: "q-1", priority: "must_confirm", category: "目标", question: "目标？", why: "必要", status: "answered", answer: "找原因" },
    ],
    assumptions: [{ id: "a-1", text: "按月分析", status: "confirmed", source: "user" }],
    requirementDraft: { background: "", objective: "找原因", scope: [], metrics: [], questions: [], outputs: [], successCriteria: [], risks: [], assumptions: [] },
    riskNotes: [],
  });
  const structured = buildConfirmedBusinessRequirement(input, "business_requirements/comm.json", Date.now());
  const payloadText = JSON.stringify(buildRequirementConfirmationTracePayload(input, structured));
  assert.match(payloadText, /questionCount/);
  assert.doesNotMatch(payloadText, /13800000000|A001|手机号/);
});

test("review context only accepts confirmed requirement json paths", () => {
  assert.equal(isConfirmedBusinessRequirementJsonPath("business_requirements/会员复购-确认需求-20260630-101500.json"), true);
  assert.equal(isConfirmedBusinessRequirementJsonPath("business_requirements/会员复购-分析框架-20260630-101500.json"), false);
  assert.equal(isConfirmedBusinessRequirementJsonPath("business_requirements/communications/会员复购-沟通记录-20260630-101500.json"), false);
  assert.equal(isConfirmedBusinessRequirementJsonPath("../business_requirements/会员复购-确认需求-20260630-101500.json"), false);
});

test("parseAnalysisFrameworkFromConfirmedRequest guards confirmed requirement path", () => {
  assert.throws(
    () => parseAnalysisFrameworkFromConfirmedRequest({ pathId: 1, confirmedRequirementJsonPath: "business_requirements/会员复购-分析框架-20260630-101500.json" }),
    /confirmedRequirementJsonPath/,
  );
  assert.throws(
    () => parseAnalysisFrameworkFromConfirmedRequest({ pathId: 1, confirmedRequirementJsonPath: "business_requirements/communications/会员复购-沟通记录-20260630-101500.json" }),
    /confirmedRequirementJsonPath/,
  );
  assert.deepEqual(parseAnalysisFrameworkFromConfirmedRequest({ pathId: "2", confirmedRequirementJsonPath: "business_requirements/会员复购-确认需求-20260630-101500.json" }), {
    pathId: 2,
    confirmedRequirementJsonPath: "business_requirements/会员复购-确认需求-20260630-101500.json",
    model: undefined,
  });
});

test("analysis framework from confirmed keeps deferred out of facts", async () => {
  const input = parseRequirementCommunicationConfirmInput({
    scene: "topic",
    pathId: 1,
    title: "会员复购分析",
    confirmedBy: "pm",
    clarifyingQuestions: [
      { id: "q-1", priority: "must_confirm", category: "目标", question: "目标？", why: "必要", status: "answered", answer: "定位复购下降原因" },
      { id: "q-2", priority: "should_confirm", category: "渠道", question: "是否覆盖私域？", why: "影响范围", status: "deferred" },
    ],
    assumptions: [{ id: "a-1", text: "沿用已确认复购率口径", status: "confirmed", source: "metric" }],
    requirementDraft: { background: "复购下降", objective: "定位复购下降原因", scope: ["会员"], metrics: ["复购率"], questions: ["复购为什么下降？"], outputs: ["分析报告"], successCriteria: ["解释主要下降来源"], risks: ["渠道未确认"], assumptions: [] },
    riskNotes: ["私域范围待确认"],
  });
  const confirmed = buildConfirmedBusinessRequirement(input, "business_requirements/communications/qa.json", 1_800_000_000_000);
  const { systemPrompt, prompt } = buildAnalysisFrameworkFromConfirmedPrompt(confirmed, "# 会员复购分析");
  assert.match(systemPrompt, /deferred\/skipped\/assumed\/pending/);
  assert.match(prompt, /confirmedFacts/);
  assert.match(prompt, /deferredQuestions/);

  const result = await runAnalysisFrameworkFromConfirmedRequirement(
    confirmed,
    { jsonPath: "business_requirements/会员复购-确认需求-20260630-101500.json", markdownPath: "business_requirements/会员复购-确认需求-20260630-101500.md" },
    async () => JSON.stringify({
      projectName: "会员复购分析",
      businessFacts: ["目标：定位复购下降原因", "是否覆盖私域？"],
      inferredNeeds: [],
      analysisQuestions: ["复购为什么下降？"],
      metrics: [{ name: "复购率", definition: "沿用确认需求口径", source: "confirmed_requirement" }],
      dimensions: ["会员"],
      dataNeeds: [{ name: "会员复购聚合表", fields: ["member_id", "month"], purpose: "验证复购变化", priority: "P0" }],
      analysisFramework: [{ businessQuestion: "复购为什么下降？", hypothesis: "可能与渠道有关", method: "拆解复购率变化", requiredData: ["复购率"], expectedOutput: "下降来源" }],
      reportFramework: [{ section: "结论", purpose: "回应目标", keyQuestions: ["解释主要下降来源"], requiredEvidence: ["复购率"], outputGuidance: "先结论后证据", zeroHallucinationCheck: "" }],
      deliverables: ["分析报告"],
      openQuestions: [],
      risks: [],
    }),
  );
  assert.match(result.analysisFramework[0]?.method ?? "", /基于确认需求/);
  assert.match(result.reportFramework[0]?.purpose ?? "", /基于确认需求/);
  assert.doesNotMatch(result.businessFacts.join("\n"), /是否覆盖私域/);
  assert.match(result.openQuestions.join("\n"), /是否覆盖私域/);
  assert.match(result.risks.join("\n"), /待确认：是否覆盖私域/);
  const tracePayload = JSON.stringify(buildAnalysisFrameworkFromConfirmedTracePayload(result));
  assert.match(tracePayload, /confirmedRequirementBasename/);
  assert.doesNotMatch(tracePayload, /定位复购下降原因|是否覆盖私域/);
});

test("validateAnalysisFrameworkFromConfirmedResult rejects deferred facts by normalization", () => {
  const confirmed = buildConfirmedBusinessRequirement(parseRequirementCommunicationConfirmInput({
    scene: "daily",
    pathId: 1,
    title: "销售复盘",
    confirmedBy: "qa",
    clarifyingQuestions: [
      { id: "q-1", priority: "must_confirm", category: "目标", question: "目标？", why: "必要", status: "answered", answer: "解释销售变化" },
      { id: "q-2", priority: "should_confirm", category: "范围", question: "是否包含线下？", why: "影响范围", status: "assumed" },
    ],
    assumptions: [],
    requirementDraft: { background: "", objective: "解释销售变化", scope: [], metrics: [], questions: ["销售为什么变化？"], outputs: ["周报"], successCriteria: [], risks: [], assumptions: [] },
    riskNotes: [],
  }), "business_requirements/communications/qa.json", 1);
  const result = validateAnalysisFrameworkFromConfirmedResult({ businessFacts: ["是否包含线下？"] }, confirmed, { jsonPath: "business_requirements/销售复盘-确认需求-20260630-101500.json" });
  assert.doesNotMatch(result.businessFacts.join("\n"), /是否包含线下/);
  assert.match(result.openQuestions.join("\n"), /是否包含线下/);
});

test("X-BRC4 acceptance covers daily topic and recurring confirmation contract", () => {
  const cases = [
    {
      scene: "daily" as const,
      title: "日常复购快问",
      objective: "定位本周会员复购下降的关键原因",
      answered: "先看本周复购率相对上周的下降来源",
      deferredStatus: "skipped" as const,
      deferredQuestion: "是否需要输出活动建议？",
      output: "日常结论",
      success: "指出最主要下降来源",
      assumption: "沿用已确认复购率口径",
    },
    {
      scene: "topic" as const,
      title: "专题会员增长 brief",
      objective: "形成会员增长专题 brief",
      answered: "覆盖会员增长、复购和流失预警三个范围",
      deferredStatus: "deferred" as const,
      deferredQuestion: "owner 是否由会员运营团队承担？",
      output: "专题分析报告",
      success: "明确 owner、交付物和评审标准",
      assumption: "交付物默认面向运营评审会",
    },
    {
      scene: "recurring" as const,
      title: "重复周报需求复用",
      objective: "复用历史周报口径并标出本次差异",
      answered: "本次新增渠道维度对比，其余沿用历史口径",
      deferredStatus: "assumed" as const,
      deferredQuestion: "是否固化为下周模板？",
      output: "周报需求模板建议",
      success: "标出本次差异和可模板化字段",
      assumption: "历史销售额口径继续有效",
    },
  ];

  for (const item of cases) {
    const input = parseRequirementCommunicationConfirmInput({
      scene: item.scene,
      pathId: 1,
      title: item.title,
      confirmedBy: "qa",
      message: "用户诉求，不包含数据文件正文。手机号,订单号\\n13800000000,A001",
      clarifyingQuestions: [
        { id: "q-1", priority: "must_confirm", category: "目标", question: "本次目标是什么？", why: "影响分析路径", status: "answered", answer: item.answered },
        { id: "q-2", priority: "should_confirm", category: "后续", question: item.deferredQuestion, why: "影响后续动作", status: item.deferredStatus },
        { id: "q-3", priority: "can_defer", category: "交付", question: "是否需要 PPT？", why: "影响交付格式", status: "skipped" },
      ],
      assumptions: [
        { id: "a-1", text: item.assumption, status: "confirmed", source: "metric" },
        { id: "a-2", text: "原始明细已可直接给模型读取", status: "rejected", source: "model" },
      ],
      requirementDraft: {
        background: `${item.title} 背景`,
        objective: item.objective,
        scope: ["会员", "渠道"],
        metrics: ["复购率", "销售额"],
        questions: [item.objective],
        outputs: [item.output],
        successCriteria: [item.success],
        risks: ["未确认项不得写成事实"],
        assumptions: [],
      },
      riskNotes: ["只允许使用已登记路径元信息和聚合说明"],
    });

    const structured = buildConfirmedBusinessRequirement(input, "business_requirements/communications/qa.json", 1_800_000_000_000);
    assert.equal(structured.communication.scene, item.scene);
    assert.deepEqual(structured.confirmedAssumptions, [item.assumption]);
    assert.deepEqual(structured.rejectedAssumptions, ["原始明细已可直接给模型读取"]);
    assert.match(structured.confirmedFacts.join("\n"), new RegExp(item.answered));
    assert.doesNotMatch(structured.confirmedFacts.join("\n"), new RegExp(item.deferredQuestion));
    assert.match(structured.deferredQuestions.join("\n"), new RegExp(item.deferredQuestion));

    const markdown = renderConfirmedBusinessRequirementMarkdown(structured);
    assert.match(markdown, /## Confirmed Facts/);
    assert.match(markdown, /## Assumptions/);
    assert.match(markdown, /## Deferred \/ Skipped Questions/);

    const reviewContext = buildRequirementReviewContext(structured);
    assert.match(reviewContext, new RegExp(item.objective));
    assert.match(reviewContext, new RegExp(item.success));
    assert.match(reviewContext, new RegExp(item.assumption));
    assert.match(reviewContext, new RegExp(item.deferredQuestion));

    const tracePayload = JSON.stringify(buildRequirementConfirmationTracePayload(input, structured));
    assert.match(tracePayload, new RegExp(`"scene":"${item.scene}"`));
    assert.doesNotMatch(tracePayload, /13800000000|A001|手机号|订单号/);
  }
});

test("import-documents route rejects draw_data and data_exploration before LLM", async () => {
  process.env.XANTHIL_DATA_DIR = mkdtempSync(join(tmpdir(), "pi-xanthil-brc-import-route-"));
  const fakePi = join(process.env.XANTHIL_DATA_DIR, "fake-pi.mjs");
  writeFileSync(fakePi, `#!/usr/bin/env node
console.log(JSON.stringify({
  type: "message_end",
  message: {
    role: "assistant",
    content: [{
      type: "text",
      text: JSON.stringify({
        clarifyingQuestions: [
          { id: "q-1", priority: "must_confirm", category: "目标", question: "要确认什么目标？", why: "避免跑偏", status: "pending" },
          { id: "q-2", priority: "should_confirm", category: "范围", question: "分析范围是什么？", why: "影响数据选择", status: "pending" },
          { id: "q-3", priority: "can_defer", category: "交付", question: "需要什么交付物？", why: "影响输出形式", status: "pending" }
        ],
        assumptions: [{ id: "a-1", text: "先按当前业务环境推进", status: "proposed", source: "business_context" }],
        requirementDraft: { background: "", objective: "分析会员复购", scope: [], metrics: [], questions: [], outputs: [], successCriteria: [], risks: [], assumptions: [] },
        riskNotes: []
      })
    }]
  }
}));
`);
  chmodSync(fakePi, 0o755);
  process.env.XANTHIL_PI_BIN = fakePi;
  const db = await import("./db.ts");
  const { engineRouter } = await import("./routes/engine.ts");
  const app = express();
  app.use(express.json({ limit: "2mb" }));
  app.use(engineRouter);
  const server = app.listen(0);
  const { port } = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${port}`;
  try {
    const workspace = db.createWorkspace("brc import route");
    db.createBusinessContext(workspace.id, { category: "goal", title: "会员复购目标", content: "关注复购率下降原因" });
    const rawPath = db.addWorkspacePath(workspace.id, "draw_data", join(workspace.rootPath, "orders.csv"), "file");
    const rawRes = await fetch(`${baseUrl}/api/workspaces/${workspace.id}/business-requirement-communication/import-documents`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ scene: "daily", documents: [{ source: "report", pathId: rawPath.id }] }),
    });
    assert.equal(rawRes.status, 400);
    assert.match(await rawRes.text(), /report registered path/);

    const explorationRes = await fetch(`${baseUrl}/api/workspaces/${workspace.id}/business-requirement-communication/import-documents`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ scene: "daily", documents: [{ source: "data_exploration", localText: "field profile" }] }),
    });
    assert.equal(explorationRes.status, 400);
    assert.match(await explorationRes.text(), /document source/);

    const reportDir = join(workspace.rootPath, "reports");
    mkdirSync(reportDir, { recursive: true });
    const reportPath = db.addWorkspacePath(workspace.id, "report", reportDir, "dir");
    const analysisJsonRes = await fetch(`${baseUrl}/api/workspaces/${workspace.id}/business-requirements/analysis-framework-from-confirmed`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ pathId: reportPath.id, confirmedRequirementJsonPath: "business_requirements/会员复购-分析框架-20260630-101500.json" }),
    });
    assert.equal(analysisJsonRes.status, 400);
    assert.match(await analysisJsonRes.text(), /confirmedRequirementJsonPath/);

    const communicationJsonRes = await fetch(`${baseUrl}/api/workspaces/${workspace.id}/business-requirements/analysis-framework-from-confirmed`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ pathId: reportPath.id, confirmedRequirementJsonPath: "business_requirements/communications/会员复购-沟通记录-20260630-101500.json" }),
    });
    assert.equal(communicationJsonRes.status, 400);
    assert.match(await communicationJsonRes.text(), /confirmedRequirementJsonPath/);

    const clarifyRes = await fetch(`${baseUrl}/api/workspaces/${workspace.id}/business-requirement-communication/clarify`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ scene: "daily", message: "分析本月会员复购率下滑原因" }),
    });
    const clarifyText = await clarifyRes.text();
    assert.equal(clarifyRes.status, 200, clarifyText);
    const clarifyJson = JSON.parse(clarifyText) as { clarifyingQuestions: unknown[]; assumptions: unknown[] };
    assert.equal(clarifyJson.clarifyingQuestions.length, 3);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});
