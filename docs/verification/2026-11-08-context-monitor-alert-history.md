# Context Monitor 0.3.0: global alert controls and history

## Scope and current outcome

Keep the existing growth-in-percentage-points and compaction metrics. Add globally shared current-turn/EMA thresholds, an inclusive minimum model context window defaulting to 32000 tokens, and a global newest-100 threshold-event history with explicit **Go to the session**. Small/unknown/mixed turns remain monitored but are excluded from filtered alert averages and subsequent detection while the minimum is enabled. Zero disables filtering. Old alpha history import is waived; newly committed events require crash recovery without uncertain notification resend.

Implementation and the one independent final review/correction pass are complete. Installed 0.3.0 is hash-verified and automatically discovered. The user approved `sessions` in OpenChamber; actual cross-project navigation is verified by URL and replacement SDK session identity. The native verifier's separate console-health assertion remains **failed** on two host `WorkerPoolManager` initialization timeouts; navigation success is recorded independently rather than calling the entire native run clean. No capability grant was automated.

## Local milestones

- `9872718`: approved design and implementation plan.
- `16e792b`: model-window eligibility with separate eligible-only alert state.
- `2c7b85f`: shared SQLite settings/history, transactional bounded source outboxes and idempotent recovery.
- `1137532`: global GUI controls/history and native session navigation contract.
- `cb04f97`: approved 0.3.0 release mirrors, documentation and explicitly gated installed QA runner.
- `1e38128`: regression-backed independent-review corrections.

All feature changes remain local on `feat/context-monitor-alert-history`; no merge or push of this feature is approved or performed. The preceding 0.2.1 notification fix was already squash-merged/pushed separately as main `1bb7822`.

## Verification

- Six initial eligibility regressions observed RED→GREEN; ordinary accounting, mixed models and eligible-only EMA/recovery covered.
- SQLite tests cover reopening before transfer, replay after global commit before acknowledgement, separate delivery claims, settings across handles, independent process writers, physical global/source latest-100 caps, unavailable sources and runtime/GUI transfer races.
- Global service regression observed RED on `Select a project first`, then GREEN with authenticated global routes before directory/pairing validation.
- Chrome tests cover real SDK text-body transport, no-project global access, escaped cross-project rows, select-without-navigation, explicit navigation, permission feedback, stable selection, eviction, initial-load safety and existing replay/action isolation.
- Independent reviewer `ses_e46c6e282ffecoTkCKhzD12sBp` found three Important issues and two Minor issues. Verified and fixed implicit-completion alert loss, stale retention during awaited sends and lost navigation failures after eviction. Regraded unbounded local model labels as Important because bounded recovery payloads are required; capture now truncates model labels to 500 characters without changing navigation identities. All four corrected cases have RED→GREEN regressions. Desktop EMA wording remains the sole deferred minor: `(ema)` does not itself spell out eligible-turn scope/units; the GUI and README explain that scope.
- Final correction checks: build/typecheck passed; **72/72 unit tests**, **4/4 isolated native smoke tests** (one CLI and three OpenCode protocols), **11/11 Chrome checks**, QA-runner syntax and `git diff --check` passed. No paid provider or native Small Model generation was invoked.
- Desktop/mobile rendered checks use 720px/390px viewports and real Chrome with an external-host fixture, not native session-opening proof. Generated screenshot/log evidence stays outside the repository. The separate Browser plugin/`browser` skill is unavailable; the existing approved Playwright workflow was reused without installing another browser tool.

## Installed evidence

- Destination: `C:\Users\33632\.config\opencode\plugins\context-churn-monitor`.
- Pre-refresh installed tracked sources exactly matched baseline main `1bb7822`; locked dependencies matched and were reused. Full 0.2.1 backup retained at `C:\Users\33632\AppData\Local\Temp\opencode\context-churn-monitor\alerts-20261108\installed-0.2.1-043650` (19,451 files). The optional full dependency-backup hashing sweep timed out after 120 seconds; complete backup hashing is not claimed.
- All **127 non-dependency source/build files** copied and verified by SHA-256 against revision `1e381286f654733c22432a3c778b734bcaf34a79`. No files, old databases or artifacts were deleted.
- Automatic backend watch reload changed the current project's identity from `a12821b5-ed9e-46fe-b83e-3598603745a5` / port 56951 to `b247ccfc-792d-46fc-85a3-52cbc06701b4` / port 50716. Authenticated health returned 200 with the correct directory/instance. No global reload or configuration edit was needed.
- Actual OpenChamber at `http://127.0.0.1:57123` discovers enabled version 0.3.0 at revision 4. Its managed OpenCode is port 61824; the unrelated CLI default is 28894. Existing `model`/`service` grants remain. The host initially withheld the toolbar with **Needs approval → Review permissions**; after the user's explicit confirmation, the actual guest catalog reports `sessions`, `model` and `service` granted.
- Pairing-file SHA-256 remained `877efa415ef011b8302fd6abf88211d81d3ac0ca54d44d8ed5fbc06edc6bb43f`; no new pairing or grant was written.
- Installed `installed-alerts.mjs --record` used the actual installed reducer/outbox with a separate retained QA source to recover one **TEST: Native alert history (synthetic crossing)** into real global history. The record has growth 90 pp, threshold 80 pp, model window 128000 and the target session `ses_e630ddf29ffesffB3HGwRMIxdu`. This is synthetic QA, not a claim that the real conversation crossed a threshold. No real session accounting/settings changed; no notification was sent and no model was invoked. Record identity/evidence is retained in `installed-alert-history.json`.

## Native navigation and remaining limits

Installed native QA starts on `ses_e47224e5affe7kmg2JUcnA0B0V` in `context-monitor-notifications`, selects the retained synthetic history entry, clicks **Go to the session**, and reaches `ses_e630ddf29ffesffB3HGwRMIxdu` in `context-monitor-alert-history`. The final actual URL is `http://127.0.0.1:57123/?session=ses_e630ddf29ffesffB3HGwRMIxdu`; a replacement native guest receives that exact session through the SDK. Evidence records `navigationVerified: true` and `sdkSessionVerified: true`. Before/after screenshots were inspected and show the selected history entry in the other worktree followed by the correct target thread. This is genuine native navigation, not only host-fixture evidence.

The host unmounts guest frames while switching projects and loading a large conversation. The native verifier now waits for the actual route, allows up to 120 seconds for host loading, and checks replacement guest frames rather than a source-frame locator that can retarget an unrelated loading status frame. Failed exploratory runs and bounded navigation diagnostics remain retained; the QA procedure is committed rather than hidden in temporary snippets.

The last native verifier run fails its separate strict `errors === []` assertion because the surrounding OpenChamber page emits `WorkerPoolManager: worker initialization timed out after 10000ms` twice. Navigation assertions completed first and their evidence was persisted. That string is present in the installed host asset `web-dist/assets/index-BaQtYnl3.js` and absent from this plugin's TypeScript/QA sources. No host modification, global reload, worker workaround or suppressed-error assertion was introduced. This is an explicitly unresolved host-console-health limitation, not a failed navigation assertion or a claim of complete console cleanliness.

OS display/reading and notification-click behavior are not retested here; the earlier 0.2.1 click fix is user-confirmed. Native modern Codex hook activation remains unverified on the installed legacy CLI. Tests exercise concrete SQLite/process/reopen boundaries, not exhaustive power-loss or lock-duration failure modes. The latest-100 cap does not prune activity replay or exports. Recovery never reconstructs offline/old-alpha events or automatically resends an uncertain notification.

All backup, QA SQLite, screenshots, profiles and logs remain under the approved temporary context-monitor root, chiefly `alerts-20261108/`, `ui-sZiiqp/` and `ui-d0c53Y/`. The plan's ledger records every ruling and review limitation: `docs/superpowers/plans/2026-11-08-context-monitor-alert-history.md`.
