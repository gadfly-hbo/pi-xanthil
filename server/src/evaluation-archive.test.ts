import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";
import test from "node:test";
import { archiveSkillEvaluation, archiveToolEvaluation, listEvaluationArchives } from "./evaluation-archive.ts";
import type { SkillEvaluationDetail, ToolEvaluationDetail } from "./types.ts";

function makeWorkspaceRoot(): string {
  return mkdtempSync(join(tmpdir(), "pi-xanthil-evaluation-archive-test-"));
}

test("archiveSkillEvaluation writes markdown and json reports", () => {
  const root = makeWorkspaceRoot();
  const archived = archiveSkillEvaluation(root, {
    evaluationId: "skill/eval 1",
    workspaceId: "workspace-1",
    model: "model-a",
    repeat: 1,
    status: "success",
    startedAt: 0,
    endedAt: 1000,
    durationSec: 1,
    variants: [{ id: "baseline", label: "Baseline", skillPaths: [] }],
    tasks: [{ id: "task", prompt: "Task" }],
    contextPrefix: "",
    variantSummaries: [{ variantId: "baseline", variantLabel: "Baseline", total: 1, success: 1, failed: 0, activationRate: 0, avgDurationSec: 1, avgTotalTokens: 10, avgTotalCost: 0.01, avgToolCalls: 0, avgOutputChars: 20 }],
    taskSummaries: [{ taskId: "task", total: 1, success: 1, failed: 0, activationRate: 0 }],
    pairwiseSummaries: [],
    results: [],
  } satisfies SkillEvaluationDetail);

  assert.equal(existsSync(archived.markdownPath), true);
  assert.equal(existsSync(archived.jsonPath), true);
  assert.match(readFileSync(archived.markdownPath, "utf8"), /Skill Evaluation Report/);
  assert.equal(JSON.parse(readFileSync(archived.jsonPath, "utf8")).evaluationId, "skill/eval 1");
});

test("archiveToolEvaluation writes markdown and json reports", () => {
  const root = makeWorkspaceRoot();
  const archived = archiveToolEvaluation(root, {
    evaluationId: "tool-eval-1",
    workspaceId: "workspace-1",
    toolId: "fake-tool",
    repeat: 1,
    status: "failed",
    startedAt: 0,
    endedAt: 1000,
    durationSec: 1,
    cases: [{ id: "case", name: "Case", inputPath: "/tmp/input.txt", expected: { kind: "must-fail" } }],
    caseSummaries: [{ caseId: "case", caseName: "Case", total: 1, success: 0, failed: 1, avgDurationSec: 0 }],
    results: [{
      id: "case-1",
      caseId: "case",
      caseName: "Case",
      attempt: 1,
      status: "failed",
      startedAt: 0,
      endedAt: 1000,
      durationSec: 1,
      inputPath: "/tmp/input.txt",
      outputPath: "/tmp/output",
      stdout: "",
      stderr: "boom",
      summary: { success: 0, failed: 1 },
      expectation: { kind: "must-fail" },
      error: { code: "unknown", message: "boom" },
    }],
  } satisfies ToolEvaluationDetail);

  assert.equal(existsSync(archived.markdownPath), true);
  assert.equal(existsSync(archived.jsonPath), true);
  assert.match(readFileSync(archived.markdownPath, "utf8"), /Tool Evaluation Report/);
  assert.equal(JSON.parse(readFileSync(archived.jsonPath, "utf8")).toolId, "fake-tool");
});

test("listEvaluationArchives returns paired archive reports newest first", () => {
  const root = makeWorkspaceRoot();
  archiveSkillEvaluation(root, {
    evaluationId: "skill-eval-1",
    workspaceId: "workspace-1",
    model: "model-a",
    repeat: 1,
    status: "success",
    startedAt: 0,
    endedAt: 1000,
    durationSec: 1,
    variants: [{ id: "baseline", label: "Baseline", skillPaths: [] }],
    tasks: [{ id: "task", prompt: "Task" }],
    contextPrefix: "",
    variantSummaries: [{ variantId: "baseline", variantLabel: "Baseline", total: 1, success: 1, failed: 0, activationRate: 0, avgDurationSec: 1, avgTotalTokens: 10, avgTotalCost: 0.01, avgToolCalls: 0, avgOutputChars: 20 }],
    taskSummaries: [{ taskId: "task", total: 1, success: 1, failed: 0, activationRate: 0 }],
    pairwiseSummaries: [],
    results: [],
  } satisfies SkillEvaluationDetail);
  archiveToolEvaluation(root, {
    evaluationId: "tool-eval-1",
    workspaceId: "workspace-1",
    toolId: "fake-tool",
    repeat: 1,
    status: "success",
    startedAt: 0,
    endedAt: 1000,
    durationSec: 1,
    cases: [{ id: "case", name: "Case", inputPath: "/tmp/input.txt", expected: { kind: "must-fail" } }],
    caseSummaries: [{ caseId: "case", caseName: "Case", total: 1, success: 1, failed: 0, avgDurationSec: 0 }],
    results: [],
  } satisfies ToolEvaluationDetail);

  const archives = listEvaluationArchives(root);

  assert.equal(archives.length, 2);
  assert.deepEqual(new Set(archives.map((item) => item.kind)), new Set(["skill", "tool"]));
  assert.equal(archives.find((item) => item.kind === "skill")?.evaluationId, "skill-eval-1");
  assert.equal(archives.find((item) => item.kind === "tool")?.evaluationId, "tool-eval-1");
  assert.match(archives[0]?.markdownRelPath ?? "", /^evaluations\/archive\//);
  assert.ok((archives[0]?.markdownSize ?? 0) > 0);
  assert.ok((archives[0]?.jsonSize ?? 0) > 0);
});
