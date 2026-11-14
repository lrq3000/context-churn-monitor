# Mobile Panel and Threshold Marks Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enable the existing full mobile panel and native sidebar marks for eligible threshold hits in the latest live/completed turn.

**Architecture:** Preserve the existing panel and notification pipeline. Capture threshold hits in the alert policy, project them into a small SQLite table, and reconcile them from the persistent GUI service through the SDK's native marks API.

**Tech Stack:** TypeScript, SQLite, Node.js, @openchamber/sdk 2.7.1, node:test and Playwright.

**Spec:** `docs/superpowers/specs/2026-11-14-mobile-threshold-marks-design.md`

## Global Constraints

- SDK 2.7.1; OpenChamber >=2.7.1 in both manifests; no plugin release-version change.
- `panel.mobile: true`, `contributes.marks: true`, `service.keepRunning: true`; no full-page contribution.
- Marks use `pulse`, `warning`, plain text <=200 characters; at most 200 marks and 60 changed calls per rolling minute.
- Latest turn includes live execution; new turns reset marks; existing model eligibility and EMA minimum samples apply; notification suppression does not suppress marks.
- Work only in the approved worktree. Local commits only; no live installation changes, push, publication or deletion.
- Test artifacts use `C:\Users\33632\AppData\Local\Temp\opencode` and remain for manual cleanup.

## Review Focus

- Warning-disable/cooldown suppression: raw eligible threshold hits still produce a mark without extra notifications (Task 2).
- A later small/unknown primary model: eligibility loss removes the mark; new turns do not inherit old hits (Task 2).
- Legacy and unavailable stores: no schema writes from the service and no false successful stale state (Task 3).
- Bursty updates/restart: clearing and newest-first restoration respect rolling host limits and failed calls are not cached as successes (Task 3).
- Phone full-panel surface: step details and View steps remain usable without horizontal body overflow (Tasks 1 and 3).

---

### Task 1: Native mobile and marks contract

**Files:** `package.json`, `package-lock.json`, `openchamber/package.json`, `openchamber/LICENSE.txt`, `tests/packaging.test.ts`, and these design/plan documents.

**Interfaces:** Both parsed manifests expose mobile panel opt-in, marks capability and a persistent service. SDK exports `createServiceHost`, `ServiceMark`, `SERVICE_MARKS_MAX` and `SERVICE_MARK_RATE_MAX`.

- [x] Add manifest assertions for mobile, marks, keepRunning, host floor and marks approval; run the focused packaging test and confirm failure against the old manifests.
- [x] Update SDK/lock with `npm install --package-lock-only --ignore-scripts --save-exact @openchamber/sdk@2.7.1`, then `npm ci --ignore-scripts`; update both manifests and bundled SDK attribution.
- [x] Run `node --import tsx --test tests/packaging.test.ts` and `npm run typecheck`; inspect the diff and commit `feat(openchamber): enable mobile panel and native marks capability`.

### Task 2: Threshold-hit accounting and indexed persistence

**Files:** `src/core/alerts.ts`, `src/storage/store.ts`, new `tests/marks.test.ts`.

**Interfaces:** Export `ThresholdHit` (`metric`, `kind`, `value`, `threshold`) and persist optional current-turn hits in `AlertPolicyState`. Export `ThresholdMarkRecord` (`sessionId`, `turn`, `at`, `hits`) from storage. `Store.marks(limit?: number): ThresholdMarkRecord[]` returns newest marked sessions, bounded to 200, or [] for a pre-projection read-only database.

- [x] Write failing tests for inclusive live and EMA thresholds, minSamples, warnings disabled, cooldown/rearm, eligibility loss, reset, reopen, interrupted/completed turns and persisted projections independent of notification history.
- [x] Run `node --import tsx --test tests/marks.test.ts` and confirm the expected new-interface failures.
- [x] Share threshold evaluation with notification emission, but capture hits before suppression. Maintain a per-session indexed projection in the same ingestion transaction; remove it on a new or ineligible turn. Keep legacy states valid.
- [x] Run marks, core, alerts, storage and alert-history tests plus typechecking; inspect the diff and commit `feat(monitor): persist latest-turn threshold hits independently of alerts`.

### Task 3: Service-host reconciliation and mobile verification

**Files:** new `src/gui/marks.ts`, `src/gui/service.ts`, new `tests/mark-service.test.ts`, `tests/alert-service.test.ts`, `tests/ui/report.test.ts`, `README.md`.

**Interfaces:** `SessionMarks` owns projection loading, desired/published maps, host-call budgeting and startup/shutdown timers. Accept an injected `Pick<ServiceHost, 'setMark'>` and clock for deterministic tests. Service uses `createServiceHost({ env: process.env })`; no sessionControl declaration is needed.

- [ ] Write failing tests for startup restoration, latest-turn removal, multiple sources, legacy/unreadable sources, 200-mark newest selection, unchanged deduplication, rolling 60/minute budget, failed callback retries and shutdown without polling overlap.
- [ ] Implement the reconciler and wire startup/shutdown into the existing service. Read only lightweight projections and close every source connection. Prioritize removals; stable tooltips avoid spending host quota on every measured increment.
- [ ] Extend the real child-service fixture with an authenticated SDK callback and verify set/remove wire calls. Add phone-ready host metadata and exercise expanded replay/details and View steps at phone width. Update installation/permission/limit documentation.
- [ ] Run `npm run typecheck`, `npm test`, `npm run build`, `npm run test:ui` and relevant smoke checks. Request independent read-only validation of the complete diff; resolve verified findings and rerun affected checks.
- [ ] Inspect/stage explicit task files, commit `feat(openchamber): reconcile threshold session marks from the service`, and report hashes, checks, limitations and retained test-artifact location.

## Execution ledger

- Pre-flight: Task 2 produces `ThresholdMarkRecord`/`Store.marks`; Task 3 consumes exactly those interfaces. Task 1 provides the SDK and declared capability used by Task 3. No interface conflicts found.
- Ruling: Track the Windows inline execution ledger here rather than invoking Unix workspace scripts that would add unapproved scratch/ignore paths; all durable decisions remain in this committed plan. No product behavior changes.
- Baseline: 20 core/alerts/storage tests passed before product edits.
- Task 1: RED confirmed missing mobile opt-in and old host floor; a missing local SDK license was a fresh-worktree setup issue resolved by the approved install. GREEN: packaging 9/9, typecheck exit 0, full `npm test` 93/93. npm reports 24 moderate dependency advisories; no unrelated dependency fixes were attempted.
- Task 2: RED 7/7 expected failures for missing hits/projection API. GREEN: 38 focused tests, typecheck exit 0, full `npm test` 100/100. Task 1 committed as `f78958d`; Task 2 preserves notification behavior while adding current-turn-only indexed projections.
