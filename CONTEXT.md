# pi-Xanthil Context

## Purpose

This is an index-style context file for CDI: Controller-Domain Isolation, the 总控域隔离工程法.

It does not replace existing pi-Xanthil authority documents. It points agents to the current sources of truth and avoids duplicating long-lived rules.

## Authority Order

1. `AGENTS.md`: data safety, operating rules, validation expectations, and active constraints.
2. `Orchestration.md`: controller charter, domain ownership, seam-layer authority, task lifecycle, and current scheduling baseline.
3. `docs/wiki.html`: task dispatch board, active cards, fast fixes, and version history.
4. `docs/notes-*.md`: domain current state, decisions, pitfalls, and follow-up notes.
5. Contract documents under `docs/`: workflow, schema, harness, prompt, backlog, and module-specific contracts.

If this file conflicts with any authority above, the existing authority document wins.

## CDI Method

pi-Xanthil follows CDI:

- Controller owns architecture, seam-layer contracts, cross-domain integration, final review, and validation.
- Domain agents work inside assigned domain boundaries and slot files.
- Shared terminology, shared types, DB schema, route registration, global constants, and cross-domain contracts require controller approval.
- Domain work returns to the controller through handoff, review, validation, and task-board updates.

## Domain Index

| Domain | Source of Truth |
|---|---|
| Controller / infrastructure | `Orchestration.md`, `docs/notes-infra.md` |
| Data foundation | `Orchestration.md`, `docs/notes-data.md`, `AGENTS.md` data safety section |
| Engine / agent workflow | `Orchestration.md`, `docs/notes-engine.md` |
| Visualization / delivery | `Orchestration.md`, `docs/notes-viz.md` |
| Task dispatch | `docs/wiki.html` |

## Data Safety Index

The data safety baseline is `AGENTS.md`.

Key pointers:

- Raw `draw_data` row-level content must not be sent directly to LLMs.
- `data_exploration` remains local and non-LLM.
- Registered tool outputs may be used only according to their safety boundary.
- Data exploration changes must run the repository grep-based LLM-call isolation check from `AGENTS.md`.

## Contract Index

| Contract Area | Source |
|---|---|
| Controller/domain ownership | `Orchestration.md` |
| Seam-layer rules | `Orchestration.md` |
| Shared types and API slot ownership | `Orchestration.md` |
| Workflow compatibility | `docs/workflow-schema-compat.md` |
| Workflow on-block behavior | `docs/工作流-onblock契约.md` |
| Tool-use v2 exposure and output contracts | `docs/adr/0001-tool-use-v2-exposure-and-output-contracts.md`, `docs/backlog/tool-use-治理中枢.md`, `docs/notes-infra.md §十五` |
| Harness and eval contracts | `docs/harness-etclovg-coverage.md`, `docs/backlog/` |
| Domain current state | `docs/notes-data.md`, `docs/notes-engine.md`, `docs/notes-infra.md`, `docs/notes-viz.md` |
| Prompt and session SOPs | `docs/prompts/` |

## Contract Index Maintenance

When adding, renaming, moving, or materially changing a cross-domain contract document, update the Contract Index in this file during the same task.

If the index is not updated, the `HANDOFF_BACK` must explain why no index change is needed, and controller review must explicitly accept that reason.

## Template Usage

Future cross-domain work should use templates from `docs/templates/` when applicable:

- `DOMAIN_HANDOFF.template.md`: controller-to-domain brief.
- `HANDOFF_BACK.template.md`: domain-to-controller return.
- `CONTRACT_CHANGE_REQUEST.template.md`: shared contract change request.
- `REVIEW_CHECKLIST.template.md`: controller final review.

Existing task cards and historical notes do not need backfill unless the controller identifies active risk.

## Notes

- Do not move content out of `Orchestration.md` into this file.
- Do not duplicate long rules from `AGENTS.md`.
- Keep this file as a navigational index so future agents can find the correct authority quickly.
