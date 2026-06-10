import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, extname, basename } from "node:path";
import {
  listRuleMemories,
  listAnalysisStandards,
  listBusinessContexts,
  listFlows,
  listFlowRuns,
  upsertKgNode,
  listKgNodes,
  listKgEdges,
  clearKgAutoEdges,
  insertKgEdges,
  setKgNodeAiExtractedHash,
  deleteKgNodesByType,
} from "./db.ts";
import type { KgEdgeInput, KgNodeInput } from "./db.ts";
import { listMetrics } from "./db/viz.ts";
import { runPiPrompt } from "./pi-adapter.ts";
import { DIRECT_LLM_ROOT } from "./config.ts";
import type { KgEdge, KgExtractResult, KgNode, KgRelation, KgSyncResult } from "./types.ts";

function hashContent(text: string): string {
  return createHash("sha256").update(text).digest("hex").slice(0, 16);
}

const STOPWORDS = new Set([
  "的", "了", "在", "是", "和", "与", "或", "也", "都", "不", "有", "对", "及",
  "将", "已", "为", "以", "从", "该", "其", "则", "时", "下", "上", "中", "内",
  "by", "the", "a", "an", "in", "of", "to", "for", "is", "are", "was", "be",
  "this", "that", "it", "at", "as", "with", "on", "from", "or", "and", "not",
]);

function extractWords(text: string): Set<string> {
  return new Set(
    text
      .replace(/[，。；：！？,.;:!?""''「」【】（）()\-_\n\r\t]/g, " ")
      .split(/\s+/)
      .map((w) => w.trim().toLowerCase())
      .filter((w) => w.length >= 2 && !STOPWORDS.has(w)),
  );
}

function sharedWordCount(a: Set<string>, b: Set<string>): number {
  let count = 0;
  for (const w of a) if (b.has(w)) count++;
  return count;
}

function scanMarkdownFiles(dir: string, maxFiles = 30): Array<{ path: string; title: string; summary: string; hash: string }> {
  const results: Array<{ path: string; title: string; summary: string; hash: string }> = [];
  try {
    const entries = readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (results.length >= maxFiles) break;
      if (entry.isFile() && extname(entry.name).toLowerCase() === ".md") {
        try {
          const fullPath = join(dir, entry.name);
          const content = readFileSync(fullPath, "utf-8");
          const title = basename(entry.name, ".md").replace(/[-_]/g, " ").slice(0, 80);
          const summary = content.slice(0, 500).replace(/#+\s*/g, "").replace(/\n+/g, " ").trim();
          results.push({ path: fullPath, title, summary, hash: hashContent(content.slice(0, 2000)) });
        } catch {
          // skip unreadable file
        }
      }
    }
  } catch {
    // skip inaccessible directory
  }
  return results;
}

export function syncKnowledgeGraph(workspaceId: string): KgSyncResult {
  // ---- 1. Ingest structured sources ----
  const rules = listRuleMemories(workspaceId);
  for (const rule of rules) {
    upsertKgNode({
      workspaceId,
      type: "rule",
      sourceKey: `rule:${rule.id}`,
      title: rule.title,
      summary: rule.evidence.slice(0, 400),
      tags: [rule.severity, rule.scope].filter(Boolean),
      contentHash: hashContent(rule.title + rule.evidence),
    });
  }

  // 参照标准文件仍来自 analysis_standards；metric 真源已切到 metric_definitions（P2b'）
  const refFiles = listAnalysisStandards(workspaceId).filter((s) => s.kind === "reference_file");
  for (const std of refFiles) {
    upsertKgNode({
      workspaceId,
      type: "ref_file",
      sourceKey: `standard:${std.id}`,
      title: std.name,
      summary: [std.description, std.category].filter(Boolean).join(" — ").slice(0, 400),
      tags: [std.category].filter(Boolean),
      contentHash: hashContent(std.name + std.description),
    });
  }

  // metric 节点来自 metric_definitions；先清旧 metric 节点(含迁移前 standard: 来源的 ghost)
  deleteKgNodesByType(workspaceId, "metric");
  const metrics = listMetrics(workspaceId);
  for (const m of metrics) {
    upsertKgNode({
      workspaceId,
      type: "metric",
      sourceKey: `metric:${m.id}`,
      title: m.name,
      summary: [m.description, m.category, m.formula, m.caliber].filter(Boolean).join(" — ").slice(0, 400),
      tags: [m.category].filter(Boolean),
      contentHash: hashContent(m.name + m.description),
    });
  }

  const bizContexts = listBusinessContexts(workspaceId);
  for (const ctx of bizContexts) {
    upsertKgNode({
      workspaceId,
      type: "biz_ctx",
      sourceKey: `biz_ctx:${ctx.id}`,
      title: ctx.title,
      summary: ctx.content.slice(0, 400),
      tags: [ctx.category],
      contentHash: hashContent(ctx.title + ctx.content),
    });
  }

  // ---- 2. Ingest markdown reports from flow runs ----
  const flows = listFlows(workspaceId);
  for (const flow of flows) {
    const runs = listFlowRuns(flow.id).slice(0, 5); // 5 most recent runs per flow
    for (const run of runs) {
      const files = scanMarkdownFiles(run.outputDir);
      for (const file of files) {
        upsertKgNode({
          workspaceId,
          type: "report",
          sourceKey: `report:${file.path}`,
          title: file.title,
          summary: file.summary,
          tags: [flow.name].filter(Boolean),
          contentHash: file.hash,
        });
      }
    }
  }

  // ---- 3. Rebuild auto edges ----
  clearKgAutoEdges(workspaceId);
  const nodes = listKgNodes(workspaceId);
  const edges = inferEdges(nodes, workspaceId);
  if (edges.length > 0) insertKgEdges(edges);

  return {
    nodeCount: nodes.length,
    edgeCount: edges.length,
    syncedAt: Date.now(),
  };
}

const RELATION_ZH: Record<KgRelation, string> = {
  related_to: "相关",
  references: "引用",
  supports: "支撑",
  derived_from: "衍生自",
};

/**
 * Build the <xanthil-knowledge-graph> prompt block.
 * Injects: recent report summaries + strong cross-type edges.
 * Rules/standards/biz_ctx themselves are already injected by their own builders.
 */
export function buildKgPrompt(workspaceId: string): { prompt: string; reportCount: number; edgeCount: number; updatedAt: number | null } {
  const nodes = listKgNodes(workspaceId);
  const edges = listKgEdges(workspaceId);

  if (nodes.length === 0) return { prompt: "", reportCount: 0, edgeCount: 0, updatedAt: null };

  const nodeMap = new Map(nodes.map((n) => [n.id, n]));

  // Report nodes: up to 10 most recent
  const reports = nodes
    .filter((n) => n.type === "report")
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, 10);

  // Strong edges: references + supports, weight >= 1.0, up to 30
  const strongEdges = edges
    .filter((e): e is KgEdge => (e.relation === "references" || e.relation === "supports") && e.weight >= 1.0)
    .sort((a, b) => b.weight - a.weight)
    .slice(0, 30);

  if (reports.length === 0 && strongEdges.length === 0) {
    return { prompt: "", reportCount: 0, edgeCount: 0, updatedAt: null };
  }

  const lines: string[] = ["<xanthil-knowledge-graph>", "以下是知识图谱摘要，供你了解各类知识之间的关联："];

  if (reports.length > 0) {
    lines.push("", "[近期分析报告]");
    for (const r of reports) {
      const tag = r.tags[0] ? `（${r.tags[0]}）` : "";
      const summary = r.summary ? `：${r.summary.slice(0, 150).replace(/\n/g, " ")}` : "";
      lines.push(`- 「${r.title}」${tag}${summary}`);
    }
  }

  if (strongEdges.length > 0) {
    lines.push("", "[知识关联]");
    for (const e of strongEdges) {
      const from = nodeMap.get(e.fromId);
      const to = nodeMap.get(e.toId);
      if (!from || !to) continue;
      lines.push(`- 「${from.title}」${RELATION_ZH[e.relation]}「${to.title}」`);
    }
  }

  lines.push("</xanthil-knowledge-graph>");

  const updatedAt = nodes.length > 0 ? Math.max(...nodes.map((n) => n.updatedAt)) : null;

  return {
    prompt: lines.join("\n"),
    reportCount: reports.length,
    edgeCount: strongEdges.length,
    updatedAt,
  };
}

function inferEdges(nodes: KgNode[], workspaceId: string): KgEdgeInput[] {
  const edges: KgEdgeInput[] = [];
  const seen = new Set<string>();

  const wordSets = new Map(nodes.map((n) => [n.id, extractWords(`${n.title} ${n.summary}`)]));

  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      const a = nodes[i];
      const b = nodes[j];
      if (!a || !b) continue;
      const wa = wordSets.get(a.id)!;
      const wb = wordSets.get(b.id)!;
      if (!wa || !wb) continue;
      const shared = sharedWordCount(wa, wb);

      if (shared < 2) continue;

      const edgeKey = (f: string, t: string, r: string) => `${f}→${t}:${r}`;
      let fromId = a.id;
      let toId = b.id;
      let relation: KgRelation = "related_to";
      let weight = Math.min(0.5 + shared * 0.15, 2.0);

      // rule → metric/ref_file: references
      if (a.type === "rule" && (b.type === "metric" || b.type === "ref_file") && (a.title + a.summary).toLowerCase().includes(b.title.toLowerCase())) {
        relation = "references";
        weight = 1.5;
      } else if (b.type === "rule" && (a.type === "metric" || a.type === "ref_file") && (b.title + b.summary).toLowerCase().includes(a.title.toLowerCase())) {
        fromId = b.id;
        toId = a.id;
        relation = "references";
        weight = 1.5;
      }
      // biz_ctx → rule: supports
      else if (a.type === "biz_ctx" && b.type === "rule") {
        relation = "supports";
        weight = 1.0;
      } else if (b.type === "biz_ctx" && a.type === "rule") {
        fromId = b.id;
        toId = a.id;
        relation = "supports";
        weight = 1.0;
      }
      // report → any: references
      else if (a.type === "report" && b.type !== "report" && a.summary.toLowerCase().includes(b.title.toLowerCase())) {
        relation = "references";
        weight = 1.2;
      } else if (b.type === "report" && a.type !== "report" && b.summary.toLowerCase().includes(a.title.toLowerCase())) {
        fromId = b.id;
        toId = a.id;
        relation = "references";
        weight = 1.2;
      }

      const key = edgeKey(fromId, toId, relation);
      if (!seen.has(key)) {
        seen.add(key);
        edges.push({ workspaceId, fromId, toId, relation, weight });
      }
    }
  }

  return edges;
}

// ---- Phase B: AI semantic extraction ----

const DEFAULT_EXTRACT_MODEL = "minimax-cn/MiniMax-M3";
const MAX_REPORTS_PER_RUN = 5;
const REPORT_CONTENT_LIMIT = 3000;

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

function conceptSourceKey(workspaceId: string, title: string): string {
  const slug = title.toLowerCase().replace(/\s+/g, "_").replace(/[^\w一-鿿]/g, "").slice(0, 50);
  return `concept:${workspaceId}:${slug}`;
}

export async function extractKgEntitiesFromReports(
  workspaceId: string,
  model = DEFAULT_EXTRACT_MODEL,
): Promise<KgExtractResult> {
  const allNodes = listKgNodes(workspaceId);
  const reportNodes = allNodes.filter((n) => n.type === "report");

  // Pass existing non-report node titles as context for the LLM
  const contextTitles = allNodes
    .filter((n) => n.type !== "report" && n.type !== "concept")
    .map((n) => `${n.title}（${n.type}）`)
    .slice(0, 30);

  // Separate already-extracted (unchanged) from reports needing processing
  const unprocessed = reportNodes.filter(
    (n) => !n.aiExtractedHash || n.aiExtractedHash !== n.contentHash,
  );
  const skippedReports = reportNodes.length - unprocessed.length;
  const reports = unprocessed.slice(0, MAX_REPORTS_PER_RUN);
  let newNodes = 0;
  let newEdges = 0;

  for (const reportNode of reports) {
    // sourceKey = "report:/abs/path/to/file.md"
    const filePath = reportNode.sourceKey.replace(/^report:/, "");
    if (!existsSync(filePath)) continue;

    let content = "";
    try {
      content = readFileSync(filePath, "utf-8").slice(0, REPORT_CONTENT_LIMIT);
    } catch {
      continue;
    }

    const contextBlock = contextTitles.length > 0
      ? `已有知识节点（可用于建立关联）：\n${contextTitles.map((t) => `- ${t}`).join("\n")}\n\n`
      : "";

    const prompt = `${contextBlock}报告标题：${reportNode.title}

报告内容：
${content}

请从上述报告中提取 3-5 个核心知识实体，以及它们与已有节点的关联。输出严格 JSON（不要 Markdown fence、不要注释）：
{
  "entities": [
    {"title": "实体名称（20字以内）", "type": "concept", "summary": "简短描述（100字以内）"}
  ],
  "relations": [
    {"from": "实体名称或已有节点名", "to": "实体名称或已有节点名", "relation": "references|supports|related_to|derived_from"}
  ]
}
限制：entities ≤ 5 条，relations ≤ 8 条，只提取报告中明确出现的内容。`;

    let output = "";
    try {
      output = await runPiPrompt({
        workspaceRoot: DIRECT_LLM_ROOT,
        text: prompt,
        model,
        systemPrompt: "你是知识图谱构建助手，只输出严格 JSON，不包含 Markdown fence 和注释。",
        timeoutMs: 60_000,
      });
    } catch {
      continue;
    }

    const parsed = parseExtractJson(output);
    if (!parsed) continue;

    // Build title → node id map for existing nodes
    const titleToId = new Map(allNodes.map((n) => [n.title.toLowerCase(), n.id]));

    // Upsert concept nodes
    const newConceptIds = new Map<string, string>(); // title.lower → id
    for (const raw of parsed.entities) {
      if (typeof raw !== "object" || raw === null) continue;
      const e = raw as Record<string, unknown>;
      const title = typeof e.title === "string" ? e.title.trim().slice(0, 80) : "";
      const summary = typeof e.summary === "string" ? e.summary.trim().slice(0, 200) : "";
      if (!title) continue;

      const sourceKey = conceptSourceKey(workspaceId, title);
      const existing = allNodes.find((n) => n.sourceKey === sourceKey);
      const node = upsertKgNode({
        workspaceId,
        type: "concept",
        sourceKey,
        title,
        summary,
        tags: [reportNode.title].filter(Boolean),
        contentHash: hashContent(title + summary),
      });
      newConceptIds.set(title.toLowerCase(), node.id);
      if (!existing) newNodes++;
    }

    // Insert edges
    const VALID_RELATIONS = new Set(["related_to", "references", "supports", "derived_from"]);
    const edgesToInsert: KgEdgeInput[] = [];
    const edgeSeen = new Set<string>();

    // report → concept edges
    for (const [, conceptId] of newConceptIds) {
      const key = `${reportNode.id}→${conceptId}:references`;
      if (!edgeSeen.has(key)) {
        edgeSeen.add(key);
        edgesToInsert.push({ workspaceId, fromId: reportNode.id, toId: conceptId, relation: "references", weight: 1.2 });
      }
    }

    // extracted concept→concept and concept→existing edges
    for (const raw of parsed.relations) {
      if (typeof raw !== "object" || raw === null) continue;
      const r = raw as Record<string, unknown>;
      const fromTitle = typeof r.from === "string" ? r.from.trim().toLowerCase() : "";
      const toTitle = typeof r.to === "string" ? r.to.trim().toLowerCase() : "";
      const relation = typeof r.relation === "string" && VALID_RELATIONS.has(r.relation) ? r.relation as KgRelation : "related_to";
      if (!fromTitle || !toTitle || fromTitle === toTitle) continue;

      const fromId = newConceptIds.get(fromTitle) ?? titleToId.get(fromTitle);
      const toId = newConceptIds.get(toTitle) ?? titleToId.get(toTitle);
      if (!fromId || !toId) continue;

      const key = `${fromId}→${toId}:${relation}`;
      if (!edgeSeen.has(key)) {
        edgeSeen.add(key);
        edgesToInsert.push({ workspaceId, fromId, toId, relation, weight: 1.0 });
      }
    }

    if (edgesToInsert.length > 0) {
      const before = listKgEdges(workspaceId).length;
      insertKgEdges(edgesToInsert);
      newEdges += listKgEdges(workspaceId).length - before;
    }

    if (reportNode.contentHash) {
      setKgNodeAiExtractedHash(reportNode.id, reportNode.contentHash);
    }
  }

  return { newNodes, newEdges, processedReports: reports.length, skippedReports, extractedAt: Date.now() };
}
