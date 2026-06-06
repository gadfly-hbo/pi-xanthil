import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";
import test from "node:test";
import {
  buildPairwiseJudgePrompt,
  runSkillEvaluation,
  summarizeSkillEvaluationResults,
  type SkillPairwiseJudgeOptions,
  type SkillEvalRunTurn,
  type SkillEvaluationRunResult,
} from "./skill-evaluation-runner.ts";
import type { PiRun, RunPiOptions } from "./pi-adapter.ts";
import type { PiEvent } from "./types.ts";

function makeRunRoot(): string {
  return mkdtempSync(join(tmpdir(), "pi-xanthil-skill-eval-test-"));
}

function makeSkillFile(): string {
  const root = makeRunRoot();
  const dir = join(root, "brand-skill");
  mkdirSync(dir, { recursive: true });
  const skillPath = join(dir, "SKILL.md");
  writeFileSync(
    skillPath,
    [
      "---",
      "name: Brand Leakage Skill",
      "description: Detect brand leakage",
      "---",
      "",
      "Use brand_leakage_score.",
      "",
    ].join("\n"),
    "utf8",
  );
  return skillPath;
}

function makeFakeRunTurn(skillText = ""): { runTurn: SkillEvalRunTurn; calls: RunPiOptions[] } {
  const calls: RunPiOptions[] = [];
  const runTurn: SkillEvalRunTurn = (opts): PiRun => {
    calls.push(opts);
    const text = `output for ${opts.piSessionId} skills=${(opts.skillPaths ?? []).join("|") || "none"} ${skillText}`.trim();
    const done = new Promise<number | null>((resolve) => {
      queueMicrotask(() => {
        try {
          opts.onEvent({
            type: "message_end",
            message: {
              role: "assistant",
              content: [
                { type: "tool_use", name: "read_file" },
                { type: "text", text },
              ],
            },
          } as unknown as PiEvent);
        } finally {
          resolve(opts.piSessionId.includes("bad") ? 2 : 0);
        }
      });
    });
    return { done, kill: () => undefined, isRunning: () => true };
  };
  return { runTurn, calls };
}

test("runSkillEvaluation executes variants by tasks by repeat and passes skillPaths", async () => {
  const skillPath = makeSkillFile();
  const fake = makeFakeRunTurn("brand_leakage_score");
  const observed: SkillEvaluationRunResult[] = [];

  const summary = await runSkillEvaluation({
    workspaceRoot: makeRunRoot(),
    runRoot: makeRunRoot(),
    evaluationId: "skill-eval",
    workspaceId: "workspace-1",
    model: "model-a",
    variants: [
      { id: "baseline", label: "Baseline", skillPaths: [] },
      { id: "with_skill", label: "With Skill", skillPaths: [skillPath] },
    ],
    tasks: [
      { id: "task_a", prompt: "Task A" },
      { id: "task_b", prompt: "Task B" },
    ],
    repeat: 2,
    runTurn: fake.runTurn,
    judgePairwise: async ({ baseline, variant, task }) => ({
      baselineResultId: baseline.id,
      variantResultId: variant.id,
      taskId: task.id,
      attempt: variant.attempt,
      verdict: "win",
      scoreDelta: 10,
      baselineScore: 80,
      variantScore: 90,
      confidence: 0.75,
      reason: "variant is better",
      error: null,
    }),
    onResult: (result) => observed.push(result),
  });

  assert.equal(summary.status, "success");
  assert.equal(summary.results.length, 8);
  assert.equal(summary.variantSummaries.length, 2);
  assert.deepEqual(summary.variantSummaries.map((row) => [row.variantId, row.total, row.success, row.failed]), [
    ["baseline", 4, 4, 0],
    ["with_skill", 4, 4, 0],
  ]);
  assert.equal(summary.variantSummaries[0]?.activationRate, 0);
  assert.equal(summary.variantSummaries[1]?.activationRate, 1);
  assert.deepEqual(summary.taskSummaries.map((row) => [row.taskId, row.total, row.success]), [
    ["task_a", 4, 4],
    ["task_b", 4, 4],
  ]);
  assert.equal(observed.length, 8);
  assert.equal(fake.calls.length, 8);
  assert.deepEqual(fake.calls.map((call) => call.skillPaths), [
    [],
    [],
    [],
    [],
    [skillPath],
    [skillPath],
    [skillPath],
    [skillPath],
  ]);
  assert.deepEqual(fake.calls.map((call) => call.model), Array(8).fill("model-a"));
  assert.deepEqual(summary.results.map((result) => result.totalTokens), Array(8).fill(0));
  assert.deepEqual(summary.results.map((result) => result.toolCalls), Array(8).fill(1));
  assert.match(summary.results[0]?.output ?? "", /skills=none/);
  assert.match(summary.results[4]?.output ?? "", /brand_leakage_score/);
  assert.equal(summary.results[0]?.activation.activated, false);
  assert.equal(summary.results[4]?.activation.activated, true);
  assert.deepEqual(summary.pairwiseSummaries.map((row) => [row.variantId, row.win, row.tie, row.loss, row.avgScoreDelta, row.avgConfidence]), [
    ["with_skill", 4, 0, 0, 10, 0.75],
  ]);
});

test("runSkillEvaluation records failed pi exits as typed errors without stopping later cases", async () => {
  const fake = makeFakeRunTurn();

  const summary = await runSkillEvaluation({
    workspaceRoot: makeRunRoot(),
    runRoot: makeRunRoot(),
    evaluationId: "skill-eval",
    workspaceId: "workspace-1",
    model: "",
    variants: [
      { id: "bad_variant", label: "Bad Variant", skillPaths: ["/skills/bad/SKILL.md"] },
      { id: "ok_variant", label: "OK Variant", skillPaths: [] },
    ],
    tasks: [{ id: "task", prompt: "Task" }],
    repeat: 1,
    runTurn: fake.runTurn,
  });

  assert.equal(summary.status, "failed");
  assert.equal(summary.results.length, 2);
  assert.equal(summary.results[0]?.status, "failed");
  assert.equal(summary.results[0]?.error?.code, "process_exit");
  assert.equal(summary.results[1]?.status, "success");
  assert.equal(summary.variantSummaries[0]?.failed, 1);
  assert.equal(summary.variantSummaries[1]?.success, 1);
});

test("runSkillEvaluation repeats pairwise judge runs and aggregates by vote", async () => {
  const fake = makeFakeRunTurn("variant output");
  const verdicts: Array<"loss" | "win" | "win"> = ["loss", "win", "win"];
  const judgeDirs: string[] = [];

  const summary = await runSkillEvaluation({
    workspaceRoot: makeRunRoot(),
    runRoot: makeRunRoot(),
    evaluationId: "skill-eval",
    workspaceId: "workspace-1",
    model: "model-a",
    variants: [
      { id: "baseline", label: "Baseline", skillPaths: [] },
      { id: "with_skill", label: "With Skill", skillPaths: ["/skills/a/SKILL.md"] },
    ],
    tasks: [{ id: "task", prompt: "Task" }],
    repeat: 1,
    judgeRepeat: 3,
    runTurn: fake.runTurn,
    judgePairwise: async ({ baseline, variant, task, judgeDir }) => {
      judgeDirs.push(judgeDir);
      const verdict = verdicts.shift() ?? "win";
      return {
        baselineResultId: baseline.id,
        variantResultId: variant.id,
        taskId: task.id,
        attempt: variant.attempt,
        verdict,
        scoreDelta: verdict === "win" ? 8 : -3,
        baselineScore: 80,
        variantScore: verdict === "win" ? 88 : 77,
        confidence: verdict === "win" ? 0.8 : 0.5,
        reason: verdict,
        error: null,
      };
    },
  });

  const pairwise = summary.results.find((result) => result.variantId === "with_skill")?.pairwise;
  assert.equal(pairwise?.verdict, "win");
  assert.equal(pairwise?.judgeRuns?.length, 3);
  assert.equal(pairwise?.scoreDelta, 13 / 3);
  assert.equal(pairwise?.confidence, 2.1 / 3);
  assert.equal(judgeDirs.length, 3);
  assert.ok(judgeDirs.every((dir) => /judge-\d+$/.test(dir)));
  assert.deepEqual(summary.pairwiseSummaries.map((row) => [row.variantId, row.judged, row.win, row.avgConfidence]), [
    ["with_skill", 1, 1, 2.1 / 3],
  ]);
});

test("buildPairwiseJudgePrompt includes rubric and expected points", () => {
  const baseResult = makeSuccessfulResult("baseline-task-1", "baseline", "Baseline", "task", "baseline output");
  const variantResult = makeSuccessfulResult("variant-task-1", "with_skill", "With Skill", "task", "variant output");
  const prompt = buildPairwiseJudgePrompt({
    judgeDir: makeRunRoot(),
    workspaceId: "workspace-1",
    evaluationId: "skill-eval",
    model: "model-a",
    task: {
      id: "task",
      prompt: "Write a retention analysis",
      expectedPoints: ["include churn drivers", "list next actions"],
      rubric: "Prioritize correctness and actionability.",
    },
    baseline: baseResult,
    variant: variantResult,
  });

  assert.match(prompt, /Write a retention analysis/);
  assert.match(prompt, /include churn drivers/);
  assert.match(prompt, /list next actions/);
  assert.match(prompt, /Prioritize correctness and actionability/);
  assert.match(prompt, /baseline output/);
  assert.match(prompt, /variant output/);
  assert.match(prompt, /只输出 JSON 对象/);
});

test("runSkillEvaluation stores typed pairwise judge errors", async () => {
  const fake = makeFakeRunTurn();

  const summary = await runSkillEvaluation({
    workspaceRoot: makeRunRoot(),
    runRoot: makeRunRoot(),
    evaluationId: "skill-eval",
    workspaceId: "workspace-1",
    model: "model-a",
    variants: [
      { id: "baseline", label: "Baseline", skillPaths: [] },
      { id: "with_skill", label: "With Skill", skillPaths: ["/skills/a/SKILL.md"] },
    ],
    tasks: [{ id: "task", prompt: "Task" }],
    repeat: 1,
    runTurn: fake.runTurn,
    judgePairwise: async (_options: SkillPairwiseJudgeOptions) => {
      throw new Error("judge model unavailable");
    },
  });

  const pairwise = summary.results.find((result) => result.variantId === "with_skill")?.pairwise;
  assert.equal(pairwise?.verdict, "not_judged");
  assert.equal(pairwise?.error?.code, "unknown");
  assert.match(pairwise?.error?.message ?? "", /judge model unavailable/);
  assert.match(pairwise?.error?.hint ?? "", /pairwise judge run directory/);
  assert.deepEqual(summary.pairwiseSummaries.map((row) => [row.variantId, row.judged, row.skipped]), [
    ["with_skill", 0, 1],
  ]);
});

test("runSkillEvaluation validates duplicate variants and empty task sets", async () => {
  await assert.rejects(
    () => runSkillEvaluation({
      workspaceRoot: makeRunRoot(),
      evaluationId: "skill-eval",
      workspaceId: "workspace-1",
      model: "",
      variants: [
        { id: "dup", label: "A", skillPaths: [] },
        { id: "dup", label: "B", skillPaths: [] },
      ],
      tasks: [{ id: "task", prompt: "Task" }],
      repeat: 1,
      runTurn: makeFakeRunTurn().runTurn,
    }),
    /duplicate variant id: dup/,
  );

  await assert.rejects(
    () => runSkillEvaluation({
      workspaceRoot: makeRunRoot(),
      evaluationId: "skill-eval",
      workspaceId: "workspace-1",
      model: "",
      variants: [{ id: "baseline", label: "Baseline", skillPaths: [] }],
      tasks: [],
      repeat: 1,
      runTurn: makeFakeRunTurn().runTurn,
    }),
    /tasks must not be empty/,
  );
});

test("summarizeSkillEvaluationResults averages successful rows and keeps activation over all rows", () => {
  const base = {
    startedAt: 0,
    endedAt: 1000,
    durationSec: 1,
    skillPaths: [],
    totalTokens: 0,
    totalCost: 0,
    toolCalls: 0,
    outputChars: 0,
    output: "",
    activation: { activated: false, matchedKeywords: [], matchedSkillPaths: [], evidence: [] },
    pairwise: null,
    error: null,
  };
  const summaries = summarizeSkillEvaluationResults([
    {
      ...base,
      id: "a-1",
      variantId: "a",
      variantLabel: "A",
      taskId: "task",
      attempt: 1,
      status: "success",
      totalTokens: 10,
      totalCost: 0.1,
      toolCalls: 1,
      outputChars: 100,
      activation: { activated: true, matchedKeywords: ["x"], matchedSkillPaths: [], evidence: [] },
    },
    {
      ...base,
      id: "a-2",
      variantId: "a",
      variantLabel: "A",
      taskId: "task",
      attempt: 2,
      status: "failed",
      totalTokens: 999,
      activation: { activated: false, matchedKeywords: [], matchedSkillPaths: [], evidence: [] },
    },
  ]);

  assert.equal(summaries.variantSummaries[0]?.total, 2);
  assert.equal(summaries.variantSummaries[0]?.success, 1);
  assert.equal(summaries.variantSummaries[0]?.avgTotalTokens, 10);
  assert.equal(summaries.variantSummaries[0]?.activationRate, 0.5);
  assert.equal(summaries.taskSummaries[0]?.activationRate, 0.5);
});

function makeSuccessfulResult(
  id: string,
  variantId: string,
  variantLabel: string,
  taskId: string,
  output: string,
): SkillEvaluationRunResult {
  return {
    id,
    variantId,
    variantLabel,
    taskId,
    attempt: 1,
    status: "success",
    startedAt: 0,
    endedAt: 1000,
    durationSec: 1,
    skillPaths: [],
    totalTokens: 0,
    totalCost: 0,
    toolCalls: 0,
    outputChars: output.length,
    output,
    activation: { activated: false, matchedKeywords: [], matchedSkillPaths: [], evidence: [] },
    pairwise: null,
    error: null,
  };
}
