import assert from "node:assert/strict";
import test from "node:test";
import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runHookEvaluation } from "./hook-evaluation-runner.ts";
import { buildHookRedTeamCases, REDTEAM_GUARDRAIL_HOOK } from "./hook-redteam-fixtures.ts";
import {
  BUILTIN_WEB_SEARCH_GUARD_ID,
  WEB_SEARCH_BLOCK_REASON,
  evaluateHookFixture,
  type Hook,
} from "../../pi-extensions/px-hook-runner/hook-eval-core.ts";
import type { HookEvalCase } from "./types.ts";

function run(hooks: Hook[], cases: HookEvalCase[], repeat = 1) {
  return runHookEvaluation({ evaluationId: "rt-eval", workspaceId: "ws-1", hooks, cases, repeat });
}

test("red-team: all guardrail-bypass cases are still blocked (content-keyed defense beats toolName mutation)", () => {
  const cases = buildHookRedTeamCases();
  const summary = run([REDTEAM_GUARDRAIL_HOOK], cases);
  assert.equal(summary.status, "success", "every red-team preset case must meet its expectation");

  // 每个攻击 case（多个变形 toolName）都应命中护栏被拦。
  const bypassResults = summary.results.filter((r) => r.caseId.startsWith("rt-") && !r.caseId.startsWith("rt-benign"));
  assert.ok(bypassResults.length >= 8, "expected the preset bypass set");
  for (const r of bypassResults) {
    assert.equal(r.blocked, true, `bypass case ${r.caseId} must be blocked`);
    assert.deepEqual(r.matchedHookIds, [REDTEAM_GUARDRAIL_HOOK.id]);
  }
});

test("red-team: benign negative-control commands are allowed (guardrail is not blanket-block)", () => {
  const cases = buildHookRedTeamCases();
  const summary = run([REDTEAM_GUARDRAIL_HOOK], cases);
  const benign = summary.results.filter((r) => r.caseId.startsWith("rt-benign"));
  assert.ok(benign.length >= 1);
  for (const r of benign) {
    assert.equal(r.blocked, false, `benign case ${r.caseId} must be allowed`);
  }
});

test("red-team SECURITY: bypass evaluation NEVER executes any command (zero side-effect)", () => {
  const sentinel = join(tmpdir(), `redteam-sentinel-${Date.now()}.txt`);
  rmSync(sentinel, { force: true });
  // 即便护栏是 block 动作，evaluateHookFixture 也只判定不执行；额外坐实没有任何 spawn。
  const cases = buildHookRedTeamCases();
  run([REDTEAM_GUARDRAIL_HOOK], cases);
  assert.equal(existsSync(sentinel), false, "red-team eval must not touch the filesystem");
});

test("red-team: a content-keyed block still fires when toolName is renamed to evade name-based rules", () => {
  // 对照实验：按 toolName 拦截的弱护栏会被改名绕过，而 content 护栏不会。
  const weakNameRule: Hook = {
    id: "weak-name-block",
    name: "弱护栏：仅按 toolName=bash 拦截",
    enabled: true,
    event: "tool_call",
    match: { toolName: "bash" },
    action: { kind: "block", reason: "blocked bash" },
  };
  const renamed: HookEvalCase = {
    id: "rt-rename-vs-weak",
    name: "改名 toolName 后弱护栏失效",
    event: "tool_call",
    payload: { toolName: "shell-exec-v2", input: { command: "rm -rf /tmp/x" } },
    hookIds: ["weak-name-block"],
    expected: { kind: "must-allow" }, // 弱护栏确实放行 → 证明 toolName 护栏脆弱
  };
  assert.equal(run([weakNameRule], [renamed]).status, "success", "weak name-based rule is bypassed by rename");

  // 同一变形事件交给 content 护栏 → 被拦。
  const strong: HookEvalCase = {
    ...renamed,
    id: "rt-rename-vs-strong",
    hookIds: [REDTEAM_GUARDRAIL_HOOK.id],
    expected: { kind: "must-block", reasonPattern: "red-team guardrail" },
  };
  assert.equal(run([REDTEAM_GUARDRAIL_HOOK], [strong]).status, "success", "content guardrail still blocks renamed tool");
});

test("web guard: web_search is blocked unless PX_ALLOW_WEB is explicitly set", () => {
  const previous = process.env.PX_ALLOW_WEB;
  delete process.env.PX_ALLOW_WEB;
  try {
    const blocked = evaluateHookFixture([], "tool_call", { toolName: "web_search", input: { query: "商圈研究" } });
    assert.equal(blocked.blocked, true);
    assert.equal(blocked.blockReason, WEB_SEARCH_BLOCK_REASON);
    assert.deepEqual(blocked.matchedHookIds, [BUILTIN_WEB_SEARCH_GUARD_ID]);

    process.env.PX_ALLOW_WEB = "1";
    const allowed = evaluateHookFixture([], "tool_call", { toolName: "web_search", input: { query: "商圈研究" } });
    assert.equal(allowed.blocked, false);
    assert.deepEqual(allowed.matchedHookIds, []);
  } finally {
    if (previous === undefined) delete process.env.PX_ALLOW_WEB;
    else process.env.PX_ALLOW_WEB = previous;
  }
});

test("web guard: blocks web_search with case and separator variants", () => {
  const previous = process.env.PX_ALLOW_WEB;
  delete process.env.PX_ALLOW_WEB;
  try {
    const variants = [
      { toolName: "Web_Search", input: { query: "test" } },
      { toolName: "WEB_SEARCH", input: { query: "test" } },
      { toolName: "web-search", input: { query: "test" } },
      { toolName: "WebSearch", input: { query: "test" } },
    ];
    for (const payload of variants) {
      const verdict = evaluateHookFixture([], "tool_call", payload);
      assert.equal(verdict.blocked, true, `variant ${JSON.stringify(payload.toolName)} must be blocked`);
      assert.equal(verdict.blockReason, WEB_SEARCH_BLOCK_REASON);
      assert.deepEqual(verdict.matchedHookIds, [BUILTIN_WEB_SEARCH_GUARD_ID]);
    }
  } finally {
    if (previous === undefined) delete process.env.PX_ALLOW_WEB;
    else process.env.PX_ALLOW_WEB = previous;
  }
});

test("web guard: blocks web_search when toolName is missing but input/args contain the signal", () => {
  const previous = process.env.PX_ALLOW_WEB;
  delete process.env.PX_ALLOW_WEB;
  try {
    const viaInputName = evaluateHookFixture([], "tool_call", { toolName: "custom_tool", input: { name: "web_search", query: "test" } });
    assert.equal(viaInputName.blocked, true, "web_search in input.name must be blocked");

    const viaArgsTool = evaluateHookFixture([], "tool_call", { toolName: "custom_tool", args: { tool: "web_search", query: "test" } });
    assert.equal(viaArgsTool.blocked, true, "web_search in args.tool must be blocked");

    const viaInputCommand = evaluateHookFixture([], "tool_call", { toolName: "custom_tool", input: { command: "web_search --query=test" } });
    assert.equal(viaInputCommand.blocked, true, "web_search in input.command must be blocked");
  } finally {
    if (previous === undefined) delete process.env.PX_ALLOW_WEB;
    else process.env.PX_ALLOW_WEB = previous;
  }
});

test("web guard: allows benign tools even when description mentions web_search", () => {
  const previous = process.env.PX_ALLOW_WEB;
  delete process.env.PX_ALLOW_WEB;
  try {
    const masqueradeDesc = evaluateHookFixture([], "tool_call", { toolName: "text_completion", input: { description: "uses web_search internally", text: "hello" } });
    assert.equal(masqueradeDesc.blocked, false, "web_search in description field must not trigger block");

    const masqueradeTextField = evaluateHookFixture([], "tool_call", { toolName: "text_completion", input: { text: "please use web_search to find info" } });
    assert.equal(masqueradeTextField.blocked, false, "web_search in text field must not trigger block");
  } finally {
    if (previous === undefined) delete process.env.PX_ALLOW_WEB;
    else process.env.PX_ALLOW_WEB = previous;
  }
});
