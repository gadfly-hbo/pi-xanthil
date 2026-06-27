import { useEffect, useMemo, useState } from "react";
import { Archive, Download, Loader2, Play, Plus, Save, Trash2 } from "lucide-react";
import { api } from "@/lib/api";
import { formatEfc, formatEta } from "@/lib/efc";
import { downloadEvaluationJson, downloadPromptEvaluationMarkdown } from "@/lib/evaluation-export";
import { EvalHistoryList, ExportActions, ResultCard, SummaryTable } from "@/components/eval-shared";
import { AheManifestPanel } from "@/components/AheManifestPanel";
import type { PiModel, PromptEvalSet, PromptEvalTask, PromptEvaluation, PromptEvaluationDetail, PromptTemplate, PromptVariant } from "@/types";

interface Props {
  workspaceId: string | null;
  model: string;
  models: PiModel[];
  onModelChange: (model: string) => void;
}

type DraftVariant = PromptVariant;
type DraftTask = PromptEvalTask;

let variantSeq = 3;
let taskSeq = 2;

const inputClass = "h-8 w-full rounded-md border border-neutral-200 bg-white px-2 text-[12px] text-neutral-800 outline-none focus:border-sky-400 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100";
const textareaClass = "w-full resize-y rounded-md border border-neutral-200 bg-white px-2 py-1.5 text-[12px] leading-5 text-neutral-800 outline-none focus:border-sky-400 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100";

function newVariant(): DraftVariant {
  const id = `variant_${variantSeq++}`;
  return { id, label: `Variant ${variantSeq - 1}`, promptBody: "", role: "system" };
}

function newTask(): DraftTask {
  return { id: `task_${taskSeq++}`, prompt: "", expectedPoints: [], rubric: "" };
}

export function PromptLabPane(p: Props) {
  const [templates, setTemplates] = useState<PromptTemplate[]>([]);
  const [variants, setVariants] = useState<DraftVariant[]>([
    { id: "baseline", label: "Baseline", promptBody: "You are a helpful assistant.", role: "system" },
    { id: "variant_2", label: "Variant 2", promptBody: "", role: "system" },
  ]);
  const [tasks, setTasks] = useState<DraftTask[]>([{ id: "task_1", prompt: "", expectedPoints: [], rubric: "" }]);
  const [evalSets, setEvalSets] = useState<PromptEvalSet[]>([]);
  const [selectedSetId, setSelectedSetId] = useState("");
  const [setName, setSetName] = useState("");
  const [history, setHistory] = useState<PromptEvaluation[]>([]);
  const [result, setResult] = useState<PromptEvaluationDetail | null>(null);
  const [repeat, setRepeat] = useState(1);
  const [judgeRepeat, setJudgeRepeat] = useState(1);
  const [loading, setLoading] = useState(false);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    setTemplates([]);
    setEvalSets([]);
    setHistory([]);
    setResult(null);
    setSelectedSetId("");
    setError(null);
    setNotice(null);
    if (!p.workspaceId) return;
    let cancelled = false;
    setLoading(true);
    Promise.all([
      api.listPromptTemplates(p.workspaceId),
      api.listPromptEvalSets(p.workspaceId),
      api.listPromptEvaluations(p.workspaceId),
    ]).then(async ([templateItems, setItems, evaluations]) => {
      if (cancelled) return;
      setTemplates(templateItems);
      setEvalSets(setItems);
      setSelectedSetId(setItems[0]?.id ?? "");
      setHistory(evaluations);
      if (evaluations[0]) {
        const detail = await api.getPromptEvaluation(evaluations[0].evaluationId);
        if (!cancelled) setResult(detail);
      }
    }).catch((err) => {
      if (!cancelled) setError(String(err));
    }).finally(() => {
      if (!cancelled) setLoading(false);
    });
    return () => { cancelled = true; };
  }, [p.workspaceId]);

  const runnableVariants = useMemo(() => variants
    .map((variant) => ({ ...variant, id: variant.id.trim(), label: variant.label.trim(), promptBody: variant.promptBody.trim() }))
    .filter((variant) => variant.id && variant.label && variant.promptBody), [variants]);
  const runnableTasks = useMemo(() => tasks
    .map((task) => ({ ...task, id: task.id.trim(), prompt: task.prompt.trim(), expectedPoints: task.expectedPoints?.filter(Boolean), rubric: task.rubric?.trim() || undefined }))
    .filter((task) => task.id && task.prompt), [tasks]);
  const canRun = Boolean(p.workspaceId && p.model && runnableVariants.length >= 2 && runnableTasks.length && !running);

  function updateVariant(id: string, patch: Partial<DraftVariant>): void {
    setVariants((current) => current.map((item) => item.id === id ? { ...item, ...patch } : item));
  }

  function chooseTemplate(variantId: string, templateId: string): void {
    const template = templates.find((item) => item.id === templateId);
    if (!template) {
      updateVariant(variantId, { templateId: undefined });
      return;
    }
    updateVariant(variantId, { templateId: template.id, label: template.title, promptBody: template.body });
  }

  function updateTask(id: string, patch: Partial<DraftTask>): void {
    setTasks((current) => current.map((item) => item.id === id ? { ...item, ...patch } : item));
  }

  async function runEvaluation(): Promise<void> {
    if (!p.workspaceId || !canRun) return;
    setRunning(true);
    setError(null);
    setNotice(null);
    try {
      const evaluation = await api.runPromptEvaluation(p.workspaceId, {
        model: p.model,
        repeat,
        judgeRepeat,
        variants: runnableVariants,
        tasks: runnableTasks,
      });
      setResult(evaluation);
      setHistory((current) => [evaluation, ...current.filter((item) => item.evaluationId !== evaluation.evaluationId)]);
    } catch (err) {
      setError(String(err));
    } finally {
      setRunning(false);
    }
  }

  async function openHistory(evaluationId: string): Promise<void> {
    setError(null);
    try { setResult(await api.getPromptEvaluation(evaluationId)); } catch (err) { setError(String(err)); }
  }

  async function saveSet(): Promise<void> {
    if (!p.workspaceId || !setName.trim() || runnableTasks.length === 0) return;
    setError(null);
    try {
      const saved = await api.createPromptEvalSet(p.workspaceId, { name: setName.trim(), tasks: runnableTasks });
      setEvalSets((current) => [saved, ...current]);
      setSelectedSetId(saved.id);
      setSetName("");
    } catch (err) { setError(String(err)); }
  }

  function loadSet(): void {
    const selected = evalSets.find((item) => item.id === selectedSetId);
    if (!selected) return;
    setTasks(selected.tasks.map((task) => ({ ...task, expectedPoints: task.expectedPoints ?? [], rubric: task.rubric ?? "" })));
  }

  async function updateSet(): Promise<void> {
    const selected = evalSets.find((item) => item.id === selectedSetId);
    if (!selected || runnableTasks.length === 0) return;
    try {
      const updated = await api.updatePromptEvalSet(selected.id, { tasks: runnableTasks });
      setEvalSets((current) => current.map((item) => item.id === updated.id ? updated : item));
    } catch (err) { setError(String(err)); }
  }

  async function renameSet(): Promise<void> {
    const selected = evalSets.find((item) => item.id === selectedSetId);
    if (!selected) return;
    const name = window.prompt("重命名任务集", selected.name)?.trim();
    if (!name || name === selected.name) return;
    try {
      const updated = await api.updatePromptEvalSet(selected.id, { name });
      setEvalSets((current) => current.map((item) => item.id === updated.id ? updated : item));
    } catch (err) { setError(String(err)); }
  }

  async function deleteSet(): Promise<void> {
    const selected = evalSets.find((item) => item.id === selectedSetId);
    if (!selected || !window.confirm(`删除任务集「${selected.name}」？`)) return;
    try {
      await api.deletePromptEvalSet(selected.id);
      setEvalSets((current) => current.filter((item) => item.id !== selected.id));
      setSelectedSetId("");
    } catch (err) { setError(String(err)); }
  }

  async function archiveResult(): Promise<void> {
    if (!result) return;
    setNotice(null);
    try {
      const archived = await api.archivePromptEvaluation(result.evaluationId);
      setNotice(`已归档：${archived.markdownPath}`);
    } catch (err) { setError(String(err)); }
  }

  if (!p.workspaceId) return <EmptyState text="请先选择 workspace" />;

  return (
    <div className="flex min-h-0 flex-1 bg-neutral-50 dark:bg-neutral-950">
      <aside className="w-[420px] shrink-0 overflow-y-auto border-r border-neutral-200 bg-white p-3 dark:border-neutral-800 dark:bg-neutral-950">
        <div className="mb-3 flex items-center justify-between">
          <div><h2 className="text-[14px] font-semibold">Prompt A/B 配置</h2><p className="text-[11px] text-neutral-500">第一个 variant 固定为 baseline</p></div>
          {loading && <Loader2 className="h-4 w-4 animate-spin text-neutral-400" />}
        </div>

        <Section title="模型与采样">
          <select value={p.model} onChange={(event) => p.onModelChange(event.target.value)} className={inputClass}>
            <option value="">选择模型</option>
            {p.models.map((item) => <option key={item.id} value={item.id}>{item.id}</option>)}
          </select>
          <div className="mt-2 grid grid-cols-2 gap-2">
            <NumberField label="repeat" value={repeat} onChange={setRepeat} />
            <NumberField label="judgeRepeat" value={judgeRepeat} onChange={setJudgeRepeat} />
          </div>
        </Section>

        <Section title="Prompt variants" action={<button onClick={() => setVariants((current) => [...current, newVariant()])} className="text-sky-600"><Plus className="h-4 w-4" /></button>}>
          <div className="space-y-3">
            {variants.map((variant, index) => (
              <div key={variant.id} className="rounded-md border border-neutral-200 p-2 dark:border-neutral-800">
                <div className="mb-2 flex gap-2">
                  <input value={variant.label} onChange={(event) => updateVariant(variant.id, { label: event.target.value })} className={inputClass} placeholder="Variant label" />
                  <select value={variant.role} onChange={(event) => updateVariant(variant.id, { role: event.target.value as PromptVariant["role"] })} className={`${inputClass} w-24`}><option value="system">system</option><option value="prefix">prefix</option></select>
                  <button disabled={index === 0 || variants.length <= 2} onClick={() => setVariants((current) => current.filter((item) => item.id !== variant.id))} className="text-neutral-400 disabled:opacity-20"><Trash2 className="h-4 w-4" /></button>
                </div>
                <select value={variant.templateId ?? ""} onChange={(event) => chooseTemplate(variant.id, event.target.value)} className={`${inputClass} mb-2`}>
                  <option value="">手填 prompt</option>
                  {templates.map((template) => <option key={template.id} value={template.id}>{template.title} · {template.category}</option>)}
                </select>
                <textarea value={variant.promptBody} onChange={(event) => updateVariant(variant.id, { promptBody: event.target.value, templateId: undefined })} className={`${textareaClass} min-h-24`} placeholder="Prompt body" />
              </div>
            ))}
          </div>
        </Section>

        <Section title="Task 集" action={<button onClick={() => setTasks((current) => [...current, newTask()])} className="text-sky-600"><Plus className="h-4 w-4" /></button>}>
          <div className="space-y-2">
            {tasks.map((task) => (
              <div key={task.id} className="rounded-md border border-neutral-200 p-2 dark:border-neutral-800">
                <div className="mb-2 flex gap-2"><input value={task.id} onChange={(event) => updateTask(task.id, { id: event.target.value })} className={`${inputClass} w-28`} /><button disabled={tasks.length === 1} onClick={() => setTasks((current) => current.filter((item) => item.id !== task.id))}><Trash2 className="h-4 w-4 text-neutral-400" /></button></div>
                <textarea value={task.prompt} onChange={(event) => updateTask(task.id, { prompt: event.target.value })} className={`${textareaClass} min-h-16`} placeholder="同一 task 会依次交给每个 variant" />
                <input value={(task.expectedPoints ?? []).join("；")} onChange={(event) => updateTask(task.id, { expectedPoints: event.target.value.split(/[；\n]/).map((item) => item.trim()).filter(Boolean) })} className={`${inputClass} mt-2`} placeholder="预期要点（；分隔）" />
                <input value={task.rubric ?? ""} onChange={(event) => updateTask(task.id, { rubric: event.target.value })} className={`${inputClass} mt-2`} placeholder="Rubric（可选）" />
              </div>
            ))}
          </div>
          <div className="mt-3 grid grid-cols-[1fr_auto] gap-2"><input value={setName} onChange={(event) => setSetName(event.target.value)} className={inputClass} placeholder="新任务集名称" /><button onClick={() => void saveSet()} className="rounded-md border px-2"><Save className="h-4 w-4" /></button></div>
          <div className="mt-2 grid grid-cols-[1fr_auto_auto_auto_auto] gap-1"><select value={selectedSetId} onChange={(event) => setSelectedSetId(event.target.value)} className={inputClass}><option value="">选择已存任务集</option>{evalSets.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select><button onClick={loadSet} className="rounded border px-2 text-[11px]">载入</button><button onClick={() => void renameSet()} className="rounded border px-2 text-[11px]">改名</button><button onClick={() => void updateSet()} className="rounded border px-2 text-[11px]">更新</button><button onClick={() => void deleteSet()} className="rounded border px-2 text-[11px] text-red-500">删</button></div>
        </Section>

        <button disabled={!canRun} onClick={() => void runEvaluation()} className="flex h-9 w-full items-center justify-center gap-2 rounded-md bg-sky-600 text-[12px] font-medium text-white disabled:opacity-40">{running ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}开始评估</button>
        {error && <div className="mt-2 rounded bg-red-50 p-2 text-[11px] text-red-600 dark:bg-red-950/30">{error}</div>}
        {notice && <div className="mt-2 rounded bg-emerald-50 p-2 text-[11px] text-emerald-700 dark:bg-emerald-950/30">{notice}</div>}
        <EvalHistoryList items={history} selectedId={result?.evaluationId} onSelect={(item) => void openHistory(item.evaluationId)} />
      </aside>

      <main className="min-w-0 flex-1 overflow-y-auto p-4">
        <div className="mb-3 flex items-center gap-2">
          <ExportActions actions={[
            { key: "archive", disabled: !result, onClick: () => void archiveResult(), label: <><Archive className="h-3.5 w-3.5" />归档</> },
            { key: "md", disabled: !result, onClick: () => { if (result) downloadPromptEvaluationMarkdown(result); }, label: <><Download className="h-3.5 w-3.5" />MD</> },
            { key: "json", disabled: !result, onClick: () => { if (result) downloadEvaluationJson("prompt", result.evaluationId, result); }, label: <><Download className="h-3.5 w-3.5" />JSON</> },
          ]} />
        </div>
        {result ? <ResultView result={result} /> : <EmptyState text="配置至少两个 prompt variant 和一个 task 后开始评估" />}
      </main>
    </div>
  );
}

function ResultView({ result }: { result: PromptEvaluationDetail }) {
  return <div className="space-y-4">
    <AheManifestPanel component="prompt" lab="prompt" currentEvaluationId={result.evaluationId} />
    <div className="grid grid-cols-4 gap-3">{[["状态", result.status], ["运行数", String(result.results.length)], ["耗时", `${result.durationSec.toFixed(2)}s`], ["模型", result.model]].map(([label, value]) => <div key={label} className="rounded-lg border bg-white p-3 dark:border-neutral-800 dark:bg-neutral-900"><div className="text-[11px] text-neutral-500">{label}</div><div className="mt-1 truncate text-[14px] font-semibold">{value}</div></div>)}</div>
    <Panel title="Variant 汇总"><SummaryTable rows={result.variantSummaries} rowKey={(item) => item.variantId} columns={[
      { key: "variant", label: "Variant", render: (item) => item.variantLabel }, { key: "success", label: "成功", render: (item) => `${item.success}/${item.total}` }, { key: "failed", label: "失败", render: (item) => item.failed }, { key: "efc", label: "EFC", render: (item) => formatEfc(item) }, { key: "eta", label: "η", render: (item) => formatEta(item) }, { key: "tokens", label: "Avg Tokens", render: (item) => Math.round(item.avgTotalTokens) }, { key: "cost", label: "Avg Cost", render: (item) => item.avgTotalCost.toFixed(5) }, { key: "time", label: "Avg Time", render: (item) => `${item.avgDurationSec.toFixed(2)}s` },
    ]} /></Panel>
    <Panel title="Pairwise（相对 baseline）"><SummaryTable rows={result.pairwiseSummaries} rowKey={(item) => item.variantId} columns={[
      { key: "variant", label: "Variant", render: (item) => item.variantLabel }, { key: "judged", label: "Judged", render: (item) => item.judged }, { key: "win", label: "Win", render: (item) => item.win }, { key: "tie", label: "Tie", render: (item) => item.tie }, { key: "loss", label: "Loss", render: (item) => item.loss }, { key: "delta", label: "Δ Score", render: (item) => item.avgScoreDelta.toFixed(1) }, { key: "confidence", label: "Confidence", render: (item) => item.avgConfidence === null ? "-" : `${Math.round(item.avgConfidence * 100)}%` },
    ]} /></Panel>
    <Panel title="运行明细"><div className="space-y-2">{result.results.map((item) => <ResultCard key={item.id} collapsible title={`${item.variantLabel} · ${item.taskId} · #${item.attempt}`} status={item.status} meta={item.pairwise?.verdict}><pre className="max-h-64 overflow-auto whitespace-pre-wrap rounded bg-neutral-50 p-2 text-[11px] dark:bg-neutral-950">{item.output || item.error?.message || "无输出"}</pre>{item.pairwise?.reason && <p className="text-[11px] text-neutral-500">Judge：{item.pairwise.reason}</p>}</ResultCard>)}</div></Panel>
  </div>;
}

function Section({ title, action, children }: { title: string; action?: React.ReactNode; children: React.ReactNode }) { return <section className="mb-4"><div className="mb-2 flex items-center justify-between"><h3 className="text-[12px] font-semibold text-neutral-700 dark:text-neutral-200">{title}</h3>{action}</div>{children}</section>; }
function Panel({ title, children }: { title: string; children: React.ReactNode }) { return <section className="rounded-lg border border-neutral-200 bg-white p-3 dark:border-neutral-800 dark:bg-neutral-900"><h3 className="mb-3 text-[13px] font-semibold">{title}</h3>{children}</section>; }
function NumberField({ label, value, onChange }: { label: string; value: number; onChange: (value: number) => void }) { return <label className="text-[11px] text-neutral-500">{label}<input type="number" min={1} max={5} value={value} onChange={(event) => onChange(Math.max(1, Math.min(5, Number(event.target.value) || 1)))} className={`${inputClass} mt-1`} /></label>; }
function EmptyState({ text }: { text: string }) { return <div className="flex min-h-64 items-center justify-center rounded-lg border border-dashed border-neutral-300 text-[12px] text-neutral-500 dark:border-neutral-700">{text}</div>; }
