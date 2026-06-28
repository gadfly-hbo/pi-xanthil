import type {
  CrowdFieldProfile,
  CrowdSegmentRuleGroup,
  CrowdSegmentRuleCondition,
  CrowdTagValueSummary,
} from "./types.ts";

export interface SegmentEvalError {
  field: string;
  message: string;
}

export interface SegmentEvalResult {
  sampleCount: number;
  coverageRatio: number;
  tagDistribution: Record<string, CrowdTagValueSummary[]>;
  errors: SegmentEvalError[];
}

function findFieldProfile(
  profiles: CrowdFieldProfile[],
  field: string,
): CrowdFieldProfile | undefined {
  return profiles.find((p) => p.field === field);
}

function clampCount(n: number, rowCount: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(rowCount, Math.round(n)));
}

function evalCondition(
  cond: CrowdSegmentRuleCondition,
  profile: CrowdFieldProfile,
  rowCount: number,
): number {
  const { operator, value, min, max } = cond;

  switch (operator) {
    case "eq": {
      const hit = profile.topValues.find((v) => String(v.value) === String(value));
      return hit ? clampCount(hit.count, rowCount) : 0;
    }
    case "neq": {
      const hit = profile.topValues.find((v) => String(v.value) === String(value));
      return hit ? clampCount(rowCount - hit.count, rowCount) : rowCount;
    }
    case "in": {
      if (!Array.isArray(value)) return 0;
      const set = new Set(value.map(String));
      const matched = profile.topValues
        .filter((v) => set.has(String(v.value)))
        .reduce((sum, v) => sum + v.count, 0);
      return clampCount(matched, rowCount);
    }
    case "not_in": {
      if (!Array.isArray(value)) return rowCount;
      const set = new Set(value.map(String));
      const matched = profile.topValues
        .filter((v) => set.has(String(v.value)))
        .reduce((sum, v) => sum + v.count, 0);
      return clampCount(rowCount - matched, rowCount);
    }
    case "range": {
      if (profile.numericRange == null) return 0;
      const lo = min ?? profile.numericRange.min;
      const hi = max ?? profile.numericRange.max;
      const range = profile.numericRange.max - profile.numericRange.min;
      if (range <= 0) return 0;
      const overlap = Math.min(hi, profile.numericRange.max) - Math.max(lo, profile.numericRange.min);
      if (overlap <= 0) return 0;
      return clampCount(rowCount * (overlap / range), rowCount);
    }
    case "exists":
      return clampCount(rowCount - profile.missingCount, rowCount);
    case "missing":
      return clampCount(profile.missingCount, rowCount);
    default:
      return 0;
  }
}

export function evaluateSegment(
  rule: CrowdSegmentRuleGroup,
  profiles: CrowdFieldProfile[],
  rowCount: number,
): SegmentEvalResult {
  const errors: SegmentEvalError[] = [];
  const conditionCounts: number[] = [];

  for (const cond of rule.conditions) {
    const profile = findFieldProfile(profiles, cond.field);
    if (!profile) {
      errors.push({ field: cond.field, message: `field "${cond.field}" not found in dataset` });
      conditionCounts.push(0);
      continue;
    }
    try {
      conditionCounts.push(evalCondition(cond, profile, rowCount));
    } catch {
      errors.push({ field: cond.field, message: `failed to evaluate condition on field "${cond.field}"` });
      conditionCounts.push(0);
    }
  }

  if (conditionCounts.length === 0) {
    return { sampleCount: 0, coverageRatio: 0, tagDistribution: {}, errors };
  }

  const sampleCount = rule.logic === "or"
    ? Math.max(...conditionCounts)
    : Math.min(...conditionCounts);

  const coverageRatio = rowCount > 0 ? sampleCount / rowCount : 0;

  const tagDistribution: Record<string, CrowdTagValueSummary[]> = {};
  const seenFields = new Set(rule.conditions.map((c) => c.field));
  for (const field of seenFields) {
    const profile = findFieldProfile(profiles, field);
    if (profile) {
      tagDistribution[field] = profile.topValues;
    }
  }

  return { sampleCount, coverageRatio, tagDistribution, errors };
}

export function validateSegmentRule(
  rule: CrowdSegmentRuleGroup,
  profiles: CrowdFieldProfile[],
): SegmentEvalError[] {
  if (!rule.conditions || rule.conditions.length === 0) {
    return [{ field: "", message: "rule must have at least one condition" }];
  }

  if (rule.logic !== "and" && rule.logic !== "or") {
    return [{ field: "", message: `unknown logic "${rule.logic}", expected "and" or "or"` }];
  }

  const result: SegmentEvalError[] = [];

  for (const cond of rule.conditions) {
    if (!cond.field || typeof cond.field !== "string") {
      result.push({ field: String(cond.field ?? ""), message: "condition must have a field name" });
      continue;
    }

    const validOps = ["eq", "neq", "in", "not_in", "range", "exists", "missing"];
    if (!validOps.includes(cond.operator)) {
      result.push({ field: cond.field, message: `unknown operator "${cond.operator}"` });
      continue;
    }

    const profile = findFieldProfile(profiles, cond.field);
    if (!profile) {
      result.push({ field: cond.field, message: `field "${cond.field}" not found in dataset` });
      continue;
    }

    if (cond.operator === "range") {
      if (profile.numericRange == null) {
        result.push({ field: cond.field, message: `operator "range" requires numericRange for field "${cond.field}"` });
      }
      if (cond.min == null && cond.max == null) {
        result.push({ field: cond.field, message: "range operator requires min or max" });
      }
      if (cond.min != null && !Number.isFinite(cond.min)) {
        result.push({ field: cond.field, message: "range min must be a finite number" });
      }
      if (cond.max != null && !Number.isFinite(cond.max)) {
        result.push({ field: cond.field, message: "range max must be a finite number" });
      }
      if (cond.min != null && cond.max != null && cond.min > cond.max) {
        result.push({ field: cond.field, message: "range min must be <= max" });
      }
    }

    if (cond.operator === "eq" || cond.operator === "neq") {
      if (cond.value === undefined || Array.isArray(cond.value)) {
        result.push({ field: cond.field, message: `operator "${cond.operator}" requires a scalar value` });
      }
    }

    if (cond.operator === "in" || cond.operator === "not_in") {
      if (!Array.isArray(cond.value) || cond.value.length === 0) {
        result.push({ field: cond.field, message: `operator "${cond.operator}" requires a non-empty value array` });
      }
    }
  }

  return result;
}
