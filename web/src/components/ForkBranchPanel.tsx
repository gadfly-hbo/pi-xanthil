import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeftRight, ArrowUp, Check, Loader2, Pencil, Plus, RefreshCw, Square } from "lucide-react";
import { MessageRow, type UiMessage } from "@/components/MessageRow";
import { api } from "@/lib/api";
import { cn } from "@/lib/cn";
import { gateway } from "@/lib/ws";
import { asBlocks, textOf, type FlowTreeNode, type ForkBranch, type PiEvent, type ServerMessage, type StoredMessage } from "@/types";

let forkUid = 0;
const nextForkMessageId = () => `fork-${++forkUid}`;

function storedToUi(row: StoredMessage): UiMessage {
  return {
    id: nextForkMessageId(),
    role: row.role,
    content: asBlocks(row.content),
    error: row.errorMessage ?? undefined,
  };
}

function lastAssistantText(messages: UiMessage[]): string {
  const item = [...messages].reverse().find((message) => message.role === "assistant" && !message.error);
  return item ? textOf(item.content).trim() : "";
}

function collectReportPaths(node: FlowTreeNode): string[] {
  if (node.kind === "file") return [node.path];
  return (node.children ?? []).flatMap(collectReportPaths);
}

interface Props {
  parentSessionId: string;
  model: string;
  onBackflow: (text: string) => void;
}

export function ForkBranchPanel({ parentSessionId, model, onBackflow }: Props) {
  const [branches, setBranches] = useState<ForkBranch[]>([]);
  const [activeBranchId, setActiveBranchId] = useState("");
  const [messages, setMessages] = useState<UiMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState("");
  const [backflowOpen, setBackflowOpen] = useState(false);
  const [backflowText, setBackflowText] = useState("");
  const [renaming, setRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState("");
  const [reportPaths, setReportPaths] = useState<string[]>([]);
  const [selectedReportPath, setSelectedReportPath] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);

  const activeBranch = useMemo(
    () => branches.find((branch) => branch.branchSessionId === activeBranchId) ?? null,
    [activeBranchId, branches],
  );

  async function refreshBranches(selectLatest = false) {
    setError("");
    const list = await api.listForkBranches(parentSessionId);
    setBranches(list);
    if (selectLatest && list[0]) setActiveBranchId(list[0].branchSessionId);
    else if (!activeBranchId && list[0]) setActiveBranchId(list[0].branchSessionId);
  }

  useEffect(() => {
    setBranches([]);
    setActiveBranchId("");
    setMessages([]);
    setInput("");
    setRunning(false);
    void refreshBranches().catch((err) => setError(String(err)));
  }, [parentSessionId]);

  useEffect(() => {
    let cancelled = false;
    setRenaming(false);
    if (!activeBranchId) {
      setMessages([]);
      setRunning(false);
      setReportPaths([]);
      setSelectedReportPath("");
      return;
    }
    setLoading(true);
    api.listMessages(activeBranchId)
      .then((rows) => {
        if (!cancelled) setMessages(rows.map(storedToUi));
      })
      .catch((err) => {
        if (!cancelled) setError(String(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    api.getSessionRunStatus(activeBranchId)
      .then((status) => {
        if (!cancelled) setRunning(status.running);
      })
      .catch(() => {
        if (!cancelled) setRunning(false);
      });
    api.sessionArtifactTree(activeBranchId)
      .then((result) => {
        if (cancelled) return;
        const paths = collectReportPaths(result.tree);
        setReportPaths(paths);
        setSelectedReportPath((current) => current && paths.includes(current) ? current : "");
      })
      .catch(() => {
        if (!cancelled) {
          setReportPaths([]);
          setSelectedReportPath("");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [activeBranchId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, running]);

  useEffect(() => {
    return gateway.subscribe((msg: ServerMessage) => {
      if (!activeBranchId || !("sessionId" in msg) || msg.sessionId !== activeBranchId) return;
      if (msg.type === "run_start") setRunning(true);
      else if (msg.type === "run_end") {
        setRunning(false);
        void refreshBranches().catch(() => undefined);
        api.sessionArtifactTree(activeBranchId)
          .then((result) => setReportPaths(collectReportPaths(result.tree)))
          .catch(() => undefined);
      } else if (msg.type === "error") {
        setRunning(false);
        setMessages((current) => [...current, { id: nextForkMessageId(), role: "assistant", content: [], error: msg.message }]);
      } else if (msg.type === "pi_event") {
        const event: PiEvent = msg.event;
        if (event.type !== "message_end") return;
        const piMessage = (event as Extract<PiEvent, { type: "message_end" }>).message;
        if (piMessage.role === "user") return;
        setMessages((current) => [
          ...current,
          {
            id: nextForkMessageId(),
            role: piMessage.role,
            content: asBlocks(piMessage.content),
            error: piMessage.errorMessage,
          },
        ]);
      }
    });
  }, [activeBranchId]);

  async function createBranch() {
    if (creating) return;
    setCreating(true);
    setError("");
    try {
      const branch = await api.forkSession(parentSessionId);
      setBranches((current) => [branch, ...current.filter((item) => item.id !== branch.id)]);
      setActiveBranchId(branch.branchSessionId);
    } catch (err) {
      setError(String(err));
    } finally {
      setCreating(false);
    }
  }

  function sendBranchMessage() {
    const text = input.trim();
    if (!text || !activeBranchId || running) return;
    setMessages((current) => [...current, { id: nextForkMessageId(), role: "user", content: [{ type: "text", text }] }]);
    gateway.send({ type: "send", sessionId: activeBranchId, text, model: model || undefined });
    setInput("");
  }

  function stopBranchRun() {
    if (!activeBranchId || !running) return;
    gateway.send({ type: "abort", sessionId: activeBranchId });
  }

  function startRename() {
    if (!activeBranch) return;
    setRenameValue(activeBranch.title);
    setRenaming(true);
  }

  async function submitRename() {
    const title = renameValue.trim();
    if (!activeBranchId || !title || title === activeBranch?.title) {
      setRenaming(false);
      return;
    }
    try {
      const updated = await api.renameForkBranch(activeBranchId, title);
      setBranches((current) => current.map((item) => (item.id === updated.id ? updated : item)));
    } catch (err) {
      setError(String(err));
    } finally {
      setRenaming(false);
    }
  }

  function openBackflow() {
    const summary = lastAssistantText(messages);
    const reportLine = selectedReportPath ? `\n\n报告：${selectedReportPath}` : "";
    setBackflowText(`${summary}${reportLine}`.trim());
    setBackflowOpen(true);
  }

  function submitBackflow() {
    const text = backflowText.trim();
    if (!text) return;
    onBackflow(text);
    setBackflowOpen(false);
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center justify-end gap-2">
        <button
          onClick={() => void refreshBranches()}
          title="刷新分支"
          className="inline-flex h-7 w-7 items-center justify-center rounded-md text-neutral-500 hover:bg-neutral-200 dark:hover:bg-neutral-800"
        >
          <RefreshCw className="h-3.5 w-3.5" strokeWidth={1.75} />
        </button>
        <button
          onClick={() => void createBranch()}
          disabled={creating}
          className="inline-flex h-7 items-center gap-1.5 rounded-md bg-neutral-900 px-2.5 text-[12px] text-white disabled:opacity-50 dark:bg-neutral-100 dark:text-neutral-900"
        >
          {creating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
          新分支
        </button>
      </div>

      {branches.length > 0 && (
        <div className="mt-3 flex shrink-0 gap-2 overflow-x-auto pb-1">
          {branches.map((branch) => (
            <button
              key={branch.id}
              onClick={() => setActiveBranchId(branch.branchSessionId)}
              className={cn(
                "shrink-0 rounded-md border px-2.5 py-1.5 text-left text-[12px]",
                branch.branchSessionId === activeBranchId
                  ? "border-neutral-900 bg-white text-neutral-900 dark:border-neutral-100 dark:bg-neutral-900 dark:text-neutral-100"
                  : "border-neutral-200 text-neutral-500 hover:bg-white dark:border-neutral-800 dark:text-neutral-400 dark:hover:bg-neutral-900",
              )}
            >
              <span className="block max-w-[160px] truncate">{branch.title}</span>
              <span className="text-[10.5px] text-neutral-400">{branch.status}</span>
            </button>
          ))}
        </div>
      )}

      {error && <div className="mt-3 shrink-0 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-[12px] text-red-600 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300">{error}</div>}

      {activeBranch ? (
        <div className="mt-3 flex min-h-0 flex-1 flex-col rounded-md border border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900">
          <div className="flex shrink-0 items-center justify-between border-b border-neutral-200 px-3 py-2 dark:border-neutral-800">
            <div className="flex min-w-0 items-center gap-1.5 text-[12px] text-neutral-500 dark:text-neutral-400">
              {renaming ? (
                <>
                  <input
                    autoFocus
                    value={renameValue}
                    onChange={(event) => setRenameValue(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" && !event.nativeEvent.isComposing) {
                        event.preventDefault();
                        void submitRename();
                      } else if (event.key === "Escape") {
                        setRenaming(false);
                      }
                    }}
                    onBlur={() => void submitRename()}
                    className="min-w-0 flex-1 rounded border border-neutral-300 bg-transparent px-1.5 py-0.5 text-[12px] font-medium text-neutral-700 outline-none dark:border-neutral-600 dark:text-neutral-200"
                  />
                  <button
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => void submitRename()}
                    title="保存名称"
                    className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded text-neutral-500 hover:bg-neutral-100 dark:hover:bg-neutral-800"
                  >
                    <Check className="h-3.5 w-3.5" />
                  </button>
                </>
              ) : (
                <>
                  <button
                    onClick={startRename}
                    title="点击重命名分支"
                    className="group flex min-w-0 items-center gap-1 rounded px-1 py-0.5 hover:bg-neutral-100 dark:hover:bg-neutral-800"
                  >
                    <span className="truncate font-medium text-neutral-700 dark:text-neutral-200">{activeBranch.title}</span>
                    <Pencil className="h-3 w-3 shrink-0 text-neutral-400 opacity-60 group-hover:opacity-100" />
                  </button>
                  <span className="ml-1 shrink-0">隔离分支</span>
                </>
              )}
            </div>
            <button
              onClick={openBackflow}
              disabled={messages.length === 0}
              className="inline-flex h-7 items-center gap-1.5 rounded-md border border-neutral-200 px-2 text-[12px] text-neutral-600 hover:bg-neutral-100 disabled:opacity-40 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800"
            >
              <ArrowLeftRight className="h-3.5 w-3.5" />
              回流结果
            </button>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
            <div className="space-y-4">
              {loading && <div className="text-[12px] text-neutral-400">正在加载分支消息…</div>}
              {!loading && messages.length === 0 && <div className="text-[12px] text-neutral-400">在分支里发起第一轮深挖。</div>}
              {messages.map((message) => <MessageRow key={message.id} m={message} />)}
              {running && (
                <div className="flex items-center gap-2 text-[12px] text-neutral-500 dark:text-neutral-400">
                  <span className="inline-block h-3.5 w-1.5 animate-pulse bg-neutral-400 dark:bg-neutral-500" />
                  分支正在运行…
                </div>
              )}
              <div ref={bottomRef} />
            </div>
          </div>
          <div className="shrink-0 border-t border-neutral-200 p-2 dark:border-neutral-800">
            <div className="flex items-end gap-2">
              <textarea
                value={input}
                disabled={running}
                onChange={(event) => setInput(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && event.shiftKey && !event.nativeEvent.isComposing) {
                    event.preventDefault();
                    sendBranchMessage();
                  }
                }}
                rows={2}
                placeholder="输入分支追问，Shift+Enter 发送"
                className="min-h-[48px] flex-1 resize-none rounded-md border border-neutral-200 bg-transparent px-3 py-2 text-[13px] outline-none disabled:opacity-50 dark:border-neutral-700"
              />
              <button
                onClick={running ? stopBranchRun : sendBranchMessage}
                title={running ? "停止分支运行" : "发送（Shift+Enter）"}
                disabled={!running && !input.trim()}
                className={cn(
                  "inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full",
                  running || input.trim()
                    ? "bg-neutral-900 text-white dark:bg-neutral-100 dark:text-neutral-900"
                    : "bg-neutral-200 text-neutral-400 dark:bg-neutral-800 dark:text-neutral-600",
                )}
              >
                {running ? <Square className="h-3.5 w-3.5" fill="currentColor" /> : <ArrowUp className="h-4 w-4" />}
              </button>
            </div>
          </div>
        </div>
      ) : (
        <div className="mt-3 shrink-0 rounded-md border border-dashed border-neutral-200 px-3 py-5 text-center text-[12px] text-neutral-400 dark:border-neutral-800">
          尚无分支，创建后可隔离深挖。
        </div>
      )}

      {backflowOpen && (
        <div className="mt-3 shrink-0 rounded-md border border-neutral-200 bg-white p-3 dark:border-neutral-800 dark:bg-neutral-900">
          <div className="text-[12px] font-medium text-neutral-700 dark:text-neutral-200">回流到主对话</div>
          <textarea
            value={backflowText}
            onChange={(event) => setBackflowText(event.target.value)}
            rows={5}
            className="mt-2 w-full resize-y rounded-md border border-neutral-200 bg-transparent px-3 py-2 text-[13px] leading-5 outline-none dark:border-neutral-700"
          />
          {reportPaths.length > 0 && (
            <label className="mt-2 block text-[12px] text-neutral-500 dark:text-neutral-400">
              报告链接
              <select
                value={selectedReportPath}
                onChange={(event) => {
                  const next = event.target.value;
                  setSelectedReportPath(next);
                  const base = backflowText.replace(/\n\n报告：.*$/s, "").trim();
                  setBackflowText(next ? `${base}\n\n报告：${next}` : base);
                }}
                className="mt-1 w-full rounded-md border border-neutral-200 bg-transparent px-2 py-1.5 text-[12px] outline-none dark:border-neutral-700"
              >
                <option value="">不附加报告</option>
                {reportPaths.map((path) => (
                  <option key={path} value={path}>{path}</option>
                ))}
              </select>
            </label>
          )}
          <div className="mt-2 flex justify-end gap-2">
            <button onClick={() => setBackflowOpen(false)} className="rounded-md px-3 py-1.5 text-[12px] text-neutral-500 hover:bg-neutral-100 dark:hover:bg-neutral-800">取消</button>
            <button onClick={submitBackflow} disabled={!backflowText.trim()} className="rounded-md bg-neutral-900 px-3 py-1.5 text-[12px] text-white disabled:opacity-40 dark:bg-neutral-100 dark:text-neutral-900">发送回主线</button>
          </div>
        </div>
      )}
    </div>
  );
}
