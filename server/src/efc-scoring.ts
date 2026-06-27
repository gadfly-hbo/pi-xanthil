import type { RawComputeUsage } from "./cache.ts";
import { EFC_KAPPA } from "./types.ts";
import type { EfcScore } from "./types.ts";

const TOOL_CALL_TOKEN_WEIGHT = 1000;

export type EfcValidityKind = "passing" | "assertion" | "runtime" | "timeout";
export type EfcMemorySignal = "written" | "changed_plan" | "unknown" | "none";

export interface EfcDifficultyProfile {
  minSteps: number;
  toolAmbiguity: number;
  stateTracking: number;
  observationNoise: number;
  oracleVisibility: number;
}

export interface EfcEventInput {
  status: "success" | "failed";
  validity?: EfcValidityKind;
  hasOutput?: boolean;
  toolCalls?: number;
  memorySignal?: EfcMemorySignal;
  signature?: string;
}

export interface EfcRunLike extends EfcEventInput {
  totalTokens?: number;
}

// 契约 EfcScore{efc,normalized,eta}（X-HARNESS0 单一真源）的 E 域实装超集：
// 仅在此追加 cRaw/eventCount/difficulty/factors 等实装细节，三视角字段一律来自契约。
export interface EfcScoreDetail extends EfcScore {
  cRaw: number;
  eventCount: number;
  difficulty: number;
  factors: {
    information: number;
    validity: number;
    relevance: number;
    memory: number;
  };
}

export function defaultEfcDifficulty(): EfcDifficultyProfile {
  return {
    minSteps: 1,
    toolAmbiguity: 1,
    stateTracking: 1,
    observationNoise: 0,
    oracleVisibility: 0.5,
  };
}

export function coerceEfcDifficulty(value: unknown): EfcDifficultyProfile {
  if (!isRecord(value)) return defaultEfcDifficulty();
  return {
    minSteps: clampPositiveNumber(value.minSteps, 1),
    toolAmbiguity: clampPositiveNumber(value.toolAmbiguity, 1),
    stateTracking: clampPositiveNumber(value.stateTracking, 1),
    observationNoise: clamp01Number(value.observationNoise, 0),
    oracleVisibility: clamp01Number(value.oracleVisibility, 0.5),
  };
}

export function computeDifficulty(profile: EfcDifficultyProfile): number {
  const raw = profile.minSteps
    * profile.toolAmbiguity
    * profile.stateTracking
    * (1 + profile.observationNoise)
    * (1 - profile.oracleVisibility);
  return Math.max(0.001, raw);
}

export function computeRawCompute(raw: RawComputeUsage): number {
  return Math.max(0, raw.totalTokens) + Math.max(0, raw.toolCalls) * TOOL_CALL_TOKEN_WEIGHT;
}

export function scoreEfcEvents(
  events: EfcEventInput[],
  options: { rawCompute: RawComputeUsage; difficulty?: EfcDifficultyProfile },
): EfcScoreDetail {
  const seen = new Set<string>();
  let rawEfc = 0;
  let informationSum = 0;
  let validitySum = 0;
  let relevanceSum = 0;
  let memorySum = 0;

  for (const event of events) {
    const information = scoreInformation(event);
    const validity = scoreValidity(event);
    const relevance = scoreRelevance(event, seen);
    const memory = scoreMemory(event.memorySignal ?? "unknown");
    rawEfc += EFC_KAPPA * information * validity * relevance * memory;
    informationSum += information;
    validitySum += validity;
    relevanceSum += relevance;
    memorySum += memory;
  }

  const eventCount = events.length;
  const difficulty = computeDifficulty(options.difficulty ?? defaultEfcDifficulty());
  const cRaw = computeRawCompute(options.rawCompute);
  return {
    efc: round3(rawEfc),
    normalized: round3(rawEfc / difficulty),
    eta: cRaw > 0 ? round6(rawEfc / cRaw) : 0,
    cRaw,
    eventCount,
    difficulty: round3(difficulty),
    factors: {
      information: round3(eventCount ? informationSum / eventCount : 0),
      validity: round3(eventCount ? validitySum / eventCount : 0),
      relevance: round3(eventCount ? relevanceSum / eventCount : 0),
      memory: round3(eventCount ? memorySum / eventCount : 0),
    },
  };
}

export function scoreEfcRuns(
  rows: EfcRunLike[],
  options: { difficulty?: EfcDifficultyProfile } = {},
): EfcScoreDetail {
  const rawCompute = rows.reduce(
    (acc, row) => ({
      totalTokens: acc.totalTokens + Math.max(0, row.totalTokens ?? 0),
      toolCalls: acc.toolCalls + Math.max(0, row.toolCalls ?? 0),
    }),
    { totalTokens: 0, toolCalls: 0 },
  );
  return scoreEfcEvents(rows, { rawCompute, difficulty: options.difficulty });
}

function scoreInformation(event: EfcEventInput): number {
  if ((event.toolCalls ?? 0) > 0) return 1;
  if (event.hasOutput) return event.status === "success" ? 0.85 : 0.45;
  return event.status === "success" ? 0.55 : 0.3;
}

function scoreValidity(event: EfcEventInput): number {
  if (event.validity === "passing") return 1;
  if (event.validity === "assertion") return 0.42;
  if (event.validity === "runtime") return 0.12;
  if (event.validity === "timeout") return 0.06;
  return event.status === "success" ? 1 : 0.12;
}

function scoreRelevance(event: EfcEventInput, seen: Set<string>): number {
  const signature = event.signature?.trim();
  if (!signature) return 1;
  if (seen.has(signature)) return 0.2;
  seen.add(signature);
  return 1;
}

function scoreMemory(signal: EfcMemorySignal): number {
  if (signal === "written") return 1;
  if (signal === "changed_plan") return 0.75;
  if (signal === "none") return 0.1;
  return 0.5;
}

function clampPositiveNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : fallback;
}

function clamp01Number(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : fallback;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function round3(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function round6(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}
