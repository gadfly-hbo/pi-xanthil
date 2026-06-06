import { useState } from "react";
import { ChevronDown, ChevronRight, Download, Info, Sparkles, Target as TargetIcon } from "lucide-react";
import { cn } from "@/lib/cn";
import type { PredictionTierColor } from "@/types";

interface ModelFieldDef {
  key: string;
  label: string;
  required: boolean;
  description: string;
  type: "string" | "number" | "boolean";
  example?: string | number | boolean;
}

interface ModelOutputSpec {
  kpis: string[];
  tiers: { label: string; color: PredictionTierColor; range: string; meaning: string }[];
  scoreMeaning: string;
}

interface Props {
  name: string;
  description: string;
  problem?: string;
  fields: ModelFieldDef[];
  output?: ModelOutputSpec;
  sampleRows?: Record<string, string | number | boolean>[];
  onDownloadSample?: () => void;
}

const TIER_DOT: Record<PredictionTierColor, string> = {
  red:     "bg-red-500",
  orange:  "bg-orange-500",
  amber:   "bg-amber-500",
  green:   "bg-emerald-500",
  blue:    "bg-blue-500",
  purple:  "bg-purple-500",
  neutral: "bg-neutral-400",
};

export default function ModelInfoCard({ name, description, problem, fields, output, sampleRows, onDownloadSample }: Props) {
  const [showFields, setShowFields] = useState(false);
  const [showSample, setShowSample] = useState(false);

  const requiredFields = fields.filter((f) => f.required);
  const optionalFields = fields.filter((f) => !f.required);

  return (
    <div className="rounded-xl border border-blue-200 bg-blue-50/40 dark:border-blue-900/40 dark:bg-blue-950/10">
      {/* Header: problem + computation method */}
      <div className="border-b border-blue-200/60 px-5 py-4 dark:border-blue-900/30">
        <div className="flex items-start gap-3">
          <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-blue-500/10 text-blue-600 dark:text-blue-400">
            <Info className="h-4 w-4" strokeWidth={2} />
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-[13px] font-semibold text-neutral-900 dark:text-neutral-100">{name} · 模型说明</div>
            <p className="mt-1 text-[12.5px] leading-5 text-neutral-700 dark:text-neutral-300">
              {problem ?? description}
            </p>
            <div className="mt-2.5 inline-flex items-center gap-1.5 rounded-md bg-white/70 px-2 py-1 text-[11.5px] text-neutral-600 dark:bg-neutral-900/40 dark:text-neutral-400">
              <Sparkles className="h-3 w-3 text-blue-500" strokeWidth={2} />
              <span>计算方式：AI 智能分析（基于大模型推断）</span>
            </div>
          </div>
        </div>
      </div>

      {/* Output spec */}
      {output && (
        <div className="border-b border-blue-200/60 px-5 py-4 dark:border-blue-900/30">
          <div className="mb-2.5 flex items-center gap-2 text-[12px] font-semibold uppercase tracking-wider text-neutral-500 dark:text-neutral-400">
            <TargetIcon className="h-3.5 w-3.5" strokeWidth={2} />
            预测输出
          </div>
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            <div>
              <div className="mb-1.5 text-[11.5px] text-neutral-500 dark:text-neutral-400">汇总 KPI（{output.kpis.length} 项）</div>
              <ul className="space-y-1">
                {output.kpis.map((k, i) => (
                  <li key={i} className="text-[12.5px] text-neutral-700 dark:text-neutral-300">· {k}</li>
                ))}
              </ul>
            </div>
            <div>
              <div className="mb-1.5 text-[11.5px] text-neutral-500 dark:text-neutral-400">
                逐行分层（score = {output.scoreMeaning}）
              </div>
              <ul className="space-y-1">
                {output.tiers.map((t, i) => (
                  <li key={i} className="flex items-baseline gap-2 text-[12.5px]">
                    <span className={cn("h-2 w-2 shrink-0 translate-y-0.5 rounded-full", TIER_DOT[t.color])} />
                    <span className="font-medium text-neutral-800 dark:text-neutral-200">{t.label}</span>
                    <span className="font-mono text-[11px] text-neutral-500">{t.range}</span>
                    <span className="text-neutral-600 dark:text-neutral-400">— {t.meaning}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      )}

      {/* Required fields summary */}
      <div className="px-5 py-3">
        <button
          onClick={() => setShowFields((v) => !v)}
          className="flex w-full items-center justify-between text-left"
        >
          <div className="flex items-center gap-2 text-[12.5px]">
            {showFields ? <ChevronDown className="h-3.5 w-3.5 text-neutral-500" /> : <ChevronRight className="h-3.5 w-3.5 text-neutral-500" />}
            <span className="font-semibold text-neutral-800 dark:text-neutral-200">输入字段</span>
            <span className="text-neutral-500 dark:text-neutral-400">
              · 必填 <span className="font-medium text-red-500">{requiredFields.length}</span> 项
              {optionalFields.length > 0 && <>，可选 {optionalFields.length} 项</>}
            </span>
          </div>
          <span className="text-[11.5px] text-neutral-400">{showFields ? "收起" : "查看详情"}</span>
        </button>
        {showFields && (
          <div className="mt-3 overflow-hidden rounded-lg border border-neutral-200 dark:border-neutral-800">
            <table className="w-full text-[12px]">
              <thead>
                <tr className="border-b border-neutral-200 bg-neutral-50 dark:border-neutral-800 dark:bg-neutral-900/60">
                  <th className="px-3 py-2 text-left font-medium text-neutral-500 dark:text-neutral-400">字段</th>
                  <th className="px-3 py-2 text-left font-medium text-neutral-500 dark:text-neutral-400">类型</th>
                  <th className="px-3 py-2 text-left font-medium text-neutral-500 dark:text-neutral-400">含义</th>
                  <th className="px-3 py-2 text-left font-medium text-neutral-500 dark:text-neutral-400">示例</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-100 bg-white dark:divide-neutral-800 dark:bg-neutral-950">
                {fields.map((f) => (
                  <tr key={f.key}>
                    <td className="px-3 py-2">
                      <div className="font-mono text-[11.5px] text-neutral-800 dark:text-neutral-200">
                        {f.key}{f.required && <span className="ml-1 text-red-500">*</span>}
                      </div>
                      <div className="text-[11px] text-neutral-500">{f.label}</div>
                    </td>
                    <td className="px-3 py-2 text-[11.5px] text-neutral-500">{f.type}</td>
                    <td className="px-3 py-2 text-neutral-600 dark:text-neutral-400">{f.description}</td>
                    <td className="px-3 py-2 font-mono text-[11.5px] text-neutral-500">
                      {f.example !== undefined ? String(f.example) : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Sample data preview + download */}
      {sampleRows && sampleRows.length > 0 && (
        <div className="border-t border-blue-200/60 px-5 py-3 dark:border-blue-900/30">
          <div className="flex items-center justify-between">
            <button
              onClick={() => setShowSample((v) => !v)}
              className="flex items-center gap-2 text-left text-[12.5px]"
            >
              {showSample ? <ChevronDown className="h-3.5 w-3.5 text-neutral-500" /> : <ChevronRight className="h-3.5 w-3.5 text-neutral-500" />}
              <span className="font-semibold text-neutral-800 dark:text-neutral-200">示例数据</span>
              <span className="text-neutral-500 dark:text-neutral-400">· {sampleRows.length} 行预览</span>
            </button>
            {onDownloadSample && (
              <button
                onClick={onDownloadSample}
                className="inline-flex items-center gap-1.5 rounded-md border border-neutral-200 bg-white px-2.5 py-1 text-[11.5px] text-neutral-700 hover:bg-neutral-50 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-300 dark:hover:bg-neutral-800"
              >
                <Download className="h-3 w-3" strokeWidth={2} />
                下载示例 CSV
              </button>
            )}
          </div>
          {showSample && (
            <div className="mt-3 overflow-x-auto rounded-lg border border-neutral-200 dark:border-neutral-800">
              <table className="w-full text-[11.5px]">
                <thead>
                  <tr className="border-b border-neutral-200 bg-neutral-50 dark:border-neutral-800 dark:bg-neutral-900/60">
                    {fields.map((f) => (
                      <th key={f.key} className="whitespace-nowrap px-3 py-2 text-left font-mono font-medium text-neutral-500 dark:text-neutral-400">
                        {f.key}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-100 bg-white dark:divide-neutral-800 dark:bg-neutral-950">
                  {sampleRows.map((row, i) => (
                    <tr key={i}>
                      {fields.map((f) => (
                        <td key={f.key} className="whitespace-nowrap px-3 py-1.5 font-mono text-neutral-700 dark:text-neutral-300">
                          {row[f.key] !== undefined ? String(row[f.key]) : ""}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
