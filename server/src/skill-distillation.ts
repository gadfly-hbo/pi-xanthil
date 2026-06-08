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
6. 末尾加「使用示例」章节，展示触发这个 Skill 的典型对话。

【自查（输出前对照，不通过则修正）】
- 无固定值（数字/品牌/地区/文件名）
- 关键步骤都有判断树
- 说清了什么情况不适用
- 需用户填入的参数都用 {变量名} 标注
- description 清晰描述触发场景

直接输出完整 SKILL.md 内容，第一行必须是 ---（frontmatter 起始），不要任何前后缀文字或代码围栏。`;
}

// Strip accidental markdown code fences / preamble the model may add around the
// SKILL.md body, so the saved file starts cleanly at the YAML frontmatter.
export function extractSkillMarkdown(raw: string): string {
  let text = raw.trim();
  const fence = text.match(/^```(?:markdown|md)?\s*\n([\s\S]*?)\n```$/);
  if (fence?.[1]) text = fence[1].trim();
  const fmStart = text.indexOf("---");
  if (fmStart > 0) text = text.slice(fmStart);
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

// Turn a free-form name into a safe directory slug for <root>/.pi/skills/<slug>/.
export function slugifySkillName(name: string): string {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9一-龥]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || `skill-${Date.now()}`;
}
