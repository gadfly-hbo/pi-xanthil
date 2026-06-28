import { runPiPrompt } from "./pi-adapter.ts";
import { getWorkspace } from "./db.ts";
import {
  getCrowdSegment,
  getCrowdDataset,
  listCrowdTagDictionary,
  createCrowdProfile,
  createCrowdProfileVersion,
  updateCrowdProfile,
} from "./db/data.ts";
import type {
  CrowdProfileContent,
  CrowdProfileGenerationInput,
  CrowdProfileGenerationResult,
  CrowdFieldProfile,
  CrowdTagDictionaryEntry,
  CrowdSegment,
} from "./types.ts";

// ── pi runner injection point (for tests) ─────────────────────────────────

export type CrowdProfileRunPi = (opts: {
  workspaceRoot: string;
  model: string;
  systemPrompt: string;
  text: string;
  timeoutMs: number;
}) => Promise<string>;

const defaultRunPi: CrowdProfileRunPi = (opts) =>
  runPiPrompt({ ...opts, onEvent: () => {} });

// ── JSON helpers (reused from simulation-lab pattern) ──────────────────────

export function extractJsonObjectText(text: string): string {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
  const raw = fenced?.[1] ?? text;
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end <= start) return "{}";
  return raw.slice(start, end + 1);
}

function repairLooseJson(text: string): string {
  return text.replace(/,\s*([\]}])/g, "$1");
}

export function extractJsonObject(text: string): unknown {
  const raw = extractJsonObjectText(text);
  if (raw === "{}") throw new Error(`LLM response does not contain JSON object: ${text.slice(0, 300)}`);
  for (const candidate of [raw, repairLooseJson(raw)]) {
    try { return JSON.parse(candidate); } catch { /* try next */ }
  }
  throw new Error(`LLM response JSON could not be parsed: ${raw.slice(0, 300)}`);
}

// ── input parsing ──────────────────────────────────────────────────────────

export function parseCrowdProfileRequest(body: unknown): CrowdProfileGenerationInput {
  const src = (typeof body === "object" && body !== null ? body : {}) as Record<string, unknown>;
  if (typeof src.segmentId !== "string" || !src.segmentId.trim()) {
    throw new Error("segmentId (string) required");
  }
  if (typeof src.model !== "string" || !src.model.trim()) {
    throw new Error("model required");
  }
  const result: CrowdProfileGenerationInput = {
    segmentId: src.segmentId.trim(),
    model: src.model.trim(),
  };
  if (typeof src.businessContext === "string" && src.businessContext.trim()) {
    result.businessContext = src.businessContext.trim();
  }
  return result;
}

// ── prompt building (pure function · aggregate data only) ───────────────────

function isIdentifierLikeField(field: string): boolean {
  const normalized = field.trim().toLowerCase();
  return /(^|[_\-\s])(row|record|user|uid|id|primary|key|phone|mobile|tel|email|openid|unionid)([_\-\s]|$)/i.test(normalized)
    || /(行号|记录|用户id|会员id|客户id|主键|身份证|证件|手机号|手机|电话|邮箱)/i.test(field);
}

function summarizeFieldProfiles(profiles: CrowdFieldProfile[]): string {
  const safeProfiles = profiles.filter((p) => !isIdentifierLikeField(p.field));
  if (safeProfiles.length === 0) return "（无字段画像数据）";
  return safeProfiles.map((p) => {
    const parts = [`字段「${p.field}」(${p.inferredType})`];
    if (p.missingCount > 0) parts.push(`缺失${p.missingCount}条`);
    if (p.uniqueCount > 0) parts.push(`唯一值${p.uniqueCount}个`);
    if (p.topValues && p.topValues.length > 0) {
      const topStr = p.topValues.slice(0, 5).map((v) => `${v.value}(${(v.ratio * 100).toFixed(1)}%)`).join(", ");
      parts.push(`Top: ${topStr}`);
    }
    if (p.numericRange) {
      parts.push(`范围[${p.numericRange.min}~${p.numericRange.max}]`);
    }
    return parts.join("，");
  }).join("\n");
}

function summarizeTagDictionary(entries: CrowdTagDictionaryEntry[]): string {
  const safeEntries = entries.filter((e) => e.enabled && !isIdentifierLikeField(e.field));
  if (safeEntries.length === 0) return "（无标签字典）";
  return safeEntries.map((e) => {
    const parts = [`「${e.label}」(字段:${e.field}, 维度:${e.dimension})`];
    if (e.description) parts.push(`说明:${e.description}`);
    if (e.weight !== 1) parts.push(`权重:${e.weight}`);
    if (e.valueLabels && Object.keys(e.valueLabels).length > 0) {
      const vl = Object.entries(e.valueLabels).slice(0, 8).map(([k, v]) => `${k}=${v}`).join(", ");
      parts.push(`值映射:{${vl}}`);
    }
    return parts.join("，");
  }).join("\n");
}

function summarizeTagDistribution(dist: Record<string, Array<{ value: string; count: number; ratio: number }>>): string {
  const keys = Object.keys(dist).filter((field) => !isIdentifierLikeField(field));
  if (keys.length === 0) return "（无标签分布数据）";
  return keys.slice(0, 20).map((field) => {
    const values = dist[field];
    if (!values || values.length === 0) return `「${field}」: 无数据`;
    const topStr = values.slice(0, 5).map((v) => `${v.value}(${(v.ratio * 100).toFixed(1)}%)`).join(", ");
    return `「${field}」: ${topStr}`;
  }).join("\n");
}

function summarizeSegmentRule(rule: CrowdSegment["rule"]): string {
  if (!rule || !rule.conditions || rule.conditions.length === 0) return "（无筛选条件，全量人群）";
  const safeConditions = rule.conditions.filter((c) => !isIdentifierLikeField(c.field));
  if (safeConditions.length === 0) return "（分群条件仅包含标识类字段，已从画像生成 prompt 省略）";
  const condStrs = safeConditions.map((c) => {
    const base = `${c.field} ${c.operator}`;
    if (c.operator === "exists") return `${base}`;
    if (c.operator === "missing") return `${base}`;
    if (c.operator === "range") return `${base} [${c.min ?? "-∞"}, ${c.max ?? "+∞"}]`;
    if (Array.isArray(c.value)) return `${base} [${c.value.join(", ")}]`;
    return `${base} ${c.value}`;
  });
  return `逻辑: ${rule.logic.toUpperCase()}\n条件:\n${condStrs.map((s) => `  - ${s}`).join("\n")}`;
}

export function buildCrowdProfilePrompts(args: {
  segment: CrowdSegment;
  fieldProfiles: CrowdFieldProfile[];
  tagDictionary: CrowdTagDictionaryEntry[];
  businessContext?: string;
}): { systemPrompt: string; userPrompt: string } {
  const { segment, fieldProfiles, tagDictionary, businessContext } = args;

  const systemPrompt = `你是人群画像专家。请基于提供的聚合数据摘要，生成结构化的人群侧写（Persona Draft）。

要求：
1. 基于聚合统计量（字段画像、标签分布、标签字典解释）推断人群特征，不要编造具体个体数据。
2. 输出严格 JSON 对象，不要解释，不要使用 Markdown fence（如 \`\`\`json）。
3. evidenceSummary 中的每条证据必须是聚合口径描述（如"高消费占比32%"），禁止引用行级个体数据或原始标签值。
4. traits/motivations/decisionTriggers/objections/riskNotes 每项至少 2 条，最多 8 条。
5. contentPreference 每项至少 1 条，最多 5 条。
6. persona 是一段 100-300 字的人群侧写文字。`;

  const fieldSummary = summarizeFieldProfiles(fieldProfiles);
  const tagDictSummary = summarizeTagDictionary(tagDictionary);
  const tagDistSummary = summarizeTagDistribution(segment.tagDistribution);
  const ruleSummary = summarizeSegmentRule(segment.rule);

  const userPrompt = `## 分群信息
名称：${segment.name}
描述：${segment.description || "无"}
覆盖人数：${segment.sampleCount}（覆盖率 ${(segment.coverageRatio * 100).toFixed(1)}%）

## 分群规则
${ruleSummary}

## 字段画像聚合摘要
${fieldSummary}

## 标签字典解释
${tagDictSummary}

## 核心标签分布摘要
${tagDistSummary}

${businessContext ? `## 业务场景说明\n${businessContext}` : ""}

请基于以上聚合数据，生成结构化人群侧写 JSON。`;

  return { systemPrompt, userPrompt };
}

// ── schema validation + normalization ───────────────────────────────────────

function asStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    : [];
}

export function normalizeCrowdProfileContent(value: unknown): CrowdProfileContent {
  const src = typeof value === "object" && value !== null ? value as Record<string, unknown> : {};
  const traits = asStringArray(src.traits);
  const motivations = asStringArray(src.motivations);
  const decisionTriggers = asStringArray(src.decisionTriggers);
  const objections = asStringArray(src.objections);
  const tone = typeof src.tone === "string" ? src.tone.trim() : "";
  const contentPreference = asStringArray(src.contentPreference);
  const riskNotes = asStringArray(src.riskNotes);
  const evidenceSummary = asStringArray(src.evidenceSummary);
  const persona = typeof src.persona === "string" ? src.persona.trim() : "";

  // Ensure minimum field counts
  if (traits.length === 0) traits.push("数据不足，无法推断特征");
  if (motivations.length === 0) motivations.push("数据不足，无法推断动机");
  if (decisionTriggers.length === 0) decisionTriggers.push("数据不足，无法推断决策触发因素");
  if (objections.length === 0) objections.push("暂无明确异议数据");
  if (contentPreference.length === 0) contentPreference.push("数据不足，无法推断内容偏好");
  if (evidenceSummary.length === 0) evidenceSummary.push("聚合数据摘要不足，需补充标签分布");

  return {
    traits: traits.slice(0, 8),
    motivations: motivations.slice(0, 8),
    decisionTriggers: decisionTriggers.slice(0, 8),
    objections: objections.slice(0, 8),
    tone: tone || "稳重务实",
    contentPreference: contentPreference.slice(0, 5),
    riskNotes: riskNotes.slice(0, 8),
    evidenceSummary: evidenceSummary.slice(0, 10),
    persona: persona || "基于聚合数据生成的人群侧写，需进一步补充细节。",
  };
}

// ── repair via LLM ─────────────────────────────────────────────────────────

async function repairProfileJson(
  rawOutput: string,
  model: string,
  workspaceRoot: string,
  runPi: CrowdProfileRunPi,
): Promise<unknown> {
  const schemaHint = `
{
  "traits": ["string"],
  "motivations": ["string"],
  "decisionTriggers": ["string"],
  "objections": ["string"],
  "tone": "string",
  "contentPreference": ["string"],
  "riskNotes": ["string"],
  "evidenceSummary": ["string (聚合口径，禁止行级引用)"],
  "persona": "string (100-300字人群侧写)"
}`;
  const repaired = await runPi({
    workspaceRoot,
    model,
    systemPrompt: "你是 JSON 修复器。只输出严格 JSON，不要解释。",
    text: `请把下面模型输出改写为符合 schema 的严格 JSON。\n\nschema：\n${schemaHint}\n\n原输出：\n${rawOutput.slice(0, 8000)}`,
    timeoutMs: 60_000,
  });
  return extractJsonObject(repaired);
}

// ── main runner ────────────────────────────────────────────────────────────

export interface RunCrowdProfileOptions {
  runPi?: CrowdProfileRunPi;
  workspaceId?: string;
}

export async function runCrowdProfileGeneration(
  input: CrowdProfileGenerationInput,
  opts: RunCrowdProfileOptions = {},
): Promise<CrowdProfileGenerationResult> {
  const runPi = opts.runPi ?? defaultRunPi;

  // 1. Load segment + dataset
  const segment = getCrowdSegment(input.segmentId);
  if (!segment) throw new Error("segment not found");
  if (opts.workspaceId && segment.workspaceId !== opts.workspaceId) {
    throw new Error("segment belongs to another workspace");
  }

  const dataset = getCrowdDataset(segment.datasetId);
  if (!dataset) throw new Error("dataset not found");

  const workspace = getWorkspace(segment.workspaceId);
  if (!workspace) throw new Error("workspace not found");

  // 2. Load aggregate data only (no raw rows)
  const fieldProfiles = typeof dataset.fieldProfiles === "string"
    ? JSON.parse(dataset.fieldProfiles) as CrowdFieldProfile[]
    : Array.isArray(dataset.fieldProfiles)
      ? dataset.fieldProfiles as CrowdFieldProfile[]
      : [];

  const tagDictionary = listCrowdTagDictionary(segment.workspaceId, segment.datasetId);

  // 3. Build prompts (pure function · only aggregate data)
  const { systemPrompt, userPrompt } = buildCrowdProfilePrompts({
    segment,
    fieldProfiles,
    tagDictionary,
    businessContext: input.businessContext,
  });

  // 4. Call LLM
  const rawOutput = await runPi({
    workspaceRoot: workspace.rootPath,
    model: input.model,
    systemPrompt,
    text: userPrompt,
    timeoutMs: 120_000,
  });

  // 5. Parse JSON with repair fallback
  let parsed: unknown;
  try {
    parsed = extractJsonObject(rawOutput);
  } catch {
    parsed = await repairProfileJson(rawOutput, input.model, workspace.rootPath, runPi);
  }

  // 6. Validate required structure exists
  if (typeof parsed !== "object" || parsed === null) {
    throw new Error("LLM output is not a JSON object");
  }

  // 7. Normalize + validate content
  const content = normalizeCrowdProfileContent(parsed);

  // 8. Red-line check: evidenceSummary must not contain raw row indicators
  const rowIndicatorPattern = /\b(row|record|user|individual|sample|明细|行级|个体)\b/i;
  for (const evidence of content.evidenceSummary) {
    if (rowIndicatorPattern.test(evidence)) {
      throw new Error(`evidenceSummary contains raw row reference: "${evidence.slice(0, 100)}"`);
    }
  }

  // 9. Persist: create or find profile + version
  const profileName = `${segment.name} 画像`;

  // Check if a profile already exists for this segment
  const existingProfiles = await import("./db/data.ts").then((m) =>
    m.listCrowdProfiles(segment.workspaceId, input.segmentId)
  );
  let profile = existingProfiles.find((p) => p.name === profileName);

  if (!profile) {
    profile = createCrowdProfile(segment.workspaceId, {
      segmentId: input.segmentId,
      name: profileName,
      status: "draft",
    });
  }

  const version = createCrowdProfileVersion(segment.workspaceId, profile.id, {
    content,
    source: "generated",
  });

  updateCrowdProfile(profile.id, { currentVersionId: version.id });

  return { profile, version };
}
