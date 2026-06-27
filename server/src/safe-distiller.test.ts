import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// 与 memory-aging-signals.test.ts 同范式：被测模块 import 链触发 db boot；
// 设临时 XANTHIL_DATA_DIR 避免污染真实库。
process.env.XANTHIL_DATA_DIR = mkdtempSync(join(tmpdir(), "safe-distiller-test-"));
const {
  assertSafeInput,
  normalizeSqlSkeleton,
  skeletonSignature,
  distillProposals,
} = await import("./safe-distiller.ts");

test("normalizeSqlSkeleton: 剔除字符串字面量", () => {
  const out = normalizeSqlSkeleton("SELECT * FROM orders WHERE region = 'NA' AND city = '北京'");
  assert.equal(out, "SELECT * FROM orders WHERE region = ? AND city = ?");
});

test("normalizeSqlSkeleton: 剔除数字字面量", () => {
  const out = normalizeSqlSkeleton("SELECT id FROM users WHERE age > 30 AND score >= 0.85");
  assert.equal(out, "SELECT id FROM users WHERE age > ? AND score >= ?");
});

test("normalizeSqlSkeleton: IN (...) 列表压缩为 IN (?)", () => {
  const out = normalizeSqlSkeleton("SELECT * FROM t WHERE id IN (1, 2, 3) AND tag IN ('a','b')");
  assert.equal(out, "SELECT * FROM t WHERE id IN (?) AND tag IN (?)");
});

test("normalizeSqlSkeleton: 空白折叠", () => {
  const out = normalizeSqlSkeleton("  SELECT\n  a,b\n  FROM\n  t  ");
  assert.equal(out, "SELECT a,b FROM t");
});

test("normalizeSqlSkeleton: 同结构不同值产生同 signature", () => {
  const a = normalizeSqlSkeleton("SELECT * FROM o WHERE city = 'A' AND age > 10");
  const b = normalizeSqlSkeleton("SELECT * FROM o WHERE city = 'B' AND age > 99");
  assert.equal(a, b);
  assert.equal(skeletonSignature(a), skeletonSignature(b));
});

test("assertSafeInput: 含 draw_data 字符串 → 抛错", () => {
  assert.throws(() => {
    assertSafeInput({
      workspaceId: "ws1",
      sqlSkeletons: [
        { skeleton: "SELECT * FROM t", target: "/path/to/draw_data/orders.csv", ts: 0 },
      ],
      apiTopology: [],
      reports: [],
    });
  }, /draw_data/);
});

test("assertSafeInput: 含 rows 字段 → 抛错（防 trace.payload 整对象泄漏）", () => {
  // ponytail: 模拟错误调用方塞了 trace.payload 整体（含 rows 字段）进来
  const bad = {
    workspaceId: "ws1",
    sqlSkeletons: [],
    apiTopology: [
      { kind: "sql_query", target: "t", status: "success", ts: 0, rows: [{ id: 1 }] },
    ] as unknown as never,
    reports: [],
  };
  assert.throws(() => {
    assertSafeInput(bad);
  }, /forbidden detail key/);
});

test("assertSafeInput: 合法输入 → 不抛", () => {
  assertSafeInput({
    workspaceId: "ws1",
    sqlSkeletons: [{ skeleton: "SELECT id FROM t WHERE x = ?", target: "conn-a", ts: 0 }],
    apiTopology: [{ kind: "sql_query", target: "conn-a", status: "success", ts: 0 }],
    reports: [{ folder: "report", path: "/ws/report/q.md", summary: "title" }],
  });
});

test("distillProposals: 同骨架 ≥3 次聚合为 1 提案", () => {
  const sql = "SELECT id FROM o WHERE city = ?";
  const proposals = distillProposals({
    workspaceId: "ws1",
    sqlSkeletons: [
      { skeleton: sql, target: "conn-a", ts: 1 },
      { skeleton: sql, target: "conn-a", ts: 2 },
      { skeleton: sql, target: "conn-b", ts: 3 },
    ],
    apiTopology: [{ kind: "sql_query", target: "conn-a", status: "success", ts: 1 }],
    reports: [],
  });
  assert.equal(proposals.length, 1);
  assert.equal(proposals[0]!.evidence.occurrences, 3);
  assert.deepEqual([...proposals[0]!.evidence.targets].sort(), ["conn-a", "conn-b"]);
  assert.match(proposals[0]!.draftBody, /## 查询骨架/);
  assert.match(proposals[0]!.draftBody, /SELECT id FROM o WHERE city/);
});

test("distillProposals: 出现次数 < 阈值不入提案", () => {
  const proposals = distillProposals({
    workspaceId: "ws1",
    sqlSkeletons: [
      { skeleton: "SELECT 1", target: "a", ts: 1 },
      { skeleton: "SELECT 1", target: "a", ts: 2 },
    ],
    apiTopology: [],
    reports: [],
  });
  assert.equal(proposals.length, 0);
});

test("distillProposals: signature 稳定", () => {
  const sql = "SELECT * FROM t WHERE a = ?";
  const sig1 = skeletonSignature(sql);
  const sig2 = skeletonSignature(sql);
  assert.equal(sig1, sig2);
  assert.equal(sig1.length, 16);
});

test("distillProposals: 提案 body 不含原始字面量（红线兜底）", () => {
  // 调用方 normalize 后的骨架已无字面量；这里测渲染层不会反向注入。
  const proposals = distillProposals({
    workspaceId: "ws1",
    sqlSkeletons: [
      { skeleton: "SELECT id FROM o WHERE region = ?", target: "tbl_o", ts: 1 },
      { skeleton: "SELECT id FROM o WHERE region = ?", target: "tbl_o", ts: 2 },
      { skeleton: "SELECT id FROM o WHERE region = ?", target: "tbl_o", ts: 3 },
    ],
    apiTopology: [],
    reports: [
      { folder: "report", path: "/ws/report/q1.md", summary: "regional summary 2026-Q1" },
    ],
  });
  assert.equal(proposals.length, 1);
  const body = proposals[0]!.draftBody;
  // 不应含原 SQL 中可能误入的字面量；reports.summary 经过 slice(120) 截断后允许出现，
  // 但绝不应包含 draw_data 字样（assertSafeInput 已拦）。
  assert.doesNotMatch(body, /draw_data/);
});
