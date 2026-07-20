/**
 * Command execution status handler.
 *
 * Contract (API-055): GET /workspaces/:workspaceId/command-executions/{idempotencyRecordId}
 *
 * FAIL-CLOSED for Sequence 3: The idempotency record schema does not include workspace_id.
 * The handler cannot verifiably prove that the requested record belongs to the workspace
 * in the URL path. A record created in workspace A could be accessed through workspace B
 * by guessing/knowing the record ID.
 *
 * Until the schema is extended with workspace_id (or another verifiable ownership mechanism),
 * this endpoint returns 404 for all requests to prevent cross-workspace data leakage.
 */
import type { RequestContext } from "../router.ts";
import { ApplicationError } from "../../contracts/envelope.ts";

export async function handleCommandExecution(_ctx: RequestContext): Promise<void> {
  // Fail-closed: cannot verify workspace ownership without workspace_id in schema
  throw new ApplicationError("resource_not_found", "Command execution status is not available in this version.");
}
