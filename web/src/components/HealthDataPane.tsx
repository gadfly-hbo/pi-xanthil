import { useEffect, useState } from "react";
import { dataApi } from "@/lib/api/data";
import { api } from "@/lib/api";
import type { BiAggregationDataset, ExtractionTool, SqlConnection } from "@/types";

export function HealthDataPane({ workspaceId }: { workspaceId: string | null }) {
  const [datasets, setDatasets] = useState<BiAggregationDataset[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 接入更多：SQL 导出
  const [sqlConns, setSqlConns] = useState<SqlConnection[]>([]);
  const [sqlConnId, setSqlConnId] = useState("");
  const [sqlText, setSqlText] = useState("SELECT * FROM ...");
  const [sqlExportPath, setSqlExportPath] = useState("");
  const [sqlBusy, setSqlBusy] = useState(false);

  // 接入更多：数据提取
  const [tools, setTools] = useState<ExtractionTool[]>([]);
  const [toolId, setToolId] = useState("");
  const [toolInput, setToolInput] = useState("");
  const [toolOutput, setToolOutput] = useState("");
  const [toolBusy, setToolBusy] = useState(false);

  useEffect(() => {
    if (!workspaceId) return;
    setLoading(true);
    dataApi.getBiAggregations(workspaceId)
      .then(setDatasets)
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false));
    // 拉取 SQL 连接 + 提取工具列表（复用 D 域既有端点）
    api.listSqlConnections().then(setSqlConns).catch(() => {});
    dataApi.listExtractionTools().then(setTools).catch(() => {});
  }, [workspaceId]);

  const refresh = () => {
    if (!workspaceId) return;
    dataApi.getBiAggregations(workspaceId).then(setDatasets).catch(() => {});
  };

  const doSqlExport = async () => {
    if (!workspaceId || !sqlConnId || !sqlText || !sqlExportPath) return;
    setSqlBusy(true);
    try {
      const result = await api.exportSql(sqlConnId, sqlText, sqlExportPath, undefined, undefined, workspaceId);
      // 登记规范化路径（result.path）到 clean_data
      await api.addWorkspacePath(workspaceId, "clean_data", result.path, "file");
      refresh();
      setError(null);
    } catch (e) {
      setError(String(e));
    } finally {
      setSqlBusy(false);
    }
  };

  const doToolRun = async () => {
    if (!workspaceId || !toolId || !toolInput || !toolOutput) return;
    setToolBusy(true);
    try {
      const run = await dataApi.runExtractionTool(toolId, toolInput, toolOutput, undefined, workspaceId);
      // 读 results[].outputs，过滤表格文件逐个登记到 clean_data
      const TABULAR = new Set([".csv", ".tsv", ".xlsx", ".xls"]);
      const outputs = new Set<string>();
      for (const r of run.results ?? []) {
        for (const out of r.outputs ?? []) {
          const lower = out.toLowerCase();
          if (TABULAR.has(lower.slice(lower.lastIndexOf(".")))) {
            outputs.add(out);
          }
        }
      }
      const regErrors: string[] = [];
      for (const p of outputs) {
        try {
          await api.addWorkspacePath(workspaceId, "clean_data", p, "file");
        } catch (e) {
          regErrors.push(`${p}: ${String(e)}`);
        }
      }
      if (regErrors.length > 0) {
        setError(`部分产物登记失败: ${regErrors.join("; ")}`);
      } else {
        setError(null);
      }
      refresh();
    } catch (e) {
      setError(String(e));
    } finally {
      setToolBusy(false);
    }
  };
  return (
    <div className="p-4 space-y-4 max-w-3xl">
      <div>
        <h2 className="text-lg font-semibold">聚合数据入口</h2>
        <p className="text-sm text-neutral-500 mt-1">
          体检消费已登记的 clean_data 聚合集。下方可接入更多数据源（SQL 导出 / 数据提取）。
        </p>
      </div>

      {loading && <p className="text-sm text-neutral-400">加载中…</p>}
      {error && <p className="text-sm text-red-500">{error}</p>}

      {/* 已登记聚合数据列表 */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <label className="text-sm font-medium">已登记聚合数据（{datasets.length}）</label>
          <button onClick={refresh} className="text-xs text-blue-500 hover:underline">刷新</button>
        </div>
        {datasets.map((ds) => (
          <div key={ds.pathId} className="border rounded-lg p-3">
            <p className="font-medium text-sm">{ds.name}</p>
            <p className="text-xs text-neutral-400 mt-0.5">
              {ds.rowCount} 行 · {ds.columns.length} 列 · pathId={ds.pathId}
            </p>
          </div>
        ))}
        {datasets.length === 0 && !loading && (
          <p className="text-sm text-neutral-400">暂无聚合数据。使用下方入口接入。</p>
        )}
      </div>

      {/* SQL 导出 → clean_data */}
      <details className="border rounded-lg p-3">
        <summary className="text-sm font-medium cursor-pointer">SQL 导出 → 聚合数据</summary>
        <div className="mt-2 space-y-2">
          <select value={sqlConnId} onChange={(e) => setSqlConnId(e.target.value)} className="w-full text-sm border rounded px-2 py-1">
            <option value="">选择 SQL 连接…</option>
            {sqlConns.map((c) => <option key={c.id} value={c.id}>{c.name} ({c.type})</option>)}
          </select>
          <textarea value={sqlText} onChange={(e) => setSqlText(e.target.value)} rows={3}
            className="w-full text-xs font-mono border rounded px-2 py-1" placeholder="SELECT ..." />
          <input value={sqlExportPath} onChange={(e) => setSqlExportPath(e.target.value)}
            className="w-full text-sm border rounded px-2 py-1" placeholder="输出路径（如 /Users/.../clean_data/export.csv）" />
          <button onClick={doSqlExport} disabled={sqlBusy || !sqlConnId || !sqlText || !sqlExportPath}
            className="text-sm px-3 py-1 bg-blue-600 text-white rounded disabled:opacity-40">
            {sqlBusy ? "导出中…" : "导出"}
          </button>
        </div>
      </details>

      {/* 数据提取 → clean_data */}
      <details className="border rounded-lg p-3">
        <summary className="text-sm font-medium cursor-pointer">数据提取 → 聚合数据</summary>
        <div className="mt-2 space-y-2">
          <select value={toolId} onChange={(e) => setToolId(e.target.value)} className="w-full text-sm border rounded px-2 py-1">
            <option value="">选择提取工具…</option>
            {tools.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
          <input value={toolInput} onChange={(e) => setToolInput(e.target.value)}
            className="w-full text-sm border rounded px-2 py-1" placeholder="输入路径" />
          <input value={toolOutput} onChange={(e) => setToolOutput(e.target.value)}
            className="w-full text-sm border rounded px-2 py-1" placeholder="输出目录" />
          <button onClick={doToolRun} disabled={toolBusy || !toolId || !toolInput || !toolOutput}
            className="text-sm px-3 py-1 bg-blue-600 text-white rounded disabled:opacity-40">
            {toolBusy ? "运行中…" : "运行"}
          </button>
        </div>
      </details>
    </div>
  );
}
