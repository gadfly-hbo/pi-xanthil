import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync, mkdirSync } from "node:fs";

// All persistent data lives under a single app data root (local single-user tool).
export const DATA_ROOT = process.env.XANTHIL_DATA_DIR ?? join(homedir(), ".pi-xanthil");
export const WORKSPACES_ROOT = join(DATA_ROOT, "workspaces");
export const FAVORITES_ROOT = join(DATA_ROOT, "favorites");
export const UPLOAD_TMP_ROOT = join(DATA_ROOT, "tmp-uploads");
export const EXTRACTION_RUNS_ROOT = join(DATA_ROOT, "extraction-runs");
export const DB_PATH = join(DATA_ROOT, "xanthil.db");

export const PORT = Number(process.env.XANTHIL_PORT ?? 8787);

// Path to the pi binary; override if not on PATH.
export const PI_BIN = process.env.XANTHIL_PI_BIN ?? "pi";
export const ANTIGRAVITY_BIN = process.env.XANTHIL_ANTIGRAVITY_BIN ?? (existsSync(join(homedir(), ".local", "bin", "agy")) ? join(homedir(), ".local", "bin", "agy") : "antigravity");

// 可选 run 级预算上限（成本停止条件，T-E2 接线）。
// 默认不设 → 工作流执行不传 runBudget，预算停止不触发（保持原行为，无意外中断）。
// 设置任一 env(>0) → handleExecuteMultiAgent 传入 runMultiAgent，预算超限即中断升级人工。
function positiveNumberEnv(name: string): number | undefined {
  const raw = process.env[name];
  if (raw == null || raw.trim() === "") return undefined;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}
const RUN_MAX_TOKENS = positiveNumberEnv("XANTHIL_RUN_MAX_TOKENS");
const RUN_MAX_COST_USD = positiveNumberEnv("XANTHIL_RUN_MAX_COST_USD");
export const RUN_BUDGET_LIMITS: { maxTotalTokens?: number; maxCostUsd?: number } | null =
  RUN_MAX_TOKENS === undefined && RUN_MAX_COST_USD === undefined
    ? null
    : { maxTotalTokens: RUN_MAX_TOKENS, maxCostUsd: RUN_MAX_COST_USD };

export const DIRECT_LLM_ROOT = join(DATA_ROOT, "direct-llm");
export const SQL_CONNECTIONS_PATH = join(DATA_ROOT, "sql-connections.json");
export const BI_DATASETS_ROOT = join(DATA_ROOT, "bi-datasets");

// 计算工具·hooks 管理（声明式转发，详见 docs/wiki.html「计算工具·hooks 管理」卡）。
// hooks.json 由 server 端 CRUD（D 卡）写、px-hook-runner 扩展读；触发流水写 hooks-triggers.jsonl。
export const HOOKS_CONFIG_PATH = process.env.XANTHIL_HOOKS_CONFIG ?? join(DATA_ROOT, "hooks.json");
export const HOOKS_LOG_PATH = process.env.XANTHIL_HOOKS_LOG ?? join(DATA_ROOT, "hooks-triggers.jsonl");
// px-hook-runner pi 扩展入口（仓库内；pi 原生加载 .ts，无需编译）。仅注入到 pi-xanthil 触发的 pi 进程。
export const HOOK_RUNNER_EXTENSION =
  process.env.XANTHIL_HOOK_RUNNER ?? fileURLToPath(new URL("../../pi-extensions/px-hook-runner/index.ts", import.meta.url));

// 计算工具·command 管理（pi-xanthil 自有斜杠命令注册表，详见 docs/wiki.html「command 管理」卡）。
// commands.json 由 server 端 CRUD（E 卡）写、command-expand.ts 展开器读；与 hooks.json 同为单文件，不进 ensureDirs。
// 缺失/空文件 = 无命令（安全降级，不改变现有发送行为）。
export const COMMANDS_CONFIG_PATH = process.env.XANTHIL_COMMANDS_CONFIG ?? join(DATA_ROOT, "commands.json");

// 计算工具·LLM 接入管理 —— 直写 pi 全局真源（详见 docs/LLM管理模块设计方案.md）。
// 注意：这些路径在 pi 全局目录（~/.pi/agent），非本应用 DATA_ROOT；故**不进 ensureDirs**（不由本应用创建）。
export const PI_AGENT_DIR = process.env.XANTHIL_PI_AGENT_DIR ?? join(homedir(), ".pi", "agent");
export const PI_MODELS_PATH = process.env.XANTHIL_PI_MODELS ?? join(PI_AGENT_DIR, "models.json");
export const PI_SETTINGS_PATH = process.env.XANTHIL_PI_SETTINGS ?? join(PI_AGENT_DIR, "settings.json");
export const PI_AUTH_PATH = process.env.XANTHIL_PI_AUTH ?? join(PI_AGENT_DIR, "auth.json");

export function ensureDirs(): void {
  mkdirSync(DATA_ROOT, { recursive: true });
  mkdirSync(WORKSPACES_ROOT, { recursive: true });
  mkdirSync(FAVORITES_ROOT, { recursive: true });
  mkdirSync(UPLOAD_TMP_ROOT, { recursive: true });
  mkdirSync(EXTRACTION_RUNS_ROOT, { recursive: true });
  mkdirSync(DIRECT_LLM_ROOT, { recursive: true });
  mkdirSync(BI_DATASETS_ROOT, { recursive: true });
}
