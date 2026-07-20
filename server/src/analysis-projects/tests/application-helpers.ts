/**
 * Application test helper: creates temp DB with all migrations,
 * bootstraps system+human actors, and provides a fake WorkspaceExistencePort.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { initDataRoot, type DataRootLayout } from "../persistence/data-root.ts";
import { openDatabase, type OpenDatabaseOptions } from "../persistence/db.ts";
import { runMigrations, loadMigrations } from "../persistence/migration-runner.ts";
import type { DatabaseSync } from "node:sqlite";
import { bootstrapSystemActor, setupLocalHuman, getHumanActor, getSystemActor } from "../application/actors/actor-service.ts";
import type { TrustedActorContext } from "../application/shared/runtime.ts";
import type { WorkspaceExistencePort } from "../contracts/workspace-port.ts";

/** A test workspace ID (valid UUID v4 format). */
export const TEST_WORKSPACE_ID = "00000000-0000-4000-8000-000000000001";

/** A second test workspace ID for cross-workspace isolation tests. */
export const TEST_WORKSPACE_ID_2 = "00000000-0000-4000-8000-000000000002";

/**
 * Fake WorkspaceExistencePort for testing.
 * Returns true for known workspace IDs, false for unknown.
 */
export function createFakeWorkspacePort(knownIds: Set<string> = new Set([TEST_WORKSPACE_ID, TEST_WORKSPACE_ID_2])): WorkspaceExistencePort {
  return {
    workspaceExists: (id: string) => knownIds.has(id),
  };
}

export interface ApplicationTestEnv {
  db: DatabaseSync;
  layout: DataRootLayout;
  workspacePort: WorkspaceExistencePort;
  workspaceId: string;
  systemActorId: string;
  systemCtx: TrustedActorContext;
  humanActorId: string;
  humanCtx: TrustedActorContext;
  cleanup: () => void;
}

/**
 * Create a fully bootstrapped test environment:
 * - Temp data root with all migrations (0001-0003)
 * - System actor + local human actor
 * - Fake workspace port with TEST_WORKSPACE_ID
 */
export async function createAppTestEnv(options?: {
  workspaceId?: string;
  dbOptions?: OpenDatabaseOptions;
}): Promise<ApplicationTestEnv> {
  const dir = mkdtempSync(join(tmpdir(), "xanthil-app-test-"));
  const layout = initDataRoot(dir);
  const db = openDatabase(layout.sqlitePath, options?.dbOptions);
  const migrationsDir = join(import.meta.dirname, "..", "persistence", "migrations");
  await runMigrations(db, loadMigrations(migrationsDir), layout);

  // Bootstrap system actor
  const systemActor = bootstrapSystemActor(db);
  const systemActorId = systemActor.auditActorId;
  const systemCtx: TrustedActorContext = {
    actorId: systemActorId,
    actorKind: "system",
    submittedVia: "local_api",
    clientVersion: null,
    active: true,
  };

  // Setup local human actor
  const humanKey = `human-${randomUUID()}`;
  const setupResult = setupLocalHuman({
    db,
    actorContext: systemCtx,
    idempotencyKey: randomUUID(),
    body: { displayName: "Test User", actorKey: humanKey },
  });
  if (setupResult.kind !== "executed") {
    throw new Error(`Failed to setup local human: ${JSON.stringify(setupResult)}`);
  }
  const humanActor = getHumanActor(db)!;
  const humanActorId = humanActor.auditActorId;
  const humanCtx: TrustedActorContext = {
    actorId: humanActorId,
    actorKind: "human",
    submittedVia: "web_ui",
    clientVersion: null,
    active: true,
  };

  const workspaceId = options?.workspaceId ?? TEST_WORKSPACE_ID;
  const workspacePort = createFakeWorkspacePort();

  return {
    db,
    layout,
    workspacePort,
    workspaceId,
    systemActorId,
    systemCtx,
    humanActorId,
    humanCtx,
    cleanup: () => {
      try { db.close(); } catch { /* already closed */ }
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

/**
 * Create a project via the application service with workspace ownership.
 */
export async function makeProject(
  env: ApplicationTestEnv,
  opts: { title?: string; slug?: string } = {},
): Promise<string> {
  const { createProject } = await import("../application/projects/project-service.ts");
  const result = createProject({
    db: env.db,
    workspacePort: env.workspacePort,
    workspaceId: env.workspaceId,
    actorContext: env.humanCtx,
    idempotencyKey: randomUUID(),
    body: {
      title: opts.title ?? "Test Project",
      slug: opts.slug ?? `slug-${randomUUID()}`,
    },
  });
  if (result.kind !== "executed") {
    throw new Error(`Failed to create project: ${JSON.stringify(result)}`);
  }
  return result.resultResourceId;
}

/**
 * Compatibility wrapper: creates a migrated DB with actors and workspace setup.
 * Returns the same shape as the old createMigratedDb plus workspace properties.
 * Test files can destructure what they need: { db, cleanup, workspaceId, workspacePort, humanCtx, ... }
 */
export async function createMigratedDb(options?: {
  migrations?: "all" | "0001-only";
  dbOptions?: OpenDatabaseOptions;
}): Promise<ApplicationTestEnv> {
  return createAppTestEnv(options);
}
