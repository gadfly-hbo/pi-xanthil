import { test } from "node:test";
import { strict as assert } from "node:assert";
import type { MetricSnapshot, PiEvent, PiMessage } from "./types.ts";
import { appendMetricVerificationBlock, collectMetricSnapshotsFromEvent } from "./metric-verification-events.ts";

const snapshots: MetricSnapshot[] = [
  {
    name: "销售额",
    value: 12_500,
    period: "2026-06",
    status: "normal",
    source: "extraction_tool",
  },
];

function assistant(text: string): PiMessage {
  return {
    role: "assistant",
    timestamp: Date.now(),
    content: [{ type: "text", text }],
  };
}

test("collectMetricSnapshotsFromEvent: extracts snapshots from MCP tool_result text", () => {
  const event: PiEvent = {
    type: "tool_result",
    content: [
      {
        type: "text",
        text: [
          "[指标快照·代码确定性计算值·禁止重新推导]",
          "以下 MetricSnapshot 由工具确定性产物计算得出。",
          JSON.stringify(snapshots),
        ].join("\n"),
      },
    ],
  };
  assert.deepEqual(collectMetricSnapshotsFromEvent(event), snapshots);
});

test("appendMetricVerificationBlock: appends warning block only on mismatch", () => {
  const ok = appendMetricVerificationBlock(assistant("销售额为 12,500。"), snapshots);
  assert.equal(ok.content.some((block) => (block as { type?: string }).type === "metric_verification"), false);

  const mismatch = appendMetricVerificationBlock(assistant("销售额为 12,000。"), snapshots);
  const block = mismatch.content.find((item) => (item as { type?: string }).type === "metric_verification") as
    | { type: "metric_verification"; verification: { verdict: string; hits: Array<{ status: string; name: string }> } }
    | undefined;
  assert.equal(block?.verification.verdict, "mismatch");
  assert.equal(block?.verification.hits[0]?.name, "销售额");
  assert.equal(block?.verification.hits[0]?.status, "suspect");
});
