// 【总控 · 共享域】前端 API 方法 slot —— owner: Claude(总控)
// 跨域基础设施 API (workspaces / workspace-paths / models / llm / 记忆启用关系 等)。仅总控写。
import { json } from "./_http";
import type {
  LlmAuthStatus,
  LlmProviderInput,
  LlmProviderView,
  LlmSettingsView,
  LlmTestResult,
  MemoryItemKind,
  WorkspaceMemoryEnablement,
} from "@/types";

export const sharedApi = {
  // 全局池 + 按工作区启用：列出/切换某工作区对池条目的启用关系。
  listMemoryEnablements: (workspaceId: string, kind?: MemoryItemKind) =>
    fetch(`/api/workspaces/${workspaceId}/memory-enablements${kind ? `?kind=${kind}` : ""}`).then(
      json<WorkspaceMemoryEnablement[]>,
    ),
  setMemoryEnablement: (workspaceId: string, itemKind: MemoryItemKind, itemId: string, enabled: boolean) =>
    fetch(`/api/workspaces/${workspaceId}/memory-enablements`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ itemKind, itemId, enabled }),
    }).then(json<{ ok: boolean }>),

  // 计算工具·LLM 接入管理（直写 pi 全局真源；apiKey 不回显）。详见 docs/LLM管理模块设计方案.md。
  // 后端路由由 E 卡在 routes/shared.ts 实现；此为接缝 client 骨架。
  listLlmProviders: () => fetch("/api/llm/providers").then(json<LlmProviderView[]>),
  saveLlmProviders: (providers: LlmProviderInput[]) =>
    fetch("/api/llm/providers", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(providers),
    }).then(json<LlmProviderView[]>),
  testLlmProvider: (id: string) =>
    fetch(`/api/llm/providers/${encodeURIComponent(id)}/test`, { method: "POST" }).then(json<LlmTestResult>),
  getLlmSettings: () => fetch("/api/llm/settings").then(json<LlmSettingsView>),
  saveLlmSettings: (patch: LlmSettingsView) =>
    fetch("/api/llm/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    }).then(json<LlmSettingsView>),
  listLlmAuth: () => fetch("/api/llm/auth").then(json<LlmAuthStatus[]>),
};
