import {
  ENGINE_PORT_VERSION,
  type EnginePortOperation,
} from "../../contracts/registries.ts";
import {
  type EnginePortRequest,
  type EnginePortResultEnvelope,
  validateEnginePortRequest,
  validateEnginePortResult,
} from "../../contracts/engine-port.ts";
import {
  createAnalysisEngineGenerationHandler,
  type PiGenerationRunner,
} from "./generation.ts";
import {
  createAnalysisEngineExecutionHandler,
  type RunExecutionRunner,
} from "./execution.ts";
import { PiTurnGenerationRunner, PiTurnExecutionRunner } from "./pi-turn-runner.ts";

export type PiEngineHandler = (request: EnginePortRequest) => Promise<EnginePortResultEnvelope>;

export interface PiEngineHandlerOptions {
  readonly generationRunner: PiGenerationRunner;
  readonly executionRunner: RunExecutionRunner;
  readonly now?: () => Date;
  readonly defaultTimeoutMs?: number;
}

export interface ProductionPiEngineHandlerOptions {
  /** Working directory for pi processes; pi sessions live under <workDir>/.pi-sessions. */
  readonly workDir: string;
  readonly model?: string;
  readonly now?: () => Date;
  readonly defaultTimeoutMs?: number;
}

const GENERATION_OPERATIONS: ReadonlySet<EnginePortOperation> = new Set([
  "generateStructuredRequirement",
  "generateAnalysisPlan",
]);

/**
 * Combined Engine handler covering exactly the three application-consumed
 * operations: generateStructuredRequirement, generateAnalysisPlan, and
 * executeQueuedRun. The nine backend-owned operations are never forwarded to
 * pi; they fail closed with a safe invalid_request result.
 */
export function createPiEngineHandler(options: PiEngineHandlerOptions): PiEngineHandler {
  const handleGeneration = createAnalysisEngineGenerationHandler({
    runner: options.generationRunner,
    now: options.now,
    defaultTimeoutMs: options.defaultTimeoutMs,
  });
  const handleExecution = createAnalysisEngineExecutionHandler({
    runner: options.executionRunner,
    now: options.now,
    defaultTimeoutMs: options.defaultTimeoutMs,
  });
  const now = options.now ?? (() => new Date());

  return async function handle(request: EnginePortRequest): Promise<EnginePortResultEnvelope> {
    validateEnginePortRequest(request);
    if (GENERATION_OPERATIONS.has(request.operation)) {
      return handleGeneration(request);
    }
    if (request.operation === "executeQueuedRun") {
      return handleExecution(request);
    }
    const ts = now().toISOString();
    const result: EnginePortResultEnvelope = {
      version: ENGINE_PORT_VERSION,
      operation: request.operation,
      operationId: request.operationId,
      projectId: request.projectId,
      runId: request.runId ?? null,
      startedAt: ts,
      completedAt: ts,
      outcome: "failed",
      error: {
        code: "invalid_request",
        summary: "Operation is backend-owned; the pi engine adapter does not handle it.",
      },
    };
    validateEnginePortResult(result);
    return result;
  };
}

/**
 * Production handler backed by the existing pi runtime (runPiTurn). Sessions
 * and scratch state stay under workDir; no durable IDs, SQLite writes, or blob
 * writes happen here.
 */
export function createProductionPiEngineHandler(options: ProductionPiEngineHandlerOptions): PiEngineHandler {
  return createPiEngineHandler({
    generationRunner: new PiTurnGenerationRunner({ workDir: options.workDir, model: options.model }),
    executionRunner: new PiTurnExecutionRunner({ workDir: options.workDir, model: options.model }),
    now: options.now,
    defaultTimeoutMs: options.defaultTimeoutMs,
  });
}
