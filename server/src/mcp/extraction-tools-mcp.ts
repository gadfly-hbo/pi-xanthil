/**
 * Hand-rolled, zero-dependency stdio MCP server exposing the project's registered
 * ExtractionTools to a pi data-analysis session (via the globally-installed
 * `pi-mcp-adapter`, which reads `<workspaceRoot>/.mcp.json`).
 *
 * 红线（AGENTS.md §一）：本进程只是 stdio→HTTP 代理，所有工具调用经主服务的
 * `POST /api/extraction-tools/:id/run` + `source=ai` 执行。AI 可调工具允许读取已登记数据路径；
 * 工具对其产物是否含原始行负责，禁止把 draw_data 原始行/明细整体回灌 LLM。本进程自身不读任何数据文件。
 *
 * Transport: newline-delimited JSON-RPC 2.0 over stdin/stdout (MCP stdio standard).
 * Spawned per `.mcp.json`: `node --experimental-strip-types <this> --workspace <id> --api <baseUrl>`.
 */
import { createInterface } from "node:readline";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

function argOf(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const WORKSPACE_ID = argOf("--workspace") ?? "";
const API_BASE = (argOf("--api") ?? "http://localhost:8787").replace(/\/$/, "");
const PROTOCOL_VERSION = "2024-11-05";

interface ToolParameter { name: string; type?: string; description?: string; required?: boolean; default?: unknown }
interface RemoteTool {
  id: string;
  name: string;
  description?: string;
  category?: "ingestion" | "analysis";
  parameters?: ToolParameter[];
}

type JsonRpcId = string | number | null;
interface JsonRpcRequest { jsonrpc: "2.0"; id?: JsonRpcId; method: string; params?: Record<string, unknown> }

function write(msg: Record<string, unknown>): void {
  process.stdout.write(JSON.stringify(msg) + "\n");
}
function reply(id: JsonRpcId, result: unknown): void {
  write({ jsonrpc: "2.0", id, result });
}
function replyError(id: JsonRpcId, code: number, message: string): void {
  write({ jsonrpc: "2.0", id, error: { code, message } });
}

async function fetchTools(): Promise<RemoteTool[]> {
  const res = await fetch(`${API_BASE}/api/extraction-tools`);
  if (!res.ok) throw new Error(`list tools failed: ${res.status}`);
  return (await res.json()) as RemoteTool[];
}

function isAiExposed(tool: RemoteTool): boolean {
  return tool.category === "analysis";
}

/** MCP tool def per ExtractionTool. Input may be any registered data path accepted by the tool. */
function toMcpTool(t: RemoteTool) {
  const properties: Record<string, unknown> = {
    cleanDataPath: {
      type: "string",
      description: "要处理的数据文件绝对路径。可为本工作区已登记且该工具接受的数据路径；工具产物不得包含原始行级明细。",
    },
  };
  const required = ["cleanDataPath"];
  for (const p of t.parameters ?? []) {
    properties[p.name] = { type: p.type ?? "string", description: p.description ?? "" };
    if (p.required) required.push(p.name);
  }
  return {
    name: t.id,
    description: `${t.name}${t.description ? ` — ${t.description}` : ""}（数据分析工具，可处理本工作区已登记且该工具接受的数据路径；产物不得包含原始行级明细）`,
    inputSchema: { type: "object", properties, required },
  };
}

async function callTool(name: string, args: Record<string, unknown>): Promise<{ content: { type: "text"; text: string }[]; isError?: boolean }> {
  const cleanDataPath = typeof args.cleanDataPath === "string" ? args.cleanDataPath : "";
  if (!cleanDataPath) return { content: [{ type: "text", text: "缺少 cleanDataPath（已登记且工具接受的数据文件路径）" }], isError: true };

  // Output goes to a workspace-local managed dir (cwd = workspaceRoot when spawned by pi).
  const outputPath = join(process.cwd(), "tool_runs", `${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(outputPath, { recursive: true });

  const params: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(args)) if (k !== "cleanDataPath") params[k] = v;

  const res = await fetch(`${API_BASE}/api/extraction-tools/${encodeURIComponent(name)}/run`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ source: "ai", workspaceId: WORKSPACE_ID, inputPath: cleanDataPath, outputPath, params }),
  });
  const body = (await res.json()) as Record<string, unknown>;
  if (!res.ok) {
    return { content: [{ type: "text", text: `工具执行被拒绝或失败（${res.status}）：${JSON.stringify(body)}` }], isError: true };
  }
  return { content: [{ type: "text", text: JSON.stringify(body) }] };
}

async function handle(req: JsonRpcRequest): Promise<void> {
  const { id, method } = req;
  const isRequest = id !== undefined && id !== null;
  try {
    if (method === "initialize") {
      return reply(id ?? null, {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: { tools: {} },
        serverInfo: { name: "xanthil-data-tools", version: "0.1.0" },
      });
    }
    if (method === "tools/list") {
      const tools = (await fetchTools()).filter(isAiExposed);
      return reply(id ?? null, { tools: tools.map(toMcpTool) });
    }
    if (method === "tools/call") {
      const p = req.params ?? {};
      const name = typeof p.name === "string" ? p.name : "";
      const args = (p.arguments && typeof p.arguments === "object" ? p.arguments : {}) as Record<string, unknown>;
      if (!name) return replyError(id ?? null, -32602, "missing tool name");
      const tool = (await fetchTools()).find((item) => item.id === name);
      if (!tool || !isAiExposed(tool)) return replyError(id ?? null, -32602, "tool is not exposed for AI use");
      return reply(id ?? null, await callTool(name, args));
    }
    if (method === "ping") return reply(id ?? null, {});
    // Notifications (no id) like notifications/initialized: ignore silently.
    if (isRequest) return replyError(id ?? null, -32601, `method not found: ${method}`);
  } catch (err) {
    if (isRequest) return replyError(id ?? null, -32603, err instanceof Error ? err.message : String(err));
  }
}

const rl = createInterface({ input: process.stdin });
rl.on("line", (line) => {
  const trimmed = line.trim();
  if (!trimmed) return;
  let req: JsonRpcRequest;
  try { req = JSON.parse(trimmed) as JsonRpcRequest; } catch { return; }
  void handle(req);
});
