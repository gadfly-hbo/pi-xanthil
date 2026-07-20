# T0019 WorkCanger S3 Closure Persistence

## Controller Correction - CURRENT DRAFT MUST BE REVISED

This retained draft is superseded by
`.agentops/tasks/T0019-workcanger-s3-closure-persistence/brief.md`. Do not use
this file as an implementation brief.

Reason: it was created from an incorrect Controller decision that pi-Xanthil
would "locally define" S3.1-S3.6 semantics. The user clarified on 2026-07-20
that S3.1-S3.6 already have complete definitions in the provided fifteen-state
AnalysisOps data analysis lifecycle.

Before any persistence implementation resumes, the Controller must copy or cite
the authoritative S3.1-S3.6 definitions into
`docs/workcanger-s3-business-closure-structure-ledger.md`, then revise this
brief or create a replacement task.

## Objective

Implement the first S3.x Business Closure slice: persistence only.

This task consumes the approved T0018 structure gate and the 2026-07-20
Controller Contract Decisions in
`docs/workcanger-s3-business-closure-structure-ledger.md` (§20 C1-C10).

Create the durable SQLite structures and narrowly scoped persistence helpers for:

- `closure_records`
- `closure_actions`
- `closure_feedback`

Do not implement application services, HTTP routes, frontend UI, stage derivation,
or command execution in this task.

## Authority

- `AGENTS.md`
- `docs/workcanger-absorption-contract.md` WCA-09
- `docs/workcanger-s3-business-closure-structure-ledger.md` §20 C1-C10
- Approved T0010-T0018 Task Bus tasks
- `agentharness-structure-grill` decision ledger gate has been completed for
  this persistence scope.

## Required Contract

Implement forward-only migration `0004_add_business_closure.sql` with:

1. `closure_records`
   - `closure_record_id TEXT PRIMARY KEY`
   - `analysis_project_id TEXT NOT NULL`
   - `workspace_id TEXT NOT NULL`
   - `locked_report_version_id TEXT NOT NULL`
   - `closure_ordinal INTEGER NOT NULL CHECK (closure_ordinal > 0)`
   - `closure_status TEXT NOT NULL CHECK IN ('initiated','in_progress','closed','abandoned')`
   - `initiated_at TEXT NOT NULL`
   - `initiated_by_actor_id TEXT NOT NULL`
   - `closed_at TEXT NULL`
   - `iteration_decision TEXT NULL CHECK NULL OR IN ('iterate','stop','defer')`
   - `updated_at TEXT NOT NULL`
   - UNIQUE `(analysis_project_id, closure_ordinal)`
   - workspace-scoped indexes suitable for project closure list/detail reads

2. `closure_actions`
   - `closure_action_id TEXT PRIMARY KEY`
   - `closure_record_id TEXT NOT NULL`
   - `recommendation_id TEXT NOT NULL`
   - `action_status TEXT NOT NULL CHECK IN ('planned','in_progress','blocked','completed','cancelled')`
   - `assignee_actor_id TEXT NULL`
   - `due_at TEXT NULL`
   - `completed_at TEXT NULL`
   - `outcome_summary TEXT NULL`
   - `created_at TEXT NOT NULL`
   - `updated_at TEXT NOT NULL`
   - UNIQUE `(closure_record_id, recommendation_id)`
   - FK to `closure_records` with deletion behavior matching ledger §7.1

3. `closure_feedback`
   - `closure_feedback_id TEXT PRIMARY KEY`
   - `closure_action_id TEXT NOT NULL`
   - `feedback_type TEXT NOT NULL CHECK IN ('progress','result','blocker','decision_note')`
   - `feedback_text TEXT NOT NULL`
   - `recorded_at TEXT NOT NULL`
   - `recorded_by_actor_id TEXT NOT NULL`
   - FK to `closure_actions` with deletion behavior matching ledger §7.1

Persistence helpers must:

- Validate raw inputs before conversion or persistence.
- Fail closed on invalid enum, missing workspace/project/locked report ownership,
  duplicate ordinal, duplicate recommendation, wrong workspace, and orphan rows.
- Scope all read helpers by `workspace_id` at the SQL layer.
- Preserve append-only feedback rows; no helper may overwrite feedback history.
- Avoid parsing Report JSON in this task except if a helper must store a
  provided `recommendation_id`; full recommendationId validation belongs to
  T0019b application service.

## Allowed Scope

May modify:

- `server/src/analysis-projects/persistence/**`
- `server/src/analysis-projects/tests/persistence-*`
- `server/src/analysis-projects/tests/application-helpers.ts` only if needed
  for persistence fixtures
- `docs/workcanger-absorption-contract.md` only to update Sequence 10/T0019
  status text after handoff
- `.agentops/tasks/T0019-workcanger-s3-closure-persistence/handoff.md`

Must not modify:

- `server/src/analysis-projects/application/**`
- `server/src/analysis-projects/contracts/**`
- `server/src/analysis-projects/routes/**`
- `web/src/**`
- `docs/wiki.html`
- WorkCanger or AgentHarness repositories

If a necessary change falls outside allowed scope, stop and submit a
CONTRACT_CHANGE_REQUEST in handoff.

## Validation Requirements

Run and record:

- Focused persistence migration/tests covering creation, constraints, indexes,
  FK behavior, uniqueness, workspace scoping, and invalid enum rejection.
- Corruption/negative tests for missing closure record, duplicate ordinal,
  duplicate recommendation, wrong workspace, invalid closure/action/feedback
  status, and append-only feedback preservation.
- `npm -w server run typecheck`
- `npm run typecheck`
- `npm run build`
- `git diff --check -- server/src/analysis-projects/persistence server/src/analysis-projects/tests docs/workcanger-absorption-contract.md`
- `grep -rE "(generate|chat|extract|clarify|sink|distill).*api\\." web/src/components/DataExplorationPane.tsx web/src/components/data-exploration/ 2>&1`

## Handoff Format

Include:

- What Changed
- Contract decisions consumed (C1-C10)
- Files changed vs allowed scope
- Migration details
- Persistence helper API and fail-closed behavior
- Evidence mapping from each Required Contract bullet to tests/source
- Validation output
- Tombstone code inventory for this task
- Risks / open questions / CONTRACT_CHANGE_REQUEST if any
- Memory Used
- Memory Candidates

## Dependency / Next Step

- Depends on `T0018` approved and B1/B2 resolved.
- If approved, the next task should be `T0020` for closure application
  contracts, services, read models, and stage derivation extension.
