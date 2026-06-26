import type { MetricSnapshot, MetricVerification, MetricVerificationHit } from "./types.ts";

const EPSILON_OK = 0.005;
const EPSILON_SUSPECT = 0.2;

interface ParsedNumber {
  value: number;
  percentValue: number | null;
}

const NUMBER_PATTERN = /[-+]?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?\s*(?:百分比|%|万|亿)?/g;

function normalizeToken(token: string): ParsedNumber | null {
  const trimmed = token.trim();
  const match = trimmed.match(/^([-+]?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?)\s*(百分比|%|万|亿)?$/);
  if (!match) return null;
  const raw = Number(match[1]!.replace(/,/g, ""));
  if (!Number.isFinite(raw)) return null;
  const unit = match[2];
  if (unit === "万") return { value: raw * 10_000, percentValue: null };
  if (unit === "亿") return { value: raw * 100_000_000, percentValue: null };
  if (unit === "%" || unit === "百分比") return { value: raw, percentValue: raw / 100 };
  return { value: raw, percentValue: null };
}

function extractNumbers(text: string): ParsedNumber[] {
  const out: ParsedNumber[] = [];
  for (const match of text.matchAll(NUMBER_PATTERN)) {
    const parsed = normalizeToken(match[0]);
    if (parsed) out.push(parsed);
  }
  return out;
}

function relativeDiff(expected: number, actual: number): number {
  if (expected === actual) return 0;
  const denominator = Math.max(Math.abs(expected), Number.EPSILON);
  return Math.abs(actual - expected) / denominator;
}

function sameMagnitude(expected: number, actual: number): boolean {
  if (expected === 0 || actual === 0) return true;
  const ratio = Math.abs(actual / expected);
  return ratio >= 0.1 && ratio <= 10;
}

function candidateValues(parsed: ParsedNumber, expected: number): number[] {
  if (parsed.percentValue === null) return [parsed.value];
  const regularDiff = relativeDiff(expected, parsed.value);
  const percentDiff = relativeDiff(expected, parsed.percentValue);
  return percentDiff < regularDiff ? [parsed.percentValue, parsed.value] : [parsed.value, parsed.percentValue];
}

function verifyOne(snapshot: MetricSnapshot, parsedNumbers: ParsedNumber[]): MetricVerificationHit {
  let bestMatch: { value: number; diff: number } | null = null;
  let bestSuspect: { value: number; diff: number } | null = null;

  for (const parsed of parsedNumbers) {
    for (const actual of candidateValues(parsed, snapshot.value)) {
      const diff = relativeDiff(snapshot.value, actual);
      if (diff <= EPSILON_OK) {
        if (!bestMatch || diff < bestMatch.diff) bestMatch = { value: actual, diff };
      } else if (diff <= EPSILON_SUSPECT && sameMagnitude(snapshot.value, actual)) {
        if (!bestSuspect || diff < bestSuspect.diff) bestSuspect = { value: actual, diff };
      }
    }
  }

  if (bestMatch) {
    return {
      name: snapshot.name,
      expected: snapshot.value,
      foundInText: bestMatch.value,
      status: "matched",
      relDiff: bestMatch.diff,
    };
  }
  if (bestSuspect) {
    return {
      name: snapshot.name,
      expected: snapshot.value,
      foundInText: bestSuspect.value,
      status: "suspect",
      relDiff: bestSuspect.diff,
    };
  }
  return {
    name: snapshot.name,
    expected: snapshot.value,
    foundInText: null,
    status: "unreferenced",
    relDiff: null,
  };
}

export function verifyMetricUsage(snapshots: MetricSnapshot[], answerText: string): MetricVerification {
  const parsedNumbers = extractNumbers(answerText);
  const hits = snapshots.map((snapshot) => verifyOne(snapshot, parsedNumbers));
  return {
    verdict: hits.some((hit) => hit.status === "suspect") ? "mismatch" : "ok",
    hits,
  };
}
