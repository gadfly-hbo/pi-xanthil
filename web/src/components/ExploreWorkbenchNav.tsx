import { useEffect, useRef, useState } from "react";
import {
  BarChart3,
  Calculator,
  Check,
  ChevronDown,
  CircleAlert,
  Database,
  FileOutput,
  FileText,
  Filter,
  FlaskConical,
  FolderInput,
  HelpCircle,
  Languages,
  Lightbulb,
  ListChecks,
  MessageSquareText,
  MoreHorizontal,
  ShieldCheck,
  Sigma,
  Target,
  TriangleAlert,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/cn";
import type { SubTab } from "@/lib/constants";
import type { FolderScope } from "@/tabs/types";
import { ExploreResourceDrawer, type ExploreDrawerKind } from "@/components/ExploreResourceDrawer";

type MenuId = "data" | "outputs" | "tools";

interface NavItem {
  id: SubTab;
  label: string;
  icon: LucideIcon;
}

interface MenuDefinition {
  id: MenuId;
  label: string;
  icon: NavItem["icon"];
  items: NavItem[];
}

const MENUS: MenuDefinition[] = [
  {
    id: "data",
    label: "数据",
    icon: Database,
    items: [
      { id: "draw_data", label: "原始数据", icon: FolderInput },
      { id: "clean_data", label: "聚合数据", icon: Database },
      { id: "data_exploration", label: "数据探索", icon: BarChart3 },
    ],
  },
  {
    id: "outputs",
    label: "产物",
    icon: FileOutput,
    items: [
      { id: "report", label: "报告输出", icon: FileText },
      { id: "report_review", label: "报告审核", icon: ShieldCheck },
      { id: "presentation_version", label: "业务语言", icon: Languages },
      { id: "golden_strategy", label: "黄金策", icon: Lightbulb },
      { id: "actions", label: "执行反馈", icon: ListChecks },
    ],
  },
  {
    id: "tools",
    label: "更多工具",
    icon: MoreHorizontal,
    items: [
      { id: "business_requirement", label: "分析目标", icon: Target },
      { id: "extraction", label: "数据提取", icon: Filter },
      { id: "tool_compute", label: "工具计算", icon: Calculator },
      { id: "aggregate_compute", label: "聚合计算", icon: Sigma },
      { id: "dlf", label: "模拟实验", icon: FlaskConical },
      { id: "readme", label: "使用说明", icon: HelpCircle },
    ],
  },
];

const LABELS = new Map<SubTab, string>([
  ["view", "自由分析"],
  ...MENUS.flatMap((menu) => menu.items.map((item) => [item.id, item.label] as const)),
]);

interface Props {
  activeSubTab: SubTab;
  hasReportPath: boolean;
  scope: FolderScope;
  refreshKey: number;
  isVisible: (key: string) => boolean;
  onNavigate: (subTab: SubTab) => void;
}

export function ExploreWorkbenchNav({ activeSubTab, hasReportPath, scope, refreshKey, isVisible, onNavigate }: Props) {
  const [openMenu, setOpenMenu] = useState<MenuId | null>(null);
  const [openDrawer, setOpenDrawer] = useState<ExploreDrawerKind | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const currentLabel = LABELS.get(activeSubTab) ?? "自由分析";

  useEffect(() => {
    const closeOnPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpenMenu(null);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpenMenu(null);
        setOpenDrawer(null);
      }
    };
    document.addEventListener("pointerdown", closeOnPointerDown);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnPointerDown);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, []);

  const navigate = (subTab: SubTab) => {
    setOpenMenu(null);
    setOpenDrawer(null);
    onNavigate(subTab);
  };

  return (
    <div
      ref={rootRef}
      className="relative z-30 flex min-h-11 shrink-0 items-center gap-2 border-b border-neutral-200 bg-white px-3 py-1.5 dark:border-neutral-800 dark:bg-neutral-950"
    >
      <button
        type="button"
        onClick={() => navigate("view")}
        className={cn(
          "inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md px-2.5 text-[12.5px] font-medium",
          activeSubTab === "view"
            ? "bg-neutral-900 text-white dark:bg-neutral-100 dark:text-neutral-900"
            : "text-neutral-600 hover:bg-neutral-100 hover:text-neutral-900 dark:text-neutral-300 dark:hover:bg-neutral-800 dark:hover:text-neutral-100",
        )}
        title="返回自由分析"
      >
        <MessageSquareText className="h-4 w-4" strokeWidth={1.75} />
        分析
      </button>

      <div className="hidden min-w-0 items-center gap-2 border-l border-neutral-200 pl-3 text-[12px] md:flex dark:border-neutral-800">
        <span className="text-neutral-400">当前</span>
        <span className="truncate font-medium text-neutral-700 dark:text-neutral-200">{currentLabel}</span>
      </div>

      <div className="ml-auto flex shrink-0 items-center gap-1">
        {MENUS.map((menu) => {
          const Icon = menu.icon;
          const visibleItems = menu.items.filter((item) => isVisible(`explore:${item.id}`));
          if (visibleItems.length === 0) return null;
          const containsActive = visibleItems.some((item) => item.id === activeSubTab);
          const expanded = openMenu === menu.id;
          return (
            <div key={menu.id} className="relative">
              <button
                type="button"
                onClick={() => {
                  if (menu.id === "tools") {
                    setOpenDrawer(null);
                    setOpenMenu((current) => current === menu.id ? null : menu.id);
                    return;
                  }
                  setOpenMenu(null);
                  const drawerKind: ExploreDrawerKind = menu.id;
                  setOpenDrawer((current) => current === drawerKind ? null : drawerKind);
                }}
                aria-expanded={menu.id === "tools" ? expanded : openDrawer === menu.id}
                aria-haspopup={menu.id === "tools" ? "menu" : "dialog"}
                className={cn(
                  "inline-flex h-8 items-center gap-1.5 rounded-md px-2 text-[12px]",
                  containsActive
                    ? "bg-neutral-100 font-medium text-neutral-900 dark:bg-neutral-800 dark:text-neutral-100"
                    : "text-neutral-500 hover:bg-neutral-100 hover:text-neutral-900 dark:text-neutral-400 dark:hover:bg-neutral-800 dark:hover:text-neutral-100",
                )}
              >
                <Icon className="h-3.5 w-3.5" strokeWidth={1.75} />
                <span>{menu.label}</span>
                <ChevronDown className={cn("h-3 w-3 transition-transform", expanded && "rotate-180")} strokeWidth={1.75} />
              </button>

              {menu.id === "tools" && expanded && (
                <div
                  role="menu"
                  className="absolute right-0 top-[calc(100%+6px)] w-52 max-w-[calc(100vw-1.5rem)] overflow-hidden rounded-md border border-neutral-200 bg-white p-1 shadow-lg dark:border-neutral-700 dark:bg-neutral-900"
                >
                  {visibleItems.map((item) => {
                    const ItemIcon = item.icon;
                    const active = item.id === activeSubTab;
                    return (
                      <button
                        key={item.id}
                        type="button"
                        role="menuitem"
                        onClick={() => navigate(item.id)}
                        className={cn(
                          "flex h-8 w-full items-center gap-2 rounded px-2 text-left text-[12.5px]",
                          active
                            ? "bg-neutral-100 font-medium text-neutral-900 dark:bg-neutral-800 dark:text-neutral-100"
                            : "text-neutral-600 hover:bg-neutral-50 hover:text-neutral-900 dark:text-neutral-300 dark:hover:bg-neutral-800/70 dark:hover:text-neutral-100",
                        )}
                      >
                        <ItemIcon className="h-3.5 w-3.5 shrink-0 text-neutral-400" strokeWidth={1.75} />
                        <span className="min-w-0 flex-1 truncate">{item.label}</span>
                        {item.id === "report" && !hasReportPath && (
                          <TriangleAlert className="h-3.5 w-3.5 shrink-0 text-amber-500" strokeWidth={2} aria-label="未设置报告输出路径" />
                        )}
                        {item.id === "clean_data" && (
                          <CircleAlert className="h-3.5 w-3.5 shrink-0 text-amber-500" strokeWidth={2} aria-label="数据安全：可被 LLM 读取，不要放入明细数据" />
                        )}
                        {active && <Check className="h-3.5 w-3.5 shrink-0" strokeWidth={2} />}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>
      {openDrawer && (
        <ExploreResourceDrawer
          kind={openDrawer}
          scope={scope}
          refreshKey={refreshKey}
          isVisible={isVisible}
          onClose={() => setOpenDrawer(null)}
          onNavigate={navigate}
        />
      )}
    </div>
  );
}
