/**
 * Analysis Projects runtime composition factory.
 *
 * Creates and wires all dependencies for the Analysis Projects module:
 * - Opens SQLite database
 * - Runs forward-only migrations
 * - Bootstraps stable system + local human actors
 * - Recovers orphan idempotency records
 * - Creates Express router with all handlers
 * - Returns runtime handle with idempotent close()
 *
 * No import-time side effects. Engine defaults to unavailable.
 */
import { DatabaseSync } from "node:sqlite";
import { initDataRoot, resolveDataRoot, type DataRootLayout } from "../persistence/data-root.ts";
import { openDatabase } from "../persistence/db.ts";
import { runMigrations, loadMigrations } from "../persistence/migration-runner.ts";
import { recoverOrphans } from "../application/idempotency/idempotency-service.ts";
import { bootstrapSystemActor, setupLocalHuman, getHumanActor } from "../application/actors/actor-service.ts";
import type { TrustedActorContext } from "../application/shared/runtime.ts";
import type { WorkspaceExistencePort } from "../contracts/workspace-port.ts";
import type { AgentHarnessCapabilityRegistry } from "../contracts/agentharness-port.ts";
import { createAnalysisProjectsServer, getServerAddress, closeServer } from "../routes/http-server.ts";
import { createRoutes, type EngineHandler } from "../routes/routes.ts";
import { createAnalysisProjectsExpressRouter } from "../routes/express-router.ts";
import { RunCoordinator } from "../application/runs/run-coordinator.ts";
import { RunDispatcher } from "../application/runs/run-dispatcher.ts";
import type { Route } from "../routes/router.ts";
import type { Server } from "node:http";
import type { Router } from "express";

/** Fixed actor key for the stable local human actor. */
const LOCAL_HUMAN_ACTOR_KEY = "pi-xanthil-local-human";
const LOCAL_HUMAN_DISPLAY_NAME = "Local Human";
/** Stable UUID v4 for idempotent local human bootstrap. */
const LOCAL_HUMAN_IDEMPOTENCY_KEY = "a1b2c3d4-e5f6-4890-8bcd-ef1234567890";

export interface AnalysisProjectsRuntimeOptions {
  /** Absolute path to the XANTHIL_DATA_DIR (not the analysis-projects subdirectory). */
  readonly dataRoot: string;
  /** Workspace existence port for validating workspace IDs. */
  readonly workspacePort: WorkspaceExistencePort;
  /** Engine handler for requirement/plan generation. Defaults to null (unavailable). */
  readonly engineHandler?: EngineHandler | null;
  /** AgentHarness capability registry (WCA-07). Defaults to null: genuinely empty registry. */
  readonly agentHarnessRegistry?: AgentHarnessCapabilityRegistry | null;
  /** Deadline passed to Engine run requests. Defaults to 30 seconds. */
  readonly engineDeadlineMs?: number;
  /** HTTP server host. Defaults to "127.0.0.1". */
  readonly host?: string;
  /** HTTP server port. Defaults to 0 (ephemeral). */
  readonly port?: number;
  /** Whether the server uses HTTPS. Defaults to false. */
  readonly secure?: boolean;
}

export interface AnalysisProjectsRuntimeHandle {
  /** The Express routes (for mounting on an existing server). */
  readonly routes: readonly Route[];
  /** Express Router for mounting via app.use(). Handles workspace validation and idempotency namespacing. */
  readonly expressRouter: Router;
  /** The underlying HTTP server (if created). */
  readonly server: Server | null;
  /** The database connection. */
  readonly db: DatabaseSync;
  /** The data root layout. */
  readonly layout: DataRootLayout;
  /** The stable local human actor context. */
  readonly actorContext: TrustedActorContext;
  /** The server address (host + port). */
  readonly address: { host: string; port: number } | null;
  /** Idempotent close: stops server, closes DB. Multiple calls are safe. */
  readonly close: () => Promise<void>;
}

/**
 * Create and wire the Analysis Projects runtime.
 *
 * This is the only entry point for creating the runtime. No import-time side effects.
 * Engine defaults to unavailable; pass engineHandler to enable requirement/plan generation.
 *
 * If initialization fails after the DB is opened, the DB handle is cleaned up in finally.
 */
export async function createAnalysisProjectsRuntime(
  options: AnalysisProjectsRuntimeOptions,
): Promise<AnalysisProjectsRuntimeHandle> {
  const { dataRoot, workspacePort, engineHandler = null, agentHarnessRegistry = null, engineDeadlineMs, host, port, secure } = options;

  // 1. Resolve analysis-projects subdirectory and initialize data root
  // WCA-01: dataRoot is XANTHIL_DATA_DIR; analysis-projects is a subdirectory
  const analysisProjectsRoot = resolveDataRoot(dataRoot);
  const layout = initDataRoot(analysisProjectsRoot);
  const db = openDatabase(layout.sqlitePath);
  let runDispatcher: RunDispatcher | null = null;

  try {
    // 2. Run forward-only migrations
    const migrationsDir = new URL("../persistence/migrations", import.meta.url).pathname;
    const migrations = loadMigrations(migrationsDir);
    await runMigrations(db, migrations, layout);

    // 3. Bootstrap stable system actor
    const systemActor = bootstrapSystemActor(db);

    // 4. Bootstrap or reuse stable local human actor
    let humanActor = getHumanActor(db);
    if (!humanActor) {
      const systemCtx: TrustedActorContext = {
        actorId: systemActor.auditActorId,
        actorKind: "system",
        submittedVia: "local_api",
        clientVersion: null,
        active: true,
      };
      const result = setupLocalHuman({
        db,
        actorContext: systemCtx,
        idempotencyKey: LOCAL_HUMAN_IDEMPOTENCY_KEY,
        body: { displayName: LOCAL_HUMAN_DISPLAY_NAME, actorKey: LOCAL_HUMAN_ACTOR_KEY },
      });
      if (result.kind !== "executed") {
        throw new Error(`Failed to bootstrap local human actor: ${result.kind}`);
      }
      humanActor = getHumanActor(db)!;
    }

    const actorContext: TrustedActorContext = {
      actorId: humanActor.auditActorId,
      actorKind: "human",
      submittedVia: "local_api",
      clientVersion: null,
      active: true,
    };

    // 5. Recover orphan idempotency records
    recoverOrphans(db);

    // 6. Create routes, Engine run orchestration, Express router, and server
    const runCoordinator = engineHandler
      ? new RunCoordinator({ db, layout, engineHandler, defaultDeadlineMs: engineDeadlineMs })
      : null;
    runDispatcher = runCoordinator
      ? new RunDispatcher({ db, layout, coordinator: runCoordinator })
      : null;
    const routes = createRoutes(engineHandler, runCoordinator, runDispatcher, agentHarnessRegistry);
    const expressRouter = createAnalysisProjectsExpressRouter(
      { db, layout, actorContext, workspacePort },
      routes,
    );
    let server: Server | null = null;
    let address: { host: string; port: number } | null = null;

    // Only create HTTP server if host/port are provided
    if (host !== undefined || port !== undefined) {
      server = await createAnalysisProjectsServer(
        { db, layout, host, port, secure, actorContext, workspacePort },
        routes,
      );
      address = getServerAddress(server);
    }
    runDispatcher?.start();

    // 7. Create idempotent close handle
    let closed = false;
    const close = async () => {
      if (closed) return;
      closed = true;
      if (server) {
        await closeServer(server);
      }
      await runDispatcher?.stopAndDrain();
      try {
        db.close();
      } catch {
        // Already closed
      }
    };

    return {
      routes,
      expressRouter,
      server,
      db,
      layout,
      actorContext,
      address,
      close,
    };
  } catch (err) {
    // If initialization fails after DB is opened, clean up the handle
    await runDispatcher?.stopAndDrain();
    try {
      db.close();
    } catch {
      // Best-effort cleanup
    }
    throw err;
  }
}
