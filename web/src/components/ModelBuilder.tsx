import { Plus, Trash2 } from "lucide-react";
import type { ModelDef, ModelOutputSpec } from "@/data/models";

interface Props {
  value: any; // Using any to be safe since it's parsed JSON
  onChange: (value: any) => void;
}

export function ModelBuilder({ value, onChange }: Props) {
  const update = (patch: Partial<ModelDef>) => {
    onChange({ ...value, ...patch });
  };

  const updateOutput = (patch: Partial<ModelOutputSpec>) => {
    onChange({ ...value, output: { ...value.output, ...patch } });
  };

  return (
    <div className="flex flex-col gap-6 rounded-xl border border-neutral-200 bg-white p-6 shadow-sm dark:border-neutral-800 dark:bg-neutral-900">
      <div className="text-lg font-semibold text-neutral-800 dark:text-neutral-200">可视化模型构建器</div>
      
      {/* 基础信息 */}
      <div className="space-y-4">
        <div className="text-sm font-semibold text-neutral-700 dark:text-neutral-300">1. 基础信息</div>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <label className="block text-xs font-medium text-neutral-500">
            模型名称
            <input
              type="text"
              value={value.name || ""}
              onChange={(e) => update({ name: e.target.value })}
              className="mt-1 block w-full rounded-md border border-neutral-300 px-3 py-2 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100"
            />
          </label>
          <label className="block text-xs font-medium text-neutral-500">
            业务解决的问题 (Problem)
            <input
              type="text"
              value={value.problem || ""}
              onChange={(e) => update({ problem: e.target.value })}
              className="mt-1 block w-full rounded-md border border-neutral-300 px-3 py-2 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100"
            />
          </label>
          <label className="col-span-1 block text-xs font-medium text-neutral-500 md:col-span-2">
            模型描述
            <textarea
              value={value.description || ""}
              onChange={(e) => update({ description: e.target.value })}
              rows={2}
              className="mt-1 block w-full rounded-md border border-neutral-300 px-3 py-2 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100"
            />
          </label>
        </div>
      </div>

      <div className="h-px bg-neutral-200 dark:bg-neutral-800" />

      {/* 输入字段 */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div className="text-sm font-semibold text-neutral-700 dark:text-neutral-300">2. 输入特征 (Fields)</div>
          <button
            onClick={() => {
              const fields = value.fields ? [...value.fields] : [];
              fields.push({ key: "new_field", label: "新字段", type: "string", required: false, description: "" });
              update({ fields });
            }}
            className="inline-flex items-center gap-1 rounded bg-neutral-100 px-2 py-1 text-xs font-medium text-neutral-600 hover:bg-neutral-200 dark:bg-neutral-800 dark:text-neutral-300"
          >
            <Plus className="h-3.5 w-3.5" /> 添加字段
          </button>
        </div>
        <div className="space-y-3">
          {(value.fields || []).map((f: any, i: number) => (
            <div key={i} className="flex flex-wrap items-end gap-3 rounded-lg border border-neutral-200 p-3 dark:border-neutral-800">
              <label className="flex-1 min-w-[120px] text-[11px] font-medium text-neutral-500">字段 Key
                <input type="text" value={f.key || ""} onChange={(e) => { const arr = [...value.fields]; arr[i].key = e.target.value; update({ fields: arr }); }} className="mt-1 block w-full rounded border border-neutral-300 px-2 py-1 text-xs dark:border-neutral-700 dark:bg-neutral-900" />
              </label>
              <label className="flex-1 min-w-[120px] text-[11px] font-medium text-neutral-500">显示名称
                <input type="text" value={f.label || ""} onChange={(e) => { const arr = [...value.fields]; arr[i].label = e.target.value; update({ fields: arr }); }} className="mt-1 block w-full rounded border border-neutral-300 px-2 py-1 text-xs dark:border-neutral-700 dark:bg-neutral-900" />
              </label>
              <label className="w-24 text-[11px] font-medium text-neutral-500">类型
                <select value={f.type || "string"} onChange={(e) => { const arr = [...value.fields]; arr[i].type = e.target.value; update({ fields: arr }); }} className="mt-1 block w-full rounded border border-neutral-300 px-2 py-1 text-xs dark:border-neutral-700 dark:bg-neutral-900">
                  <option value="string">文本</option>
                  <option value="number">数字</option>
                  <option value="boolean">布尔</option>
                </select>
              </label>
              <label className="flex w-16 flex-col items-center justify-end pb-1.5 text-[11px] font-medium text-neutral-500">
                <span className="mb-1">必填</span>
                <input type="checkbox" checked={!!f.required} onChange={(e) => { const arr = [...value.fields]; arr[i].required = e.target.checked; update({ fields: arr }); }} />
              </label>
              <label className="flex-[2] min-w-[180px] text-[11px] font-medium text-neutral-500">业务含义描述
                <input type="text" value={f.description || ""} onChange={(e) => { const arr = [...value.fields]; arr[i].description = e.target.value; update({ fields: arr }); }} className="mt-1 block w-full rounded border border-neutral-300 px-2 py-1 text-xs dark:border-neutral-700 dark:bg-neutral-900" />
              </label>
              <button onClick={() => { const arr = [...value.fields]; arr.splice(i, 1); update({ fields: arr }); }} className="mb-1 p-1 text-neutral-400 hover:text-red-500"><Trash2 className="h-4 w-4" /></button>
            </div>
          ))}
        </div>
      </div>

      <div className="h-px bg-neutral-200 dark:bg-neutral-800" />

      {/* 评级 */}
      {value.output && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="text-sm font-semibold text-neutral-700 dark:text-neutral-300">3. 评级与阈值设定 (Tiers)</div>
            <button
              onClick={() => {
                const tiers = value.output.tiers ? [...value.output.tiers] : [];
                tiers.push({ label: "新等级", color: "neutral", range: "", meaning: "" });
                updateOutput({ tiers });
              }}
              className="inline-flex items-center gap-1 rounded bg-neutral-100 px-2 py-1 text-xs font-medium text-neutral-600 hover:bg-neutral-200 dark:bg-neutral-800 dark:text-neutral-300"
            >
              <Plus className="h-3.5 w-3.5" /> 添加等级
            </button>
          </div>
          <div className="space-y-3">
            {(value.output.tiers || []).map((t: any, i: number) => (
              <div key={i} className="flex flex-wrap items-end gap-3 rounded-lg border border-neutral-200 p-3 dark:border-neutral-800">
                <label className="w-28 text-[11px] font-medium text-neutral-500">等级名称
                  <input type="text" value={t.label || ""} onChange={(e) => { const arr = [...value.output.tiers]; arr[i].label = e.target.value; updateOutput({ tiers: arr }); }} className="mt-1 block w-full rounded border border-neutral-300 px-2 py-1 text-xs dark:border-neutral-700 dark:bg-neutral-900" />
                </label>
                <label className="w-24 text-[11px] font-medium text-neutral-500">颜色
                  <select value={t.color || "neutral"} onChange={(e) => { const arr = [...value.output.tiers]; arr[i].color = e.target.value; updateOutput({ tiers: arr }); }} className="mt-1 block w-full rounded border border-neutral-300 px-2 py-1 text-xs dark:border-neutral-700 dark:bg-neutral-900">
                    <option value="red">红色 (Red)</option>
                    <option value="orange">橙色 (Orange)</option>
                    <option value="amber">琥珀 (Amber)</option>
                    <option value="green">绿色 (Green)</option>
                    <option value="blue">蓝色 (Blue)</option>
                    <option value="purple">紫色 (Purple)</option>
                    <option value="neutral">灰色 (Neutral)</option>
                  </select>
                </label>
                <label className="w-32 text-[11px] font-medium text-neutral-500">判定区间 (Range)
                  <input type="text" value={t.range || ""} onChange={(e) => { const arr = [...value.output.tiers]; arr[i].range = e.target.value; updateOutput({ tiers: arr }); }} placeholder="例如: > 0.7" className="mt-1 block w-full rounded border border-neutral-300 px-2 py-1 text-xs dark:border-neutral-700 dark:bg-neutral-900" />
                </label>
                <label className="flex-1 min-w-[200px] text-[11px] font-medium text-neutral-500">业务应对策略 / 含义
                  <input type="text" value={t.meaning || ""} onChange={(e) => { const arr = [...value.output.tiers]; arr[i].meaning = e.target.value; updateOutput({ tiers: arr }); }} className="mt-1 block w-full rounded border border-neutral-300 px-2 py-1 text-xs dark:border-neutral-700 dark:bg-neutral-900" />
                </label>
                <button onClick={() => { const arr = [...value.output.tiers]; arr.splice(i, 1); updateOutput({ tiers: arr }); }} className="mb-1 p-1 text-neutral-400 hover:text-red-500"><Trash2 className="h-4 w-4" /></button>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="h-px bg-neutral-200 dark:bg-neutral-800" />

      {/* Prompt Template */}
      <div className="space-y-4">
        <div className="text-sm font-semibold text-neutral-700 dark:text-neutral-300">4. AI 核心逻辑 (Prompt Template)</div>
        <p className="text-[12px] text-neutral-500">在这里编写传给大语言模型的自然语言指令。你可以使用变量：<code className="rounded bg-neutral-100 px-1 dark:bg-neutral-800">{"{{rowsCount}}"}</code> 代表行数，<code className="rounded bg-neutral-100 px-1 dark:bg-neutral-800">{"{{rowsJson}}"}</code> 代表数据内容。</p>
        <textarea
          value={value.promptTemplate || ""}
          onChange={(e) => update({ promptTemplate: e.target.value } as any)}
          rows={12}
          className="block w-full rounded-md border border-neutral-300 px-4 py-3 font-mono text-[13px] leading-relaxed shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-200"
          spellCheck={false}
        />
      </div>

    </div>
  );
}
