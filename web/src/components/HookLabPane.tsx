import { useEffect, useMemo, useState } from "react";
import { Archive, Loader2, Play, Plus, Save, Trash2 } from "lucide-react";
import { api } from "@/lib/api";
import { formatEfc, formatEta } from "@/lib/efc";
import { EvalHistoryList, ExportActions, ResultCard, SummaryTable } from "@/components/eval-shared";
import { AheManifestPanel } from "@/components/AheManifestPanel";
import type { Hook, HookEvalCase, HookEvalSet, HookEvaluation, HookEvaluationDetail, HookEvent, HookExpectation } from "@/types";

interface Props {
  workspaceId: string | null;
}

type ExpectationKind = HookExpectation["kind"];
interface DraftCase {
  id: string;
  name: string;
  event: HookEvent;
  payload: string;
  hookIds: string[];
  kind: ExpectationKind;
  reasonPattern: string;
  expectedInput: string;
  expectedHookIds: string;
  count: number;
}

let sequence = 1;
const inputClass = "w-full rounded border border-border bg-background px-2 py-1 text-sm";
const HOOK_EVENTS: HookEvent[] = [
  "tool_call", "tool_execution_start", "tool_execution_end",
  "session_start", "session_shutdown",
  "before_agent_start", "agent_start", "agent_end",
  "turn_start", "turn_end", "message_end",
];
const labels: Record<ExpectationKind, string> = {
  "must-block": "必须拦截",
  "must-allow": "必须放行",
  "golden-mutation": "黄金改参",
  "match": "命中集合",
  "trigger-count": "触发数",
};
const DEFAULT_PAYLOAD = JSON.stringify({ toolName: "bash", input: { command: "rm -rf /" } }, null, 2);

function newCase(): DraftCase {
  return { id: `case_${sequence++}`, name: "", event: "tool_call", payload: DEFAULT_PAYLOAD, hookIds: [], kind: "must-block", reasonPattern: "", expectedInput: "{}", expectedHookIds: "", count: 1 };
}

function lines(value: string): string[] {
  return value.split(/[\n,]/u).map((item) => item.trim()).filter(Boolean);
}

function parseJsonObject(value: string): Record<string, unknown> {
  const parsed = JSON.parse(value) as unknown;
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) throw new Error("payload / expectedInput 必须是 JSON 对象");
  return parsed as Record<string, unknown>;
}

function expectationOf(item: DraftCase): HookExpectation {
  if (item.kind === "must-block") return { kind: item.kind, ...(item.reasonPattern.trim() ? { reasonPattern: item.reasonPattern.trim() } : {}) };
  if (item.kind === "must-allow") return { kind: item.kind };
  if (item.kind === "golden-mutation") return { kind: item.kind, expectedInput: parseJsonObject(item.expectedInput) };
  if (item.kind === "match") return { kind: item.kind, expectedHookIds: lines(item.expectedHookIds) };
  return { kind: item.kind, count: item.count };
}

function caseOf(item: DraftCase): HookEvalCase {
  return {
    id: item.id,
    name: item.name.trim() || item.id,
    event: item.event,
    payload: parseJsonObject(item.payload),
    ...(item.hookIds.length ? { hookIds: item.hookIds } : {}),
    expected: expectationOf(item),
  };
}

function draftOf(item: HookEvalCase): DraftCase {
  const draft: DraftCase = { ...newCase(), id: item.id, name: item.name, event: item.event, payload: JSON.stringify(item.payload, null, 2), hookIds: item.hookIds ?? [], kind: item.expected.kind };
  const expected = item.expected;
  if (expected.kind === "must-block") draft.reasonPattern = expected.reasonPattern ?? "";
  if (expected.kind === "golden-mutation") draft.expectedInput = JSON.stringify(expected.expectedInput, null, 2);
  if (expected.kind === "match") draft.expectedHookIds = expected.expectedHookIds.join("\n");
  if (expected.kind === "trigger-count") draft.count = expected.count;
  return draft;
}

export function HookLabPane(props: Props) {
  const [hooks, setHooks] = useState<Hook[]>([]);
  const [cases, setCases] = useState<DraftCase[]>([newCase()]);
  const [sets, setSets] = useState<HookEvalSet[]>([]);
  const [selectedSetId, setSelectedSetId] = useState("");
  const [setName, setSetName] = useState("");
  const [history, setHistory] = useState<HookEvaluation[]>([]);
  const [result, setResult] = useState<HookEvaluationDetail | null>(null);
  const [repeat, setRepeat] = useState(1);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    if (!props.workspaceId) return;
    let cancelled = false;
    Promise.all([api.listHooks(), api.listHookEvalSets(props.workspaceId), api.listHookEvaluations(props.workspaceId)])
      .then(([hookItems, setItems, evaluations]) => {
        if (cancelled) return;
        setHooks(hookItems);
        setSets(setItems);
        setHistory(evaluations);
      }).catch((caught) => { if (!cancelled) setError(String(caught)); });
    return () => { cancelled = true; };
  }, [props.workspaceId]);

  const built = useMemo(() => {
    try { return { cases: cases.map(caseOf), error: null as string | null }; }
    catch (caught) { return { cases: [] as HookEvalCase[], error: String(caught) }; }
  }, [cases]);
  const canRun = Boolean(props.workspaceId && !built.error && built.cases.length === cases.length && !running);
  const updateCase = (id: string, patch: Partial<DraftCase>) => setCases((current) => current.map((item) => item.id === id ? { ...item, ...patch } : item));

  async function run(): Promise<void> {
    if (!props.workspaceId || !canRun) return;
    setRunning(true); setError(null); setNotice(null);
    try {
      const detail = await api.runHookEvaluation(props.workspaceId, { repeat, cases: built.cases });
      setResult(detail); setHistory((current) => [detail, ...current]);
    } catch (caught) { setError(String(caught)); } finally { setRunning(false); }
  }

  async function saveSet(): Promise<void> {
    if (!props.workspaceId || built.error) return;
    try {
      const created = await api.createHookEvalSet(props.workspaceId, { name: setName.trim() || `集合 ${sets.length + 1}`, cases: built.cases });
      setSets((current) => [created, ...current]); setSelectedSetId(created.id); setSetName(""); setNotice(`已保存「${created.name}」`);
    } catch (caught) { setError(String(caught)); }
  }

  async function updateSet(): Promise<void> {
    if (!selectedSetId || built.error) return;
    try {
      const updated = await api.updateHookEvalSet(selectedSetId, { cases: built.cases });
      setSets((current) => current.map((item) => item.id === updated.id ? updated : item)); setNotice(`已更新「${updated.name}」`);
    } catch (caught) { setError(String(caught)); }
  }

  async function deleteSet(): Promise<void> {
    if (!selectedSetId) return;
    try { await api.deleteHookEvalSet(selectedSetId); setSets((current) => current.filter((item) => item.id !== selectedSetId)); setSelectedSetId(""); setNotice("已删除集合"); } catch (caught) { setError(String(caught)); }
  }

  function loadSet(id: string): void {
    setSelectedSetId(id);
    const selected = sets.find((item) => item.id === id);
    if (selected) setCases(selected.cases.map(draftOf));
  }

  if (!props.workspaceId) return <div className="p-6 text-sm text-muted-foreground">请先选择工作区。</div>;
  return (
    <div className="flex h-full min-w-0 overflow-hidden">
      <aside className="w-[460px] shrink-0 space-y-3 overflow-y-auto border-r border-border p-4">
        <div className="rounded border border-amber-300 bg-amber-50 p-2 text-xs text-amber-800 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-200">护栏单测：仅评判 verdict（拦截 / 改参 / 命中），绝不执行 hook 的 command/notify/log 副作用。</div>
        <div className="flex items-center gap-2 text-sm">
          <span className="text-muted-foreground">repeat</span>
          <input className="w-16 rounded border border-border bg-background px-2" type="number" min={1} max={5} value={repeat} onChange={(event) => setRepeat(Math.max(1, Math.min(5, Number(event.target.value) || 1)))} />
          <span className="text-xs text-muted-foreground">已加载 {hooks.length} 条 hook</span>
        </div>
        {cases.map((item) => <CaseEditor key={item.id} item={item} hooks={hooks} canDelete={cases.length > 1} onChange={(patch) => updateCase(item.id, patch)} onDelete={() => setCases((current) => current.filter((entry) => entry.id !== item.id))} />)}
        {built.error && <div className="rounded border border-red-300 bg-red-50 p-2 text-xs text-red-700">case 解析失败：{built.error}</div>}
        <button className="flex items-center gap-1 rounded border border-dashed border-border px-2 py-1 text-sm" onClick={() => setCases((current) => [...current, newCase()])}><Plus className="h-4 w-4" />添加 case</button>
        <div className="space-y-2 border-t border-border pt-3">
          <div className="flex gap-2"><select className={inputClass} value={selectedSetId} onChange={(event) => loadSet(event.target.value)}><option value="">选择集合…</option>{sets.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select><button title="更新" disabled={!selectedSetId} onClick={() => void updateSet()}><Save className="h-4 w-4" /></button><button title="删除" disabled={!selectedSetId} onClick={() => void deleteSet()}><Trash2 className="h-4 w-4" /></button></div>
          <div className="flex gap-2"><input className={inputClass} placeholder="新集合名" value={setName} onChange={(event) => setSetName(event.target.value)} /><button className="rounded border border-border px-2 text-sm" onClick={() => void saveSet()}>另存</button></div>
        </div>
        <button disabled={!canRun} onClick={() => void run()} className="flex w-full items-center justify-center gap-2 rounded bg-primary px-3 py-2 text-sm text-primary-foreground disabled:opacity-40">{running ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}运行评测</button>
        {error && <div className="rounded border border-red-300 bg-red-50 p-2 text-xs text-red-700">{error}</div>}{notice && <div className="rounded border border-emerald-300 bg-emerald-50 p-2 text-xs text-emerald-700">{notice}</div>}
        <EvalHistoryList items={history} selectedId={result?.evaluationId} onSelect={(item) => void api.getHookEvaluation(item.evaluationId).then(setResult).catch((caught) => setError(String(caught)))} />
      </aside>
      <ResultPanel result={result} onArchive={async () => { if (!result) return; const archived = await api.archiveHookEvaluation(result.evaluationId); setNotice(`已归档到 ${archived.markdownPath}`); }} />
    </div>
  );
}

function CaseEditor({ item, hooks, canDelete, onChange, onDelete }: { item: DraftCase; hooks: Hook[]; canDelete: boolean; onChange: (patch: Partial<DraftCase>) => void; onDelete: () => void }) {
  function toggleHook(id: string, checked: boolean): void {
    onChange({ hookIds: checked ? [...item.hookIds, id] : item.hookIds.filter((hookId) => hookId !== id) });
  }
  return <div className="space-y-2 rounded border border-border p-2">
    <div className="flex gap-2"><input className={inputClass} placeholder="case 名称" value={item.name} onChange={(event) => onChange({ name: event.target.value })} />{canDelete && <button onClick={onDelete}><Trash2 className="h-4 w-4" /></button>}</div>
    <select className={inputClass} value={item.event} onChange={(event) => onChange({ event: event.target.value as HookEvent })}>{HOOK_EVENTS.map((event) => <option key={event} value={event}>{event}</option>)}</select>
    <textarea className={`${inputClass} font-mono`} rows={5} placeholder="payload（JSON 对象：toolName / input / args / reason …）" value={item.payload} onChange={(event) => onChange({ payload: event.target.value })} />
    <div className="space-y-1 rounded border border-border p-2 text-xs">
      <div className="text-muted-foreground">参与的 hook 子集（不勾选 = 全部 enabled）</div>
      {hooks.length === 0 ? <div className="text-muted-foreground">无可用 hook</div> : hooks.map((hook) => <label key={hook.id} className="flex items-center gap-1"><input type="checkbox" checked={item.hookIds.includes(hook.id)} onChange={(event) => toggleHook(hook.id, event.target.checked)} /><span>{hook.name || hook.id} <span className="text-muted-foreground">· {hook.event} · {hook.action.kind}{hook.enabled ? "" : " · disabled"}</span></span></label>)}
    </div>
    <select className={inputClass} value={item.kind} onChange={(event) => onChange({ kind: event.target.value as ExpectationKind })}>{(Object.keys(labels) as ExpectationKind[]).map((kind) => <option key={kind} value={kind}>{labels[kind]}</option>)}</select>
    {item.kind === "must-block" && <input className={inputClass} placeholder="reasonPattern（可选正则）" value={item.reasonPattern} onChange={(event) => onChange({ reasonPattern: event.target.value })} />}
    {item.kind === "golden-mutation" && <textarea className={`${inputClass} font-mono`} rows={4} placeholder="expectedInput（mutate 后 input，JSON 对象）" value={item.expectedInput} onChange={(event) => onChange({ expectedInput: event.target.value })} />}
    {item.kind === "match" && <textarea className={inputClass} rows={2} placeholder="expectedHookIds（每行/逗号一个）" value={item.expectedHookIds} onChange={(event) => onChange({ expectedHookIds: event.target.value })} />}
    {item.kind === "trigger-count" && <input className={inputClass} type="number" min={0} value={item.count} onChange={(event) => onChange({ count: Number(event.target.value) })} />}
  </div>;
}

function ResultPanel({ result, onArchive }: { result: HookEvaluationDetail | null; onArchive: () => Promise<void> }) {
  if (!result) return <main className="flex flex-1 items-center justify-center text-sm text-muted-foreground">运行后展示每个 case 的 verdict 与断言结果。</main>;
  return <main className="min-w-0 flex-1 space-y-4 overflow-y-auto p-4">
    <AheManifestPanel component="hook" lab="hook" currentEvaluationId={result.evaluationId} />
    <div className="flex items-center justify-between"><div className="text-sm"><span className={result.status === "success" ? "text-emerald-600" : "text-red-600"}>{result.status}</span><span className="ml-2 text-muted-foreground">repeat {result.repeat} · {result.durationSec.toFixed(2)}s</span></div><ExportActions actions={[{ key: "archive", label: <><Archive className="h-3.5 w-3.5" />归档</>, onClick: () => void onArchive() }]} /></div>
    <SummaryTable rows={result.caseSummaries} rowKey={(item) => item.caseId} columns={[{ key: "case", label: "Case", className: "font-medium", render: (item) => item.caseName }, { key: "success", label: "Success", render: (item) => `${item.success}/${item.total}` }, { key: "failed", label: "Failed", render: (item) => item.failed }, { key: "efc", label: "EFC", render: (item) => formatEfc(item) }, { key: "eta", label: "η", render: (item) => formatEta(item) }, { key: "duration", label: "Avg s", render: (item) => item.avgDurationSec.toFixed(2) }]} />
    <div className="grid gap-2 md:grid-cols-2">{result.results.map((item) => <ResultCard key={item.id} title={`${item.caseName} · #${item.attempt}`} status={item.status} meta={<>期望 {item.expectation.kind} · 触发 {item.triggerCount} · {item.blocked ? "已拦截" : "放行"}</>}>{item.blockReason && <div>拦截原因：{item.blockReason}</div>}<div><div className="mb-1 text-muted-foreground">命中 hook</div><div className="flex flex-wrap gap-1">{item.matchedHookIds.length ? item.matchedHookIds.map((hookId) => <span key={hookId} className="rounded bg-sky-100 px-2 py-1 text-sky-800 dark:bg-sky-950 dark:text-sky-200">{hookId}</span>) : <span className="text-muted-foreground">无</span>}</div></div>{item.sideEffectKinds.length > 0 && <div className="text-muted-foreground">旁路动作（仅枚举，未执行）：{item.sideEffectKinds.join(", ")}</div>}{item.mutatedInput && <div><div className="mb-1 text-muted-foreground">mutate 后 input</div><pre className="whitespace-pre-wrap rounded bg-muted p-2">{JSON.stringify(item.mutatedInput, null, 2)}</pre></div>}{item.error && <div className="rounded bg-red-50 p-2 text-red-700">{item.error.message}{item.error.hint ? ` · ${item.error.hint}` : ""}</div>}</ResultCard>)}</div>
  </main>;
}
