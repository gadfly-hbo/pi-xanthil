import { useRef, useState } from "react";
import {
  Loader2,
  Upload,
  FileSpreadsheet,
  Trash2,
  X,
  SwitchCamera,
  Database,
  FlaskConical,
} from "lucide-react";
import { cn } from "@/lib/cn";
import type { BiDatasetSummary } from "@/types";

interface BiImportDialogProps {
  open: boolean;
  onClose: () => void;
  onImport: (file: File) => Promise<void>;
  onSwitch: (id: string) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  currentId: string | undefined;
  history: BiDatasetSummary[];
  importing: boolean;
}

export function BiImportDialog({
  open,
  onClose,
  onImport,
  onSwitch,
  onDelete,
  currentId,
  history,
  importing,
}: BiImportDialogProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  if (!open) return null;

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    void onImport(file);
    e.target.value = "";
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm" onClick={onClose}>
      <div
        className="mx-4 w-full max-w-lg rounded-2xl border border-neutral-200 bg-white shadow-xl dark:border-neutral-700 dark:bg-neutral-900"
        onClick={(e) => e.stopPropagation()}
      >
        {/* header */}
        <div className="flex items-center justify-between border-b border-neutral-200 px-5 py-3.5 dark:border-neutral-700">
          <div className="flex items-center gap-2">
            <Database className="h-4 w-4 text-neutral-500" strokeWidth={1.75} />
            <h2 className="text-[14px] font-semibold text-neutral-900 dark:text-neutral-100">数据管理</h2>
          </div>
          <button onClick={onClose} className="rounded p-1 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-600 dark:hover:bg-neutral-800">
            <X className="h-4 w-4" strokeWidth={1.75} />
          </button>
        </div>

        <div className="space-y-4 p-5">
          {/* Upload */}
          <div>
            <input ref={inputRef} type="file" accept=".csv,.tsv,.xlsx,.xls" onChange={handleFileChange} className="hidden" />
            <button
              onClick={() => inputRef.current?.click()}
              disabled={importing}
              className={cn(
                "flex w-full items-center justify-center gap-2 rounded-lg border-2 border-dashed px-4 py-4 text-[13px] font-medium transition-colors",
                "border-neutral-300 text-neutral-500 hover:border-emerald-400 hover:bg-emerald-50 hover:text-emerald-700",
                "dark:border-neutral-600 dark:text-neutral-400 dark:hover:border-emerald-500 dark:hover:bg-emerald-950/30 dark:hover:text-emerald-300",
                importing && "pointer-events-none opacity-50",
              )}
            >
              {importing ? (
                <Loader2 className="h-5 w-5 animate-spin" strokeWidth={1.75} />
              ) : (
                <Upload className="h-5 w-5" strokeWidth={1.75} />
              )}
              {importing ? "导入中…" : "上传 CSV / XLSX 数据文件"}
            </button>
            <p className="mt-1.5 text-[11px] text-neutral-400 dark:text-neutral-500">支持 .csv .tsv .xlsx .xls，列名自动匹配</p>
          </div>

          {/* Current dataset info */}
          {currentId && (
            <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3.5 py-2.5 dark:border-emerald-900 dark:bg-emerald-950/30">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Database className="h-4 w-4 text-emerald-600 dark:text-emerald-400" strokeWidth={1.75} />
                  <span className="text-[12px] font-medium text-emerald-800 dark:text-emerald-200">当前使用</span>
                </div>
                <span className="text-[11px] text-emerald-600 dark:text-emerald-400">激活</span>
              </div>
            </div>
          )}

          {/* History list */}
          {history.length > 0 && (
            <div>
              <h3 className="mb-2 text-[11.5px] font-medium uppercase tracking-wider text-neutral-400 dark:text-neutral-500">
                历史导入 ({history.length})
              </h3>
              <div className="max-h-52 space-y-1 overflow-y-auto">
                {history.map((item) => (
                  <div
                    key={item.id}
                    className={cn(
                      "flex items-center justify-between rounded-lg px-3 py-2 text-[12px]",
                      currentId === item.id
                        ? "bg-emerald-50 text-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-200"
                        : "bg-neutral-50 text-neutral-600 hover:bg-neutral-100 dark:bg-neutral-950/30 dark:text-neutral-400 dark:hover:bg-neutral-800/50",
                    )}
                  >
                    <div className="flex min-w-0 items-center gap-2">
                      <FileSpreadsheet className="h-3.5 w-3.5 shrink-0" strokeWidth={1.75} />
                      <span className="truncate font-medium">{item.filename}</span>
                      <span className="shrink-0 text-neutral-400">
                        {item.rowCount} 行 × {item.columnCount} 列
                      </span>
                    </div>
                    <div className="ml-2 flex shrink-0 items-center gap-1">
                      {currentId !== item.id && (
                        <button
                          onClick={() => void onSwitch(item.id)}
                          className="rounded p-1 text-neutral-400 hover:bg-neutral-200 hover:text-neutral-600 dark:hover:bg-neutral-700 dark:hover:text-neutral-300"
                          title="切换到此数据集"
                        >
                          <SwitchCamera className="h-3.5 w-3.5" strokeWidth={1.75} />
                        </button>
                      )}
                      {confirmDelete === item.id ? (
                        <div className="flex items-center gap-1">
                          <button
                            onClick={() => {
                              void onDelete(item.id);
                              setConfirmDelete(null);
                            }}
                            className="rounded bg-red-500 px-2 py-0.5 text-[11px] text-white hover:bg-red-600"
                          >
                            确认删除
                          </button>
                          <button
                            onClick={() => setConfirmDelete(null)}
                            className="rounded px-1.5 py-0.5 text-[11px] text-neutral-400 hover:text-neutral-600"
                          >
                            取消
                          </button>
                        </div>
                      ) : (
                        <button
                          onClick={() => setConfirmDelete(item.id)}
                          className="rounded p-1 text-neutral-400 hover:bg-red-100 hover:text-red-600 dark:hover:bg-red-950/30"
                          title="删除"
                        >
                          <Trash2 className="h-3.5 w-3.5" strokeWidth={1.75} />
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* empty state */}
          {history.length === 0 && (
            <div className="rounded-lg border border-neutral-200 bg-neutral-50 px-4 py-6 text-center text-[12px] text-neutral-400 dark:border-neutral-700 dark:bg-neutral-900">
              <FlaskConical className="mx-auto mb-2 h-6 w-6" strokeWidth={1.5} />
              暂无导入数据，上传 CSV/XLSX 开始
            </div>
          )}
        </div>
      </div>
    </div>
  );
}