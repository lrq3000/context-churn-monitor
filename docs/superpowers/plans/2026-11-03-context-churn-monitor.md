# Context Churn Monitor implementation plan

Spec: `docs/superpowers/specs/2026-11-03-context-churn-monitor-design.md`.

Approved: native implementation in the existing `feat/context-churn-monitor` worktree, dependency downloads, isolated tests, incremental local commits and one fresh-context final review. Base: `419d620eb863d76d95834c8321fb6a8c1a7f8a98`.

## Global constraints

Use turn/step vocabulary and literate programming. Keep deterministic monitoring independent of host and GUI. No model call without consumed explicit consent. Do not modify host SDKs. Preserve missing-data provenance. Commit source tests and decisions; leave regenerable artifacts ignored. Runtime evidence must distinguish simulated contract fixtures from actual host tests. Temporary artifacts stay in the approved temporary directory for manual cleanup.

### Task 1: Portable accounting and durable storage

- [x] Establish package, pinned dependencies/lock, TypeScript checks, build and Node test runner.
- [x] Write failing behavioral tests for compaction rebasing, multi-compaction accumulation, missing observations, method/capacity changes, duplicate events, completed-turn EMA, continuation replacement, thresholds and independent recovery.
- [x] Implement `src/core/` contracts, validated configuration, accounting and alerts, then `src/storage/` transactional indexed storage with durable identities and pagination.
- [x] Verify `npm test` and `npm run typecheck`. Expected: all behavioral cases pass, no type errors.
- [x] Commit coherent core/storage milestone.

Produces: normalized events, session snapshot, turn and step records, transactional event ingestion, paginated history. Consumers: adapters, report service, analysis.

### Task 2: OpenCode V2 and Codex adapters

- [x] Verify installed versions and actual SDK contracts; retain concise capability evidence.
- [x] Write failing shared adapter scenarios for user delivery, steps/retries, compaction, interruption, continuation and unavailable usage.
- [x] Implement lifecycle normalization, incremental evidence capture, explicit gaps and deterministic warning delivery. Codex hook runner serializes through durable storage and never blocks a user request on monitoring failure.
- [x] Package native entrypoints/hooks and expose authenticated read/report/analysis services without guessing a live server's identity.
- [x] Verify focused adapter tests, typecheck and isolated host load. Expected: same core semantics; unsupported host versions reported explicitly.
- [x] Commit adapter milestone.

Produces: host observations and backend access; consumes Task 1 event/storage contracts. GUI consumes authenticated backend snapshots rather than invoking a discovered unrelated server.

### Task 3: Deterministic reports and optional OpenChamber GUI

- [x] Write report/service tests for pagination, escaping, scope/sort, gaps, pairing, and SDK manifests.
- [x] Build a separately installable extension with native status section, annotated report panel/full-page view, expandable evidence, controls and HTML/JSON export.
- [x] Use existing SDK controls/theme; test real DOM interactions and responsive rendering.
- [x] Verify `npm run test:ui`, report/service tests and build. Expected: working navigation/filter/details/export with no automatic model calls.
- [x] Commit GUI/report milestone.

Consumes Task 1 records and Task 2 backend pairing; produces deterministic report and frozen selectable evidence.

### Task 4: Bounded consent-based analysis

- [x] Write failing tests for frozen evidence scope, budget enforcement, missing model, consent reuse, concurrent submission and uncertain provider outcomes.
- [x] Implement one-shot durable consent, bounded deterministic evidence selection, tools-free OpenCode generation and OpenChamber Small Model route; show reports outside the monitored conversation.
- [x] Add portable `context-churn-diagnostics` instructions and GUI model/consent controls.
- [x] Verify focused analysis tests, typecheck and full suite. Expected: no provider call without explicit consent; no automatic retry after uncertainty.
- [x] Commit analysis milestone.

Consumes storage, frozen records and host generation capability; must not inject output into monitored sessions.

### Task 5: Packaging, independent review and final verification

- [x] Update package README/config schema, repository README catalog and INSTALL guidance.
- [x] Run `npm run typecheck`, `npm test`, `npm run build`, `npm run test:smoke`, `npm run test:ui`, and `git diff --check`. Expected: green checks, or explicit host capability blockers.
- [x] Dispatch one independent whole-branch reviewer with spec/plan and ledger. Verify substantive findings with regression tests, then fix and rerun relevant checks.
- [x] Commit remaining verified work; report commits, runtime limitations, rulings, deferred minors and retained temporary files.

## Review focus

Check measurement correctness at compaction and model changes; non-user/synthetic admission; late observations and continuation; missing-data false negatives; multi-process writes and replay; growth versus request-token usage; malicious evidence in HTML; backend identity/authentication; consent atomicity and provider ambiguity; actual SDK exports and hook schema compatibility; extension packaging independent of backend; large-history query costs and report pagination.
