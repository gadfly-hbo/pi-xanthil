import { useEffect, useRef, useState } from "react";
import { ArrowUp, Cpu, FolderUp, RefreshCw, Square } from "lucide-react";
import { MessageRow, type UiMessage } from "@/components/MessageRow";
import { SkillSelector } from "@/components/SkillSelector";
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
  onSend: (text: string, skillPaths?: string[]) => void;
  onStop: () => void;
  onImport: (files: FileList) => void;
  onApplyToEditor: () => void;
  onQuickSelect?: (text: string, skillPaths?: string[]) => void;
}

declare module "react" {
  interface InputHTMLAttributes<T> {
    webkitdirectory?: string;
    directory?: string;
  }
}

const QUICK_PROMPTS = [
  {
    label: "数据分析工作流",
    desc: "读取 CSV / Excel，执行统计分析并输出报告",
    text: "帮我设计一个数据分析智能体工作流：读取 CSV 文件，进行数据清洗、统计分析和可视化，最终生成 Markdown 报告。",
  },
  {
    label: "内容创作工作流",
    desc: "从调研到成稿的完整写作流程",
    text: "构建一个内容创作智能体：先调研主题，制定写作大纲，撰写初稿，最后润色输出最终文章。",
  },
  {
    label: "代码审查工作流",
    desc: "分析代码质量、安全与可维护性",
    text: "设计一个代码审查工作流：读取代码文件，分析代码质量、安全漏洞、可维护性问题，输出结构化审查报告。",
  },
  {
    label: "自定义工作流",
    desc: "从零描述你的需求",
    text: "",
  },
];

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
            <option key={m.id} value={m.id}>{m.model}</option>
          ))}
        </optgroup>
      ))}
    </select>
  );
}

export function FlowChatPane(p: Props) {
  const [input, setInput] = useState("");
  const [selectedSkillPaths, setSelectedSkillPaths] = useState<string[]>([]);
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
    p.onSend(text, selectedSkillPaths.length > 0 ? selectedSkillPaths : undefined);
    setInput("");
    requestAnimationFrame(autosize);
  }

  function handleQuick(text: string) {
    if (!text) { taRef.current?.focus(); return; }
    if (p.onQuickSelect) { p.onQuickSelect(text, selectedSkillPaths.length > 0 ? selectedSkillPaths : undefined); }
    else { setInput(text); taRef.current?.focus(); }
  }

  return (
    <div className="flex min-w-0 flex-1 flex-col">
      {/* toolbar — simplified: only flow name + switch button */}
      <div className="flex h-11 shrink-0 items-center gap-2 border-b border-neutral-200 px-4 dark:border-neutral-800">
        <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-neutral-900 dark:text-neutral-100">
          {p.flow.name}
          {p.flow.sourceName && (
            <span className="ml-2 text-[11px] font-normal text-neutral-400">源：{p.flow.sourceName}</span>
          )}
        </span>
        <button
          onClick={p.onApplyToEditor}
          className="inline-flex h-7 items-center rounded-md bg-neutral-900 px-2 text-[12px] text-white hover:bg-neutral-700 dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-white"
        >
          切换到执行
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
            e.target.value = "";
          }}
        />
      </div>

      {/* import progress hint — shown once files are sent and pi starts responding */}
      {p.importHint && p.messages.length > 0 && (
        <div className="border-b border-neutral-200 bg-neutral-50 px-4 py-1.5 text-[11.5px] text-neutral-600 dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-400">
          {p.importHint}
        </div>
      )}

      {/* messages */}
      <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-[720px] space-y-5 px-6 py-6">

          {p.messages.length === 0 && (
            <div className="flex flex-col items-center pt-10">
              <h3 className="text-[15px] font-semibold text-neutral-800 dark:text-neutral-100">
                描述你想创建的智能体
              </h3>
              <p className="mt-1 text-[12.5px] text-neutral-400 dark:text-neutral-500">
                pi 会引导你完成工作流设计，并自动生成可执行的 workflow.json
              </p>

              {/* quick prompt cards */}
              <div className="mt-6 grid w-full max-w-sm grid-cols-1 gap-2">
                {QUICK_PROMPTS.map((q) => (
                  <button
                    key={q.label}
                    onClick={() => handleQuick(q.text)}
                    className="flex flex-col items-start rounded-xl border border-neutral-200 bg-neutral-50 px-4 py-3 text-left transition-colors hover:border-neutral-300 hover:bg-neutral-100 dark:border-neutral-700 dark:bg-neutral-800/50 dark:hover:border-neutral-600 dark:hover:bg-neutral-800"
                  >
                    <span className="text-[12.5px] font-medium text-neutral-900 dark:text-neutral-100">
                      {q.label}
                    </span>
                    <span className="mt-0.5 text-[11px] text-neutral-400 dark:text-neutral-500">
                      {q.desc}
                    </span>
                  </button>
                ))}
              </div>

              {/* separator */}
              <div className="mt-5 flex w-full max-w-sm items-center gap-3">
                <div className="h-px flex-1 bg-neutral-200 dark:bg-neutral-700" />
                <span className="text-[11px] text-neutral-400 dark:text-neutral-500">或者</span>
                <div className="h-px flex-1 bg-neutral-200 dark:bg-neutral-700" />
              </div>

              {/* import existing workflow folder */}
              <button
                onClick={() => fileRef.current?.click()}
                disabled={p.importing}
                className="mt-3 flex w-full max-w-sm items-center gap-3 rounded-xl border border-dashed border-neutral-300 px-4 py-3.5 text-left transition-colors hover:border-neutral-400 hover:bg-neutral-50 disabled:opacity-50 dark:border-neutral-600 dark:hover:border-neutral-500 dark:hover:bg-neutral-800/50"
              >
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-neutral-100 dark:bg-neutral-800">
                  {p.importing
                    ? <RefreshCw className="h-4 w-4 animate-spin text-neutral-500" strokeWidth={1.75} />
                    : <FolderUp className="h-4 w-4 text-neutral-500" strokeWidth={1.75} />
                  }
                </div>
                <div>
                  <div className="text-[12.5px] font-medium text-neutral-800 dark:text-neutral-200">
                    {p.importing ? "正在上传…" : "导入已有工作流文件夹"}
                  </div>
                  <div className="mt-0.5 text-[11px] text-neutral-400 dark:text-neutral-500">
                    {p.importHint ?? "上传后 pi 自动识别并转换为标准格式"}
                  </div>
                </div>
              </button>
            </div>
          )}

          {p.messages.map((m) => <MessageRow key={m.id} m={m} />)}

          {p.running && (
            <div className="flex items-center gap-2 text-[13px] text-neutral-500 dark:text-neutral-400">
              <span className="inline-block h-4 w-2 animate-pulse bg-neutral-400 dark:bg-neutral-500" />
              pi 正在设计工作流…
            </div>
          )}
          <div ref={bottomRef} />
        </div>
      </div>

      {/* composer */}
      <div className="px-6 pb-5">
        <div className="mx-auto max-w-[720px]">
          <div className="rounded-2xl border border-neutral-200 bg-white shadow-sm dark:border-neutral-800 dark:bg-neutral-900">
            <textarea
              ref={taRef}
              value={input}
              onChange={(e) => { setInput(e.target.value); autosize(); }}
              onKeyDown={(e) => {
                if (e.key === "Enter" && e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); submit(); }
              }}
              rows={1}
              placeholder="描述你想要创建的智能体，或回答 pi 的提问。Shift+Enter 发送，Enter 换行"
              className="block max-h-[40vh] min-h-[48px] w-full resize-none bg-transparent px-4 pt-3 text-[14px] leading-6 text-neutral-900 placeholder-neutral-400 outline-none dark:text-neutral-100 dark:placeholder-neutral-500"
            />
            <div className="flex items-center justify-between px-3 pb-2.5 pt-1">
              <div className="flex items-center gap-1">
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
                <SkillSelector
                  scope={{ type: "flow", flowId: p.flow.id }}
                  selectedPaths={selectedSkillPaths}
                  onChange={setSelectedSkillPaths}
                />
              </div>
              <button
                onClick={p.running ? p.onStop : submit}
                disabled={!p.running && !input.trim()}
                title={p.running ? "停止生成" : "发送（Shift+Enter）"}
                className={cn(
                  "inline-flex h-8 w-8 items-center justify-center rounded-full transition-colors",
                  !p.running && !input.trim()
                    ? "bg-neutral-200 text-neutral-400 dark:bg-neutral-800 dark:text-neutral-600"
                    : "bg-neutral-900 text-white hover:bg-neutral-700 dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-white",
                )}
              >
                {p.running
                  ? <Square className="h-3.5 w-3.5" strokeWidth={2.5} fill="currentColor" />
                  : <ArrowUp className="h-4 w-4" strokeWidth={2} />
                }
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
