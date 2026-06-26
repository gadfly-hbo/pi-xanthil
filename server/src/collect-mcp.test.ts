import { test } from "node:test";
import { strict as assert } from "node:assert";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { prepareCollectCwd, COLLECT_CWD_DIRNAME, COLLECT_SYSTEM_PROMPT } from "./collect-mcp.ts";

function withTmpRoot(fn: (root: string) => void): void {
  const root = mkdtempSync(join(tmpdir(), "collect-mcp-"));
  try {
    fn(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function readMcp(root: string): { mcpServers: Record<string, unknown> } {
  const raw = readFileSync(join(root, COLLECT_CWD_DIRNAME, ".mcp.json"), "utf8");
  return JSON.parse(raw) as { mcpServers: Record<string, unknown> };
}

test("prepareCollectCwd: with key writes minimax MCP server", () => {
  withTmpRoot((root) => {
    const cwd = prepareCollectCwd(root, "sk-test-key");
    assert.equal(cwd, join(root, COLLECT_CWD_DIRNAME));
    const cfg = readMcp(root);
    const minimax = cfg.mcpServers.minimax as { command: string; args: string[]; env: Record<string, string> };
    assert.ok(minimax, "minimax server must be present when key set");
    assert.equal(minimax.command, "uvx");
    assert.deepEqual(minimax.args, ["minimax-coding-plan-mcp", "-y"]);
    assert.equal(minimax.env.MINIMAX_API_KEY, "sk-test-key");
    assert.equal(minimax.env.MINIMAX_API_HOST, "https://api.minimaxi.com");
  });
});

test("prepareCollectCwd: without key writes empty mcpServers and does not throw", () => {
  withTmpRoot((root) => {
    const cwd = prepareCollectCwd(root, "");
    assert.equal(cwd, join(root, COLLECT_CWD_DIRNAME));
    const cfg = readMcp(root);
    assert.deepEqual(cfg.mcpServers, {}, "no minimax server when key empty");
  });
});

test("prepareCollectCwd: idempotent on repeated calls (multi-turn)", () => {
  withTmpRoot((root) => {
    const a = prepareCollectCwd(root, "sk-1");
    const b = prepareCollectCwd(root, "sk-1");
    assert.equal(a, b);
    assert.equal((readMcp(root).mcpServers.minimax as { env: Record<string, string> }).env.MINIMAX_API_KEY, "sk-1");
  });
});

test("COLLECT_SYSTEM_PROMPT mentions web_search and source attribution", () => {
  assert.match(COLLECT_SYSTEM_PROMPT, /web_search/);
  assert.match(COLLECT_SYSTEM_PROMPT, /来源/);
});
