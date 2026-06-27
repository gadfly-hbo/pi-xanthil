import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  extractSlowUpdateBlocks,
  checkSlowUpdateIntegrity,
  guardSlowUpdateWrite,
  evaluateStrictGate,
} from "./skill-rewrite-gate.ts";

describe("slow-update guard", () => {
  it("extracts slow-update blocks", () => {
    const content = `---
name: test
---

Some text.

<!-- @slow-update -->
This is protected content.
It spans multiple lines.
<!-- /@slow-update -->

More text.

<!-- @slow-update -->
Another protected block.
<!-- /@slow-update -->

End.`;

    const blocks = extractSlowUpdateBlocks(content);
    assert.equal(blocks.length, 2);
    assert.ok(blocks[0]!.content.includes("This is protected content."));
    assert.ok(blocks[1]!.content.includes("Another protected block."));
  });

  it("extracts zero blocks when none present", () => {
    const content = "Just plain text without slow-update markers.";
    assert.equal(extractSlowUpdateBlocks(content).length, 0);
  });

  it("detects modified slow-update block", () => {
    const original = "<!-- @slow-update -->\nprotected\n<!-- /@slow-update -->";
    const modified = "<!-- @slow-update -->\nchanged\n<!-- /@slow-update -->";
    const result = checkSlowUpdateIntegrity(original, modified);
    assert.equal(result.ok, false);
    assert.ok(result.reason?.includes("modified"));
  });

  it("passes when slow-update blocks are identical", () => {
    const original = "<!-- @slow-update -->\nprotected\n<!-- /@slow-update -->";
    const candidate = "prefix\n<!-- @slow-update -->\nprotected\n<!-- /@slow-update -->\nsuffix";
    const result = checkSlowUpdateIntegrity(original, candidate);
    assert.equal(result.ok, true);
  });

  it("detects block count mismatch", () => {
    const original = "<!-- @slow-update -->\nA\n<!-- /@slow-update -->";
    const candidate = "no blocks here";
    const result = checkSlowUpdateIntegrity(original, candidate);
    assert.equal(result.ok, false);
    assert.ok(result.reason?.includes("count mismatch"));
  });

  it("guardSlowUpdateWrite allows empty original", () => {
    const result = guardSlowUpdateWrite("", "anything");
    assert.equal(result.allowed, true);
  });

  it("guardSlowUpdateWrite rejects modified protected block", () => {
    const original = "<!-- @slow-update -->\nsecret\n<!-- /@slow-update -->";
    const candidate = "<!-- @slow-update -->\nleaked\n<!-- /@slow-update -->";
    const result = guardSlowUpdateWrite(original, candidate);
    assert.equal(result.allowed, false);
  });
});

describe("strict acceptance gate", () => {
  it("accepts when candidate > current", () => {
    const result = evaluateStrictGate(0.9, 0.7);
    assert.equal(result.accepted, true);
  });

  it("rejects when candidate === current (strict)", () => {
    const result = evaluateStrictGate(0.8, 0.8);
    assert.equal(result.accepted, false);
    assert.ok(result.reason?.includes("strictly greater"));
  });

  it("rejects when candidate < current", () => {
    const result = evaluateStrictGate(0.5, 0.8);
    assert.equal(result.accepted, false);
  });

  it("rejects when candidate score is null", () => {
    const result = evaluateStrictGate(null, 0.7);
    assert.equal(result.accepted, false);
  });

  it("accepts when current score is null (no baseline)", () => {
    const result = evaluateStrictGate(0.6, null);
    assert.equal(result.accepted, true);
  });

  it("accepts with small positive delta", () => {
    const result = evaluateStrictGate(0.7001, 0.7);
    assert.equal(result.accepted, true);
  });
});
