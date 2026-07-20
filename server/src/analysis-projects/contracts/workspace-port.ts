/**
 * Workspace existence port.
 *
 * Contract (workcanger-absorption-contract.md WCA-02):
 * - Every Analysis Project must belong to a pi-Xanthil Workspace.
 * - The application layer must not import server/src/db.ts or directly read xanthil.db.
 * - Workspace existence is validated via this narrow port, injected by the
 *   pi-Xanthil runtime (sequence 3 Express routes assembly).
 * - Tests use an explicit fake port (see tests/application-helpers.ts).
 *
 * This port is intentionally minimal: it only checks existence. It does not
 * expose workspace metadata, membership, or permissions - those concerns stay
 * in pi-Xanthil's core domain.
 */

/**
 * Narrow port for validating Workspace existence.
 * The runtime implementation checks against pi-Xanthil's xanthil.db.
 * Test implementations return canned results.
 */
export interface WorkspaceExistencePort {
  /**
   * Returns true if a Workspace with the given ID exists.
   * Must fail closed (return false) for unknown or blank IDs.
   */
  workspaceExists(workspaceId: string): boolean;
}

/**
 * Error thrown when a Workspace does not exist.
 * Application services throw this when workspaceExists returns false.
 */
export class WorkspaceNotFoundError extends Error {
  constructor(workspaceId: string) {
    super(`Workspace not found: ${workspaceId}`);
    this.name = "WorkspaceNotFoundError";
  }
}

/**
 * Assert that a Workspace exists, throwing WorkspaceNotFoundError if not.
 */
export function assertWorkspaceExists(
  port: WorkspaceExistencePort,
  workspaceId: string,
): void {
  if (!port.workspaceExists(workspaceId)) {
    throw new WorkspaceNotFoundError(workspaceId);
  }
}
