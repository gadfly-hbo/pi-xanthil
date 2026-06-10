import { Router } from "express";
import { readFileSync } from "node:fs";
import {
  listDashboards,
  createDashboard,
  updateDashboard,
  deleteDashboard,
  listOntologies,
  createOntology,
  updateOntology,
  deleteOntology,
  getOntology,
  listObjectTypes,
  getObjectType,
  createObjectType,
  updateObjectType,
  deleteObjectType,
  createProperty,
  listProperties,
  updateProperty,
  deleteProperty,
  createLink,
  listLinks,
  deleteLink,
  listMetrics,
  createMetric,
  updateMetric,
  deleteMetric,
  backfillMetricsFromStandards,
} from "../db/viz.ts";
import { getWorkspacePath } from "../db.ts";
import { parseAggregationBuffer } from "../bi-dataset-parser.ts";
import { extractOntologyFromText } from "../onto-extract.ts";
import type { GraphNode, GraphEdge, OntologyGraph, PropertyDataType, ObjectKind, LinkKind } from "../types.ts";

/**
 * 【Agent-V · 可视交付域】HTTP 路由 slot —— owner: antigravity(Gemini)
 *
 * 覆盖：看板 / 图表 / 报告交付 / 知识图谱·trace 看板。
 *   /api/reports* · /api/report-review* · /api/golden-strategy* · /api/html-reports*
 *   /api/toc* · /api/decision-tree* · /api/report-versions* · /api/kg* · /api/dashboards*(画布,待建) …
 *
 * 约定：
 *   - 新路由写在本文件：`vizRouter.post("/api/dashboards", (req, res) => { ... })`
 *   - 复用报告工具：`import { ... } from "../reports.ts" | "../html-report.ts" | "../report-review.ts"`
 *   - 报告内容(md/html 原文) 不发送给任何 LLM（与 AGENTS.md 探索红线策略一致）
 *
 * 禁止：触碰 index.ts（legacy 冻结，归总控）/ 他域 router。
 */
export const vizRouter = Router();

// GET /api/dashboards?workspaceId=xxx
vizRouter.get("/api/dashboards", (req, res) => {
  const workspaceId = req.query.workspaceId as string;
  if (!workspaceId) {
    res.status(400).json({ error: "Missing workspaceId" });
    return;
  }
  try {
    const list = listDashboards(workspaceId);
    res.json(list);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// POST /api/dashboards
vizRouter.post("/api/dashboards", (req, res) => {
  const { workspaceId, name, layoutJson } = req.body;
  if (!workspaceId || !name) {
    res.status(400).json({ error: "Missing workspaceId or name" });
    return;
  }
  try {
    const created = createDashboard(workspaceId, name, layoutJson || "[]");
    res.json(created);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// PUT /api/dashboards/:id
vizRouter.put("/api/dashboards/:id", (req, res) => {
  const { id } = req.params;
  const { name, layoutJson } = req.body;
  try {
    const updated = updateDashboard(id, name, layoutJson);
    if (!updated) {
      res.status(404).json({ error: "Dashboard not found" });
      return;
    }
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// DELETE /api/dashboards/:id
vizRouter.delete("/api/dashboards/:id", (req, res) => {
  const { id } = req.params;
  try {
    const deleted = deleteDashboard(id);
    if (!deleted) {
      res.status(404).json({ error: "Dashboard not found" });
      return;
    }
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});


// ============================================================================
// onto-xanthil 路由（详见 docs/onto-xanthil-design.md）
// ============================================================================

function inferDataType(values: Array<string | number | boolean | null>): PropertyDataType {
  const sample = values.filter((v) => v !== null && v !== "").slice(0, 50);
  if (sample.length === 0) return "unknown";
  let num = 0, bool = 0, date = 0;
  for (const v of sample) {
    if (typeof v === "boolean") { bool++; continue; }
    if (typeof v === "number") { num++; continue; }
    const s = String(v).trim();
    if (s === "true" || s === "false") { bool++; continue; }
    if (!Number.isNaN(Number(s))) { num++; continue; }
    if (!Number.isNaN(Date.parse(s)) && /\d{4}[-/]\d{1,2}/.test(s)) { date++; continue; }
  }
  const n = sample.length;
  if (num / n >= 0.8) return "number";
  if (bool / n >= 0.8) return "boolean";
  if (date / n >= 0.8) return "date";
  return "string";
}

// ---- Ontology ----
vizRouter.get("/api/workspaces/:id/ontologies", (req, res) => {
  try { res.json(listOntologies(req.params.id)); }
  catch (err) { res.status(500).json({ error: String(err) }); }
});

vizRouter.post("/api/workspaces/:id/ontologies", (req, res) => {
  const { name, domain, version } = req.body ?? {};
  if (!name) { res.status(400).json({ error: "name required" }); return; }
  try { res.json(createOntology(req.params.id, String(name), domain ?? "", version ?? "v0.1")); }
  catch (err) { res.status(500).json({ error: String(err) }); }
});

vizRouter.patch("/api/ontologies/:oid", (req, res) => {
  try {
    const updated = updateOntology(req.params.oid, req.body ?? {});
    if (!updated) { res.status(404).json({ error: "ontology not found" }); return; }
    res.json(updated);
  } catch (err) { res.status(500).json({ error: String(err) }); }
});

vizRouter.delete("/api/ontologies/:oid", (req, res) => {
  try {
    if (!deleteOntology(req.params.oid)) { res.status(404).json({ error: "ontology not found" }); return; }
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: String(err) }); }
});

// ---- ObjectType ----
vizRouter.get("/api/ontologies/:oid/objects", (req, res) => {
  try {
    const kind = req.query.kind ? (String(req.query.kind) as ObjectKind) : undefined;
    res.json(listObjectTypes(req.params.oid, kind));
  } catch (err) { res.status(500).json({ error: String(err) }); }
});

vizRouter.post("/api/ontologies/:oid/objects", (req, res) => {
  const b = req.body ?? {};
  if (!b.nameCn || !b.kind) { res.status(400).json({ error: "nameCn and kind required" }); return; }
  try {
    res.json(createObjectType(req.params.oid, {
      kind: b.kind, nameCn: String(b.nameCn), nameEn: b.nameEn,
      description: b.description, boundPathId: b.boundPathId, confidence: b.confidence,
    }));
  } catch (err) { res.status(500).json({ error: String(err) }); }
});

// 一键从 clean_data 聚合集生成 dataset-object + 每列 property（零 LLM）
vizRouter.post("/api/ontologies/:oid/objects/from-aggregation", (req, res) => {
  const { boundPathId, nameCn } = req.body ?? {};
  if (!boundPathId) { res.status(400).json({ error: "boundPathId required" }); return; }
  try {
    const entry = getWorkspacePath(Number(boundPathId));
    if (!entry) { res.status(404).json({ error: "path not found" }); return; }
    if (entry.folder === "draw_data") { res.status(403).json({ error: "draw_data forbidden" }); return; }
    if (entry.folder !== "clean_data") { res.status(400).json({ error: "only clean_data supported" }); return; }
    const buf = readFileSync(entry.path);
    const { columns, rows } = parseAggregationBuffer(buf, entry.path);
    if (columns.length === 0) { res.status(400).json({ error: "no columns parsed" }); return; }

    const obj = createObjectType(req.params.oid, {
      kind: "dataset",
      nameCn: String(nameCn || entry.path.split("/").pop() || "dataset"),
      description: "",
      boundPathId: String(boundPathId),
      confidence: 1.0,
    });
    const properties = columns.map((col) =>
      createProperty(obj.id, {
        name: col,
        dataType: inferDataType(rows.map((r) => (r as Record<string, string | number | boolean | null>)[col] ?? null)),
        boundColumn: col,
      })
    );
    res.json({ object: obj, properties });
  } catch (err) { res.status(500).json({ error: String(err) }); }
});

vizRouter.patch("/api/objects/:objId", (req, res) => {
  try {
    const updated = updateObjectType(req.params.objId, req.body ?? {});
    if (!updated) { res.status(404).json({ error: "object not found" }); return; }
    res.json(updated);
  } catch (err) { res.status(500).json({ error: String(err) }); }
});

vizRouter.delete("/api/objects/:objId", (req, res) => {
  try {
    if (!deleteObjectType(req.params.objId)) { res.status(404).json({ error: "object not found" }); return; }
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: String(err) }); }
});

// ---- PropertyType ----
vizRouter.get("/api/objects/:objId/properties", (req, res) => {
  try { res.json(listProperties(req.params.objId)); }
  catch (err) { res.status(500).json({ error: String(err) }); }
});

vizRouter.post("/api/objects/:objId/properties", (req, res) => {
  const b = req.body ?? {};
  if (!b.name) { res.status(400).json({ error: "name required" }); return; }
  try { res.json(createProperty(req.params.objId, b)); }
  catch (err) { res.status(500).json({ error: String(err) }); }
});

vizRouter.patch("/api/properties/:propId", (req, res) => {
  try {
    const updated = updateProperty(req.params.propId, req.body ?? {});
    if (!updated) { res.status(404).json({ error: "property not found" }); return; }
    res.json(updated);
  } catch (err) { res.status(500).json({ error: String(err) }); }
});

vizRouter.delete("/api/properties/:propId", (req, res) => {
  try {
    if (!deleteProperty(req.params.propId)) { res.status(404).json({ error: "property not found" }); return; }
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: String(err) }); }
});

// ---- LinkType ----
vizRouter.get("/api/ontologies/:oid/links", (req, res) => {
  try { res.json(listLinks(req.params.oid)); }
  catch (err) { res.status(500).json({ error: String(err) }); }
});

vizRouter.post("/api/ontologies/:oid/links", (req, res) => {
  const b = req.body ?? {};
  if (!b.sourceObjectId || !b.targetObjectId || !b.kind) {
    res.status(400).json({ error: "sourceObjectId, targetObjectId, kind required" }); return;
  }
  try {
    res.json(createLink(req.params.oid, {
      sourceObjectId: String(b.sourceObjectId), targetObjectId: String(b.targetObjectId),
      kind: b.kind as LinkKind, joinKeys: b.joinKeys, confidence: b.confidence,
    }));
  } catch (err) { res.status(500).json({ error: String(err) }); }
});

vizRouter.delete("/api/links/:linkId", (req, res) => {
  try {
    if (!deleteLink(req.params.linkId)) { res.status(404).json({ error: "link not found" }); return; }
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: String(err) }); }
});

// ---- Graph 投影（喂 <GraphCanvas>）----
vizRouter.get("/api/ontologies/:oid/graph", (req, res) => {
  try {
    const oid = req.params.oid;
    if (!getOntology(oid)) { res.status(404).json({ error: "ontology not found" }); return; }
    const objects = listObjectTypes(oid);
    const links = listLinks(oid);
    const nodes: GraphNode[] = objects.map((o) => ({
      id: o.id,
      type: o.kind,
      title: o.nameCn,
      subtitle: o.nameEn,
      group: o.kind,
      meta: { boundPathId: o.boundPathId, confidence: o.confidence },
    }));
    const edges: GraphEdge[] = links.map((l) => ({
      id: l.id, from: l.sourceObjectId, to: l.targetObjectId, label: l.kind, kind: l.kind,
    }));
    const graph: OntologyGraph = { nodes, edges };
    res.json(graph);
  } catch (err) { res.status(500).json({ error: String(err) }); }
});

// ---- 文档导入 / pi LLM 抽取（P3）----
vizRouter.post("/api/ontologies/:oid/extract", async (req, res) => {
  const { text, model } = req.body ?? {};
  if (!text || typeof text !== "string" || !text.trim()) {
    res.status(400).json({ error: "text required" }); return;
  }
  if (!getOntology(req.params.oid)) { res.status(404).json({ error: "ontology not found" }); return; }
  try {
    const result = await extractOntologyFromText(req.params.oid, text, model || undefined);
    res.json(result);
  } catch (err) { res.status(500).json({ error: String(err) }); }
});

// ---- MetricDefinition（metric 真源）----
vizRouter.get("/api/workspaces/:id/metrics", (req, res) => {
  try { res.json(listMetrics(req.params.id)); }
  catch (err) { res.status(500).json({ error: String(err) }); }
});

vizRouter.post("/api/workspaces/:id/metrics", (req, res) => {
  const b = req.body ?? {};
  if (!b.name) { res.status(400).json({ error: "name required" }); return; }
  try {
    res.json(createMetric(req.params.id, {
      name: String(b.name), category: b.category ?? "", description: b.description ?? "",
      formula: b.formula ?? "", caliber: b.caliber ?? "", unit: b.unit ?? "",
      objectTypeId: b.objectTypeId, boundColumns: b.boundColumns,
    }));
  } catch (err) { res.status(500).json({ error: String(err) }); }
});

vizRouter.patch("/api/metrics/:metricId", (req, res) => {
  try {
    const updated = updateMetric(req.params.metricId, req.body ?? {});
    if (!updated) { res.status(404).json({ error: "metric not found" }); return; }
    res.json(updated);
  } catch (err) { res.status(500).json({ error: String(err) }); }
});

vizRouter.delete("/api/metrics/:metricId", (req, res) => {
  try {
    if (!deleteMetric(req.params.metricId)) { res.status(404).json({ error: "metric not found" }); return; }
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: String(err) }); }
});

// metric 真源收敛：从指标记忆(analysis_standards·metric)非破坏式 backfill
vizRouter.post("/api/workspaces/:id/metrics/backfill-from-standards", (req, res) => {
  try { res.json(backfillMetricsFromStandards(req.params.id)); }
  catch (err) { res.status(500).json({ error: String(err) }); }
});
