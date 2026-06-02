import { useEffect, useMemo, useState } from "react";
import { BarChart3, CheckCircle2, FlaskConical, Loader2, Play, XCircle } from "lucide-react";
import { api } from "@/lib/api";
import { cn } from "@/lib/cn";
import type { EvaluationFlowConfig, Flow, PiModel, WorkflowDef, WorkflowEvaluation, WorkflowEvaluationDetail, WorkflowEvaluationResult } from "@/types";

interface Props {
  workspaceId: string | null;
  flows: Flow[];
  model: string;
  models: PiModel[];
  onModelChange: (model: string) => void;
}

interface FlowSummary {
  flowId: string;
  flowName: string;
  success: number;
  total: number;
  durationSec: number;
  totalTokens: number;
  totalCost: number;
  toolCalls: number;
  outputChars: number;
  judgeScore: number | null;
}

export function ResearchLabPane(p: Props) {
  const [selectedFlowIds, setSelectedFlowIds] = useState<string[]>([]);
  const [prompt, setPrompt] = useState("");
  const [rubric, setRubric] = useState("");
  const [judgeModel, setJudgeModel] = useState(p.model);
  const [flowConfigs, setFlowConfigs] = useState<Record<string, EvaluationFlowConfig>>({});
  const [workflowDefs, setWorkflowDefs] = useState<Record<string, WorkflowDef | null>>({});
  const [repeat, setRepeat] = useState(1);
  const [history, setHistory] = useState<WorkflowEvaluation[]>([]);
  const [selected, setSelected] = useState<WorkflowEvaluationDetail | null>(null);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!p.workspaceId) {
      setHistory([]);
      setSelected(null);
      return;
    }
    void loadHistory(p.workspaceId);
  }, [p.workspaceId]);

  useEffect(() => {
    if (!selected || selected.status !== "running") return;
    const timer = window.setInterval(() => void refreshEvaluation(selected.id), 1000);
    return () => window.clearInterval(timer);
  }, [selected?.id, selected?.status]);

  useEffect(() => {
    if (!judgeModel && p.model) setJudgeModel(p.model);
  }, [judgeModel, p.model]);

  useEffect(() => {
    for (const flow of p.flows) {
      if (flow.kind !== "multi" || !selectedFlowIds.includes(flow.id) || flow.id in workflowDefs) continue;
      void api.flowWorkflowGet(flow.id)
        .then((result) => setWorkflowDefs((cur) => ({ ...cur, [flow.id]: result.workflow })))
        .catch(() => setWorkflowDefs((cur) => ({ ...cur, [flow.id]: null })));
    }
  }, [p.flows, selectedFlowIds, workflowDefs]);

  const summaries = useMemo(() => summarize(selected?.results ?? []), [selected]);

  async function loadHistory(workspaceId: string): Promise<void> {
    try {
      const rows = await api.listWorkflowEvaluations(workspaceId);
      setHistory(rows);
      if (rows[0]) await refreshEvaluation(rows[0].id);
    } catch (err) {
      setError(String(err));
    }
  }

  async function refreshEvaluation(id: string): Promise<void> {
    try {
      const detail = await api.getWorkflowEvaluation(id);
      setSelected(detail);
      setHistory((cur) => cur.map((row) => row.id === detail.id ? detail : row));
    } catch (err) {
      setError(String(err));
    }
  }

  async function startEvaluation(): Promise<void> {
    if (!p.workspaceId || selectedFlowIds.length < 2 || !prompt.trim()) return;
    setCreating(true);
    setError(null);
    try {
      const detail = await api.createWorkflowEvaluation(p.workspaceId, {
        flowIds: selectedFlowIds,
        prompt: prompt.trim(),
        rubric: rubric.trim(),
        model: p.model,
        judgeModel: judgeModel || p.model,
        flowConfigs: snapshotFlowConfigs(p.flows, selectedFlowIds, workflowDefs, flowConfigs),
        repeat,
      });
      setSelected(detail);
      setHistory((cur) => [detail, ...cur]);
    } catch (err) {
      setError(String(err));
    } finally {
      setCreating(false);
    }
  }

  function toggleFlow(id: string): void {
    setSelectedFlowIds((cur) => cur.includes(id) ? cur.filter((flowId) => flowId !== id) : [...cur, id]);
  }

  function setFlowDefaultModel(flowId: string, defaultModel: string): void {
    setFlowConfigs((cur) => ({ ...cur, [flowId]: { ...cur[flowId], defaultModel } }));
  }

  function setNodeModel(flowId: string, nodeId: string, model: string): void {
    setFlowConfigs((cur) => ({
      ...cur,
      [flowId]: {
        ...cur[flowId],
        nodeModels: { ...cur[flowId]?.nodeModels, [nodeId]: model },
      },
    }));
  }

  if (!p.workspaceId) return <EmptyState text="请先在左侧选择工作区" />;

  return (
    <div className="flex min-h-0 flex-1">
      <aside className="w-[360px] shrink-0 overflow-y-auto border-r border-neutral-200 p-4 dark:border-neutral-800">
        <div className="flex items-center gap-2 text-sm font-semibold"><FlaskConical className="h-4 w-4" strokeWidth={1.75} />工作流评估</div>
        <p className="mt-1 text-xs leading-5 text-neutral-500">让多个工作流运行同一任务，对比质量、成本和效率。</p>

        <div className="mt-5 text-xs font-medium">候选工作流 <span className="text-neutral-400">至少选择 2 个</span></div>
        <div className="mt-2 space-y-1">
          {p.flows.map((flow) => (
            <label key={flow.id} className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-xs hover:bg-neutral-100 dark:hover:bg-neutral-800">
              <input type="checkbox" checked={selectedFlowIds.includes(flow.id)} onChange={() => toggleFlow(flow.id)} />
              <span className="min-w-0 flex-1 truncate">{flow.name}</span>
              <span className="text-[10px] text-neutral-400">{flow.kind === "multi" ? "多智能体" : "单智能体"}</span>
            </label>
          ))}
          {p.flows.length === 0 && <p className="px-2 py-2 text-xs text-neutral-400">当前工作区还没有工作流。</p>}
        </div>
        {p.flows.filter((flow) => flow.kind === "multi" && selectedFlowIds.includes(flow.id)).map((flow) => (
          <MultiAgentModelConfig
            key={flow.id}
            flow={flow}
            workflow={workflowDefs[flow.id]}
            config={flowConfigs[flow.id] ?? {}}
            models={p.models}
            onDefaultModelChange={(value) => setFlowDefaultModel(flow.id, value)}
            onNodeModelChange={(nodeId, value) => setNodeModel(flow.id, nodeId, value)}
          />
        ))}

        <label className="mt-4 block text-xs font-medium">公共任务 prompt
          <textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} rows={6} placeholder="描述所有候选工作流需要完成的同一个任务" className={inputClass("mt-1 resize-y")} />
        </label>
        <label className="mt-3 block text-xs font-medium">Judge 评分标准 <span className="font-normal text-neutral-400">可选</span>
          <textarea value={rubric} onChange={(e) => setRubric(e.target.value)} rows={4} placeholder="例如：结论准确、证据充分、建议可执行。留空则只统计客观指标。" className={inputClass("mt-1 resize-y")} />
        </label>

        <div className="mt-3 space-y-2">
          <label className="block text-xs font-medium">单智能体任务模型
            <select value={p.model} onChange={(e) => p.onModelChange(e.target.value)} className={inputClass("mt-1")}>
              {p.models.map((item) => <option key={item.id} value={item.id}>{item.id}</option>)}
            </select>
          </label>
          <p className="text-[11px] leading-4 text-neutral-400">仅用于单智能体 workflow。多智能体请在候选 workflow 下逐节点配置。</p>
          <label className="block text-xs font-medium">Judge 评审模型
            <select value={judgeModel} onChange={(e) => setJudgeModel(e.target.value)} className={inputClass("mt-1")}>
              {p.models.map((item) => <option key={item.id} value={item.id}>{item.id}</option>)}
            </select>
          </label>
          <p className="text-[11px] leading-4 text-neutral-400">仅在填写 Judge 评分标准时使用，不参与候选 workflow 执行。</p>
          <label className="text-xs font-medium">重复次数
            <select value={repeat} onChange={(e) => setRepeat(Number(e.target.value))} className={inputClass("mt-1")}>
              {[1, 2, 3].map((value) => <option key={value} value={value}>{value}</option>)}
            </select>
          </label>
        </div>

        <button onClick={() => void startEvaluation()} disabled={creating || selectedFlowIds.length < 2 || !prompt.trim()} className="mt-4 inline-flex h-9 w-full items-center justify-center gap-1.5 rounded-md bg-neutral-900 text-sm text-white disabled:opacity-40 dark:bg-neutral-100 dark:text-neutral-900">
          {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}开始评估
        </button>
        {error && <p className="mt-2 break-words text-xs text-rose-500">{error}</p>}

        <div className="mt-6 text-xs font-medium text-neutral-500">历史评估</div>
        <div className="mt-2 space-y-1">
          {history.map((item) => (
            <button key={item.id} onClick={() => void refreshEvaluation(item.id)} className={cn("flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs hover:bg-neutral-100 dark:hover:bg-neutral-800", selected?.id === item.id && "bg-neutral-100 dark:bg-neutral-800")}>
              <StatusIcon status={item.status} />
              <span className="min-w-0 flex-1 truncate">{new Date(item.createdAt).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })}</span>
              <span className="text-[10px] text-neutral-400">{item.repeat}x</span>
            </button>
          ))}
        </div>
      </aside>

      <main className="min-w-0 flex-1 overflow-y-auto p-5">
        {!selected ? <EmptyState text="创建一次评估后，这里会显示对比报告" /> : (
          <>
            <div className="flex items-start justify-between gap-4">
              <div><div className="flex items-center gap-2 text-base font-semibold"><BarChart3 className="h-4 w-4" />工作流测评报告</div><p className="mt-1 max-w-4xl whitespace-pre-wrap text-xs leading-5 text-neutral-500">{selected.prompt}</p></div>
              <div className="flex shrink-0 items-center gap-2 text-xs text-neutral-500"><StatusIcon status={selected.status} />{statusLabel(selected.status)}</div>
            </div>
            {selected.error && <p className="mt-3 rounded-md bg-rose-50 px-3 py-2 text-xs text-rose-600 dark:bg-rose-950/30">{selected.error}</p>}
            <SavedModelConfigs evaluation={selected} />
            <SummaryTable summaries={summaries} hasJudge={!!selected.rubric.trim()} />
            <div className="mt-6 text-sm font-semibold">运行明细</div>
            <div className="mt-2 space-y-2">{selected.results.map((result) => <ResultCard key={result.id} result={result} />)}</div>
          </>
        )}
      </main>
    </div>
  );
}

function MultiAgentModelConfig(p: {
  flow: Flow;
  workflow: WorkflowDef | null | undefined;
  config: EvaluationFlowConfig;
  models: PiModel[];
  onDefaultModelChange: (value: string) => void;
  onNodeModelChange: (nodeId: string, value: string) => void;
}) {
  return <div className="mt-3 rounded-md border border-neutral-200 p-2 dark:border-neutral-800">
    <div className="text-xs font-medium">{p.flow.name} · 节点模型</div>
    {p.workflow === undefined ? <p className="mt-2 text-[11px] text-neutral-400">正在读取 workflow.json...</p> : p.workflow === null ? <p className="mt-2 text-[11px] text-rose-500">无法读取 workflow.json</p> : <>
      <label className="mt-2 block text-[11px] text-neutral-500">未配置节点 fallback
        <ModelSelect value={p.config.defaultModel ?? ""} models={p.models} originalLabel={`沿用 workflow 默认值${p.workflow.defaultModel ? ` (${p.workflow.defaultModel})` : ""}`} onChange={p.onDefaultModelChange} />
      </label>
      <div className="mt-2 space-y-2">{p.workflow.nodes.map((node) => <label key={node.id} className="block text-[11px] text-neutral-500">
        <span className="block truncate">{node.label} <span className="text-neutral-400">({node.id})</span></span>
        <ModelSelect value={p.config.nodeModels?.[node.id] ?? ""} models={p.models} originalLabel={`沿用节点原配置${node.model ? ` (${node.model})` : ""}`} onChange={(value) => p.onNodeModelChange(node.id, value)} />
      </label>)}</div>
    </>}
  </div>;
}

function ModelSelect(p: { value: string; models: PiModel[]; originalLabel: string; onChange: (value: string) => void }) {
  return <select value={p.value} onChange={(e) => p.onChange(e.target.value)} className={inputClass("mt-1")}>
    <option value="">{p.originalLabel}</option>
    {p.models.map((item) => <option key={item.id} value={item.id}>{item.id}</option>)}
  </select>;
}

function SavedModelConfigs({ evaluation }: { evaluation: WorkflowEvaluationDetail }) {
  const rows = Object.entries(evaluation.flowConfigs);
  const names = new Map(evaluation.results.map((result) => [result.flowId, result.flowName]));
  return <details className="mt-4 rounded-md border border-neutral-200 px-3 py-2 text-xs dark:border-neutral-800">
    <summary className="cursor-pointer font-medium">本次模型配置</summary>
    <div className="mt-2 space-y-1 text-neutral-500">
      <div>单智能体任务模型：{evaluation.model || "pi 默认模型"}</div>
      <div>Judge 评审模型：{evaluation.judgeModel || "pi 默认模型"}</div>
      {rows.map(([flowId, config]) => <div key={flowId}>
        多智能体 {names.get(flowId) ?? flowId.slice(0, 8)}：fallback={config.defaultModel || "pi 默认模型"}
        {Object.entries(config.nodeModels ?? {}).filter(([, value]) => value).map(([nodeId, value]) => `；${nodeId}=${value}`).join("")}
      </div>)}
    </div>
  </details>;
}

function snapshotFlowConfigs(
  flows: Flow[],
  selectedFlowIds: string[],
  workflowDefs: Record<string, WorkflowDef | null>,
  overrides: Record<string, EvaluationFlowConfig>,
): Record<string, EvaluationFlowConfig> {
  const out: Record<string, EvaluationFlowConfig> = {};
  for (const flow of flows) {
    if (flow.kind !== "multi" || !selectedFlowIds.includes(flow.id)) continue;
    const workflow = workflowDefs[flow.id];
    const override = overrides[flow.id] ?? {};
    if (!workflow) {
      out[flow.id] = override;
      continue;
    }
    const nodeModels: Record<string, string> = {};
    for (const node of workflow.nodes) {
      const model = override.nodeModels?.[node.id] || node.model;
      if (model) nodeModels[node.id] = model;
    }
    out[flow.id] = {
      defaultModel: override.defaultModel || workflow.defaultModel,
      nodeModels,
    };
  }
  return out;
}

function SummaryTable({ summaries, hasJudge }: { summaries: FlowSummary[]; hasJudge: boolean }) {
  return <div className="mt-5 overflow-x-auto rounded-md border border-neutral-200 dark:border-neutral-800"><table className="w-full text-left text-xs">
    <thead className="bg-neutral-50 text-neutral-500 dark:bg-neutral-900"><tr><th className="px-3 py-2">工作流</th><th className="px-3 py-2">成功率</th><th className="px-3 py-2">平均耗时</th><th className="px-3 py-2">平均 Token</th><th className="px-3 py-2">平均成本</th><th className="px-3 py-2">工具调用</th><th className="px-3 py-2">输出字符</th>{hasJudge && <th className="px-3 py-2">Judge</th>}</tr></thead>
    <tbody>{summaries.map((row) => <tr key={row.flowId} className="border-t border-neutral-200 dark:border-neutral-800"><td className="px-3 py-2 font-medium">{row.flowName}</td><td className="px-3 py-2">{row.success}/{row.total}</td><td className="px-3 py-2">{row.durationSec.toFixed(1)}s</td><td className="px-3 py-2">{Math.round(row.totalTokens).toLocaleString()}</td><td className="px-3 py-2">${row.totalCost.toFixed(4)}</td><td className="px-3 py-2">{row.toolCalls.toFixed(1)}</td><td className="px-3 py-2">{Math.round(row.outputChars).toLocaleString()}</td>{hasJudge && <td className="px-3 py-2">{row.judgeScore === null ? "-" : row.judgeScore.toFixed(1)}</td>}</tr>)}</tbody>
  </table></div>;
}

function ResultCard({ result }: { result: WorkflowEvaluationResult }) {
  return <details className="rounded-md border border-neutral-200 px-3 py-2 dark:border-neutral-800"><summary className="flex cursor-pointer list-none items-center gap-2 text-xs"><StatusIcon status={result.status} /><span className="font-medium">{result.flowName}</span><span className="text-neutral-400">第 {result.attempt} 次</span><span className="ml-auto text-neutral-400">{result.durationSec.toFixed(1)}s · {result.totalTokens.toLocaleString()} tok · ${result.totalCost.toFixed(4)}</span></summary><div className="mt-3 grid gap-3 lg:grid-cols-2"><div><div className="mb-1 text-xs font-medium">输出</div><pre className="max-h-80 overflow-auto whitespace-pre-wrap rounded bg-neutral-50 p-3 text-xs dark:bg-neutral-900">{result.output || result.error || "等待运行"}</pre></div><div><div className="mb-1 text-xs font-medium">Judge</div><div className="rounded bg-neutral-50 p-3 text-xs leading-5 dark:bg-neutral-900">{result.judgeScore === null ? "未评分" : `${result.judgeScore.toFixed(1)} / 100`}<div className="mt-1 text-neutral-500">{result.judgeDetails}</div></div></div></div></details>;
}

function summarize(results: WorkflowEvaluationResult[]): FlowSummary[] {
  const grouped = new Map<string, WorkflowEvaluationResult[]>();
  for (const result of results) grouped.set(result.flowId, [...(grouped.get(result.flowId) ?? []), result]);
  return [...grouped.entries()].map(([flowId, rows]) => {
    const completed = rows.filter((row) => row.status === "success");
    const scores = completed.flatMap((row) => row.judgeScore === null ? [] : [row.judgeScore]);
    const divisor = completed.length || 1;
    return { flowId, flowName: rows[0]?.flowName ?? flowId, success: completed.length, total: rows.length, durationSec: sum(completed, "durationSec") / divisor, totalTokens: sum(completed, "totalTokens") / divisor, totalCost: sum(completed, "totalCost") / divisor, toolCalls: sum(completed, "toolCalls") / divisor, outputChars: sum(completed, "outputChars") / divisor, judgeScore: scores.length ? scores.reduce((acc, value) => acc + value, 0) / scores.length : null };
  });
}

function sum(rows: WorkflowEvaluationResult[], key: "durationSec" | "totalTokens" | "totalCost" | "toolCalls" | "outputChars"): number { return rows.reduce((acc, row) => acc + row[key], 0); }
function StatusIcon({ status }: { status: string }) { return status === "success" ? <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-500" /> : status === "failed" ? <XCircle className="h-3.5 w-3.5 shrink-0 text-rose-500" /> : <Loader2 className={cn("h-3.5 w-3.5 shrink-0 text-amber-500", status === "running" && "animate-spin")} />; }
function statusLabel(status: string): string { return status === "success" ? "已完成" : status === "failed" ? "失败" : "运行中"; }
function inputClass(extra = ""): string { return cn("w-full rounded-md border border-neutral-300 bg-transparent px-2 py-1.5 text-xs outline-none focus:border-neutral-500 dark:border-neutral-700", extra); }
function EmptyState({ text }: { text: string }) { return <div className="flex h-full flex-col items-center justify-center gap-2 text-center text-xs text-neutral-400"><FlaskConical className="h-10 w-10 text-neutral-300 dark:text-neutral-700" strokeWidth={1.25} />{text}</div>; }
