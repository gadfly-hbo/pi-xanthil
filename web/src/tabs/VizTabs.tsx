import { OntologyPane } from "@/components/OntologyPane";
import { QuickNotesPane } from "@/components/QuickNotesPane";
import { FolderPathsPane } from "@/components/FolderPathsPane";
import { PresentationVersionPane } from "@/components/PresentationVersionPane";
import { ReportReviewPane } from "@/components/ReportReviewPane";
import { GoldenStrategyPane } from "@/components/GoldenStrategyPane";
import { ActionsPane } from "@/components/ActionsPane";
import { TracePane } from "@/components/TracePane";
import { TokenStatsPane } from "@/components/TokenStatsPane";
import { KnowledgeGraphPane } from "@/components/KnowledgeGraphPane";
import { BiDashboardPane } from "@/components/BiDashboardPane";
import { ReportHistoryPane } from "@/components/ReportHistoryPane";
import { ModelRunHistoryDashboard } from "@/components/ModelRunHistoryDashboard";
import type { TabContext } from "./types";

/**
 * 【Agent-V · 可视交付域】tab 渲染模块 —— owner: antigravity(Gemini)
 * 覆盖：探索→报告输出/汇报版本/报告审核/黄金策 · 规则记忆→trace/token/知识图谱 · Dashboard。
 * 新增/调整本域 pane 渲染只改本文件；需要的上下文字段从 TabContext 读取。
 */
export function VizTabs({ ctx }: { ctx: TabContext }) {
  const { activeTab, activeSubTab } = ctx;
  const exploreOrMulti = activeTab === "explore" || activeTab === "multi";
  const bump = () => ctx.setArtifactRefreshKey((current) => current + 1);
  return (
    <>
      {exploreOrMulti && activeSubTab === "report" && (
        <FolderPathsPane scope={ctx.folderScope} folder="report" onPathsChange={ctx.handleReportPathsChange} />
      )}
      {exploreOrMulti && activeSubTab === "presentation_version" && (
        <PresentationVersionPane scope={ctx.folderScope} model={ctx.model} onGenerated={bump} />
      )}
      {exploreOrMulti && activeSubTab === "report_review" && (
        <ReportReviewPane scope={ctx.folderScope} model={ctx.model} models={ctx.models} onGenerated={bump} />
      )}
      {activeTab === "explore" && activeSubTab === "golden_strategy" && (
        <GoldenStrategyPane scope={ctx.folderScope?.type === "workspace" ? ctx.folderScope : ctx.folderScope?.type === "session" ? ctx.folderScope : { type: "session", sessionId: ctx.activeSessionId }} models={ctx.models} onGenerated={bump} onNavigateToActions={() => ctx.setActiveSubTab("actions")} />
      )}
      {activeTab === "multi" && activeSubTab === "golden_strategy" && (
        <GoldenStrategyPane scope={ctx.folderScope?.type === "workspace" ? ctx.folderScope : { type: "flow", flow: ctx.activeFlow?.kind === "multi" ? ctx.activeFlow : null }} models={ctx.models} onGenerated={bump} onNavigateToActions={() => ctx.setActiveSubTab("actions")} />
      )}
      {activeTab === "explore" && activeSubTab === "actions" && (
        <ActionsPane scope={ctx.folderScope?.type === "workspace" ? ctx.folderScope : ctx.folderScope?.type === "session" ? ctx.folderScope : { type: "session", sessionId: ctx.activeSessionId }} models={ctx.models} />
      )}
      {activeTab === "multi" && activeSubTab === "actions" && (
        <ActionsPane scope={ctx.folderScope?.type === "workspace" ? ctx.folderScope : { type: "flow", flow: ctx.activeFlow?.kind === "multi" ? ctx.activeFlow : null }} models={ctx.models} />
      )}

      {activeTab === "rule_memory" && activeSubTab === "trace" && (
        <TracePane workspaceId={ctx.activeWorkspaceId} onRulesChanged={() => void ctx.refreshRulesPromptInfo()} />
      )}
      {activeTab === "rule_memory" && activeSubTab === "token_stats" && (
        <TokenStatsPane workspaceId={ctx.activeWorkspaceId} />
      )}
      {activeTab === "rule_memory" && activeSubTab === "quick_notes" && (
        <QuickNotesPane />
      )}
      {activeTab === "rule_memory" && activeSubTab === "knowledge_graph" && (
        <KnowledgeGraphPane workspaceId={ctx.activeWorkspaceId} onSynced={() => void ctx.refreshRulesPromptInfo()} />
      )}

      {activeTab === "dashboard" && activeSubTab === "view" && <BiDashboardPane workspaceId={ctx.activeWorkspaceId || undefined} />}
      {activeTab === "dashboard" && activeSubTab === "report_history" && <ReportHistoryPane />}
      {activeTab === "dashboard" && activeSubTab === "model_history" && (
        <ModelRunHistoryDashboard onRequestRestore={ctx.handleRequestRestoreRun} />
      )}

      {activeTab === "onto_xanthil" && (activeSubTab === "onto_readme" || activeSubTab === "onto_objects" || activeSubTab === "onto_links" || activeSubTab === "onto_metrics" || activeSubTab === "onto_logic" || activeSubTab === "onto_actions" || activeSubTab === "onto_graph" || activeSubTab === "onto_import") && (
        <OntologyPane workspaceId={ctx.activeWorkspaceId} section={activeSubTab} />
      )}
    </>
  );
}
