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
import { listEnabledMemoryItems, listProjectedFacts } from "./db/data.ts";
import type { ProjectedFactItem } from "./db/data.ts";
import { buildKgPrompt } from "./knowledge-graph.ts";
import type {
  MemoryInjectionSnapshot,
  MemoryItem,
  MemorySourceKind,
  MemorySourceSnapshot,
  MemoryUsageStats,
  RetrievalContext,
} from "./types.ts";

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
  /** memory_item 多信号召回 top-K（实际入注入数还会受 token 预算二次裁剪）。 */
  memoryItemTopK?: number;
}

const DEFAULT_SELECTION_POLICY: MemorySelectionPolicy = {
  tokenBudget: 4000,
  memoryItemTopK: 8,
};

// ─── 多信号打分权重（D-RETRIEVAL 阶段1 内置；后续可经 policy 注入）────────
// 记忆 v2.0 缺口1：加 tagMatch 维度（结构化精筛），权重重新归一（和=1.0）。
// 无 tag 信号时 tagMatch=0，五维退化为原四维相对比例，既有 ranking 基线不破。
const SCORE_WEIGHTS = {
  relevance: 0.4,
  recency: 0.18,
  feedback: 0.17,
  typePriority: 0.12,
  tagMatch: 0.13,
} as const;

// type 优先级（约束 > 事实 > 经验 > 情景），归一化到 [0,1]
const TYPE_PRIORITY: Record<"constraint" | "fact" | "experience" | "episode", number> = {
  constraint: 1.0,
  fact: 0.85,
  experience: 0.6,
  episode: 0.4,
};

// 负反馈压制阈值：neg ≥ pos + 此数则视为 suppressed。
const SUPPRESS_NEG_DELTA = 3;

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

// ============================================================================
// D-RETRIEVAL · 多信号打分召回（阶段1 · 复用 knowledge-graph 词法重叠思路）
// ============================================================================
const STOPWORDS = new Set([
  "的", "了", "在", "是", "和", "与", "或", "也", "都", "不", "有", "对", "及",
  "将", "已", "为", "以", "从", "该", "其", "则", "时", "下", "上", "中", "内",
  "by", "the", "a", "an", "in", "of", "to", "for", "is", "are", "was", "be",
  "this", "that", "it", "at", "as", "with", "on", "from", "or", "and", "not",
]);

function tokenize(text: string): Set<string> {
  if (!text) return new Set();
  return new Set(
    text
      .replace(/[，。；：！？,.;:!?"'「」【】（）()\-_\n\r\t/]/g, " ")
      .split(/\s+/)
      .map((w) => w.trim().toLowerCase())
      .filter((w) => w.length >= 2 && !STOPWORDS.has(w)),
  );
}

function relevanceScore(query: Set<string>, target: Set<string>): number {
  if (query.size === 0 || target.size === 0) return 0;
  let shared = 0;
  for (const w of query) if (target.has(w)) shared++;
  // 归一化到 [0,1]：以 query 词数为分母（聚焦"查询命中率"）。
  return shared / query.size;
}

function recencyScore(updatedAt: number | null, now: number, halfLifeDays = 30): number {
  if (!updatedAt) return 0;
  const ageDays = Math.max(0, (now - updatedAt) / 86400000);
  // 半衰期衰减：score = 0.5 ^ (age / halfLife)
  return Math.pow(0.5, ageDays / halfLifeDays);
}

function feedbackScore(pos: number, neg: number): number {
  // neutral=0.5；正反馈 > 负反馈拉高，反之拉低；clip 到 [0,1]。
  if (pos + neg === 0) return 0.5;
  const raw = (pos - neg) / (pos + neg + 1);
  return Math.max(0, Math.min(1, (raw + 1) / 2));
}

// 记忆 v2.0 缺口1：tag 命中评分 = 候选 tag ∩ 请求 tag / |请求 tag|，归一 [0,1]。
// 请求 tag 为空时返回 0（tagMatch 维度自然退化，不影响无 tag 检索的基线）。
function tagMatchScore(candidateTags: string[], requestedTags: Set<string>): number {
  if (requestedTags.size === 0 || candidateTags.length === 0) return 0;
  let hit = 0;
  for (const t of candidateTags) if (requestedTags.has(t)) hit++;
  return hit / requestedTags.size;
}

// X-MEM2-CTX · tag 信号分层（防自动注入清空召回）：
//   filterTags = 显式 ctx.tags（调用方刻意结构化作用域，如面板按 tag 筛）→ 硬预过滤；
//   boostTags  = filterTags ∪ query 前缀解析 ∪ dataPaths→data: → 仅 tagMatch 加权。
// 推断信号绝不进硬过滤：否则记忆多数未打 tag 时，一个 spurious/推断 tag 会把 untagged
// 候选全部剔出、静默打空召回（同 URL 坑同源，总控研判 2026-06-21）。
interface DerivedTags {
  filterTags: Set<string>; // 硬预过滤（仅显式）
  boostTags: Set<string>;  // tagMatch 打分（显式 + 推断）
}

// 从 query 解析 `前缀:值` 形态 token。前缀限白名单 (task/industry/method/data/problem)，
// 避免 `https://…`、英文 `word:value` 被误判为 tag（总控终审收敛 2026-06-21）。
function parseQueryTags(query: string | undefined): string[] {
  if (!query) return [];
  const out: string[] = [];
  for (const m of query.matchAll(/(?:^|\s)((?:task|industry|method|data|problem):[^\s，。；,;]+)/gi)) {
    const tag = m[1]?.trim();
    if (tag) out.push(tag);
  }
  return out;
}

// dataPaths → data:<文件名 stem>（小写，去扩展名），作为 boost 信号。
function dataPathTags(dataPaths: string[] | undefined): string[] {
  if (!dataPaths?.length) return [];
  const out: string[] = [];
  for (const p of dataPaths) {
    const base = p.split(/[\\/]/).pop()?.replace(/\.[^.]+$/, "").trim().toLowerCase();
    if (base) out.push(`data:${base}`);
  }
  return out;
}

function deriveTags(ctx: RetrievalContext | undefined): DerivedTags {
  const filterTags = new Set<string>();
  for (const t of ctx?.tags ?? []) {
    const tag = typeof t === "string" ? t.trim() : "";
    if (tag) filterTags.add(tag);
  }
  const boostTags = new Set<string>(filterTags);
  for (const t of parseQueryTags(ctx?.query)) boostTags.add(t);
  for (const t of dataPathTags(ctx?.dataPaths)) boostTags.add(t);
  return { filterTags, boostTags };
}

// ─── memory_item 候选：MemoryItem(constraint/experience/episode) ∪ ProjectedFactItem ───
type RetrievalCandidate = {
  id: string;
  type: "constraint" | "experience" | "episode" | "fact";
  title: string;
  body: string;
  tags: string[];
  updatedAt: number;
  positiveSignals: number;
  negativeSignals: number;
  validUntil: number | null;
  staleAfterDays: number;
  riskFlags: Array<{ code: string; severity: string; message: string }>;
  supersedesId: string | null;
  scope: "global" | "chat" | "workflow";
  factKind?: ProjectedFactItem["factKind"];
};

function memoryItemToCandidate(m: MemoryItem): RetrievalCandidate {
  return {
    id: m.id,
    type: m.type,
    title: m.title,
    body: m.body,
    tags: m.tags,
    updatedAt: m.updatedAt,
    positiveSignals: m.positiveSignals,
    negativeSignals: m.negativeSignals,
    validUntil: m.validUntil,
    staleAfterDays: m.staleAfterDays,
    riskFlags: m.riskFlags,
    supersedesId: m.supersedesId,
    scope: m.scope,
  };
}

function factToCandidate(f: ProjectedFactItem): RetrievalCandidate {
  return {
    id: f.id,
    type: "fact",
    title: f.title,
    body: f.body,
    tags: [],
    updatedAt: f.updatedAt,
    positiveSignals: 0,
    negativeSignals: 0,
    validUntil: f.validUntil,
    staleAfterDays: 0, // fact 投影不做过期
    riskFlags: [],
    supersedesId: null,
    scope: "global",
    factKind: f.factKind,
  };
}

type ScoredCandidate = RetrievalCandidate & {
  score: number;
  signals: { relevance: number; recency: number; feedback: number; typePriority: number; tagMatch: number };
};

function isExpired(c: RetrievalCandidate, now: number): boolean {
  if (c.validUntil != null && c.validUntil < now) return true;
  if (c.staleAfterDays > 0) {
    const ageDays = (now - c.updatedAt) / 86400000;
    if (ageDays > c.staleAfterDays) return true;
  }
  return false;
}

function isPoisoned(c: RetrievalCandidate): boolean {
  return c.riskFlags.some((f) => f.severity === "high");
}

function isSuppressed(c: RetrievalCandidate): boolean {
  return c.negativeSignals >= c.positiveSignals + SUPPRESS_NEG_DELTA;
}

function buildSupersededIds(items: MemoryItem[]): Set<string> {
  // 状态演化：被另一条 supersedesId 指向的旧条目召回时剔除。
  const out = new Set<string>();
  for (const m of items) {
    if (m.supersedesId) out.add(m.supersedesId);
  }
  return out;
}

function scoreCandidate(c: RetrievalCandidate, queryTokens: Set<string>, requestedTags: Set<string>, now: number): ScoredCandidate {
  const targetTokens = tokenize(`${c.title} ${c.body}`);
  const relevance = relevanceScore(queryTokens, targetTokens);
  const recency = recencyScore(c.updatedAt, now);
  const feedback = feedbackScore(c.positiveSignals, c.negativeSignals);
  const typePriority = TYPE_PRIORITY[c.type] ?? 0.4;
  const tagMatch = tagMatchScore(c.tags, requestedTags);
  const score =
    SCORE_WEIGHTS.relevance * relevance +
    SCORE_WEIGHTS.recency * recency +
    SCORE_WEIGHTS.feedback * feedback +
    SCORE_WEIGHTS.typePriority * typePriority +
    SCORE_WEIGHTS.tagMatch * tagMatch;
  return { ...c, score, signals: { relevance, recency, feedback, typePriority, tagMatch } };
}

function formatCandidateBlock(c: ScoredCandidate): string {
  const typeLabel =
    c.type === "constraint" ? "约束"
    : c.type === "experience" ? "经验"
    : c.type === "episode" ? "情景"
    : "事实";
  const body = c.body.trim();
  return `- [${typeLabel}] ${c.title}${body ? `\n  ${body.replace(/\n/g, "\n  ")}` : ""}`;
}

function buildQueryTokens(ctx: RetrievalContext | undefined): Set<string> {
  if (!ctx) return new Set();
  const parts: string[] = [];
  if (ctx.query) parts.push(ctx.query);
  if (ctx.recentMessages?.length) parts.push(ctx.recentMessages.join(" "));
  if (ctx.dataPaths?.length) parts.push(ctx.dataPaths.join(" "));
  return tokenize(parts.join(" "));
}

/**
 * D-RETRIEVAL 多信号打分召回：MemoryItem(constraint/experience/episode) ∪ fact 投影。
 * 治理过滤先行（剔除 expired/poison/superseded/suppressed），再按 score 降序，按 topK 取前
 * 若干形成 prompt 块（最终是否入注入由 token 预算在 selectMemoryPromptParts 决定）。
 */
function collectMemoryItemPart(
  workspaceId: string,
  targetScope: "chat" | "workflow" | undefined,
  ctx: RetrievalContext | undefined,
  topK: number,
  now: number,
): PromptPart {
  // 阶段1 过渡开关（总控终审收敛）：facts(business_context/metric/reference) 仍由 legacy
  // businessContext + standards 两源权威注入；此处暂不纳入 fact 投影，避免同一内容重复进
  // system prompt。待 legacy 两源在清理步退役后，置 true 把 fact 召回切到统一 memory_item
  // 路径（fact adapter 已就绪：listProjectedFacts / factToCandidate）。
  const INCLUDE_PROJECTED_FACTS = false;
  const items = listEnabledMemoryItems(workspaceId);
  const facts = INCLUDE_PROJECTED_FACTS ? listProjectedFacts(workspaceId) : [];
  const supersededIds = buildSupersededIds(items);
  const queryTokens = buildQueryTokens(ctx);
  const { filterTags, boostTags } = deriveTags(ctx);

  const all: RetrievalCandidate[] = [
    ...items.map(memoryItemToCandidate),
    ...facts.map(factToCandidate),
  ];

  // 治理过滤：剔除 scope 不匹配 / suppressed / expired / poison / superseded。
  // 结构化预过滤（「SQL 精筛为主」对齐）：仅当调用方传**显式 filterTags** 时才硬收窄候选池
  // （无交集即出局，含 untagged）。推断信号（query 前缀/dataPaths）不参与硬过滤——见 deriveTags。
  const survived: RetrievalCandidate[] = [];
  for (const c of all) {
    if (targetScope && c.scope !== "global" && c.scope !== targetScope) continue;
    if (supersededIds.has(c.id)) continue;
    if (isExpired(c, now)) continue;
    if (isPoisoned(c)) continue;
    if (isSuppressed(c)) continue;
    if (filterTags.size > 0 && !c.tags.some((t) => filterTags.has(t))) continue;
    survived.push(c);
  }

  // 多信号打分（tagMatch 用 boostTags：显式 + 推断），降序，取 top-K。
  const scored = survived.map((c) => scoreCandidate(c, queryTokens, boostTags, now));
  scored.sort((a, b) => b.score - a.score);
  const selected = scored.slice(0, Math.max(0, topK));

  const promptHeader = "<xanthil-memory-items>";
  const promptFooter = "</xanthil-memory-items>";
  const promptBody = selected.map(formatCandidateBlock).join("\n");
  const prompt = selected.length > 0 ? `${promptHeader}\n${promptBody}\n${promptFooter}` : "";

  return {
    kind: "memory_item",
    label: "统一记忆",
    prompt,
    count: selected.length,
    updatedAt: selected.reduce<number | null>((acc, c) => (acc == null || c.updatedAt > acc ? c.updatedAt : acc), null),
    priority: 25, // 介于 rules(20) 与 standards(30) 之间；实际筛选由多信号打分主导
    selectionReason: ctx?.query
      ? "memory_item 多信号召回（relevance + recency + feedback + typePriority + tagMatch）"
      : "memory_item 多信号召回（无 ctx，仅按 recency/feedback/typePriority）",
    usage: null,
    itemIds: selected.map((c) => c.id),
    meta: {
      candidateCount: all.length,
      survivedCount: survived.length,
      filteredCount: all.length - survived.length,
      topK,
      topScore: selected[0]?.score ?? 0,
      requestedTagCount: filterTags.size, // 硬预过滤的显式 tag 数（推断 boost 不计）
      boostTagCount: boostTags.size,
    },
  };
}


function collectMemoryPromptParts(
  workspaceId: string,
  targetScope: "chat" | "workflow" | undefined,
  ctx: RetrievalContext | undefined,
  policy: MemorySelectionPolicy,
  now: number,
): PromptPart[] {
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

  // D-RETRIEVAL 阶段1：memory_item 多信号召回 + 治理过滤。
  const memoryItemPart = collectMemoryItemPart(
    workspaceId,
    targetScope,
    ctx,
    policy.memoryItemTopK ?? DEFAULT_SELECTION_POLICY.memoryItemTopK as number,
    now,
  );
  // memory_item 这一源亦支持 source 维度负反馈压制（与旧 5 类同口径）。
  memoryItemPart.usage = usageByKind.get("memory_item") ?? null;

  return [
    { kind: "businessContext", label: "业务环境", priority: 10, selectionReason: "业务背景优先保留，避免 agent 凭空假设", usage: usageByKind.get("businessContext") ?? null, itemIds: businessContextIds, ...businessContext },
    { kind: "rules", label: "规则", priority: 20, selectionReason: "规则按 targetScope 过滤后保留", usage: usageByKind.get("rules") ?? null, itemIds: ruleIds, ...rules },
    memoryItemPart,
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
    if (part.usage && part.usage.negativeSignals >= part.usage.positiveSignals + SUPPRESS_NEG_DELTA) {
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
  ctx?: RetrievalContext,
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

  const now = Date.now();
  const parts = selectMemoryPromptParts(
    collectMemoryPromptParts(workspaceId, targetScope, ctx, resolvedPolicy, now),
    resolvedPolicy,
  );
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

export function buildMemoryPrompt(workspaceId: string, targetScope?: "chat" | "workflow", policy: Partial<MemorySelectionPolicy> = {}, ctx?: RetrievalContext): string {
  const resolvedPolicy = { ...DEFAULT_SELECTION_POLICY, ...policy };
  const now = Date.now();
  return selectMemoryPromptParts(
    collectMemoryPromptParts(workspaceId, targetScope, ctx, resolvedPolicy, now),
    resolvedPolicy,
  )
    .filter((part) => part.selected)
    .map((part) => part.prompt)
    .filter(Boolean)
    .join("\n\n");
}

/**
 * 把工作区记忆 prompt 拼到给定 systemPrompt 之前。无记忆时原样返回 systemPrompt。
 * chat / workflow 两域共用（T-C2b：从 index.ts 上移）。
 */
export function withRulesPrompt(workspaceId: string, targetScope: "chat" | "workflow", systemPrompt?: string, ctx?: RetrievalContext): string | undefined {
  const memoryPrompt = buildMemoryPrompt(workspaceId, targetScope, {}, ctx);
  if (!memoryPrompt) return systemPrompt;
  return [memoryPrompt, systemPrompt].filter(Boolean).join("\n\n");
}
