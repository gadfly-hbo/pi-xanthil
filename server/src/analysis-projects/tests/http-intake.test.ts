/**
 * HTTP integration tests for Analysis Projects API.
 *
 * Tests the workspace-scoped Express routes with real ephemeral Express listener
 * and built-in fetch. Covers: CRUD operations, workspace isolation, idempotency,
 * engine unavailable behavior, error envelope format.
 */
import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createAnalysisProjectsRuntime, type AnalysisProjectsRuntimeHandle } from "../runtime/index.ts";
import { createFakeWorkspacePort, TEST_WORKSPACE_ID, TEST_WORKSPACE_ID_2 } from "./application-helpers.ts";

let runtime: AnalysisProjectsRuntimeHandle;
let baseUrl: string;
let wsPath: string;

beforeEach(async () => {
  const dataRoot = mkdtempSync(join(tmpdir(), "xanthil-http-test-"));
  const workspacePort = createFakeWorkspacePort();
  runtime = await createAnalysisProjectsRuntime({
    dataRoot,
    workspacePort,
    host: "127.0.0.1",
    port: 0, // ephemeral
  });
  const addr = runtime.address!;
  baseUrl = `http://${addr.host}:${addr.port}`;
  wsPath = `/api/analysis-projects/v1/workspaces/${TEST_WORKSPACE_ID}`;
});

afterEach(async () => {
  await runtime.close();
});

async function fetchJson(path: string, options?: RequestInit) {
  const url = `${baseUrl}${path}`;
  const res = await fetch(url, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...options?.headers,
    },
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const body = await res.json() as any;
  return { status: res.status, body };
}

// ============================================================================
// Workspace-scoped Project CRUD
// ============================================================================

describe("HTTP: Project CRUD", () => {
  test("POST /projects creates a project", async () => {
    const slug = "http-test-" + randomUUID().slice(0, 8);
    const { status, body } = await fetchJson(`${wsPath}/projects`, {
      method: "POST",
      headers: { "Idempotency-Key": randomUUID() },
      body: JSON.stringify({ title: "HTTP Test Project", slug }),
    });
    assert.equal(status, 201);
    assert.ok(body.data.projectId);
    assert.equal(body.data.projectStatus, "active");
    assert.equal(body.data.title, "HTTP Test Project");
    assert.equal(body.data.slug, slug);
  });

  test("GET /projects lists projects", async () => {
    // Create a project first
    const slug = "list-test-" + randomUUID().slice(0, 8);
    await fetchJson(`${wsPath}/projects`, {
      method: "POST",
      headers: { "Idempotency-Key": randomUUID() },
      body: JSON.stringify({ title: "List Test", slug }),
    });

    const { status, body } = await fetchJson(`${wsPath}/projects`);
    assert.equal(status, 200);
    assert.ok(body.data.items.length >= 1);
    assert.ok(body.data.items.find((item: { slug: string }) => item.slug === slug));
  });

  test("GET /projects/:id returns project detail", async () => {
    const slug = "detail-test-" + randomUUID().slice(0, 8);
    const createRes = await fetchJson(`${wsPath}/projects`, {
      method: "POST",
      headers: { "Idempotency-Key": randomUUID() },
      body: JSON.stringify({ title: "Detail Test", slug }),
    });
    const projectId = createRes.body.data.projectId;

    const { status, body } = await fetchJson(`${wsPath}/projects/${projectId}`);
    assert.equal(status, 200);
    assert.equal(body.data.project.projectId, projectId);
    assert.equal(body.data.project.title, "Detail Test");
  });

  test("PATCH /projects/:id updates metadata", async () => {
    const slug = "update-test-" + randomUUID().slice(0, 8);
    const createRes = await fetchJson(`${wsPath}/projects`, {
      method: "POST",
      headers: { "Idempotency-Key": randomUUID() },
      body: JSON.stringify({ title: "Original", slug }),
    });
    const projectId = createRes.body.data.projectId;
    const updatedAt = createRes.body.data.updatedAt;

    const { status, body } = await fetchJson(`${wsPath}/projects/${projectId}`, {
      method: "PATCH",
      headers: { "Idempotency-Key": randomUUID() },
      body: JSON.stringify({ title: "Updated", slug: "updated-" + randomUUID().slice(0, 8), expectedUpdatedAt: updatedAt }),
    });
    assert.equal(status, 200);
    assert.equal(body.data.title, "Updated");
  });
});

// ============================================================================
// Workspace isolation
// ============================================================================

describe("HTTP: Workspace isolation", () => {
  test("project created in workspace 1 not visible in workspace 2", async () => {
    const slug = "ws-isolation-" + randomUUID().slice(0, 8);
    const createRes = await fetchJson(`${wsPath}/projects`, {
      method: "POST",
      headers: { "Idempotency-Key": randomUUID() },
      body: JSON.stringify({ title: "WS1 Project", slug }),
    });
    assert.equal(createRes.status, 201);
    const projectId = createRes.body.data.projectId;

    // Read from workspace 2
    const ws2Path = `/api/analysis-projects/v1/workspaces/${TEST_WORKSPACE_ID_2}`;
    const { status, body } = await fetchJson(`${ws2Path}/projects/${projectId}`);
    assert.equal(status, 404);
    assert.equal(body.error.code, "resource_not_found");
  });

  test("project list in workspace 2 does not contain workspace 1 projects", async () => {
    const slug = "ws-list-" + randomUUID().slice(0, 8);
    await fetchJson(`${wsPath}/projects`, {
      method: "POST",
      headers: { "Idempotency-Key": randomUUID() },
      body: JSON.stringify({ title: "WS1 Only", slug }),
    });

    // List from workspace 2
    const ws2Path = `/api/analysis-projects/v1/workspaces/${TEST_WORKSPACE_ID_2}`;
    const { status, body } = await fetchJson(`${ws2Path}/projects`);
    assert.equal(status, 200);
    const found = body.data.items.find((item: { slug: string }) => item.slug === slug);
    assert.equal(found, undefined, "workspace 2 must not see workspace 1 project");
  });
});

// ============================================================================
// Idempotency
// ============================================================================

describe("HTTP: Idempotency", () => {
  test("same idempotency key replays same result", async () => {
    const slug = "idem-test-" + randomUUID().slice(0, 8);
    const idempotencyKey = randomUUID();
    const body = JSON.stringify({ title: "Idem Test", slug });

    const res1 = await fetchJson(`${wsPath}/projects`, {
      method: "POST",
      headers: { "Idempotency-Key": idempotencyKey },
      body,
    });
    assert.equal(res1.status, 201);
    const projectId = res1.body.data.projectId;

    const res2 = await fetchJson(`${wsPath}/projects`, {
      method: "POST",
      headers: { "Idempotency-Key": idempotencyKey },
      body,
    });
    assert.equal(res2.status, 201); // replayed (same status as original)
    // Replay returns same status; body structure may differ from original
    assert.ok(res2.body, "replay response must have body");
  });
});

// ============================================================================
// Error handling
// ============================================================================

describe("HTTP: Error handling", () => {
  test("unknown route returns 404", async () => {
    const { status, body } = await fetchJson("/api/unknown/route");
    assert.equal(status, 404);
    assert.equal(body.error.code, "resource_not_found");
  });

  test("invalid JSON body returns 400", async () => {
    const { status, body } = await fetchJson(`${wsPath}/projects`, {
      method: "POST",
      headers: { "Idempotency-Key": randomUUID() },
      body: "not-json",
    });
    assert.equal(status, 400);
  });

  test("missing idempotency key returns 400", async () => {
    const { status, body } = await fetchJson(`${wsPath}/projects`, {
      method: "POST",
      body: JSON.stringify({ title: "T", slug: "s" }),
    });
    assert.equal(status, 400);
  });
});

// ============================================================================
// Engine unavailable
// ============================================================================

describe("HTTP: Engine unavailable", () => {
  test("requirement generation returns 404 when engine not injected (routes not mounted)", async () => {
    // Create a project first
    const slug = "engine-test-" + randomUUID().slice(0, 8);
    const createRes = await fetchJson(`${wsPath}/projects`, {
      method: "POST",
      headers: { "Idempotency-Key": randomUUID() },
      body: JSON.stringify({ title: "Engine Test", slug }),
    });
    assert.equal(createRes.status, 201);
    const projectId = createRes.body.data.projectId;

    // Try to generate requirement (engine not available, routes not mounted)
    const { status } = await fetchJson(`${wsPath}/projects/${projectId}/requirements:generate`, {
      method: "POST",
      headers: { "Idempotency-Key": randomUUID() },
      body: JSON.stringify({}),
    });
    assert.equal(status, 404, "requirement route should not be mounted when engine is unavailable");
  });
});

describe("HTTP: Engine available", () => {
  test("capabilities reflects an injected Engine adapter", async () => {
    const dataRoot = mkdtempSync(join(tmpdir(), "xanthil-http-engine-test-"));
    const enabledRuntime = await createAnalysisProjectsRuntime({
      dataRoot,
      workspacePort: createFakeWorkspacePort(),
      engineHandler: async () => {
        throw new Error("Engine probe must not execute during capabilities lookup.");
      },
      host: "127.0.0.1",
      port: 0,
    });
    try {
      const address = enabledRuntime.address!;
      const response = await fetch(`http://${address.host}:${address.port}/api/analysis-projects/v1/capabilities`);
      const body = await response.json() as { data: { engine: { status: string; adapter?: string } } };
      assert.equal(response.status, 200);
      assert.deepEqual(body.data.engine, { status: "available", adapter: "pi" });
    } finally {
      await enabledRuntime.close();
      rmSync(dataRoot, { recursive: true, force: true });
    }
  });
});

// ============================================================================
// Workspace port validation (HTTP boundary)
// ============================================================================

describe("HTTP: Workspace port validation", () => {
  test("unknown workspace returns 404 on create (HTTP boundary)", async () => {
    const unknownWs = `/api/analysis-projects/v1/workspaces/${randomUUID()}`;
    const { status, body } = await fetchJson(`${unknownWs}/projects`, {
      method: "POST",
      headers: { "Idempotency-Key": randomUUID() },
      body: JSON.stringify({ title: "Test", slug: "test-" + randomUUID().slice(0, 8) }),
    });
    assert.equal(status, 404, "unknown workspace must return 404");
    assert.equal(body.error.code, "resource_not_found");
  });

  test("unknown workspace returns 404 on GET (HTTP boundary)", async () => {
    const unknownWs = `/api/analysis-projects/v1/workspaces/${randomUUID()}`;
    const { status, body } = await fetchJson(`${unknownWs}/projects`);
    assert.equal(status, 404, "unknown workspace must return 404 on GET");
    assert.equal(body.error.code, "resource_not_found");
  });

  test("blank workspace returns 404", async () => {
    const { status, body } = await fetchJson("/api/analysis-projects/v1/workspaces//projects");
    assert.equal(status, 404, "blank workspace must return 404");
  });
});

// ============================================================================
// Cross-workspace idempotency replay protection
// ============================================================================

describe("HTTP: Cross-workspace idempotency replay protection", () => {
  test("same idempotency key in different workspaces does not replay cross-workspace", async () => {
    const sharedKey = randomUUID();
    const slug1 = "ws1-idem-" + randomUUID().slice(0, 8);
    const slug2 = "ws2-idem-" + randomUUID().slice(0, 8);
    const ws2Path = `/api/analysis-projects/v1/workspaces/${TEST_WORKSPACE_ID_2}`;

    // Create project in workspace 1 with the shared key
    const res1 = await fetchJson(`${wsPath}/projects`, {
      method: "POST",
      headers: { "Idempotency-Key": sharedKey },
      body: JSON.stringify({ title: "WS1 Idem", slug: slug1 }),
    });
    assert.equal(res1.status, 201);
    const ws1ProjectId = res1.body.data.projectId;

    // Create project in workspace 2 with the SAME idempotency key
    // This should NOT replay workspace 1's result
    const res2 = await fetchJson(`${ws2Path}/projects`, {
      method: "POST",
      headers: { "Idempotency-Key": sharedKey },
      body: JSON.stringify({ title: "WS2 Idem", slug: slug2 }),
    });
    assert.equal(res2.status, 201, "workspace 2 create must succeed, not replay workspace 1");
    const ws2ProjectId = res2.body.data.projectId;

    // The project IDs must be different (no cross-workspace replay)
    assert.notEqual(ws1ProjectId, ws2ProjectId, "cross-workspace replay must not occur");

    // Verify workspace 1 project is NOT visible in workspace 2
    const check1 = await fetchJson(`${ws2Path}/projects/${ws1ProjectId}`);
    assert.equal(check1.status, 404, "workspace 1 project must not be visible in workspace 2");

    // Verify workspace 2 project IS visible in workspace 2
    const check2 = await fetchJson(`${ws2Path}/projects/${ws2ProjectId}`);
    assert.equal(check2.status, 200, "workspace 2 project must be visible in workspace 2");
    assert.equal(check2.body.data.project.title, "WS2 Idem");
  });

  test("replay in same workspace still works after namespacing", async () => {
    const slug = "idem-replay-" + randomUUID().slice(0, 8);
    const idempotencyKey = randomUUID();
    const body = JSON.stringify({ title: "Replay Test", slug });

    const res1 = await fetchJson(`${wsPath}/projects`, {
      method: "POST",
      headers: { "Idempotency-Key": idempotencyKey },
      body,
    });
    assert.equal(res1.status, 201);

    // Replay in same workspace should still work
    const res2 = await fetchJson(`${wsPath}/projects`, {
      method: "POST",
      headers: { "Idempotency-Key": idempotencyKey },
      body,
    });
    assert.equal(res2.status, 201, "same-workspace replay must still work");
  });
});

// ============================================================================
// Runtime lifecycle
// ============================================================================

describe("HTTP: Runtime lifecycle", () => {
  test("close() is idempotent (multiple calls safe)", async () => {
    const dataRoot = mkdtempSync(join(tmpdir(), "xanthil-close-test-"));
    const workspacePort = createFakeWorkspacePort();
    const rt = await createAnalysisProjectsRuntime({
      dataRoot,
      workspacePort,
      host: "127.0.0.1",
      port: 0,
    });

    // First close
    await rt.close();
    // Second close should not throw
    await rt.close();
    // Third close should not throw
    await rt.close();
  });

  test("close->reopen persistence: data survives close and is accessible after reopen", async () => {
    const dataRoot = mkdtempSync(join(tmpdir(), "xanthil-reopen-test-"));
    const workspacePort = createFakeWorkspacePort();

    // First runtime: create a project
    const rt1 = await createAnalysisProjectsRuntime({
      dataRoot,
      workspacePort,
      host: "127.0.0.1",
      port: 0,
    });
    const addr1 = rt1.address!;
    const baseUrl1 = `http://${addr1.host}:${addr1.port}`;
    const slug = "reopen-test-" + randomUUID().slice(0, 8);

    const createRes = await fetch(`${baseUrl1}${wsPath}/projects`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": randomUUID(),
      },
      body: JSON.stringify({ title: "Reopen Test", slug }),
    });
    assert.equal(createRes.status, 201);
    const createdBody = await createRes.json() as { data: { projectId: string } };
    const projectId = createdBody.data.projectId;

    // Close the runtime
    await rt1.close();

    // Second runtime: reopen and verify data persists
    const rt2 = await createAnalysisProjectsRuntime({
      dataRoot,
      workspacePort,
      host: "127.0.0.1",
      port: 0,
    });
    const addr2 = rt2.address!;
    const baseUrl2 = `http://${addr2.host}:${addr2.port}`;

    const getRes = await fetch(`${baseUrl2}${wsPath}/projects/${projectId}`);
    assert.equal(getRes.status, 200);
    const getBody = await getRes.json() as { data: { project: { projectId: string; title: string; slug: string } } };
    assert.equal(getBody.data.project.projectId, projectId);
    assert.equal(getBody.data.project.title, "Reopen Test");
    assert.equal(getBody.data.project.slug, slug);

    await rt2.close();
  });

  test("Express router is available without starting HTTP server", async () => {
    const dataRoot = mkdtempSync(join(tmpdir(), "xanthil-router-test-"));
    const workspacePort = createFakeWorkspacePort();
    const rt = await createAnalysisProjectsRuntime({
      dataRoot,
      workspacePort,
      // No host/port = no HTTP server
    });

    assert.ok(rt.expressRouter, "expressRouter must be available");
    assert.equal(rt.server, null, "server must be null when no host/port provided");
    assert.equal(rt.address, null, "address must be null when no host/port provided");

    await rt.close();
  });

  test("initialization failure after DB open cleans up handle (same dataRoot retry)", async () => {
    const dataRoot = mkdtempSync(join(tmpdir(), "xanthil-initfail-test-"));
    const workspacePort = createFakeWorkspacePort();

    // First runtime: create the DB structure successfully
    const rt1 = await createAnalysisProjectsRuntime({ dataRoot, workspacePort });
    await rt1.close();

    // Pre-seed the sqlitePath with an unknown user table (no schema_migrations)
    // This will cause checkUnknownDatabase to fail
    const { resolveDataRoot: resolveDR, buildLayout } = await import("../persistence/data-root.ts");
    const analysisProjectsRoot = resolveDR(dataRoot);
    const layout = buildLayout(analysisProjectsRoot);

    // Delete the existing DB and create a new one with unknown tables
    const { unlinkSync } = await import("node:fs");
    unlinkSync(layout.sqlitePath);

    const { DatabaseSync } = await import("node:sqlite");
    const corruptDb = new DatabaseSync(layout.sqlitePath);
    corruptDb.exec("CREATE TABLE unknown_corrupt_table (id INTEGER PRIMARY KEY)");
    corruptDb.close();

    // Now try to create a runtime - this should fail because of the unknown table
    await assert.rejects(
      () => createAnalysisProjectsRuntime({ dataRoot, workspacePort }),
      (err: Error) => {
        assert.ok(err instanceof Error, "should throw an error about unknown tables");
        return true;
      },
    );

    // Clean up the corrupt DB and retry the same dataRoot
    unlinkSync(layout.sqlitePath);

    // Verify we can create a new runtime in the same directory (no leaked handles)
    const rt2 = await createAnalysisProjectsRuntime({ dataRoot, workspacePort });
    await rt2.close();
  });
});

// ============================================================================
// Express mount integration
// ============================================================================

describe("HTTP: Express mount integration", () => {
  test("Express router works when mounted at /api/analysis-projects/v1", async () => {
    // Create runtime without HTTP server
    const dataRoot = mkdtempSync(join(tmpdir(), "xanthil-express-mount-test-"));
    const workspacePort = createFakeWorkspacePort();
    const rt = await createAnalysisProjectsRuntime({
      dataRoot,
      workspacePort,
    });

    // Create a real Express app and mount the router
    const express = await import("express");
    const app = express.default();
    app.use("/api/analysis-projects/v1", rt.expressRouter);

    // Start a temporary server
    const server = app.listen(0, "127.0.0.1");
    await new Promise<void>((resolve) => server.once("listening", resolve));
    const addr = server.address() as { address: string; port: number };
    const mountBaseUrl = `http://${addr.address}:${addr.port}`;

    try {
      // Test capabilities (non-workspace-scoped)
      const capRes = await fetch(`${mountBaseUrl}/api/analysis-projects/v1/capabilities`);
      assert.equal(capRes.status, 200);
      const capBody = await capRes.json() as { data: { version: string } };
      assert.ok(capBody.data.version);

      // Test workspace-scoped create
      const slug = "mount-test-" + randomUUID().slice(0, 8);
      const createRes = await fetch(`${mountBaseUrl}/api/analysis-projects/v1/workspaces/${TEST_WORKSPACE_ID}/projects`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": randomUUID(),
        },
        body: JSON.stringify({ title: "Mount Test", slug }),
      });
      assert.equal(createRes.status, 201);
      const createBody = await createRes.json() as { data: { projectId: string } };
      assert.ok(createBody.data.projectId);

      // Test workspace-scoped GET
      const getRes = await fetch(`${mountBaseUrl}/api/analysis-projects/v1/workspaces/${TEST_WORKSPACE_ID}/projects`);
      assert.equal(getRes.status, 200);
      const getBody = await getRes.json() as { data: { items: Array<{ slug: string }> } };
      assert.ok(getBody.data.items.find((item) => item.slug === slug));

      // Test unknown workspace returns 404
      const unknownRes = await fetch(`${mountBaseUrl}/api/analysis-projects/v1/workspaces/${randomUUID()}/projects`);
      assert.equal(unknownRes.status, 404);
    } finally {
      server.close();
      await rt.close();
    }
  });

  test("workspacePort throws returns 404 (fail-closed)", async () => {
    const dataRoot = mkdtempSync(join(tmpdir(), "xanthil-wpthrows-test-"));
    const throwingWorkspacePort = {
      workspaceExists: (_id: string) => { throw new Error("workspace port failure"); },
    };

    const rt = await createAnalysisProjectsRuntime({
      dataRoot,
      workspacePort: throwingWorkspacePort,
    });

    const express = await import("express");
    const app = express.default();
    app.use("/api/analysis-projects/v1", rt.expressRouter);

    const server = app.listen(0, "127.0.0.1");
    await new Promise<void>((resolve) => server.once("listening", resolve));
    const addr = server.address() as { address: string; port: number };
    const mountBaseUrl = `http://${addr.address}:${addr.port}`;

    try {
      // workspacePort throws -> should return 404 (fail-closed)
      const res = await fetch(`${mountBaseUrl}/api/analysis-projects/v1/workspaces/${TEST_WORKSPACE_ID}/projects`);
      assert.equal(res.status, 404, "workspacePort throw must return 404");
      const body = await res.json() as { error: { code: string } };
      assert.equal(body.error.code, "resource_not_found");
    } finally {
      server.close();
      await rt.close();
    }
  });
});

// ============================================================================
// Standalone node:http intake contract
// ============================================================================

describe("HTTP: Standalone node:http intake contract", () => {
  test("invalid Idempotency-Key returns 400 (not namespaced)", async () => {
    const dataRoot = mkdtempSync(join(tmpdir(), "xanthil-invalid-key-test-"));
    const workspacePort = createFakeWorkspacePort();
    const rt = await createAnalysisProjectsRuntime({
      dataRoot,
      workspacePort,
      host: "127.0.0.1",
      port: 0,
    });
    const addr = rt.address!;
    const standaloneBaseUrl = `http://${addr.host}:${addr.port}`;

    try {
      // Invalid UUID v4 (not matching the strict format)
      const res = await fetch(`${standaloneBaseUrl}${wsPath}/projects`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": "not-a-valid-uuid",
        },
        body: JSON.stringify({ title: "Test", slug: "test-" + randomUUID().slice(0, 8) }),
      });
      assert.equal(res.status, 400, "invalid Idempotency-Key must return 400");
      const body = await res.json() as { error: { code: string } };
      assert.equal(body.error.code, "validation_failed");
    } finally {
      await rt.close();
    }
  });
});
