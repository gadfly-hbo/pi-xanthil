import { randomUUID } from "node:crypto";
import { db } from "../db.ts";

export interface DbDashboard {
  id: string;
  workspace_id: string;
  name: string;
  layout_json: string;
  created_at: number;
  updated_at: number;
}

/**
 * 【Agent-V · 可视交付域】db 表 slot —— owner: antigravity(Gemini)
 * 看板画布 / 报告模板等新表建在此（reports/report_tags/kg legacy 仍在 db.ts）。
 * 约定: 新表 CREATE TABLE IF NOT EXISTS; 配套 CRUD 写本文件, 由 routes/viz.ts 调用。
 */
export function initVizTables(): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS dashboards (
      id           TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL REFERENCES workspaces(id),
      name         TEXT NOT NULL,
      layout_json  TEXT NOT NULL,
      created_at   INTEGER NOT NULL,
      updated_at   INTEGER NOT NULL
    );
  `);
  try {
    db.exec(`CREATE INDEX IF NOT EXISTS idx_dashboards_workspace ON dashboards(workspace_id);`);
  } catch {
    // ignore
  }
}

export function listDashboards(workspaceId: string): DbDashboard[] {
  return db
    .prepare(
      "SELECT id, workspace_id, name, layout_json, created_at, updated_at FROM dashboards WHERE workspace_id = ? ORDER BY updated_at DESC"
    )
    .all(workspaceId) as unknown as DbDashboard[];
}

export function getDashboard(id: string): DbDashboard | undefined {
  return db
    .prepare(
      "SELECT id, workspace_id, name, layout_json, created_at, updated_at FROM dashboards WHERE id = ?"
    )
    .get(id) as unknown as DbDashboard | undefined;
}

export function createDashboard(workspaceId: string, name: string, layoutJson: string): DbDashboard {
  const id = randomUUID();
  const now = Date.now();
  db.prepare(
    "INSERT INTO dashboards (id, workspace_id, name, layout_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)"
  ).run(id, workspaceId, name, layoutJson, now, now);
  
  return {
    id,
    workspace_id: workspaceId,
    name,
    layout_json: layoutJson,
    created_at: now,
    updated_at: now,
  };
}

export function updateDashboard(id: string, name?: string, layoutJson?: string): DbDashboard | undefined {
  const existing = getDashboard(id);
  if (!existing) return undefined;

  const newName = name !== undefined ? name : existing.name;
  const newLayout = layoutJson !== undefined ? layoutJson : existing.layout_json;
  const now = Date.now();

  db.prepare(
    "UPDATE dashboards SET name = ?, layout_json = ?, updated_at = ? WHERE id = ?"
  ).run(newName, newLayout, now, id);

  return {
    ...existing,
    name: newName,
    layout_json: newLayout,
    updated_at: now,
  };
}

export function deleteDashboard(id: string): boolean {
  const res = db.prepare("DELETE FROM dashboards WHERE id = ?").run(id);
  return res.changes > 0;
}

