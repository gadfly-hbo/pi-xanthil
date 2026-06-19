// Agent-D 阶段3 统一记忆面板（规则记忆重构 v2）
// 替换原 RulesPane（旧 RuleMemory CRUD）：按 type 列 memory_items（constraint/experience/episode），
// 提供 CRUD + 启用 + 注入预览（GET /memory/preview）+ 反馈（positive/negative）+ review 复核队列。
// fact 维度由 business_context / metric / reference 各自原生面板维护，本页只读展示投影。
// 数据安全：本页所有内容均为 LLM 衍生 / 用户手写记忆，不接触 draw_data。

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  Brain,
  Eye,
  Inbox,
  Pencil,
  Plus,
  RefreshCw,
  Save,
  ThumbsDown,
  ThumbsUp,
  Trash2,
  X,
} from "lucide-react";
import { api } from "@/lib/api";
import type {
  MemoryItem,
  MemoryItemType,
  MemoryPromptPreview,
  MemoryReview,
  MemoryRiskFlag,
  ProjectedFactItem,
} from "@/types";

type Scope = MemoryItem["scope"];
type TabKey = MemoryItemType | "fact" | "review";

interface CreateDraft {
  type: MemoryItemType;
  title: string;
  body: string;
  scope: Scope;
}

interface EditDraft {
  title: string;
  body: string;
  scope: Scope;
}

const TYPE_TABS: { key: TabKey; label: string; hint: string }[] = [
  { key: "constraint", label: "constraint", hint: "硬约束 / 必须遵守" },
  { key: "experience", label: "experience", hint: "经验 / 偏好（含原 case）" },
  { key: "episode", label: "episode", hint: "事件 / 一次性情境" },
  { key: "fact", label: "fact (投影)", hint: "business_context / metric / reference 投影，只读" },
  { key: "review", label: "review", hint: "D-INGEST 候选复核队列" },
];

const DEFAULT_DRAFT: CreateDraft = { type: "experience", title: "", body: "", scope: "global" };

function fmtTs(ts: number | null): string {
  if (!ts) return "—";
  return new Date(ts).toLocaleString();
}

function RiskBadge({ flag }: { flag: MemoryRiskFlag }) {
  const tone =
    flag.severity === "high"
      ? "border-red-300 bg-red-50 text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300"
      : flag.severity === "medium"
        ? "border-amber-300 bg-amber-50 text-amber-700 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-300"
        : "border-neutral-200 bg-neutral-50 text-neutral-600 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-300";
  return (
    <span title={flag.message} className={`inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[10.5px] ${tone}`}>
      <AlertTriangle className="h-3 w-3" /> {flag.code}
    </span>
  );
}

export function RulesPane({ workspaceId, onRulesChanged }: { workspaceId: string | null; onRulesChanged?: () => void }) {
  const [activeTab, setActiveTab] = useState<TabKey>("constraint");
  const [items, setItems] = useState<MemoryItem[]>([]);
  const [facts, setFacts] = useState<ProjectedFactItem[]>([]);
  const [reviews, setReviews] = useState<MemoryReview[]>([]);
  const [preview, setPreview] = useState<MemoryPromptPreview | null>(null);
  const [previewScope, setPreviewScope] = useState<"chat" | "workflow">("chat");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<EditDraft>({ title: "", body: "", scope: "global" });
  const [creating, setCreating] = useState(false);
  const [createDraft, setCreateDraft] = useState<CreateDraft>(DEFAULT_DRAFT);
  const [showPreview, setShowPreview] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const refreshData = useCallback(async () => {
    if (!workspaceId) return;
    setLoading(true);
    setError("");
    try {
      const [list, reviewList] = await Promise.all([
        api.listMemoryItems(workspaceId, { includeFacts: true }),
        api.listMemoryReviews(workspaceId, "pending"),
      ]);
      setItems(list.items);
      setFacts(list.facts);
      setReviews(reviewList);
    } catch (err) {
      setError(String(err instanceof Error ? err.message : err));
    } finally {
      setLoading(false);
    }
  }, [workspaceId]);

  const refreshPreview = useCallback(async () => {
    if (!workspaceId) return;
    try {
      const previewData = await api.previewMemoryPrompt(workspaceId, { targetScope: previewScope });
      setPreview(previewData);
    } catch (err) {
      setError(String(err instanceof Error ? err.message : err));
    }
  }, [workspaceId, previewScope]);

  useEffect(() => {
    void refreshData();
  }, [refreshData]);

  useEffect(() => {
    void refreshPreview();
  }, [refreshPreview]);

  const grouped = useMemo(() => {
    const map = new Map<MemoryItemType, MemoryItem[]>([
      ["constraint", []],
      ["experience", []],
      ["episode", []],
    ]);
    for (const it of items) map.get(it.type)?.push(it);
    return map;
  }, [items]);

  const visibleItems =
    activeTab === "constraint" || activeTab === "experience" || activeTab === "episode"
      ? grouped.get(activeTab) ?? []
      : [];

  const toggleEnabled = async (item: MemoryItem) => {
    if (!workspaceId || busyId) return;
    setBusyId(item.id);
    try {
      const updated = await api.updateMemoryItem(workspaceId, item.id, { enabled: !item.enabled });
      setItems((prev) => prev.map((x) => (x.id === item.id ? updated : x)));
      await refreshPreview();
      onRulesChanged?.();
    } catch (err) {
      setError(String(err instanceof Error ? err.message : err));
    } finally {
      setBusyId(null);
    }
  };

  const startEdit = (item: MemoryItem) => {
    setEditingId(item.id);
    setEditDraft({ title: item.title, body: item.body, scope: item.scope });
  };

  const saveEdit = async (id: string) => {
    if (!workspaceId || !editDraft.title.trim()) return;
    setBusyId(id);
    try {
      const updated = await api.updateMemoryItem(workspaceId, id, {
        title: editDraft.title.trim(),
        body: editDraft.body,
        scope: editDraft.scope,
      });
      setItems((prev) => prev.map((x) => (x.id === id ? updated : x)));
      setEditingId(null);
      await refreshPreview();
      onRulesChanged?.();
    } catch (err) {
      setError(String(err instanceof Error ? err.message : err));
    } finally {
      setBusyId(null);
    }
  };

  const deleteItem = async (item: MemoryItem) => {
    if (!workspaceId) return;
    if (!window.confirm(`删除记忆「${item.title}」？此操作不可恢复。`)) return;
    setBusyId(item.id);
    try {
      await api.deleteMemoryItem(workspaceId, item.id);
      setItems((prev) => prev.filter((x) => x.id !== item.id));
      if (editingId === item.id) setEditingId(null);
      await refreshPreview();
      onRulesChanged?.();
    } catch (err) {
      setError(String(err instanceof Error ? err.message : err));
    } finally {
      setBusyId(null);
    }
  };

  const sendFeedback = async (item: MemoryItem, signal: "positive" | "negative") => {
    if (!workspaceId || busyId) return;
    setBusyId(item.id);
    try {
      const updated = await api.recordMemoryItemFeedback(workspaceId, item.id, signal);
      setItems((prev) => prev.map((x) => (x.id === item.id ? updated : x)));
    } catch (err) {
      setError(String(err instanceof Error ? err.message : err));
    } finally {
      setBusyId(null);
    }
  };

  const submitCreate = async () => {
    if (!workspaceId || !createDraft.title.trim()) return;
    setBusyId("__create__");
    try {
      const created = await api.createMemoryItem(workspaceId, {
        type: createDraft.type,
        title: createDraft.title.trim(),
        body: createDraft.body,
        scope: createDraft.scope,
      });
      setItems((prev) => [created, ...prev]);
      setCreateDraft(DEFAULT_DRAFT);
      setCreating(false);
      setActiveTab(created.type);
      await refreshPreview();
      onRulesChanged?.();
    } catch (err) {
      setError(String(err instanceof Error ? err.message : err));
    } finally {
      setBusyId(null);
    }
  };

  const acceptReview = async (review: MemoryReview) => {
    if (!workspaceId || busyId) return;
    setBusyId(review.id);
    try {
      const out = await api.acceptMemoryReview(workspaceId, review.id);
      if (!out) {
        setError("review already processed");
        setReviews((prev) => prev.filter((r) => r.id !== review.id));
        return;
      }
      setReviews((prev) => prev.filter((r) => r.id !== review.id));
      setItems((prev) => [out.item, ...prev]);
      await refreshPreview();
      onRulesChanged?.();
    } catch (err) {
      setError(String(err instanceof Error ? err.message : err));
    } finally {
      setBusyId(null);
    }
  };

  const rejectReview = async (review: MemoryReview) => {
    if (!workspaceId || busyId) return;
    const reason = window.prompt("拒绝理由（可选）", "");
    if (reason === null) return;
    setBusyId(review.id);
    try {
      await api.rejectMemoryReview(workspaceId, review.id, reason);
      setReviews((prev) => prev.filter((r) => r.id !== review.id));
    } catch (err) {
      setError(String(err instanceof Error ? err.message : err));
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="flex min-h-0 flex-1 overflow-auto bg-neutral-50/60 p-5 dark:bg-neutral-950">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-4">
        <div className="flex items-start justify-between gap-4 rounded-xl border border-neutral-200 bg-white p-4 shadow-sm dark:border-neutral-800 dark:bg-neutral-900">
          <div>
            <h1 className="flex items-center gap-2 text-base font-semibold text-neutral-900 dark:text-neutral-100"><Brain className="h-4 w-4" /> 统一记忆面板</h1>
            <p className="mt-1 text-[12.5px] text-neutral-500">memory_items（constraint/experience/episode）+ fact 投影 + D-INGEST 候选复核</p>
          </div>
          <div className="flex gap-2">
            <button onClick={() => setShowPreview((v) => !v)} className="inline-flex items-center gap-1.5 rounded-md border border-neutral-200 px-3 py-2 text-[12px] dark:border-neutral-700"><Eye className="h-3.5 w-3.5" /> {showPreview ? "隐藏" : "预览"}注入</button>
            <button onClick={() => setCreating((v) => !v)} disabled={!workspaceId} className="inline-flex items-center gap-1.5 rounded-md bg-neutral-900 px-3 py-2 text-[12px] text-white disabled:opacity-50 dark:bg-neutral-100 dark:text-neutral-900"><Plus className="h-3.5 w-3.5" /> 新建</button>
            <button onClick={() => void refreshData()} disabled={!workspaceId || loading} className="inline-flex items-center gap-1.5 rounded-md border border-neutral-200 px-3 py-2 text-[12px] disabled:opacity-50 dark:border-neutral-700"><RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} /> 刷新</button>
          </div>
        </div>

        {error && <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-[12px] text-red-600 dark:border-red-900 dark:bg-red-950/30">{error}</div>}

        {showPreview && (
          <div className="rounded-xl border border-neutral-200 bg-white p-4 shadow-sm dark:border-neutral-800 dark:bg-neutral-900">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap items-center gap-3 text-[12px] text-neutral-500">
                <span>注入预览（{previewScope}）</span>
                {preview && (<>
                  <span>· 字符 {preview.charCount.toLocaleString()}</span>
                  <span>· tokens≈{preview.tokenEstimate.toLocaleString()}</span>
                  <span>· memory {preview.itemCount}</span>
                  <span>· fact {preview.factCount}</span>
                </>)}
              </div>
              <select value={previewScope} onChange={(e) => setPreviewScope(e.target.value as "chat" | "workflow")} className="rounded-md border border-neutral-200 bg-transparent px-2 py-1 text-[12px] dark:border-neutral-700">
                <option value="chat">chat</option>
                <option value="workflow">workflow</option>
              </select>
            </div>
            <pre className="mt-3 max-h-72 overflow-auto whitespace-pre-wrap rounded-lg bg-neutral-50 p-3 text-[12px] leading-5 text-neutral-700 dark:bg-neutral-950 dark:text-neutral-300">{preview?.prompt || "（当前 scope 无可注入记忆）"}</pre>
          </div>
        )}

        {creating && (
          <div className="rounded-xl border border-neutral-200 bg-white p-4 shadow-sm dark:border-neutral-800 dark:bg-neutral-900">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-[13px] font-semibold text-neutral-900 dark:text-neutral-100">新建 memory_item</h2>
              <button onClick={() => { setCreating(false); setCreateDraft(DEFAULT_DRAFT); }} className="rounded-md border border-neutral-200 p-1 text-neutral-500 dark:border-neutral-700"><X className="h-3.5 w-3.5" /></button>
            </div>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
              <select value={createDraft.type} onChange={(e) => setCreateDraft((d) => ({ ...d, type: e.target.value as MemoryItemType }))} className="rounded-md border border-neutral-200 bg-transparent px-2 py-1.5 text-[12px] dark:border-neutral-700">
                <option value="constraint">constraint</option>
                <option value="experience">experience</option>
                <option value="episode">episode</option>
              </select>
              <select value={createDraft.scope} onChange={(e) => setCreateDraft((d) => ({ ...d, scope: e.target.value as Scope }))} className="rounded-md border border-neutral-200 bg-transparent px-2 py-1.5 text-[12px] dark:border-neutral-700">
                <option value="global">global</option>
                <option value="chat">chat</option>
                <option value="workflow">workflow</option>
              </select>
            </div>
            <input value={createDraft.title} onChange={(e) => setCreateDraft((d) => ({ ...d, title: e.target.value }))} placeholder="标题（必填）" className="mt-2 w-full rounded-md border border-neutral-200 bg-transparent px-2 py-1.5 text-[13px] dark:border-neutral-700" />
            <textarea value={createDraft.body} onChange={(e) => setCreateDraft((d) => ({ ...d, body: e.target.value }))} placeholder="正文 / 依据" className="mt-2 h-24 w-full resize-none rounded-md border border-neutral-200 bg-transparent px-2 py-1.5 text-[12px] dark:border-neutral-700" />
            <div className="mt-3 flex justify-end gap-2">
              <button onClick={() => { setCreating(false); setCreateDraft(DEFAULT_DRAFT); }} className="rounded-md border border-neutral-200 px-3 py-1.5 text-[12px] dark:border-neutral-700">取消</button>
              <button onClick={() => void submitCreate()} disabled={!createDraft.title.trim() || busyId === "__create__"} className="inline-flex items-center gap-1.5 rounded-md bg-neutral-900 px-3 py-1.5 text-[12px] text-white disabled:opacity-50 dark:bg-neutral-100 dark:text-neutral-900"><Save className="h-3.5 w-3.5" /> 保存</button>
            </div>
          </div>
        )}

        <div className="flex flex-wrap gap-2">
          {TYPE_TABS.map((t) => {
            const count = t.key === "fact" ? facts.filter((f) => f.enabled).length : t.key === "review" ? reviews.length : grouped.get(t.key as MemoryItemType)?.length ?? 0;
            const active = activeTab === t.key;
            return (
              <button key={t.key} onClick={() => setActiveTab(t.key)} title={t.hint} className={`inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-[12px] ${active ? "border-neutral-900 bg-neutral-900 text-white dark:border-neutral-100 dark:bg-neutral-100 dark:text-neutral-900" : "border-neutral-200 bg-white text-neutral-700 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-300"}`}>
                {t.label} <span className="rounded-full bg-black/10 px-1.5 py-0.5 text-[10.5px] dark:bg-white/10">{count}</span>
              </button>
            );
          })}
        </div>

        {(activeTab === "constraint" || activeTab === "experience" || activeTab === "episode") && (
          <div className="space-y-3">
            {visibleItems.length === 0 ? (
              <div className="rounded-xl border border-dashed border-neutral-300 bg-white p-12 text-center text-[13px] text-neutral-400 dark:border-neutral-800 dark:bg-neutral-900/40">暂无 {activeTab} 记忆。点击「新建」或等候 D-INGEST 候选复核入库。</div>
            ) : (visibleItems.map((item) => {
              const editing = editingId === item.id;
              const stale = item.validUntil !== null && item.validUntil !== undefined && item.validUntil < Date.now();
              return (
                <div key={item.id} className={`rounded-xl border bg-white p-4 shadow-sm dark:bg-neutral-900 ${item.enabled ? "border-neutral-200 dark:border-neutral-800" : "border-neutral-200 opacity-60 dark:border-neutral-800"}`}>
                  <div className="flex items-start gap-3">
                    <input type="checkbox" className="mt-1" checked={item.enabled} disabled={busyId === item.id} onChange={() => void toggleEnabled(item)} title="启用 / 停用" />
                    <div className="min-w-0 flex-1">
                      {editing ? (
                        <div className="space-y-2">
                          <input value={editDraft.title} onChange={(e) => setEditDraft((d) => ({ ...d, title: e.target.value }))} className="w-full rounded-md border border-neutral-200 bg-transparent px-2 py-1.5 text-[13px] dark:border-neutral-700" />
                          <textarea value={editDraft.body} onChange={(e) => setEditDraft((d) => ({ ...d, body: e.target.value }))} className="h-24 w-full resize-none rounded-md border border-neutral-200 bg-transparent px-2 py-1.5 text-[12px] dark:border-neutral-700" />
                          <select value={editDraft.scope} onChange={(e) => setEditDraft((d) => ({ ...d, scope: e.target.value as Scope }))} className="rounded-md border border-neutral-200 bg-transparent px-2 py-1.5 text-[12px] dark:border-neutral-700">
                            <option value="global">global</option>
                            <option value="chat">chat</option>
                            <option value="workflow">workflow</option>
                          </select>
                        </div>
                      ) : (
                        <>
                          <div className="flex flex-wrap items-center gap-2">
                            <h2 className="text-[13px] font-semibold text-neutral-900 dark:text-neutral-100">{item.title}</h2>
                            <span className="rounded border border-neutral-200 px-1.5 py-0.5 text-[10.5px] text-neutral-500 dark:border-neutral-700">{item.source}</span>
                            <span className="rounded border border-neutral-200 px-1.5 py-0.5 text-[10.5px] text-neutral-500 dark:border-neutral-700">{item.scope}</span>
                            <span className="rounded border border-neutral-200 px-1.5 py-0.5 text-[10.5px] text-neutral-500 dark:border-neutral-700">conf {item.confidence.toFixed(2)}</span>
                            {stale && <span className="rounded border border-amber-300 bg-amber-50 px-1.5 py-0.5 text-[10.5px] text-amber-700 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-300">已过期</span>}
                            {item.supersedesId && <span className="rounded border border-blue-200 px-1.5 py-0.5 text-[10.5px] text-blue-600 dark:border-blue-900 dark:text-blue-400">supersedes</span>}
                            {item.riskFlags.map((f, i) => (<RiskBadge key={i} flag={f} />))}
                          </div>
                          {item.body && <p className="mt-2 whitespace-pre-wrap text-[12px] leading-5 text-neutral-600 dark:text-neutral-400">{item.body}</p>}
                          <p className="mt-2 font-mono text-[10.5px] text-neutral-400">used {item.usedCount} · +{item.positiveSignals}/-{item.negativeSignals} · last {fmtTs(item.lastUsedAt)} · updated {fmtTs(item.updatedAt)}</p>
                        </>
                      )}
                    </div>
                    <div className="flex shrink-0 items-center gap-1.5">
                      {editing ? (
                        <>
                          <button onClick={() => void saveEdit(item.id)} disabled={!editDraft.title.trim() || busyId === item.id} className="inline-flex items-center gap-1 rounded-md bg-neutral-900 px-2 py-1.5 text-[12px] text-white disabled:opacity-50 dark:bg-neutral-100 dark:text-neutral-900"><Save className="h-3.5 w-3.5" /> 保存</button>
                          <button onClick={() => setEditingId(null)} className="inline-flex items-center gap-1 rounded-md border border-neutral-200 px-2 py-1.5 text-[12px] dark:border-neutral-700"><X className="h-3.5 w-3.5" /> 取消</button>
                        </>
                      ) : (
                        <>
                          <button onClick={() => void sendFeedback(item, "positive")} disabled={busyId === item.id} title="标记有用" className="inline-flex items-center gap-1 rounded-md border border-neutral-200 px-2 py-1.5 text-[12px] text-emerald-600 disabled:opacity-50 dark:border-neutral-700"><ThumbsUp className="h-3.5 w-3.5" /></button>
                          <button onClick={() => void sendFeedback(item, "negative")} disabled={busyId === item.id} title="标记有误" className="inline-flex items-center gap-1 rounded-md border border-neutral-200 px-2 py-1.5 text-[12px] text-red-600 disabled:opacity-50 dark:border-neutral-700"><ThumbsDown className="h-3.5 w-3.5" /></button>
                          <button onClick={() => startEdit(item)} className="inline-flex items-center gap-1 rounded-md border border-neutral-200 px-2 py-1.5 text-[12px] dark:border-neutral-700"><Pencil className="h-3.5 w-3.5" /> 编辑</button>
                          <button onClick={() => void deleteItem(item)} disabled={busyId === item.id} className="inline-flex items-center gap-1 rounded-md border border-red-200 px-2 py-1.5 text-[12px] text-red-600 disabled:opacity-50 dark:border-red-900 dark:text-red-400"><Trash2 className="h-3.5 w-3.5" /> 删除</button>
                        </>
                      )}
                    </div>
                  </div>
                </div>
              );
            }))}
          </div>
        )}

        {activeTab === "fact" && (
          <div className="space-y-3">
            {facts.length === 0 ? (
              <div className="rounded-xl border border-dashed border-neutral-300 bg-white p-12 text-center text-[13px] text-neutral-400 dark:border-neutral-800 dark:bg-neutral-900/40">暂无 fact 投影。在 BusinessContext / Indicators / FolderPaths(reference) 配置后这里会出现。</div>
            ) : (facts.map((f) => (
              <div key={f.id} className={`rounded-xl border bg-white p-4 shadow-sm dark:bg-neutral-900 ${f.enabled ? "border-neutral-200 dark:border-neutral-800" : "border-neutral-200 opacity-60 dark:border-neutral-800"}`}>
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="text-[13px] font-semibold text-neutral-900 dark:text-neutral-100">{f.title}</h2>
                  <span className="rounded border border-blue-200 px-1.5 py-0.5 text-[10.5px] text-blue-600 dark:border-blue-900 dark:text-blue-400">{f.factKind}</span>
                  {!f.enabled && <span className="rounded border border-neutral-200 px-1.5 py-0.5 text-[10.5px] text-neutral-400 dark:border-neutral-700">已停用</span>}
                </div>
                {f.body && <p className="mt-2 whitespace-pre-wrap text-[12px] leading-5 text-neutral-600 dark:text-neutral-400">{f.body}</p>}
                <p className="mt-2 font-mono text-[10.5px] text-neutral-400">投影只读 · 在原始面板（BusinessContext / Indicators / FolderPaths）维护 · updated {fmtTs(f.updatedAt)}</p>
              </div>
            )))}
          </div>
        )}

        {activeTab === "review" && (
          <div className="space-y-3">
            <div className="flex items-center gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-[12px] text-amber-700 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-300">
              <Inbox className="h-3.5 w-3.5" /> D-INGEST 候选复核：通过门禁但未自动入库的条目，需人工裁决。
            </div>
            {reviews.length === 0 ? (
              <div className="rounded-xl border border-dashed border-neutral-300 bg-white p-12 text-center text-[13px] text-neutral-400 dark:border-neutral-800 dark:bg-neutral-900/40">暂无 pending 候选。</div>
            ) : (reviews.map((r) => (
              <div key={r.id} className="rounded-xl border border-amber-200 bg-white p-4 shadow-sm dark:border-amber-900 dark:bg-neutral-900">
                <div className="flex items-start gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="text-[13px] font-semibold text-neutral-900 dark:text-neutral-100">{r.title}</h2>
                      <span className="rounded border border-neutral-200 px-1.5 py-0.5 text-[10.5px] text-neutral-500 dark:border-neutral-700">{r.type}</span>
                      <span className="rounded border border-neutral-200 px-1.5 py-0.5 text-[10.5px] text-neutral-500 dark:border-neutral-700">{r.scope}</span>
                      <span className="rounded border border-neutral-200 px-1.5 py-0.5 text-[10.5px] text-neutral-500 dark:border-neutral-700">conf {r.confidence.toFixed(2)}</span>
                      {r.riskFlags.map((f, i) => (<RiskBadge key={i} flag={f} />))}
                    </div>
                    {r.body && <p className="mt-2 whitespace-pre-wrap text-[12px] leading-5 text-neutral-600 dark:text-neutral-400">{r.body}</p>}
                    {r.reason && <p className="mt-2 text-[11.5px] text-amber-700 dark:text-amber-300">门禁理由：{r.reason}</p>}
                    <p className="mt-2 font-mono text-[10.5px] text-neutral-400">created {fmtTs(r.createdAt)}{r.targetKind ? ` · target ${r.targetKind}:${r.targetId ?? ""}` : ""}</p>
                  </div>
                  <div className="flex shrink-0 items-center gap-1.5">
                    <button onClick={() => void acceptReview(r)} disabled={busyId === r.id} className="inline-flex items-center gap-1 rounded-md bg-emerald-600 px-2 py-1.5 text-[12px] text-white disabled:opacity-50"><Save className="h-3.5 w-3.5" /> 采纳</button>
                    <button onClick={() => void rejectReview(r)} disabled={busyId === r.id} className="inline-flex items-center gap-1 rounded-md border border-red-200 px-2 py-1.5 text-[12px] text-red-600 disabled:opacity-50 dark:border-red-900 dark:text-red-400"><X className="h-3.5 w-3.5" /> 拒绝</button>
                  </div>
                </div>
              </div>
            )))}
          </div>
        )}
      </div>
    </div>
  );
}
