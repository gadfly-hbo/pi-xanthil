import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { SUBAGENTS_CONFIG_PATH } from "./config.ts";
import { sessionDir } from "./workspace-dirs.ts";
import { safeResolve } from "./flow-fs.ts";
import { buildExtractionToolsMcpServer } from "./mcp/register.ts";
import { runPiTurn, type PiRun } from "./pi-adapter.ts";
import type { PiEvent, SubAgentTemplate } from "./types.ts";

/**
 * 【总控 · 接缝】子 agent 委派内核 —— 从 index.ts 抽出（只搬不改），供 prod 委派(runDelegatedSubAgent)
 * 与实验场 subagent 评测(subagent-evaluation-runner) 共用同一 systemPrompt 构造 + 最小权限 cwd scoping，
 * 避免 lab 与生产行为分叉。详见 docs/实验场改造-任务派发.md 附录 C。
 */

export const DEFAULT_SUBAGENT_PERSONA = "你是数据分析子 agent，独立完成一项被委派的分析子任务，不依赖主对话历史。";
const DEFAULT_SUBAGENT_MAX_RETRIES = 3;
const LOCALHOST_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);

const asConfigRecord = (v: unknown): Record<string, unknown> => (
  typeof v === "object" && v !== null ? v as Record<string, unknown> : {}
);

export const asConfigString = (v: unknown): string => (typeof v === "string" ? v : v == null ? "" : String(v));

function hasExternalUrl(text: string): boolean {
  const urls = text.match(/https?:\/\/[^\s"'<>）)]+/gi) ?? [];
  return urls.some((raw) => {
    try {
      const host = new URL(raw).hostname;
      return !LOCALHOST_HOSTS.has(host);
    } catch {
      return true;
    }
  });
}

export function coerceSubAgentTemplate(input: unknown): SubAgentTemplate | null {
  const o = asConfigRecord(input);
  const id = asConfigString(o.id).trim();
  const name = asConfigString(o.name).trim();
  const persona = asConfigString(o.persona).trim();
  if (!id || !name || !persona) return null;
  if (hasExternalUrl(persona)) return null;

  const toolIds = Array.isArray(o.toolIds)
    ? Array.from(new Set(o.toolIds.map((x) => asConfigString(x).trim()).filter(Boolean)))
    : [];
  const hasMaxRetries = Object.prototype.hasOwnProperty.call(o, "maxRetries");
  const maxRetriesRaw = Number(o.maxRetries);
  const maxRetries = hasMaxRetries && Number.isFinite(maxRetriesRaw)
    ? Math.max(0, Math.min(5, Math.trunc(maxRetriesRaw)))
    : DEFAULT_SUBAGENT_MAX_RETRIES;

  return {
    id,
    name,
    enabled: o.enabled !== false,
    persona,
    toolIds,
    dataScope: "clean_data",
    maxRetries,
    source: "custom",
  };
}

export function readSubAgentTemplates(): SubAgentTemplate[] {
  if (!existsSync(SUBAGENTS_CONFIG_PATH)) return [];
  try {
    const raw = readFileSync(SUBAGENTS_CONFIG_PATH, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    const arr: unknown[] = Array.isArray(parsed)
      ? parsed
      : Array.isArray((parsed as { subagents?: unknown })?.subagents)
        ? (parsed as { subagents: unknown[] }).subagents
        : Array.isArray((parsed as { templates?: unknown })?.templates)
          ? (parsed as { templates: unknown[] }).templates
          : [];
    return arr.map((it) => coerceSubAgentTemplate(it)).filter((t): t is SubAgentTemplate => t !== null);
  } catch {
    return [];
  }
}

export function writeSubAgentTemplates(templates: SubAgentTemplate[]): void {
  mkdirSync(dirname(SUBAGENTS_CONFIG_PATH), { recursive: true });
  writeFileSync(SUBAGENTS_CONFIG_PATH, JSON.stringify(templates, null, 2), "utf8");
}

export function resolveSubAgentPersona(templateId?: string): string {
  const id = templateId?.trim();
  if (!id) return DEFAULT_SUBAGENT_PERSONA;
  const template = readSubAgentTemplates().find((t) => t.id === id && t.enabled);
  return template?.persona.trim() || DEFAULT_SUBAGENT_PERSONA;
}

export function resolveSubAgentTemplate(templateId?: string): SubAgentTemplate | undefined {
  const id = templateId?.trim();
  if (!id) return undefined;
  return readSubAgentTemplates().find((t) => t.id === id && t.enabled);
}

export function resolveSubAgentCwd(
  workspaceRoot: string,
  workspaceId: string,
  taskId: string,
  parentSessionId: string,
  allowedToolIds: string[] | undefined,
): string {
  if (allowedToolIds === undefined) return workspaceRoot;
  const cwd = join(sessionDir(workspaceRoot, parentSessionId), ".subagent-cwd", taskId);
  mkdirSync(cwd, { recursive: true });
  writeFileSync(join(cwd, ".mcp.json"), JSON.stringify({
    mcpServers: {
      "xanthil-data-tools": buildExtractionToolsMcpServer(workspaceId, allowedToolIds),
    },
  }, null, 2), "utf8");
  return cwd;
}

// 仅放行落在 clean_data(020_clean) 内的数据文件（防越界 / 防读原始明细）。
// 数据红线守门：basename 去路径、safeResolve 锁在 cleanDir 内、须为存在的文件。prod 委派/resume 与 eval 共用，禁止复刻。
export function resolveAllowedSubAgentDataFiles(cleanDir: string, dataFiles: string[]): string[] {
  return dataFiles
    .map((f) => { try { return safeResolve(cleanDir, basename(f)); } catch { return ""; } })
    .filter((abs) => abs !== "" && (() => { try { return statSync(abs).isFile(); } catch { return false; } })());
}

// 委派子 agent 的硬约束 systemPrompt（persona + clean_data 只读白名单 + 报告写入目录 + 摘要约定）。
export function buildSubAgentSystemPrompt(persona: string, allowedDataFiles: string[], reportDir: string): string {
  const fileList = allowedDataFiles.length > 0
    ? allowedDataFiles.map((p) => `- ${p}`).join("\n")
    : "（未指定数据文件，请在报告中说明缺数据）";
  return `${persona}
[硬性约束]
1. 只允许用 read 工具读取下列指定数据文件，禁止读取其他任何数据或原始明细：
${fileList}
2. 必须把分析报告用 write 工具写入目录：${reportDir}（文件名自拟，建议 .md）。不得写到其他位置。
3. 完成后，最后一条消息用 2-4 句话给出结论摘要（供回流主对话），不要复述报告全文。
4. 不要提问，自主完成。`;
}

export interface SubAgentTurnInput {
  cwd: string;                 // resolveSubAgentCwd 结果（最小权限沙箱）；无限权时为 workspaceRoot
  piSessionId: string;
  text: string;
  systemPrompt: string;
  model?: string;
  skillPaths?: string[];
  onEvent: (event: PiEvent) => void;
}

// 委派 turn 内核：以 cwd 为根、注入硬约束 systemPrompt 跑一次 pi turn。prod 与 eval 共用。
export function runSubAgentTurn(input: SubAgentTurnInput): PiRun {
  return runPiTurn({
    workspaceRoot: input.cwd,
    piSessionId: input.piSessionId,
    text: input.text,
    model: input.model,
    systemPrompt: input.systemPrompt,
    skillPaths: input.skillPaths,
    onEvent: input.onEvent,
  });
}
