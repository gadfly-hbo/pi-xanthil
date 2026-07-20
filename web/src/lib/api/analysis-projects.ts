import { json } from "./_http";
import type {
  ProjectListReadModel,
  ProjectDetailReadModel,
  CapabilitiesResponse,
  ClosureListReadModel,
  ClosureDetailReadModel,
  ClosureCommandResult,
  RequirementReviewReadModel,
} from "@/types/analysis-projects";

const BASE = "/api/analysis-projects/v1";

function wsBase(workspaceId: string): string {
  return `${BASE}/workspaces/${workspaceId}`;
}

function generateIdempotencyKey(): string {
  return crypto.randomUUID();
}

interface SuccessEnvelope {
  readonly schemaVersion: string;
  readonly requestId: string;
  readonly data: unknown;
}

interface ErrorEnvelopeBody {
  readonly schemaVersion: string;
  readonly requestId: string;
  readonly error: {
    readonly code: string;
    readonly summary: string;
    readonly fieldErrors: readonly { readonly fieldPath: string; readonly code: string; readonly summary: string }[];
    readonly retryDirective: string;
    readonly diagnosticEvidenceArtifactId: string | null;
  };
}

async function postCommand(url: string, body: unknown): Promise<ClosureCommandResult> {
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Idempotency-Key": generateIdempotencyKey(),
    },
    body: JSON.stringify(body),
  });

  const raw: unknown = await res.json();

  if (res.ok) {
    const envelope = raw as SuccessEnvelope;
    const data = envelope.data as Record<string, unknown> | undefined;
    const status = data?.status as string | undefined;
    if (status === "in_progress") {
      return { kind: "in_progress", recordId: data?.idempotencyRecordId as string | undefined };
    }
    if (status === "succeeded") {
      return {
        kind: "replayed_success",
        resultResourceType: data?.resultResourceType as string | undefined,
        resultResourceId: data?.resultResourceId as string | undefined,
        recordId: data?.idempotencyRecordId as string | undefined,
      };
    }
    return { kind: "executed", data: envelope.data };
  }

  const errEnvelope = raw as ErrorEnvelopeBody;
  const errCode = errEnvelope.error?.code ?? "unknown";
  if (errCode === "idempotency_key_reused") {
    return { kind: "conflict", errorCode: errCode, errorSummary: errEnvelope.error?.summary };
  }
  return {
    kind: "failed",
    errorCode: errCode,
    errorSummary: errEnvelope.error?.summary ?? "请求失败",
    fieldErrors: errEnvelope.error?.fieldErrors,
  };
}

// ---------------------------------------------------------------------------
// Create project result (reuses ClosureCommandResult shape for command envelope)
// ---------------------------------------------------------------------------

export type CreateProjectResult = ClosureCommandResult;

// ---------------------------------------------------------------------------
// Analysis Projects API slot
// ---------------------------------------------------------------------------

export const analysisProjectsApi = {
  // --- Capabilities (non-workspace-scoped) ---
  getAnalysisProjectCapabilities(): Promise<CapabilitiesResponse> {
    return fetch(`${BASE}/capabilities`).then(json<CapabilitiesResponse>);
  },

  // --- Create project ---
  createAnalysisProject(
    workspaceId: string,
    body: { title: string; slug: string },
  ): Promise<CreateProjectResult> {
    return postCommand(`${wsBase(workspaceId)}/projects`, body);
  },

  // --- Project list ---
  listAnalysisProjects(
    workspaceId: string,
    opts?: {
      kind?: string;
      status?: string;
      archiveState?: "archived" | "unarchived" | "all";
      limit?: number;
      cursor?: string | null;
    },
  ): Promise<ProjectListReadModel> {
    const params = new URLSearchParams();
    if (opts?.kind) params.set("kind", opts.kind);
    if (opts?.status) params.set("status", opts.status);
    if (opts?.archiveState) params.set("archiveState", opts.archiveState);
    if (opts?.limit) params.set("limit", String(opts.limit));
    if (opts?.cursor) params.set("cursor", opts.cursor);
    const qs = params.toString();
    return fetch(`${wsBase(workspaceId)}/projects${qs ? `?${qs}` : ""}`).then(json<ProjectListReadModel>);
  },

  // --- Project detail ---
  getAnalysisProjectDetail(
    workspaceId: string,
    projectId: string,
  ): Promise<ProjectDetailReadModel> {
    return fetch(`${wsBase(workspaceId)}/projects/${projectId}`).then(json<ProjectDetailReadModel>);
  },

  // --- Project lifecycle ---
  updateProject(
    workspaceId: string,
    projectId: string,
    body: { title: string; slug: string; expectedUpdatedAt: string },
  ): Promise<ClosureCommandResult> {
    const url = `${wsBase(workspaceId)}/projects/${projectId}`;
    return fetch(url, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": generateIdempotencyKey(),
      },
      body: JSON.stringify(body),
    }).then(async (r) => {
      const raw = await r.json() as unknown;
      if (r.ok) {
        const envelope = raw as SuccessEnvelope;
        return { kind: "executed" as const, data: envelope.data };
      }
      const errEnvelope = raw as ErrorEnvelopeBody;
      return { kind: "failed" as const, errorCode: errEnvelope.error?.code ?? "unknown", errorSummary: errEnvelope.error?.summary ?? "更新失败" };
    });
  },

  deleteDraftProject(
    workspaceId: string,
    projectId: string,
    body: { confirmPermanentDeletion: boolean },
  ): Promise<ClosureCommandResult> {
    const url = `${wsBase(workspaceId)}/projects/${projectId}`;
    return fetch(url, {
      method: "DELETE",
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": generateIdempotencyKey(),
      },
      body: JSON.stringify(body),
    }).then(async (r) => {
      const raw = await r.json() as unknown;
      if (r.ok) {
        const envelope = raw as SuccessEnvelope;
        return { kind: "executed" as const, data: envelope.data };
      }
      const errEnvelope = raw as ErrorEnvelopeBody;
      return { kind: "failed" as const, errorCode: errEnvelope.error?.code ?? "unknown", errorSummary: errEnvelope.error?.summary ?? "删除失败" };
    });
  },

  cancelProject(
    workspaceId: string,
    projectId: string,
    body: { expectedUpdatedAt: string },
  ): Promise<ClosureCommandResult> {
    return postCommand(`${wsBase(workspaceId)}/projects/${projectId}:cancel`, body);
  },

  archiveProject(
    workspaceId: string,
    projectId: string,
    body: { expectedUpdatedAt: string },
  ): Promise<ClosureCommandResult> {
    return postCommand(`${wsBase(workspaceId)}/projects/${projectId}:archive`, body);
  },

  unarchiveProject(
    workspaceId: string,
    projectId: string,
    body: { expectedUpdatedAt: string },
  ): Promise<ClosureCommandResult> {
    return postCommand(`${wsBase(workspaceId)}/projects/${projectId}:unarchive`, body);
  },

  reopenProject(
    workspaceId: string,
    projectId: string,
    body: { title: string; slug: string; expectedUpdatedAt: string },
  ): Promise<ClosureCommandResult> {
    return postCommand(`${wsBase(workspaceId)}/projects/${projectId}:reopen`, body);
  },

  // --- Evidence ---
  uploadEvidence(
    workspaceId: string,
    projectId: string,
    metadata: {
      displayName: string;
      declaredDataScope: string;
      usageConstraints: string[];
      safetyHandlingPolicy: "local_transform_required" | "controlled_or_derived_allowed" | "derived_only_allowed";
      safetyClass: "restricted_raw" | "controlled" | "derived";
      declaredMediaType: string;
      declaredByteSize: number;
      description?: string;
    },
    contentFile: File | Blob,
  ): Promise<ClosureCommandResult> {
    const fd = new FormData();
    fd.append("metadata", JSON.stringify(metadata));
    const blob = contentFile instanceof File ? contentFile : new File([contentFile], "upload", { type: metadata.declaredMediaType });
    fd.append("content", blob, blob.name);
    return fetch(`${wsBase(workspaceId)}/projects/${projectId}/evidence:upload`, {
      method: "POST",
      headers: {
        "Idempotency-Key": generateIdempotencyKey(),
      },
      body: fd,
    }).then(async (r) => {
      const raw = await r.json() as unknown;
      if (r.ok) {
        const envelope = raw as SuccessEnvelope;
        return { kind: "executed" as const, data: envelope.data };
      }
      const errEnvelope = raw as ErrorEnvelopeBody;
      return { kind: "failed" as const, errorCode: errEnvelope.error?.code ?? "unknown", errorSummary: errEnvelope.error?.summary ?? "上传失败" };
    });
  },

  getEvidenceContent(
    workspaceId: string,
    projectId: string,
    evidenceArtifactId: string,
  ): Promise<Blob> {
    return fetch(`${wsBase(workspaceId)}/projects/${projectId}/evidence/${evidenceArtifactId}/content`).then((r) => {
      if (!r.ok) throw new Error(`${r.status} evidence content fetch failed`);
      return r.blob();
    });
  },

  // --- Analysis request ---
  submitAnalysisRequest(
    workspaceId: string,
    projectId: string,
    body: {
      rawRequestText: string;
      contextEvidenceArtifactIds: string[];
      locale: string;
      timezone: string;
    },
  ): Promise<ClosureCommandResult> {
    return postCommand(`${wsBase(workspaceId)}/projects/${projectId}/analysis-request:submit`, body);
  },

  // --- Requirements ---
  generateRequirement(
    workspaceId: string,
    projectId: string,
    body?: {
      expectedProjectUpdatedAt?: string;
      previousRequirementVersionId?: string;
      triggeringGateDecisionId?: string;
    },
  ): Promise<ClosureCommandResult> {
    return postCommand(`${wsBase(workspaceId)}/projects/${projectId}/requirements:generate`, body ?? {});
  },

  getRequirementReview(
    workspaceId: string,
    projectId: string,
    requirementVersionId: string,
  ): Promise<RequirementReviewReadModel> {
    return fetch(`${wsBase(workspaceId)}/projects/${projectId}/requirements/${requirementVersionId}`).then(json<RequirementReviewReadModel>);
  },

  // --- S3.x Business Closure ---

  listClosureCycles(
    workspaceId: string,
    projectId: string,
  ): Promise<ClosureListReadModel> {
    return fetch(`${wsBase(workspaceId)}/projects/${projectId}/closure-cycles`).then(json<ClosureListReadModel>);
  },

  getClosureDetail(
    workspaceId: string,
    closureCycleId: string,
  ): Promise<ClosureDetailReadModel> {
    return fetch(`${wsBase(workspaceId)}/closure-cycles/${closureCycleId}`).then(json<ClosureDetailReadModel>);
  },

  initiateClosureCycle(
    workspaceId: string,
    projectId: string,
    body: { lockedReportVersionId: string; closureOrdinal: number },
  ): Promise<ClosureCommandResult> {
    return postCommand(`${wsBase(workspaceId)}/projects/${projectId}/closure-cycles:initiate`, body);
  },

  recordS31Translation(
    workspaceId: string,
    closureCycleId: string,
    body: {
      businessActionArtifactRef: string;
      businessActionContentSha256: string;
      selectedRecommendationsJson: string;
      businessRulesJson: string;
      thresholdsJson: string;
      segmentsJson: string;
      grayReleaseTargetsJson: string;
      feedbackMetricDefinitionsJson: string;
      translationStatus: "draft" | "confirmed";
    },
  ): Promise<ClosureCommandResult> {
    return postCommand(`${wsBase(workspaceId)}/closure-cycles/${closureCycleId}/s31-translations`, body);
  },

  recordS32Deployment(
    workspaceId: string,
    closureCycleId: string,
    body: {
      downstreamSystem: "cdp_tag_engine" | "marketing_automation" | "bi_reports" | "other";
      deploymentTicketRef: string;
      grayConfigJson: string;
      rollbackPath: string;
      deploymentStatus: "pending" | "test_verified" | "gray_verified" | "fully_deployed" | "failed" | "rolled_back";
    },
  ): Promise<ClosureCommandResult> {
    return postCommand(`${wsBase(workspaceId)}/closure-cycles/${closureCycleId}/s32-deployments`, body);
  },

  recordS33Execution(
    workspaceId: string,
    closureCycleId: string,
    body: {
      businessScopeJson: string;
      ownerRole: string;
      executionWindowStart: string;
      executionWindowEnd: string;
      actionVersion: string;
      feedbackSource: "execution_log" | "conversion_data" | "tag_hit_log" | "combined";
      touchedPopulation?: number | null;
      executionLogRef?: string | null;
    },
  ): Promise<ClosureCommandResult> {
    return postCommand(`${wsBase(workspaceId)}/closure-cycles/${closureCycleId}/s33-executions`, body);
  },

  appendS34Feedback(
    workspaceId: string,
    closureCycleId: string,
    body: {
      feedbackOrdinal: number;
      feedbackDatasetRef: string;
      metricsJson: string;
      statisticalSignificance: "not_reached" | "reached" | "pending";
      antigravityReviewStatus: "pending" | "passed" | "rejected";
      piHandoffRef?: string | null;
      reviewedAt?: string | null;
      reviewedByActorId?: string | null;
    },
  ): Promise<ClosureCommandResult> {
    return postCommand(`${wsBase(workspaceId)}/closure-cycles/${closureCycleId}/s34-feedback`, body);
  },

  recordS35Evaluation(
    workspaceId: string,
    closureCycleId: string,
    body: {
      evaluationReportRef: string;
      evaluationReportSha256: string;
      deviationAnalysisJson: string;
      hypothesisResult: "confirmed" | "rejected" | "inconclusive";
      effectivenessRating: "met_expectations" | "significant_deviation" | "warning";
    },
  ): Promise<ClosureCommandResult> {
    return postCommand(`${wsBase(workspaceId)}/closure-cycles/${closureCycleId}/s35-evaluations`, body);
  },

  recordS36Trigger(
    workspaceId: string,
    closureCycleId: string,
    body: {
      branch: "archive" | "iterate";
      targetState?: "S1.1" | "S2.3" | null;
      successorProjectId?: string | null;
      workOrderRef?: string | null;
      knowledgeBaseUpdateRef?: string | null;
    },
  ): Promise<ClosureCommandResult> {
    return postCommand(`${wsBase(workspaceId)}/closure-cycles/${closureCycleId}/s36-triggers`, body);
  },
};
