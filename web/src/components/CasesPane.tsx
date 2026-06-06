import { useCallback, useEffect, useMemo, useState } from "react";
import { BookOpen, CheckCircle2, FolderKanban, Pencil, Plus, RefreshCw, Search, Trash2, X } from "lucide-react";
import { api } from "@/lib/api";
import type { AnalysisCase } from "@/types";

const PRESET_CATEGORIES = ["人群分析", "转化分析", "竞品分析", "用户行为", "产品分析", "留存分析", "其他"];

interface CaseFormState {
  id: string | null;
  title: string;
  category: string;
  scenario: string;
  approach: string;
  conclusion: string;
}

const EMPTY_FORM: CaseFormState = { id: null, title: "", category: "", scenario: "", approach: "", conclusion: "" };

export function CasesPane({ workspaceId, onChanged }: { workspaceId: string | null; onChanged?: () => void }) {
  const [cases, setCases] = useState<AnalysisCase[]>([]);
  const [form, setForm] = useState<CaseFormState | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [copied, setCopied] = useState(false);
  const [promptInfo, setPromptInfo] = useState<{ prompt: string; count: number; updatedAt: number | null }>({ prompt: "", count: 0, updatedAt: null });

  const refresh = useCallback(async () => {
    if (!workspaceId) { setCases([]); return; }
    setLoading(true);
    setError("");
    try {
      const [nextCases, nextPrompt] = await Promise.all([
        api.listCases(workspaceId),
        api.getCasesPrompt(workspaceId),
      ]);
      setCases(nextCases);
      setPromptInfo(nextPrompt);
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }, [workspaceId]);

  useEffect(() => { void refresh(); }, [refresh]);

  const refreshPrompt = async () => {
    if (workspaceId) setPromptInfo(await api.getCasesPrompt(workspaceId));
    onChanged?.();
  };

  const filteredCases = useMemo(() => {
    if (!search.trim()) return cases;
    const q = search.toLowerCase();
    return cases.filter(
      (c) =>
        c.title.toLowerCase().includes(q) ||
        c.category.toLowerCase().includes(q) ||
        c.scenario.toLowerCase().includes(q) ||
        c.approach.toLowerCase().includes(q),
    );
  }, [cases, search]);

  const toggle = async (c: AnalysisCase) => {
    await api.updateCaseEnabled(c.id, !c.enabled);
    setCases((current) => current.map((item) => item.id === c.id ? { ...item, enabled: !item.enabled, updatedAt: Date.now() } : item));
    await refreshPrompt();
  };

  const remove = async (c: AnalysisCase) => {
    if (!window.confirm(`确认删除案例「${c.title}」？此操作不可恢复。`)) return;
    await api.deleteCase(c.id);
    setCases((current) => current.filter((item) => item.id !== c.id));
    if (form?.id === c.id) setForm(null);
    await refreshPrompt();
  };

  const save = async () => {
    if (!workspaceId || !form) return;
    if (!form.title.trim()) { setError("案例标题必填"); return; }
    setError("");
    const payload = {
      title: form.title.trim(),
      category: form.category.trim(),
      scenario: form.scenario.trim(),
      approach: form.approach.trim(),
      conclusion: form.conclusion.trim(),
    };
    if (form.id) {
      await api.updateCase(form.id, payload);
      setCases((current) => current.map((item) => item.id === form.id ? { ...item, ...payload, updatedAt: Date.now() } : item));
    } else {
      const created = await api.createCase(workspaceId, payload);
      setCases((current) => [created, ...current]);
    }
    setForm(null);
    await refreshPrompt();
  };

  const copyPrompt = async () => {
    if (!promptInfo.prompt) return;
    await navigator.clipboard.writeText(promptInfo.prompt);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1200);
  };

  const update = (patch: Partial<CaseFormState>) => setForm((cur) => (cur ? { ...cur, ...patch } : cur));

  const inputCls =
    "w-full rounded-md border border-neutral-200 bg-white px-3 py-2 text-[12px] outline-none focus:border-neutral-400 dark:border-neutral-700 dark:bg-neutral-950 dark:text-neutral-100";

  return (
    <div className="flex min-h-0 flex-1 overflow-auto bg-neutral-50/60 p-5 dark:bg-neutral-950">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-4">
        {/* Header */}
        <div className="flex items-start justify-between gap-4 rounded-xl border border-neutral-200 bg-white p-4 shadow-sm dark:border-neutral-800 dark:bg-neutral-900">
          <div>
            <h1 className="flex items-center gap-2 text-base font-semibold text-neutral-900 dark:text-neutral-100">
              <FolderKanban className="h-4 w-4" /> 分析案例库
            </h1>
            <p className="mt-1 text-[12.5px] text-neutral-500">
              沉淀高质量分析案例作为 few-shot 参考。启用后注入分析 prompt，引导 AI 复用已验证的分析框架和结论格式。
            </p>
          </div>
          <div className="flex shrink-0 flex-wrap gap-2">
            <button
              onClick={() => { setError(""); setForm(EMPTY_FORM); }}
              disabled={!workspaceId}
              className="inline-flex items-center gap-1.5 rounded-md border border-neutral-200 px-3 py-2 text-[12px] disabled:opacity-50 dark:border-neutral-700"
            >
              <Plus className="h-3.5 w-3.5" /> 新增案例
            </button>
            <button
              onClick={copyPrompt}
              disabled={!promptInfo.prompt}
              className="rounded-md border border-neutral-200 px-3 py-2 text-[12px] disabled:opacity-50 dark:border-neutral-700"
            >
              {copied ? "已复制" : "复制 prompt"}
            </button>
            <button
              onClick={() => void refresh()}
              disabled={!workspaceId || loading}
              className="inline-flex items-center gap-1.5 rounded-md border border-neutral-200 px-3 py-2 text-[12px] disabled:opacity-50 dark:border-neutral-700"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} /> 刷新
            </button>
          </div>
        </div>

        {error && (
          <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-[12px] text-red-600 dark:border-red-900 dark:bg-red-950/30">
            {error}
          </div>
        )}

        {/* Add / Edit form */}
        {form && (
          <div className="rounded-xl border border-neutral-300 bg-white p-4 shadow-sm dark:border-neutral-700 dark:bg-neutral-900">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-[13px] font-semibold text-neutral-900 dark:text-neutral-100">
                {form.id ? "编辑案例" : "新增案例"}
              </h2>
              <button
                onClick={() => { setForm(null); setError(""); }}
                className="rounded-md p-1 text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <label className="col-span-1 text-[11px] text-neutral-500">
                案例标题 *
                <input
                  className={inputCls}
                  value={form.title}
                  onChange={(e) => update({ title: e.target.value })}
                  placeholder="如：会员人群复购路径分析"
                />
              </label>
              <label className="col-span-1 text-[11px] text-neutral-500">
                分析类型
                <input
                  className={inputCls}
                  list="case-categories"
                  value={form.category}
                  onChange={(e) => update({ category: e.target.value })}
                  placeholder="如：人群分析"
                />
                <datalist id="case-categories">
                  {PRESET_CATEGORIES.map((c) => (
                    <option key={c} value={c} />
                  ))}
                </datalist>
              </label>
              <label className="col-span-2 text-[11px] text-neutral-500">
                分析场景
                <input
                  className={inputCls}
                  value={form.scenario}
                  onChange={(e) => update({ scenario: e.target.value })}
                  placeholder="如：分析某品牌会员从首单到复购的行为路径，定位高流失节点"
                />
              </label>
              <label className="col-span-2 text-[11px] text-neutral-500">
                分析思路
                <textarea
                  className={`${inputCls} min-h-20 resize-none`}
                  value={form.approach}
                  onChange={(e) => update({ approach: e.target.value })}
                  placeholder="如：1. 圈定人群口径 → 2. 计算各阶段转化率 → 3. 对比高/低价值用户行为差异 → 4. 归因流失节点"
                />
              </label>
              <label className="col-span-2 text-[11px] text-neutral-500">
                结论格式
                <textarea
                  className={`${inputCls} min-h-16 resize-none`}
                  value={form.conclusion}
                  onChange={(e) => update({ conclusion: e.target.value })}
                  placeholder="如：转化漏斗 + 各节点流失率 + Top3 原因归因 + 可执行建议"
                />
              </label>
            </div>
            <div className="mt-3 flex justify-end gap-2">
              <button
                onClick={() => { setForm(null); setError(""); }}
                className="rounded-md border border-neutral-200 px-3 py-2 text-[12px] dark:border-neutral-700"
              >
                取消
              </button>
              <button
                onClick={() => void save()}
                className="rounded-md bg-neutral-900 px-3 py-2 text-[12px] text-white dark:bg-neutral-100 dark:text-neutral-900"
              >
                保存
              </button>
            </div>
          </div>
        )}

        {/* Prompt preview */}
        <div className="rounded-xl border border-neutral-200 bg-white p-4 shadow-sm dark:border-neutral-800 dark:bg-neutral-900">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-[13px] font-semibold text-neutral-900 dark:text-neutral-100">注入 prompt 预览</h2>
            <span className="text-[11px] text-neutral-400">
              启用 {promptInfo.count} / {cases.length} 条
            </span>
          </div>
          <pre className="mt-3 max-h-56 overflow-auto whitespace-pre-wrap rounded-lg bg-neutral-50 p-3 text-[12px] leading-5 text-neutral-700 dark:bg-neutral-950 dark:text-neutral-300">
            {promptInfo.prompt || "暂无启用案例"}
          </pre>
        </div>

        {/* Search */}
        {cases.length > 3 && (
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-neutral-400" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="搜索案例标题 / 类型 / 场景..."
              className="h-9 w-full rounded-lg border border-neutral-200 bg-white pl-9 pr-3 text-[12px] outline-none focus:border-neutral-400 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100"
            />
          </div>
        )}

        {/* Case list */}
        <div className="space-y-3">
          {cases.length === 0 ? (
            <div className="rounded-xl border border-dashed border-neutral-300 bg-white p-12 text-center dark:border-neutral-800 dark:bg-neutral-900/40">
              <BookOpen className="mx-auto mb-3 h-8 w-8 text-neutral-300 dark:text-neutral-700" />
              <p className="text-[13px] text-neutral-400">暂无分析案例</p>
              <p className="mt-1 text-[12px] text-neutral-400">沉淀已验证的分析框架，供 AI 参考复用</p>
            </div>
          ) : filteredCases.length === 0 ? (
            <div className="rounded-xl border border-dashed border-neutral-300 bg-white p-8 text-center text-[12.5px] text-neutral-400 dark:border-neutral-800 dark:bg-neutral-900/40">
              无匹配案例
            </div>
          ) : (
            filteredCases.map((c) => (
              <CaseCard
                key={c.id}
                item={c}
                onToggle={() => void toggle(c)}
                onEdit={() => {
                  setError("");
                  setForm({ id: c.id, title: c.title, category: c.category, scenario: c.scenario, approach: c.approach, conclusion: c.conclusion });
                }}
                onDelete={() => void remove(c)}
              />
            ))
          )}
        </div>
      </div>
    </div>
  );
}

function CaseCard({
  item,
  onToggle,
  onEdit,
  onDelete,
}: {
  item: AnalysisCase;
  onToggle: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  return (
    <div className="rounded-xl border border-neutral-200 bg-white p-4 shadow-sm dark:border-neutral-800 dark:bg-neutral-900">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-[13px] font-semibold text-neutral-900 dark:text-neutral-100">{item.title}</h3>
            {item.category && (
              <span className="rounded border border-neutral-200 px-1.5 py-0.5 text-[10.5px] text-neutral-500 dark:border-neutral-700">
                {item.category}
              </span>
            )}
          </div>
          {item.scenario && (
            <p className="mt-2 text-[12px] leading-5 text-neutral-600 dark:text-neutral-300">{item.scenario}</p>
          )}
          {item.approach && (
            <p className="mt-1 text-[11.5px] leading-5 text-neutral-500">思路：{item.approach}</p>
          )}
          {item.conclusion && (
            <p className="mt-1 text-[11.5px] leading-5 text-neutral-500">结论格式：{item.conclusion}</p>
          )}
          <p className="mt-2 font-mono text-[10.5px] text-neutral-400">
            updated {new Date(item.updatedAt).toLocaleString()}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <button
            onClick={onToggle}
            className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[12px] ${item.enabled ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-300" : "bg-neutral-100 text-neutral-500 dark:bg-neutral-800"}`}
          >
            <CheckCircle2 className="h-3.5 w-3.5" /> {item.enabled ? "启用" : "停用"}
          </button>
          <button
            onClick={onEdit}
            className="rounded-md border border-neutral-200 p-1.5 text-neutral-500 hover:text-neutral-800 dark:border-neutral-700 dark:hover:text-neutral-200"
          >
            <Pencil className="h-3.5 w-3.5" />
          </button>
          <button
            onClick={onDelete}
            className="rounded-md border border-neutral-200 p-1.5 text-neutral-500 hover:text-red-600 dark:border-neutral-700"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
}
