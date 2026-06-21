import { generateTraceRuleSuggestions, getTraceTimeline } from "./db.ts";
import { trackUsageEvent } from "./cache.ts";
import { PORT } from "./config.ts";
import { runPiPrompt } from "./pi-adapter.ts";
import { fireMemoryMaintenance } from "./memory-maintenance.ts";
import type { MemoryCandidate, MemoryRiskFlag, PiEvent, TraceRuleSuggestion, TraceTargetKind, TraceTimelineItem } from "./types.ts";

export type MemoryConsolidationTargetKind = Extract<TraceTargetKind, "session" | "flow" | "flow_run">;

export interface MemoryConsolidationIngestContext {
  workspaceId: string;
  targetKind: MemoryConsolidationTargetKind;
  targetId: string;
}

export interface MemoryConsolidationIngestResult {
  ok: boolean;
  itemId?: string;
  error?: string;
}

export interface MemoryConsolidationOptions {
  workspaceId: string;
  workspaceRoot: string;
  targetKind: MemoryConsolidationTargetKind;
  targetId: string;
  model?: string;
  timeoutMs?: number;
  dryRun?: boolean;
  maxCandidates?: number;
  distillText?: (prompt: string) => Promise<string>;
  ingestCandidate?: (candidate: MemoryCandidate, context: MemoryConsolidationIngestContext) => Promise<MemoryConsolidationIngestResult>;
  onEvent?: (event: PiEvent) => void;
}

export interface MemoryConsolidationResult {
  workspaceId: string;
  targetKind: MemoryConsolidationTargetKind;
  targetId: string;
  dryRun: boolean;
  eventCount: number;
  candidates: MemoryCandidate[];
  ingested: Array<MemoryConsolidationIngestResult & { candidate: MemoryCandidate }>;
}

export interface FireMemoryConsolidationOptions {
  workspaceId: string;
  workspaceRoot: string;
  targetKind: MemoryConsolidationTargetKind;
  targetId: string;
  baseUrl?: string;
  label: string;
  onError: (error: unknown) => void;
}

export const MEMORY_CONSOLIDATION_SYSTEM_PROMPT =
  "你是记忆沉淀助手，负责从 pi-xanthil 的执行 trace 中提炼可复用记忆。"
  + "只输出 JSON，不输出解释、Markdown 或代码围栏。"
  + "候选必须是对后续任务有稳定帮助的约束、经验或情景，不要记录一次性结论、原始数据明细或敏感信息。";

export const DEFAULT_CONSOLIDATION_MODEL = "minimax-cn/MiniMax-M3";

const VALID_TYPES = new Set<MemoryCandidate["type"]>(["constraint", "experience", "episode"]);
const VALID_SCOPES = new Set<MemoryCandidate["scope"]>(["global", "chat", "workflow"]);
const RISK_CODES = new Set<MemoryRiskFlag["code"]>(["instruction_injection", "pii", "weak_evidence", "overbroad"]);
const RISK_SEVERITIES = new Set<MemoryRiskFlag["severity"]>(["low", "medium", "high"]);

export function fireMemoryConsolidation(options: FireMemoryConsolidationOptions): void {
  const baseUrl = options.baseUrl ?? `http://127.0.0.1:${PORT}`;
  void runMemoryConsolidation({
    workspaceId: options.workspaceId,
    workspaceRoot: options.workspaceRoot,
    targetKind: options.targetKind,
    targetId: options.targetId,
    dryRun: false,
    timeoutMs: 180_000,
    ingestCandidate: (candidate, context) => postMemoryCandidateToDIngest(
      baseUrl,
      "/api/workspaces/:id/memory/ingest",
      candidate,
      context,
    ),
    onEvent: (event) => trackUsageEvent({
      workspaceId: options.workspaceId,
      targetKind: options.targetKind,
      targetId: options.targetId,
      title: options.label,
    }, event),
  })
    // 搭车 Dream Worker（缺口3）：沉淀(产记忆)成功后顺带跑一次 maintain(养记忆)，节流防高频。
    // 纯算术零 LLM；折叠在此使 session(index.ts)/flow(engine.ts) 现有触发点自动带上，接缝零触碰。
    .then(() => { fireMemoryMaintenance({ workspaceId: options.workspaceId, onError: options.onError }); })
    .catch(options.onError);
}

export async function runMemoryConsolidation(options: MemoryConsolidationOptions): Promise<MemoryConsolidationResult> {
  const maxCandidates = clampInt(options.maxCandidates ?? 6, 1, 12);
  const trace = collectMemoryConsolidationTrace(options.workspaceId, options.targetKind, options.targetId);
  const prompt = buildMemoryConsolidationPrompt({
    targetKind: options.targetKind,
    targetId: options.targetId,
    events: trace.events,
    suggestions: trace.suggestions,
    maxCandidates,
  });
  const raw = options.distillText
    ? await options.distillText(prompt)
    : await runPiPrompt({
      workspaceRoot: options.workspaceRoot,
      text: prompt,
      model: options.model ?? DEFAULT_CONSOLIDATION_MODEL,
      systemPrompt: MEMORY_CONSOLIDATION_SYSTEM_PROMPT,
      timeoutMs: options.timeoutMs ?? 180_000,
      onEvent: options.onEvent,
    });
  const candidates = parseMemoryCandidates(raw, {
    defaultScope: defaultScopeForTarget(options.targetKind),
    fallbackSourceEventIds: trace.events.map((event) => event.id).slice(0, 5),
    maxCandidates,
  });

  const ingested: MemoryConsolidationResult["ingested"] = [];
  if (!options.dryRun) {
    if (!options.ingestCandidate) throw new Error("ingestCandidate is required when dryRun is false");
    for (const candidate of candidates) {
      const result = await options.ingestCandidate(candidate, {
        workspaceId: options.workspaceId,
        targetKind: options.targetKind,
        targetId: options.targetId,
      });
      ingested.push({ ...result, candidate });
    }
  }

  return {
    workspaceId: options.workspaceId,
    targetKind: options.targetKind,
    targetId: options.targetId,
    dryRun: options.dryRun === true,
    eventCount: trace.events.length,
    candidates,
    ingested,
  };
}

export async function postMemoryCandidateToDIngest(
  baseUrl: string,
  ingestPath: string,
  candidate: MemoryCandidate,
  context: MemoryConsolidationIngestContext,
): Promise<MemoryConsolidationIngestResult> {
  const url = new URL(ingestPath.replace(":id", encodeURIComponent(context.workspaceId)), baseUrl);
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      ...candidate,
      source: "trace",
      targetKind: context.targetKind,
      targetId: context.targetId,
    }),
  });
  const payload = await response.json().catch(() => null) as { id?: unknown; error?: unknown } | null;
  if (!response.ok) {
    return {
      ok: false,
      error: typeof payload?.error === "string" ? payload.error : `D memory ingest failed with HTTP ${response.status}`,
    };
  }
  return { ok: true, itemId: typeof payload?.id === "string" ? payload.id : undefined };
}

export function collectMemoryConsolidationTrace(
  workspaceId: string,
  targetKind: MemoryConsolidationTargetKind,
  targetId: string,
): { events: TraceTimelineItem[]; suggestions: TraceRuleSuggestion[] } {
  const events = getTraceTimeline(workspaceId, targetKind, targetId).slice(-80);
  const suggestions = generateTraceRuleSuggestions(workspaceId)
    .filter((suggestion) => suggestion.sourceEventIds.length === 0 || suggestion.sourceEventIds.some((id) => events.some((event) => event.id === id)));
  return { events, suggestions };
}

export function buildMemoryConsolidationPrompt(input: {
  targetKind: MemoryConsolidationTargetKind;
  targetId: string;
  events: TraceTimelineItem[];
  suggestions: TraceRuleSuggestion[];
  maxCandidates: number;
}): string {
  const timeline = input.events.map((event, index) => [
    `#${index + 1} id=${event.id}`,
    `time=${new Date(event.time).toISOString()}`,
    `type=${event.type}`,
    `status=${event.status}`,
    `title=${event.title}`,
    `detail=${event.detail ?? ""}`,
  ].join(" | ")).join("\n");
  const suggestions = input.suggestions.map((suggestion, index) => [
    `#${index + 1} id=${suggestion.id}`,
    `severity=${suggestion.severity}`,
    `title=${suggestion.title}`,
    `evidence=${suggestion.evidence}`,
    `sourceEventIds=${suggestion.sourceEventIds.join(",")}`,
  ].join(" | ")).join("\n");

  return `请从下面的 trace 中沉淀候选记忆，最多输出 ${input.maxCandidates} 条。

【目标】
- targetKind: ${input.targetKind}
- targetId: ${input.targetId}

【trace timeline】
${timeline || "(empty)"}

【已有规则建议信号】
${suggestions || "(none)"}

【候选类型】
- constraint：后续必须遵守的稳定规则、边界或安全约束。
- experience：可复用的操作经验、排错策略、流程偏好。
- episode：有复用价值的情景记忆，只记录抽象情景，不记录一次性业务结论。

【过滤要求】
- 不要输出原始行级数据、样本值、PII、密钥、token、cookie。
- 不要把用户一次性业务结论、具体品牌/地区/数值沉淀为长期记忆。
- 没有稳定价值时输出空数组。
- 每条候选必须能从 sourceEventIds 对应事件找到依据；证据弱时降低 confidence 并加 weak_evidence。
- 每条候选输出 3~5 个分层 tags，按 task:/industry:/method:/data:/problem: 五层软约定选择适用维度；不适用的层级不要硬凑。

【输出 JSON schema】
{
  "candidates": [
    {
      "type": "constraint | experience | episode",
      "title": "短标题",
      "body": "可复用记忆正文，写清适用条件与边界",
      "tags": ["task:任务类型", "method:方法", "problem:问题"],
      "scope": "global | chat | workflow",
      "sourceEventIds": ["trace event id"],
      "confidence": 0.0,
      "riskFlags": [
        {"code":"instruction_injection | pii | weak_evidence | overbroad","severity":"low | medium | high","message":"原因"}
      ]
    }
  ]
}

只输出 JSON。`;
}

export function parseMemoryCandidates(raw: string, options: {
  defaultScope: MemoryCandidate["scope"];
  fallbackSourceEventIds: string[];
  maxCandidates?: number;
}): MemoryCandidate[] {
  const parsed = parseJsonObject(raw);
  if (parsed === null || (typeof parsed !== "object" && !Array.isArray(parsed))) return [];
  const rawCandidates = Array.isArray(parsed)
    ? parsed
    : Array.isArray((parsed as { candidates?: unknown }).candidates)
      ? (parsed as { candidates: unknown[] }).candidates
      : [];
  const maxCandidates = clampInt(options.maxCandidates ?? 6, 1, 12);
  const candidates: MemoryCandidate[] = [];
  for (const item of rawCandidates) {
    if (typeof item !== "object" || item === null) continue;
    const rawItem = item as Record<string, unknown>;
    const type = VALID_TYPES.has(rawItem.type as MemoryCandidate["type"]) ? rawItem.type as MemoryCandidate["type"] : null;
    if (!type) continue;
    const title = String(rawItem.title ?? "").trim();
    const body = String(rawItem.body ?? "").trim();
    if (!title || !body) continue;
    const scope = VALID_SCOPES.has(rawItem.scope as MemoryCandidate["scope"])
      ? rawItem.scope as MemoryCandidate["scope"]
      : options.defaultScope;
    const sourceEventIds = asStringArray(rawItem.sourceEventIds);
    const candidate: MemoryCandidate = {
      type,
      title: title.slice(0, 160),
      body: body.slice(0, 1600),
      tags: asStringArray(rawItem.tags),
      scope,
      sourceEventIds: sourceEventIds.length > 0 ? sourceEventIds.slice(0, 12) : options.fallbackSourceEventIds,
      confidence: clampNumber(Number(rawItem.confidence), 0, 1, 0.6),
      riskFlags: coerceRiskFlags(rawItem.riskFlags),
    };
    candidates.push(applyHeuristicGovernance(candidate));
    if (candidates.length >= maxCandidates) break;
  }
  return candidates;
}

function parseJsonObject(raw: string): unknown {
  const text = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/```$/i, "").trim();
  const direct = safeJsonParse(text);
  if (direct !== null) return direct;
  for (let start = 0; start < text.length; start++) {
    if (text[start] !== "{" && text[start] !== "[") continue;
    const slice = balancedJsonSlice(text, start);
    if (!slice) continue;
    const parsed = safeJsonParse(slice);
    if (parsed !== null) return parsed;
  }
  return null;
}

function safeJsonParse(text: string): unknown | null {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function balancedJsonSlice(text: string, start: number): string | null {
  const opening = text[start];
  if (opening !== "{" && opening !== "[") return null;
  const stack: string[] = [opening];
  let inString = false;
  let escaped = false;
  for (let index = start + 1; index < text.length; index++) {
    const char = text[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') {
      inString = true;
      continue;
    }
    if (char === "{" || char === "[") {
      stack.push(char);
      continue;
    }
    if (char !== "}" && char !== "]") continue;
    const expected = char === "}" ? "{" : "[";
    if (stack.at(-1) !== expected) return null;
    stack.pop();
    if (stack.length === 0) return text.slice(start, index + 1);
  }
  return null;
}

function applyHeuristicGovernance(candidate: MemoryCandidate): MemoryCandidate {
  const riskFlags = [...candidate.riskFlags];
  const text = `${candidate.title}\n${candidate.body}`;
  if (candidate.sourceEventIds.length === 0 || candidate.body.length < 20) {
    riskFlags.push({ code: "weak_evidence", severity: "medium", message: "候选缺少足够 trace 证据或正文过短。" });
  }
  if (/ignore (previous|all)|忽略(之前|所有)|system prompt|developer message|越权|泄露|token|cookie|api[_-]?key/i.test(text)) {
    riskFlags.push({ code: "instruction_injection", severity: "high", message: "候选包含疑似指令注入或敏感凭据相关文本。" });
  }
  if (/身份证|手机号|电话号码|邮箱|email|ssn|passport/i.test(text)) {
    riskFlags.push({ code: "pii", severity: "high", message: "候选包含疑似个人信息。" });
  }
  if (candidate.scope === "global" && candidate.type !== "constraint" && candidate.confidence < 0.75) {
    riskFlags.push({ code: "overbroad", severity: "medium", message: "低置信经验/情景不应默认提升为 global 记忆。" });
  }
  return {
    ...candidate,
    confidence: Math.min(candidate.confidence, riskFlags.some((flag) => flag.severity === "high") ? 0.5 : candidate.confidence),
    riskFlags: dedupeRiskFlags(riskFlags),
  };
}

function coerceRiskFlags(value: unknown): MemoryRiskFlag[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item): MemoryRiskFlag[] => {
    if (typeof item !== "object" || item === null) return [];
    const raw = item as Record<string, unknown>;
    const code = RISK_CODES.has(raw.code as MemoryRiskFlag["code"]) ? raw.code as MemoryRiskFlag["code"] : null;
    const severity = RISK_SEVERITIES.has(raw.severity as MemoryRiskFlag["severity"]) ? raw.severity as MemoryRiskFlag["severity"] : null;
    const message = String(raw.message ?? "").trim();
    if (!code || !severity || !message) return [];
    return [{ code, severity, message: message.slice(0, 240) }];
  });
}

function dedupeRiskFlags(flags: MemoryRiskFlag[]): MemoryRiskFlag[] {
  const seen = new Set<string>();
  const out: MemoryRiskFlag[] = [];
  for (const flag of flags) {
    const key = `${flag.code}:${flag.severity}:${flag.message}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(flag);
  }
  return out;
}

function defaultScopeForTarget(targetKind: MemoryConsolidationTargetKind): MemoryCandidate["scope"] {
  return targetKind === "session" ? "chat" : "workflow";
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0).map((item) => item.trim()) : [];
}

function clampNumber(value: number, min: number, max: number, fallback: number): number {
  return Number.isFinite(value) ? Math.max(min, Math.min(max, value)) : fallback;
}

function clampInt(value: number, min: number, max: number): number {
  return Number.isInteger(value) ? Math.max(min, Math.min(max, value)) : min;
}
