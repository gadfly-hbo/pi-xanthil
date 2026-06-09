import { Router } from "express";
import { readFileSync } from "node:fs";
import { extname } from "node:path";
import { listWorkspacePaths, getWorkspacePath, getWorkspace } from "../db.ts";
import { parseAggregationBuffer } from "../bi-dataset-parser.ts";
import type { BiAggregationDataset, BiAggregationData } from "../types.ts";

/**
 * 【Agent-D · 数据基座域】HTTP 路由 slot —— owner: opencode(deepseek/glm)
 *
 * 覆盖：数据接入 / 数据准备 / 指标语义层。
 *   /api/sql-connections* · /api/extraction-tools* · /api/bi-datasets* · /api/metrics*(语义层,待建) …
 *
 * 约定：
 *   - 新路由写在本文件：`dataRouter.post("/api/metrics", (req, res) => { ... })`
 *   - 复用 db CRUD：`import { listSqlConnections } from "../db.ts"`
 *   - 复用 LLM 调用：`import { runPiPrompt } from "../pi-adapter.ts"`
 *   - 跨域读取走对方 GET，禁止 import 他域 db 函数
 *
 * 禁止：
 *   - 触碰 index.ts（legacy 冻结，归总控）/ 他域 router
 *   - 违反 AGENTS.md 数据安全铁律：draw_data 禁 LLM、数据探索纯前端零 LLM
 */
export const dataRouter = Router();

// ── P0-D 看板聚合数据源 API ──

const DEFAULT_LIMIT = 5000;

// 仅表格文件可作看板数据源（与 bi-datasets 上传白名单一致）；排除 .md/报告等非表格 clean_data 文件
const TABULAR_EXT = new Set([".csv", ".tsv", ".xlsx", ".xls"]);

dataRouter.get("/api/bi/aggregations", (req, res) => {
  try {
    const workspaceId = String(req.query.workspaceId ?? "");
    if (!workspaceId) return res.status(400).json({ error: "workspaceId required" });
    if (!getWorkspace(workspaceId)) return res.status(404).json({ error: "workspace not found" });

    const paths = listWorkspacePaths(workspaceId, "clean_data");
    const files = paths.filter(
      (p) => p.kind === "file" && TABULAR_EXT.has(extname(p.path).toLowerCase()),
    );

    const datasets: BiAggregationDataset[] = [];
    for (const entry of files) {
      try {
        const buf = readFileSync(entry.path);
        const { columns, rows } = parseAggregationBuffer(buf, entry.path);
        if (columns.length === 0) continue;
        datasets.push({
          pathId: String(entry.id),
          name: entry.path.split("/").pop() ?? entry.path,
          columns,
          rowCount: rows.length,
        });
      } catch {
        // skip unparseable files
      }
    }

    res.json(datasets);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

dataRouter.get("/api/bi/aggregations/:pathId/data", (req, res) => {
  try {
    const pathId = Number(req.params.pathId);
    if (!Number.isFinite(pathId)) return res.status(400).json({ error: "invalid pathId" });

    const entry = getWorkspacePath(pathId);
    if (!entry) return res.status(404).json({ error: "path not found" });

    if (entry.folder === "draw_data") {
      return res.status(403).json({ error: "draw_data access forbidden" });
    }
    if (entry.folder !== "clean_data") {
      return res.status(400).json({ error: "only clean_data aggregations are supported" });
    }
    if (entry.kind !== "file") {
      return res.status(400).json({ error: "path is not a file" });
    }

    const limit = Math.min(Number(req.query.limit) || DEFAULT_LIMIT, 100000);
    const buf = readFileSync(entry.path);
    const { columns, rows } = parseAggregationBuffer(buf, entry.path);

    const result: BiAggregationData = {
      columns,
      rows: rows.slice(0, limit) as BiAggregationData["rows"],
    };

    res.json(result);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});
