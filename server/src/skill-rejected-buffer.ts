import { db } from "./db.ts";
import type { SkillRewriteEdit } from "./skill-rewrite-gate.ts";

export interface SkillRejectedEdit {
  id: string;
  workspaceId: string;
  registryId: string;
  slug: string;
  edit: SkillRewriteEdit;
  candidateContent: string;
  reason: string;
  evaluationId: string | null;
  createdAt: number;
}

export interface SkillRejectedEditRow {
  id: string;
  workspace_id: string;
  registry_id: string;
  slug: string;
  edit_json: string;
  candidate_content: string;
  reason: string;
  evaluation_id: string | null;
  created_at: number;
}

export function insertRejectedEdit(input: {
  workspaceId: string;
  registryId: string;
  slug: string;
  edit: SkillRewriteEdit;
  candidateContent: string;
  reason: string;
  evaluationId: string | null;
}): SkillRejectedEdit {
  const id = `rej-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const now = Date.now();
  db.prepare(
    `INSERT INTO skill_rejected_edits (id, workspace_id, registry_id, slug, edit_json, candidate_content, reason, evaluation_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(id, input.workspaceId, input.registryId, input.slug, JSON.stringify(input.edit), input.candidateContent, input.reason, input.evaluationId, now);
  return {
    id,
    workspaceId: input.workspaceId,
    registryId: input.registryId,
    slug: input.slug,
    edit: input.edit,
    candidateContent: input.candidateContent,
    reason: input.reason,
    evaluationId: input.evaluationId,
    createdAt: now,
  };
}

export function listRejectedEdits(workspaceId: string, slug?: string): SkillRejectedEdit[] {
  const rows = slug
    ? db.prepare(
        "SELECT * FROM skill_rejected_edits WHERE workspace_id = ? AND slug = ? ORDER BY created_at DESC LIMIT 50",
      ).all(workspaceId, slug) as unknown as SkillRejectedEditRow[]
    : db.prepare(
        "SELECT * FROM skill_rejected_edits WHERE workspace_id = ? ORDER BY created_at DESC LIMIT 100",
      ).all(workspaceId) as unknown as SkillRejectedEditRow[];
  return rows.map(mapRejectedEditRow);
}

export function getRejectedEdit(id: string): SkillRejectedEdit | undefined {
  const row = db.prepare("SELECT * FROM skill_rejected_edits WHERE id = ?").get(id) as unknown as SkillRejectedEditRow | undefined;
  return row ? mapRejectedEditRow(row) : undefined;
}

export function deleteRejectedEdit(id: string): boolean {
  return db.prepare("DELETE FROM skill_rejected_edits WHERE id = ?").run(id).changes > 0;
}

export function buildRejectedFeedbackPrompt(slug: string, workspaceId: string): string {
  const edits = listRejectedEdits(workspaceId, slug);
  if (edits.length === 0) return "";
  const lines = edits.slice(0, 5).map((e, i) =>
    `[被拒编辑 #${String(i + 1)}] 原因: ${e.reason}\n内容片段: ${e.candidateContent.slice(0, 300)}`,
  );
  return `\n\n## 历史被拒编辑（负反馈，避免重复踩坑）\n\n${lines.join("\n\n")}`;
}

function mapRejectedEditRow(row: SkillRejectedEditRow): SkillRejectedEdit {
  let edit: SkillRewriteEdit;
  try {
    edit = JSON.parse(row.edit_json) as SkillRewriteEdit;
  } catch {
    edit = { kind: "replace", after: "" };
  }
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    registryId: row.registry_id,
    slug: row.slug,
    edit,
    candidateContent: row.candidate_content,
    reason: row.reason,
    evaluationId: row.evaluation_id,
    createdAt: row.created_at,
  };
}
