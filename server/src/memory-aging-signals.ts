import { listMemoryItems } from "./db/data.ts";
import { isMemoryActive, memoryReferences, memorySimilarity, sharedMemoryTags } from "./memory-aging-core.ts";
import type { MemoryItem, MemoryItemType } from "./types.ts";

/**
 * 【Agent-D · 数据基座域】记忆老化信号（D-AGING2 · 2026-06-27）
 *
 * 目的：本地、纯算法、零 LLM 地扫本工作区 memory_items，吐出两类老化信号：
 *   ① 卡冲突（interference）—— 相近/可混淆条目对，可能在检索时互相挤占；
 *   ② 事实更新回扫（revision sweep）—— supersede 链上仍被引用 / 未失效的过期事实。
 *
 * 与 E-AGING1 (`memory-aging-inspector.ts`) 的边界（D-AGING2 brief 明确）：
 *   - 本模块是 D 域真源，**E 应经 HTTP GET 消费**（routes/data.ts），不被 E import；
 *   - 算法独立实现，不复用 E inspector 的私有函数；
 *   - 不依赖反事实探针 / 时序老化曲线（那些归 E 巡检层做）。
 *
 * 数据安全：只读 memory_items 衍生字段（title/body/tags/confidence/signals/supersedesId）；
 *   不读 draw_data，不读 clean_data，不发 LLM。
 */

const MIN_SIMILARITY = 0.35;       // 干扰候选最低相似度
const WARN_SIMILARITY = 0.55;      // ≥ 该阈值升 warn
const CONFIDENCE_DIVERGE = 0.35;   // 置信度分歧阈值
const MAX_ITEMS = 600;             // 防 O(N²) 退化：扫前 600 条（按 updated_at desc）

export type AgingSignalSeverity = "info" | "warn" | "critical";
export type AgingConflictReason = "high-similarity" | "confidence-divergence" | "signal-divergence";

export interface AgingConflictPair {
  pairId: string;            // 稳定排序后 "a:b" — 前端去重 key
  itemAId: string;
  itemBId: string;
  itemATitle: string;
  itemBTitle: string;
  type: MemoryItemType;
  similarity: number;        // [0,1]，三位小数
  sharedTags: string[];
  reasons: AgingConflictReason[];
  severity: AgingSignalSeverity;
}

export interface AgingStaleReference {
  newerId: string;
  newerTitle: string;
  olderId: string;
  olderTitle: string;
  olderStillActive: boolean;             // older 仍 enabled 且未过期
  referencerIds: string[];               // 仍激活、且正文引用 older 的下游卡
  referencerTitles: string[];
  severity: AgingSignalSeverity;         // older 仍激活 || 引用 ≥2 → critical, 否则 warn
}

export interface MemoryAgingSignalsResult {
  workspaceId: string;
  generatedAt: number;
  scanned: number;
  truncated: boolean;
  conflicts: AgingConflictPair[];
  staleRefs: AgingStaleReference[];
}

export interface MemoryAgingSignalsOptions {
  workspaceId: string;
  now?: number;
  items?: MemoryItem[];   // 测试注入；生产路径走 listMemoryItems
}

export function computeMemoryAgingSignals(options: MemoryAgingSignalsOptions): MemoryAgingSignalsResult {
  const now = options.now ?? Date.now();
  const all = options.items ?? listMemoryItems({ workspaceId: options.workspaceId });
  // 按 updated_at desc 取前 N 防 O(N²) 退化（>600 条退化场景下，丢最旧最不可能干扰活跃集）。
  const sorted = [...all].sort((a, b) => b.updatedAt - a.updatedAt);
  const scanned = Math.min(sorted.length, MAX_ITEMS);
  const truncated = sorted.length > MAX_ITEMS;
  const items = sorted.slice(0, scanned);
  const conflicts = detectConflicts(items.filter((m) => isMemoryActive(m, now)));
  const staleRefs = detectStaleReferences(items, now);
  return {
    workspaceId: options.workspaceId,
    generatedAt: now,
    scanned,
    truncated,
    conflicts,
    staleRefs,
  };
}

function detectConflicts(active: MemoryItem[]): AgingConflictPair[] {
  const out: AgingConflictPair[] = [];
  for (let i = 0; i < active.length; i++) {
    for (let j = i + 1; j < active.length; j++) {
      const a = active[i]!;
      const b = active[j]!;
      if (a.type !== b.type) continue;
      // supersede 链上的对不算干扰（属修订老化范畴，由 detectStaleReferences 处理）。
      if (a.supersedesId === b.id || b.supersedesId === a.id) continue;
      const similarity = memorySimilarity(a, b);
      if (similarity < MIN_SIMILARITY) continue;
      const reasons: AgingConflictReason[] = [];
      if (similarity >= WARN_SIMILARITY) reasons.push("high-similarity");
      if (Math.abs(a.confidence - b.confidence) >= CONFIDENCE_DIVERGE) reasons.push("confidence-divergence");
      const aNet = a.positiveSignals - a.negativeSignals;
      const bNet = b.positiveSignals - b.negativeSignals;
      if ((aNet > 0 && bNet < 0) || (aNet < 0 && bNet > 0)) reasons.push("signal-divergence");
      // 至少要 high-similarity 或任一分歧才算冲突。
      if (reasons.length === 0) continue;
      const severity: AgingSignalSeverity =
        reasons.includes("high-similarity") && reasons.length >= 2
          ? "warn"
          : reasons.includes("high-similarity")
            ? "info"
            : reasons.length >= 2
              ? "warn"
              : "info";
      // pair id 稳定排序，避免 a/b 与 b/a 重复落条。
      const [first, second] = a.id < b.id ? [a, b] : [b, a];
      out.push({
        pairId: `${first.id}:${second.id}`,
        itemAId: first.id,
        itemBId: second.id,
        itemATitle: first.title,
        itemBTitle: second.title,
        type: a.type,
        similarity: round3(similarity),
        sharedTags: sharedMemoryTags(a, b),
        reasons,
        severity,
      });
    }
  }
  // 高严重度在前；同级按相似度倒序，便于 UI 截断显示前 N 条。
  return out.sort((p, q) => severityRank(q.severity) - severityRank(p.severity) || q.similarity - p.similarity);
}

function detectStaleReferences(items: MemoryItem[], now: number): AgingStaleReference[] {
  const byId = new Map(items.map((m) => [m.id, m] as const));
  const active = items.filter((m) => isMemoryActive(m, now));
  const out: AgingStaleReference[] = [];
  for (const newer of items) {
    if (!newer.supersedesId) continue;
    const older = byId.get(newer.supersedesId);
    if (!older) continue;
    const olderStillActive = isMemoryActive(older, now);
    // 排除 newer / older 自身的引用。
    const refs = active.filter(
      (m) => m.id !== newer.id && m.id !== older.id && memoryReferences(m, older),
    );
    if (!olderStillActive && refs.length === 0) continue;
    const severity: AgingSignalSeverity = olderStillActive || refs.length >= 2 ? "critical" : "warn";
    out.push({
      newerId: newer.id,
      newerTitle: newer.title,
      olderId: older.id,
      olderTitle: older.title,
      olderStillActive,
      referencerIds: refs.map((m) => m.id),
      referencerTitles: refs.map((m) => m.title),
      severity,
    });
  }
  return out.sort(
    (a, b) =>
      severityRank(b.severity) - severityRank(a.severity) ||
      b.referencerIds.length - a.referencerIds.length,
  );
}

function severityRank(s: AgingSignalSeverity): number {
  return s === "critical" ? 3 : s === "warn" ? 2 : 1;
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}
