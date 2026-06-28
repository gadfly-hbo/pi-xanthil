import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { CrowdTagDictionaryEntry } from "./types.ts";

process.env.XANTHIL_DATA_DIR = mkdtempSync(join(tmpdir(), "pi-xanthil-crowd-profile-test-"));

const db = await import("./db.ts");
const runner = await import("./crowd-profile-runner.ts");

// ── helpers ────────────────────────────────────────────────────────────────

function baseBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    segmentId: "seg-test",
    model: "ep-test",
    ...overrides,
  };
}

// ── parse tests ────────────────────────────────────────────────────────────

test("parse: rejects missing segmentId", () => {
  const b = baseBody();
  delete (b as Record<string, unknown>).segmentId;
  assert.throws(() => runner.parseCrowdProfileRequest(b), /segmentId.*required/);
});

test("parse: rejects blank segmentId", () => {
  assert.throws(() => runner.parseCrowdProfileRequest(baseBody({ segmentId: "  " })), /segmentId.*required/);
});

test("parse: rejects missing model", () => {
  assert.throws(() => runner.parseCrowdProfileRequest(baseBody({ model: "  " })), /model required/);
});

test("parse: rejects non-string segmentId", () => {
  assert.throws(() => runner.parseCrowdProfileRequest(baseBody({ segmentId: 123 })), /segmentId.*required/);
});

test("parse: happy path with businessContext", () => {
  const parsed = runner.parseCrowdProfileRequest(baseBody({ businessContext: "  促销活动  " }));
  assert.equal(parsed.segmentId, "seg-test");
  assert.equal(parsed.model, "ep-test");
  assert.equal(parsed.businessContext, "促销活动");
});

test("parse: happy path without businessContext", () => {
  const parsed = runner.parseCrowdProfileRequest(baseBody());
  assert.equal(parsed.businessContext, undefined);
});

test("parse: strips whitespace from segmentId and model", () => {
  const parsed = runner.parseCrowdProfileRequest(baseBody({ segmentId: "  seg-1  ", model: "  ep-1  " }));
  assert.equal(parsed.segmentId, "seg-1");
  assert.equal(parsed.model, "ep-1");
});

// ── JSON extraction tests ──────────────────────────────────────────────────

test("extractJsonObject: parses valid JSON", () => {
  const result = runner.extractJsonObject('{"traits":["a"]}');
  assert.deepEqual(result, { traits: ["a"] });
});

test("extractJsonObject: extracts from markdown fence", () => {
  const result = runner.extractJsonObject('```json\n{"traits":["a"]}\n```');
  assert.deepEqual(result, { traits: ["a"] });
});

test("extractJsonObject: repairs trailing comma", () => {
  const result = runner.extractJsonObject('{"traits":["a",]}');
  assert.deepEqual(result, { traits: ["a"] });
});

test("extractJsonObject: throws on non-JSON", () => {
  assert.throws(() => runner.extractJsonObject("no json here"), /does not contain JSON/);
});

test("extractJsonObject: throws on unparseable JSON", () => {
  assert.throws(() => runner.extractJsonObject("{broken"), /does not contain JSON|could not be parsed/);
});

// ── prompt building tests (pure function · no raw rows) ────────────────────

test("buildCrowdProfilePrompts: contains aggregate data only", () => {
  const segment = {
    id: "seg-1",
    workspaceId: "ws-1",
    datasetId: "ds-1",
    name: "高价值用户",
    description: "消费力强的用户群",
    rule: { logic: "and" as const, conditions: [{ field: "amount", operator: "range" as const, min: 1000 }] },
    sampleCount: 5000,
    coverageRatio: 0.15,
    tagDistribution: {
      "gender": [
        { value: "男", count: 2500, ratio: 0.5 },
        { value: "女", count: 2500, ratio: 0.5 },
      ],
    },
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  const fieldProfiles = [
    { field: "amount", inferredType: "number" as const, missingCount: 0, uniqueCount: 4800, topValues: [{ value: "2000", count: 100, ratio: 0.02 }], numericRange: { min: 100, max: 50000 } },
    { field: "gender", inferredType: "string" as const, missingCount: 0, uniqueCount: 2, topValues: [{ value: "男", count: 2500, ratio: 0.5 }, { value: "女", count: 2500, ratio: 0.5 }] },
  ];
  const tagDictionary: CrowdTagDictionaryEntry[] = [
    { id: "td-1", workspaceId: "ws-1", datasetId: "ds-1", field: "gender", label: "性别", description: "用户性别", dimension: "demographic" as const, sensitivity: "public" as const, weight: 1, valueLabels: { "男": "男性", "女": "女性" }, enabled: true, createdAt: Date.now(), updatedAt: Date.now() },
  ];

  const { systemPrompt, userPrompt } = runner.buildCrowdProfilePrompts({
    segment,
    fieldProfiles,
    tagDictionary,
    businessContext: "大促期间",
  });

  // Must contain aggregate summaries
  assert.ok(userPrompt.includes("高价值用户"), "contains segment name");
  assert.ok(userPrompt.includes("5000"), "contains sample count");
  assert.ok(userPrompt.includes("15.0%"), "contains coverage ratio");
  assert.ok(userPrompt.includes("amount"), "contains field profile");
  assert.ok(userPrompt.includes("性别"), "contains tag dictionary");
  assert.ok(userPrompt.includes("男(50.0%)"), "contains tag distribution");
  assert.ok(userPrompt.includes("大促期间"), "contains business context");
  assert.ok(systemPrompt.includes("聚合口径"), "system prompt mentions aggregate caliber");

  // Must NOT contain raw row indicators
  assert.ok(!userPrompt.includes("row"), "no raw row reference");
  assert.ok(!userPrompt.includes("record"), "no raw record reference");
  assert.ok(!userPrompt.includes("individual"), "no individual reference");
  assert.ok(!userPrompt.includes("sample"), "no sample reference");
});

test("buildCrowdProfilePrompts: handles empty data gracefully", () => {
  const segment = {
    id: "seg-1", workspaceId: "ws-1", datasetId: "ds-1",
    name: "空分群", description: "",
    rule: { logic: "and" as const, conditions: [] },
    sampleCount: 0, coverageRatio: 0, tagDistribution: {},
    createdAt: Date.now(), updatedAt: Date.now(),
  };
  const { userPrompt } = runner.buildCrowdProfilePrompts({
    segment,
    fieldProfiles: [],
    tagDictionary: [],
  });
  assert.ok(userPrompt.includes("空分群"), "contains segment name");
  assert.ok(userPrompt.includes("无字段画像数据"), "handles empty field profiles");
  assert.ok(userPrompt.includes("无标签字典"), "handles empty tag dictionary");
  assert.ok(userPrompt.includes("无标签分布数据"), "handles empty tag distribution");
  assert.ok(userPrompt.includes("无筛选条件"), "handles empty rule conditions");
});

test("buildCrowdProfilePrompts: omits businessContext section when undefined", () => {
  const segment = {
    id: "seg-1", workspaceId: "ws-1", datasetId: "ds-1",
    name: "测试", description: "",
    rule: { logic: "and" as const, conditions: [] },
    sampleCount: 0, coverageRatio: 0, tagDistribution: {},
    createdAt: Date.now(), updatedAt: Date.now(),
  };
  const { userPrompt } = runner.buildCrowdProfilePrompts({
    segment,
    fieldProfiles: [],
    tagDictionary: [],
  });
  assert.ok(!userPrompt.includes("业务场景说明"), "no business context section");
});

// ── normalize tests ────────────────────────────────────────────────────────

test("normalizeCrowdProfileContent: fills defaults for empty input", () => {
  const content = runner.normalizeCrowdProfileContent({});
  assert.ok(content.traits.length > 0, "traits has default");
  assert.ok(content.motivations.length > 0, "motivations has default");
  assert.ok(content.decisionTriggers.length > 0, "decisionTriggers has default");
  assert.ok(content.objections.length > 0, "objections has default");
  assert.ok(content.tone.length > 0, "tone has default");
  assert.ok(content.contentPreference.length > 0, "contentPreference has default");
  assert.ok(content.evidenceSummary.length > 0, "evidenceSummary has default");
  assert.ok(content.persona.length > 0, "persona has default");
});

test("normalizeCrowdProfileContent: preserves valid data", () => {
  const input = {
    traits: ["高消费力", "年轻化"],
    motivations: ["追求品质"],
    decisionTriggers: ["限时折扣"],
    objections: ["价格敏感"],
    tone: "活力四射",
    contentPreference: ["短视频", "直播"],
    riskNotes: ["竞争激烈"],
    evidenceSummary: ["高消费占比32%"],
    persona: "这是一段人群侧写。",
  };
  const content = runner.normalizeCrowdProfileContent(input);
  assert.deepEqual(content.traits, ["高消费力", "年轻化"]);
  assert.deepEqual(content.motivations, ["追求品质"]);
  assert.deepEqual(content.tone, "活力四射");
  assert.deepEqual(content.persona, "这是一段人群侧写。");
});

test("normalizeCrowdProfileContent: truncates arrays to max length", () => {
  const input = {
    traits: Array.from({ length: 15 }, (_, i) => `trait-${i}`),
    motivations: Array.from({ length: 15 }, (_, i) => `mot-${i}`),
    decisionTriggers: Array.from({ length: 15 }, (_, i) => `dt-${i}`),
    objections: Array.from({ length: 15 }, (_, i) => `obj-${i}`),
    tone: "t",
    contentPreference: Array.from({ length: 10 }, (_, i) => `cp-${i}`),
    riskNotes: Array.from({ length: 15 }, (_, i) => `rn-${i}`),
    evidenceSummary: Array.from({ length: 20 }, (_, i) => `ev-${i}`),
    persona: "p",
  };
  const content = runner.normalizeCrowdProfileContent(input);
  assert.equal(content.traits.length, 8);
  assert.equal(content.motivations.length, 8);
  assert.equal(content.decisionTriggers.length, 8);
  assert.equal(content.objections.length, 8);
  assert.equal(content.contentPreference.length, 5);
  assert.equal(content.riskNotes.length, 8);
  assert.equal(content.evidenceSummary.length, 10);
});

test("normalizeCrowdProfileContent: filters empty strings from arrays", () => {
  const content = runner.normalizeCrowdProfileContent({
    traits: ["a", "", "  ", "b"],
    motivations: [],
  });
  assert.deepEqual(content.traits, ["a", "b"]);
  assert.ok(content.motivations.length > 0, "motivations has fallback");
});

// ── prompt payload safety: no raw rows ─────────────────────────────────────

test("prompt never contains raw row data patterns", () => {
  const segment = {
    id: "seg-1", workspaceId: "ws-1", datasetId: "ds-1",
    name: "测试分群", description: "",
    rule: { logic: "and" as const, conditions: [
      { field: "user_id", operator: "eq" as const, value: "u_001" },
      { field: "tag_a", operator: "eq" as const, value: "v1" },
    ] },
    sampleCount: 100, coverageRatio: 0.5,
    tagDistribution: {
      "tag_a": [{ value: "v1", count: 50, ratio: 0.5 }],
      "user_id": [{ value: "u_001", count: 1, ratio: 0.01 }],
    },
    createdAt: Date.now(), updatedAt: Date.now(),
  };
  const fieldProfiles = [
    { field: "row_id", inferredType: "string" as const, missingCount: 0, uniqueCount: 100, topValues: [{ value: "r_001", count: 1, ratio: 0.01 }] },
    { field: "record_id", inferredType: "string" as const, missingCount: 0, uniqueCount: 100, topValues: [{ value: "rec_001", count: 1, ratio: 0.01 }] },
    { field: "primary_key", inferredType: "string" as const, missingCount: 0, uniqueCount: 100, topValues: [{ value: "pk_001", count: 1, ratio: 0.01 }] },
    { field: "tag_a", inferredType: "string" as const, missingCount: 0, uniqueCount: 2, topValues: [{ value: "v1", count: 50, ratio: 0.5 }] },
  ];
  const tagDictionary: CrowdTagDictionaryEntry[] = [
    { id: "td-raw", workspaceId: "ws-1", datasetId: "ds-1", field: "user_id", label: "用户ID", description: "原始用户标识", dimension: "custom" as const, sensitivity: "sensitive" as const, weight: 1, valueLabels: { "u_001": "用户001" }, enabled: true, createdAt: Date.now(), updatedAt: Date.now() },
    { id: "td-1", workspaceId: "ws-1", datasetId: "ds-1", field: "tag_a", label: "标签A", description: "", dimension: "custom" as const, sensitivity: "public" as const, weight: 1, valueLabels: {}, enabled: true, createdAt: Date.now(), updatedAt: Date.now() },
  ];

  const { userPrompt } = runner.buildCrowdProfilePrompts({ segment, fieldProfiles, tagDictionary });

  // Aggregate data is present
  assert.ok(userPrompt.includes("tag_a"), "field name present");
  assert.ok(userPrompt.includes("v1"), "aggregated value present");
  assert.ok(userPrompt.includes("50.0%"), "ratio present");

  // But no raw row patterns
  const lower = userPrompt.toLowerCase();
  assert.ok(!lower.includes("row_id"), "no row_id");
  assert.ok(!lower.includes("record_id"), "no record_id");
  assert.ok(!lower.includes("user_id"), "no user_id");
  assert.ok(!lower.includes("primary_key"), "no primary_key");
  assert.ok(!lower.includes("u_001"), "no raw identifier value");
  assert.ok(!lower.includes("pk_001"), "no raw primary key value");
});
