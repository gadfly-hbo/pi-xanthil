import type { MouseEvent } from "react";
import { Play, Square } from "lucide-react";
import { cn } from "@/lib/cn";
import type { WorkflowIssue } from "./types";

interface Props {
  width: number;
  runId: string | null;
  running: boolean;
  taskText: string;
  currentOutputDir: string | null;
  workflowReady: boolean;
  workflowHasErrors: boolean;
  workflowIssues: WorkflowIssue[];
  onTaskTextChange: (value: string) => void;
  onRun: () => void;
  onAbort: () => void;
  onResizeStart: (event: MouseEvent) => void;
}

export function RunControlPanel({
  width,
  runId,
  running,
  taskText,
  currentOutputDir,
  workflowReady,
  workflowHasErrors,
  workflowIssues,
  onTaskTextChange,
  onRun,
  onAbort,
  onResizeStart,
}: Props) {
  return (
    <aside style={{ width }} className="relative flex shrink-0 flex-col border-r border-neutral-200 dark:border-neutral-800">
      <div className="flex h-10 shrink-0 items-center gap-2 border-b border-neutral-200 px-3 dark:border-neutral-800">
        <span className="min-w-0 truncate text-[11px] font-medium text-neutral-500">{runId ?? "等待运行"}</span>
        {runId && (
          <span className={cn("ml-auto text-[10px] font-medium", running ? "text-amber-600" : "text-neutral-400")}>
            {running ? "运行中" : "已结束"}
          </span>
        )}
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-1.5 px-3 py-3">
        <label className="shrink-0 text-[11px] font-medium text-neutral-500">任务说明</label>
        <textarea
          value={taskText}
          onChange={(e) => onTaskTextChange(e.target.value)}
          disabled={running}
          placeholder="描述本次工作流的任务目标、输入数据范围、关键约束与期望产出。内容将作为 {{task}} 注入各节点。"
          className="min-h-0 w-full flex-1 resize-none rounded-md border border-neutral-200 bg-transparent px-2.5 py-2 text-[12px] leading-5 text-neutral-900 outline-none placeholder:text-neutral-400 focus:border-neutral-400 disabled:opacity-50 dark:border-neutral-700 dark:text-neutral-100 dark:focus:border-neutral-500"
        />
      </div>

      <div className="flex shrink-0 flex-col gap-1 border-t border-neutral-200 px-3 py-2 dark:border-neutral-800">
        {running ? (
          <button
            onClick={onAbort}
            className="flex h-8 w-full items-center justify-center gap-1.5 rounded-md bg-rose-500 text-[12.5px] font-medium text-white transition-colors hover:bg-rose-600 dark:bg-rose-600 dark:hover:bg-rose-700"
          >
            <Square className="h-3.5 w-3.5" strokeWidth={2} fill="currentColor" />
            强制停止
          </button>
        ) : (
          <button
            onClick={onRun}
            disabled={!workflowReady || workflowHasErrors}
            className={cn(
              "flex w-full items-center justify-center gap-1.5 rounded-md h-8 text-[12.5px] font-medium transition-colors",
              !workflowReady || workflowHasErrors
                ? "bg-neutral-100 text-neutral-400 cursor-not-allowed dark:bg-neutral-800 dark:text-neutral-600"
                : "bg-sky-500 text-white hover:bg-sky-600 dark:bg-sky-600 dark:hover:bg-sky-700",
            )}
            title={workflowHasErrors ? workflowIssues.find((issue) => issue.level === "error")?.message : undefined}
          >
            <Play className="h-3.5 w-3.5" strokeWidth={2} />
            运行工作流
          </button>
        )}
        {currentOutputDir && (
          <div className="truncate font-mono text-[9px] text-neutral-400" title={currentOutputDir}>
            输出：{currentOutputDir}
          </div>
        )}
      </div>

      <div
        onMouseDown={onResizeStart}
        className="absolute right-0 top-0 h-full w-1 cursor-col-resize hover:bg-neutral-300 dark:hover:bg-neutral-700"
      />
    </aside>
  );
}
