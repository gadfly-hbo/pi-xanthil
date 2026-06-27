import type { EfcScore } from "@/types";

// 契约 EfcScore{efc,normalized,eta}（X-HARNESS0 单一真源，web 镜像）的前端视图超集：
// 三视角字段来自契约，cRaw/eventCount/difficulty/factors 为 server EfcScoreDetail 回传的实装细节。
export interface EfcScoreView extends EfcScore {
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

export type WithEfc<T> = T & { efc?: EfcScoreView };

export function formatEfc(value: unknown): string {
  const efc = asEfc(value);
  return efc ? efc.efc.toFixed(2) : "-";
}

export function formatEta(value: unknown): string {
  const efc = asEfc(value);
  return efc ? efc.eta.toFixed(4) : "-";
}

export function formatNormalizedEfc(value: unknown): string {
  const efc = asEfc(value);
  return efc ? efc.normalized.toFixed(2) : "-";
}

function asEfc(value: unknown): EfcScoreView | null {
  if (typeof value !== "object" || value === null) return null;
  const efc = (value as { efc?: unknown }).efc;
  if (typeof efc !== "object" || efc === null) return null;
  const rawEfc = (efc as { efc?: unknown }).efc;
  const eta = (efc as { eta?: unknown }).eta;
  const normalizedEfc = (efc as { normalized?: unknown }).normalized;
  const cRaw = (efc as { cRaw?: unknown }).cRaw;
  const eventCount = (efc as { eventCount?: unknown }).eventCount;
  const difficulty = (efc as { difficulty?: unknown }).difficulty;
  const factors = (efc as { factors?: unknown }).factors;
  if (
    typeof rawEfc !== "number"
    || typeof eta !== "number"
    || typeof normalizedEfc !== "number"
    || typeof cRaw !== "number"
    || typeof eventCount !== "number"
    || typeof difficulty !== "number"
    || typeof factors !== "object"
    || factors === null
  ) return null;
  const f = factors as Record<string, unknown>;
  if (
    typeof f.information !== "number"
    || typeof f.validity !== "number"
    || typeof f.relevance !== "number"
    || typeof f.memory !== "number"
  ) return null;
  return {
    efc: rawEfc,
    eta,
    normalized: normalizedEfc,
    cRaw,
    eventCount,
    difficulty,
    factors: {
      information: f.information,
      validity: f.validity,
      relevance: f.relevance,
      memory: f.memory,
    },
  };
}
