import { useEffect, useState } from "react";
import { X } from "lucide-react";
import type { PromptDraft, PromptTemplateInput } from "@/types";

interface Props {
  draft: PromptDraft;
  saving: boolean;
  error: string;
  onCancel: () => void;
  onConfirm: (input: PromptTemplateInput) => void;
}

interface FormState {
  title: string;
  category: string;
  body: string;
  variables: string;
  tags: string;
}

export function PromptDistillDialog({ draft, saving, error, onCancel, onConfirm }: Props) {
  const [form, setForm] = useState<FormState>(() => toForm(draft));
  const [validationError, setValidationError] = useState("");

  useEffect(() => {
    setForm(toForm(draft));
    setValidationError("");
  }, [draft]);

  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((current) => ({ ...current, [key]: value }));
    setValidationError("");
  }

  function submit() {
    const title = form.title.trim();
    const body = form.body.trim();
    if (!title) {
      setValidationError("title 必填");
      return;
    }
    if (!body) {
      setValidationError("body 必填");
      return;
    }
    onConfirm({
      title,
      category: form.category.trim(),
      body,
      variables: parseCsv(form.variables),
      tags: parseCsv(form.tags),
    });
  }

  const inputClass = "mt-1 w-full rounded-md border border-neutral-200 bg-white px-2 py-1.5 text-[12px] outline-none focus:border-neutral-400 disabled:opacity-60 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/35 px-4">
      <div className="w-full max-w-[620px] rounded-lg border border-neutral-200 bg-white shadow-xl dark:border-neutral-800 dark:bg-neutral-950">
        <div className="flex items-start gap-3 border-b border-neutral-200 px-4 py-3 dark:border-neutral-800">
          <div className="min-w-0 flex-1">
            <div className="text-[13px] font-medium text-neutral-900 dark:text-neutral-100">确认沉淀 Prompt</div>
            <div className="mt-1 text-[12px] text-neutral-500 dark:text-neutral-400">检查参数化结果；确认后才写入当前工作区 Prompt 库。</div>
          </div>
          <button type="button" onClick={onCancel} disabled={saving} className="inline-flex h-7 w-7 items-center justify-center rounded-md text-neutral-500 hover:bg-neutral-100 disabled:opacity-40 dark:text-neutral-400 dark:hover:bg-neutral-800" title="关闭">
            <X className="h-3.5 w-3.5" />
          </button>
        </div>

        <form
          onSubmit={(event) => {
            event.preventDefault();
            submit();
          }}
          className="max-h-[75vh] space-y-3 overflow-y-auto px-4 py-4"
        >
          <div className="grid grid-cols-2 gap-3">
            <label className="block text-[12px] text-neutral-600 dark:text-neutral-300">
              title <span className="text-red-500">*</span>
              <input autoFocus value={form.title} onChange={(event) => update("title", event.target.value)} disabled={saving} className={inputClass} />
            </label>
            <label className="block text-[12px] text-neutral-600 dark:text-neutral-300">
              category
              <input value={form.category} onChange={(event) => update("category", event.target.value)} disabled={saving} className={inputClass} />
            </label>
          </div>
          <label className="block text-[12px] text-neutral-600 dark:text-neutral-300">
            body <span className="text-red-500">*</span>
            <textarea value={form.body} onChange={(event) => update("body", event.target.value)} disabled={saving} rows={12} className={`${inputClass} resize-y font-mono leading-5`} />
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="block text-[12px] text-neutral-600 dark:text-neutral-300">
              variables（逗号分隔）
              <input value={form.variables} onChange={(event) => update("variables", event.target.value)} disabled={saving} className={`${inputClass} font-mono`} />
            </label>
            <label className="block text-[12px] text-neutral-600 dark:text-neutral-300">
              tags（逗号分隔）
              <input value={form.tags} onChange={(event) => update("tags", event.target.value)} disabled={saving} className={inputClass} />
            </label>
          </div>

          {(validationError || error) && (
            <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-[12px] text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
              {validationError || error}
            </div>
          )}
          <div className="flex justify-end gap-2 pt-1">
            <button type="button" onClick={onCancel} disabled={saving} className="rounded-md border border-neutral-200 px-3 py-1.5 text-[12px] text-neutral-600 hover:bg-neutral-50 disabled:opacity-40 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-900">取消</button>
            <button type="submit" disabled={saving} className="rounded-md bg-neutral-900 px-3 py-1.5 text-[12px] text-white hover:bg-neutral-700 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-white">
              {saving ? "正在保存…" : "确认入库"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function toForm(draft: PromptDraft): FormState {
  return {
    title: draft.title,
    category: draft.category,
    body: draft.body,
    variables: draft.variables.join(", "),
    tags: draft.tags.join(", "),
  };
}

function parseCsv(value: string): string[] {
  return [...new Set(value.split(",").map((item) => item.trim()).filter(Boolean))];
}
