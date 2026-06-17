import assert from "node:assert/strict";
import test from "node:test";
import { aiToolRowGuardMessage, guardAiToolRows, guardToolRunSummaryForSource } from "./ai-tool-row-guard.ts";

test("guardAiToolRows blocks and truncates oversized detail arrays", () => {
  const result = guardAiToolRows({
    success: 1,
    results: [{ rows: [{ id: 1 }, { id: 2 }, { id: 3 }] }],
  }, 2);

  assert.equal(result.blocked, true);
  assert.equal(result.maxRowsSeen, 3);
  assert.deepEqual(result.summary, {
    success: 1,
    results: [{ rows: [{ id: 1 }, { id: 2 }] }],
  });
});

test("guardAiToolRows does not treat aggregate count scalar as row count", () => {
  const result = guardAiToolRows({
    rows: [
      { date: "2026-06-01", count: 12345 },
      { date: "2026-06-02", count: 23456 },
    ],
  }, 100);

  assert.equal(result.blocked, false);
  assert.equal(result.maxRowsSeen, 2);
});

test("guardToolRunSummaryForSource does not block manual runs", () => {
  const summary = { rows: [{ id: 1 }, { id: 2 }, { id: 3 }] };
  const result = guardToolRunSummaryForSource("manual", summary, 1);

  assert.equal(result.blocked, false);
  assert.equal(result.maxRowsSeen, 0);
  assert.equal(result.summary, summary);
});

test("guardAiToolRows blocks nested detail objects and preserves message wording", () => {
  const result = guardAiToolRows({
    nested: { data: [{ id: 1 }, { id: 2 }, { id: 3 }] },
  }, 1);

  assert.equal(result.blocked, true);
  assert.deepEqual(result.summary, { nested: { data: [{ id: 1 }] } });
  assert.equal(aiToolRowGuardMessage(1), "结果超 1 行，疑似明细输出，请加 GROUP BY/COUNT 聚合");
});
