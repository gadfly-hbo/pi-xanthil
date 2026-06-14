import { useCallback, useEffect, useState } from "react";
import { Puzzle, RefreshCw } from "lucide-react";
import { api } from "@/lib/api";
import type { PluginInfo } from "@/lib/api/data";

/**
 * 计算工具·插件管理（pi 已加载扩展/包 一览，只读）。
 *
 * 原为 hooks 管理里的「已加载扩展」视图，按职责拆出：扩展/包 = pi 插件（plugin），
 * 与 hooks（生命周期护栏/传感器）是两回事。扫 ~/.pi/agent/settings.json 的
 * packages[]/extensions[] + global(~/.pi/agent/extensions/) + project(.pi/extensions/)。
 * 纯只读，不读扩展实现内容、不调任何 LLM。
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

export function PluginManagementPane() {
  const [items, setItems] = useState<PluginInfo[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const reload = useCallback(() => {
    setLoading(true);
    setError("");
    api
      .listPlugins()
      .then(setItems)
      .catch((err) => setError(String(err)))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => reload(), [reload]);

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-neutral-200 bg-white px-4 py-2.5 dark:border-neutral-800 dark:bg-neutral-950">
        <Puzzle className="h-4 w-4 text-neutral-500" />
        <h2 className="text-[13px] font-medium text-neutral-700 dark:text-neutral-200">计算工具 · 插件管理</h2>
        <span className="text-[11px] text-neutral-400">pi 已加载扩展 / 包（只读）</span>
        <button
          onClick={reload}
          disabled={loading}
          className="ml-auto flex items-center gap-1 rounded border border-neutral-200 px-2 py-1 text-[11.5px] text-neutral-600 hover:bg-neutral-100 disabled:opacity-50 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
          刷新
        </button>
      </div>

      <div className="flex-1 overflow-auto bg-neutral-50 p-4 dark:bg-neutral-900">
        <p className="mb-3 text-[11.5px] text-neutral-400">
          扫描 settings.json packages / 全局 / 项目目录。增删插件请改 pi settings 或对应目录（本页只读）。
        </p>

        {error && (
          <div className="mb-3 rounded border border-red-300 bg-red-50 px-3 py-2 text-[12px] text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
            {error}
          </div>
        )}

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
              {items.length === 0 && !loading && (
                <tr>
                  <td colSpan={4} className="px-3 py-8 text-center text-neutral-400">
                    未发现插件
                  </td>
                </tr>
              )}
              {items.map((it) => (
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
      </div>
    </div>
  );
}
