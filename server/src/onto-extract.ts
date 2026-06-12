import { runPiPrompt } from "./pi-adapter.ts";
import { DIRECT_LLM_ROOT } from "./config.ts";
import {
  createObjectType, createLink, listObjectTypes,
  createLogicRule, createOntoAction, listLogicRules,
  getExtractJob, updateExtractJob,
} from "./db/viz.ts";
import type { LinkKind } from "./types.ts";
import { validateExtraction, type ValidatableData } from "./onto-validator.ts";

/**
 * onto-xanthil 文档抽取（P3 起；P7 扩展到 logic/action 四类）。**经 pi CLI，不直接调模型**。
 * 借 nano-ontoprompt 工程精华（轻量版）：四类置信度校准 + 分级质检门禁 + 名称模糊解析 + richness 去重。
 */

const DEFAULT_MODEL = "minimax-cn/MiniMax-M3";
// 单次抽取允许送入 LLM 的最大字符数。原 6000 实测会硬截掉中长文档后半段。
// thinking 模型 300s 超时下，24000 字符（≈ 中文 1.2 万–1.6 万 token）可稳定返回（密集指标文档曾在 180s 下超时）。
// 超长文档建议分块（见 processExtractionOutput 同名去重 / resolveId 跨批合并已支持），后续 enhancement。
const CONTENT_LIMIT = 24000;
const CHUNK_BUDGET = 8000;
const CHUNK_OVERLAP = 400;
const DOC_LINK_KINDS: LinkKind[] = ["is-a", "part-of", "related"]; // 文档抽取仅产语义关系，不产 join/fk

/**
 * Split a large document into chunks for multi-batch extraction.
 * CSV: header row + N data rows per chunk; md/txt: character window with overlap.
 * Pure function, no side effects.
 */
export function chunkDocument(text: string, fileName?: string): string[] {
  const trimmed = text.trim();
  if (!trimmed) return [];
  if (trimmed.length <= CONTENT_LIMIT) return [trimmed];

  const isCsv = fileName?.toLowerCase().endsWith(".csv") || looksLikeCsv(trimmed);
  return isCsv ? chunkCsv(trimmed) : chunkText(trimmed);
}

function looksLikeCsv(text: string): boolean {
  const firstLine = text.slice(0, text.indexOf("\n")).trim();
  if (!firstLine) return false;
  const commas = (firstLine.match(/,/g) ?? []).length;
  return commas >= 2;
}

function chunkCsv(text: string): string[] {
  const lines = text.split("\n");
  const header = lines[0] ?? "";
  const dataLines = lines.slice(1).filter((l) => l.trim());
  if (dataLines.length === 0) return [text];

  const chunks: string[] = [];
  let batch: string[] = [];
  let batchLen = header.length;

  for (const line of dataLines) {
    if (batchLen + line.length + 1 > CHUNK_BUDGET && batch.length > 0) {
      chunks.push(header + "\n" + batch.join("\n"));
      batch = [];
      batchLen = header.length;
    }
    batch.push(line);
    batchLen += line.length + 1;
  }
  if (batch.length > 0) chunks.push(header + "\n" + batch.join("\n"));
  return chunks;
}

function chunkText(text: string): string[] {
  const chunks: string[] = [];
  let start = 0;
  while (start < text.length) {
    let end = Math.min(start + CHUNK_BUDGET, text.length);
    if (end < text.length) {
      const paraBreak = text.lastIndexOf("\n\n", end);
      if (paraBreak > start + CHUNK_BUDGET * 0.5) {
        end = paraBreak + 2;
      } else {
        const lineBreak = text.lastIndexOf("\n", end);
        if (lineBreak > start + CHUNK_BUDGET * 0.5) {
          end = lineBreak + 1;
        }
      }
    }
    chunks.push(text.slice(start, end));
    start = end > start ? Math.max(start + 1, end - CHUNK_OVERLAP) : end;
    if (text.length - start < CHUNK_OVERLAP && chunks.length > 0) {
      chunks[chunks.length - 1] += text.slice(start);
      break;
    }
  }
  return chunks;
}

// 质检类型统一由 onto-validator 持有（P4）；此处 re-export 保持既有 import 路径兼容
export type { Severity, ValidationIssue } from "./onto-validator.ts";
import type { ValidationIssue } from "./onto-validator.ts";
export interface ExtractReport {
  hasFatal: boolean;
  totalIssues: number;
  issues: ValidationIssue[];
}
export interface OntoExtractResult {
  createdObjects: number;
  createdLinks: number;
  createdLogicRules: number;
  createdActions: number;
  skippedObjects: number;
  skippedLinks: number;
  report: ExtractReport;
}

interface RawEntity { nameCn: string; nameEn?: string; description?: string; confidence?: number }
interface RawRelation { source: string; target: string; kind?: string }
interface RawLogicRule { nameCn: string; nameEn?: string; description?: string; formula?: string; linkedEntities: string[]; confidence?: number }
interface RawAction { nameCn: string; nameEn?: string; description?: string; executionRule?: string; functionCode?: string; linkedEntities: string[]; linkedLogic: string[]; confidence?: number }

interface ParsedExtract { entities: unknown[]; relations: unknown[]; logicRules: unknown[]; actions: unknown[] }
function parseExtractJson(text: string): ParsedExtract | null {
  try {
    // Strip thinking-model reasoning traces first — their braces would corrupt the brace-scan below.
    const stripped = text.replace(/<think>[\s\S]*?<\/think>/gi, "");
    const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(stripped);
    const raw = fenced?.[1] ?? stripped;
    const start = raw.indexOf("{");
    const end = raw.lastIndexOf("}");
    if (start < 0 || end <= start) return null;
    const parsed = JSON.parse(raw.slice(start, end + 1)) as unknown;
    if (typeof parsed !== "object" || parsed === null) return null;
    const obj = parsed as Record<string, unknown>;
    const arr = (k: string) => (Array.isArray(obj[k]) ? (obj[k] as unknown[]) : []);
    return {
      entities: arr("entities"),
      relations: arr("relations"),
      logicRules: arr("logic_rules"),
      actions: arr("actions"),
    };
  } catch {
    return null;
  }
}

const str = (v: unknown, max = 80): string | undefined => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : undefined);
const strList = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && !!x.trim()).map((x) => x.trim()) : []);

function normEntity(raw: unknown): RawEntity | null {
  if (typeof raw !== "object" || raw === null) return null;
  const e = raw as Record<string, unknown>;
  const nameCn = (str(e.nameCn) ?? str(e.name)) ?? "";
  if (!nameCn) return null;
  return { nameCn, nameEn: str(e.nameEn), description: str(e.description, 300), confidence: typeof e.confidence === "number" ? e.confidence : undefined };
}

function normRelation(raw: unknown): RawRelation | null {
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as Record<string, unknown>;
  const source = str(r.source); const target = str(r.target);
  if (!source || !target) return null;
  return { source, target, kind: typeof r.kind === "string" ? r.kind : undefined };
}

function normLogic(raw: unknown): RawLogicRule | null {
  if (typeof raw !== "object" || raw === null) return null;
  const l = raw as Record<string, unknown>;
  const nameCn = (str(l.nameCn) ?? str(l.name)) ?? "";
  if (!nameCn) return null;
  return {
    nameCn, nameEn: str(l.nameEn), description: str(l.description, 300),
    formula: str(l.formula, 300),
    linkedEntities: strList(l.linkedEntities ?? l.linked_entities),
    confidence: typeof l.confidence === "number" ? l.confidence : undefined,
  };
}

function normAction(raw: unknown): RawAction | null {
  if (typeof raw !== "object" || raw === null) return null;
  const a = raw as Record<string, unknown>;
  const nameCn = (str(a.nameCn) ?? str(a.name)) ?? "";
  if (!nameCn) return null;
  return {
    nameCn, nameEn: str(a.nameEn), description: str(a.description, 300),
    executionRule: str(a.executionRule ?? a.execution_rule, 300),
    functionCode: str(a.functionCode ?? a.function_code, 2000),
    linkedEntities: strList(a.linkedEntities ?? a.linked_entities),
    linkedLogic: strList(a.linkedLogic ?? a.linked_logic ?? a.linkedLogicNames),
    confidence: typeof a.confidence === "number" ? a.confidence : undefined,
  };
}

const clamp = (v: number, lo: number, hi: number) => Math.round(Math.max(lo, Math.min(hi, v)) * 1000) / 1000;

// ── 四类置信度客观校准（nano _calibrate_confidence 轻量版）──
function calibrate(entities: RawEntity[], relations: RawRelation[], logic: RawLogicRule[], actions: RawAction[]): void {
  const inGraph = new Set<string>();
  for (const r of relations) { inGraph.add(r.source); inGraph.add(r.target); }
  for (const e of entities) {
    let conf = e.confidence ?? 0.85;
    if (!e.description) conf -= 0.05;
    if (inGraph.has(e.nameCn)) conf += 0.05;
    e.confidence = clamp(conf, 0.3, 0.98);
  }
  for (const l of logic) {
    let conf = l.confidence ?? 0.85;
    if (l.linkedEntities.length === 0) conf -= 0.10;
    if (!l.formula) conf -= 0.05;
    l.confidence = clamp(conf, 0.3, 0.98);
  }
  for (const a of actions) {
    let conf = a.confidence ?? 0.85;
    const code = (a.functionCode ?? "").trim();
    if (!code || code.length < 20) conf -= 0.20;
    if (a.linkedEntities.length === 0) conf -= 0.05;
    a.confidence = clamp(conf, 0.3, 0.98);
  }
}

// 分级质检门禁见 `onto-validator.ts:validateExtraction`（P4+P7：7 检查全覆盖）

// 名称模糊解析到 id（nano _fuzzy_resolve_entity 轻量版）
function resolveId(name: string, nameToId: Map<string, string>): string | null {
  if (nameToId.has(name)) return nameToId.get(name)!;
  const candidates = [...nameToId.entries()].filter(([kn]) => kn.includes(name) || name.includes(kn));
  if (candidates.length === 0) return null;
  candidates.sort((a, b) => commonChars(b[0], name) - commonChars(a[0], name));
  return candidates[0]![1];
}
function commonChars(a: string, b: string): number {
  const sb = new Set(b);
  return [...new Set(a)].filter((c) => sb.has(c)).length;
}

// richness：信息量启发分（nano _richness 轻量版），同名实体保留更富者
function entityRichness(e: RawEntity): number {
  return (e.description?.length ?? 0) + (e.nameEn?.length ?? 0);
}

// 默认抽取 prompt 模板（P8：`{{content}}` 为文档正文占位符，供前端编辑/版本化复用）。
export const DEFAULT_PROMPT_TEMPLATE = `请从以下文档中抽取领域本体的「实体」「关系」「逻辑规则」「动作」。

文档内容：
{{content}}

输出严格 JSON（不要 Markdown fence、不要注释）：
{
  "entities": [
    {"nameCn": "实体中文名（20字内）", "nameEn": "英文名(可选)", "description": "简短描述(100字内)", "confidence": 0.9}
  ],
  "relations": [
    {"source": "实体名", "target": "实体名", "kind": "is-a|part-of|related"}
  ],
  "logic_rules": [
    {"nameCn": "规则名", "formula": "形式化表达(可选)", "description": "说明(可选)", "linkedEntities": ["实体名"]}
  ],
  "actions": [
    {"nameCn": "动作名", "executionRule": "触发条件", "functionCode": "可执行伪码/Python(可选)", "linkedEntities": ["实体名"], "linkedLogic": ["规则名"]}
  ]
}
要求：① 实体 ≤ 40 个，取文档明确出现的核心概念；② 关系 source/target 必须是 entities 里的 nameCn，kind 只用 is-a/part-of/related，≤ 60 条；③ 逻辑规则=领域约束/必然关系，linkedEntities 必须是 entities 里的 nameCn，≤ 20 条；④ 动作=可被触发的操作，linkedLogic 必须是 logic_rules 里的 nameCn，≤ 20 条；⑤ 文档若无逻辑规则/动作则给空数组。`;

function buildPrompt(text: string, template?: string): string {
  const content = text.slice(0, CONTENT_LIMIT);
  const tpl = template && template.includes("{{content}}") ? template : DEFAULT_PROMPT_TEMPLATE;
  return tpl.replace("{{content}}", content);
}

export async function extractOntologyFromText(
  ontologyId: string,
  text: string,
  model = DEFAULT_MODEL,
  promptTemplate?: string,
): Promise<OntoExtractResult> {
  const output = await runPiPrompt({
    workspaceRoot: DIRECT_LLM_ROOT,
    text: buildPrompt(text, promptTemplate),
    model,
    systemPrompt: "你是本体抽取助手，只输出严格 JSON，不包含 Markdown fence 和注释。",
    // 密集指标文档（中文 token 密度高）+ thinking 模型实测会超过 180s，提到 300s 留余量（与 index.ts 其他重抽取调用一致）。
    timeoutMs: 300_000,
  });
  return processExtractionOutput(ontologyId, output);
}

/** LLM 之后的纯处理流水线：parse → 四类校准 → 质检去重 → 落库（脱离 pi，可独立测试）。 */
export function processExtractionOutput(ontologyId: string, output: string): OntoExtractResult {
  const zero = { createdObjects: 0, createdLinks: 0, createdLogicRules: 0, createdActions: 0, skippedObjects: 0, skippedLinks: 0 };

  const parsed = parseExtractJson(output);
  if (!parsed) {
    return { ...zero, report: { hasFatal: true, totalIssues: 1, issues: [{ severity: "fatal", code: "PARSE_FAILED", message: "模型输出无法解析为 JSON" }] } };
  }

  const entities = parsed.entities.map(normEntity).filter((e): e is RawEntity => e !== null);
  const relations = parsed.relations.map(normRelation).filter((r): r is RawRelation => r !== null);
  const logicRules = parsed.logicRules.map(normLogic).filter((l): l is RawLogicRule => l !== null);
  const actions = parsed.actions.map(normAction).filter((a): a is RawAction => a !== null);
  calibrate(entities, relations, logicRules, actions);

  // 质检：validateExtraction **就地去重** entities/relations，并校验 logic/action（P4+P7 七检查）
  const data: ValidatableData = { entities, relations, logicRules, actions };
  const vreport = validateExtraction(data, DOC_LINK_KINDS);
  const report: ExtractReport = { hasFatal: vreport.hasFatal, totalIssues: vreport.totalIssues, issues: vreport.issues };
  if (report.hasFatal) return { ...zero, report };
  const dedupEntities = data.entities as RawEntity[];
  const dedupRelations = data.relations as RawRelation[];

  // 落库：concept 对象（已存在则按 richness 取舍：新者更富则不再略过，仅当旧者已足够时跳过）
  const existing = listObjectTypes(ontologyId);
  const nameToId = new Map(existing.map((o) => [o.nameCn, o.id]));
  let createdObjects = 0, skippedObjects = 0;
  for (const e of dedupEntities) {
    if (nameToId.has(e.nameCn)) { skippedObjects++; continue; } // 已存在：保留库内（避免改他人数据），仅计 skip
    const obj = createObjectType(ontologyId, {
      kind: "concept", nameCn: e.nameCn, nameEn: e.nameEn,
      description: e.description ?? "", confidence: e.confidence ?? 0.85,
    });
    nameToId.set(e.nameCn, obj.id);
    createdObjects++;
  }

  // 落库：关系（按名模糊解析；端点缺失/自环则跳过；同批重复去重）
  const existingLinkKeys = new Set<string>();
  let createdLinks = 0, skippedLinks = 0;
  for (const r of dedupRelations) {
    const srcId = resolveId(r.source, nameToId);
    const tgtId = resolveId(r.target, nameToId);
    const kind: LinkKind = DOC_LINK_KINDS.includes(r.kind as LinkKind) ? (r.kind as LinkKind) : "related";
    if (!srcId || !tgtId || srcId === tgtId) { skippedLinks++; continue; }
    const key = `${srcId}|${tgtId}|${kind}`;
    if (existingLinkKeys.has(key)) { skippedLinks++; continue; }
    createLink(ontologyId, { sourceObjectId: srcId, targetObjectId: tgtId, kind, confidence: 0.8 });
    existingLinkKeys.add(key);
    createdLinks++;
  }

  // 落库：逻辑规则（linkedEntities 名称→对象 id，模糊解析；缺失端点剔除）
  const ruleNameToId = new Map(listLogicRules(ontologyId).map((l) => [l.nameCn, l.id]));
  let createdLogicRules = 0;
  for (const l of logicRules) {
    if (ruleNameToId.has(l.nameCn)) continue; // 同名已存在则跳过
    const linkedObjectIds = l.linkedEntities.map((n) => resolveId(n, nameToId)).filter((id): id is string => !!id);
    const rule = createLogicRule(ontologyId, {
      nameCn: l.nameCn, nameEn: l.nameEn, description: l.description ?? "",
      formula: l.formula ?? "", linkedObjectIds, confidence: l.confidence ?? 0.85,
    });
    ruleNameToId.set(l.nameCn, rule.id);
    createdLogicRules++;
  }

  // 落库：动作（linkedEntities→对象 id，linkedLogic→规则 id）
  let createdActions = 0;
  for (const a of actions) {
    const linkedObjectIds = a.linkedEntities.map((n) => resolveId(n, nameToId)).filter((id): id is string => !!id);
    const linkedLogicIds = a.linkedLogic.map((n) => resolveId(n, ruleNameToId)).filter((id): id is string => !!id);
    createOntoAction(ontologyId, {
      nameCn: a.nameCn, nameEn: a.nameEn, description: a.description ?? "",
      executionRule: a.executionRule ?? "", functionCode: a.functionCode ?? "",
      linkedObjectIds, linkedLogicIds, confidence: a.confidence ?? 0.85,
    });
    createdActions++;
  }

  return { createdObjects, createdLinks, createdLogicRules, createdActions, skippedObjects, skippedLinks, report };
}

/**
 * Async chunked extraction runner. Fire-and-forget: writes progress to extract_jobs table.
 * Each chunk calls extractOntologyFromText; processExtractionOutput handles cross-batch
 * merge/dedup/linking via resolveId + same-name dedup.
 */
export async function runChunkedExtraction(
  jobId: string,
  ontologyId: string,
  text: string,
  model?: string,
  promptTemplate?: string,
  fileName?: string,
): Promise<void> {
  try {
    const chunks = chunkDocument(text, fileName);
    updateExtractJob(jobId, { totalChunks: chunks.length });

    let totalCreatedObjects = 0, totalCreatedLinks = 0;
    let totalCreatedLogicRules = 0, totalCreatedActions = 0;
    let totalSkippedObjects = 0, totalSkippedLinks = 0;
    let allIssues: ValidationIssue[] = [];
    let hasFatal = false;
    let doneChunks = 0;
    let failedChunks = 0;

    for (const chunk of chunks) {
      // Check abort before each batch
      const current = getExtractJob(jobId);
      if (!current || current.status === "aborted") {
        return;
      }

      try {
        const result = await extractOntologyFromText(ontologyId, chunk, model, promptTemplate);
        totalCreatedObjects += result.createdObjects;
        totalCreatedLinks += result.createdLinks;
        totalCreatedLogicRules += result.createdLogicRules;
        totalCreatedActions += result.createdActions;
        totalSkippedObjects += result.skippedObjects;
        totalSkippedLinks += result.skippedLinks;
        if (result.report.hasFatal) hasFatal = true;
        allIssues = allIssues.concat(result.report.issues);
      } catch (e) {
        failedChunks++;
        allIssues.push({ severity: "error", code: "CHUNK_FAILED", message: `Chunk ${doneChunks + 1}/${chunks.length} failed: ${e instanceof Error ? e.message : String(e)}` });
      }

      doneChunks++;
      updateExtractJob(jobId, {
        doneChunks,
        createdObjects: totalCreatedObjects,
        createdLinks: totalCreatedLinks,
        createdLogicRules: totalCreatedLogicRules,
        createdActions: totalCreatedActions,
        skippedObjects: totalSkippedObjects,
        skippedLinks: totalSkippedLinks,
        hasFatal,
        issues: allIssues,
      });
    }

    const finalStatus = failedChunks === chunks.length ? "failed" : "success";
    updateExtractJob(jobId, {
      status: finalStatus,
      ...(failedChunks === chunks.length ? { error: `All ${chunks.length} chunks failed` } : {}),
    });
  } catch (e) {
    updateExtractJob(jobId, {
      status: "failed",
      error: e instanceof Error ? e.message : String(e),
    });
  }
}
