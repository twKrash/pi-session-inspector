# ADR 0017: report coverage, attribution, and navigation authority

**Status:** accepted.

## Context

By `0.8.0` every report came from one canonical session pipeline (ADR 0016), but the report *surface* still made three classes of claim it could not support.

**Coverage.** The discovery/scan path collapsed seven distinct failure paths (five causes) into a bare `availability: "unavailable"`, and `loadGlobalReport()` summed usage over available sessions only, so a partial sum was presented as an unqualified total with no way for a reader to know how many discovered sessions had failed or why. History discovery is also capped (`MAX_HISTORY_SESSIONS = 206`), so the workspace denominator the UI would need for a percentage is unknown whenever the cap is hit.

**Attribution.** Range filtering existed only for the daily rows and the chart; every tab table rendered the full-period `SessionReport`, and two independent date-bucketing walks (`src/ui/bundle.ts` `dailyRows`, `src/ui/html.ts` `buildDailyActivityRows`) could disagree with each other and with the canonical builder about which UTC date a usage line belongs to. A "7-day" page could show a 7-day cost next to unlabelled all-period models, tools, agents, errors, and composition.

**Navigation and completion.** The client held one mutable `state` object with no route at all: no hash, no Back/Forward, no deep links, and controls whose active styling was synced by their own click handler rather than derived from state. Command completion returned bare tokens (`{ value: "--theme" }`) into a provider (`@earendil-works/pi-tui@0.85.1`) that replaces the *entire* argument region, so completing `/session-ins ui --th` produced `/session-ins --theme` and destroyed `ui`.

Each of the milestone's contracts could have been implemented in more than one place, and each had a cheaper dishonest alternative (invented `$0`, an extrapolated ratio, a re-derived date walk, a hand-maintained client tab matrix, a per-token completion re-join). This ADR records the boundaries that were chosen so the honest behaviour has exactly one implementation. Pi persisted data stays the billing/source authority (ADR 0002), the Inspector stays observer-only and local-only (ADR 0001, ADR 0011), child usage stays a breakdown (ADR 0007), unknown formats degrade to diagnostics rather than guesses (v1 spec §11), and nothing new is persisted.

## Decision

### Coverage is a report aggregate with an explicit unknown denominator

`SessionCoverage` (`src/core/session-coverage.ts`) is added as an optional `coverage?` on `HistoryReport` and `GlobalReport`, and `CoverageReason` as an optional `sessions[].reason` on unavailable rows. The binding rules:

- `inspected` is the capped discovery set; `available + unavailable === inspected` always, so a renderer can never show a fraction that does not close.
- `complete` is true only when `inspected > 0`, every inspected session replayed, discovery was not capped, and the report's own `availability` is `"available"`. An **empty** inspection set is not complete.
- `sessionRatio` is `available / inspected` rounded to 4 decimals, and is **`null`** when `inspected === 0` or when discovery was capped. A ratio over an unknown workspace denominator would assert coverage that was never measured, so the capped case renders counts and no percentage.
- When the report itself is `unavailable`, `coverage` is **omitted** — the aggregate is unavailable, not zero.
- `CoverageReason` is a *runnability* vocabulary layered on codes that already exist: every member maps onto an `EvidenceDiagnosticCode` or `HistoryDiagnostic` (`COVERAGE_REASON_CODES`, asserted total by test). No third diagnostic vocabulary exists, and no filesystem error string or producer text can enter it.
- Wording is part of the contract, not styling: partial aggregates read `Known native cost` / `Known tokens`; agent and tool breakdowns read `Known child …` / `Known tokens` with their `n of m` fraction; unavailable never renders as `$0.00` or `0`. No partial figure is **headlined** `Total`; the JSON field name `usage.total` and its `Total` detail-row label are kept for compatibility.

Per-day coverage is deliberately **not** rendered: an unreadable session's dates are unknown, and the coverage line is the only honest statement about it.

### Attribution is implemented once in the canonical builder and only projected

Every usage line in the canonical builder carries `attributedAt`, `domain` (`native-session` / `child-breakdown`), and `bucket` (`generation` / `tool-result` / `compaction` / `branch-summary` / `child-run`). The normative rule is **logical-call attribution**:

| Evidence | Date comes from |
| --- | --- |
| generation usage | `Generation.timestamp` |
| tool call identity, status, and its attached usage | `Tool.timestamp` (the call time) |
| tool error event | `ErrorRecord.timestamp` (observation time) |
| child run | `AgentRun.observedAt` (publication time of the publishing result) |
| compaction / branch summary | its own persisted entry timestamp |

No start time, end time, or duration is ever inferred, and a cross-midnight call therefore splits its usage (call day) from its error (observation day) by design.

Exactly one dated projection exists: `sessionDatedUsage(session)` in `src/ui/dated-usage.ts` reads the builder's `usage.lines` and joins per-date model rows to their line by `ownerId`. Every production consumer — the current views, history/global, and the folded chart rows — consumes those rows. The report is used to **assert** reconciliation (`sum(usageByDate) === SessionReport.usage`), never to produce the dates, and no second walk of `SessionReport` timestamps is permitted. There are **two** documented exceptions: the legacy single-section `renderHtml(HtmlReport)` adapter (no production caller; deferred), whose current-view daily rows keep the pre-attribution `buildDailyActivityRows` bucketing because it has no canonical session to project from; and the production `sessionView` path's `sessionSpanMs`/`reportDates` in `src/ui/html.ts`, which walk native record timestamps to produce one **span/duration label** (`evidence.span`, the Overview Duration card) and the history entry's first/last dates — never a per-date usage figure, which stays the dated projection's. Tools, agents, and errors are filtered from their own canonical rows (one row per call/run/error); date-indexed duplicates for them are explicitly rejected.

### One truncation flag for every partial per-session dated window

A per-session `usageByDate` window (≤ 366 newest dates) carries **one** boolean, `usageByDateTruncated`, set when the window cannot represent the session's whole native usage for any of three reasons: the 366-date cap dropped older dates, at least one native usage line has no known `attributedAt` (`evidenceHealth.usage.dated === "partial"`), or the usage aggregate itself is unavailable/overflowed while native lines exist. All three causes share the one flag, one `Known` qualifier, one render path, and one bounded diagnostic (`history-daily-truncated`). The same flag is published on global aggregate rows (`GlobalSessionRow.usageByDateTruncated`, a required field) so a partial contribution makes the aggregate visibly partial. `dated === "unavailable"` with zero native lines is **not** truncation: there is simply nothing to date. Omitted history is never silently excluded, never counted as zero, and never extrapolated.

### The child-usage fraction is derived, never integration evidence

`SessionReport.agentUsage = { runsTotal, runsWithUsage }` is computed in `toSessionReport` from the already-projected run set, and the browser recomputes the same fraction from the rows it is currently rendering so a range filter narrows the fraction instead of reusing a full-session count. It is never added to `SubagentEvidence` or any other integration-evidence type: integration evidence describes what the producer published, while a completeness fraction over projected rows is a report concern. Child usage remains a breakdown and is never added to any session/native/model/history/global total (ADR 0007).

### Environment facts and session activity are separate claims

Inventory (commands, skills, resource sources) is **environment** state: `state` + `count` + `items`, never a "used"/"invocation" claim, and never range-filtered (it is labelled `Current environment`; `Session total` labels the integration row's activity cell, v1 spec §13.2). Skill invocation counts come only from explicit folded counters (`SkillInventory.invocationState`/`invocationCount`/`otherInvocations`), never from inventory presence. Integration rows keep four independent columns: existence (`presence`), telemetry (`state` + bounded reason), activity (allowlisted counters or `Unavailable`), and `version`. Detection and telemetry are deliberately independent (ADR 0009, ADR 0014); a `presence: "absent"` row with persisted telemetry is rendered as-is and is never "reconciled" into a single state. Absent counters and absent versions render `Unavailable`, never `0`.

### The route is the single authority for navigation state

`src/ui/route.ts` is a pure, inlined, total parse/serialize/derive module. The hash (`#/…`, design ruling R5: works from `file://` and inside the single generated document) is the only route carrier, with one canonical parameter order (`scope, preset, from, to, session, entity, q, sort`) so one route has exactly one string. Parsing never throws: an unknown section/tab/option/date degrades to the section default with a bounded one-line notice, an id outside the payload's known-id set is dropped and never echoed, and an invalid (`from > to`) or half range pair is not applied at all. All rendering state — active section, active tab, scope buttons, range controls, search/sort values, focus target — is derived from the route; click handlers only mutate the route.

Ranges are keyed by **view identity** (`current`, `history:aggregate`, `history:<sessionId>`, `global`) so a selected session does not inherit the aggregate's range. The **active** view's range and table state are part of the route (and therefore of deep-link reproducibility); ranges and table settings of inactive views are **ephemeral in-memory caches** that die with the document and are explicitly not deep-link state. Discrete route changes (section/tab/scope/session/entity/range-preset/custom-range/sort) **push** a history entry so Back restores the prior state; only in-progress search typing **replaces** the current entry. The tool summary → calls filter is per-identity ephemeral client state, not route state, and pushes nothing. In an environment that refuses the History API (a `file://` document raising `SecurityError`), both rewrites are best-effort: the document still renders, a refused canonicalization keeps the applied route in memory, and a refused in-progress replacement falls back to a same-document hash assignment (costing one entry per keystroke there only).

Capabilities are computed server-side per section from the data contract (`current`, `history` aggregate, the session-selected `historySession` set, `global`), and the client renders only capable tabs — no tab leads to a guaranteed-`Unavailable` page. The TUI keeps its own fixed tab list and consumes the same `SessionReport` (v1 spec invariant 25); this ADR re-taxonomizes only the browser surface.

### No Agent → Models link

An agent run's `model` is a different usage domain from `SessionReport.models` (native parent-session generations). A matching model name is not evidence of identity, so no Agent → Models navigation target exists even when the strings are equal; the child's model/thinking stay bounded metadata inside the agent detail panel. Cross-navigation exists only where a real destination exists in the same projection (tool ⇄ error, agent ⇄ parent/child, error → related child runs, inventory rows → their panel).

### Completion rewrites the full argument text, and states the pinned-API limit

`completeInspectorCommand(prefix)` keeps its signature and grammar decisions, but every returned item's `value` is the **full replacement argument text**: the raw prefix with only the current raw token span replaced, where the span is located on the raw string (quotes included) and every preceding character is copied byte-identically. This is required because the pinned provider calls `getArgumentCompletions(argumentText)` with the whole argument region and `applyCompletion` replaces that whole region; a bare token value corrupts every preceding argument (and a token re-join would strip quoting, e.g. `--output "/tmp/my report.json"`). The span-aware scanner and the parser tokenizer share one scanning core.

The pinned `@earendil-works/pi-tui@0.85.1` API cannot satisfy the design's mid-token row: `getSuggestions` hands the extension only the pre-cursor text, and `applyCompletion` composes `currentLine.slice(0, cursorCol - prefix.length) + item.value + currentLine.slice(cursorCol)`, so it appends the post-cursor remainder verbatim after the rewritten value. Completing with the cursor inside the token (`/session-ins ui --the|me`) therefore yields `/session-ins ui --thememe`, and no extension-side `value` can prevent that append. The milestone records the actual composition and pins it with a test against the real provider instead of asserting an unreachable result. Pi needed no change and is not patched.

### No new persistence

Every field above is read-time projection or derivation: no new persisted field, no collector, no WAL/checkpoint/retention change, no schema migration, no `schemaVersion` bump, no changed command surface, and no Pi mutation beyond the existing tracking marker. Generated-document additions (`sameReportProjection`, per-date model rows, daily composition, per-section capabilities, per-session dated rows, coverage) stay inside the generated document and are additive; `schemaVersion` stays `1` because no reader exists for generated documents.

## Alternatives considered

- **Render the history/global usage as an unqualified total** (the `0.8.0` behaviour): rejected; a partial sum presented as a total is exactly the defect this milestone removes.
- **Show a coverage percentage over the capped discovery set**: rejected; the capped set has an unknown workspace denominator, so the ratio would assert unmeasured coverage. Counts plus "additional sessions not inspected" is the honest form.
- **Introduce a coverage-specific diagnostic vocabulary**: rejected; `CoverageReason` projects onto existing `EvidenceDiagnosticCode`/`HistoryDiagnostic` values, and a totality test makes a new reason name its code.
- **Compute per-date rows in the browser from `SessionReport` timestamps**: rejected; it would be a second attribution implementation, and the two pre-existing date-bucketing builders already disagreed with each other.
- **Publish per-day coverage for unavailable sessions**: rejected; their dates are unknown, so only the overall coverage line is honest.
- **Extend `SubagentEvidence` (or a peer evidence type) with a usage-completeness fraction**: rejected; integration evidence must describe the producer's publication, and a fraction over projected rows is derived report state that a range filter must be able to narrow.
- **Add a duration to child runs by differencing `observedAt` values**: rejected; `observedAt` is publication time, and a difference would be an estimate (v1 spec invariant 11).
- **Keep a hand-maintained client tab matrix**: rejected; capabilities are derived server-side from the data contract so a DTO change cannot leave a dead tab.
- **Keep inactive range/table memories in the hash**: rejected; two sources of truth for navigation state recreate the original active-state bug.
- **Let a discrete route change replace instead of push**: rejected; Back would then not restore the state the user came from.
- **Keep returning bare completion tokens and "replace only the token"**: rejected; the pinned provider exposes no per-item replacement range, so the full-argument rewrite is the smallest upstream-compatible approach, and re-joining stripped tokens would change quoting semantics.
- **Link `AgentRun.model` to the Models tab**: rejected; different usage domains joined by a name match.
- **Aggregate per-model/per-tool/per-agent breakdowns across history/global in this milestone**: rejected as deferred, not unsupported; the evidence exists (every scanned session is replayed) but the milestone deliberately does not aggregate it, and no tab is offered that would render `Unavailable` (see the v1 spec's unsupported/deferred list).
- **Persist any of the new values**: rejected; all of it is derivable at read time, and persistence would create a second authority beside Pi and the WAL.

## Consequences

A reader can now tell the difference between "the workspace is fully covered" and "5 of 27 inspected sessions replayed, and 22 are unavailable for these bounded reasons": coverage counts close, the ratio is omitted whenever the denominator is unknown, and no partial figure is headlined `Total`. Range-filtered numbers come from one dated projection over the canonical builder's own attribution, so a per-date figure can only differ from the report if the builder is wrong — one place to fix — and a cross-midnight call is documented, deterministic behaviour rather than a rounding accident. Navigation has a single authority: Back/Forward, deep links, reloads, and the visible active controls all derive from one route string, with inactive memories deliberately ephemeral.

The costs are explicit. The generated document grew substantially: measured 69,221 B before the range slice → 84,039 B after it (inlined range module +5,292 B, client range machinery +7,131 B, catalog +331 B, payload +607 B; the mechanism alone is +5,292 B and the design mandates `Function.prototype.toString()` inlining) → 105,882 B before the routing slice → 126,663 B at Task 14 → 139,327 chars before the final review-fix wave → **140,107 chars / 140,285 bytes** at release (+70,886 chars, +102.4 % over the pre-slice baseline). The design's P0-B ≤ +15 % gate is therefore **knowingly exceeded** (ruling R12), recorded here with the measured breakdown rather than traded away by cutting spec-mandated behaviour; the generated document remains one self-contained offline file with no network access. `usage.total` keeps a field name whose `Total` label survives on detail rows only, never as a partial figure's headline (compatibility over cosmetics). Child-run usage stays a fraction of whatever the producer published, so an absent producer still reads `Unavailable`. The mid-token completion limitation is recorded and pinned rather than fixed, because it lives in the pinned provider's `applyCompletion` contract and patching Pi is out of scope. Capabilities must be updated whenever a section's DTO changes — one server-side table instead of a client matrix. And history/global expose only Overview until a later milestone adds cross-session breakdowns from the per-session reports that already exist.

See ADR 0006 (scope semantics), ADR 0007 (child roll-up), ADR 0009 and ADR 0014 (integration presence vs telemetry), ADR 0011 (privacy), and ADR 0016 (the canonical pipeline these projections must not duplicate) for the contracts this ADR sits between. The shipped design authority is `docs/superpowers/specs/2026-09-12-report-semantics-diagnostics-navigation-design.md` (including its post-implementation execution amendments) and the normative requirements are in `docs/specs/pi-session-inspector-v1.md` §13.
