# Context Monitor Activity Replay Implementation Plan

> **For agentic workers:** Use `executing-plans` for the approved native execution, with one independent whole-branch review. Steps use checkbox syntax; the ledger below is authoritative on resume.

**Goal:** Deliver the approved chronological replay with richer future capture and click-authorized Small Model analysis.

**Architecture:** Add separately indexed activity metadata and body storage beside request accounting. Reduce native events by stable activity identity, render lightweight paginated timelines, and reuse those records for snapshot exports and bounded analysis.

**Tech Stack:** Existing TypeScript, Node/Bun SQLite, OpenCode plugin SDK 2.2.5, OpenChamber SDK 2.6.0, Node tests and Playwright Chrome.

**Spec:** `docs/superpowers/specs/2026-11-07-context-monitor-replay-design.md`

## Global constraints

- Approved native implementation; fresh worktree `context-monitor-replay`, branch `feat/context-monitor-replay`, starting main `096d50bc09a2345e106051a8b87dd6f1c71f1947`.
- Forward-only `replay-v2/` stores, stable descriptors, inactive alpha records retained on disk, no historical import.
- Complete available text retained separately from bounded row metadata; accounting remains request-level and children remain separate.
- Default OpenChamber Small Model; exact Run label “Run analysis (1 model invocation)”; one single-use authorization per prepared job.
- Package/UI/portable version 0.2.0, diagnostic skill 1.1.0; changed metadata date 2026-11-07, creation 2026-11-03.
- Install and retain artifacts at the exact paths in the approved spec. Commit coherent milestones after their checks pass.

## Review focus

- A terminal event arriving after another request/turn must update its original activity, never the current turn’s metrics.
- Repeated final events and late stream fragments must neither duplicate content nor downgrade terminal status.
- Large text and long histories must not inflate every poll/state write or monopolize snapshot exports.
- A failed compaction remains visible without becoming an applied checkpoint or fabricating occupancy.
- Switching sessions or polling after an action failure must not expose stale evidence, erase action errors or authorize another generation.

## Task 1: Capture and storage

**Files:** new `src/core/activity.ts`, `src/storage/activities.ts`, `src/adapters/opencode/activity.ts`, `tests/activities.test.ts`; update `src/core/types.ts`, `src/storage/store.ts`, OpenCode adapter/index, Codex adapter and CLI under `plugins/context-churn-monitor/`.

**Interfaces:** `Store.activities` owns `ActivityStore`; `list(session, query)` returns lightweight `Activity[]` and cursor; `detail(session, id, offset?, limit?)` returns bounded textual body and continuation; `update(session, activity, body?)` upserts stable metadata. Native activity normalization is called within the existing event transaction after accounting admission. Activities carry `id`, `turnId`, `turnNumber`, `messageId`, `kind`, `title`, `status`, `at`, `ended` and order; stored text is independent of monitor state. Final event identity is deduplicated before updates. All data paths use the fresh storage namespace.

- [x] Write behavioral tests for mixed text/tool/compaction streams, duplicate terminal events, late completion, failure, full text beyond 1000 characters, more than 32 tools, pagination and isolation.
- [x] Run `node --import tsx --test tests/activities.test.ts` and verify the expected missing replay behavior.
- [x] Implement indexed metadata/body storage, lifecycle reduction and event subscriptions; keep accounting and body retention separate.
- [x] Run focused adapter/activity/storage tests, typecheck and package unit tests; commit the verified capture milestone.

## Task 2: Replay, API and exports

**Files:** new `src/reports/activity.ts`; update `src/reports/backend.ts`, `src/reports/view.ts`, `src/reports/html.ts`, `src/gui/panel.ts`, `src/gui/service.ts`, backend/report/UI tests.

**Interfaces:** authenticated `GET /activities` returns a filtered paginated replay with associated request records; `GET /activity` returns bounded body pages. Shared `activityRow`/request-header rendering uses escaped untrusted text. Existing `/snapshot` metrics and `/steps` accounting remain available. Export worker traverses stable activity keysets inside its existing read snapshot.

- [x] Add route/export assertions and Chrome interaction tests for readable rows, search, type/scope filters, expansion preservation, late failures, complete exports and no horizontal overflow.
- [x] Observe expected test failures, implement the approved timeline and shared styles, then verify focused checks and normal package tests.
- [x] Inspect desktop/mobile screenshots against the approved mockup and commit the verified UI/export milestone.

## Task 3: Analysis controls and evidence

**Files:** update `src/gui/analysis.ts`, `src/analysis/analysis.ts`, analysis/UI tests.

**Interfaces:** retain prepared job and claim APIs; the Run click sends `consent: true`. Evidence selects activity metadata and bounded text alongside accounting within the existing conservative byte allowance. Full capture does not imply sending all text to a model.

- [x] Add tests for default Small Model, no checkbox, prepare-without-generation, one click/one invocation, uncertain failure, session clearing, expiry and bounded richer evidence.
- [x] Watch failures, implement controls/evidence, run analysis and UI checks, and commit.

## Task 4: Release, review and installation

**Files:** package README/manifests/lockfile, diagnostic skill, root catalog and this ledger.

- [x] Align approved versions/dates and document capture/coverage/reset semantics.
- [x] Run build, typecheck, unit, smoke, UI and diff checks. Verify actual runtime event capture with a local provider fixture.
- [x] Perform one independent final code/plugin review; address material findings with regression evidence.
- [x] Back up installed files, copy the verified complete build, compare hashes, reload specific backend/extension through supported controls and verify native capture/rendering.
- [x] Commit final verification records; report commits, screenshots, installed paths and material limitations.

## Execution ledger

- Approval: user approved the full inline operational plan and installed refresh and selected Native implementation on 2026-11-07.
- Setup: new worktree created from main `096d50b`; session moved using the native `session_move` tool. `npm ci --no-audit --no-fund` installed 281 locked packages.
- Ruling: use the explicitly approved Git path plus native session movement rather than a native creator with unspecified placement; the previous worktree belongs to the completed repair. Cost if wrong: worktree association may need manual correction.
- Ruling: maintain this tracked plan/ledger rather than create separate shell-script bookkeeping; non-regenerable decisions must remain committed and temporary artifacts must be retained. Cost if wrong: progress tracking is manual.
- Pre-flight: Tasks 2 and 3 consume Task 1’s stable activities/body paging; Task 2 supplies routes and shared rendering, Task 3 retains the existing claim protocol. No incompatible interfaces found.
- Ruling: the approved interactive HTML mockup is the visual specification, so no paid Image Gen concept is needed. Browser/IAB plugin is absent; use the existing approved Playwright Chrome workflow. Cost if wrong: native host presentation still needs separate installed verification.
- Task 1: complete. Baseline 35/35 unit tests passed. Three initial replay assertions failed as expected; native payload/shell status and Codex shared-replay cases then failed and passed; restart-incomplete regression also failed then passed. Final package unit tests 41/41 and build passed, typecheck passed, and four real runtime smoke tests passed (including new native user/text lifecycle assertions and fresh-store location). First implementation commit contains this record.
- Native contract findings: inbox user text lives at `item.payload.text`; shell output is a bounded `output.output` page with truncation metadata; timeout/killed statuses can have no exit code. Capture preserves these distinctions and reports host truncation. Visible native reasoning has no guaranteed UI-summary field; deterministic text excerpts are used.
- Task 1 commit: `287da2d`.
- Task 2: complete. New route and export tests failed on missing endpoints/activity export; Chrome failed on missing activity rows. After implementation, 43/43 unit tests, build and the Chrome UI test passed. UI verifies global summary search, type/scope filtering, lazy text loading, expansion persistence, Expand/Collapse all and no mobile overflow. The export test checks 205 activities and >50,000-character untrusted text. Existing 200,000-request export concurrency and snapshot tests also pass.
- UI evidence inspected: `C:\Users\33632\AppData\Local\Temp\opencode\context-churn-monitor\ui-8nTCHX\desktop.png` and `mobile.png`. The activity rail, exact kinds, command prefixes, 18px outline icons, request band, subdued semantic colors and narrow-screen wrapping match the accepted component inventory. Existing metrics precede the timeline. Screenshot harness was then adjusted to expand the iframe height so subsequent evidence includes the entire analysis area.
- Ruling: chronological replay is the primary view; largest-growth sorting remains in exported request accounting rather than scrambling the timeline. The user-approved mockup is chronological. Cost if wrong: users need the accounting export for a global largest-growth order.
- Task 2 commit: `adbf514`.
- Task 3: complete. The richer-evidence test failed on missing activity titles and the Chrome assertion failed on the empty model default before implementation. Five focused analysis tests, build, updated Chrome test and full 44/44 unit suite passed. The double-click/uncertain-response scenario makes exactly one fixture host invocation; no real paid Small Model was invoked. Desktop/mobile screenshots inspected at `C:\Users\33632\AppData\Local\Temp\opencode\context-churn-monitor\ui-rwWlJm\`. Model-switch in-flight isolation remains a final review focus rather than a separately asserted UI scenario.
- Task 3 commit: `e51ddaa`.
- Release checks: 0.2.0 build/typecheck, four native runtime smoke tests and Chrome replay/analysis test passed; unit suite remains 44/44. Release mirrors and approved date/creation values checked programmatically. Latest screenshots: `C:\Users\33632\AppData\Local\Temp\opencode\context-churn-monitor\ui-A3tx5s\`. Documentation now describes fresh storage, capture limits, complete exports and click authorization; diagnostic skill is 1.1.0. Reference-only guidance changes are validated against the real API/UI checks and the final independent package review, without additional agent pressure-test runs.
- Release documentation commit: `5b51053`. Independent whole-branch/package review completed in `ses_e4c77e59fffeJBOJ3bOQugKLHY`, verdict With fixes: seven material findings (late request accounting, terminal-state revival, canonical body paging/NUL loss, retained Load more epochs, progress/attachment loss, stale action feedback, installed-QA false positive). One focused regression/fix pass is in progress; no second reviewer.
- Final: fixed late request accounting — `late request completion retains originating evidence without changing another request or its attempts` RED→GREEN. Request-bound model/estimate/attempt state and original-request evidence prevent a delayed completion from mutating the active turn. Repeated request terminals are deduplicated.
- Final: fixed terminal-state revival — `late stream fragments cannot revive interruptions or overwrite a completed shell` RED→GREEN. Canonical completion may replace interruption; late nonterminal events cannot revive or downgrade terminal activities.
- Final: fixed canonical paging/NUL loss — `body paging retains embedded NUL and Unicode across bounded canonical chunks` RED→GREEN. Canonical chunks are bounded at 16,000 code points, indexed and decoded before slicing; sequential exports no longer repeatedly traverse a single growing TEXT value.
- Final: fixed progress/attachment loss — `progress text and attachment descriptors survive canonical tool completion` RED→GREEN. Progress has its own retained channel; user files and tool attachments retain descriptors using the SDK `mime` property, without binary data.
- Capture review-fix verification: build/typecheck, full unit suite 48/48 and native smoke 4/4 passed. Native retry fixtures retain the 503 and 200 physical attempts.
- Ruling: late observations remain complete request evidence with an originating-request coverage gap rather than retrospectively recomputing historical growth/EMAs; the next observation rebases — the incremental store has no replayable accounting journal and applying old usage to new state is wrong — cost if wrong: some historical growth remains unavailable despite retained usage evidence. SDK hooks expose only session identity, so estimates/attempts bind to the observed active request at hook time.
- Final: minor (deferred): README export directory says `replay-v2/exports/`, whereas the backend writes to the descriptor root's `exports/`.
- Final: minor (deferred): streamed previews can lose whitespace between fragments until canonical completion.
- Review minor: installed runner initially selected the last iframe without independently establishing its session identity; corrected within the material installed-QA fix below.
- Final: Ruling: historical backfill/alpha compatibility and paid-model execution were declined by the reviewer — backfill is explicitly waived and paid invocation is not part of this implementation approval — cost if wrong: those behaviors remain unverified/unavailable, as documented.
- Installation preparation: complete installed 0.1.2 backup retained at `C:\Users\33632\AppData\Local\Temp\opencode\context-churn-monitor\replay-20261107\installed-0.1.2-020626` (19,431 files). Dependency locks match except the version, so installed dependencies can be reused. OpenChamber discovered installed 0.1.2 and the native panel; initial installed-runner check failed on old version as expected.
- Additional approval: user selected Connect this worktree through the rendered choice; use existing Pair backend control with `C:\Users\33632\.local\share\context-churn-monitor\bdd9088b8f3304a57f6a.backend.json`, preserving existing pairings. Actual host origin was `http://127.0.0.1:57123`; managed OpenCode port 61824, unrelated CLI default 28894. Prefer watched-directory reload before any global location reload.
- Capture review corrections committed as `991c1db`.
- Final: fixed retained Load more epochs — Chrome `Refresh retains a working Load more handler for an expanded completed activity` RED→GREEN (16,000 then 20,000 rendered characters after Refresh). Body handlers now bind to session identity independently of polling generations.
- Final: fixed stale action feedback — Chrome old-session success/error and older-success/newer-error cases RED→GREEN. Feedback and side-effect completion handlers are context/action scoped; Refresh does not clear an action error. Stale polling errors also cannot enter a newer context.
- Final: fixed installed-QA false positive — Chrome `installed QA rejects a loaded marker when the body request failed` RED→GREEN. The shared QA check requires successful retrieval and exact rendered response text and rejects Retry loading. Native runner validates the extension title, received SDK session and the actual service response for the selected activity.
- Review fix pass complete: build/typecheck, full unit suite 48/48, native smoke 4/4, Chrome UI including five nested regressions 6/6, and diff hygiene passed. Desktop/mobile screenshots inspected at `C:\Users\33632\AppData\Local\Temp\opencode\context-churn-monitor\ui-754l5X\`; readable rail, failure styling, Small Model default and narrow wrapping remain intact.
- Ruling: establish native frame/session identity as part of correcting the installed-QA false positive rather than leave that runner's minor identity ambiguity unresolved — successful evidence must belong to the requested session — cost if wrong: native QA may fail on a host wire/selector change rather than silently certify the wrong panel.
- UI/QA review corrections committed as `d384a4f`.
- Installation complete: copied and SHA-256-verified all 99 non-dependency source/build files from `d384a4f` into `C:\Users\33632\.config\opencode\plugins\context-churn-monitor`, reusing matching locked dependencies. The native file watcher reloaded the backend automatically: instance changed from `9f006b4f-537b-4492-a4a6-da063098694d` at port 60962 to `cf160aa5-465d-47d7-87a7-2209ce134bcb` at port 52112. OpenChamber discovered version 0.2.0, revision 2, enabled; no explicit broad location reload was necessary.
- Approved native Pair backend interaction added only the replay worktree; both earlier pairing records compared equal before/after. The descriptor path stayed unchanged. Fresh `replay-v2/bdd9088b8f3304a57f6a.sqlite` exists; legacy root databases remain on disk (19 observed at final inspection, including locations loaded since the original 17-file inventory).
- Installed native runner passed: correct SDK session `ses_e630ddf29ffesffB3HGwRMIxdu`, version 0.2.0, six newly captured activities at that check, successful authenticated body response and matching rendered text, Small Model default, disabled unprepared Run, no consent checkbox, no connection/page errors. Screenshot inspected at `C:\Users\33632\AppData\Local\Temp\opencode\context-churn-monitor\replay-20261107\installed-replay.png`.
- Additional live capture verification: native plugin inventory reports active; 18 activities then included thinking, tool and response records. `context-churn-diagnostics` was discovered and loaded from the refreshed installed package; its native tool record retained all 4,521 exposed characters including the new Run-button guidance. Fixture coverage remains broader than live coverage for compactions, interruption/retry edge cases, attachment variants and child sessions. Native paid Small Model generation remains uninvoked.
- Completion: keep `feat/context-monitor-replay` and its worktree, with local commits only. Backup and all temporary QA artifacts are retained for user cleanup. No merge, push or destructive cleanup is authorized or performed.
