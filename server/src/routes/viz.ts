import { Router } from "express";
import { readFileSync } from "node:fs";
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
} from "../db/viz.ts";
import { getWorkspacePath, getWorkspace } from "../db.ts";
import { parseAggregationBuffer } from "../bi-dataset-parser.ts";
import { extractOntologyFromText, runChunkedExtraction } from "../onto-extract.ts";
import { exportOntology, type ExportFormat } from "../onto-export.ts";
import { readFlowFile } from "../flow-fs.ts";
import { runPiPrompt } from "../pi-adapter.ts";
import type { GraphNode, GraphEdge, OntologyGraph, PropertyDataType, ObjectKind, LinkKind } from "../types.ts";

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
      status: "suggested",
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
