import { Database, Store } from "lucide-react";
import { Placeholder } from "@/components/Placeholder";
import { LlmManagementPane } from "@/components/LlmManagementPane";
import { FolderPathsPane } from "@/components/FolderPathsPane";
import { DataExplorationPane } from "@/components/DataExplorationPane";
import { AggregatePane } from "@/components/AggregatePane";
import { ExtractionPane } from "@/components/ExtractionPane";
import { SqlConnectPane } from "@/components/SqlConnectPane";
import { ToolUsePane } from "@/components/ToolUsePane";
import { HooksManagementPane } from "@/components/HooksManagementPane";
import { CommandManagementPane } from "@/components/CommandManagementPane";
import { PluginManagementPane } from "@/components/PluginManagementPane";
import { SubAgentManagementPane } from "@/components/SubAgentManagementPane";
import { SkillManagementPane } from "@/components/SkillManagementPane";
import { RulesPane } from "@/components/RulesPane";
import { BusinessContextPane } from "@/components/BusinessContextPane";
import { IndicatorsPane } from "@/components/IndicatorsPane";
import { WeatherPane } from "@/components/WeatherPane";
import { IndustryPane } from "@/components/IndustryPane";
import { CompetitorPane } from "@/components/CompetitorPane";
import { AggregateReadmePane } from "@/components/AggregateReadmePane";
import type { TabContext } from "./types";

/**
 * 【Agent-D · 数据基座域】tab 渲染模块 —— owner: opencode(deepseek/glm)
 * 覆盖：探索→原始/聚合/数据探索 · 计算工具 · 规则记忆→rules/业务环境/指标/案例 · Xan数据库。
 * 新增/调整本域 pane 渲染只改本文件；需要的上下文字段从 TabContext 读取。
 */
export function DataTabs({ ctx }: { ctx: TabContext }) {
  const { activeTab, activeSubTab } = ctx;
  const exploreOrMulti = activeTab === "explore" || activeTab === "multi";
  const dataScopeTab = exploreOrMulti || activeTab === "zhuanti";
  return (
    <>
      {dataScopeTab && activeSubTab === "draw_data" && (
        <FolderPathsPane scope={ctx.folderScope} folder="draw_data" />
      )}
      {dataScopeTab && activeSubTab === "clean_data" && (
        <FolderPathsPane scope={ctx.folderScope} folder="clean_data" />
      )}
      {dataScopeTab && activeSubTab === "data_exploration" && (
        <DataExplorationPane scope={ctx.folderScope} seed={ctx.exploreSeed} onSeedDismiss={() => ctx.setExploreSeed(null)} />
      )}

      {activeTab === "aggregate" && activeSubTab === "view" && (
        <AggregatePane model={ctx.model} models={ctx.models} />
      )}
      {activeTab === "aggregate" && activeSubTab === "extraction" && (
        <ExtractionPane workspaceId={ctx.activeWorkspaceId} />
      )}
      {activeTab === "aggregate" && activeSubTab === "sql_connect" && (
        <SqlConnectPane workspaceId={ctx.activeWorkspaceId} />
      )}
      {activeTab === "aggregate" && activeSubTab === "tool_use" && (
        <ToolUsePane scope={ctx.folderScope} workspaceId={ctx.activeWorkspaceId} />
      )}
      {activeTab === "aggregate" && activeSubTab === "hooks_mgmt" && (
        <HooksManagementPane />
      )}
      {activeTab === "aggregate" && activeSubTab === "skills_mgmt" && (
        <SkillManagementPane workspaceId={ctx.activeWorkspaceId} model={ctx.model} models={ctx.models} />
      )}
      {activeTab === "aggregate" && activeSubTab === "command_mgmt" && (
        <CommandManagementPane workspaceId={ctx.activeWorkspaceId} />
      )}
      {activeTab === "aggregate" && activeSubTab === "plugin_mgmt" && (
        <PluginManagementPane />
      )}
      {activeTab === "aggregate" && activeSubTab === "subagents_mgmt" && (
        <SubAgentManagementPane />
      )}
      {activeTab === "aggregate" && activeSubTab === "llm_mgmt" && (
        <LlmManagementPane refreshModels={ctx.refreshModels} />
      )}
      {activeTab === "aggregate" && activeSubTab === "readme" && (
        <AggregateReadmePane />
      )}

      {activeTab === "rule_memory" && activeSubTab === "rules" && (
        <RulesPane workspaceId={ctx.activeWorkspaceId} onRulesChanged={() => void ctx.refreshRulesPromptInfo()} />
      )}
      {activeTab === "rule_memory" && activeSubTab === "business_context" && (
        <BusinessContextPane workspaceId={ctx.activeWorkspaceId} onChanged={() => void ctx.refreshRulesPromptInfo()} />
      )}
      {activeTab === "rule_memory" && activeSubTab === "indicators" && (
        <IndicatorsPane workspaceId={ctx.activeWorkspaceId} onStandardsChanged={() => void ctx.refreshRulesPromptInfo()} />
      )}

      {activeTab === "xan_db" && activeSubTab === "the-crowd" && (
        <Placeholder icon={Database} title="the-crowd" hint="人群数据库管理，即将推出" />
      )}
      {activeTab === "xan_db" && activeSubTab === "industry" && (
        <IndustryPane workspaceId={ctx.activeWorkspaceId ?? ""} model={ctx.model} />
      )}
      {activeTab === "xan_db" && activeSubTab === "weather" && <WeatherPane />}
      {activeTab === "xan_db" && activeSubTab === "business_district" && (
        <Placeholder icon={Store} title="商圈" hint="商圈数据管理，即将推出" />
      )}
      {activeTab === "xan_db" && activeSubTab === "competitor" && (
        <CompetitorPane workspaceId={ctx.activeWorkspaceId ?? ""} model={ctx.model} />
      )}
    </>
  );
}
