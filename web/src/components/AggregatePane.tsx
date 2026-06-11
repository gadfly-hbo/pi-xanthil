import { useMemo, useState, type ChangeEvent } from "react";
import { Calculator, Check, Clipboard, Download, FileSpreadsheet, Loader2, SendHorizonal, ShieldCheck } from "lucide-react";
import { buildPythonPrompt, profileDataset, readLocalDataset, runAggregation, toCsv, type AggregateDsl, type AggregateOperation, type DateGranularity, type LocalDataset } from "@/lib/aggregate";
import { Markdown } from "@/components/Markdown";
import { api } from "@/lib/api";
import { useResumableTask } from "@/lib/resumableTask";
import type { PiModel } from "@/types";

const OPERATIONS: { id: AggregateOperation; label: string }[] = [
  { id: "sum", label: "sum" },
  { id: "avg", label: "avg" },
  { id: "min", label: "min" },
  { id: "max", label: "max" },
];

function downloadCsv(rows: Record<string, string | number>[]): void {
  const blob = new Blob([`﻿${toCsv(rows)}`], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `aggregate-${new Date().toISOString().slice(0, 10)}.csv`;
  anchor.click();
  URL.revokeObjectURL(url);
}

interface Props {
  model?: string;
  models?: PiModel[];
}

export function AggregatePane({ model, models }: Props) {
  const [dataset, setDataset] = useState<LocalDataset | null>(null);
  const [fileName, setFileName] = useState("");
  const [error, setError] = useState("");
  const [mode, setMode] = useState<"dsl" | "python" | "profile">("dsl");
  const [groupBy, setGroupBy] = useState<string[]>([]);
  const [dateColumn, setDateColumn] = useState("");
  const [granularity, setGranularity] = useState<DateGranularity>("month");
  const [metrics, setMetrics] = useState<string[]>(["count:"]);
  const [minGroupSize, setMinGroupSize] = useState(5);
  const [requirement, setRequirement] = useState("");
  const [copied, setCopied] = useState(false);

  // LLM send flow
  const [sendModel, setSendModel] = useState(model ?? "");
  const [question, setQuestion] = useState("");
  const llmTask = useResumableTask<{ text: string }>("agg-llm:" + fileName + ":" + groupBy.join(","));
  const sending = llmTask.status === "running";
  const sendError = llmTask.error ?? "";
  const llmResponse = llmTask.data?.text ?? "";

  const numericColumns = dataset?.columns.filter((column) => column.type === "number") ?? [];
  const dateColumns = dataset?.columns.filter((column) => column.type === "date") ?? [];
  const dsl = useMemo<AggregateDsl>(() => ({
    groupBy,
    dateColumn: dateColumn || null,
    dateGranularity: granularity,
    metrics: metrics.map((metric) => {
      const [operation, column] = metric.split(":");
      return { operation: operation as AggregateOperation, column: column || null };
    }),
    minGroupSize,
  }), [dateColumn, granularity, groupBy, metrics, minGroupSize]);
  const result = useMemo(() => {
    if (!dataset || mode !== "dsl") return null;
    try {
      return runAggregation(dataset.rows, dsl);
    } catch {
      return null;
    }
  }, [dataset, dsl, mode]);
  const profile = useMemo(() => {
    if (!dataset || mode !== "profile") return null;
    return profileDataset(dataset);
  }, [dataset, mode]);

  const prompt = useMemo(() => buildPythonPrompt(dataset?.columns ?? [], requirement, minGroupSize), [dataset, requirement, minGroupSize]);

  const onFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setError("");
    try {
      setDataset(await readLocalDataset(file));
      setFileName(file.name);
      setGroupBy([]);
      setDateColumn("");
      setMetrics(["count:"]);
    } catch (err) {
      setDataset(null);
      setError(String(err));
    } finally {
      event.target.value = "";
    }
  };

  const toggle = (items: string[], item: string, setter: (items: string[]) => void) => {
    setter(items.includes(item) ? items.filter((value) => value !== item) : [...items, item]);
  };

  const sendToLlm = async () => {
    if (!result?.rows.length || sending) return;
    const csvText = toCsv(result.rows);
    const text = [
      question.trim() || "请基于以下聚合数据给出分析洞察。",
      "",
      `数据说明：来自 ${fileName}，按 ${groupBy.join("、") || "无分组"} 汇总，最小分组阈值 ${minGroupSize}，共 ${result.rows.length} 行（已过滤 ${result.filteredGroupCount} 个低于阈值的分组）。`,
      "",
      "```csv",
      csvText,
      "```",
    ].join("\n");
    await llmTask.start(async () => {
      const res = await api.directLlmPrompt({ text, model: sendModel || undefined });
      return { text: res.text };
    });
  };

  return (
    <div className="flex min-h-0 flex-1 overflow-auto bg-neutral-50/60 p-5 dark:bg-neutral-950">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="flex items-center gap-2 text-base font-semibold text-neutral-900 dark:text-neutral-100">
              <Calculator className="h-4 w-4" /> 聚合计算
            </h1>
            <p className="mt-1 text-[12.5px] text-neutral-500">明细仅在浏览器本地解析。默认使用 DSL 本地计算，不上传原始文件。</p>
          </div>
          <label className="inline-flex cursor-pointer items-center gap-2 rounded-md bg-neutral-900 px-3 py-2 text-[12px] font-medium text-white hover:bg-neutral-700 dark:bg-neutral-100 dark:text-neutral-900">
            <FileSpreadsheet className="h-3.5 w-3.5" /> 选择 CSV / Excel
            <input className="hidden" type="file" accept=".csv,.xlsx,.xls" onChange={(event) => void onFile(event)} />
          </label>
        </div>

        <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-[12px] text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-300">
          <div className="flex items-center gap-2 font-medium"><ShieldCheck className="h-4 w-4" /> 本地隐私边界</div>
          <p className="mt-1">原始文件与明细行不会发送到 BFF 或 LLM。字段名也可能敏感，使用 Python 高级模式前请先检查并脱敏。</p>
        </div>

        {error && <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-[12px] text-red-600">{error}</p>}
        {!dataset ? (
          <div className="flex min-h-72 items-center justify-center rounded-lg border border-dashed border-neutral-300 bg-white text-[13px] text-neutral-400 dark:border-neutral-800 dark:bg-neutral-900/40">
            请选择一个本地 CSV、XLSX 或 XLS 文件
          </div>
        ) : (
          <>
            <div className="rounded-lg border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
              <div className="flex items-center justify-between">
                <h2 className="text-[13px] font-semibold">{fileName}</h2>
                <span className="text-[11px] text-neutral-500">{dataset.sheetName} · 本地读取 {dataset.rows.length.toLocaleString()} 行 · {dataset.columns.length} 列</span>
              </div>
              <div className="mt-3 overflow-auto">
                <table className="w-full text-left text-[12px]">
                  <thead className="text-neutral-500"><tr><th className="py-1">字段</th><th>类型</th><th>空值数</th></tr></thead>
                  <tbody>{dataset.columns.map((column) => <tr key={column.name} className="border-t border-neutral-100 dark:border-neutral-800"><td className="py-1.5 font-mono">{column.name}</td><td>{column.type}</td><td>{column.nullCount}</td></tr>)}</tbody>
                </table>
              </div>
            </div>

            <div className="flex gap-1 rounded-lg border border-neutral-200 bg-white p-1 dark:border-neutral-800 dark:bg-neutral-900">
              <button onClick={() => setMode("profile")} className={`rounded-md px-3 py-1.5 text-[12px] ${mode === "profile" ? "bg-neutral-900 text-white dark:bg-neutral-100 dark:text-neutral-900" : "text-neutral-500"}`}>数据探查</button>
              <button onClick={() => setMode("dsl")} className={`rounded-md px-3 py-1.5 text-[12px] ${mode === "dsl" ? "bg-neutral-900 text-white dark:bg-neutral-100 dark:text-neutral-900" : "text-neutral-500"}`}>DSL 本地计算</button>
              <button onClick={() => setMode("python")} className={`rounded-md px-3 py-1.5 text-[12px] ${mode === "python" ? "bg-neutral-900 text-white dark:bg-neutral-100 dark:text-neutral-900" : "text-neutral-500"}`}>Python 高级模式</button>
            </div>

            {mode === "profile" && profile ? (
              <div className="space-y-4">
                <div className="grid gap-3 rounded-lg border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
                  <h3 className="text-[13px] font-semibold">数据质量概览</h3>
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                    {[
                      { label: "总行数", value: profile.rowCount.toLocaleString() },
                      { label: "总列数", value: profile.columnCount },
                      { label: "重复行", value: profile.duplicateRows, warn: profile.duplicateRows > 0 },
                      { label: "缺失率", value: `${(profile.missingRate * 100).toFixed(1)}%`, warn: profile.missingRate > 0.1 },
                    ].map((item) => (
                      <div key={item.label} className="rounded border border-neutral-100 p-2.5 dark:border-neutral-800">
                        <p className="text-[11px] text-neutral-400">{item.label}</p>
                        <p className={`mt-0.5 text-[15px] font-semibold ${item.warn ? "text-amber-600" : "text-neutral-900 dark:text-neutral-100"}`}>{item.value}</p>
                      </div>
                    ))}
                  </div>
                  {profile.primaryKeyCandidates.length > 0 && (
                    <p className="text-[11px] text-neutral-500">
                      主键候选字段：{profile.primaryKeyCandidates.map((c) => <code key={c} className="rounded bg-neutral-100 px-1 font-mono dark:bg-neutral-800">{c}</code>).reduce((prev, curr) => <>{prev}, {curr}</>)}
                    </p>
                  )}
                </div>

                <div className="rounded-lg border border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900">
                  <div className="overflow-auto">
                    <table className="w-full text-left text-[12px]">
                      <thead className="border-b border-neutral-200 text-neutral-500 dark:border-neutral-800">
                        <tr>
                          <th className="px-3 py-2 font-medium">字段</th>
                          <th className="px-3 py-2 font-medium">类型</th>
                          <th className="px-3 py-2 font-medium">空值率</th>
                          <th className="px-3 py-2 font-medium">唯一值</th>
                          <th className="px-3 py-2 font-medium">基数</th>
                          <th className="px-3 py-2 font-medium">数值范围 / Top 值</th>
                        </tr>
                      </thead>
                      <tbody>
                        {profile.columns.map((col) => (
                          <tr key={col.name} className="border-b border-neutral-100 dark:border-neutral-800">
                            <td className="px-3 py-2 font-mono font-medium">{col.name}</td>
                            <td className="px-3 py-2">{col.type}</td>
                            <td className="px-3 py-2">
                              <span className={col.nullRate > 0.1 ? "text-amber-600" : ""}>{(col.nullRate * 100).toFixed(1)}%</span>
                              {col.nullCount > 0 && <span className="ml-1 text-neutral-400">({col.nullCount})</span>}
                            </td>
                            <td className="px-3 py-2">{col.uniqueCount.toLocaleString()}</td>
                            <td className="px-3 py-2">
                              <span className={col.cardinality === "high" ? "text-blue-600" : col.cardinality === "low" ? "text-emerald-600" : "text-amber-600"}>
                                {col.cardinality === "high" ? "高" : col.cardinality === "medium" ? "中" : "低"}
                              </span>
                            </td>
                            <td className="px-3 py-2">
                              {col.type === "number" && col.min !== undefined ? (
                                <span className="font-mono text-[11px]">
                                  {col.min.toLocaleString()} ~ {col.max?.toLocaleString()}
                                  {col.mean !== undefined && <span className="ml-1 text-neutral-400">μ={col.mean.toFixed(1)}</span>}
                                </span>
                              ) : col.type === "date" && col.minDate ? (
                                <span className="font-mono text-[11px]">{col.minDate} ~ {col.maxDate}</span>
                              ) : col.topValues.length > 0 ? (
                                <span className="text-[11px]">
                                  {col.topValues.slice(0, 3).map((tv) => (
                                    <span key={tv.value} className="mr-1.5 rounded bg-neutral-100 px-1 py-0.5 dark:bg-neutral-800">
                                      {tv.value.length > 20 ? tv.value.slice(0, 20) + "…" : tv.value}
                                      <span className="ml-0.5 text-neutral-400">({tv.count})</span>
                                    </span>
                                  ))}
                                </span>
                              ) : (
                                <span className="text-neutral-400">—</span>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            ) : mode === "dsl" ? (
              <>
                <div className="grid gap-4 lg:grid-cols-[22rem_minmax(0,1fr)]">
                  <div className="space-y-4 rounded-lg border border-neutral-200 bg-white p-4 text-[12px] dark:border-neutral-800 dark:bg-neutral-900">
                    <div><h3 className="font-semibold">分组字段</h3><div className="mt-2 flex flex-wrap gap-1.5">{dataset.columns.map((column) => <button key={column.name} onClick={() => toggle(groupBy, column.name, setGroupBy)} className={`rounded border px-2 py-1 font-mono ${groupBy.includes(column.name) ? "border-neutral-900 bg-neutral-900 text-white dark:border-neutral-100 dark:bg-neutral-100 dark:text-neutral-900" : "border-neutral-200 dark:border-neutral-700"}`}>{column.name}</button>)}</div></div>
                    <div><h3 className="font-semibold">日期粒度</h3><div className="mt-2 flex gap-2"><select className="min-w-0 flex-1 rounded border border-neutral-200 bg-transparent px-2 py-1.5 dark:border-neutral-700" value={dateColumn} onChange={(event) => setDateColumn(event.target.value)}><option value="">不按日期分组</option>{dateColumns.map((column) => <option key={column.name}>{column.name}</option>)}</select><select className="rounded border border-neutral-200 bg-transparent px-2 dark:border-neutral-700" value={granularity} onChange={(event) => setGranularity(event.target.value as DateGranularity)}><option value="day">day</option><option value="month">month</option><option value="year">year</option></select></div></div>
                    <div><h3 className="font-semibold">聚合指标</h3><div className="mt-2 flex flex-wrap gap-1.5"><button onClick={() => toggle(metrics, "count:", setMetrics)} className={`rounded border px-2 py-1 ${metrics.includes("count:") ? "border-neutral-900 bg-neutral-900 text-white dark:border-neutral-100 dark:bg-neutral-100 dark:text-neutral-900" : "border-neutral-200 dark:border-neutral-700"}`}>count rows</button>{numericColumns.flatMap((column) => OPERATIONS.map((operation) => { const id = `${operation.id}:${column.name}`; return <button key={id} onClick={() => toggle(metrics, id, setMetrics)} className={`rounded border px-2 py-1 font-mono ${metrics.includes(id) ? "border-neutral-900 bg-neutral-900 text-white dark:border-neutral-100 dark:bg-neutral-100 dark:text-neutral-900" : "border-neutral-200 dark:border-neutral-700"}`}>{operation.label}({column.name})</button>; }))}</div></div>
                    <label className="block"><span className="font-semibold">最小分组阈值</span><input className="mt-2 w-full rounded border border-neutral-200 bg-transparent px-2 py-1.5 dark:border-neutral-700" type="number" min={1} value={minGroupSize} onChange={(event) => setMinGroupSize(Math.max(1, Number(event.target.value) || 1))} /><span className="mt-1 block text-[11px] text-neutral-500">默认过滤 count &lt; 5 的分组，降低聚合结果反推明细的风险。</span></label>
                  </div>
                  <div className="min-w-0 rounded-lg border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
                    <div className="flex items-center justify-between gap-3"><h3 className="text-[13px] font-semibold">聚合结果预览</h3><button disabled={!result?.rows.length} onClick={() => result && downloadCsv(result.rows)} className="inline-flex items-center gap-1.5 rounded border border-neutral-200 px-2.5 py-1.5 text-[12px] disabled:opacity-40 dark:border-neutral-700"><Download className="h-3.5 w-3.5" /> 导出汇总 CSV</button></div>
                    <p className="mt-1 text-[11px] text-neutral-500">结果仍只在本地。发送给 LLM 前请人工确认。已过滤 {result?.filteredGroupCount ?? 0} 个低于阈值的分组。</p>
                    <div className="mt-3 max-h-[32rem] overflow-auto">{result?.rows.length ? <table className="w-full whitespace-nowrap text-left text-[12px]"><thead className="sticky top-0 bg-white text-neutral-500 dark:bg-neutral-900"><tr>{Object.keys(result.rows[0]!).map((header) => <th key={header} className="border-b border-neutral-200 px-2 py-1.5 font-mono dark:border-neutral-700">{header}</th>)}</tr></thead><tbody>{result.rows.slice(0, 200).map((row, index) => <tr key={index} className="border-b border-neutral-100 dark:border-neutral-800">{Object.keys(result.rows[0]!).map((header) => <td key={header} className="px-2 py-1.5">{typeof row[header] === "number" ? Number(row[header]).toLocaleString(undefined, { maximumFractionDigits: 4 }) : row[header]}</td>)}</tr>)}</tbody></table> : <p className="py-16 text-center text-[12px] text-neutral-400">当前规则没有可展示的分组结果</p>}</div>
                  </div>
                </div>

                {result && result.rows.length > 0 && (
                  <div className="rounded-lg border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
                    <h3 className="text-[13px] font-semibold">发送给 LLM 分析</h3>
                    <p className="mt-1 text-[11px] text-neutral-500">
                      将发送：{result.rows.length} 行聚合结果（{Object.keys(result.rows[0] ?? {}).length} 列）· 已过滤 {result.filteredGroupCount} 个低于阈值分组 · 不含原始明细。
                    </p>
                    <details className="mt-3">
                      <summary className="cursor-pointer text-[12px] text-neutral-500 hover:text-neutral-700 dark:hover:text-neutral-300">预览将发送的数据</summary>
                      <pre className="mt-2 max-h-48 overflow-auto rounded bg-neutral-50 p-3 text-[11px] leading-5 dark:bg-neutral-950">{toCsv(result.rows)}</pre>
                    </details>
                    <div className="mt-3 space-y-2">
                      <textarea value={question} onChange={(event) => setQuestion(event.target.value)} placeholder="描述你的分析需求，例如：哪些分组表现异常？整体趋势如何？" className="h-16 w-full resize-y rounded border border-neutral-200 bg-transparent p-2 text-[12px] outline-none focus:border-neutral-400 dark:border-neutral-700" />
                      <div className="flex items-center gap-2">
                        {models && models.length > 0 && (
                          <select value={sendModel} onChange={(event) => setSendModel(event.target.value)} className="rounded border border-neutral-200 bg-transparent px-2 py-1.5 text-[12px] dark:border-neutral-700">
                            {models.map((m) => <option key={m.id} value={m.id}>{m.id}</option>)}
                          </select>
                        )}
                        <button disabled={sending} onClick={() => void sendToLlm()} className="inline-flex items-center gap-1.5 rounded-md bg-neutral-900 px-3 py-2 text-[12px] font-medium text-white disabled:opacity-50 dark:bg-neutral-100 dark:text-neutral-900">
                          {sending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <SendHorizonal className="h-3.5 w-3.5" />}
                          {sending ? "正在分析…" : "确认发送"}
                        </button>
                      </div>
                    </div>
                    {sendError && <p className="mt-3 rounded border border-red-200 bg-red-50 px-3 py-2 text-[12px] text-red-600 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300">{sendError}</p>}
                    {llmResponse && (
                      <div className="mt-4 border-t border-neutral-100 pt-4 dark:border-neutral-800">
                        <p className="mb-2 text-[11px] font-medium text-neutral-500">LLM 分析结果</p>
                        <Markdown>{llmResponse}</Markdown>
                        <button onClick={() => void navigator.clipboard.writeText(llmResponse).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); })} className="mt-3 inline-flex items-center gap-1.5 rounded border border-neutral-200 px-2.5 py-1.5 text-[12px] dark:border-neutral-700">
                          {copied ? <Check className="h-3.5 w-3.5" /> : <Clipboard className="h-3.5 w-3.5" />}
                          {copied ? "已复制" : "复制结果"}
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </>
            ) : (
              <div className="rounded-lg border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
                <h3 className="text-[13px] font-semibold">Python 代码生成 prompt</h3>
                <p className="mt-1 text-[11px] text-neutral-500">此模式只生成待发送内容，不调用现有 pi，也不在应用内执行任意 Python。</p>
                <textarea value={requirement} onChange={(event) => setRequirement(event.target.value)} placeholder="描述聚合需求，例如：按门店汇总销售额与销量，按月份统计趋势。" className="mt-3 h-20 w-full resize-y rounded border border-neutral-200 bg-transparent p-2 text-[12px] outline-none dark:border-neutral-700" />
                <div className="mt-3 flex items-center justify-between"><span className="text-[11px] font-medium text-neutral-500">发送前预览：仅 schema、阈值和需求</span><button onClick={() => void navigator.clipboard.writeText(prompt).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); })} className="inline-flex items-center gap-1.5 rounded border border-neutral-200 px-2.5 py-1.5 text-[12px] dark:border-neutral-700">{copied ? <Check className="h-3.5 w-3.5" /> : <Clipboard className="h-3.5 w-3.5" />}{copied ? "已复制" : "复制 prompt"}</button></div>
                <pre className="mt-2 max-h-[28rem] overflow-auto whitespace-pre-wrap rounded-md bg-neutral-50 p-3 text-[12px] leading-5 text-neutral-700 dark:bg-neutral-950 dark:text-neutral-300">{prompt}</pre>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
