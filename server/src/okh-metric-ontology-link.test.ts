import { afterEach, beforeEach, describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.XANTHIL_DATA_DIR = mkdtempSync(join(tmpdir(), "pi-xanthil-okh-metric-ontology-link-test-"));

const baseDb = await import("./db.ts");
const { setMemoryEnablement } = await import("./db/shared.ts");
const {
  createMetric,
  createObjectType,
  createOntology,
} = await import("./db/viz.ts");
const {
  deleteOkhMetricOntologyLink,
  listOkhMetricOntologyLinks,
  listOkhMetricOntologyLinksByOntology,
  listOkhMetricOntologyLinksByTarget,
  replaceOkhMetricOntologyLinks,
} = await import("./db/data.ts");

let workspace: ReturnType<typeof baseDb.createWorkspace>;
let otherWorkspace: ReturnType<typeof baseDb.createWorkspace>;

function createTestMetric(workspaceId: string, name: string) {
  return createMetric(workspaceId, {
    name,
    category: "测试",
    description: `${name} description`,
    formula: "sum(value)",
    caliber: "测试口径",
    unit: "元",
  });
}

beforeEach(() => {
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  workspace = baseDb.createWorkspace(`okh6-test-${suffix}`);
  otherWorkspace = baseDb.createWorkspace(`okh6-other-${suffix}`);
});

afterEach(() => {
  try { baseDb.archiveWorkspace(workspace.id); } catch { /* ignore */ }
  try { baseDb.archiveWorkspace(otherWorkspace.id); } catch { /* ignore */ }
});

describe("OKH metric ontology links", () => {
  it("replaces, deduplicates, lists, clears and deletes manual links", () => {
    const metric = createTestMetric(workspace.id, "销售额");
    const ontology = createOntology(workspace.id, "零售本体");
    const object = createObjectType(ontology.id, { kind: "concept", nameCn: "订单" });

    const inserted = replaceOkhMetricOntologyLinks(workspace.id, metric.id, [
      { ontologyId: ontology.id, targetKind: "object", targetId: object.id },
      { ontologyId: ontology.id, targetKind: "object", targetId: object.id },
    ]);

    assert.equal(inserted.length, 1);
    assert.equal(inserted[0]?.metricId, metric.id);
    assert.equal(inserted[0]?.ontologyId, ontology.id);
    assert.equal(inserted[0]?.targetKind, "object");
    assert.equal(inserted[0]?.targetId, object.id);
    assert.equal(listOkhMetricOntologyLinks(workspace.id, metric.id).length, 1);

    assert.equal(deleteOkhMetricOntologyLink(workspace.id, inserted[0]!.id), true);
    assert.equal(listOkhMetricOntologyLinks(workspace.id, metric.id).length, 0);

    replaceOkhMetricOntologyLinks(workspace.id, metric.id, [
      { ontologyId: ontology.id, targetKind: "object", targetId: object.id },
    ]);
    assert.equal(replaceOkhMetricOntologyLinks(workspace.id, metric.id, []).length, 0);
  });

  it("rejects targets outside the declared ontology without deleting existing links", () => {
    const metric = createTestMetric(workspace.id, "复购率");
    const ontology = createOntology(workspace.id, "会员本体");
    const object = createObjectType(ontology.id, { kind: "concept", nameCn: "会员" });
    const otherOntology = createOntology(workspace.id, "其他本体");
    const otherObject = createObjectType(otherOntology.id, { kind: "concept", nameCn: "商品" });

    replaceOkhMetricOntologyLinks(workspace.id, metric.id, [
      { ontologyId: ontology.id, targetKind: "object", targetId: object.id },
    ]);

    assert.throws(
      () => replaceOkhMetricOntologyLinks(workspace.id, metric.id, [
        { ontologyId: ontology.id, targetKind: "object", targetId: otherObject.id },
      ]),
      /target does not belong to ontology/,
    );

    const kept = listOkhMetricOntologyLinks(workspace.id, metric.id);
    assert.equal(kept.length, 1);
    assert.equal(kept[0]?.targetId, object.id);
  });

  it("allows cross-workspace links only when both metric and ontology are enabled for the workspace", () => {
    const sharedMetric = createTestMetric(otherWorkspace.id, "客单价");
    const sharedOntology = createOntology(otherWorkspace.id, "共享电商本体");
    const sharedObject = createObjectType(sharedOntology.id, { kind: "concept", nameCn: "订单" });

    assert.throws(
      () => replaceOkhMetricOntologyLinks(workspace.id, sharedMetric.id, [
        { ontologyId: sharedOntology.id, targetKind: "object", targetId: sharedObject.id },
      ]),
      /metric not found in workspace scope/,
    );

    setMemoryEnablement(workspace.id, "metric", sharedMetric.id, true);
    assert.throws(
      () => replaceOkhMetricOntologyLinks(workspace.id, sharedMetric.id, [
        { ontologyId: sharedOntology.id, targetKind: "object", targetId: sharedObject.id },
      ]),
      /ontology not found in workspace scope/,
    );

    setMemoryEnablement(workspace.id, "ontology", sharedOntology.id, true);
    const linked = replaceOkhMetricOntologyLinks(workspace.id, sharedMetric.id, [
      { ontologyId: sharedOntology.id, targetKind: "object", targetId: sharedObject.id },
    ]);

    assert.equal(linked.length, 1);
    assert.equal(linked[0]?.workspaceId, workspace.id);
    assert.equal(linked[0]?.metricId, sharedMetric.id);
    assert.equal(linked[0]?.ontologyId, sharedOntology.id);
    assert.equal(listOkhMetricOntologyLinks(otherWorkspace.id, sharedMetric.id).length, 0);
  });

  it("lists links by ontology and target within the current workspace scope", () => {
    const metric = createTestMetric(workspace.id, "转化率");
    const otherMetric = createTestMetric(workspace.id, "退款率");
    const ontology = createOntology(workspace.id, "交易本体");
    const object = createObjectType(ontology.id, { kind: "concept", nameCn: "订单" });

    replaceOkhMetricOntologyLinks(workspace.id, metric.id, [
      { ontologyId: ontology.id, targetKind: "object", targetId: object.id },
    ]);
    replaceOkhMetricOntologyLinks(workspace.id, otherMetric.id, [
      { ontologyId: ontology.id, targetKind: "object", targetId: object.id },
    ]);

    const byOntology = listOkhMetricOntologyLinksByOntology(workspace.id, ontology.id);
    const byTarget = listOkhMetricOntologyLinksByTarget(workspace.id, ontology.id, "object", object.id);

    assert.deepEqual(new Set(byOntology.map((link) => link.metricId)), new Set([metric.id, otherMetric.id]));
    assert.deepEqual(new Set(byTarget.map((link) => link.metricId)), new Set([metric.id, otherMetric.id]));
    assert.equal(listOkhMetricOntologyLinksByOntology(otherWorkspace.id, ontology.id).length, 0);
    assert.equal(listOkhMetricOntologyLinksByTarget(otherWorkspace.id, ontology.id, "object", object.id).length, 0);
  });
});
