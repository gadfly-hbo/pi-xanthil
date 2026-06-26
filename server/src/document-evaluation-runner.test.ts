import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  evaluateRule,
  getDefaultRulePack,
  runDocumentEvaluation,
  type JudgeFn,
  type RulePack,
} from "./document-evaluation-runner.ts";
import type { DocumentEvalCase } from "./types.ts";

const MALL_REPORT = `# 商圈研究报告

## 核心客群
本商圈核心客群以 25-35 岁中产白领为主，年龄分布集中，职业以互联网与金融为主，收入位于 1.5-3 万区间。
消费偏好高频外出就餐与服装零售。触达渠道以小红书与朋友圈广告为主。
样本说明：基于 2025 年 6 月 800 份问卷调研抽样，数据来自内部门店 POS 系统。
推断常住人口约 12 万人，来源参考 2024 年统计公报。
综上，核心客群体量稳定，是商圈主力贡献，约占总到访 45%。

## 次核心客群
次核心客群以 18-24 岁学生群体为主，画像偏潮流敏感。
消费偏好新茶饮与潮玩。触达以抖音与 B 站短视频为主。
说明该群体周末高峰时段贡献 30% 客流，反映其周末出行频率显著高于工作日。
小结：次核心客群粘性中等，对促销价格敏感度高。

## 潜力客群
潜力客群覆盖周边社区家庭，画像为亲子结构。
消费偏好亲子餐饮与早教。触达以社区微信群与线下传单为主。
说明亲子客群夜间到访比例不足 8%，意味着夜场业态对其吸引力弱。
由此可见，潜力客群激活需聚焦周末白天时段。

## 弱相关
弱相关人群为商务差旅短停留客户，贡献占比 < 10%。

## 商圈
商圈半径 3 公里，停车位 1200 个，建筑面积 18 万平米，投资金额 25 亿元。

## 竞品
对比竞品 A 与竞品 B，竞品 A 客流领先 15%，但客单价低 20%。
横向比较显示我商圈在客单价与停留时长上具备优势。
存在数据口径不同：竞品 A 引用 2023 年公开年报。

## 策略
Q1 短期：以核心客群为主目标，KPI 为月度复购率 +5%，优先级 P0，责任人为运营总监。
Q2 中期：次核心客群激活，洞察关联前文，落地路径包括联名活动与直播。
长期：拓展潜力客群亲子业态，分群差异化定价，可测指标包括到访频次。
`;

test("runDocumentEvaluation: mall default pack scores combined", async () => {
  const tmp = mkdtempSync(join(tmpdir(), "doc-eval-"));
  mkdirSync(join(tmp, "reports"), { recursive: true });
  const reportPath = join(tmp, "reports", "mall.md");
  writeFileSync(reportPath, MALL_REPORT, "utf-8");

  const judgeFn: JudgeFn = async () => ({ score: 80, details: "mock judge" });

  const cases: DocumentEvalCase[] = [
    {
      id: "case-1",
      name: "demo mall",
      domain: "mall",
      reportPath: "reports/mall.md",
      rubrics: [
        { criterion: "结构完整性", weight: 2 },
        { criterion: "证据纪律", weight: 1 },
      ],
    },
  ];

  const results = await runDocumentEvaluation({
    workspaceRoot: tmp,
    workspaceId: "w1",
    evaluationId: "eval-1",
    model: "test-model",
    cases,
    judgeFn,
    judgeRepeat: 1,
  });

  assert.equal(results.length, 1);
  const r = results[0]!;
  assert.equal(r.caseId, "case-1");
  assert.equal(r.ruleResults.length, 15);
  // mall report 触发 R01/R07 全章节命中
  const r01 = r.ruleResults.find((x) => x.ruleName === "R01_structure")!;
  assert.equal(r01.passed, true);
  assert.ok(r01.score >= 0.8);
  // judgeScore = mock 80
  assert.equal(r.judgeScore, 80);
  // combined = 0.6*ruleTotal + 0.4*80
  const expected = Math.round((0.6 * r.ruleTotalScore + 0.4 * 80) * 10) / 10;
  assert.equal(r.combinedScore, expected);
  assert.equal(r.judgeDetails.length, 2);
});

test("runDocumentEvaluation: judge takes median of 3 runs per criterion", async () => {
  const tmp = mkdtempSync(join(tmpdir(), "doc-eval-"));
  const cases: DocumentEvalCase[] = [
    {
      id: "c1",
      name: "x",
      domain: "mall",
      reportPath: "stub.md",
      rubrics: [{ criterion: "X", weight: 1 }],
    },
  ];

  let call = 0;
  const judgeFn: JudgeFn = async () => {
    call += 1;
    if (call === 1) return { score: 30, details: "low" };
    if (call === 2) return { score: 90, details: "high" };
    return { score: 60, details: "mid" };
  };

  const results = await runDocumentEvaluation({
    workspaceRoot: tmp,
    workspaceId: "w1",
    evaluationId: "e1",
    model: "m",
    cases,
    judgeFn,
    judgeRepeat: 3,
    loadDocument: () => "短文档",
  });

  // median(30, 90, 60) = 60
  assert.equal(results[0]!.judgeScore, 60);
  assert.equal(results[0]!.judgeDetails[0]!.score, 60);
});

test("runDocumentEvaluation: ruleConfigs injection overrides default pack", async () => {
  const tmp = mkdtempSync(join(tmpdir(), "doc-eval-"));
  const customPack: RulePack = {
    domain: "custom",
    rules: [
      {
        name: "must-have-foo",
        kind: "keyword-presence",
        params: { keywords: ["foo", "bar"], min: 1 },
        passThreshold: 0.5,
      },
    ],
  };

  const results = await runDocumentEvaluation({
    workspaceRoot: tmp,
    workspaceId: "w",
    evaluationId: "e",
    model: "m",
    cases: [
      { id: "c1", name: "x", domain: "custom", reportPath: "x.md", rubrics: [] },
    ],
    judgeFn: async () => ({ score: 50, details: "" }),
    judgeRepeat: 1,
    ruleConfigs: { custom: customPack },
    loadDocument: () => "this contains foo and baz",
  });

  assert.equal(results[0]!.ruleResults.length, 1);
  assert.equal(results[0]!.ruleResults[0]!.ruleName, "must-have-foo");
  assert.equal(results[0]!.ruleResults[0]!.passed, true);
});

test("runDocumentEvaluation: workspace override file overrides default pack", async () => {
  const tmp = mkdtempSync(join(tmpdir(), "doc-eval-"));
  mkdirSync(join(tmp, ".pi", "document-eval-rules"), { recursive: true });
  const override: RulePack = {
    domain: "mall",
    rules: [
      {
        name: "single-rule",
        kind: "keyword-presence",
        params: { keywords: ["核心客群"], min: 1 },
      },
    ],
  };
  writeFileSync(
    join(tmp, ".pi", "document-eval-rules", "mall.json"),
    JSON.stringify(override),
    "utf-8",
  );

  const results = await runDocumentEvaluation({
    workspaceRoot: tmp,
    workspaceId: "w",
    evaluationId: "e",
    model: "m",
    cases: [
      { id: "c1", name: "x", domain: "mall", reportPath: "x.md", rubrics: [] },
    ],
    judgeFn: async () => ({ score: 50, details: "" }),
    judgeRepeat: 1,
    loadDocument: () => "核心客群报告内容",
  });

  // override 只有 1 条规则，证明覆盖生效（默认 mall pack 有 15 条）
  assert.equal(results[0]!.ruleResults.length, 1);
  assert.equal(results[0]!.ruleResults[0]!.ruleName, "single-rule");
});

test("runDocumentEvaluation: consistency alert when rule and judge differ ≥35", async () => {
  const tmp = mkdtempSync(join(tmpdir(), "doc-eval-"));
  const judgeFn: JudgeFn = async () => ({ score: 95, details: "judge says great" });

  const results = await runDocumentEvaluation({
    workspaceRoot: tmp,
    workspaceId: "w",
    evaluationId: "e",
    model: "m",
    cases: [
      {
        id: "c1",
        name: "x",
        domain: "custom",
        reportPath: "x.md",
        rubrics: [{ criterion: "same-name", weight: 1 }],
      },
    ],
    ruleConfigs: {
      custom: {
        domain: "custom",
        rules: [
          // rule 同名 same-name，文本不命中→分数 0
          { name: "same-name", kind: "keyword-presence", params: { keywords: ["不存在的词"], min: 1 } },
        ],
      },
    },
    judgeFn,
    judgeRepeat: 1,
    loadDocument: () => "随便什么内容",
  });

  assert.equal(results[0]!.consistencyAlerts.length, 1);
  assert.match(results[0]!.consistencyAlerts[0]!, /same-name/);
});

test("evaluateRule: numeric-consistency detects conflict", () => {
  const res = evaluateRule(
    {
      name: "R14",
      kind: "numeric-consistency",
      params: { keywords: ["停车位"] },
    },
    "本商圈停车位 1200 个。\n附近停车位 800 个。",
  );
  assert.equal(res.passed, false);
  assert.match(res.detail, /冲突/);
});

test("evaluateRule: derivation-chain checks tail summary", () => {
  const text = "## 核心客群\n这是详细分析内容。\n综上所述，核心客群是主力贡献。";
  const res = evaluateRule(
    {
      name: "R13",
      kind: "derivation-chain",
      params: { sections: ["核心客群"], summaryKeywords: ["综上"], minTailChars: 10 },
    },
    text,
  );
  assert.equal(res.passed, true);
});

test("evaluateRule: keyword-hit-ratio vacuous pass when no antecedent", () => {
  const res = evaluateRule(
    {
      name: "R12",
      kind: "keyword-hit-ratio",
      params: {
        antecedent: ["完全没有的前提词"],
        consequent: ["%"],
        threshold: 0.5,
      },
    },
    "这是一段没有任何关键词的文本。",
  );
  // 没有 antecedent 句 → vacuous pass score=1
  assert.equal(res.passed, true);
  assert.equal(res.score, 1);
});

test("evaluateRule: unknown rule_error captured without throwing", () => {
  const res = evaluateRule(
    { name: "bad", kind: "section-coverage", params: { sections: 123 } },
    "x",
  );
  // sections 非数组 → readStringArray 返回空 → "no sections configured"
  assert.equal(res.passed, false);
  assert.equal(res.score, 0);
});

test("getDefaultRulePack: returns built-in mall / return_profile", () => {
  assert.equal(getDefaultRulePack("mall")?.rules.length, 15);
  assert.ok((getDefaultRulePack("return_profile")?.rules.length ?? 0) >= 6);
  assert.equal(getDefaultRulePack("nonexistent"), undefined);
});

test("runDocumentEvaluation: document sampling kicks in for long text", async () => {
  const tmp = mkdtempSync(join(tmpdir(), "doc-eval-"));
  const long = "X".repeat(50000);
  let capturedOutput = "";
  const judgeFn: JudgeFn = async (p) => {
    capturedOutput = p.output;
    return { score: 70, details: "" };
  };
  await runDocumentEvaluation({
    workspaceRoot: tmp,
    workspaceId: "w",
    evaluationId: "e",
    model: "m",
    cases: [
      { id: "c1", name: "x", domain: "mall", reportPath: "x.md", rubrics: [{ criterion: "c", weight: 1 }] },
    ],
    judgeFn,
    judgeRepeat: 1,
    sampleThreshold: 1000,
    sampleSize: 100,
    loadDocument: () => long,
  });
  // 抽样后远小于原文，并包含分隔标记
  assert.ok(capturedOutput.length < 1000);
  assert.match(capturedOutput, /中段/);
  assert.match(capturedOutput, /尾段/);
});

test("runDocumentEvaluation: throws on empty model or cases", async () => {
  await assert.rejects(
    runDocumentEvaluation({
      workspaceRoot: "/tmp",
      workspaceId: "w",
      evaluationId: "e",
      model: "",
      cases: [{ id: "c1", name: "x", domain: "mall", reportPath: "x.md", rubrics: [] }],
    }),
  );
  await assert.rejects(
    runDocumentEvaluation({
      workspaceRoot: "/tmp",
      workspaceId: "w",
      evaluationId: "e",
      model: "m",
      cases: [],
    }),
  );
});

test("loadReportText red-line: rejects path escape and draw_data (总控终审加固)", async () => {
  const tmp = mkdtempSync(join(tmpdir(), "doc-eval-guard-"));
  const judge: JudgeFn = async () => ({ score: 80, details: "" });
  const base = {
    workspaceRoot: tmp,
    workspaceId: "w",
    evaluationId: "e",
    model: "m",
    judgeRepeat: 1,
    judgeFn: judge,
  };
  // 相对 .. 逃逸
  await assert.rejects(
    runDocumentEvaluation({ ...base, cases: [{ id: "c1", name: "x", domain: "mall", reportPath: "../../etc/passwd", rubrics: [] }] }),
    /escapes workspaceRoot/,
  );
  // 绝对路径前缀越界（/tmp/foo-evil 不应因 startsWith(/tmp/foo) 放行）
  await assert.rejects(
    runDocumentEvaluation({ ...base, cases: [{ id: "c2", name: "x", domain: "mall", reportPath: "/etc/hosts", rubrics: [] }] }),
    /escapes workspaceRoot/,
  );
  // draw_data（010_raw）兜底拦截
  mkdirSync(join(tmp, "sessions", "s1", "010_raw"), { recursive: true });
  writeFileSync(join(tmp, "sessions", "s1", "010_raw", "raw.csv"), "a,b\n1,2\n", "utf-8");
  await assert.rejects(
    runDocumentEvaluation({ ...base, cases: [{ id: "c3", name: "x", domain: "mall", reportPath: "sessions/s1/010_raw/raw.csv", rubrics: [] }] }),
    /draw_data/,
  );
});
