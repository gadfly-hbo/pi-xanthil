import type { MemoryItem } from "./types.ts";

/**
 * 【总控 · 共享接缝】记忆老化检测原语（X-AGING-DEDUP · 2026-06-27）
 *
 * 单一真源：D-AGING2(`memory-aging-signals.ts`) 与 E-AGING1(`memory-aging-inspector.ts`)
 * 曾各自实现一套逐字相同的相似度/引用/活跃判定，违反单一真源。本模块抽出这些**底层纯原语**，
 * 两侧同 import、各自只在其上加域层（D 加 reason enum/pairId/截断；E 加反事实归因/老化曲线/建议）。
 *
 * 边界：只读 `MemoryItem` 衍生字段（title/body/tags/enabled/validUntil），纯函数零 LLM、不碰 draw_data。
 * 高层 detect（冲突对 / 修订回扫）**不在此抽**——两侧输出结构与严重度口径不同，属真实域差异，各自保留。
 */

/** 记忆条目当前是否激活：enabled 且未过 validUntil。 */
export function isMemoryActive(item: MemoryItem, now: number): boolean {
  if (!item.enabled) return false;
  if (item.validUntil !== null && item.validUntil <= now) return false;
  return true;
}

/** 两条记忆的相似度 [0,1]（未 round）：文本 jaccard 为主，tag jaccard 加权 20%。 */
export function memorySimilarity(a: MemoryItem, b: MemoryItem): number {
  const textScore = jaccard(memoryTokens(`${a.title} ${a.body}`), memoryTokens(`${b.title} ${b.body}`));
  const tagScore = jaccard(new Set(a.tags), new Set(b.tags));
  return Math.max(textScore, tagScore * 0.8 + textScore * 0.2);
}

/** a、b 的公共 tag。 */
export function sharedMemoryTags(a: MemoryItem, b: MemoryItem): string[] {
  const bSet = new Set(b.tags);
  return a.tags.filter((tag) => bSet.has(tag));
}

/** item 的正文/标题是否引用了 target：target.id 子串，或 target.title（长度≥4）子串。 */
export function memoryReferences(item: MemoryItem, target: MemoryItem): boolean {
  const haystack = `${item.title}\n${item.body}`.toLowerCase();
  if (haystack.includes(target.id.toLowerCase())) return true;
  const title = target.title.trim().toLowerCase();
  return title.length >= 4 && haystack.includes(title);
}

/** 文本切 token：unicode 字母/数字/下划线/连字符段，长度≥2（中文连续段作单 token）。 */
export function memoryTokens(text: string): Set<string> {
  const matches = text.toLowerCase().match(/[\p{L}\p{N}_-]+/gu) ?? [];
  return new Set(matches.filter((token) => token.length >= 2));
}

/** 两集合 Jaccard 相似度；双空返回 0。 */
export function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 0;
  let intersection = 0;
  for (const value of a) if (b.has(value)) intersection++;
  const union = a.size + b.size - intersection;
  return union === 0 ? 0 : intersection / union;
}
