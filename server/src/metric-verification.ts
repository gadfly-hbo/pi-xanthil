import type { MetricSnapshot, MetricVerification, MetricVerificationHit } from "./types.ts";

const EPSILON_OK = 0.005;
const EPSILON_SUSPECT = 0.2;
const CONTEXT_WINDOW = 60;

interface ParsedNumber {
  value: number;
  percentValue: number | null;
  index: number;
  raw: string;
}

interface NumberMention {
  parsed: ParsedNumber;
  contextBefore: string;
  contextAfter: string;
}

const NUMBER_PATTERN = /[-+]?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?\s*(?:百分比|%|万|亿)?/g;

function isLowRiskNumber(mention: NumberMention): boolean {
  const raw = mention.parsed.raw;
  const before = mention.contextBefore;
  const after = mention.contextAfter;
  if (/^19\d{2}$|^20\d{2}$/.test(raw)) return true;
  if (/第\s*$/.test(before)) return true;
  if (/^\s*[月号日期次轮版季度]/.test(after)) return true;
  if (/^\s*[-.\/]\s*\d{1,2}/.test(after)) return true;
  if (/\d{1,2}\s*[-.\/]\s*$/.test(before)) return true;
  return false;
}

function normalizeToken(token: string): ParsedNumber | null {
  const trimmed = token.trim();
  const match = trimmed.match(/^([-+]?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?)\s*(百分比|%|万|亿)?$/);
  if (!match) return null;
  const raw = Number(match[1]!.replace(/,/g, ""));
  if (!Number.isFinite(raw)) return null;
  const unit = match[2];
  if (unit === "万") return { value: raw * 10_000, percentValue: null, index: 0, raw: trimmed };
  if (unit === "亿") return { value: raw * 100_000_000, percentValue: null, index: 0, raw: trimmed };
  if (unit === "%" || unit === "百分比") return { value: raw, percentValue: raw / 100, index: 0, raw: trimmed };
  return { value: raw, percentValue: null, index: 0, raw: trimmed };
}

function extractNumberMentions(text: string): NumberMention[] {
  const out: NumberMention[] = [];
  for (const match of text.matchAll(NUMBER_PATTERN)) {
    const parsed = normalizeToken(match[0]);
    if (!parsed) continue;
    parsed.index = match.index;
    const start = Math.max(0, match.index - CONTEXT_WINDOW);
    const end = Math.min(text.length, match.index + match[0].length + CONTEXT_WINDOW);
    out.push({
      parsed,
      contextBefore: text.slice(start, match.index),
      contextAfter: text.slice(match.index + match[0].length, end),
    });
  }
  return out;
}

function extractMetricLabels(context: string, snapshots: MetricSnapshot[]): string[] {
  const found: string[] = [];
  for (const s of snapshots) {
    if (context.includes(s.name)) found.push(s.name);
  }
  return found;
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

export function verifyMetricUsage(snapshots: MetricSnapshot[], answerText: string): MetricVerification {
  const mentions = extractNumberMentions(answerText);
  const usedIndices = new Set<number>();
  const hits: MetricVerificationHit[] = [];

  for (const snapshot of snapshots) {
    let bestMatch: { mentionIdx: number; value: number; diff: number } | null = null;
    let bestSuspect: { mentionIdx: number; value: number; diff: number } | null = null;

    for (let i = 0; i < mentions.length; i++) {
      const mention = mentions[i]!;
      for (const actual of candidateValues(mention.parsed, snapshot.value)) {
        const diff = relativeDiff(snapshot.value, actual);
        if (diff <= EPSILON_OK) {
          if (!bestMatch || diff < bestMatch.diff) bestMatch = { mentionIdx: i, value: actual, diff };
        } else if (diff <= EPSILON_SUSPECT && sameMagnitude(snapshot.value, actual)) {
          if (!bestSuspect || diff < bestSuspect.diff) bestSuspect = { mentionIdx: i, value: actual, diff };
        }
      }
    }

    if (bestMatch) {
      usedIndices.add(bestMatch.mentionIdx);
      const mention = mentions[bestMatch.mentionIdx]!;
      const contextLabels = extractMetricLabels(
        mention.contextBefore + mention.contextAfter,
        snapshots,
      );
      if (contextLabels.length > 0 && !contextLabels.includes(snapshot.name)) {
        hits.push({
          name: snapshot.name,
          expected: snapshot.value,
          foundInText: bestMatch.value,
          status: "label_mismatch",
          relDiff: bestMatch.diff,
          contextLabel: contextLabels.join(", "),
        });
      } else {
        hits.push({
          name: snapshot.name,
          expected: snapshot.value,
          foundInText: bestMatch.value,
          status: "matched",
          relDiff: bestMatch.diff,
        });
      }
    } else if (bestSuspect) {
      usedIndices.add(bestSuspect.mentionIdx);
      hits.push({
        name: snapshot.name,
        expected: snapshot.value,
        foundInText: bestSuspect.value,
        status: "suspect",
        relDiff: bestSuspect.diff,
      });
    } else {
      hits.push({
        name: snapshot.name,
        expected: snapshot.value,
        foundInText: null,
        status: "unreferenced",
        relDiff: null,
      });
    }
  }

  for (let i = 0; i < mentions.length; i++) {
    if (usedIndices.has(i)) continue;
    const mention = mentions[i]!;
    if (isLowRiskNumber(mention)) continue;
    if (Math.abs(mention.parsed.value) < 10) continue;
    hits.push({
      name: "（文本中出现的未注册数字）",
      expected: 0,
      foundInText: mention.parsed.value,
      status: "fabricated",
      relDiff: null,
    });
  }

  const verdict = hits.some((hit) =>
    hit.status === "suspect" || hit.status === "fabricated" || hit.status === "label_mismatch",
  ) ? "mismatch" : "ok";

  return { verdict, hits };
}
