import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  inferColumnTypes,
  sanitizeIdentifier,
  quoteIdent,
  importRowsToDb,
  exportTableQuery,
  rowsToCsv,
  rowsToJson,
  validateSql,
  getSchema,
  buildCreateTableSql,
  type SqlConnection,
} from "./sql-connections.ts";

function mkConn(filePath: string): SqlConnection {
  return {
    id: "test",
    name: "test-sqlite",
    type: "sqlite",
    filePath,
    createdAt: Date.now(),
  };
}

test("sanitizeIdentifier strips bad chars and prefixes leading-digit table", () => {
  assert.equal(sanitizeIdentifier("foo bar", "table"), "foo_bar");
  assert.equal(sanitizeIdentifier("2024sales", "table"), "t_2024sales");
  assert.equal(sanitizeIdentifier("销售额", "column"), "销售额");
  assert.equal(sanitizeIdentifier("a-b;c", "column"), "a_b_c");
});

test("quoteIdent escapes inner quotes", () => {
  assert.equal(quoteIdent('na"me'), '"na""me"');
});

test("inferColumnTypes infers INTEGER/REAL/TEXT", () => {
  const rows = [
    { a: 1, b: 1.5, c: "hello", d: "true" },
    { a: 2, b: 2.5, c: "world", d: "false" },
  ];
  const cols = inferColumnTypes(rows);
  const m = new Map(cols.map((c) => [c.name, c.type]));
  assert.equal(m.get("a"), "INTEGER");
  assert.equal(m.get("b"), "REAL");
  assert.equal(m.get("c"), "TEXT");
  assert.equal(m.get("d"), "INTEGER"); // bool-as-int
});

test("buildCreateTableSql produces quoted DDL", () => {
  const sql = buildCreateTableSql("orders", [
    { name: "id", type: "INTEGER" },
    { name: "amount", type: "REAL" },
  ]);
  assert.equal(sql, 'CREATE TABLE "orders" ("id" INTEGER, "amount" REAL)');
});

test("validateSql rejects DDL/DML", () => {
  assert.equal(validateSql("SELECT * FROM t LIMIT 10").safe, true);
  assert.equal(validateSql("DROP TABLE t").safe, false);
  assert.equal(validateSql("INSERT INTO t VALUES (1)").safe, false);
  assert.equal(validateSql("UPDATE t SET x=1").safe, false);
});

test("smoke: preview → commit → schema → query → export (SQLite)", async () => {
  const dir = mkdtempSync(join(tmpdir(), "pix-sql-test-"));
  const dbPath = join(dir, "test.db");
  try {
    const conn = mkConn(dbPath);
    const rows = [
      { name: "Alice", age: 30, score: 95.5 },
      { name: "Bob", age: 25, score: 88.0 },
      { name: "Carol", age: 35, score: 92.3 },
    ];

    // 1. preview
    const cols = inferColumnTypes(rows);
    assert.equal(cols.length, 3);
    const nameCol = cols.find((c) => c.name === "name")!;
    assert.equal(nameCol.type, "TEXT");

    // 2. commit (create)
    const result = importRowsToDb(conn, "members", cols, rows, "create");
    assert.equal(result.rowCount, 3);
    assert.ok(existsSync(dbPath));

    // 3. schema sees new table
    const tables = await getSchema(conn);
    assert.equal(tables.length, 1);
    assert.equal(tables[0]!.name, "members");
    assert.equal(tables[0]!.columns.length, 3);

    // 4. query
    const exported = await exportTableQuery(conn, "members");
    assert.equal(exported.rows.length, 3);
    assert.equal(exported.columns.length, 3);

    // 5. append
    const appendResult = importRowsToDb(
      conn,
      "members",
      cols,
      [{ name: "Dave", age: 28, score: 77 }],
      "append",
    );
    assert.equal(appendResult.rowCount, 1);
    const afterAppend = await exportTableQuery(conn, "members");
    assert.equal(afterAppend.rows.length, 4);

    // 6. export CSV/JSON
    const csv = rowsToCsv(exported.columns, exported.rows);
    assert.ok(csv.includes("Alice"));
    assert.ok(csv.startsWith("name,age,score"));
    const json = rowsToJson(exported.columns, exported.rows);
    const parsed = JSON.parse(json);
    assert.equal(parsed.length, 3);

    // 7. export via SELECT
    const queryExport = await exportTableQuery(conn, "SELECT name FROM members WHERE age > 28");
    assert.equal(queryExport.columns.length, 1);
    assert.ok(queryExport.rows.length >= 2);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("import rollback on failure", async () => {
  const dir = mkdtempSync(join(tmpdir(), "pix-sql-test-"));
  const dbPath = join(dir, "test.db");
  try {
    const conn = mkConn(dbPath);
    importRowsToDb(conn, "tbl", [{ name: "a", type: "TEXT" }], [], "create");
    // trying to create again should throw
    assert.throws(() => importRowsToDb(conn, "tbl", [{ name: "a", type: "TEXT" }], [{ a: "x" }], "create"));
    // table should still be empty / unaffected
    const { rows } = await exportTableQuery(conn, "tbl");
    assert.equal(rows.length, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("import preserves data when user renames columns (regression: row keys are source names)", async () => {
  const dir = mkdtempSync(join(tmpdir(), "pix-sql-test-"));
  const dbPath = join(dir, "test.db");
  try {
    const conn = mkConn(dbPath);
    // Source rows from a CSV would have keys like "用户名" / "年龄"
    const rows = [
      { "用户名": "Alice", "年龄": 30 },
      { "用户名": "Bob", "年龄": 25 },
    ];
    // User renames columns in UI: 用户名 → name, 年龄 → age
    const columns = [
      { sourceName: "用户名", name: "name", type: "TEXT" },
      { sourceName: "年龄", name: "age", type: "INTEGER" },
    ];
    importRowsToDb(conn, "users", columns, rows, "create");
    const { columns: outCols, rows: outRows } = await exportTableQuery(conn, "users");
    // Table has the renamed columns
    assert.ok(outCols.includes("name"));
    assert.ok(outCols.includes("age"));
    // And the values are filled (NOT null — the bug being fixed)
    assert.equal(outRows.length, 2);
    assert.equal(outRows[0]!.name, "Alice");
    assert.equal(outRows[0]!.age, 30);
    assert.equal(outRows[1]!.name, "Bob");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("import falls back to name when sourceName missing (backward compat)", async () => {
  const dir = mkdtempSync(join(tmpdir(), "pix-sql-test-"));
  const dbPath = join(dir, "test.db");
  try {
    const conn = mkConn(dbPath);
    importRowsToDb(
      conn,
      "t",
      [{ name: "a", type: "TEXT" }], // no sourceName field
      [{ a: "value-a" }],
      "create",
    );
    const { rows } = await exportTableQuery(conn, "t");
    assert.equal(rows[0]!.a, "value-a");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("CSV escaping handles commas/quotes/newlines", () => {
  const csv = rowsToCsv(["a", "b"], [{ a: 'has,comma', b: 'has"quote' }, { a: "line1\nline2", b: null }]);
  const lines = csv.split("\n");
  // header
  assert.equal(lines[0], "a,b");
  // first data row
  assert.ok(lines[1]!.startsWith('"has,comma"'));
  assert.ok(lines[1]!.includes('"has""quote"'));
});

test("sanitizeIdentifier preserves CJK and replaces forbidden ascii", () => {
  // 列名带中文 + 特殊符号
  assert.equal(sanitizeIdentifier("销售-金额(元)", "column"), "销售_金额_元_");
});
