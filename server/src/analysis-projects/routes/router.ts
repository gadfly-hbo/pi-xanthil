/**
 * Minimal typed HTTP router for the Analysis Projects API (pi-Xanthil).
 *
 * Routes are matched in declaration order. Unknown path/method combinations fail
 * closed with 404. No auth/session/token - stable local human actor injected by runtime.
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import type { DatabaseSync } from "node:sqlite";
import type { DataRootLayout } from "../persistence/data-root.ts";
import type { TrustedActorContext } from "../application/shared/runtime.ts";
import type { WorkspaceExistencePort } from "../contracts/workspace-port.ts";

import { sendJson, sendError, errorEnvelope } from "./envelope.ts";
import { ApplicationError } from "../contracts/envelope.ts";
import { BodyValidationError } from "./body.ts";

export interface RequestContext {
  readonly req: IncomingMessage;
  readonly res: ServerResponse;
  readonly method: string;
  readonly normalizedPath: string;
  readonly pathParams: Record<string, string>;
  readonly queryParams: Record<string, string>;
  readonly requestId: string;
  readonly db: DatabaseSync;
  readonly layout: DataRootLayout;
  readonly workspaceId: string;
  readonly workspacePort: WorkspaceExistencePort;
  readonly actorContext: TrustedActorContext;
  readonly headers: Record<string, string | string[] | undefined>;
  /** Whether the server is configured for HTTPS; used for scheme/port validation. */
  readonly secure: boolean;
}

export interface Route {
  readonly method: string;
  readonly pattern: RegExp;
  readonly paramNames: readonly string[];
  readonly handler: (ctx: RequestContext) => Promise<void> | void;
}

export function createRouter(routes: readonly Route[]): (ctx: Omit<RequestContext, "pathParams" | "queryParams" | "normalizedPath">) => Promise<void> {
  return async (ctx) => {
    const { req, res, requestId } = ctx;
    const method = (req.method ?? "GET").toUpperCase();
    const url = new URL(req.url ?? "/", "http://localhost");
    const normalizedPath = url.pathname;
    const queryParams = Object.fromEntries(url.searchParams.entries());

    for (const route of routes) {
      if (route.method !== method) continue;
      const match = route.pattern.exec(normalizedPath);
      if (!match) continue;
      const pathParams: Record<string, string> = {};
      for (let i = 0; i < route.paramNames.length; i++) {
        pathParams[route.paramNames[i]!] = decodeURIComponent(match[i + 1] ?? "");
      }
      try {
        await route.handler({ ...ctx, method, normalizedPath, pathParams, queryParams });
      } catch (err) {
        if (err instanceof ApplicationError || err instanceof BodyValidationError) {
          sendError(res, requestId, err);
        } else {
          sendJson(res, 500, errorEnvelope(requestId, "internal_error", "An internal error occurred."), { requestId });
        }
      }
      return;
    }

    sendJson(res, 404, errorEnvelope(requestId, "resource_not_found", "Route not found."), { requestId });
  };
}

export function route(path: string, handler: Route["handler"], options?: { authRequired?: boolean; systemOnly?: boolean }): Route {
  // Convert path pattern with {param} placeholders to a regex.
  const paramNames: string[] = [];
  let regexSource = "^";
  let i = 0;
  while (i < path.length) {
    if (path[i] === "{") {
      const end = path.indexOf("}", i);
      if (end < 0) throw new Error(`Unclosed route parameter: ${path}`);
      const name = path.slice(i + 1, end);
      paramNames.push(name);
      regexSource += "([^/]+)";
      i = end + 1;
    } else {
      regexSource += escapeRegex(path[i]!);
      i++;
    }
  }
  regexSource += "$";
  return {
    method: "GET", // placeholder; method set per registration below
    pattern: new RegExp(regexSource),
    paramNames,
    handler,
    ...options,
  };
}

export function withMethod(routeDef: Route, method: string): Route {
  return { ...routeDef, method: method.toUpperCase() };
}

function escapeRegex(c: string): string {
  const specials = /[\\^$.*+?()[\]{}|]/;
  return specials.test(c) ? "\\" + c : c;
}

// Helper to build a route with method in one call.
export function methodRoute(method: string, path: string, handler: Route["handler"], options?: { authRequired?: boolean; systemOnly?: boolean }): Route {
  return { ...route(path, handler, options), method: method.toUpperCase() };
}

// Convenience exports for route construction.
export const GET = (path: string, handler: Route["handler"], options?: { authRequired?: boolean; systemOnly?: boolean }): Route => methodRoute("GET", path, handler, options);
export const POST = (path: string, handler: Route["handler"], options?: { authRequired?: boolean; systemOnly?: boolean }): Route => methodRoute("POST", path, handler, options);
export const PATCH = (path: string, handler: Route["handler"], options?: { authRequired?: boolean; systemOnly?: boolean }): Route => methodRoute("PATCH", path, handler, options);
export const DELETE = (path: string, handler: Route["handler"], options?: { authRequired?: boolean; systemOnly?: boolean }): Route => methodRoute("DELETE", path, handler, options);
