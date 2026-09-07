# Pi Session Inspector v1 — Design Baseline Plan

## Context

Pi Session Inspector will be a deterministic, local-only observability extension for Pi sessions. Repository is empty (`main`, no commits); this planning effort must establish authoritative product/technical design, implementation sequence, proposed repository structure, and open-source contributor guidance without production code.

Constraints:

- Observe Pi execution; never alter prompts, tools, permissions, models, or control flow.
- Reuse Pi-native session data as source of truth; persist only non-reconstructable analyzer telemetry.
- No LLM analytics, cloud service, SQLite, daemon, mandatory Bun runtime, or Hermes implementation in v1.
- Telemetry failure must never break agent execution.
- Current-session workflow views default to active branch; historical resource views default to full tree.
- Planning phase permits Markdown only. Commit/push and non-Markdown scaffolding remain deferred.

## Approach

1. Research current authoritative Pi APIs/docs/source and relevant upstream extension projects.
2. Validate every major prompt assumption against available lifecycle, session, TUI, package, and ecosystem behavior.
3. Define minimum viable canonical model, storage/recovery design, integration observability matrix, UX, privacy model, compatibility policy, and measurable NFRs.
4. Write authoritative spec plus executable vertical-slice implementation plan.
5. Define repository layout, ADR set, contributor docs, CI/release process, and deferred scaffolding.
6. Submit this plan for review; after approval, materialize approved Markdown deliverables while respecting active planning restrictions.

## Files to modify

Planning phase:

- `PLAN.md` — evolving research record and review plan.

Approved documentation deliverables:

- `docs/research/pi-ecosystem.md`
- `docs/specs/pi-session-inspector-v1.md`
- `docs/plans/pi-session-inspector-v1-implementation.md`
- `docs/architecture/README.md`
- `docs/architecture/adr/README.md`
- `README.md`
- `CONTRIBUTING.md`
- `AGENTS.md`
- `SECURITY.md`
- `CODE_OF_CONDUCT.md` (only if adopted)
- `CHANGELOG.md` (only if chosen release policy needs it before first release)

Non-Markdown files such as `LICENSE`, package metadata, CI workflows, templates, and source/test directories are specified now but created during implementation, not planning.

## Reuse

Repository contains no reusable implementation yet. Research will identify reusable contracts and patterns from:

- installed/current Pi package docs, examples, type declarations, and source
- official Pi package ecosystem guidance
- `pi-subagents`, Context Mode, RTK optimizer, Caveman, Ponytail, Permission System, Lens
- overlapping Pi session analytics/tracing packages
- Hermes hook/plugin APIs for future adapter compatibility only

## Research findings captured so far

Baseline: npm `latest` is `@earendil-works/pi-coding-agent@0.85.1` (Node `>=22.19.0`), matching installed docs/types. v1 targets this latest stable API and records exact tested versions in fixtures.

Material assumption corrections:

- Pi has no single `LlmStarted`/`LlmFinished` extension pair. Provider-attempt starts are observable at `before_provider_request`; successful usage is durable on assistant messages. Runtime timing must correlate turn/message/provider events conservatively and label unavailable starts/ends rather than invent spans.
- Pi session v3 is an append-only entry tree with stable entry IDs and `parentId`; `getBranch()` gives active branch and `getEntries()` gives append-order full tree. `/tree` branches remain in one file; `/fork` and `/clone` create separate session files linked only by `parentSession` path.
- Session JSONL already preserves user/assistant/tool-result messages, provider/model per assistant generation, normalized usage/cost (including cache and current `reasoning` in observed data), stop/error state, tool-call IDs/results, model/thinking changes, compactions, branch summaries, labels, session info, and custom entries. It does not preserve accurate tool/provider wall time, all attempts/retries, permission resolution, or generic extension activity.
- Pi reliably identifies session entries and tool calls. It does not expose durable turn IDs, agent-run IDs, or branch IDs. Canonical IDs for those entities must be deterministic derived IDs, never presented as native Pi IDs.
- Pi's current `SessionManager` uses synchronous append/rewrite and assumes one process owns one session file; no cross-process append lock is present. Inspector must never add another writer to Pi files. Its own hot telemetry therefore needs per-writer shards.
- `pi.appendEntry()` is the correct durable tracking marker: native, branch-aware, excluded from model context, and recoverable if analyzer manifests vanish.
- `session_shutdown` is emitted on graceful paths, but cannot cover process kill/crash. `agent_settled` is a useful eager checkpoint boundary, never a correctness boundary.
- Pi's bus is process-local. Cross-process/subagent telemetry needs files or existing package-specific artifacts; a generic bus event alone cannot cross child processes.
- Loaded extensions are not fully enumerable from `ExtensionContext`. `getCommands()` and `getAllTools()` expose source metadata for registered commands/tools, but extensions with neither remain invisible. v1 must report partial evidence (`configured`, `resource observed`, `activity observed`, `self-announced`) rather than a false loaded count.
- Skill availability is discoverable; explicit `/skill:name` invocation can be recognized. Model-chosen skill use is only inferable from a matching `read`/`bash` of `SKILL.md`, so v1 labels it `observed load`, not semantic use.
- TUI supports full-screen `ctx.ui.custom()` components; overlay mode remains experimental. v1 should use full-screen custom UI, keeping business logic renderer-independent.
- Pi packages may ship TypeScript entrypoints loaded by Pi/Jiti. Manifest uses `keywords: ["pi-package"]`, `pi.extensions`, and `*` peer ranges for Pi-bundled packages. Published runtime needs Node 22.19+ because latest Pi does; Bun is unnecessary.

Integration evidence:

- `pi-subagents@0.66.0` already provides rich status/result fields, child session files, per-run `status.json`/`events.jsonl`, metadata with usage/model/cost/timing, in-process RPC, and nested child records. Consume its public RPC/artifacts and tool-result details; do not duplicate orchestration. Foreground and async artifacts differ, and bus events never cross child processes.
- Permission System `31.1.2` publishes stable best-effort `permissions:ready`, `permissions:ui_prompt`, and `permissions:decision` events with request IDs, result/resolution, surface/value, rule origin, agent, and forwarding context. Use these directly. Its tree-sitter Bash parser is internal, not a public classifier API.
- RTK optimizer `0.9.0` embeds exact compaction metadata (`rtkCompaction.originalCharCount`, `compactedCharCount`, lines, techniques, truncation) into final tool-result `details`, so output-compaction savings are passively reconstructable from Pi JSONL. Rewrite decisions/actual rewritten commands are not persisted and still require cooperative telemetry. Never scrape `/rtk stats` output.
- Context Mode has deterministically visible `ctx_*` tool calls, but its rich savings stats live in its own storage/tool output and no Pi event-bus telemetry contract was found. v1 reports adoption/tool usage; exact savings require cooperative telemetry.
- Ponytail persists `customType: "ponytail-mode"`; Caveman persists `customType: "caveman-level"`. Modes and changes are passively recoverable from Pi JSONL. `agent_start`/`agent_end` delimit active periods only while live telemetry exists.
- Lens `4.1.4` already publishes versioned `pilens:*` diagnostic/file/format/disposition bus events. Subscribe only to documented public payloads; raw tool-call counting remains available from Pi.
- Hermes now has observer-grade hooks for session, API request, tool, skill, approval, and subagent lifecycle with correlation IDs. Canonical session/generation/tool/agent/permission/skill events map cleanly, but Pi-specific branch/tree events remain optional capabilities. Hermes adapter stays future work.

Ecosystem correction:

- Existing packages already cover isolated/global usage (`pi-stats-ext`, `radian`, token stats), deterministic self-contained HTML (`@ygncode/pi-insights`), local tracing (`pi-trace-extension`), provider wire tracing, and OTEL/exporter dashboards. Inspector should not compete as another full-payload tracer or generic token chart. Its v1 distinction is branch-correct Pi-native reconstruction plus crash-safe cooperative integration telemetry, explicit observability confidence, subagent roll-up, and shared TUI/HTML/JSON analytics.
- Avoid patterns seen upstream: rescanning every session each command, storing full prompts/results, one unbounded `events.jsonl`, shutdown-required report generation, Python/browser-server runtime requirements, and claims of exact extension/skill use without evidence.

Authoritative source anchors, accessed for this plan on 2026-09-07:

- [Pi repository](https://github.com/earendil-works/pi), [coding-agent README](https://github.com/earendil-works/pi/tree/main/packages/coding-agent), [extensions](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/extensions.md), [session format](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/session.md), [TUI](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/tui.md), and [packages](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/packages.md) are navigation links only. Research deliverable must resolve every implementation claim to immutable npm version/tarball integrity plus commit-SHA permalink, exact file, symbol, and line range where available; moving `main` is not evidence.
- [pi-subagents](https://github.com/nicobailon/pi-subagents), [RTK optimizer](https://github.com/MasuRii/pi-rtk-optimizer), [Permission System](https://github.com/gotgenes/pi-packages/tree/main/packages/pi-permission-system), [Context Mode](https://github.com/mksglu/context-mode), [Pi Lens](https://github.com/apmantza/pi-lens), [Pi Caveman](https://github.com/jonjonrankin/pi-caveman), and [Ponytail](https://github.com/DietrichGebert/ponytail).
- [Hermes hooks](https://github.com/NousResearch/hermes-agent/blob/main/website/docs/user-guide/features/hooks.md), [plugins](https://github.com/NousResearch/hermes-agent/blob/main/website/docs/user-guide/features/plugins.md), and [observability contract](https://github.com/NousResearch/hermes-agent/blob/main/docs/observability/README.md).
- [npm trusted publishing](https://docs.npmjs.com/trusted-publishers/) and [GitHub OIDC](https://docs.github.com/en/actions/concepts/security/openid-connect) for release design. Unscoped npm name `pi-session-inspector` returned `E404` on 2026-09-07; availability must be rechecked immediately before first publish.

Immutable evidence manifest for architecture-dependent claims:

| Contract | Immutable source | Exact implementation surface |
| --- | --- | --- |
| Pi lifecycle/session/TUI/package | `@earendil-works/pi-coding-agent@0.85.1`, integrity `sha512-FGRN…L/oQ==`, commit [`d981de1`](https://github.com/earendil-works/pi/tree/d981de1229ef899957bbe968bc8dcda02a21f477) | `packages/coding-agent/src/core/extensions/types.ts` (`ExtensionAPI`, `ExtensionContext`, lifecycle event unions); `src/core/session-manager.ts` (`SessionManager`, entry append/rewrite/branch); `src/core/agent-session.ts` (event order); `docs/{extensions,session,tui,packages}.md` |
| pi-subagents lifecycle/artifacts | `pi-subagents@0.66.0`, integrity `sha512-PfvG…k0lw==`, commit [`0fc0eeb`](https://github.com/nicobailon/pi-subagents/tree/0fc0eebb9604970c506708b7508d6aa38921fde2) | `docs/extension-api.md`, `docs/observability.md`, `src/` RPC/status/artifact types, `index.ts` tool-result contract |
| Permission decisions | `@gotgenes/pi-permission-system@31.1.2`, integrity `sha512-T5ZL…II6GQ==`, commit [`085c241`](https://github.com/gotgenes/pi-packages/tree/085c24109e011f86f52c090ce57143153c6fe726/packages/pi-permission-system) | `src/service/permission-events.ts` (`permissions:ready`, `permissions:ui_prompt`, `permissions:decision`) |
| RTK compaction | `pi-rtk-optimizer@0.9.0`, integrity `sha512-yj5D…0Pug==`, commit [`d155d25`](https://github.com/MasuRii/pi-rtk-optimizer/tree/d155d253cb2f1358e34e717d47a82ebccb08cb8e) | `src/output-compactor.ts`, `src/output-metrics.ts`, `src/index.ts`; `rtkCompaction` tool-result details and non-persisted rewrite state |
| Context Mode visibility | `context-mode@1.0.169`, integrity `sha512-94JI…VnQ==`, tag commit [`589d821`](https://github.com/mksglu/context-mode/tree/589d8214d56740a28b5f7bf63167743d586b0b40) | package tool registration/build output and `skills/context-mode/SKILL.md`; no public Pi telemetry contract found |
| Lens telemetry | `pi-lens@4.1.4`, integrity `sha512-CVTj…RuNA==`, commit [`7a26192`](https://github.com/apmantza/pi-lens/tree/7a261926b8ec6aeaf473f1fdbff9d58cc8be0f68) | `docs/public-api-stability.md` and documented `pilens:*` payload sources |
| Caveman/Ponytail modes | `pi-caveman@1.0.8`, integrity `sha512-N0F/…GQw==`, commit [`eb48fc0`](https://github.com/jonjonrankin/pi-caveman/tree/eb48fc0204e6fda9d83da981913459ed5d0f8746); Ponytail commit [`974d940`](https://github.com/DietrichGebert/ponytail/tree/974d940a1c5344210874150b98ff0d2c861fab6a) | `extensions/caveman.ts` (`caveman-level`) and `pi-extension/index.js` (`ponytail-mode`) |
| Hermes future compatibility | commit [`94ff4fe`](https://github.com/NousResearch/hermes-agent/tree/94ff4fe8f969db6227adf3b8ab5c2a9cd0920295) | `website/docs/user-guide/features/{hooks,plugins}.md`, `docs/observability/README.md` |

Ellipsized integrity values aid scanning only; research doc must record full strings, source symbol/line ranges, retrieval date, and claim-to-source mapping. No implementation begins until that immutable matrix is complete and cross-checked against installed declarations/fixtures.

## Research questions

All 25 required questions from product prompt will receive source-backed answers in `docs/research/pi-ecosystem.md`. Findings distinguish documented guarantees, version-pinned implementation details, empirical behavior, unavailable data, and cooperative telemetry requirements.

## Recommended v1 scope

Ship one coherent local product, not another full-payload tracer:

- Pi latest stable only; persistent Pi sessions only for history/global views. Ephemeral `--no-session` sessions receive current in-memory inspection with explicit non-durable status.
- `/session-inspector` and `/session-ins` open current-session full-screen TUI, active branch by default.
- `history` opens tracked-session picker; `global` opens aggregate HTML by default; `ledger` deep-links current ledger.
- `--scope active|tree` and `--format tui|html|json` remain orthogonal. Historical billing/global defaults to `tree`; current workflow defaults to `active`.
- Current/history/global reports; deterministic JSON export; self-contained HTML without CDN/server; English catalog only, translation-ready for German/Russian in v1.x.
- Models, normalized usage/cost, generations, tools, errors, conservative shell command families, compactions, branch scope, agent/subagent roll-up, skill availability/observed loads, extension evidence, and chronological ledger.
- Minimal live WAL only for facts Pi cannot reconstruct: timings, permission decisions, cooperative telemetry, and incomplete operation boundaries.
- Passive v1 integrations: Context Mode tool adoption; RTK compaction details; Caveman/Ponytail mode entries; pi-subagents public artifacts/results; Permission System bus events. Lens richer diagnostic telemetry moves to v1.x; generic Lens tool calls remain visible in v1.
- Tracking marker, per-session manifest, per-writer WAL, incremental checkpoint/reconciliation, 14-day hot retention, sealed summaries, and lazy ledger materialization.
- Public process-local telemetry event contract v1. No claim of cross-process delivery; each process with Inspector loaded owns its shard. pi-subagents cross-process data comes from its public artifacts.

Defer to v1.x: German/Russian catalogs, richer charts, Lens-specific views, RTK rewrite telemetry after upstream cooperation, explicit metadata-index repair command, Markdown export, session comparison, configurable retention/redaction profiles.

Defer later: Hermes adapter, standalone integration SDK, database/index justified by benchmarks, performance-regression detection, semantic skill effectiveness, external telemetry/exporters.

## Architecture baseline

### Data flow and source precedence

```text
Pi JSONL ───────────────► PiHarnessAdapter ─┐
Pi live observer hooks ─► per-writer WAL ───┤
integration bus/artifacts ─► integrations ──┤
                                           ▼
                                  canonical records
                                           ▼
                              one deterministic reducer
                                  ├─ checkpoint
                                  ├─ report DTO
                                  └─ lazy ledger
                                           ▼
                                  TUI / HTML / JSON
```

Precedence prevents double counting:

1. Pi persisted usage is billing authority: assistant messages plus nested tool-result, compaction, and branch-summary usage exactly once.
2. Live WAL enriches duration/status only; it never replaces persisted token/cost facts.
3. Integration data enriches attribution and extension-specific metrics. Child usage breaks down the parent total but is never added to it again.
4. Checkpoints cache prior reduction. Source cursor mismatch makes them disposable and replayable.
5. Sealed checkpoints become canonical only for analyzer-owned telemetry whose raw WAL was safely expired; Pi files remain untouched and replayable.

### Canonical domain

Keep domain small: `Session`, `AgentRun`, `Generation`, `ToolExecution`, `BranchSelection`, `IntegrationObservation`, and `LedgerRecord`.

Canonical records use a discriminated union with common fields: schema version, record ID, harness, source kind, session ID, optional native entry/tool ID, optional agent/parent-agent IDs, wall timestamp, writer/sequence when applicable, category/action/phase, status, observability confidence, and bounded metadata.

Required event actions:

- session: `started`, `ended`, `tracking_started`
- input/agent/generation/tool: `started`, `finished`
- model: `changed`
- context/branch: `compacted`, `selected`
- skill: `available`, `explicitly_invoked`, `observed_loaded`
- integration: `state_changed`, `metric`
- permission: `prompted`, `decided`
- error: `observed`

Status: `attempted | blocked | running | succeeded | failed | interrupted | unknown`. Observability: `native | live | cooperative | inferred | unavailable | unsupported`. UI distinguishes zero from unavailable/unsupported.

Native IDs stay intact. Native record IDs are deterministic namespaced references; derived turn/agent IDs use stable source IDs and SHA-256 where needed. WAL event IDs use full `crypto.randomUUID()` values; ordering never depends on UUID shape. No UUID truncation.

Active scope is ancestor path to current leaf, intersected with append-order entries at/after earliest tracking marker. Full-tree scope is every append-order entry at/after marker. Branch position is a leaf/path, not a fabricated stable branch ID.

Cross-writer order: timestamp, then writer ID, then writer sequence, then event ID. Per-writer sequence is authoritative within a writer. Equal/clock-skewed events remain deterministic but UI marks cross-writer order as approximate.

### Observer-only Pi adapter

Register only observer seams needed for non-native facts: `session_start`, `session_info_changed`, `agent_start/end/settled`, `turn_start/end`, `message_end`, `tool_execution_start/end`, compaction/tree outcomes, model/thinking changes, and `session_shutdown`. Do not subscribe to mutation-capable hooks merely for convenience; never return event results, mutate payloads, inspect provider bodies, or retain raw args/results.

Historical replay parses session v3 incrementally and tolerates unknown entry/content fields. Capability checks isolate future Pi drift. Provider-attempt duration is best-effort because Pi lacks a durable request ID; never label it exact. Tool call ID is the reliable tool correlation key.

### Telemetry protocol v1

Bus channel: `pi-session-inspector:telemetry:v1`.

Envelope fields: `schemaVersion: 1`, `source`, `metric`, `value` (`finite number | boolean` only), optional `unit`, bounded primitive `dimensions`, optional producer timestamp, `kind: event | counter | gauge`, and optional attribution IDs. String states belong in low-cardinality dimensions, not arbitrary metric values. Inspector adds receive timestamp, event ID, writer ID, and sequence.

Normative limits are checked field-by-field before cloning/stringifying: encoded accepted envelope <=8 KiB; `source` <=64 UTF-8 bytes; `metric` <=96; `unit` <=24; at most 12 dimensions with keys <=48 and string values <=128; each attribution ID <=128; finite timestamp/number only. Identity keys (`source`, `metric`, `unit`, dimension keys) must match a conservative ASCII token grammar. Every accepted string—including source, metric, unit, dimension values, and attribution IDs—passes secret/payload redaction before cardinality accounting, aggregation, WAL, or diagnostics. Unknown top-level fields are ignored before sizing. Oversized/invalid envelopes are rejected whole with one rate-limited diagnostic containing reason/code only, never producer content; values are never truncated into colliding identities. Persist at most 256 distinct redacted dimension signatures per source+metric+session; further signatures increment one overflow counter without retaining values.

Guarantees:

- producer may emit through `pi.events` without runtime dependency or installed consumer
- delivery is process-local, best-effort, at-most-once as observed by one Inspector listener; no acknowledgement
- producer failures and consumer failures must be swallowed by their owner
- unsupported versions/invalid values are ignored with bounded local diagnostics
- source owns metric semantics; units are descriptive, not auto-converted
- unknown additive fields are ignored; existing fields remain compatible for v1
- dimensions must be low-cardinality and secret-free; Inspector still bounds and redacts before persistence
- counters with identical source/metric/unit/dimensions may coalesce within flush window; events never coalesce; gauges retain latest value per window

### Persistence and recovery

Root: `~/.pi/agent/session-inspector/v1/` resolved through Pi's agent-dir API, never hardcoded when an API exists.

```text
sessions/<full-session-id>/
  meta.json
  checkpoint.json
  maintenance.lease
  writers/
    <full-writer-id>.active
  wal/
    <full-writer-id>.jsonl
reports/                         # regenerable cache only
  <session-id>.html
  global.html
```

Tracking transaction: create session directory and pending manifest, append native `session-inspector:tracking-start` custom entry, then atomically promote `meta.json`. Earliest valid marker is boundary. Pending metadata lets history recover a crash between marker and manifest promotion. Complete analyzer-root loss requires explicit repair scan of Pi sessions; normal discovery lists small manifest directories only.

Each Inspector process generates one immutable cryptographically random writer ID with full `crypto.randomUUID()`. It claims `<writer-id>.active` by exclusive creation, retries on collision, starts sequence at 1, and never reuses a prior ID or PID as identity. Only that process opens its matching WAL shard with append semantics. Buffer up to 200 ms, 64 events, or 256 KiB; lifecycle boundaries request immediate write. Do not `fsync` per event. Queue cap: 1 MiB; shed coalescible metrics first, record dropped count when recovery permits, and disable the writer rather than block Pi if pressure persists. Target process-crash durability; sudden-power-loss durability is out of scope.

Checkpoint stores schema/package versions, source fingerprints, last Pi entry ID/byte offset, per-WAL byte/sequence cursors, aggregate state, per-day buckets, incomplete records, and updated/sealed metadata. Checkpoint/reconcile/retention—not WAL append—use one per-session maintenance lease acquired by atomic `mkdir`/exclusive create with owner PID, writer ID, and timestamp. A healthy owner wins; stale lease recovery requires dead PID plus age threshold. Lease holder rereads all cursors after acquisition, writes temp in same directory, validates, then atomically renames and releases in `finally`. Contenders skip maintenance; they still report by replaying from last valid checkpoint. Invalid/stale checkpoint replays durable sources. Pi rewrite/header/cursor mismatch forces full replay. Tests prove a late maintainer cannot replace a checkpoint produced from newer cursors.

Reconciliation converts unmatched starts to `interrupted` only when writer/session is terminal; while active they remain `running`. Corrupt/partial final JSONL line is ignored and reported, never allowed to hide earlier valid records. Unknown records survive as bounded diagnostics.

Retention runs off hot path under the same maintenance lease. After 14 days without source/WAL activity: replay fully, write and re-read validated sealed checkpoint, confirm no live writer marker/source change, then delete analyzer WAL only. Active markers heartbeat at low frequency and are cleared on shutdown; stale dead-PID markers are recoverable. No global mutable rollup file: global analytics fold per-session checkpoints and their daily buckets. Add an index only after benchmarks show this fails.

Auto-generated reports are regenerable cache: one latest file per session/global view, mode `0600`, atomically replaced, and removed after 14 days without access/update. Explicit `--output PATH` exports are user-owned and never auto-deleted; command prints the sensitivity warning and destination. Cache size is capped at 100 MiB total with oldest inactive reports removed first.

### Privacy and security

Default local-only. No network calls, external assets, analytics upload, prompt/result duplication, or raw provider payload capture.

Analyzer WAL stores IDs, timings, statuses, bounded metric values, and redacted dimensions—not prompt text, model output, tool result bodies, or full arguments. Native Pi remains owner of raw session content.

TUI reads local detail on demand. HTML/JSON default to redacted commands/paths and omit prompt/output bodies. Exact sensitive export requires explicit future opt-in; v1 prefers no raw-content export. Generated reports carry a visible sensitivity warning. Files/directories use user-only permissions where supported.

Redaction covers secret-like keys, authorization/bearer values, common token/JWT/private-key patterns, credentialed URLs, environment assignments, and `.env`/credential paths. Redaction is defense-in-depth, never a guarantee that a report is safe to share.

### UX baseline

TUI full-screen custom component, not experimental overlay. Tabs: Overview, Models, Tools, Commands, Agents, Skills, Integrations, Errors, Ledger. Narrow terminals collapse tabs into a selector. Ledger materializes only when opened.

Command grammar:

```text
/session-inspector [current|history|global|ledger] [--scope active|tree] [--format tui|html|json] [--output PATH] [--no-open]
/session-ins ...
```

Defaults: `current + active + tui`; `history + tree + tui`; `global + tree + html`; `ledger + active + tui`. HTML opening uses Pi's argv-based `exec`: `open` on macOS, `xdg-open` on Linux, `rundll32 url.dll,FileProtocolHandler` on Windows; failure reports file path and remains success.

HTML is one file with inline CSS/vanilla JS and escaped embedded report JSON. v1 charts: daily sessions/cost/tokens and model/tool bars only. Same immutable `SessionReport`/`GlobalReport` DTO feeds all renderers. All labels pass through translation keys; only English ships in v1.

### Measurable release targets

Benchmarks gate release after measurement, not wishful claims:

- observer hook scheduling p95 <1 ms, p99 <5 ms, excluding explicit checkpoint command
- no sync disk work on high-frequency hooks; one native synchronous tracking marker per newly tracked session
- steady-state queue <=1 MiB and Inspector incremental memory <=10 MiB for 10k-record session
- buffered WAL <=1 KiB average per non-native record; no raw payload amplification
- warm current overview first paint <150 ms; 10k-entry delta reconcile <250 ms
- cold 100 MiB session replay <2 s
- global fold of 1,000 checkpoints <2 s; self-contained HTML generation <3 s and <5 MiB for aggregate view
- startup p95 <25 ms warm / <75 ms cold after first install

`tests/fixtures/benchmark/v1` is a versioned generated corpus with fixed seed, 10k-entry/100-MiB sessions and 1,000 checkpoints. CI `ubuntu-24.04` benchmark smoke is non-gating except timeout/gross 5× regression. Release owner runs `npm run benchmark:release` in a dedicated GitHub Actions job with pinned Node and no parallel jobs: 10 warm and 3 cold samples, machine/image fingerprint recorded as artifact, median/p95 reported, coefficient of variation <=20% (one rerun allowed). Absolute targets above and >20% regression from last accepted baseline block release; baseline changes require reviewed artifact and changelog note.

## Proposed repository structure

```text
src/
  index.ts                         # Pi package entrypoint only
  commands.ts                      # grammar/defaults/dispatch
  core/
    events.ts                      # canonical union + schema versions
    reduce.ts                      # single deterministic analytics reducer
    reports.ts                     # renderer-neutral DTOs
    ledger.ts                      # lazy normalized chronological view
  pi/
    adapter.ts                     # live hooks + historical replay
    sessions.ts                    # branch/scope/discovery helpers
  storage/
    wal.ts
    checkpoint.ts
    reconcile.ts
    retention.ts
    paths.ts                       # atomic JSON + permissions helpers
  integrations/
    index.ts                       # tiny registry and evidence model
    telemetry.ts                   # public v1 bus consumer/types
    known.ts                       # Context/RTK/Caveman/Ponytail/Permission
    subagents.ts                   # public pi-subagents contracts/artifacts
  privacy.ts
  ui/
    tui.ts
    html.ts
    i18n.ts

tests/
  fixtures/
    pi/0.85.1/
    integrations/
  unit/
  integration/
  performance/

docs/
  research/pi-ecosystem.md
  specs/pi-session-inspector-v1.md
  plans/pi-session-inspector-v1-implementation.md
  architecture/
    README.md
    adr/
      README.md
      0001-deterministic-local-analytics.md
      0002-pi-native-source-of-truth.md
      0003-derived-ledger.md
      0004-per-writer-wal.md
      0005-checkpoints-and-reconciliation.md
      0006-branch-scope-semantics.md
      0007-subagent-rollup.md
      0008-harness-adapter.md
      0009-hybrid-integrations.md
      0010-telemetry-protocol-v1.md
      0011-local-only-privacy.md
      0012-hot-retention.md

.github/
  workflows/ci.yml
  workflows/release.yml
  ISSUE_TEMPLATE/                  # add only after issue volume justifies it
  pull_request_template.md

README.md
CONTRIBUTING.md
AGENTS.md
SECURITY.md
CODE_OF_CONDUCT.md
CHANGELOG.md
LICENSE
package.json
tsconfig.json
biome.json
.gitignore
.editorconfig
```

Start compact; split files only when responsibilities become hard to navigate. No one-file-per-metric analytics hierarchy.

## Reuse decisions

- Use Pi `ReadonlySessionManager`, entry types, `getCommands()`/`getAllTools()` source provenance, TUI components, agent-dir resolver, and argv-based `pi.exec`.
- Use Node `crypto`, streams, filesystem atomic rename, URL/path APIs, `performance.now`, and `node:test`.
- Use Pi's persisted RTK details, Caveman/Ponytail custom entries, Permission System public bus, Lens public bus when later enabled, and pi-subagents public RPC/artifacts.
- Do not import Permission System's internal Bash parser. v1 command classifier extracts a conservative leading command family; opaque wrappers/compound syntax become `compound`/`unknown`. Exact command remains redacted drill-down. Seek upstream public classifier before richer categorization.
- Do not parse rendered extension output or private logs, patch fetch, start a server, or copy session payloads.
- Dev tooling only: TypeScript, `tsx` + `node:test`, and Biome. No production framework/bundler; publish TypeScript source for Pi/Jiti.

## Documentation and repository policy

- `README.md`: value proposition, deterministic/no-LLM distinction, install (`pi install npm:pi-session-inspector`), command matrix, screenshots placeholder, data scopes, privacy warning, architecture, supported/partial integrations, compatibility, contribution links.
- `CONTRIBUTING.md`: Node/Pi prerequisites, local `pi install ./`, scripts, fixture sanitization, test/benchmark expectations, schema/ADR change rules, release process.
- `AGENTS.md`: dependency direction, observer-only invariant, no-LLM rule, source precedence, no Pi-file writes except `appendEntry`, WAL ownership, branch semantics, status/evidence vocabulary, privacy rules, commands, completion checklist.
- `SECURITY.md`: supported latest release, private disclosure route, sensitive report guidance, threat boundaries, no guarantee against same-user local processes.
- `CODE_OF_CONDUCT.md`: Contributor Covenant, unmodified except contact placeholder.
- `CHANGELOG.md`: Keep a Changelog; SemVer, pre-1.0 minor may change public/persisted formats only with migration.
- Defer issue templates until issue traffic exists. Keep one PR template for tests, privacy, schema/ADR, and compatibility evidence.
- CI on Node 22.19+ runs format/lint, typecheck, unit/integration tests, deterministic snapshots, benchmark smoke, and `npm pack --dry-run` tarball inspection.
- Bootstrap first npm publish manually with 2FA. Then configure npm trusted publisher for exact public repo/workflow and publish tags through GitHub-hosted Actions with `contents: read`, `id-token: write`, reviewed npm >=11.5.1, package/version/tag checks, full CI, pack/install smoke, and bare `npm publish`. Trusted publishing supplies provenance automatically for public packages/repos.
- `package.json`: unscoped public package, MIT, ESM, Node `>=22.19.0`, `pi-package` keyword, `pi.extensions: ["./src/index.ts"]`, exact repository/homepage/bugs, Pi packages as `*` peers, minimal files allowlist.

## Steps

### Documentation baseline (this task, after plan approval)

- [x] Write `docs/research/pi-ecosystem.md`. Answer all 25 required questions in a source/version/evidence matrix; include hook phase/payload table, persisted-vs-live matrix, integration observability matrix, overlap survey, assumption corrections, and links to Pi 0.85.1/npm/Hermes/upstream sources.
- [x] Write `docs/specs/pi-session-inspector-v1.md` from architecture baseline above. Include explicit requirements IDs, data/status schemas, invariants, failure modes, NFRs, privacy model, compatibility/migrations, v1/v1.x/future scope, and unresolved technical risks.
- [x] Write `docs/plans/pi-session-inspector-v1-implementation.md` with milestones below, exact expected interfaces, tests-first work, commands, dependencies, and acceptance evidence.
- [x] Write architecture index/ADR stubs, README, CONTRIBUTING, AGENTS, SECURITY, CODE_OF_CONDUCT, and CHANGELOG Markdown. Cross-link canonical spec rather than duplicating it.
- [x] Verify Markdown links, terminology, requirement coverage, source dates/versions, and explicit statement that no production implementation occurred.

### Future implementation milestone 0 — package skeleton

- [x] Create metadata/tooling/config files and empty module boundaries from approved tree. Tests first: package manifest contract and tarball allowlist assertions. Implement scripts and minimal extension registration with both slash commands. Verify typecheck, lint, test, `npm pack --dry-run`, local `pi install ./`, command opens placeholder UI. Depends on approved docs.

### Milestone 1 — replay-to-JSON vertical slice

- [x] Tests first with sanitized Pi 0.85.1 fixtures: unknown entries, model usage/cost, nested tool usage, compaction/branch usage, active versus tree scope, interrupted tool call, deterministic IDs/order. Implement tolerant Pi replay, canonical reducer, report DTO, ledger, and JSON renderer. Verify golden JSON and repeated-byte equality. No WAL yet.

### Milestone 2 — tracking and live enrichment

- [ ] Tests first: old-session resume boundary, marker on abandoned branch, duplicate marker, ephemeral session, hook failure isolation, tool/provider timing, crash leaving unmatched start, writer UUID collision/PID reuse, envelope limits, secret strings in every telemetry field, and diagnostic non-disclosure. Implement observer-only hooks, tracking transaction, manifest, exclusively claimed per-writer buffered WAL, queue bounds, process markers, and telemetry v1 listener. Verify fault injection cannot change Pi execution/result, adversarial telemetry persists no raw secret, and process kill loses at most configured buffer window.

### Milestone 3 — checkpoints, discovery, history

- [ ] Tests first: partial WAL record, stale/missing/corrupt checkpoint, Pi file rewrite, cursor mismatch, pending manifest crash, maintenance lease contention/stale-owner recovery/late-writer regression, and 206+ session fixture discovery. Implement leased atomic checkpoints, delta cursors, replay fallback, tracked manifest listing, history picker, and source diagnostics. Verify crashed session remains discoverable and concurrent maintenance cannot regress cursors.

### Milestone 4 — current TUI and lazy ledger

- [ ] Tests first: renderer-independent view models, keyboard reducer, narrow layout, active/tree toggle, unavailable/unsupported labels, ledger lazy-load. Implement full-screen tabs and history drill-down. Verify in real Pi with branch creation, failure, model switch, compaction, and interrupted tool.

### Milestone 5 — integrations and agent roll-up

- [ ] Tests first from pinned upstream fixtures: Context `ctx_*`; RTK `rtkCompaction`; Caveman/Ponytail entries; Permission events; pi-subagents foreground/async/nested/status/tool-result variants. Implement evidence registry and source precedence. Verify one parent session plus N `AgentRun`s, child cost not double-counted, missing artifacts degrade to unavailable, and unsupported versions never crash.

### Milestone 6 — HTML/i18n/export

- [ ] Tests first: HTML escaping/CSP-sensitive payloads, deterministic DOM snapshots, filtering/sorting/search, chart data, redaction, locale fallback, browser-open failures, cache expiry/size, and explicit-export preservation. Implement self-contained HTML/vanilla JS, minimal charts, English catalog, JSON export, platform opener, and report-cache cleanup. Verify file works offline from `file://` on Linux/macOS/Windows CI where feasible and contains no external requests.

### Milestone 7 — retention and scale

- [ ] Tests first: active/stale writer markers, resume sealed session, validate-before-delete, source change race, 14-day boundary, analyzer-only deletion, cold integration detail notice. Implement seal/reopen/prune flow and benchmark corpus. Verify injected crash at every phase preserves either raw WAL or valid checkpoint.

### Milestone 8 — hardening and release

- [ ] Fuzz JSONL/telemetry parsers; run privacy corpus, schema compatibility fixtures, full NFR benchmarks, clean-machine install smoke, TUI manual matrix, and tarball audit. Resolve measured regressions without adding a database unless checkpoint benchmark fails. Create initial GitHub release/npm publish manually, configure trusted publisher, then validate OIDC/provenance release path.

Milestone map: 0–4 produce internal MVP; 5–8 complete public v1. v1.x contains deferred integrations/locales/report refinements. Future begins only after user evidence supports another harness, database, or external exporter.

## Top risks and unresolved questions

1. **Pi API/format drift:** latest-only reduces matrix size but uses APIs without long-term stability guarantees. Pin fixtures/types to release, capability-check fields, ignore unknowns, and fail closed to native-only analytics.
2. **Provider-attempt timing:** no durable attempt/request ID guarantees exact retry correlation. Validate live hook ordering empirically; otherwise show best-effort duration and unavailable retry counts.
3. **Subagent attribution:** pi-subagents versions/artifact shapes and foreground/async retention differ. Pin public contract fixtures; never infer missing parentage from timestamps alone.
4. **Cross-process clock skew:** writer sequence is exact only within a process. Preserve wall times but label merged order approximate; do not compute exclusive critical-path time without causal IDs.
5. **Retention races/crash windows:** active marker heartbeat and validate-before-delete need kill/fault tests on Linux, macOS, and Windows semantics. Until proven, keep WAL rather than risk loss.
6. **Privacy leakage:** even command families/dimensions can expose project facts. Persist strict allowlisted metadata, fuzz redaction, and keep sharing warnings prominent.
7. **Double-counted usage:** nested tool/subagent/compaction usage is subtle. Golden fixtures must assert source precedence against Pi's own `/usage` totals before release.
8. **Scale thresholds:** 206 sessions is modest; 1,000-session/100-MiB targets remain hypotheses until benchmarked. Add no database preemptively; benchmark checkpoint folding first.
9. **TUI compatibility:** custom full-screen API is current but not formally stable. Keep render DTO independent and ensure JSON/HTML remain usable if TUI capabilities drift.
10. **Package/release ownership:** npm name appears free but is not reserved; trusted publishing requires repository/admin setup outside code. Recheck name, disclosure contact, copyright attribution, and npm org ownership before release.
11. **Command classification:** no public shared shell parser. v1 deliberately reports conservative families; decide after field data whether upstream cooperation or a dependency is justified.
12. **Mode duration after crash:** persisted mode changes lack exact end boundaries. Use last observed session activity and mark inferred; never report exact active-mode time without live boundaries.

No unresolved product decision blocks documentation. Implementation must resolve risks 2, 5, and 7 with empirical tests before public release; failure means downgrade metric confidence or keep data rather than broaden machinery.

## Verification

Planning/research verification:

- Every required research question maps to at least one current authoritative source or is marked unverified/not observable.
- Claims tied to implementation details cite immutable npm version/full tarball integrity and commit-SHA/file/symbol/line anchors where available; moving branch links are navigation only. This source matrix is a prerequisite for implementation.
- Proposed hooks and payload fields match current Pi types/source.
- Session fixture assertions match real sanitized Pi JSONL/custom-entry samples.
- Integration claims separate observation from inference and unsupported data.
- No production code, package install, commit, or push occurs in planning phase.

Future implementation verification baseline:

- Unit, fixture, crash-recovery, concurrent-writer, branch-scope, renderer, integration, migration, privacy, and benchmark suites.
- Typecheck, lint, tests, packaging validation, `npm pack --dry-run`, clean install smoke test, and manual Pi TUI/HTML checks.
- Failure-injection proves telemetry never affects agent execution.

## Confirmed decisions

- License: MIT; use `twKrash` attribution unless legal-name attribution is supplied later.
- Compatibility baseline: latest stable Pi at implementation time. Pin tested API/fixture expectations to that release; older Pi support is not a v1 promise.
- This planning phase may create requested Markdown deliverables after plan approval. Defer `LICENSE`, package/CI scaffolding, source code, commit, and push until planning mode ends.
