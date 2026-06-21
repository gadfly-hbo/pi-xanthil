import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import express from "express";
import test from "node:test";
import {
  analyzeMemorySkillClusters,
  buildMemorySkillTranscript,
  fetchMemoryExperiences,
  runMemoryToSkillPromotion,
} from "./memory-to-skill.ts";
import type { MemoryItem } from "./types.ts";

const NOW = 1_700_000_000_000;
process.env.XANTHIL_DATA_DIR = mkdtempSync(join(tmpdir(), "pi-xanthil-memory-to-skill-test-"));

function experience(id: string, over: Partial<MemoryItem> = {}): MemoryItem {
  return {
    id,
    workspaceId: "ws-1",
    type: "experience",
    title: `经验 ${id}`,
    body: `先检查 trace，再按失败类型选择恢复步骤 ${id}`,
    tags: ["method:trace-first", "task:workflow-debug"],
    source: "derived",
    sourceEventIds: [],
    confidence: 0.8,
    riskFlags: [],
    validFrom: NOW - 1000,
    validUntil: null,
    supersedesId: null,
    usedCount: 2,
    lastUsedAt: NOW,
    positiveSignals: 1,
    negativeSignals: 0,
    staleAfterDays: 90,
    scope: "workflow",
    enabled: true,
    createdAt: NOW - 1000,
    updatedAt: NOW,
    ...over,
  };
}

test("analyzeMemorySkillClusters hits only when confidence, usage, and positive thresholds all pass", () => {
  const hit = analyzeMemorySkillClusters([experience("a"), experience("b"), experience("c")], undefined, NOW);
  assert.equal(hit.length, 1);
  assert.equal(hit[0]?.tag, "method:trace-first");
  assert.equal(hit[0]?.eligible, true);
  assert.equal(hit[0]?.highConfidenceCount, 3);
  assert.equal(hit[0]?.totalUsedCount, 6);
  assert.equal(hit[0]?.totalPositiveSignals, 3);

  const miss = analyzeMemorySkillClusters([
    experience("a", { positiveSignals: 0 }),
    experience("b", { positiveSignals: 0 }),
    experience("c", { positiveSignals: 0 }),
  ], undefined, NOW);
  assert.equal(miss[0]?.eligible, false);
  assert.ok(miss[0]?.reasons.some((reason) => reason.startsWith("fail: positiveSignals")));
});

test("clustering prefers method tag and falls back to task tag while skipping retired items", () => {
  const clusters = analyzeMemorySkillClusters([
    experience("method"),
    experience("task", { tags: ["task:workflow-debug"] }),
    experience("retired", { validUntil: NOW - 1 }),
    experience("untagged", { tags: ["industry:retail"] }),
  ], { highConfidence: 0, minHighConfidenceItems: 1, minUsedCount: 0, minPositiveSignals: 0 }, NOW);
  assert.deepEqual(clusters.map((cluster) => cluster.tag).sort(), ["method:trace-first", "task:workflow-debug"]);
});

test("runMemoryToSkillPromotion dryRun lists eligible clusters without distillation", async () => {
  let calls = 0;
  const result = await runMemoryToSkillPromotion({
    workspaceId: "ws-1",
    dryRun: true,
    now: NOW,
    listExperiences: async () => [experience("a"), experience("b"), experience("c")],
    distillCluster: async () => { calls++; return { status: "created" }; },
  });
  assert.equal(result.eligibleClusters, 1);
  assert.equal(result.promotions.length, 0);
  assert.equal(calls, 0);
  assert.ok(result.clusters[0]?.reasons.every((reason) => reason.startsWith("pass:")));
});

test("runMemoryToSkillPromotion builds a cluster transcript and forwards candidate result", async () => {
  let transcript = "";
  const result = await runMemoryToSkillPromotion({
    workspaceId: "ws-1",
    now: NOW,
    listExperiences: async () => [experience("a"), experience("b"), experience("c")],
    distillCluster: async (_cluster, value) => {
      transcript = value;
      return { status: "created", slug: "trace-first", registryStatus: "candidate" };
    },
  });
  assert.match(transcript, /聚类标签: method:trace-first/);
  assert.match(transcript, /经验 a/);
  assert.deepEqual(result.promotions[0]?.result, { status: "created", slug: "trace-first", registryStatus: "candidate" });
});

test("buildMemorySkillTranscript contains distilled evidence and no raw source access", () => {
  const [cluster] = analyzeMemorySkillClusters(
    [experience("a"), experience("b"), experience("c")],
    undefined,
    NOW,
  );
  assert.ok(cluster);
  const transcript = buildMemorySkillTranscript(cluster);
  assert.match(transcript, /Dream Worker 提纯/);
  assert.doesNotMatch(transcript, /draw_data/);
});

test("fetchMemoryExperiences reads D API and filters non-experience items", async () => {
  const app = express();
  app.get("/api/workspaces/:id/memory/items", (_req, res) => {
    res.json({ items: [experience("a"), { ...experience("b"), type: "constraint" }], facts: [] });
  });
  const server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  try {
    const items = await fetchMemoryExperiences(`http://127.0.0.1:${address.port}`, "ws-1");
    assert.deepEqual(items.map((item) => item.id), ["a"]);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});

test("existing skill distillation pipeline writes a candidate registry entry without auto-activating", async () => {
  const db = await import("./db.ts");
  const engine = await import("./routes/engine.ts");
  const workspace = db.createWorkspace("memory to skill candidate");
  let receivedPrompt = "";
  const result = await engine.distillSkillCandidate({
    workspaceId: workspace.id,
    workspaceRoot: workspace.rootPath,
    transcript: "聚类标签 method:trace-first；先查 trace，再按错误类型选择恢复步骤。",
    timeoutMs: 10_000,
    duplicateThreshold: 50,
    dryRun: false,
    originSessionId: null,
    usageTargetId: "memory-cluster:method:trace-first",
    usageTitle: "记忆升级 Skill：method:trace-first",
    distillText: async (prompt) => {
      receivedPrompt = prompt;
      return `---\nname: trace-first-recovery\ndescription: 当 workflow 执行失败时，按 trace 类型定位并恢复；不处理无 trace 的任务。\n---\n\n# Trace First Recovery\n\n先读取 {trace_events}，再按错误类型选择恢复步骤。\n\n## 关键变量清单\n\n| 变量名 | 含义 | 典型取值范围 |\n|---|---|---|\n| trace_events | 执行轨迹 | run/gate/error 事件 |\n\n## 使用示例\n\n请按 trace 恢复失败的 workflow。\n`;
    },
  });
  assert.match(receivedPrompt, /标准 SKILL\.md/);
  assert.match(receivedPrompt, /聚类标签 method:trace-first/);
  assert.equal(result.status, "created");
  if (result.status !== "created") return;
  assert.equal(result.entry.status, "candidate");
});

test("POST memory/promote-skills dryRun reads D API and returns cluster reasons without distillation", async () => {
  const db = await import("./db.ts");
  const data = await import("./db/data.ts");
  const { dataRouter } = await import("./routes/data.ts");
  const { engineRouter } = await import("./routes/engine.ts");
  const workspace = db.createWorkspace("memory promote route dry run");
  for (const suffix of ["a", "b", "c"]) {
    data.createMemoryItem({
      workspaceId: workspace.id,
      type: "experience",
      title: `高频经验 ${suffix}`,
      body: "先检查 trace，再按错误类型选择恢复步骤。",
      tags: ["method:trace-first", "task:workflow-debug"],
      confidence: 0.8,
      source: "derived",
    });
  }

  const app = express();
  app.use(express.json());
  app.use(dataRouter);
  app.use(engineRouter);
  const server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  try {
    const response = await fetch(`http://127.0.0.1:${address.port}/api/workspaces/${workspace.id}/memory/promote-skills`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ dryRun: true, minUsedCount: 0, minPositiveSignals: 0 }),
    });
    assert.equal(response.status, 200);
    const result = await response.json() as { dryRun: boolean; eligibleClusters: number; promotions: unknown[]; clusters: Array<{ tag: string; reasons: string[] }> };
    assert.equal(result.dryRun, true);
    assert.equal(result.eligibleClusters, 1);
    assert.deepEqual(result.promotions, []);
    assert.equal(result.clusters[0]?.tag, "method:trace-first");
    assert.ok(result.clusters[0]?.reasons.every((reason) => reason.startsWith("pass:")));
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});
