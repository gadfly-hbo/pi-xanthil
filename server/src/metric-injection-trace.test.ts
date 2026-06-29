// E-OKH3：指标注入引用痕迹单元测试
import { describe, it, beforeEach, afterEach } from "node:test";
import { strict as assert } from "node:assert";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.XANTHIL_DATA_DIR = mkdtempSync(join(tmpdir(), "pi-xanthil-metric-injection-trace-test-"));

const db = await import("./db.ts");
const viz = await import("./db/viz.ts");

let workspace: ReturnType<typeof db.createWorkspace>;
let otherWorkspace: ReturnType<typeof db.createWorkspace>;

beforeEach(() => {
  workspace = db.createWorkspace("okh3-test-" + Date.now());
  otherWorkspace = db.createWorkspace("okh3-other-" + Date.now());
});

afterEach(() => {
  try { db.archiveWorkspace(workspace.id); } catch { /* ignore */ }
  try { db.archiveWorkspace(otherWorkspace.id); } catch { /* ignore */ }
});

describe("extractInjectedMetricIds", () => {
  it("returns empty when no standards source", () => {
    const snapshot = { sources: [{ kind: "rules", itemIds: ["r1"], injected: true, tokenEstimate: 100 }] };
    const result = viz.extractInjectedMetricIds(workspace.id, snapshot);
    assert.equal(result.length, 0);
  });

  it("returns empty when standards source has no itemIds", () => {
    const snapshot = { sources: [{ kind: "standards", itemIds: [], injected: true, tokenEstimate: 200 }] };
    const result = viz.extractInjectedMetricIds(workspace.id, snapshot);
    assert.equal(result.length, 0);
  });

  it("filters out non-metric IDs (reference_file IDs)", () => {
    // analysis_standards 的 reference_file ID 不应被当作 metric
    const snapshot = {
      sources: [{
        kind: "standards",
        itemIds: ["not-a-metric-id", "also-not-metric"],
        injected: true,
        tokenEstimate: 300,
      }],
    };
    const result = viz.extractInjectedMetricIds(workspace.id, snapshot);
    assert.equal(result.length, 0);
  });

  it("does not classify metrics enabled only in another workspace", () => {
    const otherMetric = viz.createMetric(otherWorkspace.id, {
      name: "跨工作区指标",
      category: "test",
      description: "",
      formula: "sum(x)",
      caliber: "",
      unit: "",
    });
    const snapshot = {
      sources: [{
        kind: "standards",
        itemIds: [otherMetric.id],
        injected: true,
        tokenEstimate: 100,
      }],
    };
    const result = viz.extractInjectedMetricIds(workspace.id, snapshot);
    assert.deepEqual(result, []);
  });

  it("captures metrics enabled in the current workspace", () => {
    const metric = viz.createMetric(workspace.id, {
      name: "当前工作区指标",
      category: "test",
      description: "",
      formula: "sum(x)",
      caliber: "",
      unit: "",
    });
    const snapshot = {
      sources: [{
        kind: "standards",
        itemIds: [metric.id, "reference-file-id"],
        injected: true,
        tokenEstimate: 120,
      }],
    };
    const result = viz.extractInjectedMetricIds(workspace.id, snapshot);
    assert.deepEqual(result, [{ metricId: metric.id, injected: true, tokenEstimate: 120, omittedReason: null }]);
  });

  it("captures injected=true and omittedReason when source is not injected", () => {
    const snapshot = {
      sources: [{
        kind: "standards",
        itemIds: [],
        injected: false,
        tokenEstimate: 0,
        omittedReason: "token budget exceeded",
      }],
    };
    const result = viz.extractInjectedMetricIds(workspace.id, snapshot);
    assert.equal(result.length, 0);
  });
});

describe("recordMetricInjectionTraces", () => {
  it("returns empty when no metrics in snapshot", () => {
    const snapshot = { sources: [{ kind: "standards", itemIds: [], injected: true, tokenEstimate: 200 }] };
    const traces = viz.recordMetricInjectionTraces(workspace.id, "chat", "session", "s1", snapshot);
    assert.equal(traces.length, 0);
  });

  it("returns empty when snapshot has non-metric IDs only", () => {
    const snapshot = {
      sources: [{
        kind: "standards",
        itemIds: ["fake-ref-id"],
        injected: true,
        tokenEstimate: 200,
      }],
    };
    const traces = viz.recordMetricInjectionTraces(workspace.id, "chat", "session", "s1", snapshot);
    assert.equal(traces.length, 0);
  });
});

describe("listMetricInjectionTraces", () => {
  it("returns empty list for workspace with no traces", () => {
    const traces = viz.listMetricInjectionTraces(workspace.id);
    assert.equal(traces.length, 0);
  });

  it("filters by metricId", () => {
    const traces = viz.listMetricInjectionTraces(workspace.id, { metricId: "m-nonexistent" });
    assert.equal(traces.length, 0);
  });

  it("respects limit parameter", () => {
    const traces = viz.listMetricInjectionTraces(workspace.id, { limit: 5 });
    assert.equal(traces.length, 0);
  });
});

describe("extractInjectedBusinessContextIds", () => {
  it("returns empty when no businessContext source", () => {
    const snapshot = { sources: [{ kind: "rules", itemIds: ["r1"], injected: true, tokenEstimate: 100 }] };
    const result = viz.extractInjectedBusinessContextIds(workspace.id, snapshot);
    assert.equal(result.length, 0);
  });

  it("does not classify businessContexts enabled only in another workspace", () => {
    const bc = db.createBusinessContext(otherWorkspace.id, { title: "跨工作区 BC", content: "", category: "org" });
    const snapshot = {
      sources: [{
        kind: "businessContext",
        itemIds: [bc.id],
        injected: true,
        tokenEstimate: 100,
      }],
    };
    const result = viz.extractInjectedBusinessContextIds(workspace.id, snapshot);
    assert.deepEqual(result, []);
  });

  it("captures businessContext itemIds and omitted metadata if enabled in current workspace", () => {
    const bc1 = db.createBusinessContext(workspace.id, { title: "BC 1", content: "", category: "org" });
    const bc2 = db.createBusinessContext(workspace.id, { title: "BC 2", content: "", category: "org" });
    const snapshot = {
      sources: [{
        kind: "businessContext",
        itemIds: [bc1.id, bc2.id],
        injected: false,
        tokenEstimate: 88,
        omittedReason: "token budget exceeded",
      }],
    };
    const result = viz.extractInjectedBusinessContextIds(workspace.id, snapshot);
    assert.deepEqual(result, [
      { businessContextId: bc1.id, injected: false, tokenEstimate: 88, omittedReason: "token budget exceeded" },
      { businessContextId: bc2.id, injected: false, tokenEstimate: 88, omittedReason: "token budget exceeded" },
    ]);
  });
});

describe("recordBusinessContextInjectionTraces", () => {
  it("returns empty when snapshot has no businessContext itemIds", () => {
    const snapshot = { sources: [{ kind: "businessContext", itemIds: [], injected: true, tokenEstimate: 0 }] };
    const traces = viz.recordBusinessContextInjectionTraces(workspace.id, "chat", "session", "s1", snapshot);
    assert.equal(traces.length, 0);
  });

  it("records business context trace metadata without reading content", () => {
    const context = db.createBusinessContext(workspace.id, {
      category: "org",
      title: "业务主体",
      content: "content should not be copied into trace",
    });
    const snapshot = {
      sources: [{
        kind: "businessContext",
        itemIds: [context.id],
        injected: true,
        tokenEstimate: 64,
      }],
    };
    const traces = viz.recordBusinessContextInjectionTraces(workspace.id, "chat", "session", "s1", snapshot);
    assert.equal(traces.length, 1);
    assert.equal(traces[0]?.businessContextId, context.id);
    assert.equal(traces[0]?.businessContextTitle, "业务主体");
    assert.equal(traces[0]?.category, "org");
    assert.equal(traces[0]?.injected, true);
    assert.equal(traces[0]?.tokenEstimate, 64);
    assert.equal(JSON.stringify(traces).includes("content should not be copied"), false);
  });
});

describe("listBusinessContextInjectionTraces", () => {
  it("filters by businessContextId, targetKind, targetId and limit", () => {
    const first = db.createBusinessContext(workspace.id, { category: "org", title: "主体", content: "A" });
    const second = db.createBusinessContext(workspace.id, { category: "goal", title: "目标", content: "B" });
    viz.recordBusinessContextInjectionTraces(workspace.id, "workflow", "flow", "flow-1", {
      sources: [{ kind: "businessContext", itemIds: [first.id], injected: true, tokenEstimate: 12 }],
    });
    viz.recordBusinessContextInjectionTraces(workspace.id, "workflow", "flow_run", "run-1", {
      sources: [{ kind: "businessContext", itemIds: [second.id], injected: false, tokenEstimate: 0, omittedReason: "budget" }],
    });

    assert.deepEqual(
      viz.listBusinessContextInjectionTraces(workspace.id, { businessContextId: first.id }).map((trace) => trace.businessContextId),
      [first.id],
    );
    assert.deepEqual(
      viz.listBusinessContextInjectionTraces(workspace.id, { targetKind: "flow_run" }).map((trace) => trace.targetKind),
      ["flow_run"],
    );
    assert.deepEqual(
      viz.listBusinessContextInjectionTraces(workspace.id, { targetId: "flow-1" }).map((trace) => trace.targetId),
      ["flow-1"],
    );
    assert.equal(viz.listBusinessContextInjectionTraces(workspace.id, { limit: 1 }).length, 1);
  });
});
