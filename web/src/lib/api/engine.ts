// 【Agent-E · 智能引擎域】前端 API 方法 slot —— owner: codex(GPT-5.5)
// 约定: 方法加入 engineApi; 经 api.ts 合并后组件用 api.<name>() 调用。
//   复用请求工具 `import { json } from "./_http"`; 类型从 "@/types" 引入。
import type {
  ForkBranch,
  SkillAutoDistillResult,
  SkillRegistryConflictsResult,
  SkillRegistryCreateBody,
  SkillRegistryEntry,
  SkillRegistryEvaluateBody,
  SkillRegistryEvaluateResult,
  SkillVersionContent,
  SkillStatus,
  SubAgentTask,
  SubAgentTaskInput,
} from "@/types";
import { truncateConflictContent } from "@/lib/skillConflict";
import { json } from "./_http";

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
  // 方式2：AI 改写——把当前 SKILL.md 内容 + 修改说明交给 LLM，返回改写后的内容供预览（不写盘）。
  reviseSkill: (workspaceId: string, body: { content: string; instruction: string; model?: string }) =>
    fetch(`/api/workspaces/${workspaceId}/skill-revise`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }).then(json<{ content: string }>),
};
