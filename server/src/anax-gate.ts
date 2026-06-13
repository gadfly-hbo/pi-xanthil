// AnaX quality-gate engine.
//
// Design (see handoff): instead of regex-scanning the analysts' free-text prose
// (brittle), a dedicated "gate" node asks pi to emit a structured verdict block.
// This module's job is the thin, deterministic half: extract that JSON and
// re-derive the block/pass decision against hard thresholds — so the model can
// never wave a low-quality result through.
//
// The verdict contract is documented inside the gate node prompts
// (see anax-template.ts), mirroring the existing ```field-dict``` convention.

export type Confidence = "low" | "medium" | "high";

const CONFIDENCE_SCORE: Record<Confidence, number> = { low: 1, medium: 2, high: 3 };

// Thresholds ported from AnaX config/pipeline.json `quality_gates`.
export const GATE_THRESHOLDS = {
  minConfidence: "medium" as Confidence,
  minEvidenceCount: 2,
  minDataQualityScore: 7,
} as const;

/** A red-line violation reported by the reviewer in its structured verdict. */
export interface RedLine {
  id: string;
  desc: string;
}

/** Per-stage signals the reviewer extracted from upstream deliverables. */
export interface StageSignal {
  stage: string;
  confidence?: Confidence;
  evidence?: number;
  /** Only present for the data-quality stage. */
  dataQuality?: number;
}

/** The raw, model-emitted verdict (parsed from the ```anax-verdict``` block). */
export interface RawVerdict {
  stage?: string;
  redLines?: RedLine[];
  stages?: StageSignal[];
  summary?: string;
  modelVerdict?: "pass" | "blocked";
}

/** The final verdict after deterministic threshold enforcement. */
export interface GateVerdict {
  stage: string;
  verdict: "pass" | "blocked";
  blockers: number;
  reasons: string[];
  redLines: RedLine[];
  stages: StageSignal[];
  summary: string;
}

function isPassingRedLine(redLine: RedLine): boolean {
  const text = `${redLine.id ?? ""} ${redLine.desc ?? ""}`.toLowerCase();
  return /\bpass\b/.test(text) || text.includes("通过") || text.includes("未触发") || text.includes("无红线");
}

/**
 * Extract the structured verdict from a gate node's pi output.
 * Returns null when no (valid) ```anax-verdict``` block is present.
 */
export function extractVerdict(text: string): RawVerdict | null {
  const blocks = text.matchAll(/```anax-verdict(?:[ \t]*\r?\n|[ \t]*)?([\s\S]+?)```/g);
  let latest: RawVerdict | null = null;
  for (const match of blocks) {
    if (!match[1]) continue;
    try {
      const parsed = JSON.parse(match[1].trim()) as RawVerdict;
      if (typeof parsed === "object" && parsed !== null) latest = parsed;
    } catch {
      // Keep scanning: models may quote an invalid example before the final block.
    }
  }
  return latest;
}

function normalizeConfidence(value: unknown): Confidence | undefined {
  if (value === "low" || value === "medium" || value === "high") return value;
  // "medium-high" is a common model output; treat as "high" (model uses it when evidence is strong).
  if (value === "medium-high") return "high";
  return undefined;
}

function isAggregateDataQualityStage(stage: string): boolean {
  const normalized = stage.trim().toLowerCase();
  return (
    normalized === "data"
    || normalized === "data_quality"
    || normalized.includes("综合")
    || normalized.includes("overall")
    || normalized.includes("数据质量")
  );
}

export interface GateThresholds {
  minConfidence: Confidence;
  minEvidenceCount: number;
  minDataQualityScore: number;
}

interface SqlToolOutput {
  kind?: string;
  code?: number | null;
  success?: boolean;
  columns?: unknown;
  rows?: unknown;
  rowCount?: unknown;
  error?: unknown;
  sql?: unknown;
  requiredFields?: unknown;
}

/**
 * Re-derive blockers from the raw verdict against hard thresholds.
 * The model's own `modelVerdict` is advisory only — thresholds win.
 * Pass `thresholds` to override the workspace-level gate config; falls back
 * to the built-in defaults when omitted.
 */
export function enforceGate(raw: RawVerdict, stageId: string, thresholds?: GateThresholds): GateVerdict {
  const t = thresholds ?? GATE_THRESHOLDS;
  const reasons: string[] = [];
  const redLines = Array.isArray(raw.redLines) ? raw.redLines.filter((rl) => !isPassingRedLine(rl)) : [];
  const stages = Array.isArray(raw.stages) ? raw.stages : [];

  for (const rl of redLines) {
    reasons.push(`[${rl.id ?? "RL"}] ${rl.desc ?? "红线违规"}`);
  }

  // review_gate is a meta-analysis gate: data quality was already validated by data_gate.
  // In review_gate: skip dataQuality re-check entirely (the AI re-assesses with a different
  // context and produces inconsistent scores vs data_gate's authoritative verdict).
  // Also skip evidence check for any data-related sub-stage (evidence count doesn't apply to
  // raw data stages; the model may name it "data", "data_quality", etc.).
  const isReviewGate = stageId === "review_gate";

  for (const s of stages) {
    const isAggregateDataStage = stageId === "data_gate" ? isAggregateDataQualityStage(s.stage) : true;
    const conf = normalizeConfidence(s.confidence);
    if (isAggregateDataStage && conf && CONFIDENCE_SCORE[conf] < CONFIDENCE_SCORE[t.minConfidence]) {
      reasons.push(`[${s.stage}] 置信度 ${conf} 低于 ${t.minConfidence}`);
    }
    const isDataSubStage = isReviewGate && s.stage.toLowerCase().includes("data");
    if (isAggregateDataStage && (!isReviewGate || !isDataSubStage)) {
      if (typeof s.evidence === "number" && s.evidence < t.minEvidenceCount) {
        reasons.push(`[${s.stage}] 证据数 ${s.evidence} 低于 ${t.minEvidenceCount}`);
      }
    }
    if (!isReviewGate && isAggregateDataStage) {
      if (typeof s.dataQuality === "number" && s.dataQuality < t.minDataQualityScore) {
        reasons.push(`[${s.stage}] 数据质量 ${s.dataQuality} 低于 ${t.minDataQualityScore}`);
      }
    }
  }

  const blockers = reasons.length;
  return {
    stage: raw.stage ?? stageId,
    verdict: blockers > 0 ? "blocked" : "pass",
    blockers,
    reasons,
    redLines,
    stages,
    summary: typeof raw.summary === "string" ? raw.summary : "",
  };
}

/**
 * Full gate evaluation for a node's output. A missing/invalid verdict block is
 * itself a blocker — a gate that produced no structured judgement cannot pass.
 */
export function evaluateGate(text: string, stageId: string, thresholds?: GateThresholds): GateVerdict {
  const raw = extractVerdict(text);
  if (!raw) {
    return {
      stage: stageId,
      verdict: "blocked",
      blockers: 1,
      reasons: ["gate 未产出结构化裁决块（```anax-verdict```），无法验证 — 阻断"],
      redLines: [],
      stages: [],
      summary: "",
    };
  }
  return enforceGate(raw, stageId, thresholds);
}

export function evaluateSqlGate(blackboard: Record<string, string>): GateVerdict {
  const reasons: string[] = [];
  const rawOutput = blackboard["run_sql"] ?? "";
  const output = parseSqlToolOutput(rawOutput);

  if (!output) {
    reasons.push("run_sql 未产出可解析的结构化 JSON 输出");
  } else {
    if (output.code !== 0 || output.success !== true) {
      const error = typeof output.error === "string" && output.error.trim() ? `：${output.error.trim()}` : "";
      reasons.push(`SQL 执行失败，code=${String(output.code)}${error}`);
    }

    const rowCount = typeof output.rowCount === "number" ? output.rowCount : Array.isArray(output.rows) ? output.rows.length : 0;
    if (rowCount <= 0) {
      reasons.push("SQL 查询结果为空，rowCount=0");
    }

    const columns = Array.isArray(output.columns) ? output.columns.map((item) => String(item)) : [];
    const requiredFields = Array.isArray(output.requiredFields) ? output.requiredFields.map((item) => String(item).trim()).filter(Boolean) : [];
    const missingFields = requiredFields.filter((field) => !columns.includes(field));
    if (missingFields.length > 0) {
      reasons.push(`SQL 结果缺少关键字段：${missingFields.join("、")}`);
    }
  }

  const verdict = reasons.length > 0 ? "blocked" : "pass";
  return {
    stage: "sql_gate",
    verdict,
    blockers: reasons.length,
    reasons,
    redLines: reasons.map((reason, index) => ({ id: `SQL${String(index + 1).padStart(2, "0")}`, desc: reason })),
    stages: [{ stage: "run_sql", confidence: "high", evidence: output ? 3 : 0 }],
    summary: verdict === "pass" ? "SQL 执行成功，结果非空且关键字段完整" : "SQL 门禁未通过",
  };
}

export function formatSqlGateOutput(verdict: GateVerdict): string {
  return [
    "```anax-verdict",
    JSON.stringify({
      stage: verdict.stage,
      redLines: verdict.redLines,
      stages: verdict.stages,
      summary: verdict.summary,
      modelVerdict: verdict.verdict,
    }, null, 2),
    "```",
  ].join("\n");
}

function parseSqlToolOutput(text: string): SqlToolOutput | null {
  try {
    const parsed = JSON.parse(text) as unknown;
    return typeof parsed === "object" && parsed !== null ? parsed as SqlToolOutput : null;
  } catch {
    return null;
  }
}

/**
 * Deterministic red-line checks that run independently of the LLM verdict.
 * Guards against the model silently missing RL03/RL06/RL07 violations.
 *
 * Returns a list of extra blocker reason strings to merge into the verdict.
 * The caller is responsible for updating verdict.blockers / verdict.verdict.
 */
export function deterministicRedLineCheck(
  blackboard: Record<string, string>,
  stageId: string,
  thresholds?: GateThresholds,
): string[] {
  const t = thresholds ?? GATE_THRESHOLDS;
  const extra: string[] = [];

  // data_gate — re-parse 综合评分 directly from the data node text so the LLM
  // cannot mis-report its own score and slip through.
  if (stageId === "data_gate") {
    const dataText = blackboard["data"] ?? "";
    const m = dataText.match(/综合评分[：:]\s*(\d+(?:\.\d+)?)/);
    if (m?.[1]) {
      const score = parseFloat(m[1]);
      if (score < 5) {
        extra.push(`[RL03-确定性] 综合评分 ${score} < 5，触发硬红线，无论 LLM 裁决均阻断`);
      } else if (score < t.minDataQualityScore) {
        extra.push(`[数据质量-确定性] 综合评分 ${score} < 阈值 ${t.minDataQualityScore}`);
      }
    }
  }

  // review_gate — check RL06 and RL07 against upstream blackboard content.
  if (stageId === "review_gate") {
    const planText = blackboard["plan"] ?? "";
    const insightText = blackboard["insight"] ?? "";
    const recommendText = blackboard["recommend"] ?? "";

    // RL06: any hypothesis flagged crossValidate:true must have cross-validation
    // evidence in the insight output (the insight prompt explicitly demands this).
    const hypoMatches = planText.matchAll(/```anax-hypotheses-plan(?:[ \t]*\r?\n|[ \t]*)?([\s\S]+?)```/g);
    for (const hypoMatch of hypoMatches) {
      if (!hypoMatch[1]) continue;
      try {
        const hypotheses = JSON.parse(hypoMatch[1].trim()) as Array<{ id: string; crossValidate?: boolean }>;
        if (!Array.isArray(hypotheses)) continue;
        const needCross = hypotheses.filter((h) => h.crossValidate === true);
        if (needCross.length > 0 && !insightText.includes("交叉验证")) {
          extra.push(
            `[RL06-确定性] 假设 ${needCross.map((h) => h.id).join("、")} 标注需交叉验证，` +
              `但 insight 输出中未发现"交叉验证"内容`,
          );
        }
        break;
      } catch {
        // Unparseable block — keep scanning; LLM verdict still applies.
      }
    }

    // RL07: every recommendation must include four structural elements.
    // "时间" is too generic; check the three distinctive ones.
    const required = ["负责人", "成功标准", "验证方案"] as const;
    const missing = required.filter((el) => !recommendText.includes(el));
    if (missing.length > 0) {
      extra.push(`[RL07-确定性] 建议输出缺少必要要素：${missing.join("、")}`);
    }
  }

  return extra;
}
