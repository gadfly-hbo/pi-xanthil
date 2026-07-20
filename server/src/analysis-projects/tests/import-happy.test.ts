/**
 * Importer happy-path and idempotency tests (T0014 brief validation):
 * dry-run, happy path, ID/ordinal/event/SHA/provenance preservation,
 * already-imported behavior, target init, and source immutability.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import {
  runImport,
  type DryRunReport,
  type ImportAlreadyImported,
  type ImportCompleted,
} from "../import/importer.ts";
import { foreignKeyCheck } from "../persistence/db.ts";
import { openSourceImmutable } from "../import/source-reader.ts";
import { blobAbsolutePath } from "../persistence/blob-writer.ts";
import { importsDir } from "../import/journal.ts";
import {
  MARKERS,
  WORKSPACE_ID,
  createDonorFixture,
  createTargetRoot,
  fakeWorkspacePort,
  openTarget,
  seedIdenticalActors,
  snapshotTree,
  tableCount,
  uid,
  type DonorFixture,
  type TargetRoot,
} from "./import-helpers.ts";

const IMPORTER_TABLES = [
  "audit_actors",
  "analysis_projects",
  "analysis_requests",
  "structured_requirement_versions",
  "analysis_plan_versions",
  "source_references",
  "source_checks",
  "analysis_runs",
  "evidence_artifacts",
  "analysis_run_input_evidence",
  "run_events",
  "report_versions",
  "report_version_evidence",
  "gate_decisions",
  "api_idempotency_records",
] as const;

const EXPECTED_SOURCE_COUNTS: Record<string, number> = {
  audit_actors: 2,
  analysis_projects: 2,
  analysis_requests: 2,
  structured_requirement_versions: 2,
  analysis_plan_versions: 1,
  source_references: 1,
  source_checks: 1,
  analysis_runs: 2,
  evidence_artifacts: 4,
  analysis_run_input_evidence: 2,
  run_events: 5,
  report_versions: 1,
  report_version_evidence: 1,
  gate_decisions: 3,
  api_idempotency_records: 2,
};

async function withFixtures(
  fn: (source: DonorFixture, target: TargetRoot) => Promise<void>,
): Promise<void> {
  const source = await createDonorFixture();
  const target = await createTargetRoot();
  try {
    await fn(source, target);
  } finally {
    source.cleanup();
    target.cleanup();
  }
}

function baseOptions(source: DonorFixture, target: TargetRoot) {
  return {
    sourceDataRoot: source.root,
    targetDataRoot: target.root,
    targetWorkspaceId: WORKSPACE_ID,
    workspacePort: fakeWorkspacePort(true),
  };
}

test("dry-run executes full preflight and mapping with safe counts only", async () => {
  await withFixtures(async (source, target) => {
    const sourceBefore = snapshotTree(source.root);
    const targetBefore = snapshotTree(target.root);

    const result = (await runImport({
      ...baseOptions(source, target),
      dryRun: true,
    })) as DryRunReport;

    assert.equal(result.kind, "dry_run");
    assert.equal(result.ok, true);
    assert.equal(result.alreadyImported, false);
    assert.deepEqual(result.errors, []);
    assert.equal(result.source?.tableCounts.analysis_projects, 2);
    assert.equal(result.source?.tableCounts.evidence_artifacts, 4);
    assert.equal(result.source?.totalPlannedIds, 31);
    assert.equal(result.source?.blobCount, 8);
    assert.equal(result.source?.migrations.length, 2);
    assert.match(result.source?.fingerprint ?? "", /^[0-9a-f]{64}$/);
    assert.equal(result.target?.dbPresent, true);
    assert.equal(result.target?.workspaceExists, true);
    assert.equal(result.target?.migrations?.length, 5);
    assert.equal(result.plan?.insertCounts.audit_actors, 2);
    assert.equal(result.plan?.blobsToStage, 8);
    assert.deepEqual(result.conflicts, { durableId: 0, uniqueKey: 0, actorIdentity: 0 });

    // Dry-run must not write anywhere.
    assert.deepEqual(snapshotTree(source.root), sourceBefore);
    assert.deepEqual(snapshotTree(target.root), targetBefore);
    assert.equal(existsSync(importsDir(target.root)), false);
  });
});

test("happy path imports all rows, blobs, and provenance; source stays byte-identical", async () => {
  await withFixtures(async (source, target) => {
    const sourceBefore = snapshotTree(source.root);

    const result = (await runImport(baseOptions(source, target))) as ImportCompleted;
    assert.equal(result.status, "completed");

    const manifest = result.manifest;
    assert.equal(manifest.result, "completed");
    assert.equal(manifest.targetWorkspaceId, WORKSPACE_ID);
    assert.equal(manifest.blobCount, 8);
    assert.equal(manifest.deduplicatedBlobCount, 0);
    assert.match(manifest.blobHashSetDigest, /^[0-9a-f]{64}$/);
    assert.match(manifest.sourceFingerprint, /^[0-9a-f]{64}$/);
    assert.deepEqual(manifest.tableCounts, {
      ...Object.fromEntries(IMPORTER_TABLES.map((t) => [t, 0])),
      ...EXPECTED_SOURCE_COUNTS,
    });
    assert.ok(manifest.startedAt <= manifest.completedAt);

    const db = openTarget(target.layout);
    try {
      // Row counts + FK integrity.
      for (const table of IMPORTER_TABLES) {
        assert.equal(tableCount(db, table), EXPECTED_SOURCE_COUNTS[table], `count ${table}`);
      }
      assert.deepEqual(foreignKeyCheck(db), []);

      // Durable IDs preserved (spot checks across tables).
      const project = db
        .prepare(`SELECT * FROM analysis_projects WHERE analysis_project_id = ?`)
        .get(source.ids.p1) as Record<string, unknown>;
      assert.equal(project.slug, "donor-project-one");
      assert.equal(project.workspace_id, WORKSPACE_ID);
      assert.equal(project.current_requirement_version_id, source.ids.rv2);
      assert.equal(project.created_by_actor_id, source.ids.human);

      const rv2 = db
        .prepare(`SELECT * FROM structured_requirement_versions WHERE structured_requirement_version_id = ?`)
        .get(source.ids.rv2) as Record<string, unknown>;
      assert.equal(rv2.version_ordinal, 2);
      assert.equal(rv2.supersedes_version_id, source.ids.rv1);
      assert.equal(rv2.created_at, "2026-01-03T00:00:00.000Z");

      const run2 = db
        .prepare(`SELECT * FROM analysis_runs WHERE analysis_run_id = ?`)
        .get(source.ids.run2) as Record<string, unknown>;
      assert.equal(run2.run_ordinal, 2);
      assert.equal(run2.predecessor_run_id, source.ids.run1);
      assert.equal(run2.run_relation_type, "retry_of");
      assert.equal(run2.triggering_gate_decision_id, source.ids.g2);

      const events = db
        .prepare(`SELECT sequence, producer_name, producer_version FROM run_events WHERE analysis_run_id = ? ORDER BY sequence`)
        .all(source.ids.run1) as Array<{ sequence: number; producer_name: string; producer_version: string }>;
      assert.deepEqual(events.map((e) => e.sequence), [1, 2, 3]);
      assert.deepEqual(events.map((e) => e.producer_name), ["backend", "backend", "backend"]);
      assert.deepEqual(events.map((e) => e.producer_version), ["1.0", "1.0", "1.0"]);

      // Safety classes and provenance preserved verbatim.
      const safety = db
        .prepare(`SELECT evidence_artifact_id, safety_class, visibility, producer_name FROM evidence_artifacts ORDER BY evidence_artifact_id`)
        .all() as Array<Record<string, unknown>>;
      const byId = new Map(safety.map((row) => [row.evidence_artifact_id, row]));
      assert.equal(byId.get(source.ids.e2)?.safety_class, "restricted_raw");
      assert.equal(byId.get(source.ids.e2)?.visibility, "review_only");
      assert.equal(byId.get(source.ids.e0)?.safety_class, "controlled");
      assert.equal(byId.get(source.ids.e1)?.safety_class, "derived");
      assert.equal(byId.get(source.ids.e1)?.producer_name, "engine");

      // Actor IDs preserved.
      const actors = db
        .prepare(`SELECT audit_actor_id, actor_kind, actor_key, registered_by_actor_id FROM audit_actors ORDER BY created_at, audit_actor_id`)
        .all() as Array<Record<string, unknown>>;
      assert.deepEqual(
        actors.map((a) => a.audit_actor_id),
        [source.ids.sys, source.ids.human],
      );
      assert.equal(actors[1]?.registered_by_actor_id, source.ids.sys);

      // Idempotency records preserved with IDs and result pointers.
      const idem = db
        .prepare(`SELECT * FROM api_idempotency_records WHERE idempotency_record_id = ?`)
        .get(source.ids.i1) as Record<string, unknown>;
      assert.equal(idem.command_type, "project.create");
      assert.equal(idem.result_resource_id, source.ids.p1);
      assert.equal(idem.audit_actor_id, source.ids.human);
    } finally {
      db.close();
    }

    // Blobs published with content-addressed refs; restricted bytes preserved.
    for (let i = 0; i < source.blobRefs.length; i++) {
      const abs = blobAbsolutePath(target.layout.blobsDir, source.blobRefs[i]!);
      assert.ok(existsSync(abs), `blob ${i} exists`);
    }
    const restrictedTarget = readFileSync(
      blobAbsolutePath(target.layout.blobsDir, source.blobRefs[6]!),
      "utf8",
    );
    assert.equal(restrictedTarget, MARKERS.restrictedRaw);

    // Attempt artifacts cleaned up; only the completed manifest remains.
    assert.equal(readdirSync(target.layout.tmpDir).filter((d) => d.startsWith("import-")).length, 0);
    const importsEntries = readdirSync(importsDir(target.root));
    assert.equal(importsEntries.filter((f) => f.endsWith(".journal.json")).length, 0);
    assert.equal(importsEntries.filter((f) => f.endsWith(".manifest.json")).length, 1);

    // Source tree is byte-identical after the import.
    assert.deepEqual(snapshotTree(source.root), sourceBefore);
  });
});

test("re-running the same source returns already_imported without duplicate rows", async () => {
  await withFixtures(async (source, target) => {
    const first = (await runImport(baseOptions(source, target))) as ImportCompleted;
    assert.equal(first.status, "completed");

    const second = (await runImport(baseOptions(source, target))) as ImportAlreadyImported;
    assert.equal(second.status, "already_imported");
    assert.equal(second.manifest.sourceFingerprint, first.manifest.sourceFingerprint);

    const db = openTarget(target.layout);
    try {
      for (const table of IMPORTER_TABLES) {
        assert.equal(tableCount(db, table), EXPECTED_SOURCE_COUNTS[table], `count ${table}`);
      }
    } finally {
      db.close();
    }
    // No additional manifests/journals were created for the short-circuit.
    const importsEntries = readdirSync(importsDir(target.root));
    assert.equal(importsEntries.filter((f) => f.endsWith(".manifest.json")).length, 1);
  });
});

test("identical pre-existing actors are skipped, not duplicated or merged", async () => {
  await withFixtures(async (source, target) => {
    seedIdenticalActors(target.layout, source);

    const result = (await runImport(baseOptions(source, target))) as ImportCompleted;
    assert.equal(result.status, "completed");
    assert.equal(result.manifest.tableCounts.audit_actors, 0);

    const db = openTarget(target.layout);
    try {
      assert.equal(tableCount(db, "audit_actors"), 2);
      assert.equal(tableCount(db, "analysis_projects"), 2);
      assert.equal(tableCount(db, "api_idempotency_records"), 2);
    } finally {
      db.close();
    }
  });
});

test("allowTargetInit creates and migrates a missing target DB, then imports", async () => {
  const source = await createDonorFixture();
  const target = await createTargetRoot({ migrate: false });
  try {
    const result = (await runImport({
      ...baseOptions(source, target),
      allowTargetInit: true,
    })) as ImportCompleted;
    assert.equal(result.status, "completed");

    const db = openTarget(target.layout);
    try {
      const versions = db
        .prepare(`SELECT version FROM schema_migrations ORDER BY version`)
        .all() as Array<{ version: number }>;
      assert.deepEqual(versions.map((v) => v.version), [1, 2, 3, 4, 5]);
      assert.equal(tableCount(db, "analysis_projects"), 2);
      assert.deepEqual(foreignKeyCheck(db), []);
    } finally {
      db.close();
    }
  } finally {
    source.cleanup();
    target.cleanup();
  }
});

test("missing target DB without allowTargetInit fails closed before any write", async () => {
  const source = await createDonorFixture();
  const target = await createTargetRoot({ migrate: false });
  try {
    const result = await runImport(baseOptions(source, target));
    assert.equal(result.status, "failed");
    if (result.status === "failed") {
      assert.equal(result.phase, "preflight_target");
      assert.equal(result.error.code, "target_not_initialized");
    }
    assert.equal(existsSync(target.layout.sqlitePath), false);
    assert.equal(existsSync(importsDir(target.root)), false);
  } finally {
    source.cleanup();
    target.cleanup();
  }
});

test("re-import after target reset proceeds (manifest alone does not short-circuit)", async () => {
  await withFixtures(async (source, target) => {
    const first = (await runImport(baseOptions(source, target))) as ImportCompleted;
    assert.equal(first.status, "completed");

    // Simulate a target reset: DB deleted, completed manifest retained.
    const dbPath = target.layout.sqlitePath;
    const { rmSync } = await import("node:fs");
    rmSync(dbPath, { force: true });
    rmSync(`${dbPath}-wal`, { force: true });
    rmSync(`${dbPath}-shm`, { force: true });

    const second = (await runImport({
      ...baseOptions(source, target),
      allowTargetInit: true,
    })) as ImportCompleted;
    assert.equal(second.status, "completed");
    assert.equal(second.manifest.sourceFingerprint, first.manifest.sourceFingerprint);

    const db = openTarget(target.layout);
    try {
      assert.equal(tableCount(db, "analysis_projects"), 2);
      assert.equal(tableCount(db, "run_events"), 5);
    } finally {
      db.close();
    }
  });
});

test("ordinal chains, event sequences, and timestamps reconcile exactly", async () => {
  await withFixtures(async (source, target) => {
    const result = (await runImport(baseOptions(source, target))) as ImportCompleted;
    assert.equal(result.status, "completed");

    const srcDb = openSourceImmutable(source.layout.sqlitePath);
    const dstDb = openTarget(target.layout);
    try {
      const tables = [
        ["structured_requirement_versions", "structured_requirement_version_id"],
        ["analysis_plan_versions", "analysis_plan_version_id"],
        ["analysis_runs", "analysis_run_id"],
        ["run_events", "run_event_id"],
        ["report_versions", "report_version_id"],
        ["gate_decisions", "gate_decision_id"],
        ["evidence_artifacts", "evidence_artifact_id"],
      ] as const;
      for (const [table, idCol] of tables) {
        const srcRows = srcDb.prepare(`SELECT * FROM ${table} ORDER BY ${idCol}`).all() as Array<Record<string, unknown>>;
        const dstRows = dstDb.prepare(`SELECT * FROM ${table} ORDER BY ${idCol}`).all() as Array<Record<string, unknown>>;
        assert.equal(dstRows.length, srcRows.length, `${table} length`);
        for (let i = 0; i < srcRows.length; i++) {
          // node:sqlite returns null-prototype rows; normalize before compare.
          const src = { ...srcRows[i]! };
          const dst = { ...dstRows[i]! };
          assert.deepEqual(dst, src, `${table} row ${i}`);
        }
      }
    } finally {
      srcDb.close();
      dstDb.close();
    }
  });
});
