# Changelog

All notable changes will follow [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.1.0]

### Added

- `mcp` semantic integration for `pi-mcp-adapter`: the report gains one `mcp`
  row with `toolApprovals`, `iframeApprovals`, and `iframeDenials` counters read
  from the versioned `mcp-approval-v1` session entries, plus presence evidence
  from the `pi-mcp-adapter/status/v1` runtime snapshot. Server names, tool names,
  and approval hashes are validated in place and discarded, and the runtime
  snapshot stays a presence sighting rather than an activity counter.

### Changed

- The README integration matrix and `docs/integrations.md` describe the `mcp`
  integration, and the integration-authoring checklist now names the adapter
  re-export line next to the registration line.

## [1.0.3]

### Changed

- `pi.image` now points at a repository copy of the gallery preview served by
  `raw.githubusercontent.com`. GitHub serves release assets as an attachment
  with `application/octet-stream` and `x-content-type-options: nosniff`, which a
  strict consumer can refuse to render; the tracked copy is served as
  `image/png`.

## [1.0.2]

### Added

- `pi.image` points the [Pi package gallery](https://pi.dev/packages) at an
  Overview screenshot, so the listing carries a preview once the gallery
  indexes this package.

### Changed

- `keywords` also carry `pi-extension` and `pi-coding-agent`, the terms the
  other Pi packages are found by.
- The README states that a Pi package runs with full system access and shows the
  version-pinned install form.

## [1.0.1]

### Changed

- `peerDependencies` now match the Pi documentation: `@earendil-works/pi-tui`
  accepts `*`, like `@earendil-works/pi-coding-agent`.

## [1.0.0]

First public release. Only `0.1.0` was ever published, so the `0.13.x` sections
below are the pre-release development record and every change they describe is
included here.

### Added

- The in-Pi TUI now bounds long tab content to 12 rendered lines per page and
  supports `↑` / `↓` page navigation. Tab and scope changes return to the first
  page, while short views remain unchanged and show no pagination noise.

### Fixed

- Agent rows in the TUI now use the same semantic parent verdicts as the
  browser/snapshot projection instead of exposing producer parent IDs.
- Agent usage coverage is explicit in the TUI, and an empty ledger is reported
  as an observed empty result rather than unavailable evidence.

## [0.13.3]

### Fixed

- A missing Inspector `wal/` directory is no longer indistinguishable from a
  healthy empty store when a valid checkpoint still declares retained WAL
  cursors: recovery reports the bounded `wal-directory-missing` code in
  `RecoveryResult.diagnostics` (never a fabricated record, cursor, or
  aggregate), while a never-initialized store, which declares nothing, stays
  healthy empty. Availability, cursors, records, and folded counters are
  unchanged in both cases, and recovery still never creates, repairs, or
  deletes storage.

### Changed

- Storage failure-path contracts are pinned by tests. An interrupted pass
  between recovery and checkpoint publication replays to the same canonical
  result and folds each record exactly once; a checkpoint replacement exposes
  either the previous or the new complete checkpoint to concurrent readers,
  never a partial or mixed one; a dropped seal, a seal/cursor regression, and a
  seal ahead of its own WAL cursor are all rejected instead of becoming
  authoritative; and a WAL shorter than a sealed checkpoint cursor is accepted
  without rewinding the cursor, re-folding the sealed prefix, or inventing
  missing records. ADR 0005 now states the durability scope explicitly: the
  targeted failure is process crash, and no `fsync` or power-loss guarantee is
  added.

## [0.13.2]

### Fixed

- The LLM tab names each usage scope, so its figures can no longer be read as
  one total. Pi records a child agent's own usage on the parent's subagent tool
  result, which makes the session root (all persisted native usage) larger than
  the model table (generation usage only) by exactly the child figure; the model
  table's note now states that scope, the session root carries its own "Session
  total" line, and the child card states that its figure is a breakdown inside
  the session's tool-result usage. No arithmetic changed: the root was, and
  remains, the report's native usage, never `native + child`.
- A session runtime that Pi replaced can no longer leave a live registration
  behind. Inspector's live counter registration is owned per runtime and
  disposed when that runtime ends (`session_shutdown`, every reason), and a
  registration owned by a replaced runtime is disposed instead of reused, so a
  resumed session subscribes afresh. `A -> B -> A` therefore keeps counting
  permission and skill telemetry instead of silently reporting nothing.
- The read-boundary attempt memo is scoped to the session runtime as well, so a
  session that failed its one bounded fold attempt before Pi replaced its
  runtime gets a fresh attempt when it is resumed, while a healthy runtime still
  folds at most once and never re-runs maintenance on every read.

## [0.13.1]

### Fixed

- A deep link to a command or a source no longer pins the Environment subview.
  The focused entity used to decide the subview on every render, so clicking
  Commands or Sources after following such a link did nothing: the subview is
  now route state (`panel=commands`, `panel=sources`), a link names the subview
  its own entity belongs to, the reader's next click supersedes it, and a route
  naming an incompatible pair (a source entity under `panel=commands`) is
  canonicalized by dropping the entity. Back/Forward restores the panel and its
  focus together, and no focus can pin a panel it does not belong to.

### Changed

- The LLM tab states its two subjects: model usage stays above a labelled
  **Agent execution** section, and the child-run summary cards and the Agents
  panel sit inside it. The boundary is a heading plus the surface's own border
  token — no decorative rule — and it holds at narrow widths.

## [0.13.0]

### Added

- The Agents panel opens on the execution tree instead of a flat table, and the
  flat table stays one click away behind a Tree | Table switch. The tree shows
  what executed and who launched whom: a UI-only **Primary session** root with
  the session's own figures for the selected range, materialized agent runs
  nested under the run that produced them, and a neutral **Run container** group
  for the children one run container published (flattened into the run itself
  when it would wrap a single child). A run container is not an agent, so it
  carries no status, model, or usage, and neither it nor the session root ever
  becomes an `AgentRun`.
- Each tree row states the run's role, status, model, thinking level, known
  tokens and cost, artifact state, and any usage it could not publish, plus what
  a collapsed branch hides (`4 descendants · 1 failed`). With several session
  models the root says so (`2 models used`) and lists each model's own
  generations; no model is promoted to "primary" and no run claims that a model
  launched it.
- Search, status, and model filters keep the ancestors a match needs and mark
  them as `context` instead of detaching a nested result from its topology, and
  an active filter holds the hierarchy open rather than hiding its own matches
  behind a collapsed branch.
- The offline snapshot prints the same hierarchy in full, expanded, with no
  control it cannot honour.
- A route that focuses a nested agent opens the branches holding it, and the
  presentation is part of the route, so Back/Forward and deep links restore both
  the view and the focused row.

### Fixed

- A known non-zero cost is never rendered as `$0.00`. `toFixed(2)` alone turned
  a persisted cost such as `0.004893924` into a different figure that was also
  indistinguishable from a real zero; one shared rule now renders zero as
  `$0.00`, one cent or more with two decimals, below one cent with four
  (`$0.0049`), and below `0.0001` as the stated bound `< $0.0001`. The browser
  bundle and the snapshot resolve that rule from the same module.
- The entry-scope note says when Active path and Full session tree carry the
  same report data, instead of leaving an inert scope switch unexplained.

## [0.12.1]

### Fixed

- A subagent child whose parent identity is the publishing run container no
  longer renders `Parent: Unavailable`. pi-subagents identifies a child as a
  member of the run that produced it (`details.runId` with `results[].index`),
  and that container is never itself an agent row, so the parent cell now
  states the known relationship (`Parent: orchestration run`) instead of
  claiming the identity is missing. The distinct verdicts stay distinct: no
  parent identity, an in-range parent link, a parent outside the selected
  range, and a value that is not an Inspector-owned identity. A range selection
  still cannot change which parent a row has; it only decides whether that
  parent is in the selected rows.

## [0.12.0]

**Browser UI plus one additive command target (`json session <sessionId>`), a
post-UAT correctness and diagnostics pass, and one tab vocabulary change
(`models`/`agents` deep links coerce to the section default, and Skills is a
tab of its own); no report, DTO, or persisted-schema change.**

### Added

- A grouped Tools row now carries duration and usage **with their coverage**: a
  name whose calls correlated to live durations publishes the total and the
  mean plus `{withDuration} of {calls}`, and a name whose calls persisted native
  usage publishes the sum plus `{withUsage} of {calls}`. A figure that is
  incomplete never reads as complete, and a name with no correlated duration or
  no persisted usage shows Unavailable rather than `0`.

### Fixed

- A durable presence sighting survives a session becoming history. The history
  read derived presence from the checkpoint alone, so a session whose own WAL
  recorded `permissions:ready` reported `present` to a live reader and `unknown`
  once replayed; both projections now read the checkpoint fold plus the retained
  WAL suffix and agree. Presence that comes from the **inventory** signal (an
  extension command or a tool the environment reports) can still differ between
  the two: the live read uses the process-local inventory and a history read
  uses the persisted snapshot. That is environment state, not session evidence,
  and it predates this change.
- A read that finds no fold boundary folds the retained WAL once (the pass the
  session-start trigger schedules, bounded to one attempt per session and root)
  before it publishes counters. Previously a live session with WAL evidence but
  no checkpoint reported every counter as unavailable and left a policy-denied
  command uncounted, even though the producer published `permissions:decision`
  and the WAL retained it.
- The debug log reports a healthy replay and a healthy duration correlation once
  per operation (`replay-summary`, `correlation-summary`) instead of one line
  per record and per correlated call. A malformed/unavailable replay and an
  uncorrelated call keep their own bounded anomaly events.

### Changed

- The browser's top-level navigation is Overview, **LLM**, Tools, **Skills**,
  Integrations, **Environment**, Errors, Ledger. Skills is a tab of its own,
  Environment keeps Commands and **Sources** (the user-facing name for the
  capability providers the DTO still calls `resources`), and the Sources table's
  last column reads "Tools" because the figure is the tools that source
  supplies.
- Models, tools, skills, integrations, sources, commands, and errors render as
  real links to their own view when the payload publishes the id: navigation
  always has an href, a local action is a button, and anything else is text.
- Integrations, Skills, and History carry a default-on availability filter
  stated in each view's own terms — telemetry evidence, an observed invocation
  ("Invoked only"), and a replayed session — with the shown/hidden counts always
  visible and a control that reveals the hidden rows. Tools and Models are
  unchanged: they already represent observed activity.
- The browser's Models and Agents tabs are one **LLM** tab: the scope's model
  table, and below it the child-run breakdown of the same scope. The route id is
  `llm`, so an old `#/current/models` or `#/current/agents` link coerces to the
  section default with the bounded "not available here" notice. The TUI keeps
  its own fixed tab list.

### Added

- A refresh control in the page header that re-reads the report from the running
  Inspector (`/api/v1/ui`, the same request the route already makes) and renders
  the new payload without moving the reader off their tab, scope, or table state.
- `json session <sessionId>`: one requested historical session exported as JSON,
  with the same `--output` and `--debug` options as the other JSON targets and
  the same atomic, scope-free, range-free rules as `snapshot session`. It loads
  that session through the same historical-session seam `snapshot session` uses
  and writes the canonical report DTO itself, where the snapshot resolves its
  own projection of that DTO; no JSON-specific session parser or data path
  exists. The generated cache name
  is `session-<sessionId>.json`, so it can never be the file a `json current`
  export wrote.

## [0.11.0]

**Additive: integration descriptors with typed hooks, Inspector-owned settings,
and a bounded local debug log. No public report or persisted-schema break; see
ADR 0019.**

### Added

- Integrations describe themselves as a descriptor plus optional typed hooks
  (`presence`, `persisted`, `live`, `telemetry`, `canonical`). One explicit
  array in `src/integrations/index.ts` declares which integrations Inspector
  supports and in what report order; each subsystem iterates that list and
  invokes the hook it owns, and the catalog validates definitions and answers
  lookups only. Adding an ordinary integration is one definition file, one
  registration line, focused tests, and one `docs/integrations.md` row.
- `docs/integrations.md`: the supported-integration matrix, how to add an
  integration, and the integration vs skill vs tool/MCP distinction.
- Inspector-owned `settings.json` at
  `<agentDir>/session-inspector/settings.json` with `theme` and `debug`,
  resolved as `CLI option > settings.json > product default`; a missing file is
  the default configuration, and malformed, unreadable, or oversized settings
  degrade to the defaults with a bounded diagnostic.
- `--debug` on `ui`, `snapshot`, `tui`, and `json`, plus a local, bounded
  `0o600` JSONL debug log under `session-inspector/v1/debug/` that never
  reaches a report, a counter, or a snapshot. One event is capped, the file
  rotates, the footprint stays under two files plus one line, and the sink fails
  closed if its private modes cannot be enforced.
- Registry-shaped regressions: fixture integrations prove presence, persisted
  evidence, telemetry folding (with no cross-integration contamination), live
  registration/disposal, and rich canonical contribution flow through the
  generic subsystems; 64 declared integrations plus a legacy row publish all 65
  rows while hostile adapter input stays independently capped.

### Changed

- Integration keys are validated by catalog membership, so the trusted key set
  can no longer drift from runtime validation. The scattered `IntegrationKey`
  union, `SIGNALS` table, `COUNTER_KEYS` table, observation-default list, and
  report key/order tables are gone (`integrations/presence.ts`,
  `integrations/pi-entries.ts`, `integrations/registry.ts`, and
  `core/integration-counter-allowlists.ts` are deleted).
- Live and durable presence is one generic keyed map: the live subsystem reports
  sightings by key, the fold applies telemetry under the key the registry stamped
  from the integration that produced it, and the checkpoint v1 shape
  (`presence: { permission?: boolean }`, ADR 0014) stays isolated in
  `core/presence.ts` at the storage-compatibility boundary.
- Skills stay generic discovered resources with inventory plus `/skill:`
  invocation counting, and MCP servers stay tool sources; neither gains an
  integration without a semantic telemetry contract.
- Debug diagnostics are local and non-canonical: they never enter a report,
  counter, evidence record, or snapshot, and any logger failure is swallowed.
- The pre-M8.5 executable reconciliation and property gate, the esbuild-bundled
  browser client with a shared i18n catalog, and the Chart.js chart adapter ship
  in this release.

### Fixed

- Lens evidence counted only a bare `lens` tool name while presence accepted
  the `lens_*`, `pi_lens_*`, `lsp_*`, and `ast_grep*` vocabulary, so a session
  that called `lens_diagnostics` reported `Present / Unavailable`. Presence and
  evidence now share the integration's one tool vocabulary.
- The subagents row reported `unavailable` while the Agents view already showed
  native subagent evidence. The row now publishes a counters-free `supported`
  state from the integration's own persisted read, and its schema declares no
  counters.
- Real-session UAT explained the remaining `Present / Unavailable` rows
  (ponytail had no mode change; caveman's only mode entry precedes the tracking
  marker) and localized persisted `durationMs: 0` records to sub-millisecond
  tools measured by the live millisecond clock - an honest floor, not a
  persistence, recovery, or projection defect.

- Pre-M8.5 executable reconciliation and property gate covering canonical
  usage, dated attribution, projections, privacy, availability, and bounded
  `fast-check` checks.
- Build-time esbuild bundling for one deterministic classic browser client,
  with readable route/range/client sources retained under `scripts/web/`.
- One shared local i18n catalog and synchronous Inspector-owned i18next adapter
  with explicit English fallback and no detector, backend, or persistence.
- Chart.js `4.5.1` behind the thin `scripts/web/chart.ts` adapter: the daily
  chart gains date-labelled axes, hover tooltips, multiple series, independent
  Y axes, legend visibility, and responsive sizing, while the exact-value table
  stays the accessible representation and the browser owns no range, aggregate,
  or unavailable-versus-zero rule.

### Changed

- The interactive server now serves shell, stylesheet, and generated client
  assets; browser behavior and report semantics remain unchanged.
- dependency-cruiser cruises `scripts/` as well and enforces that only
  `scripts/web/chart.ts` imports `chart.js`.
- `publint` is pinned dev tooling with an explicit `npm run publint` script, so
  `knip` and the pre-commit hook pass again.
- Shipped-asset gates assert capabilities instead of substrings: a parsed check
  for module loading, host loaders, `import.meta`, and dynamic code evaluation,
  a calendar rule scoped to Inspector's own sources, and a render test that
  poisons `Date` and requires the chart to draw anyway.
- `benchmark/browser.ts` tracks the browser surface: bundle evaluation, startup,
  refresh, chart create, and chart update, with behavior invariants asserted on
  every sample and an accepted baseline in `benchmark/baselines/browser.json`
  (`npm run benchmark:browser:check`).

### Removed

- `/route.js` and `/range.js` are no longer served as runtime assets; their
  readable sources are bundled into `/client.js` at build time.
- The custom SVG chart renderer is replaced by the chart adapter; the exact
  values remain available in the retained data table.

### Fixed

- `ui` now bootstraps its browser client on page load, so the authenticated
  report request and in-memory theme control work in ordinary browsers.
- `ui` answers browser favicon probes with an empty `204` response, avoiding
  misleading 404 diagnostics without expanding its known asset surface.

## [0.10.0]

**Breaking (Pre-M8.4 ephemeral localhost UI and immutable snapshots; see ADR 0018 and the v1 spec).**

### Added

- `ui`: the interactive application, served by one lazy loopback server bound
  to `127.0.0.1` on an OS-chosen port, whose per-instance token is delivered
  once in the URL fragment and held in memory only. The browser navigates,
  requests, formats and renders; every scope, range, partiality, evidence and
  unavailable-versus-zero decision stays in the server projection.
- `snapshot current|history|global|session <sessionId>`: one resolved
  self-contained `file://` HTML artifact per target, with no executable
  JavaScript, no network access, and byte-identical output for equal inputs.
- Generated snapshot cache under `session-inspector/v1/reports/` with opaque
  identities, 14-day expiry and a 100 MiB cap; explicit outputs stay user-owned.

### Changed

- Command grammar is now `/session-inspector [ui|snapshot|tui|json] [target]
  [options]`; `--output` is valid for `snapshot` and `json`, never `ui`.
- Snapshot range options are strict: presets resolve against each projection's
  own latest observed date, custom ranges are inclusive real dates, and invalid,
  mixed, duplicate or unsupported range input is rejected instead of clamped.
- `snapshot session <sessionId>` is atomic: scope and range options are
  rejected.
- One request-time projection serves `/api/v1/ui`, and one bundle load happens
  per response, so a response can never mix two sessions.

### Removed

- `--format tui|html|json` and the bare `current|history|global|ledger` first
  token form; `--subagents-artifact` (subagent runs are auto-discovered from
  persisted tool results).
- The legacy inline-script HTML document, its static route and range modules,
  and the module inlining they relied on. Browser behaviour moved to the five
  ordinary files under `src/ui/web/`, and archived output to the snapshot
  renderer.

### Fixed

- Explicit `snapshot` and `json` outputs never name Pi's authoritative session
  JSONL: a direct session-source destination (any `.jsonl` path, or for
  `snapshot` anything inside the Pi session directory) is refused before any
  read or write, while a destination that is a hard or symbolic link to a
  session source is replaced atomically instead of followed, so the source
  keeps its own bytes and inode.

## [0.9.3]

- Pre-M8.3 architecture, invariant, and reconciliation audit: added deterministic dependency boundaries, centralized canonical report projection, and removed duplicate loader-side reconciliation.

## [0.9.2]

- Pre-M8.2 static inventory cleanup: validated Knip dispositions, removed stale internal exports/types, and retained intentional report/type contracts.
- Developer workflow: tracked pre-commit hook runs Knip automatically; repository installs configure `.githooks/` without adding a hook dependency.

## [0.9.1]

- Pre-M8.1 repository and documentation hygiene: promoted durable milestone history, removed obsolete tracked execution artifacts, and clarified the pre-M8 release path.

## [0.9.0]

- Coverage: session coverage with bounded per-session reasons, capped-discovery honesty, and `Known`/`Unavailable` wording instead of unqualified totals.
- Range: one shared range projection for every tab, per-view ranges, validated custom-range hash round-trips, logical-call timestamp attribution.
- Agents/Tools/Errors: child-run metrics separated from native agent tool activity, the child usage fraction derived from the rendered runs, `Related child run(s)` joins, errors led by tool identity.
- Projection: agent role, artifact state, observation time, tool timestamps and per-date model/composition rows reach the browser through one canonical projection.
- Navigation: authoritative hash route with Back/Forward, deep links, capability-filtered tabs, entity focus.
- Environment/Integrations: inventory grouped as environment; detection, telemetry, activity and version shown independently.
- Completion: `/session-inspector` completion preserves every preceding argument, quoted values included.

## [0.8.0]

Evidence Foundation: every report now comes from one canonical session pipeline, so current, history, global, TUI, HTML, and JSON cannot disagree about scope, counters, or joins.

### Added

- **Canonical session pipeline.** Source adapters produce validated L0 evidence, one L1 canonical session reconciles the entry graph, call/result joins, child runs, usage, and retained aggregates, and L2 emits the bounded DTOs rendered by TUI, HTML, and JSON. Loaders no longer re-derive scope or re-fold checkpoint counters.
- **Evidence health** (`evidenceHealth`, always present on a report): bounded per-source state, join counts, usage/dated coverage, aggregate detail state (`full`/`aggregate-only`/`expired`), and code-only diagnostics. Unavailable, unsupported, partial, and expired never render as zero.
- **Retained aggregates** (`retainedAggregates`, present only with a checkpoint boundary): the exact fold/seal cursor maps, the instant before which pruned WAL detail no longer exists (`detailExpiredBefore`), and only the aggregate values that survived pruning, labelled `aggregate-only`.
- **Richer agent rows:** `observedAt` (publication time of the result that observed the run, never a run start/end), `evidenceToolId` (the canonical `tool:<toolCallId>` that published it), bounded `model`/`thinking`, and a bounded `failure` reason with an exit code or signal token.
- Explicit `/skill:<name>` invocations are first-class evidence while their WAL detail is retained; after pruning the exact named and overflow counts survive as labelled aggregate-only values and never fabricate invocation rows.
- Hardened parent-session resolution (approved-root containment, symlink and regular-file checks, bounded v3 header read; every failure is `unavailable` with no path leakage) and one domain-separated opaque-ID helper for live-tool, permission-request, and subagent-run identities.

### Changed

- Public subagent agent IDs keep the `subagent-<64hex>` shape but change value: the digest is now session-scoped instead of process-global. All links are regenerated from the same report; generation/tool/compaction ID values are unchanged.
- Checkpoint `aggregates.resourceCounts` is extended in place with `resources`, `toolSources`, and `observedAt`, and one additive `evidence` object records materialization time and detail coverage (its `usageCoverage` slot is schema-reserved but currently unwritten; no writer fabricates it). Inventory snapshots now carry `observedAt` (the latest successful observation; mtime is never evidence time).
- Skill invocation counts are projected from L1 `effectiveCounters`/retained skill facts and never re-folded in L2; the report state vocabulary (`supported`/`unavailable`) is unchanged.

### Fixed

- Inventory `observedAt` is consistent everywhere it appears: the snapshot file, the in-memory mirror handed to the builder, and `aggregates.resourceCounts.observedAt` carry the same observation instant, and `inventory-observation-time-missing` now fires only when no observation instant genuinely exists.
- Current/history/global reconcile retained atomic telemetry against the checkpoint fold/seal boundary exactly once, so folded, retained, and pruned contributions can no longer double count or contradict their own health.

### Migration

- A 0.8.0 checkpoint adds the extended `resourceCounts` keys and the `evidence` object; `schemaVersion` stays `1`. Older readers ignore them and their next maintenance write drops them, degrading affected totals to `unavailable` (never `0`); Pi data is untouched.
- A checkpoint sealed by an older version can never gain `walDetailExpiredBefore` (or `inventoryDetailExpiredAt`): those fields are written only by the prune path, in the same write that publishes a new seal and only when a prune actually removed detail. Pre-0.8.0 sealed sessions keep reporting WAL detail as `expired` without an exact instant rather than a backfilled one.

### Security

- Permission telemetry may now carry exactly one hashed producer identity, `attribution.request` = `permission-request-<canonicalOpaqueDigest("permission-request", sessionId, rawRequestId)>`. It is additive envelope metadata only: never folded, never a join key, never paired with a decision, and the raw request ID, its preimage, and every other producer field (`origin`, `value`, `matchedPattern`, `agentName`, `forwarding`) remain prohibited. ADR 0016 partially supersedes ADR 0014 for this one form; the v1 spec was amended in the same change.

## [0.7.0]

### Added

- Evidence coverage for Ponytail and Caveman (schema-less `ponytail-mode`/`caveman-level` custom entries, split into independent integration rows), the Permission System (public `permissions:ready|ui_prompt|decision` bus counters), and pi-subagents (automatic discovery from persisted tool results).
- Durable live evidence: permission counters, explicit `/skill:<name>` invocation counts (one bounded `input` observation), and presence fold cursor-based into checkpoint aggregates, so they survive `/resume`, history/global within retention, and WAL detail expiry.
- Commands, skills, and generic resource-source inventory from `getCommands()` + `getAllTools()`, with a sanitized, hash-refreshed `inventory.json`, per-tool source attribution, and explicit "inventory ≠ invocation" copy.
- pi-subagents auto-discovery: native tool activity always shown, rich runs from `details.completions[]`/`details.results[]`, and archive references followed only from the completion surface after strict validation.
- Bounded, redacted `errorMessage` evidence on Errors rows (single line, ≤200 bytes; secret/path/URL redaction).
- Offline `ui` bundle: one self-contained document containing Current (both precomputed scopes), History, and Global, with offline scope switching and 7D/14D/30D/Custom ranges.
- Positional command surface (`ui|tui|json`) with targets/options, initial theme (`--theme dark|light`), token-aware completions, and a help panel.

### Changed

- The single `mode` integration key is split into `ponytail` and `caveman` report rows; legacy `mode` v1 evidence is still accepted by the projection.
- The Agents tab shows native subagent tool activity above the rich runs and is never empty when native activity exists.
- `ui` now emits one bundle covering Current, History, and Global instead of a per-section export; `--scope` selects only the initially displayed current view.
- Integration rows distinguish `not observed`, `unavailable`, and `unsupported` with an evidence-based presence model.

### Removed

- `--format tui|html|json` and the `current|history|global|ledger` first-token targets; use positional `ui|tui|json` modes and their targets. Removed syntax now returns usage help instead of the generic failure message.
- `--subagents-artifact` and its `{version:1, runs:[…]}` reader. No pinned producer wrote that shape; subagent runs are auto-discovered.

### Migration

- A 0.7.0 checkpoint may carry the additive aggregate fields (`integrationCounters`, `skillInvocations`, `skillOverflowInvocations`, `presence`, `resourceCounts`). Downgrading to 0.6.x makes its next maintenance write drop them, so folded counters and skill counts degrade to `unavailable` (never `0`) until WAL detail expires; Pi data is untouched. `schemaVersion` stays `1` because a bump would make 0.6.x discard the whole checkpoint, including sealed-cursor knowledge.

## [0.6.1]

### Changed

- Legacy shards with no usable owner record (missing, empty, or unparseable `.owner`) are no longer unconditionally unprunable. They may expire once their segment mtime precedes the cutoff day and its exact size, mtime, device and inode are re-verified immediately before unlink, so a delayed append or path swap aborts the deletion. A live owner PID, an `ESRCH`-only death proof, and a genuinely unreadable owner record all keep preserving detail.
- ADR 0012 and the spec retention paragraph now describe exactly what the code guarantees, including the residual non-atomic window between the final recheck and unlink.

### Added

- Crash-injection tests for every seal phase (interrupted validation, mid-stream validation failure, checkpoint-publication failure, unlink failure, orphaned closed marker, repeated maintenance passes) and an end-to-end cold-detail notice test asserting the state reaches the DTO, JSON and the embedded HTML report data.

## [0.6.0]

### Added

- Usage composition now reconciles visibly: total usage equals generations + tool results + compactions + branch summaries, each shown as its own component so the gap against the Models summary is explained rather than implied.
- Per-usage input, output, cache-read and cache-write token fields (absent when Pi did not persist them) and correct labeling instead of presenting the total as "Input".
- Bounded error evidence (allowlisted kinds only, never raw messages) so the Errors tab reports real rows.
- Session-span duration from native first/last records plus per-tool duration when the DTO provides it; otherwise explicitly unavailable. Anonymous live WAL timings are never guessed into per-record durations.
- Context Mode integration evidence from `ctx_*` tool calls, counted once when also observed through custom entries.
- Daily activity line chart for current, history and global reports, with daily rows computed in TypeScript rather than in browser JavaScript.
- History drill-down from the session table into the shared detail sections, and a shared `LedgerItem` projection consumed by both TUI and HTML.

### Changed

- HTML ledger renders the shared core ledger projection verbatim instead of re-deriving rows in the browser.
- "Evidence, not estimates" is driven by real evidence state for every report kind.
- Tool usage distinguishes observed values, observed zero and missing evidence: missing now renders Unavailable instead of 0.
- The tools, models, agents, errors, integrations and ledger tabs render real data; commands and skills state explicitly that no Pi-persisted evidence exists.
- Filters (7D/14D/30D/custom) apply to the chart, totals and history table, and scroll position is preserved across re-renders.
- Usage arithmetic is bounded: out-of-range or non-finite inputs are treated as invalid rather than propagated, and duplicate tool results accumulate usage at most once.

### Fixed

- `ctx_*` tool calls no longer leave Context Mode integration evidence empty.
- A tool result without usage no longer fabricates a zero value.

## [0.5.0]

### Added

- M7 sealed-detail retention: versioned contiguous-prefix seal evidence (`sealingVersion: 1`), closed-segment markers, and a strict 14-calendar-day cutoff for detailed Inspector records.
- Daily immutable WAL segment rotation, including clock rollback, with bounded intra-day fragments so large days stay replayable, checkpointable, and prunable.
- Retention runs incrementally under the maintenance lease on rotation and after startup, independently of full replay budgets; unversioned legacy seals degrade to unavailable instead of guessing.
- Fixed-seed benchmark corpus (10k records, ~100 MiB session, 1,000 checkpoints) with `benchmark:smoke`/`benchmark:release` scripts and published measurements in `docs/benchmarks/m7-baseline.md`.

### Changed

- Missing WAL is authorized only by validated sealed evidence; ordinary checkpoint cursors are no longer deletion authority.
- Cold-detail expiry is preserved across maintenance passes and surfaces as `walDetail: "expired"` in JSON and HTML reports; the current TUI carries the state in its report DTO without a dedicated visible row.
- Stale lease and cache-lock reclamation requires a conclusively dead owner (`ESRCH`) plus an age threshold.

## [0.4.0]

### Added

- M6 self-contained offline HTML and deterministic JSON exports for current, history, and global report DTOs, with cache expiry/size maintenance and argv-safe HTML opening.
- Current command supports HTML/JSON exports with the same bounded public `--subagents-artifact` evidence as TUI; `/ledger` opens directly on the lazy Ledger tab.

### Changed

- History and global reports accept only durable full-tree scope; malformed persisted JSONL is unavailable rather than partially counted.
- Explicit `--output` files are user-owned and are preserved even when written within the generated-report cache.
- Global chart controls expose only backed native daily cost and token data.

## [0.3.0]

### Added

- Current-session commands accept `--subagents-artifact PATH` to read one bounded local public pi-subagents artifact; its path and raw contents are never persisted or rendered, and read failures remain unavailable.

## [0.2.0]

### Added

- Local, versioned evidence adapters for Context Mode, RTK, mode entries, Permission System, public pi-subagents artifacts, and generic Lens tool use.
- Bounded agent and integration report/TUI rows with non-additive child-agent usage breakdown; Pi-native parent usage remains billing authority.
- Current-session full-screen TUI with fixed analytics tabs, active/tree scope selection, narrow-terminal layout, and lazy Ledger materialization.

### Security

- Integration evidence uses no private API or runtime integration import and excludes raw producer content from reports.

### Migration

- 0.2.0 rejects malformed RTK v1 compaction metadata as unsupported instead of reporting zero-filled counters.

### Changed

- Deferred history UI selection and drill-down to the next web UI milestone; the current TUI intentionally covers only the current session.

## [0.1.0]

### Added

- M3 checkpoint, recovery, maintenance lease, and manifest-only history support.
- Per-writer WAL lifecycle timing with clock-rollback-safe recovery.

### Changed

- Released the approved v1 product, research, architecture, and implementation baseline.

## Versioning policy

Before `1.0.0`, a minor release may change public or persisted schemas only with migration support, fixture proof, and a migration note. Security/privacy and data-loss fixes may ship patch releases.
