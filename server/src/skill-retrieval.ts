import { readFileSync } from "node:fs";
import { listSkills } from "./skills.ts";
import type { RetrievedSkill } from "./types.ts";

const K1 = 1.5;
const B = 0.75;
const SEARCHABLE_BODY_MAX_CHARS = 2400;

function tokenize(text: string): string[] {
  return text.toLowerCase().split(/[^a-z0-9一-鿿]+/).filter(Boolean);
}

function buildFreqMap(tokens: string[]): Map<string, number> {
  const freq = new Map<string, number>();
  for (const t of tokens) freq.set(t, (freq.get(t) ?? 0) + 1);
  return freq;
}

function bm25Score(queryTokens: string[], docFreq: Map<string, number>, docLen: number, avgDocLen: number, idfMap: Map<string, number>): number {
  let score = 0;
  for (const qt of queryTokens) {
    const tf = docFreq.get(qt) ?? 0;
    if (tf === 0) continue;
    const idf = idfMap.get(qt) ?? 0;
    score += idf * (tf * (K1 + 1)) / (tf + K1 * (1 - B + B * (docLen / avgDocLen)));
  }
  return score;
}

function extractSnippet(content: string, queryTokens: Set<string>, maxLen = 120): string {
  const lines = content.split("\n");
  for (const line of lines) {
    const lower = line.toLowerCase();
    if (queryTokens.size > 0 && [...queryTokens].some((t) => lower.includes(t))) {
      return line.trim().slice(0, maxLen);
    }
  }
  return content.slice(0, maxLen).replace(/\n/g, " ").trim();
}

function stripFrontmatter(content: string): string {
  if (!content.startsWith("---")) return content;
  const end = content.indexOf("\n---", 3);
  if (end < 0) return content;
  return content.slice(end + "\n---".length);
}

function buildSkillSearchContent(description: string, content: string): string {
  const bodySummary = stripFrontmatter(content)
    .replace(/\r\n/g, "\n")
    .trim()
    .slice(0, SEARCHABLE_BODY_MAX_CHARS);
  return [description, bodySummary].filter((part) => part.trim().length > 0).join("\n\n");
}

export interface SkillSimilarityDocument {
  id: string;
  name: string;
  content: string;
}

export interface SkillSimilarityResult {
  id: string;
  name: string;
  score: number;
  snippet: string;
}

export function rankSkillSimilarity(query: string, documents: SkillSimilarityDocument[], topK = 5): SkillSimilarityResult[] {
  const queryTokens = tokenize(query);
  if (queryTokens.length === 0 || documents.length === 0) return [];

  type Doc = SkillSimilarityDocument & { tokens: string[]; freq: Map<string, number> };
  const docs: Doc[] = documents.map((doc) => {
    const tokens = tokenize(`${doc.name} ${doc.content}`);
    return { ...doc, tokens, freq: buildFreqMap(tokens) };
  }).filter((doc) => doc.tokens.length > 0);
  if (docs.length === 0) return [];

  const avgDocLen = docs.reduce((sum, d) => sum + d.tokens.length, 0) / docs.length;
  const idfMap = buildIdfMap(queryTokens, docs.map((doc) => doc.freq));
  const querySet = new Set(queryTokens);
  return docs
    .map((doc) => ({
      id: doc.id,
      name: doc.name,
      score: bm25Score(queryTokens, doc.freq, doc.tokens.length, avgDocLen, idfMap),
      snippet: extractSnippet(doc.content, querySet),
    }))
    .filter((result) => result.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);
}

export function retrieveSkills(query: string, workspaceRoot: string, topK = 5): RetrievedSkill[] {
  const skills = listSkills(workspaceRoot).filter((s) => s.available);
  if (skills.length === 0) return [];

  type Doc = { path: string; name: string; content: string; tokens: string[]; freq: Map<string, number> };
  const docs: Doc[] = [];

  for (const skill of skills) {
    try {
      const content = readFileSync(skill.path, "utf8");
      const searchableContent = buildSkillSearchContent(skill.description, content);
      const tokens = tokenize(`${skill.name} ${searchableContent}`);
      docs.push({ path: skill.path, name: skill.name, content: searchableContent, tokens, freq: buildFreqMap(tokens) });
    } catch {
      // skip unreadable skills
    }
  }

  if (docs.length === 0) return [];

  const queryTokens = tokenize(query);
  if (queryTokens.length === 0) return [];

  const avgDocLen = docs.reduce((sum, d) => sum + d.tokens.length, 0) / docs.length;
  const N = docs.length;

  const idfMap = buildIdfMap(queryTokens, docs.map((doc) => doc.freq));

  const querySet = new Set(queryTokens);
  const scored = docs.map((d) => ({
    path: d.path,
    name: d.name,
    score: bm25Score(queryTokens, d.freq, d.tokens.length, avgDocLen, idfMap),
    snippet: extractSnippet(d.content, querySet),
  }));

  return scored
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);
}

function buildIdfMap(queryTokens: string[], freqs: Array<Map<string, number>>): Map<string, number> {
  const idfMap = new Map<string, number>();
  const N = freqs.length;
  for (const qt of queryTokens) {
    const df = freqs.filter((freq) => freq.has(qt)).length;
    idfMap.set(qt, Math.log((N - df + 0.5) / (df + 0.5) + 1));
  }
  return idfMap;
}
