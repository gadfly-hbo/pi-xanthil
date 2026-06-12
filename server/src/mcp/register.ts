/**
 * Per-workspace registration of the ExtractionTool MCP server into the workspace
 * root's `.mcp.json` (read by the global `pi-mcp-adapter` when a pi session runs
 * with cwd = workspaceRoot — i.e. the data-analysis ChatPane session, handleSend).
 *
 * Scoped on purpose (用户决策 2026-06-12)：写每工作区 `.mcp.json`，工具仅在该工作区的
 * 数据分析 session 可见，不污染其他 pi 上下文、不动用户全局 ~/.pi 配置。
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { PORT } from "../config.ts";
import { listWorkspaces } from "../db.ts";

const SERVER_KEY = "xanthil-data-tools";
const MCP_ENTRY = fileURLToPath(new URL("./extraction-tools-mcp.ts", import.meta.url));

interface McpConfig { mcpServers?: Record<string, unknown> }

/** Idempotently write/refresh our MCP server entry into `<rootPath>/.mcp.json`, preserving other servers. */
export function ensureWorkspaceMcpConfig(rootPath: string, workspaceId: string): void {
  const file = join(rootPath, ".mcp.json");
  let config: McpConfig = {};
  if (existsSync(file)) {
    try { config = JSON.parse(readFileSync(file, "utf8")) as McpConfig; } catch { config = {}; }
  }
  const servers = config.mcpServers ?? {};
  servers[SERVER_KEY] = {
    command: process.execPath,
    args: ["--experimental-strip-types", MCP_ENTRY, "--workspace", workspaceId, "--api", `http://localhost:${PORT}`],
  };
  config.mcpServers = servers;
  writeFileSync(file, JSON.stringify(config, null, 2));
}

/** Backfill all existing workspaces at startup. */
export function registerAllWorkspaceMcp(): void {
  for (const ws of listWorkspaces()) {
    try { ensureWorkspaceMcpConfig(ws.rootPath, ws.id); } catch { /* best-effort; a bad workspace dir shouldn't block boot */ }
  }
}
