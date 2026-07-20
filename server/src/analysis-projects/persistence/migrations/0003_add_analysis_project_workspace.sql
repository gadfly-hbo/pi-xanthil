-- Analysis-projects workspace ownership migration (v1, 0003)
-- Implements WCA-02: every Analysis Project must belong to a pi-Xanthil Workspace.
-- This file is immutable after first application. Checksum recorded in schema_migrations.
-- 0001_initial_workcanger.sql and 0002_create_api_idempotency_records.sql are NOT modified.
-- Forward-only; no down migration.

-- ============================================================================
-- workspace_id on analysis_projects
-- ============================================================================
-- WCA-02: workspace_id is TEXT NOT NULL with NO default.
-- SQLite enforces fail-closed: ADD COLUMN ... NOT NULL without DEFAULT
-- fails if the table has any existing rows. This is intentional - existing
-- donor data must be imported by the sequence 5 importer into a fresh target
-- DB, not migrated in-place with a fabricated workspace_id.
-- No cross-database FK is created; workspace existence is validated via the
-- WorkspaceExistencePort at the application layer.

ALTER TABLE analysis_projects ADD COLUMN workspace_id TEXT NOT NULL;

-- Workspace-scoped indexes for Project list/read queries.
-- The primary list query filters by workspace_id + project_status + archived_at
-- and orders by updated_at DESC, analysis_project_id DESC.
CREATE INDEX idx_analysis_projects_workspace_status_archived_updated
  ON analysis_projects (workspace_id, project_status, archived_at, updated_at);

-- Workspace-scoped slug lookup (slug uniqueness remains global per WCA-05).
CREATE INDEX idx_analysis_projects_workspace_slug
  ON analysis_projects (workspace_id, slug);
