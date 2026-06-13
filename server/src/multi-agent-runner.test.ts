import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import assert from "node:assert/strict";
import test from "node:test";
import { makeFakePiAdapter } from "./multi-agent-runner.test-helpers.ts";
import { extractMarkerArray, readWorkflow, runMultiAgent, validateWorkflow, type WorkflowDef } from "./multi-agent-runner.ts";
import { trackUsageEvent } from "./cache.ts";
import { createWorkspace } from "./db.ts";
import type { GateVerdict } from "./anax-gate.ts";
import { buildSqlLoopWorkflow, RUN_SQL_QUERY_TOOL_ID } from "./sql-loop-template.ts";
import type { PiEvent, PiUsage } from "./types.ts";
import type { RegisteredExtractionTool } from "../tools/registry.ts";

function makeRunDir(): string {
  return mkdtempSync(join(tmpdir(), "pi-xanthil-multi-agent-test-"));
}

function makeBaseOptions(runDir: string, runTurn: ReturnType<typeof makeFakePiAdapter>["runTurn"]) {
  return {
    flowRoot: runDir,
    runId: "test-run",
    runDir,
    runTurn,
    onStepStart: () => undefined,
    onStepEvent: () => undefined,
    onStepEnd: () => undefined,
    onBlackboardUpdate: () => undefined,
  };
}

function fakeExtractionTool(): RegisteredExtractionTool {
  return {
    id: "fake-tool",
    name: "Fake Tool",
    version: "1.0.0",
    description: "Fake extraction tool for workflow tests",
    entry: "fake.py",
    runtime: "python3",
    input: { accept: [".txt"], modes: ["file"] },
    output: ["json"],
    rootPath: "/tmp/fake-tool",
    entryPath: "/tmp/fake-tool/fake.py",
  };
}

function verdictText(input: Partial<GateVerdict> & { verdict?: "pass" | "blocked" }): string {
  return [
    "```anax-verdict",
    JSON.stringify({
      stage: input.stage ?? "quality_gate",
      verdict: input.verdict ?? "pass",
      blockers: input.blockers ?? 0,
      reasons: input.reasons ?? [],
      redLines: input.redLines ?? [],
      stages: input.stages ?? [{ stage: input.stage ?? "quality_gate", confidence: "high", evidence: 3 }],
      summary: input.summary ?? "ok",
    }),
    "```",
  ].join("\n");
}

function messageEnd(text: string, usage?: PiUsage): PiEvent {
  return {
    type: "message_end",
    message: {
      role: "assistant",
      content: [{ type: "text", text }],
      usage,
    },
  } as unknown as PiEvent;
}

function usage(totalTokens: number, totalCost = 0): PiUsage {
  return {
    input: totalTokens,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: totalCost },
  };
}

test("validateWorkflow accepts legacy nodes that use label as the prompt fallback", () => {
  const workflow = {
    nodes: [{ id: "legacy", label: "Legacy node" }],
    edges: [],
  };

  assert.doesNotThrow(() => validateWorkflow(workflow));
});

test("validateWorkflow rejects invalid node schema before execution", async () => {
  const adapter = makeFakePiAdapter({}, "test-run");
  const workflow = {
    nodes: [{ id: "bad", label: "", prompt: "" }],
    edges: [],
  } as unknown as WorkflowDef;

  await assert.rejects(
    () => runMultiAgent(workflow, makeBaseOptions(makeRunDir(), adapter.runTurn)),
    /must provide prompt or label/,
  );
  assert.equal(adapter.calls.length, 0);
});

test("validateWorkflow rejects edges that reference missing nodes", () => {
  const workflow = {
    nodes: [{ id: "only", label: "Only", prompt: "Run" }],
    edges: [{ id: "missing-edge", source: "only", target: "missing" }],
  };

  assert.throws(() => validateWorkflow(workflow), /target references missing node: missing/);
});

test("validateWorkflow rejects invalid skill path fields", () => {
  assert.throws(
    () => validateWorkflow({
      defaultSkillPaths: "not-array",
      nodes: [{ id: "only", label: "Only", prompt: "Run" }],
      edges: [],
    }),
    /defaultSkillPaths must be a string array/,
  );
  assert.throws(
    () => validateWorkflow({
      nodes: [{ id: "only", label: "Only", prompt: "Run", skillPaths: [1] }],
      edges: [],
    }),
    /workflow.nodes\[0\].skillPaths must be a string array/,
  );
});

test("validateWorkflow requires tool node fields", () => {
  assert.throws(
    () => validateWorkflow({
      nodes: [{ id: "tool", label: "Tool", prompt: "Run", kind: "tool", inputPath: "/tmp/input.txt" }],
      edges: [],
    }),
    /toolId is required/,
  );
  assert.throws(
    () => validateWorkflow({
      nodes: [{ id: "tool", label: "Tool", prompt: "Run", kind: "tool", toolId: "fake-tool" }],
      edges: [],
    }),
    /inputPath is required/,
  );
});

test("readWorkflow returns null for schema-invalid workflow files", () => {
  const flowRoot = makeRunDir();
  writeFileSync(
    join(flowRoot, "workflow.json"),
    JSON.stringify({
      nodes: [{ id: "only", label: "Only", prompt: "Run" }],
      edges: [{ id: "missing-edge", source: "only", target: "missing" }],
    }),
    "utf8",
  );

  assert.equal(readWorkflow(flowRoot), null);
});

test("runMultiAgent passes workflow default skills to child agents", async () => {
  const adapter = makeFakePiAdapter({ first: { text: "first output" }, second: { text: "second output" } }, "test-run");
  const workflow: WorkflowDef = {
    defaultSkillPaths: ["/skills/default/SKILL.md"],
    nodes: [
      { id: "first", label: "First", prompt: "Run first" },
      { id: "second", label: "Second", prompt: "Run second" },
    ],
    edges: [{ id: "first-second", source: "first", target: "second" }],
  };

  await runMultiAgent(workflow, makeBaseOptions(makeRunDir(), adapter.runTurn));

  assert.deepEqual(adapter.calls.map((call) => call.skillPaths), [
    ["/skills/default/SKILL.md"],
    ["/skills/default/SKILL.md"],
  ]);
});

test("runMultiAgent lets node skills override or disable workflow defaults", async () => {
  const adapter = makeFakePiAdapter(
    {
      inherited: { text: "inherited output" },
      overridden: { text: "overridden output" },
      disabled: { text: "disabled output" },
    },
    "test-run",
  );
  const workflow: WorkflowDef = {
    defaultSkillPaths: ["/skills/default/SKILL.md"],
    nodes: [
      { id: "inherited", label: "Inherited", prompt: "Run inherited" },
      { id: "overridden", label: "Overridden", prompt: "Run overridden", skillPaths: ["/skills/node/SKILL.md"] },
      { id: "disabled", label: "Disabled", prompt: "Run disabled", skillPaths: [] },
    ],
    edges: [
      { id: "inherited-overridden", source: "inherited", target: "overridden" },
      { id: "overridden-disabled", source: "overridden", target: "disabled" },
    ],
  };

  await runMultiAgent(workflow, makeBaseOptions(makeRunDir(), adapter.runTurn));

  assert.deepEqual(adapter.calls.map((call) => call.skillPaths), [
    ["/skills/default/SKILL.md"],
    ["/skills/node/SKILL.md"],
    [],
  ]);
});

test("runMultiAgent executes a tool node and exposes its output to downstream agents", async () => {
  const runDir = makeRunDir();
  const inputPath = join(runDir, "input.txt");
  writeFileSync(inputPath, "source", "utf8");
  const seenPrompts: string[] = [];
  const adapter = makeFakePiAdapter(
    {
      analysis: {
        build: (opts) => {
          seenPrompts.push(opts.text);
          return { text: "analysis output" };
        },
      },
    },
    "test-run",
  );
  const toolCalls: Array<{ inputPath: string; outputPath: string; summaryPath: string }> = [];
  const workflow: WorkflowDef = {
    nodes: [
      {
        id: "extract",
        label: "Extract",
        prompt: "Run extraction",
        kind: "tool",
        toolId: "fake-tool",
        inputPath: "{{input.source_path}}",
        outputDir: "tool-output",
      },
      { id: "analysis", label: "Analysis", prompt: "Analyze {{extract}}" },
    ],
    edges: [{ id: "extract-analysis", source: "extract", target: "analysis" }],
  };

  const result = await runMultiAgent(workflow, {
    ...makeBaseOptions(runDir, adapter.runTurn),
    inputs: { source_path: inputPath },
    getTool: () => fakeExtractionTool(),
    runTool: async (opts) => {
      toolCalls.push({ inputPath: opts.inputPath, outputPath: opts.outputPath, summaryPath: opts.summaryPath });
      mkdirSync(opts.outputPath, { recursive: true });
      writeFileSync(join(opts.outputPath, "result.json"), JSON.stringify({ ok: true }), "utf8");
      writeFileSync(opts.summaryPath, JSON.stringify({ success: 1, failed: 0 }), "utf8");
      return { code: 0, stdout: "done\n", stderr: "" };
    },
  });

  assert.equal(result.code, 0);
  assert.equal(adapter.calls.length, 1);
  assert.equal(toolCalls.length, 1);
  assert.equal(toolCalls[0]?.inputPath, inputPath);
  assert.equal(toolCalls[0]?.outputPath, join(runDir, "tool-output"));
  const toolOutput = JSON.parse(result.blackboard.extract ?? "{}") as {
    kind?: string;
    success?: boolean;
    artifacts?: string[];
    summary?: { success?: number };
  };
  assert.equal(toolOutput.kind, "tool");
  assert.equal(toolOutput.success, true);
  assert.deepEqual(toolOutput.artifacts, ["result.json"]);
  assert.equal(toolOutput.summary?.success, 1);
  assert.ok(seenPrompts[0]?.includes('"toolId": "fake-tool"'));
  assert.equal(result.blackboard.analysis, "analysis output");
});

test("runMultiAgent halts downstream nodes when a tool node fails", async () => {
  const runDir = makeRunDir();
  const inputPath = join(runDir, "input.txt");
  writeFileSync(inputPath, "source", "utf8");
  const adapter = makeFakePiAdapter({ downstream: { text: "should not run" } }, "test-run");
  const started: string[] = [];
  const workflow: WorkflowDef = {
    nodes: [
      { id: "extract", label: "Extract", prompt: "Run extraction", kind: "tool", toolId: "fake-tool", inputPath },
      { id: "downstream", label: "Downstream", prompt: "After {{extract}}" },
    ],
    edges: [{ id: "extract-downstream", source: "extract", target: "downstream" }],
  };

  const result = await runMultiAgent(workflow, {
    ...makeBaseOptions(runDir, adapter.runTurn),
    getTool: () => fakeExtractionTool(),
    runTool: async (opts) => {
      writeFileSync(opts.summaryPath, JSON.stringify({ success: 0, failed: 1, error: "boom" }), "utf8");
      return { code: 1, stdout: "", stderr: "boom" };
    },
    onStepStart: (nodeId) => {
      started.push(nodeId);
    },
  });

  assert.equal(result.code, 1);
  assert.deepEqual(started, ["extract"]);
  assert.equal(adapter.calls.length, 0);
  const toolOutput = JSON.parse(result.blackboard.extract ?? "{}") as { success?: boolean; stderr?: string };
  assert.equal(toolOutput.success, false);
  assert.equal(toolOutput.stderr, "boom");
});

test("runMultiAgent executes a registered tool-only workflow and records artifacts", async () => {
  const runDir = makeRunDir();
  const fixturePath = join(process.cwd(), "server/tools/phone-cleaner/tests/fixtures/minimal.csv");
  const adapter = makeFakePiAdapter({}, "test-run");
  const workflow: WorkflowDef = {
    nodes: [
      {
        id: "clean",
        label: "Clean phones",
        prompt: "Clean phones",
        kind: "tool",
        toolId: "phone-cleaner",
        inputPath: fixturePath,
        outputDir: "phone-output",
        timeoutMs: 60_000,
      },
    ],
    edges: [],
  };

  const result = await runMultiAgent(workflow, makeBaseOptions(runDir, adapter.runTurn));

  assert.equal(result.code, 0);
  assert.equal(adapter.calls.length, 0);
  const toolOutput = JSON.parse(result.blackboard.clean ?? "{}") as {
    kind?: string;
    toolId?: string;
    success?: boolean;
    outputPath?: string;
    summaryPath?: string;
    artifacts?: string[];
    summary?: { success?: number; failed?: number; results?: Array<{ uniquePhones?: number }> };
  };
  assert.equal(toolOutput.kind, "tool");
  assert.equal(toolOutput.toolId, "phone-cleaner");
  assert.equal(toolOutput.success, true);
  assert.equal(toolOutput.outputPath, join(runDir, "phone-output"));
  assert.ok(toolOutput.summaryPath?.endsWith(join("clean", "summary.json")));
  assert.deepEqual(toolOutput.summary?.success, 1);
  assert.deepEqual(toolOutput.summary?.failed, 0);
  assert.deepEqual(toolOutput.summary?.results?.[0]?.uniquePhones, 2);
  assert.ok(toolOutput.artifacts?.includes("数据清洗日志.txt"));
  assert.ok(toolOutput.artifacts?.includes(join("小红书", "minimal_小红书.csv")));
  assert.ok(toolOutput.artifacts?.includes(join("天猫和京东", "minimal.csv")));
  assert.ok(toolOutput.artifacts?.includes(join("抖音", "minimal.zip")));
  assert.ok(existsSync(join(runDir, "phone-output", "数据清洗日志.txt")));
});

test("runMultiAgent stops before the next node when aborted between steps", async () => {
  let aborted = false;
  const started: string[] = [];
  const ended: Array<{ nodeId: string; code: number | null; output: string }> = [];
  const adapter = makeFakePiAdapter(
    {
      first: { text: "first output" },
      second: { text: "second output" },
    },
    "test-run",
  );
  const workflow: WorkflowDef = {
    nodes: [
      { id: "first", label: "First", prompt: "Run first" },
      { id: "second", label: "Second", prompt: "Run second after {{first}}" },
    ],
    edges: [{ id: "first-second", source: "first", target: "second" }],
  };

  const result = await runMultiAgent(workflow, {
    ...makeBaseOptions(makeRunDir(), adapter.runTurn),
    onStepStart: (nodeId) => {
      started.push(nodeId);
    },
    onStepEnd: (nodeId, code, output) => {
      ended.push({ nodeId, code, output });
      if (nodeId === "first") aborted = true;
    },
    isAborted: () => aborted,
  });

  assert.equal(result.code, null);
  assert.deepEqual(result.blackboard, { first: "first output" });
  assert.deepEqual(started, ["first"]);
  assert.deepEqual(ended, [{ nodeId: "first", code: 0, output: "first output" }]);
  assert.equal(adapter.calls.length, 1);
});

test("runMultiAgent stops after killing an in-flight node", async () => {
  let aborted = false;
  const started: string[] = [];
  const ended: Array<{ nodeId: string; code: number | null; output: string }> = [];
  const adapter = makeFakePiAdapter(
    {
      first: { stall: true },
      second: { text: "second output" },
    },
    "test-run",
  );
  const workflow: WorkflowDef = {
    nodes: [
      { id: "first", label: "First", prompt: "Run first" },
      { id: "second", label: "Second", prompt: "Run second after {{first}}" },
    ],
    edges: [{ id: "first-second", source: "first", target: "second" }],
  };

  const result = await runMultiAgent(workflow, {
    ...makeBaseOptions(makeRunDir(), adapter.runTurn),
    onStepStart: (nodeId) => {
      started.push(nodeId);
    },
    onStepRun: (_nodeId, run) => {
      aborted = true;
      run.kill();
    },
    onStepEnd: (nodeId, code, output) => {
      ended.push({ nodeId, code, output });
    },
    isAborted: () => aborted,
  });

  assert.equal(result.code, null);
  assert.deepEqual(result.blackboard, {});
  assert.deepEqual(started, ["first"]);
  assert.deepEqual(ended, [{ nodeId: "first", code: null, output: "" }]);
  assert.equal(adapter.calls.length, 1);
  assert.equal(adapter.calls[0]?.piSessionId, "test-run-first");
});

test("runMultiAgent blocks downstream nodes when a gate verdict is blocked", async () => {
  const runDir = makeRunDir();
  const started: string[] = [];
  const gates: Array<{ nodeId: string; verdict: GateVerdict }> = [];
  const events: Array<{ nodeId: string; event: PiEvent }> = [];
  const adapter = makeFakePiAdapter(
    {
      draft: { text: "draft output" },
      quality_gate: {
        text: [
          "review complete",
          "```anax-verdict",
          JSON.stringify({
            stage: "quality_gate",
            redLines: [{ id: "RL-1", desc: "missing source evidence" }],
            stages: [{ stage: "quality_gate", confidence: "high", evidence: 3 }],
            summary: "blocked because source evidence is missing",
            modelVerdict: "pass",
          }),
          "```",
        ].join("\n"),
      },
      downstream: { text: "should not run" },
    },
    "test-run",
  );
  const workflow: WorkflowDef = {
    nodes: [
      { id: "draft", label: "Draft", prompt: "Write draft" },
      { id: "quality_gate", label: "Quality Gate", prompt: "Review {{draft}}", kind: "gate" },
      { id: "downstream", label: "Downstream", prompt: "Continue after {{quality_gate}}" },
    ],
    edges: [
      { id: "draft-gate", source: "draft", target: "quality_gate" },
      { id: "gate-downstream", source: "quality_gate", target: "downstream" },
    ],
  };

  const result = await runMultiAgent(workflow, {
    ...makeBaseOptions(runDir, adapter.runTurn),
    onStepStart: (nodeId) => {
      started.push(nodeId);
    },
    onStepEvent: (nodeId, event) => {
      events.push({ nodeId, event });
    },
    onStepGate: (nodeId, verdict) => {
      gates.push({ nodeId, verdict });
    },
  });

  assert.equal(result.code, 1);
  assert.deepEqual(started, ["draft", "quality_gate"]);
  assert.equal(adapter.calls.length, 2);
  assert.equal(events.length, 2);
  assert.equal(gates.length, 1);
  assert.equal(gates[0]?.nodeId, "quality_gate");
  assert.equal(gates[0]?.verdict.verdict, "blocked");
  assert.equal(gates[0]?.verdict.blockers, 1);
  assert.deepEqual(result.blackboard.draft, "draft output");
  assert.ok(result.blackboard.quality_gate);
  assert.match(result.blackboard.quality_gate, /anax-verdict/);

  const gateFile = join(runDir, "gates", "quality_gate.json");
  assert.equal(existsSync(gateFile), true);
  const persisted = JSON.parse(readFileSync(gateFile, "utf8")) as GateVerdict;
  assert.equal(persisted.verdict, "blocked");
  assert.deepEqual(persisted.reasons, ["[RL-1] missing source evidence"]);
});

test("runMultiAgent succeeds when an onBlock gate passes", async () => {
  const runDir = makeRunDir();
  const started: string[] = [];
  const gates: GateVerdict[] = [];
  const adapter = makeFakePiAdapter(
    {
      draft: { text: "draft output" },
      quality_gate: { text: verdictText({ stage: "quality_gate", verdict: "pass", summary: "passed" }) },
      downstream: { text: "done" },
    },
    "test-run",
  );
  const workflow: WorkflowDef = {
    nodes: [
      { id: "draft", label: "Draft", prompt: "Write draft" },
      {
        id: "quality_gate",
        label: "Quality Gate",
        prompt: "Review {{draft}}",
        kind: "gate",
        onBlock: { retryFromNodeId: "draft", maxIterations: 2 },
      },
      { id: "downstream", label: "Downstream", prompt: "Continue after {{quality_gate}}" },
    ],
    edges: [
      { id: "draft-gate", source: "draft", target: "quality_gate" },
      { id: "gate-downstream", source: "quality_gate", target: "downstream" },
    ],
  };

  const result = await runMultiAgent(workflow, {
    ...makeBaseOptions(runDir, adapter.runTurn),
    onStepStart: (nodeId) => started.push(nodeId),
    onStepGate: (_nodeId, verdict) => gates.push(verdict),
  });

  assert.equal(result.code, 0);
  assert.deepEqual(started, ["draft", "quality_gate", "downstream"]);
  assert.equal(gates.length, 1);
  assert.equal(gates[0]?.verdict, "pass");
  assert.equal(existsSync(join(runDir, "gates", "quality_gate-iter1.json")), true);
});

test("runMultiAgent stops on maxIterations exhaustion and records the stop reason in the gate verdict", async () => {
  const runDir = makeRunDir();
  const started: string[] = [];
  const gates: GateVerdict[] = [];
  let draftTurn = 0;
  const adapter = makeFakePiAdapter(
    {
      draft: {
        build: () => {
          draftTurn += 1;
          return { text: `draft output ${draftTurn}` };
        },
      },
      quality_gate: {
        text: verdictText({
          stage: "quality_gate",
          verdict: "blocked",
          blockers: 1,
          reasons: ["missing evidence"],
          redLines: [{ id: "RL-1", desc: "missing evidence" }],
          summary: "blocked",
        }),
      },
      downstream: { text: "should not run" },
    },
    "test-run",
  );
  const workflow: WorkflowDef = {
    nodes: [
      { id: "draft", label: "Draft", prompt: "Write draft {{quality_gate__feedback}}" },
      {
        id: "quality_gate",
        label: "Quality Gate",
        prompt: "Review {{draft}}",
        kind: "gate",
        onBlock: { retryFromNodeId: "draft", maxIterations: 2 },
      },
      { id: "downstream", label: "Downstream", prompt: "Continue" },
    ],
    edges: [
      { id: "draft-gate", source: "draft", target: "quality_gate" },
      { id: "gate-downstream", source: "quality_gate", target: "downstream" },
    ],
  };

  const result = await runMultiAgent(workflow, {
    ...makeBaseOptions(runDir, adapter.runTurn),
    onStepStart: (nodeId) => started.push(nodeId),
    onStepGate: (_nodeId, verdict) => gates.push(verdict),
  });

  assert.equal(result.code, 1);
  assert.deepEqual(started, ["draft", "quality_gate", "draft", "quality_gate"]);
  assert.equal(adapter.calls.some((call) => call.piSessionId === "test-run-downstream"), false);
  assert.equal(gates.length, 2);
  assert.equal(gates[1]?.verdict, "blocked");
  assert.ok(gates[1]?.reasons.some((reason) => reason.includes("重试轮次已耗尽")));
  assert.equal(existsSync(join(runDir, "draft", "iter-1")), true);
  assert.equal(existsSync(join(runDir, "draft", "iter-2")), true);
  assert.equal(existsSync(join(runDir, "gates", "quality_gate-iter2.json")), true);
  const persisted = JSON.parse(readFileSync(join(runDir, "gates", "quality_gate.json"), "utf8")) as GateVerdict;
  assert.ok(persisted.reasons.some((reason) => reason.includes("重试轮次已耗尽")));
});

test("runMultiAgent stops on run budget after a node and records a traceable blackboard update", async () => {
  const runDir = makeRunDir();
  const workspace = createWorkspace("runner budget stop");
  const started: string[] = [];
  const updates: Record<string, string> = {};
  const adapter = makeFakePiAdapter(
    {
      first: { events: [messageEnd("first output", usage(10))] },
      second: { text: "should not run" },
    },
    "test-run",
  );
  const workflow: WorkflowDef = {
    nodes: [
      { id: "first", label: "First", prompt: "Run first" },
      { id: "second", label: "Second", prompt: "Run second after {{first}}" },
    ],
    edges: [{ id: "first-second", source: "first", target: "second" }],
  };

  const result = await runMultiAgent(workflow, {
    ...makeBaseOptions(runDir, adapter.runTurn),
    runBudget: { workspaceId: workspace.id, limits: { maxTotalTokens: 5 } },
    onStepStart: (nodeId) => started.push(nodeId),
    onStepEvent: (_nodeId, event) => {
      trackUsageEvent({
        workspaceId: workspace.id,
        targetKind: "flow_run",
        targetId: "test-run",
        title: "runner budget stop",
      }, event);
    },
    onBlackboardUpdate: (key, value) => {
      updates[key] = value;
    },
  });

  assert.equal(result.code, 1);
  assert.deepEqual(started, ["first"]);
  assert.equal(adapter.calls.some((call) => call.piSessionId === "test-run-second"), false);
  assert.match(result.blackboard.__run_budget_stop ?? "", /token 用量 10 超过本 run 上限 5/);
  assert.match(updates.__run_budget_stop ?? "", /token 用量 10 超过本 run 上限 5/);
});

test("runMultiAgent hard-stops on deterministic red-line violations without entering the retry loop", async () => {
  const runDir = makeRunDir();
  const started: string[] = [];
  const gates: GateVerdict[] = [];
  const adapter = makeFakePiAdapter(
    {
      data: { text: "数据质量报告\n综合评分: 4.2/10\n样本不足" },
      data_gate: { text: verdictText({ stage: "data_gate", verdict: "pass", summary: "model says pass" }) },
      downstream: { text: "should not run" },
    },
    "test-run",
  );
  const workflow: WorkflowDef = {
    nodes: [
      { id: "data", label: "Data", prompt: "Score data" },
      {
        id: "data_gate",
        label: "Data Gate",
        prompt: "Review {{data}}",
        kind: "gate",
        onBlock: { retryFromNodeId: "data", maxIterations: 3 },
      },
      { id: "downstream", label: "Downstream", prompt: "Continue" },
    ],
    edges: [
      { id: "data-gate", source: "data", target: "data_gate" },
      { id: "gate-downstream", source: "data_gate", target: "downstream" },
    ],
  };

  const result = await runMultiAgent(workflow, {
    ...makeBaseOptions(runDir, adapter.runTurn),
    onStepStart: (nodeId) => started.push(nodeId),
    onStepGate: (_nodeId, verdict) => gates.push(verdict),
  });

  assert.equal(result.code, 1);
  assert.deepEqual(started, ["data", "data_gate"]);
  assert.equal(adapter.calls.filter((call) => call.piSessionId === "test-run-data").length, 1);
  assert.equal(adapter.calls.some((call) => call.piSessionId === "test-run-downstream"), false);
  assert.equal(gates.length, 1);
  assert.equal(gates[0]?.verdict, "blocked");
  assert.ok(gates[0]?.reasons.some((reason) => reason.includes("RL03")));
  assert.equal(result.blackboard.data_gate__feedback, undefined);
});

test("buildSqlLoopWorkflow produces a valid onBlock SQL loop template", () => {
  const workflow = buildSqlLoopWorkflow();

  assert.doesNotThrow(() => validateWorkflow(workflow));
  assert.deepEqual(workflow.nodes.map((node) => node.id), ["plan", "sql", "run_sql", "sql_gate"]);
  const runSql = workflow.nodes.find((node) => node.id === "run_sql");
  const sqlGate = workflow.nodes.find((node) => node.id === "sql_gate");
  assert.equal(runSql?.kind, "tool");
  assert.equal(runSql?.toolId, RUN_SQL_QUERY_TOOL_ID);
  assert.equal(sqlGate?.kind, "gate");
  assert.deepEqual(sqlGate?.onBlock, { retryFromNodeId: "sql", maxIterations: 5, feedbackVar: "sql_error" });
});

test("runMultiAgent routes SQL tool failures through sql_gate and retries with sql_error feedback", async () => {
  const runDir = makeRunDir();
  const started: string[] = [];
  const gates: GateVerdict[] = [];
  const sqlPrompts: string[] = [];
  let sqlTurn = 0;
  const adapter = makeFakePiAdapter(
    {
      plan: { text: "query customers" },
      sql: {
        build: (opts) => {
          sqlPrompts.push(opts.text);
          sqlTurn += 1;
          return { text: ["```sql", `SELECT customer_id, gmv FROM missing_table LIMIT ${sqlTurn}`, "```"].join("\n") };
        },
      },
      downstream: { text: "should not run" },
    },
    "test-run",
  );
  const workflow: WorkflowDef = {
    nodes: [
      { id: "plan", label: "Plan", prompt: "Plan" },
      { id: "sql", label: "SQL", prompt: "Generate SQL\n{{sql_error}}", inputs: ["plan"] },
      {
        id: "run_sql",
        label: "Run SQL",
        prompt: "Run",
        kind: "tool",
        toolId: RUN_SQL_QUERY_TOOL_ID,
        inputPath: "{{sql}}",
        inputs: ["sql"],
      },
      {
        id: "sql_gate",
        label: "SQL Gate",
        prompt: "Gate {{run_sql}}",
        kind: "gate",
        inputs: ["run_sql"],
        onBlock: { retryFromNodeId: "sql", maxIterations: 2, feedbackVar: "sql_error" },
      },
      { id: "downstream", label: "Downstream", prompt: "Continue" },
    ],
    edges: [
      { id: "plan-sql", source: "plan", target: "sql" },
      { id: "sql-run", source: "sql", target: "run_sql" },
      { id: "run-gate", source: "run_sql", target: "sql_gate" },
      { id: "gate-downstream", source: "sql_gate", target: "downstream" },
    ],
  };

  const result = await runMultiAgent(workflow, {
    ...makeBaseOptions(runDir, adapter.runTurn),
    inputs: { required_fields: "customer_id,gmv" },
    onStepStart: (nodeId) => started.push(nodeId),
    onStepGate: (_nodeId, verdict) => gates.push(verdict),
  });

  assert.equal(result.code, 1);
  assert.deepEqual(started, ["plan", "sql", "run_sql", "sql_gate", "sql", "run_sql", "sql_gate"]);
  assert.equal(adapter.calls.some((call) => call.piSessionId === "test-run-sql_gate"), false);
  assert.equal(adapter.calls.some((call) => call.piSessionId === "test-run-downstream"), false);
  assert.equal(sqlPrompts.length, 2);
  assert.match(sqlPrompts[1] ?? "", /上一轮门禁未通过/);
  assert.match(sqlPrompts[1] ?? "", /missing input\.sql_connection_id/);
  assert.equal(gates.length, 2);
  assert.equal(gates[0]?.verdict, "blocked");
  assert.equal(gates[1]?.verdict, "blocked");
  assert.ok(gates[1]?.reasons.some((reason) => reason.includes("重试轮次已耗尽")));
  const runSqlOutput = JSON.parse(result.blackboard.run_sql ?? "{}") as { kind?: string; success?: boolean; code?: number; error?: string };
  assert.equal(runSqlOutput.kind, "sql_tool");
  assert.equal(runSqlOutput.success, false);
  assert.equal(runSqlOutput.code, 1);
  assert.match(runSqlOutput.error ?? "", /missing input\.sql_connection_id/);
});

test("T-E5 MVP SQL loop converges with real SQLite data and the real run-sql-query tool", () => {
  const dataRoot = makeRunDir();
  const script = String.raw`
    import { mkdirSync } from "node:fs";
    import { join } from "node:path";
    import { pathToFileURL } from "node:url";
    import { DatabaseSync } from "node:sqlite";

    const cwd = process.cwd();
    const moduleUrl = (relativePath) => pathToFileURL(join(cwd, relativePath)).href;
    const dataRoot = process.env.XANTHIL_DATA_DIR;
    if (!dataRoot) throw new Error("XANTHIL_DATA_DIR required");
    mkdirSync(dataRoot, { recursive: true });

    const sqlitePath = join(dataRoot, "aggregate.sqlite");
    const db = new DatabaseSync(sqlitePath);
    db.exec("CREATE TABLE agg_sales (customer_id TEXT NOT NULL, gmv REAL NOT NULL)");
    db.prepare("INSERT INTO agg_sales (customer_id, gmv) VALUES (?, ?)").run("C001", 120.5);
    db.prepare("INSERT INTO agg_sales (customer_id, gmv) VALUES (?, ?)").run("C002", 88.25);
    db.close();

    const { upsertConnection } = await import(moduleUrl("server/src/sql-connections.ts"));
    const { runMultiAgent } = await import(moduleUrl("server/src/multi-agent-runner.ts"));
    const { buildSqlLoopWorkflow } = await import(moduleUrl("server/src/sql-loop-template.ts"));
    const { makeFakePiAdapter } = await import(moduleUrl("server/src/multi-agent-runner.test-helpers.ts"));

    const connection = upsertConnection({
      name: "T-E5 SQLite aggregate",
      type: "sqlite",
      filePath: sqlitePath,
    });
    const runDir = join(dataRoot, "sql-loop-run");
    mkdirSync(runDir, { recursive: true });

    const sqlPrompts = [];
    let sqlTurn = 0;
    const adapter = makeFakePiAdapter({
      plan: { text: "Query customer GMV from agg_sales." },
      sql: {
        build: (opts) => {
          sqlPrompts.push(opts.text);
          sqlTurn += 1;
          return {
            text: sqlTurn === 1
              ? ["\`\`\`sql", "SELECT customer_id, gmv FROM missing_table LIMIT 10", "\`\`\`"].join("\n")
              : ["\`\`\`sql", "SELECT customer_id, gmv FROM agg_sales ORDER BY gmv DESC LIMIT 10", "\`\`\`"].join("\n"),
          };
        },
      },
    }, "sql-e2e");

    const started = [];
    const gates = [];
    const result = await runMultiAgent(buildSqlLoopWorkflow(), {
      flowRoot: runDir,
      runId: "sql-e2e",
      runDir,
      runTurn: adapter.runTurn,
      inputs: {
        task: "Return customer GMV rows.",
        sql_connection_id: connection.id,
        required_fields: "customer_id,gmv",
        schema_context: "table agg_sales(customer_id TEXT, gmv REAL)",
      },
      onStepStart: (nodeId) => started.push(nodeId),
      onStepEvent: () => undefined,
      onStepEnd: () => undefined,
      onBlackboardUpdate: () => undefined,
      onStepGate: (_nodeId, verdict) => gates.push(verdict),
    });

    console.log(JSON.stringify({
      code: result.code,
      started,
      gates,
      sqlPromptCount: sqlPrompts.length,
      secondPrompt: sqlPrompts[1] ?? "",
      runSql: JSON.parse(result.blackboard.run_sql ?? "{}"),
      adapterCalls: adapter.calls.map((call) => call.piSessionId),
    }));
  `;

  const stdout = execFileSync(
    process.execPath,
    ["--experimental-strip-types", "--input-type=module", "-e", script],
    {
      cwd: process.cwd(),
      env: { ...process.env, XANTHIL_DATA_DIR: dataRoot },
      encoding: "utf8",
      maxBuffer: 1024 * 1024,
    },
  );
  const parsed = JSON.parse(stdout.trim()) as {
    code?: number | null;
    started?: string[];
    gates?: GateVerdict[];
    sqlPromptCount?: number;
    secondPrompt?: string;
    runSql?: { kind?: string; success?: boolean; code?: number; rowCount?: number; columns?: string[] };
    adapterCalls?: string[];
  };

  assert.equal(parsed.code, 0);
  assert.deepEqual(parsed.started, ["plan", "sql", "run_sql", "sql_gate", "sql", "run_sql", "sql_gate"]);
  assert.equal(parsed.sqlPromptCount, 2);
  assert.match(parsed.secondPrompt ?? "", /上一轮门禁未通过/);
  assert.match(parsed.secondPrompt ?? "", /missing_table/);
  assert.equal(parsed.gates?.length, 2);
  assert.equal(parsed.gates?.[0]?.verdict, "blocked");
  assert.equal(parsed.gates?.[1]?.verdict, "pass");
  assert.equal(parsed.runSql?.kind, "sql_tool");
  assert.equal(parsed.runSql?.success, true);
  assert.equal(parsed.runSql?.code, 0);
  assert.equal(parsed.runSql?.rowCount, 2);
  assert.deepEqual(parsed.runSql?.columns, ["customer_id", "gmv"]);
  assert.deepEqual(parsed.adapterCalls, ["sql-e2e-plan", "sql-e2e-sql", "sql-e2e-sql"]);
});

test("T-E5 deterministic loop: blocked tool result retries and second iteration passes", async () => {
  const runDir = makeRunDir();
  const inputPath = join(runDir, "input.txt");
  writeFileSync(inputPath, "source", "utf8");
  const started: string[] = [];
  const gateVerdicts: GateVerdict[] = [];
  const gatePrompts: string[] = [];
  let toolRuns = 0;
  let gateRuns = 0;
  const adapter = makeFakePiAdapter(
    {
      quality_gate: {
        build: (opts) => {
          gatePrompts.push(opts.text);
          gateRuns += 1;
          return {
            text: gateRuns === 1
              ? verdictText({
                stage: "quality_gate",
                verdict: "blocked",
                blockers: 1,
                redLines: [{ id: "RL-TOOL", desc: "tool result failed" }],
                summary: "blocked",
              })
              : verdictText({ stage: "quality_gate", verdict: "pass", summary: "passed" }),
          };
        },
      },
      downstream: { text: "done" },
    },
    "test-run",
  );
  const workflow: WorkflowDef = {
    nodes: [
      {
        id: "extract",
        label: "Extract",
        prompt: "Run extraction {{quality_gate__feedback}}",
        kind: "tool",
        toolId: "fake-tool",
        inputPath,
      },
      {
        id: "quality_gate",
        label: "Quality Gate",
        prompt: "Review {{extract}}",
        kind: "gate",
        onBlock: { retryFromNodeId: "extract", maxIterations: 3 },
      },
      { id: "downstream", label: "Downstream", prompt: "Continue after {{quality_gate}}" },
    ],
    edges: [
      { id: "extract-gate", source: "extract", target: "quality_gate" },
      { id: "gate-downstream", source: "quality_gate", target: "downstream" },
    ],
  };

  const result = await runMultiAgent(workflow, {
    ...makeBaseOptions(runDir, adapter.runTurn),
    getTool: () => fakeExtractionTool(),
    runTool: async (opts) => {
      toolRuns += 1;
      mkdirSync(opts.outputPath, { recursive: true });
      writeFileSync(opts.summaryPath, JSON.stringify({ success: 1, failed: 0, toolRuns }), "utf8");
      return { code: 0, stdout: `tool run ${toolRuns}`, stderr: "" };
    },
    onStepStart: (nodeId) => started.push(nodeId),
    onStepGate: (_nodeId, verdict) => gateVerdicts.push(verdict),
  });

  assert.equal(result.code, 0);
  assert.deepEqual(started, ["extract", "quality_gate", "extract", "quality_gate", "downstream"]);
  assert.equal(toolRuns, 2);
  assert.equal(gateVerdicts.length, 2);
  assert.equal(gateVerdicts[0]?.verdict, "blocked");
  assert.equal(gateVerdicts[1]?.verdict, "pass");
  assert.match(gatePrompts[1] ?? "", /tool run 2/);
  assert.equal(result.blackboard.downstream, "done");
});

test("T-E5 deterministic loop: maxIterations exhaustion interrupts downstream after tool retries", async () => {
  const runDir = makeRunDir();
  const inputPath = join(runDir, "input.txt");
  writeFileSync(inputPath, "source", "utf8");
  const started: string[] = [];
  const gates: GateVerdict[] = [];
  let toolRuns = 0;
  const adapter = makeFakePiAdapter(
    {
      quality_gate: {
        text: verdictText({
          stage: "quality_gate",
          verdict: "blocked",
          blockers: 1,
          redLines: [{ id: "RL-TOOL", desc: "still failing" }],
          summary: "blocked",
        }),
      },
      downstream: { text: "should not run" },
    },
    "test-run",
  );
  const workflow: WorkflowDef = {
    nodes: [
      { id: "extract", label: "Extract", prompt: "Run extraction", kind: "tool", toolId: "fake-tool", inputPath },
      {
        id: "quality_gate",
        label: "Quality Gate",
        prompt: "Review {{extract}}",
        kind: "gate",
        onBlock: { retryFromNodeId: "extract", maxIterations: 2 },
      },
      { id: "downstream", label: "Downstream", prompt: "Continue" },
    ],
    edges: [
      { id: "extract-gate", source: "extract", target: "quality_gate" },
      { id: "gate-downstream", source: "quality_gate", target: "downstream" },
    ],
  };

  const result = await runMultiAgent(workflow, {
    ...makeBaseOptions(runDir, adapter.runTurn),
    getTool: () => fakeExtractionTool(),
    runTool: async (opts) => {
      toolRuns += 1;
      mkdirSync(opts.outputPath, { recursive: true });
      writeFileSync(opts.summaryPath, JSON.stringify({ success: 1, failed: 0, toolRuns }), "utf8");
      return { code: 0, stdout: `tool run ${toolRuns}`, stderr: "" };
    },
    onStepStart: (nodeId) => started.push(nodeId),
    onStepGate: (_nodeId, verdict) => gates.push(verdict),
  });

  assert.equal(result.code, 1);
  assert.deepEqual(started, ["extract", "quality_gate", "extract", "quality_gate"]);
  assert.equal(toolRuns, 2);
  assert.equal(adapter.calls.some((call) => call.piSessionId === "test-run-downstream"), false);
  assert.equal(gates.length, 2);
  assert.ok(gates[1]?.reasons.some((reason) => reason.includes("重试轮次已耗尽")));
});

test("T-E5 deterministic loop: deterministic red line hard-stops without retrying", async () => {
  const runDir = makeRunDir();
  const started: string[] = [];
  const gates: GateVerdict[] = [];
  let dataRuns = 0;
  const adapter = makeFakePiAdapter(
    {
      data_gate: { text: verdictText({ stage: "data_gate", verdict: "pass", summary: "model says pass" }) },
      downstream: { text: "should not run" },
    },
    "test-run",
  );
  const workflow: WorkflowDef = {
    nodes: [
      { id: "data", label: "Data", prompt: "Assess data", kind: "tool", toolId: "fake-tool", inputPath: "{{input.source_path}}" },
      {
        id: "data_gate",
        label: "Data Gate",
        prompt: "Review {{data}}",
        kind: "gate",
        onBlock: { retryFromNodeId: "data", maxIterations: 3 },
      },
      { id: "downstream", label: "Downstream", prompt: "Continue" },
    ],
    edges: [
      { id: "data-gate", source: "data", target: "data_gate" },
      { id: "gate-downstream", source: "data_gate", target: "downstream" },
    ],
  };
  const inputPath = join(runDir, "source.txt");
  writeFileSync(inputPath, "source", "utf8");

  const result = await runMultiAgent(workflow, {
    ...makeBaseOptions(runDir, adapter.runTurn),
    inputs: { source_path: inputPath },
    getTool: () => fakeExtractionTool(),
    runTool: async (opts) => {
      dataRuns += 1;
      mkdirSync(opts.outputPath, { recursive: true });
      writeFileSync(opts.summaryPath, JSON.stringify({ success: 1, failed: 0, note: "综合评分: 4.2/10" }), "utf8");
      return { code: 0, stdout: "数据质量报告\n综合评分: 4.2/10", stderr: "" };
    },
    onStepStart: (nodeId) => started.push(nodeId),
    onStepGate: (_nodeId, verdict) => gates.push(verdict),
  });

  assert.equal(result.code, 1);
  assert.deepEqual(started, ["data", "data_gate"]);
  assert.equal(dataRuns, 1);
  assert.equal(adapter.calls.some((call) => call.piSessionId === "test-run-downstream"), false);
  assert.equal(gates.length, 1);
  assert.ok(gates[0]?.reasons.some((reason) => reason.includes("RL03")));
  assert.equal(result.blackboard.data_gate__feedback, undefined);
});

// ---- fan-out (P1a: insight parallel hypotheses) ----

function planText(items: unknown): string {
  return ["规范", "```anax-hypotheses-plan", JSON.stringify(items), "```"].join("\n");
}

test("extractMarkerArray parses a fenced JSON array and ignores non-arrays/garbage", () => {
  assert.deepEqual(extractMarkerArray(planText([{ id: "H1" }]), "anax-hypotheses-plan"), [{ id: "H1" }]);
  assert.deepEqual(extractMarkerArray("```anax-hypotheses-plan[{\"id\":\"H2\"}]\n```", "anax-hypotheses-plan"), [{ id: "H2" }]);
  assert.deepEqual(
    extractMarkerArray("```anax-hypotheses-plan\nnot json\n```\n```anax-hypotheses-plan[{\"id\":\"H3\"}]\n```", "anax-hypotheses-plan"),
    [{ id: "H3" }],
  );
  assert.equal(extractMarkerArray("no block here", "anax-hypotheses-plan"), null);
  assert.equal(extractMarkerArray("```anax-hypotheses-plan\n{\"id\":1}\n```", "anax-hypotheses-plan"), null);
  assert.equal(extractMarkerArray("```anax-hypotheses-plan\nnot json\n```", "anax-hypotheses-plan"), null);
});

test("validateWorkflow rejects fanOut.source referencing a missing node", () => {
  assert.throws(
    () => validateWorkflow({
      nodes: [{ id: "only", label: "Only", prompt: "Run", fanOut: { source: "ghost", marker: "m" } }],
      edges: [],
    }),
    /fanOut.source references missing node: ghost/,
  );
});

test("runMultiAgent fans out a node into one concurrent turn per item", async () => {
  const hyps = [
    { id: "H1", hypothesis: "短信过度触达推高取关" },
    { id: "H2", hypothesis: "新客券核销率偏低" },
    { id: "H3", hypothesis: "客单价随活动周期波动" },
  ];
  const seenPrompts: string[] = [];
  const child = (label: string): { build: (o: { text: string }) => { text: string } } => ({
    build: (o) => {
      seenPrompts.push(o.text);
      return { text: `${label} done` };
    },
  });
  const adapter = makeFakePiAdapter(
    {
      plan: { text: planText(hyps) },
      "insight-1": child("I1"),
      "insight-2": child("I2"),
      "insight-3": child("I3"),
    },
    "test-run",
  );
  const workflow: WorkflowDef = {
    nodes: [
      { id: "plan", label: "Plan", prompt: "Make plan" },
      {
        id: "insight",
        label: "Insight",
        prompt: "Verify {{item.hypothesis}} ({{item.id}})",
        fanOut: { source: "plan", marker: "anax-hypotheses-plan", concurrency: 2 },
      },
    ],
    edges: [{ id: "p-i", source: "plan", target: "insight" }],
  };

  const result = await runMultiAgent(workflow, makeBaseOptions(makeRunDir(), adapter.runTurn));

  assert.equal(result.code, 0);
  assert.equal(adapter.calls.length, 4); // 1 plan + 3 insight children
  const childIds = adapter.calls
    .map((c) => c.piSessionId)
    .filter((id) => id.startsWith("test-run-insight-"))
    .sort();
  assert.deepEqual(childIds, ["test-run-insight-1", "test-run-insight-2", "test-run-insight-3"]);
  // each item's fields are injected into its child prompt
  assert.ok(seenPrompts.some((p) => p.includes("短信过度触达推高取关") && p.includes("(H1)")));
  assert.ok(seenPrompts.some((p) => p.includes("新客券核销率偏低") && p.includes("(H2)")));
  // merged output preserves item order
  assert.match(
    result.blackboard.insight ?? "",
    /## 假设 1[\s\S]*I1 done[\s\S]*## 假设 2[\s\S]*I2 done[\s\S]*## 假设 3[\s\S]*I3 done/,
  );
});

test("runMultiAgent degrades a fan-out node to a single turn when no item array is present", async () => {
  const adapter = makeFakePiAdapter(
    {
      plan: { text: "no structured block here" },
      insight: { text: "single insight output" },
    },
    "test-run",
  );
  const workflow: WorkflowDef = {
    nodes: [
      { id: "plan", label: "Plan", prompt: "Make plan" },
      {
        id: "insight",
        label: "Insight",
        prompt: "Verify hypotheses",
        fanOut: { source: "plan", marker: "anax-hypotheses-plan" },
      },
    ],
    edges: [{ id: "p-i", source: "plan", target: "insight" }],
  };

  const result = await runMultiAgent(workflow, makeBaseOptions(makeRunDir(), adapter.runTurn));

  assert.equal(result.code, 0);
  assert.equal(adapter.calls.length, 2); // plan + single insight, no children
  assert.equal(adapter.calls[1]?.piSessionId, "test-run-insight");
  assert.equal(result.blackboard.insight, "single insight output");
});

test("runMultiAgent fails a fan-out node (and halts downstream) when any child exits non-zero", async () => {
  const hyps = [{ id: "H1", hypothesis: "a" }, { id: "H2", hypothesis: "b" }];
  const started: string[] = [];
  const adapter = makeFakePiAdapter(
    {
      plan: { text: planText(hyps) },
      "insight-1": { text: "ok" },
      "insight-2": { text: "boom", exitCode: 1 },
      downstream: { text: "should not run" },
    },
    "test-run",
  );
  const workflow: WorkflowDef = {
    nodes: [
      { id: "plan", label: "Plan", prompt: "Make plan" },
      {
        id: "insight",
        label: "Insight",
        prompt: "Verify {{item.hypothesis}}",
        fanOut: { source: "plan", marker: "anax-hypotheses-plan", concurrency: 2 },
      },
      { id: "downstream", label: "Down", prompt: "After {{insight}}" },
    ],
    edges: [
      { id: "p-i", source: "plan", target: "insight" },
      { id: "i-d", source: "insight", target: "downstream" },
    ],
  };

  const result = await runMultiAgent(workflow, {
    ...makeBaseOptions(makeRunDir(), adapter.runTurn),
    onStepStart: (nodeId) => {
      started.push(nodeId);
    },
  });

  assert.equal(result.code, 1);
  assert.deepEqual(started, ["plan", "insight"]); // downstream never started
  assert.equal(adapter.calls.some((c) => c.piSessionId === "test-run-downstream"), false);
});

test("runMultiAgent stops launching fan-out children once aborted", async () => {
  const hyps = [
    { id: "H1", hypothesis: "a" },
    { id: "H2", hypothesis: "b" },
    { id: "H3", hypothesis: "c" },
    { id: "H4", hypothesis: "d" },
  ];
  let aborted = false;
  const trip = (): { build: () => { text: string } } => ({
    build: () => {
      aborted = true;
      return { text: "x" };
    },
  });
  const adapter = makeFakePiAdapter(
    {
      plan: { text: planText(hyps) },
      "insight-1": trip(),
      "insight-2": trip(),
      "insight-3": { text: "should not run" },
      "insight-4": { text: "should not run" },
    },
    "test-run",
  );
  const workflow: WorkflowDef = {
    nodes: [
      { id: "plan", label: "Plan", prompt: "Make plan" },
      {
        id: "insight",
        label: "Insight",
        prompt: "Verify {{item.hypothesis}}",
        fanOut: { source: "plan", marker: "anax-hypotheses-plan", concurrency: 2 },
      },
    ],
    edges: [{ id: "p-i", source: "plan", target: "insight" }],
  };

  await runMultiAgent(workflow, {
    ...makeBaseOptions(makeRunDir(), adapter.runTurn),
    isAborted: () => aborted,
  });

  const childCalls = adapter.calls.filter((c) => c.piSessionId.startsWith("test-run-insight-"));
  assert.ok(childCalls.length < hyps.length, `expected fewer than ${hyps.length} children, got ${childCalls.length}`);
  assert.equal(adapter.calls.some((c) => c.piSessionId === "test-run-insight-4"), false);
});
