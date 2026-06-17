// 【Agent-D · 数据基座域】前端 API 方法 slot —— owner: opencode(deepseek/glm)
// 约定:
//   - 方法加入 dataApi 对象; 经 api.ts 合并后, 组件照常用 api.<name>() 调用
//   - 复用请求工具: `import { json } from "./_http"`
//   - 类型从 "@/types" 引入
// 示例:
//   import { json } from "./_http";
//   export const dataApi = {
//     listMetrics: () => fetch("/api/metrics").then(json<Metric[]>),
//   };

import { json } from "./_http";
import type {
  BiAggregationDataset,
  BiAggregationData,
  IndustryIntel,
  CompetitorIntel,
  ExtractionTool,
  ExtractionRun,
  ToolEvalCaseTemplateList,
  Hook,
  HookTriggerRecord,
  XanCommand,
  SubAgentTemplate,
} from "@/types";

// 插件管理：pi 已加载扩展/包清单条目（模块本地类型，仅本域消费故不上提接缝层）。
// 来源 source 与 server routes/data.ts 的 PluginInfo 同源。
export type PluginSource = "package" | "global" | "project" | "local";
export interface PluginInfo {
  id: string;
  name: string;
  source: PluginSource;
  enabled: boolean;
  path?: string;
}

export const dataApi = {
  getBiAggregations: (workspaceId: string) =>
    fetch(`/api/bi/aggregations?workspaceId=${encodeURIComponent(workspaceId)}`).then(json<BiAggregationDataset[]>),

  // ---- 计算工具 · tool-use（仅调用既有 /api/extraction-tools*，不改接缝层）----
  listExtractionTools: () =>
    fetch("/api/extraction-tools").then(json<ExtractionTool[]>),

  getToolTestCases: (id: string) =>
    fetch(`/api/extraction-tools/${encodeURIComponent(id)}/test-cases`).then(json<ToolEvalCaseTemplateList>),

  runExtractionTool: (
    id: string,
    inputPath: string,
    outputPath: string,
    params?: Record<string, string | number | boolean>,
    workspaceId?: string,
  ) =>
    fetch(`/api/extraction-tools/${encodeURIComponent(id)}/run`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ inputPath, outputPath, params, workspaceId }),
    }).then(json<ExtractionRun>),

  runAnalysisTool: (
    id: string,
    payload: {
      workspaceId: string;
      inputPath: string;
      outputPath: string;
      params?: Record<string, string | number | boolean>;
    },
  ) =>
    fetch(`/api/extraction-tools/${encodeURIComponent(id)}/run`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...payload, source: "ai" }),
    }).then(json<ExtractionRun>),

  getBiAggregationData: (pathId: string, limit?: number) => {
    const params = new URLSearchParams();
    if (limit !== undefined) params.set("limit", String(limit));
    const qs = params.toString();
    return fetch(`/api/bi/aggregations/${encodeURIComponent(pathId)}/data${qs ? `?${qs}` : ""}`).then(json<BiAggregationData>);
  },

  // Xan 数据库 · 行业/竞品情报 (pi agent 联网检索生成)
  analyzeIndustry: (workspaceId: string, industry: string, model?: string) =>
    fetch(`/api/workspaces/${encodeURIComponent(workspaceId)}/industry/analyze`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ industry, model }),
    }).then(json<IndustryIntel>),

  analyzeCompetitor: (workspaceId: string, brand: string, competitors: string[], model?: string) =>
    fetch(`/api/workspaces/${encodeURIComponent(workspaceId)}/competitor/analyze`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ brand, competitors, model }),
    }).then(json<CompetitorIntel>),

  // ---- 计算工具 · 插件管理 + hooks 管理 ----
  // 插件清单只读；hooks 整体覆盖式写入 hooks.json；触发流水读 hooks-triggers.jsonl。
  // 数据安全：UI 不提供任何外发(HTTP)动作入口；server 也会拒收。block/mutate 仅 tool_call 事件。
  listPlugins: () => fetch("/api/plugins").then(json<PluginInfo[]>),

  listHooks: () => fetch("/api/hooks").then(json<Hook[]>),

  saveHooks: (hooks: Hook[]) =>
    fetch("/api/hooks", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(hooks),
    }).then(json<Hook[]>),

  listHookTriggers: (params?: { limit?: number; hookId?: string; event?: string }) => {
    const q = new URLSearchParams();
    if (params?.limit !== undefined) q.set("limit", String(params.limit));
    if (params?.hookId) q.set("hookId", params.hookId);
    if (params?.event) q.set("event", params.event);
    const qs = q.toString();
    return fetch(`/api/hooks/triggers${qs ? `?${qs}` : ""}`).then(json<HookTriggerRecord[]>);
  },

  // ---- 计算工具 · command 管理（commands.json 注册表，由 server expand 真源） ----
  // 全量覆盖式 PUT；server 端 coerceCommand 会丢弃非法/重复项（id/name 唯一）。
  listCommands: () => fetch("/api/commands").then(json<XanCommand[]>),

  saveCommands: (commands: XanCommand[]) =>
    fetch("/api/commands", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(commands),
    }).then(json<XanCommand[]>),

  // ---- 计算工具 · subagents 管理（subagents.json 模板表，server coerce 真源）----
  // 全量覆盖式 PUT；server coerceSubAgentTemplate 会丢弃非法项（id/name/persona 必填、persona 含外链拒收、
  // dataScope 强制为 "clean_data"、source 强制为 "custom"、maxRetries clamp 到 0~5、toolIds 去重）。
  listSubAgents: () => fetch("/api/subagents").then(json<SubAgentTemplate[]>),

  saveSubAgents: (templates: SubAgentTemplate[]) =>
    fetch("/api/subagents", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(templates),
    }).then(json<SubAgentTemplate[]>),
};
