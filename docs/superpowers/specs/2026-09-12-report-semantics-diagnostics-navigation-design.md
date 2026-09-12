# Report semantics, diagnostics, and navigation — design

**Status:** proposed (awaiting human approval). **Date:** 2026-09-12.
**Scope:** the Inspector renderer/report surface (`ui`, `tui`, `json`), the
history/global coverage contract, range/scope semantics, projection integrity,
agent/tool/error relationships, environment/integration semantics, offline
navigation, and `/session-inspector` argument completion.
**Non-goals:** M8 hardening (fuzzers, clean-machine install, CI), collectors,
new persisted fields, upstream Pi changes.

This is an architectural design. It contains no implementation and authorizes
no code change until approved.

---

## 0. Re-baseline against `main` (v0.8.0) — amendment

`main` advanced to v0.8.0 (`910a665`, PR #1 "evidence foundation") while this
design was being written. Every contract below was re-read against the pipeline
that exists now. **Where §1-§18 and this section disagree, this section wins**, and
the affected sections carry an inline pointer.

### 0.1 The pipeline the contracts must speak to

| Stage | Module | What it is now |
| --- | --- | --- |
| L1 canonical builder | `src/core/canonical.ts` (`buildCanonicalSession`) | Single authority for scope (`resolveScope`, R16/R49), usage attribution, retained aggregates and evidence health. A session it does not resolve to `state === "ready"` is `unavailable` |
| L1 attribution | `CanonicalUsageLine` | Every usage line carries `domain` (`native-session` / `child-breakdown`), `bucket` (`generation` / `tool-result` / `compaction` / `branch-summary` / `child-run`) and `attributedAt`. Tool lines are attributed to the **call** timestamp, child runs to `observedAt`, compactions to their own entry; `usage.dated` health is `supported` only when every native line has a known `attributedAt` |
| L1 health | `src/core/evidence-health.ts` | `SessionEvidenceHealth`, closed `EvidenceDiagnosticCode` set (incl. `source-not-found`, `source-malformed`, `source-format-unsupported`, `tracking-marker-missing`), `EvidenceHealthState` |
| L2 projection | `src/ui/l2-projection.ts` | Projects only L1's verdicts; unavailable usage stays unavailable and never republishes raw reduce totals |
| L2 loaders | `src/ui/load-current.ts`, `src/ui/load-history.ts` | Build the canonical session twice (scope resolution, then with cooperative subagent evidence), then `toSessionReport` |
| DTO | `src/core/reports.ts` (`toSessionReport`, `projectAgent`) | Already re-validates `observedAt`, `evidenceToolId`, `agent`, `artifacts`, `model`, `thinking`, `failure` per run |
| browser | `src/ui/bundle.ts` → `src/ui/html.ts` | One `CurrentView` per scope with precomputed `daily` rows, one `currentViewProjection`/`sectionProjection`, one inlined client script |

### 0.2 Consequences that change this design's text

1. **Naming (R18).** The canonical model already owns `UsageCoverage`
   (owners/ownersWithUsage per usage bucket). This design's aggregate is *session*
   coverage: it is named `SessionCoverage`, built by `buildSessionCoverage`, and
   lives in `src/core/session-coverage.ts`. §3.1's `CoverageSummary` /
   `buildCoverage` names are superseded; every **field** stays as specified.
2. **Attribution is not re-derived (R19).** §5.4/§5.7's per-date rows
   (`usageByDate`, `DailyRow.composition`, `DatedModelRow`) come from the
   canonical builder's own attribution (`CanonicalUsageLine.attributedAt`,
   `domain`, `bucket`), never from re-walking `SessionReport` timestamps in a
   second implementation. The report is used to **assert** the reconciliation
   (`sum(usageByDate) === SessionReport.usage`), not to produce the dates.
3. **Coverage reasons integrate with evidence health (R20).** `CoverageReason` is
   a *discovery/runnability* vocabulary in which every member maps onto an
   existing bounded code (`EvidenceDiagnosticCode` or `HistoryDiagnostic`). It
   starts no third vocabulary. Mapping in §3.1.
4. **Already implemented on `main` — absorbed.** §6.3's rows for agent role,
   artifacts, `observedAt`, `evidenceToolId`, tool timestamp, model, thinking and
   failure class are **done** (the DTO validates all of them). Still missing:
   §7.2's `runsWithUsage` fraction, and every browser projection of those fields
   (§0.2 item 8 below is the only remaining renderer work for them).
5. **§3.2 rule 7 is corrected.** `loadHistoryReports` and `loadGlobalReport` each
   call `scanHistory`; they do **not** share one scan object. Coverage is a
   deterministic function of the same inputs, so the two agree exactly and §3.4's
   equality criterion stands, but the design must not claim a shared scan that
   does not exist.
6. **`scanHistory`'s failure paths are richer than §3.2 assumed.** A session
   becomes `unavailable` when (a) the source cannot be resolved or parsed,
   (b) the header/id/marker re-check fails, (c) the injected evidence provider
   returns nothing or throws, (d) `buildCanonicalSession` is not `ready`, or
   (e) the report projection throws. §3.1's reason set covers all five without a
   new filesystem probe: (a)+(b) split into `session-unreadable` /
   `marker-unavailable`, and (c)-(e) are `replay-failed`.
7. **Verified client facts** (they define the P1-F diff): the sidebar sets
   `aria-pressed` once at creation and never re-syncs; tab buttons re-sync only
   inside their own click handler; `periods` is keyed by section alone; a custom
   range is silently clamped into the observed min/max; `defaultPeriod` returns a
   `1970-01-01` sentinel for an empty row set; history membership is span overlap
   (`entry.firstDate <= to && entry.lastDate >= from`); `TABS` lists `commands`
   and `skills` as separate tabs.
8. **`@earendil-works/pi-tui@0.85.1` is installed** (peerDependency; the type
   import already resolves in `src/commands/completions.ts`), so P1-G needs no
   `package.json` change. Its `CombinedAutocompleteProvider(commands, basePath,
   fdPath?)`, `getSuggestions(lines, cursorLine, cursorCol, {signal, force})` and
   `applyCompletion(lines, cursorLine, cursorCol, item, prefix)` are the boundary
   the regression test must drive.
9. **Duplicate daily-row builders.** `src/ui/bundle.ts` (`dailyRows`) and
   `src/ui/html.ts` (`buildDailyActivityRows`) bucket dates independently, and
   neither can see the canonical attribution (the bundle holds a `SessionReport`).
   P0-B introduces `src/ui/dated-usage.ts`, attaches its rows to the current model
   and to `HistoricalSession`, and reduces both builders to a fold over those rows
   (spec §5.4, R19).
10. **Version targets.** The release slice targets **0.8.0 → 0.9.0**; the new ADR
    is **0017** (0016 is the evidence foundation).

### 0.3 Absorbed work items (no longer plan tasks)

| Removed item | Why |
| --- | --- |
| `AgentRun.observedAt` / `evidenceToolId`, the join shape, the "cannot join ⇒ publish no run" rule | Implemented in `src/integrations/subagents.ts` (`JoinedResult`, `publicationOf`, `mergeRunObservation`) and consumed by `load-current.ts`/`load-history.ts` |
| `AgentRun.model` / `thinking` / `failure` derivation | Implemented in `src/integrations/subagents.ts` (`readAgentFailure`, model/signal grammars) and re-validated in `projectAgent` |
| `@earendil-works/pi-tui` as a new devDependency for P1-G | Already a peerDependency, already installed |

The cross-midnight **fixture and its regression test are kept**: they move into
the range slice (§5.7 is exactly the contract they prove).

### 0.4 Unchanged by the re-baseline

Classification of every requested change (§2), the coverage wording rules (§3.3),
the scope contract (§4), range semantics and validation (§5.1-§5.3, §5.5, §5.6),
the one-projection rule (§6.2), the three-concept agent/tool/error model (§7.1,
§7.4, §7.5), environment vs activity (§8.1), routing (§9), autocomplete (§10),
privacy (§11.1), the unsupported/deferred verdicts (§15) and the rulings (§17)
all remain in force; only the *derivation source* and the *file anchors* changed.

---

## 1. Verified current state (facts this design builds on)

> Statements in this section were read from `main` at `ddcbe36`, before the
> v0.8.0 merge. **Line numbers below refer to that revision** and have since
> drifted; the scope semantics (§1.1), the coverage gap (§1.2), the range
> behaviour (§1.3), the browser projection losses (§1.4), the error/tool join
> (§1.5), the autocomplete root cause (§1.8) and the command surface (§1.9) were
> re-verified **by content** at `81f65b7`, and §0.2 item 7 records the current
> anchors. Where the merged pipeline changed a claim, §0 supersedes it.

Every statement below was read from current `main` (`ddcbe36`), the pinned Pi
`0.85.1` install, or the real session corpus under
`~/.pi/agent/sessions/--home-dvory-code-pi-session-inspector--/`. Where a claim
contradicted an assumption in the request, the code wins and the difference is
called out.

### 1.1 Scope

- `Scope = "active" | "tree"` (`src/core/events.ts:1`).
- `selectScope(entries, leafId, scope)` (`src/pi/sessions.ts`, used by
  `src/ui/load-current.ts:46` and `src/ui/load-history.ts:164`) implements
  ADR 0006: **active** = selected leaf plus its parent ancestry, after the
  tracking marker; **tree** = all post-marker entries in append order.
  Siblings and off-path descendants are excluded from active.
- ADR 0006 already states: "Reports describe a branch as selected leaf/path,
  never manufacture a native branch ID."
- Current UI labels are `Active ancestry` / `Full tree` (`scope.active`,
  `scope.tree` in the catalog); the context note reads
  `<label> after tracking marker` (`src/ui/html.ts:1366`).

### 1.2 Coverage (the P0 correctness gap)

- `discoverHistory()` (`src/storage/history.ts`) lists Inspector-owned session
  directories, capped at `MAX_HISTORY_SESSIONS = 206`, and resolves each one
  through: metadata or pending manifest → source file resolvable inside Pi's
  public session directory → native tracking-marker evidence in that file.
- Failure of any step collapses to `availability: "unavailable"` with **no
  per-session reason**. Reasons survive only as a de-duplicated report-level
  `HistoryDiagnostic` set: `history-limit-reached`, `history-unavailable`,
  `manifest-unavailable`, `marker-unavailable`.
- `loadHistoryReports()` maps discovery rows to `HistoricalSession`, and
  `loadGlobalReport()` folds usage **only over available sessions**
  (`src/ui/load-history.ts`: `if (session.availability !== "available") continue;`).
- `GlobalReport.usage` is therefore a partial sum presented as a total. The
  HTML client renders no diagnostic and no coverage information at all
  (no i18n key references any `HistoryDiagnostic`).
- Consequence: a workspace with 5 replayable sessions and 22 unreadable ones
  shows one unconditional usage figure. This is the defect Workstream A fixes.

### 1.3 Range

- The client keeps `periods[state.section]` — **one period per section** — lazily
  initialised from `defaultReportPeriod(kind, daily)`: `current` defaults to the
  full observed span with `preset: null`; history/global default to `14` days
  ending at the latest observed UTC day. Never reads the machine clock
  (`src/ui/html.ts:716-741`), so exports stay byte-identical.
- Presets `7D`/`14D`/`30D` compute `end = latestObservedDate`, `start = end - (n-1)`.
- The custom dialog clamps typed values into the observed min/max, then requires
  `from <= to`; on failure it shows `range.error` ("From must be on or before
  To.") and keeps the dialog open. Other values are replaced by the clamp
  without telling the user.
- **Range currently filters only the daily row set and the chart**
  (`filter(row => row.date >= period().from && row.date <= period().to)` and
  `activeDaily()`). Every tab table — Models, Tools, Agents, Errors, Integrations,
  Commands, Skills, Ledger — is rendered from the full-period `SessionReport`.
  The range caption (`tr("table.date") + period().from → period().to`) appears
  only under the range-filtered overview metrics; the full-period tab tables
  carry **no** period label at all. A "7-day" page therefore shows a 7-day cost
  metric next to unlabelled all-period models, tools, agents, errors and
  composition. This is the defect Workstream B fixes.

### 1.4 Report → bundle → HTML projection

- `InspectorBundle` (`src/ui/bundle.ts`): `schemaVersion: 1`, `theme`,
  `initialScope`, `current: { active, tree }` (both replayed at generation
  time), `history`, `global`. Per view: `availability`, optional bounded
  `diagnostic`, `report`, `daily` (≤ `MAX_DAILY_ROWS = 366`, newest window,
  `dailyTruncated`).
- Verified losses in the browser projection (`src/ui/html.ts`):
  - `agentRows()` drops `AgentRun.agent` (the role label: `delegate`, `worker`,
    `reviewer`, …) and `AgentRun.artifacts`;
  - `toolRows()` drops `Tool.timestamp` even though `Tool.id` is kept;
  - `modelRows()` carries no dates, so no model figure can be range-filtered;
  - `AgentRun` itself has **no timestamp** — the producer rows do not carry one
    either, but the persisted tool-result entry that publishes a run does, so a
    run timestamp is derivable in the adapter (see §6.3).
- `SessionReport` (`src/core/reports.ts:170`) is the canonical report DTO and is
  what `json current` writes verbatim; `json history|global` write
  `HistoryReport`/`GlobalReport` verbatim (`src/index.ts:580-608`). The DTOs are
  the machine contract; the bundle payload is the browser contract.

### 1.5 Agents, tools, errors

- `AgentToolActivity` (`src/integrations/subagents.ts:28`): native subagent
  **tool** activity — `calls`, `succeeded`, `failed`, `interrupted`,
  `tools[{name, calls}]`, optional `usage`. This is not a child-run count.
- `AgentRun` (`src/core/events.ts`): child runs discovered from persisted tool
  results — `id` (opaque `subagent-<sha256>`), optional `parentId`, optional
  bounded `agent` label, `status`, `confidence`, optional
  `artifacts: available | missing`, optional `usage`.
- Errors: a failed tool call pushes `{ id: tool.id, kind: "tool-error" }`
  (`src/core/reduce.ts:107`), where `tool.id === "tool:" + callId`. **The error
  id is the tool id** — the join is exact and already present. Tool errors carry
  no `message`; only generation errors can carry a bounded redacted
  `errorMessage`.
- Verified renderer state (client script): the Errors table's first column is
  `table.id` — the raw `tool:call_…` string is the primary identity. The Agents
  tab renders two unrelated things in one panel: first a `panel.activity` block
  whose headline metric is labelled `metric.agentCalls` (native
  `subagent`/`subagent_wait`/`subagent_supervisor` tool calls), then the
  child-run table whose first column is `table.run` = the opaque
  `subagent-<sha256>` id, with **no** role column even though `AgentRun.agent`
  exists in the payload. This is the defect Workstream D fixes.
- Real-corpus check (400 tool-result entries): tool results persist
  `{content, details?, isError, role, timestamp, toolCallId, toolName}` — there
  is **no structured error field**. For failed calls, `details` is either empty
  or an unrelated integration payload (`metadata`/`rawDetails`/`rtkCompaction`
  from the rtk optimizer). `content` is arbitrary tool output and stays outside
  the privacy boundary. Therefore a tool-error message is **unsupported by safe
  evidence** (§15), and "Unavailable" is the correct rendering.

### 1.6 Child-run evidence actually available

From the pinned `pi-subagents@0.59.0` producer (real `details` payloads):

| Path | Fields | Privacy verdict |
| --- | --- | --- |
| `details.results[]` | `agent`, `model`, `thinking`, `index`, `exitCode`, `outputState` (`present`/`absent`), `processSignal` (e.g. `SIGTERM`), `attemptedModels`, `modelAttempts`, `usage{cacheRead,cacheWrite,cost,input,output,turns}`, `toolCalls`, `effects`, `acceptance`, `mode`, `detached`, `detachedReason` | bounded scalars → usable after validation |
| `details.results[]` | `task`, `finalOutput`, `progressSummary`, `transcriptPath`, `sessionFile`, `artifactPaths`, `sessionName` | **never exposed** (raw task/output text, paths) |
| `details.completions[]` | `agent`, `runId`, `state` (`complete`/`failed`), `success`, `mode`, `workflowChildren`, `archivePath` | bounded scalars + opaque id → usable; `archivePath` validated only, never exposed |
| `details` | `totalChildUsage`, `totalCost` (dicts) | aggregate; only usable if it matches the sum of validated per-child rows |

Consequence: `model` and `thinking` per child run **do exist** as safe evidence
for the pinned producer, and duration does **not**. `outputState`, `exitCode`
and `processSignal` give a bounded, structured failure *classification* (not a
free-text reason). These are projection changes, not new persistence.

Provenance and cardinality (verified in `src/integrations/subagents.ts`): the
result → run join is keyed by the **persisted tool-result `message.toolCallId`**
(`collectResult`), which is the same id the reducer turns into `tool:<callId>`.
One tool result may publish **several** child runs (`details.results[]` and
`details.completions[]` are both iterated), so tool → child is **one-to-many**;
the DTO exposes no field that could imply a unique child.

### 1.7 Navigation

- The client holds one mutable `state` object
  (`{section, scope, tab, session, query, sort, metric, resetScroll}`,
  `src/ui/html.ts:1312`) and **no routing whatsoever**: no `location.hash`, no
  `pushState`, no `popstate`, no deep links, no history restoration.
- Sidebar buttons set `aria-pressed` once at creation and their click handler
  never re-syncs siblings (`src/ui/html.ts:1359`); tab buttons re-sync siblings
  only inside their own click handler (`src/ui/html.ts:1360`). Any state change
  that does not originate from that button's own click (e.g. section click
  forcing `state.tab = "overview"`, or a future internal link) leaves the wrong
  control visually active. `syncScope()` re-syncs scope buttons on every render,
  which is why the scope control behaves and the others do not.
- `renderView()` renders an `unavailableSection(...)` page for unsupported
  section/tab combinations (global + anything but overview, history aggregate +
  anything but overview) while the tab buttons stay enabled → users can navigate
  into dead pages.
- Table CSS is global: `table { white-space: nowrap }` and
  `td:last-child { text-align: right }` (`src/ui/html.ts:418`).

### 1.8 Autocomplete (root cause, verified in the pinned Pi TUI)

- Extension wiring: `pi.registerCommand(name, { …, getArgumentCompletions:
  (prefix) => completeInspectorCommand(prefix) })` (`src/index.ts:459-462`).
- `@earendil-works/pi-tui@0.85.1` (`dist/autocomplete.js`):
  - for slash-command arguments it calls
    `command.getArgumentCompletions(argumentText)` where `argumentText` is
    **the entire argument string** after the command name and space
    (`autocomplete.js:235-244`), and returns
    `{ items, prefix: argumentText }` (`:248-251`);
  - `applyCompletion` takes the command-argument branch (`:304-319`) and
    computes `beforePrefix = currentLine.slice(0, cursorCol - prefix.length)`
    then `newLine = beforePrefix + item.value + adjustedAfterCursor`.
- Therefore the **whole argument region is replaced by `item.value`**. The
  Inspector returns bare tokens (`{ value: "--theme" }`), so selecting that item
  on `/session-ins ui --th` yields `/session-ins --theme`, destroying `ui`.
  Confirmed cause of the reported bug; it is an extension-side contract
  mismatch, not a Pi defect, and no upstream change is required.
- Current tests (`tests/unit/command-completions.test.ts`) only assert the
  returned item set, which is exactly the blind spot the request identifies.

### 1.9 Command surface (unchanged by this design)

`ui` (no target) · `tui current|ledger` · `json current|history|global`, options
`--scope`, `--theme` (ui), `--output` (ui, json), `--no-open` (ui). Legacy
`/session-ins report …` syntax is already rejected. Nothing in this design adds
a mode, a target, or an option.

---

## 2. Classification matrix

| # | Requested change | Class | Notes |
| --- | --- | --- | --- |
| A1 | Coverage DTO (inspected/available/unavailable/ratio/reasons) | deterministic report derivation | `discoverHistory` + `scanHistory` already compute availability and diagnostics; only per-session reasons and assembly are new. Unknown denominators from the discovery cap are handled explicitly (§3.2) |
| A2 | Per-session bounded unavailable reason | deterministic report derivation | new enum field on `HistoricalSession`; no persistence |
| A3 | Discovery-truncation surfacing | deterministic report derivation | `history-limit-reached` already exists; the cap also disables the ratio (§3.2) |
| A4 | "Known usage" wording + never-zero for unavailable | renderer-only | HTML/TUI labels + i18n |
| A5 | Per-day coverage | **unsupported** | dates of unreadable sessions are unknown (§15) |
| B1 | One range-filtered projection shared by all tabs | deterministic report derivation + renderer | per-date rows only for aggregates (models, composition); tools/agents/errors filter their canonical rows (§5.4) |
| B2 | Explicit range contract (presets, UTC, inclusive, custom, persistence, truncation) | renderer-only + contract doc | some validation semantics change (see §5.3) |
| B3 | Scope labels/descriptions + "same report data" note | renderer-only + one derived flag | `sameReportProjection` computed at bundle time; the copy claims report equality only (§4.3) |
| C1 | Browser-facing canonical DTO (one projection) | renderer-only | single projection function; delete per-tab ad-hoc shaping |
| C2 | Tool timestamp in browser rows | renderer-only | value already in `Tool.timestamp` |
| C3 | Agent role + artifact availability in browser rows | renderer-only | values already in `AgentRun` |
| C4 | Agent run timestamp | deterministic report derivation | from the publishing tool-result entry (`entry.timestamp`) |
| C5 | Agent model / thinking level | deterministic report derivation | present in `results[].model` / `.thinking` for the pinned producer; validated and optional |
| C6 | Agent bounded failure classification | deterministic report derivation | `state`/`success`/`exitCode`/`processSignal`/`outputState` enums |
| D1 | Agents summary = child runs, not `agentActivity.calls` | renderer-only | both values already in the payload |
| D2 | Agent tool activity shown separately | renderer-only | `agentActivity` already in the payload |
| D3 | Parent/child navigation + "outside selected scope" | deterministic report derivation + renderer | `parentId` resolution against the selected scope |
| D4 | Error/tool → child-run relation | deterministic report derivation + renderer | `evidenceToolId` from the persisted tool-result `message.toolCallId`; the relation is one-to-many (§7.5) |
| E1 | Tool↔error deterministic join | renderer-only | ids already identical |
| E2 | Error message for tool errors | **unsupported** | no safe structured field (§1.5) |
| F1 | Tools summary (calls/succeeded/failed/interrupted/known usage/last used) | deterministic derivation in the projection | all derivable from `report.tools` |
| F2 | Tools calls/timeline with timestamps | renderer-only | `Tool.timestamp` |
| G1 | Environment grouping (Commands/Skills/Resources) + explicit inventory-vs-activity copy | renderer-only | `SkillInventory.invocationState` already models the distinction |
| G2 | Integration Detected/Telemetry/Activity/Version split | renderer-only | all four already discrete fields in `IntegrationObservation` |
| G3 | Bounded telemetry-unavailable reason | deterministic report derivation | derived from `state` + presence, no new producer data |
| H1 | Authoritative navigation state + hash routing | renderer-only | new client module inside the single document |
| H2 | Active-state sync from state (sidebar + tabs) | renderer-only | fixes §1.7 |
| H3 | Section capability matrix (no dead tabs) | deterministic derivation server-side + renderer | computed from which DTO fields exist |
| H4 | Cross-navigation links | renderer-only | all targets already in the payload |
| H5 | Back/Forward + deep links | renderer-only | hash routing |
| I1 | Autocomplete replaces only the current token | renderer-only + one contract fix | `value` becomes the full rewritten argument string (§10) |
| I2 | Autocomplete regression at the Pi boundary | test-only | drives the real `CombinedAutocompleteProvider` |
| K1 | Global/History per-model/tool/agent breakdown tabs | **deferred (out of scope)** | full `SessionReport`s are available during the scan; this milestone deliberately does not aggregate and expose them (§9.3, §15) |
| J1 | Table alignment/wrapping rules | renderer-only | remove global `nowrap`/`last-child` rules |
| J2 | Decorative dashboards | **rejected** | YAGNI; drill-down instead |

"Renderer-only" means: no persisted field, no parser change, no new producer
contract — the value already exists somewhere in the pipeline and must survive
projection. "Deterministic report derivation" means: computed at read time from
already-persisted data, inside the existing adapters/reducers, and therefore
testable against fixtures.

---

## 3. Coverage contract (Workstream A, P0)

### 3.1 DTO

> Superseded names (R18, §0.2 item 1): the aggregate type is `SessionCoverage`,
> built by `buildSessionCoverage` in `src/core/session-coverage.ts`. Only the
> identifier changed, to stay distinct from the canonical model's `UsageCoverage`;
> the fields below are normative.

Both `HistoryReport` and `GlobalReport` gain one optional field:

```ts
/** Bounded reasons an inspected session could not be replayed. */
export type CoverageReason =
  | "no-manifest"          // neither metadata nor pending manifest was readable
  | "manifest-unavailable" // manifest exists, source file is missing/unresolvable
  | "marker-unavailable"   // source exists but tracking-marker evidence failed
  | "session-unreadable"   // parse failure, malformed JSON, no header, id mismatch
  | "replay-failed";       // provider/builder/report failed for this session

export type SessionCoverage = {
  /** Sessions discovery inspected (the capped set; see §3.2). */
  inspected: number;
  available: number;
  unavailable: number;
  /**
   * `available / inspected`, rounded to 4 decimals. **null** when `inspected`
   * is 0 **or** when discovery was capped, because a capped set has an unknown
   * workspace denominator. Sessions, never usage.
   */
  sessionRatio: number | null;
  /**
   * True only when `inspected > 0`, every inspected session replayed, **and**
   * discovery was not capped. An empty inspection set is **not** complete.
   */
  complete: boolean;
  /** True when discovery stopped at MAX_HISTORY_SESSIONS: more sessions exist, uninspected. */
  discoveryLimited: boolean;
  /** Bounded reason counts; keys with zero occurrences are omitted. */
  reasons: Readonly<Partial<Record<CoverageReason, number>>>;
};

export type HistoryReport = {
  availability: "available" | "unavailable";
  sessions: HistoricalSession[];
  diagnostics: HistoryDiagnostic[];
  coverage?: SessionCoverage; // absent = older report or discovery unavailable
};

export type HistoricalSession =
  | { availability: "available"; sessionId: string; report: SessionReport }
  | { availability: "unavailable"; sessionId: string; reason?: CoverageReason };
```

`GlobalReport` gains the same `coverage?`. `HistoricalSession.reason` is additive
and optional; when absent (older data, or a reason class that does not exist yet)
renderers must show "Unavailable", never a guessed reason.

#### 3.1.1 Reason vocabulary maps onto existing bounded codes (R20)

`CoverageReason` is a *runnability* vocabulary, not an evidence vocabulary. Every
member is a projection of a code that already exists, so no third vocabulary is
introduced and a hostile or unbounded value cannot appear:

| `CoverageReason` | Emitted when | Existing bounded code |
| --- | --- | --- |
| `no-manifest` | Discovery found neither metadata nor a readable pending manifest | `HistoryDiagnostic` `manifest-unavailable` |
| `manifest-unavailable` | Manifest exists; its source is missing, unresolvable, or rejected | `EvidenceDiagnosticCode` `source-not-found` |
| `marker-unavailable` | Source is readable but header/id/marker re-verification fails | `EvidenceDiagnosticCode` `tracking-marker-missing` |
| `session-unreadable` | JSONL does not parse, has no session header, or its id mismatches | `EvidenceDiagnosticCode` `source-malformed` / `source-format-unsupported` |
| `replay-failed` | Evidence provider absent/threw, canonical builder not `ready`, or the report projection threw | The session's own `evidenceHealth.diagnostics` (`source-format-unsupported`, `cooperative-evidence-conflict`, …) |

A table test asserts the mapping is total, so a new reason cannot be added
without naming the code it projects (`§13`).

### 3.2 Derivation rules (all read-time, no persistence)

1. `inspected` = number of rows returned by `discoverHistory()` — the **capped**
   set (at most `MAX_HISTORY_SESSIONS = 206`). `discoveryLimited` = the
   `history-limit-reached` diagnostic is present, which means further session
   directories exist that discovery never examined. `available` = rows that
   replayed; `unavailable = inspected - available`, so the three counts always
   add up and a renderer can never show a fraction that does not close.
2. `complete` = `inspected > 0 && unavailable === 0 && !discoveryLimited &&
   availability === "available"`. Two consequences are binding:
   a capped discovery is *not* complete even when every inspected session
   replayed (and the capped set may never be rendered as `206 / 206 sessions` or
   as any workspace-wide claim), and an **empty** inspection set is *not*
   complete — with `inspected === 0` the aggregate has nothing to measure, so its
   usage is `Unavailable`, never `$0` and never `Total`.
3. `sessionRatio` = `available / inspected` rounded to 4 decimals, and **null**
   when `inspected === 0` **or** `discoveryLimited === true`. A ratio over a
   capped denominator would assert workspace coverage that was never measured, so
   the UI omits the percentage entirely and states the counts instead. The ratio
   is a **session** ratio and is only ever rendered next to a session fraction,
   never next to a currency amount.
4. `reasons` is built from the per-session reason tags; the report-level
   `diagnostics` array is retained unchanged for backwards compatibility.
5. When report `availability === "unavailable"` (the sessions directory itself is
   unreadable or scope forces it), `coverage` is **omitted** — the aggregate is
   unavailable, not zero.
6. Reason mapping is deterministic and exhaustive, and each reason is the
   projection of an existing bounded code (§3.1.1). `load-history.ts` records the
   reason at each existing early return; `discoverHistory` gains a bounded reason
   in place of the bare `availability: "unavailable"` it returns today. No new
   filesystem probe is added: each reason already corresponds to an existing
   check that currently discards its cause. The five failure paths named in
   §0.2 item 6 are the complete set the loader must cover.
7. **Correction (§0.2 item 5).** `loadHistoryReports` and `loadGlobalReport` each
   call `scanHistory`; they do not share a scan object. Coverage is a
   deterministic function of the same discovery input and the same replay result,
   so history and global coverage are equal by construction, and the acceptance
   criterion is that equality — not a shared object.

### 3.3 Wording rules (the contract that makes the defect impossible to render)

| Condition | Cost/token wording | Session wording |
| --- | --- | --- |
| `coverage` absent (older report / aggregate unavailable) | `Native cost — completeness unknown` | `Sessions: Unavailable` |
| `coverage.complete === true` | `Native cost` / `Total tokens` | `27 / 27 sessions` |
| `coverage.complete === false`, discovery not capped | **`Known native cost`** / **`Known tokens`** | `5 / 27 sessions · 22 unavailable` |
| `coverage.discoveryLimited === true` | **`Known native cost`** / **`Known tokens`** | `206 sessions inspected · additional sessions not inspected` (no percentage, never `206 / 206`) |
| `available === 0`, discovery not capped | `Unavailable` (not `$0.00`) | `0 / 27 sessions · 27 unavailable` |
| `available === 0` **and** `inspected === 0` | `Unavailable` | `No tracked sessions` |

Additional rules:

- Never the bare word "Total" for a partial sum; `usage.total` in the JSON DTO
  keeps its field name (compatibility) but the UI label changes.
- The word "Known" is the only qualifier used for partial aggregates; no
  "approximate", no "estimated", no extrapolation.
- Unavailable sessions contribute **nothing** to `usage`, `dates`, charts, or
  any count other than the coverage line itself. They are never rendered as a
  zero-cost row.
- An empty inspection set (`inspected === 0`) is never complete and never shows a
  ratio, a percentage, `$0`, or the word `Total`: usage reads `Unavailable` and
  the session line reads `No tracked sessions`.
- A session whose retained dated window was truncated (`usageByDateTruncated`,
  §5.6) qualifies its own in-range contribution as `Known` for ranges that reach
  before the oldest retained row. That qualifier is independent of report-level
  `coverage` and never changes a complete report's `Total` wording for ranges that
  are fully covered by the retained evidence.
- The coverage panel belongs to the **aggregate** sections only (history
  aggregate, global). It carries the bounded diagnostics (`manifest-unavailable`,
  …) as plain tokens, plus `discovery-limited` when discovery hit the cap.
- A **selected history session's detail carries no coverage panel and no `Known`
  qualifier**: that session replayed successfully, so its own figures are
  complete for that session. Workspace coverage qualifies aggregates, never one
  replayable session's own metrics.
- Per-day coverage is **not** rendered. When `coverage.complete === false`, the
  chart and daily tables carry the overall notice (one line), because the dates
  of unavailable sessions are unknown.
- Coverage is a history/global concept only. The TUI has no history or global
  section (`tui current|ledger`), so it gains no coverage surface; `json
  history|global` expose `coverage` verbatim.

### 3.4 Acceptance criteria

1. 5 available of 27 inspected (uncapped) ⇒ `coverage.complete === false`,
   session line `5 / 27 sessions · 22 unavailable`, cost label
   `Known native cost`, and the five replayed sessions' usage exactly equals the
   rendered sum (no filler).
2. All available and uncapped ⇒ `complete === true`, labels `Native cost` /
   `Total tokens`, session line `27 / 27 sessions`, no coverage warning.
3. Zero available with a non-empty, uncapped discovery ⇒ cost shows
   `Unavailable`, session line `0 / N sessions · N unavailable`, no `$0.00`
   anywhere.
4. **Empty inspection set** (`inspected === 0` with discovery available) ⇒
   `complete === false`, `sessionRatio === null`, session line
   `No tracked sessions`, and aggregate usage `Unavailable` — never `$0.00`, never
   `Total`.
5. Sessions directory unreadable ⇒ `availability: "unavailable"`, no `coverage`
   key, every aggregate metric `Unavailable`.
6. Discovery capped at 206 while further directories exist ⇒
   `discoveryLimited === true`, `complete === false`,
   **`sessionRatio === null`**, session line
   `206 sessions inspected · additional sessions not inspected`, cost label
   `Known native cost`; nowhere may a `206 / 206 sessions` fraction or a
   percentage be rendered, and even an all-available capped set stays incomplete.
7. A `coverage`-less report (older file) renders the `completeness unknown`
   variants, not `Total`.
8. A selected history session's detail shows that session's own figures with no
   coverage panel and no `Known` qualifier.
9. Byte-identical regeneration of the same inputs (determinism unchanged).

---

## 4. Scope contract (Workstream B part 2)

### 4.1 Semantics (unchanged, now stated for users)

| Scope | Exact meaning | Default |
| --- | --- | --- |
| `active` | The selected leaf entry plus its parent ancestry, restricted to entries after the tracking marker. Siblings, off-path descendants, and other branches are excluded. | Current view |
| `tree` | Every post-marker entry in append order, across all branches. | History/global |

Active is **not** "active and its children". Nothing in the UI may imply that.

### 4.2 UI labels

- `active` → **Active path** — sub-label `Selected entry and its parent ancestry`.
- `tree` → **Full session tree** — sub-label `All tracked branches in this session`.
- Context note keeps the marker qualification:
  `Active path · after tracking marker` / `Full session tree · after tracking marker`.
- ADR 0006 remains the normative scope definition; the design renames the
  labels and adds the identical-projection indication. Verified current copy at
  `81f65b7`: `scope.active` = "Active ancestry", `scope.tree` = "Full tree",
  `scope.fixed` = "History & Global use full tree.", and the context note
  (`scope-note`) appends "after tracking marker" — so the change is a retitle of
  existing keys plus the new sub-labels, not a new control.

### 4.3 Identical report projections

`InspectorBundle.current` gains one derived flag:

```ts
current: {
  active: CurrentView;
  tree: CurrentView;
  /**
   * True when both views produce byte-identical report payloads. This is a
   * statement about the report projection ONLY — it is not evidence that the
   * active path contains every tracked entry.
   */
  sameReportProjection: boolean;
};
```

Computed at bundle time by comparing the two views' canonical JSON payloads
(the same serializer used for the document, so the comparison is not a second
definition of equality). When `true`:

- both scope buttons remain enabled (scope stays a real control for other
  sessions and for later work), and a concise note appears, worded as exactly
  what was compared: `Active path and Full session tree produce the same report
  data for this session.`;
- no copy claims entry-set equality, and no copy claims anything about another
  session's projections.

When `false`, the note is absent. The flag is renderer-visible only; no report
field changes.

### 4.4 Scope application

Scope applies to the **current** section only (history/global are tree by
definition and keep the disabled control with the existing
`scope-fixed` note). Within current, scope applies to every tab and every
metric, because every tab reads the same scoped `SessionReport`. Switching scope
must:

1. preserve the selected date range (the range is keyed by view identity, not by
   scope — see §5.3);
2. preserve the selected tab and the table query/sort of that tab;
3. never change a usage total except by genuinely narrowing the entry set;
4. never add child-agent usage into any total (child usage stays a breakdown).

### 4.5 Acceptance criteria

1. Linear session ⇒ `sameReportProjection === true`, the note renders with the
   exact wording above, both buttons stay enabled, and the two report payloads
   are byte-identical.
2. Branched session with a sibling branch ⇒ `sameReportProjection === false`, the
   note is absent, active totals exclude the sibling's usage, tree totals include
   it, and neither total includes child-run usage.
3. Scope label copy contains no claim about children/descendants.
4. Changing scope on `models` with a 7D range selected keeps the 7D range and the
   `models` tab selected.
5. On history/global the scope control is disabled and the note never implies a
   choice.

---

## 5. Range contract (Workstream B part 1)

### 5.1 Date semantics

- **UTC calendar dates** (`YYYY-MM-DD`) only. A record's date is the UTC date of
  its persisted ISO timestamp (`utcDate()` / `DAY` in `src/ui/html.ts`).
- **Which timestamp supplies that date is normative** and defined once, by
  logical call, in §5.7. No start time, end time, or duration is ever inferred
  for range attribution.
- Boundaries are **inclusive on both ends**: a record is in range iff
  `from <= utcDate(record.timestamp) <= to`.
- Presets are anchored on the **latest observed date in the view**, never on the
  machine clock (determinism): `7D` ⇒ `to = latestObserved`, `from = to - 6`;
  `14D` ⇒ `- 13`; `30D` ⇒ `- 29`.
- `current` default = full observed span (`preset: null`); `history`/`global`
  default = `14D`. Unchanged.
- Custom range: two independent UTC date inputs; both required; validation is
  `from <= to`. The other endpoint is preserved when one changes (they are
  independent controls today and stay that way).
- Invalid custom range: the dialog stays open and shows
  `From must be on or before To.`; **no** navigation, scope, tab, or session
  state is modified.
- A custom range is serialized as a validated `from`/`to` pair (§9.1); a lone,
  unparsable, or inverted pair is never partially applied.
- Existing silent clamping to the observed min/max is **removed**. A range that
  extends beyond the observed data is accepted and produces the empty-state
  message for the affected widgets; clamping user input without a message is
  the kind of silent rewriting this milestone exists to remove. (Ruling R1.)
- Truncated daily history (`dailyTruncated`, oldest days dropped beyond
  `MAX_DAILY_ROWS = 366`): keep the existing bounded notice
  `Older days beyond the retained window are not shown.` and additionally mark
  any selected range that starts before the retained window with the same
  notice next to the range label, so a partial chart is never mistaken for
  complete history.

### 5.2 Which fields are filtered (the anti-mixing table)

Range applies through **one** projection used by every tab. No widget filters
its own data.

| Section | View | Range-filtered | Not filtered (and how it is labelled) |
| --- | --- | --- | --- |
| current | Overview metrics | cost, tokens, generations, tool calls, observed days, duration (recomputed from in-range records) | session identity (`sessionId`, status) |
| current | Models | per-model generations/tokens/cost **within range** | — |
| current | Tools (summary + calls) | calls, status counts, known usage, last-used timestamp | inventory `source` label (static per name) |
| current | Agents | child runs whose timestamp falls in range; run status/usage counts | parent relationship (identity, not a metric) |
| current | Errors | errors in range | — |
| current | Usage composition | all four parts recomputed in range | — |
| current | Integrations | nothing (no counter source carries per-date rows today) — the Activity column is a session-scope value labelled `Session total` | detection/telemetry state, version, activity counters = environment facts, labelled `Session total · current environment`, never "in range" |
| current | Commands/Skills/Resources | nothing — inventory is environment data and explicit skill-invocation counters are session-scope aggregates | inventory rows and invocation counters, labelled `Session total` |
| current | Ledger | unchanged (bounded diagnostic rows) | — |
| history (aggregate) | Overview metrics, chart, session rows | usage, sessions, days; a session row is in range only when it has at least one range-relevant observed record inside the range (§5.6) | inventory counts (environment) |
| history (session) | all tabs | identical to `current` (no coverage qualifier, §3.3) | — |
| global | Overview metrics, chart, session rows | usage, sessions, days | inventory counts (environment) |
| global/history | Models/Tools/Agents/Errors tabs | **deferred (out of scope)**: full `SessionReport`s exist during the scan, but this milestone does not aggregate and expose those tabs for multi-session sections (§9.3, §15) | — |

Two rules make this enforceable:

1. Any widget that is intentionally not range-filtered must render an explicit
   period label (`All report dates` / `Current environment` / `Session total`),
   and the label is part of the projection, not per-widget prose.
2. A page must never render a range-filtered cost next to an unlabelled
   all-period breakdown. The review test for this is §13 "range/scope integrity".

### 5.3 State model and persistence

```ts
type RangeState = { preset: 7 | 14 | 30 | null; from: string; to: string };
```

- **One range per view identity**: `current` (one range, shared by both scopes),
  `history:aggregate`, `history:<sessionId>`, `global`. The existing
  `periods[section]` keying is replaced by this finer identity so that a selected
  history session does not inherit the aggregate's range and vice versa.
  Ranges remembered for other view identities — and, likewise, all per-table
  settings of inactive views (§9.5) — are **ephemeral caches** held in memory for
  the document's lifetime. They are explicitly *not* part of deep-link
  reproducibility: the route carries the range of the **active** view identity
  only, so a deep link reproduces exactly the view it points at and nothing else.
- The active range is **part of the navigation state** (§9) and therefore
  serialized into the URL hash. Changing tab, scope, section, or following an
  internal link preserves it. Selecting a different history session restores
  that session's previously selected range if one exists, else the default.
- Range is never written back into a report DTO; it is a view-state concept only.
  `json` output is unaffected.

### 5.4 Implementation shape (why this is derivation, not new persistence)

The canonical browser projection already carries per-row time fields for tools,
agents and errors (`Tool.timestamp`, `AgentRun.observedAt`, `ErrorRecord.timestamp`
— see §5.7), so those tabs filter **their own canonical rows** directly — one row
per call/run/error, no dated duplicate. Only the two values that exist solely as
aggregates need a per-date form: model summaries and the usage composition.

Both per-date forms are computed by **one** function over the canonical session
(R19, §0.2 item 2), in a shared module both loaders import:

```ts
// src/ui/dated-usage.ts (new)
/**
 * The single dated projection. Everything a browser needs per date comes from
 * here, so no second implementation can disagree with it.
 */
export function sessionDatedUsage(session: CanonicalSession): {
  /** Per-date usage + observation counters, composed from `usage.lines` and the
   *  canonical generation/tool/error rows (≤ `MAX_DATED_DATES` = 366 dates). */
  dates: DateUsageRow[];
  /** Per-date per-model rows, joined to their line by `ownerId` so an
   *  unattributed generation can never appear here but not in `dates`
   *  (≤ 366 dates × `MAX_MODELS_PER_DATE` = 64 rows). */
  models: DatedModelRow[];
  /** True when `dates` cannot represent the session's whole native usage:
   *  the 366-date cap, or `evidenceHealth.usage.dated === "partial"`. */
  truncated: boolean;
  /** True when the model cap dropped a row. */
  modelsTruncated: boolean;
};
```

- **Current views**: `load-current.ts` attaches the projection to
  `CurrentTuiModel` (`usageByDate`, `datedModels`, both flags) next to the report
  it already returns; `bundle.ts` copies it onto the `CurrentView` and **folds**
  it into `DailyRow.composition`. The report DTO is not extended and
  `json current` output is unchanged.
- **History/global**: `scanHistory` attaches `dates` to the available
  `HistoricalSession` variant (spec §5.6's bounded per-session evidence); the
  browser's history/global daily rows and the global `dates` fold the same rows
  instead of walking `SessionReport` timestamps a second time.
- **Tools, Agents and Errors** are still filtered from their canonical rows in the
  client (`Tool.timestamp`, `AgentRun.observedAt`, `ErrorRecord.timestamp`); no
  dated copies exist for them.
- Aggregation only ever **sums** these rows: `buildDailyRows(contributions)`
  (`{ sessionId, rows, truncated }[]`, in `src/ui/daily.ts`) folds `usageByDate`
  rows by date and `sessions` counts the distinct sessions that contributed to
  that date. Two sessions, one date, one row.

Growth stays bounded by (366 × 64) model rows per view plus one composition object
per day.

```ts
// Models: ModelSummary is an aggregate, so it needs a dated form.
type DatedModelRow = { date: string; provider: string; model: string; generations: number; totalTokens: number; cost: number };
// Daily rows (already in the payload) gain the four composition parts.
type DailyRow = { /* existing */ date, sessions, totalTokens, cost, generations, tools;
                  composition: { generations: SafeUsage; toolResults: SafeUsage; compactions: SafeUsage; branchSummaries: SafeUsage } };
```

Rules:

- Tools, Agents and Errors are filtered from their canonical rows in the client;
  parallel dated copies for them are explicitly rejected (one source of truth).
- `DatedModelRow` is capped at `MAX_DAILY_ROWS = 366` dates × at most 64 model
  rows per date and carries a `modelsTruncated` flag; `DailyRow` keeps its
  existing cap and `dailyTruncated` flag. Capped output is visibly marked, never
  silently short.
- Nothing here is persisted: the rows are derived at bundle time from the
  already-replayed `SessionReport` and live only inside the generated document.
- Growth is bounded by (366 × 64) model rows plus one composition object per day.
  Slice P0-B gates on a **measured relative** document-size delta against a
  baseline captured before the slice (reference fixture, ≤ +15 %), not on an
  arbitrary absolute ceiling; the measurement, the fixture path, and the before/
  after bytes are recorded in the slice report.

### 5.5 Acceptance criteria

1. 7D and 14D produce different numbers on **every** range-aware widget in the
   same view (metrics, models, tools, agents, errors, composition, chart).
2. UTC boundaries are inclusive: a record at `2026-09-12T00:00:00Z` is inside
   `2026-09-12 … 2026-09-12`; a record at `2026-09-11T23:59:59Z` is not.
3. Custom range with `from > to` shows the error, keeps the dialog open, and
   leaves section/tab/scope/session untouched.
4. Custom range with `from <= to` but outside observed data renders the empty
   state, not a clamped range and not a fabricated zero.
5. No view ever shows range-filtered cost beside an unlabelled all-period
   breakdown.
6. Changing scope keeps the range; changing tab keeps the range; navigating away
   and back restores it (§9 tests).
7. `dailyTruncated` ⇒ the truncation notice is visible whenever the selected
   range reaches before the retained window.
8. A history session whose span covers the range but which has **no** observed
   record inside it is excluded from that range's rows and totals; a session with
   at least one in-range record is included (§5.6).
9. A custom range round-trips: serialize → reload → identical selection and
   identical rendered numbers; an invalid or half pair falls back to the view
   default with the notice (§9.1).
10. **Cross-midnight regression**: a tool call at `23:59Z` whose result (and error)
    is observed at `00:01Z` the next day ⇒ the tool's usage/cost appears in the
    call day's range totals and the tool summary row, the error appears in the next
    day's Errors list, and switching between the two single-day ranges keeps the
    session total, the tool summary, and the usage composition mutually consistent
    (each evidence row counted exactly once).
11. **Truncated per-session dated history**: a session spanning more than 366
    observed days ⇒ `usageByDateTruncated === true`; an old Custom range reaching
    before the retained window renders the row's usage as `Known` with the
    `history-daily-truncated` diagnostic and never as a complete or zero figure,
    while a recent range fully inside the window still reconciles exactly with the
    session's detail view.

### 5.6 Session membership in aggregate ranges

- A history session belongs to a selected range **only** when it has at least one
  range-relevant observed record or event whose UTC date lies inside the range.
  `generations`, `tools`, `compactions` and `errors` all count as observed
  records. Span intersection alone is not membership: a session whose first/last
  records bracket the range may have no usage inside it.
- The history entry projection therefore carries bounded per-session evidence for
  this decision: `usageByDate: { date, totalTokens, cost, generations, tools }[]`
  plus `usageByDateTruncated?: boolean` (≤ 366 dates, newest window), derived from
  the canonical builder's native usage lines (R19; §0.2 item 2) rather than from a
  second walk of `SessionReport`. `usageByDateTruncated` is true whenever the
  retained rows cannot represent the session's whole native usage — because the
  window was capped (§17 R16) **or** because the builder reported
  `evidenceHealth.usage.dated === "partial"` (at least one native usage line has
  no known `attributedAt`). Either way the row is partial and must say so; both
  causes share one flag, one `Known` qualifier and one render path, and no
  unattributed usage is ever silently dropped. `dated === "unavailable"` with zero
  native lines is *not* truncation — there is simply nothing to date. The row's
  cost/tokens for a range are the sum over its in-range dates.
- **Reconciliation contract** (what truncation must not break):
  - Within the retained dated window, a range-filtered aggregate session row
    reconciles **exactly** with the same session's detail view for that range.
    Exact row/detail equality is claimed **only** for ranges fully covered by the
    retained dated evidence.
  - When `usageByDateTruncated === true` **and** the selected aggregate range
    reaches before the oldest retained dated row, that session's range membership
    and usage are **partial/unknown** for the omitted portion. The omitted activity
    is never silently excluded, never counted as zero, and never extrapolated.
  - Such a row renders a bounded truncation diagnostic
    (`history-daily-truncated`) and its in-range usage is rendered `Known …` with
    the retained window stated, so a partial figure can never read as complete.
  - Because the retained window is anchored on the newest dates, a truncated
    session is exact for recent ranges and partial only for ranges reaching beyond
    the retained window.
- Sessions with **no dated evidence** — which includes every unavailable session —
  cannot be attributed to any range. They are listed in a separate
  `Unavailable · dates unknown` group, are never counted in range totals, and are
  never rendered as `$0`.

### 5.7 Timestamp attribution (normative)

Every range-filtered number must be attributable to exactly one UTC date, and the
attribution is by **logical call**, never by result arrival and never by inferring
a start or an end. This table is **already implemented in the canonical builder**
(`CanonicalUsageLine.attributedAt`, `domain`, `bucket`, §0.1); the milestone
projects that attribution rather than reimplementing it (R19), and the fixture in
§13 is the regression that keeps the two in agreement:

| Evidence | Date comes from | Consequence |
| --- | --- | --- |
| generation usage | `Generation.timestamp` (assistant message) | native parent-session usage |
| tool call identity, status, and its attached usage | `Tool.timestamp` (the assistant call time) | a call at 23:59 whose result arrives at 00:01 has its usage/cost attributed to the **call day** |
| tool error event | `ErrorRecord.timestamp` (result/error observation time) | the resulting error can therefore land on the **next day** than that call's usage |
| child run | `AgentRun.observedAt`, derived from the persisted tool-result entry that published the run evidence | observation time of the evidence only — **not** a start time, end time, or duration |
| compaction / branch summary | its own persisted entry timestamp | — |

Rules:

- No start time, end time, duration, or elapsed time is ever inferred, and no field
  is repurposed as one. `AgentRun.observedAt` is the only time field added to a
  child run and carries no causal or ordering claim beyond observation.
- Because each evidence row is counted once, in its own bucket, a cross-midnight
  call stays internally consistent: the tool summary, the tool's range-filtered
  usage, and the usage composition all read `Tool.timestamp`, while the error list
  reads `ErrorRecord.timestamp`. Splitting a call's usage from its error across
  two days is the intended, documented consequence of logical-call attribution.
- Tool duration remains `Unavailable` unless live duration evidence exists (§7.6);
  attribution never substitutes for it.

---

## 6. Report projection contract (Workstream C)

### 6.1 Stages and their contracts

| Stage | Producer | Contract | Known losses today |
| --- | --- | --- | --- |
| persisted Pi entries | Pi session JSONL | `SessionEntry` (`src/core/events.ts`) | none (source of truth) |
| adapter/telemetry | `src/integrations/*`, `src/pi/telemetry.ts` | `IntegrationObservationInput`, `SubagentEvidence`, `InventorySnapshot`, `FoldedCounters`, `DurationEvidence` | none |
| reducer | `src/core/reduce.ts` | `ReducedSession`: `generations`, `tools`, `compactions`, `errors` | none |
| report | `src/core/reports.ts` | `SessionReport`, `HistoryReport`, `GlobalReport` — the **machine contract** (`json` writes these verbatim) | agents lack timestamp/model/thinking/failure; nothing else |
| bundle | `src/ui/bundle.ts` | `InspectorBundle` — the **browser contract** | per-section projections lose fields (below) |
| browser | `src/ui/html.ts` client | reads the projection only | `AgentRun.agent`, `AgentRun.artifacts`, `Tool.timestamp`, per-date model rows, per-date composition |

### 6.2 Rules

1. **Loss ledger first.** A missing UI field is classified before any collector
   is proposed: (a) present upstream, lost in projection → fix the projection;
   (b) deterministically derivable → derive it in the adapter/report;
   (c) genuinely absent → render `Unavailable` and list it in §15. No slice may
   add persisted data to compensate for a lossy renderer.
2. **One browser projection.** `currentViewProjection()` and
   `sectionProjection()` (server side, `src/ui/html.ts`) are the only producers of
   browser-facing rows. The client never re-shapes a report field ad hoc; every
   tab consumes the same object. Tab-specific shaping that exists today
   (`agentRows`, `toolRows`, …) collapses into the projection, and the client
   loses access to raw `report.*` arrays for table rendering.
3. **Identity is preserved.** Opaque ids stay byte-exact (copy/debug), but they
   are never the primary visual identity (§7). Timestamps stay ISO-8601 strings
   (never pre-formatted), so the client can both display and range-filter them.
4. **Optional stays optional.** An absent field is rendered `Unavailable`; it is
   never defaulted to `0`, `""`, `"unknown"` or a placeholder entity.
5. **No silent renames.** Field names in the report DTO are append-only.

### 6.3 Projection fixes required by this design

| Loss | Fix (class) | Slice | Status on `main` at v0.8.0 |
| --- | --- | --- | --- |
| `AgentRow` drops `agent`, `artifacts` | pass through validated values (renderer) | P1-C | DTO carries them; the browser row must be extended |
| `AgentRow` has no time field | `AgentRun.observedAt` derived from the publishing entry (§5.7) | P1-C | derivation **done** (`projectAgent` validates `observedAt`); projection must pass it through |
| `ToolRow` drops `timestamp` | pass through (renderer) | P1-C | DTO carries `Tool.timestamp`; the row must be extended |
| Models cannot be range-filtered | per-date model rows in the browser projection (derivation) | P0-B | open |
| Composition cannot be range-filtered | per-date composition in `DailyRow` (derivation) | P0-B | open |
| Agents cannot be range-filtered | `AgentRun.observedAt` (derivation, §5.7); the canonical agent row is filtered directly, no dated copy | P0-B | `observedAt` **done**; filtering open |
| Tools/errors cannot be range-filtered | `Tool.timestamp` and `ErrorRecord.timestamp` pass through (renderer) | P1-C | both fields **exist** in the DTO; the rows must carry them |
| `AgentRun` has no model/thinking | `model?`, `thinking?` validated from `results[]` (derivation, producer-version dependent) | P1-C | derivation **done**; projection must pass them through |
| `AgentRun` has no bounded failure class | `failure?: AgentFailure` from validated enums (derivation) | P1-C | derivation **done**; projection must pass it through |
| Errors cannot link to a child run | `AgentRun.evidenceToolId = "tool:" + message.toolCallId` (derivation; one-to-many) | P1-D | field **done**; the join and its rendering are open |
| Child usage completeness unknown | `runsWithUsage` / `runsTotal` counts in the report and the agent projection (derivation) | P1-D | open |

Three rows that the pre-merge design listed as derivations — agent model, thinking
and failure class, plus `observedAt`/`evidenceToolId` and the tool timestamp — are
**already derived on `main`**; only their pass-through into the browser projection
remains (§0.3).

Every derivation above is computed from already-persisted producer payloads,
validated with the existing bounded-validator style, and optional in the DTO.
Where the producer is absent or of an unknown version, the field is absent and
the UI shows `Unavailable`.

The child run's **evidence tool id** is the persisted tool-result
`message.toolCallId` — the id the reducer already turns into `tool:<callId>` and
the id the subagent adapter already joins results by. `details.toolCallId` is
**not** used: it is producer-internal and is not the canonical call id. The field
is named `evidenceToolId` rather than `originToolId` because the publishing result
is **not necessarily the call that launched the child** (a `subagent_wait` result
can publish completion evidence for a run another call launched). Because one
result may publish several runs, the relation is **one-to-many**, is never
collapsed into a single attributed child, and carries **no causal claim** (§7.5).

### 6.4 Acceptance criteria

1. A snapshot test asserts the browser payload contains, for every agent row:
   role label when known, status, confidence, artifacts when known, timestamp,
   and usage when known — and that no `task`/`finalOutput`/`progressSummary`/path
   field can appear (privacy assertion).
2. A tool row carries `timestamp`, and the Tools calls view renders a real time.
3. A grep-level test asserts the client script contains no report-array access
   for table rendering (single-projection rule), i.e. the client reads only the
   projection object.
4. Old payloads (fixture without the new fields) still render, with
   `Unavailable` in place of the missing values.

---

## 7. Agent / Tool / Error relationship model (Workstreams D, E, F)

### 7.1 Three independent concepts

| Concept | Source | Meaning | Never conflated with |
| --- | --- | --- | --- |
| Child runs (`agents[]`) | `results[]`/`completions[]` of the subagent tool results | one launched child agent | a tool call |
| Agent tool activity (`agentActivity`) | native `subagent`, `subagent_wait`, `subagent_supervisor` tool calls | how often the launching tool ran | child-run count |
| Tools (`tools[]`) | every native tool call | call-level timeline | agents |

### 7.2 Agents summary (primary)

Rendered from `agents[]` only:

```text
Child runs        23
Succeeded         18
Failed             3
Interrupted        2
Known child tokens 4.1M        (18 of 23 runs reported usage)
Known child cost   $12.40      (18 of 23 runs reported usage)
Known failed-run cost $2.10    (3 of 3 failed runs reported usage)
```

Rules:

- The word "Agents" is never a label for `agentActivity.calls`; that block is
  labelled **Agent tool activity** and shows
  `subagent: 174 · subagent_wait: 46 · subagent_supervisor: 1` plus status counts.
- Child usage is a breakdown: it is never added to the session total, in any
  scope, at any time (ADR 0007 preserved).
- When some runs lack usage, the cost/token labels carry `Known` and the
  fractions are shown. When `runsWithUsage === 0`, show `Unavailable` — never
  `$0.00`.
- `agentEvidence !== "supported"` ⇒ the summary shows `Unavailable` with the
  evidence state; no counts are invented.

### 7.3 Agent row identity and drill-down

Primary column: **agent role label** (`delegate`, `worker`, `reviewer`, …) when
present, else `Unavailable`. Then status, model (when known), thinking level
(when known), tokens/cost (when known), artifact availability (`available` /
`missing` / `Unavailable`), parent (see 7.4). The opaque id (`subagent-<sha256>`)
is shown only in the details panel with a copy affordance.

Child `model` and `thinking` are **metadata inside this agent's detail panel** and
never a link to the Models tab: `SessionReport.models` describes the native
parent-session generations, while an agent run's model is a different usage
domain (§9.4). The run's time field is `observedAt` (§5.7).

Optional bounded failure classification (never free text, present only for a
failed or interrupted run whose producer published the enum):

```ts
/** Derived only from validated producer enums; no free-text reason exists. */
type AgentFailure = {
  reason: "exit-nonzero" | "process-signal" | "completion-failed" | "output-absent";
  /** Numeric exit code or bounded signal name; absent when not published. */
  detail?: number | string;
};
```

### 7.4 Parent / child semantics

- **Resolved in the selected projection**: an anchor to that run
  (`#/current/agents?entity=agent:<id>`), focused and highlighted.
- **Known but excluded by the selected projection**: the parent id is present in
  the unfiltered (tree) projection of the same session but not in the selected
  one → render `Parent: outside selected scope` (no id shown, no dead link). This
  is the honest answer for a parent excluded by *active* path scoping or by a
  range filter.
- **Unknown**: the id is not present in either projection → `Parent: Unavailable`.
- Never render a bare long hash without one of these three verdicts.

### 7.5 Errors

Presentation priority:

1. Deterministic **Tool join**: `error.id === tool.id` ⇒ show
   `<tool name> failed · <UTC time> · tool-error` plus the tool's `source` label
   and status. The raw `tool:call_…` id moves to the details panel.
2. **Generation errors**: keep the existing bounded, redacted `errorMessage` when
   present; show model/provider when the generation is known.
3. **Related child run(s)**: every child run whose `evidenceToolId` equals the
   failed tool's id is a *candidate*. `evidenceToolId` is the canonical
   `tool:<message.toolCallId>` of the persisted tool result that **published the
   run's evidence**; it is not necessarily the call that originally launched the
   child (`subagent_wait` can publish completion evidence for a run launched
   earlier). The relation is **one-to-many** — a single result can publish several
   child runs — so the panel lists them under `Related child run(s)` and **never**
   names one of them as the cause. Zero candidates ⇒ the section is omitted
   entirely (never inferred from timestamps, never padded with an unrelated run).
4. **Message**: tool errors have no safe structured message (§1.5) ⇒
   `Message: Unavailable`. No text is ever taken from `content`, tool output,
   arguments, or child output.

Error detail panel adds: error kind, confidence, UTC timestamp, tool name,
tool source, tool status, related tool link, the `Related child run(s)` list
(when the origin is known), and the bounded message or `Unavailable`.

### 7.6 Tools

Two views over one projection:

- **Summary**: one row per tool name with `calls`, `succeeded`, `failed`,
  `interrupted`, `Known tokens`/`Known cost` (with `n of m calls reported usage`
  when partial), and `last used` (max timestamp). Selecting a row filters the
  Calls view to that tool.
- **Calls / timeline**: one row per call with UTC timestamp, tool name, source,
  status, usage when available, and duration when
  `durationEvidence === "supported"` (live-correlated only). Selecting a row opens
  the call detail with the error link when the call failed.

Rules: no arguments, no result bodies, no result-derived text. Duration is
`Unavailable` for reports without live duration evidence — never estimated from
adjacent timestamps.

### 7.7 Acceptance criteria

1. Fixture with `agentActivity.calls = 174` and `agents.length = 23` renders
   `Child runs 23` and `Agent tool activity: 174`, with no copy claiming 174
   children. Status counts partition **all** runs (a `running` or `unknown` run
   is counted in its own bucket, never dropped or folded into another).
2. Failed-run cost sums only failed runs and is labelled `Known` when partial.
3. A tool error renders `bash failed · 23:40:26 · tool-error` and its tool
   source; the error detail shows `Message: Unavailable`.
4. A generation error with a redacted message renders it; a generation error
   without one renders `Message: Unavailable`.
5. No rendered field contains `task`, prompt text, tool result content, or any
   path (§13 privacy corpus).
6. Parent resolution: in-scope → link; tree-only → `outside selected scope`;
   unknown → `Unavailable`.
7. Tools summary totals equal the sum of its call rows for the same range.
8. One `subagent` tool result publishing three child runs, with a failure on that
   call ⇒ the error detail lists **all three** under `Related child run(s)` and
   attributes the failure to none of them.
9. `evidenceToolId` is present only when the persisted tool result carried a
   non-empty `message.toolCallId`; otherwise it is absent, with no fallback to
   any other id. A run whose evidence arrived through a `subagent_wait` result
   joins to that wait call, not to the launching call.

---

## 8. Environment and integration model (Workstream G)

### 8.1 Environment (inventory, never activity)

Commands, Skills and Resources move under one **Environment** grouping with
explicit dual copy:

```text
Commands   Available: 119      Observed invocations: Unavailable
Skills     Available: 42       Explicit invocations observed: 3
Resources  Sources: 11
```

Rules:

- Inventory is environment state: `state` + `count` + `items`, exactly as the
  DTO models it today. No "used", "activity", or "invocations" claim is derived
  from inventory presence, ever.
- Skill invocations come only from explicit folded counters
  (`SkillInventory.invocationState`, `invocationCount`, `otherInvocations`);
  `Unavailable` when the counter evidence is absent.
- Search/filter stays (large inventories are real). Inventory tables are
  secondary to the diagnostic flow: they live behind the Environment
  sub-navigation, not in the primary tab strip alongside Overview/Tools/Errors.
- Inventory is never range-filtered (§5.2): it describes the current environment,
  and the section says so.

### 8.2 Integrations: four independent columns

| Column | Values | Source |
| --- | --- | --- |
| Integration | key (context, rtk, ponytail, caveman, permission, subagents, lens) | `IntegrationObservation.integration` |
| Detected | `present` / `absent` / `unknown` | `IntegrationObservation.presence` (inventory-derived) |
| Telemetry | `supported` / `unavailable` / `unsupported` + bounded reason | `IntegrationObservation.state` + counters presence |
| Activity | counters (`key: value` rows) or `Unavailable` | `IntegrationObservation.counters` |
| Version | number or `Unavailable` | `IntegrationObservation.version` |

Rules:

- Detection and telemetry are **independent** by design (ADR 0009/0014):
  `Detected: absent` with `Telemetry: supported` is valid when persisted
  telemetry exists but current inventory does not prove the producer is loaded.
  It must not be "fixed" into a single state, and no row may be silently dropped
  because of it.
- Telemetry-unavailable reasons come from a closed vocabulary:
  `no compatible telemetry evidence` (`state === "unsupported"`),
  `no telemetry observed in this session` (`state === "unavailable"`), and the
  non-state **note** `producer not detected in current inventory`
  (`presence === "absent"`) which never changes the telemetry value.
- Activity column: counters are shown verbatim as bounded `key: value` pairs;
  `Unavailable` when the counter object is absent — never `0`.
- Version: a validated integer or `Unavailable`; never fabricated, never `0`.
- Contradiction audit: rows where detection and telemetry disagree are rendered
  as-is. The design explicitly rejects "reconciling" them.

### 8.3 Acceptance criteria

1. A row with `presence: "unknown"`, `state: "supported"`, counters present
   renders `Detected: Unknown · Telemetry: Supported · Activity: <counters> ·
   Version: <n|Unavailable>`.
2. A `skill:ponytail`-only inventory yields `Detected: absent` for the ponytail
   *extension* while its persisted counters (if any) still show telemetry —
   and this is presented as expected, not as an error.
3. Inventory counts never appear as invocation counts.
4. `state: "unsupported"` shows `no compatible telemetry evidence`.

---

## 9. Navigation and routing state model (Workstream H)

### 9.1 One authoritative route

```ts
type EntityRef = {
  kind: "model" | "tool" | "agent" | "error" | "integration" | "command" | "skill" | "resource";
  id: string; // must match an id already present in the projection
};

type InspectorRoute = {
  section: "current" | "history" | "global";
  tab: Tab;                       // capability-checked per section
  session?: string;               // history only, opaque sessionId
  scope: Scope;                   // current only; ignored elsewhere
  range: RangeState;              // ACTIVE view identity only (§5.3)
  entity?: EntityRef;             // drill-down target
  table?: { query?: string; sort?: string }; // ACTIVE table only (§9.5)
};
```

Serialization (hash only, no query string, no server). Canonical parameter
order — the order every serializer emits, so one route has exactly one string:
`scope, preset, from, to, session, entity, q, sort`.

```text
#/current/tools?scope=tree&preset=7&entity=tool%3Atool%3Acall_abc&q=bash&sort=cost
#/current/tools?scope=tree&from=2026-09-01&to=2026-09-12
#/history/overview?session=<sessionId>&preset=14
#/global/overview?preset=30
```

Range serialization rules:

- A preset range serializes `preset=<7|14|30>` only; `from`/`to` are derived from
  the view's observed dates on parse (deterministic, never the machine clock).
- A custom range (`preset === null`) serializes **both** validated dates as a
  pair: `from=YYYY-MM-DD&to=YYYY-MM-DD`.
- `from` and `to` are honoured only as a valid pair. A lone `from`, a lone `to`,
  an unparsable date, or a pair with `from > to` is not applied at all: the view
  falls back to its own default range and renders
  `Range could not be restored; showing the default range.` There is no partial
  application, and the invalid value is never echoed back into the hash.
- `preset` and the `from`/`to` pair are mutually exclusive; `preset` wins when
  both are present (deterministic precedence).

Other rules:

- Omitted parameters mean defaults.
- Only bounded values: enum tokens, ISO dates, numeric presets, and ids that
  already exist in the projection. Text from tool arguments/results/prompts can
  never reach the hash (validated against the projection's id set on parse; an
  unknown id is dropped, never echoed).
- Parsing is total: any unknown section/tab/option/date degrades to the section
  default and renders a one-line notice (`That view isn't available here.`),
  never an empty page and never a thrown error.

### 9.2 Rendering authority

- `render()` derives **all** state from the route: content, which sidebar item
  is active (`aria-current="page"`), which tab is active
  (`aria-selected`/`aria-pressed`), which scope button is pressed, which range
  preset is pressed, the search/sort controls' values, and the section heading's
  focus target.
- Click handlers **only** mutate the route and call `navigate(route, {push:true})`.
  No handler touches `aria-pressed`, `classList`, or another control's state.
  This is the structural fix for the reported active-state bug (§1.7).
- One event path, no duplicate renders: a single `applyLocation()` is bound to
  **both** `hashchange` and `popstate`. It canonicalizes the current hash, and if
  the canonical route equals the last applied route it returns **without
  rendering** — so a browser that fires both events for one navigation produces
  exactly one render. Bursts are coalesced to at most one render per event-loop
  turn.
- Focus and scroll effects fire only when the applied route actually changes
  `section`, `tab`, `session` or `entity`; a range-only or table-only change
  re-renders content without stealing focus or moving the scroll position.
- Keyboard: sidebar/tabs are anchors (`<a href="#/…">`) so Enter, middle-click,
  and copy-link all work; arrow-key tab navigation follows the existing
  `role="tablist"` semantics; focus moves to the section `h1` on section change
  and returns to the originating link on Back.

### 9.3 Section capabilities (no dead tabs)

Capabilities are computed **server-side** per section from the data contract,
not hand-maintained in the client:

| Section | Capabilities | Reason |
| --- | --- | --- |
| current (view available) | all tabs: overview, models, tools, environment (commands/skills/resources), agents, integrations, errors, ledger | full `SessionReport` present |
| current (view unavailable) | none — single `Unavailable` panel with the bounded diagnostic | no report |
| history (aggregate) | overview (+ chart, session list) | per-model/tool/agent breakdowns are **deferred** in this milestone (§15), so the aggregate section offers only what it computes |
| history (session selected) | all tabs | full `SessionReport` present |
| global | overview (+ chart) | per-model/tool/agent breakdowns are **deferred** in this milestone (§15) |

The client renders only capable tabs, and route validation coerces an
unsupported tab to the section default with the notice above. Tabs are never
"present but guaranteed Unavailable".

The capability table is the **browser** contract. The TUI keeps its own fixed
`CURRENT_TABS` list (`overview, models, tools, commands, agents, skills,
integrations, errors, ledger`) and is not re-taxonomized by this milestone:
there is no route and no capability negotiation in the TUI, and §8's Environment
grouping is a browser-surface change. Both surfaces still consume the same
`SessionReport` (invariant 7); only the tab labels differ, and no TUI tab renders
a figure the report cannot support.

### 9.4 Cross-navigation (links only where a destination exists)

| From | To | Context preserved |
| --- | --- | --- |
| Overview model row | Models tab, entity-focus that model | section, scope, range |
| Overview tool row | Tools summary, entity-focus that tool | section, scope, range |
| Tool summary row | Tools calls filtered to that tool | range, scope |
| Tool call row (failed) | Errors, entity-focus the matching error | range, scope |
| Error row | related tool call / related agent run (when deterministic) | range, scope |
| Agent row | parent / child run (when resolved in scope) | range, scope |
| Integration row | its own detail panel (counters, version, telemetry reason) | all |
| Command / Skill / Resource row | Environment subsection | all |

Every link is an anchor with a hash target; non-linked labels keep their plain
text and are never styled as links. Focused entities get `:target`-style
highlighting plus a visible focus ring (existing `focus-visible` outline).

`AgentRun.model` is deliberately **not** a navigation target and no Agent → Models
link exists: `SessionReport.models` describes the native parent-session
generations while `AgentRun.model` describes the child run's own model — different
usage domains that must not be joined merely because a name matches. A future
milestone that aggregates real child-model usage may add its own target.

### 9.5 Table-local state

- `route.table` is the **active** table's state. Being part of the route, it is
  serialized, restored by Back/Forward, and reproduced by a deep link.
- Settings for inactive tables live in an **ephemeral cache** keyed by
  `(section, tab)`: switching away saves the leaving table's state there and
  restores the entering table's state into the route. The cache is explicitly not
  part of deep-link reproducibility and dies with the document — the same rule as
  the inactive range memories (§5.3).
- Two tables never share one query: a section change clears that section's cached
  entry, and each tab keeps its own state.

### 9.6 Acceptance criteria

1. Clicking a sidebar item re-renders content **and** exactly one sidebar item is
   active; the same holds for tabs after a section change or a deep link.
2. A deep link opens the exact section/tab/scope/range/entity; reloading the
   document preserves it; Back and Forward restore the previous and next states.
3. Following Overview → Tools → error → back preserves range and scope at every
   step.
4. Global offers only Overview; no tab in any section leads to a page that is
   guaranteed `Unavailable`.
5. Two tables keep separate queries; switching tabs and returning restores each.
6. The hash never contains text originating from prompts, arguments, results, or
   paths (privacy test with hostile values in the projection).
7. A custom-range deep link (`from`+`to`) restores exactly that range after a
   reload; an invalid, lone, or inverted endpoint falls back to the view default
   with the notice and is never partially applied.
8. A hash-only navigation that fires both `hashchange` and `popstate` performs
   exactly one render, and a range-only change performs no focus effect (asserted
   on the derived view model, §13).
9. A selected history session's detail shows no workspace coverage panel.

---

## 10. Autocomplete integration strategy (Workstream I)

### 10.1 Contract

`completeInspectorCommand(argumentPrefix)` keeps its signature and its grammar
decisions (same tables, same acceptance rules); what changes is how the
replacement text is built.

```ts
type AutocompleteItem = { value: string; label: string; description?: string };
// value = the FULL replacement argument text up to the cursor: every preceding
//         character byte-identical (whitespace and quoting included), with only
//         the current raw token span replaced by the chosen completion.
// label = the token alone (readable in the popup).
```

Rebuild rule — **raw spans, never a token re-join**:

1. Scan the raw argument prefix into span-carrying tokens
   `{ raw, start, end, quoted }`, where `start`/`end` index the original string and
   a quoted token's span includes its quotes.
2. Find the token containing the cursor; when the prefix ends in whitespace, the
   current span is the empty span at the end.
3. `value = prefix.slice(0, span.start) + replacement + prefix.slice(span.end)`.

Why spans and not tokens: `tokenizeInspectorArgs()` strips quotes, so any rebuild
that joins tokens re-serializes the argument text. `--output "/tmp/my report.json"`
would come back as `--output /tmp/my report.json` — the quotes are gone, and for a
value containing a space the parsed meaning changes as well. Span replacement
copies preceding characters instead of re-serializing them, so corruption is
impossible by construction. Text after the cursor is Pi's own
`adjustedAfterCursor` region and is not part of `value` (§10.3).

The span-aware scanner and the existing parser tokenizer share one scanning core
so grammar decisions cannot drift; the parser keeps its current quote-stripping
behavior, and a test asserts both agree on token boundaries for the corpus in
§10.2. No synthetic trailing space (Ruling R2).

### 10.2 Required behavior (the acceptance set)

In the table `␠` marks a literal trailing space in the typed input.

| Input (cursor at end unless stated) | Selected item | Resulting line |
| --- | --- | --- |
| `/session-ins␠` | `ui` | `/session-ins ui` |
| `/session-ins ui␠` | `--theme` | `/session-ins ui --theme` |
| `/session-ins ui --th` | `--theme` | `/session-ins ui --theme` |
| `/session-ins ui --theme d` | `dark` | `/session-ins ui --theme dark` |
| `/session-ins ui --theme dark --` | `--scope` | `/session-ins ui --theme dark --scope` |
| `/session-ins json history --sc` | `--scope` | `/session-ins json history --scope` |
| `/session-ins json history --scope tr` | `tree` | `/session-ins json history --scope tree` |
| `/session-ins ui --output "/tmp/my report.json" --th` | `--theme` | `/session-ins ui --output "/tmp/my report.json" --theme` |
| `/session-ins ui --output "/tmp/my report.json"␠` | `--theme` | `/session-ins ui --output "/tmp/my report.json" --theme` |
| `/session-ins ui --the\|me` (cursor after `--the`) | `--theme` | `/session-ins ui --theme`, cursor after `--theme` |

Additional rules:

- Options already present in the token stream are not offered again.
- `json history|global` offers only `tree` for `--scope` (parser agreement,
  already implemented).
- Suggestion sets are never fabricated for an unparsable stream (`null`).
- A trailing space offers the next token's candidates; an empty token at the end
  of a value option offers that option's values.
- Every returned `value` is the rewritten raw prefix (§10.1); a bare token value
  is returned only when the raw prefix has no preceding content.

### 10.3 Boundary verification (the part unit tests cannot prove)

`tests/unit/command-completion-application.test.ts` drives the **real** pinned
provider:

1. Construct `new CombinedAutocompleteProvider([slashCommand], basePath)` from
   `@earendil-works/pi-tui`, where `slashCommand` is
   `{ name: "session-inspector", getArgumentCompletions: completeInspectorCommand }`.
2. `getSuggestions([line], 0, cursor, { signal })` → assert the suggestion set.
3. `applyCompletion(lines, 0, cursor, chosenItem, suggestions.prefix)` → assert
   the resulting **line and cursor** for every row of §10.2.

This test fails loudly if Pi changes the replacement contract, which is exactly
the guarantee today's tests lack. If `@earendil-works/pi-tui` is not currently a
runtime/dev dependency of the package, adding it as a devDependency is an
explicit prerequisite of slice P1-G (verified at implementation time; today the
type import already resolves).

Additional boundary cases driven through the same real provider:

1. **Cursor mid-token**: `applyCompletion` with the cursor inside the token
   (`/session-ins ui --the|me`); the assertion covers the resulting line **and**
   that the text after the cursor is preserved byte-for-byte with no duplicated
   remainder.
2. **Quoted argument preservation**: the quoted `--output` rows of §10.2 keep
   their quotes and embedded space verbatim.

Framework limitation note: Pi's provider API exposes no per-item replacement
range, so an extension cannot "replace only the token" other than by rewriting
the full argument text itself. That rewrite is the smallest upstream-compatible
approach; no Inspector-specific string hack beyond it is acceptable.

### 10.4 Acceptance criteria

1. All rows of §10.2 pass through the real provider, including the quoted-argument
   and cursor-mid-token rows.
2. Existing suggestion-set tests keep passing (they document intent).
3. Cursor-position coverage: completing with the cursor mid-argument leaves the
   text after the cursor intact (`adjustedAfterCursor` semantics preserved) and
   never duplicates the remainder of the current token.
4. No completion path ever returns a bare token value when the raw prefix has
   preceding content (asserted for every non-empty preceding-span case).
5. A quoted prior argument survives completion byte-for-byte, and the span-aware
   scanner agrees with the parser tokenizer on token boundaries.

---

## 11. Privacy and compatibility implications

### 11.1 Privacy (hard rules)

- Never persisted, never projected, never rendered, never placed in the hash:
  child `task`, `finalOutput`, `progressSummary`, `sessionName`,
  `sessionFile`, `transcriptPath`, `artifactPaths`; tool `content`/`details`
  bodies; raw tool arguments; prompts; assistant response text; file paths;
  URLs; secrets.
- Cross-boundary text is limited to: bounded redacted generation
  `errorMessage` (existing), bounded integration labels/counters, bounded
  inventory names/scopes/origins, bounded agent role/model/thinking tokens, and
  opaque ids.
- New derived fields reuse the existing validator style (`isBoundedTokens`,
  `isBoundedCost`, `AGENT_LABEL`, `INVENTORY_NAME`-style regexes) and the shared
  redaction module (`src/core/redact.ts`); no new ad-hoc string handling.
- The hash is treated as output: values are validated against the projection's
  own id vocabulary before use, and dropped (not echoed) otherwise.
- Coverage/diagnostic text is a closed vocabulary of tokens; no free text, no
  error strings from the filesystem.

### 11.2 Compatibility

| Surface | Change | Compatibility |
| --- | --- | --- |
| `SessionReport` | additive: `agents[].observedAt/model/thinking/failure/evidenceToolId`; `tools[].timestamp` and `errors[].timestamp` already existed | additive; old consumers ignore new keys |
| `HistoryReport` / `GlobalReport` | additive: `coverage?` (`inspected`/`available`/`unavailable`/`sessionRatio`/`complete`/`discoveryLimited`/`reasons`), `sessions[].reason?`, `sessions[].usageByDate?`, `sessions[].usageByDateTruncated?` | additive; a capped discovery yields `sessionRatio: null`, and an empty inspection set is never `complete` |
| `InspectorBundle` | additive: `current.sameReportProjection`, per-date model rows, daily composition, per-section `capabilities`, `modelsTruncated`/`dailyTruncated` flags | internal to the generated document; `schemaVersion` stays `1` (R3) |
| Command surface | unchanged (`ui`/`tui`/`json`, options, rejection of `report`) | unchanged |
| Older generated reports | render with conservative wording (`completeness unknown`, `Unavailable`) | never crash, never fabricate |
| Determinism | no clock reads; canonical ordering; byte-identical regeneration | preserved; asserted in tests |

---

## 12. Ordered implementation slices

Each slice ends with: focused tests, `npm run format:check && npm run lint &&
npm run typecheck`, `npm test`, and a spec-compliance + code-quality review.
Version bumps follow the repository rule (one version per release, in the
release slice): this milestone ships **0.8.0 → 0.9.0** and records ADR **0017**
(§0.2 item 10). `main` already consumed 0.8.0 for the evidence foundation, and
the v0.8.0 baseline is 588 passing tests at `81f65b7`.

### P0-A — Coverage correctness

- **Files:** `src/storage/history.ts` (per-session reason + cap signal),
  `src/core/session-coverage.ts` (new: `SessionCoverage`, `buildSessionCoverage`),
  `src/ui/load-history.ts` (reason at every existing early return + coverage
  assembly, shared by history and global),
  `src/ui/html.ts` (coverage panel + wording), tests + fixtures.
- **Contract delta:** `SessionCoverage` (named per R18), `CoverageReason`,
  `HistoricalSession.reason`, and the reason→code mapping of §3.1.1.
- **Acceptance:** §3.4 (1-9), including the **empty inspection set** and the
  **capped discovery** cases, where `sessionRatio` must be `null` and no
  percentage or `N / N` fraction may render.
- **Size gate:** document-size delta measured and recorded against the pre-slice
  baseline (coverage adds counts and short tokens only; no absolute ceiling).

### P0-B — Range correctness and scope labels

- **Files:** `src/ui/dated-usage.ts` (new: the single dated projection of
  §5.4), `src/ui/load-current.ts` + `src/ui/current.ts` (attach it to the
  current model), `src/ui/bundle.ts` (fold it into the daily rows, per-date model
  rows, `sameReportProjection`, capability table), `src/ui/html.ts` (one server
  projection + one client range filter over canonical rows), i18n catalog, tests.
- **Contract delta:** `DatedModelRow`, composition in `DailyRow`,
  `current.sameReportProjection`, per-section `capabilities`, per-view
  `usageByDate`/`datedModels` + their truncation flags, history
  `usageByDate`/`usageByDateTruncated`; range semantics per §5 (clamping removed),
  session membership per §5.6, and logical-call attribution per §5.7 — all from the
  one dated projection (R19).
- **Contract delta:** `DatedModelRow`, composition in `DailyRow`,
  `current.sameReportProjection`, per-section `capabilities`, history
  `usageByDate`/`usageByDateTruncated`; range semantics per §5 (clamping removed),
  session membership per §5.6, and logical-call attribution per §5.7 — all sourced
  from `CanonicalUsageLine` attribution (R19).
- **Acceptance:** §5.5 (1-10), §5.6, §5.7, §4.5 (1-5).
- **Size gate:** **relative** regression gate measured on the reference fixture —
  document growth ≤ +15 % versus the baseline captured before the slice, with
  before/after bytes and the fixture path recorded in the slice report. No
  arbitrary absolute ceiling.

### P1-C — Projection integrity

- **Files:** `src/ui/html.ts` (one projection, pass-through of
  role/artifacts/observedAt/model/thinking/failure/evidenceToolId, plus
  `Tool.timestamp` and the error/tool join), `src/core/reports.ts` (`agentUsage`
  fraction), tests + fixtures. The `subagents.ts` derivations this slice used to
  own are **already on `main`** (§0.3).
- **Contract delta:** §6.3 rows 1-3 and 7-9 (pass-through) plus the
  `agentUsage` fraction; the §6.3 derivations marked *done* need no code.
- **Acceptance:** §6.4 (1-4).

### P1-D — Agents, errors, tools semantics

- **Files:** `src/ui/html.ts` (client tabs + detail panels),
  `src/core/reports.ts` (child-usage counts), tests.
- **Contract delta:** §7.1-7.6 rendering; one-to-many `Related child run(s)`.
- **Acceptance:** §7.7 (1-9).

### P1-E — Environment and integrations semantics

- **Files:** `src/ui/html.ts` (Environment grouping + integrations columns),
  i18n, tests.
- **Acceptance:** §8.3 (1-4).

### P1-F — Navigation and routing

- **Files:** `src/ui/html.ts` (route consumption, capability-driven nav,
  cross-navigation), `src/ui/route.ts` (new: pure parse/serialize/derive), tests.
- **Acceptance:** §9.6 (1-9), including one-render dedup and the custom-range
  round-trip.
- **Test requirement:** route → rendered active state, supported tabs, and
  navigation context must be proven automatically (§13); manual UAT is not the
  coverage for those behaviors.

### P1-G — Autocomplete application fix

- **Files:** `src/commands/grammar.ts` (span-aware scanner shared with the
  tokenizer), `src/commands/completions.ts` (raw-prefix values),
  `tests/unit/command-completions.test.ts` (intent), new
  `tests/unit/command-completion-application.test.ts` (boundary),
  `package.json` (devDependency, if required).
- **Acceptance:** §10.4 (1-4).
- **Note (v0.8.0):** `@earendil-works/pi-tui@0.85.1` is already installed as a
  peerDependency and the type import already resolves, so no `package.json`
  change is expected; the slice must still prove the boundary with the real
  provider.

### P2-H — Presentation polish

- **Files:** `src/ui/html.ts` (styles + table rendering rules).
- **Acceptance:** numeric/cost columns right-aligned; description/message cells
  wrap; long ids truncate visually but remain copyable; status/identity columns
  readable; no decorative dashboard added.

---

## 13. Test strategy (deterministic, fixture-first)

Semantic assertions over snapshots; every new behavior gets a failing-first test.

| Area | File | Cases |
| --- | --- | --- |
| Coverage | `tests/unit/history-reports.test.ts`, `tests/unit/index-report-command.test.ts` | 5 of 27 inspected (uncapped) partial; all available; none available; **empty inspection set ⇒ `complete === false`, `sessionRatio === null`, `No tracked sessions`, usage `Unavailable`**; sessions dir unreadable; **discovery cap ⇒ `sessionRatio === null`, `complete === false`, `206 sessions inspected · additional sessions not inspected`, no percentage and no `206 / 206`**; `coverage`-absent report; unavailable sessions contribute no usage; Known vs Total wording; **reason→code mapping totality (§3.1.1)**; every reason produced by a real path (`session-unreadable`, `replay-failed` via the injectable replay/provider seams); history and global coverage equal; **selected history session detail has no coverage qualifier** |
| Range | `tests/unit/html-bundle.test.ts`, `tests/unit/bundle.test.ts` (+ new `tests/unit/report-range.test.ts`) | 7D vs 14D differ on every range-aware widget (models, tools, agents, errors, composition, chart) by filtering canonical rows; inclusive UTC boundaries; custom validation failure keeps state; range outside data → empty state; scope change preserves range; truncation notice; **aggregate session membership by in-range records (§5.6)**; **custom-range hash round-trip and lone/inverted-pair fallback**; **cross-midnight attribution regression (§5.7)**: call day carries the tool usage, next day carries the error, totals and composition stay consistent; **>366-day session fixture**: `usageByDateTruncated`, an old Custom range renders `Known` + `history-daily-truncated` (never zero), a recent range reconciles exactly with the detail view |
| Scope | `tests/unit/current-ui.test.ts`, `tests/unit/index-current-ui.test.ts` | linear session with `sameReportProjection === true` and the exact note wording; branched Active≠Tree; sibling exclusion; child usage never added; labels contain no descendant claim |
| Agents | `tests/unit/subagents.test.ts`, `tests/unit/html-bundle.test.ts` | activity calls ≠ run count; failed-run cost; partial child usage; parent resolution (in-scope / tree-only / unknown); role/model/thinking present only when validated and shown as metadata only (no Models link); **one result publishing several runs ⇒ one-to-many `Related child run(s)`**; `evidenceToolId` only from `message.toolCallId`; `observedAt` from the publishing entry; no raw task/output text |
| Errors | `tests/unit/error-ledger.test.ts`, `tests/unit/reduce.test.ts` | generation message preserved; tool error joined to tool (name/source/status); tool error without message → Unavailable; no tool-result leak |
| Tools | `tests/unit/html-bundle.test.ts` (+ new call rows) | summary aggregation; success/failure/interrupted; known vs unavailable usage; timeline timestamps; duration only with live evidence |
| Navigation | `tests/unit/route.test.ts` (new, pure) + document-structure assertions in `tests/unit/html-bundle.test.ts` | route parse/serialize round-trip incl. custom `from`/`to` pair; canonical parameter order; half-pair fallback; derived view model: active section, active tab, capable tabs, scope, range, entity, notice; **one render when both `hashchange` and `popstate` fire; no focus effect on range-only change**; capability filtering; hash carries no hostile text; per-table state isolation; unsupported tab coercion; **no Agent → Models navigation target (different usage domains)** |
| Autocomplete | `tests/unit/command-completions.test.ts`, `tests/unit/command-completion-application.test.ts` | all §10.2 rows via the real provider, including quoted `--output` and cursor-mid-token; prior characters preserved byte-for-byte; options already present filtered; span scanner agrees with the parser tokenizer |
| Compatibility/privacy | `tests/unit/integration-privacy.test.ts`, `tests/unit/uat-evidence.test.ts` | old reports without new fields; no prompt/output/path/args/result text; new diagnostics bounded; determinism byte-identity |

Client-side routing and rendered active state are proven automatically with the
lightest harness that can do it (R11). Manual UAT is a complement, never the
coverage.

1. **Pure route tests (primary).** Parsing, serialization, capability filtering
   and the derived view model live in `src/ui/route.ts` and are unit-tested
   directly. The derived view model exposes exactly the state that drives
   rendering — active section, active tab, visible (capable) tabs, scope,
   resolved range, entity, notice — so route → active state is asserted in a
   test, which is precisely what today's suite cannot do.
2. **Document-structure assertions.** The generated document is parsed as text to
   assert (a) the capability table it embeds and (b) that no active-state
   attribute (`aria-current`, `aria-selected`, `aria-pressed`) is hardcoded in
   the initial markup — every one of them must be produced by the render path.

A real DOM implementation is **not a precondition and not a prohibition**: if a
later slice finds a behavior these two layers cannot express, the smallest
available DOM implementation may be added as a devDependency at that point, with
its own justification in the slice report.

---

## 14. Manual UAT plan (after implementation)

1. `/session-inspector ui` → Current overview renders; coverage panel absent.
2. Switch to **Full session tree**; note appears only when the projections are
   identical.
3. Select a **Custom** range; confirm validation, inclusive boundaries, and that
   scope/tab/sidebar state is untouched; then check a cross-midnight call (or the
   cross-midnight fixture) in both adjacent single-day ranges and confirm the tool
   usage sits on the call day while the error sits on the observation day.
4. Open **Agents**; confirm `Child runs` ≠ `Agent tool activity`.
5. Follow an Agent → parent reference and confirm range + scope survive; confirm
   that **no** Agent → Models link exists and that the child's model/thinking are
   shown only as metadata in the agent detail.
6. Scroll: confirm the sidebar active item and tab match the content.
7. Open **Errors**; follow a Tool and an Agent reference.
8. Press Back/Forward; confirm content **and** active styling restore.
9. Reload the page (deep link); confirm the same state returns.
10. `/session-inspector json history` → open the file; confirm `coverage` and
    per-session `reason` values, and that usage only sums available sessions.
11. `/session-inspector ui` → History and Global: confirm `Known native cost` /
    `5 / 27 sessions` wording when partial, `206 sessions inspected · additional
    sessions not inspected` when the discovery cap was hit (with no percentage),
    and that Global exposes Overview only.
12. Confirm no tab leads to a guaranteed-`Unavailable` page.
13. Type `/session-ins ui --theme d` + TAB: confirm `/session-ins ui --theme dark`
    (prior tokens preserved); repeat for each row of §10.2.
14. Open the generated HTML with networking disabled; confirm it renders fully
    with zero network requests (no CDN, no fonts, no fetch/XHR).
15. `/session-inspector tui` and `/session-inspector tui ledger`: confirm the TUI
    still renders both tabs and the scope switch.
16. Open a History session detail: confirm that session's own figures appear with
    **no** coverage panel and **no** `Known` qualifier.
17. Type `/session-ins ui --output "/tmp/my report.json" --th` + TAB: confirm
    `/session-ins ui --output "/tmp/my report.json" --theme` (quotes and embedded
    space preserved); repeat with the cursor inside the option token.
18. Copy the hash of a **Custom** range, open it in a new tab, and confirm the
    same range and the same numbers; then truncate the hash to `from` only and
    confirm the default range plus the restoration notice.

---

## 15. Explicit data-support list: unsupported and deferred

Two different verdicts are recorded here. **Unsupported** means no safe evidence
exists, so the value can only ever render `Unavailable`. **Deferred (out of
scope)** means the evidence exists but this milestone deliberately does not
aggregate or expose it; nothing about it is fabricated in the meantime.

| Requested capability | Verdict | Reason |
| --- | --- | --- |
| Per-day coverage (which days are incomplete) | **Unsupported** | Unavailable sessions are unreadable by definition; their dates are unknown. Only the overall coverage line is honest. |
| Usage-coverage ratio / estimated unavailable usage | **Unsupported** | Would fabricate usage. Only the session ratio exists. |
| Tool-error message text | **Unsupported** | No structured error field exists in persisted tool results; the only text (`content`) is outside the privacy boundary. `Message: Unavailable`. |
| Tool result content / arguments in any view | **Unsupported by design** | Privacy boundary. |
| Agent run duration | **Unsupported** | No producer duration field; deriving one from timestamps would be an estimate. |
| Agent free-text failure reason | **Unsupported** | Producer exposes only bounded enums (`state`, `success`, `exitCode`, `processSignal`, `outputState`). |
| Agent model / thinking level | **Supported, conditional** | Present in `results[]` for the pinned producer; validated, optional, `Unavailable` when the producer is unknown/absent. |
| Agent task description / summary | **Unsupported** | Prompt text; privacy boundary. |
| Global/History per-model, per-tool, per-agent breakdowns | **Deferred (out of scope)** | Every scanned session is replayed into a full `SessionReport`, so the evidence exists; this milestone does not aggregate it across sessions and therefore offers no such tabs (§9.3). A later milestone can add them without new persistence. |
| Inventory invocation counts for commands/prompts | **Unsupported** | No counter evidence exists; skills have counters, commands do not. |
| Live duration for historical sessions | **Unsupported** | Duration evidence is live-correlation only. |
| Integration version when the producer publishes none | **Unsupported** | Rendered `Unavailable`, never `0`. |
| Exact aggregate-row/detail reconciliation for ranges older than a session's retained dated window | **Unsupported (bounded projection)** | The per-session `usageByDate` window holds 366 dates; the omitted portion is reported as partial/`Known` with a truncation diagnostic, never reconstructed. |
| Child usage completeness when some runs report none | **Known-only** | Shown as `Known … (n of m runs)`; never extrapolated. |

---

## 16. Presentation polish (P2)

(Note: this section is deliberately placed after the contracts; it must not
start before §3-§10 are settled, and it changes no contract.)

- Remove the global `table { white-space: nowrap }` and
  `td:last-child { text-align: right }` rules. Replace with per-column classes:
  numeric/token/cost columns right-aligned with tabular numerals; description,
  message and label columns wrap; status and identity columns stay readable;
  long opaque ids get `text-overflow: ellipsis` with the full value available via
  the details panel and a copy button.
- Prefer drill-down over new summary cards: no new dashboard that repeats an
  existing metric.
- Optimize the report for: what consumed the money/tokens; which model/tool/agent
  caused it; what failed; why (as far as evidence allows); which integrations were
  observed; how complete the report is (coverage panel).
- Keyboard and focus affordances are preserved for every new interactive element.

---

## 17. Rulings taken during design (to confirm at approval)

| # | Ruling | Why | Cost if wrong |
| --- | --- | --- | --- |
| R1 | Remove silent custom-range clamping to observed data | Clamping rewrote user input without a message; empty states are honest | A user can select a range with no data and see an empty state |
| R2 | Completion `value` carries no synthetic trailing space | Matches the required examples exactly; Pi inserts the text verbatim | One extra keystroke before the next suggestion set |
| R3 | `schemaVersion` stays `1` (no reader exists for generated documents) | The bundle is generated and consumed atomically; churn without benefit | A future reader of old documents must tolerate additive keys |
| R4 | Agents summary counts child runs only; activity is a separate labelled block | Server-side distinct DTO fields already permit it | Two blocks instead of one |
| R5 | Routing uses the hash (`#/…`), not `pushState` + path rewriting | Works from `file://`, offline, and inside a single generated document | Long URLs; hash-only deep links |
| R6 | One range per view identity (current, history:aggregate, history:\<session\>, global) | Prevents a selected session inheriting the aggregate's range | More state in the route; slightly more parsing |
| R7 | Error/tool → child linkage via `AgentRun.evidenceToolId = "tool:" + message.toolCallId`, rendered as a one-to-many `Related child run(s)` list | The persisted `message.toolCallId` is the canonical id (the reducer builds `tool:<callId>` from it); the publishing result is not necessarily the launching call, and one result may publish several runs | One extra optional field in the agent DTO; the error panel shows a list instead of one link |
| R8 | Section capabilities are computed server-side from the data contract | Single source of truth; no hand-maintained client matrix | Capability list must be updated with DTO changes |
| R9 | Inventory is never range-filtered | It is environment state, not session activity | A user filtering by range still sees full inventory (labelled) |
| R10 | `model`/`thinking` are exposed as optional, producer-validated fields | Real evidence exists for the pinned producer; absent elsewhere | Fields appear only for 0.59.0-shaped payloads |
| R11 | Automatic proof of route → rendered active state via pure view-model tests plus document-structure assertions; a DOM is optional, not a precondition | The original active-state bug must not rest on manual UAT, and pure tests are the lightest harness that proves it | If those layers cannot express a behavior, a small DOM devDependency must be added later with justification |
| R12 | A capped discovery makes `sessionRatio` `null` and forbids any percentage or `N / N` rendering | The workspace denominator is unknown; a ratio over the capped set would assert unmeasured coverage | The capped case shows counts instead of a percentage |
| R13 | Inactive view ranges and inactive table settings are ephemeral caches, not deep-link state | The route must be the single authority; two sources of truth recreate the original active-state bug | Reopening a deep link resets other views' ranges/table settings to defaults |
| R14 | Aggregate range membership requires at least one in-range observed record, not span overlap | Span intersection is not usage in the period | A session that brackets a range without activity inside it is excluded from that range's rows |
| R15 | Range attribution is by **logical call** (§5.7): tool usage/cost on `Tool.timestamp`, tool errors on `ErrorRecord.timestamp`, child runs on `AgentRun.observedAt` | The two-rule alternative (attributing everything to result arrival) would make tool cost move between days whenever a result crosses midnight | A cross-midnight call splits its usage and its error across two days, by design |
| R16 | Per-session `usageByDate` is capped at 366 dates, with a single `usageByDateTruncated` flag and a `Known` qualifier for older ranges. The flag is also set when the builder reports `evidenceHealth.usage.dated === "partial"`, because unattributed native usage cannot be dated | Keeps the aggregate bounded without ever faking completeness or zero, and gives the two partial causes one honest rendering | Ranges older than the retained window show partial/`Known` per-session figures rather than exact ones; an unattributable session is partial for every range |
| R17 | No Agent → Models navigation target, even when `AgentRun.model` matches a parent-session model | Native parent generations and child-run usage are different domains; a name match is not evidence of identity | Child model/thinking stay agent-detail metadata; a future child-model breakdown can add a real target |
| R18 | The aggregate coverage type is `SessionCoverage` (not `CoverageSummary`), in `src/core/session-coverage.ts` | The canonical model already owns `UsageCoverage`; two types named "coverage" with different meanings invite exactly the confusion this milestone exists to remove | One rename now; §3.1's field names are unchanged |
| R19 | Per-date rows come from **one** module (`src/ui/dated-usage.ts`), computed over the canonical session from `CanonicalUsageLine.attributedAt`/`domain`/`bucket` and joined to the canonical generation rows by `ownerId`. Every consumer (current views, history/global, the chart) folds those rows; nothing re-walks `SessionReport` timestamps to build a second dated projection | The builder is the single attribution authority (R15/§5.7) and the bundle only sees the report, so a second date-bucketing walk there would drift at the first producer change | A per-date figure can only differ from the report if the builder is wrong, which is then a single place to fix; the cost is one small module and a fold instead of a walk |
| R20 | Every `CoverageReason` maps onto an existing `EvidenceDiagnosticCode` or `HistoryDiagnostic`, asserted by a totality test | Invariant 8 (degrade, never guess) plus the ban on a second vocabulary: a runnability reason must be traceable to a bounded code | Adding a reason requires naming the code it projects |

---

## 18. What this design deliberately does not do

- No new persisted fields, no new collectors, no WAL/checkpoint change, no
  schema migration (every addition is read-time derivation or projection).
- No change to the command surface, the grammar, or the option set.
- No change to reducer semantics, counter folding, retention, or maintenance.
- No upstream Pi change; no dependency on Pi internals beyond the pinned
  `pi-tui` autocomplete contract, which is now covered by a boundary test.
- No decorative dashboards; no metric without a question it answers.
- M8 hardening remains a separate, later milestone.
