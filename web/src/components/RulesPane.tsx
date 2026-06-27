// Agent-D 阶段3 统一记忆面板（规则记忆重构 v2）
// 替换原 RulesPane（旧 RuleMemory CRUD）：按 type 列 memory_items（constraint/experience/episode），
// 提供 CRUD + 启用 + 注入预览（GET /memory/preview）+ 反馈（positive/negative）+ review 复核队列。
// fact 维度由 business_context / metric / reference 各自原生面板维护，本页只读展示投影。
// 数据安全：本页所有内容均为 LLM 衍生 / 用户手写记忆，不接触 draw_data。

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Activity,
  AlertTriangle,
  ArrowUpCircle,
  Brain,
  Eye,
  Inbox,
  Pencil,
  Plus,
  RefreshCw,
  Save,
  Sparkles,
  Tag,
  ThumbsDown,
  ThumbsUp,
  Trash2,
  Wrench,
  X,
} from "lucide-react";
import { api } from "@/lib/api";
import type { MemoryMaintenanceResult, MemoryToSkillResult } from "@/lib/api/engine";
import type {
  AgingConflictPair,
  AgingSignalSeverity,
  AgingStaleReference,
  MemoryAgingSignalsResult,
} from "@/lib/api/data";
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
  tags: string;
}

interface EditDraft {
  title: string;
  body: string;
  scope: Scope;
  tags: string;
}

const TYPE_TABS: { key: TabKey; label: string; hint: string }[] = [
  { key: "constraint", label: "constraint", hint: "硬约束 / 必须遵守" },
  { key: "experience", label: "experience", hint: "经验 / 偏好（含原 case）" },
  { key: "episode", label: "episode", hint: "事件 / 一次性情境" },
  { key: "fact", label: "fact (投影)", hint: "business_context / metric / reference 投影，只读" },
  { key: "review", label: "review", hint: "D-INGEST 候选复核队列" },
];

const DEFAULT_DRAFT: CreateDraft = { type: "experience", title: "", body: "", scope: "global", tags: "" };

function fmtTs(ts: number | null): string {
  if (!ts) return "—";
  return new Date(ts).toLocaleString();
}

// CSV tags 输入解析（与 KnowledgeBasePane parseTags 范式一致）：逗号分隔，trim + 去空 + 去重。
function parseCsvTags(s: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of s.split(",")) {
    const t = raw.trim();
    if (t && !seen.has(t)) { seen.add(t); out.push(t); }
  }
  return out;
}

// 分层着色：按软约定前缀（task:/industry:/method:/data:/problem:）给 tag chip 配色。
function tagTone(tag: string): string {
  const prefix = tag.includes(":") ? tag.slice(0, tag.indexOf(":")) : "";
  switch (prefix) {
    case "task": return "border-violet-200 bg-violet-50 text-violet-700 dark:border-violet-900 dark:bg-violet-950/30 dark:text-violet-300";
    case "industry": return "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-300";
    case "method": return "border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-900 dark:bg-blue-950/30 dark:text-blue-300";
    case "data": return "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-300";
    case "problem": return "border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-900 dark:bg-rose-950/30 dark:text-rose-300";
    default: return "border-neutral-200 bg-neutral-50 text-neutral-600 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-300";
  }
}

function TagChip({ tag }: { tag: string }) {
  return <span className={`inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[10.5px] ${tagTone(tag)}`}><Tag className="h-2.5 w-2.5" />{tag}</span>;
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
  // 模拟检索控件：显式 tag 硬过滤（filterTags）+ 可选 query（boost 信号）。
  const [previewTags, setPreviewTags] = useState<Set<string>>(new Set());
  const [previewQuery, setPreviewQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<EditDraft>({ title: "", body: "", scope: "global", tags: "" });
  const [creating, setCreating] = useState(false);
  const [createDraft, setCreateDraft] = useState<CreateDraft>(DEFAULT_DRAFT);
  const [showPreview, setShowPreview] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [tagFilter, setTagFilter] = useState<Set<string>>(new Set());

  // 缺口3：立即维护（Dream Worker 纯算术，零 LLM）。先 dryRun 预览升/降/退役明细，确认后写库。
  const [maintainPreview, setMaintainPreview] = useState<MemoryMaintenanceResult | null>(null);
  const [maintainBusy, setMaintainBusy] = useState(false);
  const [maintainNote, setMaintainNote] = useState("");
  // 缺口4：升级 Skill。dryRun 列 eligible 簇 + 理由，确认后执行（产 candidate 不自动启用）。
  const [promotePreview, setPromotePreview] = useState<MemoryToSkillResult | null>(null);
  const [promoteBusy, setPromoteBusy] = useState(false);
  const [promoteNote, setPromoteNote] = useState("");

  // D-AGING2 老化信号展示：纯本地算法扫干扰对 + 修订回扫；read-only 不写库不发 LLM。
  const [aging, setAging] = useState<MemoryAgingSignalsResult | null>(null);
  const [agingBusy, setAgingBusy] = useState(false);
  const [agingShow, setAgingShow] = useState(false);

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
      const previewData = await api.previewMemoryPrompt(workspaceId, {
        targetScope: previewScope,
        query: previewQuery.trim() || undefined,
        tags: previewTags.size ? [...previewTags] : undefined,
      });
      setPreview(previewData);
    } catch (err) {
      setError(String(err instanceof Error ? err.message : err));
    }
  }, [workspaceId, previewScope, previewQuery, previewTags]);

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

  const baseVisibleItems =
    activeTab === "constraint" || activeTab === "experience" || activeTab === "episode"
      ? grouped.get(activeTab) ?? []
      : [];

  // 当前 type 下出现过的全部 tag（供筛选 chip）。
  const availableTags = useMemo(() => {
    const s = new Set<string>();
    for (const it of baseVisibleItems) for (const t of it.tags) s.add(t);
    return [...s].sort();
  }, [baseVisibleItems]);

  // 跨 type 全部 tag（供注入预览「模拟检索」精筛，预览不分 type 故取全量）。
  const allTags = useMemo(() => {
    const s = new Set<string>();
    for (const it of items) for (const t of it.tags) s.add(t);
    return [...s].sort();
  }, [items]);

  const togglePreviewTag = (tag: string) => {
    setPreviewTags((prev) => {
      const next = new Set(prev);
      if (next.has(tag)) next.delete(tag); else next.add(tag);
      return next;
    });
  };

  // 多选 AND 过滤：选中的 tag 全部命中才保留（精筛语义，与检索预过滤同向）。
  const visibleItems = useMemo(() => {
    if (tagFilter.size === 0) return baseVisibleItems;
    return baseVisibleItems.filter((it) => {
      const itTags = new Set(it.tags);
      for (const t of tagFilter) if (!itTags.has(t)) return false;
      return true;
    });
  }, [baseVisibleItems, tagFilter]);

  const toggleTagFilter = (tag: string) => {
    setTagFilter((prev) => {
      const next = new Set(prev);
      if (next.has(tag)) next.delete(tag); else next.add(tag);
      return next;
    });
  };

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
    setEditDraft({ title: item.title, body: item.body, scope: item.scope, tags: item.tags.join(", ") });
  };

  const saveEdit = async (id: string) => {
    if (!workspaceId || !editDraft.title.trim()) return;
    setBusyId(id);
    try {
      const updated = await api.updateMemoryItem(workspaceId, id, {
        title: editDraft.title.trim(),
        body: editDraft.body,
        scope: editDraft.scope,
        tags: parseCsvTags(editDraft.tags),
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
        tags: parseCsvTags(createDraft.tags),
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

  // 缺口3：dryRun 拉拟调整明细（升/降/退役 + before/after + reason），不落库。
  const runMaintainDryRun = async () => {
    if (!workspaceId || maintainBusy) return;
    setMaintainBusy(true);
    setMaintainNote("");
    setError("");
    try {
      const out = await api.maintainMemory(workspaceId, { dryRun: true });
      setMaintainPreview(out);
      if (out.changes.length === 0) {
        setMaintainNote(`扫描 ${out.scanned} 条，暂无可调整记忆。`);
      }
    } catch (err) {
      setError(String(err instanceof Error ? err.message : err));
    } finally {
      setMaintainBusy(false);
    }
  };

  // 缺口3：确认执行写库，刷新列表反映新的 confidence/validUntil。
  const applyMaintain = async () => {
    if (!workspaceId || maintainBusy) return;
    if (!maintainPreview || maintainPreview.changes.length === 0) return;
    if (!window.confirm(`即将对 ${maintainPreview.changes.length} 条记忆应用维护（升/降 confidence、老化退役），是否继续？`)) return;
    setMaintainBusy(true);
    setError("");
    try {
      const out = await api.maintainMemory(workspaceId, { dryRun: false });
      setMaintainNote(`已应用 ${out.applied} / ${out.changes.length} 条调整。`);
      setMaintainPreview(null);
      await refreshData();
      await refreshPreview();
      onRulesChanged?.();
    } catch (err) {
      setError(String(err instanceof Error ? err.message : err));
    } finally {
      setMaintainBusy(false);
    }
  };

  // 缺口4：dryRun 列 eligible 簇（tag/reasons/highConfidenceCount/totalUsedCount/items.length），不写 registry。
  const runPromoteDryRun = async () => {
    if (!workspaceId || promoteBusy) return;
    setPromoteBusy(true);
    setPromoteNote("");
    setError("");
    try {
      const out = await api.promoteMemorySkills(workspaceId, { dryRun: true });
      setPromotePreview(out);
      if (out.eligibleClusters === 0) {
        setPromoteNote(`扫描 experience ${out.scanned} 条 / 共 ${out.clusters.length} 簇，暂无达阈值簇可升级。可在 RulesPane 给经验打 method: / task: 标签积累。`);
      }
    } catch (err) {
      setError(String(err instanceof Error ? err.message : err));
    } finally {
      setPromoteBusy(false);
    }
  };

  // 缺口4：确认执行，调 LLM 蒸馏 → 入 skill registry status=candidate（不自动启用）。
  const applyPromote = async () => {
    if (!workspaceId || promoteBusy) return;
    if (!promotePreview || promotePreview.eligibleClusters === 0) return;
    if (!window.confirm(`即将把 ${promotePreview.eligibleClusters} 个 eligible 簇蒸馏为 Skill 候选（status=candidate，不会自动启用）。\n会调用 LLM，是否继续？`)) return;
    setPromoteBusy(true);
    setError("");
    try {
      const out = await api.promoteMemorySkills(workspaceId, { dryRun: false });
      setPromoteNote(`已产出 ${out.promotions.length} 个 Skill 候选（status=candidate）。请到「实验场 → Skill → Registry 候选」选择 candidate 跑 baseline 对照，再采纳或弃用。`);
      setPromotePreview(null);
    } catch (err) {
      setError(String(err instanceof Error ? err.message : err));
    } finally {
      setPromoteBusy(false);
    }
  };

  // D-AGING2 老化信号：read-only fetch；点按钮按需触发 + 同步切显示。
  const loadAgingSignals = async () => {
    if (!workspaceId || agingBusy) return;
    if (agingShow) { setAgingShow(false); return; }
    setAgingBusy(true);
    setError("");
    try {
      const out = await api.fetchMemoryAgingSignals(workspaceId);
      setAging(out);
      setAgingShow(true);
    } catch (err) {
      setError(String(err instanceof Error ? err.message : err));
    } finally {
      setAgingBusy(false);
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
          <div className="flex flex-wrap gap-2">
            <button onClick={() => void runMaintainDryRun()} disabled={!workspaceId || maintainBusy} title="Dream Worker 纯算术维护：升/降 confidence + 老化退役（先预览再应用）" className="inline-flex items-center gap-1.5 rounded-md border border-neutral-200 px-3 py-2 text-[12px] disabled:opacity-50 dark:border-neutral-700"><Wrench className={`h-3.5 w-3.5 ${maintainBusy ? "animate-spin" : ""}`} /> 立即维护</button>
            <button onClick={() => void runPromoteDryRun()} disabled={!workspaceId || promoteBusy} title="把高频 experience 簇升级为 Skill 候选（status=candidate，不自动启用）" className="inline-flex items-center gap-1.5 rounded-md border border-neutral-200 px-3 py-2 text-[12px] disabled:opacity-50 dark:border-neutral-700"><ArrowUpCircle className={`h-3.5 w-3.5 ${promoteBusy ? "animate-spin" : ""}`} /> 升级 Skill</button>
            <button onClick={() => void loadAgingSignals()} disabled={!workspaceId || agingBusy} title="D-AGING2 记忆老化巡检：扫卡冲突 + 修订回扫，纯本地零 LLM" className="inline-flex items-center gap-1.5 rounded-md border border-neutral-200 px-3 py-2 text-[12px] disabled:opacity-50 dark:border-neutral-700"><Activity className={`h-3.5 w-3.5 ${agingBusy ? "animate-spin" : ""}`} /> {agingShow ? "隐藏" : "查看"}老化信号</button>
            <button onClick={() => setShowPreview((v) => !v)} className="inline-flex items-center gap-1.5 rounded-md border border-neutral-200 px-3 py-2 text-[12px] dark:border-neutral-700"><Eye className="h-3.5 w-3.5" /> {showPreview ? "隐藏" : "预览"}注入</button>
            <button onClick={() => setCreating((v) => !v)} disabled={!workspaceId} className="inline-flex items-center gap-1.5 rounded-md bg-neutral-900 px-3 py-2 text-[12px] text-white disabled:opacity-50 dark:bg-neutral-100 dark:text-neutral-900"><Plus className="h-3.5 w-3.5" /> 新建</button>
            <button onClick={() => void refreshData()} disabled={!workspaceId || loading} className="inline-flex items-center gap-1.5 rounded-md border border-neutral-200 px-3 py-2 text-[12px] disabled:opacity-50 dark:border-neutral-700"><RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} /> 刷新</button>
          </div>
        </div>

        {error && <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-[12px] text-red-600 dark:border-red-900 dark:bg-red-950/30">{error}</div>}

        {agingShow && aging && (
          <div className="rounded-xl border border-neutral-200 bg-white p-4 shadow-sm dark:border-neutral-800 dark:bg-neutral-900">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-neutral-900 dark:text-neutral-100"><Activity className="h-3.5 w-3.5" /> 记忆老化信号（D-AGING2 · 纯本地 / 零 LLM）</h2>
              <button onClick={() => setAgingShow(false)} className="inline-flex items-center gap-1 rounded-md border border-neutral-200 px-2 py-1.5 text-[12px] dark:border-neutral-700"><X className="h-3.5 w-3.5" /> 关闭</button>
            </div>
            <p className="mt-1 text-[11.5px] text-neutral-500">扫描 {aging.scanned} 条{aging.truncated && "（已截断到 600）"} · 卡冲突 {aging.conflicts.length} 对 · 修订回扫 {aging.staleRefs.length} 条 · {fmtTs(aging.generatedAt)}</p>
            {aging.conflicts.length === 0 && aging.staleRefs.length === 0 && (
              <p className="mt-3 text-[12px] text-neutral-500">未发现卡冲突或事实修订引用残留，记忆健康。</p>
            )}
            {aging.conflicts.length > 0 && (
              <div className="mt-3">
                <h3 className="text-[12px] font-semibold text-neutral-700 dark:text-neutral-200">卡冲突（相近条目可能在检索时互相挤占）</h3>
                <div className="mt-1.5 max-h-72 space-y-1.5 overflow-auto">
                  {aging.conflicts.slice(0, 50).map((c) => <ConflictRow key={c.pairId} c={c} />)}
                </div>
                {aging.conflicts.length > 50 && (
                  <p className="mt-1 text-[11px] text-neutral-500">仅显示前 50 对，共 {aging.conflicts.length} 对。</p>
                )}
              </div>
            )}
            {aging.staleRefs.length > 0 && (
              <div className="mt-4">
                <h3 className="text-[12px] font-semibold text-neutral-700 dark:text-neutral-200">事实修订回扫（supersede 链上仍被引用 / 未失效）</h3>
                <div className="mt-1.5 max-h-72 space-y-1.5 overflow-auto">
                  {aging.staleRefs.slice(0, 50).map((r) => <StaleRefRow key={`${r.newerId}:${r.olderId}`} r={r} />)}
                </div>
                {aging.staleRefs.length > 50 && (
                  <p className="mt-1 text-[11px] text-neutral-500">仅显示前 50 条，共 {aging.staleRefs.length} 条。</p>
                )}
              </div>
            )}
          </div>
        )}

        {(maintainPreview || maintainNote) && (
          <div className="rounded-xl border border-neutral-200 bg-white p-4 shadow-sm dark:border-neutral-800 dark:bg-neutral-900">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-neutral-900 dark:text-neutral-100"><Wrench className="h-3.5 w-3.5" /> 维护预览（Dream Worker · 纯算术 / 零 LLM）</h2>
              <div className="flex gap-2">
                {maintainPreview && maintainPreview.changes.length > 0 && (
                  <button onClick={() => void applyMaintain()} disabled={maintainBusy} className="inline-flex items-center gap-1.5 rounded-md bg-neutral-900 px-3 py-1.5 text-[12px] text-white disabled:opacity-50 dark:bg-neutral-100 dark:text-neutral-900"><Save className="h-3.5 w-3.5" /> 应用 {maintainPreview.changes.length} 条</button>
                )}
                <button onClick={() => { setMaintainPreview(null); setMaintainNote(""); }} className="inline-flex items-center gap-1 rounded-md border border-neutral-200 px-2 py-1.5 text-[12px] dark:border-neutral-700"><X className="h-3.5 w-3.5" /> 关闭</button>
              </div>
            </div>
            {maintainPreview && (
              <p className="mt-1 text-[11.5px] text-neutral-500">扫描 {maintainPreview.scanned} 条 · 拟调整 {maintainPreview.changes.length} 条 · dryRun={String(maintainPreview.dryRun)}</p>
            )}
            {maintainNote && <p className="mt-2 text-[12px] text-neutral-600 dark:text-neutral-300">{maintainNote}</p>}
            {maintainPreview && maintainPreview.changes.length > 0 && (
              <div className="mt-3 max-h-72 space-y-1.5 overflow-auto">
                {maintainPreview.changes.map((c) => {
                  const tone = c.action === "promote"
                    ? "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-300"
                    : c.action === "demote"
                      ? "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-300"
                      : "border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-900 dark:bg-rose-950/30 dark:text-rose-300";
                  return (
                    <div key={c.id} className="rounded-md border border-neutral-200 bg-neutral-50/60 px-3 py-2 text-[12px] dark:border-neutral-800 dark:bg-neutral-950/40">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className={`rounded border px-1.5 py-0.5 text-[10.5px] uppercase ${tone}`}>{c.action}</span>
                        <code className="font-mono text-[11px] text-neutral-500">{c.id}</code>
                        <span className="text-[11px] text-neutral-500">
                          conf {c.before.confidence.toFixed(2)} → {c.after.confidence.toFixed(2)}
                          {c.before.validUntil !== c.after.validUntil && (
                            <> · validUntil {c.before.validUntil ? fmtTs(c.before.validUntil) : "—"} → {c.after.validUntil ? fmtTs(c.after.validUntil) : "—"}</>
                          )}
                        </span>
                      </div>
                      <p className="mt-1 text-[11.5px] text-neutral-500">{c.reason}</p>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {(promotePreview || promoteNote) && (
          <div className="rounded-xl border border-neutral-200 bg-white p-4 shadow-sm dark:border-neutral-800 dark:bg-neutral-900">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-neutral-900 dark:text-neutral-100"><Sparkles className="h-3.5 w-3.5" /> 升级 Skill 预览（experience 簇 → registry candidate）</h2>
              <div className="flex gap-2">
                {promotePreview && promotePreview.eligibleClusters > 0 && (
                  <button onClick={() => void applyPromote()} disabled={promoteBusy} className="inline-flex items-center gap-1.5 rounded-md bg-neutral-900 px-3 py-1.5 text-[12px] text-white disabled:opacity-50 dark:bg-neutral-100 dark:text-neutral-900"><Save className="h-3.5 w-3.5" /> 执行 {promotePreview.eligibleClusters} 簇</button>
                )}
                <button onClick={() => { setPromotePreview(null); setPromoteNote(""); }} className="inline-flex items-center gap-1 rounded-md border border-neutral-200 px-2 py-1.5 text-[12px] dark:border-neutral-700"><X className="h-3.5 w-3.5" /> 关闭</button>
              </div>
            </div>
            {promotePreview && (
              <p className="mt-1 text-[11.5px] text-neutral-500">扫描 experience {promotePreview.scanned} 条 · 共 {promotePreview.clusters.length} 簇 · eligible {promotePreview.eligibleClusters} · dryRun={String(promotePreview.dryRun)}</p>
            )}
            <p className="mt-1 text-[11px] text-amber-700 dark:text-amber-300">执行后只入 skill registry candidate 状态，不会自动启用。请到「实验场 → Skill → Registry 候选」评测后再决定是否激活。</p>
            {promoteNote && <p className="mt-2 text-[12px] text-neutral-600 dark:text-neutral-300">{promoteNote}</p>}
            {promotePreview && promotePreview.clusters.length > 0 && (
              <div className="mt-3 max-h-80 space-y-2 overflow-auto">
                {promotePreview.clusters.map((c) => (
                  <div key={c.tag} className={`rounded-md border px-3 py-2 text-[12px] ${c.eligible ? "border-emerald-200 bg-emerald-50/60 dark:border-emerald-900 dark:bg-emerald-950/20" : "border-neutral-200 bg-neutral-50/60 dark:border-neutral-800 dark:bg-neutral-950/40"}`}>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={`rounded border px-1.5 py-0.5 text-[10.5px] ${c.eligible ? "border-emerald-300 bg-white text-emerald-700 dark:border-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-200" : "border-neutral-300 bg-white text-neutral-500 dark:border-neutral-600 dark:bg-neutral-900 dark:text-neutral-400"}`}>{c.eligible ? "eligible" : "未达阈值"}</span>
                      <TagChip tag={c.tag} />
                      <span className="text-[11px] text-neutral-500">{c.items.length} 条 · 高置信 {c.highConfidenceCount} · used {c.totalUsedCount} · +{c.totalPositiveSignals}</span>
                    </div>
                    <ul className="mt-1.5 list-disc pl-5 text-[11.5px] text-neutral-500">
                      {c.reasons.map((r, i) => (<li key={i}>{r}</li>))}
                    </ul>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

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
            <div className="mt-3 space-y-2 rounded-lg border border-dashed border-neutral-200 bg-neutral-50/60 p-3 dark:border-neutral-700 dark:bg-neutral-950/40">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[11px] text-neutral-500">模拟检索 · tag 硬过滤</span>
                {(previewTags.size > 0 || previewQuery) && (
                  <button onClick={() => { setPreviewTags(new Set()); setPreviewQuery(""); }} className="text-[11px] text-neutral-400 underline-offset-2 hover:underline">清除</button>
                )}
              </div>
              {allTags.length > 0 ? (
                <div className="flex flex-wrap gap-1">
                  {allTags.map((t) => {
                    const on = previewTags.has(t);
                    return (
                      <button key={t} onClick={() => togglePreviewTag(t)} className={`inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[10.5px] ${on ? "border-neutral-900 bg-neutral-900 text-white dark:border-neutral-100 dark:bg-neutral-100 dark:text-neutral-900" : tagTone(t)}`}>{t}</button>
                    );
                  })}
                </div>
              ) : (
                <p className="text-[11px] text-neutral-400">暂无 tag（给记忆条目打标签后可在此精筛）</p>
              )}
              <input
                value={previewQuery}
                onChange={(e) => setPreviewQuery(e.target.value)}
                placeholder="可选 query（boost 信号，影响打分排序，不硬过滤）"
                className="w-full rounded-md border border-neutral-200 bg-transparent px-2 py-1 text-[12px] dark:border-neutral-700"
              />
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
            <input value={createDraft.tags} onChange={(e) => setCreateDraft((d) => ({ ...d, tags: e.target.value }))} placeholder="标签（逗号分隔，软约定前缀 task: / industry: / method: / data: / problem:）" className="mt-2 w-full rounded-md border border-neutral-200 bg-transparent px-2 py-1.5 text-[12px] dark:border-neutral-700" />
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

        {(activeTab === "constraint" || activeTab === "experience" || activeTab === "episode") && availableTags.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="inline-flex items-center gap-1 text-[11.5px] text-neutral-400"><Tag className="h-3 w-3" /> 按标签筛选</span>
            {availableTags.map((t) => {
              const on = tagFilter.has(t);
              return (
                <button key={t} onClick={() => toggleTagFilter(t)} className={`inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[10.5px] ${on ? "border-neutral-900 bg-neutral-900 text-white dark:border-neutral-100 dark:bg-neutral-100 dark:text-neutral-900" : tagTone(t)}`}>{t}</button>
              );
            })}
            {tagFilter.size > 0 && <button onClick={() => setTagFilter(new Set())} className="inline-flex items-center gap-1 rounded border border-neutral-200 px-1.5 py-0.5 text-[10.5px] text-neutral-500 dark:border-neutral-700"><X className="h-2.5 w-2.5" /> 清除</button>}
          </div>
        )}

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
                          <input value={editDraft.tags} onChange={(e) => setEditDraft((d) => ({ ...d, tags: e.target.value }))} placeholder="标签（逗号分隔，前缀 task:/industry:/method:/data:/problem:）" className="w-full rounded-md border border-neutral-200 bg-transparent px-2 py-1.5 text-[12px] dark:border-neutral-700" />
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
                          {item.tags.length > 0 && <div className="mt-2 flex flex-wrap gap-1">{item.tags.map((t) => <TagChip key={t} tag={t} />)}</div>}
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
                    {r.tags.length > 0 && <div className="mt-2 flex flex-wrap gap-1">{r.tags.map((t) => <TagChip key={t} tag={t} />)}</div>}
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
// ── D-AGING2 老化信号渲染子组件 ──────────────────────────────────────────────

function severityTone(s: AgingSignalSeverity): string {
  if (s === "critical") return "border-rose-300 bg-rose-50 text-rose-700 dark:border-rose-800 dark:bg-rose-950/30 dark:text-rose-300";
  if (s === "warn") return "border-amber-300 bg-amber-50 text-amber-700 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-300";
  return "border-neutral-200 bg-neutral-50 text-neutral-600 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-300";
}

function conflictReasonLabel(r: AgingConflictPair["reasons"][number]): string {
  switch (r) {
    case "high-similarity": return "相似度高";
    case "confidence-divergence": return "置信度分歧";
    case "signal-divergence": return "正负反馈相反";
  }
}

function ConflictRow({ c }: { c: AgingConflictPair }) {
  return (
    <div className="rounded-md border border-neutral-200 bg-neutral-50/60 px-3 py-2 text-[12px] dark:border-neutral-800 dark:bg-neutral-950/40">
      <div className="flex flex-wrap items-center gap-2">
        <span className={`rounded border px-1.5 py-0.5 text-[10.5px] uppercase ${severityTone(c.severity)}`}>{c.severity}</span>
        <span className="rounded border border-neutral-300 bg-white px-1.5 py-0.5 text-[10.5px] text-neutral-600 dark:border-neutral-600 dark:bg-neutral-900 dark:text-neutral-300">{c.type}</span>
        <span className="text-[11px] text-neutral-500">similarity {c.similarity}</span>
        {c.reasons.map((r) => (
          <span key={r} className="rounded border border-neutral-200 bg-white px-1.5 py-0.5 text-[10.5px] text-neutral-600 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-300">{conflictReasonLabel(r)}</span>
        ))}
      </div>
      <p className="mt-1.5 text-[12px] text-neutral-700 dark:text-neutral-200">A · {c.itemATitle}</p>
      <p className="mt-0.5 text-[12px] text-neutral-700 dark:text-neutral-200">B · {c.itemBTitle}</p>
      {c.sharedTags.length > 0 && (
        <div className="mt-1.5 flex flex-wrap gap-1">
          {c.sharedTags.map((t) => <TagChip key={t} tag={t} />)}
        </div>
      )}
      <p className="mt-1 font-mono text-[10.5px] text-neutral-400">{c.itemAId} ↔ {c.itemBId}</p>
    </div>
  );
}

function StaleRefRow({ r }: { r: AgingStaleReference }) {
  return (
    <div className="rounded-md border border-neutral-200 bg-neutral-50/60 px-3 py-2 text-[12px] dark:border-neutral-800 dark:bg-neutral-950/40">
      <div className="flex flex-wrap items-center gap-2">
        <span className={`rounded border px-1.5 py-0.5 text-[10.5px] uppercase ${severityTone(r.severity)}`}>{r.severity}</span>
        <span className="rounded border border-neutral-200 bg-white px-1.5 py-0.5 text-[10.5px] text-neutral-600 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-300">
          {r.olderStillActive ? "旧记忆仍激活" : "旧记忆已退役"}
        </span>
        <span className="rounded border border-neutral-200 bg-white px-1.5 py-0.5 text-[10.5px] text-neutral-600 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-300">
          下游引用 {r.referencerIds.length}
        </span>
      </div>
      <p className="mt-1.5 text-[12px] text-neutral-700 dark:text-neutral-200">新 · {r.newerTitle}</p>
      <p className="mt-0.5 text-[12px] text-neutral-500 line-through">旧 · {r.olderTitle}</p>
      {r.referencerTitles.length > 0 && (
        <div className="mt-1.5">
          <p className="text-[11px] text-neutral-500">引用旧记忆的下游卡：</p>
          <ul className="mt-0.5 list-disc pl-4 text-[12px] text-neutral-600 dark:text-neutral-300">
            {r.referencerTitles.map((t, i) => <li key={`${r.referencerIds[i]}:${i}`}>{t}</li>)}
          </ul>
        </div>
      )}
      <p className="mt-1 font-mono text-[10.5px] text-neutral-400">{r.newerId} ⇐ {r.olderId}</p>
    </div>
  );
}
