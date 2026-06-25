// 知识库面板（资料库 + 检索） · D 域 D-PANEL（V-agent 已停用，前端归 D 承接）
// 数据安全：知识库 = 用户上传/登记的非结构化参考资料（folder kind 'knowledge'），
// 与 draw_data 原始数据严格隔离；本页所有内容均为用户主动提交的衍生产物。
// 上传走 file.text() 纯文本读取（.md/.txt/.csv），二进制文件用户应先转 markdown 再上传。

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Check, Copy, FileText, Globe, Library, Plus, RefreshCw, Search, Trash2, Upload, X } from "lucide-react";
import { api } from "@/lib/api";
import { sharedApi } from "@/lib/api/shared";
import { Markdown } from "@/components/Markdown";
import type { KnowledgeChunk, KnowledgeDoc, KnowledgeDocSearchResult } from "@/types";

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
// 检索视图（kb_search · E-KB3：doc 级搜索 + 全文抽屉）
// 调用 D-KB1 GET /knowledge/search（doc 级聚合）；抽屉用 GET /knowledge/:docId 取全文。
// 零新后端路由；零 LLM 调用；与「知识库注入」(被动 RAG) 独立。
// ============================================================================

const SEARCH_DEBOUNCE_MS = 300;
const SNIPPET_PREVIEW_LIMIT = 200;

function SearchView({ workspaceId }: { workspaceId: string }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<KnowledgeDocSearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [openDocId, setOpenDocId] = useState<string | null>(null);
  const requestTokenRef = useRef(0);

  const trimmed = query.trim();

  useEffect(() => {
    if (!trimmed) {
      setResults([]);
      setError(null);
      setLoading(false);
      return;
    }
    const token = ++requestTokenRef.current;
    setLoading(true);
    setError(null);
    const timer = window.setTimeout(() => {
      api
        .searchKnowledgeDocs(workspaceId, trimmed, 20)
        .then((res) => {
          if (token !== requestTokenRef.current) return;
          setResults(res.results);
        })
        .catch((err) => {
          if (token !== requestTokenRef.current) return;
          setError(`检索失败：${err instanceof Error ? err.message : String(err)}`);
          setResults([]);
        })
        .finally(() => {
          if (token !== requestTokenRef.current) return;
          setLoading(false);
        });
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      window.clearTimeout(timer);
    };
  }, [trimmed, workspaceId]);

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-neutral-50/60 dark:bg-neutral-950">
      <div className="flex items-center gap-2 border-b border-neutral-200 bg-white px-4 py-2 dark:border-neutral-800 dark:bg-neutral-900">
        <Search className="h-4 w-4 text-neutral-500" />
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="搜索文档（标题 / 标签 / 正文，输入后自动检索）"
          className="h-8 flex-1 rounded border border-neutral-300 bg-white px-2 text-sm dark:border-neutral-700 dark:bg-neutral-800"
        />
        {loading && <RefreshCw className="h-3 w-3 animate-spin text-neutral-400" />}
        {query && (
          <button
            onClick={() => setQuery("")}
            className="rounded p-1 text-neutral-500 hover:bg-neutral-100 dark:hover:bg-neutral-800"
            title="清空"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
        <span className="text-[11px] text-neutral-500">
          {trimmed ? `${results.length} 条结果` : "主动检索"}
        </span>
      </div>

      {error && (
        <div className="border-b border-red-200 bg-red-50 px-4 py-2 text-xs text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300">
          {error}
        </div>
      )}

      <div className="flex-1 overflow-auto p-4">
        {!trimmed ? (
          <div className="flex h-full items-center justify-center text-xs text-neutral-500">
            输入关键词搜索知识库
          </div>
        ) : results.length === 0 && !loading ? (
          <div className="flex h-full items-center justify-center text-xs text-neutral-500">
            未找到匹配文档，尝试换词或添加标签
          </div>
        ) : (
          <ul className="space-y-2">
            {results.map((r, i) => (
              <SearchResultCard
                key={r.doc.id}
                rank={i + 1}
                result={r}
                query={trimmed}
                onOpen={() => setOpenDocId(r.doc.id)}
              />
            ))}
          </ul>
        )}
      </div>

      {openDocId && (
        <DocFullTextDrawer
          workspaceId={workspaceId}
          docId={openDocId}
          onClose={() => setOpenDocId(null)}
        />
      )}
    </div>
  );
}

function SearchResultCard({
  rank,
  result,
  query,
  onOpen,
}: {
  rank: number;
  result: KnowledgeDocSearchResult;
  query: string;
  onOpen: () => void;
}) {
  const relevance = Math.min(100, Math.max(0, Math.round(result.score * 100)));
  const snippet = result.snippet.length > SNIPPET_PREVIEW_LIMIT
    ? `${result.snippet.slice(0, SNIPPET_PREVIEW_LIMIT)}…`
    : result.snippet;
  return (
    <li>
      <button
        onClick={onOpen}
        className="w-full rounded border border-neutral-200 bg-white p-3 text-left transition-colors hover:border-blue-300 hover:bg-blue-50/30 dark:border-neutral-800 dark:bg-neutral-900 dark:hover:border-blue-700 dark:hover:bg-blue-950/20"
      >
        <div className="mb-1.5 flex items-center gap-2 text-[11px] text-neutral-500">
          <span className="rounded bg-blue-50 px-1.5 py-0.5 font-mono text-blue-700 dark:bg-blue-950/30 dark:text-blue-300">
            #{rank}
          </span>
          <FileText className="h-3 w-3 shrink-0" />
          <span className="truncate text-sm font-medium text-neutral-800 dark:text-neutral-100">
            {result.doc.title}
          </span>
          <span className="ml-auto flex shrink-0 items-center gap-2 font-mono">
            <span title="综合相关度（0-100）">{relevance}</span>
            <span className="text-neutral-400" title="命中 chunk 数">· {result.matchedChunkCount}片</span>
          </span>
        </div>
        {result.doc.tags.length > 0 && (
          <div className="mb-1.5 flex flex-wrap gap-1">
            {result.doc.tags.map((t) => (
              <span
                key={t}
                className="rounded bg-neutral-100 px-1.5 py-0.5 text-[10.5px] text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300"
              >
                {t}
              </span>
            ))}
          </div>
        )}
        <div className="whitespace-pre-wrap break-words text-xs leading-relaxed text-neutral-600 dark:text-neutral-300">
          {highlightChunk(snippet, query)}
        </div>
      </button>
    </li>
  );
}

function DocFullTextDrawer({
  workspaceId,
  docId,
  onClose,
}: {
  workspaceId: string;
  docId: string;
  onClose: () => void;
}) {
  const [detail, setDetail] = useState<{ doc: KnowledgeDoc; chunks: KnowledgeChunk[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [copiedKind, setCopiedKind] = useState<"content" | "ref" | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    api
      .getKnowledgeDoc(workspaceId, docId)
      .then((d) => {
        if (!cancelled) setDetail(d);
      })
      .catch((err) => {
        if (!cancelled) setError(`加载失败：${err instanceof Error ? err.message : String(err)}`);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [workspaceId, docId]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const refText = useMemo(() => {
    if (!detail) return "";
    const parts = [detail.doc.title];
    if (detail.doc.path) parts.push(detail.doc.path);
    return parts.join("\n");
  }, [detail]);

  const copyText = (text: string, kind: "content" | "ref") => {
    if (!text) return;
    void navigator.clipboard.writeText(text).then(() => {
      setCopiedKind(kind);
      window.setTimeout(() => setCopiedKind(null), 1500);
    });
  };

  const content = detail?.doc.content ?? "";

  return (
    <div className="fixed inset-0 z-50 flex" onClick={onClose}>
      <div className="flex-1 bg-black/30 backdrop-blur-[2px]" />
      <aside
        className="flex w-full max-w-3xl flex-col border-l border-neutral-200 bg-white shadow-2xl dark:border-neutral-800 dark:bg-neutral-950"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start gap-3 border-b border-neutral-200 px-5 py-4 dark:border-neutral-800">
          <div className="min-w-0 flex-1">
            {detail ? (
              <>
                <h2
                  className="truncate text-[15px] font-semibold text-neutral-900 dark:text-neutral-100"
                  title={detail.doc.title}
                >
                  {detail.doc.title}
                </h2>
                {detail.doc.tags.length > 0 && (
                  <div className="mt-1.5 flex flex-wrap gap-1">
                    {detail.doc.tags.map((t) => (
                      <span
                        key={t}
                        className="rounded bg-neutral-100 px-1.5 py-0.5 text-[10.5px] text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300"
                      >
                        {t}
                      </span>
                    ))}
                  </div>
                )}
                <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11.5px] text-neutral-500 dark:text-neutral-400">
                  <span>上传 {fmtTs(detail.doc.createdAt)}</span>
                  <span>更新 {fmtTs(detail.doc.updatedAt)}</span>
                  <span>{detail.chunks.length} chunks</span>
                  {detail.doc.path && (
                    <span className="truncate" title={detail.doc.path}>
                      来源 <code className="font-mono">{detail.doc.path}</code>
                    </span>
                  )}
                </div>
              </>
            ) : (
              <div className="text-sm text-neutral-500">{loading ? "加载中…" : "—"}</div>
            )}
          </div>
          <button
            onClick={onClose}
            className="rounded-md p-1.5 text-neutral-500 hover:bg-neutral-100 hover:text-neutral-900 dark:hover:bg-neutral-800 dark:hover:text-neutral-100"
            aria-label="关闭"
          >
            <X className="h-4 w-4" strokeWidth={1.75} />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
          {loading && (
            <div className="flex h-full items-center justify-center text-xs text-neutral-400">
              <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
              加载中…
            </div>
          )}
          {error && !loading && (
            <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-xs text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300">
              {error}
            </div>
          )}
          {!loading && !error && detail && (
            content ? <Markdown>{content}</Markdown> : (
              <div className="text-xs text-neutral-500">（文档无正文）</div>
            )
          )}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-neutral-200 px-5 py-3 dark:border-neutral-800">
          <button
            onClick={() => copyText(content, "content")}
            disabled={!detail || !content}
            className="inline-flex items-center gap-1.5 rounded-md border border-neutral-200 bg-white px-3 py-1.5 text-[12px] text-neutral-600 hover:bg-neutral-50 disabled:opacity-50 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-300 dark:hover:bg-neutral-800"
          >
            {copiedKind === "content" ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
            {copiedKind === "content" ? "已复制" : "复制全文"}
          </button>
          <button
            onClick={() => copyText(refText, "ref")}
            disabled={!detail}
            className="inline-flex items-center gap-1.5 rounded-md border border-neutral-200 bg-white px-3 py-1.5 text-[12px] text-neutral-600 hover:bg-neutral-50 disabled:opacity-50 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-300 dark:hover:bg-neutral-800"
          >
            {copiedKind === "ref" ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
            {copiedKind === "ref" ? "已复制" : "复制引用"}
          </button>
        </div>
      </aside>
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
