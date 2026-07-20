/**
 * Test helpers for importer tests: synthetic donor fixtures, target roots,
 * tree snapshots, and fakes. All data is synthetic and lives in temp dirs.
 * Contract (T0014 brief requirement 12): tests never touch ~/.workcanger,
 * real WORKCANGER_DATA_DIR, draw_data, clean_data, exploration data, or any
 * user Evidence content.
 */
import { mkdtempSync, rmSync, readdirSync, statSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { initDataRoot, type DataRootLayout } from "../persistence/data-root.ts";
import { openDatabase } from "../persistence/db.ts";
import { loadMigrations, runMigrations } from "../persistence/migration-runner.ts";
import { writeBlob } from "../persistence/blob-writer.ts";
import { canonicalJsonSerialize } from "../persistence/canonical-json.ts";
import { sha256Hex, sha256HexBytes } from "../persistence/sha256.ts";
import type { WorkspaceExistencePort } from "../contracts/workspace-port.ts";

export const MIGRATIONS_DIR = join(import.meta.dirname, "..", "persistence", "migrations");

/** Deterministic lowercase UUID v4 for fixtures (n encoded in last segment). */
export function uid(n: number): string {
  return `aaaaaaaa-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;
}

export const WORKSPACE_ID = "ws-workcanger-migration-test";

export const MARKERS = {
  restrictedRaw: "RESTRICTED-RAW-EVIDENCE-MARKER-9f3b7c",
  controlled: "CONTROLLED-EVIDENCE-MARKER-2a8d1e",
  derived: "DERIVED-EVIDENCE-MARKER-5c6f09",
} as const;

export interface DonorIds {
  sys: string;
  human: string;
  p1: string;
  p2: string;
  req1: string;
  req2: string;
  rv1: string;
  rv2: string;
  pl1: string;
  sr1: string;
  sc1: string;
  run1: string;
  run2: string;
  e0: string;
  e1: string;
  e2: string;
  e3: string;
  rp1: string;
  g1: string;
  g2: string;
  g3: string;
  i1: string;
  i2: string;
}

export interface DonorFixture {
  readonly root: string;
  readonly layout: DataRootLayout;
  readonly ids: DonorIds;
  readonly blobHashes: readonly string[];
  readonly blobRefs: readonly string[];
  readonly cleanup: () => void;
}

export interface TargetRoot {
  readonly root: string;
  readonly layout: DataRootLayout;
  readonly cleanup: () => void;
}

export function fakeWorkspacePort(exists: boolean): WorkspaceExistencePort {
  return { workspaceExists: () => exists };
}

/** Snapshot a directory tree: relative path -> { size, sha256 }. */
export function snapshotTree(root: string): Map<string, { size: number; sha256: string }> {
  const snapshot = new Map<string, { size: number; sha256: string }>();
  const walk = (dir: string, prefix: string) => {
    if (!existsSync(dir)) return;
    for (const entry of readdirSync(dir).sort()) {
      const full = join(dir, entry);
      const rel = prefix ? `${prefix}/${entry}` : entry;
      const stat = statSync(full);
      if (stat.isDirectory()) {
        walk(full, rel);
      } else {
        snapshot.set(rel, { size: stat.size, sha256: sha256HexBytes(new Uint8Array(readFileSync(full))) });
      }
    }
  };
  walk(root, "");
  return snapshot;
}

const T0 = "2026-01-01T00:00:00.000Z";
const T1 = "2026-01-02T00:00:00.000Z";
const T2 = "2026-01-03T00:00:00.000Z";
const T3 = "2026-01-04T00:00:00.000Z";
const T4 = "2026-01-05T00:00:00.000Z";

function versionBlob(layout: DataRootLayout, value: unknown): { ref: string; sha: string; size: number } {
  const bytes = canonicalJsonSerialize(value);
  const result = writeBlob(layout.blobsDir, layout.tmpDir, bytes);
  return { ref: result.storageRef, sha: result.contentSha256, size: result.byteSize };
}

function rawBlob(layout: DataRootLayout, content: string): { ref: string; sha: string; size: number } {
  const bytes = new TextEncoder().encode(content);
  const result = writeBlob(layout.blobsDir, layout.tmpDir, bytes);
  return { ref: result.storageRef, sha: result.contentSha256, size: result.byteSize };
}

/**
 * Build a coherent synthetic donor data root: migrations 0001+0002 (donor
 * application_version "0.0.0"), two projects (P1 full chain, P2 minimal),
 * actors, runs, events, evidence across all three safety classes, gates,
 * and idempotency records. All blobs written to the donor blob store.
 */
export async function createDonorFixture(): Promise<DonorFixture> {
  const root = mkdtempSync(join(tmpdir(), "xanthil-import-src-"));
  const layout = initDataRoot(root);
  const db = openDatabase(layout.sqlitePath);
  const migrations = loadMigrations(MIGRATIONS_DIR).filter((m) => m.version <= 2);
  await runMigrations(db, migrations, layout, "0.0.0");

  const ids: DonorIds = {
    sys: uid(1), human: uid(2),
    p1: uid(10), p2: uid(11),
    req1: uid(20), req2: uid(21),
    rv1: uid(30), rv2: uid(31), pl1: uid(40),
    sr1: uid(50), sc1: uid(51),
    run1: uid(60), run2: uid(61),
    e0: uid(70), e1: uid(71), e2: uid(72), e3: uid(73),
    rp1: uid(80),
    g1: uid(90), g2: uid(91), g3: uid(92),
    i1: uid(100), i2: uid(101),
  };

  const rv1Blob = versionBlob(layout, { schemaVersion: "1.0", requirement: "v1" });
  const rv2Blob = versionBlob(layout, { schemaVersion: "1.0", requirement: "v2" });
  const pl1Blob = versionBlob(layout, { schemaVersion: "1.0", plan: "p1" });
  const rp1Blob = versionBlob(layout, { schemaVersion: "1.0", report: "r1" });
  const e0Blob = rawBlob(layout, MARKERS.controlled);
  const e1Blob = rawBlob(layout, MARKERS.derived);
  const e2Blob = rawBlob(layout, MARKERS.restrictedRaw);
  const e3Blob = rawBlob(layout, "diagnostic-bytes");

  const blobHashes = [rv1Blob, rv2Blob, pl1Blob, rp1Blob, e0Blob, e1Blob, e2Blob, e3Blob].map((b) => b.sha);
  const blobRefs = [rv1Blob, rv2Blob, pl1Blob, rp1Blob, e0Blob, e1Blob, e2Blob, e3Blob].map((b) => b.ref);

  db.exec("BEGIN");
  try {
    db.prepare(
      `INSERT INTO audit_actors (audit_actor_id, actor_kind, actor_key, display_name, created_at, registered_by_actor_id, disabled_at, external_auth_provider, external_subject_id)
       VALUES (?, ?, ?, ?, ?, ?, NULL, NULL, NULL)`,
    ).run(ids.sys, "system", "bootstrap-system", "System", T0, null);
    db.prepare(
      `INSERT INTO audit_actors (audit_actor_id, actor_kind, actor_key, display_name, created_at, registered_by_actor_id, disabled_at, external_auth_provider, external_subject_id)
       VALUES (?, ?, ?, ?, ?, ?, NULL, NULL, NULL)`,
    ).run(ids.human, "human", "donor-local-human", "Donor Human", T0, ids.sys);

    db.prepare(
      `INSERT INTO analysis_projects (analysis_project_id, project_kind, title, slug, project_status, current_requirement_version_id, current_plan_version_id, source_project_id, source_relation_type, created_at, created_by_actor_id, updated_at, completed_at, rejected_at, cancelled_at, archived_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?, ?, NULL, NULL, NULL, NULL)`,
    ).run(ids.p1, "daily_analysis", "Donor Project One", "donor-project-one", "active", ids.rv2, ids.pl1, T0, ids.human, T1);
    db.prepare(
      `INSERT INTO analysis_projects (analysis_project_id, project_kind, title, slug, project_status, current_requirement_version_id, current_plan_version_id, source_project_id, source_relation_type, created_at, created_by_actor_id, updated_at, completed_at, rejected_at, cancelled_at, archived_at)
       VALUES (?, ?, ?, ?, ?, NULL, NULL, NULL, NULL, ?, ?, ?, ?, NULL, NULL, NULL)`,
    ).run(ids.p2, "topic_research", "Donor Project Two", "donor-project-two", "completed", T0, ids.human, T2, T2);

    db.prepare(
      `INSERT INTO analysis_requests (analysis_request_id, analysis_project_id, raw_request_text, submitted_context_evidence_ids_json, submitted_at, submitted_by_actor_id, submitted_via, client_version, locale, timezone)
       VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)`,
    ).run(ids.req1, ids.p1, "Analyze donor sales", JSON.stringify([ids.e0]), T0, ids.human, "web_ui", "zh-CN", "Asia/Shanghai");
    db.prepare(
      `INSERT INTO analysis_requests (analysis_request_id, analysis_project_id, raw_request_text, submitted_context_evidence_ids_json, submitted_at, submitted_by_actor_id, submitted_via, client_version, locale, timezone)
       VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)`,
    ).run(ids.req2, ids.p2, "Research donor topic", "[]", T0, ids.human, "local_api", "en-US", "UTC");

    db.prepare(
      `INSERT INTO structured_requirement_versions (structured_requirement_version_id, analysis_project_id, analysis_request_id, version_ordinal, supersedes_version_id, schema_version, content_sha256, storage_ref, created_at, created_by_actor_id)
       VALUES (?, ?, ?, ?, ?, '1.0', ?, ?, ?, ?)`,
    ).run(ids.rv1, ids.p1, ids.req1, 1, null, rv1Blob.sha, rv1Blob.ref, T1, ids.human);
    db.prepare(
      `INSERT INTO structured_requirement_versions (structured_requirement_version_id, analysis_project_id, analysis_request_id, version_ordinal, supersedes_version_id, schema_version, content_sha256, storage_ref, created_at, created_by_actor_id)
       VALUES (?, ?, ?, ?, ?, '1.0', ?, ?, ?, ?)`,
    ).run(ids.rv2, ids.p1, ids.req1, 2, ids.rv1, rv2Blob.sha, rv2Blob.ref, T2, ids.human);

    db.prepare(
      `INSERT INTO analysis_plan_versions (analysis_plan_version_id, analysis_project_id, structured_requirement_version_id, version_ordinal, supersedes_version_id, schema_version, content_sha256, storage_ref, created_at, created_by_actor_id)
       VALUES (?, ?, ?, ?, NULL, '1.0', ?, ?, ?, ?)`,
    ).run(ids.pl1, ids.p1, ids.rv2, 1, pl1Blob.sha, pl1Blob.ref, T2, ids.human);

    db.prepare(
      `INSERT INTO evidence_artifacts (evidence_artifact_id, analysis_project_id, analysis_run_id, source_reference_id, source_check_id, origin_kind, artifact_kind, display_name, storage_ref, content_sha256, media_type, byte_size, safety_class, visibility, retrieved_at, observed_source_version, created_at, created_by_actor_id, producer_name, producer_version)
       VALUES (?, ?, NULL, ?, NULL, 'user_provided', 'input_material', 'input file', ?, ?, 'text/plain', ?, 'controlled', 'user_visible', NULL, NULL, ?, ?, NULL, NULL)`,
    ).run(ids.e0, ids.p1, ids.sr1, e0Blob.ref, e0Blob.sha, e0Blob.size, T0, ids.human);

    db.prepare(
      `INSERT INTO source_references (source_reference_id, analysis_project_id, source_kind, display_name, description, capability_id, contract_version, source_object_key, initial_evidence_artifact_id, declared_data_scope, usage_constraints_json, safety_handling_policy, created_at, created_by_actor_id, archived_at)
       VALUES (?, ?, 'user_provided', 'source one', 'desc', NULL, NULL, NULL, ?, 'scope', '[]', 'local_transform_required', ?, ?, NULL)`,
    ).run(ids.sr1, ids.p1, ids.e0, T0, ids.human);

    db.prepare(
      `INSERT INTO source_checks (source_check_id, source_reference_id, checked_at, availability_status, adapter_name, adapter_version, observed_contract_version, observed_source_version, diagnostic_code, diagnostic_summary)
       VALUES (?, ?, ?, 'available', 'local', '1.0', NULL, NULL, NULL, NULL)`,
    ).run(ids.sc1, ids.sr1, T1);

    db.prepare(
      `INSERT INTO analysis_runs (analysis_run_id, analysis_project_id, analysis_plan_version_id, run_ordinal, predecessor_run_id, run_relation_type, triggering_gate_decision_id, current_analysis_stage, current_run_status, queued_at, started_at, ended_at, terminal_reason_code, terminal_summary, pi_session_ref, triggered_by_actor_id)
       VALUES (?, ?, ?, ?, NULL, NULL, NULL, 'S2.4', 'succeeded', ?, ?, ?, 'completed', 'run ok', NULL, ?)`,
    ).run(ids.run1, ids.p1, ids.pl1, 1, T2, T2, T3, ids.human);
    db.prepare(
      `INSERT INTO analysis_runs (analysis_run_id, analysis_project_id, analysis_plan_version_id, run_ordinal, predecessor_run_id, run_relation_type, triggering_gate_decision_id, current_analysis_stage, current_run_status, queued_at, started_at, ended_at, terminal_reason_code, terminal_summary, pi_session_ref, triggered_by_actor_id)
       VALUES (?, ?, ?, ?, ?, 'retry_of', ?, 'S2.1', 'failed', ?, ?, ?, 'engine_error', 'run failed', NULL, ?)`,
    ).run(ids.run2, ids.p1, ids.pl1, 2, ids.run1, ids.g2, T3, T3, T4, ids.human);

    db.prepare(
      `INSERT INTO evidence_artifacts (evidence_artifact_id, analysis_project_id, analysis_run_id, source_reference_id, source_check_id, origin_kind, artifact_kind, display_name, storage_ref, content_sha256, media_type, byte_size, safety_class, visibility, retrieved_at, observed_source_version, created_at, created_by_actor_id, producer_name, producer_version)
       VALUES (?, ?, ?, NULL, NULL, 'analysis_run', 'aggregate_result', 'aggregate', ?, ?, 'application/json', ?, 'derived', 'user_visible', NULL, NULL, ?, ?, 'engine', '1.0')`,
    ).run(ids.e1, ids.p1, ids.run1, e1Blob.ref, e1Blob.sha, e1Blob.size, T2, ids.human);
    db.prepare(
      `INSERT INTO evidence_artifacts (evidence_artifact_id, analysis_project_id, analysis_run_id, source_reference_id, source_check_id, origin_kind, artifact_kind, display_name, storage_ref, content_sha256, media_type, byte_size, safety_class, visibility, retrieved_at, observed_source_version, created_at, created_by_actor_id, producer_name, producer_version)
       VALUES (?, ?, NULL, ?, NULL, 'user_provided', 'input_material', 'raw upload', ?, ?, 'text/csv', ?, 'restricted_raw', 'review_only', NULL, NULL, ?, ?, NULL, NULL)`,
    ).run(ids.e2, ids.p1, ids.sr1, e2Blob.ref, e2Blob.sha, e2Blob.size, T0, ids.human);
    db.prepare(
      `INSERT INTO evidence_artifacts (evidence_artifact_id, analysis_project_id, analysis_run_id, source_reference_id, source_check_id, origin_kind, artifact_kind, display_name, storage_ref, content_sha256, media_type, byte_size, safety_class, visibility, retrieved_at, observed_source_version, created_at, created_by_actor_id, producer_name, producer_version)
       VALUES (?, ?, ?, NULL, NULL, 'system_generated', 'diagnostic', 'diag', ?, ?, 'text/plain', ?, 'derived', 'system_only', NULL, NULL, ?, ?, 'engine', '1.0')`,
    ).run(ids.e3, ids.p1, ids.run1, e3Blob.ref, e3Blob.sha, e3Blob.size, T3, ids.human);

    db.prepare(
      `INSERT INTO analysis_run_input_evidence (analysis_run_id, evidence_artifact_id, input_role, input_ordinal, plan_step_id, admitted_at)
       VALUES (?, ?, 'plan_input', 1, 'step-1', ?)`,
    ).run(ids.run1, ids.e0, T2);
    db.prepare(
      `INSERT INTO analysis_run_input_evidence (analysis_run_id, evidence_artifact_id, input_role, input_ordinal, plan_step_id, admitted_at)
       VALUES (?, ?, 'source_snapshot', 2, 'step-1', ?)`,
    ).run(ids.run1, ids.e2, T2);

    const insertEvent = db.prepare(
      `INSERT INTO run_events (run_event_id, analysis_run_id, sequence, event_type, analysis_stage_after, run_status_after, occurred_at, recorded_at, producer_name, producer_version, producer_event_id, payload_schema_version, payload_json, raw_diagnostic_artifact_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    insertEvent.run(uid(200), ids.run1, 1, "run_queued", "S2.1", "queued", T2, T2, "backend", "1.0", null, "workcanger.run-event.run_queued/1.0", "{}", null);
    insertEvent.run(uid(201), ids.run1, 2, "run_started", "S2.1", "running", T2, T2, "backend", "1.0", null, "workcanger.run-event.run_started/1.0", "{}", null);
    insertEvent.run(uid(202), ids.run1, 3, "run_succeeded", "S2.4", "succeeded", T3, T3, "backend", "1.0", null, "workcanger.run-event.run_succeeded/1.0", "{}", ids.e3);
    insertEvent.run(uid(203), ids.run2, 1, "run_queued", "S2.1", "queued", T3, T3, "backend", "1.0", null, "workcanger.run-event.run_queued/1.0", "{}", null);
    insertEvent.run(uid(204), ids.run2, 2, "run_failed", "S2.1", "failed", T4, T4, "backend", "1.0", null, "workcanger.run-event.run_failed/1.0", "{}", null);

    db.prepare(
      `INSERT INTO report_versions (report_version_id, analysis_project_id, analysis_run_id, structured_requirement_version_id, analysis_plan_version_id, version_ordinal, supersedes_version_id, schema_version, content_sha256, storage_ref, created_at, created_by_actor_id)
       VALUES (?, ?, ?, ?, ?, 1, NULL, '1.0', ?, ?, ?, ?)`,
    ).run(ids.rp1, ids.p1, ids.run1, ids.rv2, ids.pl1, rp1Blob.sha, rp1Blob.ref, T3, ids.human);
    db.prepare(
      `INSERT INTO report_version_evidence (report_version_id, evidence_artifact_id, evidence_ordinal)
       VALUES (?, ?, 1)`,
    ).run(ids.rp1, ids.e1);

    const insertGate = db.prepare(
      `INSERT INTO gate_decisions (gate_decision_id, analysis_project_id, gate_type, target_object_type, target_object_id, target_schema_version, target_content_sha256, decision, decided_at, decided_by_actor_id, actor_display_name_snapshot, comment, requested_changes_json, rejection_reason, submitted_via, client_version)
       VALUES (?, ?, ?, ?, ?, '1.0', ?, 'approved', ?, ?, 'Donor Human', NULL, '[]', NULL, 'web_ui', NULL)`,
    );
    insertGate.run(ids.g1, ids.p1, "requirement_confirmation", "structured_requirement_version", ids.rv2, rv2Blob.sha, T2, ids.human);
    insertGate.run(ids.g2, ids.p1, "plan_confirmation", "analysis_plan_version", ids.pl1, pl1Blob.sha, T2, ids.human);
    insertGate.run(ids.g3, ids.p1, "report_review", "report_version", ids.rp1, rp1Blob.sha, T3, ids.human);

    db.prepare(
      `INSERT INTO api_idempotency_records (idempotency_record_id, audit_actor_id, command_type, idempotency_key, request_sha256, execution_status, response_http_status, result_resource_type, result_resource_id, error_code, error_summary, created_at, completed_at)
       VALUES (?, ?, 'project.create', ?, ?, 'succeeded', 201, 'Project', ?, NULL, NULL, ?, ?)`,
    ).run(ids.i1, ids.human, "idem-key-1", "a".repeat(64), ids.p1, T0, T0);
    db.prepare(
      `INSERT INTO api_idempotency_records (idempotency_record_id, audit_actor_id, command_type, idempotency_key, request_sha256, execution_status, response_http_status, result_resource_type, result_resource_id, error_code, error_summary, created_at, completed_at)
       VALUES (?, ?, 'setup.bootstrap_local_human', ?, ?, 'succeeded', 201, 'AuditActor', ?, NULL, NULL, ?, ?)`,
    ).run(ids.i2, ids.sys, "idem-key-2", "b".repeat(64), ids.human, T0, T0);

    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    db.close();
    rmSync(root, { recursive: true, force: true });
    throw err;
  }
  db.close();

  return {
    root,
    layout,
    ids,
    blobHashes,
    blobRefs,
    cleanup: () => rmSync(root, { recursive: true, force: true }),
  };
}

export interface TargetOptions {
  /** Apply all target migrations (default true). False leaves a bare root. */
  readonly migrate?: boolean;
  /** Only apply migrations up to this version (default all). */
  readonly upToVersion?: number;
}

/** Create a target Analysis Projects data root (optionally migrated). */
export async function createTargetRoot(options?: TargetOptions): Promise<TargetRoot> {
  const root = mkdtempSync(join(tmpdir(), "xanthil-import-dst-"));
  const layout = initDataRoot(root);
  if (options?.migrate !== false) {
    const db = openDatabase(layout.sqlitePath);
    let migrations = loadMigrations(MIGRATIONS_DIR);
    const upToVersion = options?.upToVersion;
    if (upToVersion !== undefined) {
      migrations = migrations.filter((m) => m.version <= upToVersion);
    }
    await runMigrations(db, migrations, layout);
    db.close();
  }
  return { root, layout, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

/** Insert pi-Xanthil-style bootstrap actors (conflicting with donor's). */
export function seedConflictingBootstrapActors(layout: DataRootLayout): void {
  const db = openDatabase(layout.sqlitePath);
  db.prepare(
    `INSERT INTO audit_actors (audit_actor_id, actor_kind, actor_key, display_name, created_at, registered_by_actor_id) VALUES (?, 'system', 'bootstrap-system', 'System', ?, NULL)`,
  ).run(uid(900), T0);
  db.prepare(
    `INSERT INTO audit_actors (audit_actor_id, actor_kind, actor_key, display_name, created_at, registered_by_actor_id) VALUES (?, 'human', 'pi-xanthil-local-human', 'Local Human', ?, ?)`,
  ).run(uid(901), T0, uid(900));
  db.close();
}

/** Insert actors byte-identical to the donor fixture's. */
export function seedIdenticalActors(layout: DataRootLayout, fixture: DonorFixture): void {
  const db = openDatabase(layout.sqlitePath);
  db.prepare(
    `INSERT INTO audit_actors (audit_actor_id, actor_kind, actor_key, display_name, created_at, registered_by_actor_id) VALUES (?, 'system', 'bootstrap-system', 'System', ?, NULL)`,
  ).run(fixture.ids.sys, T0);
  db.prepare(
    `INSERT INTO audit_actors (audit_actor_id, actor_kind, actor_key, display_name, created_at, registered_by_actor_id) VALUES (?, 'human', 'donor-local-human', 'Donor Human', ?, ?)`,
  ).run(fixture.ids.human, T0, fixture.ids.sys);
  db.close();
}

/** Open the target DB read-write (test assertions). */
export function openTarget(layout: DataRootLayout): DatabaseSync {
  return openDatabase(layout.sqlitePath);
}

export function tableCount(db: DatabaseSync, table: string): number {
  const row = db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number };
  return row.n;
}

/**
 * Assert a serialized importer output contains no Evidence content, absolute
 * paths, storage_refs, blob hashes, SQL fragments, or stack traces.
 */
export function assertNoLeak(text: string, source?: DonorFixture): void {
  const forbidden = [
    "RESTRICTED-RAW-EVIDENCE-MARKER",
    "CONTROLLED-EVIDENCE-MARKER",
    "DERIVED-EVIDENCE-MARKER",
    "blobs/",
    "SELECT ",
    "INSERT ",
    "ALTER ",
    "Error:",
    "    at ",
  ];
  for (const marker of forbidden) {
    assert.ok(!text.includes(marker), `leak: ${JSON.stringify(marker)} in ${JSON.stringify(text)}`);
  }
  if (source) {
    assert.ok(!text.includes(source.root), "absolute source path leaked");
    for (const ref of source.blobRefs) {
      assert.ok(!text.includes(ref), `storage_ref leaked: ${ref}`);
    }
    for (const hash of source.blobHashes) {
      assert.ok(!text.includes(hash), `blob hash leaked: ${hash}`);
    }
  }
}
