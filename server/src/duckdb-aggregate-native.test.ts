import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import test from "node:test";
import assert from "node:assert/strict";
import { isNativeToolRunOutput } from "./tool-run-output.ts";

const REPO_ROOT = new URL("../..", import.meta.url).pathname;

function runDuckdbAggregate(inputPath: string, outputPath: string, summaryPath: string, sql: string): void {
  execFileSync(
    "python3",
    [
      "server/tools/duckdb-aggregate/main.py",
      "--input", inputPath,
      "--output", outputPath,
      "--json-summary", summaryPath,
      "--param-sql", sql,
    ],
    { cwd: REPO_ROOT, encoding: "utf8" },
  );
}

test("duckdb-aggregate native output: TSV input", () => {
  const dir = mkdtempSync(join(tmpdir(), "duckdb-native-tsv-"));
  const input = join(dir, "input.tsv");
  const output = join(dir, "out");
  const summary = join(dir, "summary.json");
  writeFileSync(input, "name\tamount\nAlice\t100\nBob\t200\n");

  runDuckdbAggregate(input, output, summary, "SELECT name, SUM(amount) AS total FROM input_data GROUP BY name");

  const parsed = JSON.parse(readFileSync(summary, "utf8")) as unknown;
  assert.ok(isNativeToolRunOutput(parsed), "summary.json should be native ToolRunOutput");
  const out = parsed as { status: string; sourceFile?: string; metrics: unknown[]; artifacts: unknown[] };
  assert.equal(out.status, "success");
  assert.ok(out.metrics.length >= 3);
  assert.ok(out.artifacts.length >= 2);
});

test("duckdb-aggregate native output: directory with multiple CSVs", () => {
  const dir = mkdtempSync(join(tmpdir(), "duckdb-native-dir-"));
  const inputDir = join(dir, "data");
  const output = join(dir, "out");
  const summary = join(dir, "summary.json");
  mkdirSync(inputDir, { recursive: true });
  writeFileSync(join(inputDir, "a.csv"), "name,amount\nAlice,100\n");
  writeFileSync(join(inputDir, "b.csv"), "name,amount\nBob,200\n");

  runDuckdbAggregate(inputDir, output, summary, "SELECT name, SUM(amount) AS total FROM input_data GROUP BY name");

  const parsed = JSON.parse(readFileSync(summary, "utf8")) as unknown;
  assert.ok(isNativeToolRunOutput(parsed), "summary.json should be native ToolRunOutput");
  const out = parsed as { status: string; metrics: unknown[]; artifacts: unknown[] };
  assert.equal(out.status, "success");
  assert.ok(out.metrics.length >= 3);
  assert.ok(out.artifacts.length >= 2);
});
