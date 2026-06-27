import { useState } from "react";
import { GitBranch, RotateCcw, ShieldCheck } from "lucide-react";
import { api } from "@/lib/api";
import type { ChangeManifest, ChangeOutcome, HarnessComponent, LabKind } from "@/types";
import type { HarnessAttributeResult } from "@/lib/api/engine";

const outcomes: ChangeOutcome[] = ["defer", "accept", "revise", "reject"];

interface Props {
  component: HarnessComponent;
  lab: LabKind;
  currentEvaluationId?: string;
}

export function AheManifestPanel({ component, lab, currentEvaluationId }: Props) {
  const [failureEvidence, setFailureEvidence] = useState("");
  const [rootCause, setRootCause] = useState("");
  const [targetedFix, setTargetedFix] = useState("");
  const [predictedFix, setPredictedFix] = useState("");
  const [predictedRegression, setPredictedRegression] = useState("");
  const [outcome, setOutcome] = useState<ChangeOutcome>("defer");
  const [resourceId, setResourceId] = useState("");
  const [scope, setScope] = useState("");
  const [beforeSnapshot, setBeforeSnapshot] = useState("");
  const [afterSnapshot, setAfterSnapshot] = useState("");
  const [beforeEvaluationId, setBeforeEvaluationId] = useState("");
  const [afterEvaluationId, setAfterEvaluationId] = useState(currentEvaluationId ?? "");
  const [manifest, setManifest] = useState<ChangeManifest | null>(null);
  const [verdict, setVerdict] = useState<HarnessAttributeResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function createManifest(): Promise<void> {
    setBusy(true);
    setError("");
    try {
      const next = await api.createChangeManifest({
        component,
        failureEvidence,
        rootCause,
        targetedFix,
        predictedFix: splitList(predictedFix),
        predictedRegression: splitList(predictedRegression),
        outcome,
      });
      setManifest(next);
      if (resourceId.trim() && scope.trim()) {
        await api.createScopedRevision({
          component,
          resourceId: resourceId.trim(),
          scope: scope.trim(),
          beforeSnapshot,
          afterSnapshot,
          manifestEditId: next.editId,
        });
      }
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(false);
    }
  }

  async function runAttribute(): Promise<void> {
    if (!manifest) return;
    setBusy(true);
    setError("");
    try {
      setVerdict(await api.attributeChangeManifest(manifest.editId, {
        lab,
        beforeEvaluationId: beforeEvaluationId.trim(),
        afterEvaluationId: afterEvaluationId.trim(),
      }));
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="rounded-md border border-neutral-200 bg-white p-3 text-xs dark:border-neutral-800 dark:bg-neutral-950">
      <div className="flex items-center gap-2 text-sm font-semibold">
        <ShieldCheck className="h-4 w-4" />
        <span>AHE change manifest</span>
      </div>
      <div className="mt-3 grid gap-2 md:grid-cols-2">
        <Field label="失败证据" value={failureEvidence} onChange={setFailureEvidence} />
        <Field label="推断根因" value={rootCause} onChange={setRootCause} />
        <Field label="目标修复" value={targetedFix} onChange={setTargetedFix} />
        <label className="block text-[11px] font-medium">Outcome
          <select value={outcome} onChange={(event) => setOutcome(event.target.value as ChangeOutcome)} className="mt-1 w-full rounded border border-neutral-200 bg-white px-2 py-1 dark:border-neutral-700 dark:bg-neutral-900">
            {outcomes.map((item) => <option key={item} value={item}>{item}</option>)}
          </select>
        </label>
        <Field label="Predicted fix tasks" value={predictedFix} onChange={setPredictedFix} placeholder="task_id，一行一个" />
        <Field label="Predicted regression tasks" value={predictedRegression} onChange={setPredictedRegression} placeholder="task_id，一行一个" />
        <Field label="Revision resourceId" value={resourceId} onChange={setResourceId} placeholder="可选：被编辑资源 ID" />
        <Field label="Revision scope" value={scope} onChange={setScope} placeholder="可选：组件内 scope" />
        <Field label="Before snapshot" value={beforeSnapshot} onChange={setBeforeSnapshot} />
        <Field label="After snapshot" value={afterSnapshot} onChange={setAfterSnapshot} />
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button type="button" disabled={busy || (!predictedFix.trim() && !predictedRegression.trim())} onClick={() => void createManifest()} className="rounded bg-neutral-900 px-3 py-1.5 text-white disabled:opacity-40 dark:bg-neutral-100 dark:text-neutral-900">
          记录 manifest
        </button>
        {manifest && <span className="font-mono text-[11px] text-neutral-500">{manifest.editId}</span>}
      </div>
      <div className="mt-3 grid gap-2 md:grid-cols-[1fr_1fr_auto]">
        <input value={beforeEvaluationId} onChange={(event) => setBeforeEvaluationId(event.target.value)} placeholder="before evaluationId" className="rounded border border-neutral-200 bg-white px-2 py-1 font-mono dark:border-neutral-700 dark:bg-neutral-900" />
        <input value={afterEvaluationId} onChange={(event) => setAfterEvaluationId(event.target.value)} placeholder="after evaluationId" className="rounded border border-neutral-200 bg-white px-2 py-1 font-mono dark:border-neutral-700 dark:bg-neutral-900" />
        <button type="button" disabled={busy || !manifest || !beforeEvaluationId.trim() || !afterEvaluationId.trim()} onClick={() => void runAttribute()} className="inline-flex items-center justify-center gap-1 rounded border border-neutral-200 px-3 py-1.5 disabled:opacity-40 dark:border-neutral-700">
          <GitBranch className="h-3.5 w-3.5" /> 对照
        </button>
      </div>
      {verdict && (
        <div className="mt-3 grid gap-2 rounded bg-neutral-50 p-2 dark:bg-neutral-900 md:grid-cols-3">
          <Metric label="Fix P/R" value={`${pct(verdict.verdict.fixPrecision)} / ${pct(verdict.verdict.fixRecall)}`} />
          <Metric label="Reg P/R" value={`${pct(verdict.verdict.regPrecision)} / ${pct(verdict.verdict.regRecall)}`} />
          <Metric label="Seesaw" value={verdict.seesawPassed ? "pass" : `blocked ${verdict.verdict.regressedSolvedTasks.length}`} danger={!verdict.seesawPassed} />
          {verdict.variant && <div className="md:col-span-3 flex items-center gap-1 text-amber-700 dark:text-amber-300"><RotateCcw className="h-3.5 w-3.5" />冲突编辑已 fork：{verdict.variant.variantId}</div>}
        </div>
      )}
      {error && <p className="mt-2 whitespace-pre-wrap rounded bg-red-50 p-2 text-red-700 dark:bg-red-950/30">{error}</p>}
    </section>
  );
}

function Field({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (value: string) => void; placeholder?: string }) {
  return <label className="block text-[11px] font-medium">{label}
    <textarea value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} rows={2} className="mt-1 w-full resize-y rounded border border-neutral-200 bg-white px-2 py-1 dark:border-neutral-700 dark:bg-neutral-900" />
  </label>;
}

function Metric({ label, value, danger }: { label: string; value: string; danger?: boolean }) {
  return <div><div className="text-[10px] text-neutral-500">{label}</div><div className={danger ? "font-semibold text-red-600" : "font-semibold"}>{value}</div></div>;
}

function splitList(value: string): string[] {
  return value.split(/[\n,]/).map((item) => item.trim()).filter(Boolean);
}

function pct(value: number): string {
  return `${Math.round(value * 100)}%`;
}
