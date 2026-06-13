import { AlertCircle, Copy } from "lucide-react";
import type { ExtractionTool } from "@/types";
import type { EditableWorkflowNode } from "./types";

interface Props {
  node: EditableWorkflowNode;
  tools: ExtractionTool[];
  loadingTools: boolean;
  running: boolean;
  selectedTool: ExtractionTool | null;
  onNodeChange: (nodeId: string, patch: Partial<EditableWorkflowNode>) => void;
  onApplyTemplate: (nodeId: string, tool: ExtractionTool) => void;
}

export function ToolNodeConfig({
  node,
  tools,
  loadingTools,
  running,
  selectedTool,
  onNodeChange,
  onApplyTemplate,
}: Props) {
  return (
    <div className="grid gap-2 rounded-md border border-emerald-100 bg-emerald-50/40 p-2 dark:border-emerald-900/40 dark:bg-emerald-950/20 md:grid-cols-2">
      <label className="flex flex-col gap-1">
        <span className="text-[10px] font-medium text-emerald-700 dark:text-emerald-300">toolId</span>
        <select
          value={node.toolId ?? ""}
          disabled={running || loadingTools}
          onChange={(e) => onNodeChange(node.id, { toolId: e.target.value })}
          className="h-8 rounded-md border border-emerald-200 bg-white px-2 text-[12px] text-neutral-900 outline-none focus:border-emerald-400 disabled:opacity-50 dark:border-emerald-800 dark:bg-neutral-950 dark:text-neutral-100"
        >
          <option value="">{loadingTools ? "加载工具中…" : "选择 registered tool"}</option>
          {tools.map((tool) => (
            <option key={tool.id} value={tool.id}>{tool.id}</option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-[10px] font-medium text-emerald-700 dark:text-emerald-300">timeoutMs</span>
        <input
          type="number"
          min={1}
          value={node.timeoutMs ?? ""}
          disabled={running}
          onChange={(e) => onNodeChange(node.id, { timeoutMs: e.target.value ? Number(e.target.value) : undefined })}
          placeholder="60000"
          className="h-8 rounded-md border border-emerald-200 bg-white px-2 text-[12px] text-neutral-900 outline-none focus:border-emerald-400 disabled:opacity-50 dark:border-emerald-800 dark:bg-neutral-950 dark:text-neutral-100"
        />
      </label>
      <label className="flex flex-col gap-1 md:col-span-2">
        <span className="text-[10px] font-medium text-emerald-700 dark:text-emerald-300">inputPath</span>
        <input
          value={node.inputPath ?? ""}
          disabled={running}
          onChange={(e) => onNodeChange(node.id, { inputPath: e.target.value })}
          placeholder="{{input.file}} 或上游节点产出的路径"
          className="h-8 rounded-md border border-emerald-200 bg-white px-2 font-mono text-[11px] text-neutral-900 outline-none focus:border-emerald-400 disabled:opacity-50 dark:border-emerald-800 dark:bg-neutral-950 dark:text-neutral-100"
        />
      </label>
      <label className="flex flex-col gap-1 md:col-span-2">
        <span className="text-[10px] font-medium text-emerald-700 dark:text-emerald-300">outputDir</span>
        <input
          value={node.outputDir ?? ""}
          disabled={running}
          onChange={(e) => onNodeChange(node.id, { outputDir: e.target.value || undefined })}
          placeholder="留空则写入当前 node run directory"
          className="h-8 rounded-md border border-emerald-200 bg-white px-2 font-mono text-[11px] text-neutral-900 outline-none focus:border-emerald-400 disabled:opacity-50 dark:border-emerald-800 dark:bg-neutral-950 dark:text-neutral-100"
        />
      </label>
      {selectedTool && (
        <div className="flex items-center gap-2 md:col-span-2">
          <div className="min-w-0 flex-1 truncate text-[10.5px] leading-4 text-emerald-700 dark:text-emerald-300">
            {selectedTool.name} · input {selectedTool.input.modes.join("/")} · accept {selectedTool.input.accept.join(", ")} · output {selectedTool.output.join(", ")}
          </div>
          <button
            onClick={() => onApplyTemplate(node.id, selectedTool)}
            disabled={running}
            className="inline-flex h-6 shrink-0 items-center gap-1 rounded border border-emerald-200 bg-white px-1.5 text-[10px] font-medium text-emerald-700 hover:bg-emerald-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-emerald-800 dark:bg-neutral-950 dark:text-emerald-300 dark:hover:bg-emerald-950/30"
          >
            <Copy className="h-3 w-3" strokeWidth={1.75} />
            套用
          </button>
        </div>
      )}
      {(!node.toolId || !node.inputPath) && (
        <div className="flex items-center gap-1 md:col-span-2 text-[10.5px] text-amber-700 dark:text-amber-300">
          <AlertCircle className="h-3 w-3 shrink-0" strokeWidth={1.75} />
          tool node 运行前需要保存有效的 toolId 和 inputPath。
        </div>
      )}
    </div>
  );
}
