// 【总控 · 共享域】前端 API 方法 slot —— owner: Claude(总控)
// 跨域基础设施 API (workspaces / workspace-paths / models / llm / 记忆启用关系 等)。仅总控写。
import { json } from "./_http";
import type { MemoryItemKind, WorkspaceMemoryEnablement } from "@/types";

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
};
