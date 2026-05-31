import type { Flow, FlowRun, FlowTreeNode, PiModel, Session, StoredFlowMessage, StoredMessage, WorkflowDef, Workspace, WorkspacePath } from "@/types";

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
  return res.json() as Promise<T>;
}

export const api = {
  listModels: () => fetch("/api/models").then(json<PiModel[]>),
  listWorkspaces: () => fetch("/api/workspaces").then(json<Workspace[]>),
  createWorkspace: (name: string) =>
    fetch("/api/workspaces", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name }),
    }).then(json<Workspace>),
  listSessions: (workspaceId: string) =>
    fetch(`/api/workspaces/${workspaceId}/sessions`).then(json<Session[]>),
  createSession: (workspaceId: string, title: string, workflowId?: string) =>
    fetch(`/api/workspaces/${workspaceId}/sessions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title, workflowId: workflowId ?? null }),
    }).then(json<Session>),
  listMessages: (sessionId: string) =>
    fetch(`/api/sessions/${sessionId}/messages`).then(json<StoredMessage[]>),
  renameWorkspace: (id: string, name: string) =>
    fetch(`/api/workspaces/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name }),
    }).then(json<{ ok: true }>),
  deleteWorkspace: (id: string) => fetch(`/api/workspaces/${id}`, { method: "DELETE" }).then(json<{ ok: true }>),
  renameSession: (id: string, title: string) =>
    fetch(`/api/sessions/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title }),
    }).then(json<{ ok: true }>),
  deleteSession: (id: string) => fetch(`/api/sessions/${id}`, { method: "DELETE" }).then(json<{ ok: true }>),

  // ---- flows ----
  listFlows: (workspaceId: string) =>
    fetch(`/api/workspaces/${workspaceId}/flows`).then(json<Flow[]>),
  createFlow: (workspaceId: string, name: string, kind?: "single" | "multi") =>
    fetch(`/api/workspaces/${workspaceId}/flows`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name, kind }),
    }).then(json<Flow>),
  renameFlow: (id: string, name: string) =>
    fetch(`/api/flows/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name }),
    }).then(json<{ ok: true }>),
  deleteFlow: (id: string) => fetch(`/api/flows/${id}`, { method: "DELETE" }).then(json<{ ok: true }>),
  listFlowMessages: (flowId: string) =>
    fetch(`/api/flows/${flowId}/messages`).then(json<StoredFlowMessage[]>),
  flowTree: (flowId: string) => fetch(`/api/flows/${flowId}/tree`).then(json<FlowTreeNode>),
  flowFileGet: (flowId: string, path: string) =>
    fetch(`/api/flows/${flowId}/file?path=${encodeURIComponent(path)}`).then(
      json<{ content: string; truncated: boolean; size: number }>,
    ),
  flowFilePut: (flowId: string, path: string, content: string) =>
    fetch(`/api/flows/${flowId}/file`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ path, content }),
    }).then(json<{ ok: true }>),
  flowWorkflowGet: (flowId: string) =>
    fetch(`/api/flows/${flowId}/workflow`).then(
      json<{ workflow: WorkflowDef | null; inferred?: boolean }>,
    ),
  flowWorkflowPut: (flowId: string, workflow: WorkflowDef) =>
    fetch(`/api/flows/${flowId}/workflow`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(workflow),
    }).then(json<{ ok: true }>),
  importLocalFolder: (flowId: string, path: string) =>
    fetch(`/api/flows/${flowId}/import-local`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ path }),
    }).then(json<{ ok: true; sourceName: string; count: number }>),
  // Upload an entire local folder (webkitdirectory). `files` is the FileList from
  // <input webkitdirectory>; we forward each file's `webkitRelativePath` alongside
  // so the server can rebuild the layout.
  importFlowFolder: async (flowId: string, files: FileList | File[]) => {
    const fd = new FormData();
    const list = Array.from(files);
    for (const f of list) {
      const rel = (f as File & { webkitRelativePath?: string }).webkitRelativePath || f.name;
      fd.append("paths", rel);
      fd.append("files", f, rel.split("/").pop() ?? f.name);
    }
    const res = await fetch(`/api/flows/${flowId}/import`, { method: "POST", body: fd });
    return json<{ ok: true; sourceName: string; count: number }>(res);
  },

  // ---- workspace paths ----
  listWorkspacePaths: (workspaceId: string, folder?: string) =>
    fetch(`/api/workspaces/${workspaceId}/paths${folder ? `?folder=${encodeURIComponent(folder)}` : ""}`).then(
      json<WorkspacePath[]>,
    ),
  addWorkspacePath: (workspaceId: string, folder: string, path: string) =>
    fetch(`/api/workspaces/${workspaceId}/paths`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ folder, path }),
    }).then(json<WorkspacePath>),
  removeWorkspacePath: (workspaceId: string, pathId: number) =>
    fetch(`/api/workspaces/${workspaceId}/paths/${pathId}`, { method: "DELETE" }).then(json<{ ok: true }>),
  pickLocalPath: (mode: "file" | "dir" = "file") =>
    fetch("/api/pick-path", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ mode }),
    }).then(json<{ path: string }>),

  // ---- session-level paths ----
  listSessionPaths: (sessionId: string, folder?: string) =>
    fetch(`/api/sessions/${sessionId}/paths${folder ? `?folder=${encodeURIComponent(folder)}` : ""}`)
      .then(json<WorkspacePath[]>),
  addSessionPath: (sessionId: string, folder: string, path: string) =>
    fetch(`/api/sessions/${sessionId}/paths`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ folder, path }),
    }).then(json<WorkspacePath>),
  removeSessionPath: (sessionId: string, pathId: number) =>
    fetch(`/api/sessions/${sessionId}/paths/${pathId}`, { method: "DELETE" })
      .then(json<{ ok: true }>),

  // ---- flow-level paths ----
  listFlowPaths: (flowId: string, folder?: string) =>
    fetch(`/api/flows/${flowId}/paths${folder ? `?folder=${encodeURIComponent(folder)}` : ""}`)
      .then(json<WorkspacePath[]>),
  addFlowPath: (flowId: string, folder: string, path: string) =>
    fetch(`/api/flows/${flowId}/paths`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ folder, path }),
    }).then(json<WorkspacePath>),
  removeFlowPath: (flowId: string, pathId: number) =>
    fetch(`/api/flows/${flowId}/paths/${pathId}`, { method: "DELETE" })
      .then(json<{ ok: true }>),

  listFlowRuns: (flowId: string) =>
    fetch(`/api/flows/${flowId}/runs`).then(json<FlowRun[]>),
  flowRunTree: (flowId: string, runId: string) =>
    fetch(`/api/flows/${flowId}/runs/${runId}/tree`).then(json<FlowTreeNode>),
  flowRunFileGet: (flowId: string, runId: string, path: string) =>
    fetch(`/api/flows/${flowId}/runs/${runId}/file?path=${encodeURIComponent(path)}`).then(
      json<{ content: string; truncated: boolean; size: number }>,
    ),
};
