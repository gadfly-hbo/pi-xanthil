/**
 * Analysis Projects v1 API route table (pi-Xanthil).
 *
 * Routes are workspace-scoped: /api/analysis-projects/v1/workspaces/:workspaceId/...
 * No auth/session/token routes - stable local human actor injected by runtime.
 */
import { GET, POST, PATCH, DELETE } from "./router.ts";
import type { Route } from "./router.ts";
import {
  handleCreateProject,
  handleListProjects,
  handleProjectDetail,
  handleUpdateProject,
  handleDeleteProject,
  handleCancelProject,
  handleArchiveProject,
  handleUnarchiveProject,
  handleReopenProject,
} from "./handlers/projects.ts";
import { handleUploadEvidence, handleEvidenceContent } from "./handlers/evidence.ts";
import { handleSubmitAnalysisRequest } from "./handlers/requests.ts";
import { createCapabilitiesHandler } from "./handlers/capabilities.ts";
import { handleCommandExecution } from "./handlers/command-execution.ts";
import { createRequirementHandlers } from "./handlers/requirements.ts";
import { createPlanHandlers } from "./handlers/plans.ts";
import { createRunHandlers } from "./handlers/runs.ts";
import { createReportHandlers } from "./handlers/reports.ts";
import {
  handleInitiateClosureCycle,
  handleRecordS31Translation,
  handleRecordS32Deployment,
  handleRecordS33Execution,
  handleAppendS34Feedback,
  handleRecordS35Evaluation,
  handleRecordS36Trigger,
  handleClosureDetail,
  handleClosureList,
} from "./handlers/closures.ts";
import type { RequirementEngineHandler } from "../application/requirements/requirement-service.ts";
import type { PlanEngineHandler } from "../application/plans/plan-service.ts";
import type { RunCoordinator } from "../application/runs/run-coordinator.ts";
import type { RunDispatcher } from "../application/runs/run-dispatcher.ts";
import type { AgentHarnessCapabilityRegistry } from "../contracts/agentharness-port.ts";

/** Shared Engine handler type covering both requirement and plan generation. */
export type EngineHandler = RequirementEngineHandler & PlanEngineHandler;

const WS_PREFIX = "/api/analysis-projects/v1/workspaces/{workspaceId}";

function createBaseRoutes(engineAvailable: boolean, agentHarnessRegistry: AgentHarnessCapabilityRegistry | null = null): readonly Route[] {
  return [
    // Workspace-scoped Projects
    POST(`${WS_PREFIX}/projects`, handleCreateProject),
    GET(`${WS_PREFIX}/projects`, handleListProjects),
    GET(`${WS_PREFIX}/projects/{projectId}`, handleProjectDetail),
    PATCH(`${WS_PREFIX}/projects/{projectId}`, handleUpdateProject),
    DELETE(`${WS_PREFIX}/projects/{projectId}`, handleDeleteProject),
    POST(`${WS_PREFIX}/projects/{projectId}:cancel`, handleCancelProject),
    POST(`${WS_PREFIX}/projects/{projectId}:archive`, handleArchiveProject),
    POST(`${WS_PREFIX}/projects/{projectId}:unarchive`, handleUnarchiveProject),
    POST(`${WS_PREFIX}/projects/{projectId}:reopen`, handleReopenProject),

    // Workspace-scoped Evidence
    POST(`${WS_PREFIX}/projects/{projectId}/evidence:upload`, handleUploadEvidence),
    GET(`${WS_PREFIX}/projects/{projectId}/evidence/{evidenceArtifactId}/content`, handleEvidenceContent),

    // Workspace-scoped Analysis Request
    POST(`${WS_PREFIX}/projects/{projectId}/analysis-request:submit`, handleSubmitAnalysisRequest),

    // Non workspace-scoped capabilities
    GET("/api/analysis-projects/v1/capabilities", createCapabilitiesHandler(engineAvailable, agentHarnessRegistry)),

    // Workspace-scoped command execution status
    GET(`${WS_PREFIX}/command-executions/{idempotencyRecordId}`, handleCommandExecution),

    // S3.x Business Closure
    POST(`${WS_PREFIX}/projects/{projectId}/closure-cycles:initiate`, handleInitiateClosureCycle),
    GET(`${WS_PREFIX}/projects/{projectId}/closure-cycles`, handleClosureList),
    POST(`${WS_PREFIX}/closure-cycles/{closureCycleId}/s31-translations`, handleRecordS31Translation),
    POST(`${WS_PREFIX}/closure-cycles/{closureCycleId}/s32-deployments`, handleRecordS32Deployment),
    POST(`${WS_PREFIX}/closure-cycles/{closureCycleId}/s33-executions`, handleRecordS33Execution),
    POST(`${WS_PREFIX}/closure-cycles/{closureCycleId}/s34-feedback`, handleAppendS34Feedback),
    POST(`${WS_PREFIX}/closure-cycles/{closureCycleId}/s35-evaluations`, handleRecordS35Evaluation),
    POST(`${WS_PREFIX}/closure-cycles/{closureCycleId}/s36-triggers`, handleRecordS36Trigger),
    GET(`${WS_PREFIX}/closure-cycles/{closureCycleId}`, handleClosureDetail),
  ];
}

/** Base routes without requirement/plan/run/report handlers. */
export const routes: readonly Route[] = createBaseRoutes(false);

/**
 * Create the full route table including requirement, plan, and run handlers.
 * Engine-dependent routes are only mounted when engineHandler is provided.
 * When engine is unavailable, those routes return 503.
 */
export function createRoutes(engineHandler: EngineHandler | null, runCoordinator?: RunCoordinator | null, runDispatcher?: RunDispatcher | null, agentHarnessRegistry: AgentHarnessCapabilityRegistry | null = null): readonly Route[] {
  if (!engineHandler) return createBaseRoutes(false, agentHarnessRegistry);
  const { handleGenerateRequirement, handleDecideRequirementConfirmation, handleRequirementReview } = createRequirementHandlers(engineHandler);
  const { handleGeneratePlan, handleDecidePlanConfirmation, handlePlanReview } = createPlanHandlers(engineHandler, runDispatcher);
  const { handleReportReview, handleDecideReview, handleLockedReport } = createReportHandlers();
  const fullRoutes: Route[] = [
    ...createBaseRoutes(true, agentHarnessRegistry),
    // Requirements
    POST(`${WS_PREFIX}/projects/{projectId}/requirements:generate`, handleGenerateRequirement),
    POST(`${WS_PREFIX}/projects/{projectId}/requirements/{requirementVersionId}:decide-confirmation`, handleDecideRequirementConfirmation),
    GET(`${WS_PREFIX}/projects/{projectId}/requirements/{requirementVersionId}`, handleRequirementReview),
    // Plans
    POST(`${WS_PREFIX}/projects/{projectId}/plans:generate`, handleGeneratePlan),
    POST(`${WS_PREFIX}/projects/{projectId}/plans/{planVersionId}:decide-confirmation`, handleDecidePlanConfirmation),
    GET(`${WS_PREFIX}/projects/{projectId}/plans/{planVersionId}`, handlePlanReview),
    // Reports
    GET(`${WS_PREFIX}/projects/{projectId}/reports/{reportVersionId}`, handleReportReview),
    POST(`${WS_PREFIX}/projects/{projectId}/reports/{reportVersionId}:decide-review`, handleDecideReview),
    GET(`${WS_PREFIX}/projects/{projectId}/locked-report`, handleLockedReport),
  ];
  // Run routes (only if run coordinator is injected)
  if (runCoordinator) {
    const { handleAbortRun, handleRetryRun, handleRunProgress } = createRunHandlers(runCoordinator);
    fullRoutes.push(
      POST(`${WS_PREFIX}/projects/{projectId}/runs/{runId}:abort`, handleAbortRun),
      POST(`${WS_PREFIX}/projects/{projectId}/runs/{runId}:retry`, handleRetryRun),
      GET(`${WS_PREFIX}/projects/{projectId}/runs/{runId}`, handleRunProgress),
    );
  }
  return fullRoutes;
}
