import { useEffect, useMemo, useRef, useState } from "react";
import { X, Star, FolderOpen, Copy, Loader2, ExternalLink, Tag as TagIcon, Plus } from "lucide-react";
import { api } from "@/lib/api";
import { Markdown } from "@/components/Markdown";
import { cn } from "@/lib/cn";
import type { ReportEntry } from "@/types";
import { REPORT_TYPE_LABELS, REPORT_TYPE_COLORS, formatDate, formatSize } from "@/lib/reportTypeClassifier";

interface Props {
  entry: ReportEntry | null;
  allTags: Array<{ tag: string; count: number }>;
  onClose: () => void;
  onToggleFavorite: (id: string) => void;
  onAddTag: (id: string, tag: string) => void;
  onRemoveTag: (id: string, tag: string) => void;
}

const MAX_PREVIEW_BYTES = 2 * 1024 * 1024; // 2 MB

export function ReportPreviewDrawer({ entry, allTags, onClose, onToggleFavorite, onAddTag, onRemoveTag }: Props) {
  const [content, setContent] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [tagInput, setTagInput] = useState("");
  const [adding, setAdding] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!entry) return;
    setContent(null);
    setError(null);
    if (entry.extension === "html") {
      // iframe 直接走 src,不需要 fetch
      return;
    }
    if (entry.sizeBytes > MAX_PREVIEW_BYTES) {
      setError(`文件过大 (${formatSize(entry.sizeBytes)}),已跳过自动预览。可点击「在 Finder 打开」查看。`);
      return;
    }
    setLoading(true);
    api.getReportFileContent(entry.absolutePath)
      .then((text) => setContent(text))
      .catch((err) => setError(String((err as Error)?.message ?? err)))
      .finally(() => setLoading(false));
  }, [entry]);

  useEffect(() => {
    if (!entry) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [entry, onClose]);

  if (!entry) return null;

  const handleCopy = () => {
    navigator.clipboard.writeText(entry.absolutePath).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  const handleOpenFinder = () => {
    api.openReportInFinder(entry.absolutePath).catch((err) => {
      setError(String((err as Error)?.message ?? err));
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex" onClick={onClose}>
      <div className="flex-1 bg-black/30 backdrop-blur-[2px]" />
      <aside
        className="flex w-full max-w-3xl flex-col border-l border-neutral-200 bg-white shadow-2xl dark:border-neutral-800 dark:bg-neutral-950"
        onClick={(e) => e.stopPropagation()}
      >
        {/* header */}
        <div className="flex items-start gap-3 border-b border-neutral-200 px-5 py-4 dark:border-neutral-800">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className={cn("inline-flex items-center rounded-md border px-2 py-0.5 text-[10.5px] font-medium", REPORT_TYPE_COLORS[entry.reportType])}>
                {REPORT_TYPE_LABELS[entry.reportType]}
              </span>
              <span className="text-[11px] uppercase tracking-wider text-neutral-400">{entry.extension}</span>
            </div>
            <h2 className="mt-1.5 truncate text-[15px] font-semibold text-neutral-900 dark:text-neutral-100" title={entry.filename}>
              {entry.filename}
            </h2>
            <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11.5px] text-neutral-500 dark:text-neutral-400">
              <span>{entry.workspaceName ?? entry.workspaceId.slice(0, 8)}</span>
              {entry.flowId && <span>flow: {entry.flowName ?? entry.flowId.slice(0, 8)}</span>}
              {entry.runId && <span>run: {entry.runId.slice(0, 8)}</span>}
              <span>{formatSize(entry.sizeBytes)}</span>
              <span>{formatDate(entry.createdAt)}</span>
            </div>
          </div>
          <button
            onClick={onClose}
            className="rounded-md p-1.5 text-neutral-500 hover:bg-neutral-100 hover:text-neutral-900 dark:hover:bg-neutral-800 dark:hover:text-neutral-100"
            aria-label="关闭"
          >
            <X className="h-4 w-4" strokeWidth={1.75} />
          </button>
        </div>

        {/* body */}
        <div className="min-h-0 flex-1 overflow-y-auto">
          {loading && (
            <div className="flex h-full items-center justify-center text-neutral-400">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              <span className="text-[12.5px]">加载中…</span>
            </div>
          )}
          {error && !loading && (
            <div className="m-5 rounded-lg border border-amber-200 bg-amber-50 p-4 text-[12.5px] text-amber-800 dark:border-amber-800 dark:bg-amber-900/20 dark:text-amber-300">
              {error}
            </div>
          )}
          {!loading && !error && (
            entry.extension === "md" && content !== null ? (
              <div className="px-6 py-5">
                <Markdown>{content}</Markdown>
              </div>
            ) : entry.extension === "html" ? (
              <iframe
                title={entry.filename}
                src={`/api/reports/file?path=${encodeURIComponent(entry.absolutePath)}`}
                sandbox="allow-same-origin"
                className="h-full w-full border-0"
              />
            ) : null
          )}
        </div>

        {/* tags */}
        <TagEditor
          entry={entry}
          allTags={allTags}
          tagInput={tagInput}
          setTagInput={setTagInput}
          adding={adding}
          setAdding={setAdding}
          inputRef={inputRef}
          onAddTag={onAddTag}
          onRemoveTag={onRemoveTag}
        />

        {/* footer */}
        <div className="flex items-center justify-between gap-2 border-t border-neutral-200 px-5 py-3 dark:border-neutral-800">
          <button
            onClick={() => onToggleFavorite(entry.id)}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-[12px] font-medium transition-colors",
              entry.isFavorite
                ? "border-amber-200 bg-amber-50 text-amber-700 hover:bg-amber-100 dark:border-amber-800 dark:bg-amber-900/20 dark:text-amber-300"
                : "border-neutral-200 bg-white text-neutral-600 hover:bg-neutral-50 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-300 dark:hover:bg-neutral-800",
            )}
          >
            <Star className={cn("h-3.5 w-3.5", entry.isFavorite && "fill-current")} strokeWidth={1.75} />
            {entry.isFavorite ? "已收藏" : "收藏"}
          </button>
          <div className="flex items-center gap-1.5">
            <button
              onClick={handleCopy}
              className="inline-flex items-center gap-1.5 rounded-md border border-neutral-200 bg-white px-3 py-1.5 text-[12px] text-neutral-600 hover:bg-neutral-50 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-300 dark:hover:bg-neutral-800"
            >
              <Copy className="h-3.5 w-3.5" strokeWidth={1.75} />
              {copied ? "已复制" : "复制路径"}
            </button>
            <button
              onClick={handleOpenFinder}
              className="inline-flex items-center gap-1.5 rounded-md border border-neutral-200 bg-white px-3 py-1.5 text-[12px] text-neutral-600 hover:bg-neutral-50 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-300 dark:hover:bg-neutral-800"
            >
              <FolderOpen className="h-3.5 w-3.5" strokeWidth={1.75} />
              在 Finder 打开
            </button>
            {entry.extension === "html" && (
              <a
                href={`/api/reports/file?path=${encodeURIComponent(entry.absolutePath)}`}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1.5 rounded-md border border-neutral-200 bg-white px-3 py-1.5 text-[12px] text-neutral-600 hover:bg-neutral-50 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-300 dark:hover:bg-neutral-800"
              >
                <ExternalLink className="h-3.5 w-3.5" strokeWidth={1.75} />
                浏览器打开
              </a>
            )}
          </div>
        </div>
      </aside>
    </div>
  );
}

function TagEditor({
  entry,
  allTags,
  tagInput,
  setTagInput,
  adding,
  setAdding,
  inputRef,
  onAddTag,
  onRemoveTag,
}: {
  entry: ReportEntry;
  allTags: Array<{ tag: string; count: number }>;
  tagInput: string;
  setTagInput: (v: string) => void;
  adding: boolean;
  setAdding: (v: boolean) => void;
  inputRef: React.RefObject<HTMLInputElement>;
  onAddTag: (id: string, tag: string) => void;
  onRemoveTag: (id: string, tag: string) => void;
}) {
  const suggestions = useMemo(() => {
    const q = tagInput.trim().toLowerCase();
    const existing = new Set(entry.tags);
    return allTags
      .filter((t) => !existing.has(t.tag))
      .filter((t) => !q || t.tag.toLowerCase().includes(q))
      .slice(0, 8);
  }, [allTags, entry.tags, tagInput]);

  const commit = (tag: string) => {
    const cleaned = tag.trim();
    if (!cleaned) return;
    onAddTag(entry.id, cleaned);
    setTagInput("");
    inputRef.current?.focus();
  };

  return (
    <div className="border-t border-neutral-200 bg-neutral-50/60 px-5 py-3 dark:border-neutral-800 dark:bg-neutral-900/40">
      <div className="mb-2 flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wider text-neutral-400">
        <TagIcon className="h-3 w-3" strokeWidth={2} />
        标签
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        {entry.tags.map((tag) => (
          <span
            key={tag}
            className="group inline-flex items-center gap-1 rounded-full border border-blue-200 bg-blue-50 px-2 py-0.5 text-[11.5px] text-blue-700 dark:border-blue-800 dark:bg-blue-900/20 dark:text-blue-300"
          >
            {tag}
            <button
              onClick={() => onRemoveTag(entry.id, tag)}
              className="rounded-full p-0.5 text-blue-400 hover:bg-blue-100 hover:text-blue-700 dark:hover:bg-blue-800/40"
              aria-label={`移除 ${tag}`}
            >
              <X className="h-2.5 w-2.5" strokeWidth={2.5} />
            </button>
          </span>
        ))}
        {!adding ? (
          <button
            onClick={() => {
              setAdding(true);
              setTimeout(() => inputRef.current?.focus(), 0);
            }}
            className="inline-flex items-center gap-1 rounded-full border border-dashed border-neutral-300 px-2 py-0.5 text-[11.5px] text-neutral-500 hover:border-neutral-400 hover:text-neutral-700 dark:border-neutral-600 dark:text-neutral-400"
          >
            <Plus className="h-3 w-3" strokeWidth={2} />
            添加
          </button>
        ) : (
          <div className="relative">
            <input
              ref={inputRef}
              value={tagInput}
              onChange={(e) => setTagInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  commit(tagInput);
                } else if (e.key === "Escape") {
                  setAdding(false);
                  setTagInput("");
                }
              }}
              onBlur={() => {
                // 延迟,让 suggestion mousedown 先触发
                setTimeout(() => {
                  setAdding(false);
                  setTagInput("");
                }, 150);
              }}
              placeholder="输入新标签…"
              className="rounded-full border border-neutral-300 bg-white px-2 py-0.5 text-[11.5px] outline-none focus:border-blue-400 dark:border-neutral-600 dark:bg-neutral-900"
              maxLength={32}
            />
            {suggestions.length > 0 && (
              <div className="absolute left-0 top-full z-10 mt-1 max-h-44 w-44 overflow-y-auto rounded-md border border-neutral-200 bg-white py-1 shadow-lg dark:border-neutral-700 dark:bg-neutral-900">
                {suggestions.map((s) => (
                  <button
                    key={s.tag}
                    onMouseDown={(e) => {
                      e.preventDefault();
                      commit(s.tag);
                    }}
                    className="flex w-full items-center justify-between px-2 py-1 text-left text-[11.5px] text-neutral-700 hover:bg-blue-50 dark:text-neutral-200 dark:hover:bg-neutral-800"
                  >
                    <span>{s.tag}</span>
                    <span className="text-[10px] text-neutral-400">{s.count}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
