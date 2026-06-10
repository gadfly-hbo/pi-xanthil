import { runPiPrompt } from "./pi-adapter.ts";
import { DIRECT_LLM_ROOT } from "./config.ts";
import { createObjectType, createLink, listObjectTypes } from "./db/viz.ts";
import type { LinkKind } from "./types.ts";

/**
 * onto-xanthil 文档抽取（P3）。**经 pi CLI，不直接调模型**。
 * 借 nano-ontoprompt 工程精华（轻量版）：置信度客观校准 + 分级质检门禁 + 名称模糊解析。
 */

const DEFAULT_MODEL = "minimax-cn/MiniMax-M3";
const CONTENT_LIMIT = 6000;
const DOC_LINK_KINDS: LinkKind[] = ["is-a", "part-of", "related"]; // 文档抽取仅产语义关系，不产 join/fk

export type Severity = "fatal" | "error" | "warning" | "info";
export interface ValidationIssue { severity: Severity; code: string; message: string }
export interface ExtractReport {
  hasFatal: boolean;
  totalIssues: number;
  issues: ValidationIssue[];
}
export interface OntoExtractResult {
  createdObjects: number;
  createdLinks: number;
  skippedObjects: number;
  skippedLinks: number;
  report: ExtractReport;
}

interface RawEntity { nameCn: string; nameEn?: string; description?: string; confidence?: number }
interface RawRelation { source: string; target: string; kind?: string }

function parseExtractJson(text: string): { entities: unknown[]; relations: unknown[] } | null {
  try {
    const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
    const raw = fenced?.[1] ?? text;
    const start = raw.indexOf("{");
    const end = raw.lastIndexOf("}");
    if (start < 0 || end <= start) return null;
    const parsed = JSON.parse(raw.slice(start, end + 1)) as unknown;
    if (typeof parsed !== "object" || parsed === null) return null;
    const obj = parsed as Record<string, unknown>;
    return {
      entities: Array.isArray(obj.entities) ? obj.entities : [],
      relations: Array.isArray(obj.relations) ? obj.relations : [],
    };
  } catch {
    return null;
  }
}

function normEntity(raw: unknown): RawEntity | null {
  if (typeof raw !== "object" || raw === null) return null;
  const e = raw as Record<string, unknown>;
  const nameCn = typeof e.nameCn === "string" ? e.nameCn.trim()
    : typeof e.name === "string" ? e.name.trim() : "";
  if (!nameCn) return null;
  return {
    nameCn: nameCn.slice(0, 80),
    nameEn: typeof e.nameEn === "string" ? e.nameEn.trim().slice(0, 80) : undefined,
    description: typeof e.description === "string" ? e.description.trim().slice(0, 300) : undefined,
    confidence: typeof e.confidence === "number" ? e.confidence : undefined,
  };
}

function normRelation(raw: unknown): RawRelation | null {
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as Record<string, unknown>;
  const source = typeof r.source === "string" ? r.source.trim() : "";
  const target = typeof r.target === "string" ? r.target.trim() : "";
  if (!source || !target) return null;
  return { source, target, kind: typeof r.kind === "string" ? r.kind : undefined };
}

// ── 置信度客观校准（nano _calibrate_confidence 轻量版）──
function calibrate(entities: RawEntity[], relations: RawRelation[]): RawEntity[] {
  const inGraph = new Set<string>();
  for (const r of relations) { inGraph.add(r.source); inGraph.add(r.target); }
  return entities.map((e) => {
    let conf = e.confidence ?? 0.85;
    if (!e.description) conf -= 0.05;
    if (inGraph.has(e.nameCn)) conf += 0.05;
    return { ...e, confidence: Math.round(Math.max(0.3, Math.min(0.98, conf)) * 1000) / 1000 };
  });
}

// ── 分级质检门禁（nano PostHarnessValidator 轻量版）──
function validate(entities: RawEntity[], relations: RawRelation[]): ExtractReport {
  const issues: ValidationIssue[] = [];
  if (entities.length === 0) {
    issues.push({ severity: "fatal", code: "EMPTY_ENTITIES", message: "未抽取到任何实体，请检查文档内容或模型" });
  }
  const names = new Set(entities.map((e) => e.nameCn));
  for (const r of relations) {
    const srcOk = names.has(r.source) || [...names].some((n) => n.includes(r.source) || r.source.includes(n));
    const tgtOk = names.has(r.target) || [...names].some((n) => n.includes(r.target) || r.target.includes(n));
    if (!srcOk || !tgtOk) {
      issues.push({ severity: "warning", code: "DANGLING_RELATION", message: `关系「${r.source}→${r.target}」端点未匹配到实体，已跳过` });
    }
  }
  return { hasFatal: issues.some((i) => i.severity === "fatal"), totalIssues: issues.length, issues };
}

// 名称模糊解析到对象 id（nano _fuzzy_resolve_entity 轻量版）
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

function buildPrompt(text: string): string {
  return `请从以下文档中抽取领域本体的「实体」与「关系」。

文档内容：
${text.slice(0, CONTENT_LIMIT)}

输出严格 JSON（不要 Markdown fence、不要注释）：
{
  "entities": [
    {"nameCn": "实体中文名（20字内）", "nameEn": "英文名(可选)", "description": "简短描述(100字内)", "confidence": 0.9}
  ],
  "relations": [
    {"source": "实体名", "target": "实体名", "kind": "is-a|part-of|related"}
  ]
}
要求：① 实体取文档中明确出现的核心概念，≤ 15 个；② 关系 source/target 必须是 entities 里的 nameCn；③ kind 只用 is-a/part-of/related；④ 关系 ≤ 25 条。`;
}

export async function extractOntologyFromText(
  ontologyId: string,
  text: string,
  model = DEFAULT_MODEL,
): Promise<OntoExtractResult> {
  const output = await runPiPrompt({
    workspaceRoot: DIRECT_LLM_ROOT,
    text: buildPrompt(text),
    model,
    systemPrompt: "你是本体抽取助手，只输出严格 JSON，不包含 Markdown fence 和注释。",
    timeoutMs: 90_000,
  });

  const parsed = parseExtractJson(output);
  if (!parsed) {
    return {
      createdObjects: 0, createdLinks: 0, skippedObjects: 0, skippedLinks: 0,
      report: { hasFatal: true, totalIssues: 1, issues: [{ severity: "fatal", code: "PARSE_FAILED", message: "模型输出无法解析为 JSON" }] },
    };
  }

  const entities = parsed.entities.map(normEntity).filter((e): e is RawEntity => e !== null);
  const relations = parsed.relations.map(normRelation).filter((r): r is RawRelation => r !== null);
  const calibrated = calibrate(entities, relations);
  const report = validate(calibrated, relations);

  if (report.hasFatal) {
    return { createdObjects: 0, createdLinks: 0, skippedObjects: 0, skippedLinks: 0, report };
  }

  // 落库：concept 对象（按名去重，已存在则跳过）
  const existing = listObjectTypes(ontologyId);
  const nameToId = new Map(existing.map((o) => [o.nameCn, o.id]));
  let createdObjects = 0, skippedObjects = 0;
  for (const e of calibrated) {
    if (nameToId.has(e.nameCn)) { skippedObjects++; continue; }
    const obj = createObjectType(ontologyId, {
      kind: "concept", nameCn: e.nameCn, nameEn: e.nameEn,
      description: e.description ?? "", confidence: e.confidence ?? 0.85,
    });
    nameToId.set(e.nameCn, obj.id);
    createdObjects++;
  }

  // 落库：关系（按名模糊解析；端点缺失则跳过；同源目标类型去重）
  const existingLinkKeys = new Set<string>();
  let createdLinks = 0, skippedLinks = 0;
  for (const r of relations) {
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

  return { createdObjects, createdLinks, skippedObjects, skippedLinks, report };
}
