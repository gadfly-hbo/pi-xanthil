import { afterEach, beforeEach, describe, it } from "node:test";
import { strict as assert } from "node:assert";
import * as baseDb from "./db.ts";
import {
  applyMetricTemplates,
  commitOkhMetricImport,
  detectMetricConflicts,
  exportOkhMetrics,
  inspectStandardFiles,
  listMetricTemplates,
  listOkhMetricOntologyLinksByTarget,
  previewOkhMetricImport,
  replaceOkhMetricOntologyLinks,
} from "./db/data.ts";
import {
  createObjectType,
  createOntology,
  listMetricInjectionTraces,
  recordMetricInjectionTraces,
} from "./db/viz.ts";

let workspace: ReturnType<typeof baseDb.createWorkspace>;

beforeEach(() => {
  workspace = baseDb.createWorkspace(`okh8-acceptance-${Date.now()}-${Math.random().toString(16).slice(2)}`);
});

afterEach(() => {
  try { baseDb.archiveWorkspace(workspace.id); } catch { /* ignore */ }
});

describe("X-OKH8 full acceptance", () => {
  it("covers templates, conflicts, health, traces, import/export and ontology links", () => {
    const memberTemplates = listMetricTemplates("member");
    assert.equal(memberTemplates.packs.some((pack) => pack.id === "member-ops"), true);

    const templateResult = applyMetricTemplates({ workspaceId: workspace.id, packId: "member-ops", enable: true });
    assert.equal(templateResult.created.length, 2);
    assert.equal(templateResult.skipped.length, 0);
    const repeatPurchaseMetric = templateResult.created.find((metric) => metric.name === "复购率");
    assert.ok(repeatPurchaseMetric);

    const conflictResult = commitOkhMetricImport({
      workspaceId: workspace.id,
      conflictPolicy: "create_version",
      rows: [{
        name: "复购率",
        category: "会员运营",
        description: "冲突验收指标",
        formula: "count_distinct(repeat_member_id) / count_distinct(active_member_id)",
        caliber: "近30天；仅统计支付成功订单。",
        unit: "%",
        denominator: "count_distinct(active_member_id)",
      }],
    });
    assert.equal(conflictResult.created.length, 1);
    const conflicts = detectMetricConflicts(workspace.id);
    assert.equal(conflicts.some((conflict) => conflict.metricIds.includes(repeatPurchaseMetric.id)), true);

    const standard = baseDb.createAnalysisStandard(workspace.id, {
      kind: "reference_file",
      name: "不存在的会员标准文件",
      category: "会员运营",
      description: "X-OKH8 standard-health acceptance",
      formula: "",
      caliber: "",
      unit: "",
      filePath: `/tmp/pi-xanthil-okh8-missing-${Date.now()}.md`,
      fileHash: null,
    });
    const health = inspectStandardFiles(workspace.id, [standard.id]);
    assert.equal(health.length, 1);
    assert.equal(health[0]?.status, "error");
    assert.equal(health[0]?.riskFlags.includes("missing"), true);

    const traces = recordMetricInjectionTraces(workspace.id, "chat", "session", "okh8-session", {
      sources: [{ kind: "standards", itemIds: [repeatPurchaseMetric.id, standard.id], injected: true, tokenEstimate: 256 }],
    });
    assert.equal(traces.length, 1);
    assert.equal(traces[0]?.metricId, repeatPurchaseMetric.id);
    assert.equal(listMetricInjectionTraces(workspace.id, { metricId: repeatPurchaseMetric.id }).length, 1);

    const csv = [
      "name,category,description,formula,caliber,unit,displayName,aggregation,periodGrain,denominator",
      "会员价值分,会员运营,会员价值综合评分,avg(member_score),自然月,分,会员价值分,avg,month,member_id",
    ].join("\n");
    const preview = previewOkhMetricImport(workspace.id, csv, "csv");
    assert.equal(preview.validRows, 1);
    const importResult = commitOkhMetricImport({
      workspaceId: workspace.id,
      rows: preview.rows.filter((row) => row.valid).map((row) => row.normalized ?? row.input),
    });
    assert.equal(importResult.created.length, 1);
    const exportedCsv = exportOkhMetrics(workspace.id, true, "csv");
    assert.match(exportedCsv, /会员价值分/);

    const ontology = createOntology(workspace.id, "会员运营本体");
    const memberObject = createObjectType(ontology.id, { kind: "concept", nameCn: "会员" });
    const ontologyLinks = replaceOkhMetricOntologyLinks(workspace.id, repeatPurchaseMetric.id, [
      { ontologyId: ontology.id, targetKind: "object", targetId: memberObject.id },
    ]);
    assert.equal(ontologyLinks.length, 1);
    const linksByTarget = listOkhMetricOntologyLinksByTarget(workspace.id, ontology.id, "object", memberObject.id);
    assert.deepEqual(linksByTarget.map((link) => link.metricId), [repeatPurchaseMetric.id]);
  });
});
