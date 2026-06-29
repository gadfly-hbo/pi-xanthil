import type {
  CrowdDataset,
  CrowdFieldProfile,
  CrowdProfileDimension,
  CrowdSegment,
  CrowdTagDictionaryEntry,
} from "./types.ts";
import type { CrowdTagDictionaryEntryInput } from "./db/data.ts";
import {
  createCrowdDataset,
  createCrowdSegment,
  getCrowdDataset,
  saveCrowdTagDictionary,
  updateCrowdSegment,
} from "./db/data.ts";
import {
  PREFIX_DIMENSION_MAP,
} from "./crowd-normalize.ts";

// ─── v2 wide-table column spec (X-CROWD10 v2 §8.2.2) ──────────────────────────
// 27 fixed columns: segment_name + dem_* + con_* + pri_sens_* + pri_dis_* + cha_* + lif_* + sample_count
// Each row = 1 segment.

const V2_AGG_COLUMNS = [
  "segment_name",
  "dem_gender_female_pct", "dem_gender_male_pct",
  "dem_age_18_24_pct", "dem_age_25_34_pct", "dem_age_35_44_pct", "dem_age_45_54_pct", "dem_age_55_plus_pct",
  "dem_city_t1_pct", "dem_city_t1_new_pct", "dem_city_t2_pct", "dem_city_t3_pct", "dem_city_t4_plus_pct",
  "con_avg_monthly_spend",
  "pri_sens_high_pct", "pri_sens_mid_pct", "pri_sens_low_pct",
  "pri_dis_coupon_pct", "pri_dis_flash_sale_pct", "pri_dis_member_price_pct", "pri_dis_none_pct",
  "cha_top_channel",
  "lif_new_pct", "lif_active_pct", "lif_repeat_pct", "lif_dormant_pct", "lif_churned_pct",
  "sample_count",
] as const;

const META_COLUMNS = new Set(["segment_name", "sample_count"]);

function normalizeAggregateColumnName(column: string): string {
  return column.trim().replace(/^\uFEFF/, "").toLowerCase();
}

function normalizeAggregateRows(
  columns: string[],
  rows: Array<Record<string, unknown>>,
): { columns: string[]; rows: Array<Record<string, unknown>> } {
  const normalizedColumns = columns.map(normalizeAggregateColumnName);
  const normalizedRows = rows.map((row) => {
    const next: Record<string, unknown> = {};
    columns.forEach((column, index) => {
      const normalized = normalizedColumns[index];
      if (!normalized) return;
      next[normalized] = row[column];
    });
    return next;
  });
  return { columns: normalizedColumns, rows: normalizedRows };
}

function validateV2Columns(columns: string[]): { ok: boolean; error?: string } {
  const lower = columns.map(normalizeAggregateColumnName);
  for (const required of V2_AGG_COLUMNS) {
    if (!lower.includes(required)) {
      return { ok: false, error: `missing required v2 column: "${required}"` };
    }
  }
  return { ok: true };
}

// ─── Column prefix → dimension + human-readable label ────────────────────────────

function prefixToDimension(col: string): CrowdProfileDimension {
  for (const [prefix, dim] of Object.entries(PREFIX_DIMENSION_MAP)) {
    if (col.startsWith(prefix)) return dim as CrowdProfileDimension;
  }
  return "custom";
}

function columnToFieldLabel(col: string): string {
  // dem_gender_female_pct → "gender (female)"
  // con_avg_monthly_spend → "avg monthly spend"
  // pri_sens_high_pct → "price sensitivity (high)"
  return col
    .replace(/_pct$/, "")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

// ─── 1. importAggregateDataset (v2 wide-table) ──────────────────────────────────
// Parse v2 aggregate CSV → 1 dataset + 1 tagDictionary + N segments.

export interface ImportAggregateResult {
  dataset: CrowdDataset;
  tagDictionary: CrowdTagDictionaryEntry[];
  segments: CrowdSegment[];
}

export function importAggregateDataset(
  workspaceId: string,
  name: string,
  columns: string[],
  inputRows: Array<Record<string, unknown>>,
): ImportAggregateResult {
  const validation = validateV2Columns(columns);
  if (!validation.ok) {
    throw new Error(validation.error!);
  }

  const normalized = normalizeAggregateRows(columns, inputRows);
  const lower = normalized.columns;
  const rows = normalized.rows;
  const segNameCol = lower.find((c) => c === "segment_name")!;
  const sampleCountCol = lower.find((c) => c === "sample_count")!;

  // Identify data columns (non-meta)
  const dataCols = lower.filter((c) => !META_COLUMNS.has(c));

  // Build shared field profiles: one CrowdFieldProfile per data column
  // Each column's topValues = the distinct percentage values across all segments
  const fieldProfiles: CrowdFieldProfile[] = dataCols.map((col) => {
    const values: number[] = [];
    for (const row of rows) {
      const v = Number(row[col]);
      if (Number.isFinite(v)) values.push(v);
    }
    const uniqueSet = new Set(values);
    const freq = new Map<number, number>();
    for (const v of values) {
      freq.set(v, (freq.get(v) ?? 0) + 1);
    }
    const topValues = [...freq.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 20)
      .map(([value, count]) => ({
        value: String(value),
        count,
        ratio: rows.length > 0 ? count / rows.length : 0,
      }));

    let numericRange: { min: number; max: number } | undefined;
    if (values.length > 0) {
      numericRange = { min: Math.min(...values), max: Math.max(...values) };
    }

    return {
      field: col,
      inferredType: "number" as const,
      missingCount: rows.length - values.length,
      uniqueCount: uniqueSet.size,
      topValues,
      numericRange,
    };
  });

  // Create dataset
  const dataset = createCrowdDataset(workspaceId, {
    name,
    source: "aggregate_upload",
    rowCount: rows.length,
    fieldCount: dataCols.length,
    fieldProfiles,
    isAggregate: true,
  });

  // Build tag dictionary: one entry per data column, dimension from prefix
  const dictEntries: CrowdTagDictionaryEntryInput[] = dataCols.map((col) => {
    const dim = prefixToDimension(col);
    return {
      field: col,
      label: columnToFieldLabel(col),
      description: "",
      dimension: dim,
      sensitivity: "internal",
      weight: 1,
      valueLabels: {},
      enabled: true,
      autoGenerated: true,
    };
  });

  const tagDictionary = saveCrowdTagDictionary(workspaceId, dataset.id, dictEntries);

  // Create one CrowdSegment per row
  const segments: CrowdSegment[] = [];
  for (const row of rows) {
    const segName = String(row[segNameCol] ?? "").trim();
    if (!segName) continue;
    const sampleCount = typeof row[sampleCountCol] === "number" ? row[sampleCountCol] : 0;

    const segment = createCrowdSegment(workspaceId, {
      datasetId: dataset.id,
      name: segName,
      description: `聚合分群 · ${segName}`,
      rule: { logic: "and", conditions: [] },
      autoGenerated: true,
    });

    // Build tagDistribution for this segment from its percentage values
    const tagDistribution: Record<string, Array<{ value: string; count: number; ratio: number }>> = {};
    for (const col of dataCols) {
      const v = Number(row[col]);
      if (Number.isFinite(v)) {
        tagDistribution[col] = [{ value: String(v), count: 1, ratio: 1 }];
      }
    }

    // Update segment with sampleCount and tagDistribution
    updateCrowdSegment(segment.id, {
      sampleCount: sampleCount as number,
      coverageRatio: 1,
      tagDistribution,
    });

    segments.push({ ...segment, sampleCount: sampleCount as number, coverageRatio: 1, tagDistribution });
  }

  return { dataset, tagDictionary, segments };
}

// ─── 2. autoTagDictionary ──────────────────────────────────────────────────────
// Heuristic dimension mapping for detail-channel datasets.
// Reuses existing fieldProfiles from CrowdDataset, zero LLM.

// Detail-field dimension heuristics (for non-aggregate imports)
const DETAIL_DIMENSION_RULES: Array<{ pattern: RegExp; dimension: CrowdProfileDimension }> = [
  { pattern: /(age|gender|sex|birth|birthday|婚姻|婚|年龄|性别|籍贯|民族|学历|education|城市|city)/i, dimension: "demographic" },
  { pattern: /(spend|amount|消费|支出|收入|income|salary|客单|支付|付款|订单金额|GMV)/i, dimension: "consumption_power" },
  { pattern: /(interest|prefer|爱好|兴趣|偏好|喜欢|风格|口味)/i, dimension: "interest_preference" },
  { pattern: /(channel|渠道|来源|入口|平台|source|medium|campaign)/i, dimension: "channel_preference" },
  { pattern: /(discount|price|优惠|折扣|价格|降价|券|满减|促销)/i, dimension: "price_sensitivity" },
  { pattern: /(lifecycle|stage|阶段|生命周期|新客|老客|活跃|沉睡|流失|留存|RFM)/i, dimension: "lifecycle" },
  { pattern: /(scenario|context|场景|场合|时段|季节|节日|情境)/i, dimension: "scenario_preference" },
];

function inferDetailDimension(fieldName: string): CrowdProfileDimension {
  for (const rule of DETAIL_DIMENSION_RULES) {
    if (rule.pattern.test(fieldName)) return rule.dimension;
  }
  return "custom";
}

export function autoTagDictionary(workspaceId: string, datasetId: string): CrowdTagDictionaryEntry[] {
  const dataset = getCrowdDataset(datasetId);
  if (!dataset) throw new Error("dataset not found");
  if (dataset.workspaceId !== workspaceId) throw new Error("dataset belongs to another workspace");

  const entries: CrowdTagDictionaryEntryInput[] = dataset.fieldProfiles.map((fp) => {
    const dim = inferDetailDimension(fp.field);
    const valueLabels: Record<string, string> = {};
    for (const tv of fp.topValues) {
      valueLabels[tv.value] = "";
    }
    return {
      field: fp.field,
      label: fp.field,
      description: "",
      dimension: dim,
      sensitivity: "internal",
      weight: 1,
      valueLabels,
      enabled: true,
      autoGenerated: true,
    };
  });

  return saveCrowdTagDictionary(workspaceId, datasetId, entries);
}

// ─── 3. createDefaultSegment ───────────────────────────────────────────────────
// Unconditional full-sample segment.

export function createDefaultSegment(workspaceId: string, datasetId: string): CrowdSegment {
  const dataset = getCrowdDataset(datasetId);
  if (!dataset) throw new Error("dataset not found");
  if (dataset.workspaceId !== workspaceId) throw new Error("dataset belongs to another workspace");

  const segment = createCrowdSegment(workspaceId, {
    datasetId,
    name: "全样本（自动）",
    description: "无条件全样本分群，覆盖率 100%",
    rule: { logic: "and", conditions: [] },
    autoGenerated: true,
  });

  const tagDistribution = Object.fromEntries(
    dataset.fieldProfiles
      .filter((field) => field.topValues.length > 0)
      .map((field) => [field.field, field.topValues]),
  );

  return updateCrowdSegment(segment.id, {
    sampleCount: dataset.rowCount,
    coverageRatio: dataset.rowCount > 0 ? 1 : 0,
    tagDistribution,
  }) ?? segment;
}
