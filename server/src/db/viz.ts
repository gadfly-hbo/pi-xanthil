import { db } from "../db.ts";

/**
 * 【Agent-V · 可视交付域】db 表 slot —— owner: antigravity(Gemini)
 * 看板画布 / 报告模板等新表建在此（reports/report_tags/kg legacy 仍在 db.ts）。
 * 约定: 新表 CREATE TABLE IF NOT EXISTS; 配套 CRUD 写本文件, 由 routes/viz.ts 调用。
 */
export function initVizTables(): void {
  void db; // 占位; 新表写: db.exec(`CREATE TABLE IF NOT EXISTS dashboards (...)`)
}
