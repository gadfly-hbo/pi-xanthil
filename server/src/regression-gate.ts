import { buildLabTimelines } from "./lab-timeline.ts";
import type {
  LabKind,
  LabTimelinePoint,
  RegressionGateThresholds,
  RegressionGateVerdict,
} from "./types.ts";

// 对齐 skill-regression 的 candidate→active 回归口径（DEFAULT_SKILL_REGRESSION_THRESHOLDS），
// 推广到四个指标维度，跨六类 lab 通用。
export const DEFAULT_REGRESSION_GATE_THRESHOLDS: RegressionGateThresholds = {
  scoreDrop: 0.1,
  passRateDrop: 0.1,
  winRateDrop: 0.1,
  activationRateDrop: 0.2,
};

function parseThreshold(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 && parsed <= 1 ? parsed : fallback;
}

export function parseRegressionGateThresholds(raw: unknown): RegressionGateThresholds {
  const body = typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>) : {};
  const t = typeof body.thresholds === "object" && body.thresholds !== null
    ? (body.thresholds as Record<string, unknown>)
    : body;
  return {
    scoreDrop: parseThreshold(t.scoreDrop, DEFAULT_REGRESSION_GATE_THRESHOLDS.scoreDrop),
    passRateDrop: parseThreshold(t.passRateDrop, DEFAULT_REGRESSION_GATE_THRESHOLDS.passRateDrop),
    winRateDrop: parseThreshold(t.winRateDrop, DEFAULT_REGRESSION_GATE_THRESHOLDS.winRateDrop),
    activationRateDrop: parseThreshold(t.activationRateDrop, DEFAULT_REGRESSION_GATE_THRESHOLDS.activationRateDrop),
  };
}

function delta(current: number | null, previous: number | null): number | null {
  return current !== null && previous !== null ? current - previous : null;
}

function formatDelta(value: number): string {
  return value.toFixed(3).replace(/0+$/, "").replace(/\.$/, "");
}

/**
 * 给定 current + previous 两个时间线点，按阈值判定 pass/regression。
 * 任一指标跌幅 >= 阈值 → regression（含原因）；可比指标全未触发 → pass。
 */
export function compareRegressionGate(
  lab: LabKind,
  resourceId: string,
  current: LabTimelinePoint | null,
  previous: LabTimelinePoint | null,
  thresholds: RegressionGateThresholds = DEFAULT_REGRESSION_GATE_THRESHOLDS,
): RegressionGateVerdict {
  const deltas = {
    score: delta(current?.score ?? null, previous?.score ?? null),
    passRate: delta(current?.passRate ?? null, previous?.passRate ?? null),
    winRate: delta(current?.winRate ?? null, previous?.winRate ?? null),
    activationRate: delta(current?.activationRate ?? null, previous?.activationRate ?? null),
  };

  if (!current || !previous) {
    return {
      lab,
      resourceId,
      decision: "insufficient_data",
      reason: !current ? "no current evaluation" : "no previous evaluation to compare",
      thresholds,
      current: current ?? null,
      previous: previous ?? null,
      deltas,
    };
  }

  const reasons: string[] = [];
  const check = (label: string, d: number | null, drop: number) => {
    if (d !== null && d <= -drop) reasons.push(`${label} dropped ${formatDelta(d)} (threshold -${drop})`);
  };
  check("score", deltas.score, thresholds.scoreDrop);
  check("passRate", deltas.passRate, thresholds.passRateDrop);
  check("winRate", deltas.winRate, thresholds.winRateDrop);
  check("activationRate", deltas.activationRate, thresholds.activationRateDrop);

  return {
    lab,
    resourceId,
    decision: reasons.length > 0 ? "regression" : "pass",
    reason: reasons.length > 0 ? reasons.join("; ") : null,
    thresholds,
    current,
    previous,
    deltas,
  };
}

/**
 * 从库里取某资源最近两次 evaluation，判门禁。
 * 端点入口：给定 workspace + lab + resourceId + 阈值 → pass/regression。
 */
export function evaluateRegressionGate(input: {
  workspaceId: string;
  lab: LabKind;
  resourceId: string;
  thresholds?: RegressionGateThresholds;
}): RegressionGateVerdict {
  const thresholds = input.thresholds ?? DEFAULT_REGRESSION_GATE_THRESHOLDS;
  const timelines = buildLabTimelines(input.workspaceId, { lab: input.lab, resourceId: input.resourceId });
  const points = timelines[0]?.points ?? [];
  const current = points.length > 0 ? points[points.length - 1]! : null;
  const previous = points.length > 1 ? points[points.length - 2]! : null;
  return compareRegressionGate(input.lab, input.resourceId, current, previous, thresholds);
}
