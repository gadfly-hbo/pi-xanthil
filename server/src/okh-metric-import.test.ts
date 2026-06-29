import { describe, it, beforeEach, afterEach } from "node:test";
import { strict as assert } from "node:assert";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.XANTHIL_DATA_DIR = mkdtempSync(join(tmpdir(), "pi-xanthil-okh-metric-import-test-"));

const baseDb = await import("./db.ts");
const {
  commitOkhMetricImport,
  exportOkhMetrics,
  listOkhMetrics,
  previewOkhMetricImport,
} = await import("./db/data.ts");

let workspace: ReturnType<typeof baseDb.createWorkspace>;

beforeEach(() => {
  workspace = baseDb.createWorkspace(`okh4-test-${Date.now()}`);
});

afterEach(() => {
  try { baseDb.archiveWorkspace(workspace.id); } catch { /* ignore */ }
});

describe("OKH metric import/export", () => {
  it("previews CSV without writing metric_definitions", () => {
    const csv = [
      "name,category,description,formula,caliber,unit",
      "复购率,会员运营,复购会员占比,count_repeat/count_member,自然月,%",
    ].join("\n");

    const preview = previewOkhMetricImport(workspace.id, csv, "csv");

    assert.equal(preview.totalRows, 1);
    assert.equal(preview.validRows, 1);
    assert.equal(preview.invalidRows, 0);
    assert.equal(listOkhMetrics(workspace.id, false).length, 0);
  });

  it("commits valid rows and enables metrics by default", () => {
    const preview = previewOkhMetricImport(
      workspace.id,
      JSON.stringify([{ name: "客单价", category: "电商运营", description: "平均订单金额", formula: "sum(paid_amount)/count(order_id)", caliber: "支付订单", unit: "元/单" }]),
      "json",
    );

    const result = commitOkhMetricImport({ workspaceId: workspace.id, rows: preview.rows });

    assert.equal(result.created.length, 1);
    assert.equal(result.skipped.length, 0);
    assert.equal(result.errors.length, 0);
    assert.equal(listOkhMetrics(workspace.id, true).map((m) => m.name).includes("客单价"), true);
  });

  it("skips duplicate names unless create_version is requested", () => {
    const rows = [
      { name: "销售额", category: "零售经营", description: "销售额", formula: "sum(a)", caliber: "支付订单", unit: "元" },
      { name: "销售额", category: "零售经营", description: "销售额v2", formula: "sum(b)", caliber: "支付订单", unit: "元" },
    ];

    const skippedResult = commitOkhMetricImport({ workspaceId: workspace.id, rows, conflictPolicy: "skip" });
    assert.equal(skippedResult.created.length, 1);
    assert.equal(skippedResult.skipped.length, 1);

    const versionedResult = commitOkhMetricImport({ workspaceId: workspace.id, rows: [rows[1]], conflictPolicy: "create_version" });
    assert.equal(versionedResult.created.length, 1);
    assert.equal(versionedResult.created[0]?.version, 2);
  });

  it("exports enabled metrics only by default and can include disabled workspace metrics", () => {
    commitOkhMetricImport({
      workspaceId: workspace.id,
      rows: [
        { name: "启用指标", category: "测试", description: "enabled", formula: "sum(a)", caliber: "测试", unit: "元" },
      ],
      enable: true,
    });
    commitOkhMetricImport({
      workspaceId: workspace.id,
      rows: [
        { name: "未启用指标", category: "测试", description: "disabled", formula: "sum(b)", caliber: "测试", unit: "元" },
      ],
      enable: false,
    });

    const enabledJson = JSON.parse(exportOkhMetrics(workspace.id, true, "json")) as Array<{ name: string }>;
    const allCsv = exportOkhMetrics(workspace.id, false, "csv");

    assert.deepEqual(enabledJson.map((m) => m.name), ["启用指标"]);
    assert.match(allCsv, /启用指标/);
    assert.match(allCsv, /未启用指标/);
  });
});
