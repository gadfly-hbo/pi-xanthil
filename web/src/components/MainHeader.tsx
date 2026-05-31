import { PanelLeftOpen, Compass, Bot, Users, Calculator, BookOpen, Database, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/cn";

export type Tab = "explore" | "single" | "multi" | "aggregate" | "rule_memory" | "xan_db";

export const TABS: { id: Tab; label: string; icon: LucideIcon }[] = [
  { id: "explore", label: "探索", icon: Compass },
  { id: "single", label: "单智能体", icon: Bot },
  { id: "multi", label: "多智能体", icon: Users },
  { id: "aggregate", label: "聚合计算", icon: Calculator },
  { id: "rule_memory", label: "规则记忆", icon: BookOpen },
  { id: "xan_db", label: "Xan数据库", icon: Database },
];

interface Props {
  workspaceName: string | null;
  sessionId: string | null;
  activeTab: Tab;
  onTabChange: (t: Tab) => void;
  sidebarOpen: boolean;
  onOpenSidebar: () => void;
  totalTokens: number;
  totalCost: number;
}

export function MainHeader(p: Props) {
  const tabLabel = TABS.find((t) => t.id === p.activeTab)?.label ?? "";
  return (
    <header className="flex h-12 shrink-0 items-center px-4">
      {!p.sidebarOpen && (
        <button
          onClick={p.onOpenSidebar}
          title="展开侧栏"
          className="mr-3 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-neutral-500 hover:bg-neutral-100 hover:text-neutral-900 dark:text-neutral-400 dark:hover:bg-neutral-800 dark:hover:text-neutral-100"
        >
          <PanelLeftOpen className="h-4 w-4" strokeWidth={1.75} />
        </button>
      )}

      {/* breadcrumb */}
      <div className="flex min-w-0 items-center gap-2 text-[13px]">
        <span className="shrink-0 text-neutral-500 dark:text-neutral-400">{p.workspaceName ?? "未选择工作区"}</span>
        <span className="shrink-0 text-neutral-400/60 dark:text-neutral-500/60">/</span>
        <span className="shrink-0 font-medium text-neutral-900 dark:text-neutral-100">{tabLabel}</span>
        {p.sessionId && (
          <span className="ml-2 min-w-0 max-w-[20rem] truncate font-mono text-[11px] text-neutral-500 dark:text-neutral-400">
            {p.sessionId.slice(0, 8)}
          </span>
        )}
      </div>

      {/* tab strip */}
      <nav className="ml-4 flex h-9 shrink-0 items-center gap-1">
        {TABS.map((t) => {
          const Icon = t.icon;
          const active = t.id === p.activeTab;
          return (
            <button
              key={t.id}
              onClick={() => p.onTabChange(t.id)}
              className={cn(
                "inline-flex h-8 items-center gap-1.5 rounded-md px-2.5 text-[12.5px] transition-colors",
                active
                  ? "bg-neutral-100 font-medium text-neutral-900 dark:bg-neutral-800 dark:text-neutral-100"
                  : "text-neutral-500 hover:bg-neutral-100 hover:text-neutral-900 dark:text-neutral-400 dark:hover:bg-neutral-800/60 dark:hover:text-neutral-100",
              )}
            >
              <Icon className="h-3.5 w-3.5" strokeWidth={1.75} />
              <span>{t.label}</span>
            </button>
          );
        })}
      </nav>

      {/* right: usage chips */}
      <div className="ml-auto flex shrink-0 items-center gap-3 pl-3 text-[11px] text-neutral-500 dark:text-neutral-400">
        <span title="累计 token">{p.totalTokens.toLocaleString()} tok</span>
        <span className="text-neutral-300 dark:text-neutral-700">·</span>
        <span title="累计成本 (USD)">${p.totalCost.toFixed(4)}</span>
      </div>
    </header>
  );
}
