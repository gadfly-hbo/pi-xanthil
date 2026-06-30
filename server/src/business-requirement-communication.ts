export type RequirementCommunicationScene = "daily" | "topic" | "recurring";

export interface ClarificationQuestion {
  id: string;
  priority: "must_confirm" | "should_confirm" | "can_defer";
  category: string;
  question: string;
  why: string;
  status: "pending" | "answered" | "skipped" | "assumed" | "deferred";
  answer?: string;
}

export interface RequirementAssumption {
  id: string;
  text: string;
  status: "proposed" | "confirmed" | "rejected" | "deferred";
  source: "user" | "history" | "business_context" | "metric" | "path_metadata" | "model";
}

export interface RequirementDraft {
  background: string;
  objective: string;
  scope: string[];
  metrics: string[];
  questions: string[];
  outputs: string[];
  successCriteria: string[];
  risks: string[];
  assumptions: string[];
}

export interface RequirementCommunicationResult {
  clarifyingQuestions: ClarificationQuestion[];
  assumptions: RequirementAssumption[];
  requirementDraft: RequirementDraft;
  riskNotes: string[];
}

export interface RequirementCommunicationRequest {
  scene: RequirementCommunicationScene;
  message: string;
  contextRefs?: string[];
  history?: string;
  model?: string;
}

export type RequirementImportDocumentSource = "business_requirements" | "report" | "clean_data" | "localText";

export interface RequirementImportDocumentInput {
  source: RequirementImportDocumentSource;
  pathId?: number;
  relPath?: string;
  localText?: string;
  name?: string;
}

export interface RequirementImportDocumentsRequest {
  scene: RequirementCommunicationScene;
  documents: RequirementImportDocumentInput[];
  message?: string;
  model?: string;
}

export interface RequirementImportDocumentForPrompt {
  id: string;
  name: string;
  source: RequirementImportDocumentSource;
  content: string;
  warnings: string[];
}

export interface RequirementDocumentSummary {
  id: string;
  name: string;
  source: RequirementImportDocumentSource;
  summary: string;
  warnings?: string[];
}

export interface RequirementExtractedQuestion {
  category: string;
  question: string;
  why: string;
  priority: ClarificationQuestion["priority"];
}

export interface RequirementImportDocumentsResult {
  documentSummaries: RequirementDocumentSummary[];
  extractedFacts: string[];
  extractedQuestions: RequirementExtractedQuestion[];
  extractedAssumptions: Array<{ text: string; source: string }>;
  suggestedMessage: string;
  riskNotes: string[];
}

export interface AnalysisFrameworkFromConfirmedRequest {
  pathId: number;
  confirmedRequirementJsonPath: string;
  model?: string;
}

export interface BusinessRequirementAnalysisFrameworkStructured {
  projectName: string;
  businessFacts: string[];
  inferredNeeds: string[];
  analysisQuestions: string[];
  metrics: Array<{ name: string; definition: string; source?: string }>;
  dimensions: string[];
  dataNeeds: Array<{ name: string; fields: string[]; purpose: string; priority: "P0" | "P1" | "P2" }>;
  analysisFramework: Array<{ businessQuestion: string; hypothesis: string; method: string; requiredData: string[]; expectedOutput: string }>;
  reportFramework: Array<{ section: string; purpose: string; keyQuestions: string[]; requiredEvidence: string[]; outputGuidance: string; zeroHallucinationCheck: string }>;
  deliverables: string[];
  openQuestions: string[];
  risks: string[];
  sourceConfirmedRequirement?: { jsonPath: string; markdownPath?: string; scene?: RequirementCommunicationScene; confirmedAt?: number };
  version?: Record<string, unknown>;
}

export interface RequirementCommunicationPathMeta {
  id: number | string;
  folder: string;
  kind: string;
  name: string;
  description?: string;
}

export interface RequirementCommunicationContext {
  businessContextSummary?: string;
  metricSummary?: string;
  historySummary?: string;
  pathMetas?: RequirementCommunicationPathMeta[];
}

export type RequirementCommunicationLlm = (input: { systemPrompt: string; prompt: string }) => Promise<string>;

const SCENES = new Set<RequirementCommunicationScene>(["daily", "topic", "recurring"]);
const PRIORITIES = new Set(["must_confirm", "should_confirm", "can_defer", "P0", "P1", "P2"]);
const QUESTION_STATUSES = new Set(["pending", "answered", "skipped", "assumed", "deferred", "open", "dismissed"]);
const ASSUMPTION_STATUSES = new Set(["proposed", "confirmed", "rejected", "deferred"]);
const ASSUMPTION_SOURCES = new Set(["user", "history", "business_context", "metric", "path_metadata", "model"]);
const PRIORITY_RANK = ["must_confirm", "should_confirm", "can_defer"];
const IMPORT_DOCUMENT_SOURCES = new Set<RequirementImportDocumentSource>(["business_requirements", "report", "clean_data", "localText"]);
const LOCAL_TEXT_MAX_CHARS = 24000;
const IMPORT_DOCUMENT_CONTENT_MAX_CHARS = 32000;

function asRecord(value: unknown, name: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error(`${name} must be an object`);
  return value as Record<string, unknown>;
}

function cleanText(value: unknown, max = 4000): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function cleanStringArray(value: unknown, maxItems = 12, maxChars = 400): string[] {
  return Array.isArray(value)
    ? value.map((item) => cleanText(item, maxChars)).filter(Boolean).slice(0, maxItems)
    : [];
}

function normalizePriority(value: unknown): ClarificationQuestion["priority"] {
  if (value === "P0" || value === "must_confirm") return "must_confirm";
  if (value === "P2" || value === "can_defer") return "can_defer";
  return "should_confirm";
}

function normalizeQuestionStatus(value: unknown): ClarificationQuestion["status"] {
  if (value === "open") return "pending";
  if (value === "dismissed") return "skipped";
  return QUESTION_STATUSES.has(String(value)) ? String(value) as ClarificationQuestion["status"] : "pending";
}

export function parseRequirementCommunicationRequest(value: unknown): RequirementCommunicationRequest {
  const body = asRecord(value, "request body");
  const scene = body.scene;
  if (!SCENES.has(scene as RequirementCommunicationScene)) throw new Error("scene must be daily, topic, or recurring");
  const message = cleanText(body.message, 12000);
  if (!message) throw new Error("message required");
  return {
    scene: scene as RequirementCommunicationScene,
    message,
    contextRefs: cleanStringArray(body.contextRefs, 30, 200),
    history: cleanText(body.history, 8000) || undefined,
    model: cleanText(body.model, 200) || undefined,
  };
}

function cleanRelPath(value: unknown): string | undefined {
  const text = cleanText(value, 500).replace(/\\/g, "/").replace(/^\/+/, "");
  if (!text) return undefined;
  const segments = text.split("/").filter(Boolean);
  if (segments.some((segment) => segment === ".." || segment.startsWith("."))) throw new Error("relPath contains forbidden segments");
  return segments.join("/");
}

export function parseRequirementImportDocumentsRequest(value: unknown): RequirementImportDocumentsRequest {
  const body = asRecord(value, "request body");
  const scene = body.scene;
  if (!SCENES.has(scene as RequirementCommunicationScene)) throw new Error("scene must be daily, topic, or recurring");
  if (!Array.isArray(body.documents) || body.documents.length === 0) throw new Error("documents must be a non-empty array");
  const documents = body.documents.slice(0, 12).map((raw, index): RequirementImportDocumentInput => {
    const item = asRecord(raw, `documents[${index}]`);
    const source = item.source;
    if (!IMPORT_DOCUMENT_SOURCES.has(source as RequirementImportDocumentSource)) throw new Error("document source must be business_requirements, report, clean_data, or localText");
    const pathId = item.pathId === undefined || item.pathId === null || item.pathId === "" ? undefined : Number(item.pathId);
    if (pathId !== undefined && !Number.isFinite(pathId)) throw new Error("pathId must be a number");
    const localText = typeof item.localText === "string" ? item.localText.trim().slice(0, LOCAL_TEXT_MAX_CHARS) : undefined;
    return {
      source: source as RequirementImportDocumentSource,
      ...(pathId !== undefined ? { pathId } : {}),
      ...(cleanRelPath(item.relPath) ? { relPath: cleanRelPath(item.relPath) } : {}),
      ...(localText ? { localText } : {}),
      ...(cleanText(item.name, 160) ? { name: cleanText(item.name, 160) } : {}),
    };
  });
  return {
    scene: scene as RequirementCommunicationScene,
    documents,
    message: cleanText(body.message, 8000) || undefined,
    model: cleanText(body.model, 200) || undefined,
  };
}

export function parseAnalysisFrameworkFromConfirmedRequest(value: unknown): AnalysisFrameworkFromConfirmedRequest {
  const body = asRecord(value, "request body");
  const pathId = Number(body.pathId);
  if (!Number.isFinite(pathId)) throw new Error("pathId required");
  const confirmedRequirementJsonPath = cleanRelPath(body.confirmedRequirementJsonPath) ?? "";
  if (!isConfirmedBusinessRequirementJsonPath(confirmedRequirementJsonPath)) throw new Error("confirmedRequirementJsonPath must point to a confirmed requirement json");
  return {
    pathId,
    confirmedRequirementJsonPath,
    model: cleanText(body.model, 200) || undefined,
  };
}

export function validateRequirementImportDocumentAccess(input: RequirementImportDocumentInput, path?: RequirementCommunicationPathMeta): void {
  if (input.source === "localText") {
    if (!input.localText) throw new Error("localText document requires localText");
    if (input.pathId !== undefined || input.relPath) throw new Error("localText cannot reference server paths");
    return;
  }
  if (input.source === "clean_data") {
    if (!path || path.folder !== "clean_data") throw new Error("clean_data document requires a clean_data registered path");
    return;
  }
  if (input.source === "report") {
    if (!path || path.folder !== "report") throw new Error("report document requires a report registered path");
    return;
  }
  if (input.source === "business_requirements") {
    if (!path || path.folder !== "report") throw new Error("business_requirements document requires a report output path");
    const relPath = input.relPath ?? path.name;
    if (!relPath.replace(/\\/g, "/").startsWith("business_requirements/")) throw new Error("business_requirements relPath must be under business_requirements/");
    return;
  }
  throw new Error("unsupported document source");
}

function stripJsonFences(text: string): string {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  return (fenced?.[1] ?? text).trim();
}

function sliceJsonObject(text: string): string {
  const input = stripJsonFences(text);
  const start = input.indexOf("{");
  if (start < 0) return input;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < input.length; i += 1) {
    const ch = input[i]!;
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') { inString = true; continue; }
    if (ch === "{") depth += 1;
    else if (ch === "}") {
      depth -= 1;
      if (depth === 0) return input.slice(start, i + 1);
    }
  }
  const end = input.lastIndexOf("}");
  return end > start ? input.slice(start, end + 1) : input.slice(start);
}

function repairLooseJson(text: string): string {
  let out = "";
  let inString = false;
  let escaped = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i]!;
    const next = text[i + 1];
    if (inString) {
      out += ch;
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') { inString = true; out += ch; continue; }
    if (ch === "/" && next === "/") {
      while (i < text.length && text[i] !== "\n") i += 1;
      out += "\n";
      continue;
    }
    if (ch === "/" && next === "*") {
      i += 2;
      while (i < text.length && !(text[i] === "*" && text[i + 1] === "/")) i += 1;
      i += 1;
      continue;
    }
    out += ch;
  }
  return out.replace(/,\s*([}\]])/g, "$1");
}

export function parseRequirementCommunicationJson(text: string): unknown {
  const sliced = sliceJsonObject(text);
  try { return JSON.parse(sliced); } catch {
    try { return JSON.parse(repairLooseJson(sliced)); } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`BRC JSON parse failed: ${message}. preview=${sliced.slice(0, 240)}`);
    }
  }
}

export const parseRequirementImportDocumentsJson = parseRequirementCommunicationJson;

function normalizeQuestion(raw: unknown, index: number): ClarificationQuestion | null {
  const item = typeof raw === "object" && raw !== null ? raw as Record<string, unknown> : {};
  const question = cleanText(item.question, 500);
  const why = cleanText(item.why ?? item.reason, 500);
  if (!question || !why) return null;
  const priority = PRIORITIES.has(String(item.priority)) ? normalizePriority(item.priority) : "should_confirm";
  const status = normalizeQuestionStatus(item.status);
  return {
    id: cleanText(item.id, 80) || `q-${index + 1}`,
    priority,
    category: cleanText(item.category, 80) || "需求澄清",
    question,
    why,
    status,
    ...(cleanText(item.answer, 1000) ? { answer: cleanText(item.answer, 1000) } : {}),
  };
}

function normalizeAssumption(raw: unknown, index: number): RequirementAssumption | null {
  const item = typeof raw === "object" && raw !== null ? raw as Record<string, unknown> : {};
  const text = cleanText(item.text, 800);
  if (!text) return null;
  const status = ASSUMPTION_STATUSES.has(String(item.status)) ? String(item.status) as RequirementAssumption["status"] : "proposed";
  const source = ASSUMPTION_SOURCES.has(String(item.source)) ? String(item.source) as RequirementAssumption["source"] : "model";
  return { id: cleanText(item.id, 80) || `a-${index + 1}`, text, status, source };
}

function normalizeDraft(value: unknown): RequirementDraft {
  const item = typeof value === "object" && value !== null ? value as Record<string, unknown> : {};
  return {
    background: cleanText(item.background, 2000),
    objective: cleanText(item.objective, 2000),
    scope: cleanStringArray(item.scope),
    metrics: cleanStringArray(item.metrics),
    questions: cleanStringArray(item.questions),
    outputs: cleanStringArray(item.outputs),
    successCriteria: cleanStringArray(item.successCriteria),
    risks: cleanStringArray(item.risks),
    assumptions: cleanStringArray(item.assumptions),
  };
}

export function validateRequirementCommunicationResult(value: unknown): RequirementCommunicationResult {
  const root = asRecord(value, "clarification result");
  const questions = Array.isArray(root.clarifyingQuestions) ? root.clarifyingQuestions : [];
  const assumptions = Array.isArray(root.assumptions) ? root.assumptions : [];
  const result: RequirementCommunicationResult = {
    clarifyingQuestions: questions.map(normalizeQuestion).filter((q): q is ClarificationQuestion => q !== null).slice(0, 12),
    assumptions: assumptions.map(normalizeAssumption).filter((a): a is RequirementAssumption => a !== null).slice(0, 12),
    requirementDraft: normalizeDraft(root.requirementDraft),
    riskNotes: cleanStringArray(root.riskNotes, 12, 600),
  };
  result.clarifyingQuestions.sort((a, b) => PRIORITY_RANK.indexOf(a.priority) - PRIORITY_RANK.indexOf(b.priority));
  if (result.clarifyingQuestions.length === 0) throw new Error("clarifyingQuestions must contain at least one valid question");
  return result;
}

function fallbackRequirementCommunicationResult(
  input: RequirementCommunicationRequest,
  context: RequirementCommunicationContext,
  reason: string,
): RequirementCommunicationResult {
  const message = cleanText(input.message, 1200);
  const metricHint = /复购/.test(message) ? "复购率" : /留存/.test(message) ? "留存率" : /转化/.test(message) ? "转化率" : "核心指标";
  const hasMetricContext = Boolean(context.metricSummary?.trim());
  const hasPathContext = (context.pathMetas?.length ?? 0) > 0;
  const questions: ClarificationQuestion[] = [
    {
      id: "q-target",
      priority: "must_confirm",
      category: "目标",
      question: "本次分析的业务目标是什么：只解释指标变化原因，还是还需要输出可执行策略和优先级？",
      why: "目标不同会影响分析深度、输出物和是否需要行动建议。",
      status: "pending",
    },
    {
      id: "q-object",
      priority: "must_confirm",
      category: "对象",
      question: "分析对象的范围是什么：会员定义、门店/渠道范围、是否排除员工/团购/异常订单？",
      why: "对象口径不一致会直接改变指标分母和归因结论。",
      status: "pending",
    },
    {
      id: "q-time",
      priority: "must_confirm",
      category: "时间",
      question: "“本月”的具体时间范围和对比基准是什么：环比上月、同比去年同月，还是目标值对比？",
      why: "时间窗口和基准期决定是否能判断“下滑”以及下滑幅度。",
      status: "pending",
    },
    {
      id: "q-metric",
      priority: hasMetricContext ? "should_confirm" : "must_confirm",
      category: "指标",
      question: `${metricHint} 的正式口径是什么：分子、分母、去重规则、退款/取消订单是否排除？`,
      why: "指标口径未确认时，后续报告中的数字和原因判断都不能作为确定结论。",
      status: "pending",
    },
    {
      id: "q-data",
      priority: hasPathContext ? "should_confirm" : "must_confirm",
      category: "数据",
      question: "当前已登记聚合数据是否覆盖所需字段和粒度：会员、订单、时间、门店/渠道、商品/活动、触达等维度？",
      why: "数据粒度决定能否做分层拆解和原因定位。",
      status: "pending",
    },
    {
      id: "q-output",
      priority: "should_confirm",
      category: "交付",
      question: "最终输出物需要什么形式：澄清清单、分析框架、正式报告、策略清单，还是可落地行动计划？",
      why: "交付形式决定报告框架、证据要求和行动建议粒度。",
      status: "pending",
    },
    {
      id: "q-success",
      priority: "can_defer",
      category: "成功标准",
      question: "策略是否需要量化成功标准：目标提升幅度、观察周期、责任人或复盘方式？",
      why: "没有成功标准时，策略难以验证是否有效。",
      status: "pending",
    },
  ];
  return {
    clarifyingQuestions: questions,
    assumptions: [
      {
        id: "a-fallback-1",
        text: `系统未能解析模型返回的 JSON，已按轻量模式生成保守澄清清单；以下内容只作为待确认草案。失败原因：${cleanText(reason, 300)}`,
        status: "proposed",
        source: "model",
      },
      {
        id: "a-fallback-2",
        text: "默认先不写入正式需求，必须由用户确认后才能进入分析框架生成。",
        status: "proposed",
        source: "model",
      },
    ],
    requirementDraft: {
      background: "",
      objective: message,
      scope: [],
      metrics: metricHint === "核心指标" ? [] : [metricHint],
      questions: [message],
      outputs: ["澄清清单", "分析框架草案", "后续正式报告框架"],
      successCriteria: [],
      risks: ["模型返回 JSON 解析失败，本轮为确定性兜底草案", "指标口径、时间范围和数据粒度未确认前不得输出确定结论"],
      assumptions: ["确认前不写入正式需求"],
    },
    riskNotes: [
      "本轮使用确定性兜底结果，不代表业务事实已确认。",
      "后续报告仍必须标注来源、证据等级和待确认事项。",
    ],
  };
}

function formatPathMetas(pathMetas: RequirementCommunicationPathMeta[] = []): string {
  if (pathMetas.length === 0) return "未提供已登记路径元信息。";
  return pathMetas.slice(0, 40).map((path) => {
    const parts = [`id=${path.id}`, `folder=${path.folder}`, `kind=${path.kind}`, `name=${path.name}`];
    if (path.description) parts.push(`description=${path.description}`);
    return `- ${parts.join(" · ")}`;
  }).join("\n");
}

export function buildRequirementCommunicationPrompt(input: RequirementCommunicationRequest, context: RequirementCommunicationContext): { systemPrompt: string; prompt: string } {
  const systemPrompt = `你是 pi-xanthil 的需求澄清引擎。你只输出严格 JSON，不要 Markdown fence。
你必须把未确认项以问题或假设呈现，不得擅自定稿。
你可以引用已确认业务背景、指标口径和登记路径元信息，但不得读取或推断原始行级数据。
禁止使用 draw_data、data_exploration 字段值/样本/剖析结果；clean_data 首版只允许路径元信息/聚合说明，不允许文件正文。
输出必须是单个 JSON object，第一字符必须是 {，最后一个字符必须是 }，不要输出任何解释文字。`;
  const schema = `{
  "clarifyingQuestions": [{"id":"q-1","priority":"must_confirm|should_confirm|can_defer","category":"目标|范围|指标|数据|交付|风险","question":"问题","why":"为什么要问","status":"pending|answered|skipped|assumed|deferred","answer":"可选"}],
  "assumptions": [{"id":"a-1","text":"假设内容","status":"proposed","source":"user|history|business_context|metric|path_metadata|model"}],
  "requirementDraft": {"background":"","objective":"","scope":[],"metrics":[],"questions":[],"outputs":[],"successCriteria":[],"risks":[],"assumptions":[]},
  "riskNotes": []
}`;
  const prompt = [
    `[场景]\n${input.scene}`,
    `[用户诉求]\n${input.message}`,
    `[用户指定上下文引用]\n${input.contextRefs && input.contextRefs.length > 0 ? input.contextRefs.join("\n") : "未提供"}`,
    `[历史沟通摘要]\n${input.history ?? context.historySummary ?? "未提供"}`,
    `[已确认、可共享业务背景]\n${context.businessContextSummary || "未提供"}`,
    `[已确认指标口径摘要]\n${context.metricSummary || "未提供"}`,
    `[已登记路径元信息，仅可使用元信息，不得要求读取正文]\n${formatPathMetas(context.pathMetas)}`,
    `[输出要求]\n1. 至少给出 3 个 clarifyingQuestions，优先级 must_confirm 在前。\n2. requirementDraft 必须是可编辑草案；不确定内容写入 questions/risks/assumptions，不要当作事实。\n3. metrics 只能引用输入中已有指标口径，若缺口径则提出问题或假设，不要重新发明口径。\n4. 只输出符合以下 schema 的单个 JSON object；不要 Markdown、不要注释、不要尾随逗号、不要解释文字：\n${schema}`,
  ].join("\n\n");
  return { systemPrompt, prompt };
}

export function buildRequirementImportDocumentsPrompt(input: RequirementImportDocumentsRequest, documents: RequirementImportDocumentForPrompt[]): { systemPrompt: string; prompt: string } {
  const systemPrompt = `你是 pi-xanthil 的业务需求沟通材料整理器。你只输出严格 JSON，不要 Markdown fence。
导入材料只用于形成澄清问题、待确认假设和可编辑沟通草案；不得把未确认内容写成事实。
禁止推断或复原 draw_data 原始行、data_exploration 字段值/样本/剖析结果。clean_data 首版只能使用路径元信息/聚合说明，不得声称已读取正文。`;
  const schema = `{
  "documentSummaries": [{"id":"doc-1","name":"材料名","source":"business_requirements|report|clean_data|localText","summary":"摘要","warnings":[]}],
  "extractedFacts": ["仅来自材料中明确陈述、但仍需用户确认的事实候选"],
  "extractedQuestions": [{"category":"目标|范围|指标|数据|交付|风险","question":"澄清问题","why":"为什么要问","priority":"must_confirm|should_confirm|can_defer"}],
  "extractedAssumptions": [{"text":"假设内容","source":"材料 id 或材料名"}],
  "suggestedMessage": "给澄清 API 的建议输入，明确标注待确认",
  "riskNotes": []
}`;
  const formattedDocs = documents.map((doc) => [
    `### ${doc.id} · ${doc.name}`,
    `source=${doc.source}`,
    doc.warnings.length > 0 ? `warnings=${doc.warnings.join("；")}` : "warnings=无",
    doc.content,
  ].join("\n")).join("\n\n");
  const prompt = [
    `[场景]\n${input.scene}`,
    `[用户补充诉求]\n${input.message ?? "未提供"}`,
    `[导入材料]\n${formattedDocs}`,
    `[输出要求]\n1. documentSummaries 必须覆盖每个导入材料。\n2. extractedFacts 只能列“材料声称/用户提供”的候选事实，仍需确认；不确定内容放入 extractedQuestions 或 extractedAssumptions。\n3. suggestedMessage 用于后续澄清 API，必须提醒“以下来自导入材料，需用户确认”。\n4. 只输出符合以下 schema 的 JSON：\n${schema}`,
  ].join("\n\n");
  return { systemPrompt, prompt };
}

function normalizeImportDocumentSummary(raw: unknown, index: number, fallback?: RequirementImportDocumentForPrompt): RequirementDocumentSummary | null {
  const item = typeof raw === "object" && raw !== null ? raw as Record<string, unknown> : {};
  const summary = cleanText(item.summary, 1200);
  if (!summary && !fallback) return null;
  const source = IMPORT_DOCUMENT_SOURCES.has(String(item.source) as RequirementImportDocumentSource)
    ? String(item.source) as RequirementImportDocumentSource
    : fallback?.source ?? "localText";
  const warnings = cleanStringArray(item.warnings, 8, 300);
  const mergedWarnings = [...new Set([...(fallback?.warnings ?? []), ...warnings])];
  return {
    id: cleanText(item.id, 100) || fallback?.id || `doc-${index + 1}`,
    name: cleanText(item.name, 160) || fallback?.name || `材料 ${index + 1}`,
    source,
    summary: summary || "仅提供路径元信息，未读取正文。",
    ...(mergedWarnings.length > 0 ? { warnings: mergedWarnings } : {}),
  };
}

function normalizeExtractedQuestion(raw: unknown): RequirementExtractedQuestion | null {
  const item = typeof raw === "object" && raw !== null ? raw as Record<string, unknown> : {};
  const question = cleanText(item.question, 500);
  const why = cleanText(item.why ?? item.reason, 500);
  if (!question || !why) return null;
  return {
    category: cleanText(item.category, 80) || "需求澄清",
    question,
    why,
    priority: normalizePriority(item.priority),
  };
}

export function validateRequirementImportDocumentsResult(value: unknown, documents: RequirementImportDocumentForPrompt[] = []): RequirementImportDocumentsResult {
  const root = asRecord(value, "import documents result");
  const summaries = Array.isArray(root.documentSummaries) ? root.documentSummaries : [];
  const normalizedSummaries = documents.map((doc, index) => normalizeImportDocumentSummary(summaries[index], index, doc)).filter((item): item is RequirementDocumentSummary => item !== null);
  const extraSummaries = summaries.slice(documents.length).map((item, index) => normalizeImportDocumentSummary(item, index + documents.length)).filter((item): item is RequirementDocumentSummary => item !== null);
  const assumptions = Array.isArray(root.extractedAssumptions) ? root.extractedAssumptions : [];
  return {
    documentSummaries: [...normalizedSummaries, ...extraSummaries].slice(0, 12),
    extractedFacts: cleanStringArray(root.extractedFacts, 24, 600),
    extractedQuestions: (Array.isArray(root.extractedQuestions) ? root.extractedQuestions : []).map(normalizeExtractedQuestion).filter((item): item is RequirementExtractedQuestion => item !== null).slice(0, 12),
    extractedAssumptions: assumptions.map((raw) => {
      const item = typeof raw === "object" && raw !== null ? raw as Record<string, unknown> : {};
      const text = cleanText(item.text, 800);
      if (!text) return null;
      return { text, source: cleanText(item.source, 160) || "imported_document" };
    }).filter((item): item is { text: string; source: string } => item !== null).slice(0, 12),
    suggestedMessage: cleanText(root.suggestedMessage, 4000),
    riskNotes: cleanStringArray(root.riskNotes, 12, 600),
  };
}

export async function runRequirementImportDocuments(
  input: RequirementImportDocumentsRequest,
  documents: RequirementImportDocumentForPrompt[],
  runLlm: RequirementCommunicationLlm,
): Promise<RequirementImportDocumentsResult> {
  const { systemPrompt, prompt } = buildRequirementImportDocumentsPrompt(input, documents);
  const raw = await runLlm({ systemPrompt, prompt });
  return validateRequirementImportDocumentsResult(parseRequirementImportDocumentsJson(raw), documents);
}

export function makeRequirementImportDocumentFromText(input: RequirementImportDocumentInput, index: number, text: string, extraWarnings: string[] = []): RequirementImportDocumentForPrompt {
  const source = input.source;
  const warnings = [...extraWarnings];
  if (input.localText && input.localText.trim().length > LOCAL_TEXT_MAX_CHARS) warnings.push(`localText truncated to ${LOCAL_TEXT_MAX_CHARS} chars`);
  if (text.length > IMPORT_DOCUMENT_CONTENT_MAX_CHARS) warnings.push(`content truncated to ${IMPORT_DOCUMENT_CONTENT_MAX_CHARS} chars`);
  return {
    id: `doc-${index + 1}`,
    name: input.name || input.relPath?.split("/").pop() || (source === "localText" ? `粘贴材料 ${index + 1}` : `材料 ${index + 1}`),
    source,
    content: text.slice(0, IMPORT_DOCUMENT_CONTENT_MAX_CHARS),
    warnings,
  };
}

export function buildRequirementImportTracePayload(input: RequirementImportDocumentsRequest, documents: RequirementImportDocumentForPrompt[], result: RequirementImportDocumentsResult): Record<string, unknown> {
  return {
    scene: input.scene,
    documentCount: documents.length,
    sources: documents.reduce<Record<string, number>>((acc, item) => { acc[item.source] = (acc[item.source] ?? 0) + 1; return acc; }, {}),
    summaryLengths: result.documentSummaries.map((item) => ({ id: item.id, source: item.source, length: item.summary.length })),
    questionCount: result.extractedQuestions.length,
    assumptionCount: result.extractedAssumptions.length,
    riskCount: result.riskNotes.length,
  };
}

function confirmedSuccessCriteria(confirmed: ConfirmedBusinessRequirementStructured): string[] {
  return confirmed.reportFramework.flatMap((item) => item.keyQuestions).filter(Boolean).slice(0, 20);
}

export function buildAnalysisFrameworkFromConfirmedPrompt(confirmed: ConfirmedBusinessRequirementStructured, markdown = ""): { systemPrompt: string; prompt: string } {
  const systemPrompt = `你是资深数据分析顾问。你只输出严格 JSON，不要 Markdown fence。
你必须基于“确认需求”生成分析框架和报告框架，明确写出“基于确认需求生成”。
deferred/skipped/assumed/pending 等未确认问题只能进入 openQuestions/risks/zeroHallucinationCheck，不得写入 businessFacts。禁止读取或推断 draw_data、data_exploration。`;
  const schema = `{
  "projectName":"项目名称",
  "businessFacts":[],
  "inferredNeeds":[],
  "analysisQuestions":[],
  "metrics":[{"name":"指标名","definition":"指标定义","source":"confirmed_requirement"}],
  "dimensions":[],
  "dataNeeds":[{"name":"数据名","fields":[],"purpose":"用途","priority":"P0|P1|P2"}],
  "analysisFramework":[{"businessQuestion":"业务问题","hypothesis":"分析假设","method":"基于确认需求生成的验证方法","requiredData":[],"expectedOutput":"预期输出"}],
  "reportFramework":[{"section":"章节","purpose":"基于确认需求生成","keyQuestions":[],"requiredEvidence":[],"outputGuidance":"输出指导","zeroHallucinationCheck":"不得把未确认问题当事实"}],
  "deliverables":[],
  "openQuestions":[],
  "risks":[]
}`;
  const payload = {
    projectName: confirmed.projectName,
    confirmedFacts: confirmed.confirmedFacts.length > 0 ? confirmed.confirmedFacts : confirmed.businessFacts,
    confirmedAssumptions: confirmed.confirmedAssumptions,
    deferredQuestions: confirmed.deferredQuestions,
    successCriteria: confirmedSuccessCriteria(confirmed),
    metrics: confirmed.metrics,
    analysisQuestions: confirmed.analysisQuestions,
    deliverables: confirmed.deliverables,
    risks: confirmed.risks,
    scene: confirmed.communication.scene,
    confirmedAt: confirmed.communication.confirmedAt,
  };
  const prompt = [
    "[确认需求结构化 JSON 摘要]",
    JSON.stringify(payload, null, 2),
    "[确认需求 Markdown 原文，仅作交叉核对]",
    markdown.slice(0, 20000) || "未提供",
    "[生成要求]",
    "1. 必须消费 confirmedFacts、confirmedAssumptions、deferredQuestions、successCriteria、risks。",
    "2. deferredQuestions 只能进入 openQuestions/risks/zeroHallucinationCheck，不得进入 businessFacts。",
    "3. analysisFramework.method 与 reportFramework.purpose/outputGuidance 中明确“基于确认需求生成”。",
    `4. 只输出符合以下 schema 的 JSON：\n${schema}`,
  ].join("\n\n");
  return { systemPrompt, prompt };
}

function normalizeDataNeedPriority(value: unknown): "P0" | "P1" | "P2" {
  return value === "P1" || value === "P2" ? value : "P0";
}

export function validateAnalysisFrameworkFromConfirmedResult(
  value: unknown,
  confirmed: ConfirmedBusinessRequirementStructured,
  source: { jsonPath: string; markdownPath?: string },
): BusinessRequirementAnalysisFrameworkStructured {
  const item = asRecord(value, "analysis framework result");
  const deferred = new Set(confirmed.deferredQuestions.map((q) => q.trim()).filter(Boolean));
  const rawFacts = cleanStringArray(item.businessFacts, 30, 1000).filter((fact) => !deferred.has(fact));
  const confirmedFacts = confirmed.confirmedFacts.length > 0 ? confirmed.confirmedFacts : confirmed.businessFacts;
  const facts = rawFacts.length > 0 ? rawFacts : confirmedFacts;
  const dataNeeds = (Array.isArray(item.dataNeeds) ? item.dataNeeds : []).map((raw) => {
    const need = typeof raw === "object" && raw !== null ? raw as Record<string, unknown> : {};
    const name = cleanText(need.name, 200);
    const purpose = cleanText(need.purpose, 500);
    if (!name || !purpose) return null;
    return { name, fields: cleanStringArray(need.fields), purpose, priority: normalizeDataNeedPriority(need.priority) };
  }).filter((need): need is BusinessRequirementAnalysisFrameworkStructured["dataNeeds"][number] => need !== null).slice(0, 20);
  const analysisFramework = (Array.isArray(item.analysisFramework) ? item.analysisFramework : []).map((raw) => {
    const row = typeof raw === "object" && raw !== null ? raw as Record<string, unknown> : {};
    const businessQuestion = cleanText(row.businessQuestion, 500);
    if (!businessQuestion) return null;
    const method = cleanText(row.method, 800);
    return {
      businessQuestion,
      hypothesis: cleanText(row.hypothesis, 800),
      method: method.includes("基于确认需求") ? method : `基于确认需求生成：${method || "验证已确认目标、假设与风险"}`,
      requiredData: cleanStringArray(row.requiredData),
      expectedOutput: cleanText(row.expectedOutput, 800),
    };
  }).filter((row): row is BusinessRequirementAnalysisFrameworkStructured["analysisFramework"][number] => row !== null).slice(0, 20);
  const reportFramework = (Array.isArray(item.reportFramework) ? item.reportFramework : []).map((raw) => {
    const row = typeof raw === "object" && raw !== null ? raw as Record<string, unknown> : {};
    const section = cleanText(row.section, 200);
    if (!section) return null;
    const purpose = cleanText(row.purpose, 500);
    const zeroHallucinationCheck = cleanText(row.zeroHallucinationCheck, 800);
    return {
      section,
      purpose: purpose.includes("基于确认需求") ? purpose : `基于确认需求生成：${purpose || "回应已确认需求"}`,
      keyQuestions: cleanStringArray(row.keyQuestions),
      requiredEvidence: cleanStringArray(row.requiredEvidence),
      outputGuidance: cleanText(row.outputGuidance, 800) || "基于确认需求生成，区分已确认事实、假设和待确认问题。",
      zeroHallucinationCheck: zeroHallucinationCheck || "不得把 deferred/skipped/assumed/pending 问题写成已确认事实。",
    };
  }).filter((row): row is BusinessRequirementAnalysisFrameworkStructured["reportFramework"][number] => row !== null).slice(0, 20);
  return {
    projectName: cleanText(item.projectName, 200) || confirmed.projectName,
    businessFacts: facts.filter((fact) => !confirmed.deferredQuestions.includes(fact)).slice(0, 30),
    inferredNeeds: [...cleanStringArray(item.inferredNeeds, 20, 800), ...confirmed.confirmedAssumptions].filter(Boolean).slice(0, 30),
    analysisQuestions: cleanStringArray(item.analysisQuestions, 30, 800).length > 0 ? cleanStringArray(item.analysisQuestions, 30, 800) : confirmed.analysisQuestions,
    metrics: (Array.isArray(item.metrics) ? item.metrics : []).map((raw) => {
      const metric = typeof raw === "object" && raw !== null ? raw as Record<string, unknown> : {};
      const name = cleanText(metric.name, 200);
      if (!name) return null;
      return { name, definition: cleanText(metric.definition, 600) || "沿用确认需求口径", source: cleanText(metric.source, 200) || "confirmed_requirement" };
    }).filter((metric): metric is { name: string; definition: string; source: string } => metric !== null).slice(0, 20),
    dimensions: cleanStringArray(item.dimensions, 20, 300),
    dataNeeds,
    analysisFramework,
    reportFramework,
    deliverables: cleanStringArray(item.deliverables, 12, 400).length > 0 ? cleanStringArray(item.deliverables, 12, 400) : confirmed.deliverables,
    openQuestions: [...new Set([...cleanStringArray(item.openQuestions, 20, 600), ...confirmed.deferredQuestions])],
    risks: [...new Set([...cleanStringArray(item.risks, 20, 600), ...confirmed.risks, ...confirmed.deferredQuestions.map((q) => `待确认：${q}`)])],
    sourceConfirmedRequirement: {
      jsonPath: source.jsonPath,
      ...(source.markdownPath ? { markdownPath: source.markdownPath } : {}),
      scene: confirmed.communication.scene,
      confirmedAt: confirmed.communication.confirmedAt,
    },
  };
}

export async function runAnalysisFrameworkFromConfirmedRequirement(
  confirmed: ConfirmedBusinessRequirementStructured,
  source: { jsonPath: string; markdownPath?: string; markdown?: string },
  runLlm: RequirementCommunicationLlm,
): Promise<BusinessRequirementAnalysisFrameworkStructured> {
  const { systemPrompt, prompt } = buildAnalysisFrameworkFromConfirmedPrompt(confirmed, source.markdown ?? "");
  const raw = await runLlm({ systemPrompt, prompt });
  return validateAnalysisFrameworkFromConfirmedResult(parseRequirementCommunicationJson(raw), confirmed, source);
}

export function renderAnalysisFrameworkFromConfirmedMarkdown(result: BusinessRequirementAnalysisFrameworkStructured): string {
  const list = (items: string[]) => items.length > 0 ? items.map((item) => `- ${item}`).join("\n") : "- 待确认";
  const metrics = result.metrics.length > 0 ? result.metrics.map((item) => `| ${item.name} | ${item.definition} | ${item.source ?? "confirmed_requirement"} |`).join("\n") : "| 待确认 | 待确认 | confirmed_requirement |";
  const analysisRows = result.analysisFramework.length > 0 ? result.analysisFramework.map((item) => `| ${item.businessQuestion} | ${item.hypothesis} | ${item.method} | ${item.requiredData.join("、")} | ${item.expectedOutput} |`).join("\n") : "| 待确认 | 待确认 | 基于确认需求生成 | 待确认 | 待确认 |";
  const reportRows = result.reportFramework.length > 0 ? result.reportFramework.map((item) => `| ${item.section} | ${item.purpose} | ${item.keyQuestions.join("；")} | ${item.requiredEvidence.join("、")} | ${item.zeroHallucinationCheck} |`).join("\n") : "| 待确认 | 基于确认需求生成 | 待确认 | 待确认 | 不得把未确认问题当事实 |";
  return [
    `# ${result.projectName} 业务需求与分析框架`,
    "",
    "来源：基于确认需求生成",
    result.sourceConfirmedRequirement?.jsonPath ? `确认需求 JSON：${result.sourceConfirmedRequirement.jsonPath}` : "",
    result.sourceConfirmedRequirement?.markdownPath ? `确认需求 Markdown：${result.sourceConfirmedRequirement.markdownPath}` : "",
    "",
    "## 1. 已确认事实",
    list(result.businessFacts),
    "",
    "## 2. 已确认假设 / 推断需求",
    list(result.inferredNeeds),
    "",
    "## 3. 指标口径",
    "| 指标 | 口径 | 来源 |",
    "|---|---|---|",
    metrics,
    "",
    "## 4. 分析框架与路径",
    "| 业务问题 | 假设 | 方法 | 所需数据 | 预期输出 |",
    "|---|---|---|---|---|",
    analysisRows,
    "",
    "## 5. 报告框架",
    "| 章节 | 目的 | 关键问题 | 所需证据 | 零幻觉检查 |",
    "|---|---|---|---|---|",
    reportRows,
    "",
    "## 6. 待确认问题",
    list(result.openQuestions),
    "",
    "## 7. 风险",
    list(result.risks),
    "",
  ].filter((line) => line !== "").join("\n");
}

export function buildAnalysisFrameworkFromConfirmedTracePayload(result: BusinessRequirementAnalysisFrameworkStructured): Record<string, unknown> {
  return {
    confirmedRequirementBasename: result.sourceConfirmedRequirement?.jsonPath.split("/").pop() ?? "",
    confirmedAssumptionCount: result.inferredNeeds.length,
    openQuestionCount: result.openQuestions.length,
    riskCount: result.risks.length,
    analysisQuestionCount: result.analysisQuestions.length,
    analysisFrameworkCount: result.analysisFramework.length,
  };
}

export async function runRequirementCommunicationClarification(
  input: RequirementCommunicationRequest,
  context: RequirementCommunicationContext,
  runLlm: RequirementCommunicationLlm,
): Promise<RequirementCommunicationResult> {
  const { systemPrompt, prompt } = buildRequirementCommunicationPrompt(input, context);
  const raw = await runLlm({ systemPrompt, prompt });
  try {
    return validateRequirementCommunicationResult(parseRequirementCommunicationJson(raw));
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return fallbackRequirementCommunicationResult(input, context, reason);
  }
}

export interface RequirementCommunicationConfirmInput {
  scene: RequirementCommunicationScene;
  pathId: number;
  title: string;
  confirmedBy: string;
  sourceCommunicationId?: string;
  message?: string;
  history?: string;
  clarifyingQuestions: ClarificationQuestion[];
  assumptions: RequirementAssumption[];
  requirementDraft: RequirementDraft;
  riskNotes: string[];
}

export interface ConfirmedBusinessRequirementStructured {
  projectName: string;
  businessFacts: string[];
  inferredNeeds: string[];
  analysisQuestions: string[];
  metrics: Array<{ name: string; definition: string; source?: string }>;
  dimensions: string[];
  dataNeeds: Array<{ name: string; fields: string[]; purpose: string; priority: "P0" | "P1" | "P2" }>;
  analysisFramework: Array<{ businessQuestion: string; hypothesis?: string; method: string; requiredData: string[]; expectedOutput: string }>;
  reportFramework: Array<{ section: string; purpose: string; keyQuestions: string[]; requiredEvidence: string[]; outputGuidance: string; zeroHallucinationCheck: string }>;
  deliverables: string[];
  openQuestions: string[];
  risks: string[];
  confirmedFacts: string[];
  confirmedAssumptions: string[];
  deferredQuestions: string[];
  rejectedAssumptions: string[];
  communication: {
    confirmedAt: number;
    confirmedBy: string;
    scene: RequirementCommunicationScene;
    sourceCommunicationId?: string;
    recordPath: string;
  };
  version?: Record<string, unknown>;
}

export interface RequirementCommunicationRecord {
  id: string;
  scene: RequirementCommunicationScene;
  sourceCommunicationId?: string;
  message: string;
  history: string;
  clarifyingQuestions: ClarificationQuestion[];
  assumptions: RequirementAssumption[];
  requirementDraft: RequirementDraft;
  riskNotes: string[];
  confirmation: { confirmedAt: number; confirmedBy: string; markdownPath: string; jsonPath: string };
}

export function parseRequirementCommunicationConfirmInput(value: unknown): RequirementCommunicationConfirmInput {
  const body = asRecord(value, "request body");
  const scene = body.scene;
  if (!SCENES.has(scene as RequirementCommunicationScene)) throw new Error("scene must be daily, topic, or recurring");
  const pathId = Number(body.pathId);
  if (!Number.isFinite(pathId)) throw new Error("pathId required");
  const result = validateRequirementCommunicationResult({
    clarifyingQuestions: body.clarifyingQuestions,
    assumptions: body.assumptions,
    requirementDraft: body.requirementDraft,
    riskNotes: body.riskNotes,
  });
  const title = cleanText(body.title, 200) || result.requirementDraft.objective || "确认业务需求";
  return {
    scene: scene as RequirementCommunicationScene,
    pathId,
    title,
    confirmedBy: cleanText(body.confirmedBy, 120) || "user",
    sourceCommunicationId: cleanText(body.sourceCommunicationId, 120) || undefined,
    message: cleanText(body.message, 12000),
    history: cleanText(body.history, 12000),
    ...result,
  };
}

export function buildConfirmedBusinessRequirement(input: RequirementCommunicationConfirmInput, recordPath: string, confirmedAt: number): ConfirmedBusinessRequirementStructured {
  const answered = input.clarifyingQuestions.filter((item) => item.status === "answered" && item.answer?.trim());
  const deferred = input.clarifyingQuestions.filter((item) => item.status === "deferred" || item.status === "skipped" || item.status === "pending" || item.status === "assumed");
  const confirmedAssumptions = input.assumptions.filter((item) => item.status === "confirmed").map((item) => item.text);
  const rejectedAssumptions = input.assumptions.filter((item) => item.status === "rejected").map((item) => item.text);
  const draft = input.requirementDraft;
  const successCriteria = draft.successCriteria.length > 0 ? draft.successCriteria : draft.questions;
  return {
    projectName: input.title,
    businessFacts: [
      draft.background ? `背景：${draft.background}` : "",
      draft.objective ? `目标：${draft.objective}` : "",
      ...answered.map((item) => `${item.category}：${item.answer}`),
    ].filter(Boolean),
    inferredNeeds: confirmedAssumptions,
    analysisQuestions: draft.questions,
    metrics: draft.metrics.map((name) => ({ name, definition: "沿用已确认指标口径；如无对应口径则待确认", source: "confirmed_requirement" })),
    dimensions: draft.scope,
    dataNeeds: [],
    analysisFramework: draft.questions.map((question) => ({
      businessQuestion: question,
      hypothesis: confirmedAssumptions.join("；"),
      method: "基于已登记聚合数据与报告产物验证",
      requiredData: draft.metrics,
      expectedOutput: draft.outputs.join("；") || "分析结论",
    })),
    reportFramework: [{
      section: "需求对照",
      purpose: "检查报告是否回应已确认目标、成功标准与假设",
      keyQuestions: successCriteria,
      requiredEvidence: draft.metrics,
      outputGuidance: "明确区分已确认事实、假设、未回答问题和风险",
      zeroHallucinationCheck: "不得把 deferred/skipped/pending 问题写成已确认事实；所有指标沿用已确认口径。",
    }],
    deliverables: draft.outputs,
    openQuestions: deferred.map((item) => item.question),
    risks: [...draft.risks, ...input.riskNotes],
    confirmedFacts: answered.map((item) => `${item.category}：${item.answer}`),
    confirmedAssumptions,
    deferredQuestions: deferred.map((item) => item.question),
    rejectedAssumptions,
    communication: {
      confirmedAt,
      confirmedBy: input.confirmedBy,
      scene: input.scene,
      ...(input.sourceCommunicationId ? { sourceCommunicationId: input.sourceCommunicationId } : {}),
      recordPath,
    },
  };
}

export function renderConfirmedBusinessRequirementMarkdown(result: ConfirmedBusinessRequirementStructured): string {
  const list = (items: string[]) => items.length > 0 ? items.map((item) => `- ${item}`).join("\n") : "- 待确认";
  const metrics = result.metrics.length > 0 ? result.metrics.map((item) => `| ${item.name} | ${item.definition} | ${item.source ?? ""} |`).join("\n") : "| 待确认 | 待确认 | 待确认 |";
  return [
    `# ${result.projectName} 业务需求`,
    "",
    "## 确认元数据",
    `- confirmedAt: ${new Date(result.communication.confirmedAt).toISOString()}`,
    `- confirmedBy: ${result.communication.confirmedBy}`,
    `- scene: ${result.communication.scene}`,
    result.communication.sourceCommunicationId ? `- sourceCommunicationId: ${result.communication.sourceCommunicationId}` : "",
    "",
    "## Confirmed Facts",
    list(result.businessFacts),
    "",
    "## Assumptions",
    list(result.confirmedAssumptions),
    "",
    "## Deferred / Skipped Questions",
    list(result.deferredQuestions),
    "",
    "## 分析问题",
    list(result.analysisQuestions),
    "",
    "## 指标口径",
    "| 指标 | 口径 | 来源 |",
    "|---|---|---|",
    metrics,
    "",
    "## 输出与成功标准",
    "### 输出物",
    list(result.deliverables),
    "",
    "### 成功标准",
    list(result.reportFramework[0]?.keyQuestions ?? []),
    "",
    "## 风险",
    list(result.risks),
    "",
  ].join("\n");
}

export function isConfirmedBusinessRequirementJsonPath(value: string): boolean {
  const normalized = value.replace(/\\/g, "/");
  return /^business_requirements\/[^/]+-确认需求-\d{8}-\d{6}\.json$/.test(normalized);
}

export function buildRequirementCommunicationRecord(input: RequirementCommunicationConfirmInput, id: string, confirmedAt: number, markdownPath: string, jsonPath: string): RequirementCommunicationRecord {
  return {
    id,
    scene: input.scene,
    ...(input.sourceCommunicationId ? { sourceCommunicationId: input.sourceCommunicationId } : {}),
    message: input.message ?? "",
    history: input.history ?? "",
    clarifyingQuestions: input.clarifyingQuestions,
    assumptions: input.assumptions,
    requirementDraft: input.requirementDraft,
    riskNotes: input.riskNotes,
    confirmation: { confirmedAt, confirmedBy: input.confirmedBy, markdownPath, jsonPath },
  };
}

export function buildRequirementReviewContext(result: ConfirmedBusinessRequirementStructured): string {
  return [
    "## 已确认业务需求对照上下文",
    `目标：${result.businessFacts.find((item) => item.startsWith("目标：")) ?? "待确认"}`,
    `成功标准：${result.reportFramework[0]?.keyQuestions.join("；") || "待确认"}`,
    `确认假设：${result.confirmedAssumptions.join("；") || "无"}`,
    `未确认问题：${result.deferredQuestions.join("；") || "无"}`,
    "报告审核时请检查：报告是否回应目标、成功标准和假设；是否把未确认问题当成事实。",
  ].join("\n");
}

export function buildRequirementConfirmationTracePayload(input: RequirementCommunicationConfirmInput, structured: ConfirmedBusinessRequirementStructured): Record<string, unknown> {
  const assumptionStatuses = input.assumptions.reduce<Record<string, number>>((acc, item) => { acc[item.status] = (acc[item.status] ?? 0) + 1; return acc; }, {});
  return {
    scene: input.scene,
    questionCount: input.clarifyingQuestions.length,
    answeredQuestionCount: input.clarifyingQuestions.filter((item) => item.status === "answered").length,
    deferredQuestionCount: structured.deferredQuestions.length,
    assumptionStatuses,
    confirmedAssumptionCount: structured.confirmedAssumptions.length,
    outputCount: structured.deliverables.length,
    riskCount: structured.risks.length,
  };
}
