import { useState } from "react";
import { Database, Store } from "lucide-react";
import { Placeholder } from "@/components/Placeholder";
import { LlmManagementPane } from "@/components/LlmManagementPane";
import { TokenStatsPane } from "@/components/TokenStatsPane";
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
import { PromptsManagementPane } from "@/components/PromptsManagementPane";
import { RulesPane } from "@/components/RulesPane";
import { BusinessContextPane } from "@/components/BusinessContextPane";
import { IndicatorsPane } from "@/components/IndicatorsPane";
import { WeatherPane } from "@/components/WeatherPane";
import { IndustryPane } from "@/components/IndustryPane";
import { CompetitorPane } from "@/components/CompetitorPane";
import { AggregateReadmePane } from "@/components/AggregateReadmePane";
import { XanDbReadmePane } from "@/components/XanDbReadmePane";
import { MemoryReadmePane } from "@/components/MemoryReadmePane";
import { KnowledgeBasePane } from "@/components/KnowledgeBasePane";
import { KnowledgeBaseReadmePane } from "@/components/KnowledgeBaseReadmePane";
import { cn } from "@/lib/cn";
import type { TabContext } from "./types";

/**
 * 【Agent-D · 数据基座域】tab 渲染模块 —— owner: opencode(deepseek/glm)
 * 覆盖：探索→原始/数据提取/聚合计算/聚合数据/数据探索 · 控制 · 规则记忆→rules/业务环境/指标 · 数据库（含 SQL连接）。
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
      {dataScopeTab && activeSubTab === "extraction" && (
        <ExtractionPane workspaceId={ctx.activeWorkspaceId} />
      )}
      {dataScopeTab && activeSubTab === "aggregate_compute" && (
        <AggregatePane model={ctx.model} models={ctx.models} />
      )}
      {dataScopeTab && activeSubTab === "clean_data" && (
        <FolderPathsPane scope={ctx.folderScope} folder="clean_data" />
      )}
      {dataScopeTab && activeSubTab === "data_exploration" && (
        <DataExplorationPane scope={ctx.folderScope} seed={ctx.exploreSeed} onSeedDismiss={() => ctx.setExploreSeed(null)} />
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
        <LlmWithTokenStats workspaceId={ctx.activeWorkspaceId} refreshModels={ctx.refreshModels} />
      )}
      {activeTab === "aggregate" && activeSubTab === "prompts_mgmt" && (
        <PromptsManagementPane workspaceId={ctx.activeWorkspaceId} />
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
      {activeTab === "rule_memory" && activeSubTab === "readme" && (
        <MemoryReadmePane />
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
      {activeTab === "xan_db" && activeSubTab === "sql_connect" && (
        <SqlConnectPane workspaceId={ctx.activeWorkspaceId} />
      )}
      {activeTab === "xan_db" && activeSubTab === "readme" && (
        <XanDbReadmePane />
      )}

      {/* 知识库（D-PANEL · 2026-06-19，V-agent 已停用前端归 D 承接） */}
      {activeTab === "knowledge_base" && activeSubTab === "kb_docs" && (
        <KnowledgeBasePane workspaceId={ctx.activeWorkspaceId} view="docs" onDocsChanged={() => void ctx.refreshKnowledgePromptInfo()} />
      )}
      {activeTab === "knowledge_base" && activeSubTab === "kb_search" && (
        <KnowledgeBasePane workspaceId={ctx.activeWorkspaceId} view="search" />
      )}
      {activeTab === "knowledge_base" && activeSubTab === "readme" && (
        <KnowledgeBaseReadmePane />
      )}
    </>
  );
}

// LLM管理 与 token统计 在「控制 / LLM管理」子 tab 内通过 mini-tab 互斥渲染。
function LlmWithTokenStats({ workspaceId, refreshModels }: { workspaceId: string | null; refreshModels?: () => void }) {
  const [view, setView] = useState<"llm" | "token">("llm");
  const items = [
    { id: "llm" as const, label: "LLM管理" },
    { id: "token" as const, label: "token统计" },
  ];
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-9 shrink-0 items-center gap-1 border-b border-neutral-200 px-3 dark:border-neutral-800">
        {items.map((t) => (
          <button
            key={t.id}
            onClick={() => setView(t.id)}
            className={cn(
              "inline-flex h-7 items-center rounded-md px-2.5 text-[12px] transition-colors",
              view === t.id
                ? "bg-neutral-100 font-medium text-neutral-900 dark:bg-neutral-800 dark:text-neutral-100"
                : "text-neutral-500 hover:bg-neutral-100 hover:text-neutral-900 dark:text-neutral-400 dark:hover:bg-neutral-800/60 dark:hover:text-neutral-100",
            )}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div className="flex min-h-0 flex-1">
        {view === "llm" ? (
          <LlmManagementPane refreshModels={refreshModels} />
        ) : (
          <TokenStatsPane workspaceId={workspaceId} />
        )}
      </div>
    </div>
  );
}
