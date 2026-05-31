import { FileText, BarChart3, Table2, PanelRightClose } from "lucide-react";
import { Markdown } from "@/components/Markdown";

interface Props {
  report: string;
  onCollapse: () => void;
}

export function PreviewPane({ report, onCollapse }: Props) {
  return (
    <aside className="flex h-full w-[26rem] shrink-0 flex-col border-l border-neutral-200 dark:border-neutral-800">
      <div className="flex h-12 shrink-0 items-center justify-between px-4">
        <div className="flex items-center gap-2 text-[13px] font-medium text-neutral-900 dark:text-neutral-100">
          <FileText className="h-3.5 w-3.5 text-neutral-500 dark:text-neutral-400" strokeWidth={1.75} />
          产物预览
        </div>
        <button
          onClick={onCollapse}
          title="收起预览"
          className="inline-flex h-7 w-7 items-center justify-center rounded-md text-neutral-500 hover:bg-neutral-100 hover:text-neutral-900 dark:text-neutral-400 dark:hover:bg-neutral-800 dark:hover:text-neutral-100"
        >
          <PanelRightClose className="h-4 w-4" strokeWidth={1.75} />
        </button>
      </div>
      <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto px-4 pb-4">
        {report ? (
          <Markdown>{report}</Markdown>
        ) : (
          <div className="pt-16 text-center text-[12.5px] text-neutral-400 dark:text-neutral-500">
            <div className="mb-5 flex justify-center gap-6">
              {[
                { Icon: BarChart3, label: "图表" },
                { Icon: Table2, label: "数据表" },
                { Icon: FileText, label: "报告" },
              ].map(({ Icon, label }) => (
                <div key={label} className="flex flex-col items-center gap-1">
                  <Icon className="h-6 w-6" strokeWidth={1.5} />
                  <span>{label}</span>
                </div>
              ))}
            </div>
            <p>报告 / 图表 / 数据表将在这里预览</p>
            <p className="mt-1 text-[11px]">Phase 2：ECharts + TanStack 表格 + Excel</p>
          </div>
        )}
      </div>
    </aside>
  );
}
