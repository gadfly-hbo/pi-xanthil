import { useCallback, useEffect, useMemo, useState } from "react";
import { Building2, CheckCircle2, Pencil, Plus, RefreshCw, Save, Trash2, X } from "lucide-react";
import { api } from "@/lib/api";
import type { BusinessContext, BusinessContextCategory } from "@/types";

const CATEGORIES: { id: BusinessContextCategory; label: string; hint: string }[] = [
  { id: "org", label: "组织/主体", hint: "公司/部门是谁、所处行业、规模、商业模式" },
  { id: "status", label: "业务现状", hint: "当前阶段、核心矛盾、近期变化（如刚调价、刚换系统）" },
  { id: "glossary", label: "术语/口径", hint: "内部黑话、指标的业务含义、特殊定义" },
  { id: "constraint", label: "约束/红线", hint: "哪些不能做、合规要求、数据敏感点" },
  { id: "history", label: "历史/背景", hint: "关键事件、已知结论、踩过的坑" },
  { id: "goal", label: "目标/期望", hint: "这次分析/决策真正想解决什么" },
];

const CATEGORY_LABEL: Record<BusinessContextCategory, string> = Object.fromEntries(
  CATEGORIES.map((c) => [c.id, c.label]),
) as Record<BusinessContextCategory, string>;

interface EditDraft {
  category: BusinessContextCategory;
  title: string;
  content: string;
}

const EMPTY_DRAFT: EditDraft = { category: "status", title: "", content: "" };

export function BusinessContextPane({ workspaceId, onChanged }: { workspaceId: string | null; onChanged?: () => void }) {
  const [items, setItems] = useState<BusinessContext[]>([]);
  const [promptInfo, setPromptInfo] = useState<{ prompt: string; count: number; updatedAt: number | null }>({ prompt: "", count: 0, updatedAt: null });
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<EditDraft>(EMPTY_DRAFT);
  const [creating, setCreating] = useState(false);
  const [newDraft, setNewDraft] = useState<EditDraft>(EMPTY_DRAFT);

  const refresh = useCallback(async () => {
    if (!workspaceId) return;
    setLoading(true);
    setError("");
    try {
      const [nextItems, nextPrompt] = await Promise.all([
        api.listBusinessContexts(workspaceId),
        api.getBusinessContextPrompt(workspaceId),
      ]);
      setItems(nextItems);
      setPromptInfo(nextPrompt);
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }, [workspaceId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const refreshPrompt = async () => {
    if (workspaceId) setPromptInfo(await api.getBusinessContextPrompt(workspaceId));
    onChanged?.();
  };

  const grouped = useMemo(() => {
    return CATEGORIES.map((cat) => ({ cat, list: items.filter((item) => item.category === cat.id) }));
  }, [items]);

  const toggle = async (item: BusinessContext) => {
    await api.updateBusinessContextEnabled(item.id, !item.enabled);
    setItems((current) => current.map((it) => it.id === item.id ? { ...it, enabled: !it.enabled, updatedAt: Date.now() } : it));
    await refreshPrompt();
  };

  const startEdit = (item: BusinessContext) => {
    setCreating(false);
    setEditingId(item.id);
    setDraft({ category: item.category, title: item.title, content: item.content });
  };

  const saveEdit = async (id: string) => {
    if (!draft.title.trim()) return;
    const payload = { category: draft.category, title: draft.title.trim(), content: draft.content.trim() };
    await api.updateBusinessContext(id, payload);
    setItems((current) => current.map((item) => item.id === id ? { ...item, ...payload, updatedAt: Date.now() } : item));
    setEditingId(null);
    await refreshPrompt();
  };

  const startCreate = (category: BusinessContextCategory) => {
    setEditingId(null);
    setCreating(true);
    setNewDraft({ ...EMPTY_DRAFT, category });
  };

  const saveCreate = async () => {
    if (!workspaceId || !newDraft.title.trim()) return;
    const created = await api.createBusinessContext(workspaceId, { category: newDraft.category, title: newDraft.title.trim(), content: newDraft.content.trim() });
    setItems((current) => [created, ...current]);
    setCreating(false);
    setNewDraft(EMPTY_DRAFT);
    await refreshPrompt();
  };

  const remove = async (item: BusinessContext) => {
    if (!window.confirm(`删除业务环境「${item.title}」？此操作不可恢复。`)) return;
    await api.deleteBusinessContext(item.id);
    setItems((current) => current.filter((it) => it.id !== item.id));
    if (editingId === item.id) setEditingId(null);
    await refreshPrompt();
  };

  const copyPrompt = async () => {
    if (!promptInfo.prompt) return;
    await navigator.clipboard.writeText(promptInfo.prompt);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1200);
  };

  const draftFields = (value: EditDraft, onChange: (next: EditDraft) => void, hint: string) => (
    <div className="space-y-2">
      <div className="flex gap-2">
        <select
          value={value.category}
          onChange={(event) => onChange({ ...value, category: event.target.value as BusinessContextCategory })}
          className="rounded-md border border-neutral-200 bg-transparent px-2 py-1.5 text-[12px] dark:border-neutral-700"
        >
          {CATEGORIES.map((cat) => <option key={cat.id} value={cat.id}>{cat.label}</option>)}
        </select>
        <input
          value={value.title}
          onChange={(event) => onChange({ ...value, title: event.target.value })}
          placeholder="标题（一句话概括这条业务事实）"
          className="flex-1 rounded-md border border-neutral-200 bg-transparent px-2 py-1.5 text-[13px] dark:border-neutral-700"
        />
      </div>
      <textarea
        value={value.content}
        onChange={(event) => onChange({ ...value, content: event.target.value })}
        placeholder={hint}
        className="h-24 w-full resize-none rounded-md border border-neutral-200 bg-transparent px-2 py-1.5 text-[12px] leading-5 dark:border-neutral-700"
      />
    </div>
  );

  return (
    <div className="flex min-h-0 flex-1 overflow-auto bg-neutral-50/60 p-5 dark:bg-neutral-950">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-4">
        <div className="flex items-start justify-between gap-4 rounded-xl border border-neutral-200 bg-white p-4 shadow-sm dark:border-neutral-800 dark:bg-neutral-900">
          <div>
            <h1 className="flex items-center gap-2 text-base font-semibold text-neutral-900 dark:text-neutral-100"><Building2 className="h-4 w-4" /> 业务环境</h1>
            <p className="mt-1 text-[12.5px] text-neutral-500">补齐 agent 不知道、但做决策必须知道的真实业务背景。启用条目会随「记忆/标准」一并注入到对话与工作流。</p>
          </div>
          <div className="flex shrink-0 gap-2">
            <button onClick={copyPrompt} disabled={!promptInfo.prompt} className="rounded-md border border-neutral-200 px-3 py-2 text-[12px] disabled:opacity-50 dark:border-neutral-700">{copied ? "已复制" : "复制 prompt"}</button>
            <button onClick={refresh} disabled={!workspaceId || loading} className="inline-flex items-center gap-1.5 rounded-md border border-neutral-200 px-3 py-2 text-[12px] disabled:opacity-50 dark:border-neutral-700">
              <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} /> 刷新
            </button>
          </div>
        </div>

        {error && <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-[12px] text-red-600 dark:border-red-900 dark:bg-red-950/30">{error}</div>}

        <div className="rounded-xl border border-neutral-200 bg-white p-4 shadow-sm dark:border-neutral-800 dark:bg-neutral-900">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-[13px] font-semibold text-neutral-900 dark:text-neutral-100">注入的 system prompt 片段</h2>
            <span className="text-[11px] text-neutral-400">启用 {promptInfo.count} 条</span>
          </div>
          <pre className="mt-3 max-h-56 overflow-auto whitespace-pre-wrap rounded-lg bg-neutral-50 p-3 text-[12px] leading-5 text-neutral-700 dark:bg-neutral-950 dark:text-neutral-300">{promptInfo.prompt || "暂无启用的业务环境条目"}</pre>
        </div>

        {creating && (
          <div className="rounded-xl border border-amber-300 bg-amber-50/50 p-4 shadow-sm dark:border-amber-900 dark:bg-amber-950/20">
            {draftFields(newDraft, setNewDraft, CATEGORIES.find((c) => c.id === newDraft.category)?.hint ?? "")}
            <div className="mt-2 flex justify-end gap-2">
              <button onClick={() => void saveCreate()} disabled={!newDraft.title.trim()} className="inline-flex items-center gap-1 rounded-md bg-neutral-900 px-2.5 py-1.5 text-[12px] text-white disabled:opacity-50 dark:bg-neutral-100 dark:text-neutral-900"><Save className="h-3.5 w-3.5" /> 保存</button>
              <button onClick={() => setCreating(false)} className="inline-flex items-center gap-1 rounded-md border border-neutral-200 px-2.5 py-1.5 text-[12px] dark:border-neutral-700"><X className="h-3.5 w-3.5" /> 取消</button>
            </div>
          </div>
        )}

        <div className="space-y-5">
          {grouped.map(({ cat, list }) => (
            <div key={cat.id}>
              <div className="mb-2 flex items-center justify-between gap-2">
                <div className="flex items-baseline gap-2">
                  <h2 className="text-[13px] font-semibold text-neutral-700 dark:text-neutral-200">{cat.label}</h2>
                  <span className="text-[11px] text-neutral-400">{list.length}</span>
                </div>
                <button onClick={() => startCreate(cat.id)} className="inline-flex items-center gap-1 rounded-md border border-neutral-200 px-2 py-1 text-[11.5px] text-neutral-500 hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-800"><Plus className="h-3.5 w-3.5" /> 添加</button>
              </div>
              {list.length === 0 ? (
                <div className="rounded-lg border border-dashed border-neutral-200 bg-white/40 px-3 py-3 text-[12px] text-neutral-400 dark:border-neutral-800 dark:bg-neutral-900/30">{cat.hint}</div>
              ) : (
                <div className="space-y-2">
                  {list.map((item) => {
                    const editing = editingId === item.id;
                    return (
                      <div key={item.id} className="rounded-xl border border-neutral-200 bg-white p-3.5 shadow-sm dark:border-neutral-800 dark:bg-neutral-900">
                        {editing ? (
                          <>
                            {draftFields(draft, setDraft, cat.hint)}
                            <div className="mt-2 flex justify-end gap-2">
                              <button onClick={() => void saveEdit(item.id)} disabled={!draft.title.trim()} className="inline-flex items-center gap-1 rounded-md bg-neutral-900 px-2.5 py-1.5 text-[12px] text-white disabled:opacity-50 dark:bg-neutral-100 dark:text-neutral-900"><Save className="h-3.5 w-3.5" /> 保存</button>
                              <button onClick={() => setEditingId(null)} className="inline-flex items-center gap-1 rounded-md border border-neutral-200 px-2.5 py-1.5 text-[12px] dark:border-neutral-700"><X className="h-3.5 w-3.5" /> 取消</button>
                            </div>
                          </>
                        ) : (
                          <div className="flex items-start gap-3">
                            <div className="min-w-0 flex-1">
                              <div className="flex flex-wrap items-center gap-2">
                                <h3 className={`text-[13px] font-semibold ${item.enabled ? "text-neutral-900 dark:text-neutral-100" : "text-neutral-400 line-through"}`}>{item.title}</h3>
                                <span className="rounded border border-neutral-200 px-1.5 py-0.5 text-[10.5px] text-neutral-500 dark:border-neutral-700">{CATEGORY_LABEL[item.category]}</span>
                              </div>
                              {item.content && <p className="mt-1.5 whitespace-pre-wrap text-[12px] leading-5 text-neutral-500">{item.content}</p>}
                            </div>
                            <div className="flex shrink-0 items-center gap-1.5">
                              <button onClick={() => void toggle(item)} className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[12px] ${item.enabled ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-300" : "bg-neutral-100 text-neutral-500 dark:bg-neutral-800"}`}>
                                <CheckCircle2 className="h-3.5 w-3.5" /> {item.enabled ? "启用" : "停用"}
                              </button>
                              <button onClick={() => startEdit(item)} className="inline-flex items-center gap-1 rounded-md border border-neutral-200 px-2 py-1.5 text-[12px] dark:border-neutral-700"><Pencil className="h-3.5 w-3.5" /> 编辑</button>
                              <button onClick={() => void remove(item)} className="inline-flex items-center gap-1 rounded-md border border-red-200 px-2 py-1.5 text-[12px] text-red-600 dark:border-red-900 dark:text-red-400"><Trash2 className="h-3.5 w-3.5" /></button>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
