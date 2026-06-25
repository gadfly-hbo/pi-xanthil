import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { PiEvent } from "./types.ts";

interface ProcessStartEvent {
  type: "process_start";
  args: string[];
}

const testRoot = mkdtempSync(join(tmpdir(), "pi-xanthil-pi-adapter-skillpaths-test-"));
const fakePi = join(testRoot, "fake-pi.mjs");
writeFileSync(
  fakePi,
  [
    "#!/usr/bin/env node",
    "console.log(JSON.stringify({ type: 'message_end', message: { role: 'assistant', content: [{ type: 'text', text: 'ok' }] } }));",
  ].join("\n"),
  "utf8",
);
chmodSync(fakePi, 0o755);
process.env.XANTHIL_PI_BIN = fakePi;

const { runPiTurn } = await import("./pi-adapter.ts");

function isProcessStart(event: PiEvent): event is PiEvent & ProcessStartEvent {
  return event.type === "process_start" && Array.isArray((event as { args?: unknown }).args);
}

test("runPiTurn injects explicit skillPaths with --no-skills and --skill args", async () => {
  const skillPath = join(testRoot, ".pi", "skills", "focused", "SKILL.md");
  const events: PiEvent[] = [];

  const run = runPiTurn({
    workspaceRoot: testRoot,
    piSessionId: "skillpaths-test",
    text: "run task",
    skillPaths: [skillPath],
    onEvent: (event) => events.push(event),
  });

  assert.equal(await run.done, 0);
  const start = events.find(isProcessStart);
  assert.ok(start);
  assert.ok(start.args.includes("--no-skills"));
  assert.deepEqual(start.args.slice(start.args.indexOf("--skill"), start.args.indexOf("--skill") + 2), ["--skill", skillPath]);
});

test("runPiTurn preserves empty skillPaths as explicit skill disable", async () => {
  const events: PiEvent[] = [];

  const run = runPiTurn({
    workspaceRoot: testRoot,
    piSessionId: "skillpaths-empty-test",
    text: "run task",
    skillPaths: [],
    onEvent: (event) => events.push(event),
  });

  assert.equal(await run.done, 0);
  const start = events.find(isProcessStart);
  assert.ok(start);
  assert.ok(start.args.includes("--no-skills"));
  assert.equal(start.args.includes("--skill"), false);
});

test("runPiTurn conditionally injects metric lock prompt for extraction tools", async () => {
  const events: PiEvent[] = [];

  const run = runPiTurn({
    workspaceRoot: testRoot,
    piSessionId: "metric-lock-test",
    text: "run task",
    injectExtractionToolSystem: true,
    onEvent: (event) => events.push(event),
  });

  assert.equal(await run.done, 0);
  const start = events.find(isProcessStart);
  assert.ok(start);
  const promptIndex = start.args.indexOf("--system-prompt");
  assert.ok(promptIndex >= 0);
  const systemPrompt = start.args[promptIndex + 1] ?? "";
  assert.match(systemPrompt, /\[数据指标约束\]/);
  assert.match(systemPrompt, /禁止重新推导或自行算术运算/);
  assert.match(systemPrompt, /MetricSnapshot/);
});
