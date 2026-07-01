import type { HealthFinding } from "./types.ts";

export type MonitorPriorityBand = "urgent" | "high" | "medium" | "low";

export interface MonitorFindingPriority {
  findingId: string;
  priorityScore: number;
  priorityBand: MonitorPriorityBand;
  reasons: string[];
}

export interface MonitorFindingActionState {
  status: "suggested" | "adopted" | "dismissed" | "doing" | "done";
  actionId?: string;
}

export type MonitorFindingActionStates = Record<string, MonitorFindingActionState | undefined>;

export interface MonitorRunSummaryItem {
  findingId: string;
  title: string;
  kind: HealthFinding["kind"];
  severity: HealthFinding["severity"];
  lifecycle: HealthFinding["lifecycle"];
  priorityScore: number;
  priorityBand: MonitorPriorityBand;
  reasons: string[];
}

export interface MonitorRunSummary {
  topProblems: MonitorRunSummaryItem[];
  topRisks: MonitorRunSummaryItem[];
  counts: {
    new: number;
    worsening: number;
    resolved: number;
    targetGap: number;
  };
  suggestedFocus: string;
}

const SEVERITY_SCORE: Record<HealthFinding["severity"], number> = {
  critical: 50,
  warn: 30,
  info: 10,
};

const LIFECYCLE_SCORE: Record<HealthFinding["lifecycle"], number> = {
  worsening: 25,
  recurring: 15,
  new: 8,
  resolved: -35,
};

function clampScore(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function bandForScore(score: number): MonitorPriorityBand {
  if (score >= 80) return "urgent";
  if (score >= 60) return "high";
  if (score >= 35) return "medium";
  return "low";
}

function numberFromEvidence(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function maxAbsDeltaRate(finding: HealthFinding): number {
  const rates: number[] = [];
  const direct = numberFromEvidence(finding.evidence.deltaRate);
  if (direct != null) rates.push(Math.abs(direct));
  for (const comparison of finding.comparisons ?? []) {
    if (comparison.deltaRate != null && Number.isFinite(comparison.deltaRate)) {
      rates.push(Math.abs(comparison.deltaRate));
    }
  }
  return rates.length > 0 ? Math.max(...rates) : 0;
}

function isTargetGap(finding: HealthFinding): boolean {
  return finding.ruleId === "R-GAP-TARGET" || (finding.comparisons ?? []).some((comparison) => comparison.kind === "target");
}

export function scoreMonitorFindingPriority(
  finding: HealthFinding,
  actionStates: MonitorFindingActionStates = {},
): MonitorFindingPriority {
  const reasons: string[] = [];
  let score = SEVERITY_SCORE[finding.severity];
  reasons.push(`severity=${finding.severity}`);

  score += LIFECYCLE_SCORE[finding.lifecycle];
  reasons.push(`lifecycle=${finding.lifecycle}`);

  const deltaRate = maxAbsDeltaRate(finding);
  if (deltaRate > 0) {
    const deltaScore = Math.min(20, deltaRate * 80);
    score += deltaScore;
    reasons.push(`deltaRate=${(deltaRate * 100).toFixed(1)}%`);
  }

  if (isTargetGap(finding)) {
    score += 15;
    reasons.push("target gap");
  }

  if (finding.firstSeenRunId) {
    score += 8;
    reasons.push("reproduced across runs");
  }

  const action = actionStates[finding.id] ?? actionStates[finding.signature];
  if (action?.status === "adopted" || action?.status === "doing") {
    score -= 25;
    reasons.push(`action ${action.status}`);
  }

  if (finding.lifecycle === "resolved") {
    score = Math.min(score, 25);
    reasons.push("resolved cap");
  }

  const priorityScore = clampScore(score);
  return {
    findingId: finding.id,
    priorityScore,
    priorityBand: bandForScore(priorityScore),
    reasons,
  };
}

export function prioritizeMonitorFindings(
  findings: HealthFinding[],
  actionStates: MonitorFindingActionStates = {},
): Array<{ finding: HealthFinding; priority: MonitorFindingPriority }> {
  return findings
    .map((finding) => ({ finding, priority: scoreMonitorFindingPriority(finding, actionStates) }))
    .sort((a, b) => {
      if (b.priority.priorityScore !== a.priority.priorityScore) return b.priority.priorityScore - a.priority.priorityScore;
      if (b.finding.detectedAt !== a.finding.detectedAt) return b.finding.detectedAt - a.finding.detectedAt;
      return a.finding.id.localeCompare(b.finding.id);
    });
}

function toSummaryItem(item: { finding: HealthFinding; priority: MonitorFindingPriority }): MonitorRunSummaryItem {
  return {
    findingId: item.finding.id,
    title: item.finding.title,
    kind: item.finding.kind,
    severity: item.finding.severity,
    lifecycle: item.finding.lifecycle,
    priorityScore: item.priority.priorityScore,
    priorityBand: item.priority.priorityBand,
    reasons: item.priority.reasons,
  };
}

export function summarizeMonitorRun(
  findings: HealthFinding[],
  actionStates: MonitorFindingActionStates = {},
): MonitorRunSummary {
  const prioritized = prioritizeMonitorFindings(findings, actionStates);
  const topProblems = prioritized.filter((item) => item.finding.kind === "问题").slice(0, 3).map(toSummaryItem);
  const topRisks = prioritized.filter((item) => item.finding.kind === "风险").slice(0, 3).map(toSummaryItem);
  const counts = {
    new: findings.filter((finding) => finding.lifecycle === "new").length,
    worsening: findings.filter((finding) => finding.lifecycle === "worsening").length,
    resolved: findings.filter((finding) => finding.lifecycle === "resolved").length,
    targetGap: findings.filter(isTargetGap).length,
  };
  const first = prioritized[0];
  const focusParts = [
    counts.worsening > 0 ? `${counts.worsening} 个恶化 finding` : "",
    counts.targetGap > 0 ? `${counts.targetGap} 个目标差距` : "",
    counts.resolved > 0 ? `${counts.resolved} 个已恢复` : "",
  ].filter(Boolean);
  const suggestedFocus = first
    ? `优先处理「${first.finding.title}」（${first.priority.priorityBand}/${first.priority.priorityScore}）。${focusParts.length > 0 ? `本轮重点：${focusParts.join("，")}。` : "本轮无额外聚焦项。"}`
    : "本轮没有 findings，保持现有监测节奏。";
  return { topProblems, topRisks, counts, suggestedFocus };
}
