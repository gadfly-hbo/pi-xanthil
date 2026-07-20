/**
 * Donor-to-target schema plan for the one-time WorkCanger importer.
 *
 * Contract (T0014 brief, schema-v1-and-migrations.md, migrations 0001-0003):
 * - Source schema = target migrations 0001 + 0002 (byte-identical to donor
 *   commit e2807d5). Target schema = 0001 + 0002 + 0003 (workspace_id).
 * - Expected table/column shapes are DERIVED by applying the target repo's
 *   own migration SQL to an in-memory database, never hardcoded, so this
 *   plan cannot drift from the authoritative migration files.
 * - Enum domains are the fixed contract taxonomies (schema CHECK clauses and
 *   contracts/registries.ts); unknown values fail closed.
 * - Insert order respects non-deferrable FK dependencies; cyclic references
 *   in the schema are DEFERRABLE INITIALLY DEFERRED and resolve at commit.
 */
import { DatabaseSync } from "node:sqlite";
import {
  ACTOR_KINDS,
  ANALYSIS_STAGES,
  COMMAND_TYPES,
  EXECUTION_STATUSES,
  PROJECT_KINDS,
  PROJECT_STATUSES,
  RESULT_RESOURCE_TYPES,
  RUN_EVENT_TYPES,
  RUN_STATUSES,
  SUBMITTED_VIA,
} from "../contracts/registries.ts";
import type { MigrationFile } from "../persistence/migration-runner.ts";

// ---------------------------------------------------------------------------
// Table specifications
// ---------------------------------------------------------------------------

export interface UniqueKeySpec {
  readonly columns: readonly string[];
  /** When true, rows with any NULL in these columns cannot conflict (SQL UNIQUE semantics). */
  readonly nullSkip?: boolean;
  /** Collation for single-column text lookups (e.g. "NOCASE" for slug). */
  readonly collation?: string;
}

export interface OrdinalGroupSpec {
  /** Column grouping the ordinal sequence (e.g. analysis_project_id). */
  readonly groupColumn: string;
  /** Ordinal column that must be contiguous from 1 within each group. */
  readonly ordinalColumn: string;
  /**
   * For version chains: nullable self-FK column that must point to the row
   * with ordinal-1 in the same group (NULL required at ordinal 1).
   */
  readonly supersedesColumn?: string;
  /** Identity column used to resolve the supersedes pointer. */
  readonly identityColumn?: string;
}

export interface StorageRefSpec {
  readonly refColumn: string;
  readonly hashColumn: string;
  /** Evidence rows additionally carry a declared byte size. */
  readonly sizeColumn?: string;
}

export interface TableSpec {
  readonly table: string;
  /** Primary key columns (durable identity). */
  readonly identity: readonly string[];
  /** Enum domains per column (contract taxonomies; NULL values are skipped). */
  readonly enumColumns: Readonly<Record<string, readonly string[]>>;
  /** Natural unique keys to scan for cross-row conflicts in the target. */
  readonly uniqueKeys: readonly UniqueKeySpec[];
  /** Content-addressed blob reference carried by this table, if any. */
  readonly storageRef?: StorageRefSpec;
  /** Ordinal continuity rule, if any. */
  readonly ordinal?: OrdinalGroupSpec;
}

const ANALYSIS_STAGES_DOMAIN: readonly string[] = ANALYSIS_STAGES;
const RUN_STATUSES_DOMAIN: readonly string[] = RUN_STATUSES;
const SUBMITTED_VIA_DOMAIN: readonly string[] = SUBMITTED_VIA;

/**
 * All importable donor tables in FK-safe insert order.
 * schema_migrations is deliberately excluded (migration provenance, not data).
 */
export const TABLE_SPECS: readonly TableSpec[] = [
  {
    table: "audit_actors",
    identity: ["audit_actor_id"],
    enumColumns: { actor_kind: ACTOR_KINDS },
    uniqueKeys: [
      { columns: ["actor_kind", "actor_key"] },
      { columns: ["external_auth_provider", "external_subject_id"], nullSkip: true },
    ],
  },
  {
    table: "analysis_projects",
    identity: ["analysis_project_id"],
    enumColumns: {
      project_kind: PROJECT_KINDS,
      project_status: PROJECT_STATUSES,
      source_relation_type: ["derived_from", "reopened_from"],
    },
    uniqueKeys: [{ columns: ["slug"], collation: "NOCASE" }],
  },
  {
    table: "analysis_requests",
    identity: ["analysis_request_id"],
    enumColumns: { submitted_via: SUBMITTED_VIA_DOMAIN },
    uniqueKeys: [{ columns: ["analysis_project_id"] }],
  },
  {
    table: "structured_requirement_versions",
    identity: ["structured_requirement_version_id"],
    enumColumns: {},
    uniqueKeys: [{ columns: ["analysis_project_id", "version_ordinal"] }],
    storageRef: { refColumn: "storage_ref", hashColumn: "content_sha256" },
    ordinal: {
      groupColumn: "analysis_project_id",
      ordinalColumn: "version_ordinal",
      supersedesColumn: "supersedes_version_id",
      identityColumn: "structured_requirement_version_id",
    },
  },
  {
    table: "analysis_plan_versions",
    identity: ["analysis_plan_version_id"],
    enumColumns: {},
    uniqueKeys: [{ columns: ["analysis_project_id", "version_ordinal"] }],
    storageRef: { refColumn: "storage_ref", hashColumn: "content_sha256" },
    ordinal: {
      groupColumn: "analysis_project_id",
      ordinalColumn: "version_ordinal",
      supersedesColumn: "supersedes_version_id",
      identityColumn: "analysis_plan_version_id",
    },
  },
  {
    table: "source_references",
    identity: ["source_reference_id"],
    enumColumns: {
      source_kind: ["user_provided", "agentharness"],
      safety_handling_policy: [
        "local_transform_required",
        "controlled_or_derived_allowed",
        "derived_only_allowed",
      ],
    },
    uniqueKeys: [
      {
        columns: ["analysis_project_id", "capability_id", "contract_version", "source_object_key"],
        nullSkip: true,
      },
    ],
  },
  {
    table: "source_checks",
    identity: ["source_check_id"],
    enumColumns: {
      availability_status: [
        "available",
        "temporarily_unavailable",
        "access_denied",
        "contract_mismatch",
        "source_not_found",
        "unsafe",
        "check_failed",
      ],
    },
    uniqueKeys: [],
  },
  {
    table: "analysis_runs",
    identity: ["analysis_run_id"],
    enumColumns: {
      run_relation_type: ["retry_of", "report_revision_of"],
      current_analysis_stage: ANALYSIS_STAGES_DOMAIN,
      current_run_status: RUN_STATUSES_DOMAIN,
    },
    uniqueKeys: [{ columns: ["analysis_project_id", "run_ordinal"] }],
    ordinal: { groupColumn: "analysis_project_id", ordinalColumn: "run_ordinal" },
  },
  {
    table: "evidence_artifacts",
    identity: ["evidence_artifact_id"],
    enumColumns: {
      origin_kind: ["user_provided", "analysis_run", "agentharness", "system_generated"],
      artifact_kind: [
        "input_material",
        "safe_preview",
        "query",
        "notebook",
        "aggregate_result",
        "chart",
        "diagnostic",
        "intermediate_result",
        "analysis_result",
      ],
      safety_class: ["restricted_raw", "controlled", "derived"],
      visibility: ["user_visible", "review_only", "system_only"],
    },
    uniqueKeys: [],
    storageRef: {
      refColumn: "storage_ref",
      hashColumn: "content_sha256",
      sizeColumn: "byte_size",
    },
  },
  {
    table: "analysis_run_input_evidence",
    identity: ["analysis_run_id", "evidence_artifact_id"],
    enumColumns: { input_role: ["plan_input", "source_snapshot", "carried_forward"] },
    uniqueKeys: [{ columns: ["analysis_run_id", "input_ordinal"] }],
    ordinal: { groupColumn: "analysis_run_id", ordinalColumn: "input_ordinal" },
  },
  {
    table: "run_events",
    identity: ["run_event_id"],
    enumColumns: {
      event_type: RUN_EVENT_TYPES,
      analysis_stage_after: ANALYSIS_STAGES_DOMAIN,
      run_status_after: RUN_STATUSES_DOMAIN,
    },
    uniqueKeys: [
      { columns: ["analysis_run_id", "sequence"] },
      { columns: ["analysis_run_id", "producer_name", "producer_event_id"], nullSkip: true },
    ],
    ordinal: { groupColumn: "analysis_run_id", ordinalColumn: "sequence" },
  },
  {
    table: "report_versions",
    identity: ["report_version_id"],
    enumColumns: {},
    uniqueKeys: [{ columns: ["analysis_project_id", "version_ordinal"] }],
    storageRef: { refColumn: "storage_ref", hashColumn: "content_sha256" },
    ordinal: {
      groupColumn: "analysis_project_id",
      ordinalColumn: "version_ordinal",
      supersedesColumn: "supersedes_version_id",
      identityColumn: "report_version_id",
    },
  },
  {
    table: "report_version_evidence",
    identity: ["report_version_id", "evidence_artifact_id"],
    enumColumns: {},
    uniqueKeys: [{ columns: ["report_version_id", "evidence_ordinal"] }],
    ordinal: { groupColumn: "report_version_id", ordinalColumn: "evidence_ordinal" },
  },
  {
    table: "gate_decisions",
    identity: ["gate_decision_id"],
    enumColumns: {
      gate_type: ["requirement_confirmation", "plan_confirmation", "report_review"],
      target_object_type: [
        "structured_requirement_version",
        "analysis_plan_version",
        "report_version",
      ],
      decision: ["approved", "changes_requested", "rejected"],
      submitted_via: SUBMITTED_VIA_DOMAIN,
    },
    uniqueKeys: [{ columns: ["gate_type", "target_object_type", "target_object_id"] }],
  },
  {
    table: "api_idempotency_records",
    identity: ["idempotency_record_id"],
    enumColumns: {
      command_type: COMMAND_TYPES,
      execution_status: EXECUTION_STATUSES,
      result_resource_type: RESULT_RESOURCE_TYPES,
    },
    uniqueKeys: [{ columns: ["audit_actor_id", "command_type", "idempotency_key"] }],
  },
];

export const TABLE_SPEC_BY_NAME: ReadonlyMap<string, TableSpec> = new Map(
  TABLE_SPECS.map((spec) => [spec.table, spec]),
);

/** Column added by target migration 0003 (WCA-02), absent from the source. */
export const WORKSPACE_ID_COLUMN = "workspace_id";
export const WORKSPACE_TARGET_TABLE = "analysis_projects";

/** Safety classes that must be preserved verbatim per WCA-03. */
export const SAFETY_CLASSES = ["restricted_raw", "controlled", "derived"] as const;

// ---------------------------------------------------------------------------
// Expected schema derivation
// ---------------------------------------------------------------------------

export interface ColumnShape {
  readonly name: string;
  readonly type: string;
  readonly notNull: boolean;
  readonly pk: boolean;
}

export interface ExpectedSchema {
  /** Table name -> ordered column shapes, derived from migration SQL. */
  readonly tables: ReadonlyMap<string, readonly ColumnShape[]>;
}

/**
 * Build the expected schema by executing the given migration SQL files
 * against an in-memory database. Source expectation = migrations 0001+0002;
 * target expectation = 0001+0002+0003. No hardcoded column lists.
 */
export function buildExpectedSchema(migrations: readonly MigrationFile[]): ExpectedSchema {
  const db = new DatabaseSync(":memory:");
  try {
    const sorted = [...migrations].sort((a, b) => a.version - b.version);
    for (const migration of sorted) {
      db.exec(migration.sql);
    }
    const tableRows = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
      )
      .all() as Array<{ name: string }>;
    const tables = new Map<string, readonly ColumnShape[]>();
    for (const { name } of tableRows) {
      const info = db.prepare(`PRAGMA table_info(${name})`).all() as Array<{
        name: string;
        type: string;
        notnull: number;
        pk: number;
      }>;
      tables.set(
        name,
        info.map((col) => ({
          name: col.name,
          type: col.type.toUpperCase(),
          notNull: col.notnull === 1,
          pk: col.pk > 0,
        })),
      );
    }
    return { tables };
  } finally {
    db.close();
  }
}

/** Compare two column-shape sets exactly (order-insensitive). */
export function sameColumnSet(a: readonly ColumnShape[], b: readonly ColumnShape[]): boolean {
  if (a.length !== b.length) return false;
  const key = (c: ColumnShape) => `${c.name}|${c.type}|${c.notNull ? 1 : 0}|${c.pk ? 1 : 0}`;
  const set = new Set(a.map(key));
  return b.every((col) => set.has(key(col)));
}
