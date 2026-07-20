import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import {
  createPiEngineHandler,
  FakeExecutionRunner,
  FakeGenerationRunner,
  PiTurnExecutionRunner,
  PiTurnGenerationRunner,
} from "../adapters/pi-engine/index.ts";
import {
  validateEnginePortRequest,
  validateEnginePortResult,
  type EnginePortRequest,
} from "../contracts/engine-port.ts";
import { ENGINE_PORT_OPERATIONS } from "../contracts/registries.ts";
import type { RunPiOptions } from "../../pi-adapter.ts";

const TS = "2026-07-18T00:00:00.000Z";
const PRODUCER = { name: "pi-xanthil-pi-engine-adapter", version: "1.0.0", mode: "pi-agent" };

const BACKEND_OWNED_OPERATIONS = ENGINE_PORT_OPERATIONS.filter(
  (op) => op !== "generateStructuredRequirement" && op !== "generateAnalysisPlan" && op !== "executeQueuedRun",
);

function generationRequest(operation: "generateStructuredRequirement" | "generateAnalysisPlan"): EnginePortRequest {
  const common = {
    version: "engine-port/1.0" as const,
    operationId: randomUUID(),
    projectId: randomUUID(),
    generationId: randomUUID(),
    caller: "backend",
    requestedAt: TS,
    deadlineAt: "2026-07-18T00:00:30.000Z",
    inputHash: "e".repeat(64),
    abortSignal: null,
  };
  if (operation === "generateStructuredRequirement") return { ...common, operation, input: { targetSchemaVersion: "1.0" } };
  return { ...common, operation, input: { requirementVersionId: randomUUID(), targetSchemaVersion: "1.0" } };
}

function executeRequest(): EnginePortRequest {
  const runId = randomUUID();
  return {
    version: "engine-port/1.0",
    operation: "executeQueuedRun",
    operationId: randomUUID(),
    projectId: randomUUID(),
    runId,
    caller: "backend",
    requestedAt: TS,
    deadlineAt: "2026-07-18T00:00:30.000Z",
    inputHash: "f".repeat(64),
    abortSignal: null,
    input: { runId, planVersionId: randomUUID(), expectedPreviousSequence: 0 },
  };
}

function backendOwnedRequest(operation: (typeof BACKEND_OWNED_OPERATIONS)[number]): EnginePortRequest {
  const runId = randomUUID();
  const base = {
    version: "engine-port/1.0" as const,
    operationId: randomUUID(),
    projectId: randomUUID(),
    runId,
    caller: "backend",
    requestedAt: TS,
    deadlineAt: "2026-07-18T00:00:30.000Z",
    inputHash: "0".repeat(64),
    abortSignal: null,
  };
  switch (operation) {
    case "requestRunAbort":
      return { ...base, operation, input: { runId, expectedStatus: "running", expectedLastSequence: 0 } };
    case "inspectRunningRunRecovery":
      return { ...base, operation, input: { runId } };
    case "getRunExecutionContext":
      return { ...base, operation, input: { runId } };
    case "openRunInputEvidence":
      return { ...base, operation, input: { runId, evidenceArtifactId: randomUUID(), planStepId: "step-1", expectedContentSha256: "a".repeat(64) } };
    case "appendRunEvent":
      return { ...base, operation, input: { runId, producerEventId: null, expectedPreviousSequence: 0, eventType: "run_started", payloadSchemaVersion: "workcanger.run-event.run_started/1.0", payload: {} } };
    case "registerRunEvidence":
      return { ...base, operation, input: { runId, planStepId: "step-1" } };
    case "submitInternalReviewEvidence":
      return { ...base, operation, input: { runId, planStepId: "step-1", reviewOrdinal: 1 } };
    case "completeRunWithReport":
      return { ...base, operation, input: { runId, reportSchemaVersion: "1.0" } };
    case "terminateRun":
      return { ...base, operation, input: { runId, terminalOutcome: "failed" } };
  }
}

function assertPromptSafe(prompt: string): void {
  assert.ok(!prompt.includes("restricted_raw"), prompt);
  assert.ok(!prompt.includes("draw_data"), prompt);
  assert.ok(!prompt.includes("/Users/"), prompt);
  assert.ok(!prompt.includes(".pi-sessions"), prompt);
  assert.ok(!/\b(?:SELECT|INSERT|UPDATE|DELETE|PRAGMA)\b/.test(prompt), prompt);
  assert.ok(!/[A-Za-z0-9_-]{40,}/.test(prompt.replace(/[0-9a-f]{64}/g, "").replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, "")), prompt);
}

function validGenerationOutput(req: EnginePortRequest): unknown {
  if (req.operation === "generateStructuredRequirement") {
    return {
      candidateType: "structured_requirement_candidate",
      schemaVersion: "1.0",
      generationId: req.generationId,
      producer: PRODUCER,
      warnings: [],
      candidate: {
        businessQuestion: "Which synthetic daily signal should be analyzed?",
        scope: { inScope: ["synthetic daily analysis"], outOfScope: ["automated action"] },
        acceptanceCriteria: ["Human can confirm completeness."],
        sourceReferenceIds: [],
        inputEvidenceArtifactIds: [],
      },
    };
  }
  if (req.operation === "generateAnalysisPlan" && req.input.requirementVersionId) {
    return {
      candidateType: "analysis_plan_candidate",
      schemaVersion: "1.0",
      generationId: req.generationId,
      requirementVersionId: req.input.requirementVersionId,
      producer: PRODUCER,
      warnings: [],
      candidate: {
        analysisObjective: "Produce a synthetic daily analysis plan.",
        successCriteria: ["Plan can be reviewed before any run is queued."],
        steps: [
          { planStepId: "context-loading", sequence: 1, analysisStage: "S2.1", purpose: "Load approved context." },
          { planStepId: "data-profiling", sequence: 2, analysisStage: "S2.2", purpose: "Profile admitted evidence." },
          { planStepId: "analysis-execution", sequence: 3, analysisStage: "S2.3", purpose: "Execute the approved method." },
          { planStepId: "internal-review", sequence: 4, analysisStage: "S2.4", purpose: "Review outputs." },
        ],
      },
    };
  }
  throw new Error("unexpected request");
}

function assistantEvent(text: string) {
  return { type: "message_end", message: { role: "assistant", content: [{ type: "text", text }], timestamp: 0 } };
}

describe("pi engine combined handler", () => {
  test("dispatches all three application operations to their runners", async () => {
    const generationRunner = new FakeGenerationRunner();
    const executionRunner = new FakeExecutionRunner();
    const handler = createPiEngineHandler({ generationRunner, executionRunner, now: () => new Date(TS) });

    const requirement = await handler(generationRequest("generateStructuredRequirement"));
    const plan = await handler(generationRequest("generateAnalysisPlan"));
    const execution = await handler(executeRequest());

    assert.equal(requirement.outcome, "succeeded");
    assert.equal(plan.outcome, "succeeded");
    assert.equal(execution.outcome, "succeeded");
    assert.equal(generationRunner.requests.length, 2);
    assert.equal(executionRunner.requests.length, 1);
    validateEnginePortResult(requirement);
    validateEnginePortResult(plan);
    validateEnginePortResult(execution);
  });

  test("nine backend-owned operations fail closed and never reach a runner", async () => {
    assert.equal(BACKEND_OWNED_OPERATIONS.length, 9);
    const generationRunner = new FakeGenerationRunner();
    const executionRunner = new FakeExecutionRunner();
    const handler = createPiEngineHandler({ generationRunner, executionRunner, now: () => new Date(TS) });

    for (const operation of BACKEND_OWNED_OPERATIONS) {
      const req = backendOwnedRequest(operation);
      validateEnginePortRequest(req);
      const result = await handler(req);
      validateEnginePortResult(result);
      assert.equal(result.outcome, "failed", operation);
      assert.equal(result.error?.code, "invalid_request", operation);
      assert.equal(result.runId, req.runId, operation);
    }
    assert.equal(generationRunner.requests.length, 0);
    assert.equal(executionRunner.requests.length, 0);
  });

  test("unknown version, operation, or malformed envelope fails closed before dispatch", async () => {
    const generationRunner = new FakeGenerationRunner();
    const executionRunner = new FakeExecutionRunner();
    const handler = createPiEngineHandler({ generationRunner, executionRunner, now: () => new Date(TS) });

    await assert.rejects(() => handler({ ...generationRequest("generateStructuredRequirement"), version: "engine-port/9.9" } as unknown as EnginePortRequest), /Unsupported engine-port version/);
    await assert.rejects(() => handler({ ...generationRequest("generateStructuredRequirement"), operation: "nukeEverything" } as unknown as EnginePortRequest), /Unknown engine port operation/);
    await assert.rejects(() => handler({ ...generationRequest("generateStructuredRequirement"), extra: true } as unknown as EnginePortRequest), /unknown request envelope field/);
    assert.equal(generationRunner.requests.length, 0);
    assert.equal(executionRunner.requests.length, 0);
  });
});

describe("pi turn generation runner (injected turn starter)", () => {
  test("maps assistant JSON to a succeeded result and strips markdown fences", async () => {
    const workDir = await mkdtemp(join(tmpdir(), "pi-engine-turn-test-"));
    try {
      const captured: RunPiOptions[] = [];
      const req = generationRequest("generateStructuredRequirement");
      const runner = new PiTurnGenerationRunner({
        workDir,
        startTurn: (opts) => {
          captured.push(opts);
          opts.onEvent(assistantEvent(`\`\`\`json\n${JSON.stringify(validGenerationOutput(req))}\n\`\`\``) as never);
          return { done: Promise.resolve(0), kill: () => undefined, isRunning: () => false };
        },
      });
      const handler = createPiEngineHandler({ generationRunner: runner, executionRunner: new FakeExecutionRunner(), now: () => new Date(TS) });
      const result = await handler(req);
      validateEnginePortResult(result);
      assert.equal(result.outcome, "succeeded");
      assert.equal((result.output as { candidateType: string }).candidateType, "structured_requirement_candidate");

      assert.equal(captured.length, 1);
      const opts = captured[0]!;
      assert.equal(opts.cwdOverride, workDir);
      assert.equal(opts.workspaceRoot, workDir);
      assert.ok(opts.piSessionId.startsWith("engine-gen-"));
      assert.deepEqual(opts.skillPaths, []);
      assertPromptSafe(opts.text);
      assert.ok(opts.text.includes("structured_requirement_candidate"));
      assertPromptSafe(opts.systemPrompt ?? "");
    } finally {
      await rm(workDir, { recursive: true, force: true });
    }
  });

  test("spawn error (null exit) maps to pi_spawn_failed and nonzero exit to pi_execution_failed", async () => {
    const workDir = await mkdtemp(join(tmpdir(), "pi-engine-turn-test-"));
    try {
      const spawnFailRunner = new PiTurnGenerationRunner({
        workDir,
        startTurn: () => ({ done: Promise.resolve(null), kill: () => undefined, isRunning: () => false }),
      });
      const handler1 = createPiEngineHandler({ generationRunner: spawnFailRunner, executionRunner: new FakeExecutionRunner(), now: () => new Date(TS) });
      const spawnFailed = await handler1(generationRequest("generateStructuredRequirement"));
      assert.equal(spawnFailed.outcome, "failed");
      assert.equal(spawnFailed.error?.code, "pi_spawn_failed");
      assert.ok(!JSON.stringify(spawnFailed).includes("stderr"));

      const exitFailRunner = new PiTurnGenerationRunner({
        workDir,
        startTurn: () => ({ done: Promise.resolve(3), kill: () => undefined, isRunning: () => false }),
      });
      const handler2 = createPiEngineHandler({ generationRunner: exitFailRunner, executionRunner: new FakeExecutionRunner(), now: () => new Date(TS) });
      const execFailed = await handler2(generationRequest("generateStructuredRequirement"));
      assert.equal(execFailed.outcome, "failed");
      assert.equal(execFailed.error?.code, "pi_execution_failed");

      const emptyRunner = new PiTurnGenerationRunner({
        workDir,
        startTurn: () => ({ done: Promise.resolve(0), kill: () => undefined, isRunning: () => false }),
      });
      const handler3 = createPiEngineHandler({ generationRunner: emptyRunner, executionRunner: new FakeExecutionRunner(), now: () => new Date(TS) });
      const empty = await handler3(generationRequest("generateStructuredRequirement"));
      assert.equal(empty.outcome, "failed");
      assert.equal(empty.error?.code, "pi_execution_failed");
      assert.ok(!JSON.stringify(empty).includes("output_schema_invalid"));
    } finally {
      await rm(workDir, { recursive: true, force: true });
    }
  });

  test("exit 0 with retry-exhausted empty assistant output maps to pi_execution_failed without leak", async () => {
    const workDir = await mkdtemp(join(tmpdir(), "pi-engine-turn-test-"));
    try {
      const retryEvents = [
        { type: "auto_retry_start", attempt: 1 },
        { type: "auto_retry_end", attempt: 1 },
        { type: "auto_retry_start", attempt: 2 },
        { type: "auto_retry_end", attempt: 2 },
      ];
      const generationRunner = new PiTurnGenerationRunner({
        workDir,
        startTurn: (opts) => {
          for (const event of retryEvents) opts.onEvent(event as never);
          return { done: Promise.resolve(0), kill: () => undefined, isRunning: () => false };
        },
      });
      const genHandler = createPiEngineHandler({ generationRunner, executionRunner: new FakeExecutionRunner(), now: () => new Date(TS) });
      const gen = await genHandler(generationRequest("generateStructuredRequirement"));
      validateEnginePortResult(gen);
      assert.equal(gen.outcome, "failed");
      assert.equal(gen.error?.code, "pi_execution_failed");
      assert.ok(!JSON.stringify(gen).includes("output_schema_invalid"));
      assert.ok(!JSON.stringify(gen).includes("auto_retry"));

      const executionRunner = new PiTurnExecutionRunner({
        workDir,
        startTurn: (opts) => {
          for (const event of retryEvents) opts.onEvent(event as never);
          return { done: Promise.resolve(0), kill: () => undefined, isRunning: () => false };
        },
      });
      const execHandler = createPiEngineHandler({ generationRunner: new FakeGenerationRunner(), executionRunner, now: () => new Date(TS) });
      const exec = await execHandler(executeRequest());
      validateEnginePortResult(exec);
      assert.equal(exec.outcome, "failed");
      assert.equal(exec.error?.code, "pi_execution_failed");
      assert.ok(!JSON.stringify(exec).includes("output_schema_invalid"));
      assert.ok(!JSON.stringify(exec).includes("auto_retry"));
    } finally {
      await rm(workDir, { recursive: true, force: true });
    }
  });

  test("model metadata callback receives only whitelisted scalars", async () => {
    const workDir = await mkdtemp(join(tmpdir(), "pi-engine-turn-test-"));
    try {
      const received: Array<Record<string, unknown>> = [];
      const req = generationRequest("generateStructuredRequirement");
      const runner = new PiTurnGenerationRunner({
        workDir,
        onModelMetadata: (metadata) => received.push(metadata as Record<string, unknown>),
        startTurn: (opts) => {
          opts.onEvent({
            type: "message_end",
            message: {
              role: "assistant",
              content: [{ type: "text", text: JSON.stringify(validGenerationOutput(req)) }],
              timestamp: 0,
              provider: "test-provider",
              model: "test-model",
              api: "test-api",
              usage: { input: 1234, output: 567, cacheRead: 0, cacheWrite: 0, totalTokens: 1801, cost: { total: 0.5 } },
              stopReason: "end_turn",
              errorMessage: "secret /Users/example/.pi-sessions token_abcdefghijklmnopqrstuvwxyz0123456789",
              rawPiEvent: { prompt: "leaked" },
            },
          } as never);
          return { done: Promise.resolve(0), kill: () => undefined, isRunning: () => false };
        },
      });
      const handler = createPiEngineHandler({ generationRunner: runner, executionRunner: new FakeExecutionRunner(), now: () => new Date(TS) });
      const result = await handler(req);
      assert.equal(result.outcome, "succeeded");
      assert.equal(received.length, 1);
      const metadata = received[0]!;
      assert.deepEqual(Object.keys(metadata).sort(), ["api", "model", "provider"]);
      assert.deepEqual(metadata, { provider: "test-provider", model: "test-model", api: "test-api" });
      const text = JSON.stringify(metadata);
      assert.ok(!text.includes("usage"), text);
      assert.ok(!text.includes("errorMessage"), text);
      assert.ok(!text.includes("/Users/"), text);
      assert.ok(!/[A-Za-z0-9_-]{40,}/.test(text), text);
    } finally {
      await rm(workDir, { recursive: true, force: true });
    }
  });

  test("mid-flight abort kills the underlying pi turn and settles after close", async () => {
    const workDir = await mkdtemp(join(tmpdir(), "pi-engine-turn-test-"));
    try {
      let killCount = 0;
      let resolveDone!: (code: number | null) => void;
      const turnDone = new Promise<number | null>((resolve) => { resolveDone = resolve; });
      const runner = new PiTurnGenerationRunner({
        workDir,
        startTurn: () => ({
          done: turnDone,
          kill: () => { killCount += 1; },
          isRunning: () => true,
        }),
      });
      const handler = createPiEngineHandler({ generationRunner: runner, executionRunner: new FakeExecutionRunner(), now: () => new Date(TS), defaultTimeoutMs: 10_000 });
      const controller = new AbortController();
      const pending = handler({ ...generationRequest("generateStructuredRequirement"), abortSignal: controller.signal });
      controller.abort();
      let settled = false;
      void pending.then(() => { settled = true; });
      await new Promise((resolve) => setTimeout(resolve, 30));
      assert.equal(killCount, 1);
      assert.equal(settled, false, "handler must wait for the pi process close after kill");
      resolveDone(null); // pi process close observed
      const result = await pending;
      validateEnginePortResult(result);
      assert.equal(result.outcome, "aborted");
    } finally {
      await rm(workDir, { recursive: true, force: true });
    }
  });
});

describe("pi turn execution runner (injected turn starter)", () => {
  test("builds a safe execution prompt and maps nonzero exit to pi_execution_failed", async () => {
    const workDir = await mkdtemp(join(tmpdir(), "pi-engine-turn-test-"));
    try {
      const captured: RunPiOptions[] = [];
      const runner = new PiTurnExecutionRunner({
        workDir,
        startTurn: (opts) => {
          captured.push(opts);
          return { done: Promise.resolve(1), kill: () => undefined, isRunning: () => false };
        },
      });
      const handler = createPiEngineHandler({ generationRunner: new FakeGenerationRunner(), executionRunner: runner, now: () => new Date(TS) });
      const result = await handler(executeRequest());
      validateEnginePortResult(result);
      assert.equal(result.outcome, "failed");
      assert.equal(result.error?.code, "pi_execution_failed");

      assert.equal(captured.length, 1);
      const opts = captured[0]!;
      assert.ok(opts.piSessionId.startsWith("engine-run-"));
      assert.deepEqual(opts.skillPaths, []);
      assertPromptSafe(opts.text);
      assert.ok(opts.text.includes("run_execution_candidate"));
    } finally {
      await rm(workDir, { recursive: true, force: true });
    }
  });

  test("mid-flight timeout kills the underlying pi turn and settles after close", async () => {
    const workDir = await mkdtemp(join(tmpdir(), "pi-engine-turn-test-"));
    try {
      let killCount = 0;
      let resolveDone!: (code: number | null) => void;
      const turnDone = new Promise<number | null>((resolve) => { resolveDone = resolve; });
      const runner = new PiTurnExecutionRunner({
        workDir,
        startTurn: () => ({
          done: turnDone,
          kill: () => { killCount += 1; },
          isRunning: () => true,
        }),
      });
      const handler = createPiEngineHandler({ generationRunner: new FakeGenerationRunner(), executionRunner: runner, now: () => new Date(TS), defaultTimeoutMs: 1 });
      const pending = handler({ ...executeRequest(), deadlineAt: null });
      let settled = false;
      void pending.then(() => { settled = true; });
      await new Promise((resolve) => setTimeout(resolve, 30));
      assert.equal(killCount, 1);
      assert.equal(settled, false, "handler must wait for the pi process close after kill");
      resolveDone(null); // pi process close observed
      const result = await pending;
      validateEnginePortResult(result);
      assert.equal(result.outcome, "timed_out");
      assert.equal(result.error?.code, "deadline_exceeded");
    } finally {
      await rm(workDir, { recursive: true, force: true });
    }
  });
});
