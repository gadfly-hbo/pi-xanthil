import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { runSubAgentEvaluation } from "./subagent-evaluation-runner.ts";
import type { PiRun } from "./pi-adapter.ts";
import type { SubAgentTurnInput } from "./subagent-core.ts";

function fakeRun(input: SubAgentTurnInput, tools: string[], tokens = 30): PiRun {
  input.onEvent({
    type: "message_end",
    message: {
      role: "assistant",
      content: tools.map((name) => ({ type: "tool_use", name })),
      usage: { input: 10, output: 20, cacheRead: 0, cacheWrite: 0, totalTokens: tokens, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0.01 } },
    },
  } as never);
  input.onEvent({ type: "message_end", message: { role: "assistant", content: [{ type: "text", text: "done" }] } } as never);
  return { done: Promise.resolve(0), kill: () => {}, isRunning: () => false };
}

test("captures ordered tool trajectory and budget metrics", async () => {
  const root = mkdtempSync(join(tmpdir(), "subagent-eval-"));
  const summary = await runSubAgentEvaluation({
    workspaceRoot: root,
    workspaceId: "ws",
    evaluationId: "eval",
    model: "model",
    repeat: 1,
    trackUsage: false,
    cases: [{ id: "trace", name: "Trace", personaOverride: "analyst", brief: "analyze", dataFiles: [], expected: { kind: "tool-sequence", required: ["read", "write"], orderedSubsequence: true } }],
    runTurn: (input) => fakeRun(input, ["read", "write"]),
  });
  assert.equal(summary.status, "success");
  assert.deepEqual(summary.results[0]?.toolTrajectory, ["read", "write"]);
  assert.equal(summary.results[0]?.stepCount, 2);
  assert.equal(summary.results[0]?.totalTokens, 30);
});

test("fails forbidden tool and token budget assertions", async () => {
  const root = mkdtempSync(join(tmpdir(), "subagent-eval-"));
  const summary = await runSubAgentEvaluation({
    workspaceRoot: root,
    workspaceId: "ws",
    evaluationId: "eval",
    model: "model",
    repeat: 1,
    trackUsage: false,
    cases: [
      { id: "forbidden", name: "Forbidden", personaOverride: "analyst", brief: "x", dataFiles: [], expected: { kind: "tool-sequence", forbidden: ["shell"] } },
      { id: "tokens", name: "Tokens", personaOverride: "analyst", brief: "x", dataFiles: [], expected: { kind: "token-budget", maxTokens: 10 } },
    ],
    runTurn: (input) => fakeRun(input, ["shell"], 30),
  });
  assert.equal(summary.status, "failed");
  assert.match(summary.results[0]?.error?.message ?? "", /Forbidden tools/);
  assert.match(summary.results[1]?.error?.message ?? "", /Token budget exceeded/);
});

test("uses injected judge and detects report output", async () => {
  const root = mkdtempSync(join(tmpdir(), "subagent-eval-"));
  const reportRun = (input: SubAgentTurnInput): PiRun => {
    const match = input.systemPrompt.match(/写入目录：([^（\n]+)/u);
    assert.ok(match?.[1]);
    mkdirSync(match[1].trim(), { recursive: true });
    writeFileSync(join(match[1].trim(), "report.md"), "report", "utf8");
    return fakeRun(input, ["write"]);
  };
  const summary = await runSubAgentEvaluation({
    workspaceRoot: root,
    workspaceId: "ws",
    evaluationId: "eval",
    model: "model",
    repeat: 1,
    trackUsage: false,
    cases: [
      { id: "report", name: "Report", personaOverride: "analyst", brief: "x", dataFiles: [], expected: { kind: "report-presence" } },
      { id: "judge", name: "Judge", personaOverride: "analyst", brief: "x", dataFiles: [], expected: { kind: "llm-judge", rubric: "correct", model: "judge", minScore: 80 } },
    ],
    runTurn: reportRun,
    judgeOutput: async () => ({ score: 90, details: "good" }),
  });
  assert.equal(summary.status, "success");
  assert.match(summary.results[0]?.reportPath ?? "", /report\.md$/u);
});

test("rejects draw_data paths before starting the turn", async () => {
  const root = mkdtempSync(join(tmpdir(), "subagent-eval-"));
  const rawDir = join(root, "sessions", "s1", "010_raw");
  mkdirSync(rawDir, { recursive: true });
  const rawFile = join(rawDir, "raw.csv");
  writeFileSync(rawFile, "secret", "utf8");
  let called = false;
  const summary = await runSubAgentEvaluation({
    workspaceRoot: root,
    workspaceId: "ws",
    evaluationId: "eval",
    model: "model",
    repeat: 1,
    trackUsage: false,
    cases: [{ id: "raw", name: "Raw", personaOverride: "analyst", brief: "x", dataFiles: [rawFile], expected: { kind: "report-presence" } }],
    runTurn: (input) => { called = true; return fakeRun(input, []); },
  });
  assert.equal(called, false);
  assert.equal(summary.status, "failed");
  assert.match(summary.results[0]?.error?.message ?? "", /clean_data/);
});

test("passes existing clean_data files through the shared allowlist", async () => {
  const root = mkdtempSync(join(tmpdir(), "subagent-eval-"));
  const cleanDir = join(root, "sessions", "s1", "020_clean");
  mkdirSync(cleanDir, { recursive: true });
  const cleanFile = join(cleanDir, "aggregate.csv");
  writeFileSync(cleanFile, "metric,value\norders,10", "utf8");
  let systemPrompt = "";
  const summary = await runSubAgentEvaluation({
    workspaceRoot: root,
    workspaceId: "ws",
    evaluationId: "eval",
    model: "model",
    repeat: 1,
    trackUsage: false,
    cases: [{ id: "clean", name: "Clean", personaOverride: "analyst", brief: "x", dataFiles: [cleanFile], expected: { kind: "step-budget", maxSteps: 2 } }],
    runTurn: (input) => { systemPrompt = input.systemPrompt; return fakeRun(input, []); },
  });
  assert.equal(summary.status, "success");
  assert.match(systemPrompt, /aggregate\.csv/u);
});

test("rejects clean_data files outside the workspace root", async () => {
  const root = mkdtempSync(join(tmpdir(), "subagent-eval-"));
  // 文件落在 workspace 之外、但目录名恰为 020_clean —— workspaceRoot 加固后必须被拒。
  const outside = mkdtempSync(join(tmpdir(), "outside-"));
  const outsideClean = join(outside, "020_clean");
  mkdirSync(outsideClean, { recursive: true });
  const outsideFile = join(outsideClean, "leak.csv");
  writeFileSync(outsideFile, "secret", "utf8");
  let called = false;
  const summary = await runSubAgentEvaluation({
    workspaceRoot: root,
    workspaceId: "ws",
    evaluationId: "eval",
    model: "model",
    repeat: 1,
    trackUsage: false,
    cases: [{ id: "outside", name: "Outside", personaOverride: "analyst", brief: "x", dataFiles: [outsideFile], expected: { kind: "report-presence" } }],
    runTurn: (input) => { called = true; return fakeRun(input, []); },
  });
  assert.equal(called, false);
  assert.equal(summary.status, "failed");
  assert.match(summary.results[0]?.error?.message ?? "", /clean_data/);
});
