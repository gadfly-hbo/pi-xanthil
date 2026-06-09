import { Router } from "express";
import {
  listDashboards,
  createDashboard,
  updateDashboard,
  deleteDashboard,
} from "../db/viz.ts";

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

