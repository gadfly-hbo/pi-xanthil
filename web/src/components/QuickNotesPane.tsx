import { useCallback, useEffect, useRef, useState } from "react";
import { Check, Copy, Download, Trash2, Upload } from "lucide-react";
import { cn } from "@/lib/cn";

/**
 * 随手记 —— 工作日志与备忘，仿 docs/wiki.html「随手记」：
 * 纯前端 localStorage（刷新不丢、不入库、不分发），支持保存 / 勾选合并复制 / 删除 / 导出导入。
 * 与数据安全无关：不读写 draw_data / clean_data，零 LLM。
 */

const NOTES_KEY = "xanthil-quick-notes";

interface Note {
  id: string;
  text: string;
  ts: number;
}

function loadNotes(): Note[] {
  try {
    const raw = JSON.parse(localStorage.getItem(NOTES_KEY) || "[]");
    return Array.isArray(raw) ? (raw as Note[]).filter((n) => n && n.id && typeof n.text === "string") : [];
  } catch {
    return [];
  }
}

function fmtTs(ts: number): string {
  const d = new Date(ts);
  const p = (x: number) => String(x).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function downloadJSON(obj: unknown, fname: string) {
  const blob = new Blob([JSON.stringify(obj, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fname;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export function QuickNotesPane() {
  const [notes, setNotes] = useState<Note[]>(() => loadNotes());
  const [draft, setDraft] = useState("");
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [copiedCount, setCopiedCount] = useState(0);
  const [exported, setExported] = useState(false);
  const textRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    localStorage.setItem(NOTES_KEY, JSON.stringify(notes));
  }, [notes]);

  const add = useCallback(() => {
    const t = draft.trim();
    if (!t) return;
    const note: Note = { id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, text: t, ts: Date.now() };
    setNotes((cur) => [note, ...cur]);
    setDraft("");
    textRef.current?.focus();
  }, [draft]);

  const remove = useCallback((id: string) => {
    setNotes((cur) => cur.filter((n) => n.id !== id));
    setChecked((cur) => {
      const next = new Set(cur);
      next.delete(id);
      return next;
    });
  }, []);

  const toggle = useCallback((id: string) => {
    setChecked((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const allChecked = notes.length > 0 && checked.size === notes.length;
  const toggleAll = useCallback(() => {
    setChecked(allChecked ? new Set() : new Set(notes.map((n) => n.id)));
  }, [allChecked, notes]);

  const copySelected = useCallback(async () => {
    // 未勾选则复制全部（与 wiki 行为一致）。
    const picked = checked.size ? notes.filter((n) => checked.has(n.id)) : notes;
    if (!picked.length) return;
    try {
      await navigator.clipboard.writeText(picked.map((n) => n.text).join("\n\n---\n\n"));
      setCopiedCount(picked.length);
      setTimeout(() => setCopiedCount(0), 1800);
    } catch {
      /* clipboard unavailable */
    }
  }, [checked, notes]);

  const exportNotes = useCallback(() => {
    downloadJSON(
      { app: "pi-xanthil-notes", exportedAt: new Date().toISOString(), notes },
      `px-notes-${new Date().toISOString().slice(0, 10)}.json`,
    );
    setExported(true);
    setTimeout(() => setExported(false), 1600);
  }, [notes]);

  const importNotes = useCallback((file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      let data: { notes?: unknown };
      try {
        data = JSON.parse(String(reader.result));
      } catch {
        alert("导入失败：不是合法的 JSON 文件。");
        return;
      }
      const incoming = Array.isArray(data.notes) ? (data.notes as Note[]) : null;
      if (!incoming) {
        alert("导入失败：文件中未找到 notes（随手记）数据。");
        return;
      }
      setNotes((cur) => {
        const seen = new Set(cur.map((n) => n.id));
        const fresh = incoming.filter((n) => n && n.id && typeof n.text === "string" && !seen.has(n.id));
        alert(`已导入随手记 ${fresh.length} 条（按 id 合并去重，不覆盖现有）。`);
        return [...fresh, ...cur];
      });
    };
    reader.readAsText(file);
  }, []);

  const btn = "inline-flex h-8 items-center gap-1.5 rounded-md border border-neutral-200 bg-white px-3 text-[12px] font-medium text-neutral-700 hover:bg-neutral-100 disabled:opacity-50 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-200 dark:hover:bg-neutral-800";

  return (
    <div className="flex h-full min-h-0 flex-col bg-white dark:bg-neutral-950">
      <div className="mx-auto flex min-h-0 w-full max-w-3xl flex-1 flex-col px-6 py-5">
        <div className="shrink-0">
          <h2 className="text-[15px] font-semibold text-neutral-900 dark:text-neutral-100">随手记</h2>
          <p className="mt-0.5 text-[12.5px] leading-5 text-neutral-500 dark:text-neutral-400">
            工作日志与备忘 —— 存浏览器本地（localStorage），<b className="font-medium">刷新不丢、不入库、不分发</b>。勾选多条可合并复制。
            <kbd className="ml-1 rounded border border-neutral-300 px-1 text-[11px] dark:border-neutral-600">⌘/Ctrl+Enter</kbd> 快速保存。
          </p>
        </div>

        {/* input */}
        <div className="mt-4 shrink-0">
          <textarea
            ref={textRef}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
                e.preventDefault();
                add();
              }
            }}
            placeholder="记点什么…（纯文字）"
            className="min-h-[92px] w-full resize-y rounded-lg border border-neutral-200 bg-neutral-50 px-3 py-2 text-[13px] leading-5 text-neutral-800 outline-none focus:border-neutral-400 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100"
          />
          <div className="mt-2 flex justify-end">
            <button
              onClick={add}
              disabled={!draft.trim()}
              className="inline-flex h-8 min-w-[120px] items-center justify-center rounded-md bg-neutral-900 px-3 text-[12px] font-medium text-white hover:bg-neutral-700 disabled:opacity-50 dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-white"
            >
              ＋ 保存
            </button>
          </div>
        </div>

        {/* bar */}
        <div className="mt-4 flex shrink-0 flex-wrap items-center gap-3">
          <label className="flex cursor-pointer items-center gap-1.5 text-[12.5px] text-neutral-600 dark:text-neutral-300">
            <input type="checkbox" checked={allChecked} onChange={toggleAll} className="cursor-pointer" />
            全选
          </label>
          <button onClick={() => void copySelected()} disabled={notes.length === 0} className={btn}>
            {copiedCount > 0 ? <Check className="h-3.5 w-3.5" strokeWidth={2} /> : <Copy className="h-3.5 w-3.5" strokeWidth={1.75} />}
            {copiedCount > 0 ? `已复制 ${copiedCount} 条` : "复制选中"}
          </button>
          <span className="text-[12px] text-neutral-400 dark:text-neutral-500">{notes.length ? `${notes.length} 条` : ""}</span>
          <div className="ml-auto flex items-center gap-2">
            <button onClick={exportNotes} disabled={notes.length === 0} title="导出为 JSON 备份" className={btn}>
              <Download className="h-3.5 w-3.5" strokeWidth={1.75} />
              {exported ? "已导出" : "导出"}
            </button>
            <button onClick={() => fileRef.current?.click()} title="从 JSON 备份恢复（按 id 合并去重）" className={btn}>
              <Upload className="h-3.5 w-3.5" strokeWidth={1.75} />
              导入
            </button>
            <input
              ref={fileRef}
              type="file"
              accept="application/json,.json"
              hidden
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) importNotes(f);
                e.target.value = "";
              }}
            />
          </div>
        </div>

        {/* list */}
        <div className="scrollbar-thin mt-3 min-h-0 flex-1 space-y-2 overflow-y-auto pb-2">
          {notes.length === 0 ? (
            <p className="px-1 py-6 text-center text-[12.5px] text-neutral-400 dark:text-neutral-500">还没有随手记 —— 在上面记一条吧。</p>
          ) : (
            notes.map((n) => (
              <div
                key={n.id}
                className={cn(
                  "flex items-start gap-2.5 rounded-lg border px-3 py-2.5",
                  checked.has(n.id)
                    ? "border-neutral-300 bg-neutral-50 dark:border-neutral-600 dark:bg-neutral-900"
                    : "border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-950",
                )}
              >
                <input
                  type="checkbox"
                  checked={checked.has(n.id)}
                  onChange={() => toggle(n.id)}
                  className="mt-1 cursor-pointer"
                />
                <div className="min-w-0 flex-1">
                  <div className="whitespace-pre-wrap break-words text-[13px] leading-5 text-neutral-800 dark:text-neutral-200">{n.text}</div>
                  <div className="mt-1.5 text-[11px] text-neutral-400 dark:text-neutral-500">{fmtTs(n.ts)}</div>
                </div>
                <button
                  onClick={() => remove(n.id)}
                  title="删除"
                  className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded text-neutral-400 hover:bg-neutral-100 hover:text-rose-500 dark:hover:bg-neutral-800"
                >
                  <Trash2 className="h-3.5 w-3.5" strokeWidth={1.75} />
                </button>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
