import { Router } from "express";
import { listWorkspaceEnablements, setMemoryEnablement } from "../db/shared.ts";
import {
  LlmConfigValidationError,
  listAuthStatus,
  listProvidersView,
  readSettingsView,
  testProvider,
  writeProviders,
  writeSettings,
} from "../llm-config.ts";
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

function handleLlmRouteError(err: unknown, res: { status: (code: number) => { json: (body: unknown) => void } }): void {
  if (err instanceof LlmConfigValidationError) {
    res.status(400).json({ error: err.message });
    return;
  }
  res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
}

// 安全提示：本端点无认证（本地单用户工具，仅 bind localhost）。
// 若未来 bind 非 localhost，必须在此加 auth 中间件；apiKey 仅写入 pi 本机真源，出网/回显恒脱敏。
sharedRouter.get("/api/llm/providers", (_req, res) => {
  try {
    res.json(listProvidersView());
  } catch (err) {
    handleLlmRouteError(err, res);
  }
});

sharedRouter.put("/api/llm/providers", (req, res) => {
  try {
    res.json(writeProviders(req.body));
  } catch (err) {
    handleLlmRouteError(err, res);
  }
});

sharedRouter.post("/api/llm/providers/:id/test", async (req, res) => {
  try {
    res.json(await testProvider(req.params.id));
  } catch (err) {
    handleLlmRouteError(err, res);
  }
});

sharedRouter.get("/api/llm/settings", (_req, res) => {
  try {
    res.json(readSettingsView());
  } catch (err) {
    handleLlmRouteError(err, res);
  }
});

sharedRouter.put("/api/llm/settings", (req, res) => {
  try {
    res.json(writeSettings(req.body));
  } catch (err) {
    handleLlmRouteError(err, res);
  }
});

sharedRouter.get("/api/llm/auth", (_req, res) => {
  try {
    res.json(listAuthStatus());
  } catch (err) {
    handleLlmRouteError(err, res);
  }
});
