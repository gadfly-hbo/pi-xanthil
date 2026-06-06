import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";
import test from "node:test";
import { detectSkillActivation, extractSkillActivationKeywords } from "./skill-activation.ts";
import type { PiEvent } from "./types.ts";

function makeSkillFile(): string {
  const root = mkdtempSync(join(tmpdir(), "pi-xanthil-skill-activation-test-"));
  const dir = join(root, "brand-preference-leakage-analysis");
  mkdirSync(dir, { recursive: true });
  const skillPath = join(dir, "SKILL.md");
  writeFileSync(
    skillPath,
    [
      "---",
      "name: Brand Preference Leakage Analysis",
      "description: Detect brand leakage in category preference outputs",
      "---",
      "",
      "Use `brand_leakage_score` and 成交偏好泄漏 checks.",
      "",
    ].join("\n"),
    "utf8",
  );
  return skillPath;
}

test("extractSkillActivationKeywords reads frontmatter and distinctive tokens", () => {
  const skillPath = makeSkillFile();

  const keywords = extractSkillActivationKeywords(skillPath);

  assert.ok(keywords.includes("Brand Preference Leakage Analysis"));
  assert.ok(keywords.includes("brand_leakage_score"));
  assert.ok(keywords.includes("成交偏好泄漏"));
});

test("detectSkillActivation matches output keywords", () => {
  const skillPath = makeSkillFile();

  const result = detectSkillActivation({
    skillPaths: [skillPath],
    output: "本次分析计算了 brand_leakage_score，并检查成交偏好泄漏。",
  });

  assert.equal(result.activated, true);
  assert.ok(result.matchedKeywords.includes("brand_leakage_score"));
  assert.equal(result.evidence.some((item) => item.kind === "output_keyword"), true);
});

test("detectSkillActivation matches skill path references in events", () => {
  const skillPath = makeSkillFile();
  const events = [{
    type: "message_end",
    message: { role: "assistant", content: [{ type: "tool_use", input: { path: skillPath } }] },
  }] as unknown as PiEvent[];

  const result = detectSkillActivation({
    skillPaths: [skillPath],
    output: "普通输出",
    events,
  });

  assert.equal(result.activated, true);
  assert.deepEqual(result.matchedSkillPaths, [skillPath]);
});
