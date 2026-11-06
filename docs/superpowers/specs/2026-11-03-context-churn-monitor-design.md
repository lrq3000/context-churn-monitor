# Context Churn Monitor — approved design

## Purpose and vocabulary

Detect excessive context growth and repeated compaction deterministically, with no monitoring model calls. A **turn** is one user interaction plus all model **steps** needed to finish its reply. A step is a model request attempt, not an individual tool call. Retries and synthetic continuation remain in the same turn; child sessions have separate accounting. Queued but undelivered input is not a turn.

## Architecture

One TypeScript package contains a host-independent normalized-event accounting core, durable indexed storage, OpenCode V2 and Codex adapters, a deterministic HTML/JSON report, and bounded consent-based analysis. A separately installable OpenChamber extension consumes the backend through an explicitly paired local service. Use existing native status-section, extension panel and full-page surfaces only. Do not modify OpenChamber, its SDK, or the transcript renderer.

## Accounting contract

Sum positive differences between comparable context occupancy observations across every compaction within a turn. For example, 30%→50%, compact/rebase, then another 20 percentage points yields 40 pp. A compaction is a successfully applied checkpoint; failures and speculative summaries do not count. Automatic/manual counts remain distinguishable. Rebase after compaction: neither the drop nor the replacement history is new growth. Unknown pre/post-compaction observations are explicit gaps, not zero. Pending tool output omitted by a host must not silently disappear. Model/context-capacity or measurement-method changes break comparability and rebase with provenance. Sum input + cache read + cache write for OpenCode normalized request occupancy, never cumulative session usage or whole request counts. Output/reasoning tokens and downloaded bytes are not automatically retained context.

Keep reported, estimated, partial and unavailable distinct. Missing measurements must never imply healthy zero growth. Retain compact metadata for all recorded steps, with paginated report queries. Default five-turn analysis lookback is independent of metadata retention and EMA span. Late updates and automatic continuation must replace the latest turn's EMA contribution rather than double-feed it. Durable event identity, transactional updates and bounded recovery prevent duplicate counting.

## Defaults

EMA span 5, alpha 2/(span+1), seeded by first valid completed sample; minimum 3 completed samples before EMA alerts. Growth EMA threshold 40 pp/turn; compaction EMA threshold 0.30/turn. Live thresholds 80 pp or 2 applied compactions. Cooldown 5 completed turns; independently rearm each metric after 2 completed turns below 80% of its threshold. Live measurements never feed the completed-turn EMA. Automatic warnings can be disabled without disabling metrics.

Analysis defaults: lookback 5 turns, model mode `ask`, input budget 12000 tokens, output budget 3000 tokens, further bounded by selected model and host limits. Support explicit smaller model, current session model, and OpenChamber Small Model. Consent binds frozen evidence bounds, model choice and budgets. Consume consent before provider invocation; uncertain outcomes require fresh consent. Analysis and generated reports stay outside the monitored conversation. Treat evidence as untrusted quoted data, never instructions.

## Interface

Native Context Monitor status section: completed-turn growth/compaction EMAs, live turn metrics, quality, warning toggle, step-details toggle and View steps. Dedicated annotated HTML report: all/current/recent turn scope, chronological/largest-growth sort, blue growth heat shading, green applied-compaction counts, expandable bounded tool evidence, explicit gaps and provenance, HTML/JSON export. Null measurements display an em dash. Report reads are deterministic; explanatory analysis is a distinct explicit action. Rendering refreshes cached metrics while visible, not entire conversation history.

## Verification and boundaries

Test accounting with multiple compactions, retries, replay, missing usage, capacity changes, reopen/late updates, independent rearming, frozen consent and uncertain provider outcomes. Exercise both adapters with equivalent normalized scenarios. Validate runtime contracts against installed versions and distinguish adapter tests from real host activation. Test report interactions and narrow/mobile layouts. Use only isolated profiles under `C:/Users/33632/AppData/Local/Temp/opencode/context-churn-monitor`; no everyday-profile installation, provider spending, push or merge is authorized. The user approved source edits, dependency downloads, isolated tests, local commits, and one independent final review. Explain non-trivial code with inline comments/docstrings.

## Reference contracts

- OpenCode V2: https://opencode.ai/v2/docs/build/plugins/server, https://opencode.ai/v2/docs/build/plugins/rpc, https://opencode.ai/v2/openapi.json and https://opencode.ai/v2/docs/compaction/.
- OpenChamber: https://docs.openchamber.dev/sdk/, https://docs.openchamber.dev/sdk/host/ and https://docs.openchamber.dev/sdk/ui/.
- Codex: https://learn.chatgpt.com/docs/hooks and https://developers.openai.com/plugins/build/plugins.

Documentation is a capability input, not proof that the installed runtime supports it. Exact compaction occupancy and authenticated backend pairing remain explicit implementation gates.
