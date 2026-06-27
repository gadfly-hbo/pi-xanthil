import type { AgentTrajectory, AgentTrajectoryStep, ChangeManifest, EvalRecord, HarnessComponent, HealthFinding, MonitorRun } from "./types.ts";

const TEXT_LIMIT = 2400;
const SENSITIVE_KEYS = new Set([
  "row",
  "rows",
  "cell",
  "cells",
  "record",
  "records",
  "sample",
  "samples",
  "raw",
  "rawData",
  "inputPath",
  "absolutePath",
  "draw_data",
]);

export function shouldCreateEvalFromFinding(finding: HealthFinding): boolean {
  return finding.lifecycle === "recurring" || finding.lifecycle === "worsening";
}

export function buildMonitorFindingTrajectory(run: MonitorRun, finding: HealthFinding): AgentTrajectory {
  return {
    runId: run.id,
    module: "monitor",
    outcome: "fail",
    steps: [
      {
        stage: "monitor-finding",
        input: sanitizeTrajectoryText({
          suite: run.suite,
          metricSystemId: run.metricSystemId,
          ruleId: finding.ruleId,
          category: finding.category,
          kind: finding.kind,
          severity: finding.severity,
          lifecycle: finding.lifecycle,
          signature: finding.signature,
          firstSeenRunId: finding.firstSeenRunId,
          boundTo: finding.boundTo,
        }),
        output: sanitizeTrajectoryText({
          title: finding.title,
          suggestion: finding.suggestion,
          evidence: finding.evidence,
          comparisons: finding.comparisons,
          diagnosis: finding.diagnosis,
        }),
        citation: finding.id,
      },
    ],
  };
}

export function buildFlowFailureTrajectory(input: {
  runId: string;
  module: "anax" | "flow";
  flowId: string;
  flowName: string;
  code: number | null;
  aborted: boolean;
  error?: string;
  blackboard?: Record<string, string>;
}): AgentTrajectory {
  const blackboardKeys = Object.keys(input.blackboard ?? {});
  const outputPreview = Object.fromEntries(
    Object.entries(input.blackboard ?? {})
      .slice(0, 8)
      .map(([key, value]) => [key, sanitizeTrajectoryText(value)]),
  );
  const step: AgentTrajectoryStep = {
    stage: "flow-run-end",
    input: sanitizeTrajectoryText({
      flowId: input.flowId,
      flowName: input.flowName,
      code: input.code,
      aborted: input.aborted,
      blackboardKeys,
    }),
    output: sanitizeTrajectoryText({
      error: input.error,
      outputPreview,
    }),
    citation: input.runId,
  };
  return { runId: input.runId, module: input.module, steps: [step], outcome: "fail" };
}

export function buildEvalRecordFromFinding(finding: HealthFinding, failingTrace: AgentTrajectory): Omit<EvalRecord, "id" | "createdAt"> {
  return {
    sourceFindingId: finding.id,
    failingTrace,
    expectedOutput: [
      `Detect and explain recurring production finding: ${finding.title}`,
      `rule=${finding.ruleId}`,
      `signature=${finding.signature}`,
      `severity=${finding.severity}`,
      `lifecycle=${finding.lifecycle}`,
    ].join("\n"),
    passCondition: [
      "The evaluator must reproduce the same finding signature from sanitized evidence,",
      "explain why it is recurring or worsening, and propose a bounded corrective change without using raw row-level data.",
    ].join(" "),
    annotationStatus: "candidate",
  };
}

export function buildChangeManifestFromEvalRecord(input: {
  record: EvalRecord;
  component?: HarnessComponent;
  createdAt?: number;
}): Omit<ChangeManifest, "editId" | "createdAt"> & { createdAt?: number } {
  const component = input.component ?? "prompt";
  const trace = input.record.failingTrace;
  return {
    component,
    failureEvidence: sanitizeTrajectoryText({
      evalRecordId: input.record.id,
      sourceFindingId: input.record.sourceFindingId,
      module: trace.module,
      runId: trace.runId,
      steps: trace.steps,
      expectedOutput: input.record.expectedOutput,
      passCondition: input.record.passCondition,
    }),
    rootCause: "A recurring or worsening production finding does not yet have targeted eval coverage and bounded agent constraints.",
    targetedFix: "Create the smallest bounded prompt, skill, tool, or memory change that makes the targeted eval pass while preserving existing solved tasks.",
    predictedFix: [input.record.id],
    predictedRegression: [],
    outcome: "defer",
    outcomeReason: "Human gate required before applying product-agent bounded changes.",
    createdAt: input.createdAt,
  };
}

export function sanitizeTrajectoryText(value: unknown): string {
  const normalized = typeof value === "string" ? value : JSON.stringify(redactSensitive(value));
  return normalized
    .replace(/draw_data[^\s"',}]*/gi, "[redacted-draw-data]")
    .replace(/\b\d{3}_raw\b[^\s"',}]*/gi, "[redacted-raw-path]") // 010_raw 等原始数据目录裸路径
    .slice(0, TEXT_LIMIT);
}

// 大小写不敏感 + 子串匹配：复合键名（sampleRows / rawValue / topRecords / rowSamples）
// 同样命中行级标记词，避免精确匹配漏网（红线：宁可过度脱敏，绝不漏原始明细）。
function isSensitiveKey(key: string): boolean {
  const lower = key.toLowerCase();
  for (const token of SENSITIVE_KEYS) {
    if (lower.includes(token)) return true;
  }
  return false;
}

function redactSensitive(value: unknown): unknown {
  if (Array.isArray(value)) return value.slice(0, 20).map(redactSensitive);
  if (typeof value !== "object" || value === null) return value;
  const out: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value)) {
    if (isSensitiveKey(key)) {
      out[key] = "[redacted]";
      continue;
    }
    out[key] = redactSensitive(child);
  }
  return out;
}
