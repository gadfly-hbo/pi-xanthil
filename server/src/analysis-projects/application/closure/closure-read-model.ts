/**
 * S3.x Business Closure read models (T0020 revised).
 *
 * Non-materialized read models for closure detail and list, scoped by
 * workspaceId at the SQL boundary. Every child fact query joins
 * closure_cycles to verify workspace ownership at the SQL layer.
 * S3.4 returns all feedback entries ordered by feedback_ordinal (append-only per C6).
 *
 * Authority: docs/workcanger-s3-business-closure-structure-ledger.md §20 C1R/C2R.
 */
import type { DatabaseSync } from "node:sqlite";
import { ApplicationError } from "../../contracts/envelope.ts";
import type {
  ClosureDetailData,
  ClosureCycleRef,
  S31FactRef,
  S32FactRef,
  S33FactRef,
  S34FactRef,
  S35FactRef,
  S36FactRef,
  ClosureCycleStatus,
  ClosureStage,
} from "../../contracts/closure.ts";
import type { ReadModelEnvelope } from "../../contracts/dto.ts";

const READ_MODEL_VERSION = "1.0";

/** Workspace-scoped JOIN clause for child stage tables. */
const WS_JOIN = `JOIN closure_cycles cr ON t.closure_cycle_id = cr.closure_cycle_id AND cr.workspace_id = ?`;

// ---------------------------------------------------------------------------
// Closure detail (single cycle with all S3.1-S3.6 facts)
// ---------------------------------------------------------------------------

export interface ClosureDetailQuery {
  readonly db: DatabaseSync;
  readonly workspaceId: string;
  readonly closureCycleId: string;
}

export function queryClosureDetail(
  query: ClosureDetailQuery,
): ReadModelEnvelope<ClosureDetailData> {
  const { db, workspaceId, closureCycleId } = query;
  db.exec("BEGIN");
  try {
    const cycleRow = db.prepare(
      `SELECT * FROM closure_cycles WHERE closure_cycle_id = ? AND workspace_id = ?`,
    ).get(closureCycleId, workspaceId) as Record<string, unknown> | undefined;

    if (!cycleRow) {
      throw new ApplicationError("resource_not_found", "Closure cycle not found.");
    }

    const cycle: ClosureCycleRef = {
      closureCycleId: cycleRow.closure_cycle_id as string,
      analysisProjectId: cycleRow.analysis_project_id as string,
      closureOrdinal: cycleRow.closure_ordinal as number,
      cycleStatus: cycleRow.cycle_status as ClosureCycleStatus,
      currentStage: (cycleRow.current_stage as ClosureStage) ?? null,
      initiatedAt: cycleRow.initiated_at as string,
      initiatedByActorId: cycleRow.initiated_by_actor_id as string,
      updatedAt: cycleRow.updated_at as string,
    };

    const s31 = queryS31Fact(db, workspaceId, closureCycleId);
    const s32 = queryS32Fact(db, workspaceId, closureCycleId);
    const s33 = queryS33Fact(db, workspaceId, closureCycleId);
    const s34 = queryS34Facts(db, workspaceId, closureCycleId);
    const s35 = queryS35Fact(db, workspaceId, closureCycleId);
    const s36 = queryS36Fact(db, workspaceId, closureCycleId);

    db.exec("COMMIT");
    return {
      readModelVersion: READ_MODEL_VERSION,
      generatedAt: new Date().toISOString(),
      data: { cycle, s31, s32, s33, s34, s35, s36 },
    };
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
}

function queryS31Fact(db: DatabaseSync, ws: string, cycleId: string): S31FactRef | null {
  const row = db.prepare(
    `SELECT t.translation_id, t.business_action_artifact_ref, t.translation_status, t.confirmed_at, t.created_at
     FROM s31_conclusion_translations t ${WS_JOIN}
     WHERE t.closure_cycle_id = ?`,
  ).get(ws, cycleId) as Record<string, unknown> | undefined;
  if (!row) return null;
  return {
    translationId: row.translation_id as string,
    businessActionArtifactRef: row.business_action_artifact_ref as string,
    translationStatus: row.translation_status as S31FactRef["translationStatus"],
    confirmedAt: (row.confirmed_at as string) ?? null,
    createdAt: row.created_at as string,
  };
}

function queryS32Fact(db: DatabaseSync, ws: string, cycleId: string): S32FactRef | null {
  const row = db.prepare(
    `SELECT t.deployment_id, t.downstream_system, t.deployment_ticket_ref, t.deployment_status, t.confirmed_at, t.created_at
     FROM s32_system_deployments t ${WS_JOIN}
     WHERE t.closure_cycle_id = ?`,
  ).get(ws, cycleId) as Record<string, unknown> | undefined;
  if (!row) return null;
  return {
    deploymentId: row.deployment_id as string,
    downstreamSystem: row.downstream_system as S32FactRef["downstreamSystem"],
    deploymentTicketRef: row.deployment_ticket_ref as string,
    deploymentStatus: row.deployment_status as S32FactRef["deploymentStatus"],
    confirmedAt: (row.confirmed_at as string) ?? null,
    createdAt: row.created_at as string,
  };
}

function queryS33Fact(db: DatabaseSync, ws: string, cycleId: string): S33FactRef | null {
  const row = db.prepare(
    `SELECT t.execution_id, t.owner_role, t.execution_window_start, t.execution_window_end, t.feedback_source, t.created_at
     FROM s33_business_executions t ${WS_JOIN}
     WHERE t.closure_cycle_id = ?`,
  ).get(ws, cycleId) as Record<string, unknown> | undefined;
  if (!row) return null;
  return {
    executionId: row.execution_id as string,
    ownerRole: row.owner_role as string,
    executionWindowStart: row.execution_window_start as string,
    executionWindowEnd: row.execution_window_end as string,
    feedbackSource: row.feedback_source as S33FactRef["feedbackSource"],
    createdAt: row.created_at as string,
  };
}

function queryS34Facts(db: DatabaseSync, ws: string, cycleId: string): readonly S34FactRef[] {
  const rows = db.prepare(
    `SELECT t.ingestion_id, t.feedback_ordinal, t.feedback_dataset_ref, t.statistical_significance, t.antigravity_review_status, t.created_at
     FROM s34_feedback_ingestions t ${WS_JOIN}
     WHERE t.closure_cycle_id = ?
     ORDER BY t.feedback_ordinal`,
  ).all(ws, cycleId) as Array<Record<string, unknown>>;
  return rows.map((row) => ({
    ingestionId: row.ingestion_id as string,
    feedbackOrdinal: row.feedback_ordinal as number,
    feedbackDatasetRef: row.feedback_dataset_ref as string,
    statisticalSignificance: row.statistical_significance as S34FactRef["statisticalSignificance"],
    antigravityReviewStatus: row.antigravity_review_status as S34FactRef["antigravityReviewStatus"],
    createdAt: row.created_at as string,
  }));
}

function queryS35Fact(db: DatabaseSync, ws: string, cycleId: string): S35FactRef | null {
  const row = db.prepare(
    `SELECT t.evaluation_id, t.hypothesis_result, t.effectiveness_rating, t.reviewed_at, t.created_at
     FROM s35_effect_evaluations t ${WS_JOIN}
     WHERE t.closure_cycle_id = ?`,
  ).get(ws, cycleId) as Record<string, unknown> | undefined;
  if (!row) return null;
  return {
    evaluationId: row.evaluation_id as string,
    hypothesisResult: row.hypothesis_result as S35FactRef["hypothesisResult"],
    effectivenessRating: row.effectiveness_rating as S35FactRef["effectivenessRating"],
    reviewedAt: row.reviewed_at as string,
    createdAt: row.created_at as string,
  };
}

function queryS36Fact(db: DatabaseSync, ws: string, cycleId: string): S36FactRef | null {
  const row = db.prepare(
    `SELECT t.trigger_id, t.branch, t.target_state, t.triggered_at, t.created_at
     FROM s36_iteration_triggers t ${WS_JOIN}
     WHERE t.closure_cycle_id = ?`,
  ).get(ws, cycleId) as Record<string, unknown> | undefined;
  if (!row) return null;
  return {
    triggerId: row.trigger_id as string,
    branch: row.branch as S36FactRef["branch"],
    targetState: (row.target_state as S36FactRef["targetState"]) ?? null,
    triggeredAt: row.triggered_at as string,
    createdAt: row.created_at as string,
  };
}

// ---------------------------------------------------------------------------
// Closure list (all cycles for a project)
// ---------------------------------------------------------------------------

export interface ClosureListQuery {
  readonly db: DatabaseSync;
  readonly workspaceId: string;
  readonly analysisProjectId: string;
}

export function queryClosureList(
  query: ClosureListQuery,
): ReadModelEnvelope<readonly ClosureCycleRef[]> {
  const { db, workspaceId, analysisProjectId } = query;
  const rows = db.prepare(
    `SELECT * FROM closure_cycles WHERE analysis_project_id = ? AND workspace_id = ? ORDER BY closure_ordinal`,
  ).all(analysisProjectId, workspaceId) as Array<Record<string, unknown>>;

  const cycles: ClosureCycleRef[] = rows.map((row) => ({
    closureCycleId: row.closure_cycle_id as string,
    analysisProjectId: row.analysis_project_id as string,
    closureOrdinal: row.closure_ordinal as number,
    cycleStatus: row.cycle_status as ClosureCycleStatus,
    currentStage: (row.current_stage as ClosureStage) ?? null,
    initiatedAt: row.initiated_at as string,
    initiatedByActorId: row.initiated_by_actor_id as string,
    updatedAt: row.updated_at as string,
  }));

  return {
    readModelVersion: READ_MODEL_VERSION,
    generatedAt: new Date().toISOString(),
    data: cycles,
  };
}
