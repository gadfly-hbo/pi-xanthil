import { ShieldCheck, AlertTriangle, X, CheckCircle2, Loader2 } from "lucide-react";
import type { SkillRegistryConflict, SkillRegistryEntry } from "@/types";
import { cn } from "@/lib/cn";
import { severityLabel, severityTone } from "@/lib/skillConflict";

/**
 * P1-B：采纳确认弹窗。串联三件事：
 * 1) 信任门——采纳 source∈{distilled,curated} 的自动产物时，必须勾选"已审阅 SKILL.md"才能提交
 *    （与 A 域 hasConfirmedReview 对齐：engine.ts:411）
 * 2) 冲突展示——展示冲突 API 返回的疑似重复（不阻断，仅提示，供人决策）
 * 3) 提交——PATCH status=active（仅 distilled/curated 时带 confirmed 标记，避免在其他来源虚构"已审阅"语义）
 */

interface Props {
  target: SkillRegistryEntry;
  conflicts: SkillRegistryConflict[];
  conflictsLoading: boolean;
  conflictsError: string;
  confirmed: boolean;
  onConfirmedChange: (v: boolean) => void;
  submitting: boolean;
  // P1-B：弹窗内独立 error 显示（与主面板 error 解耦，避免错误隐藏在用户视线外）
  adoptError: string;
  onSubmit: () => void;
  onCancel: () => void;
}

export function AdoptConfirmModal({
  target,
  conflicts,
  conflictsLoading,
  conflictsError,
  confirmed,
  onConfirmedChange,
  submitting,
  adoptError,
  onSubmit,
  onCancel,
}: Props) {
  const requiresConfirm = target.source === "distilled" || target.source === "curated";
  const canSubmit = !submitting && (!requiresConfirm || confirmed);
  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 p-4">
      <div className="flex max-h-[85vh] w-full max-w-lg flex-col overflow-hidden rounded-lg border border-neutral-200 bg-white shadow-2xl dark:border-neutral-700 dark:bg-neutral-900">
        <div className="flex items-center justify-between border-b border-neutral-200 px-4 py-2 dark:border-neutral-800">
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-4 w-4 text-emerald-600" strokeWidth={1.75} />
            <h3 className="text-sm font-semibold text-neutral-800 dark:text-neutral-100">
              采纳确认：{target.name} v{target.version}
            </h3>
          </div>
          <button
            type="button"
            onClick={onCancel}
            className="rounded p-1 text-neutral-400 hover:bg-neutral-100 dark:hover:bg-neutral-800"
            title="关闭"
          >
            <X className="h-4 w-4" strokeWidth={1.75} />
          </button>
        </div>
        <div className="flex-1 space-y-3 overflow-auto p-4 text-[12px]">
          <div className="flex items-center gap-2 text-neutral-600 dark:text-neutral-300">
            <span>当前状态：</span>
            <span className="rounded bg-neutral-100 px-1.5 py-0.5 text-[11px] dark:bg-neutral-800">
              {target.status}
            </span>
            <span>→</span>
            <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-[11px] text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300">
              active
            </span>
          </div>

          {requiresConfirm && (
            <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 dark:border-amber-800 dark:bg-amber-950/20">
              <div className="flex items-center gap-1.5 text-[11.5px] font-medium text-amber-700 dark:text-amber-300">
                <AlertTriangle className="h-3.5 w-3.5" strokeWidth={1.75} />
                信任门：来源「{target.source === "distilled" ? "蒸馏" : "策展"}」自动产物
              </div>
              <p className="mt-1 text-[11px] leading-relaxed text-amber-700/90 dark:text-amber-300/90">
                该 skill 由蒸馏/策展自动生成，可能含可执行指令。请审阅 SKILL.md 后再确认采纳。
              </p>
              <label className="mt-2 flex items-center gap-1.5 text-[11.5px] text-amber-800 dark:text-amber-200">
                <input
                  type="checkbox"
                  checked={confirmed}
                  onChange={(e) => onConfirmedChange(e.target.checked)}
                />
                我已审阅 SKILL.md，确认采纳
              </label>
            </div>
          )}

          <div>
            <div className="mb-1 flex items-center gap-1.5 text-[11.5px] font-medium text-neutral-700 dark:text-neutral-200">
              冲突检测
              {conflictsLoading && <Loader2 className="h-3 w-3 animate-spin" strokeWidth={1.75} />}
            </div>
            {conflictsError && (
              <p className="text-[11px] text-rose-600 dark:text-rose-300">冲突检测失败：{conflictsError}</p>
            )}
            {!conflictsLoading && !conflictsError && conflicts.length === 0 && (
              <p className="text-[11px] text-neutral-500">未发现疑似重复 skill。</p>
            )}
            {conflicts.length > 0 && (
              <div className="space-y-1">
                {conflicts.map((c) => (
                  <div
                    key={c.id}
                    className="flex items-center gap-2 rounded border border-amber-200 bg-amber-50/60 px-2 py-1 text-[11px] text-amber-700 dark:border-amber-800 dark:bg-amber-950/20 dark:text-amber-300"
                  >
                    <span className="font-medium">「{c.name}」</span>
                    <span className="font-mono">BM25 {c.score.toFixed(2)}</span>
                    <span className={cn("rounded px-1 py-0.5 text-[10px]", severityTone(c.severity))}>
                      {severityLabel(c.severity)}
                    </span>
                    <span className="ml-auto text-[10.5px] text-amber-600 dark:text-amber-400">
                      建议改归档或合并
                    </span>
                  </div>
                ))}
                <p className="text-[10.5px] text-neutral-500">
                  发现疑似重复 skill；不阻断采纳，由你决定继续或先归档/合并。
                </p>
              </div>
            )}
          </div>

          {adoptError && (
            <div className="rounded border border-rose-300 bg-rose-50 px-2.5 py-1.5 text-[11px] text-rose-700 dark:border-rose-800 dark:bg-rose-950/30 dark:text-rose-300">
              {adoptError}
            </div>
          )}
        </div>
        <div className="flex items-center justify-end gap-2 border-t border-neutral-200 px-4 py-2 dark:border-neutral-800">
          <button
            type="button"
            onClick={onCancel}
            disabled={submitting}
            className="inline-flex h-7 items-center rounded border border-neutral-200 px-2.5 text-[11.5px] text-neutral-600 hover:bg-neutral-50 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800"
          >
            取消
          </button>
          <button
            type="button"
            onClick={onSubmit}
            disabled={!canSubmit}
            className="inline-flex h-7 items-center gap-1 rounded bg-emerald-600 px-2.5 text-[11.5px] text-white hover:bg-emerald-500 disabled:opacity-50"
          >
            {submitting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" strokeWidth={1.75} />}
            确认采纳
          </button>
        </div>
      </div>
    </div>
  );
}
