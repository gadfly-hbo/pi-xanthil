import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, mkdirSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

process.env.XANTHIL_DATA_DIR = mkdtempSync(join(tmpdir(), "pi-xanthil-sim-lab-test-"));

const db = await import("./db.ts");
const lab = await import("./simulation-lab.ts");
import type { SimulationRunInput, DigitalLifeForm } from "./types.ts";

function baseBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    pathId: 1,
    model: "ep-test",
    scenario: "consumer_campaign",
    lifeForms: [{ id: "lf-1", name: "Alice", persona: "30 sui nv xing" }],
    ...overrides,
  };
}

// 1. parse: scenario / lifeForms / persona

test("parse: rejects invalid scenario", () => {
  assert.throws(() => lab.parseSimulationRunRequest(baseBody({ scenario: "nope" })), /invalid scenario/);
});

test("parse: rejects empty lifeForms array", () => {
  assert.throws(() => lab.parseSimulationRunRequest(baseBody({ lifeForms: [] })), /at least one lifeForm/);
});

test("parse: rejects missing lifeForms field", () => {
  const b = baseBody();
  delete (b as Record<string, unknown>).lifeForms;
  assert.throws(() => lab.parseSimulationRunRequest(b), /at least one lifeForm/);
});

test("parse: rejects empty persona", () => {
  assert.throws(
    () => lab.parseSimulationRunRequest(baseBody({ lifeForms: [{ id: "x", name: "n", persona: "   " }] })),
    /persona required/,
  );
});

test("parse: rejects missing persona field", () => {
  assert.throws(
    () => lab.parseSimulationRunRequest(baseBody({ lifeForms: [{ id: "x", name: "n" }] })),
    /persona required/,
  );
});

test("parse: rejects empty id or name", () => {
  assert.throws(
    () => lab.parseSimulationRunRequest(baseBody({ lifeForms: [{ id: " ", name: "n", persona: "p" }] })),
    /id required/,
  );
  assert.throws(
    () => lab.parseSimulationRunRequest(baseBody({ lifeForms: [{ id: "x", name: "", persona: "p" }] })),
    /name required/,
  );
});

test("parse: rejects missing pathId / blank model", () => {
  const b = baseBody();
  delete (b as Record<string, unknown>).pathId;
  assert.throws(() => lab.parseSimulationRunRequest(b), /pathId/);
  assert.throws(() => lab.parseSimulationRunRequest(baseBody({ model: "  " })), /model required/);
});

test("parse: strips toolIds — DLF must not inherit subagent tool permissions", () => {
  const parsed = lab.parseSimulationRunRequest(baseBody({
    lifeForms: [{ id: "lf-1", name: "Alice", persona: "abc", toolIds: ["danger"] } as unknown],
  }));
  assert.equal((parsed.lifeForms[0] as unknown as { toolIds?: unknown }).toolIds, undefined);
});

test("parse: happy path returns SimulationRunInput", () => {
  const parsed = lab.parseSimulationRunRequest(baseBody({
    relPath: "sub/r.md",
    prompt: "重点测试",
    businessContext: "门店活动",
  }));
  assert.equal(parsed.scenario, "consumer_campaign");
  assert.equal(parsed.relPath, "sub/r.md");
  assert.equal(parsed.lifeForms[0]!.source, "manual_persona");
});

// 2. path guard

test("path guard: rejects hidden segment", () => {
  assert.throws(() => lab.validateReportRelPath(".secret/x.md"), /invalid/);
  assert.throws(() => lab.validateReportRelPath("a/.h/x.md"), /invalid/);
});

test("path guard: rejects parent traversal", () => {
  assert.throws(() => lab.validateReportRelPath("../x.md"), /invalid/);
  assert.throws(() => lab.validateReportRelPath("a/../b.md"), /invalid/);
});

test("path guard: rejects empty", () => {
  assert.throws(() => lab.validateReportRelPath(""), /required/);
});

test("path guard: accepts normal relative", () => {
  assert.doesNotThrow(() => lab.validateReportRelPath("sub/r.md"));
});

// 3. prompt content

test("prompt: includes report name, scenario, personas; excludes toolIds", () => {
  const input: SimulationRunInput = {
    pathId: 1,
    scenario: "consumer_campaign",
    model: "ep-test",
    lifeForms: [
      { id: "lf-A", name: "Bob", persona: "高线男白领", source: "subagent_template", templateId: "tpl-X" } as DigitalLifeForm,
      { id: "lf-B", name: "Carol", persona: "下沉宝妈", source: "manual_persona" } as DigitalLifeForm,
    ],
    prompt: "MARK_TARGET",
    businessContext: "MARK_CTX",
  };
  const { systemPrompt, userPrompt } = lab.buildSimulationPrompts({
    reportName: "campaign_v3.md",
    reportText: "MARK_REPORT 报告正文",
    input,
  });
  assert.match(systemPrompt, /模拟实验裁判/);
  assert.match(userPrompt, /campaign_v3\.md/);
  assert.match(userPrompt, /MARK_REPORT/);
  assert.match(userPrompt, /consumer_campaign/);
  assert.match(userPrompt, /Bob/);
  assert.match(userPrompt, /下沉宝妈/);
  assert.match(userPrompt, /MARK_TARGET/);
  assert.match(userPrompt, /MARK_CTX/);
  assert.doesNotMatch(userPrompt, /toolIds/i);
  assert.doesNotMatch(userPrompt, /tpl-X/);
});

test("prompt: persona truncated to 1500 chars; report truncated to 30000", () => {
  const longPersona = "A".repeat(5000);
  const longReport = "B".repeat(60_000);
  const { userPrompt } = lab.buildSimulationPrompts({
    reportName: "x.md",
    reportText: longReport,
    input: {
      pathId: 1, scenario: "expert_panel", model: "m", lifeForms: [
        { id: "lf", name: "L", persona: longPersona, source: "manual_persona" },
      ],
    },
  });
  const aCount = (userPrompt.match(/A/g) ?? []).length;
  const bCount = (userPrompt.match(/B/g) ?? []).length;
  assert.equal(aCount, 1500, `persona truncated, got ${aCount}`);
  assert.equal(bCount, 30_000, `report truncated, got ${bCount}`);
});

// 4. JSON repair

test("JSON repair: trailing comma + markdown fence is repaired", () => {
  const loose = 'Here:\n```json\n{\n  "verdict":"go",\n  "overallScore":82,\n  "roleAssessments":[{"lifeFormId":"lf-1","stance":"support","score":80,}],\n}\n```\nThanks.';
  const obj = lab.extractJsonObject(loose) as Record<string, unknown>;
  assert.equal(obj.verdict, "go");
  assert.equal(obj.overallScore, 82);
  assert.ok(Array.isArray(obj.roleAssessments));
});

test("JSON repair: bare object without fence", () => {
  const obj = lab.extractJsonObject('{"verdict":"hold","overallScore":50,"roleAssessments":[],}') as Record<string, unknown>;
  assert.equal(obj.verdict, "hold");
});

test("JSON repair: no object throws domain error", () => {
  assert.throws(() => lab.extractJsonObject("plain text only"), /does not contain JSON object/);
});

test("normalize: clamps overallScore + pads roleAssessments + fallbacks per lifeForm", () => {
  const input: SimulationRunInput = {
    pathId: 1, scenario: "product_concept", model: "m",
    lifeForms: [
      { id: "lf-1", name: "A", persona: "a", source: "manual_persona" },
      { id: "lf-2", name: "B", persona: "b", source: "manual_persona" },
    ],
  };
  const r = lab.normalizeSimulationResult(
    { verdict: "weird", overallScore: 9999, roleAssessments: [{ lifeFormId: "lf-1", stance: "support", score: -50 }] },
    input,
    { json: "out/sim.json", markdown: "out/sim.md" },
  );
  assert.equal(r.verdict, "hold");
  assert.equal(r.overallScore, 100);
  assert.equal(r.roleAssessments.length, 2);
  assert.equal(r.roleAssessments[0]!.score, 0);
  assert.equal(r.roleAssessments[1]!.lifeFormId, "lf-2");
  assert.deepEqual(r.artifactPaths, { json: "out/sim.json", markdown: "out/sim.md" });
});

// 5+6. runSimulationLab end-to-end with injected fake runPi
// Covers: folder guard, extension guard, artifact paths, no subagent runner

test("runSimulationLab: rejects non-report folder paths (clean_data not allowed)", async () => {
  const ws = db.createWorkspace("sim-non-report");
  const cleanDir = join(ws.rootPath, "020_clean");
  mkdirSync(cleanDir, { recursive: true });
  const cleanFile = join(cleanDir, "agg.csv");
  writeFileSync(cleanFile, "a,b\n1,2");
  const wp = db.addWorkspacePath(ws.id, "clean_data", cleanFile, "file");

  await assert.rejects(
    () => lab.runSimulationLab({
      pathId: wp.id,
      scenario: "consumer_campaign",
      model: "m",
      lifeForms: [{ id: "lf", name: "n", persona: "p", source: "manual_persona" }],
    }, { runPi: async () => "{}" }),
    /only supports reports/,
  );
});

test("runSimulationLab: rejects draw_data folder (red line: raw rows must not reach LLM)", async () => {
  const ws = db.createWorkspace("sim-no-drawdata");
  const drawDir = join(ws.rootPath, "010_raw");
  mkdirSync(drawDir, { recursive: true });
  const drawFile = join(drawDir, "orders.txt");
  writeFileSync(drawFile, "id,amt\n1,99");
  const wp = db.addWorkspacePath(ws.id, "draw_data", drawFile, "file");

  await assert.rejects(
    () => lab.runSimulationLab({
      pathId: wp.id,
      scenario: "consumer_campaign",
      model: "m",
      lifeForms: [{ id: "lf", name: "n", persona: "p", source: "manual_persona" }],
    }, { runPi: async () => "{}" }),
    /only supports reports/,
  );
});

test("runSimulationLab: rejects non-text report file (.xlsx)", async () => {
  const ws = db.createWorkspace("sim-ext-guard");
  const reportDir = join(ws.rootPath, "060_reports");
  mkdirSync(reportDir, { recursive: true });
  const xlsx = join(reportDir, "result.xlsx");
  writeFileSync(xlsx, "binary-ish");
  const wp = db.addWorkspacePath(ws.id, "report", xlsx, "file");

  await assert.rejects(
    () => lab.runSimulationLab({
      pathId: wp.id,
      scenario: "consumer_campaign",
      model: "m",
      lifeForms: [{ id: "lf", name: "n", persona: "p", source: "manual_persona" }],
    }, { runPi: async () => "{}" }),
    /only supports text reports/,
  );
});

test("runSimulationLab: rejects empty lifeForms even if path is valid", async () => {
  const ws = db.createWorkspace("sim-empty-lf");
  const reportDir = join(ws.rootPath, "060_reports");
  mkdirSync(reportDir, { recursive: true });
  const md = join(reportDir, "plan.md");
  writeFileSync(md, "# plan\nbody");
  const wp = db.addWorkspacePath(ws.id, "report", md, "file");

  await assert.rejects(
    () => lab.runSimulationLab({
      pathId: wp.id,
      scenario: "consumer_campaign",
      model: "m",
      lifeForms: [],
    }, { runPi: async () => "{}" }),
    /At least one DigitalLifeForm/,
  );
});

test("runSimulationLab: happy path — JSON repair recovers loose output, artifacts land, fake runPi is the only LLM call", async () => {
  const ws = db.createWorkspace("sim-happy");
  const reportDir = join(ws.rootPath, "060_reports");
  mkdirSync(reportDir, { recursive: true });
  const md = join(reportDir, "plan.md");
  writeFileSync(md, "# 双 11 营销方案\n面向高线女白领的会员日权益设计…");
  const wp = db.addWorkspacePath(ws.id, "report", md, "file");

  const looseOutput = 'Sure:\n```json\n{"verdict":"go","overallScore":78,"summary":"ok","roleAssessments":[{"lifeFormId":"lf-1","name":"Alice","stance":"support","score":80,"rationale":"r","acceptanceConditions":[],"objections":[],"evidenceQuotes":[],"suggestions":[],}],"risks":["r1",],"recommendedChanges":[],"validationExperiments":[]}\n```';

  let calls = 0;
  const result = await lab.runSimulationLab({
    pathId: wp.id,
    scenario: "consumer_campaign",
    model: "m",
    lifeForms: [{ id: "lf-1", name: "Alice", persona: "high-tier white-collar", source: "manual_persona" }],
    prompt: "本次重点是双 11 会员日",
  }, {
    runPi: async (opts) => {
      calls++;
      // assert prompt structure inline: must include scenario, lifeForm, and report body excerpt
      assert.match(opts.systemPrompt, /模拟实验裁判/);
      assert.match(opts.text, /consumer_campaign/);
      assert.match(opts.text, /Alice/);
      assert.match(opts.text, /双 11 营销方案/);
      assert.doesNotMatch(opts.text, /toolIds/i);
      return looseOutput;
    },
  });
  assert.equal(calls, 1, "exactly one LLM turn — no subagent runner, no repair call needed");
  assert.equal(result.verdict, "go");
  assert.equal(result.overallScore, 78);
  assert.ok(result.artifactPaths?.json && result.artifactPaths?.markdown);
  // artifact paths are relative, not absolute
  assert.ok(!result.artifactPaths!.json!.startsWith("/"));
  assert.ok(!result.artifactPaths!.markdown!.startsWith("/"));
  // artifacts physically written under report dir
  const jsonAbs = join(reportDir, result.artifactPaths!.json!);
  const mdAbs = join(reportDir, result.artifactPaths!.markdown!);
  assert.ok(existsSync(jsonAbs), "json artifact should exist at " + jsonAbs);
  assert.ok(existsSync(mdAbs), "md artifact should exist at " + mdAbs);
  const persisted = JSON.parse(readFileSync(jsonAbs, "utf8"));
  assert.equal(persisted.verdict, "go");
  assert.equal(persisted.scenario, "consumer_campaign");
});

// Source-level check: simulation-lab and its route handler must not invoke a subagent runner.
test("source guard: simulation-lab.ts does not import subagent runner / autonomous runner", () => {
  const url = new URL("./simulation-lab.ts", import.meta.url);
  const src = readFileSync(url, "utf8");
  assert.doesNotMatch(src, /runSubAgentTurn/);
  assert.doesNotMatch(src, /runDelegatedSubAgent/);
  assert.doesNotMatch(src, /runAutonomousTask/);
  assert.doesNotMatch(src, /from\s+["']\.\/subagent-core/);
  assert.doesNotMatch(src, /from\s+["']\.\/autonomous-runner/);
});

test("source guard: simulation-lab.ts does not read draw_data folder paths", () => {
  const url = new URL("./simulation-lab.ts", import.meta.url);
  const src = readFileSync(url, "utf8");
  // Hard wall: source must contain an explicit guard restricting to report folder.
  assert.match(src, /folder !== "report"/);
});
