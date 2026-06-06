import assert from "node:assert/strict";
import test from "node:test";
import { parseToolEvaluationCases, parseToolEvaluationRunRequest, resolveToolEvaluationCasePaths } from "./tool-evaluation-api.ts";

test("parseToolEvaluationRunRequest parses tool cases", () => {
  const parsed = parseToolEvaluationRunRequest({
    toolId: "extract-tmall-profile",
    repeat: 2,
    cases: [{
      id: "case-a",
      name: "Case A",
      inputPath: "/tmp/a.html",
      timeoutMs: 1000,
      expected: { kind: "field-presence", jsonPath: "*.json", requiredKeys: ["基本信息.人群名称"] },
    }],
  });

  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;
  assert.equal(parsed.value.toolId, "extract-tmall-profile");
  assert.equal(parsed.value.repeat, 2);
  assert.equal(parsed.value.cases[0]?.expected.kind, "field-presence");
});

test("parseToolEvaluationRunRequest parses llm judge minScore", () => {
  const parsed = parseToolEvaluationRunRequest({
    toolId: "extract-tmall-profile",
    repeat: 1,
    cases: [{
      id: "judge",
      name: "Judge",
      inputPath: "/tmp/a.html",
      expected: { kind: "llm-judge", rubric: "score quality", model: "model-a", minScore: 85 },
    }],
  });

  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;
  const expected = parsed.value.cases[0]?.expected;
  assert.equal(expected?.kind, "llm-judge");
  if (expected?.kind !== "llm-judge") return;
  assert.equal(expected.minScore, 85);
});

test("parseToolEvaluationCases normalizes template cases", () => {
  const cases = parseToolEvaluationCases([
    {
      id: "template-a",
      name: "Template A",
      inputPath: "/tmp/template.html",
      expected: { kind: "golden", goldenDir: "/tmp/golden" },
    },
    {
      id: "ignored",
      inputPath: "",
      expected: { kind: "field-presence", jsonPath: "*.json", requiredKeys: ["profile.name"] },
    },
  ]);

  assert.equal(cases.length, 1);
  assert.equal(cases[0]?.id, "template-a");
  assert.equal(cases[0]?.expected.kind, "golden");
});

test("parseToolEvaluationCases parses golden diff options", () => {
  const cases = parseToolEvaluationCases([{
    id: "golden",
    name: "Golden",
    inputPath: "/tmp/input.html",
    expected: {
      kind: "golden",
      goldenDir: "/tmp/golden",
      ignorePaths: ["updatedAt", "$.metadata.generatedAt"],
      normalizeWhitespace: true,
    },
  }]);

  assert.equal(cases.length, 1);
  const expected = cases[0]?.expected;
  assert.equal(expected?.kind, "golden");
  if (expected?.kind !== "golden") return;
  assert.deepEqual(expected.ignorePaths, ["updatedAt", "$.metadata.generatedAt"]);
  assert.equal(expected.normalizeWhitespace, true);
});

test("resolveToolEvaluationCasePaths resolves template-relative paths", () => {
  const cases = resolveToolEvaluationCasePaths(parseToolEvaluationCases([{
    id: "golden",
    name: "Golden",
    inputPath: "tests/fixtures/input.html",
    expected: { kind: "golden", goldenDir: "tests/golden" },
  }]), "/repo/server/tools/fake-tool");

  assert.equal(cases[0]?.inputPath, "/repo/server/tools/fake-tool/tests/fixtures/input.html");
  const expected = cases[0]?.expected;
  assert.equal(expected?.kind, "golden");
  if (expected?.kind !== "golden") return;
  assert.equal(expected.goldenDir, "/repo/server/tools/fake-tool/tests/golden");
});

test("parseToolEvaluationRunRequest rejects invalid body", () => {
  assert.deepEqual(parseToolEvaluationRunRequest({ repeat: 1, cases: [] }), {
    ok: false,
    error: "toolId required",
  });
  assert.deepEqual(parseToolEvaluationRunRequest({ toolId: "x", repeat: 0, cases: [] }), {
    ok: false,
    error: "repeat must be an integer between 1 and 5",
  });
  assert.deepEqual(parseToolEvaluationRunRequest({ toolId: "x", repeat: 1, cases: [] }), {
    ok: false,
    error: "cases must not be empty",
  });
});
