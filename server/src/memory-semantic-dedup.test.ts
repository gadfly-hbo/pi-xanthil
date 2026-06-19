import assert from "node:assert/strict";
import express from "express";
import { mkdtempSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

process.env.XANTHIL_DATA_DIR = mkdtempSync(join(tmpdir(), "pi-xanthil-mem-sem-dedup-"));

const db = await import("./db.ts");
const data = await import("./db/data.ts");
const dedup = await import("./memory-dedup.ts");
const { dataRouter, __setIngestJudgeOverride } = await import("./routes/data.ts");

type IngestInput = Parameters<typeof data.ingestMemoryCandidate>[0];

function baseInput(workspaceId: string, overrides: Partial<IngestInput> = {}): IngestInput {
  return {
    workspaceId,
    type: "experience",
    title: "workflow gate node failure check first step",
    body: "when workflow fails the first step is to inspect the gate node status; if blocked review hook reason. stable troubleshooting habit.",
    scope: "workflow",
    sourceEventIds: ["evt-1", "evt-2"],
    confidence: 0.9,
    riskFlags: [],
    targetKind: "flow_run",
    targetId: "run-xyz",
    ...overrides,
  };
}

async function startTestServer(): Promise<{ port: number; close: () => Promise<void> }> {
  const app = express();
  app.use(express.json());
  app.use(dataRouter);
  const server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const addr = server.address() as AddressInfo;
  return {
    port: addr.port,
    close: () => new Promise<void>((resolve, reject) => server.close((err) => err ? reject(err) : resolve())),
  };
}

test("findSemanticDedupShortlist returns empty when no peers", () => {
  const ws = db.createWorkspace("shortlist empty");
  const list = data.findSemanticDedupShortlist(ws.id, "experience", "any title", "any body");
  assert.deepEqual(list, []);
});

test("findSemanticDedupShortlist ranks by token overlap and returns highest-overlap peer first", () => {
  const ws = db.createWorkspace("shortlist rank");
  data.createMemoryItem({
    workspaceId: ws.id, type: "experience",
    title: "workflow gate node failure check",
    body: "workflow gate hook reason troubleshoot",
    source: "derived", sourceEventIds: ["e1"], confidence: 0.9, riskFlags: [], scope: "workflow", supersedesId: null,
  });
  data.createMemoryItem({
    workspaceId: ws.id, type: "experience",
    title: "sql schema drift validation",
    body: "sql column not found schema migration check",
    source: "derived", sourceEventIds: ["e2"], confidence: 0.9, riskFlags: [], scope: "global", supersedesId: null,
  });
  const list = data.findSemanticDedupShortlist(
    ws.id, "experience",
    "workflow gate failure",
    "workflow gate node hook reason",
    8,
  );
  assert.ok(list.length >= 1, "at least one overlapping peer in shortlist");
  assert.ok(list[0]!.title.includes("gate"), "highest-overlap peer should rank first");
});

test("judgeSemanticDuplicate supplies MiniMax-M3 when model is omitted", async () => {
  const ws = db.createWorkspace("semantic judge default model");
  const item = data.createMemoryItem({
    workspaceId: ws.id,
    type: "experience",
    title: "检查 workflow gate",
    body: "工作流失败时先检查 gate 状态和失败原因，再决定是否重试。",
    source: "derived",
    sourceEventIds: ["event-model"],
    confidence: 0.9,
    riskFlags: [],
    scope: "workflow",
    supersedesId: null,
  });
  let receivedModel: string | undefined;
  await dedup.judgeSemanticDuplicate(
    { title: "workflow gate 排查", body: "先查看 gate 状态。" },
    [item],
    { workspaceRoot: ws.rootPath },
    async (_candidate, _shortlist, options) => {
      receivedModel = options.model;
      return null;
    },
  );
  assert.equal(receivedModel, "minimax-cn/MiniMax-M3");
  assert.equal(dedup.DEFAULT_MEMORY_DEDUP_MODEL, "minimax-cn/MiniMax-M3");
});

test("HTTP /memory/ingest: lexically distinct semantic dup is captured by judge and supersedes seed", async () => {
  const ws = db.createWorkspace("semantic dup supersede");
  const seed = data.ingestMemoryCandidate(baseInput(ws.id));
  assert.equal(seed.kind, "accepted");
  if (seed.kind !== "accepted") return;

  let judgeCalls = 0;
  __setIngestJudgeOverride(async (_cand, shortlist) => {
    judgeCalls++;
    return shortlist[0]?.id ?? null;
  });

  try {
    const srv = await startTestServer();
    try {
      const res = await fetch(`http://127.0.0.1:${srv.port}/api/workspaces/${ws.id}/memory/ingest`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          type: "experience",
          title: "which workflow node should i check first when run breaks",
          body: "if a workflow run breaks first confirm whether the gate node is blocked then trace hook reason; faster than reading raw logs.",
          scope: "workflow",
          sourceEventIds: ["evt-9", "evt-10"],
          confidence: 0.9,
          riskFlags: [],
        }),
      });
      assert.equal(res.status, 200);
      const body = await res.json() as { status?: string; supersededId?: string | null; id?: string };
      assert.equal(body.status, "accepted");
      assert.equal(body.supersededId, seed.item.id, "semantic dup should supersede seed item");
      assert.equal(judgeCalls, 1, "judge should be called exactly once for non-lexical near-duplicate");
      assert.equal(data.getMemoryItem(seed.item.id)?.enabled, false);
    } finally {
      await srv.close();
    }
  } finally {
    __setIngestJudgeOverride(undefined);
  }
});

test("HTTP /memory/ingest: lexical exact dup hits without invoking judge", async () => {
  const ws = db.createWorkspace("lexical dup no judge");
  const seed = data.ingestMemoryCandidate(baseInput(ws.id));
  assert.equal(seed.kind, "accepted");
  if (seed.kind !== "accepted") return;

  let judgeCalls = 0;
  __setIngestJudgeOverride(async () => { judgeCalls++; return null; });

  try {
    const srv = await startTestServer();
    try {
      const res = await fetch(`http://127.0.0.1:${srv.port}/api/workspaces/${ws.id}/memory/ingest`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          type: "experience",
          title: "workflow gate node failure check first step",
          body: "updated revision: same experience, slight wording tweak to validate lexical dedup still wins.",
          scope: "workflow",
          sourceEventIds: ["evt-x", "evt-y"],
          confidence: 0.9,
          riskFlags: [],
        }),
      });
      assert.equal(res.status, 200);
      const body = await res.json() as { status?: string; supersededId?: string | null };
      assert.equal(body.status, "accepted");
      assert.equal(body.supersededId, seed.item.id);
      assert.equal(judgeCalls, 0, "judge must NOT be called when lexical dup hits");
    } finally {
      await srv.close();
    }
  } finally {
    __setIngestJudgeOverride(undefined);
  }
});

test("HTTP /memory/ingest: judge throws -> graceful fallback, ingest succeeds with no supersede", async () => {
  const ws = db.createWorkspace("judge throws");
  const seed = data.ingestMemoryCandidate(baseInput(ws.id));
  assert.equal(seed.kind, "accepted");

  let judgeCalls = 0;
  __setIngestJudgeOverride(async () => {
    judgeCalls++;
    throw new Error("simulated pi timeout");
  });

  try {
    const srv = await startTestServer();
    try {
      const res = await fetch(`http://127.0.0.1:${srv.port}/api/workspaces/${ws.id}/memory/ingest`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          type: "experience",
          title: "which workflow node to inspect when execution breaks",
          body: "if workflow execution breaks first inspect gate node block status; faster than reading raw logs.",
          scope: "workflow",
          sourceEventIds: ["evt-99"],
          confidence: 0.9,
          riskFlags: [],
        }),
      });
      assert.equal(res.status, 200, "ingest must not crash on judge error");
      const body = await res.json() as { status?: string; supersededId?: string | null };
      assert.equal(body.status, "accepted");
      assert.equal(body.supersededId, null, "judge failure -> no semantic dup applied");
      assert.equal(judgeCalls, 1);
    } finally {
      await srv.close();
    }
  } finally {
    __setIngestJudgeOverride(undefined);
  }
});

test("HTTP /memory/ingest: empty shortlist (no same-type peers) -> judge not called", async () => {
  const ws = db.createWorkspace("empty shortlist");
  let judgeCalls = 0;
  __setIngestJudgeOverride(async () => { judgeCalls++; return null; });

  try {
    const srv = await startTestServer();
    try {
      const res = await fetch(`http://127.0.0.1:${srv.port}/api/workspaces/${ws.id}/memory/ingest`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          type: "experience",
          title: "fresh standalone experience entry placeholder title",
          body: "workspace starts empty; this is the first experience memory; shortlist must be empty so judge must not fire.",
          scope: "global",
          sourceEventIds: ["e-first"],
          confidence: 0.9,
          riskFlags: [],
        }),
      });
      assert.equal(res.status, 200);
      const body = await res.json() as { status?: string };
      assert.equal(body.status, "accepted");
      assert.equal(judgeCalls, 0, "no peers -> empty shortlist -> judge skipped");
    } finally {
      await srv.close();
    }
  } finally {
    __setIngestJudgeOverride(undefined);
  }
});

test("judgeSemanticDuplicate (unit): empty shortlist returns null without invoking pi", async () => {
  const out = await dedup.judgeSemanticDuplicate(
    { title: "x", body: "y" },
    [],
    { workspaceRoot: "/tmp" },
  );
  assert.equal(out, null);
});

test("judgeSemanticDuplicate (unit): injected judgeFn throw is caught and returns null", async () => {
  const ws = db.createWorkspace("judge unit catch");
  const item = data.createMemoryItem({
    workspaceId: ws.id, type: "experience",
    title: "t", body: "b", source: "derived",
    sourceEventIds: [], confidence: 0.9, riskFlags: [], scope: "global", supersedesId: null,
  });
  const out = await dedup.judgeSemanticDuplicate(
    { title: "c", body: "d" },
    [item],
    { workspaceRoot: "/tmp" },
    async () => { throw new Error("boom"); },
  );
  assert.equal(out, null, "judgeFn throw must be swallowed -> null");
});

test("parseJudgeOutput: strips ```json fences and validates id is in allowlist", () => {
  const allowed = new Set(["id-1", "id-2"]);
  const fenced = '```json\n{"match":"id-1"}\n```';
  assert.equal(dedup.__testing.parseJudgeOutput(fenced, allowed), "id-1");
  const bareFenced = '```\n{"match":"id-2"}\n```';
  assert.equal(dedup.__testing.parseJudgeOutput(bareFenced, allowed), "id-2");
  const plain = '{"match":"id-1"}';
  assert.equal(dedup.__testing.parseJudgeOutput(plain, allowed), "id-1");
});

test("parseJudgeOutput: rejects id not in allowlist (judge fabricated id)", () => {
  const allowed = new Set(["id-1"]);
  assert.equal(dedup.__testing.parseJudgeOutput('{"match":"id-fabricated"}', allowed), null);
});

test("parseJudgeOutput: returns null on null match / non-string match / no match field", () => {
  const allowed = new Set(["id-1"]);
  assert.equal(dedup.__testing.parseJudgeOutput('{"match":null}', allowed), null);
  assert.equal(dedup.__testing.parseJudgeOutput('{"match":42}', allowed), null);
  assert.equal(dedup.__testing.parseJudgeOutput('{"foo":"bar"}', allowed), null);
});

test("parseJudgeOutput: returns null on malformed/empty input without throwing", () => {
  const allowed = new Set(["id-1"]);
  assert.equal(dedup.__testing.parseJudgeOutput("", allowed), null);
  assert.equal(dedup.__testing.parseJudgeOutput("   ", allowed), null);
  assert.equal(dedup.__testing.parseJudgeOutput("not json at all", allowed), null);
  assert.equal(dedup.__testing.parseJudgeOutput('{"match":"id-1"', allowed), null); // truncated
  assert.equal(dedup.__testing.parseJudgeOutput("{ malformed json }", allowed), null);
});

test("parseJudgeOutput: extracts JSON object from output that has surrounding prose", () => {
  const allowed = new Set(["id-1"]);
  const noisy = 'Here is my judgment:\n{"match":"id-1"}\nThanks.';
  assert.equal(dedup.__testing.parseJudgeOutput(noisy, allowed), "id-1");
});
