import { runPiTurn, type PiRun, type RunPiOptions } from "../../../pi-adapter.ts";
import type { PiEvent } from "../../../types.ts";
import type {
  PiGenerationRunner,
  PiGenerationRunnerHandle,
  PiGenerationRunnerRequest,
  PiGenerationRunnerResult,
  PiGenerationRuntimeMetadata,
} from "./generation.ts";
import type {
  RunExecutionRunner,
  RunExecutionRunnerHandle,
  RunExecutionRunnerRequest,
  RunExecutionRunnerResult,
  RunExecutionRuntimeMetadata,
} from "./execution.ts";

export type PiTurnStarter = (opts: RunPiOptions) => PiRun;

export interface PiEngineModelMetadata {
  readonly provider?: string;
  readonly model?: string;
  readonly api?: string;
}

export interface PiTurnRunnerOptions {
  /** Working directory for the pi process; pi sessions live under <workDir>/.pi-sessions. */
  readonly workDir: string;
  readonly model?: string;
  /** Injectable for deterministic tests; production default is runPiTurn from server/src/pi-adapter.ts. */
  readonly startTurn?: PiTurnStarter;
  /**
   * Narrow safe-metadata callback. The runner constructs the value itself from
   * a scalar whitelist (provider/model/api only); no PiEvent, message object,
   * assistant content, usage, or raw diagnostic ever crosses this callback.
   */
  readonly onModelMetadata?: (metadata: PiEngineModelMetadata) => void;
}

const PRODUCER_NAME = "pi-xanthil-pi-engine-adapter";
const PRODUCER_VERSION = "1.0.0";

const JSON_ONLY_SYSTEM_PROMPT = [
  "You are the pi-Xanthil Analysis Engine runtime.",
  "Respond with exactly one strict JSON object and nothing else: no markdown fences, no commentary, no reasoning trace.",
  "Never include prompts, hidden reasoning, raw pi events, thinking, stdout, stderr, stack traces, absolute paths, tokens, API keys, storage refs, session refs, SQL, or raw evidence content in the output.",
].join(" ");

interface CapturedTurn {
  readonly done: Promise<number | null>;
  readonly kill: () => void;
  readonly isRunning: () => boolean;
  readonly text: () => string;
}

function startJsonTurn(starter: PiTurnStarter, workDir: string, sessionId: string, prompt: string, model?: string, onModelMetadata?: (metadata: PiEngineModelMetadata) => void): CapturedTurn {
  let output = "";
  const run = starter({
    workspaceRoot: workDir,
    cwdOverride: workDir,
    piSessionId: sessionId,
    text: prompt,
    model,
    systemPrompt: JSON_ONLY_SYSTEM_PROMPT,
    skillPaths: [],
    onEvent: (event: PiEvent) => {
      if (event.type === "message_end" || event.type === "turn_end") {
        const { message } = event as Extract<PiEvent, { type: "message_end" | "turn_end" }>;
        if (message.role === "assistant") {
          if (onModelMetadata) {
            onModelMetadata({
              ...(typeof message.provider === "string" ? { provider: message.provider } : {}),
              ...(typeof message.model === "string" ? { model: message.model } : {}),
              ...(typeof message.api === "string" ? { api: message.api } : {}),
            });
          }
          const text = extractMessageText(message.content);
          if (text) output = text;
        }
      }
    },
  });
  return {
    done: run.done,
    kill: run.kill,
    isRunning: run.isRunning,
    text: () => output,
  };
}

function extractMessageText(content: unknown): string {
  if (!Array.isArray(content)) return "";
  return content
    .filter((block): block is { type: "text"; text: string } =>
      typeof block === "object" && block !== null
      && (block as { type?: unknown }).type === "text"
      && typeof (block as { text?: unknown }).text === "string")
    .map((block) => block.text)
    .join("\n")
    .trim();
}

function stripMarkdownFence(text: string): string {
  const trimmed = text.trim();
  const match = trimmed.match(/^```(?:json|JSON)?\s*\n?([\s\S]*?)\n?```$/);
  return match && match[1] !== undefined ? match[1].trim() : trimmed;
}

function producerBlock(mode: "pi-agent"): string {
  return JSON.stringify({ name: PRODUCER_NAME, version: PRODUCER_VERSION, mode });
}

function buildGenerationPrompt(request: PiGenerationRunnerRequest): string {
  const producer = producerBlock("pi-agent");
  if (request.operation === "generateStructuredRequirement") {
    return [
      request.instruction,
      "",
      "Return exactly one strict JSON object with these exact top-level keys and no others:",
      "{",
      '  "candidateType": "structured_requirement_candidate",',
      `  "schemaVersion": ${JSON.stringify(request.targetSchemaVersion)},`,
      `  "generationId": ${JSON.stringify(request.generationId)},`,
      `  "producer": ${producer},`,
      '  "warnings": [],',
      '  "candidate": {',
      '    "businessQuestion": "<non-empty string>",',
      '    "scope": { "inScope": ["<string>"], "outOfScope": ["<string>"] },',
      '    "acceptanceCriteria": ["<non-empty string>"],',
      '    "sourceReferenceIds": [],',
      '    "inputEvidenceArtifactIds": []',
      "  }",
      "}",
      "",
      "Copy candidateType, schemaVersion, generationId, and producer verbatim from above.",
      "No business data is provided; generate a generic synthetic daily-analysis requirement candidate.",
    ].join("\n");
  }
  return [
    request.instruction,
    "",
    "Return exactly one strict JSON object with these exact top-level keys and no others:",
    "{",
    '  "candidateType": "analysis_plan_candidate",',
    `  "schemaVersion": ${JSON.stringify(request.targetSchemaVersion)},`,
    `  "generationId": ${JSON.stringify(request.generationId)},`,
    `  "requirementVersionId": ${JSON.stringify(request.requirementVersionId ?? "")},`,
    `  "producer": ${producer},`,
    '  "warnings": [],',
    '  "candidate": {',
    '    "analysisObjective": "<non-empty string>",',
    '    "successCriteria": ["<non-empty string>"],',
    '    "steps": [',
    '      { "planStepId": "context-loading", "sequence": 1, "analysisStage": "S2.1", "purpose": "<non-empty string>" },',
    '      { "planStepId": "data-profiling", "sequence": 2, "analysisStage": "S2.2", "purpose": "<non-empty string>" },',
    '      { "planStepId": "analysis-execution", "sequence": 3, "analysisStage": "S2.3", "purpose": "<non-empty string>" },',
    '      { "planStepId": "internal-review", "sequence": 4, "analysisStage": "S2.4", "purpose": "<non-empty string>" }',
    "    ]",
    "  }",
    "}",
    "",
    "Copy candidateType, schemaVersion, generationId, requirementVersionId, and producer verbatim from above.",
    "analysisStage must be one of S2.1, S2.2, S2.3, S2.4; sequence values must be contiguous positive integers starting at 1; planStepId values must be unique.",
    "No business data is provided; generate a generic synthetic daily-analysis plan candidate with exactly the four steps above.",
  ].join("\n");
}

function buildExecutionPrompt(request: RunExecutionRunnerRequest): string {
  const producer = producerBlock("pi-agent");
  return [
    request.instruction,
    "",
    "Return exactly one strict JSON object with these exact top-level keys and no others:",
    "{",
    '  "candidateType": "run_execution_candidate",',
    '  "schemaVersion": "1.0",',
    `  "runId": ${JSON.stringify(request.runId)},`,
    `  "planVersionId": ${JSON.stringify(request.planVersionId)},`,
    `  "expectedPreviousSequence": ${request.expectedPreviousSequence},`,
    `  "producer": ${producer},`,
    '  "executionSummary": {',
    '    "runStartAcknowledged": true,',
    '    "analysisOpsStages": ["S2.1", "S2.2", "S2.3", "S2.4"],',
    '    "planStepCount": 4,',
    '    "eventSuggestionCount": 8,',
    '    "evidenceSuggestionCount": 2,',
    '    "internalReviewOutcome": "passed",',
    '    "reportDraftReady": true',
    "  },",
    '  "eventSuggestions": [ ... ],',
    '  "evidenceRegistrationSuggestions": [ ... ],',
    '  "internalReviewSuggestion": { ... },',
    '  "reportDraftCandidate": { ... },',
    '  "warnings": []',
    "}",
    "",
    "Copy candidateType, schemaVersion, runId, planVersionId, expectedPreviousSequence, and producer verbatim from above.",
    "eventSuggestions: non-empty array; each item has exactly the keys eventType, payloadSchemaVersion, analysisStageAfter, runStatusAfter, producerEventId, payload.",
    "- eventType must be one of stage_started, stage_completed, plan_step_started, plan_step_completed, warning_recorded.",
    "- NEVER suggest run_started, run_failed, run_aborted, run_blocked, or evidence_registered: those are backend-owned lifecycle or durable-ID events written by the backend itself.",
    '- payloadSchemaVersion must equal "workcanger.run-event.<eventType>/1.0".',
    "- analysisStageAfter must be one of S2.1, S2.2, S2.3, S2.4; runStatusAfter must be \"running\".",
    "- producerEventId must be a non-empty string and UNIQUE across all eventSuggestions (duplicates violate a durable unique index).",
    "- payload must satisfy the RunEvent schema: stage_started/stage_completed take {\"stage\": \"<S2.x>\"}; plan_step_started takes {\"planStepId\": \"<id>\", \"stepOrdinal\": <positive integer>}; plan_step_completed takes {\"planStepId\": \"<id>\", \"stepOrdinal\": <positive integer>, \"outcome\": \"completed\", \"outputEvidenceArtifactIds\": []}; warning_recorded takes {\"warningCode\": \"<non-empty string>\", \"summary\": \"<non-empty string>\", \"evidenceArtifactIds\": []}.",
    "- outputEvidenceArtifactIds and evidenceArtifactIds must ALWAYS be empty arrays: the backend assigns durable evidence IDs itself.",
    "- Sequence coherence: analysisStageAfter must be non-decreasing in the order S2.1 -> S2.2 -> S2.3 -> S2.4; every stage S2.1-S2.4 must have exactly one stage_started event, in that order; stage payload.stage must equal analysisStageAfter; a plan_step_started for a step must appear before its plan_step_completed.",
    "- plan_step_completed stepOrdinal values must be unique and contiguous starting at 1; each planStepId always pairs with the same stepOrdinal; planStepCount in executionSummary must equal the number of distinct completed plan steps.",
    "evidenceRegistrationSuggestions: non-empty array; each item has exactly the keys candidateEvidenceHandle, sourceAdmittedEvidenceHandle, planStepId, artifactKind, safetyClass, visibility, displayName, contentSha256.",
    '- Handles match ^[a-z0-9][a-z0-9:._-]{2,80}$; artifactKind is one of intermediate_result, analysis_result, aggregate_result, chart, notebook; safetyClass must be "derived"; visibility is review_only or user_visible.',
    '- contentSha256 must be EXACTLY 64 lowercase hex characters (0-9a-f), no more and no fewer; for synthetic candidates use 64 repeated "1" characters for the first suggestion and 64 repeated "2" characters for the second.',
    '- candidateEvidenceHandle values must be unique across suggestions.',
    "internalReviewSuggestion: exactly the keys schemaVersion (\"1.0\"), reviewOrdinal (1), planStepId, outcome (\"passed\"), reviewEvidenceHandle, reviewedEvidenceHandles, qualityChecks, limitations (array of strings), misinterpretationRisks (array of strings).",
    '- qualityChecks: non-empty array of objects with exactly the keys checkId (non-empty string), outcome ("passed"), summary (non-empty string).',
    '- reviewEvidenceHandle must equal one of the evidenceRegistrationSuggestions candidateEvidenceHandle values, and THAT suggestion must use artifactKind "intermediate_result" with visibility "review_only".',
    "- reviewedEvidenceHandles may only reference candidateEvidenceHandle values from evidenceRegistrationSuggestions.",
    "reportDraftCandidate: exactly the keys schemaVersion (\"1.0\"), title, executiveSummary, methodSummary, keyConclusionCount (positive integer), citedEvidenceHandles (non-empty array of handles), confidence (high|medium|low), confidenceRationale, limitations (array of strings only), misinterpretationRisks (array of strings only), actionableRecommendationCount (non-negative integer).",
    "- citedEvidenceHandles may only reference candidateEvidenceHandle values from evidenceRegistrationSuggestions.",
    "Consistency requirements: executionSummary.eventSuggestionCount must equal the actual length of eventSuggestions; executionSummary.evidenceSuggestionCount must equal the actual length of evidenceRegistrationSuggestions.",
    "No business data is provided; generate a generic synthetic execution candidate consistent with a four-step S2.1-S2.4 plan.",
  ].join("\n");
}

export class PiTurnGenerationRunner implements PiGenerationRunner {
  readonly runtime: PiGenerationRuntimeMetadata = {
    producerName: PRODUCER_NAME,
    producerVersion: PRODUCER_VERSION,
    mode: "pi-agent",
  };

  private readonly options: PiTurnRunnerOptions;

  constructor(options: PiTurnRunnerOptions) {
    this.options = options;
  }

  start(request: PiGenerationRunnerRequest): PiGenerationRunnerHandle {
    const starter = this.options.startTurn ?? runPiTurn;
    const sessionId = `engine-gen-${request.generationId}`;
    let turn: CapturedTurn;
    try {
      turn = startJsonTurn(starter, this.options.workDir, sessionId, buildGenerationPrompt(request), this.options.model, this.options.onModelMetadata);
    } catch {
      return {
        done: Promise.resolve({ outcome: "spawn_failed", safeRuntime: this.runtime } satisfies PiGenerationRunnerResult),
        cancel: () => undefined,
        isRunning: () => false,
      };
    }
    const done: Promise<PiGenerationRunnerResult> = turn.done.then((code) => {
      if (code === null) return { outcome: "spawn_failed", safeRuntime: this.runtime };
      if (code !== 0) return { outcome: "failed", exitCode: code, signal: null, safeRuntime: this.runtime };
      const stdoutJson = stripMarkdownFence(turn.text());
      if (stdoutJson.length === 0) {
        // Provider/runtime failure (e.g. exhausted auto-retry produced no
        // assistant content): map to pi_execution_failed, never schema-invalid.
        return { outcome: "failed", exitCode: 0, signal: null, safeRuntime: this.runtime };
      }
      return { outcome: "succeeded", stdoutJson, runtime: this.runtime };
    }, () => ({ outcome: "failed", safeRuntime: this.runtime }));
    return {
      done,
      cancel: () => {
        turn.kill();
        // Confirmed termination: resolves only after the pi process close event.
        return turn.done.then(() => undefined, () => undefined);
      },
      isRunning: turn.isRunning,
    };
  }
}

export class PiTurnExecutionRunner implements RunExecutionRunner {
  readonly runtime: RunExecutionRuntimeMetadata = {
    producerName: PRODUCER_NAME,
    producerVersion: PRODUCER_VERSION,
    mode: "pi-agent",
  };

  private readonly options: PiTurnRunnerOptions;

  constructor(options: PiTurnRunnerOptions) {
    this.options = options;
  }

  start(request: RunExecutionRunnerRequest): RunExecutionRunnerHandle {
    const starter = this.options.startTurn ?? runPiTurn;
    const sessionId = `engine-run-${request.runId}`;
    let turn: CapturedTurn;
    try {
      turn = startJsonTurn(starter, this.options.workDir, sessionId, buildExecutionPrompt(request), this.options.model, this.options.onModelMetadata);
    } catch {
      return {
        done: Promise.resolve({ outcome: "spawn_failed", safeRuntime: this.runtime } satisfies RunExecutionRunnerResult),
        cancel: () => undefined,
        isRunning: () => false,
      };
    }
    const done: Promise<RunExecutionRunnerResult> = turn.done.then((code) => {
      if (code === null) return { outcome: "spawn_failed", safeRuntime: this.runtime };
      if (code !== 0) return { outcome: "failed", exitCode: code, signal: null, safeRuntime: this.runtime };
      const stdoutJson = stripMarkdownFence(turn.text());
      if (stdoutJson.length === 0) {
        // Provider/runtime failure (e.g. exhausted auto-retry produced no
        // assistant content): map to pi_execution_failed, never schema-invalid.
        return { outcome: "failed", exitCode: 0, signal: null, safeRuntime: this.runtime };
      }
      return { outcome: "succeeded", stdoutJson, runtime: this.runtime };
    }, () => ({ outcome: "failed", safeRuntime: this.runtime }));
    return {
      done,
      cancel: () => {
        turn.kill();
        // Confirmed termination: resolves only after the pi process close event.
        return turn.done.then(() => undefined, () => undefined);
      },
      isRunning: turn.isRunning,
    };
  }
}
