import { randomUUID } from "node:crypto";
import { db } from "../db.ts";
import { enableForOrigin } from "./shared.ts";
import type {
  Ontology,
  ObjectType,
  ObjectKind,
  PropertyType,
  PropertyDataType,
  LinkType,
  LinkKind,
  MetricDefinition,
  MetricDefinitionInput,
  LogicRule,
  LogicRuleInput,
  OntoAction,
  OntoActionInput,
  OntoPrompt,
  OntoPromptInput,
  ActionItem,
  ActionTask,
  ActionFeedback,
  ActionScene,
  ActionLifecycle,
  ActionPriority,
  ActionEffort,
  ActionItemStatus,
  ActionTaskStatus,
  ExtractJob,
  ExtractJobStatus,
  MonitorConfig,
  MonitorDatasetBinding,
  TargetPlan,
  TargetPlanStatus,
  TargetCalculationInput,
  TargetCalculationResult,
} from "../types.ts";
import type { ValidationIssue } from "../onto-validator.ts";

export interface DbDashboard {
  id: string;
  workspace_id: string;
  name: string;
  layout_json: string;
  created_at: number;
  updated_at: number;
}

/**
 * 【Agent-V · 可视交付域】db 表 slot —— owner: antigravity(Gemini)
 * 看板画布 / 报告模板等新表建在此（reports/report_tags/kg legacy 仍在 db.ts）。
 * 约定: 新表 CREATE TABLE IF NOT EXISTS; 配套 CRUD 写本文件, 由 routes/viz.ts 调用。
 */
export function initVizTables(): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS dashboards (
      id           TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL REFERENCES workspaces(id),
      name         TEXT NOT NULL,
      layout_json  TEXT NOT NULL,
      created_at   INTEGER NOT NULL,
      updated_at   INTEGER NOT NULL
    );
  `);
  try {
    db.exec(`CREATE INDEX IF NOT EXISTS idx_dashboards_workspace ON dashboards(workspace_id);`);
  } catch {
    // ignore
  }
  initOntoTables();
  initActionTables();
  initTargetPlanTables();
}

function initActionTables(): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS action_items (
      id TEXT PRIMARY KEY,
      source_kind TEXT NOT NULL,
      scope_id TEXT NOT NULL,
      run_id TEXT,
      report_path TEXT NOT NULL,
      title TEXT NOT NULL,
      rationale TEXT NOT NULL,
      scene TEXT NOT NULL,
      lifecycle TEXT NOT NULL,
      expected_impact TEXT NOT NULL,
      metric_ref TEXT,
      priority TEXT NOT NULL,
      effort TEXT NOT NULL,
      confidence REAL NOT NULL,
      status TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS action_tasks (
      id TEXT PRIMARY KEY,
      action_item_id TEXT NOT NULL REFERENCES action_items(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      owner TEXT NOT NULL,
      due_date TEXT,
      status TEXT NOT NULL,
      priority TEXT NOT NULL,
      note TEXT NOT NULL DEFAULT '',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS action_feedback (
      id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL REFERENCES action_tasks(id) ON DELETE CASCADE,
      adopted INTEGER NOT NULL,
      outcome TEXT NOT NULL DEFAULT '',
      metric_delta TEXT NOT NULL DEFAULT '',
      review TEXT NOT NULL DEFAULT '',
      score INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL
    );
  `);
  try {
    db.exec(`CREATE INDEX IF NOT EXISTS idx_action_items_scope ON action_items(scope_id, report_path);`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_action_tasks_item ON action_tasks(action_item_id);`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_action_feedback_task ON action_feedback(task_id);`);
  } catch {
    // ignore
  }
}

/**
 * onto-xanthil 数据语义层表（详见 docs/onto-xanthil-design.md）。
 * 5 张表：ontologies / object_types / property_types / link_types / metric_definitions。
 */
function initOntoTables(): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS ontologies (
      id           TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL REFERENCES workspaces(id),
      name         TEXT NOT NULL,
      domain       TEXT NOT NULL DEFAULT '',
      version      TEXT NOT NULL DEFAULT 'v0.1',
      status       TEXT NOT NULL DEFAULT 'draft',
      created_at   INTEGER NOT NULL,
      updated_at   INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS object_types (
      id           TEXT PRIMARY KEY,
      ontology_id  TEXT NOT NULL REFERENCES ontologies(id) ON DELETE CASCADE,
      kind         TEXT NOT NULL DEFAULT 'concept',
      name_cn      TEXT NOT NULL,
      name_en      TEXT,
      description  TEXT NOT NULL DEFAULT '',
      bound_path_id TEXT,
      confidence   REAL NOT NULL DEFAULT 1.0,
      created_at   INTEGER NOT NULL,
      updated_at   INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS property_types (
      id             TEXT PRIMARY KEY,
      object_type_id TEXT NOT NULL REFERENCES object_types(id) ON DELETE CASCADE,
      name           TEXT NOT NULL,
      data_type      TEXT NOT NULL DEFAULT 'unknown',
      bound_column   TEXT,
      semantic_type  TEXT,
      description    TEXT
    );
    CREATE TABLE IF NOT EXISTS link_types (
      id               TEXT PRIMARY KEY,
      ontology_id      TEXT NOT NULL REFERENCES ontologies(id) ON DELETE CASCADE,
      source_object_id TEXT NOT NULL REFERENCES object_types(id) ON DELETE CASCADE,
      target_object_id TEXT NOT NULL REFERENCES object_types(id) ON DELETE CASCADE,
      kind             TEXT NOT NULL DEFAULT 'related',
      join_keys        TEXT,
      confidence       REAL NOT NULL DEFAULT 1.0,
      created_at       INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS metric_definitions (
      id             TEXT PRIMARY KEY,
      workspace_id   TEXT NOT NULL REFERENCES workspaces(id),
      name           TEXT NOT NULL,
      category       TEXT NOT NULL DEFAULT '',
      description    TEXT NOT NULL DEFAULT '',
      formula        TEXT NOT NULL DEFAULT '',
      caliber        TEXT NOT NULL DEFAULT '',
      unit           TEXT NOT NULL DEFAULT '',
      object_type_id TEXT,
      bound_columns  TEXT,
      display_name   TEXT,
      aggregation    TEXT,
      period_grain   TEXT,
      filters        TEXT,
      denominator    TEXT,
      version        INTEGER,
      enabled        INTEGER NOT NULL DEFAULT 1,
      created_at     INTEGER NOT NULL,
      updated_at     INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS logic_rules (
      id                TEXT PRIMARY KEY,
      ontology_id       TEXT NOT NULL REFERENCES ontologies(id) ON DELETE CASCADE,
      name_cn           TEXT NOT NULL,
      name_en           TEXT,
      description       TEXT NOT NULL DEFAULT '',
      formula           TEXT NOT NULL DEFAULT '',
      linked_object_ids TEXT NOT NULL DEFAULT '[]',
      confidence        REAL NOT NULL DEFAULT 1.0,
      created_at        INTEGER NOT NULL,
      updated_at        INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS onto_actions (
      id                TEXT PRIMARY KEY,
      ontology_id       TEXT NOT NULL REFERENCES ontologies(id) ON DELETE CASCADE,
      name_cn           TEXT NOT NULL,
      name_en           TEXT,
      description       TEXT NOT NULL DEFAULT '',
      execution_rule    TEXT NOT NULL DEFAULT '',
      function_code     TEXT NOT NULL DEFAULT '',
      linked_object_ids TEXT NOT NULL DEFAULT '[]',
      linked_logic_ids  TEXT NOT NULL DEFAULT '[]',
      confidence        REAL NOT NULL DEFAULT 1.0,
      created_at        INTEGER NOT NULL,
      updated_at        INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS onto_prompts (
      id           TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL REFERENCES workspaces(id),
      name         TEXT NOT NULL,
      content      TEXT NOT NULL DEFAULT '',
      version      TEXT NOT NULL DEFAULT 'v1.0',
      created_at   INTEGER NOT NULL,
      updated_at   INTEGER NOT NULL
    );
  `);
  db.exec(`
    CREATE TABLE IF NOT EXISTS extract_jobs (
      id             TEXT PRIMARY KEY,
      ontology_id    TEXT NOT NULL REFERENCES ontologies(id) ON DELETE CASCADE,
      status         TEXT NOT NULL DEFAULT 'running',
      total_chunks   INTEGER NOT NULL DEFAULT 0,
      done_chunks    INTEGER NOT NULL DEFAULT 0,
      created_objects INTEGER NOT NULL DEFAULT 0,
      created_links  INTEGER NOT NULL DEFAULT 0,
      created_logic_rules INTEGER NOT NULL DEFAULT 0,
      created_actions INTEGER NOT NULL DEFAULT 0,
      skipped_objects INTEGER NOT NULL DEFAULT 0,
      skipped_links  INTEGER NOT NULL DEFAULT 0,
      has_fatal      INTEGER NOT NULL DEFAULT 0,
      issues_json    TEXT NOT NULL DEFAULT '[]',
      error          TEXT,
      created_at     INTEGER NOT NULL,
      updated_at     INTEGER NOT NULL
    );
  `);
  // ── 体检模块（V-HEALTH2）──
  db.exec(`
    CREATE TABLE IF NOT EXISTS health_runs (
      id              TEXT PRIMARY KEY,
      workspace_id    TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      suite           TEXT NOT NULL,
      dataset_path_ids TEXT NOT NULL DEFAULT '[]',
      started_at      INTEGER NOT NULL,
      finished_at     INTEGER,
      problem_count   INTEGER NOT NULL DEFAULT 0,
      risk_count      INTEGER NOT NULL DEFAULT 0,
      status          TEXT NOT NULL DEFAULT 'running'
    );
    CREATE TABLE IF NOT EXISTS health_findings (
      id                   TEXT PRIMARY KEY,
      run_id               TEXT NOT NULL REFERENCES health_runs(id) ON DELETE CASCADE,
      rule_id              TEXT NOT NULL,
      category             TEXT NOT NULL,
      kind                 TEXT NOT NULL,
      severity             TEXT NOT NULL,
      lifecycle            TEXT NOT NULL,
      signature            TEXT NOT NULL,
      first_seen_run_id    TEXT,
      title                TEXT NOT NULL,
      evidence_json        TEXT NOT NULL DEFAULT '{}',
      bound_to_json        TEXT NOT NULL DEFAULT '{}',
      suggestion           TEXT NOT NULL DEFAULT '',
      detected_at          INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS ontology_gaps (
      id              TEXT PRIMARY KEY,
      run_id          TEXT NOT NULL REFERENCES health_runs(id) ON DELETE CASCADE,
      dataset_path_id TEXT NOT NULL,
      column_name     TEXT NOT NULL,
      reason          TEXT NOT NULL,
      suggested_concept TEXT,
      created_at      INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS monitor_configs (
      id                TEXT PRIMARY KEY,
      workspace_id      TEXT NOT NULL UNIQUE REFERENCES workspaces(id) ON DELETE CASCADE,
      suite             TEXT NOT NULL DEFAULT 'monthly',
      dataset_bindings  TEXT NOT NULL DEFAULT '[]',
      ontology_id       TEXT,
      metric_system_id  TEXT,
      thresholds_json   TEXT,
      created_at        INTEGER NOT NULL,
      updated_at        INTEGER NOT NULL
    );
  `);
  try {
    db.exec(`CREATE INDEX IF NOT EXISTS idx_ontologies_ws ON ontologies(workspace_id);`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_object_types_onto ON object_types(ontology_id);`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_property_types_obj ON property_types(object_type_id);`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_link_types_onto ON link_types(ontology_id);`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_metric_defs_ws ON metric_definitions(workspace_id);`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_logic_rules_onto ON logic_rules(ontology_id);`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_onto_actions_onto ON onto_actions(ontology_id);`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_onto_prompts_ws ON onto_prompts(workspace_id);`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_extract_jobs_onto ON extract_jobs(ontology_id);`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_health_runs_ws ON health_runs(workspace_id);`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_health_findings_run ON health_findings(run_id);`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_ontology_gaps_run ON ontology_gaps(run_id);`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_monitor_configs_ws ON monitor_configs(workspace_id);`);
  } catch {
    // ignore
  }
  for (const [column, ddl] of [
    ["display_name", "TEXT"],
    ["aggregation", "TEXT"],
    ["period_grain", "TEXT"],
    ["filters", "TEXT"],
    ["denominator", "TEXT"],
    ["version", "INTEGER"],
  ] as const) {
    try {
      db.prepare(`ALTER TABLE metric_definitions ADD COLUMN ${column} ${ddl}`).run();
    } catch (err) {
      if (!String(err).includes("duplicate column name")) throw err;
    }
  }
}

export function listDashboards(workspaceId: string): DbDashboard[] {
  return db
    .prepare(
      "SELECT id, workspace_id, name, layout_json, created_at, updated_at FROM dashboards WHERE workspace_id = ? ORDER BY updated_at DESC"
    )
    .all(workspaceId) as unknown as DbDashboard[];
}

export function getDashboard(id: string): DbDashboard | undefined {
  return db
    .prepare(
      "SELECT id, workspace_id, name, layout_json, created_at, updated_at FROM dashboards WHERE id = ?"
    )
    .get(id) as unknown as DbDashboard | undefined;
}

export function createDashboard(workspaceId: string, name: string, layoutJson: string): DbDashboard {
  const id = randomUUID();
  const now = Date.now();
  db.prepare(
    "INSERT INTO dashboards (id, workspace_id, name, layout_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)"
  ).run(id, workspaceId, name, layoutJson, now, now);
  
  return {
    id,
    workspace_id: workspaceId,
    name,
    layout_json: layoutJson,
    created_at: now,
    updated_at: now,
  };
}

export function updateDashboard(id: string, name?: string, layoutJson?: string): DbDashboard | undefined {
  const existing = getDashboard(id);
  if (!existing) return undefined;

  const newName = name !== undefined ? name : existing.name;
  const newLayout = layoutJson !== undefined ? layoutJson : existing.layout_json;
  const now = Date.now();

  db.prepare(
    "UPDATE dashboards SET name = ?, layout_json = ?, updated_at = ? WHERE id = ?"
  ).run(newName, newLayout, now, id);

  return {
    ...existing,
    name: newName,
    layout_json: newLayout,
    updated_at: now,
  };
}

export function deleteDashboard(id: string): boolean {
  const res = db.prepare("DELETE FROM dashboards WHERE id = ?").run(id);
  return res.changes > 0;
}


// ============================================================================
// onto-xanthil CRUD（详见 docs/onto-xanthil-design.md）
// ============================================================================

interface OntologyRow {
  id: string; workspace_id: string; name: string; domain: string;
  version: string; status: string; created_at: number; updated_at: number;
}
function parseOntology(r: OntologyRow): Ontology {
  return {
    id: r.id, workspaceId: r.workspace_id, name: r.name, domain: r.domain,
    version: r.version, status: r.status as Ontology["status"],
    createdAt: r.created_at, updatedAt: r.updated_at,
  };
}

// 全局池（粒度=本体整体）：返回所有工作区的本体。"本工作区是否启用" 见 enablement 表(kind='ontology')。
// 本体的 object/property/link/logic/action 均按 ontology_id 维度，跟随其本体启用，不单独建关系。
export function listOntologies(_workspaceId?: string): Ontology[] {
  return (db.prepare(
    "SELECT * FROM ontologies ORDER BY updated_at DESC"
  ).all() as unknown as OntologyRow[]).map(parseOntology);
}

export function getOntology(id: string): Ontology | undefined {
  const r = db.prepare("SELECT * FROM ontologies WHERE id = ?").get(id) as unknown as OntologyRow | undefined;
  return r ? parseOntology(r) : undefined;
}

export function createOntology(workspaceId: string, name: string, domain = "", version = "v0.1"): Ontology {
  const id = randomUUID();
  const now = Date.now();
  db.prepare(
    "INSERT INTO ontologies (id, workspace_id, name, domain, version, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 'draft', ?, ?)"
  ).run(id, workspaceId, name, domain, version, now, now);
  enableForOrigin(workspaceId, "ontology", id); // 新本体：origin 工作区默认启用
  return { id, workspaceId, name, domain, version, status: "draft", createdAt: now, updatedAt: now };
}

export function updateOntology(
  id: string,
  patch: Partial<Pick<Ontology, "name" | "domain" | "version" | "status">>
): Ontology | undefined {
  const existing = getOntology(id);
  if (!existing) return undefined;
  const next = { ...existing, ...patch, updatedAt: Date.now() };
  db.prepare(
    "UPDATE ontologies SET name = ?, domain = ?, version = ?, status = ?, updated_at = ? WHERE id = ?"
  ).run(next.name, next.domain, next.version, next.status, next.updatedAt, id);
  return next;
}

export function deleteOntology(id: string): boolean {
  return db.prepare("DELETE FROM ontologies WHERE id = ?").run(id).changes > 0;
}

// ---- ObjectType ----
interface ObjectTypeRow {
  id: string; ontology_id: string; kind: string; name_cn: string; name_en: string | null;
  description: string; bound_path_id: string | null; confidence: number;
  created_at: number; updated_at: number;
}
function parseObjectType(r: ObjectTypeRow): ObjectType {
  return {
    id: r.id, ontologyId: r.ontology_id, kind: r.kind as ObjectKind,
    nameCn: r.name_cn, nameEn: r.name_en ?? undefined, description: r.description,
    boundPathId: r.bound_path_id ?? undefined, confidence: r.confidence,
    createdAt: r.created_at, updatedAt: r.updated_at,
  };
}

export function listObjectTypes(ontologyId: string, kind?: ObjectKind): ObjectType[] {
  const rows = kind
    ? db.prepare("SELECT * FROM object_types WHERE ontology_id = ? AND kind = ? ORDER BY name_cn").all(ontologyId, kind)
    : db.prepare("SELECT * FROM object_types WHERE ontology_id = ? ORDER BY name_cn").all(ontologyId);
  return (rows as unknown as ObjectTypeRow[]).map(parseObjectType);
}

export function getObjectType(id: string): ObjectType | undefined {
  const r = db.prepare("SELECT * FROM object_types WHERE id = ?").get(id) as unknown as ObjectTypeRow | undefined;
  return r ? parseObjectType(r) : undefined;
}

export interface ObjectTypeInput {
  kind: ObjectKind; nameCn: string; nameEn?: string; description?: string;
  boundPathId?: string; confidence?: number;
}
export function createObjectType(ontologyId: string, input: ObjectTypeInput): ObjectType {
  const id = randomUUID();
  const now = Date.now();
  db.prepare(
    "INSERT INTO object_types (id, ontology_id, kind, name_cn, name_en, description, bound_path_id, confidence, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
  ).run(id, ontologyId, input.kind, input.nameCn, input.nameEn ?? null, input.description ?? "", input.boundPathId ?? null, input.confidence ?? 1.0, now, now);
  return parseObjectType({
    id, ontology_id: ontologyId, kind: input.kind, name_cn: input.nameCn,
    name_en: input.nameEn ?? null, description: input.description ?? "",
    bound_path_id: input.boundPathId ?? null, confidence: input.confidence ?? 1.0,
    created_at: now, updated_at: now,
  });
}

export function updateObjectType(id: string, patch: Partial<ObjectTypeInput>): ObjectType | undefined {
  const existing = getObjectType(id);
  if (!existing) return undefined;
  const next: ObjectType = {
    ...existing,
    kind: patch.kind ?? existing.kind,
    nameCn: patch.nameCn ?? existing.nameCn,
    nameEn: patch.nameEn ?? existing.nameEn,
    description: patch.description ?? existing.description,
    boundPathId: patch.boundPathId ?? existing.boundPathId,
    confidence: patch.confidence ?? existing.confidence,
    updatedAt: Date.now(),
  };
  db.prepare(
    "UPDATE object_types SET kind = ?, name_cn = ?, name_en = ?, description = ?, bound_path_id = ?, confidence = ?, updated_at = ? WHERE id = ?"
  ).run(next.kind, next.nameCn, next.nameEn ?? null, next.description, next.boundPathId ?? null, next.confidence, next.updatedAt, id);
  return next;
}

export function deleteObjectType(id: string): boolean {
  return db.prepare("DELETE FROM object_types WHERE id = ?").run(id).changes > 0;
}

// ---- PropertyType ----
interface PropertyTypeRow {
  id: string; object_type_id: string; name: string; data_type: string;
  bound_column: string | null; semantic_type: string | null; description: string | null;
}
function parsePropertyType(r: PropertyTypeRow): PropertyType {
  return {
    id: r.id, objectTypeId: r.object_type_id, name: r.name,
    dataType: r.data_type as PropertyDataType, boundColumn: r.bound_column ?? undefined,
    semanticType: r.semantic_type ?? undefined, description: r.description ?? undefined,
  };
}

export function listProperties(objectTypeId: string): PropertyType[] {
  return (db.prepare("SELECT * FROM property_types WHERE object_type_id = ? ORDER BY name").all(objectTypeId) as unknown as PropertyTypeRow[]).map(parsePropertyType);
}

export interface PropertyTypeInput {
  name: string; dataType?: PropertyDataType; boundColumn?: string; semanticType?: string; description?: string;
}
export function createProperty(objectTypeId: string, input: PropertyTypeInput): PropertyType {
  const id = randomUUID();
  db.prepare(
    "INSERT INTO property_types (id, object_type_id, name, data_type, bound_column, semantic_type, description) VALUES (?, ?, ?, ?, ?, ?, ?)"
  ).run(id, objectTypeId, input.name, input.dataType ?? "unknown", input.boundColumn ?? null, input.semanticType ?? null, input.description ?? null);
  return { id, objectTypeId, name: input.name, dataType: input.dataType ?? "unknown", boundColumn: input.boundColumn, semanticType: input.semanticType, description: input.description };
}

export function updateProperty(id: string, patch: Partial<PropertyTypeInput>): PropertyType | undefined {
  const r = db.prepare("SELECT * FROM property_types WHERE id = ?").get(id) as unknown as PropertyTypeRow | undefined;
  if (!r) return undefined;
  const existing = parsePropertyType(r);
  const next: PropertyType = {
    ...existing,
    name: patch.name ?? existing.name,
    dataType: patch.dataType ?? existing.dataType,
    boundColumn: patch.boundColumn ?? existing.boundColumn,
    semanticType: patch.semanticType ?? existing.semanticType,
    description: patch.description ?? existing.description,
  };
  db.prepare(
    "UPDATE property_types SET name = ?, data_type = ?, bound_column = ?, semantic_type = ?, description = ? WHERE id = ?"
  ).run(next.name, next.dataType, next.boundColumn ?? null, next.semanticType ?? null, next.description ?? null, id);
  return next;
}

export function deleteProperty(id: string): boolean {
  return db.prepare("DELETE FROM property_types WHERE id = ?").run(id).changes > 0;
}

// ---- LinkType ----
interface LinkTypeRow {
  id: string; ontology_id: string; source_object_id: string; target_object_id: string;
  kind: string; join_keys: string | null; confidence: number; created_at: number;
}
function parseLinkType(r: LinkTypeRow): LinkType {
  let joinKeys: LinkType["joinKeys"];
  if (r.join_keys) {
    try { joinKeys = JSON.parse(r.join_keys); } catch { joinKeys = undefined; }
  }
  return {
    id: r.id, ontologyId: r.ontology_id, sourceObjectId: r.source_object_id,
    targetObjectId: r.target_object_id, kind: r.kind as LinkKind, joinKeys,
    confidence: r.confidence, createdAt: r.created_at,
  };
}

export function listLinks(ontologyId: string): LinkType[] {
  return (db.prepare("SELECT * FROM link_types WHERE ontology_id = ? ORDER BY created_at").all(ontologyId) as unknown as LinkTypeRow[]).map(parseLinkType);
}

export interface LinkTypeInput {
  sourceObjectId: string; targetObjectId: string; kind: LinkKind;
  joinKeys?: Array<{ source: string; target: string }>; confidence?: number;
}
export function createLink(ontologyId: string, input: LinkTypeInput): LinkType {
  const id = randomUUID();
  const now = Date.now();
  const joinKeysJson = input.joinKeys ? JSON.stringify(input.joinKeys) : null;
  db.prepare(
    "INSERT INTO link_types (id, ontology_id, source_object_id, target_object_id, kind, join_keys, confidence, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
  ).run(id, ontologyId, input.sourceObjectId, input.targetObjectId, input.kind, joinKeysJson, input.confidence ?? 1.0, now);
  return { id, ontologyId, sourceObjectId: input.sourceObjectId, targetObjectId: input.targetObjectId, kind: input.kind, joinKeys: input.joinKeys, confidence: input.confidence ?? 1.0, createdAt: now };
}

export function deleteLink(id: string): boolean {
  return db.prepare("DELETE FROM link_types WHERE id = ?").run(id).changes > 0;
}

// ---- MetricDefinition（metric 真源）----
interface MetricRow {
  id: string; workspace_id: string; name: string; category: string; description: string;
  formula: string; caliber: string; unit: string; object_type_id: string | null;
  bound_columns: string | null; display_name: string | null; aggregation: string | null;
  period_grain: string | null; filters: string | null; denominator: string | null; version: number | null;
  enabled: number; created_at: number; updated_at: number;
}
function parseMetric(r: MetricRow): MetricDefinition {
  let boundColumns: string[] | undefined;
  if (r.bound_columns) {
    try { boundColumns = JSON.parse(r.bound_columns); } catch { boundColumns = undefined; }
  }
  return {
    id: r.id, workspaceId: r.workspace_id, name: r.name, category: r.category,
    description: r.description, formula: r.formula, caliber: r.caliber, unit: r.unit,
    objectTypeId: r.object_type_id ?? undefined, boundColumns,
    displayName: r.display_name ?? undefined,
    aggregation: r.aggregation ?? undefined,
    periodGrain: r.period_grain ?? undefined,
    filters: r.filters ?? undefined,
    denominator: r.denominator ?? undefined,
    version: r.version ?? undefined,
    enabled: r.enabled === 1, createdAt: r.created_at, updatedAt: r.updated_at,
  };
}

// 全局池：返回所有工作区的指标定义。"本工作区是否启用" 见 enablement 表(kind='metric')。
export function listMetrics(_workspaceId?: string): MetricDefinition[] {
  return (db.prepare("SELECT * FROM metric_definitions ORDER BY category, name").all() as unknown as MetricRow[]).map(parseMetric);
}

export function getMetric(id: string): MetricDefinition | undefined {
  const r = db.prepare("SELECT * FROM metric_definitions WHERE id = ?").get(id) as unknown as MetricRow | undefined;
  return r ? parseMetric(r) : undefined;
}

export function createMetric(workspaceId: string, input: MetricDefinitionInput): MetricDefinition {
  const id = randomUUID();
  const now = Date.now();
  const boundJson = input.boundColumns ? JSON.stringify(input.boundColumns) : null;
  db.prepare(
    "INSERT INTO metric_definitions (id, workspace_id, name, category, description, formula, caliber, unit, object_type_id, bound_columns, display_name, aggregation, period_grain, filters, denominator, version, enabled, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)"
  ).run(
    id, workspaceId, input.name, input.category, input.description, input.formula, input.caliber, input.unit,
    input.objectTypeId ?? null, boundJson, input.displayName ?? null, input.aggregation ?? null,
    input.periodGrain ?? null, input.filters ?? null, input.denominator ?? null, input.version ?? null, now, now,
  );
  enableForOrigin(workspaceId, "metric", id); // 新池条目：origin 工作区默认启用
  return { id, workspaceId, ...input, enabled: true, createdAt: now, updatedAt: now };
}

export function updateMetric(id: string, patch: Partial<MetricDefinitionInput & { enabled: boolean }>): MetricDefinition | undefined {
  const existing = getMetric(id);
  if (!existing) return undefined;
  const next: MetricDefinition = {
    ...existing,
    name: patch.name ?? existing.name,
    category: patch.category ?? existing.category,
    description: patch.description ?? existing.description,
    formula: patch.formula ?? existing.formula,
    caliber: patch.caliber ?? existing.caliber,
    unit: patch.unit ?? existing.unit,
    objectTypeId: patch.objectTypeId ?? existing.objectTypeId,
    boundColumns: patch.boundColumns ?? existing.boundColumns,
    displayName: patch.displayName ?? existing.displayName,
    aggregation: patch.aggregation ?? existing.aggregation,
    periodGrain: patch.periodGrain ?? existing.periodGrain,
    filters: patch.filters ?? existing.filters,
    denominator: patch.denominator ?? existing.denominator,
    version: patch.version ?? existing.version,
    enabled: patch.enabled ?? existing.enabled,
    updatedAt: Date.now(),
  };
  db.prepare(
    "UPDATE metric_definitions SET name = ?, category = ?, description = ?, formula = ?, caliber = ?, unit = ?, object_type_id = ?, bound_columns = ?, display_name = ?, aggregation = ?, period_grain = ?, filters = ?, denominator = ?, version = ?, enabled = ?, updated_at = ? WHERE id = ?"
  ).run(
    next.name, next.category, next.description, next.formula, next.caliber, next.unit,
    next.objectTypeId ?? null, next.boundColumns ? JSON.stringify(next.boundColumns) : null,
    next.displayName ?? null, next.aggregation ?? null, next.periodGrain ?? null, next.filters ?? null,
    next.denominator ?? null, next.version ?? null, next.enabled ? 1 : 0, next.updatedAt, id,
  );
  return next;
}

export function deleteMetric(id: string): boolean {
  return db.prepare("DELETE FROM metric_definitions WHERE id = ?").run(id).changes > 0;
}

/**
 * metric 真源收敛（非破坏式）：把 analysis_standards(kind='metric') 拷入 metric_definitions。
 * 幂等：同 workspace 同 name 已存在则跳过。不删除/不改动 analysis_standards 原行。
 * 返回新增条数。
 */
export function backfillMetricsFromStandards(workspaceId: string): { migrated: number; skipped: number } {
  const rows = db.prepare(
    "SELECT name, category, description, formula, caliber, unit, enabled, created_at, updated_at FROM analysis_standards WHERE workspace_id = ? AND kind = 'metric'"
  ).all(workspaceId) as unknown as Array<{
    name: string; category: string; description: string; formula: string;
    caliber: string; unit: string; enabled: number; created_at: number; updated_at: number;
  }>;
  const existing = new Set(
    (db.prepare("SELECT name FROM metric_definitions WHERE workspace_id = ?").all(workspaceId) as unknown as Array<{ name: string }>).map((r) => r.name)
  );
  let migrated = 0, skipped = 0;
  for (const r of rows) {
    if (existing.has(r.name)) { skipped++; continue; }
    const mid = randomUUID();
    db.prepare(
      "INSERT INTO metric_definitions (id, workspace_id, name, category, description, formula, caliber, unit, object_type_id, bound_columns, enabled, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?, ?)"
    ).run(mid, workspaceId, r.name, r.category, r.description, r.formula, r.caliber, r.unit, r.enabled, r.created_at, r.updated_at);
    enableForOrigin(workspaceId, "metric", mid); // 新池条目：origin 工作区默认启用
    existing.add(r.name);
    migrated++;
  }
  return { migrated, skipped };
}

// ---- LogicRule（本体形式化规则层，P6）----
interface LogicRuleRow {
  id: string; ontology_id: string; name_cn: string; name_en: string | null;
  description: string; formula: string; linked_object_ids: string; confidence: number;
  created_at: number; updated_at: number;
}
function parseIdList(s: string | null): string[] {
  if (!s) return [];
  try { const v = JSON.parse(s); return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []; } catch { return []; }
}
function parseLogicRule(r: LogicRuleRow): LogicRule {
  return {
    id: r.id, ontologyId: r.ontology_id, nameCn: r.name_cn, nameEn: r.name_en ?? undefined,
    description: r.description, formula: r.formula, linkedObjectIds: parseIdList(r.linked_object_ids),
    confidence: r.confidence, createdAt: r.created_at, updatedAt: r.updated_at,
  };
}

export function listLogicRules(ontologyId: string): LogicRule[] {
  return (db.prepare("SELECT * FROM logic_rules WHERE ontology_id = ? ORDER BY created_at").all(ontologyId) as unknown as LogicRuleRow[]).map(parseLogicRule);
}

export function createLogicRule(ontologyId: string, input: LogicRuleInput): LogicRule {
  const id = randomUUID();
  const now = Date.now();
  const row: LogicRule = {
    id, ontologyId, nameCn: input.nameCn, nameEn: input.nameEn,
    description: input.description ?? "", formula: input.formula ?? "",
    linkedObjectIds: input.linkedObjectIds ?? [], confidence: input.confidence ?? 1.0,
    createdAt: now, updatedAt: now,
  };
  db.prepare(
    "INSERT INTO logic_rules (id, ontology_id, name_cn, name_en, description, formula, linked_object_ids, confidence, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
  ).run(id, ontologyId, row.nameCn, row.nameEn ?? null, row.description, row.formula, JSON.stringify(row.linkedObjectIds), row.confidence, now, now);
  return row;
}

export function updateLogicRule(id: string, patch: Partial<LogicRuleInput>): LogicRule | undefined {
  const r = db.prepare("SELECT * FROM logic_rules WHERE id = ?").get(id) as unknown as LogicRuleRow | undefined;
  if (!r) return undefined;
  const existing = parseLogicRule(r);
  const next: LogicRule = {
    ...existing,
    nameCn: patch.nameCn ?? existing.nameCn,
    nameEn: patch.nameEn ?? existing.nameEn,
    description: patch.description ?? existing.description,
    formula: patch.formula ?? existing.formula,
    linkedObjectIds: patch.linkedObjectIds ?? existing.linkedObjectIds,
    confidence: patch.confidence ?? existing.confidence,
    updatedAt: Date.now(),
  };
  db.prepare(
    "UPDATE logic_rules SET name_cn = ?, name_en = ?, description = ?, formula = ?, linked_object_ids = ?, confidence = ?, updated_at = ? WHERE id = ?"
  ).run(next.nameCn, next.nameEn ?? null, next.description, next.formula, JSON.stringify(next.linkedObjectIds), next.confidence, next.updatedAt, id);
  return next;
}

export function deleteLogicRule(id: string): boolean {
  return db.prepare("DELETE FROM logic_rules WHERE id = ?").run(id).changes > 0;
}

// ---- OntoAction（可执行动作层，P6）----
interface OntoActionRow {
  id: string; ontology_id: string; name_cn: string; name_en: string | null;
  description: string; execution_rule: string; function_code: string;
  linked_object_ids: string; linked_logic_ids: string; confidence: number;
  created_at: number; updated_at: number;
}
function parseOntoAction(r: OntoActionRow): OntoAction {
  return {
    id: r.id, ontologyId: r.ontology_id, nameCn: r.name_cn, nameEn: r.name_en ?? undefined,
    description: r.description, executionRule: r.execution_rule, functionCode: r.function_code,
    linkedObjectIds: parseIdList(r.linked_object_ids), linkedLogicIds: parseIdList(r.linked_logic_ids),
    confidence: r.confidence, createdAt: r.created_at, updatedAt: r.updated_at,
  };
}

export function listOntoActions(ontologyId: string): OntoAction[] {
  return (db.prepare("SELECT * FROM onto_actions WHERE ontology_id = ? ORDER BY created_at").all(ontologyId) as unknown as OntoActionRow[]).map(parseOntoAction);
}

export function createOntoAction(ontologyId: string, input: OntoActionInput): OntoAction {
  const id = randomUUID();
  const now = Date.now();
  const row: OntoAction = {
    id, ontologyId, nameCn: input.nameCn, nameEn: input.nameEn,
    description: input.description ?? "", executionRule: input.executionRule ?? "",
    functionCode: input.functionCode ?? "", linkedObjectIds: input.linkedObjectIds ?? [],
    linkedLogicIds: input.linkedLogicIds ?? [], confidence: input.confidence ?? 1.0,
    createdAt: now, updatedAt: now,
  };
  db.prepare(
    "INSERT INTO onto_actions (id, ontology_id, name_cn, name_en, description, execution_rule, function_code, linked_object_ids, linked_logic_ids, confidence, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
  ).run(id, ontologyId, row.nameCn, row.nameEn ?? null, row.description, row.executionRule, row.functionCode, JSON.stringify(row.linkedObjectIds), JSON.stringify(row.linkedLogicIds), row.confidence, now, now);
  return row;
}

export function updateOntoAction(id: string, patch: Partial<OntoActionInput>): OntoAction | undefined {
  const r = db.prepare("SELECT * FROM onto_actions WHERE id = ?").get(id) as unknown as OntoActionRow | undefined;
  if (!r) return undefined;
  const existing = parseOntoAction(r);
  const next: OntoAction = {
    ...existing,
    nameCn: patch.nameCn ?? existing.nameCn,
    nameEn: patch.nameEn ?? existing.nameEn,
    description: patch.description ?? existing.description,
    executionRule: patch.executionRule ?? existing.executionRule,
    functionCode: patch.functionCode ?? existing.functionCode,
    linkedObjectIds: patch.linkedObjectIds ?? existing.linkedObjectIds,
    linkedLogicIds: patch.linkedLogicIds ?? existing.linkedLogicIds,
    confidence: patch.confidence ?? existing.confidence,
    updatedAt: Date.now(),
  };
  db.prepare(
    "UPDATE onto_actions SET name_cn = ?, name_en = ?, description = ?, execution_rule = ?, function_code = ?, linked_object_ids = ?, linked_logic_ids = ?, confidence = ?, updated_at = ? WHERE id = ?"
  ).run(next.nameCn, next.nameEn ?? null, next.description, next.executionRule, next.functionCode, JSON.stringify(next.linkedObjectIds), JSON.stringify(next.linkedLogicIds), next.confidence, next.updatedAt, id);
  return next;
}

export function deleteOntoAction(id: string): boolean {
  return db.prepare("DELETE FROM onto_actions WHERE id = ?").run(id).changes > 0;
}

// ---- OntoPrompt（抽取 prompt 管理，P8）----
interface OntoPromptRow {
  id: string; workspace_id: string; name: string; content: string;
  version: string; created_at: number; updated_at: number;
}
function parseOntoPrompt(r: OntoPromptRow): OntoPrompt {
  return { id: r.id, workspaceId: r.workspace_id, name: r.name, content: r.content, version: r.version, createdAt: r.created_at, updatedAt: r.updated_at };
}

export function listOntoPrompts(workspaceId: string): OntoPrompt[] {
  return (db.prepare("SELECT * FROM onto_prompts WHERE workspace_id = ? ORDER BY updated_at DESC").all(workspaceId) as unknown as OntoPromptRow[]).map(parseOntoPrompt);
}

export function createOntoPrompt(workspaceId: string, input: OntoPromptInput): OntoPrompt {
  const id = randomUUID();
  const now = Date.now();
  const row: OntoPrompt = { id, workspaceId, name: input.name, content: input.content, version: input.version ?? "v1.0", createdAt: now, updatedAt: now };
  db.prepare(
    "INSERT INTO onto_prompts (id, workspace_id, name, content, version, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
  ).run(id, workspaceId, row.name, row.content, row.version, now, now);
  return row;
}

export function updateOntoPrompt(id: string, patch: Partial<OntoPromptInput>): OntoPrompt | undefined {
  const r = db.prepare("SELECT * FROM onto_prompts WHERE id = ?").get(id) as unknown as OntoPromptRow | undefined;
  if (!r) return undefined;
  const existing = parseOntoPrompt(r);
  const next: OntoPrompt = {
    ...existing,
    name: patch.name ?? existing.name,
    content: patch.content ?? existing.content,
    version: patch.version ?? existing.version,
    updatedAt: Date.now(),
  };
  db.prepare("UPDATE onto_prompts SET name = ?, content = ?, version = ?, updated_at = ? WHERE id = ?")
    .run(next.name, next.content, next.version, next.updatedAt, id);
  return next;
}

export function deleteOntoPrompt(id: string): boolean {
  return db.prepare("DELETE FROM onto_prompts WHERE id = ?").run(id).changes > 0;
}

// ============================================================================
// Actions（行动闭环）
// ============================================================================

interface ActionItemRow {
  id: string; source_kind: string; scope_id: string; run_id: string | null; report_path: string;
  title: string; rationale: string; scene: string; lifecycle: string; expected_impact: string;
  metric_ref: string | null; priority: string; effort: string; confidence: number;
  status: string; created_at: number; updated_at: number;
}

function parseActionItem(r: ActionItemRow): ActionItem {
  return {
    id: r.id, sourceKind: r.source_kind as "session" | "flow-run", scopeId: r.scope_id, runId: r.run_id ?? undefined,
    reportPath: r.report_path, title: r.title, rationale: r.rationale,
    scene: r.scene ? (r.scene as ActionScene) : undefined,
    lifecycle: r.lifecycle ? (r.lifecycle as ActionLifecycle) : undefined,
    expectedImpact: r.expected_impact, metricRef: r.metric_ref ?? undefined,
    priority: r.priority as ActionPriority, effort: r.effort as ActionEffort, confidence: r.confidence,
    status: r.status as ActionItemStatus,
    createdAt: r.created_at, updatedAt: r.updated_at,
  };
}

export function listActionItems(scopeId: string, reportPath?: string): ActionItem[] {
  if (reportPath) {
    return (db.prepare("SELECT * FROM action_items WHERE scope_id = ? AND report_path = ? ORDER BY created_at DESC").all(scopeId, reportPath) as unknown as ActionItemRow[]).map(parseActionItem);
  }
  return (db.prepare("SELECT * FROM action_items WHERE scope_id = ? ORDER BY created_at DESC").all(scopeId) as unknown as ActionItemRow[]).map(parseActionItem);
}

export function createActionItem(input: Omit<ActionItem, "id" | "createdAt" | "updatedAt">): ActionItem {
  const id = randomUUID();
  const now = Date.now();
  db.prepare(
    "INSERT INTO action_items (id, source_kind, scope_id, run_id, report_path, title, rationale, scene, lifecycle, expected_impact, metric_ref, priority, effort, confidence, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
  ).run(id, input.sourceKind, input.scopeId, input.runId ?? null, input.reportPath, input.title, input.rationale, input.scene ?? "", input.lifecycle ?? "", input.expectedImpact, input.metricRef ?? null, input.priority, input.effort, input.confidence, input.status, now, now);
  return { ...input, id, createdAt: now, updatedAt: now };
}

export function updateActionItem(id: string, patch: Partial<Omit<ActionItem, "id" | "createdAt" | "updatedAt">>): ActionItem | undefined {
  const r = db.prepare("SELECT * FROM action_items WHERE id = ?").get(id) as unknown as ActionItemRow | undefined;
  if (!r) return undefined;
  const existing = parseActionItem(r);
  const next = { ...existing, ...patch, updatedAt: Date.now() };
  db.prepare(
    "UPDATE action_items SET source_kind = ?, scope_id = ?, run_id = ?, report_path = ?, title = ?, rationale = ?, scene = ?, lifecycle = ?, expected_impact = ?, metric_ref = ?, priority = ?, effort = ?, confidence = ?, status = ?, updated_at = ? WHERE id = ?"
  ).run(next.sourceKind, next.scopeId, next.runId ?? null, next.reportPath, next.title, next.rationale, next.scene ?? "", next.lifecycle ?? "", next.expectedImpact, next.metricRef ?? null, next.priority, next.effort, next.confidence, next.status, next.updatedAt, id);
  return next;
}

export function deleteActionItem(id: string): boolean {
  return db.prepare("DELETE FROM action_items WHERE id = ?").run(id).changes > 0;
}

interface ActionTaskRow {
  id: string; action_item_id: string; title: string; owner: string; due_date: string | null;
  status: string; priority: string; note: string; created_at: number; updated_at: number;
}

function parseActionTask(r: ActionTaskRow): ActionTask {
  return {
    id: r.id, actionItemId: r.action_item_id, title: r.title, owner: r.owner,
    dueDate: r.due_date ?? undefined, status: r.status as ActionTaskStatus, priority: r.priority as ActionPriority,
    note: r.note, createdAt: r.created_at, updatedAt: r.updated_at,
  };
}

export function listActionTasks(actionItemId?: string, scopeId?: string): ActionTask[] {
  if (actionItemId) {
    return (db.prepare("SELECT * FROM action_tasks WHERE action_item_id = ? ORDER BY created_at DESC").all(actionItemId) as unknown as ActionTaskRow[]).map(parseActionTask);
  }
  if (scopeId) {
    return (db.prepare(`
      SELECT t.* FROM action_tasks t
      JOIN action_items i ON t.action_item_id = i.id
      WHERE i.scope_id = ? ORDER BY t.created_at DESC
    `).all(scopeId) as unknown as ActionTaskRow[]).map(parseActionTask);
  }
  return [];
}

export function createActionTask(input: Omit<ActionTask, "id" | "createdAt" | "updatedAt">): ActionTask {
  const id = randomUUID();
  const now = Date.now();
  db.prepare(
    "INSERT INTO action_tasks (id, action_item_id, title, owner, due_date, status, priority, note, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
  ).run(id, input.actionItemId, input.title, input.owner, input.dueDate ?? null, input.status, input.priority, input.note ?? "", now, now);
  return { ...input, id, createdAt: now, updatedAt: now };
}

export function updateActionTask(id: string, patch: Partial<Omit<ActionTask, "id" | "createdAt" | "updatedAt">>): ActionTask | undefined {
  const r = db.prepare("SELECT * FROM action_tasks WHERE id = ?").get(id) as unknown as ActionTaskRow | undefined;
  if (!r) return undefined;
  const existing = parseActionTask(r);
  const next = { ...existing, ...patch, updatedAt: Date.now() };
  db.prepare(
    "UPDATE action_tasks SET action_item_id = ?, title = ?, owner = ?, due_date = ?, status = ?, priority = ?, note = ?, updated_at = ? WHERE id = ?"
  ).run(next.actionItemId, next.title, next.owner, next.dueDate ?? null, next.status, next.priority, next.note, next.updatedAt, id);
  return next;
}

interface ActionFeedbackRow {
  id: string; task_id: string; adopted: number; outcome: string; metric_delta: string;
  review: string; score: number; created_at: number;
}

function parseActionFeedback(r: ActionFeedbackRow): ActionFeedback {
  return {
    id: r.id, taskId: r.task_id, adopted: r.adopted === 1, outcome: r.outcome,
    metricDelta: r.metric_delta, review: r.review, score: r.score, createdAt: r.created_at,
  };
}

export function createActionFeedback(input: Omit<ActionFeedback, "id" | "createdAt">): ActionFeedback {
  const id = randomUUID();
  const now = Date.now();
  db.prepare(
    "INSERT INTO action_feedback (id, task_id, adopted, outcome, metric_delta, review, score, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
  ).run(id, input.taskId, input.adopted ? 1 : 0, input.outcome, input.metricDelta, input.review, input.score ?? 0, now);
  return { ...input, id, createdAt: now };
}

export function getActionFeedback(taskId: string): ActionFeedback | undefined {
  const r = db.prepare("SELECT * FROM action_feedback WHERE task_id = ?").get(taskId) as unknown as ActionFeedbackRow | undefined;
  return r ? parseActionFeedback(r) : undefined;
}

// ---- ExtractJob（分批抽取进度，总控已审）----
interface ExtractJobRow {
  id: string; ontology_id: string; status: string;
  total_chunks: number; done_chunks: number;
  created_objects: number; created_links: number;
  created_logic_rules: number; created_actions: number;
  skipped_objects: number; skipped_links: number;
  has_fatal: number; issues_json: string; error: string | null;
  created_at: number; updated_at: number;
}

function parseExtractJob(r: ExtractJobRow): ExtractJob {
  let issues: ValidationIssue[] = [];
  try { issues = JSON.parse(r.issues_json); } catch { /* empty */ }
  return {
    id: r.id, ontologyId: r.ontology_id, status: r.status as ExtractJobStatus,
    totalChunks: r.total_chunks, doneChunks: r.done_chunks,
    createdObjects: r.created_objects, createdLinks: r.created_links,
    createdLogicRules: r.created_logic_rules, createdActions: r.created_actions,
    skippedObjects: r.skipped_objects, skippedLinks: r.skipped_links,
    hasFatal: r.has_fatal === 1, issues, error: r.error ?? undefined,
    createdAt: r.created_at, updatedAt: r.updated_at,
  };
}

export function createExtractJob(ontologyId: string): ExtractJob {
  const id = randomUUID();
  const now = Date.now();
  db.prepare(
    "INSERT INTO extract_jobs (id, ontology_id, status, total_chunks, done_chunks, created_objects, created_links, created_logic_rules, created_actions, skipped_objects, skipped_links, has_fatal, issues_json, error, created_at, updated_at) VALUES (?, ?, 'running', 0, 0, 0, 0, 0, 0, 0, 0, 0, '[]', NULL, ?, ?)"
  ).run(id, ontologyId, now, now);
  return {
    id, ontologyId, status: "running", totalChunks: 0, doneChunks: 0,
    createdObjects: 0, createdLinks: 0, createdLogicRules: 0, createdActions: 0,
    skippedObjects: 0, skippedLinks: 0, hasFatal: false, issues: [],
    createdAt: now, updatedAt: now,
  };
}

export function getExtractJob(id: string): ExtractJob | undefined {
  const r = db.prepare("SELECT * FROM extract_jobs WHERE id = ?").get(id) as unknown as ExtractJobRow | undefined;
  return r ? parseExtractJob(r) : undefined;
}

export function updateExtractJob(id: string, patch: Partial<Omit<ExtractJob, "id" | "ontologyId" | "createdAt">>): ExtractJob | undefined {
  const existing = getExtractJob(id);
  if (!existing) return undefined;
  const next: ExtractJob = { ...existing, ...patch, updatedAt: Date.now() };
  db.prepare(
    "UPDATE extract_jobs SET status = ?, total_chunks = ?, done_chunks = ?, created_objects = ?, created_links = ?, created_logic_rules = ?, created_actions = ?, skipped_objects = ?, skipped_links = ?, has_fatal = ?, issues_json = ?, error = ?, updated_at = ? WHERE id = ?"
  ).run(next.status, next.totalChunks, next.doneChunks, next.createdObjects, next.createdLinks, next.createdLogicRules, next.createdActions, next.skippedObjects, next.skippedLinks, next.hasFatal ? 1 : 0, JSON.stringify(next.issues), next.error ?? null, next.updatedAt, id);
  return next;
}

// ── 体检模块 health_runs / health_findings / ontology_gaps（V-HEALTH2）──

import type { HealthRun, HealthFinding, OntologyGap, FindingLifecycle, HealthSuite, HealthCategory, HealthFindingKind } from "../types.ts";

interface HealthRunRow {
  id: string;
  workspace_id: string;
  suite: string;
  dataset_path_ids: string;
  started_at: number;
  finished_at: number | null;
  problem_count: number;
  risk_count: number;
  status: string;
}

interface HealthFindingRow {
  id: string;
  run_id: string;
  rule_id: string;
  category: string;
  kind: string;
  severity: string;
  lifecycle: string;
  signature: string;
  first_seen_run_id: string | null;
  title: string;
  evidence_json: string;
  bound_to_json: string;
  suggestion: string;
  detected_at: number;
}

interface OntologyGapRow {
  run_id: string;
  dataset_path_id: string;
  column_name: string;
  reason: string;
  suggested_concept: string | null;
}

function parseHealthRun(r: HealthRunRow): HealthRun {
  return {
    id: r.id,
    workspaceId: r.workspace_id,
    suite: r.suite as HealthSuite,
    datasetPathIds: JSON.parse(r.dataset_path_ids) as string[],
    startedAt: r.started_at,
    finishedAt: r.finished_at,
    problemCount: r.problem_count,
    riskCount: r.risk_count,
    status: r.status as HealthRun["status"],
  };
}

function parseHealthFinding(r: HealthFindingRow): HealthFinding {
  return {
    id: r.id,
    runId: r.run_id,
    ruleId: r.rule_id,
    category: r.category as HealthCategory,
    kind: r.kind as HealthFindingKind,
    severity: r.severity as HealthFinding["severity"],
    lifecycle: r.lifecycle as FindingLifecycle,
    signature: r.signature,
    firstSeenRunId: r.first_seen_run_id,
    title: r.title,
    evidence: JSON.parse(r.evidence_json) as Record<string, unknown>,
    boundTo: r.bound_to_json && r.bound_to_json !== "{}" ? (JSON.parse(r.bound_to_json) as HealthFinding["boundTo"]) : undefined,
    suggestion: r.suggestion,
    detectedAt: r.detected_at,
  };
}

export function insertHealthRun(workspaceId: string, suite: HealthSuite, datasetPathIds: string[]): HealthRun {
  const id = randomUUID();
  const now = Date.now();
  db.prepare(
    "INSERT INTO health_runs (id, workspace_id, suite, dataset_path_ids, started_at, finished_at, problem_count, risk_count, status) VALUES (?, ?, ?, ?, ?, NULL, 0, 0, 'running')"
  ).run(id, workspaceId, suite, JSON.stringify(datasetPathIds), now);
  return { id, workspaceId, suite, datasetPathIds, startedAt: now, finishedAt: null, problemCount: 0, riskCount: 0, status: "running" };
}

export function updateHealthRun(id: string, patch: { finishedAt?: number; problemCount?: number; riskCount?: number; status?: HealthRun["status"] }): HealthRun | undefined {
  const existing = db.prepare("SELECT * FROM health_runs WHERE id = ?").get(id) as unknown as HealthRunRow | undefined;
  if (!existing) return undefined;
  const finishedAt = patch.finishedAt ?? existing.finished_at;
  const problemCount = patch.problemCount ?? existing.problem_count;
  const riskCount = patch.riskCount ?? existing.risk_count;
  const status = patch.status ?? existing.status;
  db.prepare(
    "UPDATE health_runs SET finished_at = ?, problem_count = ?, risk_count = ?, status = ? WHERE id = ?"
  ).run(finishedAt, problemCount, riskCount, status, id);
  return parseHealthRun({ ...existing, finished_at: finishedAt, problem_count: problemCount, risk_count: riskCount, status });
}

export function listHealthRuns(workspaceId: string): HealthRun[] {
  const rows = db.prepare("SELECT * FROM health_runs WHERE workspace_id = ? ORDER BY started_at DESC").all(workspaceId) as unknown as HealthRunRow[];
  return rows.map(parseHealthRun);
}

export function getHealthRun(id: string): HealthRun | undefined {
  const r = db.prepare("SELECT * FROM health_runs WHERE id = ?").get(id) as unknown as HealthRunRow | undefined;
  return r ? parseHealthRun(r) : undefined;
}

export function insertHealthFindings(findings: HealthFinding[]): void {
  const stmt = db.prepare(
    "INSERT INTO health_findings (id, run_id, rule_id, category, kind, severity, lifecycle, signature, first_seen_run_id, title, evidence_json, bound_to_json, suggestion, detected_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
  );
  for (const f of findings) {
    stmt.run(
      f.id, f.runId, f.ruleId, f.category, f.kind, f.severity, f.lifecycle, f.signature,
      f.firstSeenRunId, f.title, JSON.stringify(f.evidence), f.boundTo ? JSON.stringify(f.boundTo) : "{}",
      f.suggestion, f.detectedAt,
    );
  }
}

export function listHealthFindings(runId: string): HealthFinding[] {
  const rows = db.prepare("SELECT * FROM health_findings WHERE run_id = ? ORDER BY detected_at DESC").all(runId) as unknown as HealthFindingRow[];
  return rows.map(parseHealthFinding);
}

export function listFindingsByRun(
  workspaceId: string,
  suite?: HealthSuite,
  datasetPathIds?: string[],
): HealthFinding[] {
  // 取最近一次同 suite + 同数据集组合的 done run 的 findings 作为 priorFindings
  let sql = "SELECT id, suite, dataset_path_ids FROM health_runs WHERE workspace_id = ? AND status = 'done'";
  const params: (string | HealthSuite)[] = [workspaceId];
  if (suite) {
    sql += " AND suite = ?";
    params.push(suite);
  }
  sql += " ORDER BY started_at DESC LIMIT 20";
  const runs = db.prepare(sql).all(...params) as unknown as Array<{ id: string; suite: string; dataset_path_ids: string }>;
  if (runs.length === 0) return [];
  // 按 datasetPathIds 组合匹配（排序后 JSON 比对，顺序无关）
  const targetKey = datasetPathIds ? [...datasetPathIds].sort().join(",") : null;
  for (const r of runs) {
    if (!targetKey) {
      // 无 datasetPathIds 过滤 → 取第一条
      return listHealthFindings(r.id);
    }
    const runIds = JSON.parse(r.dataset_path_ids) as string[];
    const runKey = [...runIds].sort().join(",");
    if (runKey === targetKey) {
      return listHealthFindings(r.id);
    }
  }
  return [];
}

export function insertOntologyGaps(runId: string, gaps: OntologyGap[]): void {
  const stmt = db.prepare(
    "INSERT INTO ontology_gaps (run_id, dataset_path_id, column_name, reason, suggested_concept, created_at) VALUES (?, ?, ?, ?, ?, ?)"
  );
  const now = Date.now();
  for (const g of gaps) {
    stmt.run(runId, g.datasetPathId, g.column, g.reason, g.suggestedConcept ?? null, now);
  }
}

export function listOntologyGaps(runId: string): OntologyGap[] {
  const rows = db.prepare("SELECT * FROM ontology_gaps WHERE run_id = ?").all(runId) as unknown as OntologyGapRow[];
  return rows.map((r) => ({
    datasetPathId: r.dataset_path_id,
    column: r.column_name,
     reason: r.reason,
    suggestedConcept: r.suggested_concept ?? undefined,
  }));
}

// ── 监测配置 monitor_configs（D-MONITOR1）──
// 每 workspace 至多一条 config（workspace_id UNIQUE），PUT 时 upsert。

interface MonitorConfigRow {
  id: string;
  workspace_id: string;
  suite: string;
  dataset_bindings: string;
  ontology_id: string | null;
  metric_system_id: string | null;
  thresholds_json: string | null;
  created_at: number;
  updated_at: number;
}

function rowToMonitorConfig(r: MonitorConfigRow): MonitorConfig {
  let bindings: MonitorDatasetBinding[] = [];
  try {
    const parsed = JSON.parse(r.dataset_bindings) as unknown;
    if (Array.isArray(parsed)) bindings = parsed as MonitorDatasetBinding[];
  } catch {
    // ignore parse error → treat as empty
  }
  let thresholds: Record<string, number> | undefined;
  if (r.thresholds_json) {
    try {
      const parsed = JSON.parse(r.thresholds_json) as unknown;
      if (parsed && typeof parsed === "object") thresholds = parsed as Record<string, number>;
    } catch {
      // ignore
    }
  }
  return {
    id: r.id,
    workspaceId: r.workspace_id,
    suite: r.suite as HealthSuite,
    datasetBindings: bindings,
    ontologyId: r.ontology_id ?? undefined,
    metricSystemId: r.metric_system_id ?? undefined,
    thresholds,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export function getMonitorConfig(workspaceId: string): MonitorConfig | null {
  const r = db
    .prepare("SELECT * FROM monitor_configs WHERE workspace_id = ?")
    .get(workspaceId) as MonitorConfigRow | undefined;
  return r ? rowToMonitorConfig(r) : null;
}

export interface MonitorConfigInput {
  suite: HealthSuite;
  datasetBindings: MonitorDatasetBinding[];
  ontologyId?: string;
  metricSystemId?: string;
  thresholds?: Record<string, number>;
}

export function upsertMonitorConfig(workspaceId: string, input: MonitorConfigInput): MonitorConfig {
  const now = Date.now();
  const existing = db
    .prepare("SELECT id, created_at FROM monitor_configs WHERE workspace_id = ?")
    .get(workspaceId) as { id: string; created_at: number } | undefined;
  const bindingsJson = JSON.stringify(input.datasetBindings ?? []);
  const thresholdsJson = input.thresholds ? JSON.stringify(input.thresholds) : null;
  if (existing) {
    db.prepare(
      "UPDATE monitor_configs SET suite = ?, dataset_bindings = ?, ontology_id = ?, metric_system_id = ?, thresholds_json = ?, updated_at = ? WHERE id = ?",
    ).run(
      input.suite,
      bindingsJson,
      input.ontologyId ?? null,
      input.metricSystemId ?? null,
      thresholdsJson,
      now,
      existing.id,
    );
    return getMonitorConfig(workspaceId)!;
  }
  const id = randomUUID();
  db.prepare(
    "INSERT INTO monitor_configs (id, workspace_id, suite, dataset_bindings, ontology_id, metric_system_id, thresholds_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
  ).run(
    id,
    workspaceId,
    input.suite,
    bindingsJson,
    input.ontologyId ?? null,
    input.metricSystemId ?? null,
    thresholdsJson,
    now,
    now,
  );
  return getMonitorConfig(workspaceId)!;
}

// ── 目标测算 target_plans（D-MONITOR-TARGET3）──

function initTargetPlanTables(): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS target_plans (
      id                   TEXT PRIMARY KEY,
      workspace_id         TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      name                 TEXT NOT NULL,
      input_json           TEXT NOT NULL,
      result_json          TEXT NOT NULL,
      status               TEXT NOT NULL DEFAULT 'draft',
      goal_dataset_path_id TEXT,
      created_at           INTEGER NOT NULL,
      updated_at           INTEGER NOT NULL,
      adopted_at           INTEGER
    );
  `);
  try {
    db.exec(`CREATE INDEX IF NOT EXISTS idx_target_plans_ws ON target_plans(workspace_id);`);
  } catch {
    // ignore
  }
}

interface TargetPlanRow {
  id: string;
  workspace_id: string;
  name: string;
  input_json: string;
  result_json: string;
  status: string;
  goal_dataset_path_id: string | null;
  created_at: number;
  updated_at: number;
  adopted_at: number | null;
}

function rowToTargetPlan(r: TargetPlanRow): TargetPlan {
  let input: TargetCalculationInput;
  let result: TargetCalculationResult;
  try { input = JSON.parse(r.input_json) as TargetCalculationInput; } catch { input = {} as TargetCalculationInput; }
  try { result = JSON.parse(r.result_json) as TargetCalculationResult; } catch { result = { cases: [], breakdown: [] }; }
  return {
    id: r.id,
    workspaceId: r.workspace_id,
    name: r.name,
    input,
    result,
    status: r.status as TargetPlanStatus,
    goalDatasetPathId: r.goal_dataset_path_id ?? undefined,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    adoptedAt: r.adopted_at ?? undefined,
  };
}

export function createTargetPlan(
  workspaceId: string,
  name: string,
  input: TargetCalculationInput,
  result: TargetCalculationResult,
): TargetPlan {
  const now = Date.now();
  const id = randomUUID();
  db.prepare(
    "INSERT INTO target_plans (id, workspace_id, name, input_json, result_json, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 'draft', ?, ?)",
  ).run(id, workspaceId, name, JSON.stringify(input), JSON.stringify(result), now, now);
  return getTargetPlan(id)!;
}

export function listTargetPlans(workspaceId: string): TargetPlan[] {
  const rows = db
    .prepare("SELECT * FROM target_plans WHERE workspace_id = ? ORDER BY created_at DESC")
    .all(workspaceId) as unknown as TargetPlanRow[];
  return rows.map(rowToTargetPlan);
}

export function getTargetPlan(planId: string): TargetPlan | null {
  const r = db
    .prepare("SELECT * FROM target_plans WHERE id = ?")
    .get(planId) as TargetPlanRow | undefined;
  return r ? rowToTargetPlan(r) : null;
}

export function adoptTargetPlan(planId: string, goalDatasetPathId: string): TargetPlan {
  const now = Date.now();
  db.prepare(
    "UPDATE target_plans SET status = 'adopted', goal_dataset_path_id = ?, adopted_at = ?, updated_at = ? WHERE id = ?",
  ).run(goalDatasetPathId, now, now, planId);
  return getTargetPlan(planId)!;
}
