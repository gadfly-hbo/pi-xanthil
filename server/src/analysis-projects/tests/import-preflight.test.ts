/**
 * Importer preflight negative tests (T0014 brief validation):
 * source read-only proof, schema/checksum drift, FK failure, target
 * ID/unique conflicts, actor conflicts, missing/corrupt/path-traversal
 * blobs, unknown safety/enum/table/column, and unknown schema versions.
 * Every case must fail closed with a safe error code and no partial writes.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  existsSync,
  readdirSync,
  readFileSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { runImport, type ImportFailure } from "../import/importer.ts";
import { importsDir } from "../import/journal.ts";
import { TABLE_SPECS } from "../import/schema-plan.ts";
import {
  WORKSPACE_ID,
  assertNoLeak,
  createDonorFixture,
  createTargetRoot,
  fakeWorkspacePort,
  openTarget,
  seedConflictingBootstrapActors,
  snapshotTree,
  tableCount,
  uid,
  type DonorFixture,
  type TargetRoot,
} from "./import-helpers.ts";

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

async function expectFailure(
  source: DonorFixture,
  target: TargetRoot,
  code: string,
  options?: Partial<Parameters<typeof runImport>[0]>,
): Promise<ImportFailure> {
  const result = await runImport({ ...baseOptions(source, target), ...options });
  assert.equal(result.status, "failed", `expected failure ${code}, got ${JSON.stringify(result)}`);
  if (result.status !== "failed") throw new Error("unreachable");
  assert.equal(result.error.code, code);
  assertNoLeak(result.error.message, source);
  return result;
}

/** Mutate the fixture source directly (raw connection, FK explicitly off). */
function tamperSource(fixture: DonorFixture, fn: (db: DatabaseSync) => void): void {
  const db = new DatabaseSync(fixture.layout.sqlitePath, { enableForeignKeyConstraints: false });
  try {
    fn(db);
  } finally {
    db.close();
  }
}

test("source root missing / not donor layout fails closed", async () => {
  const source = await createDonorFixture();
  const target = await createTargetRoot();
  try {
    const result = await runImport({
      sourceDataRoot: join(source.root, "does-not-exist"),
      targetDataRoot: target.root,
      targetWorkspaceId: WORKSPACE_ID,
      workspacePort: fakeWorkspacePort(true),
    });
    assert.equal(result.status, "failed");
    if (result.status === "failed") assert.equal(result.error.code, "source_root_invalid");

    rmSync(source.layout.blobsDir, { recursive: true, force: true });
    const result2 = await runImport(baseOptions(source, target));
    assert.equal(result2.status, "failed");
    if (result2.status === "failed") assert.equal(result2.error.code, "source_root_invalid");
  } finally {
    source.cleanup();
    target.cleanup();
  }
});

test("source DB without schema_migrations is unknown and fails closed", async () => {
  await withFixtures(async (source, target) => {
    tamperSource(source, (db) => {
      db.exec("DROP TABLE schema_migrations");
    });
    await expectFailure(source, target, "source_schema_unknown");
  });
});

test("source migration checksum drift fails closed", async () => {
  await withFixtures(async (source, target) => {
    tamperSource(source, (db) => {
      db.prepare(`UPDATE schema_migrations SET checksum = ? WHERE version = 2`).run("0".repeat(64));
    });
    await expectFailure(source, target, "source_schema_drift");
  });
});

test("source with an extra migration version fails closed", async () => {
  await withFixtures(async (source, target) => {
    tamperSource(source, (db) => {
      db.prepare(
        `INSERT INTO schema_migrations (version, name, checksum, applied_at, application_version) VALUES (3, '0003_extra', ?, '2026-01-01T00:00:00.000Z', '0.0.0')`,
      ).run("0".repeat(64));
    });
    await expectFailure(source, target, "source_schema_drift");
  });
});

test("source with an unknown extra table fails closed", async () => {
  await withFixtures(async (source, target) => {
    tamperSource(source, (db) => {
      db.exec(`CREATE TABLE surprise_table (id TEXT PRIMARY KEY)`);
    });
    await expectFailure(source, target, "source_unknown_table");
  });
});

test("source with column drift on a contract table fails closed", async () => {
  await withFixtures(async (source, target) => {
    tamperSource(source, (db) => {
      db.exec(`ALTER TABLE evidence_artifacts ADD COLUMN extra_col TEXT`);
    });
    await expectFailure(source, target, "source_unknown_column");
  });
});

test("source FK violation fails closed", async () => {
  await withFixtures(async (source, target) => {
    tamperSource(source, (db) => {
      db.prepare(
        `INSERT INTO source_checks (source_check_id, source_reference_id, checked_at, availability_status, adapter_name, adapter_version)
         VALUES (?, ?, '2026-01-01T00:00:00.000Z', 'available', 'local', '1.0')`,
      ).run(uid(300), uid(399)); // source_reference_id does not exist
    });
    await expectFailure(source, target, "source_integrity_fk");
  });
});

test("source ordinal chain gap fails closed", async () => {
  await withFixtures(async (source, target) => {
    tamperSource(source, (db) => {
      db.prepare(
        `UPDATE structured_requirement_versions SET version_ordinal = 5 WHERE structured_requirement_version_id = ?`,
      ).run(source.ids.rv2);
    });
    await expectFailure(source, target, "source_integrity_structure");
  });
});

test("source non-UUID durable ID fails closed", async () => {
  await withFixtures(async (source, target) => {
    tamperSource(source, (db) => {
      db.prepare(`UPDATE gate_decisions SET gate_decision_id = 'not-a-uuid' WHERE gate_decision_id = ?`).run(source.ids.g3);
    });
    await expectFailure(source, target, "source_integrity_structure");
  });
});

test("unknown enum value fails closed", async () => {
  await withFixtures(async (source, target) => {
    tamperSource(source, (db) => {
      db.exec("PRAGMA ignore_check_constraints = ON");
      db.prepare(`UPDATE analysis_projects SET project_status = 'weird' WHERE analysis_project_id = ?`).run(source.ids.p1);
    });
    await expectFailure(source, target, "source_unknown_enum");
  });
});

test("unknown Evidence safety class fails closed (WCA-03)", async () => {
  await withFixtures(async (source, target) => {
    tamperSource(source, (db) => {
      db.exec("PRAGMA ignore_check_constraints = ON");
      db.prepare(`UPDATE evidence_artifacts SET safety_class = 'raw-ish' WHERE evidence_artifact_id = ?`).run(source.ids.e2);
    });
    await expectFailure(source, target, "source_unknown_safety_class");
  });
});

test("missing referenced blob fails closed", async () => {
  await withFixtures(async (source, target) => {
    unlinkSync(join(source.layout.blobsDir, source.blobRefs[5]!.replace("blobs/", "")));
    await expectFailure(source, target, "blob_missing");
  });
});

test("Evidence byte_size mismatch fails closed", async () => {
  await withFixtures(async (source, target) => {
    tamperSource(source, (db) => {
      db.prepare(`UPDATE evidence_artifacts SET byte_size = byte_size + 1 WHERE evidence_artifact_id = ?`).run(source.ids.e0);
    });
    await expectFailure(source, target, "blob_size_mismatch");
  });
});

test("corrupted blob content fails closed on SHA-256", async () => {
  await withFixtures(async (source, target) => {
    // Use a version-table blob (no declared byte_size): hash check fires.
    const blobPath = join(source.layout.blobsDir, source.blobRefs[0]!.replace("blobs/", ""));
    writeFileSync(blobPath, "tampered-content");
    await expectFailure(source, target, "blob_hash_mismatch");
  });
});

test("path-traversal / non-content-addressed storage_ref fails closed", async () => {
  await withFixtures(async (source, target) => {
    tamperSource(source, (db) => {
      db.prepare(`UPDATE evidence_artifacts SET storage_ref = '../escape' WHERE evidence_artifact_id = ?`).run(source.ids.e0);
    });
    await expectFailure(source, target, "blob_ref_invalid");
  });
});

test("target schema drift (missing 0003) fails closed", async () => {
  const source = await createDonorFixture();
  const target = await createTargetRoot({ upToVersion: 2 });
  try {
    await expectFailure(source, target, "target_schema_drift");
  } finally {
    source.cleanup();
    target.cleanup();
  }
});

test("target checksum tampering fails closed", async () => {
  await withFixtures(async (source, target) => {
    const db = openTarget(target.layout);
    db.prepare(`UPDATE schema_migrations SET checksum = ? WHERE version = 3`).run("0".repeat(64));
    db.close();
    await expectFailure(source, target, "target_schema_drift");
  });
});

test("workspace absence fails closed before any target write", async () => {
  await withFixtures(async (source, target) => {
    const targetBefore = snapshotTree(target.root);
    const result = await runImport({
      ...baseOptions(source, target),
      workspacePort: fakeWorkspacePort(false),
    });
    assert.equal(result.status, "failed");
    if (result.status === "failed") {
      assert.equal(result.phase, "workspace");
      assert.equal(result.error.code, "workspace_not_found");
    }
    assert.deepEqual(snapshotTree(target.root), targetBefore);
    assert.equal(existsSync(importsDir(target.root)), false);
  });
});

test("target durable ID conflict fails closed", async () => {
  await withFixtures(async (source, target) => {
    const db = openTarget(target.layout);
    db.prepare(
      `INSERT INTO audit_actors (audit_actor_id, actor_kind, actor_key, display_name, created_at) VALUES (?, 'system', 'other-system', 'Other', '2026-01-01T00:00:00.000Z')`,
    ).run(uid(900));
    db.prepare(
      `INSERT INTO analysis_projects (analysis_project_id, project_kind, title, slug, project_status, created_at, created_by_actor_id, updated_at, workspace_id)
       VALUES (?, 'daily_analysis', 'Clash', 'clash-slug', 'active', '2026-01-01T00:00:00.000Z', ?, '2026-01-01T00:00:00.000Z', 'ws-other')`,
    ).run(source.ids.p1, uid(900));
    db.close();

    const result = await expectFailure(source, target, "conflict_durable_id");
    assert.equal(result.phase, "conflict");
    const db2 = openTarget(target.layout);
    try {
      assert.equal(tableCount(db2, "analysis_projects"), 1); // pre-existing row only
    } finally {
      db2.close();
    }
  });
});

test("target slug unique-key conflict fails closed (NOCASE)", async () => {
  await withFixtures(async (source, target) => {
    const db = openTarget(target.layout);
    db.prepare(
      `INSERT INTO audit_actors (audit_actor_id, actor_kind, actor_key, display_name, created_at) VALUES (?, 'system', 'other-system', 'Other', '2026-01-01T00:00:00.000Z')`,
    ).run(uid(900));
    db.prepare(
      `INSERT INTO analysis_projects (analysis_project_id, project_kind, title, slug, project_status, created_at, created_by_actor_id, updated_at, workspace_id)
       VALUES (?, 'daily_analysis', 'Other', 'DONOR-PROJECT-ONE', 'active', '2026-01-01T00:00:00.000Z', ?, '2026-01-01T00:00:00.000Z', 'ws-other')`,
    ).run(uid(901), uid(900)); // same slug (NOCASE), different ID
    db.close();

    const result = await expectFailure(source, target, "conflict_unique_key");
    assert.equal(result.phase, "conflict");
  });
});

test("actor (kind,key) conflict with bootstrap actor fails closed", async () => {
  await withFixtures(async (source, target) => {
    seedConflictingBootstrapActors(target.layout);
    const result = await expectFailure(source, target, "conflict_actor_identity");
    assert.equal(result.phase, "conflict");
    const db = openTarget(target.layout);
    try {
      assert.equal(tableCount(db, "audit_actors"), 2); // untouched bootstrap actors
      assert.equal(tableCount(db, "analysis_projects"), 0);
    } finally {
      db.close();
    }
  });
});

test("actor same ID with different content fails closed", async () => {
  await withFixtures(async (source, target) => {
    const db = openTarget(target.layout);
    db.prepare(
      `INSERT INTO audit_actors (audit_actor_id, actor_kind, actor_key, display_name, created_at) VALUES (?, 'system', 'bootstrap-system', 'Renamed System', '2026-01-01T00:00:00.000Z')`,
    ).run(source.ids.sys); // same ID, different display_name
    db.close();
    await expectFailure(source, target, "conflict_actor_identity");
  });
});

test("partial prior state with completed manifest fails closed", async () => {
  await withFixtures(async (source, target) => {
    const first = await runImport(baseOptions(source, target));
    assert.equal(first.status, "completed");
    // Remove P2 + its request so target FK stays consistent but the project
    // set no longer matches the completed manifest.
    const db = openTarget(target.layout);
    db.prepare(`DELETE FROM analysis_requests WHERE analysis_project_id = ?`).run(source.ids.p2);
    db.prepare(`DELETE FROM analysis_projects WHERE analysis_project_id = ?`).run(source.ids.p2);
    db.close();

    const result = await expectFailure(source, target, "conflict_partial_state");
    assert.equal(result.phase, "already_imported");
  });
});

test("enum domains stay in sync with migration CHECK constraints", async () => {
  const read = (name: string) =>
    readFileSync(join(import.meta.dirname, "..", "persistence", "migrations", name), "utf8");
  const raw = [
    read("0001_initial_workcanger.sql"),
    read("0002_create_api_idempotency_records.sql"),
    read("0005_extend_idempotency_for_closure.sql"),
  ].join("\n");
  // Strip CREATE INDEX statements: their partial-index WHERE ... IN (...) lists
  // are not CHECK domains and must not be extracted.
  const sql = raw.replace(/CREATE\s+(?:UNIQUE\s+)?INDEX[\s\S]*?;/gi, "");
  const extracted = new Map<string, string[]>();
  const re = /(\w+)\s+IN\s*\(([^)]+)\)/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(sql)) !== null) {
    const column = match[1]!;
    const values = [...match[2]!.matchAll(/'([^']+)'/g)].map((m) => m[1]!);
    extracted.set(column, values);
  }
  assert.ok(extracted.size > 10, "extracted domains from migration SQL");

  const covered = new Set<string>();
  for (const spec of TABLE_SPECS) {
    for (const [column, domain] of Object.entries(spec.enumColumns)) {
      const fromSql = extracted.get(column);
      assert.ok(fromSql, `${spec.table}.${column} must exist in migration CHECK`);
      assert.deepEqual(
        [...domain].sort(),
        [...fromSql].sort(),
        `${spec.table}.${column} domain drift`,
      );
      covered.add(column);
    }
  }
  const uncovered = [...extracted.keys()].filter((col) => !covered.has(col));
  assert.deepEqual(uncovered, [], `uncovered CHECK domains: ${uncovered.join(", ")}`);
});
