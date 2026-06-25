import { listKnowledgeChunksForRetrieval } from "./db/data.ts";
import type { KnowledgeChunkHit, KnowledgeDocSearchResult } from "./types.ts";

/**
 * 知识库 chunk BM25 检索（D-RETRIEVAL · 知识库分支）
 *
 * 复用 memory-injection.ts 的多信号范式（relevance + recency + idfBoost），但目标是
 * `knowledge_chunks` 而非 memory_item。零新依赖：tokenize/stopwords/idf 全部本文件实现，
 * 与 memory-injection 同口径但不互相 import（避免反向耦合）。
 *
 * 数据安全：本检索面向用户上传文档（folder kind 'knowledge'），不接 draw_data 原始数据通路。
 */

const STOPWORDS = new Set([
  "的", "了", "在", "是", "和", "与", "或", "也", "都", "不", "有", "对", "及",
  "将", "已", "为", "以", "从", "该", "其", "则", "时", "下", "上", "中", "内",
  "by", "the", "a", "an", "in", "of", "to", "for", "is", "are", "was", "be",
  "this", "that", "it", "at", "as", "with", "on", "from", "or", "and", "not",
]);
const HEADING_BOOST_STOPWORDS = new Set([
  "三大", "大人", "人群", "算法", "渠道", "森马", "平台", "关于", "里面",
  "简要", "复述", "回顾", "知识", "识库", "记忆",
]);
const HEADING_BOOST_ALLOWLIST = new Set([
  "天猫", "京东", "抖音", "线下", "唯品", "视频", "拼多",
  "六大", "八大", "十大", "权重", "映射", "标签",
]);

const CJK_RE = /[\u4e00-\u9fff]/;

/**
 * 混合 tokenizer：ASCII 词按空格切；CJK 段落用 char-bigram（"复购率" → "复购","购率"）。
 * bigram 覆盖中文无空格场景，召回粒度比单字更准（避免高频字浮上来）。
 */
function tokenizeArray(text: string): string[] {
  if (!text) return [];
  const cleaned = text.replace(/[，。；：！？,.;:!?"'「」【】（）()\-_\n\r\t/]/g, " ");
  const out: string[] = [];
  // 用正则把字符串拆成 ASCII run + CJK run + space。
  const parts = cleaned.match(/[\u4e00-\u9fff]+|[A-Za-z0-9_]+/g) ?? [];
  for (const part of parts) {
    if (CJK_RE.test(part)) {
      // CJK：char-bigram
      if (part.length === 1) {
        if (!STOPWORDS.has(part)) out.push(part);
      } else {
        for (let i = 0; i < part.length - 1; i++) {
          const bg = part.slice(i, i + 2);
          if (!STOPWORDS.has(bg)) out.push(bg);
        }
      }
    } else {
      const w = part.toLowerCase();
      if (w.length >= 2 && !STOPWORDS.has(w)) out.push(w);
    }
  }
  return out;
}

function queryBigrams(queryTokens: string[]): Set<string> {
  const out = new Set<string>();
  for (const token of queryTokens) {
    if (
      CJK_RE.test(token)
      && token.length === 2
      && !HEADING_BOOST_STOPWORDS.has(token)
      && HEADING_BOOST_ALLOWLIST.has(token)
    ) out.add(token);
  }
  return out;
}

function headingMatchBoost(text: string, queryTerms: Set<string>): number {
  if (queryTerms.size === 0) return 0;
  const headings = text.split(/\r?\n/).filter((line) => /^#{1,6}\s+/.test(line));
  for (const heading of headings) {
    for (const term of queryTerms) {
      if (heading.includes(term)) return 40;
    }
  }
  return 0;
}

// BM25 参数（业内常用默认）
const BM25_K1 = 1.5;
const BM25_B = 0.75;

const SCORE_WEIGHTS = {
  relevance: 0.7, // BM25 主信号
  recency: 0.2,   // 文档新鲜度
  idfBoost: 0.1,  // 命中稀有词加成（已含在 BM25 内，留小权重做 tie-breaker）
} as const;

function recencyScore(updatedAt: number, now: number, halfLifeDays = 60): number {
  // 60d 半衰期：知识文档相对 memory_item(30d) 衰减更慢——
  // 知识库存放长期参考资料（口径文档、SOP），不应像即时学习记忆一样快速过期。
  if (!updatedAt) return 0;
  const ageDays = Math.max(0, (now - updatedAt) / 86400000);
  return Math.pow(0.5, ageDays / halfLifeDays);
}

export interface KnowledgeSearchOptions {
  topK?: number;
  /** Restrict search to specific docIds. */
  docIds?: string[];
  /** 0~1 minimum normalized score for inclusion. */
  minScore?: number;
  /** D-KB2: "uniform" = 所有字段等权（默认）；"weighted" = title 3x / tags 2x / summary 2x / body 1x。 */
  tokenizationMode?: "uniform" | "weighted";
}

export function searchKnowledgeChunks(
  workspaceId: string,
  query: string,
  options: KnowledgeSearchOptions = {},
): KnowledgeChunkHit[] {
  const queryTokens = tokenizeArray(query);
  if (queryTokens.length === 0) return [];
  const queryTermSet = new Set(queryTokens);
  const headingTerms = queryBigrams(queryTokens);

  const rows = listKnowledgeChunksForRetrieval(workspaceId, options.docIds);
  if (rows.length === 0) return [];

  // ponytail: tokenize-on-every-query, O(N * chunkLen). 当工作区 chunk 数 ≳ 5k 或 P95 query
  // 延迟 > 50ms 时，加 (workspaceId, max(updated_at)) → tokens 的进程内缓存即可消除热路径。
  const weighted = options.tokenizationMode === "weighted";
  const tokenized = rows.map((r) => {
    if (weighted) {
      const titleToks = tokenizeArray(r.docTitle);
      const tagToks = tokenizeArray(r.docTags.join(" "));
      const summaryToks = r.docSummary ? tokenizeArray(r.docSummary) : [];
      const bodyToks = tokenizeArray(r.chunk.text);
      // title 3x, tags 2x, summary 2x (Math.round(1.5)), body 1x
      return [
        ...titleToks, ...titleToks, ...titleToks,
        ...tagToks, ...tagToks,
        ...summaryToks, ...summaryToks,
        ...bodyToks,
      ];
    }
    return tokenizeArray(`${r.docTitle}\n${r.docTags.join(" ")}\n${r.chunk.text}`);
  });
  const N = rows.length;
  const df = new Map<string, number>();
  for (const tokens of tokenized) {
    const seen = new Set(tokens);
    for (const t of seen) if (queryTermSet.has(t)) df.set(t, (df.get(t) ?? 0) + 1);
  }
  const avgLen = tokenized.reduce((sum, t) => sum + t.length, 0) / Math.max(1, N);
  const now = Date.now();

  // BM25 scoring per chunk for query terms only.
  const scored: KnowledgeChunkHit[] = [];
  let maxRaw = 0;
  for (let i = 0; i < rows.length; i++) {
    const tokens = tokenized[i]!;
    if (tokens.length === 0) continue;
    const tf = new Map<string, number>();
    for (const t of tokens) if (queryTermSet.has(t)) tf.set(t, (tf.get(t) ?? 0) + 1);
    if (tf.size === 0) continue;
    let bm25 = 0;
    let idfSum = 0;
    let hitCount = 0;
    for (const [term, freq] of tf) {
      const docFreq = df.get(term) ?? 0;
      // Standard BM25 idf with +0.5 smoothing; clamp negative to 0.
      const idf = Math.max(0, Math.log((N - docFreq + 0.5) / (docFreq + 0.5) + 1));
      const norm = (freq * (BM25_K1 + 1)) / (freq + BM25_K1 * (1 - BM25_B + BM25_B * (tokens.length / Math.max(1, avgLen))));
      bm25 += idf * norm;
      idfSum += idf;
      hitCount++;
    }
    const headingBoost = headingMatchBoost(rows[i]!.chunk.text, headingTerms);
    if (hitCount === 0 && headingBoost === 0) continue;
    bm25 += headingBoost;
    if (bm25 > maxRaw) maxRaw = bm25;
    scored.push({
      chunk: rows[i]!.chunk,
      doc: { id: rows[i]!.chunk.docId, title: rows[i]!.docTitle, path: rows[i]!.docPath, tags: rows[i]!.docTags, updatedAt: rows[i]!.docUpdatedAt, createdAt: rows[i]!.docCreatedAt, sourceType: rows[i]!.docSourceType },
      score: 0, // filled below
      signals: { relevance: bm25, recency: recencyScore(rows[i]!.docUpdatedAt, now), idfBoost: idfSum / Math.max(1, queryTokens.length) },
    });
  }
  if (scored.length === 0) return [];

  // Normalize relevance to [0,1] using max BM25 within result set, then weighted blend.
  for (const hit of scored) {
    const rel = maxRaw > 0 ? hit.signals.relevance / maxRaw : 0;
    const idfNorm = Math.min(1, hit.signals.idfBoost / Math.max(1, Math.log(N + 1)));
    hit.signals = { relevance: rel, recency: hit.signals.recency, idfBoost: idfNorm };
    hit.score =
      SCORE_WEIGHTS.relevance * rel +
      SCORE_WEIGHTS.recency * hit.signals.recency +
      SCORE_WEIGHTS.idfBoost * idfNorm;
  }
  scored.sort((a, b) => b.score - a.score);
  const minScore = typeof options.minScore === "number" ? options.minScore : 0;
  const filtered = scored.filter((h) => h.score >= minScore);
  const topK = Math.max(1, options.topK ?? 10);
  return filtered.slice(0, topK);
}

// D-KB2: 提取 query 中适合做 tag 精确匹配的候选词（ASCII + CJK 均支持）。
// ASCII 词按非字母数字切分；CJK 词按空白/全角标点切分，保留 2 字以上。
function extractQueryTagCandidates(query: string): string[] {
  const ascii = query.toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length >= 2);
  const cjk = query.split(/[\s，。；：！？,.;:!?()\-_\n\r\t/「」【】（）]+/)
    .filter((t) => CJK_RE.test(t) && t.length >= 2);
  return [...ascii, ...cjk];
}

/**
 * D-KB1: doc 级聚合检索。
 *
 * 在 searchKnowledgeChunks 基础上按 docId 分组，计算 doc_score =
 * max(chunk.score) * 0.6 + avg(top3 chunk scores) * 0.4。
 * snippet = 最高分 chunk 的 text 前 200 字。
 *
 * D-KB2 增强：tokenizationMode="weighted" 时 title/tags/summary 加权；
 * 标签精确命中额外 +0.15（clamp 到 1）。
 */
export function searchKnowledgeDocs(
  workspaceId: string,
  query: string,
  options: KnowledgeSearchOptions = {},
): KnowledgeDocSearchResult[] {
  const chunkHits = searchKnowledgeChunks(workspaceId, query, {
    ...options,
    topK: 10000, // 取全量 chunk，由 doc 级聚合后截断
  });
  if (chunkHits.length === 0) return [];

  // Group by docId
  const byDoc = new Map<string, KnowledgeChunkHit[]>();
  for (const hit of chunkHits) {
    const list = byDoc.get(hit.doc.id);
    if (list) list.push(hit);
    else byDoc.set(hit.doc.id, [hit]);
  }

  const weighted = options.tokenizationMode === "weighted";
  const queryTagCandidates = weighted ? extractQueryTagCandidates(query) : [];

  const results: KnowledgeDocSearchResult[] = [];
  for (const [, hits] of byDoc) {
    const sorted = hits.sort((a, b) => b.score - a.score);
    const maxScore = sorted[0]!.score;
    const top3 = sorted.slice(0, 3);
    const avgTop3 = top3.reduce((s, h) => s + h.score, 0) / top3.length;
    let docScore = maxScore * 0.6 + avgTop3 * 0.4;

    // D-KB2: tag exact-match boost（ASCII + CJK 均支持）
    if (weighted && queryTagCandidates.length > 0) {
      const docTagsLower = sorted[0]!.doc.tags.map((t) => t.toLowerCase());
      const hasMatch = queryTagCandidates.some((qt) => docTagsLower.some((t) => t === qt.toLowerCase()));
      if (hasMatch) docScore = Math.min(1, docScore + 0.15);
    }

    const bestHit = sorted[0]!;
    results.push({
      doc: {
        id: bestHit.doc.id,
        workspaceId,
        title: bestHit.doc.title,
        sourceType: bestHit.doc.sourceType,
        path: bestHit.doc.path,
        content: null,
        tags: bestHit.doc.tags,
        createdAt: bestHit.doc.createdAt,
        updatedAt: bestHit.doc.updatedAt,
      },
      score: docScore,
      snippet: bestHit.chunk.text.slice(0, 200).trimEnd(),
      matchedChunkCount: hits.length,
      signals: {
        relevance: bestHit.signals.relevance,
        recency: bestHit.signals.recency,
      },
    });
  }

  results.sort((a, b) => b.score - a.score);
  const topK = Math.max(1, options.topK ?? 10);
  return results.slice(0, topK);
}
