import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { runToolEvaluation, summarizeToolCases, type ToolEvaluationRunResult } from "./tool-evaluation-runner.ts";
import type { RegisteredExtractionTool } from "../tools/registry.ts";

function fakeTool(rootPath: string): RegisteredExtractionTool {
  const entryPath = join(rootPath, "tool.py");
  writeFileSync(entryPath, "print('unused')\n");
  return {
    id: "fake-tool",
    name: "Fake Tool",
    version: "1.0.0",
    description: "fake",
    entry: "tool.py",
    runtime: "python3",
    input: { accept: [".html"], modes: ["file"] },
    output: [".json"],
    rootPath,
    entryPath,
  };
}

test("runToolEvaluation checks field presence against generated output", async () => {
  const root = mkdtempSync(join(tmpdir(), "pi-xanthil-tool-eval-"));
  const inputPath = join(root, "input.html");
  writeFileSync(inputPath, "<html></html>");
  const summary = await runToolEvaluation({
    evaluationId: "eval-1",
    workspaceId: "workspace-1",
    workspaceRoot: root,
    tool: fakeTool(root),
    repeat: 2,
    cases: [{
      id: "case-a",
      name: "Case A",
      inputPath,
      expected: { kind: "field-presence", jsonPath: "*.json", requiredKeys: ["profile.name"] },
    }],
    runTool: async (options) => {
      writeFileSync(options.summaryPath, JSON.stringify({ success: 1, failed: 0, results: [{ outputs: [] }] }));
      writeFileSync(join(options.outputPath, "profile.json"), JSON.stringify({ profile: { name: "Alice" } }));
      return { code: 0, stdout: "ok", stderr: "" };
    },
  });

  assert.equal(summary.status, "success");
  assert.equal(summary.results.length, 2);
  assert.deepEqual(summary.results.map((result) => result.status), ["success", "success"]);
  assert.equal(summary.caseSummaries[0]?.success, 2);
});

test("runToolEvaluation treats expected validation failure as success", async () => {
  const root = mkdtempSync(join(tmpdir(), "pi-xanthil-tool-eval-"));
  const inputPath = join(root, "input.txt");
  writeFileSync(inputPath, "not html");
  const summary = await runToolEvaluation({
    evaluationId: "eval-2",
    workspaceId: "workspace-1",
    workspaceRoot: root,
    tool: fakeTool(root),
    repeat: 1,
    cases: [{
      id: "bad-input",
      name: "Bad Input",
      inputPath,
      expected: { kind: "must-fail", expectedErrorPattern: "input extension" },
    }],
  });

  assert.equal(summary.status, "success");
  assert.equal(summary.results[0]?.error, null);
});

test("runToolEvaluation validates schema expectation", async () => {
  const root = mkdtempSync(join(tmpdir(), "pi-xanthil-tool-eval-"));
  const inputPath = join(root, "input.html");
  writeFileSync(inputPath, "<html></html>");
  const summary = await runToolEvaluation({
    evaluationId: "eval-schema",
    workspaceId: "workspace-1",
    workspaceRoot: root,
    tool: fakeTool(root),
    repeat: 1,
    cases: [{
      id: "schema-pass",
      name: "Schema Pass",
      inputPath,
      expected: {
        kind: "schema",
        jsonPath: "*.json",
        schema: {
          type: "object",
          required: ["profile", "tags"],
          properties: {
            profile: {
              type: "object",
              required: ["name", "age"],
              properties: { name: { type: "string" }, age: { type: "integer" } },
            },
            tags: { type: "array", items: { type: "string" } },
          },
        },
      },
    }],
    runTool: async (options) => {
      writeFileSync(options.summaryPath, JSON.stringify({ success: 1, failed: 0, results: [{ outputs: [] }] }));
      writeFileSync(join(options.outputPath, "profile.json"), JSON.stringify({ profile: { name: "Alice", age: 3 }, tags: ["a"] }));
      return { code: 0, stdout: "ok", stderr: "" };
    },
  });

  assert.equal(summary.status, "success");
  assert.equal(summary.results[0]?.error, null);
});

test("runToolEvaluation reports schema expectation failures", async () => {
  const root = mkdtempSync(join(tmpdir(), "pi-xanthil-tool-eval-"));
  const inputPath = join(root, "input.html");
  writeFileSync(inputPath, "<html></html>");
  const summary = await runToolEvaluation({
    evaluationId: "eval-schema-fail",
    workspaceId: "workspace-1",
    workspaceRoot: root,
    tool: fakeTool(root),
    repeat: 1,
    cases: [{
      id: "schema-fail",
      name: "Schema Fail",
      inputPath,
      expected: {
        kind: "schema",
        jsonPath: "*.json",
        schema: {
          type: "object",
          required: ["profile"],
          properties: {
            profile: {
              type: "object",
              required: ["age"],
              properties: { age: { type: "integer" } },
            },
          },
        },
      },
    }],
    runTool: async (options) => {
      writeFileSync(options.summaryPath, JSON.stringify({ success: 1, failed: 0, results: [{ outputs: [] }] }));
      writeFileSync(join(options.outputPath, "profile.json"), JSON.stringify({ profile: { age: "3" } }));
      return { code: 0, stdout: "ok", stderr: "" };
    },
  });

  assert.equal(summary.status, "failed");
  assert.match(summary.results[0]?.error?.message ?? "", /schema validation failed/);
  assert.match(summary.results[0]?.error?.message ?? "", /profile.age expected integer/);
});

test("runToolEvaluation compares golden JSON with ignored paths", async () => {
  const root = mkdtempSync(join(tmpdir(), "pi-xanthil-tool-eval-"));
  const inputPath = join(root, "input.html");
  const goldenDir = join(root, "golden");
  mkdirSync(goldenDir);
  writeFileSync(inputPath, "<html></html>");
  writeFileSync(join(goldenDir, "profile.json"), JSON.stringify({
    profile: { name: "Alice", updatedAt: "old" },
    metadata: { generatedAt: "old" },
  }));

  const summary = await runToolEvaluation({
    evaluationId: "eval-golden-json",
    workspaceId: "workspace-1",
    workspaceRoot: root,
    tool: fakeTool(root),
    repeat: 1,
    cases: [{
      id: "golden-json",
      name: "Golden JSON",
      inputPath,
      expected: { kind: "golden", goldenDir, ignorePaths: ["profile.updatedAt", "$.metadata.generatedAt"] },
    }],
    runTool: async (options) => {
      writeFileSync(options.summaryPath, JSON.stringify({ success: 1, failed: 0, results: [{ outputs: [] }] }));
      writeFileSync(join(options.outputPath, "profile.json"), JSON.stringify({
        profile: { name: "Alice", updatedAt: "new" },
        metadata: { generatedAt: "new" },
      }));
      return { code: 0, stdout: "ok", stderr: "" };
    },
  });

  assert.equal(summary.status, "success");
  assert.equal(summary.results[0]?.error, null);
});

test("runToolEvaluation normalizes whitespace for golden text files", async () => {
  const root = mkdtempSync(join(tmpdir(), "pi-xanthil-tool-eval-"));
  const inputPath = join(root, "input.html");
  const goldenDir = join(root, "golden");
  mkdirSync(goldenDir);
  writeFileSync(inputPath, "<html></html>");
  writeFileSync(join(goldenDir, "report.md"), "# Report\n\nA   B\nC\n");

  const summary = await runToolEvaluation({
    evaluationId: "eval-golden-text",
    workspaceId: "workspace-1",
    workspaceRoot: root,
    tool: fakeTool(root),
    repeat: 1,
    cases: [{
      id: "golden-text",
      name: "Golden Text",
      inputPath,
      expected: { kind: "golden", goldenDir, normalizeWhitespace: true },
    }],
    runTool: async (options) => {
      writeFileSync(options.summaryPath, JSON.stringify({ success: 1, failed: 0, results: [{ outputs: [] }] }));
      writeFileSync(join(options.outputPath, "report.md"), "# Report A B C");
      return { code: 0, stdout: "ok", stderr: "" };
    },
  });

  assert.equal(summary.status, "success");
  assert.equal(summary.results[0]?.error, null);
});

test("runToolEvaluation reports concise golden diffs", async () => {
  const root = mkdtempSync(join(tmpdir(), "pi-xanthil-tool-eval-"));
  const inputPath = join(root, "input.html");
  const goldenDir = join(root, "golden");
  mkdirSync(goldenDir);
  writeFileSync(inputPath, "<html></html>");
  writeFileSync(join(goldenDir, "profile.json"), JSON.stringify({ profile: { name: "Alice" } }));

  const summary = await runToolEvaluation({
    evaluationId: "eval-golden-diff",
    workspaceId: "workspace-1",
    workspaceRoot: root,
    tool: fakeTool(root),
    repeat: 1,
    cases: [{
      id: "golden-diff",
      name: "Golden Diff",
      inputPath,
      expected: { kind: "golden", goldenDir },
    }],
    runTool: async (options) => {
      writeFileSync(options.summaryPath, JSON.stringify({ success: 1, failed: 0, results: [{ outputs: [] }] }));
      writeFileSync(join(options.outputPath, "profile.json"), JSON.stringify({ profile: { name: "Bob" } }));
      return { code: 0, stdout: "ok", stderr: "" };
    },
  });

  assert.equal(summary.status, "failed");
  assert.match(summary.results[0]?.error?.message ?? "", /profile\.json/);
  assert.match(summary.results[0]?.error?.message ?? "", /\$\.profile\.name/);
});

test("runToolEvaluation validates llm judge expectation with injected judge", async () => {
  const root = mkdtempSync(join(tmpdir(), "pi-xanthil-tool-eval-"));
  const inputPath = join(root, "input.html");
  writeFileSync(inputPath, "<html></html>");
  const summary = await runToolEvaluation({
    evaluationId: "eval-judge",
    workspaceId: "workspace-1",
    workspaceRoot: root,
    tool: fakeTool(root),
    repeat: 1,
    cases: [{
      id: "judge-pass",
      name: "Judge Pass",
      inputPath,
      expected: { kind: "llm-judge", rubric: "quality", model: "model-a", minScore: 80 },
    }],
    runTool: async (options) => {
      writeFileSync(options.summaryPath, JSON.stringify({ success: 1, failed: 0, results: [{ outputs: [] }] }));
      writeFileSync(join(options.outputPath, "profile.md"), "high quality output");
      return { code: 0, stdout: "ok", stderr: "" };
    },
    judgeOutput: async (options) => {
      assert.match(options.output, /high quality output/);
      assert.equal(options.model, "model-a");
      return { score: 90, details: "good" };
    },
  });

  assert.equal(summary.status, "success");
  assert.equal(summary.results[0]?.error, null);
});

test("runToolEvaluation fails llm judge expectation below minimum score", async () => {
  const root = mkdtempSync(join(tmpdir(), "pi-xanthil-tool-eval-"));
  const inputPath = join(root, "input.html");
  writeFileSync(inputPath, "<html></html>");
  const summary = await runToolEvaluation({
    evaluationId: "eval-judge-fail",
    workspaceId: "workspace-1",
    workspaceRoot: root,
    tool: fakeTool(root),
    repeat: 1,
    cases: [{
      id: "judge-fail",
      name: "Judge Fail",
      inputPath,
      expected: { kind: "llm-judge", rubric: "quality", model: "model-a", minScore: 80 },
    }],
    runTool: async (options) => {
      writeFileSync(options.summaryPath, JSON.stringify({ success: 1, failed: 0, results: [{ outputs: [] }] }));
      writeFileSync(join(options.outputPath, "profile.json"), JSON.stringify({ bad: true }));
      return { code: 0, stdout: "ok", stderr: "" };
    },
    judgeOutput: async () => ({ score: 50, details: "too weak" }),
  });

  assert.equal(summary.status, "failed");
  assert.match(summary.results[0]?.error?.message ?? "", /below minimum/);
  assert.equal(summary.results[0]?.error?.hint, "too weak");
});

test("summarizeToolCases averages successful rows only", () => {
  const rows: ToolEvaluationRunResult[] = [
    row("a", "success", 2),
    row("a", "failed", 10),
    row("b", "success", 4),
  ];
  const summaries = summarizeToolCases(rows);
  assert.equal(summaries.find((item) => item.caseId === "a")?.avgDurationSec, 2);
  assert.equal(summaries.find((item) => item.caseId === "a")?.failed, 1);
});

function row(caseId: string, status: "success" | "failed", durationSec: number): ToolEvaluationRunResult {
  return {
    id: `${caseId}-${status}`,
    caseId,
    caseName: caseId,
    attempt: 1,
    status,
    startedAt: 0,
    endedAt: durationSec * 1000,
    durationSec,
    inputPath: "",
    outputPath: "",
    stdout: "",
    stderr: "",
    summary: null,
    expectation: { kind: "must-fail" },
    error: null,
  };
}
