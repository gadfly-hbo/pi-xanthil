import {
  listCommandEvaluations,
  listHookEvaluations,
  listPromptEvaluations,
  listSkillEvaluations,
  listSubAgentEvaluations,
  listToolEvaluations,
} from "./db/engine.ts";
import type {
  CommandEvaluation,
  HookEvaluation,
  LabKind,
  LabTimeline,
  LabTimelinePoint,
  PromptEvaluation,
  SkillEvaluation,
  SubAgentEvaluation,
  ToolEvaluation,
} from "./types.ts";

// ponytail: 六类 summaries 字段不统一，故按 lab 各写一个 adapter 抽出统一时间线点；
// 共用 ratio()/clamp01() helper，不抽巨型 union。

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function ratio(success: number, total: number): number | null {
  return total > 0 ? clamp01(success / total) : null;
}

function sumPair(items: Array<{ total: number; success: number }>): { total: number; success: number } {
  return items.reduce(
    (acc, item) => ({ total: acc.total + item.total, success: acc.success + item.success }),
    { total: 0, success: 0 },
  );
}

// ---- 六类 adapter：一条 evaluation → 一个或多个 LabTimelinePoint ----

function fromSkill(ev: SkillEvaluation): LabTimelinePoint[] {
  // skill/prompt 每个非 baseline variant = 一个资源
  return ev.variantSummaries
    .filter((v) => v.variantId !== "baseline")
    .map((v) => {
      const pairwise = ev.pairwiseSummaries.find((p) => p.variantId === v.variantId);
      const decided = pairwise ? pairwise.win + pairwise.tie + pairwise.loss : 0;
      const winRate = decided > 0 ? clamp01(pairwise!.win / decided) : null;
      const passRate = ratio(v.success, v.total);
      return {
        lab: "skill" as LabKind,
        resourceId: v.variantId,
        evaluationId: ev.evaluationId,
        startedAt: ev.startedAt,
        status: ev.status,
        durationSec: ev.durationSec,
        score: winRate ?? passRate,
        passRate,
        winRate,
        activationRate: clamp01(v.activationRate),
      };
    });
}

function fromPrompt(ev: PromptEvaluation): LabTimelinePoint[] {
  return ev.variantSummaries.map((v) => {
    const pairwise = ev.pairwiseSummaries.find((p) => p.variantId === v.variantId);
    const decided = pairwise ? pairwise.win + pairwise.tie + pairwise.loss : 0;
    const winRate = decided > 0 ? clamp01(pairwise!.win / decided) : null;
    const passRate = ratio(v.success, v.total);
    return {
      lab: "prompt" as LabKind,
      resourceId: v.variantId,
      evaluationId: ev.evaluationId,
      startedAt: ev.startedAt,
      status: ev.status,
      durationSec: ev.durationSec,
      score: winRate ?? passRate,
      passRate,
      winRate,
      activationRate: null,
    };
  });
}

function fromTool(ev: ToolEvaluation): LabTimelinePoint[] {
  // tool/command/subagent/hook 无 pairwise/激活，整集聚合为单点，resourceId=toolId/commandId/"-"
  const { total, success } = sumPair(ev.caseSummaries);
  const passRate = ratio(success, total);
  return [
    {
      lab: "tool",
      resourceId: ev.toolId,
      evaluationId: ev.evaluationId,
      startedAt: ev.startedAt,
      status: ev.status,
      durationSec: ev.durationSec,
      score: passRate,
      passRate,
      winRate: null,
      activationRate: null,
    },
  ];
}

function fromCommand(ev: CommandEvaluation): LabTimelinePoint[] {
  const { total, success } = sumPair(ev.caseSummaries);
  const passRate = ratio(success, total);
  return [
    {
      lab: "command",
      resourceId: ev.commandId,
      evaluationId: ev.evaluationId,
      startedAt: ev.startedAt,
      status: ev.status,
      durationSec: ev.durationSec,
      score: passRate,
      passRate,
      winRate: null,
      activationRate: null,
    },
  ];
}

function fromSubAgent(ev: SubAgentEvaluation): LabTimelinePoint[] {
  const { total, success } = sumPair(ev.caseSummaries);
  const passRate = ratio(success, total);
  return [
    {
      lab: "subagent",
      resourceId: "-",
      evaluationId: ev.evaluationId,
      startedAt: ev.startedAt,
      status: ev.status,
      durationSec: ev.durationSec,
      score: passRate,
      passRate,
      winRate: null,
      activationRate: null,
    },
  ];
}

function fromHook(ev: HookEvaluation): LabTimelinePoint[] {
  const { total, success } = sumPair(ev.caseSummaries);
  const passRate = ratio(success, total);
  return [
    {
      lab: "hook",
      resourceId: "-",
      evaluationId: ev.evaluationId,
      startedAt: ev.startedAt,
      status: ev.status,
      durationSec: ev.durationSec,
      score: passRate,
      passRate,
      winRate: null,
      activationRate: null,
    },
  ];
}

/** 收集某 workspace 全部 lab 的归一化时间线点（未分组、未排序） */
export function collectLabTimelinePoints(workspaceId: string): LabTimelinePoint[] {
  return [
    ...listSkillEvaluations(workspaceId).flatMap(fromSkill),
    ...listPromptEvaluations(workspaceId).flatMap(fromPrompt),
    ...listToolEvaluations(workspaceId).flatMap(fromTool),
    ...listCommandEvaluations(workspaceId).flatMap(fromCommand),
    ...listSubAgentEvaluations(workspaceId).flatMap(fromSubAgent),
    ...listHookEvaluations(workspaceId).flatMap(fromHook),
  ];
}

/** 按 lab + resourceId 分组成时间线（每组 points 按 startedAt 升序） */
export function buildLabTimelines(
  workspaceId: string,
  filter?: { lab?: LabKind; resourceId?: string },
): LabTimeline[] {
  const points = collectLabTimelinePoints(workspaceId).filter((p) => {
    if (filter?.lab && p.lab !== filter.lab) return false;
    if (filter?.resourceId && p.resourceId !== filter.resourceId) return false;
    return true;
  });
  const groups = new Map<string, LabTimelinePoint[]>();
  for (const p of points) {
    const key = `${p.lab}::${p.resourceId}`;
    const arr = groups.get(key) ?? [];
    arr.push(p);
    groups.set(key, arr);
  }
  const timelines: LabTimeline[] = [];
  for (const arr of groups.values()) {
    arr.sort((a, b) => a.startedAt - b.startedAt);
    timelines.push({ lab: arr[0]!.lab, resourceId: arr[0]!.resourceId, points: arr });
  }
  timelines.sort((a, b) => (a.lab === b.lab ? a.resourceId.localeCompare(b.resourceId) : a.lab.localeCompare(b.lab)));
  return timelines;
}
