/**
 * Importer Evidence-safety / no-leak regression tests (T0014 brief
 * validation): restricted_raw no-read/no-log/no-LLM behavior, and dry-run /
 * failure / manifest outputs that must never contain Evidence content,
 * absolute paths, storage_refs, SQL, stacks, or raw error fragments.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { runImport, type DryRunReport, type ImportCompleted } from "../import/importer.ts";
import { importsDir } from "../import/journal.ts";
import { blobAbsolutePath } from "../persistence/blob-writer.ts";
import {
  MARKERS,
  WORKSPACE_ID,
  assertNoLeak,
  createDonorFixture,
  createTargetRoot,
  fakeWorkspacePort,
  type DonorFixture,
  type TargetRoot,
} from "./import-helpers.ts";

async function withFixtures(
  fn: (source: DonorFixture, target: TargetRoot) => Promise<void>,
): Promise<void> {
  const source = await createDonorFixture();
  const target = await createTargetRoot();
  try {
    await fn(source, target);
  } finally {
    source.cleanup();
    target.cleanup();
  }
}

function baseOptions(source: DonorFixture, target: TargetRoot) {
  return {
    sourceDataRoot: source.root,
    targetDataRoot: target.root,
    targetWorkspaceId: WORKSPACE_ID,
    workspacePort: fakeWorkspacePort(true),
  };
}

test("dry-run output contains no content, paths, refs, hashes, or stacks", async () => {
  await withFixtures(async (source, target) => {
    const result = (await runImport({
      ...baseOptions(source, target),
      dryRun: true,
    })) as DryRunReport;
    assert.equal(result.ok, true);
    const serialized = JSON.stringify(result);
    assertNoLeak(serialized, source);
    assert.ok(!serialized.includes(target.root), "absolute target path leaked");
    // Business text from rows must not appear either.
    assert.ok(!serialized.includes("Donor Project One"));
    assert.ok(!serialized.includes("donor-project-one"));
    assert.ok(!serialized.includes("Analyze donor sales"));
    assert.ok(!serialized.includes("Donor Human"));
  });
});

test("failure output contains no content, paths, refs, hashes, or raw errors", async () => {
  await withFixtures(async (source, target) => {
    // Corrupt a blob to force a hash-mismatch failure.
    const blobPath = join(source.layout.blobsDir, source.blobRefs[0]!.replace("blobs/", ""));
    const { writeFileSync } = await import("node:fs");
    writeFileSync(blobPath, "tampered-content");

    const result = await runImport(baseOptions(source, target));
    const serialized = JSON.stringify(result);
    assertNoLeak(serialized, source);
    assert.ok(!serialized.includes(target.root), "absolute target path leaked");
    assert.equal(result.status, "failed");
    if (result.status === "failed") {
      assert.equal(result.error.code, "blob_hash_mismatch");
      // Fixed safe message only.
      assert.equal(result.error.message, "A source blob's SHA-256 does not match its metadata.");
    }
  });
});

test("completed manifest contains only safe audit fields", async () => {
  await withFixtures(async (source, target) => {
    const result = (await runImport(baseOptions(source, target))) as ImportCompleted;
    assert.equal(result.status, "completed");

    const manifestPath = join(
      importsDir(target.root),
      `import-${result.manifest.attemptId}.manifest.json`,
    );
    const raw = readFileSync(manifestPath, "utf8");
    assertNoLeak(raw, source);
    assert.ok(!raw.includes(target.root), "absolute target path leaked into manifest");
    assert.ok(!raw.includes("Donor Project One"));
    assert.ok(!raw.includes("donor-project-one"));

    const parsed = JSON.parse(raw) as Record<string, unknown>;
    assert.deepEqual(
      Object.keys(parsed).sort(),
      [
        "attemptId",
        "blobCount",
        "blobHashSetDigest",
        "completedAt",
        "deduplicatedBlobCount",
        "manifestVersion",
        "result",
        "sourceFingerprint",
        "startedAt",
        "tableCounts",
        "targetWorkspaceId",
      ].sort(),
    );
  });
});

test("restricted_raw bytes transfer opaquely and never appear in any output", async () => {
  await withFixtures(async (source, target) => {
    const dryResult = (await runImport({
      ...baseOptions(source, target),
      dryRun: true,
    })) as DryRunReport;
    assert.equal(dryResult.ok, true);
    assert.ok(!JSON.stringify(dryResult).includes(MARKERS.restrictedRaw));
    assert.ok(!JSON.stringify(dryResult).includes(MARKERS.controlled));

    const result = (await runImport(baseOptions(source, target))) as ImportCompleted;
    assert.equal(result.status, "completed");
    assert.ok(!JSON.stringify(result).includes(MARKERS.restrictedRaw));
    assert.ok(!JSON.stringify(result).includes(MARKERS.controlled));

    // Byte-exact transfer of the restricted blob (verified test-side only).
    const restrictedRef = source.blobRefs[6]!;
    const targetBytes = readFileSync(blobAbsolutePath(target.layout.blobsDir, restrictedRef));
    const sourceBytes = readFileSync(blobAbsolutePath(source.layout.blobsDir, restrictedRef));
    assert.deepEqual(targetBytes, sourceBytes);
    assert.ok(targetBytes.includes(Buffer.from(MARKERS.restrictedRaw)));

    // Manifest on disk also clean.
    const manifestRaw = readFileSync(
      join(importsDir(target.root), `import-${result.manifest.attemptId}.manifest.json`),
      "utf8",
    );
    assert.ok(!manifestRaw.includes(MARKERS.restrictedRaw));
    assert.ok(!manifestRaw.includes(MARKERS.controlled));
  });
});

test("importer module has no LLM / Engine / HTTP / exploration dependencies", () => {
  const importDir = join(import.meta.dirname, "..", "import");
  const forbidden = [
    "fetch(",
    "XMLHttpRequest",
    "/api/",
    "openai",
    "anthropic",
    "runPiTurn",
    "runPiPrompt",
    "pi-adapter",
    "EngineHandler",
    "engine-handler",
    "duckdb",
    "DataExploration",
  ];
  for (const file of readdirSync(importDir)) {
    if (!file.endsWith(".ts")) continue;
    const text = readFileSync(join(importDir, file), "utf8");
    for (const marker of forbidden) {
      assert.ok(
        !text.toLowerCase().includes(marker.toLowerCase()),
        `${file} contains forbidden dependency marker: ${marker}`,
      );
    }
  }
});
