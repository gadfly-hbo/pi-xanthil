/**
 * Queued Run auto-dispatcher (T0012).
 *
 * Discovers eligible queued Runs and dispatches them via RunCoordinator.executeRun.
 * Designed for Backend runtime integration: startup scan + periodic polling + event-driven wakeup.
 *
 * Safety:
 * - In-memory Set prevents concurrent execution of the same Run.
 * - DB-level claim in RunCoordinator.executeRun provides the authoritative guard.
 * - Errors in individual Run execution are caught and logged; the dispatcher continues.
 * - Graceful shutdown stops new claims; running executions complete naturally.
 * - WORKCANGER_ENGINE_MODE=unavailable does NOT mount the dispatcher.
 */
import type { DatabaseSync } from "node:sqlite";
import type { DataRootLayout } from "../../persistence/data-root.ts";
import { RunCoordinator, getRunById } from "./run-coordinator.ts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface RunDispatcherOptions {
  readonly db: DatabaseSync;
  /** Optional fixed workspace scope. Omit for the mounted multi-workspace runtime. */
  readonly workspaceId?: string;
  readonly layout: DataRootLayout;
  readonly coordinator: RunCoordinator;
  readonly pollIntervalMs?: number;
  readonly logger?: RunDispatcherLogger;
}

export interface RunDispatcherLogger {
  info(message: string, data?: Record<string, unknown>): void;
  warn(message: string, data?: Record<string, unknown>): void;
  error(message: string, data?: Record<string, unknown>): void;
}

const DEFAULT_POLL_INTERVAL_MS = 2_000;

const DEFAULT_LOGGER: RunDispatcherLogger = {
  info(msg, data) { console.log(JSON.stringify({ level: "info", msg, ...data })); },
  warn(msg, data) { console.warn(JSON.stringify({ level: "warn", msg, ...data })); },
  error(msg, data) { console.error(JSON.stringify({ level: "error", msg, ...data })); },
};

// ---------------------------------------------------------------------------
// RunDispatcher
// ---------------------------------------------------------------------------

export class RunDispatcher {
  private readonly db: DatabaseSync;
  private readonly workspaceId: string | undefined;
  private readonly coordinator: RunCoordinator;
  private readonly pollIntervalMs: number;
  private readonly logger: RunDispatcherLogger;
  private readonly running = new Set<string>();
  private readonly inFlight = new Set<Promise<void>>();
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private stopped = false;

  constructor(options: RunDispatcherOptions) {
    this.db = options.db;
    this.workspaceId = options.workspaceId;
    this.coordinator = options.coordinator;
    this.pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
    this.logger = options.logger ?? DEFAULT_LOGGER;
  }

  /**
   * Start the dispatcher: initial scan + periodic polling.
   * Idempotent — calling start() on an already-started dispatcher is a no-op.
   */
  start(): void {
    if (this.pollTimer !== null) return;
    this.stopped = false;
    this.logger.info("RunDispatcher started", { pollIntervalMs: this.pollIntervalMs });
    // Initial scan: pick up any historical queued Runs
    this.scanAndDispatch(this.workspaceId).catch((err) => {
      this.logger.error("Initial scan failed", { error: String(err) });
    });
    this.pollTimer = setInterval(() => {
      this.scanAndDispatch(this.workspaceId).catch((err) => {
        this.logger.error("Poll scan failed", { error: String(err) });
      });
    }, this.pollIntervalMs);
  }

  /**
   * Stop the dispatcher: cancel periodic polling.
   * Running executions complete naturally (no abort).
   */
  stop(): void {
    this.stopped = true;
    if (this.pollTimer !== null) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    this.logger.info("RunDispatcher stopped", { pendingRuns: this.running.size });
  }

  /** Stop new scans and wait until every already-dispatched Run settles. */
  async stopAndDrain(): Promise<void> {
    this.stop();
    await Promise.allSettled([...this.inFlight]);
  }

  /**
   * Wake the dispatcher to scan immediately (e.g., after a new queued Run is created).
   * Non-blocking; the scan runs asynchronously.
   */
  wakeup(workspaceId: string | undefined = this.workspaceId): void {
    if (this.stopped) return;
    this.scanAndDispatch(workspaceId).catch((err) => {
      this.logger.error("Wakeup scan failed", { error: String(err) });
    });
  }

  /**
   * One-shot scan: find all eligible queued Runs and dispatch each.
   * Exposed for unit testing and smoke verification.
   * Returns the number of Runs dispatched.
   */
  async dispatchQueuedRunsOnce(workspaceId: string | undefined = this.workspaceId): Promise<number> {
    return this.scanAndDispatch(workspaceId);
  }

  /**
   * Number of currently in-flight executions.
   */
  get activeCount(): number {
    return this.running.size;
  }

  // -------------------------------------------------------------------------
  // Private
  // -------------------------------------------------------------------------

  private async scanAndDispatch(workspaceId?: string): Promise<number> {
    if (this.stopped) return 0;

    // Find queued runs globally or for one requested workspace.
    const workspaceClause = workspaceId === undefined ? "" : " AND p.workspace_id = ?";
    const statement = this.db.prepare(
      `SELECT r.analysis_run_id, p.workspace_id FROM analysis_runs r
       JOIN analysis_projects p ON r.analysis_project_id = p.analysis_project_id
       WHERE r.current_run_status = 'queued'${workspaceClause}
       ORDER BY r.queued_at ASC, r.analysis_run_id ASC`,
    );
    const rows = (workspaceId === undefined ? statement.all() : statement.all(workspaceId)) as Array<{
      analysis_run_id: string;
      workspace_id: string;
    }>;

    let dispatched = 0;
    for (const row of rows) {
      const runId = row.analysis_run_id;
      // Skip if already being processed (in-memory guard)
      if (this.running.has(runId)) continue;
      // Skip if no longer queued (DB may have changed between scan and dispatch)
      const run = getRunById(this.db, row.workspace_id, runId);
      if (!run || run.currentRunStatus !== "queued") continue;

      // Fire-and-forget dispatch; errors are caught per-Run
      this.dispatchRun(runId, row.workspace_id);
      dispatched++;
    }
    return dispatched;
  }

  private dispatchRun(runId: string, workspaceId: string): void {
    this.running.add(runId);
    const execution = this.coordinator.executeRun(runId, workspaceId).then((result) => {
      if (result.kind === "succeeded") {
        this.logger.info("RunDispatcher: run succeeded", { runId, reportVersionId: result.reportVersionId });
      } else if (result.kind === "failed") {
        this.logger.warn("RunDispatcher: run failed", { runId, errorCode: result.errorCode });
      } else if (result.kind === "aborted") {
        this.logger.info("RunDispatcher: run aborted", { runId });
      } else if (result.kind === "blocked") {
        this.logger.warn("RunDispatcher: run blocked", { runId, blockCode: result.blockCode });
      } else {
        // not_found, not_queued, claim_failed — log and continue
        this.logger.warn("RunDispatcher: run not dispatched", { runId, kind: result.kind });
      }
    }).catch((err) => {
      this.logger.error("RunDispatcher: unexpected error", { runId, error: String(err) });
    }).finally(() => {
      this.running.delete(runId);
      this.inFlight.delete(execution);
    });
    this.inFlight.add(execution);
  }
}
