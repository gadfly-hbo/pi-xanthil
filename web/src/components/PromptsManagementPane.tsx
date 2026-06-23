// prompts 管理面板（D-PANEL · prompts_mgmt · 2026-06-19）
// V-agent 已停用，前端归 D 承接。
//
// 双区 mini-tab：
//   - 模板库：prompt_templates CRUD（workspaceId=null 视为全局；body {{var}} 占位实时抽取展示）
//   - 系统prompt：listSystemPromptOverviews 只读快照，按 scope 分组浏览 + 预览
//
// 边界：本面板不读 draw_data 行级；模板 body 仅存储不渲染（替换由调用方做）。

import { useCallback, useEffect, useMemo, useState } from "react";
import { Globe, Library, Pencil, Plus, RefreshCw, Search, Settings2, Trash2, X } from "lucide-react";
import { api } from "@/lib/api";
import { sharedApi } from "@/lib/api/shared";
import { cn } from "@/lib/cn";
import type { PromptTemplate, PromptTemplateInput, SystemPromptOverview } from "@/types";

const PROMPT_VARIABLE_RE = /\{\{\s*([a-zA-Z_][\w.-]*)\s*\}\}/g;

function extractVariables(body: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const m of body.matchAll(PROMPT_VARIABLE_RE)) {
    const name = m[1]!;
    if (!seen.has(name)) {
      seen.add(name);
      out.push(name);
    }
  }
  return out;
}

function fmtTs(ts: number): string {
  return new Date(ts).toLocaleString();
}

function parseCsvInput(s: string): string[] {
  return s.split(",").map((t) => t.trim()).filter((t) => t.length > 0);
}

interface Props {
  workspaceId: string | null;
}

export function PromptsManagementPane({ workspaceId }: Props) {
  const [view, setView] = useState<"library" | "system">("library");
  const items = [
    { id: "library" as const, label: "模板库", icon: Library },
    { id: "system" as const, label: "系统prompt", icon: Settings2 },
  ];
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-9 shrink-0 items-center gap-1 border-b border-neutral-200 px-3 dark:border-neutral-800">
        {items.map((t) => {
          const Icon = t.icon;
          return (
            <button
              key={t.id}
              onClick={() => setView(t.id)}
              className={cn(
                "inline-flex h-7 items-center gap-1.5 rounded-md px-2.5 text-[12px] transition-colors",
                view === t.id
                  ? "bg-neutral-100 font-medium text-neutral-900 dark:bg-neutral-800 dark:text-neutral-100"
                  : "text-neutral-500 hover:bg-neutral-100 hover:text-neutral-900 dark:text-neutral-400 dark:hover:bg-neutral-800/60 dark:hover:text-neutral-100",
              )}
            >
              <Icon className="h-3.5 w-3.5" />
              {t.label}
            </button>
          );
        })}
      </div>
      <div className="flex min-h-0 flex-1">
        {view === "library" ? <LibraryView workspaceId={workspaceId} /> : <SystemView />}
      </div>
    </div>
  );
}

// ============================================================================
// 模板库
// ============================================================================

interface DraftState {
  id: string | null;
  title: string;
  category: string;
  body: string;
  tags: string;
  variablesOverride: string;
  global: boolean;
}

const EMPTY_DRAFT: DraftState = {
  id: null,
  title: "",
  category: "",
  body: "",
  tags: "",
  variablesOverride: "",
  global: false,
};

function LibraryView({ workspaceId }: { workspaceId: string | null }) {
  const [list, setList] = useState<PromptTemplate[]>([]);
  const [enabledSet, setEnabledSet] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<string | null>(null);
  const [tagFilter, setTagFilter] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState<DraftState | null>(null);
  const [saving, setSaving] = useState(false);
  const [busyEnableId, setBusyEnableId] = useState<string | null>(null);

  const reload = useCallback(async () => {
    if (!workspaceId) {
      setList([]);
      setEnabledSet(new Set());
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const [tpls, ens] = await Promise.all([
        api.listPromptTemplates(workspaceId),
        sharedApi.listMemoryEnablements(workspaceId, "prompt"),
      ]);
      setList(tpls);
      setEnabledSet(new Set(ens.filter((e) => e.enabled).map((e) => e.itemId)));
    } catch (err) {
      setError("加载失败：" + (err instanceof Error ? err.message : String(err)));
    } finally {
      setLoading(false);
    }
  }, [workspaceId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  // D-POOL1: NULL 模板恒启用；非 NULL 看 enablement 表。
  const isEnabled = useCallback(
    (tpl: PromptTemplate) => tpl.workspaceId === null || enabledSet.has(tpl.id),
    [enabledSet],
  );

  const toggleEnablement = useCallback(
    async (tpl: PromptTemplate, next: boolean) => {
      if (!workspaceId || tpl.workspaceId === null) return; // NULL 全局不可切
      setBusyEnableId(tpl.id);
      try {
        await sharedApi.setMemoryEnablement(workspaceId, "prompt", tpl.id, next);
        setEnabledSet((prev) => {
          const s = new Set(prev);
          if (next) s.add(tpl.id);
          else s.delete(tpl.id);
          return s;
        });
      } catch (err) {
        setError("启用切换失败：" + (err instanceof Error ? err.message : String(err)));
      } finally {
        setBusyEnableId(null);
      }
    },
    [workspaceId],
  );

  const allCategories = useMemo(() => {
    const s = new Set<string>();
    for (const t of list) if (t.category) s.add(t.category);
    return Array.from(s).sort();
  }, [list]);

  const allTags = useMemo(() => {
    const s = new Set<string>();
    for (const t of list) for (const tag of t.tags) s.add(tag);
    return Array.from(s).sort();
  }, [list]);

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return list.filter((t) => {
      if (q) {
        const hit =
          t.title.toLowerCase().includes(q) ||
          t.body.toLowerCase().includes(q) ||
          t.category.toLowerCase().includes(q) ||
          t.tags.some((x) => x.toLowerCase().includes(q));
        if (!hit) return false;
      }
      if (categoryFilter && t.category !== categoryFilter) return false;
      if (tagFilter && !t.tags.includes(tagFilter)) return false;
      return true;
    });
  }, [list, filter, categoryFilter, tagFilter]);

  const selected = useMemo(
    () => list.find((t) => t.id === selectedId) ?? null,
    [list, selectedId],
  );

  const startCreate = () => {
    setDraft({ ...EMPTY_DRAFT });
    setSelectedId(null);
  };

  const startEdit = (tpl: PromptTemplate) => {
    setDraft({
      id: tpl.id,
      title: tpl.title,
      category: tpl.category,
      body: tpl.body,
      tags: tpl.tags.join(", "),
      variablesOverride: tpl.variables.join(", "),
      global: tpl.workspaceId === null,
    });
    setSelectedId(tpl.id);
  };

  const saveDraft = async () => {
    if (!workspaceId || !draft) return;
    const title = draft.title.trim();
    if (!title) {
      setError("title 必填");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const tags = parseCsvInput(draft.tags);
      const overrideVars = parseCsvInput(draft.variablesOverride);
      const autoVars = extractVariables(draft.body);
      const variables = overrideVars.length > 0 ? overrideVars : autoVars;
      if (draft.id) {
        await api.updatePromptTemplate(workspaceId, draft.id, {
          title,
          category: draft.category.trim(),
          body: draft.body,
          tags,
          variables,
        });
      } else {
        const payload: PromptTemplateInput = {
          title,
          category: draft.category.trim(),
          body: draft.body,
          tags,
          variables,
          workspaceId: draft.global ? null : workspaceId,
        };
        await api.createPromptTemplate(workspaceId, payload);
      }
      setDraft(null);
      await reload();
    } catch (err) {
      setError("保存失败：" + (err instanceof Error ? err.message : String(err)));
    } finally {
      setSaving(false);
    }
  };

  const removeTemplate = async (tpl: PromptTemplate) => {
    if (!workspaceId) return;
    if (!confirm('删除模板 "' + tpl.title + '"？此操作不可撤销。')) return;
    setError(null);
    try {
      await api.deletePromptTemplate(workspaceId, tpl.id);
      if (selectedId === tpl.id) setSelectedId(null);
      if (draft?.id === tpl.id) setDraft(null);
      await reload();
    } catch (err) {
      setError("删除失败：" + (err instanceof Error ? err.message : String(err)));
    }
  };

  if (!workspaceId) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-neutral-500">
        请先选择工作区
      </div>
    );
  }

  const draftAutoVars = draft ? extractVariables(draft.body) : [];

  return (
    <div className="flex min-h-0 w-full flex-col">
      {/* 顶部工具栏 */}
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-neutral-200 px-3 py-2 dark:border-neutral-800">
        <div className="relative">
          <Search className="absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-neutral-400" />
          <input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="搜索 title / body / category / tag"
            className="h-7 w-72 rounded-md border border-neutral-200 bg-white pl-7 pr-2 text-[12px] outline-none focus:border-neutral-400 dark:border-neutral-800 dark:bg-neutral-900"
          />
        </div>
        <button
          onClick={() => void reload()}
          disabled={loading}
          className="inline-flex h-7 items-center gap-1 rounded-md border border-neutral-200 px-2 text-[12px] text-neutral-600 hover:bg-neutral-50 disabled:opacity-50 dark:border-neutral-800 dark:text-neutral-300 dark:hover:bg-neutral-800/60"
        >
          <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} />
          刷新
        </button>
        <div className="ml-auto flex items-center gap-2">
          <span className="text-[11px] text-neutral-500">
            {filtered.length}/{list.length}
          </span>
          <button
            onClick={startCreate}
            className="inline-flex h-7 items-center gap-1 rounded-md bg-neutral-900 px-2.5 text-[12px] text-white hover:bg-neutral-800 dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-neutral-200"
          >
            <Plus className="h-3.5 w-3.5" />
            新建模板
          </button>
        </div>
      </div>

      {/* category / tag 过滤行 */}
      {(allCategories.length > 0 || allTags.length > 0) && (
        <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-neutral-100 px-3 py-1.5 dark:border-neutral-900">
          {allCategories.length > 0 && (
            <div className="flex items-center gap-1">
              <span className="text-[11px] text-neutral-400">分类：</span>
              <button
                onClick={() => setCategoryFilter(null)}
                className={cn(
                  "rounded px-1.5 text-[11px]",
                  categoryFilter === null
                    ? "bg-neutral-200 text-neutral-900 dark:bg-neutral-700 dark:text-neutral-100"
                    : "text-neutral-500 hover:bg-neutral-100 dark:text-neutral-400 dark:hover:bg-neutral-800",
                )}
              >
                全部
              </button>
              {allCategories.map((c) => (
                <button
                  key={c}
                  onClick={() => setCategoryFilter(categoryFilter === c ? null : c)}
                  className={cn(
                    "rounded px-1.5 text-[11px]",
                    categoryFilter === c
                      ? "bg-neutral-200 text-neutral-900 dark:bg-neutral-700 dark:text-neutral-100"
                      : "text-neutral-500 hover:bg-neutral-100 dark:text-neutral-400 dark:hover:bg-neutral-800",
                  )}
                >
                  {c}
                </button>
              ))}
            </div>
          )}
          {allTags.length > 0 && (
            <div className="flex items-center gap-1">
              <span className="ml-2 text-[11px] text-neutral-400">标签：</span>
              <button
                onClick={() => setTagFilter(null)}
                className={cn(
                  "rounded px-1.5 text-[11px]",
                  tagFilter === null
                    ? "bg-neutral-200 text-neutral-900 dark:bg-neutral-700 dark:text-neutral-100"
                    : "text-neutral-500 hover:bg-neutral-100 dark:text-neutral-400 dark:hover:bg-neutral-800",
                )}
              >
                全部
              </button>
              {allTags.map((t) => (
                <button
                  key={t}
                  onClick={() => setTagFilter(tagFilter === t ? null : t)}
                  className={cn(
                    "rounded px-1.5 text-[11px]",
                    tagFilter === t
                      ? "bg-neutral-200 text-neutral-900 dark:bg-neutral-700 dark:text-neutral-100"
                      : "text-neutral-500 hover:bg-neutral-100 dark:text-neutral-400 dark:hover:bg-neutral-800",
                  )}
                >
                  #{t}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* 主体：左列表 + 右详情/编辑 */}
      <div className="flex min-h-0 flex-1">
        <div className="w-80 shrink-0 overflow-y-auto border-r border-neutral-200 dark:border-neutral-800">
          {filtered.length === 0 ? (
            <div className="p-6 text-center text-[12px] text-neutral-400">
              {loading ? "加载中…" : list.length === 0 ? "暂无模板，点右上角新建" : "无匹配结果"}
            </div>
          ) : (
            <ul>
              {filtered.map((t) => {
                const active = selectedId === t.id;
                const isDraftRow = draft?.id === t.id;
                const isGlobal = t.workspaceId === null;
                const enabled = isEnabled(t);
                return (
                  <li key={t.id}>
                    <div
                      className={cn(
                        "flex w-full items-start gap-2 border-b border-neutral-100 px-3 py-2 transition-colors dark:border-neutral-900",
                        active
                          ? "bg-neutral-50 dark:bg-neutral-900"
                          : "hover:bg-neutral-50 dark:hover:bg-neutral-900/60",
                      )}
                    >
                      <input
                        type="checkbox"
                        className="mt-1 shrink-0"
                        checked={enabled}
                        disabled={isGlobal || busyEnableId === t.id}
                        onChange={(e) => void toggleEnablement(t, e.target.checked)}
                        title={isGlobal ? "全局模板恒启用，不可关闭" : "本工作区启用 / 停用"}
                        onClick={(e) => e.stopPropagation()}
                      />
                      <button
                        onClick={() => {
                          setSelectedId(t.id);
                          setDraft(null);
                        }}
                        className="flex min-w-0 flex-1 flex-col gap-0.5 text-left"
                      >
                        <div className="flex items-center gap-1.5">
                          <span className="truncate text-[13px] font-medium">{t.title}</span>
                          {isGlobal && (
                            <span className="inline-flex shrink-0 items-center gap-0.5 rounded bg-amber-100 px-1 text-[10px] text-amber-700 dark:bg-amber-950 dark:text-amber-300">
                              <Globe className="h-2.5 w-2.5" />
                              全局
                            </span>
                          )}
                          {isDraftRow && (
                            <span className="shrink-0 rounded bg-blue-100 px-1 text-[10px] text-blue-700 dark:bg-blue-950 dark:text-blue-300">
                              编辑中
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-2 text-[11px] text-neutral-500">
                          {t.category && <span>{t.category}</span>}
                          {t.variables.length > 0 && <span>·{t.variables.length} 变量</span>}
                          <span className="ml-auto">{fmtTs(t.updatedAt)}</span>
                        </div>
                        {t.tags.length > 0 && (
                          <div className="flex flex-wrap gap-1">
                            {t.tags.slice(0, 4).map((tag) => (
                              <span
                                key={tag}
                                className="rounded bg-neutral-100 px-1 text-[10px] text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300"
                              >
                                #{tag}
                              </span>
                            ))}
                          </div>
                        )}
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <div className="flex min-w-0 flex-1 flex-col">
          {draft ? (
            <DraftEditor
              draft={draft}
              autoVars={draftAutoVars}
              saving={saving}
              onChange={setDraft}
              onCancel={() => setDraft(null)}
              onSave={() => void saveDraft()}
            />
          ) : selected ? (
            <TemplateDetail
              tpl={selected}
              onEdit={() => startEdit(selected)}
              onDelete={() => void removeTemplate(selected)}
            />
          ) : (
            <div className="flex flex-1 items-center justify-center text-[12px] text-neutral-400">
              在左侧选择一个模板查看详情，或点击「新建模板」
            </div>
          )}
        </div>
      </div>

      {error && (
        <div className="shrink-0 border-t border-red-200 bg-red-50 px-3 py-2 text-[12px] text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
          {error}
        </div>
      )}
    </div>
  );
}

function TemplateDetail({
  tpl,
  onEdit,
  onDelete,
}: {
  tpl: PromptTemplate;
  onEdit: () => void;
  onDelete: () => void;
}) {
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-start gap-2 border-b border-neutral-200 px-4 py-3 dark:border-neutral-800">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <h2 className="truncate text-[14px] font-semibold">{tpl.title}</h2>
            {tpl.workspaceId === null && (
              <span className="inline-flex items-center gap-0.5 rounded bg-amber-100 px-1.5 text-[10px] text-amber-700 dark:bg-amber-950 dark:text-amber-300">
                <Globe className="h-3 w-3" />
                全局
              </span>
            )}
            {tpl.category && (
              <span className="rounded bg-neutral-100 px-1.5 text-[10px] text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300">
                {tpl.category}
              </span>
            )}
          </div>
          <div className="mt-1 text-[11px] text-neutral-500">
            id: <code className="text-[10px]">{tpl.id}</code> · 更新 {fmtTs(tpl.updatedAt)}
          </div>
        </div>
        <button
          onClick={onEdit}
          className="inline-flex h-7 shrink-0 items-center gap-1 rounded-md border border-neutral-200 px-2 text-[12px] text-neutral-600 hover:bg-neutral-50 dark:border-neutral-800 dark:text-neutral-300 dark:hover:bg-neutral-800/60"
        >
          <Pencil className="h-3.5 w-3.5" />
          编辑
        </button>
        <button
          onClick={onDelete}
          className="inline-flex h-7 shrink-0 items-center gap-1 rounded-md border border-red-200 px-2 text-[12px] text-red-600 hover:bg-red-50 dark:border-red-900 dark:text-red-400 dark:hover:bg-red-950"
        >
          <Trash2 className="h-3.5 w-3.5" />
          删除
        </button>
      </div>

      <div className="flex flex-wrap items-start gap-x-4 gap-y-1 border-b border-neutral-100 px-4 py-2 text-[11px] dark:border-neutral-900">
        <div>
          <span className="text-neutral-400">变量：</span>
          {tpl.variables.length > 0 ? (
            tpl.variables.map((v) => (
              <code
                key={v}
                className="ml-1 rounded bg-neutral-100 px-1 text-[10px] text-neutral-700 dark:bg-neutral-800 dark:text-neutral-200"
              >
                {`{{${v}}}`}
              </code>
            ))
          ) : (
            <span className="ml-1 text-neutral-400">无</span>
          )}
        </div>
        {tpl.tags.length > 0 && (
          <div>
            <span className="text-neutral-400">标签：</span>
            {tpl.tags.map((t) => (
              <span
                key={t}
                className="ml-1 rounded bg-neutral-100 px-1 text-[10px] text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300"
              >
                #{t}
              </span>
            ))}
          </div>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto bg-neutral-50 p-4 dark:bg-neutral-950">
        <pre className="whitespace-pre-wrap break-words font-mono text-[12px] leading-relaxed text-neutral-800 dark:text-neutral-200">
{tpl.body || <span className="text-neutral-400">（body 为空）</span>}
        </pre>
      </div>
    </div>
  );
}

function DraftEditor({
  draft,
  autoVars,
  saving,
  onChange,
  onCancel,
  onSave,
}: {
  draft: DraftState;
  autoVars: string[];
  saving: boolean;
  onChange: (d: DraftState) => void;
  onCancel: () => void;
  onSave: () => void;
}) {
  const isEdit = draft.id != null;
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center justify-between border-b border-neutral-200 px-4 py-2.5 dark:border-neutral-800">
        <h2 className="text-[13px] font-medium">{isEdit ? "编辑模板" : "新建模板"}</h2>
        <div className="flex items-center gap-2">
          <button
            onClick={onCancel}
            className="inline-flex h-7 items-center gap-1 rounded-md border border-neutral-200 px-2 text-[12px] text-neutral-600 hover:bg-neutral-50 dark:border-neutral-800 dark:text-neutral-300 dark:hover:bg-neutral-800/60"
          >
            <X className="h-3.5 w-3.5" />
            取消
          </button>
          <button
            onClick={onSave}
            disabled={saving || !draft.title.trim()}
            className="inline-flex h-7 items-center gap-1 rounded-md bg-neutral-900 px-2.5 text-[12px] text-white hover:bg-neutral-800 disabled:opacity-50 dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-neutral-200"
          >
            {saving ? "保存中…" : "保存"}
          </button>
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-4">
        <div className="flex flex-wrap gap-3">
          <label className="flex min-w-0 flex-1 flex-col gap-1">
            <span className="text-[11px] text-neutral-500">title *</span>
            <input
              value={draft.title}
              onChange={(e) => onChange({ ...draft, title: e.target.value })}
              className="h-8 rounded-md border border-neutral-200 bg-white px-2 text-[13px] outline-none focus:border-neutral-400 dark:border-neutral-800 dark:bg-neutral-900"
            />
          </label>
          <label className="flex w-48 flex-col gap-1">
            <span className="text-[11px] text-neutral-500">category</span>
            <input
              value={draft.category}
              onChange={(e) => onChange({ ...draft, category: e.target.value })}
              placeholder="如 analysis / report"
              className="h-8 rounded-md border border-neutral-200 bg-white px-2 text-[13px] outline-none focus:border-neutral-400 dark:border-neutral-800 dark:bg-neutral-900"
            />
          </label>
        </div>

        <label className="flex flex-col gap-1">
          <span className="text-[11px] text-neutral-500">tags（逗号分隔）</span>
          <input
            value={draft.tags}
            onChange={(e) => onChange({ ...draft, tags: e.target.value })}
            placeholder="如 a11y, draft"
            className="h-8 rounded-md border border-neutral-200 bg-white px-2 text-[13px] outline-none focus:border-neutral-400 dark:border-neutral-800 dark:bg-neutral-900"
          />
        </label>

        <label className="flex min-h-0 flex-1 flex-col gap-1">
          <span className="text-[11px] text-neutral-500">body（{`{{var}}`} 占位会自动抽取）</span>
          <textarea
            value={draft.body}
            onChange={(e) => onChange({ ...draft, body: e.target.value })}
            placeholder="请输入 prompt 模板正文，可用 {{name}} 作变量占位…"
            className="min-h-[260px] flex-1 resize-none rounded-md border border-neutral-200 bg-white p-2 font-mono text-[12px] leading-relaxed outline-none focus:border-neutral-400 dark:border-neutral-800 dark:bg-neutral-900"
          />
        </label>

        <div className="rounded-md border border-neutral-200 bg-neutral-50 p-2 text-[11px] dark:border-neutral-800 dark:bg-neutral-900">
          <div className="text-neutral-500">
            自动抽取的变量（{autoVars.length}）：
            {autoVars.length === 0 ? (
              <span className="ml-1 text-neutral-400">无</span>
            ) : (
              autoVars.map((v) => (
                <code
                  key={v}
                  className="ml-1 rounded bg-white px-1 text-[10px] text-neutral-700 dark:bg-neutral-800 dark:text-neutral-200"
                >
                  {`{{${v}}}`}
                </code>
              ))
            )}
          </div>
          <label className="mt-2 flex flex-col gap-1">
            <span className="text-neutral-500">手填 variables（逗号分隔，留空则用上方自动抽取）</span>
            <input
              value={draft.variablesOverride}
              onChange={(e) => onChange({ ...draft, variablesOverride: e.target.value })}
              placeholder="留空 = 自动"
              className="h-7 rounded-md border border-neutral-200 bg-white px-2 text-[12px] outline-none focus:border-neutral-400 dark:border-neutral-800 dark:bg-neutral-900"
            />
          </label>
        </div>

        {!isEdit && (
          <label className="flex items-center gap-2 text-[12px]">
            <input
              type="checkbox"
              checked={draft.global}
              onChange={(e) => onChange({ ...draft, global: e.target.checked })}
            />
            <span>设为全局模板（workspaceId=null，跨工作区可见；编辑后不可改）</span>
          </label>
        )}
      </div>
    </div>
  );
}

// ============================================================================
// 系统prompt（只读聚合）
// ============================================================================

function SystemView() {
  const [list, setList] = useState<SystemPromptOverview[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const [scopeFilter, setScopeFilter] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setList(await api.listSystemPromptOverviews());
    } catch (err) {
      setError("加载失败：" + (err instanceof Error ? err.message : String(err)));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const allScopes = useMemo(() => {
    const s = new Set<string>();
    for (const o of list) s.add(o.scope);
    return Array.from(s).sort();
  }, [list]);

  const grouped = useMemo(() => {
    const q = filter.trim().toLowerCase();
    const m = new Map<string, SystemPromptOverview[]>();
    for (const o of list) {
      if (scopeFilter && o.scope !== scopeFilter) continue;
      if (q) {
        const hit =
          o.label.toLowerCase().includes(q) ||
          o.source.toLowerCase().includes(q) ||
          o.preview.toLowerCase().includes(q);
        if (!hit) continue;
      }
      const arr = m.get(o.scope);
      if (arr) arr.push(o);
      else m.set(o.scope, [o]);
    }
    return Array.from(m.entries());
  }, [list, filter, scopeFilter]);

  const matchedCount = useMemo(
    () => grouped.reduce((sum, [, arr]) => sum + arr.length, 0),
    [grouped],
  );

  return (
    <div className="flex min-h-0 w-full flex-col">
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-neutral-200 px-3 py-2 dark:border-neutral-800">
        <div className="relative">
          <Search className="absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-neutral-400" />
          <input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="搜索 label / source / preview"
            className="h-7 w-72 rounded-md border border-neutral-200 bg-white pl-7 pr-2 text-[12px] outline-none focus:border-neutral-400 dark:border-neutral-800 dark:bg-neutral-900"
          />
        </div>
        <button
          onClick={() => void reload()}
          disabled={loading}
          className="inline-flex h-7 items-center gap-1 rounded-md border border-neutral-200 px-2 text-[12px] text-neutral-600 hover:bg-neutral-50 disabled:opacity-50 dark:border-neutral-800 dark:text-neutral-300 dark:hover:bg-neutral-800/60"
        >
          <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} />
          刷新
        </button>
        <span className="ml-auto text-[11px] text-neutral-500">
          {matchedCount}/{list.length} · 只读
        </span>
      </div>

      {allScopes.length > 0 && (
        <div className="flex shrink-0 flex-wrap items-center gap-1 border-b border-neutral-100 px-3 py-1.5 dark:border-neutral-900">
          <span className="text-[11px] text-neutral-400">scope：</span>
          <button
            onClick={() => setScopeFilter(null)}
            className={cn(
              "rounded px-1.5 text-[11px]",
              scopeFilter === null
                ? "bg-neutral-200 text-neutral-900 dark:bg-neutral-700 dark:text-neutral-100"
                : "text-neutral-500 hover:bg-neutral-100 dark:text-neutral-400 dark:hover:bg-neutral-800",
            )}
          >
            全部
          </button>
          {allScopes.map((s) => (
            <button
              key={s}
              onClick={() => setScopeFilter(scopeFilter === s ? null : s)}
              className={cn(
                "rounded px-1.5 text-[11px]",
                scopeFilter === s
                  ? "bg-neutral-200 text-neutral-900 dark:bg-neutral-700 dark:text-neutral-100"
                  : "text-neutral-500 hover:bg-neutral-100 dark:text-neutral-400 dark:hover:bg-neutral-800",
              )}
            >
              {s}
            </button>
          ))}
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-2">
        {grouped.length === 0 ? (
          <div className="p-6 text-center text-[12px] text-neutral-400">
            {loading ? "加载中…" : list.length === 0 ? "暂无系统 prompt 记录" : "无匹配结果"}
          </div>
        ) : (
          grouped.map(([scope, items]) => (
            <section key={scope} className="mb-4">
              <h3 className="mb-1.5 flex items-center gap-2 text-[12px] font-medium text-neutral-700 dark:text-neutral-200">
                <span>{scope}</span>
                <span className="text-[10px] font-normal text-neutral-400">({items.length})</span>
              </h3>
              <ul className="space-y-1.5">
                {items.map((o) => (
                  <li
                    key={o.source}
                    className="rounded-md border border-neutral-200 bg-white p-2.5 dark:border-neutral-800 dark:bg-neutral-900"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <div className="text-[12px] font-medium text-neutral-800 dark:text-neutral-200">
                          {o.label}
                        </div>
                        <code className="mt-0.5 block truncate text-[10px] text-neutral-500">
                          {o.source}
                        </code>
                      </div>
                    </div>
                    <p className="mt-1.5 whitespace-pre-wrap break-words text-[12px] leading-relaxed text-neutral-600 dark:text-neutral-300">
                      {o.preview}
                    </p>
                  </li>
                ))}
              </ul>
            </section>
          ))
        )}
      </div>

      {error && (
        <div className="shrink-0 border-t border-red-200 bg-red-50 px-3 py-2 text-[12px] text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
          {error}
        </div>
      )}
    </div>
  );
}
