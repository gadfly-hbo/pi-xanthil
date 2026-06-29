import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, BookOpen, Building2, CheckCircle2, Download, FileClock, History, Pencil, Plus, RefreshCw, Save, ShieldAlert, Trash2, Upload, X } from "lucide-react";
import { api } from "@/lib/api";
import { sharedApi } from "@/lib/api/shared";
import { vizApi, type BusinessContextInjectionTrace } from "@/lib/api/viz";
import type { BusinessContext, BusinessContextCategory, BusinessContextConflict, BusinessContextImportCommitResult, BusinessContextImportFormat, BusinessContextImportPreview } from "@/types";

const CATEGORIES: { id: BusinessContextCategory; label: string; hint: string }[] = [
  { id: "org", label: "组织/主体", hint: "公司/部门是谁、所处行业、规模、商业模式" },
  { id: "status", label: "业务现状", hint: "当前阶段、核心矛盾、近期变化（如刚调价、刚换系统）" },
  { id: "glossary", label: "术语/口径", hint: "内部黑话、指标的业务含义、特殊定义" },
  { id: "constraint", label: "约束/红线", hint: "哪些不能做、合规要求、数据敏感点" },
  { id: "history", label: "历史/背景", hint: "关键事件、已知结论、踩过的坑" },
  { id: "goal", label: "目标/期望", hint: "这次分析/决策真正想解决什么" },
];

const CATEGORY_LABEL: Record<BusinessContextCategory, string> = Object.fromEntries(CATEGORIES.map((c) => [c.id, c.label])) as Record<BusinessContextCategory, string>;

type ViewMode = "manage" | "governance" | "import_export" | "traces" | "readme";

interface EditDraft {
  category: BusinessContextCategory;
  title: string;
  content: string;
  source: string;
  owner: string;
  validFrom: string;
  validUntil: string;
}

const EMPTY_DRAFT: EditDraft = { category: "status", title: "", content: "", source: "", owner: "", validFrom: "", validUntil: "" };

const IMPLEMENTED_FEATURES = [
  { title: "六类业务背景", body: "按组织/主体、业务现状、术语/口径、约束/红线、历史/背景、目标/期望维护关键事实。" },
  { title: "全局池复用", body: "业务环境条目在全局池中管理，可以跨工作区复用；删除会影响所有工作区。" },
  { title: "工作区启停", body: "同一条业务环境可以在不同工作区分别启用或停用，避免不同项目混用背景。" },
  { title: "时效治理", body: "支持来源、负责人、有效期；过期条目不会继续进入 system prompt。" },
  { title: "冲突治理", body: "展示重复标题、相似内容、约束/目标互斥线索，首版只提示人工处理建议。" },
  { title: "导入导出", body: "支持 CSV / JSON preview、commit 与当前工作区清单导出。" },
  { title: "使用痕迹", body: "展示业务环境最近被注入到 chat 或 workflow 的记录、状态和 token 估算。" },
  { title: "prompt 预览", body: "能直接看到启用后的业务环境会怎样进入 system prompt，并支持复制检查。" },
];

const ITERATION_IDEAS = [
  { title: "Markdown 导入", body: "从结构化 Markdown 批量抽取业务环境，仍保留 preview 后提交。" },
  { title: "冲突处理 workflow", body: "在冲突治理页支持一键合并、停用、改写成新版，并留下审计记录。" },
  { title: "评分与降权", body: "结合使用痕迹、正负反馈和老化信号，自动提示低价值或过期背景降权。" },
];

function dateToInput(ts: number | null): string {
  if (!ts) return "";
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return "";
  return d.toISOString().slice(0, 10);
}

function inputToDate(value: string): number | null {
  if (!value.trim()) return null;
  const ts = Date.parse(`${value}T00:00:00`);
  return Number.isFinite(ts) ? ts : null;
}

function toDraft(item: BusinessContext): EditDraft {
  return {
    category: item.category,
    title: item.title,
    content: item.content,
    source: item.source,
    owner: item.owner,
    validFrom: dateToInput(item.validFrom),
    validUntil: dateToInput(item.validUntil),
  };
}

function toPayload(draft: EditDraft) {
  return {
    category: draft.category,
    title: draft.title.trim(),
    content: draft.content.trim(),
    source: draft.source.trim(),
    owner: draft.owner.trim(),
    validFrom: inputToDate(draft.validFrom),
    validUntil: inputToDate(draft.validUntil),
  };
}

function fmtTs(ts: number | null | undefined): string {
  return ts ? new Date(ts).toLocaleString() : "-";
}

function expiryStatus(item: BusinessContext): { label: string; cls: string } | null {
  if (!item.validUntil) return null;
  const remain = item.validUntil - Date.now();
  if (remain < 0) return { label: "已过期", cls: "border-red-200 bg-red-50 text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300" };
  if (remain < 1000 * 60 * 60 * 24 * 30) return { label: "即将过期", cls: "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-300" };
  return { label: "有效", cls: "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-300" };
}

function conflictAdvice(conflict: BusinessContextConflict): string {
  if (conflict.reason === "duplicate") return "建议合并重复条目，保留来源更可靠的一条，停用或删除另一条。";
  if (conflict.reason === "opposing_goal_constraint") return "建议人工确认约束与目标是否同一时期有效；必要时拆分有效期或改写其中一条。";
  return "建议对照标题与正文，合并、改写或停用低质量重复背景。";
}

function BusinessContextReadme() {
  return (
    <div className="space-y-4">
      <section className="rounded-xl border border-neutral-200 bg-white p-5 shadow-sm dark:border-neutral-800 dark:bg-neutral-900">
        <div className="flex items-start gap-3">
          <BookOpen className="mt-0.5 h-4 w-4 shrink-0 text-neutral-700 dark:text-neutral-200" />
          <div className="min-w-0">
            <h2 className="text-[15px] font-semibold text-neutral-900 dark:text-neutral-100">业务环境是什么</h2>
            <p className="mt-2 text-[13px] leading-6 text-neutral-600 dark:text-neutral-300">业务环境是记忆库里的“真实业务背景”。它告诉 AI：当前对象是谁、业务处于什么阶段、内部术语怎么理解、哪些约束不能突破、历史上发生过什么、这次真正要达成什么目标。</p>
          </div>
        </div>
      </section>

      <section className="rounded-xl border border-neutral-200 bg-white p-5 shadow-sm dark:border-neutral-800 dark:bg-neutral-900">
        <h2 className="text-[14px] font-semibold text-neutral-900 dark:text-neutral-100">现在已经实现了什么</h2>
        <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {IMPLEMENTED_FEATURES.map((item) => (
            <div key={item.title} className="rounded-lg border border-neutral-200 bg-neutral-50 p-3 dark:border-neutral-800 dark:bg-neutral-950/40">
              <h3 className="text-[12px] font-semibold text-neutral-900 dark:text-neutral-100">{item.title}</h3>
              <p className="mt-1 text-[11.5px] leading-5 text-neutral-600 dark:text-neutral-300">{item.body}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="rounded-xl border border-neutral-200 bg-white p-5 shadow-sm dark:border-neutral-800 dark:bg-neutral-900">
        <h2 className="text-[14px] font-semibold text-neutral-900 dark:text-neutral-100">后续方向</h2>
        <div className="mt-3 grid gap-2 sm:grid-cols-3">
          {ITERATION_IDEAS.map((item) => (
            <div key={item.title} className="rounded-lg border border-neutral-200 bg-neutral-50 p-3 dark:border-neutral-800 dark:bg-neutral-950/40">
              <h3 className="text-[12px] font-semibold text-neutral-900 dark:text-neutral-100">{item.title}</h3>
              <p className="mt-1 text-[11.5px] leading-5 text-neutral-600 dark:text-neutral-300">{item.body}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="rounded-xl border border-amber-200 bg-amber-50 p-5 text-amber-900 shadow-sm dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
        <h2 className="text-[14px] font-semibold">安全边界</h2>
        <p className="mt-2 text-[12px] leading-5">业务环境会进入 LLM prompt，只能放可共享的业务背景、约束和口径说明。禁止粘贴 draw_data 原始行级内容、个人敏感信息、订单样本、客户明细或未脱敏日志。</p>
      </section>
    </div>
  );
}

export function BusinessContextPane({ workspaceId, onChanged }: { workspaceId: string | null; onChanged?: () => void }) {
  const [view, setView] = useState<ViewMode>("manage");
  const [items, setItems] = useState<BusinessContext[]>([]);
  const [promptInfo, setPromptInfo] = useState<{ prompt: string; count: number; updatedAt: number | null }>({ prompt: "", count: 0, updatedAt: null });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<EditDraft>(EMPTY_DRAFT);
  const [creating, setCreating] = useState(false);
  const [newDraft, setNewDraft] = useState<EditDraft>(EMPTY_DRAFT);
  const [enablements, setEnablements] = useState<Map<string, boolean>>(new Map());
  const [conflicts, setConflicts] = useState<BusinessContextConflict[]>([]);
  const [conflictLoading, setConflictLoading] = useState(false);
  const [importFormat, setImportFormat] = useState<BusinessContextImportFormat>("csv");
  const [importPreview, setImportPreview] = useState<BusinessContextImportPreview | null>(null);
  const [commitResult, setCommitResult] = useState<BusinessContextImportCommitResult | null>(null);
  const [importBusy, setImportBusy] = useState(false);
  const [traces, setTraces] = useState<BusinessContextInjectionTrace[]>([]);
  const [traceLoading, setTraceLoading] = useState(false);
  const [traceError, setTraceError] = useState("");

  const refresh = useCallback(async () => {
    if (!workspaceId) return;
    setLoading(true);
    setError("");
    try {
      const [nextItems, nextPrompt, nextEnablements] = await Promise.all([
        api.listBusinessContexts(workspaceId),
        api.getBusinessContextPrompt(workspaceId),
        sharedApi.listMemoryEnablements(workspaceId, "business_context"),
      ]);
      setItems(nextItems);
      setPromptInfo(nextPrompt);
      setEnablements(new Map(nextEnablements.map((e) => [e.itemId, e.enabled])));
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }, [workspaceId]);

  const refreshConflicts = useCallback(async () => {
    if (!workspaceId) return;
    setConflictLoading(true);
    setError("");
    try { setConflicts(await api.listBusinessContextConflicts(workspaceId)); }
    catch (err) { setError(String(err)); }
    finally { setConflictLoading(false); }
  }, [workspaceId]);

  const refreshTraces = useCallback(async () => {
    if (!workspaceId) return;
    setTraceLoading(true);
    setTraceError("");
    try { setTraces(await vizApi.listBusinessContextInjectionTraces(workspaceId, { limit: 80 })); }
    catch (err) { setTraceError(String(err)); }
    finally { setTraceLoading(false); }
  }, [workspaceId]);

  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => { if (view === "governance") void refreshConflicts(); }, [view, refreshConflicts]);
  useEffect(() => { if (view === "traces") void refreshTraces(); }, [view, refreshTraces]);

  const grouped = useMemo(() => CATEGORIES.map((cat) => ({ cat, list: items.filter((item) => item.category === cat.id) })), [items]);
  const byId = useMemo(() => new Map(items.map((item) => [item.id, item])), [items]);

  const refreshPrompt = async () => {
    if (!workspaceId) return;
    setPromptInfo(await api.getBusinessContextPrompt(workspaceId));
    onChanged?.();
  };

  const toggle = async (item: BusinessContext) => {
    if (!workspaceId) return;
    setError("");
    try {
      const next = !(enablements.get(item.id) ?? false);
      await sharedApi.setMemoryEnablement(workspaceId, "business_context", item.id, next);
      setEnablements((prev) => new Map(prev).set(item.id, next));
      await refreshPrompt();
    } catch (err) { setError(String(err)); }
  };

  const saveEdit = async (id: string) => {
    if (!draft.title.trim()) return;
    setError("");
    try {
      await api.updateBusinessContext(id, toPayload(draft));
      setEditingId(null);
      await refresh();
      onChanged?.();
    } catch (err) { setError(String(err)); }
  };

  const saveCreate = async () => {
    if (!workspaceId || !newDraft.title.trim()) return;
    setError("");
    try {
      await api.createBusinessContext(workspaceId, toPayload(newDraft));
      setCreating(false);
      setNewDraft(EMPTY_DRAFT);
      await refresh();
      onChanged?.();
    } catch (err) { setError(String(err)); }
  };

  const remove = async (item: BusinessContext) => {
    if (!window.confirm(`删除业务环境「${item.title}」？此操作不可恢复（全局池删除，所有工作区都将失效）。`)) return;
    setError("");
    try {
      await api.deleteBusinessContext(item.id);
      if (editingId === item.id) setEditingId(null);
      await refresh();
      onChanged?.();
    } catch (err) { setError(String(err)); }
  };

  const copyPrompt = async () => {
    if (!promptInfo.prompt) return;
    try {
      await navigator.clipboard.writeText(promptInfo.prompt);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1200);
    } catch (err) { setError(String(err)); }
  };

  const previewFile = async (file: File) => {
    if (!workspaceId) return;
    const format: BusinessContextImportFormat = file.name.toLowerCase().endsWith(".json") ? "json" : importFormat;
    setImportFormat(format);
    setImportBusy(true);
    setCommitResult(null);
    setError("");
    try { setImportPreview(await api.previewBusinessContextImport(workspaceId, { content: await file.text(), format })); }
    catch (err) { setError(String(err)); }
    finally { setImportBusy(false); }
  };

  const commitImport = async () => {
    if (!workspaceId || !importPreview) return;
    setImportBusy(true);
    setError("");
    try {
      const result = await api.commitBusinessContextImport(workspaceId, { rows: importPreview.rows.filter((row) => row.valid), enable: true, conflictPolicy: "skip" });
      setCommitResult(result);
      await refresh();
      onChanged?.();
    } catch (err) { setError(String(err)); }
    finally { setImportBusy(false); }
  };

  const exportList = async (format: BusinessContextImportFormat) => {
    if (!workspaceId) return;
    setError("");
    try {
      const resp = await api.exportBusinessContexts(workspaceId, true, format);
      if (!resp.ok) throw new Error(await resp.text());
      const blob = await resp.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `business-contexts.${format}`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) { setError(String(err)); }
  };

  const draftFields = (value: EditDraft, onChange: (next: EditDraft) => void, hint: string) => (
    <div className="space-y-2">
      <div className="grid gap-2 md:grid-cols-[160px_1fr]">
        <select value={value.category} onChange={(e) => onChange({ ...value, category: e.target.value as BusinessContextCategory })} className="rounded-md border border-neutral-200 bg-transparent px-2 py-1.5 text-[12px] dark:border-neutral-700">
          {CATEGORIES.map((cat) => <option key={cat.id} value={cat.id}>{cat.label}</option>)}
        </select>
        <input value={value.title} onChange={(e) => onChange({ ...value, title: e.target.value })} placeholder="标题（一句话概括这条业务事实）" className="rounded-md border border-neutral-200 bg-transparent px-2 py-1.5 text-[13px] dark:border-neutral-700" />
      </div>
      <textarea value={value.content} onChange={(e) => onChange({ ...value, content: e.target.value })} placeholder={hint} className="h-24 w-full resize-none rounded-md border border-neutral-200 bg-transparent px-2 py-1.5 text-[12px] leading-5 dark:border-neutral-700" />
      <div className="grid gap-2 md:grid-cols-4">
        <input value={value.source} onChange={(e) => onChange({ ...value, source: e.target.value })} placeholder="来源" className="rounded-md border border-neutral-200 bg-transparent px-2 py-1.5 text-[12px] dark:border-neutral-700" />
        <input value={value.owner} onChange={(e) => onChange({ ...value, owner: e.target.value })} placeholder="负责人" className="rounded-md border border-neutral-200 bg-transparent px-2 py-1.5 text-[12px] dark:border-neutral-700" />
        <input type="date" value={value.validFrom} onChange={(e) => onChange({ ...value, validFrom: e.target.value })} className="rounded-md border border-neutral-200 bg-transparent px-2 py-1.5 text-[12px] dark:border-neutral-700" />
        <input type="date" value={value.validUntil} onChange={(e) => onChange({ ...value, validUntil: e.target.value })} className="rounded-md border border-neutral-200 bg-transparent px-2 py-1.5 text-[12px] dark:border-neutral-700" />
      </div>
    </div>
  );

  return (
    <div className="flex min-h-0 flex-1 overflow-auto bg-neutral-50/60 p-5 dark:bg-neutral-950">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-4">
        <div className="flex flex-col gap-3 rounded-xl border border-neutral-200 bg-white p-4 shadow-sm dark:border-neutral-800 dark:bg-neutral-900 md:flex-row md:items-start md:justify-between">
          <div>
            <h1 className="flex items-center gap-2 text-base font-semibold text-neutral-900 dark:text-neutral-100"><Building2 className="h-4 w-4" /> 业务环境</h1>
            <p className="mt-1 text-[12.5px] text-neutral-500">管理真实业务背景、治理冲突与过期事实，并查看它们如何进入记忆注入链路。</p>
          </div>
          {view === "manage" && <div className="flex shrink-0 gap-2"><button onClick={copyPrompt} disabled={!promptInfo.prompt} className="rounded-md border border-neutral-200 px-3 py-2 text-[12px] disabled:opacity-50 dark:border-neutral-700">{copied ? "已复制" : "复制 prompt"}</button><button onClick={() => void refresh()} disabled={!workspaceId || loading} className="inline-flex items-center gap-1.5 rounded-md border border-neutral-200 px-3 py-2 text-[12px] disabled:opacity-50 dark:border-neutral-700"><RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} /> 刷新</button></div>}
        </div>

        <div className="flex w-full flex-wrap gap-1 rounded-lg border border-neutral-200 bg-white p-1 text-[12px] shadow-sm dark:border-neutral-800 dark:bg-neutral-900 md:w-fit">
          {[
            { id: "manage" as const, label: "管理", icon: Building2 },
            { id: "governance" as const, label: "冲突治理", icon: ShieldAlert },
            { id: "import_export" as const, label: "导入导出", icon: Upload },
            { id: "traces" as const, label: "使用痕迹", icon: History },
            { id: "readme" as const, label: "说明", icon: BookOpen },
          ].map((tab) => <button key={tab.id} onClick={() => setView(tab.id)} className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 ${view === tab.id ? "bg-neutral-900 text-white dark:bg-neutral-100 dark:text-neutral-900" : "text-neutral-500 hover:bg-neutral-100 hover:text-neutral-900 dark:hover:bg-neutral-800 dark:hover:text-neutral-100"}`}><tab.icon className="h-3.5 w-3.5" />{tab.label}</button>)}
        </div>

        {error && <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-[12px] text-red-600 dark:border-red-900 dark:bg-red-950/30">{error}</div>}

        {view === "readme" && <BusinessContextReadme />}

        {view === "manage" && <>
          <section className="rounded-xl border border-neutral-200 bg-white p-4 shadow-sm dark:border-neutral-800 dark:bg-neutral-900">
            <div className="flex items-center justify-between gap-3"><h2 className="text-[13px] font-semibold text-neutral-900 dark:text-neutral-100">注入的 system prompt 片段</h2><span className="text-[11px] text-neutral-400">启用 {promptInfo.count} 条</span></div>
            <pre className="mt-3 max-h-56 overflow-auto whitespace-pre-wrap rounded-lg bg-neutral-50 p-3 text-[12px] leading-5 text-neutral-700 dark:bg-neutral-950 dark:text-neutral-300">{promptInfo.prompt || "暂无启用的业务环境条目"}</pre>
          </section>

          {creating && <section className="rounded-xl border border-amber-300 bg-amber-50/50 p-4 shadow-sm dark:border-amber-900 dark:bg-amber-950/20">{draftFields(newDraft, setNewDraft, CATEGORIES.find((c) => c.id === newDraft.category)?.hint ?? "")}<div className="mt-2 flex justify-end gap-2"><button onClick={() => void saveCreate()} disabled={!newDraft.title.trim()} className="inline-flex items-center gap-1 rounded-md bg-neutral-900 px-2.5 py-1.5 text-[12px] text-white disabled:opacity-50 dark:bg-neutral-100 dark:text-neutral-900"><Save className="h-3.5 w-3.5" /> 保存</button><button onClick={() => setCreating(false)} className="inline-flex items-center gap-1 rounded-md border border-neutral-200 px-2.5 py-1.5 text-[12px] dark:border-neutral-700"><X className="h-3.5 w-3.5" /> 取消</button></div></section>}

          <div className="space-y-5">
            {grouped.map(({ cat, list }) => <section key={cat.id}>
              <div className="mb-2 flex items-center justify-between gap-2"><div className="flex items-baseline gap-2"><h2 className="text-[13px] font-semibold text-neutral-700 dark:text-neutral-200">{cat.label}</h2><span className="text-[11px] text-neutral-400">{list.length}</span></div><button onClick={() => { setEditingId(null); setCreating(true); setNewDraft({ ...EMPTY_DRAFT, category: cat.id }); }} className="inline-flex items-center gap-1 rounded-md border border-neutral-200 px-2 py-1 text-[11.5px] text-neutral-500 hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-800"><Plus className="h-3.5 w-3.5" /> 添加</button></div>
              {list.length === 0 ? <div className="rounded-lg border border-dashed border-neutral-200 bg-white/40 px-3 py-3 text-[12px] text-neutral-400 dark:border-neutral-800 dark:bg-neutral-900/30">{cat.hint}</div> : <div className="space-y-2">{list.map((item) => {
                const editing = editingId === item.id;
                const wsEnabled = enablements.get(item.id) ?? false;
                const status = expiryStatus(item);
                return <div key={item.id} className="rounded-xl border border-neutral-200 bg-white p-3.5 shadow-sm dark:border-neutral-800 dark:bg-neutral-900">
                  {editing ? <>{draftFields(draft, setDraft, cat.hint)}<div className="mt-2 flex justify-end gap-2"><button onClick={() => void saveEdit(item.id)} disabled={!draft.title.trim()} className="inline-flex items-center gap-1 rounded-md bg-neutral-900 px-2.5 py-1.5 text-[12px] text-white disabled:opacity-50 dark:bg-neutral-100 dark:text-neutral-900"><Save className="h-3.5 w-3.5" /> 保存</button><button onClick={() => setEditingId(null)} className="inline-flex items-center gap-1 rounded-md border border-neutral-200 px-2.5 py-1.5 text-[12px] dark:border-neutral-700"><X className="h-3.5 w-3.5" /> 取消</button></div></> : <div className="flex flex-col gap-3 md:flex-row md:items-start"><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><h3 className={`text-[13px] font-semibold ${wsEnabled ? "text-neutral-900 dark:text-neutral-100" : "text-neutral-400 line-through"}`}>{item.title}</h3><span className="rounded border border-neutral-200 px-1.5 py-0.5 text-[10.5px] text-neutral-500 dark:border-neutral-700">{CATEGORY_LABEL[item.category]}</span>{status && <span className={`rounded border px-1.5 py-0.5 text-[10.5px] ${status.cls}`}>{status.label}</span>}{item.workspaceId !== workspaceId && <span className="rounded border border-amber-200 px-1.5 py-0.5 text-[10.5px] text-amber-600 dark:border-amber-800 dark:text-amber-400">来源工作区</span>}</div>{item.content && <p className="mt-1.5 whitespace-pre-wrap text-[12px] leading-5 text-neutral-500">{item.content}</p>}<div className="mt-2 flex flex-wrap gap-2 text-[11px] text-neutral-400">{item.source && <span>来源：{item.source}</span>}{item.owner && <span>负责人：{item.owner}</span>}{item.validUntil && <span>有效至：{dateToInput(item.validUntil)}</span>}</div></div><div className="flex shrink-0 flex-wrap items-center gap-1.5"><button onClick={() => void toggle(item)} className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[12px] ${wsEnabled ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-300" : "bg-neutral-100 text-neutral-500 dark:bg-neutral-800"}`}><CheckCircle2 className="h-3.5 w-3.5" /> {wsEnabled ? "启用" : "停用"}</button><button onClick={() => { setCreating(false); setEditingId(item.id); setDraft(toDraft(item)); }} className="inline-flex items-center gap-1 rounded-md border border-neutral-200 px-2 py-1.5 text-[12px] dark:border-neutral-700"><Pencil className="h-3.5 w-3.5" /> 编辑</button><button onClick={() => void remove(item)} className="inline-flex items-center gap-1 rounded-md border border-red-200 px-2 py-1.5 text-[12px] text-red-600 dark:border-red-900 dark:text-red-400"><Trash2 className="h-3.5 w-3.5" /></button></div></div>}
                </div>;
              })}</div>}
            </section>)}
          </div>
        </>}

        {view === "governance" && <section className="rounded-xl border border-neutral-200 bg-white p-4 shadow-sm dark:border-neutral-800 dark:bg-neutral-900"><div className="flex items-center justify-between gap-3"><div><h2 className="text-[14px] font-semibold text-neutral-900 dark:text-neutral-100">冲突治理</h2><p className="mt-1 text-[12px] text-neutral-500">只提示风险，不自动合并、停用或改写。</p></div><button onClick={() => void refreshConflicts()} className="inline-flex items-center gap-1.5 rounded-md border border-neutral-200 px-3 py-2 text-[12px] dark:border-neutral-700"><RefreshCw className={`h-3.5 w-3.5 ${conflictLoading ? "animate-spin" : ""}`} /> 刷新</button></div>{conflicts.length === 0 ? <div className="mt-4 rounded-lg border border-dashed border-neutral-200 p-8 text-center text-[12px] text-neutral-400 dark:border-neutral-800">暂无冲突</div> : <div className="mt-4 space-y-2">{conflicts.map((c, idx) => <div key={`${c.reason}-${idx}`} className="rounded-lg border border-amber-200 bg-amber-50/50 p-3 dark:border-amber-900 dark:bg-amber-950/20"><div className="flex flex-wrap items-center gap-2"><AlertTriangle className="h-4 w-4 text-amber-600" /><span className="text-[12px] font-semibold text-neutral-900 dark:text-neutral-100">{c.message}</span><span className="rounded border border-neutral-200 px-1.5 py-0.5 text-[10.5px] text-neutral-500 dark:border-neutral-700">{c.severity}</span></div><div className="mt-2 grid gap-2 md:grid-cols-2">{c.itemIds.map((id) => { const item = byId.get(id); return <div key={id} className="rounded-md bg-white/70 p-2 text-[12px] dark:bg-neutral-950/40"><div className="font-medium text-neutral-800 dark:text-neutral-100">{item?.title ?? id}</div><div className="mt-1 line-clamp-2 text-neutral-500">{item?.content ?? "导入候选行"}</div></div>; })}</div><p className="mt-2 text-[12px] text-amber-800 dark:text-amber-200">{conflictAdvice(c)}</p></div>)}</div>}</section>}

        {view === "import_export" && <section className="grid gap-4 lg:grid-cols-2"><div className="rounded-xl border border-neutral-200 bg-white p-4 shadow-sm dark:border-neutral-800 dark:bg-neutral-900"><h2 className="flex items-center gap-2 text-[14px] font-semibold text-neutral-900 dark:text-neutral-100"><Upload className="h-4 w-4" /> 导入 preview</h2><div className="mt-3 flex flex-wrap gap-2"><select value={importFormat} onChange={(e) => setImportFormat(e.target.value as BusinessContextImportFormat)} className="rounded-md border border-neutral-200 bg-transparent px-2 py-1.5 text-[12px] dark:border-neutral-700"><option value="csv">CSV</option><option value="json">JSON</option></select><label className="inline-flex cursor-pointer items-center gap-1.5 rounded-md border border-neutral-200 px-3 py-2 text-[12px] hover:bg-neutral-50 dark:border-neutral-700 dark:hover:bg-neutral-800"><Upload className="h-3.5 w-3.5" /> 选择文件<input type="file" accept=".csv,.json" className="hidden" onChange={(e) => { const file = e.target.files?.[0]; if (file) void previewFile(file); e.currentTarget.value = ""; }} /></label><button onClick={() => void commitImport()} disabled={!importPreview || importBusy || importPreview.validRows === 0} className="inline-flex items-center gap-1.5 rounded-md bg-neutral-900 px-3 py-2 text-[12px] text-white disabled:opacity-50 dark:bg-neutral-100 dark:text-neutral-900"><Save className="h-3.5 w-3.5" /> commit</button></div>{importBusy && <p className="mt-3 text-[12px] text-neutral-500">处理中...</p>}{importPreview && <div className="mt-4 space-y-2"><div className="grid gap-2 text-[12px] sm:grid-cols-3"><div className="rounded-lg bg-neutral-50 p-3 dark:bg-neutral-950/40">总行数 {importPreview.totalRows}</div><div className="rounded-lg bg-emerald-50 p-3 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-300">合法 {importPreview.validRows}</div><div className="rounded-lg bg-red-50 p-3 text-red-700 dark:bg-red-950/30 dark:text-red-300">非法 {importPreview.invalidRows}</div></div><div className="max-h-72 overflow-auto rounded-lg border border-neutral-200 dark:border-neutral-800"><table className="w-full min-w-[680px] text-left text-[12px]"><thead className="bg-neutral-50 text-neutral-500 dark:bg-neutral-950"><tr><th className="p-2">行</th><th className="p-2">状态</th><th className="p-2">分类</th><th className="p-2">标题</th><th className="p-2">问题</th></tr></thead><tbody>{importPreview.rows.map((row) => <tr key={row.row} className="border-t border-neutral-100 dark:border-neutral-800"><td className="p-2">{row.row}</td><td className="p-2">{row.valid ? "valid" : "invalid"}</td><td className="p-2">{CATEGORY_LABEL[row.category]}</td><td className="p-2">{row.title}</td><td className="p-2 text-neutral-500">{[...row.errors.map((e) => `${e.field}: ${e.message}`), ...row.conflicts.map((c) => c.reason)].join("; ") || "-"}</td></tr>)}</tbody></table></div></div>}{commitResult && <div className="mt-4 rounded-lg border border-neutral-200 bg-neutral-50 p-3 text-[12px] dark:border-neutral-800 dark:bg-neutral-950/40">created {commitResult.created.length} · skipped {commitResult.skipped.length} · errors {commitResult.errors.length}</div>}</div><div className="rounded-xl border border-neutral-200 bg-white p-4 shadow-sm dark:border-neutral-800 dark:bg-neutral-900"><h2 className="flex items-center gap-2 text-[14px] font-semibold text-neutral-900 dark:text-neutral-100"><Download className="h-4 w-4" /> 导出当前启用清单</h2><p className="mt-2 text-[12px] leading-5 text-neutral-500">导出只包含当前工作区启用的业务环境；全局池未启用项不会出现在文件里。</p><div className="mt-4 flex flex-wrap gap-2"><button onClick={() => void exportList("csv")} className="inline-flex items-center gap-1.5 rounded-md border border-neutral-200 px-3 py-2 text-[12px] dark:border-neutral-700"><Download className="h-3.5 w-3.5" /> CSV</button><button onClick={() => void exportList("json")} className="inline-flex items-center gap-1.5 rounded-md border border-neutral-200 px-3 py-2 text-[12px] dark:border-neutral-700"><Download className="h-3.5 w-3.5" /> JSON</button></div></div></section>}

        {view === "traces" && <section className="rounded-xl border border-neutral-200 bg-white p-4 shadow-sm dark:border-neutral-800 dark:bg-neutral-900"><div className="flex items-center justify-between gap-3"><div><h2 className="flex items-center gap-2 text-[14px] font-semibold text-neutral-900 dark:text-neutral-100"><FileClock className="h-4 w-4" /> 使用痕迹</h2><p className="mt-1 text-[12px] text-neutral-500">最近注入位置、targetKind、时间、tokenEstimate 与 injected 状态。</p></div><button onClick={() => void refreshTraces()} className="inline-flex items-center gap-1.5 rounded-md border border-neutral-200 px-3 py-2 text-[12px] dark:border-neutral-700"><RefreshCw className={`h-3.5 w-3.5 ${traceLoading ? "animate-spin" : ""}`} /> 刷新</button></div>{traceError && <div className="mt-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-[12px] text-amber-700 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-300">{traceError}</div>}{traces.length === 0 ? <div className="mt-4 rounded-lg border border-dashed border-neutral-200 p-8 text-center text-[12px] text-neutral-400 dark:border-neutral-800">暂无使用痕迹。后端未回流或当前工作区尚未发生注入时会显示这里。</div> : <div className="mt-4 overflow-auto rounded-lg border border-neutral-200 dark:border-neutral-800"><table className="w-full min-w-[760px] text-left text-[12px]"><thead className="bg-neutral-50 text-neutral-500 dark:bg-neutral-950"><tr><th className="p-3">业务环境</th><th className="p-3">target</th><th className="p-3">injected</th><th className="p-3">tokens</th><th className="p-3">时间</th></tr></thead><tbody>{traces.map((trace) => <tr key={trace.id} className="border-t border-neutral-100 dark:border-neutral-800"><td className="p-3"><div className="font-medium text-neutral-900 dark:text-neutral-100">{trace.businessContextTitle}</div><div className="text-[11px] text-neutral-400">{trace.category}</div></td><td className="p-3"><div>{trace.targetScope} / {trace.targetKind}</div><div className="font-mono text-[11px] text-neutral-400">{trace.targetId}</div></td><td className="p-3">{trace.injected ? <span className="text-emerald-600">yes</span> : <span className="text-amber-600">no · {trace.omittedReason ?? "omitted"}</span>}</td><td className="p-3 text-neutral-500">{trace.tokenEstimate}</td><td className="p-3 text-neutral-500">{fmtTs(trace.createdAt)}</td></tr>)}</tbody></table></div>}</section>}
      </div>
    </div>
  );
}
