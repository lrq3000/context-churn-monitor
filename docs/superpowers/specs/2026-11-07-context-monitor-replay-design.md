# Readable Context Monitor Activity Replay

## Intent and approval

The user approved the interactive “Readable activity replay preview” and then explicitly approved the implementation plan and installed refresh, selecting native implementation with one independent final reviewer on 2026-11-07. The monitor should resemble the main conversation at a glance: readable activity names and previews rather than call IDs and repeated boilerplate. This is a forward-only alpha redesign, not historical reconstruction or compatibility work.

## Capture and accounting

Capture delivered user input, visible reasoning/text segments, tool inputs/results/progress, patches, skill activation, direct shell activity, retries, compaction start/end/failure, interruptions and other exposed conversation updates. Stable identity, first-observed ordering, session/message association and terminal status must survive incremental updates and restart. Complete host-exposed textual input/output belongs in separate persisted bodies, not a bounded array inside every accounting snapshot. Binary attachments retain descriptive metadata rather than executing or fetching their contents. Completed canonical text replaces streamed fragments; redelivery must not duplicate content. Interrupted segments remain explicitly incomplete. Never invent hidden reasoning, missing events, summaries, durations or causal token attribution.

Model-request accounting stays independent: one activity is not one model invocation. Existing request observations, physical attempts, retries, quality/provenance, compaction counts and EMAs continue to be available. Associate activities with their originating assistant message rather than whichever request is active when a late result arrives. Failed compactions appear in the replay but do not increment applied checkpoints. Parent delegation/results stay in the parent; child activities retain their own session identity.

## UI and evidence

Implement the accepted compact timeline: request header bands with growth, an inset vertical activity rail, 18px outline icons, readable kind plus muted summary, durations when known, visible failures, expandable input/output and nested technical identifiers. Use existing host theme variables, approximately .82rem activity text, .74rem request headers, 5–6px radii and restrained blue/green/red semantic colors. Narrow views wrap summaries without horizontal overflow. Include search, type filter, Expand all, existing scope controls and pagination. Preserve expansion while polling. Share the growth/transport explanation once. Keep action errors visible independently of polling success. Use host titles where available, otherwise deterministic command/path/text prefixes; do not call a model for titles.

The inline mockup’s illustrative content is not production data. Existing monitor metrics/settings remain surrounding the replay. HTML/JSON exports include the recorded replay and accounting evidence from a consistent snapshot. Summaries and body pages are bounded for transport/UI; complete captured text remains available through paging/export. Escaping applies at every HTML boundary. Analysis remains budgeted, frozen and explicit about omissions.

## Analysis controls

Default to OpenChamber Small Model. Remove the consent checkbox. Prepare analysis freezes the preview without generation; “Run analysis (1 model invocation)” is the authorizing click. Keep durable single-use claiming, receipts, expiry, concurrent submission protection and no replay following uncertain outcomes. OpenChamber owns provider selection/fallback/internal retries, so one invocation must not be described as exactly one underlying provider request.

## Release, installation and reset

Implement on `feat/context-monitor-replay` in `C:\Ai-Apps\MyGPTs\AGENTS-MD\.worktrees\context-monitor-replay`, based on current main. Release package/UI/portable versions 0.2.0, diagnostic skill 1.1.0, changed records dated 2026-11-07 with creation 2026-11-03 preserved. Use fresh `replay-v2/` storage below each existing data root; keep descriptor paths stable. The 17 inspected alpha databases and old exports are inactive rollback artifacts, not imported. This resets active history, metrics, jobs and per-session settings without deleting old files.

Refresh `C:\Users\33632\.config\opencode\plugins\context-churn-monitor`, including its built OpenChamber extension. Backups and generated QA artifacts stay under `C:\Users\33632\AppData\Local\Temp\opencode\context-churn-monitor\replay-20261107`. Approval covers dependency installation from the existing lockfile, source/build edits, local commits, installed backup/copy, supported plugin/service reload and local fixture verification. Paid model analysis remains a separate explicit Run action. No merge or push is included.

## Validation

Test stable ordering, streaming/final deduplication, late results, concurrent sessions, interruptions, retries, compaction success/failure, large output retention, bounded pagination, export completeness, untrusted HTML and analysis single-use behavior. Exercise actual installed OpenCode with a local fake provider. Validate Chrome desktop/mobile controls and screenshots against the accepted mockup. Perform one independent final code/plugin review, then native installation/capture verification.
