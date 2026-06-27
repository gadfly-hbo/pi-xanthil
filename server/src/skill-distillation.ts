// Distill a completed pi conversation into a reusable SKILL.md, following the
// A(deconstruct) -> B(abstract) -> C(write) pipeline from
// ~/.pi/agent/prompts/skill-distillation-prompts.md, collapsed into a single
// LLM call. The exploration data-safety contract does NOT apply here: skill
// distillation operates on the chat transcript (which is already LLM-visible),
// not on raw data files.

export const SKILL_DISTILL_SYSTEM_PROMPT =
  "你是一位方法论提炼专家，擅长把单次数据分析任务蒸馏为可复用的通用 Skill。"
  + "你严格遵循「用变量替换常量」的原则：过程是特定的，方法是通用的。"
  + "所有输出使用简体中文，仅代码、变量名、frontmatter 字段名和技术缩写保留英文。"
  + "只输出 SKILL.md 文件内容本身，不要任何额外解释或代码围栏。";

// 基于用户的「修改说明」对现有 SKILL.md 做最小必要修改（方式2：AI 改写）。
export const SKILL_REVISE_SYSTEM_PROMPT =
  "你是 SKILL.md 编辑助手。基于用户的修改说明，对给定的 SKILL.md 做最小必要修改，保持其余内容、结构、章节与写作风格不变，不要重写或删减无关部分。"
  + "保留 frontmatter 的 name 字段不变（除非用户明确要求改名）；description 仅在与本次修改相关时调整。"
  + "所有输出使用简体中文，仅代码、变量名、frontmatter 字段名和技术缩写保留英文。"
  + "只输出修改后的完整 SKILL.md 文件内容本身，不要任何额外解释或代码围栏。";

export function buildSkillRevisionPrompt(currentContent: string, instruction: string): string {
  return `下面是一份现有的 SKILL.md，请根据「修改说明」对它做修改，输出修改后的完整 SKILL.md。

【现有 SKILL.md】
${currentContent}

【修改说明】
${instruction}

【要求】
- 只做修改说明涉及的改动，其余内容/结构/章节保持原样，不要重写或删减无关部分。
- 保持 frontmatter 格式（首行 ---，含 name 与 description）；除非修改说明明确要求，不改 name。
- 沿用原有写作风格（祈使句、{变量名}、判断树、表格等）。
- 直接输出完整 SKILL.md，第一行必须是 ---，不要任何前后缀文字或代码围栏。`;
}

export function buildSkillDistillationPrompt(transcript: string): string {
  return `下面是我与 pi 完成的一次数据分析任务的完整对话记录。请把这次任务蒸馏为一个可复用的通用 Skill，输出一个标准 SKILL.md 文件。

【任务对话记录】
${transcript}

【提炼方法（内部分三步思考，但只输出最终 SKILL.md）】

第一步 · 案例解构：分离「本次特有（具体数据源/业务背景/结论数字）」与「可复用（步骤骨架 + 关键判断点 + 输入变量槽 + 隐性经验）」。

第二步 · 抽象提炼：
- 去具体化：把所有特定值替换为 {变量名}，SKILL.md 中不得出现具体数字、品牌名、地区名、文件名。
- 加判断树：对每个关键步骤补充「如果{条件A}→{操作X}；如果{条件B}→{操作Y}」的分支逻辑。
- 定适用边界：明确这套方法适用 / 不适用于什么类型的问题。
- 提炼前提条件：使用前数据 / 业务需满足哪些条件。

第三步 · 写作 SKILL.md，必须满足：
1. 开头是 YAML frontmatter，包含 name（英文 kebab-case，如 sales-anomaly-analysis）与 description 两个字段。
2. description 写清楚：什么场景触发、能做什么、不做什么。
3. 正文用 Markdown，步骤用祈使句（"先做X，再做Y"）。
4. 关键判断逻辑用 if/else 或条件分支表达，不写死具体值。
5. 用户每次需要提供的参数用 {变量名} 标注。
6. 必含「关键变量清单」表格，逐个列出正文用到的 {变量名}，格式：
   | 变量名 | 含义 | 典型取值范围 |
   让采纳者一眼看清要填什么、取值大概在什么范围。
7. 若对话记录中确有踩过的坑、不明显但关键的隐性经验，加「常见陷阱与对策」章节，写成「陷阱 → 对策」条目（这是复用价值最高的部分，有就别漏）；若本次任务确实平顺、无坑可总结，则**直接省略此章节**，不要为凑章节硬编陷阱或写"无陷阱"占位。
8. 末尾加「使用示例」章节，展示触发这个 Skill 的典型对话。

【自查（输出前对照，不通过则修正）】
- 无固定值（数字/品牌/地区/文件名）
- 关键步骤都有判断树
- 说清了什么情况不适用
- 需用户填入的参数都用 {变量名} 标注
- description 清晰描述触发场景
- 有「关键变量清单」表格且每个变量都给了典型取值范围
- 若有隐性经验/坑，写成了「常见陷阱与对策」陷阱→对策章节；若确实无坑，未硬编占位

直接输出完整 SKILL.md 内容，第一行必须是 ---（frontmatter 起始），不要任何前后缀文字或代码围栏。`;
}

export interface TraceAction {
  id?: string;
  text: string;
  kind?: "observe" | "plan" | "tool" | "analyze" | "write" | "verify" | "fix";
}

export interface SkillTrace {
  id: string;
  outcome: "success" | "failure";
  actions: TraceAction[];
  failureReason?: string;
}

export interface MicroSkillCandidate {
  id: string;
  name: string;
  description: string;
  actions: string[];
  support: number;
  successSupport: number;
  failureSupport: number;
  diversityKey: string;
  targetedPatch?: string;
}

export interface SkillRelation {
  sourceId: string;
  targetId: string;
  similarity: number;
  decision: "reuse" | "merge" | "keep_diverse";
}

export interface SubSkillDistillationResult {
  candidates: MicroSkillCandidate[];
  relations: SkillRelation[];
}

export interface SubSkillDistillationOptions {
  minSupport?: number;
  maxCandidates?: number;
}

const MIN_MICRO_SKILL_ACTIONS = 2;
const MAX_MICRO_SKILL_ACTIONS = 5;

export function distillSubSkillsFromTraces(
  traces: SkillTrace[],
  options: SubSkillDistillationOptions = {},
): SubSkillDistillationResult {
  const minSupport = Math.max(1, Math.floor(options.minSupport ?? 1));
  const maxCandidates = Math.max(1, Math.floor(options.maxCandidates ?? 12));
  const buckets = new Map<string, {
    actions: string[];
    traceIds: Set<string>;
    successTraceIds: Set<string>;
    failureTraceIds: Set<string>;
    failureReasons: string[];
  }>();

  for (const trace of traces) {
    const normalizedActions = trace.actions.map((action) => normalizeTraceAction(action.text)).filter(Boolean);
    const seenInTrace = new Set<string>();
    for (let start = 0; start < normalizedActions.length; start += 1) {
      for (let length = MIN_MICRO_SKILL_ACTIONS; length <= MAX_MICRO_SKILL_ACTIONS; length += 1) {
        const slice = normalizedActions.slice(start, start + length);
        if (slice.length < length) continue;
        const key = slice.join(" -> ");
        if (seenInTrace.has(key)) continue;
        seenInTrace.add(key);
        const bucket = buckets.get(key) ?? {
          actions: slice,
          traceIds: new Set<string>(),
          successTraceIds: new Set<string>(),
          failureTraceIds: new Set<string>(),
          failureReasons: [],
        };
        bucket.traceIds.add(trace.id);
        if (trace.outcome === "success") bucket.successTraceIds.add(trace.id);
        else {
          bucket.failureTraceIds.add(trace.id);
          if (trace.failureReason?.trim()) bucket.failureReasons.push(trace.failureReason.trim());
        }
        buckets.set(key, bucket);
      }
    }
  }

  const rawCandidates = [...buckets.entries()]
    .map(([key, bucket]) => ({
      id: `micro-${stableHash(key)}`,
      name: slugifySkillName(bucket.actions.slice(0, 3).join("-")).slice(0, 72),
      description: buildMicroSkillDescription(bucket.actions, bucket.successTraceIds.size, bucket.failureTraceIds.size),
      actions: bucket.actions,
      support: bucket.traceIds.size,
      successSupport: bucket.successTraceIds.size,
      failureSupport: bucket.failureTraceIds.size,
      diversityKey: buildDiversityKey(bucket.actions),
      targetedPatch: buildTargetedPatch(bucket.actions, bucket.failureReasons),
    }))
    .filter((candidate) => candidate.support >= minSupport && candidate.successSupport > 0)
    .sort(compareMicroSkillCandidates);

  const deduped = dedupeSimilarMicroSkills(rawCandidates);
  const diverse = pickDiverseMicroSkills(deduped, maxCandidates);
  const relations = buildSkillRelations(deduped);
  return { candidates: diverse, relations };
}

// Strip accidental markdown code fences / preamble the model may add around the
// SKILL.md body, so the saved file starts cleanly at the YAML frontmatter.
export function extractSkillMarkdown(raw: string): string {
  let text = raw.trim();
  const fence = text.match(/^```(?:markdown|md)?\s*\n([\s\S]*?)\n```$/);
  if (fence?.[1]) text = fence[1].trim();
  const namedStarts = [...text.matchAll(/(?:^|\n)---\s*\nname\s*:/g)];
  if (namedStarts.length > 0) {
    const start = namedStarts[namedStarts.length - 1]!.index ?? 0;
    text = text.slice(text[start] === "\n" ? start + 1 : start).trim();
    return text.endsWith("\n") ? text : `${text}\n`;
  }
  const candidates: string[] = [];
  const frontmatter = /(?:^|\n)---\s*\n([\s\S]*?)\n---/g;
  for (const match of text.matchAll(frontmatter)) {
    if (match[1]?.includes("```")) continue;
    const start = match.index ?? 0;
    const candidate = text.slice(text[start] === "\n" ? start + 1 : start).trim();
    if (parseSkillName(candidate) && parseSkillDescription(candidate)) candidates.push(candidate);
  }
  if (candidates.length > 0) text = candidates[candidates.length - 1]!;
  else {
    const fmStart = text.indexOf("---");
    if (fmStart > 0) text = text.slice(fmStart);
  }
  return text.endsWith("\n") ? text : `${text}\n`;
}

// Read the `name:` field from a SKILL.md frontmatter, if present.
export function parseSkillName(content: string): string | undefined {
  const match = content.match(/^---\s*\n([\s\S]*?)\n---/);
  if (!match?.[1]) return undefined;
  const nameLine = match[1].split("\n").find((line) => /^name\s*:/.test(line));
  if (!nameLine) return undefined;
  const value = nameLine.replace(/^name\s*:/, "").trim().replace(/^["']|["']$/g, "");
  return value || undefined;
}

function parseSkillDescription(content: string): string | undefined {
  const match = content.match(/^---\s*\n([\s\S]*?)\n---/);
  if (!match?.[1]) return undefined;
  const descriptionLine = match[1].split("\n").find((line) => /^description\s*:/.test(line));
  if (!descriptionLine) return undefined;
  const value = descriptionLine.replace(/^description\s*:/, "").trim().replace(/^["']|["']$/g, "");
  return value || undefined;
}

// Turn a free-form name into a safe directory slug for <root>/.pi/skills/<slug>/.
export function slugifySkillName(name: string): string {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9一-龥]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || `skill-${Date.now()}`;
}

function normalizeTraceAction(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/`[^`]+`/g, "{code}")
    .replace(/"[^"]+"/g, "{value}")
    .replace(/'[^']+'/g, "{value}")
    .replace(/\b\d+(?:\.\d+)?%?\b/g, "{number}")
    .replace(/[a-f0-9]{8}-[a-f0-9-]{13,}/g, "{id}")
    .replace(/\s+/g, " ")
    .slice(0, 160);
}

function buildMicroSkillDescription(actions: string[], successSupport: number, failureSupport: number): string {
  const summary = actions.join(" -> ");
  const failureClause = failureSupport > 0 ? `，并吸收 ${failureSupport} 条失败轨迹的修正信号` : "";
  return `当任务需要执行「${summary}」这类 ${actions.length} 步连续动作时触发；来自 ${successSupport} 条成功轨迹${failureClause}。`;
}

function buildDiversityKey(actions: string[]): string {
  return actions
    .flatMap((action) => tokenizeForSkillX(action))
    .filter((token) => token.length > 1 && !["the", "and", "with", "from", "this", "that"].includes(token))
    .slice(0, 6)
    .join("|");
}

function buildTargetedPatch(actions: string[], failureReasons: string[]): string | undefined {
  if (failureReasons.length === 0) return undefined;
  const uniqueReasons = [...new Set(failureReasons)].slice(0, 3);
  return [
    `针对动作序列「${actions.join(" -> ")}」的失败补丁：`,
    ...uniqueReasons.map((reason) => `- 若出现「${reason}」，先定位失败步骤，再只修正该步骤输入/判断，不重写整条流程。`),
  ].join("\n");
}

function compareMicroSkillCandidates(a: MicroSkillCandidate, b: MicroSkillCandidate): number {
  const scoreA = (a.successSupport * 2) + a.support - a.failureSupport + Math.min(a.actions.length, MAX_MICRO_SKILL_ACTIONS) * 0.1;
  const scoreB = (b.successSupport * 2) + b.support - b.failureSupport + Math.min(b.actions.length, MAX_MICRO_SKILL_ACTIONS) * 0.1;
  return scoreB - scoreA;
}

function dedupeSimilarMicroSkills(candidates: MicroSkillCandidate[]): MicroSkillCandidate[] {
  const out: MicroSkillCandidate[] = [];
  for (const candidate of candidates) {
    const duplicateIndex = out.findIndex((existing) => microSkillSimilarity(existing, candidate) >= 0.82);
    if (duplicateIndex < 0) {
      out.push(candidate);
      continue;
    }
    const existing = out[duplicateIndex]!;
    if (compareMicroSkillCandidates(candidate, existing) < 0) out[duplicateIndex] = mergeMicroSkillCandidates(existing, candidate);
  }
  return out;
}

function mergeMicroSkillCandidates(a: MicroSkillCandidate, b: MicroSkillCandidate): MicroSkillCandidate {
  const winner = compareMicroSkillCandidates(a, b) <= 0 ? a : b;
  const support = Math.max(a.support, b.support);
  const successSupport = Math.max(a.successSupport, b.successSupport);
  const failureSupport = Math.max(a.failureSupport, b.failureSupport);
  const targetedPatch = [a.targetedPatch, b.targetedPatch].filter(Boolean).join("\n") || undefined;
  return { ...winner, support, successSupport, failureSupport, targetedPatch };
}

function pickDiverseMicroSkills(candidates: MicroSkillCandidate[], maxCandidates: number): MicroSkillCandidate[] {
  const selected: MicroSkillCandidate[] = [];
  const remaining = [...candidates];
  while (remaining.length > 0 && selected.length < maxCandidates) {
    const usedFamilies = new Set(selected.map(microSkillFamily));
    const pool = remaining.some((candidate) => !usedFamilies.has(microSkillFamily(candidate)))
      ? remaining.filter((candidate) => !usedFamilies.has(microSkillFamily(candidate)))
      : remaining;
    pool.sort((a, b) => {
      const diversityA = selected.length === 0 ? 1 : 1 - Math.max(...selected.map((item) => microSkillSimilarity(a, item)));
      const diversityB = selected.length === 0 ? 1 : 1 - Math.max(...selected.map((item) => microSkillSimilarity(b, item)));
      const scoreA = a.successSupport + (0.75 * diversityA);
      const scoreB = b.successSupport + (0.75 * diversityB);
      return scoreB - scoreA;
    });
    const next = pool[0]!;
    selected.push(next);
    remaining.splice(remaining.findIndex((candidate) => candidate.id === next.id), 1);
  }
  return selected;
}

function buildSkillRelations(candidates: MicroSkillCandidate[]): SkillRelation[] {
  const relations: SkillRelation[] = [];
  for (let i = 0; i < candidates.length; i += 1) {
    for (let j = i + 1; j < candidates.length; j += 1) {
      const source = candidates[i]!;
      const target = candidates[j]!;
      const similarity = round3(microSkillSimilarity(source, target));
      if (similarity < 0.2) continue;
      relations.push({
        sourceId: source.id,
        targetId: target.id,
        similarity,
        decision: similarity >= 0.82 ? "merge" : similarity >= 0.55 ? "reuse" : "keep_diverse",
      });
    }
  }
  return relations.sort((a, b) => b.similarity - a.similarity);
}

function microSkillSimilarity(a: MicroSkillCandidate, b: MicroSkillCandidate): number {
  return jaccard(new Set(a.actions.flatMap(tokenizeForSkillX)), new Set(b.actions.flatMap(tokenizeForSkillX)));
}

function microSkillFamily(candidate: MicroSkillCandidate): string {
  return tokenizeForSkillX(candidate.actions[0] ?? "").slice(0, 2).join("|") || candidate.diversityKey;
}

function tokenizeForSkillX(text: string): string[] {
  return text.split(/[^a-z0-9一-鿿{}]+/).filter(Boolean);
}

function jaccard(a: Set<string>, b: Set<string>): number {
  const union = new Set([...a, ...b]);
  if (union.size === 0) return 0;
  let intersection = 0;
  for (const item of a) if (b.has(item)) intersection += 1;
  return intersection / union.size;
}

function stableHash(text: string): string {
  let hash = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function round3(value: number): number {
  return Math.round(value * 1000) / 1000;
}
