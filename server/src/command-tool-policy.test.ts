import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

process.env.XANTHIL_DATA_DIR = mkdtempSync(join(tmpdir(), "pi-xanthil-command-tool-policy-test-"));

const { coerceCommand } = await import("./routes/engine.ts");

test("coerceCommand accepts only analysis toolIds", () => {
  const valid = coerceCommand({
    id: "cmd-analysis",
    name: "analysis",
    enabled: true,
    template: "run {{args}}",
    params: [{ key: "path", label: "Path", type: "file", source: "clean_data" }],
    toolIds: ["duckdb-aggregate"],
    source: "custom",
  });
  assert.equal(valid?.toolIds?.[0], "duckdb-aggregate");

  const invalid = coerceCommand({
    id: "cmd-ingestion",
    name: "ingestion",
    enabled: true,
    template: "run {{args}}",
    toolIds: ["extract-tmall-profile"],
    source: "custom",
  });
  assert.equal(invalid, null);
});
