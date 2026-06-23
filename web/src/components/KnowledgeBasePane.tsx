// 知识库面板（资料库 + 检索） · D 域 D-PANEL（V-agent 已停用，前端归 D 承接）
// 数据安全：知识库 = 用户上传/登记的非结构化参考资料（folder kind 'knowledge'），
// 与 draw_data 原始数据严格隔离；本页所有内容均为用户主动提交的衍生产物。
// 上传走 file.text() 纯文本读取（.md/.txt/.csv），二进制文件用户应先转 markdown 再上传。

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FileText, Globe, Library, Plus, RefreshCw, Search, Trash2, Upload, X } from "lucide-react";
import { api } from "@/lib/api";
import { sharedApi } from "@/lib/api/shared";
import type { KnowledgeChunk, KnowledgeChunkHit, KnowledgeDoc } from "@/types";

const TEXT_EXT = new Set([".md", ".markdown", ".txt", ".csv", ".tsv", ".json", ".log"]);
const MAX_CONTENT_BYTES = 5 * 1024 * 1024;

function fmtTs(ts: number): string {
  return new Date(ts).toLocaleString();
}

function fmtSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

function highlightChunk(text: string, query: string) {
  const tokens = query
    .toLowerCase()
    .split(/\s+/)
    .map((t) => t.trim())
    .filter((t) => t.length >= 2);
  if (tokens.length === 0) return [<span key="0">{text}</span>];
  const escaped = tokens.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const re = new RegExp(`(${escaped.join("|")})`, "gi");
  const parts: Array<string | { mark: string; key: number }> = [];
  let lastIndex = 0;
  let m: RegExpExecArray | null;
  let key = 0;
  while ((m = re.exec(text)) !== null) {
    if (m.index > lastIndex) parts.push(text.slice(lastIndex, m.index));
    parts.push({ mark: m[0], key: key++ });
    lastIndex = m.index + m[0].length;
    if (m.index === re.lastIndex) re.lastIndex++;
  }
  if (lastIndex < text.length) parts.push(text.slice(lastIndex));
  return parts.map((p, i) =>
    typeof p === "string" ? (
      <span key={`s${i}`}>{p}</span>
    ) : (
      <mark key={`m${p.key}`} className="rounded bg-amber-200/70 px-0.5 dark:bg-amber-500/30">
        {p.mark}
      </mark>
    ),
  );
}

// ============================================================================
// 资料库视图（kb_docs）
// ============================================================================

function DocsView({ workspaceId, onDocsChanged }: { workspaceId: string; onDocsChanged?: () => void }) {
  const [docs, setDocs] = useState<KnowledgeDoc[]>([]);
  const [enabledSet, setEnabledSet] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [filter, setFilter] = useState("");
  const [tagFilter, setTagFilter] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<{ doc: KnowledgeDoc; chunks: KnowledgeChunk[] } | null>(null);
  const [busyEnableId, setBusyEnableId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [draftTitle, setDraftTitle] = useState("");
  const [draftContent, setDraftContent] = useState("");
  const [draftTags, setDraftTags] = useState("");
  const [draftPath, setDraftPath] = useState("");
  const [draftScope, setDraftScope] = useState<"global" | "workspace">("workspace");

  const reload = useCallback(async () => {
    if (!workspaceId) return;
    setLoading(true);
    setError(null);
    try {
      const [list, ens] = await Promise.all([
        api.listKnowledgeDocs(workspaceId),
        sharedApi.listMemoryEnablements(workspaceId, "knowledge"),
      ]);
      setDocs(list);
      setEnabledSet(new Set(ens.filter((e) => e.enabled).map((e) => e.itemId)));
    } catch (err) {
      setError(`加载失败：${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setLoading(false);
    }
  }, [workspaceId]);

  useEffect(() => {
    reload();
  }, [reload]);

  useEffect(() => {
    if (!selectedId) {
      setDetail(null);
      return;
    }
    let cancelled = false;
    api
      .getKnowledgeDoc(workspaceId, selectedId)
      .then((d) => {
        if (!cancelled) setDetail(d);
      })
      .catch((err) => {
        if (!cancelled) setError(`详情加载失败：${err instanceof Error ? err.message : String(err)}`);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedId, workspaceId]);

  const allTags = useMemo(() => {
    const s = new Set<string>();
    for (const d of docs) for (const t of d.tags) s.add(t);
    return Array.from(s).sort();
  }, [docs]);

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return docs.filter((d) => {
      if (q && !d.title.toLowerCase().includes(q)) return false;
      if (tagFilter && !d.tags.includes(tagFilter)) return false;
      return true;
    });
  }, [docs, filter, tagFilter]);

  const onPickFile = async (file: File) => {
    setError(null);
    if (file.size > MAX_CONTENT_BYTES) {
      setError(`文件过大（${fmtSize(file.size)}）；上限 ${fmtSize(MAX_CONTENT_BYTES)}`);
      return;
    }
    const dot = file.name.lastIndexOf(".");
    const ext = dot >= 0 ? file.name.toLowerCase().slice(dot) : "";
    if (!TEXT_EXT.has(ext)) {
      setError(`不支持的文件类型 ${ext || "(无后缀)"}；当前仅接受文本：${Array.from(TEXT_EXT).join(" / ")}`);
      return;
    }
    try {
      const text = await file.text();
      setDraftTitle(file.name);
      setDraftContent(text);
      setShowCreate(true);
    } catch (err) {
      setError(`读取文件失败：${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const submitCreate = async () => {
    if (!draftTitle.trim() || !draftContent.trim()) {
      setError("标题与内容均为必填");
      return;
    }
    setError(null);
    try {
      const tags = draftTags
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean);
      await api.createKnowledgeDoc(workspaceId, {
        title: draftTitle.trim(),
        content: draftContent,
        sourceType: draftPath ? "path" : "upload",
        path: draftPath || null,
        tags,
        scope: draftScope,
      });
      setShowCreate(false);
      setDraftTitle("");
      setDraftContent("");
      setDraftTags("");
      setDraftPath("");
      setDraftScope("workspace");
      await reload();
      onDocsChanged?.();
    } catch (err) {
      setError(`保存失败：${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const toggleEnablement = useCallback(
    async (doc: KnowledgeDoc, next: boolean) => {
      if (doc.scope !== "global") return; // workspace 私有不参与 enablement
      setBusyEnableId(doc.id);
      try {
        await sharedApi.setMemoryEnablement(workspaceId, "knowledge", doc.id, next);
        setEnabledSet((prev) => {
          const s = new Set(prev);
          if (next) s.add(doc.id);
          else s.delete(doc.id);
          return s;
        });
        onDocsChanged?.();
      } catch (err) {
        setError(`启用切换失败：${err instanceof Error ? err.message : String(err)}`);
      } finally {
        setBusyEnableId(null);
      }
    },
    [workspaceId, onDocsChanged],
  );

  const onDelete = async (id: string, title: string) => {
    if (!window.confirm(`确认删除「${title}」？该操作会级联删除所有 chunks，且不可撤销。`)) return;
    try {
      await api.deleteKnowledgeDoc(workspaceId, id);
      if (selectedId === id) setSelectedId(null);
      await reload();
      onDocsChanged?.();
    } catch (err) {
      setError(`删除失败：${err instanceof Error ? err.message : String(err)}`);
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-neutral-50/60 dark:bg-neutral-950">
      <div className="flex items-center gap-2 border-b border-neutral-200 bg-white px-4 py-2 dark:border-neutral-800 dark:bg-neutral-900">
        <Library className="h-4 w-4 text-neutral-500" />
        <span className="text-sm font-medium">资料库</span>
        <span className="text-xs text-neutral-500">{filtered.length} / {docs.length} 篇</span>
        <div className="ml-auto flex items-center gap-2">
          <input
            type="text"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="按标题筛选"
            className="h-7 w-48 rounded border border-neutral-300 bg-white px-2 text-xs dark:border-neutral-700 dark:bg-neutral-800"
          />
          <button
            onClick={() => fileInputRef.current?.click()}
            className="inline-flex items-center gap-1 rounded border border-neutral-300 bg-white px-2 py-1 text-xs hover:bg-neutral-50 dark:border-neutral-700 dark:bg-neutral-800 dark:hover:bg-neutral-700"
          >
            <Upload className="h-3 w-3" /> 上传文件
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".md,.markdown,.txt,.csv,.tsv,.json,.log"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) onPickFile(f);
              e.target.value = "";
            }}
          />
          <button
            onClick={() => {
              setDraftTitle("");
              setDraftContent("");
              setDraftTags("");
              setDraftPath("");
              setShowCreate(true);
            }}
            className="inline-flex items-center gap-1 rounded border border-blue-500 bg-blue-500 px-2 py-1 text-xs text-white hover:bg-blue-600"
          >
            <Plus className="h-3 w-3" /> 新建文档
          </button>
          <button
            onClick={reload}
            disabled={loading}
            className="inline-flex items-center gap-1 rounded border border-neutral-300 bg-white px-2 py-1 text-xs hover:bg-neutral-50 disabled:opacity-50 dark:border-neutral-700 dark:bg-neutral-800"
          >
            <RefreshCw className={`h-3 w-3 ${loading ? "animate-spin" : ""}`} /> 刷新
          </button>
        </div>
      </div>

      {allTags.length > 0 && (
        <div className="flex flex-wrap items-center gap-1 border-b border-neutral-200 bg-white px-4 py-2 dark:border-neutral-800 dark:bg-neutral-900">
          <span className="text-[11px] text-neutral-500">标签：</span>
          <button
            onClick={() => setTagFilter(null)}
            className={`rounded px-2 py-0.5 text-[11px] ${
              tagFilter === null
                ? "bg-blue-500 text-white"
                : "bg-neutral-100 text-neutral-700 hover:bg-neutral-200 dark:bg-neutral-800 dark:text-neutral-200"
            }`}
          >
            全部
          </button>
          {allTags.map((t) => (
            <button
              key={t}
              onClick={() => setTagFilter(t)}
              className={`rounded px-2 py-0.5 text-[11px] ${
                tagFilter === t
                  ? "bg-blue-500 text-white"
                  : "bg-neutral-100 text-neutral-700 hover:bg-neutral-200 dark:bg-neutral-800 dark:text-neutral-200"
              }`}
            >
              {t}
            </button>
          ))}
        </div>
      )}

      {error && (
        <div className="border-b border-red-200 bg-red-50 px-4 py-2 text-xs text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300">
          {error}
        </div>
      )}

      <div className="flex min-h-0 flex-1">
        <div className="flex w-1/2 min-w-0 flex-col border-r border-neutral-200 dark:border-neutral-800">
          <div className="flex-1 overflow-auto">
            {filtered.length === 0 ? (
              <div className="flex h-full items-center justify-center text-xs text-neutral-500">
                {docs.length === 0 ? "尚无文档，点击「上传文件」或「新建文档」开始" : "无匹配文档"}
              </div>
            ) : (
              <ul className="divide-y divide-neutral-200 dark:divide-neutral-800">
                {filtered.map((d) => {
                  const isGlobal = d.scope === "global";
                  const enabled = isGlobal && enabledSet.has(d.id);
                  return (
                  <li
                    key={d.id}
                    onClick={() => setSelectedId(d.id)}
                    className={`group flex cursor-pointer items-start gap-2 px-4 py-2.5 hover:bg-white dark:hover:bg-neutral-900 ${
                      selectedId === d.id ? "bg-white dark:bg-neutral-900" : ""
                    }`}
                  >
                    {isGlobal && (
                      <input
                        type="checkbox"
                        className="mt-1.5 shrink-0"
                        checked={enabled}
                        disabled={busyEnableId === d.id}
                        onChange={(e) => {
                          e.stopPropagation();
                          void toggleEnablement(d, e.target.checked);
                        }}
                        title={enabled ? "已启用，点击停用" : "未启用，点击启用"}
                        onClick={(e) => e.stopPropagation()}
                      />
                    )}
                    <FileText className="mt-0.5 h-4 w-4 flex-shrink-0 text-neutral-500" />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <span className="truncate text-sm font-medium">{d.title}</span>
                        {isGlobal && (
                          <span className="inline-flex shrink-0 items-center gap-0.5 rounded bg-amber-100 px-1 text-[10px] text-amber-700 dark:bg-amber-950 dark:text-amber-300">
                            <Globe className="h-2.5 w-2.5" />
                            通用
                          </span>
                        )}
                      </div>
                      <div className="mt-0.5 flex flex-wrap items-center gap-1 text-[11px] text-neutral-500">
                        <span>{fmtTs(d.updatedAt)}</span>
                        <span>·</span>
                        <span>{d.sourceType}</span>
                        {d.tags.map((t) => (
                          <span
                            key={t}
                            className="rounded bg-neutral-100 px-1 py-0.5 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300"
                          >
                            {t}
                          </span>
                        ))}
                      </div>
                    </div>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onDelete(d.id, d.title);
                      }}
                      className="flex-shrink-0 rounded p-1 text-neutral-400 opacity-0 hover:bg-red-50 hover:text-red-600 group-hover:opacity-100 dark:hover:bg-red-950/30"
                      title="删除"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>

        <div className="flex w-1/2 min-w-0 flex-col">
          {detail ? (
            <>
              <div className="border-b border-neutral-200 bg-white px-4 py-2 dark:border-neutral-800 dark:bg-neutral-900">
                <div className="flex items-center justify-between">
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium">{detail.doc.title}</div>
                    <div className="mt-0.5 text-[11px] text-neutral-500">
                      创建 {fmtTs(detail.doc.createdAt)} · 更新 {fmtTs(detail.doc.updatedAt)} ·{" "}
                      {detail.chunks.length} chunks
                      {detail.doc.path && <> · 路径 <code className="font-mono">{detail.doc.path}</code></>}
                    </div>
                  </div>
                  <button
                    onClick={() => setSelectedId(null)}
                    className="rounded p-1 text-neutral-500 hover:bg-neutral-100 dark:hover:bg-neutral-800"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              </div>
              <div className="flex-1 overflow-auto bg-white p-4 dark:bg-neutral-900">
                <pre className="whitespace-pre-wrap break-words text-xs text-neutral-700 dark:text-neutral-200">
                  {detail.doc.content ?? ""}
                </pre>
                {detail.chunks.length > 1 && (
                  <details className="mt-4">
                    <summary className="cursor-pointer text-[11px] text-neutral-500">
                      查看分块（{detail.chunks.length} 片，便于调试 BM25 召回粒度）
                    </summary>
                    <ul className="mt-2 space-y-2">
                      {detail.chunks.map((c) => (
                        <li
                          key={c.id}
                          className="rounded border border-neutral-200 bg-neutral-50 p-2 text-[11px] dark:border-neutral-800 dark:bg-neutral-950"
                        >
                          <div className="mb-1 text-neutral-500">
                            #{c.idx} · {c.text.length} chars · ~{c.tokens ?? "?"} tokens
                          </div>
                          <div className="whitespace-pre-wrap break-words text-neutral-700 dark:text-neutral-200">
                            {c.text}
                          </div>
                        </li>
                      ))}
                    </ul>
                  </details>
                )}
              </div>
            </>
          ) : (
            <div className="flex h-full items-center justify-center text-xs text-neutral-500">
              点击左侧文档查看详情
            </div>
          )}
        </div>
      </div>

      {showCreate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="flex max-h-[90vh] w-full max-w-2xl flex-col rounded-lg border border-neutral-200 bg-white shadow-xl dark:border-neutral-800 dark:bg-neutral-900">
            <div className="flex items-center justify-between border-b border-neutral-200 px-4 py-3 dark:border-neutral-800">
              <div className="text-sm font-medium">新建知识文档</div>
              <button
                onClick={() => setShowCreate(false)}
                className="rounded p-1 text-neutral-500 hover:bg-neutral-100 dark:hover:bg-neutral-800"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="flex-1 space-y-3 overflow-auto p-4">
              <label className="block">
                <span className="text-xs text-neutral-600 dark:text-neutral-400">标题 *</span>
                <input
                  type="text"
                  value={draftTitle}
                  onChange={(e) => setDraftTitle(e.target.value)}
                  placeholder="例如：复购率分析口径 v3"
                  className="mt-1 block w-full rounded border border-neutral-300 bg-white px-2 py-1 text-sm dark:border-neutral-700 dark:bg-neutral-800"
                />
              </label>
              <label className="block">
                <span className="text-xs text-neutral-600 dark:text-neutral-400">
                  内容 *（≤ {fmtSize(MAX_CONTENT_BYTES)}，UTF-8）
                </span>
                <textarea
                  value={draftContent}
                  onChange={(e) => setDraftContent(e.target.value)}
                  rows={14}
                  placeholder="粘贴 markdown / 纯文本内容；后端会按段落优先策略分块（budget 1200 chars / overlap 120）"
                  className="mt-1 block w-full rounded border border-neutral-300 bg-white px-2 py-1 font-mono text-xs dark:border-neutral-700 dark:bg-neutral-800"
                />
                <span className="mt-0.5 block text-[10.5px] text-neutral-500">
                  当前 {fmtSize(new TextEncoder().encode(draftContent).length)}
                </span>
              </label>
              <label className="block">
                <span className="text-xs text-neutral-600 dark:text-neutral-400">标签（英文逗号分隔，可选）</span>
                <input
                  type="text"
                  value={draftTags}
                  onChange={(e) => setDraftTags(e.target.value)}
                  placeholder="例如：指标, 复购, SOP"
                  className="mt-1 block w-full rounded border border-neutral-300 bg-white px-2 py-1 text-sm dark:border-neutral-700 dark:bg-neutral-800"
                />
              </label>
              <label className="block">
                <span className="text-xs text-neutral-600 dark:text-neutral-400">
                  来源路径（可选，仅作元数据展示；server 不会基于此读 fs）
                </span>
                <input
                  type="text"
                  value={draftPath}
                  onChange={(e) => setDraftPath(e.target.value)}
                  placeholder="例如：/Users/.../report.md"
                  className="mt-1 block w-full rounded border border-neutral-300 bg-white px-2 py-1 font-mono text-xs dark:border-neutral-700 dark:bg-neutral-800"
                />
              </label>
              <fieldset className="block">
                <legend className="text-xs text-neutral-600 dark:text-neutral-400">作用域 *</legend>
                <div className="mt-1 flex gap-3 text-xs">
                  <label className="flex items-center gap-1.5">
                    <input
                      type="radio"
                      name="kb-scope"
                      value="workspace"
                      checked={draftScope === "workspace"}
                      onChange={() => setDraftScope("workspace")}
                    />
                    <span>项目专属（仅本工作区可见）</span>
                  </label>
                  <label className="flex items-center gap-1.5">
                    <input
                      type="radio"
                      name="kb-scope"
                      value="global"
                      checked={draftScope === "global"}
                      onChange={() => setDraftScope("global")}
                    />
                    <span className="inline-flex items-center gap-1">
                      <Globe className="h-3 w-3 text-amber-600" />
                      通用（入全局池，跨工作区可启用）
                    </span>
                  </label>
                </div>
              </fieldset>
            </div>
            <div className="flex items-center justify-end gap-2 border-t border-neutral-200 px-4 py-3 dark:border-neutral-800">
              <button
                onClick={() => setShowCreate(false)}
                className="rounded border border-neutral-300 bg-white px-3 py-1 text-xs hover:bg-neutral-50 dark:border-neutral-700 dark:bg-neutral-800"
              >
                取消
              </button>
              <button
                onClick={submitCreate}
                className="rounded border border-blue-500 bg-blue-500 px-3 py-1 text-xs text-white hover:bg-blue-600"
              >
                保存
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ============================================================================
// 检索视图（kb_search）
// ============================================================================

function SearchView({ workspaceId }: { workspaceId: string }) {
  const [query, setQuery] = useState("");
  const [topK, setTopK] = useState(10);
  const [hits, setHits] = useState<KnowledgeChunkHit[]>([]);
  const [docs, setDocs] = useState<KnowledgeDoc[]>([]);
  const [docFilter, setDocFilter] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searched, setSearched] = useState(false);

  useEffect(() => {
    if (!workspaceId) return;
    let cancelled = false;
    api
      .listKnowledgeDocs(workspaceId)
      .then((list) => {
        if (!cancelled) setDocs(list);
      })
      .catch(() => {
        // 静默失败：检索不强依赖 docs 列表（只用于 docIds 过滤 UI）
      });
    return () => {
      cancelled = true;
    };
  }, [workspaceId]);

  const onSearch = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!query.trim()) return;
    setLoading(true);
    setError(null);
    setSearched(true);
    try {
      const docIds = docFilter.size > 0 ? Array.from(docFilter) : undefined;
      const res = await api.searchKnowledge(workspaceId, query.trim(), { topK, docIds });
      setHits(res.hits);
    } catch (err) {
      setError(`检索失败：${err instanceof Error ? err.message : String(err)}`);
      setHits([]);
    } finally {
      setLoading(false);
    }
  };

  const toggleDoc = (id: string) => {
    setDocFilter((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-neutral-50/60 dark:bg-neutral-950">
      <form
        onSubmit={onSearch}
        className="flex items-center gap-2 border-b border-neutral-200 bg-white px-4 py-2 dark:border-neutral-800 dark:bg-neutral-900"
      >
        <Search className="h-4 w-4 text-neutral-500" />
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="输入查询关键词（中英混合 / 多词空格分隔，BM25 召回）"
          className="h-8 flex-1 rounded border border-neutral-300 bg-white px-2 text-sm dark:border-neutral-700 dark:bg-neutral-800"
        />
        <label className="flex items-center gap-1 text-xs text-neutral-600 dark:text-neutral-400">
          topK
          <input
            type="number"
            min={1}
            max={50}
            value={topK}
            onChange={(e) => setTopK(Math.max(1, Math.min(50, Number(e.target.value) || 10)))}
            className="h-7 w-14 rounded border border-neutral-300 bg-white px-2 text-xs dark:border-neutral-700 dark:bg-neutral-800"
          />
        </label>
        <button
          type="submit"
          disabled={loading || !query.trim()}
          className="inline-flex items-center gap-1 rounded border border-blue-500 bg-blue-500 px-3 py-1 text-xs text-white hover:bg-blue-600 disabled:opacity-50"
        >
          {loading ? <RefreshCw className="h-3 w-3 animate-spin" /> : <Search className="h-3 w-3" />}
          检索
        </button>
      </form>

      {docs.length > 0 && (
        <div className="flex flex-wrap items-center gap-1 border-b border-neutral-200 bg-white px-4 py-2 dark:border-neutral-800 dark:bg-neutral-900">
          <span className="text-[11px] text-neutral-500">
            限定文档（{docFilter.size === 0 ? "全部" : `${docFilter.size}/${docs.length}`}）：
          </span>
          {docFilter.size > 0 && (
            <button
              onClick={() => setDocFilter(new Set())}
              className="rounded bg-neutral-100 px-2 py-0.5 text-[11px] text-neutral-700 hover:bg-neutral-200 dark:bg-neutral-800 dark:text-neutral-200"
            >
              清空
            </button>
          )}
          {docs.map((d) => (
            <button
              key={d.id}
              onClick={() => toggleDoc(d.id)}
              title={d.title}
              className={`max-w-[200px] truncate rounded px-2 py-0.5 text-[11px] ${
                docFilter.has(d.id)
                  ? "bg-blue-500 text-white"
                  : "bg-neutral-100 text-neutral-700 hover:bg-neutral-200 dark:bg-neutral-800 dark:text-neutral-200"
              }`}
            >
              {d.title}
            </button>
          ))}
        </div>
      )}

      {error && (
        <div className="border-b border-red-200 bg-red-50 px-4 py-2 text-xs text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300">
          {error}
        </div>
      )}

      <div className="flex-1 overflow-auto p-4">
        {!searched ? (
          <div className="flex h-full items-center justify-center text-xs text-neutral-500">
            输入查询并点击「检索」开始
          </div>
        ) : hits.length === 0 ? (
          <div className="flex h-full items-center justify-center text-xs text-neutral-500">
            无召回结果（试着换个关键词或扩大 topK）
          </div>
        ) : (
          <ul className="space-y-3">
            {hits.map((hit, i) => (
              <li
                key={hit.chunk.id}
                className="rounded border border-neutral-200 bg-white p-3 dark:border-neutral-800 dark:bg-neutral-900"
              >
                <div className="mb-2 flex items-center gap-2 text-[11px] text-neutral-500">
                  <span className="rounded bg-blue-50 px-1.5 py-0.5 font-mono text-blue-700 dark:bg-blue-950/30 dark:text-blue-300">
                    #{i + 1}
                  </span>
                  <FileText className="h-3 w-3" />
                  <span className="truncate font-medium text-neutral-700 dark:text-neutral-200">
                    {hit.doc.title}
                  </span>
                  <span>· chunk #{hit.chunk.idx}</span>
                  <span className="ml-auto flex items-center gap-2 font-mono">
                    <span title="综合分">score={hit.score.toFixed(3)}</span>
                    <span title="BM25 相关性（已归一）">rel={hit.signals.relevance.toFixed(3)}</span>
                    <span title="文档新鲜度（半衰期 60d）">rec={hit.signals.recency.toFixed(3)}</span>
                    <span title="稀有词命中加成">idf={hit.signals.idfBoost.toFixed(3)}</span>
                  </span>
                </div>
                {hit.doc.tags.length > 0 && (
                  <div className="mb-2 flex flex-wrap gap-1">
                    {hit.doc.tags.map((t) => (
                      <span
                        key={t}
                        className="rounded bg-neutral-100 px-1.5 py-0.5 text-[10.5px] text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300"
                      >
                        {t}
                      </span>
                    ))}
                  </div>
                )}
                <div className="whitespace-pre-wrap break-words text-xs text-neutral-700 dark:text-neutral-200">
                  {highlightChunk(hit.chunk.text, query)}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

// ============================================================================
// 主入口（按 view 派发）
// ============================================================================

export function KnowledgeBasePane({
  workspaceId,
  view,
  onDocsChanged,
}: {
  workspaceId: string | null;
  view: "docs" | "search";
  onDocsChanged?: () => void;
}) {
  if (!workspaceId) {
    return (
      <div className="flex flex-1 items-center justify-center text-xs text-neutral-500">
        请先选择 workspace
      </div>
    );
  }
  return view === "docs" ? <DocsView workspaceId={workspaceId} onDocsChanged={onDocsChanged} /> : <SearchView workspaceId={workspaceId} />;
}
