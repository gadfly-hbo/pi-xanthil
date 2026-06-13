import { homedir } from "node:os";
import { join } from "node:path";
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

export function ensureDirs(): void {
  mkdirSync(DATA_ROOT, { recursive: true });
  mkdirSync(WORKSPACES_ROOT, { recursive: true });
  mkdirSync(FAVORITES_ROOT, { recursive: true });
  mkdirSync(UPLOAD_TMP_ROOT, { recursive: true });
  mkdirSync(EXTRACTION_RUNS_ROOT, { recursive: true });
  mkdirSync(DIRECT_LLM_ROOT, { recursive: true });
  mkdirSync(BI_DATASETS_ROOT, { recursive: true });
}
