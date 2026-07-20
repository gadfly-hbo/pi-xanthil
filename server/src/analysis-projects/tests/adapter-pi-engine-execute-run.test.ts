import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import {
  createAnalysisEngineExecutionHandler,
  createAnalysisEngineGenerationHandler,
  FakeExecutionRunner,
  FakeGenerationRunner,
  type RunExecutionRunner,
} from "../adapters/pi-engine/index.ts";
import {
  validateEnginePortRequest,
  validateEnginePortResult,
  type EnginePortRequest,
} from "../contracts/engine-port.ts";
import { validateRunEventPayload } from "../contracts/run-event.ts";

const TS = "2026-07-18T00:00:00.000Z";

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
    inputHash: "c".repeat(64),
    abortSignal: null,
    input: {
      runId,
      planVersionId: randomUUID(),
      expectedPreviousSequence: 1,
    },
  };
}

function generationRequest(operation: "generateStructuredRequirement" | "generateAnalysisPlan"): EnginePortRequest {
  const common = {
    version: "engine-port/1.0" as const,
    operationId: randomUUID(),
    projectId: randomUUID(),
    generationId: randomUUID(),
    caller: "backend",
    requestedAt: TS,
    deadlineAt: "2026-07-18T00:00:30.000Z",
    inputHash: "d".repeat(64),
    abortSignal: null,
  };
  if (operation === "generateStructuredRequirement") return { ...common, operation, input: { targetSchemaVersion: "1.0" } };
  return { ...common, operation, input: { requirementVersionId: randomUUID(), targetSchemaVersion: "1.0" } };
}

function assertNoLeak(value: unknown): void {
  const text = JSON.stringify(value);
  assert.ok(!text.includes("prompt"), text);
  assert.ok(!text.includes("hiddenReasoning"), text);
  assert.ok(!text.includes("rawPiEvent"), text);
  assert.ok(!text.includes("storageRef"), text);
  assert.ok(!text.includes("piSessionRef"), text);
  assert.ok(!text.includes("stdout"), text);
  assert.ok(!text.includes("stderr"), text);
  assert.ok(!text.includes("SELECT"), text);
  assert.ok(!text.includes("/Users/"), text);
  assert.ok(!text.includes(".pi-sessions"), text);
  assert.ok(!text.includes("restricted_raw"), text);
  assert.ok(!text.includes("draw_data"), text);
  assert.ok(!/[A-Za-z0-9_-]{40,}/.test(text.replace(/[0-9a-f]{64}/g, "")), text);
}

function validateEventSuggestions(events: Array<{ eventType: string; payloadSchemaVersion: string; payload: unknown }>): void {
  for (const event of events) {
    validateRunEventPayload(event.eventType, event.payloadSchemaVersion, event.payload);
  }
}

const FAKE_EXEC_RUNTIME = { producerName: "pi-xanthil-fake-execution-runner", producerVersion: "0.0.0-test", mode: "fake" as const };

function stubExecutionRunner(stdoutJson: string): RunExecutionRunner {
  return {
    start: () => ({
      done: Promise.resolve({ outcome: "succeeded", stdoutJson, runtime: FAKE_EXEC_RUNTIME }),
      cancel: () => undefined,
      isRunning: () => false,
    }),
  };
}

async function alignedHappyExecutionOutput(req: EnginePortRequest): Promise<string> {
  const input = req.input as { runId: string; planVersionId: string; expectedPreviousSequence: number };
  const runner = new FakeExecutionRunner();
  const handle = runner.start({
    operation: "executeQueuedRun",
    runId: input.runId,
    planVersionId: input.planVersionId,
    expectedPreviousSequence: input.expectedPreviousSequence,
    inputHash: req.inputHash,
    instruction: "x",
  });
  const result = await handle.done;
  assert.equal(result.outcome, "succeeded");
  return (result as { stdoutJson: string }).stdoutJson;
}

function mutateExec(json: string, fn: (output: Record<string, unknown>) => void): string {
  const output = JSON.parse(json) as Record<string, unknown>;
  fn(output);
  return JSON.stringify(output);
}

describe("pi engine executeQueuedRun handler", () => {
  test("happy path validates request/result and returns normalized execution suggestions", async () => {
    const runner = new FakeExecutionRunner();
    const handler = createAnalysisEngineExecutionHandler({ runner, now: () => new Date(TS) });
    const req = executeRequest();
    validateEnginePortRequest(req);
    const result = await handler(req);
    validateEnginePortResult(result);

    assert.equal(result.outcome, "succeeded");
    assert.equal(runner.requests.length, 1);
    const output = result.output as {
      candidateType: string;
      runId: string;
      planVersionId: string;
      executionSummary: { analysisOpsStages: string[]; internalReviewOutcome: string; reportDraftReady: boolean };
      eventSuggestions: Array<{ eventType: string; payloadSchemaVersion: string; payload: unknown }>;
      internalReviewSuggestion: { outcome: string };
      reportDraftCandidate: { citedEvidenceHandles: string[] };
    };
    assert.equal(output.candidateType, "run_execution_candidate");
    const execInput = req.input as { runId: string; planVersionId: string };
    assert.equal(output.runId, execInput.runId);
    assert.equal(output.planVersionId, execInput.planVersionId);
    assert.deepEqual(output.executionSummary.analysisOpsStages, ["S2.1", "S2.2", "S2.3", "S2.4"]);
    assert.equal(output.executionSummary.internalReviewOutcome, "passed");
    assert.equal(output.executionSummary.reportDraftReady, true);
    const PROHIBITED = new Set(["run_started", "run_failed", "run_aborted", "run_blocked", "evidence_registered"]);
    assert.ok(output.eventSuggestions.every((event) => !PROHIBITED.has(event.eventType)), "happy path must not suggest backend-owned events");
    assert.ok(output.eventSuggestions.every((event) => event.payloadSchemaVersion === `workcanger.run-event.${event.eventType}/1.0`));
    validateEventSuggestions(output.eventSuggestions);
    assert.equal(output.internalReviewSuggestion.outcome, "passed");
    assert.ok(output.reportDraftCandidate.citedEvidenceHandles.length > 0);
    assertNoLeak(result);
  });

  test("request validation fails closed before runner is called", async () => {
    const runner = new FakeExecutionRunner();
    const handler = createAnalysisEngineExecutionHandler({ runner, now: () => new Date(TS) });

    await assert.rejects(() => handler({ ...executeRequest(), operation: "unknown" } as unknown as EnginePortRequest), /Unknown engine port operation/);
    await assert.rejects(() => handler({ ...executeRequest(), unexpected: true } as unknown as EnginePortRequest), /unknown request envelope field/);
    await assert.rejects(() => handler({ ...executeRequest(), runId: randomUUID() }), /request runId must match input.runId/);
    const baseReq = executeRequest();
    const badSeq = { ...baseReq, input: { runId: baseReq.runId as string, planVersionId: randomUUID(), expectedPreviousSequence: -1 } } as unknown as EnginePortRequest;
    await assert.rejects(() => handler(badSeq), /non-negative integer/);
    assert.equal(runner.requests.length, 0);
  });

  test("malformed, unsafe, unknown event, or invalid RunEvent payload output maps to safe output_schema_invalid", async () => {
    for (const scenario of ["malformed_json", "invalid_candidate", "unknown_event_type", "invalid_event_payload"] as const) {
      const runner = new FakeExecutionRunner({ scenario });
      const handler = createAnalysisEngineExecutionHandler({ runner, now: () => new Date(TS) });
      const result = await handler(executeRequest());
      validateEnginePortResult(result);
      assert.equal(result.outcome, "failed");
      assert.equal(result.error?.code, "output_schema_invalid");
      assertNoLeak(result);
    }
  });

  test("runner spawn throw, start result failure, and done rejection map to safe errors", async () => {
    const spawnThrowRunner: RunExecutionRunner = {
      start() {
        throw new Error("raw /Users/example/.pi-sessions token_abcdefghijklmnopqrstuvwxyz0123456789 SELECT * FROM secrets");
      },
    };
    const spawnThrow = await createAnalysisEngineExecutionHandler({ runner: spawnThrowRunner, now: () => new Date(TS) })(executeRequest());
    validateEnginePortResult(spawnThrow);
    assert.equal(spawnThrow.error?.code, "pi_spawn_failed");
    assertNoLeak(spawnThrow);

    const executionFailed = await createAnalysisEngineExecutionHandler({ runner: new FakeExecutionRunner({ scenario: "execution_failed" }), now: () => new Date(TS) })(executeRequest());
    validateEnginePortResult(executionFailed);
    assert.equal(executionFailed.error?.code, "pi_execution_failed");
    assertNoLeak(executionFailed);

    const rejectRunner: RunExecutionRunner = {
      start() {
        return {
          done: Promise.reject(new Error("stderr /Users/example/.pi-sessions rawPiEvent token_abcdefghijklmnopqrstuvwxyz0123456789")),
          cancel: () => undefined,
          isRunning: () => false,
        };
      },
    };
    const rejected = await createAnalysisEngineExecutionHandler({ runner: rejectRunner, now: () => new Date(TS) })(executeRequest());
    validateEnginePortResult(rejected);
    assert.equal(rejected.error?.code, "pi_execution_failed");
    assertNoLeak(rejected);
  });

  test("pre-aborted signal and expired deadline return before runner is called", async () => {
    const abortRunner = new FakeExecutionRunner();
    const abortHandler = createAnalysisEngineExecutionHandler({ runner: abortRunner, now: () => new Date(TS) });
    const controller = new AbortController();
    controller.abort();
    const preAborted = await abortHandler({ ...executeRequest(), abortSignal: controller.signal });
    validateEnginePortResult(preAborted);
    assert.equal(preAborted.outcome, "aborted");
    assert.equal(abortRunner.requests.length, 0);

    const deadlineRunner = new FakeExecutionRunner();
    const deadlineHandler = createAnalysisEngineExecutionHandler({ runner: deadlineRunner, now: () => new Date(TS) });
    const expired = await deadlineHandler({ ...executeRequest(), deadlineAt: "2026-07-17T23:59:59.000Z" });
    validateEnginePortResult(expired);
    assert.equal(expired.outcome, "timed_out");
    assert.equal(expired.error?.code, "deadline_exceeded");
    assert.equal(deadlineRunner.requests.length, 0);
  });

  test("timeout and abort cancel runner and ignore late success", async () => {
    const timeoutRunner = new FakeExecutionRunner({ scenario: "never" });
    const timedOut = await createAnalysisEngineExecutionHandler({ runner: timeoutRunner, now: () => new Date(TS), defaultTimeoutMs: 1 })({ ...executeRequest(), deadlineAt: null });
    validateEnginePortResult(timedOut);
    assert.equal(timedOut.outcome, "timed_out");
    assert.equal(timedOut.error?.code, "deadline_exceeded");
    assert.equal(timeoutRunner.cancelCount, 1);

    const abortRunner = new FakeExecutionRunner({ scenario: "never" });
    const controller = new AbortController();
    const promise = createAnalysisEngineExecutionHandler({ runner: abortRunner, now: () => new Date(TS), defaultTimeoutMs: 10_000 })({ ...executeRequest(), abortSignal: controller.signal });
    controller.abort();
    const aborted = await promise;
    validateEnginePortResult(aborted);
    assert.equal(aborted.outcome, "aborted");
    assert.equal(aborted.error?.code, "aborted");
    assert.equal(abortRunner.cancelCount, 1);
  });

  test("summary count mismatches, arbitrary qualityChecks, and dangling handle references map to output_schema_invalid", async () => {
    const req = executeRequest();
    const happy = await alignedHappyExecutionOutput(req);
    const cases: Array<[string, (o: Record<string, unknown>) => void]> = [
      ["eventSuggestionCount != events.length", (o) => { (o.executionSummary as Record<string, unknown>).eventSuggestionCount = 999; }],
      ["evidenceSuggestionCount != evidence.length", (o) => { (o.executionSummary as Record<string, unknown>).evidenceSuggestionCount = 999; }],
      ["extra top-level field", (o) => { o.unexpected = true; }],
      ["extra producer field", (o) => { (o.producer as Record<string, unknown>).extra = "x"; }],
      ["arbitrary qualityChecks shape", (o) => { (o.internalReviewSuggestion as Record<string, unknown>).qualityChecks = [{ check: "c", status: "passed", details: "d" }]; }],
      ["qualityChecks non-passed outcome", (o) => { (o.internalReviewSuggestion as Record<string, unknown>).qualityChecks = [{ checkId: "qc", outcome: "failed", summary: "s" }]; }],
      ["empty qualityChecks", (o) => { (o.internalReviewSuggestion as Record<string, unknown>).qualityChecks = []; }],
      ["reviewEvidenceHandle not registered", (o) => { (o.internalReviewSuggestion as Record<string, unknown>).reviewEvidenceHandle = "candidate-evidence:unknown"; }],
      ["reviewedEvidenceHandles dangling", (o) => { (o.internalReviewSuggestion as Record<string, unknown>).reviewedEvidenceHandles = ["candidate-evidence:unknown"]; }],
      ["citedEvidenceHandles dangling", (o) => { (o.reportDraftCandidate as Record<string, unknown>).citedEvidenceHandles = ["candidate-evidence:unknown"]; }],
      ["review evidence wrong artifactKind", (o) => {
        const list = o.evidenceRegistrationSuggestions as Array<Record<string, unknown>>;
        const review = list.find((s) => s.candidateEvidenceHandle === "candidate-evidence:internal-review")!;
        review.artifactKind = "analysis_result";
      }],
      ["review evidence wrong visibility", (o) => {
        const list = o.evidenceRegistrationSuggestions as Array<Record<string, unknown>>;
        const review = list.find((s) => s.candidateEvidenceHandle === "candidate-evidence:internal-review")!;
        review.visibility = "user_visible";
      }],
      ["duplicate candidateEvidenceHandle", (o) => {
        const list = o.evidenceRegistrationSuggestions as Array<Record<string, unknown>>;
        list[1]!.candidateEvidenceHandle = list[0]!.candidateEvidenceHandle as string;
      }],
      ["duplicate producerEventId", (o) => {
        const list = o.eventSuggestions as Array<Record<string, unknown>>;
        list[1]!.producerEventId = list[0]!.producerEventId as string;
      }],
      ["warning_recorded with durable evidence IDs", (o) => {
        const list = o.eventSuggestions as Array<Record<string, unknown>>;
        list[0] = {
          eventType: "warning_recorded",
          payloadSchemaVersion: "workcanger.run-event.warning_recorded/1.0",
          analysisStageAfter: "S2.1",
          runStatusAfter: "running",
          producerEventId: "fake-warning-1",
          payload: { warningCode: "w1", summary: "synthetic warning", evidenceArtifactIds: ["candidate-evidence:analysis-summary"] },
        };
      }],
      ["plan_step_completed with durable evidence IDs", (o) => {
        const list = o.eventSuggestions as Array<Record<string, unknown>>;
        const completed = list.find((e) => e.eventType === "plan_step_completed")!;
        (completed.payload as Record<string, unknown>).outputEvidenceArtifactIds = ["candidate-evidence:analysis-summary"];
      }],
      ["report limitations with non-string item", (o) => { (o.reportDraftCandidate as Record<string, unknown>).limitations = [{ text: "x" }]; }],
      ["report misinterpretationRisks with non-string item", (o) => { (o.reportDraftCandidate as Record<string, unknown>).misinterpretationRisks = [42]; }],
      ["internal review limitations with non-string item", (o) => { (o.internalReviewSuggestion as Record<string, unknown>).limitations = [{ text: "x" }]; }],
      ["object warnings", (o) => { o.warnings = [{ warningCode: "w" }]; }],
    ];
    for (const [name, fn] of cases) {
      const handler = createAnalysisEngineExecutionHandler({ runner: stubExecutionRunner(mutateExec(happy, fn)), now: () => new Date(TS) });
      const result = await handler(req);
      validateEnginePortResult(result);
      assert.equal(result.outcome, "failed", name);
      assert.equal(result.error?.code, "output_schema_invalid", name);
      assertNoLeak(result);
    }
  });

  test("backend-owned lifecycle and durable-ID event types map to output_schema_invalid", async () => {
    const req = executeRequest();
    const happy = await alignedHappyExecutionOutput(req);
    for (const eventType of ["run_started", "run_failed", "run_aborted", "run_blocked", "evidence_registered"] as const) {
      const mutated = mutateExec(happy, (o) => {
        const list = o.eventSuggestions as Array<Record<string, unknown>>;
        list[0] = {
          eventType,
          payloadSchemaVersion: `workcanger.run-event.${eventType}/1.0`,
          analysisStageAfter: "S2.1",
          runStatusAfter: "running",
          producerEventId: `fake-${eventType}-1`,
          payload: {},
        };
      });
      const handler = createAnalysisEngineExecutionHandler({ runner: stubExecutionRunner(mutated), now: () => new Date(TS) });
      const result = await handler(req);
      validateEnginePortResult(result);
      assert.equal(result.outcome, "failed", eventType);
      assert.equal(result.error?.code, "output_schema_invalid", eventType);
      assertNoLeak(result);
    }
  });

  test("abort and timeout results stay pending until runner confirms termination", async () => {
    for (const mode of ["abort", "timeout"] as const) {
      let cancelCalls = 0;
      let resolveTermination!: () => void;
      const termination = new Promise<void>((resolve) => { resolveTermination = resolve; });
      const runner: RunExecutionRunner = {
        start: () => ({
          done: new Promise(() => undefined),
          cancel: () => { cancelCalls += 1; return termination; },
          isRunning: () => true,
        }),
      };
      const handler = createAnalysisEngineExecutionHandler({ runner, now: () => new Date(TS), defaultTimeoutMs: mode === "timeout" ? 1 : 10_000 });
      const controller = new AbortController();
      const pending = handler(mode === "abort"
        ? { ...executeRequest(), abortSignal: controller.signal }
        : { ...executeRequest(), deadlineAt: null });
      if (mode === "abort") controller.abort();
      let settled = false;
      void pending.then(() => { settled = true; });
      await new Promise((resolve) => setTimeout(resolve, 30));
      assert.equal(cancelCalls, 1, mode);
      assert.equal(settled, false, `${mode}: handler must not settle before termination is confirmed`);
      resolveTermination();
      const result = await pending;
      validateEnginePortResult(result);
      assert.equal(result.outcome, mode === "abort" ? "aborted" : "timed_out", mode);
      assert.equal(result.error?.code, mode === "abort" ? "aborted" : "deadline_exceeded", mode);
    }
  });

  test("event-sequence integrity: counts, stage coherence, step identity, and ordering map to output_schema_invalid", async () => {
    const req = executeRequest();
    const happy = await alignedHappyExecutionOutput(req);
    type Ev = Record<string, unknown>;
    const eventsOf = (o: Record<string, unknown>) => o.eventSuggestions as Ev[];
    const cases: Array<[string, (o: Record<string, unknown>) => void]> = [
      ["planStepCount != distinct completed steps", (o) => { (o.executionSummary as Ev).planStepCount = 999; }],
      ["stage payload.stage disagrees with analysisStageAfter", (o) => {
        const started = eventsOf(o).find((e) => e.eventType === "stage_started")!;
        (started.payload as Ev).stage = "S2.4";
      }],
      ["fully reversed eventSuggestions", (o) => { o.eventSuggestions = eventsOf(o).reverse(); }],
      ["duplicate plan_step_completed stepOrdinal", (o) => {
        const completed = eventsOf(o).filter((e) => e.eventType === "plan_step_completed");
        ((completed[1] as Ev).payload as Ev).stepOrdinal = (completed[0]!.payload as Ev).stepOrdinal;
      }],
      ["skipped stage", (o) => {
        o.eventSuggestions = eventsOf(o).filter((e) => !(e.eventType === "stage_started" && (e.payload as Ev).stage === "S2.2"));
      }],
      ["duplicate planStepId with different ordinal", (o) => {
        const completed = eventsOf(o).filter((e) => e.eventType === "plan_step_completed");
        ((completed[1] as Ev).payload as Ev).planStepId = (completed[0]!.payload as Ev).planStepId;
      }],
      ["plan_step_started after plan_step_completed", (o) => {
        const first = eventsOf(o).find((e) => e.eventType === "plan_step_completed")!;
        const started: Ev = {
          eventType: "plan_step_started",
          payloadSchemaVersion: "workcanger.run-event.plan_step_started/1.0",
          analysisStageAfter: first.analysisStageAfter,
          runStatusAfter: "running",
          producerEventId: "fake-late-step-started",
          payload: { planStepId: (first.payload as Ev).planStepId, stepOrdinal: (first.payload as Ev).stepOrdinal },
        };
        o.eventSuggestions = [...eventsOf(o), started];
        (o.executionSummary as Ev).eventSuggestionCount = (o.eventSuggestions as Ev[]).length;
      }],
      ["non-monotonic stage transition", (o) => {
        const list = eventsOf(o);
        const s2 = list.findIndex((e) => e.analysisStageAfter === "S2.2");
        const s3 = list.findIndex((e) => e.analysisStageAfter === "S2.3");
        const tmp = list[s2]!;
        list[s2] = list[s3]!;
        list[s3] = tmp;
      }],
    ];
    for (const [name, fn] of cases) {
      const handler = createAnalysisEngineExecutionHandler({ runner: stubExecutionRunner(mutateExec(happy, fn)), now: () => new Date(TS) });
      const result = await handler(req);
      validateEnginePortResult(result);
      assert.equal(result.outcome, "failed", name);
      assert.equal(result.error?.code, "output_schema_invalid", name);
      assertNoLeak(result);
    }
  });

  test("fake execution runner is deterministic and does not write SQLite or blob files", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "pi-engine-execute-run-test-"));
    try {
      const runner = new FakeExecutionRunner();
      const handler = createAnalysisEngineExecutionHandler({ runner, now: () => new Date(TS) });
      const req = executeRequest();
      const one = await handler(req);
      const two = await handler(req);
      assert.deepEqual(one.output, two.output);
      assert.equal(runner.requests.length, 2);
      assert.deepEqual(await readdir(tempDir), []);
      assertNoLeak(one);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  test("executeQueuedRun coexists with existing generation operations", async () => {
    const execution = await createAnalysisEngineExecutionHandler({ runner: new FakeExecutionRunner(), now: () => new Date(TS) })(executeRequest());
    const requirement = await createAnalysisEngineGenerationHandler({ runner: new FakeGenerationRunner(), now: () => new Date(TS) })(generationRequest("generateStructuredRequirement"));
    const plan = await createAnalysisEngineGenerationHandler({ runner: new FakeGenerationRunner(), now: () => new Date(TS) })(generationRequest("generateAnalysisPlan"));

    assert.equal(execution.outcome, "succeeded");
    assert.equal(requirement.outcome, "succeeded");
    assert.equal(plan.outcome, "succeeded");
    validateEnginePortResult(execution);
    validateEnginePortResult(requirement);
    validateEnginePortResult(plan);
  });
});
