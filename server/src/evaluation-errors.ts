import type { EvaluationError, EvaluationErrorCode } from "./types.ts";

export function evaluationError(
  code: EvaluationErrorCode,
  message: string,
  hint?: string,
  cause?: string,
): EvaluationError {
  return {
    code,
    message,
    ...(hint ? { hint } : {}),
    ...(cause ? { cause } : {}),
  };
}

export function unknownEvaluationError(err: unknown, hint?: string): EvaluationError {
  if (isEvaluationError(err)) return err;
  const message = err instanceof Error ? err.message : String(err);
  return evaluationError("unknown", message, hint, err instanceof Error && err.stack ? err.stack : undefined);
}

export function serializeEvaluationError(error: EvaluationError | string | null | undefined): string | null {
  if (error === null || error === undefined) return null;
  if (typeof error === "string") return JSON.stringify(evaluationError("unknown", error));
  return JSON.stringify(error);
}

export function parseEvaluationError(value: unknown): EvaluationError | null {
  if (value === null || value === undefined || value === "") return null;
  if (isEvaluationError(value)) return value;
  if (typeof value !== "string") return evaluationError("unknown", String(value));
  try {
    const parsed = JSON.parse(value) as unknown;
    if (isEvaluationError(parsed)) return parsed;
  } catch {
    // Historical rows stored plain error text.
  }
  return evaluationError("unknown", value);
}

export function formatEvaluationError(error: EvaluationError | null): string {
  if (!error) return "";
  return [
    `[${error.code}] ${error.message}`,
    error.hint ? `hint: ${error.hint}` : "",
  ].filter(Boolean).join("\n");
}

function isEvaluationError(value: unknown): value is EvaluationError {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<EvaluationError>;
  return isEvaluationErrorCode(candidate.code) && typeof candidate.message === "string";
}

function isEvaluationErrorCode(value: unknown): value is EvaluationErrorCode {
  return value === "workspace_not_found"
    || value === "flow_not_found"
    || value === "workflow_invalid"
    || value === "process_exit"
    || value === "judge_failed"
    || value === "unknown";
}
