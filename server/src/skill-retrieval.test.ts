import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";
import test from "node:test";
import { retrieveSkills } from "./skill-retrieval.ts";

function writeSkill(workspaceRoot: string, slug: string, content: string): string {
  const dir = join(workspaceRoot, ".pi", "skills", slug);
  mkdirSync(dir, { recursive: true });
  const skillPath = join(dir, "SKILL.md");
  writeFileSync(skillPath, content, "utf8");
  return skillPath;
}

test("retrieveSkills ranks SKILL.md frontmatter and first-screen summary", () => {
  const workspaceRoot = mkdtempSync(join(tmpdir(), "pi-xanthil-skill-retrieval-test-"));
  const expectedPath = writeSkill(
    workspaceRoot,
    "summary-match",
    [
      "---",
      "name: summary-match",
      "description: Handles xanthilretrievalsummary token from frontmatter",
      "---",
      "",
      "# Summary",
      "",
      "Use this when the xanthilfirstscreen token appears in the task.",
      "",
    ].join("\n"),
  );

  const results = retrieveSkills("xanthilretrievalsummary xanthilfirstscreen", workspaceRoot, 3);

  assert.equal(results[0]?.path, expectedPath);
  assert.match(results[0]?.snippet ?? "", /xanthilretrievalsummary|xanthilfirstscreen/);
});

test("retrieveSkills ignores skill subresource contents and late SKILL.md body", () => {
  const workspaceRoot = mkdtempSync(join(tmpdir(), "pi-xanthil-skill-retrieval-test-"));
  const skillPath = writeSkill(
    workspaceRoot,
    "resource-backed",
    [
      "---",
      "name: resource-backed",
      "description: Uses relative scripts only after activation",
      "---",
      "",
      "Read ./scripts/helper.ts after this skill is activated.",
      "",
      "x ".repeat(3000),
      "xanthillatebodytoken",
      "",
    ].join("\n"),
  );
  const scriptsDir = join(workspaceRoot, ".pi", "skills", "resource-backed", "scripts");
  mkdirSync(scriptsDir, { recursive: true });
  writeFileSync(join(scriptsDir, "helper.ts"), "export const hidden = 'xanthilsubresourcetoken';\n", "utf8");

  assert.equal(retrieveSkills("xanthilsubresourcetoken", workspaceRoot, 3).some((skill) => skill.path === skillPath), false);
  assert.equal(retrieveSkills("xanthillatebodytoken", workspaceRoot, 3).some((skill) => skill.path === skillPath), false);
  assert.equal(retrieveSkills("relative scripts activation", workspaceRoot, 3)[0]?.path, skillPath);
});
