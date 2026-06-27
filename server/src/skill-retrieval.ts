import { basename } from "node:path";
import { readFileSync } from "node:fs";
import { listSkills } from "./skills.ts";
import type { RetrievedSkill } from "./types.ts";

const K1 = 1.5;
const B = 0.75;
const SEARCHABLE_BODY_MAX_CHARS = 2400;
const ROUTING_BODY_MAX_CHARS = 12000;
const DEFAULT_DYNAMIC_MAX_SKILLS = 3;
const DEFAULT_DYNAMIC_MIN_SCORE = 0.55;

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

function buildSkillRoutingContent(content: string): string {
  return stripFrontmatter(content).replace(/\r\n/g, "\n").trim().slice(0, ROUTING_BODY_MAX_CHARS);
}

function parseFrontmatterField(content: string, field: string): string | undefined {
  const match = content.match(/^---\s*\n([\s\S]*?)\n---/);
  if (!match?.[1]) return undefined;
  const escaped = field.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const line = match[1].split("\n").find((item) => new RegExp(`^${escaped}\\s*:`).test(item));
  if (!line) return undefined;
  const value = line.replace(new RegExp(`^${escaped}\\s*:`), "").trim().replace(/^["']|["']$/g, "");
  return value || undefined;
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

export interface DynamicSkillCandidate {
  path: string;
  name: string;
  description: string;
  content: string;
  utilityHint?: number;
}

export interface DynamicSkillSelection {
  path: string;
  name: string;
  score: number;
  semanticScore: number;
  utilityScore: number;
  diversityScore: number;
  snippet: string;
  scope: string;
}

export interface DynamicSkillInjectionPlan {
  selected: DynamicSkillSelection[];
  rejected: DynamicSkillSelection[];
  renderHint: string;
  estimatedTokenChars: { before: number; after: number; saved: number };
}

export interface DynamicSkillInjectionOptions {
  maxSkills?: number;
  minNormalizedScore?: number;
  utilityByPath?: Record<string, number>;
}

export function loadDynamicSkillCandidates(skillPaths: string[], options: { utilityByPath?: Record<string, number> } = {}): DynamicSkillCandidate[] {
  const candidates: DynamicSkillCandidate[] = [];
  const seen = new Set<string>();
  for (const path of skillPaths) {
    if (seen.has(path)) continue;
    seen.add(path);
    try {
      const raw = readFileSync(path, "utf8");
      const name = parseFrontmatterField(raw, "name") ?? basename(path);
      const description = parseFrontmatterField(raw, "description") ?? "";
      candidates.push({
        path,
        name,
        description,
        content: raw,
        utilityHint: options.utilityByPath?.[path],
      });
    } catch {
      // Dynamic routing needs the full body. Unreadable paths are ignored by
      // the router; callers may fall back to the original explicit path list.
    }
  }
  return candidates;
}

export function planDynamicSkillInjection(
  task: string,
  candidates: DynamicSkillCandidate[],
  options: DynamicSkillInjectionOptions = {},
): DynamicSkillInjectionPlan {
  if (candidates.length === 0 || !task.trim()) {
    return { selected: [], rejected: [], renderHint: "", estimatedTokenChars: { before: 0, after: 0, saved: 0 } };
  }
  const maxSkills = Math.max(1, Math.floor(options.maxSkills ?? DEFAULT_DYNAMIC_MAX_SKILLS));
  const minNormalizedScore = clamp01(options.minNormalizedScore ?? DEFAULT_DYNAMIC_MIN_SCORE);
  const queryTokens = tokenize(task);
  if (queryTokens.length === 0) {
    return { selected: [], rejected: [], renderHint: "", estimatedTokenChars: { before: totalCandidateChars(candidates), after: 0, saved: totalCandidateChars(candidates) } };
  }

  type Doc = DynamicSkillCandidate & { routingContent: string; tokens: string[]; freq: Map<string, number> };
  const docs: Doc[] = candidates.map((candidate) => {
    const routingContent = [
      candidate.name,
      candidate.description,
      buildSkillRoutingContent(candidate.content),
    ].filter(Boolean).join("\n\n");
    const tokens = tokenize(routingContent);
    return { ...candidate, routingContent, tokens, freq: buildFreqMap(tokens) };
  }).filter((doc) => doc.tokens.length > 0);
  if (docs.length === 0) {
    return { selected: [], rejected: [], renderHint: "", estimatedTokenChars: { before: totalCandidateChars(candidates), after: 0, saved: totalCandidateChars(candidates) } };
  }

  const avgDocLen = docs.reduce((sum, doc) => sum + doc.tokens.length, 0) / docs.length;
  const idfMap = buildIdfMap(queryTokens, docs.map((doc) => doc.freq));
  const querySet = new Set(queryTokens);
  const rawSemantic = docs.map((doc) => bm25Score(queryTokens, doc.freq, doc.tokens.length, avgDocLen, idfMap));
  const maxSemantic = Math.max(...rawSemantic, 0);
  const baseSelections = docs.map((doc, index) => {
    const semanticScore = maxSemantic > 0 ? rawSemantic[index]! / maxSemantic : 0;
    const utilityScore = clamp01(options.utilityByPath?.[doc.path] ?? doc.utilityHint ?? 0.5);
    return {
      path: doc.path,
      name: doc.name,
      score: 0,
      semanticScore,
      utilityScore,
      diversityScore: 1,
      snippet: extractSnippet(doc.routingContent, querySet, 160),
      scope: "",
      doc,
    };
  }).filter((item) => item.semanticScore > 0 || item.utilityScore > 0.65);

  const selected: Array<(typeof baseSelections)[number]> = [];
  const remaining = [...baseSelections];
  while (remaining.length > 0 && selected.length < maxSkills) {
    for (const item of remaining) {
      item.diversityScore = diversityAgainstSelected(item.doc.tokens, selected.map((selectedItem) => selectedItem.doc.tokens));
      item.score = round3((0.58 * item.utilityScore) + (0.32 * item.semanticScore) + (0.10 * item.diversityScore));
    }
    remaining.sort((a, b) => b.score - a.score);
    const next = remaining.shift()!;
    if (selected.length > 0 && next.score < minNormalizedScore) break;
    if (selected.length === 0 && next.score <= 0) break;
    selected.push(next);
  }

  const selectedPaths = new Set(selected.map((item) => item.path));
  const withScopes = [...selected, ...remaining].map((item) => {
    const neighbors = selected.filter((other) => other.path !== item.path).map((other) => other.name);
    return {
      path: item.path,
      name: item.name,
      score: item.score,
      semanticScore: round3(item.semanticScore),
      utilityScore: round3(item.utilityScore),
      diversityScore: round3(item.diversityScore),
      snippet: item.snippet,
      scope: buildSetAwareScope(item.name, neighbors),
    };
  });
  const selectedFinal = withScopes.filter((item) => selectedPaths.has(item.path));
  const rejected = withScopes.filter((item) => !selectedPaths.has(item.path)).sort((a, b) => b.score - a.score);
  const afterChars = candidates
    .filter((candidate) => selectedPaths.has(candidate.path))
    .reduce((sum, candidate) => sum + candidate.content.length, 0);
  const beforeChars = totalCandidateChars(candidates);
  return {
    selected: selectedFinal,
    rejected,
    renderHint: renderDynamicSkillHint(selectedFinal),
    estimatedTokenChars: { before: beforeChars, after: afterChars, saved: Math.max(0, beforeChars - afterChars) },
  };
}

export function selectDynamicSkillPaths(
  task: string,
  skillPaths: string[],
  options: DynamicSkillInjectionOptions = {},
): { skillPaths: string[]; plan: DynamicSkillInjectionPlan | null } {
  if (skillPaths.length <= (options.maxSkills ?? DEFAULT_DYNAMIC_MAX_SKILLS)) {
    return { skillPaths, plan: null };
  }
  const candidates = loadDynamicSkillCandidates(skillPaths, { utilityByPath: options.utilityByPath });
  if (candidates.length === 0) return { skillPaths, plan: null };
  const plan = planDynamicSkillInjection(task, candidates, options);
  if (plan.selected.length === 0) return { skillPaths, plan };
  return { skillPaths: plan.selected.map((item) => item.path), plan };
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

function totalCandidateChars(candidates: DynamicSkillCandidate[]): number {
  return candidates.reduce((sum, candidate) => sum + candidate.content.length, 0);
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function round3(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function diversityAgainstSelected(tokens: string[], selected: string[][]): number {
  if (selected.length === 0) return 1;
  const tokenSet = new Set(tokens);
  if (tokenSet.size === 0) return 0;
  let maxOverlap = 0;
  for (const other of selected) {
    const otherSet = new Set(other);
    const union = new Set([...tokenSet, ...otherSet]);
    let intersection = 0;
    for (const token of tokenSet) if (otherSet.has(token)) intersection += 1;
    maxOverlap = Math.max(maxOverlap, union.size > 0 ? intersection / union.size : 0);
  }
  return clamp01(1 - maxOverlap);
}

function buildSetAwareScope(name: string, neighbors: string[]): string {
  if (neighbors.length === 0) return "用于当前步骤的主要方法，不承担其他已选 skill 的职责。";
  return `聚焦 ${name} 的独有步骤；与 ${neighbors.join("、")} 重叠时，只保留本 skill 的专属判断点。`;
}

function renderDynamicSkillHint(selected: DynamicSkillSelection[]): string {
  if (selected.length === 0) return "";
  return [
    "运行时只解锁以下与当前步骤最相关的 skill。请按 scope 分工使用，避免重复展开相同方法：",
    ...selected.map((item) => `- ${item.name}: ${item.scope}`),
  ].join("\n");
}
