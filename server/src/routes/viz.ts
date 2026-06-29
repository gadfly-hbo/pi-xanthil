import { Router } from "express";
import { readFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve, dirname, basename } from "node:path";
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
  listLogicRules,
  createLogicRule,
  updateLogicRule,
  deleteLogicRule,
  listOntoActions,
  createOntoAction,
  updateOntoAction,
  deleteOntoAction,
  listOntoPrompts,
  createOntoPrompt,
  updateOntoPrompt,
  deleteOntoPrompt,
  listActionItems,
  createActionItem,
  updateActionItem,
  deleteActionItem,
  listActionTasks,
  createActionTask,
  updateActionTask,
  createActionFeedback,
  getActionFeedback,
  createExtractJob,
  getExtractJob,
  updateExtractJob,
  insertHealthRun,
  updateHealthRun,
  listHealthRuns,
  insertHealthFindings,
  listHealthFindings,
  listFindingsByRun,
  insertOntologyGaps,
  listOntologyGaps,
  getMonitorConfig,
  upsertMonitorConfig,
  createTargetPlan,
  listTargetPlans,
  getTargetPlan,
  adoptTargetPlan,
  listMetricInjectionTraces,
  listBusinessContextInjectionTraces,
} from "../db/viz.ts";
import { getWorkspacePath, getWorkspace, addWorkspacePath } from "../db.ts";
import { parseAggregationBuffer } from "../bi-dataset-parser.ts";
import { extractOntologyFromText, runChunkedExtraction } from "../onto-extract.ts";
import { exportOntology, type ExportFormat } from "../onto-export.ts";
import { readFlowFile } from "../flow-fs.ts";
import { runPiPrompt } from "../pi-adapter.ts";
import { runHealthSuite, classifyAggregation, listHealthRules } from "../health-check-engine.ts";
import { renderMarkdownReportToHtml } from "../html-report.ts";
import type { GraphNode, GraphEdge, OntologyGraph, PropertyDataType, ObjectKind, LinkKind, HealthSuite, HealthFinding, OntologyGap, MonitorDatasetBinding, MonitorSourceRole, TargetCalculationInput, TargetCalculationResult, TargetPlan } from "../types.ts";

function validateArtifactPath(path: string, source: string): void {
  const segments = path.split(/[\\/]/).filter(Boolean);
  if (segments.some((segment) => segment.startsWith("."))) throw new Error("hidden artifact paths are not accessible");
  if (source === "当前工作目录 fallback" && segments[0] === "flows") throw new Error("internal workflow paths are not accessible");
}

const EXPORT_FORMATS: ExportFormat[] = ["json", "yaml", "csv", "html", "ttl"];

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
  const { text, model, promptTemplate } = req.body ?? {};
  if (!text || typeof text !== "string" || !text.trim()) {
    res.status(400).json({ error: "text required" }); return;
  }
  if (!getOntology(req.params.oid)) { res.status(404).json({ error: "ontology not found" }); return; }
  try {
    const result = await extractOntologyFromText(req.params.oid, text, model || undefined, typeof promptTemplate === "string" ? promptTemplate : undefined);
    res.json(result);
  } catch (err) { res.status(500).json({ error: String(err) }); }
});

// ---- 分批抽取（fire-and-forget，进度存 extract_jobs）----
vizRouter.post("/api/ontologies/:oid/extract-chunked", (req, res) => {
  const { text, model, promptTemplate, fileName } = req.body ?? {};
  if (!text || typeof text !== "string" || !text.trim()) {
    res.status(400).json({ error: "text required" }); return;
  }
  if (!getOntology(req.params.oid)) { res.status(404).json({ error: "ontology not found" }); return; }
  try {
    const job = createExtractJob(req.params.oid);
    // Fire-and-forget: don't await
    void runChunkedExtraction(job.id, req.params.oid, text, model || undefined, typeof promptTemplate === "string" ? promptTemplate : undefined, typeof fileName === "string" ? fileName : undefined);
    res.json({ jobId: job.id });
  } catch (err) { res.status(500).json({ error: String(err) }); }
});

vizRouter.get("/api/extract-jobs/:jobId", (req, res) => {
  try {
    const job = getExtractJob(req.params.jobId);
    if (!job) { res.status(404).json({ error: "job not found" }); return; }
    res.json(job);
  } catch (err) { res.status(500).json({ error: String(err) }); }
});

vizRouter.post("/api/extract-jobs/:jobId/abort", (req, res) => {
  try {
    const job = getExtractJob(req.params.jobId);
    if (!job) { res.status(404).json({ error: "job not found" }); return; }
    if (job.status === "running") {
      updateExtractJob(req.params.jobId, { status: "aborted" });
    }
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: String(err) }); }
});

// ---- OntoPrompt（抽取 prompt 管理，P8）----
vizRouter.get("/api/workspaces/:id/onto-prompts", (req, res) => {
  try { res.json(listOntoPrompts(req.params.id)); }
  catch (err) { res.status(500).json({ error: String(err) }); }
});

vizRouter.post("/api/workspaces/:id/onto-prompts", (req, res) => {
  const b = req.body ?? {};
  if (!b.name || typeof b.content !== "string") { res.status(400).json({ error: "name and content required" }); return; }
  try { res.json(createOntoPrompt(req.params.id, { name: String(b.name), content: b.content, version: b.version })); }
  catch (err) { res.status(500).json({ error: String(err) }); }
});

vizRouter.patch("/api/onto-prompts/:promptId", (req, res) => {
  try {
    const updated = updateOntoPrompt(req.params.promptId, req.body ?? {});
    if (!updated) { res.status(404).json({ error: "prompt not found" }); return; }
    res.json(updated);
  } catch (err) { res.status(500).json({ error: String(err) }); }
});

vizRouter.delete("/api/onto-prompts/:promptId", (req, res) => {
  try {
    if (!deleteOntoPrompt(req.params.promptId)) { res.status(404).json({ error: "prompt not found" }); return; }
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: String(err) }); }
});

// ---- 本体导出（P5：JSON/YAML/CSV/HTML/Turtle，纯字符串构建零依赖）----
vizRouter.get("/api/ontologies/:oid/export", (req, res) => {
  const format = String(req.query.format ?? "json") as ExportFormat;
  if (!EXPORT_FORMATS.includes(format)) { res.status(400).json({ error: `format must be one of ${EXPORT_FORMATS.join("/")}` }); return; }
  try {
    const artifact = exportOntology(req.params.oid, format);
    if (!artifact) { res.status(404).json({ error: "ontology not found" }); return; }
    res.setHeader("Content-Type", `${artifact.mime}; charset=utf-8`);
    res.setHeader("Content-Disposition", `attachment; filename="${encodeURIComponent(artifact.filename)}"`);
    res.send(artifact.content);
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
      displayName: b.displayName, aggregation: b.aggregation, periodGrain: b.periodGrain,
      filters: b.filters, denominator: b.denominator, version: b.version,
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

// E-OKH3：按工作区/指标查看注入引用痕迹
vizRouter.get("/api/workspaces/:id/metric-injection-traces", (req, res) => {
  try {
    const metricId = typeof req.query.metricId === "string" ? req.query.metricId : undefined;
    const targetKind = typeof req.query.targetKind === "string" ? req.query.targetKind : undefined;
    const targetId = typeof req.query.targetId === "string" ? req.query.targetId : undefined;
    const limit = typeof req.query.limit === "string" ? parseInt(req.query.limit, 10) || 50 : 50;
    res.json(listMetricInjectionTraces(req.params.id, { metricId, targetKind, targetId, limit }));
  } catch (err) { res.status(500).json({ error: String(err) }); }
});

// E-BC2：按工作区/业务环境查看注入引用痕迹
vizRouter.get("/api/workspaces/:id/business-context-injection-traces", (req, res) => {
  try {
    const businessContextId = typeof req.query.businessContextId === "string" ? req.query.businessContextId : undefined;
    const targetKind = typeof req.query.targetKind === "string" ? req.query.targetKind : undefined;
    const targetId = typeof req.query.targetId === "string" ? req.query.targetId : undefined;
    const limit = typeof req.query.limit === "string" ? parseInt(req.query.limit, 10) || 50 : 50;
    res.json(listBusinessContextInjectionTraces(req.params.id, { businessContextId, targetKind, targetId, limit }));
  } catch (err) { res.status(500).json({ error: String(err) }); }
});

// ---- LogicRule（本体形式化规则层，P6）----
vizRouter.get("/api/ontologies/:oid/logic-rules", (req, res) => {
  try {
    if (!getOntology(req.params.oid)) { res.status(404).json({ error: "ontology not found" }); return; }
    res.json(listLogicRules(req.params.oid));
  } catch (err) { res.status(500).json({ error: String(err) }); }
});

vizRouter.post("/api/ontologies/:oid/logic-rules", (req, res) => {
  const b = req.body ?? {};
  if (!b.nameCn) { res.status(400).json({ error: "nameCn required" }); return; }
  try {
    if (!getOntology(req.params.oid)) { res.status(404).json({ error: "ontology not found" }); return; }
    res.json(createLogicRule(req.params.oid, {
      nameCn: String(b.nameCn), nameEn: b.nameEn, description: b.description,
      formula: b.formula, linkedObjectIds: b.linkedObjectIds, confidence: b.confidence,
    }));
  } catch (err) { res.status(500).json({ error: String(err) }); }
});

vizRouter.patch("/api/logic-rules/:ruleId", (req, res) => {
  try {
    const updated = updateLogicRule(req.params.ruleId, req.body ?? {});
    if (!updated) { res.status(404).json({ error: "logic rule not found" }); return; }
    res.json(updated);
  } catch (err) { res.status(500).json({ error: String(err) }); }
});

vizRouter.delete("/api/logic-rules/:ruleId", (req, res) => {
  try {
    if (!deleteLogicRule(req.params.ruleId)) { res.status(404).json({ error: "logic rule not found" }); return; }
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: String(err) }); }
});

// ---- OntoAction（可执行动作层，P6）----
vizRouter.get("/api/ontologies/:oid/actions", (req, res) => {
  try {
    if (!getOntology(req.params.oid)) { res.status(404).json({ error: "ontology not found" }); return; }
    res.json(listOntoActions(req.params.oid));
  } catch (err) { res.status(500).json({ error: String(err) }); }
});

vizRouter.post("/api/ontologies/:oid/actions", (req, res) => {
  const b = req.body ?? {};
  if (!b.nameCn) { res.status(400).json({ error: "nameCn required" }); return; }
  try {
    if (!getOntology(req.params.oid)) { res.status(404).json({ error: "ontology not found" }); return; }
    res.json(createOntoAction(req.params.oid, {
      nameCn: String(b.nameCn), nameEn: b.nameEn, description: b.description,
      executionRule: b.executionRule, functionCode: b.functionCode,
      linkedObjectIds: b.linkedObjectIds, linkedLogicIds: b.linkedLogicIds, confidence: b.confidence,
    }));
  } catch (err) { res.status(500).json({ error: String(err) }); }
});

vizRouter.patch("/api/actions/:actionId", (req, res) => {
  try {
    const updated = updateOntoAction(req.params.actionId, req.body ?? {});
    if (!updated) { res.status(404).json({ error: "action not found" }); return; }
    res.json(updated);
  } catch (err) { res.status(500).json({ error: String(err) }); }
});

vizRouter.delete("/api/actions/:actionId", (req, res) => {
  try {
    if (!deleteOntoAction(req.params.actionId)) { res.status(404).json({ error: "action not found" }); return; }
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: String(err) }); }
});

// ============================================================================
// Actions（行动闭环）
// ============================================================================

vizRouter.post("/api/actions/extract", async (req, res) => {
  const { prompt, model } = req.body ?? {};
  const pathId = Number(req.body?.pathId);
  const relPath = String(req.body?.relPath ?? "");
  if (!Number.isFinite(pathId)) { res.status(400).json({ error: "pathId required" }); return; }

  // Unified data source: read from the registered「报告输出」path (same as 黄金策/汇报版本/报告审核).
  let reportContent = "";
  let workspaceRoot = "";
  try {
    const entry = getWorkspacePath(pathId);
    if (!entry) { res.status(404).json({ error: "path not found" }); return; }
    if (entry.folder !== "report") { res.status(400).json({ error: "only report output paths supported" }); return; }
    const workspace = getWorkspace(entry.workspaceId);
    if (!workspace) { res.status(404).json({ error: "workspace not found" }); return; }
    workspaceRoot = workspace.rootPath;
    const outputDir = entry.kind === "dir" ? resolve(entry.path) : dirname(resolve(entry.path));
    const sourceRelPath = entry.kind === "dir" ? relPath : basename(entry.path);
    if (entry.kind === "dir" && !sourceRelPath) { res.status(400).json({ error: "relPath required for directory report paths" }); return; }
    if (entry.kind === "file" && relPath) { res.status(400).json({ error: "file report paths do not accept relPath" }); return; }
    validateArtifactPath(sourceRelPath, "报告 tab 登记路径");
    reportContent = readFlowFile(outputDir, sourceRelPath).content;
  } catch (err) {
    res.status(500).json({ error: `failed to read report: ${String(err)}` });
    return;
  }

  const systemPrompt = `你是一个专业的商业行动方案提取引擎。你的任务是从分析报告中提取出具体的、可执行的行动项（Action Items）。
提取的行动项必须严格遵循以下 JSON 格式返回，不可包含其他任何内容（不要使用 markdown code block）：
[
  {
    "title": "行动项标题",
    "rationale": "提出该行动的报告依据或洞察",
    "scene": "单店运营场景，必须严格取以下之一；判断不出则省略此字段：开业 / 日常 / 假日 / 大促",
    "lifecycle": "会员运营阶段，必须严格取以下之一；判断不出则省略此字段：A获取 / A激活 / R培育 / R复购 / R裂变",
    "expectedImpact": "预期效果（如：提升转化率 5%）",
    "priority": "high / medium / low",
    "effort": "high / medium / low",
    "confidence": 0.0到1.0的置信度浮点数
  }
]
如果报告中没有明确的行动项，请返回空数组 []。`;

  const userPrompt = `报告内容：\n${reportContent.slice(0, 16000)}\n\n附加提示：${prompt || "无"}\n\n请输出行动项 JSON 数组。`;

  try {
    const outText = await runPiPrompt({
      workspaceRoot: workspaceRoot || process.cwd(),
      text: userPrompt,
      systemPrompt,
      model: model || "minimax-cn/MiniMax-M3",
    });

    let drafts = [];
    try {
      // Handle possible markdown code blocks around the JSON
      const jsonStr = outText.replace(/^```json\s*/i, "").replace(/\s*```$/i, "").trim();
      drafts = JSON.parse(jsonStr);
      if (!Array.isArray(drafts)) throw new Error("Result is not an array");
    } catch (parseErr) {
      // 容错兜底：当 JSON 解析失败时尝试用正则或返回占位
      console.error("Failed to parse JSON from LLM", parseErr);
      drafts = [{
        title: "解析失败的行动项",
        rationale: "模型输出了非法的 JSON 格式内容",
        expectedImpact: "待补充",
        priority: "medium",
        effort: "medium",
        confidence: 0.5
      }];
    }
    // 归一化 scene/lifecycle 到契约 enum（ActionScene/ActionLifecycle）；非法/缺失 → 省略
    const SCENES = ["开业", "日常", "假日", "大促"];
    const LIFECYCLES = ["A获取", "A激活", "R培育", "R复购", "R裂变"];
    drafts = (Array.isArray(drafts) ? drafts : []).map((d: Record<string, unknown>) => ({
      ...d,
      scene: SCENES.includes(d?.scene as string) ? d.scene : undefined,
      lifecycle: LIFECYCLES.includes(d?.lifecycle as string) ? d.lifecycle : undefined,
    }));
    res.json(drafts);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// 行动项
vizRouter.get("/api/action-items", (req, res) => {
  const scopeId = req.query.scope as string;
  const reportPath = req.query.reportPath as string | undefined;
  if (!scopeId) { res.status(400).json({ error: "scope required" }); return; }
  try {
    res.json(listActionItems(scopeId, reportPath));
  } catch (err) { res.status(500).json({ error: String(err) }); }
});

vizRouter.post("/api/action-items", (req, res) => {
  const b = req.body ?? {};
  try {
    const status = ["suggested", "adopted", "dismissed"].includes(String(b.status)) ? b.status : "suggested";
    res.json(createActionItem({
      sourceKind: b.sourceKind,
      scopeId: b.scopeId,
      runId: b.runId,
      reportPath: b.reportPath,
      title: b.title,
      rationale: b.rationale,
      scene: b.scene,
      lifecycle: b.lifecycle,
      expectedImpact: b.expectedImpact,
      metricRef: b.metricRef,
      priority: b.priority,
      effort: b.effort,
      confidence: b.confidence,
      status,
    }));
  } catch (err) { res.status(500).json({ error: String(err) }); }
});

vizRouter.patch("/api/action-items/:id", (req, res) => {
  try {
    const updated = updateActionItem(req.params.id, req.body ?? {});
    if (!updated) { res.status(404).json({ error: "action item not found" }); return; }
    res.json(updated);
  } catch (err) { res.status(500).json({ error: String(err) }); }
});

vizRouter.delete("/api/action-items/:id", (req, res) => {
  try {
    if (!deleteActionItem(req.params.id)) { res.status(404).json({ error: "action item not found" }); return; }
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: String(err) }); }
});

// 任务
vizRouter.get("/api/action-tasks", (req, res) => {
  const actionItemId = req.query.actionItemId as string | undefined;
  const scopeId = req.query.scope as string | undefined;
  try {
    res.json(listActionTasks(actionItemId, scopeId));
  } catch (err) { res.status(500).json({ error: String(err) }); }
});

vizRouter.post("/api/action-tasks", (req, res) => {
  const b = req.body ?? {};
  try {
    res.json(createActionTask({
      actionItemId: b.actionItemId,
      title: b.title,
      owner: b.owner,
      dueDate: b.dueDate,
      status: b.status || "todo",
      priority: b.priority || "medium",
      note: b.note || "",
    }));
  } catch (err) { res.status(500).json({ error: String(err) }); }
});

vizRouter.patch("/api/action-tasks/:id", (req, res) => {
  try {
    const updated = updateActionTask(req.params.id, req.body ?? {});
    if (!updated) { res.status(404).json({ error: "action task not found" }); return; }
    res.json(updated);
  } catch (err) { res.status(500).json({ error: String(err) }); }
});

// 反馈
vizRouter.get("/api/action-tasks/:id/feedback", (req, res) => {
  try {
    const fb = getActionFeedback(req.params.id);
    if (!fb) { res.status(404).json({ error: "feedback not found" }); return; }
    res.json(fb);
  } catch (err) { res.status(500).json({ error: String(err) }); }
});

vizRouter.post("/api/action-tasks/:id/feedback", (req, res) => {
  const b = req.body ?? {};
  try {
    res.json(createActionFeedback({
      taskId: req.params.id,
      adopted: Boolean(b.adopted),
      outcome: b.outcome || "",
      metricDelta: b.metricDelta || "",
      review: b.review || "",
      score: Number(b.score) || 0,
    }));
  } catch (err) { res.status(500).json({ error: String(err) }); }
});

// ── 体检模块（V-HEALTH2）──确定性规则巡检，零 LLM ──

// 数据读取走 D 域 API（Orchestration §五.3 跨域走 HTTP fetch），不直接 import D 域函数。
// 先 fetch 列表端点校验 pathId 归属本 workspace，再逐集 fetch 行数据。

import { PORT } from "../config.ts";

const SELF_BASE = `http://localhost:${PORT}`;

vizRouter.get("/api/workspaces/:id/health/rules", (_req, res) => {
  res.json({ rules: listHealthRules() });
});

vizRouter.post("/api/workspaces/:id/health/runs", async (req, res) => {
  const workspaceId = req.params.id;
  if (!getWorkspace(workspaceId)) { res.status(404).json({ error: "workspace not found" }); return; }
  const suite = String(req.query.suite ?? "monthly") as HealthSuite;
  const validSuites: HealthSuite[] = ["daily", "weekly", "monthly", "quarterly", "yearly"];
  if (!validSuites.includes(suite)) { res.status(400).json({ error: "invalid suite" }); return; }
  const datasetPathIds: string[] = Array.isArray(req.body?.datasetPathIds) ? req.body.datasetPathIds : [];
  const thresholds: Record<string, number> | undefined = req.body?.thresholds;
  if (datasetPathIds.length === 0) { res.status(400).json({ error: "datasetPathIds required" }); return; }

  // 1. fetch D 域列表端点校验 pathId 归属（在落 run 之前，有非法直接 400）
  const listResp = await fetch(`${SELF_BASE}/api/bi/aggregations?workspaceId=${encodeURIComponent(workspaceId)}`);
  if (!listResp.ok) { res.status(500).json({ error: `failed to fetch aggregations list: ${listResp.status}` }); return; }
  const listData = await listResp.json() as Array<{ pathId: string }>;
  const validPathIds = new Set(listData.map((d) => d.pathId));
  const invalid = datasetPathIds.filter((pid) => !validPathIds.has(pid));
  if (invalid.length > 0) {
    res.status(400).json({ error: `pathIds not found in this workspace: ${invalid.join(",")}` });
    return;
  }

  const runId = insertHealthRun(workspaceId, suite, datasetPathIds).id;
  try {
    // 2. 逐集 fetch 行数据（pathId 已全部校验通过）
    const datasets: import("../health-check-engine.ts").HealthDatasetInput[] = [];
    for (const pathId of datasetPathIds) {
      const dataResp = await fetch(`${SELF_BASE}/api/bi/aggregations/${encodeURIComponent(pathId)}/data?limit=100000`);
      if (!dataResp.ok) throw new Error(`failed to fetch data for pathId ${pathId}: ${dataResp.status}`);
      const data = await dataResp.json() as { columns: string[]; rows: Array<Record<string, import("../types.ts").BiCell>> };
      datasets.push({ pathId, columns: data.columns, rows: data.rows });
    }

    // 3. 读本体（同进程直 import，非跨域）
    const ontologies = listOntologies(workspaceId);
    let objects: import("../types.ts").ObjectType[] = [];
    let links: import("../types.ts").LinkType[] = [];
    for (const ont of ontologies) {
      objects = objects.concat(listObjectTypes(ont.id));
      links = links.concat(listLinks(ont.id));
    }
    const metrics = listMetrics(workspaceId);

    // 4. 取上次同 suite + 同数据集组合的 run 的 findings 作为 priorFindings
    const priorFindings = listFindingsByRun(workspaceId, suite, datasetPathIds);

    // 5. 跑引擎
    const { findings, gaps } = runHealthSuite({
      suite,
      datasets,
      metrics,
      links,
      objects,
      businessContexts: [],
      thresholds,
      priorFindings,
    });

    // 6. 落 findings + gaps（id 加 runId 前缀保证跨 run 唯一）
    const findingsWithRun = findings.map((f) => ({ ...f, runId, id: `${runId}-${f.id}` }));
    insertHealthFindings(findingsWithRun);
    insertOntologyGaps(runId, gaps);

    // 7. 更新 run
    const problemCount = findings.filter((f) => f.kind === "问题").length;
    const riskCount = findings.filter((f) => f.kind === "风险").length;
    updateHealthRun(runId, {
      finishedAt: Date.now(),
      problemCount,
      riskCount,
      status: "done",
    });

    res.json({ run: { id: runId, workspaceId, suite, datasetPathIds, startedAt: Date.now(), finishedAt: Date.now(), problemCount, riskCount, status: "done" as const }, findings: findingsWithRun, gaps });
  } catch (err) {
    updateHealthRun(runId, { finishedAt: Date.now(), status: "error" });
    res.status(500).json({ error: String(err) });
  }
});

vizRouter.get("/api/workspaces/:id/health/runs", (req, res) => {
  try {
    res.json(listHealthRuns(req.params.id));
  } catch (err) { res.status(500).json({ error: String(err) }); }
});

vizRouter.get("/api/workspaces/:id/health/runs/:runId/findings", (req, res) => {
  try {
    // 校验 runId 归属本 workspace
    const runs = listHealthRuns(req.params.id);
    if (!runs.some((r) => r.id === req.params.runId)) {
      res.status(404).json({ error: "run not found in this workspace" });
      return;
    }
    const findings = listHealthFindings(req.params.runId);
    const gaps = listOntologyGaps(req.params.runId);
    res.json({ findings, gaps });
  } catch (err) { res.status(500).json({ error: String(err) }); }
});

// 体检报告 → HTML 导出（复用 renderMarkdownReportToHtml，前端 POST markdown 内容）
vizRouter.post("/api/workspaces/:id/health/export-html", (req, res) => {
  const workspaceId = req.params.id;
  if (!getWorkspace(workspaceId)) { res.status(404).json({ error: "workspace not found" }); return; }
  const markdown = String(req.body?.markdown ?? "");
  const reportName = String(req.body?.reportName ?? "体检报告");
  if (!markdown.trim()) { res.status(400).json({ error: "markdown required" }); return; }
  try {
    const html = renderMarkdownReportToHtml(reportName, markdown);
    res.json({ html });
  } catch (err) { res.status(500).json({ error: String(err) }); }
});

// ── 监测配置 monitor config（D-MONITOR1）──
// GET 返回当前 workspace 的 config（不存在返回 null）；PUT upsert。
// 校验：datasetBindings 中每个 pathId 必须属于本 workspace 的 clean_data 聚合集（同 health/runs 模式）。

const VALID_SUITES = new Set<HealthSuite>(["daily", "weekly", "monthly", "quarterly", "yearly"]);
const VALID_ROLES = new Set<MonitorSourceRole>(["goal", "source", "industry", "competitor"]);

vizRouter.get("/api/workspaces/:id/monitor/config", (req, res) => {
  const workspaceId = req.params.id;
  if (!getWorkspace(workspaceId)) { res.status(404).json({ error: "workspace not found" }); return; }
  try {
    res.json(getMonitorConfig(workspaceId));
  } catch (err) { res.status(500).json({ error: String(err) }); }
});

vizRouter.put("/api/workspaces/:id/monitor/config", async (req, res) => {
  const workspaceId = req.params.id;
  if (!getWorkspace(workspaceId)) { res.status(404).json({ error: "workspace not found" }); return; }
  const body = req.body ?? {};
  const suite = String(body.suite ?? "monthly") as HealthSuite;
  if (!VALID_SUITES.has(suite)) { res.status(400).json({ error: "invalid suite" }); return; }

  const rawBindings = Array.isArray(body.datasetBindings) ? body.datasetBindings : [];
  const bindings: MonitorDatasetBinding[] = [];
  for (const b of rawBindings) {
    if (!b || typeof b !== "object") continue;
    const pathId = String((b as { datasetPathId?: unknown }).datasetPathId ?? "");
    const role = (b as { role?: unknown }).role as MonitorSourceRole;
    if (!pathId || !VALID_ROLES.has(role)) {
      res.status(400).json({ error: `invalid binding: ${JSON.stringify(b)}` });
      return;
    }
    const label = typeof (b as { label?: unknown }).label === "string" ? (b as { label: string }).label : undefined;
    bindings.push({ datasetPathId: pathId, role, label, updatedAt: Date.now() });
  }

  // 校验 pathId 归属本 workspace 的 clean_data 聚合集
  if (bindings.length > 0) {
    try {
      const listResp = await fetch(`${SELF_BASE}/api/bi/aggregations?workspaceId=${encodeURIComponent(workspaceId)}`);
      if (!listResp.ok) { res.status(500).json({ error: `failed to fetch aggregations: ${listResp.status}` }); return; }
      const listData = await listResp.json() as Array<{ pathId: string }>;
      const valid = new Set(listData.map((d) => d.pathId));
      const invalid = bindings.map((b) => b.datasetPathId).filter((pid) => !valid.has(pid));
      if (invalid.length > 0) {
        res.status(400).json({ error: `pathIds not in this workspace clean_data: ${invalid.join(",")}` });
        return;
      }
    } catch (err) {
      res.status(500).json({ error: `aggregations fetch error: ${String(err)}` });
      return;
    }
  }

  const ontologyId = typeof body.ontologyId === "string" && body.ontologyId.trim() ? body.ontologyId : undefined;
  if (ontologyId && !listOntologies(workspaceId).some((o) => o.id === ontologyId)) {
    res.status(400).json({ error: "ontologyId not found in this workspace" });
    return;
  }
  const metricSystemId = typeof body.metricSystemId === "string" ? body.metricSystemId : undefined;
  let thresholds: Record<string, number> | undefined;
  if (body.thresholds && typeof body.thresholds === "object" && !Array.isArray(body.thresholds)) {
    thresholds = {};
    for (const [key, value] of Object.entries(body.thresholds as Record<string, unknown>)) {
      if (typeof value === "number" && Number.isFinite(value)) thresholds[key] = value;
    }
  }

  try {
    const config = upsertMonitorConfig(workspaceId, { suite, datasetBindings: bindings, ontologyId, metricSystemId, thresholds });
    res.json(config);
  } catch (err) { res.status(500).json({ error: String(err) }); }
});

// ── 目标测算 target-plans（D-MONITOR-TARGET3）──

function sanitizeTargetFileName(raw: string): string {
  const base = raw.replace(/[^a-zA-Z0-9_\-\u4e00-\u9fff]+/g, "_").replace(/^_+|_+$/g, "");
  return (base.slice(0, 80) || "target_plan") + ".csv";
}

function resolveMonitorTargetPath(workspaceRoot: string, fileName: string): string {
  const monitorBase = resolve(workspaceRoot, "clean_data/monitor");
  const target = resolve(monitorBase, fileName);
  if (target === monitorBase || !target.startsWith(monitorBase + "/")) {
    throw new Error(`unsafe path: ${fileName}`);
  }
  return target;
}

function uniqueTargetFileName(workspaceRoot: string, fileName: string): string {
  if (!existsSync(resolveMonitorTargetPath(workspaceRoot, fileName))) return fileName;
  const dotIdx = fileName.lastIndexOf(".");
  const stem = dotIdx > 0 ? fileName.slice(0, dotIdx) : fileName;
  const ext = dotIdx > 0 ? fileName.slice(dotIdx) : ".json";
  for (let i = 2; i < 10_000; i += 1) {
    const candidate = `${stem}_${i}${ext}`;
    if (!existsSync(resolveMonitorTargetPath(workspaceRoot, candidate))) return candidate;
  }
  throw new Error(`too many versions for target plan: ${fileName}`);
}

function csvCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  const text = String(value);
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function targetPlanToCsv(plan: TargetPlan): string {
  const headers = ["period", "case", "scenarioKind", "metric", "targetValue", "value", "planId", "planName"];
  const rows = plan.result.breakdown.length > 0
    ? plan.result.breakdown.map((item) => ({
        period: item.period,
        case: item.case,
        targetValue: item.targetValue,
      }))
    : plan.result.cases.map((item) => ({
        period: plan.input.periodEnd,
        case: item.case,
        targetValue: item.targetValue,
      }));
  return [
    headers.join(","),
    ...rows.map((row) => headers.map((header) => {
      const valueByHeader: Record<string, unknown> = {
        period: row.period,
        case: row.case,
        scenarioKind: plan.input.scenarioKind,
        metric: plan.input.metric,
        targetValue: row.targetValue,
        value: row.targetValue,
        planId: plan.id,
        planName: plan.name,
      };
      return csvCell(valueByHeader[header]);
    }).join(",")),
  ].join("\n");
}

// POST /api/workspaces/:id/monitor/target-plans
vizRouter.post("/api/workspaces/:id/monitor/target-plans", (req, res) => {
  const workspaceId = req.params.id;
  const ws = getWorkspace(workspaceId);
  if (!ws) { res.status(404).json({ error: "workspace not found" }); return; }
  const body = req.body ?? {};
  const name = typeof body.name === "string" && body.name.trim() ? body.name.trim() : null;
  if (!name) { res.status(400).json({ error: "name required" }); return; }
  const input = body.input as TargetCalculationInput | undefined;
  if (!input || typeof input !== "object") { res.status(400).json({ error: "input required" }); return; }
  const result = body.result as TargetCalculationResult | undefined;
  if (!result || typeof result !== "object") { res.status(400).json({ error: "result required" }); return; }
  try {
    const plan = createTargetPlan(workspaceId, name, input, result);
    res.json(plan);
  } catch (err) { res.status(500).json({ error: String(err) }); }
});

// GET /api/workspaces/:id/monitor/target-plans
vizRouter.get("/api/workspaces/:id/monitor/target-plans", (req, res) => {
  const workspaceId = req.params.id;
  if (!getWorkspace(workspaceId)) { res.status(404).json({ error: "workspace not found" }); return; }
  try {
    res.json(listTargetPlans(workspaceId));
  } catch (err) { res.status(500).json({ error: String(err) }); }
});

// GET /api/workspaces/:id/monitor/target-plans/:planId
vizRouter.get("/api/workspaces/:id/monitor/target-plans/:planId", (req, res) => {
  const workspaceId = req.params.id;
  if (!getWorkspace(workspaceId)) { res.status(404).json({ error: "workspace not found" }); return; }
  try {
    const plan = getTargetPlan(req.params.planId);
    if (!plan || plan.workspaceId !== workspaceId) { res.status(404).json({ error: "target plan not found" }); return; }
    res.json(plan);
  } catch (err) { res.status(500).json({ error: String(err) }); }
});

// POST /api/workspaces/:id/monitor/target-plans/:planId/adopt
vizRouter.post("/api/workspaces/:id/monitor/target-plans/:planId/adopt", async (req, res) => {
  const workspaceId = req.params.id;
  const ws = getWorkspace(workspaceId);
  if (!ws) { res.status(404).json({ error: "workspace not found" }); return; }
  try {
    const plan = getTargetPlan(req.params.planId);
    if (!plan || plan.workspaceId !== workspaceId) { res.status(404).json({ error: "target plan not found" }); return; }
    if (plan.status === "adopted") { res.status(400).json({ error: "target plan already adopted" }); return; }

    const config = getMonitorConfig(workspaceId);
    const existingGoal = config?.datasetBindings.find((b) => b.role === "goal");
    const replaceExisting = req.body?.replaceExisting === true;
    if (existingGoal && !replaceExisting) {
      res.status(409).json({
        error: "goal binding already exists; pass replaceExisting=true to replace it",
        existingGoalBinding: existingGoal,
      });
      return;
    }

    const fileName = uniqueTargetFileName(ws.rootPath, sanitizeTargetFileName(plan.name));
    const targetAbs = resolveMonitorTargetPath(ws.rootPath, fileName);
    mkdirSync(dirname(targetAbs), { recursive: true });
    writeFileSync(targetAbs, targetPlanToCsv(plan), "utf8");

    const entry = addWorkspacePath(workspaceId, "clean_data", targetAbs, "file");

    const updatedPlan = adoptTargetPlan(plan.id, String(entry.id));

    const nextBindings: MonitorDatasetBinding[] = (config?.datasetBindings ?? [])
      .filter((b) => b.role !== "goal");
    nextBindings.push({
      datasetPathId: String(entry.id),
      role: "goal",
      label: plan.name,
      updatedAt: Date.now(),
    });
    upsertMonitorConfig(workspaceId, {
      suite: config?.suite ?? "monthly",
      datasetBindings: nextBindings,
      ontologyId: config?.ontologyId,
      metricSystemId: config?.metricSystemId,
      thresholds: config?.thresholds,
    });

    res.json({
      plan: updatedPlan,
      goalDatasetPathId: String(entry.id),
      replacedGoalBinding: existingGoal ?? null,
    });
  } catch (err) { res.status(500).json({ error: String(err) }); }
});
