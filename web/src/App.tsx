import { useCallback, useEffect, useRef, useState } from "react";
import { PanelRightOpen, Calculator, BookOpen, Database } from "lucide-react";
import { cn } from "@/lib/cn";
import { Sidebar } from "@/components/Sidebar";
import { ChatPane } from "@/components/ChatPane";
import { AgentFlowPane } from "@/components/AgentFlowPane";
import { FolderPathsPane } from "@/components/FolderPathsPane";
import { type UiMessage } from "@/components/MessageRow";
import { PreviewPane } from "@/components/PreviewPane";
import { MainHeader, type Tab } from "@/components/MainHeader";
import { WorkflowPickerPane, type WorkflowTemplate } from "@/components/WorkflowPickerPane";
import { Placeholder } from "@/components/Placeholder";
import { api } from "@/lib/api";
import { gateway } from "@/lib/ws";
import { asBlocks, textOf, type Flow, type FlowKind, type PiEvent, type PiModel, type ServerMessage, type Session, type StoredMessage, type Workspace } from "@/types";

let uid = 0;
const nextId = () => `m${++uid}`;

type SubTab = "view" | "draw_data" | "clean_data" | "report";

const SUB_TABS: { id: SubTab; label: string }[] = [
  { id: "view", label: "工作视图" },
  { id: "draw_data", label: "原始数据" },
  { id: "clean_data", label: "清洗数据" },
  { id: "report", label: "报告" },
];

export default function App() {
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [activeWorkspaceId, setActiveWorkspaceId] = useState<string | null>(null);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [flows, setFlows] = useState<Flow[]>([]);
  const [activeFlowId, setActiveFlowId] = useState<string | null>(null);

  const [messages, setMessages] = useState<UiMessage[]>([]);
  const [report, setReport] = useState("");
  const [running, setRunning] = useState(false);
  const [model, setModel] = useState("");
  const [models, setModels] = useState<PiModel[]>([]);
  const [totals, setTotals] = useState({ tokens: 0, cost: 0 });

  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [previewOpen, setPreviewOpen] = useState(true);
  const [activeTab, setActiveTab] = useState<Tab>("explore");
  const [activeSubTab, setActiveSubTab] = useState<SubTab>("view");
  const [showWorkflowPicker, setShowWorkflowPicker] = useState(true);

  // activeSessionId is read inside the gateway listener — keep a ref in sync.
  const activeRef = useRef<string | null>(null);
  activeRef.current = activeSessionId;

  // ---- bootstrap ----
  useEffect(() => {
    gateway.connect();
    api.listWorkspaces().then((ws) => {
      setWorkspaces(ws);
      if (ws[0]) setActiveWorkspaceId(ws[0].id);
    });
    api.listModels().then((list) => {
      setModels(list);
      if (list.length > 0) setModel((cur) => cur || list[0]!.id);
    });
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
      // Auto-select first single-agent flow if on single tab, first multi-agent if on multi tab
      const relevant = f.filter((fl) =>
        activeTab === "single" ? (fl.kind === "single" || !fl.kind) : fl.kind === "multi",
      );
      if (relevant[0]) setActiveFlowId(relevant[0].id);
      else if (f[0]) setActiveFlowId(f[0].id);
      else setActiveFlowId(null);
    });
  }, [activeWorkspaceId]);

  // ---- load history on session change ----
  useEffect(() => {
    if (!activeSessionId) {
      setMessages([]);
      setReport("");
      setTotals({ tokens: 0, cost: 0 });
      return;
    }
    api.listMessages(activeSessionId).then((rows: StoredMessage[]) => {
      const msgs: UiMessage[] = rows.map((r) => ({
        id: nextId(),
        role: r.role,
        content: asBlocks(r.content),
      }));
      setMessages(msgs);
      const lastAssistant = [...rows].reverse().find((r) => r.role === "assistant");
      setReport(lastAssistant ? textOf(lastAssistant.content) : "");
      setTotals(
        rows.reduce(
          (acc, r) => ({
            tokens: acc.tokens + (r.usage?.totalTokens ?? 0),
            cost: acc.cost + (r.usage?.cost.total ?? 0),
          }),
          { tokens: 0, cost: 0 },
        ),
      );
    });
  }, [activeSessionId]);

  // ---- gateway events ----
  useEffect(() => {
    return gateway.subscribe((msg: ServerMessage) => {
      if (msg.type === "flow_event") return;
      if ("flowId" in msg && msg.flowId) return;
      if ("sessionId" in msg && msg.sessionId !== activeRef.current) return;
      if (msg.type === "run_start") setRunning(true);
      else if (msg.type === "run_end") setRunning(false);
      else if (msg.type === "error") {
        setRunning(false);
        setMessages((m) => [...m, { id: nextId(), role: "assistant", content: [], error: msg.message }]);
      } else if (msg.type === "pi_event") {
        const ev = msg.event;
        if (ev.type === "message_end") {
          const { message: m } = ev as Extract<PiEvent, { type: "message_end" }>;
          if (m.role === "user") return;
          const blocks = asBlocks(m.content);
          if (m.errorMessage) {
            setMessages((cur) => [...cur, { id: nextId(), role: m.role, content: blocks, error: m.errorMessage }]);
          } else {
            setMessages((cur) => [...cur, { id: nextId(), role: m.role, content: blocks }]);
            const text = textOf(m.content);
            if (m.role === "assistant" && text) setReport(text);
          }
          if (m.usage) {
            setTotals((t) => ({
              tokens: t.tokens + m.usage!.totalTokens,
              cost: t.cost + m.usage!.cost.total,
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
    const prefix = kind === "multi" ? "多智能体" : "单智能体";
    const f = await api.createFlow(activeWorkspaceId, `${prefix} ${new Date().toLocaleString("zh-CN")}`, kind);
    setFlows((cur) => [f, ...cur]);
    setActiveFlowId(f.id);
    setActiveTab(kind === "multi" ? "multi" : "single");
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

  const onSelectFlow = useCallback((id: string) => {
    setActiveFlowId(id);
    const flow = flows.find((f) => f.id === id);
    setActiveTab(flow?.kind === "multi" ? "multi" : "single");
    setActiveSubTab("view");
  }, [flows]);

  const handleTabChange = useCallback((tab: Tab) => {
    if (tab === "explore" && activeTab === "explore") {
      setShowWorkflowPicker(true);
    }
    setActiveTab(tab);
    setActiveSubTab("view");
  }, [activeTab]);

  const onSend = useCallback(
    (text: string) => {
      if (!activeSessionId) return;
      setMessages((cur) => [...cur, { id: nextId(), role: "user", content: [{ type: "text", text }] }]);
      gateway.send({ type: "send", sessionId: activeSessionId, text, model: model || undefined });
    },
    [activeSessionId, model],
  );

  const activeWorkspace = workspaces.find((w) => w.id === activeWorkspaceId) ?? null;
  const activeFlow = flows.find((f) => f.id === activeFlowId) ?? null;

  const folderScope = activeTab === "explore"
    ? (activeSessionId ? { type: "session" as const, sessionId: activeSessionId } : activeWorkspaceId ? { type: "workspace" as const, workspaceId: activeWorkspaceId } : null)
    : (activeFlowId ? { type: "flow" as const, flowId: activeFlowId } : activeWorkspaceId ? { type: "workspace" as const, workspaceId: activeWorkspaceId } : null);



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
          onCollapse={() => setSidebarOpen(false)}
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
        />

        {/* Sub-tab strip: 工作视图 | 原始数据 | 清洗数据 | 报告 */}
        <div className="flex h-9 shrink-0 items-center gap-1 border-b border-neutral-200 px-4 dark:border-neutral-800">
          {SUB_TABS.map((t) => {
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
                model={model}
                models={models}
                onModelChange={setModel}
                onSend={onSend}
              />
            )}
            {activeTab === "explore" && activeSubTab === "draw_data" && (
              <FolderPathsPane scope={folderScope} folder="draw_data" />
            )}
            {activeTab === "explore" && activeSubTab === "clean_data" && (
              <FolderPathsPane scope={folderScope} folder="clean_data" />
            )}
            {activeTab === "explore" && activeSubTab === "report" && (
              <FolderPathsPane scope={folderScope} folder="report" />
            )}

            {/* Single-agent tab */}
            {activeTab === "single" && activeSubTab === "view" && (
              <AgentFlowPane
                flow={activeFlow?.kind === "single" || !activeFlow?.kind ? activeFlow : null}
                models={models}
                model={model}
                onModelChange={setModel}
              />
            )}
            {activeTab === "single" && activeSubTab === "draw_data" && (
              <FolderPathsPane scope={folderScope} folder="draw_data" />
            )}
            {activeTab === "single" && activeSubTab === "clean_data" && (
              <FolderPathsPane scope={folderScope} folder="clean_data" />
            )}
            {activeTab === "single" && activeSubTab === "report" && (
              <FolderPathsPane scope={folderScope} folder="report" />
            )}

            {/* Multi-agent tab */}
            {activeTab === "multi" && activeSubTab === "view" && (
              <AgentFlowPane
                flow={activeFlow?.kind === "multi" ? activeFlow : null}
                models={models}
                model={model}
                onModelChange={setModel}
              />
            )}
            {activeTab === "multi" && activeSubTab === "draw_data" && (
              <FolderPathsPane scope={folderScope} folder="draw_data" />
            )}
            {activeTab === "multi" && activeSubTab === "clean_data" && (
              <FolderPathsPane scope={folderScope} folder="clean_data" />
            )}
            {activeTab === "multi" && activeSubTab === "report" && (
              <FolderPathsPane scope={folderScope} folder="report" />
            )}

            {/* Aggregate tab */}
            {activeTab === "aggregate" && activeSubTab === "view" && (
              <Placeholder
                icon={Calculator}
                title="聚合计算"
                hint="跨工作区数据聚合与计算，即将推出"
              />
            )}
            {activeTab === "aggregate" && activeSubTab === "draw_data" && (
              <FolderPathsPane scope={folderScope} folder="draw_data" />
            )}
            {activeTab === "aggregate" && activeSubTab === "clean_data" && (
              <FolderPathsPane scope={folderScope} folder="clean_data" />
            )}
            {activeTab === "aggregate" && activeSubTab === "report" && (
              <FolderPathsPane scope={folderScope} folder="report" />
            )}
            {/* Rule Memory tab */}
            {activeTab === "rule_memory" && activeSubTab === "view" && (
              <Placeholder
                icon={BookOpen}
                title="规则记忆"
                hint="规则管理与记忆检索，即将推出"
              />
            )}
            {activeTab === "rule_memory" && activeSubTab === "draw_data" && (
              <FolderPathsPane scope={folderScope} folder="draw_data" />
            )}
            {activeTab === "rule_memory" && activeSubTab === "clean_data" && (
              <FolderPathsPane scope={folderScope} folder="clean_data" />
            )}
            {activeTab === "rule_memory" && activeSubTab === "report" && (
              <FolderPathsPane scope={folderScope} folder="report" />
            )}
            {/* Xan数据库 tab */}
            {activeTab === "xan_db" && activeSubTab === "view" && (
              <Placeholder
                icon={Database}
                title="Xan数据库"
                hint="Xan 数据库管理与查询，即将推出"
              />
            )}
            {activeTab === "xan_db" && activeSubTab === "draw_data" && (
              <FolderPathsPane scope={folderScope} folder="draw_data" />
            )}
            {activeTab === "xan_db" && activeSubTab === "clean_data" && (
              <FolderPathsPane scope={folderScope} folder="clean_data" />
            )}
            {activeTab === "xan_db" && activeSubTab === "report" && (
              <FolderPathsPane scope={folderScope} folder="report" />
            )}
          </div>

          {activeTab === "explore" && !showWorkflowPicker && activeSubTab === "view" &&
            (previewOpen ? (
              <PreviewPane report={report} onCollapse={() => setPreviewOpen(false)} />
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
    </div>
  );
}
