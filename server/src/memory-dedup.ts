// D-INGEST 语义 dedup · LLM-judge (词法 shortlist 兜底 + 成本门控)
// 仅在 db/data.ts findSemanticDedupShortlist 返回非空时被调用; 失败/超时一律返回 null,
// 兜回词法结果, 绝不阻断 ingest. 走 pi (本地, 隐私不出域), 零新依赖.

import { runPiPrompt } from "./pi-adapter.ts";
import type { MemoryItem } from "./types.ts";

export const DEFAULT_MEMORY_DEDUP_MODEL = "minimax-cn/MiniMax-M3";

export interface SemanticDedupCandidate {
  title: string;
  body: string;
}

export interface JudgeOptions {
  workspaceRoot: string;
  model?: string;
  timeoutMs?: number;
}

export type JudgeFn = (
  candidate: SemanticDedupCandidate,
  shortlist: MemoryItem[],
  opts: JudgeOptions,
) => Promise<string | null>;

const SYSTEM_PROMPT = [
  "你是记忆库 dedup 评审员. 输入一条候选记忆和若干已存在的同类记忆 (shortlist).",
  "判定: 候选是否与 shortlist 中的某一条语义上等价 — 即两者表达同一可复用的经验/约束/事件,",
  "采纳一条即可覆盖另一条. 措辞不同但核心动作/对象/条件一致视为同一条; 主题相邻但行动不同视为不同条.",
  "保守判重: 拿不准就视为不同条 (返回 null), 宁缺勿滥. 仅输出严格 JSON, 形如:",
  '{"match": "<id>"} 或 {"match": null}',
  "不要输出任何额外解释、思考、代码块标记或多余字段.",
].join("\n");

function buildPrompt(candidate: SemanticDedupCandidate, shortlist: MemoryItem[]): string {
  const lines: string[] = [];
  lines.push("候选记忆:");
  lines.push(`title: ${candidate.title}`);
  lines.push(`body: ${candidate.body}`);
  lines.push("");
  lines.push("已存在记忆 shortlist (按词法相关度倒序):");
  for (const item of shortlist) {
    lines.push(`- id: ${item.id}`);
    lines.push(`  title: ${item.title}`);
    lines.push(`  body: ${item.body}`);
  }
  lines.push("");
  lines.push('输出: {"match":"<id>"} 表示候选与该 id 语义等价; {"match":null} 表示无等价项.');
  return lines.join("\n");
}

/**
 * 解析 judge 输出: 容忍前后空白、单层 ```json fences、以及多余文本中提取首个 {...} 块.
 * 返回有效 id 字符串或 null. 不抛错.
 */
function parseJudgeOutput(raw: string, allowedIds: Set<string>): string | null {
  if (!raw) return null;
  let text = raw.trim();
  // 剥离 markdown code fence (```json ... ``` / ``` ... ```)
  text = text.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "").trim();
  // 从文本中抓首个 JSON 对象
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  const slice = text.slice(start, end + 1);
  let parsed: unknown;
  try {
    parsed = JSON.parse(slice);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const m = (parsed as { match?: unknown }).match;
  if (typeof m !== "string") return null;
  if (!allowedIds.has(m)) return null;
  return m;
}

/**
 * judgeSemanticDuplicate: 对候选 vs shortlist 做语义判重.
 * - shortlist 空 -> 直接返回 null (调用方应在 shortlist 空时跳过本函数, 此处再兜一层防御)
 * - 任何抛错/超时/非法输出 -> 返回 null (优雅兜底)
 * - 返回值若非 null, 必定是 shortlist 中某 item.id
 *
 * judgeFn 可注入 (供测试 mock); 默认走 runPiPrompt.
 */
export async function judgeSemanticDuplicate(
  candidate: SemanticDedupCandidate,
  shortlist: MemoryItem[],
  opts: JudgeOptions,
  judgeFn?: JudgeFn,
): Promise<string | null> {
  if (!shortlist || shortlist.length === 0) return null;
  const resolvedOptions = { ...opts, model: opts.model ?? DEFAULT_MEMORY_DEDUP_MODEL };
  if (judgeFn) {
    try {
      return await judgeFn(candidate, shortlist, resolvedOptions);
    } catch (err) {
      console.warn(`[memory-dedup] injected judgeFn threw, falling back to lexical: ${String((err as Error)?.message ?? err)}`);
      return null;
    }
  }
  const allowedIds = new Set(shortlist.map((s) => s.id));
  try {
    const raw = await runPiPrompt({
      workspaceRoot: opts.workspaceRoot,
      text: buildPrompt(candidate, shortlist),
      model: resolvedOptions.model,
      systemPrompt: SYSTEM_PROMPT,
      timeoutMs: opts.timeoutMs ?? 15_000,
    });
    return parseJudgeOutput(raw, allowedIds);
  } catch (err) {
    console.warn(`[memory-dedup] pi judge failed/timeout, falling back to lexical: ${String((err as Error)?.message ?? err)}`);
    return null;
  }
}

// 内部测试钩子
export const __testing = { parseJudgeOutput, buildPrompt };
