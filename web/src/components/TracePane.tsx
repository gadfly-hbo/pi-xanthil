import { useCallback, useEffect, useMemo, useState } from "react";
import { Activity, AlertTriangle, BellRing, Bot, CheckCircle2, Clock3, GitBranch, ListTree, MousePointerClick, RefreshCw, Route, ScrollText, ServerCrash, Sparkles, Workflow, XCircle } from "lucide-react";
import { api } from "@/lib/api";
import type { TraceEvent, TraceFailure, TraceOverview, TraceRuleSuggestion, TraceTimelineItem, TraceTrendPoint } from "@/types";

const emptyOverview: TraceOverview = {
  todaySessions: 0,
  todayFlowRuns: 0,
  runningRuns: 0,
  successRuns: 0,
  failedRuns: 0,
  errorEvents: 0,
  recentActivityAt: null,
};

function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function formatAgo(ts: number | null): string {
  if (!ts) return "-";
  const minutes = Math.floor(Math.max(0, Date.now() - ts) / 60000);
  if (minutes < 1) return "now";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  return hours < 24 ? `${hours}h` : `${Math.floor(hours / 24)}d`;
}

function StatusPill({ status }: { status: string }) {
  const style = status === "success"
    ? "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-300"
    : status === "failed"
      ? "border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-900 dark:bg-rose-950/30 dark:text-rose-300"
      : status === "idle"
        ? "border-neutral-200 bg-neutral-50 text-neutral-600 dark:border-neutral-800 dark:bg-neutral-950/30 dark:text-neutral-400"
        : "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-300";
  return <span className={`rounded-full border px-2 py-0.5 text-[11px] ${style}`}>{status}</span>;
}

function iconForEvent(type: string) {
  if (type.includes("run")) return Route;
  if (type.includes("runtime")) return Bot;
  if (type.includes("error")) return XCircle;
  if (type.includes("flow")) return Workflow;
  if (type.includes("session")) return MousePointerClick;
  return ListTree;
}

function toneForEvent(status: string) {
  if (status === "failed") return "text-rose-500";
  if (status === "running" || status === "compacting") return "text-amber-500";
  if (status === "success") return "text-emerald-500";
  return "text-neutral-400";
}

export function TracePane({ workspaceId, onRulesChanged }: { workspaceId: string | null; onRulesChanged?: () => void }) {
  const [overview, setOverview] = useState<TraceOverview>(emptyOverview);
  const [events, setEvents] = useState<TraceEvent[]>([]);
  const [failures, setFailures] = useState<TraceFailure[]>([]);
  const [trend, setTrend] = useState<TraceTrendPoint[]>([]);
  const [rules, setRules] = useState<TraceRuleSuggestion[]>([]);
  const [selectedRuleIds, setSelectedRuleIds] = useState<string[]>([]);
  const [stagedRules, setStagedRules] = useState<TraceRuleSuggestion[]>([]);
  const [selectedEvent, setSelectedEvent] = useState<TraceEvent | null>(null);
  const [timelineItems, setTimelineItems] = useState<TraceTimelineItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [ruleLoading, setRuleLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  const [writeResult, setWriteResult] = useState("");
  const [eventTypeFilter, setEventTypeFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [errorTypeFilter, setErrorTypeFilter] = useState("all");
  const [keyword, setKeyword] = useState("");
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    if (!workspaceId) return;
    setLoading(true);
    setError("");
    try {
      const [nextOverview, nextEvents, nextFailures, nextTrend] = await Promise.all([
        api.getTraceOverview(workspaceId),
        api.listTraceRecentEvents(workspaceId, 20),
        api.listTraceFailures(workspaceId, 10),
        api.getTraceTrend(workspaceId, 14),
      ]);
      setOverview(nextOverview);
      setEvents(nextEvents);
      setFailures(nextFailures);
      setTrend(nextTrend);
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }, [workspaceId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const generateRules = useCallback(async () => {
    if (!workspaceId) return;
    setRuleLoading(true);
    setError("");
    try {
      const nextRules = await api.generateTraceRuleSuggestions(workspaceId);
      setRules(nextRules);
      setSelectedRuleIds(nextRules.map((rule) => rule.id));
    } catch (err) {
      setError(String(err));
    } finally {
      setRuleLoading(false);
    }
  }, [workspaceId]);

  const openTimeline = useCallback(async (event: TraceEvent) => {
    if (!workspaceId) return;
    setSelectedEvent(event);
    setError("");
    try {
      setTimelineItems(await api.getTraceTimeline(workspaceId, event.targetKind, event.targetId));
    } catch (err) {
      setError(String(err));
    }
  }, [workspaceId]);

  const selectedRules = useMemo(() => rules.filter((rule) => selectedRuleIds.includes(rule.id)), [rules, selectedRuleIds]);

  const toggleRule = useCallback((id: string) => {
    setSelectedRuleIds((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);
  }, []);

  const stageSelectedRules = useCallback(() => {
    setStagedRules((current) => {
      const ids = new Set(current.map((rule) => rule.id));
      return [...current, ...selectedRules.filter((rule) => !ids.has(rule.id))];
    });
  }, [selectedRules]);

  const copySelectedRules = useCallback(async () => {
    const body = selectedRules.map((rule, index) => `${index + 1}. ${rule.title}\n   - 依据：${rule.evidence}\n   - severity: ${rule.severity}`).join("\n");
    await navigator.clipboard.writeText(body);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1200);
  }, [selectedRules]);

  const writeStagedRules = useCallback(async () => {
    if (!workspaceId || stagedRules.length === 0) return;
    const results = await Promise.all(stagedRules.map((rule) => api.createRule(workspaceId, {
      title: rule.title,
      evidence: rule.evidence,
      source: "trace",
      severity: rule.severity,
      scope: "global",
    })));
    const created = results.filter((result) => result.created).length;
    const skipped = results.length - created;
    setWriteResult(`已写入 ${created} 条${skipped > 0 ? `，跳过重复 ${skipped} 条` : ""}`);
    setStagedRules([]);
    onRulesChanged?.();
  }, [onRulesChanged, stagedRules, workspaceId]);

  const eventTypes = useMemo(() => ["all", ...Array.from(new Set(events.map((event) => event.type))).sort()], [events]);
  const statuses = useMemo(() => ["all", ...Array.from(new Set(events.map((event) => event.status))).sort()], [events]);
  const errorTypes = useMemo(() => ["all", ...Array.from(new Set(failures.map((failure) => failure.errorType))).sort()], [failures]);
  const normalizedKeyword = keyword.trim().toLowerCase();
  const filteredEvents = useMemo(() => events.filter((event) => {
    if (eventTypeFilter !== "all" && event.type !== eventTypeFilter) return false;
    if (statusFilter !== "all" && event.status !== statusFilter) return false;
    if (!normalizedKeyword) return true;
    return [event.type, event.target, event.detail ?? "", event.targetKind, event.targetId].some((value) => value.toLowerCase().includes(normalizedKeyword));
  }), [eventTypeFilter, events, normalizedKeyword, statusFilter]);
  const filteredFailures = useMemo(() => failures.filter((failure) => {
    if (errorTypeFilter !== "all" && failure.errorType !== errorTypeFilter) return false;
    if (!normalizedKeyword) return true;
    return [failure.title, failure.source, failure.errorType].some((value) => value.toLowerCase().includes(normalizedKeyword));
  }), [errorTypeFilter, failures, normalizedKeyword]);
  const maxTrend = Math.max(1, ...trend.flatMap((point) => [point.sessions, point.runs, point.failures, point.events]));
  const kpis = [
    { label: "今日 Sessions", value: overview.todaySessions.toLocaleString(), sub: "created today", tone: "bg-sky-500", icon: Activity },
    { label: "Workflow Runs", value: overview.todayFlowRuns.toLocaleString(), sub: `${overview.runningRuns} running / ${overview.successRuns} success`, tone: "bg-indigo-500", icon: Workflow },
    { label: "失败事件", value: overview.errorEvents.toLocaleString(), sub: `${overview.failedRuns} failed runs`, tone: "bg-rose-500", icon: ServerCrash },
    { label: "最近活动", value: formatAgo(overview.recentActivityAt), sub: overview.recentActivityAt ? new Date(overview.recentActivityAt).toLocaleString() : "no activity", tone: "bg-emerald-500", icon: Clock3 },
  ];
  const timeline = timelineItems.length > 0 ? timelineItems : filteredEvents.slice(0, 5).map((event) => ({ id: event.id, time: event.time, type: event.type, title: event.target, detail: event.detail, status: event.status }));

  return (
    <div className="flex min-h-0 flex-1 overflow-auto bg-[radial-gradient(circle_at_top_right,rgba(14,165,233,0.10),transparent_28%),linear-gradient(180deg,rgba(250,250,250,0.95),rgba(245,245,245,0.75))] p-5 dark:bg-[radial-gradient(circle_at_top_right,rgba(56,189,248,0.10),transparent_30%),linear-gradient(180deg,#05070a,#0a0a0a)]">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-4">
        <div className="flex flex-wrap items-start justify-between gap-4 rounded-xl border border-neutral-200 bg-white/80 p-4 shadow-sm backdrop-blur dark:border-neutral-800 dark:bg-neutral-900/70">
          <div>
            <div className="inline-flex items-center gap-1.5 rounded-full border border-sky-200 bg-sky-50 px-2 py-1 text-[11px] font-medium text-sky-700 dark:border-sky-900 dark:bg-sky-950/40 dark:text-sky-300"><GitBranch className="h-3 w-3" /> pi-xanthil trace kernel</div>
            <h1 className="mt-3 flex items-center gap-2 text-lg font-semibold text-neutral-950 dark:text-neutral-50"><Route className="h-5 w-5 text-sky-500" /> Trace 运行追踪</h1>
            <p className="mt-1 max-w-2xl text-[12.5px] text-neutral-500 dark:text-neutral-400">追踪 pi-xanthil 自身 DB / API / WebSocket 事件，定位 workflow、session、agent step 的运行状态与失败模式。</p>
          </div>
          <button onClick={refresh} disabled={!workspaceId || loading} className="inline-flex items-center gap-1.5 rounded-md border border-neutral-200 bg-white px-3 py-2 text-[12px] font-medium text-neutral-700 shadow-sm hover:bg-neutral-50 disabled:opacity-50 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-300"><RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} /> 刷新 trace</button>
        </div>

        {error && <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-[12px] text-red-600 dark:border-red-900 dark:bg-red-950/30">{error}</div>}
        {writeResult && <div className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-[12px] text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-300">{writeResult}</div>}

        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-neutral-200 bg-white/80 p-3 shadow-sm dark:border-neutral-800 dark:bg-neutral-900/70">
          <input value={keyword} onChange={(event) => setKeyword(event.target.value)} placeholder="搜索事件 / 失败 / target..." className="h-8 min-w-56 rounded-md border border-neutral-200 bg-transparent px-2 text-[12px] outline-none dark:border-neutral-700" />
          <select value={eventTypeFilter} onChange={(event) => setEventTypeFilter(event.target.value)} className="h-8 rounded-md border border-neutral-200 bg-transparent px-2 text-[12px] dark:border-neutral-700">{eventTypes.map((type) => <option key={type} value={type}>event: {type}</option>)}</select>
          <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} className="h-8 rounded-md border border-neutral-200 bg-transparent px-2 text-[12px] dark:border-neutral-700">{statuses.map((status) => <option key={status} value={status}>status: {status}</option>)}</select>
          <select value={errorTypeFilter} onChange={(event) => setErrorTypeFilter(event.target.value)} className="h-8 rounded-md border border-neutral-200 bg-transparent px-2 text-[12px] dark:border-neutral-700">{errorTypes.map((type) => <option key={type} value={type}>error: {type}</option>)}</select>
          <button onClick={() => { setKeyword(""); setEventTypeFilter("all"); setStatusFilter("all"); setErrorTypeFilter("all"); }} className="h-8 rounded-md px-2 text-[12px] text-neutral-500 hover:bg-neutral-100 dark:hover:bg-neutral-800">清空过滤</button>
        </div>

        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">{kpis.map((item) => { const Icon = item.icon; return <div key={item.label} className="rounded-xl border border-neutral-200 bg-white p-4 shadow-sm dark:border-neutral-800 dark:bg-neutral-900"><div className="flex items-center justify-between"><div className={`flex h-9 w-9 items-center justify-center rounded-lg ${item.tone}`}><Icon className="h-4 w-4 text-white" /></div><span className="text-[11px] text-neutral-400">live</span></div><div className="mt-3 text-[11px] text-neutral-500">{item.label}</div><div className="mt-1 text-2xl font-semibold tabular-nums text-neutral-950 dark:text-neutral-50">{item.value}</div><div className="mt-1 text-[11px] text-neutral-400">{item.sub}</div></div>; })}</div>

        <section className="rounded-xl border border-neutral-200 bg-white p-4 shadow-sm dark:border-neutral-800 dark:bg-neutral-900">
          <div className="mb-3 flex items-center justify-between"><h2 className="flex items-center gap-2 text-[13px] font-semibold text-neutral-900 dark:text-neutral-100"><Activity className="h-4 w-4 text-indigo-500" /> Trace 趋势</h2><span className="text-[11px] text-neutral-400">最近 14 天</span></div>
          <div className="grid min-h-44 items-end gap-2" style={{ gridTemplateColumns: `repeat(${Math.max(1, trend.length)}, minmax(0, 1fr))` }}>{trend.map((point) => <div key={point.day} className="flex min-w-0 flex-col items-center gap-2"><div className="flex h-32 w-full max-w-10 items-end gap-0.5"><div title={`sessions ${point.sessions}`} className="w-1/4 rounded-t bg-sky-400" style={{ height: `${Math.max(3, (point.sessions / maxTrend) * 100)}%` }} /><div title={`runs ${point.runs}`} className="w-1/4 rounded-t bg-indigo-400" style={{ height: `${Math.max(3, (point.runs / maxTrend) * 100)}%` }} /><div title={`failures ${point.failures}`} className="w-1/4 rounded-t bg-rose-400" style={{ height: `${Math.max(3, (point.failures / maxTrend) * 100)}%` }} /><div title={`events ${point.events}`} className="w-1/4 rounded-t bg-emerald-400" style={{ height: `${Math.max(3, (point.events / maxTrend) * 100)}%` }} /></div><span className="truncate text-[10px] text-neutral-400">{point.day.slice(5)}</span></div>)}</div>
          <div className="mt-3 flex flex-wrap gap-3 text-[11px] text-neutral-500"><span className="flex items-center gap-1"><span className="h-2.5 w-2.5 rounded bg-sky-400" />sessions</span><span className="flex items-center gap-1"><span className="h-2.5 w-2.5 rounded bg-indigo-400" />runs</span><span className="flex items-center gap-1"><span className="h-2.5 w-2.5 rounded bg-rose-400" />failures</span><span className="flex items-center gap-1"><span className="h-2.5 w-2.5 rounded bg-emerald-400" />events</span></div>
        </section>

        <div className="grid gap-4 xl:grid-cols-[1.15fr_0.85fr]">
          <section className="rounded-xl border border-neutral-200 bg-white p-4 shadow-sm dark:border-neutral-800 dark:bg-neutral-900"><div className="mb-3 flex items-center justify-between"><h2 className="flex items-center gap-2 text-[13px] font-semibold text-neutral-900 dark:text-neutral-100"><BellRing className="h-4 w-4 text-sky-500" /> 最近事件流</h2><span className="text-[11px] text-neutral-400">DB / API / WS</span></div><div className="overflow-hidden rounded-lg border border-neutral-100 dark:border-neutral-800">{filteredEvents.length === 0 ? <div className="px-3 py-10 text-center text-[12px] text-neutral-400">暂无匹配 trace 事件</div> : filteredEvents.map((row) => <button key={row.id} onClick={() => void openTimeline(row)} className={`grid w-full grid-cols-[5rem_8rem_minmax(0,1fr)_5rem] items-center gap-3 border-b border-neutral-100 px-3 py-2.5 text-left text-[12px] last:border-b-0 hover:bg-neutral-50 dark:border-neutral-800 dark:hover:bg-neutral-800/30 ${selectedEvent?.id === row.id ? "bg-sky-50/70 dark:bg-sky-950/20" : ""}`}><span className="font-mono text-neutral-400">{formatTime(row.time)}</span><span className="truncate font-mono text-neutral-700 dark:text-neutral-300">{row.type}</span><span className="truncate text-neutral-500" title={row.detail ?? undefined}>{row.target}</span><StatusPill status={row.status} /></button>)}</div></section>
          <section className="rounded-xl border border-neutral-200 bg-white p-4 shadow-sm dark:border-neutral-800 dark:bg-neutral-900"><h2 className="flex items-center gap-2 text-[13px] font-semibold text-neutral-900 dark:text-neutral-100"><AlertTriangle className="h-4 w-4 text-rose-500" /> 失败分析</h2><div className="mt-3 space-y-3">{filteredFailures.length === 0 ? <div className="rounded-lg border border-neutral-100 bg-neutral-50 p-8 text-center text-[12px] text-neutral-400 dark:border-neutral-800 dark:bg-neutral-950/40">暂无匹配失败聚合</div> : filteredFailures.map((item) => <div key={item.id} className="rounded-lg border border-neutral-100 bg-neutral-50 p-3 dark:border-neutral-800 dark:bg-neutral-950/40"><div className="flex items-start justify-between gap-3"><p className="line-clamp-2 text-[12.5px] font-medium text-neutral-800 dark:text-neutral-200">{item.title}</p><span className="rounded-full bg-rose-100 px-2 py-0.5 text-[11px] font-medium text-rose-700 dark:bg-rose-950 dark:text-rose-300">{item.count}x</span></div><div className="mt-2 flex flex-wrap items-center gap-2"><span className="rounded border border-neutral-200 bg-white px-1.5 py-0.5 font-mono text-[10.5px] text-neutral-500 dark:border-neutral-700 dark:bg-neutral-900">{item.errorType}</span><span className="font-mono text-[11px] text-neutral-400">{item.source} · {new Date(item.lastSeenAt).toLocaleString()}</span></div></div>)}</div></section>
        </div>

        <div className="grid gap-4 xl:grid-cols-[0.9fr_1.1fr]">
          <section className="rounded-xl border border-neutral-200 bg-white p-4 shadow-sm dark:border-neutral-800 dark:bg-neutral-900"><div className="flex items-center justify-between gap-3"><h2 className="flex items-center gap-2 text-[13px] font-semibold text-neutral-900 dark:text-neutral-100"><ScrollText className="h-4 w-4 text-indigo-500" /> Session / Flow Timeline</h2><span className="truncate text-[11px] text-neutral-400">{selectedEvent ? selectedEvent.target : "最近事件预览"}</span></div><div className="mt-4 space-y-4">{timeline.length === 0 ? <div className="py-10 text-center text-[12px] text-neutral-400">暂无 timeline</div> : timeline.map((item, index) => { const Icon = iconForEvent(item.type); return <div key={item.id} className="relative flex gap-3">{index < timeline.length - 1 && <div className="absolute left-[15px] top-8 h-full w-px bg-neutral-200 dark:bg-neutral-800" />}<div className="relative z-10 flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-neutral-200 bg-white dark:border-neutral-700 dark:bg-neutral-900"><Icon className={`h-4 w-4 ${toneForEvent(item.status)}`} /></div><div className="min-w-0 pt-0.5"><div className="font-mono text-[12px] font-medium text-neutral-800 dark:text-neutral-200">{formatTime(item.time)} · {item.type}</div><div className="mt-0.5 truncate text-[12px] text-neutral-500">{item.title}{item.detail ? ` · ${item.detail}` : ""}</div></div></div>; })}</div></section>
          <section className="rounded-xl border border-amber-200 bg-amber-50/70 p-4 shadow-sm dark:border-amber-900 dark:bg-amber-950/20"><div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="flex items-center gap-2 text-[13px] font-semibold text-amber-950 dark:text-amber-100"><Sparkles className="h-4 w-4 text-amber-500" /> 规则提炼</h2><p className="mt-1 text-[12px] text-amber-800/70 dark:text-amber-200/70">用户手动点击后，根据 trace 证据提炼可进入 rules / system prompt 的规则建议。</p></div><div className="flex flex-wrap gap-2"><button onClick={copySelectedRules} disabled={selectedRules.length === 0} className="rounded-md border border-amber-300 bg-white/70 px-3 py-2 text-[12px] font-medium text-amber-900 hover:bg-white disabled:opacity-50 dark:border-amber-800 dark:bg-neutral-950/40 dark:text-amber-100">{copied ? "已复制" : "复制选中"}</button><button onClick={stageSelectedRules} disabled={selectedRules.length === 0} className="rounded-md border border-amber-300 bg-white/70 px-3 py-2 text-[12px] font-medium text-amber-900 hover:bg-white disabled:opacity-50 dark:border-amber-800 dark:bg-neutral-950/40 dark:text-amber-100">暂存选中</button><button onClick={generateRules} disabled={!workspaceId || ruleLoading} className="inline-flex items-center gap-1.5 rounded-md bg-amber-900 px-3 py-2 text-[12px] font-medium text-white hover:bg-amber-800 disabled:opacity-50 dark:bg-amber-200 dark:text-amber-950"><RefreshCw className={`h-3.5 w-3.5 ${ruleLoading ? "animate-spin" : ""}`} /> 更新规则提炼</button></div></div><div className="mt-4 space-y-3">{rules.length === 0 ? <div className="rounded-lg border border-amber-200 bg-white/75 p-8 text-center text-[12px] text-amber-800/70 dark:border-amber-900 dark:bg-neutral-950/50 dark:text-amber-200/70">点击“更新规则提炼”后生成基于 trace 证据的规则建议</div> : rules.map((rule) => { const selected = selectedRuleIds.includes(rule.id); return <button key={rule.id} onClick={() => toggleRule(rule.id)} className={`w-full rounded-lg border p-3 text-left transition-colors ${selected ? "border-amber-400 bg-white dark:border-amber-700 dark:bg-neutral-950/70" : "border-amber-200 bg-white/75 dark:border-amber-900 dark:bg-neutral-950/50"}`}><div className="flex gap-2"><CheckCircle2 className={`mt-0.5 h-4 w-4 shrink-0 ${selected ? "text-emerald-500" : "text-neutral-300"}`} /><div><div className="flex flex-wrap items-center gap-2"><p className="text-[12.5px] font-medium leading-5 text-neutral-900 dark:text-neutral-100">{rule.title}</p><span className="rounded border border-amber-200 px-1.5 py-0.5 text-[10.5px] text-amber-800 dark:border-amber-800 dark:text-amber-200">{rule.severity}</span></div><p className="mt-1 text-[11.5px] leading-5 text-neutral-500 dark:text-neutral-400">依据：{rule.evidence}</p></div></div></button>; })}</div>{stagedRules.length > 0 && <div className="mt-4 rounded-lg border border-amber-300 bg-white/80 p-3 dark:border-amber-800 dark:bg-neutral-950/60"><div className="flex items-center justify-between gap-3"><h3 className="text-[12px] font-semibold text-amber-950 dark:text-amber-100">暂存规则 ({stagedRules.length})</h3><button onClick={() => void writeStagedRules()} className="text-[11px] text-amber-700 hover:underline dark:text-amber-300">写入 rules</button><button onClick={() => setStagedRules([])} className="text-[11px] text-amber-700 hover:underline dark:text-amber-300">清空</button></div><ol className="mt-2 list-decimal space-y-1 pl-4 text-[11.5px] text-neutral-600 dark:text-neutral-300">{stagedRules.map((rule) => <li key={rule.id}>{rule.title}</li>)}</ol></div>}</section>
        </div>
      </div>
    </div>
  );
}
