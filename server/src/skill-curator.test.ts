import assert from "node:assert/strict";
import { join } from "node:path";
import test from "node:test";
import {
  buildCurationPrompt,
  buildDescriptionOptimizationEvidence,
  type CuratedSkillContent,
} from "./skill-curator.ts";
import type { SkillEvaluationDetail, SkillRegistryEntry } from "./types.ts";

test("curator includes low activation evidence for description rewrite proposals", () => {
  const workspaceRoot = "/tmp/pi-xanthil-curator-test";
  const skillPath = join(workspaceRoot, ".pi", "skills", "market-sizing", "SKILL.md");
  const skillContents: CuratedSkillContent[] = [
    {
      name: "market-sizing",
      path: skillPath,
      content: [
        "---",
        "name: market-sizing",
        "description: Estimate market size.",
        "---",
        "",
        "Use a driver tree and cite assumptions.",
        "",
      ].join("\n"),
    },
  ];
  const registryEntries: SkillRegistryEntry[] = [
    {
      id: "skill-1",
      workspaceId: "workspace-1",
      slug: "market-sizing",
      name: "market-sizing",
      status: "active",
      version: 1,
      supersedesId: null,
      source: "manual",
      score: 0.8,
      activationRate: 0.3,
      usageCount: 0,
      prodInjectedCount: 10,
      prodActivatedCount: 2,
      prodActivationRate: 0.2,
      regressionStatus: "none",
      lastRegressionAt: null,
      regressionReason: null,
      regressionScoreDelta: null,
      regressionActivationDelta: null,
      lastEvaluationId: null,
      originSessionId: null,
      createdAt: 1,
      updatedAt: 1,
    },
  ];
  const evaluation = fakeEvaluation(skillPath);

  const evidence = buildDescriptionOptimizationEvidence({ workspaceRoot, evaluation, skillContents, registryEntries });
  assert.equal(evidence.length, 1);
  assert.equal(evidence[0]?.currentDescription, "Estimate market size.");
  assert.equal(evidence[0]?.prodActivationRate, 0.2);
  assert.equal(evidence[0]?.evalMisses[0]?.taskId, "case-1");

  const prompt = buildCurationPrompt(evaluation, skillContents, workspaceRoot, evidence);
  assert.match(prompt, /description 触发词优化证据/);
  assert.match(prompt, /生产激活率 20% \(2\/10\)/);
  assert.match(prompt, /eval未激活 task=case-1/);
  assert.match(prompt, /优先判断是否只需改 frontmatter 的 description/);
});

function fakeEvaluation(skillPath: string): SkillEvaluationDetail {
  return {
    evaluationId: "eval-1",
    workspaceId: "workspace-1",
    model: "model-a",
    repeat: 1,
    status: "success",
    startedAt: 1,
    endedAt: 2,
    durationSec: 1,
    variants: [
      { id: "baseline", label: "Baseline", skillPaths: [] },
      { id: "skill-1", label: "market-sizing", skillPaths: [skillPath] },
    ],
    tasks: [
      { id: "case-1", prompt: "Estimate TAM/SAM/SOM for a new retail category." },
    ],
    contextPrefix: "",
    variantSummaries: [
      { variantId: "skill-1", variantLabel: "market-sizing", total: 1, success: 1, failed: 0, activationRate: 0, avgDurationSec: 1, avgTotalTokens: 0, avgTotalCost: 0, avgToolCalls: 0, avgOutputChars: 10 },
    ],
    taskSummaries: [
      { taskId: "case-1", total: 1, success: 1, failed: 0, activationRate: 0 },
    ],
    pairwiseSummaries: [],
    results: [
      {
        id: "result-1",
        variantId: "skill-1",
        variantLabel: "market-sizing",
        taskId: "case-1",
        attempt: 1,
        status: "success",
        startedAt: 1,
        endedAt: 2,
        durationSec: 1,
        skillPaths: [skillPath],
        totalTokens: 0,
        totalCost: 0,
        toolCalls: 0,
        outputChars: 10,
        output: "generic answer without invoking the market sizing skill",
        activation: { activated: false, matchedKeywords: [], matchedSkillPaths: [], evidence: [] },
        pairwise: null,
        error: null,
      },
    ],
  };
}
