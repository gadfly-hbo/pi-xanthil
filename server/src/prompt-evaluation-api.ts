import type { PromptAttackKind, PromptEvalTask, PromptVariant } from "./types.ts";

const ATTACK_KINDS: PromptAttackKind[] = ["ignore-instructions", "privilege-escalation", "exfiltration", "jailbreak"];

export interface PromptEvaluationRunRequest {
  model: string;
  repeat: number;
  judgeRepeat: number;
  variants: PromptVariant[];
  tasks: PromptEvalTask[];
  dataContextPaths?: string[];
}

export type ParsedPromptEvaluationRunRequest =
  | { ok: true; value: PromptEvaluationRunRequest }
  | { ok: false; error: string };

export function parsePromptEvaluationRunRequest(body: unknown): ParsedPromptEvaluationRunRequest {
  const raw = typeof body === "object" && body !== null ? body as Record<string, unknown> : {};
  const model = String(raw.model ?? "").trim();
  const repeat = Number(raw.repeat ?? 1);
  const judgeRepeat = Number(raw.judgeRepeat ?? 1);
  const variants = parseVariants(raw.variants);
  const tasks = parseTasks(raw.tasks);
  const dataContextPaths = Array.isArray(raw.dataContextPaths)
    ? raw.dataContextPaths.filter((path): path is string => typeof path === "string" && path.trim().length > 0).map((path) => path.trim())
    : undefined;

  if (!Number.isInteger(repeat) || repeat < 1 || repeat > 5) {
    return { ok: false, error: "repeat must be an integer between 1 and 5" };
  }
  if (!Number.isInteger(judgeRepeat) || judgeRepeat < 1 || judgeRepeat > 5) {
    return { ok: false, error: "judgeRepeat must be an integer between 1 and 5" };
  }
  if (variants.length === 0) return { ok: false, error: "variants must not be empty" };
  if (tasks.length === 0) return { ok: false, error: "tasks must not be empty" };
  return { ok: true, value: { model, repeat, judgeRepeat, variants, tasks, dataContextPaths } };
}

function parseVariants(value: unknown): PromptVariant[] {
  if (!Array.isArray(value)) return [];
  const variants: PromptVariant[] = [];
  const seen = new Set<string>();
  for (const [index, item] of value.entries()) {
    if (typeof item !== "object" || item === null) continue;
    const raw = item as Record<string, unknown>;
    const id = String(raw.id ?? `variant_${index + 1}`).trim();
    if (!id || seen.has(id)) continue;
    const promptBody = String(raw.promptBody ?? "").trim();
    const role = raw.role === "system" || raw.role === "prefix" ? raw.role : null;
    if (!promptBody || !role) continue;
    const label = String(raw.label ?? id).trim() || id;
    const templateId = typeof raw.templateId === "string" && raw.templateId.trim() ? raw.templateId.trim() : undefined;
    seen.add(id);
    variants.push({ id, label, promptBody, role, templateId });
  }
  return variants;
}

function parseTasks(value: unknown): PromptEvalTask[] {
  if (!Array.isArray(value)) return [];
  const tasks: PromptEvalTask[] = [];
  const seen = new Set<string>();
  for (const [index, item] of value.entries()) {
    if (typeof item !== "object" || item === null) continue;
    const raw = item as Record<string, unknown>;
    const id = String(raw.id ?? `task_${index + 1}`).trim();
    if (!id || seen.has(id)) continue;
    const prompt = String(raw.prompt ?? "").trim();
    if (!prompt) continue;
    const expectedPoints = Array.isArray(raw.expectedPoints)
      ? raw.expectedPoints.filter((point): point is string => typeof point === "string" && point.trim().length > 0).map((point) => point.trim())
      : undefined;
    const rubric = typeof raw.rubric === "string" && raw.rubric.trim() ? raw.rubric.trim() : undefined;
    const mustResist = raw.mustResist === true ? true : undefined;
    const attackKind = ATTACK_KINDS.includes(raw.attackKind as PromptAttackKind) ? (raw.attackKind as PromptAttackKind) : undefined;
    seen.add(id);
    tasks.push({ id, prompt, expectedPoints, rubric, mustResist, attackKind });
  }
  return tasks;
}
