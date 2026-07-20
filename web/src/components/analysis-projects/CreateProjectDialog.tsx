import { useState, useCallback } from "react";
import { X, Loader2, ChevronDown, ChevronRight } from "lucide-react";
import { cn } from "@/lib/cn";
import { SLUG_PATTERN, generateSlug, PROJECT_KIND_LABELS } from "./shared";
import type { ProjectKind } from "@/types/analysis-projects";

interface Props {
  open: boolean;
  onClose: () => void;
  onSubmit: (title: string, slug: string, requirement: string) => Promise<void>;
  creating: boolean;
  createError: string | null;
}

const KIND_OPTIONS: { value: ProjectKind; label: string }[] = [
  { value: "daily_analysis", label: PROJECT_KIND_LABELS.daily_analysis },
  { value: "goal_decomposition", label: PROJECT_KIND_LABELS.goal_decomposition },
  { value: "topic_research", label: PROJECT_KIND_LABELS.topic_research },
];

export function CreateProjectDialog({ open, onClose, onSubmit, creating, createError }: Props) {
  const [title, setTitle] = useState("");
  const [requirement, setRequirement] = useState("");
  const [kind, setKind] = useState<ProjectKind>("daily_analysis");
  const [slug, setSlug] = useState("");
  const [slugTouched, setSlugTouched] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);

  const effectiveSlug = slug.trim() || generateSlug(title) || `analysis-${Date.now()}`;
  const slugValid = SLUG_PATTERN.test(effectiveSlug);
  const titleValid = title.trim().length > 0;
  const requirementValid = requirement.trim().length > 0;
  const canSubmit = titleValid && requirementValid && slugValid && !creating;

  const handleTitleChange = useCallback((v: string) => {
    setTitle(v);
    if (!slugTouched) {
      setSlug(generateSlug(v));
    }
  }, [slugTouched]);

  const handleSubmit = useCallback(async () => {
    if (!canSubmit) return;
    await onSubmit(title.trim(), effectiveSlug, requirement.trim());
  }, [canSubmit, title, effectiveSlug, requirement, onSubmit]);

  const handleClose = useCallback(() => {
    setTitle("");
    setRequirement("");
    setKind("daily_analysis");
    setSlug("");
    setSlugTouched(false);
    setAdvancedOpen(false);
    onClose();
  }, [onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30">
      <div className="w-full max-w-lg rounded-lg border border-neutral-200 bg-white shadow-lg dark:border-neutral-800 dark:bg-neutral-900">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-neutral-100 px-4 py-3 dark:border-neutral-800">
          <span className="text-[13px] font-medium text-neutral-800 dark:text-neutral-200">
            新建分析工单
          </span>
          <button
            onClick={handleClose}
            className="rounded p-0.5 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-600 dark:hover:bg-neutral-800"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Body */}
        <div className="space-y-3 p-4">
          <div className="space-y-1">
            <label className="text-[11px] text-neutral-500">
              分析标题 <span className="text-red-400">*</span>
            </label>
            <input
              type="text"
              value={title}
              onChange={(e) => handleTitleChange(e.target.value)}
              placeholder="例如：Q3 用户留存分析"
              autoFocus
              className="w-full rounded-md border border-neutral-200 bg-neutral-50 px-3 py-1.5 text-[12px] text-neutral-800 placeholder:text-neutral-400 focus:border-blue-400 focus:outline-none dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-200"
            />
          </div>

          <div className="space-y-1">
            <label className="text-[11px] text-neutral-500">
              业务问题 / 分析需求 <span className="text-red-400">*</span>
            </label>
            <textarea
              value={requirement}
              onChange={(e) => setRequirement(e.target.value)}
              placeholder="描述分析目标、背景和需要回答的业务问题"
              rows={3}
              className="w-full resize-none rounded-md border border-neutral-200 bg-neutral-50 px-3 py-1.5 text-[12px] text-neutral-800 placeholder:text-neutral-400 focus:border-blue-400 focus:outline-none dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-200"
            />
          </div>

          <div className="space-y-1">
            <label className="text-[11px] text-neutral-500">
              分析类型 <span className="text-red-400">*</span>
            </label>
            <select
              value={kind}
              onChange={(e) => setKind(e.target.value as ProjectKind)}
              className="w-full rounded-md border border-neutral-200 bg-neutral-50 px-3 py-1.5 text-[12px] text-neutral-800 focus:border-blue-400 focus:outline-none dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-200"
            >
              {KIND_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>

          {/* Advanced settings */}
          <div>
            <button
              onClick={() => setAdvancedOpen(!advancedOpen)}
              className="flex items-center gap-1 text-[11px] text-neutral-500 hover:text-neutral-700 dark:hover:text-neutral-300"
            >
              {advancedOpen ? (
                <ChevronDown className="h-3 w-3" />
              ) : (
                <ChevronRight className="h-3 w-3" />
              )}
              高级设置
            </button>
            {advancedOpen && (
              <div className="mt-2 space-y-1">
                <label className="text-[11px] text-neutral-500">
                  技术标识 slug <span className="text-red-400">*</span>
                </label>
                <input
                  type="text"
                  value={slug}
                  onChange={(e) => {
                    setSlug(e.target.value);
                    setSlugTouched(true);
                  }}
                  placeholder="q3-user-retention"
                  className={cn(
                    "w-full rounded-md border bg-neutral-50 px-3 py-1.5 text-[12px] font-mono text-neutral-800 placeholder:text-neutral-400 focus:outline-none dark:bg-neutral-800 dark:text-neutral-200",
                    slug && !slugValid
                      ? "border-red-300 focus:border-red-400 dark:border-red-700"
                      : "border-neutral-200 focus:border-blue-400 dark:border-neutral-700",
                  )}
                />
                {slug && !slugValid && (
                  <p className="text-[10px] text-red-500">
                    仅允许小写字母、数字和连字符，且不能以连字符开头或结尾
                  </p>
                )}
                {!slugTouched && title && (
                  <p className="text-[10px] text-neutral-400">
                    已自动生成标识: {effectiveSlug}
                  </p>
                )}
              </div>
            )}
          </div>

          {createError && (
            <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-[11px] text-red-600 dark:border-red-800 dark:bg-red-950/30 dark:text-red-400">
              {createError}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 border-t border-neutral-100 px-4 py-3 dark:border-neutral-800">
          <button
            onClick={handleClose}
            className="rounded-md px-3 py-1.5 text-[12px] text-neutral-600 hover:bg-neutral-100 dark:text-neutral-400 dark:hover:bg-neutral-800"
          >
            取消
          </button>
          <button
            onClick={handleSubmit}
            disabled={!canSubmit}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-md px-4 py-1.5 text-[12px] font-medium transition-colors",
              canSubmit
                ? "bg-blue-600 text-white hover:bg-blue-700"
                : "bg-neutral-100 text-neutral-400 cursor-not-allowed dark:bg-neutral-800 dark:text-neutral-600",
            )}
          >
            {creating && <Loader2 className="h-3 w-3 animate-spin" />}
            创建工单
          </button>
        </div>
      </div>
    </div>
  );
}
