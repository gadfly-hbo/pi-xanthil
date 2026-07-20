import { useCallback, useEffect, useState } from "react";
import {
  ArrowLeft,
  CheckCircle2,
  Circle,
  Clock,
  Loader2,
  Plus,
  RefreshCw,
  XCircle,
} from "lucide-react";
import { cn } from "@/lib/cn";
import { api } from "@/lib/api";
import type {
  ClosureCycleRef,
  ClosureDetailData,
  ClosureDetailReadModel,
  ClosureListReadModel,
  ClosureCommandResult,
  ClosureStage,
  S31FactRef,
  S32FactRef,
  S33FactRef,
  S34FactRef,
  S35FactRef,
  S36FactRef,
} from "@/types/analysis-projects";
import {
  CLOSURE_CYCLE_STATUS_LABELS,
  CLOSURE_STAGE_LABELS,
  TRANSLATION_STATUS_LABELS,
  DOWNSTREAM_SYSTEM_LABELS,
  DEPLOYMENT_STATUS_LABELS,
  FEEDBACK_SOURCE_LABELS,
  SIGNIFICANCE_STATUS_LABELS,
  REVIEW_STATUS_LABELS,
  HYPOTHESIS_RESULT_LABELS,
  EFFECTIVENESS_RATING_LABELS,
  ITERATION_BRANCH_LABELS,
  formatRelativeTime,
} from "./shared";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface Props {
  workspaceId: string;
  projectId: string;
  lockedReportId: string | null;
  onBack: () => void;
}

// ---------------------------------------------------------------------------
// Closure stages in order
// ---------------------------------------------------------------------------

const CLOSURE_STAGES: readonly ClosureStage[] = [
  "S3.1", "S3.2", "S3.3", "S3.4", "S3.5", "S3.6",
];

// ---------------------------------------------------------------------------
// Small reusable primitives
// ---------------------------------------------------------------------------

function MiniField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline gap-2 py-0.5">
      <span className="shrink-0 text-[11px] text-neutral-400 w-20">{label}</span>
      <span className="min-w-0 flex-1 text-[12px] text-neutral-700 dark:text-neutral-300 break-all">{children}</span>
    </div>
  );
}

function StatusBadge({ label, color }: { label: string; color: string }) {
  return (
    <span className={cn("inline-flex rounded px-1.5 py-0.5 text-[10px] font-medium", color)}>
      {label}
    </span>
  );
}

function StageIndicator({ currentStage }: { currentStage: ClosureStage | null }) {
  const currentIdx = currentStage ? CLOSURE_STAGES.indexOf(currentStage) : -1;
  return (
    <div className="flex items-center gap-1">
      {CLOSURE_STAGES.map((s, i) => {
        const done = i < currentIdx;
        const active = i === currentIdx;
        return (
          <div key={s} className="flex items-center gap-1">
            {done ? (
              <CheckCircle2 className="h-3.5 w-3.5 text-green-500" />
            ) : active ? (
              <Clock className="h-3.5 w-3.5 text-blue-500" />
            ) : (
              <Circle className="h-3.5 w-3.5 text-neutral-300 dark:text-neutral-600" />
            )}
            <span
              className={cn(
                "text-[10px]",
                done
                  ? "text-green-600 dark:text-green-400"
                  : active
                    ? "text-blue-600 font-medium dark:text-blue-400"
                    : "text-neutral-400",
              )}
            >
              {s}
            </span>
            {i < CLOSURE_STAGES.length - 1 && (
              <div className={cn("w-3 h-px", done ? "bg-green-400" : "bg-neutral-200 dark:bg-neutral-700")} />
            )}
          </div>
        );
      })}
    </div>
  );
}

function StageCard({
  title,
  stage,
  done,
  children,
}: {
  title: string;
  stage: ClosureStage;
  done: boolean;
  children: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        "rounded-md border p-2.5",
        done
          ? "border-green-200 bg-green-50/50 dark:border-green-900 dark:bg-green-950/20"
          : "border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900",
      )}
    >
      <div className="mb-1.5 flex items-center gap-1.5">
        {done ? (
          <CheckCircle2 className="h-3.5 w-3.5 text-green-500" />
        ) : (
          <Circle className="h-3.5 w-3.5 text-neutral-400" />
        )}
        <span className="text-[12px] font-medium text-neutral-700 dark:text-neutral-300">
          {stage} {title}
        </span>
      </div>
      {children}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Command result banner
// ---------------------------------------------------------------------------

function CommandResultBanner({ result }: { result: ClosureCommandResult | null }) {
  if (!result) return null;
  if (result.kind === "executed" || result.kind === "replayed_success") {
    return (
      <div className="rounded-md border border-green-200 bg-green-50 px-3 py-2 text-[11px] text-green-700 dark:border-green-900 dark:bg-green-950/30 dark:text-green-400">
        操作成功
      </div>
    );
  }
  if (result.kind === "conflict") {
    return (
      <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-700 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-400">
        冲突: 请求已处理
      </div>
    );
  }
  if (result.kind === "failed") {
    return (
      <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-[11px] text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-400">
        {result.errorSummary ?? "操作失败"}
      </div>
    );
  }
  return null;
}

// ---------------------------------------------------------------------------
// JSON textarea helper
// ---------------------------------------------------------------------------

function JsonField({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <div className="space-y-0.5">
      <label className="text-[10px] text-neutral-500">{label}</label>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder ?? "{}"}
        rows={2}
        className="w-full rounded border border-neutral-200 bg-neutral-50 px-2 py-1 text-[11px] font-mono text-neutral-700 focus:border-blue-400 focus:outline-none dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-300"
      />
    </div>
  );
}

function SelectField({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: readonly { value: string; label: string }[];
}) {
  return (
    <div className="space-y-0.5">
      <label className="text-[10px] text-neutral-500">{label}</label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded border border-neutral-200 bg-neutral-50 px-2 py-1 text-[11px] text-neutral-700 focus:border-blue-400 focus:outline-none dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-300"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
}

function TextField({
  label,
  value,
  onChange,
  placeholder,
  required,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  required?: boolean;
}) {
  return (
    <div className="space-y-0.5">
      <label className="text-[10px] text-neutral-500">
        {label}
        {required && <span className="text-red-400 ml-0.5">*</span>}
      </label>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full rounded border border-neutral-200 bg-neutral-50 px-2 py-1 text-[11px] text-neutral-700 focus:border-blue-400 focus:outline-none dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-300"
      />
    </div>
  );
}

function NumberField({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <div className="space-y-0.5">
      <label className="text-[10px] text-neutral-500">{label}</label>
      <input
        type="number"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        min={1}
        className="w-full rounded border border-neutral-200 bg-neutral-50 px-2 py-1 text-[11px] text-neutral-700 focus:border-blue-400 focus:outline-none dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-300"
      />
    </div>
  );
}

function SubmitButton({
  loading,
  children,
  onClick,
  disabled,
}: {
  loading: boolean;
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled || loading}
      className={cn(
        "inline-flex items-center gap-1 rounded-md px-3 py-1.5 text-[11px] font-medium transition-colors",
        disabled || loading
          ? "bg-neutral-100 text-neutral-400 cursor-not-allowed dark:bg-neutral-800 dark:text-neutral-600"
          : "bg-blue-600 text-white hover:bg-blue-700",
      )}
    >
      {loading && <Loader2 className="h-3 w-3 animate-spin" />}
      {children}
    </button>
  );
}

// ---------------------------------------------------------------------------
// SHA-256 validation
// ---------------------------------------------------------------------------

function isValidSha256(v: string): boolean {
  return /^[0-9a-f]{64}$/.test(v);
}

function isValidJson(v: string): boolean {
  if (!v.trim()) return false;
  try {
    JSON.parse(v);
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// S3.1 Translation form
// ---------------------------------------------------------------------------

function S31Form({
  workspaceId,
  cycleId,
  onDone,
}: {
  workspaceId: string;
  cycleId: string;
  onDone: (r: ClosureCommandResult) => void;
}) {
  const [loading, setLoading] = useState(false);
  const [artifactRef, setArtifactRef] = useState("");
  const [sha256, setSha256] = useState("");
  const [recommendations, setRecommendations] = useState("[]");
  const [rules, setRules] = useState("{}");
  const [thresholds, setThresholds] = useState("{}");
  const [segments, setSegments] = useState("{}");
  const [grayTargets, setGrayTargets] = useState("{}");
  const [metrics, setMetrics] = useState("[]");
  const [status, setStatus] = useState<"draft" | "confirmed">("draft");

  const valid =
    artifactRef.trim() &&
    isValidSha256(sha256) &&
    isValidJson(recommendations) &&
    isValidJson(rules) &&
    isValidJson(thresholds) &&
    isValidJson(segments) &&
    isValidJson(grayTargets) &&
    isValidJson(metrics);

  const handleSubmit = useCallback(async () => {
    if (!valid) return;
    setLoading(true);
    try {
      const result = await api.recordS31Translation(workspaceId, cycleId, {
        businessActionArtifactRef: artifactRef,
        businessActionContentSha256: sha256,
        selectedRecommendationsJson: recommendations,
        businessRulesJson: rules,
        thresholdsJson: thresholds,
        segmentsJson: segments,
        grayReleaseTargetsJson: grayTargets,
        feedbackMetricDefinitionsJson: metrics,
        translationStatus: status,
      });
      onDone(result);
    } catch (err) {
      onDone({ kind: "failed", errorSummary: err instanceof Error ? err.message : String(err) });
    } finally {
      setLoading(false);
    }
  }, [valid, workspaceId, cycleId, artifactRef, sha256, recommendations, rules, thresholds, segments, grayTargets, metrics, status, onDone]);

  return (
    <div className="space-y-2 rounded-md border border-neutral-200 bg-neutral-50 p-2 dark:border-neutral-700 dark:bg-neutral-800/50">
      <TextField label="业务行动制品引用" value={artifactRef} onChange={setArtifactRef} placeholder="artifact-ref" required />
      <TextField label="内容 SHA-256" value={sha256} onChange={setSha256} placeholder="64位小写十六进制" required />
      <JsonField label="选中建议" value={recommendations} onChange={setRecommendations} placeholder="[...]" />
      <JsonField label="业务规则" value={rules} onChange={setRules} />
      <JsonField label="阈值" value={thresholds} onChange={setThresholds} />
      <JsonField label="细分" value={segments} onChange={setSegments} />
      <JsonField label="灰度发布目标" value={grayTargets} onChange={setGrayTargets} />
      <JsonField label="反馈指标定义" value={metrics} onChange={setMetrics} placeholder="[...]" />
      <SelectField
        label="转化状态"
        value={status}
        onChange={(v) => setStatus(v as "draft" | "confirmed")}
        options={[
          { value: "draft", label: "草稿" },
          { value: "confirmed", label: "已确认" },
        ]}
      />
      <SubmitButton loading={loading} onClick={handleSubmit} disabled={!valid}>
        记录 S3.1
      </SubmitButton>
    </div>
  );
}

// ---------------------------------------------------------------------------
// S3.2 Deployment form
// ---------------------------------------------------------------------------

function S32Form({
  workspaceId,
  cycleId,
  onDone,
}: {
  workspaceId: string;
  cycleId: string;
  onDone: (r: ClosureCommandResult) => void;
}) {
  const [loading, setLoading] = useState(false);
  const [system, setSystem] = useState<string>("cdp_tag_engine");
  const [ticketRef, setTicketRef] = useState("");
  const [grayConfig, setGrayConfig] = useState("{}");
  const [rollback, setRollback] = useState("");
  const [depStatus, setDepStatus] = useState<string>("pending");

  const valid = ticketRef.trim() && rollback.trim() && isValidJson(grayConfig);

  const handleSubmit = useCallback(async () => {
    if (!valid) return;
    setLoading(true);
    try {
      const result = await api.recordS32Deployment(workspaceId, cycleId, {
        downstreamSystem: system as "cdp_tag_engine" | "marketing_automation" | "bi_reports" | "other",
        deploymentTicketRef: ticketRef,
        grayConfigJson: grayConfig,
        rollbackPath: rollback,
        deploymentStatus: depStatus as "pending" | "test_verified" | "gray_verified" | "fully_deployed" | "failed" | "rolled_back",
      });
      onDone(result);
    } catch (err) {
      onDone({ kind: "failed", errorSummary: err instanceof Error ? err.message : String(err) });
    } finally {
      setLoading(false);
    }
  }, [valid, workspaceId, cycleId, system, ticketRef, grayConfig, rollback, depStatus, onDone]);

  return (
    <div className="space-y-2 rounded-md border border-neutral-200 bg-neutral-50 p-2 dark:border-neutral-700 dark:bg-neutral-800/50">
      <SelectField
        label="下游系统"
        value={system}
        onChange={setSystem}
        options={Object.entries(DOWNSTREAM_SYSTEM_LABELS).map(([v, l]) => ({ value: v, label: l }))}
      />
      <TextField label="部署工单引用" value={ticketRef} onChange={setTicketRef} placeholder="ticket-ref" required />
      <JsonField label="灰度配置" value={grayConfig} onChange={setGrayConfig} />
      <TextField label="回滚路径" value={rollback} onChange={setRollback} placeholder="rollback path" required />
      <SelectField
        label="部署状态"
        value={depStatus}
        onChange={setDepStatus}
        options={Object.entries(DEPLOYMENT_STATUS_LABELS).map(([v, l]) => ({ value: v, label: l }))}
      />
      <SubmitButton loading={loading} onClick={handleSubmit} disabled={!valid}>
        记录 S3.2
      </SubmitButton>
    </div>
  );
}

// ---------------------------------------------------------------------------
// S3.3 Execution form
// ---------------------------------------------------------------------------

function S33Form({
  workspaceId,
  cycleId,
  onDone,
}: {
  workspaceId: string;
  cycleId: string;
  onDone: (r: ClosureCommandResult) => void;
}) {
  const [loading, setLoading] = useState(false);
  const [scope, setScope] = useState("{}");
  const [owner, setOwner] = useState("");
  const [windowStart, setWindowStart] = useState("");
  const [windowEnd, setWindowEnd] = useState("");
  const [actionVersion, setActionVersion] = useState("");
  const [source, setSource] = useState<string>("execution_log");

  const valid = isValidJson(scope) && owner.trim() && windowStart.trim() && windowEnd.trim() && actionVersion.trim();

  const handleSubmit = useCallback(async () => {
    if (!valid) return;
    setLoading(true);
    try {
      const result = await api.recordS33Execution(workspaceId, cycleId, {
        businessScopeJson: scope,
        ownerRole: owner,
        executionWindowStart: windowStart,
        executionWindowEnd: windowEnd,
        actionVersion,
        feedbackSource: source as "execution_log" | "conversion_data" | "tag_hit_log" | "combined",
      });
      onDone(result);
    } catch (err) {
      onDone({ kind: "failed", errorSummary: err instanceof Error ? err.message : String(err) });
    } finally {
      setLoading(false);
    }
  }, [valid, workspaceId, cycleId, scope, owner, windowStart, windowEnd, actionVersion, source, onDone]);

  return (
    <div className="space-y-2 rounded-md border border-neutral-200 bg-neutral-50 p-2 dark:border-neutral-700 dark:bg-neutral-800/50">
      <JsonField label="业务范围" value={scope} onChange={setScope} />
      <TextField label="负责人角色" value={owner} onChange={setOwner} placeholder="role" required />
      <TextField label="执行窗口开始" value={windowStart} onChange={setWindowStart} placeholder="ISO date" required />
      <TextField label="执行窗口结束" value={windowEnd} onChange={setWindowEnd} placeholder="ISO date" required />
      <TextField label="行动版本" value={actionVersion} onChange={setActionVersion} placeholder="v1" required />
      <SelectField
        label="反馈来源"
        value={source}
        onChange={setSource}
        options={Object.entries(FEEDBACK_SOURCE_LABELS).map(([v, l]) => ({ value: v, label: l }))}
      />
      <SubmitButton loading={loading} onClick={handleSubmit} disabled={!valid}>
        记录 S3.3
      </SubmitButton>
    </div>
  );
}

// ---------------------------------------------------------------------------
// S3.4 Feedback append form
// ---------------------------------------------------------------------------

function S34Form({
  workspaceId,
  cycleId,
  nextOrdinal,
  onDone,
}: {
  workspaceId: string;
  cycleId: string;
  nextOrdinal: number;
  onDone: (r: ClosureCommandResult) => void;
}) {
  const [loading, setLoading] = useState(false);
  const [datasetRef, setDatasetRef] = useState("");
  const [metricsJson, setMetricsJson] = useState("{}");
  const [significance, setSignificance] = useState<string>("pending");
  const [reviewStatus, setReviewStatus] = useState<string>("pending");

  const valid = datasetRef.trim() && isValidJson(metricsJson);

  const handleSubmit = useCallback(async () => {
    if (!valid) return;
    setLoading(true);
    try {
      const result = await api.appendS34Feedback(workspaceId, cycleId, {
        feedbackOrdinal: nextOrdinal,
        feedbackDatasetRef: datasetRef,
        metricsJson,
        statisticalSignificance: significance as "not_reached" | "reached" | "pending",
        antigravityReviewStatus: reviewStatus as "pending" | "passed" | "rejected",
      });
      onDone(result);
    } catch (err) {
      onDone({ kind: "failed", errorSummary: err instanceof Error ? err.message : String(err) });
    } finally {
      setLoading(false);
    }
  }, [valid, workspaceId, cycleId, nextOrdinal, datasetRef, metricsJson, significance, reviewStatus, onDone]);

  return (
    <div className="space-y-2 rounded-md border border-neutral-200 bg-neutral-50 p-2 dark:border-neutral-700 dark:bg-neutral-800/50">
      <div className="text-[10px] text-neutral-500">
        反馈序号: <span className="font-medium text-neutral-700 dark:text-neutral-300">{nextOrdinal}</span>
      </div>
      <TextField label="反馈数据集引用" value={datasetRef} onChange={setDatasetRef} placeholder="dataset-ref" required />
      <JsonField label="指标" value={metricsJson} onChange={setMetricsJson} />
      <SelectField
        label="统计显著性"
        value={significance}
        onChange={setSignificance}
        options={Object.entries(SIGNIFICANCE_STATUS_LABELS).map(([v, l]) => ({ value: v, label: l }))}
      />
      <SelectField
        label="审核状态"
        value={reviewStatus}
        onChange={setReviewStatus}
        options={Object.entries(REVIEW_STATUS_LABELS).map(([v, l]) => ({ value: v, label: l }))}
      />
      <SubmitButton loading={loading} onClick={handleSubmit} disabled={!valid}>
        追加 S3.4 反馈
      </SubmitButton>
    </div>
  );
}

// ---------------------------------------------------------------------------
// S3.5 Evaluation form
// ---------------------------------------------------------------------------

function S35Form({
  workspaceId,
  cycleId,
  onDone,
}: {
  workspaceId: string;
  cycleId: string;
  onDone: (r: ClosureCommandResult) => void;
}) {
  const [loading, setLoading] = useState(false);
  const [reportRef, setReportRef] = useState("");
  const [reportSha256, setReportSha256] = useState("");
  const [deviation, setDeviation] = useState("{}");
  const [hypothesis, setHypothesis] = useState<string>("inconclusive");
  const [rating, setRating] = useState<string>("met_expectations");

  const valid = reportRef.trim() && isValidSha256(reportSha256) && isValidJson(deviation);

  const handleSubmit = useCallback(async () => {
    if (!valid) return;
    setLoading(true);
    try {
      const result = await api.recordS35Evaluation(workspaceId, cycleId, {
        evaluationReportRef: reportRef,
        evaluationReportSha256: reportSha256,
        deviationAnalysisJson: deviation,
        hypothesisResult: hypothesis as "confirmed" | "rejected" | "inconclusive",
        effectivenessRating: rating as "met_expectations" | "significant_deviation" | "warning",
      });
      onDone(result);
    } catch (err) {
      onDone({ kind: "failed", errorSummary: err instanceof Error ? err.message : String(err) });
    } finally {
      setLoading(false);
    }
  }, [valid, workspaceId, cycleId, reportRef, reportSha256, deviation, hypothesis, rating, onDone]);

  return (
    <div className="space-y-2 rounded-md border border-neutral-200 bg-neutral-50 p-2 dark:border-neutral-700 dark:bg-neutral-800/50">
      <TextField label="评估报告引用" value={reportRef} onChange={setReportRef} placeholder="report-ref" required />
      <TextField label="报告 SHA-256" value={reportSha256} onChange={setReportSha256} placeholder="64位小写十六进制" required />
      <JsonField label="偏差分析" value={deviation} onChange={setDeviation} />
      <SelectField
        label="假设结论"
        value={hypothesis}
        onChange={setHypothesis}
        options={Object.entries(HYPOTHESIS_RESULT_LABELS).map(([v, l]) => ({ value: v, label: l }))}
      />
      <SelectField
        label="效果评级"
        value={rating}
        onChange={setRating}
        options={Object.entries(EFFECTIVENESS_RATING_LABELS).map(([v, l]) => ({ value: v, label: l }))}
      />
      <SubmitButton loading={loading} onClick={handleSubmit} disabled={!valid}>
        记录 S3.5
      </SubmitButton>
    </div>
  );
}

// ---------------------------------------------------------------------------
// S3.6 Trigger form
// ---------------------------------------------------------------------------

function S36Form({
  workspaceId,
  cycleId,
  onDone,
}: {
  workspaceId: string;
  cycleId: string;
  onDone: (r: ClosureCommandResult) => void;
}) {
  const [loading, setLoading] = useState(false);
  const [branch, setBranch] = useState<string>("archive");
  const [targetState, setTargetState] = useState<string>("");

  const valid = branch === "archive" || (branch === "iterate" && targetState !== "");

  const handleSubmit = useCallback(async () => {
    if (!valid) return;
    setLoading(true);
    try {
      const result = await api.recordS36Trigger(workspaceId, cycleId, {
        branch: branch as "archive" | "iterate",
        targetState: (targetState || null) as "S1.1" | "S2.3" | null,
      });
      onDone(result);
    } catch (err) {
      onDone({ kind: "failed", errorSummary: err instanceof Error ? err.message : String(err) });
    } finally {
      setLoading(false);
    }
  }, [valid, workspaceId, cycleId, branch, targetState, onDone]);

  return (
    <div className="space-y-2 rounded-md border border-neutral-200 bg-neutral-50 p-2 dark:border-neutral-700 dark:bg-neutral-800/50">
      <SelectField
        label="决策分支"
        value={branch}
        onChange={(v) => { setBranch(v); if (v === "archive") setTargetState(""); }}
        options={Object.entries(ITERATION_BRANCH_LABELS).map(([v, l]) => ({ value: v, label: l }))}
      />
      {branch === "iterate" && (
        <SelectField
          label="目标状态"
          value={targetState}
          onChange={setTargetState}
          options={[
            { value: "", label: "-- 选择目标 --" },
            { value: "S1.1", label: "S1.1 已提交需求" },
            { value: "S2.3", label: "S2.3 执行中·分析" },
          ]}
        />
      )}
      <SubmitButton loading={loading} onClick={handleSubmit} disabled={!valid}>
        记录 S3.6
      </SubmitButton>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Initiate closure form
// ---------------------------------------------------------------------------

function InitiateForm({
  workspaceId,
  projectId,
  lockedReportId,
  onDone,
}: {
  workspaceId: string;
  projectId: string;
  lockedReportId: string;
  onDone: (r: ClosureCommandResult) => void;
}) {
  const [loading, setLoading] = useState(false);
  const [ordinal, setOrdinal] = useState("1");

  const handleSubmit = useCallback(async () => {
    const ord = parseInt(ordinal, 10);
    if (!Number.isFinite(ord) || ord < 1) return;
    setLoading(true);
    try {
      const result = await api.initiateClosureCycle(workspaceId, projectId, {
        lockedReportVersionId: lockedReportId,
        closureOrdinal: ord,
      });
      onDone(result);
    } catch (err) {
      onDone({ kind: "failed", errorSummary: err instanceof Error ? err.message : String(err) });
    } finally {
      setLoading(false);
    }
  }, [workspaceId, projectId, lockedReportId, ordinal, onDone]);

  return (
    <div className="space-y-2 rounded-md border border-blue-200 bg-blue-50 p-2.5 dark:border-blue-900 dark:bg-blue-950/20">
      <div className="text-[11px] font-medium text-blue-700 dark:text-blue-400">
        启动闭合周期
      </div>
      <div className="text-[10px] text-neutral-500">
        锁定报告: {lockedReportId.slice(0, 8)}…
      </div>
      <NumberField label="闭合序号" value={ordinal} onChange={setOrdinal} placeholder="1" />
      <SubmitButton loading={loading} onClick={handleSubmit}>
        启动
      </SubmitButton>
    </div>
  );
}

// ---------------------------------------------------------------------------
// S3.1 fact display
// ---------------------------------------------------------------------------

function S31Display({ fact }: { fact: S31FactRef }) {
  return (
    <div className="space-y-0.5">
      <MiniField label="制品引用">{fact.businessActionArtifactRef}</MiniField>
      <MiniField label="状态">
        <StatusBadge
          label={TRANSLATION_STATUS_LABELS[fact.translationStatus]}
          color={fact.translationStatus === "confirmed" ? "text-green-700 bg-green-100 dark:text-green-400 dark:bg-green-950/30" : "text-amber-700 bg-amber-100 dark:text-amber-400 dark:bg-amber-950/30"}
        />
      </MiniField>
      {fact.confirmedAt && <MiniField label="确认时间">{formatRelativeTime(fact.confirmedAt)}</MiniField>}
      <MiniField label="创建时间">{formatRelativeTime(fact.createdAt)}</MiniField>
    </div>
  );
}

// ---------------------------------------------------------------------------
// S3.2 fact display
// ---------------------------------------------------------------------------

function S32Display({ fact }: { fact: S32FactRef }) {
  return (
    <div className="space-y-0.5">
      <MiniField label="下游系统">{DOWNSTREAM_SYSTEM_LABELS[fact.downstreamSystem]}</MiniField>
      <MiniField label="工单引用">{fact.deploymentTicketRef}</MiniField>
      <MiniField label="部署状态">
        <StatusBadge
          label={DEPLOYMENT_STATUS_LABELS[fact.deploymentStatus]}
          color={
            fact.deploymentStatus === "fully_deployed"
              ? "text-green-700 bg-green-100 dark:text-green-400 dark:bg-green-950/30"
              : fact.deploymentStatus === "failed" || fact.deploymentStatus === "rolled_back"
                ? "text-red-700 bg-red-100 dark:text-red-400 dark:bg-red-950/30"
                : "text-amber-700 bg-amber-100 dark:text-amber-400 dark:bg-amber-950/30"
          }
        />
      </MiniField>
      {fact.confirmedAt && <MiniField label="确认时间">{formatRelativeTime(fact.confirmedAt)}</MiniField>}
      <MiniField label="创建时间">{formatRelativeTime(fact.createdAt)}</MiniField>
    </div>
  );
}

// ---------------------------------------------------------------------------
// S3.3 fact display
// ---------------------------------------------------------------------------

function S33Display({ fact }: { fact: S33FactRef }) {
  return (
    <div className="space-y-0.5">
      <MiniField label="负责人">{fact.ownerRole}</MiniField>
      <MiniField label="执行窗口">
        {fact.executionWindowStart} ~ {fact.executionWindowEnd}
      </MiniField>
      <MiniField label="反馈来源">{FEEDBACK_SOURCE_LABELS[fact.feedbackSource]}</MiniField>
      <MiniField label="创建时间">{formatRelativeTime(fact.createdAt)}</MiniField>
    </div>
  );
}

// ---------------------------------------------------------------------------
// S3.4 feedback list display
// ---------------------------------------------------------------------------

function S34Display({ facts }: { facts: readonly S34FactRef[] }) {
  if (facts.length === 0) return <div className="text-[11px] text-neutral-400">暂无反馈</div>;
  return (
    <div className="space-y-1.5">
      {facts.map((f) => (
        <div
          key={f.ingestionId}
          className="rounded border border-neutral-200 bg-white p-1.5 text-[11px] dark:border-neutral-700 dark:bg-neutral-900"
        >
          <div className="flex items-center gap-2">
            <span className="font-medium text-neutral-600 dark:text-neutral-400">#{f.feedbackOrdinal}</span>
            <span className="text-neutral-500">{f.feedbackDatasetRef}</span>
          </div>
          <div className="mt-0.5 flex items-center gap-2">
            <StatusBadge
              label={SIGNIFICANCE_STATUS_LABELS[f.statisticalSignificance]}
              color={
                f.statisticalSignificance === "reached"
                  ? "text-green-700 bg-green-100 dark:text-green-400 dark:bg-green-950/30"
                  : "text-neutral-600 bg-neutral-100 dark:text-neutral-400 dark:bg-neutral-800"
              }
            />
            <StatusBadge
              label={REVIEW_STATUS_LABELS[f.antigravityReviewStatus]}
              color={
                f.antigravityReviewStatus === "passed"
                  ? "text-green-700 bg-green-100 dark:text-green-400 dark:bg-green-950/30"
                  : f.antigravityReviewStatus === "rejected"
                    ? "text-red-700 bg-red-100 dark:text-red-400 dark:bg-red-950/30"
                    : "text-amber-700 bg-amber-100 dark:text-amber-400 dark:bg-amber-950/30"
              }
            />
            <span className="text-[10px] text-neutral-400">{formatRelativeTime(f.createdAt)}</span>
          </div>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// S3.5 fact display
// ---------------------------------------------------------------------------

function S35Display({ fact }: { fact: S35FactRef }) {
  return (
    <div className="space-y-0.5">
      <MiniField label="假设结论">
        <StatusBadge
          label={HYPOTHESIS_RESULT_LABELS[fact.hypothesisResult]}
          color={
            fact.hypothesisResult === "confirmed"
              ? "text-green-700 bg-green-100 dark:text-green-400 dark:bg-green-950/30"
              : fact.hypothesisResult === "rejected"
                ? "text-red-700 bg-red-100 dark:text-red-400 dark:bg-red-950/30"
                : "text-amber-700 bg-amber-100 dark:text-amber-400 dark:bg-amber-950/30"
          }
        />
      </MiniField>
      <MiniField label="效果评级">
        <StatusBadge
          label={EFFECTIVENESS_RATING_LABELS[fact.effectivenessRating]}
          color={
            fact.effectivenessRating === "met_expectations"
              ? "text-green-700 bg-green-100 dark:text-green-400 dark:bg-green-950/30"
              : "text-red-700 bg-red-100 dark:text-red-400 dark:bg-red-950/30"
          }
        />
      </MiniField>
      <MiniField label="评估时间">{formatRelativeTime(fact.reviewedAt)}</MiniField>
      <MiniField label="创建时间">{formatRelativeTime(fact.createdAt)}</MiniField>
    </div>
  );
}

// ---------------------------------------------------------------------------
// S3.6 fact display
// ---------------------------------------------------------------------------

function S36Display({ fact }: { fact: S36FactRef }) {
  return (
    <div className="space-y-0.5">
      <MiniField label="决策分支">
        <StatusBadge
          label={ITERATION_BRANCH_LABELS[fact.branch]}
          color={fact.branch === "archive" ? "text-green-700 bg-green-100 dark:text-green-400 dark:bg-green-950/30" : "text-blue-700 bg-blue-100 dark:text-blue-400 dark:bg-blue-950/30"}
        />
      </MiniField>
      {fact.targetState && <MiniField label="目标状态">{fact.targetState}</MiniField>}
      <MiniField label="决策时间">{formatRelativeTime(fact.triggeredAt)}</MiniField>
      <MiniField label="创建时间">{formatRelativeTime(fact.createdAt)}</MiniField>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Cycle detail view
// ---------------------------------------------------------------------------

function CycleDetail({
  workspaceId,
  detail,
  onRefresh,
}: {
  workspaceId: string;
  detail: ClosureDetailData;
  onRefresh: () => void;
}) {
  const { cycle, s31, s32, s33, s34, s35, s36 } = detail;
  const [activeForm, setActiveForm] = useState<ClosureStage | null>(null);
  const [cmdResult, setCmdResult] = useState<ClosureCommandResult | null>(null);

  const handleCmdDone = useCallback(
    (r: ClosureCommandResult) => {
      setCmdResult(r);
      if (r.kind === "executed" || r.kind === "replayed_success") {
        setActiveForm(null);
        onRefresh();
      }
    },
    [onRefresh],
  );

  const nextStage: ClosureStage | null = (() => {
    if (!s31) return "S3.1";
    if (!s32) return "S3.2";
    if (!s33) return "S3.3";
    if (s34.length === 0) return "S3.4";
    if (!s35) return "S3.5";
    if (!s36) return "S3.6";
    return null;
  })();

  return (
    <div className="space-y-3">
      {/* Cycle header */}
      <div className="flex items-center gap-3">
        <span className="text-[12px] font-medium text-neutral-700 dark:text-neutral-300">
          闭合周期 #{cycle.closureOrdinal}
        </span>
        <StatusBadge
          label={CLOSURE_CYCLE_STATUS_LABELS[cycle.cycleStatus]}
          color={
            cycle.cycleStatus === "in_progress"
              ? "text-blue-700 bg-blue-100 dark:text-blue-400 dark:bg-blue-950/30"
              : cycle.cycleStatus === "archived"
                ? "text-green-700 bg-green-100 dark:text-green-400 dark:bg-green-950/30"
                : "text-amber-700 bg-amber-100 dark:text-amber-400 dark:bg-amber-950/30"
          }
        />
        <span className="text-[10px] text-neutral-400">{formatRelativeTime(cycle.initiatedAt)}</span>
      </div>

      {/* Stage progress */}
      <StageIndicator currentStage={cycle.currentStage} />

      {/* Command result */}
      <CommandResultBanner result={cmdResult} />

      {/* S3.1 */}
      <StageCard title="结论转化" stage="S3.1" done={!!s31}>
        {s31 ? (
          <S31Display fact={s31} />
        ) : (
          <div className="text-[11px] text-neutral-400">未记录</div>
        )}
        {nextStage === "S3.1" && (
          <div className="mt-2">
            {activeForm === "S3.1" ? (
              <S31Form workspaceId={workspaceId} cycleId={cycle.closureCycleId} onDone={handleCmdDone} />
            ) : (
              <button
                onClick={() => setActiveForm("S3.1")}
                className="text-[11px] text-blue-600 hover:underline dark:text-blue-400"
              >
                记录结论转化
              </button>
            )}
          </div>
        )}
      </StageCard>

      {/* S3.2 */}
      <StageCard title="系统部署" stage="S3.2" done={!!s32}>
        {s32 ? (
          <S32Display fact={s32} />
        ) : (
          <div className="text-[11px] text-neutral-400">未记录</div>
        )}
        {nextStage === "S3.2" && (
          <div className="mt-2">
            {activeForm === "S3.2" ? (
              <S32Form workspaceId={workspaceId} cycleId={cycle.closureCycleId} onDone={handleCmdDone} />
            ) : (
              <button
                onClick={() => setActiveForm("S3.2")}
                className="text-[11px] text-blue-600 hover:underline dark:text-blue-400"
              >
                记录系统部署
              </button>
            )}
          </div>
        )}
      </StageCard>

      {/* S3.3 */}
      <StageCard title="业务执行" stage="S3.3" done={!!s33}>
        {s33 ? (
          <S33Display fact={s33} />
        ) : (
          <div className="text-[11px] text-neutral-400">未记录</div>
        )}
        {nextStage === "S3.3" && (
          <div className="mt-2">
            {activeForm === "S3.3" ? (
              <S33Form workspaceId={workspaceId} cycleId={cycle.closureCycleId} onDone={handleCmdDone} />
            ) : (
              <button
                onClick={() => setActiveForm("S3.3")}
                className="text-[11px] text-blue-600 hover:underline dark:text-blue-400"
              >
                记录业务执行
              </button>
            )}
          </div>
        )}
      </StageCard>

      {/* S3.4 */}
      <StageCard title="效果反馈" stage="S3.4" done={s34.length > 0}>
        <S34Display facts={s34} />
        {nextStage === "S3.4" || (s31 && s32 && s33 && !s35) ? (
          <div className="mt-2">
            {activeForm === "S3.4" ? (
              <S34Form
                workspaceId={workspaceId}
                cycleId={cycle.closureCycleId}
                nextOrdinal={s34.length + 1}
                onDone={handleCmdDone}
              />
            ) : (
              <button
                onClick={() => setActiveForm("S3.4")}
                className="inline-flex items-center gap-1 text-[11px] text-blue-600 hover:underline dark:text-blue-400"
              >
                <Plus className="h-3 w-3" />
                追加反馈 #{s34.length + 1}
              </button>
            )}
          </div>
        ) : null}
      </StageCard>

      {/* S3.5 */}
      <StageCard title="效果评估" stage="S3.5" done={!!s35}>
        {s35 ? (
          <S35Display fact={s35} />
        ) : (
          <div className="text-[11px] text-neutral-400">未记录</div>
        )}
        {nextStage === "S3.5" && (
          <div className="mt-2">
            {activeForm === "S3.5" ? (
              <S35Form workspaceId={workspaceId} cycleId={cycle.closureCycleId} onDone={handleCmdDone} />
            ) : (
              <button
                onClick={() => setActiveForm("S3.5")}
                className="text-[11px] text-blue-600 hover:underline dark:text-blue-400"
              >
                记录效果评估
              </button>
            )}
          </div>
        )}
      </StageCard>

      {/* S3.6 */}
      <StageCard title="迭代决策" stage="S3.6" done={!!s36}>
        {s36 ? (
          <S36Display fact={s36} />
        ) : (
          <div className="text-[11px] text-neutral-400">未记录</div>
        )}
        {nextStage === "S3.6" && (
          <div className="mt-2">
            {activeForm === "S3.6" ? (
              <S36Form workspaceId={workspaceId} cycleId={cycle.closureCycleId} onDone={handleCmdDone} />
            ) : (
              <button
                onClick={() => setActiveForm("S3.6")}
                className="text-[11px] text-blue-600 hover:underline dark:text-blue-400"
              >
                记录迭代决策
              </button>
            )}
          </div>
        )}
      </StageCard>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main ClosurePanel
// ---------------------------------------------------------------------------

export function ClosurePanel({ workspaceId, projectId, lockedReportId, onBack }: Props) {
  const [cycles, setCycles] = useState<ClosureCycleRef[]>([]);
  const [selectedCycleId, setSelectedCycleId] = useState<string | null>(null);
  const [detail, setDetail] = useState<ClosureDetailData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cmdResult, setCmdResult] = useState<ClosureCommandResult | null>(null);

  const loadCycles = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result: ClosureListReadModel = await api.listClosureCycles(workspaceId, projectId);
      setCycles([...result.data]);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [workspaceId, projectId]);

  const loadDetail = useCallback(
    async (cycleId: string) => {
      setLoading(true);
      setError(null);
      try {
        const result: ClosureDetailReadModel = await api.getClosureDetail(workspaceId, cycleId);
        setDetail(result.data);
        setSelectedCycleId(cycleId);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setLoading(false);
      }
    },
    [workspaceId],
  );

  useEffect(() => {
    void loadCycles();
  }, [loadCycles]);

  const handleSelectCycle = useCallback(
    (cycleId: string) => {
      void loadDetail(cycleId);
    },
    [loadDetail],
  );

  const handleBackToList = useCallback(() => {
    setSelectedCycleId(null);
    setDetail(null);
    setCmdResult(null);
    void loadCycles();
  }, [loadCycles]);

  const handleRefreshDetail = useCallback(() => {
    if (selectedCycleId) {
      void loadDetail(selectedCycleId);
    }
  }, [selectedCycleId, loadDetail]);

  const handleInitDone = useCallback(
    (r: ClosureCommandResult) => {
      setCmdResult(r);
      if (r.kind === "executed" || r.kind === "replayed_success") {
        void loadCycles();
      }
    },
    [loadCycles],
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-auto p-4">
      {/* Header */}
      <div className="mb-3 flex items-center gap-2">
        <button
          onClick={selectedCycleId ? handleBackToList : onBack}
          className="inline-flex h-6 items-center gap-1 rounded-md px-2 text-[11px] text-neutral-500 hover:bg-neutral-100 dark:hover:bg-neutral-800"
        >
          <ArrowLeft className="h-3 w-3" />
          {selectedCycleId ? "返回周期列表" : "返回"}
        </button>
        <h2 className="truncate text-[14px] font-medium text-neutral-900 dark:text-neutral-100">
          业务闭合
        </h2>
        <button
          onClick={selectedCycleId ? handleRefreshDetail : loadCycles}
          className="ml-auto inline-flex h-6 items-center gap-1 rounded-md px-2 text-[11px] text-neutral-500 hover:bg-neutral-100 dark:hover:bg-neutral-800"
        >
          <RefreshCw className="h-3 w-3" />
          刷新
        </button>
      </div>

      {/* Error */}
      {error && (
        <div className="mb-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-[12px] text-red-600 dark:border-red-800 dark:bg-red-950/30 dark:text-red-400">
          <XCircle className="mr-1 inline h-3.5 w-3.5" />
          {error}
        </div>
      )}

      {/* Command result (initiate) */}
      {!selectedCycleId && <CommandResultBanner result={cmdResult} />}

      {/* Loading */}
      {loading && (
        <div className="flex flex-1 items-center justify-center">
          <Loader2 className="h-5 w-5 animate-spin text-neutral-400" />
        </div>
      )}

      {/* Content */}
      {!loading && !selectedCycleId && (
        <div className="space-y-3">
          {/* Cycle list */}
          {cycles.length > 0 ? (
            <div className="space-y-1.5">
              {cycles.map((c) => (
                <button
                  key={c.closureCycleId}
                  onClick={() => handleSelectCycle(c.closureCycleId)}
                  className="flex w-full items-center gap-3 rounded-md border border-neutral-200 bg-white p-2.5 text-left transition-colors hover:border-blue-300 hover:bg-blue-50/50 dark:border-neutral-800 dark:bg-neutral-900 dark:hover:border-blue-700 dark:hover:bg-blue-950/20"
                >
                  <span className="text-[12px] font-medium text-neutral-700 dark:text-neutral-300">
                    周期 #{c.closureOrdinal}
                  </span>
                  <StatusBadge
                    label={CLOSURE_CYCLE_STATUS_LABELS[c.cycleStatus]}
                    color={
                      c.cycleStatus === "in_progress"
                        ? "text-blue-700 bg-blue-100 dark:text-blue-400 dark:bg-blue-950/30"
                        : c.cycleStatus === "archived"
                          ? "text-green-700 bg-green-100 dark:text-green-400 dark:bg-green-950/30"
                          : "text-amber-700 bg-amber-100 dark:text-amber-400 dark:bg-amber-950/30"
                    }
                  />
                  {c.currentStage && (
                    <span className="text-[10px] text-neutral-500">
                      {CLOSURE_STAGE_LABELS[c.currentStage]}
                    </span>
                  )}
                  <span className="ml-auto text-[10px] text-neutral-400">
                    {formatRelativeTime(c.updatedAt)}
                  </span>
                </button>
              ))}
            </div>
          ) : (
            <div className="rounded-md border border-neutral-200 bg-neutral-50 p-4 text-center text-[12px] text-neutral-400 dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-600">
              暂无闭合周期
            </div>
          )}

          {/* Initiate new cycle */}
          {lockedReportId && (
            <InitiateForm
              workspaceId={workspaceId}
              projectId={projectId}
              lockedReportId={lockedReportId}
              onDone={handleInitDone}
            />
          )}
          {!lockedReportId && cycles.length === 0 && (
            <div className="rounded-md border border-amber-200 bg-amber-50 p-2.5 text-[11px] text-amber-700 dark:border-amber-900 dark:bg-amber-950/20 dark:text-amber-400">
              项目需要锁定报告后才能启动闭合周期
            </div>
          )}
        </div>
      )}

      {/* Cycle detail */}
      {!loading && selectedCycleId && detail && (
        <CycleDetail workspaceId={workspaceId} detail={detail} onRefresh={handleRefreshDetail} />
      )}
    </div>
  );
}
