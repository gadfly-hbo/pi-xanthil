import { useState } from "react";
import { ArrowRight, GitBranch, Loader2, ShieldCheck, Sparkles, X } from "lucide-react";
import { cn } from "@/lib/cn";

export type WorkflowTemplateId = "anax-full" | "anax-quick" | "sql-loop";

export interface WorkflowTemplate {
  id: WorkflowTemplateId;
  name: string;
  description: string;
  highlight: string;
  sourceName: string;
  note?: string;
}

const TEMPLATES: WorkflowTemplate[] = [
  {
    id: "anax-full",
    name: "AnaX 商业分析",
    description: "完整商业分析链路，适合从业务问题到结论报告的系统化拆解。",
    highlight: "8 阶段商业分析方法论，含数据质量门禁、两阶段复核与归档。",
    sourceName: "AnaX v3.0",
  },
  {
    id: "anax-quick",
    name: "AnaX 快速分析",
    description: "轻量版商业分析链路，适合快速验证问题、形成初版判断。",
    highlight: "快速建模业务问题，压缩节点数量，保留关键分析与输出步骤。",
    sourceName: "AnaX v3.0 Quick",
  },
  {
    id: "sql-loop",
    name: "SQL 修复 loop",
    description: "自动修复 SQL 的 loop 样板，适合验证带门禁回跳的工作流。",
    highlight: "写 SQL -> 执行 -> 门禁不过自动退回重写，最多 5 轮。",
    sourceName: "SQL Loop v1",
    note: "运行前需先配置 SQL 连接。",
  },
];

interface Props {
  open: boolean;
  workspaceReady: boolean;
  onClose: () => void;
  onInstantiate: (template: WorkflowTemplate) => Promise<void>;
}

export function WorkflowTemplateLibraryPane({ open, workspaceReady, onClose, onInstantiate }: Props) {
  const [runningId, setRunningId] = useState<WorkflowTemplateId | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (!open) return null;

  const handleInstantiate = async (template: WorkflowTemplate) => {
    if (runningId) return;
    setRunningId(template.id);
    setError(null);
    try {
      await onInstantiate(template);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setRunningId(null);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 px-4">
      <section className="flex max-h-[88vh] w-full max-w-4xl flex-col overflow-hidden rounded-lg border border-neutral-200 bg-white shadow-xl dark:border-neutral-700 dark:bg-neutral-950">
        <header className="flex h-12 shrink-0 items-center border-b border-neutral-200 px-4 dark:border-neutral-800">
          <div className="min-w-0 flex-1">
            <h2 className="text-[14px] font-semibold text-neutral-900 dark:text-neutral-100">模板库</h2>
            <p className="text-[11.5px] text-neutral-500 dark:text-neutral-400">选择预置 DAG，一键实例化到当前工作区。</p>
          </div>
          <button
            onClick={onClose}
            disabled={Boolean(runningId)}
            title="关闭"
            className="inline-flex h-7 w-7 items-center justify-center rounded-md text-neutral-500 hover:bg-neutral-100 hover:text-neutral-900 disabled:opacity-50 dark:text-neutral-400 dark:hover:bg-neutral-800 dark:hover:text-neutral-100"
          >
            <X className="h-4 w-4" strokeWidth={1.75} />
          </button>
        </header>

        <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto p-4">
          <div className="grid gap-3 md:grid-cols-3">
            {TEMPLATES.map((template) => {
              const running = runningId === template.id;
              return (
                <article
                  key={template.id}
                  className="flex min-h-[230px] flex-col rounded-lg border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900/70"
                >
                  <div className="mb-3 flex items-start gap-2">
                    <div className="mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-neutral-100 text-neutral-700 dark:bg-neutral-800 dark:text-neutral-200">
                      {template.id === "sql-loop" ? <ShieldCheck className="h-4 w-4" strokeWidth={1.75} /> : <Sparkles className="h-4 w-4" strokeWidth={1.75} />}
                    </div>
                    <div className="min-w-0">
                      <h3 className="text-[13px] font-semibold text-neutral-900 dark:text-neutral-100">{template.name}</h3>
                      <p className="mt-0.5 text-[10.5px] text-neutral-400 dark:text-neutral-500">{template.sourceName}</p>
                    </div>
                  </div>

                  <p className="text-[12px] leading-5 text-neutral-600 dark:text-neutral-300">{template.description}</p>
                  <div className="mt-3 flex gap-2 rounded-md bg-neutral-50 px-3 py-2 text-[11.5px] leading-5 text-neutral-600 dark:bg-neutral-800/60 dark:text-neutral-300">
                    <GitBranch className="mt-0.5 h-3.5 w-3.5 shrink-0 text-neutral-400" strokeWidth={1.75} />
                    <span>{template.highlight}</span>
                  </div>
                  {template.note && <p className="mt-2 text-[11px] text-amber-600 dark:text-amber-400">{template.note}</p>}

                  <button
                    onClick={() => void handleInstantiate(template)}
                    disabled={!workspaceReady || Boolean(runningId)}
                    className={cn(
                      "mt-auto inline-flex h-8 items-center justify-center gap-1.5 rounded-md px-3 text-[12px] font-medium",
                      !workspaceReady || runningId
                        ? "cursor-not-allowed bg-neutral-100 text-neutral-400 dark:bg-neutral-800 dark:text-neutral-600"
                        : "bg-neutral-900 text-white hover:bg-neutral-700 dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-white",
                    )}
                  >
                    {running ? <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={1.75} /> : <ArrowRight className="h-3.5 w-3.5" strokeWidth={1.75} />}
                    实例化到当前工作区
                  </button>
                </article>
              );
            })}
          </div>
          {!workspaceReady && <p className="mt-3 text-[12px] text-amber-600 dark:text-amber-400">请先选择一个工作区。</p>}
          {error && <p className="mt-3 text-[12px] text-rose-500">{error}</p>}
        </div>
      </section>
    </div>
  );
}
