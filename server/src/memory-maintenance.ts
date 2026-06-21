// 记忆 v2.0 缺口3 · Dream Worker（离线记忆维护）
// ─────────────────────────────────────────────────────────────────────────────
// 把「只在检索期被动生效的信号」(positive/negativeSignals、lastUsedAt、staleAfterDays)
// 定期**固化回记忆本身的质量分(confidence)与生命状态(validUntil)**，让记忆库自我提纯。
// 三件确定性动作：①升级 confidence ②降级 confidence ③老化退役(标 validUntil=now，软退役·可审计)。
// 去重/合并/废弃由 dedup + supersede + validUntil 既有机制覆盖，本模块不重复。
//
// 设计要点：
//  - **纯算术、零 LLM、零 token**（区别于 memory-consolidation 调 pi）。
//  - 落库走注入的 patch 函数，默认绑 db **in-process**（不 self-HTTP，吸取 V-OBS 自死锁教训）。
//  - 触发=搭车 fireMemoryConsolidation 尾部（见 memory-consolidation.ts），带节流防高频重扫。
import { listMemoryItems, updateMemoryItem, type MemoryItemPatch } from "./db/data.ts";
import type { MemoryItem } from "./types.ts";

const DAY_MS = 24 * 60 * 60 * 1000;

export interface MemoryMaintenanceConfig {
  promoteNet: number;      // 升级：positive - negative ≥ 此值
  promoteUsed: number;     // 升级：usedCount ≥ 此值
  promoteStep: number;     // 升级幅度
  demoteStep: number;      // 降级幅度
  staleConfidence: number; // 老化退役：confidence < 此值
}

export const DEFAULT_MAINTENANCE_CONFIG: MemoryMaintenanceConfig = {
  promoteNet: 2,
  promoteUsed: 3,
  promoteStep: 0.1,
  demoteStep: 0.15,
  staleConfidence: 0.3,
};

export type MemoryMaintenanceAction = "promote" | "demote" | "retire";

export interface MemoryMaintenanceChange {
  id: string;
  action: MemoryMaintenanceAction;
  reason: string;
  before: { confidence: number; validUntil: number | null };
  after: { confidence: number; validUntil: number | null };
  patch: MemoryItemPatch;
}

export interface MemoryMaintenanceResult {
  workspaceId: string;
  dryRun: boolean;
  scanned: number;
  changes: MemoryMaintenanceChange[];
  applied: number;
}

const clamp01 = (n: number): number => Math.max(0, Math.min(1, n));

function lastTouch(item: MemoryItem): number {
  return item.lastUsedAt ?? item.createdAt;
}

/**
 * 纯函数：按规则为每条记忆算**至多一个**调整（优先级 retire > demote > promote）。
 * 已退役(validUntil 已过期)的条目跳过，避免重复处理。
 */
export function computeMaintenancePlan(
  items: MemoryItem[],
  now: number,
  config: MemoryMaintenanceConfig = DEFAULT_MAINTENANCE_CONFIG,
): MemoryMaintenanceChange[] {
  const changes: MemoryMaintenanceChange[] = [];
  for (const item of items) {
    if (item.validUntil !== null && item.validUntil <= now) continue; // 已退役/过期
    const net = item.positiveSignals - item.negativeSignals;
    const unusedDays = (now - lastTouch(item)) / DAY_MS;
    const overdue = unusedDays > item.staleAfterDays;
    const before = { confidence: item.confidence, validUntil: item.validUntil };

    // ① 老化退役：超期未用且置信度已低 → 软退役（validUntil=now，不物理删，可审计召回历史）。
    if (overdue && item.confidence < config.staleConfidence) {
      changes.push({
        id: item.id, action: "retire",
        reason: `unused ${Math.floor(unusedDays)}d > stale ${item.staleAfterDays}d 且 confidence ${item.confidence.toFixed(2)} < ${config.staleConfidence}`,
        before, after: { confidence: item.confidence, validUntil: now },
        patch: { validUntil: now },
      });
      continue;
    }

    // ② 降级：负反馈占优 或 超期未用且无正向净值 → 下调 confidence。
    if (net < 0 || (overdue && net <= 0)) {
      const nextConf = clamp01(item.confidence - config.demoteStep);
      if (nextConf !== item.confidence) {
        changes.push({
          id: item.id, action: "demote",
          reason: net < 0 ? `negative net ${net}` : `overdue ${Math.floor(unusedDays)}d, net ${net}`,
          before, after: { confidence: nextConf, validUntil: item.validUntil },
          patch: { confidence: nextConf },
        });
      }
      continue;
    }

    // ③ 升级：正反馈显著 + 复用达阈值 → 上调 confidence。
    if (net >= config.promoteNet && item.usedCount >= config.promoteUsed && item.confidence < 1) {
      const nextConf = clamp01(item.confidence + config.promoteStep);
      if (nextConf !== item.confidence) {
        changes.push({
          id: item.id, action: "promote",
          reason: `positive net ${net} ≥ ${config.promoteNet}, used ${item.usedCount} ≥ ${config.promoteUsed}`,
          before, after: { confidence: nextConf, validUntil: item.validUntil },
          patch: { confidence: nextConf },
        });
      }
    }
  }
  return changes;
}

export interface MemoryMaintenanceOptions {
  workspaceId: string;
  dryRun?: boolean;
  now?: number;
  config?: MemoryMaintenanceConfig;
  // DI：默认绑 db（in-process，不 self-HTTP）；测试注入 mock。
  listItems?: (workspaceId: string) => MemoryItem[];
  patchItem?: (id: string, patch: MemoryItemPatch) => MemoryItem | undefined;
}

export function runMemoryMaintenance(options: MemoryMaintenanceOptions): MemoryMaintenanceResult {
  const now = options.now ?? Date.now();
  const listItems = options.listItems ?? ((id: string) => listMemoryItems({ workspaceId: id }));
  const patchItem = options.patchItem ?? updateMemoryItem;
  const items = listItems(options.workspaceId);
  const changes = computeMaintenancePlan(items, now, options.config ?? DEFAULT_MAINTENANCE_CONFIG);

  let applied = 0;
  if (!options.dryRun) {
    for (const change of changes) {
      if (patchItem(change.id, change.patch)) applied++;
    }
  }
  return {
    workspaceId: options.workspaceId,
    dryRun: options.dryRun === true,
    scanned: items.length,
    changes,
    applied,
  };
}

// ── 搭车触发 + 节流 ──────────────────────────────────────────────────────────
export const DEFAULT_MAINTENANCE_THROTTLE_MS = 5 * 60 * 1000; // 5 分钟

const lastMaintenanceAt = new Map<string, number>();

/** 测试钩子：清空节流记录。 */
export function resetMaintenanceThrottle(): void {
  lastMaintenanceAt.clear();
}

export interface FireMemoryMaintenanceOptions {
  workspaceId: string;
  onError?: (error: unknown) => void;
  now?: number;
  throttleMs?: number;
  config?: MemoryMaintenanceConfig;
  listItems?: (workspaceId: string) => MemoryItem[];
  patchItem?: (id: string, patch: MemoryItemPatch) => MemoryItem | undefined;
}

/**
 * 搭车 fireMemoryConsolidation 尾部调用：fire-and-forget + 每 workspace 节流。
 * 返回是否真正触发（false=被节流跳过）。纯算术、同步执行（无 LLM/IO 阻塞），但仍按
 * fire-and-forget 语义包装错误处理，保持与 fireMemoryConsolidation 对称。
 */
export function fireMemoryMaintenance(options: FireMemoryMaintenanceOptions): boolean {
  const now = options.now ?? Date.now();
  const throttleMs = options.throttleMs ?? DEFAULT_MAINTENANCE_THROTTLE_MS;
  const last = lastMaintenanceAt.get(options.workspaceId);
  if (last !== undefined && now - last < throttleMs) return false;
  lastMaintenanceAt.set(options.workspaceId, now);
  try {
    runMemoryMaintenance({
      workspaceId: options.workspaceId,
      dryRun: false,
      now,
      config: options.config,
      listItems: options.listItems,
      patchItem: options.patchItem,
    });
  } catch (err) {
    options.onError?.(err);
  }
  return true;
}
