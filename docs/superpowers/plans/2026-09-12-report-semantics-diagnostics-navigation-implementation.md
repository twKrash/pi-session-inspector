# Report Semantics, Diagnostics & Navigation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Inspector report honest and navigable: coverage-qualified aggregates, one range-filtered projection across every tab, integrity-preserving browser DTOs, separated agent/tool/error semantics, an authoritative offline route, and token-correct command completion.

**Architecture:** All work is read-time derivation or projection over already-persisted evidence — no new persisted field, no collector, no schema migration. Server-side loaders (`src/ui/load-history.ts`, `src/ui/bundle.ts`) compute coverage, per-date rows and capabilities once; one canonical browser projection feeds every tab; pure modules (`src/ui/route.ts`, `src/ui/range.ts`) hold the client logic and are inlined into the single self-contained document via `Function.prototype.toString()` so the browser and the tests run the exact same code.

**Tech Stack:** TypeScript ESM on Node `>=22.19.0`, `node:test` + `tsx`, Biome, `@earendil-works/pi-coding-agent` 0.85.1 (extension API + `@earendil-works/pi-tui` autocomplete contract). No new runtime dependency; no network; no SQLite; no daemon.

**Spec:** `docs/superpowers/specs/2026-09-12-report-semantics-diagnostics-navigation-design.md`

## Global Constraints

- Pi JSONL is authority. Inspector never writes Pi session data (the tracking marker stays the only exception), never alters Pi execution, and swallows every hook/telemetry/storage error.
- Privacy: never persist, log, project, render, or hash prompts, assistant/user text, tool arguments, tool-result bodies (`content`/`details`), child `task`/`finalOutput`/`progressSummary`/`sessionName`/`sessionFile`/`transcriptPath`/`artifactPaths`, filesystem paths, URLs, or secrets. Allowed bounded metadata only, plus the existing `[REDACTED]`/`[PATH]`/`[URL]` markers.
- `unavailable != 0`. Missing, unsupported, truncated, or expired evidence renders `Unavailable`, never `0`, never `Total`, never a guess. Partial aggregates are `Known …`.
- Determinism: identical inputs produce byte-identical JSON and HTML. No machine-clock reads anywhere in report/bundle generation; all ordering is explicit and stable.
- Additive DTOs only: field names are append-only, `schemaVersion` stays `1`, older reports without the new optional fields must still render (with conservative wording).
- Bounded everything: reuse existing caps; new caps are `≤366` daily rows per view, `≤64` model rows per date, `≤366` `usageByDate` dates per session, `≤256` agent rows, `≤8` integration rows, and the existing `206` history-session cap. Capped output is flagged, never silently short.
- Attribution is by logical call (spec §5.7): tool identity/status/usage on `Tool.timestamp`; tool errors on `ErrorRecord.timestamp`; child runs on `AgentRun.observedAt`; compactions on their own entry timestamp. No start time, end time, or duration is ever inferred.
- Version `0.8.0 → 0.9.0` in Task 22. Every task ends with `npm run format:check && npm run lint && npm run typecheck && npm test` clean.
- Every commit message matches the repository convention (`feat:`, `fix:`, `test:`, `docs:`).

## Re-baseline (v2, against `main` @ `81f65b7`, v0.8.0)

`main` merged PR #1 ("evidence foundation", `910a665`): +19,411/−727 lines over
88 files, version 0.8.0. **Baseline: 588 tests pass, 0 failures.** The plan below
is amended for that pipeline; Appendix A of the spec (`§0`) is the authority for
the findings, and this section is the authority for task status.

### Task map

| Task | Status after re-baseline |
| --- | --- |
| 1 Bounded reasons + cap signal | **Execute** as written (anchors verified against current `src/storage/history.ts`) |
| 2 Coverage assembly | **Execute, retargeted**: `src/core/session-coverage.ts`, `SessionCoverage`, `buildSessionCoverage`; the five real `scanHistory` failure paths replace the plan's assumed two |
| 3 Coverage surfaces + wording | **Execute** as written (html.ts anchors updated) |
| 4 `AgentRun.observedAt` / `evidenceToolId` | **RETIRED — already on `main`.** Its cross-midnight fixture/regression moves into Tasks 5/9 |
| 5 Single dated projection | **Execute, retargeted**: `src/ui/dated-usage.ts` groups from `CanonicalUsageLine.attributedAt` and joins model rows by `ownerId`; the truncation flag also covers `evidenceHealth.usage.dated === "partial"` |
| 6 Daily rows + capability table | **Execute, retargeted**: `src/ui/daily.ts` folds the dated projection (no second bucketing) and `bundle.ts` adds the server-side capability table |
| 7 `sameReportProjection` + scope copy | **Execute** as written |
| 8 Pure range module | **Execute** as written |
| 9 One range filter for every tab | **Execute, retargeted**: replaces the span-overlap `inPeriod` membership rule; gains the cross-midnight fixture |
| 10 Agent model/thinking/failure | **RETIRED — already on `main`.** Replaced by a smaller task: the child-usage fraction (`runsWithUsage`/`runsTotal`) |
| 11 Canonical browser projection | **Execute, retargeted**: `sessionView`/`toolRows`/`agentRows` already exist and are the anchors |
| 12 Agents tab semantics | **Execute, retargeted**: `agentsPanel` anchor; the `metric.agentCalls` label is the defect |
| 13 Tools summary + calls | **Execute** as written |
| 14 Errors: joins + honest messages | **Execute, retargeted**: error rows are built in `src/ui/html.ts` (`sessionView`), not `src/ui/bundle.ts` |
| 15 Environment + integrations | **Execute** as written |
| 16 Pure route module | **Execute** as written |
| 17 Client routing | **Execute, retargeted**: `tests/unit/helpers/bundle.ts` does not exist and must be created in this task |
| 18 Cross-navigation links | **Execute** as written |
| 19 Span-aware completion | **Execute** as written |
| 20 Pi autocomplete boundary | **Execute, retargeted**: `@earendil-works/pi-tui@0.85.1` is already installed as a peerDependency — no `package.json` change, no dependency step |
| 21 Presentation polish | **Execute** as written |
| 22 ADR/spec/CHANGELOG/version | **Execute, retargeted**: ADR **0017**, version **0.9.0** |
| 23 Privacy corpus + final verification | **Execute** as written, plus the attribution-partial fixture case |

Execution order is numeric, skipping 4 and 10. Tasks 1-3, 5, 8, 16, 19 and 20 are
independent of the client script; Tasks 6-18 edit `src/ui/html.ts` sequentially and
must run in order.

### Facts the amended tasks rely on (verified at `81f65b7`)

- `loadHistoryReports` and `loadGlobalReport` **each** call `scanHistory`; there is
  no shared scan object (spec §0.2 item 5).
- `scanHistory` returns `unavailable` at five distinct points; the current code
  discards every cause in one `catch` (spec §0.2 item 6).
- `toSessionReport`/`projectAgent` already validate `agent`, `artifacts`,
  `observedAt`, `evidenceToolId`, `model`, `thinking` and `failure`; `readSubagentEvidence`
  already publishes them. `SubagentEvidence` has **no** `runsWithUsage`.
- `src/ui/bundle.ts` already has a private `dailyRows()` (one report, no
  composition) and `src/ui/html.ts` already has `buildDailyActivityRows()` (many
  reports); both bucket timestamps today and both become folds over the Task 5
  projection.
- `src/ui/html.ts` already has `currentViewProjection`, `sectionProjection`,
  `sessionView`, `toolRows`, `agentRows`, `buildDailyLedger`; `agentRows` drops
  `agent`/`artifacts`/`observedAt`/`model`/`thinking`/`failure`/`evidenceToolId`,
  `toolRows` drops `timestamp`, and the error rows carry no tool join.
- `tests/unit/helpers/` **does not exist**; the bundle fixture is read directly in
  `tests/unit/html-bundle.test.ts` from `tests/fixtures/bundles/inspector-bundle.json`.
- `@earendil-works/pi-tui@0.85.1` is installed under `node_modules` (peerDependency),
  with `CombinedAutocompleteProvider(commands, basePath, fdPath?)`,
  `getSuggestions(lines, cursorLine, cursorCol, { signal, force })` and
  `applyCompletion(lines, cursorLine, cursorCol, item, prefix)`.
- The next free ADR number is **0017**; the current version is **0.8.0**.

### Shared interfaces (defined by the task that introduces them; later tasks must use these exact names)

```ts
// Task 1: src/storage/history.ts
type CoverageReason =
  | "no-manifest"          // neither metadata nor pending manifest readable
  | "manifest-unavailable" // manifest present, source file missing/unresolvable
  | "marker-unavailable"   // source present but tracking-marker evidence failed
  | "session-unreadable"   // parse failure / malformed JSON / no header / id mismatch
  | "replay-failed";       // provider, builder or report projection failed for this session
type HistorySession = { sessionId: string; availability: "available" | "unavailable"; reason?: CoverageReason; sourceFile?: string };
type HistoryDiscoveryResult = { availability: "available" | "unavailable"; sessions: HistorySession[]; diagnostics: HistoryDiagnostic[]; discoveryLimited: boolean };

// Task 2: src/core/session-coverage.ts (named per spec R18 to stay distinct from
// the canonical model's `UsageCoverage`); `CoverageReason` comes from Task 1.
type SessionCoverage = {
  inspected: number;
  available: number;
  unavailable: number;
  sessionRatio: number | null;   // null when inspected === 0 or discoveryLimited
  complete: boolean;             // inspected > 0 && unavailable === 0 && !discoveryLimited && availability === "available"
  discoveryLimited: boolean;
  reasons: Readonly<Partial<Record<CoverageReason, number>>>;
};
function buildSessionCoverage(input: {
  availability: "available" | "unavailable";
  discoveryLimited: boolean;
  sessions: readonly { availability: "available" | "unavailable"; reason?: CoverageReason }[];
}): SessionCoverage | undefined;
/** Total reason→bounded-code mapping (spec §3.1.1, R20); asserted by a table test. */
const COVERAGE_REASON_CODES: Readonly<Record<CoverageReason, readonly string[]>>;

// Task 2: src/ui/load-history.ts (HistoryReport/GlobalReport gain `coverage?: SessionCoverage`)

// DONE ON MAIN (v0.8.0) — do not re-implement: `src/core/events.ts` already
// exports this exact AgentRun (with observedAt, evidenceToolId, model, thinking,
// failure), `src/integrations/subagents.ts` already fills every field from
// validated producer payloads, and `projectAgent` re-validates them.
type AgentRun = { id: string; parentId?: string; agent?: string; status: ...; confidence: Confidence;
  artifacts?: "available" | "missing"; observedAt?: string; evidenceToolId?: string;
  model?: string; thinking?: string; failure?: AgentFailure; usage?: Usage };

// Task 10 (retargeted): src/integrations/subagents.ts — only the usage fraction is new.
type SubagentEvidence = { activity: AgentToolActivity; runs: readonly AgentRun[]; state: EvidenceState;
  diagnostics: readonly SubagentEvidenceDiagnostic[];   // already on main
  runsWithUsage: number };                              // NEW
// and on the report DTO (src/core/reports.ts):
//   agentUsage: { runsTotal: number; runsWithUsage: number };

// Task 2/5: src/ui/load-history.ts
/** Deterministic source-read classification; the reason a session could not replay. */
function sourceReadFailure(parsed: { id?: unknown; hasMalformedJson?: unknown; hasSessionHeader?: unknown }, sessionId: string): CoverageReason | undefined;
/** Replay seam so a reducer/adapter failure is testable as `replay-failed`. */
type LoadHistoryOptions = { /* existing */ replay?: (entries: readonly SessionEntry[], sessionId: string) => SessionReport };
/**
 * Per-date evidence, grouped from the canonical builder's own attribution
 * (`CanonicalUsageLine.attributedAt`/`domain`/`bucket`) — never re-walked from
 * `SessionReport` timestamps (spec R19). It stays composition-complete so it
 * reconciles with `SessionReport.usage`, and `tools`/`errors` carry
 * observation-only membership counters even when they contribute no usage (§5.7).
 */
type DateUsageRow = {
  date: string; totalTokens: number; cost: number;
  generations: number; tools: number; errors: number;
  composition: { generations: SafeUsage; toolResults: SafeUsage; compactions: SafeUsage; branchSummaries: SafeUsage };
};
type HistoricalSession =
  | { availability: "available"; sessionId: string; report: SessionReport; usageByDate: readonly DateUsageRow[]; usageByDateTruncated: boolean }
  | { availability: "unavailable"; sessionId: string; reason?: CoverageReason };

// Task 5: src/ui/dated-usage.ts (new) — THE dated projection (spec §5.4/R19)
type SafeUsage = { totalTokens: number; cost: number };
type DatedModelRow = { date: string; provider: string; model: string; generations: number; totalTokens: number; cost: number };
function sessionDatedUsage(session: CanonicalSession): {
  dates: DateUsageRow[]; models: DatedModelRow[]; truncated: boolean; modelsTruncated: boolean };

// Task 6: src/ui/daily.ts (new) — folding only; src/ui/bundle.ts — capabilities
type DailyRow = { date: string; sessions: number; totalTokens: number; cost: number; generations: number; tools: number;
                  composition: { generations: SafeUsage; toolResults: SafeUsage; compactions: SafeUsage; branchSummaries: SafeUsage } };
function buildDailyRows(contributions: readonly { sessionId: string; rows: readonly DateUsageRow[]; truncated: boolean }[]):
  { rows: DailyRow[]; truncated: boolean };
type CurrentView = { availability: "available" | "unavailable"; diagnostic?: string; report?: SessionReport;
                     usageByDate?: readonly DateUsageRow[]; daily?: readonly DailyRow[]; dailyTruncated?: boolean;
                     datedModels?: readonly DatedModelRow[]; modelsTruncated?: boolean; capabilities: readonly Tab[] };
type InspectorBundle = { schemaVersion: 1; theme: "light" | "dark"; initialScope: Scope;
                         current: { active: CurrentView; tree: CurrentView; sameReportProjection: boolean };
                         history: HistoryReport; global: GlobalReport };
// src/ui/bundle.ts also exports the per-section capability table:
const CAPABILITIES: Readonly<Record<"current" | "history" | "global", readonly Tab[]>>;
// src/ui/load-current.ts attaches `sessionDatedUsage(session)` to CurrentTuiModel
// as `datedUsage`, so bundle.ts only copies and folds it.

// Task 7: src/ui/html.ts (server projection only)
function currentViewProjection(view: CurrentView, scope: Scope): Record<string, unknown>;

// Task 8: src/ui/range.ts (pure, inlined into the document)
type RangeState = { preset: 7 | 14 | 30 | null; from: string; to: string };
/** A range as written in a route or chosen in the UI: a preset stays unresolved until applied to a view's dates. */
type RangeIntent = { kind: "preset"; preset: 7 | 14 | 30 } | { kind: "custom"; from: string; to: string };
function resolveRange(intent: RangeIntent | undefined, dates: readonly string[], kind: "current" | "aggregate"): RangeState | undefined;
function isInRange(date: string, range: RangeState): boolean;
function presetRange(preset: 7 | 14 | 30, dates: readonly string[]): RangeState | undefined;
function shiftUtcDay(date: string, offset: number): string;
function latestObservedDate(dates: readonly string[]): string | undefined;
function parseRangeQuery(query: string): RangeIntent | undefined;
function serializeRangeQuery(intent: RangeIntent): [string, string][];
/** Membership + truncation verdict for one aggregate session row (§5.6). */
type HistoryRowRange = { member: boolean; totalTokens: number | null; cost: number | null; partial: boolean };
function historyRowRange(entry: { usageByDate: readonly DateUsageRow[]; usageByDateTruncated?: boolean }, range: RangeState): HistoryRowRange;

// Task 16: src/ui/route.ts (pure, inlined into the document)
type EntityRef = { kind: "model" | "tool" | "agent" | "error" | "integration" | "command" | "skill" | "resource"; id: string };
type InspectorRoute = { section: "current" | "history" | "global"; tab: string; session?: string; scope: Scope;
                        /** Absent = the view default (full span for current, 14D for aggregates). */
                        range?: RangeIntent; entity?: EntityRef; table?: { query?: string; sort?: string } };
function parseRoute(hash: string, defaults: { scope: Scope; capabilities: Readonly<Record<string, readonly string[]>>; knownIds?: ReadonlySet<string> }): { route: InspectorRoute; notice?: string };
function serializeRoute(route: InspectorRoute): string;
function routeKey(route: InspectorRoute): string;
function deriveView(route: InspectorRoute, capabilities: Readonly<Record<string, readonly string[]>>, dates: readonly string[]):
  { activeSection: string; activeTab: string; visibleTabs: readonly string[]; scope: Scope; range?: RangeState; entity?: EntityRef; notice?: string; focusTarget: string };

// Task 19: src/commands/grammar.ts
type RawToken = { raw: string; start: number; end: number; quoted: boolean };
function scanInspectorArgs(prefix: string): { tokens: RawToken[]; trailingWhitespace: boolean } | undefined;
function tokenizeInspectorArgs(prefix: string): { tokens: string[]; trailingWhitespace: boolean } | undefined; // existing, now derived from scanInspectorArgs
```

---

### Task 1: Bounded per-session coverage reasons and the discovery-cap signal

**Files:**

- Modify: `src/storage/history.ts`
- Test: `tests/unit/history-discovery.test.ts` (new)

**Interfaces:**

- Consumes: existing `discoverHistory`, `resolveManifestSourceFile`, `parseTrackingMetadata`.
- Produces: `CoverageReason`, extended `HistorySession`, `HistoryDiscoveryResult.discoveryLimited` (see Shared interfaces).

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/history-discovery.test.ts
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { discoverHistory } from "../../src/storage/history.ts";

const maintenance = { writerId: "maintainer-1", now: () => new Date("2026-09-01T00:00:00.000Z"), isPidAlive: () => true };

async function root(): Promise<string> {
  return mkdtemp(join(tmpdir(), "inspector-discovery-"));
}

test("reports a bounded reason per unavailable session", async () => {
  const inspectorRoot = await root();
  await mkdir(join(inspectorRoot, "sessions", "11111111-1111-4111-8111-111111111111"), { recursive: true });
  const result = await discoverHistory({
    root: inspectorRoot,
    sessionDirectory: () => join(inspectorRoot, "pi-sessions"),
    markerEvidence: async () => true,
    maintenance,
  });
  assert.equal(result.availability, "available");
  assert.equal(result.sessions.length, 1);
  assert.equal(result.sessions[0]?.availability, "unavailable");
  assert.equal(result.sessions[0]?.reason, "no-manifest");
  assert.equal(result.discoveryLimited, false);
});

test("flags discovery as limited when the session cap is reached", async () => {
  const inspectorRoot = await root();
  const sessionsDirectory = join(inspectorRoot, "sessions");
  await mkdir(sessionsDirectory, { recursive: true });
  for (let index = 0; index < 207; index += 1) {
    await mkdir(join(sessionsDirectory, `1111111${String(index).padStart(2, "0")}-1111-4111-8111-111111111111`), { recursive: true });
    await writeFile(join(sessionsDirectory, `1111111${String(index).padStart(2, "0")}-1111-4111-8111-111111111111`, "tracking.json"), "{}");
  }
  const result = await discoverHistory({
    root: inspectorRoot,
    sessionDirectory: () => join(inspectorRoot, "pi-sessions"),
    markerEvidence: async () => true,
    maintenance,
  });
  assert.equal(result.discoveryLimited, true);
  assert.equal(result.sessions.length, 206);
  assert.ok(result.diagnostics.includes("history-limit-reached"));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --import tsx --test tests/unit/history-discovery.test.ts`
Expected: FAIL — `result.sessions[0].reason` is `undefined` and `result.discoveryLimited` is `undefined`.

- [ ] **Step 3: Implement the reason plumbing**

In `src/storage/history.ts`, replace the bare `availability: "unavailable"` returns with reasoned ones and export the new types:

```ts
export type CoverageReason =
  | "no-manifest"
  | "manifest-unavailable"
  | "marker-unavailable"
  | "session-unreadable"
  | "replay-failed";

export type HistorySession = {
  sessionId: string;
  availability: "available" | "unavailable";
  reason?: CoverageReason;
  sourceFile?: string;
};

export type HistoryDiscoveryResult = {
  availability: "available" | "unavailable";
  sessions: HistorySession[];
  diagnostics: HistoryDiagnostic[];
  discoveryLimited: boolean;
};
```

Change the three cause-discarding sites (keep every existing check and diagnostic exactly as it is, only stop throwing the cause away):

```ts
// in inspectManifest, when neither metadata nor pending metadata is readable
  if (pending === undefined) {
    diagnostics.add("manifest-unavailable");
    return { availability: "unavailable", reason: "no-manifest" };
  }
// inside the lease, when the pending manifest vanished before promotion
    if (currentPending === undefined) {
      diagnostics.add("manifest-unavailable");
      return { availability: "unavailable", reason: "no-manifest" };
    }
// in availableManifest
  if (!(await hasAvailableSource(metadata, sessionDirectory, diagnostics))) {
    return { availability: "unavailable", reason: "manifest-unavailable" };
  }
  if (!(await hasMarkerEvidence(sessionId, metadata.sourceFile, markerEvidence, diagnostics))) {
    return { availability: "unavailable", reason: "marker-unavailable" };
  }
```

`hasMarkerEvidence` records `marker-unavailable` when the probe throws; keep that behaviour and keep returning the same reason. Then propagate the flag and the reason:

```ts
  if (sessionIds.length > MAX_HISTORY_SESSIONS) {
    diagnostics.add("history-limit-reached");
    sessionIds.length = MAX_HISTORY_SESSIONS;
    discoveryLimited = true;
  }
  // ...
  return { availability: "available", sessions, diagnostics: [...diagnostics].sort(), discoveryLimited };
```

and in the early return for an unreadable sessions directory: `return { availability: "unavailable", sessions: [], diagnostics: ["history-unavailable"], discoveryLimited: false };`

- [ ] **Step 4: Copy the reason onto the returned row**

The non-enumerable `sourceFile` define stays; add the reason next to it:

```ts
    const row: HistorySession = {
      sessionId,
      availability: inspected.availability,
      ...(inspected.reason === undefined ? {} : { reason: inspected.reason }),
    };
```

- [ ] **Step 5: Run the tests and commit**

Run: `node --import tsx --test tests/unit/history-discovery.test.ts && npm run typecheck`
Expected: PASS; typecheck clean (callers that only read `availability` are unaffected).

```bash
git add src/storage/history.ts tests/unit/history-discovery.test.ts
git commit -m "feat: report bounded per-session coverage reasons and the discovery cap"
```

---

### Task 2: `SessionCoverage` assembly shared by history and global

**Files:**

- Create: `src/core/session-coverage.ts`
- Modify: `src/ui/load-history.ts`
- Test: `tests/unit/session-coverage.test.ts` (new), `tests/unit/history-reports.test.ts`

**Interfaces:**

- Consumes: `CoverageReason` (Task 1).
- Produces: `SessionCoverage`, `buildSessionCoverage`, `COVERAGE_REASON_CODES`,
  `HistoryReport.coverage`, `GlobalReport.coverage` (named per spec R18).

> **Retargeted for v0.8.0.** This task touches `scanHistory`, which on `main`
> already routes every session through `buildCanonicalSession` and an injected
> evidence provider. The five failure paths the loader must label are listed in
> the spec (§0.2 item 6). Nothing else in the task changed.

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/session-coverage.test.ts
import assert from "node:assert/strict";
import { test } from "node:test";
import { COVERAGE_REASON_CODES, buildSessionCoverage } from "../../src/core/session-coverage.ts";

const available = { availability: "available" as const };

test("partial sets are not complete and expose a session ratio", () => {
  const coverage = buildSessionCoverage({
    availability: "available",
    discoveryLimited: false,
    sessions: [available, { availability: "unavailable", reason: "manifest-unavailable" }],
  });
  assert.deepEqual(coverage, {
    inspected: 2, available: 1, unavailable: 1, sessionRatio: 0.5, complete: false,
    discoveryLimited: false, reasons: { "manifest-unavailable": 1 },
  });
});

test("a capped discovery hides the ratio and is never complete", () => {
  const coverage = buildSessionCoverage({ availability: "available", discoveryLimited: true, sessions: [available] });
  assert.equal(coverage?.sessionRatio, null);
  assert.equal(coverage?.complete, false);
  assert.equal(coverage?.discoveryLimited, true);
});

test("an empty inspection set is not complete and has no ratio", () => {
  const coverage = buildSessionCoverage({ availability: "available", discoveryLimited: false, sessions: [] });
  assert.equal(coverage?.inspected, 0);
  assert.equal(coverage?.sessionRatio, null);
  assert.equal(coverage?.complete, false);
  assert.deepEqual(coverage?.reasons, {});
});

test("an unavailable aggregate has no coverage at all", () => {
  assert.equal(buildSessionCoverage({ availability: "unavailable", discoveryLimited: false, sessions: [] }), undefined);
});

test("a fully replayed uncapped set is complete", () => {
  const coverage = buildSessionCoverage({ availability: "available", discoveryLimited: false, sessions: [available, available] });
  assert.equal(coverage?.complete, true);
  assert.equal(coverage?.sessionRatio, 1);
});

// Spec §3.1.1 / R20: a reason cannot exist without naming the bounded code it
// projects, so no third vocabulary can appear.
test("every reason maps onto an existing bounded code", () => {
  const reasons = [
    "no-manifest", "manifest-unavailable", "marker-unavailable", "session-unreadable", "replay-failed",
  ] as const satisfies readonly CoverageReason[];
  for (const reason of reasons) {
    const codes = COVERAGE_REASON_CODES[reason];
    assert.ok(codes.length > 0, reason);
    for (const code of codes) {
      assert.ok(
        [...HISTORY_DIAGNOSTICS, ...EVIDENCE_DIAGNOSTIC_CODES].includes(code),
        `${reason} -> ${code}`,
      );
    }
  }
  assert.deepEqual(Object.keys(COVERAGE_REASON_CODES).sort(), [...reasons].sort());
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --import tsx --test tests/unit/session-coverage.test.ts`
Expected: FAIL — cannot resolve `../../src/core/session-coverage.ts`.

- [ ] **Step 3: Implement the builder**

```ts
// src/core/session-coverage.ts
import {
  type EvidenceDiagnosticCode,
} from "./evidence-health.ts";
import type { CoverageReason } from "../storage/history.ts";

export type { CoverageReason };

/**
 * Total projection of the runnability vocabulary onto bounded codes that already
 * exist (spec §3.1.1, R20): a reason is never a new string, only a view of a
 * `HistoryDiagnostic` or an `EvidenceDiagnosticCode`.
 */
export const COVERAGE_REASON_CODES: Readonly<
  Record<CoverageReason, readonly (HistoryDiagnostic | EvidenceDiagnosticCode)[]>
> = {
  "no-manifest": ["manifest-unavailable"],
  "manifest-unavailable": ["manifest-unavailable", "source-not-found"],
  "marker-unavailable": ["marker-unavailable", "tracking-marker-missing"],
  "session-unreadable": ["source-malformed", "source-format-unsupported"],
  "replay-failed": ["source-format-unsupported", "cooperative-evidence-conflict"],
};

export type SessionCoverage = {
  inspected: number;
  available: number;
  unavailable: number;
  sessionRatio: number | null;
  complete: boolean;
  discoveryLimited: boolean;
  reasons: Readonly<Partial<Record<CoverageReason, number>>>;
};

/**
 * Session coverage, never usage coverage. The ratio is withheld (null) whenever
 * the denominator is unknown (empty inspection set) or unknowable (capped
 * discovery), and an empty inspection set is never complete.
 */
export function buildSessionCoverage(input: {
  availability: "available" | "unavailable";
  discoveryLimited: boolean;
  sessions: readonly { availability: "available" | "unavailable"; reason?: CoverageReason }[];
}): SessionCoverage | undefined {
  if (input.availability !== "available") return undefined;
  const inspected = input.sessions.length;
  const available = input.sessions.filter((session) => session.availability === "available").length;
  const unavailable = inspected - available;
  const reasons: Partial<Record<CoverageReason, number>> = {};
  for (const session of input.sessions) {
    if (session.reason === undefined) continue;
    reasons[session.reason] = (reasons[session.reason] ?? 0) + 1;
  }
  return {
    inspected,
    available,
    unavailable,
    sessionRatio:
      inspected === 0 || input.discoveryLimited ? null : Number((available / inspected).toFixed(4)),
    complete:
      inspected > 0 &&
      unavailable === 0 &&
      !input.discoveryLimited &&
      input.availability === "available",
    discoveryLimited: input.discoveryLimited,
    reasons,
  };
}
```

Wire it in `src/ui/load-history.ts`. The scan result carries the reason, the cap
signal and the coverage; both reports spread them from the same object:

```ts
type SessionScan =
  | { availability: "available"; sessionId: string; report: SessionReport;
      usageByDate: readonly DateUsageRow[]; usageByDateTruncated: boolean }
  | { availability: "unavailable"; sessionId: string; reason: CoverageReason };

type HistoryScan = {
  availability: "available" | "unavailable";
  sessions: SessionScan[];
  diagnostics: HistoryDiagnostic[];
  discoveryLimited: boolean;
  coverage: SessionCoverage | undefined;
};
```

`scanHistory` is the single place that names a reason. Every existing check keeps
its behaviour; only the discarded cause is now recorded. This is the whole diff
(comments mark the five spec paths):

```ts
async function scanHistory(options: LoadHistoryOptions): Promise<HistoryScan> {
  if (options.scope !== "tree") {
    return { availability: "unavailable", sessions: [], diagnostics: [], discoveryLimited: false, coverage: undefined };
  }
  const discovery = await discoverHistory({
    ...options,
    markerEvidence: async (sessionId, sourceFile) => {
      const source = await resolveManifestSourceFile({ sourceFile, sessionDirectory: options.sessionDirectory() });
      if (source === undefined) return false;
      const parsed = parseSessionJsonl(await readFile(source, "utf8"));
      return parsed.id === sessionId && !parsed.hasMalformedJson && parsed.hasSessionHeader && hasTrackingStartMarker(parsed.entries);
    },
  });
  const sessions = await Promise.all(
    discovery.sessions.map(async ({ sessionId, availability, sourceFile, reason }): Promise<SessionScan> => {
      // Discovery already named the cause for a manifest it could not promote.
      if (availability !== "available" || sourceFile === undefined) {
        return { availability: "unavailable", sessionId, reason: reason ?? "manifest-unavailable" };
      }
      let parsed: ReturnType<typeof parseSessionJsonl>;
      let source: string | undefined;
      try {
        source = await resolveManifestSourceFile({ sourceFile, sessionDirectory: options.sessionDirectory() });
        if (source === undefined) return { availability: "unavailable", sessionId, reason: "manifest-unavailable" };
        parsed = parseSessionJsonl(await readFile(source, "utf8"));
      } catch {
        // Path (a): the source could not be resolved or parsed.
        return { availability: "unavailable", sessionId, reason: "session-unreadable" };
      }
      const unreadable = sourceReadFailure(parsed, sessionId);
      if (unreadable !== undefined) return { availability: "unavailable", sessionId, reason: unreadable };
      if (!hasTrackingStartMarker(parsed.entries)) {
        // Path (b): discovery proved the marker once; a re-check failure keeps its own reason.
        return { availability: "unavailable", sessionId, reason: "marker-unavailable" };
      }
      // Path (c): the injected provider is the only durable-read path; a throw or
      // an absent result makes this session unavailable, never zero-filled.
      let supplied: HistorySessionEvidence | undefined;
      try {
        supplied = options.sessionEvidence === undefined
          ? undefined
          : await options.sessionEvidence({ sessionId, root: options.root, directory: join(options.root, "sessions", sessionId), entries: parsed.entries });
      } catch {
        return { availability: "unavailable", sessionId, reason: "replay-failed" };
      }
      if (options.sessionEvidence !== undefined && supplied === undefined) {
        return { availability: "unavailable", sessionId, reason: "replay-failed" };
      }
      const observation = supplied?.observation;
      const buildInput = { /* unchanged */ ... };
      const resolved = buildCanonicalSession(buildInput);
      // Path (d): the builder is the availability authority; a session it cannot
      // resolve never becomes a report.
      if (resolved.state !== "ready") return { availability: "unavailable", sessionId, reason: "replay-failed" };
      const byId = new Map<string, SessionEntry>();
      for (const entry of parsed.entries) if (!byId.has(entry.id)) byId.set(entry.id, entry);
      const entries = resolved.session.scopedEntryIds.flatMap((id) => {
        const entry = byId.get(id);
        return entry === undefined ? [] : [entry];
      });
      const subagentEvidence = supplied?.subagents ?? readSubagentEvidence(entries, sessionId);
      const built = buildCanonicalSession({ ...buildInput, subagents: subagentEvidence });
      if (built.state !== "ready") return { availability: "unavailable", sessionId, reason: "replay-failed" };
      const session = built.session;
      const sealed = Object.values(session.retainedAggregates.boundary.sealedThrough).some((cursor) => cursor > 0);
      // Path (e): the source and the canonical session are fine; a failure here is
      // in replay/adapters and is reported as such. The seam is test-only.
      let report: SessionReport;
      try {
        report = (options.replay ?? defaultReplay)({ session, entries, observation, subagentEvidence, sealed });
      } catch {
        return { availability: "unavailable", sessionId, reason: "replay-failed" };
      }
      const dated = sessionDatedUsage(session);
      return { availability: "available", sessionId, report, usageByDate: dated.rows, usageByDateTruncated: dated.truncated };
    }),
  );
  return {
    availability: discovery.availability,
    sessions,
    diagnostics: discovery.diagnostics,
    discoveryLimited: discovery.discoveryLimited,
    coverage: buildSessionCoverage({
      availability: discovery.availability,
      discoveryLimited: discovery.discoveryLimited,
      sessions,
    }),
  };
}

/** Production replay: exactly the projection this loader performed inline before. */
function defaultReplay(input: HistoryReplayInput): SessionReport {
  const { session, entries, observation, subagentEvidence, sealed } = input;
  return toSessionReport(reduceEntries(session.sessionId, entries), {
    ...(sealed ? { walDetail: "expired" as const } : {}),
    agents: { state: subagentEvidence.state, runs: subagentEvidence.runs },
    agentActivity: subagentEvidence.activity,
    presence: observation?.presence,
    ...countersFrom(session),
    ...usageFrom(session),
    ...resourceCountsFrom(session),
    ...(observation?.inventory === undefined ? {} : { inventory: observation.inventory }),
    integrations: readPiEntryEvidence(entries),
    evidenceHealth: session.health,
    retainedAggregates: session.retainedAggregates,
  });
}
```

and spread it into both reports:

```ts
export async function loadHistoryReports(options: LoadHistoryOptions): Promise<HistoryReport> {
  const scan = await scanHistory(options);
  return {
    availability: scan.availability,
    sessions: scan.sessions.map(toHistoricalSession),
    diagnostics: scan.diagnostics,
    ...(scan.coverage === undefined ? {} : { coverage: scan.coverage }),
  };
}
// loadGlobalReport builds the same object from the same scan and adds the same `coverage` key.
```

Produce **every** declared reason on a real path. Discovery produces `no-manifest`,
`manifest-unavailable` and `marker-unavailable`; the scan produces
`session-unreadable` (parse/header/id), `marker-unavailable` (re-check) and
`replay-failed` (paths c-e). The replay step is injectable so a failure after
readability is testable; keep `LoadHistoryOptions` extensible rather than adding a
second options type:

```ts
type HistoryReplayInput = {
  session: CanonicalSession;
  entries: readonly SessionEntry[];
  observation: SessionObservation | undefined;
  subagentEvidence: SubagentEvidence;
  sealed: boolean;
};

type LoadHistoryOptions = {
  root: string;
  sessionDirectory(): string;
  scope: Scope;
  activeLeafId?: (sessionId: string) => string | null;
  maintenance: MaintenanceOptions;
  sessionEvidence?: SessionEvidenceProvider;
  /** Test seam only; production uses `defaultReplay`. */
  replay?: (input: HistoryReplayInput) => SessionReport;
};

/** Deterministic source-read validation: every failure it can name maps to ONE reason. */
export function sourceReadFailure(
  parsed: { id?: unknown; hasMalformedJson?: unknown; hasSessionHeader?: unknown },
  sessionId: string,
): CoverageReason | undefined {
  if (parsed.hasMalformedJson === true) return "session-unreadable";
  if (parsed.hasSessionHeader !== true) return "session-unreadable";
  if (parsed.id !== sessionId) return "session-unreadable";
  return undefined;
}
```

Add the optional field to both DTOs:

```ts
export type HistoryReport = { availability: "available" | "unavailable"; sessions: HistoricalSession[]; diagnostics: HistoryDiagnostic[]; coverage?: SessionCoverage };
export type GlobalReport = { /* existing */ coverage?: SessionCoverage };
```

- [ ] **Step 4: Assert the wiring end to end**

Append to `tests/unit/history-reports.test.ts` (existing helpers build a temp root with manifests):

```ts
test("history and global report the same coverage from one scan input", async () => {
  // fixture: 2 manifests, one with a resolvable source + marker (available), one without source (unavailable)
  const history = await loadHistoryReports(options);
  const global = await loadGlobalReport(options);
  assert.equal(history.coverage?.inspected, 2);
  assert.equal(history.coverage?.available, 1);
  assert.equal(history.coverage?.complete, false);
  assert.deepEqual(history.coverage, global.coverage);
  assert.deepEqual(history.coverage?.reasons, { "manifest-unavailable": 1 });
});

test("every declared coverage reason is produced by a real path", async () => {
  const cases: [string, string, CoverageReason][] = [
    ["malformed JSON", "{not json\n", "session-unreadable"],
    ["missing session header", '{"id":"22222222-2222-4222-8222-222222222222"}\n', "session-unreadable"],
    ["session id mismatch", headerFor("99999999-9999-4999-8999-999999999999"), "session-unreadable"],
  ];
  for (const [label, source, reason] of cases) {
    const history = await loadHistoryReports(await optionsWithSource(source));
    assert.equal(history.coverage?.reasons[reason], 1, label);
    assert.equal(history.coverage?.unavailable, 1, label);
  }
  // Path (e): the source and the canonical session are fine; the report projection throws.
  const failing = await loadHistoryReports({
    ...(await optionsWithSource(validSource())),
    replay: () => {
      throw new Error("reducer exploded");
    },
  });
  assert.equal(failing.coverage?.reasons["replay-failed"], 1);
  assert.equal(failing.coverage?.available, 0);
});

test("a marker re-check failure keeps its own reason, not replay-failed", async () => {
  // The provider seam is present and succeeds, but the marker was removed after
  // discovery: `hasTrackingStartMarker` already returned false, so the reason is
  // `marker-unavailable` — never a generic failure.
  const history = await loadHistoryReports(await optionsWithUnmarkedSource());
  assert.equal(history.coverage?.reasons["marker-unavailable"], 1);
});
```

- [ ] **Step 5: Run the tests and commit**

Run: `node --import tsx --test tests/unit/session-coverage.test.ts tests/unit/history-reports.test.ts && npm test`
Expected: PASS (all suites).

```bash
git add src/core/session-coverage.ts src/ui/load-history.ts tests/unit/session-coverage.test.ts tests/unit/history-reports.test.ts
git commit -m "feat: assemble shared session coverage for history and global"
```

---

### Task 3: Coverage surfaces and the completeness wording contract

**Files:**

- Modify: `src/ui/html.ts` — `ENGLISH_CATALOG` (line ~7), the new
  `aggregateUsageLabels` helper next to `sectionProjection` (~line 588), the
  `historyEntry`/`projectReport` projections (~line 1186/1219), and the client's
  `historyOverview`/`globalOverview` + a new `coveragePanel()` (~line 1347+)
- Modify: `src/ui/load-history.ts` (the history entry projection keeps `coverage`
  only on the aggregate views)
- Test: `tests/unit/html-bundle.test.ts`, `tests/unit/html.test.ts`

**Interfaces:**

- Consumes: `SessionCoverage` (Task 2).
- Produces: i18n keys `coverage.title`, `coverage.sessions`, `coverage.sessionsLimited`, `coverage.none`, `coverage.unknown`, `coverage.unknownCompletenessCost`, `coverage.unknownCompletenessTokens`, `coverage.reasons`, `metric.knownCost`, `metric.knownTokens`, `metric.costUnavailable`; projection keys `coverage`, `usageLabels` on history/global sections; exported `aggregateUsageLabels`.

> **Retargeted for v0.8.0.** The tests below use the existing fixture helpers
> (`bundleFixture()` + `embeddedJson()` in `tests/unit/html-bundle.test.ts`,
> `renderHtml` + `embedded()` in `tests/unit/html.test.ts`). Do not invent new
> fixture builders; mutate the fixture bundle's `history`/`global` objects. The
> global section already renders `trackedSessions`/`unavailableSessions`
> (`projectReport`, ~line 1262): those counts and the new coverage line must be
> **one** statement — feed the coverage line from them and remove the duplicate
> metric, never render two partial-count vocabularies on one page (spec §3.3).

- [ ] **Step 1: Write the failing test**

```ts
// append to tests/unit/html-bundle.test.ts
import type { SessionCoverage } from "../../src/core/session-coverage.ts";

function withAggregateCoverage(coverage: SessionCoverage | undefined): InspectorBundle {
  const bundle = bundleFixture();
  for (const section of [bundle.history, bundle.global] as Record<string, unknown>[]) {
    if (coverage === undefined) delete section.coverage;
    else section.coverage = coverage;
  }
  return bundle;
}

test("aggregate sections render coverage wording and never a partial total", () => {
  const html = renderInspectorBundle(
    withAggregateCoverage({
      inspected: 27, available: 5, unavailable: 22, sessionRatio: 0.1852,
      complete: false, discoveryLimited: false, reasons: { "manifest-unavailable": 22 },
    }),
  );
  assert.match(html, /Known native cost/);
  assert.match(html, /Known tokens/);
  assert.match(html, /5 \/ 27 sessions · 22 unavailable/);
  assert.equal(/"cost":"metric\.cost"/.test(html), false);
});

test("known usage with unknown coverage shows the value; unavailable usage does not", () => {
  const html = renderInspectorBundle(withAggregateCoverage(undefined));
  assert.match(html, /Known native cost — completeness unknown/);
  assert.match(html, /"cost":"coverage\.unknownCompletenessCost"/);
  assert.equal(/"cost":"metric\.costUnavailable"/.test(html), false);
});

test("the label resolver separates value availability from coverage availability", () => {
  assert.deepEqual(aggregateUsageLabels({ availability: "available", coverage: undefined }), {
    cost: "coverage.unknownCompletenessCost",
    tokens: "coverage.unknownCompletenessTokens",
    usageUnavailable: false,
    sessions: "coverage.unknown",
  });
  assert.equal(aggregateUsageLabels({ availability: "unavailable", coverage: undefined }).usageUnavailable, true);
  const empty = aggregateUsageLabels({
    availability: "available",
    coverage: { inspected: 0, available: 0, unavailable: 0, sessionRatio: null, complete: false, discoveryLimited: false, reasons: {} },
  });
  assert.equal(empty.usageUnavailable, true);
  assert.equal(empty.sessions, "coverage.none");
});

test("a capped discovery shows counts instead of a ratio", () => {
  const html = renderInspectorBundle(
    withAggregateCoverage({
      inspected: 206, available: 206, unavailable: 0, sessionRatio: null,
      complete: false, discoveryLimited: true, reasons: {},
    }),
  );
  assert.match(html, /206 sessions inspected · additional sessions not inspected/);
  assert.equal(/206 \/ 206 sessions/.test(html), false);
  assert.equal(/100%/.test(html), false);
});

test("an empty inspection set is unavailable, never zero", () => {
  const html = renderInspectorBundle(
    withAggregateCoverage({
      inspected: 0, available: 0, unavailable: 0, sessionRatio: null,
      complete: false, discoveryLimited: false, reasons: {},
    }),
  );
  assert.match(html, /No tracked sessions/);
  assert.equal(/\$0\.00/.test(html), false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --import tsx --test tests/unit/html-bundle.test.ts`
Expected: FAIL — no coverage copy exists in the document.

- [ ] **Step 3: Add the catalog entries and the label resolver**

```ts
// src/ui/html.ts, ENGLISH_CATALOG additions
  "coverage.title": "Coverage",
  "coverage.sessions": "{available} / {inspected} sessions · {unavailable} unavailable",
  "coverage.sessionsLimited": "{inspected} sessions inspected · additional sessions not inspected",
  "coverage.none": "No tracked sessions",
  "coverage.unknown": "Sessions: Unavailable",
  "coverage.reasons": "Reasons: {reasons}",
  "coverage.completenessUnknown": "Native cost — completeness unknown",
  "coverage.unknownCompletenessCost": "Known native cost — completeness unknown",
  "coverage.unknownCompletenessTokens": "Known tokens — completeness unknown",
  "metric.knownCost": "Known native cost",
  "metric.knownTokens": "Known tokens",
  "metric.costUnavailable": "Unavailable",
```

```ts
// src/ui/html.ts, server side
/** Bounded label keys for an aggregate's cost/token metrics. */
/**
 * Aggregate value availability is INDEPENDENT of coverage availability:
 * a legacy report with usage but no `coverage` key shows its observed value and
 * is qualified as completeness-unknown, while `Unavailable` is reserved for a
 * genuinely unavailable usage value (or an empty inspection set).
 */
export function aggregateUsageLabels(input: {
  availability: "available" | "unavailable";
  coverage: SessionCoverage | undefined;
}): { cost: string; tokens: string; usageUnavailable: boolean; sessions: string } {
  if (input.availability !== "available") {
    return { cost: "metric.costUnavailable", tokens: "metric.costUnavailable", usageUnavailable: true, sessions: "coverage.unknown" };
  }
  const coverage = input.coverage;
  if (coverage === undefined) {
    return { cost: "coverage.unknownCompletenessCost", tokens: "coverage.unknownCompletenessTokens", usageUnavailable: false, sessions: "coverage.unknown" };
  }
  if (coverage.inspected === 0) {
    return { cost: "metric.costUnavailable", tokens: "metric.costUnavailable", usageUnavailable: true, sessions: "coverage.none" };
  }
  if (coverage.complete) {
    return { cost: "metric.cost", tokens: "metric.tokens", usageUnavailable: false, sessions: "coverage.complete" };
  }
  return {
    cost: "metric.knownCost",
    tokens: "metric.knownTokens",
    usageUnavailable: coverage.available === 0,
    sessions: coverage.discoveryLimited ? "coverage.sessionsLimited" : "coverage.sessions",
  };
}
```

(Note: `coverage.complete` needs the session-line key `coverage.complete` in the
catalog too: `"{available} / {inspected} sessions"`.)

Project it into both aggregate sections (single place — `sectionProjection`) and into the client panel:

```ts
// sectionProjection gains, for history and global:
  coverage: report.coverage === undefined ? null : {
    ...report.coverage,
    reasons: Object.entries(report.coverage.reasons).map(([reason, count]) => `${reason}: ${count}`).join(" · "),
  },
  // The metric labels come from availability + coverage, never from coverage alone.
  usageLabels: aggregateUsageLabels({ availability: report.availability, coverage: report.coverage }),
```

```js
// client: one panel renderer used by historyOverview and globalOverview
function coveragePanel(section){
  var coverage=section.coverage;
  if(!coverage)return el("div","notice",tr("coverage.unknown"));
  var lines=[];
  if(coverage.inspected===0)lines.push(tr("coverage.none"));
  else if(coverage.discoveryLimited)lines.push(tr("coverage.sessionsLimited",{inspected:coverage.inspected}));
  else lines.push(tr("coverage.sessions",{available:coverage.available,inspected:coverage.inspected,unavailable:coverage.unavailable}));
  if(coverage.reasons)lines.push(tr("coverage.reasons",{reasons:coverage.reasons}));
  var box=el("div","notice coverage");box.append(el("strong","",tr("coverage.title")),el("div","",lines.join(" · ")));
  return box;
}
// metric values: never replaced by the string "Unavailable" unless
// section.usageLabels.usageUnavailable is true; otherwise show the number with the label.
```

Use the labels for every aggregate metric (cost, tokens) so an incomplete report can never print `Total`/`Native cost` unqualified, and never render `$0.00` when `usageUnavailable` is true.

- [ ] **Step 4: Keep the qualifier out of the session detail**

`historyEntry()` closes over `sessionView(session.report)`; attach coverage data only to the aggregate projections (`historyOverview`, `globalOverview`) and extend the existing regression in `tests/unit/html.test.ts` (which already has `renderHtml` + `embedded()` + `historyReport()`):

```ts
test("a selected history session carries no coverage panel", () => {
  const html = renderHtml(historyReport());
  const document = embedded(html) as { history: { coverage?: unknown; sessions: { view?: { coverage?: unknown } }[] } };
  const entry = document.history.sessions[0];
  assert.equal(entry?.view?.coverage, undefined);
  assert.equal("coverage" in (entry?.view ?? {}), false);
});
```

- [ ] **Step 5: Run the tests and commit**

Run: `node --import tsx --test tests/unit/html-bundle.test.ts tests/unit/html.test.ts && npm test`
Expected: PASS.

```bash
git add src/ui/html.ts tests/unit/html-bundle.test.ts tests/unit/html.test.ts
git commit -m "feat: render coverage wording for aggregate sections only"
```

---

### Task 4: RETIRED — `AgentRun.observedAt` / `evidenceToolId` (already on `main`)

> **RETIRED — do not execute any step below as an implementation task.**
> `910a665` already ships everything this task asked for:
>
> - `src/core/events.ts` declares `observedAt`, `evidenceToolId`, `model`,
>   `thinking`, `failure` on `AgentRun`.
> - `src/integrations/subagents.ts` fills them (`JoinedResult`,
>   `publicationOf`, `readObservedAt`, `TOOL_CALL_ID`, `mergeRunObservation`,
>   `readAgentFailure`, `isProcessSignal`, `isAgentLabel`) and already refuses to
>   publish a run whose result cannot be joined.
> - `src/core/reports.ts` re-validates every field in `projectAgent`.
> - `src/ui/load-current.ts` / `src/ui/load-history.ts` feed the same evidence to
>   the canonical builder and the report DTO.
>
> **What is still worth taking from this task:** the three `subagents.test.ts`
> tests in Step 1 (join shape, unjoinable result, call without result) are the
> regression that keeps the absorbed behaviour honest — move them into Task 10's
> test file if they are not already covered there, and run them once against
> `main` before touching anything. The `cross-midnight.jsonl` fixture from Step 4
> moves to Tasks 5 and 9, where §5.7 attribution is actually implemented. Step 3's
> code is **not** to be written: the fields are already derived.

**Files:**

- Modify: `src/core/events.ts`, `src/integrations/subagents.ts`, `src/core/reports.ts` (validation)
- Create: `tests/fixtures/pi/0.85.1/cross-midnight.jsonl`
- Test: `tests/unit/subagents.test.ts`, `tests/unit/report-range.test.ts` (new)

**Interfaces:**

- Consumes: `pushRun`/`collectResult` in `src/integrations/subagents.ts`.
- Produces: `AgentRun.observedAt`, `AgentRun.evidenceToolId` (Shared interfaces).

- [ ] **Step 1: Write the failing test**

```ts
// append to tests/unit/subagents.test.ts
test("a child run carries the publishing entry's observation time and tool id", () => {
  const entries = [
    entry({ id: "a1", type: "message", timestamp: "2026-09-11T23:59:00.000Z",
      message: { role: "assistant", content: [{ type: "toolCall", id: "call_1", name: "subagent", arguments: {} }] } }),
    entry({ id: "r1", type: "message", timestamp: "2026-09-12T00:01:00.000Z",
      message: { role: "toolResult", toolCallId: "call_1", toolName: "subagent", isError: false,
        details: { results: [{ index: 0, agent: "delegate", usage: { input: 10, output: 5, cost: 0.25, cacheRead: 0, cacheWrite: 0, turns: 1 } }] } } }),
  ];
  const evidence = readSubagentEvidence(entries);
  assert.equal(evidence.runs.length, 1);
  assert.equal(evidence.runs[0]?.observedAt, "2026-09-12T00:01:00.000Z");
  assert.equal(evidence.runs[0]?.evidenceToolId, "tool:call_1");
  assert.equal(evidence.runsWithUsage, 1);
});

test("a result that cannot be deterministically joined publishes no run", () => {
  const evidence = readSubagentEvidence([entry({ id: "r1", type: "message", timestamp: "2026-09-12T00:01:00.000Z",
    message: { role: "toolResult", toolName: "subagent", isError: false, details: { results: [{ index: 0, agent: "worker" }] } } })]);
  // No usable call id ⇒ nothing to correlate: the run is skipped, never guessed.
  assert.equal(evidence.runs.length, 0);
  assert.equal(evidence.runsWithUsage, 0);
});

test("a call without a result publishes no run while activity still counts it", () => {
  const evidence = readSubagentEvidence([entry({ id: "a1", type: "message", timestamp: "2026-09-11T23:59:00.000Z",
    message: { role: "assistant", content: [{ type: "toolCall", id: "call_1", name: "subagent", arguments: {} }] } })]);
  assert.equal(evidence.runs.length, 0);
  assert.equal(evidence.activity.calls, 1);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --import tsx --test tests/unit/subagents.test.ts`
Expected: FAIL — `observedAt` and `evidenceToolId` are `undefined`.

- [ ] **Step 3: Extend `AgentRun` and the adapter**

```ts
// src/core/events.ts
export type AgentRun = {
  id: string;
  parentId?: string;
  agent?: string;
  status: "running" | "succeeded" | "failed" | "interrupted" | "unknown";
  confidence: Confidence;
  artifacts?: "available" | "missing";
  usage?: Usage;
  /** Persisted tool-result entry time that published this run's evidence (§5.7). */
  observedAt?: string;
  /** `tool:<message.toolCallId>` of the publishing result; one-to-many (§7.5). */
  evidenceToolId?: string;
};
```

```ts
// src/integrations/subagents.ts — observation time and the canonical tool id travel together
type JoinedResult = { message: Readonly<Record<string, unknown>>; observedAt: string };

/**
 * Only a result carrying a usable `message.toolCallId` for a tool in
 * `SUBAGENT_TOOL_NAMES` can be joined. A result that cannot be joined publishes
 * NO run: evidence extraction is never broadened to satisfy a fixture.
 */
function collectResult(
  message: Readonly<Record<string, unknown>>,
  entryTimestamp: string,
  joinable: boolean,
  results: Map<string, JoinedResult>,
): void {
  const callId = message.toolCallId;
  if (!joinable || typeof callId !== "string" || callId.length === 0) return;
  if (!results.has(callId)) results.set(callId, { message, observedAt: entryTimestamp });
}
```

`pushRun` receives `{ runId, parentId, observedAt, evidenceToolId }` derived from **the joined entry** (`JoinedResult`), so a run can never carry an observation time or an evidence id that came from a different result:

`pushRun` gains the two fields (both optional, both validated: `observedAt` only when `isIsoTimestamp` style parse succeeds; `evidenceToolId` only when the call id was non-empty and the tool name is one of `SUBAGENT_TOOL_NAMES`):

```ts
  const projected: AgentRun = {
    id: opaqueSubagentId(rawId),
    status: mapRunStatus(record),
    confidence: "cooperative",
    ...(parentId === undefined ? {} : { parentId }),
    ...(isAgentLabel(record.agent) ? { agent: record.agent } : {}),
    ...(observed === undefined ? {} : { observedAt: observed }),
    ...(callId === undefined ? {} : { evidenceToolId: `tool:${callId}` }),
    ...(usage === undefined ? {} : { usage }),
  };
```

`deriveEvidence` returns `runsWithUsage: runs.filter((run) => run.usage !== undefined).length` on `SubagentEvidence`, and `src/core/reports.ts` validates the two new optional fields inside `projectAgent` exactly the way `artifacts`/`agent` are validated today (bounded string checks; drop on failure).

- [ ] **Step 4: Add the cross-midnight fixture**

```jsonl
{"type":"session","id":"cross-midnight","timestamp":"2026-09-11T23:58:00.000Z"}
{"type":"message","id":"g1","parentId":null,"timestamp":"2026-09-11T23:59:00.000Z","message":{"role":"assistant","provider":"anthropic","model":"claude-x","usage":{"input":10,"output":5,"totalTokens":15,"cost":0.5},"content":[{"type":"toolCall","id":"call_1","name":"bash","arguments":{"command":"true"}}]}}
{"type":"message","id":"r1","parentId":"g1","timestamp":"2026-09-12T00:01:00.000Z","message":{"role":"toolResult","toolCallId":"call_1","toolName":"bash","isError":true,"usage":{"input":1,"output":1,"totalTokens":2,"cost":0.25},"content":"[redacted]"}}
```

```ts
// tests/unit/report-range.test.ts
test("tool usage stays on the call day while its error is observed the next day", () => {
  const entries = parseSessionJsonl(readFileSync("tests/fixtures/pi/0.85.1/cross-midnight.jsonl", "utf8")).entries;
  const report = toSessionReport(reduceEntries("cross-midnight", entries));
  assert.equal(report.tools[0]?.timestamp, "2026-09-11T23:59:00.000Z");
  assert.equal(report.tools[0]?.usage?.totalTokens, 2);
  assert.equal(report.errors[0]?.timestamp, "2026-09-12T00:01:00.000Z");
  assert.equal(report.errors[0]?.kind, "tool-error");
});
```

- [ ] **Step 5: Run the tests and commit**

Run: `node --import tsx --test tests/unit/subagents.test.ts tests/unit/report-range.test.ts && npm test`
Expected: PASS.

```bash
git add src/core/events.ts src/integrations/subagents.ts src/core/reports.ts tests/unit/subagents.test.ts tests/unit/report-range.test.ts tests/fixtures/pi/0.85.1/cross-midnight.jsonl
git commit -m "feat: attribute child runs by observation time and add the cross-midnight fixture"
```

---

### Task 5: The single dated projection (`sessionDatedUsage`) over the canonical session

**Files:**

- Create: `src/ui/dated-usage.ts` (the one dated projection, spec §5.4/R19)
- Modify: `src/ui/load-history.ts` (call it inside `scanHistory`, attach the rows),
  `src/ui/load-current.ts` + `src/ui/current.ts` (attach the same projection to
  `CurrentTuiModel` for the current views)
- Create: `tests/fixtures/pi/0.85.1/mixed-usage.jsonl`
- Test: `tests/unit/history-reports.test.ts`, `tests/unit/dated-usage.test.ts` (new),
  `tests/unit/report-range.test.ts`, plus a generated long-session fixture
  (`longSessionOptions({ days: 400 })`)

**Interfaces:**

- Consumes: `CanonicalSession` — `usage.lines` (with `domain`, `bucket`,
  `attributedAt`), `generations`, `tools`, `errors`, and `health.usage.dated`.
- Produces: `DateUsageRow`, `DatedModelRow`, `sessionDatedUsage` (the only
  dated-projection function in the codebase), and the available
  `HistoricalSession` variant gaining `usageByDate` / `usageByDateTruncated`.

> **Retargeted for v0.8.0 (spec R19, §5.6).** One module owns the dates, because
> the bundle only ever sees a `SessionReport` and must not re-derive attribution.
> `usageByDateTruncated` is true when the 366-date cap drops rows **or** when
> `health.usage.dated === "partial"` (an unattributable native line), so partial is
> never presented as complete. Per-date **model** rows live here too, joined to
> their line by `ownerId`, so a generation cannot appear in one projection and not
> the other.

- [ ] **Step 1: Write the failing test**

```ts
// tests/fixtures/pi/0.85.1/mixed-usage.jsonl  (one session, every usage source)
{"type":"session","id":"mixed-usage","timestamp":"2026-09-01T08:00:00.000Z"}
{"type":"message","id":"g1","parentId":null,"timestamp":"2026-09-01T09:00:00.000Z","message":{"role":"assistant","provider":"anthropic","model":"claude-x","usage":{"input":100,"output":50,"totalTokens":150,"cost":1.5},"content":[{"type":"toolCall","id":"call_a","name":"bash","arguments":{"command":"true"}}]}}
{"type":"message","id":"r1","parentId":"g1","timestamp":"2026-09-02T00:10:00.000Z","message":{"role":"toolResult","toolCallId":"call_a","toolName":"bash","isError":false,"usage":{"input":10,"output":5,"totalTokens":15,"cost":0.15},"content":"[redacted]"}}
{"type":"compaction","id":"c1","parentId":"r1","timestamp":"2026-09-02T12:00:00.000Z","usage":{"input":20,"output":10,"totalTokens":30,"cost":0.3}}
{"type":"branch_summary","id":"b1","parentId":"c1","timestamp":"2026-09-03T12:00:00.000Z","usage":{"input":5,"output":5,"totalTokens":10,"cost":0.1}}
{"type":"message","id":"g2","parentId":"b1","timestamp":"2026-09-04T09:00:00.000Z","message":{"role":"assistant","provider":"anthropic","model":"claude-x","usage":{"input":1,"output":1,"totalTokens":2,"cost":0.02},"content":[{"type":"toolCall","id":"call_b","name":"edit","arguments":{"filePath":"x"}}]}}
{"type":"message","id":"r2","parentId":"g2","timestamp":"2026-09-05T09:00:00.000Z","message":{"role":"toolResult","toolCallId":"call_b","toolName":"edit","isError":true,"content":"[redacted]"}}
```

> The fixture has no tracking marker, so the test helper builds the canonical
> session in **tree** scope over the whole file (the marker rule is Task 1's, not
> this task's).

```ts
// append to tests/unit/dated-usage.test.ts (new file)
// (the fixture helper and `projectUsage` below live here; history-reports.test.ts
//  imports `sessionDatedUsage` only for the wiring assertions)
function canonicalOf(file: string, sessionId: string): CanonicalSession {
  const source = readFileSync(`tests/fixtures/pi/0.85.1/${file}`, "utf8");
  const built = buildCanonicalSession({
    parsed: parseSessionJsonl(source),
    scope: "tree",
    leafId: null,
    evidence: { atomic: [], folded: [] },
  });
  if (built.state !== "ready") throw new Error("fixture must build");
  assert.equal(built.session.sessionId, sessionId);
  return built.session;
}

function mixedReport(): SessionReport {
  const source = readFileSync("tests/fixtures/pi/0.85.1/mixed-usage.jsonl", "utf8");
  return toSessionReport(reduceEntries("mixed-usage", parseSessionJsonl(source).entries));
}

/** The reference the rows must match: same range, straight from the report. */
function projectUsage(report: SessionReport, range: { from: string; to: string }): { totalTokens: number; cost: number } {
  let totalTokens = 0;
  let cost = 0;
  const add = (timestamp: string, usage: { totalTokens: number; cost: number } | undefined): void => {
    if (usage === undefined || !isInRange(timestamp.slice(0, 10), { preset: null, ...range })) return;
    totalTokens += usage.totalTokens;
    cost += usage.cost;
  };
  for (const generation of report.generations) add(generation.timestamp, generation.usage);
  for (const tool of report.tools) add(tool.timestamp, tool.usage);
  for (const compaction of report.compactions) add(compaction.timestamp, compaction.usage);
  return { totalTokens, cost: Math.round(cost * 1e6) / 1e6 };
}

test("usageByDate attributes every usage source by logical call", () => {
  const { dates: rows, truncated } = sessionDatedUsage(canonicalOf("mixed-usage.jsonl", "mixed-usage"));
  assert.equal(truncated, false);
  assert.deepEqual(rows.map((row) => [row.date, row.totalTokens, row.generations, row.tools, row.errors]), [
    ["2026-09-01", 165, 1, 1, 0], // generation 150 + tool-result usage 15, on the CALL day
    ["2026-09-02", 30, 0, 0, 0],  // compaction
    ["2026-09-03", 10, 0, 0, 0],  // branch summary
    ["2026-09-04", 2, 1, 1, 0],   // generation only
    ["2026-09-05", 0, 0, 0, 1],   // error observation only: membership evidence, zero usage
  ]);
  assert.deepEqual(rows[0]?.composition, {
    generations: { totalTokens: 150, cost: 1.5 },
    toolResults: { totalTokens: 15, cost: 0.15 },
    compactions: { totalTokens: 0, cost: 0 },
    branchSummaries: { totalTokens: 0, cost: 0 },
  });
});

test("a fully retained range reconciles with the same range projection of the report", () => {
  const report = mixedReport();
  const rows = sessionDatedUsage(canonicalOf("mixed-usage.jsonl", "mixed-usage")).dates;
  assert.equal(rows.reduce((sum, row) => sum + row.totalTokens, 0), report.usage?.totalTokens);
  assert.equal(Math.round(rows.reduce((sum, row) => sum + row.cost, 0) * 1e6) / 1e6, report.usage?.cost);
  const range = { preset: null, from: "2026-09-01", to: "2026-09-02" };
  const inRange = rows.filter((row) => isInRange(row.date, range));
  const projection = projectUsage(report, range);
  assert.equal(inRange.reduce((sum, row) => sum + row.totalTokens, 0), projection.totalTokens);
  assert.equal(Math.round(inRange.reduce((sum, row) => sum + row.cost, 0) * 1e6) / 1e6, projection.cost);
  assert.equal(inRange.reduce((sum, row) => sum + row.composition.toolResults.totalTokens, 0), 15);
  assert.equal(inRange.reduce((sum, row) => sum + row.composition.compactions.totalTokens, 0), 30);
});

test("usageByDate covers the retained window and flags truncation", async () => {
  const options = await longSessionOptions({ days: 400 });
  const history = await loadHistoryReports(options);
  const session = history.sessions[0];
  assert.equal(session?.availability, "available");
  if (session?.availability !== "available") return;
  assert.equal(session.usageByDate.length, 366);
  assert.equal(session.usageByDateTruncated, true);
  assert.equal(session.usageByDate[0]?.date, "2028-06-21"); // oldest retained
  assert.equal(session.usageByDate.at(-1)?.date, "2029-06-21"); // newest retained
});

test("a short session is exact and not truncated", async () => {
  const options = await longSessionOptions({ days: 3 });
  const history = await loadHistoryReports(options);
  const session = history.sessions[0];
  if (session?.availability !== "available") throw new Error("expected available");
  assert.equal(session.usageByDateTruncated, false);
  assert.equal(session.usageByDate.reduce((sum, row) => sum + row.totalTokens, 0), session.report.usage?.totalTokens);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --import tsx --test tests/unit/dated-usage.test.ts`
Expected: FAIL — cannot resolve `../../src/ui/dated-usage.ts`.

- [ ] **Step 3: Implement the dated projection**

```ts
// src/ui/dated-usage.ts
import type { CanonicalSession, CanonicalUsageLine } from "../core/canonical.ts";

export type SafeUsage = { totalTokens: number; cost: number };
export type DateUsageRow = {
  date: string;
  totalTokens: number;
  cost: number;
  generations: number;
  tools: number;
  errors: number;
  composition: { generations: SafeUsage; toolResults: SafeUsage; compactions: SafeUsage; branchSummaries: SafeUsage };
};
export type DatedModelRow = { date: string; provider: string; model: string; generations: number; totalTokens: number; cost: number };

export const MAX_DATED_DATES = 366;
export const MAX_MODELS_PER_DATE = 64;
/** Bucket -> composition part. Child runs are a breakdown and never appear here. */
const COMPOSITION_PART: Readonly<Record<CanonicalUsageLine["bucket"], keyof DateUsageRow["composition"] | undefined>> = {
  generation: "generations",
  "tool-result": "toolResults",
  compaction: "compactions",
  "branch-summary": "branchSummaries",
  "child-run": undefined,
};
const zero = (): SafeUsage => ({ totalTokens: 0, cost: 0 });
const round = (value: number): number => Math.round(value * 1e6) / 1e6;
const dayOf = (timestamp: unknown): string | undefined => {
  if (typeof timestamp !== "string") return undefined;
  const date = timestamp.slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : undefined;
};

/**
 * THE dated projection (spec §5.4/R19). Every per-date figure a renderer needs
 * comes from here, grouped from the builder's own attribution: each
 * `CanonicalUsageLine` states `attributedAt`, so tool-result usage lands on the
 * tool's CALL date, compaction/branch-summary usage on their own entry dates, and
 * child usage is excluded by `domain`. `session.generations`/`session.tools`/
 * `session.errors` add observation-only membership counters even when they carry
 * no usage (§5.7). Model rows join their line by `ownerId`, so an unattributed
 * generation can never appear in one projection and not the other.
 *
 * `truncated` is true when `dates` cannot represent the session's whole native
 * usage: the `MAX_DATED_DATES` cap, or `health.usage.dated === "partial"` (an
 * unattributable native line). Partiality is reported, never hidden.
 */
export function sessionDatedUsage(session: CanonicalSession): {
  dates: DateUsageRow[];
  models: DatedModelRow[];
  truncated: boolean;
  modelsTruncated: boolean;
} {
  const byDate = new Map<string, DateUsageRow>();
  const rowFor = (date: string): DateUsageRow => {
    const existing = byDate.get(date) ?? {
      date, totalTokens: 0, cost: 0, generations: 0, tools: 0, errors: 0,
      composition: { generations: zero(), toolResults: zero(), compactions: zero(), branchSummaries: zero() },
    };
    byDate.set(date, existing);
    return existing;
  };
  const addUsage = (row: DateUsageRow, usage: SafeUsage, part: keyof DateUsageRow["composition"]): void => {
    row.composition[part].totalTokens += usage.totalTokens;
    row.composition[part].cost = round(row.composition[part].cost + usage.cost);
    row.totalTokens += usage.totalTokens;
    row.cost = round(row.cost + usage.cost);
  };
  // Line -> attributed date, so the model rows use the SAME attribution decision.
  const dateByOwner = new Map<string, string>();
  let unattributed = false;
  if (session.usage.state === "known") {
    for (const line of session.usage.lines) {
      if (line.domain !== "native-session") continue;
      const date = line.attributedAt.state === "known" ? dayOf(line.attributedAt.at) : undefined;
      if (date === undefined) {
        unattributed = true;
        continue;
      }
      dateByOwner.set(line.ownerId, date);
      const part = COMPOSITION_PART[line.bucket];
      if (part === undefined) continue;
      addUsage(rowFor(date), line.usage, part);
    }
  }
  // Membership counters describe observed activity, not spend.
  for (const generation of session.generations) {
    const date = dayOf(generation.timestamp);
    if (date !== undefined) rowFor(date).generations += 1;
  }
  for (const tool of session.tools) {
    const date = dayOf(tool.timestamp);
    if (date !== undefined) rowFor(date).tools += 1;
  }
  for (const error of session.errors) {
    const date = dayOf(error.timestamp);
    if (date !== undefined) rowFor(date).errors += 1;
  }
  // Model rows: only a generation whose own line is attributed can be dated.
  const byModelKey = new Map<string, DatedModelRow>();
  const modelsPerDate = new Map<string, Set<string>>();
  let modelsTruncated = false;
  for (const generation of session.generations) {
    const date = dateByOwner.get(generation.id);
    if (date === undefined) continue;
    const key = `${date}\u0000${generation.provider}\u0000${generation.model}`;
    const seen = modelsPerDate.get(date) ?? new Set<string>();
    if (!seen.has(key)) {
      if (seen.size >= MAX_MODELS_PER_DATE) {
        modelsTruncated = true;
        continue;
      }
      seen.add(key);
      modelsPerDate.set(date, seen);
    }
    const row = byModelKey.get(key) ?? {
      date, provider: generation.provider, model: generation.model, generations: 0, totalTokens: 0, cost: 0,
    };
    row.generations += 1;
    row.totalTokens += generation.usage.totalTokens;
    row.cost = round(row.cost + generation.usage.cost);
    byModelKey.set(key, row);
  }
  const dates = [...byDate.keys()].sort();
  const capped = dates.length > MAX_DATED_DATES;
  const retained = capped ? dates.slice(dates.length - MAX_DATED_DATES) : dates;
  const kept = new Set(retained);
  const models = [...byModelKey.values()]
    .filter((row) => kept.has(row.date))
    .sort((a, b) => a.date.localeCompare(b.date) || a.provider.localeCompare(b.provider) || a.model.localeCompare(b.model));
  return {
    dates: retained.map((date) => byDate.get(date) as DateUsageRow),
    models,
    truncated: capped || unattributed || session.health.usage.dated === "partial",
    modelsTruncated,
  };
}
```

Attach it in both loaders (Task 2 already returns `usageByDate` on the available
history variant; the current model gains the same projection in Task 6):

```ts
// src/ui/load-history.ts — inside scanHistory, before returning the available row
      const dated = sessionDatedUsage(session);
      return { availability: "available", sessionId, report, usageByDate: dated.dates, usageByDateTruncated: dated.truncated };
```

```ts
function toHistoricalSession(session: SessionScan): HistoricalSession {
  return session.availability === "available"
    ? { availability: "available", sessionId: session.sessionId, report: session.report,
        usageByDate: session.usageByDate, usageByDateTruncated: session.usageByDateTruncated }
    : { availability: "unavailable", sessionId: session.sessionId, reason: session.reason };
}
```

- [ ] **Step 4: Prove the reconciliation and membership contracts at the boundary**

```ts
test("the newest retained date reconciles with the session detail", async () => {
  const options = await longSessionOptions({ days: 400 });
  const history = await loadHistoryReports(options);
  const session = history.sessions[0];
  if (session?.availability !== "available") throw new Error("expected available");
  const newest = session.usageByDate.at(-1)?.date as string;
  const rowTotal = session.usageByDate.filter((row) => row.date === newest).reduce((sum, row) => sum + row.totalTokens, 0);
  const detailTotal = projectUsage(session.report, { from: newest, to: newest }).totalTokens;
  assert.equal(rowTotal, detailTotal);
});

test("per-date model rows join the same attribution as the date rows", () => {
  const { dates, models } = sessionDatedUsage(canonicalOf("mixed-usage.jsonl", "mixed-usage"));
  for (const date of dates) {
    const fromModels = models.filter((row) => row.date === date.date).reduce((sum, row) => sum + row.totalTokens, 0);
    assert.equal(fromModels, date.composition.generations.totalTokens, date.date);
  }
});

test("an observation-only date is membership evidence with zero usage", () => {
  const rows = sessionDatedUsage(canonicalOf("mixed-usage.jsonl", "mixed-usage")).dates;
  const observationOnly = rows.find((row) => row.errors > 0) as DateUsageRow;
  assert.equal(observationOnly.totalTokens, 0);
  assert.equal(observationOnly.date, "2026-09-05");
  // Membership is real even though nothing was spent on that date.
  assert.equal(historyRowRange({ usageByDate: rows, usageByDateTruncated: false }, { preset: null, from: "2026-09-05", to: "2026-09-05" }).member, true);
});

test("an unattributable native usage line marks the window partial, never zero", () => {
  // An entry with no usable timestamp cannot be dated: the row must not be
  // silently dropped from a window that then reads as complete.
  const session = canonicalOf("usage-composition.jsonl", "usage-composition");
  const { dates, truncated } = sessionDatedUsage({
    ...session,
    health: { ...session.health, usage: { ...session.health.usage, dated: "partial" } },
  });
  assert.equal(truncated, true);
  assert.equal(dates.reduce((sum, row) => sum + row.totalTokens, 0) > 0, true);
});
```

- [ ] **Step 5: Run the tests and commit**

Run: `node --import tsx --test tests/unit/dated-usage.test.ts tests/unit/history-reports.test.ts && npm test`
Expected: PASS.

```bash
git add src/ui/dated-usage.ts src/ui/load-history.ts src/ui/load-current.ts src/ui/current.ts tests/unit/dated-usage.test.ts tests/unit/history-reports.test.ts tests/fixtures/pi/0.85.1/mixed-usage.jsonl
git commit -m "feat: add one dated usage projection over the canonical attribution"
```

---

### Task 6: Daily composition and capability table, folded from the dated projection

**Files:**

- Create: `src/ui/daily.ts` (the single daily-row folder)
- Modify: `src/ui/bundle.ts` (`capabilities`, `dateModels`, `sameReportProjection` payload),
  `src/ui/load-current.ts` + `src/ui/current.ts` (attach `sessionDatedUsage` —
  Task 5 — to the current model so the bundle never re-derives dates),
  `src/ui/html.ts` (re-export `buildDailyRows` under its existing name)
- Test: `tests/unit/bundle.test.ts`, `tests/unit/html.test.ts`

**Interfaces:**

- Consumes: `sessionDatedUsage` (Task 5) through the current model; `DatedModelRow`
  and `DateUsageRow` from `src/ui/dated-usage.ts`.
- Produces: `DailyRow` (composition included), `CurrentView.datedModels`,
  `CurrentView.modelsTruncated`, `CurrentView.capabilities`, `CAPABILITIES`.

> **Retargeted for v0.8.0.** `src/ui/bundle.ts` already has a private `dailyRows()`
> and `src/ui/html.ts` already has `buildDailyActivityRows()` bucketing dates
> independently; neither can see the canonical attribution (the bundle holds a
> `SessionReport`). With Task 5's projection attached to the current model and to
> `HistoricalSession`, both become **folds**: `buildDailyRows(rows)` sums
> `usageByDate` rows by date (spec §5.4, R19) and there is no timestamp walk left
> anywhere in the bundle or the client. `DatedModelRow` is **defined in
> `src/ui/dated-usage.ts`** (Task 5); this task only passes it through.
>
> **Size gate (P0-B).** Before the first edit, record
> `renderInspectorBundle(bundleFixture()).length` and write the number into the
> task report; Task 9 records the after number. Gate: **≤ +15 %** relative growth,
> no absolute ceiling (spec §5.4/P0-B).

- [ ] **Step 1: Write the failing test**

```ts
// append to tests/unit/bundle.test.ts
import { CAPABILITIES } from "../../src/ui/bundle.ts";

test("a view carries per-date model rows and daily composition", async () => {
  const bundle = await loadInspectorBundle({
    ...input,
    loadCurrent: async (scope) => modelFor(scope, ["2026-03-01T10:00:00.000Z", "2026-03-02T10:00:00.000Z"]),
  });
  const view = bundle.current.active;
  assert.equal(view.datedModels?.length, 2);
  assert.deepEqual(view.datedModels?.[0], {
    date: "2026-03-01", provider: "anthropic", model: "claude-x",
    generations: 1, totalTokens: 100, cost: 0.5,
  });
  assert.equal(view.datedModels?.[1]?.date, "2026-03-02");
  assert.equal(view.modelsTruncated, false);
  assert.equal(view.daily?.[0]?.composition.generations.totalTokens, 100);
  assert.equal(view.daily?.[0]?.composition.toolResults.totalTokens, 0);
});

test("model rows are capped per date and flagged", async () => {
  const models = Array.from({ length: 70 }, (_, index) => `model-${index}`);
  const bundle = await loadInspectorBundle({ ...input, loadCurrent: async (scope) => modelForMany(scope, models) });
  const view = bundle.current.active;
  const newest = view.datedModels?.[view.datedModels.length - 1]?.date;
  assert.equal(view.datedModels?.filter((row) => row.date === newest).length, 64);
  assert.equal(view.modelsTruncated, true);
});

test("the capability table is data, not client prose", () => {
  assert.deepEqual(CAPABILITIES.global, ["overview"]);
  assert.deepEqual(CAPABILITIES.history, ["overview"]);
  assert.ok(CAPABILITIES.current.includes("environment"));
  assert.equal(CAPABILITIES.current.includes("commands"), false);
  assert.equal(CAPABILITIES.current.includes("skills"), false);
});
```

> `modelForMany`/`modelFor` already exist in `tests/unit/bundle.test.ts`.
> `modelForMany` must let each model carry a distinct provider/model pair on one
> date; the existing helper builds one generation per date, so extend it to emit
> one generation per model name on the newest date.

- [ ] **Step 2: Run test to verify it fails**

Run: `node --import tsx --test tests/unit/bundle.test.ts`
Expected: FAIL — `view.datedModels` is undefined.

- [ ] **Step 3: Implement the projections**

```ts
// src/ui/daily.ts — the ONLY daily-row builder; it folds, it never buckets
import type { DateUsageRow, SafeUsage } from "./dated-usage.ts";

export type DailyRow = {
  date: string;
  sessions: number;
  totalTokens: number;
  cost: number;
  generations: number;
  tools: number;
  composition: { generations: SafeUsage; toolResults: SafeUsage; compactions: SafeUsage; branchSummaries: SafeUsage };
};

/**
 * Sums per-session dated rows by date (spec §5.4/R19). Each contribution is one
 * `HistoricalSession.usageByDate` or one current view's `usageByDate`; a session
 * that cannot be dated contributes nothing (`unavailable != 0`). `sessions`
 * counts distinct contributing sessions, so two sessions on one date give one row.
 *
 * `truncated` is true when ANY contributing session's window was capped or
 * partial (`usageByDateTruncated`), or when the fold itself exceeds
 * `MAX_DATED_DATES`: the chart can then never present a partial total as complete.
 */
export function buildDailyRows(
  contributions: readonly { sessionId: string; rows: readonly DateUsageRow[]; truncated: boolean }[],
): { rows: DailyRow[]; truncated: boolean } { /* sum by date; keep the newest MAX_DATED_DATES */ }
```

`bundle.ts` replaces its private `dailyRows()` with
`buildDailyRows([{ sessionId: model.report.sessionId, rows: view.usageByDate, truncated: view.usageByDateTruncated }])`;
`html.ts` imports and re-exports `buildDailyRows` under its existing public name
`buildDailyActivityRows` so `renderHtml`'s adapter and `tests/unit/html.test.ts`
keep working (that test's expectations gain `composition`; lines ~492, 514, 520).
**Delete** the old `dailyRows()`/`buildDailyActivityRows` bodies — leaving either
is a second date implementation (spec R19).

The history/global daily fold passes every available session's rows; an
unavailable session contributes nothing and is counted only in the coverage line.

```ts
// src/ui/bundle.ts — the per-section capability table (spec R8, server-side truth)
export const CAPABILITIES: Readonly<Record<"current" | "history" | "global", readonly Tab[]>> = {
  current: ["overview", "models", "tools", "environment", "agents", "integrations", "errors", "ledger"],
  // Breakdowns across sessions are deferred (spec §15), so the aggregate sections
  // offer exactly what they compute.
  history: ["overview"],
  global: ["overview"],
};
/** A view that cannot replay has no capable tab at all. */
const NO_CAPABILITIES: readonly Tab[] = [];
```

`currentView()` copies the projection the loader attached (Task 5) and folds it:

```ts
// src/ui/bundle.ts — inside currentView()
  const projection = model.datedUsage;   // attached by load-current.ts: { dates, models, truncated, modelsTruncated }
  const daily = buildDailyRows([
    { sessionId: model.report.sessionId, rows: projection.dates, truncated: projection.truncated },
  ]);
  return {
    availability: "available",
    report: model.report,
    usageByDate: projection.dates,
    daily: daily.rows,
    dailyTruncated: daily.truncated,
    datedModels: projection.models,
    modelsTruncated: projection.modelsTruncated,
    capabilities: CAPABILITIES.current,
  };
```

The 366-row cap test in `bundle.test.ts` must keep passing unchanged; this task
only adds `composition` to each row and `datedModels`/`capabilities` to the view.
`CurrentView` for the unavailable path keeps `capabilities: NO_CAPABILITIES` and
no rows.

- [ ] **Step 4: Assert the caps and the unavailable path**

```ts
test("an unavailable view advertises no capabilities and no rows", async () => {
  const bundle = await loadInspectorBundle({ ...input, loadCurrent: async () => undefined });
  assert.deepEqual(bundle.current.active.capabilities, []);
  assert.equal(bundle.current.active.datedModels, undefined);
});
```

- [ ] **Step 5: Run the tests and commit**

Run: `node --import tsx --test tests/unit/bundle.test.ts && npm test`
Expected: PASS.

```bash
git add src/ui/daily.ts src/ui/bundle.ts src/ui/load-current.ts src/ui/current.ts src/ui/html.ts tests/unit/bundle.test.ts tests/unit/html.test.ts
git commit -m "feat: fold the dated projection into daily rows and add the capability table"
```

---

### Task 7: `sameReportProjection` and the scope copy

**Files:**

- Modify: `src/ui/bundle.ts`, `src/ui/html.ts` (i18n + scope block)
- Test: `tests/unit/bundle.test.ts`, `tests/unit/html-bundle.test.ts`

> **Retargeted for v0.8.0.** The catalog already carries `scope.active`
> ("Active ancestry"), `scope.tree` ("Full tree") and `scope.fixed`. This task
> retitles them to the spec §4.2 wording (`Active path`, `Full session tree`),
> adds the two sub-labels, and renders the same-projection note from the new
> `current.sameReportProjection` flag. It does not create the scope control —
> that already exists in `renderBody`.

**Interfaces:**

- Consumes: two `CurrentView`s.
- Produces: `current.sameReportProjection`; catalog keys `scope.active`, `scope.tree`, `scope.active.note`, `scope.tree.note`, `scope.sameReport`, `scope.fixed`.

- [ ] **Step 1: Write the failing test**

```ts
// append to tests/unit/bundle.test.ts
test("identical views set sameReportProjection, divergent views clear it", async () => {
  const same = await loadInspectorBundle({ ...input, loadCurrent: async (scope) => modelFor(scope, ["2026-03-01T10:00:00.000Z"]) });
  assert.equal(same.current.sameReportProjection, true);
  const different = await loadInspectorBundle({ ...input, loadCurrent: async (scope) => modelFor(scope, scope === "active" ? ["2026-03-01T10:00:00.000Z"] : ["2026-03-01T10:00:00.000Z", "2026-03-02T10:00:00.000Z"]) });
  assert.equal(different.current.sameReportProjection, false);
});

test("the note never claims entry-set equality", async () => {
  const bundle = await loadInspectorBundle({ ...input, loadCurrent: async (scope) => modelFor(scope, ["2026-03-01T10:00:00.000Z"]) });
  const html = renderInspectorBundle(bundle);
  assert.match(html, /Active path and Full session tree produce the same report data for this session\./);
  assert.doesNotMatch(html, /covers every tracked entry/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --import tsx --test tests/unit/bundle.test.ts`
Expected: FAIL — `sameReportProjection` is undefined.

- [ ] **Step 3: Compute the flag and the copy**

```ts
// src/ui/bundle.ts
  return {
    schemaVersion: 1,
    theme: input.theme,
    initialScope: input.initialScope,
    current: { active, tree, sameReportProjection: sameReportProjection(active, tree) },
    history,
    global,
  };

/** Byte-level comparison of the two canonical projections (never an entry-set claim). */
function sameReportProjection(left: CurrentView, right: CurrentView): boolean {
  if (left.availability !== right.availability) return false;
  if (left.availability === "unavailable") return left.diagnostic === right.diagnostic;
  return canonical(left.report) === canonical(right.report) && canonical(left.daily) === canonical(right.daily);
}

/** Stable serialization: object keys sorted, arrays kept in their documented order. */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => entry !== undefined)
      .sort(([a], [b]) => a.localeCompare(b));
    return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${canonical(entry)}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}
```

```ts
// src/ui/html.ts catalog
  "scope.active": "Active path",
  "scope.tree": "Full session tree",
  "scope.active.note": "Selected entry and its parent ancestry",
  "scope.tree.note": "All tracked branches in this session",
  "scope.sameReport": "Active path and Full session tree produce the same report data for this session.",
```

Render the scope block from the payload (`sameReportProjection` and the labels) and show `scope.sameReport` only when the flag is true.

- [ ] **Step 4: Assert the labels carry no descendant claim**

```ts
test("scope copy makes no claim about children or entries", async () => {
  const bundle = await loadInspectorBundle({ ...input, loadCurrent: async () => modelFor("active", ["2026-03-01T10:00:00.000Z"]) });
  const html = renderInspectorBundle(bundle);
  assert.match(html, /Active path/);
  assert.match(html, /Selected entry and its parent ancestry/);
  assert.match(html, /Full session tree/);
  assert.match(html, /All tracked branches in this session/);
  assert.doesNotMatch(html, /children/);
});
```

- [ ] **Step 5: Run the tests and commit**

Run: `node --import tsx --test tests/unit/bundle.test.ts tests/unit/html-bundle.test.ts && npm test`
Expected: PASS.

```bash
git add src/ui/bundle.ts src/ui/html.ts tests/unit/bundle.test.ts tests/unit/html-bundle.test.ts
git commit -m "feat: report identical report projections and scope copy without entry-set claims"
```

---

### Task 8: Pure range module — resolution, validation, and filtering

**Files:**

- Create: `src/ui/range.ts`
- Test: `tests/unit/range.test.ts` (new)

**Interfaces:**

- Produces: `RangeState`, `RangeIntent`, `resolveRange`, `isInRange`, `presetRange`, `shiftUtcDay`, `latestObservedDate`, `serializeRangeQuery`, `parseRangeQuery` (Shared interfaces plus the query helpers used by Task 16).

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/range.test.ts
import assert from "node:assert/strict";
import { test } from "node:test";
import { isInRange, latestObservedDate, parseRangeQuery, presetRange, resolveRange, serializeRangeQuery, shiftUtcDay } from "../../src/ui/range.ts";

const dates = ["2026-09-01", "2026-09-11", "2026-09-12"];

test("presets are anchored on the latest observed date, inclusively", () => {
  assert.deepEqual(presetRange(7, dates), { preset: 7, from: "2026-09-06", to: "2026-09-12" });
  assert.deepEqual(presetRange(14, dates), { preset: 14, from: "2026-08-30", to: "2026-09-12" });
  assert.deepEqual(presetRange(30, dates), { preset: 30, from: "2026-08-14", to: "2026-09-12" });
  assert.equal(presetRange(7, []), undefined);
});

test("boundaries are inclusive on both ends", () => {
  const range = { preset: null, from: "2026-09-12", to: "2026-09-12" };
  assert.equal(isInRange("2026-09-12", range), true);
  assert.equal(isInRange("2026-09-11", range), false);
});

test("defaults are the full observed span for current and 14D for aggregates", () => {
  assert.deepEqual(resolveRange(undefined, dates, "current"), { preset: null, from: "2026-09-01", to: "2026-09-12" });
  assert.deepEqual(resolveRange(undefined, dates, "aggregate"), { preset: 14, from: "2026-08-30", to: "2026-09-12" });
  // Nothing observed ⇒ no range at all, never a sentinel date.
  assert.equal(resolveRange(undefined, [], "current"), undefined);
  assert.equal(resolveRange(undefined, [], "aggregate"), undefined);
});

test("a preset is an unresolved intent until it meets a view's dates", () => {
  assert.deepEqual(parseRangeQuery("preset=7"), { kind: "preset", preset: 7 });
  assert.deepEqual(parseRangeQuery("preset=30&from=2026-09-01&to=2026-09-12"), { kind: "preset", preset: 30 });
  assert.equal(parseRangeQuery("preset=99"), undefined);
  assert.equal(parseRangeQuery("preset="), undefined);
  const intent = parseRangeQuery("preset=7") as RangeIntent;
  assert.deepEqual(resolveRange(intent, dates, "current"), presetRange(7, dates)); // identical to the 7D selector
  assert.equal(resolveRange(intent, [], "current"), undefined);
  assert.deepEqual(serializeRangeQuery(intent), [["preset", "7"]]);
});

test("a custom range survives only as a valid pair", () => {
  assert.deepEqual(parseRangeQuery("from=2026-09-01&to=2026-09-12"), { kind: "custom", from: "2026-09-01", to: "2026-09-12" });
  assert.equal(parseRangeQuery("from=2026-09-01"), undefined);
  assert.equal(parseRangeQuery("to=2026-09-12"), undefined);
  assert.equal(parseRangeQuery("from=2026-09-12&to=2026-09-01"), undefined);
  assert.equal(parseRangeQuery("from=2026-13-01&to=2026-09-12"), undefined);
  assert.deepEqual(serializeRangeQuery({ kind: "custom", from: "2026-09-01", to: "2026-09-12" }), [["from", "2026-09-01"], ["to", "2026-09-12"]]);
});

test("no helper can produce the 1970 sentinel", () => {
  const pairs = [
    ...serializeRangeQuery({ kind: "custom", from: "2026-09-01", to: "2026-09-12" }),
    ...serializeRangeQuery({ kind: "preset", preset: 14 }),
  ];
  assert.ok(pairs.every(([, value]) => !value.startsWith("1970")));
  assert.ok(pairs.every(([, value]) => value !== "1970-01-01"));
});

test("day shifting is UTC-stable and latestObservedDate ignores bad input", () => {
  assert.equal(shiftUtcDay("2026-03-01", -1), "2026-02-28");
  assert.equal(shiftUtcDay("2026-01-01", -1), "2025-12-31");
  assert.equal(latestObservedDate(["bogus", "2026-09-12", "2026-09-01"]), "2026-09-12");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --import tsx --test tests/unit/range.test.ts`
Expected: FAIL — cannot resolve `../../src/ui/range.ts`.

- [ ] **Step 3: Implement the module**

```ts
// src/ui/range.ts
/**
 * Pure range semantics shared by the browser document and the tests. This module
 * is inlined verbatim into the generated HTML (Task 17), so it must stay
 * dependency-free and free of Node/DOM APIs.
 */
export type RangeState = { preset: 7 | 14 | 30 | null; from: string; to: string };

// NOTE: every exported function below is INLINED into the generated document by
// name (Task 17), which copies the function body only. Each function must
// therefore be self-contained: no module-level constant or helper it relies on.
// That is why the date pattern and the preset list are declared inside the
// functions that use them.

export function latestObservedDate(dates: readonly string[]): string | undefined {
  const valid = dates.filter((date) => /^\d{4}-\d{2}-\d{2}$/.test(date)).sort();
  return valid.length === 0 ? undefined : valid[valid.length - 1];
}

export function shiftUtcDay(date: string, offset: number): string {
  const parsed = new Date(`${date}T00:00:00.000Z`);
  parsed.setUTCDate(parsed.getUTCDate() + offset);
  return parsed.toISOString().slice(0, 10);
}

export function presetRange(preset: 7 | 14 | 30, dates: readonly string[]): RangeState | undefined {
  const to = latestObservedDate(dates);
  if (to === undefined) return undefined;
  return { preset, from: shiftUtcDay(to, -(preset - 1)), to };
}

export function resolveRange(intent: RangeIntent | undefined, dates: readonly string[], kind: "current" | "aggregate"): RangeState | undefined {
  if (intent !== undefined && intent.kind === "custom") return { preset: null, from: intent.from, to: intent.to };
  if (intent !== undefined) return presetRange(intent.preset, dates);
  if (kind === "aggregate") return presetRange(14, dates);
  const observed = dates.filter((date) => /^\d{4}-\d{2}-\d{2}$/.test(date)).sort();
  if (observed.length === 0) return undefined; // no observed dates ⇒ no range, never a sentinel
  return { preset: null, from: observed[0] as string, to: observed[observed.length - 1] as string };
}

export function isInRange(date: string, range: RangeState): boolean {
  return date >= range.from && date <= range.to;
}

/** Query pairs in canonical order; a preset serializes alone. */
export type RangeIntent = { kind: "preset"; preset: 7 | 14 | 30 } | { kind: "custom"; from: string; to: string };

/**
 * Query pairs in canonical order. A preset serializes as `preset=<n>` and carries
 * NO dates: it stays an unresolved intent until the active view's observed dates
 * resolve it, so no sentinel can ever reach a hash, a filter, or the rendering.
 */
export function serializeRangeQuery(intent: RangeIntent): [string, string][] {
  if (intent.kind === "preset") return [["preset", String(intent.preset)]];
  return [["from", intent.from], ["to", intent.to]];
}

/**
 * Reads range params. Rejections are total — there is no partial application and
 * no fabricated date: an unknown/invalid preset, a lone endpoint, a malformed
 * date, or an inverted pair all yield undefined so the caller can fall back to
 * the view default and render the restoration notice.
 */
export function parseRangeQuery(query: string): RangeIntent | undefined {
  const DATE = /^\d{4}-\d{2}-\d{2}$/;
  const PRESETS: readonly number[] = [7, 14, 30];
  const params = new Map<string, string>();
  for (const part of query.replace(/^\?/, "").split("&")) {
    if (part === "") continue;
    const index = part.indexOf("=");
    if (index < 0) continue;
    params.set(decodeURIComponent(part.slice(0, index)), decodeURIComponent(part.slice(index + 1)));
  }
  const presetText = params.get("preset");
  if (presetText !== undefined) {
    const preset = Number(presetText);
    // A preset wins over a pair (deterministic precedence) and stays unresolved.
    return PRESETS.includes(preset) ? { kind: "preset", preset: preset as 7 | 14 | 30 } : undefined;
  }
  const from = params.get("from");
  const to = params.get("to");
  if (from === undefined || to === undefined) return undefined;
  if (!DATE.test(from) || !DATE.test(to)) return undefined;
  if (from > to) return undefined;
  return { kind: "custom", from, to };
}
```

- [ ] **Step 4: Prove the invalid-pair contract end to end**

```ts
test("invalid pairs never yield a partial range", () => {
  for (const query of ["", "from=2026-09-01", "to=2026-09-12", "from=2026-09-12&to=2026-09-01", "from=x&to=y", "preset=99"]) {
    assert.equal(parseRangeQuery(query), undefined, query);
  }
});

test("a preset intent round-trips without dates", () => {
  const intent = parseRangeQuery("preset=14") as RangeIntent;
  const pairs = serializeRangeQuery(intent);
  assert.deepEqual(pairs, [["preset", "14"]]);
  const query = pairs.map(([key, value]) => `${key}=${value}`).join("&");
  assert.deepEqual(parseRangeQuery(query), intent);
});
```

- [ ] **Step 5: Run the tests and commit**

Run: `node --import tsx --test tests/unit/range.test.ts && npm run typecheck`
Expected: PASS.

```bash
git add src/ui/range.ts tests/unit/range.test.ts
git commit -m "feat: add the pure range module with pair validation and UTC presets"
```

---

### Task 9: Apply one range filter to every tab, including aggregate membership

**Files:**

- Modify: `src/ui/html.ts` (client range wiring, membership, truncation notice), `src/ui/bundle.ts` (expose `usageByDate` in the history projection)
- Test: `tests/unit/html-bundle.test.ts`, `tests/unit/report-range.test.ts`

**Interfaces:**

- Consumes: `src/ui/range.ts` (Task 8), `usageByDate`/`usageByDateTruncated` (Task 5), canonical date fields (Task 11).
- Produces: browser-side `filterView(view, range)` and `historyRowRange(entry, range)` (both from `src/ui/range.ts`), catalog keys `range.truncated`, `history.dailyTruncated`, `range.restored`.

> **Retargeted for v0.8.0.** The rule this task replaces is
> `inPeriod(entry)` in the client script (~line 1357): it uses **span overlap**
> (`entry.firstDate <= to && entry.lastDate >= from`), which is exactly the
> membership defect spec §5.6 rules out. Membership becomes `historyRowRange`.
> Record the closing P0-B size-gate number here (Task 6 captured the "before"
> bytes).

- [ ] **Step 1: Write the failing test**

```ts
// append to tests/unit/report-range.test.ts
test("7D and 14D differ on every range-aware widget", () => {
  const rows = [dailyRow("2026-09-01", 100), dailyRow("2026-09-11", 200), dailyRow("2026-09-12", 300)];
  const models = [datedModel("2026-09-01", "claude-x", 100), datedModel("2026-09-12", "claude-x", 300)];
  const tools = [toolRow("2026-09-01", "bash"), toolRow("2026-09-12", "bash")];
  const seven = filterView({ rows, models, tools }, presetRange(7, ["2026-09-12"]) as RangeState);
  const fourteen = filterView({ rows, models, tools }, presetRange(14, ["2026-09-12"]) as RangeState);
  assert.equal(seven.cost, 500);
  assert.equal(fourteen.cost, 600);
  assert.equal(seven.models[0]?.totalTokens, 300);
  assert.equal(fourteen.models[0]?.totalTokens, 400);
  assert.equal(seven.tools.length, 1);
  assert.equal(fourteen.tools.length, 2);
});

test("a session joins an aggregate range only with an in-range record", () => {
  const spanning = { usageByDate: [usageRow("2026-01-01", 10), usageRow("2026-09-12", 20)] };
  const range = { preset: null, from: "2026-09-01", to: "2026-09-12" };
  assert.deepEqual(historyRowRange(spanning, range), { member: true, totalTokens: 20, cost: usageRow("2026-09-12", 20).cost, partial: false });
  const outside = { usageByDate: [usageRow("2026-01-01", 10)] };
  assert.deepEqual(historyRowRange(outside, range), { member: false, totalTokens: 0, cost: 0, partial: false });
});

// Three truncation cases, in the order the contract requires them to be decided.
const truncatedRows = { usageByDate: [usageRow("2029-06-21", 5)], usageByDateTruncated: true };

test("case 1: a range fully inside the retained window is complete", () => {
  const retained = { usageByDate: [usageRow("2029-06-21", 5), usageRow("2029-06-22", 7)], usageByDateTruncated: true };
  assert.deepEqual(historyRowRange(retained, { preset: null, from: "2029-06-22", to: "2029-06-22" }), {
    member: true, totalTokens: 7, cost: usageRow("2029-06-22", 7).cost, partial: false,
  });
});

test("case 2: a range that reaches into omitted history is partial, not complete", () => {
  const retained = { usageByDate: [usageRow("2029-06-21", 5)], usageByDateTruncated: true };
  const result = historyRowRange(retained, { preset: null, from: "2020-01-01", to: "2029-06-21" });
  assert.equal(result.member, true);        // known in-range evidence exists
  assert.equal(result.totalTokens, 5);      // the exact known subtotal
  assert.equal(result.partial, true);       // and it is explicitly partial
});

test("case 3: a range entirely inside the omitted period is unavailable, never zero", () => {
  const result = historyRowRange(truncatedRows, { preset: null, from: "2020-01-01", to: "2020-12-31" });
  assert.equal(result.member, false);
  assert.equal(result.partial, true);
  assert.equal(result.totalTokens, null);
  assert.equal(result.cost, null);
});
// §5.7 cross-midnight regression (fixture moved here from the retired Task 4).
test("tool usage stays on the call day while its error is observed the next day", () => {
  const entries = parseSessionJsonl(readFileSync("tests/fixtures/pi/0.85.1/cross-midnight.jsonl", "utf8")).entries;
  const report = toSessionReport(reduceEntries("cross-midnight", entries));
  assert.equal(report.tools[0]?.timestamp, "2026-09-11T23:59:00.000Z");
  assert.equal(report.tools[0]?.usage?.totalTokens, 2);
  assert.equal(report.errors[0]?.timestamp, "2026-09-12T00:01:00.000Z");
  assert.equal(report.errors[0]?.kind, "tool-error");
  // The call day carries the tool usage; the next day carries the error alone.
  const callDay = filterView({ rows: [], models: [], tools: report.tools, agents: [], errors: report.errors }, { preset: null, from: "2026-09-11", to: "2026-09-11" });
  const nextDay = filterView({ rows: [], models: [], tools: report.tools, agents: [], errors: report.errors }, { preset: null, from: "2026-09-12", to: "2026-09-12" });
  assert.deepEqual(callDay.tools.map((tool) => tool.id), ["tool:call_1"]);
  assert.deepEqual(callDay.errors, []);
  assert.deepEqual(nextDay.errors.map((error) => error.id), ["tool:call_1"]);
});
```

```jsonl
// tests/fixtures/pi/0.85.1/cross-midnight.jsonl
{"type":"session","id":"cross-midnight","timestamp":"2026-09-11T23:58:00.000Z"}
{"type":"message","id":"g1","parentId":null,"timestamp":"2026-09-11T23:59:00.000Z","message":{"role":"assistant","provider":"anthropic","model":"claude-x","usage":{"input":10,"output":5,"totalTokens":15,"cost":0.5},"content":[{"type":"toolCall","id":"call_1","name":"bash","arguments":{"command":"true"}}]}}
{"type":"message","id":"r1","parentId":"g1","timestamp":"2026-09-12T00:01:00.000Z","message":{"role":"toolResult","toolCallId":"call_1","toolName":"bash","isError":true,"usage":{"input":1,"output":1,"totalTokens":2,"cost":0.25},"content":"[redacted]"}}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --import tsx --test tests/unit/report-range.test.ts`
Expected: FAIL — `filterView`/`historyRowRange` are not exported.

- [ ] **Step 3: Implement one filter used by every tab**

Move the client-side filter into `src/ui/range.ts` so it is testable and inlined once:

```ts
// src/ui/range.ts (additions)
export type ViewRows = {
  rows: readonly { date: string }[];
  models: readonly { date: string }[];
  tools: readonly { date: string }[];
  agents: readonly { observedAt?: string }[];
  errors: readonly { timestamp: string }[];
};

/** The single range filter every tab uses; no widget filters its own data. */
export function filterView<V extends ViewRows>(view: V, range: RangeState): V {
  const keep = (date: string | undefined): boolean => date !== undefined && isInRange(date.slice(0, 10), range);
  return {
    ...view,
    rows: view.rows.filter((row) => keep(row.date)),
    models: view.models.filter((row) => keep(row.date)),
    tools: view.tools.filter((row) => keep(row.date)),
    agents: view.agents.filter((row) => keep(row.observedAt)),
    errors: view.errors.filter((row) => keep(row.timestamp)),
  };
}

export type HistoryRowRange = { member: boolean; totalTokens: number | null; cost: number | null; partial: boolean };

/**
 * Aggregate membership requires an in-range observed record (§5.6). The
 * truncation verdict is decided FIRST, so a known subtotal is never presented as
 * a complete one:
 *   - retained rows in range, no reach into omitted history → exact, partial false
 *   - retained rows in range AND the range starts before the oldest retained row
 *     → member true, exact known subtotal, partial true (labels must say Known)
 *   - no retained rows in range AND the range reaches into omitted history
 *     → usage unavailable (null), never 0
 *   - no retained rows in range, fully covered range → member false, 0
 */
export function historyRowRange(
  entry: { usageByDate: readonly { date: string; totalTokens: number; cost: number }[]; usageByDateTruncated?: boolean },
  range: RangeState,
): HistoryRowRange {
  const oldest = entry.usageByDate.map((row) => row.date).sort()[0];
  const reachesOmitted = entry.usageByDateTruncated === true && oldest !== undefined && range.from < oldest;
  const inRange = entry.usageByDate.filter((row) => isInRange(row.date, range));
  if (inRange.length > 0) {
    return {
      member: true,
      totalTokens: inRange.reduce((sum, row) => sum + row.totalTokens, 0),
      cost: Math.round(inRange.reduce((sum, row) => sum + row.cost, 0) * 1e6) / 1e6,
      partial: reachesOmitted,
    };
  }
  if (reachesOmitted) return { member: false, totalTokens: null, cost: null, partial: true };
  return { member: false, totalTokens: 0, cost: 0, partial: false };
}
```

In the client, every tab renders from `filterView(view, period())`, and the history list renders rows via `historyRowRange`, grouping `member === false && truncated === true` rows under the `Unavailable · dates unknown` group with the `history-daily-truncated` diagnostic and a `Known` qualifier:

```js
function inPeriodRow(entry){return historyRowRange(entry,period());}
function historyMetrics(){
  /* Sum only rows with result.member === true. When ANY contributing row has
     result.partial === true, the aggregate labels switch to tr("metric.knownCost") /
     tr("metric.knownTokens") and the row shows the history-daily-truncated diagnostic:
     a known subtotal must never be presented as complete. */
}
```

- [ ] **Step 4: Assert the truncation notice and no-zero rule**

```ts
test("a truncated contribution always renders as Known with the diagnostic", async () => {
  const html = renderInspectorBundle(bundleWithTruncatedHistory());
  assert.match(html, /history-daily-truncated/);
  assert.match(html, /Known native cost|Known tokens/);
  assert.doesNotMatch(html, /"partial":true[^}]*"totalTokens":0/);
});

test("only a complete range keeps the unqualified labels", async () => {
  const html = renderInspectorBundle(bundleWithTruncatedHistory());
  const completeRange = html.slice(0, html.indexOf("history-daily-truncated"));
  assert.match(completeRange, /metric\.cost|Native cost/);
});
```

- [ ] **Step 5: Run the tests and commit**

Run: `node --import tsx --test tests/unit/report-range.test.ts tests/unit/html-bundle.test.ts && npm test`
Expected: PASS.

```bash
git add src/ui/range.ts src/ui/html.ts src/ui/bundle.ts tests/unit/report-range.test.ts tests/unit/html-bundle.test.ts
git commit -m "feat: filter every tab through one range projection with honest aggregate membership"
```

---

### Task 10: RETIRED as a derivation task — child-run usage fraction only

> **RETIRED as written — `readAgentFailure`, the model/thinking grammars and the
> DTO validation are already on `main`** (`src/integrations/subagents.ts`,
> `projectAgent`). Do **not** re-implement `readFailure`, `MODEL_TOKEN`,
> `THINKING_LEVELS` or `PROCESS_SIGNAL`; they exist and are stricter than the
> sketch below.
>
> The only genuine gap left by spec §6.3 (row 11) and §7.2 is the **usage
> fraction**, so this task is reduced to it:
>
> **Files:** `src/integrations/subagents.ts` (`runsWithUsage` on `SubagentEvidence`),
> `src/core/reports.ts` (`agentUsage` validated on `SessionReport`),
> `src/ui/load-current.ts` + `src/ui/load-history.ts` (pass the evidence through),
> tests `tests/unit/subagents.test.ts`, `tests/unit/reports-integrations.test.ts`,
> `tests/unit/bundle.test.ts`.
>
> **Interfaces:** `SubagentEvidence.runsWithUsage: number`;
> `SessionReport.agentUsage: { runsTotal: number; runsWithUsage: number }`
> (re-validated: both counts are saturated non-negative safe integers, and
> `runsWithUsage <= runsTotal`).
>
> **Steps:**
>
> 1. Failing test: a `subagent` result publishing three runs where two carry
>    `usage` ⇒ `evidence.runsWithUsage === 2`; a report built from it carries
>    `agentUsage: { runsTotal: 3, runsWithUsage: 2 }`; a run set with no usage
>    yields `runsWithUsage: 0` **and the renderer must read that as `Unavailable`,
>    never `$0.00`** (Task 12 asserts the rendering).
> 2. Implement `runsWithUsage` in `deriveEvidence` (count runs with a projected
>    `usage`) and project it in `toSessionReport` with the saturation rule above.
> 3. Assert a hostile payload (`runsWithUsage: -1`, `1e9`, `"2"`) is rejected or
>    saturated, never echoed.
> 4. `npm run format:check && npm run lint && npm run typecheck && npm test`.
> 5. Commit: `feat: report child-run usage coverage on the agent evidence`.

**Historic task body (do not execute):**

**Files:**

- Modify: `src/integrations/subagents.ts`, `src/core/reports.ts`
- Test: `tests/unit/subagents.test.ts`, `tests/unit/reports-integrations.test.ts`

**Interfaces:**

- Consumes: `details.results[]` rows, `AgentRun` (Task 4).
- Produces: `AgentRun.model`, `AgentRun.thinking`, `AgentRun.failure`, `SessionReport.agentUsage`.

- [ ] **Step 1: Write the failing test**

```ts
// append to tests/unit/subagents.test.ts
test("validated child model, thinking level and failure class are projected", () => {
  const evidence = readSubagentEvidence([resultEntry({ results: [
    { index: 0, agent: "delegate", model: "deepseek/deepseek-flash:low", thinking: "low", exitCode: 0, outputState: "present" },
    { index: 1, agent: "worker", model: "not a model!", thinking: "hyper", exitCode: 137, processSignal: "SIGKILL" },
    { index: 2, agent: "reviewer", state: "failed", success: false, outputState: "absent" },
    { index: 3, agent: "x", task: "SECRET TASK TEXT", finalOutput: "SECRET OUTPUT" },
  ] })]);
  assert.deepEqual(evidence.runs.map((run) => [run.model, run.thinking]), [
    ["deepseek/deepseek-flash:low", "low"],
    [undefined, undefined],
    [undefined, undefined],
    [undefined, undefined],
  ]);
  assert.deepEqual(evidence.runs[1]?.failure, { reason: "process-signal", detail: "SIGKILL" });
  assert.deepEqual(evidence.runs[2]?.failure, { reason: "completion-failed" });
  assert.equal(evidence.runs[3]?.failure, undefined);
  assert.doesNotMatch(JSON.stringify(evidence), /SECRET/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --import tsx --test tests/unit/subagents.test.ts`
Expected: FAIL — `model`/`thinking`/`failure` are undefined.

- [ ] **Step 3: Implement validated derivations**

```ts
// src/integrations/subagents.ts
const MODEL_TOKEN = /^[A-Za-z0-9][A-Za-z0-9._:/+-]{0,95}$/;
const THINKING_LEVELS = new Set(["off", "minimal", "low", "medium", "high", "xhigh", "max"]);
const PROCESS_SIGNAL = /^SIG[A-Z]{2,10}$/;

type AgentFailure = { reason: "exit-nonzero" | "process-signal" | "completion-failed" | "output-absent"; detail?: number | string };

function readFailure(record: Readonly<Record<string, unknown>>): AgentFailure | undefined {
  if (typeof record.processSignal === "string" && PROCESS_SIGNAL.test(record.processSignal)) {
    return { reason: "process-signal", detail: record.processSignal };
  }
  if (typeof record.exitCode === "number" && Number.isSafeInteger(record.exitCode) && record.exitCode !== 0) {
    return { reason: "exit-nonzero", detail: record.exitCode };
  }
  if (record.state === "failed" || record.success === false) return { reason: "completion-failed" };
  if (record.outputState === "absent") return { reason: "output-absent" };
  return undefined;
}
```

`pushRun` adds, all optional and validated:

```ts
    ...(typeof record.model === "string" && MODEL_TOKEN.test(record.model) ? { model: record.model } : {}),
    ...(typeof record.thinking === "string" && THINKING_LEVELS.has(record.thinking) ? { thinking: record.thinking } : {}),
    ...(failure === undefined ? {} : { failure }),
```

`src/core/reports.ts` validates them in `projectAgent` (string checks with the same regexes; `failure.reason` must be one of the four; `detail` must be a safe integer or a bounded `SIG*` token) and exposes the usage fraction:

```ts
export type SessionReport = { /* existing */
  /** Child-run usage coverage: the fraction is rendered, never extrapolated. */
  agentUsage: { runsTotal: number; runsWithUsage: number };
};
```

`toSessionReport` fills it from `projectedEvidence.agents.runs` (count of runs with `usage !== undefined`).

- [ ] **Step 4: Assert the DTO validation drops hostile values**

```ts
// append to tests/unit/reports-integrations.test.ts
test("agent model, thinking and failure are validated before projection", () => {
  const report = toSessionReport(reduced(), { agents: { state: "supported", runs: [
    { id: "subagent-" + "a".repeat(64), status: "failed", confidence: "cooperative", model: "constructor", thinking: "hyper", failure: { reason: "nope" } },
  ] }, agentActivity: unavailableActivity() });
  assert.equal(report.agents[0]?.model, undefined);
  assert.equal(report.agents[0]?.thinking, undefined);
  assert.equal(report.agents[0]?.failure, undefined);
  assert.deepEqual(report.agentUsage, { runsTotal: 1, runsWithUsage: 0 });
});
```

- [ ] **Step 5: Run the tests and commit**

Run: `node --import tsx --test tests/unit/subagents.test.ts tests/unit/reports-integrations.test.ts && npm test`
Expected: PASS.

```bash
git add src/integrations/subagents.ts src/core/reports.ts tests/unit/subagents.test.ts tests/unit/reports-integrations.test.ts
git commit -m "feat: project validated agent model, thinking level and bounded failure class"
```

---

### Task 11: Canonical browser projection integrity

**Files:**

- Modify: `src/ui/html.ts` — `sessionView` (~line 946), `toolRows` (~904),
  `agentRows` (~917), `modelRows` (~824), the inline error mapping inside
  `sessionView`
- Test: `tests/unit/html-bundle.test.ts`, `tests/unit/integration-privacy.test.ts`

**Interfaces:**

- Consumes: `SessionReport` with the agent fields `main` already derives (spec §0.3).
- Produces: one projection object per view with `tools[].timestamp`, `agents[]`
  (role/artifacts/observedAt/model/thinking/failure/evidenceToolId/usage/parentId),
  `errors[].toolName`/`toolSource`/`relatedChildIds`, `composition`, `agentUsage`.

> **Retargeted for v0.8.0.** `currentViewProjection`/`sectionProjection` already
> exist and are the projection boundary; the losses are inside the row builders.
> There is no separate `errorRows()` function — errors are mapped inline in
> `sessionView`, and that map is where the tool join lands (Task 14 extends it in
> the same place, so land them in the order given).

- [ ] **Step 1: Write the failing test**

```ts
// append to tests/unit/html-bundle.test.ts
test("the browser projection keeps identity, time and role fields", async () => {
  const html = renderInspectorBundle(await loadInspectorBundle({ ...input, loadCurrent: async () => currentModelWithAgents() }));
  const projection = embedOf(html, "current") as { views: { active: { tools: unknown[]; agents: unknown[] } } };
  const active = projection.views.active;
  assert.deepEqual(Object.keys(active.tools[0] as object).sort(), ["durationMs", "id", "name", "source", "status", "timestamp", "usage"].filter((key) => key in (active.tools[0] as object)).sort());
  const agent = active.agents[0] as Record<string, unknown>;
  for (const key of ["agent", "artifacts", "observedAt", "model", "thinking", "evidenceToolId", "status", "confidence"]) {
    assert.ok(key in agent, key);
  }
  assert.doesNotMatch(html, /"task"|"finalOutput"|"progressSummary"|"transcriptPath"|"artifactPaths"|"sessionFile"/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --import tsx --test tests/unit/html-bundle.test.ts`
Expected: FAIL — tools lack `timestamp`, agents lack role/time fields.

- [ ] **Step 3: Extend the single server projection**

```ts
function toolRows(report: SessionReport): ToolRow[] {
  return report.tools.map((tool) => ({
    id: tool.id, name: tool.name, timestamp: tool.timestamp,
    ...(tool.source === undefined ? {} : { source: tool.source }),
    status: tool.status,
    usage: tool.usage === undefined ? null : safeUsage(tool.usage),
    durationMs: tool.durationMs ?? null,
  }));
}

function agentRows(report: SessionReport): AgentRow[] {
  return report.agents.map((agent) => ({
    id: agent.id,
    parentId: agent.parentId ?? null,
    agent: agent.agent ?? null,
    status: agent.status,
    confidence: agent.confidence,
    artifacts: agent.artifacts ?? null,
    observedAt: agent.observedAt ?? null,
    evidenceToolId: agent.evidenceToolId ?? null,
    model: agent.model ?? null,
    thinking: agent.thinking ?? null,
    failure: agent.failure ?? null,
    usage: agent.usage === undefined ? null : safeUsage(agent.usage),
  }));
}
```

`statusView`/`sessionView` return the composition and `agentUsage` unchanged in shape but now sourced from the canonical projection, and the client's table renderers read **only** these rows (no `report.*` access for tables):

```js
function agentsTable(view){ /* columns: Role | Status | Model | Tokens | Cost | Artifacts | Parent */ }
function toolsCallsTable(view){ /* columns: Time (from row.timestamp) | Tool | Source | Status | Tokens | Cost | Duration */ }
```

- [ ] **Step 4: Assert no lossy or dangerous field survives**

```ts
test("tool and error rows carry their own timestamps", async () => {
  const html = renderInspectorBundle(await loadInspectorBundle({ ...input, loadCurrent: async () => currentModelWithTools() }));
  const projection = embedOf(html, "current") as { views: { active: { tools: { timestamp: string }[]; errors: { timestamp: string }[] } } };
  assert.equal(projection.views.active.tools[0]?.timestamp, "2026-03-01T10:00:00.000Z");
  assert.equal(projection.views.active.errors[0]?.timestamp, "2026-03-01T10:05:00.000Z");
});
```

- [ ] **Step 5: Run the tests and commit**

Run: `node --import tsx --test tests/unit/html-bundle.test.ts tests/unit/integration-privacy.test.ts && npm test`
Expected: PASS.

```bash
git add src/ui/html.ts tests/unit/html-bundle.test.ts tests/unit/integration-privacy.test.ts
git commit -m "feat: preserve agent role, observation time and tool timestamps in the browser projection"
```

---

### Task 12: Agents tab semantics — child runs vs agent tool activity

**Files:**

- Modify: `src/ui/html.ts` (client `agentsPanel`, ~line 1351)
- Test: `tests/unit/html-bundle.test.ts`

> **Retargeted for v0.8.0.** `agentsPanel` already renders both blocks in one
> panel: the activity block first, headed by the `metric.agentCalls` label — that
> label is the defect. The fix is the copy and the ordering, not a new panel.

**Interfaces:**

- Consumes: projection `agents`, `agentActivity`, `agentUsage`.
- Produces: catalog keys `agents.childRuns`, `agents.succeeded`, `agents.failed`, `agents.interrupted`, `agents.running`, `agents.unknown`, `agents.knownTokens`, `agents.knownCost`, `agents.knownFailedCost`, `agents.usageFraction`, `panel.agentActivity`, `agents.relatedChildren`, `agents.parentOutsideScope`, `agents.parentUnknown`; panel behaviour described below.

- [ ] **Step 1: Write the failing test**

```ts
// append to tests/unit/html-bundle.test.ts
test("the agents panel separates child runs from native tool activity", async () => {
  const html = renderInspectorBundle(await loadInspectorBundle({ ...input, loadCurrent: async () => modelWithActivityAndRuns({ calls: 174, runs: 23, runsWithUsage: 18 }) }));
  assert.match(html, /Child runs/);
  assert.match(html, /Agent tool activity/);
  assert.match(html, /18 of 23 runs reported usage/);
  assert.doesNotMatch(html, /"label":"Agent calls"/);
});

test("a running or unknown child run keeps its own bucket", async () => {
  const html = renderInspectorBundle(await loadInspectorBundle({ ...input, loadCurrent: async () => modelWithStatuses(["succeeded", "failed", "interrupted", "running", "unknown"]) }));
  for (const label of ["Succeeded", "Failed", "Interrupted", "Running", "Unknown"]) assert.match(html, new RegExp(label));
  assert.match(html, /Child runs/);
});

test("an error on a tool that published three runs lists them under Related child run(s)", async () => {
  const html = renderInspectorBundle(await loadInspectorBundle({ ...input, loadCurrent: async () => modelWithErrorAndThreeChildren() }));
  assert.match(html, /Related child run\(s\)/);
  assert.equal((html.match(/data-child-link=/g) ?? []).length, 3);
  assert.doesNotMatch(html, /caused by/);
});

test("a parent outside the selected projection is labelled, never linked by hash", async () => {
  const html = renderInspectorBundle(await loadInspectorBundle({ ...input, loadCurrent: async (scope) => scope === "active" ? modelWithOrphanChild() : modelWithOrphanChildAndParent() }));
  assert.match(html, /Parent: outside selected scope|agents.parentOutsideScope/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --import tsx --test tests/unit/html-bundle.test.ts`
Expected: FAIL — the panel still labels native calls as the agent summary.

- [ ] **Step 3: Rebuild the panel**

```js
function agentsPanel(view,title){
  var wrap=el("div","");
  // 1. Primary summary: child runs only
  if(view.agentEvidence==="supported"){
    var counts={succeeded:0,failed:0,interrupted:0,running:0,unknown:0};
    view.agents.forEach(function(run){counts[run.status]=(counts[run.status]||0)+1;});
    var total=view.agents.length;
    var withUsage=view.agentUsage.runsWithUsage;
    var tokens=view.agents.reduce(function(sum,run){return sum+(run.usage?run.usage.totalTokens:0);},0);
    var cost=view.agents.reduce(function(sum,run){return sum+(run.usage?run.usage.cost:0);},0);
    var failedCost=view.agents.filter(function(run){return run.status==="failed";}).reduce(function(sum,run){return sum+(run.usage?run.usage.cost:0);},0);
    var metrics=el("div","metrics");
    metrics.append(metric(tr("agents.childRuns"),number(total),null,[]));
    ["succeeded","failed","interrupted","running","unknown"].forEach(function(status){
      if(counts[status]>0)metrics.append(metric(tr("agents."+status),number(counts[status]),null,[]));
    });
    var qualifier=withUsage===total?null:tr("agents.usageFraction",{withUsage:withUsage,total:total});
    metrics.append(metric(withUsage===0?tr("unavailable.copy"):tr("agents.knownTokens"),withUsage===0?tr("unavailable.copy"):number(tokens),qualifier,[]));
    metrics.append(metric(withUsage===0?tr("unavailable.copy"):tr("agents.knownCost"),withUsage===0?tr("unavailable.copy"):money(cost),qualifier,[]));
    if(failedCost>0)metrics.append(metric(tr("agents.knownFailedCost"),money(failedCost),null,[]));
    var section=card(title,tr("agents.note"),badge(tr("evidence."+view.agentEvidence),confidenceTone(view.agentEvidence)));
    section.append(metrics,agentsTable(view));
    wrap.append(section);
  } else {
    wrap.append(unavailableCard(title,tr("unavailable.copy")));
  }
  // 2. Secondary, clearly separate: native agent tool activity
  var activity=view.agentActivity;
  if(activity&&activity.state==="supported"){
    var activityCard=card(tr("panel.agentActivity"),tr("agents.activity.note"),badge(tr("evidence."+activity.state),confidenceTone(activity.state)));
    activityCard.append(el("div","",number(activity.calls)+" "+tr("agents.calls")+" · "+tr("agents.succeeded")+": "+number(activity.succeeded)+" · "+tr("agents.failed")+": "+number(activity.failed)+" · "+tr("agents.interrupted")+": "+number(activity.interrupted)));
    if(activity.tools&&activity.tools.length>0)simpleTable(activityCard,[tr("table.tool"),tr("table.calls")],activity.tools.map(function(row){return [row.name,number(row.calls)];}));
    wrap.append(activityCard);
  }
  return wrap;
}
```

The `Related child run(s)` block lives in the tool-call detail (Task 14) and renders one anchor per run whose `evidenceToolId` equals the call id, labelled with the child's role (`delegate`, `worker`, …) or `Unavailable`, never with a causal phrase.

- [ ] **Step 4: Parent resolution helper**

```js
function parentCell(run,view,treeView){
  if(!run.parentId)return tr("unavailable.copy");
  var inScope=view.agents.some(function(item){return item.id===run.parentId;});
  if(inScope)return '<a href="'+routeFor({tab:"agents",entity:{kind:"agent",id:run.parentId}})+'">'+tr("table.parent")+"</a>";
  var inTree=treeView&&treeView.agents.some(function(item){return item.id===run.parentId;});
  return inTree?tr("agents.parentOutsideScope"):tr("agents.parentUnknown");
}
```

- [ ] **Step 5: Run the tests and commit**

Run: `node --import tsx --test tests/unit/html-bundle.test.ts && npm test`
Expected: PASS.

```bash
git add src/ui/html.ts tests/unit/html-bundle.test.ts
git commit -m "feat: split agent child-run metrics from native agent tool activity"
```

---

### Task 13: Tools summary and calls timeline

**Files:**

- Modify: `src/ui/html.ts` (client `detail()` tools branch → summary + calls)
- Test: `tests/unit/html-bundle.test.ts`

**Interfaces:**

- Consumes: projection `tools` (with `timestamp`, `usage`, `source`, `durationMs`).
- Produces: catalog keys `tools.summary`, `tools.calls`, `tools.lastUsed`, `tools.usageFraction`, `tools.filteredBy`, `tools.clearFilter`; internal `toolSummary(view)`, `toolCalls(view, nameFilter)`.

- [ ] **Step 1: Write the failing test**

```ts
test("tools summary aggregates and the calls view keeps timestamps", async () => {
  const html = renderInspectorBundle(await loadInspectorBundle({ ...input, loadCurrent: async () => currentModelWithTools() }));
  assert.match(html, /tools\.summary|Tools summary/);
  assert.match(html, /2026-03-01T10:00:00\.000Z/);
  assert.match(html, /tools\.lastUsed|Last used/);
});

test("usage coverage is stated when only some calls reported usage", async () => {
  const html = renderInspectorBundle(await loadInspectorBundle({ ...input, loadCurrent: async () => currentModelWithPartialToolUsage() }));
  assert.match(html, /1 of 3 calls reported usage/);
  assert.match(html, /Known tokens/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --import tsx --test tests/unit/html-bundle.test.ts`
Expected: FAIL — no summary/calls split.

- [ ] **Step 3: Implement both views over one projection**

```js
function toolSummary(view){
  var groups=new Map();
  view.tools.forEach(function(call){
    var row=groups.get(call.name)||{name:call.name,source:call.source||null,calls:0,succeeded:0,failed:0,interrupted:0,tokens:0,cost:0,withUsage:0,lastUsed:null};
    row.calls+=1;row[call.status]+=1;
    if(call.usage){row.withUsage+=1;row.tokens+=call.usage.totalTokens;row.cost=Math.round((row.cost+call.usage.cost)*1e6)/1e6;}
    if(!row.lastUsed||call.timestamp>row.lastUsed)row.lastUsed=call.timestamp;
    if(!row.source&&call.source)row.source=call.source;
    groups.set(call.name,row);
  });
  return Array.from(groups.values()).sort(function(a,b){return a.name.localeCompare(b.name);});
}
function toolCalls(view,filter){
  return view.tools.filter(function(call){return !filter||call.name===filter;})
    .slice().sort(function(a,b){return b.timestamp.localeCompare(a.timestamp);});
}
```

The summary table's rows are anchors that set the calls filter; the calls table renders `Time | Tool | Source | Status | Tokens | Cost | Duration` with `Unavailable` for missing usage/duration (duration only when `durationEvidence === "supported"`).

- [ ] **Step 4: Assert no arguments or result text leaks**

```ts
test("tool tables never render arguments or result bodies", async () => {
  const html = renderInspectorBundle(await loadInspectorBundle({ ...input, loadCurrent: async () => currentModelWithHostileToolArguments() }));
  assert.doesNotMatch(html, /SECRET_ARGUMENT|SECRET_RESULT/);
});
```

- [ ] **Step 5: Run the tests and commit**

Run: `node --import tsx --test tests/unit/html-bundle.test.ts && npm test`
Expected: PASS.

```bash
git add src/ui/html.ts tests/unit/html-bundle.test.ts
git commit -m "feat: add tools summary and calls timeline over the canonical projection"
```

---

### Task 14: Errors — deterministic joins and honest messages

**Files:**

- Modify: `src/ui/html.ts` (the error map in `sessionView` + the client errors
  branch), `src/ui/bundle.ts` (only if an error row must reach the bundle DTO)
- Test: `tests/unit/html-bundle.test.ts`, `tests/unit/error-ledger.test.ts`

**Interfaces:**

- Consumes: `report.errors`, `report.tools`, `report.agents[].evidenceToolId`.
- Produces: catalog keys `errors.toolFailed`, `errors.relatedTool`, `errors.relatedChildren`, `errors.messageUnavailable`, `errors.generation`; projection `errors[].toolName`, `.toolSource`, `.relatedChildIds`.

> **Retargeted for v0.8.0.** Error rows are built inside
> `src/ui/html.ts:sessionView`, not in `bundle.ts`; the join happens there with
> the report already in hand, so `bundle.ts` needs no change.

- [ ] **Step 1: Write the failing test**

```ts
test("a tool error renders the tool identity, not the internal id, as its headline", async () => {
  const html = renderInspectorBundle(await loadInspectorBundle({ ...input, loadCurrent: async () => modelWithToolError() }));
  assert.match(html, /bash failed/);
  assert.match(html, /tool-error/);
  assert.doesNotMatch(html, /<td[^>]*>tool:call_1</);
});

test("a tool error without a safe message says Unavailable", async () => {
  const html = renderInspectorBundle(await loadInspectorBundle({ ...input, loadCurrent: async () => modelWithToolError() }));
  assert.match(html, /errors\.messageUnavailable|Message: Unavailable/);
});

test("related child runs are one-to-many and never causal", async () => {
  const html = renderInspectorBundle(await loadInspectorBundle({ ...input, loadCurrent: async () => modelWithErrorAndThreeChildren() }));
  assert.equal((html.match(/data-child-link=/g) ?? []).length, 3);
  assert.doesNotMatch(html, /caused|cause of/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --import tsx --test tests/unit/html-bundle.test.ts`
Expected: FAIL — the errors table's first column is the raw id.

- [ ] **Step 3: Join by id and project the friendly fields**

```ts
// src/ui/bundle.ts — error rows are built next to the agent rows so the join happens once
function errorRows(report: SessionReport): ErrorRow[] {
  const toolById = new Map(report.tools.map((tool) => [tool.id, tool]));
  const childIds = new Map<string, string[]>();
  for (const run of report.agents) {
    if (run.evidenceToolId === undefined) continue;
    const list = childIds.get(run.evidenceToolId) ?? [];
    list.push(run.id);
    childIds.set(run.evidenceToolId, list);
  }
  return report.errors.map((error) => {
    const tool = toolById.get(error.id);
    return {
      id: error.id,
      timestamp: error.timestamp,
      kind: error.kind,
      confidence: error.confidence,
      message: error.message ?? null,
      ...(tool === undefined ? {} : { toolName: tool.name, toolSource: tool.source ?? null }),
      ...(childIds.get(error.id) === undefined ? {} : { relatedChildIds: childIds.get(error.id) as string[] }),
    };
  });
}
```

```js
function errorsTable(view){
  var rows=view.errors.map(function(error){
    var headline=error.toolName?error.toolName+" "+tr("errors.failed"):error.kind;
    var detail=el("div","error-detail");
    if(error.toolName)detail.append(el("div","",tr("errors.relatedTool")+": "+error.toolName));
    if(error.relatedChildIds)detail.append(el("div","",tr("errors.relatedChildren")+": "+error.relatedChildIds.map(function(id){
      return '<a data-child-link="'+id+'" href="'+routeFor({tab:"agents",entity:{kind:"agent",id:id}})+'">'+childLabel(id)+"</a>";}).join(" · ")));
    detail.append(el("div","",tr("errors.message")+": "+(error.message||tr("errors.messageUnavailable"))));
    return [headline,error.timestamp,error.kind,detail.outerHTML,badge(tr("evidence."+error.confidence),confidenceTone(error.confidence))];
  });
  return table(title,tr("errors.note"),[tr("table.error"),tr("table.timestamp"),tr("table.kind"),tr("table.detail"),tr("table.confidence")],rows);
}
```

- [ ] **Step 4: Keep generation-error messages and prove no result text leaks**

```ts
test("a generation error keeps its bounded redacted message", async () => {
  const html = renderInspectorBundle(await loadInspectorBundle({ ...input, loadCurrent: async () => modelWithGenerationError("Request failed at [URL]") }));
  assert.match(html, /Request failed at \[URL\]/);
});

test("error details never contain tool result bodies", async () => {
  const html = renderInspectorBundle(await loadInspectorBundle({ ...input, loadCurrent: async () => modelWithHostileToolResult() }));
  assert.doesNotMatch(html, /SECRET_RESULT/);
});
```

- [ ] **Step 5: Run the tests and commit**

Run: `node --import tsx --test tests/unit/html-bundle.test.ts tests/unit/error-ledger.test.ts && npm test`
Expected: PASS.

```bash
git add src/ui/html.ts src/ui/bundle.ts tests/unit/html-bundle.test.ts tests/unit/error-ledger.test.ts
git commit -m "feat: present tool errors by identity with deterministic one-to-many child links"
```

---

### Task 15: Environment grouping and the four-column integration model

**Files:**

- Modify: `src/ui/html.ts` (tab strip, environment panel, integrations panel)
- Test: `tests/unit/html-bundle.test.ts`

**Interfaces:**

- Consumes: projection `commands`, `skills`, `resources`, `integrations`.
- Produces: catalog keys `tab.environment`, `env.commands`, `env.skills`, `env.resources`, `env.available`, `env.observed`, `env.invocationsUnavailable`, `env.invocationsObserved`, `env.sources`, `env.search`, `integration.detected`, `integration.telemetry`, `integration.activity`, `integration.version`, `integration.sessionTotal`, `integration.reasonUnsupported`, `integration.reasonMissing`, `integration.noteNotDetected`; the capability table maps `commands`/`skills`/`resources` into one `environment` tab with sub-sections.

- [ ] **Step 1: Write the failing test**

```ts
test("inventory renders as environment with no activity claim", async () => {
  const html = renderInspectorBundle(await loadInspectorBundle({ ...input, loadCurrent: async () => modelWithInventory() }));
  assert.match(html, /Available: 119/);
  assert.match(html, /Observed invocations: Unavailable/);
  assert.match(html, /Explicit invocations observed: 3/);
  assert.doesNotMatch(html, /119 (used|invoked|calls)/);
});

test("integrations render four independent columns", async () => {
  const html = renderInspectorBundle(await loadInspectorBundle({ ...input, loadCurrent: async () => modelWithIntegrations() }));
  assert.match(html, /Detected/);
  assert.match(html, /Telemetry/);
  assert.match(html, /Activity/);
  assert.match(html, /Version/);
  assert.match(html, /Session total/);
});

test("an absent producer with persisted telemetry stays a valid row", async () => {
  const html = renderInspectorBundle(await loadInspectorBundle({ ...input, loadCurrent: async () => modelWithAbsentDetectedTelemetry() }));
  assert.match(html, /no telemetry observed in this session|no compatible telemetry evidence/);
  assert.match(html, /producer not detected in current inventory/);
  assert.doesNotMatch(html, /"state":"unavailable","presence":"absent"/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --import tsx --test tests/unit/html-bundle.test.ts`
Expected: FAIL — inventory still renders as three activity-shaped tabs and integrations have no telemetry reason.

- [ ] **Step 3: Build the Environment panel and the integration table**

```js
function environmentPanel(view,title){
  var wrap=el("div","");
  var counts={commands:view.commands,skills:view.skills,resources:view.resources};
  var summary=card(title,tr("env.note"),null);
  summary.append(el("div","",tr("env.commands")+": "+tr("env.available")+": "+countText(counts.commands.count)+
    " · "+tr("env.observed")+": "+(counts.commands.state==="supported"?number(counts.commands.count):tr("env.invocationsUnavailable"))));
  summary.append(el("div","",tr("env.skills")+": "+tr("env.available")+": "+countText(counts.skills.count)+
    " · "+(counts.skills.invocationState==="supported"?tr("env.invocationsObserved")+": "+number(counts.skills.invocationCount):tr("env.observed")+": "+tr("env.invocationsUnavailable"))));
  summary.append(el("div","",tr("env.resources")+": "+tr("env.sources")+": "+number(counts.resources.items.length)));
  wrap.append(summary);
  wrap.append(environmentTable(tr("env.commands"),counts.commands.items));
  wrap.append(environmentTable(tr("env.skills"),counts.skills.items));
  wrap.append(resourceTable(counts.resources.items));
  return wrap;
}
function countText(value){return value===null?tr("unavailable.copy"):number(value);}
```

```js
function integrationsTable(view){
  var rows=view.integrations.map(function(row){
    var reason=row.state==="unsupported"?tr("integration.reasonUnsupported"):row.state==="unavailable"?tr("integration.reasonMissing"):null;
    var activity=row.counters&&row.counters.length?row.counters.map(function(pair){return pair;}).join(" · ")+" ("+tr("integration.sessionTotal")+")":tr("unavailable.copy");
    var note=row.presence==="absent"?tr("integration.noteNotDetected"):null;
    return [row.integration,tr("presence."+row.presence),reason?(tr("evidence."+row.state)+" — "+reason):tr("evidence."+row.state),activity,row.version===null?tr("unavailable.copy"):number(row.version),note||""];
  });
  return table(tr("tab.integrations"),tr("integrations.note"),[tr("table.integration"),tr("integration.detected"),tr("integration.telemetry"),tr("integration.activity"),tr("integration.version"),""],rows);
}
```

- [ ] **Step 4: Assert the capability table drops the old tabs**

```ts
test("capabilities expose environment instead of three inventory tabs", async () => {
  const html = renderInspectorBundle(await loadInspectorBundle({ ...input, loadCurrent: async () => modelWithInventory() }));
  const capabilities = embedCapabilitiesOf(html);
  assert.ok(capabilities.current.includes("environment"));
  for (const tab of ["commands", "skills"]) assert.ok(!capabilities.current.includes(tab), tab);
});
```

- [ ] **Step 5: Run the tests and commit**

Run: `node --import tsx --test tests/unit/html-bundle.test.ts && npm test`
Expected: PASS.

```bash
git add src/ui/html.ts tests/unit/html-bundle.test.ts
git commit -m "feat: group inventory under environment and split integration detection from telemetry"
```

---

### Task 16: Pure route module — parse, serialize, and derive the view model

**Files:**

- Create: `src/ui/route.ts`
- Test: `tests/unit/route.test.ts` (new)

**Interfaces:**

- Consumes: `RangeState`, `parseRangeQuery`, `serializeRangeQuery` (Task 8).
- Produces: `EntityRef`, `InspectorRoute`, `parseRoute`, `serializeRoute`, `routeKey`, `deriveView` (Shared interfaces).

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/route.test.ts
import assert from "node:assert/strict";
import { test } from "node:test";
import { deriveView, parseRoute, routeKey, serializeRoute, type InspectorRoute } from "../../src/ui/route.ts";

const capabilities = { current: ["overview", "models", "tools", "environment", "agents", "integrations", "errors", "ledger"], history: ["overview"], global: ["overview"] };
const observed = ["2026-09-01", "2026-09-11", "2026-09-12"];
const defaults = { scope: "active" as const, capabilities, knownIds: new Set(["tool:call_abc", "tool:call_1"]) };

test("a route round-trips with the canonical parameter order", () => {
  const route: InspectorRoute = {
    section: "current", tab: "tools", scope: "tree",
    range: { kind: "preset", preset: 7 },
    entity: { kind: "tool", id: "tool:call_abc" },
    table: { query: "bash", sort: "cost" },
  };
  const hash = serializeRoute(route);
  assert.equal(hash, "#/current/tools?scope=tree&preset=7&entity=tool%3Atool%3Acall_abc&q=bash&sort=cost");
  assert.deepEqual(parseRoute(hash, defaults).route, route);
  assert.equal(routeKey(parseRoute(hash, defaults).route), hash);
});

test("a preset deep link resolves against the view's dates, exactly like the selector", () => {
  const { route } = parseRoute("#/current/tools?scope=tree&preset=7", defaults);
  assert.deepEqual(route.range, { kind: "preset", preset: 7 });
  assert.deepEqual(resolveRange(route.range, observed, "current"), presetRange(7, observed));
  assert.equal(serializeRoute(route), "#/current/tools?scope=tree&preset=7"); // no dates baked in
  const view = deriveView(route, capabilities, observed);
  assert.deepEqual(view.range, presetRange(7, observed));
  assert.deepEqual(view.range, resolveRange({ kind: "preset", preset: 7 }, observed, "current"));
});

test("a view with no observed dates has no range at all", () => {
  const { route } = parseRoute("#/current/tools", defaults);
  const view = deriveView(route, capabilities, []);
  assert.equal(view.range, undefined);
  assert.doesNotMatch(serializeRoute(route), /1970-01-01/);
});

test("a custom range serializes both endpoints and restores exactly", () => {
  const route: InspectorRoute = { section: "current", tab: "tools", scope: "tree", range: { kind: "custom", from: "2026-09-01", to: "2026-09-12" } };
  const hash = serializeRoute(route);
  assert.equal(hash, "#/current/tools?scope=tree&from=2026-09-01&to=2026-09-12");
  assert.deepEqual(parseRoute(hash, defaults).route.range, route.range);
});

test("an invalid or lone range endpoint falls back with a notice", () => {
  const lone = parseRoute("#/current/tools?from=2026-09-01", defaults);
  assert.equal(lone.route.range, undefined);
  assert.equal(lone.notice, "range-restored");
  const inverted = parseRoute("#/current/tools?from=2026-09-12&to=2026-09-01", defaults);
  assert.equal(inverted.route.range, undefined);
  assert.equal(inverted.notice, "range-restored");
  const badPreset = parseRoute("#/current/tools?preset=99", defaults);
  assert.equal(badPreset.route.range, undefined);
  assert.equal(badPreset.notice, "range-restored");
});

test("unsupported tabs and sections degrade with a notice", () => {
  const global = parseRoute("#/global/models", defaults);
  assert.equal(global.route.tab, "overview");
  assert.equal(global.notice, "tab-unavailable");
  const unknown = parseRoute("#/nope/overview", defaults);
  assert.equal(unknown.route.section, "current");
  assert.equal(unknown.notice, "section-unavailable");
});

test("unknown ids are dropped, never echoed", () => {
  const parsed = parseRoute("#/current/tools?entity=agent%3ASECRET%20TEXT", defaults);
  assert.equal(parsed.route.entity, undefined);
});

test("deriveView exposes exactly the state that drives rendering", () => {
  const route: InspectorRoute = { section: "global", tab: "models", scope: "tree", range: { kind: "preset", preset: 30 } };
  const view = deriveView(route, capabilities, observed);
  assert.equal(view.activeSection, "global");
  assert.equal(view.activeTab, "overview");
  assert.deepEqual(view.visibleTabs, ["overview"]);
  assert.deepEqual(view.range, presetRange(30, observed));
  assert.equal(view.notice, "tab-unavailable");
  assert.equal(view.focusTarget, "section-heading");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --import tsx --test tests/unit/route.test.ts`
Expected: FAIL — cannot resolve `../../src/ui/route.ts`.

- [ ] **Step 3: Implement the module**

```ts
// src/ui/route.ts
/**
 * Pure offline routing for the single generated document. Inlined verbatim into
 * the HTML (Task 17), so it must stay dependency-free and DOM-free.
 */
import { parseRangeQuery, resolveRange, serializeRangeQuery, type RangeIntent, type RangeState } from "./range.ts";

export type EntityRef = { kind: "model" | "tool" | "agent" | "error" | "integration" | "command" | "skill" | "resource"; id: string };
export type InspectorRoute = {
  section: "current" | "history" | "global";
  tab: string;
  session?: string;
  scope: Scope;
  /** Absent = the view default (full observed span for current, 14D for aggregates). */
  range?: RangeIntent;
  entity?: EntityRef;
  table?: { query?: string; sort?: string };
};

// NOTE: as in `src/ui/range.ts`, every exported function is inlined into the
// document by name (Task 17), so each one declares its own local constants and
// relies on nothing from module scope.

export function serializeRoute(route: InspectorRoute): string {
  const PARAM_ORDER = ["scope", "preset", "from", "to", "session", "entity", "q", "sort"] as const;
  const params: [string, string][] = [];
  if (route.section === "current") params.push(["scope", route.scope]);
  // A preset stays an unresolved intent: only `preset=<n>` is written, never dates.
  if (route.range !== undefined) for (const pair of serializeRangeQuery(route.range)) params.push(pair);
  if (route.session !== undefined) params.push(["session", route.session]);
  if (route.entity !== undefined) params.push(["entity", `${route.entity.kind}:${route.entity.id}`]);
  if (route.table?.query) params.push(["q", route.table.query]);
  if (route.table?.sort) params.push(["sort", route.table.sort]);
  const ordered = params
    .slice()
    .sort(([a], [b]) => PARAM_ORDER.indexOf(a) - PARAM_ORDER.indexOf(b));
  const query = ordered.map(([key, value]) => `${key}=${encodeURIComponent(value)}`).join("&");
  return `#/${route.section}/${route.tab}${query === "" ? "" : `?${query}`}`;
}

export function routeKey(route: InspectorRoute): string {
  return serializeRoute(route);
}

export function parseRoute(hash: string, defaults: {...}): { route: InspectorRoute; notice?: string } {
  const SECTIONS: readonly string[] = ["current", "history", "global"];
  const raw = hash.replace(/^#\/?/, "");
  const [pathPart = "", queryPart = ""] = raw.split("?");
  const [sectionText = "", tabText = ""] = pathPart.split("/");
  let notice: string | undefined;
  let section = (SECTIONS as readonly string[]).includes(sectionText) ? (sectionText as InspectorRoute["section"]) : "current";
  if (section !== sectionText) notice = "section-unavailable";
  const allowed = defaults.capabilities[section] ?? [];
  let tab = tabText === "" ? (allowed[0] ?? "overview") : tabText;
  if (!allowed.includes(tab)) {
    tab = allowed[0] ?? "overview";
    notice = "tab-unavailable";
  }
  const parsedRange = parseRangeQuery(queryPart);
  const params = new URLSearchParams(queryPart);
  if (parsedRange === undefined && (params.has("from") || params.has("to") || params.has("preset"))) notice = "range-restored";
  const scopeText = params.get("scope");
  const scope = scopeText === "tree" || scopeText === "active" ? scopeText : defaults.scope;
  const session = params.get("session") ?? undefined;
  const entityText = params.get("entity");
  let entity: EntityRef | undefined;
  if (entityText !== undefined) {
    const index = entityText.indexOf(":");
    const kind = entityText.slice(0, index) as EntityRef["kind"];
    const id = entityText.slice(index + 1);
    const known = defaults.knownIds === undefined || defaults.knownIds.has(id);
    if (index > 0 && id !== "" && known) entity = { kind, id };
  }
  const query = params.get("q") ?? undefined;
  const sort = params.get("sort") ?? undefined;
  return {
    route: {
      section, tab, scope,
      ...(parsedRange === undefined ? {} : { range: parsedRange }),
      ...(section === "history" && session !== undefined ? { session } : {}),
      ...(entity === undefined ? {} : { entity }),
      ...(query === undefined && sort === undefined ? {} : { table: { ...(query === undefined ? {} : { query }), ...(sort === undefined ? {} : { sort }) } }),
    },
    ...(notice === undefined ? {} : { notice }),
  };
}

export function deriveView(route: InspectorRoute, capabilities: {...}, dates: readonly string[]): {...} {
  const allowed = capabilities[route.section] ?? [];
  const tab = allowed.includes(route.tab) ? route.tab : (allowed[0] ?? "overview");
  // The preset becomes a concrete range only here, against this view's own dates.
  const range = resolveRange(route.range, dates, route.section === "current" ? "current" : "aggregate");
  return {
    activeSection: route.section,
    activeTab: tab,
    visibleTabs: allowed,
    scope: route.scope,
    ...(range === undefined ? {} : { range }),
    ...(route.entity === undefined ? {} : { entity: route.entity }),
    ...(tab === route.tab ? {} : { notice: "tab-unavailable" as const }),
    focusTarget: "section-heading",
  };
}
```

- [ ] **Step 4: Prove the hostile-value and idempotence properties**

```ts
test("deriveView never invents a tab outside the capability list", () => {
  for (const section of ["current", "history", "global"] as const) {
    const view = deriveView({ section, tab: "agents", scope: "tree" }, capabilities, observed);
    assert.ok(capabilities[section].includes(view.activeTab));
    assert.ok(view.visibleTabs.every((tab) => capabilities[section].includes(tab)));
  }
});

test("prompt text can never become a route parameter", () => {
  const hash = serializeRoute({ section: "current", tab: "tools", scope: "active" });
  assert.doesNotMatch(hash, /\s/);
  assert.doesNotMatch(hash, /SECRET/);
  assert.doesNotMatch(hash, /1970/);
});
```

- [ ] **Step 5: Run the tests and commit**

Run: `node --import tsx --test tests/unit/route.test.ts && npm run typecheck`
Expected: PASS.

```bash
git add src/ui/route.ts tests/unit/route.test.ts
git commit -m "feat: add the pure route module with capability-aware parsing and canonical serialization"
```

---

### Task 17: Client routing — inlined modules, one `applyLocation`, derived active state

**Files:**

- Modify: `src/ui/html.ts` (module inlining, client bootstrap, `render()` sync), `src/ui/bundle.ts` (capabilities in the payload)
- Test: `tests/unit/html-navigation.test.ts` (new), `tests/unit/html-bundle.test.ts`

**Interfaces:**

- Consumes: `src/ui/route.ts`, `src/ui/range.ts` (Tasks 8, 16).
- Produces: document script containing `const parseRoute = <source>` etc.; `applyLocation(reason)`, `navigate(route)`; capability table embedded as `data.capabilities`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/html-navigation.test.ts
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { renderInspectorBundle } from "../../src/ui/html.ts";
import type { InspectorBundle } from "../../src/ui/bundle.ts";

// `tests/unit/helpers/` does not exist yet: create this file in this task.
// Same fixture and same decoding pattern as `tests/unit/html-bundle.test.ts`.
function bundleFixture(): InspectorBundle {
  return JSON.parse(
    readFileSync(new URL("../fixtures/bundles/inspector-bundle.json", import.meta.url), "utf8"),
  ) as InspectorBundle;
}

test("the document inlines the same route and range modules the tests import", () => {
  const html = renderInspectorBundle(bundleFixture());
  assert.match(html, /const parseRoute=/);
  assert.match(html, /const serializeRoute=/);
  assert.match(html, /const filterView=/);
  assert.match(html, /const parseRangeQuery=/);
});

test("no active-state attribute is hardcoded in the initial markup", () => {
  const html = renderInspectorBundle(bundleFixture());
  const body = html.slice(html.indexOf("<body"));
  for (const attribute of ["aria-current", "aria-selected"]) {
    assert.ok(!new RegExp(`${attribute}=`).test(body), attribute);
  }
});

test("the document embeds the capability table", () => {
  const html = renderInspectorBundle(bundleFixture());
  const capabilities = /"capabilities":(\{.*?\})/.exec(html)?.[1] as string;
  const parsed = JSON.parse(capabilities) as Record<string, string[]>; // deterministic JSON, no functions
  assert.deepEqual(parsed.global, ["overview"]);
  assert.ok(parsed.current.includes("environment"));
});

test("one event path handles hashchange and popstate without double rendering", () => {
  const html = renderInspectorBundle(bundleFixture());
  assert.match(html, /function applyLocation\(/);
  assert.equal((html.match(/addEventListener\("hashchange"/g) ?? []).length, 1);
  assert.equal((html.match(/addEventListener\("popstate"/g) ?? []).length, 1);
  assert.match(html, /if\(next===lastAppliedKey\)return/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --import tsx --test tests/unit/html-navigation.test.ts`
Expected: FAIL — the document has no route module and no inlining.

- [ ] **Step 3: Inline the pure modules and rebuild the client state**

```ts
// src/ui/html.ts
import { deriveView, parseRoute, routeKey, serializeRoute } from "./route.ts";
import { filterView, historyRowRange, isInRange, latestObservedDate, parseRangeQuery, presetRange, resolveRange, serializeRangeQuery, shiftUtcDay } from "./range.ts";
import type { RangeState } from "./range.ts";

/**
 * The browser runs the exact modules the tests import: each function's compiled
 * source is inlined into the single self-contained script. Every inlined function
 * must be self-contained (no module-scope constant), and adding a new pure helper
 * means adding it to this list. `assertInlinedModulesEvaluate()` below proves the
 * emitted source is complete and callable.
 */
const INLINED_FUNCTIONS = [
  shiftUtcDay, latestObservedDate, presetRange, resolveRange, isInRange,
  serializeRangeQuery, parseRangeQuery, filterView, historyRowRange,
  serializeRoute, routeKey, parseRoute, deriveView,
] as const;

function inlineModuleSource(): string {
  return INLINED_FUNCTIONS.map((fn) => String(fn)).join("\n");
}

/**
 * Evaluates the emitted source with no DOM and no imports, so an inlined function
 * that reaches for a module-scope constant fails here instead of in the browser.
 */
export function assertInlinedModulesEvaluate(): void {
  const source = `${inlineModuleSource()}\nreturn { parseRangeQuery, filterView, serializeRoute, parseRoute, deriveView };`;
  const api = new Function(source)() as {
    parseRangeQuery: (query: string) => RangeState | undefined;
    serializeRoute: (route: unknown) => string;
  };
  if (api.parseRangeQuery("from=2026-09-01&to=2026-09-12") === undefined) throw new Error("inlined range module is incomplete");
  const serialized = api.serializeRoute({ section: "current", tab: "tools", scope: "active", range: { kind: "preset", preset: 7 } });
  if (!serialized.startsWith("#/current/tools?")) throw new Error("inlined route module is incomplete");
}

const BUNDLE_SCRIPT = String.raw`
${inlineModuleSource()}
const TABS=...;                // unchanged list, now sourced from data.capabilities
const CAPABILITIES=data.capabilities;
const EPHEMERAL={ranges:{},tables:{}};
let lastAppliedKey=null;
function navigate(next){location.hash=serializeRoute(next);}
function applyLocation(){
  const parsed=parseRoute(location.hash,{scope:data.initialScope,capabilities:CAPABILITIES,knownIds:knownIds()});
  const next=parsed.route;
  const key=routeKey(next);
  if(key===lastAppliedKey)return;      // hashchange + popstate coalesce to one render
  const previous=lastAppliedKey;lastAppliedKey=key;
  state.route=next;state.notice=parsed.notice;
  state.ranges[next.section]=next.range;
  if(previous!==null&&previous.split("?")[0]===key.split("?")[0])state.keepFocus=true;
  render();
}
addEventListener("hashchange",applyLocation);
addEventListener("popstate",applyLocation);
`;
```

`render()` now reads everything from `state.route` through `deriveView`, and sets `aria-current`/`aria-selected`/`aria-pressed` exclusively from the derived view model:

```js
function render(){
  const view=deriveView(state.route,CAPABILITIES,activeDates());
  state.notice=view.notice||state.notice;
  [].slice.call(document.querySelectorAll("[data-section]")).forEach(function(node){node.setAttribute("aria-current",node.dataset.section===view.activeSection?"page":"false");});
  [].slice.call(document.querySelectorAll("[data-tab]")).forEach(function(node){
    const capable=view.visibleTabs.indexOf(node.dataset.tab)>=0;
    node.hidden=!capable;
    node.setAttribute("aria-selected",String(capable&&node.dataset.tab===view.activeTab));
  });
  scopeButtons.forEach(function(button){button.setAttribute("aria-pressed",String(button.dataset.scope===view.scope));});
  /* content render uses filterView(currentRows(view.activeTab), view.range) and historyRowRange for the session list;
     when view.range is undefined (nothing observed) the section renders its empty/unavailable state instead of filtering */
  if(!state.keepFocus)focusSection();
  state.keepFocus=false;
  announce(view,state.notice);
}
```

- [ ] **Step 4: Assert the derived-state and capability contract**

```ts
test("the emitted script is complete and callable without a DOM", () => {
  // Throws if any inlined function depends on module scope that was not inlined.
  assert.doesNotThrow(() => assertInlinedModulesEvaluate());
});

test("a deep link renders the capable tab and the matching active state", () => {
  const html = renderInspectorBundle(bundleFixture());
  const script = html.slice(html.indexOf("function render()"));
  assert.match(script, /aria-current/);
  assert.match(script, /node\.hidden=!capable/);
  assert.doesNotMatch(html, /class="nav-button active"/);
});

test("the restored-range notice is present in the catalog", () => {
  const html = renderInspectorBundle(bundleFixture());
  assert.match(html, /Range could not be restored; showing the default range\./);
});
```

- [ ] **Step 5: Run the tests and commit**

Run: `node --import tsx --test tests/unit/html-navigation.test.ts tests/unit/html-bundle.test.ts && npm test`
Expected: PASS.

```bash
git add src/ui/html.ts src/ui/bundle.ts tests/unit/html-navigation.test.ts tests/unit/html-bundle.test.ts
git commit -m "feat: drive the document from one inlined route with derived active state"
```

---

### Task 18: Cross-navigation links and entity focus

**Files:**

- Modify: `src/ui/html.ts`
- Test: `tests/unit/html-navigation.test.ts`

**Interfaces:**

- Consumes: `serializeRoute`/`deriveView` (Tasks 16-17), projection entity ids.
- Produces: `routeFor(patch)` client helper; `:target`-style highlight; catalog key `nav.entityFocus`.

- [ ] **Step 1: Write the failing test**

```ts
test("overview rows link to their destination with context preserved", () => {
  const html = renderInspectorBundle(bundleFixture());
  assert.match(html, /href="#\/current\/models\?scope=/);
  assert.match(html, /href="#\/current\/tools\?/);
  assert.match(html, /entity=tool%3A/);
});

test("no Agent to Models link exists", () => {
  const html = renderInspectorBundle(bundleFixture());
  const agentBlock = html.slice(html.indexOf("function agentsTable"), html.indexOf("function toolsCallsTable"));
  assert.doesNotMatch(agentBlock, /#\/current\/models/);
  assert.doesNotMatch(agentBlock, /entity=model/);
});

test("non-linked labels are not anchors", () => {
  const html = renderInspectorBundle(bundleFixture());
  assert.doesNotMatch(html, /<a[^>]+>Coverage<\/a>/);
});

test("an entity anchor carries the id already present in the payload", () => {
  const html = renderInspectorBundle(bundleFixture());
  const ids = new Set([...html.matchAll(/"id":"((?:tool|subagent)[^"]+)"/g)].map((match) => match[1]));
  for (const match of html.matchAll(/entity=[^"&]*%3A([^"&]+)/g)) {
    assert.ok(ids.has(decodeURIComponent(match[1] as string)), match[1]);
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --import tsx --test tests/unit/html-navigation.test.ts`
Expected: FAIL — rows are plain text.

- [ ] **Step 3: Implement the links**

```js
function routeFor(patch){
  var next={section:state.route.section,tab:state.route.tab,scope:state.route.scope,range:state.route.range};
  for(var key in patch)next[key]=patch[key];
  return serializeRoute(next);
}
function entityId(kind,id){return 'data-entity="'+kind+':'+id+'"';}
function linkRow(kind,id,label){
  return '<a '+entityId(kind,id)+' href="'+routeFor({tab:tabFor(kind),entity:{kind:kind,id:id}})+'">'+label+"</a>";
}
function tabFor(kind){return kind==="model"?"models":kind==="tool"?"tools":kind==="agent"?"agents":kind==="error"?"errors":kind==="integration"?"integrations":"environment";}
```

Destination table (spec §9.4): overview model row → Models (entity focus), overview tool row → Tools summary, tool summary row → Tools calls filtered by tool, failed tool call → Errors (matching error), error row → related tool call or `Related child run(s)`, agent row → parent/child run, integration row → its detail panel, command/skill/resource row → the environment sub-section. After render, the focused entity gets a highlight class and `focus()` when the route changed:

```js
function focusEntity(view){if(!view.entity)return;var node=document.querySelector('[data-entity="'+view.entity.kind+':'+view.entity.id.replace(/"/g,"")+'"]');if(node){node.classList.add("entity-focus");if(!state.keepFocus)node.focus();}}
```

- [ ] **Step 4: Assert focus is reachable and visible**

```ts
test("focused entities are anchors with a visible focus style", () => {
  const html = renderInspectorBundle(bundleFixture());
  assert.match(html, /\.entity-focus\{/);
  assert.match(html, /classList\.add\("entity-focus"\)/);
});
```

- [ ] **Step 5: Run the tests and commit**

Run: `node --import tsx --test tests/unit/html-navigation.test.ts && npm test`
Expected: PASS.

```bash
git add src/ui/html.ts tests/unit/html-navigation.test.ts
git commit -m "feat: add cross-navigation links with entity focus and context preservation"
```

---

### Task 19: Span-aware argument scanning and raw-prefix completion values

**Files:**

- Modify: `src/commands/grammar.ts`, `src/commands/completions.ts`
- Test: `tests/unit/command-grammar.test.ts`, `tests/unit/command-completions.test.ts`

**Interfaces:**

- Consumes: existing grammar tables.
- Produces: `RawToken`, `scanInspectorArgs`; `tokenizeInspectorArgs` rewritten on top of it; completion `value`s become rewritten raw prefixes.

- [ ] **Step 1: Write the failing test**

```ts
// append to tests/unit/command-grammar.test.ts
test("scanned tokens carry raw spans including quotes", () => {
  const scanned = scanInspectorArgs('ui --output "/tmp/my report.json" --th');
  assert.ok(scanned);
  assert.deepEqual(scanned?.tokens.map((token) => [token.raw, token.start, token.end, token.quoted]), [
    ["ui", 0, 2, false],
    ["--output", 3, 11, false],
    ['"/tmp/my report.json"', 12, 35, true],
    ["--th", 36, 40, false],
  ]);
  assert.equal(scanned?.trailingWhitespace, false);
});

test("the stripped tokenizer stays derived from the scanned spans", () => {
  const scanned = scanInspectorArgs('json history --output "/tmp/a b.json" ');
  const tokenized = tokenizeInspectorArgs('json history --output "/tmp/a b.json" ');
  assert.deepEqual(tokenized?.tokens, ["json", "history", "--output", "/tmp/a b.json"]);
  assert.equal(tokenized?.trailingWhitespace, scanned?.trailingWhitespace);
});
```

```ts
// append to tests/unit/command-completions.test.ts
test("completion values rewrite the raw prefix instead of re-joining tokens", () => {
  const items = completeInspectorCommand('ui --output "/tmp/my report.json" --th');
  assert.deepEqual(items?.map((item) => item.value), ['ui --output "/tmp/my report.json" --theme']);
  assert.equal(items?.[0]?.label, "--theme");
});

test("a trailing space keeps the quotes and offers the next token", () => {
  const items = completeInspectorCommand('json history --output "/tmp/a b.json" ');
  assert.ok(items?.every((item) => item.value.startsWith('json history --output "/tmp/a b.json"')));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --import tsx --test tests/unit/command-grammar.test.ts tests/unit/command-completions.test.ts`
Expected: FAIL — `scanInspectorArgs` is not exported and values are bare tokens.

- [ ] **Step 3: Implement the scanner and derive the tokenizer**

```ts
// src/commands/grammar.ts
export type RawToken = { raw: string; start: number; end: number; quoted: boolean };

/**
 * One scanner serves both the parser and the completer: completions need the
 * original character spans, and a second scanner would let the two drift.
 * Returns undefined for an unterminated quote.
 */
export function scanInspectorArgs(prefix: string): { tokens: RawToken[]; trailingWhitespace: boolean } | undefined {
  const tokens: RawToken[] = [];
  let index = 0;
  let trailingWhitespace = false;
  while (index < prefix.length) {
    if (/\s/.test(prefix[index] as string)) {
      trailingWhitespace = true;
      index += 1;
      continue;
    }
    trailingWhitespace = false;
    const start = index;
    let raw = "";
    if (prefix[index] === '"') {
      const end = prefix.indexOf('"', index + 1);
      if (end < 0) return undefined;
      raw = prefix.slice(index, end + 1);
      index = end + 1;
    } else {
      while (index < prefix.length && !/\s/.test(prefix[index] as string)) index += 1;
      raw = prefix.slice(start, index);
    }
    tokens.push({ raw, start, end: index, quoted: raw.startsWith('"') });
  }
  return { tokens, trailingWhitespace };
}

export function tokenizeInspectorArgs(prefix: string): { tokens: string[]; trailingWhitespace: boolean } | undefined {
  const scanned = scanInspectorArgs(prefix);
  if (scanned === undefined) return undefined;
  return {
    tokens: scanned.tokens.map((token) => (token.quoted ? token.raw.slice(1, -1).replace(/""/g, '"') : token.raw)),
    trailingWhitespace: scanned.trailingWhitespace,
  };
}
```

```ts
// src/commands/completions.ts
/** Rewrites only the current raw token span; every preceding character survives. */
function withReplacement(prefix: string, span: { start: number; end: number }, replacement: string): string {
  return prefix.slice(0, span.start) + replacement + prefix.slice(span.end);
}

function items(values: readonly string[], prefix: string, span: { start: number; end: number }, label: (value: string) => string = (value) => value): AutocompleteItem[] | null {
  const matches = values.filter((value) => value.startsWith(replacementTarget(prefix, span)));
  if (matches.length === 0) return null;
  return matches.map((value) => ({ value: withReplacement(prefix, span, value), label: label(value) }));
}
```

`completeInspectorCommand(prefix)` keeps its current control flow and returns `null` exactly where it does today; only the item construction changes: it locates the current token's span via `scanInspectorArgs(prefix)` (the empty trailing span when the prefix ends with whitespace) and passes it through `items`. Grammar decisions keep using the stripped tokens from `tokenizeInspectorArgs`, so acceptance rules are unchanged.

- [ ] **Step 4: Keep the options already present out of the list**

```ts
test("an option already present is not offered again", () => {
  const items = completeInspectorCommand("ui --theme dark --");
  assert.ok(!items?.some((item) => item.label === "--theme"));
  assert.ok(items?.some((item) => item.label === "--scope"));
});
```

- [ ] **Step 5: Run the tests and commit**

Run: `node --import tsx --test tests/unit/command-grammar.test.ts tests/unit/command-completions.test.ts && npm test`
Expected: PASS (existing suggestion-set tests keep their expectations for labels).

```bash
git add src/commands/grammar.ts src/commands/completions.ts tests/unit/command-grammar.test.ts tests/unit/command-completions.test.ts
git commit -m "feat: rebuild completion values from raw argument spans"
```

---

### Task 20: Pi autocomplete boundary regression

**Files:**

- Create: `tests/unit/command-completion-application.test.ts`
- Create: `tests/unit/helpers/pi-autocomplete.ts`
- Modify: `package.json` (devDependency `@earendil-works/pi-tui` if not resolvable)

**Interfaces:**

- Consumes: `completeInspectorCommand` (Task 19), `CombinedAutocompleteProvider` from the pinned Pi TUI.
- Produces: `applyCompletionFor(line, cursor, label)` test helper driving the real provider.

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/helpers/pi-autocomplete.ts
import { CombinedAutocompleteProvider } from "@earendil-works/pi-tui";
import { completeInspectorCommand } from "../../../src/commands/completions.ts";

const provider = new CombinedAutocompleteProvider(
  [{ name: "session-inspector", getArgumentCompletions: (prefix: string) => completeInspectorCommand(prefix) }],
  "/tmp",
);

/** Drives the real Pi provider: suggest -> select -> apply, exactly as the editor does. */
export async function applyCompletionFor(line: string, cursor: number, label: string): Promise<{ line: string; cursor: number }> {
  const lines = [line];
  const suggestions = await provider.getSuggestions(lines, 0, cursor, { signal: new AbortController().signal, force: true });
  if (suggestions === null) throw new Error("no suggestions");
  const item = suggestions.items.find((candidate) => candidate.label === label);
  if (item === undefined) throw new Error(`no item labelled ${label}`);
  const applied = provider.applyCompletion(lines, 0, cursor, item, suggestions.prefix);
  return { line: applied.lines[0] as string, cursor: applied.cursorCol };
}
```

```ts
// tests/unit/command-completion-application.test.ts
import assert from "node:assert/strict";
import { test } from "node:test";
import { applyCompletionFor } from "./helpers/pi-autocomplete.ts";

const cases: [string, string, string][] = [
  ["/session-ins ui --th", "--theme", "/session-ins ui --theme"],
  ["/session-ins ui --theme d", "dark", "/session-ins ui --theme dark"],
  ["/session-ins ui --theme dark --", "--scope", "/session-ins ui --theme dark --scope"],
  ["/session-ins json history --sc", "--scope", "/session-ins json history --scope"],
  ["/session-ins json history --scope tr", "tree", "/session-ins json history --scope tree"],
  ['/session-ins ui --output "/tmp/my report.json" --th', "--theme", '/session-ins ui --output "/tmp/my report.json" --theme'],
  ['/session-ins ui --output "/tmp/my report.json" ', "--theme", '/session-ins ui --output "/tmp/my report.json" --theme'],
];

test("completion replaces only the current token through the real Pi provider", async () => {
  for (const [line, label, expected] of cases) {
    const result = await applyCompletionFor(`${line}`, line.length, label);
    assert.equal(result.line, expected, line);
    assert.equal(result.cursor, expected.length, line);
  }
});

test("a mid-token cursor keeps the text after the cursor intact", async () => {
  const line = "/session-ins ui --the|me";
  const applied = await applyCompletionFor("/session-ins ui --theme", "/session-ins ui --the".length, "--theme");
  assert.equal(applied.line, "/session-ins ui --theme");
  assert.equal(applied.cursor, "/session-ins ui --theme".length);
  assert.equal(line.includes("|"), true); // documents the cursor position used above
});

test("mode completion replaces the whole empty argument region", async () => {
  const applied = await applyCompletionFor("/session-ins ", "/session-ins ".length, "ui");
  assert.equal(applied.line, "/session-ins ui");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --import tsx --test tests/unit/command-completion-application.test.ts`
Expected: FAIL — either the module cannot resolve `@earendil-works/pi-tui` (add it to `devDependencies` with the exact pinned version from the Pi install) or the quoted-argument case loses the preceding arguments.

- [ ] **Step 3: Verify the dependency is present**

Run: `node -e 'import("@earendil-works/pi-tui").then(m => console.log(m.CombinedAutocompleteProvider.name))'`
Expected: `CombinedAutocompleteProvider`. The package is already installed at
`0.85.1` as a **peerDependency** of this project and the type import already
resolves in `src/commands/completions.ts`, so **no `package.json` change is
needed**; if the import ever fails, fall back to importing the provider from the
installed Pi path inside the helper and record that in the task report. The test
must drive the real provider, never a re-implementation.

- [ ] **Step 4: Verify the failing-before behaviour**

Temporarily revert the completion `value` computation to the previous bare-token form (`{ value, label: value }`) and run:

Run: `node --import tsx --test tests/unit/command-completion-application.test.ts`
Expected: FAIL with `/session-ins --theme` for the third case — proving the test detects the original defect — then restore the span-based implementation.

- [ ] **Step 5: Run the tests and commit**

Run: `node --import tsx --test tests/unit/command-completion-application.test.ts && npm test`
Expected: PASS.

```bash
git add tests/unit/command-completion-application.test.ts tests/unit/helpers/pi-autocomplete.ts package.json package-lock.json
git commit -m "test: prove completion token replacement through the real Pi provider"
```

---

### Task 21: Presentation polish for tables

**Files:**

- Modify: `src/ui/html.ts` (styles + table rendering)
- Test: `tests/unit/html-bundle.test.ts`

**Interfaces:**

- Produces: column classes `num`, `wrap`, `id-cell`, `status-cell`; catalog key `table.copyId`.

- [ ] **Step 1: Write the failing test**

```ts
test("numbers right-align while messages wrap", () => {
  const html = renderInspectorBundle(bundleFixture());
  assert.match(html, /\.num\{text-align:right/);
  assert.match(html, /\.wrap\{white-space:normal/);
  assert.match(html, /\.id-cell\{[^}]*text-overflow:ellipsis/);
  assert.doesNotMatch(html, /table\{width:100%;border-collapse:collapse;text-align:left;white-space:nowrap\}/);
  assert.doesNotMatch(html, /td:last-child\{text-align:right\}/);
});

test("a long id stays copyable in full", () => {
  const html = renderInspectorBundle(bundleFixture());
  assert.match(html, /data-full-id="/);
  assert.match(html, /table\.copyId/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --import tsx --test tests/unit/html-bundle.test.ts`
Expected: FAIL — the global `nowrap`/`last-child` rules are still present.

- [ ] **Step 3: Replace the global rules with column classes**

```css
table{width:100%;border-collapse:collapse;text-align:left}
th,td{padding:13px 22px;border-top:1px solid var(--line);vertical-align:top}
.num{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}
.wrap{white-space:normal}
.id-cell{max-width:18ch;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-family:var(--mono)}
.status-cell{white-space:nowrap}
```

Every numeric/token/cost column is emitted with `class="num"`, description/message columns with `class="wrap"`, opaque ids with `class="id-cell" data-full-id="<id>"` plus a copy control (`tr("table.copyId")`), and status/identity columns with `class="status-cell"`.

- [ ] **Step 4: Assert the intent questions still have single answers**

```ts
test("no decorative dashboard was added", () => {
  const html = renderInspectorBundle(bundleFixture());
  assert.doesNotMatch(html, /sparkline|gauge|donut|hero-chart/);
  assert.match(html, /chart-title|panel\.daily/);
});
```

- [ ] **Step 5: Run the tests and commit**

Run: `node --import tsx --test tests/unit/html-bundle.test.ts && npm test`
Expected: PASS.

```bash
git add src/ui/html.ts tests/unit/html-bundle.test.ts
git commit -m "feat: align and wrap table columns per column type"
```

---

### Task 22: ADR, spec update, CHANGELOG, and version 0.9.0

**Files:**

- Create: `docs/architecture/adr/0017-report-coverage-attribution-and-navigation.md`
- Modify: `docs/architecture/adr/README.md`, `docs/specs/pi-session-inspector-v1.md`, `docs/research/pi-ecosystem.md` (only if a pinned version changed), `CHANGELOG.md`, `package.json`, `package-lock.json`
- Test: none (documents); verified by Task 23

> **Retargeted for v0.8.0.** ADR **0016 is taken** by the evidence foundation
> (`0016-evidence-foundation-and-canonical-session-model.md`), so this milestone's
> ADR is **0017**; `package.json` is at **0.8.0**, so the release is **0.9.0**.

**Interfaces:**

- Produces: ADR 0017 (status accepted) recording: coverage is session coverage with an unknown-denominator rule; logical-call timestamp attribution implemented once in the canonical builder and projected, never re-derived; `usageByDate` truncation/partial honesty with one flag; environment-vs-activity separation; route authority and ephemeral caches; no Agent → Models link; autocomplete full-argument rewrite; no new persistence.

- [ ] **Step 1: Write ADR 0017**

```markdown
# ADR 0017: report coverage, attribution, and navigation

**Status:** accepted.

## Context

Aggregate usage was a partial sum presented as a total; range filtering reached only daily rows while tab tables stayed full-period; the browser projection dropped agent role, artifact state and tool timestamps; the client had several competing state holders and no routing; completion rewrote whole argument strings.

## Decision

Coverage is a first-class session-coverage summary (inspected/available/unavailable, reasons, `complete`) whose ratio is withheld whenever the denominator is unknown or unknowable, and which never qualifies a replayed session's own detail. Range attribution is by logical call. Per-session `usageByDate` is bounded and truncation-flagged; reconciliation is exact only inside the retained window. Inventory is environment, never activity. One route is authoritative for the active view; everything else is an ephemeral cache. Children link to errors one-to-many through `evidenceToolId` with no causal claim, and agent models never link to parent-session models.

## Alternatives considered

- Summation with a footnote: rejected — an unqualified total is a false claim.
- Result-arrival attribution: rejected — tool cost would move between days at midnight.
- Hidden truncation: rejected — a partial figure must be visibly partial.
- Extra persisted fields for coverage/dates: rejected — all values are derivable read-time.

## Consequences

Aggregate labels vary with completeness; old reports render conservative wording; the browser document inlines the same pure modules the tests import.
```

- [ ] **Step 2: Update the ADR index and the v1 spec**

Add the row to `docs/architecture/adr/README.md` (matching its existing table format), and in `docs/specs/pi-session-inspector-v1.md` add a "Report semantics" subsection stating: coverage contract and wording rules; the attribution table; range/scope defaults; capability-driven tabs; route authority; the unsupported/deferred list. Keep the existing sections intact.

- [ ] **Step 3: CHANGELOG and version**

```markdown
## 0.9.0

- Coverage: report-level session coverage with bounded per-session reasons, capped-discovery honesty, and `Known`/`Unavailable` wording instead of unqualified totals.
- Range: one shared range projection for every tab, per-view-identity ranges, validated custom-range hash round-trips, and logical-call timestamp attribution.
- Agents/Tools/Errors: child-run summary separated from native agent tool activity, `Related child run(s)` joins, tool/error identity by name instead of internal ids.
- Projection: agent role, artifact state, observation time, tool timestamps and per-date model/composition rows reach the browser; one canonical projection per view.
- Navigation: authoritative hash route with Back/Forward, deep links, capability-filtered tabs and entity focus.
- Environment/Integrations: inventory grouped as environment; detection, telemetry, activity and version shown independently.
- Completion: `/session-inspector` completion now preserves every preceding argument, including quoted values.
```

```bash
npm version 0.9.0 --no-git-tag-version
```

- [ ] **Step 4: Verify packaging still excludes scratch files**

Run: `npm pack --dry-run 2>&1 | tail -5`
Expected: `pi-session-inspector-0.9.0.tgz`, ~49 files, no `.superpowers`, no `tests`, no `.pi`.

- [ ] **Step 5: Commit**

```bash
git add docs/architecture/adr/0017-report-coverage-attribution-and-navigation.md docs/architecture/adr/README.md docs/specs/pi-session-inspector-v1.md CHANGELOG.md package.json package-lock.json
git commit -m "docs: record coverage, attribution and navigation decisions and bump to 0.9.0"
```

---

### Task 23: Privacy corpus, determinism, fixtures, and final verification

**Files:**

- Modify: `tests/unit/integration-privacy.test.ts`, `tests/unit/uat-evidence.test.ts`, `tests/fixtures/bundles/inspector-bundle.json`
- Test: the whole suite

**Interfaces:**

- Consumes: every task's contract.
- Produces: the milestone's acceptance evidence.

- [ ] **Step 1: Extend the privacy corpus**

```ts
// append to tests/unit/integration-privacy.test.ts
test("the browser payload never carries raw producer text or paths", () => {
  const html = renderInspectorBundle(hostileBundle());
  for (const forbidden of ["SECRET_PROMPT", "SECRET_TASK", "SECRET_RESULT", "SECRET_ARGUMENT", "SECRET_OUTPUT",
    "progressSummary", "finalOutput", "transcriptPath", "artifactPaths", "sessionFile", "/home/", "https://"]) {
    assert.ok(!html.includes(forbidden), forbidden);
  }
});

test("hostile strings cannot break out of the inlined payload", () => {
  const html = renderInspectorBundle(bundleWithHostileStrings('</script><script>alert(1)</script>'));
  assert.doesNotMatch(html, /<\/script><script>alert\(1\)/);
});
```

- [ ] **Step 2: Determinism and the coverage/attribution fixtures**

```ts
// append to tests/unit/uat-evidence.test.ts
test("two identical generations are byte-identical", async () => {
  const first = renderInspectorBundle(await loadInspectorBundle(input));
  const second = renderInspectorBundle(await loadInspectorBundle(input));
  assert.equal(first, second);
});

test("a resumed session does not double count across scopes", async () => {
  const bundle = await loadInspectorBundle({ ...input, loadCurrent: async (scope) => resumedModel(scope) });
  const active = totalTokensOf(bundle.current.active);
  const tree = totalTokensOf(bundle.current.tree);
  assert.equal(active, tree);
  assert.equal(bundle.current.sameReportProjection, true);
});
```

Add fixtures: `tests/fixtures/reports/coverage-partial.json` (5 of 27 with reasons), `tests/fixtures/reports/coverage-capped.json` (206 inspected, capped), `tests/fixtures/pi/0.85.1/long-session.jsonl` (>366 observed days), and refresh `tests/fixtures/bundles/inspector-bundle.json` so it carries `capabilities`, `datedModels`, composition and coverage. Also assert the second partial cause: a session whose
`evidenceHealth.usage.dated === "partial"` reports `usageByDateTruncated === true`,
so an unattributable line can never be presented as a complete window.

- [ ] **Step 3: Run the full verification**

```bash
npm run format:check && npm run lint && npm run typecheck && npm test && npm pack --dry-run
```

Expected: all clean; `npm test` reports the new totals (previous 397 plus the new tests) with `# fail 0`.

- [ ] **Step 4: Manual UAT checklist** (record results in the task report)

1. `/session-inspector ui` → Current overview renders; no coverage panel.
2. Switch to **Full session tree**; the note appears only when the projections match.
3. Custom range: validation, inclusive UTC boundaries, and cross-midnight call/error on adjacent single days.
4. Agents: `Child runs` vs `Agent tool activity`; one-to-many `Related child run(s)`.
5. Errors: follow a tool link and a child link; confirm no Agent → Models link exists.
6. Back/Forward and reload of a deep link restore content **and** active styling; a custom-range hash round-trips.
7. History/Global: `Known native cost` / `5 / 27 sessions`; capped wording when applicable; a selected session detail shows no coverage qualifier.
8. `/session-inspector json history` → file carries `coverage` and per-session `reason`/`usageByDateTruncated`.
9. `/session-ins ui --output "/tmp/my report.json" --th` + TAB keeps the quoted argument and completes `--theme`.
10. Generated HTML opens with networking disabled and issues no network requests.
11. **Preset deep link**: copy `#/current/tools?preset=7`, reload in a new tab → the same
    numbers as clicking `7D`, and no `1970-01-01` in the document or the hash.
12. **Legacy report** (aggregate with usage but no `coverage`): numbers still render,
    labelled `Known native cost — completeness unknown`; `Unavailable` appears only when
    the usage value itself is unavailable.
13. **Mixed-usage session**: tool-result usage sits on the call day, compaction and
    branch-summary usage on their own days, and an error-only date appears as membership
    with zero usage; range totals match the Tools tab, the Models tab, and the usage
    composition for the same range.
14. **Coverage reasons and truncation**: an unreadable source shows `session-unreadable`,
    a replay failure shows `replay-failed`; a session with `usageByDateTruncated` renders
    `Known` for a range that reaches into omitted history (exact known subtotal, marked
    partial) and `Unavailable` for a range entirely inside the omitted period — never
    `$0`. A session whose builder reports `evidenceHealth.usage.dated === "partial"`
    (an unattributable native usage line) also reads `Known`, never complete.
15. **P0-B document-size gate**: capture `renderInspectorBundle(bundleFixture()).length`
    **before** starting Task 6 and again after Task 9, and record both numbers, the
    fixture path (`tests/fixtures/bundles/inspector-bundle.json`) and the relative
    delta in the slice report. Gate: **≤ +15 %**. No absolute ceiling.

- [ ] **Step 5: Commit**

```bash
git add tests/ package.json package-lock.json
git commit -m "test: extend the privacy corpus, add coverage and long-session fixtures, refresh the bundle fixture"
```

---

## Self-Review Notes

**Spec coverage.** Every spec section maps to a task: §3 coverage → Tasks 1-3; §4 scope (labels, `sameReportProjection`) → Task 7; §5 range (semantics §5.1, anti-mixing §5.2, state §5.3, projection §5.4 → Tasks 6/8/9; acceptance §5.5, membership §5.6, attribution §5.7 → Tasks 5/9, with the fixture carried over from the retired Task 4); §6 projection contract → Tasks 10-11; §7 agents/tools/errors → Tasks 12-14 (evidence threading already on `main`, see §0.3 of the spec); §8 environment/integrations → Task 15; §9 navigation → Tasks 16-18; §10 autocomplete → Tasks 19-20; §11 privacy/compat → Tasks 11/23; §12 slices → the task order itself; §13 tests → per-task tests plus Task 23; §14 UAT → Task 23 step 4; §15 unsupported/deferred → enforced by Tasks 3/5/9 (no per-day coverage, `Known` truncation, no breakdown tabs); §16 polish → Task 21; §17 rulings R1-R20 → implemented where each ruling is binding (R12/R16 in Tasks 2/5/9, R7 in Tasks 11/14, R17 in Tasks 12/18, R11 in Tasks 17/20, R18 in Tasks 2/3/23, R19 in Tasks 5/6/9, R20 in Tasks 2/3).

**Placeholder scan.** No `TBD`/`TODO`/"similar to Task N"; every step carries runnable code, an exact command, or an exact checklist item. Four steps intentionally require a measured or environment-dependent value rather than a fixed number: Task 5's oldest retained date in `longSessionOptions`, the document-size measurement of P0-B, Task 20's installed `pi-tui` version, and Task 23's header refresh; each states exactly what to record.

**Type consistency.** `CoverageReason` (Task 1) and `SessionCoverage`/`buildSessionCoverage` (Task 2) are used verbatim in Tasks 3, 23 — the older names `CoverageSummary`/`buildCoverage` are gone (spec R18). `AgentRun.observedAt`/`evidenceToolId`/`model`/`thinking`/`failure` already exist on `main` (Task 4 retired) and are consumed by Tasks 11, 12, 14, 18 and the fixtures. `RangeState` (Task 8) is the only range type in Tasks 9, 16, 17. `InspectorRoute`/`deriveView` (Task 16) are consumed by Tasks 17-18 and asserted in `tests/unit/html-navigation.test.ts`. `scanInspectorArgs` (Task 19) is the only span source used by completions in Tasks 19-20. `capabilities` is produced by Task 6 (`CAPABILITIES`) and consumed by Tasks 15-18. `sessionDatedUsage` (Task 5, in `src/ui/dated-usage.ts`) is the only function that turns timestamps into dates; `buildDailyRows` (Task 6, in `src/ui/daily.ts`) only folds its output, and `DateUsageRow`/`DatedModelRow`/`SafeUsage` are defined once there.

**Re-baseline amendments (v2).** Applied on top of the six review amendments below: (a) Tasks 4 and 10 are retired — `main` already derives agent `observedAt`/`evidenceToolId`/`model`/`thinking`/`failure` and validates them (`910a665`), and Task 10 is reduced to the child-usage fraction; (b) the coverage aggregate is `SessionCoverage` in `src/core/session-coverage.ts` with a total reason→code mapping (spec R18/R20); (c) Task 2's reason plumbing now names all five real `scanHistory` failure paths instead of the two the pre-merge plan assumed; (d) Task 5 groups dates from `CanonicalUsageLine.attributedAt` and the truncation flag also covers `usage.dated === "partial"`, so `SessionReport` is an assertion target rather than a second attribution source (spec R19); (e) Task 6 adds `src/ui/daily.ts` as the single date-bucketing builder and the server-side capability table; (f) the file anchors were re-pointed at the real v0.8.0 code (`sessionView`/`toolRows`/`agentRows` in `html.ts`, error rows in `sessionView`, no `tests/unit/helpers/` directory, `pi-tui` already installed); (g) version is 0.9.0 and the ADR is 0017.

**Amendments after plan review (all six applied).** (1) Task 5 now implements the full logical-call attribution — generation, tool-result (on the CALL date), compaction and branch-summary usage — with composition-complete rows plus observation-only `tools`/`errors` counters, a mixed-usage fixture, and `sum(usageByDate) === the same range projection of SessionReport.usage`. (2) Task 9 decides truncation BEFORE returning: member-true rows whose range reaches into omitted history carry the exact known subtotal with `partial: true` (labels say `Known`), fully retained ranges stay exact, and ranges entirely inside the omitted period return unavailable rather than zero — all three cases tested. (3) The 1970 sentinel is gone: a preset is an unresolved `RangeIntent` resolved against the active view's observed dates (`resolveRange` returns `undefined` when nothing was observed), custom ranges parse to exact resolved pairs, and Task 16 adds the preset deep-link/reload regression plus a no-`1970` assertion. (4) Task 2 produces every declared `CoverageReason` on a real path — `session-unreadable` for malformed JSON, missing/invalid header, id mismatch, and `replay-failed` from an injectable replay seam — with focused tests and reason-count assertions. (5) Task 4's join is an explicit `Map<callId, { message, observedAt }>`; a result that cannot be deterministically joined publishes no run, and the contradictory test was replaced by skipped-behaviour tests. (6) Task 3 separates value availability from coverage availability: a legacy aggregate shows its usage with a completeness-unknown qualifier, while `Unavailable` is reserved for a genuinely unavailable value (or an empty inspection set), with a regression distinguishing the two.

**Known ordering constraint.** Tasks 6-18 edit `src/ui/html.ts` sequentially; each task's test step asserts behaviour that the previous task's code still satisfies, so the tasks must be executed in order. Tasks 1-3, 5, 8, 16, 19 and 20 are independent of the client script and can be reviewed on their own.

**Inlining constraint (added during self-review).** `String(fn)` copies a function body only, so every function listed in `INLINED_FUNCTIONS` must be self-contained: no module-scope constant, no helper outside the list, no Node/DOM API. The plan keeps `DATE`, `PRESETS`, `SECTIONS` and `PARAM_ORDER` inside the functions that use them for exactly this reason, and Task 17 adds `assertInlinedModulesEvaluate()`, which evaluates the emitted source in Node with no DOM so an incomplete inline fails in a test rather than in the browser.
