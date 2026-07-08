import assert from "node:assert/strict";
import test from "node:test";
import { parseActionDraftsFromLlm } from "./routes/viz.ts";

test("parseActionDraftsFromLlm extracts fenced array and normalizes fields", () => {
  const drafts = parseActionDraftsFromLlm(`前置说明
\`\`\`json
[
  {
    "title": "优化会员触达",
    "rationale": "报告指出复购弱",
    "scene": "日常",
    "lifecycle": "R复购",
    "expectedImpact": "提升复购率",
    "priority": "high",
    "effort": "medium",
    "confidence": 0.8,
  }
]
\`\`\`
后置说明`);
  assert.equal(drafts.length, 1);
  assert.equal(drafts[0]?.title, "优化会员触达");
  assert.equal(drafts[0]?.scene, "日常");
  assert.equal(drafts[0]?.lifecycle, "R复购");
  assert.equal(drafts[0]?.priority, "high");
  assert.equal(drafts[0]?.confidence, 0.8);
});

test("parseActionDraftsFromLlm throws instead of returning a fake draft for invalid JSON", () => {
  assert.throws(() => parseActionDraftsFromLlm("不是 JSON"), /does not contain JSON array/);
});
