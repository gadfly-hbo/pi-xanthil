import { useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import * as XLSX from "xlsx";
import { api } from "@/lib/api";
import type { DbType, SqlImportPreview } from "@/types";

interface Props {
  connId: string;
  connType: DbType;
  workspaceId: string | null;
  onAfterCommit: () => void;
}

function parseFileToRows(file: File): Promise<{ rows: Record<string, unknown>[]; fileName: string }> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = e.target?.result;
        const lower = file.name.toLowerCase();
        let rows: Record<string, unknown>[] = [];
        if (lower.endsWith(".json")) {
          const text = typeof data === "string" ? data : new TextDecoder().decode(data as ArrayBuffer);
          const parsed = JSON.parse(text);
          if (!Array.isArray(parsed)) throw new Error("JSON must be an array");
          rows = parsed as Record<string, unknown>[];
        } else if (lower.endsWith(".csv") || lower.endsWith(".tsv")) {
          const text = typeof data === "string" ? data : new TextDecoder().decode(data as ArrayBuffer);
          const wb = XLSX.read(text.replace(/^\uFEFF/, ""), { type: "string" });
          const sheet = wb.Sheets[wb.SheetNames[0]!]!;
          rows = XLSX.utils.sheet_to_json(sheet, { defval: null }) as Record<string, unknown>[];
        } else {
          const wb = XLSX.read(data, { type: "array" });
          const sheet = wb.Sheets[wb.SheetNames[0]!]!;
          rows = XLSX.utils.sheet_to_json(sheet, { defval: null }) as Record<string, unknown>[];
        }
        resolve({ rows, fileName: file.name });
      } catch (err) { reject(err); }
    };
    reader.onerror = () => reject(new Error("file read failed"));
    if (/\.(csv|tsv|json)$/i.test(file.name)) reader.readAsText(file);
    else reader.readAsArrayBuffer(file);
  });
}

export function SqlImportPanel({ connId, connType, workspaceId, onAfterCommit }: Props) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [rows, setRows] = useState<Record<string, unknown>[]>([]);
  const [preview, setPreview] = useState<SqlImportPreview | null>(null);
  const [editedCols, setEditedCols] = useState<{ sourceName: string; name: string; type: string }[]>([]);
  const [tableName, setTableName] = useState("");
  const [mode, setMode] = useState<"create" | "append">("create");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [committed, setCommitted] = useState<{ tableName: string; rowCount: number } | null>(null);

  const reset = () => {
    setFile(null); setRows([]); setPreview(null); setEditedCols([]);
    setTableName(""); setMode("create"); setError(""); setCommitted(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const onFileChosen = async (f: File) => {
    setError(""); setCommitted(null); setFile(f); setLoading(true);
    try {
      const parsed = await parseFileToRows(f);
      setRows(parsed.rows);
      const previewResp = await api.previewSqlImport(connId, parsed.rows, parsed.fileName);
      setPreview(previewResp);
      setEditedCols(previewResp.columns.map((c) => ({ sourceName: c.sourceName, name: c.name, type: c.type })));
      const guess = f.name.replace(/\.[^.]+$/, "").replace(/[^a-zA-Z0-9_\u4e00-\u9fff]/g, "_");
      setTableName(guess || "imported_table");
    } catch (err) {
      setError(String(err)); setPreview(null);
    } finally { setLoading(false); }
  };

  const commit = async () => {
    if (!preview || !tableName.trim() || rows.length === 0) return;
    const action = mode === "create" ? "\u521b\u5efa\u65b0\u8868" : "\u8ffd\u52a0\u5199\u5165";
    if (!confirm(`\u786e\u8ba4${action} "${tableName.trim()}" \u5e76\u5199\u5165 ${rows.length} \u884c\uff1f`)) return;
    setLoading(true); setError("");
    try {
      const result = await api.commitSqlImport(connId, {
        tableName: tableName.trim(),
        columns: editedCols, rows, mode,
        workspaceId: workspaceId ?? undefined,
      });
      setCommitted({ tableName: result.tableName, rowCount: result.rowCount });
      onAfterCommit();
    } catch (err) { setError(String(err)); }
    finally { setLoading(false); }
  };

  if (connType !== "sqlite") {
    return (
      <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-[12px] text-amber-700 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-300">
        \u5f53\u524d\u7248\u672c\u4ec5 SQLite \u652f\u6301\u6587\u4ef6\u5bfc\u5165\u5efa\u8868\u3002PostgreSQL / MySQL \u5199\u5165\u652f\u6301\u5728\u540e\u7eed\u7248\u672c\u63d0\u4f9b\u3002
      </div>
    );
  }

  return (
    <div className="space-y-3 rounded-lg border border-neutral-200 bg-white p-4 text-[12px] dark:border-neutral-800 dark:bg-neutral-900">
      <div className="flex items-center gap-2">
        <h3 className="text-[13px] font-semibold">\u5bfc\u5165\u6587\u4ef6\u5efa\u8868 / \u8ffd\u52a0</h3>
        <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-700 dark:bg-amber-950/30 dark:text-amber-400">L2 \u00b7 \u5199\u5165\u6570\u636e\u5e93</span>
      </div>
      <p className="text-[11px] text-neutral-500">
        \u652f\u6301 .csv / .tsv / .xlsx / .xls / .json\uff1bJSON \u9700\u4e3a\u5bf9\u8c61\u6570\u7ec4\u3002\u6587\u4ef6\u5728\u6d4f\u89c8\u5668\u89e3\u6790\u540e\u4f20\u7ed9\u540e\u7aef\uff0c\u4e8b\u52a1\u5316\u5199\u5165\u5931\u8d25\u56de\u6eda\u3002
      </p>

      <div className="flex items-center gap-2">
        <input ref={fileInputRef} type="file" accept=".csv,.tsv,.xlsx,.xls,.json"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) void onFileChosen(f); }}
          className="text-[11px]" />
        {file && <button onClick={reset} className="text-[11px] text-neutral-500 hover:text-neutral-800 dark:hover:text-neutral-200">\u91cd\u9009</button>}
      </div>

      {loading && <p className="flex items-center gap-1.5 text-[11px] text-neutral-500"><Loader2 className="h-3 w-3 animate-spin" /> \u5904\u7406\u4e2d\u2026</p>}
      {error && <p className="rounded bg-red-50 px-2 py-1.5 text-red-600 dark:bg-red-950/30 dark:text-red-300">{error}</p>}

      {preview && !committed && (
        <>
          <div className="flex items-center gap-3 text-[11px] text-neutral-500">
            <span>\u603b\u884c\u6570\uff1a<strong className="text-neutral-700 dark:text-neutral-300">{preview.totalRows}</strong></span>
            <span>\u5217\u6570\uff1a<strong className="text-neutral-700 dark:text-neutral-300">{preview.columns.length}</strong></span>
          </div>
          {preview.risks.length > 0 && (
            <div className="rounded border border-amber-200 bg-amber-50 px-3 py-2 text-amber-700 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-300">
              <p className="font-medium">\u26a0 \u98ce\u9669\u63d0\u793a</p>
              <ul className="ml-4 list-disc">
                {preview.risks.map((r, i) => <li key={i}>{r}</li>)}
              </ul>
            </div>
          )}
          <div className="space-y-2">
            <h4 className="font-medium text-neutral-700 dark:text-neutral-300">\u5b57\u6bb5\u786e\u8ba4</h4>
            <div className="max-h-60 overflow-auto rounded border border-neutral-200 dark:border-neutral-700">
              <table className="w-full text-[11px]">
                <thead className="sticky top-0 bg-neutral-50 dark:bg-neutral-800">
                  <tr>
                    <th className="px-2 py-1.5 text-left font-medium">\u5217\u540d</th>
                    <th className="px-2 py-1.5 text-left font-medium">\u7c7b\u578b</th>
                    <th className="px-2 py-1.5 text-left font-medium">\u6837\u672c</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.columns.map((c, i) => (
                    <tr key={c.name + i} className="border-t border-neutral-100 dark:border-neutral-800">
                      <td className="px-2 py-1">
                        <input value={editedCols[i]?.name ?? c.name}
                          onChange={(e) => { const next = [...editedCols]; next[i] = { sourceName: next[i]?.sourceName ?? c.sourceName, name: e.target.value, type: next[i]?.type ?? c.type }; setEditedCols(next); }}
                          className="h-6 w-full rounded border border-neutral-200 bg-transparent px-1.5 font-mono text-[11px] dark:border-neutral-700" />
                      </td>
                      <td className="px-2 py-1">
                        <select value={editedCols[i]?.type ?? c.type}
                          onChange={(e) => { const next = [...editedCols]; next[i] = { sourceName: next[i]?.sourceName ?? c.sourceName, name: next[i]?.name ?? c.name, type: e.target.value }; setEditedCols(next); }}
                          className="h-6 rounded border border-neutral-200 bg-transparent px-1 text-[11px] dark:border-neutral-700">
                          <option value="TEXT">TEXT</option>
                          <option value="INTEGER">INTEGER</option>
                          <option value="REAL">REAL</option>
                        </select>
                      </td>
                      <td className="max-w-[24rem] truncate px-2 py-1 font-mono text-[10px] text-neutral-500">{c.sample.join(" \u00b7 ")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          <div className="grid grid-cols-[1fr_auto] items-end gap-2">
            <label className="block">
              <span className="font-medium">\u76ee\u6807\u8868\u540d</span>
              <input value={tableName} onChange={(e) => setTableName(e.target.value)}
                className="mt-1 h-8 w-full rounded border border-neutral-200 bg-transparent px-2 font-mono text-[11px] outline-none focus:border-neutral-400 dark:border-neutral-700"
                placeholder="my_table" />
            </label>
            <div className="flex flex-col">
              <span className="mb-1 font-medium">\u5bfc\u5165\u6a21\u5f0f</span>
              <div className="flex gap-2">
                <label className="flex items-center gap-1"><input type="radio" checked={mode === "create"} onChange={() => setMode("create")} /><span>\u65b0\u5efa</span></label>
                <label className="flex items-center gap-1"><input type="radio" checked={mode === "append"} onChange={() => setMode("append")} /><span>\u8ffd\u52a0</span></label>
              </div>
            </div>
          </div>
          <button onClick={() => void commit()} disabled={loading}
            className="inline-flex items-center gap-1.5 rounded-md bg-neutral-900 px-3 py-2 font-medium text-white disabled:opacity-50 dark:bg-neutral-100 dark:text-neutral-900">
            {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
            {loading ? "\u6267\u884c\u4e2d\u2026" : "\u786e\u8ba4\u5bfc\u5165"}
          </button>
        </>
      )}

      {committed && (
        <div className="rounded bg-emerald-50 px-3 py-2 dark:bg-emerald-950/30">
          <p className="font-medium text-emerald-700 dark:text-emerald-400">
            \u5bfc\u5165\u6210\u529f\uff1a{committed.rowCount} \u884c \u2192 {committed.tableName}
          </p>
        </div>
      )}
    </div>
  );
}
