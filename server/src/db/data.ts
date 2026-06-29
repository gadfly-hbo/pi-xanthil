import { randomUUID } from "node:crypto";
import { accessSync, constants, statSync } from "node:fs";
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
  CrowdDataset,
  CrowdDatasetSource,
  CrowdDatasetStatus,
  CrowdTagDictionaryEntry,
  CrowdTagSensitivity,
  CrowdProfileDimension,
  CrowdSegment,
  CrowdSegmentRuleGroup,
  CrowdProfile,
  CrowdProfileStatus,
  CrowdProfileContent,
  CrowdProfileVersion,
  CrowdProfileFeedback,
  CrowdProfileFeedbackStatus,
  CrowdSubAgentDraft,
  CrowdFieldProfile,
  CrowdTagValueSummary,
  MetricDefinition,
  OkhMetricConflict,
  OkhMetricImportCommitResult,
  OkhMetricImportPreview,
  OkhMetricOntologyLink,
  OkhMetricConflictReason,
  OkhMetricTemplate,
  OkhMetricTemplatePack,
  OkhStandardHealth,
  OkhStandardHealthRiskFlag,
  OkhTemplateApplyResult,
  OkhTemplateScenario,
  MetricDefinitionInput,
  KgHistoryEvent,
  KgHistoryEventType,
  KgHistoryTargetKind,
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
  // scope: 'global'=通用入池跨工作区可启用 / 'workspace'=项目专属本工作区独占（D-POOL1）。
  db.exec(`
    CREATE TABLE IF NOT EXISTS knowledge_docs (
      id           TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL REFERENCES workspaces(id),
      title        TEXT NOT NULL,
      source_type  TEXT NOT NULL DEFAULT 'upload',
      path         TEXT,
      content      TEXT,
      tags         TEXT NOT NULL DEFAULT '[]',
      scope        TEXT NOT NULL DEFAULT 'workspace',
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
  // 旧库 idempotent ALTER：knowledge_docs 补 scope 列（D-POOL1）。与同文件 memory_items/reviews
  // 加 tags 列范式一致，不碰 db.ts MIGRATIONS（接缝层归总控）。
  {
    const cols = db.prepare("PRAGMA table_info(knowledge_docs)").all() as Array<{ name: string }>;
    if (!cols.some((c) => c.name === "scope")) {
      db.exec("ALTER TABLE knowledge_docs ADD COLUMN scope TEXT NOT NULL DEFAULT 'workspace'");
    }
  }
  // scope 索引在 ALTER 之后无条件建（IF NOT EXISTS 幂等）：旧库此时已补列、新库列已在 CREATE TABLE。
  // 不可放进上方 CREATE TABLE 的 db.exec 块——那会早于 ALTER 执行，对旧库报 no such column: scope。
  db.exec("CREATE INDEX IF NOT EXISTS idx_knowledge_docs_scope ON knowledge_docs(scope)");

  // D-KG4: KG history only stores metadata summaries. No report body, prompt body, raw rows, or samples.
  db.exec(`
    CREATE TABLE IF NOT EXISTS kg_history_events (
      id           TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL REFERENCES workspaces(id),
      event_type   TEXT NOT NULL,
      target_kind  TEXT NOT NULL,
      target_id    TEXT,
      title        TEXT NOT NULL DEFAULT '',
      summary      TEXT NOT NULL DEFAULT '',
      metadata     TEXT NOT NULL DEFAULT '{}',
      created_at   INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_kg_history_ws_created ON kg_history_events(workspace_id, created_at DESC);
  `);

  // D-KB2: summary 列（LLM 异步生成摘要，nullable）。同 scope 列范式，PRAGMA+ALTER 幂等。
  {
    const cols = db.prepare("PRAGMA table_info(knowledge_docs)").all() as Array<{ name: string }>;
    if (!cols.some((c) => c.name === "summary")) {
      db.exec("ALTER TABLE knowledge_docs ADD COLUMN summary TEXT");
    }
  }

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

  // skill_proposals（D-SAFEDISTILL1 · 子技能提案脱敏蒸馏）：
  // - 由 safe-distiller.ts 聚合 trace_events 元数据 + 衍生报告路径生成，零 draw_data。
  // - 状态机：pending(待审) → approved(已采纳, decided_skill_id 指向 skill-registry entry)
  //         / rejected(已拒绝, decided_reason 写理由)。
  // - signature = SQL 骨架 sha1 前缀；唯一索引防同骨架重复入库；二次扫到已 pending
  //   则更新 occurrence 计数与 updated_at（acceptance 不重复创建）。
  db.exec(`
    CREATE TABLE IF NOT EXISTS skill_proposals (
      id                TEXT PRIMARY KEY,
      workspace_id      TEXT NOT NULL REFERENCES workspaces(id),
      signature         TEXT NOT NULL,
      draft_title       TEXT NOT NULL,
      draft_body        TEXT NOT NULL,
      evidence          TEXT NOT NULL DEFAULT '{}',
      status            TEXT NOT NULL DEFAULT 'pending',
      decided_skill_id  TEXT,
      decided_reason    TEXT NOT NULL DEFAULT '',
      created_at        INTEGER NOT NULL,
      updated_at        INTEGER NOT NULL,
      UNIQUE(workspace_id, signature)
    );
    CREATE INDEX IF NOT EXISTS idx_skill_proposals_ws_status ON skill_proposals(workspace_id, status, updated_at DESC);
  `);

  // onto-knowhow metric ↔ onto-xanthil 人工关联（D-OKH6 · X-OKH0 口径）。
  // 删除关联不删除 metric 或 ontology 节点；目标合法性由 CRUD 层校验，避免跨工作区误连。
  db.exec(`
    CREATE TABLE IF NOT EXISTS okh_metric_ontology_links (
      id           TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL REFERENCES workspaces(id),
      metric_id    TEXT NOT NULL REFERENCES metric_definitions(id),
      ontology_id  TEXT NOT NULL REFERENCES ontologies(id),
      target_kind  TEXT NOT NULL,
      target_id    TEXT NOT NULL,
      created_at   INTEGER NOT NULL,
      updated_at   INTEGER NOT NULL,
      UNIQUE(workspace_id, metric_id, ontology_id, target_kind, target_id)
    );
    CREATE INDEX IF NOT EXISTS idx_okh_metric_links_metric ON okh_metric_ontology_links(workspace_id, metric_id);
    CREATE INDEX IF NOT EXISTS idx_okh_metric_links_target ON okh_metric_ontology_links(ontology_id, target_kind, target_id);
  `);

  // ── the-crowd 人群画像资产库（D-CROWD1 · X-CROWD0 契约审定 schema）──────────────
  // 6 表：dataset → tag_dictionary → segment → profile → profile_version → feedback
  // 红线：fieldProfiles/tagDistribution 只存聚合摘要（TopN 枚举+分布），不存原始行级标签明细。
  //       API 输出明细预览时只允许字段摘要、分布摘要、枚举 TopN，禁止用户级行样本。
  db.exec(`
    CREATE TABLE IF NOT EXISTS crowd_datasets (
      id              TEXT PRIMARY KEY,
      workspace_id    TEXT NOT NULL REFERENCES workspaces(id),
      name            TEXT NOT NULL,
      source          TEXT NOT NULL DEFAULT 'upload_csv',
      status          TEXT NOT NULL DEFAULT 'importing',
      row_count       INTEGER NOT NULL DEFAULT 0,
      field_count     INTEGER NOT NULL DEFAULT 0,
      field_profiles  TEXT NOT NULL DEFAULT '[]',
      error_message   TEXT,
      created_at      INTEGER NOT NULL,
      updated_at      INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_crowd_datasets_ws ON crowd_datasets(workspace_id, updated_at DESC);

    CREATE TABLE IF NOT EXISTS crowd_tag_dictionary (
      id              TEXT PRIMARY KEY,
      workspace_id    TEXT NOT NULL REFERENCES workspaces(id),
      dataset_id      TEXT NOT NULL REFERENCES crowd_datasets(id),
      field           TEXT NOT NULL,
      label           TEXT NOT NULL,
      description     TEXT NOT NULL DEFAULT '',
      dimension       TEXT NOT NULL DEFAULT 'custom',
      sensitivity     TEXT NOT NULL DEFAULT 'internal',
      weight          REAL NOT NULL DEFAULT 1,
      value_labels    TEXT NOT NULL DEFAULT '{}',
      enabled         INTEGER NOT NULL DEFAULT 1,
      created_at      INTEGER NOT NULL,
      updated_at      INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_crowd_tag_dict_ws_ds ON crowd_tag_dictionary(workspace_id, dataset_id);

    CREATE TABLE IF NOT EXISTS crowd_segments (
      id               TEXT PRIMARY KEY,
      workspace_id     TEXT NOT NULL REFERENCES workspaces(id),
      dataset_id       TEXT NOT NULL REFERENCES crowd_datasets(id),
      name             TEXT NOT NULL,
      description      TEXT NOT NULL DEFAULT '',
      rule             TEXT NOT NULL DEFAULT '{"logic":"and","conditions":[]}',
      sample_count     INTEGER NOT NULL DEFAULT 0,
      coverage_ratio   REAL NOT NULL DEFAULT 0,
      tag_distribution TEXT NOT NULL DEFAULT '{}',
      created_at       INTEGER NOT NULL,
      updated_at       INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_crowd_segments_ws ON crowd_segments(workspace_id, updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_crowd_segments_ws_ds ON crowd_segments(workspace_id, dataset_id);

    CREATE TABLE IF NOT EXISTS crowd_profiles (
      id                            TEXT PRIMARY KEY,
      workspace_id                  TEXT NOT NULL REFERENCES workspaces(id),
      segment_id                    TEXT NOT NULL REFERENCES crowd_segments(id),
      name                          TEXT NOT NULL,
      status                        TEXT NOT NULL DEFAULT 'draft',
      current_version_id            TEXT,
      published_subagent_template_id TEXT,
      created_at                    INTEGER NOT NULL,
      updated_at                    INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_crowd_profiles_ws ON crowd_profiles(workspace_id, updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_crowd_profiles_seg ON crowd_profiles(segment_id);

    CREATE TABLE IF NOT EXISTS crowd_profile_versions (
      id                 TEXT PRIMARY KEY,
      workspace_id       TEXT NOT NULL REFERENCES workspaces(id),
      profile_id         TEXT NOT NULL REFERENCES crowd_profiles(id),
      version            INTEGER NOT NULL,
      content            TEXT NOT NULL DEFAULT '{}',
      source             TEXT NOT NULL DEFAULT 'generated',
      source_feedback_id TEXT,
      created_at         INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_crowd_profile_versions_pid ON crowd_profile_versions(profile_id, version DESC);

    CREATE TABLE IF NOT EXISTS crowd_profile_feedback (
      id                   TEXT PRIMARY KEY,
      workspace_id         TEXT NOT NULL REFERENCES workspaces(id),
      profile_id           TEXT NOT NULL REFERENCES crowd_profiles(id),
      profile_version_id   TEXT NOT NULL REFERENCES crowd_profile_versions(id),
      source_run_id        TEXT,
      source_life_form_id  TEXT,
      objections           TEXT NOT NULL DEFAULT '[]',
      acceptance_conditions TEXT NOT NULL DEFAULT '[]',
      suggestions          TEXT NOT NULL DEFAULT '[]',
      status               TEXT NOT NULL DEFAULT 'pending',
      created_at           INTEGER NOT NULL,
      reviewed_at          INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_crowd_feedback_pid ON crowd_profile_feedback(profile_id, created_at DESC);
  `);
  // migration: add columns for E-CROWD11 (safe to run repeatedly)
  try { db.exec(`ALTER TABLE crowd_datasets ADD COLUMN is_aggregate INTEGER NOT NULL DEFAULT 0`); } catch { /* already exists */ }
  try { db.exec(`ALTER TABLE crowd_tag_dictionary ADD COLUMN auto_generated INTEGER NOT NULL DEFAULT 0`); } catch { /* already exists */ }
  try { db.exec(`ALTER TABLE crowd_segments ADD COLUMN auto_generated INTEGER NOT NULL DEFAULT 0`); } catch { /* already exists */ }
}

// ============================================================================
// onto-knowhow · 指标模板池 + 治理（D-OKH1 / D-OKH2）
// ----------------------------------------------------------------------------
// 模板仅包含聚合指标定义和口径说明，不含样本明细；标准文件体检只做本地元数据检查，
// 不读取正文、不调用 LLM。
// ============================================================================

const OKH_TEMPLATE_UPDATED_AT = Date.parse("2026-06-29T00:00:00.000Z");

const METRIC_TEMPLATE_PACKS: OkhMetricTemplatePack[] = [
  { id: "retail-core", scenario: "retail", title: "零售经营", description: "门店/零售业务经营看板常用指标。", metricCount: 2, tags: ["industry:零售", "task:经营分析"], updatedAt: OKH_TEMPLATE_UPDATED_AT },
  { id: "member-ops", scenario: "member", title: "会员运营", description: "会员活跃、留存与复购分析常用指标。", metricCount: 2, tags: ["industry:会员", "task:会员运营"], updatedAt: OKH_TEMPLATE_UPDATED_AT },
  { id: "ecommerce-core", scenario: "ecommerce", title: "电商运营", description: "店铺漏斗、活动复盘和商品运营常用指标。", metricCount: 2, tags: ["industry:电商", "task:转化"], updatedAt: OKH_TEMPLATE_UPDATED_AT },
  { id: "supply-chain-core", scenario: "supply_chain", title: "供应链", description: "库存与履约体检常用指标。", metricCount: 2, tags: ["industry:供应链", "task:供应链体检"], updatedAt: OKH_TEMPLATE_UPDATED_AT },
];

const METRIC_TEMPLATES: OkhMetricTemplate[] = [
  {
    id: "member-repeat-purchase-rate",
    packId: "member-ops",
    scenario: "member",
    name: "复购率",
    category: "会员运营",
    description: "在指定周期内发生再次购买的会员占有购买会员的比例。",
    formula: "count_distinct(member_id where purchase_count >= 2) / count_distinct(member_id)",
    caliber: "按会员去重；周期默认自然月；仅统计已支付且未全额退款订单。",
    unit: "%",
    tags: ["industry:会员", "task:复购", "method:ratio"],
    displayName: "复购率",
    aggregation: "ratio",
    periodGrain: "month",
    denominator: "count_distinct(member_id)",
    version: 1,
  },
  {
    id: "member-active-rate",
    packId: "member-ops",
    scenario: "member",
    name: "会员活跃率",
    category: "会员运营",
    description: "周期内有登录、浏览、加购或购买行为的会员占全部可触达会员的比例。",
    formula: "count_distinct(active_member_id) / count_distinct(reachable_member_id)",
    caliber: "active_member_id 需至少发生一次有效互动；剔除退订、黑名单和不可触达会员。",
    unit: "%",
    tags: ["industry:会员", "task:活跃", "method:ratio"],
    displayName: "会员活跃率",
    aggregation: "ratio",
    periodGrain: "month",
    denominator: "count_distinct(reachable_member_id)",
    version: 1,
  },
  {
    id: "retail-sales-amount",
    packId: "retail-core",
    scenario: "retail",
    name: "销售额",
    category: "零售经营",
    description: "指定周期内已支付订单的实付金额总和。",
    formula: "sum(paid_amount)",
    caliber: "仅统计支付成功订单；退款按业务口径可在净销售额中扣减。",
    unit: "元",
    tags: ["industry:零售", "task:经营分析", "method:sum"],
    displayName: "销售额",
    aggregation: "sum",
    periodGrain: "day",
    version: 1,
  },
  {
    id: "retail-gross-margin-rate",
    packId: "retail-core",
    scenario: "retail",
    name: "毛利率",
    category: "零售经营",
    description: "毛利额占销售额的比例，用于衡量商品或门店盈利质量。",
    formula: "(sum(net_sales_amount) - sum(cost_amount)) / sum(net_sales_amount)",
    caliber: "net_sales_amount 扣除退款与折让；cost_amount 使用同期结转成本。",
    unit: "%",
    tags: ["industry:零售", "task:利润", "method:ratio"],
    displayName: "毛利率",
    aggregation: "ratio",
    periodGrain: "month",
    denominator: "sum(net_sales_amount)",
    version: 1,
  },
  {
    id: "ecommerce-conversion-rate",
    packId: "ecommerce-core",
    scenario: "ecommerce",
    name: "成交转化率",
    category: "电商运营",
    description: "下单或支付用户数占访问用户数的比例。",
    formula: "count_distinct(paid_user_id) / count_distinct(visitor_id)",
    caliber: "访客按 UV 去重；支付用户按支付成功去重；周期默认自然日或活动期。",
    unit: "%",
    tags: ["industry:电商", "task:转化", "method:ratio"],
    displayName: "成交转化率",
    aggregation: "ratio",
    periodGrain: "day",
    denominator: "count_distinct(visitor_id)",
    version: 1,
  },
  {
    id: "ecommerce-aov",
    packId: "ecommerce-core",
    scenario: "ecommerce",
    name: "客单价",
    category: "电商运营",
    description: "平均每笔订单带来的支付金额。",
    formula: "sum(paid_amount) / count_distinct(order_id)",
    caliber: "仅统计支付成功订单；多子单合并口径需按主订单去重。",
    unit: "元/单",
    tags: ["industry:电商", "task:客单", "method:average"],
    displayName: "客单价",
    aggregation: "avg",
    periodGrain: "day",
    denominator: "count_distinct(order_id)",
    version: 1,
  },
  {
    id: "supply-inventory-turnover-days",
    packId: "supply-chain-core",
    scenario: "supply_chain",
    name: "库存周转天数",
    category: "供应链",
    description: "库存从入库到销售或消耗所需的平均天数。",
    formula: "average_inventory_amount / cost_of_goods_sold * days_in_period",
    caliber: "average_inventory_amount 使用期初期末平均；COGS 使用同期销售成本。",
    unit: "天",
    tags: ["industry:供应链", "task:库存", "method:ratio"],
    displayName: "库存周转天数",
    aggregation: "ratio",
    periodGrain: "month",
    denominator: "cost_of_goods_sold",
    version: 1,
  },
  {
    id: "supply-fulfillment-rate",
    packId: "supply-chain-core",
    scenario: "supply_chain",
    name: "订单满足率",
    category: "供应链",
    description: "按承诺要求完整履约的订单占全部需求订单的比例。",
    formula: "count(fulfilled_order_id) / count(order_id)",
    caliber: "fulfilled_order_id 指按时、足量、无缺货完成履约的订单。",
    unit: "%",
    tags: ["industry:供应链", "task:履约", "method:ratio"],
    displayName: "订单满足率",
    aggregation: "ratio",
    periodGrain: "day",
    denominator: "count(order_id)",
    version: 1,
  },
];

interface MetricRowForOkh {
  id: string;
  workspace_id: string;
  name: string;
  category: string;
  description: string;
  formula: string;
  caliber: string;
  unit: string;
  object_type_id: string | null;
  bound_columns: string | null;
  display_name: string | null;
  aggregation: string | null;
  period_grain: string | null;
  filters: string | null;
  denominator: string | null;
  version: number | null;
  enabled: number;
  created_at: number;
  updated_at: number;
}

function rowToMetric(r: MetricRowForOkh): MetricDefinition {
  let boundColumns: string[] | undefined;
  if (r.bound_columns) {
    try { boundColumns = JSON.parse(r.bound_columns) as string[]; } catch { boundColumns = undefined; }
  }
  return {
    id: r.id,
    workspaceId: r.workspace_id,
    name: r.name,
    category: r.category,
    description: r.description,
    formula: r.formula,
    caliber: r.caliber,
    unit: r.unit,
    objectTypeId: r.object_type_id ?? undefined,
    boundColumns,
    displayName: r.display_name ?? undefined,
    aggregation: r.aggregation ?? undefined,
    periodGrain: r.period_grain ?? undefined,
    filters: r.filters ?? undefined,
    denominator: r.denominator ?? undefined,
    version: r.version ?? undefined,
    enabled: r.enabled === 1,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

function normalizeMetricName(name: string): string {
  return name.toLowerCase().replace(/[\s\-_（）()]+/g, "").trim();
}

function normalizeFormula(formula: string): string {
  return formula.toLowerCase().replace(/\s+/g, "").trim();
}

function workspaceMetrics(workspaceId: string, includeDisabled = false): MetricDefinition[] {
  if (includeDisabled) {
    const rows = db.prepare(`
      SELECT DISTINCT m.*
      FROM metric_definitions m
      LEFT JOIN workspace_memory_enablements e
        ON e.item_kind = 'metric' AND e.item_id = m.id AND e.workspace_id = ?
      WHERE m.workspace_id = ? OR e.enabled = 1
      ORDER BY m.category, m.name
    `).all(workspaceId, workspaceId) as unknown as MetricRowForOkh[];
    return rows.map(rowToMetric);
  }
  const enabledIds = listEnabledItemIds(workspaceId, "metric");
  if (enabledIds.length === 0) return [];
  const placeholders = enabledIds.map(() => "?").join(", ");
  const rows = db.prepare(`
    SELECT * FROM metric_definitions
    WHERE id IN (${placeholders})
    ORDER BY category, name
  `).all(...enabledIds) as unknown as MetricRowForOkh[];
  return rows.map(rowToMetric);
}

export function listOkhMetrics(workspaceId: string, enabledOnly = true): MetricDefinition[] {
  return workspaceMetrics(workspaceId, !enabledOnly);
}

export function listMetricTemplates(scenario?: OkhTemplateScenario): { packs: OkhMetricTemplatePack[]; templates: OkhMetricTemplate[] } {
  const templates = scenario ? METRIC_TEMPLATES.filter((t) => t.scenario === scenario) : METRIC_TEMPLATES;
  const packIds = new Set(templates.map((t) => t.packId));
  return { packs: METRIC_TEMPLATE_PACKS.filter((p) => packIds.has(p.id)), templates };
}

export function applyMetricTemplates(input: { workspaceId: string; packId?: string; templateIds?: string[]; enable?: boolean }): OkhTemplateApplyResult {
  const selected = new Set(input.templateIds ?? []);
  const templates = METRIC_TEMPLATES.filter((t) => (input.packId ? t.packId === input.packId : false) || selected.has(t.id));
  const existing = workspaceMetrics(input.workspaceId, true);
  const byName = new Map<string, MetricDefinition[]>();
  for (const metric of existing) {
    const key = normalizeMetricName(metric.name);
    byName.set(key, [...(byName.get(key) ?? []), metric]);
  }
  const created: MetricDefinition[] = [];
  const skipped: OkhTemplateApplyResult["skipped"] = [];
  const insert = db.prepare(`
    INSERT INTO metric_definitions (
      id, workspace_id, name, category, description, formula, caliber, unit,
      object_type_id, bound_columns, display_name, aggregation, period_grain,
      filters, denominator, version, enabled, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  for (const template of templates) {
    const key = normalizeMetricName(template.name);
    const sameName = byName.get(key) ?? [];
    if (sameName.length > 0) {
      skipped.push({
        templateId: template.id,
        name: template.name,
        existingMetricId: sameName[0]?.id,
        reason: "当前工作区已有同名指标，已跳过，避免静默覆盖口径",
      });
      continue;
    }
    const nearName = existing.find((m) => m.category === template.category && jaccard(tokenSet(m.name), tokenSet(template.name)) >= 0.5);
    if (nearName) {
      skipped.push({
        templateId: template.id,
        name: template.name,
        existingMetricId: nearName.id,
        reason: "当前工作区已有近似名称指标，已跳过，避免隐式制造口径冲突",
      });
      continue;
    }
    const id = randomUUID();
    const now = Date.now();
    const enabled = input.enable === false ? 0 : 1;
    insert.run(
      id,
      input.workspaceId,
      template.name,
      template.category,
      template.description,
      template.formula,
      template.caliber,
      template.unit,
      template.displayName ?? null,
      template.aggregation ?? null,
      template.periodGrain ?? null,
      template.filters ?? null,
      template.denominator ?? null,
      template.version ?? null,
      enabled,
      now,
      now,
    );
    if (enabled) enableForOrigin(input.workspaceId, "metric", id);
    const metric = rowToMetric(db.prepare("SELECT * FROM metric_definitions WHERE id = ?").get(id) as unknown as MetricRowForOkh);
    created.push(metric);
    byName.set(key, [metric]);
    existing.push(metric);
  }
  return { created, skipped };
}

function tokenSet(text: string): Set<string> {
  const out = new Set<string>();
  const lower = text.toLowerCase();
  for (const m of lower.match(/[a-z0-9]{2,}/g) ?? []) out.add(m);
  const han = lower.replace(/[^\u4e00-\u9fa5]+/g, " ").trim();
  for (const seg of han.split(/\s+/)) {
    if (!seg) continue;
    if (seg.length <= 2) out.add(seg);
    else for (let i = 0; i < seg.length - 1; i++) out.add(seg.slice(i, i + 2));
  }
  return out;
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  return inter / (a.size + b.size - inter);
}

function formulaParts(formula: string): { denominator: string } {
  const idx = formula.lastIndexOf("/");
  return { denominator: idx >= 0 ? normalizeFormula(formula.slice(idx + 1)) : "" };
}

function extractTimeWindow(text: string): string {
  const hit = /(自然日|自然周|自然月|季度|自然年|近\d+天|近\d+日|近\d+周|近\d+月|活动期|财年|calendar\s*(day|week|month|year))/i.exec(text);
  return hit?.[0].toLowerCase() ?? "";
}

function makeMetricConflict(reason: OkhMetricConflictReason, metricIds: string[], fields: string[], message: string): OkhMetricConflict {
  const severity: OkhMetricConflict["severity"] = reason === "same_name_formula_mismatch" || reason === "denominator_mismatch"
    ? "critical"
    : reason === "same_name_caliber_mismatch" || reason === "period_window_mismatch"
      ? "warn"
      : "info";
  return {
    id: `${reason}:${metricIds.slice().sort().join(":")}`,
    severity,
    reason,
    metricIds,
    fields,
    message,
    generatedAt: Date.now(),
  };
}

export function detectMetricConflicts(workspaceId: string, includeDisabled = false): OkhMetricConflict[] {
  const metrics = workspaceMetrics(workspaceId, includeDisabled);
  const conflicts: OkhMetricConflict[] = [];
  for (let i = 0; i < metrics.length; i++) {
    for (let j = i + 1; j < metrics.length; j++) {
      const a = metrics[i]!;
      const b = metrics[j]!;
      const sameName = normalizeMetricName(a.name) === normalizeMetricName(b.name);
      const similarName = !sameName && jaccard(tokenSet(a.name), tokenSet(b.name)) >= 0.5;
      const sameCategory = a.category && a.category === b.category;
      const formulaDiff = normalizeFormula(a.formula) !== normalizeFormula(b.formula);
      const denomA = normalizeFormula(a.denominator ?? formulaParts(a.formula).denominator);
      const denomB = normalizeFormula(b.denominator ?? formulaParts(b.formula).denominator);
      const windowA = extractTimeWindow(`${a.caliber}\n${a.formula}`);
      const windowB = extractTimeWindow(`${b.caliber}\n${b.formula}`);
      if (sameName && formulaDiff) {
        conflicts.push(makeMetricConflict("same_name_formula_mismatch", [a.id, b.id], ["name", "formula"], `同名指标「${a.name}」公式不同`));
      } else if (sameName && a.caliber.trim() !== b.caliber.trim()) {
        conflicts.push(makeMetricConflict("same_name_caliber_mismatch", [a.id, b.id], ["name", "caliber"], `同名指标「${a.name}」口径说明不同`));
      } else if (similarName && sameCategory && formulaDiff) {
        conflicts.push(makeMetricConflict("same_category_near_name", [a.id, b.id], ["name", "category", "formula"], `同分类「${a.category}」下存在近似名称且公式不同的指标`));
      } else if (sameCategory && formulaDiff && normalizeMetricName(a.name).includes(normalizeMetricName(b.name))) {
        conflicts.push(makeMetricConflict("same_category_near_name", [a.id, b.id], ["name", "category", "formula"], `同分类「${a.category}」下存在名称包含关系且公式不同的指标`));
      }
      if (denomA && denomB && denomA !== denomB && (sameName || similarName)) {
        conflicts.push(makeMetricConflict("denominator_mismatch", [a.id, b.id], ["denominator", "formula"], "同类比率指标分母不同"));
      }
      if (windowA && windowB && windowA !== windowB && (sameName || similarName)) {
        conflicts.push(makeMetricConflict("period_window_mismatch", [a.id, b.id], ["caliber"], "同类指标时间窗口不同"));
      }
    }
  }
  return conflicts;
}

export function inspectStandardFiles(workspaceId: string, standardIds?: string[]): OkhStandardHealth[] {
  const enabledStandardIds = new Set(listEnabledItemIds(workspaceId, "standard"));
  const requested = standardIds && standardIds.length > 0 ? new Set(standardIds) : null;
  return listAnalysisStandards()
    .filter((s) => {
      if (s.kind !== "reference_file") return false;
      const visibleInWorkspace = s.workspaceId === workspaceId || enabledStandardIds.has(s.id);
      const selected = requested ? requested.has(s.id) : enabledStandardIds.has(s.id);
      return visibleInWorkspace && selected;
    })
    .map((s): OkhStandardHealth => {
      const path = s.filePath ?? "";
      const extension = path.includes(".") ? path.slice(path.lastIndexOf(".")).toLowerCase() : "";
      let exists = false;
      let readable = false;
      let fileSize: number | null = null;
      let entryKind: OkhStandardHealth["entryKind"] = "unknown";
      const riskFlags: OkhStandardHealthRiskFlag[] = [];
      try {
        const st = statSync(path);
        exists = true;
        entryKind = st.isDirectory() ? "directory" : "file";
        fileSize = st.size;
        accessSync(path, constants.R_OK);
        readable = true;
      } catch (err) {
        entryKind = exists ? "unknown" : "missing";
      }
      const binaryLike = [".zip", ".bin", ".exe", ".dmg", ".png", ".jpg", ".jpeg", ".gif", ".pdf"].includes(extension);
      const supportedExt = new Set([".md", ".txt", ".csv", ".json", ".yaml", ".yml", ".docx"]);
      if (!exists) riskFlags.push("missing");
      if (exists && !readable) riskFlags.push("unreadable");
      if (entryKind === "directory") riskFlags.push("directory");
      if (binaryLike) riskFlags.push("binary_like");
      if (fileSize !== null && fileSize > 10 * 1024 * 1024) riskFlags.push("too_large");
      if (extension && !supportedExt.has(extension)) riskFlags.push("unsupported_ext");
      if (/draw_data|raw|原始数据/i.test(path)) riskFlags.push("raw_like_path");
      const hasError = riskFlags.some((f) => f === "missing" || f === "unreadable" || f === "directory");
      const status: OkhStandardHealth["status"] = hasError ? "error" : riskFlags.length > 0 ? "warn" : "ok";
      const message = riskFlags.length > 0 ? `标准文件体检发现：${riskFlags.join(", ")}` : "标准文件元数据体检通过";
      return { standardId: s.id, status, exists, readable, entryKind, fileSize, extension, riskFlags, checkedAt: Date.now(), message };
    });
}

const OKH_IMPORT_REQUIRED = ["name", "category", "description", "formula", "caliber", "unit"] as const;
const OKH_HEADER_MAP: Record<string, keyof MetricDefinitionInput> = {
  name: "name",
  "名称": "name",
  "指标名称": "name",
  category: "category",
  "分类": "category",
  "指标分类": "category",
  description: "description",
  meaning: "description",
  "含义": "description",
  "说明": "description",
  formula: "formula",
  "公式": "formula",
  caliber: "caliber",
  "口径": "caliber",
  unit: "unit",
  "单位": "unit",
  displayName: "displayName",
  display_name: "displayName",
  "展示名": "displayName",
  aggregation: "aggregation",
  "聚合方式": "aggregation",
  periodGrain: "periodGrain",
  period_grain: "periodGrain",
  "周期粒度": "periodGrain",
  filters: "filters",
  "过滤条件": "filters",
  denominator: "denominator",
  "分母": "denominator",
  version: "version",
  "版本": "version",
};

function parseCsvRows(content: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < content.length; i++) {
    const ch = content[i]!;
    if (quoted) {
      if (ch === '"' && content[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') {
        quoted = false;
      } else {
        cell += ch;
      }
      continue;
    }
    if (ch === '"') quoted = true;
    else if (ch === ",") { row.push(cell); cell = ""; }
    else if (ch === "\n") { row.push(cell); rows.push(row); row = []; cell = ""; }
    else if (ch !== "\r") cell += ch;
  }
  row.push(cell);
  if (row.some((v) => v.trim())) rows.push(row);
  return rows;
}

function normalizeImportRow(input: Record<string, string>): { normalized: MetricDefinitionInput; errors: string[] } {
  const out: Record<string, string | number | undefined> = {};
  const errors: string[] = [];
  for (const [rawKey, rawValue] of Object.entries(input)) {
    const mapped = OKH_HEADER_MAP[rawKey.trim()];
    if (!mapped) continue;
    const value = rawValue.trim();
    if (mapped === "version") {
      if (value) {
        const n = Number(value);
        if (Number.isFinite(n) && n > 0) out.version = Math.floor(n);
        else errors.push("version must be a positive number");
      }
    } else {
      out[mapped] = value;
    }
  }
  for (const key of OKH_IMPORT_REQUIRED) {
    if (!String(out[key] ?? "").trim()) errors.push(`${key} required`);
  }
  if (!String(out.formula ?? "").trim()) errors.push("formula empty");
  if (!String(out.unit ?? "").trim()) errors.push("unit empty");
  return {
    normalized: {
      name: String(out.name ?? ""),
      category: String(out.category ?? ""),
      description: String(out.description ?? ""),
      formula: String(out.formula ?? ""),
      caliber: String(out.caliber ?? ""),
      unit: String(out.unit ?? ""),
      displayName: out.displayName ? String(out.displayName) : undefined,
      aggregation: out.aggregation ? String(out.aggregation) : undefined,
      periodGrain: out.periodGrain ? String(out.periodGrain) : undefined,
      filters: out.filters ? String(out.filters) : undefined,
      denominator: out.denominator ? String(out.denominator) : undefined,
      version: typeof out.version === "number" ? out.version : undefined,
    },
    errors,
  };
}

function parseMetricImportContent(content: string, format: "csv" | "json"): Record<string, string>[] {
  if (format === "json") {
    const parsed = JSON.parse(content) as unknown;
    const rows = Array.isArray(parsed) ? parsed : (parsed && typeof parsed === "object" && Array.isArray((parsed as { rows?: unknown }).rows) ? (parsed as { rows: unknown[] }).rows : []);
    return rows.map((row) => {
      const obj = row && typeof row === "object" ? row as Record<string, unknown> : {};
      return Object.fromEntries(Object.entries(obj).map(([k, v]) => [k, v == null ? "" : String(v)]));
    });
  }
  const rows = parseCsvRows(content);
  if (rows.length === 0) return [];
  const headers = rows[0]!.map((h) => h.trim());
  return rows.slice(1).map((values) => Object.fromEntries(headers.map((h, i) => [h, values[i] ?? ""])));
}

export function previewOkhMetricImport(workspaceId: string, content: string, format: "csv" | "json"): OkhMetricImportPreview {
  const rawRows = parseMetricImportContent(content, format);
  const existing = new Map(workspaceMetrics(workspaceId, true).map((m) => [normalizeMetricName(m.name), m.id]));
  const seen = new Map<string, number>();
  const rows: OkhMetricImportPreview["rows"] = rawRows.map((input, idx) => {
    const rowNumber = idx + 2;
    const { normalized, errors } = normalizeImportRow(input);
    const nameKey = normalizeMetricName(normalized.name);
    const existingMetricId = nameKey ? existing.get(nameKey) : undefined;
    if (existingMetricId) errors.push("metric name already exists");
    const firstSeen = nameKey ? seen.get(nameKey) : undefined;
    if (firstSeen !== undefined) errors.push(`duplicate name in import rows: first seen at row ${firstSeen}`);
    if (nameKey && firstSeen === undefined) seen.set(nameKey, rowNumber);
    return { rowNumber, valid: errors.length === 0, input, normalized: errors.length === 0 ? normalized : undefined, errors, existingMetricId };
  });
  return { totalRows: rows.length, validRows: rows.filter((r) => r.valid).length, invalidRows: rows.filter((r) => !r.valid).length, rows };
}

function insertOkhMetric(workspaceId: string, input: MetricDefinitionInput, enable: boolean, versionOverride?: number): MetricDefinition {
  const id = randomUUID();
  const now = Date.now();
  db.prepare(`
    INSERT INTO metric_definitions (
      id, workspace_id, name, category, description, formula, caliber, unit,
      object_type_id, bound_columns, display_name, aggregation, period_grain,
      filters, denominator, version, enabled, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    workspaceId,
    input.name,
    input.category,
    input.description,
    input.formula,
    input.caliber,
    input.unit,
    input.objectTypeId ?? null,
    input.boundColumns ? JSON.stringify(input.boundColumns) : null,
    input.displayName ?? null,
    input.aggregation ?? null,
    input.periodGrain ?? null,
    input.filters ?? null,
    input.denominator ?? null,
    versionOverride ?? input.version ?? null,
    enable ? 1 : 0,
    now,
    now,
  );
  if (enable) enableForOrigin(workspaceId, "metric", id);
  return rowToMetric(db.prepare("SELECT * FROM metric_definitions WHERE id = ?").get(id) as unknown as MetricRowForOkh);
}

export function commitOkhMetricImport(input: { workspaceId: string; rows: unknown[]; enable?: boolean; conflictPolicy?: "skip" | "create_version" }): OkhMetricImportCommitResult {
  const existing = workspaceMetrics(input.workspaceId, true);
  const byName = new Map(existing.map((m) => [normalizeMetricName(m.name), m]));
  const created: MetricDefinition[] = [];
  const skipped: OkhMetricImportCommitResult["skipped"] = [];
  const errors: OkhMetricImportCommitResult["errors"] = [];
  input.rows.forEach((raw, idx) => {
    const rowNumber = idx + 1;
    const source = raw && typeof raw === "object" && "normalized" in raw
      ? (raw as { normalized?: unknown }).normalized
      : raw;
    const record = source && typeof source === "object" ? Object.fromEntries(Object.entries(source as Record<string, unknown>).map(([k, v]) => [k, v == null ? "" : String(v)])) : {};
    const { normalized, errors: rowErrors } = normalizeImportRow(record);
    if (rowErrors.length > 0) {
      errors.push({ rowNumber, name: normalized.name || undefined, errors: rowErrors });
      return;
    }
    const nameKey = normalizeMetricName(normalized.name);
    const existingMetric = byName.get(nameKey);
    if (existingMetric && input.conflictPolicy !== "create_version") {
      skipped.push({ rowNumber, name: normalized.name, reason: "metric name already exists", existingMetricId: existingMetric.id });
      return;
    }
    const versionOverride = existingMetric ? (existingMetric.version ?? 1) + 1 : normalized.version;
    const metric = insertOkhMetric(input.workspaceId, normalized, input.enable !== false, versionOverride);
    created.push(metric);
    byName.set(nameKey, metric);
  });
  return { created, skipped, errors };
}

function csvEscape(value: unknown): string {
  const s = value == null ? "" : String(value);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function exportOkhMetrics(workspaceId: string, enabledOnly: boolean, format: "csv" | "json"): string {
  const metrics = listOkhMetrics(workspaceId, enabledOnly);
  const rows = metrics.map((m) => ({
    name: m.name,
    category: m.category,
    description: m.description,
    formula: m.formula,
    caliber: m.caliber,
    unit: m.unit,
    displayName: m.displayName ?? "",
    aggregation: m.aggregation ?? "",
    periodGrain: m.periodGrain ?? "",
    filters: m.filters ?? "",
    denominator: m.denominator ?? "",
    version: m.version ?? "",
  }));
  if (format === "json") return JSON.stringify(rows, null, 2);
  const headers = ["name", "category", "description", "formula", "caliber", "unit", "displayName", "aggregation", "periodGrain", "filters", "denominator", "version"];
  return [headers.join(","), ...rows.map((row) => headers.map((h) => csvEscape(row[h as keyof typeof row])).join(","))].join("\n");
}

interface OkhMetricOntologyLinkRow {
  id: string;
  workspace_id: string;
  metric_id: string;
  ontology_id: string;
  target_kind: string;
  target_id: string;
  created_at: number;
  updated_at: number;
}

function rowToOkhMetricOntologyLink(r: OkhMetricOntologyLinkRow): OkhMetricOntologyLink {
  return {
    id: r.id,
    workspaceId: r.workspace_id,
    metricId: r.metric_id,
    ontologyId: r.ontology_id,
    targetKind: r.target_kind as OkhMetricOntologyLink["targetKind"],
    targetId: r.target_id,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

function metricVisibleInWorkspace(workspaceId: string, metricId: string): boolean {
  const row = db.prepare("SELECT workspace_id FROM metric_definitions WHERE id = ?").get(metricId) as { workspace_id: string } | undefined;
  if (!row) return false;
  return row.workspace_id === workspaceId || listEnabledItemIds(workspaceId, "metric").includes(metricId);
}

function ontologyVisibleInWorkspace(workspaceId: string, ontologyId: string): boolean {
  const row = db.prepare("SELECT workspace_id FROM ontologies WHERE id = ?").get(ontologyId) as { workspace_id: string } | undefined;
  if (!row) return false;
  return row.workspace_id === workspaceId || listEnabledItemIds(workspaceId, "ontology").includes(ontologyId);
}

function targetBelongsToOntology(ontologyId: string, targetKind: OkhMetricOntologyLink["targetKind"], targetId: string): boolean {
  if (targetKind === "object") {
    return !!db.prepare("SELECT 1 FROM object_types WHERE id = ? AND ontology_id = ? LIMIT 1").get(targetId, ontologyId);
  }
  if (targetKind === "link") {
    return !!db.prepare("SELECT 1 FROM link_types WHERE id = ? AND ontology_id = ? LIMIT 1").get(targetId, ontologyId);
  }
  if (targetKind === "logic") {
    return !!db.prepare("SELECT 1 FROM logic_rules WHERE id = ? AND ontology_id = ? LIMIT 1").get(targetId, ontologyId);
  }
  return false;
}

export function listOkhMetricOntologyLinks(workspaceId: string, metricId: string): OkhMetricOntologyLink[] {
  if (!metricVisibleInWorkspace(workspaceId, metricId)) return [];
  return (db.prepare(`
    SELECT * FROM okh_metric_ontology_links
    WHERE workspace_id = ? AND metric_id = ?
    ORDER BY updated_at DESC
  `).all(workspaceId, metricId) as unknown as OkhMetricOntologyLinkRow[]).map(rowToOkhMetricOntologyLink);
}

export function listOkhMetricOntologyLinksByTarget(workspaceId: string, ontologyId: string, targetKind: OkhMetricOntologyLink["targetKind"], targetId: string): OkhMetricOntologyLink[] {
  if (!ontologyVisibleInWorkspace(workspaceId, ontologyId)) return [];
  return (db.prepare(`
    SELECT * FROM okh_metric_ontology_links
    WHERE workspace_id = ? AND ontology_id = ? AND target_kind = ? AND target_id = ?
    ORDER BY updated_at DESC
  `).all(workspaceId, ontologyId, targetKind, targetId) as unknown as OkhMetricOntologyLinkRow[]).map(rowToOkhMetricOntologyLink);
}

export function listOkhMetricOntologyLinksByOntology(workspaceId: string, ontologyId: string): OkhMetricOntologyLink[] {
  if (!ontologyVisibleInWorkspace(workspaceId, ontologyId)) return [];
  return (db.prepare(`
    SELECT * FROM okh_metric_ontology_links
    WHERE workspace_id = ? AND ontology_id = ?
    ORDER BY updated_at DESC
  `).all(workspaceId, ontologyId) as unknown as OkhMetricOntologyLinkRow[]).map(rowToOkhMetricOntologyLink);
}

export function replaceOkhMetricOntologyLinks(
  workspaceId: string,
  metricId: string,
  links: Array<{ ontologyId: string; targetKind: OkhMetricOntologyLink["targetKind"]; targetId: string }>,
): OkhMetricOntologyLink[] {
  if (!metricVisibleInWorkspace(workspaceId, metricId)) throw new Error("metric not found in workspace scope");
  const cleaned: Array<{ ontologyId: string; targetKind: OkhMetricOntologyLink["targetKind"]; targetId: string }> = [];
  const seen = new Set<string>();
  for (const link of links) {
    if (link.targetKind !== "object" && link.targetKind !== "link" && link.targetKind !== "logic") throw new Error("invalid targetKind");
    if (!ontologyVisibleInWorkspace(workspaceId, link.ontologyId)) throw new Error("ontology not found in workspace scope");
    if (!targetBelongsToOntology(link.ontologyId, link.targetKind, link.targetId)) throw new Error("target does not belong to ontology");
    const key = `${link.ontologyId}:${link.targetKind}:${link.targetId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    cleaned.push(link);
  }
  const now = Date.now();
  db.exec("BEGIN");
  try {
    db.prepare("DELETE FROM okh_metric_ontology_links WHERE workspace_id = ? AND metric_id = ?").run(workspaceId, metricId);
    const insert = db.prepare(`
      INSERT INTO okh_metric_ontology_links (id, workspace_id, metric_id, ontology_id, target_kind, target_id, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const link of cleaned) {
      insert.run(randomUUID(), workspaceId, metricId, link.ontologyId, link.targetKind, link.targetId, now, now);
    }
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
  return listOkhMetricOntologyLinks(workspaceId, metricId);
}

export function deleteOkhMetricOntologyLink(workspaceId: string, linkId: string): boolean {
  return db.prepare("DELETE FROM okh_metric_ontology_links WHERE workspace_id = ? AND id = ?").run(workspaceId, linkId).changes > 0;
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
  scope: string;
  summary: string | null;
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
    scope: r.scope === "global" ? "global" : "workspace",
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
  const scope: "global" | "workspace" = input.scope === "global" ? "global" : "workspace";
  db.exec("BEGIN");
  try {
    db.prepare(`
      INSERT INTO knowledge_docs (id, workspace_id, title, source_type, path, content, tags, scope, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, input.workspaceId, title, sourceType, input.path ?? null, content, JSON.stringify(tags), scope, now, now);
    writeChunksFor(id, content);
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
  // D-POOL1: scope='global' 入池，origin 工作区默认启用；'workspace' 私有，独占无需 enablement。
  if (scope === "global") {
    enableForOrigin(input.workspaceId, "knowledge", id);
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

/**
 * D-POOL1 池化语义：scope='global' 跨工作区可见；scope='workspace' 仅 origin ws 可见。
 * 全局文档的"本 ws 是否启用"由 workspace_memory_enablements(item_kind='knowledge') 表决；
 * 工作区私有文档本就独占，无需 enablement。
 */
export function listKnowledgeDocs(workspaceId: string): KnowledgeDoc[] {
  return (db.prepare(
    `SELECT * FROM knowledge_docs
     WHERE scope = 'global' OR (scope = 'workspace' AND workspace_id = ?)
     ORDER BY updated_at DESC`,
  ).all(workspaceId) as unknown as KnowledgeDocRow[]).map(rowToKnowledgeDoc);
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

export function setKnowledgeDocSummary(id: string, summary: string): void {
  db.prepare("UPDATE knowledge_docs SET summary = ? WHERE id = ?").run(summary, id);
}

export function listKnowledgeChunks(docId: string): KnowledgeChunk[] {
  return db.prepare(
    "SELECT id, doc_id AS docId, idx, text, tokens FROM knowledge_chunks WHERE doc_id = ? ORDER BY idx ASC",
  ).all(docId) as unknown as KnowledgeChunk[];
}

/**
 * Workspace-wide chunk join, with parent doc fields used by BM25 retrieval.
 * Filters by docIds when provided.
 *
 * D-POOL1 消费侧池化口径：召回基集 = 本 ws 已启用的 global 文档 ∪ 本 ws 私有(scope='workspace')文档。
 * workspace 私有文档无需 enablement，本就独占；global 文档跟随 workspace_memory_enablements。
 */
export function listKnowledgeChunksForRetrieval(workspaceId: string, docIds?: string[]): Array<{
  chunk: KnowledgeChunk;
  docTitle: string;
  docPath: string | null;
  docTags: string[];
  docSummary: string | null;
  docUpdatedAt: number;
  docCreatedAt: number;
  docSourceType: "upload" | "path";
}> {
  const enabledGlobalIds = new Set(listEnabledItemIds(workspaceId, "knowledge"));
  const params: string[] = [workspaceId];
  // 本 ws 私有 OR (global 文档且在已启用集中)。
  // 已启用集为空时退化为 d.id IN ('')（恒 false），仅返回本 ws 私有。
  const enabledPlaceholder = enabledGlobalIds.size > 0
    ? `(${Array.from(enabledGlobalIds).map(() => "?").join(",")})`
    : "('')";
  let where =
    `((d.scope = 'workspace' AND d.workspace_id = ?) OR (d.scope = 'global' AND d.id IN ${enabledPlaceholder}))`;
  if (enabledGlobalIds.size > 0) params.push(...enabledGlobalIds);
  if (docIds && docIds.length > 0) {
    where += ` AND d.id IN (${docIds.map(() => "?").join(",")})`;
    params.push(...docIds);
  }
  const rows = db.prepare(`
    SELECT c.id AS id, c.doc_id AS docId, c.idx AS idx, c.text AS text, c.tokens AS tokens,
           d.title AS docTitle, d.path AS docPath, d.tags AS docTags, d.summary AS docSummary,
           d.updated_at AS docUpdatedAt, d.created_at AS docCreatedAt, d.source_type AS docSourceType
    FROM knowledge_chunks c JOIN knowledge_docs d ON d.id = c.doc_id
    WHERE ${where}
  `).all(...params) as unknown as Array<{
    id: string; docId: string; idx: number; text: string; tokens: number | null;
    docTitle: string; docPath: string | null; docTags: string; docSummary: string | null;
    docUpdatedAt: number; docCreatedAt: number; docSourceType: string;
  }>;
  return rows.map((r) => ({
    chunk: { id: r.id, docId: r.docId, idx: r.idx, text: r.text, tokens: r.tokens },
    docTitle: r.docTitle,
    docPath: r.docPath,
    docTags: parseStringArray(r.docTags),
    docSummary: r.docSummary,
    docUpdatedAt: r.docUpdatedAt,
    docCreatedAt: r.docCreatedAt,
    docSourceType: (r.docSourceType === "path" ? "path" : "upload") as "upload" | "path",
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
  // D-POOL1: 非 NULL = 某 ws 创建,落 origin 启用;NULL = 全局模板,消费侧恒启用,不入 enablement 表。
  if (wsId) {
    enableForOrigin(wsId, "prompt", id);
  }
  return getPromptTemplate(id) as PromptTemplate;
}

export function getPromptTemplate(id: string): PromptTemplate | undefined {
  const r = db.prepare("SELECT * FROM prompt_templates WHERE id = ?").get(id) as unknown as PromptTemplateRow | undefined;
  return r ? rowToPromptTemplate(r) : undefined;
}

/**
 * D-POOL1 纯全局池：返回全部 prompt_templates（不再按 workspaceId 过滤）。
 * NULL workspace_id = 全局模板（恒启用），非 NULL = 池条目（跟随 enablement）。
 * includeGlobal 参数保留兼容（弃用），不再影响结果。
 * filters: category 精确匹配；tags 任一匹配（OR 语义，标签为内嵌 JSON 数组，走 LIKE 兜底）。
 */
export function listPromptTemplates(
  _workspaceId?: string,
  filters?: { category?: string; tags?: string[]; includeGlobal?: boolean },
): PromptTemplate[] {
  const where: string[] = [];
  const params: (string | number)[] = [];
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
  const whereClause = where.length > 0 ? `WHERE ${where.join(" AND ")}` : "";
  const sql = `SELECT * FROM prompt_templates ${whereClause} ORDER BY updated_at DESC`;
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

// ============================================================================
// skill_proposals CRUD（D-SAFEDISTILL1 · 子技能提案）
// ----------------------------------------------------------------------------
// 行 → 对外 SkillProposal 结构。types.ts 不上提（D 域内部 + 跨域走 HTTP，按 D-AGING2 范式）。
// ============================================================================

export type SkillProposalStatus = "pending" | "approved" | "rejected";

export interface SkillProposalEvidence {
  occurrences: number;
  skeleton: string;
  targets: string[];
  reportPaths: string[];
  topologyKinds: Record<string, number>;
}

export interface SkillProposal {
  id: string;
  workspaceId: string;
  signature: string;
  draftTitle: string;
  draftBody: string;
  evidence: SkillProposalEvidence;
  status: SkillProposalStatus;
  decidedSkillId: string | null;
  decidedReason: string;
  createdAt: number;
  updatedAt: number;
}

interface SkillProposalRow {
  id: string;
  workspace_id: string;
  signature: string;
  draft_title: string;
  draft_body: string;
  evidence: string;
  status: string;
  decided_skill_id: string | null;
  decided_reason: string;
  created_at: number;
  updated_at: number;
}

function rowToSkillProposal(r: SkillProposalRow): SkillProposal {
  let evidence: SkillProposalEvidence = {
    occurrences: 0,
    skeleton: "",
    targets: [],
    reportPaths: [],
    topologyKinds: {},
  };
  try {
    const parsed = JSON.parse(r.evidence) as Partial<SkillProposalEvidence>;
    evidence = {
      occurrences: Number(parsed.occurrences ?? 0),
      skeleton: String(parsed.skeleton ?? ""),
      targets: Array.isArray(parsed.targets) ? parsed.targets.map(String) : [],
      reportPaths: Array.isArray(parsed.reportPaths) ? parsed.reportPaths.map(String) : [],
      topologyKinds: parsed.topologyKinds && typeof parsed.topologyKinds === "object"
        ? Object.fromEntries(
            Object.entries(parsed.topologyKinds).map(([k, v]) => [String(k), Number(v ?? 0)]),
          )
        : {},
    };
  } catch {
    // benign：旧/坏 evidence 行返回默认值，不阻断 list
  }
  const status: SkillProposalStatus =
    r.status === "approved" || r.status === "rejected" ? r.status : "pending";
  return {
    id: r.id,
    workspaceId: r.workspace_id,
    signature: r.signature,
    draftTitle: r.draft_title,
    draftBody: r.draft_body,
    evidence,
    status,
    decidedSkillId: r.decided_skill_id,
    decidedReason: r.decided_reason,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

/**
 * upsert：同 (workspace_id, signature) 已存在 pending 则覆盖 draft + evidence + bump
 * updated_at；已 approved/rejected 则不动（人审决议不被自动扫描覆盖）。
 *
 * 返回结果：新建 → kind:"created"；已存在 pending 被刷新 → kind:"refreshed"；
 *           已 approved/rejected → kind:"skipped"。
 */
export function upsertSkillProposal(input: {
  workspaceId: string;
  signature: string;
  draftTitle: string;
  draftBody: string;
  evidence: SkillProposalEvidence;
}): { kind: "created" | "refreshed" | "skipped"; proposal: SkillProposal } {
  const existing = db
    .prepare("SELECT * FROM skill_proposals WHERE workspace_id = ? AND signature = ?")
    .get(input.workspaceId, input.signature) as unknown as SkillProposalRow | undefined;
  const now = Date.now();
  if (existing) {
    if (existing.status === "pending") {
      db.prepare(
        `UPDATE skill_proposals SET draft_title = ?, draft_body = ?, evidence = ?, updated_at = ? WHERE id = ?`,
      ).run(input.draftTitle, input.draftBody, JSON.stringify(input.evidence), now, existing.id);
      const refreshed = db
        .prepare("SELECT * FROM skill_proposals WHERE id = ?")
        .get(existing.id) as unknown as SkillProposalRow;
      return { kind: "refreshed", proposal: rowToSkillProposal(refreshed) };
    }
    return { kind: "skipped", proposal: rowToSkillProposal(existing) };
  }
  const id = randomUUID();
  db.prepare(
    `INSERT INTO skill_proposals (id, workspace_id, signature, draft_title, draft_body, evidence, status, decided_skill_id, decided_reason, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, 'pending', NULL, '', ?, ?)`,
  ).run(
    id,
    input.workspaceId,
    input.signature,
    input.draftTitle,
    input.draftBody,
    JSON.stringify(input.evidence),
    now,
    now,
  );
  const row = db.prepare("SELECT * FROM skill_proposals WHERE id = ?").get(id) as unknown as SkillProposalRow;
  return { kind: "created", proposal: rowToSkillProposal(row) };
}

export function listSkillProposals(
  workspaceId: string,
  status?: SkillProposalStatus,
): SkillProposal[] {
  const rows = (status
    ? db.prepare(
        "SELECT * FROM skill_proposals WHERE workspace_id = ? AND status = ? ORDER BY updated_at DESC",
      ).all(workspaceId, status)
    : db.prepare(
        "SELECT * FROM skill_proposals WHERE workspace_id = ? ORDER BY updated_at DESC",
      ).all(workspaceId)) as unknown as SkillProposalRow[];
  return rows.map(rowToSkillProposal);
}

export function getSkillProposal(id: string): SkillProposal | null {
  const row = db.prepare("SELECT * FROM skill_proposals WHERE id = ?").get(id) as unknown as SkillProposalRow | undefined;
  return row ? rowToSkillProposal(row) : null;
}

export function approveSkillProposal(id: string, decidedSkillId: string): SkillProposal | null {
  const now = Date.now();
  const info = db
    .prepare(
      `UPDATE skill_proposals SET status = 'approved', decided_skill_id = ?, decided_reason = '', updated_at = ?
       WHERE id = ? AND status = 'pending'`,
    )
    .run(decidedSkillId, now, id);
  if (info.changes === 0) return null;
  return getSkillProposal(id);
}

export function rejectSkillProposal(id: string, reason: string): SkillProposal | null {
  const now = Date.now();
  const info = db
    .prepare(
      `UPDATE skill_proposals SET status = 'rejected', decided_reason = ?, updated_at = ?
       WHERE id = ? AND status = 'pending'`,
    )
    .run(reason ?? "", now, id);
  if (info.changes === 0) return null;
  return getSkillProposal(id);
}

// ============================================================================
// the-crowd CRUD（D-CROWD1 · X-CROWD0 契约实装）
// ============================================================================
// 红线：fieldProfiles/tagDistribution 只存聚合摘要（TopN 枚举+分布），不存原始行级标签明细。
//       API 输出明细预览时只允许字段摘要、分布摘要、枚举 TopN，禁止用户级行样本。
//       删除/覆盖/重建版本类动作预留二次确认参数（由 routes 层 ?confirm=true 控制）。
// ============================================================================

// ---- row types ----

interface CrowdDatasetRow {
  id: string; workspace_id: string; name: string; source: string; status: string;
  row_count: number; field_count: number; field_profiles: string; is_aggregate: number;
  error_message: string | null; created_at: number; updated_at: number;
}

interface CrowdTagDictionaryRow {
  id: string; workspace_id: string; dataset_id: string; field: string; label: string;
  description: string; dimension: string; sensitivity: string; weight: number;
  value_labels: string; enabled: number; auto_generated: number;
  created_at: number; updated_at: number;
}

interface CrowdSegmentRow {
  id: string; workspace_id: string; dataset_id: string; name: string; description: string;
  rule: string; sample_count: number; coverage_ratio: number; tag_distribution: string;
  auto_generated: number; created_at: number; updated_at: number;
}

interface CrowdProfileRow {
  id: string; workspace_id: string; segment_id: string; name: string; status: string;
  current_version_id: string | null; published_subagent_template_id: string | null;
  created_at: number; updated_at: number;
}

interface CrowdProfileVersionRow {
  id: string; workspace_id: string; profile_id: string; version: number;
  content: string; source: string; source_feedback_id: string | null; created_at: number;
}

interface CrowdProfileFeedbackRow {
  id: string; workspace_id: string; profile_id: string; profile_version_id: string;
  source_run_id: string | null; source_life_form_id: string | null;
  objections: string; acceptance_conditions: string; suggestions: string;
  status: string; created_at: number; reviewed_at: number | null;
}

interface KgHistoryEventRow {
  id: string;
  workspace_id: string;
  event_type: string;
  target_kind: string;
  target_id: string | null;
  title: string;
  summary: string;
  metadata: string;
  created_at: number;
}

// ---- helpers ----

function parseJsonField<T>(s: string, fallback: T): T {
  try { return JSON.parse(s) as T; } catch { return fallback; }
}

function parseJsonStrArray(s: string): string[] {
  try { const v = JSON.parse(s) as unknown; return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []; } catch { return []; }
}

function parseJsonStrMap(s: string): Record<string, string> {
  try { const v = JSON.parse(s) as unknown; return typeof v === "object" && v !== null && !Array.isArray(v) ? Object.fromEntries(Object.entries(v as Record<string, unknown>).filter(([, val]) => typeof val === "string").map(([k, val]) => [k, val as string])) : {}; } catch { return {}; }
}

function rowToKgHistoryEvent(row: KgHistoryEventRow): KgHistoryEvent {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    eventType: row.event_type as KgHistoryEventType,
    targetKind: row.target_kind as KgHistoryTargetKind,
    targetId: row.target_id,
    title: row.title,
    summary: row.summary,
    metadata: parseJsonField<Record<string, unknown>>(row.metadata, {}),
    createdAt: row.created_at,
  };
}

export interface KgHistoryEventInput {
  workspaceId: string;
  eventType: KgHistoryEventType;
  targetKind: KgHistoryTargetKind;
  targetId?: string | null;
  title: string;
  summary: string;
  metadata?: Record<string, unknown>;
}

export function recordKgHistoryEvent(input: KgHistoryEventInput): KgHistoryEvent {
  const id = randomUUID();
  const now = Date.now();
  db.prepare(
    `INSERT INTO kg_history_events (id, workspace_id, event_type, target_kind, target_id, title, summary, metadata, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    input.workspaceId,
    input.eventType,
    input.targetKind,
    input.targetId ?? null,
    input.title.slice(0, 160),
    input.summary.slice(0, 500),
    JSON.stringify(input.metadata ?? {}),
    now,
  );
  return rowToKgHistoryEvent(db.prepare("SELECT * FROM kg_history_events WHERE id = ?").get(id) as unknown as KgHistoryEventRow);
}

export function listKgHistoryEvents(workspaceId: string, limit = 50): KgHistoryEvent[] {
  const safeLimit = Math.max(1, Math.min(200, Math.floor(Number.isFinite(limit) ? limit : 50)));
  const rows = db.prepare(
    "SELECT * FROM kg_history_events WHERE workspace_id = ? ORDER BY created_at DESC LIMIT ?",
  ).all(workspaceId, safeLimit) as unknown as KgHistoryEventRow[];
  return rows.map(rowToKgHistoryEvent);
}

// ---- crowd_datasets ----

function rowToCrowdDataset(r: CrowdDatasetRow): CrowdDataset {
  return {
    id: r.id, workspaceId: r.workspace_id, name: r.name,
    source: r.source as CrowdDatasetSource, status: r.status as CrowdDatasetStatus,
    rowCount: r.row_count, fieldCount: r.field_count,
    fieldProfiles: parseJsonField<CrowdFieldProfile[]>(r.field_profiles, []),
    isAggregate: r.is_aggregate === 1 ? true : undefined,
    errorMessage: r.error_message ?? undefined,
    createdAt: r.created_at, updatedAt: r.updated_at,
  };
}

export interface CrowdDatasetCreateInput {
  name: string;
  source?: CrowdDatasetSource;
  rowCount?: number;
  fieldCount?: number;
  fieldProfiles?: CrowdFieldProfile[];
  isAggregate?: boolean;
}

export function createCrowdDataset(workspaceId: string, input: CrowdDatasetCreateInput): CrowdDataset {
  const id = randomUUID();
  const now = Date.now();
  db.prepare(
    `INSERT INTO crowd_datasets (id, workspace_id, name, source, status, row_count, field_count, field_profiles, is_aggregate, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'ready', ?, ?, ?, ?, ?, ?)`,
  ).run(id, workspaceId, input.name, input.source ?? "upload_csv", input.rowCount ?? 0, input.fieldCount ?? 0, JSON.stringify(input.fieldProfiles ?? []), input.isAggregate ? 1 : 0, now, now);
  return rowToCrowdDataset(db.prepare("SELECT * FROM crowd_datasets WHERE id = ?").get(id) as unknown as CrowdDatasetRow);
}

export function getCrowdDataset(id: string): CrowdDataset | undefined {
  const r = db.prepare("SELECT * FROM crowd_datasets WHERE id = ?").get(id) as unknown as CrowdDatasetRow | undefined;
  return r ? rowToCrowdDataset(r) : undefined;
}

export function listCrowdDatasets(workspaceId: string): CrowdDataset[] {
  const rows = db.prepare("SELECT * FROM crowd_datasets WHERE workspace_id = ? ORDER BY updated_at DESC").all(workspaceId) as unknown as CrowdDatasetRow[];
  return rows.map(rowToCrowdDataset);
}

export interface CrowdDatasetPatch {
  name?: string;
  status?: CrowdDatasetStatus;
  rowCount?: number;
  fieldCount?: number;
  fieldProfiles?: CrowdFieldProfile[];
  isAggregate?: boolean;
  errorMessage?: string | null;
}

export function updateCrowdDataset(id: string, patch: CrowdDatasetPatch): CrowdDataset | undefined {
  const existing = db.prepare("SELECT * FROM crowd_datasets WHERE id = ?").get(id) as unknown as CrowdDatasetRow | undefined;
  if (!existing) return undefined;
  const now = Date.now();
  db.prepare(
    `UPDATE crowd_datasets SET name = ?, status = ?, row_count = ?, field_count = ?, field_profiles = ?, is_aggregate = ?, error_message = ?, updated_at = ? WHERE id = ?`,
  ).run(
    patch.name ?? existing.name, patch.status ?? existing.status,
    patch.rowCount ?? existing.row_count, patch.fieldCount ?? existing.field_count,
    JSON.stringify(patch.fieldProfiles ?? parseJsonField<CrowdFieldProfile[]>(existing.field_profiles, [])),
    patch.isAggregate !== undefined ? (patch.isAggregate ? 1 : 0) : existing.is_aggregate,
    patch.errorMessage !== undefined ? patch.errorMessage : existing.error_message,
    now, id,
  );
  return getCrowdDataset(id);
}

export function deleteCrowdDataset(id: string): boolean {
  db.exec("BEGIN");
  try {
    const profiles = db.prepare(`
      SELECT p.id FROM crowd_profiles p
      JOIN crowd_segments s ON s.id = p.segment_id
      WHERE s.dataset_id = ?
    `).all(id) as Array<{ id: string }>;
    for (const profile of profiles) {
      db.prepare("DELETE FROM crowd_profile_feedback WHERE profile_id = ?").run(profile.id);
      db.prepare("DELETE FROM crowd_profile_versions WHERE profile_id = ?").run(profile.id);
    }
    db.prepare("DELETE FROM crowd_profiles WHERE segment_id IN (SELECT id FROM crowd_segments WHERE dataset_id = ?)").run(id);
    db.prepare("DELETE FROM crowd_segments WHERE dataset_id = ?").run(id);
    db.prepare("DELETE FROM crowd_tag_dictionary WHERE dataset_id = ?").run(id);
    const info = db.prepare("DELETE FROM crowd_datasets WHERE id = ?").run(id);
    db.exec("COMMIT");
    return info.changes > 0;
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
}

// ---- crowd_tag_dictionary ----

function rowToCrowdTagDictionaryEntry(r: CrowdTagDictionaryRow): CrowdTagDictionaryEntry {
  return {
    id: r.id, workspaceId: r.workspace_id, datasetId: r.dataset_id,
    field: r.field, label: r.label, description: r.description,
    dimension: r.dimension as CrowdProfileDimension, sensitivity: r.sensitivity as CrowdTagSensitivity,
    weight: r.weight, valueLabels: parseJsonStrMap(r.value_labels),
    enabled: r.enabled === 1, autoGenerated: r.auto_generated === 1 ? true : undefined,
    createdAt: r.created_at, updatedAt: r.updated_at,
  };
}

export function listCrowdTagDictionary(workspaceId: string, datasetId: string): CrowdTagDictionaryEntry[] {
  const rows = db.prepare(
    "SELECT * FROM crowd_tag_dictionary WHERE workspace_id = ? AND dataset_id = ? ORDER BY field",
  ).all(workspaceId, datasetId) as unknown as CrowdTagDictionaryRow[];
  return rows.map(rowToCrowdTagDictionaryEntry);
}

export interface CrowdTagDictionaryEntryInput {
  field: string;
  label: string;
  description?: string;
  dimension?: CrowdProfileDimension;
  sensitivity?: CrowdTagSensitivity;
  weight?: number;
  valueLabels?: Record<string, string>;
  enabled?: boolean;
  autoGenerated?: boolean;
}

export function saveCrowdTagDictionary(workspaceId: string, datasetId: string, entries: CrowdTagDictionaryEntryInput[]): CrowdTagDictionaryEntry[] {
  const now = Date.now();
  db.exec("BEGIN");
  try {
    db.prepare("DELETE FROM crowd_tag_dictionary WHERE workspace_id = ? AND dataset_id = ?").run(workspaceId, datasetId);
    const result: CrowdTagDictionaryEntry[] = [];
    for (const e of entries) {
      const id = randomUUID();
      db.prepare(
        `INSERT INTO crowd_tag_dictionary (id, workspace_id, dataset_id, field, label, description, dimension, sensitivity, weight, value_labels, enabled, auto_generated, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(id, workspaceId, datasetId, e.field, e.label, e.description ?? "", e.dimension ?? "custom", e.sensitivity ?? "internal", e.weight ?? 1, JSON.stringify(e.valueLabels ?? {}), e.enabled !== false ? 1 : 0, e.autoGenerated ? 1 : 0, now, now);
      result.push(rowToCrowdTagDictionaryEntry(db.prepare("SELECT * FROM crowd_tag_dictionary WHERE id = ?").get(id) as unknown as CrowdTagDictionaryRow));
    }
    db.exec("COMMIT");
    return result;
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
}

// ---- crowd_segments ----

function rowToCrowdSegment(r: CrowdSegmentRow): CrowdSegment {
  return {
    id: r.id, workspaceId: r.workspace_id, datasetId: r.dataset_id,
    name: r.name, description: r.description,
    rule: parseJsonField<CrowdSegmentRuleGroup>(r.rule, { logic: "and", conditions: [] }),
    sampleCount: r.sample_count, coverageRatio: r.coverage_ratio,
    tagDistribution: parseJsonField<Record<string, CrowdTagValueSummary[]>>(r.tag_distribution, {}),
    autoGenerated: r.auto_generated === 1 ? true : undefined,
    createdAt: r.created_at, updatedAt: r.updated_at,
  };
}

export interface CrowdSegmentCreateInput {
  datasetId: string;
  name: string;
  description?: string;
  rule?: CrowdSegmentRuleGroup;
  autoGenerated?: boolean;
}

export function createCrowdSegment(workspaceId: string, input: CrowdSegmentCreateInput): CrowdSegment {
  const id = randomUUID();
  const now = Date.now();
  db.prepare(
    `INSERT INTO crowd_segments (id, workspace_id, dataset_id, name, description, rule, sample_count, coverage_ratio, tag_distribution, auto_generated, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, 0, 0, '{}', ?, ?, ?)`,
  ).run(id, workspaceId, input.datasetId, input.name, input.description ?? "", JSON.stringify(input.rule ?? { logic: "and", conditions: [] }), input.autoGenerated ? 1 : 0, now, now);
  return rowToCrowdSegment(db.prepare("SELECT * FROM crowd_segments WHERE id = ?").get(id) as unknown as CrowdSegmentRow);
}

export function getCrowdSegment(id: string): CrowdSegment | undefined {
  const r = db.prepare("SELECT * FROM crowd_segments WHERE id = ?").get(id) as unknown as CrowdSegmentRow | undefined;
  return r ? rowToCrowdSegment(r) : undefined;
}

export function listCrowdSegments(workspaceId: string, datasetId?: string): CrowdSegment[] {
  const rows = (datasetId
    ? db.prepare("SELECT * FROM crowd_segments WHERE workspace_id = ? AND dataset_id = ? ORDER BY updated_at DESC").all(workspaceId, datasetId)
    : db.prepare("SELECT * FROM crowd_segments WHERE workspace_id = ? ORDER BY updated_at DESC").all(workspaceId)) as unknown as CrowdSegmentRow[];
  return rows.map(rowToCrowdSegment);
}

export interface CrowdSegmentPatch {
  name?: string;
  description?: string;
  rule?: CrowdSegmentRuleGroup;
  sampleCount?: number;
  coverageRatio?: number;
  tagDistribution?: Record<string, CrowdTagValueSummary[]>;
  autoGenerated?: boolean;
}

export function updateCrowdSegment(id: string, patch: CrowdSegmentPatch): CrowdSegment | undefined {
  const existing = db.prepare("SELECT * FROM crowd_segments WHERE id = ?").get(id) as unknown as CrowdSegmentRow | undefined;
  if (!existing) return undefined;
  const now = Date.now();
  db.prepare(
    `UPDATE crowd_segments SET name = ?, description = ?, rule = ?, sample_count = ?, coverage_ratio = ?, tag_distribution = ?, auto_generated = ?, updated_at = ? WHERE id = ?`,
  ).run(
    patch.name ?? existing.name,
    patch.description ?? existing.description,
    JSON.stringify(patch.rule ?? parseJsonField<CrowdSegmentRuleGroup>(existing.rule, { logic: "and", conditions: [] })),
    patch.sampleCount ?? existing.sample_count,
    patch.coverageRatio ?? existing.coverage_ratio,
    JSON.stringify(patch.tagDistribution ?? parseJsonField<Record<string, CrowdTagValueSummary[]>>(existing.tag_distribution, {})),
    patch.autoGenerated !== undefined ? (patch.autoGenerated ? 1 : 0) : existing.auto_generated,
    now, id,
  );
  return getCrowdSegment(id);
}

export function deleteCrowdSegment(id: string): boolean {
  db.exec("BEGIN");
  try {
    const profiles = db.prepare("SELECT id FROM crowd_profiles WHERE segment_id = ?").all(id) as Array<{ id: string }>;
    for (const profile of profiles) {
      db.prepare("DELETE FROM crowd_profile_feedback WHERE profile_id = ?").run(profile.id);
      db.prepare("DELETE FROM crowd_profile_versions WHERE profile_id = ?").run(profile.id);
    }
    db.prepare("DELETE FROM crowd_profiles WHERE segment_id = ?").run(id);
    const info = db.prepare("DELETE FROM crowd_segments WHERE id = ?").run(id);
    db.exec("COMMIT");
    return info.changes > 0;
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
}

// ---- crowd_profiles ----

function rowToCrowdProfile(r: CrowdProfileRow): CrowdProfile {
  return {
    id: r.id, workspaceId: r.workspace_id, segmentId: r.segment_id,
    name: r.name, status: r.status as CrowdProfileStatus,
    currentVersionId: r.current_version_id,
    publishedSubAgentTemplateId: r.published_subagent_template_id ?? undefined,
    createdAt: r.created_at, updatedAt: r.updated_at,
  };
}

export interface CrowdProfileCreateInput {
  segmentId: string;
  name: string;
  status?: CrowdProfileStatus;
}

export function createCrowdProfile(workspaceId: string, input: CrowdProfileCreateInput): CrowdProfile {
  const id = randomUUID();
  const now = Date.now();
  db.prepare(
    `INSERT INTO crowd_profiles (id, workspace_id, segment_id, name, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(id, workspaceId, input.segmentId, input.name, input.status ?? "draft", now, now);
  return rowToCrowdProfile(db.prepare("SELECT * FROM crowd_profiles WHERE id = ?").get(id) as unknown as CrowdProfileRow);
}

export function getCrowdProfile(id: string): CrowdProfile | undefined {
  const r = db.prepare("SELECT * FROM crowd_profiles WHERE id = ?").get(id) as unknown as CrowdProfileRow | undefined;
  return r ? rowToCrowdProfile(r) : undefined;
}

export function listCrowdProfiles(workspaceId: string, segmentId?: string): CrowdProfile[] {
  const rows = (segmentId
    ? db.prepare("SELECT * FROM crowd_profiles WHERE workspace_id = ? AND segment_id = ? ORDER BY updated_at DESC").all(workspaceId, segmentId)
    : db.prepare("SELECT * FROM crowd_profiles WHERE workspace_id = ? ORDER BY updated_at DESC").all(workspaceId)) as unknown as CrowdProfileRow[];
  return rows.map(rowToCrowdProfile);
}

export interface CrowdProfilePatch {
  name?: string;
  status?: CrowdProfileStatus;
  currentVersionId?: string | null;
  publishedSubAgentTemplateId?: string | null;
}

export function updateCrowdProfile(id: string, patch: CrowdProfilePatch): CrowdProfile | undefined {
  const existing = db.prepare("SELECT * FROM crowd_profiles WHERE id = ?").get(id) as unknown as CrowdProfileRow | undefined;
  if (!existing) return undefined;
  const now = Date.now();
  db.prepare(
    `UPDATE crowd_profiles SET name = ?, status = ?, current_version_id = ?, published_subagent_template_id = ?, updated_at = ? WHERE id = ?`,
  ).run(
    patch.name ?? existing.name, patch.status ?? existing.status,
    patch.currentVersionId !== undefined ? patch.currentVersionId : existing.current_version_id,
    patch.publishedSubAgentTemplateId !== undefined ? patch.publishedSubAgentTemplateId : existing.published_subagent_template_id,
    now, id,
  );
  return getCrowdProfile(id);
}

export function deleteCrowdProfile(id: string): boolean {
  db.exec("BEGIN");
  try {
    db.prepare("DELETE FROM crowd_profile_feedback WHERE profile_id = ?").run(id);
    db.prepare("DELETE FROM crowd_profile_versions WHERE profile_id = ?").run(id);
    const info = db.prepare("DELETE FROM crowd_profiles WHERE id = ?").run(id);
    db.exec("COMMIT");
    return info.changes > 0;
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
}

// ---- crowd_profile_versions ----

function rowToCrowdProfileVersion(r: CrowdProfileVersionRow): CrowdProfileVersion {
  return {
    id: r.id, workspaceId: r.workspace_id, profileId: r.profile_id,
    version: r.version,
    content: parseJsonField<CrowdProfileContent>(r.content, { traits: [], motivations: [], decisionTriggers: [], objections: [], tone: "", contentPreference: [], riskNotes: [], evidenceSummary: [], persona: "" }),
    source: r.source as CrowdProfileVersion["source"],
    sourceFeedbackId: r.source_feedback_id ?? undefined,
    createdAt: r.created_at,
  };
}

export interface CrowdProfileVersionCreateInput {
  content: CrowdProfileContent;
  source?: CrowdProfileVersion["source"];
  sourceFeedbackId?: string;
}

export function createCrowdProfileVersion(workspaceId: string, profileId: string, input: CrowdProfileVersionCreateInput): CrowdProfileVersion {
  const existing = db.prepare("SELECT * FROM crowd_profiles WHERE id = ?").get(profileId) as unknown as CrowdProfileRow | undefined;
  if (!existing) throw new Error("profile not found");
  if (existing.workspace_id !== workspaceId) throw new Error("profile belongs to another workspace");
  const maxVer = db.prepare("SELECT MAX(version) as mv FROM crowd_profile_versions WHERE profile_id = ?").get(profileId) as unknown as { mv: number | null };
  const nextVer = (maxVer?.mv ?? 0) + 1;
  const id = randomUUID();
  const now = Date.now();
  db.prepare(
    `INSERT INTO crowd_profile_versions (id, workspace_id, profile_id, version, content, source, source_feedback_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(id, workspaceId, profileId, nextVer, JSON.stringify(input.content), input.source ?? "generated", input.sourceFeedbackId ?? null, now);
  return rowToCrowdProfileVersion(db.prepare("SELECT * FROM crowd_profile_versions WHERE id = ?").get(id) as unknown as CrowdProfileVersionRow);
}

export function getCrowdProfileVersion(id: string): CrowdProfileVersion | undefined {
  const r = db.prepare("SELECT * FROM crowd_profile_versions WHERE id = ?").get(id) as unknown as CrowdProfileVersionRow | undefined;
  return r ? rowToCrowdProfileVersion(r) : undefined;
}

export function listCrowdProfileVersions(profileId: string): CrowdProfileVersion[] {
  const rows = db.prepare("SELECT * FROM crowd_profile_versions WHERE profile_id = ? ORDER BY version DESC").all(profileId) as unknown as CrowdProfileVersionRow[];
  return rows.map(rowToCrowdProfileVersion);
}

// ---- crowd_profile_feedback ----

function rowToCrowdProfileFeedback(r: CrowdProfileFeedbackRow): CrowdProfileFeedback {
  return {
    id: r.id, workspaceId: r.workspace_id, profileId: r.profile_id,
    profileVersionId: r.profile_version_id,
    sourceRunId: r.source_run_id ?? undefined,
    sourceLifeFormId: r.source_life_form_id ?? undefined,
    objections: parseJsonStrArray(r.objections),
    acceptanceConditions: parseJsonStrArray(r.acceptance_conditions),
    suggestions: parseJsonStrArray(r.suggestions),
    status: r.status as CrowdProfileFeedbackStatus,
    createdAt: r.created_at, reviewedAt: r.reviewed_at ?? undefined,
  };
}

export interface CrowdProfileFeedbackCreateInput {
  profileVersionId: string;
  sourceRunId?: string;
  sourceLifeFormId?: string;
  objections?: string[];
  acceptanceConditions?: string[];
  suggestions?: string[];
}

export function createCrowdProfileFeedback(workspaceId: string, profileId: string, input: CrowdProfileFeedbackCreateInput): CrowdProfileFeedback {
  const version = getCrowdProfileVersion(input.profileVersionId);
  if (!version) throw new Error("profile version not found");
  if (version.workspaceId !== workspaceId || version.profileId !== profileId) {
    throw new Error("profile version belongs to another profile or workspace");
  }
  const id = randomUUID();
  const now = Date.now();
  db.prepare(
    `INSERT INTO crowd_profile_feedback (id, workspace_id, profile_id, profile_version_id, source_run_id, source_life_form_id, objections, acceptance_conditions, suggestions, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)`,
  ).run(id, workspaceId, profileId, input.profileVersionId, input.sourceRunId ?? null, input.sourceLifeFormId ?? null, JSON.stringify(input.objections ?? []), JSON.stringify(input.acceptanceConditions ?? []), JSON.stringify(input.suggestions ?? []), now);
  return rowToCrowdProfileFeedback(db.prepare("SELECT * FROM crowd_profile_feedback WHERE id = ?").get(id) as unknown as CrowdProfileFeedbackRow);
}

export function listCrowdProfileFeedback(profileId: string): CrowdProfileFeedback[] {
  const rows = db.prepare("SELECT * FROM crowd_profile_feedback WHERE profile_id = ? ORDER BY created_at DESC").all(profileId) as unknown as CrowdProfileFeedbackRow[];
  return rows.map(rowToCrowdProfileFeedback);
}

export function getCrowdProfileFeedback(id: string): CrowdProfileFeedback | undefined {
  const r = db.prepare("SELECT * FROM crowd_profile_feedback WHERE id = ?").get(id) as unknown as CrowdProfileFeedbackRow | undefined;
  return r ? rowToCrowdProfileFeedback(r) : undefined;
}

export function updateCrowdProfileFeedbackStatus(id: string, profileId: string, status: CrowdProfileFeedbackStatus): CrowdProfileFeedback | undefined {
  const now = Date.now();
  const info = db.prepare(
    `UPDATE crowd_profile_feedback SET status = ?, reviewed_at = ? WHERE id = ? AND profile_id = ? AND status = 'pending'`,
  ).run(status, status !== "pending" ? now : null, id, profileId);
  if (info.changes === 0) return undefined;
  const r = db.prepare("SELECT * FROM crowd_profile_feedback WHERE id = ?").get(id) as unknown as CrowdProfileFeedbackRow;
  return rowToCrowdProfileFeedback(r);
}

// ---- crowd_subagent_draft (纯函数，不写表) ----

export function buildCrowdSubAgentDraft(profileId: string, versionId: string): CrowdSubAgentDraft | undefined {
  const profile = getCrowdProfile(profileId);
  if (!profile) return undefined;
  const version = getCrowdProfileVersion(versionId);
  if (!version || version.profileId !== profileId) return undefined;
  return {
    name: profile.name,
    persona: version.content.persona,
    source: "crowd_profile",
    crowdProfileId: profileId,
    crowdProfileVersionId: versionId,
  };
}

// ---- profile lifecycle ----

function appendUnique(values: string[], additions: string[]): string[] {
  const seen = new Set(values);
  const next = [...values];
  for (const item of additions) {
    const trimmed = item.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    next.push(trimmed);
  }
  return next;
}

export function adoptFeedbackToVersion(
  feedbackId: string,
  workspaceId: string,
  profileId: string,
): { version: CrowdProfileVersion; profile: CrowdProfile } | undefined {
  const feedback = getCrowdProfileFeedback(feedbackId);
  if (!feedback || feedback.profileId !== profileId || feedback.status !== "pending") return undefined;
  const baseVersion = getCrowdProfileVersion(feedback.profileVersionId);
  if (!baseVersion || baseVersion.workspaceId !== workspaceId || baseVersion.profileId !== profileId) return undefined;
  db.exec("BEGIN");
  try {
    const content: CrowdProfileContent = {
      ...baseVersion.content,
      objections: appendUnique(baseVersion.content.objections, feedback.objections),
      riskNotes: appendUnique(baseVersion.content.riskNotes, feedback.acceptanceConditions),
      decisionTriggers: appendUnique(baseVersion.content.decisionTriggers, feedback.suggestions),
      evidenceSummary: appendUnique(baseVersion.content.evidenceSummary, [
        `Adopted simulation feedback ${feedback.id}`,
        ...(feedback.sourceRunId ? [`Source simulation run ${feedback.sourceRunId}`] : []),
      ]),
    };
    const version = createCrowdProfileVersion(workspaceId, profileId, {
      content,
      source: "simulation_feedback",
      sourceFeedbackId: feedbackId,
    });
    updateCrowdProfileFeedbackStatus(feedbackId, profileId, "adopted");
    updateCrowdProfile(profileId, { currentVersionId: version.id });
    db.exec("COMMIT");
    const profile = getCrowdProfile(profileId)!;
    return { version, profile };
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
}

export function rollbackProfileToVersion(
  profileId: string,
  versionId: string,
): CrowdProfile | undefined {
  const version = getCrowdProfileVersion(versionId);
  if (!version || version.profileId !== profileId) return undefined;
  return updateCrowdProfile(profileId, { currentVersionId: versionId }) ?? undefined;
}
