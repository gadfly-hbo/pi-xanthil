import { useEffect, useRef, useState } from "react";
import { ArrowUp, Bot, ChevronDown, ChevronRight, Cpu, FileText, Gauge, GitBranch, Loader2, RefreshCw, Sparkles, Square, Workflow, Wrench } from "lucide-react";
import { DelegateSubAgentCard } from "@/components/DelegateSubAgentCard";
import { ForkBranchPanel } from "@/components/ForkBranchPanel";
import { ManualAnalysisToolCard } from "@/components/ManualAnalysisToolCard";
import { hasToolBlocks, hasTraceBlocks, MessageRow, type UiMessage } from "@/components/MessageRow";
import { SkillSelector } from "@/components/SkillSelector";
import { useBusinessRequirementContexts } from "@/components/useBusinessRequirementContexts";
import { cn } from "@/lib/cn";
import { textOf, type PiModel, type SessionRuntime } from "@/types";

type FolderScope =
  | { type: "workspace"; workspaceId: string }
  | { type: "session"; sessionId: string }
  | { type: "flow"; flowId: string };

interface Props {
  messages: UiMessage[];
  running: boolean;
  disabled: boolean;
  workspaceId: string | null;
  folderScope: FolderScope | null;
  model: string;
  models: PiModel[];
  onModelChange: (m: string) => void;
  onSend: (text: string, skillPaths?: string[], businessRequirementContext?: { pathId: number; markdownPath: string; jsonPath?: string }) => void;
  onStop: () => void;
  runtime: SessionRuntime | null;
  compacting: boolean;
  runtimeNotice: string;
  onCompact: () => void;
  onRefreshRuntime: () => void;
  canPromoteToWorkflow: boolean;
  onPromoteToWorkflow: () => void;
  canDistillSkill: boolean;
  onDistillSkill: () => void;
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
  const [selectedSkillPaths, setSelectedSkillPaths] = useState<string[]>([]);
  const [activeAssistPanel, setActiveAssistPanel] = useState<"fork" | "delegate" | "tool" | null>(null);
  const {
    contexts: businessRequirementContexts,
    selectedId: selectedBusinessRequirementId,
    setSelectedId: setSelectedBusinessRequirementId,
    selectedContext: selectedBusinessRequirement,
  } = useBusinessRequirementContexts(p.folderScope);
  const [showTrace, setShowTrace] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const activeSessionId = p.folderScope?.type === "session" ? p.folderScope.sessionId : "";
  const canUseSessionTools = Boolean(activeSessionId) && !p.disabled;

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [p.messages, p.running]);

  useEffect(() => {
    if (!canUseSessionTools) setActiveAssistPanel(null);
  }, [canUseSessionTools]);

  function autosize() {
    const ta = taRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = `${Math.min(ta.scrollHeight, window.innerHeight * 0.4)}px`;
  }

  function submit() {
    const text = input.trim();
    if (!text || p.running || p.disabled) return;
    p.onSend(
      text,
      selectedSkillPaths.length > 0 ? selectedSkillPaths : undefined,
      selectedBusinessRequirement ? {
        pathId: selectedBusinessRequirement.pathId,
        markdownPath: selectedBusinessRequirement.markdownPath,
        jsonPath: selectedBusinessRequirement.jsonPath,
      } : undefined,
    );
    setInput("");
    requestAnimationFrame(autosize);
  }

  const businessMessages = p.messages.filter((message) => {
    if (message.error || message.role === "user") return true;
    if (hasToolBlocks(message)) return true;
    return message.role === "assistant"
      && textOf(message.content).trim().length > 0
      && !hasTraceBlocks(message);
  });
  const hiddenCount = p.messages.length - businessMessages.length;
  const visibleMessages = showTrace ? p.messages : businessMessages;
  const contextPercent = p.runtime?.contextPercent;
  const contextTone = p.runtime?.status === "error"
    ? "text-rose-600 dark:text-rose-400"
    : contextPercent == null
      ? "text-neutral-500 dark:text-neutral-400"
      : contextPercent > 80
      ? "text-rose-600 dark:text-rose-400"
      : contextPercent >= 60
        ? "text-amber-600 dark:text-amber-400"
        : "text-emerald-600 dark:text-emerald-400";
  const contextLabel = p.runtime?.status === "error"
    ? "上下文维护失败"
    : contextPercent == null
      ? "上下文待刷新"
      : `上下文 ${contextPercent.toFixed(0)}%`;

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <div className="flex h-10 shrink-0 items-center gap-2 border-b border-neutral-200 px-4 dark:border-neutral-800">
        <div className={`flex items-center gap-1.5 text-[11.5px] ${contextTone}`} title={p.runtime?.lastError ?? "当前会话上下文占用，不是累计 token 消耗"}>
          <Gauge className="h-3.5 w-3.5" strokeWidth={1.75} />
          <span>{contextLabel}</span>
          {p.runtime?.compactCount ? <span className="text-neutral-400">· 已整理 {p.runtime.compactCount} 次</span> : null}
        </div>
        <button
          onClick={p.onRefreshRuntime}
          disabled={p.running || p.compacting}
          title="重新检测上下文占用"
          className="inline-flex h-7 w-7 items-center justify-center rounded-md text-neutral-500 hover:bg-neutral-100 disabled:cursor-not-allowed disabled:opacity-40 dark:text-neutral-400 dark:hover:bg-neutral-800"
        >
          <RefreshCw className="h-3.5 w-3.5" strokeWidth={1.75} />
        </button>
        <button
          onClick={p.onCompact}
          disabled={p.running || p.compacting || p.messages.length === 0}
          title={p.running ? "当前任务结束后可整理上下文" : "压缩历史上下文并保留关键结论、路径和待办"}
          className="inline-flex h-7 items-center gap-1 rounded-md px-2 text-[11.5px] text-neutral-500 hover:bg-neutral-100 disabled:cursor-not-allowed disabled:opacity-40 dark:text-neutral-400 dark:hover:bg-neutral-800"
        >
          {p.compacting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Gauge className="h-3.5 w-3.5" strokeWidth={1.75} />}
          {p.compacting ? "正在整理" : "整理上下文"}
        </button>
        {p.runtimeNotice && <span className="truncate text-[11px] text-neutral-400" title={p.runtimeNotice}>{p.runtimeNotice}</span>}
        <button
          onClick={p.onPromoteToWorkflow}
          disabled={!p.canPromoteToWorkflow}
          title={p.canPromoteToWorkflow ? "将已完成任务沉淀为可复用工作流" : "任务完成后可沉淀为工作流"}
          className="ml-auto inline-flex h-7 items-center gap-1.5 rounded-md border border-neutral-200 px-2.5 text-[12px] text-neutral-600 transition-colors hover:bg-neutral-100 disabled:cursor-not-allowed disabled:opacity-40 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800"
        >
          <Workflow className="h-3.5 w-3.5" strokeWidth={1.75} />
          沉淀为工作流
        </button>
        <button
          onClick={p.onDistillSkill}
          disabled={!p.canDistillSkill}
          title={p.canDistillSkill ? "将本次任务提炼为可复用 Skill（SKILL.md）" : "任务完成后可提炼 Skill"}
          className="inline-flex h-7 items-center gap-1.5 rounded-md border border-neutral-200 px-2.5 text-[12px] text-neutral-600 transition-colors hover:bg-neutral-100 disabled:cursor-not-allowed disabled:opacity-40 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800"
        >
          <Sparkles className="h-3.5 w-3.5" strokeWidth={1.75} />
          沉淀 skill
        </button>
      </div>

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

          {visibleMessages.map((m) => (
            <MessageRow key={m.id} m={m} showTrace={showTrace} />
          ))}

          {p.running && (
            <div className="flex items-center gap-2 text-[13px] text-neutral-500 dark:text-neutral-400">
              <span className="inline-block h-4 w-2 animate-pulse bg-neutral-400 dark:bg-neutral-500" />
              pi 正在运行…
            </div>
          )}
          {hiddenCount > 0 && (
            <button
              onClick={() => setShowTrace((current) => !current)}
              className="inline-flex items-center gap-1 text-[12px] text-neutral-400 hover:text-neutral-700 dark:text-neutral-500 dark:hover:text-neutral-200"
            >
              {showTrace ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
              {showTrace ? "收起执行详情" : `查看执行详情（${hiddenCount} 条）`}
            </button>
          )}
          <div ref={bottomRef} />
        </div>
      </div>

      {/* composer */}
      <div className="shrink-0 px-6 pb-5">
        <div className="mx-auto max-w-[760px]">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <button
              onClick={() => setActiveAssistPanel((current) => current === "tool" ? null : "tool")}
              disabled={!canUseSessionTools}
              className={cn(
                "inline-flex h-8 items-center gap-1.5 rounded-md border px-2.5 text-[12px] transition-colors disabled:cursor-not-allowed disabled:opacity-40",
                activeAssistPanel === "tool"
                  ? "border-neutral-900 bg-neutral-900 text-white dark:border-neutral-100 dark:bg-neutral-100 dark:text-neutral-900"
                  : "border-neutral-200 text-neutral-600 hover:bg-neutral-100 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800",
              )}
              title={canUseSessionTools ? "手动运行 analysis 工具并回流结果" : "先选择或新建一个会话"}
            >
              <Wrench className="h-3.5 w-3.5" strokeWidth={1.75} />
              @工具
            </button>
            <button
              onClick={() => setActiveAssistPanel((current) => current === "fork" ? null : "fork")}
              disabled={!canUseSessionTools}
              className={cn(
                "inline-flex h-8 items-center gap-1.5 rounded-md border px-2.5 text-[12px] transition-colors disabled:cursor-not-allowed disabled:opacity-40",
                activeAssistPanel === "fork"
                  ? "border-neutral-900 bg-neutral-900 text-white dark:border-neutral-100 dark:bg-neutral-100 dark:text-neutral-900"
                  : "border-neutral-200 text-neutral-600 hover:bg-neutral-100 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800",
              )}
              title={canUseSessionTools ? "创建或打开隔离分支对话" : "先选择或新建一个会话"}
            >
              <GitBranch className="h-3.5 w-3.5" strokeWidth={1.75} />
              Fork 分支
            </button>
            <button
              onClick={() => setActiveAssistPanel((current) => current === "delegate" ? null : "delegate")}
              disabled={!canUseSessionTools}
              className={cn(
                "inline-flex h-8 items-center gap-1.5 rounded-md border px-2.5 text-[12px] transition-colors disabled:cursor-not-allowed disabled:opacity-40",
                activeAssistPanel === "delegate"
                  ? "border-neutral-900 bg-neutral-900 text-white dark:border-neutral-100 dark:bg-neutral-100 dark:text-neutral-900"
                  : "border-neutral-200 text-neutral-600 hover:bg-neutral-100 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800",
              )}
              title={canUseSessionTools ? "委派一个后台子 agent" : "先选择或新建一个会话"}
            >
              <Bot className="h-3.5 w-3.5" strokeWidth={1.75} />
              委派子 agent
            </button>
          </div>

          {activeSessionId && activeAssistPanel === "fork" && (
            <div className="mb-3">
              <ForkBranchPanel
                parentSessionId={activeSessionId}
                model={p.model}
                onBackflow={(text) => p.onSend(text)}
              />
            </div>
          )}
          {activeSessionId && activeAssistPanel === "tool" && (
            <div className="mb-3">
              <ManualAnalysisToolCard
                sessionId={activeSessionId}
                workspaceId={p.workspaceId}
                onBackflow={(text) => p.onSend(text)}
              />
            </div>
          )}
          {activeSessionId && activeAssistPanel === "delegate" && (
            <div className="mb-3">
              <DelegateSubAgentCard
                sessionId={activeSessionId}
                workspaceId={p.workspaceId}
                model={p.model}
                models={p.models}
                onBackflow={(text) => p.onSend(text)}
              />
            </div>
          )}

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
                if (e.key === "Enter" && e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  submit();
                }
              }}
              rows={1}
              placeholder={p.disabled ? "先选择或新建一个会话" : "输入消息，Shift+Enter 发送，Enter 换行"}
              className="block max-h-[40vh] min-h-[48px] w-full resize-none bg-transparent px-4 pt-3 text-[14px] leading-6 text-neutral-900 placeholder-neutral-400 outline-none disabled:opacity-50 dark:text-neutral-100 dark:placeholder-neutral-500"
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
                  scope={p.workspaceId ? { type: "workspace", workspaceId: p.workspaceId } : null}
                  selectedPaths={selectedSkillPaths}
                  onChange={setSelectedSkillPaths}
                />
                {businessRequirementContexts.length > 0 && (
                  <label className="flex min-w-0 items-center gap-1.5 text-[12px] text-neutral-500 dark:text-neutral-400">
                    <FileText className="h-3.5 w-3.5 shrink-0" strokeWidth={1.75} />
                    <select
                      value={selectedBusinessRequirementId}
                      onChange={(event) => setSelectedBusinessRequirementId(event.target.value)}
                      title="将业务需求作为本轮分析上下文"
                      className="max-w-[260px] rounded-md bg-transparent px-1 py-0.5 text-[12px] outline-none focus:bg-neutral-100 dark:focus:bg-neutral-800"
                    >
                      <option value="">业务需求</option>
                      {businessRequirementContexts.map((item) => (
                        <option key={item.id} value={item.id}>{item.label}</option>
                      ))}
                    </select>
                  </label>
                )}
              </div>
              <button
                onClick={p.running ? p.onStop : submit}
                disabled={p.disabled || (!p.running && !input.trim())}
                title={p.running ? "停止生成" : "发送（Shift+Enter）"}
                className={cn(
                  "inline-flex h-8 w-8 items-center justify-center rounded-full transition-colors",
                  p.disabled || (!p.running && !input.trim())
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
