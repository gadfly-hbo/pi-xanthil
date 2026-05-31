import { useEffect, useRef, useState } from "react";
import { ArrowUp, Square, Cpu } from "lucide-react";
import { MessageRow, type UiMessage } from "@/components/MessageRow";
import { cn } from "@/lib/cn";
import type { PiModel } from "@/types";

interface Props {
  messages: UiMessage[];
  running: boolean;
  disabled: boolean;
  model: string;
  models: PiModel[];
  onModelChange: (m: string) => void;
  onSend: (text: string) => void;
}

function ModelSelect({ models, value, onChange }: { models: PiModel[]; value: string; onChange: (v: string) => void }) {
  // Group by provider
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

export function ChatPane(p: Props) {
  const [input, setInput] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);

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
    if (!text || p.running || p.disabled) return;
    p.onSend(text);
    setInput("");
    requestAnimationFrame(autosize);
  }

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      {/* messages */}
      <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-[760px] space-y-5 px-6 py-6">
          {p.messages.length === 0 && !p.disabled && (
            <div className="pt-16 text-center">
              <p className="text-[14px] text-neutral-500 dark:text-neutral-400">
                向 pi 发起一次数据分析对话
              </p>
              <p className="mt-1 text-[12.5px] text-neutral-400 dark:text-neutral-500">
                上传数据 · 描述口径 · 生成报告
              </p>
            </div>
          )}

          {p.messages.map((m) => (
            <MessageRow key={m.id} m={m} />
          ))}

          {p.running && (
            <div className="flex items-center gap-2 text-[13px] text-neutral-500 dark:text-neutral-400">
              <span className="inline-block h-4 w-2 animate-pulse bg-neutral-400 dark:bg-neutral-500" />
              pi 正在运行…
            </div>
          )}
          <div ref={bottomRef} />
        </div>
      </div>

      {/* composer */}
      <div className="shrink-0 px-6 pb-5">
        <div className="mx-auto max-w-[760px]">
          <div className="rounded-2xl border border-neutral-200 bg-white shadow-sm dark:border-neutral-800 dark:bg-neutral-900">
            <textarea
              ref={taRef}
              value={input}
              disabled={p.disabled}
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
              placeholder={p.disabled ? "先选择或新建一个会话" : "输入消息，Enter 发送，Shift+Enter 换行"}
              className="block max-h-[40vh] min-h-[48px] w-full resize-none bg-transparent px-4 pt-3 text-[14px] leading-6 text-neutral-900 placeholder-neutral-400 outline-none disabled:opacity-50 dark:text-neutral-100 dark:placeholder-neutral-500"
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
                disabled={p.running || p.disabled || !input.trim()}
                title="发送"
                className={cn(
                  "inline-flex h-8 w-8 items-center justify-center rounded-full transition-colors",
                  p.running || p.disabled || !input.trim()
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
