import { useCallback, useEffect, useRef, useState } from "react";
import { MessageSquare, Workflow } from "lucide-react";
import { FlowChatPane } from "@/components/FlowChatPane";
import { FlowWorkflowPane } from "@/components/FlowWorkflowPane";
import { type UiMessage } from "@/components/MessageRow";
import { cn } from "@/lib/cn";
import { api } from "@/lib/api";
import { gateway } from "@/lib/ws";
import { asBlocks, textOf, type Flow, type PiEvent, type PiModel, type ServerMessage, type StoredFlowMessage } from "@/types";

interface Props {
  flow: Flow | null;
  models: PiModel[];
  model: string;
  onModelChange: (m: string) => void;
}

type View = "chat" | "workflow";

let uid = 0;
const nextId = () => `f${++uid}`;

// First-turn priming prompt sent automatically after an import finishes — pi
// reads the freshly-copied folder and produces a pi-compatible workflow shape.
const PRIMING_PROMPT = `我刚把一个本地 agent 工作流文件夹复制到了你当前的工作目录。请：
1. 用 Read/LS 扫描所有文件，理解原工作流的意图、步骤、模板、依赖。
2. 判断它是否已能被 pi cli 直接调用（具备 README.md / OPERATION-GUIDE.md / templates/ / 必要的 .pi/ 配置等）。
3. 若可以直接调用，给我一份 1 页摘要（用途、入口、关键步骤、调用方式）。
4. 若不能直接调用，请改造它：补全缺失的说明文档、把流程描述重写成 pi 能逐步执行的格式、整理 templates/。改完后写到当前目录覆盖原文件，并告诉我改了哪些。
5. 若任何环节你无法仅凭文件理解原意（如自定义 DSL、缺失依赖说明），请直接向我提问。
6. 最后，请在当前目录下生成一个 workflow.json 文件，将工作流结构化为如下格式：
   { "version": 1, "defaultModel": "<推荐模型id>", "nodes": [{ "id": "step1", "label": "步骤名称", "prompt": "该步骤的提示词模板", "model": "" }], "edges": [{ "id": "e1", "source": "step1", "target": "step2" }] }
   每个节点对应工作流中的一个步骤/agent，edges 按执行顺序串联。如果 workflow.json 已存在且内容合理则无需覆盖。`;

export function AgentFlowPane(p: Props) {
  const [view, setView] = useState<View>("chat");
  const [workflowRefreshKey, setWorkflowRefreshKey] = useState(0);
  const [messages, setMessages] = useState<UiMessage[]>([]);
  const [running, setRunning] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importHint, setImportHint] = useState<string | null>(null);

  // The gateway subscription closes over flowId — keep a ref to read the current
  // one without re-subscribing on every flow switch.
  const flowIdRef = useRef<string | null>(null);
  flowIdRef.current = p.flow?.id ?? null;

  // Load history on flow change.
  useEffect(() => {
    if (!p.flow) {
      setMessages([]);
      setImportHint(null);
      return;
    }
    api.listFlowMessages(p.flow.id).then((rows: StoredFlowMessage[]) => {
      setMessages(
        rows.map((r) => ({
          id: nextId(),
          role: r.role,
          content: asBlocks(r.content),
        })),
      );
    });
  }, [p.flow]);

  // Gateway events — pluck flow_event for the active flow.
  useEffect(() => {
    return gateway.subscribe((msg: ServerMessage) => {
      if (msg.type === "run_start" && !msg.runId && msg.flowId && msg.flowId === flowIdRef.current) {
        setRunning(true);
      } else if (msg.type === "run_end" && !msg.runId && msg.flowId && msg.flowId === flowIdRef.current) {
        setRunning(false);
      } else if (msg.type === "error" && !msg.runId && msg.flowId && msg.flowId === flowIdRef.current) {
        setRunning(false);
        setMessages((m) => [...m, { id: nextId(), role: "assistant", content: [], error: msg.message }]);
      } else if (msg.type === "flow_event" && msg.flowId === flowIdRef.current) {
        const ev = msg.event;
        if (ev.type === "message_end") {
          const { message: m } = ev as Extract<PiEvent, { type: "message_end" }>;
          if (m.role === "user") return; // user turn shown optimistically
          const blocks = asBlocks(m.content);
          if (m.errorMessage) {
            setMessages((cur) => [...cur, { id: nextId(), role: m.role, content: blocks, error: m.errorMessage }]);
          } else {
            setMessages((cur) => [...cur, { id: nextId(), role: m.role, content: blocks }]);
          }
        }
      }
    });
  }, []);

  const sendText = useCallback(
    (text: string) => {
      if (!p.flow) return;
      setMessages((cur) => [...cur, { id: nextId(), role: "user", content: [{ type: "text", text }] }]);
      gateway.send({ type: "send_flow", flowId: p.flow.id, text, model: p.model || undefined });
    },
    [p.flow, p.model],
  );

  const onImport = useCallback(
    async (files: FileList) => {
      if (!p.flow) return;
      setImporting(true);
      setImportHint(`正在上传 ${files.length} 个文件…`);
      try {
        const r = await api.importFlowFolder(p.flow.id, files);
        setImportHint(`已导入「${r.sourceName}」共 ${r.count} 个文件，pi 开始分析…`);
        // Auto-fire the priming prompt so pi immediately reads & adapts the folder.
        sendText(PRIMING_PROMPT);
      } catch (err) {
        setImportHint(`导入失败：${String(err)}`);
      } finally {
        setImporting(false);
      }
    },
    [p.flow, sendText],
  );

  const applyToEditor = useCallback(async () => {
    if (!p.flow) return;
    try {
      const tree = await api.flowTree(p.flow.id);
      const hasVisible = (tree.children ?? []).some((n) => n.path !== ".pi-sessions" && n.path !== "runs");
      if (!hasVisible) {
        const latestAssistant = [...messages].reverse().find((m) => m.role === "assistant");
        const md = latestAssistant ? textOf(latestAssistant.content) : "";
        const fallback = "# 工作流\n\n请在这里完善 README 与执行步骤。\n";
        await api.flowFilePut(p.flow.id, "README.md", md.trim() ? md : fallback);
      }
    } catch {
      // ignore and still switch
    }
    setView("workflow");
    setWorkflowRefreshKey((k) => k + 1);
  }, [p.flow, messages]);

  if (!p.flow) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 text-neutral-400 dark:text-neutral-500">
        <Workflow className="h-10 w-10" strokeWidth={1.5} />
        <div className="text-[13px]">在左侧「工作流」中选择或新建一个工作流</div>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* sub-view switcher */}
      <div className="flex h-10 shrink-0 items-center gap-1 border-b border-neutral-200 px-4 dark:border-neutral-800">
        <button
          onClick={() => setView("chat")}
          className={cn(
            "inline-flex h-7 items-center gap-1.5 rounded-md px-2.5 text-[12.5px]",
            view === "chat"
              ? "bg-neutral-100 font-medium text-neutral-900 dark:bg-neutral-800 dark:text-neutral-100"
              : "text-neutral-500 hover:bg-neutral-100 hover:text-neutral-900 dark:text-neutral-400 dark:hover:bg-neutral-800/60 dark:hover:text-neutral-100",
          )}
        >
          <MessageSquare className="h-3.5 w-3.5" strokeWidth={1.75} />
          pi 对话
        </button>
        <button
          onClick={() => { setView("workflow"); setWorkflowRefreshKey((k) => k + 1); }}
          className={cn(
            "inline-flex h-7 items-center gap-1.5 rounded-md px-2.5 text-[12.5px]",
            view === "workflow"
              ? "bg-neutral-100 font-medium text-neutral-900 dark:bg-neutral-800 dark:text-neutral-100"
              : "text-neutral-500 hover:bg-neutral-100 hover:text-neutral-900 dark:text-neutral-400 dark:hover:bg-neutral-800/60 dark:hover:text-neutral-100",
          )}
        >
          <Workflow className="h-3.5 w-3.5" strokeWidth={1.75} />
          工作流
        </button>
        <span className="ml-auto truncate text-[11px] text-neutral-400 dark:text-neutral-500">
          {p.flow.folderPath}
        </span>
      </div>

      <div className="flex min-h-0 flex-1">
        {view === "chat" ? (
          <FlowChatPane
            flow={p.flow}
            messages={messages}
            running={running}
            model={p.model}
            models={p.models}
            importing={importing}
            importHint={importHint}
            onModelChange={p.onModelChange}
            onSend={sendText}
            onImport={onImport}
            onApplyToEditor={applyToEditor}
          />
        ) : (
          <FlowWorkflowPane flow={p.flow} models={p.models} model={p.model} onModelChange={p.onModelChange} refreshKey={workflowRefreshKey} />
        )}
      </div>
    </div>
  );
}
