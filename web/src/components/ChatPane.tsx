import { useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from "react";
import { ArrowUp, Bot, ChevronDown, ChevronRight, Cpu, FileText, Gauge, GitBranch, Loader2, RefreshCw, Square, Wrench, X } from "lucide-react";
import { DelegateSubAgentCard } from "@/components/DelegateSubAgentCard";
import { ForkBranchPanel } from "@/components/ForkBranchPanel";
import { ManualAnalysisToolCard } from "@/components/ManualAnalysisToolCard";
import { MemoryFeedbackInline } from "@/components/MemoryFeedbackInline";
import { hasToolBlocks, hasTraceBlocks, MessageRow, type UiMessage } from "@/components/MessageRow";
import { SkillSelector } from "@/components/SkillSelector";
import { useBusinessRequirementContexts } from "@/components/useBusinessRequirementContexts";
import { api } from "@/lib/api";
import { cn } from "@/lib/cn";
import { textOf, type PiModel, type SessionRuntime, type WorkspacePath, type XanCommand, type XanCommandParam } from "@/types";

type FolderScope =
  | { type: "workspace"; workspaceId: string }
  | { type: "session"; sessionId: string }
  | { type: "flow"; flowId: string };

const DRAWER_MIN = 360;
const DRAWER_DEFAULT = 460;
const DRAWER_WIDTH_KEY = "chatpane.assistDrawerWidth";
const COMMAND_QUERY_RE = /^\/([^\s/]*)$/;

interface Props {
  messages: UiMessage[];
  running: boolean;
  disabled: boolean;
  workspaceId: string | null;
  folderScope: FolderScope | null;
  /** 显式会话 id：folderScope 为 flow scope（如专题对话）时，session 工具(@工具/Fork/委派)用它识别活跃 session。日常场景不传，从 folderScope 的 session scope 推断。 */
  sessionId?: string;
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

function clampDrawerWidth(width: number, containerWidth: number): number {
  const max = Math.max(DRAWER_MIN, containerWidth * 0.6);
  return Math.min(Math.max(width, DRAWER_MIN), max);
}

function commandHasParams(command: XanCommand): boolean {
  return Array.isArray(command.params) && command.params.length > 0;
}

function commandQuery(input: string): string | null {
  const match = COMMAND_QUERY_RE.exec(input);
  return match ? match[1] ?? "" : null;
}

function quoteCommandValue(value: string): string {
  const needsQuote = /\s|["'\\]/.test(value);
  if (!needsQuote) return value;
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

function encodeCommandLine(command: XanCommand, values: Record<string, string>): string {
  const parts = [`/${command.name}`];
  for (const param of command.params ?? []) {
    const raw = values[param.key]?.trim() ?? "";
    if (!raw) continue;
    parts.push(`--${param.key}=${quoteCommandValue(raw)}`);
  }
  return parts.join(" ");
}

function cleanDataLabel(path: WorkspacePath): string {
  return path.path.split(/[\\/]/).filter(Boolean).at(-1) ?? path.path;
}

interface CommandParamDialogProps {
  command: XanCommand;
  values: Record<string, string>;
  cleanDataFiles: WorkspacePath[];
  cleanDataLoading: boolean;
  error: string;
  running: boolean;
  disabled: boolean;
  onChange: (key: string, value: string) => void;
  onCancel: () => void;
  onSubmit: () => void;
}

function CommandParamDialog({
  command,
  values,
  cleanDataFiles,
  cleanDataLoading,
  error,
  running,
  disabled,
  onChange,
  onCancel,
  onSubmit,
}: CommandParamDialogProps) {
  function renderParam(param: XanCommandParam) {
    const value = values[param.key] ?? "";
    const baseClass = "mt-1 w-full rounded-md border border-neutral-200 bg-white px-2 py-1.5 text-[12px] outline-none focus:border-neutral-400 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100";

    if (param.type === "select") {
      return (
        <select
          value={value}
          onChange={(event) => onChange(param.key, event.target.value)}
          className={baseClass}
        >
          <option value="">请选择</option>
          {(param.options ?? []).map((option) => (
            <option key={option} value={option}>{option}</option>
          ))}
        </select>
      );
    }

    if (param.type === "file" && param.source === "clean_data") {
      return (
        <select
          value={value}
          onChange={(event) => onChange(param.key, event.target.value)}
          disabled={cleanDataLoading}
          className={baseClass}
        >
          <option value="">{cleanDataLoading ? "加载 clean_data…" : "选择 clean_data 文件"}</option>
          {cleanDataFiles.map((path) => (
            <option key={path.id} value={path.path}>{cleanDataLabel(path)}</option>
          ))}
        </select>
      );
    }

    return (
      <input
        value={value}
        onChange={(event) => onChange(param.key, event.target.value)}
        className={baseClass}
      />
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/35 px-4">
      <div className="w-full max-w-[520px] rounded-lg border border-neutral-200 bg-white shadow-xl dark:border-neutral-800 dark:bg-neutral-950">
        <div className="flex items-start gap-3 border-b border-neutral-200 px-4 py-3 dark:border-neutral-800">
          <div className="min-w-0 flex-1">
            <div className="font-mono text-[13px] font-medium text-neutral-900 dark:text-neutral-100">/{command.name}</div>
            {(command.argumentHint || command.description) && (
              <div className="mt-1 text-[12px] text-neutral-500 dark:text-neutral-400">
                {command.argumentHint && <span className="font-mono">{command.argumentHint}</span>}
                {command.argumentHint && command.description ? " · " : ""}
                {command.description}
              </div>
            )}
          </div>
          <button
            type="button"
            onClick={onCancel}
            className="inline-flex h-7 w-7 items-center justify-center rounded-md text-neutral-500 hover:bg-neutral-100 dark:text-neutral-400 dark:hover:bg-neutral-800"
            title="关闭"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>

        <form
          onSubmit={(event) => {
            event.preventDefault();
            onSubmit();
          }}
          className="space-y-3 px-4 py-4"
        >
          {(command.params ?? []).map((param) => (
            <label key={param.key} className="block text-[12px] text-neutral-600 dark:text-neutral-300">
              <span className="flex items-center gap-1">
                {param.label}
                {param.required && <span className="text-red-500">*</span>}
                <code className="font-mono text-[10.5px] text-neutral-400">--{param.key}</code>
              </span>
              {renderParam(param)}
              {param.type === "file" && param.source === "clean_data" && !cleanDataLoading && cleanDataFiles.length === 0 && (
                <span className="mt-1 block text-[11px] text-amber-600 dark:text-amber-400">当前 scope 没有登记 clean_data 文件</span>
              )}
            </label>
          ))}

          {error && (
            <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-[12px] text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
              {error}
            </div>
          )}

          <div className="flex justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={onCancel}
              className="rounded-md border border-neutral-200 px-3 py-1.5 text-[12px] text-neutral-600 hover:bg-neutral-50 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-900"
            >
              取消
            </button>
            <button
              type="submit"
              disabled={running || disabled}
              className="rounded-md bg-neutral-900 px-3 py-1.5 text-[12px] text-white hover:bg-neutral-700 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-white"
            >
              发送
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export function ChatPane(p: Props) {
  const [input, setInput] = useState("");
  const [selectedSkillPaths, setSelectedSkillPaths] = useState<string[]>([]);
  const [activeAssistPanel, setActiveAssistPanel] = useState<"fork" | "delegate" | "tool" | null>(null);
  const [commands, setCommands] = useState<XanCommand[]>([]);
  const [commandsLoading, setCommandsLoading] = useState(false);
  const [commandsError, setCommandsError] = useState("");
  const [commandMenuOpen, setCommandMenuOpen] = useState(false);
  const [selectedCommand, setSelectedCommand] = useState<XanCommand | null>(null);
  const [commandFormValues, setCommandFormValues] = useState<Record<string, string>>({});
  const [commandFormError, setCommandFormError] = useState("");
  const [cleanDataFiles, setCleanDataFiles] = useState<WorkspacePath[]>([]);
  const [cleanDataLoading, setCleanDataLoading] = useState(false);
  const [drawerWidth, setDrawerWidth] = useState(() => {
    if (typeof window === "undefined") return DRAWER_DEFAULT;
    const raw = window.localStorage.getItem(DRAWER_WIDTH_KEY);
    if (!raw) return DRAWER_DEFAULT;
    const stored = Number(raw);
    return Number.isFinite(stored) ? stored : DRAWER_DEFAULT;
  });
  const {
    contexts: businessRequirementContexts,
    selectedId: selectedBusinessRequirementId,
    setSelectedId: setSelectedBusinessRequirementId,
    selectedContext: selectedBusinessRequirement,
  } = useBusinessRequirementContexts(p.folderScope);
  const [showTrace, setShowTrace] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const activeSessionId = p.sessionId || (p.folderScope?.type === "session" ? p.folderScope.sessionId : "");
  const canUseSessionTools = Boolean(activeSessionId) && !p.disabled;
  const commandQueryText = commandQuery(input);
  const commandCandidates = useMemo(() => {
    if (commandQueryText === null) return [];
    const query = commandQueryText.toLowerCase();
    return commands
      .filter((command) => command.enabled)
      .filter((command) => {
        if (!query) return true;
        return command.name.toLowerCase().includes(query)
          || (command.description ?? "").toLowerCase().includes(query)
          || (command.argumentHint ?? "").toLowerCase().includes(query);
      })
      .slice(0, 8);
  }, [commandQueryText, commands]);
  const commandFileParams = useMemo(
    () => (selectedCommand?.params ?? []).filter((param) => param.type === "file" && param.source === "clean_data"),
    [selectedCommand],
  );

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [p.messages, p.running]);

  useEffect(() => {
    if (!canUseSessionTools) setActiveAssistPanel(null);
  }, [canUseSessionTools]);

  useEffect(() => {
    let cancelled = false;
    setCommandsLoading(true);
    setCommandsError("");
    api.listCommands()
      .then((next) => {
        if (cancelled) return;
        setCommands(next.filter((command) => command.enabled));
      })
      .catch((err) => {
        if (cancelled) return;
        setCommandsError(String(err));
        setCommands([]);
      })
      .finally(() => {
        if (!cancelled) setCommandsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    setCommandMenuOpen(commandQueryText !== null && !selectedCommand && !p.disabled);
  }, [commandQueryText, p.disabled, selectedCommand]);

  useEffect(() => {
    if (!selectedCommand || commandFileParams.length === 0) {
      setCleanDataFiles([]);
      setCleanDataLoading(false);
      return;
    }
    let cancelled = false;
    setCleanDataLoading(true);
    setCommandFormError("");
    const scope = p.folderScope;
    const load = scope?.type === "session"
      ? api.listSessionPaths(scope.sessionId, "clean_data")
      : scope?.type === "flow"
        ? api.listFlowPaths(scope.flowId, "clean_data")
        : scope?.type === "workspace"
          ? api.listWorkspacePaths(scope.workspaceId, "clean_data")
          : Promise.resolve([]);

    load
      .then((paths) => {
        if (cancelled) return;
        setCleanDataFiles(paths.filter((path) => path.kind === "file"));
      })
      .catch((err) => {
        if (!cancelled) setCommandFormError(String(err));
      })
      .finally(() => {
        if (!cancelled) setCleanDataLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [commandFileParams.length, p.folderScope, selectedCommand]);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const clampToContainer = () => {
      const containerWidth = rootRef.current?.clientWidth;
      if (!containerWidth) return;
      setDrawerWidth((current) => {
        const next = clampDrawerWidth(current, containerWidth);
        window.localStorage.setItem(DRAWER_WIDTH_KEY, String(next));
        return next;
      });
    };

    clampToContainer();
    window.addEventListener("resize", clampToContainer);
    return () => window.removeEventListener("resize", clampToContainer);
  }, []);

  function startDrawerResize(event: ReactMouseEvent<HTMLDivElement>) {
    event.preventDefault();
    const root = rootRef.current;
    if (!root) return;

    const previousCursor = document.body.style.cursor;
    const previousUserSelect = document.body.style.userSelect;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";

    const onMove = (moveEvent: MouseEvent) => {
      const rect = root.getBoundingClientRect();
      const nextWidth = clampDrawerWidth(rect.right - moveEvent.clientX, root.clientWidth);
      setDrawerWidth(nextWidth);
      window.localStorage.setItem(DRAWER_WIDTH_KEY, String(nextWidth));
    };

    const onEnd = () => {
      document.body.style.cursor = previousCursor;
      document.body.style.userSelect = previousUserSelect;
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onEnd);
    };

    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onEnd);
  }

  function autosize() {
    const ta = taRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = `${Math.min(ta.scrollHeight, window.innerHeight * 0.4)}px`;
  }

  function sendText(text: string) {
    const trimmed = text.trim();
    if (!trimmed || p.running || p.disabled) return;
    p.onSend(
      trimmed,
      selectedSkillPaths.length > 0 ? selectedSkillPaths : undefined,
      selectedBusinessRequirement ? {
        pathId: selectedBusinessRequirement.pathId,
        markdownPath: selectedBusinessRequirement.markdownPath,
        jsonPath: selectedBusinessRequirement.jsonPath,
      } : undefined,
    );
  }

  function submit() {
    const text = input.trim();
    if (!text || p.running || p.disabled) return;
    sendText(text);
    setInput("");
    setCommandMenuOpen(false);
    requestAnimationFrame(autosize);
  }

  function selectCommand(command: XanCommand) {
    if (commandHasParams(command)) {
      const initialValues = Object.fromEntries((command.params ?? []).map((param) => [param.key, ""]));
      setSelectedCommand(command);
      setCommandFormValues(initialValues);
      setCommandFormError("");
      setCommandMenuOpen(false);
      return;
    }
    setInput(`/${command.name} `);
    setCommandMenuOpen(false);
    requestAnimationFrame(() => {
      taRef.current?.focus();
      autosize();
    });
  }

  function updateCommandFormValue(key: string, value: string) {
    setCommandFormValues((current) => ({ ...current, [key]: value }));
    setCommandFormError("");
  }

  function submitCommandForm() {
    const command = selectedCommand;
    if (!command) return;
    const missing = (command.params ?? []).find((param) => param.required && !commandFormValues[param.key]?.trim());
    if (missing) {
      setCommandFormError(`请填写 ${missing.label}`);
      return;
    }
    const line = encodeCommandLine(command, commandFormValues);
    sendText(line);
    setSelectedCommand(null);
    setCommandFormValues({});
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
  const drawerTitle =
    activeAssistPanel === "fork" ? "Fork 分支" :
    activeAssistPanel === "tool" ? "@工具" :
    activeAssistPanel === "delegate" ? "委派子 agent" :
    "";

  return (
    <div ref={rootRef} className="flex min-h-0 min-w-0 flex-1">
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

          {activeSessionId && (
            <MemoryFeedbackInline
              workspaceId={p.workspaceId}
              targetKind="session"
              targetId={activeSessionId}
              refreshKey={`${p.messages.length}:${p.running}`}
              hidden={p.running}
            />
          )}

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

          <div className="relative rounded-2xl border border-neutral-200 bg-white shadow-sm dark:border-neutral-800 dark:bg-neutral-900">
            {commandMenuOpen && (
              <div className="absolute bottom-full left-0 right-0 z-20 mb-2 overflow-hidden rounded-lg border border-neutral-200 bg-white shadow-lg dark:border-neutral-800 dark:bg-neutral-950">
                <div className="border-b border-neutral-100 px-3 py-2 text-[11.5px] text-neutral-500 dark:border-neutral-800 dark:text-neutral-400">
                  {commandsLoading ? "正在加载 commands…" : commandsError ? `命令加载失败：${commandsError}` : "选择命令"}
                </div>
                {!commandsLoading && !commandsError && commandCandidates.length === 0 && (
                  <div className="px-3 py-3 text-[12px] text-neutral-400">没有匹配的命令</div>
                )}
                {!commandsLoading && !commandsError && commandCandidates.map((command) => (
                  <button
                    key={command.id}
                    type="button"
                    onMouseDown={(event) => {
                      event.preventDefault();
                      selectCommand(command);
                    }}
                    className="flex w-full items-start gap-3 border-b border-neutral-100 px-3 py-2.5 text-left last:border-b-0 hover:bg-neutral-50 dark:border-neutral-800 dark:hover:bg-neutral-900"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex min-w-0 items-center gap-2">
                        <span className="font-mono text-[13px] font-medium text-neutral-900 dark:text-neutral-100">/{command.name}</span>
                        {command.argumentHint && (
                          <span className="truncate font-mono text-[11px] text-neutral-400">{command.argumentHint}</span>
                        )}
                      </div>
                      {command.description && (
                        <div className="mt-0.5 truncate text-[12px] text-neutral-500 dark:text-neutral-400">{command.description}</div>
                      )}
                    </div>
                    {commandHasParams(command) && (
                      <span className="mt-0.5 rounded border border-neutral-200 px-1.5 py-0.5 text-[10.5px] text-neutral-500 dark:border-neutral-700 dark:text-neutral-400">
                        表单
                      </span>
                    )}
                  </button>
                ))}
              </div>
            )}
            <textarea
              ref={taRef}
              value={input}
              disabled={p.disabled}
              onChange={(e) => {
                setInput(e.target.value);
                autosize();
              }}
              onKeyDown={(e) => {
                if (commandMenuOpen && !e.nativeEvent.isComposing && (e.key === "Tab" || (e.key === "Enter" && !e.shiftKey))) {
                  const first = commandCandidates[0];
                  if (first) {
                    e.preventDefault();
                    selectCommand(first);
                    return;
                  }
                }
                if (commandMenuOpen && e.key === "Escape") {
                  e.preventDefault();
                  setCommandMenuOpen(false);
                  return;
                }
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

      {selectedCommand && (
        <CommandParamDialog
          command={selectedCommand}
          values={commandFormValues}
          cleanDataFiles={cleanDataFiles}
          cleanDataLoading={cleanDataLoading}
          error={commandFormError}
          running={p.running}
          disabled={p.disabled}
          onChange={updateCommandFormValue}
          onCancel={() => {
            setSelectedCommand(null);
            setCommandFormValues({});
            setCommandFormError("");
            requestAnimationFrame(() => taRef.current?.focus());
          }}
          onSubmit={submitCommandForm}
        />
      )}

      {activeSessionId && activeAssistPanel && (
        <aside
          className="relative flex h-full min-h-0 shrink-0 flex-col border-l border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-950"
          style={{ width: drawerWidth }}
        >
          <div
            onMouseDown={startDrawerResize}
            className="absolute inset-y-0 left-0 z-10 w-1 cursor-col-resize hover:bg-neutral-300 dark:hover:bg-neutral-700"
            title="拖动调整宽度"
          />
          <div className="flex h-10 shrink-0 items-center gap-2 border-b border-neutral-200 px-3 dark:border-neutral-800">
            <div className="min-w-0 flex-1 truncate text-[13px] font-medium text-neutral-800 dark:text-neutral-100">{drawerTitle}</div>
            <button
              onClick={() => setActiveAssistPanel(null)}
              title="关闭"
              className="inline-flex h-7 w-7 items-center justify-center rounded-md text-neutral-500 hover:bg-neutral-100 dark:text-neutral-400 dark:hover:bg-neutral-800"
            >
              <X className="h-3.5 w-3.5" strokeWidth={1.75} />
            </button>
          </div>
          <div className={cn(
            "min-h-0 flex-1 p-3",
            activeAssistPanel === "fork" ? "flex flex-col" : "overflow-y-auto",
          )}>
            {activeAssistPanel === "fork" && (
              <ForkBranchPanel
                parentSessionId={activeSessionId}
                model={p.model}
                onBackflow={(text) => p.onSend(text)}
              />
            )}
            {activeAssistPanel === "tool" && (
              <ManualAnalysisToolCard
                sessionId={activeSessionId}
                workspaceId={p.workspaceId}
                onBackflow={(text) => p.onSend(text)}
                embedded
              />
            )}
            {activeAssistPanel === "delegate" && (
              <DelegateSubAgentCard
                sessionId={activeSessionId}
                workspaceId={p.workspaceId}
                model={p.model}
                models={p.models}
                onBackflow={(text) => p.onSend(text)}
                embedded
              />
            )}
          </div>
        </aside>
      )}
    </div>
  );
}
