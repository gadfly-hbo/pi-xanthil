import { json } from "./_http";
import type {
  Ontology,
  ObjectType,
  ObjectKind,
  PropertyType,
  LinkType,
  LinkKind,
  MetricDefinition,
  MetricDefinitionInput,
  OntologyGraph,
  LogicRule,
  LogicRuleInput,
  OntoAction,
  OntoActionInput,
  OntoPrompt,
  OntoPromptInput,
  ActionItemDraft,
  ActionItem,
  ActionTask,
  ActionFeedback,
  ExtractJob,
} from "@/types";

// 单一真源：Action 契约由 @/types 持有（总控），此处仅 re-export 供本域消费者引用。
export type { ActionItemDraft, ActionItem, ActionTask, ActionFeedback } from "@/types";

export interface Dashboard {
  id: string;
  workspace_id: string;
  name: string;
  layout_json: string;
  created_at: number;
  updated_at: number;
}

export interface OntoExtractResult {
  createdObjects: number;
  createdLinks: number;
  createdLogicRules: number;
  createdActions: number;
  skippedObjects: number;
  skippedLinks: number;
  report: {
    hasFatal: boolean;
    totalIssues: number;
    issues: Array<{ severity: "fatal" | "error" | "warning" | "info"; code: string; message: string }>;
  };
}

const jsonBody = (method: string, body?: unknown): RequestInit => ({
  method,
  headers: { "Content-Type": "application/json" },
  body: body === undefined ? undefined : JSON.stringify(body),
});

export const vizApi = {
  listDashboards: (workspaceId: string) =>
    fetch(`/api/dashboards?workspaceId=${encodeURIComponent(workspaceId)}`).then(json<Dashboard[]>),
  createDashboard: (data: { workspaceId: string; name: string; layoutJson: string }) =>
    fetch("/api/dashboards", jsonBody("POST", data)).then(json<Dashboard>),
  updateDashboard: (id: string, data: { name?: string; layoutJson?: string }) =>
    fetch(`/api/dashboards/${encodeURIComponent(id)}`, jsonBody("PUT", data)).then(json<Dashboard>),
  deleteDashboard: (id: string) =>
    fetch(`/api/dashboards/${encodeURIComponent(id)}`, jsonBody("DELETE")).then(json<{ success: boolean }>),

  // ---- onto-xanthil（详见 docs/onto-xanthil-design.md）----
  listOntologies: (workspaceId: string) =>
    fetch(`/api/workspaces/${encodeURIComponent(workspaceId)}/ontologies`).then(json<Ontology[]>),
  createOntology: (workspaceId: string, data: { name: string; domain?: string; version?: string }) =>
    fetch(`/api/workspaces/${encodeURIComponent(workspaceId)}/ontologies`, jsonBody("POST", data)).then(json<Ontology>),
  updateOntology: (oid: string, data: Partial<Pick<Ontology, "name" | "domain" | "version" | "status">>) =>
    fetch(`/api/ontologies/${encodeURIComponent(oid)}`, jsonBody("PATCH", data)).then(json<Ontology>),
  deleteOntology: (oid: string) =>
    fetch(`/api/ontologies/${encodeURIComponent(oid)}`, jsonBody("DELETE")).then(json<{ success: boolean }>),

  listObjects: (oid: string, kind?: ObjectKind) =>
    fetch(`/api/ontologies/${encodeURIComponent(oid)}/objects${kind ? `?kind=${kind}` : ""}`).then(json<ObjectType[]>),
  createObject: (oid: string, data: { kind: ObjectKind; nameCn: string; nameEn?: string; description?: string; boundPathId?: string; confidence?: number }) =>
    fetch(`/api/ontologies/${encodeURIComponent(oid)}/objects`, jsonBody("POST", data)).then(json<ObjectType>),
  createObjectFromAggregation: (oid: string, data: { boundPathId: string; nameCn?: string }) =>
    fetch(`/api/ontologies/${encodeURIComponent(oid)}/objects/from-aggregation`, jsonBody("POST", data)).then(json<{ object: ObjectType; properties: PropertyType[] }>),
  updateObject: (objId: string, data: Partial<Pick<ObjectType, "kind" | "nameCn" | "nameEn" | "description" | "boundPathId" | "confidence">>) =>
    fetch(`/api/objects/${encodeURIComponent(objId)}`, jsonBody("PATCH", data)).then(json<ObjectType>),
  deleteObject: (objId: string) =>
    fetch(`/api/objects/${encodeURIComponent(objId)}`, jsonBody("DELETE")).then(json<{ success: boolean }>),

  listProperties: (objId: string) =>
    fetch(`/api/objects/${encodeURIComponent(objId)}/properties`).then(json<PropertyType[]>),
  createProperty: (objId: string, data: { name: string; dataType?: PropertyType["dataType"]; boundColumn?: string; semanticType?: string; description?: string }) =>
    fetch(`/api/objects/${encodeURIComponent(objId)}/properties`, jsonBody("POST", data)).then(json<PropertyType>),
  updateProperty: (propId: string, data: Partial<Omit<PropertyType, "id" | "objectTypeId">>) =>
    fetch(`/api/properties/${encodeURIComponent(propId)}`, jsonBody("PATCH", data)).then(json<PropertyType>),
  deleteProperty: (propId: string) =>
    fetch(`/api/properties/${encodeURIComponent(propId)}`, jsonBody("DELETE")).then(json<{ success: boolean }>),

  listLinks: (oid: string) =>
    fetch(`/api/ontologies/${encodeURIComponent(oid)}/links`).then(json<LinkType[]>),
  createLink: (oid: string, data: { sourceObjectId: string; targetObjectId: string; kind: LinkKind; joinKeys?: Array<{ source: string; target: string }>; confidence?: number }) =>
    fetch(`/api/ontologies/${encodeURIComponent(oid)}/links`, jsonBody("POST", data)).then(json<LinkType>),
  deleteLink: (linkId: string) =>
    fetch(`/api/links/${encodeURIComponent(linkId)}`, jsonBody("DELETE")).then(json<{ success: boolean }>),

  getOntologyGraph: (oid: string) =>
    fetch(`/api/ontologies/${encodeURIComponent(oid)}/graph`).then(json<OntologyGraph>),
  extractOntology: (oid: string, data: { text: string; model?: string; promptTemplate?: string }) =>
    fetch(`/api/ontologies/${encodeURIComponent(oid)}/extract`, jsonBody("POST", data)).then(json<OntoExtractResult>),
  startChunkedExtract: (oid: string, data: { text: string; model?: string; promptTemplate?: string; fileName?: string }) =>
    fetch(`/api/ontologies/${encodeURIComponent(oid)}/extract-chunked`, jsonBody("POST", data)).then(json<{ jobId: string }>),
  getExtractJob: (jobId: string) =>
    fetch(`/api/extract-jobs/${encodeURIComponent(jobId)}`).then(json<ExtractJob>),
  abortExtractJob: (jobId: string) =>
    fetch(`/api/extract-jobs/${encodeURIComponent(jobId)}/abort`, jsonBody("POST")).then(json<{ success: boolean }>),

  listMetrics: (workspaceId: string) =>
    fetch(`/api/workspaces/${encodeURIComponent(workspaceId)}/metrics`).then(json<MetricDefinition[]>),
  createMetric: (workspaceId: string, data: MetricDefinitionInput) =>
    fetch(`/api/workspaces/${encodeURIComponent(workspaceId)}/metrics`, jsonBody("POST", data)).then(json<MetricDefinition>),
  updateMetric: (metricId: string, data: Partial<MetricDefinitionInput & { enabled: boolean }>) =>
    fetch(`/api/metrics/${encodeURIComponent(metricId)}`, jsonBody("PATCH", data)).then(json<MetricDefinition>),
  deleteMetric: (metricId: string) =>
    fetch(`/api/metrics/${encodeURIComponent(metricId)}`, jsonBody("DELETE")).then(json<{ success: boolean }>),
  backfillMetricsFromStandards: (workspaceId: string) =>
    fetch(`/api/workspaces/${encodeURIComponent(workspaceId)}/metrics/backfill-from-standards`, jsonBody("POST")).then(json<{ migrated: number; skipped: number }>),

  // ---- Logic Rule（本体形式化规则层，P6）----
  listLogicRules: (oid: string) =>
    fetch(`/api/ontologies/${encodeURIComponent(oid)}/logic-rules`).then(json<LogicRule[]>),
  createLogicRule: (oid: string, data: LogicRuleInput) =>
    fetch(`/api/ontologies/${encodeURIComponent(oid)}/logic-rules`, jsonBody("POST", data)).then(json<LogicRule>),
  updateLogicRule: (ruleId: string, data: Partial<LogicRuleInput>) =>
    fetch(`/api/logic-rules/${encodeURIComponent(ruleId)}`, jsonBody("PATCH", data)).then(json<LogicRule>),
  deleteLogicRule: (ruleId: string) =>
    fetch(`/api/logic-rules/${encodeURIComponent(ruleId)}`, jsonBody("DELETE")).then(json<{ success: boolean }>),

  // ---- Onto Action（可执行动作层，P6）----
  listOntoActions: (oid: string) =>
    fetch(`/api/ontologies/${encodeURIComponent(oid)}/actions`).then(json<OntoAction[]>),
  createOntoAction: (oid: string, data: OntoActionInput) =>
    fetch(`/api/ontologies/${encodeURIComponent(oid)}/actions`, jsonBody("POST", data)).then(json<OntoAction>),
  updateOntoAction: (actionId: string, data: Partial<OntoActionInput>) =>
    fetch(`/api/actions/${encodeURIComponent(actionId)}`, jsonBody("PATCH", data)).then(json<OntoAction>),
  deleteOntoAction: (actionId: string) =>
    fetch(`/api/actions/${encodeURIComponent(actionId)}`, jsonBody("DELETE")).then(json<{ success: boolean }>),

  // ---- Onto Prompt 管理（抽取 prompt 版本化/复用，P8）----
  listOntoPrompts: (workspaceId: string) =>
    fetch(`/api/workspaces/${encodeURIComponent(workspaceId)}/onto-prompts`).then(json<OntoPrompt[]>),
  createOntoPrompt: (workspaceId: string, data: OntoPromptInput) =>
    fetch(`/api/workspaces/${encodeURIComponent(workspaceId)}/onto-prompts`, jsonBody("POST", data)).then(json<OntoPrompt>),
  updateOntoPrompt: (promptId: string, data: Partial<OntoPromptInput>) =>
    fetch(`/api/onto-prompts/${encodeURIComponent(promptId)}`, jsonBody("PATCH", data)).then(json<OntoPrompt>),
  deleteOntoPrompt: (promptId: string) =>
    fetch(`/api/onto-prompts/${encodeURIComponent(promptId)}`, jsonBody("DELETE")).then(json<{ success: boolean }>),

  // ---- Actions（行动闭环）----
  extractActions: (data: { source: "session" | "flow-run"; sessionId?: string; flowId?: string; runId?: string; path: string; prompt?: string; model?: string }) =>
    fetch(`/api/actions/extract`, jsonBody("POST", data)).then(json<ActionItemDraft[]>),
  
  listActionItems: (scopeId: string, reportPath?: string) =>
    fetch(`/api/action-items?scope=${encodeURIComponent(scopeId)}${reportPath ? `&reportPath=${encodeURIComponent(reportPath)}` : ""}`).then(json<ActionItem[]>),
  createActionItem: (data: Omit<ActionItem, "id" | "createdAt" | "updatedAt">) =>
    fetch(`/api/action-items`, jsonBody("POST", data)).then(json<ActionItem>),
  updateActionItem: (id: string, data: Partial<Omit<ActionItem, "id" | "createdAt" | "updatedAt">>) =>
    fetch(`/api/action-items/${encodeURIComponent(id)}`, jsonBody("PATCH", data)).then(json<ActionItem>),
  deleteActionItem: (id: string) =>
    fetch(`/api/action-items/${encodeURIComponent(id)}`, jsonBody("DELETE")).then(json<{ success: boolean }>),

  listActionTasks: (params: { actionItemId?: string; scopeId?: string }) => {
    const q = new URLSearchParams();
    if (params.actionItemId) q.set("actionItemId", params.actionItemId);
    if (params.scopeId) q.set("scope", params.scopeId);
    return fetch(`/api/action-tasks?${q.toString()}`).then(json<ActionTask[]>);
  },
  createActionTask: (data: Omit<ActionTask, "id" | "createdAt" | "updatedAt">) =>
    fetch(`/api/action-tasks`, jsonBody("POST", data)).then(json<ActionTask>),
  updateActionTask: (id: string, data: Partial<Omit<ActionTask, "id" | "createdAt" | "updatedAt">>) =>
    fetch(`/api/action-tasks/${encodeURIComponent(id)}`, jsonBody("PATCH", data)).then(json<ActionTask>),

  getActionFeedback: (taskId: string) =>
    fetch(`/api/action-tasks/${encodeURIComponent(taskId)}/feedback`).then(json<ActionFeedback>),
  submitActionFeedback: (taskId: string, data: Omit<ActionFeedback, "id" | "taskId" | "createdAt">) =>
    fetch(`/api/action-tasks/${encodeURIComponent(taskId)}/feedback`, jsonBody("POST", data)).then(json<ActionFeedback>),
};
