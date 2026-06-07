// LLM_FORBIDDEN: this module must never call any LLM API.
// Data Exploration: csv/xlsx → duckdb-wasm → drag-and-drop BI.
// All computation runs in the browser. Server only streams raw bytes.
// DO NOT import any LLM-related api method (chat/generate*/extract*/clarify*).

import { useCallback, useEffect, useMemo, useState } from "react";
import { DndContext, type DragEndEvent } from "@dnd-kit/core";
import { ShieldAlert, Loader2, Compass, Check, X, Link2, Sparkles } from "lucide-react";
import { FileSelector, type FileChoice, type Scope } from "./data-exploration/FileSelector";
import { FieldList } from "./data-exploration/FieldList";
import { ConfigPanel, type ChartConfig } from "./data-exploration/ConfigPanel";
import { ChartCanvas } from "./data-exploration/ChartCanvas";
import { ProfileReport } from "./data-exploration/ProfileReport";
import { JoinBuilder } from "./data-exploration/JoinBuilder";
import { InsightsReport } from "./data-exploration/InsightsReport";
import { registerFile, runQuery, quoteIdent } from "@/lib/duckdb";
import { profileTable, type ColumnProfile, type FieldSchema, type FieldKind } from "@/lib/profiling";
import type { ExploreSeed } from "@/types";

interface Props {
  scope: Scope | null;
  // One-way seed from 业务需求: field-name hints only (never data, never LLM).
  seed?: ExploreSeed | null;
  onSeedDismiss?: () => void;
}

const DEFAULT_CONFIG: ChartConfig = {
  chartType: "bar",
  xField: null,
  yField: null,
  colorField: null,
  aggregation: "sum",
  filters: [],
  timeGranularity: "month",
  limit: 1000,
};

interface LoadedTable {
  tableName: string;
  label: string; // fileName or joined-table label
  rowCount: number;
  fields: FieldSchema[];
  columns: ColumnProfile[];
  sourceKey?: string; // `${pathId}:${relativePath}` for file-backed tables
  choice?: FileChoice; // original file (to re-fetch on sheet switch)
  sheets?: string[]; // xlsx sheet names (multi-sheet support, #5)
  currentSheet?: string;
  kindOverrides: Record<string, FieldKind>; // #6 manual column-type fixes
  isJoined?: boolean;
}

type ViewTab = "chart" | "profile" | "insights";

function fileKey(choice: FileChoice): string {
  return `${choice.pathId}:${choice.relativePath}`;
}

function sanitizeTableName(fileName: string): string {
  const base = fileName.replace(/\.[^.]+$/, "");
  const safe = base.replace(/[^A-Za-z0-9_一-龥]/g, "_");
  return safe || "data";
}

async function fetchBinary(choice: FileChoice): Promise<Uint8Array> {
  const url = `/api/workspace-paths/${choice.pathId}/file-binary?path=${encodeURIComponent(choice.relativePath)}`;
  const resp = await fetch(url);
  if (!resp.ok) {
    let detail = "";
    try { detail = JSON.stringify(await resp.json()); } catch { /* noop */ }
    throw new Error(`fetch failed: ${resp.status} ${detail}`);
  }
  const buf = await resp.arrayBuffer();
  return new Uint8Array(buf);
}

export function DataExplorationPane({ scope, seed, onSeedDismiss }: Props) {
  const [loadedTables, setLoadedTables] = useState<LoadedTable[]>([]);
  const [activeTableName, setActiveTableName] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [config, setConfig] = useState<ChartConfig>(DEFAULT_CONFIG);
  const [viewTab, setViewTab] = useState<ViewTab>("chart");
  const [showJoin, setShowJoin] = useState(false);

  const activeTable = useMemo(
    () => loadedTables.find((t) => t.tableName === activeTableName) ?? null,
    [loadedTables, activeTableName],
  );

  const loadedKeys = useMemo(() => {
    const set = new Set<string>();
    for (const t of loadedTables) if (t.sourceKey) set.add(t.sourceKey);
    return set;
  }, [loadedTables]);

  const fieldsByName = useMemo(() => {
    const map: Record<string, FieldSchema> = {};
    for (const f of activeTable?.fields ?? []) map[f.name] = f;
    return map;
  }, [activeTable]);

  // Lowercased column-name set of the active table, for seed-hint matching only.
  const columnNameSet = useMemo(() => {
    const set = new Set<string>();
    for (const f of activeTable?.fields ?? []) set.add(f.name.trim().toLowerCase());
    return set;
  }, [activeTable]);

  // Reset chart config when switching tables (fields belong to a specific table).
  useEffect(() => {
    setConfig(DEFAULT_CONFIG);
  }, [activeTableName]);

  // Pick a unique table name (avoid clobbering an already-loaded table).
  const uniqueTableName = useCallback((base: string): string => {
    const existing = new Set(loadedTables.map((t) => t.tableName));
    if (!existing.has(base)) return base;
    let i = 2;
    while (existing.has(`${base}_${i}`)) i++;
    return `${base}_${i}`;
  }, [loadedTables]);

  const dropTable = useCallback(async (tableName: string) => {
    try { await runQuery(`DROP TABLE IF EXISTS ${quoteIdent(tableName)}`); } catch { /* noop */ }
    setLoadedTables((prev) => {
      const next = prev.filter((t) => t.tableName !== tableName);
      setActiveTableName((cur) => (cur === tableName ? (next[0]?.tableName ?? null) : cur));
      return next;
    });
  }, []);

  const addFile = useCallback(async (choice: FileChoice) => {
    setLoading(true);
    setError(null);
    try {
      const bytes = await fetchBinary(choice);
      const tableName = uniqueTableName(sanitizeTableName(choice.fileName));
      const reg = await registerFile({ tableName, fileName: choice.fileName, bytes });
      const profile = await profileTable(tableName);
      setLoadedTables((prev) => [
        ...prev,
        {
          tableName,
          label: choice.fileName,
          sourceKey: fileKey(choice),
          choice,
          sheets: reg.sheets,
          currentSheet: reg.sheets?.[0],
          kindOverrides: {},
          ...profile,
        },
      ]);
      setActiveTableName(tableName);
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }, [uniqueTableName]);

  const toggleFile = useCallback((choice: FileChoice) => {
    const key = fileKey(choice);
    const existing = loadedTables.find((t) => t.sourceKey === key);
    if (existing) void dropTable(existing.tableName);
    else void addFile(choice);
  }, [loadedTables, dropTable, addFile]);

  // Called by JoinBuilder after it materializes a joined table; we profile + add it.
  const registerJoinedTable = useCallback(async (tableName: string, label: string) => {
    setLoading(true);
    setError(null);
    try {
      const profile = await profileTable(tableName);
      setLoadedTables((prev) => [...prev, { tableName, label, isJoined: true, kindOverrides: {}, ...profile }]);
      setActiveTableName(tableName);
      setShowJoin(false);
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  // #5: switch the active xlsx sheet (re-fetch + re-register + re-profile).
  const changeSheet = useCallback(async (table: LoadedTable, sheetName: string) => {
    if (!table.choice || sheetName === table.currentSheet) return;
    setLoading(true);
    setError(null);
    try {
      const bytes = await fetchBinary(table.choice);
      await registerFile({ tableName: table.tableName, fileName: table.choice.fileName, bytes, sheetName });
      const profile = await profileTable(table.tableName); // new sheet → drop column overrides
      setLoadedTables((prev) =>
        prev.map((t) =>
          t.tableName === table.tableName ? { ...t, currentSheet: sheetName, kindOverrides: {}, ...profile } : t,
        ),
      );
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  // #6: override a column's inferred type and re-profile that table.
  const changeColumnKind = useCallback(async (table: LoadedTable, column: string, kind: FieldKind) => {
    const overrides = { ...table.kindOverrides, [column]: kind };
    setError(null);
    try {
      const profile = await profileTable(table.tableName, 100, overrides);
      setLoadedTables((prev) =>
        prev.map((t) => (t.tableName === table.tableName ? { ...t, kindOverrides: overrides, ...profile } : t)),
      );
    } catch (err) {
      setError(String(err));
    }
  }, []);

  const handleDragEnd = useCallback((event: DragEndEvent) => {
    const { active, over } = event;
    if (!over) return;
    const fieldId = String(active.id);
    if (!fieldId.startsWith("field:")) return;
    const fieldName = fieldId.slice("field:".length);
    const field = fieldsByName[fieldName];
    if (!field) return;
    setConfig((prev) => {
      switch (over.id) {
        case "drop:x": return { ...prev, xField: field };
        case "drop:y": return { ...prev, yField: field };
        case "drop:color": return { ...prev, colorField: field };
        default: return prev;
      }
    });
  }, [fieldsByName]);

  const tabBtn = (id: ViewTab, label: string) => (
    <button
      onClick={() => setViewTab(id)}
      className={`rounded px-2 py-0.5 text-[11px] ${
        viewTab === id
          ? "bg-neutral-900 text-white dark:bg-neutral-100 dark:text-neutral-900"
          : "text-neutral-500 hover:bg-neutral-100 dark:hover:bg-neutral-800"
      }`}
    >
      {label}
    </button>
  );

  return (
    <DndContext onDragEnd={handleDragEnd}>
      <div className="flex h-full min-h-0 flex-col">
        <div className="flex items-center gap-2 border-b border-red-300 bg-red-50 px-3 py-1.5 text-[11px] text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
          <ShieldAlert className="h-3.5 w-3.5 shrink-0" strokeWidth={2} />
          <span>数据安全：本模块所有计算在浏览器本地完成，数据永不发送给 LLM 或第三方服务</span>
        </div>

        {seed && seed.fieldHints.length > 0 && (
          <div className="flex items-start gap-2 border-b border-blue-200 bg-blue-50/70 px-3 py-2 dark:border-blue-900/60 dark:bg-blue-950/30">
            <Compass className="mt-0.5 h-3.5 w-3.5 shrink-0 text-blue-600 dark:text-blue-400" strokeWidth={2} />
            <div className="min-w-0 flex-1">
              <div className="text-[11px] font-medium text-blue-800 dark:text-blue-300">
                待验证字段（来自业务需求：{seed.source}）
                <span className="ml-1 font-normal text-blue-500 dark:text-blue-400">选择数据文件后，命中的列会标 ✓；字段名仅作提示，需手动拖入配置。</span>
              </div>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {seed.fieldHints.map((hint) => {
                  const matched = columnNameSet.has(hint.trim().toLowerCase());
                  return (
                    <span
                      key={hint}
                      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] ${
                        matched
                          ? "border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300"
                          : "border-neutral-300 bg-white text-neutral-600 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-300"
                      }`}
                      title={matched ? "当前文件存在同名列" : "当前文件未找到同名列"}
                    >
                      {matched && <Check className="h-3 w-3" strokeWidth={2.5} />}
                      {hint}
                    </span>
                  );
                })}
              </div>
            </div>
            <button
              onClick={() => onSeedDismiss?.()}
              className="rounded p-0.5 text-blue-500 hover:bg-blue-100 dark:hover:bg-blue-900/40"
              title="关闭"
            >
              <X className="h-3.5 w-3.5" strokeWidth={2} />
            </button>
          </div>
        )}

        <div className="flex min-h-0 flex-1">
          <div className="w-64 shrink-0">
            <FileSelector scope={scope} onToggle={toggleFile} loadedKeys={loadedKeys} />
          </div>

          <div className="flex min-w-0 flex-1 flex-col">
            <div className="flex flex-wrap items-center gap-2 border-b border-neutral-200 px-3 py-2 text-[12px] dark:border-neutral-800">
              {loadedTables.length === 0 ? (
                <span className="text-neutral-500">请从左侧选择文件（可多选加载，用于跨表关联）</span>
              ) : (
                <div className="flex flex-wrap items-center gap-1.5">
                  {loadedTables.map((t) => {
                    const isActive = t.tableName === activeTableName;
                    return (
                      <span
                        key={t.tableName}
                        className={`group inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] ${
                          isActive
                            ? "border-blue-300 bg-blue-50 text-blue-700 dark:border-blue-700 dark:bg-blue-950/40 dark:text-blue-300"
                            : "border-neutral-300 bg-white text-neutral-600 hover:bg-neutral-50 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-300"
                        }`}
                      >
                        <button onClick={() => setActiveTableName(t.tableName)} className="max-w-[160px] truncate" title={t.label}>
                          {t.isJoined ? "🔗 " : ""}{t.label}
                        </button>
                        <button
                          onClick={() => void dropTable(t.tableName)}
                          className="rounded-full p-0.5 text-neutral-400 hover:bg-neutral-200 hover:text-neutral-700 dark:hover:bg-neutral-700"
                          title="移除该表"
                        >
                          <X className="h-2.5 w-2.5" strokeWidth={2.5} />
                        </button>
                      </span>
                    );
                  })}
                </div>
              )}

              {activeTable && (
                <span className="tabular-nums text-neutral-400">{activeTable.rowCount} 行 · {activeTable.columns.length} 列</span>
              )}

              {activeTable && activeTable.sheets && activeTable.sheets.length > 1 && (
                <label className="flex items-center gap-1 text-[11px] text-neutral-500">
                  sheet
                  <select
                    value={activeTable.currentSheet ?? activeTable.sheets[0]}
                    onChange={(e) => void changeSheet(activeTable, e.target.value)}
                    className="rounded border border-neutral-300 bg-white px-1.5 py-0.5 text-[11px] text-neutral-700 outline-none focus:border-blue-400 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-200"
                  >
                    {activeTable.sheets.map((s) => (
                      <option key={s} value={s}>{s}</option>
                    ))}
                  </select>
                </label>
              )}

              <div className="ml-auto flex items-center gap-1">
                {loadedTables.length >= 2 && (
                  <button
                    onClick={() => setShowJoin((v) => !v)}
                    className={`mr-1 inline-flex items-center gap-1 rounded px-2 py-0.5 text-[11px] ${
                      showJoin
                        ? "bg-indigo-600 text-white"
                        : "border border-indigo-200 text-indigo-600 hover:bg-indigo-50 dark:border-indigo-800 dark:text-indigo-300 dark:hover:bg-indigo-950/40"
                    }`}
                  >
                    <Link2 className="h-3.5 w-3.5" strokeWidth={1.75} />
                    关联 (JOIN)
                  </button>
                )}
                {tabBtn("chart", "图表")}
                {tabBtn("profile", "剖析报告")}
                <button
                  onClick={() => setViewTab("insights")}
                  className={`inline-flex items-center gap-1 rounded px-2 py-0.5 text-[11px] ${
                    viewTab === "insights"
                      ? "bg-neutral-900 text-white dark:bg-neutral-100 dark:text-neutral-900"
                      : "text-neutral-500 hover:bg-neutral-100 dark:hover:bg-neutral-800"
                  }`}
                >
                  <Sparkles className="h-3.5 w-3.5" strokeWidth={1.75} />
                  自动洞察
                </button>
              </div>
            </div>

            {showJoin && loadedTables.length >= 2 && (
              <JoinBuilder
                tables={loadedTables.map((t) => ({ tableName: t.tableName, label: t.label, fields: t.fields }))}
                onJoined={registerJoinedTable}
              />
            )}

            <div className="flex min-h-0 flex-1">
              <div className="w-48 shrink-0 border-r border-neutral-200 dark:border-neutral-800">
                <FieldList fields={activeTable?.fields ?? []} />
              </div>

              <div className="flex min-w-0 flex-1 flex-col">
                {loading && (
                  <div className="flex flex-1 items-center justify-center gap-2 text-[13px] text-neutral-500">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    加载中...
                  </div>
                )}
                {!loading && error && (
                  <div className="flex flex-1 flex-col items-center justify-center gap-2 p-4 text-[12px]">
                    <div className="text-red-500">加载错误</div>
                    <pre className="max-w-2xl overflow-auto rounded bg-neutral-100 p-2 text-[11px] dark:bg-neutral-800">{error}</pre>
                  </div>
                )}
                {!loading && !error && !activeTable && (
                  <div className="flex flex-1 items-center justify-center text-[13px] text-neutral-500">
                    从左侧选择 csv / xlsx 文件开始探索
                  </div>
                )}
                {!loading && !error && activeTable && viewTab === "chart" && (
                  <ChartCanvas tableName={activeTable.tableName} config={config} fieldsByName={fieldsByName} />
                )}
                {!loading && !error && activeTable && viewTab === "profile" && (
                  <ProfileReport
                    rowCount={activeTable.rowCount}
                    columns={activeTable.columns}
                    onChangeKind={(column, kind) => void changeColumnKind(activeTable, column, kind)}
                  />
                )}
                {!loading && !error && activeTable && viewTab === "insights" && (
                  <InsightsReport
                    key={activeTable.tableName}
                    tableName={activeTable.tableName}
                    rowCount={activeTable.rowCount}
                    columns={activeTable.columns}
                  />
                )}
              </div>

              <div className="w-64 shrink-0">
                <ConfigPanel config={config} onChange={setConfig} fields={activeTable?.fields ?? []} />
              </div>
            </div>
          </div>
        </div>
      </div>
    </DndContext>
  );
}
