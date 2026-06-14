import { randomUUID } from "node:crypto";
import { db } from "../db.ts";
import { enableForOrigin, setMemoryEnablement, disableItemEverywhere } from "./shared.ts";
import type { SkillRegistryEntry, SkillRegistryInput, SkillSource, SkillStatus } from "../types.ts";

/**
 * 【Agent-E · 智能引擎域】db 表 slot —— owner: codex(GPT-5.5)
 * Notebook / 新 eval 维度等引擎域新表建在此（flows/sessions/eval legacy 仍在 db.ts）。
 * 约定: 新表 CREATE TABLE IF NOT EXISTS; 配套 CRUD 写本文件, 由 routes/engine.ts 调用。
 */
export function initEngineTables(): void {
  void db; // 占位; 新表写: db.exec(`CREATE TABLE IF NOT EXISTS ...`)
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
  origin_session_id: string | null;
  created_at: number;
  updated_at: number;
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

export function incrementSkillRegistryUsage(id: string, by = 1): SkillRegistryEntry | undefined {
  if (!getSkillRegistryEntry(id)) return undefined;
  db.prepare(
    `UPDATE skill_registry
     SET usage_count = usage_count + ?, updated_at = ?
     WHERE id = ?`,
  ).run(Math.max(1, Math.floor(by)), Date.now(), id);
  return getSkillRegistryEntry(id);
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
    originSessionId: row.origin_session_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
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
