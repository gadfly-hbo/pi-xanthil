import assert from "node:assert/strict";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { once } from "node:events";
import express from "express";
import test from "node:test";

const testRoot = mkdtempSync(join(tmpdir(), "pi-xanthil-skill-auto-distill-test-"));
const fakePi = join(testRoot, "fake-pi.mjs");
writeFileSync(
  fakePi,
  [
    "#!/usr/bin/env node",
    "const prompt = process.argv.at(-1) ?? '';",
    "const duplicate = prompt.includes('duplicate market sizing');",
    "const skill = duplicate",
    "  ? ['```markdown', '---', 'name: market-size-review', 'description: Estimate market size with driver tree assumptions and uncertainty.', '---', '', 'Build a market size driver tree, check assumptions, and cite uncertainty.', '```'].join('\\n')",
    "  : ['draft text', '---', 'name: ignored-frontmatter', '---', '', '---', 'name: auto-distilled-pattern', 'description: Distill repeated task patterns into a reusable review skill.', '---', '', 'Identify recurring steps, abstract inputs, and produce reusable guidance.'].join('\\n');",
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

interface AutoDistillResponse {
  scanned: number;
  created: number;
  skipped: number;
  failed: number;
  results: Array<{
    sessionId: string;
    status: "created" | "dry_run" | "skipped" | "failed";
    slug?: string;
    reason?: string;
    skillPath?: string;
    entry?: {
      id: string;
      slug: string;
      source: "manual" | "distilled" | "curated" | "imported";
      status: "draft" | "candidate" | "active" | "archived";
      originSessionId: string | null;
    };
  }>;
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

test("skill auto distill creates distilled candidate from completed sessions", async () => {
  const server = await startEngineRouter();
  try {
    const workspace = db.createWorkspace("skill auto distill create");
    const session = db.createSession(workspace.id, "Reusable task");
    db.addMessage(session.id, "user", [{ type: "text", text: "Please analyze a repeated task pattern." }]);
    db.addMessage(session.id, "assistant", [{ type: "text", text: "Finished with a reusable method." }]);

    const result = await json<AutoDistillResponse>(server.baseUrl, `/api/workspaces/${workspace.id}/skill-auto-distill`, {
      method: "POST",
      body: JSON.stringify({ since: 0, limit: 1, timeoutMs: 10_000 }),
    });

    assert.equal(result.scanned, 1);
    assert.equal(result.created, 1);
    assert.equal(result.failed, 0);
    const item = result.results[0]!;
    assert.equal(item.status, "created");
    assert.equal(item.slug, "auto-distilled-pattern");
    assert.equal(item.entry?.source, "distilled");
    assert.equal(item.entry?.status, "candidate");
    assert.equal(item.entry?.originSessionId, session.id);
    assert.ok(item.skillPath && existsSync(item.skillPath));
    assert.match(readFileSync(item.skillPath!, "utf8"), /^---\nname: auto-distilled-pattern/m);
    assert.equal(engineDb.getSkillRegistryEntry(item.entry!.id)?.status, "candidate");
  } finally {
    await server.close();
  }
});

test("skill auto distill skips high-similarity existing skills", async () => {
  const server = await startEngineRouter();
  try {
    const workspace = db.createWorkspace("skill auto distill duplicate");
    const existing = engineDb.createSkillRegistryEntry(workspace.id, {
      slug: "market-sizing-driver-tree",
      name: "market-sizing-driver-tree",
      source: "manual",
      status: "active",
    });
    const existingPath = join(workspace.rootPath, ".pi", "skills", existing.slug, "SKILL.md");
    mkdirSync(dirname(existingPath), { recursive: true });
    writeFileSync(
      existingPath,
      [
        "---",
        "name: market-sizing-driver-tree",
        "description: Estimate market size with driver tree assumptions.",
        "---",
        "",
        "Build a market size driver tree, check assumptions, and cite uncertainty.",
        "",
      ].join("\n"),
      "utf8",
    );
    const session = db.createSession(workspace.id, "Duplicate task");
    db.addMessage(session.id, "user", [{ type: "text", text: "duplicate market sizing task" }]);
    db.addMessage(session.id, "assistant", [{ type: "text", text: "duplicate market sizing complete" }]);

    const result = await json<AutoDistillResponse>(server.baseUrl, `/api/workspaces/${workspace.id}/skill-auto-distill`, {
      method: "POST",
      body: JSON.stringify({ since: 0, limit: 1, duplicateThreshold: 0.1, timeoutMs: 10_000 }),
    });

    assert.equal(result.scanned, 1);
    assert.equal(result.created, 0);
    assert.equal(result.skipped, 1);
    assert.equal(result.results[0]?.status, "skipped");
    assert.equal(result.results[0]?.reason, "similar_skill");
    assert.equal(engineDb.listSkillRegistryEntries(workspace.id).length, 1);
  } finally {
    await server.close();
  }
});
