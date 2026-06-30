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
  MemoryItem,
  MemoryItemType,
  MemoryItemListResponse,
  MemoryPromptPreview,
  MemoryReview,
  MemoryReviewStatus,
  MemoryRiskFlag,
  KnowledgeDoc,
  KnowledgeChunk,
  KnowledgeDocPatch,
  KnowledgeChunkHit,
  KnowledgeDocSearchResult,
  PromptTemplate,
  PromptTemplateInput,
  PromptTemplatePatch,
  SystemPromptOverview,
  CrowdDataset,
  CrowdTagDictionaryEntry,
  CrowdSegment,
  CrowdSegmentRuleGroup,
  CrowdProfile,
  CrowdProfileVersion,
  CrowdProfileFeedback,
  CrowdSubAgentDraft,
  OkhMetricConflict,
  OkhMetricTemplate,
  OkhMetricTemplatePack,
  OkhStandardHealth,
  OkhTemplateApplyResult,
  OkhTemplateScenario,
  OkhMetricImportPreview,
  OkhMetricImportCommitResult,
  OkhMetricOntologyLink,
} from "@/types";

type CrowdTagDictionaryEntryInput = Pick<
  CrowdTagDictionaryEntry,
  "field" | "label" | "description" | "dimension" | "sensitivity" | "weight" | "valueLabels" | "enabled"
>;

type AggregateImportResult = { dataset: CrowdDataset; tagDictionary: CrowdTagDictionaryEntry[]; segments: CrowdSegment[] };

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

// MCP 管理：pi 已配置的 MCP servers 清单（与 PluginInfo 并列的另一类扩展）。
// 来源/字段与 server routes/data.ts 的 McpServerInfo 同源。envKeys 仅变量名、无值。
export type McpTransport = "stdio" | "remote";
export interface McpServerInfo {
  id: string;
  name: string;
  source: "global" | "project";
  transport: McpTransport;
  detail: string;
  envKeys: string[];
  enabled: boolean;
}

// 记忆老化信号（D-AGING2 · 2026-06-27）—— 与 server memory-aging-signals.ts 同形态。
// 仅在本域消费 + 跨域 HTTP 暴露，故不上提接缝层 types.ts。
export type AgingSignalSeverity = "info" | "warn" | "critical";
export type AgingConflictReason = "high-similarity" | "confidence-divergence" | "signal-divergence";
export interface AgingConflictPair {
  pairId: string;
  itemAId: string;
  itemBId: string;
  itemATitle: string;
  itemBTitle: string;
  type: MemoryItemType;
  similarity: number;
  sharedTags: string[];
  reasons: AgingConflictReason[];
  severity: AgingSignalSeverity;
}
export interface AgingStaleReference {
  newerId: string;
  newerTitle: string;
  olderId: string;
  olderTitle: string;
  olderStillActive: boolean;
  referencerIds: string[];
  referencerTitles: string[];
  severity: AgingSignalSeverity;
}
export interface MemoryAgingSignalsResult {
  workspaceId: string;
  generatedAt: number;
  scanned: number;
  truncated: boolean;
  conflicts: AgingConflictPair[];
  staleRefs: AgingStaleReference[];
}

// 子技能提案（D-SAFEDISTILL1 · 2026-06-27）—— 与 server db/data.ts SkillProposal 同形态。
// 红线：本类型只承载已脱敏的骨架/元数据；evidence 内容不应含 draw_data 原始行。
// 跨域消费走 HTTP（E-SUBSKILL1/E-SKILLINJECT1），故不上提接缝层 types.ts。
export type SkillProposalStatus = "pending" | "approved" | "rejected";
export interface SkillProposalEvidence {
  occurrences: number;
  skeleton: string;
  targets: string[];
  reportPaths: string[];
  topologyKinds: Record<string, number>;
}
export interface SkillProposal {
  id: string;
  workspaceId: string;
  signature: string;
  draftTitle: string;
  draftBody: string;
  evidence: SkillProposalEvidence;
  status: SkillProposalStatus;
  decidedSkillId: string | null;
  decidedReason: string;
  createdAt: number;
  updatedAt: number;
}
export interface SkillProposalScanResult {
  generated: number;
  summary: { created: number; refreshed: number; skipped: number };
  items: Array<{ kind: "created" | "refreshed" | "skipped"; id: string; signature: string }>;
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
      caller?: "chat" | "mcp" | "command" | "subagent" | "workflow" | "eval" | "unknown";
      targetKind?: string;
      targetId?: string;
    },
  ) =>
    fetch(`/api/extraction-tools/${encodeURIComponent(id)}/run`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...payload, source: "ai", caller: payload.caller ?? "chat" }),
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

  // MCP 清单只读；envKeys 仅变量名（server 侧已剥离 env 值，防 key 外泄）。
  listMcpServers: () => fetch("/api/mcp-servers").then(json<McpServerInfo[]>),

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

  // ---- 统一记忆 memory_items（规则记忆重构 v2 · D-DATA/D-INGEST）----
  // 路径策略：/memory/items* + /memory/reviews* + /memory/preview，全部走 dataRouter；
  // legacy /api/rules /api/cases 仍在 index.ts 暂留至切面切换完成。
  listMemoryItems: (
    workspaceId: string,
    options: { type?: MemoryItemType; enabledOnly?: boolean; includeFacts?: boolean } = {},
  ) => {
    const q = new URLSearchParams();
    if (options.type) q.set("type", options.type);
    if (options.enabledOnly) q.set("enabledOnly", "1");
    if (options.includeFacts) q.set("includeFacts", "1");
    const qs = q.toString();
    return fetch(`/api/workspaces/${workspaceId}/memory/items${qs ? `?${qs}` : ""}`).then(json<MemoryItemListResponse>);
  },

  createMemoryItem: (
    workspaceId: string,
    payload: {
      type: MemoryItemType;
      title: string;
      body: string;
      tags?: string[];
      scope?: "global" | "chat" | "workflow";
      sourceEventIds?: string[];
      confidence?: number;
      riskFlags?: MemoryRiskFlag[];
      validUntil?: number | null;
      supersedesId?: string | null;
      staleAfterDays?: number;
    },
  ) =>
    fetch(`/api/workspaces/${workspaceId}/memory/items`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }).then(json<MemoryItem>),

  updateMemoryItem: (
    workspaceId: string,
    itemId: string,
    patch: Partial<{
      type: MemoryItemType;
      title: string;
      body: string;
      tags: string[];
      scope: "global" | "chat" | "workflow";
      enabled: boolean;
      confidence: number;
      riskFlags: MemoryRiskFlag[];
      sourceEventIds: string[];
      validUntil: number | null;
      supersedesId: string | null;
      staleAfterDays: number;
    }>,
  ) =>
    fetch(`/api/workspaces/${workspaceId}/memory/items/${encodeURIComponent(itemId)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    }).then(json<MemoryItem>),

  deleteMemoryItem: (workspaceId: string, itemId: string) =>
    fetch(`/api/workspaces/${workspaceId}/memory/items/${encodeURIComponent(itemId)}`, {
      method: "DELETE",
    }).then(json<{ ok: boolean }>),

  recordMemoryItemFeedback: (workspaceId: string, itemId: string, signal: "positive" | "negative") =>
    fetch(`/api/workspaces/${workspaceId}/memory/items/${encodeURIComponent(itemId)}/feedback`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ signal }),
    }).then(json<MemoryItem>),

  previewMemoryPrompt: (workspaceId: string, options: { targetScope?: "chat" | "workflow"; query?: string; tags?: string[] } = {}) => {
    const q = new URLSearchParams();
    if (options.targetScope) q.set("targetScope", options.targetScope);
    if (options.query) q.set("query", options.query);
    if (options.tags) for (const t of options.tags) q.append("tag", t);
    const qs = q.toString();
    return fetch(`/api/workspaces/${workspaceId}/memory/preview${qs ? `?${qs}` : ""}`).then(json<MemoryPromptPreview>);
  },

  listMemoryReviews: (workspaceId: string, status?: MemoryReviewStatus) =>
    fetch(`/api/workspaces/${workspaceId}/memory/reviews${status ? `?status=${status}` : ""}`).then(json<MemoryReview[]>),

  acceptMemoryReview: (workspaceId: string, reviewId: string) =>
    fetch(`/api/workspaces/${workspaceId}/memory/reviews/${encodeURIComponent(reviewId)}/accept`, {
      method: "POST",
    }).then(json<{ review: MemoryReview; item: MemoryItem }>),

  rejectMemoryReview: (workspaceId: string, reviewId: string, reason = "") =>
    fetch(`/api/workspaces/${workspaceId}/memory/reviews/${encodeURIComponent(reviewId)}/reject`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reason }),
    }).then(json<MemoryReview>),

  // D-AGING2 老化信号 GET（read-only）。RulesPane 展示 + E-AGING1 巡检 HTTP 消费同一端点。
  fetchMemoryAgingSignals: (workspaceId: string) =>
    fetch(`/api/workspaces/${encodeURIComponent(workspaceId)}/memory/aging-signals`)
      .then(json<MemoryAgingSignalsResult>),

  // ---- onto-knowhow · 指标模板池 + 治理（D-OKH1 / D-OKH2） ----
  listMetricTemplates: (workspaceId: string, scenario?: OkhTemplateScenario) => {
    const qs = scenario ? `?scenario=${encodeURIComponent(scenario)}` : "";
    return fetch(`/api/workspaces/${encodeURIComponent(workspaceId)}/onto-knowhow/templates${qs}`)
      .then(json<{ packs: OkhMetricTemplatePack[]; templates: OkhMetricTemplate[] }>);
  },

  applyMetricTemplates: (workspaceId: string, payload: { packId?: string; templateIds?: string[]; enable?: boolean }) =>
    fetch(`/api/workspaces/${encodeURIComponent(workspaceId)}/onto-knowhow/templates/apply`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }).then(json<OkhTemplateApplyResult>),

  getMetricConflicts: (workspaceId: string, includeDisabled = false) =>
    fetch(`/api/workspaces/${encodeURIComponent(workspaceId)}/onto-knowhow/conflicts${includeDisabled ? "?includeDisabled=true" : ""}`)
      .then(json<OkhMetricConflict[]>),

  getStandardFileHealth: (workspaceId: string) =>
    fetch(`/api/workspaces/${encodeURIComponent(workspaceId)}/onto-knowhow/standard-health`)
      .then(json<OkhStandardHealth[]>),

  checkStandardFileHealth: (workspaceId: string, standardIds?: string[]) =>
    fetch(`/api/workspaces/${encodeURIComponent(workspaceId)}/onto-knowhow/standard-health/check`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ standardIds }),
    }).then(json<OkhStandardHealth[]>),

  previewOkhMetricImport: (workspaceId: string, payload: { content: string; format: "csv" | "json"; filename?: string }) =>
    fetch(`/api/workspaces/${encodeURIComponent(workspaceId)}/onto-knowhow/import/preview`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }).then(json<OkhMetricImportPreview>),

  commitOkhMetricImport: (
    workspaceId: string,
    payload: { rows: unknown[]; enable?: boolean; conflictPolicy: "skip" | "create_version" },
  ) =>
    fetch(`/api/workspaces/${encodeURIComponent(workspaceId)}/onto-knowhow/import/commit`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }).then(json<OkhMetricImportCommitResult>),

  exportOkhMetrics: (workspaceId: string, options: { format?: "csv" | "json"; enabledOnly?: boolean } = {}) => {
    const q = new URLSearchParams();
    q.set("format", options.format ?? "csv");
    if (options.enabledOnly === false) q.set("enabledOnly", "false");
    return fetch(`/api/workspaces/${encodeURIComponent(workspaceId)}/onto-knowhow/export?${q.toString()}`);
  },

  listOkhMetricOntologyLinks: (workspaceId: string, metricId: string) =>
    fetch(`/api/workspaces/${encodeURIComponent(workspaceId)}/onto-knowhow/metrics/${encodeURIComponent(metricId)}/ontology-links`)
      .then(json<OkhMetricOntologyLink[]>),

  listOkhMetricOntologyLinksByTarget: (workspaceId: string, ontologyId: string, targetKind: OkhMetricOntologyLink["targetKind"], targetId: string) =>
    fetch(`/api/workspaces/${encodeURIComponent(workspaceId)}/onto-knowhow/ontologies/${encodeURIComponent(ontologyId)}/targets/${encodeURIComponent(targetKind)}/${encodeURIComponent(targetId)}/metric-links`)
      .then(json<OkhMetricOntologyLink[]>),

  listOkhMetricOntologyLinksByOntology: (workspaceId: string, ontologyId: string) =>
    fetch(`/api/workspaces/${encodeURIComponent(workspaceId)}/onto-knowhow/ontologies/${encodeURIComponent(ontologyId)}/metric-links`)
      .then(json<OkhMetricOntologyLink[]>),

  replaceOkhMetricOntologyLinks: (
    workspaceId: string,
    metricId: string,
    links: Array<{ ontologyId: string; targetKind: "object" | "link" | "logic"; targetId: string }>,
  ) =>
    fetch(`/api/workspaces/${encodeURIComponent(workspaceId)}/onto-knowhow/metrics/${encodeURIComponent(metricId)}/ontology-links`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ links }),
    }).then(json<OkhMetricOntologyLink[]>),

  deleteOkhMetricOntologyLink: (workspaceId: string, linkId: string) =>
    fetch(`/api/workspaces/${encodeURIComponent(workspaceId)}/onto-knowhow/metric-ontology-links/${encodeURIComponent(linkId)}`, {
      method: "DELETE",
    }).then(json<{ ok: boolean }>),

  // ---- 子技能提案 skill_proposals（D-SAFEDISTILL1 · Safe Distiller，2026-06-27） ----
  // 红线卡：输入永远是 SQL 骨架 + trace 元数据 + 报告文件名（零 draw_data 原始行）。
  // 跨域消费走 HTTP（E-SUBSKILL1/E-SKILLINJECT1 GET 同一端点），故类型不上提接缝层。
  scanSkillProposals: (workspaceId: string, options: { windowDays?: number; occurrenceThreshold?: number } = {}) =>
    fetch(`/api/workspaces/${encodeURIComponent(workspaceId)}/skill-proposals/scan`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(options),
    }).then(json<SkillProposalScanResult>),

  listSkillProposals: (workspaceId: string, status?: SkillProposalStatus) =>
    fetch(
      `/api/workspaces/${encodeURIComponent(workspaceId)}/skill-proposals${status ? `?status=${status}` : ""}`,
    ).then(json<SkillProposal[]>),

  approveSkillProposal: (
    workspaceId: string,
    proposalId: string,
    body: { title?: string; body?: string } = {},
  ) =>
    fetch(
      `/api/workspaces/${encodeURIComponent(workspaceId)}/skill-proposals/${encodeURIComponent(proposalId)}/approve`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      },
    ).then(json<{ proposal: SkillProposal; skill: { entry?: { id?: string } } }>),

  rejectSkillProposal: (workspaceId: string, proposalId: string, reason = "") =>
    fetch(
      `/api/workspaces/${encodeURIComponent(workspaceId)}/skill-proposals/${encodeURIComponent(proposalId)}/reject`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason }),
      },
    ).then(json<SkillProposal>),


  // ---- 知识库 knowledge_docs/chunks（D-DATA + D-RETRIEVAL · 2026-06-19） ----
  // 文档=用户上传/登记的非结构化资料（folder kind 'knowledge'），与 draw_data 严格隔离。
  // 检索 = workspace 范围内 BM25 召回。所有端点 ownership 由 server 校验（403 跨 ws）。
  listKnowledgeDocs: (workspaceId: string) =>
    fetch(`/api/workspaces/${encodeURIComponent(workspaceId)}/knowledge`).then(json<KnowledgeDoc[]>),

  createKnowledgeDoc: (
    workspaceId: string,
    payload: { title: string; content: string; sourceType?: "upload" | "path"; path?: string | null; tags?: string[]; scope?: "global" | "workspace" },
  ) =>
    fetch(`/api/workspaces/${encodeURIComponent(workspaceId)}/knowledge`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }).then(json<KnowledgeDoc>),

  getKnowledgeDoc: (workspaceId: string, docId: string) =>
    fetch(`/api/workspaces/${encodeURIComponent(workspaceId)}/knowledge/${encodeURIComponent(docId)}`)
      .then(json<{ doc: KnowledgeDoc; chunks: KnowledgeChunk[] }>),

  updateKnowledgeDoc: (workspaceId: string, docId: string, patch: KnowledgeDocPatch) =>
    fetch(`/api/workspaces/${encodeURIComponent(workspaceId)}/knowledge/${encodeURIComponent(docId)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    }).then(json<KnowledgeDoc>),

  deleteKnowledgeDoc: (workspaceId: string, docId: string) =>
    fetch(`/api/workspaces/${encodeURIComponent(workspaceId)}/knowledge/${encodeURIComponent(docId)}`, {
      method: "DELETE",
    }).then(json<{ ok: boolean }>),

  searchKnowledge: (
    workspaceId: string,
    query: string,
    options: { topK?: number; docIds?: string[]; minScore?: number } = {},
  ) =>
    fetch(`/api/workspaces/${encodeURIComponent(workspaceId)}/knowledge/search`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query, ...options }),
    }).then(json<{ hits: KnowledgeChunkHit[] }>),

  // D-KB1 doc 级聚合检索（E-KB3 搜索面板消费）。topK 默认 10，最大 50。
  searchKnowledgeDocs: (workspaceId: string, query: string, topK = 10) => {
    const q = new URLSearchParams({ q: query, topK: String(topK) });
    return fetch(`/api/workspaces/${encodeURIComponent(workspaceId)}/knowledge/search?${q.toString()}`)
      .then(json<{ results: KnowledgeDocSearchResult[] }>);
  },

  // ---- prompts 管理 prompt_templates / system-prompts（D-DATA · prompts_mgmt） ----
  // D-POOL1: 纯全局池——list 返回全部模板(workspaceId=null=全局恒启用; 非NULL=池条目按 enablement)。
  // includeGlobal 参数保留兼容(已弃用,服务端忽略),系统 prompt 聚合 GET /api/prompts/system 是只读快照。
  listPromptTemplates: (
    workspaceId: string,
    options: { category?: string; tags?: string[]; includeGlobal?: boolean } = {},
  ) => {
    const q = new URLSearchParams();
    if (options.category) q.set("category", options.category);
    if (options.tags) for (const t of options.tags) q.append("tag", t);
    if (options.includeGlobal === false) q.set("includeGlobal", "0");
    const qs = q.toString();
    return fetch(`/api/workspaces/${encodeURIComponent(workspaceId)}/prompt-templates${qs ? `?${qs}` : ""}`)
      .then(json<PromptTemplate[]>);
  },

  createPromptTemplate: (workspaceId: string, payload: PromptTemplateInput) =>
    fetch(`/api/workspaces/${encodeURIComponent(workspaceId)}/prompt-templates`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }).then(json<PromptTemplate>),

  updatePromptTemplate: (workspaceId: string, templateId: string, patch: PromptTemplatePatch) =>
    fetch(
      `/api/workspaces/${encodeURIComponent(workspaceId)}/prompt-templates/${encodeURIComponent(templateId)}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      },
    ).then(json<PromptTemplate>),

  deletePromptTemplate: (workspaceId: string, templateId: string) =>
    fetch(
      `/api/workspaces/${encodeURIComponent(workspaceId)}/prompt-templates/${encodeURIComponent(templateId)}`,
      { method: "DELETE" },
    ).then(json<{ ok: boolean }>),

  listSystemPromptOverviews: () =>
    fetch("/api/prompts/system").then(json<SystemPromptOverview[]>),

  // ---- 监测初始化导入（D-MONITOR6 · X-MONITOR5 口径） ----
  // 单入口：数据库连接 → clean_data/monitor/，返回 pathId 可直接绑定到 monitor_configs.datasetBindings。
  // 列表：仅监测专用 clean_data，不暴露工作区其他 clean_data。
  importMonitorSql: (
    workspaceId: string,
    payload: {
      connectionId: string;
      datasetName: string;
      sql?: string;
      tableName?: string;
      format?: "csv" | "json";
    },
  ) =>
    fetch(`/api/workspaces/${encodeURIComponent(workspaceId)}/monitor/import-sql`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }).then(
      json<{
        pathId: string;
        name: string;
        path: string;
        columns: string[];
        rowCount: number;
        format: "csv" | "json";
      }>,
    ),

  listMonitorImports: (workspaceId: string) =>
    fetch(`/api/workspaces/${encodeURIComponent(workspaceId)}/monitor/imports`).then(
      json<BiAggregationDataset[]>,
    ),

  // ---- 数据库 · the-crowd（X-CROWD0 契约，D-CROWD1 实装） ----
  // 红线：这些接口返回聚合摘要、标签字典、画像侧写与版本；不得返回原始行级标签明细供 LLM 使用。

  // -- datasets --
  listCrowdDatasets: (workspaceId: string) =>
    fetch(`/api/workspaces/${encodeURIComponent(workspaceId)}/crowd/datasets`).then(json<CrowdDataset[]>),

  createCrowdDataset: (workspaceId: string, payload: { name: string; source?: string; rowCount?: number; fieldCount?: number; fieldProfiles?: CrowdDataset["fieldProfiles"] }) =>
    fetch(`/api/workspaces/${encodeURIComponent(workspaceId)}/crowd/datasets`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }).then(json<CrowdDataset>),

  importCrowdDataset: (workspaceId: string, file: File, name?: string) => {
    const fd = new FormData();
    fd.append("file", file);
    if (name) fd.append("name", name);
    return fetch(`/api/workspaces/${encodeURIComponent(workspaceId)}/crowd/datasets/import`, {
      method: "POST",
      body: fd,
    }).then(json<CrowdDataset>);
  },

  importCrowdDatasetFromSql: (workspaceId: string, payload: { connectionId: string; sql: string; name?: string }) =>
    fetch(`/api/workspaces/${encodeURIComponent(workspaceId)}/crowd/datasets/import-sql`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }).then(json<CrowdDataset>),

  getCrowdDataset: (workspaceId: string, datasetId: string) =>
    fetch(`/api/workspaces/${encodeURIComponent(workspaceId)}/crowd/datasets/${encodeURIComponent(datasetId)}`).then(json<CrowdDataset>),

  updateCrowdDataset: (workspaceId: string, datasetId: string, patch: Record<string, unknown>) =>
    fetch(`/api/workspaces/${encodeURIComponent(workspaceId)}/crowd/datasets/${encodeURIComponent(datasetId)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    }).then(json<CrowdDataset>),

  deleteCrowdDataset: (workspaceId: string, datasetId: string) =>
    fetch(`/api/workspaces/${encodeURIComponent(workspaceId)}/crowd/datasets/${encodeURIComponent(datasetId)}?confirm=true`, {
      method: "DELETE",
    }).then(json<{ deleted: boolean }>),

  // -- templates / demo downloads (D-CROWD10) --
  getCrowdTemplate: (name: string) =>
    fetch(`/api/crowd/templates/${encodeURIComponent(name)}`),

  listCrowdTagDictionary: (workspaceId: string, datasetId: string) =>
    fetch(
      `/api/workspaces/${encodeURIComponent(workspaceId)}/crowd/datasets/${encodeURIComponent(datasetId)}/tag-dictionary`,
    ).then(json<CrowdTagDictionaryEntry[]>),

  saveCrowdTagDictionary: (workspaceId: string, datasetId: string, entries: CrowdTagDictionaryEntryInput[]) =>
    fetch(
      `/api/workspaces/${encodeURIComponent(workspaceId)}/crowd/datasets/${encodeURIComponent(datasetId)}/tag-dictionary`,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ entries }),
      },
    ).then(json<CrowdTagDictionaryEntry[]>),

  // -- segments --
  listCrowdSegments: (workspaceId: string, datasetId?: string) => {
    const qs = datasetId ? `?datasetId=${encodeURIComponent(datasetId)}` : "";
    return fetch(`/api/workspaces/${encodeURIComponent(workspaceId)}/crowd/segments${qs}`).then(json<CrowdSegment[]>);
  },

  createCrowdSegment: (
    workspaceId: string,
    payload: { datasetId: string; name: string; description?: string; rule?: CrowdSegmentRuleGroup },
  ) =>
    fetch(`/api/workspaces/${encodeURIComponent(workspaceId)}/crowd/segments`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }).then(json<CrowdSegment>),

  getCrowdSegment: (workspaceId: string, segmentId: string) =>
    fetch(`/api/workspaces/${encodeURIComponent(workspaceId)}/crowd/segments/${encodeURIComponent(segmentId)}`).then(json<CrowdSegment>),

  updateCrowdSegment: (workspaceId: string, segmentId: string, patch: Record<string, unknown>) =>
    fetch(`/api/workspaces/${encodeURIComponent(workspaceId)}/crowd/segments/${encodeURIComponent(segmentId)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    }).then(json<CrowdSegment>),

  deleteCrowdSegment: (workspaceId: string, segmentId: string) =>
    fetch(`/api/workspaces/${encodeURIComponent(workspaceId)}/crowd/segments/${encodeURIComponent(segmentId)}?confirm=true`, {
      method: "DELETE",
    }).then(json<{ deleted: boolean }>),

  copyCrowdSegment: (workspaceId: string, segmentId: string, name?: string) =>
    fetch(`/api/workspaces/${encodeURIComponent(workspaceId)}/crowd/segments/${encodeURIComponent(segmentId)}/copy`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    }).then(json<CrowdSegment>),

  previewCrowdSegment: (workspaceId: string, datasetId: string, rule: CrowdSegmentRuleGroup) =>
    fetch(`/api/workspaces/${encodeURIComponent(workspaceId)}/crowd/segments/preview`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ datasetId, rule }),
    }).then(json<{ sampleCount: number; coverageRatio: number; tagDistribution: CrowdSegment["tagDistribution"]; errors: Array<{ field: string; message: string }> }>),

  // -- aggregate import + auto defaults (E-CROWD11) --
  importCrowdAggregate: (workspaceId: string, file: File, name?: string) => {
    const form = new FormData();
    form.append("file", file);
    if (name) form.append("name", name);
    const url = `/api/workspaces/${encodeURIComponent(workspaceId)}/crowd/datasets/import-aggregate`;
    return fetch(url, { method: "POST", body: form }).then(json<AggregateImportResult>);
  },

  autoTagDictionary: (workspaceId: string, datasetId: string) =>
    fetch(`/api/workspaces/${encodeURIComponent(workspaceId)}/crowd/datasets/${encodeURIComponent(datasetId)}/auto-tag-dictionary`, {
      method: "POST",
    }).then(json<CrowdTagDictionaryEntry[]>),

  createDefaultCrowdSegment: (workspaceId: string, datasetId: string) =>
    fetch(`/api/workspaces/${encodeURIComponent(workspaceId)}/crowd/datasets/${encodeURIComponent(datasetId)}/default-segment`, {
      method: "POST",
    }).then(json<CrowdSegment>),

  // -- profiles --
  listCrowdProfiles: (workspaceId: string, segmentId?: string) => {
    const qs = segmentId ? `?segmentId=${encodeURIComponent(segmentId)}` : "";
    return fetch(`/api/workspaces/${encodeURIComponent(workspaceId)}/crowd/profiles${qs}`).then(json<CrowdProfile[]>);
  },

  createCrowdProfile: (workspaceId: string, payload: { segmentId: string; name: string; status?: string }) =>
    fetch(`/api/workspaces/${encodeURIComponent(workspaceId)}/crowd/profiles`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }).then(json<CrowdProfile>),

  getCrowdProfile: (workspaceId: string, profileId: string) =>
    fetch(`/api/workspaces/${encodeURIComponent(workspaceId)}/crowd/profiles/${encodeURIComponent(profileId)}`).then(json<CrowdProfile>),

  updateCrowdProfile: (workspaceId: string, profileId: string, patch: Record<string, unknown>) =>
    fetch(`/api/workspaces/${encodeURIComponent(workspaceId)}/crowd/profiles/${encodeURIComponent(profileId)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    }).then(json<CrowdProfile>),

  deleteCrowdProfile: (workspaceId: string, profileId: string) =>
    fetch(`/api/workspaces/${encodeURIComponent(workspaceId)}/crowd/profiles/${encodeURIComponent(profileId)}?confirm=true`, {
      method: "DELETE",
    }).then(json<{ deleted: boolean }>),

  // -- profile versions --
  listCrowdProfileVersions: (workspaceId: string, profileId: string) =>
    fetch(
      `/api/workspaces/${encodeURIComponent(workspaceId)}/crowd/profiles/${encodeURIComponent(profileId)}/versions`,
    ).then(json<CrowdProfileVersion[]>),

  createCrowdProfileVersion: (workspaceId: string, profileId: string, payload: { content: CrowdProfileVersion["content"]; source?: string; sourceFeedbackId?: string }) =>
    fetch(
      `/api/workspaces/${encodeURIComponent(workspaceId)}/crowd/profiles/${encodeURIComponent(profileId)}/versions`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      },
    ).then(json<CrowdProfileVersion>),

  getCrowdProfileVersion: (workspaceId: string, profileId: string, versionId: string) =>
    fetch(
      `/api/workspaces/${encodeURIComponent(workspaceId)}/crowd/profiles/${encodeURIComponent(profileId)}/versions/${encodeURIComponent(versionId)}`,
    ).then(json<CrowdProfileVersion>),

  // -- subagent draft --
  createCrowdSubAgentDraft: (workspaceId: string, profileId: string, versionId: string) =>
    fetch(
      `/api/workspaces/${encodeURIComponent(workspaceId)}/crowd/profiles/${encodeURIComponent(profileId)}/versions/${encodeURIComponent(versionId)}/subagent-draft`,
      { method: "POST" },
    ).then(json<CrowdSubAgentDraft>),

  // -- feedback --
  listCrowdProfileFeedback: (workspaceId: string, profileId: string) =>
    fetch(
      `/api/workspaces/${encodeURIComponent(workspaceId)}/crowd/profiles/${encodeURIComponent(profileId)}/feedback`,
    ).then(json<CrowdProfileFeedback[]>),

  createCrowdProfileFeedback: (workspaceId: string, profileId: string, payload: { profileVersionId: string; sourceRunId?: string; sourceLifeFormId?: string; objections?: string[]; acceptanceConditions?: string[]; suggestions?: string[] }) =>
    fetch(
      `/api/workspaces/${encodeURIComponent(workspaceId)}/crowd/profiles/${encodeURIComponent(profileId)}/feedback`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      },
    ).then(json<CrowdProfileFeedback>),

  updateCrowdProfileFeedbackStatus: (workspaceId: string, profileId: string, feedbackId: string, status: "adopted" | "rejected") =>
    fetch(
      `/api/workspaces/${encodeURIComponent(workspaceId)}/crowd/profiles/${encodeURIComponent(profileId)}/feedback/${encodeURIComponent(feedbackId)}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      },
    ).then(json<CrowdProfileFeedback>),

  adoptCrowdProfileFeedback: (workspaceId: string, profileId: string, feedbackId: string) =>
    fetch(
      `/api/workspaces/${encodeURIComponent(workspaceId)}/crowd/profiles/${encodeURIComponent(profileId)}/feedback/${encodeURIComponent(feedbackId)}/adopt`,
      { method: "POST" },
    ).then(json<{ version: CrowdProfileVersion; profile: CrowdProfile }>),

  rollbackCrowdProfile: (workspaceId: string, profileId: string, versionId: string) =>
    fetch(
      `/api/workspaces/${encodeURIComponent(workspaceId)}/crowd/profiles/${encodeURIComponent(profileId)}/rollback?confirm=true`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ versionId }),
      },
    ).then(json<CrowdProfile>),
};
