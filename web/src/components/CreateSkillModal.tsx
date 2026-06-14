import { Sparkles, X, Save, Loader2, AlertTriangle } from "lucide-react";
import type { SkillRegistryConflict, SkillSource, SkillStatus } from "@/types";
import { cn } from "@/lib/cn";
import { severityLabel, severityTone } from "@/lib/skillConflict";

export interface CreateDraft {
  slug: string;
  name: string;
  source: SkillSource;
  status: SkillStatus;
  reason: string;
  content: string;
  supersedesId: string | null;
  baseVersion: number;
}

interface Props {
  editing: { id: string; name: string; slug: string; source: SkillSource; version: number } | null;
  draft: CreateDraft;
  submitting: boolean;
  onDraftChange: (draft: CreateDraft) => void;
  onSubmit: () => void;
  onCancel: () => void;
  // P1-B：冲突展示（不阻断；父组件在 submit/blur 时查询后传入）
  conflicts?: SkillRegistryConflict[];
  conflictsLoading?: boolean;
  onCheckConflicts?: () => void;
}

export function CreateSkillModal({
  editing,
  draft,
  submitting,
  onDraftChange,
  onSubmit,
  onCancel,
  conflicts = [],
  conflictsLoading = false,
  onCheckConflicts,
}: Props) {
  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 p-4">
      <div className="flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-lg border border-neutral-200 bg-white shadow-2xl dark:border-neutral-700 dark:bg-neutral-900">
        <div className="flex items-center justify-between border-b border-neutral-200 px-4 py-2 dark:border-neutral-800">
          <div className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-amber-500" strokeWidth={1.75} />
            <h3 className="text-sm font-semibold text-neutral-800 dark:text-neutral-100">
              {editing ? `版本更新：${editing.name} v${String(draft.baseVersion + 1)}` : "新建 skill"}
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
        <div className="flex-1 overflow-auto p-4">
          {/* P1-B：冲突展示 banner（不阻断，仅提示） */}
          {conflictsLoading && (
            <div className="mb-3 flex items-center gap-1.5 rounded-md border border-amber-200 bg-amber-50 px-2.5 py-1.5 text-[11px] text-amber-700 dark:border-amber-800 dark:bg-amber-950/20 dark:text-amber-300">
              <Loader2 className="h-3 w-3 animate-spin" strokeWidth={1.75} />
              检查相似 skill 中…
            </div>
          )}
          {conflicts.length > 0 && (
            <div className="mb-3 space-y-1 rounded-md border border-amber-200 bg-amber-50 px-2.5 py-2 dark:border-amber-800 dark:bg-amber-950/20">
              <div className="flex items-center gap-1 text-[11px] font-medium text-amber-700 dark:text-amber-300">
                <AlertTriangle className="h-3.5 w-3.5" strokeWidth={1.75} />
                疑似与以下 skill 重复：
              </div>
              {conflicts.map((c) => (
                <div key={c.id} className="flex items-center gap-2 text-[10.5px] text-amber-600 dark:text-amber-400">
                  <span>「{c.name}」</span>
                  <span className="font-mono">BM25 {c.score.toFixed(2)}</span>
                  <span className={cn("rounded px-1 py-0.5 text-[10px]", severityTone(c.severity))}>
                    {severityLabel(c.severity)}
                  </span>
                </div>
              ))}
              <p className="mt-0.5 text-[10.5px] text-amber-600 dark:text-amber-400">
                建议改为「该 skill 的新版本」或合并内容；继续提交也可，由你决策。
              </p>
            </div>
          )}
          <div className="grid grid-cols-2 gap-3">
            <label className="flex flex-col gap-1 text-[11.5px]">
              <span className="text-neutral-500">slug（唯一，目录名）</span>
              <input
                type="text"
                value={draft.slug}
                disabled={!!editing}
                onChange={(e) => onDraftChange({ ...draft, slug: e.target.value })}
                placeholder="example-skill"
                className="h-8 rounded border border-neutral-200 bg-white px-2 font-mono text-[11.5px] text-neutral-800 disabled:opacity-60 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100"
              />
            </label>
            <label className="flex flex-col gap-1 text-[11.5px]">
              <span className="text-neutral-500">name（显示名）</span>
              <input
                type="text"
                value={draft.name}
                onChange={(e) => onDraftChange({ ...draft, name: e.target.value })}
                placeholder="Example Skill"
                className="h-8 rounded border border-neutral-200 bg-white px-2 text-[11.5px] text-neutral-800 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100"
              />
            </label>
            <label className="flex flex-col gap-1 text-[11.5px]">
              <span className="text-neutral-500">来源</span>
              <select
                value={draft.source}
                onChange={(e) => onDraftChange({ ...draft, source: e.target.value as SkillSource })}
                className="h-8 rounded border border-neutral-200 bg-white px-2 text-[11.5px] text-neutral-800 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100"
              >
                <option value="manual">手写</option>
                <option value="distilled">蒸馏</option>
                <option value="curated">策展</option>
                <option value="imported">导入</option>
              </select>
            </label>
            <label className="flex flex-col gap-1 text-[11.5px]">
              <span className="text-neutral-500">初始状态</span>
              <select
                value={draft.status}
                onChange={(e) => onDraftChange({ ...draft, status: e.target.value as SkillStatus })}
                className="h-8 rounded border border-neutral-200 bg-white px-2 text-[11.5px] text-neutral-800 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100"
              >
                <option value="candidate">候选</option>
                <option value="draft">草稿</option>
                <option value="active">采纳</option>
              </select>
            </label>
          </div>

          {editing && (
            <label className="mt-3 flex flex-col gap-1 text-[11.5px]">
              <span className="text-neutral-500">变更原因（追加为 SKILL.md 末尾注释，便于回滚溯源）</span>
              <textarea
                value={draft.reason}
                onChange={(e) => onDraftChange({ ...draft, reason: e.target.value })}
                placeholder="例：补充负样本案例 / 收紧触发条件 / 修正错误描述"
                rows={2}
                className="rounded border border-neutral-200 bg-white px-2 py-1.5 text-[11.5px] text-neutral-800 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100"
              />
            </label>
          )}

          <label className="mt-3 flex flex-col gap-1 text-[11.5px]">
            <span className="text-neutral-500">SKILL.md 内容（首部必须 frontmatter 含 name + description）</span>
            <textarea
              value={draft.content}
              onChange={(e) => onDraftChange({ ...draft, content: e.target.value })}
              rows={14}
              className="rounded border border-neutral-200 bg-white px-2 py-1.5 font-mono text-[11px] text-neutral-800 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100"
            />
          </label>
        </div>
        <div className="flex items-center justify-end gap-2 border-t border-neutral-200 px-4 py-2 dark:border-neutral-800">
          {onCheckConflicts && (
            <button
              type="button"
              onClick={onCheckConflicts}
              disabled={submitting || conflictsLoading || !draft.content.trim()}
              className="mr-auto inline-flex h-7 items-center gap-1 rounded border border-amber-300 px-2 text-[11.5px] text-amber-700 hover:bg-amber-50 disabled:opacity-50 dark:border-amber-800 dark:text-amber-300 dark:hover:bg-amber-950/40"
              title="基于当前内容检测疑似重复 skill"
            >
              {conflictsLoading ? <Loader2 className="h-3 w-3 animate-spin" /> : <AlertTriangle className="h-3 w-3" strokeWidth={1.75} />}
              检测冲突
            </button>
          )}
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
            disabled={submitting}
            className="inline-flex h-7 items-center gap-1 rounded bg-neutral-800 px-2.5 text-[11.5px] text-white hover:bg-neutral-700 disabled:opacity-50 dark:bg-neutral-200 dark:text-neutral-900 dark:hover:bg-neutral-300"
          >
            {submitting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" strokeWidth={1.75} />}
            {editing ? "保存为新版本" : "创建"}
          </button>
        </div>
      </div>
    </div>
  );
}
