import test from "node:test";
import assert from "node:assert/strict";
import { coerceEfcDifficulty, scoreEfcRuns } from "./efc-scoring.ts";

test("scoreEfcRuns separates equal pass score by feedback efficiency", () => {
  const lowFeedback = scoreEfcRuns([
    {
      status: "success",
      validity: "passing",
      hasOutput: true,
      totalTokens: 4000,
      toolCalls: 0,
      memorySignal: "unknown",
      signature: "same-pass",
    },
  ]);
  const highFeedback = scoreEfcRuns([
    {
      status: "success",
      validity: "passing",
      hasOutput: true,
      totalTokens: 1000,
      toolCalls: 1,
      memorySignal: "changed_plan",
      signature: "same-pass-with-tool",
    },
  ]);

  assert.equal(lowFeedback.eventCount, 1);
  assert.equal(highFeedback.eventCount, 1);
  assert.ok(highFeedback.efc > lowFeedback.efc);
  assert.ok(highFeedback.eta > lowFeedback.eta);
});

test("coerceEfcDifficulty supports manual five-factor task labels", () => {
  const score = scoreEfcRuns([
    {
      status: "success",
      validity: "passing",
      hasOutput: true,
      totalTokens: 100,
      toolCalls: 0,
      memorySignal: "written",
    },
  ], {
    difficulty: coerceEfcDifficulty({
      minSteps: 2,
      toolAmbiguity: 3,
      stateTracking: 2,
      observationNoise: 0.5,
      oracleVisibility: 0.25,
    }),
  });

  assert.equal(score.efc, 8.5);
  assert.equal(score.difficulty, 13.5);
  assert.equal(score.normalized, 0.63);
});
