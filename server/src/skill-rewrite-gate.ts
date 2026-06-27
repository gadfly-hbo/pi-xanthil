import { readFileSync } from "node:fs";
import { resolve, sep } from "node:path";
import { randomUUID } from "node:crypto";
import { getSkillRegistryEntry, getLatestSkillRegistryEvalHistory, type SkillRegistryEvalHistoryEntry } from "./db/engine.ts";
import { runSkillRegistryRetest, skillRegistryMetricsFromEvaluation } from "./skill-regression.ts";
import { runSkillEvaluation } from "./skill-evaluation-runner.ts";
import type { SkillEvalTask, SkillEvaluationRunnerOptions, SkillEvaluationRunSummary } from "./skill-evaluation-runner.ts";
import type { SkillRegistryEntry } from "./types.ts";

// ---- slow-update 受保护字段 ----

export const SLOW_UPDATE_OPEN = "<!-- @slow-update -->";
export const SLOW_UPDATE_CLOSE = "<!-- /@slow-update -->";

export interface SlowUpdateBlock {
  startIndex: number;
  endIndex: number;
  content: string;
}

export function extractSlowUpdateBlocks(content: string): SlowUpdateBlock[] {
  const blocks: SlowUpdateBlock[] = [];
  let searchFrom = 0;
  while (true) {
    const start = content.indexOf(SLOW_UPDATE_OPEN, searchFrom);
    if (start === -1) break;
    const close = content.indexOf(SLOW_UPDATE_CLOSE, start + SLOW_UPDATE_OPEN.length);
    if (close === -1) break;
    const blockContent = content.slice(start + SLOW_UPDATE_OPEN.length, close);
    blocks.push({ startIndex: start, endIndex: close + SLOW_UPDATE_CLOSE.length, content: blockContent });
    searchFrom = close + SLOW_UPDATE_CLOSE.length;
  }
  return blocks;
}

export function checkSlowUpdateIntegrity(original: string, candidate: string): { ok: boolean; reason?: string } {
  const origBlocks = extractSlowUpdateBlocks(original);
  const candBlocks = extractSlowUpdateBlocks(candidate);
  if (origBlocks.length !== candBlocks.length) {
    return { ok: false, reason: `slow-update block count mismatch: ${String(origBlocks.length)} vs ${String(candBlocks.length)}` };
  }
  for (let i = 0; i < origBlocks.length; i++) {
    if (origBlocks[i]!.content !== candBlocks[i]!.content) {
      return { ok: false, reason: `slow-update block #${String(i + 1)} was modified` };
    }
  }
  return { ok: true };
}

// ---- 候选提案类型（E 域内部，不扩双侧 types.ts） ----

export interface SkillRewriteEdit {
  kind: "add" | "delete" | "replace";
  targetSection?: string;
  before?: string;
  after: string;
}

export interface SkillRewriteCandidate {
  id: string;
  registryId: string;
  slug: string;
  baseVersion: number;
  candidateContent: string;
  heldoutScore: number | null;
  currentScore: number | null;
  delta: number | null;
  verdict: "pending" | "accepted" | "rejected";
  rejectReason: string | null;
  evaluationId: string | null;
  createdAt: number;
}

export interface SkillRewriteGateConfig {
  mode: "strict" | "permissive";
  scoreMetric: "evaluation" | "efc";
  heldOutTasks: SkillEvalTask[];
  heldOutModel: string;
  heldOutRepeat: number;
  heldOutJudgeRepeat: number;
}

export interface SkillRewriteGateResult {
  candidate: SkillRewriteCandidate;
  accepted: boolean;
  score: number | null;
  currentScore: number | null;
  delta: number | null;
  reason: string | null;
  evaluationId: string | null;
}

// ---- 严格接受门 ----

export function resolveSkillScore(
  metrics: { score: number | null; activationRate: number | null },
  config: SkillRewriteGateConfig,
): number | null {
  if (config.scoreMetric === "efc") return metrics.score;
  return metrics.score;
}

export function evaluateStrictGate(
  candidateScore: number | null,
  currentScore: number | null,
): { accepted: boolean; reason: string | null } {
  if (candidateScore === null) {
    return { accepted: false, reason: "candidate score is null" };
  }
  if (currentScore === null) {
    return { accepted: true, reason: "no current score baseline" };
  }
  if (candidateScore > currentScore) {
    return { accepted: true, reason: `candidate ${String(candidateScore)} > current ${String(currentScore)}` };
  }
  return { accepted: false, reason: `candidate ${String(candidateScore)} <= current ${String(currentScore)} (strict gate: must be strictly greater)` };
}

// ---- held-out 评测 ----

export interface RunRewriteCandidateEvaluationInput {
  workspaceRoot: string;
  entry: SkillRegistryEntry;
  candidateContent: string;
  config: SkillRewriteGateConfig;
  previous?: SkillRegistryEvalHistoryEntry | null;
}

export async function runRewriteCandidateEvaluation(
  input: RunRewriteCandidateEvaluationInput,
): Promise<SkillRewriteGateResult> {
  const candidateId = randomUUID();
  const candidateSlug = `${input.entry.slug}-candidate-${candidateId.slice(0, 8)}`;
  const skillDir = resolve(input.workspaceRoot, ".pi", "skills", candidateSlug);
  const { mkdirSync, writeFileSync } = await import("node:fs");
  mkdirSync(skillDir, { recursive: true });
  writeFileSync(resolve(skillDir, "SKILL.md"), input.candidateContent, "utf8");

  const currentMetrics = await evaluateCurrentSkill(input.workspaceRoot, input.entry, input.config);
  const candidateMetrics = await evaluateCandidateSkill(
    input.workspaceRoot,
    input.entry.workspaceId,
    candidateSlug,
    candidateId,
    input.config,
  );

  const candidateScore = resolveSkillScore(candidateMetrics, input.config);
  const currentScore = resolveSkillScore(currentMetrics, input.config);
  const delta = candidateScore !== null && currentScore !== null ? candidateScore - currentScore : null;
  const gate = evaluateStrictGate(candidateScore, currentScore);

  const candidate: SkillRewriteCandidate = {
    id: candidateId,
    registryId: input.entry.id,
    slug: input.entry.slug,
    baseVersion: input.entry.version,
    candidateContent: input.candidateContent,
    heldoutScore: candidateScore,
    currentScore,
    delta,
    verdict: gate.accepted ? "accepted" : "rejected",
    rejectReason: gate.accepted ? null : gate.reason,
    evaluationId: candidateMetrics.evaluationId ?? null,
    createdAt: Date.now(),
  };

  return {
    candidate,
    accepted: gate.accepted,
    score: candidateScore,
    currentScore,
    delta,
    reason: gate.reason,
    evaluationId: candidateMetrics.evaluationId ?? null,
  };
}

async function evaluateCurrentSkill(
  workspaceRoot: string,
  entry: SkillRegistryEntry,
  config: SkillRewriteGateConfig,
): Promise<{ score: number | null; activationRate: number | null; evaluationId: string | null }> {
  const previous = getLatestSkillRegistryEvalHistory({
    workspaceId: entry.workspaceId,
    slug: entry.slug,
  });
  if (previous?.score !== null || previous?.activationRate !== null) {
    return { score: previous?.score ?? null, activationRate: previous?.activationRate ?? null, evaluationId: previous?.evaluationId ?? null };
  }
  const result = await runSkillRegistryRetest({
    workspaceRoot,
    entry,
    model: config.heldOutModel,
    tasks: config.heldOutTasks,
    repeat: config.heldOutRepeat,
    judgeRepeat: config.heldOutJudgeRepeat,
    triggerKind: "retest_all_active",
  });
  return {
    score: result.metrics.score,
    activationRate: result.metrics.activationRate,
    evaluationId: result.evaluation.evaluationId,
  };
}

async function evaluateCandidateSkill(
  workspaceRoot: string,
  workspaceId: string,
  candidateSlug: string,
  candidateId: string,
  config: SkillRewriteGateConfig,
): Promise<{ score: number | null; activationRate: number | null; evaluationId: string | null }> {
  const skillPath = resolve(workspaceRoot, ".pi", "skills", candidateSlug, "SKILL.md");
  const variants = [
    { id: "baseline", label: "Baseline", skillPaths: [] },
    { id: candidateId, label: `Candidate`, skillPaths: [skillPath] },
  ];
  const summary = await runSkillEvaluation({
    workspaceRoot,
    workspaceId,
    evaluationId: randomUUID(),
    model: config.heldOutModel,
    variants,
    tasks: config.heldOutTasks,
    repeat: config.heldOutRepeat,
    judgeRepeat: config.heldOutJudgeRepeat,
  });
  const metrics = skillRegistryMetricsFromEvaluation(candidateId, summary);
  return { score: metrics.score, activationRate: metrics.activationRate, evaluationId: summary.evaluationId };
}

// ---- 受保护字段守门（纯函数，不调 LLM） ----

export function guardSlowUpdateWrite(
  originalContent: string,
  candidateContent: string,
): { allowed: boolean; reason?: string } {
  if (!originalContent) return { allowed: true };
  const result = checkSlowUpdateIntegrity(originalContent, candidateContent);
  return { allowed: result.ok, reason: result.reason };
}

export function readSkillContent(workspaceRoot: string, slug: string): string {
  const path = resolve(workspaceRoot, ".pi", "skills", slug, "SKILL.md");
  const root = resolve(workspaceRoot, ".pi", "skills");
  if (!path.startsWith(`${root}${sep}`)) throw new Error("invalid skill slug");
  try {
    return readFileSync(path, "utf8");
  } catch {
    return "";
  }
}
