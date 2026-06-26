import { OntologyPane } from "@/components/OntologyPane";
import { FolderPathsPane } from "@/components/FolderPathsPane";
import { PresentationVersionPane } from "@/components/PresentationVersionPane";
import { ReportReviewPane } from "@/components/ReportReviewPane";
import { GoldenStrategyPane } from "@/components/GoldenStrategyPane";
import { ActionsPane } from "@/components/ActionsPane";
import { TracePane } from "@/components/TracePane";
import { KnowledgeGraphPane } from "@/components/KnowledgeGraphPane";
import { BiDashboardPane } from "@/components/BiDashboardPane";
import type { TabContext } from "./types";

/**
 * 【Agent-V · 可视交付域】tab 渲染模块 —— owner: antigravity(Gemini)
 * 覆盖：探索→报告输出/汇报版本/报告审核/黄金策 · 规则记忆→trace/token/知识图谱 · 数据库本品(BI)。
 * 新增/调整本域 pane 渲染只改本文件；需要的上下文字段从 TabContext 读取。
 */
export function VizTabs({ ctx }: { ctx: TabContext }) {
  const { activeTab, activeSubTab } = ctx;
  const exploreOrMultiOrZhuanti = activeTab === "explore" || activeTab === "multi" || activeTab === "zhuanti";
  const bump = () => ctx.setArtifactRefreshKey((current) => current + 1);
  return (
    <>
      {exploreOrMultiOrZhuanti && activeSubTab === "report" && (
        <FolderPathsPane scope={ctx.folderScope} folder="report" onPathsChange={ctx.handleReportPathsChange} />
      )}
      {exploreOrMultiOrZhuanti && activeSubTab === "presentation_version" && (
        <PresentationVersionPane scope={ctx.folderScope} model={ctx.model} onGenerated={bump} />
      )}
      {exploreOrMultiOrZhuanti && activeSubTab === "report_review" && (
        <ReportReviewPane scope={ctx.folderScope} model={ctx.model} models={ctx.models} onGenerated={bump} />
      )}
      {activeTab === "explore" && activeSubTab === "golden_strategy" && (
        <GoldenStrategyPane scope={ctx.folderScope?.type === "workspace" ? ctx.folderScope : ctx.folderScope?.type === "session" ? ctx.folderScope : { type: "session", sessionId: ctx.activeSessionId }} models={ctx.models} onGenerated={bump} onNavigateToActions={() => ctx.setActiveSubTab("actions")} />
      )}
      {activeTab === "multi" && activeSubTab === "golden_strategy" && (
        <GoldenStrategyPane scope={ctx.folderScope?.type === "workspace" ? ctx.folderScope : { type: "flow", flow: ctx.activeFlow?.kind === "multi" ? ctx.activeFlow : null }} models={ctx.models} onGenerated={bump} onNavigateToActions={() => ctx.setActiveSubTab("actions")} />
      )}
      {activeTab === "zhuanti" && activeSubTab === "golden_strategy" && (
        <GoldenStrategyPane scope={ctx.folderScope?.type === "workspace" ? ctx.folderScope : { type: "flow", flow: ctx.zhuantiChatFlow?.kind === "multi" ? ctx.zhuantiChatFlow : null }} models={ctx.models} onGenerated={bump} onNavigateToActions={() => ctx.setActiveSubTab("actions")} />
      )}
      {activeTab === "explore" && activeSubTab === "actions" && (
        <ActionsPane scope={ctx.folderScope?.type === "workspace" ? ctx.folderScope : ctx.folderScope?.type === "session" ? ctx.folderScope : { type: "session", sessionId: ctx.activeSessionId }} models={ctx.models} />
      )}
      {activeTab === "multi" && activeSubTab === "actions" && (
        <ActionsPane scope={ctx.folderScope?.type === "workspace" ? ctx.folderScope : { type: "flow", flow: ctx.activeFlow?.kind === "multi" ? ctx.activeFlow : null }} models={ctx.models} />
      )}
      {activeTab === "zhuanti" && activeSubTab === "actions" && (
        <ActionsPane scope={ctx.folderScope?.type === "workspace" ? ctx.folderScope : { type: "flow", flow: ctx.zhuantiChatFlow?.kind === "multi" ? ctx.zhuantiChatFlow : null }} models={ctx.models} />
      )}

      {activeTab === "rule_memory" && activeSubTab === "trace" && (
        <TracePane workspaceId={ctx.activeWorkspaceId} onRulesChanged={() => void ctx.refreshRulesPromptInfo()} />
      )}
      {activeTab === "rule_memory" && activeSubTab === "knowledge_graph" && (
        <KnowledgeGraphPane workspaceId={ctx.activeWorkspaceId} onSynced={() => void ctx.refreshRulesPromptInfo()} />
      )}

      {activeTab === "xan_db" && activeSubTab === "own_product" && (
        <BiDashboardPane workspaceId={ctx.activeWorkspaceId || undefined} />
      )}

      {activeTab === "onto_xanthil" && (activeSubTab === "onto_readme" || activeSubTab === "onto_objects" || activeSubTab === "onto_links" || activeSubTab === "onto_metrics" || activeSubTab === "onto_logic" || activeSubTab === "onto_actions" || activeSubTab === "onto_graph" || activeSubTab === "onto_import") && (
        <OntologyPane workspaceId={ctx.activeWorkspaceId} section={activeSubTab} />
      )}
    </>
  );
}
