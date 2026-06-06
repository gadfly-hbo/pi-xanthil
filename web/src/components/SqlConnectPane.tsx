import { useCallback, useEffect, useState } from "react";
import { ChevronDown, ChevronRight, DatabaseZap, FolderOpen, Loader2, Play, Plus, ShieldCheck, Trash2, Wifi, WifiOff } from "lucide-react";
import { cn } from "@/lib/cn";
import { api } from "@/lib/api";
import type { DbType, SchemaTable, SqlConnection, SqlQueryResult } from "@/types";

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
            <button onClick={() => api.pickLocalPath("file").then(({ path }) => set("filePath", path)).catch(() => undefined)} className="rounded border border-neutral-200 px-2.5 dark:border-neutral-700"><FolderOpen className="h-3.5 w-3.5" /></button>
          </div>
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

  const pickDir = async () => {
    const { path } = await api.pickLocalPath("dir");
    setOutputDir(path);
  };

  const doExport = async () => {
    if (!outputDir || !filename.trim()) { setError("请选择输出目录并填写文件名"); return; }
    setExporting(true); setError(""); setResult(null); setRegistered(false);
    try {
      const outputPath = outputDir.replace(/\/$/, "") + "/" + filename.trim();
      const res = await api.exportSql(connId, sql, outputPath, params, useWatermark && watermarkColumn.trim() ? { column: watermarkColumn.trim() } : undefined);
      setResult(res);
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
      <h3 className="text-[13px] font-semibold">导出 CSV 到工作区</h3>

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

      <div className="flex items-center gap-4 py-1">
        <label className="flex cursor-pointer items-center gap-1.5">
          <input type="checkbox" checked={useWatermark} onChange={(e) => setUseWatermark(e.target.checked)} />
          <span className="font-medium text-neutral-700 dark:text-neutral-300">增量导出 (Watermark)</span>
        </label>
        {useWatermark && (
          <input value={watermarkColumn} onChange={(e) => setWatermarkColumn(e.target.value)} placeholder="水印字段 (如 id或updated_at)" className="h-8 w-40 rounded border border-neutral-200 bg-transparent px-2 font-mono text-[11px] outline-none focus:border-neutral-400 dark:border-neutral-700" />
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
    setQueryResult(null);
    setQueryError("");
    setShowExport(false);
    setTestResult(null);
    setSql("");
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

  const runQuery = async () => {
    if (!selected || !sql.trim()) return;
    setQuerying(true); setQueryResult(null); setQueryError(""); setShowExport(false);
    try {
      setQueryResult(await api.querySql(selected.id, sql.trim(), sqlParams));
    } catch (err) { setQueryError(String(err)); } finally { setQuerying(false); }
  };

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

            {/* SQL editor */}
            <div className="rounded-lg border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
              <div className="flex items-center justify-between">
                <h3 className="text-[13px] font-semibold">SQL 查询</h3>
                <span className="text-[11px] text-neutral-400">预览最多返回 500 行</span>
              </div>
              <textarea
                value={sql}
                onChange={(e) => setSql(e.target.value)}
                onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === "Enter") { e.preventDefault(); void runQuery(); } }}
                placeholder={`SELECT * FROM your_table LIMIT 100`}
                className="mt-3 h-32 w-full resize-y rounded border border-neutral-200 bg-neutral-50 p-3 font-mono text-[12px] leading-5 outline-none focus:border-neutral-400 dark:border-neutral-700 dark:bg-neutral-950"
                spellCheck={false}
              />
              
              {extractedParams.length > 0 && (
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
              )}

              <button
                onClick={() => void runQuery()}
                disabled={querying || !sql.trim()}
                className="mt-3 inline-flex items-center gap-1.5 rounded-md bg-neutral-900 px-3 py-2 text-[12px] font-medium text-white disabled:opacity-50 dark:bg-neutral-100 dark:text-neutral-900"
              >
                {querying ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
                {querying ? "执行中…" : "执行（⌘ Enter）"}
              </button>
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
                <div className="mt-3 max-h-96 overflow-auto">
                  <ResultTable result={queryResult} />
                </div>
              </div>
            )}

            {/* Export panel */}
            {showExport && queryResult && (
              <ExportPanel connId={selected.id} sql={sql.trim()} params={sqlParams} workspaceId={workspaceId} />
            )}
          </div>
        )}
      </div>
    </div>
  );
}
