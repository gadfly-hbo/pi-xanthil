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

export type FakeGenerationScenario =
  | "happy"
  | "malformed_json"
  | "invalid_candidate"
  | "spawn_failed"
  | "execution_failed"
  | "never";

export interface FakeGenerationRunnerOptions {
  readonly scenario?: FakeGenerationScenario;
  readonly delayMs?: number;
  readonly rawDiagnostic?: string;
}

export class FakeGenerationRunner implements PiGenerationRunner {
  readonly runtime: PiGenerationRuntimeMetadata = {
    producerName: "pi-xanthil-fake-generation-runner",
    producerVersion: "0.0.0-test",
    mode: "fake",
  };

  readonly requests: PiGenerationRunnerRequest[] = [];
  cancelCount = 0;

  private readonly scenario: FakeGenerationScenario;
  private readonly delayMs: number;
  private readonly rawDiagnostic: string;

  constructor(options: FakeGenerationRunnerOptions = {}) {
    this.scenario = options.scenario ?? "happy";
    this.delayMs = options.delayMs ?? 0;
    this.rawDiagnostic = options.rawDiagnostic ?? "raw stderr /Users/example/.pi-sessions secret_abcdefghijklmnopqrstuvwxyz0123456789";
  }

  start(request: PiGenerationRunnerRequest): PiGenerationRunnerHandle {
    this.requests.push(request);
    let running = true;
    const done = this.run(request).finally(() => {
      running = false;
    });
    return {
      done,
      cancel: () => {
        this.cancelCount += 1;
        running = false;
      },
      isRunning: () => running,
    };
  }

  private async run(request: PiGenerationRunnerRequest): Promise<PiGenerationRunnerResult> {
    if (this.scenario === "never") {
      return new Promise<PiGenerationRunnerResult>(() => undefined);
    }
    if (this.delayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, this.delayMs));
    }
    if (this.scenario === "spawn_failed") {
      return { outcome: "spawn_failed", safeRuntime: this.runtime, rawDiagnostic: this.rawDiagnostic };
    }
    if (this.scenario === "execution_failed") {
      return { outcome: "failed", exitCode: 2, signal: null, safeRuntime: this.runtime, rawDiagnostic: this.rawDiagnostic };
    }
    if (this.scenario === "malformed_json") {
      return { outcome: "succeeded", stdoutJson: "{not-json", runtime: this.runtime };
    }
    if (this.scenario === "invalid_candidate") {
      return {
        outcome: "succeeded",
        stdoutJson: JSON.stringify({ prompt: "leaked", token: "abcdefghijklmnopqrstuvwxyz0123456789abcdefghijklmnopqrstuvwxyz" }),
        runtime: this.runtime,
      };
    }
    return { outcome: "succeeded", stdoutJson: JSON.stringify(fakeOutputFor(request, this.runtime)), runtime: this.runtime };
  }
}

export type FakeExecutionScenario =
  | "happy"
  | "malformed_json"
  | "invalid_candidate"
  | "unknown_event_type"
  | "invalid_event_payload"
  | "spawn_failed"
  | "execution_failed"
  | "never";

export interface FakeExecutionRunnerOptions {
  readonly scenario?: FakeExecutionScenario;
  readonly delayMs?: number;
  readonly rawDiagnostic?: string;
}

export class FakeExecutionRunner implements RunExecutionRunner {
  readonly runtime: RunExecutionRuntimeMetadata = {
    producerName: "pi-xanthil-fake-execution-runner",
    producerVersion: "0.0.0-test",
    mode: "fake",
  };

  readonly requests: RunExecutionRunnerRequest[] = [];
  cancelCount = 0;

  private readonly scenario: FakeExecutionScenario;
  private readonly delayMs: number;
  private readonly rawDiagnostic: string;

  constructor(options: FakeExecutionRunnerOptions = {}) {
    this.scenario = options.scenario ?? "happy";
    this.delayMs = options.delayMs ?? 0;
    this.rawDiagnostic = options.rawDiagnostic ?? "raw stderr /Users/example/.pi-sessions secret_abcdefghijklmnopqrstuvwxyz0123456789";
  }

  start(request: RunExecutionRunnerRequest): RunExecutionRunnerHandle {
    this.requests.push(request);
    let running = true;
    const done = this.run(request).finally(() => {
      running = false;
    });
    return {
      done,
      cancel: () => {
        this.cancelCount += 1;
        running = false;
      },
      isRunning: () => running,
    };
  }

  private async run(request: RunExecutionRunnerRequest): Promise<RunExecutionRunnerResult> {
    if (this.scenario === "never") {
      return new Promise<RunExecutionRunnerResult>(() => undefined);
    }
    if (this.delayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, this.delayMs));
    }
    if (this.scenario === "spawn_failed") {
      return { outcome: "spawn_failed", safeRuntime: this.runtime, rawDiagnostic: this.rawDiagnostic };
    }
    if (this.scenario === "execution_failed") {
      return { outcome: "failed", exitCode: 2, signal: null, safeRuntime: this.runtime, rawDiagnostic: this.rawDiagnostic };
    }
    if (this.scenario === "malformed_json") {
      return { outcome: "succeeded", stdoutJson: "{not-json", runtime: this.runtime };
    }
    if (this.scenario === "invalid_candidate") {
      return {
        outcome: "succeeded",
        stdoutJson: JSON.stringify({ prompt: "leaked", rawPiEvent: { storageRef: "/Users/example/.pi-sessions/blob" } }),
        runtime: this.runtime,
      };
    }
    if (this.scenario === "unknown_event_type") {
      const output = fakeExecutionOutputFor(request, this.runtime) as Record<string, unknown>;
      return {
        outcome: "succeeded",
        stdoutJson: JSON.stringify({ ...output, eventSuggestions: [{ eventType: "pi_raw_chunk" }] }),
        runtime: this.runtime,
      };
    }
    if (this.scenario === "invalid_event_payload") {
      const output = fakeExecutionOutputFor(request, this.runtime) as { eventSuggestions: Array<Record<string, unknown>> } & Record<string, unknown>;
      return {
        outcome: "succeeded",
        stdoutJson: JSON.stringify({
          ...output,
          eventSuggestions: output.eventSuggestions.map((event) => event.eventType === "plan_step_completed"
            ? { ...event, payload: { ...(event.payload as Record<string, unknown>), orderedOutputEvidenceArtifactIds: ["candidate-evidence:invalid"] } }
            : event),
        }),
        runtime: this.runtime,
      };
    }
    return { outcome: "succeeded", stdoutJson: JSON.stringify(fakeExecutionOutputFor(request, this.runtime)), runtime: this.runtime };
  }
}

function fakeOutputFor(request: PiGenerationRunnerRequest, runtime: PiGenerationRuntimeMetadata): unknown {
  const producer = {
    name: runtime.producerName,
    version: runtime.producerVersion,
    mode: runtime.mode,
  };
  if (request.operation === "generateStructuredRequirement") {
    return {
      candidateType: "structured_requirement_candidate",
      schemaVersion: request.targetSchemaVersion,
      generationId: request.generationId,
      producer,
      warnings: [],
      candidate: {
        businessQuestion: "Which daily business signal should be analyzed and why?",
        scope: { inScope: ["daily analysis request"], outOfScope: ["automated business action"] },
        acceptanceCriteria: ["Human can confirm whether the requirement is complete enough for plan generation."],
        sourceReferenceIds: [],
        inputEvidenceArtifactIds: [],
      },
    };
  }
  return {
    candidateType: "analysis_plan_candidate",
    schemaVersion: request.targetSchemaVersion,
    generationId: request.generationId,
    requirementVersionId: request.requirementVersionId,
    producer,
    warnings: [],
    candidate: {
      analysisObjective: "Produce a daily analysis plan bound to the confirmed requirement.",
      successCriteria: ["Plan can be reviewed by a human before any run is queued."],
      steps: [
        { planStepId: "context-loading", sequence: 1, analysisStage: "S2.1", purpose: "Load approved context and constraints." },
        { planStepId: "data-profiling", sequence: 2, analysisStage: "S2.2", purpose: "Profile admitted controlled or derived evidence." },
        { planStepId: "analysis-execution", sequence: 3, analysisStage: "S2.3", purpose: "Execute the approved analysis method." },
        { planStepId: "internal-review", sequence: 4, analysisStage: "S2.4", purpose: "Review outputs before human report review." },
      ],
    },
  };
}

function fakeExecutionOutputFor(request: RunExecutionRunnerRequest, runtime: RunExecutionRuntimeMetadata): unknown {
  const producer = {
    name: runtime.producerName,
    version: runtime.producerVersion,
    mode: runtime.mode,
  };
  const analysisEvidenceHandle = "candidate-evidence:analysis-summary";
  const reviewEvidenceHandle = "candidate-evidence:internal-review";
  return {
    candidateType: "run_execution_candidate",
    schemaVersion: "1.0",
    runId: request.runId,
    planVersionId: request.planVersionId,
    expectedPreviousSequence: request.expectedPreviousSequence,
    producer,
    executionSummary: {
      runStartAcknowledged: true,
      analysisOpsStages: ["S2.1", "S2.2", "S2.3", "S2.4"],
      planStepCount: 4,
      eventSuggestionCount: 8,
      evidenceSuggestionCount: 2,
      internalReviewOutcome: "passed",
      reportDraftReady: true,
    },
    eventSuggestions: [
      ...["S2.1", "S2.2", "S2.3", "S2.4"].flatMap((stage, index) => {
        const stepOrdinal = index + 1;
        const planStepId = [`context-loading`, `data-profiling`, `analysis-execution`, `internal-review`][index];
        return [
          {
            eventType: "stage_started",
            payloadSchemaVersion: "workcanger.run-event.stage_started/1.0",
            analysisStageAfter: stage,
            runStatusAfter: "running",
            producerEventId: `fake-${stage}-started`,
            payload: { stage },
          },
          {
            eventType: "plan_step_completed",
            payloadSchemaVersion: "workcanger.run-event.plan_step_completed/1.0",
            analysisStageAfter: stage,
            runStatusAfter: "running",
            producerEventId: `fake-step-${stepOrdinal}-completed`,
            payload: {
              planStepId,
              stepOrdinal,
              outcome: "completed",
              outputEvidenceArtifactIds: [],
            },
          },
        ];
      }),
    ],
    evidenceRegistrationSuggestions: [
      {
        candidateEvidenceHandle: analysisEvidenceHandle,
        sourceAdmittedEvidenceHandle: "admitted-evidence:controlled-plan-input",
        planStepId: "analysis-execution",
        artifactKind: "analysis_result",
        safetyClass: "derived",
        visibility: "user_visible",
        displayName: "Deterministic analysis summary candidate",
        contentSha256: "1".repeat(64),
      },
      {
        candidateEvidenceHandle: reviewEvidenceHandle,
        sourceAdmittedEvidenceHandle: analysisEvidenceHandle,
        planStepId: "internal-review",
        artifactKind: "intermediate_result",
        safetyClass: "derived",
        visibility: "review_only",
        displayName: "Deterministic internal review candidate",
        contentSha256: "2".repeat(64),
      },
    ],
    internalReviewSuggestion: {
      schemaVersion: "1.0",
      reviewOrdinal: 1,
      planStepId: "internal-review",
      outcome: "passed",
      reviewEvidenceHandle,
      reviewedEvidenceHandles: [analysisEvidenceHandle],
      qualityChecks: [
        { checkId: "qc-evidence-boundary", outcome: "passed", summary: "Only derived candidate evidence handles are referenced." },
        { checkId: "qc-report-readiness", outcome: "passed", summary: "Report draft candidate includes confidence, limitations, and risk summaries." },
      ],
      limitations: ["Fake runner validates the Engine execution surface only; it does not execute real analysis."],
      misinterpretationRisks: ["Do not treat deterministic fake output as a business conclusion."],
    },
    reportDraftCandidate: {
      schemaVersion: "1.0",
      title: "Daily analysis draft candidate",
      executiveSummary: "Deterministic fake execution completed S2.1-S2.4 and produced a report draft candidate for Backend validation.",
      methodSummary: "Process-local fake runner generated normalized event, evidence, internal review, and report suggestions without external dependencies.",
      keyConclusionCount: 1,
      citedEvidenceHandles: [analysisEvidenceHandle],
      confidence: "medium",
      confidenceRationale: "Fake evidence is deterministic and useful for contract validation, not production analysis.",
      limitations: ["No real pi-agent, LLM, source read, or statistical computation was performed."],
      misinterpretationRisks: ["Backend must persist and validate real Evidence before exposing any report to users."],
      actionableRecommendationCount: 1,
    },
    warnings: [],
  };
}
