import type {
  RiskLevel,
  ToolAiExposure,
  ToolOutputContract,
  ToolRunStatus,
} from "./types.ts";
import {
  checkToolPolicy,
  getEffectiveAiExposure,
  type ToolPolicyInput,
} from "./tool-policy.ts";

/**
 * 工具推荐器输入上下文。
 * 不包含任何文件内容或原始行数据，只有元数据 / 统计 / 登记路径类型。
 */
export interface ToolRecommendationInput {
  /** 当前入口，推荐器只能在该入口允许的 aiExposure 中排序。 */
  entry: ToolAiExposure;
  /** 用户意图短文本；仅用于关键词匹配 manifest tags / allowedUse / input.accept。 */
  intent?: string;
  /** 候选工具 manifest（仅含 scorer/policy 需要的元数据）。 */
  tools: ToolRecommendationManifest[];
  /** 已登记路径上下文（扩展名、目录类别等）。 */
  pathContext?: PathContext;
  /** 按 toolId 聚合的运行看板统计。 */
  ledgerStats?: Record<string, ToolRunLedgerStats>;
  /** 按 toolId 聚合的 ToolLab 评测统计。 */
  toolLabStats?: Record<string, ToolLabStats>;
}

export interface ToolRecommendationManifest {
  id: string;
  category?: "ingestion" | "analysis";
  tags?: string[];
  aiExposure?: ToolAiExposure[];
  riskLevel?: RiskLevel;
  deprecated?: boolean;
  outputContract?: ToolOutputContract;
  replacementToolId?: string;
  /** 工具接受的输入扩展名（如 .csv）。 */
  inputAccept?: string[];
  /** 工具适用场景短句。 */
  allowedUse?: string;
  /** 工具禁止场景短句。 */
  forbiddenUse?: string;
}

export interface PathContext {
  extensions: string[];
  folderKinds: Array<"draw_data" | "clean_data" | "report" | "knowledge">;
  /** 目录路径的最后一个类别名（用于目录模式匹配）。 */
  dirCategories: string[];
}

export interface ToolRunLedgerStats {
  totalRuns: number;
  successRuns: number;
  failedRuns: number;
  lastRunAt: number | null;
  lastStatus: ToolRunStatus | null;
}

export interface ToolLabStats {
  total: number;
  success: number;
  failed: number;
  lastEvaluationAt: number | null;
}

export interface ToolRecommendation {
  toolId: string;
  score: number;
  /** 是否允许在 entry 下执行。 */
  allowed: boolean;
  reasons: string[];
  warnings: string[];
  blockers: string[];
}

export interface ToolRecommendationResult {
  entry: ToolAiExposure;
  candidates: ToolRecommendation[];
  /** 全局级 blocker（如无合规候选）。 */
  blockers: string[];
}

const VALID_ENTRIES: ReadonlySet<ToolAiExposure> = new Set([
  "manual_confirmed",
  "mcp",
  "command",
  "subagent",
  "workflow",
  "eval",
]);

const VALID_FOLDERS: ReadonlySet<PathContext["folderKinds"][number]> = new Set([
  "draw_data",
  "clean_data",
  "report",
  "knowledge",
]);

function normalizeText(text: string): string[] {
  const lower = text.toLowerCase();
  const tokens = lower
    .split(/[^a-z0-9\u4e00-\u9fa5]+/)
    .filter((t) => t.length >= 2);
  return [...new Set(tokens)];
}

function normalizeExtensions(extensions: string[]): string[] {
  return [
    ...new Set(
      extensions
        .map((e) => e.toLowerCase().trim())
        .filter((e) => e.startsWith(".") && e.length > 1)
    ),
  ];
}

function normalizeFolderKinds(
  kinds: unknown[]
): PathContext["folderKinds"] {
  return kinds.filter((k): k is PathContext["folderKinds"][number] =>
    VALID_FOLDERS.has(k as PathContext["folderKinds"][number])
  );
}

export function buildPathContext(
  paths: Array<{ path: string; folder: string; kind: "file" | "dir" }>
): PathContext {
  const extensions: string[] = [];
  const folderKinds: Array<PathContext["folderKinds"][number]> = [];
  const dirCategories: string[] = [];

  for (const p of paths) {
    if (VALID_FOLDERS.has(p.folder as PathContext["folderKinds"][number])) {
      folderKinds.push(p.folder as PathContext["folderKinds"][number]);
    }
    if (p.kind === "file") {
      const lastDot = p.path.lastIndexOf(".");
      if (lastDot > 0) {
        extensions.push(p.path.slice(lastDot));
      }
    } else if (p.kind === "dir") {
      const normalized = p.path.replace(/\\/g, "/").replace(/\/$/, "");
      const last = normalized.split("/").pop();
      if (last) dirCategories.push(last.toLowerCase());
    }
  }

  return {
    extensions: normalizeExtensions(extensions),
    folderKinds: [...new Set(normalizeFolderKinds(folderKinds))],
    dirCategories: [...new Set(dirCategories)],
  };
}

export function aggregateToolRunLedgerStats(
  records: Array<{
    toolId: string;
    status: ToolRunStatus;
    time: number;
  }>
): Record<string, ToolRunLedgerStats> {
  const map = new Map<string, ToolRunLedgerStats>();
  for (const r of records) {
    const existing = map.get(r.toolId) ?? {
      totalRuns: 0,
      successRuns: 0,
      failedRuns: 0,
      lastRunAt: null,
      lastStatus: null,
    };
    existing.totalRuns += 1;
    if (r.status === "success") existing.successRuns += 1;
    else existing.failedRuns += 1;
    if (existing.lastRunAt === null || r.time > existing.lastRunAt) {
      existing.lastRunAt = r.time;
      existing.lastStatus = r.status;
    }
    map.set(r.toolId, existing);
  }
  return Object.fromEntries(map);
}

export function aggregateToolLabStats(
  evaluations: Array<{
    toolId: string;
    status: "success" | "failed";
    startedAt: number;
  }>
): Record<string, ToolLabStats> {
  const map = new Map<string, ToolLabStats>();
  for (const e of evaluations) {
    const existing = map.get(e.toolId) ?? {
      total: 0,
      success: 0,
      failed: 0,
      lastEvaluationAt: null,
    };
    existing.total += 1;
    if (e.status === "success") existing.success += 1;
    else existing.failed += 1;
    if (
      existing.lastEvaluationAt === null ||
      e.startedAt > existing.lastEvaluationAt
    ) {
      existing.lastEvaluationAt = e.startedAt;
    }
    map.set(e.toolId, existing);
  }
  return Object.fromEntries(map);
}

function toPolicyInput(
  tool: ToolRecommendationManifest
): ToolPolicyInput {
  return {
    id: tool.id,
    category: tool.category,
    aiExposure: tool.aiExposure,
    riskLevel: tool.riskLevel,
    deprecated: tool.deprecated,
    outputContract: tool.outputContract,
    replacementToolId: tool.replacementToolId,
  };
}

function scoreRiskLevel(riskLevel: RiskLevel | undefined): number {
  switch (riskLevel) {
    case "L0":
      return 10;
    case "L1":
      return 5;
    case "L2":
      return 0;
    case "L3":
      return -10;
    default:
      return 0;
  }
}

function scoreOutputContract(
  contract: ToolOutputContract | undefined,
  entry: ToolAiExposure
): number {
  const shape = contract?.tableShape ?? "unknown";
  let score = 0;
  if (shape === "aggregate") score += 10;
  if (shape === "unknown") score += 0;
  if (shape === "row_level") score -= 5;
  if (contract?.llmSafeSummary) score += 5;
  // autonomous 入口对 row_level 额外惩罚已在 policy 层 blocker，这里只做轻量排序
  if ((entry === "mcp" || entry === "subagent") && shape === "row_level") {
    score -= 10;
  }
  return score;
}

function scoreLedger(
  stats: ToolRunLedgerStats | undefined
): { score: number; reason: string | null } {
  if (!stats || stats.totalRuns === 0) return { score: 0, reason: null };
  const successRate = stats.successRuns / stats.totalRuns;
  const score = Math.round(10 * successRate);
  const reason = `ledger ${stats.successRuns}/${stats.totalRuns} success`;
  return { score, reason };
}

function scoreToolLab(
  stats: ToolLabStats | undefined
): { score: number; reason: string | null } {
  if (!stats || stats.total === 0) return { score: 0, reason: null };
  const successRate = stats.success / stats.total;
  const score = Math.round(10 * successRate);
  const reason = `lab ${stats.success}/${stats.total} pass`;
  return { score, reason };
}

function scoreKeywordMatches(
  intentTokens: string[],
  tool: ToolRecommendationManifest
): Array<{ label: string; score: number }> {
  const hits: Array<{ label: string; score: number }> = [];
  if (intentTokens.length === 0) return hits;

  const tagMatches = (tool.tags ?? []).filter((tag) =>
    intentTokens.some((t) => tag.toLowerCase().includes(t))
  );
  if (tagMatches.length > 0) {
    hits.push({ label: `tag match: ${tagMatches.join(", ")}`, score: tagMatches.length * 10 });
  }

  const allowedUse = tool.allowedUse ?? "";
  if (allowedUse) {
    const allowedTokens = normalizeText(allowedUse);
    const allowedMatches = allowedTokens.filter((t) =>
      intentTokens.includes(t)
    );
    if (allowedMatches.length > 0) {
      hits.push({
        label: `use-case match: ${allowedMatches.join(", ")}`,
        score: allowedMatches.length * 8,
      });
    }
  }

  return hits;
}

function scorePathMatches(
  pathContext: PathContext | undefined,
  tool: ToolRecommendationManifest
): Array<{ label: string; score: number }> {
  const hits: Array<{ label: string; score: number }> = [];
  if (!pathContext) return hits;

  const accepts = (tool.inputAccept ?? []).map((a) => a.toLowerCase());
  const matchedExts = pathContext.extensions.filter((ext) =>
    accepts.includes(ext)
  );
  if (matchedExts.length > 0) {
    hits.push({
      label: `input format match: ${matchedExts.join(", ")}`,
      score: 15,
    });
  }

  // 目录类别匹配：工具 id 或 tag 中含目录类别名
  if (pathContext.dirCategories.length > 0) {
    const toolText = [tool.id, ...(tool.tags ?? []), tool.allowedUse ?? ""]
      .join(" ")
      .toLowerCase();
    const matchedCategories = pathContext.dirCategories.filter((c) =>
      toolText.includes(c)
    );
    if (matchedCategories.length > 0) {
      hits.push({
        label: `directory category match: ${matchedCategories.join(", ")}`,
        score: 5,
      });
    }
  }

  return hits;
}

function recommendSingleTool(
  entry: ToolAiExposure,
  intentTokens: string[],
  pathContext: PathContext | undefined,
  ledger: Record<string, ToolRunLedgerStats>,
  lab: Record<string, ToolLabStats>,
  tool: ToolRecommendationManifest
): ToolRecommendation {
  const policyInput = toPolicyInput(tool);
  const effective = getEffectiveAiExposure(policyInput);
  const reasons: string[] = [];
  const warnings: string[] = [];
  const blockers: string[] = [];

  // 1. 入口暴露检查
  if (!effective.includes(entry)) {
    blockers.push(`tool ${tool.id} is not exposed to ${entry}`);
  }

  // 2. 入口级 policy 检查（含 outputContract / row_level 等）
  const policyCheck = checkToolPolicy(policyInput, entry);
  blockers.push(...policyCheck.blockers);
  warnings.push(...policyCheck.warnings);

  // 3. deprecated 自动化入口阻断
  if (tool.deprecated && entry !== "manual_confirmed" && entry !== "eval") {
    blockers.push(
      `tool ${tool.id} is deprecated and cannot be recommended for automated ${entry}`
    );
  }

  // 4. 打分
  let score = 0;

  if (tool.deprecated) {
    score -= 30;
    reasons.push("deprecated tool");
  }

  score += scoreRiskLevel(tool.riskLevel);
  reasons.push(`risk level ${tool.riskLevel ?? "unset"}`);

  score += scoreOutputContract(tool.outputContract, entry);
  const shape = tool.outputContract?.tableShape ?? "unknown";
  reasons.push(`output shape ${shape}`);

  const keywordHits = scoreKeywordMatches(intentTokens, tool);
  for (const hit of keywordHits) {
    score += hit.score;
    reasons.push(hit.label);
  }

  const pathHits = scorePathMatches(pathContext, tool);
  for (const hit of pathHits) {
    score += hit.score;
    reasons.push(hit.label);
  }

  const ledgerScore = scoreLedger(ledger[tool.id]);
  if (ledgerScore.reason) {
    score += ledgerScore.score;
    reasons.push(ledgerScore.reason);
  }
  const ledgerStats = ledger[tool.id];
  if (ledgerStats && ledgerStats.lastStatus === "failed") {
    warnings.push(`last ledger run failed`);
  }

  const labScore = scoreToolLab(lab[tool.id]);
  if (labScore.reason) {
    score += labScore.score;
    reasons.push(labScore.reason);
  }
  if (ledgerStats && ledgerStats.totalRuns > 0) {
    score += 2;
    reasons.push(`recent usage ${ledgerStats.totalRuns} runs`);
  }

  return {
    toolId: tool.id,
    score,
    allowed: blockers.length === 0,
    reasons,
    warnings,
    blockers,
  };
}

/**
 * 确定性工具推荐器。
 * - 不调用 LLM，不读取文件内容，不读取 draw_data 原始行。
 * - 只在当前入口 effective aiExposure 集合内排序，不会扩大权限。
 * - 无合规候选时返回空 candidates 与 blocker。
 */
export function recommendTools(
  input: ToolRecommendationInput
): ToolRecommendationResult {
  if (!VALID_ENTRIES.has(input.entry)) {
    return {
      entry: input.entry,
      candidates: [],
      blockers: [`invalid entry: ${input.entry}`],
    };
  }

  const intentTokens = normalizeText(input.intent ?? "");
  const pathContext = input.pathContext;
  const ledger = input.ledgerStats ?? {};
  const lab = input.toolLabStats ?? {};

  const scored = input.tools.map((tool) =>
    recommendSingleTool(
      input.entry,
      intentTokens,
      pathContext,
      ledger,
      lab,
      tool
    )
  );

  const allowed = scored
    .filter((r) => r.allowed)
    .sort((a, b) => b.score - a.score);

  if (allowed.length === 0) {
    const blockers = scored.flatMap((r) => r.blockers);
    const unique = [...new Set(blockers)];
    return {
      entry: input.entry,
      candidates: [],
      blockers: unique.length > 0
        ? unique
        : ["no compliant tools for this entry"],
    };
  }

  return {
    entry: input.entry,
    candidates: allowed,
    blockers: [],
  };
}
