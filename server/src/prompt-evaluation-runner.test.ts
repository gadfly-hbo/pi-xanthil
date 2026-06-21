import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";
import test from "node:test";
import { runPromptEvaluation, type PromptEvalRunTurn } from "./prompt-evaluation-runner.ts";
import type { PiRun, RunPiOptions } from "./pi-adapter.ts";
import type { PiEvent } from "./types.ts";

function makeRoot(): string {
  return mkdtempSync(join(tmpdir(), "pi-xanthil-prompt-eval-"));
}

function makeRunTurn(): { runTurn: PromptEvalRunTurn; calls: RunPiOptions[] } {
  const calls: RunPiOptions[] = [];
  return {
    calls,
    runTurn: (options): PiRun => {
      calls.push(options);
      const done = new Promise<number | null>((resolve) => queueMicrotask(() => {
        options.onEvent({
          type: "message_end",
          message: { role: "assistant", content: [{ type: "text", text: `output ${options.piSessionId}` }] },
        } as unknown as PiEvent);
        resolve(0);
      }));
      return { done, kill: () => undefined, isRunning: () => true };
    },
  };
}

test("runPromptEvaluation injects system and prefix variants and produces pairwise summaries", async () => {
  const fake = makeRunTurn();
  const summary = await runPromptEvaluation({
    workspaceRoot: makeRoot(),
    runRoot: makeRoot(),
    workspaceId: "workspace-1",
    evaluationId: "prompt-eval",
    model: "model-a",
    variants: [
      { id: "baseline", label: "Baseline", promptBody: "System baseline", role: "system" },
      { id: "variant", label: "Variant", promptBody: "Prefix variant", role: "prefix" },
    ],
    tasks: [{ id: "task", prompt: "Analyze retention" }],
    repeat: 2,
    judgeRepeat: 2,
    runTurn: fake.runTurn,
    judgePairwise: async ({ baseline, variant, task }) => ({
      baselineResultId: baseline.id,
      variantResultId: variant.id,
      taskId: task.id,
      attempt: variant.attempt,
      verdict: "win",
      scoreDelta: 12,
      baselineScore: 75,
      variantScore: 87,
      confidence: 0.8,
      reason: "better",
      error: null,
    }),
  });

  assert.equal(summary.results.length, 4);
  assert.equal(fake.calls[0]?.systemPrompt, "System baseline");
  assert.match(fake.calls[2]?.text ?? "", /Prefix variant\n\nAnalyze retention/);
  assert.equal(fake.calls[2]?.systemPrompt, undefined);
  assert.deepEqual(summary.pairwiseSummaries.map((item) => [item.variantId, item.win, item.avgScoreDelta]), [["variant", 2, 12]]);
  assert.equal(summary.results.find((item) => item.variantId === "variant")?.pairwise?.judgeRuns?.length, 2);
});

test("runPromptEvaluation records failed runs and skips their pairwise judge", async () => {
  const runTurn: PromptEvalRunTurn = (options) => ({
    done: Promise.resolve(options.piSessionId.includes("baseline") ? 2 : 0),
    kill: () => undefined,
    isRunning: () => true,
  });
  const summary = await runPromptEvaluation({
    workspaceRoot: makeRoot(),
    workspaceId: "workspace-1",
    evaluationId: "prompt-eval",
    model: "",
    variants: [
      { id: "baseline", label: "Baseline", promptBody: "Base", role: "system" },
      { id: "variant", label: "Variant", promptBody: "Variant", role: "prefix" },
    ],
    tasks: [{ id: "task", prompt: "Task" }],
    repeat: 1,
    runTurn,
  });
  assert.equal(summary.status, "failed");
  assert.equal(summary.results[0]?.error?.code, "process_exit");
  assert.equal(summary.results[1]?.pairwise?.verdict, "not_judged");
});
