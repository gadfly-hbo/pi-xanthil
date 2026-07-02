// LLM_FORBIDDEN: this module must never call any LLM API.
// Local exploration overview built only from browser-side column profiles.

import { AlertTriangle, BarChart3, Clock3, Database, GitCompare, LineChart, ScatterChart, Table2 } from "lucide-react";
import { detectDataQualityFlags, type QualitySeverity } from "@/lib/insights";
import type { ColumnProfile, FieldSchema, FieldKind } from "@/lib/profiling";
import type { Aggregation, ChartConfig, ChartType, TimeGranularity } from "./ConfigPanel";
import type { ReactNode } from "react";

interface Props {
  label: string;
  rowCount: number;
  fields: FieldSchema[];
  columns: ColumnProfile[];
  baseConfig: ChartConfig;
  onApplyConfig: (config: ChartConfig) => void;
  onOpenProfile: () => void;
  onOpenInsights: () => void;
}

interface ExplorationSuggestion {
  id: string;
  title: string;
  description: string;
  detail: string;
  chartType: ChartType;
  aggregation: Aggregation;
  xField: FieldSchema | null;
  yField: FieldSchema | null;
  colorField: FieldSchema | null;
  timeGranularity: TimeGranularity;
  icon: ReactNode;
}

const KIND_LABEL: Record<FieldKind, string> = {
  number: "数值",
  datetime: "时间",
  boolean: "布尔",
  category: "类别",
  text: "文本",
  id: "ID",
};

const SEVERITY_STYLE: Record<QualitySeverity, string> = {
  high: "border-red-200 bg-red-50 text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300",
  medium: "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-300",
  low: "border-neutral-200 bg-neutral-50 text-neutral-600 dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-400",
};

const SEVERITY_LABEL: Record<QualitySeverity, string> = { high: "高", medium: "中", low: "低" };

function fmtInt(n: number): string {
  return new Intl.NumberFormat("zh-CN").format(n);
}

function fieldOf(fields: FieldSchema[], name: string | undefined): FieldSchema | null {
  if (!name) return null;
  return fields.find((f) => f.name === name) ?? null;
}

function topByMissing(columns: ColumnProfile[]): ColumnProfile[] {
  return columns
    .filter((c) => c.nullCount > 0)
    .slice()
    .sort((a, b) => b.nullRatio - a.nullRatio)
    .slice(0, 4);
}

function topCategories(columns: ColumnProfile[]): ColumnProfile[] {
  return columns
    .filter((c) => c.kind === "category" || c.kind === "boolean")
    .slice()
    .sort((a, b) => b.distinctCount - a.distinctCount)
    .slice(0, 6);
}

function bestNumeric(columns: ColumnProfile[]): ColumnProfile[] {
  return columns
    .filter((c) => c.kind === "number")
    .slice()
    .sort((a, b) => {
      const aScore = (a.stddev ?? 0) + (a.outlierCount ?? 0);
      const bScore = (b.stddev ?? 0) + (b.outlierCount ?? 0);
      return bScore - aScore;
    });
}

function buildSuggestions(fields: FieldSchema[], columns: ColumnProfile[]): ExplorationSuggestion[] {
  const suggestions: ExplorationSuggestion[] = [];
  const datetime = columns.find((c) => c.kind === "datetime");
  const categories = topCategories(columns);
  const numerics = bestNumeric(columns);
  const primaryNumber = fieldOf(fields, numerics[0]?.name);
  const secondaryNumber = fieldOf(fields, numerics[1]?.name);
  const primaryCategory = fieldOf(fields, categories[0]?.name);
  const secondaryCategory = fieldOf(fields, categories[1]?.name);
  const timeField = fieldOf(fields, datetime?.name);

  if (timeField && primaryNumber) {
    suggestions.push({
      id: `time:${timeField.name}:${primaryNumber.name}`,
      title: "看时间趋势",
      description: `${primaryNumber.name} 是否随 ${timeField.name} 波动`,
      detail: "适合先判断周期、拐点和异常月份。",
      chartType: "line",
      aggregation: "sum",
      xField: timeField,
      yField: primaryNumber,
      colorField: null,
      timeGranularity: "month",
      icon: <LineChart className="h-4 w-4" strokeWidth={1.75} />,
    });
  }

  if (primaryCategory && primaryNumber) {
    suggestions.push({
      id: `rank:${primaryCategory.name}:${primaryNumber.name}`,
      title: "看分类排行",
      description: `按 ${primaryCategory.name} 汇总 ${primaryNumber.name}`,
      detail: "适合找主力类别、长尾类别和异常贡献。",
      chartType: "bar",
      aggregation: "sum",
      xField: primaryCategory,
      yField: primaryNumber,
      colorField: null,
      timeGranularity: "month",
      icon: <BarChart3 className="h-4 w-4" strokeWidth={1.75} />,
    });
  }

  if (primaryCategory && primaryNumber) {
    suggestions.push({
      id: `dist:${primaryCategory.name}:${primaryNumber.name}`,
      title: "看分布差异",
      description: `比较不同 ${primaryCategory.name} 下 ${primaryNumber.name} 的分布`,
      detail: "适合检查类别之间是否存在稳定差异或离群值。",
      chartType: "boxplot",
      aggregation: "avg",
      xField: primaryCategory,
      yField: primaryNumber,
      colorField: null,
      timeGranularity: "month",
      icon: <GitCompare className="h-4 w-4" strokeWidth={1.75} />,
    });
  }

  if (primaryNumber && secondaryNumber) {
    suggestions.push({
      id: `scatter:${primaryNumber.name}:${secondaryNumber.name}`,
      title: "看指标关系",
      description: `${primaryNumber.name} 与 ${secondaryNumber.name} 是否同向变化`,
      detail: secondaryCategory ? `可用 ${secondaryCategory.name} 上色，查看分组差异。` : "适合发现相关性、分层和异常点。",
      chartType: "scatter",
      aggregation: "avg",
      xField: primaryNumber,
      yField: secondaryNumber,
      colorField: secondaryCategory,
      timeGranularity: "month",
      icon: <ScatterChart className="h-4 w-4" strokeWidth={1.75} />,
    });
  }

  suggestions.push({
    id: "table:sample",
    title: "查看明细表",
    description: "先浏览有限行数，确认字段含义和取值形态",
    detail: "表格只在浏览器本地渲染，适合定位字段口径。",
    chartType: "table",
    aggregation: "count",
    xField: null,
    yField: null,
    colorField: null,
    timeGranularity: "month",
    icon: <Table2 className="h-4 w-4" strokeWidth={1.75} />,
  });

  return suggestions.slice(0, 5);
}

export function ExplorationOverview({
  label,
  rowCount,
  fields,
  columns,
  baseConfig,
  onApplyConfig,
  onOpenProfile,
  onOpenInsights,
}: Props) {
  const kindCounts = fields.reduce<Record<FieldKind, number>>(
    (acc, field) => ({ ...acc, [field.kind]: acc[field.kind] + 1 }),
    { number: 0, datetime: 0, boolean: 0, category: 0, text: 0, id: 0 },
  );
  const qualityFlags = detectDataQualityFlags(rowCount, columns);
  const missingColumns = topByMissing(columns);
  const suggestions = buildSuggestions(fields, columns);
  const numericCount = kindCounts.number;
  const dimensionCount = kindCounts.category + kindCounts.boolean;

  const applySuggestion = (suggestion: ExplorationSuggestion) => {
    onApplyConfig({
      ...baseConfig,
      chartType: suggestion.chartType,
      xField: suggestion.xField,
      yField: suggestion.yField,
      colorField: suggestion.colorField,
      aggregation: suggestion.aggregation,
      timeGranularity: suggestion.timeGranularity,
      filters: [],
      limit: suggestion.chartType === "table" ? 200 : baseConfig.limit,
    });
  };

  return (
    <div className="min-h-0 flex-1 overflow-y-auto bg-white p-4 dark:bg-neutral-950">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-[13px] font-semibold text-neutral-900 dark:text-neutral-100">
            <Database className="h-4 w-4 text-blue-600 dark:text-blue-400" strokeWidth={1.75} />
            <span className="truncate">{label}</span>
          </div>
          <div className="mt-1 text-[12px] text-neutral-500">
            {fmtInt(rowCount)} 行 · {fmtInt(columns.length)} 列 · {numericCount} 个数值字段 · {dimensionCount} 个可分组维度
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          <button
            onClick={onOpenProfile}
            className="rounded border border-neutral-200 px-2 py-1 text-[11px] text-neutral-600 hover:bg-neutral-50 dark:border-neutral-800 dark:text-neutral-300 dark:hover:bg-neutral-900"
          >
            字段剖析
          </button>
          <button
            onClick={onOpenInsights}
            className="rounded bg-neutral-900 px-2 py-1 text-[11px] text-white hover:bg-neutral-800 dark:bg-neutral-100 dark:text-neutral-900"
          >
            计算洞察
          </button>
        </div>
      </div>

      <div className="mb-4 grid grid-cols-2 gap-2 lg:grid-cols-6">
        {(Object.keys(KIND_LABEL) as FieldKind[]).map((kind) => (
          <div key={kind} className="rounded border border-neutral-200 bg-neutral-50 px-3 py-2 dark:border-neutral-800 dark:bg-neutral-900">
            <div className="text-[10px] text-neutral-500">{KIND_LABEL[kind]}</div>
            <div className="mt-1 text-[18px] font-semibold tabular-nums text-neutral-900 dark:text-neutral-100">{kindCounts[kind]}</div>
          </div>
        ))}
      </div>

      <div className="grid min-w-0 gap-4 xl:grid-cols-[minmax(0,1.35fr)_minmax(280px,0.65fr)]">
        <section className="min-w-0">
          <div className="mb-2 flex items-center gap-2">
            <Clock3 className="h-3.5 w-3.5 text-neutral-500" strokeWidth={1.75} />
            <h3 className="text-[12px] font-semibold text-neutral-700 dark:text-neutral-300">推荐探索</h3>
          </div>
          <div className="grid gap-2 lg:grid-cols-2">
            {suggestions.map((suggestion) => (
              <button
                key={suggestion.id}
                onClick={() => applySuggestion(suggestion)}
                className="min-w-0 rounded border border-neutral-200 bg-white p-3 text-left hover:border-blue-300 hover:bg-blue-50/40 dark:border-neutral-800 dark:bg-neutral-950 dark:hover:border-blue-800 dark:hover:bg-blue-950/20"
              >
                <div className="mb-1 flex items-center gap-2">
                  <span className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded bg-neutral-100 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300">
                    {suggestion.icon}
                  </span>
                  <div className="min-w-0">
                    <div className="truncate text-[12px] font-semibold text-neutral-900 dark:text-neutral-100">{suggestion.title}</div>
                    <div className="truncate text-[11px] text-neutral-500">{suggestion.chartType} · {suggestion.aggregation}</div>
                  </div>
                </div>
                <div className="text-[12px] text-neutral-700 dark:text-neutral-300">{suggestion.description}</div>
                <div className="mt-1 text-[11px] text-neutral-400">{suggestion.detail}</div>
              </button>
            ))}
          </div>
        </section>

        <aside className="min-w-0">
          <div className="mb-2 flex items-center gap-2">
            <AlertTriangle className="h-3.5 w-3.5 text-amber-500" strokeWidth={1.75} />
            <h3 className="text-[12px] font-semibold text-neutral-700 dark:text-neutral-300">质量与可用性</h3>
          </div>

          <div className="space-y-2">
            {qualityFlags.length === 0 ? (
              <div className="rounded border border-emerald-200 bg-emerald-50 px-3 py-2 text-[12px] text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-300">
                未发现明显的数据质量问题。
              </div>
            ) : (
              qualityFlags.slice(0, 5).map((flag, index) => (
                <div key={`${flag.column}:${index}`} className={`rounded border px-3 py-2 text-[12px] ${SEVERITY_STYLE[flag.severity]}`}>
                  <div className="flex items-center gap-2">
                    <span className="shrink-0 rounded px-1 text-[10px] font-medium opacity-80">{SEVERITY_LABEL[flag.severity]}</span>
                    <span className="min-w-0 truncate font-medium">{flag.column}</span>
                  </div>
                  <div className="mt-0.5 opacity-90">{flag.message}</div>
                </div>
              ))
            )}

            {missingColumns.length > 0 && (
              <div className="rounded border border-neutral-200 bg-neutral-50 p-3 dark:border-neutral-800 dark:bg-neutral-900">
                <div className="mb-2 text-[11px] font-medium text-neutral-600 dark:text-neutral-300">缺失率最高</div>
                <div className="space-y-1.5">
                  {missingColumns.map((column) => (
                    <div key={column.name} className="flex items-center gap-2 text-[11px]">
                      <span className="min-w-0 flex-1 truncate text-neutral-600 dark:text-neutral-300">{column.name}</span>
                      <div className="h-1.5 w-20 overflow-hidden rounded bg-neutral-200 dark:bg-neutral-800">
                        <div className="h-full bg-amber-500" style={{ width: `${Math.min(100, column.nullRatio * 100)}%` }} />
                      </div>
                      <span className="w-11 text-right tabular-nums text-neutral-500">{(column.nullRatio * 100).toFixed(0)}%</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}
