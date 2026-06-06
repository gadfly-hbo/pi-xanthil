import { useState } from "react";
import { UserPlus, UserCheck, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/cn";
import { NewMemberRetentionPane } from "@/components/NewMemberRetentionPane";
import { OldMemberRecallPane } from "@/components/OldMemberRecallPane";

type BoardId = "new_member_retention" | "old_member_recall";

interface BoardDef {
  id: BoardId;
  name: string;
  description: string;
  icon: LucideIcon;
  category: string;
}

const BOARDS: BoardDef[] = [
  {
    id: "new_member_retention",
    name: "会员新客复购留存表",
    description: "新客首单后各账期的复购留存表现",
    icon: UserPlus,
    category: "复购分析",
  },
  {
    id: "old_member_recall",
    name: "会员老客复购召回表",
    description: "沉睡老客的召回复购转化追踪",
    icon: UserCheck,
    category: "复购分析",
  },
];

const CATEGORIES = Array.from(new Set(BOARDS.map((b) => b.category)));

export function BiDashboardPane() {
  const [activeBoard, setActiveBoard] = useState<BoardId>("new_member_retention");

  return (
    <div className="flex min-h-0 flex-1 bg-neutral-50/70 dark:bg-neutral-950">
      <aside className="hidden w-72 shrink-0 border-r border-neutral-200 bg-white/80 p-5 dark:border-neutral-800 dark:bg-neutral-950 lg:block">
        <div className="mb-5">
          <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-neutral-400">BI Dashboard</div>
          <h1 className="mt-2 text-[22px] font-semibold tracking-tight text-neutral-950 dark:text-neutral-50">看板库</h1>
          <p className="mt-2 text-[12.5px] leading-5 text-neutral-500 dark:text-neutral-400">面向运营复盘的业务看板集合，按主题分类查看。</p>
        </div>

        <div className="space-y-5">
          {CATEGORIES.map((category) => {
            const items = BOARDS.filter((b) => b.category === category);
            return (
              <div key={category}>
                <div className="mb-2 px-1 text-[10.5px] font-semibold uppercase tracking-[0.16em] text-neutral-400">
                  {category}
                </div>
                <div className="space-y-1.5">
                  {items.map((board) => {
                    const Icon = board.icon;
                    const active = activeBoard === board.id;
                    return (
                      <button
                        key={board.id}
                        onClick={() => setActiveBoard(board.id)}
                        className={cn(
                          "flex w-full items-start gap-2.5 rounded-lg px-3 py-2.5 text-left transition-colors",
                          active
                            ? "bg-neutral-900 text-white dark:bg-neutral-100 dark:text-neutral-900"
                            : "text-neutral-600 hover:bg-neutral-100 dark:text-neutral-400 dark:hover:bg-neutral-900",
                        )}
                      >
                        <Icon
                          className={cn(
                            "mt-0.5 h-4 w-4 shrink-0",
                            active ? "text-white dark:text-neutral-900" : "text-neutral-400",
                          )}
                          strokeWidth={1.75}
                        />
                        <div className="min-w-0 flex-1">
                          <div className="text-[12.5px] font-medium leading-5">{board.name}</div>
                          <div
                            className={cn(
                              "mt-0.5 text-[11px] leading-4",
                              active ? "text-white/70 dark:text-neutral-600" : "text-neutral-400",
                            )}
                          >
                            {board.description}
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </aside>

      <div className="min-w-0 flex-1 overflow-y-auto">
        {/* mobile board switcher */}
        <div className="flex gap-2 overflow-x-auto border-b border-neutral-200 bg-white/60 px-4 py-2 dark:border-neutral-800 dark:bg-neutral-950 lg:hidden">
          {BOARDS.map((board) => (
            <button
              key={board.id}
              onClick={() => setActiveBoard(board.id)}
              className={cn(
                "shrink-0 rounded-full px-3 py-1.5 text-[12px]",
                activeBoard === board.id
                  ? "bg-neutral-900 text-white dark:bg-neutral-100 dark:text-neutral-900"
                  : "bg-white text-neutral-600 dark:bg-neutral-900 dark:text-neutral-400",
              )}
            >
              {board.name}
            </button>
          ))}
        </div>

        {activeBoard === "new_member_retention" && <NewMemberRetentionPane />}
        {activeBoard === "old_member_recall" && <OldMemberRecallPane />}
      </div>
    </div>
  );
}
