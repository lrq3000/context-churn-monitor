# Context Monitor Reconnection Implementation Plan

> **For agentic workers:** Use `executing-plans` for inline implementation and one focused read-only final review. Resume from the ledger below; do not repeat completed work.

**Goal:** Restore the installed monitor after backend restarts and port changes without manual recurring pairing or replaying analysis requests.

**Architecture:** Keep the existing authenticated loopback transport. `Backend.start` already calls `listen(0, '127.0.0.1')`, so the OS atomically binds an available port. Persist the explicitly selected descriptor path with each pairing, normalize project keys, and reread/validate the descriptor and authenticated health identity before forwarding each request exactly once. A legacy snapshot-only pairing remains usable while healthy and receives an actionable re-pair message when stale; migration never guesses a descriptor path.

**Tech Stack:** Existing TypeScript, Node/Bun backend, native SQLite, OpenChamber service, Node test runner and Playwright. No dependency changes.

**Spec:** The approved repair preview in this session, including exact 0.1.2 metadata and installed refresh, and the user's requirement to tolerate occupied old ports and automatic free-port selection. This document records that small-change chat specification.

## Global constraints

- New worktree: `C:\Ai-Apps\MyGPTs\AGENTS-MD\.worktrees\context-monitor-fetch-fix`, branch `fix/context-monitor-fetch`; inline implementation plus one read-only reviewer.
- A pairing trusts only the user-selected descriptor file and matching project, with loopback URL and authenticated listener identity validation; no port scans or implicit unrelated-server discovery.
- Every forwarded request is attempted once. A failed POST has an uncertain outcome and must never be automatically replayed; polling can recover on its next independent GET.
- Package/UI/portable native versions and their metadata/lockfile/README mirrors advance once from `0.1.1` to `0.1.2`; creation remains `2026-11-03`, last_updated remains `2026-11-06`. Other artifact metadata is unchanged.
- Refresh the installed complete package at `C:\Users\33632\.config\opencode\plugins\context-churn-monitor`; preserve existing dependencies/configuration/data and retain backups/test artifacts under `C:\Users\33632\AppData\Local\Temp\opencode\context-churn-monitor`.
- Re-pair the previously affected project with its existing selected `f97fda81d81a51537150.backend.json` descriptor. The new worktree is a separate project; do not claim it shares the old project's history.

## Review focus

- Old port occupied by another process: use the newly published descriptor, never scan or forward to the stale listener.
- Restart between validation and forwarding: show failure and preserve one-attempt POST semantics; a later GET can recover.
- Equivalent Windows slash/case/trailing-separator project spellings: reuse one pairing while preserving POSIX case distinctions.
- Invalid, missing, malformed or wrong-project descriptor replacements: fail closed without falling back to cached credentials.
- Legacy pairing files and service reloads: retain healthy legacy compatibility, explain stale migration, and preserve the approved path across service construction.

## Task 1: Durable validated pairing

**Files:** modify `plugins/context-churn-monitor/src/gui/bridge.ts`, `tests/report.test.ts`, package `README.md`, the three release manifests and lockfile; update the root README catalog description for the changed runtime behavior.

**Interfaces:** preserve `Bridge.pair(directory: string, path: string): Promise<void>` and `Bridge.request(directory: string, path: string, method: string, data?: unknown): Promise<any>`. Persist a descriptor plus optional `descriptorPath`; accept older descriptor-only entries. Use platform-aware canonical project keys for lookup and identity comparison.

- [x] Add real-server regression tests for restart/occupied-old-port recovery across a reconstructed Bridge, equivalent Windows paths, rejected descriptor replacements, legacy stale-pair guidance, listener identity mismatch and a dropped POST response counted exactly once.
- [x] Run the focused `tests/report.test.ts` suite and observe the new recovery/validation assertions fail against the original bridge.
- [x] Implement the minimal bridge change with bounded descriptor reads, live identity validation and actionable errors. Do not change the existing free-port binding mechanism.
- [x] Run build/typecheck, unit, smoke and UI checks; verify metadata consistency and inspect the diff. Commit this coherent correction after checks pass.

## Task 2: Review and installed verification

- [x] Obtain one read-only fresh-context review of the branch, its tests and the five review-focus conditions. Verify findings; fix any material defects with regression evidence in the same review pass.
- [x] Back up changed installed files and pairings, copy the complete verified source/build unit while preserving dependencies and unrelated files, and validate focused file equality.
- [x] Reload only the extension service through supported host controls, re-pair the affected project and verify authenticated native snapshots/rendered metrics. Exercise restart/occupied-port behavior in isolated tests rather than restarting the user's active OpenCode response.
- [x] Record checks, artifact paths, installation evidence and limitations; commit final non-regenerable evidence and report local commits.

## Execution ledger

- Pre-flight: Task 2 consumes Task 1's built complete package and unchanged Bridge interfaces; no interface conflict.
- RED: five existing report tests passed and all six reconnection regressions failed for the expected snapshot-only pairing/identity/error defects. GREEN: all 11 report tests pass after the bridge implementation, including two restarts with old ports held by unrelated listeners and a dropped POST response observed exactly once.
- Task 1 checks: `npm run build`, `npm run typecheck`, `npm test` (35/35), `npm run test:smoke` (4/4), `npm run test:ui` (1/1), and `git diff --check` pass. Release/date mirrors verify as approved; lockfile dependency graph is unchanged. The first ad-hoc metadata check hit Windows' default cp1252 decoding; the corrected explicit UTF-8 read passes.
- Package quality-pass scope: changed bridge and tests, source manifests, hooks, schema/configuration, sole nested diagnostic skill, package README and root catalog. Generated bundles are build/runtime outputs; dependencies/caches and unrelated packages are excluded from source review. All seven existing metadata records retain their evidenced creation date; only coupled release mirrors advance to 0.1.2. The diagnostic trigger and instructions are unchanged and still distinguish report interpretation from installation or provider invocation.

- Investigation complete: installed snapshot-only pairings targeted `127.0.0.1:58555`; both slash/backslash keys reproduced `fetch failed` with `ECONNREFUSED`. The selected descriptor then pointed to a healthy listener at `127.0.0.1:50281`, returning authenticated HTTP 200 with matching identity. These ports are observations, not configuration constants.
- Approval: durable fix, exact metadata preview, isolated worktree, tests, one review, installed refresh/backup/re-pair and local commits approved. The user specifically requested robustness to occupied ports; the existing atomic OS-selected binding already provides allocation, while the new regression verifies discovery follows its changes.
- Setup: current main advanced to `6723f1d` (new codebase-onboarding skill and licenses) before worktree creation; the approved current-main base was used. Source code under this package remains the reviewed 0.1.1 implementation. `npm ci` succeeds with the existing 24 moderate transitive advisories.
- Ruling: use an explicit Git worktree path and the native `session_move` tool — the selected native creation surface does not expose an exact destination path, while the approved `.worktrees/` location is mandatory — cost if wrong: the session may need manual worktree association; native session movement succeeded.
- Ruling: keep this compact tracked plan/ledger as the single task record rather than generate duplicate shell-script workspaces — the user requires non-regenerable decision evidence committed and artifacts retained — cost if wrong: bookkeeping is manual rather than enforced by the skill helper scripts.

## Final review and installation evidence

- Task 1 complete in `5416e13ecac11a439848968897dad9a4782b12b5`. One independent read-only reviewer inspected `6723f1d..5416e13` and relevant integration files; verdict: approve with minor findings, no Critical or Important defects. No production changes followed that verified revision.
- Final: minor (deferred): settings/export action errors share the polling error element and can disappear after a successful poll (`src/gui/panel.ts:91–94,136–138`). Analysis errors remain separate and consent is unaffected. A later UI correction should keep action failures distinct from transient polling errors.
- Final: minor (deferred): regressions do not deterministically force restart in the exact interval between health validation and forwarding, and POSIX case distinction has no platform-specific assertion. Existing tests prove occupied-port discovery, listener identity rejection and dropped-POST no-replay; native service integration below adds runtime evidence but does not cover every race.
- Final: Ruling: the reviewer's deferred installation assessment is resolved by the approved native verification below — both selected pairings survive service reconstruction and the clean-browser panel renders live metrics and steps — cost if wrong: the existing-profile handshake issue may still prevent that profile from displaying the otherwise healthy service.
- Final: Ruling: retain the main agent's successful build/typecheck and 35/4/1 test evidence instead of rerunning it solely for the reviewer — source code did not change after those runs, and the reviewer was explicitly read-only — cost if wrong: a nondeterministic failure could be missed.
- Final: Ruling: keep generated bundles, dependencies, exhaustive unchanged-runtime behavior and external schema certification outside the focused source-review claim — builds, native catalog loading and byte comparisons validate the changed installation while historical host limitations remain documented — cost if wrong: an unrelated compatibility defect could remain undiscovered.
- Copied the verified complete source/build unit to `C:\Users\33632\.config\opencode\plugins\context-churn-monitor`. All 84 selected tracked/generated package files match byte-for-byte; 13 files differed from the installed 0.1.0 copy. Existing dependencies and unrelated configuration/data were preserved. Package/UI discovery now reports `context-churn-monitor`, version `0.1.2`, enabled, with its existing model/service grants.
- Backup retained at `C:\Users\33632\AppData\Local\Temp\opencode\context-churn-monitor\repair-backup-20261106-230448`: prior versions of all changed installed files, the original credential-bearing `gui-pairings.json`, and a non-secret `installation.json` copy manifest. Never publish the pairing backup.
- Native host controls were identified from the installed frontend: `PUT /api/guests/context-churn-monitor/enabled` with false then true reloads only this extension service. Requests use `POST /api/guests/context-churn-monitor/service/request` with SDK text bodies. Native catalog and service endpoints were reached at the observed local OpenChamber origin `http://127.0.0.1:57123`; that port is evidence, not a hardcoded package setting.
- Original affected project re-paired with its existing `f97fda81d81a51537150.backend.json`; snapshot returns HTTP 200 and 12 recorded turns for the monitored session. A separate explicit user approval then authorized pairing the new `context-monitor-fetch-fix` worktree with its verified healthy `71b2e4e58d701a8eb955.backend.json`. Both descriptor paths persist, and both slash-form project requests still return HTTP 200/live snapshots after a second extension-service reload.
- Native UI verification used the installed OpenChamber app and its real service, not the unit-test host fixture. Existing-profile Chrome still stalled at “Connecting to OpenChamber,” as observed before this repair; clean Chrome rendered the full right-side panel. The first row-wait attempt timed out; subsequent instrumented observation showed successful `/snapshot` and `/steps` responses, live growth `≥32.90 pp`, one compaction and recorded rows, with no page errors. The exact reason for that initial wait timeout was not established. These transient metrics are observations, not assertions about current values.
- Screenshot visually inspected: `C:\Users\33632\AppData\Local\Temp\opencode\context-churn-monitor\repair-native-verified-20261106.png`. Earlier inspection screenshots and all generated test artifacts remain under that same approved temporary directory. Verification launched installed Chrome headlessly through the package's existing Playwright dependency, navigated to the monitored session, opened the Context Churn Monitor toolbar entry, and observed the native iframe's metrics, rows and service responses. No model analysis was requested.
- Task 2 complete: focused review, backup/copy comparison, native catalog/service reload, original and separately approved repair-worktree pairing, persistence after reload, and rendered verification are recorded. Keep `fix/context-monitor-fetch` and its worktree locally; current approval does not include another merge, push or deletion.
