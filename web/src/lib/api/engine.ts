// 【Agent-E · 智能引擎域】前端 API 方法 slot —— owner: codex(GPT-5.5)
// 约定: 方法加入 engineApi; 经 api.ts 合并后组件用 api.<name>() 调用。
//   复用请求工具 `import { json } from "./_http"`; 类型从 "@/types" 引入。
import type {
  CollectFolder,
  ForkBranch,
  MemoryInjectionRecord,
  MemoryItem,
  MemoryItemListResponse,
  CommandEvalCase,
  CommandEvalSet,
  CommandEvaluation,
  CommandEvaluationDetail,
  DocumentEvalCase,
  DocumentEvalResult,
  EvaluationArchiveResult,
  HookEvalCase,
  HookEvalSet,
  HookEvaluation,
  HookEvaluationDetail,
  LabKind,
  LabTimeline,
  RegressionGateThresholds,
  RegressionGateVerdict,
  PromptEvalSet,
  PromptEvalTask,
  PromptEvaluation,
  PromptEvaluationDetail,
  PromptDraft,
  PromptVariant,
  SkillAutoDistillResult,
  SkillCoverageGapCluster,
  SkillCoverageGapDistillResult,
  SkillCoverageGapResult,
  SkillEvalTask,
  SkillRegistryConflictsResult,
  SkillRegistryCreateBody,
  SkillRegistryEntry,
  SkillRegistryEvaluateBody,
  SkillRegistryEvaluateResult,
  SkillRegistryEvalHistoryResult,
  SkillRegistryRetestActiveResult,
  SkillVersionContent,
  SkillStatus,
  SubAgentEvalCase,
  SubAgentEvalSet,
  SubAgentEvaluation,
  SubAgentEvaluationDetail,
  SubAgentTask,
  SubAgentTaskInput,
  WorkflowAgentsBoard,
} from "@/types";
import { truncateConflictContent } from "@/lib/skillConflict";
import { json } from "./_http";

// 与后端 buildSkillPackage 的响应结构对齐（server/src/routes/engine.ts:1058）。
// 不放入 @/types 是为了把"包格式"作为 E 域内部契约局部化，避免外溢污染。
export interface SkillPackage {
  format: "pi-xanthil.skill-package";
  formatVersion: 1;
  registry: {
    slug: string;
    name: string;
    version: number;
    source: string;
    status: string;
    originSessionId: string | null;
  };
  files: Array<{ path: string; content: string }>;
}

export interface SkillImportResult {
  entry: SkillRegistryEntry;
  skillPath: string;
  requestedSlug: string;
  writtenFiles: string[];
}

// 记忆 v2.0 缺口3 · Dream Worker 维护结果（响应结构对齐 server/src/memory-maintenance.ts:44）。
// 不放入 @/types 是为了把 server 域内部契约局部化，避免 types.ts 接缝层污染。
export type MemoryMaintenanceAction = "promote" | "demote" | "retire";
export interface MemoryMaintenanceChange {
  id: string;
  action: MemoryMaintenanceAction;
  reason: string;
  before: { confidence: number; validUntil: number | null };
  after: { confidence: number; validUntil: number | null };
}
export interface MemoryMaintenanceResult {
  workspaceId: string;
  dryRun: boolean;
  scanned: number;
  changes: MemoryMaintenanceChange[];
  applied: number;
}

// 记忆 v2.0 缺口4 · 从记忆升级 Skill 候选（响应结构对齐 server/src/memory-to-skill.ts:32）。
export interface MemorySkillThresholds {
  highConfidence: number;
  minHighConfidenceItems: number;
  minUsedCount: number;
  minPositiveSignals: number;
}
export interface MemorySkillClusterView {
  tag: string;
  items: MemoryItem[];
  highConfidenceCount: number;
  totalUsedCount: number;
  totalPositiveSignals: number;
  eligible: boolean;
  reasons: string[];
}
export interface MemorySkillPromotionOutcome {
  clusterTag: string;
  result: unknown;
}
export interface MemoryToSkillResult {
  workspaceId: string;
  dryRun: boolean;
  scanned: number;
  clusters: MemorySkillClusterView[];
  eligibleClusters: number;
  promotions: MemorySkillPromotionOutcome[];
}

export interface SessionConsolidationResult {
  count: number;
  candidates: number;
  ingested: number;
  review: number;
  ok: boolean;
  error?: string;
}

export const engineApi = {
  createCollectFolder: (name: string) =>
    fetch(`/api/collect/folders`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name }),
    }).then(json<CollectFolder>),
  renameCollectFolder: (id: string, name: string) =>
    fetch(`/api/collect/folders/${encodeURIComponent(id)}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name }),
    }).then(json<CollectFolder>),
  reorderCollectFolder: (id: string, sort: number) =>
    fetch(`/api/collect/folders/${encodeURIComponent(id)}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sort }),
    }).then(json<CollectFolder>),
  deleteCollectFolder: (id: string) =>
    fetch(`/api/collect/folders/${encodeURIComponent(id)}`, { method: "DELETE" }).then(json<{ ok: boolean }>),
  listPromptEvaluations: (workspaceId: string) =>
    fetch(`/api/workspaces/${encodeURIComponent(workspaceId)}/prompt-evaluations`).then(json<PromptEvaluation[]>),
  getPromptEvaluation: (evaluationId: string) =>
    fetch(`/api/prompt-evaluations/${encodeURIComponent(evaluationId)}`).then(json<PromptEvaluationDetail>),
  runPromptEvaluation: (workspaceId: string, payload: {
    model: string;
    repeat: number;
    judgeRepeat: number;
    variants: PromptVariant[];
    tasks: PromptEvalTask[];
    dataContextPaths?: string[];
  }) => fetch(`/api/workspaces/${encodeURIComponent(workspaceId)}/prompt-evaluations/run`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  }).then(json<PromptEvaluationDetail>),
  listPromptEvalSets: (workspaceId: string) =>
    fetch(`/api/workspaces/${encodeURIComponent(workspaceId)}/prompt-eval-sets`).then(json<PromptEvalSet[]>),
  createPromptEvalSet: (workspaceId: string, payload: { name: string; tasks: PromptEvalTask[] }) =>
    fetch(`/api/workspaces/${encodeURIComponent(workspaceId)}/prompt-eval-sets`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }).then(json<PromptEvalSet>),
  updatePromptEvalSet: (setId: string, payload: { name?: string; tasks?: PromptEvalTask[] }) =>
    fetch(`/api/prompt-eval-sets/${encodeURIComponent(setId)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }).then(json<PromptEvalSet>),
  deletePromptEvalSet: (setId: string) =>
    fetch(`/api/prompt-eval-sets/${encodeURIComponent(setId)}`, { method: "DELETE" }).then(json<{ ok: boolean }>),
  archivePromptEvaluation: (evaluationId: string) =>
    fetch(`/api/prompt-evaluations/${encodeURIComponent(evaluationId)}/archive`, { method: "POST" }).then(json<EvaluationArchiveResult>),
  listCommandEvaluations: (workspaceId: string) =>
    fetch(`/api/workspaces/${encodeURIComponent(workspaceId)}/command-evaluations`).then(json<CommandEvaluation[]>),
  getCommandEvaluation: (evaluationId: string) =>
    fetch(`/api/command-evaluations/${encodeURIComponent(evaluationId)}`).then(json<CommandEvaluationDetail>),
  runCommandEvaluation: (workspaceId: string, payload: {
    commandId: string;
    repeat: number;
    model?: string;
    cases: CommandEvalCase[];
  }) => fetch(`/api/workspaces/${encodeURIComponent(workspaceId)}/command-evaluations/run`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  }).then(json<CommandEvaluationDetail>),
  listCommandCaseSets: (workspaceId: string, commandId?: string) =>
    fetch(`/api/workspaces/${encodeURIComponent(workspaceId)}/command-case-sets${commandId ? `?commandId=${encodeURIComponent(commandId)}` : ""}`).then(json<CommandEvalSet[]>),
  createCommandCaseSet: (workspaceId: string, payload: { name: string; commandId: string; cases: CommandEvalCase[] }) =>
    fetch(`/api/workspaces/${encodeURIComponent(workspaceId)}/command-case-sets`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }).then(json<CommandEvalSet>),
  updateCommandCaseSet: (setId: string, payload: { name?: string; commandId?: string; cases?: CommandEvalCase[] }) =>
    fetch(`/api/command-case-sets/${encodeURIComponent(setId)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }).then(json<CommandEvalSet>),
  deleteCommandCaseSet: (setId: string) =>
    fetch(`/api/command-case-sets/${encodeURIComponent(setId)}`, { method: "DELETE" }).then(json<{ ok: boolean }>),
  archiveCommandEvaluation: (evaluationId: string) =>
    fetch(`/api/command-evaluations/${encodeURIComponent(evaluationId)}/archive`, { method: "POST" }).then(json<EvaluationArchiveResult>),
  listSubAgentEvaluations: (workspaceId: string) =>
    fetch(`/api/workspaces/${encodeURIComponent(workspaceId)}/subagent-evaluations`).then(json<SubAgentEvaluation[]>),
  getSubAgentEvaluation: (evaluationId: string) =>
    fetch(`/api/subagent-evaluations/${encodeURIComponent(evaluationId)}`).then(json<SubAgentEvaluationDetail>),
  runSubAgentEvaluation: (workspaceId: string, payload: { model: string; repeat: number; cases: SubAgentEvalCase[] }) =>
    fetch(`/api/workspaces/${encodeURIComponent(workspaceId)}/subagent-evaluations/run`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }).then(json<SubAgentEvaluationDetail>),
  listSubAgentEvalSets: (workspaceId: string) =>
    fetch(`/api/workspaces/${encodeURIComponent(workspaceId)}/subagent-case-sets`).then(json<SubAgentEvalSet[]>),
  createSubAgentEvalSet: (workspaceId: string, payload: { name: string; cases: SubAgentEvalCase[] }) =>
    fetch(`/api/workspaces/${encodeURIComponent(workspaceId)}/subagent-case-sets`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }).then(json<SubAgentEvalSet>),
  updateSubAgentEvalSet: (setId: string, payload: { name?: string; cases?: SubAgentEvalCase[] }) =>
    fetch(`/api/subagent-case-sets/${encodeURIComponent(setId)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }).then(json<SubAgentEvalSet>),
  deleteSubAgentEvalSet: (setId: string) =>
    fetch(`/api/subagent-case-sets/${encodeURIComponent(setId)}`, { method: "DELETE" }).then(json<{ ok: boolean }>),
  archiveSubAgentEvaluation: (evaluationId: string) =>
    fetch(`/api/subagent-evaluations/${encodeURIComponent(evaluationId)}/archive`, { method: "POST" }).then(json<EvaluationArchiveResult>),
  listHookEvaluations: (workspaceId: string) =>
    fetch(`/api/workspaces/${encodeURIComponent(workspaceId)}/hook-evaluations`).then(json<HookEvaluation[]>),
  getHookEvaluation: (evaluationId: string) =>
    fetch(`/api/hook-evaluations/${encodeURIComponent(evaluationId)}`).then(json<HookEvaluationDetail>),
  runHookEvaluation: (workspaceId: string, payload: { repeat: number; cases: HookEvalCase[] }) =>
    fetch(`/api/workspaces/${encodeURIComponent(workspaceId)}/hook-evaluations/run`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }).then(json<HookEvaluationDetail>),
  listHookEvalSets: (workspaceId: string) =>
    fetch(`/api/workspaces/${encodeURIComponent(workspaceId)}/hook-case-sets`).then(json<HookEvalSet[]>),
  createHookEvalSet: (workspaceId: string, payload: { name: string; cases: HookEvalCase[] }) =>
    fetch(`/api/workspaces/${encodeURIComponent(workspaceId)}/hook-case-sets`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }).then(json<HookEvalSet>),
  updateHookEvalSet: (setId: string, payload: { name?: string; cases?: HookEvalCase[] }) =>
    fetch(`/api/hook-case-sets/${encodeURIComponent(setId)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }).then(json<HookEvalSet>),
  deleteHookEvalSet: (setId: string) =>
    fetch(`/api/hook-case-sets/${encodeURIComponent(setId)}`, { method: "DELETE" }).then(json<{ ok: boolean }>),
  archiveHookEvaluation: (evaluationId: string) =>
    fetch(`/api/hook-evaluations/${encodeURIComponent(evaluationId)}/archive`, { method: "POST" }).then(json<EvaluationArchiveResult>),
  runDocumentEvaluation: (workspaceId: string, payload: { model: string; cases: DocumentEvalCase[] }) =>
    fetch(`/api/workspaces/${encodeURIComponent(workspaceId)}/document-eval/run`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }).then(json<{ resultId: string }>),
  getDocumentEvaluationResult: (workspaceId: string, resultId: string) =>
    fetch(`/api/workspaces/${encodeURIComponent(workspaceId)}/document-eval/results/${encodeURIComponent(resultId)}`).then(json<DocumentEvalResult[]>),
  consolidateSessionTrace: (workspaceId: string, sessionId: string) =>
    fetch(`/api/workspaces/${encodeURIComponent(workspaceId)}/sessions/${encodeURIComponent(sessionId)}/consolidate-trace`, {
      method: "POST",
    }).then(json<SessionConsolidationResult>),
  distillSessionPrompt: (workspaceId: string, sessionId: string) =>
    fetch(`/api/workspaces/${encodeURIComponent(workspaceId)}/sessions/${encodeURIComponent(sessionId)}/distill-prompt`, {
      method: "POST",
    }).then(json<{ draft: PromptDraft | null }>),
  getSessionConsolidationCount: (workspaceId: string, sessionId: string) =>
    fetch(`/api/workspaces/${encodeURIComponent(workspaceId)}/sessions/${encodeURIComponent(sessionId)}/consolidation-count`)
      .then(json<{ count: number }>),
  listLatestInjectedMemoryItems: async (
    workspaceId: string,
    target: { targetKind: "session" | "flow"; targetId: string },
  ): Promise<MemoryItem[]> => {
    const records = await fetch(`/api/workspaces/${workspaceId}/memory/items/_/injections?limit=200`)
      .then(json<MemoryInjectionRecord[]>);
    const latest = records.find((record) => (
      record.targetKind === target.targetKind && record.targetId === target.targetId
    ));
    const itemIds = [...new Set(latest?.snapshot.sources
      .filter((source) => source.kind === "memory_item" && source.injected)
      .flatMap((source) => source.itemIds ?? []) ?? [])];
    if (itemIds.length === 0) return [];

    const response = await fetch(`/api/workspaces/${workspaceId}/memory/items`)
      .then(json<MemoryItemListResponse>);
    const byId = new Map(response.items.map((item) => [item.id, item]));
    return itemIds.flatMap((itemId) => {
      const item = byId.get(itemId);
      return item ? [item] : [];
    });
  },
  recordInjectedMemoryFeedback: (
    workspaceId: string,
    itemId: string,
    signal: "positive" | "negative",
  ) =>
    fetch(`/api/workspaces/${workspaceId}/memory/items/${encodeURIComponent(itemId)}/feedback`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ signal }),
    }).then(json<MemoryItem>),
  forkSession: (sessionId: string, title?: string) =>
    fetch(`/api/sessions/${sessionId}/fork`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title }),
    }).then(json<ForkBranch>),
  listForkBranches: (sessionId: string) =>
    fetch(`/api/sessions/${sessionId}/fork-branches`).then(json<ForkBranch[]>),
  renameForkBranch: (branchSessionId: string, title: string) =>
    fetch(`/api/fork-branches/${branchSessionId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title }),
    }).then(json<ForkBranch>),
  delegateSubAgent: (sessionId: string, input: SubAgentTaskInput) =>
    fetch(`/api/sessions/${sessionId}/delegate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
    }).then(json<SubAgentTask>),
  listSubAgentTasks: (sessionId: string) =>
    fetch(`/api/sessions/${sessionId}/subagent-tasks`).then(json<SubAgentTask[]>),
  listAllSubAgentTasks: (params?: { limit?: number; workspaceId?: string; status?: SubAgentTask["status"] }) => {
    const q = new URLSearchParams();
    if (params?.limit !== undefined) q.set("limit", String(params.limit));
    if (params?.workspaceId) q.set("workspaceId", params.workspaceId);
    if (params?.status) q.set("status", params.status);
    const qs = q.toString();
    return fetch(`/api/subagent-tasks${qs ? `?${qs}` : ""}`).then(json<SubAgentTask[]>);
  },
  getSubAgentTask: (taskId: string) =>
    fetch(`/api/subagent-tasks/${taskId}`).then(json<SubAgentTask>),
  listWorkflowAgents: (workspaceId?: string) => {
    const qs = workspaceId ? `?workspaceId=${encodeURIComponent(workspaceId)}` : "";
    return fetch(`/api/workflow-agents${qs}`).then(json<WorkflowAgentsBoard>);
  },
  abortSubAgent: (taskId: string) =>
    fetch(`/api/subagent-tasks/${taskId}/abort`, { method: "POST" }).then(json<{ ok: true }>),
  resumeSubAgent: (taskId: string, input: { correction?: string; correctedResult?: string; model?: string; templateId?: string }) =>
    fetch(`/api/subagent-tasks/${taskId}/resume`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
    }).then(json<{ ok: true; task: SubAgentTask }>),

  // ---- Skill Registry（D 域 SkillManagementPane 跨域调 E 端点；端点以卡2 为契约） ----
  listSkillRegistry: (workspaceId: string, status?: SkillStatus) => {
    const qs = status ? `?status=${encodeURIComponent(status)}` : "";
    return fetch(`/api/workspaces/${workspaceId}/skill-registry${qs}`).then(json<SkillRegistryEntry[]>);
  },
  // P1-B：冲突 API（A 域端点）。slug 与 content 至少给一个；不阻断 UI，仅展示决策提示。
  // content 走 GET querystring 有 URL 长度上限（浏览器/反向代理通常 8KB），前端先截断防 414。
  listSkillConflicts: (workspaceId: string, query: { slug?: string; content?: string }) => {
    const params = new URLSearchParams();
    if (query.slug) params.set("slug", query.slug);
    if (query.content) params.set("content", truncateConflictContent(query.content));
    const qs = params.toString();
    return fetch(`/api/workspaces/${workspaceId}/skill-registry/conflicts${qs ? `?${qs}` : ""}`).then(
      json<SkillRegistryConflictsResult>,
    );
  },
  createSkillRegistry: (workspaceId: string, body: SkillRegistryCreateBody) =>
    fetch(`/api/workspaces/${workspaceId}/skill-registry`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }).then(json<{ entry: SkillRegistryEntry; skillPath: string }>),
  // P1-B：信任门——active + source∈{distilled,curated} 必须 confirmed=true，否则 A 端 400。
  patchSkillRegistry: (
    id: string,
    patch: {
      name?: string;
      status?: SkillStatus;
      version?: number;
      supersedesId?: string | null;
      confirmed?: boolean;
    },
  ) =>
    fetch(`/api/skill-registry/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(patch),
    }).then(json<SkillRegistryEntry>),
  archiveSkillRegistry: (id: string) =>
    fetch(`/api/skill-registry/${id}`, { method: "DELETE" }).then(json<SkillRegistryEntry>),
  evaluateSkillRegistry: (id: string, body: SkillRegistryEvaluateBody) =>
    fetch(`/api/skill-registry/${id}/evaluate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }).then(json<SkillRegistryEvaluateResult>),
  // P1-a：读历史版本内容快照 / 回滚到某版本（以该版本内容创建新版本写回 SKILL.md）。
  getSkillVersionContent: (id: string) =>
    fetch(`/api/skill-registry/${id}/content`).then(json<SkillVersionContent>),
  rollbackSkillRegistry: (id: string) =>
    fetch(`/api/skill-registry/${id}/rollback`, { method: "POST" }).then(json<SkillRegistryEntry>),
  // B 卡：手动一键触发自动沉淀 sweep（替代定时）。不传 body → 端点默认 since=近7天 / limit=5 / 继承 pi 默认模型。
  // 产物恒为 distilled candidate，守人审门；前端调完刷新列表即可看到新候选。
  runSkillAutoDistill: (
    workspaceId: string,
    body?: { since?: number | string; limit?: number; model?: string; dryRun?: boolean },
  ) =>
    fetch(`/api/workspaces/${workspaceId}/skill-auto-distill`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body ?? {}),
    }).then(json<SkillAutoDistillResult>),
  analyzeSkillCoverageGaps: (
    workspaceId: string,
    body?: { since?: number | string; limit?: number; lowScoreThreshold?: number; minClusterSize?: number },
  ) =>
    fetch(`/api/workspaces/${workspaceId}/skill-coverage-gaps`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body ?? {}),
    }).then(json<SkillCoverageGapResult>),
  distillSkillCoverageGap: (
    workspaceId: string,
    body: { cluster: SkillCoverageGapCluster; model?: string; dryRun?: boolean },
  ) =>
    fetch(`/api/workspaces/${workspaceId}/skill-coverage-gaps/distill`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }).then(json<SkillCoverageGapDistillResult>),
  // 方式2：AI 改写——把当前 SKILL.md 内容 + 修改说明交给 LLM，返回改写后的内容供预览（不写盘）。
  reviseSkill: (workspaceId: string, body: { content: string; instruction: string; model?: string }) =>
    fetch(`/api/workspaces/${workspaceId}/skill-revise`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }).then(json<{ content: string }>),

  // 缺口2：skill 跨工作区移植。导出 = 单 JSON 包（含 SKILL.md + references/scripts 等子资源全文）；
  // 导入 = 工作区写盘 + 建 imported candidate（守人审门，需走查看/评测/采纳走完漏斗）。
  // slug 冲突由后端自动改名为 slug-2…（前端展示 requestedSlug vs entry.slug 给改名提示）。
  exportSkill: (id: string) =>
    fetch(`/api/skill-registry/${id}/export`, { method: "POST" }).then(json<SkillPackage>),
  importSkill: (workspaceId: string, pkg: SkillPackage) =>
    fetch(`/api/workspaces/${workspaceId}/skill-registry/import`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(pkg),
    }).then(json<SkillImportResult>),

  // G 卡（消费 C 后端）：重测全部 active skill。每个 active skill 跑一次评测，端点强依赖 model+tasks 必填。
  // 前端复用「送评测」EvalSet 的 tasks 拼装；triggerKind 默认 retest_all_active，model_upgrade 由 UI 显式传。
  // 注意：会真实调用 LLM，前端在调用前需二次确认（成本 = active skill 数 × 单次评测）。
  retestActiveSkills: (
    workspaceId: string,
    body: {
      model: string;
      tasks: SkillEvalTask[];
      repeat?: number;
      judgeRepeat?: number;
      contextPrefix?: string;
      triggerKind?: "retest_all_active" | "model_upgrade";
    },
  ) =>
    fetch(`/api/workspaces/${workspaceId}/skill-registry/retest-active`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }).then(json<SkillRegistryRetestActiveResult>),
  // G 卡：回归/漂移历史时间线（消费 skill_registry_eval_history 真源，只读）。
  // workspaceId 必填；slug/registryId 可选筛选。limit 默认 200，前端常用 ≤100 渲染时间线。
  listSkillEvalHistory: (
    workspaceId: string,
    query?: { slug?: string; registryId?: string; limit?: number },
  ) => {
    const params = new URLSearchParams();
    if (query?.slug) params.set("slug", query.slug);
    if (query?.registryId) params.set("registryId", query.registryId);
    if (query?.limit) params.set("limit", String(query.limit));
    const qs = params.toString();
    return fetch(`/api/workspaces/${workspaceId}/skill-registry/eval-history${qs ? `?${qs}` : ""}`).then(
      json<SkillRegistryEvalHistoryResult>,
    );
  },

  // 跨 lab 回归看板 + CI gate (Phase5 P5-2)
  listLabTimelines: (
    workspaceId: string,
    query?: { lab?: LabKind; resourceId?: string },
  ) => {
    const params = new URLSearchParams();
    if (query?.lab) params.set("lab", query.lab);
    if (query?.resourceId) params.set("resourceId", query.resourceId);
    const qs = params.toString();
    return fetch(`/api/workspaces/${workspaceId}/lab-timelines${qs ? `?${qs}` : ""}`).then(
      json<LabTimeline[]>,
    );
  },

  evaluateLabRegressionGate: (
    workspaceId: string,
    body: { lab: LabKind; resourceId: string; thresholds?: Partial<RegressionGateThresholds> },
  ) =>
    fetch(`/api/workspaces/${workspaceId}/lab-regression-gate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }).then(json<RegressionGateVerdict>),

  // 记忆 v2.0 缺口3 · Dream Worker 手动触发：纯算术维护（升/降 confidence、老化退役），零 LLM。
  // dryRun=true 仅返回拟调整明细不落库；dryRun=false 真实写库。
  maintainMemory: (workspaceId: string, body?: { dryRun?: boolean }) =>
    fetch(`/api/workspaces/${encodeURIComponent(workspaceId)}/memory/maintain`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body ?? {}),
    }).then(json<MemoryMaintenanceResult>),

  // 记忆 v2.0 缺口4 · 把高频 experience 簇升级为 Skill 候选（status=candidate，不自动启用）。
  // dryRun=true 仅列 eligible 簇 + 升级依据；dryRun=false 真实蒸馏候选入 registry。
  // 注意：thresholds 字段需平铺到 body 根（与 server parseMemorySkillPromotionBody 对齐）。
  promoteMemorySkills: (
    workspaceId: string,
    body?: {
      dryRun?: boolean;
      maxPromotions?: number;
      model?: string;
      timeoutMs?: number;
      duplicateThreshold?: number;
      highConfidence?: number;
      minHighConfidenceItems?: number;
      minUsedCount?: number;
      minPositiveSignals?: number;
    },
  ) =>
    fetch(`/api/workspaces/${encodeURIComponent(workspaceId)}/memory/promote-skills`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body ?? {}),
    }).then(json<MemoryToSkillResult>),
};
