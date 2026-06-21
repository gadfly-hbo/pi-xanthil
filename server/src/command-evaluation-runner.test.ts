import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { runCommandEvaluation } from "./command-evaluation-runner.ts";
import type { PiRun } from "./pi-adapter.ts";
import type { XanCommand } from "./types.ts";

function command(overrides: Partial<XanCommand> = {}): XanCommand {
  return {
    id: "cmd-1",
    name: "summarize",
    enabled: true,
    template: "请总结：{{args}}",
    source: "custom",
    ...overrides,
  };
}

function fakeRun(): PiRun {
  return {
    done: Promise.resolve(0),
    kill: () => {},
    isRunning: () => false,
  };
}

test("expand-golden passes on exact match", async () => {
  const root = mkdtempSync(join(tmpdir(), "pi-xanthil-cmd-eval-"));
  const summary = await runCommandEvaluation({
    workspaceRoot: root,
    workspaceId: "ws-1",
    evaluationId: "eval-golden",
    command: command(),
    allCommands: [command()],
    repeat: 1,
    cases: [{
      id: "c1",
      name: "Golden",
      argsText: "本季度销售额",
      expected: { kind: "expand-golden", goldenText: "请总结：本季度销售额" },
    }],
  });
  assert.equal(summary.status, "success");
  assert.equal(summary.results[0]?.expandedText, "请总结：本季度销售额");
  assert.equal(summary.results[0]?.error, null);
});

test("expand-golden fails when one char changes", async () => {
  const root = mkdtempSync(join(tmpdir(), "pi-xanthil-cmd-eval-"));
  const summary = await runCommandEvaluation({
    workspaceRoot: root,
    workspaceId: "ws-1",
    evaluationId: "eval-golden-fail",
    command: command(),
    allCommands: [command()],
    repeat: 1,
    cases: [{
      id: "c1",
      name: "Golden mismatch",
      argsText: "本季度销售额",
      expected: { kind: "expand-golden", goldenText: "请总结:本季度销售额" },
    }],
  });
  assert.equal(summary.status, "failed");
  assert.ok(summary.results[0]?.error?.message.includes("golden mismatch"));
});

test("expand-contains forbidUnresolved catches leftover placeholders", async () => {
  const root = mkdtempSync(join(tmpdir(), "pi-xanthil-cmd-eval-"));
  const cmd = command({ template: "用 {{tone}} 语气总结：{{args}}" });
  const summary = await runCommandEvaluation({
    workspaceRoot: root,
    workspaceId: "ws-1",
    evaluationId: "eval-contains",
    command: cmd,
    allCommands: [cmd],
    repeat: 1,
    cases: [{
      id: "c1",
      name: "Unresolved",
      argsText: "数据",
      expected: { kind: "expand-contains", substrings: ["总结"], forbidUnresolved: true },
    }],
  });
  assert.equal(summary.status, "failed");
  assert.ok(summary.results[0]?.error?.message.includes("unresolved"));
});

test("skill-attached checks merged skill slugs", async () => {
  const root = mkdtempSync(join(tmpdir(), "pi-xanthil-cmd-eval-"));
  const cmd = command({ skillSlugs: ["data-analysis", "charting"] });
  const summary = await runCommandEvaluation({
    workspaceRoot: root,
    workspaceId: "ws-1",
    evaluationId: "eval-skill",
    command: cmd,
    allCommands: [cmd],
    repeat: 1,
    cases: [
      { id: "ok", name: "Subset", argsText: "x", expected: { kind: "skill-attached", expectedSkillSlugs: ["charting"] } },
      { id: "exact-fail", name: "Exact fail", argsText: "x", expected: { kind: "skill-attached", expectedSkillSlugs: ["charting"], exact: true } },
    ],
  });
  assert.equal(summary.results.find((r) => r.caseId === "ok")?.error, null);
  assert.ok(summary.results.find((r) => r.caseId === "exact-fail")?.error?.message.includes("unexpected"));
});

test("run-contains uses injected runTurn output", async () => {
  const root = mkdtempSync(join(tmpdir(), "pi-xanthil-cmd-eval-"));
  let receivedText = "";
  const summary = await runCommandEvaluation({
    workspaceRoot: root,
    workspaceId: "ws-1",
    evaluationId: "eval-run",
    command: command(),
    allCommands: [command()],
    repeat: 1,
    model: "fake-model",
    cases: [{
      id: "c1",
      name: "Run contains",
      argsText: "销量",
      expected: { kind: "run-contains", substrings: ["增长"] },
    }],
    runTurn: (opts) => {
      receivedText = opts.text;
      opts.onEvent?.({ type: "message_end", message: { role: "assistant", content: [{ type: "text", text: "销量同比增长 20%" }] } } as never);
      return fakeRun();
    },
  });
  assert.equal(summary.status, "success");
  assert.ok(receivedText.includes("请总结：销量"));
  assert.equal(summary.results[0]?.output, "销量同比增长 20%");
});

test("run-llm-judge applies minScore via injected judge", async () => {
  const root = mkdtempSync(join(tmpdir(), "pi-xanthil-cmd-eval-"));
  const summary = await runCommandEvaluation({
    workspaceRoot: root,
    workspaceId: "ws-1",
    evaluationId: "eval-judge",
    command: command(),
    allCommands: [command()],
    repeat: 1,
    model: "fake-model",
    cases: [{
      id: "c1",
      name: "Judge",
      argsText: "数据",
      expected: { kind: "run-llm-judge", rubric: "完整性", model: "judge-model", minScore: 80 },
    }],
    runTurn: (opts) => {
      opts.onEvent?.({ type: "message_end", message: { role: "assistant", content: [{ type: "text", text: "总结完成" }] } } as never);
      return fakeRun();
    },
    judgeOutput: async () => ({ score: 60, details: "below bar" }),
  });
  assert.equal(summary.status, "failed");
  assert.ok(summary.results[0]?.error?.message.includes("below minimum"));
});
