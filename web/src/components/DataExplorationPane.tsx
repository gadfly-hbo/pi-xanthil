// LLM_FORBIDDEN: this module must never call any LLM API.
// Data Exploration: csv/xlsx → duckdb-wasm → drag-and-drop BI.
// All computation runs in the browser. Server only streams raw bytes.
// DO NOT import any LLM-related api method (chat/generate*/extract*/clarify*).

import { useCallback, useEffect, useMemo, useState } from "react";
import { DndContext, type DragEndEvent } from "@dnd-kit/core";
import { ShieldAlert, Loader2 } from "lucide-react";
import { FileSelector, type FileChoice, type Scope } from "./data-exploration/FileSelector";
import { FieldList } from "./data-exploration/FieldList";
import { ConfigPanel, type ChartConfig } from "./data-exploration/ConfigPanel";
import { ChartCanvas } from "./data-exploration/ChartCanvas";
import { ProfileReport } from "./data-exploration/ProfileReport";
import { registerFile } from "@/lib/duckdb";
import { profileTable, type ColumnProfile, type FieldSchema } from "@/lib/profiling";

interface Props {
  scope: Scope | null;
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
  rowCount: number;
  fields: FieldSchema[];
  columns: ColumnProfile[];
}

type ViewTab = "chart" | "profile";

function sanitizeTableName(fileName: string): string {
  const base = fileName.replace(/\.[^.]+$/, "");
  const safe = base.replace(/[^A-Za-z0-9_\u4e00-\u9fa5]/g, "_");
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

export function DataExplorationPane({ scope }: Props) {
  const [selectedFile, setSelectedFile] = useState<FileChoice | null>(null);
  const [loaded, setLoaded] = useState<LoadedTable | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [config, setConfig] = useState<ChartConfig>(DEFAULT_CONFIG);
  const [viewTab, setViewTab] = useState<ViewTab>("chart");

  const fieldsByName = useMemo(() => {
    const map: Record<string, FieldSchema> = {};
    for (const f of loaded?.fields ?? []) map[f.name] = f;
    return map;
  }, [loaded]);

  const loadFile = useCallback(async (choice: FileChoice) => {
    setLoading(true);
    setError(null);
    setLoaded(null);
    try {
      const bytes = await fetchBinary(choice);
      const tableName = sanitizeTableName(choice.fileName);
      await registerFile({ tableName, fileName: choice.fileName, bytes });
      const profile = await profileTable(tableName);
      setLoaded({ tableName, ...profile });
      setConfig(DEFAULT_CONFIG);
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (selectedFile) void loadFile(selectedFile);
  }, [selectedFile, loadFile]);

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

  return (
    <DndContext onDragEnd={handleDragEnd}>
      <div className="flex h-full min-h-0 flex-col">
        <div className="flex items-center gap-2 border-b border-red-300 bg-red-50 px-3 py-1.5 text-[11px] text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
          <ShieldAlert className="h-3.5 w-3.5 shrink-0" strokeWidth={2} />
          <span>数据安全：本模块所有计算在浏览器本地完成，数据永不发送给 LLM 或第三方服务</span>
        </div>

        <div className="flex min-h-0 flex-1">
          <div className="w-64 shrink-0">
            <FileSelector scope={scope} onSelect={setSelectedFile} selected={selectedFile} />
          </div>

          <div className="flex min-w-0 flex-1 flex-col">
            <div className="flex items-center gap-3 border-b border-neutral-200 px-3 py-2 text-[12px] dark:border-neutral-800">
              {selectedFile ? (
                <>
                  <span className="font-medium text-neutral-900 dark:text-neutral-100">{selectedFile.fileName}</span>
                  <span className="text-neutral-400">·</span>
                  <span className="text-neutral-500">[{selectedFile.folder === "draw_data" ? "原始" : "聚合"}] {selectedFile.pathLabel}</span>
                  {loaded && (
                    <>
                      <span className="text-neutral-400">·</span>
                      <span className="tabular-nums text-neutral-500">{loaded.rowCount} 行 · {loaded.columns.length} 列</span>
                    </>
                  )}
                </>
              ) : (
                <span className="text-neutral-500">请从左侧选择文件</span>
              )}
              <div className="ml-auto flex items-center gap-1">
                <button
                  onClick={() => setViewTab("chart")}
                  className={`rounded px-2 py-0.5 text-[11px] ${
                    viewTab === "chart"
                      ? "bg-neutral-900 text-white dark:bg-neutral-100 dark:text-neutral-900"
                      : "text-neutral-500 hover:bg-neutral-100 dark:hover:bg-neutral-800"
                  }`}
                >
                  图表
                </button>
                <button
                  onClick={() => setViewTab("profile")}
                  className={`rounded px-2 py-0.5 text-[11px] ${
                    viewTab === "profile"
                      ? "bg-neutral-900 text-white dark:bg-neutral-100 dark:text-neutral-900"
                      : "text-neutral-500 hover:bg-neutral-100 dark:hover:bg-neutral-800"
                  }`}
                >
                  剖析报告
                </button>
              </div>
            </div>

            <div className="flex min-h-0 flex-1">
              <div className="w-48 shrink-0 border-r border-neutral-200 dark:border-neutral-800">
                <FieldList fields={loaded?.fields ?? []} />
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
                {!loading && !error && !loaded && (
                  <div className="flex flex-1 items-center justify-center text-[13px] text-neutral-500">
                    从左侧选择 csv / xlsx 文件开始探索
                  </div>
                )}
                {!loading && !error && loaded && viewTab === "chart" && (
                  <ChartCanvas tableName={loaded.tableName} config={config} fieldsByName={fieldsByName} />
                )}
                {!loading && !error && loaded && viewTab === "profile" && (
                  <ProfileReport rowCount={loaded.rowCount} columns={loaded.columns} />
                )}
              </div>

              <div className="w-64 shrink-0">
                <ConfigPanel config={config} onChange={setConfig} fields={loaded?.fields ?? []} />
              </div>
            </div>
          </div>
        </div>
      </div>
    </DndContext>
  );
}
