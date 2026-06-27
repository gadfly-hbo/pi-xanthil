import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { resolve } from "node:path";
import { verifyCreatorIsolation, verifyEvaluatorIsolation, createSkillSandbox } from "./skill-sandbox.ts";
import { mkdtempSync, rmSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("skill sandbox isolation", () => {
  const workspaceRoot = resolve("/tmp/test-workspace");

  it("creator cannot access golden_strategy", () => {
    const result = verifyCreatorIsolation(workspaceRoot, [
      resolve(workspaceRoot, "golden_strategy", "test.json"),
    ]);
    assert.equal(result.isolated, false);
    assert.equal(result.violations.length, 1);
  });

  it("creator cannot access validator", () => {
    const result = verifyCreatorIsolation(workspaceRoot, [
      resolve(workspaceRoot, "validator", "rules.json"),
    ]);
    assert.equal(result.isolated, false);
  });

  it("creator can access clean_data", () => {
    const result = verifyCreatorIsolation(workspaceRoot, [
      resolve(workspaceRoot, "clean_data", "report.csv"),
    ]);
    assert.equal(result.isolated, true);
  });

  it("creator can access .pi/skills", () => {
    const result = verifyCreatorIsolation(workspaceRoot, [
      resolve(workspaceRoot, ".pi", "skills", "test", "SKILL.md"),
    ]);
    assert.equal(result.isolated, true);
  });

  it("evaluator cannot write to .pi/skills", () => {
    const result = verifyEvaluatorIsolation(workspaceRoot, [
      resolve(workspaceRoot, ".pi", "skills", "test", "SKILL.md"),
    ]);
    assert.equal(result.isolated, false);
    assert.equal(result.violations.length, 1);
  });

  it("evaluator can write to report dir", () => {
    const result = verifyEvaluatorIsolation(workspaceRoot, [
      resolve(workspaceRoot, "report", "eval.md"),
    ]);
    assert.equal(result.isolated, true);
  });

  it("createSkillSandbox creates separate directories", () => {
    const tmp = mkdtempSync(join(tmpdir(), "sandbox-test-"));
    try {
      const creator = createSkillSandbox(workspaceRoot, "creator", tmp);
      const evaluator = createSkillSandbox(workspaceRoot, "evaluator", tmp);
      assert.notEqual(creator.cwd, evaluator.cwd);
      assert.ok(creator.systemPromptSuffix.includes("Creator"));
      assert.ok(evaluator.systemPromptSuffix.includes("Evaluator"));
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});
