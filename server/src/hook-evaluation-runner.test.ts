import assert from "node:assert/strict";
import test from "node:test";
import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runHookEvaluation } from "./hook-evaluation-runner.ts";
import type { Hook } from "../../pi-extensions/px-hook-runner/hook-eval-core.ts";
import type { HookEvalCase } from "./types.ts";

function run(hooks: Hook[], cases: HookEvalCase[], repeat = 1) {
  return runHookEvaluation({ evaluationId: "eval-1", workspaceId: "ws-1", hooks, cases, repeat });
}

test("must-block: blocking hook on tool_call passes; allow regime fails", () => {
  const hooks: Hook[] = [{ id: "guard", name: "Guard rm", enabled: true, event: "tool_call", match: { pattern: "rm -rf" }, action: { kind: "block", reason: "destructive command" } }];
  const blockCase: HookEvalCase = { id: "c", name: "block", event: "tool_call", payload: { toolName: "bash", args: { command: "rm -rf /" } }, expected: { kind: "must-block", reasonPattern: "destructive" } };
  assert.equal(run(hooks, [blockCase]).status, "success");

  // Loosen rule (no match) -> tool allowed -> must-block fails.
  const loose: Hook[] = [{ ...hooks[0]!, match: { pattern: "this-never-matches" } }];
  assert.equal(run(loose, [blockCase]).status, "failed");
});

test("must-allow: non-matching payload is allowed", () => {
  const hooks: Hook[] = [{ id: "guard", name: "Guard rm", enabled: true, event: "tool_call", match: { toolName: "bash", pattern: "rm -rf" }, action: { kind: "block", reason: "no" } }];
  const allowCase: HookEvalCase = { id: "c", name: "allow", event: "tool_call", payload: { toolName: "read", args: { command: "ls" } }, expected: { kind: "must-allow" } };
  assert.equal(run(hooks, [allowCase]).status, "success");
});

test("golden-mutation: mutate hook merges set into input copy", () => {
  const hooks: Hook[] = [{ id: "mut", name: "Inject flag", enabled: true, event: "tool_call", match: { toolName: "bash" }, action: { kind: "mutate", set: { sandbox: "true" } } }];
  const goldenCase: HookEvalCase = { id: "c", name: "mutate", event: "tool_call", payload: { toolName: "bash", input: { command: "ls" } }, expected: { kind: "golden-mutation", expectedInput: { command: "ls", sandbox: "true" } } };
  assert.equal(run(hooks, [goldenCase]).status, "success");

  const wrong: HookEvalCase = { ...goldenCase, expected: { kind: "golden-mutation", expectedInput: { command: "ls" } } };
  assert.equal(run(hooks, [wrong]).status, "failed");
});

test("match: matched hook id set equality (order-independent)", () => {
  const hooks: Hook[] = [
    { id: "a", name: "A", enabled: true, event: "tool_call", action: { kind: "log" } },
    { id: "b", name: "B", enabled: true, event: "tool_call", action: { kind: "notify", reason: "hi" } },
  ];
  const matchCase: HookEvalCase = { id: "c", name: "match", event: "tool_call", payload: { toolName: "bash" }, expected: { kind: "match", expectedHookIds: ["b", "a"] } };
  assert.equal(run(hooks, [matchCase]).status, "success");
});

test("trigger-count: counts matched hooks", () => {
  const hooks: Hook[] = [
    { id: "a", name: "A", enabled: true, event: "tool_call", action: { kind: "log" } },
    { id: "b", name: "B", enabled: true, event: "tool_call", action: { kind: "log" } },
  ];
  const okCase: HookEvalCase = { id: "c", name: "count", event: "tool_call", payload: {}, expected: { kind: "trigger-count", count: 2 } };
  assert.equal(run(hooks, [okCase]).status, "success");
  assert.equal(run(hooks, [{ ...okCase, expected: { kind: "trigger-count", count: 1 } }]).status, "failed");
});

test("hookIds subset filters which hooks participate", () => {
  const hooks: Hook[] = [
    { id: "a", name: "A", enabled: true, event: "tool_call", action: { kind: "block", reason: "a" } },
    { id: "b", name: "B", enabled: true, event: "tool_call", action: { kind: "log" } },
  ];
  // Only b participates -> not blocked.
  const allowCase: HookEvalCase = { id: "c", name: "subset", event: "tool_call", payload: {}, hookIds: ["b"], expected: { kind: "must-allow" } };
  assert.equal(run(hooks, [allowCase]).status, "success");
});

// ★安全红线：command 动作只枚举进 sideEffectKinds，绝不 spawn 执行。
test("SECURITY: command-action hook is enumerated but its shell command is NOT executed", () => {
  const sentinel = join(tmpdir(), `ponytail-hook-eval-sentinel-${Date.now()}.txt`);
  rmSync(sentinel, { force: true });
  try {
    const hooks: Hook[] = [{ id: "cmd", name: "Run shell", enabled: true, event: "tool_call", action: { kind: "command", command: `touch ${sentinel}` } }];
    const result = run(hooks, [{ id: "c", name: "cmd", event: "tool_call", payload: { toolName: "bash" }, expected: { kind: "trigger-count", count: 1 } }]);
    assert.equal(result.status, "success");
    assert.deepEqual(result.results[0]?.sideEffectKinds, ["command"]);
    assert.equal(existsSync(sentinel), false, "command hook must NOT spawn shell during eval");
  } finally {
    rmSync(sentinel, { force: true });
  }
});

test("validateOptions rejects bad repeat and empty cases", () => {
  const hooks: Hook[] = [];
  assert.throws(() => run(hooks, [], 0), /repeat must be an integer/);
  assert.throws(() => run(hooks, []), /cases must not be empty/);
});
