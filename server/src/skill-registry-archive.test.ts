import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

// 卡 P1·D：归档=全局淘汰 —— 关闭所有工作区对该 skill 的 enablement（修原只关 origin 的矛盾）。
process.env.XANTHIL_DATA_DIR = mkdtempSync(join(tmpdir(), "pi-xanthil-skill-archive-test-"));

const engineDb = await import("./db/engine.ts");
const sharedDb = await import("./db/shared.ts");

test("归档=全局淘汰：关闭所有工作区对该 skill 的启用", () => {
  const entry = engineDb.createSkillRegistryEntry("ws1", { slug: "g-skill", name: "G", source: "manual" });
  // 模拟全局池：ws2 也启用同一 skill 定义
  sharedDb.setMemoryEnablement("ws2", "skill", entry.id, true);
  assert.ok(sharedDb.listEnabledItemIds("ws1", "skill").includes(entry.id), "ws1 初始启用");
  assert.ok(sharedDb.listEnabledItemIds("ws2", "skill").includes(entry.id), "ws2 初始启用");

  engineDb.archiveSkillRegistryEntry(entry.id);

  assert.ok(!sharedDb.listEnabledItemIds("ws1", "skill").includes(entry.id), "归档后 ws1 应停用");
  assert.ok(!sharedDb.listEnabledItemIds("ws2", "skill").includes(entry.id), "归档后 ws2 应停用（全局淘汰）");
  assert.equal(engineDb.getSkillRegistryEntry(entry.id)?.status, "archived");
});

test("非归档更新不波及他区启用", () => {
  const entry = engineDb.createSkillRegistryEntry("wsA", { slug: "keep-skill", name: "K", source: "manual" });
  sharedDb.setMemoryEnablement("wsB", "skill", entry.id, true);
  engineDb.updateSkillRegistryEntry({ id: entry.id, name: "K2" });
  assert.ok(sharedDb.listEnabledItemIds("wsB", "skill").includes(entry.id), "改名不应关 wsB 启用");
});
