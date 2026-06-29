import { describe, it, beforeEach, afterEach } from "node:test";
import { strict as assert } from "node:assert";
import {
  archiveWorkspace,
  buildEnabledBusinessContextPrompt,
  commitBusinessContextImport,
  createBusinessContext,
  createWorkspace,
  exportBusinessContexts,
  listBusinessContextConflicts,
  listBusinessContexts,
  previewBusinessContextImport,
} from "./db.ts";

let workspace: ReturnType<typeof createWorkspace>;

beforeEach(() => {
  workspace = createWorkspace(`bc-governance-${Date.now()}-${Math.random()}`);
});

afterEach(() => {
  try { archiveWorkspace(workspace.id); } catch { /* ignore */ }
});

describe("business context governance", () => {
  it("keeps old create payload compatible", () => {
    const item = createBusinessContext(workspace.id, { category: "org", title: "兼容主体", content: "旧 payload" });

    assert.equal(item.source, "");
    assert.equal(item.owner, "");
    assert.equal(item.validFrom, null);
    assert.equal(item.validUntil, null);
  });

  it("does not inject expired contexts", () => {
    createBusinessContext(workspace.id, { category: "goal", title: "已过期目标", content: "不应进入 prompt", validUntil: Date.now() - 1000 });
    createBusinessContext(workspace.id, { category: "goal", title: "有效目标", content: "应进入 prompt", source: "brief", owner: "D" });

    const prompt = buildEnabledBusinessContextPrompt(workspace.id);

    assert.equal(prompt.count, 1);
    assert.match(prompt.prompt, /有效目标/);
    assert.match(prompt.prompt, /来源:brief/);
    assert.doesNotMatch(prompt.prompt, /已过期目标/);
  });

  it("detects duplicate and opposing goal/constraint conflicts", () => {
    createBusinessContext(workspace.id, { category: "status", title: "会员增长阶段", content: "复购提升" });
    createBusinessContext(workspace.id, { category: "status", title: "会员增长阶段", content: "复购提升" });
    createBusinessContext(workspace.id, { category: "constraint", title: "禁止价格补贴", content: "不得扩大价格补贴" });
    createBusinessContext(workspace.id, { category: "goal", title: "扩大价格补贴", content: "提升价格补贴覆盖" });

    const reasons = listBusinessContextConflicts(workspace.id).map((c) => c.reason);

    assert.equal(reasons.includes("duplicate"), true);
    assert.equal(reasons.includes("opposing_goal_constraint"), true);
  });

  it("previews imports without writing", () => {
    const preview = previewBusinessContextImport(
      workspace.id,
      "category,title,content,source,owner\nstatus,导入现状,当前处于爬坡期,brief,owner",
      "csv",
    );

    assert.equal(preview.totalRows, 1);
    assert.equal(preview.validRows, 1);
    assert.equal(listBusinessContexts().some((item) => item.workspaceId === workspace.id && item.title === "导入现状"), false);
  });

  it("commits valid import rows and enables by default", () => {
    const preview = previewBusinessContextImport(
      workspace.id,
      JSON.stringify([{ category: "glossary", title: "GMV", content: "支付成交额" }]),
      "json",
    );

    const result = commitBusinessContextImport({ workspaceId: workspace.id, rows: preview.rows });
    const prompt = buildEnabledBusinessContextPrompt(workspace.id);

    assert.equal(result.created.length, 1);
    assert.equal(result.errors.length, 0);
    assert.match(prompt.prompt, /GMV/);
  });

  it("exports enabled contexts only when requested", () => {
    commitBusinessContextImport({
      workspaceId: workspace.id,
      rows: [{ row: 1, category: "status", title: "启用背景", content: "enabled" }],
      enable: true,
    });
    commitBusinessContextImport({
      workspaceId: workspace.id,
      rows: [{ row: 1, category: "history", title: "历史注记", content: "disabled" }],
      enable: false,
    });

    const enabled = JSON.parse(exportBusinessContexts(workspace.id, true, "json")) as Array<{ title: string }>;
    const all = exportBusinessContexts(workspace.id, false, "csv");

    assert.deepEqual(enabled.map((item) => item.title), ["启用背景"]);
    assert.match(all, /启用背景/);
    assert.match(all, /历史注记/);
  });
});
