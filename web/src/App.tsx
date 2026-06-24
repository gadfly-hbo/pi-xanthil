import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { PanelRightOpen, CircleAlert, TriangleAlert } from "lucide-react";
import { cn } from "@/lib/cn";
import { Sidebar } from "@/components/Sidebar";
import { type UiMessage } from "@/components/MessageRow";
import { PreviewPane } from "@/components/PreviewPane";
import { CleanDataDocsColumn } from "@/components/CleanDataDocsColumn";
import { FlowListColumn } from "@/components/FlowListColumn";
import { MainHeader, type Tab, TABS } from "@/components/MainHeader";
import { SettingsModal } from "@/components/SettingsModal";
import { useTabVisibility } from "@/lib/useTabVisibility";
import { getSubTabsForTab, ONTO_SUB_TABS, LAB_SUB_TABS, LAB_SUB_IDS, ZHUANTI_SIDEBAR_TABS, ZHUANTI_SIDEBAR_IDS, type SubTab } from "@/lib/constants";
import { DataTabs } from "@/tabs/DataTabs";
import { EngineTabs } from "@/tabs/EngineTabs";
import { HealthTabs } from "@/tabs/HealthTabs";
import { VizTabs } from "@/tabs/VizTabs";
import type { TabContext } from "@/tabs/types";
import type { WorkflowTemplate } from "@/components/WorkflowTemplateLibraryPane";

import { api } from "@/lib/api";
import { gateway } from "@/lib/ws";
import { asBlocks, textOf, type ContentBlock, type ExploreSeed, type Flow, type FlowKind, type PiEvent, type PiModel, type ServerMessage, type Session, type SessionRuntime, type StoredMessage, type Workspace, type WorkspacePath } from "@/types";

type ZhuantiTask = { flow: Flow; session: Session };
type MemoryPromptInfo = {
  count: number;
  updatedAt: number | null;
  details: string[];
};

let uid = 0;
const nextId = () => `m${++uid}`;

const DEFAULT_CHAT_MODEL = "minimax-cn/MiniMax-M3";
const STREAM_END_ERROR = "Stream ended without finish_reason";
const SESSION_RUNNING_ERROR = "session already has a running turn";

function displayError(error: string, consecutiveStreamErrors: number): string {
  if (error !== STREAM_END_ERROR || consecutiveStreamErrors < 2) return error;
  return `${error}\n\n连续出现流式响应中断。请切换到 MiniMax-M3 后重试；生成长报告时应分块写入文件。`;
}

function toolUseId(block: ContentBlock): string | undefined {
  if (block.type === "tool_use") return typeof block.id === "string" ? block.id : undefined;
  if (block.type === "tool_result") return typeof block.tool_use_id === "string" ? block.tool_use_id : undefined;
  return undefined;
}

function collectToolUseIds(messages: UiMessage[]): Set<string> {
  const ids = new Set<string>();
  for (const message of messages) {
    for (const block of message.content) {
      const id = toolUseId(block);
      if (id) ids.add(id);
    }
  }
  return ids;
}

function filterDuplicateToolBlocks(blocks: ContentBlock[], messages: UiMessage[]): ContentBlock[] {
  const existingIds = collectToolUseIds(messages);
  return blocks.filter((block) => {
    if (block.type !== "tool_use" && block.type !== "tool_result") return true;
    const id = toolUseId(block);
    return !id || !existingIds.has(id);
  });
}

function toolCallBlock(event: Extract<PiEvent, { type: "tool_call" }>): Extract<ContentBlock, { type: "tool_use" }> {
  return {
    type: "tool_use",
    id: event.id ?? event.tool_use_id,
    name: event.name,
    input: event.input,
    status: "running",
  };
}

function toolResultBlock(event: Extract<PiEvent, { type: "tool_result" }>): Extract<ContentBlock, { type: "tool_result" }> {
  return {
    type: "tool_result",
    tool_use_id: event.tool_use_id ?? event.id,
    name: event.name,
    content: event.content,
    is_error: event.is_error,
  };
}

function appendToolCall(messages: UiMessage[], block: Extract<ContentBlock, { type: "tool_use" }>): UiMessage[] {
  if (block.id && collectToolUseIds(messages).has(block.id)) return messages;
  return [...messages, { id: nextId(), role: "assistant", content: [block] }];
}

function appendToolResult(messages: UiMessage[], block: Extract<ContentBlock, { type: "tool_result" }>): UiMessage[] {
  const toolUseId = block.tool_use_id;
  if (!toolUseId) return [...messages, { id: nextId(), role: "tool", content: [block] }];
  let matched = false;
  const next = messages.map((message) => {
    let changed = false;
    const content: ContentBlock[] = [];
    for (const current of message.content) {
      if (current.type === "tool_result" && current.tool_use_id === toolUseId) matched = true;
      if (current.type === "tool_use" && current.id === toolUseId) {
        matched = true;
        changed = true;
        content.push({ ...current, status: block.is_error ? "error" : "completed" });
        if (!message.content.some((item) => item.type === "tool_result" && item.tool_use_id === toolUseId)) {
          content.push(block);
        }
      } else {
        content.push(current);
      }
    }
    return changed ? { ...message, content } : message;
  });
  return matched ? next : [...messages, { id: nextId(), role: "tool", content: [block] }];
}

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
  const [zhuantiChatFlowId, setZhuantiChatFlowId] = useState<string | null>(null);
  const [zhuantiChatSessionId, setZhuantiChatSessionId] = useState<string | null>(null);
  const [zhuantiTasks, setZhuantiTasks] = useState<ZhuantiTask[]>([]);
  const [zhuantiChatMessages, setZhuantiChatMessages] = useState<UiMessage[]>([]);
  const [zhuantiChatRunning, setZhuantiChatRunning] = useState(false);
  const [zhuantiChatRuntime, setZhuantiChatRuntime] = useState<SessionRuntime | null>(null);
  const [zhuantiChatCompacting, setZhuantiChatCompacting] = useState(false);
  const [zhuantiChatRuntimeNotice, setZhuantiChatRuntimeNotice] = useState("");
  const [zhuantiSeed, setZhuantiSeed] = useState<{ task: string } | null>(null);
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
  const [hasReportPath, setHasReportPath] = useState(false);
  const [rulesPromptEnabled, setRulesPromptEnabled] = useState(false);
  const [rulesPromptInfo, setRulesPromptInfo] = useState<MemoryPromptInfo>({ count: 0, updatedAt: null, details: [] });
  const [knowledgePromptEnabled, setKnowledgePromptEnabled] = useState(false);
  const [knowledgePromptInfo, setKnowledgePromptInfo] = useState<{ count: number; updatedAt: number | null }>({ count: 0, updatedAt: null });

  // activeSessionId is read inside the gateway listener — keep a ref in sync.
  const activeRef = useRef<string | null>(null);
  activeRef.current = activeSessionId;
  const zhuantiChatRef = useRef<string | null>(null);
  zhuantiChatRef.current = zhuantiChatSessionId;

  const selectZhuantiTaskData = useCallback((task: ZhuantiTask) => {
    setZhuantiChatFlowId(task.flow.id);
    setZhuantiChatSessionId(task.session.id);
    setFlows((current) => [task.flow, ...current.filter((item) => item.id !== task.flow.id)]);
  }, []);

  const refreshRulesPromptInfo = useCallback(async () => {
    if (!activeWorkspaceId) {
      setRulesPromptInfo({ count: 0, updatedAt: null, details: [] });
      setRulesPromptEnabled(false);
      return;
    }
    try {
      // The injectRulesPrompt protocol field now controls combined memory injection:
      // unified memory_items + legacy rules + business context + standards + cases + knowledge graph.
      const [memoryPreview, rules, standards, businessContext, cases, kg] = await Promise.all([
        api.previewMemoryPrompt(activeWorkspaceId, { targetScope: "chat" }),
        api.getRulesPrompt(activeWorkspaceId),
        api.getStandardsPrompt(activeWorkspaceId),
        api.getBusinessContextPrompt(activeWorkspaceId),
        api.getCasesPrompt(activeWorkspaceId),
        api.getKgPrompt(activeWorkspaceId),
      ]);
      const details = [
        memoryPreview.itemCount > 0 ? `统一记忆 ${memoryPreview.itemCount}` : "",
        memoryPreview.factCount > 0 ? `fact ${memoryPreview.factCount}` : "",
        rules.count > 0 ? `旧规则 ${rules.count}` : "",
        businessContext.count > 0 ? `业务环境 ${businessContext.count}` : "",
        standards.count > 0 ? `指标体系 ${standards.count}` : "",
        cases.count > 0 ? `案例 ${cases.count}` : "",
        kg.count > 0 ? `知识图谱报告 ${kg.reportCount}${kg.edgeCount ? ` / 关联 ${kg.edgeCount}` : ""}` : "",
      ].filter(Boolean);
      const count = memoryPreview.itemCount + memoryPreview.factCount + rules.count + standards.count + businessContext.count + cases.count + kg.count;
      const updatedAt = Math.max(rules.updatedAt ?? 0, standards.updatedAt ?? 0, businessContext.updatedAt ?? 0, cases.updatedAt ?? 0, kg.updatedAt ?? 0) || null;
      setRulesPromptInfo({ count, updatedAt, details });
      if (count === 0) setRulesPromptEnabled(false);
    } catch {
      setRulesPromptInfo({ count: 0, updatedAt: null, details: [] });
      setRulesPromptEnabled(false);
    }
  }, [activeWorkspaceId]);

  const refreshKnowledgePromptInfo = useCallback(async () => {
    if (!activeWorkspaceId) {
      setKnowledgePromptInfo({ count: 0, updatedAt: null });
      setKnowledgePromptEnabled(false);
      return;
    }
    try {
      // X-POOL2: chip 计数口径须与 listKnowledgeChunksForRetrieval 注入候选一致——
      // 本 ws 私有(scope!=='global') ∪ 已启用的 global 文档；未启用 global 不计入。
      const [docs, enablements] = await Promise.all([
        api.listKnowledgeDocs(activeWorkspaceId),
        api.listMemoryEnablements(activeWorkspaceId, "knowledge"),
      ]);
      const enabledGlobal = new Set(enablements.filter((e) => e.enabled).map((e) => e.itemId));
      const injectable = docs.filter((d) => d.scope !== "global" || enabledGlobal.has(d.id));
      setKnowledgePromptInfo({
        count: injectable.length,
        updatedAt: injectable.reduce<number | null>((latest, doc) => latest === null ? doc.updatedAt : Math.max(latest, doc.updatedAt), null),
      });
      if (injectable.length === 0) setKnowledgePromptEnabled(false);
    } catch {
      setKnowledgePromptInfo({ count: 0, updatedAt: null });
      setKnowledgePromptEnabled(false);
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
  const refreshModels = useCallback(
    () => api.listModels().then((list) => {
      setModels(list);
      return list;
    }),
    [],
  );

  useEffect(() => {
    gateway.connect();
    api.listWorkspaces().then((ws) => {
      setWorkspaces(ws);
      if (ws[0]) setActiveWorkspaceId(ws[0].id);
    });
    void refreshModels().then((list) => {
      const defaultModel = list.find((item) => item.id === DEFAULT_CHAT_MODEL)
        ?? list.find((item) => item.isDefault)
        ?? list[0];
      if (defaultModel) setModel((cur) => cur || defaultModel.id);
    });
  }, [refreshModels]);

  useEffect(() => {
    void refreshTokenTotals();
    const timer = window.setInterval(() => void refreshTokenTotals(), 10_000);
    return () => window.clearInterval(timer);
  }, [refreshTokenTotals]);

  // ---- load sessions on workspace change ----
  useEffect(() => {
    if (!activeWorkspaceId) return;
    setZhuantiChatFlowId(null);
    setZhuantiChatSessionId(null);
    setZhuantiChatMessages([]);
    setZhuantiChatRuntime(null);
    setZhuantiChatRuntimeNotice("");
    setZhuantiChatRunning(false);
    setZhuantiTasks([]);
    api.listSessions(activeWorkspaceId).then((s) => {
      setSessions(s);
      setActiveSessionId(s[0]?.id ?? null);
    });
    api.listFlows(activeWorkspaceId).then((f) => {
      setFlows(f);
      const relevant = f.filter((fl) => fl.kind === "multi");
      setActiveFlowId(relevant[0]?.id ?? null);
    });
    api.listZhuantiTasks(activeWorkspaceId).then((tasks) => {
      setZhuantiTasks(tasks);
      setFlows((current) => {
        const byId = new Map(current.map((flow) => [flow.id, flow]));
        for (const task of tasks) byId.set(task.flow.id, task.flow);
        return Array.from(byId.values()).sort((a, b) => b.updatedAt - a.updatedAt);
      });
    }).catch(() => setZhuantiTasks([]));
    void refreshRulesPromptInfo();
    void refreshKnowledgePromptInfo();
  }, [activeWorkspaceId, refreshKnowledgePromptInfo, refreshRulesPromptInfo]);

  useEffect(() => {
    let cancelled = false;
    if (!activeWorkspaceId || activeTab !== "zhuanti") return;
    api.listZhuantiTasks(activeWorkspaceId)
      .then(async (tasks) => {
        if (cancelled) return;
        const nextTasks = tasks.length > 0 ? tasks : [await api.newZhuantiTask(activeWorkspaceId, "专题分析")];
        if (cancelled) return;
        setZhuantiTasks(nextTasks);
        const latest = nextTasks[0];
        if (latest) selectZhuantiTaskData(latest);
      })
      .catch((err) => {
        if (!cancelled) {
          setZhuantiChatMessages((current) => [...current, { id: nextId(), role: "assistant", content: [], error: String(err) }]);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [activeWorkspaceId, activeTab, selectZhuantiTaskData]);

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

  useEffect(() => {
    let cancelled = false;
    if (!zhuantiChatSessionId) {
      setZhuantiChatMessages([]);
      setZhuantiChatRuntime(null);
      setZhuantiChatRuntimeNotice("");
      setZhuantiChatRunning(false);
      return;
    }
    api.listMessages(zhuantiChatSessionId).then((rows: StoredMessage[]) => {
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
      setZhuantiChatMessages(msgs);
      void refreshTokenTotals();
    });
    api.getSessionRunStatus(zhuantiChatSessionId)
      .then((status) => {
        if (!cancelled) setZhuantiChatRunning(status.running);
      })
      .catch(() => {
        if (!cancelled) setZhuantiChatRunning(false);
      });
    setZhuantiChatRuntimeNotice("");
    api.getSessionRuntime(zhuantiChatSessionId, true).then(setZhuantiChatRuntime).catch(() => setZhuantiChatRuntime(null));
    return () => {
      cancelled = true;
    };
  }, [zhuantiChatSessionId, refreshTokenTotals]);

  // ---- gateway events ----
  useEffect(() => {
    return gateway.subscribe((msg: ServerMessage) => {
      if (msg.type === "flow_event") return;
      if ("flowId" in msg && msg.flowId) return;
      const sessionId = "sessionId" in msg ? msg.sessionId : null;
      if (sessionId && sessionId !== activeRef.current && sessionId !== zhuantiChatRef.current) return;
      const isZhuantiChat = Boolean(sessionId && sessionId === zhuantiChatRef.current && sessionId !== activeRef.current);
      const setTargetMessages = isZhuantiChat ? setZhuantiChatMessages : setMessages;
      const setTargetRunning = isZhuantiChat ? setZhuantiChatRunning : setRunning;
      const setTargetRuntime = isZhuantiChat ? setZhuantiChatRuntime : setRuntime;
      if (msg.type === "run_start") {
        setTargetRunning(true);
        setTargetRuntime((current) => current ? { ...current, status: "running", lastError: null } : current);
      }
      else if (msg.type === "run_end") {
        setTargetRunning(false);
        setArtifactRefreshKey((current) => current + 1);
        if (sessionId) api.getSessionRuntime(sessionId, true).then(setTargetRuntime).catch(() => undefined);
        void refreshTokenTotals();
      }
      else if (msg.type === "error") {
        setTargetRunning(msg.message.startsWith(SESSION_RUNNING_ERROR));
        setTargetMessages((m) => [...m, { id: nextId(), role: "assistant", content: [], error: msg.message }]);
      } else if (msg.type === "pi_event") {
        const ev = msg.event;
        if (ev.type === "compaction_start") {
          setTargetRuntime((current) => current ? { ...current, status: "compacting" } : current);
        } else if (ev.type === "compaction_end") {
          setTargetRuntime((current) => current ? {
            ...current,
            status: typeof ev.errorMessage === "string" ? "error" : "running",
            contextTokens: null,
            contextPercent: null,
            compactCount: current.compactCount + (typeof ev.errorMessage === "string" ? 0 : 1),
            lastCompactedAt: typeof ev.errorMessage === "string" ? current.lastCompactedAt : Date.now(),
            lastError: typeof ev.errorMessage === "string" ? ev.errorMessage : null,
          } : current);
        }
        if (ev.type === "tool_call") {
          setTargetMessages((cur) => appendToolCall(cur, toolCallBlock(ev as Extract<PiEvent, { type: "tool_call" }>)));
        } else if (ev.type === "tool_result") {
          setTargetMessages((cur) => appendToolResult(cur, toolResultBlock(ev as Extract<PiEvent, { type: "tool_result" }>)));
          setArtifactRefreshKey((current) => current + 1);
        } else if (ev.type === "message_end") {
          const { message: m } = ev as Extract<PiEvent, { type: "message_end" }>;
          if (m.role === "user") return;
          const blocks = asBlocks(m.content);
          if (m.errorMessage) {
            setTargetMessages((cur) => {
              const previous = cur[cur.length - 1]?.error;
              const repeated = previous?.startsWith(STREAM_END_ERROR) ? 2 : 1;
              return [...cur, { id: nextId(), role: m.role, content: blocks, error: displayError(m.errorMessage!, repeated) }];
            });
          } else {
            setTargetMessages((cur) => {
              const visibleBlocks = filterDuplicateToolBlocks(blocks, cur);
              return visibleBlocks.length > 0 ? [...cur, { id: nextId(), role: m.role, content: visibleBlocks }] : cur;
            });
            const text = textOf(m.content);
            if (!isZhuantiChat && m.role === "assistant" && text) setReport(text);
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
    async (id: string, deleteFiles = false) => {
      await api.deleteWorkspace(id, deleteFiles);
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
    async (id: string, deleteFiles = false) => {
      await api.deleteSession(id, deleteFiles);
      setSessions((cur) => {
        const next = cur.filter((s) => s.id !== id);
        if (activeSessionId === id) setActiveSessionId(next[0]?.id ?? null);
        return next;
      });
    },
    [activeSessionId],
  );

  const newZhuantiTask = useCallback(async () => {
    if (!activeWorkspaceId) return;
    const task = await api.newZhuantiTask(activeWorkspaceId, `专题 ${new Date().toLocaleString("zh-CN")}`);
    setZhuantiTasks((cur) => [task, ...cur.filter((item) => item.flow.id !== task.flow.id)]);
    selectZhuantiTaskData(task);
    setActiveTab("zhuanti");
    setActiveSubTab("anax_chat");
  }, [activeWorkspaceId, selectZhuantiTaskData]);

  const handleSelectZhuantiTask = useCallback((flowId: string) => {
    const task = zhuantiTasks.find((item) => item.flow.id === flowId);
    if (!task) return;
    selectZhuantiTaskData(task);
    setActiveTab("zhuanti");
    setActiveSubTab("anax_chat");
  }, [selectZhuantiTaskData, zhuantiTasks]);

  const renameZhuantiTask = useCallback(async (flowId: string, name: string) => {
    await api.renameFlow(flowId, name);
    setZhuantiTasks((cur) => cur.map((task) => (
      task.flow.id === flowId ? { ...task, flow: { ...task.flow, name } } : task
    )));
    setFlows((cur) => cur.map((flow) => (flow.id === flowId ? { ...flow, name } : flow)));
  }, []);

  const deleteZhuantiTask = useCallback(
    async (flowId: string, deleteFiles = false) => {
      const task = zhuantiTasks.find((item) => item.flow.id === flowId);
      await api.deleteFlow(flowId, deleteFiles);
      if (task) await api.deleteSession(task.session.id, false);
      const next = zhuantiTasks.filter((item) => item.flow.id !== flowId);
      setZhuantiTasks(next);
      setFlows((cur) => cur.filter((flow) => flow.id !== flowId));
      if (zhuantiChatFlowId === flowId) {
        const fallback = next[0] ?? null;
        if (fallback) selectZhuantiTaskData(fallback);
        else {
          setZhuantiChatFlowId(null);
          setZhuantiChatSessionId(null);
          setZhuantiChatMessages([]);
          setZhuantiChatRuntime(null);
          setZhuantiChatRuntimeNotice("");
          setZhuantiChatRunning(false);
        }
      }
    },
    [selectZhuantiTaskData, zhuantiChatFlowId, zhuantiTasks],
  );

  const newFlow = useCallback(async (kind: FlowKind) => {
    if (!activeWorkspaceId) return;
    const f = await api.createFlow(activeWorkspaceId, `工作流 ${new Date().toLocaleString("zh-CN")}`, kind);
    setFlows((cur) => [f, ...cur]);
    setActiveFlowId(f.id);
    setActiveTab("multi");
    setActiveSubTab("view");
  }, [activeWorkspaceId]);

  const instantiateWorkflowTemplate = useCallback(async (template: WorkflowTemplate) => {
    if (!activeWorkspaceId) throw new Error("请先选择工作区");
    const flow = template.id === "anax-full"
      ? await api.instantiateAnax(activeWorkspaceId, template.name)
      : template.id === "anax-quick"
        ? await api.instantiateAnaxQuick(activeWorkspaceId, template.name)
        : await api.instantiateSqlLoop(activeWorkspaceId, template.name);
    setFlows((current) => [flow, ...current.filter((item) => item.id !== flow.id)]);
    setActiveFlowId(flow.id);
    setActiveTab("multi");
    setActiveSubTab("view");
  }, [activeWorkspaceId]);

  const renameFlow = useCallback(async (id: string, name: string) => {
    await api.renameFlow(id, name);
    setFlows((cur) => cur.map((f) => (f.id === id ? { ...f, name } : f)));
  }, []);

  const deleteFlow = useCallback(
    async (id: string, deleteFiles = false) => {
      await api.deleteFlow(id, deleteFiles);
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
    setActiveTab("multi");
    setActiveSubTab("view");
  }, []);

  const handleTabChange = useCallback((tab: Tab) => {
    setActiveTab(tab);
    setActiveSubTab(tab === "rule_memory" ? "rules" : tab === "xan_db" ? "own_product" :tab === "onto_xanthil" ? "onto_readme" : tab === "zhuanti" ? "anax_chat" : tab === "aggregate" ? "readme" : tab === "knowledge_base" ? "readme" : tab === "health" ? "health_data" : "view");
    if (tab === "explore") {
      setActiveSessionId(sessions[0]?.id ?? null);
    }
    if (tab === "zhuanti" && zhuantiTasks[0]) {
      selectZhuantiTaskData(zhuantiTasks[0]);
    }
  }, [selectZhuantiTaskData, sessions, zhuantiTasks]);

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
      gateway.send({ type: "send", sessionId: activeSessionId, text, model: model || undefined, skillPaths, injectRulesPrompt: rulesPromptEnabled, injectKnowledgePrompt: knowledgePromptEnabled, businessRequirementContext });
    },
    [activeSessionId, knowledgePromptEnabled, model, rulesPromptEnabled],
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

  const onZhuantiChatSend = useCallback(
    (text: string, skillPaths?: string[], businessRequirementContext?: { pathId: number; markdownPath: string; jsonPath?: string }) => {
      if (!zhuantiChatSessionId) return;
      setZhuantiChatMessages((cur) => [...cur, { id: nextId(), role: "user", content: [{ type: "text", text }] }]);
      gateway.send({ type: "send", sessionId: zhuantiChatSessionId, text, model: model || undefined, skillPaths, injectRulesPrompt: rulesPromptEnabled, injectKnowledgePrompt: knowledgePromptEnabled, businessRequirementContext });
    },
    [zhuantiChatSessionId, knowledgePromptEnabled, model, rulesPromptEnabled],
  );

  const onZhuantiChatStop = useCallback(() => {
    if (!zhuantiChatSessionId) return;
    gateway.send({ type: "abort", sessionId: zhuantiChatSessionId });
  }, [zhuantiChatSessionId]);

  const compactZhuantiChatContext = useCallback(async () => {
    if (!zhuantiChatSessionId || zhuantiChatRunning || zhuantiChatCompacting) return;
    setZhuantiChatCompacting(true);
    setZhuantiChatRuntimeNotice("");
    try {
      const result = await api.compactSession(zhuantiChatSessionId);
      setZhuantiChatRuntime(result.runtime);
      setZhuantiChatRuntimeNotice(result.message);
    } catch (err) {
      setZhuantiChatRuntime((current) => current ? { ...current, status: "error", lastError: String(err) } : current);
      setZhuantiChatRuntimeNotice("上下文整理失败");
    } finally {
      setZhuantiChatCompacting(false);
    }
  }, [zhuantiChatCompacting, zhuantiChatRunning, zhuantiChatSessionId]);

  const refreshZhuantiChatRuntime = useCallback(async () => {
    if (!zhuantiChatSessionId || zhuantiChatRunning || zhuantiChatCompacting) return;
    setZhuantiChatRuntimeNotice("");
    try {
      const next = await api.getSessionRuntime(zhuantiChatSessionId, true);
      setZhuantiChatRuntime(next);
      setZhuantiChatRuntimeNotice(next.status === "error" ? "上下文状态仍未恢复" : "上下文状态已更新");
    } catch (err) {
      setZhuantiChatRuntime((current) => current ? { ...current, status: "error", lastError: String(err) } : current);
      setZhuantiChatRuntimeNotice("上下文状态获取失败");
    }
  }, [zhuantiChatCompacting, zhuantiChatRunning, zhuantiChatSessionId]);

  const pushZhuantiChatSummary = useCallback((text: string) => {
    const summary = text.trim();
    if (!summary) return;
    setZhuantiChatMessages((cur) => [...cur, { id: nextId(), role: "assistant", content: [{ type: "text", text: summary }] }]);
  }, []);

  const activeWorkspace = workspaces.find((w) => w.id === activeWorkspaceId) ?? null;
  const activeFlow = flows.find((f) => f.id === activeFlowId) ?? null;
  const zhuantiChatFlow = flows.find((f) => f.id === zhuantiChatFlowId) ?? null;

  const folderScope = useMemo(() => {
    if (activeTab === "explore") {
      return activeSessionId ? { type: "session" as const, sessionId: activeSessionId } : activeWorkspaceId ? { type: "workspace" as const, workspaceId: activeWorkspaceId } : null;
    }
    if (activeTab === "zhuanti") {
      return zhuantiChatFlowId ? { type: "flow" as const, flowId: zhuantiChatFlowId } : activeWorkspaceId ? { type: "workspace" as const, workspaceId: activeWorkspaceId } : null;
    }
    return activeFlowId ? { type: "flow" as const, flowId: activeFlowId } : activeWorkspaceId ? { type: "workspace" as const, workspaceId: activeWorkspaceId } : null;
  }, [activeFlowId, activeSessionId, activeTab, activeWorkspaceId, zhuantiChatFlowId]);

  const zhuantiChatFolderScope = useMemo(() => (
    zhuantiChatFlowId ? { type: "flow" as const, flowId: zhuantiChatFlowId } : activeWorkspaceId ? { type: "workspace" as const, workspaceId: activeWorkspaceId } : null
  ), [activeWorkspaceId, zhuantiChatFlowId]);

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
    model, models, setModel, refreshModels,
    messages, running, runtime, compacting, runtimeNotice,
    onSend, onStop, compactContext, refreshRuntime,
    zhuantiChatSessionId, zhuantiChatFolderScope,
    zhuantiChatMessages, zhuantiChatRunning, zhuantiChatRuntime, zhuantiChatCompacting, zhuantiChatRuntimeNotice,
    onZhuantiChatSend, onZhuantiChatStop, compactZhuantiChatContext, refreshZhuantiChatRuntime,
    zhuantiSeed, setZhuantiSeed, pushZhuantiChatSummary,
    exploreSeed, setExploreSeed,
    handleReportPathsChange, setArtifactRefreshKey, refreshRulesPromptInfo, refreshKnowledgePromptInfo,
    activeFlow, zhuantiChatFlow, flows, rulesPromptEnabled, knowledgePromptEnabled,
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
              zhuantiTasks={zhuantiTasks}
              activeZhuantiTaskId={zhuantiChatFlowId}
              onSelectWorkspace={setActiveWorkspaceId}
              onSelectSession={handleSelectSession}
              onSelectZhuantiTask={handleSelectZhuantiTask}
              onNewWorkspace={newWorkspace}
              onNewSession={newSession}
              onNewZhuantiTask={newZhuantiTask}
              onRenameWorkspace={renameWorkspace}
              onDeleteWorkspace={deleteWorkspace}
              onRenameSession={renameSession}
              onDeleteSession={deleteSession}
              onRenameZhuantiTask={renameZhuantiTask}
              onDeleteZhuantiTask={deleteZhuantiTask}
              onCollapse={() => setSidebarOpen(false)}
              onOpenSettings={() => setSettingsOpen(true)}
            />
          </div>
          <div className="hidden md:block">
            <Sidebar
              workspaces={workspaces}
              activeWorkspaceId={activeWorkspaceId}
              sessions={sessions}
              activeSessionId={activeSessionId}
              zhuantiTasks={zhuantiTasks}
              activeZhuantiTaskId={zhuantiChatFlowId}
              onSelectWorkspace={setActiveWorkspaceId}
              onSelectSession={handleSelectSession}
              onSelectZhuantiTask={handleSelectZhuantiTask}
              onNewWorkspace={newWorkspace}
              onNewSession={newSession}
              onNewZhuantiTask={newZhuantiTask}
              onRenameWorkspace={renameWorkspace}
              onDeleteWorkspace={deleteWorkspace}
              onRenameSession={renameSession}
              onDeleteSession={deleteSession}
              onRenameZhuantiTask={renameZhuantiTask}
              onDeleteZhuantiTask={deleteZhuantiTask}
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
          rulesPromptDetails={rulesPromptInfo.details}
          onToggleRulesPrompt={() => setRulesPromptEnabled((current) => !current)}
          knowledgePromptEnabled={knowledgePromptEnabled}
          knowledgePromptCount={knowledgePromptInfo.count}
          knowledgePromptUpdatedAt={knowledgePromptInfo.updatedAt}
          onToggleKnowledgePrompt={() => setKnowledgePromptEnabled((current) => !current)}
          onOpenQuickNotes={() => {
            setActiveTab("rule_memory");
            setActiveSubTab("quick_notes");
          }}
        />

        {/* Sub-tab strip: 工作视图 | 原始数据 | 数据提取 | 聚合计算 | 聚合数据 | 数据探索 | 报告输出。重复(multi) 顶部 workflow tab 见 MultiAgentExecutionPane 三级 tab；专题(zhuanti) AnaX 子项见下方左竖栏。
            本体库(onto-xanthil) 的二级 tab 全部以左侧竖栏呈现（见下方），故此处顶部条对 onto 隐藏。 */}
        {activeTab !== "onto_xanthil" && (
        <div className="flex h-9 shrink-0 items-center gap-1 border-b border-neutral-200 px-4 dark:border-neutral-800">
          {getSubTabsForTab(activeTab).filter((t) => isVisible(activeTab + ":" + t.id) && (activeTab !== "zhuanti" || !ZHUANTI_SIDEBAR_IDS.has(t.id))).map((t) => {
            const active = t.id === activeSubTab || (activeTab === "aggregate" && t.id === "skill" && LAB_SUB_IDS.has(activeSubTab));
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
        )}

        <div className="flex min-h-0 flex-1">
          {/* onto-xanthil：全部二级 tab 以左侧竖栏呈现（说明/对象/关系/指标/逻辑/动作/图谱/导入） */}
          {activeTab === "onto_xanthil" && (
            <nav className="scrollbar-thin flex w-40 shrink-0 flex-col gap-0.5 overflow-y-auto border-r border-neutral-200 p-2 dark:border-neutral-800">
              {ONTO_SUB_TABS.filter((t) => isVisible("onto_xanthil:" + t.id)).map((t) => {
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
          {/* 控制·实验场：三级子项以左侧竖栏呈现（skill/tool/hooks/command/subagents/prompts，标签无「实验场」尾缀，复用单一 activeSubTab） */}
          {activeTab === "aggregate" && LAB_SUB_IDS.has(activeSubTab) && (
            <nav className="scrollbar-thin flex w-40 shrink-0 flex-col gap-0.5 overflow-y-auto border-r border-neutral-200 p-2 dark:border-neutral-800">
              {LAB_SUB_TABS.filter((t) => isVisible("aggregate:" + t.id)).map((t) => {
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
          {/* 专题：左侧竖栏 = 核心 5 项（对话探索/流水线/假设库/变更管理/readme）；数据/报告链路在顶部横条 */}
          {activeTab === "zhuanti" && (
            <nav className="scrollbar-thin flex w-40 shrink-0 flex-col gap-0.5 overflow-y-auto border-r border-neutral-200 p-2 dark:border-neutral-800">
              {ZHUANTI_SIDEBAR_TABS.filter((t) => isVisible("zhuanti:" + t.id)).map((t) => {
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
          {/* 专题·对话探索：左侧「聚合数据」只读文档竖栏（复用探索范式，scope=专题 flow） */}
          {activeTab === "zhuanti" && activeSubTab === "anax_chat" && (
            <CleanDataDocsColumn scope={zhuantiChatFolderScope} />
          )}
          {/* 工作流·工作视图：左侧工作流列表竖栏（由原侧边栏迁入） */}
          {activeTab === "multi" && activeSubTab === "view" && (
            <FlowListColumn
              flows={flows}
              activeFlowId={activeFlowId}
              workspaceReady={Boolean(activeWorkspaceId)}
              onSelectFlow={onSelectFlow}
              onNewFlow={newFlow}
              onInstantiateTemplate={instantiateWorkflowTemplate}
              onRenameFlow={renameFlow}
              onDeleteFlow={deleteFlow}
            />
          )}
          <div className="flex min-h-0 min-w-0 flex-1 flex-col">
            <DataTabs ctx={tabCtx} />
            <EngineTabs ctx={tabCtx} />
            <VizTabs ctx={tabCtx} />
            <HealthTabs ctx={tabCtx} />
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
      {settingsOpen && <SettingsModal onClose={() => setSettingsOpen(false)} hiddenTabs={hiddenTabs} toggleTab={toggleTab} />}
    </div>
  );
}
