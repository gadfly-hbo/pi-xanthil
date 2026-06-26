import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// X-COLLECT3 smoke：全局收集容器 ws + 收集会话/文件夹生命周期。
// 必须在 import db.ts 前设 XANTHIL_DATA_DIR（db 在 import 时即 open DB_PATH）。
const testRoot = mkdtempSync(join(tmpdir(), "collect-db-"));
process.env.XANTHIL_DATA_DIR = testRoot;

const db = await import("./db.ts");

test("收集容器 ws 懒建且对工作区列表隐藏", () => {
  const before = db.listWorkspaces();
  assert.ok(!before.some((w) => w.id === db.COLLECT_WORKSPACE_ID), "container should not be in list before");
  const container = db.getOrCreateCollectWorkspace();
  assert.equal(container.id, db.COLLECT_WORKSPACE_ID);
  // 建一个真实业务 ws 作对照
  const biz = db.createWorkspace("业务工作区");
  const after = db.listWorkspaces();
  assert.ok(after.some((w) => w.id === biz.id), "business ws visible");
  assert.ok(!after.some((w) => w.id === db.COLLECT_WORKSPACE_ID), "container ws hidden from list");
});

test("收集会话多例：建/列/改名/归类/删", () => {
  const a = db.createCollectSession("会话A");
  const b = db.createCollectSession("会话B");
  assert.equal(a.workspaceId, db.COLLECT_WORKSPACE_ID);
  assert.equal(a.collectFolderId, null);

  let list = db.listCollectSessions();
  assert.ok(list.length >= 2);
  assert.ok(list.some((s) => s.id === a.id) && list.some((s) => s.id === b.id));

  db.renameSession(a.id, "会话A改名");
  assert.equal(db.listCollectSessions().find((s) => s.id === a.id)?.title, "会话A改名");

  // 收集会话不应出现在某业务 ws 的日常会话列表里
  const biz = db.createWorkspace("另一个业务区");
  assert.equal(db.listSessions(biz.id).length, 0);

  db.deleteSession(b.id);
  assert.ok(!db.listCollectSessions().some((s) => s.id === b.id));
});

// 注：collect_folders CRUD + 删 folder 落未分类 由 collect-routes.test.ts（E-COLLECT4，HTTP 级）覆盖，此处不复测。
test("setCollectSessionFolder 归类写入", () => {
  const s = db.createCollectSession("待归类会话");
  db.setCollectSessionFolder(s.id, "some-folder-id");
  assert.equal(db.listCollectSessions().find((x) => x.id === s.id)?.collectFolderId, "some-folder-id");
  db.setCollectSessionFolder(s.id, null);
  assert.equal(db.listCollectSessions().find((x) => x.id === s.id)?.collectFolderId, null);
});
