/**
 * Authorized Evidence content reader.
 *
 * Contract (API-026, API-044):
 * - Only same-project, active human, user_visible/review_only Evidence.
 * - Verify blob hash before streaming.
 * - restricted_raw only as attachment; controlled/derived safe media may inline.
 * - No Range, no directory traversal, no storageRef leakage.
 */
import type { DatabaseSync } from "node:sqlite";
import { ApplicationError } from "../../contracts/envelope.ts";
import { readBlob, verifyBlob } from "../../persistence/blob-writer.ts";
import { sha256HexBytes } from "../../persistence/sha256.ts";
import type { DataRootLayout } from "../../persistence/data-root.ts";
import type { TrustedActorContext } from "../shared/runtime.ts";

export interface EvidenceContentResult {
  readonly body: Uint8Array;
  readonly mediaType: string;
  readonly contentSha256: string;
  readonly inlineDisposition: boolean;
  readonly filename: string;
}

export function readEvidenceContent(
  db: DatabaseSync,
  layout: DataRootLayout,
  workspaceId: string,
  projectId: string,
  evidenceArtifactId: string,
  actorContext: TrustedActorContext,
): EvidenceContentResult {
  if (actorContext.actorKind !== "human" || !actorContext.active) {
    throw new ApplicationError("evidence_access_denied", "Only an active human actor may read evidence content.");
  }
  const row = db.prepare(`SELECT
    evidence_artifact_id, analysis_project_id, content_sha256, media_type, byte_size,
    safety_class, visibility, display_name, storage_ref
    FROM evidence_artifacts WHERE evidence_artifact_id = ? AND analysis_project_id = ? AND analysis_project_id IN (SELECT analysis_project_id FROM analysis_projects WHERE workspace_id = ?)`).get(evidenceArtifactId, projectId, workspaceId) as
    | {
        evidence_artifact_id: string;
        analysis_project_id: string;
        content_sha256: string;
        media_type: string;
        byte_size: number;
        safety_class: string;
        visibility: string;
        display_name: string;
        storage_ref: string;
      }
    | undefined;
  if (!row) {
    throw new ApplicationError("resource_not_found", "Evidence not found.");
  }
  if (row.analysis_project_id !== projectId) {
    throw new ApplicationError("resource_not_found", "Evidence not found.");
  }
  if (row.visibility === "system_only") {
    throw new ApplicationError("evidence_access_denied", "System-only evidence is not readable via content endpoint.");
  }
  if (row.visibility !== "user_visible" && row.visibility !== "review_only") {
    throw new ApplicationError("evidence_access_denied", "Evidence visibility does not allow content access.");
  }
  if (!verifyBlob(layout.blobsDir, row.storage_ref, row.content_sha256)) {
    throw new ApplicationError("evidence_integrity_failed", "Evidence content hash does not match metadata.");
  }
  const body = readBlob(layout.blobsDir, row.storage_ref);
  const actualHash = sha256HexBytes(body);
  if (actualHash !== row.content_sha256) {
    throw new ApplicationError("evidence_integrity_failed", "Evidence content hash verification failed on read.");
  }
  const inlineDisposition = row.safety_class !== "restricted_raw" && isSafeInlineMedia(row.media_type);
  return {
    body,
    mediaType: row.media_type,
    contentSha256: row.content_sha256,
    inlineDisposition,
    filename: sanitizeFilename(row.display_name),
  };
}

function isSafeInlineMedia(mediaType: string): boolean {
  const type = mediaType.toLowerCase();
  return type.startsWith("text/")
    || type === "application/json"
    || type.startsWith("image/")
    || type.startsWith("audio/")
    || type.startsWith("video/");
}

function sanitizeFilename(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 120) || "evidence";
}
