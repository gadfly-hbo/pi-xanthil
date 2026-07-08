import { afterEach, beforeEach, describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as xlsx from "xlsx";
import type { MetricDefinition } from "./types.ts";

process.env.XANTHIL_DATA_DIR = mkdtempSync(join(tmpdir(), "pi-xanthil-okh9-backend-contracts-test-"));

const baseDb = await import("./db.ts");
const {
  applyOkhMetricTemplates,
  commitOkhMetricImport,
  computeOkhMetricScores,
  createOkhCustomTemplatePack,
  listOkhConflictActions,
  listOkhMetricTemplates,
  previewOkhMetricImport,
  recordOkhConflictAction,
  updateOkhCustomTemplatePack,
} = await import("./db/data.ts");
const {
  recordMetricInjectionTraces,
} = await import("./db/viz.ts");

let workspace: ReturnType<typeof baseDb.createWorkspace>;

beforeEach(() => {
  workspace = baseDb.createWorkspace(`okh9-test-${Date.now()}-${Math.random().toString(16).slice(2)}`);
});

afterEach(() => {
  try { baseDb.archiveWorkspace(workspace.id); } catch { /* ignore */ }
});

function seedMetric(name: string, enable = true): MetricDefinition {
  const result = commitOkhMetricImport({
    workspaceId: workspace.id,
    rows: [{
      name,
      category: "测试",
      description: `${name} 描述`,
      formula: "sum(a)",
      caliber: "测试口径",
      unit: "元",
    }],
    enable,
  });
  if (!result.created[0]) throw new Error("seed metric failed");
  return result.created[0];
}

describe("X-OKH9 backend contracts", () => {
  it("lists built-in and custom templates with sourceKind", () => {
    const builtIn = listOkhMetricTemplates(workspace.id, "member");
    assert.equal(builtIn.packs.every((p) => p.sourceKind === "built_in"), true);
    assert.equal(builtIn.templates.every((t) => t.sourceKind === "built_in"), true);

    const metric = seedMetric("自定义母指标");
    const custom = createOkhCustomTemplatePack(workspace.id, {
      title: "我的测试包",
      scenario: "custom",
      tags: ["test"],
      source: { metricIds: [metric.id] },
    });
    assert.equal(custom.pack.sourceKind, "custom");
    assert.equal(custom.templates.length, 1);

    const combined = listOkhMetricTemplates(workspace.id);
    assert.equal(combined.packs.some((p) => p.id === custom.pack.id && p.sourceKind === "custom"), true);
    assert.equal(combined.templates.some((t) => t.id === custom.templates[0]!.id && t.sourceKind === "custom"), true);
  });

  it("applies custom template packs", () => {
    const custom = createOkhCustomTemplatePack(workspace.id, {
      title: "应用测试包",
      source: { templateIds: ["member-repeat-purchase-rate"] },
    });

    const result = applyOkhMetricTemplates({ workspaceId: workspace.id, packId: custom.pack.id });
    assert.equal(result.created.length, 1);
    assert.equal(result.created[0]?.name, "复购率");

    const second = applyOkhMetricTemplates({ workspaceId: workspace.id, packId: custom.pack.id });
    assert.equal(second.created.length, 0);
    assert.equal(second.skipped.length, 1);
  });

  it("updates custom pack lifecycle fields", () => {
    const custom = createOkhCustomTemplatePack(workspace.id, { title: "原始包" });
    const updated = updateOkhCustomTemplatePack(workspace.id, custom.pack.id, { title: "重命名包", archived: true });
    assert.equal(updated?.title, "重命名包");
    assert.equal(updated?.archived, true);

    const listed = listOkhMetricTemplates(workspace.id);
    assert.equal(listed.packs.some((p) => p.id === custom.pack.id), false);
  });

  it("records conflict actions without destructive merge", () => {
    const metric = seedMetric("冲突指标");

    const renamed = recordOkhConflictAction(workspace.id, {
      action: "rename",
      payload: { metricId: metric.id, newName: "冲突指标新名" },
    });
    assert.equal(renamed.action, "rename");
    assert.equal(renamed.metricIds.includes(metric.id), true);

    const disabled = recordOkhConflictAction(workspace.id, {
      action: "disable",
      payload: { metricId: metric.id },
    });
    assert.equal(disabled.action, "disable");

    const versioned = recordOkhConflictAction(workspace.id, {
      action: "create_version",
      payload: { metricId: metric.id, newName: "冲突指标 v2" },
    });
    assert.equal(versioned.action, "create_version");
    assert.equal(versioned.metricIds.length, 2);

    const audit = listOkhConflictActions(workspace.id, { metricId: metric.id, limit: 10 });
    assert.equal(audit.length, 3);

    const scoreAfterDisable = computeOkhMetricScores(workspace.id, { metricId: metric.id })[0];
    assert.ok(scoreAfterDisable);
    assert.equal(scoreAfterDisable!.recommendation, "disable_candidate");
    assert.ok(scoreAfterDisable!.signals.some((s) => s.kind === "disabled"));
  });

  it("filters conflict actions by metricId before applying LIMIT", () => {
    const metricA = seedMetric("指标A");
    const metricB = seedMetric("指标B");
    for (let i = 0; i < 5; i++) {
      recordOkhConflictAction(workspace.id, {
        action: "rename",
        payload: { metricId: metricB.id, newName: `指标B-${i}` },
      });
    }
    recordOkhConflictAction(workspace.id, {
      action: "rename",
      payload: { metricId: metricA.id, newName: "指标A-1" },
    });

    const filtered = listOkhConflictActions(workspace.id, { metricId: metricA.id, limit: 2 });
    assert.equal(filtered.length, 1);
    assert.equal(filtered[0]?.metricIds.includes(metricA.id), true);
  });

  it("derives metric from primary and preserves both sources", () => {
    const primary = seedMetric("主指标");
    const secondary = seedMetric("副指标");
    const derived = recordOkhConflictAction(workspace.id, {
      action: "derive_from_primary",
      payload: { primaryMetricId: primary.id, secondaryMetricId: secondary.id, newName: "派生指标" },
    });
    assert.equal(derived.action, "derive_from_primary");
    assert.equal(derived.metricIds.length, 3);
  });

  it("previews markdown import deterministically", () => {
    const markdown = [
      "## 指标甲",
      "- 分类: 测试",
      "- 说明: 指标甲描述",
      "- 公式: sum(a)",
      "- 口径: 测试口径",
      "- 单位: 元",
      "",
      "## 指标乙",
      "| 字段 | 值 |",
      "| --- | --- |",
      "| 分类 | 测试 |",
      "| 说明 | 指标乙描述 |",
      "| 公式 | sum(b) |",
      "| 口径 | 测试口径 |",
      "| 单位 | 个 |",
    ].join("\n");
    const preview = previewOkhMetricImport(workspace.id, markdown, "markdown");
    assert.equal(preview.totalRows, 2);
    assert.equal(preview.validRows, 2);
    assert.ok(preview.rows.some((r) => r.normalized?.name === "指标甲"));
    assert.ok(preview.rows.some((r) => r.normalized?.name === "指标乙"));
  });

  it("previews excel import from base64", () => {
    // Minimal XLSX workbook with one sheet containing headers and one row.
    const sheet = xlsx.utils.aoa_to_sheet([
      ["name", "category", "description", "formula", "caliber", "unit"],
      ["Excel指标", "测试", "Excel导入测试", "sum(x)", "测试口径", "元"],
    ]);
    const workbook = xlsx.utils.book_new();
    xlsx.utils.book_append_sheet(workbook, sheet, "metrics");
    const base64 = xlsx.write(workbook, { type: "base64", bookType: "xlsx" });

    const preview = previewOkhMetricImport(workspace.id, base64, "excel");
    assert.equal(preview.totalRows, 1);
    assert.equal(preview.validRows, 1);
    assert.equal(preview.rows[0]?.normalized?.name, "Excel指标");
  });

  it("computes deterministic usage scores", () => {
    const metric = seedMetric("评分指标");
    recordMetricInjectionTraces(workspace.id, "chat", "session", "okh9-session", {
      sources: [{ kind: "standards", itemIds: [metric.id], injected: true, tokenEstimate: 128 }],
    });

    const scores = computeOkhMetricScores(workspace.id);
    const found = scores.find((s) => s.metricId === metric.id);
    assert.ok(found);
    assert.equal(found!.metricName, "评分指标");
    assert.equal(found!.score >= 0 && found!.score <= 100, true);
    assert.ok(["A", "B", "C", "D"].includes(found!.grade));
    assert.ok(["keep", "review", "downgrade", "disable_candidate"].includes(found!.recommendation));
    assert.ok(found!.signals.some((s) => s.kind === "injection_traces"));
  });
});
