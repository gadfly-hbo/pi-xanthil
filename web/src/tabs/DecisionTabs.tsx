import type { TabContext } from "./types";

/**
 * 【决策能力域】tab 渲染模块 —— owner: Claude(总控独立开发)。
 * 决策 = 产品第三种第一性能力（独立于 AnaX/besike 分析模块）。
 * P0 为骨架；看板/工作台/助手/复盘在 P2–P5 落地。详见 docs/decision-intelligence-plan.md。
 */
export function DecisionTabs({ ctx }: { ctx: TabContext }) {
  const { activeTab, activeSubTab } = ctx;
  if (activeTab !== "decision") return null;
  return (
    <div className="min-h-0 flex-1 overflow-y-auto p-6">
      {activeSubTab === "decision_board" && (
        <Shell title="决策看板" desc="按状态分列的决策档案（draft→…→reviewed）· 开发中 P3" />
      )}
      {activeSubTab === "decision_workbench" && (
        <Shell title="决策工作台" desc="带着选择进来：界定 → 取证 → 推演 → 押注 · 开发中 P3" />
      )}
      {activeSubTab === "decision_assistant" && (
        <Shell title="决策助手" desc="会推演的决策对话，区别于 besike 分析对话 · 开发中 P5" />
      )}
      {activeSubTab === "decision_review" && (
        <Shell title="复盘" desc="结果回填 → 归因 → 校准假设库先验（飞轮）· 开发中 P5" />
      )}
    </div>
  );
}

function Shell({ title, desc }: { title: string; desc: string }) {
  return (
    <div className="rounded-lg border border-dashed border-neutral-300 p-8 dark:border-neutral-700">
      <div className="text-base font-medium text-neutral-700 dark:text-neutral-200">{title}</div>
      <div className="mt-1.5 text-[13px] text-neutral-400">{desc}</div>
    </div>
  );
}
