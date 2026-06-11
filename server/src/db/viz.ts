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
} from "../types.ts";

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
  try {
    db.exec(`CREATE INDEX IF NOT EXISTS idx_ontologies_ws ON ontologies(workspace_id);`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_object_types_onto ON object_types(ontology_id);`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_property_types_obj ON property_types(object_type_id);`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_link_types_onto ON link_types(ontology_id);`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_metric_defs_ws ON metric_definitions(workspace_id);`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_logic_rules_onto ON logic_rules(ontology_id);`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_onto_actions_onto ON onto_actions(ontology_id);`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_onto_prompts_ws ON onto_prompts(workspace_id);`);
  } catch {
    // ignore
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
  bound_columns: string | null; enabled: number; created_at: number; updated_at: number;
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
    "INSERT INTO metric_definitions (id, workspace_id, name, category, description, formula, caliber, unit, object_type_id, bound_columns, enabled, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)"
  ).run(id, workspaceId, input.name, input.category, input.description, input.formula, input.caliber, input.unit, input.objectTypeId ?? null, boundJson, now, now);
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
    enabled: patch.enabled ?? existing.enabled,
    updatedAt: Date.now(),
  };
  db.prepare(
    "UPDATE metric_definitions SET name = ?, category = ?, description = ?, formula = ?, caliber = ?, unit = ?, object_type_id = ?, bound_columns = ?, enabled = ?, updated_at = ? WHERE id = ?"
  ).run(next.name, next.category, next.description, next.formula, next.caliber, next.unit, next.objectTypeId ?? null, next.boundColumns ? JSON.stringify(next.boundColumns) : null, next.enabled ? 1 : 0, next.updatedAt, id);
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
