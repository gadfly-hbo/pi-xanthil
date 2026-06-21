import { test } from "node:test";
import assert from "node:assert/strict";
import {
  computeMaintenancePlan,
  runMemoryMaintenance,
  fireMemoryMaintenance,
  resetMaintenanceThrottle,
  DEFAULT_MAINTENANCE_CONFIG,
  DEFAULT_MAINTENANCE_THROTTLE_MS,
  type MemoryMaintenanceConfig,
} from "./memory-maintenance.ts";
import type { MemoryItem } from "./types.ts";
import type { MemoryItemPatch } from "./db/data.ts";

const NOW = 1_700_000_000_000;
const DAY = 24 * 60 * 60 * 1000;

function makeItem(over: Partial<MemoryItem> = {}): MemoryItem {
  return {
    id: over.id ?? "m1",
    workspaceId: "ws1",
    type: "experience",
    title: "t",
    body: "b",
    tags: [],
    source: "derived",
    sourceEventIds: [],
    confidence: 0.5,
    riskFlags: [],
    validFrom: NOW - 100 * DAY,
    validUntil: null,
    supersedesId: null,
    usedCount: 0,
    lastUsedAt: NOW, // 默认刚用过（不 overdue）
    positiveSignals: 0,
    negativeSignals: 0,
    staleAfterDays: 90,
    scope: "global",
    enabled: true,
    createdAt: NOW - 100 * DAY,
    updatedAt: NOW,
    ...over,
  };
}

test("maintenance: promote raises confidence when positive net + used pass thresholds", () => {
  const item = makeItem({ confidence: 0.5, positiveSignals: 3, negativeSignals: 1, usedCount: 4 });
  const [change, ...rest] = computeMaintenancePlan([item], NOW);
  assert.equal(rest.length, 0);
  assert.equal(change?.action, "promote");
  assert.ok(Math.abs((change?.after.confidence ?? 0) - 0.6) < 1e-9);
});

test("maintenance: demote lowers confidence on negative net", () => {
  const item = makeItem({ confidence: 0.5, positiveSignals: 1, negativeSignals: 3, usedCount: 5 });
  const [change] = computeMaintenancePlan([item], NOW);
  assert.equal(change?.action, "demote");
  assert.ok(Math.abs((change?.after.confidence ?? 0) - 0.35) < 1e-9);
});

test("maintenance: overdue with non-positive net demotes", () => {
  const item = makeItem({ confidence: 0.6, positiveSignals: 1, negativeSignals: 1, lastUsedAt: NOW - 200 * DAY, staleAfterDays: 90 });
  const [change] = computeMaintenancePlan([item], NOW);
  assert.equal(change?.action, "demote");
});

test("maintenance: retire (validUntil=now) takes priority over demote when overdue + low confidence", () => {
  const item = makeItem({ confidence: 0.2, positiveSignals: 0, negativeSignals: 2, lastUsedAt: NOW - 200 * DAY, staleAfterDays: 90 });
  const [change] = computeMaintenancePlan([item], NOW);
  assert.equal(change?.action, "retire");
  assert.equal(change?.after.validUntil, NOW);
  assert.deepEqual(change?.patch, { validUntil: NOW });
});

test("maintenance: stable item (low net, fresh, used) yields no change", () => {
  const item = makeItem({ confidence: 0.5, positiveSignals: 1, negativeSignals: 0, usedCount: 1, lastUsedAt: NOW });
  assert.equal(computeMaintenancePlan([item], NOW).length, 0);
});

test("maintenance: already-expired item is skipped (no re-processing)", () => {
  const item = makeItem({ validUntil: NOW - DAY, confidence: 0.1, lastUsedAt: NOW - 200 * DAY });
  assert.equal(computeMaintenancePlan([item], NOW).length, 0);
});

test("maintenance: promote clamps at 1.0", () => {
  const item = makeItem({ confidence: 0.95, positiveSignals: 5, negativeSignals: 0, usedCount: 9 });
  const cfg: MemoryMaintenanceConfig = { ...DEFAULT_MAINTENANCE_CONFIG, promoteStep: 0.2 };
  const [change] = computeMaintenancePlan([item], NOW, cfg);
  assert.equal(change?.action, "promote");
  assert.equal(change?.after.confidence, 1);
});

test("runMemoryMaintenance: dryRun computes changes but applies none", () => {
  const items = [makeItem({ id: "a", positiveSignals: 3, negativeSignals: 0, usedCount: 5 })];
  const patched: string[] = [];
  const res = runMemoryMaintenance({
    workspaceId: "ws1", dryRun: true, now: NOW,
    listItems: () => items,
    patchItem: (id, _p: MemoryItemPatch) => { patched.push(id); return items[0]; },
  });
  assert.equal(res.scanned, 1);
  assert.equal(res.changes.length, 1);
  assert.equal(res.applied, 0);
  assert.equal(patched.length, 0, "dryRun must not call patchItem");
});

test("runMemoryMaintenance: apply patches each change via injected patchItem", () => {
  const items = [
    makeItem({ id: "a", positiveSignals: 3, negativeSignals: 0, usedCount: 5 }), // promote
    makeItem({ id: "b", positiveSignals: 0, negativeSignals: 3, usedCount: 5 }), // demote
    makeItem({ id: "c", positiveSignals: 1, negativeSignals: 0, usedCount: 1 }), // no-op
  ];
  const patched: Array<{ id: string; patch: MemoryItemPatch }> = [];
  const res = runMemoryMaintenance({
    workspaceId: "ws1", now: NOW,
    listItems: () => items,
    patchItem: (id, patch) => { patched.push({ id, patch }); return items[0]; },
  });
  assert.equal(res.applied, 2);
  assert.deepEqual(patched.map((p) => p.id).sort(), ["a", "b"]);
});

test("fireMemoryMaintenance: throttles repeated fires within window, fires again after window", () => {
  resetMaintenanceThrottle();
  const items = [makeItem({ id: "a", positiveSignals: 3, negativeSignals: 0, usedCount: 5 })];
  const runs: number[] = [];
  const deps = {
    listItems: () => items,
    patchItem: (_id: string, _p: MemoryItemPatch) => { runs.push(1); return items[0]; },
  };
  const first = fireMemoryMaintenance({ workspaceId: "wsT", now: NOW, ...deps });
  const second = fireMemoryMaintenance({ workspaceId: "wsT", now: NOW + 1000, ...deps });
  const third = fireMemoryMaintenance({ workspaceId: "wsT", now: NOW + DEFAULT_MAINTENANCE_THROTTLE_MS + 1, ...deps });
  assert.equal(first, true, "first fire runs");
  assert.equal(second, false, "within throttle window -> skipped");
  assert.equal(third, true, "after throttle window -> runs again");
  assert.equal(runs.length, 2, "patch applied only on the two non-throttled runs");
});

test("fireMemoryMaintenance: distinct workspaces throttle independently", () => {
  resetMaintenanceThrottle();
  const items = [makeItem({ id: "a", positiveSignals: 3, negativeSignals: 0, usedCount: 5 })];
  const deps = { listItems: () => items, patchItem: (_i: string, _p: MemoryItemPatch) => items[0] };
  assert.equal(fireMemoryMaintenance({ workspaceId: "wsA", now: NOW, ...deps }), true);
  assert.equal(fireMemoryMaintenance({ workspaceId: "wsB", now: NOW, ...deps }), true);
});
