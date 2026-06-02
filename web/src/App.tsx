import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { PanelRightOpen, BookOpen, Calculator, CircleAlert, Database, TriangleAlert, Gauge, FolderKanban, Search } from "lucide-react";
import { cn } from "@/lib/cn";
import { Sidebar } from "@/components/Sidebar";
import { ChatPane } from "@/components/ChatPane";
import { MultiAgentExecutionPane } from "@/components/MultiAgentExecutionPane";
import { FolderPathsPane } from "@/components/FolderPathsPane";
import { type UiMessage } from "@/components/MessageRow";
import { PreviewPane } from "@/components/PreviewPane";
import { MainHeader, type Tab, TABS } from "@/components/MainHeader";
import { SettingsModal } from "@/components/SettingsModal";
import { useTabVisibility } from "@/lib/useTabVisibility";
import { getSubTabsForTab, type SubTab } from "@/lib/constants";
import { WorkflowPickerPane, type WorkflowTemplate } from "@/components/WorkflowPickerPane";
import { Placeholder } from "@/components/Placeholder";
import { ResearchLabPane } from "@/components/ResearchLabPane";
import { AggregatePane } from "@/components/AggregatePane";
import { ExtractionPane } from "@/components/ExtractionPane";
import { TokenStatsPane } from "@/components/TokenStatsPane";
import { TracePane } from "@/components/TracePane";
import { RulesPane } from "@/components/RulesPane";
import { DecisionTreePane } from "@/components/DecisionTreePane";
import { TocPane } from "@/components/TocPane";
import { api } from "@/lib/api";
import { gateway } from "@/lib/ws";
import { asBlocks, textOf, type Flow, type FlowKind, type PiEvent, type PiModel, type ServerMessage, type Session, type SessionRuntime, type StoredMessage, type WorkflowFavorite, type Workspace, type WorkspacePath } from "@/types";

let uid = 0;
const nextId = () => `m${++uid}`;

function isToday(ts: number): boolean {
  const d = new Date(ts);
  const now = new Date();
  return d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
}














const DEFAULT_CHAT_MODEL = "minimax-cn/MiniMax-M3";
const STREAM_END_ERROR = "Stream ended without finish_reason";
const SESSION_RUNNING_ERROR = "session already has a running turn";

function displayError(error: string, consecutiveStreamErrors: number): string {
  if (error !== STREAM_END_ERROR || consecutiveStreamErrors < 2) return error;
  return `${error}\n\n连续出现流式响应中断。请切换到 MiniMax-M3 后重试；生成长报告时应分块写入文件。`;
}

export default function App() {
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [activeWorkspaceId, setActiveWorkspaceId] = useState<string | null>(null);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [flows, setFlows] = useState<Flow[]>([]);
  const [activeFlowId, setActiveFlowId] = useState<string | null>(null);
  const [workflowFavorites, setWorkflowFavorites] = useState<WorkflowFavorite[]>([]);

  const [messages, setMessages] = useState<UiMessage[]>([]);
  const [report, setReport] = useState("");
  const [running, setRunning] = useState(false);
  const [model, setModel] = useState("");
  const [models, setModels] = useState<PiModel[]>([]);
  const [totals, setTotals] = useState({ tokens: 0, cost: 0, input: 0, cacheRead: 0, cacheWrite: 0 });
  const [runtime, setRuntime] = useState<SessionRuntime | null>(null);
  const [compacting, setCompacting] = useState(false);
  const [runtimeNotice, setRuntimeNotice] = useState("");
  const [artifactRefreshKey, setArtifactRefreshKey] = useState(0);

  const { hiddenTabs, toggleTab, isVisible } = useTabVisibility();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [previewOpen, setPreviewOpen] = useState(true);
  const [activeTab, setActiveTab] = useState<Tab>("explore");
  const [activeSubTab, setActiveSubTab] = useState<SubTab>("view");
  const [showWorkflowPicker, setShowWorkflowPicker] = useState(true);
  const [hasReportPath, setHasReportPath] = useState(false);
  const [promoteOpen, setPromoteOpen] = useState(false);
  const [promoteName, setPromoteName] = useState("");
  const [promoteScope, setPromoteScope] = useState<"latest_task" | "full_conversation">("latest_task");
  const [promoting, setPromoting] = useState(false);
  const [promoteError, setPromoteError] = useState("");
  const [rulesPromptEnabled, setRulesPromptEnabled] = useState(false);
  const [rulesPromptInfo, setRulesPromptInfo] = useState<{ count: number; updatedAt: number | null }>({ count: 0, updatedAt: null });

  // activeSessionId is read inside the gateway listener — keep a ref in sync.
  const activeRef = useRef<string | null>(null);
  activeRef.current = activeSessionId;

  const refreshRulesPromptInfo = useCallback(async () => {
    if (!activeWorkspaceId) {
      setRulesPromptInfo({ count: 0, updatedAt: null });
      setRulesPromptEnabled(false);
      return;
    }
    try {
      const result = await api.getRulesPrompt(activeWorkspaceId);
      setRulesPromptInfo({ count: result.count, updatedAt: result.updatedAt });
      if (result.count === 0) setRulesPromptEnabled(false);
    } catch {
      setRulesPromptInfo({ count: 0, updatedAt: null });
      setRulesPromptEnabled(false);
    }
  }, [activeWorkspaceId]);

  // ---- bootstrap ----
  useEffect(() => {
    gateway.connect();
    api.listWorkspaces().then((ws) => {
      setWorkspaces(ws);
      if (ws[0]) setActiveWorkspaceId(ws[0].id);
    });
    api.listModels().then((list) => {
      setModels(list);
      const defaultModel = list.find((item) => item.id === DEFAULT_CHAT_MODEL)
        ?? list.find((item) => item.isDefault)
        ?? list[0];
      if (defaultModel) setModel((cur) => cur || defaultModel.id);
    });
    api.listWorkflowFavorites().then(setWorkflowFavorites);
  }, []);

  // ---- load sessions on workspace change ----
  useEffect(() => {
    if (!activeWorkspaceId) return;
    api.listSessions(activeWorkspaceId).then((s) => {
      setSessions(s);
      if (s[0]) {
        setActiveSessionId(s[0].id);
        setShowWorkflowPicker(false);
      } else {
        setActiveSessionId(null);
        setShowWorkflowPicker(true);
      }
    });
    api.listFlows(activeWorkspaceId).then((f) => {
      setFlows(f);
      const relevant = f.filter((fl) => fl.kind === "multi");
      setActiveFlowId(relevant[0]?.id ?? null);
    });
    void refreshRulesPromptInfo();
  }, [activeWorkspaceId, refreshRulesPromptInfo]);

  // ---- load history on session change ----
  useEffect(() => {
    let cancelled = false;
    if (!activeSessionId) {
      setMessages([]);
      setReport("");
      setTotals({ tokens: 0, cost: 0, input: 0, cacheRead: 0, cacheWrite: 0 });
      setRuntime(null);
      setRuntimeNotice("");
      setRunning(false);
      return;
    }
    api.listMessages(activeSessionId).then((rows: StoredMessage[]) => {
      if (cancelled) return;
      let consecutiveStreamErrors = 0;
      const msgs: UiMessage[] = rows.map((r) => {
        consecutiveStreamErrors = r.errorMessage === STREAM_END_ERROR ? consecutiveStreamErrors + 1 : 0;
        return {
          id: nextId(),
          role: r.role,
          content: asBlocks(r.content),
          error: r.errorMessage ? displayError(r.errorMessage, consecutiveStreamErrors) : undefined,
        };
      });
      setMessages(msgs);
      const lastAssistant = [...rows].reverse().find((r) => r.role === "assistant");
      setReport(lastAssistant ? textOf(lastAssistant.content) : "");
      setTotals(
        rows
          .filter((r) => isToday(r.createdAt))
          .reduce(
            (acc, r) => ({
              tokens: acc.tokens + (r.usage?.totalTokens ?? 0),
              cost: acc.cost + (r.usage?.cost.total ?? 0),
              input: acc.input + (r.usage?.input ?? 0),
              cacheRead: acc.cacheRead + (r.usage?.cacheRead ?? 0),
              cacheWrite: acc.cacheWrite + (r.usage?.cacheWrite ?? 0),
            }),
            { tokens: 0, cost: 0, input: 0, cacheRead: 0, cacheWrite: 0 },
          ),
      );
    });
    api.getSessionRunStatus(activeSessionId)
      .then((status) => {
        if (!cancelled) setRunning(status.running);
      })
      .catch(() => {
        if (!cancelled) setRunning(false);
      });
    setRuntimeNotice("");
    api.getSessionRuntime(activeSessionId, true).then(setRuntime).catch(() => setRuntime(null));
    return () => {
      cancelled = true;
    };
  }, [activeSessionId]);

  // ---- gateway events ----
  useEffect(() => {
    return gateway.subscribe((msg: ServerMessage) => {
      if (msg.type === "flow_event") return;
      if ("flowId" in msg && msg.flowId) return;
      if ("sessionId" in msg && msg.sessionId !== activeRef.current) return;
      if (msg.type === "run_start") {
        setRunning(true);
        setRuntime((current) => current ? { ...current, status: "running", lastError: null } : current);
      }
      else if (msg.type === "run_end") {
        setRunning(false);
        setArtifactRefreshKey((current) => current + 1);
        if (activeRef.current) api.getSessionRuntime(activeRef.current, true).then(setRuntime).catch(() => undefined);
      }
      else if (msg.type === "error") {
        setRunning(msg.message.startsWith(SESSION_RUNNING_ERROR));
        setMessages((m) => [...m, { id: nextId(), role: "assistant", content: [], error: msg.message }]);
      } else if (msg.type === "pi_event") {
        const ev = msg.event;
        if (ev.type === "compaction_start") {
          setRuntime((current) => current ? { ...current, status: "compacting" } : current);
        } else if (ev.type === "compaction_end") {
          setRuntime((current) => current ? {
            ...current,
            status: typeof ev.errorMessage === "string" ? "error" : "running",
            contextTokens: null,
            contextPercent: null,
            compactCount: current.compactCount + (typeof ev.errorMessage === "string" ? 0 : 1),
            lastCompactedAt: typeof ev.errorMessage === "string" ? current.lastCompactedAt : Date.now(),
            lastError: typeof ev.errorMessage === "string" ? ev.errorMessage : null,
          } : current);
        }
        if (ev.type === "message_end") {
          const { message: m } = ev as Extract<PiEvent, { type: "message_end" }>;
          if (m.role === "user") return;
          const blocks = asBlocks(m.content);
          if (m.errorMessage) {
            setMessages((cur) => {
              const previous = cur[cur.length - 1]?.error;
              const repeated = previous?.startsWith(STREAM_END_ERROR) ? 2 : 1;
              return [...cur, { id: nextId(), role: m.role, content: blocks, error: displayError(m.errorMessage!, repeated) }];
            });
          } else {
            setMessages((cur) => [...cur, { id: nextId(), role: m.role, content: blocks }]);
            const text = textOf(m.content);
            if (m.role === "assistant" && text) setReport(text);
          }
          if (m.usage) {
            setTotals((t) => ({
              tokens: t.tokens + m.usage!.totalTokens,
              cost: t.cost + m.usage!.cost.total,
              input: t.input + m.usage!.input,
              cacheRead: t.cacheRead + m.usage!.cacheRead,
              cacheWrite: t.cacheWrite + m.usage!.cacheWrite,
            }));
          }
        }
      }
    });
  }, []);

  // ---- actions ----
  const newWorkspace = useCallback(async (name: string) => {
    const ws = await api.createWorkspace(name);
    setWorkspaces((cur) => [ws, ...cur]);
    setActiveWorkspaceId(ws.id);
  }, []);

  const newSession = useCallback(() => {
    setShowWorkflowPicker(true);
    setActiveTab("explore");
    setActiveSubTab("view");
  }, []);

  const handleSelectSession = useCallback((id: string) => {
    setActiveSessionId(id);
    setShowWorkflowPicker(false);
    setActiveTab("explore");
    setActiveSubTab("view");
  }, []);

  const onSelectWorkflow = useCallback(async (template: WorkflowTemplate) => {
    if (!activeWorkspaceId) return;
    const s = await api.createSession(activeWorkspaceId, template.name, template.id);
    setSessions((cur) => [s, ...cur]);
    setActiveSessionId(s.id);
    setShowWorkflowPicker(false);
    setActiveTab("explore");
    setActiveSubTab("view");
  }, [activeWorkspaceId]);

  const renameWorkspace = useCallback(async (id: string, name: string) => {
    await api.renameWorkspace(id, name);
    setWorkspaces((cur) => cur.map((w) => (w.id === id ? { ...w, name } : w)));
  }, []);

  const deleteWorkspace = useCallback(
    async (id: string) => {
      await api.deleteWorkspace(id);
      setWorkspaces((cur) => {
        const next = cur.filter((w) => w.id !== id);
        if (activeWorkspaceId === id) setActiveWorkspaceId(next[0]?.id ?? null);
        return next;
      });
    },
    [activeWorkspaceId],
  );

  const renameSession = useCallback(async (id: string, title: string) => {
    await api.renameSession(id, title);
    setSessions((cur) => cur.map((s) => (s.id === id ? { ...s, title } : s)));
  }, []);

  const deleteSession = useCallback(
    async (id: string) => {
      await api.deleteSession(id);
      setSessions((cur) => {
        const next = cur.filter((s) => s.id !== id);
        if (activeSessionId === id) setActiveSessionId(next[0]?.id ?? null);
        return next;
      });
    },
    [activeSessionId],
  );

  const newFlow = useCallback(async (kind: FlowKind) => {
    if (!activeWorkspaceId) return;
    const f = await api.createFlow(activeWorkspaceId, `工作流 ${new Date().toLocaleString("zh-CN")}`, kind);
    setFlows((cur) => [f, ...cur]);
    setActiveFlowId(f.id);
    setActiveTab("multi");
    setActiveSubTab("view");
  }, [activeWorkspaceId]);

  const renameFlow = useCallback(async (id: string, name: string) => {
    await api.renameFlow(id, name);
    setFlows((cur) => cur.map((f) => (f.id === id ? { ...f, name } : f)));
  }, []);

  const deleteFlow = useCallback(
    async (id: string) => {
      await api.deleteFlow(id);
      setFlows((cur) => {
        const next = cur.filter((f) => f.id !== id);
        if (activeFlowId === id) setActiveFlowId(next[0]?.id ?? null);
        return next;
      });
    },
    [activeFlowId],
  );

  const favoriteFlow = useCallback(async (id: string) => {
    const favorite = await api.favoriteFlow(id);
    setWorkflowFavorites((cur) => [favorite, ...cur.filter((item) => item.id !== favorite.id)]);
  }, []);

  const removeWorkflowFavorite = useCallback(async (id: string) => {
    await api.removeWorkflowFavorite(id);
    setWorkflowFavorites((cur) => cur.filter((item) => item.id !== id));
  }, []);

  const reuseWorkflowFavorite = useCallback(async (id: string) => {
    if (!activeWorkspaceId) return;
    const flow = await api.reuseWorkflowFavorite(id, activeWorkspaceId);
    setFlows((cur) => [flow, ...cur]);
    setActiveFlowId(flow.id);
    setActiveTab("multi");
    setActiveSubTab("view");
  }, [activeWorkspaceId]);

  const onSelectFlow = useCallback((id: string) => {
    setActiveFlowId(id);
    setActiveTab("multi");
    setActiveSubTab("view");
  }, []);

  const handleTabChange = useCallback((tab: Tab) => {
    if (tab === "explore" && activeTab === "explore") {
      setShowWorkflowPicker(true);
    }
    setActiveTab(tab);
    setActiveSubTab(tab === "rule_memory" ? "rules" : tab === "xan_db" ? "the-crowd" : "view");
  }, [activeTab]);

  useEffect(() => {
    if (!isVisible(activeTab)) {
      const firstAvailable = TABS.find((t) => isVisible(t.id))?.id;
      if (firstAvailable) handleTabChange(firstAvailable);
    }
  }, [hiddenTabs, activeTab, handleTabChange, isVisible]);

  useEffect(() => {
    if (!isVisible(activeTab + ":" + activeSubTab)) {
      const firstAvailable = getSubTabsForTab(activeTab).find((t) => isVisible(activeTab + ":" + t.id))?.id;
      if (firstAvailable) setActiveSubTab(firstAvailable);
    }
  }, [hiddenTabs, activeTab, activeSubTab, isVisible]);



  const onSend = useCallback(
    (text: string, skillPaths?: string[]) => {
      if (!activeSessionId) return;
      setMessages((cur) => [...cur, { id: nextId(), role: "user", content: [{ type: "text", text }] }]);
      gateway.send({ type: "send", sessionId: activeSessionId, text, model: model || undefined, skillPaths, injectRulesPrompt: rulesPromptEnabled });
    },
    [activeSessionId, model, rulesPromptEnabled],
  );

  const onStop = useCallback(() => {
    if (!activeSessionId) return;
    gateway.send({ type: "abort", sessionId: activeSessionId });
  }, [activeSessionId]);

  const compactContext = useCallback(async () => {
    if (!activeSessionId || running || compacting) return;
    setCompacting(true);
    setRuntimeNotice("");
    try {
      const result = await api.compactSession(activeSessionId);
      setRuntime(result.runtime);
      setRuntimeNotice(result.message);
    } catch (err) {
      setRuntime((current) => current ? { ...current, status: "error", lastError: String(err) } : current);
      setRuntimeNotice("上下文整理失败");
    } finally {
      setCompacting(false);
    }
  }, [activeSessionId, compacting, running]);

  const refreshRuntime = useCallback(async () => {
    if (!activeSessionId || running || compacting) return;
    setRuntimeNotice("");
    try {
      const next = await api.getSessionRuntime(activeSessionId, true);
      setRuntime(next);
      setRuntimeNotice(next.status === "error" ? "上下文状态仍未恢复" : "上下文状态已更新");
    } catch (err) {
      setRuntime((current) => current ? { ...current, status: "error", lastError: String(err) } : current);
      setRuntimeNotice("上下文状态获取失败");
    }
  }, [activeSessionId, compacting, running]);

  const cacheHitRate = (() => {
    const total = totals.input + totals.cacheRead + totals.cacheWrite;
    return total > 0 ? totals.cacheRead / total : 0;
  })();

  const activeWorkspace = workspaces.find((w) => w.id === activeWorkspaceId) ?? null;
  const activeSession = sessions.find((session) => session.id === activeSessionId) ?? null;
  const activeFlow = flows.find((f) => f.id === activeFlowId) ?? null;
  const canPromoteToWorkflow = !running && messages.some((message) =>
    message.role === "assistant" && !message.error && textOf(message.content).trim().length > 0,
  );

  const openPromote = useCallback(() => {
    if (!activeSession) return;
    setPromoteName(activeSession.title);
    setPromoteScope("latest_task");
    setPromoteError("");
    setPromoteOpen(true);
  }, [activeSession]);

  const promoteToWorkflow = useCallback(async () => {
    if (!activeSession || !promoteName.trim() || promoting) return;
    setPromoting(true);
    setPromoteError("");
    try {
      const flow = await api.promoteSessionToFlow(activeSession.id, {
        name: promoteName.trim(),
        scope: promoteScope,
        model: model || undefined,
      });
      setFlows((current) => [flow, ...current.filter((item) => item.id !== flow.id)]);
      setActiveFlowId(flow.id);
      setActiveTab("multi");
      setActiveSubTab("view");
      setPromoteOpen(false);
    } catch (err) {
      setPromoteError(String(err));
    } finally {
      setPromoting(false);
    }
  }, [activeSession, model, promoteName, promoteScope, promoting]);

  const folderScope = useMemo(() => activeTab === "explore"
    ? (activeSessionId ? { type: "session" as const, sessionId: activeSessionId } : activeWorkspaceId ? { type: "workspace" as const, workspaceId: activeWorkspaceId } : null)
    : (activeFlowId ? { type: "flow" as const, flowId: activeFlowId } : activeWorkspaceId ? { type: "workspace" as const, workspaceId: activeWorkspaceId } : null),
  [activeFlowId, activeSessionId, activeTab, activeWorkspaceId]);

  useEffect(() => {
    let cancelled = false;
    setHasReportPath(false);
    if (!folderScope) return;
    const request = folderScope.type === "workspace"
      ? api.listWorkspacePaths(folderScope.workspaceId, "report")
      : folderScope.type === "session"
        ? api.listSessionPaths(folderScope.sessionId, "report")
        : api.listFlowPaths(folderScope.flowId, "report");
    request
      .then((paths) => {
        if (!cancelled) setHasReportPath(paths.length > 0);
      })
      .catch(() => {
        if (!cancelled) setHasReportPath(false);
      });
    return () => {
      cancelled = true;
    };
  }, [folderScope]);

  const handleReportPathsChange = useCallback((paths: WorkspacePath[]) => {
    setHasReportPath(paths.length > 0);
    setArtifactRefreshKey((current) => current + 1);
  }, []);

  return (
    <div className="flex h-screen overflow-hidden bg-background text-foreground">
      {sidebarOpen && (
        <Sidebar
          workspaces={workspaces}
          activeWorkspaceId={activeWorkspaceId}
          sessions={sessions}
          activeSessionId={activeSessionId}
          flows={flows}
          activeFlowId={activeFlowId}
          workflowFavorites={workflowFavorites}
          onSelectWorkspace={setActiveWorkspaceId}
          onSelectSession={handleSelectSession}
          onSelectFlow={onSelectFlow}
          onNewWorkspace={newWorkspace}
          onNewSession={newSession}
          onNewFlow={newFlow}
          onRenameWorkspace={renameWorkspace}
          onDeleteWorkspace={deleteWorkspace}
          onRenameSession={renameSession}
          onDeleteSession={deleteSession}
          onRenameFlow={renameFlow}
          onDeleteFlow={deleteFlow}
          onFavoriteFlow={favoriteFlow}
          onRemoveWorkflowFavorite={removeWorkflowFavorite}
          onReuseWorkflowFavorite={reuseWorkflowFavorite}
          onCollapse={() => setSidebarOpen(false)}
          onOpenSettings={() => setSettingsOpen(true)}
        />
      )}

      <section className="flex min-h-0 min-w-0 flex-1 flex-col bg-white dark:bg-neutral-950">
        <MainHeader
          workspaceName={activeWorkspace?.name ?? null}
          sessionId={activeSessionId}
          activeTab={activeTab}
          onTabChange={handleTabChange}
          sidebarOpen={sidebarOpen}
          onOpenSidebar={() => setSidebarOpen(true)}
          totalTokens={totals.tokens}
          totalCost={totals.cost}
          cacheHitRate={cacheHitRate}
          hiddenTabs={hiddenTabs}
          rulesPromptEnabled={rulesPromptEnabled}
          rulesPromptCount={rulesPromptInfo.count}
          rulesPromptUpdatedAt={rulesPromptInfo.updatedAt}
          onToggleRulesPrompt={() => setRulesPromptEnabled((current) => !current)}
        />

        {/* Sub-tab strip: 工作视图 | 原始数据 | 聚合数据 | 报告输出 */}
        <div className="flex h-9 shrink-0 items-center gap-1 border-b border-neutral-200 px-4 dark:border-neutral-800">
          {getSubTabsForTab(activeTab).filter((t) => isVisible(activeTab + ":" + t.id)).map((t) => {
            const active = t.id === activeSubTab;
            return (
              <button
                key={t.id}
                onClick={() => setActiveSubTab(t.id)}
                className={cn(
                  "inline-flex h-7 items-center rounded-md px-2.5 text-[12px] transition-colors",
                  active
                    ? "bg-neutral-100 font-medium text-neutral-900 dark:bg-neutral-800 dark:text-neutral-100"
                    : "text-neutral-500 hover:bg-neutral-50 hover:text-neutral-900 dark:text-neutral-400 dark:hover:bg-neutral-800/40 dark:hover:text-neutral-100",
                )}
              >
                {t.label}
                {t.id === "report" && !hasReportPath && (
                  <TriangleAlert className="ml-1 h-3.5 w-3.5 text-amber-500" strokeWidth={2} aria-label="未设置报告输出路径" />
                )}
                {t.id === "clean_data" && (
                  <span title="数据安全：可被 LLM 读取，不要放入明细数据">
                    <CircleAlert
                      className="ml-1 h-3.5 w-3.5 text-amber-500"
                      strokeWidth={2}
                      aria-label="数据安全：可被 LLM 读取，不要放入明细数据"
                    />
                  </span>
                )}
              </button>
            );
          })}
        </div>

        <div className="flex min-h-0 flex-1">
          <div className="flex min-h-0 min-w-0 flex-1 flex-col">
            {/* Explore tab */}
            {activeTab === "explore" && activeSubTab === "view" && showWorkflowPicker && (
              <WorkflowPickerPane onSelectWorkflow={onSelectWorkflow} />
            )}
            {activeTab === "explore" && activeSubTab === "view" && !showWorkflowPicker && (
              <ChatPane
                messages={messages}
                running={running}
                disabled={!activeSessionId}
                workspaceId={activeWorkspaceId}
                model={model}
                models={models}
                onModelChange={setModel}
                onSend={onSend}
                onStop={onStop}
                runtime={runtime}
                compacting={compacting}
                runtimeNotice={runtimeNotice}
                onCompact={() => void compactContext()}
                onRefreshRuntime={() => void refreshRuntime()}
                canPromoteToWorkflow={canPromoteToWorkflow}
                onPromoteToWorkflow={openPromote}
              />
            )}
            {activeTab === "explore" && activeSubTab === "draw_data" && (
              <FolderPathsPane scope={folderScope} folder="draw_data" />
            )}
            {activeTab === "explore" && activeSubTab === "clean_data" && (
              <FolderPathsPane scope={folderScope} folder="clean_data" />
            )}
            {activeTab === "explore" && activeSubTab === "report" && (
              <FolderPathsPane scope={folderScope} folder="report" onPathsChange={handleReportPathsChange} />
            )}
            {activeTab === "explore" && activeSubTab === "decision_tree" && (
              <DecisionTreePane scope={{ type: "session", sessionId: activeSessionId }} models={models} />
            )}
            {activeTab === "explore" && activeSubTab === "toc" && (
              <TocPane scope={{ type: "session", sessionId: activeSessionId }} models={models} />
            )}

            {/* Workflow (multi-agent) tab */}
            {activeTab === "multi" && activeSubTab === "view" && (
              <MultiAgentExecutionPane
                flow={activeFlow?.kind === "multi" ? activeFlow : null}
                models={models}
                model={model}
                onModelChange={setModel}
                rulesPromptEnabled={rulesPromptEnabled}
              />
            )}
            {activeTab === "multi" && activeSubTab === "draw_data" && (
              <FolderPathsPane scope={folderScope} folder="draw_data" />
            )}
            {activeTab === "multi" && activeSubTab === "clean_data" && (
              <FolderPathsPane scope={folderScope} folder="clean_data" />
            )}
            {activeTab === "multi" && activeSubTab === "report" && (
              <FolderPathsPane scope={folderScope} folder="report" onPathsChange={handleReportPathsChange} />
            )}
            {activeTab === "multi" && activeSubTab === "decision_tree" && (
              <DecisionTreePane scope={{ type: "flow", flow: activeFlow?.kind === "multi" ? activeFlow : null }} models={models} />
            )}
            {activeTab === "multi" && activeSubTab === "toc" && (
              <TocPane scope={{ type: "flow", flow: activeFlow?.kind === "multi" ? activeFlow : null }} models={models} />
            )}

            {/* Aggregate tab */}
            {activeTab === "aggregate" && activeSubTab === "view" && (
              <AggregatePane />
            )}
            {activeTab === "aggregate" && activeSubTab === "extraction" && (
              <ExtractionPane />
            )}
            {/* Rule Memory tab */}
            {activeTab === "rule_memory" && activeSubTab === "rules" && (
              <RulesPane workspaceId={activeWorkspaceId} onRulesChanged={() => void refreshRulesPromptInfo()} />
            )}
            {activeTab === "rule_memory" && activeSubTab === "indicators" && (
              <Placeholder
                icon={Gauge}
                title="指标体系"
                hint="指标体系管理，即将推出"
              />
            )}
            {activeTab === "rule_memory" && activeSubTab === "cases" && (
              <Placeholder
                icon={FolderKanban}
                title="分析案例库"
                hint="分析案例库管理，即将推出"
              />
            )}
            {activeTab === "rule_memory" && activeSubTab === "trace" && (
              <TracePane workspaceId={activeWorkspaceId} onRulesChanged={() => void refreshRulesPromptInfo()} />
            )}
            {activeTab === "rule_memory" && activeSubTab === "token_stats" && (
              <TokenStatsPane workspaceId={activeWorkspaceId} />
            )}
            {/* Xan数据库 tab */}
            {activeTab === "xan_db" && activeSubTab === "the-crowd" && (
              <Placeholder
                icon={Database}
                title="the-crowd"
                hint="人群数据库管理，即将推出"
              />
            )}
            {activeTab === "xan_db" && activeSubTab === "digital_life" && (
              <Placeholder
                icon={Database}
                title="数字生命体"
                hint="数字生命体数据库管理，即将推出"
              />
            )}
            {/* Research Lab tab */}
            {activeTab === "research_lab" && activeSubTab === "view" && (
              <ResearchLabPane
                workspaceId={activeWorkspaceId}
                flows={flows}
                model={model}
                models={models}
                onModelChange={setModel}
              />
            )}
            {activeTab === "research_lab" && activeSubTab === "skill" && (
              <Placeholder
                icon={BookOpen}
                title="skill"
                hint="Skill 评估模块，即将推出"
              />
            )}
            {activeTab === "research_lab" && activeSubTab === "tool" && (
              <Placeholder
                icon={Calculator}
                title="tool"
                hint="Tool 评估模块，即将推出"
              />
            )}
            {/* AnaX tab */}
            {activeTab === "anax" && activeSubTab === "view" && (
              <Placeholder
                icon={Search}
                title="AnaX"
                hint="AnaX 功能即将推出"
              />
            )}
          </div>

          {activeTab === "explore" && !showWorkflowPicker && activeSubTab === "view" &&
            (previewOpen ? (
              <PreviewPane sessionId={activeSessionId!} report={report} running={running} refreshKey={artifactRefreshKey} onCollapse={() => setPreviewOpen(false)} />
            ) : (
              <button
                onClick={() => setPreviewOpen(true)}
                title="展开预览"
                className="flex w-9 shrink-0 items-center justify-center border-l border-neutral-200 text-neutral-500 hover:bg-neutral-100 hover:text-neutral-900 dark:border-neutral-800 dark:text-neutral-400 dark:hover:bg-neutral-800 dark:hover:text-neutral-100"
              >
                <PanelRightOpen className="h-4 w-4" strokeWidth={1.75} />
              </button>
            ))}
        </div>
      </section>
      {promoteOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 px-4">
          <div className="w-full max-w-md rounded-xl border border-neutral-200 bg-white p-5 shadow-xl dark:border-neutral-700 dark:bg-neutral-900">
            <h2 className="text-[15px] font-semibold text-neutral-900 dark:text-neutral-100">沉淀为工作流</h2>
            <p className="mt-1 text-[12px] leading-5 text-neutral-500 dark:text-neutral-400">
              将已完成任务提炼为可重复执行的多智能体工作流。数据路径和报告目录会参数化，不会复制数据文件。
            </p>
            <label className="mt-4 block text-[12px] font-medium text-neutral-700 dark:text-neutral-300">
              工作流名称
              <input
                autoFocus
                value={promoteName}
                onChange={(event) => setPromoteName(event.target.value)}
                className="mt-1 h-9 w-full rounded-md border border-neutral-200 bg-transparent px-3 text-[13px] outline-none focus:border-neutral-400 dark:border-neutral-700 dark:text-neutral-100"
              />
            </label>
            <label className="mt-3 block text-[12px] font-medium text-neutral-700 dark:text-neutral-300">
              提取范围
              <select
                value={promoteScope}
                onChange={(event) => setPromoteScope(event.target.value as "latest_task" | "full_conversation")}
                className="mt-1 h-9 w-full rounded-md border border-neutral-200 bg-transparent px-3 text-[13px] outline-none focus:border-neutral-400 dark:border-neutral-700 dark:text-neutral-100"
              >
                <option value="latest_task">最近一次任务</option>
                <option value="full_conversation">完整对话</option>
              </select>
            </label>
            <div className="mt-3 rounded-md bg-neutral-50 px-3 py-2 text-[11.5px] leading-5 text-neutral-500 dark:bg-neutral-800/60 dark:text-neutral-400">
              路径策略：输入数据使用 {"{{input.data_path}}"}，报告目录使用 {"{{input.report_dir}}"}。
            </div>
            {promoteError && <p className="mt-3 text-[12px] text-rose-500">{promoteError}</p>}
            <div className="mt-5 flex justify-end gap-2">
              <button
                onClick={() => setPromoteOpen(false)}
                disabled={promoting}
                className="h-8 rounded-md px-3 text-[12px] text-neutral-500 hover:bg-neutral-100 disabled:opacity-50 dark:text-neutral-400 dark:hover:bg-neutral-800"
              >
                取消
              </button>
              <button
                onClick={() => void promoteToWorkflow()}
                disabled={!promoteName.trim() || promoting}
                className="h-8 rounded-md bg-neutral-900 px-3 text-[12px] font-medium text-white hover:bg-neutral-700 disabled:opacity-50 dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-white"
              >
                {promoting ? "正在创建..." : "创建工作流"}
              </button>
            </div>
          </div>
        </div>
      )}
      {settingsOpen && <SettingsModal onClose={() => setSettingsOpen(false)} hiddenTabs={hiddenTabs} toggleTab={toggleTab} />}
    </div>
  );
}
