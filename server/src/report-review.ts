import type { ReportContractContext } from "./business-requirement-communication.ts";

export interface ReviewAnnotation {
  quote: string;
  issue: string;
  suggestion: string;
  severity: "P0" | "P1" | "P2";
}

export interface ReviewResult {
  reviewMarkdown: string;
  annotations: ReviewAnnotation[];
  totalScore: number;
}

export interface ReviewHistoryEntry {
  id: string;
  reportName: string;
  reviewedAt: number;
  model: string;
  totalScore: number;
  pathId: number;
  relPath: string;
  reviewMarkdown: string;
  annotations: ReviewAnnotation[];
}

export interface ContractReviewFinding {
  id: string;
  status: "covered" | "partial" | "missing";
  title: string;
  detail: string;
  quote?: string;
}

export interface ContractReviewResult {
  totalScore: number;
  coverageSummary: string;
  sectionResults: ContractReviewFinding[];
  questionResults: ContractReviewFinding[];
  evidenceGaps: ContractReviewFinding[];
  unsupportedClaims: ContractReviewFinding[];
  openQuestionMisuse: ContractReviewFinding[];
  actionability: ContractReviewFinding;
  rewritePlan: string[];
  reviewMarkdown: string;
}

export interface ContractRevisionResult {
  revisedMarkdown: string;
  revisionSummary: string[];
  unresolvedGaps: string[];
}

export const DEFAULT_REVIEW_PROMPT = `你是一名专业的数据分析报告评审专家。请从以下维度对报告进行结构化评审，给出具体、可操作的修改建议。

## 评审维度

### 1. 逻辑完整性
- 报告是否有清晰的分析目标、数据来源、分析方法和结论？
- 分析逻辑链是否完整（目标→数据→方法→发现→结论→建议）？
- 是否存在跳跃性结论或未经数据支撑的断言？

### 2. 数据准确性
- 数据引用是否准确、可追溯？
- 是否存在数据矛盾或统计口径不一致？
- 数值计算是否有明显错误？

### 3. 结论合理性
- 结论是否基于数据和分析过程自然推导而来？
- 是否存在过度推断或因果混淆？
- 不确定性和风险是否被诚实地标注？

### 4. 表达清晰度
- 报告结构是否清晰、层次分明？
- 关键信息是否突出、易于理解？
- 是否存在冗余、模糊或有歧义的表述？

### 5. 行动指导性
- 是否给出了明确、可执行的下一步建议？
- 建议是否与发现和结论紧密关联？
- 是否区分了短期行动和长期策略？

## 输出格式

请以 Markdown 格式输出评审结果，包含以下章节：

## 总体评价
（50-100 字的总体评价）

## 分维度评审

### 1. 逻辑完整性
**评分**: X/10
**问题**:
- 问题 1
- 问题 2
**改进建议**:
- 建议 1
- 建议 2

### 2. 数据准确性
**评分**: X/10
**问题**: ...
**改进建议**: ...

### 3. 结论合理性
**评分**: X/10
**问题**: ...
**改进建议**: ...

### 4. 表达清晰度
**评分**: X/10
**问题**: ...
**改进建议**: ...

### 5. 行动指导性
**评分**: X/10
**问题**: ...
**改进建议**: ...

## 综合评分
**总分**: XX/50

## 优先级修改建议

### P0（必须修改）
- ...

### P1（建议修改）
- ...

### P2（锦上添花）
- ...

## 修改方向总结
（对报告整体修改方向的 100-150 字总结）`;

export const AUTO_FIX_SYSTEM_PROMPT = "你是资深数据分析报告撰写专家。请根据评审意见，对报告进行优化修改，保留原报告的核心数据和结论，提升逻辑完整性、表达清晰度和行动指导性。所有输出内容必须使用简体中文，仅代码、数字和技术缩写保留英文。";

export function buildReviewPrompt(reportContent: string, userPrompt: string): string {
  const reviewCriteria = userPrompt.trim() || DEFAULT_REVIEW_PROMPT;
  return `请同时输出两个内容：
1. 一份 Markdown 格式的评审报告（reviewMarkdown）
2. 一份行内批注数组（annotations），每个批注包含原文引用、问题描述、修改建议和严重程度

输出严格 JSON，格式如下：
{
  "reviewMarkdown": "Markdown 格式的完整评审报告",
  "annotations": [
    { "quote": "原文中被批注的具体文本片段", "issue": "该片段存在的问题", "suggestion": "具体修改建议", "severity": "P0" },
    { "quote": "另一段原文", "issue": "表达不清晰", "suggestion": "建议改为...", "severity": "P1" }
  ],
  "totalScore": 35
}

annotations 要求：
- quote 必须是从原报告中精确引用的文本片段（10-100字）
- issue 说明该片段的具体问题
- suggestion 给出具体可操作的修改建议
- severity 为 P0（必须修改）/ P1（建议修改）/ P2（锦上添花）
- 至少输出 5 条批注，最多 20 条
- totalScore 为 0-50 的整数

语言要求：
- 所有评审内容（reviewMarkdown、issue、suggestion）必须使用简体中文
- 仅代码、数字、JSON 字段名、技术缩写（如 TGI、DMP、SKU）保留英文
- 禁止在中文正文中混入英文单词或短语

评审标准：
${reviewCriteria}

---
待评审报告：

${reportContent}`;
}

export function buildAutoFixPrompt(reportContent: string, reviewContent: string, format: string): string {
  return `请根据以下评审意见，修改报告。

评审意见：
${reviewContent}

---

原报告：
${reportContent}

---

输出要求：
1. 保留原报告的所有核心数据和关键结论。
2. 根据评审意见逐条修改，特别是 P0 级的必须修改项。
3. 输出格式为 ${format}。
4. 直接输出修改后的完整报告内容，不要包含解释文字。`;
}

function includesLoose(haystack: string, needle: string): boolean {
  const text = haystack.toLowerCase();
  const target = needle.trim().toLowerCase();
  if (!target) return false;
  if (text.includes(target)) return true;
  const tokens = target.split(/[\s，。；、：:,.!?！？（）()\[\]【】]+/).filter((token) => token.length >= 2);
  if (tokens.length === 0) return false;
  const hits = tokens.filter((token) => text.includes(token)).length;
  return hits >= Math.max(1, Math.ceil(tokens.length * 0.6));
}

function shortQuote(line: string): string | undefined {
  const cleaned = line.replace(/\s+/g, " ").trim();
  return cleaned ? cleaned.slice(0, 120) : undefined;
}

function lineContaining(report: string, text: string): string | undefined {
  return report.split(/\r?\n/).find((line) => includesLoose(line, text));
}

function lineContainingOpenQuestion(report: string, question: string): string | undefined {
  const simplified = question.replace(/[？?]/g, "").replace(/^(是否|能否|有没有|是否需要)/, "").trim();
  const bigrams = Array.from({ length: Math.max(0, simplified.length - 1) }, (_, index) => simplified.slice(index, index + 2))
    .filter((token) => !["是否", "能否", "有没有"].includes(token));
  return report.split(/\r?\n/).find((line) => {
    if (includesLoose(line, question) || (simplified.length >= 2 && includesLoose(line, simplified))) return true;
    const hits = bigrams.filter((token) => line.includes(token)).length;
    return hits >= Math.min(2, bigrams.length);
  });
}

function statusLabel(status: ContractReviewFinding["status"]): string {
  return status === "covered" ? "已覆盖" : status === "partial" ? "部分覆盖" : "缺失";
}

export function reviewReportAgainstContract(reportContent: string, contract: ReportContractContext): ContractReviewResult {
  const report = reportContent.slice(0, 120_000);
  const sectionResults = contract.sections.map((section, index): ContractReviewFinding => {
    const titleHit = includesLoose(report, section.title);
    const questionHits = section.keyQuestions.filter((question) => includesLoose(report, question)).length;
    const evidenceHits = section.requiredEvidence.filter((evidence) => includesLoose(report, evidence)).length;
    const totalSignals = section.keyQuestions.length + section.requiredEvidence.length;
    const signalHits = questionHits + evidenceHits;
    const status: ContractReviewFinding["status"] = titleHit && (totalSignals === 0 || signalHits >= Math.ceil(totalSignals * 0.5))
      ? "covered"
      : titleHit || signalHits > 0
        ? "partial"
        : "missing";
    return {
      id: `section-${index + 1}`,
      status,
      title: section.title,
      detail: `章节标题${titleHit ? "已出现" : "未出现"}；必答问题覆盖 ${questionHits}/${section.keyQuestions.length}；必需证据覆盖 ${evidenceHits}/${section.requiredEvidence.length}`,
      quote: shortQuote(lineContaining(report, section.title) ?? ""),
    };
  });
  const questionResults = contract.requiredQuestions.map((question, index): ContractReviewFinding => {
    const quote = lineContaining(report, question);
    return {
      id: `question-${index + 1}`,
      status: quote ? "covered" : "missing",
      title: question,
      detail: quote ? "报告已回应该必答问题" : "报告未明确回应该必答问题",
      quote: shortQuote(quote ?? ""),
    };
  });
  const requiredEvidence = [...new Set(contract.sections.flatMap((section) => section.requiredEvidence).filter(Boolean))];
  const evidenceGaps = requiredEvidence.map((evidence, index): ContractReviewFinding | null => {
    if (includesLoose(report, evidence)) return null;
    return { id: `evidence-${index + 1}`, status: "missing", title: evidence, detail: "报告未出现该契约要求的证据/数据" };
  }).filter((item): item is ContractReviewFinding => item !== null);
  const unsupportedClaims = report.split(/\r?\n/).map((line, index): ContractReviewFinding | null => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.length < 12) return null;
    const looksLikeClaim = /(结论|建议|因此|显著|明显|必须|应当|可以判定|核心原因|主要原因)/.test(trimmed);
    const hasEvidenceSignal = /(数据|证据|来源|口径|MetricSnapshot|图表|表|同比|环比|%|\d)/i.test(trimmed);
    if (!looksLikeClaim || hasEvidenceSignal) return null;
    return { id: `unsupported-${index + 1}`, status: "partial", title: "无证据结论或空泛建议", detail: "该句像结论/建议，但缺少证据、来源或口径标注", quote: shortQuote(trimmed) };
  }).filter((item): item is ContractReviewFinding => item !== null).slice(0, 20);
  const openQuestionMisuse = contract.openQuestions.map((question, index): ContractReviewFinding | null => {
    const line = lineContainingOpenQuestion(report, question);
    if (!line) return null;
    const safe = /(待确认|未确认|不确定|未覆盖|需补充|风险)/.test(line);
    if (safe) return null;
    return { id: `open-question-${index + 1}`, status: "partial", title: question, detail: "待确认问题被写成了事实或确定结论", quote: shortQuote(line) };
  }).filter((item): item is ContractReviewFinding => item !== null);
  const hasAction = /(建议|行动|下一步|执行|落地|负责人|owner|时间|衡量)/i.test(report);
  const scenarioCovered = contract.decisionScenario ? includesLoose(report, contract.decisionScenario) : true;
  const actionability: ContractReviewFinding = {
    id: "actionability",
    status: hasAction && scenarioCovered ? "covered" : hasAction ? "partial" : "missing",
    title: "行动建议回应决策场景",
    detail: hasAction
      ? scenarioCovered ? "报告包含行动建议，并回应决策场景" : "报告包含行动建议，但未明确回应决策场景"
      : "报告缺少可执行行动建议",
  };
  const rewritePlan = [
    ...sectionResults.filter((item) => item.status !== "covered").map((item) => `补写或调整章节：${item.title}（${item.detail}）`),
    ...questionResults.filter((item) => item.status !== "covered").map((item) => `补答问题：${item.title}`),
    ...evidenceGaps.map((item) => `补充证据或明确未覆盖：${item.title}`),
    ...unsupportedClaims.map((item) => `删除/降级无证据结论：${item.quote ?? item.title}`),
    ...openQuestionMisuse.map((item) => `改写待确认问题为风险/待确认事项：${item.title}`),
    ...(actionability.status === "covered" ? [] : ["补充回应决策场景的可执行行动建议"]),
  ].slice(0, 60);
  const coveredSections = sectionResults.filter((item) => item.status === "covered").length;
  const coveredQuestions = questionResults.filter((item) => item.status === "covered").length;
  const rawScore = 100
    - sectionResults.filter((item) => item.status === "missing").length * 10
    - sectionResults.filter((item) => item.status === "partial").length * 5
    - questionResults.filter((item) => item.status === "missing").length * 5
    - evidenceGaps.length * 6
    - unsupportedClaims.length * 4
    - openQuestionMisuse.length * 10
    - (actionability.status === "covered" ? 0 : actionability.status === "partial" ? 5 : 10);
  const totalScore = Math.max(0, Math.min(100, rawScore));
  const coverageSummary = `章节覆盖 ${coveredSections}/${sectionResults.length}；必答问题覆盖 ${coveredQuestions}/${questionResults.length}；证据缺口 ${evidenceGaps.length}；无证据结论 ${unsupportedClaims.length}；待确认误用 ${openQuestionMisuse.length}。`;
  const reviewMarkdown = [
    `## 需求贴合度总评`,
    `总分：${totalScore}/100`,
    coverageSummary,
    "",
    "## 章节覆盖",
    ...sectionResults.map((item) => `- ${statusLabel(item.status)}｜${item.title}：${item.detail}`),
    "",
    "## 必答问题覆盖",
    ...questionResults.map((item) => `- ${statusLabel(item.status)}｜${item.title}${item.quote ? `｜quote: ${item.quote}` : ""}`),
    "",
    "## 证据缺口",
    ...(evidenceGaps.length ? evidenceGaps.map((item) => `- ${item.title}`) : ["- 无"]),
    "",
    "## 无证据结论 / 空泛建议",
    ...(unsupportedClaims.length ? unsupportedClaims.map((item) => `- ${item.quote ?? item.title}`) : ["- 无"]),
    "",
    "## 待确认问题误用",
    ...(openQuestionMisuse.length ? openQuestionMisuse.map((item) => `- ${item.title}${item.quote ? `｜quote: ${item.quote}` : ""}`) : ["- 无"]),
    "",
    "## 修订计划",
    ...(rewritePlan.length ? rewritePlan.map((item) => `- ${item}`) : ["- 暂无必要修订"]),
  ].join("\n");
  return { totalScore, coverageSummary, sectionResults, questionResults, evidenceGaps, unsupportedClaims, openQuestionMisuse, actionability, rewritePlan, reviewMarkdown };
}

export function buildContractReviewPrompt(reportContent: string, contract: ReportContractContext): string {
  return `请对照 ReportContractContext 审查报告的需求贴合度。不得读取或推断 draw_data 原始行；引用报告内容时只保留必要短 quote。

输出严格 JSON：{"totalScore":0,"coverageSummary":"","sectionResults":[],"questionResults":[],"evidenceGaps":[],"unsupportedClaims":[],"openQuestionMisuse":[],"actionability":{"status":"covered","detail":""},"rewritePlan":[],"reviewMarkdown":""}

审查维度：requiredQuestionsCoverage、sectionCoverage、evidenceCoverage、unsupportedClaims、openQuestionMisuse、actionability、rewritePlan。

ReportContractContext：
${JSON.stringify(contract, null, 2).slice(0, 50000)}

报告正文：
${reportContent.slice(0, 80000)}`;
}

export function buildContractAutoFixPrompt(reportContent: string, contract: ReportContractContext, review: ContractReviewResult): string {
  return `请基于 ReportContractContext 和契约审查结果，小幅修订报告并输出严格 JSON。

JSON schema：{"revisedMarkdown":"修订后的完整 Markdown","revisionSummary":["修订点"],"unresolvedGaps":["仍未解决的缺口"]}

硬性要求：
1. 不得新增无来源数字；原报告没有来源的数字只能保留、标注来源待确认或删除，不得编造新数字。
2. 不得读取或引用 draw_data 原始行。
3. 不覆盖原报告；这里只返回新 Markdown。
4. 补写未覆盖必答问题；调整章节顺序以贴合 reportFramework；删除或降级无证据结论；把 openQuestions/deferredQuestions 改写为待确认事项；补充证据限制、口径说明和行动建议。

ReportContractContext：
${JSON.stringify(contract, null, 2).slice(0, 50000)}

契约审查结果：
${JSON.stringify({ totalScore: review.totalScore, coverageSummary: review.coverageSummary, rewritePlan: review.rewritePlan, evidenceGaps: review.evidenceGaps, openQuestionMisuse: review.openQuestionMisuse, unsupportedClaims: review.unsupportedClaims }, null, 2).slice(0, 30000)}

原报告：
${reportContent.slice(0, 100000)}`;
}

export function validateContractRevisionResult(value: unknown, fallbackMarkdown: string, review: ContractReviewResult): ContractRevisionResult {
  const item = typeof value === "object" && value !== null ? value as Record<string, unknown> : {};
  const revisedMarkdown = typeof item.revisedMarkdown === "string" && item.revisedMarkdown.trim()
    ? item.revisedMarkdown.trim()
    : fallbackMarkdown;
  const revisionSummary = Array.isArray(item.revisionSummary)
    ? item.revisionSummary.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0).map((entry) => entry.trim()).slice(0, 30)
    : review.rewritePlan.slice(0, 10);
  const unresolvedGaps = Array.isArray(item.unresolvedGaps)
    ? item.unresolvedGaps.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0).map((entry) => entry.trim()).slice(0, 30)
    : review.evidenceGaps.map((gap) => gap.title);
  return { revisedMarkdown, revisionSummary, unresolvedGaps };
}

export function parseReviewScore(reviewMarkdown: string): number {
  const match = reviewMarkdown.match(/\*\*总分\*\*[：:]\s*(\d+)\s*\/\s*50/i);
  if (match?.[1]) return parseInt(match[1], 10);
  const altMatch = reviewMarkdown.match(/综合评分[^0-9]*(\d+)\s*\/\s*50/i);
  if (altMatch?.[1]) return parseInt(altMatch[1], 10);
  return 0;
}
