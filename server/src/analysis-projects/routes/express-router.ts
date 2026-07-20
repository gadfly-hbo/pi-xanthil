/**
 * Express Router factory for Analysis Projects API.
 *
 * Creates a standard Express Router that can be mounted via app.use().
 * Handles workspace extraction, workspace existence validation,
 * and idempotency key namespacing by workspaceId.
 *
 * Mount point: app.use("/api/analysis-projects/v1", router)
 * The router internally reconstructs the full path for route matching.
 */
import { Router, type Request, type Response, type NextFunction } from "express";
import type { DatabaseSync } from "node:sqlite";
import type { DataRootLayout } from "../persistence/data-root.ts";
import type { TrustedActorContext } from "../application/shared/runtime.ts";
import type { WorkspaceExistencePort } from "../contracts/workspace-port.ts";
import { createHash } from "node:crypto";
import { isUuidV4 } from "../application/shared/runtime.ts";
import { generateRequestId, sendJson, errorEnvelope } from "./envelope.ts";
import { createRouter, type RequestContext, type Route } from "./router.ts";

export interface AnalysisProjectsRouterOptions {
  readonly db: DatabaseSync;
  readonly layout: DataRootLayout;
  readonly actorContext: TrustedActorContext;
  readonly workspacePort: WorkspaceExistencePort;
}

/**
 * Transform an idempotency key to include workspaceId in the scope.
 * This prevents cross-workspace replay of the same key+body combination.
 * Uses deterministic transformation: SHA-256(workspaceId:key) -> valid UUID v4.
 *
 * Caller MUST validate the original key as UUID v4 before calling this function.
 */
export function namespaceIdempotencyKey(workspaceId: string, key: string): string {
  const hash = createHash("sha256").update(`${workspaceId}:${key}`).digest("hex");
  // Format as UUID v4: 8-4-4-4-12 with version=4 and variant=89ab
  return [
    hash.slice(0, 8),
    hash.slice(8, 12),
    "4" + hash.slice(13, 16), // version 4
    (parseInt(hash.slice(16, 17), 16) & 0x3 | 0x8).toString(16) + hash.slice(17, 20), // variant 89ab
    hash.slice(20, 32),
  ].join("-");
}

/**
 * Create an Express Router for the Analysis Projects API.
 *
 * Mount point: app.use("/api/analysis-projects/v1", router)
 *
 * The router handles:
 * - Workspace-scoped routes under /workspaces/:workspaceId/...
 * - Non-workspace-scoped routes (e.g., /capabilities)
 * - Workspace existence validation for all workspace-scoped routes
 * - Idempotency key namespacing by workspaceId (after UUID v4 validation)
 */
export function createAnalysisProjectsExpressRouter(
  options: AnalysisProjectsRouterOptions,
  routes: readonly Route[],
): Router {
  const { db, layout, actorContext, workspacePort } = options;
  const internalRouter = createRouter(routes);
  const router = Router();

  // Request ID generation
  router.use((req: Request, _res: Response, next: NextFunction) => {
    (req as Request & { requestId: string }).requestId = generateRequestId();
    next();
  });

  // Catch-all handler that delegates to the internal router
  router.all("/*", async (req: Request, res: Response, next: NextFunction) => {
    const requestId = (req as Request & { requestId: string }).requestId;

    try {
      // Express strips the mount prefix from req.url.
      // When mounted at "/api/analysis-projects/v1", req.url is "/workspaces/..."
      // We need to reconstruct the full path for the internal router.
      const mountPath = req.baseUrl || "";
      const relativeUrl = req.url || "/";
      const fullPath = mountPath + relativeUrl;
      const url = new URL(fullPath, "http://localhost");
      const normalizedPath = url.pathname;

      // Extract workspaceId from path
      const wsMatch = normalizedPath.match(/^\/api\/analysis-projects\/v1\/workspaces\/([^/]+)(\/.*)?$/);
      let workspaceId = "";

      if (wsMatch) {
        workspaceId = wsMatch[1] ?? "";

        // Validate workspace existence at HTTP boundary
        // Catch throws from workspacePort for fail-closed behavior
        let workspaceExists = false;
        try {
          workspaceExists = workspacePort.workspaceExists(workspaceId);
        } catch {
          workspaceExists = false;
        }
        if (!workspaceId || !workspaceExists) {
          sendJson(res, 404, errorEnvelope(requestId, "resource_not_found", "Workspace not found."), { requestId });
          return;
        }
      }

      // Build headers record
      const headers: Record<string, string | string[] | undefined> = {};
      for (const [k, v] of Object.entries(req.headers)) {
        headers[k] = v;
      }

      // Validate Idempotency-Key as UUID v4 BEFORE namespacing
      if (workspaceId && headers["idempotency-key"]) {
        const originalKey = headers["idempotency-key"] as string;
        if (!isUuidV4(originalKey)) {
          sendJson(res, 400, errorEnvelope(requestId, "validation_failed", "Idempotency-Key must be a UUID v4.", {
            fieldErrors: [{ fieldPath: "/headers/Idempotency-Key", code: "invalid_uuid", summary: "Idempotency-Key must be a UUID v4" }],
          }), { requestId });
          return;
        }
        headers["idempotency-key"] = namespaceIdempotencyKey(workspaceId, originalKey);
      }

      // Delegate to internal router with reconstructed full path
      // Override req.url so the internal router matches against full paths
      const mockReq = req as unknown as import("node:http").IncomingMessage;
      (mockReq as { url?: string }).url = fullPath;

      // When mounted on an Express app with express.json(), the body stream
      // is already consumed. The verify callback in express.json() captures
      // the raw body bytes as __rawBody BEFORE JSON.parse runs. We attach it
      // as __preBufferedBody so readRequestBody returns the raw bytes directly,
      // preserving strict JSON validation (duplicate keys, BOM, etc.).
      const expressReq = req as Request & { __rawBody?: Buffer };
      if (expressReq.__rawBody) {
        (mockReq as { __preBufferedBody?: Buffer }).__preBufferedBody = expressReq.__rawBody;
      }

      await internalRouter({
        req: mockReq,
        res: res as unknown as import("node:http").ServerResponse,
        requestId,
        method: (req.method ?? "GET").toUpperCase(),
        db,
        layout,
        workspaceId,
        workspacePort,
        actorContext,
        headers,
        secure: req.secure,
      });
    } catch (err) {
      // Catch any unhandled errors in the Express async path
      sendJson(res, 500, errorEnvelope(requestId, "internal_error", "An internal error occurred."), { requestId });
    }
  });

  return router;
}
