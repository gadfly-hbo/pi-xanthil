/**
 * Analysis Projects HTTP server (pi-Xanthil).
 *
 * Loopback-only HTTP server composition.
 * - Only binds to 127.0.0.1 / ::1 (loopback).
 * - Routes under /api/analysis-projects/v1/workspaces/:workspaceId/...
 * - Stable local human actor injected by runtime (no auth/token/cookie).
 * - Workspace identity from route path, not headers/cookies.
 * - Workspace existence validated at HTTP boundary for all workspace-scoped routes.
 * - Idempotency keys validated as UUID v4 then namespaced by workspaceId at adapter boundary.
 */
import { createServer, type Server } from "node:http";
import type { DatabaseSync } from "node:sqlite";
import type { DataRootLayout } from "../persistence/data-root.ts";
import type { TrustedActorContext } from "../application/shared/runtime.ts";
import type { WorkspaceExistencePort } from "../contracts/workspace-port.ts";
import { isUuidV4 } from "../application/shared/runtime.ts";
import { generateRequestId, sendJson, errorEnvelope } from "./envelope.ts";
import { createRouter, type RequestContext, type Route } from "./router.ts";
import { namespaceIdempotencyKey } from "./express-router.ts";
import { normalizePath } from "../application/shared/runtime.ts";

export { createRouter, type RequestContext, type Route };

export interface ServerConfig {
  readonly db: DatabaseSync;
  readonly layout: DataRootLayout;
  readonly host?: string;
  readonly port?: number;
  /** Whether the base URL is HTTPS. */
  readonly secure?: boolean;
  /** Stable local human actor context injected by runtime. */
  readonly actorContext: TrustedActorContext;
  /** Workspace existence port for validation. */
  readonly workspacePort: WorkspaceExistencePort;
}

export function createAnalysisProjectsServer(config: ServerConfig, routes: readonly Route[]): Promise<Server> {
  const { db, layout, secure = false, actorContext, workspacePort } = config;
  const router = createRouter(routes);
  const host = config.host ?? "127.0.0.1";
  const port = config.port ?? 0;
  if (!isLoopbackListenAddress(host)) {
    throw new Error(`Server host must be a loopback address; got "${host}"`);
  }

  return new Promise((resolve, reject) => {
    const server = createServer(async (req, res) => {
      const requestId = generateRequestId();
      try {
        // Reject non-loopback hosts at the transport boundary.
        const remote = req.socket.remoteAddress ?? "";
        if (!isLoopback(remote)) {
          sendJson(res, 403, errorEnvelope(requestId, "origin_forbidden", "Only loopback connections are allowed."), { requestId });
          return;
        }
        const url = new URL(req.url ?? "/", "http://localhost");
        const normalizedPath = normalizePath(url.pathname);

        // Extract workspaceId from /api/analysis-projects/v1/workspaces/:workspaceId/...
        const wsMatch = normalizedPath.match(/^\/api\/analysis-projects\/v1\/workspaces\/([^/]+)(\/.*)?$/);
        let workspaceId = "";

        if (wsMatch) {
          workspaceId = wsMatch[1] ?? "";

          // Validate workspace existence at HTTP boundary (catch throws for fail-closed)
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

        const headers: Record<string, string | string[] | undefined> = {};
        for (const [k, v] of Object.entries(req.headers)) headers[k] = v;

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

        await router({ req, res, requestId, db, layout, workspaceId, workspacePort, actorContext, headers, secure } as Parameters<ReturnType<typeof createRouter>>[0]);
      } catch (err) {
        sendJson(res, 500, errorEnvelope(requestId, "internal_error", "An internal error occurred."), { requestId });
      }
    });

    server.listen(port, host);
    server.once("listening", () => resolve(server));
    server.once("error", reject);
  });
}

function isLoopback(addr: string): boolean {
  return addr === "127.0.0.1" || addr === "::1" || addr === "::ffff:127.0.0.1" || addr === "localhost";
}

function isLoopbackListenAddress(host: string): boolean {
  return host === "127.0.0.1" || host === "::1" || host === "localhost";
}

export function getServerAddress(server: Server): { host: string; port: number } {
  const addr = server.address();
  if (addr && typeof addr === "object") {
    return { host: addr.address, port: addr.port };
  }
  throw new Error("Server address is not available");
}

export function closeServer(server: Server): Promise<void> {
  return new Promise((resolve) => server.close(() => resolve()));
}
