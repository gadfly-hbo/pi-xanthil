/**
 * Read-only Workspace existence port against pi-Xanthil's main xanthil.db.
 *
 * Contract (T0014 brief requirement 5, WCA-02, contracts/workspace-port.ts):
 * - The importer never guesses a Workspace from source data, paths, or
 *   defaults; the caller passes an existing Workspace ID and this port only
 *   verifies existence.
 * - The main database is opened READ-ONLY per check. The importer never
 *   modifies xanthil.db and never imports server/src/db.ts; the only
 *   coupling is the workspaces(id) primary-key lookup, mirroring the
 *   workspace-port contract comment ("checks against pi-Xanthil's
 *   xanthil.db"). Fail closed on any error.
 */
import type { DatabaseSync } from "node:sqlite";
import { openDatabase } from "../persistence/db.ts";
import type { WorkspaceExistencePort } from "../contracts/workspace-port.ts";
import { ImportError } from "./errors.ts";

/**
 * Create a WorkspaceExistencePort backed by a read-only xanthil.db.
 *
 * @param xanthilDbPath Absolute path to the pi-Xanthil main database.
 */
export function createXanthilWorkspacePort(xanthilDbPath: string): WorkspaceExistencePort {
  return {
    workspaceExists(workspaceId: string): boolean {
      if (typeof workspaceId !== "string" || workspaceId.trim().length === 0) {
        return false;
      }
      let db: DatabaseSync;
      try {
        db = openDatabase(xanthilDbPath, { readOnly: true });
      } catch {
        throw new ImportError(
          "workspace_check_unavailable",
          "workspace",
          "Workspace database could not be opened read-only.",
        );
      }
      try {
        const row = db
          .prepare("SELECT 1 AS found FROM workspaces WHERE id = ? LIMIT 1")
          .get(workspaceId);
        return row !== undefined;
      } catch {
        throw new ImportError(
          "workspace_check_unavailable",
          "workspace",
          "Workspace existence check failed.",
        );
      } finally {
        try {
          db.close();
        } catch {
          // Already closed.
        }
      }
    },
  };
}
