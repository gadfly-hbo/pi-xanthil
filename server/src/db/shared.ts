import { db } from "../db.ts";
import type { MemoryItemKind, WorkspaceMemoryEnablement } from "../types.ts";

/**
 * 【总控 · 共享域】db 表 slot —— owner: Claude(总控)
 * 跨域基础表（workspaces / workspace_paths / token_stats 等 legacy 仍在 db.ts）。
 * 新增跨域基础表在此 CREATE TABLE IF NOT EXISTS；仅总控写。
 */
export function initSharedTables(): void {
  // 全局池 + 按工作区启用：定义表降级为全局池（workspace_id=origin 仅溯源），
  // "本工作区用不用" 落在此关联表。共享单实例：编辑定义全局生效。
  db.exec(`
    CREATE TABLE IF NOT EXISTS workspace_memory_enablements (
      workspace_id TEXT NOT NULL,
      item_kind    TEXT NOT NULL,
      item_id      TEXT NOT NULL,
      enabled      INTEGER NOT NULL DEFAULT 1,
      created_at   INTEGER NOT NULL,
      PRIMARY KEY (workspace_id, item_kind, item_id)
    );
  `);
  db.exec("CREATE INDEX IF NOT EXISTS idx_wme_ws_kind ON workspace_memory_enablements(workspace_id, item_kind)");
  db.exec("CREATE INDEX IF NOT EXISTS idx_wme_item ON workspace_memory_enablements(item_kind, item_id)");
}

// 现有定义 → 启用记录的回填来源（均有 id/workspace_id/enabled 三列）。
const BACKFILL_SOURCES: Array<{ kind: MemoryItemKind; table: string }> = [
  { kind: "rule", table: "rule_memories" },
  { kind: "standard", table: "analysis_standards" },
  { kind: "business_context", table: "business_contexts" },
  { kind: "case", table: "analysis_cases" },
  { kind: "metric", table: "metric_definitions" },
];

/**
 * 一次性·幂等 backfill：现有定义按 origin workspace 建启用记录（仅原工作区启用，
 * enabled 沿用该行原值）。INSERT OR IGNORE 保证幂等——已存在的关系（含被手动禁用的）不被覆盖，
 * 新建定义经 CRUD 自带关系也不会被重复插入。每次 boot 调用安全。
 */
export function backfillMemoryEnablements(): void {
  const now = Date.now();
  for (const { kind, table } of BACKFILL_SOURCES) {
    try {
      db.prepare(
        `INSERT OR IGNORE INTO workspace_memory_enablements(workspace_id, item_kind, item_id, enabled, created_at)
         SELECT workspace_id, ?, id, enabled, ? FROM ${table}`,
      ).run(kind, now);
    } catch {
      // 表尚未建/列缺失（如 onto 结构表无 enabled）时跳过；onto 粒度由 P3 决定。
    }
  }
}

/** 设置/更新某工作区对某池条目的启用状态（upsert）。 */
export function setMemoryEnablement(
  workspaceId: string,
  itemKind: MemoryItemKind,
  itemId: string,
  enabled: boolean,
): void {
  db.prepare(
    `INSERT INTO workspace_memory_enablements(workspace_id, item_kind, item_id, enabled, created_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(workspace_id, item_kind, item_id) DO UPDATE SET enabled = excluded.enabled`,
  ).run(workspaceId, itemKind, itemId, enabled ? 1 : 0, Date.now());
}

/** 新池定义被创建时调用：origin 工作区默认启用（其余工作区不启用 = 无关系行）。 */
export function enableForOrigin(workspaceId: string, itemKind: MemoryItemKind, itemId: string): void {
  setMemoryEnablement(workspaceId, itemKind, itemId, true);
}

/** 列出某工作区某类已启用的池条目 id —— 供注入/列举管线 join 用。 */
export function listEnabledItemIds(workspaceId: string, itemKind: MemoryItemKind): string[] {
  return (
    db
      .prepare(
        `SELECT item_id FROM workspace_memory_enablements
         WHERE workspace_id = ? AND item_kind = ? AND enabled = 1`,
      )
      .all(workspaceId, itemKind) as Array<{ item_id: string }>
  ).map((r) => r.item_id);
}

/** 列出某工作区的启用关系（可按 kind 过滤）—— 供前端"池 + 启用勾选"视图用。 */
export function listWorkspaceEnablements(
  workspaceId: string,
  itemKind?: MemoryItemKind,
): WorkspaceMemoryEnablement[] {
  const rows = itemKind
    ? db
        .prepare("SELECT * FROM workspace_memory_enablements WHERE workspace_id = ? AND item_kind = ?")
        .all(workspaceId, itemKind)
    : db.prepare("SELECT * FROM workspace_memory_enablements WHERE workspace_id = ?").all(workspaceId);
  return (
    rows as Array<{ workspace_id: string; item_kind: string; item_id: string; enabled: number; created_at: number }>
  ).map((r) => ({
    workspaceId: r.workspace_id,
    itemKind: r.item_kind as MemoryItemKind,
    itemId: r.item_id,
    enabled: !!r.enabled,
    createdAt: r.created_at,
  }));
}
