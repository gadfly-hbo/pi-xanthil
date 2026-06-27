import { randomUUID } from "node:crypto";
import { join, resolve } from "node:path";
import { db } from "../db.ts";
import { enableForOrigin, setMemoryEnablement, disableItemEverywhere } from "./shared.ts";
import { detectSkillActivation } from "../skill-activation.ts";
import { parseEvaluationError, serializeEvaluationError } from "../evaluation-errors.ts";
import type { ChangeManifest, CollectFolder, CommandCaseSummary, CommandEvalCase, CommandEvalSet, CommandEvaluation, CommandEvaluationDetail, CommandEvaluationRunResult, HarnessComponent, HarnessVariant, HookCaseSummary, HookEvalCase, HookEvalSet, HookEvaluation, HookEvaluationDetail, HookEvaluationRunResult, PromptEvalSet, PromptEvalTask, PromptEvaluation, PromptEvaluationDetail, PromptEvaluationRunResult, PromptPairwiseResult, PromptPairwiseSummary, PromptTaskSummary, PromptVariant, PromptVariantSummary, ScopedRevision, SkillEvalSet, SkillEvalTask, SkillEvaluation, SkillEvaluationDetail, SkillEvaluationRunResult, SkillPairwiseResult, SkillPairwiseSummary, SkillTaskSummary, SkillVariant, SkillVariantSummary, SkillRegressionStatus, SkillRegistryEntry, SkillRegistryInput, SkillSource, SkillStatus, SubAgentCaseSummary, SubAgentEvalCase, SubAgentEvalSet, SubAgentEvaluation, SubAgentEvaluationDetail, SubAgentEvaluationRunResult, ToolCaseSet, ToolCaseSummary, ToolEvalCase, ToolEvaluation, ToolEvaluationDetail, ToolEvaluationRunResult } from "../types.ts";

/**
 * 【Agent-E · 智能引擎域】db 表 slot —— owner: codex(GPT-5.5)
 * Notebook / 新 eval 维度等引擎域新表建在此（flows/sessions/eval legacy 仍在 db.ts）。
 * 约定: 新表 CREATE TABLE IF NOT EXISTS; 配套 CRUD 写本文件, 由 routes/engine.ts 调用。
 */
export function initEngineTables(): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS change_manifests (
      edit_id TEXT PRIMARY KEY,
      component TEXT NOT NULL,
      failure_evidence TEXT NOT NULL DEFAULT '',
      root_cause TEXT NOT NULL DEFAULT '',
      targeted_fix TEXT NOT NULL DEFAULT '',
      predicted_fix TEXT NOT NULL DEFAULT '[]',
      predicted_regression TEXT NOT NULL DEFAULT '[]',
      outcome TEXT NOT NULL,
      outcome_reason TEXT,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_change_manifests_created ON change_manifests(created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_change_manifests_component ON change_manifests(component, created_at DESC);
    CREATE TABLE IF NOT EXISTS harness_edits (
      edit_id TEXT PRIMARY KEY,
      component TEXT NOT NULL,
      resource_id TEXT NOT NULL,
      scope TEXT NOT NULL,
      before_snapshot TEXT NOT NULL,
      after_snapshot TEXT NOT NULL,
      manifest_edit_id TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_harness_edits_component_resource ON harness_edits(component, resource_id);
    CREATE INDEX IF NOT EXISTS idx_harness_edits_manifest ON harness_edits(manifest_edit_id);
    CREATE TABLE IF NOT EXISTS harness_variants (
      variant_id TEXT PRIMARY KEY,
      base_edit_id TEXT NOT NULL,
      per_task_routing TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_harness_variants_edit ON harness_variants(base_edit_id);
  `);
  db.exec(`
    CREATE TABLE IF NOT EXISTS skill_registry_eval_history (
      id                         TEXT PRIMARY KEY,
      workspace_id               TEXT NOT NULL,
      registry_id                TEXT NOT NULL,
      slug                       TEXT NOT NULL,
      skill_version              INTEGER NOT NULL,
      evaluation_id              TEXT NOT NULL,
      model                      TEXT NOT NULL,
      trigger_kind               TEXT NOT NULL,
      score                      REAL,
      activation_rate            REAL,
      previous_evaluation_id     TEXT,
      previous_score             REAL,
      previous_activation_rate   REAL,
      score_delta                REAL,
      activation_delta           REAL,
      regression_status          TEXT NOT NULL DEFAULT 'none',
      regression_reason          TEXT,
      created_at                 INTEGER NOT NULL
    );
  `);
  db.exec("CREATE INDEX IF NOT EXISTS idx_skill_registry_eval_history_skill ON skill_registry_eval_history(workspace_id, slug, created_at DESC)");
  db.exec("CREATE INDEX IF NOT EXISTS idx_skill_registry_eval_history_registry ON skill_registry_eval_history(registry_id, created_at DESC)");
  db.exec(`
    CREATE TABLE IF NOT EXISTS prompt_eval_sets (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL REFERENCES workspaces(id),
      name TEXT NOT NULL,
      tasks TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_prompt_eval_sets_ws ON prompt_eval_sets(workspace_id, updated_at DESC);
    CREATE TABLE IF NOT EXISTS prompt_evaluations (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL REFERENCES workspaces(id),
      model TEXT NOT NULL,
      repeat INTEGER NOT NULL,
      status TEXT NOT NULL,
      started_at INTEGER NOT NULL,
      ended_at INTEGER NOT NULL,
      duration_sec REAL NOT NULL DEFAULT 0,
      variants TEXT NOT NULL,
      tasks TEXT NOT NULL,
      variant_summaries TEXT NOT NULL,
      task_summaries TEXT NOT NULL,
      pairwise_summaries TEXT NOT NULL DEFAULT '[]'
    );
    CREATE INDEX IF NOT EXISTS idx_prompt_evaluations_ws ON prompt_evaluations(workspace_id, started_at DESC);
    CREATE TABLE IF NOT EXISTS prompt_evaluation_results (
      id TEXT PRIMARY KEY,
      evaluation_id TEXT NOT NULL REFERENCES prompt_evaluations(id),
      variant_id TEXT NOT NULL,
      variant_label TEXT NOT NULL,
      task_id TEXT NOT NULL,
      attempt INTEGER NOT NULL,
      status TEXT NOT NULL,
      started_at INTEGER NOT NULL,
      ended_at INTEGER NOT NULL,
      duration_sec REAL NOT NULL DEFAULT 0,
      total_tokens INTEGER NOT NULL DEFAULT 0,
      total_cost REAL NOT NULL DEFAULT 0,
      tool_calls INTEGER NOT NULL DEFAULT 0,
      output_chars INTEGER NOT NULL DEFAULT 0,
      output TEXT NOT NULL DEFAULT '',
      pairwise TEXT,
      error TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_prompt_evaluation_results_eval ON prompt_evaluation_results(evaluation_id);
    CREATE TABLE IF NOT EXISTS command_case_sets (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL REFERENCES workspaces(id),
      name TEXT NOT NULL,
      command_id TEXT NOT NULL,
      cases TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_command_case_sets_ws_cmd ON command_case_sets(workspace_id, command_id, updated_at DESC);
    CREATE TABLE IF NOT EXISTS command_evaluations (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL REFERENCES workspaces(id),
      command_id TEXT NOT NULL,
      repeat INTEGER NOT NULL,
      status TEXT NOT NULL,
      started_at INTEGER NOT NULL,
      ended_at INTEGER NOT NULL,
      duration_sec REAL NOT NULL DEFAULT 0,
      cases TEXT NOT NULL,
      case_summaries TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_command_evaluations_ws ON command_evaluations(workspace_id, started_at DESC);
    CREATE TABLE IF NOT EXISTS command_evaluation_results (
      id TEXT PRIMARY KEY,
      evaluation_id TEXT NOT NULL REFERENCES command_evaluations(id),
      case_id TEXT NOT NULL,
      case_name TEXT NOT NULL,
      attempt INTEGER NOT NULL,
      status TEXT NOT NULL,
      started_at INTEGER NOT NULL,
      ended_at INTEGER NOT NULL,
      duration_sec REAL NOT NULL DEFAULT 0,
      expanded_text TEXT NOT NULL DEFAULT '',
      skill_slugs TEXT NOT NULL DEFAULT '[]',
      output TEXT NOT NULL DEFAULT '',
      expectation TEXT NOT NULL,
      error TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_command_evaluation_results_eval ON command_evaluation_results(evaluation_id);
    CREATE TABLE IF NOT EXISTS subagent_eval_sets (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL REFERENCES workspaces(id),
      name TEXT NOT NULL,
      cases TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_subagent_eval_sets_ws ON subagent_eval_sets(workspace_id, updated_at DESC);
    CREATE TABLE IF NOT EXISTS subagent_evaluations (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL REFERENCES workspaces(id),
      repeat INTEGER NOT NULL,
      status TEXT NOT NULL,
      started_at INTEGER NOT NULL,
      ended_at INTEGER NOT NULL,
      duration_sec REAL NOT NULL DEFAULT 0,
      cases TEXT NOT NULL,
      case_summaries TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_subagent_evaluations_ws ON subagent_evaluations(workspace_id, started_at DESC);
    CREATE TABLE IF NOT EXISTS subagent_evaluation_results (
      id TEXT PRIMARY KEY,
      evaluation_id TEXT NOT NULL REFERENCES subagent_evaluations(id),
      case_id TEXT NOT NULL,
      case_name TEXT NOT NULL,
      attempt INTEGER NOT NULL,
      status TEXT NOT NULL,
      started_at INTEGER NOT NULL,
      ended_at INTEGER NOT NULL,
      duration_sec REAL NOT NULL DEFAULT 0,
      tool_trajectory TEXT NOT NULL DEFAULT '[]',
      step_count INTEGER NOT NULL DEFAULT 0,
      total_tokens INTEGER NOT NULL DEFAULT 0,
      total_cost REAL NOT NULL DEFAULT 0,
      tool_calls INTEGER NOT NULL DEFAULT 0,
      report_path TEXT,
      output TEXT NOT NULL DEFAULT '',
      expectation TEXT NOT NULL,
      error TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_subagent_evaluation_results_eval ON subagent_evaluation_results(evaluation_id);
    CREATE TABLE IF NOT EXISTS hook_eval_sets (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL REFERENCES workspaces(id),
      name TEXT NOT NULL,
      cases TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_hook_eval_sets_ws ON hook_eval_sets(workspace_id, updated_at DESC);
    CREATE TABLE IF NOT EXISTS hook_evaluations (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL REFERENCES workspaces(id),
      repeat INTEGER NOT NULL,
      status TEXT NOT NULL,
      started_at INTEGER NOT NULL,
      ended_at INTEGER NOT NULL,
      duration_sec REAL NOT NULL DEFAULT 0,
      cases TEXT NOT NULL,
      case_summaries TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_hook_evaluations_ws ON hook_evaluations(workspace_id, started_at DESC);
    CREATE TABLE IF NOT EXISTS hook_evaluation_results (
      id TEXT PRIMARY KEY,
      evaluation_id TEXT NOT NULL REFERENCES hook_evaluations(id),
      case_id TEXT NOT NULL,
      case_name TEXT NOT NULL,
      attempt INTEGER NOT NULL,
      status TEXT NOT NULL,
      started_at INTEGER NOT NULL,
      ended_at INTEGER NOT NULL,
      duration_sec REAL NOT NULL DEFAULT 0,
      matched_hook_ids TEXT NOT NULL DEFAULT '[]',
      blocked INTEGER NOT NULL DEFAULT 0,
      block_reason TEXT,
      mutated_input TEXT,
      side_effect_kinds TEXT NOT NULL DEFAULT '[]',
      trigger_count INTEGER NOT NULL DEFAULT 0,
      expectation TEXT NOT NULL,
      error TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_hook_evaluation_results_eval ON hook_evaluation_results(evaluation_id);
    CREATE TABLE IF NOT EXISTS tool_case_sets (
      id           TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL REFERENCES workspaces(id),
      name         TEXT NOT NULL,
      tool_id      TEXT NOT NULL,
      cases        TEXT NOT NULL,
      created_at   INTEGER NOT NULL,
      updated_at   INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_tool_case_sets_ws_tool ON tool_case_sets(workspace_id, tool_id, updated_at DESC);
    CREATE TABLE IF NOT EXISTS tool_evaluations (
      id             TEXT PRIMARY KEY,
      workspace_id   TEXT NOT NULL REFERENCES workspaces(id),
      tool_id        TEXT NOT NULL,
      repeat         INTEGER NOT NULL,
      status         TEXT NOT NULL,
      started_at     INTEGER NOT NULL,
      ended_at       INTEGER NOT NULL,
      duration_sec   REAL NOT NULL DEFAULT 0,
      cases          TEXT NOT NULL,
      case_summaries TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_tool_evaluations_ws ON tool_evaluations(workspace_id, started_at DESC);
    CREATE TABLE IF NOT EXISTS tool_evaluation_results (
      id            TEXT PRIMARY KEY,
      evaluation_id TEXT NOT NULL REFERENCES tool_evaluations(id),
      case_id       TEXT NOT NULL,
      case_name     TEXT NOT NULL,
      attempt       INTEGER NOT NULL,
      status        TEXT NOT NULL,
      started_at    INTEGER NOT NULL,
      ended_at      INTEGER NOT NULL,
      duration_sec  REAL NOT NULL DEFAULT 0,
      input_path    TEXT NOT NULL,
      output_path   TEXT NOT NULL,
      stdout        TEXT NOT NULL DEFAULT '',
      stderr        TEXT NOT NULL DEFAULT '',
      summary       TEXT,
      expectation   TEXT NOT NULL,
      error         TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_tool_evaluation_results_eval ON tool_evaluation_results(evaluation_id);
    CREATE TABLE IF NOT EXISTS skill_eval_sets (
      id           TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL REFERENCES workspaces(id),
      name         TEXT NOT NULL,
      tasks        TEXT NOT NULL,
      created_at   INTEGER NOT NULL,
      updated_at   INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_skill_eval_sets_ws ON skill_eval_sets(workspace_id, updated_at DESC);
    CREATE TABLE IF NOT EXISTS skill_evaluations (
      id                TEXT PRIMARY KEY,
      workspace_id      TEXT NOT NULL REFERENCES workspaces(id),
      model             TEXT NOT NULL,
      repeat            INTEGER NOT NULL,
      status            TEXT NOT NULL,
      started_at        INTEGER NOT NULL,
      ended_at          INTEGER NOT NULL,
      duration_sec      REAL NOT NULL DEFAULT 0,
      variants          TEXT NOT NULL,
      tasks             TEXT NOT NULL,
      context_prefix    TEXT NOT NULL DEFAULT '',
      variant_summaries TEXT NOT NULL,
      task_summaries    TEXT NOT NULL,
      pairwise_summaries TEXT NOT NULL DEFAULT '[]'
    );
    CREATE INDEX IF NOT EXISTS idx_skill_evaluations_ws ON skill_evaluations(workspace_id, started_at DESC);
    CREATE TABLE IF NOT EXISTS skill_evaluation_results (
      id            TEXT PRIMARY KEY,
      evaluation_id TEXT NOT NULL REFERENCES skill_evaluations(id),
      variant_id    TEXT NOT NULL,
      variant_label TEXT NOT NULL,
      task_id       TEXT NOT NULL,
      attempt       INTEGER NOT NULL,
      status        TEXT NOT NULL,
      started_at    INTEGER NOT NULL,
      ended_at      INTEGER NOT NULL,
      duration_sec  REAL NOT NULL DEFAULT 0,
      skill_paths   TEXT NOT NULL,
      total_tokens  INTEGER NOT NULL DEFAULT 0,
      total_cost    REAL NOT NULL DEFAULT 0,
      tool_calls    INTEGER NOT NULL DEFAULT 0,
      output_chars  INTEGER NOT NULL DEFAULT 0,
      output        TEXT NOT NULL DEFAULT '',
      activation    TEXT NOT NULL,
      pairwise      TEXT,
      error         TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_skill_evaluation_results_eval ON skill_evaluation_results(evaluation_id);
  `);
  try { db.exec("ALTER TABLE skill_evaluations ADD COLUMN pairwise_summaries TEXT NOT NULL DEFAULT '[]'"); } catch { /* column exists or read-only */ }
  try { db.exec("ALTER TABLE skill_evaluation_results ADD COLUMN pairwise TEXT"); } catch { /* column exists or read-only */ }

  // E-MONITOR2: 监测指标体系 + 监测 run/finding
  db.exec(`
    CREATE TABLE IF NOT EXISTS monitor_metric_systems (
      id           TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      name         TEXT NOT NULL,
      draft_json   TEXT NOT NULL,
      status       TEXT NOT NULL DEFAULT 'adopted',
      created_at   INTEGER NOT NULL,
      updated_at   INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_monitor_metric_systems_ws ON monitor_metric_systems(workspace_id, updated_at DESC);
    CREATE TABLE IF NOT EXISTS monitor_runs (
      id              TEXT PRIMARY KEY,
      workspace_id    TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      suite           TEXT NOT NULL,
      metric_system_id TEXT REFERENCES monitor_metric_systems(id) ON DELETE SET NULL,
      started_at      INTEGER NOT NULL,
      finished_at     INTEGER,
      problem_count   INTEGER NOT NULL DEFAULT 0,
      risk_count      INTEGER NOT NULL DEFAULT 0,
      status          TEXT NOT NULL DEFAULT 'running'
    );
    CREATE INDEX IF NOT EXISTS idx_monitor_runs_ws ON monitor_runs(workspace_id, started_at DESC);
    CREATE TABLE IF NOT EXISTS monitor_findings (
      id                 TEXT PRIMARY KEY,
      run_id             TEXT NOT NULL REFERENCES monitor_runs(id) ON DELETE CASCADE,
      rule_id            TEXT NOT NULL,
      category           TEXT NOT NULL,
      kind               TEXT NOT NULL,
      severity           TEXT NOT NULL,
      lifecycle          TEXT NOT NULL,
      signature          TEXT NOT NULL,
      first_seen_run_id  TEXT,
      title              TEXT NOT NULL,
      evidence           TEXT NOT NULL,
      bound_to           TEXT,
      comparisons        TEXT,
      diagnosis          TEXT,
      suggestion         TEXT NOT NULL DEFAULT '',
      detected_at        INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_monitor_findings_run ON monitor_findings(run_id);
    CREATE INDEX IF NOT EXISTS idx_monitor_findings_sig ON monitor_findings(signature);
  `);
}

type ChangeManifestRow = Omit<ChangeManifest, "predictedFix" | "predictedRegression"> & {
  predictedFix: string;
  predictedRegression: string;
};
type ScopedRevisionRow = ScopedRevision;
type HarnessVariantRow = Omit<HarnessVariant, "perTaskRouting"> & { perTaskRouting: string; createdAt: number };

export function saveChangeManifest(input: Omit<ChangeManifest, "editId" | "createdAt"> & { editId?: string; createdAt?: number }): ChangeManifest {
  const manifest: ChangeManifest = {
    editId: input.editId ?? randomUUID(),
    component: input.component,
    failureEvidence: input.failureEvidence,
    rootCause: input.rootCause,
    targetedFix: input.targetedFix,
    predictedFix: input.predictedFix,
    predictedRegression: input.predictedRegression,
    outcome: input.outcome,
    outcomeReason: input.outcomeReason,
    createdAt: input.createdAt ?? Date.now(),
  };
  db.prepare(`
    INSERT INTO change_manifests
      (edit_id, component, failure_evidence, root_cause, targeted_fix, predicted_fix, predicted_regression, outcome, outcome_reason, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    manifest.editId,
    manifest.component,
    manifest.failureEvidence,
    manifest.rootCause,
    manifest.targetedFix,
    JSON.stringify(manifest.predictedFix),
    JSON.stringify(manifest.predictedRegression),
    manifest.outcome,
    manifest.outcomeReason ?? null,
    manifest.createdAt,
  );
  return manifest;
}

export function getChangeManifest(editId: string): ChangeManifest | undefined {
  const row = db.prepare(`
    SELECT edit_id AS editId, component, failure_evidence AS failureEvidence, root_cause AS rootCause,
      targeted_fix AS targetedFix, predicted_fix AS predictedFix, predicted_regression AS predictedRegression,
      outcome, outcome_reason AS outcomeReason, created_at AS createdAt
    FROM change_manifests WHERE edit_id = ?
  `).get(editId) as unknown as ChangeManifestRow | undefined;
  return row ? parseChangeManifestRow(row) : undefined;
}

export function listChangeManifests(filter: { component?: HarnessComponent; limit?: number } = {}): ChangeManifest[] {
  const limit = Math.max(1, Math.min(200, filter.limit ?? 50));
  const rows = filter.component
    ? db.prepare(`
      SELECT edit_id AS editId, component, failure_evidence AS failureEvidence, root_cause AS rootCause,
        targeted_fix AS targetedFix, predicted_fix AS predictedFix, predicted_regression AS predictedRegression,
        outcome, outcome_reason AS outcomeReason, created_at AS createdAt
      FROM change_manifests WHERE component = ? ORDER BY created_at DESC LIMIT ?
    `).all(filter.component, limit) as unknown as ChangeManifestRow[]
    : db.prepare(`
      SELECT edit_id AS editId, component, failure_evidence AS failureEvidence, root_cause AS rootCause,
        targeted_fix AS targetedFix, predicted_fix AS predictedFix, predicted_regression AS predictedRegression,
        outcome, outcome_reason AS outcomeReason, created_at AS createdAt
      FROM change_manifests ORDER BY created_at DESC LIMIT ?
    `).all(limit) as unknown as ChangeManifestRow[];
  return rows.map(parseChangeManifestRow);
}

export function saveScopedRevision(input: Omit<ScopedRevision, "editId" | "createdAt"> & { editId?: string; createdAt?: number }): ScopedRevision {
  const revision: ScopedRevision = {
    editId: input.editId ?? randomUUID(),
    component: input.component,
    resourceId: input.resourceId,
    scope: input.scope,
    beforeSnapshot: input.beforeSnapshot,
    afterSnapshot: input.afterSnapshot,
    manifestEditId: input.manifestEditId,
    createdAt: input.createdAt ?? Date.now(),
  };
  db.prepare(`
    INSERT INTO harness_edits
      (edit_id, component, resource_id, scope, before_snapshot, after_snapshot, manifest_edit_id, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(revision.editId, revision.component, revision.resourceId, revision.scope, revision.beforeSnapshot, revision.afterSnapshot, revision.manifestEditId, revision.createdAt);
  return revision;
}

export function getScopedRevision(editId: string): ScopedRevision | undefined {
  return db.prepare(`
    SELECT edit_id AS editId, component, resource_id AS resourceId, scope, before_snapshot AS beforeSnapshot,
      after_snapshot AS afterSnapshot, manifest_edit_id AS manifestEditId, created_at AS createdAt
    FROM harness_edits WHERE edit_id = ?
  `).get(editId) as unknown as ScopedRevisionRow | undefined;
}

export function listScopedRevisions(manifestEditId: string): ScopedRevision[] {
  return db.prepare(`
    SELECT edit_id AS editId, component, resource_id AS resourceId, scope, before_snapshot AS beforeSnapshot,
      after_snapshot AS afterSnapshot, manifest_edit_id AS manifestEditId, created_at AS createdAt
    FROM harness_edits WHERE manifest_edit_id = ? ORDER BY created_at DESC
  `).all(manifestEditId) as unknown as ScopedRevision[];
}

export function saveHarnessVariant(input: HarnessVariant): HarnessVariant {
  db.prepare("INSERT OR REPLACE INTO harness_variants (variant_id, base_edit_id, per_task_routing, created_at) VALUES (?, ?, ?, ?)")
    .run(input.variantId, input.baseEditId, JSON.stringify(input.perTaskRouting), Date.now());
  return input;
}

export function listHarnessVariants(baseEditId?: string): HarnessVariant[] {
  const rows = baseEditId
    ? db.prepare("SELECT variant_id AS variantId, base_edit_id AS baseEditId, per_task_routing AS perTaskRouting, created_at AS createdAt FROM harness_variants WHERE base_edit_id = ? ORDER BY created_at DESC").all(baseEditId) as unknown as HarnessVariantRow[]
    : db.prepare("SELECT variant_id AS variantId, base_edit_id AS baseEditId, per_task_routing AS perTaskRouting, created_at AS createdAt FROM harness_variants ORDER BY created_at DESC").all() as unknown as HarnessVariantRow[];
  return rows.map((row) => ({ variantId: row.variantId, baseEditId: row.baseEditId, perTaskRouting: parseJsonObject<Record<string, string>>(row.perTaskRouting, {}) }));
}

function parseChangeManifestRow(row: ChangeManifestRow): ChangeManifest {
  return {
    ...row,
    component: row.component as HarnessComponent,
    predictedFix: parseJsonArray<string>(row.predictedFix),
    predictedRegression: parseJsonArray<string>(row.predictedRegression),
  };
}

// ---- collect folders (E-COLLECT4) ----

export function listCollectFolders(): CollectFolder[] {
  return db
    .prepare("SELECT id, name, sort, created_at AS createdAt, updated_at AS updatedAt FROM collect_folders ORDER BY sort ASC, created_at ASC")
    .all() as unknown as CollectFolder[];
}

export function getCollectFolder(id: string): CollectFolder | undefined {
  return db
    .prepare("SELECT id, name, sort, created_at AS createdAt, updated_at AS updatedAt FROM collect_folders WHERE id = ?")
    .get(id) as unknown as CollectFolder | undefined;
}

export function createCollectFolder(name: string): CollectFolder {
  const id = randomUUID();
  const now = Date.now();
  const maxSort = (db.prepare("SELECT MAX(sort) AS m FROM collect_folders").get() as { m: number | null }).m ?? 0;
  db.prepare("INSERT INTO collect_folders (id, name, sort, created_at, updated_at) VALUES (?, ?, ?, ?, ?)").run(id, name, maxSort + 1, now, now);
  return { id, name, sort: maxSort + 1, createdAt: now, updatedAt: now };
}

export function renameCollectFolder(id: string, name: string): CollectFolder | undefined {
  const existing = getCollectFolder(id);
  if (!existing) return undefined;
  db.prepare("UPDATE collect_folders SET name = ?, updated_at = ? WHERE id = ?").run(name, Date.now(), id);
  return getCollectFolder(id);
}

export function reorderCollectFolder(id: string, sort: number): CollectFolder | undefined {
  const existing = getCollectFolder(id);
  if (!existing) return undefined;
  db.prepare("UPDATE collect_folders SET sort = ?, updated_at = ? WHERE id = ?").run(sort, Date.now(), id);
  return getCollectFolder(id);
}

export function deleteCollectFolder(id: string): boolean {
  const existing = getCollectFolder(id);
  if (!existing) return false;
  db.exec("BEGIN");
  try {
    db.prepare("UPDATE sessions SET collect_folder_id = NULL, updated_at = ? WHERE collect_folder_id = ?").run(Date.now(), id);
    db.prepare("DELETE FROM collect_folders WHERE id = ?").run(id);
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
  return true;
}

type PromptEvalSetRow = Omit<PromptEvalSet, "tasks"> & { tasks: string };
type PromptEvaluationRow = Omit<PromptEvaluation, "variants" | "tasks" | "variantSummaries" | "taskSummaries" | "pairwiseSummaries"> & {
  variants: string;
  tasks: string;
  variantSummaries: string;
  taskSummaries: string;
  pairwiseSummaries: string;
};
type PromptEvaluationResultRow = Omit<PromptEvaluationRunResult, "pairwise" | "error"> & {
  pairwise: string | null;
  error: unknown;
};

export function createPromptEvalSet(workspaceId: string, name: string, tasks: PromptEvalTask[]): PromptEvalSet {
  const now = Date.now();
  const id = randomUUID();
  db.prepare("INSERT INTO prompt_eval_sets (id, workspace_id, name, tasks, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)")
    .run(id, workspaceId, name, JSON.stringify(tasks), now, now);
  return { id, workspaceId, name, tasks, createdAt: now, updatedAt: now };
}

export function getPromptEvalSet(id: string): PromptEvalSet | undefined {
  const row = db.prepare("SELECT id, workspace_id AS workspaceId, name, tasks, created_at AS createdAt, updated_at AS updatedAt FROM prompt_eval_sets WHERE id = ?")
    .get(id) as unknown as PromptEvalSetRow | undefined;
  return row ? { ...row, tasks: parseJsonArray<PromptEvalTask>(row.tasks) } : undefined;
}

export function listPromptEvalSets(workspaceId: string): PromptEvalSet[] {
  const rows = db.prepare("SELECT id, workspace_id AS workspaceId, name, tasks, created_at AS createdAt, updated_at AS updatedAt FROM prompt_eval_sets WHERE workspace_id = ? ORDER BY updated_at DESC")
    .all(workspaceId) as unknown as PromptEvalSetRow[];
  return rows.map((row) => ({ ...row, tasks: parseJsonArray<PromptEvalTask>(row.tasks) }));
}

export function updatePromptEvalSet(id: string, name: string, tasks: PromptEvalTask[]): PromptEvalSet | undefined {
  const existing = getPromptEvalSet(id);
  if (!existing) return undefined;
  const updatedAt = Date.now();
  db.prepare("UPDATE prompt_eval_sets SET name = ?, tasks = ?, updated_at = ? WHERE id = ?")
    .run(name, JSON.stringify(tasks), updatedAt, id);
  return { ...existing, name, tasks, updatedAt };
}

export function deletePromptEvalSet(id: string): boolean {
  return db.prepare("DELETE FROM prompt_eval_sets WHERE id = ?").run(id).changes > 0;
}

export function savePromptEvaluation(
  workspaceId: string,
  model: string,
  repeat: number,
  variants: PromptVariant[],
  tasks: PromptEvalTask[],
  summary: Omit<PromptEvaluationDetail, "workspaceId" | "model" | "repeat" | "variants" | "tasks">,
): PromptEvaluationDetail {
  db.prepare("INSERT INTO prompt_evaluations (id, workspace_id, model, repeat, status, started_at, ended_at, duration_sec, variants, tasks, variant_summaries, task_summaries, pairwise_summaries) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
    .run(summary.evaluationId, workspaceId, model, repeat, summary.status, summary.startedAt, summary.endedAt, summary.durationSec, JSON.stringify(variants), JSON.stringify(tasks), JSON.stringify(summary.variantSummaries), JSON.stringify(summary.taskSummaries), JSON.stringify(summary.pairwiseSummaries));
  const insert = db.prepare("INSERT INTO prompt_evaluation_results (id, evaluation_id, variant_id, variant_label, task_id, attempt, status, started_at, ended_at, duration_sec, total_tokens, total_cost, tool_calls, output_chars, output, pairwise, error) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)");
  for (const result of summary.results) {
    insert.run(result.id, summary.evaluationId, result.variantId, result.variantLabel, result.taskId, result.attempt, result.status, result.startedAt, result.endedAt, result.durationSec, result.totalTokens, result.totalCost, result.toolCalls, result.outputChars, result.output, result.pairwise ? JSON.stringify(result.pairwise) : null, serializeEvaluationError(result.error));
  }
  return { evaluationId: summary.evaluationId, workspaceId, model, repeat, status: summary.status, startedAt: summary.startedAt, endedAt: summary.endedAt, durationSec: summary.durationSec, variants, tasks, results: summary.results, variantSummaries: summary.variantSummaries, taskSummaries: summary.taskSummaries, pairwiseSummaries: summary.pairwiseSummaries };
}

export function listPromptEvaluations(workspaceId: string): PromptEvaluation[] {
  const rows = db.prepare("SELECT id AS evaluationId, workspace_id AS workspaceId, model, repeat, status, started_at AS startedAt, ended_at AS endedAt, duration_sec AS durationSec, variants, tasks, variant_summaries AS variantSummaries, task_summaries AS taskSummaries, pairwise_summaries AS pairwiseSummaries FROM prompt_evaluations WHERE workspace_id = ? ORDER BY started_at DESC")
    .all(workspaceId) as unknown as PromptEvaluationRow[];
  return rows.map(parsePromptEvaluationRow);
}

export function getPromptEvaluation(id: string): PromptEvaluationDetail | undefined {
  const row = db.prepare("SELECT id AS evaluationId, workspace_id AS workspaceId, model, repeat, status, started_at AS startedAt, ended_at AS endedAt, duration_sec AS durationSec, variants, tasks, variant_summaries AS variantSummaries, task_summaries AS taskSummaries, pairwise_summaries AS pairwiseSummaries FROM prompt_evaluations WHERE id = ?")
    .get(id) as unknown as PromptEvaluationRow | undefined;
  if (!row) return undefined;
  const results = db.prepare("SELECT id, variant_id AS variantId, variant_label AS variantLabel, task_id AS taskId, attempt, status, started_at AS startedAt, ended_at AS endedAt, duration_sec AS durationSec, total_tokens AS totalTokens, total_cost AS totalCost, tool_calls AS toolCalls, output_chars AS outputChars, output, pairwise, error FROM prompt_evaluation_results WHERE evaluation_id = ? ORDER BY variant_label, task_id, attempt")
    .all(id) as unknown as PromptEvaluationResultRow[];
  return { ...parsePromptEvaluationRow(row), results: results.map((result) => ({ ...result, status: result.status === "failed" ? "failed" : "success", pairwise: result.pairwise ? parseJsonObject<PromptPairwiseResult | null>(result.pairwise, null) : null, error: parseEvaluationError(result.error) })) };
}

function parsePromptEvaluationRow(row: PromptEvaluationRow): PromptEvaluation {
  return { ...row, status: row.status === "failed" ? "failed" : "success", variants: parseJsonArray<PromptVariant>(row.variants), tasks: parseJsonArray<PromptEvalTask>(row.tasks), variantSummaries: parseJsonArray<PromptVariantSummary>(row.variantSummaries), taskSummaries: parseJsonArray<PromptTaskSummary>(row.taskSummaries), pairwiseSummaries: parseJsonArray<PromptPairwiseSummary>(row.pairwiseSummaries) };
}

type CommandCaseSetRow = Omit<CommandEvalSet, "cases"> & { cases: string };
type CommandEvaluationRow = Omit<CommandEvaluation, "cases" | "caseSummaries"> & { cases: string; caseSummaries: string };
type CommandEvaluationResultRow = Omit<CommandEvaluationRunResult, "skillSlugs" | "expectation" | "error"> & {
  skillSlugs: string;
  expectation: string;
  error: unknown;
};

export function createCommandCaseSet(workspaceId: string, name: string, commandId: string, cases: CommandEvalCase[]): CommandEvalSet {
  const now = Date.now();
  const id = randomUUID();
  db.prepare("INSERT INTO command_case_sets (id, workspace_id, name, command_id, cases, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
    .run(id, workspaceId, name, commandId, JSON.stringify(cases), now, now);
  return { id, workspaceId, name, commandId, cases, createdAt: now, updatedAt: now };
}

export function getCommandCaseSet(id: string): CommandEvalSet | undefined {
  const row = db.prepare("SELECT id, workspace_id AS workspaceId, name, command_id AS commandId, cases, created_at AS createdAt, updated_at AS updatedAt FROM command_case_sets WHERE id = ?")
    .get(id) as unknown as CommandCaseSetRow | undefined;
  return row ? { ...row, cases: parseJsonArray<CommandEvalCase>(row.cases) } : undefined;
}

export function listCommandCaseSets(workspaceId: string, commandId?: string): CommandEvalSet[] {
  const rows = commandId
    ? db.prepare("SELECT id, workspace_id AS workspaceId, name, command_id AS commandId, cases, created_at AS createdAt, updated_at AS updatedAt FROM command_case_sets WHERE workspace_id = ? AND command_id = ? ORDER BY updated_at DESC").all(workspaceId, commandId) as unknown as CommandCaseSetRow[]
    : db.prepare("SELECT id, workspace_id AS workspaceId, name, command_id AS commandId, cases, created_at AS createdAt, updated_at AS updatedAt FROM command_case_sets WHERE workspace_id = ? ORDER BY updated_at DESC").all(workspaceId) as unknown as CommandCaseSetRow[];
  return rows.map((row) => ({ ...row, cases: parseJsonArray<CommandEvalCase>(row.cases) }));
}

export function updateCommandCaseSet(id: string, name: string, commandId: string, cases: CommandEvalCase[]): CommandEvalSet | undefined {
  const existing = getCommandCaseSet(id);
  if (!existing) return undefined;
  const updatedAt = Date.now();
  db.prepare("UPDATE command_case_sets SET name = ?, command_id = ?, cases = ?, updated_at = ? WHERE id = ?")
    .run(name, commandId, JSON.stringify(cases), updatedAt, id);
  return { ...existing, name, commandId, cases, updatedAt };
}

export function deleteCommandCaseSet(id: string): boolean {
  return db.prepare("DELETE FROM command_case_sets WHERE id = ?").run(id).changes > 0;
}

export function saveCommandEvaluation(
  workspaceId: string,
  commandId: string,
  repeat: number,
  cases: CommandEvalCase[],
  summary: Omit<CommandEvaluationDetail, "workspaceId" | "commandId" | "repeat" | "cases">,
): CommandEvaluationDetail {
  db.prepare("INSERT INTO command_evaluations (id, workspace_id, command_id, repeat, status, started_at, ended_at, duration_sec, cases, case_summaries) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
    .run(summary.evaluationId, workspaceId, commandId, repeat, summary.status, summary.startedAt, summary.endedAt, summary.durationSec, JSON.stringify(cases), JSON.stringify(summary.caseSummaries));
  const insert = db.prepare("INSERT INTO command_evaluation_results (id, evaluation_id, case_id, case_name, attempt, status, started_at, ended_at, duration_sec, expanded_text, skill_slugs, output, expectation, error) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)");
  for (const result of summary.results) {
    insert.run(result.id, summary.evaluationId, result.caseId, result.caseName, result.attempt, result.status, result.startedAt, result.endedAt, result.durationSec, result.expandedText, JSON.stringify(result.skillSlugs), result.output, JSON.stringify(result.expectation), serializeEvaluationError(result.error));
  }
  return { ...summary, workspaceId, commandId, repeat, cases };
}

export function listCommandEvaluations(workspaceId: string): CommandEvaluation[] {
  const rows = db.prepare("SELECT id AS evaluationId, workspace_id AS workspaceId, command_id AS commandId, repeat, status, started_at AS startedAt, ended_at AS endedAt, duration_sec AS durationSec, cases, case_summaries AS caseSummaries FROM command_evaluations WHERE workspace_id = ? ORDER BY started_at DESC")
    .all(workspaceId) as unknown as CommandEvaluationRow[];
  return rows.map(parseCommandEvaluationRow);
}

export function getCommandEvaluation(id: string): CommandEvaluationDetail | undefined {
  const row = db.prepare("SELECT id AS evaluationId, workspace_id AS workspaceId, command_id AS commandId, repeat, status, started_at AS startedAt, ended_at AS endedAt, duration_sec AS durationSec, cases, case_summaries AS caseSummaries FROM command_evaluations WHERE id = ?")
    .get(id) as unknown as CommandEvaluationRow | undefined;
  if (!row) return undefined;
  const results = db.prepare("SELECT id, case_id AS caseId, case_name AS caseName, attempt, status, started_at AS startedAt, ended_at AS endedAt, duration_sec AS durationSec, expanded_text AS expandedText, skill_slugs AS skillSlugs, output, expectation, error FROM command_evaluation_results WHERE evaluation_id = ? ORDER BY case_name, attempt")
    .all(id) as unknown as CommandEvaluationResultRow[];
  return {
    ...parseCommandEvaluationRow(row),
    results: results.map((result) => ({
      ...result,
      status: result.status === "failed" ? "failed" : "success",
      skillSlugs: parseJsonArray<string>(result.skillSlugs),
      expectation: JSON.parse(result.expectation) as CommandEvaluationRunResult["expectation"],
      error: parseEvaluationError(result.error),
    })),
  };
}

function parseCommandEvaluationRow(row: CommandEvaluationRow): CommandEvaluation {
  return { ...row, status: row.status === "failed" ? "failed" : "success", cases: parseJsonArray<CommandEvalCase>(row.cases), caseSummaries: parseJsonArray<CommandCaseSummary>(row.caseSummaries) };
}

type SubAgentEvalSetRow = Omit<SubAgentEvalSet, "cases"> & { cases: string };
type SubAgentEvaluationRow = Omit<SubAgentEvaluation, "cases" | "caseSummaries"> & { cases: string; caseSummaries: string };
type SubAgentEvaluationResultRow = Omit<SubAgentEvaluationRunResult, "toolTrajectory" | "expectation" | "error"> & { toolTrajectory: string; expectation: string; error: unknown };

export function createSubAgentEvalSet(workspaceId: string, name: string, cases: SubAgentEvalCase[]): SubAgentEvalSet {
  const now = Date.now();
  const id = randomUUID();
  db.prepare("INSERT INTO subagent_eval_sets (id, workspace_id, name, cases, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)")
    .run(id, workspaceId, name, JSON.stringify(cases), now, now);
  return { id, workspaceId, name, cases, createdAt: now, updatedAt: now };
}

export function getSubAgentEvalSet(id: string): SubAgentEvalSet | undefined {
  const row = db.prepare("SELECT id, workspace_id AS workspaceId, name, cases, created_at AS createdAt, updated_at AS updatedAt FROM subagent_eval_sets WHERE id = ?")
    .get(id) as unknown as SubAgentEvalSetRow | undefined;
  return row ? { ...row, cases: parseJsonArray<SubAgentEvalCase>(row.cases) } : undefined;
}

export function listSubAgentEvalSets(workspaceId: string): SubAgentEvalSet[] {
  const rows = db.prepare("SELECT id, workspace_id AS workspaceId, name, cases, created_at AS createdAt, updated_at AS updatedAt FROM subagent_eval_sets WHERE workspace_id = ? ORDER BY updated_at DESC")
    .all(workspaceId) as unknown as SubAgentEvalSetRow[];
  return rows.map((row) => ({ ...row, cases: parseJsonArray<SubAgentEvalCase>(row.cases) }));
}

export function updateSubAgentEvalSet(id: string, name: string, cases: SubAgentEvalCase[]): SubAgentEvalSet | undefined {
  const existing = getSubAgentEvalSet(id);
  if (!existing) return undefined;
  const updatedAt = Date.now();
  db.prepare("UPDATE subagent_eval_sets SET name = ?, cases = ?, updated_at = ? WHERE id = ?").run(name, JSON.stringify(cases), updatedAt, id);
  return { ...existing, name, cases, updatedAt };
}

export function deleteSubAgentEvalSet(id: string): boolean {
  return db.prepare("DELETE FROM subagent_eval_sets WHERE id = ?").run(id).changes > 0;
}

export function saveSubAgentEvaluation(
  workspaceId: string,
  repeat: number,
  cases: SubAgentEvalCase[],
  summary: Omit<SubAgentEvaluationDetail, "workspaceId" | "repeat" | "cases">,
): SubAgentEvaluationDetail {
  db.prepare("INSERT INTO subagent_evaluations (id, workspace_id, repeat, status, started_at, ended_at, duration_sec, cases, case_summaries) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
    .run(summary.evaluationId, workspaceId, repeat, summary.status, summary.startedAt, summary.endedAt, summary.durationSec, JSON.stringify(cases), JSON.stringify(summary.caseSummaries));
  const insert = db.prepare("INSERT INTO subagent_evaluation_results (id, evaluation_id, case_id, case_name, attempt, status, started_at, ended_at, duration_sec, tool_trajectory, step_count, total_tokens, total_cost, tool_calls, report_path, output, expectation, error) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)");
  for (const result of summary.results) {
    insert.run(result.id, summary.evaluationId, result.caseId, result.caseName, result.attempt, result.status, result.startedAt, result.endedAt, result.durationSec, JSON.stringify(result.toolTrajectory), result.stepCount, result.totalTokens, result.totalCost, result.toolCalls, result.reportPath, result.output, JSON.stringify(result.expectation), serializeEvaluationError(result.error));
  }
  return { ...summary, workspaceId, repeat, cases };
}

export function listSubAgentEvaluations(workspaceId: string): SubAgentEvaluation[] {
  const rows = db.prepare("SELECT id AS evaluationId, workspace_id AS workspaceId, repeat, status, started_at AS startedAt, ended_at AS endedAt, duration_sec AS durationSec, cases, case_summaries AS caseSummaries FROM subagent_evaluations WHERE workspace_id = ? ORDER BY started_at DESC")
    .all(workspaceId) as unknown as SubAgentEvaluationRow[];
  return rows.map(parseSubAgentEvaluationRow);
}

export function getSubAgentEvaluation(id: string): SubAgentEvaluationDetail | undefined {
  const row = db.prepare("SELECT id AS evaluationId, workspace_id AS workspaceId, repeat, status, started_at AS startedAt, ended_at AS endedAt, duration_sec AS durationSec, cases, case_summaries AS caseSummaries FROM subagent_evaluations WHERE id = ?")
    .get(id) as unknown as SubAgentEvaluationRow | undefined;
  if (!row) return undefined;
  const results = db.prepare("SELECT id, case_id AS caseId, case_name AS caseName, attempt, status, started_at AS startedAt, ended_at AS endedAt, duration_sec AS durationSec, tool_trajectory AS toolTrajectory, step_count AS stepCount, total_tokens AS totalTokens, total_cost AS totalCost, tool_calls AS toolCalls, report_path AS reportPath, output, expectation, error FROM subagent_evaluation_results WHERE evaluation_id = ? ORDER BY case_name, attempt")
    .all(id) as unknown as SubAgentEvaluationResultRow[];
  return {
    ...parseSubAgentEvaluationRow(row),
    results: results.map((result) => ({
      ...result,
      status: result.status === "failed" ? "failed" : "success",
      toolTrajectory: parseJsonArray<string>(result.toolTrajectory),
      expectation: JSON.parse(result.expectation) as SubAgentEvaluationRunResult["expectation"],
      error: parseEvaluationError(result.error),
    })),
  };
}

function parseSubAgentEvaluationRow(row: SubAgentEvaluationRow): SubAgentEvaluation {
  return {
    ...row,
    status: row.status === "failed" ? "failed" : "success",
    cases: parseJsonArray<SubAgentEvalCase>(row.cases),
    caseSummaries: parseJsonArray<SubAgentCaseSummary>(row.caseSummaries).map(normalizeSubAgentCaseSummary),
  };
}

// D-QEVAL3 向后兼容：本卡给持久化的 SubAgentCaseSummary 加了 4 个必填聚合字段；旧归档 JSON 没有它们，
// 反序列化得 undefined，前端 ruleCheckDetails.length / outputVariance.toFixed 会 TypeError 炸结果视图。
// 读边界统一补缺省（旧档无硬断言→视为通过、passAtK 以成功率近似），让类型与运行时一致。
function normalizeSubAgentCaseSummary(s: SubAgentCaseSummary): SubAgentCaseSummary {
  return {
    ...s,
    ruleCheckPassed: s.ruleCheckPassed ?? true,
    ruleCheckDetails: s.ruleCheckDetails ?? [],
    passAtK: s.passAtK ?? (s.total > 0 ? s.success / s.total : 0),
    outputVariance: s.outputVariance ?? 0,
  };
}

type HookEvalSetRow = Omit<HookEvalSet, "cases"> & { cases: string };
type HookEvaluationRow = Omit<HookEvaluation, "cases" | "caseSummaries"> & { cases: string; caseSummaries: string };
type HookEvaluationResultRow = Omit<HookEvaluationRunResult, "matchedHookIds" | "blocked" | "blockReason" | "mutatedInput" | "sideEffectKinds" | "expectation" | "error"> & {
  matchedHookIds: string;
  blocked: number;
  blockReason: string | null;
  mutatedInput: string | null;
  sideEffectKinds: string;
  expectation: string;
  error: unknown;
};

export function createHookEvalSet(workspaceId: string, name: string, cases: HookEvalCase[]): HookEvalSet {
  const now = Date.now();
  const id = randomUUID();
  db.prepare("INSERT INTO hook_eval_sets (id, workspace_id, name, cases, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)")
    .run(id, workspaceId, name, JSON.stringify(cases), now, now);
  return { id, workspaceId, name, cases, createdAt: now, updatedAt: now };
}

export function getHookEvalSet(id: string): HookEvalSet | undefined {
  const row = db.prepare("SELECT id, workspace_id AS workspaceId, name, cases, created_at AS createdAt, updated_at AS updatedAt FROM hook_eval_sets WHERE id = ?")
    .get(id) as unknown as HookEvalSetRow | undefined;
  return row ? { ...row, cases: parseJsonArray<HookEvalCase>(row.cases) } : undefined;
}

export function listHookEvalSets(workspaceId: string): HookEvalSet[] {
  const rows = db.prepare("SELECT id, workspace_id AS workspaceId, name, cases, created_at AS createdAt, updated_at AS updatedAt FROM hook_eval_sets WHERE workspace_id = ? ORDER BY updated_at DESC")
    .all(workspaceId) as unknown as HookEvalSetRow[];
  return rows.map((row) => ({ ...row, cases: parseJsonArray<HookEvalCase>(row.cases) }));
}

export function updateHookEvalSet(id: string, name: string, cases: HookEvalCase[]): HookEvalSet | undefined {
  const existing = getHookEvalSet(id);
  if (!existing) return undefined;
  const updatedAt = Date.now();
  db.prepare("UPDATE hook_eval_sets SET name = ?, cases = ?, updated_at = ? WHERE id = ?").run(name, JSON.stringify(cases), updatedAt, id);
  return { ...existing, name, cases, updatedAt };
}

export function deleteHookEvalSet(id: string): boolean {
  return db.prepare("DELETE FROM hook_eval_sets WHERE id = ?").run(id).changes > 0;
}

export function saveHookEvaluation(
  workspaceId: string,
  repeat: number,
  cases: HookEvalCase[],
  summary: Omit<HookEvaluationDetail, "workspaceId" | "repeat" | "cases">,
): HookEvaluationDetail {
  db.prepare("INSERT INTO hook_evaluations (id, workspace_id, repeat, status, started_at, ended_at, duration_sec, cases, case_summaries) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
    .run(summary.evaluationId, workspaceId, repeat, summary.status, summary.startedAt, summary.endedAt, summary.durationSec, JSON.stringify(cases), JSON.stringify(summary.caseSummaries));
  const insert = db.prepare("INSERT INTO hook_evaluation_results (id, evaluation_id, case_id, case_name, attempt, status, started_at, ended_at, duration_sec, matched_hook_ids, blocked, block_reason, mutated_input, side_effect_kinds, trigger_count, expectation, error) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)");
  for (const result of summary.results) {
    insert.run(result.id, summary.evaluationId, result.caseId, result.caseName, result.attempt, result.status, result.startedAt, result.endedAt, result.durationSec, JSON.stringify(result.matchedHookIds), result.blocked ? 1 : 0, result.blockReason, result.mutatedInput === null ? null : JSON.stringify(result.mutatedInput), JSON.stringify(result.sideEffectKinds), result.triggerCount, JSON.stringify(result.expectation), serializeEvaluationError(result.error));
  }
  return { ...summary, workspaceId, repeat, cases };
}

export function listHookEvaluations(workspaceId: string): HookEvaluation[] {
  const rows = db.prepare("SELECT id AS evaluationId, workspace_id AS workspaceId, repeat, status, started_at AS startedAt, ended_at AS endedAt, duration_sec AS durationSec, cases, case_summaries AS caseSummaries FROM hook_evaluations WHERE workspace_id = ? ORDER BY started_at DESC")
    .all(workspaceId) as unknown as HookEvaluationRow[];
  return rows.map(parseHookEvaluationRow);
}

export function getHookEvaluation(id: string): HookEvaluationDetail | undefined {
  const row = db.prepare("SELECT id AS evaluationId, workspace_id AS workspaceId, repeat, status, started_at AS startedAt, ended_at AS endedAt, duration_sec AS durationSec, cases, case_summaries AS caseSummaries FROM hook_evaluations WHERE id = ?")
    .get(id) as unknown as HookEvaluationRow | undefined;
  if (!row) return undefined;
  const results = db.prepare("SELECT id, case_id AS caseId, case_name AS caseName, attempt, status, started_at AS startedAt, ended_at AS endedAt, duration_sec AS durationSec, matched_hook_ids AS matchedHookIds, blocked, block_reason AS blockReason, mutated_input AS mutatedInput, side_effect_kinds AS sideEffectKinds, trigger_count AS triggerCount, expectation, error FROM hook_evaluation_results WHERE evaluation_id = ? ORDER BY case_name, attempt")
    .all(id) as unknown as HookEvaluationResultRow[];
  return {
    ...parseHookEvaluationRow(row),
    results: results.map((result) => ({
      ...result,
      status: result.status === "failed" ? "failed" : "success",
      matchedHookIds: parseJsonArray<string>(result.matchedHookIds),
      blocked: result.blocked === 1,
      blockReason: result.blockReason ?? null,
      mutatedInput: result.mutatedInput === null ? null : parseJsonObject<Record<string, unknown>>(result.mutatedInput, {}),
      sideEffectKinds: parseJsonArray<string>(result.sideEffectKinds),
      expectation: JSON.parse(result.expectation) as HookEvaluationRunResult["expectation"],
      error: parseEvaluationError(result.error),
    })),
  };
}

function parseHookEvaluationRow(row: HookEvaluationRow): HookEvaluation {
  return { ...row, status: row.status === "failed" ? "failed" : "success", cases: parseJsonArray<HookEvalCase>(row.cases), caseSummaries: parseJsonArray<HookCaseSummary>(row.caseSummaries) };
}

function parseJsonArray<T>(value: string): T[] {
  try { const parsed = JSON.parse(value) as unknown; return Array.isArray(parsed) ? parsed as T[] : []; } catch { return []; }
}

function parseJsonObject<T>(value: string, fallback: T): T {
  try { const parsed = JSON.parse(value) as unknown; return typeof parsed === "object" && parsed !== null ? parsed as T : fallback; } catch { return fallback; }
}

type SkillRegistryRow = {
  id: string;
  workspace_id: string;
  slug: string;
  name: string;
  status: string;
  version: number;
  supersedes_id: string | null;
  source: string;
  score: number | null;
  activation_rate: number | null;
  usage_count: number;
  prod_injected_count: number;
  prod_activated_count: number;
  regression_status: string;
  last_regression_at: number | null;
  regression_reason: string | null;
  regression_score_delta: number | null;
  regression_activation_delta: number | null;
  last_evaluation_id: string | null;
  origin_session_id: string | null;
  created_at: number;
  updated_at: number;
};

export type SkillRegistryRetestTrigger = "manual_evaluate" | "version_bump" | "model_upgrade" | "retest_all_active";

export interface SkillRegistryEvalHistoryEntry {
  id: string;
  workspaceId: string;
  registryId: string;
  slug: string;
  skillVersion: number;
  evaluationId: string;
  model: string;
  triggerKind: SkillRegistryRetestTrigger;
  score: number | null;
  activationRate: number | null;
  previousEvaluationId: string | null;
  previousScore: number | null;
  previousActivationRate: number | null;
  scoreDelta: number | null;
  activationDelta: number | null;
  regressionStatus: SkillRegressionStatus;
  regressionReason: string | null;
  createdAt: number;
}

type SkillRegistryEvalHistoryRow = {
  id: string;
  workspace_id: string;
  registry_id: string;
  slug: string;
  skill_version: number;
  evaluation_id: string;
  model: string;
  trigger_kind: string;
  score: number | null;
  activation_rate: number | null;
  previous_evaluation_id: string | null;
  previous_score: number | null;
  previous_activation_rate: number | null;
  score_delta: number | null;
  activation_delta: number | null;
  regression_status: string;
  regression_reason: string | null;
  created_at: number;
};

export interface CreateSkillRegistryInput extends SkillRegistryInput {
  version?: number;
  supersedesId?: string | null;
}

export interface UpdateSkillRegistryInput {
  id: string;
  name?: string;
  status?: SkillStatus;
  version?: number;
  supersedesId?: string | null;
}

export function listSkillRegistryEntries(workspaceId: string, status?: SkillStatus): SkillRegistryEntry[] {
  const rows = status
    ? db.prepare(
        `SELECT * FROM skill_registry
         WHERE workspace_id = ? AND status = ?
         ORDER BY updated_at DESC`,
      ).all(workspaceId, status)
    : db.prepare(
        `SELECT * FROM skill_registry
         WHERE workspace_id = ?
         ORDER BY updated_at DESC`,
      ).all(workspaceId);
  return (rows as SkillRegistryRow[]).map(mapSkillRegistryRow);
}

export function getSkillRegistryEntry(id: string): SkillRegistryEntry | undefined {
  const row = db.prepare("SELECT * FROM skill_registry WHERE id = ?").get(id) as SkillRegistryRow | undefined;
  return row ? mapSkillRegistryRow(row) : undefined;
}

export function getSkillRegistryEntryBySlug(
  workspaceId: string,
  slug: string,
  version?: number,
): SkillRegistryEntry | undefined {
  const row = version === undefined
    ? db.prepare(
        `SELECT * FROM skill_registry
         WHERE workspace_id = ? AND slug = ?
         ORDER BY version DESC, updated_at DESC
         LIMIT 1`,
      ).get(workspaceId, slug)
    : db.prepare(
        `SELECT * FROM skill_registry
         WHERE workspace_id = ? AND slug = ? AND version = ?`,
      ).get(workspaceId, slug, version);
  return row ? mapSkillRegistryRow(row as SkillRegistryRow) : undefined;
}

export function createSkillRegistryEntry(workspaceId: string, input: CreateSkillRegistryInput): SkillRegistryEntry {
  const now = Date.now();
  const id = randomUUID();
  const version = input.version ?? nextSkillRegistryVersion(workspaceId, input.slug);
  const status = input.status ?? "active";
  db.prepare(
    `INSERT INTO skill_registry
     (id, workspace_id, slug, name, status, version, supersedes_id, source, score, activation_rate, usage_count, origin_session_id, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, 0, ?, ?, ?)`,
  ).run(
    id,
    workspaceId,
    input.slug,
    input.name,
    status,
    version,
    input.supersedesId ?? null,
    input.source,
    input.originSessionId ?? null,
    now,
    now,
  );
  enableForOrigin(workspaceId, "skill", id);
  if (status === "archived") setMemoryEnablement(workspaceId, "skill", id, false);
  return getSkillRegistryEntry(id)!;
}

export function updateSkillRegistryEntry(input: UpdateSkillRegistryInput): SkillRegistryEntry | undefined {
  const existing = getSkillRegistryEntry(input.id);
  if (!existing) return undefined;
  const next = {
    name: input.name ?? existing.name,
    status: input.status ?? existing.status,
    version: input.version ?? existing.version,
    supersedesId: input.supersedesId === undefined ? existing.supersedesId : input.supersedesId,
  };
  db.prepare(
    `UPDATE skill_registry
     SET name = ?, status = ?, version = ?, supersedes_id = ?, updated_at = ?
     WHERE id = ?`,
  ).run(next.name, next.status, next.version, next.supersedesId, Date.now(), input.id);
  // 归档=全局淘汰：关闭所有工作区对该 skill 的启用（卡 P1·D 口径）；非归档仅恢复 origin 启用。
  if (next.status === "archived") disableItemEverywhere("skill", existing.id);
  else setMemoryEnablement(existing.workspaceId, "skill", existing.id, true);
  return getSkillRegistryEntry(input.id);
}

export function archiveSkillRegistryEntry(id: string): SkillRegistryEntry | undefined {
  return updateSkillRegistryEntry({ id, status: "archived" });
}

export function updateSkillRegistryMetrics(
  id: string,
  metrics: { score: number | null; activationRate: number | null; adoptionThreshold?: number },
): SkillRegistryEntry | undefined {
  const existing = getSkillRegistryEntry(id);
  if (!existing) return undefined;
  const nextStatus = existing.status === "candidate"
    && metrics.score !== null
    && metrics.score >= (metrics.adoptionThreshold ?? 0.6)
    ? "draft"
    : existing.status;
  db.prepare(
    `UPDATE skill_registry
     SET score = ?, activation_rate = ?, status = ?, updated_at = ?
     WHERE id = ?`,
  ).run(metrics.score, metrics.activationRate, nextStatus, Date.now(), id);
  return getSkillRegistryEntry(id);
}

export function updateSkillRegistryRegression(
  id: string,
  input: {
    evaluationId: string;
    regressionStatus: SkillRegressionStatus;
    regressionReason: string | null;
    scoreDelta: number | null;
    activationDelta: number | null;
  },
): SkillRegistryEntry | undefined {
  if (!getSkillRegistryEntry(id)) return undefined;
  db.prepare(
    `UPDATE skill_registry
     SET regression_status = ?,
         last_regression_at = ?,
         regression_reason = ?,
         regression_score_delta = ?,
         regression_activation_delta = ?,
         last_evaluation_id = ?,
         updated_at = ?
     WHERE id = ?`,
  ).run(
    input.regressionStatus,
    input.regressionStatus === "regression" ? Date.now() : null,
    input.regressionReason,
    input.scoreDelta,
    input.activationDelta,
    input.evaluationId,
    Date.now(),
    id,
  );
  return getSkillRegistryEntry(id);
}

export function recordSkillRegistryEvalHistory(input: {
  workspaceId: string;
  registryId: string;
  slug: string;
  skillVersion: number;
  evaluationId: string;
  model: string;
  triggerKind: SkillRegistryRetestTrigger;
  score: number | null;
  activationRate: number | null;
  previousEvaluationId: string | null;
  previousScore: number | null;
  previousActivationRate: number | null;
  scoreDelta: number | null;
  activationDelta: number | null;
  regressionStatus: SkillRegressionStatus;
  regressionReason: string | null;
}): SkillRegistryEvalHistoryEntry {
  const id = randomUUID();
  const createdAt = Date.now();
  db.prepare(
    `INSERT INTO skill_registry_eval_history
     (id, workspace_id, registry_id, slug, skill_version, evaluation_id, model, trigger_kind,
      score, activation_rate, previous_evaluation_id, previous_score, previous_activation_rate,
      score_delta, activation_delta, regression_status, regression_reason, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    input.workspaceId,
    input.registryId,
    input.slug,
    input.skillVersion,
    input.evaluationId,
    input.model,
    input.triggerKind,
    input.score,
    input.activationRate,
    input.previousEvaluationId,
    input.previousScore,
    input.previousActivationRate,
    input.scoreDelta,
    input.activationDelta,
    input.regressionStatus,
    input.regressionReason,
    createdAt,
  );
  return getSkillRegistryEvalHistoryById(id)!;
}

export function getLatestSkillRegistryEvalHistory(input: {
  workspaceId: string;
  slug: string;
  excludeEvaluationId?: string;
}): SkillRegistryEvalHistoryEntry | undefined {
  const row = input.excludeEvaluationId
    ? db.prepare(
        `SELECT * FROM skill_registry_eval_history
         WHERE workspace_id = ? AND slug = ? AND evaluation_id != ?
         ORDER BY created_at DESC
         LIMIT 1`,
      ).get(input.workspaceId, input.slug, input.excludeEvaluationId)
    : db.prepare(
        `SELECT * FROM skill_registry_eval_history
         WHERE workspace_id = ? AND slug = ?
         ORDER BY created_at DESC
         LIMIT 1`,
      ).get(input.workspaceId, input.slug);
  return row ? mapSkillRegistryEvalHistoryRow(row as SkillRegistryEvalHistoryRow) : undefined;
}

export function getSkillRegistryEvalHistoryById(id: string): SkillRegistryEvalHistoryEntry | undefined {
  const row = db.prepare("SELECT * FROM skill_registry_eval_history WHERE id = ?").get(id) as SkillRegistryEvalHistoryRow | undefined;
  return row ? mapSkillRegistryEvalHistoryRow(row) : undefined;
}

// G 卡：回归/漂移历史时间线只读查询。按 workspace 必传；slug/registryId 可选筛选；
// limit 默认 200，封顶 1000，避免大窗口拉爆 D 域时间线渲染。
export function listSkillRegistryEvalHistory(input: {
  workspaceId: string;
  slug?: string;
  registryId?: string;
  limit?: number;
}): SkillRegistryEvalHistoryEntry[] {
  const limit = Math.max(1, Math.min(1000, Math.floor(input.limit ?? 200)));
  const conditions: string[] = ["workspace_id = ?"];
  const params: (string | number)[] = [input.workspaceId];
  if (input.slug) {
    conditions.push("slug = ?");
    params.push(input.slug);
  }
  if (input.registryId) {
    conditions.push("registry_id = ?");
    params.push(input.registryId);
  }
  const rows = db.prepare(
    `SELECT * FROM skill_registry_eval_history
     WHERE ${conditions.join(" AND ")}
     ORDER BY created_at DESC
     LIMIT ?`,
  ).all(...params, limit);
  return (rows as SkillRegistryEvalHistoryRow[]).map(mapSkillRegistryEvalHistoryRow);
}

export function incrementSkillRegistryUsage(id: string, by = 1): SkillRegistryEntry | undefined {
  if (!getSkillRegistryEntry(id)) return undefined;
  db.prepare(
    `UPDATE skill_registry
     SET usage_count = usage_count + ?, updated_at = ?
     WHERE id = ?`,
  ).run(Math.max(1, Math.floor(by)), Date.now(), id);
  return getSkillRegistryEntry(id);
}

// A 卡：记一次生产真实运行的注入与（可选）激活。口径独立于评测分(score/activationRate)
// 与注入埋点(usageCount)：prod_injected_count 永远 +1，prod_activated_count 仅在本次
// 真实激活时 +1。registry 派生 prodActivationRate = activated / injected。
export function recordSkillActivationOutcome(id: string, activated: boolean): SkillRegistryEntry | undefined {
  if (!getSkillRegistryEntry(id)) return undefined;
  db.prepare(
    `UPDATE skill_registry
     SET prod_injected_count = prod_injected_count + 1,
         prod_activated_count = prod_activated_count + ?,
         updated_at = ?
     WHERE id = ?`,
  ).run(activated ? 1 : 0, Date.now(), id);
  return getSkillRegistryEntry(id);
}

// A 卡：生产 run 完成（成功、非 abort）后，对本次注入的每个 registry skill 记一次生产
// 注入，并按 detectSkillActivation 的证据判定是否真实激活。仅生产链路调用（flow chat /
// workflow / autonomous）；评测路径不调用，避免污染实验室口径。
export function recordSkillActivationForRun(input: {
  workspaceId: string;
  workspaceRoot: string;
  skillPaths: string[] | undefined;
  output: string;
}): void {
  const { workspaceId, workspaceRoot, skillPaths, output } = input;
  if (!skillPaths || skillPaths.length === 0) return;
  // registry 内容真源 = <workspaceRoot>/.pi/skills/<slug>/SKILL.md（与 routes/engine.ts
  // registrySkillPath 同约定）；据此把注入的绝对路径映射回 registry 行，过滤已归档。
  const byPath = new Map<string, SkillRegistryEntry>();
  for (const entry of listSkillRegistryEntries(workspaceId)) {
    if (entry.status === "archived") continue;
    byPath.set(resolve(join(workspaceRoot, ".pi", "skills", entry.slug, "SKILL.md")), entry);
  }
  if (byPath.size === 0) return;
  const activatedPaths = new Set(
    detectSkillActivation({ skillPaths, output }).evidence.map((e) => e.skillPath),
  );
  const seen = new Set<string>();
  for (const skillPath of skillPaths) {
    const entry = byPath.get(resolve(skillPath));
    if (!entry || seen.has(entry.id)) continue;
    seen.add(entry.id);
    recordSkillActivationOutcome(entry.id, activatedPaths.has(skillPath));
  }
}

function nextSkillRegistryVersion(workspaceId: string, slug: string): number {
  const row = db.prepare(
    "SELECT MAX(version) AS maxVersion FROM skill_registry WHERE workspace_id = ? AND slug = ?",
  ).get(workspaceId, slug) as { maxVersion: number | null } | undefined;
  return (row?.maxVersion ?? 0) + 1;
}

function mapSkillRegistryRow(row: SkillRegistryRow): SkillRegistryEntry {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    slug: row.slug,
    name: row.name,
    status: normalizeSkillStatus(row.status),
    version: row.version,
    supersedesId: row.supersedes_id,
    source: normalizeSkillSource(row.source),
    score: row.score,
    activationRate: row.activation_rate,
    usageCount: row.usage_count,
    prodInjectedCount: row.prod_injected_count,
    prodActivatedCount: row.prod_activated_count,
    prodActivationRate: row.prod_injected_count > 0
      ? row.prod_activated_count / row.prod_injected_count
      : null,
    regressionStatus: normalizeSkillRegressionStatus(row.regression_status),
    lastRegressionAt: row.last_regression_at,
    regressionReason: row.regression_reason,
    regressionScoreDelta: row.regression_score_delta,
    regressionActivationDelta: row.regression_activation_delta,
    lastEvaluationId: row.last_evaluation_id,
    originSessionId: row.origin_session_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapSkillRegistryEvalHistoryRow(row: SkillRegistryEvalHistoryRow): SkillRegistryEvalHistoryEntry {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    registryId: row.registry_id,
    slug: row.slug,
    skillVersion: row.skill_version,
    evaluationId: row.evaluation_id,
    model: row.model,
    triggerKind: normalizeSkillRegistryRetestTrigger(row.trigger_kind),
    score: row.score,
    activationRate: row.activation_rate,
    previousEvaluationId: row.previous_evaluation_id,
    previousScore: row.previous_score,
    previousActivationRate: row.previous_activation_rate,
    scoreDelta: row.score_delta,
    activationDelta: row.activation_delta,
    regressionStatus: normalizeSkillRegressionStatus(row.regression_status),
    regressionReason: row.regression_reason,
    createdAt: row.created_at,
  };
}

function normalizeSkillStatus(value: string): SkillStatus {
  if (value === "draft" || value === "candidate" || value === "active" || value === "archived") return value;
  return "draft";
}

function normalizeSkillSource(value: string): SkillSource {
  if (value === "manual" || value === "distilled" || value === "curated" || value === "imported") return value;
  return "manual";
}

function normalizeSkillRegressionStatus(value: string): SkillRegressionStatus {
  return value === "regression" ? "regression" : "none";
}

function normalizeSkillRegistryRetestTrigger(value: string): SkillRegistryRetestTrigger {
  if (value === "manual_evaluate" || value === "version_bump" || value === "model_upgrade" || value === "retest_all_active") return value;
  return "manual_evaluate";
}

// ---- tool evaluations ----

export function createToolCaseSet(workspaceId: string, name: string, toolId: string, cases: ToolEvalCase[]): ToolCaseSet {
  const now = Date.now();
  const id = randomUUID();
  db.prepare(
    "INSERT INTO tool_case_sets (id, workspace_id, name, tool_id, cases, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
  ).run(id, workspaceId, name, toolId, JSON.stringify(cases), now, now);
  return { id, workspaceId, name, toolId, cases, createdAt: now, updatedAt: now };
}

export function getToolCaseSet(id: string): ToolCaseSet | undefined {
  const row = db.prepare(
    "SELECT id, workspace_id AS workspaceId, name, tool_id AS toolId, cases, created_at AS createdAt, updated_at AS updatedAt FROM tool_case_sets WHERE id = ?",
  ).get(id) as unknown as ToolCaseSetRow | undefined;
  return row ? parseToolCaseSetRow(row) : undefined;
}

export function listToolCaseSets(workspaceId: string, toolId?: string): ToolCaseSet[] {
  const rows = toolId
    ? db.prepare(
      "SELECT id, workspace_id AS workspaceId, name, tool_id AS toolId, cases, created_at AS createdAt, updated_at AS updatedAt FROM tool_case_sets WHERE workspace_id = ? AND tool_id = ? ORDER BY updated_at DESC",
    ).all(workspaceId, toolId) as unknown as ToolCaseSetRow[]
    : db.prepare(
      "SELECT id, workspace_id AS workspaceId, name, tool_id AS toolId, cases, created_at AS createdAt, updated_at AS updatedAt FROM tool_case_sets WHERE workspace_id = ? ORDER BY updated_at DESC",
    ).all(workspaceId) as unknown as ToolCaseSetRow[];
  return rows.map(parseToolCaseSetRow);
}

export function updateToolCaseSet(id: string, name: string, toolId: string, cases: ToolEvalCase[]): ToolCaseSet | undefined {
  const existing = getToolCaseSet(id);
  if (!existing) return undefined;
  const updatedAt = Date.now();
  db.prepare("UPDATE tool_case_sets SET name = ?, tool_id = ?, cases = ?, updated_at = ? WHERE id = ?")
    .run(name, toolId, JSON.stringify(cases), updatedAt, id);
  return { ...existing, name, toolId, cases, updatedAt };
}

export function deleteToolCaseSet(id: string): boolean {
  const result = db.prepare("DELETE FROM tool_case_sets WHERE id = ?").run(id);
  return result.changes > 0;
}

type ToolCaseSetRow = Omit<ToolCaseSet, "cases"> & {
  cases: string;
};

function parseToolCaseSetRow(row: ToolCaseSetRow): ToolCaseSet {
  return {
    ...row,
    cases: parseJsonArray<ToolEvalCase>(row.cases),
  };
}

export function saveToolEvaluation(
  workspaceId: string,
  toolId: string,
  repeat: number,
  cases: ToolEvalCase[],
  summary: Omit<ToolEvaluationDetail, "workspaceId" | "toolId" | "repeat" | "cases">,
): ToolEvaluationDetail {
  db.prepare(
    "INSERT INTO tool_evaluations (id, workspace_id, tool_id, repeat, status, started_at, ended_at, duration_sec, cases, case_summaries) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
  ).run(
    summary.evaluationId,
    workspaceId,
    toolId,
    repeat,
    summary.status,
    summary.startedAt,
    summary.endedAt,
    summary.durationSec,
    JSON.stringify(cases),
    JSON.stringify(summary.caseSummaries),
  );
  const insert = db.prepare(
    "INSERT INTO tool_evaluation_results (id, evaluation_id, case_id, case_name, attempt, status, started_at, ended_at, duration_sec, input_path, output_path, stdout, stderr, summary, expectation, error) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
  );
  for (const result of summary.results) {
    insert.run(
      result.id,
      summary.evaluationId,
      result.caseId,
      result.caseName,
      result.attempt,
      result.status,
      result.startedAt,
      result.endedAt,
      result.durationSec,
      result.inputPath,
      result.outputPath,
      result.stdout,
      result.stderr,
      result.summary ? JSON.stringify(result.summary) : null,
      JSON.stringify(result.expectation),
      serializeEvaluationError(result.error),
    );
  }
  return {
    evaluationId: summary.evaluationId,
    workspaceId,
    toolId,
    repeat,
    status: summary.status,
    startedAt: summary.startedAt,
    endedAt: summary.endedAt,
    durationSec: summary.durationSec,
    cases,
    caseSummaries: summary.caseSummaries,
    results: summary.results,
  };
}

export function listToolEvaluations(workspaceId: string): ToolEvaluation[] {
  const rows = db.prepare(
    "SELECT id AS evaluationId, workspace_id AS workspaceId, tool_id AS toolId, repeat, status, started_at AS startedAt, ended_at AS endedAt, duration_sec AS durationSec, cases, case_summaries AS caseSummaries FROM tool_evaluations WHERE workspace_id = ? ORDER BY started_at DESC",
  ).all(workspaceId) as unknown as ToolEvaluationRow[];
  return rows.map(parseToolEvaluationRow);
}

export function getToolEvaluation(id: string): ToolEvaluationDetail | undefined {
  const row = db.prepare(
    "SELECT id AS evaluationId, workspace_id AS workspaceId, tool_id AS toolId, repeat, status, started_at AS startedAt, ended_at AS endedAt, duration_sec AS durationSec, cases, case_summaries AS caseSummaries FROM tool_evaluations WHERE id = ?",
  ).get(id) as unknown as ToolEvaluationRow | undefined;
  if (!row) return undefined;
  const evaluation = parseToolEvaluationRow(row);
  const results = db.prepare(
    "SELECT id, case_id AS caseId, case_name AS caseName, attempt, status, started_at AS startedAt, ended_at AS endedAt, duration_sec AS durationSec, input_path AS inputPath, output_path AS outputPath, stdout, stderr, summary, expectation, error FROM tool_evaluation_results WHERE evaluation_id = ? ORDER BY case_name, attempt",
  ).all(id) as unknown as ToolEvaluationResultRow[];
  return {
    ...evaluation,
    results: results.map(parseToolEvaluationResultRow),
  };
}

type ToolEvaluationRow = Omit<ToolEvaluation, "cases" | "caseSummaries"> & {
  cases: string;
  caseSummaries: string;
};

type ToolEvaluationResultRow = Omit<ToolEvaluationRunResult, "summary" | "expectation" | "error"> & {
  summary: string | null;
  expectation: string;
  error: unknown;
};

function parseToolEvaluationRow(row: ToolEvaluationRow): ToolEvaluation {
  return {
    ...row,
    status: row.status === "failed" ? "failed" : "success",
    cases: parseJsonArray<ToolEvalCase>(row.cases),
    caseSummaries: parseJsonArray<ToolCaseSummary>(row.caseSummaries),
  };
}

function parseToolEvaluationResultRow(row: ToolEvaluationResultRow): ToolEvaluationRunResult {
  return {
    ...row,
    status: row.status === "failed" ? "failed" : "success",
    summary: row.summary ? parseJsonObject(row.summary, {}) : null,
    expectation: parseJsonObject(row.expectation, { kind: "must-fail" }),
    error: parseEvaluationError(row.error),
  };
}

// ---- skill evaluations ----

export function createSkillEvalSet(workspaceId: string, name: string, tasks: SkillEvalTask[]): SkillEvalSet {
  const now = Date.now();
  const id = randomUUID();
  db.prepare(
    "INSERT INTO skill_eval_sets (id, workspace_id, name, tasks, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
  ).run(id, workspaceId, name, JSON.stringify(tasks), now, now);
  return { id, workspaceId, name, tasks, createdAt: now, updatedAt: now };
}

export function getSkillEvalSet(id: string): SkillEvalSet | undefined {
  const row = db.prepare(
    "SELECT id, workspace_id AS workspaceId, name, tasks, created_at AS createdAt, updated_at AS updatedAt FROM skill_eval_sets WHERE id = ?",
  ).get(id) as unknown as SkillEvalSetRow | undefined;
  return row ? parseSkillEvalSetRow(row) : undefined;
}

export function listSkillEvalSets(workspaceId: string): SkillEvalSet[] {
  const rows = db.prepare(
    "SELECT id, workspace_id AS workspaceId, name, tasks, created_at AS createdAt, updated_at AS updatedAt FROM skill_eval_sets WHERE workspace_id = ? ORDER BY updated_at DESC",
  ).all(workspaceId) as unknown as SkillEvalSetRow[];
  return rows.map(parseSkillEvalSetRow);
}

export function updateSkillEvalSet(id: string, name: string, tasks: SkillEvalTask[]): SkillEvalSet | undefined {
  const existing = getSkillEvalSet(id);
  if (!existing) return undefined;
  const updatedAt = Date.now();
  db.prepare("UPDATE skill_eval_sets SET name = ?, tasks = ?, updated_at = ? WHERE id = ?")
    .run(name, JSON.stringify(tasks), updatedAt, id);
  return { ...existing, name, tasks, updatedAt };
}

export function deleteSkillEvalSet(id: string): boolean {
  const result = db.prepare("DELETE FROM skill_eval_sets WHERE id = ?").run(id);
  return result.changes > 0;
}

type SkillEvalSetRow = Omit<SkillEvalSet, "tasks"> & {
  tasks: string;
};

function parseSkillEvalSetRow(row: SkillEvalSetRow): SkillEvalSet {
  return {
    ...row,
    tasks: parseJsonArray<SkillEvalTask>(row.tasks),
  };
}

export function saveSkillEvaluation(
  workspaceId: string,
  model: string,
  repeat: number,
  variants: SkillVariant[],
  tasks: SkillEvalTask[],
  contextPrefix: string | undefined,
  summary: Omit<SkillEvaluationDetail, "workspaceId" | "model" | "repeat" | "variants" | "tasks" | "contextPrefix">,
): SkillEvaluationDetail {
  db.prepare(
    "INSERT INTO skill_evaluations (id, workspace_id, model, repeat, status, started_at, ended_at, duration_sec, variants, tasks, context_prefix, variant_summaries, task_summaries, pairwise_summaries) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
  ).run(
    summary.evaluationId,
    workspaceId,
    model,
    repeat,
    summary.status,
    summary.startedAt,
    summary.endedAt,
    summary.durationSec,
    JSON.stringify(variants),
    JSON.stringify(tasks),
    contextPrefix ?? "",
    JSON.stringify(summary.variantSummaries),
    JSON.stringify(summary.taskSummaries),
    JSON.stringify(summary.pairwiseSummaries),
  );
  const insert = db.prepare(
    "INSERT INTO skill_evaluation_results (id, evaluation_id, variant_id, variant_label, task_id, attempt, status, started_at, ended_at, duration_sec, skill_paths, total_tokens, total_cost, tool_calls, output_chars, output, activation, pairwise, error) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
  );
  for (const result of summary.results) {
    insert.run(
      result.id,
      summary.evaluationId,
      result.variantId,
      result.variantLabel,
      result.taskId,
      result.attempt,
      result.status,
      result.startedAt,
      result.endedAt,
      result.durationSec,
      JSON.stringify(result.skillPaths),
      result.totalTokens,
      result.totalCost,
      result.toolCalls,
      result.outputChars,
      result.output,
      JSON.stringify(result.activation),
      result.pairwise ? JSON.stringify(result.pairwise) : null,
      serializeEvaluationError(result.error),
    );
  }
  return {
    evaluationId: summary.evaluationId,
    workspaceId,
    model,
    repeat,
    status: summary.status,
    startedAt: summary.startedAt,
    endedAt: summary.endedAt,
    durationSec: summary.durationSec,
    variants,
    tasks,
    contextPrefix: contextPrefix ?? "",
    results: summary.results,
    variantSummaries: summary.variantSummaries,
    taskSummaries: summary.taskSummaries,
    pairwiseSummaries: summary.pairwiseSummaries,
  };
}

export function listSkillEvaluations(workspaceId: string): SkillEvaluation[] {
  const rows = db.prepare(
    "SELECT id AS evaluationId, workspace_id AS workspaceId, model, repeat, status, started_at AS startedAt, ended_at AS endedAt, duration_sec AS durationSec, variants, tasks, context_prefix AS contextPrefix, variant_summaries AS variantSummaries, task_summaries AS taskSummaries, pairwise_summaries AS pairwiseSummaries FROM skill_evaluations WHERE workspace_id = ? ORDER BY started_at DESC",
  ).all(workspaceId) as unknown as SkillEvaluationRow[];
  return rows.map(parseSkillEvaluationRow);
}

export function getSkillEvaluation(id: string): SkillEvaluationDetail | undefined {
  const row = db.prepare(
    "SELECT id AS evaluationId, workspace_id AS workspaceId, model, repeat, status, started_at AS startedAt, ended_at AS endedAt, duration_sec AS durationSec, variants, tasks, context_prefix AS contextPrefix, variant_summaries AS variantSummaries, task_summaries AS taskSummaries, pairwise_summaries AS pairwiseSummaries FROM skill_evaluations WHERE id = ?",
  ).get(id) as unknown as SkillEvaluationRow | undefined;
  if (!row) return undefined;
  const evaluation = parseSkillEvaluationRow(row);
  const results = db.prepare(
    "SELECT id, variant_id AS variantId, variant_label AS variantLabel, task_id AS taskId, attempt, status, started_at AS startedAt, ended_at AS endedAt, duration_sec AS durationSec, skill_paths AS skillPaths, total_tokens AS totalTokens, total_cost AS totalCost, tool_calls AS toolCalls, output_chars AS outputChars, output, activation, pairwise, error FROM skill_evaluation_results WHERE evaluation_id = ? ORDER BY variant_label, task_id, attempt",
  ).all(id) as unknown as SkillEvaluationResultRow[];
  return {
    ...evaluation,
    results: results.map(parseSkillEvaluationResultRow),
  };
}

type SkillEvaluationRow = Omit<SkillEvaluation, "variants" | "tasks" | "variantSummaries" | "taskSummaries" | "pairwiseSummaries"> & {
  variants: string;
  tasks: string;
  variantSummaries: string;
  taskSummaries: string;
  pairwiseSummaries: string;
};

type SkillEvaluationResultRow = Omit<SkillEvaluationRunResult, "skillPaths" | "activation" | "pairwise" | "error"> & {
  skillPaths: string;
  activation: string;
  pairwise: string | null;
  error: unknown;
};

function parseSkillEvaluationRow(row: SkillEvaluationRow): SkillEvaluation {
  return {
    ...row,
    status: row.status === "failed" ? "failed" : "success",
    variants: parseJsonArray<SkillVariant>(row.variants),
    tasks: parseJsonArray<SkillEvalTask>(row.tasks),
    variantSummaries: parseJsonArray<SkillVariantSummary>(row.variantSummaries),
    taskSummaries: parseJsonArray<SkillTaskSummary>(row.taskSummaries),
    pairwiseSummaries: parseJsonArray<SkillPairwiseSummary>(row.pairwiseSummaries),
  };
}

function parseSkillEvaluationResultRow(row: SkillEvaluationResultRow): SkillEvaluationRunResult {
  return {
    ...row,
    status: row.status === "failed" ? "failed" : "success",
    skillPaths: parseJsonArray<string>(row.skillPaths),
    activation: parseJsonObject(row.activation, {
      activated: false,
      matchedKeywords: [],
      matchedSkillPaths: [],
      evidence: [],
    }),
    pairwise: row.pairwise ? parseJsonObject<SkillPairwiseResult | null>(row.pairwise, null) : null,
    error: parseEvaluationError(row.error),
  };
}

// ── E-MONITOR2: monitor_metric_systems CRUD ──

import type { MonitorMetricSystemDraft as _MMSDraft, HealthFinding as _HF, MonitorMetricSystemEntry, MonitorRun } from "../types.ts";

type MonitorMSRow = {
  id: string;
  workspace_id: string;
  name: string;
  draft_json: string;
  status: string;
  created_at: number;
  updated_at: number;
};

function parseMonitorMSRow(r: MonitorMSRow): MonitorMetricSystemEntry {
  return {
    id: r.id,
    workspaceId: r.workspace_id,
    name: r.name,
    draft: parseJsonObject<_MMSDraft>(r.draft_json, { metrics: [], dependencies: [], monitorRules: [], assumptions: [], missingData: [] }),
    status: r.status,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export function createMonitorMetricSystem(workspaceId: string, name: string, draft: _MMSDraft): MonitorMetricSystemEntry {
  const id = randomUUID();
  const now = Date.now();
  db.prepare("INSERT INTO monitor_metric_systems (id, workspace_id, name, draft_json, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
    .run(id, workspaceId, name, JSON.stringify(draft), "adopted", now, now);
  return { id, workspaceId, name, draft, status: "adopted", createdAt: now, updatedAt: now };
}

export function getMonitorMetricSystem(id: string): MonitorMetricSystemEntry | undefined {
  const r = db.prepare("SELECT * FROM monitor_metric_systems WHERE id = ?").get(id) as MonitorMSRow | undefined;
  return r ? parseMonitorMSRow(r) : undefined;
}

export function listMonitorMetricSystems(workspaceId: string): MonitorMetricSystemEntry[] {
  const rows = db.prepare("SELECT * FROM monitor_metric_systems WHERE workspace_id = ? ORDER BY updated_at DESC").all(workspaceId) as MonitorMSRow[];
  return rows.map(parseMonitorMSRow);
}

export function deleteMonitorMetricSystem(id: string): boolean {
  const r = db.prepare("DELETE FROM monitor_metric_systems WHERE id = ?").run(id);
  return r.changes > 0;
}

// ── monitor_runs / monitor_findings CRUD ──

export function insertMonitorRun(workspaceId: string, suite: MonitorRun["suite"], metricSystemId: string | null): MonitorRun {
  const id = randomUUID();
  const now = Date.now();
  db.prepare("INSERT INTO monitor_runs (id, workspace_id, suite, metric_system_id, started_at, status) VALUES (?, ?, ?, ?, ?, 'running')")
    .run(id, workspaceId, suite, metricSystemId, now);
  return { id, workspaceId, suite, metricSystemId, startedAt: now, finishedAt: null, problemCount: 0, riskCount: 0, status: "running" };
}

export function finishMonitorRun(runId: string, patch: { problemCount: number; riskCount: number; status: "done" | "error" }): void {
  db.prepare("UPDATE monitor_runs SET finished_at = ?, problem_count = ?, risk_count = ?, status = ? WHERE id = ?")
    .run(Date.now(), patch.problemCount, patch.riskCount, patch.status, runId);
}

export function listMonitorRuns(workspaceId: string): MonitorRun[] {
  type Row = { id: string; workspace_id: string; suite: string; metric_system_id: string | null; started_at: number; finished_at: number | null; problem_count: number; risk_count: number; status: string };
  const rows = db.prepare("SELECT * FROM monitor_runs WHERE workspace_id = ? ORDER BY started_at DESC").all(workspaceId) as Row[];
  return rows.map((r) => ({
    id: r.id, workspaceId: r.workspace_id, suite: r.suite as MonitorRun["suite"], metricSystemId: r.metric_system_id,
    startedAt: r.started_at, finishedAt: r.finished_at, problemCount: r.problem_count, riskCount: r.risk_count, status: r.status as MonitorRun["status"],
  }));
}

export function insertMonitorFindings(findings: _HF[]): void {
  if (findings.length === 0) return;
  const stmt = db.prepare("INSERT INTO monitor_findings (id, run_id, rule_id, category, kind, severity, lifecycle, signature, first_seen_run_id, title, evidence, bound_to, comparisons, diagnosis, suggestion, detected_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)");
  for (const f of findings) {
    stmt.run(f.id, f.runId, f.ruleId, f.category, f.kind, f.severity, f.lifecycle, f.signature, f.firstSeenRunId ?? null,
      f.title, JSON.stringify(f.evidence), f.boundTo ? JSON.stringify(f.boundTo) : null,
      f.comparisons ? JSON.stringify(f.comparisons) : null, f.diagnosis ? JSON.stringify(f.diagnosis) : null,
      f.suggestion, f.detectedAt);
  }
}

export function listMonitorFindings(runId: string): _HF[] {
  type Row = { id: string; run_id: string; rule_id: string; category: string; kind: string; severity: string; lifecycle: string; signature: string; first_seen_run_id: string | null; title: string; evidence: string; bound_to: string | null; comparisons: string | null; diagnosis: string | null; suggestion: string; detected_at: number };
  const rows = db.prepare("SELECT * FROM monitor_findings WHERE run_id = ? ORDER BY severity DESC, detected_at DESC").all(runId) as Row[];
  return rows.map((r) => ({
    id: r.id, runId: r.run_id, ruleId: r.rule_id,
    category: r.category as _HF["category"], kind: r.kind as _HF["kind"], severity: r.severity as _HF["severity"],
    lifecycle: r.lifecycle as _HF["lifecycle"], signature: r.signature, firstSeenRunId: r.first_seen_run_id,
    title: r.title, evidence: parseJsonObject(r.evidence, {}),
    boundTo: r.bound_to ? parseJsonObject(r.bound_to, undefined) : undefined,
    comparisons: r.comparisons ? (JSON.parse(r.comparisons) as _HF["comparisons"]) : undefined,
    diagnosis: r.diagnosis ? parseJsonObject(r.diagnosis, undefined) : undefined,
    suggestion: r.suggestion, detectedAt: r.detected_at,
  }));
}

// 跨 run 取 prior findings：同 workspace + 同 suite + 同 metricSystem 最近一次 done 的 findings
export function findPriorMonitorFindings(workspaceId: string, suite: string, metricSystemId: string | null, excludeRunId?: string): _HF[] {
  type Row = { id: string };
  const metricSql = metricSystemId ? "metric_system_id = ?" : "metric_system_id IS NULL";
  const sql = excludeRunId
    ? `SELECT id FROM monitor_runs WHERE workspace_id = ? AND suite = ? AND ${metricSql} AND status = 'done' AND id != ? ORDER BY started_at DESC LIMIT 1`
    : `SELECT id FROM monitor_runs WHERE workspace_id = ? AND suite = ? AND ${metricSql} AND status = 'done' ORDER BY started_at DESC LIMIT 1`;
  const params = metricSystemId
    ? excludeRunId ? [workspaceId, suite, metricSystemId, excludeRunId] : [workspaceId, suite, metricSystemId]
    : excludeRunId ? [workspaceId, suite, excludeRunId] : [workspaceId, suite];
  const r = db.prepare(sql).get(...params) as Row | undefined;
  if (!r) return [];
  return listMonitorFindings(r.id);
}
