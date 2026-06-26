import { verifyMetricUsage } from "./metric-verification.ts";
import { flowMessageText } from "./message-text.ts";
import type { MetricSnapshot, MetricVerification, PiEvent, PiMessage } from "./types.ts";

const SNAPSHOT_MARKER = "MetricSnapshot";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function coerceMetricSnapshot(value: unknown): MetricSnapshot | null {
  if (!isRecord(value)) return null;
  if (typeof value.name !== "string") return null;
  if (typeof value.value !== "number" || !Number.isFinite(value.value)) return null;
  if (typeof value.period !== "string") return null;
  if (value.status !== "normal" && value.status !== "warning" && value.status !== "alert") return null;
  if (value.source !== "extraction_tool" && value.source !== "bi_aggregation") return null;
  const snapshot: MetricSnapshot = {
    name: value.name,
    value: value.value,
    period: value.period,
    status: value.status,
    source: value.source,
  };
  if (typeof value.unit === "string") snapshot.unit = value.unit;
  if (Array.isArray(value.comparisons)) snapshot.comparisons = value.comparisons as MetricSnapshot["comparisons"];
  if (typeof value.thresholdNote === "string") snapshot.thresholdNote = value.thresholdNote;
  return snapshot;
}

function coerceMetricSnapshots(value: unknown): MetricSnapshot[] {
  if (!Array.isArray(value)) return [];
  const snapshots = value.map(coerceMetricSnapshot).filter((item): item is MetricSnapshot => item !== null);
  return snapshots.length === value.length ? snapshots : [];
}

function findJsonArrayEnd(text: string, start: number): number {
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (ch === "\\") {
        escaped = true;
      } else if (ch === "\"") {
        inString = false;
      }
      continue;
    }
    if (ch === "\"") {
      inString = true;
    } else if (ch === "[") {
      depth++;
    } else if (ch === "]") {
      depth--;
      if (depth === 0) return i + 1;
    }
  }
  return -1;
}

function extractSnapshotsFromText(text: string): MetricSnapshot[] {
  if (!text.includes(SNAPSHOT_MARKER)) return [];
  const out: MetricSnapshot[] = [];
  for (let i = 0; i < text.length; i++) {
    if (text[i] !== "[") continue;
    const next = text.slice(i + 1).match(/\S/);
    if (!next || next[0] !== "{") continue;
    const end = findJsonArrayEnd(text, i);
    if (end < 0) continue;
    try {
      out.push(...coerceMetricSnapshots(JSON.parse(text.slice(i, end))));
    } catch {
      // Ignore non-JSON bracketed text; this is a best-effort verifier.
    }
    i = end - 1;
  }
  return out;
}

function extractSnapshotsDeep(value: unknown): MetricSnapshot[] {
  if (typeof value === "string") return extractSnapshotsFromText(value);
  const direct = coerceMetricSnapshots(value);
  if (direct.length > 0) return direct;
  if (Array.isArray(value)) return value.flatMap(extractSnapshotsDeep);
  if (!isRecord(value)) return [];
  const out: MetricSnapshot[] = [];
  if (Array.isArray(value.metricSnapshots)) out.push(...coerceMetricSnapshots(value.metricSnapshots));
  if (typeof value.text === "string") out.push(...extractSnapshotsFromText(value.text));
  if (typeof value.content === "string") out.push(...extractSnapshotsFromText(value.content));
  if (Array.isArray(value.content)) out.push(...value.content.flatMap(extractSnapshotsDeep));
  if (Array.isArray(value.toolResults)) out.push(...value.toolResults.flatMap(extractSnapshotsDeep));
  return out;
}

function dedupeSnapshots(snapshots: MetricSnapshot[]): MetricSnapshot[] {
  const seen = new Set<string>();
  const out: MetricSnapshot[] = [];
  for (const snapshot of snapshots) {
    const key = `${snapshot.source}\u0000${snapshot.period}\u0000${snapshot.name}\u0000${snapshot.value}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(snapshot);
  }
  return out;
}

export function collectMetricSnapshotsFromEvent(event: PiEvent): MetricSnapshot[] {
  if (event.type === "tool_result" || event.type === "turn_end") {
    return dedupeSnapshots(extractSnapshotsDeep(event));
  }
  return [];
}

export function appendMetricVerificationBlock(message: PiMessage, snapshots: MetricSnapshot[]): PiMessage {
  if (message.role !== "assistant" || snapshots.length === 0 || message.errorMessage) return message;
  const answerText = flowMessageText(message.content);
  if (!answerText.trim()) return message;
  const verification = verifyMetricUsage(dedupeSnapshots(snapshots), answerText);
  if (verification.verdict !== "mismatch") return message;
  const block: { type: "metric_verification"; verification: MetricVerification } = {
    type: "metric_verification",
    verification,
  };
  return {
    ...message,
    content: [...message.content, block],
  };
}
