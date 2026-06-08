import { db } from "../db.ts";

/**
 * 【Agent-D · 数据基座域】db 表 slot —— owner: opencode(deepseek/glm)
 * 数据源 / 指标语义层（metrics / metric_lineage / data_sources …）等新表建在此。
 * 约定: 新表 CREATE TABLE IF NOT EXISTS; 配套 CRUD 也写本文件, 由 routes/data.ts 调用。
 * 禁止: 改他域表 / 触碰 db.ts legacy schema。
 */
export function initDataTables(): void {
  void db; // 占位; 新表写: db.exec(`CREATE TABLE IF NOT EXISTS metrics (...)`)
}
