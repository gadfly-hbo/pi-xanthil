import type { CreateRuleResult, DecisionTreeResult, EvaluationFlowConfig, ExtractionRun, ExtractionTool, Flow, FlowRun, FlowTreeNode, PiModel, PiSkill, RuleMemory, Session, SessionArtifactTree, SessionCompactResult, SessionRuntime, SessionTokenStats, StoredFlowMessage, StoredMessage, TraceEvent, TraceFailure, TraceOverview, TraceRuleSuggestion, TraceTargetKind, TraceTimelineItem, TraceTrendPoint, WorkflowDef, WorkflowEvaluation, WorkflowEvaluationDetail, WorkflowFavorite, Workspace, WorkspacePath, WorkspacePathKind } from "@/types";

export interface TocGraphItem {
  id: string;
  title: string;
  body: string;
  kind: "goal" | "symptom" | "constraint" | "root_cause" | "action" | "monitor";
  parentId?: string;
}

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
  return res.json() as Promise<T>;
}

export const api = {
  listModels: () => fetch("/api/models").then(json<PiModel[]>),
  generateTocGraph: (payload: { reportName: string; content: string; model?: string; sessionId?: string; flowId?: string }) =>
    fetch("/api/toc/generate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    }).then(json<{ nodes: TocGraphItem[]; model: string }>),
  listWorkspaceSkills: (workspaceId: string) =>
    fetch(`/api/workspaces/${workspaceId}/skills`).then(json<PiSkill[]>),
  listFlowSkills: (flowId: string) =>
    fetch(`/api/flows/${flowId}/skills`).then(json<PiSkill[]>),
  listWorkspaces: () => fetch("/api/workspaces").then(json<Workspace[]>),
  createWorkspace: (name: string) =>
    fetch("/api/workspaces", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name }),
    }).then(json<Workspace>),
  listSessions: (workspaceId: string) =>
    fetch(`/api/workspaces/${workspaceId}/sessions`).then(json<Session[]>),
  listRules: (workspaceId: string) =>
    fetch(`/api/workspaces/${workspaceId}/rules`).then(json<RuleMemory[]>),
  createRule: (workspaceId: string, payload: { title: string; evidence: string; source: "trace" | "manual"; severity: "low" | "medium" | "high"; scope?: "global" | "chat" | "workflow" }) =>
    fetch(`/api/workspaces/${workspaceId}/rules`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) }).then(json<CreateRuleResult>),
  updateRuleEnabled: (id: string, enabled: boolean) =>
    fetch(`/api/rules/${id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ enabled }) }).then(json<{ ok: true }>),
  updateRule: (id: string, payload: { title: string; evidence: string; severity: "low" | "medium" | "high"; scope: "global" | "chat" | "workflow" }) =>
    fetch(`/api/rules/${id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) }).then(json<{ ok: true }>),
  updateRulesEnabled: (workspaceId: string, ids: string[], enabled: boolean) =>
    fetch(`/api/workspaces/${workspaceId}/rules`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ ids, enabled }) }).then(json<{ ok: true }>),
  deleteRule: (id: string) => fetch(`/api/rules/${id}`, { method: "DELETE" }).then(json<{ ok: true }>),
  getRulesPrompt: (workspaceId: string) =>
    fetch(`/api/workspaces/${workspaceId}/rules-prompt`).then(json<{ prompt: string; count: number; updatedAt: number | null }>),
  createSession: (workspaceId: string, title: string, workflowId?: string) =>
    fetch(`/api/workspaces/${workspaceId}/sessions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title, workflowId: workflowId ?? null }),
    }).then(json<Session>),
  listMessages: (sessionId: string) =>
    fetch(`/api/sessions/${sessionId}/messages`).then(json<StoredMessage[]>),
  getSessionRunStatus: (sessionId: string) =>
    fetch(`/api/sessions/${sessionId}/run-status`).then(json<{ running: boolean; startedAt: number | null }>),
  getSessionRuntime: (sessionId: string, refresh = false) =>
    fetch(`/api/sessions/${sessionId}/runtime${refresh ? "?refresh=1" : ""}`).then(json<SessionRuntime>),
  compactSession: (sessionId: string) =>
    fetch(`/api/sessions/${sessionId}/compact`, { method: "POST" }).then(json<SessionCompactResult>),
  getSessionTokenStats: (sessionId: string) =>
    fetch(`/api/sessions/${sessionId}/token-stats`).then(json<SessionTokenStats>),
  getWorkspaceTokenStats: (workspaceId: string) =>
    fetch(`/api/workspaces/${workspaceId}/token-stats`).then(json<SessionTokenStats>),
  getWorkspaceTokenStatsBySession: (workspaceId: string) =>
    fetch(`/api/workspaces/${workspaceId}/token-stats-by-session`).then(json<(SessionTokenStats & { title: string })[]>),
  getTraceOverview: (workspaceId: string) =>
    fetch(`/api/workspaces/${workspaceId}/trace/overview`).then(json<TraceOverview>),
  listTraceRecentEvents: (workspaceId: string, limit = 30) =>
    fetch(`/api/workspaces/${workspaceId}/trace/recent-events?limit=${limit}`).then(json<TraceEvent[]>),
  getTraceTrend: (workspaceId: string, days = 14) =>
    fetch(`/api/workspaces/${workspaceId}/trace/trend?days=${days}`).then(json<TraceTrendPoint[]>),
  getTraceTimeline: (workspaceId: string, targetKind: TraceTargetKind, targetId: string) =>
    fetch(`/api/workspaces/${workspaceId}/trace/timeline?targetKind=${encodeURIComponent(targetKind)}&targetId=${encodeURIComponent(targetId)}`).then(json<TraceTimelineItem[]>),
  listTraceFailures: (workspaceId: string, limit = 10) =>
    fetch(`/api/workspaces/${workspaceId}/trace/failures?limit=${limit}`).then(json<TraceFailure[]>),
  generateTraceRuleSuggestions: (workspaceId: string) =>
    fetch(`/api/workspaces/${workspaceId}/trace/rule-suggestions`, { method: "POST" }).then(json<TraceRuleSuggestion[]>),
  sessionArtifactTree: (sessionId: string) =>
    fetch(`/api/sessions/${sessionId}/artifacts/tree`).then(json<SessionArtifactTree>),
  sessionArtifactFileGet: (sessionId: string, path: string) =>
    fetch(`/api/sessions/${sessionId}/artifacts/file?path=${encodeURIComponent(path)}`).then(
      json<{ name: string; content?: string; previewable: boolean; truncated: boolean; size: number }>,
    ),
  promoteSessionToFlow: (sessionId: string, payload: { name: string; scope: "latest_task" | "full_conversation"; model?: string }) =>
    fetch(`/api/sessions/${sessionId}/promote-to-flow`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    }).then(json<Flow>),
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
  getFlow: (flowId: string) => fetch(`/api/flows/${flowId}`).then(json<Flow>),
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
  listWorkflowFavorites: () => fetch("/api/workflow-favorites").then(json<WorkflowFavorite[]>),
  favoriteFlow: (flowId: string) =>
    fetch(`/api/flows/${flowId}/favorite`, { method: "POST" }).then(json<WorkflowFavorite>),
  removeWorkflowFavorite: (id: string) =>
    fetch(`/api/workflow-favorites/${id}`, { method: "DELETE" }).then(json<{ ok: true }>),
  reuseWorkflowFavorite: (id: string, workspaceId: string, name?: string) =>
    fetch(`/api/workflow-favorites/${id}/reuse`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ workspaceId, name }),
    }).then(json<Flow>),
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
  addWorkspacePath: (workspaceId: string, folder: string, path: string, kind: WorkspacePathKind) =>
    fetch(`/api/workspaces/${workspaceId}/paths`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ folder, path, kind }),
    }).then(json<WorkspacePath>),
  removeWorkspacePath: (workspaceId: string, pathId: number) =>
    fetch(`/api/workspaces/${workspaceId}/paths/${pathId}`, { method: "DELETE" }).then(json<{ ok: true }>),
  pickLocalPath: (mode: "file" | "dir" = "file") =>
    fetch("/api/pick-path", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ mode }),
    }).then(json<{ path: string }>),

  // ---- local extraction tools ----
  listExtractionTools: () => fetch("/api/extraction-tools").then(json<ExtractionTool[]>),
  runExtractionTool: (id: string, inputPath: string, outputPath: string) =>
    fetch(`/api/extraction-tools/${encodeURIComponent(id)}/run`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ inputPath, outputPath }),
    }).then(json<ExtractionRun>),

  // ---- session-level paths ----
  listSessionPaths: (sessionId: string, folder?: string) =>
    fetch(`/api/sessions/${sessionId}/paths${folder ? `?folder=${encodeURIComponent(folder)}` : ""}`)
      .then(json<WorkspacePath[]>),
  addSessionPath: (sessionId: string, folder: string, path: string, kind: WorkspacePathKind) =>
    fetch(`/api/sessions/${sessionId}/paths`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ folder, path, kind }),
    }).then(json<WorkspacePath>),
  removeSessionPath: (sessionId: string, pathId: number) =>
    fetch(`/api/sessions/${sessionId}/paths/${pathId}`, { method: "DELETE" })
      .then(json<{ ok: true }>),

  // ---- flow-level paths ----
  listFlowPaths: (flowId: string, folder?: string) =>
    fetch(`/api/flows/${flowId}/paths${folder ? `?folder=${encodeURIComponent(folder)}` : ""}`)
      .then(json<WorkspacePath[]>),
  addFlowPath: (flowId: string, folder: string, path: string, kind: WorkspacePathKind) =>
    fetch(`/api/flows/${flowId}/paths`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ folder, path, kind }),
    }).then(json<WorkspacePath>),
  removeFlowPath: (flowId: string, pathId: number) =>
    fetch(`/api/flows/${flowId}/paths/${pathId}`, { method: "DELETE" })
      .then(json<{ ok: true }>),
  workspacePathTree: (pathId: number) =>
    fetch(`/api/workspace-paths/${pathId}/tree`).then(json<FlowTreeNode>),
  workspacePathFileGet: (pathId: number, path = "") =>
    fetch(`/api/workspace-paths/${pathId}/file?path=${encodeURIComponent(path)}`).then(
      json<{ name: string; size: number; previewable: boolean; truncated: boolean; content?: string }>,
    ),

  listFlowRuns: (flowId: string) =>
    fetch(`/api/flows/${flowId}/runs`).then(json<FlowRun[]>),
  flowRunTree: (flowId: string, runId: string) =>
    fetch(`/api/flows/${flowId}/runs/${runId}/tree`).then(json<FlowTreeNode>),
  flowRunFileGet: (flowId: string, runId: string, path: string) =>
    fetch(`/api/flows/${flowId}/runs/${runId}/file?path=${encodeURIComponent(path)}`).then(
      json<{ content: string; truncated: boolean; size: number }>,
    ),
  flowRunFilePut: (flowId: string, runId: string, path: string, content: string) =>
    fetch(`/api/flows/${flowId}/runs/${runId}/file`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ path, content }),
    }).then(json<{ ok: true }>),

  generateDecisionTree: (payload: { source: "session" | "flow-run"; sessionId?: string; flowId?: string; runId?: string; path: string; model: string }) =>
    fetch("/api/decision-tree/generate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    }).then(json<DecisionTreeResult>),

  listWorkflowEvaluations: (workspaceId: string) =>
    fetch(`/api/workspaces/${workspaceId}/evaluations`).then(json<WorkflowEvaluation[]>),
  getWorkflowEvaluation: (evaluationId: string) =>
    fetch(`/api/evaluations/${evaluationId}`).then(json<WorkflowEvaluationDetail>),
  createWorkflowEvaluation: (
    workspaceId: string,
    payload: { flowIds: string[]; prompt: string; rubric: string; model: string; judgeModel: string; flowConfigs: Record<string, EvaluationFlowConfig>; repeat: number },
  ) =>
    fetch(`/api/workspaces/${workspaceId}/evaluations`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    }).then(json<WorkflowEvaluationDetail>),
};
