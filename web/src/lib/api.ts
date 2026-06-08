import type { AnalysisCase, AnaxGateConfig, AnalysisStandard, AnalysisStandardInput, BiDatasetDetail, BiDatasetSlot, BiDatasetSummary, BusinessContext, BusinessContextCategory, ChangeProposal, ChangeProposalStatus, CreateRuleResult, DecisionTreeResult, EvaluationArchiveIndexItem, EvaluationArchiveResult, GoldenStrategyBatchResult, GoldenStrategyModelId, GoldenStrategyResult, HypothesisEntry, HypothesisEntryInput, EvaluationFlowConfig, ExtractionRun, ExtractionTool, Flow, FlowRun, FlowTreeNode, KgEdge, KgNode, KgSyncResult, MemoryEvaluation, MemoryEvaluationDetail, MemoryInjectionRecord, MemoryProposal, MemoryProposalStatus, MemorySourceKind, MemoryUsageStats, PiModel, PiSkill, PredictionResult, ModelLabRunDetail, ModelLabRunSummary, ModelLabStats, RuleConflict, RuleMemory, MemoryFailureAttribution, SchemaTable, Session, SessionArtifactTree, SessionCompactResult, SessionRuntime, SessionTokenStats, AutonomousRunResult, RetrievedSkill, SkillCurationApplyResult, SkillCurationProposal, SkillCurationProposalRecord, SkillCurationProposalStatus, SkillCurationResult, SkillEvalSet, SkillEvalTask, SkillEvaluation, SkillEvaluationDetail, SkillVariant, SqlConnection, SqlQueryResult, SqlValidateResult, StaleNode, StoredFlowMessage, StoredMessage, TokenUsageStats, ToolCaseSet, ToolEvalCase, ToolEvalCaseTemplateList, ToolEvaluation, ToolEvaluationDetail, TraceEvent, TraceFailure, TraceOverview, TraceRuleSuggestion, TraceTargetKind, TraceTimelineItem, TraceTrendPoint, WorkflowDef, WorkflowEvaluation, WorkflowEvaluationDetail, WorkflowFavorite, Workspace, WorkspacePath, WorkspacePathKind } from "@/types";

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
  generatePresentationVersion: (payload: { pathId: number; relPath?: string; prompt: string; model?: string; businessRequirementContext?: { pathId: number; markdownPath: string; jsonPath?: string } }) =>
    fetch("/api/report-versions/generate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    }).then(json<{ path: string; content: string; storylinePath: string; storylineHtml: string; model: string }>),
  generateHighQualityHtmlReport: (payload: { pathId: number; relPath?: string }) =>
    fetch("/api/html-reports/generate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    }).then(json<{ path: string; absPath: string; content: string }>),
  reviewReport: (payload: { pathId: number; relPath?: string; prompt?: string; model?: string }) =>
    fetch("/api/report-review/review", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    }).then(json<{ content: string; annotations: Array<{ quote: string; issue: string; suggestion: string; severity: "P0" | "P1" | "P2" }>; totalScore: number; model: string; reportContent: string }>),
  autoFixReport: (payload: { pathId: number; relPath?: string; reviewContent: string; prompt?: string; model?: string }) =>
    fetch("/api/report-review/auto-fix", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    }).then(json<{ path: string; content: string; model: string }>),
  listReviewHistory: (payload: { pathId: number; relPath?: string }) =>
    fetch(`/api/report-review/history?pathId=${encodeURIComponent(payload.pathId)}${payload.relPath ? `&relPath=${encodeURIComponent(payload.relPath)}` : ""}`)
      .then(json<{ entries: Array<{ id: string; reportName: string; reviewedAt: number; model: string; totalScore: number; pathId: number; relPath: string; reviewMarkdown: string; annotations: Array<{ quote: string; issue: string; suggestion: string; severity: "P0" | "P1" | "P2" }> }> }>),

  generateBusinessRequirement: (payload: {
    pathId: number;
    documents?: Array<
      | { source: "workspace_path"; pathId: number; relPath?: string }
      | { source: "local_path"; path: string }
    >;
    requirement: {
      projectName: string;
      businessBackground: string;
      businessGoal: string;
      businessQuestions: string;
      decisionScenario: string;
      stakeholders: string;
      knownData: string;
      constraints: string;
      outputPreference: string;
      extraPrompt: string;
    };
    model?: string;
  }) =>
    fetch("/api/business-requirements/generate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    }).then(json<{ path: string; jsonPath: string; content: string; structured: unknown; model: string }>),
  previewBusinessRequirementDocuments: (payload: {
    documents: Array<
      | { source: "workspace_path"; pathId: number; relPath?: string }
      | { source: "local_path"; path: string }
    >;
  }) =>
    fetch("/api/business-requirements/documents/preview", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    }).then(json<{ documents: Array<{ name: string; path: string; size: number; mtimeMs: number; source: "workspace_path" | "local_path"; extension: string; content: string; truncated: boolean; error?: string }> }>),
  extractBusinessRequirementDraft: (payload: {
    pathId: number;
    documents: Array<
      | { source: "workspace_path"; pathId: number; relPath?: string }
      | { source: "local_path"; path: string }
    >;
    model?: string;
  }) =>
    fetch("/api/business-requirements/extract", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    }).then(json<{ draft: {
      projectName: string;
      businessBackground: string;
      businessGoal: string;
      businessQuestions: string;
      decisionScenario: string;
      stakeholders: string;
      knownData: string;
      constraints: string;
      outputPreference: string;
      extraPrompt: string;
    }; model: string }>),
  generateBusinessRequirementClarifyingQuestions: (payload: {
    pathId?: number;
    documents?: Array<
      | { source: "workspace_path"; pathId: number; relPath?: string }
      | { source: "local_path"; path: string }
    >;
    requirement: {
      projectName: string;
      businessBackground: string;
      businessGoal: string;
      businessQuestions: string;
      decisionScenario: string;
      stakeholders: string;
      knownData: string;
      constraints: string;
      outputPreference: string;
      extraPrompt: string;
    };
    model?: string;
  }) =>
    fetch("/api/business-requirements/clarify", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    }).then(json<{ content: string; model: string }>),
  listBusinessRequirementVersions: (pathId: number) =>
    fetch(`/api/business-requirements/versions?pathId=${encodeURIComponent(pathId)}`)
      .then(json<{ versions: Array<{ id: string; projectName: string; markdownPath: string; jsonPath: string; generatedAt: number; model: string; sourceDocumentCount: number; markdownEditedAt: number | null; jsonStale: boolean; jsonStaleReason: string | null }> }>),
  getBusinessRequirementVersion: (payload: { pathId: number; markdownPath: string; jsonPath?: string }) =>
    fetch(`/api/business-requirements/version?pathId=${encodeURIComponent(payload.pathId)}&markdownPath=${encodeURIComponent(payload.markdownPath)}${payload.jsonPath ? `&jsonPath=${encodeURIComponent(payload.jsonPath)}` : ""}`)
      .then(json<{ content: string; structured: unknown }>),
  updateBusinessRequirementVersion: (payload: { pathId: number; markdownPath: string; content: string }) =>
    fetch("/api/business-requirements/version", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    }).then(json<{ ok: true; path: string }>),
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
  listRuleConflicts: (workspaceId: string, status?: "open" | "ignored" | "resolved") =>
    fetch(`/api/workspaces/${workspaceId}/rule-conflicts${status ? `?status=${status}` : ""}`).then(json<RuleConflict[]>),
  detectRuleConflicts: (workspaceId: string) =>
    fetch(`/api/workspaces/${workspaceId}/rule-conflicts/detect`, { method: "POST" }).then(json<RuleConflict[]>),
  updateRuleConflictStatus: (id: string, status: "open" | "ignored" | "resolved") =>
    fetch(`/api/rule-conflicts/${id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ status }) }).then(json<{ ok: true }>),
  listMemoryProposals: (workspaceId: string, status?: MemoryProposalStatus) =>
    fetch(`/api/workspaces/${workspaceId}/memory/proposals${status ? `?status=${status}` : ""}`).then(json<MemoryProposal[]>),
  createMemoryProposalsFromTraceRules: (workspaceId: string, rules: TraceRuleSuggestion[]) =>
    fetch(`/api/workspaces/${workspaceId}/memory/proposals/from-trace-rules`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ rules }),
    }).then(json<MemoryProposal[]>),
  approveMemoryProposal: (id: string) =>
    fetch(`/api/memory/proposals/${id}/approve`, { method: "POST" }).then(json<CreateRuleResult>),
  rejectMemoryProposal: (id: string, reason = "") =>
    fetch(`/api/memory/proposals/${id}/reject`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ reason }) }).then(json<{ ok: true }>),
  listMemoryUsageStats: (workspaceId: string) =>
    fetch(`/api/workspaces/${workspaceId}/memory/usage`).then(json<MemoryUsageStats[]>),
  recordMemoryFeedback: (workspaceId: string, payload: { sourceKind: MemorySourceKind; signal: "positive" | "negative"; sourceId?: string }) =>
    fetch(`/api/workspaces/${workspaceId}/memory/feedback`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    }).then(json<MemoryUsageStats>),
  listMemoryFailureAttributions: (workspaceId: string, target?: { targetKind: string; targetId: string }) =>
    fetch(`/api/workspaces/${workspaceId}/memory/failure-attributions${target ? `?targetKind=${encodeURIComponent(target.targetKind)}&targetId=${encodeURIComponent(target.targetId)}` : ""}`).then(json<MemoryFailureAttribution[]>),
  createMemoryFailureAttribution: (workspaceId: string, payload: { targetKind: string; targetId: string; cause: MemoryFailureAttribution["cause"]; sourceKind?: MemorySourceKind | null; sourceId?: string | null; note?: string }) =>
    fetch(`/api/workspaces/${workspaceId}/memory/failure-attributions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    }).then(json<MemoryFailureAttribution>),

  listBusinessContexts: (workspaceId: string) =>
    fetch(`/api/workspaces/${workspaceId}/business-contexts`).then(json<BusinessContext[]>),
  createBusinessContext: (workspaceId: string, payload: { category: BusinessContextCategory; title: string; content: string }) =>
    fetch(`/api/workspaces/${workspaceId}/business-contexts`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) }).then(json<BusinessContext>),
  updateBusinessContext: (id: string, payload: { category: BusinessContextCategory; title: string; content: string }) =>
    fetch(`/api/business-contexts/${id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) }).then(json<{ ok: true }>),
  updateBusinessContextEnabled: (id: string, enabled: boolean) =>
    fetch(`/api/business-contexts/${id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ enabled }) }).then(json<{ ok: true }>),
  updateBusinessContextsEnabled: (workspaceId: string, ids: string[], enabled: boolean) =>
    fetch(`/api/workspaces/${workspaceId}/business-contexts`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ ids, enabled }) }).then(json<{ ok: true }>),
  deleteBusinessContext: (id: string) => fetch(`/api/business-contexts/${id}`, { method: "DELETE" }).then(json<{ ok: true }>),
  getBusinessContextPrompt: (workspaceId: string) =>
    fetch(`/api/workspaces/${workspaceId}/business-context-prompt`).then(json<{ prompt: string; count: number; updatedAt: number | null }>),

  listCases: (workspaceId: string) =>
    fetch(`/api/workspaces/${workspaceId}/cases`).then(json<AnalysisCase[]>),
  createCase: (workspaceId: string, payload: { title: string; category: string; scenario: string; approach: string; conclusion: string }) =>
    fetch(`/api/workspaces/${workspaceId}/cases`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) }).then(json<AnalysisCase>),
  updateCase: (id: string, payload: { title: string; category: string; scenario: string; approach: string; conclusion: string }) =>
    fetch(`/api/cases/${id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) }).then(json<{ ok: true }>),
  updateCaseEnabled: (id: string, enabled: boolean) =>
    fetch(`/api/cases/${id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ enabled }) }).then(json<{ ok: true }>),
  deleteCase: (id: string) => fetch(`/api/cases/${id}`, { method: "DELETE" }).then(json<{ ok: true }>),
  getCasesPrompt: (workspaceId: string) =>
    fetch(`/api/workspaces/${workspaceId}/cases-prompt`).then(json<{ prompt: string; count: number; updatedAt: number | null }>),

  listStandards: (workspaceId: string) =>
    fetch(`/api/workspaces/${workspaceId}/standards`).then(json<AnalysisStandard[]>),
  createStandard: (workspaceId: string, payload: AnalysisStandardInput) =>
    fetch(`/api/workspaces/${workspaceId}/standards`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) }).then(json<AnalysisStandard>),
  updateStandard: (id: string, payload: AnalysisStandardInput) =>
    fetch(`/api/standards/${id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) }).then(json<{ ok: true }>),
  updateStandardEnabled: (id: string, enabled: boolean) =>
    fetch(`/api/standards/${id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ enabled }) }).then(json<{ ok: true }>),
  deleteStandard: (id: string) =>
    fetch(`/api/standards/${id}`, { method: "DELETE" }).then(json<{ ok: true }>),
  getStandardsPrompt: (workspaceId: string) =>
    fetch(`/api/workspaces/${workspaceId}/standards-prompt`).then(json<{ prompt: string; count: number; updatedAt: number | null }>),
  listHypotheses: (workspaceId: string) =>
    fetch(`/api/workspaces/${workspaceId}/hypotheses`).then(json<HypothesisEntry[]>),
  createHypothesis: (workspaceId: string, payload: HypothesisEntryInput) =>
    fetch(`/api/workspaces/${workspaceId}/hypotheses`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) }).then(json<HypothesisEntry>),
  updateHypothesisEnabled: (id: string, enabled: boolean) =>
    fetch(`/api/hypotheses/${id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ enabled }) }).then(json<{ ok: true }>),
  deleteHypothesis: (id: string) =>
    fetch(`/api/hypotheses/${id}`, { method: "DELETE" }).then(json<{ ok: true }>),
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
  getWorkspaceTodayTokenStats: (workspaceId: string) =>
    fetch(`/api/workspaces/${workspaceId}/token-stats/today`).then(json<SessionTokenStats>),
  getWorkspaceTokenStatsBySession: (workspaceId: string) =>
    fetch(`/api/workspaces/${workspaceId}/token-stats-by-session`).then(json<TokenUsageStats[]>),
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
  pruneTraceEvents: (workspaceId: string, retainDays: number) =>
    fetch(`/api/workspaces/${workspaceId}/trace/events?retainDays=${retainDays}`, { method: "DELETE" }).then(json<{ deleted: number; retainedDays: number }>),
  listMemoryInjectionRecords: (workspaceId: string, limit = 50) =>
    fetch(`/api/workspaces/${workspaceId}/memory/injections?limit=${limit}`).then(json<MemoryInjectionRecord[]>),
  listMemoryEvaluations: (workspaceId: string) =>
    fetch(`/api/workspaces/${workspaceId}/memory-evaluations`).then(json<MemoryEvaluation[]>),
  getMemoryEvaluation: (evaluationId: string) =>
    fetch(`/api/memory-evaluations/${evaluationId}`).then(json<MemoryEvaluationDetail>),
  createMemoryEvaluation: (workspaceId: string, payload: { prompt: string; rubric?: string; model?: string; judgeModel?: string; targetScope?: "chat" | "workflow"; repeat?: number }) =>
    fetch(`/api/workspaces/${workspaceId}/memory-evaluations`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    }).then(json<MemoryEvaluationDetail>),
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
  distillSkill: (sessionId: string, payload: { scope: "latest_task" | "full_conversation"; model?: string }) =>
    fetch(`/api/sessions/${sessionId}/distill-skill`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    }).then(json<{ content: string; name: string; model: string }>),
  saveSkill: (sessionId: string, payload: { name: string; content: string }) =>
    fetch(`/api/sessions/${sessionId}/save-skill`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    }).then(json<{ path: string; name: string; slug: string }>),
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
  instantiateAnax: (workspaceId: string, name?: string) =>
    fetch(`/api/workspaces/${workspaceId}/anax/instantiate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name }),
    }).then(json<Flow>),
  instantiateAnaxQuick: (workspaceId: string, name?: string) =>
    fetch(`/api/workspaces/${workspaceId}/anax/instantiate-quick`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name }),
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

  // ---- SQL connections ----
  listSqlConnections: () => fetch("/api/sql-connections").then(json<SqlConnection[]>),
  createSqlConnection: (data: Omit<SqlConnection, "id" | "createdAt">) =>
    fetch("/api/sql-connections", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(data) }).then(json<SqlConnection>),
  updateSqlConnection: (id: string, data: Partial<SqlConnection>) =>
    fetch(`/api/sql-connections/${id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(data) }).then(json<SqlConnection>),
  deleteSqlConnection: (id: string) =>
    fetch(`/api/sql-connections/${id}`, { method: "DELETE" }).then(json<{ ok: true }>),
  testSqlConnection: (id: string) =>
    fetch(`/api/sql-connections/${id}/test`, { method: "POST" }).then(json<{ ok: boolean; message: string; latencyMs: number }>),
  getSqlSchema: (id: string) =>
    fetch(`/api/sql-connections/${id}/schema`).then(json<{ tables: SchemaTable[] }>),
  querySql: (id: string, sql: string, params?: Record<string, unknown>, workspaceId?: string) =>
    fetch(`/api/sql-connections/${id}/query`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ sql, params, workspaceId }) }).then(json<SqlQueryResult>),
  validateSql: (id: string, sql: string) =>
    fetch(`/api/sql-connections/${id}/validate-sql`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ sql }) }).then(json<SqlValidateResult>),
  exportSql: (id: string, sql: string, outputPath: string, params?: Record<string, unknown>, watermark?: { column: string; initialValue?: unknown }, workspaceId?: string) =>
    fetch(`/api/sql-connections/${id}/export`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ sql, outputPath, params, watermark, workspaceId }) }).then(json<{ path: string; rowCount: number; appended: boolean }>),
  getExportState: (path: string) =>
    fetch(`/api/sql-connections/export-state?path=${encodeURIComponent(path)}`).then(json<{ exists: boolean; lastWatermark?: unknown }>),
  updateExportState: (path: string, lastWatermark?: unknown) =>
    fetch(`/api/sql-connections/export-state`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ path, lastWatermark }),
    }).then(json<{ exists: boolean; lastWatermark?: unknown }>),

  // ---- direct LLM prompt (tool-free channel) ----
  directLlmPrompt: (payload: { text: string; model?: string; systemPrompt?: string }) =>
    fetch("/api/llm/prompt", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    }).then(json<{ text: string; model: string }>),

  // ---- local extraction tools ----
  listExtractionTools: () => fetch("/api/extraction-tools").then(json<ExtractionTool[]>),
  listExtractionToolTestCases: (id: string) =>
    fetch(`/api/extraction-tools/${encodeURIComponent(id)}/test-cases`).then(json<ToolEvalCaseTemplateList>),
  runExtractionTool: (id: string, inputPath: string, outputPath: string, params?: Record<string, string | number | boolean>, workspaceId?: string) =>
    fetch(`/api/extraction-tools/${encodeURIComponent(id)}/run`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ inputPath, outputPath, params, workspaceId }),
    }).then(json<ExtractionRun>),
  previewExtractionFile: (path: string, outputRoot: string) =>
    fetch(`/api/extraction-tools/preview?path=${encodeURIComponent(path)}&outputRoot=${encodeURIComponent(outputRoot)}`).then(
      json<{ name: string; size: number; previewable: boolean; truncated: boolean; content?: string }>,
    ),

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
  workspacePathFilePut: (pathId: number, path: string, content: string) =>
    fetch(`/api/workspace-paths/${pathId}/file`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ path, content }),
    }).then(json<{ ok: true; path: string }>),

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
  generateGoldenStrategy: (payload: { source: "session" | "flow-run"; sessionId?: string; flowId?: string; runId?: string; path: string; analysisModel: GoldenStrategyModelId; prompt?: string; model: string; businessRequirementContext?: { pathId: number; markdownPath: string; jsonPath?: string } }) =>
    fetch("/api/golden-strategy/generate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    }).then(json<GoldenStrategyResult>),
  generateGoldenStrategyBatch: (payload: { source: "session" | "flow-run"; sessionId?: string; flowId?: string; runId?: string; path: string; analysisModels: GoldenStrategyModelId[]; prompt?: string; model: string; businessRequirementContext?: { pathId: number; markdownPath: string; jsonPath?: string } }) =>
    fetch("/api/golden-strategy/generate-batch", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    }).then(json<GoldenStrategyBatchResult>),

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
  listSkillEvaluations: (workspaceId: string) =>
    fetch(`/api/workspaces/${workspaceId}/skill-evaluations`).then(json<SkillEvaluation[]>),
  listSkillEvalSets: (workspaceId: string) =>
    fetch(`/api/workspaces/${workspaceId}/skill-eval-sets`).then(json<SkillEvalSet[]>),
  createSkillEvalSet: (workspaceId: string, payload: { name: string; tasks: SkillEvalTask[] }) =>
    fetch(`/api/workspaces/${workspaceId}/skill-eval-sets`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    }).then(json<SkillEvalSet>),
  updateSkillEvalSet: (id: string, payload: { name?: string; tasks?: SkillEvalTask[] }) =>
    fetch(`/api/skill-eval-sets/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    }).then(json<SkillEvalSet>),
  deleteSkillEvalSet: (id: string) =>
    fetch(`/api/skill-eval-sets/${id}`, { method: "DELETE" }).then(json<{ ok: true }>),
  getSkillEvaluation: (evaluationId: string) =>
    fetch(`/api/skill-evaluations/${evaluationId}`).then(json<SkillEvaluationDetail>),
  runSkillEvaluation: (
    workspaceId: string,
    payload: { model: string; repeat: number; judgeRepeat?: number; variants: SkillVariant[]; tasks: SkillEvalTask[]; contextPrefix?: string; dataContextPaths?: string[] },
  ) =>
    fetch(`/api/workspaces/${workspaceId}/skill-evaluations/run`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    }).then(json<SkillEvaluationDetail>),
  runToolEvaluation: (
    workspaceId: string,
    payload: { toolId: string; repeat: number; cases: ToolEvalCase[] },
  ) =>
    fetch(`/api/workspaces/${workspaceId}/tool-evaluations/run`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    }).then(json<ToolEvaluationDetail>),
  listToolEvaluations: (workspaceId: string) =>
    fetch(`/api/workspaces/${workspaceId}/tool-evaluations`).then(json<ToolEvaluation[]>),
  listToolCaseSets: (workspaceId: string, toolId?: string) =>
    fetch(`/api/workspaces/${workspaceId}/tool-case-sets${toolId ? `?toolId=${encodeURIComponent(toolId)}` : ""}`).then(json<ToolCaseSet[]>),
  createToolCaseSet: (workspaceId: string, payload: { name: string; toolId: string; cases: ToolEvalCase[] }) =>
    fetch(`/api/workspaces/${workspaceId}/tool-case-sets`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    }).then(json<ToolCaseSet>),
  updateToolCaseSet: (id: string, payload: { name?: string; toolId?: string; cases?: ToolEvalCase[] }) =>
    fetch(`/api/tool-case-sets/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    }).then(json<ToolCaseSet>),
  deleteToolCaseSet: (id: string) =>
    fetch(`/api/tool-case-sets/${id}`, { method: "DELETE" }).then(json<{ ok: true }>),
  getToolEvaluation: (evaluationId: string) =>
    fetch(`/api/tool-evaluations/${evaluationId}`).then(json<ToolEvaluationDetail>),
  archiveEvaluation: (kind: "skill" | "tool", evaluationId: string) =>
    fetch(`/api/evaluations/${kind}/${evaluationId}/archive`, { method: "POST" }).then(json<EvaluationArchiveResult>),
  listEvaluationArchives: (workspaceId: string) =>
    fetch(`/api/workspaces/${workspaceId}/evaluation-archives`).then(json<EvaluationArchiveIndexItem[]>),
  getEvaluationArchiveFile: (workspaceId: string, baseName: string, format: "md" | "json") =>
    fetch(`/api/workspaces/${workspaceId}/evaluation-archives/${encodeURIComponent(baseName)}/${format}`).then(async (res) => {
      if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
      return res.text();
    }),
  saveCustomModel: (modelId: string, payload: import("@/data/models").ModelDef) =>
    fetch(`/api/model-lab/models/${encodeURIComponent(modelId)}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload)
    }).then(async res => {
      if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
      return res.json();
    }),
  listCustomModels: () =>
    fetch("/api/model-lab/models").then(json<import("@/data/models").ModelDef[]>),
  predictModel: (payload: { modelId: string; mappings: Record<string, string>; rows: Record<string, unknown>[]; model?: string }) =>
    fetch("/api/model-lab/predict", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    }).then(json<PredictionResult>),
  listModelLabRuns: (limit = 30) =>
    fetch(`/api/model-lab/runs?limit=${encodeURIComponent(limit)}`).then(json<ModelLabRunSummary[]>),
  getModelLabRun: (id: string) =>
    fetch(`/api/model-lab/runs/${encodeURIComponent(id)}`).then(json<ModelLabRunDetail>),
  getModelLabStats: () =>
    fetch(`/api/model-lab/stats`).then(json<ModelLabStats>),
  deleteModelLabRun: (id: string) =>
    fetch(`/api/model-lab/runs/${encodeURIComponent(id)}`, { method: "DELETE" }).then(async (res) => {
      if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
      return res.json() as Promise<{ success: boolean; deleted: number }>;
    }),
  deleteModelLabRunsBefore: (olderThanDays: number, onlyFailed = true) =>
    fetch(`/api/model-lab/runs?olderThanDays=${encodeURIComponent(olderThanDays)}&onlyFailed=${onlyFailed ? "true" : "false"}`, { method: "DELETE" }).then(async (res) => {
      if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
      return res.json() as Promise<{ success: boolean; deleted: number; beforeTs: number; onlyFailed: boolean }>;
    }),

  // ---- BI datasets (member retention / member recall import) ----
  uploadBiDataset: async (slot: BiDatasetSlot, file: File) => {
    const fd = new FormData();
    fd.append("slot", slot);
    fd.append("file", file, file.name);
    const res = await fetch("/api/bi-datasets/upload", { method: "POST", body: fd });
    if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
    return res.json() as Promise<{ success: boolean; dataset: BiDatasetDetail }>;
  },
  listBiDatasets: (slot?: BiDatasetSlot) =>
    fetch(`/api/bi-datasets${slot ? `?slot=${encodeURIComponent(slot)}` : ""}`).then(json<BiDatasetSummary[]>),
  getActiveBiDataset: async (slot: BiDatasetSlot): Promise<BiDatasetDetail | null> => {
    const res = await fetch(`/api/bi-datasets/active?slot=${encodeURIComponent(slot)}`);
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
    return res.json() as Promise<BiDatasetDetail>;
  },
  getBiDataset: (id: string) =>
    fetch(`/api/bi-datasets/${encodeURIComponent(id)}`).then(json<BiDatasetDetail>),
  activateBiDataset: async (id: string, slot: BiDatasetSlot) => {
    const res = await fetch(`/api/bi-datasets/${encodeURIComponent(id)}/activate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ slot }),
    });
    if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
    return res.json() as Promise<{ success: boolean }>;
  },
  deleteBiDataset: async (id: string) => {
    const res = await fetch(`/api/bi-datasets/${encodeURIComponent(id)}`, { method: "DELETE" });
    if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
    return res.json() as Promise<{ success: boolean }>;
  },

  // ---- AnaX P3 change management ----
  listChangeProposals: (workspaceId: string) =>
    fetch(`/api/workspaces/${workspaceId}/change-proposals`).then(json<ChangeProposal[]>),
  createChangeProposal: (workspaceId: string, payload: { runId?: string | null; sourceNodeId?: string | null; title: string; description: string; expectedImpact: string }) =>
    fetch(`/api/workspaces/${workspaceId}/change-proposals`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    }).then(json<ChangeProposal>),
  updateChangeProposal: (id: string, payload: { status?: ChangeProposalStatus; appliedResult?: string; title?: string; description?: string; expectedImpact?: string }) =>
    fetch(`/api/change-proposals/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    }).then(json<{ ok: true }>),
  deleteChangeProposal: (id: string) =>
    fetch(`/api/change-proposals/${id}`, { method: "DELETE" }).then(json<{ ok: true }>),
  getStaleNodes: (runId: string) =>
    fetch(`/api/runs/${runId}/stale-nodes`).then(json<StaleNode[]>),
  cascadeFromNode: (runId: string, fromNodeId: string) =>
    fetch(`/api/runs/${runId}/cascade`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ fromNodeId }),
    }).then(json<{ ok: true; markedNodes: string[] }>),
  getAnaxGateConfig: (workspaceId: string) =>
    fetch(`/api/workspaces/${workspaceId}/anax-gate-config`).then(json<AnaxGateConfig>),
  updateAnaxGateConfig: (workspaceId: string, payload: Partial<Pick<AnaxGateConfig, "minConfidence" | "minEvidenceCount" | "minDataQualityScore">>) =>
    fetch(`/api/workspaces/${workspaceId}/anax-gate-config`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    }).then(json<AnaxGateConfig>),
  curateSkillEvaluation: (evaluationId: string, model: string) =>
    fetch(`/api/skill-evaluations/${evaluationId}/curate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model }),
    }).then(json<SkillCurationResult>),
  applySkillCurationProposals: (workspaceId: string, proposals: SkillCurationProposal[]) =>
    fetch(`/api/workspaces/${workspaceId}/skill-curator/apply`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ proposals }),
    }).then(json<SkillCurationApplyResult>),
  listSkillCurationProposals: (workspaceId: string, status?: SkillCurationProposalStatus) =>
    fetch(`/api/workspaces/${workspaceId}/skill-curation-proposals${status ? `?status=${status}` : ""}`).then(json<SkillCurationProposalRecord[]>),
  updateSkillCurationProposalStatus: (id: string, status: SkillCurationProposalStatus) =>
    fetch(`/api/skill-curation-proposals/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ status }),
    }).then(json<{ ok: true }>),
  applyApprovedCurationProposals: (workspaceId: string) =>
    fetch(`/api/workspaces/${workspaceId}/skill-curation-proposals/apply`, { method: "POST" }).then(json<SkillCurationApplyResult>),
  retrieveSkills: (workspaceId: string, query: string, topK?: number) =>
    fetch(`/api/workspaces/${workspaceId}/skills/retrieve`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query, topK }),
    }).then(json<RetrievedSkill[]>),
  runAutonomousTask: (workspaceId: string, query: string, model?: string, topK?: number) =>
    fetch(`/api/workspaces/${workspaceId}/autonomous-run`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query, model, topK }),
    }).then(json<AutonomousRunResult>),

  // ---- Knowledge Graph ----
  listKgNodes: (workspaceId: string, includeHidden = false) =>
    fetch(`/api/workspaces/${workspaceId}/kg/nodes${includeHidden ? "?includeHidden=true" : ""}`).then(json<KgNode[]>),
  listKgEdges: (workspaceId: string) =>
    fetch(`/api/workspaces/${workspaceId}/kg/edges`).then(json<KgEdge[]>),
  syncKnowledgeGraph: (workspaceId: string) =>
    fetch(`/api/workspaces/${workspaceId}/kg/sync`, { method: "POST" }).then(json<KgSyncResult>),
  extractKgEntities: (workspaceId: string) =>
    fetch(`/api/workspaces/${workspaceId}/kg/extract`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({}) }).then(json<import("@/types").KgExtractResult>),
  setKgNodeHidden: (nodeId: string, hidden: boolean) =>
    fetch(`/api/kg/nodes/${nodeId}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ hidden }) }).then(json<{ ok: true }>),
  addKgEdge: (workspaceId: string, fromId: string, toId: string, relation: import("@/types").KgRelation) =>
    fetch(`/api/workspaces/${workspaceId}/kg/edges`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ fromId, toId, relation }) }).then(json<KgEdge>),
  deleteKgEdge: (edgeId: string) =>
    fetch(`/api/kg/edges/${edgeId}`, { method: "DELETE" }).then(json<{ ok: true }>),
  getKgPrompt: (workspaceId: string) =>
    fetch(`/api/workspaces/${workspaceId}/kg-prompt`).then(json<{ prompt: string; count: number; reportCount: number; edgeCount: number; updatedAt: number | null }>),

  // ---- Report History ----
  scanReports: () =>
    fetch(`/api/reports/scan`).then(json<{ entries: import("@/types").ReportEntry[]; scannedAt: number }>),
  addReportFavorite: async (id: string) => {
    const res = await fetch(`/api/reports/favorite`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id }),
    });
    if (!res.ok) throw new Error(`POST favorite ${res.status}`);
    return res.json() as Promise<{ success: boolean }>;
  },
  removeReportFavorite: async (id: string) => {
    const res = await fetch(`/api/reports/favorite/${encodeURIComponent(id)}`, { method: "DELETE" });
    if (!res.ok) throw new Error(`DELETE favorite ${res.status}`);
    return res.json() as Promise<{ success: boolean }>;
  },
  getReportFileContent: async (path: string) => {
    const res = await fetch(`/api/reports/file?path=${encodeURIComponent(path)}`);
    if (!res.ok) throw new Error(`GET file ${res.status}: ${await res.text()}`);
    return res.text();
  },
  openReportInFinder: async (path: string) => {
    const res = await fetch(`/api/reports/open`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ path }),
    });
    if (!res.ok) throw new Error(`POST open ${res.status}`);
    return res.json() as Promise<{ success: boolean }>;
  },
  listReportTags: () =>
    fetch(`/api/reports/tags`).then(json<Array<{ tag: string; count: number }>>),
  addReportTag: async (reportId: string, tag: string) => {
    const res = await fetch(`/api/reports/${encodeURIComponent(reportId)}/tags`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ tag }),
    });
    if (!res.ok) throw new Error(`POST tag ${res.status}: ${await res.text()}`);
    return res.json() as Promise<{ success: boolean }>;
  },
  removeReportTag: async (reportId: string, tag: string) => {
    const res = await fetch(`/api/reports/${encodeURIComponent(reportId)}/tags/${encodeURIComponent(tag)}`, { method: "DELETE" });
    if (!res.ok) throw new Error(`DELETE tag ${res.status}`);
    return res.json() as Promise<{ success: boolean }>;
  },
};
