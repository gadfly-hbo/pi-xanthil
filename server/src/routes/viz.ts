import { Router } from "express";

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
