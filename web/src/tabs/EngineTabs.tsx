import { FlaskConical } from "lucide-react";
import { Placeholder } from "@/components/Placeholder";
import { ChatPane } from "@/components/ChatPane";
import { BusinessRequirementPane } from "@/components/BusinessRequirementPane";
import { MultiAgentExecutionPane } from "@/components/MultiAgentExecutionPane";
import { ResearchLabPane } from "@/components/ResearchLabPane";
import { SkillLabPane } from "@/components/SkillLabPane";
import { ToolLabPane } from "@/components/ToolLabPane";
import { ModelLabPane } from "@/components/ModelLabPane";
import { AnaXPane } from "@/components/AnaXPane";
import { HypothesisPane } from "@/components/HypothesisPane";
import { ChangeManagementPane } from "@/components/ChangeManagementPane";
import { AnaXReadmePane } from "@/components/AnaXReadmePane";
import type { TabContext } from "./types";

/**
 * 【Agent-E · 智能引擎域】tab 渲染模块 —— owner: codex(GPT-5.5)
 * 覆盖：探索→对话/业务需求 · 工作流 · 实验室(skill/tool/model/DLF) · AnaX。
 * 新增/调整本域 pane 渲染只改本文件；需要的上下文字段从 TabContext 读取。
 */
export function EngineTabs({ ctx }: { ctx: TabContext }) {
  const { activeTab, activeSubTab } = ctx;
  return (
    <>
      {activeTab === "explore" && activeSubTab === "view" && (
        <ChatPane
          messages={ctx.messages}
          running={ctx.running}
          disabled={!ctx.activeSessionId}
          workspaceId={ctx.activeWorkspaceId}
          folderScope={ctx.folderScope}
          model={ctx.model}
          models={ctx.models}
          onModelChange={ctx.setModel}
          onSend={ctx.onSend}
          onStop={ctx.onStop}
          runtime={ctx.runtime}
          compacting={ctx.compacting}
          runtimeNotice={ctx.runtimeNotice}
          onCompact={() => void ctx.compactContext()}
          onRefreshRuntime={() => void ctx.refreshRuntime()}
          canPromoteToWorkflow={ctx.canPromoteToWorkflow}
          onPromoteToWorkflow={ctx.openPromote}
          canDistillSkill={ctx.canPromoteToWorkflow}
          onDistillSkill={ctx.openDistill}
        />
      )}
      {(activeTab === "explore" || activeTab === "multi") && activeSubTab === "business_requirement" && (
        <BusinessRequirementPane
          scope={ctx.folderScope}
          model={ctx.model}
          onGenerated={() => ctx.setArtifactRefreshKey((current) => current + 1)}
          onBusinessContextChanged={() => void ctx.refreshRulesPromptInfo()}
          onExploreFields={(fieldHints, source) => { ctx.setExploreSeed({ fieldHints, source }); ctx.setActiveSubTab("data_exploration"); }}
        />
      )}

      {activeTab === "multi" && activeSubTab === "view" && (
        <MultiAgentExecutionPane
          flow={ctx.activeFlow?.kind === "multi" ? ctx.activeFlow : null}
          models={ctx.models}
          model={ctx.model}
          onModelChange={ctx.setModel}
          rulesPromptEnabled={ctx.rulesPromptEnabled}
        />
      )}

      {activeTab === "research_lab" && activeSubTab === "view" && (
        <ResearchLabPane workspaceId={ctx.activeWorkspaceId} flows={ctx.flows} model={ctx.model} models={ctx.models} onModelChange={ctx.setModel} />
      )}
      {activeTab === "research_lab" && activeSubTab === "skill" && (
        <SkillLabPane workspaceId={ctx.activeWorkspaceId} model={ctx.model} models={ctx.models} onModelChange={ctx.setModel} />
      )}
      {activeTab === "research_lab" && activeSubTab === "tool" && (
        <ToolLabPane workspaceId={ctx.activeWorkspaceId} model={ctx.model} models={ctx.models} />
      )}
      {activeTab === "research_lab" && activeSubTab === "model" && (
        <ModelLabPane model={ctx.model} models={ctx.models} mode="all" restoreRunId={ctx.pendingRestoreRunId} onRestoreConsumed={ctx.handleRestoreConsumed} />
      )}
      {activeTab === "research_lab" && activeSubTab === "dlf" && (
        <Placeholder icon={FlaskConical} title="DLF" hint="DLF 模块管理，即将推出" />
      )}

      {activeTab === "anax" && activeSubTab === "view" && (
        <AnaXPane workspaceId={ctx.activeWorkspaceId} model={ctx.model} models={ctx.models} rulesPromptEnabled={ctx.rulesPromptEnabled} />
      )}
      {activeTab === "anax" && activeSubTab === "hypothesis" && (
        <HypothesisPane workspaceId={ctx.activeWorkspaceId} />
      )}
      {activeTab === "anax" && activeSubTab === "change_mgmt" && (
        <ChangeManagementPane workspaceId={ctx.activeWorkspaceId} />
      )}
      {activeTab === "anax" && activeSubTab === "readme" && <AnaXReadmePane />}
    </>
  );
}
