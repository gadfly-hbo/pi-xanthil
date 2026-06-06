import type { PiUsage, SessionTokenStats, TokenUsageStats, TokenUsageTargetKind } from "./types.ts";
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
