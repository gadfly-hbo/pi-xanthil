import { useEffect, useMemo, useState } from "react";
import { Archive, BarChart3, CheckCircle2, Download, FileDown, FolderOpen, Loader2, Pencil, Play, Plus, Save, Trash2, Wrench, XCircle } from "lucide-react";
import { api } from "@/lib/api";
import { cn } from "@/lib/cn";
import { downloadArchiveTextFile, downloadEvaluationArchiveManifest, downloadEvaluationJson, downloadToolEvaluationMarkdown } from "@/lib/evaluation-export";
import type { EvaluationArchiveIndexItem, EvaluationError, ExtractionTool, PiModel, ToolCaseSet, ToolEvalCase, ToolEvaluation, ToolEvaluationDetail, ToolEvaluationRunResult, ToolExpectation } from "@/types";

interface Props {
  workspaceId: string | null;
  model: string;
  models: PiModel[];
}

type ExpectationKind = "field-presence" | "schema" | "llm-judge" | "must-fail" | "golden";

interface DraftCase {
  id: string;
  name: string;
  inputPath: string;
  expectationKind: ExpectationKind;
  jsonPath: string;
  requiredKeys: string;
  schemaJson: string;
  judgeRubric: string;
  judgeModel: string;
  judgeMinScore: number;
  expectedErrorPattern: string;
  goldenDir: string;
  goldenIgnorePaths: string;
  goldenNormalizeWhitespace: boolean;
  timeoutMs: number;
}

let caseSeq = 2;
const defaultCase = (): DraftCase => ({
  id: `case_${caseSeq++}`,
  name: "",
  inputPath: "",
  expectationKind: "field-presence",
  jsonPath: "*.json",
  requiredKeys: "",
  schemaJson: "",
  judgeRubric: "",
  judgeModel: "",
  judgeMinScore: 70,
  expectedErrorPattern: "",
  goldenDir: "",
  goldenIgnorePaths: "",
  goldenNormalizeWhitespace: false,
  timeoutMs: 60_000,
});

export function ToolLabPane(p: Props) {
  const [tools, setTools] = useState<ExtractionTool[]>([]);
  const [toolId, setToolId] = useState("");
  const [cases, setCases] = useState<DraftCase[]>([{ ...defaultCase(), id: "case_1" }]);
  const [templateInfo, setTemplateInfo] = useState<{ source: string; caseCount: number; coverage: string } | null>(null);
  const [caseSets, setCaseSets] = useState<ToolCaseSet[]>([]);
  const [newCaseSetName, setNewCaseSetName] = useState("");
  const [selectedCaseSetId, setSelectedCaseSetId] = useState("");
  const [repeat, setRepeat] = useState(1);
  const [loadingTools, setLoadingTools] = useState(false);
  const [loadingTemplates, setLoadingTemplates] = useState(false);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [archiveMessage, setArchiveMessage] = useState<string | null>(null);
  const [archives, setArchives] = useState<EvaluationArchiveIndexItem[]>([]);
  const [history, setHistory] = useState<ToolEvaluation[]>([]);
  const [result, setResult] = useState<ToolEvaluationDetail | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoadingTools(true);
    setError(null);
    setCaseSets([]);
    setNewCaseSetName("");
    setSelectedCaseSetId("");
    setArchiveMessage(null);
    setArchives([]);
    setHistory([]);
    setResult(null);
    const historyRequest = p.workspaceId ? api.listToolEvaluations(p.workspaceId) : Promise.resolve([]);
    const archiveRequest = p.workspaceId ? api.listEvaluationArchives(p.workspaceId) : Promise.resolve([]);
    Promise.all([api.listExtractionTools(), historyRequest, archiveRequest])
      .then(async ([items, evaluations, archiveItems]) => {
        if (cancelled) return;
        setTools(items);
        setToolId((current) => current || items[0]?.id || "");
        setHistory(evaluations);
        setArchives(archiveItems);
        if (evaluations[0]) {
          const detail = await api.getToolEvaluation(evaluations[0].evaluationId);
          if (!cancelled) setResult(detail);
        }
      })
      .catch((err) => {
        if (!cancelled) setError(String(err));
      })
      .finally(() => {
        if (!cancelled) setLoadingTools(false);
      });
    return () => {
      cancelled = true;
    };
  }, [p.workspaceId]);

  useEffect(() => {
    if (!p.workspaceId || !toolId) {
      setCaseSets([]);
      setSelectedCaseSetId("");
      return;
    }
    let cancelled = false;
    api.listToolCaseSets(p.workspaceId, toolId)
      .then((items) => {
        if (cancelled) return;
        setCaseSets(items);
        setSelectedCaseSetId(items[0]?.id ?? "");
      })
      .catch((err) => {
        if (!cancelled) setError(String(err));
      });
    return () => {
      cancelled = true;
    };
  }, [p.workspaceId, toolId]);

  const selectedTool = useMemo(() => tools.find((tool) => tool.id === toolId) ?? null, [toolId, tools]);
  const runnableCases = useMemo(() => cases.map((item) => toToolEvalCase(item, p.model)).filter((item): item is ToolEvalCase => item !== null), [cases, p.model]);
  const canRun = !!p.workspaceId && !!selectedTool && runnableCases.length > 0 && !running;

  function updateCase(id: string, patch: Partial<DraftCase>): void {
    setTemplateInfo(null);
    setCases((cur) => cur.map((item) => item.id === id ? { ...item, ...patch } : item));
  }

  function removeCase(id: string): void {
    setTemplateInfo(null);
    setCases((cur) => cur.length === 1 ? cur : cur.filter((item) => item.id !== id));
  }

  async function pickCasePath(id: string, field: "inputPath" | "goldenDir", mode: "file" | "dir"): Promise<void> {
    setError(null);
    try {
      const { path } = await api.pickLocalPath(mode);
      updateCase(id, { [field]: path });
    } catch (err) {
      setError(String(err));
    }
  }

  async function loadCaseTemplates(): Promise<void> {
    if (!selectedTool) return;
    if (hasConfiguredCases(cases)) {
      const confirmed = window.confirm("当前已有手动配置的 cases，载入模板会覆盖它们。是否继续？");
      if (!confirmed) return;
    }
    setLoadingTemplates(true);
    setError(null);
    try {
      const template = await api.listExtractionToolTestCases(selectedTool.id);
      const source = `server/tools/${selectedTool.id}/tests/cases.json`;
      if (template.cases.length === 0) {
        setError(`未找到模板: ${source}`);
        return;
      }
      setCases(template.cases.map(fromToolEvalCase));
      setTemplateInfo({ source, caseCount: template.cases.length, coverage: describeTemplateCoverage(template.cases) });
      caseSeq = Math.max(caseSeq, template.cases.length + 2);
    } catch (err) {
      setError(String(err));
    } finally {
      setLoadingTemplates(false);
    }
  }

  async function saveCaseSet(): Promise<void> {
    if (!p.workspaceId || !selectedTool) return;
    const name = newCaseSetName.trim();
    if (!name) {
      setError("Case set 名称不能为空");
      return;
    }
    if (runnableCases.length === 0) {
      setError("当前没有可保存的 cases");
      return;
    }
    setError(null);
    try {
      const saved = await api.createToolCaseSet(p.workspaceId, { name, toolId: selectedTool.id, cases: runnableCases });
      setCaseSets((cur) => [saved, ...cur]);
      setSelectedCaseSetId(saved.id);
      setNewCaseSetName("");
    } catch (err) {
      setError(String(err));
    }
  }

  function loadCaseSet(): void {
    const selected = caseSets.find((item) => item.id === selectedCaseSetId);
    if (!selected) return;
    if (hasConfiguredCases(cases) && !window.confirm("载入 case set 会覆盖当前 cases，是否继续？")) return;
    setTemplateInfo(null);
    setCases(selected.cases.map(fromToolEvalCase));
    caseSeq = Math.max(caseSeq, selected.cases.length + 2);
  }

  async function renameCaseSet(): Promise<void> {
    const selected = caseSets.find((item) => item.id === selectedCaseSetId);
    if (!selected) return;
    const name = window.prompt("重命名 case set", selected.name)?.trim();
    if (!name || name === selected.name) return;
    setError(null);
    try {
      const updated = await api.updateToolCaseSet(selected.id, { name });
      setCaseSets((cur) => cur.map((item) => item.id === updated.id ? updated : item));
    } catch (err) {
      setError(String(err));
    }
  }

  async function updateCaseSetFromCurrentCases(): Promise<void> {
    const selected = caseSets.find((item) => item.id === selectedCaseSetId);
    if (!selected || !selectedTool) return;
    if (runnableCases.length === 0) {
      setError("当前没有可更新的 cases");
      return;
    }
    if (!window.confirm(`用当前 ${runnableCases.length} 个 cases 覆盖「${selected.name}」？`)) return;
    setError(null);
    try {
      const updated = await api.updateToolCaseSet(selected.id, { toolId: selectedTool.id, cases: runnableCases });
      setCaseSets((cur) => [updated, ...cur.filter((item) => item.id !== updated.id)]);
      setSelectedCaseSetId(updated.id);
    } catch (err) {
      setError(String(err));
    }
  }

  async function deleteCaseSet(): Promise<void> {
    const selected = caseSets.find((item) => item.id === selectedCaseSetId);
    if (!selected) return;
    if (!window.confirm(`删除 case set「${selected.name}」？`)) return;
    setError(null);
    try {
      await api.deleteToolCaseSet(selected.id);
      setCaseSets((cur) => {
        const next = cur.filter((item) => item.id !== selected.id);
        setSelectedCaseSetId(next[0]?.id ?? "");
        return next;
      });
    } catch (err) {
      setError(String(err));
    }
  }

  async function runEvaluation(): Promise<void> {
    if (!p.workspaceId || !canRun) return;
    setRunning(true);
    setError(null);
    setArchiveMessage(null);
    setResult(null);
    try {
      setResult(await api.runToolEvaluation(p.workspaceId, {
        toolId,
        repeat,
        cases: runnableCases,
      }).then((summary) => {
        setHistory((cur) => [summary, ...cur.filter((item) => item.evaluationId !== summary.evaluationId)]);
        return summary;
      }));
    } catch (err) {
      setError(String(err));
    } finally {
      setRunning(false);
    }
  }

  async function selectEvaluation(evaluationId: string): Promise<void> {
    setError(null);
    setArchiveMessage(null);
    try {
      setResult(await api.getToolEvaluation(evaluationId));
    } catch (err) {
      setError(String(err));
    }
  }

  async function archiveCurrentEvaluation(): Promise<void> {
    if (!result) return;
    setError(null);
    setArchiveMessage(null);
    try {
      const archived = await api.archiveEvaluation("tool", result.evaluationId);
      setArchiveMessage(`已归档: ${archived.markdownPath} / ${archived.jsonPath}`);
      if (p.workspaceId) setArchives(await api.listEvaluationArchives(p.workspaceId));
    } catch (err) {
      setError(String(err));
    }
  }

  async function downloadArchiveFile(item: EvaluationArchiveIndexItem, format: "md" | "json"): Promise<void> {
    if (!p.workspaceId) return;
    try {
      const content = await api.getEvaluationArchiveFile(p.workspaceId, item.baseName, format);
      downloadArchiveTextFile(`${item.baseName}.${format}`, content, format);
    } catch (err) {
      setError(String(err));
    }
  }

  if (!p.workspaceId) return <EmptyState text="请先在左侧选择工作区" />;

  return (
    <div className="flex min-h-0 flex-1">
      <aside className="w-[380px] shrink-0 overflow-y-auto border-r border-neutral-200 p-4 dark:border-neutral-800">
        <div className="flex items-center gap-2 text-sm font-semibold"><Wrench className="h-4 w-4" strokeWidth={1.75} />Tool 评估</div>
        <p className="mt-1 text-xs leading-5 text-neutral-500">对本地注册 extraction tool 运行标准输入，检查产物字段、预期失败或 golden 输出。</p>

        <div className="mt-5 text-xs font-medium">候选 tool</div>
        <div className="mt-2 space-y-1">
          {loadingTools && <p className="px-2 py-2 text-xs text-neutral-400">正在读取 tool...</p>}
          {!loadingTools && tools.length === 0 && <p className="px-2 py-2 text-xs text-neutral-400">暂无已注册工具。</p>}
          {tools.map((tool) => (
            <button key={tool.id} onClick={() => {
              setToolId(tool.id);
              setTemplateInfo(null);
            }} className={cn("w-full rounded-md px-2 py-2 text-left text-xs hover:bg-neutral-100 dark:hover:bg-neutral-800", tool.id === toolId && "bg-neutral-100 dark:bg-neutral-800")}>
              <span className="block truncate font-medium">{tool.name}</span>
              <span className="mt-0.5 block truncate text-[11px] text-neutral-400">{tool.id} · {tool.input.accept.join(", ")} · {tool.output.join(", ")}</span>
            </button>
          ))}
        </div>

        <div className="mt-4 space-y-2">
          <label className="block text-xs font-medium">重复次数
            <select value={repeat} onChange={(e) => setRepeat(Number(e.target.value))} className={inputClass("mt-1")}>
              {[1, 2, 3].map((value) => <option key={value} value={value}>{value}</option>)}
            </select>
          </label>
        </div>

        <div className="mt-4 flex items-center justify-between">
          <div className="text-xs font-medium">评测 cases</div>
          <div className="flex items-center gap-1">
            <button type="button" disabled={!selectedTool || loadingTemplates} onClick={() => void loadCaseTemplates()} className="inline-flex h-7 items-center gap-1 rounded-md px-2 text-xs text-neutral-600 hover:bg-neutral-100 disabled:opacity-40 dark:text-neutral-300 dark:hover:bg-neutral-800">
              {loadingTemplates ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FileDown className="h-3.5 w-3.5" />}载入模板
            </button>
            <button type="button" onClick={() => {
              setTemplateInfo(null);
              setCases((cur) => [...cur, defaultCase()]);
            }} className="inline-flex h-7 items-center gap-1 rounded-md px-2 text-xs text-neutral-600 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-800">
              <Plus className="h-3.5 w-3.5" />新增
            </button>
          </div>
        </div>
        {templateInfo && (
          <div className="mt-2 rounded-md border border-emerald-200 bg-emerald-50 px-2 py-1.5 text-[11px] leading-4 text-emerald-700 dark:border-emerald-900/60 dark:bg-emerald-950/20 dark:text-emerald-300">
            已载入 {templateInfo.caseCount} 个模板 case
            <span className="mt-0.5 block">{templateInfo.coverage}</span>
            <span className="mt-0.5 block break-all font-mono text-[10px] opacity-80">{templateInfo.source}</span>
          </div>
        )}
        <div className="mt-2 space-y-2 rounded-md border border-neutral-200 p-2 dark:border-neutral-800">
          <div className="flex gap-1.5">
            <input value={newCaseSetName} onChange={(e) => setNewCaseSetName(e.target.value)} placeholder="Case set 名称" className={inputClass("min-w-0 flex-1")} />
            <button type="button" onClick={() => void saveCaseSet()} className={pathButtonClass} title="保存当前 cases">
              <Save className="h-3.5 w-3.5" />保存
            </button>
          </div>
          <div className="flex gap-1.5">
            <select value={selectedCaseSetId} onChange={(e) => setSelectedCaseSetId(e.target.value)} className={inputClass("min-w-0 flex-1")}>
              <option value="">选择已保存 case set</option>
              {caseSets.map((item) => <option key={item.id} value={item.id}>{item.name} · {item.cases.length}c</option>)}
            </select>
            <button type="button" disabled={!selectedCaseSetId} onClick={loadCaseSet} className={pathButtonClass} title="载入 case set">
              <FileDown className="h-3.5 w-3.5" />载入
            </button>
          </div>
          <div className="flex gap-1.5">
            <button type="button" disabled={!selectedCaseSetId} onClick={() => void updateCaseSetFromCurrentCases()} className={pathButtonClass} title="用当前 cases 覆盖已保存 case set">
              <Save className="h-3.5 w-3.5" />更新
            </button>
            <button type="button" disabled={!selectedCaseSetId} onClick={() => void renameCaseSet()} className={pathButtonClass} title="重命名 case set">
              <Pencil className="h-3.5 w-3.5" />重命名
            </button>
            <button type="button" disabled={!selectedCaseSetId} onClick={() => void deleteCaseSet()} className={pathButtonClass} title="删除 case set">
              <Trash2 className="h-3.5 w-3.5" />删除
            </button>
          </div>
        </div>
        <div className="mt-2 space-y-3">
          {cases.map((item, index) => (
            <CaseEditor
              key={item.id}
              index={index}
              value={item}
              models={p.models}
              removable={cases.length > 1}
              onChange={(patch) => updateCase(item.id, patch)}
              onPickInput={(mode) => void pickCasePath(item.id, "inputPath", mode)}
              onPickGolden={() => void pickCasePath(item.id, "goldenDir", "dir")}
              onRemove={() => removeCase(item.id)}
            />
          ))}
        </div>

        <button onClick={() => void runEvaluation()} disabled={!canRun} className="mt-4 inline-flex h-9 w-full items-center justify-center gap-1.5 rounded-md bg-neutral-900 text-sm text-white disabled:opacity-40 dark:bg-neutral-100 dark:text-neutral-900">
          {running ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}开始评估
        </button>
        {error && <p className="mt-2 break-words text-xs text-rose-500">{error}</p>}

        <div className="mt-6 text-xs font-medium text-neutral-500">历史评估</div>
        <div className="mt-2 space-y-1">
          {history.map((item) => (
            <button key={item.evaluationId} onClick={() => void selectEvaluation(item.evaluationId)} className={cn("flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs hover:bg-neutral-100 dark:hover:bg-neutral-800", result?.evaluationId === item.evaluationId && "bg-neutral-100 dark:bg-neutral-800")}>
              <StatusIcon status={item.status} />
              <span className="min-w-0 flex-1 truncate">{new Date(item.startedAt).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })}</span>
              <span className="text-[10px] text-neutral-400">{item.toolId} · {item.cases.length}c/{item.repeat}x</span>
            </button>
          ))}
          {history.length === 0 && <p className="px-2 py-2 text-xs text-neutral-400">还没有 Tool 评估历史。</p>}
        </div>
        <div className="mt-6 flex items-center gap-2 text-xs font-medium text-neutral-500">
          <Archive className="h-3.5 w-3.5" />
          <span className="min-w-0 flex-1">最近归档</span>
          <button
            type="button"
            disabled={archives.length === 0}
            onClick={() => downloadEvaluationArchiveManifest(archives)}
            className="rounded border border-neutral-200 px-1.5 py-0.5 text-[10px] font-medium text-neutral-500 hover:bg-neutral-50 disabled:opacity-40 dark:border-neutral-700 dark:hover:bg-neutral-800"
          >
            manifest
          </button>
        </div>
        <div className="mt-2 space-y-1">
          {archives.slice(0, 5).map((item) => (
            <div key={item.baseName} className="rounded-md border border-neutral-200 px-2 py-1.5 text-xs dark:border-neutral-800">
              <div className="flex items-center gap-2">
                <span className={cn("rounded px-1 py-0.5 text-[10px] font-medium", item.kind === "skill" ? "bg-sky-50 text-sky-700 dark:bg-sky-950/30 dark:text-sky-300" : "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-300")}>{item.kind}</span>
                <span className="min-w-0 flex-1 truncate font-mono text-[10.5px]" title={item.evaluationId}>{item.evaluationId}</span>
              </div>
              <div className="mt-1 truncate font-mono text-[10px] text-neutral-400" title={`${item.markdownRelPath} / ${item.jsonRelPath}`}>
                {item.markdownRelPath}
              </div>
              <div className="mt-2 flex gap-1">
                <button type="button" onClick={() => void downloadArchiveFile(item, "md")} className="rounded border border-neutral-200 px-1.5 py-0.5 text-[10px] font-medium text-neutral-600 hover:bg-neutral-50 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800">MD</button>
                <button type="button" onClick={() => void downloadArchiveFile(item, "json")} className="rounded border border-neutral-200 px-1.5 py-0.5 text-[10px] font-medium text-neutral-600 hover:bg-neutral-50 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800">JSON</button>
              </div>
            </div>
          ))}
          {archives.length === 0 && <p className="px-2 py-2 text-xs text-neutral-400">还没有归档报告。</p>}
        </div>
      </aside>

      <main className="min-w-0 flex-1 overflow-y-auto p-5">
        {!result ? <EmptyState text={running ? "正在运行 Tool 评估..." : "运行一次评估后，这里会显示对比报告"} /> : (
          <>
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="flex items-center gap-2 text-base font-semibold"><BarChart3 className="h-4 w-4" />Tool 测评报告</div>
                <p className="mt-1 text-xs leading-5 text-neutral-500">{result.toolId} · {result.results.length} 次运行 · {result.durationSec.toFixed(2)}s · {statusLabel(result.status)}</p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <button type="button" onClick={() => downloadEvaluationJson("tool", result.evaluationId, result)} className={exportButtonClass} title="导出完整 JSON">
                  <Download className="h-3.5 w-3.5" />JSON
                </button>
                <button type="button" onClick={() => downloadToolEvaluationMarkdown(result)} className={exportButtonClass} title="导出 Markdown 报告">
                  <Download className="h-3.5 w-3.5" />Markdown
                </button>
                <button type="button" onClick={() => void archiveCurrentEvaluation()} className={exportButtonClass} title="归档 Markdown 与 JSON 到 workspace">
                  <Archive className="h-3.5 w-3.5" />归档
                </button>
                <StatusIcon status={result.status} />
              </div>
            </div>
            {archiveMessage && <p className="mt-2 break-all rounded-md bg-emerald-50 px-3 py-2 text-xs text-emerald-700 dark:bg-emerald-950/20 dark:text-emerald-300">{archiveMessage}</p>}
            <SummaryTable result={result} />
            <div className="mt-6 text-sm font-semibold">运行明细</div>
            <div className="mt-2 space-y-2">
              {result.results.map((item) => <ResultCard key={item.id} result={item} />)}
            </div>
          </>
        )}
      </main>
    </div>
  );
}

function CaseEditor(p: {
  index: number;
  value: DraftCase;
  models: PiModel[];
  removable: boolean;
  onChange: (patch: Partial<DraftCase>) => void;
  onPickInput: (mode: "file" | "dir") => void;
  onPickGolden: () => void;
  onRemove: () => void;
}) {
  return <div className="rounded-md border border-neutral-200 p-2 dark:border-neutral-800">
    <div className="flex items-center justify-between">
      <div className="text-xs font-medium">Case {p.index + 1}</div>
      <button type="button" disabled={!p.removable} onClick={p.onRemove} className="inline-flex h-6 w-6 items-center justify-center rounded-md text-neutral-400 hover:bg-neutral-100 hover:text-neutral-800 disabled:opacity-30 dark:hover:bg-neutral-800 dark:hover:text-neutral-100" title="删除 case">
        <Trash2 className="h-3.5 w-3.5" />
      </button>
    </div>
    <label className="mt-2 block text-[11px] font-medium">名称
      <input value={p.value.name} onChange={(e) => p.onChange({ name: e.target.value })} placeholder="例如：标准 HTML" className={inputClass("mt-1")} />
    </label>
    <label className="mt-2 block text-[11px] font-medium">输入路径
      <div className="mt-1 flex gap-1.5">
        <input value={p.value.inputPath} onChange={(e) => p.onChange({ inputPath: e.target.value })} placeholder="/absolute/path/to/input.html" className={inputClass("min-w-0 flex-1 font-mono")} />
        <button type="button" onClick={() => p.onPickInput("file")} className={pathButtonClass} title="选择输入文件">
          <FolderOpen className="h-3.5 w-3.5" />文件
        </button>
        <button type="button" onClick={() => p.onPickInput("dir")} className={pathButtonClass} title="选择输入目录">
          <FolderOpen className="h-3.5 w-3.5" />目录
        </button>
      </div>
    </label>
    <label className="mt-2 block text-[11px] font-medium">Expectation
      <select value={p.value.expectationKind} onChange={(e) => p.onChange({ expectationKind: e.target.value as ExpectationKind })} className={inputClass("mt-1")}>
        <option value="field-presence">field-presence</option>
        <option value="schema">schema</option>
        <option value="llm-judge">llm-judge</option>
        <option value="must-fail">must-fail</option>
        <option value="golden">golden</option>
      </select>
    </label>
    {p.value.expectationKind === "field-presence" && (
      <>
        <label className="mt-2 block text-[11px] font-medium">JSON path
          <input value={p.value.jsonPath} onChange={(e) => p.onChange({ jsonPath: e.target.value })} placeholder="*.json" className={inputClass("mt-1 font-mono")} />
        </label>
        <label className="mt-2 block text-[11px] font-medium">Required keys
          <textarea value={p.value.requiredKeys} onChange={(e) => p.onChange({ requiredKeys: e.target.value })} rows={3} placeholder={"基本信息.人群名称\n统计信息.总标签数"} className={inputClass("mt-1 resize-y font-mono")} />
        </label>
      </>
    )}
    {p.value.expectationKind === "llm-judge" && (
      <>
        <label className="mt-2 block text-[11px] font-medium">Judge model
          <select value={p.value.judgeModel} onChange={(e) => p.onChange({ judgeModel: e.target.value })} className={inputClass("mt-1")}>
            <option value="">使用当前默认模型</option>
            {p.models.map((item) => <option key={item.id} value={item.id}>{item.id}</option>)}
          </select>
        </label>
        <label className="mt-2 block text-[11px] font-medium">Minimum score
          <input value={p.value.judgeMinScore} type="number" min={0} max={100} step={1} onChange={(e) => p.onChange({ judgeMinScore: Number(e.target.value) })} className={inputClass("mt-1")} />
        </label>
        <label className="mt-2 block text-[11px] font-medium">Rubric
          <textarea value={p.value.judgeRubric} onChange={(e) => p.onChange({ judgeRubric: e.target.value })} rows={5} placeholder="例如：输出必须覆盖核心字段，信息准确，无明显格式错误。" className={inputClass("mt-1 resize-y")} />
        </label>
      </>
    )}
    {p.value.expectationKind === "schema" && (
      <>
        <label className="mt-2 block text-[11px] font-medium">JSON path
          <input value={p.value.jsonPath} onChange={(e) => p.onChange({ jsonPath: e.target.value })} placeholder="*.json" className={inputClass("mt-1 font-mono")} />
        </label>
        <label className="mt-2 block text-[11px] font-medium">Schema JSON
          <textarea value={p.value.schemaJson} onChange={(e) => p.onChange({ schemaJson: e.target.value })} rows={8} placeholder={schemaPlaceholder} className={inputClass("mt-1 resize-y font-mono")} />
        </label>
      </>
    )}
    {p.value.expectationKind === "must-fail" && (
      <label className="mt-2 block text-[11px] font-medium">Expected error pattern
        <input value={p.value.expectedErrorPattern} onChange={(e) => p.onChange({ expectedErrorPattern: e.target.value })} placeholder="input extension|not supported" className={inputClass("mt-1 font-mono")} />
      </label>
    )}
    {p.value.expectationKind === "golden" && (
      <>
        <label className="mt-2 block text-[11px] font-medium">Golden directory
          <div className="mt-1 flex gap-1.5">
            <input value={p.value.goldenDir} onChange={(e) => p.onChange({ goldenDir: e.target.value })} placeholder="/absolute/path/to/golden" className={inputClass("min-w-0 flex-1 font-mono")} />
            <button type="button" onClick={p.onPickGolden} className={pathButtonClass} title="选择 golden 目录">
              <FolderOpen className="h-3.5 w-3.5" />目录
            </button>
          </div>
        </label>
        <label className="mt-2 flex items-center gap-2 text-[11px] font-medium">
          <input type="checkbox" checked={p.value.goldenNormalizeWhitespace} onChange={(e) => p.onChange({ goldenNormalizeWhitespace: e.target.checked })} />
          Normalize text whitespace
        </label>
        <label className="mt-2 block text-[11px] font-medium">JSON ignore paths
          <textarea value={p.value.goldenIgnorePaths} onChange={(e) => p.onChange({ goldenIgnorePaths: e.target.value })} rows={3} placeholder={"updatedAt\n$.metadata.generatedAt\nitems[0].traceId"} className={inputClass("mt-1 resize-y font-mono")} />
        </label>
      </>
    )}
    <label className="mt-2 block text-[11px] font-medium">Timeout ms
      <input value={p.value.timeoutMs} type="number" min={1000} step={1000} onChange={(e) => p.onChange({ timeoutMs: Number(e.target.value) })} className={inputClass("mt-1")} />
    </label>
  </div>;
}

function SummaryTable({ result }: { result: ToolEvaluationDetail }) {
  return <div className="mt-4 overflow-x-auto">
    <table className="w-full text-left text-xs">
      <thead className="border-b border-neutral-200 text-neutral-500 dark:border-neutral-800">
        <tr>
          <th className="py-2 pr-3 font-medium">Case</th>
          <th className="py-2 pr-3 font-medium">成功</th>
          <th className="py-2 pr-3 font-medium">失败</th>
          <th className="py-2 pr-3 font-medium">平均耗时</th>
        </tr>
      </thead>
      <tbody>
        {result.caseSummaries.map((item) => (
          <tr key={item.caseId} className="border-b border-neutral-100 dark:border-neutral-900">
            <td className="py-2 pr-3 font-medium">{item.caseName}</td>
            <td className="py-2 pr-3">{item.success}/{item.total}</td>
            <td className="py-2 pr-3">{item.failed}</td>
            <td className="py-2 pr-3">{item.avgDurationSec.toFixed(2)}s</td>
          </tr>
        ))}
      </tbody>
    </table>
  </div>;
}

function ResultCard({ result }: { result: ToolEvaluationRunResult }) {
  const failureSummary = result.status === "failed" ? buildFailureSummary(result) : null;
  return <details className="rounded-md border border-neutral-200 px-3 py-2 text-xs dark:border-neutral-800">
    <summary className="cursor-pointer">
      <span className="inline-flex items-center gap-2">
        <StatusIcon status={result.status} />
        <span className="font-medium">{result.caseName}</span>
        <span className="text-neutral-400">attempt {result.attempt} · {result.expectation.kind}</span>
      </span>
    </summary>
    <div className="mt-2 grid gap-2 text-neutral-500 md:grid-cols-3">
      <div>耗时 {result.durationSec.toFixed(2)}s</div>
      <div>summary success {result.summary?.success ?? "-"}</div>
      <div>summary failed {result.summary?.failed ?? "-"}</div>
    </div>
    <p className="mt-2 break-words font-mono text-[11px] leading-4 text-neutral-500">output: {result.outputPath}</p>
    {failureSummary && (
      <div className="mt-2 grid gap-2 rounded-md border border-rose-100 bg-rose-50 p-3 text-[11px] leading-4 dark:border-rose-950/60 dark:bg-rose-950/20 md:grid-cols-2">
        <div>
          <div className="font-semibold text-rose-700 dark:text-rose-300">Expected</div>
          <p className="mt-1 whitespace-pre-wrap break-words font-mono text-rose-700/80 dark:text-rose-200/80">{failureSummary.expected}</p>
        </div>
        <div>
          <div className="font-semibold text-rose-700 dark:text-rose-300">Actual</div>
          <p className="mt-1 whitespace-pre-wrap break-words font-mono text-rose-700/80 dark:text-rose-200/80">{failureSummary.actual}</p>
        </div>
      </div>
    )}
    {result.error && <p className="mt-2 whitespace-pre-wrap rounded-md bg-rose-50 px-3 py-2 text-xs text-rose-600 dark:bg-rose-950/30">{formatEvaluationError(result.error)}</p>}
    {(result.stdout || result.stderr) && (
      <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap rounded-md bg-neutral-50 p-3 text-[11px] leading-5 text-neutral-700 dark:bg-neutral-900 dark:text-neutral-300">{[result.stdout, result.stderr].filter(Boolean).join("\n")}</pre>
    )}
  </details>;
}

function hasConfiguredCases(cases: DraftCase[]): boolean {
  return cases.some((item) =>
    item.name.trim()
    || item.inputPath.trim()
    || item.requiredKeys.trim()
    || item.schemaJson.trim()
    || item.judgeRubric.trim()
    || item.expectedErrorPattern.trim()
    || item.goldenDir.trim()
    || item.goldenIgnorePaths.trim()
    || item.expectationKind !== "field-presence"
  );
}

function describeTemplateCoverage(cases: ToolEvalCase[]): string {
  const counts = new Map<string, number>();
  for (const testCase of cases) {
    counts.set(testCase.expected.kind, (counts.get(testCase.expected.kind) ?? 0) + 1);
  }
  const parts = Array.from(counts.entries())
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([kind, count]) => `${kind} ${count}`);
  return parts.length ? `覆盖: ${parts.join(" / ")}` : "覆盖: -";
}

function buildFailureSummary(result: ToolEvaluationRunResult): { expected: string; actual: string } {
  return {
    expected: describeExpectation(result.expectation),
    actual: describeActual(result),
  };
}

function describeExpectation(expectation: ToolExpectation): string {
  if (expectation.kind === "field-presence") {
    return [
      `kind: field-presence`,
      `jsonPath: ${expectation.jsonPath}`,
      `requiredKeys: ${expectation.requiredKeys.join(", ")}`,
    ].join("\n");
  }
  if (expectation.kind === "schema") {
    return [
      `kind: schema`,
      `jsonPath: ${expectation.jsonPath}`,
      `schema: ${compactJson(expectation.schema)}`,
    ].join("\n");
  }
  if (expectation.kind === "golden") {
    return [
      `kind: golden`,
      `goldenDir: ${expectation.goldenDir}`,
      expectation.ignorePaths?.length ? `ignorePaths: ${expectation.ignorePaths.join(", ")}` : "",
      expectation.normalizeWhitespace ? "normalizeWhitespace: true" : "",
    ].filter(Boolean).join("\n");
  }
  if (expectation.kind === "must-fail") {
    return [
      "kind: must-fail",
      expectation.expectedErrorPattern ? `expectedErrorPattern: ${expectation.expectedErrorPattern}` : "",
    ].filter(Boolean).join("\n");
  }
  return [
    "kind: llm-judge",
    `model: ${expectation.model}`,
    `minScore: ${expectation.minScore ?? 70}`,
    `rubric: ${truncateText(expectation.rubric, 240)}`,
  ].join("\n");
}

function describeActual(result: ToolEvaluationRunResult): string {
  const lines = [
    `status: ${result.status}`,
    `code: ${result.error?.code ?? "unknown"}`,
    result.error?.message ? `error: ${result.error.message}` : "",
    result.summary ? `summary: ${compactJson(result.summary)}` : "summary: null",
    result.stderr.trim() ? `stderr: ${truncateText(result.stderr.trim(), 320)}` : "",
    result.stdout.trim() ? `stdout: ${truncateText(result.stdout.trim(), 240)}` : "",
  ].filter(Boolean);
  return lines.join("\n");
}

function compactJson(value: unknown): string {
  return truncateText(JSON.stringify(value), 360);
}

function truncateText(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max - 1)}...`;
}

function fromToolEvalCase(value: ToolEvalCase): DraftCase {
  const base = {
    ...defaultCase(),
    id: value.id,
    name: value.name,
    inputPath: value.inputPath,
    timeoutMs: value.timeoutMs ?? 60_000,
  };
  const expected = value.expected;
  if (expected.kind === "field-presence") {
    return {
      ...base,
      expectationKind: "field-presence",
      jsonPath: expected.jsonPath,
      requiredKeys: expected.requiredKeys.join("\n"),
    };
  }
  if (expected.kind === "schema") {
    return {
      ...base,
      expectationKind: "schema",
      jsonPath: expected.jsonPath,
      schemaJson: JSON.stringify(expected.schema, null, 2),
    };
  }
  if (expected.kind === "llm-judge") {
    return {
      ...base,
      expectationKind: "llm-judge",
      judgeRubric: expected.rubric,
      judgeModel: expected.model,
      judgeMinScore: expected.minScore ?? 70,
    };
  }
  if (expected.kind === "must-fail") {
    return {
      ...base,
      expectationKind: "must-fail",
      expectedErrorPattern: expected.expectedErrorPattern ?? "",
    };
  }
  return {
    ...base,
    expectationKind: "golden",
    goldenDir: expected.goldenDir,
    goldenIgnorePaths: (expected.ignorePaths ?? []).join("\n"),
    goldenNormalizeWhitespace: expected.normalizeWhitespace ?? false,
  };
}

function toToolEvalCase(value: DraftCase, fallbackModel: string): ToolEvalCase | null {
  const inputPath = value.inputPath.trim();
  if (!inputPath) return null;
  const expected = toExpectation(value, fallbackModel);
  if (!expected) return null;
  return {
    id: value.id,
    name: value.name.trim() || value.id,
    inputPath,
    expected,
    timeoutMs: Number.isInteger(value.timeoutMs) && value.timeoutMs > 0 ? value.timeoutMs : undefined,
  };
}

function toExpectation(value: DraftCase, fallbackModel: string): ToolExpectation | null {
  if (value.expectationKind === "field-presence") {
    const requiredKeys = value.requiredKeys.split(/\r?\n|,/).map((item) => item.trim()).filter(Boolean);
    return value.jsonPath.trim() && requiredKeys.length
      ? { kind: "field-presence", jsonPath: value.jsonPath.trim(), requiredKeys }
      : null;
  }
  if (value.expectationKind === "must-fail") {
    const pattern = value.expectedErrorPattern.trim();
    return pattern ? { kind: "must-fail", expectedErrorPattern: pattern } : { kind: "must-fail" };
  }
  if (value.expectationKind === "schema") {
    const schema = parseSchemaJson(value.schemaJson);
    return value.jsonPath.trim() && schema ? { kind: "schema", jsonPath: value.jsonPath.trim(), schema } : null;
  }
  if (value.expectationKind === "llm-judge") {
    const rubric = value.judgeRubric.trim();
    const model = value.judgeModel.trim() || fallbackModel.trim();
    const minScore = Number.isFinite(value.judgeMinScore) ? Math.max(0, Math.min(100, value.judgeMinScore)) : 70;
    return rubric && model ? { kind: "llm-judge", rubric, model, minScore } : null;
  }
  const goldenDir = value.goldenDir.trim();
  const ignorePaths = value.goldenIgnorePaths.split(/\r?\n|,/).map((item) => item.trim()).filter(Boolean);
  return goldenDir
    ? {
      kind: "golden",
      goldenDir,
      ...(ignorePaths.length ? { ignorePaths } : {}),
      ...(value.goldenNormalizeWhitespace ? { normalizeWhitespace: true } : {}),
    }
    : null;
}

function parseSchemaJson(value: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(value) as unknown;
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed) ? parsed as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

const schemaPlaceholder = `{
  "type": "object",
  "required": ["基本信息", "统计信息"],
  "properties": {
    "基本信息": {
      "type": "object",
      "required": ["人群名称"]
    },
    "统计信息": {
      "type": "object",
      "required": ["总标签数"]
    }
  }
}`;

function StatusIcon({ status }: { status: "success" | "failed" }) {
  if (status === "success") return <CheckCircle2 className="h-4 w-4 text-emerald-500" />;
  return <XCircle className="h-4 w-4 text-rose-500" />;
}

function statusLabel(status: "success" | "failed"): string {
  return status === "success" ? "成功" : "失败";
}

function formatEvaluationError(error: EvaluationError | null): string {
  if (!error) return "";
  return [error.message, error.hint, error.cause].filter(Boolean).join("\n");
}

function inputClass(extra = ""): string {
  return cn("w-full rounded-md border border-neutral-200 bg-white px-2 py-1.5 text-xs outline-none focus:border-neutral-400 dark:border-neutral-700 dark:bg-neutral-900", extra);
}

const pathButtonClass = "inline-flex h-8 shrink-0 items-center gap-1 rounded-md border border-neutral-200 px-2 text-[11px] font-normal text-neutral-600 hover:bg-neutral-50 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800";
const exportButtonClass = "inline-flex h-8 items-center gap-1 rounded-md border border-neutral-200 px-2 text-xs text-neutral-600 hover:bg-neutral-50 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800";

function EmptyState({ text }: { text: string }) {
  return <div className="flex h-full items-center justify-center text-sm text-neutral-400">{text}</div>;
}
