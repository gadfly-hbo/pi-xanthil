import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { validateSkillPaths } from "./skills.ts";

/**
 * 工作流/模型规范化配置（接缝层 · T-C2-pre）。
 *
 * 从 index.ts 上移的纯函数：把 workflow 定义里的 model / skillPaths 按 pi CLI
 * 已启用配置做规范化与校验，并提供已启用模型 id 的查询/解析。无运行时状态、
 * 仅依赖 pi settings 文件与 skills.ts，供 index.ts 与 routes/engine.ts 共享。
 */

export type WorkflowLike = {
  defaultModel?: unknown;
  defaultSkillPaths?: unknown;
  nodes?: Array<{ id?: unknown; model?: unknown; skillPaths?: unknown }>;
};

export function listConfiguredModelIds(): string[] {
  try {
    const settingsPath = join(homedir(), ".pi", "agent", "settings.json");
    const settings = JSON.parse(readFileSync(settingsPath, "utf8")) as { enabledModels?: unknown };
    return Array.isArray(settings.enabledModels) ? settings.enabledModels.filter((id): id is string => typeof id === "string") : [];
  } catch {
    return [];
  }
}

export function resolveConfiguredModelId(model: string, configured: string[]): string | null {
  const trimmed = model.trim();
  if (!trimmed) return "";
  if (configured.includes(trimmed)) return trimmed;

  const rawModel = trimmed.includes("/") ? trimmed.slice(trimmed.lastIndexOf("/") + 1) : trimmed;
  const matches = configured.filter((id) => id.slice(id.lastIndexOf("/") + 1) === rawModel);
  return matches.length === 1 ? matches[0]! : null;
}

export function normalizeWorkflowModels<T extends WorkflowLike>(workflow: T): T {
  const configured = listConfiguredModelIds();
  if (configured.length === 0) return workflow;

  const normalize = (value: unknown, label: string): string | undefined => {
    if (value == null) return undefined;
    if (typeof value !== "string") throw new Error(`${label} must be a string`);
    const resolved = resolveConfiguredModelId(value, configured);
    if (resolved == null) {
      throw new Error(`${label} is not enabled in pi CLI: ${value}. Allowed models: ${configured.join(", ")}`);
    }
    return resolved || undefined;
  };

  const defaultModel = normalize(workflow.defaultModel, "defaultModel");
  if (defaultModel !== undefined) workflow.defaultModel = defaultModel;
  for (const node of workflow.nodes ?? []) {
    const nodeId = typeof node.id === "string" ? node.id : "unknown";
    const model = normalize(node.model, `nodes.${nodeId}.model`);
    if (model !== undefined) node.model = model;
  }
  return workflow;
}

export function normalizeWorkflowSkills<T extends WorkflowLike>(flowRoot: string, workflow: T): T {
  if (workflow.defaultSkillPaths !== undefined) {
    workflow.defaultSkillPaths = validateWorkflowSkillList(flowRoot, workflow.defaultSkillPaths, "defaultSkillPaths");
  }
  for (const node of workflow.nodes ?? []) {
    if (node.skillPaths === undefined) continue;
    const nodeId = typeof node.id === "string" ? node.id : "unknown";
    node.skillPaths = validateWorkflowSkillList(flowRoot, node.skillPaths, `nodes.${nodeId}.skillPaths`);
  }
  return workflow;
}

function validateWorkflowSkillList(flowRoot: string, value: unknown, label: string): string[] {
  if (!Array.isArray(value) || !value.every((item) => typeof item === "string")) {
    throw new Error(`${label} must be a string array`);
  }
  return validateSkillPaths(flowRoot, value, { mode: "lenient" }) ?? [];
}
