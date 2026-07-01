import assert from "node:assert/strict";
import express from "express";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { BiCell, HealthSuite, MonitorConfig, MonitorMetricSystemDraft } from "./types.ts";

async function getFreePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as AddressInfo).port;
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  return port;
}

process.env.XANTHIL_DATA_DIR = mkdtempSync(join(tmpdir(), "pix-monitor-watchlist-test-"));
process.env.XANTHIL_PORT = String(await getFreePort());

const db = await import("./db.ts");
const engineDb = await import("./db/engine.ts");
const { engineRouter } = await import("./routes/engine.ts");

type AggregationStub = { pathId: string; columns: string[]; rows: Array<Record<string, BiCell>> };
const aggregationsByWorkspace = new Map<string, AggregationStub[]>();
const legacyConfigs = new Map<string, MonitorConfig | null>();

function jsonPost(body: unknown): RequestInit {
  return { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) };
}

function jsonPatch(body: unknown): RequestInit {
  return { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(body) };
}

function makeMetricSystem(sourcePathId = "ds-source", targetPathId = "ds-goal"): MonitorMetricSystemDraft {
  return {
    metrics: [
      {
        name: "revenue",
        description: "收入",
        formula: "",
        unit: "元",
        objectIds: [],
        bindings: [{ metricId: "revenue", datasetPathId: sourcePathId, valueColumn: "revenue", targetMetricId: "target_revenue" }],
        confidence: 0.9,
      },
      {
        name: "target_revenue",
        description: "收入目标",
        formula: "",
        unit: "元",
        objectIds: [],
        bindings: [{ metricId: "target_revenue", datasetPathId: targetPathId, valueColumn: "revenue" }],
        confidence: 0.9,
      },
    ],
    dependencies: [],
    monitorRules: [],
    assumptions: [],
    missingData: [],
  };
}

function seedWorkspace(name: string): ReturnType<typeof db.createWorkspace> {
  const ws = db.createWorkspace(name);
  aggregationsByWorkspace.set(ws.id, [
    { pathId: "ds-source", columns: ["revenue"], rows: [{ revenue: 80 as unknown as BiCell }] },
    { pathId: "ds-goal", columns: ["revenue"], rows: [{ revenue: 100 as unknown as BiCell }] },
  ]);
  legacyConfigs.set(ws.id, null);
  return ws;
}

async function startServer(): Promise<{ baseUrl: string; close: () => Promise<void> }> {
  const app = express();
  app.use(express.json());
  app.get("/api/bi/aggregations", (req, res) => {
    const workspaceId = String(req.query.workspaceId ?? "");
    res.json((aggregationsByWorkspace.get(workspaceId) ?? []).map((item) => ({ pathId: item.pathId })));
  });
  app.get("/api/bi/aggregations/:pathId/data", (req, res) => {
    const pathId = req.params.pathId;
    const found = Array.from(aggregationsByWorkspace.values()).flat().find((item) => item.pathId === pathId);
    if (!found) { res.status(404).json({ error: "not found" }); return; }
    res.json({ columns: found.columns, rows: found.rows });
  });
  app.get("/api/workspaces/:id/monitor/config", (req, res) => {
    res.json(legacyConfigs.get(req.params.id) ?? null);
  });
  app.get("/api/workspaces/:id/monitor/target-plans/:planId", (_req, res) => {
    res.status(404).json({ error: "target plan not found" });
  });
  app.get("/api/workspaces/:id/ontologies", (_req, res) => res.json([]));
  app.get("/api/workspaces/:id/metrics", (_req, res) => res.json([]));
  app.use(engineRouter);
  const server = createServer(app);
  await new Promise<void>((resolve) => server.listen(Number(process.env.XANTHIL_PORT), "127.0.0.1", resolve));
  return {
    baseUrl: `http://127.0.0.1:${process.env.XANTHIL_PORT}`,
    close: () => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())),
  };
}

const server = await startServer();
test.after(async () => {
  await server.close();
});

test("watchlist CRUD: create/list/update/archive", async () => {
  const ws = seedWorkspace("watchlist-crud");
  const createdRes = await fetch(`${server.baseUrl}/api/workspaces/${ws.id}/monitor/watchlists`, jsonPost({
    name: "日常经营",
    type: "daily",
    suite: "daily",
    datasetBindings: [{ datasetPathId: "ds-source", role: "source", label: "经营数据" }],
    goalDatasetPathId: "ds-goal",
  }));
  assert.equal(createdRes.status, 200);
  const created = await createdRes.json() as { id: string; name: string; type: string; goalDatasetPathId?: string };
  assert.notEqual(created.id, "default");
  assert.equal(created.name, "日常经营");
  assert.equal(created.goalDatasetPathId, "ds-goal");

  const listRes = await fetch(`${server.baseUrl}/api/workspaces/${ws.id}/monitor/watchlists`);
  const list = await listRes.json() as Array<{ id: string; name: string }>;
  assert.equal(list.length, 1);
  assert.equal(list[0]?.id, created.id);

  const updatedRes = await fetch(`${server.baseUrl}/api/workspaces/${ws.id}/monitor/watchlists/${created.id}`, jsonPatch({
    name: "日常经营更新",
    thresholds: { gapTargetWarn: 0.05, ignored: "bad" },
  }));
  assert.equal(updatedRes.status, 200);
  const updated = await updatedRes.json() as { name: string; thresholds?: Record<string, number> };
  assert.equal(updated.name, "日常经营更新");
  assert.deepEqual(updated.thresholds, { gapTargetWarn: 0.05 });

  const archiveRes = await fetch(`${server.baseUrl}/api/workspaces/${ws.id}/monitor/watchlists/${created.id}`, { method: "DELETE" });
  assert.equal(archiveRes.status, 200);
  const archived = await archiveRes.json() as { status: string; archivedAt: number | null };
  assert.equal(archived.status, "archived");
  assert.ok(archived.archivedAt);
});

test("watchlist create rejects pathIds outside workspace clean_data", async () => {
  const ws = seedWorkspace("watchlist-invalid-path");
  const beforeRuns = engineDb.listMonitorRuns(ws.id).length;
  const res = await fetch(`${server.baseUrl}/api/workspaces/${ws.id}/monitor/watchlists`, jsonPost({
    name: "非法计划",
    datasetBindings: [{ datasetPathId: "foreign-path", role: "source" }],
  }));
  assert.equal(res.status, 400);
  assert.match(JSON.stringify(await res.json()), /pathIds not in this workspace clean_data/);
  assert.equal(engineDb.listMonitorRuns(ws.id).length, beforeRuns);
});

test("default watchlist falls back to legacy monitor config", async () => {
  const ws = seedWorkspace("watchlist-default");
  const metricSystem = engineDb.createMonitorMetricSystem(ws.id, "ms-default", makeMetricSystem());
  legacyConfigs.set(ws.id, {
    id: "legacy-config",
    workspaceId: ws.id,
    suite: "weekly" as HealthSuite,
    datasetBindings: [{ datasetPathId: "ds-source", role: "source", label: "legacy source" }],
    metricSystemId: metricSystem.id,
    thresholds: { gapTargetWarn: 0.05 },
    createdAt: 10,
    updatedAt: 20,
  });
  const res = await fetch(`${server.baseUrl}/api/workspaces/${ws.id}/monitor/watchlists`);
  assert.equal(res.status, 200);
  const list = await res.json() as Array<{ id: string; suite: string; metricSystemId?: string; virtual?: boolean; thresholds?: Record<string, number> }>;
  assert.equal(list.length, 1);
  assert.equal(list[0]?.id, "default");
  assert.equal(list[0]?.suite, "weekly");
  assert.equal(list[0]?.metricSystemId, metricSystem.id);
  assert.equal(list[0]?.virtual, true);
  assert.deepEqual(list[0]?.thresholds, { gapTargetWarn: 0.05 });
});

test("run by watchlist writes watchlistId and returns findings", async () => {
  const ws = seedWorkspace("watchlist-run");
  const metricSystem = engineDb.createMonitorMetricSystem(ws.id, "ms-run", makeMetricSystem());
  const createdRes = await fetch(`${server.baseUrl}/api/workspaces/${ws.id}/monitor/watchlists`, jsonPost({
    name: "大促计划",
    type: "campaign",
    suite: "daily",
    datasetBindings: [{ datasetPathId: "ds-source", role: "source" }],
    metricSystemId: metricSystem.id,
  }));
  const watchlist = await createdRes.json() as { id: string };
  const runRes = await fetch(`${server.baseUrl}/api/workspaces/${ws.id}/monitor/watchlists/${watchlist.id}/run`, jsonPost({}));
  assert.equal(runRes.status, 200);
  const body = await runRes.json() as { run: { id: string; watchlistId: string | null }; findings: unknown[] };
  assert.equal(body.run.watchlistId, watchlist.id);
  assert.ok(body.findings.length > 0);
  assert.equal(engineDb.listMonitorRuns(ws.id, { watchlistId: watchlist.id })[0]?.id, body.run.id);
});

test("watchlist run rejects invalid metric dataset before inserting run", async () => {
  const ws = seedWorkspace("watchlist-run-invalid");
  const metricSystem = engineDb.createMonitorMetricSystem(ws.id, "ms-invalid", makeMetricSystem("foreign-source", "ds-goal"));
  const createdRes = await fetch(`${server.baseUrl}/api/workspaces/${ws.id}/monitor/watchlists`, jsonPost({
    name: "坏计划",
    metricSystemId: metricSystem.id,
  }));
  const watchlist = await createdRes.json() as { id: string };
  const beforeRuns = engineDb.listMonitorRuns(ws.id).length;
  const runRes = await fetch(`${server.baseUrl}/api/workspaces/${ws.id}/monitor/watchlists/${watchlist.id}/run`, jsonPost({}));
  assert.equal(runRes.status, 400);
  assert.match(JSON.stringify(await runRes.json()), /pathIds not in this workspace clean_data/);
  assert.equal(engineDb.listMonitorRuns(ws.id).length, beforeRuns);
});
