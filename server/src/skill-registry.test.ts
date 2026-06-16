import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { once } from "node:events";
import express from "express";
import test from "node:test";

process.env.XANTHIL_DATA_DIR = mkdtempSync(join(tmpdir(), "pi-xanthil-skill-registry-test-"));

const db = await import("./db.ts");
const engineDb = await import("./db/engine.ts");
const { engineRouter } = await import("./routes/engine.ts");
const sharedDb = await import("./db/shared.ts");

interface TestServer {
  baseUrl: string;
  close: () => Promise<void>;
}

interface SkillRegistryResponse {
  entry: {
    id: string;
    workspaceId: string;
    slug: string;
    name: string;
    status: "draft" | "candidate" | "active" | "archived";
    version: number;
    source: "manual" | "distilled" | "curated" | "imported";
    score: number | null;
    activationRate: number | null;
    usageCount: number;
  };
  skillPath: string;
}

interface SkillPackageResponse {
  format: "pi-xanthil.skill-package";
  formatVersion: 1;
  registry: {
    slug: string;
    name: string;
    version: number;
    source: string;
    status: string;
    originSessionId: string | null;
  };
  files: Array<{ path: string; content: string }>;
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

async function jsonAllowError<T>(baseUrl: string, path: string, init?: RequestInit): Promise<{ status: number; body: T }> {
  const res = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
  });
  return { status: res.status, body: await res.json() as T };
}

test("skill registry routes adopt, patch and archive without deleting SKILL.md", async () => {
  const server = await startEngineRouter();
  try {
    const workspace = db.createWorkspace("skill registry route");
    const created = await json<SkillRegistryResponse>(server.baseUrl, `/api/workspaces/${workspace.id}/skill-registry`, {
      method: "POST",
      body: JSON.stringify({
        slug: "market-sizing",
        source: "distilled",
        status: "candidate",
        content: [
          "---",
          "name: market-sizing",
          "description: Estimate market size from structured assumptions.",
          "---",
          "",
          "Use a driver tree and state each assumption.",
          "",
        ].join("\n"),
      }),
    });

    assert.equal(created.entry.workspaceId, workspace.id);
    assert.equal(created.entry.slug, "market-sizing");
    assert.equal(created.entry.name, "market-sizing");
    assert.equal(created.entry.status, "candidate");
    assert.equal(created.entry.version, 1);
    assert.ok(created.skillPath.endsWith("/.pi/skills/market-sizing/SKILL.md"));
    assert.match(readFileSync(created.skillPath, "utf8"), /driver tree/);
    assert.deepEqual(sharedDb.listEnabledItemIds(workspace.id, "skill"), [created.entry.id]);

    const patched = await json<SkillRegistryResponse["entry"]>(server.baseUrl, `/api/skill-registry/${created.entry.id}`, {
      method: "PATCH",
      body: JSON.stringify({ status: "active", version: 2, confirmed: true }),
    });
    assert.equal(patched.status, "active");
    assert.equal(patched.version, 2);

    const archived = await json<SkillRegistryResponse["entry"]>(server.baseUrl, `/api/skill-registry/${created.entry.id}`, {
      method: "DELETE",
    });
    assert.equal(archived.status, "archived");
    assert.ok(existsSync(created.skillPath));
    assert.deepEqual(sharedDb.listEnabledItemIds(workspace.id, "skill"), []);
  } finally {
    await server.close();
  }
});

test("skill registry db records metrics and usage count", () => {
  const workspace = db.createWorkspace("skill registry db");
  const entry = engineDb.createSkillRegistryEntry(workspace.id, {
    slug: "forecast-review",
    name: "forecast-review",
    source: "manual",
    status: "active",
  });

  const measured = engineDb.updateSkillRegistryMetrics(entry.id, { score: 0.82, activationRate: 0.75 });
  assert.equal(measured?.score, 0.82);
  assert.equal(measured?.activationRate, 0.75);

  const used = engineDb.incrementSkillRegistryUsage(entry.id, 3);
  assert.equal(used?.usageCount, 3);
});

test("skill registry metrics promote qualified candidate to draft for human adoption", () => {
  const workspace = db.createWorkspace("skill registry threshold");
  const entry = engineDb.createSkillRegistryEntry(workspace.id, {
    slug: "candidate-scoring",
    name: "candidate-scoring",
    source: "distilled",
    status: "candidate",
  });

  const low = engineDb.updateSkillRegistryMetrics(entry.id, { score: 0.59, activationRate: 0.5 });
  assert.equal(low?.status, "candidate");
  const qualified = engineDb.updateSkillRegistryMetrics(entry.id, { score: 0.6, activationRate: 0.8 });
  assert.equal(qualified?.status, "draft");
  assert.equal(qualified?.score, 0.6);
});

test("skill registry requires confirmed review before activating distilled or curated skill", async () => {
  const server = await startEngineRouter();
  try {
    const workspace = db.createWorkspace("skill registry trust gate");
    const created = await json<SkillRegistryResponse>(server.baseUrl, `/api/workspaces/${workspace.id}/skill-registry`, {
      method: "POST",
      body: JSON.stringify({
        slug: "distilled-review",
        source: "distilled",
        status: "draft",
        content: [
          "---",
          "name: distilled-review",
          "description: Review distilled candidates before adoption.",
          "---",
          "",
          "Check evidence before activation.",
          "",
        ].join("\n"),
      }),
    });

    const denied = await jsonAllowError<{ error: string }>(server.baseUrl, `/api/skill-registry/${created.entry.id}`, {
      method: "PATCH",
      body: JSON.stringify({ status: "active" }),
    });
    assert.equal(denied.status, 400);
    assert.match(denied.body.error, /confirmed=true/);

    const activated = await json<SkillRegistryResponse["entry"]>(server.baseUrl, `/api/skill-registry/${created.entry.id}`, {
      method: "PATCH",
      body: JSON.stringify({ status: "active", confirmed: true }),
    });
    assert.equal(activated.status, "active");
  } finally {
    await server.close();
  }
});

test("skill registry exports SKILL.md with subresources and imports as candidate", async () => {
  const server = await startEngineRouter();
  try {
    const sourceWorkspace = db.createWorkspace("skill package source");
    const targetWorkspace = db.createWorkspace("skill package target");
    const created = await json<SkillRegistryResponse>(server.baseUrl, `/api/workspaces/${sourceWorkspace.id}/skill-registry`, {
      method: "POST",
      body: JSON.stringify({
        slug: "portable-skill",
        source: "manual",
        status: "active",
        content: [
          "---",
          "name: Portable Skill",
          "description: Carries resource files across workspaces.",
          "---",
          "",
          "Use references/checklist.md before answering.",
          "",
        ].join("\n"),
      }),
    });
    const sourceSkillRoot = join(sourceWorkspace.rootPath, ".pi", "skills", "portable-skill");
    mkdirSync(join(sourceSkillRoot, "references"), { recursive: true });
    writeFileSync(join(sourceSkillRoot, "references", "checklist.md"), "- Check evidence\n- Keep scope narrow\n", "utf8");

    const exported = await json<SkillPackageResponse>(server.baseUrl, `/api/skill-registry/${created.entry.id}/export`, { method: "POST" });
    assert.equal(exported.format, "pi-xanthil.skill-package");
    assert.equal(exported.registry.slug, "portable-skill");
    assert.ok(exported.files.some((file) => file.path === "SKILL.md" && file.content.includes("references/checklist.md")));
    assert.ok(exported.files.some((file) => file.path === "references/checklist.md" && file.content.includes("Check evidence")));

    const imported = await json<SkillRegistryResponse & { requestedSlug: string; writtenFiles: string[] }>(
      server.baseUrl,
      `/api/workspaces/${targetWorkspace.id}/skill-registry/import`,
      { method: "POST", body: JSON.stringify(exported) },
    );
    assert.equal(imported.requestedSlug, "portable-skill");
    assert.equal(imported.entry.workspaceId, targetWorkspace.id);
    assert.equal(imported.entry.slug, "portable-skill");
    assert.equal(imported.entry.status, "candidate");
    assert.equal(imported.entry.source, "imported");
    assert.match(readFileSync(imported.skillPath, "utf8"), /Carries resource files/);
    assert.equal(
      readFileSync(join(targetWorkspace.rootPath, ".pi", "skills", "portable-skill", "references", "checklist.md"), "utf8"),
      "- Check evidence\n- Keep scope narrow\n",
    );
    assert.equal(readFileSync(join(targetWorkspace.rootPath, ".pi", "skill-versions", "portable-skill", "v1.md"), "utf8"), readFileSync(imported.skillPath, "utf8"));
  } finally {
    await server.close();
  }
});

test("skill registry import rejects slug and file path traversal", async () => {
  const server = await startEngineRouter();
  try {
    const workspace = db.createWorkspace("skill package traversal");
    const basePackage: SkillPackageResponse = {
      format: "pi-xanthil.skill-package",
      formatVersion: 1,
      registry: {
        slug: "safe-skill",
        name: "Safe Skill",
        version: 1,
        source: "manual",
        status: "active",
        originSessionId: null,
      },
      files: [
        {
          path: "SKILL.md",
          content: [
            "---",
            "name: Safe Skill",
            "description: Safe import package.",
            "---",
            "",
            "Stay inside the skill directory.",
            "",
          ].join("\n"),
        },
      ],
    };

    const badSlug = await jsonAllowError<{ error: string }>(server.baseUrl, `/api/workspaces/${workspace.id}/skill-registry/import`, {
      method: "POST",
      body: JSON.stringify({ ...basePackage, registry: { ...basePackage.registry, slug: "../escape" } }),
    });
    assert.equal(badSlug.status, 400);
    assert.match(badSlug.body.error, /valid slug/);

    const badPath = await jsonAllowError<{ error: string }>(server.baseUrl, `/api/workspaces/${workspace.id}/skill-registry/import`, {
      method: "POST",
      body: JSON.stringify({ ...basePackage, files: [...basePackage.files, { path: "../escape.txt", content: "no" }] }),
    });
    assert.equal(badPath.status, 400);
    assert.match(badPath.body.error, /invalid package file path/);
    assert.equal(existsSync(join(workspace.rootPath, ".pi", "escape.txt")), false);
  } finally {
    await server.close();
  }
});

test("skill registry conflict API returns similar non-archived skills only", async () => {
  const server = await startEngineRouter();
  try {
    const workspace = db.createWorkspace("skill registry conflicts");
    const first = await json<SkillRegistryResponse>(server.baseUrl, `/api/workspaces/${workspace.id}/skill-registry`, {
      method: "POST",
      body: JSON.stringify({
        slug: "market-sizing-driver-tree",
        source: "manual",
        status: "active",
        content: [
          "---",
          "name: market-sizing-driver-tree",
          "description: Estimate market size with driver tree assumptions.",
          "---",
          "",
          "Build a driver tree, check assumptions, estimate market size, and cite uncertainty.",
          "",
        ].join("\n"),
      }),
    });
    const archived = await json<SkillRegistryResponse>(server.baseUrl, `/api/workspaces/${workspace.id}/skill-registry`, {
      method: "POST",
      body: JSON.stringify({
        slug: "archived-market-sizing",
        source: "manual",
        status: "archived",
        content: [
          "---",
          "name: archived-market-sizing",
          "description: Archived market sizing driver tree.",
          "---",
          "",
          "Build a driver tree and estimate market size.",
          "",
        ].join("\n"),
      }),
    });

    const url = `/api/workspaces/${workspace.id}/skill-registry/conflicts?content=${encodeURIComponent("market size driver tree assumptions uncertainty")}`;
    const result = await json<{ conflicts: Array<{ itemId: string; slug: string; severity: string; score: number }> }>(server.baseUrl, url);
    assert.ok(result.conflicts.some((item) => item.itemId === first.entry.id && item.slug === "market-sizing-driver-tree"));
    assert.ok(result.conflicts.every((item) => item.itemId !== archived.entry.id));
    assert.ok(result.conflicts.every((item) => item.score > 0));
  } finally {
    await server.close();
  }
});

test("workflow endpoints preserve valid skillPaths and filter unavailable ones", async () => {
  const server = await startEngineRouter();
  try {
    const workspace = db.createWorkspace("workflow skill paths");
    const flow = db.createFlow(workspace.id, "Skill Workflow", null, "multi");
    const created = await json<SkillRegistryResponse>(server.baseUrl, `/api/workspaces/${workspace.id}/skill-registry`, {
      method: "POST",
      body: JSON.stringify({
        slug: "sql-debug",
        source: "manual",
        status: "active",
        content: [
          "---",
          "name: sql-debug",
          "description: Debug SQL query failures inside workflow loops.",
          "---",
          "",
          "Inspect SQL errors and propose a corrected query.",
          "",
        ].join("\n"),
      }),
    });
    const workflow = {
      version: 1,
      defaultModel: "",
      defaultSkillPaths: [created.skillPath, "/missing/SKILL.md"],
      nodes: [
        { id: "repair", label: "Repair SQL", prompt: "{{task}}", model: "", skillPaths: [created.skillPath, "/missing-node/SKILL.md"] },
        { id: "plain", label: "Plain", prompt: "{{repair}}", model: "" },
      ],
      edges: [{ id: "repair__plain", source: "repair", target: "plain" }],
    };

    await json<{ ok: true }>(server.baseUrl, `/api/flows/${flow.id}/workflow`, {
      method: "PUT",
      body: JSON.stringify(workflow),
    });
    const loaded = await json<{ workflow: typeof workflow; inferred: boolean }>(server.baseUrl, `/api/flows/${flow.id}/workflow`);
    assert.deepEqual(loaded.workflow.defaultSkillPaths, [created.skillPath]);
    assert.deepEqual(loaded.workflow.nodes[0]?.skillPaths, [created.skillPath]);
    assert.equal(loaded.workflow.nodes[1]?.skillPaths, undefined);
  } finally {
    await server.close();
  }
});

test("recordSkillActivationForRun tracks production injection vs real activation", async () => {
  const workspace = db.createWorkspace("skill activation telemetry");
  const slug = "activation-demo-skill";
  const entry = engineDb.createSkillRegistryEntry(workspace.id, {
    slug,
    name: "Activation Demo",
    source: "manual",
    status: "active",
  });
  // SKILL.md 文件无需存在：detectSkillActivation 回退到 slug 派生关键词。
  const skillPath = join(workspace.rootPath, ".pi", "skills", slug, "SKILL.md");

  // 注入且输出命中 slug → 注入+激活各 +1，prodActivationRate=1。
  engineDb.recordSkillActivationForRun({
    workspaceId: workspace.id,
    workspaceRoot: workspace.rootPath,
    skillPaths: [skillPath],
    output: "we applied the activation-demo-skill approach to the task",
  });
  let now = engineDb.getSkillRegistryEntry(entry.id)!;
  assert.equal(now.prodInjectedCount, 1);
  assert.equal(now.prodActivatedCount, 1);
  assert.equal(now.prodActivationRate, 1);

  // 注入但输出未命中 → 只注入 +1，prodActivationRate=0.5。
  engineDb.recordSkillActivationForRun({
    workspaceId: workspace.id,
    workspaceRoot: workspace.rootPath,
    skillPaths: [skillPath],
    output: "totally unrelated content with no matching tokens",
  });
  now = engineDb.getSkillRegistryEntry(entry.id)!;
  assert.equal(now.prodInjectedCount, 2);
  assert.equal(now.prodActivatedCount, 1);
  assert.equal(now.prodActivationRate, 0.5);

  // 评测/注入口径不被污染：usageCount/activationRate 不受影响。
  assert.equal(now.usageCount, 0);
  assert.equal(now.activationRate, null);

  // 非 registry 路径被忽略，不抛错、不改计数。
  engineDb.recordSkillActivationForRun({
    workspaceId: workspace.id,
    workspaceRoot: workspace.rootPath,
    skillPaths: [join(workspace.rootPath, ".pi", "skills", "ghost", "SKILL.md")],
    output: "ghost",
  });
  now = engineDb.getSkillRegistryEntry(entry.id)!;
  assert.equal(now.prodInjectedCount, 2);
});
