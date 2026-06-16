import { createHash } from "node:crypto";
import type { RetrievedSkill } from "./types.ts";

export interface SkillCoverageTask {
  id: string;
  sessionId: string;
  title: string;
  text: string;
  updatedAt: number;
}

export interface SkillCoverageGapTask extends SkillCoverageTask {
  topScore: number;
  matches: RetrievedSkill[];
}

export interface SkillCoverageGapCluster {
  id: string;
  title: string;
  taskCount: number;
  avgTopScore: number;
  keywords: string[];
  tasks: SkillCoverageGapTask[];
}

export interface AnalyzeSkillCoverageGapsOptions {
  tasks: SkillCoverageTask[];
  retrieve: (query: string, topK: number) => RetrievedSkill[];
  topK?: number;
  lowScoreThreshold?: number;
  minClusterSize?: number;
  clusterSimilarityThreshold?: number;
  maxClusters?: number;
}

const DEFAULT_TOP_K = 3;
const DEFAULT_LOW_SCORE_THRESHOLD = 1.0;
const DEFAULT_MIN_CLUSTER_SIZE = 2;
const DEFAULT_CLUSTER_SIMILARITY_THRESHOLD = 0.25;
const DEFAULT_MAX_CLUSTERS = 10;

const STOPWORDS = new Set([
  "the",
  "and",
  "for",
  "with",
  "that",
  "this",
  "from",
  "please",
  "need",
  "task",
  "分析",
  "任务",
  "请",
  "需要",
  "一个",
  "这个",
  "进行",
]);

export function analyzeSkillCoverageGaps(options: AnalyzeSkillCoverageGapsOptions): SkillCoverageGapCluster[] {
  const topK = options.topK ?? DEFAULT_TOP_K;
  const lowScoreThreshold = options.lowScoreThreshold ?? DEFAULT_LOW_SCORE_THRESHOLD;
  const minClusterSize = options.minClusterSize ?? DEFAULT_MIN_CLUSTER_SIZE;
  const clusterSimilarityThreshold = options.clusterSimilarityThreshold ?? DEFAULT_CLUSTER_SIMILARITY_THRESHOLD;
  const maxClusters = options.maxClusters ?? DEFAULT_MAX_CLUSTERS;

  const gapTasks = options.tasks
    .map((task): SkillCoverageGapTask => {
      const matches = options.retrieve(task.text, topK);
      return {
        ...task,
        topScore: matches[0]?.score ?? 0,
        matches,
      };
    })
    .filter((task) => task.matches.length === 0 || task.topScore < lowScoreThreshold);

  type MutableCluster = {
    tasks: SkillCoverageGapTask[];
    tokenSet: Set<string>;
  };

  const clusters: MutableCluster[] = [];
  for (const task of gapTasks) {
    const tokens = tokenSet(task.text);
    let best: { cluster: MutableCluster; score: number } | null = null;
    for (const cluster of clusters) {
      const score = jaccard(tokens, cluster.tokenSet);
      if (!best || score > best.score) best = { cluster, score };
    }
    if (best && best.score >= clusterSimilarityThreshold) {
      best.cluster.tasks.push(task);
      best.cluster.tokenSet = union(best.cluster.tokenSet, tokens);
    } else {
      clusters.push({ tasks: [task], tokenSet: tokens });
    }
  }

  return clusters
    .filter((cluster) => cluster.tasks.length >= minClusterSize)
    .map(toGapCluster)
    .sort((a, b) => b.taskCount - a.taskCount || a.avgTopScore - b.avgTopScore)
    .slice(0, maxClusters);
}

function toGapCluster(cluster: { tasks: SkillCoverageGapTask[]; tokenSet: Set<string> }): SkillCoverageGapCluster {
  const keywords = topKeywords(cluster.tasks.map((task) => task.text), 5);
  const avgTopScore = cluster.tasks.reduce((sum, task) => sum + task.topScore, 0) / cluster.tasks.length;
  const idSource = cluster.tasks.map((task) => task.id).sort().join("|");
  const hash = createHash("sha1").update(idSource).digest("hex").slice(0, 12);
  return {
    id: `gap-${hash}`,
    title: keywords.length > 0 ? keywords.join(" / ") : cluster.tasks[0]?.title ?? "coverage gap",
    taskCount: cluster.tasks.length,
    avgTopScore,
    keywords,
    tasks: cluster.tasks,
  };
}

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9一-鿿]+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 2 && !STOPWORDS.has(token));
}

function tokenSet(text: string): Set<string> {
  return new Set(tokenize(text));
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let intersection = 0;
  for (const token of a) {
    if (b.has(token)) intersection++;
  }
  return intersection / (a.size + b.size - intersection);
}

function union(a: Set<string>, b: Set<string>): Set<string> {
  const next = new Set(a);
  for (const token of b) next.add(token);
  return next;
}

function topKeywords(texts: string[], limit: number): string[] {
  const counts = new Map<string, number>();
  for (const text of texts) {
    for (const token of new Set(tokenize(text))) {
      counts.set(token, (counts.get(token) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([token]) => token);
}
