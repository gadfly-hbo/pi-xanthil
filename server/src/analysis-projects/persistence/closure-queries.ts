/**
 * Closure persistence helpers (T0019 revised per C1R/C2R).
 *
 * Persistence for S3.1-S3.6 Business Closure stage facts per authoritative
 * fifteen-state AnalysisOps lifecycle. Application services (T0019b) will wrap
 * these with idempotent commands, state transitions, and audit.
 *
 * Contract (docs/workcanger-s3-business-closure-structure-ledger.md §20 C1R/C2R):
 * - Validate raw inputs before persistence.
 * - Fail closed on invalid enum/stage, missing workspace/project/locked report
 *   ownership, duplicate cycle/stage facts, wrong workspace, orphan rows,
 *   invalid iteration branch, and missing S3 prerequisite facts.
 * - Scope all read helpers by workspace_id at the SQL layer.
 * - No update helpers for stage facts (status transitions = T0019b).
 * - Do not parse Report JSON; recommendation_id stored as-is.
 */
import type { DatabaseSync } from "node:sqlite";
import { ApplicationError } from "../contracts/envelope.ts";

// ---------------------------------------------------------------------------
// Row types
// ---------------------------------------------------------------------------

export interface ClosureCycleRow {
  readonly closure_cycle_id: string;
  readonly analysis_project_id: string;
  readonly workspace_id: string;
  readonly locked_report_version_id: string;
  readonly closure_ordinal: number;
  readonly cycle_status: string;
  readonly current_stage: string | null;
  readonly initiated_at: string;
  readonly initiated_by_actor_id: string;
  readonly updated_at: string;
}

export interface S31TranslationRow {
  readonly translation_id: string;
  readonly closure_cycle_id: string;
  readonly business_action_artifact_ref: string;
  readonly business_action_content_sha256: string;
  readonly selected_recommendations_json: string;
  readonly business_rules_json: string;
  readonly thresholds_json: string;
  readonly segments_json: string;
  readonly gray_release_targets_json: string;
  readonly feedback_metric_definitions_json: string;
  readonly translation_status: string;
  readonly confirmed_at: string | null;
  readonly confirmed_by_actor_id: string | null;
  readonly created_at: string;
  readonly updated_at: string;
}

export interface S32DeploymentRow {
  readonly deployment_id: string;
  readonly closure_cycle_id: string;
  readonly downstream_system: string;
  readonly deployment_ticket_ref: string;
  readonly gray_config_json: string;
  readonly rollback_path: string;
  readonly deployment_status: string;
  readonly confirmed_at: string | null;
  readonly confirmed_by_actor_id: string | null;
  readonly created_at: string;
  readonly updated_at: string;
}

export interface S33ExecutionRow {
  readonly execution_id: string;
  readonly closure_cycle_id: string;
  readonly business_scope_json: string;
  readonly owner_role: string;
  readonly execution_window_start: string;
  readonly execution_window_end: string;
  readonly action_version: string;
  readonly touched_population: number | null;
  readonly execution_log_ref: string | null;
  readonly feedback_source: string;
  readonly created_at: string;
  readonly updated_at: string;
}

export interface S34IngestionRow {
  readonly ingestion_id: string;
  readonly closure_cycle_id: string;
  readonly feedback_ordinal: number;
  readonly feedback_dataset_ref: string;
  readonly metrics_json: string;
  readonly statistical_significance: string;
  readonly pi_handoff_ref: string | null;
  readonly antigravity_review_status: string;
  readonly reviewed_at: string | null;
  readonly reviewed_by_actor_id: string | null;
  readonly created_at: string;
  readonly updated_at: string;
}

export interface S35EvaluationRow {
  readonly evaluation_id: string;
  readonly closure_cycle_id: string;
  readonly evaluation_report_ref: string;
  readonly evaluation_report_sha256: string;
  readonly deviation_analysis_json: string;
  readonly hypothesis_result: string;
  readonly effectiveness_rating: string;
  readonly reviewer_actor_id: string;
  readonly reviewed_at: string;
  readonly created_at: string;
  readonly updated_at: string;
}

export interface S36TriggerRow {
  readonly trigger_id: string;
  readonly closure_cycle_id: string;
  readonly branch: string;
  readonly target_state: string | null;
  readonly successor_project_id: string | null;
  readonly work_order_ref: string | null;
  readonly knowledge_base_update_ref: string | null;
  readonly triggered_at: string;
  readonly triggered_by_actor_id: string;
  readonly created_at: string;
  readonly updated_at: string;
}

// ---------------------------------------------------------------------------
// Validation + ownership helpers
// ---------------------------------------------------------------------------

const CYCLE_STATUSES = new Set(["initiated", "in_progress", "archived", "iterating"]);
const STAGES = new Set(["S3.1", "S3.2", "S3.3", "S3.4", "S3.5", "S3.6"]);
const TRANSLATION_STATUSES = new Set(["draft", "confirmed"]);
const DOWNSTREAM_SYSTEMS = new Set(["cdp_tag_engine", "marketing_automation", "bi_reports", "other"]);
const DEPLOYMENT_STATUSES = new Set(["pending", "test_verified", "gray_verified", "fully_deployed", "failed", "rolled_back"]);
const FEEDBACK_SOURCES = new Set(["execution_log", "conversion_data", "tag_hit_log", "combined"]);
const SIGNIFICANCE_STATUSES = new Set(["not_reached", "reached", "pending"]);
const REVIEW_STATUSES = new Set(["pending", "passed", "rejected"]);
const HYPOTHESIS_RESULTS = new Set(["confirmed", "rejected", "inconclusive"]);
const EFFECTIVENESS_RATINGS = new Set(["met_expectations", "significant_deviation", "warning"]);
const BRANCHES = new Set(["archive", "iterate"]);

function assertIn(set: Set<string>, value: string, label: string): void {
  if (!set.has(value)) throw new ApplicationError("validation_failed", `Unknown ${label}: ${value}. Allowed: ${[...set].join(", ")}.`);
}

function assertActor(db: DatabaseSync, actorId: string): void {
  const row = db.prepare("SELECT audit_actor_id FROM audit_actors WHERE audit_actor_id = ?").get(actorId);
  if (!row) throw new ApplicationError("resource_not_found", `Actor ${actorId} not found.`);
}

function assertProjectInWorkspace(db: DatabaseSync, ws: string, projectId: string): void {
  const row = db.prepare("SELECT analysis_project_id FROM analysis_projects WHERE analysis_project_id = ? AND workspace_id = ?").get(projectId, ws);
  if (!row) throw new ApplicationError("resource_not_found", `Project ${projectId} not found in workspace ${ws}.`);
}

function assertReportInProject(db: DatabaseSync, projectId: string, reportId: string): void {
  const row = db.prepare("SELECT report_version_id FROM report_versions WHERE report_version_id = ? AND analysis_project_id = ?").get(reportId, projectId);
  if (!row) throw new ApplicationError("resource_not_found", `Report version ${reportId} not found in project ${projectId}.`);
}

function assertCycleInWorkspace(db: DatabaseSync, ws: string, cycleId: string): void {
  const row = db.prepare("SELECT closure_cycle_id FROM closure_cycles WHERE closure_cycle_id = ? AND workspace_id = ?").get(cycleId, ws);
  if (!row) throw new ApplicationError("resource_not_found", `Closure cycle ${cycleId} not found in workspace ${ws}.`);
}

/** Check that a prerequisite stage fact exists before inserting the next stage.
 *  Joins closure_cycles to verify workspace ownership (no workspace_id on stage tables). */
function assertPrerequisite(db: DatabaseSync, ws: string, cycleId: string, table: string): void {
  const row = db.prepare(`SELECT 1 FROM ${table} t JOIN closure_cycles cr ON t.closure_cycle_id = cr.closure_cycle_id WHERE t.closure_cycle_id = ? AND cr.workspace_id = ?`).get(cycleId, ws);
  if (!row) throw new ApplicationError("validation_failed", `Prerequisite ${table} not found for cycle ${cycleId} in workspace ${ws}.`);
}

// ---------------------------------------------------------------------------
// closure_cycles insert + read
// ---------------------------------------------------------------------------

export interface InsertClosureCycleInput {
  readonly closureCycleId: string; readonly analysisProjectId: string; readonly workspaceId: string;
  readonly lockedReportVersionId: string; readonly closureOrdinal: number; readonly cycleStatus: string;
  readonly currentStage: string | null; readonly initiatedAt: string; readonly initiatedByActorId: string; readonly updatedAt: string;
}

export function insertClosureCycle(db: DatabaseSync, input: InsertClosureCycleInput): ClosureCycleRow {
  assertIn(CYCLE_STATUSES, input.cycleStatus, "cycle_status");
  if (input.currentStage !== null) assertIn(STAGES, input.currentStage, "current_stage");
  if (!Number.isInteger(input.closureOrdinal) || input.closureOrdinal <= 0)
    throw new ApplicationError("validation_failed", `closure_ordinal must be a positive integer.`);
  assertProjectInWorkspace(db, input.workspaceId, input.analysisProjectId);
  assertReportInProject(db, input.analysisProjectId, input.lockedReportVersionId);
  assertActor(db, input.initiatedByActorId);
  try {
    db.prepare(`INSERT INTO closure_cycles (closure_cycle_id, analysis_project_id, workspace_id, locked_report_version_id, closure_ordinal, cycle_status, current_stage, initiated_at, initiated_by_actor_id, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(input.closureCycleId, input.analysisProjectId, input.workspaceId, input.lockedReportVersionId, input.closureOrdinal, input.cycleStatus, input.currentStage, input.initiatedAt, input.initiatedByActorId, input.updatedAt);
  } catch (err) {
    if ((err as Error).message.includes("UNIQUE")) throw new ApplicationError("validation_failed", `Duplicate (project, ordinal): ${input.analysisProjectId}/${input.closureOrdinal}.`);
    throw err;
  }
  return getClosureCycleById(db, input.workspaceId, input.closureCycleId)!;
}

export function getClosureCycleById(db: DatabaseSync, ws: string, cycleId: string): ClosureCycleRow | undefined {
  return db.prepare(`SELECT * FROM closure_cycles WHERE closure_cycle_id = ? AND workspace_id = ?`).get(cycleId, ws) as ClosureCycleRow | undefined;
}

export function listClosureCyclesByProject(db: DatabaseSync, ws: string, projectId: string): ClosureCycleRow[] {
  return db.prepare(`SELECT * FROM closure_cycles WHERE analysis_project_id = ? AND workspace_id = ? ORDER BY closure_ordinal`).all(projectId, ws) as unknown as ClosureCycleRow[];
}

export function countClosureCyclesByProject(db: DatabaseSync, ws: string, projectId: string): number {
  return (db.prepare(`SELECT COUNT(*) AS c FROM closure_cycles WHERE analysis_project_id = ? AND workspace_id = ?`).get(projectId, ws) as { c: number }).c;
}

// ---------------------------------------------------------------------------
// S3.1 conclusion_translation
// ---------------------------------------------------------------------------

export interface InsertS31Input {
  readonly translationId: string; readonly closureCycleId: string; readonly workspaceId: string;
  readonly businessActionArtifactRef: string; readonly businessActionContentSha256: string;
  readonly selectedRecommendationsJson: string; readonly businessRulesJson: string;
  readonly thresholdsJson: string; readonly segmentsJson: string;
  readonly grayReleaseTargetsJson: string; readonly feedbackMetricDefinitionsJson: string;
  readonly translationStatus: string; readonly confirmedAt: string | null;
  readonly confirmedByActorId: string | null; readonly createdAt: string; readonly updatedAt: string;
}

export function insertS31Translation(db: DatabaseSync, input: InsertS31Input): S31TranslationRow {
  assertIn(TRANSLATION_STATUSES, input.translationStatus, "translation_status");
  assertCycleInWorkspace(db, input.workspaceId, input.closureCycleId);
  if (input.confirmedByActorId) assertActor(db, input.confirmedByActorId);
  db.prepare(`INSERT INTO s31_conclusion_translations (translation_id, closure_cycle_id, business_action_artifact_ref, business_action_content_sha256, selected_recommendations_json, business_rules_json, thresholds_json, segments_json, gray_release_targets_json, feedback_metric_definitions_json, translation_status, confirmed_at, confirmed_by_actor_id, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(input.translationId, input.closureCycleId, input.businessActionArtifactRef, input.businessActionContentSha256, input.selectedRecommendationsJson, input.businessRulesJson, input.thresholdsJson, input.segmentsJson, input.grayReleaseTargetsJson, input.feedbackMetricDefinitionsJson, input.translationStatus, input.confirmedAt, input.confirmedByActorId, input.createdAt, input.updatedAt);
  return getS31Translation(db, input.workspaceId, input.closureCycleId)!;
}

export function getS31Translation(db: DatabaseSync, ws: string, cycleId: string): S31TranslationRow | undefined {
  return db.prepare(`SELECT t.* FROM s31_conclusion_translations t JOIN closure_cycles cr ON t.closure_cycle_id = cr.closure_cycle_id WHERE t.closure_cycle_id = ? AND cr.workspace_id = ?`).get(cycleId, ws) as S31TranslationRow | undefined;
}

// ---------------------------------------------------------------------------
// S3.2 system_deployment (prerequisite: S3.1)
// ---------------------------------------------------------------------------

export interface InsertS32Input {
  readonly deploymentId: string; readonly closureCycleId: string; readonly workspaceId: string;
  readonly downstreamSystem: string; readonly deploymentTicketRef: string;
  readonly grayConfigJson: string; readonly rollbackPath: string; readonly deploymentStatus: string;
  readonly confirmedAt: string | null; readonly confirmedByActorId: string | null;
  readonly createdAt: string; readonly updatedAt: string;
}

export function insertS32Deployment(db: DatabaseSync, input: InsertS32Input): S32DeploymentRow {
  assertIn(DOWNSTREAM_SYSTEMS, input.downstreamSystem, "downstream_system");
  assertIn(DEPLOYMENT_STATUSES, input.deploymentStatus, "deployment_status");
  assertCycleInWorkspace(db, input.workspaceId, input.closureCycleId);
  assertPrerequisite(db, input.workspaceId, input.closureCycleId, "s31_conclusion_translations");
  if (input.confirmedByActorId) assertActor(db, input.confirmedByActorId);
  db.prepare(`INSERT INTO s32_system_deployments (deployment_id, closure_cycle_id, downstream_system, deployment_ticket_ref, gray_config_json, rollback_path, deployment_status, confirmed_at, confirmed_by_actor_id, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)`)
    .run(input.deploymentId, input.closureCycleId, input.downstreamSystem, input.deploymentTicketRef, input.grayConfigJson, input.rollbackPath, input.deploymentStatus, input.confirmedAt, input.confirmedByActorId, input.createdAt, input.updatedAt);
  return getS32Deployment(db, input.workspaceId, input.closureCycleId)!;
}

export function getS32Deployment(db: DatabaseSync, ws: string, cycleId: string): S32DeploymentRow | undefined {
  return db.prepare(`SELECT t.* FROM s32_system_deployments t JOIN closure_cycles cr ON t.closure_cycle_id = cr.closure_cycle_id WHERE t.closure_cycle_id = ? AND cr.workspace_id = ?`).get(cycleId, ws) as S32DeploymentRow | undefined;
}

// ---------------------------------------------------------------------------
// S3.3 business_execution (prerequisite: S3.2)
// ---------------------------------------------------------------------------

export interface InsertS33Input {
  readonly executionId: string; readonly closureCycleId: string; readonly workspaceId: string;
  readonly businessScopeJson: string; readonly ownerRole: string;
  readonly executionWindowStart: string; readonly executionWindowEnd: string;
  readonly actionVersion: string; readonly touchedPopulation: number | null;
  readonly executionLogRef: string | null; readonly feedbackSource: string;
  readonly createdAt: string; readonly updatedAt: string;
}

export function insertS33Execution(db: DatabaseSync, input: InsertS33Input): S33ExecutionRow {
  assertIn(FEEDBACK_SOURCES, input.feedbackSource, "feedback_source");
  assertCycleInWorkspace(db, input.workspaceId, input.closureCycleId);
  assertPrerequisite(db, input.workspaceId, input.closureCycleId, "s32_system_deployments");
  db.prepare(`INSERT INTO s33_business_executions (execution_id, closure_cycle_id, business_scope_json, owner_role, execution_window_start, execution_window_end, action_version, touched_population, execution_log_ref, feedback_source, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(input.executionId, input.closureCycleId, input.businessScopeJson, input.ownerRole, input.executionWindowStart, input.executionWindowEnd, input.actionVersion, input.touchedPopulation, input.executionLogRef, input.feedbackSource, input.createdAt, input.updatedAt);
  return getS33Execution(db, input.workspaceId, input.closureCycleId)!;
}

export function getS33Execution(db: DatabaseSync, ws: string, cycleId: string): S33ExecutionRow | undefined {
  return db.prepare(`SELECT t.* FROM s33_business_executions t JOIN closure_cycles cr ON t.closure_cycle_id = cr.closure_cycle_id WHERE t.closure_cycle_id = ? AND cr.workspace_id = ?`).get(cycleId, ws) as S33ExecutionRow | undefined;
}

// ---------------------------------------------------------------------------
// S3.4 feedback_ingestion (prerequisite: S3.3)
// ---------------------------------------------------------------------------

export interface InsertS34Input {
  readonly ingestionId: string; readonly closureCycleId: string; readonly workspaceId: string;
  readonly feedbackOrdinal: number; readonly feedbackDatasetRef: string; readonly metricsJson: string;
  readonly statisticalSignificance: string; readonly piHandoffRef: string | null;
  readonly antigravityReviewStatus: string; readonly reviewedAt: string | null;
  readonly reviewedByActorId: string | null; readonly createdAt: string; readonly updatedAt: string;
}

export function insertS34Ingestion(db: DatabaseSync, input: InsertS34Input): S34IngestionRow {
  assertIn(SIGNIFICANCE_STATUSES, input.statisticalSignificance, "statistical_significance");
  assertIn(REVIEW_STATUSES, input.antigravityReviewStatus, "antigravity_review_status");
  if (!Number.isInteger(input.feedbackOrdinal) || input.feedbackOrdinal <= 0)
    throw new ApplicationError("validation_failed", "feedback_ordinal must be a positive integer.");
  assertCycleInWorkspace(db, input.workspaceId, input.closureCycleId);
  assertPrerequisite(db, input.workspaceId, input.closureCycleId, "s33_business_executions");
  if (input.reviewedByActorId) assertActor(db, input.reviewedByActorId);
  try {
    db.prepare(`INSERT INTO s34_feedback_ingestions (ingestion_id, closure_cycle_id, feedback_ordinal, feedback_dataset_ref, metrics_json, statistical_significance, pi_handoff_ref, antigravity_review_status, reviewed_at, reviewed_by_actor_id, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(input.ingestionId, input.closureCycleId, input.feedbackOrdinal, input.feedbackDatasetRef, input.metricsJson, input.statisticalSignificance, input.piHandoffRef, input.antigravityReviewStatus, input.reviewedAt, input.reviewedByActorId, input.createdAt, input.updatedAt);
  } catch (err) {
    if ((err as Error).message.includes("UNIQUE"))
      throw new ApplicationError("validation_failed", `Duplicate feedback_ordinal ${input.feedbackOrdinal} for cycle ${input.closureCycleId}.`);
    throw err;
  }
  return getS34IngestionById(db, input.workspaceId, input.ingestionId)!;
}

export function getS34IngestionById(db: DatabaseSync, ws: string, ingestionId: string): S34IngestionRow | undefined {
  return db.prepare(`SELECT t.* FROM s34_feedback_ingestions t JOIN closure_cycles cr ON t.closure_cycle_id = cr.closure_cycle_id WHERE t.ingestion_id = ? AND cr.workspace_id = ?`).get(ingestionId, ws) as S34IngestionRow | undefined;
}

export function listS34FeedbackByCycle(db: DatabaseSync, ws: string, cycleId: string): S34IngestionRow[] {
  return db.prepare(`SELECT t.* FROM s34_feedback_ingestions t JOIN closure_cycles cr ON t.closure_cycle_id = cr.closure_cycle_id WHERE t.closure_cycle_id = ? AND cr.workspace_id = ? ORDER BY t.feedback_ordinal`).all(cycleId, ws) as unknown as S34IngestionRow[];
}

// ---------------------------------------------------------------------------
// S3.5 effect_evaluation (prerequisite: S3.4)
// ---------------------------------------------------------------------------

export interface InsertS35Input {
  readonly evaluationId: string; readonly closureCycleId: string; readonly workspaceId: string;
  readonly evaluationReportRef: string; readonly evaluationReportSha256: string;
  readonly deviationAnalysisJson: string; readonly hypothesisResult: string;
  readonly effectivenessRating: string; readonly reviewerActorId: string;
  readonly reviewedAt: string; readonly createdAt: string; readonly updatedAt: string;
}

export function insertS35Evaluation(db: DatabaseSync, input: InsertS35Input): S35EvaluationRow {
  assertIn(HYPOTHESIS_RESULTS, input.hypothesisResult, "hypothesis_result");
  assertIn(EFFECTIVENESS_RATINGS, input.effectivenessRating, "effectiveness_rating");
  assertCycleInWorkspace(db, input.workspaceId, input.closureCycleId);
  assertPrerequisite(db, input.workspaceId, input.closureCycleId, "s34_feedback_ingestions");
  assertActor(db, input.reviewerActorId);
  db.prepare(`INSERT INTO s35_effect_evaluations (evaluation_id, closure_cycle_id, evaluation_report_ref, evaluation_report_sha256, deviation_analysis_json, hypothesis_result, effectiveness_rating, reviewer_actor_id, reviewed_at, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)`)
    .run(input.evaluationId, input.closureCycleId, input.evaluationReportRef, input.evaluationReportSha256, input.deviationAnalysisJson, input.hypothesisResult, input.effectivenessRating, input.reviewerActorId, input.reviewedAt, input.createdAt, input.updatedAt);
  return getS35Evaluation(db, input.workspaceId, input.closureCycleId)!;
}

export function getS35Evaluation(db: DatabaseSync, ws: string, cycleId: string): S35EvaluationRow | undefined {
  return db.prepare(`SELECT t.* FROM s35_effect_evaluations t JOIN closure_cycles cr ON t.closure_cycle_id = cr.closure_cycle_id WHERE t.closure_cycle_id = ? AND cr.workspace_id = ?`).get(cycleId, ws) as S35EvaluationRow | undefined;
}

// ---------------------------------------------------------------------------
// S3.6 iteration_trigger (prerequisite: S3.5)
// ---------------------------------------------------------------------------

export interface InsertS36Input {
  readonly triggerId: string; readonly closureCycleId: string; readonly workspaceId: string;
  readonly branch: string; readonly targetState: string | null;
  readonly successorProjectId: string | null; readonly workOrderRef: string | null;
  readonly knowledgeBaseUpdateRef: string | null; readonly triggeredAt: string;
  readonly triggeredByActorId: string; readonly createdAt: string; readonly updatedAt: string;
}

export function insertS36Trigger(db: DatabaseSync, input: InsertS36Input): S36TriggerRow {
  assertIn(BRANCHES, input.branch, "branch");
  if (input.branch === "iterate" && !input.targetState)
    throw new ApplicationError("validation_failed", "iterate branch requires target_state.");
  if (input.branch === "archive" && input.targetState !== null)
    throw new ApplicationError("validation_failed", "archive branch must have null target_state.");
  assertCycleInWorkspace(db, input.workspaceId, input.closureCycleId);
  assertPrerequisite(db, input.workspaceId, input.closureCycleId, "s35_effect_evaluations");
  assertActor(db, input.triggeredByActorId);
  db.prepare(`INSERT INTO s36_iteration_triggers (trigger_id, closure_cycle_id, branch, target_state, successor_project_id, work_order_ref, knowledge_base_update_ref, triggered_at, triggered_by_actor_id, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)`)
    .run(input.triggerId, input.closureCycleId, input.branch, input.targetState, input.successorProjectId, input.workOrderRef, input.knowledgeBaseUpdateRef, input.triggeredAt, input.triggeredByActorId, input.createdAt, input.updatedAt);
  return getS36Trigger(db, input.workspaceId, input.closureCycleId)!;
}

export function getS36Trigger(db: DatabaseSync, ws: string, cycleId: string): S36TriggerRow | undefined {
  return db.prepare(`SELECT t.* FROM s36_iteration_triggers t JOIN closure_cycles cr ON t.closure_cycle_id = cr.closure_cycle_id WHERE t.closure_cycle_id = ? AND cr.workspace_id = ?`).get(cycleId, ws) as S36TriggerRow | undefined;
}
