import assert from "node:assert/strict";
import test from "node:test";
import { evaluationError, formatEvaluationError, parseEvaluationError, serializeEvaluationError } from "./evaluation-errors.ts";

test("evaluation error serialization round-trips typed errors", () => {
  const error = evaluationError("workflow_invalid", "workflow.json not found or invalid", "Fix schema");
  const serialized = serializeEvaluationError(error);

  assert.deepEqual(parseEvaluationError(serialized), error);
});

test("parseEvaluationError keeps historical plain text compatible", () => {
  assert.deepEqual(parseEvaluationError("old failure"), {
    code: "unknown",
    message: "old failure",
  });
});

test("formatEvaluationError includes code, message, and hint", () => {
  assert.equal(
    formatEvaluationError(evaluationError("process_exit", "pi exited with code 1", "Check stderr")),
    "[process_exit] pi exited with code 1\nhint: Check stderr",
  );
});
