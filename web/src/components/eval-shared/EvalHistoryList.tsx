import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

export interface EvalHistoryItem {
  evaluationId: string;
  startedAt: number;
  status: "success" | "failed";
}

export function EvalHistoryList<Item extends EvalHistoryItem>({ items, selectedId, onSelect, renderMeta, emptyText = "还没有评测历史。", title = "历史评估" }: {
  items: Item[];
  selectedId?: string;
  onSelect: (item: Item) => void;
  renderMeta?: (item: Item) => ReactNode;
  emptyText?: string;
  title?: ReactNode;
}) {
  return <section className="mt-6">
    <div className="text-xs font-medium text-neutral-500">{title}</div>
    <div className="mt-2 space-y-1">
      {items.map((item) => <button
        type="button"
        key={item.evaluationId}
        onClick={() => onSelect(item)}
        className={cn("flex w-full items-center gap-2 rounded-md border border-transparent px-2 py-1.5 text-left text-xs hover:bg-neutral-100 dark:hover:bg-neutral-800", selectedId === item.evaluationId && "bg-neutral-100 dark:bg-neutral-800")}
      >
        <span className={cn("h-2 w-2 shrink-0 rounded-full", item.status === "success" ? "bg-emerald-500" : "bg-red-500")} />
        <span className="min-w-0 flex-1 truncate">{new Date(item.startedAt).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })}</span>
        {renderMeta ? renderMeta(item) : <span className={item.status === "success" ? "text-emerald-600" : "text-red-600"}>{item.status}</span>}
      </button>)}
      {items.length === 0 && <p className="px-2 py-2 text-xs text-neutral-400">{emptyText}</p>}
    </div>
  </section>;
}
