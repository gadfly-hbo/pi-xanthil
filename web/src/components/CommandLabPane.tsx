import { useEffect, useMemo, useState } from "react";
import { Archive, Loader2, Play, Plus, Save, Trash2 } from "lucide-react";
import { api } from "@/lib/api";
import { EvalHistoryList, ExportActions, ResultCard, SummaryTable } from "@/components/eval-shared";
import type {
  CommandEvalCase,
  CommandEvalSet,
  CommandEvaluation,
  CommandEvaluationDetail,
  CommandExpectation,
  PiModel,
  XanCommand,
} from "@/types";

interface Props {
  workspaceId: string | null;
  model: string;
  models: PiModel[];
}

type ExpectationKind = CommandExpectation["kind"];

const EXPECTATION_LABELS: Record<ExpectationKind, string> = {
  "expand-contains": "展开·包含片段",
  "expand-golden": "展开·逐字 golden",
  "skill-attached": "skill 并入",
  "run-contains": "实跑·输出包含",
  "run-llm-judge": "实跑·LLM 评分",
};

const RUN_KINDS: ExpectationKind[] = ["run-contains", "run-llm-judge"];

interface DraftCase {
  id: string;
  name: string;
  argsText: string;
  kind: ExpectationKind;
  substrings: string;
  forbidUnresolved: boolean;
  goldenText: string;
  normalizeWhitespace: boolean;
  expectedSkillSlugs: string;
  exact: boolean;
  rubric: string;
  judgeModel: string;
  minScore: number;
}

let caseSeq = 1;
const defaultCase = (): DraftCase => ({
  id: `case_${caseSeq++}`,
  name: "",
  argsText: "",
  kind: "expand-golden",
  substrings: "",
  forbidUnresolved: false,
  goldenText: "",
  normalizeWhitespace: false,
  expectedSkillSlugs: "",
  exact: false,
  rubric: "",
  judgeModel: "",
  minScore: 70,
});

function splitLines(value: string): string[] {
  return value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
}

function splitSlugs(value: string): string[] {
  return value.split(/[\s,]+/).map((slug) => slug.trim()).filter(Boolean);
}

function toExpectation(draft: DraftCase): CommandExpectation {
  switch (draft.kind) {
    case "expand-contains":
      return { kind: "expand-contains", substrings: splitLines(draft.substrings), ...(draft.forbidUnresolved ? { forbidUnresolved: true } : {}) };
    case "expand-golden":
      return { kind: "expand-golden", goldenText: draft.goldenText, ...(draft.normalizeWhitespace ? { normalizeWhitespace: true } : {}) };
    case "skill-attached":
      return { kind: "skill-attached", expectedSkillSlugs: splitSlugs(draft.expectedSkillSlugs), ...(draft.exact ? { exact: true } : {}) };
    case "run-contains":
      return { kind: "run-contains", substrings: splitLines(draft.substrings) };
    case "run-llm-judge":
      return { kind: "run-llm-judge", rubric: draft.rubric, model: draft.judgeModel || "", minScore: draft.minScore };
  }
}

function fromCase(testCase: CommandEvalCase): DraftCase {
  const base = { ...defaultCase(), id: testCase.id, name: testCase.name, argsText: testCase.argsText };
  const exp = testCase.expected;
  base.kind = exp.kind;
  if (exp.kind === "expand-contains") {
    base.substrings = exp.substrings.join("\n");
    base.forbidUnresolved = exp.forbidUnresolved ?? false;
  } else if (exp.kind === "expand-golden") {
    base.goldenText = exp.goldenText;
    base.normalizeWhitespace = exp.normalizeWhitespace ?? false;
  } else if (exp.kind === "skill-attached") {
    base.expectedSkillSlugs = exp.expectedSkillSlugs.join("\n");
    base.exact = exp.exact ?? false;
  } else if (exp.kind === "run-contains") {
    base.substrings = exp.substrings.join("\n");
  } else if (exp.kind === "run-llm-judge") {
    base.rubric = exp.rubric;
    base.judgeModel = exp.model;
    base.minScore = exp.minScore ?? 70;
  }
  return base;
}

const inputCls = "w-full rounded border border-border bg-background px-2 py-1 text-sm";

export function CommandLabPane(p: Props) {
  const [commands, setCommands] = useState<XanCommand[]>([]);
  const [commandId, setCommandId] = useState("");
  const [cases, setCases] = useState<DraftCase[]>([{ ...defaultCase(), id: "case_1" }]);
  const [caseSets, setCaseSets] = useState<CommandEvalSet[]>([]);
  const [selectedSetId, setSelectedSetId] = useState("");
  const [newSetName, setNewSetName] = useState("");
  const [repeat, setRepeat] = useState(1);
  const [model, setModel] = useState(p.model);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [history, setHistory] = useState<CommandEvaluation[]>([]);
  const [result, setResult] = useState<CommandEvaluationDetail | null>(null);

  const command = useMemo(() => commands.find((c) => c.id === commandId), [commands, commandId]);
  const needsModel = useMemo(() => cases.some((c) => RUN_KINDS.includes(c.kind)), [cases]);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    setResult(null);
    const historyRequest = p.workspaceId ? api.listCommandEvaluations(p.workspaceId) : Promise.resolve([]);
    Promise.all([api.listCommands(), historyRequest])
      .then(([cmds, evaluations]) => {
        if (cancelled) return;
        const enabled = cmds.filter((c) => c.enabled);
        setCommands(enabled);
        setCommandId((current) => current || enabled[0]?.id || "");
        setHistory(evaluations);
      })
      .catch((err) => {
        if (!cancelled) setError(String(err));
      });
    return () => {
      cancelled = true;
    };
  }, [p.workspaceId]);

  useEffect(() => {
    if (!p.workspaceId || !commandId) {
      setCaseSets([]);
      setSelectedSetId("");
      return;
    }
    let cancelled = false;
    api.listCommandCaseSets(p.workspaceId, commandId)
      .then((items) => {
        if (cancelled) return;
        setCaseSets(items);
        setSelectedSetId(items[0]?.id ?? "");
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [p.workspaceId, commandId]);

  function updateCase(id: string, patch: Partial<DraftCase>) {
    setCases((prev) => prev.map((c) => (c.id === id ? { ...c, ...patch } : c)));
  }
  function addCase() {
    setCases((prev) => [...prev, defaultCase()]);
  }
  function removeCase(id: string) {
    setCases((prev) => (prev.length <= 1 ? prev : prev.filter((c) => c.id !== id)));
  }
  function buildCases(): CommandEvalCase[] {
    return cases.map((draft) => ({ id: draft.id, name: draft.name.trim() || draft.id, argsText: draft.argsText, expected: toExpectation(draft) }));
  }
  function loadSet(setId: string) {
    const set = caseSets.find((s) => s.id === setId);
    if (!set) return;
    setSelectedSetId(setId);
    setCases(set.cases.length ? set.cases.map(fromCase) : [{ ...defaultCase(), id: "case_1" }]);
    setNotice(`已载入集合「${set.name}」`);
  }
  async function saveSet() {
    if (!p.workspaceId || !commandId) return;
    setError(null);
    try {
      const created = await api.createCommandCaseSet(p.workspaceId, { name: newSetName.trim() || `集合 ${caseSets.length + 1}`, commandId, cases: buildCases() });
      setCaseSets((prev) => [created, ...prev]);
      setSelectedSetId(created.id);
      setNewSetName("");
      setNotice(`已保存集合「${created.name}」`);
    } catch (err) {
      setError(String(err));
    }
  }
  async function updateSet() {
    if (!selectedSetId) return;
    setError(null);
    try {
      const updated = await api.updateCommandCaseSet(selectedSetId, { commandId, cases: buildCases() });
      setCaseSets((prev) => prev.map((s) => (s.id === updated.id ? updated : s)));
      setNotice(`已更新集合「${updated.name}」`);
    } catch (err) {
      setError(String(err));
    }
  }
  async function deleteSet() {
    if (!selectedSetId) return;
    setError(null);
    try {
      await api.deleteCommandCaseSet(selectedSetId);
      setCaseSets((prev) => prev.filter((s) => s.id !== selectedSetId));
      setSelectedSetId("");
      setNotice("已删除集合");
    } catch (err) {
      setError(String(err));
    }
  }
  async function run() {
    if (!p.workspaceId || !commandId) return;
    setError(null);
    setNotice(null);
    setRunning(true);
    try {
      const detail = await api.runCommandEvaluation(p.workspaceId, { commandId, repeat, model: needsModel ? model : undefined, cases: buildCases() });
      setResult(detail);
      setHistory((prev) => [detail, ...prev]);
    } catch (err) {
      setError(String(err));
    } finally {
      setRunning(false);
    }
  }
  async function openHistory(evaluationId: string) {
    try {
      setResult(await api.getCommandEvaluation(evaluationId));
    } catch (err) {
      setError(String(err));
    }
  }
  async function archive() {
    if (!result) return;
    try {
      const res = await api.archiveCommandEvaluation(result.evaluationId);
      setNotice(`已归档到 ${res.markdownPath}`);
    } catch (err) {
      setError(String(err));
    }
  }

  if (!p.workspaceId) {
    return <div className="p-6 text-sm text-muted-foreground">请先选择工作区。</div>;
  }

  return (
    <div className="flex h-full overflow-hidden">
      <div className="w-[440px] shrink-0 space-y-4 overflow-y-auto border-r border-border p-4">
        <select className={inputCls} value={commandId} onChange={(e) => setCommandId(e.target.value)}>
          {commands.length === 0 && <option value="">无可用命令</option>}
          {commands.map((c) => (
            <option key={c.id} value={c.id}>/{c.name}</option>
          ))}
        </select>
        {command && (
          <div className="rounded border border-border bg-muted/40 p-2 text-xs text-muted-foreground">
            <div className="break-all font-mono">{command.template}</div>
            {command.skillSlugs?.length ? <div className="mt-1">skills: {command.skillSlugs.join(", ")}</div> : null}
          </div>
        )}

        <div className="flex items-center gap-2 text-sm">
          <label className="flex items-center gap-1">repeat
            <input type="number" min={1} max={5} value={repeat} onChange={(e) => setRepeat(Math.max(1, Math.min(5, Number(e.target.value) || 1)))} className="w-14 rounded border border-border bg-background px-2 py-1" />
          </label>
          {needsModel && (
            <select className={inputCls} value={model} onChange={(e) => setModel(e.target.value)}>
              {p.models.map((m) => (
                <option key={m.id} value={m.id}>{m.id}</option>
              ))}
            </select>
          )}
        </div>

        <div className="space-y-3">
          {cases.map((draft) => (
            <CaseEditor key={draft.id} draft={draft} onChange={(patch) => updateCase(draft.id, patch)} onRemove={() => removeCase(draft.id)} canRemove={cases.length > 1} />
          ))}
          <button onClick={addCase} className="flex items-center gap-1 rounded border border-dashed border-border px-2 py-1 text-sm text-muted-foreground hover:bg-muted">
            <Plus className="h-3.5 w-3.5" /> 添加 case
          </button>
        </div>

        <div className="space-y-2 border-t border-border pt-3">
          <div className="flex items-center gap-2">
            <select className={inputCls} value={selectedSetId} onChange={(e) => loadSet(e.target.value)}>
              <option value="">选择已存集合…</option>
              {caseSets.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
            <button onClick={updateSet} disabled={!selectedSetId} className="rounded border border-border p-1 disabled:opacity-40" title="更新集合"><Save className="h-4 w-4" /></button>
            <button onClick={deleteSet} disabled={!selectedSetId} className="rounded border border-border p-1 disabled:opacity-40" title="删除集合"><Trash2 className="h-4 w-4" /></button>
          </div>
          <div className="flex items-center gap-2">
            <input className={inputCls} placeholder="新集合名" value={newSetName} onChange={(e) => setNewSetName(e.target.value)} />
            <button onClick={saveSet} disabled={!commandId} className="rounded border border-border px-2 py-1 text-sm disabled:opacity-40">另存</button>
          </div>
        </div>

        <button onClick={run} disabled={running || !commandId} className="flex w-full items-center justify-center gap-2 rounded bg-primary px-3 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50">
          {running ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />} 运行评测
        </button>

        {error && <div className="rounded border border-red-300 bg-red-50 p-2 text-xs text-red-700">{error}</div>}
        {notice && <div className="rounded border border-emerald-300 bg-emerald-50 p-2 text-xs text-emerald-700">{notice}</div>}

        <EvalHistoryList items={history} selectedId={result?.evaluationId} onSelect={(item) => openHistory(item.evaluationId)} renderMeta={(item) => <span className="max-w-24 truncate text-[10px] text-neutral-400">{item.commandId}</span>} />
      </div>

      <ResultPanel result={result} onArchive={archive} />
    </div>
  );
}

interface CaseEditorProps {
  draft: DraftCase;
  onChange: (patch: Partial<DraftCase>) => void;
  onRemove: () => void;
  canRemove: boolean;
}

function CaseEditor({ draft, onChange, onRemove, canRemove }: CaseEditorProps) {
  return (
    <div className="space-y-2 rounded border border-border p-2">
      <div className="flex items-center gap-2">
        <input className={inputCls} placeholder="case 名称" value={draft.name} onChange={(e) => onChange({ name: e.target.value })} />
        {canRemove && (
          <button onClick={onRemove} className="rounded border border-border p-1 text-muted-foreground hover:text-red-600"><Trash2 className="h-3.5 w-3.5" /></button>
        )}
      </div>
      <input className={inputCls} placeholder="argsText（命令名后参数串，空=无参）" value={draft.argsText} onChange={(e) => onChange({ argsText: e.target.value })} />
      <select className={inputCls} value={draft.kind} onChange={(e) => onChange({ kind: e.target.value as ExpectationKind })}>
        {(Object.keys(EXPECTATION_LABELS) as ExpectationKind[]).map((kind) => (
          <option key={kind} value={kind}>{EXPECTATION_LABELS[kind]}</option>
        ))}
      </select>

      {(draft.kind === "expand-contains" || draft.kind === "run-contains") && (
        <textarea className={inputCls} rows={3} placeholder="每行一个期望片段" value={draft.substrings} onChange={(e) => onChange({ substrings: e.target.value })} />
      )}
      {draft.kind === "expand-contains" && (
        <label className="flex items-center gap-1 text-xs text-muted-foreground">
          <input type="checkbox" checked={draft.forbidUnresolved} onChange={(e) => onChange({ forbidUnresolved: e.target.checked })} /> 禁止残留 {"{{...}}"}
        </label>
      )}
      {draft.kind === "expand-golden" && (
        <>
          <textarea className={`${inputCls} font-mono`} rows={4} placeholder="逐字 golden 展开文本" value={draft.goldenText} onChange={(e) => onChange({ goldenText: e.target.value })} />
          <label className="flex items-center gap-1 text-xs text-muted-foreground">
            <input type="checkbox" checked={draft.normalizeWhitespace} onChange={(e) => onChange({ normalizeWhitespace: e.target.checked })} /> 归一化空白
          </label>
        </>
      )}
      {draft.kind === "skill-attached" && (
        <>
          <textarea className={inputCls} rows={2} placeholder="期望 skill slug（逗号/换行分隔）" value={draft.expectedSkillSlugs} onChange={(e) => onChange({ expectedSkillSlugs: e.target.value })} />
          <label className="flex items-center gap-1 text-xs text-muted-foreground">
            <input type="checkbox" checked={draft.exact} onChange={(e) => onChange({ exact: e.target.checked })} /> 全等（exact）
          </label>
        </>
      )}
      {draft.kind === "run-llm-judge" && (
        <>
          <textarea className={inputCls} rows={3} placeholder="评分 rubric" value={draft.rubric} onChange={(e) => onChange({ rubric: e.target.value })} />
          <div className="flex items-center gap-2">
            <input className={inputCls} placeholder="judge 模型" value={draft.judgeModel} onChange={(e) => onChange({ judgeModel: e.target.value })} />
            <input type="number" min={0} max={100} className="w-20 rounded border border-border bg-background px-2 py-1 text-sm" value={draft.minScore} onChange={(e) => onChange({ minScore: Number(e.target.value) || 0 })} />
          </div>
        </>
      )}
    </div>
  );
}

interface ResultPanelProps {
  result: CommandEvaluationDetail | null;
  onArchive: () => void;
}

function ResultPanel({ result, onArchive }: ResultPanelProps) {
  if (!result) {
    return <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">运行评测后在此查看结果。</div>;
  }
  return (
    <div className="flex-1 overflow-y-auto p-4 space-y-4">
      <div className="flex items-center justify-between">
        <div className="text-sm">
          <span className={result.status === "success" ? "text-emerald-600" : "text-red-600"}>{result.status}</span>
          <span className="ml-2 text-muted-foreground">{result.commandId} · repeat {result.repeat} · {result.durationSec.toFixed(2)}s</span>
        </div>
        <ExportActions actions={[{ key: "archive", onClick: onArchive, label: <><Archive className="h-3.5 w-3.5" />归档</> }]} />
      </div>

      <SummaryTable rows={result.caseSummaries} rowKey={(item) => item.caseId} columns={[
        { key: "case", label: "Case", render: (item) => item.caseName }, { key: "success", label: "Success", render: (item) => `${item.success}/${item.total}` }, { key: "failed", label: "Failed", render: (item) => item.failed }, { key: "time", label: "Avg s", render: (item) => item.avgDurationSec.toFixed(2) },
      ]} />

      <div className="space-y-3">
        {result.results.map((r) => (
          <ResultCard key={r.id} title={`${r.caseName} · attempt ${r.attempt}`} status={r.status} meta={r.expectation.kind}>
            {r.expandedText && (
              <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap rounded bg-muted/50 p-1 font-mono">{r.expandedText}</pre>
            )}
            {r.skillSlugs.length > 0 && <div className="mt-1 text-muted-foreground">skills: {r.skillSlugs.join(", ")}</div>}
            {r.output && (
              <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap rounded bg-muted/30 p-1">{r.output}</pre>
            )}
            {r.error && <div className="mt-1 text-red-700">{r.error.message}{r.error.hint ? ` / ${r.error.hint}` : ""}</div>}
          </ResultCard>
        ))}
      </div>
    </div>
  );
}
