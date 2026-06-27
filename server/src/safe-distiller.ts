/**
 * Safe Distiller (D-SAFEDISTILL1) —— 子技能提案脱敏提炼。
 *
 * 红线（AGENTS.md §一）：本模块永久禁止读取 draw_data 原始行。允许输入仅限
 *   ① SQL 查询骨架（已剔除字面量值，保留结构）
 *   ② API 调用拓扑（trace_events 元数据：type/target/status，零 payload 明细）
 *   ③ report / business_requirements 文本（衍生产物，AGENTS.md 允许 LLM）
 *
 * 输入边界由 assertSafeInput 在公共入口处统一守门——任何含 draw_data 字面 /
 * payload.rows 字段的输入即抛错，杜绝从源头泄漏。
 *
 * 产物：纯模板渲染的 skill markdown 提案（零 LLM 调用），落 skill_proposals 表，
 * 由 RulesPane 人审通过后再写入 skill-registry（HTTP fetch self，不 import E 域）。
 *
 * 跨域消费契约：E-SUBSKILL1 / E-SKILLINJECT1 通过 HTTP GET 端点拿提案（仍是 D 真源），
 * 禁止 import 本文件。
 */

import { createHash } from "node:crypto";
import { db } from "./db.ts";

// ---- 输入契约 ------------------------------------------------------------

export interface SqlSkeletonEvidence {
  skeleton: string;
  target: string;
  ts: number;
}

export interface ApiTopologyEvidence {
  kind: string;
  target: string;
  status: string;
  ts: number;
}

export interface ReportEvidence {
  folder: "report" | "business_requirements" | "clean_data";
  path: string;
  summary: string;
}

export interface SafeDistillerInput {
  workspaceId: string;
  sqlSkeletons: SqlSkeletonEvidence[];
  apiTopology: ApiTopologyEvidence[];
  reports: ReportEvidence[];
}

// ---- 红线守门 ------------------------------------------------------------

/**
 * 公共输入兜底：任一字段含 draw_data 路径片段、payload.rows / values 等明细字段名 → 抛错。
 * 调用方在路由层包装本函数，确保输入永远不可能携带原始数据。这是冗余防御：
 * 调用方理论上只投喂 trace_events 元数据 + 衍生文件标题/摘要，但任何疏忽都会被本守门拦下。
 */
export function assertSafeInput(input: SafeDistillerInput): void {
  const DRAW = "draw_data";
  const FORBIDDEN_KEYS = ["rows", "values", "row", "records"];
  const visit = (v: unknown, path: string): void => {
    if (v == null) return;
    if (typeof v === "string") {
      if (v.includes(DRAW)) {
        throw new Error(`safe-distiller: input ${path} contains draw_data reference`);
      }
      return;
    }
    if (typeof v === "number" || typeof v === "boolean") return;
    if (Array.isArray(v)) {
      v.forEach((x, i) => visit(x, `${path}[${i}]`));
      return;
    }
    if (typeof v === "object") {
      for (const [k, vv] of Object.entries(v)) {
        if (FORBIDDEN_KEYS.includes(k)) {
          throw new Error(
            `safe-distiller: input ${path}.${k} matches forbidden detail key (looks like raw rows)`,
          );
        }
        visit(vv, `${path}.${k}`);
      }
    }
  };
  visit(input, "input");
}

// ---- SQL skeleton 归一化 -------------------------------------------------

/**
 * 把 SQL 转为骨架——剔除字面量值，保留结构。规则按序：
 *   ① 字符串字面量 → ?  ② IN(...) → IN (?)  ③ 数字 → ?  ④ 空白折叠
 * 仅作 pattern dedup，不追求 SQL 语义保真。
 */
export function normalizeSqlSkeleton(sql: string): string {
  let s = sql;
  s = s.replace(/'(?:[^'\\]|\\.)*'/g, "?");
  s = s.replace(/"(?:[^"\\]|\\.)*"/g, "?");
  s = s.replace(/\bIN\s*\(\s*[^()]*\)/gi, "IN (?)");
  s = s.replace(/\b\d+(\.\d+)?\b/g, "?");
  s = s.replace(/\s+/g, " ").trim();
  return s;
}

export function skeletonSignature(skeleton: string): string {
  return createHash("sha1").update(skeleton).digest("hex").slice(0, 16);
}

// ---- 候选聚合 ------------------------------------------------------------

export interface DistilledProposal {
  signature: string;
  draftTitle: string;
  draftBody: string;
  evidence: {
    occurrences: number;
    skeleton: string;
    targets: string[];
    reportPaths: string[];
    topologyKinds: Record<string, number>;
  };
}

const DEFAULT_OCCURRENCE_THRESHOLD = 3;

/**
 * 核心 distill：把元数据聚合为提案列表（纯模板，零 LLM）。调用前需先 assertSafeInput。
 */
export function distillProposals(
  input: SafeDistillerInput,
  options: { occurrenceThreshold?: number } = {},
): DistilledProposal[] {
  const threshold = options.occurrenceThreshold ?? DEFAULT_OCCURRENCE_THRESHOLD;
  const bySig = new Map<string, { skeleton: string; targets: Set<string>; occurrences: number }>();
  for (const sk of input.sqlSkeletons) {
    const sig = skeletonSignature(sk.skeleton);
    const entry = bySig.get(sig);
    if (entry) {
      entry.occurrences += 1;
      entry.targets.add(sk.target);
    } else {
      bySig.set(sig, { skeleton: sk.skeleton, targets: new Set([sk.target]), occurrences: 1 });
    }
  }
  const topologyKinds: Record<string, number> = {};
  for (const t of input.apiTopology) {
    topologyKinds[t.kind] = (topologyKinds[t.kind] ?? 0) + 1;
  }
  const reportPaths = input.reports.map((r) => r.path).slice(0, 10);
  const reportSummaries = input.reports.slice(0, 5);

  const proposals: DistilledProposal[] = [];
  for (const [sig, entry] of bySig.entries()) {
    if (entry.occurrences < threshold) continue;
    const targets = Array.from(entry.targets).slice(0, 5);
    const title = synthesizeTitle(entry.skeleton, targets, entry.occurrences);
    proposals.push({
      signature: sig,
      draftTitle: title,
      draftBody: renderSkillBody({
        title,
        skeleton: entry.skeleton,
        targets,
        occurrences: entry.occurrences,
        topologyKinds,
        reportSummaries,
      }),
      evidence: {
        occurrences: entry.occurrences,
        skeleton: entry.skeleton,
        targets,
        reportPaths,
        topologyKinds: { ...topologyKinds },
      },
    });
  }
  proposals.sort((a, b) => b.evidence.occurrences - a.evidence.occurrences);
  return proposals;
}

function synthesizeTitle(skeleton: string, targets: string[], occurrences: number): string {
  const verb = /^\s*SELECT/i.test(skeleton)
    ? "查询"
    : /^\s*WITH/i.test(skeleton)
      ? "CTE 分析"
      : "数据动作";
  const head = targets.length > 0 ? targets.slice(0, 2).join("/") : "未知数据源";
  return `${verb} · ${head} (${occurrences}次)`;
}

function renderSkillBody(args: {
  title: string;
  skeleton: string;
  targets: string[];
  occurrences: number;
  topologyKinds: Record<string, number>;
  reportSummaries: ReportEvidence[];
}): string {
  const frontmatter = [
    "---",
    `name: ${args.title}`,
    `description: 从用户重复执行的查询骨架自动提炼，覆盖 ${args.targets.join("/") || "—"}`,
    "source: derived",
    "---",
    "",
  ].join("\n");
  const triggerKinds = Object.entries(args.topologyKinds)
    .map(([k, v]) => `${k}×${v}`)
    .join("、") || "无";
  const lines: string[] = [
    frontmatter,
    "## 触发场景",
    "",
    `用户在近期数据探索中重复执行同结构查询 **${args.occurrences} 次**，目标对象：${args.targets.join("、") || "未知"}。`,
    "",
    `调用拓扑：${triggerKinds}`,
    "",
    "## 查询骨架（已脱敏，零字面量）",
    "",
    "```sql",
    args.skeleton,
    "```",
    "",
    "## 关联报告（衍生产物）",
    "",
  ];
  if (args.reportSummaries.length === 0) {
    lines.push("- _（本次未关联报告）_");
  } else {
    for (const r of args.reportSummaries) {
      const safeSummary = r.summary.replace(/\s+/g, " ").slice(0, 120);
      lines.push(`- \`${r.folder}\` · \`${r.path}\` — ${safeSummary}`);
    }
  }
  lines.push("");
  lines.push("## 使用建议（人审填写）");
  lines.push("");
  lines.push("_用户审核时补充：何时调用、参数边界、风险点。_");
  return lines.join("\n");
}

// ---- 元数据扫描（trace_events + workspace_paths） ------------------------

/**
 * 从 trace_events 抽 SQL 查询骨架。只读 sql_query 类型事件的 payload.sql 字段
 * （已是 SQL 文本，不含行数据）；并即时 normalize 为骨架。其他 payload 字段
 * （rowCount/executionMs）不被消费。
 */
export function collectSqlSkeletonsFromTrace(
  workspaceId: string,
  sinceMs: number,
): SqlSkeletonEvidence[] {
  const rows = db
    .prepare(
      `SELECT target, payload, created_at FROM trace_events
       WHERE workspace_id = ? AND type = 'sql_query' AND status = 'success' AND created_at >= ?
       ORDER BY created_at DESC LIMIT 500`,
    )
    .all(workspaceId, sinceMs) as Array<{ target: string; payload: string | null; created_at: number }>;
  const out: SqlSkeletonEvidence[] = [];
  for (const row of rows) {
    if (!row.payload) continue;
    let sql = "";
    try {
      const parsed = JSON.parse(row.payload) as { sql?: unknown };
      sql = typeof parsed.sql === "string" ? parsed.sql : "";
    } catch {
      continue;
    }
    if (!sql) continue;
    out.push({ skeleton: normalizeSqlSkeleton(sql), target: row.target, ts: row.created_at });
  }
  return out;
}

/**
 * 抽 API 调用拓扑。只取 trace_events 的 type/target/status/created_at 四列元数据，
 * 完全不读 payload。
 */
export function collectApiTopologyFromTrace(
  workspaceId: string,
  sinceMs: number,
): ApiTopologyEvidence[] {
  const rows = db
    .prepare(
      `SELECT type, target, status, created_at FROM trace_events
       WHERE workspace_id = ? AND created_at >= ?
       ORDER BY created_at DESC LIMIT 1000`,
    )
    .all(workspaceId, sinceMs) as Array<{ type: string; target: string; status: string; created_at: number }>;
  return rows.map((r) => ({ kind: r.type, target: r.target, status: r.status, ts: r.created_at }));
}

/**
 * 列出衍生报告路径。只走 workspace_paths 表的 folder ∈ {report, clean_data, business_requirements}，
 * 显式过滤 draw_data。返回 path + 文件名（用作 summary 占位，不读文件内容）。
 *
 * 注意：本函数仅返回元数据。如调用方需要文件内容做摘要，应在路由层另起一步显式读
 * 并校验 folder 非 draw_data。
 */
export function listSafeReportPaths(workspaceId: string): ReportEvidence[] {
  const rows = db
    .prepare(
      `SELECT folder, path FROM workspace_paths
       WHERE workspace_id = ? AND folder IN ('report', 'clean_data', 'business_requirements')
       ORDER BY added_at DESC LIMIT 50`,
    )
    .all(workspaceId) as Array<{ folder: string; path: string }>;
  return rows.map((r) => {
    const folder = (r.folder === "report" || r.folder === "business_requirements" || r.folder === "clean_data")
      ? r.folder
      : "report";
    const fileName = r.path.split(/[\\/]/).pop() ?? r.path;
    return { folder, path: r.path, summary: fileName };
  });
}

