import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";
import test from "node:test";
import { makeFakePiAdapter } from "./multi-agent-runner.test-helpers.ts";
import { extractMarkerArray, readWorkflow, runMultiAgent, validateWorkflow, type WorkflowDef } from "./multi-agent-runner.ts";
import type { GateVerdict } from "./anax-gate.ts";
import type { PiEvent } from "./types.ts";
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

// ---- fan-out (P1a: insight parallel hypotheses) ----

function planText(items: unknown): string {
  return ["规范", "```anax-hypotheses-plan", JSON.stringify(items), "```"].join("\n");
}

test("extractMarkerArray parses a fenced JSON array and ignores non-arrays/garbage", () => {
  assert.deepEqual(extractMarkerArray(planText([{ id: "H1" }]), "anax-hypotheses-plan"), [{ id: "H1" }]);
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
