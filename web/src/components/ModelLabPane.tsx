import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertCircle,
  ArrowLeft,
  ChevronDown,
  CircleCheck,
  Download,
  History,
  Loader2,
  Search,
  RefreshCw,
  TrendingUp,
  Upload,
} from "lucide-react";
import { cn } from "@/lib/cn";
import { api } from "@/lib/api";
import ModelInfoCard from "./ModelInfoCard";
import { ModelBuilder } from "./ModelBuilder";
import type { ModelLabRunSummary, PiModel, PredictionResult, PredictionTierColor, PredictionVariant } from "@/types";
import { MODELS, MODEL_CATEGORIES, OPERATIONAL_MODEL_IDS, type ModelDef, type ModelCategoryId, type ModelFieldDef } from "@/data/models";

interface Props {
  model: string;
  models: PiModel[];
  mode?: "prediction" | "operational" | "all";
  restoreRunId?: string | null;
  onRestoreConsumed?: () => void;
}

// ---- tier and variant color configs ----

const TIER_COLORS: Record<PredictionTierColor, { text: string; bg: string; border: string }> = {
  red:     { text: "text-red-700 dark:text-red-400",       bg: "bg-red-50 dark:bg-red-950/30",       border: "border-red-200 dark:border-red-800" },
  orange:  { text: "text-orange-700 dark:text-orange-400", bg: "bg-orange-50 dark:bg-orange-950/30", border: "border-orange-200 dark:border-orange-800" },
  amber:   { text: "text-amber-700 dark:text-amber-400",   bg: "bg-amber-50 dark:bg-amber-950/30",   border: "border-amber-200 dark:border-amber-800" },
  green:   { text: "text-emerald-700 dark:text-emerald-400", bg: "bg-emerald-50 dark:bg-emerald-950/30", border: "border-emerald-200 dark:border-emerald-800" },
  blue:    { text: "text-blue-700 dark:text-blue-400",     bg: "bg-blue-50 dark:bg-blue-950/30",     border: "border-blue-200 dark:border-blue-800" },
  purple:  { text: "text-purple-700 dark:text-purple-400", bg: "bg-purple-50 dark:bg-purple-950/30", border: "border-purple-200 dark:border-purple-800" },
  neutral: { text: "text-neutral-700 dark:text-neutral-300", bg: "bg-neutral-50 dark:bg-neutral-900", border: "border-neutral-200 dark:border-neutral-700" },
};

const SCORE_BAR_COLOR: Record<PredictionTierColor, string> = {
  red: "bg-red-500", orange: "bg-orange-500", amber: "bg-amber-400",
  green: "bg-emerald-500", blue: "bg-blue-500", purple: "bg-purple-500", neutral: "bg-neutral-400",
};

const VARIANT_COLORS: Record<PredictionVariant, { text: string; bg: string; border: string }> = {
  neutral: { text: "text-neutral-700 dark:text-neutral-300", bg: "bg-neutral-50 dark:bg-neutral-900/60",   border: "border-neutral-200 dark:border-neutral-800" },
  success: { text: "text-emerald-700 dark:text-emerald-300", bg: "bg-emerald-50 dark:bg-emerald-950/30",   border: "border-emerald-200 dark:border-emerald-800" },
  warning: { text: "text-amber-700 dark:text-amber-300",     bg: "bg-amber-50 dark:bg-amber-950/30",       border: "border-amber-200 dark:border-amber-800" },
  danger:  { text: "text-red-700 dark:text-red-300",         bg: "bg-red-50 dark:bg-red-950/30",           border: "border-red-200 dark:border-red-800" },
};

// ---- CSV parser ----

function parseCsv(text: string): { headers: string[]; rows: Record<string, unknown>[] } {
  const lines = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n").filter((l) => l.trim());
  if (lines.length < 2) return { headers: [], rows: [] };

  function parseRow(line: string): string[] {
    const fields: string[] = [];
    let cur = "";
    let inQ = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (c === '"') {
        if (inQ && line[i + 1] === '"') { cur += '"'; i++; }
        else inQ = !inQ;
      } else if (c === "," && !inQ) { fields.push(cur.trim()); cur = ""; }
      else cur += c;
    }
    fields.push(cur.trim());
    return fields;
  }

  const headers = parseRow(lines[0]!).map((h) => h.trim());
  const rows = lines.slice(1).map((line) => {
    const vals = parseRow(line);
    const row: Record<string, unknown> = {};
    headers.forEach((h, i) => { row[h] = vals[i] ?? ""; });
    return row;
  });
  return { headers, rows };
}

// ---- auto-mapping ----

function autoMap(columns: string[], fields: ModelFieldDef[]): Record<string, string> {
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9一-龥]/g, "");
  const normCols = columns.map(norm);

  const result: Record<string, string> = {};
  for (const field of fields) {
    const keyNorm = norm(field.key);
    const labelNorm = norm(field.label);
    const parts = field.key.split("_").filter((p) => p.length > 2).map((p) => p.toLowerCase());

    let idx = normCols.findIndex((c) => c === keyNorm);
    if (idx < 0) idx = normCols.findIndex((c) => parts.length > 0 && parts.every((p) => c.includes(p)));
    if (idx < 0) idx = normCols.findIndex((c) => parts.some((p) => c.includes(p)));
    if (idx < 0 && labelNorm.length > 1) idx = normCols.findIndex((c) => c.includes(labelNorm) || labelNorm.includes(c));
    result[field.key] = idx >= 0 ? columns[idx]! : "";
  }
  return result;
}

// ---- export ----

function formatRunTime(ts: number): string {
  return new Date(ts).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}

function exportCsv(result: PredictionResult): void {
  const hasLabel = result.rows.some((r) => r.label);
  const hasAttrs = result.rows.some((r) => r.attributes?.length);
  const attrKeys = hasAttrs ? [...new Set(result.rows.flatMap((r) => r.attributes?.map((a) => a.key) ?? []))] : [];

  const headers = ["ID", ...(hasLabel ? ["名称"] : []), "评分", "等级", "核心结论", ...attrKeys];
  const dataRows = result.rows.map((r) => [
    r.id,
    ...(hasLabel ? [r.label ?? ""] : []),
    (r.score * 100).toFixed(1) + "%",
    r.tierLabel,
    r.primaryConclusion,
    ...attrKeys.map((k) => r.attributes?.find((a) => a.key === k)?.value ?? ""),
  ]);
  const csv = [headers, ...dataRows]
    .map((row) => row.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(","))
    .join("\n");
  const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${result.modelId}-prediction.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

// ---- sub-components ----

function TierBadge({ tierLabel, tierColor }: { tierLabel: string; tierColor: PredictionTierColor }) {
  const cfg = TIER_COLORS[tierColor] ?? TIER_COLORS.neutral;
  return (
    <span className={cn("inline-flex items-center rounded-full border px-2.5 py-0.5 text-[11.5px] font-semibold", cfg.text, cfg.bg, cfg.border)}>
      {tierLabel}
    </span>
  );
}

// ---- step types ----

type Step = "select_model" | "configure" | "running" | "results";

// ---- main ----

export function ModelLabPane({ model, mode = "prediction", restoreRunId, onRestoreConsumed }: Props) {
  const [modelDefs, setModelDefs] = useState<ModelDef[]>(MODELS);
  const [step, setStep] = useState<Step>("select_model");
  const [activeDef, setActiveDef] = useState<ModelDef>(
    mode === "operational"
      ? modelDefs.find((def) => OPERATIONAL_MODEL_IDS.has(def.id)) ?? modelDefs[0]!
      : mode === "all"
        ? modelDefs[0]!
        : modelDefs.find((def) => !OPERATIONAL_MODEL_IDS.has(def.id)) ?? modelDefs[0]!,
  );
  const [csvColumns, setCsvColumns] = useState<string[]>([]);
  const [csvRows, setCsvRows] = useState<Record<string, unknown>[]>([]);
  const [mappings, setMappings] = useState<Record<string, string>>({});
  const [result, setResult] = useState<PredictionResult | null>(null);
  const [error, setError] = useState("");
  const [activeCategory, setActiveCategory] = useState<ModelCategoryId>("all");
  const [modelQuery, setModelQuery] = useState("");
  const [history, setHistory] = useState<ModelLabRunSummary[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [showEditor, setShowEditor] = useState(false);
  const [editorContent, setEditorContent] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  const modelPool = useMemo(
    () => mode === "all"
      ? modelDefs
      : modelDefs.filter((def) => mode === "operational" ? OPERATIONAL_MODEL_IDS.has(def.id) : !OPERATIONAL_MODEL_IDS.has(def.id)),
    [mode, modelDefs],
  );

  useEffect(() => {
    let cancelled = false;
    api.listCustomModels().then((custom) => {
      if (cancelled || custom.length === 0) return;
      setModelDefs((cur) => {
        const next = [...cur];
        for (const c of custom) {
          const idx = next.findIndex(m => m.id === c.id);
          if (idx >= 0) {
            const merged = { ...next[idx]!, ...c };
            merged.icon = next[idx]!.icon; // Preserve the original React component
            next[idx] = merged as any;
          } else {
            next.push(c as any);
          }
        }
        return next;
      });
      setActiveDef((cur) => {
        const matching = custom.find(c => c.id === cur.id);
        if (!matching) return cur;
        const merged = { ...cur, ...matching };
        merged.icon = cur.icon; // Preserve the original React component
        return merged as any;
      });
    }).catch(console.error);
    return () => { cancelled = true; };
  }, []);

  const refreshHistory = useCallback(async () => {
    setHistoryLoading(true);
    try {
      const runs = await api.listModelLabRuns(30);
      setHistory(runs.filter((run) => modelPool.some((def) => def.id === run.modelId)));
    } catch {
      setHistory([]);
    } finally {
      setHistoryLoading(false);
    }
  }, [modelPool]);

  useEffect(() => {
    void refreshHistory();
  }, [refreshHistory]);

  const visibleCategories = useMemo(() => {
    const q = modelQuery.trim().toLowerCase();
    return MODEL_CATEGORIES.map((category) => {
      const models = category.modelIds
        .map((id) => modelPool.find((def) => def.id === id))
        .filter((def): def is ModelDef => Boolean(def))
        .filter(() => activeCategory === "all" || category.id === activeCategory)
        .filter((def) => !q || `${def.name} ${def.description} ${def.tags.join(" ")}`.toLowerCase().includes(q));
      return { ...category, models };
    }).filter((category) => category.models.length > 0);
  }, [activeCategory, modelPool, modelQuery]);

  const onSelectModel = useCallback((def: ModelDef) => {
    setActiveDef(def);
    setCsvColumns([]);
    setCsvRows([]);
    setMappings({});
    setResult(null);
    setShowEditor(false);
    setStep("configure");
  }, []);

  const onFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = ev.target?.result as string;
      const { headers, rows } = parseCsv(text);
      if (headers.length === 0) { setError("无法解析 CSV，请确认文件格式正确"); return; }
      setCsvColumns(headers);
      setCsvRows(rows);
      setMappings(autoMap(headers, activeDef.fields));
      setError("");
    };
    reader.readAsText(file, "utf-8");
    e.target.value = "";
  }, [activeDef.fields]);

  const requiredMapped = activeDef.fields
    .filter((f) => f.required)
    .every((f) => mappings[f.key]);

  const downloadSampleCsv = useCallback(() => {
    if (!activeDef.sampleRows || activeDef.sampleRows.length === 0) return;
    const headers = activeDef.fields.map((f) => f.key);
    const escape = (v: unknown) => {
      const s = v === undefined || v === null ? "" : String(v);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const lines = [
      headers.join(","),
      ...activeDef.sampleRows.map((row) => headers.map((h) => escape(row[h])).join(",")),
    ];
    const csv = "\ufeff" + lines.join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${activeDef.id}_sample.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, [activeDef]);

  const onRun = useCallback(async () => {
    if (!requiredMapped || csvRows.length === 0) return;
    setStep("running");
    setError("");
    try {
      const res = await api.predictModel({
        modelId: activeDef.id,
        mappings,
        rows: csvRows,
        model: model || undefined,
      });
      setResult(res);
      setStep("results");
      void refreshHistory();
    } catch (err) {
      setError(String(err));
      setStep("configure");
    }
  }, [activeDef.id, csvRows, mappings, model, refreshHistory, requiredMapped]);

  const onRestoreRun = useCallback(async (runId: string) => {
    setError("");
    try {
      const run = await api.getModelLabRun(runId);
      if (!run.result) {
        setError(`该运行已失败，无法恢复结果${run.errorMessage ? `：${run.errorMessage}` : ""}`);
        return;
      }
      const def = MODELS.find((item) => item.id === run.modelId);
      if (def) setActiveDef(def);
      setResult({ ...run.result, runId: run.id });
      setStep("results");
    } catch (err) {
      setError(String(err));
    }
  }, []);

  useEffect(() => {
    if (!restoreRunId) return;
    void onRestoreRun(restoreRunId).finally(() => {
      onRestoreConsumed?.();
    });
  }, [restoreRunId, onRestoreRun, onRestoreConsumed]);

  // ──────────────────────────────── Select model ────────────────────────────────
  if (step === "select_model") {
    return (
      <div className="flex min-h-0 flex-1 bg-neutral-50/70 dark:bg-neutral-950">
        <aside className="hidden w-72 shrink-0 overflow-y-auto border-r border-neutral-200 bg-white/80 p-5 dark:border-neutral-800 dark:bg-neutral-950 lg:block">
          <div className="mb-5">
            <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-neutral-400">Model Lab</div>
            <h1 className="mt-2 text-[22px] font-semibold tracking-tight text-neutral-950 dark:text-neutral-50">{mode === "operational" ? "运营模型库" : mode === "all" ? "模型库" : "预测模型库"}</h1>
            <p className="mt-2 text-[12.5px] leading-5 text-neutral-500 dark:text-neutral-400">{mode === "operational" ? "面向运营看板、诊断分层和策略决策的模型集合。" : mode === "all" ? "预测与运营模型的统一集合，按分类筛选。" : "面向概率预测、风险识别和增长判断的模型集合。"}</p>
          </div>
          <div className="space-y-1.5">
            <button
              onClick={() => setActiveCategory("all")}
              className={cn("flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-[12.5px] transition-colors", activeCategory === "all" ? "bg-neutral-900 text-white dark:bg-neutral-100 dark:text-neutral-900" : "text-neutral-600 hover:bg-neutral-100 dark:text-neutral-400 dark:hover:bg-neutral-900")}
            >
              <span>全部模型</span>
              <span>{modelPool.length}</span>
            </button>
            {MODEL_CATEGORIES.map((category) => (
              <button
                key={category.id}
                onClick={() => setActiveCategory(category.id)}
                className={cn("w-full rounded-lg px-3 py-2 text-left transition-colors", activeCategory === category.id ? "bg-neutral-900 text-white dark:bg-neutral-100 dark:text-neutral-900" : "text-neutral-600 hover:bg-neutral-100 dark:text-neutral-400 dark:hover:bg-neutral-900")}
              >
                <div className="flex items-center justify-between text-[12.5px] font-medium">
                  <span>{category.name}</span>
                  <span>{category.modelIds.filter((id) => modelPool.some((def) => def.id === id)).length}</span>
                </div>
                <div className={cn("mt-0.5 text-[11px] leading-4", activeCategory === category.id ? "text-white/70 dark:text-neutral-600" : "text-neutral-400")}>{category.description}</div>
              </button>
            ))}
          </div>
        </aside>

        <div className="min-w-0 flex-1 overflow-y-auto p-5 lg:p-8">
          <div className="mx-auto max-w-5xl">
            <div className="mb-6 rounded-2xl border border-neutral-200 bg-white p-5 shadow-sm dark:border-neutral-800 dark:bg-neutral-900">
              <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
                <div>
                  <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-neutral-400">Business Prediction</div>
                  <h1 className="mt-2 text-[24px] font-semibold tracking-tight text-neutral-950 dark:text-neutral-50">选择一个{mode === "operational" ? "运营" : mode === "all" ? "" : "预测"}模型</h1>
                  <p className="mt-1 text-[13px] text-neutral-500 dark:text-neutral-400">{mode === "operational" ? "运营模型偏看板、诊断和规则分层；界面与预测模型保持一致。" : mode === "all" ? "预测与运营模型已合并展示，可按左侧分类筛选。" : "预测模型偏概率、风险和趋势判断；已剔除纯运营看板类模型。"}</p>
                </div>
                <div className="relative w-full md:w-72">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-400" strokeWidth={1.75} />
                  <input
                    value={modelQuery}
                    onChange={(e) => setModelQuery(e.target.value)}
                    placeholder="搜索模型 / 场景 / 标签"
                    className="w-full rounded-xl border border-neutral-200 bg-neutral-50 py-2.5 pl-9 pr-3 text-[13px] text-neutral-800 outline-none transition focus:border-neutral-400 focus:bg-white dark:border-neutral-800 dark:bg-neutral-950 dark:text-neutral-100 dark:focus:border-neutral-600"
                  />
                </div>
              </div>
            </div>

            {history.length > 0 && (
              <div className="mb-6 rounded-2xl border border-neutral-200 bg-white p-4 shadow-sm dark:border-neutral-800 dark:bg-neutral-900">
                <div className="mb-3 flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2 text-[13px] font-semibold text-neutral-800 dark:text-neutral-200">
                    <History className="h-4 w-4 text-neutral-400" strokeWidth={1.75} />
                    模型历史
                  </div>
                  <button onClick={() => void refreshHistory()} className="text-[12px] text-neutral-500 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-neutral-100">
                    {historyLoading ? "刷新中" : "刷新"}
                  </button>
                </div>
                <div className="grid grid-cols-1 gap-2 md:grid-cols-2 xl:grid-cols-3">
                  {history.slice(0, 6).map((run) => {
                    const def = MODELS.find((item) => item.id === run.modelId);
                    const isFailed = run.status === "failed";
                    return (
                      <button
                        key={run.id}
                        onClick={() => void onRestoreRun(run.id)}
                        className="rounded-xl border border-neutral-200 bg-neutral-50 p-3 text-left transition-colors hover:border-neutral-400 hover:bg-white dark:border-neutral-800 dark:bg-neutral-950 dark:hover:border-neutral-600 dark:hover:bg-neutral-900"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="truncate text-[12.5px] font-medium text-neutral-800 dark:text-neutral-200">{def?.name ?? run.modelId}</span>
                          <span className={cn(
                            "shrink-0 rounded-full px-2 py-0.5 text-[10.5px]",
                            isFailed
                              ? "bg-red-50 text-red-700 dark:bg-red-950/30 dark:text-red-300"
                              : "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-300",
                          )}>{run.status}</span>
                        </div>
                        <div className="mt-1.5 text-[11.5px] text-neutral-500 dark:text-neutral-400">
                          {formatRunTime(run.createdAt)} · {run.rowsTotal} 行 · {(run.durationMs / 1000).toFixed(1)}s
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            <div className="mb-5 flex gap-2 overflow-x-auto pb-1 lg:hidden">
              <button onClick={() => setActiveCategory("all")} className={cn("shrink-0 rounded-full px-3 py-1.5 text-[12px]", activeCategory === "all" ? "bg-neutral-900 text-white dark:bg-neutral-100 dark:text-neutral-900" : "bg-white text-neutral-600 dark:bg-neutral-900 dark:text-neutral-400")}>全部</button>
              {MODEL_CATEGORIES.map((category) => (
                <button key={category.id} onClick={() => setActiveCategory(category.id)} className={cn("shrink-0 rounded-full px-3 py-1.5 text-[12px]", activeCategory === category.id ? "bg-neutral-900 text-white dark:bg-neutral-100 dark:text-neutral-900" : "bg-white text-neutral-600 dark:bg-neutral-900 dark:text-neutral-400")}>{category.name}</button>
              ))}
            </div>

            <div className="space-y-7">
              {visibleCategories.map((category) => (
                <section key={category.id}>
                  <div className="mb-3 flex items-end justify-between gap-3 border-b border-neutral-200 pb-2 dark:border-neutral-800">
                    <div>
                      <h2 className="text-[15px] font-semibold text-neutral-900 dark:text-neutral-100">{category.name}</h2>
                      <p className="mt-0.5 text-[12px] text-neutral-500 dark:text-neutral-400">{category.description}</p>
                    </div>
                    <span className="rounded-full bg-neutral-100 px-2.5 py-1 text-[11px] text-neutral-500 dark:bg-neutral-900 dark:text-neutral-400">{category.models.length} 个模型</span>
                  </div>
                  <div className="grid grid-cols-1 gap-2.5 xl:grid-cols-2">
                    {category.models.map((def) => {
                      const Icon = def.icon;
                      return (
                        <button
                          key={def.id}
                          onClick={() => onSelectModel(def)}
                          className="group flex items-start gap-3 rounded-xl border border-neutral-200 bg-white p-4 text-left shadow-sm transition-all hover:-translate-y-0.5 hover:border-neutral-400 hover:shadow-md dark:border-neutral-800 dark:bg-neutral-900 dark:hover:border-neutral-600"
                        >
                          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-neutral-100 text-neutral-600 transition-colors group-hover:bg-neutral-900 group-hover:text-white dark:bg-neutral-800 dark:text-neutral-300 dark:group-hover:bg-neutral-100 dark:group-hover:text-neutral-900">
                            <Icon className="h-5 w-5" strokeWidth={1.75} />
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="flex items-start justify-between gap-3">
                              <div className="text-[13.5px] font-semibold text-neutral-900 dark:text-neutral-100">{def.name}</div>
                              <span className="shrink-0 rounded-full bg-neutral-100 px-2 py-0.5 text-[10.5px] text-neutral-500 dark:bg-neutral-800 dark:text-neutral-400">{def.fields.filter((f) => f.required).length} 必填</span>
                            </div>
                            <div className="mt-1 text-[12px] leading-5 text-neutral-500 dark:text-neutral-400">{def.description}</div>
                            <div className="mt-2 flex flex-wrap gap-1.5">
                              {def.tags.map((tag) => (
                                <span key={tag} className="rounded-full bg-neutral-100 px-2 py-0.5 text-[11px] text-neutral-600 dark:bg-neutral-800 dark:text-neutral-400">{tag}</span>
                              ))}
                            </div>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </section>
              ))}
              {visibleCategories.length === 0 && (
                <div className="rounded-2xl border border-dashed border-neutral-300 bg-white p-10 text-center text-[13px] text-neutral-500 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-400">没有找到匹配的模型</div>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ──────────────────────────────── Running ────────────────────────────────
  if (step === "running") {
    return (
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-4">
        <Loader2 className="h-8 w-8 animate-spin text-neutral-400" strokeWidth={1.75} />
        <p className="text-[14px] text-neutral-500 dark:text-neutral-400">
          正在分析 {csvRows.length} 条{activeDef.id === "campaign_roi" ? "活动" : "用户"}数据…
        </p>
        <p className="text-[12px] text-neutral-400 dark:text-neutral-500">预计需要 20–60 秒</p>
      </div>
    );
  }

  // ──────────────────────────────── Results ────────────────────────────────
  if (step === "results" && result) {
    const { summary, rows, rowsCapped, rowsTotal } = result;
    const sortedRows = [...rows].sort((a, b) =>
      activeDef.defaultSortAsc ? a.score - b.score : b.score - a.score,
    );
    const hasLabel = rows.some((r) => r.label);
    const hasAttrs = rows.some((r) => r.attributes?.length);

    return (
      <div className="flex min-h-0 flex-1 flex-col">
        {/* toolbar */}
        <div className="flex h-12 shrink-0 items-center gap-3 border-b border-neutral-200 px-6 dark:border-neutral-800">
          <button
            onClick={() => setStep("configure")}
            className="inline-flex items-center gap-1.5 text-[12.5px] text-neutral-500 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-neutral-100"
          >
            <ArrowLeft className="h-3.5 w-3.5" strokeWidth={2} />
            返回调整
          </button>
          <span className="text-neutral-300 dark:text-neutral-700">·</span>
          <span className="text-[12.5px] font-medium text-neutral-700 dark:text-neutral-300">{activeDef.name}</span>
          <div className="ml-auto flex items-center gap-2">
            <button
              onClick={() => void onRun()}
              className="inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[12px] text-neutral-600 hover:bg-neutral-100 dark:text-neutral-400 dark:hover:bg-neutral-800"
            >
              <RefreshCw className="h-3.5 w-3.5" strokeWidth={2} />
              重新运行
            </button>
            <button
              onClick={() => exportCsv(result)}
              className="inline-flex items-center gap-1.5 rounded-lg bg-neutral-900 px-3 py-1.5 text-[12px] font-medium text-white hover:bg-neutral-700 dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-white"
            >
              <Download className="h-3.5 w-3.5" strokeWidth={2} />
              导出 CSV
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-6">
          {/* KPI cards */}
          <div className="mb-5 grid max-w-5xl grid-cols-2 gap-3 lg:grid-cols-4">
            {summary.kpis.slice(0, 4).map((kpi, i) => {
              const cfg = VARIANT_COLORS[kpi.variant ?? "neutral"];
              return (
                <div key={i} className={cn("rounded-xl border p-4", cfg.bg, cfg.border)}>
                  <div className="text-[11px] font-medium uppercase tracking-wider text-neutral-500 dark:text-neutral-400">{kpi.label}</div>
                  <div className={cn("mt-1.5 text-[22px] font-bold leading-tight", cfg.text)}>{kpi.value}</div>
                  {kpi.sub && <div className="mt-0.5 text-[11.5px] text-neutral-500 dark:text-neutral-400">{kpi.sub}</div>}
                </div>
              );
            })}
          </div>

          {/* insights + recommendations */}
          <div className="mb-5 grid max-w-5xl grid-cols-1 gap-4 lg:grid-cols-2">
            <div className="rounded-xl border border-neutral-200 bg-white p-5 dark:border-neutral-800 dark:bg-neutral-900">
              <div className="mb-3 text-[13px] font-semibold text-neutral-800 dark:text-neutral-200">关键洞察</div>
              <ul className="space-y-2">
                {summary.keyInsights.map((insight, i) => (
                  <li key={i} className="flex gap-2 text-[12.5px] leading-5 text-neutral-700 dark:text-neutral-300">
                    <CircleCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-500" strokeWidth={2} />
                    {insight}
                  </li>
                ))}
              </ul>
            </div>
            <div className="rounded-xl border border-neutral-200 bg-white p-5 dark:border-neutral-800 dark:bg-neutral-900">
              <div className="mb-3 text-[13px] font-semibold text-neutral-800 dark:text-neutral-200">运营建议</div>
              <ul className="space-y-2">
                {summary.recommendations.map((rec, i) => (
                  <li key={i} className="flex gap-2 text-[12.5px] leading-5 text-neutral-700 dark:text-neutral-300">
                    <TrendingUp className="mt-0.5 h-3.5 w-3.5 shrink-0 text-blue-500" strokeWidth={2} />
                    {rec}
                  </li>
                ))}
              </ul>
            </div>
          </div>

          {/* row table */}
          <div className="max-w-5xl">
            <div className="mb-2 flex items-baseline gap-2">
              <span className="text-[13px] font-semibold text-neutral-800 dark:text-neutral-200">明细预测结果</span>
              <span className="text-[12px] text-neutral-500 dark:text-neutral-400">
                {rowsTotal ?? rows.length} 条
                {rowsCapped ? `（前 ${rows.length} 条）` : ""}
                · 按评分{activeDef.defaultSortAsc ? "升序" : "降序"}
              </span>
            </div>
            <div className="overflow-hidden rounded-xl border border-neutral-200 dark:border-neutral-800">
              <table className="w-full text-[12.5px]">
                <thead>
                  <tr className="border-b border-neutral-200 bg-neutral-50 dark:border-neutral-800 dark:bg-neutral-900/60">
                    <th className="px-4 py-2.5 text-left font-medium text-neutral-500 dark:text-neutral-400">ID</th>
                    {hasLabel && <th className="px-4 py-2.5 text-left font-medium text-neutral-500 dark:text-neutral-400">名称</th>}
                    <th className="px-4 py-2.5 text-left font-medium text-neutral-500 dark:text-neutral-400">评分</th>
                    <th className="px-4 py-2.5 text-left font-medium text-neutral-500 dark:text-neutral-400">等级</th>
                    <th className="px-4 py-2.5 text-left font-medium text-neutral-500 dark:text-neutral-400">核心结论</th>
                    {hasAttrs && <th className="px-4 py-2.5 text-left font-medium text-neutral-500 dark:text-neutral-400">关键指标</th>}
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-100 bg-white dark:divide-neutral-800 dark:bg-neutral-950">
                  {sortedRows.map((row, i) => {
                    const tc = row.tierColor as PredictionTierColor ?? "neutral";
                    return (
                      <tr key={i} className="hover:bg-neutral-50 dark:hover:bg-neutral-900/60">
                        <td className="px-4 py-2.5 font-mono text-[12px] text-neutral-600 dark:text-neutral-400">{row.id}</td>
                        {hasLabel && <td className="px-4 py-2.5 text-neutral-700 dark:text-neutral-300">{row.label ?? ""}</td>}
                        <td className="px-4 py-2.5">
                          <div className="flex items-center gap-2">
                            <div className="h-1.5 w-14 overflow-hidden rounded-full bg-neutral-100 dark:bg-neutral-800">
                              <div className={cn("h-full rounded-full", SCORE_BAR_COLOR[tc])} style={{ width: `${Math.min(1, Math.max(0, row.score)) * 100}%` }} />
                            </div>
                            <span className="tabular-nums text-neutral-600 dark:text-neutral-400">{(row.score * 100).toFixed(0)}%</span>
                          </div>
                        </td>
                        <td className="px-4 py-2.5"><TierBadge tierLabel={row.tierLabel} tierColor={tc} /></td>
                        <td className="px-4 py-2.5 text-neutral-600 dark:text-neutral-400">{row.primaryConclusion}</td>
                        {hasAttrs && (
                          <td className="px-4 py-2.5">
                            {row.attributes?.slice(0, 3).map((a, j) => (
                              <span key={j} className="mr-2 inline-flex gap-1 text-[11.5px]">
                                <span className="text-neutral-400 dark:text-neutral-500">{a.key}</span>
                                <span className="font-medium text-neutral-700 dark:text-neutral-300">{a.value}</span>
                              </span>
                            ))}
                          </td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ──────────────────────────────── Configure ────────────────────────────────
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex h-12 shrink-0 items-center gap-3 border-b border-neutral-200 px-6 dark:border-neutral-800">
        <button
          onClick={() => setStep("select_model")}
          className="inline-flex items-center gap-1.5 text-[12.5px] text-neutral-500 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-neutral-100"
        >
          <ArrowLeft className="h-3.5 w-3.5" strokeWidth={2} />
          模型库
        </button>
        <span className="text-neutral-300 dark:text-neutral-700">·</span>
        <span className="text-[12.5px] font-medium text-neutral-700 dark:text-neutral-300">{activeDef.name}</span>
        <div className="flex-1" />
        <button
          onClick={() => {
            if (!showEditor) setEditorContent(JSON.stringify(activeDef, null, 2));
            setShowEditor(!showEditor);
          }}
          className="text-xs font-medium text-blue-600 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300"
        >
          {showEditor ? "取消编辑" : "可视化配置"}
        </button>
        {showEditor && (
          <button
            onClick={async () => {
              try {
                const parsed = JSON.parse(editorContent);
                await api.saveCustomModel(activeDef.id, parsed);
                
                const merged = { ...activeDef, ...parsed };
                merged.icon = activeDef.icon; // preserve React component
                
                setActiveDef(merged as any);
                setModelDefs(cur => {
                  const next = [...cur];
                  const idx = next.findIndex(m => m.id === parsed.id);
                  if (idx >= 0) next[idx] = merged as any;
                  else next.push(merged as any);
                  return next;
                });
                setShowEditor(false);
              } catch (err) {
                alert("保存失败: " + String(err));
              }
            }}
            className="ml-2 rounded-md bg-blue-600 px-3 py-1 text-xs text-white hover:bg-blue-700"
          >
            保存并生效
          </button>
        )}
      </div>

      <div className="flex-1 overflow-y-auto p-6">
        <div className="max-w-3xl space-y-6">
        {showEditor && (
          <div className="w-full">
            <ModelBuilder
              value={JSON.parse(editorContent || "{}")}
              onChange={(obj) => setEditorContent(JSON.stringify(obj, null, 2))}
            />
          </div>
        )}
          {/* model info card */}
          <ModelInfoCard
            name={activeDef.name}
            description={activeDef.description}
            problem={activeDef.problem}
            fields={activeDef.fields}
            output={activeDef.output}
            sampleRows={activeDef.sampleRows}
            onDownloadSample={activeDef.sampleRows && activeDef.sampleRows.length > 0 ? downloadSampleCsv : undefined}
          />

          {/* upload */}
          <div>
            <div className="mb-2 text-[13px] font-semibold text-neutral-800 dark:text-neutral-200">上传数据</div>
            <div
              onClick={() => fileInputRef.current?.click()}
              className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-neutral-300 bg-neutral-50 p-8 transition-colors hover:border-neutral-400 hover:bg-neutral-100 dark:border-neutral-700 dark:bg-neutral-900 dark:hover:border-neutral-600 dark:hover:bg-neutral-800"
            >
              <Upload className="h-8 w-8 text-neutral-400" strokeWidth={1.5} />
              {csvColumns.length === 0 ? (
                <>
                  <div className="text-[13px] font-medium text-neutral-700 dark:text-neutral-300">点击上传 CSV 文件</div>
                  <div className="text-[12px] text-neutral-500">UTF-8 编码，逗号分隔，首行为列名</div>
                </>
              ) : (
                <>
                  <div className="text-[13px] font-medium text-emerald-700 dark:text-emerald-400">已加载 {csvRows.length} 行 · {csvColumns.length} 列</div>
                  <div className="text-[12px] text-neutral-500 dark:text-neutral-400">
                    列：{csvColumns.slice(0, 6).join("、")}{csvColumns.length > 6 ? ` 等 ${csvColumns.length} 列` : ""}
                  </div>
                  <div className="text-[11.5px] text-neutral-400 dark:text-neutral-500">点击重新上传</div>
                </>
              )}
            </div>
            <input ref={fileInputRef} type="file" accept=".csv,text/csv" onChange={onFileChange} className="hidden" />
          </div>

          {/* field mapping */}
          {csvColumns.length > 0 && (
            <div>
              <div className="mb-1 text-[13px] font-semibold text-neutral-800 dark:text-neutral-200">字段映射</div>
              <p className="mb-3 text-[12px] text-neutral-500 dark:text-neutral-400">已根据列名自动匹配，<span className="text-red-500">*</span> 为必填字段</p>
              <div className="overflow-hidden rounded-xl border border-neutral-200 dark:border-neutral-800">
                <table className="w-full text-[12.5px]">
                  <thead>
                    <tr className="border-b border-neutral-200 bg-neutral-50 dark:border-neutral-800 dark:bg-neutral-900/60">
                      <th className="px-4 py-2.5 text-left font-medium text-neutral-500 dark:text-neutral-400">模型字段</th>
                      <th className="px-4 py-2.5 text-left font-medium text-neutral-500 dark:text-neutral-400">说明</th>
                      <th className="px-4 py-2.5 text-left font-medium text-neutral-500 dark:text-neutral-400">CSV 列</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-neutral-100 bg-white dark:divide-neutral-800 dark:bg-neutral-950">
                    {activeDef.fields.map((field) => {
                      const mapped = mappings[field.key] ?? "";
                      const missing = field.required && !mapped;
                      return (
                        <tr key={field.key} className={cn(missing && "bg-red-50/40 dark:bg-red-950/10")}>
                          <td className="px-4 py-2.5">
                            <div className="font-medium text-neutral-800 dark:text-neutral-200">{field.label}</div>
                            <div className="mt-0.5 font-mono text-[11px] text-neutral-400">
                              {field.key}{field.required && <span className="ml-1 text-red-500">*</span>}
                            </div>
                          </td>
                          <td className="px-4 py-2.5 text-neutral-500 dark:text-neutral-400">{field.description}</td>
                          <td className="px-4 py-2.5">
                            <div className="relative">
                              <select
                                value={mapped}
                                onChange={(e) => setMappings((m) => ({ ...m, [field.key]: e.target.value }))}
                                className={cn(
                                  "w-full appearance-none rounded-md border py-1.5 pl-3 pr-7 text-[12.5px] outline-none focus:ring-1",
                                  missing
                                    ? "border-red-300 bg-red-50 text-red-700 focus:border-red-400 focus:ring-red-300 dark:border-red-800 dark:bg-red-950/20 dark:text-red-400"
                                    : mapped
                                      ? "border-emerald-300 bg-emerald-50 text-emerald-800 focus:border-emerald-400 dark:border-emerald-800 dark:bg-emerald-950/20 dark:text-emerald-300"
                                      : "border-neutral-200 bg-transparent text-neutral-600 focus:border-neutral-400 dark:border-neutral-700 dark:text-neutral-400",
                                )}
                              >
                                <option value="">— 不映射 —</option>
                                {csvColumns.map((col) => (
                                  <option key={col} value={col}>{col}</option>
                                ))}
                              </select>
                              <ChevronDown className="pointer-events-none absolute right-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-neutral-400" strokeWidth={2} />
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {error && (
            <div className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-[12.5px] text-red-700 dark:border-red-800 dark:bg-red-950/20 dark:text-red-400">
              <AlertCircle className="h-4 w-4 shrink-0" strokeWidth={2} />
              {error}
            </div>
          )}

          <div className="flex items-center gap-3">
            <button
              onClick={() => void onRun()}
              disabled={csvRows.length === 0 || !requiredMapped}
              className="inline-flex items-center gap-2 rounded-lg bg-neutral-900 px-5 py-2.5 text-[13px] font-medium text-white hover:bg-neutral-700 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-white"
            >
              开始预测
            </button>
            {csvRows.length > 0 && !requiredMapped && (
              <span className="text-[12px] text-red-500">请完成所有必填字段的映射</span>
            )}
            {csvRows.length > 200 && requiredMapped && (
              <span className="text-[12px] text-amber-600 dark:text-amber-400">数据超过 200 行，将取前 200 条参与分析</span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
