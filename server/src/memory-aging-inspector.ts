import { listMemoryItems } from "./db/data.ts";
import { isMemoryActive, memoryReferences, memorySimilarity, sharedMemoryTags } from "./memory-aging-core.ts";
import type { AgingKind, AgingMetric, CounterfactualProbe, ErrorAttribution, MemoryItem } from "./types.ts";

const DAY_MS = 24 * 60 * 60 * 1000;

export type MemoryAgingSeverity = "info" | "warn" | "critical";
export type MemoryAgingStage = "write" | "read" | "util";

export interface CounterfactualProbeRun extends CounterfactualProbe {
  accuracy: number;
}

export interface MemoryAgingFinding {
  id: string;
  kind: AgingKind;
  severity: MemoryAgingSeverity;
  title: string;
  evidence: string[];
  itemIds: string[];
  metric: AgingMetric;
  attribution: ErrorAttribution | null;
  likelyStage: MemoryAgingStage | null;
  suggestions: string[];
}

export interface MemoryAgingInspectionResult {
  workspaceId: string;
  scanned: number;
  generatedAt: number;
  findings: MemoryAgingFinding[];
  attribution: ErrorAttribution | null;
  recommendations: string[];
}

export interface MemoryAgingInspectionOptions {
  workspaceId: string;
  now?: number;
  items?: MemoryItem[];
  probes?: CounterfactualProbeRun[];
  scoreSeries?: number[];
}

interface ActiveMemoryItem extends MemoryItem {
  active: true;
}

export function runMemoryAgingInspection(options: MemoryAgingInspectionOptions): MemoryAgingInspectionResult {
  const now = options.now ?? Date.now();
  const items = options.items ?? listMemoryItems({ workspaceId: options.workspaceId });
  const activeItems = items.filter((item): item is ActiveMemoryItem => isMemoryActive(item, now));
  const attribution = computeCounterfactualAttribution(options.probes ?? []);
  const findings = [
    ...detectInterferenceFindings(activeItems, options.scoreSeries),
    ...detectRevisionFindings(items, now, options.scoreSeries),
  ];
  const recommendations = summarizeRecommendations(findings, attribution);
  return {
    workspaceId: options.workspaceId,
    scanned: items.length,
    generatedAt: now,
    findings,
    attribution,
    recommendations,
  };
}

export function computeCounterfactualAttribution(probes: CounterfactualProbeRun[]): ErrorAttribution | null {
  const p1 = findProbe(probes, "agent", "agent");
  const p2 = findProbe(probes, "agent", "oracle");
  const p3 = findProbe(probes, "oracle", "oracle");
  if (!p1 || !p2 || !p3) return null;
  return {
    utilErr: round3(1 - clamp01(p3.accuracy)),
    writeErr: round3(clamp01(p3.accuracy) - clamp01(p2.accuracy)),
    readErr: round3(clamp01(p2.accuracy) - clamp01(p1.accuracy)),
  };
}

export function computeAgingMetric(scoreSeries: number[] | undefined, fallbackScore: number, detail: Partial<AgingMetric> = {}): AgingMetric {
  const series = normalizeSeries(scoreSeries);
  const finalScore = series.length > 0 ? (series.at(-1) ?? fallbackScore) : fallbackScore;
  return {
    halfLife: computeHalfLife(series),
    decaySlope: computeDecaySlope(series),
    finalScore: round3(finalScore),
    ...detail,
  };
}

function detectInterferenceFindings(items: ActiveMemoryItem[], scoreSeries: number[] | undefined): MemoryAgingFinding[] {
  const findings: MemoryAgingFinding[] = [];
  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      const a = items[i];
      const b = items[j];
      if (!a || !b) continue;
      if (a.type !== b.type) continue;
      if (a.supersedesId === b.id || b.supersedesId === a.id) continue;
      const similarity = memorySimilarity(a, b);
      if (similarity < 0.35) continue;
      const conflict = hasConflictingSignals(a, b);
      const severity: MemoryAgingSeverity = conflict || similarity >= 0.55 ? "warn" : "info";
      findings.push({
        id: `interference:${a.id}:${b.id}`,
        kind: "interference",
        severity,
        title: `相近记忆可能互相干扰：${a.title} / ${b.title}`,
        evidence: [
          `similarity=${round3(similarity)}`,
          `type=${a.type}`,
          sharedMemoryTags(a, b).length > 0 ? `sharedTags=${sharedMemoryTags(a, b).join(",")}` : "sharedTags=none",
          conflict ? "signals/confidence diverge" : "semantic overlap",
        ],
        itemIds: [a.id, b.id],
        metric: computeAgingMetric(scoreSeries, 1 - similarity, { interferenceResistance: round3(1 - similarity) }),
        attribution: null,
        likelyStage: "read",
        suggestions: [
          "为相近记忆补充 typed entity tag 或更具体的 task:/method:/data: tag。",
          "若其中一条已被新规则取代，补 supersedesId 或设置 validUntil，避免检索时双双入 prompt。",
        ],
      });
    }
  }
  return findings;
}

function detectRevisionFindings(items: MemoryItem[], now: number, scoreSeries: number[] | undefined): MemoryAgingFinding[] {
  const byId = new Map(items.map((item) => [item.id, item]));
  const activeItems = items.filter((item) => isMemoryActive(item, now));
  const findings: MemoryAgingFinding[] = [];
  for (const newer of items) {
    if (!newer.supersedesId) continue;
    const old = byId.get(newer.supersedesId);
    if (!old) continue;
    const oldStillActive = isMemoryActive(old, now);
    const staleReferences = activeItems.filter((item) => item.id !== newer.id && item.id !== old.id && memoryReferences(item, old));
    if (!oldStillActive && staleReferences.length === 0) continue;
    const evidence = [
      `newer=${newer.title}`,
      `supersedes=${old.title}`,
      oldStillActive ? "superseded item is still active" : "superseded item is retired",
      staleReferences.length > 0 ? `activeReferences=${staleReferences.map((item) => item.title).join(" | ")}` : "activeReferences=none",
    ];
    const accumulatorError = round3((oldStillActive ? 1 : 0) + staleReferences.length);
    findings.push({
      id: `revision:${newer.id}:${old.id}`,
      kind: "revision",
      severity: oldStillActive || staleReferences.length >= 2 ? "critical" : "warn",
      title: `事实修订后仍可能引用旧记忆：${old.title}`,
      evidence,
      itemIds: [newer.id, old.id, ...staleReferences.map((item) => item.id)],
      metric: computeAgingMetric(scoreSeries, staleReferences.length === 0 && !oldStillActive ? 1 : 0, {
        accumulatorError,
        forgetAccuracy: oldStillActive ? 0 : 1,
      }),
      attribution: null,
      likelyStage: "util",
      suggestions: [
        "将被取代记忆设置 validUntil，或关闭本工作区启用关系。",
        "回扫引用旧标题/旧 id 的记忆卡，把正文改为引用最新记忆。",
        "修订类问题优先维护显式状态，不靠更大模型消化互相冲突的事实。",
      ],
    });
  }
  return findings;
}

function summarizeRecommendations(findings: MemoryAgingFinding[], attribution: ErrorAttribution | null): string[] {
  const out: string[] = [];
  if (findings.some((finding) => finding.kind === "interference")) {
    out.push("干扰 profile：优先做消歧 tag、退役重复卡，并检查检索 topK 中是否同时塞入相近条目。");
  }
  if (findings.some((finding) => finding.kind === "revision")) {
    out.push("修订 profile：优先显式维护 supersedes/validUntil，并回扫引用旧事实的派生卡。");
  }
  if (attribution) {
    const stage = maxAttributionStage(attribution);
    if (stage === "write") out.push("反事实归因偏写入：压缩/沉淀时保留精确值和实体状态，不要只写泛化经验。");
    if (stage === "read") out.push("反事实归因偏读取：优化检索消歧、tag 精筛和冲突条目过滤。");
    if (stage === "util") out.push("反事实归因偏使用：即使给出正确事实仍答错，应强化回答阶段必须服从检索 context。");
  }
  if (out.length === 0) out.push("未发现干扰/修订老化信号；保持现有 Dream Worker 维护节奏。");
  return out;
}

function findProbe(probes: CounterfactualProbeRun[], write: CounterfactualProbe["write"], read: CounterfactualProbe["read"]): CounterfactualProbeRun | undefined {
  return probes.find((probe) => probe.write === write && probe.read === read);
}

function maxAttributionStage(attribution: ErrorAttribution): MemoryAgingStage {
  const entries: Array<[MemoryAgingStage, number]> = [
    ["write", attribution.writeErr],
    ["read", attribution.readErr],
    ["util", attribution.utilErr],
  ];
  return entries.sort((a, b) => b[1] - a[1])[0]?.[0] ?? "read";
}

function hasConflictingSignals(a: MemoryItem, b: MemoryItem): boolean {
  if (Math.abs(a.confidence - b.confidence) >= 0.35) return true;
  const aNet = a.positiveSignals - a.negativeSignals;
  const bNet = b.positiveSignals - b.negativeSignals;
  return (aNet > 0 && bNet < 0) || (aNet < 0 && bNet > 0);
}

function normalizeSeries(scoreSeries: number[] | undefined): number[] {
  if (!Array.isArray(scoreSeries)) return [];
  return scoreSeries.filter((score) => Number.isFinite(score)).map(clamp01);
}

function computeHalfLife(series: number[]): number {
  if (series.length === 0) return -1;
  const first = series[0];
  if (first === undefined) return -1;
  const threshold = first * 0.5;
  const index = series.findIndex((score) => score <= threshold);
  return index >= 0 ? index : -1;
}

function computeDecaySlope(series: number[]): number {
  if (series.length < 2) return 0;
  const n = series.length;
  const meanX = (n - 1) / 2;
  const meanY = series.reduce((sum, value) => sum + value, 0) / n;
  let numerator = 0;
  let denominator = 0;
  for (let x = 0; x < n; x++) {
    const y = series[x];
    if (y === undefined) continue;
    numerator += (x - meanX) * (y - meanY);
    denominator += (x - meanX) ** 2;
  }
  return denominator === 0 ? 0 : round3(numerator / denominator);
}

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

export function defaultCounterfactualProbes(): CounterfactualProbe[] {
  return [
    { id: "P1", write: "agent", read: "agent" },
    { id: "P2", write: "agent", read: "oracle" },
    { id: "P3", write: "oracle", read: "oracle" },
  ];
}
