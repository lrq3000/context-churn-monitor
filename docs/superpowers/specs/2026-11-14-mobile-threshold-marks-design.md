# Mobile panel and latest-turn threshold marks

## Intent and approved behavior

Make the existing full Context Churn Monitor step-details panel available as a phone workspace tab. Indicate sessions whose latest turn, including a live turn, reached an existing eligible growth or compaction threshold. Marks are independent of warning delivery, cooldown and rearm suppression, retain the model-window eligibility filter, and reset when a new turn starts.

## Approaches

Use the native `panel.mobile`, `contributes.marks` and service-host APIs. Notification-history-derived marks cannot represent suppressed threshold hits. Panel-driven updates cannot keep closed sessions current. A separate mobile page duplicates the existing responsive panel without adding a required capability. The approved approach is a persistent service rebuilding native marks from small stored threshold projections.

## Design

Both installation manifests set `panel.mobile: true`, `marks: true` and `service.keepRunning: true`. Pin SDK 2.7.1 and require OpenChamber >=2.7.1. Reuse the existing full panel and View steps navigation; add no page contribution. A session mark uses the `pulse` Remixicon, warning tone, and a plain-text tooltip naming its turn and reached thresholds. Clicking uses the host's existing panel navigation, including on mobile.

Record up to four threshold hits (growth/compactions, live/EMA) on the alert policy's current turn, before notification suppression. Reuse eligible-turn EMAs and their minimum-sample rule, capturing a mark's EMA hits only after this turn contributes its completed sample. Hits remain for that turn, but an ineligible turn has no mark; the next explicit turn clears prior hits. Persist a small indexed per-session projection transactionally with ingestion, separate from the bounded notification history. Retain empty-hit clear states with update times so an older location cannot resurrect a moved session's mark. Observed native session deletions write mark-only tombstones, preserving replay and blocking delayed events/older copies; offline deletions are not reconstructed. Existing stored sessions without the projection become eligible for marks on subsequent monitoring updates; do not reconstruct old thresholds from notification events.

The GUI service reads registered source projections through short-lived read-only SQLite connections, without transcripts or backend listeners. Keyset-page positive candidates and validate their latest state across available sources with indexed session lookups, retaining only 200 candidates in memory. Reconcile on startup and periodically, retain at most the newest 200 session marks, clear obsolete marks before adding replacements, and rate-limit changed host calls to 60 per rolling minute. Deduplicate unchanged state, coalesce pending changes, track uncertain callback targets even when no success was acknowledged, retry failures on later polls, and stop timers on service shutdown. Unreadable sources must not masquerade as a successful healthy scan; remove their unverified marks rather than indefinitely presenting stale turn status.

## Constraints and non-goals

Preserve ordinary metrics, notification delivery, cooldown/rearm behavior, analysis authorization and the panel's desktop behavior. Add no paid model calls, external services, new session-control permissions, live installation changes, release publication, push or deletion. Work only in `.worktrees/mobile-threshold-marks` on `feat/mobile-threshold-marks`. Keep additive storage changes compatible with legacy databases. Host-imposed limits can delay updates during bursts; marks are not an instantaneous or exhaustive alert-delivery record.

## Verification

Test both native manifests and their marks approval, mobile panel rendering/navigation, inclusive live/EMA thresholds, warmup, suppression independence, eligibility, resets, persistence/restart, legacy databases, source failures, deduplication, host errors and rolling rate/capacity limits. Run typechecking, focused tests, the normal suite, build and browser fixtures. An independent read-only reviewer checks the finished diff. Generated artifacts remain in the approved temporary directory; completed milestones are committed locally.

## Contract evidence

Consulted the OpenChamber SDK documentation and published SDK 2.7.1 declarations on 2026-11-13: https://docs.openchamber.dev/sdk/ and https://docs.openchamber.dev/sdk/host/. `createServiceHost({ env }).setMark({ sessionId }, { icon, tone, text })` sets a mark, and `null` removes it. The SDK specifies at most 200 marks, 60 changed calls per minute and 200 tooltip characters. The current documentation confirms mobile panel opt-in and native mark-to-panel navigation.
