import { useCallback, useEffect, useMemo, useState } from "react";
import { FlaskConical, Plus, RefreshCw, Sparkles, Trash2, X } from "lucide-react";
import { api } from "@/lib/api";
import { cn } from "@/lib/cn";
import type { HypothesisEntry, HypothesisVerdict } from "@/types";

interface Props {
  workspaceId: string | null;
}

const VERDICTS: { id: HypothesisVerdict; label: string; cls: string }[] = [
  { id: "confirmed", label: "✅ 成立", cls: "text-emerald-600 dark:text-emerald-400" },
  { id: "rejected", label: "❌ 不成立", cls: "text-rose-600 dark:text-rose-400" },
  { id: "partial", label: "⚠️ 部分", cls: "text-amber-600 dark:text-amber-400" },
];

const VERDICT_MAP = Object.fromEntries(VERDICTS.map((v) => [v.id, v]));

const EMPTY_FORM = { scene: "", hypothesis: "", verdict: "confirmed" as HypothesisVerdict, evidence: "", impact: "" };

export function HypothesisPane({ workspaceId }: Props) {
  const [entries, setEntries] = useState<HypothesisEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);

  const refresh = useCallback(() => {
    if (!workspaceId) {
      setEntries([]);
      return;
    }
    setLoading(true);
    api.listHypotheses(workspaceId)
      .then(setEntries)
      .catch(() => setEntries([]))
      .finally(() => setLoading(false));
  }, [workspaceId]);

  useEffect(() => { refresh(); }, [refresh]);

  const grouped = useMemo(() => {
    const map = new Map<string, HypothesisEntry[]>();
    for (const e of entries) {
      const arr = map.get(e.scene) ?? [];
      if (arr.length === 0) map.set(e.scene, arr);
      arr.push(e);
    }
    return [...map.entries()];
  }, [entries]);

  const save = useCallback(async () => {
    if (!workspaceId || saving || !form.scene.trim() || !form.hypothesis.trim()) return;
    setSaving(true);
    try {
      await api.createHypothesis(workspaceId, {
        scene: form.scene.trim(),
        hypothesis: form.hypothesis.trim(),
        verdict: form.verdict,
        evidence: form.evidence.trim(),
        impact: form.impact.trim(),
      });
      setForm(EMPTY_FORM);
      setAdding(false);
      refresh();
    } finally {
      setSaving(false);
    }
  }, [workspaceId, saving, form, refresh]);

  const toggle = useCallback(async (e: HypothesisEntry) => {
    await api.updateHypothesisEnabled(e.id, !e.enabled).catch(() => undefined);
    setEntries((cur) => cur.map((x) => (x.id === e.id ? { ...x, enabled: !x.enabled } : x)));
  }, []);

  const remove = useCallback(async (id: string) => {
    await api.deleteHypothesis(id).catch(() => undefined);
    setEntries((cur) => cur.filter((x) => x.id !== id));
  }, []);

  if (!workspaceId) {
    return (
      <div className="flex flex-1 items-center justify-center text-[13px] text-neutral-400">请先选择一个工作区</div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
      <div className="mx-auto w-full max-w-3xl px-6 py-6">
        <div className="flex items-center gap-2">
          <FlaskConical className="h-4 w-4 text-neutral-500" strokeWidth={1.75} />
          <h2 className="text-[14px] font-semibold text-neutral-900 dark:text-neutral-100">假设库</h2>
          <span className="text-[11px] text-neutral-400">归档阶段自动沉淀 · 规范阶段自动复用</span>
          <button
            onClick={refresh}
            className="ml-auto inline-flex h-7 items-center gap-1 rounded-md px-2 text-[12px] text-neutral-500 hover:bg-neutral-100 dark:hover:bg-neutral-800"
          >
            <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} strokeWidth={1.75} />
          </button>
          <button
            onClick={() => setAdding((a) => !a)}
            className="inline-flex h-7 items-center gap-1 rounded-md bg-sky-500 px-2.5 text-[12px] font-medium text-white hover:bg-sky-600"
          >
            <Plus className="h-3.5 w-3.5" strokeWidth={2} />
            手动添加
          </button>
        </div>
        <p className="mt-1.5 text-[12px] leading-5 text-neutral-500 dark:text-neutral-400">
          每次 AnaX 分析走到归档阶段，验证过的假设会按场景自动写入这里；下次分析同类问题时，规范阶段会把这些历史假设注入上下文，避免从零重猜。
        </p>

        {adding && (
          <div className="mt-3 flex flex-col gap-2 rounded-md border border-neutral-200 p-3 dark:border-neutral-700">
            <div className="flex gap-2">
              <input
                value={form.scene}
                onChange={(e) => setForm((f) => ({ ...f, scene: e.target.value }))}
                placeholder="场景（如 留存率下降）"
                className="h-8 w-48 rounded-md border border-neutral-200 bg-transparent px-2.5 text-[12.5px] outline-none focus:border-neutral-400 dark:border-neutral-700"
              />
              <select
                value={form.verdict}
                onChange={(e) => setForm((f) => ({ ...f, verdict: e.target.value as HypothesisVerdict }))}
                className="h-8 rounded-md border border-neutral-200 bg-transparent px-2 text-[12.5px] outline-none dark:border-neutral-700 dark:bg-neutral-900"
              >
                {VERDICTS.map((v) => <option key={v.id} value={v.id}>{v.label}</option>)}
              </select>
            </div>
            <input
              value={form.hypothesis}
              onChange={(e) => setForm((f) => ({ ...f, hypothesis: e.target.value }))}
              placeholder="假设陈述"
              className="h-8 w-full rounded-md border border-neutral-200 bg-transparent px-2.5 text-[12.5px] outline-none focus:border-neutral-400 dark:border-neutral-700"
            />
            <div className="flex gap-2">
              <input
                value={form.evidence}
                onChange={(e) => setForm((f) => ({ ...f, evidence: e.target.value }))}
                placeholder="证据/结论摘要"
                className="h-8 flex-1 rounded-md border border-neutral-200 bg-transparent px-2.5 text-[12.5px] outline-none focus:border-neutral-400 dark:border-neutral-700"
              />
              <input
                value={form.impact}
                onChange={(e) => setForm((f) => ({ ...f, impact: e.target.value }))}
                placeholder="业务影响（可空）"
                className="h-8 w-40 rounded-md border border-neutral-200 bg-transparent px-2.5 text-[12.5px] outline-none focus:border-neutral-400 dark:border-neutral-700"
              />
            </div>
            <div className="flex justify-end gap-2">
              <button onClick={() => { setAdding(false); setForm(EMPTY_FORM); }} className="inline-flex h-7 items-center gap-1 rounded-md px-2.5 text-[12px] text-neutral-500 hover:bg-neutral-100 dark:hover:bg-neutral-800">
                <X className="h-3.5 w-3.5" strokeWidth={2} />取消
              </button>
              <button
                onClick={save}
                disabled={!form.scene.trim() || !form.hypothesis.trim() || saving}
                className="inline-flex h-7 items-center rounded-md bg-sky-500 px-3 text-[12px] font-medium text-white hover:bg-sky-600 disabled:opacity-50"
              >
                保存
              </button>
            </div>
          </div>
        )}

        <div className="mt-4 flex flex-col gap-4">
          {grouped.length === 0 ? (
            <div className="rounded-md border border-dashed border-neutral-200 px-4 py-10 text-center text-[12.5px] text-neutral-400 dark:border-neutral-700">
              暂无假设。完成一次 AnaX 分析（走到归档阶段）会自动沉淀，或手动添加。
            </div>
          ) : (
            grouped.map(([scene, items]) => (
              <div key={scene}>
                <div className="mb-1.5 flex items-center gap-2">
                  <span className="text-[12.5px] font-semibold text-neutral-800 dark:text-neutral-200">{scene}</span>
                  <span className="text-[10.5px] text-neutral-400">{items.length}</span>
                </div>
                <div className="flex flex-col gap-1.5">
                  {items.map((e) => (
                    <div
                      key={e.id}
                      className={cn(
                        "group flex items-start gap-2 rounded-md border px-3 py-2",
                        e.enabled ? "border-neutral-200 dark:border-neutral-700" : "border-neutral-200/60 opacity-50 dark:border-neutral-800",
                      )}
                    >
                      <input
                        type="checkbox"
                        checked={e.enabled}
                        onChange={() => toggle(e)}
                        title={e.enabled ? "已启用（会注入分析）" : "已停用"}
                        className="mt-0.5 h-3.5 w-3.5 shrink-0 accent-sky-500"
                      />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className={cn("shrink-0 text-[11px] font-medium", VERDICT_MAP[e.verdict]?.cls)}>{VERDICT_MAP[e.verdict]?.label}</span>
                          <span className="text-[12.5px] text-neutral-800 dark:text-neutral-100">{e.hypothesis}</span>
                          {e.source === "archive" && (
                            <span className="inline-flex shrink-0 items-center gap-0.5 rounded-full bg-violet-50 px-1.5 py-0.5 text-[9px] font-medium text-violet-600 dark:bg-violet-950/30 dark:text-violet-400" title="归档飞轮自动沉淀">
                              <Sparkles className="h-2.5 w-2.5" strokeWidth={2.5} />飞轮
                            </span>
                          )}
                          {(() => {
                            const total = (e.confirmCount ?? 0) + (e.rejectCount ?? 0) + (e.partialCount ?? 0);
                            if (total < 2) return null;
                            return (
                              <span
                                className="shrink-0 rounded-full bg-neutral-100 px-1.5 py-0.5 text-[9px] text-neutral-500 dark:bg-neutral-800 dark:text-neutral-400"
                                title={`已验证 ${total} 次：确认 ${e.confirmCount ?? 0} / 否定 ${e.rejectCount ?? 0} / 部分 ${e.partialCount ?? 0}`}
                              >
                                {total}×验证
                              </span>
                            );
                          })()}
                        </div>
                        {(e.evidence || e.impact) && (
                          <div className="mt-0.5 text-[11px] text-neutral-500 dark:text-neutral-400">
                            {e.impact && <span className="mr-2 text-neutral-400">影响：{e.impact}</span>}
                            {e.evidence}
                          </div>
                        )}
                      </div>
                      <button
                        onClick={() => remove(e.id)}
                        className="shrink-0 rounded p-1 text-neutral-300 opacity-0 transition-opacity hover:bg-rose-50 hover:text-rose-500 group-hover:opacity-100 dark:hover:bg-rose-950/30"
                      >
                        <Trash2 className="h-3.5 w-3.5" strokeWidth={1.75} />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
