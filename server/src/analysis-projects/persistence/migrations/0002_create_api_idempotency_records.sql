-- Workcanger supporting table migration (v1, 0002)
-- Implements api_idempotency_records per Application API / ReadModels Contract v1 §15 (API-055/API-009).
-- This file is immutable after first application. Checksum recorded in schema_migrations.
-- 0001_initial_workcanger.sql is NOT modified. Forward-only; no down migration.

-- ============================================================================
-- api_idempotency_records
-- ============================================================================
-- Supporting structure for durable command idempotency.
-- Does NOT store request/response body, fieldErrors, diagnostic Evidence,
-- token, stack, or sensitive content. Permanently retained.
-- Polymorphic result pointer (result_resource_type/result_resource_id) has NO FK.
CREATE TABLE api_idempotency_records (
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
    'locked_report.export_analysisops'
  )),
  idempotency_key         TEXT NOT NULL,
  request_sha256          TEXT NOT NULL CHECK (length(request_sha256) = 64 AND request_sha256 NOT GLOB '*[^0-9a-f]*'),
  execution_status        TEXT NOT NULL CHECK (execution_status IN ('in_progress', 'succeeded', 'failed', 'interrupted')),
  response_http_status    INTEGER,
  result_resource_type    TEXT CHECK (result_resource_type IS NULL OR result_resource_type IN (
    'AuditActor', 'Project', 'Request', 'Source', 'SourceCheck', 'Evidence',
    'Requirement', 'Plan', 'Gate', 'Run', 'Report', 'representation', 'export'
  )),
  result_resource_id      TEXT,
  error_code              TEXT,
  error_summary           TEXT,
  created_at              TEXT NOT NULL,
  completed_at            TEXT,
  -- scope uniqueness: one active/terminal record per (actor, command, key)
  UNIQUE (audit_actor_id, command_type, idempotency_key),
  -- result type/id must be both null or both non-null
  CHECK (
    (result_resource_type IS NULL AND result_resource_id IS NULL)
    OR
    (result_resource_type IS NOT NULL AND result_resource_id IS NOT NULL)
  ),
  -- error code/summary must be both null or both non-null
  CHECK (
    (error_code IS NULL AND error_summary IS NULL)
    OR
    (error_code IS NOT NULL AND error_summary IS NOT NULL)
  ),
  -- in_progress: no terminal fields (no response status, no result, no error, no completed_at)
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
  -- succeeded: must have response status + completed_at, no error
  CHECK (
    execution_status <> 'succeeded'
    OR (
      response_http_status IS NOT NULL
      AND completed_at IS NOT NULL
      AND error_code IS NULL
      AND error_summary IS NULL
    )
  ),
  -- failed/interrupted: must have response status + completed_at + error, no result
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
  -- result and error are mutually exclusive across all statuses
  CHECK (
    (result_resource_type IS NULL AND result_resource_id IS NULL)
    OR
    (error_code IS NULL AND error_summary IS NULL)
  ),
  FOREIGN KEY (audit_actor_id) REFERENCES audit_actors (audit_actor_id)
    ON DELETE RESTRICT
);

-- Recovery index for startup orphan sweep (in_progress -> interrupted).
CREATE INDEX idx_api_idempotency_records_status_created
  ON api_idempotency_records (execution_status, created_at);
