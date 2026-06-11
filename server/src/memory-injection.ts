import { createHash } from "node:crypto";
import {
  buildEnabledBusinessContextPrompt,
  buildEnabledCasesPrompt,
  buildEnabledRulesPrompt,
  buildEnabledStandardsPrompt,
  listAnalysisCases,
  listAnalysisStandards,
  listEnabledMetricDefinitions,
  listBusinessContexts,
  listKgNodes,
  listRuleMemories,
  listMemoryUsageStats,
} from "./db.ts";
import { listEnabledItemIds } from "./db/shared.ts";
import { buildKgPrompt } from "./knowledge-graph.ts";
import type { MemoryInjectionSnapshot, MemorySourceKind, MemorySourceSnapshot, MemoryUsageStats } from "./types.ts";

type PromptPart = {
  kind: MemorySourceKind;
  label: string;
  prompt: string;
  count: number;
  updatedAt: number | null;
  priority: number;
  selectionReason: string;
  usage: MemoryUsageStats | null;
  itemIds: string[];
  meta?: Record<string, number | string | null>;
};

type SelectedPromptPart = PromptPart & {
  selected: boolean;
  omittedReason: string | null;
};

export interface MemorySelectionPolicy {
  tokenBudget: number;
}

const DEFAULT_SELECTION_POLICY: MemorySelectionPolicy = {
  tokenBudget: 4000,
};

function hashText(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

function estimateTokens(text: string): number {
  if (!text) return 0;
  return Math.ceil(text.length / 4);
}

function sourceSnapshot(part: SelectedPromptPart): MemorySourceSnapshot {
  return {
    kind: part.kind,
    label: part.label,
    count: part.count,
    updatedAt: part.updatedAt,
    charCount: part.prompt.length,
    tokenEstimate: estimateTokens(part.prompt),
    promptHash: part.prompt ? hashText(part.prompt) : null,
    injected: Boolean(part.prompt) && part.selected,
    selected: part.selected,
    selectionReason: part.selectionReason,
    omittedReason: part.omittedReason,
    usage: part.usage,
    itemIds: part.itemIds,
    meta: part.meta,
  };
}

function collectMemoryPromptParts(workspaceId: string, targetScope?: "chat" | "workflow"): PromptPart[] {
  const usageByKind = new Map(listMemoryUsageStats(workspaceId).filter((item) => item.sourceId === "*").map((item) => [item.sourceKind, item]));
  const businessContext = buildEnabledBusinessContextPrompt(workspaceId);
  const rules = buildEnabledRulesPrompt(workspaceId, targetScope);
  const standards = buildEnabledStandardsPrompt(workspaceId);
  const cases = buildEnabledCasesPrompt(workspaceId);
  const kg = buildKgPrompt(workspaceId);
  // 全局池 + 按工作区启用：itemIds 与各 buildEnabled* 注入集合保持一致（按 enablement 过滤，非定义行 enabled）。
  const ruleEnabled = new Set(listEnabledItemIds(workspaceId, "rule"));
  const ruleIds = listRuleMemories().filter((rule) => ruleEnabled.has(rule.id) && (!targetScope || rule.scope === "global" || rule.scope === targetScope)).map((rule) => rule.id);
  // metric 真源 = metric_definitions（P2b'）；reference_file 仍在 analysis_standards
  const standardEnabled = new Set(listEnabledItemIds(workspaceId, "standard"));
  const standardIds = [
    ...listAnalysisStandards().filter((s) => standardEnabled.has(s.id) && s.kind === "reference_file").map((s) => s.id),
    ...listEnabledMetricDefinitions(workspaceId).map((m) => m.id),
  ];
  const bizEnabled = new Set(listEnabledItemIds(workspaceId, "business_context"));
  const businessContextIds = listBusinessContexts().filter((context) => bizEnabled.has(context.id)).map((context) => context.id);
  const caseEnabled = new Set(listEnabledItemIds(workspaceId, "case"));
  const caseIds = listAnalysisCases().filter((analysisCase) => caseEnabled.has(analysisCase.id)).map((analysisCase) => analysisCase.id);
  const kgNodeIds = listKgNodes(workspaceId).map((node) => node.id);
  return [
    { kind: "businessContext", label: "业务环境", priority: 10, selectionReason: "业务背景优先保留，避免 agent 凭空假设", usage: usageByKind.get("businessContext") ?? null, itemIds: businessContextIds, ...businessContext },
    { kind: "rules", label: "规则", priority: 20, selectionReason: "规则按 targetScope 过滤后保留", usage: usageByKind.get("rules") ?? null, itemIds: ruleIds, ...rules },
    { kind: "standards", label: "指标体系", priority: 30, selectionReason: "指标口径保持在规则之后注入", usage: usageByKind.get("standards") ?? null, itemIds: standardIds, ...standards },
    { kind: "cases", label: "分析案例库", priority: 40, selectionReason: "few-shot 案例低于规则和口径，预算不足时可省略", usage: usageByKind.get("cases") ?? null, itemIds: caseIds, ...cases },
    {
      kind: "knowledgeGraph",
      label: "知识图谱",
      priority: 50,
      selectionReason: "KG 摘要优先级最低，预算不足时先省略",
      usage: usageByKind.get("knowledgeGraph") ?? null,
      itemIds: kgNodeIds,
      prompt: kg.prompt,
      count: kg.reportCount + kg.edgeCount,
      updatedAt: kg.updatedAt,
      meta: { reportCount: kg.reportCount, edgeCount: kg.edgeCount },
    },
  ];
}

function selectMemoryPromptParts(parts: PromptPart[], policy: MemorySelectionPolicy): SelectedPromptPart[] {
  const sorted = [...parts].sort((a, b) => a.priority - b.priority);
  let used = 0;
  const selectedByKind = new Map<MemorySourceKind, SelectedPromptPart>();
  for (const part of sorted) {
    const tokenEstimate = estimateTokens(part.prompt);
    if (!part.prompt) {
      selectedByKind.set(part.kind, { ...part, selected: false, omittedReason: "no enabled content" });
      continue;
    }
    if (part.usage && part.usage.negativeSignals >= part.usage.positiveSignals + 3) {
      selectedByKind.set(part.kind, {
        ...part,
        selected: false,
        omittedReason: `suppressed by negative feedback (${part.usage.negativeSignals}/${part.usage.positiveSignals})`,
      });
      continue;
    }
    if (used + tokenEstimate > policy.tokenBudget) {
      selectedByKind.set(part.kind, {
        ...part,
        selected: false,
        omittedReason: `token budget exceeded (${used + tokenEstimate}/${policy.tokenBudget})`,
      });
      continue;
    }
    used += tokenEstimate;
    selectedByKind.set(part.kind, { ...part, selected: true, omittedReason: null });
  }
  return parts.map((part) => selectedByKind.get(part.kind) ?? { ...part, selected: false, omittedReason: "not evaluated" });
}

export function buildMemoryInjectionSnapshot(
  workspaceId: string,
  requested: boolean | undefined,
  targetScope: "chat" | "workflow",
  policy: Partial<MemorySelectionPolicy> = {},
): MemoryInjectionSnapshot {
  const resolvedPolicy = { ...DEFAULT_SELECTION_POLICY, ...policy };
  if (!requested) {
    return {
      requested: false,
      targetScope,
      injected: false,
      promptHash: null,
      charCount: 0,
      tokenEstimate: 0,
      tokenBudget: resolvedPolicy.tokenBudget,
      sourceCount: 0,
      sources: [],
    };
  }

  const parts = selectMemoryPromptParts(collectMemoryPromptParts(workspaceId, targetScope), resolvedPolicy);
  const prompt = parts.filter((part) => part.selected).map((part) => part.prompt).filter(Boolean).join("\n\n");
  const sources = parts.map(sourceSnapshot);
  return {
    requested: true,
    targetScope,
    injected: Boolean(prompt),
    promptHash: prompt ? hashText(prompt) : null,
    charCount: prompt.length,
    tokenEstimate: estimateTokens(prompt),
    tokenBudget: resolvedPolicy.tokenBudget,
    sourceCount: sources.filter((source) => source.injected).length,
    sources,
  };
}

export function buildMemoryPrompt(workspaceId: string, targetScope?: "chat" | "workflow", policy: Partial<MemorySelectionPolicy> = {}): string {
  const resolvedPolicy = { ...DEFAULT_SELECTION_POLICY, ...policy };
  return selectMemoryPromptParts(collectMemoryPromptParts(workspaceId, targetScope), resolvedPolicy)
    .filter((part) => part.selected)
    .map((part) => part.prompt)
    .filter(Boolean)
    .join("\n\n");
}
