import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, BookOpen, FlaskConical, Loader2, Play, Plus, RefreshCw, Trash2, X } from "lucide-react";
import { api } from "@/lib/api";
import { cn } from "@/lib/cn";
import { Markdown } from "@/components/Markdown";
import readmeContent from "@/docs/simulation-lab-readme.md?raw";
import type {
  DigitalLifeForm,
  Flow,
  FlowTreeNode,
  PiModel,
  SimulationRunInput,
  SimulationRunResult,
  SimulationScenario,
  SimulationStance,
  SubAgentTemplate,
} from "@/types";

// 行动闭环 → 模拟实验（DLF）—— V-DLF2 / D-DLF3，Agent-D 代笔。
// 红线：persona 复用层，不触发真实 subagent runner、不继承 toolIds、不读 draw_data。
// 唯一 LLM 调用 = api.runSimulationLab（专用 endpoint，server 端硬拒 toolIds）。

type Scope =
  | { type: "session"; sessionId: string | null }
  | { type: "flow"; flow: Flow | null }
  | { type: "workspace"; workspaceId: string };

interface ReportOption {
  id: string;
  label: string;
  pathId: number;
  relPath: string;
}

interface ManualPersona {
  id: string;
  name: string;
  persona: string;
}

const DEFAULT_MODEL = "minimax-cn/MiniMax-M3";

const SCENARIO_OPTIONS: { value: SimulationScenario; label: string; hint: string }[] = [
  { value: "consumer_campaign", label: "消费者活动评估", hint: "门店活动/利益点/触达方案，模拟目标人群发声" },
  { value: "product_concept", label: "新品概念测款", hint: "新品概念/卖点/包装，模拟目标客群接受度" },
  { value: "expert_panel", label: "专家投票评审", hint: "增长/投放/财务/法务专家角色对方案打分" },
];

const STANCE_LABEL: Record<SimulationStance, string> = {
  support: "支持",
  conditional: "有条件支持",
  oppose: "反对",
  uncertain: "不确定",
};

const STANCE_TONE: Record<SimulationStance, string> = {
  support: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300",
  conditional: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300",
  oppose: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300",
  uncertain: "bg-neutral-100 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300",
};

const VERDICT_LABEL: Record<SimulationRunResult["verdict"], string> = {
  go: "通过",
  revise: "修改后再走",
  hold: "暂缓",
  reject: "否决",
};
const VERDICT_TONE: Record<SimulationRunResult["verdict"], string> = {
  go: "bg-emerald-600 text-white",
  revise: "bg-amber-500 text-white",
  hold: "bg-neutral-500 text-white",
  reject: "bg-red-600 text-white",
};

function basenamePath(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).at(-1) ?? path;
}

function flattenFiles(node: FlowTreeNode | null): FlowTreeNode[] {
  const out: FlowTreeNode[] = [];
  const walk = (n: FlowTreeNode) => {
    if (n.kind === "file") out.push(n);
    for (const child of n.children ?? []) walk(child);
  };
  if (node) walk(node);
  return out;
}

function isReportFile(name: string): boolean {
  return /\.(md|markdown|txt)$/i.test(name)
    && (/report|summary|result|insight|分析|报告|结论|洞察|建议/i.test(name)
      || /\.(md|markdown)$/i.test(name));
}

function defaultModelId(models: PiModel[]): string {
  return models.find((m) => m.id === DEFAULT_MODEL)?.id
    ?? models.find((m) => m.isDefault)?.id
    ?? models[0]?.id
    ?? DEFAULT_MODEL;
}

function personaSummary(persona: string, max = 80): string {
  const trimmed = persona.trim().replace(/\s+/g, " ");
  return trimmed.length <= max ? trimmed : `${trimmed.slice(0, max)}…`;
}

function makeManualId(): string {
  return `manual_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
}

export function SimulationLabPane({ scope, models }: { scope: Scope; models: PiModel[] }) {
  // 报告
  const [reports, setReports] = useState<ReportOption[]>([]);
  const [selectedReportId, setSelectedReportId] = useState("");
  const [loadingReports, setLoadingReports] = useState(false);

  // subagent templates（数字生命体候选 · persona-only 复用，不继承 toolIds）
  const [templates, setTemplates] = useState<SubAgentTemplate[]>([]);
  const [templatesLoading, setTemplatesLoading] = useState(false);
  const [selectedTemplateIds, setSelectedTemplateIds] = useState<Set<string>>(new Set());
  const [showDisabledTemplates, setShowDisabledTemplates] = useState(false);

  // 手填 persona
  const [manualList, setManualList] = useState<ManualPersona[]>([]);
  const [manualDraft, setManualDraft] = useState<{ name: string; persona: string }>({ name: "", persona: "" });

  // 表单
  const [scenario, setScenario] = useState<SimulationScenario>("consumer_campaign");
  const [model, setModel] = useState(DEFAULT_MODEL);
  const [prompt, setPrompt] = useState("");

  // 运行
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<SimulationRunResult | null>(null);
  const [error, setError] = useState("");
  const [showReadme, setShowReadme] = useState(false);

  const scopeRef = useRef(scope);
  scopeRef.current = scope;
  const scopeType = scope.type;
  const scopeSessionId = scope.type === "session" ? scope.sessionId : null;
  const scopeFlowId = scope.type === "flow" ? scope.flow?.id ?? null : null;
  const scopeWorkspaceId = scope.type === "workspace" ? scope.workspaceId : null;

  const selectedReport = reports.find((r) => r.id === selectedReportId) ?? null;

  const visibleTemplates = useMemo(
    () => (showDisabledTemplates ? templates : templates.filter((t) => t.enabled)),
    [templates, showDisabledTemplates],
  );

  const lifeForms = useMemo<DigitalLifeForm[]>(() => {
    const fromTemplates: DigitalLifeForm[] = templates
      .filter((t) => selectedTemplateIds.has(t.id))
      .map((t) => ({
        id: `tpl:${t.id}`,
        name: t.name,
        persona: t.persona,
        source: "subagent_template",
        templateId: t.id,
      }));
    const fromManual: DigitalLifeForm[] = manualList.map((m) => ({
      id: m.id,
      name: m.name,
      persona: m.persona,
      source: "manual_persona",
    }));
    return [...fromTemplates, ...fromManual];
  }, [templates, selectedTemplateIds, manualList]);

  const loadReports = useCallback(async () => {
    const sc = scopeRef.current;
    setLoadingReports(true);
    setError("");
    setReports([]);
    setSelectedReportId("");
    try {
      const paths = sc.type === "session"
        ? sc.sessionId ? await api.listSessionPaths(sc.sessionId, "report") : []
        : sc.type === "workspace"
          ? sc.workspaceId ? await api.listWorkspacePaths(sc.workspaceId, "report") : []
          : sc.flow ? await api.listFlowPaths(sc.flow.id, "report") : [];
      const found = await Promise.all(paths.map(async (p) => {
        if (p.kind === "file") {
          return isReportFile(basenamePath(p.path))
            ? [{ id: `${p.id}:`, label: basenamePath(p.path), pathId: p.id, relPath: "" }]
            : [];
        }
        const tree = await api.workspacePathTree(p.id);
        return flattenFiles(tree)
          .filter((f) => isReportFile(f.name))
          .map((f) => ({ id: `${p.id}:${f.path}`, label: f.path, pathId: p.id, relPath: f.path }));
      }));
      const next = found.flat();
      setReports(next);
      setSelectedReportId(next[0]?.id ?? "");
    } catch (err) {
      setError(String(err));
    } finally {
      setLoadingReports(false);
    }
  }, [scopeType, scopeSessionId, scopeFlowId, scopeWorkspaceId]);

  useEffect(() => { void loadReports(); }, [loadReports]);

  const loadTemplates = useCallback(async () => {
    setTemplatesLoading(true);
    try {
      const list = await api.listSubAgents();
      setTemplates(list);
    } catch (err) {
      setError(String(err));
    } finally {
      setTemplatesLoading(false);
    }
  }, []);

  useEffect(() => { void loadTemplates(); }, [loadTemplates]);

  useEffect(() => {
    if (models.some((m) => m.id === model)) return;
    setModel(defaultModelId(models));
  }, [model, models]);

  const toggleTemplate = (id: string) => {
    setSelectedTemplateIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const addManualPersona = () => {
    const name = manualDraft.name.trim();
    const persona = manualDraft.persona.trim();
    if (!name || !persona) {
      setError("手填角色：name 与 persona 均必填");
      return;
    }
    setError("");
    setManualList((prev) => [...prev, { id: makeManualId(), name, persona }]);
    setManualDraft({ name: "", persona: "" });
  };

  const removeManualPersona = (id: string) => {
    setManualList((prev) => prev.filter((m) => m.id !== id));
  };

  const canRun = Boolean(selectedReport) && lifeForms.length > 0 && !running;

  const handleRun = async () => {
    if (!selectedReport || lifeForms.length === 0) return;
    setRunning(true);
    setError("");
    setResult(null);
    try {
      // D-DLF3 红线：payload 只送 id/name/persona/source/templateId；不带 toolIds。
      const input: SimulationRunInput = {
        pathId: selectedReport.pathId,
        relPath: selectedReport.relPath || undefined,
        scenario,
        model,
        lifeForms,
        prompt: prompt.trim() || undefined,
      };
      const res = await api.runSimulationLab(input);
      setResult(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setRunning(false);
    }
  };

  const emptyReportHint = "请先在「报告输出」tab 添加报告文件夹或文件";
  const totalLifeForms = lifeForms.length;

  return (
    <div className="flex h-full min-h-0 flex-col bg-white dark:bg-neutral-950">
      {/* ── 顶部控制条 ─────────────────────────────────────────────── */}
      <div className="flex shrink-0 flex-col gap-2 border-b border-neutral-200 px-4 py-3 dark:border-neutral-800">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2 text-[13px] font-semibold text-neutral-900 dark:text-neutral-100">
            <FlaskConical className="h-4 w-4 text-violet-500" strokeWidth={1.75} />
            模拟实验（DLF）
          </div>
          <select
            value={selectedReportId}
            onChange={(e) => setSelectedReportId(e.target.value)}
            disabled={loadingReports || reports.length === 0 || running}
            className="h-8 min-w-0 flex-1 rounded-md border border-neutral-200 bg-transparent px-2 text-[12px] text-neutral-700 outline-none disabled:opacity-50 dark:border-neutral-700 dark:text-neutral-200"
          >
            {reports.length === 0 ? (
              <option value="">{loadingReports ? "正在扫描报告…" : emptyReportHint}</option>
            ) : (
              reports.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)
            )}
          </select>
          <select
            value={scenario}
            onChange={(e) => setScenario(e.target.value as SimulationScenario)}
            disabled={running}
            className="h-8 w-44 rounded-md border border-neutral-200 bg-transparent px-2 text-[12px] text-neutral-700 outline-none disabled:opacity-50 dark:border-neutral-700 dark:text-neutral-200"
          >
            {SCENARIO_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
          <select
            value={model}
            onChange={(e) => setModel(e.target.value)}
            disabled={running}
            className="h-8 w-52 rounded-md border border-neutral-200 bg-transparent px-2 text-[12px] text-neutral-700 outline-none disabled:opacity-50 dark:border-neutral-700 dark:text-neutral-200"
          >
            {(models.length > 0 ? models : [{ id: DEFAULT_MODEL, provider: "minimax-cn", model: "MiniMax-M3", isDefault: true } as PiModel]).map((m) => (
              <option key={m.id} value={m.id}>{m.id}</option>
            ))}
          </select>
          <button
            onClick={() => setShowReadme(true)}
            className="inline-flex h-8 items-center gap-1.5 rounded-md px-2 text-[12px] text-neutral-500 hover:bg-neutral-100 dark:text-neutral-400 dark:hover:bg-neutral-800"
            title="查看模拟实验说明"
          >
            <BookOpen className="h-3.5 w-3.5" strokeWidth={1.75} />
            说明
          </button>
          <button
            onClick={() => { void loadReports(); void loadTemplates(); }}
            disabled={loadingReports || running || templatesLoading}
            className="inline-flex h-8 items-center gap-1.5 rounded-md px-2 text-[12px] text-neutral-500 hover:bg-neutral-100 disabled:opacity-50 dark:text-neutral-400 dark:hover:bg-neutral-800"
            title="刷新报告与模板列表"
          >
            <RefreshCw className={cn("h-3.5 w-3.5", (loadingReports || templatesLoading) && "animate-spin")} strokeWidth={1.75} />
            刷新
          </button>
          <button
            onClick={() => void handleRun()}
            disabled={!canRun}
            className="inline-flex h-8 items-center gap-1.5 rounded-md bg-violet-600 px-3 text-[12px] font-medium text-white hover:bg-violet-700 disabled:opacity-50"
            title={!selectedReport ? "请先选择报告" : totalLifeForms === 0 ? "请至少添加一个数字生命体" : "运行模拟"}
          >
            {running ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" strokeWidth={1.75} />}
            运行（{totalLifeForms}）
          </button>
        </div>
        <div className="flex items-center justify-between gap-2 text-[11px] text-neutral-500 dark:text-neutral-400">
          <div>
            {SCENARIO_OPTIONS.find((o) => o.value === scenario)?.hint}
          </div>
          <div className="text-[10.5px] text-neutral-400">仅 persona 模拟 · 不挂载工具 · 不读取 draw_data</div>
        </div>
      </div>

      {/* ── 错误条 ────────────────────────────────────────────────── */}
      {error && (
        <div className="flex shrink-0 items-start gap-2 border-b border-red-200 bg-red-50 px-4 py-2 text-[12px] text-red-700 dark:border-red-900/40 dark:bg-red-900/20 dark:text-red-300">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" strokeWidth={1.75} />
          <div className="flex-1">{error}</div>
          <button onClick={() => setError("")} className="text-[11px] text-red-500 hover:underline">关闭</button>
        </div>
      )}

      {/* ── 主体 ─────────────────────────────────────────────────── */}
      <div className="min-h-0 flex-1 overflow-auto px-4 py-3">
        <div className="grid gap-4 lg:grid-cols-2">
          {/* 左：数字生命体 ─────────────────────────────────────── */}
          <section className="flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <div className="text-[12px] font-semibold text-neutral-700 dark:text-neutral-200">
                数字生命体 · {totalLifeForms} 已选
              </div>
              <label className="flex items-center gap-1 text-[11px] text-neutral-500 dark:text-neutral-400">
                <input
                  type="checkbox"
                  checked={showDisabledTemplates}
                  onChange={(e) => setShowDisabledTemplates(e.target.checked)}
                />
                显示停用模板
              </label>
            </div>

            <div className="rounded-lg border border-neutral-200 bg-neutral-50/50 p-2 dark:border-neutral-800 dark:bg-neutral-900/40">
              <div className="mb-1.5 text-[11px] text-neutral-500 dark:text-neutral-400">
                来自「subagents 管理」模板（仅复用 persona，不继承 toolIds）
              </div>
              {templatesLoading ? (
                <div className="flex items-center gap-2 px-2 py-3 text-[12px] text-neutral-400">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" /> 加载模板中…
                </div>
              ) : visibleTemplates.length === 0 ? (
                <div className="px-2 py-3 text-[12px] text-neutral-400">
                  暂无{showDisabledTemplates ? "" : "启用的"}模板。可在「计算工具 → subagents 管理」新建。
                </div>
              ) : (
                <ul className="flex flex-col gap-1.5">
                  {visibleTemplates.map((t) => {
                    const checked = selectedTemplateIds.has(t.id);
                    return (
                      <li
                        key={t.id}
                        onClick={() => toggleTemplate(t.id)}
                        className={cn(
                          "flex cursor-pointer items-start gap-2 rounded-md border bg-white px-2.5 py-2 text-[12px] transition dark:bg-neutral-950",
                          checked
                            ? "border-violet-400 ring-1 ring-violet-300 dark:border-violet-600 dark:ring-violet-700"
                            : "border-neutral-200 hover:border-neutral-300 dark:border-neutral-800 dark:hover:border-neutral-700",
                          !t.enabled && "opacity-60",
                        )}
                      >
                        <input
                          type="checkbox"
                          className="mt-0.5"
                          checked={checked}
                          readOnly
                        />
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <div className="truncate text-[12.5px] font-medium text-neutral-800 dark:text-neutral-100">{t.name || t.id}</div>
                            {!t.enabled && (
                              <span className="rounded border border-neutral-200 px-1 py-0.5 text-[10px] text-neutral-400 dark:border-neutral-700">停用</span>
                            )}
                          </div>
                          <div className="mt-0.5 line-clamp-2 text-[11.5px] leading-4 text-neutral-500 dark:text-neutral-400">
                            {personaSummary(t.persona, 140) || "（无 persona 摘要）"}
                          </div>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>

            <div className="rounded-lg border border-neutral-200 bg-neutral-50/50 p-2 dark:border-neutral-800 dark:bg-neutral-900/40">
              <div className="mb-1.5 flex items-center justify-between">
                <div className="text-[11px] text-neutral-500 dark:text-neutral-400">手填 persona（临时数字生命体）</div>
                <div className="text-[10.5px] text-neutral-400">不写入 subagents 模板库</div>
              </div>
              <div className="flex flex-col gap-1.5">
                <input
                  type="text"
                  value={manualDraft.name}
                  onChange={(e) => setManualDraft((d) => ({ ...d, name: e.target.value }))}
                  placeholder="角色名（如 上海宝妈 / 投放总监）"
                  className="h-8 rounded-md border border-neutral-200 bg-white px-2 text-[12px] outline-none focus:border-neutral-400 dark:border-neutral-700 dark:bg-neutral-950 dark:focus:border-neutral-500"
                />
                <textarea
                  value={manualDraft.persona}
                  onChange={(e) => setManualDraft((d) => ({ ...d, persona: e.target.value }))}
                  placeholder="persona 描述：背景、偏好、关注点、决策因素"
                  rows={3}
                  className="resize-y rounded-md border border-neutral-200 bg-white px-2 py-1.5 text-[12px] leading-5 outline-none focus:border-neutral-400 dark:border-neutral-700 dark:bg-neutral-950 dark:focus:border-neutral-500"
                />
                <button
                  onClick={addManualPersona}
                  disabled={!manualDraft.name.trim() || !manualDraft.persona.trim() || running}
                  className="inline-flex h-7 items-center gap-1 self-end rounded-md border border-neutral-200 px-2 text-[11.5px] text-neutral-700 hover:bg-neutral-100 disabled:opacity-50 dark:border-neutral-700 dark:text-neutral-200 dark:hover:bg-neutral-800"
                >
                  <Plus className="h-3.5 w-3.5" strokeWidth={1.75} /> 加入候选
                </button>
              </div>
              {manualList.length > 0 && (
                <ul className="mt-2 flex flex-col gap-1.5">
                  {manualList.map((m) => (
                    <li key={m.id} className="flex items-start gap-2 rounded-md border border-neutral-200 bg-white px-2 py-1.5 text-[12px] dark:border-neutral-800 dark:bg-neutral-950">
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-[12.5px] font-medium text-neutral-800 dark:text-neutral-100">{m.name}</div>
                        <div className="mt-0.5 line-clamp-2 text-[11.5px] leading-4 text-neutral-500 dark:text-neutral-400">{personaSummary(m.persona, 140)}</div>
                      </div>
                      <button
                        onClick={() => removeManualPersona(m.id)}
                        disabled={running}
                        className="shrink-0 rounded-md p-1 text-neutral-400 hover:bg-neutral-100 hover:text-red-500 disabled:opacity-50 dark:hover:bg-neutral-800"
                        title="移除"
                      >
                        <Trash2 className="h-3.5 w-3.5" strokeWidth={1.75} />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </section>

          {/* 右：模拟重点 + 结果 ──────────────────────────────────── */}
          <section className="flex flex-col gap-3">
            <div>
              <div className="mb-1 text-[12px] font-semibold text-neutral-700 dark:text-neutral-200">本次模拟重点</div>
              <textarea
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder="可选 · 例如：店内活动主打满 200 减 30，目标人群是 25-35 岁宝妈；新品概念是无糖燕麦奶 + 高蛋白。"
                rows={4}
                disabled={running}
                className="w-full resize-y rounded-md border border-neutral-200 bg-white px-2 py-1.5 text-[12px] leading-5 outline-none focus:border-neutral-400 disabled:opacity-50 dark:border-neutral-700 dark:bg-neutral-950 dark:focus:border-neutral-500"
              />
            </div>

            {/* 结果 / loading / 空态 */}
            <div className="rounded-lg border border-neutral-200 bg-white p-3 text-[12px] dark:border-neutral-800 dark:bg-neutral-950">
              {running ? (
                <div className="flex items-center gap-2 text-neutral-500">
                  <Loader2 className="h-4 w-4 animate-spin" strokeWidth={1.75} />
                  运行中：模型与 {totalLifeForms} 位数字生命体正在评估…
                </div>
              ) : !result ? (
                <div className="text-neutral-400">
                  尚无结果。选好报告与数字生命体后点击「运行」。
                </div>
              ) : (
                <ResultBlock result={result} />
              )}
            </div>
          </section>
        </div>
      </div>
      {showReadme && (
        <div className="fixed inset-0 z-50 flex justify-end bg-black/30" onClick={() => setShowReadme(false)}>
          <aside
            className="flex h-full w-full max-w-3xl flex-col border-l border-neutral-200 bg-white shadow-xl dark:border-neutral-800 dark:bg-neutral-950"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex h-12 shrink-0 items-center justify-between border-b border-neutral-200 px-4 dark:border-neutral-800">
              <div className="flex items-center gap-2 text-[13px] font-semibold text-neutral-900 dark:text-neutral-100">
                <BookOpen className="h-4 w-4 text-violet-500" strokeWidth={1.75} />
                模拟实验说明
              </div>
              <button
                onClick={() => setShowReadme(false)}
                className="rounded-md p-1.5 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700 dark:hover:bg-neutral-800 dark:hover:text-neutral-200"
                title="关闭"
              >
                <X className="h-4 w-4" strokeWidth={1.75} />
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-auto px-5 py-4">
              <Markdown>{readmeContent}</Markdown>
            </div>
          </aside>
        </div>
      )}
    </div>
  );
}

// ─── 结果展示 ────────────────────────────────────────────────────
function ResultBlock({ result }: { result: SimulationRunResult }) {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className={cn("inline-flex h-6 items-center rounded-md px-2 text-[11.5px] font-semibold", VERDICT_TONE[result.verdict])}>
          {VERDICT_LABEL[result.verdict]}
        </span>
        <span className="inline-flex h-6 items-center rounded-md border border-neutral-200 px-2 text-[11.5px] font-medium text-neutral-700 dark:border-neutral-700 dark:text-neutral-200">
          总分 {result.overallScore}
        </span>
        <span className="text-[10.5px] text-neutral-400">模型 {result.model}</span>
      </div>

      {result.summary && (
        <p className="whitespace-pre-wrap text-[12.5px] leading-5 text-neutral-800 dark:text-neutral-100">{result.summary}</p>
      )}

      {result.roleAssessments.length > 0 && (
        <div>
          <div className="mb-1.5 text-[11.5px] font-semibold text-neutral-600 dark:text-neutral-300">分角色评分</div>
          <ul className="grid gap-2 sm:grid-cols-2">
            {result.roleAssessments.map((a) => (
              <li key={a.lifeFormId} className="rounded-md border border-neutral-200 bg-neutral-50/60 p-2 dark:border-neutral-800 dark:bg-neutral-900/40">
                <div className="flex items-center justify-between gap-2">
                  <div className="truncate text-[12.5px] font-medium text-neutral-800 dark:text-neutral-100">{a.name}</div>
                  <div className="flex items-center gap-1.5">
                    <span className={cn("inline-flex h-5 items-center rounded px-1.5 text-[10.5px]", STANCE_TONE[a.stance])}>{STANCE_LABEL[a.stance]}</span>
                    <span className="text-[11px] font-medium text-neutral-700 dark:text-neutral-200">{a.score}</span>
                  </div>
                </div>
                {a.rationale && (
                  <p className="mt-1 whitespace-pre-wrap text-[11.5px] leading-4 text-neutral-600 dark:text-neutral-300">{a.rationale}</p>
                )}
                {a.objections.length > 0 && (
                  <RoleList title="反对点" items={a.objections} tone="red" />
                )}
                {a.acceptanceConditions.length > 0 && (
                  <RoleList title="接受条件" items={a.acceptanceConditions} tone="amber" />
                )}
                {a.suggestions.length > 0 && (
                  <RoleList title="建议" items={a.suggestions} tone="sky" />
                )}
                {a.evidenceQuotes.length > 0 && (
                  <div className="mt-1.5">
                    <div className="text-[10.5px] text-neutral-400">引用</div>
                    <ul className="mt-0.5 flex flex-col gap-0.5">
                      {a.evidenceQuotes.map((q, idx) => (
                        <li key={idx} className="rounded border-l-2 border-neutral-300 bg-white/60 px-1.5 py-0.5 text-[11px] italic text-neutral-500 dark:border-neutral-600 dark:bg-neutral-950/40 dark:text-neutral-400">
                          “{q}”
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="grid gap-2 sm:grid-cols-3">
        <BulletBlock title="关键反对点" items={result.risks} tone="red" />
        <BulletBlock title="修改建议" items={result.recommendedChanges} tone="amber" />
        <BulletBlock title="下一步验证实验" items={result.validationExperiments} tone="emerald" />
      </div>

      {result.artifactPaths && (result.artifactPaths.json || result.artifactPaths.markdown) && (
        <div className="text-[10.5px] text-neutral-400">
          产物 ·{" "}
          {result.artifactPaths.json && <span className="mr-2">json: {result.artifactPaths.json}</span>}
          {result.artifactPaths.markdown && <span>md: {result.artifactPaths.markdown}</span>}
        </div>
      )}
    </div>
  );
}

function RoleList({ title, items, tone }: { title: string; items: string[]; tone: "red" | "amber" | "sky" }) {
  const toneCls = tone === "red"
    ? "text-red-600 dark:text-red-300"
    : tone === "amber"
      ? "text-amber-700 dark:text-amber-300"
      : "text-sky-700 dark:text-sky-300";
  return (
    <div className="mt-1.5">
      <div className={cn("text-[10.5px] font-medium", toneCls)}>{title}</div>
      <ul className="mt-0.5 list-disc pl-4 text-[11.5px] leading-4 text-neutral-600 dark:text-neutral-300">
        {items.map((it, idx) => <li key={idx}>{it}</li>)}
      </ul>
    </div>
  );
}

function BulletBlock({ title, items, tone }: { title: string; items: string[]; tone: "red" | "amber" | "emerald" }) {
  const headerCls = tone === "red"
    ? "text-red-600 dark:text-red-300"
    : tone === "amber"
      ? "text-amber-700 dark:text-amber-300"
      : "text-emerald-700 dark:text-emerald-300";
  return (
    <div className="rounded-md border border-neutral-200 bg-neutral-50/60 p-2 dark:border-neutral-800 dark:bg-neutral-900/40">
      <div className={cn("mb-1 text-[11.5px] font-semibold", headerCls)}>{title}</div>
      {items.length === 0 ? (
        <div className="text-[11px] text-neutral-400">—</div>
      ) : (
        <ul className="list-disc pl-4 text-[11.5px] leading-4 text-neutral-700 dark:text-neutral-200">
          {items.map((it, idx) => <li key={idx}>{it}</li>)}
        </ul>
      )}
    </div>
  );
}
