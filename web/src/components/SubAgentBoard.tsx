import { useCallback, useEffect, useMemo, useState } from "react";
import { Bot, ChevronDown, ChevronRight, ExternalLink, FileText, HelpCircle, Loader2, RefreshCw, Square, Users, Workflow } from "lucide-react";
import { api } from "@/lib/api";
import { cn } from "@/lib/cn";
import { gateway } from "@/lib/ws";
import type { ServerMessage, SubAgentTask, SubAgentTaskStatus, SubAgentTemplate, Workspace, WorkflowAgentEntry, WorkflowRunView } from "@/types";

const flowStatuses: SubAgentTaskStatus[] = ["running", "success", "failed", "aborted"];

const statuses: SubAgentTaskStatus[] = ["running", "success", "failed", "waiting_for_help", "aborted"];

const statusLabel: Record<SubAgentTaskStatus, string> = {
  running: "运行中",
  success: "已完成",
  failed: "失败",
  waiting_for_help: "等待修正",
  aborted: "已中止",
};

const statusClass: Record<SubAgentTaskStatus, string> = {
  running: "bg-blue-100 text-blue-700 dark:bg-blue-950/60 dark:text-blue-300",
  success: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300",
  failed: "bg-red-100 text-red-700 dark:bg-red-950/60 dark:text-red-300",
  waiting_for_help: "bg-amber-100 text-amber-700 dark:bg-amber-950/60 dark:text-amber-300",
  aborted: "bg-neutral-100 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300",
};

type TraceRow = { id: string; title: string; body: string; createdAt: number };

let traceSeq = 0;

function fmtTime(ts?: number): string {
  if (!ts) return "-";
  const d = new Date(ts);
  return `${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function personaSummary(persona: string): string {
  const t = persona.trim().replace(/\s+/g, " ");
  return t.length <= 48 ? t : `${t.slice(0, 48)}…`;
}

function stringify(value: unknown): string {
  if (typeof value === "string") return value;
  if (value == null) return "";
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function toTraceRow(message: Extract<ServerMessage, { type: "subagent_event" }>): TraceRow {
  const name = "name" in message.event && typeof message.event.name === "string" ? message.event.name : "";
  return {
    id: `${message.taskId}:${message.createdAt}:${++traceSeq}`,
    title: name ? `${message.traceKind} · ${name}` : message.traceKind,
    body: stringify(message.event),
    createdAt: message.createdAt,
  };
}

function TraceList({ rows }: { rows: TraceRow[] }) {
  if (rows.length === 0) {
    return <div className="rounded-md border border-dashed border-neutral-200 px-3 py-2 text-[12px] text-neutral-400 dark:border-neutral-800">等待运行日志…</div>;
  }
  return <div className="max-h-72 space-y-2 overflow-y-auto rounded-md border border-neutral-200 bg-neutral-50 p-2 dark:border-neutral-800 dark:bg-neutral-950/40">{rows.map((row) => <div key={row.id} className="rounded-md bg-white px-2.5 py-2 dark:bg-neutral-900"><div className="flex items-center gap-2 text-[11px] font-medium text-neutral-600 dark:text-neutral-300"><FileText className="h-3.5 w-3.5 text-neutral-400" /><span>{row.title}</span><span className="ml-auto font-normal text-neutral-400">{new Date(row.createdAt).toLocaleTimeString()}</span></div>{row.body && <pre className="mt-1 max-h-32 overflow-auto whitespace-pre-wrap break-words text-[11px] leading-4 text-neutral-500 dark:text-neutral-400">{row.body}</pre>}</div>)}</div>;
}

export function SubAgentBoard({ templates }: { templates: SubAgentTemplate[] }) {
  const [tasks, setTasks] = useState<SubAgentTask[]>([]);
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [workspaceId, setWorkspaceId] = useState("");
  const [status, setStatus] = useState<"all" | SubAgentTaskStatus>("all");
  const [templateId, setTemplateId] = useState("all");
  const [expandedIds, setExpandedIds] = useState<string[]>([]);
  const [traceRows, setTraceRows] = useState<Record<string, TraceRow[]>>({});
  const [drafts, setDrafts] = useState<Record<string, { correction: string; correctedResult: string }>>({});
  const [busyId, setBusyId] = useState("");
  const [preview, setPreview] = useState<{ title: string; content: string } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [wfAgents, setWfAgents] = useState<WorkflowAgentEntry[]>([]);
  const [wfRuns, setWfRuns] = useState<WorkflowRunView[]>([]);
  const [flowFilter, setFlowFilter] = useState("all");

  const templateName = useMemo(() => new Map(templates.map((t) => [t.id, t.name])), [templates]);
  const workspaceName = useMemo(() => new Map(workspaces.map((w) => [w.id, w.name])), [workspaces]);

  const refresh = useCallback(() => {
    setLoading(true);
    setError("");
    Promise.all([
      api.listAllSubAgentTasks({ limit: 200, workspaceId: workspaceId || undefined, status: status !== "all" ? status : undefined }).then(setTasks),
      api.listWorkflowAgents(workspaceId || undefined).then((b) => { setWfAgents(b.agents); setWfRuns(b.runs); }),
    ])
      .catch((err) => setError(String(err)))
      .finally(() => setLoading(false));
  }, [workspaceId]);

  useEffect(() => {
    api.listWorkspaces().then(setWorkspaces).catch((err) => setError(String(err)));
  }, []);

  useEffect(() => refresh(), [refresh]);

  useEffect(() => {
    gateway.connect();
    return gateway.subscribe((msg: ServerMessage) => {
      if (msg.type !== "subagent_event") return;
      if (workspaceId && msg.workspaceId !== workspaceId) return;
      const row = toTraceRow(msg);
      setTraceRows((cur) => ({ ...cur, [msg.taskId]: [...(cur[msg.taskId] ?? []), row].slice(-80) }));
      setExpandedIds((cur) => cur.includes(msg.taskId) ? cur : [...cur, msg.taskId]);
      if (msg.event.type === "subagent_run_start" || msg.event.type === "subagent_run_end") refresh();
    });
  }, [workspaceId, refresh]);

  const counts = useMemo(() => {
    const out: Record<SubAgentTaskStatus, number> = { running: 0, success: 0, failed: 0, waiting_for_help: 0, aborted: 0 };
    tasks.forEach((task) => out[task.status]++);
    return out;
  }, [tasks]);

  const taskTemplateKey = useCallback(
    (task: SubAgentTask) => (task.templateId && templateName.has(task.templateId) ? task.templateId : "__none__"),
    [templateName],
  );

  const filtered = useMemo(() => tasks.filter((task) => {
    if (status !== "all" && task.status !== status) return false;
    if (templateId !== "all" && taskTemplateKey(task) !== templateId) return false;
    return true;
  }), [tasks, status, templateId, taskTemplateKey]);

  const hasNoneBucket = useMemo(() => tasks.some((t) => taskTemplateKey(t) === "__none__"), [tasks, taskTemplateKey]);

  // 花名册：已创建的 subagents(模板) 作为常驻条目(即使 0 运行) + 默认/无模板运行桶，聚合各自历史运行。
  const roster = useMemo(() => {
    type Entry = { template: SubAgentTemplate | null; key: string; name: string; total: number; byStatus: Record<SubAgentTaskStatus, number>; last?: SubAgentTask };
    const byKey = new Map<string, Entry>();
    const ensure = (key: string, template: SubAgentTemplate | null, name: string): Entry => {
      let e = byKey.get(key);
      if (!e) { e = { template, key, name, total: 0, byStatus: { running: 0, success: 0, failed: 0, waiting_for_help: 0, aborted: 0 }, last: undefined }; byKey.set(key, e); }
      return e;
    };
    for (const t of templates) ensure(t.id, t, t.name); // 0 运行的模板也常驻
    for (const task of tasks) {
      const key = taskTemplateKey(task);
      const e = ensure(key, key === "__none__" ? null : templates.find((t) => t.id === key) ?? null, key === "__none__" ? "默认模板（无模板）" : templateName.get(key) ?? key);
      e.total++;
      e.byStatus[task.status]++;
      if (!e.last || task.createdAt > e.last.createdAt) e.last = task;
    }
    return Array.from(byKey.values()).sort((a, b) => ((b.last?.createdAt ?? 0) - (a.last?.createdAt ?? 0)) || a.name.localeCompare(b.name));
  }, [templates, tasks, templateName, taskTemplateKey]);

  // 工作流 agent 花名册：按 flow 分组其 workflow.json 节点 + 聚合 flow_runs 流水线级运行统计（节点级运行态未落库，见需求池）。
  const workflowRoster = useMemo(() => {
    type Group = { flowId: string; flowName: string; nodes: WorkflowAgentEntry[]; total: number; byStatus: Record<string, number>; last?: WorkflowRunView };
    const byFlow = new Map<string, Group>();
    const ensure = (flowId: string, flowName: string): Group => {
      let g = byFlow.get(flowId);
      if (!g) { g = { flowId, flowName, nodes: [], total: 0, byStatus: {}, last: undefined }; byFlow.set(flowId, g); }
      return g;
    };
    for (const a of wfAgents) ensure(a.flowId, a.flowName).nodes.push(a);
    for (const r of wfRuns) {
      const g = ensure(r.flowId, r.flowName);
      g.total++;
      g.byStatus[r.status] = (g.byStatus[r.status] ?? 0) + 1;
      if (!g.last || r.startedAt > g.last.startedAt) g.last = r;
    }
    return Array.from(byFlow.values()).sort((a, b) => ((b.last?.startedAt ?? 0) - (a.last?.startedAt ?? 0)) || a.flowName.localeCompare(b.flowName));
  }, [wfAgents, wfRuns]);

  const wfRunsFiltered = useMemo(() => flowFilter === "all" ? wfRuns : wfRuns.filter((r) => r.flowId === flowFilter), [wfRuns, flowFilter]);
  const wfAgentNodeCount = useMemo(() => wfAgents.filter((a) => a.kind === "agent").length, [wfAgents]);

  async function abort(task: SubAgentTask) {
    setBusyId(task.id);
    setError("");
    try {
      await api.abortSubAgent(task.id);
      await refresh();
    } catch (err) {
      setError(String(err));
    } finally {
      setBusyId("");
    }
  }

  async function resume(task: SubAgentTask) {
    const draft = drafts[task.id] ?? { correction: "", correctedResult: "" };
    setBusyId(task.id);
    setError("");
    try {
      await api.resumeSubAgent(task.id, { correction: draft.correction.trim(), correctedResult: draft.correctedResult.trim() });
      await refresh();
    } catch (err) {
      setError(String(err));
    } finally {
      setBusyId("");
    }
  }

  async function openReport(task: SubAgentTask) {
    if (!task.reportPath) return;
    setBusyId(task.id);
    try {
      const file = await api.sessionArtifactFileGet(task.parentSessionId, task.reportPath);
      setPreview({ title: file.name, content: file.previewable ? file.content ?? "" : "该文件不可文本预览。" });
    } catch (err) {
      setError(String(err));
    } finally {
      setBusyId("");
    }
  }

  return <div className="space-y-3 p-4">
    <div className="rounded-md border border-neutral-200 bg-white p-3 dark:border-neutral-800 dark:bg-neutral-900">
      <div className="flex flex-wrap items-center gap-2">
        <div className="mr-auto flex items-center gap-2 text-[13px] font-medium text-neutral-800 dark:text-neutral-100"><Bot className="h-4 w-4 text-neutral-500" />全局运行看板{loading && <Loader2 className="h-3.5 w-3.5 animate-spin text-neutral-400" />}</div>
        <select value={workspaceId} onChange={(e) => setWorkspaceId(e.target.value)} className="h-8 rounded-md border border-neutral-200 bg-transparent px-2 text-[12px] outline-none dark:border-neutral-700"><option value="">全部工作区</option>{workspaces.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}</select>
        <select value={status} onChange={(e) => setStatus(e.target.value as "all" | SubAgentTaskStatus)} className="h-8 rounded-md border border-neutral-200 bg-transparent px-2 text-[12px] outline-none dark:border-neutral-700"><option value="all">全部状态</option>{statuses.map((s) => <option key={s} value={s}>{statusLabel[s]}</option>)}</select>
        <select value={templateId} onChange={(e) => setTemplateId(e.target.value)} className="h-8 rounded-md border border-neutral-200 bg-transparent px-2 text-[12px] outline-none dark:border-neutral-700"><option value="all">全部模板</option>{templates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}{hasNoneBucket && <option value="__none__">默认模板（无模板）</option>}</select>
        <button type="button" onClick={refresh} className="inline-flex h-8 items-center gap-1.5 rounded-md border border-neutral-200 px-2.5 text-[12px] text-neutral-600 hover:bg-neutral-50 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800"><RefreshCw className="h-3.5 w-3.5" />刷新</button>
      </div>
      <div className="mt-3 grid gap-2 md:grid-cols-5">{statuses.map((s) => <button key={s} type="button" onClick={() => setStatus(s)} className="rounded-md border border-neutral-200 bg-neutral-50 p-2 text-left hover:bg-neutral-100 dark:border-neutral-800 dark:bg-neutral-950/50"><div className="text-[10.5px] text-neutral-500">{statusLabel[s]}</div><div className="mt-1 text-2xl font-semibold tabular-nums text-neutral-900 dark:text-neutral-100">{counts[s]}</div></button>)}</div>
    </div>
    {error && <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-[12px] text-red-600 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300">{error}</div>}
    <div className="rounded-md border border-neutral-200 bg-white p-3 dark:border-neutral-800 dark:bg-neutral-900">
      <div className="mb-2 flex items-center gap-2 text-[13px] font-medium text-neutral-800 dark:text-neutral-100"><Users className="h-4 w-4 text-neutral-500" />subagents 花名册<span className="text-[11px] font-normal text-neutral-400">已创建 {templates.length}{hasNoneBucket ? " · 含默认" : ""}</span><span className="ml-auto text-[10.5px] font-normal text-neutral-400">点卡片筛选其运行</span></div>
      {roster.length === 0 ? <div className="rounded-md border border-dashed border-neutral-200 px-3 py-6 text-center text-[12px] text-neutral-400 dark:border-neutral-800">尚无 subagent —— 去「模板管理」新建，或从对话「委派子 agent」跑一次</div> : <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">{roster.map((e) => {
        const activeFilter = templateId === e.key;
        return <button key={e.key} type="button" onClick={() => setTemplateId(activeFilter ? "all" : e.key)} className={cn("rounded-md border p-2.5 text-left transition", activeFilter ? "border-neutral-900 bg-neutral-50 dark:border-neutral-100 dark:bg-neutral-800" : "border-neutral-200 bg-neutral-50/50 hover:bg-neutral-50 dark:border-neutral-800 dark:bg-neutral-950/40 dark:hover:bg-neutral-800/50")}>
          <div className="flex items-center gap-1.5">
            {e.template ? <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", e.template.enabled ? "bg-emerald-500" : "bg-neutral-300 dark:bg-neutral-600")} /> : <Bot className="h-3.5 w-3.5 shrink-0 text-neutral-400" />}
            <span className="truncate text-[12.5px] font-medium text-neutral-800 dark:text-neutral-100">{e.name}</span>
            <span className="ml-auto shrink-0 text-[11px] tabular-nums text-neutral-400">{e.total} 次</span>
          </div>
          {e.template && <div className="mt-0.5 truncate text-[10.5px] text-neutral-400">{personaSummary(e.template.persona)}</div>}
          <div className="mt-1.5 flex flex-wrap gap-1 text-[10px]">{statuses.map((s) => e.byStatus[s] > 0 ? <span key={s} className={cn("rounded px-1 py-0.5", statusClass[s])}>{statusLabel[s]} {e.byStatus[s]}</span> : null)}{e.total === 0 && <span className="rounded bg-neutral-100 px-1 py-0.5 text-neutral-400 dark:bg-neutral-800">未运行</span>}</div>
          <div className="mt-1 flex flex-wrap gap-x-2 text-[10px] text-neutral-400">{e.last && <span>最近 {fmtTime(e.last.createdAt)}</span>}{e.template && e.template.toolIds.length > 0 && <span>· {e.template.toolIds.length} 工具</span>}{e.template && e.template.maxRetries > 0 && <span>· 重试 {e.template.maxRetries}</span>}</div>
        </button>;
      })}</div>}
    </div>
    <div className="rounded-md border border-neutral-200 bg-white p-3 dark:border-neutral-800 dark:bg-neutral-900">
      <div className="mb-2 flex items-center gap-2 text-[13px] font-medium text-neutral-800 dark:text-neutral-100"><Workflow className="h-4 w-4 text-neutral-500" />工作流 agent<span className="text-[11px] font-normal text-neutral-400">{workflowRoster.length} 条工作流 · {wfAgentNodeCount} 个 agent 节点</span><span className="ml-auto text-[10.5px] font-normal text-neutral-400">点卡片筛选其运行 · 统计为流水线级</span></div>
      {workflowRoster.length === 0 ? <div className="rounded-md border border-dashed border-neutral-200 px-3 py-6 text-center text-[12px] text-neutral-400 dark:border-neutral-800">尚无工作流 —— 去「专题」新建并运行工作流</div> : <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">{workflowRoster.map((g) => {
        const activeFilter = flowFilter === g.flowId;
        const agentN = g.nodes.filter((n) => n.kind === "agent").length;
        const gateN = g.nodes.filter((n) => n.kind === "gate").length;
        const toolN = g.nodes.filter((n) => n.kind === "tool").length;
        return <button key={g.flowId} type="button" onClick={() => setFlowFilter(activeFilter ? "all" : g.flowId)} className={cn("rounded-md border p-2.5 text-left transition", activeFilter ? "border-neutral-900 bg-neutral-50 dark:border-neutral-100 dark:bg-neutral-800" : "border-neutral-200 bg-neutral-50/50 hover:bg-neutral-50 dark:border-neutral-800 dark:bg-neutral-950/40 dark:hover:bg-neutral-800/50")}>
          <div className="flex items-center gap-1.5"><Workflow className="h-3.5 w-3.5 shrink-0 text-neutral-400" /><span className="truncate text-[12.5px] font-medium text-neutral-800 dark:text-neutral-100">{g.flowName}</span><span className="ml-auto shrink-0 text-[11px] tabular-nums text-neutral-400">{g.total} 次</span></div>
          {g.nodes.length > 0 && <div className="mt-0.5 truncate text-[10.5px] text-neutral-400">{g.nodes.map((n) => n.label).join(" · ")}</div>}
          <div className="mt-1.5 flex flex-wrap gap-1 text-[10px]">{flowStatuses.map((s) => g.byStatus[s] ? <span key={s} className={cn("rounded px-1 py-0.5", statusClass[s])}>{statusLabel[s]} {g.byStatus[s]}</span> : null)}{g.total === 0 && <span className="rounded bg-neutral-100 px-1 py-0.5 text-neutral-400 dark:bg-neutral-800">未运行</span>}</div>
          <div className="mt-1 flex flex-wrap gap-x-2 text-[10px] text-neutral-400"><span>{agentN} agent</span>{gateN > 0 && <span>· {gateN} gate</span>}{toolN > 0 && <span>· {toolN} tool</span>}{g.last && <span>· 最近 {fmtTime(g.last.startedAt)}</span>}</div>
        </button>;
      })}</div>}
      {wfRuns.length > 0 && <div className="mt-3 border-t border-neutral-100 pt-2.5 dark:border-neutral-800">
        <div className="mb-1.5 flex items-center gap-2 text-[12px] font-medium text-neutral-700 dark:text-neutral-200"><FileText className="h-3.5 w-3.5 text-neutral-400" />工作流运行<span className="text-[11px] font-normal text-neutral-400">{wfRunsFiltered.length} 条{flowFilter !== "all" ? `（${workflowRoster.find((g) => g.flowId === flowFilter)?.flowName ?? flowFilter}）` : ""}</span></div>
        <div className="space-y-1.5">{wfRunsFiltered.slice(0, 50).map((r) => <div key={r.id} className="flex flex-wrap items-center gap-x-2 gap-y-0.5 rounded-md border border-neutral-200 bg-neutral-50/50 px-2.5 py-1.5 dark:border-neutral-800 dark:bg-neutral-950/40"><span className={cn("rounded px-1.5 py-0.5 text-[10px]", statusClass[r.status as SubAgentTaskStatus] ?? "bg-neutral-100 text-neutral-600 dark:bg-neutral-800")}>{statusLabel[r.status as SubAgentTaskStatus] ?? r.status}</span><span className="truncate text-[11.5px] font-medium text-neutral-800 dark:text-neutral-100">{r.flowName}</span><span className="ml-auto shrink-0 text-[10px] text-neutral-400">{fmtTime(r.startedAt)} → {fmtTime(r.endedAt)}</span><span className="w-full truncate text-[10px] text-neutral-400">{r.outputDir}</span></div>)}</div>
      </div>}
    </div>
    <div className="flex items-center gap-2 text-[12px] font-medium text-neutral-700 dark:text-neutral-200"><FileText className="h-3.5 w-3.5 text-neutral-400" />委派运行明细<span className="text-[11px] font-normal text-neutral-400">{filtered.length} 条{templateId !== "all" ? `（${templateId === "__none__" ? "默认模板" : templateName.get(templateId) ?? templateId}）` : ""}</span></div>
    <div className="space-y-2">{filtered.length === 0 ? <div className="rounded-md border border-dashed border-neutral-200 bg-white px-3 py-8 text-center text-[12px] text-neutral-400 dark:border-neutral-800 dark:bg-neutral-900">暂无任务</div> : filtered.map((task) => <div key={task.id} className="rounded-md border border-neutral-200 bg-white p-3 dark:border-neutral-800 dark:bg-neutral-900">
      <div className="flex gap-3">
        <button type="button" onClick={() => setExpandedIds((cur) => cur.includes(task.id) ? cur.filter((id) => id !== task.id) : [...cur, task.id])} className="mt-0.5 text-neutral-400">{expandedIds.includes(task.id) ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}</button>
                <div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><span className={cn("rounded px-1.5 py-0.5 text-[10.5px]", statusClass[task.status])}>{statusLabel[task.status]}</span><span className="truncate text-[12px] font-medium text-neutral-800 dark:text-neutral-100">{task.brief}</span>{task.status === "running" && <button type="button" onClick={() => void abort(task)} disabled={busyId === task.id} title="中止" className="ml-auto inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-neutral-400 hover:bg-neutral-100 hover:text-neutral-600 dark:hover:bg-neutral-800"><Square className="h-3.5 w-3.5" fill="currentColor" /></button>}</div>
<div className="mt-1 flex flex-wrap gap-1.5 text-[10.5px] text-neutral-400"><span>{task.workspaceId ? workspaceName.get(task.workspaceId) ?? task.workspaceId : "-"}</span><span>· {task.templateId ? templateName.get(task.templateId) ?? task.templateId : "默认模板"}</span>{task.model && <span>· {task.model}</span>}<span>· {fmtTime(task.createdAt)} → {fmtTime(task.endedAt)}</span>{task.reportPath && <button type="button" onClick={() => void openReport(task)} className="inline-flex items-center gap-1 text-neutral-500 hover:text-neutral-900 dark:hover:text-white">{busyId === task.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <ExternalLink className="h-3 w-3" />}{task.reportPath}</button>}</div></div>
      </div>
      {expandedIds.includes(task.id) && <div className="mt-3 space-y-2 pl-7">{task.summary && <div className="whitespace-pre-wrap rounded-md bg-neutral-50 px-3 py-2 text-[12px] leading-5 text-neutral-700 dark:bg-neutral-950/50 dark:text-neutral-200">{task.summary}</div>}{task.error && <pre className="max-h-32 overflow-auto whitespace-pre-wrap rounded-md bg-red-50 px-3 py-2 text-[11px] text-red-600 dark:bg-red-950/30 dark:text-red-300">{task.error}</pre>}<TraceList rows={traceRows[task.id] ?? []} />{task.status === "waiting_for_help" && <div className="rounded-md border border-amber-200 bg-amber-50 p-3 dark:border-amber-900/70 dark:bg-amber-950/25"><div className="mb-2 flex items-center gap-1.5 text-[12px] font-medium text-amber-800 dark:text-amber-200"><HelpCircle className="h-3.5 w-3.5" />修正并继续</div><textarea rows={2} placeholder="修正说明" value={drafts[task.id]?.correction ?? ""} onChange={(e) => setDrafts((cur) => ({ ...cur, [task.id]: { correction: e.target.value, correctedResult: cur[task.id]?.correctedResult ?? "" } }))} className="w-full rounded-md border border-amber-200 bg-white px-2.5 py-2 text-[12px] outline-none dark:border-amber-900/60 dark:bg-neutral-950" /><textarea rows={4} placeholder="正确结果 / 参数 / SQL" value={drafts[task.id]?.correctedResult ?? ""} onChange={(e) => setDrafts((cur) => ({ ...cur, [task.id]: { correction: cur[task.id]?.correction ?? "", correctedResult: e.target.value } }))} className="mt-2 w-full rounded-md border border-amber-200 bg-white px-2.5 py-2 font-mono text-[12px] outline-none dark:border-amber-900/60 dark:bg-neutral-950" /><div className="mt-2 flex justify-end"><button type="button" onClick={() => void resume(task)} disabled={busyId === task.id} className="inline-flex h-8 items-center gap-1.5 rounded-md bg-amber-700 px-3 text-[12px] text-white disabled:opacity-40 dark:bg-amber-300 dark:text-amber-950"><RefreshCw className="h-3.5 w-3.5" />继续</button></div></div>}</div>}
    </div>)}</div>
    {preview && <div className="rounded-md border border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900"><div className="flex items-center justify-between border-b border-neutral-200 px-3 py-2 text-[12px] font-medium dark:border-neutral-800"><span>{preview.title}</span><button type="button" onClick={() => setPreview(null)} className="text-neutral-400 hover:text-neutral-700">关闭</button></div><pre className="max-h-80 overflow-auto whitespace-pre-wrap px-3 py-2 text-[12px] leading-5 text-neutral-700 dark:text-neutral-200">{preview.content}</pre></div>}
  </div>;
}
