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

export function parseReviewScore(reviewMarkdown: string): number {
  const match = reviewMarkdown.match(/\*\*总分\*\*[：:]\s*(\d+)\s*\/\s*50/i);
  if (match?.[1]) return parseInt(match[1], 10);
  const altMatch = reviewMarkdown.match(/综合评分[^0-9]*(\d+)\s*\/\s*50/i);
  if (altMatch?.[1]) return parseInt(altMatch[1], 10);
  return 0;
}
