# Context Churn Monitor

Portable deterministic context-growth and compaction monitoring for OpenCode V2 and modern Codex hooks, with an optional separately installed OpenChamber report interface. Monitoring, warnings, filtering and exports make no model calls. Optional analysis requires a frozen preview and single-use explicit consent.

## Installation units and runtime status

| Unit | Source | Requirements and evidence |
| --- | --- | --- |
| OpenCode backend | This complete directory; `package.json` exports `dist/adapters/opencode/index.js` | OpenCode V2; native loading, real lifecycle events and bounded local-provider generation tested on 2.2.1 against plugin SDK 2.2.5. |
| Codex backend | This complete built directory; root `plugin.json` and `hooks/hooks.json` | A Codex version supporting the documented `PreModelRequest`, `PostModelRequest`, `PostCompact` and turn hooks. Installed CLI 0.63.0 is too old; fixtures and CLI stdin are tested, native hook activation is unverified. |
| OpenChamber UI | Complete built `openchamber/` directory | Manifest targets OpenChamber ≥1.24.0; validated with SDK 2.6.0. Native installation, capability grants, pairing and rendered metrics/rows verified on OpenChamber 2.5.3. Real Chrome interaction tests validate the SDK wire contract through a postMessage host fixture. |
| Portable diagnostic skill | `skills/context-churn-diagnostics/` | Instruction-only; can be installed independently. Does not activate hooks or collect metrics. |

Build the backend before registering it. Node ≥22.13 is declared; development/runtime tests used Node 24.12.0. SQLite is `node:sqlite` in the CLI and `bun:sqlite` in OpenCode, with no native npm addon.

```sh
npm ci
npm run build
```

### OpenCode V2

Merge this entry into the desired user-wide or project-local `opencode.json(c)`, preserving unrelated configuration. Replace the absolute path; forward slashes work in Windows JSON. Installation into an everyday profile is a separate explicit action.

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "plugins": [{
    "package": "/ABSOLUTE/REPO/plugins/context-churn-monitor",
    "options": {
      "dataDir": "/ABSOLUTE/PRIVATE/context-monitor",
      "analysisModel": "provider/model",
      "monitor": { "span": 5, "lookback": 5, "warnings": true }
    }
  }]
}
```

`analysisModel` is optional; omit it if only session-model or OpenChamber analysis is wanted. V2 reloads configuration; `/reload` forces reload when needed. Plugin setup is location-scoped and lazy until a session initializes. Check the host's plugin listing and a new session before concluding that discovery failed.

Default data directory: `CONTEXT_MONITOR_DATA`, otherwise `~/.local/share/context-churn-monitor`. Each project directory gets a SHA-256-derived database name and `<hash>.backend.json`. The descriptor identifies this listener instance and contains its bearer secret. On startup, the OS atomically selects and binds a free loopback port (`listen(0)`), then the backend publishes its current address and identity to that descriptor. An occupied old port does not prevent startup on another port.

### Codex

Use the host's supported local-plugin installation for the **built complete package**. `plugin.json` declares the Agent Plugins 1.0.0 schema and `extensions.com.openai.hooks`; portable hosts discover the diagnostic skill from the fixed root `skills/` directory. The portable schema rejects the legacy top-level `skills` field. Do not install a remote source snapshot that lacks `dist/`; build it first and retain the complete package in the consumer's local marketplace. See the repository installation guide for local marketplace rules. Installing the skill alone does not register hooks.

Supply `CONTEXT_MONITOR_MODEL_WINDOWS` as a JSON object mapping the actual hook model ID to its context capacity, for example `{"my-model":128000}`. Unknown windows keep occupancy unavailable. `CONTEXT_MONITOR_DATA` overrides `PLUGIN_DATA`, otherwise data defaults to `~/.local/share/context-churn-monitor/codex`. Use the same data directory for hooks and the report process:

```sh
node /ABSOLUTE/REPO/plugins/context-churn-monitor/dist/cli.js serve
```

Run `serve` in the project directory to be paired. It prints the descriptor path and serves stored sessions; hooks themselves are short-lived and do not start a listener. Per-session settings can be changed through the paired UI/backend. Codex has no verified tools-free configured/session-model generation API here; choose OpenChamber Small Model or export the evidence for an explicitly requested external analysis.

### OpenChamber

After building, install the complete `openchamber/` folder through Settings → Extensions using the host's local extension workflow. It contains `package.json`, `panel/index.html`, bundled `panel/app.js`, and `service.cjs`; it is independent of the backend package and needs no npm dependencies at runtime. Approve the declared local service and model capability through the host's ordinary extension controls.

The extension's `package.json` keeps `name` and `version` at the top level and nests `apiVersion`, `engines` and `contributes` inside `openchamber`. The native installer requires the package version returned by `parseManifestJson`; an unwrapped manifest can pass inner-manifest validation but still be rejected with the generic “package.json is invalid. panel.id must be kebab-case” message.

The SDK service bridge transports request and response bodies as text. The panel JSON-encodes outgoing data and decodes returned bodies at that boundary. The Chrome regression validates requests with the SDK's `parseGuestMessage` and returns text responses so an object-only host fixture cannot hide native transport failures.

Open **Context Churn Monitor** from the right-hand toolbar, expand **Connect monitoring backend**, enter the absolute descriptor path for the active project, and select **Pair backend**. The service validates loopback origin, project directory, credentials and instance identity. Pairing credentials remain in the service's `~/.local/share/context-churn-monitor/gui-pairings.json`, not in the iframe or conversation.

Release 0.1.2 retains that explicitly selected descriptor path across service reloads. Before each request, it rereads the bounded descriptor and checks the authenticated listener identity, following backend restarts and port changes automatically. Equivalent Windows project case/slash spellings share a pairing; POSIX project case remains significant. Missing, malformed, oversized or wrong-project replacements fail closed rather than using cached credentials or scanning ports. Once the backend is available again, the next independent panel poll reconnects. Failed POST requests are never replayed; a lost response reports an unknown outcome so that analysis still requires fresh explicit consent.

Older snapshot-only pairings work while their original backend is healthy. If an upgraded installation reports **Legacy pairing**, use **Pair backend** once with the current descriptor to store its path. Future backend restarts then reconnect automatically. If you move the descriptor itself or change the backend data directory, explicitly pair its new path.

The **Context Churn Monitor** panel displays the full monitoring interface on the right, beside the central conversation and prompt input. Its `panel.entry` provides this native side panel; no `page` contribution is declared, so it adds no full-page shortcut to the left sidebar. The status frame follows the active session, shows live and completed-turn metrics and provides **View steps**, which opens the same right-hand panel. The status source API cannot provide active-session identity, so this extension intentionally uses the supported status frame and native header controls.

After replacing a folder installation, reload its OpenChamber extension service and window to refresh cached code, names and entry points. A backend restart at the same paired descriptor path needs no further pairing.

## Accounting and settings

A **turn** is one user interaction and all model **steps** needed to finish its reply. A step is one model request attempt, not a tool call. Queued-but-undelivered input is not a turn; synthetic continuation stays in the current turn. Known synthetic-only activity before any user boundary is excluded. OpenCode physical HTTP retries reconcile into separate rows when their logical step completes, retaining HTTP status and failed-attempt gaps; only the final attempt receives reported occupancy. Pending transport detail is not crash-durable before that reconciliation. WebSocket `response.create` capture is implemented but not native-runtime verified. OpenCode child sessions have separate session IDs; Codex `agent_id` creates separate child accounting.

Growth is the sum of positive differences between comparable occupancy observations, expressed in **percentage points (pp)** of the model's window. At 30%→50%, compact/rebase, then another 20 pp, accumulated known growth is 40 pp. The compaction drop and replacement history are excluded. Model, capacity and measurement-method changes rebase. Successfully applied checkpoints count once when stable identity is supplied; manual and automatic counts remain distinct.

OpenCode request occupancy is `input + cache.read + cache.write`; output/reasoning usage is not assumed retained. The host normalizes missing usage to zero, so an all-zero input sum is conservatively unavailable; a labelled JSON UTF-8/4 estimate may be used. Codex `input_tokens` already includes its cached subset. Final retained output and unobserved pre-compaction output are coverage gaps, so reported growth is usually a **partial lower bound**. Measurement method/estimate provenance is stored independently of coverage: partial estimates display `~`, not a factual `≥` bound. Older partial records with missing provenance are labelled accordingly. A missing measurement is `—`, never a reassuring zero.

| Setting | Default | Meaning |
| --- | --- | --- |
| `span`, `minSamples` | 5, 3 | Completed-turn EMA uses `alpha = 2/(span+1)`; minimum samples for EMA warnings. |
| `growthThreshold`, `compactionThreshold` | 40 pp, 0.30 | Separate completed-turn warning thresholds. |
| `liveGrowth`, `liveCompactions` | 80 pp, 2 | Independent within-turn warning thresholds. |
| `cooldownTurns` | 5 | Minimum completed-turn distance between warnings per metric. |
| `rearmTurns`, `rearmRatio` | 2, 0.8 | Each metric rearms after two trustworthy completed measurements below 80% of threshold. Missing/partial growth cannot prove recovery. |
| `warnings` | true | Disables warning delivery without disabling measurements. |
| `lookback` | 5 turns | Analysis range, independent of EMA span and history retention. |
| `inputBudget`, `outputBudget` | 12000, 3000 | Analysis allowances, further restricted by known host/model limits. |

See [`config.schema.json`](config.schema.json) for the `monitor` settings object. GUI settings are persisted per session and override plugin defaults. Span changes affect subsequent EMA updates; existing samples are not replayed. Reopening the latest completed turn replaces its EMA contribution rather than adding another sample.

## Reports, storage and analysis

The panel offers all/current/recent scopes, chronological/largest-growth order, blue growth shading, green checkpoint counts, expandable evidence and 50-row pages. **Export HTML** creates the standalone **Steps Diagnostics** report, with that name in both its browser title and heading. HTML/JSON export includes **all recorded steps**, independent of analysis lookback. A worker streams indexed keyset pages from a separate read-only WAL snapshot, keeping monitoring writes and the host event loop available. Exports are saved under the backend data directory's `exports/`; filenames are shown in the UI. HTML escapes untrusted evidence and supports local sorting.

SQLite retains indexed turn/step metadata and event identities for all recorded history. Each step stores at most 32 tool records and 1000 characters per excerpt. The record-count limit creates an explicit gap; individual excerpt truncation currently has no marker. Excerpts and exports may contain private tool output. There is no automatic deletion/pruning, so disk use grows with recorded history. Polling reads cached snapshots/pages rather than the entire transcript. Native warnings persist in snapshots and log to the host; optional OpenChamber notification callbacks are best-effort and are not covered by the host-fixture UI test.

**Prepare analysis** freezes session, revision, turn bounds, selected model, budgets and quoted evidence. It makes no provider call. The preview defaults to asking for a model each time. The input allowance uses a conservative one-UTF-8-byte-per-token estimate plus 512 tokens reserved for the host envelope; it is not tokenizer-exact. Large-growth records are selected first and omitted evidence is disclosed. Consent expires after ten minutes and is consumed transactionally before invocation. Concurrent submission, reconnect, error or unknown outcome never automatically retries a consumed request.

Configured and session-model analysis runs outside session history via OpenCode's experimental generation API. A temporary model alias supplies the output request-body cap without changing the session model. Because native generation internally retries, a one-use loopback relay consumes its forwarding allowance before the first provider request and refuses subsequent attempts, even after a transport failure. Redirects are not followed. This route requires an explicit provider/model `settings.baseURL`; dynamic account endpoints are unsupported rather than guessed. Native OpenAI-compatible, OpenAI Responses and Anthropic runtime fields and HTTP-503 one-attempt behavior have outgoing-request verification using local protocol fixtures on OpenCode 2.2.1. Other runtimes reject bounded analysis. A provider remains responsible for honoring its protocol limit.

OpenChamber Small Model uses `host.generate` with `maxOutputTokens`. Consent permits one **host generation invocation** on this route. The host owns model selection/fallback and does not expose exact identity/context capacity or internal provider retries to the extension; the preview says so. The backend's one-provider-attempt relay cannot govern host-owned generation. Its SDK limits prompt size and output cap. Results remain in the report and SQLite, not in the monitored conversation. If the UI closes after consent, the durable job can remain `consumed` with an unknown outcome; a new request requires a new preview and consent.

## Verification and current limitations

```sh
npm run typecheck
npm test
npm run build
npm run test:smoke
npm run test:ui
```

Set `CONTEXT_MONITOR_TEST_TMP` to an existing test-artifact directory. Smoke uses an isolated OpenCode profile and a loopback fake provider; no paid provider call is needed. UI testing requires installed Chrome. Generated profiles, databases, exports, logs and desktop/mobile screenshots are retained for manual cleanup. The local service binds loopback and authenticates requests; never publish a backend descriptor or pairing file.

Native Codex hook activation (including Windows hook expansion and Stop-continuation identity), optional notifications and arbitrary third-party tokenizers/provider runtimes remain unverified. Native OpenChamber verification covers installation, service health, pairing and visible metrics/step rows; filter, sort, export and consent interactions are covered by the Chrome host-fixture regression rather than automated interaction inside the native sandboxed iframe. Paid-provider and native Small Model generation were not invoked. Monitoring starts at installation; it does not backfill older sessions. Stable Codex event IDs are not guaranteed: supplied IDs are deduplicated, otherwise each invocation gets a UUID and host redelivery cannot be distinguished from a genuinely repeated attempt. Events missed while the plugin is offline are not reconstructed. Model IDs and budgets are frozen, but provider/model definitions are not snapshotted: keep their configuration unchanged between preview and invocation and prepare new consent after configuration changes. Current model limits are rechecked before generation. Use provenance and coverage gaps when interpreting low metrics.

Contracts consulted in November 2026: [OpenCode V2 plugins](https://opencode.ai/v2/docs/build/plugins/server), [providers](https://opencode.ai/v2/docs/providers), [Codex hooks](https://learn.chatgpt.com/docs/hooks), [Codex plugin packaging](https://developers.openai.com/plugins/build/plugins), [OpenChamber SDK](https://docs.openchamber.dev/sdk/).

## Source version and date records

The backend package, portable manifest and independently installable UI share release version `0.1.2`. Their native versions and package-lock mirrors are synchronized. The diagnostic skill, settings schema and TypeScript configuration retain their own metadata at `1.0.0`; these values are artifact revisions, not host API or settings-schema versions. All seven source records use creation `2026-11-03` and last update `2026-11-06`. For each of `package.json`, `openchamber/package.json`, `plugin.json`, `config.schema.json`, `tsconfig.json`, `hooks/hooks.json` and `skills/context-churn-diagnostics/SKILL.md`, the creation date is the oldest credible filesystem birth/Git date after normalization to UTC. The compatible reconnection correction applies one patch increment from `0.1.1` to `0.1.2`; untouched artifact revisions and the same-day update dates are preserved.

The [portable manifest schema](https://agent-plugins.org/schemas/1.0.0/plugin.schema.json) rejects a root `metadata` property; arbitrary root metadata in the hook file is not an established host contract. The user-approved records for those two files therefore live here, outside their runtime configuration. The hook record was added on the recorded update date; hook commands themselves were not changed by this revision.

```json
{
  "plugin.json": { "metadata": { "version": "0.1.2", "creation": "2026-11-03", "last_updated": "2026-11-06" } },
  "hooks/hooks.json": { "metadata": { "version": "1.0.0", "creation": "2026-11-03", "last_updated": "2026-11-06" } }
}
```
