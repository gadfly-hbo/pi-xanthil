import { Database, Store } from "lucide-react";
import { Placeholder } from "@/components/Placeholder";
import { FolderPathsPane } from "@/components/FolderPathsPane";
import { DataExplorationPane } from "@/components/DataExplorationPane";
import { AggregatePane } from "@/components/AggregatePane";
import { ExtractionPane } from "@/components/ExtractionPane";
import { SqlConnectPane } from "@/components/SqlConnectPane";
import { RulesPane } from "@/components/RulesPane";
import { BusinessContextPane } from "@/components/BusinessContextPane";
import { IndicatorsPane } from "@/components/IndicatorsPane";
import { CasesPane } from "@/components/CasesPane";
import { WeatherPane } from "@/components/WeatherPane";
import type { TabContext } from "./types";

/**
 * 【Agent-D · 数据基座域】tab 渲染模块 —— owner: opencode(deepseek/glm)
 * 覆盖：探索→原始/聚合/数据探索 · 计算工具 · 规则记忆→rules/业务环境/指标/案例 · Xan数据库。
 * 新增/调整本域 pane 渲染只改本文件；需要的上下文字段从 TabContext 读取。
 */
export function DataTabs({ ctx }: { ctx: TabContext }) {
  const { activeTab, activeSubTab } = ctx;
  const exploreOrMulti = activeTab === "explore" || activeTab === "multi";
  return (
    <>
      {exploreOrMulti && activeSubTab === "draw_data" && (
        <FolderPathsPane scope={ctx.folderScope} folder="draw_data" />
      )}
      {exploreOrMulti && activeSubTab === "clean_data" && (
        <FolderPathsPane scope={ctx.folderScope} folder="clean_data" />
      )}
      {exploreOrMulti && activeSubTab === "data_exploration" && (
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

      {activeTab === "rule_memory" && activeSubTab === "rules" && (
        <RulesPane workspaceId={ctx.activeWorkspaceId} onRulesChanged={() => void ctx.refreshRulesPromptInfo()} />
      )}
      {activeTab === "rule_memory" && activeSubTab === "business_context" && (
        <BusinessContextPane workspaceId={ctx.activeWorkspaceId} onChanged={() => void ctx.refreshRulesPromptInfo()} />
      )}
      {activeTab === "rule_memory" && activeSubTab === "indicators" && (
        <IndicatorsPane workspaceId={ctx.activeWorkspaceId} onStandardsChanged={() => void ctx.refreshRulesPromptInfo()} />
      )}
      {activeTab === "rule_memory" && activeSubTab === "cases" && (
        <CasesPane workspaceId={ctx.activeWorkspaceId} onChanged={() => void ctx.refreshRulesPromptInfo()} />
      )}

      {activeTab === "xan_db" && activeSubTab === "the-crowd" && (
        <Placeholder icon={Database} title="the-crowd" hint="人群数据库管理，即将推出" />
      )}
      {activeTab === "xan_db" && activeSubTab === "industry" && (
        <Placeholder icon={Database} title="行业" hint="行业数据管理，即将推出" />
      )}
      {activeTab === "xan_db" && activeSubTab === "weather" && <WeatherPane />}
      {activeTab === "xan_db" && activeSubTab === "business_district" && (
        <Placeholder icon={Store} title="商圈" hint="商圈数据管理，即将推出" />
      )}
      {activeTab === "xan_db" && activeSubTab === "competitor" && (
        <Placeholder icon={Database} title="竞品" hint="竞品数据管理，即将推出" />
      )}
    </>
  );
}
