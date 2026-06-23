import { useState } from "react";
import { Download, Loader2 } from "lucide-react";
import { api } from "@/lib/api";
import type { SchemaTable } from "@/types";

interface Props {
  connId: string;
  tables: SchemaTable[] | null;
  workspaceId: string | null;
}

function downloadBlob(content: string, filename: string, mime: string) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function SqlTableExportPanel({ connId, tables, workspaceId }: Props) {
  const [tableName, setTableName] = useState("");
  const [format, setFormat] = useState<"csv" | "json">("csv");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [lastExport, setLastExport] = useState<{ tableName: string; rowCount?: number } | null>(null);

  const doExport = async () => {
    if (!tableName) { setError("\u8bf7\u9009\u62e9\u8868"); return; }
    setLoading(true); setError(""); setLastExport(null);
    try {
      const result = await api.exportSqlTable(connId, tableName, format, workspaceId ?? undefined);
      const safeName = tableName.replace(/[^a-zA-Z0-9_\u4e00-\u9fff]/g, "_");
      if (format === "csv" && typeof result === "string") {
        downloadBlob(result, `${safeName}.csv`, "text/csv;charset=utf-8");
        setLastExport({ tableName });
      } else if (typeof result === "object") {
        const text = JSON.stringify(result.rows, null, 2);
        downloadBlob(text, `${safeName}.json`, "application/json");
        setLastExport({ tableName, rowCount: result.rowCount });
      }
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-3 rounded-lg border border-neutral-200 bg-white p-4 text-[12px] dark:border-neutral-800 dark:bg-neutral-900">
      <div className="flex items-center gap-2">
        <h3 className="text-[13px] font-semibold">\u8868\u5bfc\u51fa</h3>
        <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-400">L1 \u00b7 \u53ea\u8bfb</span>
      </div>
      <p className="text-[11px] text-neutral-500">\u9009\u4e2d\u4e00\u4e2a\u8868\u76f4\u63a5\u5bfc\u51fa\u4e3a CSV / JSON\uff0c\u4e0b\u8f7d\u5230\u672c\u5730\u3002</p>
      <div className="grid grid-cols-[1fr_auto_auto] items-end gap-2">
        <label className="block">
          <span className="font-medium">\u9009\u62e9\u8868</span>
          <select value={tableName} onChange={(e) => setTableName(e.target.value)}
            className="mt-1 h-8 w-full rounded border border-neutral-200 bg-transparent px-2 font-mono text-[11px] dark:border-neutral-700">
            <option value="">-- \u9009\u62e9 --</option>
            {(tables ?? []).map((t) => (
              <option key={(t.schema ? t.schema + "." : "") + t.name} value={t.name}>
                {t.schema ? `${t.schema}.${t.name}` : t.name} ({t.columns.length} \u5217)
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="font-medium">\u683c\u5f0f</span>
          <select value={format} onChange={(e) => setFormat(e.target.value as "csv" | "json")}
            className="mt-1 h-8 rounded border border-neutral-200 bg-transparent px-2 text-[11px] dark:border-neutral-700">
            <option value="csv">CSV</option>
            <option value="json">JSON</option>
          </select>
        </label>
        <button onClick={() => void doExport()} disabled={loading || !tableName}
          className="inline-flex h-8 items-center gap-1.5 rounded-md bg-neutral-900 px-3 font-medium text-white disabled:opacity-50 dark:bg-neutral-100 dark:text-neutral-900">
          {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
          \u5bfc\u51fa
        </button>
      </div>
      {error && <p className="rounded bg-red-50 px-2 py-1.5 text-red-600 dark:bg-red-950/30 dark:text-red-300">{error}</p>}
      {lastExport && (
        <p className="text-[11px] text-emerald-600 dark:text-emerald-400">
          \u2713 \u5bfc\u51fa\u5b8c\u6210 \u00b7 {lastExport.tableName}
          {lastExport.rowCount !== undefined ? ` (${lastExport.rowCount} \u884c)` : ""}
        </p>
      )}
    </div>
  );
}
