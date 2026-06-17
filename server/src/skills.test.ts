import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";
import test from "node:test";
import { parseRequestedSkillPaths, validateSkillPaths } from "./skills.ts";

function makeWorkspaceWithSkill(): { workspaceRoot: string; availableSkill: string; unavailableSkill: string } {
  const workspaceRoot = mkdtempSync(join(tmpdir(), "pi-xanthil-skills-test-"));
  const availableDir = join(workspaceRoot, ".pi", "skills", "available");
  const unavailableDir = join(workspaceRoot, ".pi", "skills", "unavailable");
  mkdirSync(availableDir, { recursive: true });
  mkdirSync(unavailableDir, { recursive: true });
  const availableSkill = join(availableDir, "SKILL.md");
  const unavailableSkill = join(unavailableDir, "SKILL.md");
  writeFileSync(
    availableSkill,
    [
      "---",
      "name: available",
      "description: Available test skill",
      "---",
      "",
      "Use this skill in tests.",
      "",
    ].join("\n"),
    "utf8",
  );
  writeFileSync(
    unavailableSkill,
    [
      "---",
      "name: unavailable",
      "---",
      "",
      "This skill is missing description and should be unavailable.",
      "",
    ].join("\n"),
    "utf8",
  );
  return { workspaceRoot, availableSkill, unavailableSkill };
}

test("validateSkillPaths keeps undefined skill selection unchanged", () => {
  const { workspaceRoot } = makeWorkspaceWithSkill();

  assert.equal(validateSkillPaths(workspaceRoot), undefined);
});

test("validateSkillPaths defaults to strict mode and deduplicates available skills", () => {
  const { workspaceRoot, availableSkill } = makeWorkspaceWithSkill();

  assert.deepEqual(validateSkillPaths(workspaceRoot, [availableSkill, availableSkill]), [availableSkill]);
  assert.throws(
    () => validateSkillPaths(workspaceRoot, [availableSkill, join(workspaceRoot, "missing", "SKILL.md")]),
    /skill is not available:/,
  );
});

test("validateSkillPaths lenient mode filters unavailable and unknown skills", () => {
  const { workspaceRoot, availableSkill, unavailableSkill } = makeWorkspaceWithSkill();

  const result = validateSkillPaths(
    workspaceRoot,
    [unavailableSkill, availableSkill, join(workspaceRoot, "missing", "SKILL.md"), availableSkill],
    { mode: "lenient" },
  );

  assert.deepEqual(result, [availableSkill]);
});

test("parseRequestedSkillPaths resolves the three-state skillPaths contract", () => {
  const { workspaceRoot, availableSkill } = makeWorkspaceWithSkill();

  // undefined → 继承（pi 默认策略）
  assert.equal(parseRequestedSkillPaths(workspaceRoot, undefined), undefined);
  // [] → 禁用
  assert.deepEqual(parseRequestedSkillPaths(workspaceRoot, []), []);
  // 非空 → 校验后的子集（去重）
  assert.deepEqual(parseRequestedSkillPaths(workspaceRoot, [availableSkill, availableSkill]), [availableSkill]);
  // strict（默认）下含不可用 skill → 抛错
  assert.throws(
    () => parseRequestedSkillPaths(workspaceRoot, [join(workspaceRoot, "missing", "SKILL.md")]),
    /skill is not available:/,
  );
  // 非数组 / 非字符串数组 → 抛错
  assert.throws(() => parseRequestedSkillPaths(workspaceRoot, "not-an-array"), /skillPaths must be a string array/);
  assert.throws(() => parseRequestedSkillPaths(workspaceRoot, [123]), /skillPaths must be a string array/);
});
