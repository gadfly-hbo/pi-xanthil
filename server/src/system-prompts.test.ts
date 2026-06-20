import assert from "node:assert/strict";
import test from "node:test";
import { listSystemPromptOverviews } from "./system-prompts.ts";

test("system prompt overview includes every required source family", () => {
  const prompts = listSystemPromptOverviews();
  const sources = prompts.map((item) => item.source);

  assert.ok(sources.some((source) => source.startsWith("prompt-blocks.ts:")));
  assert.ok(sources.includes("memory-injection.ts:buildMemoryPrompt"));
  assert.ok(sources.includes("memory-injection.ts:withRulesPrompt"));
  assert.ok(sources.includes("index.ts:WORKFLOW_SYSTEM_PROMPTS.report"));
  assert.ok(sources.includes("index.ts:generatePresentationVersionWithLlm.systemPrompt"));
  assert.ok(sources.some((source) => source.startsWith("anax-full.nodes.")));
  assert.ok(sources.some((source) => source.startsWith("anax-quick.nodes.")));
  assert.ok(sources.some((source) => source.startsWith("sql-loop.nodes.")));
  assert.ok(sources.includes("types.ts:ClientMessage.send_flow.systemPrompt"));
});

test("system prompt overview exposes only the read-only metadata shape", () => {
  const prompts = listSystemPromptOverviews();
  assert.ok(prompts.length > 0);

  for (const item of prompts) {
    assert.deepEqual(Object.keys(item).sort(), ["label", "preview", "scope", "source"]);
    assert.ok(item.source.length > 0);
    assert.ok(item.label.length > 0);
    assert.ok(item.scope.length > 0);
    assert.ok(item.preview.length > 0 && item.preview.length <= 240);
  }
});
