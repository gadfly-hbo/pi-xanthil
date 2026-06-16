// 【Agent-E · 智能引擎域】前端 API 方法 slot —— owner: codex(GPT-5.5)
// 约定: 方法加入 engineApi; 经 api.ts 合并后组件用 api.<name>() 调用。
//   复用请求工具 `import { json } from "./_http"`; 类型从 "@/types" 引入。
import type {
  ForkBranch,
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
  SubAgentTask,
  SubAgentTaskInput,
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

export const engineApi = {
  forkSession: (sessionId: string, title?: string) =>
    fetch(`/api/sessions/${sessionId}/fork`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title }),
    }).then(json<ForkBranch>),
  listForkBranches: (sessionId: string) =>
    fetch(`/api/sessions/${sessionId}/fork-branches`).then(json<ForkBranch[]>),
  delegateSubAgent: (sessionId: string, input: SubAgentTaskInput) =>
    fetch(`/api/sessions/${sessionId}/delegate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
    }).then(json<SubAgentTask>),
  listSubAgentTasks: (sessionId: string) =>
    fetch(`/api/sessions/${sessionId}/subagent-tasks`).then(json<SubAgentTask[]>),
  getSubAgentTask: (taskId: string) =>
    fetch(`/api/subagent-tasks/${taskId}`).then(json<SubAgentTask>),
  abortSubAgent: (taskId: string) =>
    fetch(`/api/subagent-tasks/${taskId}/abort`, { method: "POST" }).then(json<{ ok: true }>),

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
};
