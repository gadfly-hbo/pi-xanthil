import { randomUUID } from "node:crypto";
import { join, resolve } from "node:path";
import { db } from "../db.ts";
import { enableForOrigin, setMemoryEnablement, disableItemEverywhere } from "./shared.ts";
import { detectSkillActivation } from "../skill-activation.ts";
import type { SkillRegressionStatus, SkillRegistryEntry, SkillRegistryInput, SkillSource, SkillStatus } from "../types.ts";

/**
 * 【Agent-E · 智能引擎域】db 表 slot —— owner: codex(GPT-5.5)
 * Notebook / 新 eval 维度等引擎域新表建在此（flows/sessions/eval legacy 仍在 db.ts）。
 * 约定: 新表 CREATE TABLE IF NOT EXISTS; 配套 CRUD 写本文件, 由 routes/engine.ts 调用。
 */
export function initEngineTables(): void {
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
