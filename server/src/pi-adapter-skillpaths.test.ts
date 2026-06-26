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
    "console.log(JSON.stringify({ type: 'test_env', allowWeb: process.env.PX_ALLOW_WEB || '' }));",
    "console.log(JSON.stringify({ type: 'message_end', message: { role: 'assistant', content: [{ type: 'text', text: 'ok' }] } }));",
  ].join("\n"),
  "utf8",
);
chmodSync(fakePi, 0o755);
process.env.XANTHIL_PI_BIN = fakePi;

const { runPiTurn } = await import("./pi-adapter.ts");
const { runSubAgentTurn } = await import("./subagent-core.ts");

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

test("runPiTurn conditionally injects causal layering prompt for formal reports", async () => {
  const events: PiEvent[] = [];

  const run = runPiTurn({
    workspaceRoot: testRoot,
    piSessionId: "causal-layering-test",
    text: "run task",
    injectCausalLayering: true,
    onEvent: (event) => events.push(event),
  });

  assert.equal(await run.done, 0);
  const start = events.find(isProcessStart);
  assert.ok(start);
  const promptIndex = start.args.indexOf("--system-prompt");
  assert.ok(promptIndex >= 0);
  const systemPrompt = start.args[promptIndex + 1] ?? "";
  assert.match(systemPrompt, /\[正式报告因果分层约束\]/);
  assert.match(systemPrompt, /观察 Observation/);
  assert.match(systemPrompt, /证伪条件/);
});

test("handleSend/handleSendFlow contract: empty skillPaths → --no-skills without --skill (zero default skills loaded)", async () => {
  const events: PiEvent[] = [];
  const run = runPiTurn({
    workspaceRoot: testRoot,
    piSessionId: "handle-send-contract",
    text: "run task",
    skillPaths: [],
    onEvent: (event) => events.push(event),
  });
  assert.equal(await run.done, 0);
  const start = events.find(isProcessStart);
  assert.ok(start);
  assert.ok(start.args.includes("--no-skills"), "handleSend must pass [] → --no-skills to disable default pi skills");
  assert.equal(start.args.includes("--skill"), false, "handleSend must not inject --skill when no skills requested");
});

test("handleSend/handleSendFlow contract: explicit skillPaths → --no-skills + --skill (whitelist only)", async () => {
  const skillPath = join(testRoot, ".pi", "skills", "focused", "SKILL.md");
  const events: PiEvent[] = [];
  const run = runPiTurn({
    workspaceRoot: testRoot,
    piSessionId: "handle-send-whitelist",
    text: "run task",
    skillPaths: [skillPath],
    onEvent: (event) => events.push(event),
  });
  assert.equal(await run.done, 0);
  const start = events.find(isProcessStart);
  assert.ok(start);
  assert.ok(start.args.includes("--no-skills"), "must include --no-skills");
  const skillIdx = start.args.indexOf("--skill");
  assert.ok(skillIdx >= 0, "must include --skill for whitelisted path");
  assert.equal(start.args[skillIdx + 1], skillPath, "only whitelisted skill path injected");
  assert.equal(start.args.indexOf("--skill", skillIdx + 1), -1, "no extra --skill beyond whitelist");
});

test("delegated subagent defaults omitted skillPaths to --no-skills", async () => {
  const events: PiEvent[] = [];
  const run = runSubAgentTurn({
    cwd: testRoot,
    piSessionId: "subagent-default-no-skills",
    text: "run delegated task",
    systemPrompt: "subagent system",
    onEvent: (event) => events.push(event),
  });
  assert.equal(await run.done, 0);
  const start = events.find(isProcessStart);
  assert.ok(start);
  assert.ok(start.args.includes("--no-skills"), "delegated subagent must disable default pi skills when skillPaths is omitted");
  assert.equal(start.args.includes("--skill"), false, "delegated subagent must not inject skills unless explicitly whitelisted");
});

test("delegated subagent preserves explicit skill whitelist", async () => {
  const skillPath = join(testRoot, ".pi", "skills", "delegated", "SKILL.md");
  const events: PiEvent[] = [];
  const run = runSubAgentTurn({
    cwd: testRoot,
    piSessionId: "subagent-whitelist",
    text: "run delegated task",
    systemPrompt: "subagent system",
    skillPaths: [skillPath],
    onEvent: (event) => events.push(event),
  });
  assert.equal(await run.done, 0);
  const start = events.find(isProcessStart);
  assert.ok(start);
  assert.ok(start.args.includes("--no-skills"), "delegated subagent whitelist must still disable default pi skills first");
  const skillIdx = start.args.indexOf("--skill");
  assert.ok(skillIdx >= 0, "delegated subagent must include --skill for whitelisted path");
  assert.equal(start.args[skillIdx + 1], skillPath);
  assert.equal(start.args.indexOf("--skill", skillIdx + 1), -1, "no extra --skill beyond whitelist");
});

test("runPiTurn exposes explicit web authorization only when requested", async () => {
  const deniedEvents: PiEvent[] = [];
  const denied = runPiTurn({
    workspaceRoot: testRoot,
    piSessionId: "web-denied-test",
    text: "run task",
    onEvent: (event) => deniedEvents.push(event),
  });
  assert.equal(await denied.done, 0);
  assert.equal((deniedEvents.find((event) => (event as { type?: string }).type === "test_env") as { allowWeb?: string } | undefined)?.allowWeb, "");

  const allowedEvents: PiEvent[] = [];
  const allowed = runPiTurn({
    workspaceRoot: testRoot,
    piSessionId: "web-allowed-test",
    text: "run task",
    allowWeb: true,
    onEvent: (event) => allowedEvents.push(event),
  });
  assert.equal(await allowed.done, 0);
  assert.equal((allowedEvents.find((event) => (event as { type?: string }).type === "test_env") as { allowWeb?: string } | undefined)?.allowWeb, "1");
});
