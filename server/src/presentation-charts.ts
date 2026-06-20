import type { BiDatasetDetail, PresentationChartSpec, PresentationDatasetMeta } from "./types.ts";

// ChartSpec/DatasetMeta = 汇报可视化契约单一真源（types.ts）的本地别名，便于内部书写。
// 契约：服务端确定性产出，前端 ReactECharts 直接喂 option。
// 数据=已脱敏聚合 BI dataset；本模块禁触 draw_data，禁把任何 row 内容回灌 LLM。
export type ChartSpec = PresentationChartSpec;
export type DatasetMeta = PresentationDatasetMeta;

function norm(s: string): string {
  return String(s ?? "").toLowerCase().replace(/[\s_\-/]+/g, "");
}

function matchColumn(columns: string[], aliases: string[]): string | undefined {
  const normAliases = aliases.map(norm);
  for (const col of columns) if (normAliases.includes(norm(col))) return col;
  for (const col of columns) {
    const nc = norm(col);
    for (const a of normAliases) {
      if (a.length >= 2 && (nc.includes(a) || a.includes(nc))) return col;
    }
  }
  return undefined;
}

function toNumber(value: unknown): number | null {
  if (value == null || value === "") return null;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const s = String(value).trim().replace(/,/g, "").replace(/%$/, "");
  const n = Number(s);
  if (!Number.isFinite(n)) return null;
  if (typeof value === "string" && value.trim().endsWith("%")) return n / 100;
  return n;
}

function toRatio(value: unknown): number | null {
  if (value == null || value === "") return null;
  const isPercentString = typeof value === "string" && value.trim().endsWith("%");
  const n = toNumber(value);
  if (n == null) return null;
  if (isPercentString) return n;
  return n > 1.5 ? n / 100 : n;
}

const COHORT_ALIASES = ["cohort", "首单月份", "月份", "分组", "群组", "month"];
const NEW_USERS_ALIASES = ["newUsers", "新客数", "新客总数", "新增用户", "新增", "new_users"];
const MONTH_ALIASES = ["month", "当月", "统计月份", "月份", "归属月", "月"];
const REPURCHASE_ALIASES = [
  "repurchaseUsers",
  "总回购老客",
  "回购老客数",
  "回购老客",
  "老客回购数",
  "老客数",
  "复购老客",
  "复购人数",
  "repurchase_users",
];

function buildRetentionCharts(detail: BiDatasetDetail): ChartSpec[] {
  const cohortKey = matchColumn(detail.columns, COHORT_ALIASES);
  const newUsersKey = matchColumn(detail.columns, NEW_USERS_ALIASES);
  const periodKeys = detail.columns.filter((c) => c !== cohortKey && c !== newUsersKey);
  if (periodKeys.length === 0) return [];

  const cohorts: string[] = detail.rows.map((r, i) =>
    cohortKey ? String(r[cohortKey] ?? `row_${i + 1}`) : `row_${i + 1}`,
  );
  const newUsers: number[] = detail.rows.map((r) =>
    newUsersKey ? Number(toNumber(r[newUsersKey]) ?? 0) : 0,
  );

  // chart 1: 各 cohort × 各期留存率折线（百分比）
  const lineSeries = periodKeys.map((pk) => ({
    name: pk,
    type: "line",
    smooth: true,
    data: detail.rows.map((r) => {
      const v = toRatio(r[pk]);
      return v == null ? null : Math.round(v * 10000) / 100; // 百分比，2 位小数
    }),
  }));

  const retentionLine: ChartSpec = {
    id: "retention-by-cohort",
    title: "各 cohort 留存率（%）",
    option: {
      tooltip: { trigger: "axis", valueFormatter: (v: unknown) => (v == null ? "—" : `${v}%`) },
      legend: { type: "scroll", top: 0 },
      grid: { left: 40, right: 16, top: 36, bottom: 32 },
      xAxis: { type: "category", data: cohorts, axisLabel: { fontSize: 10 } },
      yAxis: { type: "value", axisLabel: { formatter: "{value}%" } },
      series: lineSeries,
    },
  };

  // chart 2: 新客规模柱状图
  const newUsersBar: ChartSpec = {
    id: "new-users-by-cohort",
    title: "各 cohort 新客规模",
    option: {
      tooltip: { trigger: "axis" },
      grid: { left: 48, right: 16, top: 24, bottom: 32 },
      xAxis: { type: "category", data: cohorts, axisLabel: { fontSize: 10 } },
      yAxis: { type: "value" },
      series: [{ type: "bar", data: newUsers, itemStyle: { color: "#3b82f6" } }],
    },
  };

  return [newUsersBar, retentionLine];
}

function buildRecallCharts(detail: BiDatasetDetail): ChartSpec[] {
  const monthKey = matchColumn(detail.columns, MONTH_ALIASES);
  const repurchaseKey = matchColumn(detail.columns, REPURCHASE_ALIASES);
  const periodKeys = detail.columns.filter((c) => c !== monthKey && c !== repurchaseKey);
  if (periodKeys.length === 0) return [];

  const months: string[] = detail.rows.map((r, i) =>
    monthKey ? String(r[monthKey] ?? `row_${i + 1}`) : `row_${i + 1}`,
  );
  const repurchase: number[] = detail.rows.map((r) =>
    repurchaseKey ? Number(toNumber(r[repurchaseKey]) ?? 0) : 0,
  );

  const lineSeries = periodKeys.map((pk) => ({
    name: pk,
    type: "line",
    smooth: true,
    data: detail.rows.map((r) => {
      const v = toRatio(r[pk]);
      return v == null ? null : Math.round(v * 10000) / 100;
    }),
  }));

  const recallLine: ChartSpec = {
    id: "recall-by-month",
    title: "各月回购老客来源分布（%）",
    option: {
      tooltip: { trigger: "axis", valueFormatter: (v: unknown) => (v == null ? "—" : `${v}%`) },
      legend: { type: "scroll", top: 0 },
      grid: { left: 40, right: 16, top: 36, bottom: 32 },
      xAxis: { type: "category", data: months, axisLabel: { fontSize: 10 } },
      yAxis: { type: "value", axisLabel: { formatter: "{value}%" } },
      series: lineSeries,
    },
  };

  const repurchaseBar: ChartSpec = {
    id: "repurchase-users-by-month",
    title: "各月回购老客总量",
    option: {
      tooltip: { trigger: "axis" },
      grid: { left: 48, right: 16, top: 24, bottom: 32 },
      xAxis: { type: "category", data: months, axisLabel: { fontSize: 10 } },
      yAxis: { type: "value" },
      series: [{ type: "bar", data: repurchase, itemStyle: { color: "#10b981" } }],
    },
  };

  return [repurchaseBar, recallLine];
}

// 入口：按 slot 派发确定性聚合 → ChartSpec[]。从不返回 row 级数据。
export function buildChartSpecsFromDataset(detail: BiDatasetDetail): ChartSpec[] {
  if (detail.slot === "member_retention") return buildRetentionCharts(detail);
  if (detail.slot === "member_recall") return buildRecallCharts(detail);
  return [];
}

// 给 LLM 喂的元信息：schema + 行数 + 数值列摘要统计。**不含任何 row 内容**。
export function summarizeDatasetForLlm(detail: BiDatasetDetail): string {
  const numericSummaries: string[] = [];
  for (const col of detail.columns) {
    const nums: number[] = [];
    for (const r of detail.rows) {
      const v = toNumber(r[col]);
      if (v != null) nums.push(v);
    }
    if (nums.length >= Math.max(2, Math.floor(detail.rows.length * 0.5))) {
      const min = Math.min(...nums);
      const max = Math.max(...nums);
      const mean = nums.reduce((a, b) => a + b, 0) / nums.length;
      numericSummaries.push(
        `  - ${col}: n=${nums.length}, min=${min.toFixed(4)}, max=${max.toFixed(4)}, mean=${mean.toFixed(4)}`,
      );
    }
  }
  return [
    "[关联 BI 数据集元信息]",
    `slot=${detail.slot}, filename=${detail.filename}, rows=${detail.rowCount}, cols=${detail.columnCount}`,
    `columns: ${detail.columns.join(", ")}`,
    numericSummaries.length > 0 ? "numeric column stats:" : "",
    ...numericSummaries,
    "[/关联 BI 数据集元信息]",
    "",
  ]
    .filter(Boolean)
    .join("\n");
}

export function datasetMetaFromDetail(detail: BiDatasetDetail): DatasetMeta {
  return {
    id: detail.id,
    slot: detail.slot,
    filename: detail.filename,
    rowCount: detail.rowCount,
    columnCount: detail.columnCount,
    columns: detail.columns,
  };
}
