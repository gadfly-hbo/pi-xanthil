import * as XLSX from "xlsx";

export type AggregateValue = string | number | boolean | Date | null;
export type AggregateRow = Record<string, AggregateValue>;
export type ColumnType = "number" | "date" | "boolean" | "text";
export type AggregateOperation = "sum" | "count" | "avg" | "min" | "max";
export type DateGranularity = "day" | "month" | "year";

export interface AggregateColumn {
  name: string;
  type: ColumnType;
  nullCount: number;
}

export interface AggregateMetric {
  column: string | null;
  operation: AggregateOperation;
}

export interface AggregateDsl {
  groupBy: string[];
  dateColumn: string | null;
  dateGranularity: DateGranularity;
  metrics: AggregateMetric[];
  minGroupSize: number;
}

export interface AggregateResult {
  rows: Record<string, string | number>[];
  filteredGroupCount: number;
}

export interface LocalDataset {
  sheetName: string;
  rows: AggregateRow[];
  columns: AggregateColumn[];
}

const DATE_PATTERN = /^\d{4}[-/.]\d{1,2}[-/.]\d{1,2}(?:[ T].*)?$/;

function isEmpty(value: unknown): boolean {
  return value === null || value === undefined || value === "";
}

function inferValueType(value: AggregateValue): ColumnType {
  if (typeof value === "number" && Number.isFinite(value)) return "number";
  if (typeof value === "boolean") return "boolean";
  if (value instanceof Date && !Number.isNaN(value.getTime())) return "date";
  if (typeof value === "string" && DATE_PATTERN.test(value.trim()) && !Number.isNaN(Date.parse(value))) return "date";
  return "text";
}

function inferColumnType(values: AggregateValue[]): ColumnType {
  const types = new Set(values.filter((value) => !isEmpty(value)).map(inferValueType));
  if (types.size === 0) return "text";
  if (types.size === 1) return [...types][0]!;
  return "text";
}

export function inferColumns(rows: AggregateRow[], names?: string[]): AggregateColumn[] {
  const columnNames = names ?? [...new Set(rows.flatMap((row) => Object.keys(row)))];
  return columnNames.map((name) => {
    const values = rows.map((row) => row[name] ?? null);
    return {
      name,
      type: inferColumnType(values),
      nullCount: values.filter(isEmpty).length,
    };
  });
}

function normalizeRows(sheet: XLSX.WorkSheet): LocalDataset {
  const matrix = XLSX.utils.sheet_to_json<AggregateValue[]>(sheet, {
    header: 1,
    raw: true,
    defval: null,
  });
  const headers = (matrix[0] ?? []).map((value, index) => {
    const text = String(value ?? "").trim();
    return text || `column_${index + 1}`;
  });
  const uniqueHeaders = headers.map((name, index) => (
    headers.indexOf(name) === index ? name : `${name}_${index + 1}`
  ));
  const rows = matrix.slice(1).map((values) => Object.fromEntries(
    uniqueHeaders.map((name, index) => [name, values[index] ?? null]),
  ));
  return { sheetName: "", rows, columns: inferColumns(rows, uniqueHeaders) };
}

export async function readLocalDataset(file: File): Promise<LocalDataset> {
  const workbook = XLSX.read(await file.arrayBuffer(), { type: "array", cellDates: true });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) throw new Error("文件中没有可读取的工作表");
  const sheet = workbook.Sheets[sheetName];
  if (!sheet) throw new Error("无法读取第一个工作表");
  return { ...normalizeRows(sheet), sheetName };
}

function dateBucket(value: AggregateValue, granularity: DateGranularity): string {
  if (isEmpty(value)) return "(empty)";
  const date = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(date.getTime())) return "(invalid date)";
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  if (granularity === "year") return String(year);
  if (granularity === "month") return `${year}-${month}`;
  return `${year}-${month}-${day}`;
}

function metricName(metric: AggregateMetric): string {
  return metric.operation === "count" && !metric.column
    ? "count"
    : `${metric.operation}_${metric.column}`;
}

function numericValues(rows: AggregateRow[], column: string | null): number[] {
  if (!column) return [];
  return rows
    .map((row) => row[column])
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value));
}

function calculateMetric(rows: AggregateRow[], metric: AggregateMetric): number {
  if (metric.operation === "count") {
    if (!metric.column) return rows.length;
    return rows.filter((row) => !isEmpty(row[metric.column!])).length;
  }
  const values = numericValues(rows, metric.column);
  if (values.length === 0) return 0;
  if (metric.operation === "sum") return values.reduce((sum, value) => sum + value, 0);
  if (metric.operation === "avg") return values.reduce((sum, value) => sum + value, 0) / values.length;
  if (metric.operation === "min") return Math.min(...values);
  return Math.max(...values);
}

export function runAggregation(rows: AggregateRow[], dsl: AggregateDsl): AggregateResult {
  if (dsl.metrics.length === 0) throw new Error("至少选择一个聚合指标");
  const groups = new Map<string, { dimensions: Record<string, string>; rows: AggregateRow[] }>();
  for (const row of rows) {
    const dimensions = Object.fromEntries(dsl.groupBy.map((column) => [column, String(row[column] ?? "(empty)")]));
    if (dsl.dateColumn) dimensions[`${dsl.dateColumn}_${dsl.dateGranularity}`] = dateBucket(row[dsl.dateColumn] ?? null, dsl.dateGranularity);
    const key = JSON.stringify(dimensions);
    const group = groups.get(key) ?? { dimensions, rows: [] };
    group.rows.push(row);
    groups.set(key, group);
  }
  const filteredGroupCount = [...groups.values()].filter((group) => group.rows.length < dsl.minGroupSize).length;
  const output = [...groups.values()]
    .filter((group) => group.rows.length >= dsl.minGroupSize)
    .map((group) => ({
      ...group.dimensions,
      ...Object.fromEntries(dsl.metrics.map((metric) => [metricName(metric), calculateMetric(group.rows, metric)])),
      group_count: group.rows.length,
    }));
  return { rows: output, filteredGroupCount };
}

function csvCell(value: string | number): string {
  const text = String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, "\"\"")}"` : text;
}

export function toCsv(rows: Record<string, string | number>[]): string {
  const headers = [...new Set(rows.flatMap((row) => Object.keys(row)))];
  return [headers, ...rows.map((row) => headers.map((header) => row[header] ?? ""))]
    .map((row) => row.map(csvCell).join(","))
    .join("\n");
}

export function buildPythonPrompt(columns: AggregateColumn[], requirement: string, minGroupSize: number): string {
  const schema = columns.map((column) => `- ${column.name}: ${column.type}, null_count=${column.nullCount}`).join("\n");
  return [
    "请生成一段可在本地运行的 Python 脚本。",
    "安全要求：不要索取、输出或推断任何明细行；不要使用网络；只读取用户运行时传入的本地 CSV / XLSX / XLS 文件路径。",
    "输出要求：将聚合结果写入本地 CSV；默认过滤记录数小于阈值的分组；代码需包含清晰的运行方式和错误处理。",
    "",
    "数据表 schema（不含任何明细值）：",
    schema,
    "",
    `最小分组阈值：count >= ${minGroupSize}`,
    "计算需求：",
    requirement.trim() || "请根据用户后续补充的聚合需求生成代码。",
  ].join("\n");
}
