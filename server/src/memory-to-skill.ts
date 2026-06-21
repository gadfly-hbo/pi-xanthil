import type { MemoryItem, MemoryItemListResponse } from "./types.ts";

export interface MemorySkillThresholds {
  highConfidence: number;
  minHighConfidenceItems: number;
  minUsedCount: number;
  minPositiveSignals: number;
}

export const DEFAULT_MEMORY_SKILL_THRESHOLDS: MemorySkillThresholds = {
  highConfidence: 0.75,
  minHighConfidenceItems: 3,
  minUsedCount: 6,
  minPositiveSignals: 3,
};

export interface MemorySkillCluster {
  tag: string;
  items: MemoryItem[];
  highConfidenceCount: number;
  totalUsedCount: number;
  totalPositiveSignals: number;
  eligible: boolean;
  reasons: string[];
}

export interface MemorySkillPromotionOutcome {
  clusterTag: string;
  result: unknown;
}

export interface MemoryToSkillResult {
  workspaceId: string;
  dryRun: boolean;
  scanned: number;
  clusters: MemorySkillCluster[];
  eligibleClusters: number;
  promotions: MemorySkillPromotionOutcome[];
}

export interface MemoryToSkillOptions {
  workspaceId: string;
  dryRun?: boolean;
  thresholds?: MemorySkillThresholds;
  now?: number;
  maxPromotions?: number;
  listExperiences: (workspaceId: string) => Promise<MemoryItem[]>;
  distillCluster?: (cluster: MemorySkillCluster, transcript: string) => Promise<unknown>;
}

export async function fetchMemoryExperiences(baseUrl: string, workspaceId: string): Promise<MemoryItem[]> {
  const path = `/api/workspaces/${encodeURIComponent(workspaceId)}/memory/items?type=experience&enabledOnly=1`;
  const response = await fetch(new URL(path, baseUrl));
  if (!response.ok) throw new Error(`D memory list failed with HTTP ${response.status}`);
  const payload = await response.json() as Partial<MemoryItemListResponse>;
  if (!Array.isArray(payload.items)) throw new Error("D memory list response missing items");
  return payload.items.filter((item): item is MemoryItem => item?.type === "experience");
}

export function analyzeMemorySkillClusters(
  items: MemoryItem[],
  thresholds: MemorySkillThresholds = DEFAULT_MEMORY_SKILL_THRESHOLDS,
  now = Date.now(),
): MemorySkillCluster[] {
  const grouped = new Map<string, MemoryItem[]>();
  for (const item of items) {
    if (item.type !== "experience" || !item.enabled) continue;
    if (item.validUntil !== null && item.validUntil <= now) continue;
    const tag = primaryClusterTag(item.tags);
    if (!tag) continue;
    const group = grouped.get(tag) ?? [];
    group.push(item);
    grouped.set(tag, group);
  }

  return [...grouped.entries()]
    .map(([tag, clusterItems]): MemorySkillCluster => {
      const highConfidenceCount = clusterItems.filter((item) => item.confidence >= thresholds.highConfidence).length;
      const totalUsedCount = clusterItems.reduce((sum, item) => sum + item.usedCount, 0);
      const totalPositiveSignals = clusterItems.reduce((sum, item) => sum + item.positiveSignals, 0);
      const checks = [
        { passed: highConfidenceCount >= thresholds.minHighConfidenceItems, reason: `high-confidence ${highConfidenceCount} >= ${thresholds.minHighConfidenceItems}` },
        { passed: totalUsedCount >= thresholds.minUsedCount, reason: `usedCount ${totalUsedCount} >= ${thresholds.minUsedCount}` },
        { passed: totalPositiveSignals >= thresholds.minPositiveSignals, reason: `positiveSignals ${totalPositiveSignals} >= ${thresholds.minPositiveSignals}` },
      ];
      return {
        tag,
        items: clusterItems.sort((a, b) => b.confidence - a.confidence || b.usedCount - a.usedCount || a.id.localeCompare(b.id)),
        highConfidenceCount,
        totalUsedCount,
        totalPositiveSignals,
        eligible: checks.every((check) => check.passed),
        reasons: checks.map((check) => `${check.passed ? "pass" : "fail"}: ${check.reason}`),
      };
    })
    .sort((a, b) => Number(b.eligible) - Number(a.eligible) || b.totalPositiveSignals - a.totalPositiveSignals || a.tag.localeCompare(b.tag));
}

export function buildMemorySkillTranscript(cluster: MemorySkillCluster): string {
  const experiences = cluster.items.map((item, index) => [
    `## 经验 ${index + 1}: ${item.title}`,
    item.body,
    `tags: ${item.tags.join(", ")}`,
    `confidence: ${item.confidence}; usedCount: ${item.usedCount}; positiveSignals: ${item.positiveSignals}`,
  ].join("\n")).join("\n\n");
  return `以下是经过记忆门禁与 Dream Worker 提纯的同类高频经验簇。请把共同方法抽象为一个可评测的通用 Skill，不保留单条记忆的具体业务常量。\n\n聚类标签: ${cluster.tag}\n升级依据: ${cluster.reasons.join("; ")}\n\n${experiences}`;
}

export async function runMemoryToSkillPromotion(options: MemoryToSkillOptions): Promise<MemoryToSkillResult> {
  const items = await options.listExperiences(options.workspaceId);
  const clusters = analyzeMemorySkillClusters(items, options.thresholds, options.now);
  const eligible = clusters.filter((cluster) => cluster.eligible);
  const promotable = eligible.slice(0, options.maxPromotions ?? 5);
  const promotions: MemorySkillPromotionOutcome[] = [];
  if (!options.dryRun) {
    if (!options.distillCluster) throw new Error("distillCluster is required when dryRun is false");
    for (const cluster of promotable) {
      const result = await options.distillCluster(cluster, buildMemorySkillTranscript(cluster));
      promotions.push({ clusterTag: cluster.tag, result });
    }
  }
  return {
    workspaceId: options.workspaceId,
    dryRun: options.dryRun === true,
    scanned: items.length,
    clusters,
    eligibleClusters: eligible.length,
    promotions,
  };
}

function primaryClusterTag(tags: string[]): string | null {
  const normalized = tags.map((tag) => tag.trim()).filter(Boolean);
  const method = normalized.filter((tag) => /^method:/i.test(tag)).sort()[0];
  const methodValue = method?.slice(method.indexOf(":") + 1).trim();
  if (methodValue) return `method:${methodValue}`;
  const task = normalized.filter((tag) => /^task:/i.test(tag)).sort()[0];
  const taskValue = task?.slice(task.indexOf(":") + 1).trim();
  return taskValue ? `task:${taskValue}` : null;
}
