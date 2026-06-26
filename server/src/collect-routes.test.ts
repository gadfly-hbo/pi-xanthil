import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";

const testRoot = mkdtempSync(join(tmpdir(), "collect-routes-"));
process.env.XANTHIL_DATA_DIR = testRoot;

const { engineRouter } = await import("./routes/engine.ts");

function serve() {
  const app = express();
  app.use(express.json());
  app.use(engineRouter);
  const server = app.listen(0);
  const { port } = server.address() as AddressInfo;
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    close: () => new Promise<void>((resolve, reject) => server.close((err) => err ? reject(err) : resolve())),
  };
}

async function requestJson<T>(baseUrl: string, path: string, init?: RequestInit): Promise<{ status: number; body: T }> {
  const res = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
  });
  return { status: res.status, body: await res.json() as T };
}

test("collect folder routes manage CRUD and session grouping", async () => {
  const srv = serve();
  try {
    const created = await requestJson<{ id: string; name: string; sort: number }>(srv.baseUrl, "/api/collect/folders", {
      method: "POST",
      body: JSON.stringify({ name: "方法论" }),
    });
    assert.equal(created.status, 200);
    assert.equal(created.body.name, "方法论");

    const session = await requestJson<{ id: string; collectFolderId: string | null }>(srv.baseUrl, "/api/collect/sessions", {
      method: "POST",
      body: JSON.stringify({ title: "联网收集", folderId: created.body.id }),
    });
    assert.equal(session.status, 200);
    assert.equal(session.body.collectFolderId, created.body.id);

    const renamed = await requestJson<{ id: string; name: string; sort: number }>(srv.baseUrl, `/api/collect/folders/${created.body.id}`, {
      method: "PATCH",
      body: JSON.stringify({ name: "分析方法论", sort: 7 }),
    });
    assert.equal(renamed.status, 200);
    assert.equal(renamed.body.name, "分析方法论");
    assert.equal(renamed.body.sort, 7);

    const unfiled = await requestJson<{ collectFolderId: string | null }>(srv.baseUrl, `/api/collect/sessions/${session.body.id}`, {
      method: "PATCH",
      body: JSON.stringify({ folderId: null }),
    });
    assert.equal(unfiled.status, 200);
    assert.equal(unfiled.body.collectFolderId, null);

    const refiled = await requestJson<{ collectFolderId: string | null }>(srv.baseUrl, `/api/collect/sessions/${session.body.id}`, {
      method: "PATCH",
      body: JSON.stringify({ folderId: created.body.id }),
    });
    assert.equal(refiled.status, 200);
    assert.equal(refiled.body.collectFolderId, created.body.id);

    const deleted = await requestJson<{ ok: boolean }>(srv.baseUrl, `/api/collect/folders/${created.body.id}`, { method: "DELETE" });
    assert.equal(deleted.status, 200);
    assert.equal(deleted.body.ok, true);

    const sessions = await requestJson<Array<{ id: string; collectFolderId: string | null }>>(srv.baseUrl, "/api/collect/sessions");
    assert.equal(sessions.status, 200);
    assert.equal(sessions.body.find((item) => item.id === session.body.id)?.collectFolderId, null);
  } finally {
    await srv.close();
  }
});

test("collect routes reject unknown folder assignment", async () => {
  const srv = serve();
  try {
    const created = await requestJson<{ id: string }>(srv.baseUrl, "/api/collect/sessions", {
      method: "POST",
      body: JSON.stringify({ title: "待归类" }),
    });
    assert.equal(created.status, 200);

    const missingOnCreate = await requestJson<{ error: string }>(srv.baseUrl, "/api/collect/sessions", {
      method: "POST",
      body: JSON.stringify({ title: "坏归类", folderId: "missing-folder" }),
    });
    assert.equal(missingOnCreate.status, 404);

    const missingOnPatch = await requestJson<{ error: string }>(srv.baseUrl, `/api/collect/sessions/${created.body.id}`, {
      method: "PATCH",
      body: JSON.stringify({ folderId: "missing-folder" }),
    });
    assert.equal(missingOnPatch.status, 404);
  } finally {
    await srv.close();
  }
});
