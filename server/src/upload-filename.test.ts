import assert from "node:assert/strict";
import test from "node:test";
import { decodeUploadOriginalName } from "./upload-filename.ts";

test("decodeUploadOriginalName restores latin1-decoded Chinese upload names", () => {
  const mojibake = Buffer.from("测试数据.csv", "utf8").toString("latin1");
  assert.equal(decodeUploadOriginalName(mojibake), "测试数据.csv");
});

test("decodeUploadOriginalName keeps safe names unchanged", () => {
  assert.equal(decodeUploadOriginalName("demo-detail.csv"), "demo-detail.csv");
  assert.equal(decodeUploadOriginalName("测试数据.csv"), "测试数据.csv");
});
