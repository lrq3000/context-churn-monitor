# Context Monitor 0.3.1 automatic backend connection

## Root cause and approved correction

The installed backend was healthy, had a matching descriptor and retained actual turn/activity data, but the GUI bridge rejected every request for a new worktree lacking a saved manual pairing. The native host returned HTTP 200 carrying service status 400 with `Pair this project with its backend descriptor first`. Three older worktrees were paired; this worktree was not. Hiding that error or manually pairing only this worktree would not fix recurring setup.

The user approved exact-project automatic registry discovery, preservation of manual overrides, release 0.3.1, installed backup/refresh, one independent final review, and squash integration/publication of main and `fix/context-monitor-pairing`. The user explicitly cancelled subsequent resource consolidation: descriptor/listener lifecycle remains per initialized project/worktree, not per thread or OS process per descriptor. A read-only snapshot found 39 descriptor files and four matching listeners owned by one OpenCode process; this is not a RAM/CPU attribution measurement.

The fix reuses the existing `alerts.sqlite` handle for indexed descriptor-path metadata. Backend startup publishes registration; GUI requests validate the exact normalized project, bounded descriptor, loopback address, bearer and live instance. Automatic connection never writes `gui-pairings.json`, scans ports/project trees or silently replaces an explicit manual choice. More than eight candidates or multiple healthy candidates require explicit selection; uncertain POSTs are never retried.

## Local milestones and review

- `0a856ea`: approved design/plan, baseline 72/72 tests.
- `f1c115d`: automatic registered connection, eight RED→GREEN regressions, actual child-service and native custom-root registration coverage.
- `0e63c87`: 0.3.1 mirrors, automatic/advanced-manual guidance, real-Bridge Chrome fixture and read-only installed QA procedure.
- `d0fba15`: independent-review corrections for publication ownership, rollback and relative custom data roots.

Independent reviewer `ses_e44ed9aacffeyxZrLAhiAfPKPF` reviewed `d1e6824..0e63c87`, independently ran 16 focused regressions plus five probes, and found two Important defects with no Critical or Minor findings. Same-path publishers could overwrite a healthy owner or strand an earlier descriptor after failed registration; relative custom roots could fail startup. Four new tests observed RED then GREEN: live duplicate rejection, concurrent same-path single ownership, exact prior descriptor/metadata rollback and relative-root publication. No second whole-branch review was dispatched.

Registered publication now serializes the synchronous compare/write/register phase in the existing SQLite store, probes ownership outside the transaction, rejects an active same-path owner or changed descriptor, and restores prior owned bytes on handled registration failure. Relative paths resolve using the same cwd semantics as prior publication; hashes and filenames remain unchanged. Shared bounded descriptor IO/validation avoids divergence from GUI validation. One fresh bounded HTTP startup probe avoids retired pooled-socket reset races without retrying an action or creating a persistent agent. Native Bun smoke starts from a retired descriptor and verifies replacement. Arbitrary legacy/external writers ignoring the shared-store coordination and exhaustive filesystem/power-loss recovery are not claimed race-proof.

The inherited authenticated-health protocol can send a retired bearer/instance header to a reused loopback listener before detecting mismatch. Tests prove no forwarded POST after mismatch, not zero retired-credential transmission; no live credential compromise is established. A new mutual-authentication protocol, pruning, stronger filesystem-identity equivalence and manual-reset UI are outside this correction.

## Verification

- Fresh build/typecheck passed.
- Full unit suite: **84/84** passed, including prior explicit/legacy pairing and dropped-POST checks.
- Isolated native smoke: **4/4** passed, including actual custom-root registration and Bun retired-descriptor startup.
- Real Chrome/SDK/Bridge/registry/backend checks: **12/12** passed. The added unpaired-project check renders actual 1.00 pp growth and activity, with no connection error or newly created pairing. Desktop 720px/mobile 390px screenshots inspected; no overflow or fixture page errors.
- Approved backend/portable/UI and lock mirrors are **0.3.1**, updated **2026-11-08**, creation **2026-11-03** preserved. Unchanged diagnostic skill/configuration records and requested host capabilities are preserved. Corrections remain one coherent release.
- Historical review probes/bootstrap are committed under `plugins/context-churn-monitor/tests/review/`; maintained corrected tests are in the normal suite. Generated outputs remain outside Git.

## Installed native proof

Full installed 0.3.0 backup: `C:\Users\33632\AppData\Local\Temp\opencode\context-churn-monitor\pairing-20261108\installed-0.3.0-131245`. A consistent read-only SQLite backup, pairing hash, original settings/history IDs and baseline native failure are retained alongside it. Installed tracked sources were checked against the baseline and the backup before refresh; matching locked dependencies were reused.

At `C:\Users\33632\.config\opencode\plugins\context-churn-monitor`, all **137** non-dependency source/build files match `d0fba15` by SHA-256; 39 changed/new files were copied, with new modules before entry points. Automatic watched reload changed the current backend from instance `03425bbf-7cb0-4eb4-aab1-6ad825dccea0` / port 55497 to `df139b87-4b80-42da-aa37-a9318b5ac353` / port 51015. Authenticated health returned 200, and the real shared registry contains the exact current-worktree descriptor path. No global restart/reload or manual pairing was used.

Actual OpenChamber at `http://127.0.0.1:57123` discovers enabled 0.3.1 with the existing sessions/model/service grants. The installed verifier opened `ses_e630ddf29ffesffB3HGwRMIxdu` in `context-monitor-pairing`, confirmed that project has no manual pairing, and required successful real service `/snapshot` and `/activities` responses. The rendered panel showed captured turn 1 with 55 steps, 50 returned/rendered activity rows, estimated partial current growth `~15.67 pp` and zero compactions. The connection error is absent. EMA values remain unavailable while the current captured turn is live; that is not a pairing failure.

The pairing file remained byte-identical, SHA-256 `877efa415ef011b8302fd6abf88211d81d3ac0ca54d44d8ed5fbc06edc6bb43f`. Existing alert settings and the prior history entry remain intact. Native screenshot was inspected. The host page still reports two pre-existing `WorkerPoolManager: worker initialization timed out after 10000ms` errors; these are recorded independently, not hidden or described as a clean whole-host console. The targeted connection/real-data assertions pass.

No model generation, message send, notification, new permission, manual-pairing write, data reset, descriptor pruning or worktree deletion was performed. Native modern Codex hook activation and unchanged provider/generation/notification internals retain their previously documented limits. The committed plan/spec contain all rulings. Publication is the final authorized step after this evidence commit; its exact main/fix refs and preservation proof are reported by the squash commit and remote verification.

Artifacts are retained under `...\context-churn-monitor\pairing-20261108\`, including `pre-refresh.json`, `global-before.sqlite`, `baseline-native-connection.json`, `installed-files.json`, `installed-discovery.json`, `installed-automatic-connection.json/png`, review probes/results and logs. Fixture screenshots remain in `...\context-churn-monitor\ui-bbytmw\` and the latest review-run UI directory. Nothing was deleted.
