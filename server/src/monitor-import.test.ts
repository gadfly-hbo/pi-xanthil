import assert from "node:assert/strict";
import express from "express";
import { mkdtempSync, existsSync, readFileSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";

process.env.XANTHIL_DATA_DIR = mkdtempSync(join(tmpdir(), "pix-monitor-import-test-"));

const db = await import("./db.ts");
const { upsertConnection } = await import("./sql-connections.ts");
const { dataRouter } = await import("./routes/data.ts");

async function startSrv(): Promise<{ port: number; close: () => Promise<void> }> {
  const app = express();
  app.use(express.json());
  app.use(dataRouter);
  const server = createServer(app);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const addr = server.address() as AddressInfo;
  return {
    port: addr.port,
    close: () => new Promise<void>((r, j) => server.close((e) => (e ? j(e) : r()))),
  };
}

function seed(filePath: string): void {
  const s = new DatabaseSync(filePath);
  s.exec("CREATE TABLE sales (date TEXT, region TEXT, amount REAL)");
  s.exec("INSERT INTO sales VALUES ('2026-01-01','east',100.5)");
  s.exec("INSERT INTO sales VALUES ('2026-01-02','west',200.0)");
  s.exec("INSERT INTO sales VALUES ('2026-01-03','east',300.25)");
  s.close();
}

function mkConnFor(name: string): { ws: ReturnType<typeof db.createWorkspace>; connId: string } {
  const ws = db.createWorkspace(name);
  const srcDir = mkdtempSync(join(tmpdir(), "pix-monitor-src-"));
  const srcDb = join(srcDir, "source.db");
  seed(srcDb);
  const conn = upsertConnection({ name: `src-${name}`, type: "sqlite", filePath: srcDb });
  return { ws, connId: conn.id };
}

const IMPORT_URL = (port: number, wsId: string) =>
  `http://127.0.0.1:${port}/api/workspaces/${wsId}/monitor/import-sql`;

test("import-sql via tableName: file lands in clean_data/monitor + pathId registered", async () => {
  const { ws, connId } = mkConnFor("table-mode");
  const srv = await startSrv();
  try {
    const res = await fetch(IMPORT_URL(srv.port, ws.id), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ connectionId: connId, tableName: "sales", datasetName: "monthly-sales" }),
    });
    assert.equal(res.status, 200);
    const body = (await res.json()) as {
      pathId: string; name: string; path: string; columns: string[]; rowCount: number;
    };
    const expectedDir = resolve(ws.rootPath, "clean_data/monitor");
    assert.ok(body.path.startsWith(expectedDir + "/"), `path ${body.path} not under ${expectedDir}`);
    assert.equal(body.name, "monthly-sales.csv");
    assert.equal(body.rowCount, 3);
    assert.deepEqual([...body.columns].sort(), ["amount", "date", "region"]);
    assert.ok(existsSync(body.path), "csv file should exist");
    const csv = readFileSync(body.path, "utf8");
    assert.ok(csv.includes("east"));
    assert.ok(csv.includes("200"));

    const entry = db.getWorkspacePath(Number(body.pathId));
    assert.ok(entry, "pathId should resolve to a workspace_paths entry");
    assert.equal(entry?.folder, "clean_data");
    assert.equal(entry?.workspaceId, ws.id);
    assert.equal(entry?.path, body.path);
  } finally {
    await srv.close();
  }
});

test("import-sql via SELECT: returns expected rowCount + columns", async () => {
  const { ws, connId } = mkConnFor("sql-mode");
  const srv = await startSrv();
  try {
    const res = await fetch(IMPORT_URL(srv.port, ws.id), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        connectionId: connId,
        sql: "SELECT region, amount FROM sales WHERE amount > 150",
        datasetName: "big-amount",
      }),
    });
    assert.equal(res.status, 200);
    const body = (await res.json()) as { rowCount: number; columns: string[]; name: string };
    assert.equal(body.rowCount, 2);
    assert.deepEqual([...body.columns].sort(), ["amount", "region"]);
    assert.equal(body.name, "big-amount.csv");
  } finally {
    await srv.close();
  }
});

test("import-sql rejects dangerous SQL (DROP/UPDATE/INSERT)", async () => {
  const { ws, connId } = mkConnFor("danger");
  const srv = await startSrv();
  try {
    for (const sql of [
      "DROP TABLE sales",
      "UPDATE sales SET amount=0",
      "INSERT INTO sales VALUES ('x','y',1)",
    ]) {
      const res = await fetch(IMPORT_URL(srv.port, ws.id), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ connectionId: connId, sql, datasetName: "evil" }),
      });
      assert.equal(res.status, 400, `expected dangerous SQL rejected: ${sql}`);
    }
  } finally {
    await srv.close();
  }
});

test("import-sql rejects non-SELECT (EXPLAIN)", async () => {
  const { ws, connId } = mkConnFor("non-select");
  const srv = await startSrv();
  try {
    const res = await fetch(IMPORT_URL(srv.port, ws.id), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        connectionId: connId,
        sql: "EXPLAIN SELECT * FROM sales",
        datasetName: "explain",
      }),
    });
    assert.equal(res.status, 400);
  } finally {
    await srv.close();
  }
});

test("import-sql 404 on missing workspace / connection / table", async () => {
  const { ws, connId } = mkConnFor("missing");
  const srv = await startSrv();
  try {
    let res = await fetch(IMPORT_URL(srv.port, "no-such-ws"), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ connectionId: connId, tableName: "sales", datasetName: "x" }),
    });
    assert.equal(res.status, 404);
    res = await fetch(IMPORT_URL(srv.port, ws.id), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ connectionId: "no-such-conn", tableName: "sales", datasetName: "x" }),
    });
    assert.equal(res.status, 404);
    res = await fetch(IMPORT_URL(srv.port, ws.id), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ connectionId: connId, tableName: "no_such_table", datasetName: "x" }),
    });
    assert.equal(res.status, 404);
  } finally {
    await srv.close();
  }
});

test("import-sql sanitizes datasetName containing path traversal", async () => {
  const { ws, connId } = mkConnFor("sanitize");
  const srv = await startSrv();
  try {
    const res = await fetch(IMPORT_URL(srv.port, ws.id), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ connectionId: connId, tableName: "sales", datasetName: "../escape/evil" }),
    });
    assert.equal(res.status, 200);
    const body = (await res.json()) as { name: string; path: string };
    assert.ok(!body.name.includes(".."), `name must not contain ..: ${body.name}`);
    assert.ok(!body.name.includes("/"), `name must not contain /: ${body.name}`);
    const monitorBase = resolve(ws.rootPath, "clean_data/monitor");
    assert.ok(body.path.startsWith(monitorBase + "/"), `path escaped monitor dir: ${body.path}`);
  } finally {
    await srv.close();
  }
});

test("GET /monitor/imports only returns monitor-dir clean_data, excludes others", async () => {
  const { ws, connId } = mkConnFor("imports-list");
  // 先放一个监测之外的 clean_data 登记（模拟现存其他聚合集）
  db.addWorkspacePath(ws.id, "clean_data", "/tmp/non-monitor-mock.csv", "file");

  const srv = await startSrv();
  try {
    // 导入一条到 monitor/
    const r = await fetch(IMPORT_URL(srv.port, ws.id), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ connectionId: connId, tableName: "sales", datasetName: "list-test" }),
    });
    assert.equal(r.status, 200);

    const listRes = await fetch(
      `http://127.0.0.1:${srv.port}/api/workspaces/${ws.id}/monitor/imports`,
    );
    assert.equal(listRes.status, 200);
    const list = (await listRes.json()) as Array<{ name: string; rowCount: number }>;
    // 只应返回 monitor/ 下的 csv；mock 的非监测条目被过滤
    assert.equal(list.length, 1);
    assert.equal(list[0]!.name, "list-test.csv");
    assert.equal(list[0]!.rowCount, 3);
  } finally {
    await srv.close();
  }
});

test("import-sql with same datasetName creates versioned files instead of overwriting", async () => {
  const { ws, connId } = mkConnFor("versioned");
  const srv = await startSrv();
  try {
    const payload = { connectionId: connId, tableName: "sales", datasetName: "repeat" };
    const r1 = await fetch(IMPORT_URL(srv.port, ws.id), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    const r2 = await fetch(IMPORT_URL(srv.port, ws.id), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    assert.equal(r1.status, 200);
    assert.equal(r2.status, 200);
    const b1 = (await r1.json()) as { name: string; path: string; pathId: string };
    const b2 = (await r2.json()) as { name: string; path: string; pathId: string };
    assert.equal(b1.name, "repeat.csv");
    assert.equal(b2.name, "repeat_2.csv");
    assert.notEqual(b1.path, b2.path);
    assert.notEqual(b1.pathId, b2.pathId);
    assert.ok(existsSync(b1.path));
    assert.ok(existsSync(b2.path));

    const listRes = await fetch(`http://127.0.0.1:${srv.port}/api/workspaces/${ws.id}/monitor/imports`);
    assert.equal(listRes.status, 200);
    const list = (await listRes.json()) as Array<{ name: string }>;
    assert.deepEqual(list.map((x) => x.name).sort(), ["repeat.csv", "repeat_2.csv"]);
  } finally {
    await srv.close();
  }
});
