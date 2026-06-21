import { useEffect, useMemo, useState } from "react";
import { Archive, Loader2, Play, Plus, Save, Trash2 } from "lucide-react";
import { api } from "@/lib/api";
import { EvalHistoryList, ExportActions, ResultCard, SummaryTable } from "@/components/eval-shared";
import type { PiModel, SubAgentEvalCase, SubAgentEvalSet, SubAgentEvaluation, SubAgentEvaluationDetail, SubAgentExpectation, SubAgentTemplate } from "@/types";

interface Props {
  workspaceId: string | null;
  model: string;
  models: PiModel[];
}

type ExpectationKind = SubAgentExpectation["kind"];
interface DraftCase {
  id: string;
  name: string;
  templateId: string;
  personaOverride: string;
  toolIds: string;
  brief: string;
  dataFiles: string;
  kind: ExpectationKind;
  required: string;
  forbidden: string;
  ordered: boolean;
  maxSteps: number;
  maxTokens: number;
  rubric: string;
  judgeModel: string;
  minScore: number;
}

let sequence = 1;
const inputClass = "w-full rounded border border-border bg-background px-2 py-1 text-sm";
const labels: Record<ExpectationKind, string> = {
  "tool-sequence": "工具序列",
  "step-budget": "步骤预算",
  "token-budget": "Token 预算",
  "report-presence": "报告存在",
  "llm-judge": "LLM 评分",
};

function newCase(): DraftCase {
  return { id: `case_${sequence++}`, name: "", templateId: "", personaOverride: "", toolIds: "", brief: "", dataFiles: "", kind: "tool-sequence", required: "read\nwrite", forbidden: "", ordered: true, maxSteps: 10, maxTokens: 8000, rubric: "结论正确且有数据依据", judgeModel: "", minScore: 70 };
}

function lines(value: string): string[] {
  return value.split(/[\n,]/u).map((item) => item.trim()).filter(Boolean);
}

function fileLines(value: string): string[] {
  return value.split(/\r?\n/u).map((item) => item.trim()).filter(Boolean);
}

function expectationOf(item: DraftCase): SubAgentExpectation {
  if (item.kind === "tool-sequence") return { kind: item.kind, required: lines(item.required), forbidden: lines(item.forbidden), ...(item.ordered ? { orderedSubsequence: true } : {}) };
  if (item.kind === "step-budget") return { kind: item.kind, maxSteps: item.maxSteps };
  if (item.kind === "token-budget") return { kind: item.kind, maxTokens: item.maxTokens };
  if (item.kind === "report-presence") return { kind: item.kind };
  return { kind: item.kind, rubric: item.rubric, model: item.judgeModel, minScore: item.minScore };
}

function caseOf(item: DraftCase): SubAgentEvalCase {
  return {
    id: item.id,
    name: item.name.trim() || item.id,
    ...(item.templateId ? { templateId: item.templateId } : { personaOverride: item.personaOverride.trim() }),
    ...(!item.templateId ? { toolIdsOverride: lines(item.toolIds) } : {}),
    brief: item.brief.trim(),
    dataFiles: fileLines(item.dataFiles),
    expected: expectationOf(item),
  };
}

function draftOf(item: SubAgentEvalCase): DraftCase {
  const draft = { ...newCase(), id: item.id, name: item.name, templateId: item.templateId ?? "", personaOverride: item.personaOverride ?? "", toolIds: (item.toolIdsOverride ?? []).join("\n"), brief: item.brief, dataFiles: item.dataFiles.join("\n"), kind: item.expected.kind };
  const expected = item.expected;
  if (expected.kind === "tool-sequence") { draft.required = (expected.required ?? []).join("\n"); draft.forbidden = (expected.forbidden ?? []).join("\n"); draft.ordered = expected.orderedSubsequence ?? false; }
  if (expected.kind === "step-budget") draft.maxSteps = expected.maxSteps;
  if (expected.kind === "token-budget") draft.maxTokens = expected.maxTokens;
  if (expected.kind === "llm-judge") { draft.rubric = expected.rubric; draft.judgeModel = expected.model; draft.minScore = expected.minScore ?? 70; }
  return draft;
}

export function SubAgentLabPane(props: Props) {
  const [templates, setTemplates] = useState<SubAgentTemplate[]>([]);
  const [cases, setCases] = useState<DraftCase[]>([newCase()]);
  const [sets, setSets] = useState<SubAgentEvalSet[]>([]);
  const [selectedSetId, setSelectedSetId] = useState("");
  const [setName, setSetName] = useState("");
  const [history, setHistory] = useState<SubAgentEvaluation[]>([]);
  const [result, setResult] = useState<SubAgentEvaluationDetail | null>(null);
  const [model, setModel] = useState(props.model);
  const [repeat, setRepeat] = useState(1);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    if (!props.workspaceId) return;
    let cancelled = false;
    Promise.all([api.listSubAgents(), api.listSubAgentEvalSets(props.workspaceId), api.listSubAgentEvaluations(props.workspaceId)])
      .then(([templateItems, setItems, evaluations]) => {
        if (cancelled) return;
        setTemplates(templateItems.filter((item) => item.enabled));
        setSets(setItems);
        setHistory(evaluations);
      }).catch((caught) => { if (!cancelled) setError(String(caught)); });
    return () => { cancelled = true; };
  }, [props.workspaceId]);

  const builtCases = useMemo(() => cases.map(caseOf), [cases]);
  const canRun = Boolean(props.workspaceId && model && builtCases.every((item) => item.brief && (item.templateId || item.personaOverride)) && !running);
  const updateCase = (id: string, patch: Partial<DraftCase>) => setCases((current) => current.map((item) => item.id === id ? { ...item, ...patch } : item));

  async function run(): Promise<void> {
    if (!props.workspaceId || !canRun) return;
    setRunning(true); setError(null); setNotice(null);
    try {
      const detail = await api.runSubAgentEvaluation(props.workspaceId, { model, repeat, cases: builtCases });
      setResult(detail); setHistory((current) => [detail, ...current]);
    } catch (caught) { setError(String(caught)); } finally { setRunning(false); }
  }

  async function saveSet(): Promise<void> {
    if (!props.workspaceId) return;
    try {
      const created = await api.createSubAgentEvalSet(props.workspaceId, { name: setName.trim() || `集合 ${sets.length + 1}`, cases: builtCases });
      setSets((current) => [created, ...current]); setSelectedSetId(created.id); setSetName(""); setNotice(`已保存「${created.name}」`);
    } catch (caught) { setError(String(caught)); }
  }

  async function updateSet(): Promise<void> {
    if (!selectedSetId) return;
    try {
      const updated = await api.updateSubAgentEvalSet(selectedSetId, { cases: builtCases });
      setSets((current) => current.map((item) => item.id === updated.id ? updated : item)); setNotice(`已更新「${updated.name}」`);
    } catch (caught) { setError(String(caught)); }
  }

  async function deleteSet(): Promise<void> {
    if (!selectedSetId) return;
    try { await api.deleteSubAgentEvalSet(selectedSetId); setSets((current) => current.filter((item) => item.id !== selectedSetId)); setSelectedSetId(""); setNotice("已删除集合"); } catch (caught) { setError(String(caught)); }
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
        <div className="flex gap-2">
          <select className={inputClass} value={model} onChange={(event) => setModel(event.target.value)}>{props.models.map((item) => <option key={item.id} value={item.id}>{item.id}</option>)}</select>
          <input className="w-16 rounded border border-border bg-background px-2" type="number" min={1} max={5} value={repeat} onChange={(event) => setRepeat(Math.max(1, Math.min(5, Number(event.target.value) || 1)))} />
        </div>
        {cases.map((item) => <CaseEditor key={item.id} item={item} templates={templates} canDelete={cases.length > 1} onChange={(patch) => updateCase(item.id, patch)} onDelete={() => setCases((current) => current.filter((entry) => entry.id !== item.id))} />)}
        <button className="flex items-center gap-1 rounded border border-dashed border-border px-2 py-1 text-sm" onClick={() => setCases((current) => [...current, newCase()])}><Plus className="h-4 w-4" />添加 case</button>
        <div className="space-y-2 border-t border-border pt-3">
          <div className="flex gap-2"><select className={inputClass} value={selectedSetId} onChange={(event) => loadSet(event.target.value)}><option value="">选择集合…</option>{sets.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select><button title="更新" disabled={!selectedSetId} onClick={() => void updateSet()}><Save className="h-4 w-4" /></button><button title="删除" disabled={!selectedSetId} onClick={() => void deleteSet()}><Trash2 className="h-4 w-4" /></button></div>
          <div className="flex gap-2"><input className={inputClass} placeholder="新集合名" value={setName} onChange={(event) => setSetName(event.target.value)} /><button className="rounded border border-border px-2 text-sm" onClick={() => void saveSet()}>另存</button></div>
        </div>
        <button disabled={!canRun} onClick={() => void run()} className="flex w-full items-center justify-center gap-2 rounded bg-primary px-3 py-2 text-sm text-primary-foreground disabled:opacity-40">{running ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}运行评测</button>
        {error && <div className="rounded border border-red-300 bg-red-50 p-2 text-xs text-red-700">{error}</div>}{notice && <div className="rounded border border-emerald-300 bg-emerald-50 p-2 text-xs text-emerald-700">{notice}</div>}
        <EvalHistoryList items={history} selectedId={result?.evaluationId} onSelect={(item) => void api.getSubAgentEvaluation(item.evaluationId).then(setResult).catch((caught) => setError(String(caught)))} />
      </aside>
      <ResultPanel result={result} onArchive={async () => { if (!result) return; const archived = await api.archiveSubAgentEvaluation(result.evaluationId); setNotice(`已归档到 ${archived.markdownPath}`); }} />
    </div>
  );
}

function CaseEditor({ item, templates, canDelete, onChange, onDelete }: { item: DraftCase; templates: SubAgentTemplate[]; canDelete: boolean; onChange: (patch: Partial<DraftCase>) => void; onDelete: () => void }) {
  return <div className="space-y-2 rounded border border-border p-2">
    <div className="flex gap-2"><input className={inputClass} placeholder="case 名称" value={item.name} onChange={(event) => onChange({ name: event.target.value })} />{canDelete && <button onClick={onDelete}><Trash2 className="h-4 w-4" /></button>}</div>
    <select className={inputClass} value={item.templateId} onChange={(event) => onChange({ templateId: event.target.value })}><option value="">临时 persona</option>{templates.map((template) => <option key={template.id} value={template.id}>{template.name}</option>)}</select>
    {!item.templateId && <><textarea className={inputClass} rows={2} placeholder="persona（必填）" value={item.personaOverride} onChange={(event) => onChange({ personaOverride: event.target.value })} /><input className={inputClass} placeholder="toolIds 白名单（逗号分隔；空=无工具）" value={item.toolIds} onChange={(event) => onChange({ toolIds: event.target.value })} /></>}
    <textarea className={inputClass} rows={3} placeholder="brief" value={item.brief} onChange={(event) => onChange({ brief: event.target.value })} />
    <textarea className={inputClass} rows={2} placeholder="clean_data 文件路径（每行一个；draw_data 会拒绝）" value={item.dataFiles} onChange={(event) => onChange({ dataFiles: event.target.value })} />
    <select className={inputClass} value={item.kind} onChange={(event) => onChange({ kind: event.target.value as ExpectationKind })}>{(Object.keys(labels) as ExpectationKind[]).map((kind) => <option key={kind} value={kind}>{labels[kind]}</option>)}</select>
    {item.kind === "tool-sequence" && <><textarea className={inputClass} rows={2} placeholder="required 工具序列" value={item.required} onChange={(event) => onChange({ required: event.target.value })} /><textarea className={inputClass} rows={2} placeholder="forbidden 工具" value={item.forbidden} onChange={(event) => onChange({ forbidden: event.target.value })} /><label className="text-xs"><input type="checkbox" checked={item.ordered} onChange={(event) => onChange({ ordered: event.target.checked })} /> 有序子序列</label></>}
    {item.kind === "step-budget" && <input className={inputClass} type="number" min={0} value={item.maxSteps} onChange={(event) => onChange({ maxSteps: Number(event.target.value) })} />}
    {item.kind === "token-budget" && <input className={inputClass} type="number" min={0} value={item.maxTokens} onChange={(event) => onChange({ maxTokens: Number(event.target.value) })} />}
    {item.kind === "llm-judge" && <><textarea className={inputClass} rows={2} placeholder="rubric" value={item.rubric} onChange={(event) => onChange({ rubric: event.target.value })} /><div className="flex gap-2"><input className={inputClass} placeholder="judge model" value={item.judgeModel} onChange={(event) => onChange({ judgeModel: event.target.value })} /><input className="w-20 rounded border border-border bg-background px-2" type="number" min={0} max={100} value={item.minScore} onChange={(event) => onChange({ minScore: Number(event.target.value) })} /></div></>}
  </div>;
}

function ResultPanel({ result, onArchive }: { result: SubAgentEvaluationDetail | null; onArchive: () => Promise<void> }) {
  if (!result) return <main className="flex flex-1 items-center justify-center text-sm text-muted-foreground">运行后展示轨迹与预算结果。</main>;
  return <main className="min-w-0 flex-1 space-y-4 overflow-y-auto p-4">
    <div className="flex items-center justify-between"><div className="text-sm"><span className={result.status === "success" ? "text-emerald-600" : "text-red-600"}>{result.status}</span><span className="ml-2 text-muted-foreground">repeat {result.repeat} · {result.durationSec.toFixed(2)}s</span></div><ExportActions actions={[{ key: "archive", label: <><Archive className="h-3.5 w-3.5" />归档</>, onClick: () => void onArchive() }]} /></div>
    <SummaryTable rows={result.caseSummaries} rowKey={(item) => item.caseId} columns={[{ key: "case", label: "Case", className: "font-medium", render: (item) => item.caseName }, { key: "success", label: "Success", render: (item) => `${item.success}/${item.total}` }, { key: "failed", label: "Failed", render: (item) => item.failed }, { key: "duration", label: "Avg s", render: (item) => item.avgDurationSec.toFixed(2) }]} />
    <div className="grid gap-2 md:grid-cols-2">{result.results.map((item) => <ResultCard key={item.id} title={`${item.caseName} · #${item.attempt}`} status={item.status} meta={<>steps {item.stepCount} · tokens {item.totalTokens} · cost ${item.totalCost.toFixed(5)} · tools {item.toolCalls}</>}><div><div className="mb-1 text-muted-foreground">工具轨迹</div><div className="flex flex-wrap items-center gap-1">{item.toolTrajectory.length ? item.toolTrajectory.map((tool, index) => <span key={`${tool}-${index}`} className="contents"><span className="rounded bg-sky-100 px-2 py-1 text-sky-800 dark:bg-sky-950 dark:text-sky-200">{tool}</span>{index < item.toolTrajectory.length - 1 && <span>→</span>}</span>) : <span className="text-muted-foreground">无工具调用</span>}</div></div>{item.reportPath && <div className="break-all">报告：{item.reportPath}</div>}{item.output && <pre className="whitespace-pre-wrap rounded bg-muted p-2">{item.output}</pre>}{item.error && <div className="rounded bg-red-50 p-2 text-red-700">{item.error.message}{item.error.hint ? ` · ${item.error.hint}` : ""}</div>}</ResultCard>)}</div>
  </main>;
}
