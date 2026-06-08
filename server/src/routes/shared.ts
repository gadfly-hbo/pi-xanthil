import { Router } from "express";

/**
 * 【总控 · 共享域】HTTP 路由 slot —— owner: Claude(总控)
 *
 * 覆盖：跨域基础设施。
 *   /api/workspaces* · /api/workspace-paths* · /api/health · /api/llm* · /api/pick-path · /api/models …
 *
 * 约定：仅总控写。agent 如需新增共享端点 → 提 PR 给总控。
 */
export const sharedRouter = Router();
