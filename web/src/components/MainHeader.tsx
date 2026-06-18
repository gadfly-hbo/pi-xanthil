import { PanelLeftOpen, Compass, Network, Users, Calculator, BookOpen, Database, FlaskConical, Cpu, Telescope, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/cn";

export type Tab = "explore" | "zhuanti" | "multi" | "aggregate" | "rule_memory" | "xan_db" | "research_lab" | "dashboard" | "onto_xanthil";

export const TABS: { id: Tab; label: string; icon: LucideIcon }[] = [
  { id: "explore", label: "探索", icon: Compass },
  { id: "zhuanti", label: "专题", icon: Telescope },
  { id: "multi", label: "工作流", icon: Users },
  { id: "aggregate", label: "计算工具", icon: Calculator },
  { id: "rule_memory", label: "规则记忆", icon: BookOpen },
  { id: "research_lab", label: "实验室", icon: FlaskConical },
  { id: "xan_db", label: "Xan数据库", icon: Database },
  { id: "dashboard", label: "Dashboard", icon: Cpu },
  { id: "onto_xanthil", label: "onto-xanthil", icon: Network },
];

interface Props {
  workspaceName: string | null;
  sessionId: string | null;
  activeTab: Tab;
  onTabChange: (t: Tab) => void;
  sidebarOpen: boolean;
  onOpenSidebar: () => void;
  totalTokens: number;
  /** Today's cacheReadTokens / (input + cacheRead + cacheWrite). */
  cacheHitRate: number;
  hiddenTabs: string[];
  rulesPromptEnabled: boolean;
  rulesPromptCount: number;
  rulesPromptUpdatedAt: number | null;
  onToggleRulesPrompt: () => void;
  onOpenTokenStats: () => void;
  onOpenQuickNotes: () => void;
}

export function MainHeader(p: Props) {
  const tabLabel = TABS.find((t) => t.id === p.activeTab)?.label ?? "";
  const visibleTabs = TABS.filter((t) => !p.hiddenTabs.includes(t.id));
  const rulesPromptTitle = p.rulesPromptCount === 0
    ? "无启用规则，开启后也不会注入内容"
    : p.rulesPromptEnabled
      ? `规则记忆注入已开启，将注入 ${p.rulesPromptCount} 条启用规则${p.rulesPromptUpdatedAt ? `\n更新于 ${new Date(p.rulesPromptUpdatedAt).toLocaleString()}` : ""}`
      : `规则记忆注入已关闭，有 ${p.rulesPromptCount} 条启用规则可注入${p.rulesPromptUpdatedAt ? `\n更新于 ${new Date(p.rulesPromptUpdatedAt).toLocaleString()}` : ""}`;
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
        {visibleTabs.map((t) => {
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
        <button
          onClick={p.onToggleRulesPrompt}
          title={rulesPromptTitle}
          disabled={p.rulesPromptCount === 0}
          className={cn(
            "inline-flex h-7 items-center rounded-md px-2 text-[11.5px] transition-colors disabled:cursor-not-allowed disabled:opacity-50",
            p.rulesPromptEnabled
              ? "bg-emerald-50 font-medium text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300"
              : "text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700 dark:hover:bg-neutral-800 dark:hover:text-neutral-200",
          )}
        >
          rules {p.rulesPromptCount === 0 ? "none" : p.rulesPromptEnabled ? `on · ${p.rulesPromptCount}` : `off · ${p.rulesPromptCount}`}
        </button>
        <span
          title={`今日 Provider 缓存命中率：${(p.cacheHitRate * 100).toFixed(1)}%\n命中 token 占比 = cacheRead / (input + cacheRead + cacheWrite)`}
          className={cn(
            "font-medium tabular-nums",
            p.cacheHitRate >= 0.5
              ? "text-emerald-600 dark:text-emerald-400"
              : p.cacheHitRate >= 0.2
                ? "text-amber-500 dark:text-amber-400"
                : "text-neutral-500 dark:text-neutral-400",
          )}
        >
          ↩{(p.cacheHitRate * 100).toFixed(0)}%
        </span>
        <span title="累计 token" className="tabular-nums">{p.totalTokens.toLocaleString()} tok</span>
        <button
          onClick={p.onOpenTokenStats}
          title="查看 token 统计明细"
          className="inline-flex h-7 items-center rounded-md px-2 text-[11.5px] text-neutral-500 transition-colors hover:bg-neutral-100 hover:text-neutral-900 dark:text-neutral-400 dark:hover:bg-neutral-800 dark:hover:text-neutral-100"
        >
          token统计
        </button>
        <button
          onClick={p.onOpenQuickNotes}
          title="随手记：工作日志与备忘"
          className="inline-flex h-7 items-center rounded-md px-2 text-[11.5px] text-neutral-500 transition-colors hover:bg-neutral-100 hover:text-neutral-900 dark:text-neutral-400 dark:hover:bg-neutral-800 dark:hover:text-neutral-100"
        >
          随手记
        </button>
      </div>
    </header>
  );
}
