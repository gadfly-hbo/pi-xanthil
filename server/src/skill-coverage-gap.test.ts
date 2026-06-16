import assert from "node:assert/strict";
import { chmodSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { once } from "node:events";
import express from "express";
import test from "node:test";
import { analyzeSkillCoverageGaps, type SkillCoverageTask } from "./skill-coverage-gap.ts";
import type { RetrievedSkill, SkillRegistryEntry } from "./types.ts";

const testRoot = mkdtempSync(join(tmpdir(), "pi-xanthil-skill-coverage-gap-test-"));
const fakePi = join(testRoot, "fake-pi.mjs");
writeFileSync(
  fakePi,
  [
    "#!/usr/bin/env node",
    "const skill = ['---', 'name: uncovered-cohort-retention', 'description: Identify repeated cohort retention analysis gaps and turn them into reusable steps.', '---', '', 'Group retention cohort tasks, define inputs, and produce reusable guidance.'].join('\\n');",
    "console.log(JSON.stringify({ type: 'message_end', message: { role: 'assistant', content: [{ type: 'text', text: skill }] } }));",
  ].join("\n"),
  "utf8",
);
chmodSync(fakePi, 0o755);
process.env.XANTHIL_DATA_DIR = testRoot;
process.env.XANTHIL_PI_BIN = fakePi;

const db = await import("./db.ts");
const engineDb = await import("./db/engine.ts");
const { engineRouter } = await import("./routes/engine.ts");

interface TestServer {
  baseUrl: string;
  close: () => Promise<void>;
}

interface CoverageGapResponse {
  scanned: number;
  clusters: Array<{
    id: string;
    title: string;
    taskCount: number;
    tasks: Array<{ id: string; sessionId: string; title: string; text: string; topScore: number; matches: RetrievedSkill[] }>;
  }>;
}

interface CoverageGapDistillResponse {
  result:
    | { status: "created"; slug: string; entry: SkillRegistryEntry; skillPath: string }
    | { status: "dry_run"; slug: string }
    | { status: "skipped"; reason: string }
    | { status: "failed"; error: string };
}

async function startEngineRouter(): Promise<TestServer> {
  const app = express();
  app.use(express.json({ limit: "2mb" }));
  app.use(engineRouter);
  const server: Server = createServer(app);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address() as AddressInfo;
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: async () => {
      server.close();
      await once(server, "close");
    },
  };
}

async function json<T>(baseUrl: string, path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
  });
  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
  return res.json() as Promise<T>;
}

test("analyzeSkillCoverageGaps clusters repeated low-match tasks and excludes covered tasks", () => {
  const tasks: SkillCoverageTask[] = [
    { id: "covered", sessionId: "covered", title: "Covered", text: "market sizing driver tree", updatedAt: 1 },
    { id: "gap-1", sessionId: "gap-1", title: "Retention A", text: "cohort retention decay rescue segment", updatedAt: 2 },
    { id: "gap-2", sessionId: "gap-2", title: "Retention B", text: "cohort retention decay warning segment", updatedAt: 3 },
    { id: "single", sessionId: "single", title: "Single", text: "invoice parsing unmatched", updatedAt: 4 },
  ];

  const clusters = analyzeSkillCoverageGaps({
    tasks,
    retrieve: (query) => query.includes("market sizing")
      ? [{ path: "/skill/SKILL.md", name: "market-sizing", score: 2.4, snippet: "market sizing" }]
      : [],
    lowScoreThreshold: 1,
    minClusterSize: 2,
  });

  assert.equal(clusters.length, 1);
  assert.equal(clusters[0]?.taskCount, 2);
  assert.deepEqual(clusters[0]?.tasks.map((task) => task.id).sort(), ["gap-1", "gap-2"]);
});

test("coverage gap API returns clusters and distills a selected gap through the candidate path", async () => {
  const server = await startEngineRouter();
  try {
    const workspace = db.createWorkspace("skill coverage gap api");
    const first = db.createSession(workspace.id, "Retention decay A");
    db.addMessage(first.id, "user", [{ type: "text", text: "zqcoveragealpha zqcoveragebeta zqcoveragegamma rescue" }]);
    db.addMessage(first.id, "assistant", [{ type: "text", text: "done" }]);
    const second = db.createSession(workspace.id, "Retention decay B");
    db.addMessage(second.id, "user", [{ type: "text", text: "zqcoveragealpha zqcoveragebeta zqcoveragegamma warning" }]);
    db.addMessage(second.id, "assistant", [{ type: "text", text: "done" }]);

    const gaps = await json<CoverageGapResponse>(server.baseUrl, `/api/workspaces/${workspace.id}/skill-coverage-gaps`, {
      method: "POST",
      body: JSON.stringify({ since: 0, limit: 10, minClusterSize: 2 }),
    });

    assert.equal(gaps.scanned, 2);
    assert.equal(gaps.clusters.length, 1);
    assert.equal(gaps.clusters[0]?.taskCount, 2);

    const distilled = await json<CoverageGapDistillResponse>(server.baseUrl, `/api/workspaces/${workspace.id}/skill-coverage-gaps/distill`, {
      method: "POST",
      body: JSON.stringify({ cluster: gaps.clusters[0], timeoutMs: 10_000 }),
    });

    assert.equal(distilled.result.status, "created");
    if (distilled.result.status !== "created") throw new Error("expected created");
    assert.equal(distilled.result.slug, "uncovered-cohort-retention");
    assert.equal(distilled.result.entry.source, "distilled");
    assert.equal(distilled.result.entry.status, "candidate");
    assert.ok(existsSync(distilled.result.skillPath));
    assert.match(readFileSync(distilled.result.skillPath, "utf8"), /^---\nname: uncovered-cohort-retention/m);
    assert.equal(engineDb.getSkillRegistryEntry(distilled.result.entry.id)?.status, "candidate");
  } finally {
    await server.close();
  }
});
