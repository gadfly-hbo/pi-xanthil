// LLM_FORBIDDEN: this module must never call any LLM API.
// Layer 2 auto-insights UI. All metrics come from lib/insights (pure algorithm
// in duckdb-wasm / local JS). Manual trigger because pairwise stats can be slow.

import { useMemo, useState } from "react";
import { Loader2, Sparkles, AlertTriangle } from "lucide-react";
import {
  computeCorrelationMatrix,
  computeCategoryNumericAssociation,
  detectDataQualityFlags,
  type CorrelationMatrix,
  type CategoryNumericAssoc,
  type QualitySeverity,
} from "@/lib/insights";
import type { ColumnProfile } from "@/lib/profiling";

interface Props {
  tableName: string;
  rowCount: number;
  columns: ColumnProfile[];
}

const MAX_CORR_COLS = 25;
const MAX_CAT_COLS = 10;
const MAX_NUM_COLS = 15;

function corrCellColor(v: number | null): string {
  if (v === null) return "transparent";
  const a = Math.min(1, Math.abs(v)) * 0.85;
  return v >= 0 ? `rgba(37,99,235,${a})` : `rgba(220,38,38,${a})`;
}

const SEVERITY_STYLE: Record<QualitySeverity, string> = {
  high: "border-red-200 bg-red-50 text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300",
  medium: "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-300",
  low: "border-neutral-200 bg-neutral-50 text-neutral-600 dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-400",
};

const SEVERITY_LABEL: Record<QualitySeverity, string> = { high: "高", medium: "中", low: "低" };

export function InsightsReport({ tableName, rowCount, columns }: Props) {
  const [loading, setLoading] = useState(false);
  const [computed, setComputed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [corr, setCorr] = useState<CorrelationMatrix | null>(null);
  const [assoc, setAssoc] = useState<CategoryNumericAssoc[]>([]);

  const numericCols = useMemo(() => columns.filter((c) => c.kind === "number").map((c) => c.name), [columns]);
  const catCols = useMemo(
    () => columns.filter((c) => (c.kind === "category" || c.kind === "boolean") && c.distinctCount <= 50).map((c) => c.name),
    [columns],
  );

  // Quality flags are pure JS over existing profiles → compute immediately.
  const qualityFlags = useMemo(() => detectDataQualityFlags(rowCount, columns), [rowCount, columns]);

  const corrInput = numericCols.slice(0, MAX_CORR_COLS);
  const catInput = catCols.slice(0, MAX_CAT_COLS);
  const numInput = numericCols.slice(0, MAX_NUM_COLS);

  const handleCompute = async () => {
    setLoading(true);
    setError(null);
    try {
      const [matrix, associations] = await Promise.all([
        computeCorrelationMatrix(tableName, corrInput),
        computeCategoryNumericAssociation(tableName, catInput, numInput),
      ]);
      setCorr(matrix);
      setAssoc(associations);
      setComputed(true);
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex h-full flex-col overflow-y-auto p-4">
      <div className="mb-3 flex items-center gap-3">
        <button
          onClick={() => void handleCompute()}
          disabled={loading}
          className="inline-flex items-center gap-1.5 rounded-md bg-neutral-900 px-3 py-1.5 text-[12px] font-medium text-white hover:bg-neutral-800 disabled:opacity-50 dark:bg-neutral-100 dark:text-neutral-900"
        >
          {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" strokeWidth={1.75} />}
          {computed ? "重新计算洞察" : "计算洞察"}
        </button>
        <span className="text-[11px] text-neutral-400">
          数值列 {numericCols.length} · 类别列 {catCols.length}
          {numericCols.length > MAX_CORR_COLS && `（相关性仅取前 ${MAX_CORR_COLS} 个数值列）`}
        </span>
      </div>

      {error && (
        <div className="mb-3 rounded border border-red-200 bg-red-50 px-3 py-2 text-[12px] text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300">{error}</div>
      )}

      {/* 数据质量提示 (always available) */}
      <Section title="数据质量提示" icon={<AlertTriangle className="h-3.5 w-3.5 text-amber-500" strokeWidth={1.75} />}>
        {qualityFlags.length === 0 ? (
          <div className="text-[12px] text-neutral-500">未发现明显的数据质量问题。</div>
        ) : (
          <div className="flex flex-col gap-1.5">
            {qualityFlags.map((f, i) => (
              <div key={i} className={`flex items-center gap-2 rounded border px-2.5 py-1.5 text-[12px] ${SEVERITY_STYLE[f.severity]}`}>
                <span className="shrink-0 rounded px-1 text-[10px] font-medium opacity-80">{SEVERITY_LABEL[f.severity]}</span>
                <span className="font-medium">{f.column}</span>
                <span className="opacity-90">{f.message}</span>
              </div>
            ))}
          </div>
        )}
      </Section>

      {/* 相关性矩阵 */}
      <Section title="相关性矩阵 (Pearson)">
        {!computed ? (
          <div className="text-[12px] text-neutral-400">点击「计算洞察」生成。</div>
        ) : !corr || corr.columns.length < 2 ? (
          <div className="text-[12px] text-neutral-500">数值列不足 2 个，无法计算相关性。</div>
        ) : (
          <div className="overflow-auto">
            <table className="border-collapse text-[11px]">
              <thead>
                <tr>
                  <th className="sticky left-0 z-10 bg-white p-1 dark:bg-neutral-950" />
                  {corr.columns.map((c) => (
                    <th key={c} className="max-w-[80px] truncate p-1 text-left font-medium text-neutral-500" title={c}>{c}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {corr.columns.map((rowName, i) => (
                  <tr key={rowName}>
                    <td className="sticky left-0 z-10 max-w-[120px] truncate bg-white p-1 font-medium text-neutral-600 dark:bg-neutral-950 dark:text-neutral-300" title={rowName}>{rowName}</td>
                    {corr.columns.map((colName, j) => {
                      const v = corr.matrix[i]![j]!;
                      const strong = v !== null && Math.abs(v) > 0.5;
                      return (
                        <td
                          key={colName}
                          className="p-1 text-center tabular-nums"
                          style={{ backgroundColor: corrCellColor(v), color: strong ? "#fff" : undefined }}
                          title={`${rowName} ~ ${colName}: ${v === null ? "—" : v.toFixed(3)}`}
                        >
                          {v === null ? "—" : v.toFixed(2)}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="mt-1.5 text-[10.5px] text-neutral-400">蓝=正相关，红=负相关，颜色越深相关性越强。</div>
          </div>
        )}
      </Section>

      {/* 类别 × 数值关联强度 */}
      <Section title="类别 × 数值 关联强度 (η²)">
        {!computed ? (
          <div className="text-[12px] text-neutral-400">点击「计算洞察」生成。</div>
        ) : assoc.length === 0 ? (
          <div className="text-[12px] text-neutral-500">无可计算的类别×数值组合。</div>
        ) : (
          <div className="flex flex-col gap-1">
            {assoc.slice(0, 20).map((a, i) => (
              <div key={i} className="flex items-center gap-2 text-[11.5px]">
                <span className="w-48 shrink-0 truncate text-neutral-600 dark:text-neutral-300" title={`${a.category} → ${a.numeric}`}>
                  {a.category} <span className="text-neutral-400">→</span> {a.numeric}
                </span>
                <div className="h-2 flex-1 overflow-hidden rounded bg-neutral-100 dark:bg-neutral-800">
                  <div className="h-full bg-indigo-500" style={{ width: `${a.eta2 * 100}%` }} />
                </div>
                <span className="w-12 shrink-0 text-right tabular-nums text-neutral-500">{(a.eta2 * 100).toFixed(0)}%</span>
              </div>
            ))}
            <div className="mt-1 text-[10.5px] text-neutral-400">η² 表示该类别变量能解释数值变量方差的比例（越高关联越强）。</div>
          </div>
        )}
      </Section>
    </div>
  );
}

function Section({ title, icon, children }: { title: string; icon?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="mb-4">
      <div className="mb-2 flex items-center gap-1.5 text-[12px] font-semibold text-neutral-700 dark:text-neutral-300">
        {icon}
        {title}
      </div>
      {children}
    </div>
  );
}
