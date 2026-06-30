import { ShieldCheck, Wrench } from "lucide-react";
import { ManualAnalysisToolCard } from "@/components/ManualAnalysisToolCard";
import type { FolderScope } from "@/tabs/types";

interface Props {
  workspaceId: string | null;
  sessionId: string | null;
  folderScope: FolderScope;
  onRegistered?: () => void;
}

export function ToolComputePane({ workspaceId, sessionId, folderScope, onRegistered }: Props) {
  return (
    <div className="flex min-h-0 flex-1 overflow-auto bg-neutral-50/60 p-5 dark:bg-neutral-950">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-4">
        <div>
          <h1 className="flex items-center gap-2 text-base font-semibold text-neutral-900 dark:text-neutral-100">
            <Wrench className="h-4 w-4" /> 工具计算
          </h1>
          <p className="mt-1 text-[12.5px] text-neutral-500">使用本地 Python analysis 工具处理 draw_data / clean_data，产物自动登记到聚合数据。</p>
        </div>

        <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-[12px] text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-300">
          <div className="flex items-center gap-2 font-medium"><ShieldCheck className="h-4 w-4" /> 本地执行边界</div>
          <p className="mt-1">工具在本机执行，原始数据不发送给 LLM。输出文件会登记为 clean_data，后续数据分析只读取登记后的聚合产物。</p>
        </div>

        <ManualAnalysisToolCard
          sessionId={sessionId}
          workspaceId={workspaceId}
          scope={folderScope}
          mode="aggregate"
          onRegistered={onRegistered}
          embedded
        />
      </div>
    </div>
  );
}
