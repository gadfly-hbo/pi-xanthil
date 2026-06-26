import { test } from "node:test";
import { strict as assert } from "node:assert";
import type { MetricSnapshot } from "./types.ts";
import { verifyMetricUsage } from "./metric-verification.ts";

function snapshot(name: string, value: number): MetricSnapshot {
  return {
    name,
    value,
    period: "2026-06",
    status: "normal",
    source: "extraction_tool",
    evidenceLevel: "A",
  };
}

test("verifyMetricUsage: matched with rounding tolerance", () => {
  const result = verifyMetricUsage([snapshot("销售额", 12_500)], "本期销售额约为 12,480，较上期稳定。");
  assert.equal(result.verdict, "ok");
  assert.equal(result.hits[0]?.status, "matched");
  assert.equal(result.hits[0]?.foundInText, 12_480);
  assert.ok((result.hits[0]?.relDiff ?? 1) <= 0.005);
});

test("verifyMetricUsage: suspect when text mutates snapshot value", () => {
  const result = verifyMetricUsage([snapshot("销售额", 12_500)], "本期销售额为 12,000，需要关注。");
  assert.equal(result.verdict, "mismatch");
  assert.equal(result.hits[0]?.status, "suspect");
  assert.equal(result.hits[0]?.foundInText, 12_000);
  assert.ok((result.hits[0]?.relDiff ?? 0) > 0.005);
});

test("verifyMetricUsage: unreferenced when no nearby value appears", () => {
  const result = verifyMetricUsage([snapshot("销售额", 12_500)], "本期销售表现稳定，建议继续观察渠道结构。");
  assert.equal(result.verdict, "ok");
  assert.deepEqual(result.hits[0], {
    name: "销售额",
    expected: 12_500,
    foundInText: null,
    status: "unreferenced",
    relDiff: null,
  });
});

test("verifyMetricUsage: normalizes 万 and 亿 units", () => {
  const result = verifyMetricUsage(
    [snapshot("会员数", 32_000), snapshot("GMV", 120_000_000)],
    "会员数达到 3.2万，GMV 为 1.2亿。",
  );
  assert.equal(result.verdict, "ok");
  assert.equal(result.hits[0]?.status, "matched");
  assert.equal(result.hits[0]?.foundInText, 32_000);
  assert.equal(result.hits[1]?.status, "matched");
  assert.equal(result.hits[1]?.foundInText, 120_000_000);
});

test("verifyMetricUsage: normalizes percentage text to ratio values", () => {
  const result = verifyMetricUsage([snapshot("复购率", 0.125)], "本期复购率为 12.5%，高于基准。");
  assert.equal(result.verdict, "ok");
  assert.equal(result.hits[0]?.status, "matched");
  assert.equal(result.hits[0]?.foundInText, 0.125);
  assert.equal(result.hits[0]?.relDiff, 0);
});

test("verifyMetricUsage: verdict aggregates any suspect hit", () => {
  const result = verifyMetricUsage(
    [snapshot("销售额", 12_500), snapshot("复购率", 0.125), snapshot("客单价", 300)],
    "销售额 12,500，复购率 11.0%，客单价暂无结论。",
  );
  assert.equal(result.verdict, "mismatch");
  assert.deepEqual(result.hits.map((hit) => hit.status), ["matched", "suspect", "unreferenced"]);
});

test("verifyMetricUsage: fabricated — unregistered business number raises alarm", () => {
  const result = verifyMetricUsage(
    [snapshot("销售额", 12_500)],
    "本期销售额 12,500，但利润率达到了惊人的 9999。",
  );
  assert.equal(result.verdict, "mismatch");
  const fabricated = result.hits.find((hit) => hit.status === "fabricated");
  assert.ok(fabricated, "must detect fabricated number");
  assert.equal(fabricated?.foundInText, 9999);
});

test("verifyMetricUsage: fabricated — negative unregistered business number raises alarm", () => {
  const result = verifyMetricUsage(
    [snapshot("销售额", 12_500)],
    "本期销售额 12,500，但亏损扩大到 -9999。",
  );
  assert.equal(result.verdict, "mismatch");
  const fabricated = result.hits.find((hit) => hit.status === "fabricated");
  assert.ok(fabricated, "must detect negative fabricated number");
  assert.equal(fabricated?.foundInText, -9999);
});

test("verifyMetricUsage: year/date/ordinal numbers are not flagged as fabricated", () => {
  const result = verifyMetricUsage(
    [snapshot("销售额", 12_500)],
    "2024年销售额 12,500，第3季度表现良好，12月15号达到峰值，版本第12轮复盘。",
  );
  assert.equal(result.verdict, "ok");
  assert.equal(result.hits.some((hit) => hit.status === "fabricated"), false, "year/date/ordinal must not be fabricated");
});

test("verifyMetricUsage: small numbers (<10) are not flagged as fabricated", () => {
  const result = verifyMetricUsage(
    [snapshot("销售额", 12_500)],
    "本期销售额 12,500，共涉及 5 个渠道，排名第 2。",
  );
  assert.equal(result.verdict, "ok");
  assert.equal(result.hits.some((hit) => hit.status === "fabricated"), false, "small numbers must not be fabricated");
});

test("verifyMetricUsage: label_mismatch — value matches snapshot A but context mentions snapshot B", () => {
  const result = verifyMetricUsage(
    [snapshot("华东GMV", 120), snapshot("华北GMV", 85)],
    "华北GMV 达到 120，表现优异。",
  );
  assert.equal(result.verdict, "mismatch");
  const labelMismatch = result.hits.find((hit) => hit.status === "label_mismatch");
  assert.ok(labelMismatch, "must detect label_mismatch");
  assert.equal(labelMismatch?.name, "华东GMV");
  assert.equal(labelMismatch?.foundInText, 120);
  assert.ok(labelMismatch?.contextLabel?.includes("华北GMV"), "contextLabel must mention 华北GMV");
});

test("verifyMetricUsage: label_mismatch — value matches but context has wrong label", () => {
  const result = verifyMetricUsage(
    [snapshot("华北GMV", 120), snapshot("华东GMV", 85)],
    "华北GMV 达到 120，表现优异。",
  );
  assert.equal(result.verdict, "ok");
  const matched = result.hits.find((hit) => hit.name === "华北GMV");
  assert.equal(matched?.status, "matched");
  assert.equal(matched?.foundInText, 120);
});

test("verifyMetricUsage: normal match with correct label in context is not flagged", () => {
  const result = verifyMetricUsage(
    [snapshot("销售额", 12_500), snapshot("客单价", 300)],
    "本期销售额 12,500，客单价 300 元。",
  );
  assert.equal(result.verdict, "ok");
  assert.deepEqual(result.hits.map((hit) => hit.status), ["matched", "matched"]);
});

test("verifyMetricUsage: label_mismatch does not fire when context has both labels", () => {
  const result = verifyMetricUsage(
    [snapshot("华东GMV", 120), snapshot("华北GMV", 85)],
    "华东GMV 120，华北GMV 85。",
  );
  assert.equal(result.verdict, "ok");
  const east = result.hits.find((hit) => hit.name === "华东GMV");
  assert.equal(east?.status, "matched");
});
