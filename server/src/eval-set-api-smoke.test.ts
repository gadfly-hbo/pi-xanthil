import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createServer, type AddressInfo } from "node:net";
import test from "node:test";
import type { SkillEvaluationDetail, ToolEvaluationDetail } from "./types.ts";

interface Workspace {
  id: string;
  rootPath: string;
}

interface SkillEvalSet {
  id: string;
  name: string;
  tasks: Array<{ id: string; prompt: string }>;
}

interface ToolCaseSet {
  id: string;
  name: string;
  toolId: string;
  cases: Array<{ id: string; name: string; inputPath: string; expected: { kind: string } }>;
}

interface EvaluationArchiveIndexItem {
  kind: "skill" | "tool";
  evaluationId: string;
  baseName: string;
  markdownRelPath: string;
  jsonRelPath: string;
}

async function freePort(): Promise<number> {
  const server = createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.notEqual(typeof address, "string");
  assert.ok(address);
  const info = address as AddressInfo;
  const port = info.port;
  server.close();
  await once(server, "close");
  return port;
}

function isListenPermissionError(err: unknown): boolean {
  return typeof err === "object"
    && err !== null
    && "code" in err
    && (err as { code?: unknown }).code === "EPERM";
}

async function startServer(): Promise<{ baseUrl: string; child: ChildProcessWithoutNullStreams; dataDir: string }> {
  const port = await freePort();
  const dataDir = mkdtempSync(join(tmpdir(), "pi-xanthil-api-smoke-"));
  const child = spawn(process.execPath, ["--experimental-strip-types", "src/index.ts"], {
    cwd: join(process.cwd(), "server"),
    env: {
      ...process.env,
      XANTHIL_DATA_DIR: dataDir,
      XANTHIL_PORT: String(port),
      XANTHIL_PI_BIN: "/usr/bin/false",
    },
  });
  child.stderr.setEncoding("utf8");
  child.stdout.setEncoding("utf8");
  const baseUrl = `http://127.0.0.1:${port}`;
  const started = Date.now();
  while (Date.now() - started < 10_000) {
    if (child.exitCode !== null) {
      throw new Error(`server exited early: ${child.exitCode}`);
    }
    try {
      const res = await fetch(`${baseUrl}/api/health`);
      if (res.ok) return { baseUrl, child, dataDir };
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  child.kill();
  throw new Error("server did not become healthy");
}

async function json<T>(baseUrl: string, path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
  });
  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
  return res.json() as Promise<T>;
}

async function text(baseUrl: string, path: string): Promise<string> {
  const res = await fetch(`${baseUrl}${path}`);
  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
  return res.text();
}

test("eval set and case set HTTP CRUD routes work", async (t) => {
  let started: { baseUrl: string; child: ChildProcessWithoutNullStreams; dataDir: string };
  try {
    started = await startServer();
  } catch (err) {
    if (isListenPermissionError(err)) {
      t.skip("local TCP listen is not available in this sandbox");
      return;
    }
    throw err;
  }
  const { baseUrl, child, dataDir } = started;
  try {
    const workspace = await json<Workspace>(baseUrl, "/api/workspaces", {
      method: "POST",
      body: JSON.stringify({ name: "api-smoke" }),
    });

    const skill = await json<SkillEvalSet>(baseUrl, `/api/workspaces/${workspace.id}/skill-eval-sets`, {
      method: "POST",
      body: JSON.stringify({ name: "Skill Set", tasks: [{ id: "task_1", prompt: "Task" }] }),
    });
    assert.equal(skill.name, "Skill Set");
    assert.equal(skill.tasks.length, 1);

    const updatedSkill = await json<SkillEvalSet>(baseUrl, `/api/skill-eval-sets/${skill.id}`, {
      method: "PATCH",
      body: JSON.stringify({ name: "Renamed Skill Set", tasks: [{ id: "task_2", prompt: "Task 2" }] }),
    });
    assert.equal(updatedSkill.name, "Renamed Skill Set");
    assert.equal(updatedSkill.tasks[0]?.id, "task_2");

    const skillSets = await json<SkillEvalSet[]>(baseUrl, `/api/workspaces/${workspace.id}/skill-eval-sets`);
    assert.equal(skillSets.some((item) => item.id === skill.id && item.name === "Renamed Skill Set"), true);

    await json<{ ok: true }>(baseUrl, `/api/skill-eval-sets/${skill.id}`, { method: "DELETE" });
    const skillSetsAfterDelete = await json<SkillEvalSet[]>(baseUrl, `/api/workspaces/${workspace.id}/skill-eval-sets`);
    assert.equal(skillSetsAfterDelete.some((item) => item.id === skill.id), false);

    const tool = await json<ToolCaseSet>(baseUrl, `/api/workspaces/${workspace.id}/tool-case-sets`, {
      method: "POST",
      body: JSON.stringify({
        name: "Tool Cases",
        toolId: "extract-tmall-profile",
        cases: [{ id: "case_1", name: "Case", inputPath: "/tmp/input.html", expected: { kind: "must-fail" } }],
      }),
    });
    assert.equal(tool.toolId, "extract-tmall-profile");

    const updatedTool = await json<ToolCaseSet>(baseUrl, `/api/tool-case-sets/${tool.id}`, {
      method: "PATCH",
      body: JSON.stringify({
        name: "Renamed Tool Cases",
        toolId: "extract-tmall-profile",
        cases: [{ id: "case_2", name: "Case 2", inputPath: "/tmp/input2.html", expected: { kind: "must-fail" } }],
      }),
    });
    assert.equal(updatedTool.name, "Renamed Tool Cases");
    assert.equal(updatedTool.cases[0]?.id, "case_2");

    const toolSets = await json<ToolCaseSet[]>(baseUrl, `/api/workspaces/${workspace.id}/tool-case-sets?toolId=extract-tmall-profile`);
    assert.equal(toolSets.some((item) => item.id === tool.id && item.name === "Renamed Tool Cases"), true);

    await json<{ ok: true }>(baseUrl, `/api/tool-case-sets/${tool.id}`, { method: "DELETE" });
    const toolSetsAfterDelete = await json<ToolCaseSet[]>(baseUrl, `/api/workspaces/${workspace.id}/tool-case-sets?toolId=extract-tmall-profile`);
    assert.equal(toolSetsAfterDelete.some((item) => item.id === tool.id), false);

    process.env.XANTHIL_DATA_DIR = dataDir;
    const db = await import("./db.ts");
    const skillEvaluation = db.saveSkillEvaluation(
      workspace.id,
      "model-a",
      1,
      [{ id: "baseline", label: "Baseline", skillPaths: [] }],
      [{ id: "task", prompt: "Task" }],
      "",
      {
        evaluationId: "skill-api-smoke",
        status: "success",
        startedAt: 0,
        endedAt: 1000,
        durationSec: 1,
        variantSummaries: [{
          variantId: "baseline",
          variantLabel: "Baseline",
          total: 1,
          success: 1,
          failed: 0,
          activationRate: 0,
          avgDurationSec: 1,
          avgTotalTokens: 0,
          avgTotalCost: 0,
          avgToolCalls: 0,
          avgOutputChars: 0,
        }],
        taskSummaries: [{ taskId: "task", total: 1, success: 1, failed: 0, activationRate: 0 }],
        pairwiseSummaries: [],
        results: [],
      } satisfies Omit<SkillEvaluationDetail, "workspaceId" | "model" | "repeat" | "variants" | "tasks" | "contextPrefix">,
    );
    const archivedSkill = await json<{ markdownPath: string; jsonPath: string }>(baseUrl, `/api/evaluations/skill/${skillEvaluation.evaluationId}/archive`, {
      method: "POST",
    });
    assert.match(archivedSkill.markdownPath, /skill-evaluation-skill-api-smoke\.md$/);
    assert.match(archivedSkill.jsonPath, /skill-evaluation-skill-api-smoke\.json$/);

    const toolEvaluation = db.saveToolEvaluation(
      workspace.id,
      "extract-tmall-profile",
      1,
      [{ id: "case", name: "Case", inputPath: "/tmp/input.html", expected: { kind: "must-fail" } }],
      {
        evaluationId: "tool-api-smoke",
        status: "success",
        startedAt: 0,
        endedAt: 1000,
        durationSec: 1,
        caseSummaries: [{ caseId: "case", caseName: "Case", total: 1, success: 1, failed: 0, avgDurationSec: 1 }],
        results: [],
      } satisfies Omit<ToolEvaluationDetail, "workspaceId" | "toolId" | "repeat" | "cases">,
    );
    const archivedTool = await json<{ markdownPath: string; jsonPath: string }>(baseUrl, `/api/evaluations/tool/${toolEvaluation.evaluationId}/archive`, {
      method: "POST",
    });
    assert.match(archivedTool.markdownPath, /tool-evaluation-tool-api-smoke\.md$/);
    assert.match(archivedTool.jsonPath, /tool-evaluation-tool-api-smoke\.json$/);

    const archives = await json<EvaluationArchiveIndexItem[]>(baseUrl, `/api/workspaces/${workspace.id}/evaluation-archives`);
    assert.equal(archives.length, 2);
    assert.equal(archives.find((item) => item.kind === "skill")?.evaluationId, "skill-api-smoke");
    assert.equal(archives.find((item) => item.kind === "tool")?.evaluationId, "tool-api-smoke");
    assert.match(archives[0]?.markdownRelPath ?? "", /^evaluations\/archive\//);
    assert.match(archives[0]?.jsonRelPath ?? "", /^evaluations\/archive\//);
    const skillArchive = archives.find((item) => item.kind === "skill");
    assert.ok(skillArchive);
    const markdown = await text(baseUrl, `/api/workspaces/${workspace.id}/evaluation-archives/${encodeURIComponent(skillArchive.baseName)}/md`);
    assert.match(markdown, /Skill Evaluation Report/);
    const archivedJson = await json<{ evaluationId: string }>(baseUrl, `/api/workspaces/${workspace.id}/evaluation-archives/${encodeURIComponent(skillArchive.baseName)}/json`);
    assert.equal(archivedJson.evaluationId, "skill-api-smoke");
  } finally {
    child.kill();
    await once(child, "exit").catch(() => undefined);
  }
});
