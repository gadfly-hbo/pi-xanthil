import { strict as assert } from "node:assert";
import { test } from "node:test";
import { renderSourceLabel } from "./metric-source-label.ts";
import type { MetricSnapshot } from "./types.ts";

function baseSnapshot(patch: Partial<MetricSnapshot> = {}): MetricSnapshot {
  return {
    name: "GMV",
    value: 100,
    period: "2026-06",
    status: "normal",
    source: "extraction_tool",
    evidenceLevel: "A",
    ...patch,
  };
}

test("renderSourceLabel renders extraction tool source ref", () => {
  assert.equal(
    renderSourceLabel(baseSnapshot({
      sourceRef: {
        kind: "extraction_tool",
        toolId: "sales-tool",
        toolName: "销售工具",
        summaryKey: "summary.gmv",
        period: "2026-W25",
      },
    })),
    "[来源:销售工具/summary.gmv·2026-W25·实测A]",
  );
});

test("renderSourceLabel renders bi aggregation source ref", () => {
  assert.equal(
    renderSourceLabel(baseSnapshot({
      source: "bi_aggregation",
      evidenceLevel: "B",
      sourceRef: {
        kind: "bi_aggregation",
        runId: "run-1",
        findingId: "finding-1",
        metricId: "gmv",
        window: "近7日",
      },
    })),
    "[来源:gmv/近7日·2026-06·衍生B]",
  );
});

test("renderSourceLabel uses evidence override for display", () => {
  assert.equal(
    renderSourceLabel(baseSnapshot({
      evidenceLevel: "A",
      evidenceOverride: "D",
      sourceRef: {
        kind: "extraction_tool",
        toolId: "estimate-tool",
        summaryKey: "summary.forecast",
      },
    })),
    "[来源:estimate-tool/summary.forecast·2026-06·估计D]",
  );
});

test("renderSourceLabel falls back when sourceRef is absent", () => {
  assert.equal(
    renderSourceLabel(baseSnapshot({ source: "bi_aggregation", evidenceLevel: "B" })),
    "[来源:聚合计算·2026-06·衍生B]",
  );
});

