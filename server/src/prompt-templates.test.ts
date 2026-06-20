import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

process.env.XANTHIL_DATA_DIR = mkdtempSync(join(tmpdir(), "pi-xanthil-prompt-templates-test-"));

const db = await import("./db.ts");
const data = await import("./db/data.ts");

const ws = db.createWorkspace("tpl-ws");
const wsB = db.createWorkspace("tpl-ws-b");

test("extractPromptVariables: dedup + preserve order, ignore malformed", () => {
  const body = "你好 {{user}}，分析 {{ topic }}，再次提到 {{user}}。{{ }} {{not-a-var" ;
  assert.deepEqual(data.extractPromptVariables(body), ["user", "topic"]);
});

test("create + get + list (workspace scoped + global union)", () => {
  const local = data.createPromptTemplate({
    workspaceId: ws.id,
    title: "本地模板",
    category: "system",
    body: "为 {{role}} 解释 {{topic}}",
    tags: ["analysis", "v1"],
  });
  assert.equal(local.workspaceId, ws.id);
  assert.deepEqual(local.variables, ["role", "topic"], "auto-extract variables");
  assert.equal(local.category, "system");

  const global = data.createPromptTemplate({
    workspaceId: null,
    title: "全局模板",
    category: "user",
    body: "Hi {{name}}",
  });
  assert.equal(global.workspaceId, null);

  const got = data.getPromptTemplate(local.id);
  assert.equal(got?.title, "本地模板");

  // 默认 includeGlobal=true：本工作区列表含全局
  const all = data.listPromptTemplates(ws.id);
  const ids = new Set(all.map((t) => t.id));
  assert.ok(ids.has(local.id));
  assert.ok(ids.has(global.id));

  // 另一工作区也能看到全局，但看不到 ws 的本地模板
  const otherView = data.listPromptTemplates(wsB.id);
  const otherIds = new Set(otherView.map((t) => t.id));
  assert.ok(otherIds.has(global.id));
  assert.ok(!otherIds.has(local.id));

  // includeGlobal=false 只看本 ws
  const localOnly = data.listPromptTemplates(ws.id, { includeGlobal: false });
  const loIds = new Set(localOnly.map((t) => t.id));
  assert.ok(loIds.has(local.id));
  assert.ok(!loIds.has(global.id));
});

test("filter by category + tags (OR)", () => {
  data.createPromptTemplate({ workspaceId: ws.id, title: "A", category: "tool", body: "x", tags: ["alpha"] });
  data.createPromptTemplate({ workspaceId: ws.id, title: "B", category: "tool", body: "y", tags: ["beta"] });
  data.createPromptTemplate({ workspaceId: ws.id, title: "C", category: "draft", body: "z", tags: ["alpha", "gamma"] });

  const tool = data.listPromptTemplates(ws.id, { category: "tool", includeGlobal: false });
  assert.equal(tool.length, 2);
  assert.ok(tool.every((t) => t.category === "tool"));

  const tagAlphaOrBeta = data.listPromptTemplates(ws.id, { tags: ["alpha", "beta"], includeGlobal: false });
  const titles = new Set(tagAlphaOrBeta.map((t) => t.title));
  assert.ok(titles.has("A"));
  assert.ok(titles.has("B"));
  assert.ok(titles.has("C"), "C 含 alpha 应被命中");

  // tag 不存在 → 空
  const none = data.listPromptTemplates(ws.id, { tags: ["zzz"], includeGlobal: false });
  assert.equal(none.length, 0);
});

test("update: body change auto re-extracts variables, explicit variables wins", () => {
  const t = data.createPromptTemplate({ workspaceId: ws.id, title: "U", body: "{{a}}" });
  assert.deepEqual(t.variables, ["a"]);

  const u1 = data.updatePromptTemplate(t.id, { body: "{{b}} {{c}}" });
  assert.deepEqual(u1?.variables, ["b", "c"], "auto re-extract on body change");

  const u2 = data.updatePromptTemplate(t.id, { body: "{{x}}", variables: ["explicit"] });
  assert.deepEqual(u2?.variables, ["explicit"], "explicit variables overrides auto-extract");

  // updatedAt 推进
  assert.ok(u2!.updatedAt >= t.updatedAt);
});

test("update title required when provided as empty", () => {
  const t = data.createPromptTemplate({ workspaceId: ws.id, title: "X", body: "x" });
  assert.throws(() => data.updatePromptTemplate(t.id, { title: "  " }), /title required/);
});

test("delete + missing id", () => {
  const t = data.createPromptTemplate({ workspaceId: ws.id, title: "DEL", body: "x" });
  assert.equal(data.deletePromptTemplate(t.id), true);
  assert.equal(data.getPromptTemplate(t.id), undefined);
  assert.equal(data.deletePromptTemplate("does-not-exist"), false);
});

test("create rejects empty title", () => {
  assert.throws(() => data.createPromptTemplate({ workspaceId: ws.id, title: "  ", body: "x" }), /title required/);
});
