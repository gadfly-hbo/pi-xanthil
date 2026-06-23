import { useCallback, useEffect, useState } from "react";
import { ChevronDown, ChevronRight, DatabaseZap, FolderOpen, Loader2, Play, Plus, RefreshCw, Save, ShieldCheck, ShieldAlert, Trash2, Wifi, WifiOff } from "lucide-react";
import { cn } from "@/lib/cn";
import { api } from "@/lib/api";
import { SqlImportPanel } from "./sql/SqlImportPanel";
import { SqlTableExportPanel } from "./sql/SqlTableExportPanel";
import type { DbType, SavedQuery, SchemaTable, SqlConnection, SqlQueryResult, SqlValidateResult, ToolParameter } from "@/types";

// ---- Connection Form ----

const DB_LABELS: Record<DbType, string> = { sqlite: "SQLite（本地文件）", postgresql: "PostgreSQL", mysql: "MySQL / MariaDB" };
const DEFAULT_PORTS: Record<DbType, number> = { sqlite: 0, postgresql: 5432, mysql: 3306 };

type FormData = {
  name: string; type: DbType;
  filePath: string; host: string; port: string; database: string; username: string; password: string; ssl: boolean;
};

const emptyForm = (): FormData => ({ name: "", type: "postgresql", filePath: "", host: "localhost", port: "5432", database: "", username: "", password: "", ssl: false });

function fromConn(c: SqlConnection): FormData {
  return { name: c.name, type: c.type, filePath: c.filePath ?? "", host: c.host ?? "localhost", port: String(c.port ?? DEFAULT_PORTS[c.type]), database: c.database ?? "", username: c.username ?? "", password: c.password ?? "", ssl: c.ssl ?? false };
}

interface ConnFormProps { initial?: SqlConnection; onSave: (data: Omit<SqlConnection, "id" | "createdAt">) => Promise<void>; onCancel: () => void }

function ConnForm({ initial, onSave, onCancel }: ConnFormProps) {
  const [form, setForm] = useState<FormData>(initial ? fromConn(initial) : emptyForm());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const set = (key: keyof FormData, val: string | boolean) => {
    setForm((prev) => {
      const next = { ...prev, [key]: val };
      if (key === "type") next.port = String(DEFAULT_PORTS[val as DbType]);
      return next;
    });
  };

  const submit = async () => {
    if (!form.name.trim()) { setError("请填写连接名称"); return; }
    setSaving(true); setError("");
    try {
      const data: Omit<SqlConnection, "id" | "createdAt"> = {
        name: form.name.trim(), type: form.type,
        filePath: form.type === "sqlite" ? form.filePath.trim() : undefined,
        host: form.type !== "sqlite" ? form.host.trim() : undefined,
        port: form.type !== "sqlite" ? Number(form.port) || DEFAULT_PORTS[form.type] : undefined,
        database: form.type !== "sqlite" ? form.database.trim() : undefined,
        username: form.type !== "sqlite" ? form.username.trim() : undefined,
        password: form.type !== "sqlite" ? form.password : undefined,
        ssl: form.type !== "sqlite" ? form.ssl : undefined,
      };
      await onSave(data);
    } catch (err) { setError(String(err)); } finally { setSaving(false); }
  };

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-neutral-200 bg-white p-4 text-[12px] dark:border-neutral-800 dark:bg-neutral-900">
      <h3 className="text-[13px] font-semibold">{initial ? "编辑连接" : "新建连接"}</h3>

      <label className="block"><span className="font-medium">连接名称</span>
        <input value={form.name} onChange={(e) => set("name", e.target.value)} className="mt-1 h-8 w-full rounded border border-neutral-200 bg-transparent px-2 outline-none focus:border-neutral-400 dark:border-neutral-700" placeholder="我的数据库" />
      </label>

      <label className="block"><span className="font-medium">数据库类型</span>
        <select value={form.type} onChange={(e) => set("type", e.target.value)} className="mt-1 h-8 w-full rounded border border-neutral-200 bg-transparent px-2 dark:border-neutral-700">
          {(Object.keys(DB_LABELS) as DbType[]).map((t) => <option key={t} value={t}>{DB_LABELS[t]}</option>)}
        </select>
      </label>

      {form.type === "sqlite" ? (
        <label className="block"><span className="font-medium">SQLite 文件路径</span>
          <div className="mt-1 flex gap-2">
            <input value={form.filePath} onChange={(e) => set("filePath", e.target.value)} className="min-w-0 flex-1 h-8 rounded border border-neutral-200 bg-transparent px-2 font-mono text-[11px] outline-none focus:border-neutral-400 dark:border-neutral-700" placeholder="/path/to/db.sqlite" />
            <button onClick={() => api.pickLocalPath("file").then(({ path }) => set("filePath", path)).catch(() => undefined)} className="rounded border border-neutral-200 px-2.5 dark:border-neutral-700" title="选择已有文件"><FolderOpen className="h-3.5 w-3.5" /></button>
            <button
              type="button"
              onClick={async () => {
                const path = form.filePath.trim();
                if (!path) { setError("请先填写新文件路径（如 /tmp/mydb.db）"); return; }
                try {
                  await api.createSqliteDb(path);
                  setError("");
                } catch (err) {
                  setError(String(err));
                }
              }}
              className="rounded border border-emerald-200 px-2 text-[11px] text-emerald-600 dark:border-emerald-900 dark:text-emerald-400"
              title="按当前路径新建空 .db 文件"
            >新建库</button>
          </div>
          <p className="mt-1 text-[10px] text-neutral-500">选已有 .db 直接连；填入新路径再点「新建库」即创建空库后保存连接。</p>
        </label>
      ) : (
        <>
          <div className="grid grid-cols-[1fr_6rem] gap-2">
            <label className="block"><span className="font-medium">主机</span><input value={form.host} onChange={(e) => set("host", e.target.value)} className="mt-1 h-8 w-full rounded border border-neutral-200 bg-transparent px-2 font-mono text-[11px] outline-none focus:border-neutral-400 dark:border-neutral-700" /></label>
            <label className="block"><span className="font-medium">端口</span><input value={form.port} onChange={(e) => set("port", e.target.value)} className="mt-1 h-8 w-full rounded border border-neutral-200 bg-transparent px-2 font-mono text-[11px] outline-none focus:border-neutral-400 dark:border-neutral-700" /></label>
          </div>
          <label className="block"><span className="font-medium">数据库名</span><input value={form.database} onChange={(e) => set("database", e.target.value)} className="mt-1 h-8 w-full rounded border border-neutral-200 bg-transparent px-2 font-mono text-[11px] outline-none focus:border-neutral-400 dark:border-neutral-700" /></label>
          <div className="grid grid-cols-2 gap-2">
            <label className="block"><span className="font-medium">用户名</span><input value={form.username} onChange={(e) => set("username", e.target.value)} className="mt-1 h-8 w-full rounded border border-neutral-200 bg-transparent px-2 font-mono text-[11px] outline-none focus:border-neutral-400 dark:border-neutral-700" /></label>
            <label className="block"><span className="font-medium">密码</span><input type="password" value={form.password} onChange={(e) => set("password", e.target.value)} className="mt-1 h-8 w-full rounded border border-neutral-200 bg-transparent px-2 outline-none focus:border-neutral-400 dark:border-neutral-700" /></label>
          </div>
          <label className="flex items-center gap-2 cursor-pointer"><input type="checkbox" checked={form.ssl} onChange={(e) => set("ssl", e.target.checked)} /><span>启用 SSL</span></label>
        </>
      )}

      {error && <p className="rounded bg-red-50 px-2 py-1.5 text-red-600 dark:bg-red-950/30 dark:text-red-300">{error}</p>}

      <div className="flex justify-end gap-2 pt-1">
        <button onClick={onCancel} className="h-8 rounded px-3 text-neutral-500 hover:bg-neutral-100 dark:hover:bg-neutral-800">取消</button>
        <button onClick={() => void submit()} disabled={saving} className="h-8 rounded bg-neutral-900 px-3 font-medium text-white disabled:opacity-50 dark:bg-neutral-100 dark:text-neutral-900">
          {saving ? "保存中…" : "保存"}
        </button>
      </div>
    </div>
  );
}

// ---- Schema Panel ----

function SchemaPanel({ tables }: { tables: SchemaTable[] }) {
  const [open, setOpen] = useState<Set<string>>(new Set());
  const toggle = (name: string) => setOpen((s) => { const n = new Set(s); n.has(name) ? n.delete(name) : n.add(name); return n; });
  if (tables.length === 0) return <p className="py-4 text-center text-[12px] text-neutral-400">无可用表</p>;

  const grouped = new Map<string, SchemaTable[]>();
  for (const t of tables) {
    const s = t.schema || "default";
    if (!grouped.has(s)) grouped.set(s, []);
    grouped.get(s)!.push(t);
  }
  const schemas = Array.from(grouped.keys()).sort();

  return (
    <div className="space-y-2">
      {schemas.map((s) => (
        <div key={s}>
          {schemas.length > 1 && (
            <div className="flex items-center gap-1.5 px-2 py-1 text-[11px] font-semibold text-neutral-500 uppercase tracking-wider">
              {s}
            </div>
          )}
          <div className="space-y-0.5">
            {grouped.get(s)!.map((t) => {
              const id = t.schema ? `${t.schema}.${t.name}` : t.name;
              return (
                <div key={id}>
                  <button onClick={() => toggle(id)} className="flex w-full items-center gap-1.5 rounded px-2 py-1 text-left text-[12px] hover:bg-neutral-50 dark:hover:bg-neutral-800">
                    {open.has(id) ? <ChevronDown className="h-3 w-3 shrink-0" /> : <ChevronRight className="h-3 w-3 shrink-0" />}
                    <span className="min-w-0 truncate font-mono">{t.name}</span>
                    <span className="ml-auto shrink-0 text-[10px] text-neutral-400">{t.columns.length}</span>
                  </button>
                  {open.has(id) && (
                    <div className="ml-5 border-l border-neutral-100 pl-2 dark:border-neutral-800">
                      {t.columns.map((c) => (
                        <div key={c.name} className="flex items-center gap-2 py-0.5 text-[11px]">
                          <span className="min-w-0 truncate font-mono text-neutral-700 dark:text-neutral-300">{c.name}</span>
                          <span className="ml-auto shrink-0 text-neutral-400">{c.type}</span>
                          {!c.nullable && <span className="shrink-0 text-amber-500">NN</span>}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

// ---- Result Table ----

function ResultTable({ result }: { result: SqlQueryResult }) {
  return (
    <div className="overflow-auto">
      <div className="mb-1.5 flex items-center gap-3 text-[11px] text-neutral-500">
        <span>{result.rowCount.toLocaleString()} 行</span>
        {result.capped && <span className="text-amber-600">预览已截断至 500 行</span>}
        <span>{result.executionMs} ms</span>
      </div>
      <table className="w-full whitespace-nowrap text-left text-[12px]">
        <thead className="sticky top-0 bg-white dark:bg-neutral-900">
          <tr>{result.columns.map((col) => <th key={col} className="border-b border-neutral-200 px-2 py-1.5 font-mono font-medium dark:border-neutral-700">{col}</th>)}</tr>
        </thead>
        <tbody>
          {result.rows.map((row, i) => (
            <tr key={i} className="border-b border-neutral-100 dark:border-neutral-800">
              {result.columns.map((col) => <td key={col} className="max-w-[24rem] truncate px-2 py-1.5 font-mono">{row[col] === null ? <span className="text-neutral-400">NULL</span> : String(row[col])}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ---- Export Panel ----

interface ExportPanelProps { connId: string; sql: string; params?: Record<string, string>; workspaceId: string | null }

function ExportPanel({ connId, sql, params, workspaceId }: ExportPanelProps) {
  const [folder, setFolder] = useState<"draw_data" | "clean_data">("draw_data");
  const [outputDir, setOutputDir] = useState("");
  const [filename, setFilename] = useState(`export-${new Date().toISOString().slice(0, 10)}.csv`);
  const [useWatermark, setUseWatermark] = useState(false);
  const [watermarkColumn, setWatermarkColumn] = useState("updated_at");
  const [exporting, setExporting] = useState(false);
  const [result, setResult] = useState<{ path: string; rowCount: number; appended?: boolean } | null>(null);
  const [error, setError] = useState("");
  const [registering, setRegistering] = useState(false);
  const [registered, setRegistered] = useState(false);

  const [watermarkState, setWatermarkState] = useState<{ exists: boolean; lastWatermark?: unknown } | null>(null);
  const [initialWatermark, setInitialWatermark] = useState("");

  const refreshWatermarkState = useCallback((path: string) => {
    api.getExportState(path)
      .then(setWatermarkState)
      .catch(() => setWatermarkState(null));
  }, []);

  useEffect(() => {
    if (!outputDir || !filename.trim()) {
      setWatermarkState(null);
      return;
    }
    const path = outputDir.replace(/\/$/, "") + "/" + filename.trim();
    refreshWatermarkState(path);
  }, [outputDir, filename, refreshWatermarkState]);

  const resetWatermark = async () => {
    if (!outputDir || !filename.trim()) return;
    const path = outputDir.replace(/\/$/, "") + "/" + filename.trim();
    try {
      await api.updateExportState(path, null);
      refreshWatermarkState(path);
    } catch (err) {
      setError(String(err));
    }
  };

  const pickDir = async () => {
    const { path } = await api.pickLocalPath("dir");
    setOutputDir(path);
  };

  const doExport = async () => {
    if (!outputDir || !filename.trim()) { setError("请选择输出目录并填写文件名"); return; }
    setExporting(true); setError(""); setResult(null); setRegistered(false);
    try {
      const outputPath = outputDir.replace(/\/$/, "") + "/" + filename.trim();
      const res = await api.exportSql(
        connId,
        sql,
        outputPath,
        params,
        useWatermark && watermarkColumn.trim()
          ? {
              column: watermarkColumn.trim(),
              initialValue: (!watermarkState || !watermarkState.exists) ? initialWatermark.trim() || undefined : undefined
            }
          : undefined,
        workspaceId ?? undefined
      );
      setResult(res);
      refreshWatermarkState(outputPath);
    } catch (err) { setError(String(err)); } finally { setExporting(false); }
  };

  const registerPath = async () => {
    if (!result || !workspaceId) return;
    setRegistering(true);
    try {
      await api.addWorkspacePath(workspaceId, folder, result.path, "file");
      setRegistered(true);
    } catch (err) { setError(String(err)); } finally { setRegistering(false); }
  };

  return (
    <div className="space-y-3 rounded-lg border border-neutral-200 bg-white p-4 text-[12px] dark:border-neutral-800 dark:bg-neutral-900">
      <div className="flex items-center gap-2">
        <h3 className="text-[13px] font-semibold">导出 CSV 到工作区</h3>
        <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-700 dark:bg-amber-950/30 dark:text-amber-400">L2 · 需确认</span>
      </div>
      <p className="text-[11px] text-amber-600 dark:text-amber-400">
        导出操作将把查询结果写入本地文件。请确认输出路径和文件名无误。
      </p>

      <div className="flex gap-3">
        {(["draw_data", "clean_data"] as const).map((f) => (
          <label key={f} className="flex cursor-pointer items-center gap-1.5">
            <input type="radio" checked={folder === f} onChange={() => setFolder(f)} />
            <span className={f === "draw_data" ? "text-neutral-700 dark:text-neutral-300" : "text-amber-700 dark:text-amber-400"}>
              {f === "draw_data" ? "原始数据" : "聚合数据"}
            </span>
          </label>
        ))}
        {folder === "clean_data" && (
          <span className="text-[11px] text-amber-600 dark:text-amber-400">⚠ 该路径可被 LLM 读取，请勿放入明细</span>
        )}
      </div>

      <label className="block"><span className="font-medium">输出目录</span>
        <div className="mt-1 flex gap-2">
          <input value={outputDir} readOnly placeholder="请选择本地目录" className="min-w-0 flex-1 h-8 rounded border border-neutral-200 bg-transparent px-2 font-mono text-[11px] dark:border-neutral-700" />
          <button onClick={() => void pickDir()} className="rounded border border-neutral-200 px-2.5 dark:border-neutral-700"><FolderOpen className="h-3.5 w-3.5" /></button>
        </div>
      </label>

      <label className="block"><span className="font-medium">文件名</span>
        <input value={filename} onChange={(e) => setFilename(e.target.value)} className="mt-1 h-8 w-full rounded border border-neutral-200 bg-transparent px-2 font-mono text-[11px] outline-none focus:border-neutral-400 dark:border-neutral-700" />
      </label>

      <div className="flex flex-col gap-2 py-1">
        <label className="flex cursor-pointer items-center gap-1.5">
          <input type="checkbox" checked={useWatermark} onChange={(e) => setUseWatermark(e.target.checked)} />
          <span className="font-medium text-neutral-700 dark:text-neutral-300">增量导出 (Watermark)</span>
        </label>
        {useWatermark && (
          <div className="ml-5 flex flex-wrap items-center gap-2">
            <input value={watermarkColumn} onChange={(e) => setWatermarkColumn(e.target.value)} placeholder="水印字段 (如 id或updated_at)" className="h-8 w-40 rounded border border-neutral-200 bg-transparent px-2 font-mono text-[11px] outline-none focus:border-neutral-400 dark:border-neutral-700" />
            {watermarkState?.exists ? (
              <div className="flex items-center gap-2 text-[11px] text-neutral-500 bg-neutral-100 px-2 py-1 rounded dark:bg-neutral-800">
                <span>当前水位线: <strong className="font-mono text-neutral-800 dark:text-neutral-200">{String(watermarkState.lastWatermark)}</strong></span>
                <button onClick={() => void resetWatermark()} className="text-red-500 hover:text-red-700 flex items-center gap-0.5">
                  <RefreshCw className="h-3 w-3" /> 重置
                </button>
              </div>
            ) : (
              <input
                value={initialWatermark}
                onChange={(e) => setInitialWatermark(e.target.value)}
                placeholder="初始水位线 (可选)"
                className="h-8 w-40 rounded border border-neutral-200 bg-transparent px-2 font-mono text-[11px] outline-none focus:border-neutral-400 dark:border-neutral-700"
              />
            )}
          </div>
        )}
      </div>

      {error && <p className="rounded bg-red-50 px-2 py-1.5 text-red-600 dark:bg-red-950/30 dark:text-red-300">{error}</p>}

      <div className="flex items-center gap-2">
        <button onClick={() => void doExport()} disabled={exporting || !outputDir} className="inline-flex items-center gap-1.5 rounded-md bg-neutral-900 px-3 py-2 font-medium text-white disabled:opacity-50 dark:bg-neutral-100 dark:text-neutral-900">
          {exporting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
          {exporting ? "导出中…" : "确认导出"}
        </button>
        {result && !registered && workspaceId && (
          <button onClick={() => void registerPath()} disabled={registering} className="inline-flex items-center gap-1.5 rounded border border-neutral-200 px-3 py-2 dark:border-neutral-700">
            {registering ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
            注册到工作区路径
          </button>
        )}
        {registered && <span className="text-emerald-600 dark:text-emerald-400">✓ 已注册</span>}
      </div>

      {result && (
        <div className="rounded bg-emerald-50 px-3 py-2 dark:bg-emerald-950/30">
          <p className="font-medium text-emerald-700 dark:text-emerald-400">导出成功：{result.rowCount.toLocaleString()} 行 {result.appended && "(追加写入)"}</p>
          <p className="mt-0.5 break-all font-mono text-[11px] text-emerald-600 dark:text-emerald-500">{result.path}</p>
        </div>
      )}
    </div>
  );
}

// ---- Main Pane ----

interface Props { workspaceId: string | null }

export function SqlConnectPane({ workspaceId }: Props) {
  const [connections, setConnections] = useState<SqlConnection[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showForm, setShowForm] = useState<"new" | "edit" | null>(null);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string; latencyMs: number } | null>(null);
  const [schema, setSchema] = useState<SchemaTable[] | null>(null);
  const [schemaLoading, setSchemaLoading] = useState(false);
  const [schemaError, setSchemaError] = useState("");
  const [schemaOpen, setSchemaOpen] = useState(false);
  const [sql, setSql] = useState("");
  const [sqlParams, setSqlParams] = useState<Record<string, string>>({});
  const [querying, setQuerying] = useState(false);
  const [queryResult, setQueryResult] = useState<SqlQueryResult | null>(null);
  const [queryError, setQueryError] = useState("");
  const [showExport, setShowExport] = useState(false);
  const [validation, setValidation] = useState<SqlValidateResult | null>(null);

  const [mainTab, setMainTab] = useState<"query" | "export" | "import">("query");

  const [queriesOpen, setQueriesOpen] = useState(false);
  const [activeQuery, setActiveQuery] = useState<SavedQuery | null>(null);
  const [showSaveModal, setShowSaveModal] = useState(false);
  const [saveModalData, setSaveModalData] = useState<{ id?: string; name: string; description: string; parameters: ToolParameter[] }>({ name: "", description: "", parameters: [] });

  const extractedParams = Array.from(new Set(Array.from(sql.matchAll(/\{\{([a-zA-Z0-9_]+)\}\}/g)).map(m => m[1] as string)));

  const selected = connections.find((c) => c.id === selectedId) ?? null;

  const refresh = useCallback(() => {
    api.listSqlConnections().then(setConnections).catch(() => setConnections([]));
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const selectConn = (id: string) => {
    setSelectedId(id);
    setShowForm(null);
    setSchema(null);
    setSchemaOpen(false);
    setQueriesOpen(false);
    setActiveQuery(null);
    setQueryResult(null);
    setQueryError("");
    setShowExport(false);
    setTestResult(null);
    setSql("");
    setSqlParams({});
    setValidation(null);
    setMainTab("query");
  };

  const loadSavedQuery = (q: SavedQuery) => {
    setSql(q.sql);
    setActiveQuery(q);
    const initialParams: Record<string, string> = {};
    if (q.parameters) {
      for (const p of q.parameters) {
        initialParams[p.name] = String(p.default ?? "");
      }
    }
    setSqlParams(initialParams);
  };

  const openSaveQueryModal = (q?: SavedQuery) => {
    const extracted = Array.from(new Set(Array.from(sql.matchAll(/\{\{([a-zA-Z0-9_]+)\}\}/g)).map(m => m[1] as string)));
    if (q) {
      const existingParams = q.parameters || [];
      const mergedParams = extracted.map(name => {
        const found = existingParams.find(p => p.name === name);
        return found ? { ...found } : { name, label: name, type: "string" as const, default: "" };
      });
      setSaveModalData({
        id: q.id,
        name: q.name,
        description: q.description || "",
        parameters: mergedParams
      });
    } else {
      const mergedParams = extracted.map(name => ({
        name, label: name, type: "string" as const, default: ""
      }));
      setSaveModalData({
        name: "",
        description: "",
        parameters: mergedParams
      });
    }
    setShowSaveModal(true);
  };

  const handleSaveQuery = async () => {
    if (!selected) return;
    if (!saveModalData.name.trim()) return;

    const queries = selected.queries ? [...selected.queries] : [];
    const queryData: SavedQuery = {
      id: saveModalData.id || Math.random().toString(36).slice(2, 9),
      name: saveModalData.name.trim(),
      sql: sql,
      description: saveModalData.description.trim() || undefined,
      parameters: saveModalData.parameters.length > 0 ? saveModalData.parameters : undefined
    };

    if (saveModalData.id) {
      const idx = queries.findIndex(q => q.id === saveModalData.id);
      if (idx !== -1) queries[idx] = queryData;
    } else {
      queries.push(queryData);
    }

    try {
      const updated = await api.updateSqlConnection(selected.id, { queries });
      setConnections(prev => prev.map(c => c.id === selected.id ? updated : c));
      setActiveQuery(queryData);
      setShowSaveModal(false);
    } catch (err) {
      alert("保存失败：" + String(err));
    }
  };

  const deleteSavedQuery = async (queryId: string) => {
    if (!selected || !selected.queries) return;
    if (!confirm("确定删除该保存的查询吗？")) return;
    const queries = selected.queries.filter(q => q.id !== queryId);
    try {
      const updated = await api.updateSqlConnection(selected.id, { queries });
      setConnections(prev => prev.map(c => c.id === selected.id ? updated : c));
      if (activeQuery?.id === queryId) {
        setActiveQuery(null);
      }
    } catch (err) {
      alert("删除失败：" + String(err));
    }
  };

  const doTest = async () => {
    if (!selected) return;
    setTesting(true); setTestResult(null);
    const r = await api.testSqlConnection(selected.id);
    setTestResult(r);
    refresh();
    setTesting(false);
  };

  const loadSchema = async () => {
    if (!selected) return;
    if (schemaOpen && schema) { setSchemaOpen(false); return; }
    setSchemaOpen(true);
    if (schema) return;
    setSchemaLoading(true); setSchemaError("");
    try {
      const { tables } = await api.getSqlSchema(selected.id);
      setSchema(tables);
    } catch (err) { setSchemaError(String(err)); } finally { setSchemaLoading(false); }
  };

  const refreshSchema = useCallback(async () => {
    if (!selected) return;
    setSchemaLoading(true); setSchemaError("");
    try {
      const { tables } = await api.getSqlSchema(selected.id);
      setSchema(tables);
    } catch (err) { setSchemaError(String(err)); } finally { setSchemaLoading(false); }
  }, [selected]);

  const runQuery = async () => {
    if (!selected || !sql.trim()) return;
    setQuerying(true); setQueryResult(null); setQueryError(""); setShowExport(false);
    try {
      setQueryResult(await api.querySql(selected.id, sql.trim(), sqlParams, workspaceId ?? undefined));
    } catch (err) { setQueryError(String(err)); } finally { setQuerying(false); }
  };

  const doValidate = useCallback(async () => {
    if (!selected || !sql.trim()) { setValidation(null); return; }
    try {
      setValidation(await api.validateSql(selected.id, sql.trim()));
    } catch { setValidation(null); }
  }, [selected, sql]);

  useEffect(() => {
    if (!sql.trim()) { setValidation(null); return; }
    const timer = setTimeout(() => { void doValidate(); }, 500);
    return () => clearTimeout(timer);
  }, [sql, doValidate]);

  const saveConn = async (data: Omit<SqlConnection, "id" | "createdAt">) => {
    if (showForm === "edit" && selected) {
      await api.updateSqlConnection(selected.id, data);
    } else {
      const created = await api.createSqlConnection(data);
      setSelectedId(created.id);
    }
    refresh();
    setShowForm(null);
  };

  const deleteConn = async (id: string) => {
    await api.deleteSqlConnection(id);
    if (selectedId === id) setSelectedId(null);
    refresh();
  };

  return (
    <div className="flex min-h-0 flex-1 overflow-hidden">
      {/* Left: connection list */}
      <aside className="flex w-56 shrink-0 flex-col border-r border-neutral-200 bg-neutral-50 dark:border-neutral-800 dark:bg-neutral-950">
        <div className="flex h-10 items-center justify-between px-3">
          <span className="text-[12px] font-semibold text-neutral-700 dark:text-neutral-300">数据库连接</span>
          <button onClick={() => { setShowForm("new"); setSelectedId(null); }} title="新建连接" className="rounded p-1 text-neutral-500 hover:bg-neutral-200 hover:text-neutral-900 dark:hover:bg-neutral-800 dark:hover:text-neutral-100">
            <Plus className="h-4 w-4" />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-auto p-2 space-y-1">
          {connections.length === 0 && (
            <p className="py-6 text-center text-[11.5px] text-neutral-400">暂无连接<br />点击 + 新建</p>
          )}
          {connections.map((c) => (
            <button
              key={c.id}
              onClick={() => selectConn(c.id)}
              className={cn(
                "flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-[12px] transition-colors",
                selectedId === c.id
                  ? "bg-neutral-900 text-white dark:bg-neutral-100 dark:text-neutral-900"
                  : "text-neutral-700 hover:bg-neutral-200 dark:text-neutral-300 dark:hover:bg-neutral-800",
              )}
            >
              <DatabaseZap className="h-3.5 w-3.5 shrink-0" />
              <span className="min-w-0 flex-1 truncate">{c.name}</span>
              {c.lastTestedAt && (
                c.lastTestOk
                  ? <Wifi className="h-3 w-3 shrink-0 text-emerald-500" />
                  : <WifiOff className="h-3 w-3 shrink-0 text-red-500" />
              )}
            </button>
          ))}
        </div>

        <div className="border-t border-neutral-200 px-3 py-2 dark:border-neutral-800">
          <div className="flex items-center gap-1.5 text-[11px] text-neutral-400">
            <ShieldCheck className="h-3.5 w-3.5 text-emerald-500" />
            凭证仅存本机，不进 LLM
          </div>
        </div>
      </aside>

      {/* Right: content area */}
      <div className="flex min-h-0 flex-1 flex-col overflow-auto bg-neutral-50/60 p-4 dark:bg-neutral-950">
        {showForm ? (
          <div className="mx-auto w-full max-w-lg">
            <ConnForm
              initial={showForm === "edit" ? selected ?? undefined : undefined}
              onSave={saveConn}
              onCancel={() => setShowForm(null)}
            />
          </div>
        ) : !selected ? (
          <div className="flex flex-1 items-center justify-center">
            <div className="text-center text-neutral-400">
              <DatabaseZap className="mx-auto mb-3 h-10 w-10 opacity-30" />
              <p className="text-[13px]">选择左侧连接，或点击 + 新建</p>
            </div>
          </div>
        ) : (
          <div className="mx-auto flex w-full max-w-5xl flex-col gap-4">
            {/* Connection header */}
            <div className="flex items-center gap-3 rounded-lg border border-neutral-200 bg-white px-4 py-3 dark:border-neutral-800 dark:bg-neutral-900">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="font-semibold">{selected.name}</span>
                  <span className="rounded bg-neutral-100 px-1.5 py-0.5 text-[10px] text-neutral-500 dark:bg-neutral-800">{selected.type}</span>
                  {selected.lastTestedAt && (
                    <span className={cn("text-[11px]", selected.lastTestOk ? "text-emerald-600" : "text-red-500")}>
                      {selected.lastTestOk ? "✓ 连接正常" : "✗ 连接失败"}
                      {" · "}{new Date(selected.lastTestedAt).toLocaleTimeString()}
                    </span>
                  )}
                </div>
                {selected.type !== "sqlite"
                  ? <p className="mt-0.5 font-mono text-[11px] text-neutral-400">{selected.host}:{selected.port} / {selected.database}</p>
                  : <p className="mt-0.5 font-mono text-[11px] text-neutral-400">{selected.filePath}</p>
                }
              </div>
              <div className="flex shrink-0 items-center gap-2">
                {testResult && (
                  <span className={cn("text-[11px]", testResult.ok ? "text-emerald-600" : "text-red-500")}>
                    {testResult.ok ? `✓ ${testResult.latencyMs}ms` : "✗ 失败"}
                  </span>
                )}
                <button onClick={() => void doTest()} disabled={testing} className="inline-flex items-center gap-1.5 rounded border border-neutral-200 px-2.5 py-1.5 text-[12px] dark:border-neutral-700">
                  {testing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Wifi className="h-3.5 w-3.5" />} 测试
                </button>
                <button onClick={() => setShowForm("edit")} className="rounded border border-neutral-200 px-2.5 py-1.5 text-[12px] dark:border-neutral-700">编辑</button>
                <button onClick={() => void deleteConn(selected.id)} className="rounded border border-red-200 px-2.5 py-1.5 text-[12px] text-red-500 hover:bg-red-50 dark:border-red-900 dark:hover:bg-red-950/30">
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>

            {/* Main tab bar: 查询 / 导出 / 导入建表 (D-SQL2) */}
            <div className="flex items-center gap-1 border-b border-neutral-200 dark:border-neutral-800">
              {([
                { key: "query", label: "查询" },
                { key: "export", label: "导出" },
                { key: "import", label: "导入建表" },
              ] as const).map((t) => (
                <button
                  key={t.key}
                  onClick={() => setMainTab(t.key)}
                  className={cn(
                    "h-9 border-b-2 px-3 text-[12px] font-medium transition-colors",
                    mainTab === t.key
                      ? "border-neutral-900 text-neutral-900 dark:border-neutral-100 dark:text-neutral-100"
                      : "border-transparent text-neutral-500 hover:text-neutral-800 dark:hover:text-neutral-200",
                  )}
                >
                  {t.label}
                </button>
              ))}
            </div>

            {/* Schema panel */}
            <div className="rounded-lg border border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900">
              <button onClick={() => void loadSchema()} className="flex w-full items-center gap-2 px-4 py-3 text-[12px] font-semibold hover:bg-neutral-50 dark:hover:bg-neutral-800/50">
                {schemaOpen ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                Schema 浏览器
                {schema && <span className="ml-1 text-[11px] font-normal text-neutral-400">{schema.length} 张表</span>}
              </button>
              {schemaOpen && (
                <div className="border-t border-neutral-100 px-4 py-3 dark:border-neutral-800">
                  {schemaLoading ? <p className="text-[12px] text-neutral-400">加载中…</p>
                    : schemaError ? <p className="text-[12px] text-red-500">{schemaError}</p>
                    : schema ? <SchemaPanel tables={schema} />
                    : null}
                </div>
              )}
            </div>

            {/* Saved queries panel */}
            {mainTab === "query" && (
            <>
            <div className="rounded-lg border border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900">
              <button onClick={() => setQueriesOpen(!queriesOpen)} className="flex w-full items-center gap-2 px-4 py-3 text-[12px] font-semibold hover:bg-neutral-50 dark:hover:bg-neutral-800/50">
                {queriesOpen ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                已保存查询
                {selected.queries && <span className="ml-1 text-[11px] font-normal text-neutral-400">{selected.queries.length} 个</span>}
              </button>
              {queriesOpen && (
                <div className="border-t border-neutral-100 px-4 py-3 dark:border-neutral-800">
                  {!selected.queries || selected.queries.length === 0 ? (
                    <p className="text-[12px] text-neutral-400 text-center py-2">暂无已保存的查询</p>
                  ) : (
                    <div className="space-y-2">
                      {selected.queries.map((q) => (
                        <div key={q.id} className="flex items-center justify-between rounded border border-neutral-100 p-2 dark:border-neutral-800">
                          <button onClick={() => loadSavedQuery(q)} className="flex-1 text-left">
                            <div className="font-semibold text-[12px] text-neutral-800 dark:text-neutral-200">{q.name}</div>
                            {q.description && <div className="text-[11px] text-neutral-400">{q.description}</div>}
                          </button>
                          <div className="flex items-center gap-2 shrink-0">
                            <button onClick={() => openSaveQueryModal(q)} className="text-[11px] text-neutral-500 hover:text-neutral-800 dark:hover:text-neutral-200">编辑</button>
                            <button onClick={() => void deleteSavedQuery(q.id)} className="text-[11px] text-red-500 hover:text-red-700">删除</button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* SQL editor */}
            <div className="rounded-lg border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
              <div className="flex items-center justify-between">
                <h3 className="text-[13px] font-semibold">SQL 查询</h3>
                <span className="text-[11px] text-neutral-400">预览最多返回 500 行</span>
              </div>
              <textarea
                value={sql}
                onChange={(e) => {
                  setSql(e.target.value);
                  if (activeQuery && e.target.value !== activeQuery.sql) {
                    setActiveQuery(null);
                  }
                }}
                onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === "Enter") { e.preventDefault(); void runQuery(); } }}
                placeholder={`SELECT * FROM your_table LIMIT 100`}
                className="mt-3 h-32 w-full resize-y rounded border border-neutral-200 bg-neutral-50 p-3 font-mono text-[12px] leading-5 outline-none focus:border-neutral-400 dark:border-neutral-700 dark:bg-neutral-950"
                spellCheck={false}
              />

              {validation && (
                <div className={cn(
                  "mt-2 rounded border px-3 py-2 text-[11px]",
                  validation.safe
                    ? "border-emerald-200 bg-emerald-50 dark:border-emerald-900/50 dark:bg-emerald-950/30"
                    : "border-red-200 bg-red-50 dark:border-red-900/50 dark:bg-red-950/30",
                )}>
                  <div className="flex items-center gap-1.5 font-medium">
                    {validation.safe
                      ? <><ShieldCheck className="h-3.5 w-3.5 text-emerald-600" /> SQL 安全 · 风险等级 {validation.riskLevel}</>
                      : <><ShieldAlert className="h-3.5 w-3.5 text-red-600" /> SQL 包含危险操作 · 风险等级 {validation.riskLevel}</>
                    }
                  </div>
                  {validation.risks.length > 0 && (
                    <ul className="mt-1 ml-5 list-disc text-red-600 dark:text-red-400">
                      {validation.risks.map((r, i) => <li key={i}>{r}</li>)}
                    </ul>
                  )}
                  {validation.suggestions.length > 0 && (
                    <ul className="mt-1 ml-5 list-disc text-amber-600 dark:text-amber-400">
                      {validation.suggestions.map((s, i) => <li key={i}>{s}</li>)}
                    </ul>
                  )}
                </div>
              )}

              {activeQuery && activeQuery.parameters && activeQuery.parameters.length > 0 ? (
                <div className="mt-3 rounded border border-amber-200 bg-amber-50 p-3 dark:border-amber-900/50 dark:bg-amber-950/30 text-[12px]">
                  <h4 className="mb-2 text-[11px] font-semibold text-amber-700 dark:text-amber-500">
                    {activeQuery.name} — 查询变量配置
                  </h4>
                  <div className="grid grid-cols-2 gap-3">
                    {activeQuery.parameters.map((p) => (
                      <label key={p.name} className="flex items-center gap-2">
                        <span className="font-mono text-[11px] text-amber-700 dark:text-amber-500 w-24 text-right truncate" title={p.label || p.name}>
                          {p.label || p.name}
                        </span>
                        {p.type === "boolean" ? (
                          <input
                            type="checkbox"
                            checked={sqlParams[p.name] === "true"}
                            onChange={(e) => setSqlParams((prev) => ({ ...prev, [p.name]: e.target.checked ? "true" : "false" }))}
                            className="h-4 w-4 rounded border-amber-200 dark:border-amber-800"
                          />
                        ) : p.type === "date" ? (
                          <input
                            type="date"
                            value={sqlParams[p.name] || ""}
                            onChange={(e) => setSqlParams((prev) => ({ ...prev, [p.name]: e.target.value }))}
                            className="flex-1 rounded border border-amber-200 bg-white/50 px-2 py-1 font-mono text-[11px] outline-none focus:border-amber-400 dark:border-amber-800 dark:bg-black/20"
                          />
                        ) : p.type === "number" ? (
                          <input
                            type="number"
                            value={sqlParams[p.name] || ""}
                            onChange={(e) => setSqlParams((prev) => ({ ...prev, [p.name]: e.target.value }))}
                            className="flex-1 rounded border border-amber-200 bg-white/50 px-2 py-1 font-mono text-[11px] outline-none focus:border-amber-400 dark:border-amber-800 dark:bg-black/20"
                          />
                        ) : (
                          <input
                            type="text"
                            value={sqlParams[p.name] || ""}
                            onChange={(e) => setSqlParams((prev) => ({ ...prev, [p.name]: e.target.value }))}
                            placeholder={String(p.default ?? "")}
                            className="flex-1 rounded border border-amber-200 bg-white/50 px-2 py-1 font-mono text-[11px] outline-none focus:border-amber-400 dark:border-amber-800 dark:bg-black/20"
                          />
                        )}
                      </label>
                    ))}
                  </div>
                </div>
              ) : extractedParams.length > 0 ? (
                <div className="mt-3 rounded border border-amber-200 bg-amber-50 p-3 dark:border-amber-900/50 dark:bg-amber-950/30">
                  <h4 className="mb-2 text-[11px] font-semibold text-amber-700 dark:text-amber-500">检测到 SQL 变量</h4>
                  <div className="grid grid-cols-2 gap-3">
                    {extractedParams.map((p) => (
                      <label key={p} className="flex items-center gap-2">
                        <span className="font-mono text-[11px] text-amber-700 dark:text-amber-500 w-16 text-right">{"{{"}{p}{"}}"}</span>
                        <input
                          value={sqlParams[p] || ""}
                          onChange={(e) => setSqlParams((prev) => ({ ...prev, [p]: e.target.value }))}
                          placeholder="输入变量值"
                          className="flex-1 rounded border border-amber-200 bg-white/50 px-2 py-1 font-mono text-[11px] outline-none focus:border-amber-400 dark:border-amber-800 dark:bg-black/20"
                        />
                      </label>
                    ))}
                  </div>
                </div>
              ) : null}

              <div className="mt-3 flex items-center gap-2">
                <button
                  onClick={() => void runQuery()}
                  disabled={querying || !sql.trim()}
                  className="inline-flex items-center gap-1.5 rounded-md bg-neutral-900 px-3 py-2 text-[12px] font-medium text-white disabled:opacity-50 dark:bg-neutral-100 dark:text-neutral-900"
                >
                  {querying ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
                  {querying ? "执行中…" : "执行（⌘ Enter）"}
                </button>
                <button
                  onClick={() => openSaveQueryModal(activeQuery || undefined)}
                  disabled={!sql.trim()}
                  className="inline-flex items-center gap-1.5 rounded-md border border-neutral-200 bg-white px-3 py-2 text-[12px] font-medium text-neutral-700 hover:bg-neutral-50 disabled:opacity-50 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-300"
                >
                  <Save className="h-3.5 w-3.5" />
                  {activeQuery ? "保存修改" : "保存查询"}
                </button>
              </div>
            </div>

            {/* Results */}
            {queryError && <p className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-[12px] text-red-600 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300">{queryError}</p>}
            {queryResult && (
              <div className="overflow-hidden rounded-lg border border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900">
                <div className="flex items-center justify-between border-b border-neutral-200 px-4 py-2 dark:border-neutral-800">
                  <span className="text-[12px] text-neutral-500">
                    共返回 {queryResult.rowCount} 行 ({queryResult.executionMs}ms){queryResult.capped && "，已截断显示"}
                  </span>
                  <button onClick={() => setShowExport(!showExport)} className="rounded px-2 py-1 text-[12px] font-medium hover:bg-neutral-100 dark:hover:bg-neutral-800">
                    {showExport ? "关闭导出" : "导出配置"}
                  </button>
                </div>
                {queryResult.summary && (
                  <div className="border-b border-neutral-100 px-4 py-2 dark:border-neutral-800">
                    <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px]">
                      {queryResult.summary.numericColumns.slice(0, 3).map((nc) => (
                        <span key={nc.name} className="text-neutral-500">
                          <span className="font-mono font-medium text-neutral-700 dark:text-neutral-300">{nc.name}</span>
                          : {nc.min.toLocaleString()} ~ {nc.max.toLocaleString()} (avg {nc.avg.toFixed(1)})
                        </span>
                      ))}
                      {queryResult.summary.dateRange && (
                        <span className="text-neutral-500">
                          时间范围: <span className="font-mono">{queryResult.summary.dateRange.min} ~ {queryResult.summary.dateRange.max}</span>
                        </span>
                      )}
                      {queryResult.summary.categoricalColumns.slice(0, 2).map((cc) => (
                        <span key={cc.name} className="text-neutral-500">
                          <span className="font-mono font-medium text-neutral-700 dark:text-neutral-300">{cc.name}</span>
                          : {cc.uniqueCount} 种取值, top={cc.topValue}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
                <div className="mt-3 max-h-96 overflow-auto">
                  <ResultTable result={queryResult} />
                </div>
              </div>
            )}

            {/* Export panel */}
            {showExport && queryResult && (
              <ExportPanel connId={selected.id} sql={sql.trim()} params={sqlParams} workspaceId={workspaceId} />
            )}
            </>
            )}

            {/* 导出 tab：查询导出 + 表导出 */}
            {mainTab === "export" && (
              <div className="space-y-4">
                <SqlTableExportPanel connId={selected.id} tables={schema} workspaceId={workspaceId} />
                <div className="rounded-lg border border-neutral-200 bg-white p-4 text-[12px] dark:border-neutral-800 dark:bg-neutral-900">
                  <h3 className="text-[13px] font-semibold">查询导出（CSV 到本地路径）</h3>
                  <p className="mt-1 text-[11px] text-neutral-500">如需基于 SQL 查询导出（含 watermark 增量、写入工作区路径），请先到「查询」执行 SELECT，再点击「导出配置」。</p>
                  <button
                    onClick={() => setMainTab("query")}
                    className="mt-2 inline-flex h-7 items-center gap-1 rounded border border-neutral-200 px-2 text-[11px] dark:border-neutral-700"
                  >
                    去查询
                  </button>
                </div>
              </div>
            )}

            {/* 导入建表 tab */}
            {mainTab === "import" && (
              <SqlImportPanel
                connId={selected.id}
                connType={selected.type}
                workspaceId={workspaceId}
                onAfterCommit={() => { void refreshSchema(); }}
              />
            )}
          </div>
        )}
      </div>

      {/* Save query modal */}
      {showSaveModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-lg border border-neutral-200 bg-white p-5 text-[12px] shadow-lg dark:border-neutral-800 dark:bg-neutral-900">
            <h3 className="mb-3 text-[13px] font-semibold">{saveModalData.id ? "编辑已保存的查询" : "保存当前查询"}</h3>
            <div className="space-y-3">
              <label className="block">
                <span className="font-medium">查询名称</span>
                <input
                  value={saveModalData.name}
                  onChange={(e) => setSaveModalData(prev => ({ ...prev, name: e.target.value }))}
                  className="mt-1 h-8 w-full rounded border border-neutral-200 bg-transparent px-2 outline-none focus:border-neutral-400 dark:border-neutral-700"
                  placeholder="例如：每周销售额统计"
                />
              </label>
              <label className="block">
                <span className="font-medium">描述</span>
                <textarea
                  value={saveModalData.description}
                  onChange={(e) => setSaveModalData(prev => ({ ...prev, description: e.target.value }))}
                  className="mt-1 h-14 w-full rounded border border-neutral-200 bg-transparent p-2 outline-none focus:border-neutral-400 dark:border-neutral-700"
                  placeholder="输入对此查询的描述..."
                />
              </label>

              {saveModalData.parameters.length > 0 && (
                <div className="space-y-2.5">
                  <span className="font-medium text-neutral-700 dark:text-neutral-300">配置参数</span>
                  <div className="max-h-40 overflow-y-auto space-y-2 pr-1">
                    {saveModalData.parameters.map((param, index) => (
                      <div key={param.name} className="rounded border border-neutral-100 p-2 space-y-1.5 dark:border-neutral-800">
                        <div className="flex items-center justify-between">
                          <span className="font-mono text-[11px] font-semibold text-neutral-500">{"{{"}{param.name}{"}}"}</span>
                          <select
                            value={param.type}
                            onChange={(e) => {
                              const newParams = [...saveModalData.parameters];
                              newParams[index]!.type = e.target.value as any;
                              setSaveModalData(prev => ({ ...prev, parameters: newParams }));
                            }}
                            className="h-6 rounded border border-neutral-200 bg-transparent px-1 text-[11px] dark:border-neutral-700"
                          >
                            <option value="string">文本 (String)</option>
                            <option value="number">数字 (Number)</option>
                            <option value="date">日期 (Date)</option>
                            <option value="boolean">布尔 (Boolean)</option>
                          </select>
                        </div>
                        <div className="grid grid-cols-2 gap-2">
                          <input
                            value={param.label}
                            onChange={(e) => {
                              const newParams = [...saveModalData.parameters];
                              newParams[index]!.label = e.target.value;
                              setSaveModalData(prev => ({ ...prev, parameters: newParams }));
                            }}
                            placeholder="参数显示名 (Label)"
                            className="h-7 rounded border border-neutral-200 bg-transparent px-1.5 text-[11px] dark:border-neutral-700"
                          />
                          <input
                            value={String(param.default ?? "")}
                            onChange={(e) => {
                              const newParams = [...saveModalData.parameters];
                              newParams[index]!.default = e.target.value;
                              setSaveModalData(prev => ({ ...prev, parameters: newParams }));
                            }}
                            placeholder="默认值 (Default)"
                            className="h-7 rounded border border-neutral-200 bg-transparent px-1.5 text-[11px] dark:border-neutral-700"
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <div className="mt-4 flex justify-end gap-2">
              <button onClick={() => setShowSaveModal(false)} className="h-8 rounded px-3 text-neutral-500 hover:bg-neutral-100 dark:hover:bg-neutral-800">取消</button>
              <button onClick={() => void handleSaveQuery()} className="h-8 rounded bg-neutral-900 px-3 font-medium text-white dark:bg-neutral-100 dark:text-neutral-900">确定</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
