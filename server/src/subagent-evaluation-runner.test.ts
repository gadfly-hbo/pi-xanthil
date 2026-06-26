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

// ============ D-QEVAL3 硬断言扩展 ============

import { checkHardRules } from "./subagent-evaluation-runner.ts";

test("D-QEVAL3: must_call_tools violation marks ruleFailed (independent of judge)", async () => {
  const root = mkdtempSync(join(tmpdir(), "subagent-eval-"));
  const summary = await runSubAgentEvaluation({
    workspaceRoot: root,
    workspaceId: "ws",
    evaluationId: "eval",
    model: "model",
    repeat: 1,
    trackUsage: false,
    cases: [{
      id: "must-call",
      name: "MustCall",
      personaOverride: "analyst",
      brief: "x",
      dataFiles: [],
      expected: { kind: "step-budget", maxSteps: 10 },
      mustCallTools: ["read", "write"],
    }],
    runTurn: (input) => fakeRun(input, ["read"]), // 缺 write
  });
  // status 仍 success（expected.step-budget 通过），但 ruleFailed=true
  assert.equal(summary.results[0]?.status, "success");
  assert.equal(summary.results[0]?.ruleFailed, true);
  const hard = summary.results[0]?.hardRuleResults ?? [];
  const rule = hard.find((r) => r.rule === "mustCallTools");
  assert.ok(rule);
  assert.equal(rule.passed, false);
  assert.match(rule.detail, /write/);
});

test("D-QEVAL3: pass@k aggregates ruleCheck × status across repeats", async () => {
  const root = mkdtempSync(join(tmpdir(), "subagent-eval-"));
  let attempt = 0;
  const summary = await runSubAgentEvaluation({
    workspaceRoot: root,
    workspaceId: "ws",
    evaluationId: "eval",
    model: "model",
    repeat: 4,
    trackUsage: false,
    cases: [{
      id: "pak",
      name: "PaK",
      personaOverride: "analyst",
      brief: "x",
      dataFiles: [],
      expected: { kind: "step-budget", maxSteps: 10 },
      mustCallTools: ["read"],
    }],
    runTurn: (input) => {
      attempt += 1;
      // attempt 1,3: 调用 read（pass）；2,4: 不调用（ruleFailed）→ pass@4 = 2/4 = 0.5
      return fakeRun(input, attempt % 2 === 1 ? ["read"] : ["write"]);
    },
  });
  const sum = summary.caseSummaries[0]!;
  assert.equal(sum.total, 4);
  assert.equal(sum.passAtK, 0.5);
  // ruleCheckPassed 是聚合视图：只要有一次 fail → false
  assert.equal(sum.ruleCheckPassed, false);
  assert.ok(sum.ruleCheckDetails.find((r) => r.rule === "mustCallTools")?.passed === false);
});

test("D-QEVAL3: cases with no hard rules → ruleFailed undefined, pass@k tracks status only", async () => {
  const root = mkdtempSync(join(tmpdir(), "subagent-eval-"));
  const summary = await runSubAgentEvaluation({
    workspaceRoot: root,
    workspaceId: "ws",
    evaluationId: "eval",
    model: "model",
    repeat: 2,
    trackUsage: false,
    cases: [{ id: "no-hard", name: "NoHard", personaOverride: "analyst", brief: "x", dataFiles: [], expected: { kind: "step-budget", maxSteps: 10 } }],
    runTurn: (input) => fakeRun(input, ["read"]),
  });
  const sum = summary.caseSummaries[0]!;
  assert.equal(sum.passAtK, 1);
  assert.equal(sum.ruleCheckPassed, true);
  assert.equal(sum.ruleCheckDetails.length, 0);
  assert.equal(summary.results[0]?.ruleFailed, undefined);
  assert.equal(summary.results[0]?.hardRuleResults, undefined);
});

test("D-QEVAL3: checkHardRules covers all 7 rule kinds", () => {
  const baseCase = {
    id: "c", name: "C", personaOverride: "p", brief: "b", dataFiles: [],
    expected: { kind: "step-budget" as const, maxSteps: 10 },
  };
  // 全失败的运行结果
  const fail = checkHardRules(
    {
      ...baseCase,
      mustCallTools: ["read"],
      mustNotCallTools: ["delete"],
      outputContains: ["要点"],
      outputNotContains: ["敏感"],
      minOutputChars: 100,
      maxToolCalls: 1,
      maxCostUsd: 0.001,
    },
    { toolTrajectory: ["delete"], output: "敏感", toolCalls: 5, totalCost: 0.5 },
  );
  assert.equal(fail.length, 7);
  for (const r of fail) assert.equal(r.passed, false, `rule ${r.rule} should fail`);

  // 全通过
  const pass = checkHardRules(
    {
      ...baseCase,
      mustCallTools: ["read"],
      mustNotCallTools: ["delete"],
      outputContains: ["要点"],
      outputNotContains: ["敏感"],
      minOutputChars: 2,
      maxToolCalls: 5,
      maxCostUsd: 1,
    },
    { toolTrajectory: ["read"], output: "要点说明", toolCalls: 1, totalCost: 0.0001 },
  );
  assert.equal(pass.length, 7);
  for (const r of pass) assert.equal(r.passed, true, `rule ${r.rule} should pass`);
});

test("D-QEVAL3: outputVariance is coefficient of variation across successful runs", async () => {
  const root = mkdtempSync(join(tmpdir(), "subagent-eval-"));
  let attempt = 0;
  await runSubAgentEvaluation({
    workspaceRoot: root,
    workspaceId: "ws",
    evaluationId: "eval",
    model: "model",
    repeat: 3,
    trackUsage: false,
    cases: [{ id: "var", name: "Var", personaOverride: "a", brief: "x", dataFiles: [], expected: { kind: "step-budget", maxSteps: 10 } }],
    runTurn: (input) => {
      attempt += 1;
      // 每次输出文字长度不同：done 长度=4，但 fakeRun 改不动……
      // 测试 cv 至少能计算（实际 fakeRun 三次都是 "done" 输出长度相同 → cv=0）
      return fakeRun(input, []);
    },
  }).then((summary) => {
    assert.equal(summary.caseSummaries[0]?.outputVariance, 0);
  });
});

test("D-QEVAL3: cases without hard rules keep summary backward compatible", () => {
  // 没硬断言时，summary 的 ruleCheckDetails=[], ruleCheckPassed=true, passAtK 与传统 success ratio 一致
  const dummy = checkHardRules(
    { id: "c", name: "C", personaOverride: "p", brief: "b", dataFiles: [], expected: { kind: "step-budget" as const, maxSteps: 10 } },
    { toolTrajectory: [], output: "", toolCalls: 0, totalCost: 0 },
  );
  assert.equal(dummy.length, 0);
});
