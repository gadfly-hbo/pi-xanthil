import { FlaskConical, X, Loader2 } from "lucide-react";
import type { SkillEvalSet, SkillEvaluationDetail, SkillRegistryEntry } from "@/types";

function fmtPct(v: number | null): string {
  if (v === null || Number.isNaN(v)) return "—";
  return (v * 100).toFixed(1) + "%";
}

function fmtScore(v: number | null): string {
  if (v === null || Number.isNaN(v)) return "—";
  return v.toFixed(2);
}

interface Props {
  evalTarget: SkillRegistryEntry;
  evalSets: SkillEvalSet[];
  evalSetId: string;
  evalRepeat: number;
  evalRunning: boolean;
  lastEvaluation: { entryId: string; detail: SkillEvaluationDetail; metrics: { score: number | null; activationRate: number | null } } | null;
  onEvalSetIdChange: (id: string) => void;
  onEvalRepeatChange: (repeat: number) => void;
  onRunEval: () => void;
  onClose: () => void;
}

export function EvalSkillModal({
  evalTarget,
  evalSets,
  evalSetId,
  evalRepeat,
  evalRunning,
  lastEvaluation,
  onEvalSetIdChange,
  onEvalRepeatChange,
  onRunEval,
  onClose,
}: Props) {
  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 p-4">
      <div className="flex max-h-[90vh] w-full max-w-xl flex-col overflow-hidden rounded-lg border border-neutral-200 bg-white shadow-2xl dark:border-neutral-700 dark:bg-neutral-900">
        <div className="flex items-center justify-between border-b border-neutral-200 px-4 py-2 dark:border-neutral-800">
          <div className="flex items-center gap-2">
            <FlaskConical className="h-4 w-4 text-neutral-500" strokeWidth={1.75} />
            <h3 className="text-sm font-semibold text-neutral-800 dark:text-neutral-100">
              送评测：{evalTarget.name} v{evalTarget.version}
            </h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={evalRunning}
            className="rounded p-1 text-neutral-400 hover:bg-neutral-100 dark:hover:bg-neutral-800"
            title="关闭"
          >
            <X className="h-4 w-4" strokeWidth={1.75} />
          </button>
        </div>
        <div className="flex-1 overflow-auto p-4">
          <p className="text-[11.5px] text-neutral-500">
            构造 baseline（不加载 skill）vs candidate（加载本 skill）两组运行；评测结果会回写到 score / activationRate，
            并在实验室「skill_eval」子 tab 留档。
          </p>
          <div className="mt-3 grid grid-cols-2 gap-3">
            <label className="flex flex-col gap-1 text-[11.5px]">
              <span className="text-neutral-500">eval set</span>
              <select
                value={evalSetId}
                onChange={(e) => onEvalSetIdChange(e.target.value)}
                disabled={evalRunning}
                className="h-8 rounded border border-neutral-200 bg-white px-2 text-[11.5px] text-neutral-800 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100"
              >
                {evalSets.length === 0 && <option value="">使用内置默认任务</option>}
                {evalSets.map((set) => (
                  <option key={set.id} value={set.id}>
                    {set.name}（{set.tasks.length} 题）
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-[11.5px]">
              <span className="text-neutral-500">repeat</span>
              <input
                type="number"
                min={1}
                max={5}
                value={evalRepeat}
                onChange={(e) => onEvalRepeatChange(Math.max(1, Math.min(5, Number(e.target.value) || 1)))}
                disabled={evalRunning}
                className="h-8 rounded border border-neutral-200 bg-white px-2 text-[11.5px] text-neutral-800 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100"
              />
            </label>
          </div>

          {lastEvaluation && lastEvaluation.entryId === evalTarget.id && (
            <div className="mt-4 rounded-md border border-neutral-200 p-3 text-[11.5px] dark:border-neutral-800">
              <div className="font-semibold text-neutral-700 dark:text-neutral-200">最近一次评测结果</div>
              <div className="mt-2 grid grid-cols-3 gap-2">
                {lastEvaluation.detail.variantSummaries.map((v) => (
                  <div key={v.variantId} className="rounded border border-neutral-100 p-2 dark:border-neutral-800">
                    <div className="text-[10.5px] text-neutral-400">{v.variantLabel}</div>
                    <div className="mt-1 tabular-nums text-neutral-700 dark:text-neutral-200">
                      激活率 {fmtPct(v.activationRate)}
                    </div>
                    <div className="text-[10.5px] text-neutral-500">
                      成功 {v.success}/{v.total}
                    </div>
                  </div>
                ))}
              </div>
              <div className="mt-2 text-[10.5px] text-neutral-500">
                score = {fmtScore(lastEvaluation.metrics.score)} ·
                activationRate = {fmtPct(lastEvaluation.metrics.activationRate)}
              </div>
              <div className="mt-2 text-[10.5px] text-neutral-400">
                详情可前往「实验室 → skill_eval」查看 evaluationId={lastEvaluation.detail.evaluationId.slice(0, 8)}…
              </div>
            </div>
          )}
        </div>
        <div className="flex items-center justify-end gap-2 border-t border-neutral-200 px-4 py-2 dark:border-neutral-800">
          <button
            type="button"
            onClick={onClose}
            disabled={evalRunning}
            className="inline-flex h-7 items-center rounded border border-neutral-200 px-2.5 text-[11.5px] text-neutral-600 hover:bg-neutral-50 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800"
          >
            关闭
          </button>
          <button
            type="button"
            onClick={onRunEval}
            disabled={evalRunning}
            className="inline-flex h-7 items-center gap-1 rounded bg-neutral-800 px-2.5 text-[11.5px] text-white hover:bg-neutral-700 disabled:opacity-50 dark:bg-neutral-200 dark:text-neutral-900 dark:hover:bg-neutral-300"
          >
            {evalRunning ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FlaskConical className="h-3.5 w-3.5" strokeWidth={1.75} />}
            {evalRunning ? "评测中..." : "开始评测"}
          </button>
        </div>
      </div>
    </div>
  );
}
