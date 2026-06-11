import { useCallback, useEffect, useMemo, useState } from "react";
import { CheckCircle2, Pencil, RefreshCw, Save, ScrollText, Trash2, X } from "lucide-react";
import { api } from "@/lib/api";
import { sharedApi } from "@/lib/api/shared";
import type { RuleMemory } from "@/types";

type RuleSeverity = RuleMemory["severity"];
type RuleScope = RuleMemory["scope"];

interface EditDraft {
  title: string;
  evidence: string;
  severity: RuleSeverity;
  scope: RuleScope;
}

export function RulesPane({ workspaceId, onRulesChanged }: { workspaceId: string | null; onRulesChanged?: () => void }) {
  const [rules, setRules] = useState<RuleMemory[]>([]);
  const [promptInfo, setPromptInfo] = useState<{ prompt: string; count: number; updatedAt: number | null }>({ prompt: "", count: 0, updatedAt: null });
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState("");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<EditDraft>({ title: "", evidence: "", severity: "medium", scope: "global" });
  const [enablements, setEnablements] = useState<Map<string, boolean>>(new Map());

  const refresh = useCallback(async () => {
    if (!workspaceId) return;
    setLoading(true);
    setError("");
    try {
      const [nextRules, nextPrompt, nextEnablements] = await Promise.all([
        api.listRules(workspaceId),
        api.getRulesPrompt(workspaceId),
        sharedApi.listMemoryEnablements(workspaceId, "rule"),
      ]);
      setRules(nextRules);
      setPromptInfo(nextPrompt);
      setEnablements(new Map(nextEnablements.map((e) => [e.itemId, e.enabled])));
      setSelectedIds((current) => current.filter((id) => nextRules.some((rule) => rule.id === id)));
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }, [workspaceId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);
  const allSelected = rules.length > 0 && selectedIds.length === rules.length;

  const refreshPrompt = async () => {
    if (workspaceId) setPromptInfo(await api.getRulesPrompt(workspaceId));
    onRulesChanged?.();
  };

  const toggle = async (rule: RuleMemory) => {
    if (!workspaceId) return;
    const current = enablements.get(rule.id) ?? false;
    const next = !current;
    await sharedApi.setMemoryEnablement(workspaceId, "rule", rule.id, next);
    setEnablements((prev) => {
      const m = new Map(prev);
      m.set(rule.id, next);
      return m;
    });
    await refreshPrompt();
  };

  const toggleSelect = (id: string) => {
    setSelectedIds((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);
  };

  const toggleSelectAll = () => {
    setSelectedIds(allSelected ? [] : rules.map((rule) => rule.id));
  };

  const bulkSetEnabled = async (enabled: boolean) => {
    if (!workspaceId || selectedIds.length === 0) return;
    const ids = [...selectedIds];
    await Promise.all(ids.map((id) => sharedApi.setMemoryEnablement(workspaceId, "rule", id, enabled)));
    setEnablements((prev) => {
      const m = new Map(prev);
      for (const id of ids) m.set(id, enabled);
      return m;
    });
    await refreshPrompt();
  };

  const startEdit = (rule: RuleMemory) => {
    setEditingId(rule.id);
    setDraft({ title: rule.title, evidence: rule.evidence, severity: rule.severity, scope: rule.scope });
  };

  const saveEdit = async (id: string) => {
    if (!draft.title.trim()) return;
    await api.updateRule(id, { title: draft.title.trim(), evidence: draft.evidence.trim(), severity: draft.severity, scope: draft.scope });
    setEditingId(null);
    await refresh();
    onRulesChanged?.();
  };

  const deleteRule = async (rule: RuleMemory) => {
    if (!window.confirm(`删除规则「${rule.title}」？此操作不可恢复（全局池删除，所有工作区都将失效）。`)) return;
    await api.deleteRule(rule.id);
    if (editingId === rule.id) setEditingId(null);
    await refresh();
    onRulesChanged?.();
  };

  const copyPrompt = async () => {
    if (!promptInfo.prompt) return;
    await navigator.clipboard.writeText(promptInfo.prompt);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1200);
  };

  return (
    <div className="flex min-h-0 flex-1 overflow-auto bg-neutral-50/60 p-5 dark:bg-neutral-950">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-4">
        <div className="flex items-start justify-between gap-4 rounded-xl border border-neutral-200 bg-white p-4 shadow-sm dark:border-neutral-800 dark:bg-neutral-900">
          <div>
            <h1 className="flex items-center gap-2 text-base font-semibold text-neutral-900 dark:text-neutral-100"><ScrollText className="h-4 w-4" /> rules</h1>
            <p className="mt-1 text-[12.5px] text-neutral-500">沉淀来自 trace 或人工维护的 system prompt 规则。</p>
          </div>
          <div className="flex gap-2">
            <button onClick={copyPrompt} disabled={!promptInfo.prompt} className="rounded-md border border-neutral-200 px-3 py-2 text-[12px] disabled:opacity-50 dark:border-neutral-700">{copied ? "已复制" : "复制 prompt"}</button>
            <button onClick={refresh} disabled={!workspaceId || loading} className="inline-flex items-center gap-1.5 rounded-md border border-neutral-200 px-3 py-2 text-[12px] disabled:opacity-50 dark:border-neutral-700">
              <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} /> 刷新
            </button>
          </div>
        </div>

        {error && <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-[12px] text-red-600 dark:border-red-900 dark:bg-red-950/30">{error}</div>}

        <div className="rounded-xl border border-neutral-200 bg-white p-4 shadow-sm dark:border-neutral-800 dark:bg-neutral-900">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-[13px] font-semibold text-neutral-900 dark:text-neutral-100">System prompt 片段</h2>
            <span className="text-[11px] text-neutral-400">启用规则 {promptInfo.count} 条</span>
          </div>
          <pre className="mt-3 max-h-56 overflow-auto whitespace-pre-wrap rounded-lg bg-neutral-50 p-3 text-[12px] leading-5 text-neutral-700 dark:bg-neutral-950 dark:text-neutral-300">{promptInfo.prompt || "暂无启用规则"}</pre>
        </div>

        <div className="flex items-center justify-between gap-3 rounded-xl border border-neutral-200 bg-white px-4 py-3 shadow-sm dark:border-neutral-800 dark:bg-neutral-900">
          <label className="flex items-center gap-2 text-[12px] text-neutral-500">
            <input type="checkbox" checked={allSelected} onChange={toggleSelectAll} />
            已选择 {selectedIds.length} / {rules.length}
          </label>
          <div className="flex gap-2">
            <button onClick={() => void bulkSetEnabled(true)} disabled={selectedIds.length === 0} className="rounded-md border border-neutral-200 px-3 py-1.5 text-[12px] disabled:opacity-50 dark:border-neutral-700">批量启用</button>
            <button onClick={() => void bulkSetEnabled(false)} disabled={selectedIds.length === 0} className="rounded-md border border-neutral-200 px-3 py-1.5 text-[12px] disabled:opacity-50 dark:border-neutral-700">批量停用</button>
          </div>
        </div>

        <div className="space-y-3">
          {rules.length === 0 ? (
            <div className="rounded-xl border border-dashed border-neutral-300 bg-white p-12 text-center text-[13px] text-neutral-400 dark:border-neutral-800 dark:bg-neutral-900/40">暂无 rules，可先从 trace 暂存规则写入</div>
          ) : rules.map((rule) => {
            const editing = editingId === rule.id;
            const wsEnabled = enablements.get(rule.id) ?? false;
            return (
              <div key={rule.id} className="rounded-xl border border-neutral-200 bg-white p-4 shadow-sm dark:border-neutral-800 dark:bg-neutral-900">
                <div className="flex items-start gap-3">
                  <input className="mt-1" type="checkbox" checked={selectedSet.has(rule.id)} onChange={() => toggleSelect(rule.id)} />
                  <div className="min-w-0 flex-1">
                    {editing ? (
                      <div className="space-y-2">
                        <input value={draft.title} onChange={(event) => setDraft((current) => ({ ...current, title: event.target.value }))} className="w-full rounded-md border border-neutral-200 bg-transparent px-2 py-1.5 text-[13px] dark:border-neutral-700" />
                        <textarea value={draft.evidence} onChange={(event) => setDraft((current) => ({ ...current, evidence: event.target.value }))} className="h-20 w-full resize-none rounded-md border border-neutral-200 bg-transparent px-2 py-1.5 text-[12px] dark:border-neutral-700" />
                        <div className="flex gap-2">
                          <select value={draft.severity} onChange={(event) => setDraft((current) => ({ ...current, severity: event.target.value as RuleSeverity }))} className="rounded-md border border-neutral-200 bg-transparent px-2 py-1.5 text-[12px] dark:border-neutral-700">
                            <option value="low">low</option>
                            <option value="medium">medium</option>
                            <option value="high">high</option>
                          </select>
                          <select value={draft.scope} onChange={(event) => setDraft((current) => ({ ...current, scope: event.target.value as RuleScope }))} className="rounded-md border border-neutral-200 bg-transparent px-2 py-1.5 text-[12px] dark:border-neutral-700">
                            <option value="global">global</option>
                            <option value="chat">chat</option>
                            <option value="workflow">workflow</option>
                          </select>
                        </div>
                      </div>
                    ) : (
                      <>
                        <div className="flex flex-wrap items-center gap-2">
                          <h2 className="text-[13px] font-semibold text-neutral-900 dark:text-neutral-100">{rule.title}</h2>
                          <span className="rounded border border-neutral-200 px-1.5 py-0.5 text-[10.5px] text-neutral-500 dark:border-neutral-700">{rule.source}</span>
                          <span className="rounded border border-neutral-200 px-1.5 py-0.5 text-[10.5px] text-neutral-500 dark:border-neutral-700">{rule.severity}</span>
                          <span className="rounded border border-neutral-200 px-1.5 py-0.5 text-[10.5px] text-neutral-500 dark:border-neutral-700">{rule.scope}</span>
                          {rule.workspaceId !== workspaceId && (
                            <span className="rounded border border-amber-200 px-1.5 py-0.5 text-[10.5px] text-amber-600 dark:border-amber-800 dark:text-amber-400">来源</span>
                          )}
                        </div>
                        <p className="mt-2 text-[12px] leading-5 text-neutral-500">依据：{rule.evidence || "无"}</p>
                        <p className="mt-2 font-mono text-[10.5px] text-neutral-400">updated {new Date(rule.updatedAt).toLocaleString()}</p>
                      </>
                    )}
                  </div>
                  <div className="flex shrink-0 items-center gap-1.5">
                    {editing ? (
                      <>
                        <button onClick={() => void saveEdit(rule.id)} disabled={!draft.title.trim()} className="inline-flex items-center gap-1 rounded-md bg-neutral-900 px-2 py-1.5 text-[12px] text-white disabled:opacity-50 dark:bg-neutral-100 dark:text-neutral-900"><Save className="h-3.5 w-3.5" /> 保存</button>
                        <button onClick={() => setEditingId(null)} className="inline-flex items-center gap-1 rounded-md border border-neutral-200 px-2 py-1.5 text-[12px] dark:border-neutral-700"><X className="h-3.5 w-3.5" /> 取消</button>
                      </>
                    ) : (
                      <>
                        <button onClick={() => void toggle(rule)} className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[12px] ${wsEnabled ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-300" : "bg-neutral-100 text-neutral-500 dark:bg-neutral-800"}`}>
                          <CheckCircle2 className="h-3.5 w-3.5" /> 本工作区{wsEnabled ? "启用" : "停用"}
                        </button>
                        <button onClick={() => startEdit(rule)} className="inline-flex items-center gap-1 rounded-md border border-neutral-200 px-2 py-1.5 text-[12px] dark:border-neutral-700"><Pencil className="h-3.5 w-3.5" /> 编辑</button>
                        <button onClick={() => void deleteRule(rule)} className="inline-flex items-center gap-1 rounded-md border border-red-200 px-2 py-1.5 text-[12px] text-red-600 dark:border-red-900 dark:text-red-400"><Trash2 className="h-3.5 w-3.5" /> 删除</button>
                      </>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
