/**
 * Tests for content-addressed blob writer.
 * Contract: temp file + hash verify + atomic rename, dedup, controlled storageRef.
 */
import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import {
  writeBlob,
  writeCanonicalJsonBlob,
  readBlob,
  verifyBlob,
  blobStorageRef,
  BlobWriterError,
} from "../persistence/blob-writer.ts";
import { sha256HexBytes } from "../persistence/sha256.ts";
import { createTempDataRoot, type TempDataRoot } from "./persistence-helpers.ts";
import { existsSync } from "node:fs";
import { join } from "node:path";

let temp: TempDataRoot;

beforeEach(() => {
  temp = createTempDataRoot();
});

afterEach(() => {
  temp.cleanup();
});

describe("writeBlob - basic write", () => {
  test("writes content and returns correct metadata", () => {
    const content = new TextEncoder().encode("hello world");
    const result = writeBlob(temp.layout.blobsDir, temp.layout.tmpDir,content);

    assert.equal(result.contentSha256, sha256HexBytes(content));
    assert.equal(result.byteSize, content.length);
    assert.equal(result.deduplicated, false);
    assert.match(result.storageRef, /^blobs\/[0-9a-f]{2}\/[0-9a-f]{64}$/);
  });

  test("blob file exists at controlled path", () => {
    const content = new TextEncoder().encode("test data");
    const result = writeBlob(temp.layout.blobsDir, temp.layout.tmpDir,content);

    const blobPath = join(temp.layout.blobsDir, result.storageRef.slice("blobs/".length));
    assert.ok(existsSync(blobPath), "blob file should exist");
  });

  test("storageRef is controlled relative reference", () => {
    const content = new TextEncoder().encode("x");
    const result = writeBlob(temp.layout.blobsDir, temp.layout.tmpDir,content);

    assert.ok(result.storageRef.startsWith("blobs/"), "must start with 'blobs/'");
    assert.ok(!result.storageRef.startsWith("/"), "must not be absolute");
  });
});

describe("writeBlob - deduplication", () => {
  test("same content reuses existing blob", () => {
    const content = new TextEncoder().encode("same content");
    const r1 = writeBlob(temp.layout.blobsDir, temp.layout.tmpDir,content);
    const r2 = writeBlob(temp.layout.blobsDir, temp.layout.tmpDir,content);

    assert.equal(r1.storageRef, r2.storageRef, "same storageRef");
    assert.equal(r1.contentSha256, r2.contentSha256, "same hash");
    assert.equal(r2.deduplicated, true, "second write should be deduplicated");
    assert.equal(r1.deduplicated, false, "first write should not be deduplicated");
  });

  test("different content gets different storageRef", () => {
    const c1 = new TextEncoder().encode("content one");
    const c2 = new TextEncoder().encode("content two");
    const r1 = writeBlob(temp.layout.blobsDir, temp.layout.tmpDir,c1);
    const r2 = writeBlob(temp.layout.blobsDir, temp.layout.tmpDir,c2);

    assert.notEqual(r1.storageRef, r2.storageRef);
    assert.notEqual(r1.contentSha256, r2.contentSha256);
  });
});

describe("writeBlob - hash verification", () => {
  test("expected hash matches actual", () => {
    const content = new TextEncoder().encode("verified");
    const expectedHash = sha256HexBytes(content);
    const result = writeBlob(temp.layout.blobsDir, temp.layout.tmpDir,content, expectedHash);
    assert.equal(result.contentSha256, expectedHash);
  });

  test("mismatched expected hash throws", () => {
    const content = new TextEncoder().encode("actual");
    const wrongHash = "0".repeat(64);
    assert.throws(
      () => writeBlob(temp.layout.blobsDir, temp.layout.tmpDir,content, wrongHash),
      BlobWriterError,
    );
  });
});

describe("writeCanonicalJsonBlob", () => {
  test("writes canonical JSON as blob", () => {
    const obj = { b: 2, a: 1 };
    const result = writeCanonicalJsonBlob(temp.layout.blobsDir, temp.layout.tmpDir,obj);

    // Read back and verify
    const content = readBlob(temp.layout.blobsDir, result.storageRef);
    const text = new TextDecoder().decode(content);
    assert.equal(text, '{"a":1,"b":2}', "canonical JSON should be sorted");
  });

  test("different key insertion order produces same blob", () => {
    const obj1 = { z: 1, a: 2 };
    const obj2 = { a: 2, z: 1 };

    const r1 = writeCanonicalJsonBlob(temp.layout.blobsDir, temp.layout.tmpDir,obj1);
    const r2 = writeCanonicalJsonBlob(temp.layout.blobsDir, temp.layout.tmpDir,obj2);

    assert.equal(r1.storageRef, r2.storageRef, "same blob");
    assert.equal(r2.deduplicated, true);
  });
});

describe("readBlob", () => {
  test("reads back written content", () => {
    const content = new TextEncoder().encode("read me back");
    const result = writeBlob(temp.layout.blobsDir, temp.layout.tmpDir,content);
    const read = readBlob(temp.layout.blobsDir, result.storageRef);
    assert.deepEqual(read, content);
  });

  test("throws for non-existent blob", () => {
    assert.throws(
      () => readBlob(temp.layout.blobsDir, "blobs/ab/abcd1234"),
      BlobWriterError,
    );
  });
});

describe("verifyBlob", () => {
  test("returns true for correct hash", () => {
    const content = new TextEncoder().encode("verify me");
    const result = writeBlob(temp.layout.blobsDir, temp.layout.tmpDir,content);
    assert.ok(verifyBlob(temp.layout.blobsDir, result.storageRef, result.contentSha256));
  });

  test("returns false for wrong hash", () => {
    const content = new TextEncoder().encode("verify me");
    const result = writeBlob(temp.layout.blobsDir, temp.layout.tmpDir,content);
    assert.ok(!verifyBlob(temp.layout.blobsDir, result.storageRef, "f".repeat(64)));
  });

  test("returns false for missing blob", () => {
    assert.ok(!verifyBlob(temp.layout.blobsDir, "blobs/ab/abcd", "0".repeat(64)));
  });
});

describe("blobStorageRef", () => {
  test("rejects invalid hash", () => {
    assert.throws(() => blobStorageRef("invalid"), BlobWriterError);
    assert.throws(() => blobStorageRef("ABC123"), BlobWriterError);
  });

  test("produces sharded path", () => {
    const ref = blobStorageRef("abcdef0123456789".repeat(4));
    assert.equal(ref, "blobs/ab/abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789");
  });
});

describe("blob integrity - no runtime data in repo", () => {
  test("all blobs under temp data root", () => {
    const content = new TextEncoder().encode("in temp");
    const result = writeBlob(temp.layout.blobsDir, temp.layout.tmpDir,content);
    assert.ok(result.storageRef.startsWith("blobs/"));
    assert.ok(temp.layout.blobsDir.includes("xanthil-analysis-projects-test-"));
  });
});
