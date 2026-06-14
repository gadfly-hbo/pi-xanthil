// P1-B：skill 冲突展示共享工具——severity 标签与色调；
// 同时被 CreateSkillModal、AdoptConfirmModal 复用，避免双份实现漂移。
import type { SkillRegistryConflict } from "@/types";

export function severityLabel(severity: SkillRegistryConflict["severity"]): string {
  return severity === "high" ? "高" : severity === "medium" ? "中" : "低";
}

export function severityTone(severity: SkillRegistryConflict["severity"]): string {
  if (severity === "high") return "bg-rose-200 text-rose-800 dark:bg-rose-900/60 dark:text-rose-200";
  if (severity === "medium") return "bg-amber-200 text-amber-800 dark:bg-amber-900/60 dark:text-amber-200";
  return "bg-neutral-200 text-neutral-700 dark:bg-neutral-700 dark:text-neutral-200";
}

// P1-B：listSkillConflicts(content=…) 走 GET querystring，浏览器/反向代理通常 8KB 上限。
// 前端先截断到 4KB，BM25 在前 N 词上已足够区分，避免 414 Request-URI Too Large。
export const SKILL_CONFLICT_CONTENT_LIMIT = 4000;

export function truncateConflictContent(content: string): string {
  return content.length > SKILL_CONFLICT_CONTENT_LIMIT ? content.slice(0, SKILL_CONFLICT_CONTENT_LIMIT) : content;
}
