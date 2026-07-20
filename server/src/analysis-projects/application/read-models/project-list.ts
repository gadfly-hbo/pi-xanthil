/**
 * ProjectListReadModel (§7.1, API-019/API-021).
 * Non-materialized, single SQLite read snapshot.
 * - cursor pagination; limit default 50, range 1-100.
 * - fixed sort: updatedAt DESC, projectId DESC.
 * - filters: kind/status/archiveState; default excludes archived.
 * - no search, offset, or free sorting.
 * - cursor is opaque and bound to the active filters.
 */
import type { DatabaseSync } from "node:sqlite";
import { PROJECT_SELECT, rowToProject, hasEnteredAuditChain, countActiveRuns } from "../projects/project-queries.ts";
import { deriveProjectStage, derivePendingGate, deriveLatestRun, deriveLockedReportId, deriveProjectCommands } from "./project-derivation.ts";
import type { ProjectKind, ProjectStatus } from "../../contracts/registries.ts";
import type { ReadModelEnvelope, CommandAffordance } from "../../contracts/dto.ts";
import type { TrustedActorContext } from "../shared/runtime.ts";

const READ_MODEL_VERSION = "1.0";

export interface ProjectListFilter {
  readonly kind?: ProjectKind | null;
  readonly status?: ProjectStatus | null;
  /** "archived" | "unarchived" | "all"; default "unarchived". */
  readonly archiveState?: "archived" | "unarchived" | "all" | null;
}

export interface ProjectListItem {
  readonly projectId: string;
  readonly kind: ProjectKind;
  readonly title: string;
  readonly slug: string;
  readonly status: ProjectStatus;
  readonly stage: string;
  readonly pendingGate: "requirement_confirmation" | "plan_confirmation" | "report_review" | null;
  readonly latestRun: { readonly runId: string; readonly runOrdinal: number; readonly currentRunStatus: string; readonly currentAnalysisStage: string } | null;
  readonly lockedReportId: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly archivedAt: string | null;
  readonly availableCommands: readonly CommandAffordance[];
}

export interface ProjectListData {
  readonly items: readonly ProjectListItem[];
  readonly nextCursor: string | null;
  readonly hasMore: boolean;
  readonly limit: number;
}

export interface ProjectListQuery {
  readonly db: DatabaseSync;
  readonly workspaceId: string;
  readonly filter?: ProjectListFilter;
  readonly cursor?: string | null;
  readonly limit?: number | null;
  /** Trusted actor context; availableCommands are derived for this actor. */
  readonly actorContext: TrustedActorContext;
}

function clampLimit(n: number | null | undefined): number {
  if (typeof n !== "number" || !Number.isInteger(n)) return 50;
  if (n < 1) return 1;
  if (n > 100) return 100;
  return n;
}

function filterSignature(f: ProjectListFilter): string {
  return `${f.kind ?? ""}|${f.status ?? ""}|${f.archiveState ?? "unarchived"}`;
}

interface CursorPayload {
  readonly u: string; // updatedAt
  readonly p: string; // projectId
  readonly f: string; // filterSignature
}

function encodeCursor(p: CursorPayload): string {
  return Buffer.from(JSON.stringify(p), "utf8").toString("base64url");
}
function decodeCursor(c: string): CursorPayload {
  return JSON.parse(Buffer.from(c, "base64url").toString("utf8")) as CursorPayload;
}

export function queryProjectList(query: ProjectListQuery): ReadModelEnvelope<ProjectListData> {
  const { db, actorContext, workspaceId } = query;
  const actorActiveHuman = actorContext.actorKind === "human" && actorContext.active;
  const filter = query.filter ?? {};
  const archiveState = filter.archiveState ?? "unarchived";
  const limit = clampLimit(query.limit);
  const sig = filterSignature(filter);

  // Decode + validate cursor BEFORE opening the snapshot transaction.
  let cursorPayload: CursorPayload | null = null;
  if (query.cursor) {
    cursorPayload = decodeCursor(query.cursor);
    if (cursorPayload.f !== sig) {
      throw new Error("invalid_cursor: cursor filter binding mismatch");
    }
  }

  // Single read snapshot: all constituent queries run inside one transaction.
  db.exec("BEGIN");
  try {
    const where: string[] = [];
    const params: (string | number | null)[] = [];
    where.push("workspace_id = ?"); params.push(workspaceId);
    if (filter.kind) { where.push("project_kind = ?"); params.push(filter.kind); }
    if (filter.status) { where.push("project_status = ?"); params.push(filter.status); }
    if (archiveState === "archived") { where.push("archived_at IS NOT NULL"); }
    else if (archiveState === "unarchived") { where.push("archived_at IS NULL"); }

    if (cursorPayload) {
      where.push("(updated_at < ? OR (updated_at = ? AND analysis_project_id < ?))");
      params.push(cursorPayload.u, cursorPayload.u, cursorPayload.p);
    }

    const whereSql = where.length > 0 ? `WHERE ${where.join(" AND ")}` : "";
    const rows = db.prepare(
      `SELECT ${PROJECT_SELECT} FROM analysis_projects ${whereSql} ORDER BY updated_at DESC, analysis_project_id DESC LIMIT ?`,
    ).all(...params, limit + 1) as unknown as Array<Parameters<typeof rowToProject>[0]>;

    const hasMore = rows.length > limit;
    const pageRows = hasMore ? rows.slice(0, limit) : rows;
    const items: ProjectListItem[] = pageRows.map((r) => {
      const p = rowToProject(r);
      const stage = deriveProjectStage(db, workspaceId, p.analysisProjectId);
      const pendingGate = derivePendingGate(db, workspaceId, p.analysisProjectId);
      const latestRun = deriveLatestRun(db, workspaceId, p.analysisProjectId);
      const lockedReportId = deriveLockedReportId(db, workspaceId, p.analysisProjectId);
      const active = countActiveRuns(db, workspaceId, p.analysisProjectId) > 0;
      const auditChain = hasEnteredAuditChain(db, workspaceId, p.analysisProjectId);
      const availableCommands = deriveProjectCommands({
        status: p.projectStatus, archived: p.archivedAt !== null, hasActiveRun: active,
        auditChainEntered: auditChain, actorActiveHuman,
      });
      return {
        projectId: p.analysisProjectId, kind: p.projectKind, title: p.title, slug: p.slug, status: p.projectStatus,
        stage, pendingGate,
        latestRun: latestRun ? { runId: latestRun.runId, runOrdinal: latestRun.runOrdinal, currentRunStatus: latestRun.currentRunStatus, currentAnalysisStage: latestRun.currentAnalysisStage } : null,
        lockedReportId, createdAt: p.createdAt, updatedAt: p.updatedAt, archivedAt: p.archivedAt, availableCommands,
      };
    });

    let nextCursor: string | null = null;
    if (hasMore && items.length > 0) {
      const last = items[items.length - 1]!;
      nextCursor = encodeCursor({ u: last.updatedAt, p: last.projectId, f: sig });
    }

    db.exec("COMMIT");
    return {
      readModelVersion: READ_MODEL_VERSION,
      generatedAt: new Date().toISOString(),
      data: { items, nextCursor, hasMore, limit },
    };
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
}
