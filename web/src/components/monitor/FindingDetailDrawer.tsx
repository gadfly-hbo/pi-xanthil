import { useEffect, useState } from "react";
import { Check, FlaskConical, Loader2, X } from "lucide-react";
import { engineApi } from "@/lib/api/engine";
import { vizApi } from "@/lib/api/viz";
import type { ActionItem, ActionItemDraft, ActionTask, HealthFinding, MonitorComparison, MonitorRun } from "@/types";

const SEVERITY_CLASS: Record<string, string> = {
  critical: "bg-red-100 text-red-700 dark:bg-red-950/40 dark:text-red-300",
  warn: "bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300",
  info: "bg-blue-100 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300",
};

const COMPARISON_LABEL: Record<string, string> = {
  target: "目标差距",
  history: "历史差距",
  industry: "行业差距",
  competitor: "竞品差距",
};

function monitorReportKey(runId: string): string {
  return "monitor:" + runId;
}

function fmtNum(v: number | null | undefined): string {
  if (v === null || v === undefined || Number.isNaN(v)) return "-";
  if (Math.abs(v) >= 1000) return v.toFixed(0);
  if (Math.abs(v) >= 1) return v.toFixed(2);
  return v.toFixed(4);
}

function fmtPct(v: number | null | undefined): string {
  if (v === null || v === undefined || Number.isNaN(v)) return "-";
  return `${v > 0 ? "+" : ""}${(v * 100).toFixed(1)}%`;
}

function findingMarker(findingId: string): string {
  return "monitor-finding:" + findingId;
}

function safeEvidence(value: unknown): unknown {
  if (Array.isArray(value)) return value.slice(0, 10).map(safeEvidence);
  if (!value || typeof value !== "object") return value;
  const out: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value)) {
    if (/^(row|rows|records|values|samples?)$/i.test(key)) {
      out[key] = "[redacted]";
    } else {
      out[key] = safeEvidence(child);
    }
  }
  return out;
}

function ComparisonTable({ comparisons }: { comparisons: MonitorComparison[] }) {
  if (comparisons.length === 0) return <p className="text-[12px] text-neutral-400">暂无差距对比。</p>;
  return (
    <div className="overflow-hidden rounded-md border border-neutral-200 text-[11px] dark:border-neutral-800">
      {comparisons.map((c, idx) => (
        <div key={idx} className="grid grid-cols-5 gap-2 border-b border-neutral-100 px-2 py-1.5 last:border-0 dark:border-neutral-800">
          <span className="font-medium text-neutral-700 dark:text-neutral-200">{COMPARISON_LABEL[c.kind] ?? c.kind}</span>
          <span className="truncate text-neutral-500">{c.label}</span>
          <span className="font-mono">{fmtNum(c.currentValue)} / {fmtNum(c.baselineValue)}</span>
          <span className="font-mono">{fmtNum(c.delta)} ({fmtPct(c.deltaRate)})</span>
          <span className="truncate text-neutral-400">{c.window ?? "-"}</span>
        </div>
      ))}
    </div>
  );
}

export function FindingDetailDrawer({
  workspaceId,
  run,
  finding,
  items,
  tasks,
  onClose,
  onChanged,
}: {
  workspaceId: string | null;
  run: MonitorRun | null;
  finding: HealthFinding | null;
  items: ActionItem[];
  tasks: ActionTask[];
  onClose: () => void;
  onChanged?: () => void;
}) {
  const [drafts, setDrafts] = useState<ActionItemDraft[]>([]);
  const [busy, setBusy] = useState<"draft" | "adopt" | "dismiss" | "eval" | null>(null);
  const [error, setError] = useState("");
  const [evalSubmitted, setEvalSubmitted] = useState(false);

  useEffect(() => {
    setDrafts([]);
    setBusy(null);
    setError("");
    setEvalSubmitted(false);
  }, [finding?.id, run?.id]);

  if (!finding) return null;
  const marker = findingMarker(finding.id);
  const mismatchedRun = !run || finding.runId !== run.id;
  const existing = items.find((item) => item.metricRef === marker || item.title === finding.title || drafts.some((draft) => draft.title === item.title));
  const existingTasks = existing ? tasks.filter((task) => task.actionItemId === existing.id) : [];

  const draftAction = async () => {
    if (!workspaceId || !run || mismatchedRun) return;
    setBusy("draft");
    setError("");
    try {
      const result = await vizApi.draftMonitorActions(workspaceId, { workspaceId, runId: run.id, findingIds: [finding.id] });
      setDrafts(result.drafts);
    } catch (e) {
      setError("生成行动项草案失败: " + String(e));
    } finally {
      setBusy(null);
    }
  };

  const adoptDraft = async (draft: ActionItemDraft) => {
    if (!workspaceId || !run || mismatchedRun) return;
    setBusy("adopt");
    setError("");
    try {
      if (existing) return;
      const item = await vizApi.createActionItem({
        sourceKind: "session",
        scopeId: workspaceId,
        reportPath: monitorReportKey(run.id),
        title: draft.title,
        rationale: draft.rationale,
        scene: draft.scene,
        lifecycle: draft.lifecycle,
        expectedImpact: draft.expectedImpact,
        metricRef: marker,
        priority: draft.priority,
        effort: draft.effort,
        confidence: draft.confidence,
        status: "adopted",
      });
      await vizApi.createActionTask({ actionItemId: item.id, title: "执行: " + draft.title, owner: "当前用户", status: "todo", priority: draft.priority, note: draft.rationale });
      onChanged?.();
    } catch (e) {
      setError("采纳行动项失败: " + String(e));
    } finally {
      setBusy(null);
    }
  };

  const dismissFinding = async () => {
    if (!workspaceId || !run || mismatchedRun) return;
    setBusy("dismiss");
    setError("");
    try {
      if (existing) return;
      await vizApi.createActionItem({
        sourceKind: "session",
        scopeId: workspaceId,
        reportPath: monitorReportKey(run.id),
        title: finding.title,
        rationale: finding.suggestion || finding.diagnosis?.summary || "用户在 finding 详情中标记为不处理。",
        expectedImpact: "不处理，仅保留审计记录。",
        metricRef: marker,
        priority: finding.severity === "critical" ? "high" : finding.severity === "warn" ? "medium" : "low",
        effort: "low",
        confidence: 1,
        status: "dismissed",
      });
      onChanged?.();
    } catch (e) {
      setError("忽略失败: " + String(e));
    } finally {
      setBusy(null);
    }
  };

  const submitEvalCandidate = async () => {
    if (!workspaceId || !run || mismatchedRun) return;
    setBusy("eval");
    setError("");
    try {
      await engineApi.createEvalRecord(workspaceId, {
        sourceFindingId: finding.id,
        failingTrace: {
          runId: run.id,
          module: "monitor",
          outcome: "fail",
          steps: [{
            stage: "monitor-finding",
            input: JSON.stringify({ suite: run.suite, ruleId: finding.ruleId, category: finding.category, kind: finding.kind, severity: finding.severity, lifecycle: finding.lifecycle, signature: finding.signature }),
            output: JSON.stringify({ title: finding.title, kind: finding.kind, severity: finding.severity, suggestion: finding.suggestion, comparisons: finding.comparisons, diagnosis: finding.diagnosis }),
            citation: finding.id,
          }],
        },
        expectedOutput: `Detect and explain production finding: ${finding.title}`,
        passCondition: "Reproduce the same finding signature from sanitized derived fields without raw row-level data.",
      });
      setEvalSubmitted(true);
    } catch (e) {
      setError("提交 eval 候选失败: " + String(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/30">
      <div className="flex h-full w-full max-w-2xl flex-col border-l border-neutral-200 bg-white shadow-xl dark:border-neutral-800 dark:bg-neutral-950">
        <div className="flex items-start justify-between gap-3 border-b border-neutral-200 px-4 py-3 dark:border-neutral-800">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
              <span className={`rounded px-1.5 py-0.5 ${SEVERITY_CLASS[finding.severity] ?? "bg-neutral-100"}`}>{finding.severity}</span>
              <span className="rounded bg-neutral-100 px-1.5 py-0.5 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300">{finding.kind}</span>
              <span className="rounded bg-neutral-100 px-1.5 py-0.5 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300">{finding.lifecycle}</span>
              <span className="text-neutral-400">{finding.category} · {finding.ruleId}</span>
            </div>
            <h3 className="mt-1 text-[15px] font-semibold text-neutral-900 dark:text-neutral-100">{finding.title}</h3>
          </div>
          <button onClick={onClose} className="rounded p-1 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700 dark:hover:bg-neutral-800 dark:hover:text-neutral-200">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto p-4 text-[12px]">
          {error && <div className="rounded border border-rose-200 bg-rose-50 px-2 py-1 text-rose-700 dark:border-rose-900 dark:bg-rose-950/30 dark:text-rose-300">{error}</div>}
          {mismatchedRun && <div className="rounded border border-amber-200 bg-amber-50 px-2 py-1 text-amber-700 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-300">当前 finding 不属于已选 run，请关闭后重新打开。</div>}
          {existing && (
            <div className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-200">
              已登记为行动项：{existing.status} · {existingTasks.length} 个任务
            </div>
          )}

          <section className="space-y-2">
            <h4 className="font-medium text-neutral-800 dark:text-neutral-100">基本信息</h4>
            <div className="grid grid-cols-2 gap-2 text-[11px] text-neutral-500">
              <span>signature: <code>{finding.signature}</code></span>
              <span>firstSeen: <code>{finding.firstSeenRunId ?? "-"}</code></span>
              <span>detected: {new Date(finding.detectedAt).toLocaleString()}</span>
              <span>run: {run?.id.slice(0, 8) ?? "-"}</span>
            </div>
          </section>

          <section className="space-y-2">
            <h4 className="font-medium text-neutral-800 dark:text-neutral-100">差距解释</h4>
            <ComparisonTable comparisons={finding.comparisons ?? []} />
          </section>

          {finding.diagnosis && (
            <section className="space-y-2 rounded-md border border-dashed border-neutral-300 bg-neutral-50 p-3 dark:border-neutral-700 dark:bg-neutral-900/60">
              <h4 className="font-medium text-neutral-800 dark:text-neutral-100">诊断</h4>
              <p className="text-neutral-700 dark:text-neutral-200">{finding.diagnosis.summary}</p>
              {finding.diagnosis.opportunity && <p className="text-emerald-700 dark:text-emerald-300">机会：{finding.diagnosis.opportunity}</p>}
              <div className="flex flex-wrap gap-1 text-[10px] text-neutral-500">
                {finding.diagnosis.relatedMetricIds.map((id) => <span key={id} className="rounded bg-white px-1 dark:bg-neutral-800">metric {id.slice(0, 8)}</span>)}
                {finding.diagnosis.ontologyObjectIds.map((id) => <span key={id} className="rounded bg-white px-1 dark:bg-neutral-800">object {id.slice(0, 8)}</span>)}
                {(finding.diagnosis.logicRuleIds ?? []).map((id) => <span key={id} className="rounded bg-white px-1 dark:bg-neutral-800">rule {id.slice(0, 8)}</span>)}
              </div>
            </section>
          )}

          <section className="space-y-2">
            <h4 className="font-medium text-neutral-800 dark:text-neutral-100">建议</h4>
            <p className="rounded-md bg-neutral-50 p-2 text-neutral-700 dark:bg-neutral-900 dark:text-neutral-200">{finding.suggestion || "暂无建议。"}</p>
          </section>

          <details className="text-[11px] text-neutral-500">
            <summary className="cursor-pointer">evidence（默认折叠）</summary>
            <pre className="mt-1 max-h-56 overflow-auto whitespace-pre-wrap break-all rounded bg-neutral-50 p-2 dark:bg-neutral-900">{JSON.stringify(safeEvidence(finding.evidence), null, 2)}</pre>
          </details>

          {drafts.length > 0 && (
            <section className="space-y-2">
              <h4 className="font-medium text-neutral-800 dark:text-neutral-100">行动项草案</h4>
              {drafts.map((draft, idx) => (
                <div key={idx} className="rounded-md border border-amber-200 bg-amber-50 p-2 dark:border-amber-900 dark:bg-amber-950/30">
                  <div className="font-medium text-amber-950 dark:text-amber-100">{draft.title}</div>
                  <p className="mt-1 text-amber-800 dark:text-amber-200">{draft.rationale}</p>
                  <div className="mt-2 flex justify-end gap-2">
                    <button disabled={busy === "dismiss" || mismatchedRun} onClick={() => void dismissFinding()} className="rounded px-2 py-1 text-[11px] text-amber-700 hover:bg-amber-100 disabled:opacity-50 dark:text-amber-300 dark:hover:bg-amber-900">忽略</button>
                    <button disabled={busy === "adopt" || mismatchedRun} onClick={() => void adoptDraft(draft)} className="inline-flex items-center gap-1 rounded bg-amber-600 px-2 py-1 text-[11px] text-white disabled:opacity-50">
                      {busy === "adopt" ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}采纳并建任务
                    </button>
                  </div>
                </div>
              ))}
            </section>
          )}
        </div>

        <div className="flex flex-wrap justify-end gap-2 border-t border-neutral-200 px-4 py-3 dark:border-neutral-800">
          <button disabled={busy === "eval" || evalSubmitted || mismatchedRun} onClick={() => void submitEvalCandidate()} className="inline-flex items-center gap-1 rounded-md border border-violet-200 px-3 py-1.5 text-[12px] text-violet-700 hover:bg-violet-50 disabled:opacity-50 dark:border-violet-800 dark:text-violet-300 dark:hover:bg-violet-950/40">
            {busy === "eval" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FlaskConical className="h-3.5 w-3.5" />}{evalSubmitted ? "已提候选" : "提为 eval 候选"}
          </button>
          <button disabled={busy === "dismiss" || !!existing || mismatchedRun} onClick={() => void dismissFinding()} className="rounded-md border border-neutral-300 px-3 py-1.5 text-[12px] text-neutral-600 hover:bg-neutral-50 disabled:opacity-50 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-900">忽略/不处理</button>
          <button disabled={busy === "draft" || !!existing || mismatchedRun} onClick={() => void draftAction()} className="inline-flex items-center gap-1 rounded-md bg-neutral-900 px-3 py-1.5 text-[12px] font-medium text-white disabled:opacity-50 dark:bg-neutral-100 dark:text-neutral-900">
            {busy === "draft" && <Loader2 className="h-3.5 w-3.5 animate-spin" />}生成行动项草案
          </button>
        </div>
      </div>
    </div>
  );
}
