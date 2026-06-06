import type { SkillEvalTask, SkillVariant } from "./skill-evaluation-runner.ts";

export interface SkillEvaluationRunRequest {
  model: string;
  repeat: number;
  judgeRepeat: number;
  variants: SkillVariant[];
  tasks: SkillEvalTask[];
  contextPrefix?: string;
  dataContextPaths?: string[];
}

export type ParsedSkillEvaluationRunRequest =
  | { ok: true; value: SkillEvaluationRunRequest }
  | { ok: false; error: string };

export function parseSkillEvaluationRunRequest(body: unknown): ParsedSkillEvaluationRunRequest {
  const raw = typeof body === "object" && body !== null ? body as Record<string, unknown> : {};
  const model = String(raw.model ?? "").trim();
  const repeat = Number(raw.repeat ?? 1);
  const judgeRepeat = Number(raw.judgeRepeat ?? 1);
  const variants = parseVariants(raw.variants);
  const tasks = parseTasks(raw.tasks);
  const contextPrefix = typeof raw.contextPrefix === "string" && raw.contextPrefix.trim()
    ? raw.contextPrefix
    : undefined;
  const dataContextPaths = Array.isArray(raw.dataContextPaths)
    ? raw.dataContextPaths.filter((p): p is string => typeof p === "string" && p.trim().length > 0).map((p) => p.trim())
    : undefined;

  if (!Number.isInteger(repeat) || repeat < 1 || repeat > 5) {
    return { ok: false, error: "repeat must be an integer between 1 and 5" };
  }
  if (!Number.isInteger(judgeRepeat) || judgeRepeat < 1 || judgeRepeat > 5) {
    return { ok: false, error: "judgeRepeat must be an integer between 1 and 5" };
  }
  if (variants.length === 0) return { ok: false, error: "variants must not be empty" };
  if (tasks.length === 0) return { ok: false, error: "tasks must not be empty" };

  return { ok: true, value: { model, repeat, judgeRepeat, variants, tasks, contextPrefix, dataContextPaths } };
}

function parseVariants(value: unknown): SkillVariant[] {
  if (!Array.isArray(value)) return [];
  const variants: SkillVariant[] = [];
  const seen = new Set<string>();
  for (const [index, item] of value.entries()) {
    if (typeof item !== "object" || item === null) continue;
    const raw = item as Record<string, unknown>;
    const id = String(raw.id ?? `variant_${index + 1}`).trim();
    if (!id || seen.has(id)) continue;
    const label = String(raw.label ?? id).trim() || id;
    const skillPaths = Array.isArray(raw.skillPaths)
      ? raw.skillPaths.filter((path): path is string => typeof path === "string" && path.trim().length > 0)
      : [];
    seen.add(id);
    variants.push({ id, label, skillPaths });
  }
  return variants;
}

function parseTasks(value: unknown): SkillEvalTask[] {
  if (!Array.isArray(value)) return [];
  const tasks: SkillEvalTask[] = [];
  const seen = new Set<string>();
  for (const [index, item] of value.entries()) {
    if (typeof item !== "object" || item === null) continue;
    const raw = item as Record<string, unknown>;
    const id = String(raw.id ?? `task_${index + 1}`).trim();
    if (!id || seen.has(id)) continue;
    const prompt = String(raw.prompt ?? "").trim();
    if (!prompt) continue;
    const expectedPoints = Array.isArray(raw.expectedPoints)
      ? raw.expectedPoints.filter((point): point is string => typeof point === "string" && point.trim().length > 0)
      : undefined;
    const rubric = typeof raw.rubric === "string" && raw.rubric.trim() ? raw.rubric.trim() : undefined;
    seen.add(id);
    tasks.push({ id, prompt, expectedPoints, rubric });
  }
  return tasks;
}
