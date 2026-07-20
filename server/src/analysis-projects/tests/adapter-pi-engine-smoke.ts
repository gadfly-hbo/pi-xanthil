/**
 * Controller-reproducible real pi smoke for the pi engine adapter.
 *
 * Usage:
 *   node --experimental-strip-types server/src/analysis-projects/tests/adapter-pi-engine-smoke.ts
 *   node --experimental-strip-types server/src/analysis-projects/tests/adapter-pi-engine-smoke.ts --model <model-id>
 *   PI_ENGINE_SMOKE_MODEL=<model-id> node --experimental-strip-types server/src/analysis-projects/tests/adapter-pi-engine-smoke.ts
 *
 * Model selector precedence: --model CLI argument, then PI_ENGINE_SMOKE_MODEL,
 * then pi's configured default. The effective provider/model/api observed at
 * runtime is printed (safe scalar metadata only).
 *
 * - Uses a fresh mkdtemp workDir (removed afterwards) and purely synthetic
 *   inputs (random UUIDs, fixed hashes).
 * - Prints pi version and safe outcome metadata only: no absolute paths, no
 *   prompts, no raw events.
 * - Exit code 0 iff Requirement + Plan + Run all succeed.
 */
import { execFileSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID, createHash } from "node:crypto";
import {
  createPiEngineHandler,
  PiTurnExecutionRunner,
  PiTurnGenerationRunner,
  type PiEngineModelMetadata,
} from "../adapters/pi-engine/index.ts";
import { PI_BIN } from "../../config.ts";
import type { EnginePortRequest, EnginePortResultEnvelope } from "../contracts/engine-port.ts";

const sha = (s: string) => createHash("sha256").update(s).digest("hex");
const deadline = (ms: number) => new Date(Date.now() + ms).toISOString();

function parseModelSelector(): string | undefined {
  const idx = process.argv.indexOf("--model");
  if (idx >= 0 && process.argv[idx + 1]) return process.argv[idx + 1];
  const env = process.env.PI_ENGINE_SMOKE_MODEL;
  return env && env.trim().length > 0 ? env.trim() : undefined;
}

const modelSelector = parseModelSelector();
const seen: { provider?: string; model?: string; api?: string } = {};
const onModelMetadata = (metadata: PiEngineModelMetadata) => {
  if (!seen.model) {
    seen.provider = metadata.provider;
    seen.model = metadata.model;
    seen.api = metadata.api;
  }
};

const workDir = await mkdtemp(join(tmpdir(), "pi-engine-smoke-"));
try {
  console.log(`piVersion=${execFileSync(PI_BIN, ["--version"], { encoding: "utf8" }).trim()}`);
} catch {
  console.log("piVersion=unavailable");
}
console.log(`modelSelector=${modelSelector ?? "(pi default)"}`);

const generationRunner = new PiTurnGenerationRunner({ workDir, model: modelSelector, onModelMetadata });
const executionRunner = new PiTurnExecutionRunner({ workDir, model: modelSelector, onModelMetadata });
const handler = createPiEngineHandler({ generationRunner, executionRunner, defaultTimeoutMs: 240_000 });

function requirementRequest(): EnginePortRequest {
  return {
    version: "engine-port/1.0",
    operation: "generateStructuredRequirement",
    operationId: randomUUID(),
    projectId: randomUUID(),
    generationId: randomUUID(),
    caller: "pi-engine-smoke",
    requestedAt: new Date().toISOString(),
    deadlineAt: deadline(240_000),
    inputHash: sha("smoke-requirement"),
    abortSignal: null,
    input: { targetSchemaVersion: "1.0" },
  };
}

function planRequest(): EnginePortRequest {
  return {
    version: "engine-port/1.0",
    operation: "generateAnalysisPlan",
    operationId: randomUUID(),
    projectId: randomUUID(),
    generationId: randomUUID(),
    caller: "pi-engine-smoke",
    requestedAt: new Date().toISOString(),
    deadlineAt: deadline(240_000),
    inputHash: sha("smoke-plan"),
    abortSignal: null,
    input: { requirementVersionId: randomUUID(), targetSchemaVersion: "1.0" },
  };
}

function runRequest(): EnginePortRequest {
  const runId = randomUUID();
  return {
    version: "engine-port/1.0",
    operation: "executeQueuedRun",
    operationId: randomUUID(),
    projectId: randomUUID(),
    runId,
    caller: "pi-engine-smoke",
    requestedAt: new Date().toISOString(),
    deadlineAt: deadline(240_000),
    inputHash: sha("smoke-run"),
    abortSignal: null,
    input: { runId, planVersionId: randomUUID(), expectedPreviousSequence: 0 },
  };
}

function report(label: string, res: EnginePortResultEnvelope): boolean {
  const candidateType = (res.output as { candidateType?: string } | undefined)?.candidateType ?? "-";
  const events = (res.output as { eventSuggestions?: unknown[] } | undefined)?.eventSuggestions;
  console.log(`${label} outcome=${res.outcome} code=${res.error?.code ?? "-"} candidateType=${candidateType} events=${Array.isArray(events) ? events.length : "-"}`);
  return res.outcome === "succeeded";
}

let ok = false;
try {
  const reqOk = report("REQUIREMENT", await handler(requirementRequest()));
  const planOk = report("PLAN", await handler(planRequest()));
  let runOk = false;
  if (reqOk && planOk) {
    runOk = report("RUN", await handler(runRequest()));
  } else {
    console.log("RUN skipped (requirement/plan did not succeed)");
  }
  ok = reqOk && planOk && runOk;
  console.log(`provider=${seen.provider ?? "-"} model=${seen.model ?? "-"} api=${seen.api ?? "-"}`);
  console.log(`SMOKE_SUMMARY requirement=${reqOk} plan=${planOk} run=${runOk}`);
} finally {
  await rm(workDir, { recursive: true, force: true });
}
process.exit(ok ? 0 : 1);
