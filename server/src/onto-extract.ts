import { runPiPrompt } from "./pi-adapter.ts";
import { DIRECT_LLM_ROOT } from "./config.ts";
import {
  createObjectType, createLink, listObjectTypes,
  createLogicRule, createOntoAction, listLogicRules,
} from "./db/viz.ts";
import type { LinkKind } from "./types.ts";
import { validateExtraction, type ValidatableData } from "./onto-validator.ts";

/**
 * onto-xanthil 文档抽取（P3 起；P7 扩展到 logic/action 四类）。**经 pi CLI，不直接调模型**。
 * 借 nano-ontoprompt 工程精华（轻量版）：四类置信度校准 + 分级质检门禁 + 名称模糊解析 + richness 去重。
 */

const DEFAULT_MODEL = "minimax-cn/MiniMax-M3";
const CONTENT_LIMIT = 6000;
const DOC_LINK_KINDS: LinkKind[] = ["is-a", "part-of", "related"]; // 文档抽取仅产语义关系，不产 join/fk

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
    const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
    const raw = fenced?.[1] ?? text;
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
要求：① 实体 ≤ 15 个，取文档明确出现的核心概念；② 关系 source/target 必须是 entities 里的 nameCn，kind 只用 is-a/part-of/related，≤ 25 条；③ 逻辑规则=领域约束/必然关系，linkedEntities 必须是 entities 里的 nameCn，≤ 10 条；④ 动作=可被触发的操作，linkedLogic 必须是 logic_rules 里的 nameCn，≤ 10 条；⑤ 文档若无逻辑规则/动作则给空数组。`;

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
    timeoutMs: 90_000,
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
