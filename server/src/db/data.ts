import { randomUUID } from "node:crypto";
import { statSync } from "node:fs";
import { db } from "../db.ts";
import {
  listBusinessContexts,
  listAnalysisStandards,
  listEnabledMetricDefinitions,
} from "../db.ts";
import {
  listEnabledItemIds,
  enableForOrigin,
  setMemoryEnablement,
} from "./shared.ts";
import type {
  MemoryItem,
  MemoryItemInput,
  MemoryItemType,
  MemoryItemSource,
  MemoryRiskFlag,
  MemoryReview,
  ProjectedFactItem,
  KnowledgeDoc,
  KnowledgeChunk,
  KnowledgeDocInput,
  KnowledgeDocPatch,
  PromptTemplate,
  PromptTemplateInput,
  PromptTemplatePatch,
} from "../types.ts";
// 规则记忆 v2 跨 server/web 契约统一在 types.ts（总控终审 D-PANEL 时收敛）；
// 下游（routes/data.ts·memory-injection.ts）仍从本文件 import，故此处再导出保持兼容。
export type { MemoryReview, ProjectedFactItem, ProjectedFactKind, MemoryReviewStatus } from "../types.ts";

/**
 * 【Agent-D · 数据基座域】db 表 slot —— owner: opencode(deepseek/glm)
 * 数据源 / 指标语义层（metrics / metric_lineage / data_sources …）等新表建在此。
 * 约定: 新表 CREATE TABLE IF NOT EXISTS; 配套 CRUD 也写本文件, 由 routes/data.ts 调用。
 * 禁止: 改他域表 / 触碰 db.ts legacy schema。
 */
export function initDataTables(): void {
  // 统一记忆 memory_items（规则记忆重构 v2 · 总控 X-CONTRACT 审定 schema · CRUD 由 D-DATA 实装）。
  // constraint/experience/episode 三类入表；fact 由 adapter 从既有源投影，不入表。
  db.exec(`
    CREATE TABLE IF NOT EXISTS memory_items (
      id               TEXT PRIMARY KEY,
      workspace_id     TEXT NOT NULL REFERENCES workspaces(id),
      type             TEXT NOT NULL,
      title            TEXT NOT NULL,
      body             TEXT NOT NULL,
      tags             TEXT NOT NULL DEFAULT '[]',
      source           TEXT NOT NULL DEFAULT 'manual',
      source_event_ids TEXT NOT NULL DEFAULT '[]',
      confidence       REAL NOT NULL DEFAULT 1,
      risk_flags       TEXT NOT NULL DEFAULT '[]',
      valid_from       INTEGER NOT NULL,
      valid_until      INTEGER,
      supersedes_id    TEXT,
      used_count       INTEGER NOT NULL DEFAULT 0,
      last_used_at     INTEGER,
      positive_signals INTEGER NOT NULL DEFAULT 0,
      negative_signals INTEGER NOT NULL DEFAULT 0,
      stale_after_days INTEGER NOT NULL DEFAULT 90,
      scope            TEXT NOT NULL DEFAULT 'global',
      enabled          INTEGER NOT NULL DEFAULT 1,
      created_at       INTEGER NOT NULL,
      updated_at       INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_memory_items_ws_type ON memory_items(workspace_id, type, updated_at DESC);
  `);

  // 候选复核队列（D-INGEST 门禁分流 · 阶段2）：
  // 高置信低危候选直接入 memory_items（source='derived'），其余进 memory_reviews 等待 D-PANEL
  // 一键采纳/拒绝。审核通过即写 memory_items 并把 review_id → 对应 item_id 关联回填。
  db.exec(`
    CREATE TABLE IF NOT EXISTS memory_reviews (
      id               TEXT PRIMARY KEY,
      workspace_id     TEXT NOT NULL REFERENCES workspaces(id),
      type             TEXT NOT NULL,
      title            TEXT NOT NULL,
      body             TEXT NOT NULL,
      tags             TEXT NOT NULL DEFAULT '[]',
      scope            TEXT NOT NULL DEFAULT 'global',
      source_event_ids TEXT NOT NULL DEFAULT '[]',
      confidence       REAL NOT NULL DEFAULT 0,
      risk_flags       TEXT NOT NULL DEFAULT '[]',
      target_kind      TEXT,
      target_id        TEXT,
      reason           TEXT NOT NULL DEFAULT '',
      status           TEXT NOT NULL DEFAULT 'pending',
      decided_item_id  TEXT,
      decided_reason   TEXT NOT NULL DEFAULT '',
      created_at       INTEGER NOT NULL,
      updated_at       INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_memory_reviews_ws_status ON memory_reviews(workspace_id, status, updated_at DESC);
  `);

  // 知识库 knowledge_docs / knowledge_chunks（知识库模块 · 总控 X 接缝审定 schema · CRUD+分块+检索由 Agent-D 实装）。
  // 文档=用户上传/登记的非结构化资料（folder kind 'knowledge'）；chunk 供 BM25 检索召回。不接 draw_data 原始数据。
  db.exec(`
    CREATE TABLE IF NOT EXISTS knowledge_docs (
      id           TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL REFERENCES workspaces(id),
      title        TEXT NOT NULL,
      source_type  TEXT NOT NULL DEFAULT 'upload',
      path         TEXT,
      content      TEXT,
      tags         TEXT NOT NULL DEFAULT '[]',
      created_at   INTEGER NOT NULL,
      updated_at   INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_knowledge_docs_ws ON knowledge_docs(workspace_id, updated_at DESC);
    CREATE TABLE IF NOT EXISTS knowledge_chunks (
      id       TEXT PRIMARY KEY,
      doc_id   TEXT NOT NULL REFERENCES knowledge_docs(id),
      idx      INTEGER NOT NULL,
      text     TEXT NOT NULL,
      tokens   INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_knowledge_chunks_doc ON knowledge_chunks(doc_id, idx);
  `);

  // prompts 模板库 prompt_templates（prompts_mgmt 模块 · 总控 X 接缝审定 · CRUD 由 Agent-D 实装）。
  // workspace_id 可空 = 全局模板（跨工作区可见）；body 内 {{变量}} 占位仅存储，渲染由调用方做。
  // category 用于面板分组（如 "system" / "tool" / "user" / "draft"），自由文本不做枚举强约束。
  db.exec(`
    CREATE TABLE IF NOT EXISTS prompt_templates (
      id           TEXT PRIMARY KEY,
      workspace_id TEXT REFERENCES workspaces(id),
      title        TEXT NOT NULL,
      category     TEXT NOT NULL DEFAULT '',
      body         TEXT NOT NULL,
      variables    TEXT NOT NULL DEFAULT '[]',
      tags         TEXT NOT NULL DEFAULT '[]',
      created_at   INTEGER NOT NULL,
      updated_at   INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_prompt_templates_ws ON prompt_templates(workspace_id, updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_prompt_templates_cat ON prompt_templates(category);
  `);

  // ── 记忆 v2.0 缺口1：分层标签 tags 列（X-MEM2-CONTRACT 口径）──────────────
  // 新库由上方 CREATE TABLE 不含 tags（schema 保持与契约审定一致），旧库经此 idempotent
  // ALTER 补列。与 db.ts legacy 同款 PRAGMA table_info + 条件 ADD COLUMN（不碰 db.ts 接缝层）。
  // ponytail: 项目无 MIGRATIONS 版本注册器，沿用既有 PRAGMA+ALTER 范式即可；若未来表增多
  //           再抽 ensureColumn 公共工具。
  for (const tableName of ["memory_items", "memory_reviews"]) {
    const cols = db.prepare(`PRAGMA table_info(${tableName})`).all() as Array<{ name: string }>;
    if (!cols.some((c) => c.name === "tags")) {
      db.exec(`ALTER TABLE ${tableName} ADD COLUMN tags TEXT NOT NULL DEFAULT '[]'`);
    }
  }
}

// ============================================================================
// memory_items CRUD（规则记忆重构 v2 · D-DATA 实装）
// ----------------------------------------------------------------------------
// 接缝层（types.ts 联合 / db.ts 注册表 / index.ts legacy 路由）由总控持有，本文件不改。
// 启用关系沿用 workspace_memory_enablements(item_kind='memory_item')；feedback/usage
// 直接落本表 positive_signals/negative_signals/used_count/last_used_at 列（与旧
// memory_usage_stats 解耦：item 维度自治，不再与 5 类 sourceKind 维度合表）。
// ============================================================================

interface MemoryItemRow {
  id: string;
  workspace_id: string;
  type: string;
  title: string;
  body: string;
  tags: string;
  source: string;
  source_event_ids: string;
  confidence: number;
  risk_flags: string;
  valid_from: number;
  valid_until: number | null;
  supersedes_id: string | null;
  used_count: number;
  last_used_at: number | null;
  positive_signals: number;
  negative_signals: number;
  stale_after_days: number;
  scope: string;
  enabled: number;
  created_at: number;
  updated_at: number;
}

function parseStringArray(s: string): string[] {
  try {
    const v = JSON.parse(s) as unknown;
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

/** 规范化 tags：trim、去空、去重、保序、上限 32 个（防 prompt 污染 / 误传超长数组）。 */
function normalizeTags(tags: string[] | undefined): string[] {
  if (!Array.isArray(tags)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of tags) {
    if (typeof raw !== "string") continue;
    const t = raw.trim();
    if (!t || seen.has(t)) continue;
    seen.add(t);
    out.push(t);
    if (out.length >= 32) break;
  }
  return out;
}

const VALID_RISK_CODES = new Set(["instruction_injection", "pii", "weak_evidence", "overbroad"]);
const VALID_RISK_SEVERITIES = new Set(["low", "medium", "high"]);

export function parseRiskFlags(s: string): MemoryRiskFlag[] {
  try {
    const v = JSON.parse(s) as unknown;
    return coerceRiskFlags(v);
  } catch {
    return [];
  }
}

/** 从任意 unknown 输入校验并提取 MemoryRiskFlag[]（路由层用）。 */
export function coerceRiskFlags(v: unknown): MemoryRiskFlag[] {
  if (!Array.isArray(v)) return [];
  return v.filter((x): x is MemoryRiskFlag => {
    if (!x || typeof x !== "object") return false;
    const o = x as Record<string, unknown>;
    return typeof o.code === "string" && VALID_RISK_CODES.has(o.code)
      && typeof o.severity === "string" && VALID_RISK_SEVERITIES.has(o.severity);
  }) as MemoryRiskFlag[];
}

function rowToMemoryItem(r: MemoryItemRow): MemoryItem {
  return {
    id: r.id,
    workspaceId: r.workspace_id,
    type: r.type as MemoryItemType,
    title: r.title,
    body: r.body,
    tags: parseStringArray(r.tags),
    source: r.source as MemoryItemSource,
    sourceEventIds: parseStringArray(r.source_event_ids),
    confidence: r.confidence,
    riskFlags: parseRiskFlags(r.risk_flags),
    validFrom: r.valid_from,
    validUntil: r.valid_until,
    supersedesId: r.supersedes_id,
    usedCount: r.used_count,
    lastUsedAt: r.last_used_at,
    positiveSignals: r.positive_signals,
    negativeSignals: r.negative_signals,
    staleAfterDays: r.stale_after_days,
    scope: r.scope as MemoryItem["scope"],
    enabled: !!r.enabled,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

const VALID_TYPES: ReadonlySet<MemoryItemType> = new Set(["constraint", "experience", "episode"]);
const VALID_SOURCES: ReadonlySet<MemoryItemSource> = new Set(["manual", "trace", "derived"]);
const VALID_SCOPES: ReadonlySet<MemoryItem["scope"]> = new Set(["global", "chat", "workflow"]);

export function createMemoryItem(input: MemoryItemInput): MemoryItem {
  if (!VALID_TYPES.has(input.type)) throw new Error(`invalid memory item type: ${input.type}`);
  if (!input.workspaceId) throw new Error("workspaceId required");
  if (!input.title) throw new Error("title required");
  const id = randomUUID();
  const now = Date.now();
  const source: MemoryItemSource = input.source && VALID_SOURCES.has(input.source) ? input.source : "manual";
  const scope: MemoryItem["scope"] = input.scope && VALID_SCOPES.has(input.scope) ? input.scope : "global";
  const confidence = typeof input.confidence === "number"
    ? Math.max(0, Math.min(1, input.confidence))
    : 1;
  const staleAfterDays = typeof input.staleAfterDays === "number" && input.staleAfterDays > 0
    ? Math.floor(input.staleAfterDays)
    : 90;
  db.prepare(`
    INSERT INTO memory_items (
      id, workspace_id, type, title, body, tags, source, source_event_ids,
      confidence, risk_flags, valid_from, valid_until, supersedes_id,
      used_count, last_used_at, positive_signals, negative_signals,
      stale_after_days, scope, enabled, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, NULL, 0, 0, ?, ?, 1, ?, ?)
  `).run(
    id,
    input.workspaceId,
    input.type,
    input.title,
    input.body,
    JSON.stringify(normalizeTags(input.tags)),
    source,
    JSON.stringify(input.sourceEventIds ?? []),
    confidence,
    JSON.stringify(input.riskFlags ?? []),
    now,
    input.validUntil ?? null,
    input.supersedesId ?? null,
    staleAfterDays,
    scope,
    now,
    now,
  );
  // 全局池 + 按工作区启用：origin 工作区默认启用（与 rule/standard/case/metric 同范式）。
  enableForOrigin(input.workspaceId, "memory_item", id);
  const created = getMemoryItem(id);
  if (!created) throw new Error("failed to read back inserted memory_item");
  return created;
}

export function getMemoryItem(id: string): MemoryItem | undefined {
  const r = db.prepare("SELECT * FROM memory_items WHERE id = ?").get(id) as MemoryItemRow | undefined;
  return r ? rowToMemoryItem(r) : undefined;
}

/** 全局池：返回所有工作区条目；可按 workspaceId/type 过滤；启用筛选见 listEnabledMemoryItems。 */
export function listMemoryItems(filter: { workspaceId?: string; type?: MemoryItemType } = {}): MemoryItem[] {
  const where: string[] = [];
  const params: Array<string> = [];
  if (filter.workspaceId) { where.push("workspace_id = ?"); params.push(filter.workspaceId); }
  if (filter.type) { where.push("type = ?"); params.push(filter.type); }
  const sql = `SELECT * FROM memory_items${where.length ? ` WHERE ${where.join(" AND ")}` : ""} ORDER BY updated_at DESC`;
  return (db.prepare(sql).all(...params) as unknown as MemoryItemRow[]).map(rowToMemoryItem);
}

/** 本工作区已启用的 memory_items（全局池 + workspace_memory_enablements 联动）。 */
export function listEnabledMemoryItems(workspaceId: string, type?: MemoryItemType): MemoryItem[] {
  const ids = new Set(listEnabledItemIds(workspaceId, "memory_item"));
  if (ids.size === 0) return [];
  return listMemoryItems({ workspaceId, type }).filter((m) => ids.has(m.id));
}

export interface MemoryItemPatch {
  title?: string;
  body?: string;
  type?: MemoryItemType;
  tags?: string[];
  confidence?: number;
  riskFlags?: MemoryRiskFlag[];
  sourceEventIds?: string[];
  validUntil?: number | null;
  supersedesId?: string | null;
  staleAfterDays?: number;
  scope?: MemoryItem["scope"];
  enabled?: boolean;
}

/** 列级 patch：未提供字段保持不变；返回更新后实体；id 不存在返回 undefined。 */
export function updateMemoryItem(id: string, patch: MemoryItemPatch): MemoryItem | undefined {
  const existing = getMemoryItem(id);
  if (!existing) return undefined;
  const sets: string[] = [];
  const params: Array<string | number | null> = [];
  if (patch.title !== undefined) { sets.push("title = ?"); params.push(patch.title); }
  if (patch.body !== undefined) { sets.push("body = ?"); params.push(patch.body); }
  if (patch.tags !== undefined) { sets.push("tags = ?"); params.push(JSON.stringify(normalizeTags(patch.tags))); }
  if (patch.type !== undefined) {
    if (!VALID_TYPES.has(patch.type)) throw new Error(`invalid memory item type: ${patch.type}`);
    sets.push("type = ?"); params.push(patch.type);
  }
  if (patch.confidence !== undefined) {
    sets.push("confidence = ?"); params.push(Math.max(0, Math.min(1, patch.confidence)));
  }
  if (patch.riskFlags !== undefined) {
    sets.push("risk_flags = ?"); params.push(JSON.stringify(patch.riskFlags));
  }
  if (patch.sourceEventIds !== undefined) {
    sets.push("source_event_ids = ?"); params.push(JSON.stringify(patch.sourceEventIds));
  }
  if (patch.validUntil !== undefined) {
    sets.push("valid_until = ?"); params.push(patch.validUntil);
  }
  if (patch.supersedesId !== undefined) {
    sets.push("supersedes_id = ?"); params.push(patch.supersedesId);
  }
  if (patch.staleAfterDays !== undefined) {
    sets.push("stale_after_days = ?"); params.push(Math.max(1, Math.floor(patch.staleAfterDays)));
  }
  if (patch.scope !== undefined) {
    if (!VALID_SCOPES.has(patch.scope)) throw new Error(`invalid memory item scope: ${patch.scope}`);
    sets.push("scope = ?"); params.push(patch.scope);
  }
  if (patch.enabled !== undefined) {
    sets.push("enabled = ?"); params.push(patch.enabled ? 1 : 0);
    // 同步 workspace_memory_enablements（listEnabledMemoryItems 读的是 enablement 表）
    setMemoryEnablement(existing.workspaceId, "memory_item", id, patch.enabled);
  }
  if (sets.length === 0) return getMemoryItem(id);
  sets.push("updated_at = ?"); params.push(Date.now());
  params.push(id);
  db.prepare(`UPDATE memory_items SET ${sets.join(", ")} WHERE id = ?`).run(...params);
  return getMemoryItem(id);
}

/** 删除 memory_item；启用关系级联清理（保持与池条目同生命周期）。 */
export function deleteMemoryItem(id: string): boolean {
  const r = db.prepare("DELETE FROM memory_items WHERE id = ?").run(id);
  if (r.changes > 0) {
    db.prepare("DELETE FROM workspace_memory_enablements WHERE item_kind = 'memory_item' AND item_id = ?").run(id);
    return true;
  }
  return false;
}

/** 反馈信号：positive/negative 累加到 item 自身（与 D-RETRIEVAL 衰减打分配套）。 */
export function recordMemoryItemFeedback(
  id: string,
  signal: "positive" | "negative",
): MemoryItem | undefined {
  if (!getMemoryItem(id)) return undefined;
  const now = Date.now();
  if (signal === "positive") {
    db.prepare("UPDATE memory_items SET positive_signals = positive_signals + 1, updated_at = ? WHERE id = ?")
      .run(now, id);
  } else {
    db.prepare("UPDATE memory_items SET negative_signals = negative_signals + 1, updated_at = ? WHERE id = ?")
      .run(now, id);
  }
  return getMemoryItem(id);
}

/** 命中/使用：used_count++ 与 last_used_at 写入（D-RETRIEVAL 注入命中时调用）。 */
export function recordMemoryItemUsed(id: string, usedAt = Date.now()): MemoryItem | undefined {
  if (!getMemoryItem(id)) return undefined;
  db.prepare("UPDATE memory_items SET used_count = used_count + 1, last_used_at = ?, updated_at = ? WHERE id = ?")
    .run(usedAt, usedAt, id);
  return getMemoryItem(id);
}

// ============================================================================
// fact adapter（D-DATA · 实时投影 · 不写表 · 不接管生命周期）
// ----------------------------------------------------------------------------
// 把 business_contexts + metric_definitions + reference 文件投影成统一 MemoryItem
// 形态参与检索（type='fact'）。X-CONTRACT 当前 MemoryItemType 联合不含 'fact'，回流总控
// 决议；本文件用 D 域内部联合类型 ProjectedFactItem 暴露给 D-RETRIEVAL/D-PANEL，避免
// 污染接缝层。
//
// 数据安全：
//   - business_contexts/metric_definitions：定义本身即业务参数，已被 prompt 层引用，
//     投影只读 title+content+formula+caliber 等元数据列，不读 draw_data。
//   - reference_file：仅投影 name+filePath+description+fileHash 元信息，不读取文件正文
//     （文件正文由分析时具备工具/路径权限的 agent 按需读，与本投影解耦）。
//   - fact 不入 memory_items 表，因此 enablement/feedback/usage 仍由各自源头池管控；
//     检索层视其为只读召回结果。
// ============================================================================

// ProjectedFactKind / ProjectedFactItem 已上移至 types.ts（双侧契约），见顶部 re-export。

/** business_contexts 投影：title=title, body=content。 */
export function projectBusinessContextsAsFacts(workspaceId: string): ProjectedFactItem[] {
  const enabledIds = new Set(listEnabledItemIds(workspaceId, "business_context"));
  // listBusinessContexts 是全局池（无 ws 过滤），按启用关系筛本工作区。
  return listBusinessContexts()
    .filter((c) => enabledIds.has(c.id))
    .map((c) => ({
      id: `fact:business_context:${c.id}`,
      workspaceId,
      type: "fact" as const,
      factKind: "business_context" as const,
      sourceId: c.id,
      title: c.title,
      body: c.content,
      meta: { category: c.category, originWorkspaceId: c.workspaceId },
      enabled: c.enabled,
      confidence: 1,
      validFrom: c.createdAt,
      validUntil: null,
      createdAt: c.createdAt,
      updatedAt: c.updatedAt,
    }));
}

/** metric_definitions 投影：title=name, body=description+formula+caliber 拼合。 */
export function projectMetricDefinitionsAsFacts(workspaceId: string): ProjectedFactItem[] {
  // listEnabledMetricDefinitions 已应用启用关系（kind='metric'）。
  return listEnabledMetricDefinitions(workspaceId).map((m) => {
    const bodyParts = [
      m.description ? `含义：${m.description}` : "",
      m.formula ? `公式：${m.formula}` : "",
      m.caliber ? `口径：${m.caliber}` : "",
      m.unit ? `单位：${m.unit}` : "",
    ].filter(Boolean);
    return {
      id: `fact:metric_definition:${m.id}`,
      workspaceId,
      type: "fact" as const,
      factKind: "metric_definition" as const,
      sourceId: m.id,
      title: m.name,
      body: bodyParts.join("\n"),
      meta: {
        category: m.category ?? "",
        unit: m.unit ?? "",
        objectTypeId: m.objectTypeId ?? null,
        originWorkspaceId: m.workspaceId,
      },
      enabled: m.enabled,
      confidence: 1,
      validFrom: m.createdAt,
      validUntil: null,
      createdAt: m.createdAt,
      updatedAt: m.updatedAt,
    };
  });
}

/** reference 文件投影：仅元数据，不读文件正文，避免越过数据安全分级。 */
export function projectReferenceFilesAsFacts(workspaceId: string): ProjectedFactItem[] {
  const enabledStandardIds = new Set(listEnabledItemIds(workspaceId, "standard"));
  return listAnalysisStandards()
    .filter((s) => s.kind === "reference_file" && enabledStandardIds.has(s.id))
    .map((s) => {
      const meta: Record<string, string | number | null> = {
        category: s.category ?? "",
        filePath: s.filePath ?? "",
        fileHash: s.fileHash ?? null,
        originWorkspaceId: s.workspaceId,
      };
      // 文件大小若可读则一并暴露（不读内容），便于 RETRIEVAL/PANEL 展示。
      if (s.filePath) {
        try {
          const st = statSync(s.filePath);
          meta.fileSize = st.size;
        } catch {
          // 文件可能被移走/无权限读 stat：投影不影响主流程。
        }
      }
      return {
        id: `fact:reference_file:${s.id}`,
        workspaceId,
        type: "fact" as const,
        factKind: "reference_file" as const,
        sourceId: s.id,
        title: s.name,
        body: s.description ?? "",
        meta,
        enabled: s.enabled,
        confidence: 1,
        validFrom: s.createdAt,
        validUntil: null,
        createdAt: s.createdAt,
        updatedAt: s.updatedAt,
      };
    });
}

/** 统一入口：合并三种 fact 投影（business_context + metric_definition + reference_file）。 */
export function listProjectedFacts(workspaceId: string): ProjectedFactItem[] {
  return [
    ...projectBusinessContextsAsFacts(workspaceId),
    ...projectMetricDefinitionsAsFacts(workspaceId),
    ...projectReferenceFilesAsFacts(workspaceId),
  ];
}

// ============================================================================
// 候选记忆入库门禁（D-INGEST · 阶段2）
// ----------------------------------------------------------------------------
// E 蒸馏 runner POST 候选(MemoryCandidate + source/targetKind/targetId) -> 本门禁:
//   1. 权威风险检测: 覆盖 instruction_injection / pii / weak_evidence / overbroad,
//      不盲信 E 预标; E 的 risk_flags 仅作输入参考, 最终以本层重算为准.
//   2. dedup: 泛化 detectRuleConflicts 思路, 按 normalize(title) 同主题 + 同 type 命中
//      则按 supersede 逻辑挂上 supersedesId, 避免 memory_items 表语义重复污染.
//   3. 分流:
//        - 高危(任一 high) -> 拒绝(不写表, 返回 error).
//        - 置信度 >= AUTO_CONFIDENCE_THRESHOLD 且无 medium+ 风险 -> 自动入库
//          (source='derived', 落库即 enableForOrigin).
//        - 其余 -> 写 memory_reviews(status='pending'), 供 D-PANEL 一键采纳/拒绝.
//
// 数据安全: 候选 title/body 已是 LLM 衍生产物 (E 蒸馏从 trace 提炼), 不读 draw_data.
// 拒绝原因 + risk_flags 写回响应/review 行, 便于 D-PANEL 展示治理理由.
// ============================================================================

const AUTO_CONFIDENCE_THRESHOLD = 0.75;

// MemoryReview 已上移至 types.ts（双侧契约），见顶部 re-export。

export interface MemoryIngestInput {
  workspaceId: string;
  type: MemoryItemType;
  title: string;
  body: string;
  tags?: string[];
  scope: MemoryItem["scope"];
  sourceEventIds: string[];
  confidence: number;
  riskFlags: MemoryRiskFlag[];
  targetKind?: string | null;
  targetId?: string | null;
}

export type MemoryIngestVerdict =
  | { kind: "accepted"; item: MemoryItem; supersededId: string | null; riskFlags: MemoryRiskFlag[]; confidence: number }
  | { kind: "review"; review: MemoryReview }
  | { kind: "rejected"; reason: string; riskFlags: MemoryRiskFlag[] };

interface MemoryReviewRow {
  id: string;
  workspace_id: string;
  type: string;
  title: string;
  body: string;
  tags: string;
  scope: string;
  source_event_ids: string;
  confidence: number;
  risk_flags: string;
  target_kind: string | null;
  target_id: string | null;
  reason: string;
  status: string;
  decided_item_id: string | null;
  decided_reason: string;
  created_at: number;
  updated_at: number;
}

function rowToMemoryReview(r: MemoryReviewRow): MemoryReview {
  return {
    id: r.id,
    workspaceId: r.workspace_id,
    type: r.type as MemoryItemType,
    title: r.title,
    body: r.body,
    tags: parseStringArray(r.tags),
    scope: r.scope as MemoryItem["scope"],
    sourceEventIds: parseStringArray(r.source_event_ids),
    confidence: r.confidence,
    riskFlags: parseRiskFlags(r.risk_flags),
    targetKind: r.target_kind,
    targetId: r.target_id,
    reason: r.reason,
    status: (r.status === "accepted" || r.status === "rejected") ? r.status : "pending",
    decidedItemId: r.decided_item_id,
    decidedReason: r.decided_reason,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

function normalizeTitle(s: string): string {
  return s.toLowerCase().replace(/[^\p{L}\p{N}\u4e00-\u9fa5]+/gu, "");
}

/**
 * 权威风险检测: 与 E 端 applyHeuristicGovernance 同语义但独立实现, 正则覆盖
 * E 的 instruction_injection / pii / weak_evidence / overbroad 四类, 并对 confidence
 * 做 high -> cap 0.4 / medium -> 减 0.2 的兜底. E 预标可能宽松或漏检, 本层重算覆盖.
 */
export function detectMemoryCandidateRisk(input: {
  title: string;
  body: string;
  sourceEventIds: string[];
  confidence: number;
}): { confidence: number; riskFlags: MemoryRiskFlag[] } {
  const text = `${input.title}\n${input.body}`;
  const flags: MemoryRiskFlag[] = [];
  if (/(ignore|disregard|override).{0,30}(previous|above|system|developer|instruction)|jailbreak|system prompt|developer message|忽略.{0,12}(以上|之前|系统|规则)|无视.{0,12}(以上|之前|系统|规则)|覆盖.{0,12}(系统|规则|指令)/i.test(text)) {
    flags.push({ code: "instruction_injection", severity: "high", message: "疑似覆盖系统/开发者指令或 jailbreak 内容" });
  }
  if (/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i.test(text) || /\b1[3-9]\d{9}\b/.test(text) || /\b\d{17}[\dXx]\b/.test(text)) {
    flags.push({ code: "pii", severity: "high", message: "疑似 email/手机号/身份证号" });
  }
  if (input.body.trim().length < 20 || input.sourceEventIds.length === 0) {
    flags.push({ code: "weak_evidence", severity: "medium", message: "证据不足: 正文过短或缺少 trace event 关联" });
  }
  if (input.title.trim().length < 6 || /^(注意|优化|改进|提升|处理|分析|遵守)$/.test(input.title.trim())) {
    flags.push({ code: "overbroad", severity: "medium", message: "标题过宽泛, 可能污染后续 prompt" });
  }
  const hasHigh = flags.some((f) => f.severity === "high");
  const hasMedium = flags.some((f) => f.severity === "medium");
  let confidence = Math.max(0, Math.min(1, input.confidence));
  if (hasHigh) confidence = Math.min(confidence, 0.4);
  else if (hasMedium) confidence = Math.max(0, confidence - 0.2);
  return { confidence, riskFlags: flags };
}

/**
 * dedup: 找当前工作区同 type 下 title normalize 后包含/被包含的活跃 item,
 * 命中视为 supersede 关系 (候选取代旧条目). 命中只取最新一条; 返回 null = 无重复.
 * 泛化 detectRuleConflicts 的思路 (normalize 同主题) 但走"覆盖"而非"冲突"路径,
 * 因为候选记忆按设计是迭代刷新, 而非并存对立.
 */
export function findMemoryItemDuplicate(workspaceId: string, type: MemoryItemType, title: string): MemoryItem | null {
  const norm = normalizeTitle(title);
  if (!norm) return null;
  const peers = listMemoryItems({ workspaceId, type });
  for (const peer of peers) {
    if (!peer.enabled) continue;
    const peerNorm = normalizeTitle(peer.title);
    if (!peerNorm) continue;
    if (peerNorm === norm) return peer;
    if (peerNorm.length >= 6 && norm.length >= 6
      && (peerNorm.includes(norm) || norm.includes(peerNorm))) {
      return peer;
    }
  }
  return null;
}

/**
 * 切 token: 中英混合, 英文按非字母数字拆 + lower; 中文按 2-gram (一个字 + 相邻字).
 * 短文本足够用; 不引外部分词器. 只服务 shortlist 排序, 不需要语言学严谨.
 */
function tokenizeForOverlap(s: string): Set<string> {
  const out = new Set<string>();
  const lower = s.toLowerCase();
  // 英文/数字 token
  for (const m of lower.match(/[a-z0-9]{2,}/g) ?? []) out.add(m);
  // 中文 2-gram
  const han = lower.replace(/[^\u4e00-\u9fa5]+/g, " ").trim();
  for (const seg of han.split(/\s+/)) {
    if (seg.length === 1) {
      out.add(seg);
    } else {
      for (let i = 0; i < seg.length - 1; i++) out.add(seg.slice(i, i + 2));
    }
  }
  return out;
}

/**
 * 语义 dedup 候选缩集: 同 type 已启用 memory_items 中按 title+body token 与候选词法重叠度排序,
 * 重叠 > 0 的前 k 条作为 shortlist (纯 db + JS, 不调 LLM). 返回空数组 = 无近邻.
 * 上游 (memory-dedup.ts) 拿到非空 shortlist 才会触发 LLM-judge, 这层是成本门控的第一道闸.
 */
export function findSemanticDedupShortlist(
  workspaceId: string,
  type: MemoryItemType,
  candidateTitle: string,
  candidateBody: string,
  k = 8,
): MemoryItem[] {
  const candTokens = tokenizeForOverlap(`${candidateTitle}\n${candidateBody}`);
  if (candTokens.size === 0) return [];
  const peers = listMemoryItems({ workspaceId, type }).filter((p) => p.enabled);
  const scored: { item: MemoryItem; overlap: number }[] = [];
  for (const peer of peers) {
    const peerTokens = tokenizeForOverlap(`${peer.title}\n${peer.body}`);
    let overlap = 0;
    for (const t of candTokens) if (peerTokens.has(t)) overlap++;
    if (overlap > 0) scored.push({ item: peer, overlap });
  }
  scored.sort((a, b) => b.overlap - a.overlap);
  return scored.slice(0, k).map((s) => s.item);
}

function insertMemoryReview(input: MemoryIngestInput, reason: string, riskFlags: MemoryRiskFlag[], confidence: number): MemoryReview {
  const id = randomUUID();
  const now = Date.now();
  db.prepare(`
    INSERT INTO memory_reviews (
      id, workspace_id, type, title, body, tags, scope, source_event_ids,
      confidence, risk_flags, target_kind, target_id, reason, status,
      decided_item_id, decided_reason, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', NULL, '', ?, ?)
  `).run(
    id,
    input.workspaceId,
    input.type,
    input.title,
    input.body,
    JSON.stringify(normalizeTags(input.tags)),
    input.scope,
    JSON.stringify(input.sourceEventIds),
    confidence,
    JSON.stringify(riskFlags),
    input.targetKind ?? null,
    input.targetId ?? null,
    reason,
    now,
    now,
  );
  const row = db.prepare("SELECT * FROM memory_reviews WHERE id = ?").get(id) as unknown as MemoryReviewRow;
  return rowToMemoryReview(row);
}

/**
 * 门禁主入口: 风险检测 + dedup + 分流. E runner 通过 routes/data.ts 的 ingest
 * 端点调用本函数; 返回 verdict 让路由层决定 HTTP 响应.
 *
 * semanticDupId (可选): 调用方 (路由层) 在词法 dedup 漏判时, 通过 LLM-judge 拿到
 * 的语义重复 item id. 仅当 findMemoryItemDuplicate 返回 null 且 semanticDupId 指向
 * 同 workspace 同 type 的活跃 item 时才采纳; supersede 路径不变.
 */
export function ingestMemoryCandidate(input: MemoryIngestInput, semanticDupId?: string | null): MemoryIngestVerdict {
  const { confidence, riskFlags } = detectMemoryCandidateRisk({
    title: input.title,
    body: input.body,
    sourceEventIds: input.sourceEventIds,
    confidence: input.confidence,
  });
  const hasHigh = riskFlags.some((f) => f.severity === "high");
  if (hasHigh) {
    const reason = "候选包含高危信号: " + riskFlags
      .filter((f) => f.severity === "high")
      .map((f) => f.code)
      .join(", ");
    return { kind: "rejected", reason, riskFlags };
  }
  const hasMedium = riskFlags.some((f) => f.severity === "medium");
  let dup = findMemoryItemDuplicate(input.workspaceId, input.type, input.title);
  // 词法漏判时启用 LLM-judge 给出的语义近邻 (调用方负责调 judge); 校验 id 在同 ws+type+enabled.
  if (!dup && semanticDupId) {
    const candidate = getMemoryItem(semanticDupId);
    if (candidate
      && candidate.workspaceId === input.workspaceId
      && candidate.type === input.type
      && candidate.enabled) {
      dup = candidate;
    }
  }
  // 自动入库分支: 高置信 + 无 medium 风险. 命中 dup -> supersede (新条目接替旧条目).
  if (confidence >= AUTO_CONFIDENCE_THRESHOLD && !hasMedium) {
    const item = createMemoryItem({
      workspaceId: input.workspaceId,
      type: input.type,
      title: input.title,
      body: input.body,
      tags: input.tags,
      source: "derived",
      sourceEventIds: input.sourceEventIds,
      confidence,
      riskFlags,
      scope: input.scope,
      supersedesId: dup ? dup.id : null,
    });
    // supersede 时把旧条目 enabled 关闭 (保留行做血缘追溯, 但不再注入).
    if (dup) {
      updateMemoryItem(dup.id, { enabled: false });
    }
    return { kind: "accepted", item, supersededId: dup ? dup.id : null, riskFlags, confidence };
  }
  // 复核分支: medium 风险 / 置信度不达阈 / dedup 命中需人工确认 -> 进 review 队列.
  const reviewReason = (() => {
    if (dup) return `检测到与 item ${dup.id} 同主题重复, 等待人工确认是否替换`;
    if (hasMedium) return `存在中危信号: ${riskFlags.filter((f) => f.severity === "medium").map((f) => f.code).join(", ")}`;
    return `置信度 ${confidence.toFixed(2)} 低于自动入库阈值 ${AUTO_CONFIDENCE_THRESHOLD}`;
  })();
  const review = insertMemoryReview(input, reviewReason, riskFlags, confidence);
  return { kind: "review", review };
}

// ---- review 队列 CRUD (供 D-PANEL) ----

export function listMemoryReviews(workspaceId: string, status?: MemoryReview["status"]): MemoryReview[] {
  const rows = (status
    ? db.prepare("SELECT * FROM memory_reviews WHERE workspace_id = ? AND status = ? ORDER BY updated_at DESC").all(workspaceId, status)
    : db.prepare("SELECT * FROM memory_reviews WHERE workspace_id = ? ORDER BY updated_at DESC").all(workspaceId)
  ) as unknown as MemoryReviewRow[];
  return rows.map(rowToMemoryReview);
}

export function getMemoryReview(id: string): MemoryReview | undefined {
  const row = db.prepare("SELECT * FROM memory_reviews WHERE id = ?").get(id) as unknown as MemoryReviewRow | undefined;
  return row ? rowToMemoryReview(row) : undefined;
}

/** 一键采纳: review 转为 memory_item (source='derived'), 标记 review accepted 并关联 item id. */
export function acceptMemoryReview(id: string): { review: MemoryReview; item: MemoryItem } | undefined {
  const review = getMemoryReview(id);
  if (!review || review.status !== "pending") return undefined;
  const dup = findMemoryItemDuplicate(review.workspaceId, review.type, review.title);
  const item = createMemoryItem({
    workspaceId: review.workspaceId,
    type: review.type,
    title: review.title,
    body: review.body,
    tags: review.tags,
    source: "derived",
    sourceEventIds: review.sourceEventIds,
    confidence: review.confidence,
    riskFlags: review.riskFlags,
    scope: review.scope,
    supersedesId: dup ? dup.id : null,
  });
  if (dup) updateMemoryItem(dup.id, { enabled: false });
  const now = Date.now();
  db.prepare("UPDATE memory_reviews SET status = 'accepted', decided_item_id = ?, decided_reason = ?, updated_at = ? WHERE id = ?")
    .run(item.id, "panel accept", now, id);
  const refreshed = getMemoryReview(id);
  if (!refreshed) return undefined;
  return { review: refreshed, item };
}

export function rejectMemoryReview(id: string, reason: string): MemoryReview | undefined {
  const review = getMemoryReview(id);
  if (!review || review.status !== "pending") return undefined;
  const now = Date.now();
  db.prepare("UPDATE memory_reviews SET status = 'rejected', decided_reason = ?, updated_at = ? WHERE id = ?")
    .run(reason || "panel reject", now, id);
  return getMemoryReview(id);
}

// ============================================================================
// 知识库 knowledge_docs / knowledge_chunks（D-DATA 实装 · 总控 X 接缝审定 schema）
// ----------------------------------------------------------------------------
// 文档 = 用户上传/登记的非结构化资料（folder kind 'knowledge'），与 draw_data 严格分离。
// 分块策略：段落优先（参 onto-extract.chunkText），最后一片不足窗口则并入前片，避免 slice
// 末尾出现"半句"。chunk 同步用于 BM25 召回（见 knowledge-retrieval.ts）。
// ============================================================================

interface KnowledgeDocRow {
  id: string;
  workspace_id: string;
  title: string;
  source_type: string;
  path: string | null;
  content: string | null;
  tags: string;
  created_at: number;
  updated_at: number;
}

function rowToKnowledgeDoc(r: KnowledgeDocRow): KnowledgeDoc {
  return {
    id: r.id,
    workspaceId: r.workspace_id,
    title: r.title,
    sourceType: r.source_type === "path" ? "path" : "upload",
    path: r.path,
    content: r.content,
    tags: parseStringArray(r.tags),
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

const KNOWLEDGE_CHUNK_BUDGET = 1200; // chars，约 600~800 tokens（中英混合）
const KNOWLEDGE_CHUNK_OVERLAP = 120;

/**
 * 段落感知分块：与 onto-extract.chunkText 同形，但使用更小窗口适配检索粒度。
 * 不强行 slice 末尾——尾片 < overlap 时并入前片（拼接 [end..length)，不重复已有内容）。
 */
export function chunkKnowledgeText(text: string): string[] {
  const trimmed = text.trim();
  if (!trimmed) return [];
  if (trimmed.length <= KNOWLEDGE_CHUNK_BUDGET) return [trimmed];
  const chunks: string[] = [];
  let start = 0;
  while (start < trimmed.length) {
    let end = Math.min(start + KNOWLEDGE_CHUNK_BUDGET, trimmed.length);
    if (end < trimmed.length) {
      const paraBreak = trimmed.lastIndexOf("\n\n", end);
      if (paraBreak > start + KNOWLEDGE_CHUNK_BUDGET * 0.5) {
        end = paraBreak + 2;
      } else {
        const lineBreak = trimmed.lastIndexOf("\n", end);
        if (lineBreak > start + KNOWLEDGE_CHUNK_BUDGET * 0.5) {
          end = lineBreak + 1;
        }
      }
    }
    chunks.push(trimmed.slice(start, end));
    if (end >= trimmed.length) break;
    const remaining = trimmed.length - end;
    // 尾片若不足 overlap 阈值，把未读尾巴 [end..length) 拼到前片，避免再开一个微碎片。
    // 注意：拼的是未读区，不是已写过的 [start..end)，杜绝"重复 tail"。
    if (remaining <= KNOWLEDGE_CHUNK_OVERLAP) {
      chunks[chunks.length - 1] += trimmed.slice(end);
      break;
    }
    start = end - KNOWLEDGE_CHUNK_OVERLAP;
  }
  return chunks;
}

export function createKnowledgeDoc(input: KnowledgeDocInput): KnowledgeDoc {
  if (!input.workspaceId) throw new Error("workspaceId required");
  const title = input.title.trim();
  if (!title) throw new Error("title required");
  const content = input.content ?? "";
  const id = randomUUID();
  const now = Date.now();
  const sourceType = input.sourceType === "path" ? "path" : "upload";
  const tags = Array.isArray(input.tags) ? input.tags.filter((t): t is string => typeof t === "string" && !!t) : [];
  db.exec("BEGIN");
  try {
    db.prepare(`
      INSERT INTO knowledge_docs (id, workspace_id, title, source_type, path, content, tags, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, input.workspaceId, title, sourceType, input.path ?? null, content, JSON.stringify(tags), now, now);
    writeChunksFor(id, content);
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
  return getKnowledgeDoc(id) as KnowledgeDoc;
}

function writeChunksFor(docId: string, content: string): void {
  db.prepare("DELETE FROM knowledge_chunks WHERE doc_id = ?").run(docId);
  const pieces = chunkKnowledgeText(content);
  if (pieces.length === 0) return;
  const insert = db.prepare(`
    INSERT INTO knowledge_chunks (id, doc_id, idx, text, tokens) VALUES (?, ?, ?, ?, ?)
  `);
  for (let i = 0; i < pieces.length; i++) {
    const text = pieces[i]!;
    insert.run(randomUUID(), docId, i, text, Math.ceil(text.length / 4));
  }
}

export function getKnowledgeDoc(id: string): KnowledgeDoc | undefined {
  const r = db.prepare("SELECT * FROM knowledge_docs WHERE id = ?").get(id) as unknown as KnowledgeDocRow | undefined;
  return r ? rowToKnowledgeDoc(r) : undefined;
}

export function listKnowledgeDocs(workspaceId: string): KnowledgeDoc[] {
  return (db.prepare("SELECT * FROM knowledge_docs WHERE workspace_id = ? ORDER BY updated_at DESC").all(workspaceId) as unknown as KnowledgeDocRow[])
    .map(rowToKnowledgeDoc);
}

export function updateKnowledgeDoc(id: string, patch: KnowledgeDocPatch): KnowledgeDoc | undefined {
  const existing = getKnowledgeDoc(id);
  if (!existing) return undefined;
  const sets: string[] = [];
  const params: (string | number | null)[] = [];
  if (typeof patch.title === "string") {
    const t = patch.title.trim();
    if (!t) throw new Error("title required");
    sets.push("title = ?"); params.push(t);
  }
  if (patch.path === null || typeof patch.path === "string") { sets.push("path = ?"); params.push(patch.path); }
  if (Array.isArray(patch.tags)) {
    sets.push("tags = ?");
    params.push(JSON.stringify(patch.tags.filter((t): t is string => typeof t === "string")));
  }
  const contentChanged = typeof patch.content === "string" && patch.content !== existing.content;
  if (contentChanged) { sets.push("content = ?"); params.push(patch.content!); }
  if (sets.length === 0) return existing;
  const now = Date.now();
  sets.push("updated_at = ?"); params.push(now);
  params.push(id);
  db.exec("BEGIN");
  try {
    db.prepare(`UPDATE knowledge_docs SET ${sets.join(", ")} WHERE id = ?`).run(...params);
    if (contentChanged) writeChunksFor(id, patch.content!);
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
  return getKnowledgeDoc(id);
}

export function deleteKnowledgeDoc(id: string): boolean {
  db.exec("BEGIN");
  try {
    db.prepare("DELETE FROM knowledge_chunks WHERE doc_id = ?").run(id);
    db.prepare("DELETE FROM knowledge_docs WHERE id = ?").run(id);
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
  return true;
}

export function listKnowledgeChunks(docId: string): KnowledgeChunk[] {
  return db.prepare(
    "SELECT id, doc_id AS docId, idx, text, tokens FROM knowledge_chunks WHERE doc_id = ? ORDER BY idx ASC",
  ).all(docId) as unknown as KnowledgeChunk[];
}

/**
 * Workspace-wide chunk join, with parent doc fields used by BM25 retrieval.
 * Filters by docIds when provided.
 */
export function listKnowledgeChunksForRetrieval(workspaceId: string, docIds?: string[]): Array<{
  chunk: KnowledgeChunk;
  docTitle: string;
  docPath: string | null;
  docTags: string[];
  docUpdatedAt: number;
}> {
  const params: string[] = [workspaceId];
  let where = "d.workspace_id = ?";
  if (docIds && docIds.length > 0) {
    where += ` AND d.id IN (${docIds.map(() => "?").join(",")})`;
    params.push(...docIds);
  }
  const rows = db.prepare(`
    SELECT c.id AS id, c.doc_id AS docId, c.idx AS idx, c.text AS text, c.tokens AS tokens,
           d.title AS docTitle, d.path AS docPath, d.tags AS docTags, d.updated_at AS docUpdatedAt
    FROM knowledge_chunks c JOIN knowledge_docs d ON d.id = c.doc_id
    WHERE ${where}
  `).all(...params) as unknown as Array<{
    id: string; docId: string; idx: number; text: string; tokens: number | null;
    docTitle: string; docPath: string | null; docTags: string; docUpdatedAt: number;
  }>;
  return rows.map((r) => ({
    chunk: { id: r.id, docId: r.docId, idx: r.idx, text: r.text, tokens: r.tokens },
    docTitle: r.docTitle,
    docPath: r.docPath,
    docTags: parseStringArray(r.docTags),
    docUpdatedAt: r.docUpdatedAt,
  }));
}

// ============================================================================
// prompts 模板库 prompt_templates（D-DATA 实装 · 总控 X 接缝审定 schema）
// ----------------------------------------------------------------------------
// workspace_id 可空 = 全局模板（跨工作区可见）；list 默认返回 「该工作区 ∪ 全局」。
// body 内 {{变量}} 占位仅存储；渲染（替换/校验）由调用方做。本层只做形状抽取
// （extractPromptVariables）以便面板展示和 input.variables 缺省补齐。
// 过滤维度：category 精确匹配（自由文本枚举，由面板约定），tags 包含任一匹配。
// ============================================================================

interface PromptTemplateRow {
  id: string;
  workspace_id: string | null;
  title: string;
  category: string;
  body: string;
  variables: string;
  tags: string;
  created_at: number;
  updated_at: number;
}

function rowToPromptTemplate(r: PromptTemplateRow): PromptTemplate {
  return {
    id: r.id,
    workspaceId: r.workspace_id,
    title: r.title,
    category: r.category,
    body: r.body,
    variables: parseStringArray(r.variables),
    tags: parseStringArray(r.tags),
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

const PROMPT_VARIABLE_RE = /\{\{\s*([a-zA-Z_][\w.-]*)\s*\}\}/g;

/** 从 body 中抽取 `{{name}}` 占位（去重保序）。仅供面板/默认补齐使用，不做替换。 */
export function extractPromptVariables(body: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const m of body.matchAll(PROMPT_VARIABLE_RE)) {
    const name = m[1]!;
    if (!seen.has(name)) {
      seen.add(name);
      out.push(name);
    }
  }
  return out;
}

function sanitizeStringArr(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && !!x) : [];
}

export function createPromptTemplate(input: PromptTemplateInput): PromptTemplate {
  const title = input.title.trim();
  if (!title) throw new Error("title required");
  const body = input.body ?? "";
  const id = randomUUID();
  const now = Date.now();
  const category = (input.category ?? "").trim();
  // 显式传入 variables 优先；否则从 body 抽取（{{var}}）。
  const variables = input.variables !== undefined
    ? sanitizeStringArr(input.variables)
    : extractPromptVariables(body);
  const tags = sanitizeStringArr(input.tags);
  const wsId = typeof input.workspaceId === "string" && input.workspaceId ? input.workspaceId : null;
  db.prepare(`
    INSERT INTO prompt_templates (id, workspace_id, title, category, body, variables, tags, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, wsId, title, category, body, JSON.stringify(variables), JSON.stringify(tags), now, now);
  return getPromptTemplate(id) as PromptTemplate;
}

export function getPromptTemplate(id: string): PromptTemplate | undefined {
  const r = db.prepare("SELECT * FROM prompt_templates WHERE id = ?").get(id) as unknown as PromptTemplateRow | undefined;
  return r ? rowToPromptTemplate(r) : undefined;
}

/**
 * 列出模板。默认 includeGlobal=true，返回 「该工作区 ∪ 全局(workspace_id IS NULL)」。
 * filters: category 精确匹配；tags 任一匹配（OR 语义，标签为内嵌 JSON 数组，走 LIKE 兜底）。
 */
export function listPromptTemplates(
  workspaceId: string,
  filters?: { category?: string; tags?: string[]; includeGlobal?: boolean },
): PromptTemplate[] {
  const includeGlobal = filters?.includeGlobal !== false;
  const where: string[] = [];
  const params: (string | number)[] = [];
  if (includeGlobal) {
    where.push("(workspace_id = ? OR workspace_id IS NULL)");
    params.push(workspaceId);
  } else {
    where.push("workspace_id = ?");
    params.push(workspaceId);
  }
  if (filters?.category) {
    where.push("category = ?");
    params.push(filters.category);
  }
  // tags OR：每个 tag 走 LIKE '%"tag"%'。tags 列存 JSON 数组（如 ["a","b"]），
  // 用 `"<tag>"` 作为子串匹配可避免 "ab" 误中 "abc"。tag 内出现 LIKE 元字符
  // (% / _) 时用 ESCAPE 转义；为了简单 SKILL：先拒掉这两个字符（标签里几乎不会有）。
  // ponytail: LIKE 兜底足够用，模板量级 < 1k；上 FTS 等真有性能问题再说。
  const cleanTags = sanitizeStringArr(filters?.tags).filter((t) => !/[%_"\\]/.test(t));
  if (cleanTags.length > 0) {
    const ors = cleanTags.map(() => "tags LIKE ?").join(" OR ");
    where.push(`(${ors})`);
    for (const t of cleanTags) params.push(`%"${t}"%`);
  }
  const sql = `SELECT * FROM prompt_templates WHERE ${where.join(" AND ")} ORDER BY updated_at DESC`;
  const rows = db.prepare(sql).all(...params) as unknown as PromptTemplateRow[];
  return rows.map(rowToPromptTemplate);
}

export function updatePromptTemplate(id: string, patch: PromptTemplatePatch): PromptTemplate | undefined {
  const existing = getPromptTemplate(id);
  if (!existing) return undefined;
  const sets: string[] = [];
  const params: (string | number | null)[] = [];
  if (typeof patch.title === "string") {
    const t = patch.title.trim();
    if (!t) throw new Error("title required");
    sets.push("title = ?"); params.push(t);
  }
  if (typeof patch.category === "string") {
    sets.push("category = ?"); params.push(patch.category.trim());
  }
  const bodyChanged = typeof patch.body === "string" && patch.body !== existing.body;
  if (bodyChanged) {
    sets.push("body = ?"); params.push(patch.body!);
    // body 改了但 patch 未显式传 variables，自动重抽（保持一致）。
    if (patch.variables === undefined) {
      sets.push("variables = ?"); params.push(JSON.stringify(extractPromptVariables(patch.body!)));
    }
  }
  if (Array.isArray(patch.variables)) {
    sets.push("variables = ?"); params.push(JSON.stringify(sanitizeStringArr(patch.variables)));
  }
  if (Array.isArray(patch.tags)) {
    sets.push("tags = ?"); params.push(JSON.stringify(sanitizeStringArr(patch.tags)));
  }
  if (sets.length === 0) return existing;
  const now = Date.now();
  sets.push("updated_at = ?"); params.push(now);
  params.push(id);
  db.prepare(`UPDATE prompt_templates SET ${sets.join(", ")} WHERE id = ?`).run(...params);
  return getPromptTemplate(id);
}

export function deletePromptTemplate(id: string): boolean {
  const info = db.prepare("DELETE FROM prompt_templates WHERE id = ?").run(id);
  return info.changes > 0;
}
