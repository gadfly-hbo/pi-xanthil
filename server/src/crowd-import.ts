import type { CrowdFieldProfile, CrowdTagValueSummary } from "./types.ts";
import { normalizeRow } from "./crowd-normalize.ts";

export interface ComputeFieldProfilesInput {
  columns: string[];
  rows: Array<Record<string, unknown>>;
  topN?: number;
  normalizeEnums?: boolean;
}

interface TagDetailColumns {
  type: string;
  tag: string;
  ratio: string;
}

function normalizeHeader(header: string): string {
  return header.trim().replace(/^\uFEFF/, "").toLowerCase();
}

function findTagDetailColumns(columns: string[]): TagDetailColumns | null {
  const byNormalized = new Map(columns.map((column) => [normalizeHeader(column), column]));
  const type = byNormalized.get("标签类型") ?? byNormalized.get("tag_type") ?? byNormalized.get("label_type") ?? byNormalized.get("type");
  const tag = byNormalized.get("标签") ?? byNormalized.get("tag") ?? byNormalized.get("label") ?? byNormalized.get("value");
  const ratio = byNormalized.get("占比") ?? byNormalized.get("ratio") ?? byNormalized.get("pct") ?? byNormalized.get("percentage");
  if (!type || !tag || !ratio) return null;
  return { type, tag, ratio };
}

function parseRatio(value: unknown): number | null {
  if (value == null || value === "") return null;
  const raw = String(value).trim().replace(/%$/, "");
  const n = Number(raw);
  if (!Number.isFinite(n)) return null;
  return n > 1 ? n / 100 : n;
}

export function computeTagDetailFieldProfiles(input: ComputeFieldProfilesInput): CrowdFieldProfile[] | null {
  const cols = findTagDetailColumns(input.columns);
  if (!cols) return null;
  const byType = new Map<string, Array<{ tag: string; ratio: number }>>();
  for (const row of input.rows) {
    const type = String(row[cols.type] ?? "").trim();
    const tag = String(row[cols.tag] ?? "").trim();
    const ratio = parseRatio(row[cols.ratio]);
    if (!type || !tag || ratio == null) continue;
    const current = byType.get(type) ?? [];
    current.push({ tag, ratio });
    byType.set(type, current);
  }
  if (byType.size === 0) return null;

  return [...byType.entries()].map(([type, items]) => {
    const merged = new Map<string, number>();
    for (const item of items) {
      merged.set(item.tag, (merged.get(item.tag) ?? 0) + item.ratio);
    }
    const ranked = [...merged.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([tag, ratio]) => ({ tag, ratio }));
    const take = ranked.length > 3 ? 3 : 1;
    return {
      field: type,
      inferredType: "string" as const,
      missingCount: 0,
      uniqueCount: ranked.length,
      topValues: ranked.slice(0, take).map((item) => ({
        value: item.tag,
        count: Math.max(1, Math.round(item.ratio * input.rows.length)),
        ratio: item.ratio,
      })),
    };
  });
}

function csvCell(value: string): string {
  if (!/[",\n\r]/.test(value)) return value;
  return `"${value.replace(/"/g, '""')}"`;
}

function formatRatioForCsv(ratio: number): string {
  if (!Number.isFinite(ratio)) return "";
  const percentage = ratio * 100;
  return Number.isInteger(percentage) ? `${percentage}%` : `${Number(percentage.toFixed(4))}%`;
}

export function crowdFieldProfilesToLlmAggregateCsv(fieldProfiles: CrowdFieldProfile[]): string {
  const lines = [["标签类型", "标签", "占比"].map(csvCell).join(",")];
  for (const profile of fieldProfiles) {
    for (const value of profile.topValues) {
      lines.push([
        profile.field,
        value.value,
        formatRatioForCsv(value.ratio),
      ].map(csvCell).join(","));
    }
  }
  return `${lines.join("\n")}\n`;
}

function canExposeTopValues(rowCount: number, uniqueCount: number): boolean {
  if (rowCount === 0 || uniqueCount === 0) return false;
  const maxCategoricalUnique = Math.min(50, Math.max(20, Math.ceil(rowCount * 0.2)));
  return uniqueCount <= maxCategoricalUnique;
}

function isIdentifierLikeField(field: string): boolean {
  const normalized = field.trim().toLowerCase();
  return /(^|[_\-\s])(row|record|user|uid|id|primary|key|phone|mobile|tel|email|openid|unionid)([_\-\s]|$)/i.test(normalized)
    || /(行号|记录|用户id|会员id|客户id|主键|身份证|证件|手机号|手机|电话|邮箱)/i.test(field);
}

function inferFieldType(values: unknown[]): CrowdFieldProfile["inferredType"] {
  let numCount = 0;
  let boolCount = 0;
  let dateCount = 0;
  let nonNull = 0;
  for (const v of values) {
    if (v == null || v === "") continue;
    nonNull++;
    const s = String(v).trim();
    if (s === "true" || s === "false") { boolCount++; continue; }
    if (/^\d{4}-\d{2}-\d{2}/.test(s) && !isNaN(Date.parse(s))) { dateCount++; continue; }
    if (!isNaN(Number(s)) && s !== "") { numCount++; continue; }
  }
  if (nonNull === 0) return "unknown";
  const total = nonNull;
  if (boolCount / total > 0.5) return "boolean";
  if (dateCount / total > 0.5) return "date";
  if (numCount / total > 0.5) return "number";
  return "string";
}

export function computeFieldProfiles(input: ComputeFieldProfilesInput): CrowdFieldProfile[] {
  const { columns, rows, topN = 10, normalizeEnums = false } = input;
  const rowCount = rows.length;

  // R5: normalize enum values in-place before computing profiles
  const effectiveRows = normalizeEnums
    ? rows.map((row) => {
        const { values } = normalizeRow(columns, row);
        return values as Record<string, unknown>;
      })
    : rows;

  return columns.map((field) => {
    const values: unknown[] = [];
    let missingCount = 0;

    for (const row of effectiveRows) {
      const v = row[field];
      if (v == null || v === "") {
        missingCount++;
      } else {
        values.push(v);
      }
    }

    const inferredType = inferFieldType(values);
    const uniqueSet = new Set(values.map((v) => String(v).trim()));
    const uniqueCount = uniqueSet.size;

    const freq = new Map<string, number>();
    for (const v of values) {
      const key = String(v).trim();
      freq.set(key, (freq.get(key) ?? 0) + 1);
    }
    const topValues: CrowdTagValueSummary[] = !isIdentifierLikeField(field) && canExposeTopValues(rowCount, uniqueCount)
      ? [...freq.entries()]
          .sort((a, b) => b[1] - a[1])
          .slice(0, topN)
          .map(([value, count]) => ({
            value,
            count,
            ratio: rowCount > 0 ? count / rowCount : 0,
          }))
      : [];

    let numericRange: { min: number; max: number } | undefined;
    if (inferredType === "number") {
      let min = Infinity;
      let max = -Infinity;
      for (const v of values) {
        const n = Number(v);
        if (Number.isNaN(n)) continue;
        min = Math.min(min, n);
        max = Math.max(max, n);
      }
      if (Number.isFinite(min) && Number.isFinite(max)) {
        numericRange = { min, max };
      }
    }

    return {
      field,
      inferredType,
      missingCount,
      uniqueCount,
      topValues,
      numericRange,
    };
  });
}
