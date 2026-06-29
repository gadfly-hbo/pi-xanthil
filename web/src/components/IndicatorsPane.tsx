import { useCallback, useEffect, useMemo, useState } from "react";
import { BookOpen, Calculator, CheckCircle2, FileText, Pencil, Plus, RefreshCw, Trash2, Library, ShieldAlert, Upload, Download, History, AlertTriangle } from "lucide-react";
import { api } from "@/lib/api";
import { sharedApi } from "@/lib/api/shared";
import { dataApi } from "@/lib/api/data";
import { vizApi } from "@/lib/api/viz";
import { cn } from "@/lib/cn";
import type { AnalysisStandard, AnalysisStandardInput, AnalysisStandardKind, MetricDefinition, OkhMetricTemplatePack, OkhMetricTemplate, OkhMetricConflict, OkhStandardHealth, OkhMetricImportPreview, MetricInjectionTrace, OkhMetricOntologyLink, Ontology, ObjectType, LinkType, LogicRule } from "@/types";

type FormState = AnalysisStandardInput & { id: string | null };
type OkhMetricLinkTargetKind = OkhMetricOntologyLink["targetKind"];
type OkhMetricLinkTargetOption = { id: string; label: string };

function okhTargetSubTab(kind: OkhMetricLinkTargetKind): string {
  if (kind === "object") return "onto_objects";
  if (kind === "link") return "onto_links";
  return "onto_logic";
}

const EMPTY_FORM = (kind: AnalysisStandardKind): FormState => ({
  id: null,
  kind,
  name: "",
  category: "",
  description: "",
  formula: "",
  caliber: "",
  unit: "",
  filePath: "",
});

function toForm(s: AnalysisStandard): FormState {
  return {
    id: s.id,
    kind: s.kind,
    name: s.name,
    category: s.category,
    description: s.description,
    formula: s.formula,
    caliber: s.caliber,
    unit: s.unit,
    filePath: s.filePath,
  };
}

function toInput(form: FormState): AnalysisStandardInput {
  const { id: _id, ...input } = form;
  return input;
}

const IMPLEMENTED_FEATURES: { title: string; body: string }[] = [
  { title: "指标口径维护", body: "支持维护名称、分类、含义、公式、口径和单位，指标真源落在 metric_definitions。" },
  { title: "标准文件登记", body: "支持登记参照标准文件的名称、绝对路径和用途说明，注入时主要带路径与用途。" },
  { title: "指标模板库", body: "内置零售、会员、电商、供应链模板包，可以一键启用到当前工作区。" },
  { title: "口径治理", body: "自动检查同名、近似名、公式、分母和时间窗口冲突，并展示标准文件体检状态。" },
  { title: "导入导出", body: "支持 CSV / JSON 指标口径 preview、commit 和当前工作区清单导出。" },
  { title: "使用痕迹", body: "展示指标最近被注入到 chat 或 workflow 的记录、状态和 token 估算。" },
  { title: "本体联动", body: "指标可以人工关联到 onto-xanthil 的对象、关系或逻辑规则，并支持从本体侧回跳维护。" },
  { title: "工作区启用", body: "同一条指标或标准可以在不同工作区分别启用或停用，避免所有项目混用。" },
  { title: "prompt 预览", body: "能直接看到启用后的指标体系会怎样进入分析 prompt，并支持复制。" },
  { title: "统一记忆联动", body: "启用后的指标和标准会进入记忆库注入链路，也会在统一记忆的 fact 投影里被看到。" },
  { title: "全局池复用", body: "指标和标准是全局池资产，跨工作区复用；删除会影响所有工作区。" },
];

const ITERATION_IDEAS: { title: string; body: string }[] = [
  { title: "模板自定义", body: "允许团队把自己常用的一组指标保存成模板包，而不只用内置模板。" },
  { title: "冲突处理流程", body: "在发现口径冲突后支持合并、重命名、停用或生成新版指标。" },
  { title: "导入格式扩展", body: "在 CSV / JSON 之外补 Excel 或 Markdown 导入，并保留 preview 先行的安全口径。" },
  { title: "使用效果评估", body: "结合使用痕迹、正负反馈和老化信号，判断哪些指标值得保留或降权。" },
];

function OntoKnowhowReadme() {
  return (
    <div className="space-y-4">
      <section className="rounded-xl border border-neutral-200 bg-white p-5 shadow-sm dark:border-neutral-800 dark:bg-neutral-900">
        <div className="flex items-start gap-3">
          <BookOpen className="mt-0.5 h-4 w-4 shrink-0 text-neutral-700 dark:text-neutral-200" />
          <div className="min-w-0">
            <h2 className="text-[15px] font-semibold text-neutral-900 dark:text-neutral-100">onto-knowhow 是什么</h2>
            <p className="mt-2 text-[13px] leading-6 text-neutral-600 dark:text-neutral-300">
              onto-knowhow 是记忆库里的“指标和标准说明书”。它负责告诉 AI：一个指标到底怎么算、分母是谁、时间窗口是什么、哪些外部标准文件可以参考。这样后续做日常分析、专题分析或工作流时，模型不会临时猜口径。
            </p>
            <div className="mt-3 grid gap-2 text-[12px] text-neutral-600 dark:text-neutral-300 sm:grid-cols-2">
              <div className="rounded-lg border border-neutral-200 bg-neutral-50 p-3 dark:border-neutral-800 dark:bg-neutral-950/40">指标口径解决“这个数怎么算”的问题。</div>
              <div className="rounded-lg border border-neutral-200 bg-neutral-50 p-3 dark:border-neutral-800 dark:bg-neutral-950/40">参照标准文件解决“按哪份标准解释”的问题。</div>
            </div>
          </div>
        </div>
      </section>

      <section className="rounded-xl border border-neutral-200 bg-white p-5 shadow-sm dark:border-neutral-800 dark:bg-neutral-900">
        <h2 className="text-[14px] font-semibold text-neutral-900 dark:text-neutral-100">适合放什么</h2>
        <div className="mt-3 grid gap-2 text-[12px] text-neutral-600 dark:text-neutral-300 sm:grid-cols-3">
          <div className="rounded-lg border border-neutral-200 bg-neutral-50 p-3 dark:border-neutral-800 dark:bg-neutral-950/40">复购率、留存率、客单价、GMV、转化率等指标口径。</div>
          <div className="rounded-lg border border-neutral-200 bg-neutral-50 p-3 dark:border-neutral-800 dark:bg-neutral-950/40">会员等级、商品层级、渠道归因、业务分类等标准文件路径。</div>
          <div className="rounded-lg border border-neutral-200 bg-neutral-50 p-3 dark:border-neutral-800 dark:bg-neutral-950/40">分析时必须遵守的统计范围、剔除规则、单位和时间窗口。</div>
        </div>
        <p className="mt-3 text-[12px] leading-5 text-neutral-500">不适合把整份原始明细、订单列表、用户级样本值复制进来。这里更适合存“口径”和“标准”，不是存数据本身。</p>
      </section>

      <section className="rounded-xl border border-neutral-200 bg-white p-5 shadow-sm dark:border-neutral-800 dark:bg-neutral-900">
        <h2 className="text-[14px] font-semibold text-neutral-900 dark:text-neutral-100">现在已经实现了什么</h2>
        <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {IMPLEMENTED_FEATURES.map((item) => (
            <div key={item.title} className="rounded-lg border border-neutral-200 bg-neutral-50 p-3 dark:border-neutral-800 dark:bg-neutral-950/40">
              <h3 className="text-[12px] font-semibold text-neutral-900 dark:text-neutral-100">{item.title}</h3>
              <p className="mt-1 text-[11.5px] leading-5 text-neutral-600 dark:text-neutral-300">{item.body}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="rounded-xl border border-neutral-200 bg-white p-5 shadow-sm dark:border-neutral-800 dark:bg-neutral-900">
        <h2 className="text-[14px] font-semibold text-neutral-900 dark:text-neutral-100">怎么用</h2>
        <div className="mt-3 grid gap-2 text-[12px] text-neutral-600 dark:text-neutral-300 sm:grid-cols-2">
          <div className="rounded-lg border border-neutral-200 bg-neutral-50 p-3 dark:border-neutral-800 dark:bg-neutral-950/40">
            <h3 className="font-semibold text-neutral-900 dark:text-neutral-100">新增指标</h3>
            <p className="mt-1 leading-5">点「指标」，写清名称、含义、公式、口径、单位；保存后在列表里启用，再看 prompt 预览是否包含它。</p>
          </div>
          <div className="rounded-lg border border-neutral-200 bg-neutral-50 p-3 dark:border-neutral-800 dark:bg-neutral-950/40">
            <h3 className="font-semibold text-neutral-900 dark:text-neutral-100">登记标准文件</h3>
            <p className="mt-1 leading-5">点「标准文件」，填绝对路径和用途说明；注入时通常只带路径和用途，需要读取正文时由具体分析链路按权限读取。</p>
          </div>
        </div>
        <pre className="mt-3 whitespace-pre-wrap rounded-lg bg-neutral-50 p-3 text-[11.5px] leading-5 text-neutral-700 dark:bg-neutral-950 dark:text-neutral-300">{`指标示例：
名称：30 日复购率
分类：会员运营
含义：首购后 30 天内再次下单的用户占比
公式：30 日内复购用户数 / 首购用户数
口径：按 user_id 去重；退款订单剔除；统计窗口从首购支付成功时间开始
单位：%

标准文件示例：
名称：会员等级定义
绝对路径：/Users/.../clean_data/member-tier-definition.md
用途说明：用于解释 V1/V2/V3 等级划分和权益差异`}</pre>
      </section>

      <section className="rounded-xl border border-neutral-200 bg-white p-5 shadow-sm dark:border-neutral-800 dark:bg-neutral-900">
        <h2 className="text-[14px] font-semibold text-neutral-900 dark:text-neutral-100">后续值得优化的方向</h2>
        <p className="mt-1 text-[12px] text-neutral-500">下面是产品迭代建议，不表示已经上线。</p>
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          {ITERATION_IDEAS.map((item) => (
            <div key={item.title} className="rounded-lg border border-neutral-200 bg-neutral-50 p-3 dark:border-neutral-800 dark:bg-neutral-950/40">
              <h3 className="text-[12px] font-semibold text-neutral-900 dark:text-neutral-100">{item.title}</h3>
              <p className="mt-1 text-[11.5px] leading-5 text-neutral-600 dark:text-neutral-300">{item.body}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="rounded-xl border border-amber-200 bg-amber-50 p-5 text-amber-900 shadow-sm dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
        <h2 className="text-[14px] font-semibold">安全边界</h2>
        <p className="mt-2 text-[12px] leading-5">
          onto-knowhow 可以记录聚合口径、公式、单位、标准文件路径和用途说明；不要把 draw_data 原始行、用户级明细、订单样本或敏感字段复制进来。标准文件路径本身也要确认是项目允许引用的衍生产物或受控资料。
        </p>
      </section>
    </div>
  );
}

type ViewMode = "manage" | "templates" | "governance" | "import_export" | "traces" | "readme";

export function IndicatorsPane({ workspaceId, onStandardsChanged }: { workspaceId: string | null; onStandardsChanged?: () => void }) {
  const [view, setView] = useState<ViewMode>("manage");
  const [standards, setStandards] = useState<AnalysisStandard[]>([]);
  const [metricDefs, setMetricDefs] = useState<MetricDefinition[]>([]);
  const [promptInfo, setPromptInfo] = useState<{ prompt: string; count: number; updatedAt: number | null }>({ prompt: "", count: 0, updatedAt: null });
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState("");
  const [form, setForm] = useState<FormState | null>(null);
  const [saving, setSaving] = useState(false);
  const [enablements, setEnablements] = useState<Map<string, boolean>>(new Map());

  const refresh = useCallback(async () => {
    if (!workspaceId) return;
    setLoading(true);
    setError("");
    try {
      const [list, prompt, mets, enabs] = await Promise.all([
        api.listStandards(workspaceId),
        api.getStandardsPrompt(workspaceId),
        api.listMetrics(workspaceId),
        sharedApi.listMemoryEnablements(workspaceId),
      ]);
      setStandards(list);
      setPromptInfo(prompt);
      setMetricDefs(mets);
      setEnablements(new Map(enabs.map((e) => [e.itemId, e.enabled])));
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }, [workspaceId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const afterMutation = useCallback(async () => {
    await refresh();
    onStandardsChanged?.();
  }, [refresh, onStandardsChanged]);

  const files = useMemo(() => standards.filter((s) => s.kind === "reference_file"), [standards]);
  // metric 来自 metric_definitions，适配成 AnalysisStandard 形状供 StandardSection 复用渲染
  const metrics = useMemo<AnalysisStandard[]>(() => metricDefs.map((m) => ({
    id: m.id, workspaceId: m.workspaceId, kind: "metric", name: m.name, category: m.category,
    description: m.description, formula: m.formula, caliber: m.caliber, unit: m.unit,
    filePath: "", fileHash: null, enabled: m.enabled, createdAt: m.createdAt, updatedAt: m.updatedAt,
  })), [metricDefs]);

  const toggle = async (s: AnalysisStandard) => {
    if (!workspaceId) return;
    const current = enablements.get(s.id) ?? false;
    const next = !current;
    await sharedApi.setMemoryEnablement(workspaceId, "standard", s.id, next);
    setEnablements((prev) => {
      const m = new Map(prev);
      m.set(s.id, next);
      return m;
    });
    void afterMutation();
  };

  const remove = async (s: AnalysisStandard) => {
    if (!window.confirm(`确认删除「${s.name}」？（全局池删除，所有工作区都将失效）`)) return;
    await api.deleteStandard(s.id);
    void afterMutation();
  };

  // metric 真源切到 metric_definitions（P2b'）：指标的 toggle/delete 走 metric API
  const toggleMetric = async (s: AnalysisStandard) => {
    if (!workspaceId) return;
    const current = enablements.get(s.id) ?? false;
    const next = !current;
    await sharedApi.setMemoryEnablement(workspaceId, "metric", s.id, next);
    setEnablements((prev) => {
      const m = new Map(prev);
      m.set(s.id, next);
      return m;
    });
    void afterMutation();
  };
  const removeMetric = async (s: AnalysisStandard) => {
    if (!window.confirm(`确认删除「${s.name}」？（全局池删除，所有工作区都将失效）`)) return;
    await api.deleteMetric(s.id);
    void afterMutation();
  };

  const save = async () => {
    if (!workspaceId || !form) return;
    if (!form.name.trim()) {
      setError("名称必填");
      return;
    }
    if (form.kind === "reference_file" && !form.filePath.trim()) {
      setError("标准文件需填写绝对路径");
      return;
    }
    setSaving(true);
    setError("");
    try {
      if (form.kind === "metric") {
        const m = { name: form.name, category: form.category, description: form.description, formula: form.formula, caliber: form.caliber, unit: form.unit };
        if (form.id) await api.updateMetric(form.id, m);
        else await api.createMetric(workspaceId, m);
      } else if (form.id) {
        await api.updateStandard(form.id, toInput(form));
      } else {
        await api.createStandard(workspaceId, toInput(form));
      }
      setForm(null);
      await afterMutation();
    } catch (err) {
      setError(String(err));
    } finally {
      setSaving(false);
    }
  };

  const copyPrompt = async () => {
    if (!promptInfo.prompt) return;
    await navigator.clipboard.writeText(promptInfo.prompt);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1200);
  };

  const update = (patch: Partial<FormState>) => setForm((cur) => cur ? { ...cur, ...patch } : cur);
  const inputCls = "w-full rounded-md border border-neutral-200 bg-white px-3 py-2 text-[12px] outline-none focus:border-neutral-400 dark:border-neutral-700 dark:bg-neutral-950";

  return (
    <div className="flex min-h-0 flex-1 overflow-auto bg-neutral-50/60 p-5 dark:bg-neutral-950">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-4">
        <div className="flex items-start justify-between gap-4 rounded-xl border border-neutral-200 bg-white p-4 shadow-sm dark:border-neutral-800 dark:bg-neutral-900">
          <div>
            <h1 className="flex items-center gap-2 text-base font-semibold text-neutral-900 dark:text-neutral-100"><Calculator className="h-4 w-4" /> 指标体系</h1>
            <p className="mt-1 text-[12.5px] text-neutral-500">维护分析指标口径与参照标准文件，启用后注入分析 prompt（标准文件仅注入路径与用途，按需读取）。</p>
          </div>
          {view === "manage" && (
            <div className="flex shrink-0 flex-wrap gap-2">
              <button onClick={() => { setError(""); setForm(EMPTY_FORM("metric")); }} disabled={!workspaceId} className="inline-flex items-center gap-1.5 rounded-md border border-neutral-200 px-3 py-2 text-[12px] disabled:opacity-50 dark:border-neutral-700"><Plus className="h-3.5 w-3.5" /> 指标</button>
              <button onClick={() => { setError(""); setForm(EMPTY_FORM("reference_file")); }} disabled={!workspaceId} className="inline-flex items-center gap-1.5 rounded-md border border-neutral-200 px-3 py-2 text-[12px] disabled:opacity-50 dark:border-neutral-700"><Plus className="h-3.5 w-3.5" /> 标准文件</button>
              <button onClick={copyPrompt} disabled={!promptInfo.prompt} className="rounded-md border border-neutral-200 px-3 py-2 text-[12px] disabled:opacity-50 dark:border-neutral-700">{copied ? "已复制" : "复制 prompt"}</button>
              <button onClick={refresh} disabled={!workspaceId || loading} className="inline-flex items-center gap-1.5 rounded-md border border-neutral-200 px-3 py-2 text-[12px] disabled:opacity-50 dark:border-neutral-700">
                <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} /> 刷新
              </button>
            </div>
          )}
        </div>

        <div className="flex flex-wrap gap-1 w-fit rounded-lg border border-neutral-200 bg-white p-1 text-[12px] shadow-sm dark:border-neutral-800 dark:bg-neutral-900">
          {[
            { id: "manage" as const, label: "口径维护", icon: Calculator },
            { id: "templates" as const, label: "模板库", icon: Library },
            { id: "governance" as const, label: "冲突与体检", icon: ShieldAlert },
            { id: "import_export" as const, label: "导入/导出", icon: Upload },
            { id: "traces" as const, label: "使用痕迹", icon: History },
            { id: "readme" as const, label: "说明", icon: BookOpen },
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setView(tab.id)}
              className={cn(
                "rounded-md px-3 py-1.5 transition-colors flex items-center gap-1.5",
                view === tab.id
                  ? "bg-neutral-900 text-white dark:bg-neutral-100 dark:text-neutral-900"
                  : "text-neutral-500 hover:bg-neutral-100 hover:text-neutral-900 dark:hover:bg-neutral-800 dark:hover:text-neutral-100",
              )}
            >
              <tab.icon className="h-3.5 w-3.5" />
              {tab.label}
            </button>
          ))}
        </div>

        {error && <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-[12px] text-red-600 dark:border-red-900 dark:bg-red-950/30">{error}</div>}

        {view === "readme" ? (
          <OntoKnowhowReadme />
        ) : view === "templates" ? (
          <MetricTemplatesSection workspaceId={workspaceId} onApply={refresh} />
        ) : view === "governance" ? (
          <GovernanceSection workspaceId={workspaceId} />
        ) : view === "import_export" ? (
          <ImportExportSection workspaceId={workspaceId} onCommit={refresh} />
        ) : view === "traces" ? (
          <UsageTracesSection workspaceId={workspaceId} />
        ) : (<>
        {form && (
          <div className="rounded-xl border border-neutral-300 bg-white p-4 shadow-sm dark:border-neutral-700 dark:bg-neutral-900">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-[13px] font-semibold text-neutral-900 dark:text-neutral-100">
                {form.id ? "编辑" : "新增"}{form.kind === "metric" ? "指标口径" : "标准文件"}
              </h2>
              <span className="rounded border border-neutral-200 px-1.5 py-0.5 text-[10.5px] text-neutral-500 dark:border-neutral-700">{form.kind === "metric" ? "metric" : "reference_file"}</span>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <label className="col-span-1 text-[11px] text-neutral-500">名称<input className={inputCls} value={form.name} onChange={(e) => update({ name: e.target.value })} placeholder={form.kind === "metric" ? "如：复购率" : "如：电商品牌成交偏好清单"} /></label>
              <label className="col-span-1 text-[11px] text-neutral-500">分类<input className={inputCls} value={form.category} onChange={(e) => update({ category: e.target.value })} placeholder="如：人群分析" /></label>
              {form.kind === "metric" ? (
                <>
                  <label className="col-span-1 text-[11px] text-neutral-500">单位<input className={inputCls} value={form.unit} onChange={(e) => update({ unit: e.target.value })} placeholder="如：%、人、元" /></label>
                  <label className="col-span-1 text-[11px] text-neutral-500">含义<input className={inputCls} value={form.description} onChange={(e) => update({ description: e.target.value })} placeholder="指标业务含义" /></label>
                  <label className="col-span-2 text-[11px] text-neutral-500">公式<input className={inputCls} value={form.formula} onChange={(e) => update({ formula: e.target.value })} placeholder="如：复购用户数 / 成交用户数" /></label>
                  <label className="col-span-2 text-[11px] text-neutral-500">口径<textarea className={`${inputCls} min-h-16`} value={form.caliber} onChange={(e) => update({ caliber: e.target.value })} placeholder="统计口径、时间范围、过滤条件等" /></label>
                </>
              ) : (
                <>
                  <label className="col-span-2 text-[11px] text-neutral-500">绝对路径<input className={inputCls} value={form.filePath} onChange={(e) => update({ filePath: e.target.value })} placeholder="/Users/.../电商品牌成交偏好清单.md" /></label>
                  <label className="col-span-2 text-[11px] text-neutral-500">用途说明<textarea className={`${inputCls} min-h-16`} value={form.description} onChange={(e) => update({ description: e.target.value })} placeholder="如：品牌→类目映射，用于人群偏好分析" /></label>
                </>
              )}
            </div>
            <div className="mt-3 flex justify-end gap-2">
              <button onClick={() => { setForm(null); setError(""); }} className="rounded-md border border-neutral-200 px-3 py-2 text-[12px] dark:border-neutral-700">取消</button>
              <button onClick={() => void save()} disabled={saving} className="rounded-md bg-neutral-900 px-3 py-2 text-[12px] text-white disabled:opacity-50 dark:bg-neutral-100 dark:text-neutral-900">{saving ? "保存中…" : "保存"}</button>
            </div>
          </div>
        )}

        <div className="rounded-xl border border-neutral-200 bg-white p-4 shadow-sm dark:border-neutral-800 dark:bg-neutral-900">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-[13px] font-semibold text-neutral-900 dark:text-neutral-100">注入 prompt 预览</h2>
            <span className="text-[11px] text-neutral-400">启用 {promptInfo.count} 条</span>
          </div>
          <pre className="mt-3 max-h-56 overflow-auto whitespace-pre-wrap rounded-lg bg-neutral-50 p-3 text-[12px] leading-5 text-neutral-700 dark:bg-neutral-950 dark:text-neutral-300">{promptInfo.prompt || "暂无启用标准"}</pre>
        </div>

        <StandardSection title="指标口径" icon={Calculator} items={metrics} enablements={enablements} workspaceId={workspaceId} onToggle={toggleMetric} onEdit={(s) => { setError(""); setForm(toForm(s)); }} onDelete={removeMetric} renderExtra={(s) => s.kind === "metric" ? <MetricOntologyLinks workspaceId={workspaceId} metricId={s.id} /> : null} />
        <StandardSection title="参照标准文件" icon={FileText} items={files} enablements={enablements} workspaceId={workspaceId} onToggle={toggle} onEdit={(s) => { setError(""); setForm(toForm(s)); }} onDelete={remove} />
        </>)}
      </div>
    </div>
  );
}

function StandardSection({
  title, icon: Icon, items, enablements, workspaceId, onToggle, onEdit, onDelete, renderExtra
}: {
  title: string;
  icon: typeof Calculator;
  items: AnalysisStandard[];
  enablements: Map<string, boolean>;
  workspaceId: string | null;
  onToggle: (s: AnalysisStandard) => void;
  onEdit: (s: AnalysisStandard) => void;
  onDelete: (s: AnalysisStandard) => void;
  renderExtra?: (s: AnalysisStandard) => React.ReactNode;
}) {
  return (
    <div className="space-y-2">
      <h3 className="flex items-center gap-1.5 px-1 text-[12px] font-semibold text-neutral-500"><Icon className="h-3.5 w-3.5" /> {title} <span className="text-neutral-400">({items.length})</span></h3>
      {items.length === 0 ? (
        <div className="rounded-xl border border-dashed border-neutral-300 bg-white p-8 text-center text-[12.5px] text-neutral-400 dark:border-neutral-800 dark:bg-neutral-900/40">暂无{title}</div>
      ) : items.map((s) => {
        const wsEnabled = enablements.get(s.id) ?? false;
        return (
        <div key={s.id} className="rounded-xl border border-neutral-200 bg-white p-4 shadow-sm dark:border-neutral-800 dark:bg-neutral-900">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h4 className="text-[13px] font-semibold text-neutral-900 dark:text-neutral-100">{s.name}</h4>
                {s.category && <span className="rounded border border-neutral-200 px-1.5 py-0.5 text-[10.5px] text-neutral-500 dark:border-neutral-700">{s.category}</span>}
                {s.unit && <span className="rounded border border-neutral-200 px-1.5 py-0.5 text-[10.5px] text-neutral-500 dark:border-neutral-700">单位 {s.unit}</span>}
                {s.workspaceId !== workspaceId && (
                  <span className="rounded border border-amber-200 px-1.5 py-0.5 text-[10.5px] text-amber-600 dark:border-amber-800 dark:text-amber-400">来源</span>
                )}
              </div>
              {s.description && <p className="mt-2 text-[12px] leading-5 text-neutral-600 dark:text-neutral-300">{s.description}</p>}
              {s.kind === "metric" && s.formula && <p className="mt-1 font-mono text-[11px] text-neutral-500">公式：{s.formula}</p>}
              {s.kind === "metric" && s.caliber && <p className="mt-1 text-[11.5px] leading-5 text-neutral-500">口径：{s.caliber}</p>}
              {s.kind === "reference_file" && (
                <p className="mt-1 font-mono text-[10.5px] text-neutral-400">{s.filePath}{s.fileHash ? "" : "  ⚠ 文件不可读"}</p>
              )}
            </div>
            <div className="flex flex-col items-end gap-2 shrink-0">
              <div className="flex items-center gap-1.5">
                <button onClick={() => onToggle(s)} className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[12px] ${wsEnabled ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-300" : "bg-neutral-100 text-neutral-500 dark:bg-neutral-800"}`}>
                  <CheckCircle2 className="h-3.5 w-3.5" /> 本工作区{wsEnabled ? "启用" : "停用"}
                </button>
                <button onClick={() => onEdit(s)} className="rounded-md border border-neutral-200 p-1.5 text-neutral-500 hover:text-neutral-800 dark:border-neutral-700 dark:hover:text-neutral-200"><Pencil className="h-3.5 w-3.5" /></button>
                <button onClick={() => onDelete(s)} className="rounded-md border border-neutral-200 p-1.5 text-neutral-500 hover:text-red-600 dark:border-neutral-700"><Trash2 className="h-3.5 w-3.5" /></button>
              </div>
            </div>
          </div>
          {renderExtra && renderExtra(s)}
        </div>
        );
      })}
    </div>
  );
}

function MetricTemplatesSection({ workspaceId, onApply }: { workspaceId: string | null; onApply: () => void | Promise<void> }) {
  const [packs, setPacks] = useState<OkhMetricTemplatePack[]>([]);
  const [templates, setTemplates] = useState<OkhMetricTemplate[]>([]);
  const [loading, setLoading] = useState(false);
  const [applyingId, setApplyingId] = useState<string | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!workspaceId) return;
    setLoading(true);
    setError("");
    dataApi.listMetricTemplates(workspaceId).then((res) => {
      setPacks(res.packs);
      setTemplates(res.templates);
    }).catch((err) => {
      setError(String(err));
    }).finally(() => setLoading(false));
  }, [workspaceId]);

  const handleApply = async (packId: string) => {
    if (!workspaceId) return;
    setApplyingId(packId);
    setError("");
    try {
      const result = await dataApi.applyMetricTemplates(workspaceId, { packId, enable: true });
      await onApply();
      alert(`启用完成：新增 ${result.created.length} 条，跳过 ${result.skipped.length} 条。`);
    } catch (err) {
      setError("启用失败: " + String(err));
    } finally {
      setApplyingId(null);
    }
  };

  if (loading) return <div className="p-8 text-center text-neutral-500 text-xs">加载中...</div>;
  if (error) return <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-[12px] text-red-600 dark:border-red-900 dark:bg-red-950/30">{error}</div>;
  if (!packs.length) return <div className="p-8 text-center text-neutral-500 text-xs">暂无模板包</div>;

  return (
    <div className="space-y-4">
      {packs.map(pack => {
        const packTemplates = templates.filter(t => t.packId === pack.id);
        return (
          <div key={pack.id} className="rounded-xl border border-neutral-200 bg-white p-5 shadow-sm dark:border-neutral-800 dark:bg-neutral-900">
            <div className="flex items-start justify-between">
              <div>
                <h3 className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">{pack.title}</h3>
                <p className="mt-1 text-xs text-neutral-500">{pack.description}</p>
              </div>
              <button
                onClick={() => void handleApply(pack.id)}
                disabled={applyingId === pack.id}
                className="rounded-md bg-neutral-900 px-3 py-1.5 text-xs text-white hover:bg-neutral-800 disabled:opacity-50 dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-neutral-200 transition-colors"
              >
                {applyingId === pack.id ? "启用中..." : "启用此场景包"}
              </button>
            </div>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              {packTemplates.map(t => (
                <div key={t.id} className="rounded-lg border border-neutral-100 bg-neutral-50 p-3 text-xs dark:border-neutral-800 dark:bg-neutral-950/40">
                  <div className="font-medium text-neutral-700 dark:text-neutral-200">{t.name}</div>
                  <div className="mt-1 text-neutral-500">{t.description}</div>
                  <div className="mt-2 font-mono text-[10px] text-neutral-400">公式: {t.formula}</div>
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function GovernanceSection({ workspaceId }: { workspaceId: string | null }) {
  const [conflicts, setConflicts] = useState<OkhMetricConflict[]>([]);
  const [healths, setHealths] = useState<OkhStandardHealth[]>([]);
  const [loading, setLoading] = useState(false);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(() => {
    if (!workspaceId) return;
    setLoading(true);
    setError("");
    Promise.all([
      dataApi.getMetricConflicts(workspaceId, false),
      dataApi.getStandardFileHealth(workspaceId)
    ]).then(([cRes, hRes]) => {
      setConflicts(cRes);
      setHealths(hRes);
    }).catch((err) => {
      setError(String(err));
    }).finally(() => setLoading(false));
  }, [workspaceId]);

  useEffect(() => { load(); }, [load]);

  const handleCheck = async () => {
    if (!workspaceId) return;
    setChecking(true);
    setError("");
    try {
      const res = await dataApi.checkStandardFileHealth(workspaceId);
      setHealths(res);
    } catch (err) {
      setError("检查失败: " + String(err));
    } finally {
      setChecking(false);
    }
  };

  if (loading) return <div className="p-8 text-center text-neutral-500 text-xs">加载中...</div>;
  if (error) return <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-[12px] text-red-600 dark:border-red-900 dark:bg-red-950/30">{error}</div>;

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-neutral-200 bg-white p-5 shadow-sm dark:border-neutral-800 dark:bg-neutral-900">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-neutral-900 dark:text-neutral-100">
          <AlertTriangle className="h-4 w-4 text-amber-500" /> 指标口径冲突
        </h3>
        <p className="mt-1 text-xs text-neutral-500">自动检查相似或同名的活跃指标是否存在口径分歧。</p>
        {conflicts.length === 0 ? (
          <div className="mt-4 rounded-lg bg-emerald-50 p-3 text-xs text-emerald-600 dark:bg-emerald-950/30 dark:text-emerald-400">未发现明显的口径冲突，指标体系健康。</div>
        ) : (
          <div className="mt-4 space-y-2">
            {conflicts.map(c => (
              <div key={c.id} className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs dark:border-amber-900/50 dark:bg-amber-950/20">
                <div className="font-semibold text-amber-900 dark:text-amber-200">发现冲突 ({c.reason})</div>
                <div className="mt-1 text-amber-700 dark:text-amber-300">{c.message}</div>
                <div className="mt-1 text-amber-600/70 dark:text-amber-400/70">涉及字段: {c.fields.join(", ")}</div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="rounded-xl border border-neutral-200 bg-white p-5 shadow-sm dark:border-neutral-800 dark:bg-neutral-900">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="flex items-center gap-2 text-sm font-semibold text-neutral-900 dark:text-neutral-100">
              <FileText className="h-4 w-4 text-blue-500" /> 标准文件可读性体检
            </h3>
            <p className="mt-1 text-xs text-neutral-500">检查登记的标准文件路径是否真实可读。</p>
          </div>
          <button onClick={() => void handleCheck()} disabled={checking} className="rounded-md border border-neutral-200 px-3 py-1.5 text-xs hover:bg-neutral-50 dark:border-neutral-700 dark:hover:bg-neutral-800 transition-colors">
            {checking ? "检查中..." : "重新检查"}
          </button>
        </div>
        <div className="mt-4 space-y-2">
          {healths.map(h => (
            <div key={h.standardId} className="flex items-center gap-3 rounded-lg border border-neutral-100 bg-neutral-50 p-3 text-xs dark:border-neutral-800 dark:bg-neutral-950/40">
              <div className={`h-2 w-2 shrink-0 rounded-full ${h.status === 'ok' ? 'bg-emerald-500' : h.status === 'warn' ? 'bg-amber-500' : 'bg-red-500'}`} />
              <div className="min-w-0 flex-1">
                <div className="truncate text-neutral-700 dark:text-neutral-300">{h.message}</div>
                {h.riskFlags.length > 0 && (
                  <div className="mt-1 flex gap-1">
                    {h.riskFlags.map(r => <span key={r} className="rounded bg-red-100 px-1 py-0.5 text-[10px] text-red-600 dark:bg-red-900/40 dark:text-red-400">{r}</span>)}
                  </div>
                )}
              </div>
            </div>
          ))}
          {healths.length === 0 && <div className="text-xs text-neutral-400">暂无标准文件</div>}
        </div>
      </div>
    </div>
  );
}

const MAX_OKH_IMPORT_BYTES = 5 * 1024 * 1024;

function ImportExportSection({ workspaceId, onCommit }: { workspaceId: string | null; onCommit: () => void | Promise<void> }) {
  const [preview, setPreview] = useState<OkhMetricImportPreview | null>(null);
  const [loading, setLoading] = useState(false);
  const [committing, setCommitting] = useState(false);
  const [error, setError] = useState("");

  const handleExport = async () => {
    if (!workspaceId) return;
    setError("");
    try {
      const res = await dataApi.exportOkhMetrics(workspaceId, { format: "csv" });
      if (!res.ok) throw new Error(await res.text());
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `metrics_export_${Date.now()}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError("导出失败: " + String(err));
    }
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !workspaceId) return;
    if (file.size > MAX_OKH_IMPORT_BYTES) {
      setError("文件超过 5MB，请拆分后再导入。");
      e.target.value = "";
      return;
    }
    setLoading(true);
    setError("");
    try {
      const text = await file.text();
      const format = file.name.toLowerCase().endsWith(".json") ? "json" : "csv";
      const res = await dataApi.previewOkhMetricImport(workspaceId, { content: text, format, filename: file.name });
      setPreview(res);
    } catch (err) {
      setError("解析失败: " + String(err));
    } finally {
      setLoading(false);
      e.target.value = "";
    }
  };

  const handleCommit = async () => {
    if (!workspaceId || !preview) return;
    const validRows = preview.rows.filter((row) => row.valid);
    if (validRows.length === 0) return;
    setCommitting(true);
    setError("");
    try {
      const result = await dataApi.commitOkhMetricImport(workspaceId, {
        rows: validRows.map(r => r.normalized ?? r.input),
        enable: true,
        conflictPolicy: "create_version"
      });
      setPreview(null);
      await onCommit();
      alert(`导入完成：新增 ${result.created.length} 条，跳过 ${result.skipped.length} 条，错误 ${result.errors.length} 条。`);
    } catch (err) {
      setError("导入失败: " + String(err));
    } finally {
      setCommitting(false);
    }
  };

  return (
    <div className="space-y-4">
      {error && <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-[12px] text-red-600 dark:border-red-900 dark:bg-red-950/30">{error}</div>}
      <div className="flex flex-col sm:flex-row gap-4">
        <div className="flex-1 rounded-xl border border-neutral-200 bg-white p-5 shadow-sm dark:border-neutral-800 dark:bg-neutral-900">
          <h3 className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">批量导入</h3>
          <p className="mt-1 text-xs text-neutral-500 leading-relaxed">支持上传 CSV 文件导入指标口径，需包含名称、公式等列。</p>
          <div className="mt-4 flex items-center gap-3">
            <label className="inline-flex cursor-pointer items-center gap-2 rounded-md bg-neutral-900 px-4 py-2 text-xs text-white hover:bg-neutral-800 dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-neutral-200 transition-colors">
              <Upload className="h-4 w-4" /> 选择文件 (CSV)
              <input type="file" accept=".csv,.json" className="hidden" onChange={(e) => void handleFileChange(e)} disabled={loading} />
            </label>
            {loading && <span className="text-xs text-neutral-500">解析中...</span>}
          </div>
        </div>
        <div className="flex-1 rounded-xl border border-neutral-200 bg-white p-5 shadow-sm dark:border-neutral-800 dark:bg-neutral-900">
          <h3 className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">导出备份</h3>
          <p className="mt-1 text-xs text-neutral-500 leading-relaxed">将当前工作区所有启用的指标导出为 CSV 备份文件。</p>
          <div className="mt-4">
            <button onClick={() => void handleExport()} className="inline-flex items-center gap-2 rounded-md border border-neutral-200 px-4 py-2 text-xs hover:bg-neutral-50 dark:border-neutral-700 dark:hover:bg-neutral-800 transition-colors">
              <Download className="h-4 w-4" /> 下载导出文件
            </button>
          </div>
        </div>
      </div>

      {preview && (
        <div className="rounded-xl border border-neutral-200 bg-white p-5 shadow-sm dark:border-neutral-800 dark:bg-neutral-900">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">导入预览</h3>
            <div className="flex items-center gap-3">
              <span className="text-xs text-neutral-500 hidden sm:inline">共 {preview.totalRows} 行，合法 {preview.validRows}，无效 {preview.invalidRows}</span>
              <button onClick={() => setPreview(null)} className="rounded-md border border-neutral-200 px-3 py-1.5 text-xs hover:bg-neutral-50 dark:border-neutral-700 dark:hover:bg-neutral-800 transition-colors">取消</button>
              <button onClick={() => void handleCommit()} disabled={committing || preview.validRows === 0} className="rounded-md bg-emerald-600 px-3 py-1.5 text-xs text-white hover:bg-emerald-700 disabled:opacity-50 transition-colors">
                {committing ? "提交中..." : "确认导入有效项"}
              </button>
            </div>
          </div>
          <div className="max-h-64 overflow-auto space-y-2 pr-2">
            {preview.rows.map((r, i) => (
              <div key={i} className={`rounded-lg border p-3 text-xs ${r.valid ? 'border-neutral-100 bg-neutral-50 dark:border-neutral-800 dark:bg-neutral-950/40' : 'border-red-200 bg-red-50 dark:border-red-900/50 dark:bg-red-950/20'}`}>
                <div className="flex items-center gap-2">
                  <span className={`font-mono text-[10px] px-1.5 py-0.5 rounded ${r.valid ? 'bg-neutral-200 text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300' : 'bg-red-200 text-red-700 dark:bg-red-900 dark:text-red-300'}`}>Row {r.rowNumber}</span>
                  <span className="font-semibold text-neutral-900 dark:text-neutral-100">{r.normalized?.name || "未知名称"}</span>
                </div>
                {r.errors.length > 0 && <div className="mt-1.5 text-red-600 dark:text-red-400 font-medium">{r.errors.join("；")}</div>}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function UsageTracesSection({ workspaceId }: { workspaceId: string | null }) {
  const [traces, setTraces] = useState<MetricInjectionTrace[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!workspaceId) return;
    setLoading(true);
    setError("");
    vizApi.listMetricInjectionTraces(workspaceId, { limit: 50 })
      .then(setTraces)
      .catch((err) => setError(String(err)))
      .finally(() => setLoading(false));
  }, [workspaceId]);

  if (loading) return <div className="p-8 text-center text-neutral-500 text-xs">加载中...</div>;
  if (error) return <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-[12px] text-red-600 dark:border-red-900 dark:bg-red-950/30">{error}</div>;

  return (
    <div className="rounded-xl border border-neutral-200 bg-white p-5 shadow-sm dark:border-neutral-800 dark:bg-neutral-900">
      <h3 className="text-sm font-semibold text-neutral-900 dark:text-neutral-100 mb-4">近期使用痕迹</h3>
      {traces.length === 0 ? (
        <div className="rounded-lg bg-neutral-50 p-6 text-center text-xs text-neutral-500 dark:bg-neutral-950/40">近期没有指标被注入到分析中。</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs whitespace-nowrap">
            <thead className="border-b border-neutral-200 bg-neutral-50 text-neutral-500 dark:border-neutral-800 dark:bg-neutral-900/50">
              <tr>
                <th className="p-3 font-medium">指标</th>
                <th className="p-3 font-medium">场景</th>
                <th className="p-3 font-medium">目标 ID</th>
                <th className="p-3 font-medium">状态</th>
                <th className="p-3 font-medium text-right">Token 估算</th>
                <th className="p-3 font-medium text-right">时间</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-100 dark:divide-neutral-800">
              {traces.map(t => (
                <tr key={t.id} className="hover:bg-neutral-50/50 dark:hover:bg-neutral-900/50 transition-colors">
                  <td className="p-3 font-medium text-neutral-900 dark:text-neutral-100">{t.metricName}</td>
                  <td className="p-3 text-neutral-500">{t.targetScope === "chat" ? "对话" : "工作流"} ({t.targetKind})</td>
                  <td className="p-3 font-mono text-[10px] text-neutral-400">{t.targetId.slice(0, 8)}...</td>
                  <td className="p-3">
                    {t.injected ? (
                      <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-400"><CheckCircle2 className="h-3 w-3" /> 已注入</span>
                    ) : (
                      <span className="inline-flex items-center gap-1.5 rounded-full bg-neutral-100 px-2 py-0.5 text-[10px] text-neutral-600 dark:bg-neutral-800 dark:text-neutral-400" title={t.omittedReason || ""}><AlertTriangle className="h-3 w-3" /> 未注入</span>
                    )}
                  </td>
                  <td className="p-3 text-right text-neutral-500">{t.tokenEstimate}</td>
                  <td className="p-3 text-right text-neutral-400">{new Date(t.createdAt).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function MetricOntologyLinks({ workspaceId, metricId }: { workspaceId: string | null; metricId: string }) {
  const [links, setLinks] = useState<OkhMetricOntologyLink[]>([]);
  const [adding, setAdding] = useState(false);
  const [ontologies, setOntologies] = useState<Ontology[]>([]);
  const [targetOptions, setTargetOptions] = useState<OkhMetricLinkTargetOption[]>([]);
  const [selOntologyId, setSelOntologyId] = useState("");
  const [selTargetKind, setSelTargetKind] = useState<OkhMetricLinkTargetKind>("object");
  const [selTargetId, setSelTargetId] = useState("");
  const [error, setError] = useState("");
  
  const load = useCallback(() => {
    if (!workspaceId) return;
    dataApi.listOkhMetricOntologyLinks(workspaceId, metricId).then(setLinks).catch(e => console.error(e));
  }, [workspaceId, metricId]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { if (adding && workspaceId) vizApi.listOntologies(workspaceId).then(setOntologies).catch(e=>console.error(e)); }, [adding, workspaceId]);
  useEffect(() => {
    if (!selOntologyId) {
      setTargetOptions([]);
      return;
    }
    let cancelled = false;
    const loadTargets = async () => {
      try {
        setError("");
        if (selTargetKind === "object") {
          const objects = await vizApi.listObjects(selOntologyId);
          if (!cancelled) setTargetOptions(objects.map((item: ObjectType) => ({ id: item.id, label: item.nameCn })));
          return;
        }
        if (selTargetKind === "link") {
          const [linkList, objects] = await Promise.all([vizApi.listLinks(selOntologyId), vizApi.listObjects(selOntologyId)]);
          const objectNames = new Map(objects.map((item: ObjectType) => [item.id, item.nameCn]));
          if (!cancelled) {
            setTargetOptions(linkList.map((item: LinkType) => ({
              id: item.id,
              label: `${objectNames.get(item.sourceObjectId) ?? item.sourceObjectId.slice(0, 6)} ${item.kind} ${objectNames.get(item.targetObjectId) ?? item.targetObjectId.slice(0, 6)}`,
            })));
          }
          return;
        }
        const logicRules = await vizApi.listLogicRules(selOntologyId);
        if (!cancelled) setTargetOptions(logicRules.map((item: LogicRule) => ({ id: item.id, label: item.nameCn })));
      } catch (e) {
        if (!cancelled) {
          setTargetOptions([]);
          setError(String(e instanceof Error ? e.message : e));
        }
      }
    };
    void loadTargets();
    return () => { cancelled = true; };
  }, [selOntologyId, selTargetKind]);

  if (!workspaceId) return null;

  const handleAdd = async () => {
    if (!selOntologyId || !selTargetId) return;
    try {
      const newLinks = [...links, { ontologyId: selOntologyId, targetKind: selTargetKind, targetId: selTargetId }];
      await dataApi.replaceOkhMetricOntologyLinks(workspaceId, metricId, newLinks);
      setAdding(false); setSelOntologyId(""); setSelTargetKind("object"); setSelTargetId(""); setError("");
      load();
    } catch (e) { setError(String(e instanceof Error ? e.message : e)); }
  };

  const handleRemove = async (linkId: string) => {
    try {
      const result = await dataApi.deleteOkhMetricOntologyLink(workspaceId, linkId);
      if (!result.ok) throw new Error("delete failed");
      setError("");
      load();
    } catch(e) { setError(String(e instanceof Error ? e.message : e)); }
  };

  return (
    <div className="mt-3 pt-3 border-t border-neutral-100 dark:border-neutral-800/60 flex items-start gap-2">
      <span className="text-[11px] text-neutral-400 font-medium whitespace-nowrap mt-1">关联本体对象:</span>
      <div className="flex flex-wrap items-center gap-1.5">
        {links.map(link => (
          <div key={link.id} className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded border border-neutral-200 bg-neutral-50 text-[10.5px] text-neutral-600 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-300">
            <a href={`/?workspaceId=${encodeURIComponent(workspaceId)}&tab=onto_xanthil&subTab=${okhTargetSubTab(link.targetKind)}&ontologyId=${encodeURIComponent(link.ontologyId)}&targetKind=${encodeURIComponent(link.targetKind)}&targetId=${encodeURIComponent(link.targetId)}`} target="_blank" rel="noreferrer" className="hover:text-blue-600 hover:underline dark:hover:text-blue-400">
              {link.targetKind === "object" ? "实体" : link.targetKind === "link" ? "关系" : "逻辑"} {link.targetId.slice(0, 6)} ↗
            </a>
            <button onClick={() => void handleRemove(link.id)} className="text-neutral-400 hover:text-red-500 ml-0.5">&times;</button>
          </div>
        ))}
        {!adding ? (
          <button onClick={() => setAdding(true)} className="inline-flex items-center gap-1 rounded border border-dashed border-neutral-300 bg-white px-2 py-0.5 text-[10.5px] text-neutral-500 hover:border-neutral-400 hover:text-neutral-700 dark:border-neutral-700 dark:bg-transparent dark:hover:border-neutral-500 dark:hover:text-neutral-300">
            + 添加关联
          </button>
        ) : (
          <div className="flex items-center gap-1 ml-1">
            <select className="rounded border border-neutral-200 bg-white px-1 py-0.5 text-[10.5px] outline-none dark:border-neutral-700 dark:bg-neutral-900" value={selOntologyId} onChange={e => { setSelOntologyId(e.target.value); setSelTargetId(""); }}><option value="">选本体...</option>{ontologies.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}</select>
            <select className="rounded border border-neutral-200 bg-white px-1 py-0.5 text-[10.5px] outline-none dark:border-neutral-700 dark:bg-neutral-900" value={selTargetKind} onChange={e => { setSelTargetKind(e.target.value as OkhMetricLinkTargetKind); setSelTargetId(""); }} disabled={!selOntologyId}>
              <option value="object">对象</option>
              <option value="link">关系</option>
              <option value="logic">逻辑</option>
            </select>
            <select className="rounded border border-neutral-200 bg-white px-1 py-0.5 text-[10.5px] outline-none dark:border-neutral-700 dark:bg-neutral-900" value={selTargetId} onChange={e => setSelTargetId(e.target.value)} disabled={!selOntologyId}><option value="">选目标...</option>{targetOptions.map(o => <option key={o.id} value={o.id}>{o.label}</option>)}</select>
            <button onClick={() => void handleAdd()} disabled={!selOntologyId || !selTargetId} className="rounded bg-blue-50 px-2 py-0.5 text-[10.5px] text-blue-600 hover:bg-blue-100 disabled:opacity-50 dark:bg-blue-900/30 dark:text-blue-400 dark:hover:bg-blue-900/50">确定</button>
            <button onClick={() => { setAdding(false); setError(""); }} className="rounded px-2 py-0.5 text-[10.5px] text-neutral-500 hover:bg-neutral-100 dark:hover:bg-neutral-800">取消</button>
          </div>
        )}
        {error && <span className="text-[10.5px] text-red-500">{error}</span>}
      </div>
    </div>
  );
}
