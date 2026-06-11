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
import type { BiAggregationDataset, BiAggregationData, IndustryIntel, CompetitorIntel } from "@/types";

export const dataApi = {
  getBiAggregations: (workspaceId: string) =>
    fetch(`/api/bi/aggregations?workspaceId=${encodeURIComponent(workspaceId)}`).then(json<BiAggregationDataset[]>),

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
};
