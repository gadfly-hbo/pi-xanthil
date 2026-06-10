import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { PanelRightOpen, CircleAlert, TriangleAlert } from "lucide-react";
import { cn } from "@/lib/cn";
import { Sidebar } from "@/components/Sidebar";
import { type UiMessage } from "@/components/MessageRow";
import { PreviewPane } from "@/components/PreviewPane";
import { CleanDataDocsColumn } from "@/components/CleanDataDocsColumn";
import { MainHeader, type Tab, TABS } from "@/components/MainHeader";
import { SettingsModal } from "@/components/SettingsModal";
import { useTabVisibility } from "@/lib/useTabVisibility";
import { getSubTabsForTab, LAB_ANAX_SUB_TABS, LAB_ANAX_SUB_IDS, type SubTab } from "@/lib/constants";
import { DataTabs } from "@/tabs/DataTabs";
import { EngineTabs } from "@/tabs/EngineTabs";
import { VizTabs } from "@/tabs/VizTabs";
import type { TabContext } from "@/tabs/types";

import { api } from "@/lib/api";
import { gateway } from "@/lib/ws";
import { asBlocks, textOf, type ExploreSeed, type Flow, type FlowKind, type PiEvent, type PiModel, type ServerMessage, type Session, type SessionRuntime, type StoredMessage, type WorkflowFavorite, type Workspace, type WorkspacePath } from "@/types";

let uid = 0;
const nextId = () => `m${++uid}`;

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
  const [todayCacheHitRate, setTodayCacheHitRate] = useState(0);
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
  // One-way seed: 业务需求 → 数据探索 (field-name hints only, never data).
  const [exploreSeed, setExploreSeed] = useState<ExploreSeed | null>(null);
  const [pendingRestoreRunId, setPendingRestoreRunId] = useState<string | null>(null);
  const [hasReportPath, setHasReportPath] = useState(false);
  const [promoteOpen, setPromoteOpen] = useState(false);
  const [promoteName, setPromoteName] = useState("");
  const [promoteScope, setPromoteScope] = useState<"latest_task" | "full_conversation">("latest_task");
  const [promoting, setPromoting] = useState(false);
  const [promoteError, setPromoteError] = useState("");
  const [distillOpen, setDistillOpen] = useState(false);
  const [distillScope, setDistillScope] = useState<"latest_task" | "full_conversation">("latest_task");
  const [distilling, setDistilling] = useState(false);
  const [distillContent, setDistillContent] = useState("");
  const [distillName, setDistillName] = useState("");
  const [distillError, setDistillError] = useState("");
  const [distillSaving, setDistillSaving] = useState(false);
  const [distillSavedPath, setDistillSavedPath] = useState("");
  const [rulesPromptEnabled, setRulesPromptEnabled] = useState(false);
  const [rulesPromptInfo, setRulesPromptInfo] = useState<{ count: number; updatedAt: number | null }>({ count: 0, updatedAt: null });

  // activeSessionId is read inside the gateway listener — keep a ref in sync.
  const activeRef = useRef<string | null>(null);
  activeRef.current = activeSessionId;

  // 侧边栏「非活动自动收起」：鼠标离开延时收起，拖拽改宽（userSelect=none）时不收。
  const collapseTimer = useRef<number | undefined>(undefined);

  const refreshRulesPromptInfo = useCallback(async () => {
    if (!activeWorkspaceId) {
      setRulesPromptInfo({ count: 0, updatedAt: null });
      setRulesPromptEnabled(false);
      return;
    }
    try {
      // The injectRulesPrompt toggle controls combined memory: rules + 指标体系 + 业务环境 + 案例库 + 知识图谱.
      // Sum all five so the toggle isn't gated to zero when only one source has content.
      const [rules, standards, businessContext, cases, kg] = await Promise.all([
        api.getRulesPrompt(activeWorkspaceId),
        api.getStandardsPrompt(activeWorkspaceId),
        api.getBusinessContextPrompt(activeWorkspaceId),
        api.getCasesPrompt(activeWorkspaceId),
        api.getKgPrompt(activeWorkspaceId),
      ]);
      const count = rules.count + standards.count + businessContext.count + cases.count + kg.count;
      const updatedAt = Math.max(rules.updatedAt ?? 0, standards.updatedAt ?? 0, businessContext.updatedAt ?? 0, cases.updatedAt ?? 0, kg.updatedAt ?? 0) || null;
      setRulesPromptInfo({ count, updatedAt });
      if (count === 0) setRulesPromptEnabled(false);
    } catch {
      setRulesPromptInfo({ count: 0, updatedAt: null });
      setRulesPromptEnabled(false);
    }
  }, [activeWorkspaceId]);

  const refreshTokenTotals = useCallback(async () => {
    if (!activeWorkspaceId) {
      setTotals({ tokens: 0, cost: 0, input: 0, cacheRead: 0, cacheWrite: 0 });
      setTodayCacheHitRate(0);
      return;
    }
    try {
      const [stats, today] = await Promise.all([
        api.getWorkspaceTokenStats(activeWorkspaceId),
        api.getWorkspaceTodayTokenStats(activeWorkspaceId),
      ]);
      setTotals({
        tokens: stats.inputTokens + stats.outputTokens + stats.cacheReadTokens + stats.cacheWriteTokens,
        cost: stats.totalCost,
        input: stats.inputTokens,
        cacheRead: stats.cacheReadTokens,
        cacheWrite: stats.cacheWriteTokens,
      });
      setTodayCacheHitRate(today.cacheHitRate);
    } catch {
      setTotals({ tokens: 0, cost: 0, input: 0, cacheRead: 0, cacheWrite: 0 });
      setTodayCacheHitRate(0);
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

  useEffect(() => {
    void refreshTokenTotals();
    const timer = window.setInterval(() => void refreshTokenTotals(), 10_000);
    return () => window.clearInterval(timer);
  }, [refreshTokenTotals]);

  // ---- load sessions on workspace change ----
  useEffect(() => {
    if (!activeWorkspaceId) return;
    api.listSessions(activeWorkspaceId).then((s) => {
      setSessions(s);
      setActiveSessionId(s[0]?.id ?? null);
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
      void refreshTokenTotals();
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
        void refreshTokenTotals();
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
          if (m.usage) void refreshTokenTotals();
        }
      }
    });
  }, [refreshTokenTotals]);

  // ---- actions ----
  const newWorkspace = useCallback(async (name: string) => {
    const ws = await api.createWorkspace(name);
    setWorkspaces((cur) => [ws, ...cur]);
    setActiveWorkspaceId(ws.id);
  }, []);

  const newSession = useCallback(async () => {
    if (!activeWorkspaceId) return;
    const s = await api.createSession(activeWorkspaceId, "新会话");
    setSessions((cur) => [s, ...cur]);
    setActiveSessionId(s.id);
    setActiveTab("explore");
    setActiveSubTab("view");
  }, [activeWorkspaceId]);

  const handleSelectSession = useCallback((id: string) => {
    setActiveSessionId(id);
    setActiveTab("explore");
    setActiveSubTab("view");
  }, []);

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
    setActiveTab(tab);
    setActiveSubTab(tab === "rule_memory" ? "rules" : tab === "xan_db" ? "the-crowd" : tab === "onto_xanthil" ? "onto_objects" : "view");
  }, []);

  const handleRequestRestoreRun = useCallback((runId: string) => {
    setPendingRestoreRunId(runId);
    setActiveTab("research_lab");
    setActiveSubTab("model");
  }, []);

  const handleRestoreConsumed = useCallback(() => {
    setPendingRestoreRunId(null);
  }, []);

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
    (text: string, skillPaths?: string[], businessRequirementContext?: { pathId: number; markdownPath: string; jsonPath?: string }) => {
      if (!activeSessionId) return;
      setMessages((cur) => [...cur, { id: nextId(), role: "user", content: [{ type: "text", text }] }]);
      gateway.send({ type: "send", sessionId: activeSessionId, text, model: model || undefined, skillPaths, injectRulesPrompt: rulesPromptEnabled, businessRequirementContext });
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

  const openDistill = useCallback(() => {
    if (!activeSession) return;
    setDistillScope("latest_task");
    setDistillContent("");
    setDistillName("");
    setDistillError("");
    setDistillSavedPath("");
    setDistillOpen(true);
  }, [activeSession]);

  const runDistill = useCallback(async () => {
    if (!activeSession || distilling) return;
    setDistilling(true);
    setDistillError("");
    setDistillSavedPath("");
    try {
      const result = await api.distillSkill(activeSession.id, {
        scope: distillScope,
        model: model || undefined,
      });
      setDistillContent(result.content);
      setDistillName(result.name);
    } catch (err) {
      setDistillError(String(err));
    } finally {
      setDistilling(false);
    }
  }, [activeSession, distillScope, distilling, model]);

  const saveDistilledSkill = useCallback(async () => {
    if (!activeSession || !distillContent.trim() || !distillName.trim() || distillSaving) return;
    setDistillSaving(true);
    setDistillError("");
    try {
      const result = await api.saveSkill(activeSession.id, {
        name: distillName.trim(),
        content: distillContent,
      });
      setDistillSavedPath(result.path);
    } catch (err) {
      setDistillError(String(err));
    } finally {
      setDistillSaving(false);
    }
  }, [activeSession, distillContent, distillName, distillSaving]);

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

  const tabCtx: TabContext = {
    activeTab, activeSubTab, setActiveSubTab,
    activeWorkspaceId, activeSessionId, folderScope,
    model, models, setModel,
    messages, running, runtime, compacting, runtimeNotice,
    onSend, onStop, compactContext, refreshRuntime,
    canPromoteToWorkflow, openPromote, openDistill,
    exploreSeed, setExploreSeed,
    handleReportPathsChange, setArtifactRefreshKey, refreshRulesPromptInfo,
    activeFlow, flows, rulesPromptEnabled,
    pendingRestoreRunId, handleRestoreConsumed, handleRequestRestoreRun,
  };

  return (
    <div className="flex h-screen overflow-hidden bg-background text-foreground">
      {sidebarOpen && (
        <>
          <button
            type="button"
            aria-label="关闭侧栏"
            onClick={() => setSidebarOpen(false)}
            className="fixed inset-0 z-40 bg-black/30 md:hidden"
          />
          <div className="fixed inset-y-0 left-0 z-50 w-0 max-w-[85vw] md:hidden">
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
          </div>
          <div
            className="hidden md:block"
            onMouseEnter={() => { if (collapseTimer.current) window.clearTimeout(collapseTimer.current); }}
            onMouseLeave={() => {
              collapseTimer.current = window.setTimeout(() => {
                if (document.body.style.userSelect !== "none") setSidebarOpen(false);
              }, 300);
            }}
          >
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
          </div>
        </>
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
          cacheHitRate={todayCacheHitRate}
          hiddenTabs={hiddenTabs}
          rulesPromptEnabled={rulesPromptEnabled}
          rulesPromptCount={rulesPromptInfo.count}
          rulesPromptUpdatedAt={rulesPromptInfo.updatedAt}
          onToggleRulesPrompt={() => setRulesPromptEnabled((current) => !current)}
          onOpenTokenStats={() => {
            setActiveTab("rule_memory");
            setActiveSubTab("token_stats");
          }}
          onOpenQuickNotes={() => {
            setActiveTab("rule_memory");
            setActiveSubTab("quick_notes");
          }}
        />

        {/* Sub-tab strip: 工作视图 | 原始数据 | 聚合数据 | 报告输出。实验室顶部 = workflow/…/AnaX；AnaX 子项见下方左竖栏。 */}
        <div className="flex h-9 shrink-0 items-center gap-1 border-b border-neutral-200 px-4 dark:border-neutral-800">
          {getSubTabsForTab(activeTab).filter((t) => isVisible(activeTab + ":" + t.id)).map((t) => {
            // 实验室的 AnaX 顶部 tab（id=anax_view）在其任一二级子项激活时保持高亮。
            const active = t.id === activeSubTab
              || (activeTab === "research_lab" && t.id === "anax_view" && LAB_ANAX_SUB_IDS.has(activeSubTab));
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
          {/* 实验室·AnaX：仅当激活 AnaX 顶部 tab 时，其二级 tab 以左侧竖栏呈现 */}
          {activeTab === "research_lab" && LAB_ANAX_SUB_IDS.has(activeSubTab) && (
            <nav className="scrollbar-thin flex w-40 shrink-0 flex-col gap-0.5 overflow-y-auto border-r border-neutral-200 p-2 dark:border-neutral-800">
              {LAB_ANAX_SUB_TABS.map((t) => {
                const active = t.id === activeSubTab;
                return (
                  <button
                    key={t.id}
                    onClick={() => setActiveSubTab(t.id)}
                    className={cn(
                      "rounded-md px-2.5 py-1.5 text-left text-[12.5px] transition-colors",
                      active
                        ? "bg-neutral-100 font-medium text-neutral-900 dark:bg-neutral-800 dark:text-neutral-100"
                        : "text-neutral-500 hover:bg-neutral-50 hover:text-neutral-900 dark:text-neutral-400 dark:hover:bg-neutral-800/40 dark:hover:text-neutral-100",
                    )}
                  >
                    {t.label}
                  </button>
                );
              })}
            </nav>
          )}
          {/* 探索·工作视图：左侧「聚合数据」只读文档竖栏（红线域，纯读取+复制） */}
          {activeTab === "explore" && activeSubTab === "view" && (
            <CleanDataDocsColumn scope={folderScope} />
          )}
          <div className="flex min-h-0 min-w-0 flex-1 flex-col">
            <DataTabs ctx={tabCtx} />
            <EngineTabs ctx={tabCtx} />
            <VizTabs ctx={tabCtx} />
          </div>

          {activeTab === "explore" && activeSessionId && activeSubTab === "view" &&
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
      {distillOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 px-4">
          <div className="flex max-h-[88vh] w-full max-w-2xl flex-col rounded-xl border border-neutral-200 bg-white p-5 shadow-xl dark:border-neutral-700 dark:bg-neutral-900">
            <h2 className="text-[15px] font-semibold text-neutral-900 dark:text-neutral-100">沉淀 skill</h2>
            <p className="mt-1 text-[12px] leading-5 text-neutral-500 dark:text-neutral-400">
              参照 skill 提炼方法（案例解构 → 抽象提炼 → 写作 SKILL.md），把本次任务蒸馏为可复用 Skill。具体数字与业务背景会被参数化为 {"{变量}"}。
            </p>
            <div className="mt-4 flex items-end gap-3">
              <label className="block flex-1 text-[12px] font-medium text-neutral-700 dark:text-neutral-300">
                提取范围
                <select
                  value={distillScope}
                  onChange={(event) => setDistillScope(event.target.value as "latest_task" | "full_conversation")}
                  disabled={distilling}
                  className="mt-1 h-9 w-full rounded-md border border-neutral-200 bg-transparent px-3 text-[13px] outline-none focus:border-neutral-400 disabled:opacity-50 dark:border-neutral-700 dark:text-neutral-100"
                >
                  <option value="latest_task">最近一次任务</option>
                  <option value="full_conversation">完整对话</option>
                </select>
              </label>
              <button
                onClick={() => void runDistill()}
                disabled={distilling}
                className="h-9 rounded-md border border-neutral-200 px-3 text-[12px] font-medium text-neutral-700 hover:bg-neutral-100 disabled:opacity-50 dark:border-neutral-700 dark:text-neutral-200 dark:hover:bg-neutral-800"
              >
                {distilling ? "正在提炼..." : distillContent ? "重新提炼" : "开始提炼"}
              </button>
            </div>
            {(distillContent || distilling) && (
              <div className="mt-4 flex min-h-0 flex-1 flex-col">
                <label className="block text-[12px] font-medium text-neutral-700 dark:text-neutral-300">
                  Skill 名称（英文 kebab-case）
                  <input
                    value={distillName}
                    onChange={(event) => setDistillName(event.target.value)}
                    placeholder="例如 sales-anomaly-analysis"
                    className="mt-1 h-9 w-full rounded-md border border-neutral-200 bg-transparent px-3 text-[13px] outline-none focus:border-neutral-400 dark:border-neutral-700 dark:text-neutral-100"
                  />
                </label>
                <label className="mt-3 block flex min-h-0 flex-1 flex-col text-[12px] font-medium text-neutral-700 dark:text-neutral-300">
                  SKILL.md 预览（可编辑）
                  <textarea
                    value={distillContent}
                    onChange={(event) => setDistillContent(event.target.value)}
                    className="scrollbar-thin mt-1 min-h-[240px] w-full flex-1 resize-none rounded-md border border-neutral-200 bg-neutral-50 px-3 py-2 font-mono text-[12px] leading-5 text-neutral-800 outline-none focus:border-neutral-400 dark:border-neutral-700 dark:bg-neutral-800/60 dark:text-neutral-100"
                  />
                </label>
              </div>
            )}
            {distillError && <p className="mt-3 text-[12px] text-rose-500">{distillError}</p>}
            {distillSavedPath && (
              <p className="mt-3 text-[12px] text-emerald-600 dark:text-emerald-400">
                已保存到 {distillSavedPath}
              </p>
            )}
            <div className="mt-5 flex justify-end gap-2">
              <button
                onClick={() => setDistillOpen(false)}
                disabled={distilling || distillSaving}
                className="h-8 rounded-md px-3 text-[12px] text-neutral-500 hover:bg-neutral-100 disabled:opacity-50 dark:text-neutral-400 dark:hover:bg-neutral-800"
              >
                {distillSavedPath ? "关闭" : "取消"}
              </button>
              <button
                onClick={() => void saveDistilledSkill()}
                disabled={!distillContent.trim() || !distillName.trim() || distilling || distillSaving || !!distillSavedPath}
                className="h-8 rounded-md bg-neutral-900 px-3 text-[12px] font-medium text-white hover:bg-neutral-700 disabled:opacity-50 dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-white"
              >
                {distillSaving ? "正在保存..." : "保存 skill"}
              </button>
            </div>
          </div>
        </div>
      )}
      {settingsOpen && <SettingsModal onClose={() => setSettingsOpen(false)} hiddenTabs={hiddenTabs} toggleTab={toggleTab} />}
    </div>
  );
}
