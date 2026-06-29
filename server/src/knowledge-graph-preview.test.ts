import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const dataDir = mkdtempSync(join(tmpdir(), "pi-xanthil-kg-preview-test-"));
process.env.XANTHIL_DATA_DIR = dataDir;

const db = await import("./db.ts");
const data = await import("./db/data.ts");
const kg = await import("./knowledge-graph.ts");

test("D-KG3: preview is read-only and does not call extraction", () => {
  const ws = db.createWorkspace("kg preview");
  const reportPath = join(dataDir, "report.md");
  writeFileSync(reportPath, "# Report\n\nOnly used to prove the file exists.");

  const node = db.upsertKgNode({
    workspaceId: ws.id,
    type: "report",
    sourceKey: `report:${reportPath}`,
    title: "Preview Report",
    summary: "metadata only",
    tags: [],
    contentHash: "hash-1",
  });

  const nodesBefore = db.listKgNodes(ws.id, true);
  const edgesBefore = db.listKgEdges(ws.id);
  const preview = kg.previewKgExtraction(ws.id);

  assert.equal(preview.processLimit, 5);
  assert.equal(preview.estimatedProcessCount, 1);
  assert.deepEqual(preview.reports.map((r) => ({ id: r.id, status: r.status, reason: r.reason })), [
    { id: node.id, status: "will_process", reason: "pending" },
  ]);
  assert.deepEqual(db.listKgNodes(ws.id, true), nodesBefore);
  assert.deepEqual(db.listKgEdges(ws.id), edgesBefore);
});

test("D-KG4: KG history is workspace-isolated", () => {
  const a = db.createWorkspace("kg history a");
  const b = db.createWorkspace("kg history b");

  data.recordKgHistoryEvent({
    workspaceId: a.id,
    eventType: "sync",
    targetKind: "graph",
    title: "Sync A",
    summary: "metadata only",
    metadata: { nodeCount: 1 },
  });
  data.recordKgHistoryEvent({
    workspaceId: b.id,
    eventType: "extract",
    targetKind: "graph",
    title: "Extract B",
    summary: "metadata only",
    metadata: { processedReports: 1 },
  });

  const aEvents = data.listKgHistoryEvents(a.id, 50);
  const bEvents = data.listKgHistoryEvents(b.id, 50);
  assert.equal(aEvents.length, 1);
  assert.equal(bEvents.length, 1);
  assert.equal(aEvents[0]?.workspaceId, a.id);
  assert.equal(bEvents[0]?.workspaceId, b.id);
});
