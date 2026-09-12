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

## 1. Verified current state (facts this design builds on)

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
- Current UI labels are `Active` / `Tree`; the context note reads
  `<label> after tracking marker` (`src/ui/html.ts:1358`).

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
| A1 | Coverage DTO (discovered/available/unavailable/ratio/reasons) | deterministic report derivation | `discoverHistory` + `scanHistory` already compute availability and diagnostics; only per-session reasons and assembly are new |
| A2 | Per-session bounded unavailable reason | deterministic report derivation | new enum field on `HistoricalSession`; no persistence |
| A3 | Discovery-truncation surfacing | deterministic report derivation | `history-limit-reached` already exists |
| A4 | "Known usage" wording + never-zero for unavailable | renderer-only | HTML/TUI labels + i18n |
| A5 | Per-day coverage | **unsupported** | dates of unreadable sessions are unknown (§15) |
| B1 | One range-filtered projection shared by all tabs | deterministic report derivation + renderer | needs dated rows carried into the browser payload (§5.4) |
| B2 | Explicit range contract (presets, UTC, inclusive, custom, persistence, truncation) | renderer-only + contract doc | some validation semantics change (see §5.3) |
| B3 | Scope labels/descriptions + "same for this session" | renderer-only + one derived flag | `sameProjection` computed at bundle time |
| C1 | Browser-facing canonical DTO (one projection) | renderer-only | single projection function; delete per-tab ad-hoc shaping |
| C2 | Tool timestamp in browser rows | renderer-only | value already in `Tool.timestamp` |
| C3 | Agent role + artifact availability in browser rows | renderer-only | values already in `AgentRun` |
| C4 | Agent run timestamp | deterministic report derivation | from the publishing tool-result entry (`entry.timestamp`) |
| C5 | Agent model / thinking level | deterministic report derivation | present in `results[].model` / `.thinking` for the pinned producer; validated and optional |
| C6 | Agent bounded failure classification | deterministic report derivation | `state`/`success`/`exitCode`/`processSignal`/`outputState` enums |
| D1 | Agents summary = child runs, not `agentActivity.calls` | renderer-only | both values already in the payload |
| D2 | Agent tool activity shown separately | renderer-only | `agentActivity` already in the payload |
| D3 | Parent/child navigation + "outside selected scope" | deterministic report derivation + renderer | `parentId` resolution against the selected scope |
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

Both `HistoryReport` and `GlobalReport` gain one optional field:

```ts
/** Bounded reasons a discovered session could not be replayed. */
export type CoverageReason =
  | "no-manifest"          // neither metadata nor pending manifest was readable
  | "manifest-unavailable" // manifest exists, source file is missing/unresolvable
  | "marker-unavailable"   // source exists but tracking-marker evidence failed
  | "session-unreadable"   // parse failure, malformed JSON, no header, id mismatch
  | "replay-failed";       // reducer/adapters threw for this session

export type CoverageSummary = {
  /** Sessions discovery found (before any availability resolution). */
  discovered: number;
  available: number;
  unavailable: number;
  /** available / discovered; null when discovered === 0. Sessions, never usage. */
  sessionRatio: number | null;
  /** True only when every discovered session replayed. */
  complete: boolean;
  /** True when discovery stopped at MAX_HISTORY_SESSIONS. */
  discoveryLimited: boolean;
  /** Bounded reason counts; keys with zero occurrences are omitted. */
  reasons: Readonly<Partial<Record<CoverageReason, number>>>;
};

export type HistoryReport = {
  availability: "available" | "unavailable";
  sessions: HistoricalSession[];
  diagnostics: HistoryDiagnostic[];
  coverage?: CoverageSummary; // absent = older report or discovery unavailable
};

export type HistoricalSession =
  | { availability: "available"; sessionId: string; report: SessionReport }
  | { availability: "unavailable"; sessionId: string; reason?: CoverageReason };
```

`GlobalReport` gains the same `coverage?`. `HistoricalSession.reason` is additive
and optional; when absent (older data, or a reason class that does not exist
yet) renderers must show "Unavailable", never a guessed reason.

### 3.2 Derivation rules (all read-time, no persistence)

1. `discovered` = number of rows returned by `discoverHistory()` (i.e. after the
   206 cap). `discoveryLimited` = the `history-limit-reached` diagnostic is
   present. `available` = rows that replayed; `unavailable = discovered -
   available`, so the three counts always add up and a renderer can never show a
   fraction that does not close.
2. `complete` = `unavailable === 0 && !discoveryLimited && availability === "available"`.
   Truncated discovery is *not* complete even when every retained session replayed.
3. `sessionRatio` = `available / discovered` rounded to 4 decimals; `null` when
   `discovered === 0`. It is a **session** ratio and is only ever rendered next
   to a session fraction, never next to a currency amount.
4. `reasons` is built from the per-session reason tags; the report-level
   `diagnostics` array is retained unchanged for backwards compatibility.
5. When report `availability === "unavailable"` (the sessions directory itself is
   unreadable or scope forces it), `coverage` is **omitted** — the aggregate is
   unavailable, not zero.
6. Reason mapping is deterministic and exhaustive. `load-history.ts` records the
   reason at each existing early return; `discoverHistory` gains a bounded reason
   in place of the bare `availability: "unavailable"` it returns today. No new
   filesystem probe is added: each reason already corresponds to an existing
   check that currently discards its cause.
7. `scanHistory` already replays once and shares the result between history and
   global; coverage is computed from that single scan, so history and global can
   never disagree.

### 3.3 Wording rules (the contract that makes the defect impossible to render)

| Condition | Cost/token wording | Session wording |
| --- | --- | --- |
| `coverage` absent (older report / aggregate unavailable) | `Native cost — completeness unknown` | `Sessions: Unavailable` |
| `coverage.complete === true` | `Native cost` / `Total tokens` | `27 / 27 sessions` |
| `coverage.complete === false` | **`Known native cost`** / **`Known tokens`** | `5 / 27 sessions · 22 unavailable` |
| `available === 0` | `Unavailable` (not `$0.00`) | `0 / 27 sessions · 27 unavailable` |
| `available === 0` **and** `discovered === 0` | `Unavailable` | `No tracked sessions` |

Additional rules:

- Never the bare word "Total" for a partial sum; `usage.total` in the JSON DTO
  keeps its field name (compatibility) but the UI label changes.
- The word "Known" is the only qualifier used for partial aggregates; no
  "approximate", no "estimated", no extrapolation.
- Unavailable sessions contribute **nothing** to `usage`, `dates`, charts, or
  any count other than the coverage line itself. They are never rendered as a
  zero-cost row.
- The coverage panel is present in every section that can be partial
  (history aggregate, history session detail, global) and carries the bounded
  diagnostics (`manifest-unavailable`, …) as plain tokens, plus
  `discovery-limited` when discovery hit the cap.
- Per-day coverage is **not** rendered. When `coverage.complete === false`, the
  chart and daily tables carry the overall notice (one line), because the dates
  of unavailable sessions are unknown.
- Coverage is a history/global concept only. The TUI has no history or global
  section (`tui current|ledger`), so it gains no coverage surface; `json
  history|global` expose `coverage` verbatim.

### 3.4 Acceptance criteria

1. 5 available / 27 discovered ⇒ `coverage.complete === false`, session line
   `5 / 27 sessions · 22 unavailable`, cost label `Known native cost`, and the
   five replayed sessions' usage exactly equals the rendered sum (no filler).
2. All available ⇒ `complete === true`, labels `Native cost` / `Total tokens`,
   session line `27 / 27 sessions`, no coverage warning.
3. Zero available with a non-empty discovery ⇒ cost shows `Unavailable`, session
   line `0 / N sessions · N unavailable`, no `$0.00` anywhere.
4. Sessions directory unreadable ⇒ `availability: "unavailable"`, no `coverage`
   key, every aggregate metric `Unavailable`.
5. Discovery capped at 206 while 300 directories exist ⇒ `discoveryLimited`,
   `complete === false`, notice `discovery-limited`, and no claim of totals.
6. A `coverage`-less report (older file) renders the `completeness unknown`
   variants, not `Total`.
7. Byte-identical regeneration of the same inputs (determinism unchanged).

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
- ADR 0006 remains the normative scope definition; the design only renames the
  labels and adds the identical-projection indication.

### 4.3 Identical projections

`InspectorBundle.current` gains one derived flag:

```ts
current: {
  active: CurrentView;
  tree: CurrentView;
  /** True when both views produce byte-identical reports (linear session). */
  sameProjection: boolean;
};
```

Computed at bundle time by comparing the two views' canonical JSON payloads
(the same serializer used for the document, so the comparison is not a second
definition of equality). When `true`:

- both scope buttons remain enabled (scope is still a real control for other
  sessions and after further work), but a concise note appears:
  `Same data for this session: the selected path covers every tracked entry.`;
- no copy anywhere claims that switching scope changes the numbers.

When `false`, the note is absent. This is renderer-visible only; no report field
changes.

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

1. Linear session ⇒ `sameProjection === true`, note rendered, both buttons
   enabled, `active` and `tree` report payloads byte-identical.
2. Branched session with a sibling branch ⇒ `sameProjection === false`, active
   totals exclude the sibling's usage, tree totals include it, and neither total
   includes child-run usage.
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
| history (aggregate) | Overview metrics, chart, session rows | usage, sessions, days; a session row is in range when its span intersects the range | inventory counts (environment) |
| history (session) | all tabs | identical to `current` | — |
| global | Overview metrics, chart, session rows | usage, sessions, days | inventory counts (environment) |
| global/history | Models/Tools/Agents/Errors tabs | not supported by the aggregate DTO ⇒ tabs are absent (§9), not rendered full-period | — |

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
  Remembered ranges for other view identities live in memory for the document's
  lifetime; the route serializes the range of the **active** view identity only,
  so a deep link always reproduces the view it points at.
- The active range is **part of the navigation state** (§9) and therefore
  serialized into the URL hash. Changing tab, scope, section, or following an
  internal link preserves it. Selecting a different history session restores
  that session's previously selected range if one exists, else the default.
- Range is never written back into a report DTO; it is a view-state concept only.
  `json` output is unaffected.

### 5.4 Implementation shape (why this is derivation, not new persistence)

The browser needs dated rows to filter honestly. Today it receives only
`daily: DailyRow[]` plus undated aggregate rows. The design extends the **bundle
payload** (not the report DTO) with one dated projection per current view,
bounded exactly like `daily`:

```ts
type DatedModelRow  = { date: string; provider: string; model: string; generations: number; totalTokens: number; cost: number };
type DatedToolRow   = { date: string; name: string; source?: string; status: Tool["status"]; calls: number; totalTokens?: number; cost?: number };
type DatedAgentRow  = { date: string; id: string; parentId?: string; agent?: string; status: AgentRun["status"]; confidence: Confidence; artifacts?: "available" | "missing"; model?: string; thinking?: string; failure?: AgentFailure; usage?: SafeUsage };
type DatedErrorRow  = { date: string; id: string; kind: ErrorKind; confidence: Confidence; toolName?: string; toolSource?: string; agentId?: string };
type DailyRow = { /* existing */ date, sessions, totalTokens, cost, generations, tools;
                  composition: { generations: SafeUsage; toolResults: SafeUsage; compactions: SafeUsage; branchSummaries: SafeUsage } };
```

Rules:

- Every array is capped (`MAX_DAILY_ROWS = 366` dates) and carries a
  `truncated` flag when capped; capped output is visibly marked, never silently
  short.
- Nothing here is persisted. These rows are derived at bundle time from the
  already-replayed `SessionReport` (each `Generation`, `Tool`, `AgentRun`,
  `ErrorRecord` carries or can carry a timestamp) and live only inside the
  generated document.
- The per-row duplication is bounded: an extra ≤366 × (models) row set, with
  per-date row counts further capped by the existing `MAX_*` limits. The
  measured size ceiling is part of the slice acceptance (§11, P0-B).

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
| browser | `src/ui/html.ts` client | reads the projection only | `AgentRun.agent`, `AgentRun.artifacts`, `Tool.timestamp`, all model dates, all per-date composition |

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

| Loss | Fix (class) | Slice |
| --- | --- | --- |
| `AgentRow` drops `agent`, `artifacts` | pass through validated values (renderer) | P1-C |
| `AgentRow` has no timestamp | `AgentRun.timestamp` derived from the publishing entry (derivation) | P1-C |
| `ToolRow` drops `timestamp` | pass through (renderer) | P1-C |
| Models cannot be range-filtered | per-date model rows in the bundle projection (derivation) | P0-B |
| Composition cannot be range-filtered | per-date composition in `DailyRow` (derivation) | P0-B |
| Agents cannot be range-filtered | per-date agent rows (derivation) + `AgentRun.timestamp` | P0-B |
| `AgentRun` has no model/thinking | `model?`, `thinking?` validated from `results[]` (derivation, producer-version dependent) | P1-C |
| `AgentRun` has no bounded failure class | `failure?: AgentFailure` from validated enums (derivation) | P1-C |
| Errors cannot link to an agent | `AgentRun.toolCallId` (opaque) from `details.toolCallId` (derivation) | P1-D |
| Child usage completeness unknown | `childUsage` counts (`runsWithUsage` / `runsTotal`) in the agent projection (derivation) | P1-D |

Every derivation above is computed from already-persisted producer payloads,
validated with the existing bounded-validator style, and optional in the DTO.
Where the producer is absent or of an unknown version, the field is absent and
the UI shows `Unavailable`.

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
3. **Agent relation**: when the error's tool id equals an agent run's
   `toolCallId`, offer `Related agent run` navigation. Otherwise no agent is
   shown (never inferred from timestamps).
4. **Message**: tool errors have no safe structured message (§1.5) ⇒
   `Message: Unavailable`. No text is ever taken from `content`, tool output,
   arguments, or child output.

Error detail panel adds: error kind, confidence, UTC timestamp, tool name,
tool source, tool status, related tool link, related agent link (when
deterministic), and the bounded message or `Unavailable`.

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
  range: RangeState;              // resolved per view identity (§5.3)
  entity?: EntityRef;             // drill-down target
  table?: { query?: string; sort?: string }; // per (section, tab)
};
```

Serialization (hash only, no query string, no server):

```text
#/current/tools?scope=tree&preset=7&entity=tool%3Atool%3Acall_abc&q=bash&sort=cost
#/history/overview?session=<sessionId>&preset=14
#/global/overview?preset=30
```

Rules:

- Deterministic key order (`section/tab` path, then a fixed parameter order);
  omitted parameters mean defaults.
- Only bounded values: enum tokens, ISO dates, numeric presets, and ids that
  already exist in the projection. Text from tool arguments/results/prompts can
  never reach the hash (validated against the projection's id set on parse; an
  unknown id is dropped, never echoed).
- Parsing is total: any unknown section/tab/option degrades to the section
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
- `hashchange`/`popstate` → parse → render without pushing (Back/Forward and
  `location.reload()` both work).
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
| history (aggregate) | overview (+ chart, session list) | aggregate DTO carries usage/dates/session rows only |
| history (session selected) | all tabs | full `SessionReport` present |
| global | overview (+ chart) | aggregate DTO carries usage/dates only |

The client renders only capable tabs, and route validation coerces an
unsupported tab to the section default with the notice above. Tabs are never
"present but guaranteed Unavailable".

### 9.4 Cross-navigation (links only where a destination exists)

| From | To | Context preserved |
| --- | --- | --- |
| Overview model row | Models tab, entity-focus that model | section, scope, range |
| Overview tool row | Tools summary, entity-focus that tool | section, scope, range |
| Tool summary row | Tools calls filtered to that tool | range, scope |
| Tool call row (failed) | Errors, entity-focus the matching error | range, scope |
| Error row | related tool call / related agent run (when deterministic) | range, scope |
| Agent row | parent / child run (when resolved in scope) | range, scope |
| Agent row | model row when `AgentRun.model` exists | range, scope |
| Integration row | its own detail panel (counters, version, telemetry reason) | all |
| Command / Skill / Resource row | Environment subsection | all |

Every link is an anchor with a hash target; non-linked labels keep their plain
text and are never styled as links. Focused entities get `:target`-style
highlighting plus a visible focus ring (existing `focus-visible` outline).

### 9.5 Table-local state

- Search/sort/metric live in `route.table` keyed by `(section, tab)`, so two
  tables never share one query.
- Section change clears the table state of the section being left; tab change
  preserves each tab's own state; Back restores the previous table state because
  it is part of the route.

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

---

## 10. Autocomplete integration strategy (Workstream I)

### 10.1 Contract

`completeInspectorCommand(argumentPrefix)` keeps its signature; the **item
values change**:

```ts
type AutocompleteItem = { value: string; label: string; description?: string };
// value = the FULL replacement argument text: preceding tokens verbatim,
//         current token replaced by the chosen completion, single spaces.
// label = the token alone (readable in the popup).
```

Rebuild rule: `value = [...tokensBefore, replacement].join(" ")`, where
`tokensBefore` are the tokens before the token being completed, exactly as
tokenized (quotes preserved by `tokenizeInspectorArgs`). No synthetic trailing
space (Ruling R2). Because Pi replaces `[cursor - prefix.length, cursor)` with
`item.value` and `prefix` is the whole argument text, this preserves every
preceding argument by construction.

### 10.2 Required behavior (the acceptance set)

| Input (cursor at end) | Selected item | Resulting line |
| --- | --- | --- |
| `/session-ins` | `ui` | `/session-ins ui` |
| `/session-ins ui` | `--theme` | `/session-ins ui --theme` |
| `/session-ins ui --th` | `--theme` | `/session-ins ui --theme` |
| `/session-ins ui --theme d` | `dark` | `/session-ins ui --theme dark` |
| `/session-ins ui --theme dark --` | `--scope` | `/session-ins ui --theme dark --scope` |
| `/session-ins json history --sc` | `--scope` | `/session-ins json history --scope` |
| `/session-ins json history --scope tr` | `tree` | `/session-ins json history --scope tree` |

Additional rules:

- Options already present in the token stream are not offered again.
- `json history|global` offers only `tree` for `--scope` (parser agreement,
  already implemented).
- Suggestion sets are never fabricated for an unparsable stream (`null`).
- A trailing space offers the next token's candidates; an empty token at the end
  of a value option offers that option's values.

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
explicit prerequisite of slice P1-I (verified at implementation time; today the
type import already resolves).

Framework limitation note: Pi's provider API exposes no per-item replacement
range, so an extension cannot "replace only the token" other than by rewriting
the full argument text itself. That rewrite is the smallest upstream-compatible
approach; no Inspector-specific string hack beyond it is acceptable.

### 10.4 Acceptance criteria

1. All seven rows of §10.2 pass through the real provider.
2. Existing suggestion-set tests keep passing (they document intent).
3. Cursor-position coverage: completing with the cursor mid-argument leaves the
   text after the cursor intact (`adjustedAfterCursor` semantics preserved).
4. No completion path ever returns a bare token value (asserted for every
   non-empty `tokensBefore` case).

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
| `SessionReport` | additive: `agents[].timestamp/model/thinking/failure/toolCallId`, `tools[].timestamp` already existed in DTO | additive; old consumers ignore new keys |
| `HistoryReport` / `GlobalReport` | additive: `coverage?`, `sessions[].reason?` | additive |
| `InspectorBundle` | additive: `current.sameProjection`, extra dated rows, `capabilities` | internal to the generated document; `schemaVersion` stays `1` (R3) |
| Command surface | unchanged (`ui`/`tui`/`json`, options, rejection of `report`) | unchanged |
| Older generated reports | render with conservative wording (`completeness unknown`, `Unavailable`) | never crash, never fabricate |
| Determinism | no clock reads; canonical ordering; byte-identical regeneration | preserved; asserted in tests |

---

## 12. Ordered implementation slices

Each slice ends with: focused tests, `npm run format:check && npm run lint &&
npm run typecheck`, `npm test`, and a spec-compliance + code-quality review.
Version bumps follow the repository rule (one version per release, in the docs
slice).

### P0-A — Coverage correctness

- **Files:** `src/storage/history.ts`, `src/ui/load-history.ts`,
  `src/core/reports.ts` (validation of the new optional fields),
  `src/ui/html.ts` (coverage panel + wording), `src/ui/current-tui.ts` (no change
  expected: TUI has no history/global sections), tests + fixtures.
- **Contract delta:** `CoverageSummary`, `CoverageReason`,
  `HistoricalSession.reason`.
- **Acceptance:** §3.4 (1-7).
- **Size gate:** bundle payload growth for a 27-session workspace stays under
  5 % (measured, recorded in the slice report).

### P0-B — Range correctness and scope labels

- **Files:** `src/ui/bundle.ts` (dated rows, caps, `sameProjection`),
  `src/ui/html.ts` (server projections + client routing of range through one
  filter), `src/core/redact.ts` (unchanged), i18n catalog, tests.
- **Contract delta:** dated rows in the bundle payload; `current.sameProjection`;
  range semantics per §5 (clamping removed).
- **Acceptance:** §5.5 (1-7) and §4.5 (1-5).
- **Size gate:** generated document stays under 512 KiB for the reference
  workspace; per-date arrays capped and truncation-flagged.

### P1-C — Projection integrity

- **Files:** `src/integrations/subagents.ts` (`timestamp`, `model`, `thinking`,
  `failure`), `src/ui/html.ts` (one projection, pass-through of role/artifacts/
  timestamps), tests + fixtures.
- **Contract delta:** §6.3 rows 1-3, 7-9.
- **Acceptance:** §6.4 (1-4).

### P1-D — Agents, errors, tools semantics

- **Files:** `src/ui/html.ts` (client tabs + detail panels),
  `src/integrations/subagents.ts` (`toolCallId`, child-usage counts), tests.
- **Contract delta:** §7.1-7.6 rendering; no further DTO change.
- **Acceptance:** §7.7 (1-7).

### P1-E — Environment and integrations semantics

- **Files:** `src/ui/html.ts` (Environment grouping + integrations columns),
  i18n, tests.
- **Acceptance:** §8.3 (1-4).

### P1-F — Navigation and routing

- **Files:** `src/ui/html.ts` (route model, hash serialization, capability-driven
  nav, cross-navigation), tests.
- **Acceptance:** §9.6 (1-6).

### P1-G — Autocomplete application fix

- **Files:** `src/commands/completions.ts` (full-text values),
  `tests/unit/command-completions.test.ts` (intent), new
  `tests/unit/command-completion-application.test.ts` (boundary),
  `package.json` (devDependency, if required).
- **Acceptance:** §10.4 (1-4).

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
| Coverage | `tests/unit/history-reports.test.ts`, `tests/unit/index-report-command.test.ts` | 5/27 partial; all available; none available; sessions dir unreadable; discovery cap; `coverage`-absent report; unavailable sessions contribute no usage; Known vs Total wording |
| Range | `tests/unit/html-bundle.test.ts`, `tests/unit/bundle.test.ts` (+ new `tests/unit/report-range.test.ts`) | 7D vs 14D differ on every range-aware widget; inclusive UTC boundaries; custom validation failure keeps state; range outside data → empty state; scope change preserves range; truncation notice |
| Scope | `tests/unit/current-ui.test.ts`, `tests/unit/index-current-ui.test.ts` | linear Active==Tree with `sameProjection`; branched Active≠Tree; sibling exclusion; child usage never added; labels contain no descendant claim |
| Agents | `tests/unit/subagents.test.ts`, `tests/unit/html-bundle.test.ts` | activity calls ≠ run count; failed-run cost; partial child usage; parent resolution (in-scope / tree-only / unknown); role/model/thinking present only when validated; no raw task/output text |
| Errors | `tests/unit/error-ledger.test.ts`, `tests/unit/reduce.test.ts` | generation message preserved; tool error joined to tool (name/source/status); tool error without message → Unavailable; no tool-result leak |
| Tools | `tests/unit/html-bundle.test.ts` (+ new call rows) | summary aggregation; success/failure/interrupted; known vs unavailable usage; timeline timestamps; duration only with live evidence |
| Navigation | `tests/unit/html-navigation.test.ts` (new) | route parse/serialize round-trip; capability filtering; `sameProjection` note; hash carries no hostile text; per-table state isolation; unsupported tab coercion |
| Autocomplete | `tests/unit/command-completions.test.ts`, `tests/unit/command-completion-application.test.ts` | all §10.2 rows via the real provider; prior tokens preserved; options already present filtered; cursor mid-argument |
| Compatibility/privacy | `tests/unit/integration-privacy.test.ts`, `tests/unit/uat-evidence.test.ts` | old reports without new fields; no prompt/output/path/args/result text; new diagnostics bounded; determinism byte-identity |

Client-side routing and rendering are exercised through a DOM-free harness:
the generated document is parsed for its payload + capability table, and the
route functions are covered by extracting them into a small testable module
rather than by executing the browser script (no jsdom dependency — Ruling R11).

---

## 14. Manual UAT plan (after implementation)

1. `/session-inspector ui` → Current overview renders; coverage panel absent.
2. Switch to **Full session tree**; note appears only when the projections are
   identical.
3. Select a **Custom** range; confirm validation, inclusive boundaries, and that
   scope/tab/sidebar state is untouched.
4. Open **Agents**; confirm `Child runs` ≠ `Agent tool activity`.
5. Follow an Agent/model/parent reference; confirm range + scope survive.
6. Scroll: confirm the sidebar active item and tab match the content.
7. Open **Errors**; follow a Tool and an Agent reference.
8. Press Back/Forward; confirm content **and** active styling restore.
9. Reload the page (deep link); confirm the same state returns.
10. `/session-inspector json history` → open the file; confirm `coverage` and
    per-session `reason` values, and that usage only sums available sessions.
11. `/session-inspector ui` → History and Global: confirm `Known native cost` /
    `5 / 27 sessions` wording when partial, and that Global exposes Overview only.
12. Confirm no tab leads to a guaranteed-`Unavailable` page.
13. Type `/session-ins ui --theme d` + TAB: confirm `/session-ins ui --theme dark`
    (prior tokens preserved); repeat for each row of §10.2.
14. Open the generated HTML with networking disabled; confirm it renders fully
    with zero network requests (no CDN, no fonts, no fetch/XHR).
15. `/session-inspector tui` and `/session-inspector tui ledger`: confirm the TUI
    still renders both tabs and the scope switch.

---

## 15. Explicit unsupported-data list

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
| Global/History per-model, per-tool, per-agent breakdowns | **Unsupported** | The aggregate DTO carries usage and dates only; the tabs are not offered rather than shown full-period. |
| Inventory invocation counts for commands/prompts | **Unsupported** | No counter evidence exists; skills have counters, commands do not. |
| Live duration for historical sessions | **Unsupported** | Duration evidence is live-correlation only. |
| Integration version when the producer publishes none | **Unsupported** | Rendered `Unavailable`, never `0`. |
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
| R7 | Error → Agent linkage uses `AgentRun.toolCallId` (derived from `details.toolCallId`) | Only deterministic linkage; no timestamp guessing | One extra optional field in the agent DTO |
| R8 | Section capabilities are computed server-side from the data contract | Single source of truth; no hand-maintained client matrix | Capability list must be updated with DTO changes |
| R9 | Inventory is never range-filtered | It is environment state, not session activity | A user filtering by range still sees full inventory (labelled) |
| R10 | `model`/`thinking` are exposed as optional, producer-validated fields | Real evidence exists for the pinned producer; absent elsewhere | Fields appear only for 0.59.0-shaped payloads |
| R11 | No jsdom; route logic is extracted into a testable module | Avoids a heavy test dependency and flaky DOM emulation | Route tests cover logic, not pixel behavior (UAT covers that) |

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
