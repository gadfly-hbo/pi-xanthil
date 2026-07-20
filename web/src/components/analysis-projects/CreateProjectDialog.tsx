import { useState, useCallback } from "react";
import { X, Loader2 } from "lucide-react";
import { cn } from "@/lib/cn";
import { SLUG_PATTERN, generateSlug } from "./shared";

interface Props {
  open: boolean;
  onClose: () => void;
  onSubmit: (title: string, slug: string) => Promise<void>;
  creating: boolean;
  createError: string | null;
}

export function CreateProjectDialog({ open, onClose, onSubmit, creating, createError }: Props) {
  const [title, setTitle] = useState("");
  const [slug, setSlug] = useState("");
  const [slugTouched, setSlugTouched] = useState(false);

  const effectiveSlug = slug.trim() || generateSlug(title) || `analysis-${Date.now()}`;
  const slugValid = SLUG_PATTERN.test(effectiveSlug);
  const titleValid = title.trim().length > 0;
  const canSubmit = titleValid && slugValid && !creating;

  const handleTitleChange = useCallback((v: string) => {
    setTitle(v);
    if (!slugTouched) {
      setSlug(generateSlug(v));
    }
  }, [slugTouched]);

  const handleSubmit = useCallback(async () => {
    if (!canSubmit) return;
    await onSubmit(title.trim(), effectiveSlug);
  }, [canSubmit, title, effectiveSlug, onSubmit]);

  const handleClose = useCallback(() => {
    setTitle("");
    setSlug("");
    setSlugTouched(false);
    onClose();
  }, [onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30">
      <div className="w-full max-w-md rounded-lg border border-neutral-200 bg-white shadow-lg dark:border-neutral-800 dark:bg-neutral-900">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-neutral-100 px-4 py-3 dark:border-neutral-800">
          <span className="text-[13px] font-medium text-neutral-800 dark:text-neutral-200">
            新建分析项目
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
              业务标题 <span className="text-red-400">*</span>
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
              技术标识 <span className="text-red-400">*</span>
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
            创建
          </button>
        </div>
      </div>
    </div>
  );
}
