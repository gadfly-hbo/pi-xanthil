import { db } from "../db.ts";

/**
 * 【总控 · 共享域】db 表 slot —— owner: Claude(总控)
 * 跨域基础表（workspaces / workspace_paths / token_stats 等 legacy 仍在 db.ts）。
 * 新增跨域基础表在此 CREATE TABLE IF NOT EXISTS；仅总控写。
 */
export function initSharedTables(): void {
  void db; // 占位; 新表写: db.exec(`CREATE TABLE IF NOT EXISTS ...`)
}
