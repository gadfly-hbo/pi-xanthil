import { Router } from "express";
import { listWorkspaceEnablements, setMemoryEnablement } from "../db/shared.ts";
import type { MemoryItemKind } from "../types.ts";

/**
 * 【总控 · 共享域】HTTP 路由 slot —— owner: Claude(总控)
 *
 * 覆盖：跨域基础设施。
 *   /api/workspaces* · /api/workspace-paths* · /api/health · /api/llm* · /api/pick-path · /api/models …
 *
 * 约定：仅总控写。agent 如需新增共享端点 → 提 PR 给总控。
 */
export const sharedRouter = Router();

// ---- 全局池启用关系（D/V 各 Pane 共用）----
sharedRouter.get("/api/workspaces/:id/memory-enablements", (req, res) => {
  const kind = req.query.kind as MemoryItemKind | undefined;
  res.json(listWorkspaceEnablements(req.params.id, kind));
});

sharedRouter.put("/api/workspaces/:id/memory-enablements", (req, res) => {
  const { itemKind, itemId, enabled } = (req.body ?? {}) as {
    itemKind?: MemoryItemKind;
    itemId?: string;
    enabled?: boolean;
  };
  if (!itemKind || !itemId || typeof enabled !== "boolean") {
    res.status(400).json({ error: "itemKind/itemId/enabled required" });
    return;
  }
  setMemoryEnablement(req.params.id, itemKind, itemId, enabled);
  res.json({ ok: true });
});
