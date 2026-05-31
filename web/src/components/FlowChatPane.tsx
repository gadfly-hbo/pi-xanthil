import { useEffect, useRef, useState } from "react";
import { ArrowUp, Cpu, FolderUp, Info, RefreshCw, Square } from "lucide-react";
import { MessageRow, type UiMessage } from "@/components/MessageRow";
import { cn } from "@/lib/cn";
import type { Flow, PiModel } from "@/types";

interface Props {
  flow: Flow;
  messages: UiMessage[];
  running: boolean;
  model: string;
  models: PiModel[];
  importing: boolean;
  importHint: string | null;
  onModelChange: (m: string) => void;
  onSend: (text: string) => void;
  onImport: (files: FileList) => void;
  onApplyToEditor: () => void;
}

// Augment HTMLInputElement props with the (non-standard but widely supported)
// `webkitdirectory` attribute so we can pick a whole folder in the browser.
declare module "react" {
  interface InputHTMLAttributes<T> {
    webkitdirectory?: string;
    directory?: string;
  }
}

function ModelSelect({ models, value, onChange }: { models: PiModel[]; value: string; onChange: (v: string) => void }) {
  const groups = models.reduce<Record<string, PiModel[]>>((acc, m) => {
    (acc[m.provider] ??= []).push(m);
    return acc;
  }, {});
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="rounded-md bg-transparent px-1 py-0.5 text-[12px] outline-none focus:bg-neutral-100 dark:focus:bg-neutral-800"
    >
      {Object.entries(groups).map(([provider, items]) => (
        <optgroup key={provider} label={provider}>
          {items.map((m) => (
            <option key={m.id} value={m.id}>
              {m.model}
            </option>
          ))}
        </optgroup>
      ))}
    </select>
  );
}

export function FlowChatPane(p: Props) {
  const [input, setInput] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [p.messages, p.running]);

  function autosize() {
    const ta = taRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = `${Math.min(ta.scrollHeight, window.innerHeight * 0.4)}px`;
  }

  function submit() {
    const text = input.trim();
    if (!text || p.running) return;
    p.onSend(text);
    setInput("");
    requestAnimationFrame(autosize);
  }

  function pickFolder() {
    fileRef.current?.click();
  }

  return (
    <div className="flex min-w-0 flex-1 flex-col">
      {/* persistent banner clarifying the purpose of this chat surface */}
      <div className="flex shrink-0 items-center gap-2 border-b border-amber-200/60 bg-amber-50 px-4 py-1.5 text-[11.5px] text-amber-700 dark:border-amber-900/40 dark:bg-amber-950/30 dark:text-amber-300">
        <Info className="h-3.5 w-3.5 shrink-0" strokeWidth={1.75} />
        <span>本界面仅用于工作流开发与改造，日常对话请切到顶部「对话」标签。</span>
      </div>

      {/* flow toolbar */}
      <div className="flex h-11 shrink-0 items-center gap-2 border-b border-neutral-200 px-4 dark:border-neutral-800">
        <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-neutral-900 dark:text-neutral-100">
          {p.flow.name}
          {p.flow.sourceName && (
            <span className="ml-2 text-[11px] font-normal text-neutral-400">源：{p.flow.sourceName}</span>
          )}
        </span>
        <button
          onClick={pickFolder}
          disabled={p.importing}
          className={cn(
            "inline-flex h-7 items-center gap-1 rounded-md border border-neutral-300 bg-white px-2 text-[12px] text-neutral-700 hover:bg-neutral-100 disabled:opacity-50 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-200 dark:hover:bg-neutral-800",
          )}
          title="选择本地 agent 工作流文件夹"
        >
          {p.importing ? <RefreshCw className="h-3.5 w-3.5 animate-spin" strokeWidth={1.75} /> : <FolderUp className="h-3.5 w-3.5" strokeWidth={1.75} />}
          导入文件夹
        </button>
        <button
          onClick={p.onApplyToEditor}
          className="inline-flex h-7 items-center rounded-md bg-neutral-900 px-2 text-[12px] text-white hover:bg-neutral-700 dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-white"
          title="切到工作流编辑面板查看 / 调整"
        >
          应用到编辑器
        </button>
        <input
          ref={fileRef}
          type="file"
          webkitdirectory=""
          directory=""
          multiple
          hidden
          onChange={(e) => {
            const f = e.target.files;
            if (f && f.length > 0) p.onImport(f);
            // reset so picking the same folder again still fires onChange
            e.target.value = "";
          }}
        />
      </div>

      {p.importHint && (
        <div className="border-b border-neutral-200 bg-neutral-50 px-4 py-1.5 text-[11.5px] text-neutral-600 dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-400">
          {p.importHint}
        </div>
      )}

      {/* messages */}
      <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-[760px] space-y-5 px-6 py-6">
          {p.messages.length === 0 && (
            <div className="pt-16 text-center">
              <p className="text-[14px] text-neutral-500 dark:text-neutral-400">
                导入本地 agent 工作流文件夹，pi 会分析并改造为可直接调用的 pi cli 工作流
              </p>
              <p className="mt-1 text-[12.5px] text-neutral-400 dark:text-neutral-500">
                若 pi 无法识别原格式，会主动提问，直至理解
              </p>
            </div>
          )}

          {p.messages.map((m) => (
            <MessageRow key={m.id} m={m} />
          ))}

          {p.running && (
            <div className="flex items-center gap-2 text-[13px] text-neutral-500 dark:text-neutral-400">
              <span className="inline-block h-4 w-2 animate-pulse bg-neutral-400 dark:bg-neutral-500" />
              pi 正在分析工作流…
            </div>
          )}
          <div ref={bottomRef} />
        </div>
      </div>

      {/* composer */}
      <div className="px-6 pb-5">
        <div className="mx-auto max-w-[760px]">
          <div className="rounded-2xl border border-neutral-200 bg-white shadow-sm dark:border-neutral-800 dark:bg-neutral-900">
            <textarea
              ref={taRef}
              value={input}
              onChange={(e) => {
                setInput(e.target.value);
                autosize();
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  submit();
                }
              }}
              rows={1}
              placeholder="描述工作流意图、补充上下文、或回答 pi 的提问…"
              className="block max-h-[40vh] min-h-[48px] w-full resize-none bg-transparent px-4 pt-3 text-[14px] leading-6 text-neutral-900 placeholder-neutral-400 outline-none dark:text-neutral-100 dark:placeholder-neutral-500"
            />
            <div className="flex items-center justify-between px-3 pb-2.5 pt-1">
              <label className="flex items-center gap-1.5 text-[12px] text-neutral-500 dark:text-neutral-400">
                <Cpu className="h-3.5 w-3.5" strokeWidth={1.75} />
                {p.models.length > 0 ? (
                  <ModelSelect models={p.models} value={p.model} onChange={p.onModelChange} />
                ) : (
                  <input
                    value={p.model}
                    onChange={(e) => p.onModelChange(e.target.value)}
                    placeholder="加载中…"
                    className="w-44 rounded-md bg-transparent px-1 py-0.5 outline-none placeholder-neutral-400 focus:bg-neutral-100 dark:placeholder-neutral-600 dark:focus:bg-neutral-800"
                  />
                )}
              </label>
              <button
                onClick={submit}
                disabled={p.running || !input.trim()}
                title="发送"
                className={cn(
                  "inline-flex h-8 w-8 items-center justify-center rounded-full transition-colors",
                  p.running || !input.trim()
                    ? "bg-neutral-200 text-neutral-400 dark:bg-neutral-800 dark:text-neutral-600"
                    : "bg-neutral-900 text-white hover:bg-neutral-700 dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-white",
                )}
              >
                {p.running ? (
                  <Square className="h-3.5 w-3.5" strokeWidth={2.5} fill="currentColor" />
                ) : (
                  <ArrowUp className="h-4 w-4" strokeWidth={2} />
                )}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
