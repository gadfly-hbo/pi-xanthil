import { useCallback, useEffect, useState } from "react";
import { Puzzle, Plug, RefreshCw } from "lucide-react";
import { api } from "@/lib/api";
import type { PluginInfo, McpServerInfo } from "@/lib/api/data";

/**
 * 计算工具·插件管理（pi 已加载扩展/包 + MCP servers 一览，只读）。
 *
 * 两类并列呈现：
 *   - 插件（plugin）= settings.json packages[]/extensions[] + global(~/.pi/agent/extensions/) + project(.pi/extensions/)。
 *   - MCP（server）= ~/.pi/agent/mcp.json（全局）+ <cwd>/.mcp.json（项目）。
 * 纯只读，不读实现内容、不调任何 LLM。MCP 的 env 仅显示**变量名**（server 侧已剥离值，防 key 外泄）。
 */

const SOURCE_LABEL: Record<PluginInfo["source"], string> = {
  package: "package（npm）",
  global: "global（~/.pi/agent/extensions）",
  project: "project（.pi/extensions）",
  local: "local（settings.extensions）",
};

const SOURCE_BADGE: Record<PluginInfo["source"], string> = {
  package: "bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-300",
  global: "bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300",
  project: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300",
  local: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300",
};

const MCP_SOURCE_LABEL: Record<McpServerInfo["source"], string> = {
  global: "global（~/.pi/agent/mcp.json）",
  project: "project（.mcp.json）",
};

const MCP_SOURCE_BADGE: Record<McpServerInfo["source"], string> = {
  global: "bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300",
  project: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300",
};

const TRANSPORT_BADGE: Record<McpServerInfo["transport"], string> = {
  stdio: "bg-neutral-100 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300",
  remote: "bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300",
};

export function PluginManagementPane() {
  const [plugins, setPlugins] = useState<PluginInfo[]>([]);
  const [mcpServers, setMcpServers] = useState<McpServerInfo[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const reload = useCallback(() => {
    setLoading(true);
    setError("");
    Promise.all([api.listPlugins(), api.listMcpServers()])
      .then(([p, m]) => {
        setPlugins(p);
        setMcpServers(m);
      })
      .catch((err) => setError(String(err)))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => reload(), [reload]);

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-neutral-200 bg-white px-4 py-2.5 dark:border-neutral-800 dark:bg-neutral-950">
        <Puzzle className="h-4 w-4 text-neutral-500" />
        <h2 className="text-[13px] font-medium text-neutral-700 dark:text-neutral-200">计算工具 · 插件管理</h2>
        <span className="text-[11px] text-neutral-400">pi 已加载扩展 / 包 + MCP（只读）</span>
        <button
          onClick={reload}
          disabled={loading}
          className="ml-auto flex items-center gap-1 rounded border border-neutral-200 px-2 py-1 text-[11.5px] text-neutral-600 hover:bg-neutral-100 disabled:opacity-50 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
          刷新
        </button>
      </div>

      <div className="flex-1 space-y-6 overflow-auto bg-neutral-50 p-4 dark:bg-neutral-900">
        {error && (
          <div className="rounded border border-red-300 bg-red-50 px-3 py-2 text-[12px] text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
            {error}
          </div>
        )}

        {/* 一类：插件（plugin） */}
        <section>
          <div className="mb-2 flex items-center gap-1.5">
            <Puzzle className="h-3.5 w-3.5 text-neutral-500" />
            <h3 className="text-[12.5px] font-medium text-neutral-700 dark:text-neutral-200">插件（plugin）</h3>
            <span className="text-[11px] text-neutral-400">{plugins.length} 项</span>
          </div>
          <p className="mb-2 text-[11.5px] text-neutral-400">
            扫描 settings.json packages / 全局 / 项目目录。增删插件请改 pi settings 或对应目录（本页只读）。
          </p>
          <div className="overflow-hidden rounded border border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-950">
            <table className="w-full text-[12px]">
              <thead className="bg-neutral-50 text-neutral-500 dark:bg-neutral-900 dark:text-neutral-400">
                <tr>
                  <th className="px-3 py-2 text-left font-normal">插件</th>
                  <th className="px-3 py-2 text-left font-normal">来源</th>
                  <th className="px-3 py-2 text-left font-normal">路径 / 包名</th>
                  <th className="px-3 py-2 text-left font-normal">状态</th>
                </tr>
              </thead>
              <tbody>
                {plugins.length === 0 && !loading && (
                  <tr>
                    <td colSpan={4} className="px-3 py-8 text-center text-neutral-400">
                      未发现插件
                    </td>
                  </tr>
                )}
                {plugins.map((it) => (
                  <tr key={it.id} className="border-t border-neutral-100 dark:border-neutral-800">
                    <td className="px-3 py-2 font-mono text-neutral-700 dark:text-neutral-200">{it.name}</td>
                    <td className="px-3 py-2">
                      <span className={`rounded px-1.5 py-0.5 text-[10.5px] ${SOURCE_BADGE[it.source]}`}>
                        {SOURCE_LABEL[it.source]}
                      </span>
                    </td>
                    <td className="px-3 py-2 font-mono text-[11px] text-neutral-500 dark:text-neutral-400">
                      {it.path ?? "—"}
                    </td>
                    <td className="px-3 py-2 text-neutral-500">{it.enabled ? "启用" : "停用"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {/* 另一类：MCP（server） */}
        <section>
          <div className="mb-2 flex items-center gap-1.5">
            <Plug className="h-3.5 w-3.5 text-neutral-500" />
            <h3 className="text-[12.5px] font-medium text-neutral-700 dark:text-neutral-200">MCP（server）</h3>
            <span className="text-[11px] text-neutral-400">{mcpServers.length} 项</span>
          </div>
          <p className="mb-2 text-[11.5px] text-neutral-400">
            扫描 ~/.pi/agent/mcp.json（全局）+ 项目 .mcp.json。增删 MCP 请改对应配置（本页只读）。环境变量仅显示变量名、不显示值。
          </p>
          <div className="overflow-hidden rounded border border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-950">
            <table className="w-full text-[12px]">
              <thead className="bg-neutral-50 text-neutral-500 dark:bg-neutral-900 dark:text-neutral-400">
                <tr>
                  <th className="px-3 py-2 text-left font-normal">MCP</th>
                  <th className="px-3 py-2 text-left font-normal">来源</th>
                  <th className="px-3 py-2 text-left font-normal">传输</th>
                  <th className="px-3 py-2 text-left font-normal">命令 / URL</th>
                  <th className="px-3 py-2 text-left font-normal">环境变量</th>
                  <th className="px-3 py-2 text-left font-normal">状态</th>
                </tr>
              </thead>
              <tbody>
                {mcpServers.length === 0 && !loading && (
                  <tr>
                    <td colSpan={6} className="px-3 py-8 text-center text-neutral-400">
                      未发现 MCP server
                    </td>
                  </tr>
                )}
                {mcpServers.map((it) => (
                  <tr key={it.id} className="border-t border-neutral-100 dark:border-neutral-800">
                    <td className="px-3 py-2 font-mono text-neutral-700 dark:text-neutral-200">{it.name}</td>
                    <td className="px-3 py-2">
                      <span className={`rounded px-1.5 py-0.5 text-[10.5px] ${MCP_SOURCE_BADGE[it.source]}`}>
                        {MCP_SOURCE_LABEL[it.source]}
                      </span>
                    </td>
                    <td className="px-3 py-2">
                      <span className={`rounded px-1.5 py-0.5 text-[10.5px] ${TRANSPORT_BADGE[it.transport]}`}>
                        {it.transport}
                      </span>
                    </td>
                    <td className="px-3 py-2 font-mono text-[11px] text-neutral-500 dark:text-neutral-400">
                      {it.detail || "—"}
                    </td>
                    <td className="px-3 py-2 font-mono text-[11px] text-neutral-400">
                      {it.envKeys.length > 0 ? it.envKeys.join(", ") : "—"}
                    </td>
                    <td className="px-3 py-2 text-neutral-500">{it.enabled ? "启用" : "停用"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </div>
  );
}
