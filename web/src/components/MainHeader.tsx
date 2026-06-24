import { PanelLeftOpen, Compass, Network, Users, Calculator, BookOpen, Database, Library, Telescope, Activity, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/cn";

export type Tab = "explore" | "zhuanti" | "multi" | "aggregate" | "rule_memory" | "xan_db" | "knowledge_base" | "onto_xanthil" | "health";

// 模块命名映射（2026-06-18 改名，权威见 Orchestration.md §〇）：explore=「日常」(曾"探索") · multi=「重复」(曾"工作流"，产物仍称 工作流/flow) · zhuanti=「专题」。
// ⚠️ 仅 label 展示名可改；Tab id / DB kind="multi" / 路由不可改（零迁移）。
export const TABS: { id: Tab; label: string; icon: LucideIcon }[] = [
  { id: "health", label: "监测", icon: Activity },
  { id: "explore", label: "日常", icon: Compass },
  { id: "zhuanti", label: "专题", icon: Telescope },
  { id: "multi", label: "重复", icon: Users },
  { id: "aggregate", label: "控制", icon: Calculator },
  { id: "rule_memory", label: "记忆", icon: BookOpen },
  { id: "xan_db", label: "数据库", icon: Database },
  { id: "knowledge_base", label: "知识库", icon: Library },
  { id: "onto_xanthil", label: "本体库", icon: Network },
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
  rulesPromptDetails: string[];
  onToggleRulesPrompt: () => void;
  knowledgePromptEnabled: boolean;
  knowledgePromptCount: number;
  knowledgePromptUpdatedAt: number | null;
  onToggleKnowledgePrompt: () => void;
  onOpenQuickNotes: () => void;
}

export function MainHeader(p: Props) {
  const tabLabel = TABS.find((t) => t.id === p.activeTab)?.label ?? "";
  const visibleTabs = TABS.filter((t) => !p.hiddenTabs.includes(t.id));
  const memoryDetails = p.rulesPromptDetails.length > 0 ? `\n${p.rulesPromptDetails.join("；")}` : "";
  const rulesPromptTitle = p.rulesPromptCount === 0
    ? "无可注入记忆，开启后也不会注入内容"
    : p.rulesPromptEnabled
      ? `统一记忆注入已开启。包含：统一记忆、旧规则、业务环境、指标体系、案例与知识图谱。${memoryDetails}${p.rulesPromptUpdatedAt ? `\n更新于 ${new Date(p.rulesPromptUpdatedAt).toLocaleString()}` : ""}`
      : `统一记忆注入已关闭。可注入：统一记忆、旧规则、业务环境、指标体系、案例与知识图谱。${memoryDetails}${p.rulesPromptUpdatedAt ? `\n更新于 ${new Date(p.rulesPromptUpdatedAt).toLocaleString()}` : ""}`;
  const knowledgePromptTitle = p.knowledgePromptCount === 0
    ? "知识库暂无文档"
    : p.knowledgePromptEnabled
      ? `引用知识库已开启，将按当前问题检索 ${p.knowledgePromptCount} 篇文档${p.knowledgePromptUpdatedAt ? `\n更新于 ${new Date(p.knowledgePromptUpdatedAt).toLocaleString()}` : ""}`
      : `引用知识库已关闭，有 ${p.knowledgePromptCount} 篇文档可检索${p.knowledgePromptUpdatedAt ? `\n更新于 ${new Date(p.knowledgePromptUpdatedAt).toLocaleString()}` : ""}`;
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
          onClick={p.onToggleKnowledgePrompt}
          title={knowledgePromptTitle}
          disabled={p.knowledgePromptCount === 0}
          className={cn(
            "inline-flex h-7 items-center rounded-md px-2 text-[11.5px] transition-colors disabled:cursor-not-allowed disabled:opacity-50",
            p.knowledgePromptEnabled
              ? "bg-sky-50 font-medium text-sky-700 dark:bg-sky-950/40 dark:text-sky-300"
              : "text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700 dark:hover:bg-neutral-800 dark:hover:text-neutral-200",
          )}
        >
          知识库 {p.knowledgePromptCount === 0 ? "none" : p.knowledgePromptEnabled ? "on" : "off"}
        </button>
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
          记忆 {p.rulesPromptCount === 0 ? "none" : p.rulesPromptEnabled ? "on" : "off"}
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
