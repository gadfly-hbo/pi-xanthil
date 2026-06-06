// LLM_FORBIDDEN: this module must never call any LLM API.
// Drop zones for X/Y/color, plus chart-type / aggregation / filter / time-granularity selectors.

import { useDroppable } from "@dnd-kit/core";
import { X } from "lucide-react";
import type { FieldSchema } from "@/lib/profiling";

export type ChartType = "bar" | "line" | "area" | "scatter" | "heatmap" | "boxplot" | "pie" | "table";
export type Aggregation = "sum" | "avg" | "count" | "min" | "max" | "count_distinct";
export type TimeGranularity = "day" | "week" | "month" | "quarter" | "year";

export interface Filter {
  field: string;
  op: "eq" | "neq" | "in" | "gt" | "lt" | "between";
  value: string;
}

export interface ChartConfig {
  chartType: ChartType;
  xField: FieldSchema | null;
  yField: FieldSchema | null;
  colorField: FieldSchema | null;
  aggregation: Aggregation;
  filters: Filter[];
  timeGranularity: TimeGranularity;
  limit: number;
}

interface DropSlotProps {
  id: string;
  label: string;
  field: FieldSchema | null;
  onClear: () => void;
}

function DropSlot({ id, label, field, onClear }: DropSlotProps) {
  const { setNodeRef, isOver } = useDroppable({ id });
  return (
    <div className="mb-2">
      <div className="mb-1 text-[10px] font-medium uppercase tracking-wide text-neutral-500">{label}</div>
      <div
        ref={setNodeRef}
        className={`flex min-h-[28px] items-center gap-1 rounded border border-dashed px-2 py-1 text-[12px] ${
          isOver
            ? "border-blue-400 bg-blue-50 dark:border-blue-600 dark:bg-blue-950/50"
            : field
              ? "border-neutral-300 bg-white dark:border-neutral-700 dark:bg-neutral-900"
              : "border-neutral-300 bg-neutral-50 text-neutral-400 dark:border-neutral-700 dark:bg-neutral-800/40"
        }`}
      >
        {field ? (
          <>
            <span className="truncate text-neutral-700 dark:text-neutral-300">{field.name}</span>
            <span className="text-[9px] text-neutral-400">{field.kind}</span>
            <button onClick={onClear} className="ml-auto rounded p-0.5 text-neutral-400 hover:bg-neutral-200 dark:hover:bg-neutral-700">
              <X className="h-3 w-3" strokeWidth={2} />
            </button>
          </>
        ) : (
          <span>拖入字段</span>
        )}
      </div>
    </div>
  );
}

interface Props {
  config: ChartConfig;
  onChange: (next: ChartConfig) => void;
  fields: FieldSchema[];
}

const CHART_OPTIONS: { id: ChartType; label: string }[] = [
  { id: "bar", label: "柱状图" },
  { id: "line", label: "折线图" },
  { id: "area", label: "面积图" },
  { id: "scatter", label: "散点图" },
  { id: "heatmap", label: "热力图" },
  { id: "boxplot", label: "箱线图" },
  { id: "pie", label: "饼图" },
  { id: "table", label: "表格" },
];

const AGG_OPTIONS: { id: Aggregation; label: string }[] = [
  { id: "sum", label: "求和" },
  { id: "avg", label: "均值" },
  { id: "count", label: "计数" },
  { id: "min", label: "最小" },
  { id: "max", label: "最大" },
  { id: "count_distinct", label: "去重计数" },
];

const TIME_OPTIONS: { id: TimeGranularity; label: string }[] = [
  { id: "day", label: "日" },
  { id: "week", label: "周" },
  { id: "month", label: "月" },
  { id: "quarter", label: "季" },
  { id: "year", label: "年" },
];

export function ConfigPanel({ config, onChange, fields }: Props) {
  const update = (patch: Partial<ChartConfig>) => onChange({ ...config, ...patch });

  const addFilter = () => {
    const firstField = fields[0];
    if (!firstField) return;
    update({ filters: [...config.filters, { field: firstField.name, op: "eq", value: "" }] });
  };

  const updateFilter = (idx: number, patch: Partial<Filter>) => {
    const next = config.filters.slice();
    next[idx] = { ...next[idx]!, ...patch };
    update({ filters: next });
  };

  const removeFilter = (idx: number) => {
    update({ filters: config.filters.filter((_, i) => i !== idx) });
  };

  const isTimeX = config.xField?.kind === "datetime";

  return (
    <div className="flex h-full flex-col border-l border-neutral-200 bg-neutral-50/40 dark:border-neutral-800 dark:bg-neutral-900/40">
      <div className="border-b border-neutral-200 px-3 py-2 text-[11px] font-medium uppercase tracking-wide text-neutral-500 dark:border-neutral-800">
        图表配置
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        <div className="mb-3">
          <div className="mb-1 text-[10px] font-medium uppercase tracking-wide text-neutral-500">图表类型</div>
          <select
            value={config.chartType}
            onChange={(e) => update({ chartType: e.target.value as ChartType })}
            className="w-full rounded border border-neutral-300 bg-white px-2 py-1 text-[12px] dark:border-neutral-700 dark:bg-neutral-900"
          >
            {CHART_OPTIONS.map((opt) => (
              <option key={opt.id} value={opt.id}>{opt.label}</option>
            ))}
          </select>
        </div>

        <DropSlot
          id="drop:x"
          label="X 轴 / 维度"
          field={config.xField}
          onClear={() => update({ xField: null })}
        />
        <DropSlot
          id="drop:y"
          label="Y 轴 / 度量"
          field={config.yField}
          onClear={() => update({ yField: null })}
        />
        <DropSlot
          id="drop:color"
          label="颜色 / 分组"
          field={config.colorField}
          onClear={() => update({ colorField: null })}
        />

        <div className="mb-3">
          <div className="mb-1 text-[10px] font-medium uppercase tracking-wide text-neutral-500">聚合方式</div>
          <select
            value={config.aggregation}
            onChange={(e) => update({ aggregation: e.target.value as Aggregation })}
            className="w-full rounded border border-neutral-300 bg-white px-2 py-1 text-[12px] dark:border-neutral-700 dark:bg-neutral-900"
          >
            {AGG_OPTIONS.map((opt) => (
              <option key={opt.id} value={opt.id}>{opt.label}</option>
            ))}
          </select>
        </div>

        {isTimeX && (
          <div className="mb-3">
            <div className="mb-1 text-[10px] font-medium uppercase tracking-wide text-neutral-500">时间粒度</div>
            <select
              value={config.timeGranularity}
              onChange={(e) => update({ timeGranularity: e.target.value as TimeGranularity })}
              className="w-full rounded border border-neutral-300 bg-white px-2 py-1 text-[12px] dark:border-neutral-700 dark:bg-neutral-900"
            >
              {TIME_OPTIONS.map((opt) => (
                <option key={opt.id} value={opt.id}>{opt.label}</option>
              ))}
            </select>
          </div>
        )}

        <div className="mb-3">
          <div className="mb-1 text-[10px] font-medium uppercase tracking-wide text-neutral-500">结果上限</div>
          <input
            type="number"
            min={10}
            max={10000}
            value={config.limit}
            onChange={(e) => update({ limit: Math.max(10, Math.min(10000, Number(e.target.value) || 1000)) })}
            className="w-full rounded border border-neutral-300 bg-white px-2 py-1 text-[12px] dark:border-neutral-700 dark:bg-neutral-900"
          />
        </div>

        <div className="mb-3">
          <div className="mb-1 flex items-center justify-between">
            <div className="text-[10px] font-medium uppercase tracking-wide text-neutral-500">筛选</div>
            <button
              onClick={addFilter}
              disabled={fields.length === 0}
              className="rounded px-1.5 py-0.5 text-[11px] text-blue-600 hover:bg-blue-50 disabled:opacity-50 dark:text-blue-400 dark:hover:bg-blue-950"
            >
              + 添加
            </button>
          </div>
          {config.filters.map((filter, idx) => (
            <div key={idx} className="mb-1 flex items-center gap-1">
              <select
                value={filter.field}
                onChange={(e) => updateFilter(idx, { field: e.target.value })}
                className="min-w-0 flex-1 rounded border border-neutral-300 bg-white px-1 py-0.5 text-[11px] dark:border-neutral-700 dark:bg-neutral-900"
              >
                {fields.map((f) => (
                  <option key={f.name} value={f.name}>{f.name}</option>
                ))}
              </select>
              <select
                value={filter.op}
                onChange={(e) => updateFilter(idx, { op: e.target.value as Filter["op"] })}
                className="rounded border border-neutral-300 bg-white px-1 py-0.5 text-[11px] dark:border-neutral-700 dark:bg-neutral-900"
              >
                <option value="eq">=</option>
                <option value="neq">≠</option>
                <option value="gt">&gt;</option>
                <option value="lt">&lt;</option>
                <option value="in">in</option>
              </select>
              <input
                value={filter.value}
                onChange={(e) => updateFilter(idx, { value: e.target.value })}
                placeholder="值"
                className="w-20 rounded border border-neutral-300 bg-white px-1 py-0.5 text-[11px] dark:border-neutral-700 dark:bg-neutral-900"
              />
              <button onClick={() => removeFilter(idx)} className="rounded p-0.5 text-neutral-400 hover:bg-neutral-200 dark:hover:bg-neutral-700">
                <X className="h-3 w-3" strokeWidth={2} />
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
