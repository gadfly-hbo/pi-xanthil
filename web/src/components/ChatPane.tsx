import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent, type ReactNode } from "react";
import { Archive, ArrowUp, Bot, CheckCircle2, ChevronDown, ChevronRight, Cpu, FileText, Gauge, GitBranch, Loader2, Paperclip, RefreshCw, Square, WandSparkles, X } from "lucide-react";
import { DelegateSubAgentCard } from "@/components/DelegateSubAgentCard";
import { ForkBranchPanel } from "@/components/ForkBranchPanel";
import { MemoryFeedbackInline } from "@/components/MemoryFeedbackInline";
import { hasToolBlocks, hasTraceBlocks, MessageRow, type UiMessage } from "@/components/MessageRow";
import { PromptDistillDialog } from "@/components/PromptDistillDialog";
import { PromptSelector } from "@/components/PromptSelector";
import { SkillSelector } from "@/components/SkillSelector";
import { useBusinessRequirementContexts } from "@/components/useBusinessRequirementContexts";
import { api } from "@/lib/api";
import { cn } from "@/lib/cn";
import { textOf, type FlowTreeNode, type PiModel, type PromptDraft, type PromptTemplateInput, type SessionArtifactTree, type SessionRuntime, type WorkspacePath, type XanCommand, type XanCommandParam } from "@/types";

type FolderScope =
  | { type: "workspace"; workspaceId: string }
  | { type: "session"; sessionId: string }
  | { type: "flow"; flowId: string };

const DRAWER_MIN = 360;
const DRAWER_DEFAULT_FALLBACK = 560;
const DRAWER_DEFAULT_RATIO = 0.5;
const DRAWER_WIDTH_KEY = "chatpane.assistDrawerWidth.v2";
const COMMAND_QUERY_RE = /^\/([^\s/]*)$/;

interface Props {
  messages: UiMessage[];
  running: boolean;
  disabled: boolean;
  workspaceId: string | null;
  folderScope: FolderScope | null;
  /** 显式会话 id：folderScope 为 flow scope（如专题对话）时，Fork/委派用它识别活跃 session。日常场景不传，从 folderScope 的 session scope 推断。 */
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
  renderMessageAction?: (message: UiMessage) => ReactNode;
  skillScope?: Exclude<FolderScope, { type: "session"; sessionId: string }> | null;
  skillSources?: Array<"global" | "project">;
  enableFileUpload?: boolean;
  // E-COLLECT-TRIM：能力开关（默认 false=保持现状；收集场景关掉沉淀/选择器/委派）。
  hideSediment?: boolean;   // 沉淀 trace + 沉淀 prompt
  hideSkill?: boolean;      // skill 选择器
  hidePromptLib?: boolean;  // prompt 库
  hideBizReq?: boolean;     // 业务需求下拉
  hideDelegate?: boolean;   // 委派子 agent
}

interface ComposerAttachment {
  id: string;
  name: string;
  size: number;
  text: string;
}

const TEXT_UPLOAD_EXTENSIONS = new Set([
  ".txt",
  ".md",
  ".markdown",
  ".csv",
  ".tsv",
  ".json",
  ".jsonl",
  ".yaml",
  ".yml",
  ".html",
  ".htm",
  ".xml",
  ".log",
]);
const TEXT_UPLOAD_ACCEPT = Array.from(TEXT_UPLOAD_EXTENSIONS).join(",");
const MAX_COMPOSER_FILE_BYTES = 2 * 1024 * 1024;
const EXECUTION_STAGES = ["准备任务", "读取上下文", "分析数据", "生成报告", "整理产物", "完成"] as const;

type ExecutionStageStatus = "done" | "active" | "pending";

interface ExecutionStage {
  label: typeof EXECUTION_STAGES[number];
  status: ExecutionStageStatus;
}

interface ArtifactFileItem {
  path: string;
  name: string;
  mtime: number;
}

function summarizeExecutionText(text: string): string {
  const withoutThinking = text.replace(/<think>[\s\S]*?<\/think>/gi, " ");
  const compact = withoutThinking
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/[#*_>`~\-[\]()]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!compact) return "";
  return compact.length > 260 ? `${compact.slice(0, 260)}…` : compact;
}

function countArtifactFiles(node: FlowTreeNode | null): number {
  if (!node) return 0;
  if (node.kind === "file") return 1;
  return (node.children ?? []).reduce((sum, child) => sum + countArtifactFiles(child), 0);
}

function collectArtifactFiles(node: FlowTreeNode | null, limit: number): ArtifactFileItem[] {
  if (!node || limit <= 0) return [];
  if (node.kind === "file") return [{ path: node.path, name: node.name, mtime: node.mtime }];
  const files: ArtifactFileItem[] = [];
  for (const child of node.children ?? []) {
    if (files.length >= limit) break;
    files.push(...collectArtifactFiles(child, limit - files.length));
  }
  return files;
}

function getExecutionStageIndex(options: {
  running: boolean;
  hasUserMessage: boolean;
  hasAssistantText: boolean;
  hasToolActivity: boolean;
  artifactCount: number;
}): number {
  if (!options.hasUserMessage && !options.running) return 0;
  if (!options.running && options.hasUserMessage) return EXECUTION_STAGES.length - 1;
  if (options.artifactCount > 0) return 4;
  if (options.hasAssistantText) return 3;
  if (options.hasToolActivity) return 2;
  if (options.hasUserMessage) return 1;
  return 0;
}

function getExecutionStages(activeIndex: number, running: boolean): ExecutionStage[] {
  return EXECUTION_STAGES.map((label, index) => {
    if (!running && activeIndex === EXECUTION_STAGES.length - 1) return { label, status: "done" };
    if (index < activeIndex) return { label, status: "done" };
    if (index === activeIndex) return { label, status: "active" };
    return { label, status: "pending" };
  });
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

function defaultDrawerWidth(containerWidth: number): number {
  return clampDrawerWidth(containerWidth * DRAWER_DEFAULT_RATIO, containerWidth);
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

function isTextUpload(file: File): boolean {
  const dot = file.name.lastIndexOf(".");
  const ext = dot >= 0 ? file.name.toLowerCase().slice(dot) : "";
  return file.type.startsWith("text/") || TEXT_UPLOAD_EXTENSIONS.has(ext);
}

function attachmentBlock(attachments: ComposerAttachment[]): string {
  if (attachments.length === 0) return "";
  const blocks = attachments.map((file) => (
    `### ${file.name}\n\n${file.text}`
  ));
  return `\n\n[本轮上传文件]\n${blocks.join("\n\n---\n\n")}`;
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
  const [attachments, setAttachments] = useState<ComposerAttachment[]>([]);
  const [attachmentError, setAttachmentError] = useState("");
  const [activeAssistPanel, setActiveAssistPanel] = useState<"fork" | "delegate" | null>(null);
  const [commands, setCommands] = useState<XanCommand[]>([]);
  const [commandsLoading, setCommandsLoading] = useState(false);
  const [commandsError, setCommandsError] = useState("");
  const [commandMenuOpen, setCommandMenuOpen] = useState(false);
  const [selectedCommand, setSelectedCommand] = useState<XanCommand | null>(null);
  const [commandFormValues, setCommandFormValues] = useState<Record<string, string>>({});
  const [commandFormError, setCommandFormError] = useState("");
  const [cleanDataFiles, setCleanDataFiles] = useState<WorkspacePath[]>([]);
  const [cleanDataLoading, setCleanDataLoading] = useState(false);
  const [consolidationCount, setConsolidationCount] = useState(0);
  const [consolidatingTrace, setConsolidatingTrace] = useState(false);
  const [consolidationNotice, setConsolidationNotice] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const [distillingPrompt, setDistillingPrompt] = useState(false);
  const [promptDraft, setPromptDraft] = useState<PromptDraft | null>(null);
  const [savingPrompt, setSavingPrompt] = useState(false);
  const [promptDistillError, setPromptDistillError] = useState("");
  const [promptNotice, setPromptNotice] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const [drawerWidth, setDrawerWidth] = useState(() => {
    if (typeof window === "undefined") return DRAWER_DEFAULT_FALLBACK;
    const raw = window.localStorage.getItem(DRAWER_WIDTH_KEY);
    if (!raw) return DRAWER_DEFAULT_FALLBACK;
    const stored = Number(raw);
    return Number.isFinite(stored) ? stored : DRAWER_DEFAULT_FALLBACK;
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
  const fileInputRef = useRef<HTMLInputElement>(null);
  const activeSessionId = p.sessionId || (p.folderScope?.type === "session" ? p.folderScope.sessionId : "");
  const [artifacts, setArtifacts] = useState<SessionArtifactTree | null>(null);
  const [artifactsLoading, setArtifactsLoading] = useState(false);
  const [artifactsError, setArtifactsError] = useState("");
  const [currentRoundStartedAt, setCurrentRoundStartedAt] = useState<number | null>(null);
  const [currentRoundMessageStartIndex, setCurrentRoundMessageStartIndex] = useState<number | null>(null);
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
  const artifactCount = countArtifactFiles(artifacts?.tree ?? null);
  const allArtifactFiles = useMemo(() => collectArtifactFiles(artifacts?.tree ?? null, Number.POSITIVE_INFINITY), [artifacts]);
  const currentRoundArtifactFiles = useMemo(() => {
    if (currentRoundStartedAt == null) return [];
    const threshold = currentRoundStartedAt - 2000;
    return allArtifactFiles.filter((file) => file.mtime >= threshold);
  }, [allArtifactFiles, currentRoundStartedAt]);
  const shouldShowCurrentRoundArtifacts = currentRoundStartedAt != null && (p.running || currentRoundArtifactFiles.length > 0);
  const visibleArtifactFiles = shouldShowCurrentRoundArtifacts ? currentRoundArtifactFiles : allArtifactFiles;
  const visibleArtifactCount = shouldShowCurrentRoundArtifacts ? currentRoundArtifactFiles.length : artifactCount;
  const artifactFiles = visibleArtifactFiles.slice(0, 4);
  const artifactScopeLabel = shouldShowCurrentRoundArtifacts ? "本轮产物" : "产物";

  const loadArtifacts = useCallback(() => {
    if (!activeSessionId) {
      setArtifacts(null);
      setArtifactsError("");
      return;
    }
    setArtifactsLoading(true);
    setArtifactsError("");
    api.sessionArtifactTree(activeSessionId)
      .then(setArtifacts)
      .catch((error) => {
        setArtifacts(null);
        setArtifactsError(error instanceof Error ? error.message : String(error));
      })
      .finally(() => setArtifactsLoading(false));
  }, [activeSessionId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [p.messages, p.running]);

  useEffect(() => {
    setCurrentRoundStartedAt(null);
    setCurrentRoundMessageStartIndex(null);
  }, [activeSessionId]);

  useEffect(() => {
    loadArtifacts();
  }, [loadArtifacts, p.messages.length]);

  useEffect(() => {
    if (!p.running || !activeSessionId) return;
    const timer = window.setInterval(loadArtifacts, 4000);
    return () => window.clearInterval(timer);
  }, [activeSessionId, loadArtifacts, p.running]);

  useEffect(() => {
    if (!canUseSessionTools) setActiveAssistPanel(null);
  }, [canUseSessionTools]);

  useEffect(() => {
    let cancelled = false;
    setConsolidationCount(0);
    setConsolidationNotice(null);
    // 沉淀计数只服务于（已隐藏的）沉淀 trace 按钮；hideSediment 场景（如收集，session 属全局收集容器）
    // 不取计数——否则 workspaceId(业务ws)+sessionId(收集ws) 跨工作区组合会被后端 403。
    if (p.hideSediment || !p.workspaceId || !activeSessionId) return () => { cancelled = true; };
    api.getSessionConsolidationCount(p.workspaceId, activeSessionId)
      .then(({ count }) => {
        if (!cancelled) setConsolidationCount(count);
      })
      .catch((error) => {
        if (!cancelled) setConsolidationNotice({ tone: "error", text: `计数加载失败：${error instanceof Error ? error.message : String(error)}` });
      });
    return () => { cancelled = true; };
  }, [activeSessionId, p.workspaceId, p.hideSediment]);

  async function consolidateTrace() {
    if (!p.workspaceId || !activeSessionId || consolidatingTrace) return;
    setConsolidatingTrace(true);
    setConsolidationNotice(null);
    try {
      const result = await api.consolidateSessionTrace(p.workspaceId, activeSessionId);
      setConsolidationCount(result.count);
      if (!result.ok) {
        setConsolidationNotice({ tone: "error", text: `沉淀失败：${result.error ?? "候选未通过门禁"}` });
      } else if (result.candidates === 0) {
        setConsolidationNotice({ tone: "success", text: "本轮无可沉淀内容" });
      } else {
        setConsolidationNotice({ tone: "success", text: `沉淀完成：新增 ${result.ingested} 条 · ${result.review} 条待复核` });
      }
    } catch (error) {
      setConsolidationNotice({ tone: "error", text: `沉淀失败：${error instanceof Error ? error.message : String(error)}` });
    } finally {
      setConsolidatingTrace(false);
    }
  }

  async function distillPrompt() {
    if (!p.workspaceId || !activeSessionId || distillingPrompt) return;
    setDistillingPrompt(true);
    setPromptNotice(null);
    setPromptDistillError("");
    try {
      const result = await api.distillSessionPrompt(p.workspaceId, activeSessionId);
      if (!result.draft) {
        setPromptNotice({ tone: "success", text: "本轮暂无可沉淀 Prompt" });
        return;
      }
      setPromptDraft(result.draft);
    } catch (error) {
      setPromptNotice({ tone: "error", text: `Prompt 沉淀失败：${error instanceof Error ? error.message : String(error)}` });
    } finally {
      setDistillingPrompt(false);
    }
  }

  async function saveDistilledPrompt(input: PromptTemplateInput) {
    if (!p.workspaceId || savingPrompt) return;
    setSavingPrompt(true);
    setPromptDistillError("");
    try {
      await api.createPromptTemplate(p.workspaceId, { ...input, workspaceId: p.workspaceId });
      setPromptDraft(null);
      setPromptNotice({ tone: "success", text: `Prompt 已入库：${input.title}` });
    } catch (error) {
      setPromptDistillError(error instanceof Error ? error.message : String(error));
    } finally {
      setSavingPrompt(false);
    }
  }

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
        const stored = window.localStorage.getItem(DRAWER_WIDTH_KEY);
        const next = stored ? clampDrawerWidth(current, containerWidth) : defaultDrawerWidth(containerWidth);
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
    if ((!trimmed && attachments.length === 0) || p.running || p.disabled) return;
    const textWithAttachments = `${trimmed}${attachmentBlock(attachments)}`.trim();
    setCurrentRoundStartedAt(Date.now());
    setCurrentRoundMessageStartIndex(p.messages.length);
    p.onSend(
      textWithAttachments,
      selectedSkillPaths.length > 0 ? selectedSkillPaths : undefined,
      selectedBusinessRequirement ? {
        pathId: selectedBusinessRequirement.pathId,
        markdownPath: selectedBusinessRequirement.markdownPath,
        jsonPath: selectedBusinessRequirement.jsonPath,
      } : undefined,
    );
    setAttachments([]);
    setAttachmentError("");
  }

  function submit() {
    const text = input.trim();
    if ((!text && attachments.length === 0) || p.running || p.disabled) return;
    sendText(text);
    setInput("");
    setCommandMenuOpen(false);
    requestAnimationFrame(autosize);
  }

  async function addFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    setAttachmentError("");
    const next: ComposerAttachment[] = [];
    for (const file of Array.from(files)) {
      if (!isTextUpload(file)) {
        setAttachmentError(`不支持 ${file.name}；当前仅支持文本类文件。`);
        continue;
      }
      if (file.size > MAX_COMPOSER_FILE_BYTES) {
        setAttachmentError(`${file.name} 超过 2MB；请拆分或转为较小文本。`);
        continue;
      }
      try {
        next.push({
          id: `${file.name}:${file.size}:${file.lastModified}:${Math.random().toString(36).slice(2)}`,
          name: file.name,
          size: file.size,
          text: await file.text(),
        });
      } catch (error) {
        setAttachmentError(`读取 ${file.name} 失败：${error instanceof Error ? error.message : String(error)}`);
      }
    }
    if (next.length > 0) setAttachments((current) => [...current, ...next]);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  function insertPrompt(body: string) {
    const textarea = taRef.current;
    const start = textarea?.selectionStart ?? input.length;
    const end = textarea?.selectionEnd ?? input.length;
    setInput(`${input.slice(0, start)}${body}${input.slice(end)}`);
    setCommandMenuOpen(false);
    requestAnimationFrame(() => {
      const nextTextarea = taRef.current;
      if (!nextTextarea) return;
      const cursor = start + body.length;
      nextTextarea.focus();
      nextTextarea.setSelectionRange(cursor, cursor);
      autosize();
    });
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
    if (command.toolIds && command.toolIds.length > 0) {
      setInput(`${line} `);
      setSelectedCommand(null);
      setCommandFormValues({});
      requestAnimationFrame(() => {
        taRef.current?.focus();
        autosize();
      });
      return;
    }
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
  const currentRoundMessages = currentRoundMessageStartIndex == null ? [] : p.messages.slice(currentRoundMessageStartIndex);
  const latestCurrentRoundAssistantMessage = [...currentRoundMessages]
    .reverse()
    .find((message) => message.role === "assistant" && textOf(message.content).trim().length > 0 && !hasTraceBlocks(message));
  const latestSessionAssistantMessage = [...businessMessages]
    .reverse()
    .find((message) => message.role === "assistant" && textOf(message.content).trim().length > 0);
  const latestAssistantMessage = currentRoundStartedAt != null ? latestCurrentRoundAssistantMessage : latestSessionAssistantMessage;
  const latestAssistantSummary = summarizeExecutionText(latestAssistantMessage ? textOf(latestAssistantMessage.content) : "");
  const waitingForCurrentRoundSummary = currentRoundStartedAt != null && !latestCurrentRoundAssistantMessage;
  const hasUserMessage = p.messages.some((message) => message.role === "user");
  const hasCurrentRound = currentRoundStartedAt != null;
  const hasAssistantText = hasCurrentRound
    ? currentRoundMessages.some((message) => message.role === "assistant" && textOf(message.content).trim().length > 0 && !hasTraceBlocks(message))
    : businessMessages.some((message) => message.role === "assistant" && textOf(message.content).trim().length > 0);
  const hasToolActivity = (hasCurrentRound ? currentRoundMessages : p.messages).some((message) => message.role === "tool" || hasToolBlocks(message));
  const activeStageIndex = getExecutionStageIndex({
    running: p.running,
    hasUserMessage,
    hasAssistantText,
    hasToolActivity,
    artifactCount: visibleArtifactCount,
  });
  const executionStages = getExecutionStages(activeStageIndex, p.running);
  const activeStageLabel = executionStages[activeStageIndex]?.label ?? EXECUTION_STAGES[0];
  const showExecutionOverview = p.messages.length > 0 || p.running || artifactCount > 0;
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
        {!p.hideSediment && (
        <button
          onClick={() => void consolidateTrace()}
          disabled={!p.workspaceId || !activeSessionId || consolidatingTrace}
          title="从当前会话 trace 手动沉淀候选记忆"
          className="inline-flex h-7 items-center gap-1 rounded-md px-2 text-[11.5px] text-neutral-500 hover:bg-neutral-100 disabled:cursor-not-allowed disabled:opacity-40 dark:text-neutral-400 dark:hover:bg-neutral-800"
        >
          {consolidatingTrace ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Archive className="h-3.5 w-3.5" strokeWidth={1.75} />}
          {consolidatingTrace ? "沉淀中…" : `沉淀 trace（${consolidationCount}）`}
        </button>
        )}
        {!p.hideSediment && (
        <button
          onClick={() => void distillPrompt()}
          disabled={!p.workspaceId || !activeSessionId || distillingPrompt}
          title="从本轮成功对话提炼可复用 Prompt 草稿"
          className="inline-flex h-7 items-center gap-1 rounded-md px-2 text-[11.5px] text-neutral-500 hover:bg-neutral-100 disabled:cursor-not-allowed disabled:opacity-40 dark:text-neutral-400 dark:hover:bg-neutral-800"
        >
          {distillingPrompt ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <WandSparkles className="h-3.5 w-3.5" strokeWidth={1.75} />}
          {distillingPrompt ? "提炼中…" : "沉淀 prompt"}
        </button>
        )}
        {p.runtimeNotice && <span className="truncate text-[11px] text-neutral-400" title={p.runtimeNotice}>{p.runtimeNotice}</span>}
        {consolidationNotice && (
          <span
            className={cn("truncate text-[11px]", consolidationNotice.tone === "error" ? "text-red-500" : "text-emerald-600 dark:text-emerald-400")}
            title={consolidationNotice.text}
          >
            {consolidationNotice.text}
          </span>
        )}
        {promptNotice && (
          <span
            className={cn("truncate text-[11px]", promptNotice.tone === "error" ? "text-red-500" : "text-emerald-600 dark:text-emerald-400")}
            title={promptNotice.text}
          >
            {promptNotice.text}
          </span>
        )}
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

          {showExecutionOverview && (
            <>
              <div className="sticky top-0 z-20 -mx-6 bg-white/95 px-6 py-2 backdrop-blur dark:bg-neutral-950/95">
                <div className="rounded-lg border border-neutral-200 bg-white p-3 shadow-sm dark:border-neutral-800 dark:bg-neutral-950">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex min-w-0 items-center gap-2">
                        {p.running ? (
                          <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-neutral-500 dark:text-neutral-400" strokeWidth={1.75} />
                        ) : (
                          <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-600 dark:text-emerald-400" strokeWidth={1.75} />
                        )}
                        <span className="truncate text-[13px] font-medium text-neutral-900 dark:text-neutral-100">
                          {p.running ? "任务执行中" : "任务已完成"} · {activeStageLabel}阶段
                        </span>
                        <span className="hidden text-[12px] text-neutral-400 sm:inline">
                          当前阶段：{activeStageLabel}
                        </span>
                      </div>
                      {(latestAssistantSummary || waitingForCurrentRoundSummary) && (
                        <p className="mt-1 line-clamp-2 text-[12px] leading-5 text-neutral-600 dark:text-neutral-400">
                          <span className="font-medium text-neutral-800 dark:text-neutral-200">最新摘要：</span>
                          {latestAssistantSummary || "等待本轮输出…"}
                        </p>
                      )}
                    </div>
                    <div className="flex shrink-0 items-center gap-1.5 rounded-md bg-neutral-100 px-2 py-1 text-[11.5px] text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300">
                      {artifactsLoading ? <Loader2 className="h-3 w-3 animate-spin" /> : <FileText className="h-3 w-3" strokeWidth={1.75} />}
                      {artifactScopeLabel}：{visibleArtifactCount} 个文件
                    </div>
                  </div>

                  <div className="mt-2 flex gap-1">
                    {executionStages.map((stage) => (
                      <div
                        key={stage.label}
                        className={cn(
                          "h-1.5 flex-1 rounded-full",
                          stage.status === "done" && "bg-emerald-500/80",
                          stage.status === "active" && "bg-neutral-900 dark:bg-neutral-100",
                          stage.status === "pending" && "bg-neutral-200 dark:bg-neutral-800",
                        )}
                        title={stage.label}
                      />
                    ))}
                  </div>
                  <div className="mt-1.5 grid grid-cols-6 gap-1 text-center text-[10.5px] leading-4">
                    {executionStages.map((stage) => (
                      <span
                        key={stage.label}
                        className={cn(
                          "truncate",
                          stage.status === "done" && "text-emerald-600 dark:text-emerald-400",
                          stage.status === "active" && "font-medium text-neutral-900 dark:text-neutral-100",
                          stage.status === "pending" && "text-neutral-400 dark:text-neutral-500",
                        )}
                        title={stage.label}
                      >
                        {stage.label}
                      </span>
                    ))}
                  </div>

                  {artifactsError && (
                    <p className="mt-2 text-[11.5px] text-rose-500">产物加载失败：{artifactsError}</p>
                  )}
                </div>
              </div>

              {!p.running && artifactFiles.length > 0 && (
                <div className="rounded-lg border border-neutral-200 bg-white p-3 dark:border-neutral-800 dark:bg-neutral-950/40">
                  <div className="mb-1.5 text-[12px] font-medium text-neutral-900 dark:text-neutral-100">{artifactScopeLabel}文件</div>
                  <div className="grid gap-1.5">
                    {artifactFiles.map((file) => (
                      <div key={file.path} className="flex min-w-0 items-center gap-1.5 text-[11.5px] text-neutral-600 dark:text-neutral-300" title={file.path}>
                        <FileText className="h-3.5 w-3.5 shrink-0 text-neutral-400" strokeWidth={1.75} />
                        <span className="truncate font-mono">{file.name}</span>
                      </div>
                    ))}
                  </div>
                  {visibleArtifactCount > artifactFiles.length && (
                    <div className="mt-1 text-[11px] text-neutral-400">另有 {visibleArtifactCount - artifactFiles.length} 个文件</div>
                  )}
                  {shouldShowCurrentRoundArtifacts && artifactCount > visibleArtifactCount && (
                    <div className="mt-1 text-[11px] text-neutral-400">历史产物 {artifactCount - visibleArtifactCount} 个暂收起</div>
                  )}
                </div>
              )}
            </>
          )}

          {visibleMessages.map((m) => (
            <MessageRow key={m.id} m={m} showTrace={showTrace} action={p.renderMessageAction?.(m)} />
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
            {!p.hideDelegate && (
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
            )}
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
            {attachments.length > 0 && (
              <div className="flex flex-wrap gap-1.5 border-b border-neutral-100 px-3 py-2 dark:border-neutral-800">
                {attachments.map((file) => (
                  <span
                    key={file.id}
                    className="inline-flex max-w-[220px] items-center gap-1 rounded-md bg-neutral-100 px-2 py-1 text-[11px] text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300"
                    title={`${file.name} · ${file.size} bytes`}
                  >
                    <FileText className="h-3 w-3 shrink-0" />
                    <span className="truncate">{file.name}</span>
                    <button
                      type="button"
                      onClick={() => setAttachments((current) => current.filter((item) => item.id !== file.id))}
                      className="ml-0.5 text-neutral-400 hover:text-neutral-800 dark:hover:text-neutral-100"
                      title={`移除 ${file.name}`}
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </span>
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
                {p.enableFileUpload && (
                  <>
                    <input
                      ref={fileInputRef}
                      type="file"
                      multiple
                      accept={TEXT_UPLOAD_ACCEPT}
                      className="hidden"
                      onChange={(event) => void addFiles(event.currentTarget.files)}
                    />
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      disabled={p.disabled || p.running}
                      className="inline-flex h-7 items-center gap-1 rounded-md px-1.5 text-[11.5px] text-neutral-500 hover:bg-neutral-100 disabled:cursor-not-allowed disabled:opacity-40 dark:text-neutral-400 dark:hover:bg-neutral-800"
                      title="上传文本文件作为本轮上下文"
                    >
                      <Paperclip className="h-3.5 w-3.5" strokeWidth={1.75} />
                      文件
                    </button>
                  </>
                )}
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
                {!p.hideSkill && (
                <SkillSelector
                  scope={p.skillScope ?? (p.workspaceId ? { type: "workspace", workspaceId: p.workspaceId } : null)}
                  selectedPaths={selectedSkillPaths}
                  onChange={setSelectedSkillPaths}
                  sources={p.skillSources}
                />
                )}
                {!p.hidePromptLib && <PromptSelector workspaceId={p.workspaceId} onInsert={insertPrompt} />}
                {!p.hideBizReq && businessRequirementContexts.length > 0 && (
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
                disabled={p.disabled || (!p.running && !input.trim() && attachments.length === 0)}
                title={p.running ? "停止生成" : "发送（Shift+Enter）"}
                className={cn(
                  "inline-flex h-8 w-8 items-center justify-center rounded-full transition-colors",
                  p.disabled || (!p.running && !input.trim() && attachments.length === 0)
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
            {attachmentError && (
              <div className="border-t border-neutral-100 px-3 py-2 text-[11px] text-red-500 dark:border-neutral-800 dark:text-red-400">
                {attachmentError}
              </div>
            )}
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

      {promptDraft && (
        <PromptDistillDialog
          draft={promptDraft}
          saving={savingPrompt}
          error={promptDistillError}
          onCancel={() => {
            setPromptDraft(null);
            setPromptDistillError("");
          }}
          onConfirm={(input) => void saveDistilledPrompt(input)}
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
