import { randomUUID } from "node:crypto";
import { db } from "../db.ts";
import type {
  CompositeSubAgentRole,
  CompositeSubAgentRun,
  CompositeSubAgentRunStatus,
  FlowNodeRun,
  FlowNodeRunStatus,
  MemoryItemKind,
  SubAgentBlackboardEntry,
  SubAgentBlackboardKind,
  SubAgentTask,
  SubAgentTaskStatus,
  WorkspaceMemoryEnablement,
  ForkBranch,
} from "../types.ts";

/**
 * 【总控 · 共享域】db 表 slot —— owner: Claude(总控)
 * 跨域基础表（workspaces / workspace_paths / token_stats 等 legacy 仍在 db.ts）。
 * 新增跨域基础表在此 CREATE TABLE IF NOT EXISTS；仅总控写。
 */
export function initSharedTables(): void {
  // 全局池 + 按工作区启用：定义表降级为全局池（workspace_id=origin 仅溯源），
  // "本工作区用不用" 落在此关联表。共享单实例：编辑定义全局生效。
  db.exec(`
    CREATE TABLE IF NOT EXISTS workspace_memory_enablements (
      workspace_id TEXT NOT NULL,
      item_kind    TEXT NOT NULL,
      item_id      TEXT NOT NULL,
      enabled      INTEGER NOT NULL DEFAULT 1,
      created_at   INTEGER NOT NULL,
      PRIMARY KEY (workspace_id, item_kind, item_id)
    );
  `);
  db.exec("CREATE INDEX IF NOT EXISTS idx_wme_ws_kind ON workspace_memory_enablements(workspace_id, item_kind)");
  db.exec("CREATE INDEX IF NOT EXISTS idx_wme_item ON workspace_memory_enablements(item_kind, item_id)");

  // Fork 分支 & 委派子 agent（数据分析对话防上下文撑爆）。
  db.exec(`
    CREATE TABLE IF NOT EXISTS fork_branches (
      id                TEXT PRIMARY KEY,
      parent_session_id TEXT NOT NULL,
      branch_session_id TEXT NOT NULL,
      title             TEXT NOT NULL DEFAULT '',
      seeded            INTEGER NOT NULL DEFAULT 0,
      status            TEXT NOT NULL DEFAULT 'idle',
      created_at        INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS subagent_tasks (
      id                TEXT PRIMARY KEY,
      parent_session_id TEXT NOT NULL,
      brief             TEXT NOT NULL,
      data_files        TEXT NOT NULL DEFAULT '[]',
      model             TEXT,
      template_id       TEXT,
      status            TEXT NOT NULL DEFAULT 'running',
      summary           TEXT,
      report_path       TEXT,
      error             TEXT,
      created_at        INTEGER NOT NULL,
      ended_at          INTEGER
    );
    CREATE TABLE IF NOT EXISTS composite_subagent_runs (
      id                  TEXT PRIMARY KEY,
      parent_session_id   TEXT NOT NULL,
      brief               TEXT NOT NULL,
      data_files          TEXT NOT NULL DEFAULT '[]',
      model               TEXT,
      status              TEXT NOT NULL DEFAULT 'running',
      planner_task_id     TEXT,
      coder_task_ids      TEXT NOT NULL DEFAULT '[]',
      reviewer_task_ids   TEXT NOT NULL DEFAULT '[]',
      current_role        TEXT,
      review_rounds       INTEGER NOT NULL DEFAULT 0,
      max_review_rounds   INTEGER NOT NULL DEFAULT 2,
      summary             TEXT,
      error               TEXT,
      created_at          INTEGER NOT NULL,
      ended_at            INTEGER
    );
    CREATE TABLE IF NOT EXISTS subagent_blackboard_entries (
      id                TEXT PRIMARY KEY,
      workspace_id      TEXT NOT NULL,
      parent_session_id TEXT NOT NULL,
      source_task_id    TEXT,
      scope             TEXT NOT NULL DEFAULT 'parent_session',
      kind              TEXT NOT NULL,
      title             TEXT NOT NULL,
      content           TEXT NOT NULL,
      created_at        INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS flow_node_runs (
      id           TEXT PRIMARY KEY,
      flow_run_id  TEXT NOT NULL,
      flow_id      TEXT NOT NULL,
      node_id      TEXT NOT NULL,
      role         TEXT,
      kind         TEXT NOT NULL,
      status       TEXT NOT NULL DEFAULT 'running',
      started_at   INTEGER NOT NULL,
      ended_at     INTEGER,
      output_path  TEXT
    );
  `);
  db.exec("CREATE INDEX IF NOT EXISTS idx_fork_branches_parent ON fork_branches(parent_session_id)");
  db.exec("CREATE INDEX IF NOT EXISTS idx_fork_branches_branch ON fork_branches(branch_session_id)");
  db.exec("CREATE INDEX IF NOT EXISTS idx_subagent_tasks_parent ON subagent_tasks(parent_session_id)");
  db.exec("CREATE INDEX IF NOT EXISTS idx_composite_subagent_runs_parent ON composite_subagent_runs(parent_session_id)");
  db.exec("CREATE INDEX IF NOT EXISTS idx_subagent_blackboard_parent ON subagent_blackboard_entries(parent_session_id, created_at DESC)");
  db.exec("CREATE INDEX IF NOT EXISTS idx_subagent_blackboard_workspace ON subagent_blackboard_entries(workspace_id, created_at DESC)");
  db.exec("CREATE INDEX IF NOT EXISTS idx_flow_node_runs_flow_node ON flow_node_runs(flow_id, node_id)");
  db.exec("CREATE INDEX IF NOT EXISTS idx_flow_node_runs_run ON flow_node_runs(flow_run_id)");

  // 计算工具·skill 管理：项目级 skill 生命周期注册表（卡1/3 交付）。
  // 内容真源 = <workspace>/.pi/skills/<slug>/SKILL.md；本表存元数据/生命周期态。
  // 启用关系走 workspace_memory_enablements(item_kind='skill')，全局池 + 按工作区启用。
  // CRUD/生命周期/评测回写由 E 卡2 实现（routes/engine.ts + db/engine.ts）。
  db.exec(`
    CREATE TABLE IF NOT EXISTS skill_registry (
      id                TEXT PRIMARY KEY,
      workspace_id      TEXT NOT NULL,
      slug              TEXT NOT NULL,
      name              TEXT NOT NULL,
      status            TEXT NOT NULL DEFAULT 'draft',
      version           INTEGER NOT NULL DEFAULT 1,
      supersedes_id     TEXT,
      source            TEXT NOT NULL DEFAULT 'manual',
      score             REAL,
      activation_rate   REAL,
      usage_count       INTEGER NOT NULL DEFAULT 0,
      prod_injected_count  INTEGER NOT NULL DEFAULT 0,
      prod_activated_count INTEGER NOT NULL DEFAULT 0,
      regression_status TEXT NOT NULL DEFAULT 'none',
      last_regression_at INTEGER,
      regression_reason TEXT,
      regression_score_delta REAL,
      regression_activation_delta REAL,
      last_evaluation_id TEXT,
      origin_session_id TEXT,
      created_at        INTEGER NOT NULL,
      updated_at        INTEGER NOT NULL,
      UNIQUE(workspace_id, slug, version)
    );
  `);
  db.exec("CREATE INDEX IF NOT EXISTS idx_skill_registry_ws ON skill_registry(workspace_id, status, updated_at DESC)");
  // A 卡接缝前置（2026-06-15，总控持有）：生产激活遥测两列；存量库补列。
  // usage_count(注入埋点) 之外，prod_injected_count/prod_activated_count 记生产真实运行的
  // 注入/激活次数，registry 派生 prodActivationRate；写入逻辑由 E 卡 A 落地。
  const skillCols = db.prepare("PRAGMA table_info(skill_registry)").all() as Array<{ name: string }>;
  if (!skillCols.some((c) => c.name === "prod_injected_count")) {
    db.exec("ALTER TABLE skill_registry ADD COLUMN prod_injected_count INTEGER NOT NULL DEFAULT 0");
  }
  if (!skillCols.some((c) => c.name === "prod_activated_count")) {
    db.exec("ALTER TABLE skill_registry ADD COLUMN prod_activated_count INTEGER NOT NULL DEFAULT 0");
  }
  if (!skillCols.some((c) => c.name === "regression_status")) {
    db.exec("ALTER TABLE skill_registry ADD COLUMN regression_status TEXT NOT NULL DEFAULT 'none'");
  }
  if (!skillCols.some((c) => c.name === "last_regression_at")) {
    db.exec("ALTER TABLE skill_registry ADD COLUMN last_regression_at INTEGER");
  }
  if (!skillCols.some((c) => c.name === "regression_reason")) {
    db.exec("ALTER TABLE skill_registry ADD COLUMN regression_reason TEXT");
  }
  if (!skillCols.some((c) => c.name === "regression_score_delta")) {
    db.exec("ALTER TABLE skill_registry ADD COLUMN regression_score_delta REAL");
  }
  if (!skillCols.some((c) => c.name === "regression_activation_delta")) {
    db.exec("ALTER TABLE skill_registry ADD COLUMN regression_activation_delta REAL");
  }
  if (!skillCols.some((c) => c.name === "last_evaluation_id")) {
    db.exec("ALTER TABLE skill_registry ADD COLUMN last_evaluation_id TEXT");
  }
  // subagents 管理 P3（2026-06-17，总控接缝持久化）：委派模板 id 持久化，供 resume/retry
  // 恢复 toolIds 最小权限 + persona（否则 resume 退回全工具/默认人设）；存量库补列、旧任务 NULL=无模板。
  const subagentCols = db.prepare("PRAGMA table_info(subagent_tasks)").all() as Array<{ name: string }>;
  if (!subagentCols.some((c) => c.name === "template_id")) {
    db.exec("ALTER TABLE subagent_tasks ADD COLUMN template_id TEXT");
  }
}

// ---- Fork 分支 CRUD ----

interface ForkBranchRow {
  id: string; parent_session_id: string; branch_session_id: string;
  title: string; seeded: number; status: string; created_at: number;
}

function parseForkBranch(r: ForkBranchRow): ForkBranch {
  return {
    id: r.id, parentSessionId: r.parent_session_id, branchSessionId: r.branch_session_id,
    title: r.title, seeded: !!r.seeded, status: r.status as ForkBranch["status"], createdAt: r.created_at,
  };
}

export function createForkBranch(parentSessionId: string, branchSessionId: string, title: string): ForkBranch {
  const id = randomUUID();
  const now = Date.now();
  db.prepare(
    "INSERT INTO fork_branches (id, parent_session_id, branch_session_id, title, seeded, status, created_at) VALUES (?, ?, ?, ?, 0, 'idle', ?)",
  ).run(id, parentSessionId, branchSessionId, title, now);
  return { id, parentSessionId, branchSessionId, title, seeded: false, status: "idle", createdAt: now };
}

export function listForkBranches(parentSessionId: string): ForkBranch[] {
  return (db.prepare("SELECT * FROM fork_branches WHERE parent_session_id = ? ORDER BY created_at DESC").all(parentSessionId) as unknown as ForkBranchRow[]).map(parseForkBranch);
}

/** 所有分支 session id —— 供主任务列表排除分支（分支不作为独立任务呈现）。 */
export function listBranchSessionIds(): string[] {
  return (db.prepare("SELECT branch_session_id FROM fork_branches").all() as Array<{ branch_session_id: string }>).map((r) => r.branch_session_id);
}

export function getForkBranchByBranchSession(branchSessionId: string): ForkBranch | undefined {
  const r = db.prepare("SELECT * FROM fork_branches WHERE branch_session_id = ?").get(branchSessionId) as unknown as ForkBranchRow | undefined;
  return r ? parseForkBranch(r) : undefined;
}

export function markForkBranchSeeded(branchSessionId: string): void {
  db.prepare("UPDATE fork_branches SET seeded = 1 WHERE branch_session_id = ?").run(branchSessionId);
}

export function setForkBranchStatus(branchSessionId: string, status: ForkBranch["status"]): void {
  db.prepare("UPDATE fork_branches SET status = ? WHERE branch_session_id = ?").run(status, branchSessionId);
}

export function renameForkBranch(branchSessionId: string, title: string): ForkBranch | undefined {
  db.prepare("UPDATE fork_branches SET title = ? WHERE branch_session_id = ?").run(title, branchSessionId);
  return getForkBranchByBranchSession(branchSessionId);
}

// ---- 委派子 agent CRUD ----

interface SubAgentTaskRow {
  id: string; parent_session_id: string; workspace_id?: string; brief: string; data_files: string; model: string | null;
  template_id: string | null;
  status: string; summary: string | null; report_path: string | null; error: string | null;
  created_at: number; ended_at: number | null;
}

function parseSubAgentTask(r: SubAgentTaskRow): SubAgentTask {
  let dataFiles: string[] = [];
  try { dataFiles = JSON.parse(r.data_files) as string[]; } catch { dataFiles = []; }
  return {
    id: r.id, parentSessionId: r.parent_session_id, workspaceId: r.workspace_id,
    brief: r.brief, dataFiles,
    model: r.model ?? undefined, templateId: r.template_id ?? undefined, status: r.status as SubAgentTaskStatus,
    summary: r.summary ?? undefined, reportPath: r.report_path ?? undefined, error: r.error ?? undefined,
    createdAt: r.created_at, endedAt: r.ended_at ?? undefined,
  };
}

export function createSubAgentTask(parentSessionId: string, brief: string, dataFiles: string[], model?: string, templateId?: string): SubAgentTask {
  const id = randomUUID();
  const now = Date.now();
  db.prepare(
    "INSERT INTO subagent_tasks (id, parent_session_id, brief, data_files, model, template_id, status, created_at) VALUES (?, ?, ?, ?, ?, ?, 'running', ?)",
  ).run(id, parentSessionId, brief, JSON.stringify(dataFiles), model ?? null, templateId ?? null, now);
  return { id, parentSessionId, brief, dataFiles, model, templateId, status: "running", createdAt: now };
}

export function listSubAgentTasks(parentSessionId: string): SubAgentTask[] {
  return (db.prepare("SELECT * FROM subagent_tasks WHERE parent_session_id = ? ORDER BY created_at DESC").all(parentSessionId) as unknown as SubAgentTaskRow[]).map(parseSubAgentTask);
}

export function listAllSubAgentTasks(filter: { limit?: number; workspaceId?: string; status?: SubAgentTaskStatus } = {}): SubAgentTask[] {
  const limit = Math.min(Math.max(Math.floor(filter.limit ?? 200), 1), 500);
  const where: string[] = [];
  const params: Array<string | number> = [];
  if (filter.workspaceId) {
    where.push("s.workspace_id = ?");
    params.push(filter.workspaceId);
  }
  if (filter.status) {
    where.push("t.status = ?");
    params.push(filter.status);
  }
  params.push(limit);
  const sql = `SELECT t.*, s.workspace_id FROM subagent_tasks t JOIN sessions s ON t.parent_session_id = s.id${where.length ? ` WHERE ${where.join(" AND ")}` : ""} ORDER BY t.created_at DESC LIMIT ?`;
  return (db.prepare(sql).all(...params) as unknown as SubAgentTaskRow[]).map(parseSubAgentTask);
}

export function getSubAgentTask(id: string): SubAgentTask | undefined {
  const r = db.prepare("SELECT * FROM subagent_tasks WHERE id = ?").get(id) as unknown as SubAgentTaskRow | undefined;
  return r ? parseSubAgentTask(r) : undefined;
}

export function finishSubAgentTask(
  id: string,
  patch: { status: SubAgentTaskStatus; summary?: string; reportPath?: string; error?: string },
): void {
  db.prepare(
    "UPDATE subagent_tasks SET status = ?, summary = ?, report_path = ?, error = ?, ended_at = ? WHERE id = ?",
  ).run(patch.status, patch.summary ?? null, patch.reportPath ?? null, patch.error ?? null, Date.now(), id);
}

// ---- 复合 subagent 编排 CRUD ----

interface CompositeSubAgentRunRow {
  id: string; parent_session_id: string; workspace_id?: string; brief: string; data_files: string; model: string | null;
  status: string; planner_task_id: string | null; coder_task_ids: string; reviewer_task_ids: string; current_role: string | null;
  review_rounds: number; max_review_rounds: number; summary: string | null; error: string | null; created_at: number; ended_at: number | null;
}

function parseJsonStringArray(value: string): string[] {
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

function parseCompositeSubAgentRun(r: CompositeSubAgentRunRow): CompositeSubAgentRun {
  return {
    id: r.id,
    parentSessionId: r.parent_session_id,
    workspaceId: r.workspace_id,
    brief: r.brief,
    dataFiles: parseJsonStringArray(r.data_files),
    model: r.model ?? undefined,
    status: r.status as CompositeSubAgentRunStatus,
    plannerTaskId: r.planner_task_id ?? undefined,
    coderTaskIds: parseJsonStringArray(r.coder_task_ids),
    reviewerTaskIds: parseJsonStringArray(r.reviewer_task_ids),
    currentRole: (r.current_role ?? undefined) as CompositeSubAgentRole | undefined,
    reviewRounds: r.review_rounds,
    maxReviewRounds: r.max_review_rounds,
    summary: r.summary ?? undefined,
    error: r.error ?? undefined,
    createdAt: r.created_at,
    endedAt: r.ended_at ?? undefined,
  };
}

export function createCompositeSubAgentRun(input: { parentSessionId: string; brief: string; dataFiles: string[]; model?: string; maxReviewRounds?: number }): CompositeSubAgentRun {
  const id = randomUUID();
  const now = Date.now();
  const maxReviewRounds = Math.max(1, Math.min(5, Math.trunc(input.maxReviewRounds ?? 2)));
  db.prepare(
    `INSERT INTO composite_subagent_runs (
      id, parent_session_id, brief, data_files, model, status, coder_task_ids, reviewer_task_ids,
      review_rounds, max_review_rounds, created_at
    ) VALUES (?, ?, ?, ?, ?, 'running', '[]', '[]', 0, ?, ?)`,
  ).run(id, input.parentSessionId, input.brief, JSON.stringify(input.dataFiles), input.model ?? null, maxReviewRounds, now);
  return {
    id,
    parentSessionId: input.parentSessionId,
    brief: input.brief,
    dataFiles: input.dataFiles,
    model: input.model,
    status: "running",
    coderTaskIds: [],
    reviewerTaskIds: [],
    reviewRounds: 0,
    maxReviewRounds,
    createdAt: now,
  };
}

export function getCompositeSubAgentRun(id: string): CompositeSubAgentRun | undefined {
  const r = db.prepare("SELECT * FROM composite_subagent_runs WHERE id = ?").get(id) as unknown as CompositeSubAgentRunRow | undefined;
  return r ? parseCompositeSubAgentRun(r) : undefined;
}

export function listCompositeSubAgentRuns(parentSessionId: string): CompositeSubAgentRun[] {
  return (db.prepare("SELECT * FROM composite_subagent_runs WHERE parent_session_id = ? ORDER BY created_at DESC").all(parentSessionId) as unknown as CompositeSubAgentRunRow[]).map(parseCompositeSubAgentRun);
}

export function updateCompositeSubAgentRun(id: string, patch: {
  status?: CompositeSubAgentRunStatus;
  plannerTaskId?: string;
  coderTaskIds?: string[];
  reviewerTaskIds?: string[];
  currentRole?: CompositeSubAgentRole | null;
  reviewRounds?: number;
  summary?: string;
  error?: string;
  ended?: boolean;
}): void {
  const current = getCompositeSubAgentRun(id);
  if (!current) return;
  db.prepare(
    `UPDATE composite_subagent_runs SET
      status = ?, planner_task_id = ?, coder_task_ids = ?, reviewer_task_ids = ?, current_role = ?,
      review_rounds = ?, summary = ?, error = ?, ended_at = ?
     WHERE id = ?`,
  ).run(
    patch.status ?? current.status,
    patch.plannerTaskId ?? current.plannerTaskId ?? null,
    JSON.stringify(patch.coderTaskIds ?? current.coderTaskIds),
    JSON.stringify(patch.reviewerTaskIds ?? current.reviewerTaskIds),
    patch.currentRole === null ? null : patch.currentRole ?? current.currentRole ?? null,
    patch.reviewRounds ?? current.reviewRounds,
    patch.summary ?? current.summary ?? null,
    patch.error ?? current.error ?? null,
    patch.ended ? Date.now() : current.endedAt ?? null,
    id,
  );
}

// ---- subagent 共享黑板 CRUD ----

interface SubAgentBlackboardEntryRow {
  id: string; workspace_id: string; parent_session_id: string; source_task_id: string | null;
  scope: string; kind: string; title: string; content: string; created_at: number;
}

function parseSubAgentBlackboardEntry(r: SubAgentBlackboardEntryRow): SubAgentBlackboardEntry {
  return {
    id: r.id,
    workspaceId: r.workspace_id,
    parentSessionId: r.parent_session_id,
    sourceTaskId: r.source_task_id ?? undefined,
    scope: "parent_session",
    kind: r.kind as SubAgentBlackboardKind,
    title: r.title,
    content: r.content,
    createdAt: r.created_at,
  };
}

export function createSubAgentBlackboardEntry(input: {
  workspaceId: string;
  parentSessionId: string;
  sourceTaskId?: string;
  kind: SubAgentBlackboardKind;
  title: string;
  content: string;
}): SubAgentBlackboardEntry {
  const id = randomUUID();
  const now = Date.now();
  db.prepare(
    `INSERT INTO subagent_blackboard_entries (
      id, workspace_id, parent_session_id, source_task_id, scope, kind, title, content, created_at
    ) VALUES (?, ?, ?, ?, 'parent_session', ?, ?, ?, ?)`,
  ).run(id, input.workspaceId, input.parentSessionId, input.sourceTaskId ?? null, input.kind, input.title, input.content, now);
  return { id, workspaceId: input.workspaceId, parentSessionId: input.parentSessionId, sourceTaskId: input.sourceTaskId, scope: "parent_session", kind: input.kind, title: input.title, content: input.content, createdAt: now };
}

export function listSubAgentBlackboardEntries(parentSessionId: string): SubAgentBlackboardEntry[] {
  return (db.prepare("SELECT * FROM subagent_blackboard_entries WHERE parent_session_id = ? ORDER BY created_at DESC").all(parentSessionId) as unknown as SubAgentBlackboardEntryRow[]).map(parseSubAgentBlackboardEntry);
}

// ---- workflow 节点运行 CRUD ----

interface FlowNodeRunRow {
  id: string; flow_run_id: string; flow_id: string; flow_name?: string; workspace_id?: string; node_id: string;
  role: string | null; kind: string; status: string; started_at: number; ended_at: number | null; output_path: string | null;
}

function parseFlowNodeRun(r: FlowNodeRunRow): FlowNodeRun {
  return {
    id: r.id,
    flowRunId: r.flow_run_id,
    flowId: r.flow_id,
    flowName: r.flow_name,
    workspaceId: r.workspace_id,
    nodeId: r.node_id,
    role: r.role ?? undefined,
    kind: r.kind as FlowNodeRun["kind"],
    status: r.status as FlowNodeRunStatus,
    startedAt: r.started_at,
    endedAt: r.ended_at ?? undefined,
    outputPath: r.output_path ?? undefined,
  };
}

export function startFlowNodeRun(input: { flowRunId: string; flowId: string; nodeId: string; role?: string; kind: FlowNodeRun["kind"] }): FlowNodeRun {
  const id = randomUUID();
  const now = Date.now();
  db.prepare(
    "INSERT INTO flow_node_runs (id, flow_run_id, flow_id, node_id, role, kind, status, started_at) VALUES (?, ?, ?, ?, ?, ?, 'running', ?)",
  ).run(id, input.flowRunId, input.flowId, input.nodeId, input.role ?? null, input.kind, now);
  return { id, flowRunId: input.flowRunId, flowId: input.flowId, nodeId: input.nodeId, role: input.role, kind: input.kind, status: "running", startedAt: now };
}

export function finishFlowNodeRun(id: string, patch: { status: FlowNodeRunStatus; outputPath?: string }): void {
  db.prepare("UPDATE flow_node_runs SET status = ?, ended_at = ?, output_path = ? WHERE id = ?").run(patch.status, Date.now(), patch.outputPath ?? null, id);
}

export function listFlowNodeRuns(filter: { workspaceId?: string; flowId?: string; limit?: number } = {}): FlowNodeRun[] {
  const limit = Math.min(Math.max(Math.floor(filter.limit ?? 500), 1), 1000);
  const where: string[] = [];
  const params: Array<string | number> = [];
  if (filter.workspaceId) {
    where.push("f.workspace_id = ?");
    params.push(filter.workspaceId);
  }
  if (filter.flowId) {
    where.push("n.flow_id = ?");
    params.push(filter.flowId);
  }
  params.push(limit);
  const sql = `SELECT n.*, f.workspace_id, f.name AS flow_name
    FROM flow_node_runs n
    JOIN flows f ON f.id = n.flow_id
    ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
    ORDER BY n.started_at DESC
    LIMIT ?`;
  return (db.prepare(sql).all(...params) as unknown as FlowNodeRunRow[]).map(parseFlowNodeRun);
}

/**
 * 一次性·幂等 backfill：现有定义按 origin workspace 建启用记录（仅原工作区启用，
 * enabled 沿用该行原值）。INSERT OR IGNORE 保证幂等——已存在的关系（含被手动禁用的）不被覆盖，
 * 新建定义经 CRUD 自带关系也不会被重复插入。每次 boot 调用安全。
 *
 * D-POOL1: prompt_templates(workspace_id 非 NULL) + knowledge_docs(scope='global') 一并 backfill；
 * prompt NULL=恒启用不入表；knowledge scope='workspace' 私有独占不入表。消费侧自己负责合并。
 */
export function backfillMemoryEnablements(): void {
  const now = Date.now();
  // 局部声明（非模块级 const）：避免循环 import 下 db.ts boot 期调用早于本模块 const 初始化触发 TDZ。
  // 标准范式：`workspace_id` + `enabled` 列直读。
  const BACKFILL_SOURCES: Array<{ kind: MemoryItemKind; table: string }> = [
    { kind: "rule", table: "rule_memories" },
    { kind: "standard", table: "analysis_standards" },
    { kind: "business_context", table: "business_contexts" },
    { kind: "case", table: "analysis_cases" },
    { kind: "metric", table: "metric_definitions" },
  ];
  for (const { kind, table } of BACKFILL_SOURCES) {
    try {
      db.prepare(
        `INSERT OR IGNORE INTO workspace_memory_enablements(workspace_id, item_kind, item_id, enabled, created_at)
         SELECT workspace_id, ?, id, enabled, ? FROM ${table}`,
      ).run(kind, now);
    } catch {
      // 表尚未建/列缺失（如 onto 结构表无 enabled）时跳过；onto 粒度由 P3 决定。
    }
  }
  // D-POOL1 · prompt_templates：仅 workspace_id 非 NULL 入 enablement(origin 启用)；
  // NULL 模板由消费侧恒启用（不写表保持池清爽，且天然兼容新增 ws 零维护）。
  try {
    db.prepare(
      `INSERT OR IGNORE INTO workspace_memory_enablements(workspace_id, item_kind, item_id, enabled, created_at)
       SELECT workspace_id, 'prompt', id, 1, ? FROM prompt_templates WHERE workspace_id IS NOT NULL`,
    ).run(now);
  } catch { /* 表未建跳过 */ }
  // D-POOL1 · knowledge_docs：仅 scope='global' 入池建启用(origin 启用)；
  // 'workspace' 文档私有独占，消费侧靠 listKnowledgeChunksForRetrieval 直接 union 本 ws 私有。
  try {
    db.prepare(
      `INSERT OR IGNORE INTO workspace_memory_enablements(workspace_id, item_kind, item_id, enabled, created_at)
       SELECT workspace_id, 'knowledge', id, 1, ? FROM knowledge_docs WHERE scope = 'global'`,
    ).run(now);
  } catch { /* 表未建跳过 */ }
}

/** 设置/更新某工作区对某池条目的启用状态（upsert）。 */
export function setMemoryEnablement(
  workspaceId: string,
  itemKind: MemoryItemKind,
  itemId: string,
  enabled: boolean,
): void {
  db.prepare(
    `INSERT INTO workspace_memory_enablements(workspace_id, item_kind, item_id, enabled, created_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(workspace_id, item_kind, item_id) DO UPDATE SET enabled = excluded.enabled`,
  ).run(workspaceId, itemKind, itemId, enabled ? 1 : 0, Date.now());
}

/** 新池定义被创建时调用：origin 工作区默认启用（其余工作区不启用 = 无关系行）。 */
export function enableForOrigin(workspaceId: string, itemKind: MemoryItemKind, itemId: string): void {
  setMemoryEnablement(workspaceId, itemKind, itemId, true);
}

/** 全局淘汰：关闭**所有**工作区对某池条目的启用（skill 归档=全局停用，详见 wiki「skill 管理 P1·D」卡）。 */
export function disableItemEverywhere(itemKind: MemoryItemKind, itemId: string): void {
  db.prepare(
    "UPDATE workspace_memory_enablements SET enabled = 0 WHERE item_kind = ? AND item_id = ?",
  ).run(itemKind, itemId);
}

/** 列出某工作区某类已启用的池条目 id —— 供注入/列举管线 join 用。 */
export function listEnabledItemIds(workspaceId: string, itemKind: MemoryItemKind): string[] {
  return (
    db
      .prepare(
        `SELECT item_id FROM workspace_memory_enablements
         WHERE workspace_id = ? AND item_kind = ? AND enabled = 1`,
      )
      .all(workspaceId, itemKind) as Array<{ item_id: string }>
  ).map((r) => r.item_id);
}

/** 列出某工作区的启用关系（可按 kind 过滤）—— 供前端"池 + 启用勾选"视图用。 */
export function listWorkspaceEnablements(
  workspaceId: string,
  itemKind?: MemoryItemKind,
): WorkspaceMemoryEnablement[] {
  const rows = itemKind
    ? db
        .prepare("SELECT * FROM workspace_memory_enablements WHERE workspace_id = ? AND item_kind = ?")
        .all(workspaceId, itemKind)
    : db.prepare("SELECT * FROM workspace_memory_enablements WHERE workspace_id = ?").all(workspaceId);
  return (
    rows as Array<{ workspace_id: string; item_kind: string; item_id: string; enabled: number; created_at: number }>
  ).map((r) => ({
    workspaceId: r.workspace_id,
    itemKind: r.item_kind as MemoryItemKind,
    itemId: r.item_id,
    enabled: !!r.enabled,
    createdAt: r.created_at,
  }));
}
