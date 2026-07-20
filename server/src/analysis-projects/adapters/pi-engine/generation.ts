import {
  ENGINE_PORT_VERSION,
  type EngineErrorCode,
  type EngineOutcome,
} from "../../contracts/registries.ts";
import {
  type EnginePortRequest,
  type EnginePortResultEnvelope,
  validateEnginePortRequest,
  validateEnginePortResult,
} from "../../contracts/engine-port.ts";

export interface PiGenerationRuntimeMetadata {
  readonly producerName: string;
  readonly producerVersion: string;
  readonly mode: "fake" | "pi-agent";
}

export interface PiGenerationRunnerRequest {
  readonly operation: "generateStructuredRequirement" | "generateAnalysisPlan";
  readonly generationId: string;
  readonly targetSchemaVersion: string;
  readonly requirementVersionId?: string;
  readonly inputHash: string;
  readonly instruction: string;
}

export type PiGenerationRunnerResult =
  | {
      readonly outcome: "succeeded";
      readonly stdoutJson: string;
      readonly runtime: PiGenerationRuntimeMetadata;
    }
  | {
      readonly outcome: "spawn_failed";
      readonly safeRuntime?: PiGenerationRuntimeMetadata;
      readonly rawDiagnostic?: string;
    }
  | {
      readonly outcome: "failed";
      readonly exitCode?: number | null;
      readonly signal?: string | null;
      readonly safeRuntime?: PiGenerationRuntimeMetadata;
      readonly rawDiagnostic?: string;
    };

export interface PiGenerationRunnerHandle {
  readonly done: Promise<PiGenerationRunnerResult>;
  /**
   * Terminate the underlying execution. The returned promise (if any) must
   * settle only after termination is confirmed; handlers await it before
   * returning an aborted/timed_out result.
   */
  readonly cancel: () => void | Promise<unknown>;
  readonly isRunning: () => boolean;
}

export interface PiGenerationRunner {
  start(request: PiGenerationRunnerRequest): PiGenerationRunnerHandle;
}

export interface AnalysisEngineGenerationHandlerOptions {
  readonly runner: PiGenerationRunner;
  readonly now?: () => Date;
  readonly defaultTimeoutMs?: number;
}

const GENERATION_OPERATIONS = new Set(["generateStructuredRequirement", "generateAnalysisPlan"]);
const DEFAULT_TIMEOUT_MS = 30_000;
const ABSOLUTE_PATH_RE = /(?:^|\s)(?:\/[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._ -]+)+|[A-Za-z]:\\[^\s]+)/;
const TOKEN_LIKE_RE = /[A-Za-z0-9_-]{40,}/;
const FORBIDDEN_OUTPUT_KEYS = new Set([
  "prompt",
  "hiddenReasoning",
  "rawPiEvent",
  "rawPiEvents",
  "token",
  "accessToken",
  "apiKey",
  "storageRef",
  "absolutePath",
  "path",
  "evidenceContent",
]);

export function createAnalysisEngineGenerationHandler(options: AnalysisEngineGenerationHandlerOptions) {
  const now = options.now ?? (() => new Date());
  const defaultTimeoutMs = options.defaultTimeoutMs ?? DEFAULT_TIMEOUT_MS;

  return async function handleGeneration(request: EnginePortRequest): Promise<EnginePortResultEnvelope> {
    validateEnginePortRequest(request);
    if (!GENERATION_OPERATIONS.has(request.operation)) {
      throw new Error(`Unsupported generation operation: ${request.operation}`);
    }

    const startedAt = now().toISOString();
    if (request.abortSignal?.aborted) {
      return validatedResult(request, startedAt, now().toISOString(), "aborted", undefined, {
        code: "aborted",
        summary: "Generation was aborted before pi-agent execution completed.",
      });
    }
    if (isDeadlineExpired(request.deadlineAt, now())) {
      return validatedResult(request, startedAt, now().toISOString(), "timed_out", undefined, {
        code: "deadline_exceeded",
        summary: "Generation did not complete before its deadline.",
      });
    }

    const runnerRequest = compileRunnerRequest(request);
    let handle: PiGenerationRunnerHandle;
    try {
      handle = options.runner.start(runnerRequest);
    } catch {
      return validatedResult(request, startedAt, now().toISOString(), "failed", undefined, {
        code: "pi_spawn_failed",
        summary: "pi-agent process could not be started.",
      });
    }
    const abortPromise = new Promise<"aborted">((resolve) => {
      request.abortSignal?.addEventListener("abort", () => resolve("aborted"), { once: true });
    });
    const timeoutMs = deadlineTimeoutMs(request.deadlineAt, now(), defaultTimeoutMs);
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const timeoutPromise = new Promise<"timed_out">((resolve) => {
      timeout = setTimeout(() => resolve("timed_out"), timeoutMs);
    });

    try {
      const safeDone = handle.done.catch((): PiGenerationRunnerResult => ({
        outcome: "failed",
        safeRuntime: undefined,
        rawDiagnostic: undefined,
      }));
      const race = await Promise.race([safeDone, abortPromise, timeoutPromise]);
      if (race === "aborted") {
        await handle.cancel();
        return validatedResult(request, startedAt, now().toISOString(), "aborted", undefined, {
          code: "aborted",
          summary: "Generation was aborted before pi-agent execution completed.",
        });
      }
      if (race === "timed_out") {
        await handle.cancel();
        return validatedResult(request, startedAt, now().toISOString(), "timed_out", undefined, {
          code: "deadline_exceeded",
          summary: "Generation did not complete before its deadline.",
        });
      }
      return mapRunnerResult(request, startedAt, now().toISOString(), race);
    } finally {
      if (timeout !== undefined) clearTimeout(timeout);
    }
  };
}

function compileRunnerRequest(request: EnginePortRequest): PiGenerationRunnerRequest {
  if (request.operation === "generateStructuredRequirement") {
    return {
      operation: request.operation,
      generationId: request.generationId ?? "",
      targetSchemaVersion: request.input.targetSchemaVersion,
      inputHash: request.inputHash,
      instruction: "Generate a structured requirement candidate as strict JSON. Do not include prompts, hidden reasoning, raw pi events, paths, tokens, storage refs, or evidence content.",
    };
  }
  if (request.operation === "generateAnalysisPlan") {
    return {
      operation: request.operation,
      generationId: request.generationId ?? "",
      requirementVersionId: request.input.requirementVersionId,
      targetSchemaVersion: request.input.targetSchemaVersion,
      inputHash: request.inputHash,
      instruction: "Generate an analysis plan candidate as strict JSON. Bind the plan to the requirement version and do not include prompts, hidden reasoning, raw pi events, paths, tokens, storage refs, or evidence content.",
    };
  }
  throw new Error(`Unsupported generation operation: ${request.operation}`);
}

function mapRunnerResult(
  request: EnginePortRequest,
  startedAt: string,
  completedAt: string,
  result: PiGenerationRunnerResult,
): EnginePortResultEnvelope {
  if (result.outcome === "spawn_failed") {
    return validatedResult(request, startedAt, completedAt, "failed", undefined, {
      code: "pi_spawn_failed",
      summary: "pi-agent process could not be started.",
    });
  }
  if (result.outcome === "failed") {
    return validatedResult(request, startedAt, completedAt, "failed", undefined, {
      code: "pi_execution_failed",
      summary: "pi-agent execution did not complete successfully.",
    });
  }

  const parsed = parseRunnerJson(result.stdoutJson);
  if (parsed === undefined || !isSafeGenerationOutput(request, parsed, result.runtime)) {
    return validatedResult(request, startedAt, completedAt, "failed", undefined, {
      code: "output_schema_invalid",
      summary: "pi-agent generation output did not match the expected safe candidate schema.",
    });
  }
  return validatedResult(request, startedAt, completedAt, "succeeded", parsed, undefined);
}

function parseRunnerJson(stdoutJson: string): unknown | undefined {
  try {
    return JSON.parse(stdoutJson) as unknown;
  } catch {
    return undefined;
  }
}

function isSafeGenerationOutput(
  request: EnginePortRequest,
  output: unknown,
  runtime: PiGenerationRuntimeMetadata,
): boolean {
  if (!isPlainRecord(output) || !doesNotLeak(output)) return false;
  if (!isSafeProducer(output.producer, runtime)) return false;
  if (!Array.isArray(output.warnings) || !output.warnings.every((warning) => typeof warning === "string")) return false;

  if (request.operation === "generateStructuredRequirement") {
    return onlyKeys(output, ["candidateType", "schemaVersion", "generationId", "producer", "warnings", "candidate"])
      && output.candidateType === "structured_requirement_candidate"
      && output.schemaVersion === request.input.targetSchemaVersion
      && output.generationId === request.generationId
      && isPlainRecord(output.candidate)
      && typeof output.candidate.businessQuestion === "string"
      && isPlainRecord(output.candidate.scope)
      && Array.isArray(output.candidate.acceptanceCriteria);
  }

  if (request.operation === "generateAnalysisPlan") {
    return onlyKeys(output, ["candidateType", "schemaVersion", "generationId", "requirementVersionId", "producer", "warnings", "candidate"])
      && output.candidateType === "analysis_plan_candidate"
      && output.schemaVersion === request.input.targetSchemaVersion
      && output.generationId === request.generationId
      && output.requirementVersionId === request.input.requirementVersionId
      && isPlainRecord(output.candidate)
      && Array.isArray(output.candidate.steps)
      && output.candidate.steps.length > 0;
  }
  return false;
}

function isSafeProducer(value: unknown, runtime: PiGenerationRuntimeMetadata): boolean {
  return isPlainRecord(value)
    && onlyKeys(value, ["name", "version", "mode"])
    && value.name === runtime.producerName
    && value.version === runtime.producerVersion
    && value.mode === runtime.mode;
}

function doesNotLeak(value: unknown): boolean {
  if (typeof value === "string") {
    return !ABSOLUTE_PATH_RE.test(value) && !TOKEN_LIKE_RE.test(value);
  }
  if (Array.isArray(value)) return value.every(doesNotLeak);
  if (isPlainRecord(value)) {
    for (const [key, child] of Object.entries(value)) {
      if (FORBIDDEN_OUTPUT_KEYS.has(key)) return false;
      if (!doesNotLeak(child)) return false;
    }
  }
  return true;
}

function isDeadlineExpired(deadlineAt: string | null | undefined, now: Date): boolean {
  if (!deadlineAt) return false;
  const deadlineMs = new Date(deadlineAt).getTime();
  if (!Number.isFinite(deadlineMs)) return false;
  return deadlineMs <= now.getTime();
}

function deadlineTimeoutMs(deadlineAt: string | null | undefined, now: Date, fallbackMs: number): number {
  if (!deadlineAt) return fallbackMs;
  const diff = new Date(deadlineAt).getTime() - now.getTime();
  if (!Number.isFinite(diff)) return fallbackMs;
  return Math.max(0, Math.min(diff, fallbackMs));
}

function validatedResult(
  request: EnginePortRequest,
  startedAt: string,
  completedAt: string,
  outcome: EngineOutcome,
  output: unknown,
  error: { readonly code: EngineErrorCode; readonly summary: string } | undefined,
): EnginePortResultEnvelope {
  const result: EnginePortResultEnvelope = {
    version: ENGINE_PORT_VERSION,
    operation: request.operation,
    operationId: request.operationId,
    projectId: request.projectId,
    generationId: request.generationId,
    startedAt,
    completedAt,
    outcome,
    ...(outcome === "succeeded" ? { output } : { error }),
  };
  validateEnginePortResult(result);
  return result;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function onlyKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const allowed = new Set(keys);
  return Object.keys(value).every((key) => allowed.has(key)) && keys.every((key) => key in value);
}
