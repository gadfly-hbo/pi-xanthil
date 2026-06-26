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
