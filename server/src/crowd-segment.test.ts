import assert from "node:assert/strict";
import test from "node:test";
import { evaluateSegment, validateSegmentRule } from "./crowd-segment.ts";
import type { CrowdFieldProfile, CrowdSegmentRuleGroup } from "./types.ts";

const ROW_COUNT = 10000;

function makeProfile(overrides: Partial<CrowdFieldProfile> = {}): CrowdFieldProfile {
  return {
    field: "age",
    inferredType: "number",
    missingCount: 0,
    uniqueCount: 50,
    topValues: [
      { value: "25", count: 2000, ratio: 0.2 },
      { value: "30", count: 1500, ratio: 0.15 },
      { value: "35", count: 1000, ratio: 0.1 },
    ],
    numericRange: { min: 18, max: 65 },
    ...overrides,
  };
}

function makeGenderProfile(): CrowdFieldProfile {
  return {
    field: "gender",
    inferredType: "string",
    missingCount: 100,
    uniqueCount: 3,
    topValues: [
      { value: "female", count: 5200, ratio: 0.52 },
      { value: "male", count: 4700, ratio: 0.47 },
    ],
  };
}

function makeCityProfile(): CrowdFieldProfile {
  return {
    field: "city",
    inferredType: "string",
    missingCount: 200,
    uniqueCount: 100,
    topValues: [
      { value: "beijing", count: 3000, ratio: 0.3 },
      { value: "shanghai", count: 2500, ratio: 0.25 },
      { value: "guangzhou", count: 1500, ratio: 0.15 },
    ],
  };
}

// ─── validateSegmentRule ───────────────────────────────────────────────

test("validate: empty conditions", () => {
  const rule: CrowdSegmentRuleGroup = { logic: "and", conditions: [] };
  const errs = validateSegmentRule(rule, []);
  assert.equal(errs.length, 1);
  assert.match(errs[0]!.message, /at least one condition/);
});

test("validate: unknown logic", () => {
  const rule: CrowdSegmentRuleGroup = { logic: "xor" as "and", conditions: [{ field: "x", operator: "eq", value: "1" }] };
  const errs = validateSegmentRule(rule, []);
  assert.equal(errs.length, 1);
  assert.match(errs[0]!.message, /unknown logic/);
});

test("validate: unknown operator", () => {
  const rule: CrowdSegmentRuleGroup = { logic: "and", conditions: [{ field: "age", operator: "gt" as "eq" }] };
  const errs = validateSegmentRule(rule, [makeProfile()]);
  assert.equal(errs.length, 1);
  assert.match(errs[0]!.message, /unknown operator/);
});

test("validate: range without min or max", () => {
  const rule: CrowdSegmentRuleGroup = { logic: "and", conditions: [{ field: "age", operator: "range" }] };
  const errs = validateSegmentRule(rule, [makeProfile()]);
  assert.equal(errs.length, 1);
  assert.match(errs[0]!.message, /requires min or max/);
});

test("validate: eq without value", () => {
  const rule: CrowdSegmentRuleGroup = { logic: "and", conditions: [{ field: "age", operator: "eq" }] };
  const errs = validateSegmentRule(rule, [makeProfile()]);
  assert.equal(errs.length, 1);
  assert.match(errs[0]!.message, /requires a scalar value/);
});

test("validate: in requires non-empty array", () => {
  const rule: CrowdSegmentRuleGroup = { logic: "and", conditions: [{ field: "city", operator: "in", value: "beijing" }] };
  const errs = validateSegmentRule(rule, [makeCityProfile()]);
  assert.equal(errs.length, 1);
  assert.match(errs[0]!.message, /non-empty value array/);
});

test("validate: range on non-numeric field is rejected", () => {
  const rule: CrowdSegmentRuleGroup = { logic: "and", conditions: [{ field: "gender", operator: "range", min: 0, max: 1 }] };
  const errs = validateSegmentRule(rule, [makeGenderProfile()]);
  assert.equal(errs.length, 1);
  assert.match(errs[0]!.message, /requires numericRange/);
});

test("validate: range min must be <= max", () => {
  const rule: CrowdSegmentRuleGroup = { logic: "and", conditions: [{ field: "age", operator: "range", min: 40, max: 20 }] };
  const errs = validateSegmentRule(rule, [makeProfile()]);
  assert.equal(errs.length, 1);
  assert.match(errs[0]!.message, /min must be <= max/);
});

test("validate: field not found", () => {
  const rule: CrowdSegmentRuleGroup = { logic: "and", conditions: [{ field: "nonexistent", operator: "eq", value: "1" }] };
  const errs = validateSegmentRule(rule, [makeProfile()]);
  assert.equal(errs.length, 1);
  assert.match(errs[0]!.message, /not found/);
});

test("validate: valid rule passes", () => {
  const rule: CrowdSegmentRuleGroup = { logic: "and", conditions: [{ field: "age", operator: "range", min: 20, max: 40 }] };
  const errs = validateSegmentRule(rule, [makeProfile()]);
  assert.equal(errs.length, 0);
});

// ─── evaluateSegment ───────────────────────────────────────────────────

test("evaluate: eq operator matches topValues count", () => {
  const rule: CrowdSegmentRuleGroup = { logic: "and", conditions: [{ field: "gender", operator: "eq", value: "female" }] };
  const result = evaluateSegment(rule, [makeGenderProfile()], ROW_COUNT);
  assert.equal(result.sampleCount, 5200);
  assert.ok(result.coverageRatio > 0.5);
  assert.equal(result.errors.length, 0);
});

test("evaluate: neq operator subtracts from rowCount", () => {
  const rule: CrowdSegmentRuleGroup = { logic: "and", conditions: [{ field: "gender", operator: "neq", value: "female" }] };
  const result = evaluateSegment(rule, [makeGenderProfile()], ROW_COUNT);
  assert.equal(result.sampleCount, 4800);
});

test("evaluate: in operator sums matched values", () => {
  const rule: CrowdSegmentRuleGroup = { logic: "and", conditions: [{ field: "city", operator: "in", value: ["beijing", "shanghai"] }] };
  const result = evaluateSegment(rule, [makeCityProfile()], ROW_COUNT);
  assert.equal(result.sampleCount, 5500);
});

test("evaluate: not_in operator subtracts matched values", () => {
  const rule: CrowdSegmentRuleGroup = { logic: "and", conditions: [{ field: "city", operator: "not_in", value: ["beijing"] }] };
  const result = evaluateSegment(rule, [makeCityProfile()], ROW_COUNT);
  assert.equal(result.sampleCount, 7000);
});

test("evaluate: range operator proportional to numericRange", () => {
  const rule: CrowdSegmentRuleGroup = { logic: "and", conditions: [{ field: "age", operator: "range", min: 18, max: 30 }] };
  const result = evaluateSegment(rule, [makeProfile()], ROW_COUNT);
  const expected = Math.round(ROW_COUNT * ((30 - 18) / (65 - 18)));
  assert.equal(result.sampleCount, expected);
});

test("evaluate: range with only min uses profile max as upper bound", () => {
  const rule: CrowdSegmentRuleGroup = { logic: "and", conditions: [{ field: "age", operator: "range", min: 30 }] };
  const result = evaluateSegment(rule, [makeProfile()], ROW_COUNT);
  const expected = Math.round(ROW_COUNT * ((65 - 30) / (65 - 18)));
  assert.equal(result.sampleCount, expected);
});

test("evaluate: range with only max uses profile min as lower bound", () => {
  const rule: CrowdSegmentRuleGroup = { logic: "and", conditions: [{ field: "age", operator: "range", max: 30 }] };
  const result = evaluateSegment(rule, [makeProfile()], ROW_COUNT);
  const expected = Math.round(ROW_COUNT * ((30 - 18) / (65 - 18)));
  assert.equal(result.sampleCount, expected);
});

test("evaluate: exists operator counts non-missing", () => {
  const rule: CrowdSegmentRuleGroup = { logic: "and", conditions: [{ field: "gender", operator: "exists" }] };
  const result = evaluateSegment(rule, [makeGenderProfile()], ROW_COUNT);
  assert.equal(result.sampleCount, ROW_COUNT - 100);
});

test("evaluate: missing operator counts missing", () => {
  const rule: CrowdSegmentRuleGroup = { logic: "and", conditions: [{ field: "gender", operator: "missing" }] };
  const result = evaluateSegment(rule, [makeGenderProfile()], ROW_COUNT);
  assert.equal(result.sampleCount, 100);
});

test("evaluate: AND logic takes min of condition counts", () => {
  const rule: CrowdSegmentRuleGroup = {
    logic: "and",
    conditions: [
      { field: "gender", operator: "eq", value: "female" },
      { field: "city", operator: "eq", value: "beijing" },
    ],
  };
  const result = evaluateSegment(rule, [makeGenderProfile(), makeCityProfile()], ROW_COUNT);
  assert.equal(result.sampleCount, 3000);
});

test("evaluate: OR logic takes max of condition counts", () => {
  const rule: CrowdSegmentRuleGroup = {
    logic: "or",
    conditions: [
      { field: "gender", operator: "eq", value: "female" },
      { field: "city", operator: "eq", value: "beijing" },
    ],
  };
  const result = evaluateSegment(rule, [makeGenderProfile(), makeCityProfile()], ROW_COUNT);
  assert.equal(result.sampleCount, 5200);
});

test("evaluate: field not found returns error and zero count", () => {
  const rule: CrowdSegmentRuleGroup = { logic: "and", conditions: [{ field: "unknown", operator: "eq", value: "x" }] };
  const result = evaluateSegment(rule, [makeProfile()], ROW_COUNT);
  assert.equal(result.sampleCount, 0);
  assert.equal(result.errors.length, 1);
  assert.match(result.errors[0]!.message, /not found/);
});

test("evaluate: empty conditions returns zero", () => {
  const rule: CrowdSegmentRuleGroup = { logic: "and", conditions: [] };
  const result = evaluateSegment(rule, [], ROW_COUNT);
  assert.equal(result.sampleCount, 0);
  assert.equal(result.coverageRatio, 0);
});

test("evaluate: tagDistribution includes all condition fields", () => {
  const rule: CrowdSegmentRuleGroup = {
    logic: "and",
    conditions: [
      { field: "gender", operator: "eq", value: "female" },
      { field: "city", operator: "eq", value: "beijing" },
    ],
  };
  const result = evaluateSegment(rule, [makeGenderProfile(), makeCityProfile()], ROW_COUNT);
  assert.ok("gender" in result.tagDistribution);
  assert.ok("city" in result.tagDistribution);
  assert.equal(result.tagDistribution["gender"].length, 2);
  assert.equal(result.tagDistribution["city"].length, 3);
});

test("evaluate: range on non-numeric field returns zero", () => {
  const rule: CrowdSegmentRuleGroup = { logic: "and", conditions: [{ field: "gender", operator: "range", min: 0, max: 1 }] };
  const result = evaluateSegment(rule, [makeGenderProfile()], ROW_COUNT);
  assert.equal(result.sampleCount, 0);
});

test("evaluate: eq on value not in topValues returns 0", () => {
  const rule: CrowdSegmentRuleGroup = { logic: "and", conditions: [{ field: "gender", operator: "eq", value: "other" }] };
  const result = evaluateSegment(rule, [makeGenderProfile()], ROW_COUNT);
  assert.equal(result.sampleCount, 0);
});

test("evaluate: coverageRatio is 0 when rowCount is 0", () => {
  const rule: CrowdSegmentRuleGroup = { logic: "and", conditions: [{ field: "gender", operator: "eq", value: "female" }] };
  const result = evaluateSegment(rule, [makeGenderProfile()], 0);
  assert.equal(result.coverageRatio, 0);
});
