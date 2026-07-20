import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  createAnalysisEngineGenerationHandler,
  FakeGenerationRunner,
  type PiGenerationRunner,
} from "../adapters/pi-engine/index.ts";
import {
  validateEnginePortRequest,
  validateEnginePortResult,
  type EnginePortRequest,
} from "../contracts/engine-port.ts";

const TS = "2026-07-17T00:00:00.000Z";

function generationRequest(operation: "generateStructuredRequirement" | "generateAnalysisPlan"): EnginePortRequest {
  const common = {
    version: "engine-port/1.0" as const,
    operationId: randomUUID(),
    projectId: randomUUID(),
    generationId: randomUUID(),
    caller: "backend",
    requestedAt: TS,
    deadlineAt: "2026-07-17T00:00:30.000Z",
    inputHash: "a".repeat(64),
    abortSignal: null,
  };
  if (operation === "generateStructuredRequirement") {
    return { ...common, operation, input: { targetSchemaVersion: "1.0" } };
  }
  return { ...common, operation, input: { requirementVersionId: randomUUID(), targetSchemaVersion: "1.0" } };
}

function assertNoLeak(value: unknown): void {
  const text = JSON.stringify(value);
  assert.ok(!text.includes("prompt"), text);
  assert.ok(!text.includes("hiddenReasoning"), text);
  assert.ok(!text.includes("rawPiEvent"), text);
  assert.ok(!text.includes("/Users/"), text);
  assert.ok(!text.includes(".pi-sessions"), text);
  assert.ok(!/[A-Za-z0-9_-]{40,}/.test(text), text);
}

const FAKE_RUNTIME = { producerName: "pi-xanthil-fake-generation-runner", producerVersion: "0.0.0-test", mode: "fake" as const };

function stubGenerationRunner(stdoutJson: string): PiGenerationRunner {
  return {
    start: () => ({
      done: Promise.resolve({ outcome: "succeeded", stdoutJson, runtime: FAKE_RUNTIME }),
      cancel: () => undefined,
      isRunning: () => false,
    }),
  };
}

async function alignedHappyOutput(req: EnginePortRequest): Promise<string> {
  const runner = new FakeGenerationRunner();
  const input = req.input as { targetSchemaVersion: string; requirementVersionId?: string };
  const handle = runner.start({
    operation: req.operation as "generateStructuredRequirement" | "generateAnalysisPlan",
    generationId: req.generationId ?? "",
    targetSchemaVersion: input.targetSchemaVersion,
    requirementVersionId: input.requirementVersionId,
    inputHash: req.inputHash,
    instruction: "x",
  });
  const result = await handle.done;
  assert.equal(result.outcome, "succeeded");
  return (result as { stdoutJson: string }).stdoutJson;
}

function mutate(json: string, fn: (output: Record<string, unknown>) => void): string {
  const output = JSON.parse(json) as Record<string, unknown>;
  fn(output);
  return JSON.stringify(output);
}

describe("pi engine generation handler", () => {
  test("generateStructuredRequirement happy path validates request/result and output safety", async () => {
    const runner = new FakeGenerationRunner();
    const handler = createAnalysisEngineGenerationHandler({ runner, now: () => new Date(TS) });
    const req = generationRequest("generateStructuredRequirement");
    validateEnginePortRequest(req);
    const result = await handler(req);
    validateEnginePortResult(result);
    assert.equal(result.outcome, "succeeded");
    assert.equal(runner.requests.length, 1);
    assert.equal((result.output as { candidateType: string }).candidateType, "structured_requirement_candidate");
    assertNoLeak(result);
  });

  test("generateAnalysisPlan happy path binds requirementVersionId and targetSchemaVersion", async () => {
    const runner = new FakeGenerationRunner();
    const handler = createAnalysisEngineGenerationHandler({ runner, now: () => new Date(TS) });
    const req = generationRequest("generateAnalysisPlan");
    const result = await handler(req);
    validateEnginePortResult(result);
    assert.equal(result.outcome, "succeeded");
    const output = result.output as { requirementVersionId: string; schemaVersion: string; candidate: { steps: unknown[] } };
    const planInput = req.input as { requirementVersionId: string; targetSchemaVersion: string };
    assert.equal(output.requirementVersionId, planInput.requirementVersionId);
    assert.equal(output.schemaVersion, planInput.targetSchemaVersion);
    assert.equal(output.candidate.steps.length, 4);
    assertNoLeak(result);
  });

  test("invalid request fails closed before runner is called", async () => {
    const runner = new FakeGenerationRunner();
    const handler = createAnalysisEngineGenerationHandler({ runner, now: () => new Date(TS) });
    const req = { ...generationRequest("generateStructuredRequirement"), operation: "unknown" } as unknown as EnginePortRequest;
    await assert.rejects(() => handler(req), /Unknown engine port operation/);
    assert.equal(runner.requests.length, 0);
  });

  test("malformed or unsafe candidate maps to output_schema_invalid without raw output", async () => {
    for (const scenario of ["malformed_json", "invalid_candidate"] as const) {
      const runner = new FakeGenerationRunner({ scenario });
      const handler = createAnalysisEngineGenerationHandler({ runner, now: () => new Date(TS) });
      const result = await handler(generationRequest("generateStructuredRequirement"));
      validateEnginePortResult(result);
      assert.equal(result.outcome, "failed");
      assert.equal(result.error?.code, "output_schema_invalid");
      assertNoLeak(result);
    }
  });

  test("runner spawn and non-zero failure map to safe errors", async () => {
    for (const [scenario, code] of [["spawn_failed", "pi_spawn_failed"], ["execution_failed", "pi_execution_failed"]] as const) {
      const runner = new FakeGenerationRunner({ scenario });
      const handler = createAnalysisEngineGenerationHandler({ runner, now: () => new Date(TS) });
      const result = await handler(generationRequest("generateStructuredRequirement"));
      validateEnginePortResult(result);
      assert.equal(result.outcome, "failed");
      assert.equal(result.error?.code, code);
      assertNoLeak(result);
    }
  });

  test("runner start throw maps to pi_spawn_failed without leaking raw diagnostics", async () => {
    const runner: PiGenerationRunner = {
      start() {
        throw new Error("raw /Users/example/.pi-sessions secret_abcdefghijklmnopqrstuvwxyz0123456789");
      },
    };
    const handler = createAnalysisEngineGenerationHandler({ runner, now: () => new Date(TS) });
    const result = await handler(generationRequest("generateStructuredRequirement"));
    validateEnginePortResult(result);
    assert.equal(result.outcome, "failed");
    assert.equal(result.error?.code, "pi_spawn_failed");
    assertNoLeak(result);
  });

  test("runner done rejection maps to pi_execution_failed without leaking raw diagnostics", async () => {
    const runner: PiGenerationRunner = {
      start() {
        return {
          done: Promise.reject(new Error("stderr /Users/example/.pi-sessions token_abcdefghijklmnopqrstuvwxyz0123456789")),
          cancel: () => undefined,
          isRunning: () => false,
        };
      },
    };
    const handler = createAnalysisEngineGenerationHandler({ runner, now: () => new Date(TS) });
    const result = await handler(generationRequest("generateStructuredRequirement"));
    validateEnginePortResult(result);
    assert.equal(result.outcome, "failed");
    assert.equal(result.error?.code, "pi_execution_failed");
    assertNoLeak(result);
  });

  test("pre-aborted signal returns aborted before runner is called", async () => {
    const runner = new FakeGenerationRunner();
    const handler = createAnalysisEngineGenerationHandler({ runner, now: () => new Date(TS) });
    const controller = new AbortController();
    controller.abort();
    const result = await handler({ ...generationRequest("generateStructuredRequirement"), abortSignal: controller.signal });
    validateEnginePortResult(result);
    assert.equal(result.outcome, "aborted");
    assert.equal(result.error?.code, "aborted");
    assert.equal(runner.requests.length, 0);
  });

  test("expired deadline returns timed_out before runner is called", async () => {
    const runner = new FakeGenerationRunner();
    const handler = createAnalysisEngineGenerationHandler({ runner, now: () => new Date(TS) });
    const req = { ...generationRequest("generateStructuredRequirement"), deadlineAt: "2026-07-16T23:59:59.000Z" };
    const result = await handler(req);
    validateEnginePortResult(result);
    assert.equal(result.outcome, "timed_out");
    assert.equal(result.error?.code, "deadline_exceeded");
    assert.equal(runner.requests.length, 0);
  });

  test("timeout and abort cancel runner and ignore late success", async () => {
    const timeoutRunner = new FakeGenerationRunner({ scenario: "never" });
    const timeoutHandler = createAnalysisEngineGenerationHandler({ runner: timeoutRunner, now: () => new Date(TS), defaultTimeoutMs: 1 });
    const timedOut = await timeoutHandler({ ...generationRequest("generateStructuredRequirement"), deadlineAt: null });
    assert.equal(timedOut.outcome, "timed_out");
    assert.equal(timedOut.error?.code, "deadline_exceeded");
    assert.equal(timeoutRunner.cancelCount, 1);

    const abortRunner = new FakeGenerationRunner({ scenario: "never" });
    const abortHandler = createAnalysisEngineGenerationHandler({ runner: abortRunner, now: () => new Date(TS), defaultTimeoutMs: 10_000 });
    const controller = new AbortController();
    const promise = abortHandler({ ...generationRequest("generateStructuredRequirement"), abortSignal: controller.signal });
    controller.abort();
    const aborted = await promise;
    assert.equal(aborted.outcome, "aborted");
    assert.equal(aborted.error?.code, "aborted");
    assert.equal(abortRunner.cancelCount, 1);
  });

  test("mid-flight timeout settles once even when runner resolves later", async () => {
    const runner = new FakeGenerationRunner({ scenario: "happy", delayMs: 50 });
    const handler = createAnalysisEngineGenerationHandler({ runner, now: () => new Date(TS), defaultTimeoutMs: 1 });
    const result = await handler({ ...generationRequest("generateStructuredRequirement"), deadlineAt: null });
    validateEnginePortResult(result);
    assert.equal(result.outcome, "timed_out");
    assert.equal(result.error?.code, "deadline_exceeded");
    assert.equal(runner.cancelCount, 1);
    await new Promise((resolve) => setTimeout(resolve, 80));
  });

  test("extra top-level field, extra producer field, or non-string warnings map to output_schema_invalid", async () => {
    for (const operation of ["generateStructuredRequirement", "generateAnalysisPlan"] as const) {
      const req = generationRequest(operation);
      const happy = await alignedHappyOutput(req);
      const cases: Array<[string, string]> = [
        ["extra top-level field", mutate(happy, (o) => { o.unexpected = true; })],
        ["extra producer field", mutate(happy, (o) => { (o.producer as Record<string, unknown>).extra = "x"; })],
        ["missing producer field", mutate(happy, (o) => { delete (o.producer as Record<string, unknown>).mode; })],
        ["object warnings", mutate(happy, (o) => { o.warnings = [{ warningCode: "w" }]; })],
        ["missing top-level key", mutate(happy, (o) => { delete o.candidate; })],
      ];
      for (const [name, stdoutJson] of cases) {
        const handler = createAnalysisEngineGenerationHandler({ runner: stubGenerationRunner(stdoutJson), now: () => new Date(TS) });
        const result = await handler(req);
        validateEnginePortResult(result);
        assert.equal(result.outcome, "failed", `${operation}: ${name}`);
        assert.equal(result.error?.code, "output_schema_invalid", `${operation}: ${name}`);
        assertNoLeak(result);
      }
    }
  });

  test("abort result stays pending until runner confirms termination", async () => {
    let cancelCalls = 0;
    let resolveTermination!: () => void;
    const termination = new Promise<void>((resolve) => { resolveTermination = resolve; });
    const runner: PiGenerationRunner = {
      start: () => ({
        done: new Promise(() => undefined),
        cancel: () => { cancelCalls += 1; return termination; },
        isRunning: () => true,
      }),
    };
    const handler = createAnalysisEngineGenerationHandler({ runner, now: () => new Date(TS), defaultTimeoutMs: 10_000 });
    const controller = new AbortController();
    const pending = handler({ ...generationRequest("generateStructuredRequirement"), abortSignal: controller.signal });
    controller.abort();
    let settled = false;
    void pending.then(() => { settled = true; });
    await new Promise((resolve) => setTimeout(resolve, 30));
    assert.equal(cancelCalls, 1);
    assert.equal(settled, false, "handler must not settle before termination is confirmed");
    resolveTermination();
    const result = await pending;
    validateEnginePortResult(result);
    assert.equal(result.outcome, "aborted");
    assert.equal(result.error?.code, "aborted");
  });

  test("timeout result stays pending until runner confirms termination", async () => {
    let cancelCalls = 0;
    let resolveTermination!: () => void;
    const termination = new Promise<void>((resolve) => { resolveTermination = resolve; });
    const runner: PiGenerationRunner = {
      start: () => ({
        done: new Promise(() => undefined),
        cancel: () => { cancelCalls += 1; return termination; },
        isRunning: () => true,
      }),
    };
    const handler = createAnalysisEngineGenerationHandler({ runner, now: () => new Date(TS), defaultTimeoutMs: 1 });
    const pending = handler({ ...generationRequest("generateStructuredRequirement"), deadlineAt: null });
    let settled = false;
    void pending.then(() => { settled = true; });
    await new Promise((resolve) => setTimeout(resolve, 30));
    assert.equal(cancelCalls, 1);
    assert.equal(settled, false, "handler must not settle before termination is confirmed");
    resolveTermination();
    const result = await pending;
    validateEnginePortResult(result);
    assert.equal(result.outcome, "timed_out");
    assert.equal(result.error?.code, "deadline_exceeded");
  });

  test("fake runner is deterministic and process-local only", async () => {
    const runner = new FakeGenerationRunner();
    const handler = createAnalysisEngineGenerationHandler({ runner, now: () => new Date(TS) });
    const req = generationRequest("generateStructuredRequirement");
    const one = await handler(req);
    const two = await handler(req);
    assert.deepEqual(one.output, two.output);
    assert.equal(runner.requests.length, 2);
    const runnerText = JSON.stringify(runner.requests);
    assert.ok(!runnerText.includes("/Users/"), runnerText);
    assert.ok(!runnerText.includes(".pi-sessions"), runnerText);
    assert.ok(!runnerText.includes("restricted_raw"), runnerText);
    assert.ok(!runnerText.includes("draw_data"), runnerText);
    assert.ok(!runnerText.includes("credentials"), runnerText);
  });
});
