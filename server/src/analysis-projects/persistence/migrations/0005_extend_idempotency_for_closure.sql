-- Extend api_idempotency_records CHECK constraints for S3.x Business Closure (v1, 0005)
-- Forward-only; no down migration.
-- Extends command_type and result_resource_type CHECK to include closure commands.
-- Preserves existing rows, indexes, uniqueness, and terminal status invariants.

-- SQLite does not support ALTER TABLE to modify CHECK constraints.
-- Strategy: create new table with extended constraints, copy data, drop old, rename.

CREATE TABLE api_idempotency_records_new (
  idempotency_record_id   TEXT PRIMARY KEY,
  audit_actor_id          TEXT NOT NULL,
  command_type            TEXT NOT NULL CHECK (command_type IN (
    'setup.bootstrap_local_human',
    'session.rotate_local_api_token',
    'actor.update_profile',
    'project.create',
    'project.update_metadata',
    'project.delete_draft',
    'project.cancel',
    'project.archive',
    'project.unarchive',
    'project.reopen',
    'evidence.upload_user',
    'source.register_agentharness',
    'source.update_metadata',
    'source.check',
    'source.read',
    'source.archive',
    'source.unarchive',
    'request.submit',
    'requirement.generate',
    'requirement.decide_confirmation',
    'plan.generate',
    'plan.decide_confirmation',
    'run.abort',
    'run.retry',
    'report.decide_review',
    'locked_report.generate_representation',
    'locked_report.export_analysisops',
    'closure.initiate_cycle',
    'closure.record_s31_translation',
    'closure.record_s32_deployment',
    'closure.record_s33_execution',
    'closure.append_s34_feedback',
    'closure.record_s35_evaluation',
    'closure.record_s36_trigger'
  )),
  idempotency_key         TEXT NOT NULL,
  request_sha256          TEXT NOT NULL CHECK (length(request_sha256) = 64 AND request_sha256 NOT GLOB '*[^0-9a-f]*'),
  execution_status        TEXT NOT NULL CHECK (execution_status IN ('in_progress', 'succeeded', 'failed', 'interrupted')),
  response_http_status    INTEGER,
  result_resource_type    TEXT CHECK (result_resource_type IS NULL OR result_resource_type IN (
    'AuditActor', 'Project', 'Request', 'Source', 'SourceCheck', 'Evidence',
    'Requirement', 'Plan', 'Gate', 'Run', 'Report', 'representation', 'export',
    'ClosureCycle', 'ClosureStageFact'
  )),
  result_resource_id      TEXT,
  error_code              TEXT,
  error_summary           TEXT,
  created_at              TEXT NOT NULL,
  completed_at            TEXT,
  UNIQUE (audit_actor_id, command_type, idempotency_key),
  CHECK (
    (result_resource_type IS NULL AND result_resource_id IS NULL)
    OR
    (result_resource_type IS NOT NULL AND result_resource_id IS NOT NULL)
  ),
  CHECK (
    (error_code IS NULL AND error_summary IS NULL)
    OR
    (error_code IS NOT NULL AND error_summary IS NOT NULL)
  ),
  CHECK (
    execution_status <> 'in_progress'
    OR (
      response_http_status IS NULL
      AND result_resource_type IS NULL
      AND result_resource_id IS NULL
      AND error_code IS NULL
      AND error_summary IS NULL
      AND completed_at IS NULL
    )
  ),
  CHECK (
    execution_status <> 'succeeded'
    OR (
      response_http_status IS NOT NULL
      AND completed_at IS NOT NULL
      AND error_code IS NULL
      AND error_summary IS NULL
    )
  ),
  CHECK (
    (execution_status <> 'failed' AND execution_status <> 'interrupted')
    OR (
      response_http_status IS NOT NULL
      AND completed_at IS NOT NULL
      AND error_code IS NOT NULL
      AND error_summary IS NOT NULL
      AND result_resource_type IS NULL
      AND result_resource_id IS NULL
    )
  ),
  CHECK (
    (result_resource_type IS NULL AND result_resource_id IS NULL)
    OR
    (error_code IS NULL AND error_summary IS NULL)
  ),
  FOREIGN KEY (audit_actor_id) REFERENCES audit_actors (audit_actor_id)
    ON DELETE RESTRICT
);

-- Copy all existing data
INSERT INTO api_idempotency_records_new SELECT * FROM api_idempotency_records;

-- Drop old table and rename
DROP TABLE api_idempotency_records;
ALTER TABLE api_idempotency_records_new RENAME TO api_idempotency_records;

-- Recreate recovery index
CREATE INDEX idx_api_idempotency_records_status_created
  ON api_idempotency_records (execution_status, created_at);
