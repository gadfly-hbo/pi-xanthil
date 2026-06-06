import { existsSync, readFileSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";
import type { PiEvent } from "./types.ts";

export interface SkillActivationEvidence {
  kind: "output_keyword" | "event_path";
  skillPath: string;
  value: string;
}

export interface SkillActivationResult {
  activated: boolean;
  matchedKeywords: string[];
  matchedSkillPaths: string[];
  evidence: SkillActivationEvidence[];
}

export function detectSkillActivation(input: {
  skillPaths: string[];
  output: string;
  events?: PiEvent[];
}): SkillActivationResult {
  const output = input.output.toLowerCase();
  const matchedKeywords = new Set<string>();
  const matchedSkillPaths = new Set<string>();
  const evidence: SkillActivationEvidence[] = [];
  const eventText = (input.events ?? []).map((event) => JSON.stringify(event)).join("\n");

  for (const skillPath of input.skillPaths) {
    const keywords = extractSkillActivationKeywords(skillPath);
    for (const keyword of keywords) {
      if (!keyword) continue;
      if (output.includes(keyword.toLowerCase())) {
        matchedKeywords.add(keyword);
        evidence.push({ kind: "output_keyword", skillPath, value: keyword });
      }
    }
    if (eventText.includes(skillPath) || eventText.includes(resolve(skillPath))) {
      matchedSkillPaths.add(skillPath);
      evidence.push({ kind: "event_path", skillPath, value: skillPath });
    }
  }

  return {
    activated: matchedKeywords.size > 0 || matchedSkillPaths.size > 0,
    matchedKeywords: Array.from(matchedKeywords),
    matchedSkillPaths: Array.from(matchedSkillPaths),
    evidence,
  };
}

export function extractSkillActivationKeywords(skillPath: string): string[] {
  const keywords = new Set<string>();
  keywords.add(slugToWords(basename(dirname(skillPath))));
  keywords.add(basename(dirname(skillPath)));
  if (!existsSync(skillPath)) return cleanKeywords(keywords);

  try {
    const content = readFileSync(skillPath, "utf8");
    const frontmatter = parseFrontmatter(content);
    addKeywordValue(keywords, frontmatter.name);
    addKeywordValue(keywords, frontmatter.description);
    for (const match of content.matchAll(/\b[a-zA-Z][a-zA-Z0-9_-]{3,}\b/g)) {
      addKeywordValue(keywords, match[0]);
    }
    for (const match of content.matchAll(/[\u4e00-\u9fff]{2,12}/g)) {
      addKeywordValue(keywords, match[0]);
    }
  } catch {
    // Keep activation detection best-effort; unavailable skill files should not
    // fail an evaluation run.
  }
  return cleanKeywords(keywords);
}

function parseFrontmatter(content: string): Record<string, string> {
  if (!content.startsWith("---")) return {};
  const end = content.indexOf("\n---", 3);
  if (end < 0) return {};
  const values: Record<string, string> = {};
  for (const line of content.slice(3, end).split(/\r?\n/)) {
    const match = line.match(/^([a-zA-Z0-9_-]+):\s*(.*)$/);
    if (!match?.[1]) continue;
    values[match[1]] = unquote(match[2] ?? "");
  }
  return values;
}

function unquote(value: string): string {
  const trimmed = value.trim();
  if (
    trimmed.length >= 2
    && ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'")))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function slugToWords(value: string): string {
  return value.replace(/[-_]+/g, " ").trim();
}

function addKeywordValue(keywords: Set<string>, value: string | undefined): void {
  if (!value) return;
  const trimmed = value.trim();
  if (!trimmed) return;
  keywords.add(trimmed);
}

function cleanKeywords(values: Set<string>): string[] {
  const out: string[] = [];
  for (const value of values) {
    const trimmed = value.trim();
    if (trimmed.length < 2) continue;
    if (/^(name|description|when|using|skill|markdown|content|frontmatter)$/i.test(trimmed)) continue;
    if (!out.includes(trimmed)) out.push(trimmed);
  }
  return out.slice(0, 80);
}
