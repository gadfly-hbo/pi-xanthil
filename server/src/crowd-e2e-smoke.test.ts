import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

process.env.XANTHIL_DATA_DIR = mkdtempSync(join(tmpdir(), "pi-xanthil-crowd-e2e-"));

const db = await import("./db.ts");
const data = await import("./db/data.ts");
const { computeFieldProfiles } = await import("./crowd-import.ts");
const { evaluateSegment } = await import("./crowd-segment.ts");
const { runCrowdProfileGeneration } = await import("./crowd-profile-runner.ts");
const { runSimulationLab } = await import("./simulation-lab.ts");
const { coerceSubAgentTemplate } = await import("./subagent-core.ts");

test("the-crowd e2e smoke: dataset → profile → subagent draft → simulation feedback → adopted version", async () => {
  const workspace = db.createWorkspace("crowd-e2e");

  const rows = [
    { user_id: "u_001", life_stage: "new_parent", city_tier: "T1", spend: 2300 },
    { user_id: "u_002", life_stage: "new_parent", city_tier: "T1", spend: 2100 },
    { user_id: "u_003", life_stage: "new_parent", city_tier: "T2", spend: 1800 },
    { user_id: "u_004", life_stage: "student", city_tier: "T2", spend: 300 },
  ];
  const fieldProfiles = computeFieldProfiles({ columns: ["user_id", "life_stage", "city_tier", "spend"], rows });
  assert.deepEqual(fieldProfiles.find((p) => p.field === "user_id")?.topValues, []);

  const dataset = data.createCrowdDataset(workspace.id, {
    name: "mock crowd tags",
    source: "upload_csv",
    rowCount: rows.length,
    fieldCount: fieldProfiles.length,
    fieldProfiles,
  });

  const tagDictionary = data.saveCrowdTagDictionary(workspace.id, dataset.id, [
    { field: "life_stage", label: "生命周期", dimension: "lifecycle", sensitivity: "internal", valueLabels: { new_parent: "新手父母", student: "学生" }, enabled: true },
    { field: "city_tier", label: "城市线级", dimension: "demographic", sensitivity: "internal", valueLabels: { T1: "一线", T2: "二线" }, enabled: true },
    { field: "spend", label: "消费金额", dimension: "consumption_power", sensitivity: "internal", enabled: true },
  ]);
  assert.equal(tagDictionary.length, 3);

  const rule = { logic: "and" as const, conditions: [{ field: "life_stage", operator: "eq" as const, value: "new_parent" }] };
  const evaluated = evaluateSegment(rule, dataset.fieldProfiles, dataset.rowCount);
  const segment = data.createCrowdSegment(workspace.id, { datasetId: dataset.id, name: "新手父母", rule });
  const updatedSegment = data.updateCrowdSegment(segment.id, {
    sampleCount: evaluated.sampleCount,
    coverageRatio: evaluated.coverageRatio,
    tagDistribution: evaluated.tagDistribution,
  }) ?? segment;

  let profilePrompt = "";
  const generated = await runCrowdProfileGeneration(
    { segmentId: updatedSegment.id, model: "ep-smoke", businessContext: "亲子活动方案" },
    {
      workspaceId: workspace.id,
      runPi: async ({ text }) => {
        profilePrompt = text;
        return JSON.stringify({
          traits: ["年轻家庭", "重视品质"],
          motivations: ["降低育儿决策成本", "追求可信推荐"],
          decisionTriggers: ["亲子权益明确", "限时礼包"],
          objections: ["担心价格偏高", "担心服务不稳定"],
          tone: "可信、克制、明确",
          contentPreference: ["清单式内容", "真实场景案例"],
          riskNotes: ["避免夸大个体代表性"],
          evidenceSummary: ["新手父母分群覆盖率为75.0%", "消费金额范围来自聚合字段画像"],
          persona: "这是一组以新手父母为核心的人群画像，关注品质、效率和可信度。",
        });
      },
    },
  );
  assert.equal(generated.profile.segmentId, updatedSegment.id);
  assert.ok(generated.version.content.persona.includes("新手父母"));
  assert.equal(profilePrompt.includes("u_001"), false);
  assert.equal(profilePrompt.includes("user_id"), false);

  const draft = data.buildCrowdSubAgentDraft(generated.profile.id, generated.version.id);
  assert.ok(draft);
  assert.deepEqual(Object.keys(draft).sort(), ["crowdProfileId", "crowdProfileVersionId", "name", "persona", "source"].sort());

  const template = coerceSubAgentTemplate({
    id: "sa-crowd-smoke",
    name: draft.name,
    persona: draft.persona,
    toolIds: ["should-not-run"],
    dataScope: "draw_data",
    origin: "crowd_profile",
    crowdProfileId: draft.crowdProfileId,
    crowdProfileVersionId: draft.crowdProfileVersionId,
  });
  assert.ok(template);
  assert.equal(template.dataScope, "clean_data");
  assert.equal(template.origin, "crowd_profile");
  assert.equal(template.crowdProfileId, generated.profile.id);
  assert.equal(template.crowdProfileVersionId, generated.version.id);

  const profileWithPublish = data.updateCrowdProfile(generated.profile.id, { publishedSubAgentTemplateId: template.id });
  assert.equal(profileWithPublish?.publishedSubAgentTemplateId, template.id);

  const reportDir = join(workspace.rootPath, "reports");
  mkdirSync(reportDir, { recursive: true });
  writeFileSync(join(reportDir, "plan.md"), "亲子会员活动方案：提供新手礼包、门店体验课和售后保障。", "utf8");
  const reportPath = db.addWorkspacePath(workspace.id, "report", reportDir, "dir");

  let simulationPrompt = "";
  const simulation = await runSimulationLab(
    {
      pathId: reportPath.id,
      relPath: "plan.md",
      scenario: "consumer_campaign",
      model: "ep-smoke",
      lifeForms: [{
        id: `crowd:${generated.profile.id}`,
        name: generated.profile.name,
        persona: generated.version.content.persona,
        source: "crowd_profile",
        crowdProfileId: generated.profile.id,
        crowdProfileVersionId: generated.version.id,
      }],
      prompt: "评估活动接受度",
    },
    {
      runPi: async ({ text }) => {
        simulationPrompt = text;
        return JSON.stringify({
          verdict: "revise",
          overallScore: 72,
          summary: "整体可行，但需降低价格疑虑。",
          roleAssessments: [{
            lifeFormId: `crowd:${generated.profile.id}`,
            name: generated.profile.name,
            stance: "conditional",
            score: 72,
            rationale: "权益清晰时愿意尝试。",
            acceptanceConditions: ["礼包价值需可感知"],
            objections: ["担心价格偏高"],
            evidenceQuotes: ["新手礼包"],
            suggestions: ["增加体验课说明"],
          }],
          risks: ["过度促销可能稀释品牌感"],
          recommendedChanges: ["明确礼包价值"],
          validationExperiments: ["小范围 A/B 测试"],
        });
      },
    },
  );
  assert.equal(simulation.roleAssessments.length, 1);
  assert.match(simulation.id, /^simulation_/);
  assert.equal(simulationPrompt.includes("toolIds"), false);
  assert.equal(simulationPrompt.includes("draw_data"), false);
  assert.equal(simulationPrompt.includes("dataset"), false);

  const feedback = data.createCrowdProfileFeedback(workspace.id, generated.profile.id, {
    profileVersionId: generated.version.id,
    sourceRunId: simulation.id,
    sourceLifeFormId: simulation.roleAssessments[0]!.lifeFormId,
    objections: simulation.roleAssessments[0]!.objections,
    acceptanceConditions: simulation.roleAssessments[0]!.acceptanceConditions,
    suggestions: simulation.roleAssessments[0]!.suggestions,
  });
  assert.equal(feedback.status, "pending");
  assert.equal(feedback.sourceRunId, simulation.id);

  const adopted = data.adoptFeedbackToVersion(feedback.id, workspace.id, generated.profile.id);
  assert.ok(adopted);
  assert.equal(adopted.profile.currentVersionId, adopted.version.id);
  assert.ok(adopted.version.version > generated.version.version);
  assert.ok(adopted.version.content.persona.includes("新手父母"));
  assert.ok(adopted.version.content.objections.includes("担心价格偏高"));
  assert.equal(data.getCrowdProfileFeedback(feedback.id)?.status, "adopted");
});
