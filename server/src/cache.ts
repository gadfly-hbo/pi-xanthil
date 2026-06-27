import type { PiEvent, PiUsage, SessionTokenStats, TokenUsageStats, TokenUsageTargetKind } from "./types.ts";
import {
  accumulateSessionTokenStats,
  accumulateTokenUsageStats,
  getRawSessionTokenStats,
  getRawTokenUsageDailyStats,
  getRawTokenUsageStatsByTarget,
  listRawTokenUsageStatsByWorkspace,
} from "./db.ts";

function computeCacheHitRate(inputTokens: number, cacheReadTokens: number, cacheWriteTokens: number): number {
  const total = inputTokens + cacheReadTokens + cacheWriteTokens;
  return total > 0 ? cacheReadTokens / total : 0;
}

export function trackSessionUsage(sessionId: string, usage: PiUsage): void {
  accumulateSessionTokenStats(sessionId, {
    input: usage.input,
    output: usage.output,
    cacheRead: usage.cacheRead,
    cacheWrite: usage.cacheWrite,
    cost: usage.cost.total,
  });
}

export function trackWorkspaceUsage(
  target: { workspaceId: string; targetKind: TokenUsageTargetKind; targetId: string; title: string },
  usage: PiUsage,
): void {
  accumulateTokenUsageStats(target, {
    input: usage.input,
    output: usage.output,
    cacheRead: usage.cacheRead,
    cacheWrite: usage.cacheWrite,
    cost: usage.cost.total,
  });
}

/**
 * 从 pi 事件流累计用量：仅在 assistant 的 message_end 且带 usage 时入库。
 * session / flow / anax 等各 target 共用（T-C2b：从 index.ts 上移）。
 */
export function trackUsageEvent(
  target: { workspaceId: string; targetKind: TokenUsageTargetKind; targetId: string; title: string } | null,
  event: PiEvent,
): void {
  if (!target || event.type !== "message_end") return;
  const { message } = event as Extract<PiEvent, { type: "message_end" }>;
  if (message.role !== "assistant" || !message.usage) return;
  trackWorkspaceUsage(target, message.usage);
}

export function trackSessionWorkspaceUsage(
  target: { workspaceId: string; sessionId: string; title: string },
  usage: PiUsage,
): void {
  trackSessionUsage(target.sessionId, usage);
  trackWorkspaceUsage({
    workspaceId: target.workspaceId,
    targetKind: "session",
    targetId: target.sessionId,
    title: target.title,
  }, usage);
}

export function getSessionTokenStats(sessionId: string): SessionTokenStats | null {
  const row = getRawSessionTokenStats(sessionId);
  if (!row) return null;
  return {
    ...row,
    cacheHitRate: computeCacheHitRate(row.inputTokens, row.cacheReadTokens, row.cacheWriteTokens),
  };
}

export function getWorkspaceTokenStats(workspaceId: string): SessionTokenStats {
  const rows = listRawTokenUsageStatsByWorkspace(workspaceId);
  const agg = rows.reduce(
    (acc, row) => ({
      inputTokens: acc.inputTokens + row.inputTokens,
      outputTokens: acc.outputTokens + row.outputTokens,
      cacheReadTokens: acc.cacheReadTokens + row.cacheReadTokens,
      cacheWriteTokens: acc.cacheWriteTokens + row.cacheWriteTokens,
      turnCount: acc.turnCount + row.turnCount,
      totalCost: acc.totalCost + row.totalCost,
    }),
    { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, turnCount: 0, totalCost: 0 },
  );
  return {
    sessionId: workspaceId,
    ...agg,
    cacheHitRate: computeCacheHitRate(agg.inputTokens, agg.cacheReadTokens, agg.cacheWriteTokens),
    updatedAt: rows.length > 0 ? Math.max(...rows.map((r) => r.updatedAt)) : Date.now(),
  };
}

export function getWorkspaceTodayTokenStats(workspaceId: string): SessionTokenStats {
  const row = getRawTokenUsageDailyStats(workspaceId);
  if (!row) {
    return {
      sessionId: workspaceId,
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      turnCount: 0,
      totalCost: 0,
      cacheHitRate: 0,
      updatedAt: Date.now(),
    };
  }
  return {
    ...row,
    cacheHitRate: computeCacheHitRate(row.inputTokens, row.cacheReadTokens, row.cacheWriteTokens),
  };
}

export function listWorkspaceTokenUsageStats(workspaceId: string): TokenUsageStats[] {
  return listRawTokenUsageStatsByWorkspace(workspaceId).map((row) => ({
    ...row,
    cacheHitRate: computeCacheHitRate(row.inputTokens, row.cacheReadTokens, row.cacheWriteTokens),
  }));
}

export function getWorkspaceTokenUsageStatsByTarget(
  workspaceId: string,
  targetKind: TokenUsageTargetKind,
  targetId: string,
): TokenUsageStats | null {
  const row = getRawTokenUsageStatsByTarget(workspaceId, targetKind, targetId);
  if (!row) return null;
  return {
    ...row,
    cacheHitRate: computeCacheHitRate(row.inputTokens, row.cacheReadTokens, row.cacheWriteTokens),
  };
}

// ---- Run 级预算原语（T-C4 · 服务于工作流闭环 loop 的预算守卫，见 docs/工作流改造-任务派发.md）----
// flow run 的用量以 targetKind:"flow_run" / targetId:runId 实时累计入库（见 index.ts trackUsageEvent）。
// 这些原语让 runner 在每节点后查询本 run 的累计用量、按上限判断是否超预算中断。
// 纯读取既有统计，不改任何累计口径。

/** 单次 flow run 的累计 token / 成本。`totalTokens` = input + output + cacheRead + cacheWrite。 */
export function getRunTokenUsage(workspaceId: string, runId: string): { totalTokens: number; totalCost: number } {
  const s = getWorkspaceTokenUsageStatsByTarget(workspaceId, "flow_run", runId);
  if (!s) return { totalTokens: 0, totalCost: 0 };
  return {
    totalTokens: s.inputTokens + s.outputTokens + s.cacheReadTokens + s.cacheWriteTokens,
    totalCost: s.totalCost,
  };
}

/** run 级预算上限。任一字段省略或为非正数表示该维度不限。 */
export interface RunBudgetLimits {
  maxTotalTokens?: number;
  maxCostUsd?: number;
}

export interface RunBudgetStatus {
  totalTokens: number;
  totalCost: number;
  /** 是否已超出任一上限。 */
  exceeded: boolean;
  /** 触发的上限说明（中文，可直接落 trace / verdict）；未超时为 null。 */
  reason: string | null;
}

/**
 * 按累计用量与上限判定本 run 是否超预算。runner 在每节点后调用：
 * `exceeded === true` 即应中断升级人工（属白皮书五类停止条件之"成本停止"）。
 */
export function evaluateRunBudget(workspaceId: string, runId: string, limits: RunBudgetLimits): RunBudgetStatus {
  const { totalTokens, totalCost } = getRunTokenUsage(workspaceId, runId);
  let reason: string | null = null;
  if (typeof limits.maxTotalTokens === "number" && limits.maxTotalTokens > 0 && totalTokens > limits.maxTotalTokens) {
    reason = `token 用量 ${totalTokens} 超过本 run 上限 ${limits.maxTotalTokens}`;
  } else if (typeof limits.maxCostUsd === "number" && limits.maxCostUsd > 0 && totalCost > limits.maxCostUsd) {
    reason = `成本 $${totalCost.toFixed(4)} 超过本 run 上限 $${limits.maxCostUsd.toFixed(4)}`;
  }
  return { totalTokens, totalCost, exceeded: reason !== null, reason };
}

// ---- C_raw 只读 getter（X-HARNESS0 · 服务 EFC η=EFC/C_raw，总控持有签名）----
// EFC 反馈效率度量需要原始算力分母 C_raw = token + 工具调用计数。token 取自既有统计；
// 工具调用计数 cache 模块不采集（避免新起采集管线、保最小改动），由调用方(E)从 trace 传入回填。
// 本 getter 纯读既有 token 统计、不改任何累计口径；η 的标量合成权重归 E-EFC1 打分逻辑。

export interface RawComputeUsage {
  /** input+output+cacheRead+cacheWrite，来自既有 token 统计。 */
  totalTokens: number;
  /** 工具调用次数；cache 不采集，由 E 从 trace 传入（缺省 0）。 */
  toolCalls: number;
}

/** 单个 session 的 C_raw（token 部分取自 session_token_stats）。 */
export function getRawComputeForSession(sessionId: string, toolCalls = 0): RawComputeUsage {
  const s = getSessionTokenStats(sessionId);
  const totalTokens = s ? s.inputTokens + s.outputTokens + s.cacheReadTokens + s.cacheWriteTokens : 0;
  return { totalTokens, toolCalls };
}

/** 单个 flow run 的 C_raw（复用 getRunTokenUsage，targetKind:"flow_run"）。 */
export function getRawComputeForRun(workspaceId: string, runId: string, toolCalls = 0): RawComputeUsage {
  const { totalTokens } = getRunTokenUsage(workspaceId, runId);
  return { totalTokens, toolCalls };
}
