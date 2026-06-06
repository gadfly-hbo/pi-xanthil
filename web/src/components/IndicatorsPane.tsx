import { useCallback, useEffect, useMemo, useState } from "react";
import { Calculator, CheckCircle2, FileText, Pencil, Plus, RefreshCw, Trash2 } from "lucide-react";
import { api } from "@/lib/api";
import type { AnalysisStandard, AnalysisStandardInput, AnalysisStandardKind } from "@/types";

type FormState = AnalysisStandardInput & { id: string | null };

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

export function IndicatorsPane({ workspaceId, onStandardsChanged }: { workspaceId: string | null; onStandardsChanged?: () => void }) {
  const [standards, setStandards] = useState<AnalysisStandard[]>([]);
  const [promptInfo, setPromptInfo] = useState<{ prompt: string; count: number; updatedAt: number | null }>({ prompt: "", count: 0, updatedAt: null });
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState("");
  const [form, setForm] = useState<FormState | null>(null);
  const [saving, setSaving] = useState(false);

  const refresh = useCallback(async () => {
    if (!workspaceId) return;
    setLoading(true);
    setError("");
    try {
      const [list, prompt] = await Promise.all([
        api.listStandards(workspaceId),
        api.getStandardsPrompt(workspaceId),
      ]);
      setStandards(list);
      setPromptInfo(prompt);
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

  const metrics = useMemo(() => standards.filter((s) => s.kind === "metric"), [standards]);
  const files = useMemo(() => standards.filter((s) => s.kind === "reference_file"), [standards]);

  const toggle = async (s: AnalysisStandard) => {
    await api.updateStandardEnabled(s.id, !s.enabled);
    setStandards((cur) => cur.map((item) => item.id === s.id ? { ...item, enabled: !item.enabled } : item));
    void afterMutation();
  };

  const remove = async (s: AnalysisStandard) => {
    if (!window.confirm(`确认删除「${s.name}」？`)) return;
    await api.deleteStandard(s.id);
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
      if (form.id) await api.updateStandard(form.id, toInput(form));
      else await api.createStandard(workspaceId, toInput(form));
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
          <div className="flex shrink-0 flex-wrap gap-2">
            <button onClick={() => { setError(""); setForm(EMPTY_FORM("metric")); }} disabled={!workspaceId} className="inline-flex items-center gap-1.5 rounded-md border border-neutral-200 px-3 py-2 text-[12px] disabled:opacity-50 dark:border-neutral-700"><Plus className="h-3.5 w-3.5" /> 指标</button>
            <button onClick={() => { setError(""); setForm(EMPTY_FORM("reference_file")); }} disabled={!workspaceId} className="inline-flex items-center gap-1.5 rounded-md border border-neutral-200 px-3 py-2 text-[12px] disabled:opacity-50 dark:border-neutral-700"><Plus className="h-3.5 w-3.5" /> 标准文件</button>
            <button onClick={copyPrompt} disabled={!promptInfo.prompt} className="rounded-md border border-neutral-200 px-3 py-2 text-[12px] disabled:opacity-50 dark:border-neutral-700">{copied ? "已复制" : "复制 prompt"}</button>
            <button onClick={refresh} disabled={!workspaceId || loading} className="inline-flex items-center gap-1.5 rounded-md border border-neutral-200 px-3 py-2 text-[12px] disabled:opacity-50 dark:border-neutral-700">
              <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} /> 刷新
            </button>
          </div>
        </div>

        {error && <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-[12px] text-red-600 dark:border-red-900 dark:bg-red-950/30">{error}</div>}

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

        <StandardSection title="指标口径" icon={Calculator} items={metrics} onToggle={toggle} onEdit={(s) => { setError(""); setForm(toForm(s)); }} onDelete={remove} />
        <StandardSection title="参照标准文件" icon={FileText} items={files} onToggle={toggle} onEdit={(s) => { setError(""); setForm(toForm(s)); }} onDelete={remove} />
      </div>
    </div>
  );
}

function StandardSection({
  title, icon: Icon, items, onToggle, onEdit, onDelete,
}: {
  title: string;
  icon: typeof Calculator;
  items: AnalysisStandard[];
  onToggle: (s: AnalysisStandard) => void;
  onEdit: (s: AnalysisStandard) => void;
  onDelete: (s: AnalysisStandard) => void;
}) {
  return (
    <div className="space-y-2">
      <h3 className="flex items-center gap-1.5 px-1 text-[12px] font-semibold text-neutral-500"><Icon className="h-3.5 w-3.5" /> {title} <span className="text-neutral-400">({items.length})</span></h3>
      {items.length === 0 ? (
        <div className="rounded-xl border border-dashed border-neutral-300 bg-white p-8 text-center text-[12.5px] text-neutral-400 dark:border-neutral-800 dark:bg-neutral-900/40">暂无{title}</div>
      ) : items.map((s) => (
        <div key={s.id} className="rounded-xl border border-neutral-200 bg-white p-4 shadow-sm dark:border-neutral-800 dark:bg-neutral-900">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h4 className="text-[13px] font-semibold text-neutral-900 dark:text-neutral-100">{s.name}</h4>
                {s.category && <span className="rounded border border-neutral-200 px-1.5 py-0.5 text-[10.5px] text-neutral-500 dark:border-neutral-700">{s.category}</span>}
                {s.unit && <span className="rounded border border-neutral-200 px-1.5 py-0.5 text-[10.5px] text-neutral-500 dark:border-neutral-700">单位 {s.unit}</span>}
              </div>
              {s.description && <p className="mt-2 text-[12px] leading-5 text-neutral-600 dark:text-neutral-300">{s.description}</p>}
              {s.kind === "metric" && s.formula && <p className="mt-1 font-mono text-[11px] text-neutral-500">公式：{s.formula}</p>}
              {s.kind === "metric" && s.caliber && <p className="mt-1 text-[11.5px] leading-5 text-neutral-500">口径：{s.caliber}</p>}
              {s.kind === "reference_file" && (
                <p className="mt-1 font-mono text-[10.5px] text-neutral-400">{s.filePath}{s.fileHash ? "" : "  ⚠ 文件不可读"}</p>
              )}
            </div>
            <div className="flex shrink-0 items-center gap-1.5">
              <button onClick={() => onToggle(s)} className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[12px] ${s.enabled ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-300" : "bg-neutral-100 text-neutral-500 dark:bg-neutral-800"}`}>
                <CheckCircle2 className="h-3.5 w-3.5" /> {s.enabled ? "启用" : "停用"}
              </button>
              <button onClick={() => onEdit(s)} className="rounded-md border border-neutral-200 p-1.5 text-neutral-500 hover:text-neutral-800 dark:border-neutral-700 dark:hover:text-neutral-200"><Pencil className="h-3.5 w-3.5" /></button>
              <button onClick={() => onDelete(s)} className="rounded-md border border-neutral-200 p-1.5 text-neutral-500 hover:text-red-600 dark:border-neutral-700"><Trash2 className="h-3.5 w-3.5" /></button>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
