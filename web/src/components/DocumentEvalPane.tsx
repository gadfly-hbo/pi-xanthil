import { useMemo, useState } from "react";
import { AlertTriangle, Loader2, Play, Plus, Trash2 } from "lucide-react";
import { api } from "@/lib/api";
import type { DocumentEvalCase, DocumentEvalResult, PiModel } from "@/types";

interface Props {
  workspaceId: string | null;
  model: string;
  models: PiModel[];
}

type DomainPreset = "mall" | "return_profile";

interface DraftRubric {
  id: string;
  criterion: string;
  weight: number;
  anchors: string;
}

let rubricSeq = 4;

const inputClass = "h-8 w-full rounded-md border border-neutral-200 bg-white px-2 text-[12px] text-neutral-800 outline-none focus:border-sky-400 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100";

const defaultRubrics: DraftRubric[] = [
  { id: "rubric_1", criterion: "结论可信度", weight: 1, anchors: "事实准确、无明显幻觉，关键判断有证据支撑。" },
  { id: "rubric_2", criterion: "证据完整性", weight: 1, anchors: "覆盖关键指标、趋势、异常与限制条件。" },
  { id: "rubric_3", criterion: "行动可执行性", weight: 1, anchors: "建议具体，能落到人、动作、优先级或验证方式。" },
];

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function clampScore(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, value));
}

function scoreTone(score: number): string {
  if (score >= 80) return "bg-emerald-500";
  if (score >= 60) return "bg-amber-500";
  return "bg-red-500";
}

function pct(value: number): string {
  return `${Math.round(clampScore(value))}%`;
}

function buildCase(domain: string, reportPath: string, rubrics: DraftRubric[]): DocumentEvalCase {
  return {
    id: "doc_case_1",
    name: `${domain} 文档评测`,
    domain,
    reportPath: reportPath.trim(),
    rubrics: rubrics
      .map((rubric) => ({
        criterion: rubric.criterion.trim(),
        weight: Number.isFinite(rubric.weight) ? rubric.weight : 1,
        anchors: rubric.anchors.trim() || undefined,
      }))
      .filter((rubric) => rubric.criterion),
  };
}

export function DocumentEvalPane(props: Props) {
  const [domain, setDomain] = useState<DomainPreset>("mall");
  const [reportPath, setReportPath] = useState("report/analysis.md");
  const [model, setModel] = useState(props.model || props.models[0]?.id || "");
  const [rubrics, setRubrics] = useState<DraftRubric[]>(defaultRubrics);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resultId, setResultId] = useState<string | null>(null);
  const [results, setResults] = useState<DocumentEvalResult[]>([]);

  const selectedModel = model || props.model || props.models[0]?.id || "";
  const canRun = Boolean(props.workspaceId && selectedModel.trim() && reportPath.trim());
  const casePreview = useMemo(() => buildCase(domain, reportPath, rubrics), [domain, reportPath, rubrics]);

  function updateRubric(id: string, patch: Partial<DraftRubric>): void {
    setRubrics((current) => current.map((item) => (item.id === id ? { ...item, ...patch } : item)));
  }

  async function run(): Promise<void> {
    if (!props.workspaceId || !canRun) return;
    setRunning(true);
    setError(null);
    try {
      const started = await api.runDocumentEvaluation(props.workspaceId, {
        model: selectedModel,
        cases: [casePreview],
      });
      const detail = await api.getDocumentEvaluationResult(props.workspaceId, started.resultId);
      setResultId(started.resultId);
      setResults(detail);
    } catch (caught) {
      setError(formatError(caught));
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-auto bg-neutral-50/40 p-4 dark:bg-neutral-950">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-4">
        <section className="rounded-md border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-base font-semibold text-neutral-900 dark:text-neutral-100">文档评测</h2>
              <p className="mt-1 text-xs text-neutral-500 dark:text-neutral-400">评测 workflow 输出报告；前端只提交 reportPath，文档内容由 server 在工作区内读取。</p>
            </div>
            <button
              type="button"
              disabled={!canRun || running}
              onClick={() => void run()}
              className="inline-flex h-8 items-center gap-1.5 rounded-md bg-sky-500 px-3 text-[12px] font-medium text-white hover:bg-sky-600 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {running ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
              运行评测
            </button>
          </div>

          {error && <div className="mt-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-200">{error}</div>}

          <div className="mt-4 grid gap-3 lg:grid-cols-[220px_minmax(0,1fr)_260px]">
            <label className="text-[12px] font-medium text-neutral-700 dark:text-neutral-200">
              domain
              <select className={`${inputClass} mt-1`} value={domain} onChange={(event) => setDomain(event.target.value as DomainPreset)}>
                <option value="mall">mall</option>
                <option value="return_profile">return_profile</option>
              </select>
            </label>
            <label className="text-[12px] font-medium text-neutral-700 dark:text-neutral-200">
              reportPath
              <input className={`${inputClass} mt-1`} value={reportPath} onChange={(event) => setReportPath(event.target.value)} placeholder="report/xxx.md" />
            </label>
            <label className="text-[12px] font-medium text-neutral-700 dark:text-neutral-200">
              model
              <select className={`${inputClass} mt-1`} value={selectedModel} onChange={(event) => setModel(event.target.value)}>
                {!selectedModel && <option value="">请选择模型</option>}
                {props.models.map((item) => <option key={item.id} value={item.id}>{item.id}</option>)}
              </select>
            </label>
          </div>

          <div className="mt-4">
            <div className="mb-2 flex items-center justify-between">
              <div className="text-[12px] font-semibold text-neutral-800 dark:text-neutral-100">rubrics</div>
              <button
                type="button"
                onClick={() => setRubrics((current) => [...current, { id: `rubric_${rubricSeq++}`, criterion: "", weight: 1, anchors: "" }])}
                className="inline-flex h-7 items-center gap-1 rounded-md border border-neutral-200 px-2 text-[12px] text-neutral-700 hover:bg-neutral-50 dark:border-neutral-700 dark:text-neutral-200 dark:hover:bg-neutral-800"
              >
                <Plus className="h-3.5 w-3.5" />
                添加
              </button>
            </div>
            <div className="space-y-2">
              {rubrics.map((rubric) => (
                <div key={rubric.id} className="grid gap-2 rounded-md border border-neutral-200 bg-neutral-50 p-2 dark:border-neutral-800 dark:bg-neutral-950/50 lg:grid-cols-[minmax(0,1fr)_96px_minmax(0,1.4fr)_32px]">
                  <input className={inputClass} value={rubric.criterion} onChange={(event) => updateRubric(rubric.id, { criterion: event.target.value })} placeholder="criterion" />
                  <input className={inputClass} type="number" min={0} step={0.1} value={rubric.weight} onChange={(event) => updateRubric(rubric.id, { weight: Number(event.target.value) })} />
                  <input className={inputClass} value={rubric.anchors} onChange={(event) => updateRubric(rubric.id, { anchors: event.target.value })} placeholder="anchors" />
                  <button
                    type="button"
                    disabled={rubrics.length <= 1}
                    onClick={() => setRubrics((current) => current.filter((item) => item.id !== rubric.id))}
                    className="inline-flex h-8 items-center justify-center rounded-md border border-neutral-200 text-neutral-500 hover:bg-red-50 hover:text-red-600 disabled:cursor-not-allowed disabled:opacity-40 dark:border-neutral-700 dark:hover:bg-red-950/40"
                    aria-label="删除 rubric"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
            </div>
          </div>
        </section>

        {results.length > 0 && (
          <section className="rounded-md border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">评测结果</h3>
              {resultId && <span className="text-[11px] text-neutral-400">resultId: {resultId}</span>}
            </div>
            <div className="space-y-5">
              {results.map((item) => <DocumentResultCard key={item.caseId} result={item} />)}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}

function DocumentResultCard({ result }: { result: DocumentEvalResult }) {
  return (
    <div className="space-y-4 rounded-md border border-neutral-200 p-3 dark:border-neutral-800">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-[13px] font-semibold text-neutral-900 dark:text-neutral-100">{result.caseId}</div>
        <span className="rounded bg-neutral-100 px-2 py-1 text-[11px] text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300">combined {result.combinedScore.toFixed(1)}</span>
      </div>
      <div className="grid gap-3 md:grid-cols-3">
        <ScoreBar label="rule_total_score" value={result.ruleTotalScore} />
        <ScoreBar label="judge_score" value={result.judgeScore} />
        <ScoreBar label="combined_score" value={result.combinedScore} />
      </div>
      {result.sessionMetrics && <SessionMetricsCards metrics={result.sessionMetrics} />}
      {result.consistencyAlerts.length > 0 && (
        <div className="rounded-md border border-amber-200 bg-amber-50 p-3 dark:border-amber-900/60 dark:bg-amber-950/30">
          <div className="mb-2 inline-flex items-center gap-1.5 text-[12px] font-semibold text-amber-800 dark:text-amber-200"><AlertTriangle className="h-3.5 w-3.5" />一致性告警</div>
          <ul className="space-y-1 text-[12px] text-amber-800 dark:text-amber-200">
            {result.consistencyAlerts.map((item, index) => <li key={`${item}-${index}`}>{item}</li>)}
          </ul>
        </div>
      )}
      <RuleTable result={result} />
      <JudgeDetails result={result} />
    </div>
  );
}

function ScoreBar({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-md border border-neutral-200 p-3 dark:border-neutral-800">
      <div className="mb-2 flex items-center justify-between text-[12px]">
        <span className="font-medium text-neutral-700 dark:text-neutral-200">{label}</span>
        <span className="tabular-nums text-neutral-500">{value.toFixed(1)}</span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-neutral-100 dark:bg-neutral-800">
        <div className={`h-full ${scoreTone(value)}`} style={{ width: pct(value) }} />
      </div>
    </div>
  );
}

function SessionMetricsCards({ metrics }: { metrics: NonNullable<DocumentEvalResult["sessionMetrics"]> }) {
  const items = [
    ["总 token", metrics.totalTokens.toLocaleString()],
    ["成本", metrics.totalCost.toFixed(4)],
    ["每千字成本", metrics.costPer1kWords.toFixed(4)],
    ["字数", metrics.wordCount.toLocaleString()],
    ["subagent", metrics.subagentCount.toLocaleString()],
  ];
  return (
    <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
      {items.map(([label, value]) => (
        <div key={label} className="rounded-md border border-neutral-200 bg-neutral-50 p-2 dark:border-neutral-800 dark:bg-neutral-950/50">
          <div className="text-[11px] text-neutral-500">{label}</div>
          <div className="mt-1 text-[13px] font-semibold text-neutral-900 dark:text-neutral-100">{value}</div>
        </div>
      ))}
    </div>
  );
}

function RuleTable({ result }: { result: DocumentEvalResult }) {
  return (
    <div className="overflow-hidden rounded-md border border-neutral-200 dark:border-neutral-800">
      <table className="w-full border-collapse text-left text-[12px]">
        <thead className="bg-neutral-50 text-neutral-500 dark:bg-neutral-950/60">
          <tr>
            <th className="px-3 py-2 font-medium">rule</th>
            <th className="px-3 py-2 font-medium">status</th>
            <th className="px-3 py-2 font-medium">score</th>
            <th className="px-3 py-2 font-medium">detail</th>
          </tr>
        </thead>
        <tbody>
          {result.ruleResults.map((rule) => (
            <tr key={rule.ruleName} className={`border-t border-neutral-200 dark:border-neutral-800 ${rule.passed ? "" : "bg-red-50/70 dark:bg-red-950/20"}`}>
              <td className="px-3 py-2 font-medium text-neutral-900 dark:text-neutral-100">{rule.ruleName}</td>
              <td className="px-3 py-2">
                <span className={`rounded px-2 py-0.5 text-[11px] ${rule.passed ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-200" : "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-200"}`}>
                  {rule.passed ? "passed" : "failed"}
                </span>
              </td>
              <td className="px-3 py-2 tabular-nums text-neutral-700 dark:text-neutral-200">{rule.score.toFixed(1)}</td>
              <td className="px-3 py-2 text-neutral-600 dark:text-neutral-300">{rule.detail}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function JudgeDetails({ result }: { result: DocumentEvalResult }) {
  return (
    <div>
      <div className="mb-2 text-[12px] font-semibold text-neutral-800 dark:text-neutral-100">LLM judge 明细</div>
      {result.judgeDetails.length === 0 ? (
        <div className="rounded-md border border-neutral-200 px-3 py-2 text-[12px] text-neutral-500 dark:border-neutral-800">未配置 rubric，未运行 judge。</div>
      ) : (
        <div className="grid gap-2 md:grid-cols-2">
          {result.judgeDetails.map((detail) => (
            <div key={detail.criterion} className="rounded-md border border-neutral-200 p-3 dark:border-neutral-800">
              <div className="mb-2 flex items-center justify-between gap-2">
                <span className="text-[12px] font-medium text-neutral-900 dark:text-neutral-100">{detail.criterion}</span>
                <span className="tabular-nums text-[12px] text-neutral-500">{detail.score.toFixed(1)}</span>
              </div>
              <div className="mb-2 h-1.5 overflow-hidden rounded-full bg-neutral-100 dark:bg-neutral-800">
                <div className={`h-full ${scoreTone(detail.score)}`} style={{ width: pct(detail.score) }} />
              </div>
              <p className="text-[12px] leading-5 text-neutral-600 dark:text-neutral-300">{detail.reason}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
