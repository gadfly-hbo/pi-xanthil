import { useState } from "react";
import { ChevronRight, PanelLeftClose, Pencil, Plus, Trash2, Workflow } from "lucide-react";
import { cn } from "@/lib/cn";
import { ConfirmDeleteDialog } from "@/components/ConfirmDeleteDialog";
import type { Flow } from "@/types";

/**
 * 工作流列表 —— 由左侧主栏迁入「工作流 · 工作视图」内的左竖栏（owner: Claude 总控）。
 * 仅负责工作流的选择 / 新建 / 重命名 / 删除；精选收藏已下线，故无星标。
 */

interface Props {
  flows: Flow[];
  activeFlowId: string | null;
  onSelectFlow: (id: string) => void;
  onNewFlow: (kind: "single" | "multi") => void;
  onRenameFlow: (id: string, name: string) => void;
  onDeleteFlow: (id: string, deleteFiles: boolean) => void;
}

const rowActionBtn =
  "inline-flex h-6 w-6 items-center justify-center rounded-md text-neutral-400 hover:bg-neutral-200 hover:text-neutral-700 dark:text-neutral-500 dark:hover:bg-neutral-700 dark:hover:text-neutral-200";

export function FlowListColumn({ flows, activeFlowId, onSelectFlow, onNewFlow, onRenameFlow, onDeleteFlow }: Props) {
  const [collapsed, setCollapsed] = useState(false);
  const [editing, setEditing] = useState<{ id: string; value: string } | null>(null);
  const [pendingDelete, setPendingDelete] = useState<{ id: string; name: string } | null>(null);

  // 排除 AnaX 模板派生 flow（与原侧栏过滤保持一致）。
  const visible = flows.filter((f) => f.kind === "multi" && f.sourceName !== "AnaX v3.0" && f.sourceName !== "AnaX v3.0 Quick");

  const commitEdit = () => {
    if (!editing) return;
    const v = editing.value.trim();
    if (v) onRenameFlow(editing.id, v);
    setEditing(null);
  };

  if (collapsed) {
    return (
      <button
        onClick={() => setCollapsed(false)}
        title="展开工作流列表"
        className="flex w-9 shrink-0 items-center justify-center border-r border-neutral-200 text-neutral-500 hover:bg-neutral-100 hover:text-neutral-900 dark:border-neutral-800 dark:text-neutral-400 dark:hover:bg-neutral-800 dark:hover:text-neutral-100"
      >
        <ChevronRight className="h-4 w-4" strokeWidth={1.75} />
      </button>
    );
  }

  return (
    <aside className="flex w-60 shrink-0 flex-col border-r border-neutral-200 bg-neutral-50/40 dark:border-neutral-800 dark:bg-neutral-950/40">
      <div className="flex h-9 shrink-0 items-center gap-1.5 border-b border-neutral-200 px-3 dark:border-neutral-800">
        <span className="flex-1 text-[12px] font-medium uppercase tracking-[0.04em] text-neutral-500/90 dark:text-neutral-400/80">工作流</span>
        <button
          onClick={() => onNewFlow("multi")}
          title="新建工作流"
          className="inline-flex h-6 w-6 items-center justify-center rounded-md text-neutral-500 hover:bg-neutral-200 hover:text-neutral-900 dark:text-neutral-400 dark:hover:bg-neutral-700 dark:hover:text-neutral-100"
        >
          <Plus className="h-3.5 w-3.5" strokeWidth={1.75} />
        </button>
        <button
          onClick={() => setCollapsed(true)}
          title="收起"
          className="inline-flex h-6 w-6 items-center justify-center rounded-md text-neutral-400 hover:bg-neutral-200 hover:text-neutral-700 dark:hover:bg-neutral-700 dark:hover:text-neutral-200"
        >
          <PanelLeftClose className="h-3.5 w-3.5" strokeWidth={1.75} />
        </button>
      </div>

      <div className="scrollbar-thin min-h-0 flex-1 space-y-0.5 overflow-y-auto p-2">
        {visible.map((f) =>
          editing?.id === f.id ? (
            <div key={f.id} className="px-1 py-0.5">
              <input
                autoFocus
                value={editing.value}
                onChange={(e) => setEditing({ ...editing, value: e.target.value })}
                onKeyDown={(e) => {
                  if (e.key === "Enter") commitEdit();
                  if (e.key === "Escape") setEditing(null);
                }}
                onBlur={commitEdit}
                className="w-full rounded-sm border border-neutral-300 bg-white px-1.5 py-0.5 text-[12.5px] text-neutral-900 outline-none focus:border-neutral-500 dark:border-neutral-600 dark:bg-neutral-900 dark:text-neutral-100"
              />
            </div>
          ) : (
            <div
              key={f.id}
              className={cn(
                "group flex items-center rounded-md",
                f.id === activeFlowId ? "bg-neutral-200/70 dark:bg-neutral-800" : "hover:bg-neutral-100 dark:hover:bg-neutral-800/60",
              )}
            >
              <button
                onClick={() => onSelectFlow(f.id)}
                className="flex min-w-0 flex-1 items-center gap-1.5 px-2 py-1.5 text-left text-[12.5px] text-neutral-800 dark:text-neutral-200"
              >
                <Workflow className="h-3.5 w-3.5 shrink-0 text-neutral-500 dark:text-neutral-400" strokeWidth={1.75} />
                <span className="min-w-0 flex-1 truncate">{f.name}</span>
                {f.sourceName && <span className="ml-1 shrink-0 text-[10px] text-neutral-400 dark:text-neutral-500">{f.sourceName}</span>}
              </button>
              <div className="flex shrink-0 items-center pr-1 opacity-0 transition-opacity group-hover:opacity-100">
                <button className={rowActionBtn} title="重命名" onClick={() => setEditing({ id: f.id, value: f.name })}>
                  <Pencil className="h-3.5 w-3.5" strokeWidth={1.75} />
                </button>
                <button
                  className={rowActionBtn}
                  title="删除"
                  onClick={() => setPendingDelete({ id: f.id, name: f.name })}
                >
                  <Trash2 className="h-3.5 w-3.5" strokeWidth={1.75} />
                </button>
              </div>
            </div>
          ),
        )}
        {visible.length === 0 && (
          <p className="px-2 py-6 text-center text-[11.5px] leading-5 text-neutral-400 dark:text-neutral-500">还没有工作流，点上方 + 新建。</p>
        )}
      </div>

      {pendingDelete && (
        <ConfirmDeleteDialog
          title={`删除工作流「${pendingDelete.name}」？`}
          fileToggleLabel="同时删除该工作流的文档文件夹"
          onCancel={() => setPendingDelete(null)}
          onConfirm={(deleteFiles) => {
            onDeleteFlow(pendingDelete.id, deleteFiles);
            setPendingDelete(null);
          }}
        />
      )}
    </aside>
  );
}
