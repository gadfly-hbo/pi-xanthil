/**
 * Regression test: Express-mounted mode with global express.json().
 *
 * Root cause: When the analysis-projects Express router is mounted on an
 * Express app that uses express.json() globally (as pi-Xanthil's main
 * server does at server/src/index.ts:274), the body stream is consumed
 * before the analysis-projects router runs. readRequestBody() then hangs
 * forever on the already-ended stream.
 *
 * This test reproduces the production mounting: an Express app with
 * express.json() + the analysis-projects expressRouter mounted via
 * app.use("/api/analysis-projects/v1", router).
 */
import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import express from "express";
import type { Server } from "node:http";
import { createAnalysisProjectsRuntime, type AnalysisProjectsRuntimeHandle } from "../runtime/index.ts";
import { createFakeWorkspacePort, TEST_WORKSPACE_ID } from "./application-helpers.ts";

let runtime: AnalysisProjectsRuntimeHandle;
let app: express.Express;
let server: Server;
let baseUrl: string;
let wsPath: string;

beforeEach(async () => {
  const dataRoot = mkdtempSync(join(tmpdir(), "xanthil-express-test-"));
  const workspacePort = createFakeWorkspacePort();
  runtime = await createAnalysisProjectsRuntime({
    dataRoot,
    workspacePort,
    // No host/port -> no standalone HTTP server; we mount on Express ourselves.
  });

  // Reproduce the production setup: express.json() with verify callback, then mount.
  app = express();
  app.use(express.json({
    limit: "8mb",
    verify: (req, _res, buf) => {
      (req as unknown as { __rawBody?: Buffer }).__rawBody = buf;
    },
  }));
  app.use("/api/analysis-projects/v1", runtime.expressRouter);

  await new Promise<void>((resolve) => {
    server = app.listen(0, "127.0.0.1", () => resolve());
  });
  const addr = server.address();
  if (!addr || typeof addr === "string") throw new Error("server.address() failed");
  baseUrl = `http://127.0.0.1:${addr.port}`;
  wsPath = `/api/analysis-projects/v1/workspaces/${TEST_WORKSPACE_ID}`;
});

afterEach(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
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

describe("HTTP Express-mounted: POST /projects (regression for body-stream hang)", () => {
  test("valid UUID v4 idempotency key creates a project without hanging", async () => {
    const slug = "express-test-" + randomUUID().slice(0, 8);
    const { status, body } = await fetchJson(`${wsPath}/projects`, {
      method: "POST",
      headers: { "Idempotency-Key": randomUUID() },
      body: JSON.stringify({ title: "Express Test Project", slug }),
    });
    assert.equal(status, 201);
    assert.ok(body.data.projectId);
    assert.equal(body.data.projectStatus, "active");
    assert.equal(body.data.title, "Express Test Project");
    assert.equal(body.data.slug, slug);
  });

  test("duplicate slug returns validation_failed, not a hang", async () => {
    const slug = "dup-test-" + randomUUID().slice(0, 8);
    // First create succeeds
    const first = await fetchJson(`${wsPath}/projects`, {
      method: "POST",
      headers: { "Idempotency-Key": randomUUID() },
      body: JSON.stringify({ title: "First Project", slug }),
    });
    assert.equal(first.status, 201);

    // Second create with same slug should fail with validation_failed
    const second = await fetchJson(`${wsPath}/projects`, {
      method: "POST",
      headers: { "Idempotency-Key": randomUUID() },
      body: JSON.stringify({ title: "Second Project", slug }),
    });
    assert.equal(second.status, 400);
    assert.equal(second.body.error.code, "validation_failed");
  });

  test("invalid idempotency key still returns 400 validation_failed", async () => {
    const { status, body } = await fetchJson(`${wsPath}/projects`, {
      method: "POST",
      headers: { "Idempotency-Key": "not-a-uuid" },
      body: JSON.stringify({ title: "Test", slug: "test-slug" }),
    });
    assert.equal(status, 400);
    assert.equal(body.error.code, "validation_failed");
  });

  test("idempotency replay returns replayed_success", async () => {
    const idempotencyKey = randomUUID();
    const slug = "replay-test-" + randomUUID().slice(0, 8);
    const first = await fetchJson(`${wsPath}/projects`, {
      method: "POST",
      headers: { "Idempotency-Key": idempotencyKey },
      body: JSON.stringify({ title: "Replay Test", slug }),
    });
    assert.equal(first.status, 201);
    const firstProjectId = first.body.data.projectId;

    // Same key + same body -> replayed_success (same status as original)
    const second = await fetchJson(`${wsPath}/projects`, {
      method: "POST",
      headers: { "Idempotency-Key": idempotencyKey },
      body: JSON.stringify({ title: "Replay Test", slug }),
    });
    assert.equal(second.status, 201);
    assert.equal(second.body.data.status, "succeeded");
    assert.equal(second.body.data.resultResourceId, firstProjectId);
    // Replay response has limited receipt (no title/slug in data)
    assert.equal(second.body.data.title, undefined);
  });

  test("workspace not found returns 404", async () => {
    const { status, body } = await fetchJson(
      `/api/analysis-projects/v1/workspaces/00000000-0000-4000-8000-000000000999/projects`,
      {
        method: "POST",
        headers: { "Idempotency-Key": randomUUID() },
        body: JSON.stringify({ title: "Test", slug: "test-slug" }),
      },
    );
    assert.equal(status, 404);
    assert.equal(body.error.code, "resource_not_found");
  });

  test("GET /projects still works in Express-mounted mode", async () => {
    const slug = "get-test-" + randomUUID().slice(0, 8);
    await fetchJson(`${wsPath}/projects`, {
      method: "POST",
      headers: { "Idempotency-Key": randomUUID() },
      body: JSON.stringify({ title: "GET Test", slug }),
    });

    const { status, body } = await fetchJson(`${wsPath}/projects`);
    assert.equal(status, 200);
    assert.ok(body.data.items.length >= 1);
    assert.ok(body.data.items.find((item: { slug: string }) => item.slug === slug));
  });

  test("PATCH /projects/:id updates project without hanging", async () => {
    const slug = "patch-test-" + randomUUID().slice(0, 8);
    const createRes = await fetchJson(`${wsPath}/projects`, {
      method: "POST",
      headers: { "Idempotency-Key": randomUUID() },
      body: JSON.stringify({ title: "Patch Test", slug }),
    });
    const projectId = createRes.body.data.projectId;
    const expectedUpdatedAt = createRes.body.data.updatedAt;

    const { status, body } = await fetchJson(`${wsPath}/projects/${projectId}`, {
      method: "PATCH",
      headers: { "Idempotency-Key": randomUUID() },
      body: JSON.stringify({ title: "Patched Title", slug: slug + "-updated", expectedUpdatedAt }),
    });
    assert.equal(status, 200);
    assert.equal(body.data.title, "Patched Title");
    assert.equal(body.data.slug, slug + "-updated");
  });

  test("DELETE /projects/:id deletes draft project without hanging", async () => {
    const slug = "delete-test-" + randomUUID().slice(0, 8);
    const createRes = await fetchJson(`${wsPath}/projects`, {
      method: "POST",
      headers: { "Idempotency-Key": randomUUID() },
      body: JSON.stringify({ title: "Delete Test", slug }),
    });
    const projectId = createRes.body.data.projectId;

    const { status, body } = await fetchJson(`${wsPath}/projects/${projectId}`, {
      method: "DELETE",
      headers: { "Idempotency-Key": randomUUID() },
      body: JSON.stringify({ confirmPermanentDeletion: true }),
    });
    assert.equal(status, 200);
    assert.equal(body.data.projectId, projectId);
  });

  test("duplicate JSON keys are rejected (strict contract preserved in mounted mode)", async () => {
    // express.json() parses this (last value wins), but the raw body captured
    // by the verify callback still has duplicates. parseJsonStrict must detect
    // and reject them.
    const res = await fetch(`${baseUrl}${wsPath}/projects`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": randomUUID(),
      },
      body: '{"title":"first","title":"second","slug":"dupe-key-test"}',
    });
    const body = await res.json() as { error: { code: string } };
    assert.equal(res.status, 400);
    assert.equal(body.error.code, "invalid_json");
  });
});
