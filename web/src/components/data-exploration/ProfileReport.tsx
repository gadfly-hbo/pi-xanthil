// LLM_FORBIDDEN: this module must never call any LLM API.
// Pure-frontend column profiling report.

import type { ColumnProfile, FieldKind } from "@/lib/profiling";

const KIND_OPTIONS: FieldKind[] = ["number", "datetime", "boolean", "category", "text", "id"];

interface Props {
  rowCount: number;
  columns: ColumnProfile[];
  // #6: manual column-type override (re-profiles the table). Omit to disable.
  onChangeKind?: (column: string, kind: FieldKind) => void;
}

function fmtNum(n: number | null | undefined, digits = 2): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "—";
  if (Math.abs(n) >= 1e6) return n.toExponential(2);
  if (Number.isInteger(n)) return n.toString();
  return n.toFixed(digits);
}

function fmtRatio(r: number): string {
  return `${(r * 100).toFixed(1)}%`;
}

export function ProfileReport({ rowCount, columns, onChangeKind }: Props) {
  return (
    <div className="flex h-full flex-col overflow-y-auto p-4">
      <div className="mb-4 flex items-baseline gap-4 text-[12px] text-neutral-600 dark:text-neutral-400">
        <span>总行数: <span className="font-medium tabular-nums text-neutral-900 dark:text-neutral-100">{rowCount}</span></span>
        <span>列数: <span className="font-medium tabular-nums text-neutral-900 dark:text-neutral-100">{columns.length}</span></span>
      </div>
      <div className="space-y-3">
        {columns.map((col) => (
          <div key={col.name} className="rounded-lg border border-neutral-200 bg-white p-3 dark:border-neutral-800 dark:bg-neutral-900">
            <div className="mb-2 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="text-[13px] font-medium text-neutral-900 dark:text-neutral-100">{col.name}</span>
                {onChangeKind ? (
                  <select
                    value={col.kind}
                    onChange={(e) => onChangeKind(col.name, e.target.value as FieldKind)}
                    className="rounded border border-neutral-300 bg-white px-1 py-0.5 text-[10px] uppercase text-neutral-600 outline-none focus:border-blue-400 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-300"
                    title="手动修正列类型（将重新剖析该表）"
                  >
                    {KIND_OPTIONS.map((k) => (
                      <option key={k} value={k}>{k}</option>
                    ))}
                  </select>
                ) : (
                  <span className="rounded bg-neutral-100 px-1.5 py-0.5 text-[10px] uppercase text-neutral-600 dark:bg-neutral-800 dark:text-neutral-400">
                    {col.kind}
                  </span>
                )}
                <span className="text-[10px] text-neutral-400">{col.sqlType}</span>
              </div>
              <div className="text-[11px] text-neutral-500">
                {col.nullCount > 0 && (
                  <span className="mr-2">缺失 {fmtRatio(col.nullRatio)}</span>
                )}
                <span>独立值 {col.distinctCount}</span>
              </div>
            </div>

            {col.kind === "number" && (
              <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-[11px] text-neutral-600 dark:text-neutral-400 md:grid-cols-4">
                <div>最小: <span className="tabular-nums">{fmtNum(Number(col.min))}</span></div>
                <div>最大: <span className="tabular-nums">{fmtNum(Number(col.max))}</span></div>
                <div>均值: <span className="tabular-nums">{fmtNum(col.mean)}</span></div>
                <div>中位: <span className="tabular-nums">{fmtNum(col.median)}</span></div>
                <div>标准差: <span className="tabular-nums">{fmtNum(col.stddev)}</span></div>
                <div>Q1: <span className="tabular-nums">{fmtNum(col.q1)}</span></div>
                <div>Q3: <span className="tabular-nums">{fmtNum(col.q3)}</span></div>
                {col.outlierCount !== undefined && col.outlierCount !== null && (
                  <div>离群点: <span className="tabular-nums text-amber-600">{col.outlierCount}</span></div>
                )}
              </div>
            )}

            {col.kind === "datetime" && (
              <div className="grid grid-cols-2 gap-x-4 text-[11px] text-neutral-600 dark:text-neutral-400">
                <div>最早: <span>{col.min ?? "—"}</span></div>
                <div>最新: <span>{col.max ?? "—"}</span></div>
              </div>
            )}

            {col.topValues && col.topValues.length > 0 && (
              <div className="mt-1">
                <div className="mb-1 text-[10px] font-medium uppercase tracking-wide text-neutral-500">TOP 值</div>
                <div className="space-y-0.5">
                  {col.topValues.map((tv) => (
                    <div key={tv.value} className="flex items-center gap-2 text-[11px]">
                      <span className="min-w-0 flex-1 truncate text-neutral-700 dark:text-neutral-300">{tv.value || "(空)"}</span>
                      <div className="h-1.5 w-20 overflow-hidden rounded bg-neutral-100 dark:bg-neutral-800">
                        <div className="h-full bg-blue-500" style={{ width: `${tv.ratio * 100}%` }} />
                      </div>
                      <span className="w-16 text-right tabular-nums text-neutral-500">{tv.count} ({fmtRatio(tv.ratio)})</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
