// LLM_FORBIDDEN: this module must never call any LLM API.
import { useEffect, useMemo, useRef, useState } from "react";
import { Download, Copy, Check } from "lucide-react";
import { quoteIdent, quoteString, runQuery, type QueryRow } from "@/lib/duckdb";
import type { ChartConfig } from "./ConfigPanel";
import type { FieldSchema } from "@/lib/profiling";

const CHART_TYPE_LABELS: Record<string, string> = {
  bar: "柱状图", line: "折线图", area: "面积图", scatter: "散点图",
  heatmap: "热力图", boxplot: "箱线图", pie: "饼图", table: "表格",
};

const AGG_LABELS: Record<string, string> = {
  sum: "求和", avg: "均值", count: "计数", min: "最小值", max: "最大值", count_distinct: "去重计数",
};

const MAX_COPY_ROWS = 100;

// Build a Markdown snippet (chart description + aggregated data table) for the
// user to paste into a report. Pure client-side; data values stay local.
function buildConclusionMarkdown(tableName: string, config: ChartConfig, rows: QueryRow[]): string {
  const { chartType, xField, yField, colorField, aggregation } = config;
  const parts: string[] = [];
  parts.push(`类型=${CHART_TYPE_LABELS[chartType] ?? chartType}`);
  if (xField) parts.push(`X=${xField.name}`);
  if (chartType !== "scatter" && chartType !== "table") {
    parts.push(`Y=${AGG_LABELS[aggregation] ?? aggregation}(${yField?.name ?? "*"})`);
  } else if (yField) {
    parts.push(`Y=${yField.name}`);
  }
  if (colorField) parts.push(`颜色=${colorField.name}`);
  const activeFilters = config.filters.filter((f) => f.value?.trim());
  if (activeFilters.length > 0) {
    parts.push(`筛选=${activeFilters.map((f) => `${f.field} ${f.op} ${f.value}`).join("; ")}`);
  }

  const lines: string[] = [`### ${tableName} · ${parts.join(" · ")}`, ""];

  if (rows.length > 0) {
    const columns = Object.keys(rows[0]!);
    const fmt = (v: unknown) => (v === null || v === undefined ? "" : String(v).replace(/\|/g, "\\|"));
    lines.push(`| ${columns.join(" | ")} |`);
    lines.push(`| ${columns.map(() => "---").join(" | ")} |`);
    for (const row of rows.slice(0, MAX_COPY_ROWS)) {
      lines.push(`| ${columns.map((c) => fmt(row[c])).join(" | ")} |`);
    }
    if (rows.length > MAX_COPY_ROWS) {
      lines.push("");
      lines.push(`> 仅复制前 ${MAX_COPY_ROWS} 行，共 ${rows.length} 行。`);
    }
  }
  return lines.join("\n");
}

interface Props {
  tableName: string;
  config: ChartConfig;
  fieldsByName: Record<string, FieldSchema>;
}

function aggExpr(agg: string, field: FieldSchema | null): string {
  if (agg === "count") return "COUNT(*)";
  if (!field) return "COUNT(*)";
  const ident = quoteIdent(field.name);
  switch (agg) {
    case "sum": return `SUM(${ident})`;
    case "avg": return `AVG(${ident})`;
    case "min": return `MIN(${ident})`;
    case "max": return `MAX(${ident})`;
    case "count_distinct": return `COUNT(DISTINCT ${ident})`;
    default: return `COUNT(${ident})`;
  }
}

function timeBucketExpr(field: FieldSchema, granularity: string): string {
  const ident = quoteIdent(field.name);
  switch (granularity) {
    case "day": return `DATE_TRUNC('day', ${ident})`;
    case "week": return `DATE_TRUNC('week', ${ident})`;
    case "month": return `DATE_TRUNC('month', ${ident})`;
    case "quarter": return `DATE_TRUNC('quarter', ${ident})`;
    case "year": return `DATE_TRUNC('year', ${ident})`;
    default: return ident;
  }
}

function buildWhereClause(config: ChartConfig, fieldsByName: Record<string, FieldSchema>): string {
  const clauses: string[] = [];
  for (const filter of config.filters) {
    if (!filter.value) continue;
    const field = fieldsByName[filter.field];
    if (!field) continue;
    const ident = quoteIdent(filter.field);
    const isNumeric = field.kind === "number";
    const raw = filter.value.trim();
    const literal = isNumeric && !isNaN(Number(raw)) ? raw : quoteString(raw);
    switch (filter.op) {
      case "eq": clauses.push(`${ident} = ${literal}`); break;
      case "neq": clauses.push(`${ident} <> ${literal}`); break;
      case "gt": clauses.push(`${ident} > ${literal}`); break;
      case "lt": clauses.push(`${ident} < ${literal}`); break;
      case "in": {
        const parts = raw.split(",").map((p) => p.trim()).filter(Boolean);
        if (parts.length === 0) break;
        const list = parts.map((p) => (isNumeric && !isNaN(Number(p)) ? p : quoteString(p))).join(", ");
        clauses.push(`${ident} IN (${list})`);
        break;
      }
    }
  }
  return clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
}

function buildSql(tableName: string, config: ChartConfig, fieldsByName: Record<string, FieldSchema>): string | null {
  const { xField, yField, colorField, aggregation, chartType, limit, timeGranularity } = config;
  const table = quoteIdent(tableName);
  const where = buildWhereClause(config, fieldsByName);

  if (chartType === "table") {
    return `SELECT * FROM ${table} ${where} LIMIT ${limit}`;
  }
  if (!xField) return null;

  const xExpr = xField.kind === "datetime"
    ? `${timeBucketExpr(xField, timeGranularity)} AS x`
    : `${quoteIdent(xField.name)} AS x`;
  const groupX = xField.kind === "datetime"
    ? timeBucketExpr(xField, timeGranularity)
    : quoteIdent(xField.name);

  if (chartType === "scatter") {
    if (!yField) return null;
    const colorSelect = colorField ? `, ${quoteIdent(colorField.name)} AS color` : "";
    return `SELECT ${quoteIdent(xField.name)} AS x, ${quoteIdent(yField.name)} AS y${colorSelect} FROM ${table} ${where} LIMIT ${limit}`;
  }

  if (chartType === "heatmap") {
    if (!yField) return null;
    const yIdent = quoteIdent(yField.name);
    return `SELECT ${xExpr}, ${yIdent} AS y, ${aggExpr(aggregation, colorField)} AS v FROM ${table} ${where} GROUP BY ${groupX}, ${yIdent} ORDER BY x, y LIMIT ${limit}`;
  }

  if (chartType === "pie") {
    return `SELECT ${xExpr}, ${aggExpr(aggregation, yField)} AS y FROM ${table} ${where} GROUP BY ${groupX} ORDER BY y DESC LIMIT ${limit}`;
  }

  if (colorField && chartType !== "boxplot") {
    const colorIdent = quoteIdent(colorField.name);
    return `SELECT ${xExpr}, ${colorIdent} AS color, ${aggExpr(aggregation, yField)} AS y FROM ${table} ${where} GROUP BY ${groupX}, ${colorIdent} ORDER BY x LIMIT ${limit}`;
  }

  if (chartType === "boxplot") {
    if (!yField) return null;
    return `SELECT ${xExpr}, ${quoteIdent(yField.name)} AS y FROM ${table} ${where} LIMIT ${limit}`;
  }

  return `SELECT ${xExpr}, ${aggExpr(aggregation, yField)} AS y FROM ${table} ${where} GROUP BY ${groupX} ORDER BY x LIMIT ${limit}`;
}

function buildChartOption(config: ChartConfig, rows: QueryRow[]): Record<string, unknown> | null {
  if (rows.length === 0) return null;
  const { chartType, xField, colorField } = config;
  const baseTheme = {
    grid: { left: 50, right: 24, top: 32, bottom: 48, containLabel: true },
    tooltip: { trigger: "axis" as const },
    legend: colorField ? { type: "scroll" as const, top: 0 } : undefined,
  };

  if (chartType === "pie") {
    return {
      tooltip: { trigger: "item" },
      legend: { type: "scroll", top: 0 },
      series: [{
        type: "pie",
        radius: ["30%", "70%"],
        data: rows.map((r) => ({ name: String(r.x), value: Number(r.y) })),
      }],
    };
  }

  if (chartType === "scatter") {
    if (colorField) {
      const grouped = new Map<string, [unknown, unknown][]>();
      for (const r of rows) {
        const key = String(r.color);
        if (!grouped.has(key)) grouped.set(key, []);
        grouped.get(key)!.push([r.x, r.y]);
      }
      return {
        ...baseTheme,
        tooltip: { trigger: "item" },
        legend: { type: "scroll", top: 0 },
        xAxis: { type: xField?.kind === "number" ? "value" : "category" },
        yAxis: { type: "value" },
        series: Array.from(grouped.entries()).map(([name, data]) => ({
          name,
          type: "scatter",
          data,
        })),
      };
    }
    return {
      ...baseTheme,
      tooltip: { trigger: "item" },
      xAxis: { type: xField?.kind === "number" ? "value" : "category" },
      yAxis: { type: "value" },
      series: [{ type: "scatter", data: rows.map((r) => [r.x, r.y]) }],
    };
  }

  if (chartType === "heatmap") {
    const xValues = Array.from(new Set(rows.map((r) => String(r.x))));
    const yValues = Array.from(new Set(rows.map((r) => String(r.y))));
    const values = rows.map((r) => Number(r.v));
    const min = Math.min(...values);
    const max = Math.max(...values);
    return {
      tooltip: { position: "top" },
      grid: { left: 80, right: 24, top: 32, bottom: 80, containLabel: true },
      xAxis: { type: "category", data: xValues, splitArea: { show: true } },
      yAxis: { type: "category", data: yValues, splitArea: { show: true } },
      visualMap: { min, max, calculable: true, orient: "horizontal", left: "center", bottom: 0 },
      series: [{
        type: "heatmap",
        data: rows.map((r) => [xValues.indexOf(String(r.x)), yValues.indexOf(String(r.y)), Number(r.v)]),
      }],
    };
  }

  if (chartType === "boxplot") {
    const grouped = new Map<string, number[]>();
    for (const r of rows) {
      const key = String(r.x);
      if (!grouped.has(key)) grouped.set(key, []);
      const y = Number(r.y);
      if (Number.isFinite(y)) grouped.get(key)!.push(y);
    }
    const categories = Array.from(grouped.keys());
    const boxData = categories.map((cat) => {
      const arr = grouped.get(cat)!.slice().sort((a, b) => a - b);
      const q = (p: number) => {
        const idx = (arr.length - 1) * p;
        const lo = Math.floor(idx);
        const hi = Math.ceil(idx);
        return arr[lo]! + (arr[hi]! - arr[lo]!) * (idx - lo);
      };
      return [arr[0]!, q(0.25), q(0.5), q(0.75), arr[arr.length - 1]!];
    });
    return {
      ...baseTheme,
      tooltip: { trigger: "item" },
      xAxis: { type: "category", data: categories },
      yAxis: { type: "value" },
      series: [{ type: "boxplot", data: boxData }],
    };
  }

  if (colorField) {
    const colorValues = Array.from(new Set(rows.map((r) => String(r.color))));
    const xValues = Array.from(new Set(rows.map((r) => String(r.x))));
    const seriesType = chartType === "area" ? "line" : chartType;
    return {
      ...baseTheme,
      xAxis: { type: "category", data: xValues },
      yAxis: { type: "value" },
      series: colorValues.map((cv) => ({
        name: cv,
        type: seriesType,
        ...(chartType === "area" ? { areaStyle: {} } : {}),
        data: xValues.map((xv) => {
          const row = rows.find((r) => String(r.x) === xv && String(r.color) === cv);
          return row ? Number(row.y) : null;
        }),
      })),
    };
  }

  const seriesType = chartType === "area" ? "line" : chartType;
  return {
    ...baseTheme,
    xAxis: { type: "category", data: rows.map((r) => String(r.x)) },
    yAxis: { type: "value" },
    series: [{
      type: seriesType,
      ...(chartType === "area" ? { areaStyle: {} } : {}),
      data: rows.map((r) => Number(r.y)),
    }],
  };
}

export function ChartCanvas({ tableName, config, fieldsByName }: Props) {
  const sql = useMemo(() => buildSql(tableName, config, fieldsByName), [tableName, config, fieldsByName]);
  const [rows, setRows] = useState<QueryRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const echartsInstanceRef = useRef<unknown>(null);
  const [copied, setCopied] = useState(false);

  const handleExportPng = () => {
    const inst = echartsInstanceRef.current as { getDataURL?: (o: object) => string } | null;
    const url = inst?.getDataURL?.({ type: "png", pixelRatio: 2, backgroundColor: "#fff" });
    if (!url) return;
    const a = document.createElement("a");
    a.href = url;
    a.download = `${tableName}-${config.chartType}-${Date.now()}.png`;
    a.click();
  };

  const handleCopyConclusion = () => {
    const md = buildConclusionMarkdown(tableName, config, rows);
    void navigator.clipboard.writeText(md).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  useEffect(() => {
    if (!sql) {
      setRows([]);
      setError(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    void runQuery(sql)
      .then((result) => {
        if (cancelled) return;
        setRows(result);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(String(err));
        setRows([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [sql]);

  useEffect(() => {
    if (config.chartType === "table") return;
    if (!containerRef.current || rows.length === 0) return;
    let cancelled = false;
    void import("echarts").then((echarts) => {
      if (cancelled || !containerRef.current) return;
      const option = buildChartOption(config, rows);
      if (!option) return;
      let instance = echartsInstanceRef.current as ReturnType<typeof echarts.init> | null;
      if (!instance) {
        instance = echarts.init(containerRef.current);
        echartsInstanceRef.current = instance;
      }
      instance.setOption(option, true);
      const resize = () => instance?.resize();
      window.addEventListener("resize", resize);
      return () => window.removeEventListener("resize", resize);
    });
    return () => { cancelled = true; };
  }, [config, rows]);

  useEffect(() => {
    return () => {
      const inst = echartsInstanceRef.current as { dispose?: () => void } | null;
      inst?.dispose?.();
      echartsInstanceRef.current = null;
    };
  }, []);

  if (!sql) {
    return (
      <div className="flex flex-1 items-center justify-center text-[13px] text-neutral-500">
        请拖入维度 (X) 与度量 (Y) 字段
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 p-4 text-[12px]">
        <div className="text-red-500">查询错误</div>
        <pre className="max-w-2xl overflow-auto rounded bg-neutral-100 p-2 text-[11px] dark:bg-neutral-800">{error}</pre>
        <details className="text-neutral-400">
          <summary className="cursor-pointer">查看 SQL</summary>
          <pre className="mt-1 max-w-2xl overflow-auto rounded bg-neutral-100 p-2 text-[11px] dark:bg-neutral-800">{sql}</pre>
        </details>
      </div>
    );
  }

  if (loading) {
    return <div className="flex flex-1 items-center justify-center text-[13px] text-neutral-500">查询中...</div>;
  }

  if (rows.length === 0) {
    return <div className="flex flex-1 items-center justify-center text-[13px] text-neutral-500">无数据</div>;
  }

  if (config.chartType === "table") {
    const columns = Object.keys(rows[0]!);
    return (
      <div className="flex-1 overflow-auto p-2">
        <table className="min-w-full border-collapse text-[12px]">
          <thead className="sticky top-0 bg-neutral-100 dark:bg-neutral-800">
            <tr>
              {columns.map((col) => (
                <th key={col} className="border border-neutral-200 px-2 py-1 text-left font-medium text-neutral-700 dark:border-neutral-700 dark:text-neutral-300">
                  {col}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, idx) => (
              <tr key={idx} className="hover:bg-neutral-50 dark:hover:bg-neutral-900">
                {columns.map((col) => (
                  <td key={col} className="border border-neutral-200 px-2 py-1 text-neutral-600 dark:border-neutral-800 dark:text-neutral-400">
                    {row[col] === null || row[col] === undefined ? "—" : String(row[col])}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center justify-end gap-1.5 border-b border-neutral-200 px-3 py-1.5 dark:border-neutral-800">
        <button
          onClick={handleExportPng}
          className="inline-flex items-center gap-1 rounded px-2 py-0.5 text-[11px] text-neutral-600 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-800"
          title="导出当前图表为 PNG"
        >
          <Download className="h-3.5 w-3.5" strokeWidth={1.75} />
          导出 PNG
        </button>
        <button
          onClick={handleCopyConclusion}
          className="inline-flex items-center gap-1 rounded px-2 py-0.5 text-[11px] text-neutral-600 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-800"
          title="复制图表描述 + 聚合数据表（Markdown），可粘贴进报告"
        >
          {copied ? <Check className="h-3.5 w-3.5 text-emerald-600" strokeWidth={2} /> : <Copy className="h-3.5 w-3.5" strokeWidth={1.75} />}
          {copied ? "已复制" : "复制结论"}
        </button>
      </div>
      <div ref={containerRef} className="min-h-0 flex-1" style={{ minHeight: 360 }} />
    </div>
  );
}
