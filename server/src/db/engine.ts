import { db } from "../db.ts";

/**
 * 【Agent-E · 智能引擎域】db 表 slot —— owner: codex(GPT-5.5)
 * Notebook / 新 eval 维度等引擎域新表建在此（flows/sessions/eval legacy 仍在 db.ts）。
 * 约定: 新表 CREATE TABLE IF NOT EXISTS; 配套 CRUD 写本文件, 由 routes/engine.ts 调用。
 */
export function initEngineTables(): void {
  void db; // 占位; 新表写: db.exec(`CREATE TABLE IF NOT EXISTS ...`)
}
