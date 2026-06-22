import { useEffect, useMemo, useState } from "react";
import { ChevronDown, Library, Search, X } from "lucide-react";
import { api } from "@/lib/api";
import type { PromptTemplate } from "@/types";

const PROMPT_VARIABLE_RE = /\{\{\s*([a-zA-Z_][\w.-]*)\s*\}\}/g;

interface Props {
  workspaceId: string | null;
  onInsert: (body: string) => void;
}

export function extractPromptVariables(body: string): string[] {
  const variables: string[] = [];
  const seen = new Set<string>();
  for (const match of body.matchAll(PROMPT_VARIABLE_RE)) {
    const name = match[1];
    if (name && !seen.has(name)) {
      seen.add(name);
      variables.push(name);
    }
  }
  return variables;
}

export function fillPromptVariables(body: string, values: Record<string, string>): string {
  return body.replace(PROMPT_VARIABLE_RE, (_placeholder, name: string) => values[name] ?? "");
}

export function PromptSelector({ workspaceId, onInsert }: Props) {
  const [templates, setTemplates] = useState<PromptTemplate[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("");
  const [tag, setTag] = useState("");
  const [selectedTemplate, setSelectedTemplate] = useState<PromptTemplate | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState("");

  useEffect(() => {
    setTemplates([]);
    setError("");
    setOpen(false);
    setSelectedTemplate(null);
    if (!workspaceId) return;
    let cancelled = false;
    setLoading(true);
    api.listPromptTemplates(workspaceId)
      .then((items) => {
        if (!cancelled) setTemplates(items);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [workspaceId]);

  const categories = useMemo(
    () => [...new Set(templates.map((template) => template.category).filter(Boolean))].sort((a, b) => a.localeCompare(b, "zh")),
    [templates],
  );
  const tags = useMemo(
    () => [...new Set(templates.flatMap((template) => template.tags))].sort((a, b) => a.localeCompare(b, "zh")),
    [templates],
  );
  const filtered = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return templates.filter((template) => {
      if (category && template.category !== category) return false;
      if (tag && !template.tags.includes(tag)) return false;
      if (!normalizedQuery) return true;
      return template.title.toLowerCase().includes(normalizedQuery)
        || template.category.toLowerCase().includes(normalizedQuery)
        || template.tags.some((item) => item.toLowerCase().includes(normalizedQuery))
        || template.body.toLowerCase().includes(normalizedQuery);
    });
  }, [category, query, tag, templates]);
  const selectedVariables = useMemo(
    () => selectedTemplate ? extractPromptVariables(selectedTemplate.body) : [],
    [selectedTemplate],
  );

  function selectTemplate(template: PromptTemplate) {
    const variables = extractPromptVariables(template.body);
    setOpen(false);
    if (variables.length === 0) {
      onInsert(template.body);
      return;
    }
    setSelectedTemplate(template);
    setValues(Object.fromEntries(variables.map((name) => [name, ""])));
    setFormError("");
  }

  function closeDialog() {
    setSelectedTemplate(null);
    setValues({});
    setFormError("");
  }

  function submitVariables() {
    if (!selectedTemplate) return;
    const missing = selectedVariables.find((name) => !values[name]?.trim());
    if (missing) {
      setFormError(`请填写 ${missing}`);
      return;
    }
    onInsert(fillPromptVariables(selectedTemplate.body, values));
    closeDialog();
  }

  return (
    <div className="relative">
      <button
        type="button"
        disabled={!workspaceId}
        onClick={() => setOpen((current) => !current)}
        className="inline-flex h-7 items-center gap-1 rounded-md px-1.5 text-[11.5px] text-neutral-500 hover:bg-neutral-100 disabled:cursor-not-allowed disabled:opacity-40 dark:text-neutral-400 dark:hover:bg-neutral-800"
        title={workspaceId ? "从 Prompt 库插入模板" : "先选择或新建工作区"}
      >
        <Library className="h-3.5 w-3.5" strokeWidth={1.75} />
        <span>Prompt 库</span>
        <ChevronDown className="h-3 w-3" strokeWidth={1.75} />
      </button>

      {open && workspaceId && (
        <div className="absolute bottom-9 left-0 z-30 w-[360px] rounded-lg border border-neutral-200 bg-white p-2 shadow-xl dark:border-neutral-700 dark:bg-neutral-900">
          <div className="relative">
            <Search className="absolute left-2 top-2 h-3.5 w-3.5 text-neutral-400" />
            <input
              autoFocus
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="搜索 title、category、tag 或正文"
              className="h-8 w-full rounded-md border border-neutral-200 bg-transparent pl-7 pr-2 text-[11.5px] outline-none focus:border-neutral-400 dark:border-neutral-700"
            />
          </div>
          <div className="mt-2 flex gap-2">
            <select
              value={category}
              onChange={(event) => setCategory(event.target.value)}
              className="h-7 min-w-0 flex-1 rounded-md border border-neutral-200 bg-transparent px-1.5 text-[11px] outline-none dark:border-neutral-700"
            >
              <option value="">全部分类</option>
              {categories.map((item) => <option key={item} value={item}>{item}</option>)}
            </select>
            <select
              value={tag}
              onChange={(event) => setTag(event.target.value)}
              className="h-7 min-w-0 flex-1 rounded-md border border-neutral-200 bg-transparent px-1.5 text-[11px] outline-none dark:border-neutral-700"
            >
              <option value="">全部标签</option>
              {tags.map((item) => <option key={item} value={item}>{item}</option>)}
            </select>
          </div>
          <div className="mt-2 max-h-64 overflow-y-auto">
            {loading && <p className="px-2 py-2 text-[11px] text-neutral-400">正在读取 prompt 模板...</p>}
            {error && <p className="px-2 py-2 text-[11px] text-red-500">加载失败：{error}</p>}
            {!loading && !error && filtered.length === 0 && (
              <p className="px-2 py-2 text-[11px] text-neutral-400">没有匹配的 prompt 模板。</p>
            )}
            {!loading && !error && filtered.map((template) => {
              const variableCount = extractPromptVariables(template.body).length;
              return (
                <button
                  key={template.id}
                  type="button"
                  onClick={() => selectTemplate(template)}
                  className="flex w-full items-start gap-2 rounded-md px-2 py-2 text-left hover:bg-neutral-100 dark:hover:bg-neutral-800"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[12px] font-medium text-neutral-800 dark:text-neutral-100">{template.title}</span>
                    <span className="mt-0.5 block truncate text-[11px] text-neutral-400">
                      {template.category || "未分类"}{template.workspaceId === null ? " · 全局" : ""}
                    </span>
                  </span>
                  <span className="shrink-0 rounded bg-neutral-100 px-1.5 py-0.5 text-[10px] text-neutral-500 dark:bg-neutral-800 dark:text-neutral-400">
                    {variableCount} 变量
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {selectedTemplate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/35 px-4">
          <div className="w-full max-w-[520px] rounded-lg border border-neutral-200 bg-white shadow-xl dark:border-neutral-800 dark:bg-neutral-950">
            <div className="flex items-start gap-3 border-b border-neutral-200 px-4 py-3 dark:border-neutral-800">
              <div className="min-w-0 flex-1">
                <div className="text-[13px] font-medium text-neutral-900 dark:text-neutral-100">变量填充 · {selectedTemplate.title}</div>
                <div className="mt-1 text-[12px] text-neutral-500 dark:text-neutral-400">填充后插入输入框，不会自动发送。</div>
              </div>
              <button type="button" onClick={closeDialog} className="inline-flex h-7 w-7 items-center justify-center rounded-md text-neutral-500 hover:bg-neutral-100 dark:text-neutral-400 dark:hover:bg-neutral-800" title="关闭">
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
            <form
              onSubmit={(event) => {
                event.preventDefault();
                submitVariables();
              }}
              className="space-y-3 px-4 py-4"
            >
              {selectedVariables.map((name) => (
                <label key={name} className="block text-[12px] text-neutral-600 dark:text-neutral-300">
                  <span className="font-mono">{name}</span><span className="text-red-500"> *</span>
                  <input
                    autoFocus={selectedVariables[0] === name}
                    value={values[name] ?? ""}
                    onChange={(event) => {
                      setValues((current) => ({ ...current, [name]: event.target.value }));
                      setFormError("");
                    }}
                    className="mt-1 w-full rounded-md border border-neutral-200 bg-white px-2 py-1.5 text-[12px] outline-none focus:border-neutral-400 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100"
                  />
                </label>
              ))}
              {formError && (
                <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-[12px] text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">{formError}</div>
              )}
              <div className="flex justify-end gap-2 pt-1">
                <button type="button" onClick={closeDialog} className="rounded-md border border-neutral-200 px-3 py-1.5 text-[12px] text-neutral-600 hover:bg-neutral-50 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-900">取消</button>
                <button type="submit" className="rounded-md bg-neutral-900 px-3 py-1.5 text-[12px] text-white hover:bg-neutral-700 dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-white">插入输入框</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
