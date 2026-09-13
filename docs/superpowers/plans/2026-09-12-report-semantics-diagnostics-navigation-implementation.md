# Report semantics, diagnostics & navigation — v3 implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. One
> fresh implementer per task, then spec-compliance review, then code-quality review; fix and
> re-review before advancing. Steps use `- [ ]` checkboxes.

**Goal:** make the Inspector report honest and navigable: coverage-qualified aggregates, one
range-filtered projection across every tab, integrity-preserving browser DTOs, separated
agent/tool/error semantics, an authoritative offline route, and token-correct completion.

**Architecture:** all work is read-time derivation or projection over already-persisted
evidence. The canonical builder (`src/core/canonical.ts`) stays the single authority for
scope, attribution and health; loaders attach one dated projection; the browser folds those
rows; pure modules (`src/ui/range.ts`, `src/ui/route.ts`) are inlined into the single
self-contained document via `Function.prototype.toString()` so the browser and the tests run
the same code.

**Tech stack:** TypeScript ESM on Node `>=22.19.0`, `node:test` + `tsx`, Biome,
`@earendil-works/pi-coding-agent` 0.85.1, `@earendil-works/pi-tui` 0.85.1 (already installed as
a peerDependency). No new runtime dependency, no network, no daemon.

**Spec (authority for semantics):** `docs/superpowers/specs/2026-09-12-report-semantics-diagnostics-navigation-design.md`
(§0 re-baseline, §3 coverage, §4 scope, §5 range, §6 projection, §7 agents/tools/errors,
§8 environment, §9 routing, §10 autocomplete, §13 tests, §15 unsupported/deferred, §17 rulings).

## Baseline: v0.8.0 (facts active tasks need)

Verified at `910a665` → `81f65b7` (v0.8.0, evidence foundation). Only facts a task acts on:

- **Pipeline.** `buildCanonicalSession(parsed, scope, leafId, evidence, …)` is the scope,
  attribution and health authority; a session it does not resolve to `state === "ready"` is
  `unavailable`. `parseSessionJsonl` yields `{ id, hasMalformedJson, hasSessionHeader, entries }`.
- **Marker invariant.** A `ready` session **requires** a valid marker record
  `{"type":"custom","customType":"session-inspector:tracking-start","data":{"schemaVersion":1}}`;
  scope is the entries after it (`resolveScope`, `src/pi/scope.ts`). Every fixture built with
  `buildCanonicalSession` must contain one, and all activity under test must follow it.
- **Usage shape.** `readUsage` accepts only
  `{ totalTokens: number, cost: { total: number }, input?/output?/cacheRead?/cacheWrite? }`.
  A bare numeric `cost` is **ignored** (no usage). Fixtures must use the `cost.total` object.
- **Attribution.** `CanonicalUsageLine` carries `ownerId`, `domain`
  (`native-session`/`child-breakdown`), `bucket` (`generation`/`tool-result`/`compaction`/
  `branch-summary`/`child-run`) and `attributedAt` — tool lines attributed to the **call**
  timestamp, compactions to their own entry, child runs to `observedAt`. Generation line
  `ownerId === generation.id`. `health.usage.dated` is `supported` only when every native line
  has a known `attributedAt`, `partial` otherwise, `unavailable` when there are no native lines.
- **Agent evidence is done.** `AgentRun` already has `observedAt`, `evidenceToolId`, `model`,
  `thinking`, `failure`; `readSubagentEvidence` derives them from validated producer payloads
  (a result without a usable `message.toolCallId` publishes no run) and `projectAgent`
  re-validates them. No milestone task reimplements any of this.
- **Not on main.** `CoverageReason`/`SessionCoverage`, `discoveryLimited`, per-session
  `usageByDate`, capability table, `sameReportProjection`, `src/ui/range.ts`, `src/ui/route.ts`,
  per-date model rows, span-aware completion, `SessionReport.agentUsage`.
- **Client today.** `periods` is keyed per section, a custom range is silently clamped,
  `defaultPeriod` returns a `1970-01-01` sentinel for empty rows, history membership uses span
  overlap (`inPeriod`), the sidebar sets `aria-pressed` at creation only, `TABS` lists
  `commands`/`skills` separately, `agentRows`/`toolRows` drop time and role fields, error rows
  show the raw `tool:call_…` id.
- **Two renderers.** `renderInspectorBundle(bundle)` is the production document
  (`src/index.ts`). `renderHtml(HtmlReport)` is the legacy single-section adapter with no
  production caller; it keeps its current-view daily bucketing this milestone (spec §5.4, §15).
- **No test helper named in this plan exists yet** unless the target test file already imports
  it. Each task defines the helpers it uses in its own test file as part of step 1.
- **Baseline suite:** 588 tests pass (`npm ci && npm test`).

## Global constraints

- Pi JSONL is authority. Never write Pi session data (tracking marker is the only exception),
  never alter Pi execution, swallow every hook/telemetry/storage error.
- Privacy: never persist, log, project, render or hash prompts, user/assistant text, tool
  arguments, tool-result bodies, child `task`/`finalOutput`/`progressSummary`/`sessionName`/
  `sessionFile`/`transcriptPath`/`artifactPaths`, paths, URLs or secrets.
- `unavailable != 0`: missing, unsupported, partial or expired evidence renders `Unavailable`,
  never `0`, never `Total`, never a guess. Partial aggregates are `Known …`.
- Determinism: identical inputs → byte-identical JSON and HTML. No machine-clock reads.
- Additive DTOs only; `schemaVersion` stays `1`; older reports render conservatively.
- Bounded: ≤366 daily dates, ≤64 model rows per date, ≤366 `usageByDate` dates per session,
  ≤256 agent rows, ≤8 integration rows, ≤206 history sessions. Capped output is flagged.
- Attribution is by logical call (spec §5.7): tool usage on `Tool.timestamp`, tool errors on
  `ErrorRecord.timestamp`, child runs on `AgentRun.observedAt`.
- Every task ends with `npm run format:check && npm run lint && npm run typecheck && npm test`
  clean, and commits with a conventional message.
- Never add a collector, persisted field, schema migration or dependency.

## Task index

| # | Slice | Task | Primary files |
| --- | --- | --- | --- |
| 1 | A | Bounded per-session coverage reasons + discovery-cap signal | `src/storage/history.ts` |
| 2 | A | Session coverage assembly shared by history and global | `src/core/session-coverage.ts`, `src/ui/load-history.ts` |
| 3 | A | Coverage surfaces and the completeness wording contract | `src/ui/html.ts` |
| 4 | B | `sessionDatedUsage`: the single dated projection (+ marker-valid fixture) | `src/ui/dated-usage.ts`, loaders |
| 5 | B | Daily fold, capability table, identical-projection flag | `src/ui/daily.ts`, `src/ui/bundle.ts` |
| 6 | B | Pure range module: resolution, validation, filtering, membership | `src/ui/range.ts` |
| 7 | B | One range filter + scope copy in the client | `src/ui/html.ts`, `src/ui/bundle.ts` |
| 8 | C | Projection integrity: time, identity, role, error join | `src/ui/html.ts` |
| 9 | C | Agents semantics: child runs, activity, derived usage fraction | `src/core/reports.ts`, `src/ui/html.ts` |
| 10 | C | Tools summary + calls timeline | `src/ui/html.ts` |
| 11 | C | Errors: identity-first rendering and one-to-many children | `src/ui/html.ts` |
| 12 | C | Environment grouping + four-column integrations | `src/ui/html.ts` |
| 13 | D | Pure route module: parse, serialize, derive view model | `src/ui/route.ts` |
| 14 | D | Client routing: inlined modules, one `applyLocation`, derived active state | `src/ui/html.ts`, `src/ui/bundle.ts` |
| 15 | D | Cross-navigation links and entity focus | `src/ui/html.ts` |
| 16 | E | Span-aware scanner + raw-prefix completion values | `src/commands/grammar.ts`, `src/commands/completions.ts` |
| 17 | E | Pi autocomplete boundary regression | `tests/unit/command-completion-application.test.ts` |
| 18 | F | Table presentation polish | `src/ui/html.ts` |
| 19 | F | ADR 0017, v1 spec, CHANGELOG, version 0.9.0 | `docs/…`, `CHANGELOG.md`, `package.json` |
| 20 | F | Privacy corpus, determinism, fixtures, UAT, publication regressions | `tests/…` |

Execution order is 1→20. Tasks 4-18 all edit the single inlined client script in
`src/ui/html.ts` and must run in order; tasks 1-3, 16, 17 do not touch it.

## Type ownership (one definition each; later tasks reference, never redeclare)

| Type / function | Owner | File |
| --- | --- | --- |
| `CoverageReason`, `HistorySession.reason`, `HistoryDiscoveryResult.discoveryLimited` | 1 | `src/storage/history.ts` |
| `SessionCoverage`, `buildSessionCoverage`, `COVERAGE_REASON_CODES` | 2 | `src/core/session-coverage.ts` |
| `DateUsageRow`, `DatedModelRow`, `SafeUsage`, `sessionDatedUsage`, `MAX_DATED_DATES`, `MAX_MODELS_PER_DATE` | 4 | `src/ui/dated-usage.ts` |
| `DailyRow`, `buildDailyRows` | 5 | `src/ui/daily.ts` |
| `CAPABILITIES`, `CurrentView` fields, `sameReportProjection` | 5 | `src/ui/bundle.ts` |
| `RangeState`, `RangeIntent`, `filterView`, `historyRowRange`, `resolveRange`, `isInRange`, `presetRange`, `latestObservedDate`, `shiftUtcDay`, `parseRangeQuery`, `serializeRangeQuery` | 6 | `src/ui/range.ts` |
| `EntityRef`, `InspectorRoute`, `parseRoute`, `serializeRoute`, `routeKey`, `deriveView` | 13 | `src/ui/route.ts` |
| `RawToken`, `scanInspectorArgs`, `tokenizeInspectorArgs` | 16 | `src/commands/grammar.ts` |
| `SessionReport.agentUsage` | 9 | `src/core/reports.ts` |

---

# Slice A — Session coverage correctness

## Task 1: Bounded per-session coverage reasons and the discovery-cap signal

**Files:** `src/storage/history.ts` · test `tests/unit/history-discovery.test.ts` (new)

**Depends on:** nothing.

**Interfaces (create here):**

```ts
export type CoverageReason =
  | "no-manifest"          // neither metadata nor a pending manifest was readable
  | "manifest-unavailable" // source missing/unresolvable/rejected, lease unavailable, promotion threw
  | "marker-unavailable"   // source readable but marker/header/id evidence failed
  | "session-unreadable"   // parse failure, malformed JSON, no header, id mismatch
  | "replay-failed";       // provider, canonical builder or report projection failed
export type HistorySession = {
  sessionId: string;
  availability: "available" | "unavailable";
  reason?: CoverageReason;
  /** Internal locator; stays non-enumerable on returned rows. */
  sourceFile?: string;
};
export type HistoryDiscoveryResult = {
  availability: "available" | "unavailable";
  sessions: HistorySession[];
  diagnostics: HistoryDiagnostic[];
  discoveryLimited: boolean;
};
```

- [ ] **Step 1 — failing test**

```ts
// tests/unit/history-discovery.test.ts
import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { discoverHistory } from "../../src/storage/history.ts";

const maintenance = { writerId: "maintainer-1", now: () => new Date("2026-09-01T00:00:00.000Z"), isPidAlive: () => true };

test("reports a bounded reason per unavailable session", async () => {
  const root = await mkdtemp(join(tmpdir(), "inspector-discovery-"));
  await mkdir(join(root, "sessions", "11111111-1111-4111-8111-111111111111"), { recursive: true });
  const result = await discoverHistory({
    root,
    sessionDirectory: () => join(root, "pi-sessions"),
    markerEvidence: async () => true,
    maintenance,
  });
  assert.equal(result.availability, "available");
  assert.deepEqual([result.sessions.length, result.sessions[0]?.availability, result.sessions[0]?.reason], [1, "unavailable", "no-manifest"]);
  assert.equal(result.discoveryLimited, false);
});

test("flags discovery as limited when the session cap is reached", async () => {
  const root = await mkdtemp(join(tmpdir(), "inspector-discovery-cap-"));
  const sessions = join(root, "sessions");
  for (let index = 0; index < 207; index += 1) {
    const id = `1111111${String(index).padStart(2, "0")}-1111-4111-8111-111111111111`;
    await mkdir(join(sessions, id), { recursive: true });
    await writeFile(join(sessions, id, "tracking.json"), "{}");
  }
  const result = await discoverHistory({ root, sessionDirectory: () => join(root, "pi-sessions"), markerEvidence: async () => true, maintenance });
  assert.equal(result.discoveryLimited, true);
  assert.equal(result.sessions.length, 206);
  assert.ok(result.diagnostics.includes("history-limit-reached"));
});

test("an unreadable sessions directory stays unavailable and unlimited", async () => {
  const root = await mkdtemp(join(tmpdir(), "inspector-discovery-missing-"));
  const result = await discoverHistory({ root, sessionDirectory: () => join(root, "pi-sessions"), markerEvidence: async () => true, maintenance });
  assert.deepEqual(result, { availability: "unavailable", sessions: [], diagnostics: ["history-unavailable"], discoveryLimited: false });
});
```

- [ ] **Step 2 — run and see it fail**

`node --import tsx --test tests/unit/history-discovery.test.ts`
Expected: FAIL — `reason` and `discoveryLimited` are `undefined`.

- [ ] **Step 3 — implement**

Export the three types above. Add `let discoveryLimited = false;` beside the diagnostics set.
Keep every existing check and diagnostic; only stop discarding the cause:

- `inspectManifest`: `pending === undefined` → `{ availability: "unavailable", reason: "no-manifest" }`.
- `inspectManifest` inside the lease: `currentPending === undefined` → `reason: "no-manifest"`.
- `inspectManifest`: `lease === undefined` → `reason: "manifest-unavailable"` (spec §3.1.1 covers
  promotion failure), and the outer promotion `catch` → `reason: "manifest-unavailable"`.
- `availableManifest`: missing source → `reason: "manifest-unavailable"`; failed marker evidence
  → `reason: "marker-unavailable"` (`hasMarkerEvidence` keeps recording its diagnostic).
- `inspectManifest` return type becomes `Pick<HistorySession, "availability" | "sourceFile" | "reason">`.
- Cap site sets `discoveryLimited = true` before truncating `sessionIds`.
- Unreadable sessions directory returns `discoveryLimited: false`.
- The non-enumerable `sourceFile` define stays; add `...(inspected.reason === undefined ? {} : { reason: inspected.reason })` to the returned row.

- [ ] **Step 4 — verify**

`node --import tsx --test tests/unit/history-discovery.test.ts tests/unit/history.test.ts && npm run format:check && npm run lint && npm run typecheck && npm test`

- [ ] **Step 5 — commit**

`git add src/storage/history.ts tests/unit/history-discovery.test.ts`
`git commit -m "feat: report bounded per-session coverage reasons and the discovery cap"`

## Task 2: Session coverage assembly shared by history and global

**Files:** `src/core/session-coverage.ts` (new) · `src/ui/load-history.ts` · tests
`tests/unit/session-coverage.test.ts` (new), `tests/unit/history-reports.test.ts`

**Depends on:** Task 1.

**Interfaces (create here):** `SessionCoverage`, `buildSessionCoverage`, `COVERAGE_REASON_CODES`;
`HistoryReport.coverage?`, `GlobalReport.coverage?`; the reason labels inside `scanHistory`
(seven return sites → five causes, spec §0.2 item 6).

- [ ] **Step 1 — failing test**

```ts
// tests/unit/session-coverage.test.ts
import assert from "node:assert/strict";
import { test } from "node:test";
import { COVERAGE_REASON_CODES, buildSessionCoverage } from "../../src/core/session-coverage.ts";

const available = { availability: "available" as const };

test("partial sets are not complete and expose a session ratio", () => {
  assert.deepEqual(
    buildSessionCoverage({ availability: "available", discoveryLimited: false, sessions: [available, { availability: "unavailable", reason: "manifest-unavailable" }] }),
    { inspected: 2, available: 1, unavailable: 1, sessionRatio: 0.5, complete: false, discoveryLimited: false, reasons: { "manifest-unavailable": 1 } },
  );
});

test("a capped discovery hides the ratio and is never complete", () => {
  const coverage = buildSessionCoverage({ availability: "available", discoveryLimited: true, sessions: [available] });
  assert.deepEqual([coverage?.sessionRatio, coverage?.complete, coverage?.discoveryLimited], [null, false, true]);
});

test("an empty inspection set is not complete and has no ratio", () => {
  const coverage = buildSessionCoverage({ availability: "available", discoveryLimited: false, sessions: [] });
  assert.deepEqual([coverage?.inspected, coverage?.sessionRatio, coverage?.complete, JSON.stringify(coverage?.reasons)], [0, null, false, "{}"]);
});

test("an unavailable aggregate has no coverage at all", () => {
  assert.equal(buildSessionCoverage({ availability: "unavailable", discoveryLimited: false, sessions: [] }), undefined);
});

test("a fully replayed uncapped set is complete", () => {
  const coverage = buildSessionCoverage({ availability: "available", discoveryLimited: false, sessions: [available, available] });
  assert.deepEqual([coverage?.complete, coverage?.sessionRatio], [true, 1]);
});

// Totality is enforced by the type of COVERAGE_REASON_CODES (a missing reason or an
// unknown code fails `npm run typecheck`); this only pins the declared key set.
test("every reason has a bounded-code mapping", () => {
  assert.deepEqual(Object.keys(COVERAGE_REASON_CODES).sort(), ["manifest-unavailable", "marker-unavailable", "no-manifest", "replay-failed", "session-unreadable"]);
  for (const codes of Object.values(COVERAGE_REASON_CODES)) assert.ok(codes.length > 0);
});
```

- [ ] **Step 2 — run and see it fail**

`node --import tsx --test tests/unit/session-coverage.test.ts`
Expected: FAIL — cannot resolve `../../src/core/session-coverage.ts`.

- [ ] **Step 3 — implement the builder**

```ts
// src/core/session-coverage.ts
import type { EvidenceDiagnosticCode } from "./evidence-health.ts";
import type { CoverageReason, HistoryDiagnostic } from "../storage/history.ts";

export type { CoverageReason };

/** Total projection of the runnability vocabulary onto codes that already exist (spec §3.1.1, R20). */
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
  /** null when inspected === 0 or discoveryLimited (unknown denominator). */
  sessionRatio: number | null;
  complete: boolean;
  discoveryLimited: boolean;
  reasons: Readonly<Partial<Record<CoverageReason, number>>>;
};

export function buildSessionCoverage(input: {
  availability: "available" | "unavailable";
  discoveryLimited: boolean;
  sessions: readonly { availability: "available" | "unavailable"; reason?: CoverageReason }[];
}): SessionCoverage | undefined {
  if (input.availability !== "available") return undefined;
  const inspected = input.sessions.length;
  const available = input.sessions.filter((session) => session.availability === "available").length;
  const reasons: Partial<Record<CoverageReason, number>> = {};
  for (const session of input.sessions) {
    if (session.reason === undefined) continue;
    reasons[session.reason] = (reasons[session.reason] ?? 0) + 1;
  }
  return {
    inspected,
    available,
    unavailable: inspected - available,
    sessionRatio: inspected === 0 || input.discoveryLimited ? null : Number((available / inspected).toFixed(4)),
    complete: inspected > 0 && available === inspected && !input.discoveryLimited,
    discoveryLimited: input.discoveryLimited,
    reasons,
  };
}
```

- [ ] **Step 4 — name the reason in `scanHistory` and spread coverage**

`src/ui/load-history.ts`:

```ts
export type HistoryReplayInput = {
  session: CanonicalSession;
  entries: readonly SessionEntry[];
  observation: SessionObservation | undefined;
  subagentEvidence: SubagentEvidence;
  sealed: boolean;
};

type SessionScan =
  | { availability: "available"; sessionId: string; report: SessionReport }
  | { availability: "unavailable"; sessionId: string; reason: CoverageReason };

type HistoryScan = {
  availability: "available" | "unavailable";
  sessions: SessionScan[];
  diagnostics: HistoryDiagnostic[];
  discoveryLimited: boolean;
  coverage: SessionCoverage | undefined;
};
```

`LoadHistoryOptions` gains `/** Test seam only; production uses`defaultReplay`. */ replay?: (input: HistoryReplayInput) => SessionReport;`.
`scanHistory` keeps its current structure and adds the reason at each exit:

| Cause (spec §0.2 item 6) | Where | Reason |
| --- | --- | --- |
| discovery already failed this manifest | `availability !== "available" \|\| sourceFile === undefined` | `reason ?? "manifest-unavailable"` |
| (a) source unresolvable / parse threw | the read `try/catch` | `manifest-unavailable` when the resolver returns `undefined`, otherwise `session-unreadable` |
| (b) header/id/marker re-check | `sourceReadFailure` / `hasTrackingStartMarker` | `session-unreadable` / `marker-unavailable` |
| (c) evidence provider | provider throw, or `undefined` while a provider is configured | `replay-failed` |
| (d) builder not ready | both `buildCanonicalSession` results | `replay-failed` |
| (e) report projection threw | the `replay`/`defaultReplay` call | `replay-failed` |

Move the current inline projection into `defaultReplay(input: HistoryReplayInput): SessionReport`
unchanged (same `toSessionReport(...)` arguments), and add:

```ts
/** Deterministic source-read validation; every failure it can name maps to ONE reason. */
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

`scanHistory` returns `{ availability, sessions, diagnostics, discoveryLimited, coverage: buildSessionCoverage({ availability: discovery.availability, discoveryLimited: discovery.discoveryLimited, sessions }) }`.
`loadHistoryReports` and `loadGlobalReport` spread `...(scan.coverage === undefined ? {} : { coverage: scan.coverage })`;
`toHistoricalSession` carries `reason` on the unavailable variant. Add
`coverage?: SessionCoverage` to `HistoryReport` and `GlobalReport`.

- [ ] **Step 5 — assert the wiring end to end**

```ts
// append to tests/unit/history-reports.test.ts
// New helpers for this file (none exists today): `optionsWithSource(source, { marker = true })`
// writes one manifest + one JSONL source into a fresh temp root and returns LoadHistoryOptions;
// `headerFor(id)` returns the session header line; `validSource()` returns a marker-bearing body.
test("history and global report the same coverage from the same inputs", async () => {
  const options = await optionsWithSource(validSource());
  const history = await loadHistoryReports(options);
  const global = await loadGlobalReport(options);
  assert.equal(history.coverage?.inspected, 1);
  assert.equal(history.coverage?.complete, true);
  assert.deepEqual(history.coverage, global.coverage);
});

test("every declared reason is produced by a real path", async () => {
  const cases: [string, string, CoverageReason][] = [
    ["malformed JSON", "{not json\n", "session-unreadable"],
    ["missing session header", '{"type":"message","id":"x"}\n', "session-unreadable"],
    ["session id mismatch", headerFor("99999999-9999-4999-8999-999999999999"), "session-unreadable"],
  ];
  for (const [label, source, reason] of cases) {
    const history = await loadHistoryReports(await optionsWithSource(source));
    assert.equal(history.coverage?.reasons[reason], 1, label);
    assert.equal(history.coverage?.unavailable, 1, label);
  }
  const failing = await loadHistoryReports({
    ...(await optionsWithSource(validSource())),
    replay: () => {
      throw new Error("projection exploded");
    },
  });
  assert.deepEqual([failing.coverage?.reasons["replay-failed"], failing.coverage?.available], [1, 0]);
});

test("a missing marker keeps its own reason, not replay-failed", async () => {
  const history = await loadHistoryReports(await optionsWithSource(validSource(), { marker: false }));
  // The manifest cannot be promoted without marker evidence, so discovery already
  // reports it and the row never becomes a report.
  assert.equal(history.sessions[0]?.availability, "unavailable");
  assert.deepEqual(history.coverage?.reasons, { "marker-unavailable": 1 });
  assert.equal(history.coverage?.available, 0);
});
```

- [ ] **Step 6 — verify and commit**

`node --import tsx --test tests/unit/session-coverage.test.ts tests/unit/history-reports.test.ts && npm run format:check && npm run lint && npm run typecheck && npm test`

`git add src/core/session-coverage.ts src/ui/load-history.ts tests/unit/session-coverage.test.ts tests/unit/history-reports.test.ts`
`git commit -m "feat: assemble shared session coverage for history and global"`

## Task 3: Coverage surfaces and the completeness wording contract

**Files:** `src/ui/html.ts` (catalog ~7, projections ~588/1219, client panels ~1358-1360) ·
`src/ui/load-history.ts` (aggregate-only coverage) · tests `tests/unit/html-bundle.test.ts`,
`tests/unit/html.test.ts`

**Depends on:** Task 2.

**Interfaces (create here):** catalog keys `coverage.*`, `metric.knownCost`, `metric.knownTokens`,
`metric.costUnavailable`; `aggregateUsageLabels(input)` (exported); projection keys `coverage` and
`usageLabels` on history/global only.

- [ ] **Step 1 — failing test**

```ts
// append to tests/unit/html-bundle.test.ts
import type { SessionCoverage } from "../../src/core/session-coverage.ts";

// Local helper (does not exist yet): clone the fixture bundle and set/remove coverage.
function withAggregateCoverage(coverage: SessionCoverage | undefined): InspectorBundle {
  const bundle = bundleFixture();
  for (const section of [bundle.history, bundle.global] as Record<string, unknown>[]) {
    if (coverage === undefined) delete section.coverage;
    else section.coverage = coverage;
  }
  return bundle;
}

test("a partial aggregate renders Known wording and never an unqualified total", () => {
  const html = renderInspectorBundle(withAggregateCoverage({
    inspected: 27, available: 5, unavailable: 22, sessionRatio: 0.1852, complete: false,
    discoveryLimited: false, reasons: { "manifest-unavailable": 22 },
  }));
  assert.match(html, /Known native cost/);
  assert.match(html, /Known tokens/);
  assert.match(html, /5 \/ 27 sessions · 22 unavailable/);
  assert.equal(/"cost":"metric\.cost"/.test(html), false);
});

test("legacy aggregates show their value qualified as completeness-unknown", () => {
  const html = renderInspectorBundle(withAggregateCoverage(undefined));
  assert.match(html, /Known native cost — completeness unknown/);
  assert.equal(/"cost":"metric\.costUnavailable"/.test(html), false);
});

test("a capped discovery shows counts and never a ratio", () => {
  const html = renderInspectorBundle(withAggregateCoverage({
    inspected: 206, available: 206, unavailable: 0, sessionRatio: null, complete: false,
    discoveryLimited: true, reasons: {},
  }));
  assert.match(html, /206 sessions inspected · additional sessions not inspected/);
  assert.equal(/206 \/ 206 sessions|100%/.test(html), false);
});

test("an empty inspection set is unavailable, never zero", () => {
  const html = renderInspectorBundle(withAggregateCoverage({
    inspected: 0, available: 0, unavailable: 0, sessionRatio: null, complete: false,
    discoveryLimited: false, reasons: {},
  }));
  assert.match(html, /No tracked sessions/);
  assert.equal(/\$0\.00/.test(html), false);
});

test("the label resolver separates value availability from coverage availability", () => {
  assert.deepEqual(aggregateUsageLabels({ availability: "available", coverage: undefined }), {
    cost: "coverage.unknownCompletenessCost", tokens: "coverage.unknownCompletenessTokens",
    usageUnavailable: false, sessions: "coverage.unknown",
  });
  assert.equal(aggregateUsageLabels({ availability: "unavailable", coverage: undefined }).usageUnavailable, true);
  const empty = aggregateUsageLabels({
    availability: "available",
    coverage: { inspected: 0, available: 0, unavailable: 0, sessionRatio: null, complete: false, discoveryLimited: false, reasons: {} },
  });
  assert.deepEqual([empty.usageUnavailable, empty.sessions], [true, "coverage.none"]);
});
```

```ts
// append to tests/unit/html.test.ts (uses the existing renderHtml + embedded + historyReport helpers)
test("a selected history session carries no coverage panel", () => {
  const document = embedded(renderHtml(historyReport())) as { history: { coverage?: unknown; sessions: { view?: Record<string, unknown> }[] } };
  assert.equal(document.history.sessions[0]?.view?.coverage, undefined);
  assert.equal("coverage" in (document.history.sessions[0]?.view ?? {}), false);
});
```

- [ ] **Step 2 — run and see it fail**

`node --import tsx --test tests/unit/html-bundle.test.ts tests/unit/html.test.ts`

- [ ] **Step 3 — catalog, resolver, projections**

Catalog additions (keep the existing keys):

```ts
"coverage.title": "Coverage",
"coverage.sessions": "{available} / {inspected} sessions · {unavailable} unavailable",
"coverage.complete": "{available} / {inspected} sessions",
"coverage.sessionsLimited": "{inspected} sessions inspected · additional sessions not inspected",
"coverage.none": "No tracked sessions",
"coverage.unknown": "Sessions: Unavailable",
"coverage.reasons": "Reasons: {reasons}",
"coverage.unknownCompletenessCost": "Known native cost — completeness unknown",
"coverage.unknownCompletenessTokens": "Known tokens — completeness unknown",
"metric.knownCost": "Known native cost",
"metric.knownTokens": "Known tokens",
"metric.costUnavailable": "Unavailable",
```

```ts
// src/ui/html.ts (exported; used by the projection and by tests)
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

`sectionProjection` (history/global) gains:

```ts
  coverage: report.coverage === undefined ? null : {
    ...report.coverage,
    reasons: Object.entries(report.coverage.reasons).map(([reason, count]) => `${reason}: ${count}`).join(" · "),
  },
  usageLabels: aggregateUsageLabels({ availability: report.availability, coverage: report.coverage }),
```

- [ ] **Step 4 — client panel and metric labels**

Add one `coveragePanel(section)` renderer used by `historyOverview` and `globalOverview`:
title `coverage.title`; one session line (`coverage.none` when `inspected === 0`,
`coverage.sessionsLimited` when capped, `coverage.complete` when complete, else `coverage.sessions`);
then `coverage.reasons` with the pre-joined reason string when present. Keep the bounded
diagnostic tokens as plain text.

Every aggregate cost/token metric reads `section.usageLabels`: when `usageUnavailable` is true it
renders `Unavailable` and never the number; otherwise it renders the number under the label key.
Delete the duplicate `trackedSessions`/`unavailableSessions` metric line from `globalOverview`
(one partial-count statement per page, spec §3.3). Do not attach `coverage` to
`historyEntry`/`sessionView`, so a selected session keeps no qualifier.

- [ ] **Step 5 — verify and commit**

`node --import tsx --test tests/unit/html-bundle.test.ts tests/unit/html.test.ts && npm run format:check && npm run lint && npm run typecheck && npm test`

`git add src/ui/html.ts src/ui/load-history.ts tests/unit/html-bundle.test.ts tests/unit/html.test.ts`
`git commit -m "feat: render coverage wording for aggregate sections only"`

---

# Slice B — Canonical dated/range projection

## Task 4: `sessionDatedUsage` — the single dated projection

**Files:** `src/ui/dated-usage.ts` (new) · `src/ui/load-history.ts` · `src/ui/load-current.ts` ·
`src/ui/current.ts` · fixture `tests/fixtures/pi/0.85.1/mixed-usage.jsonl` (new) · tests
`tests/unit/dated-usage.test.ts` (new), `tests/unit/history-reports.test.ts`

**Depends on:** Task 2 (scan/report shapes).

**Interfaces (create here):** `SafeUsage`, `DateUsageRow`, `DatedModelRow`, `MAX_DATED_DATES`,
`MAX_MODELS_PER_DATE`, `sessionDatedUsage`; `HistoricalSession.usageByDate`/`usageByDateTruncated`;
`CurrentTuiModel.datedUsage`; `CurrentView.usageByDate`/`datedModels`/`modelsTruncated` (consumed in Task 5).

**Invariants (spec §5.4/§5.6/§5.7, R19):** dates come from `CanonicalUsageLine.attributedAt` only;
model rows join their line by `ownerId`; child usage is excluded by `domain`; an unattributable
native line is omitted **and** marks the window partial; the retained window reconciles with
`SessionReport.usage`.

- [ ] **Step 1 — marker-valid fixture + failing test**

The fixture must be a real, `ready` canonical session: header, a valid marker, and every record
after it in one parent chain. Usage uses the `cost.total` object shape (a bare number is ignored).

```jsonl
// tests/fixtures/pi/0.85.1/mixed-usage.jsonl
{"type":"session","version":3,"id":"mixed-usage-session","timestamp":"2026-09-01T08:00:00.000Z","cwd":"/fixture"}
{"type":"custom","id":"marker","parentId":null,"timestamp":"2026-09-01T08:05:00.000Z","customType":"session-inspector:tracking-start","data":{"schemaVersion":1}}
{"type":"message","id":"g1","parentId":"marker","timestamp":"2026-09-01T09:00:00.000Z","message":{"role":"assistant","provider":"anthropic","model":"claude-x","content":[{"type":"toolCall","id":"call-a","name":"bash"}],"usage":{"input":100,"output":50,"cacheRead":0,"cacheWrite":0,"totalTokens":150,"cost":{"input":1,"output":0.5,"cacheRead":0,"cacheWrite":0,"total":1.5}}}}
{"type":"message","id":"r1","parentId":"g1","timestamp":"2026-09-02T00:10:00.000Z","message":{"role":"toolResult","toolCallId":"call-a","toolName":"bash","isError":false,"content":"sanitized","usage":{"input":10,"output":5,"cacheRead":0,"cacheWrite":0,"totalTokens":15,"cost":{"input":0.1,"output":0.05,"cacheRead":0,"cacheWrite":0,"total":0.15}}}}
{"type":"compaction","id":"c1","parentId":"r1","timestamp":"2026-09-02T12:00:00.000Z","summary":"sanitized","firstKeptEntryId":"g1","tokensBefore":100,"usage":{"input":20,"output":10,"cacheRead":0,"cacheWrite":0,"totalTokens":30,"cost":{"input":0.2,"output":0.1,"cacheRead":0,"cacheWrite":0,"total":0.3}}}
{"type":"branch_summary","id":"b1","parentId":"c1","timestamp":"2026-09-03T12:00:00.000Z","summary":"sanitized","usage":{"input":5,"output":5,"cacheRead":0,"cacheWrite":0,"totalTokens":10,"cost":{"input":0.05,"output":0.05,"cacheRead":0,"cacheWrite":0,"total":0.1}}}
{"type":"message","id":"g2","parentId":"b1","timestamp":"2026-09-04T09:00:00.000Z","message":{"role":"assistant","provider":"anthropic","model":"claude-x","content":[{"type":"toolCall","id":"call-b","name":"edit"}],"usage":{"input":1,"output":1,"cacheRead":0,"cacheWrite":0,"totalTokens":2,"cost":{"input":0.01,"output":0.01,"cacheRead":0,"cacheWrite":0,"total":0.02}}}}
{"type":"message","id":"r2","parentId":"g2","timestamp":"2026-09-05T09:00:00.000Z","message":{"role":"toolResult","toolCallId":"call-b","toolName":"edit","isError":true,"content":"sanitized"}}
```

Expected (logical-call attribution): `2026-09-01` = generation 150 + tool-result 15 (call day) =
165 tokens / 1.65 cost, 1 generation, 1 tool; `09-02` compaction 30; `09-03` branch summary 10;
`09-04` generation 2 with 1 generation and 1 tool call; `09-05` error membership only, zero usage.

```ts
// tests/unit/dated-usage.test.ts
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { buildCanonicalSession, type CanonicalSession } from "../../src/core/canonical.ts";
import { reduceEntries } from "../../src/core/reduce.ts";
import { toSessionReport, type SessionReport } from "../../src/core/reports.ts";
import { parseSessionJsonl } from "../../src/pi/adapter.ts";
import { sessionDatedUsage } from "../../src/ui/dated-usage.ts";

const FIXTURE = "tests/fixtures/pi/0.85.1/mixed-usage.jsonl";

function canonicalOf(file: string): CanonicalSession {
  const parsed = parseSessionJsonl(readFileSync(file, "utf8"));
  const built = buildCanonicalSession({ parsed, scope: "tree", leafId: null, evidence: { atomic: [], folded: [] } });
  // The fixture must satisfy the production L1 contract, never a relaxed one.
  assert.equal(built.state, "ready");
  if (built.state !== "ready") throw new Error("unreachable");
  return built.session;
}

function reportOf(file: string): SessionReport {
  const parsed = parseSessionJsonl(readFileSync(file, "utf8"));
  return toSessionReport(reduceEntries(parsed.id ?? "fixture", parsed.entries));
}

test("the marker-bearing fixture builds a ready canonical session", () => {
  const session = canonicalOf(FIXTURE);
  assert.equal(session.sessionId, "mixed-usage-session");
  assert.equal(session.health.usage.dated, "supported");
});

test("dated rows attribute every usage source by logical call", () => {
  const { dates, truncated } = sessionDatedUsage(canonicalOf(FIXTURE));
  assert.equal(truncated, false);
  assert.deepEqual(
    dates.map((row) => [row.date, row.totalTokens, row.generations, row.tools, row.errors]),
    [
      ["2026-09-01", 165, 1, 1, 0],
      ["2026-09-02", 30, 0, 0, 0],
      ["2026-09-03", 10, 0, 0, 0],
      ["2026-09-04", 2, 1, 1, 0],
      ["2026-09-05", 0, 0, 0, 1],
    ],
  );
  assert.deepEqual(dates[0]?.composition, {
    generations: { totalTokens: 150, cost: 1.5 },
    toolResults: { totalTokens: 15, cost: 0.15 },
    compactions: { totalTokens: 0, cost: 0 },
    branchSummaries: { totalTokens: 0, cost: 0 },
  });
});

test("the retained window reconciles with the report's own usage", () => {
  const { dates } = sessionDatedUsage(canonicalOf(FIXTURE));
  const report = reportOf(FIXTURE);
  assert.equal(dates.reduce((sum, row) => sum + row.totalTokens, 0), report.usage?.totalTokens);
  assert.equal(Math.round(dates.reduce((sum, row) => sum + row.cost, 0) * 1e6) / 1e6, report.usage?.cost);
});

test("model rows join the same attribution as the date rows", () => {
  const { dates, models } = sessionDatedUsage(canonicalOf(FIXTURE));
  for (const date of dates) {
    const fromModels = models.filter((row) => row.date === date.date).reduce((sum, row) => sum + row.totalTokens, 0);
    assert.equal(fromModels, date.composition.generations.totalTokens, date.date);
  }
  assert.deepEqual(models.map((row) => row.date), ["2026-09-01", "2026-09-04"]);
});

test("an unattributable native line marks the window partial, never zero", () => {
  const session = canonicalOf(FIXTURE);
  const { dates, truncated } = sessionDatedUsage({
    ...session,
    health: { ...session.health, usage: { ...session.health.usage, dated: "partial" } },
  });
  assert.equal(truncated, true);
  assert.ok(dates.reduce((sum, row) => sum + row.totalTokens, 0) > 0);
});
```

- [ ] **Step 2 — run and see it fail**

`node --import tsx --test tests/unit/dated-usage.test.ts`
Expected: FAIL on the unresolved module (the fixture itself must already pass the `ready` assertion).

- [ ] **Step 3 — implement**

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
 * THE dated projection (spec §5.4, R19): every per-date figure comes from the
 * builder's own attribution. Line dates are grouped by bucket; `dateByOwner`
 * makes the model rows share the very same decision, so a generation can never
 * appear in one projection and not the other. Observation counters
 * (`generations`/`tools`/`errors`) describe activity, not spend.
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
      if (part !== undefined) addUsage(rowFor(date), line.usage, part);
    }
  }
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
  const byModel = new Map<string, DatedModelRow>();
  const perDate = new Map<string, Set<string>>();
  let modelsTruncated = false;
  for (const generation of session.generations) {
    const date = dateByOwner.get(generation.id);
    if (date === undefined) continue;
    const key = `${date}\u0000${generation.provider}\u0000${generation.model}`;
    const seen = perDate.get(date) ?? new Set<string>();
    if (!seen.has(key)) {
      if (seen.size >= MAX_MODELS_PER_DATE) {
        modelsTruncated = true;
        continue;
      }
      seen.add(key);
      perDate.set(date, seen);
    }
    const row = byModel.get(key) ?? { date, provider: generation.provider, model: generation.model, generations: 0, totalTokens: 0, cost: 0 };
    row.generations += 1;
    row.totalTokens += generation.usage.totalTokens;
    row.cost = round(row.cost + generation.usage.cost);
    byModel.set(key, row);
  }
  const all = [...byDate.keys()].sort();
  const capped = all.length > MAX_DATED_DATES;
  const retained = capped ? all.slice(all.length - MAX_DATED_DATES) : all;
  const kept = new Set(retained);
  return {
    dates: retained.map((date) => byDate.get(date) as DateUsageRow),
    models: [...byModel.values()]
      .filter((row) => kept.has(row.date))
      .sort((a, b) => a.date.localeCompare(b.date) || a.provider.localeCompare(b.provider) || a.model.localeCompare(b.model)),
    truncated: capped || unattributed || session.health.usage.dated === "partial",
    modelsTruncated,
  };
}
```

- [ ] **Step 4 — attach it (history, global, current)**

`src/ui/load-history.ts`: the available `SessionScan` variant gains
`usageByDate: readonly DateUsageRow[]; usageByDateTruncated: boolean`, filled right before the
return (`const dated = sessionDatedUsage(session);`), and `toHistoricalSession` copies both fields.
`loadGlobalReport` folds the same rows instead of walking report timestamps: delete
`usageEvents(report)` and build each date from the available sessions' `usageByDate` (sum
`totalTokens`/`cost`/`generations`/`tools`, count distinct sessions). `HistoricalSession`'s
available variant gains `usageByDate`/`usageByDateTruncated`.

`src/ui/current.ts`: `CurrentTuiModel` gains
`datedUsage?: { dates: DateUsageRow[]; models: DatedModelRow[]; truncated: boolean; modelsTruncated: boolean }`
and `createCurrentTuiModel(report, scope, datedUsage?)` takes it as an optional third argument.
`src/ui/load-current.ts` passes `sessionDatedUsage(session)` for the already-built session
(no extra parse, no extra build).

- [ ] **Step 5 — assert the cap, the truncation flag and the loaders**

```ts
// append to tests/unit/dated-usage.test.ts
// New helper for this file: `longSessionOptions({ days })` writes ONE manifest plus a
// marker-bearing JSONL with one usage-bearing generation per day into a fresh temp root
// and returns LoadHistoryOptions (reuse the manifest-writing style of
// tests/unit/history-reports.test.ts).
test("the retained window is capped and flagged", async () => {
  const history = await loadHistoryReports(await longSessionOptions({ days: 400 }));
  const session = history.sessions[0];
  assert.equal(session?.availability, "available");
  if (session?.availability !== "available") return;
  assert.equal(session.usageByDate.length, 366);
  assert.equal(session.usageByDateTruncated, true);
});

test("a short session is exact and not truncated", async () => {
  const history = await loadHistoryReports(await longSessionOptions({ days: 3 }));
  const session = history.sessions[0];
  if (session?.availability !== "available") throw new Error("expected available");
  assert.equal(session.usageByDateTruncated, false);
  assert.equal(session.usageByDate.reduce((sum, row) => sum + row.totalTokens, 0), session.report.usage?.totalTokens);
});
```

- [ ] **Step 6 — verify and commit**

`node --import tsx --test tests/unit/dated-usage.test.ts tests/unit/history-reports.test.ts && npm run format:check && npm run lint && npm run typecheck && npm test`

`git add src/ui/dated-usage.ts src/ui/load-history.ts src/ui/load-current.ts src/ui/current.ts tests/unit/dated-usage.test.ts tests/unit/history-reports.test.ts tests/fixtures/pi/0.85.1/mixed-usage.jsonl`
`git commit -m "feat: add one dated usage projection over the canonical attribution"`

## Task 5: Daily fold, capability table, identical-projection flag

**Files:** `src/ui/daily.ts` (new) · `src/ui/bundle.ts` · `src/ui/html.ts` (re-export only) ·
tests `tests/unit/bundle.test.ts`, `tests/unit/html.test.ts`

**Depends on:** Task 4.

**Interfaces (create here):** `DailyRow`, `buildDailyRows`; `CAPABILITIES`, `NO_CAPABILITIES`;
`CurrentView.capabilities/daily/dailyTruncated/datedModels/modelsTruncated/usageByDate`;
`InspectorBundle.current.sameReportProjection`; catalog keys `scope.active`, `scope.tree`,
`scope.active.note`, `scope.tree.note`, `scope.sameReport`.

**Size gate (P0-B).** Record `renderInspectorBundle(bundleFixture()).length` **before** the first
edit and again after Task 7; relative growth must be ≤ +15 %. Record both numbers, the fixture
path (`tests/fixtures/bundles/inspector-bundle.json`) and the delta in the task report.

- [ ] **Step 1 — failing test**

```ts
// append to tests/unit/bundle.test.ts
import { CAPABILITIES } from "../../src/ui/bundle.ts";

test("a view carries dated rows, per-date model rows and composition", async () => {
  const bundle = await loadInspectorBundle({ ...input, loadCurrent: async (scope) => modelFor(scope, ["2026-03-01T10:00:00.000Z", "2026-03-02T10:00:00.000Z"]) });
  const view = bundle.current.active;
  assert.deepEqual(view.daily?.map((row) => [row.date, row.generations, row.totalTokens]), [["2026-03-01", 1, 10], ["2026-03-02", 1, 10]]);
  assert.equal(view.daily?.[0]?.composition.generations.totalTokens, 10);
  assert.equal(view.daily?.[0]?.composition.toolResults.totalTokens, 0);
  assert.equal(view.dailyTruncated, false);
  assert.deepEqual(view.datedModels?.map((row) => [row.date, row.provider, row.model, row.totalTokens]), [
    ["2026-03-01", "acme", "alpha", 10],
    ["2026-03-02", "acme", "alpha", 10],
  ]);
  assert.equal(view.modelsTruncated, false);
});

test("model rows are capped per date and flagged", async () => {
  const models = Array.from({ length: 70 }, (_, index) => `model-${index}`);
  const bundle = await loadInspectorBundle({ ...input, loadCurrent: async (scope) => modelForMany(scope, models) });
  const view = bundle.current.active;
  const newest = view.datedModels?.at(-1)?.date;
  assert.equal(view.datedModels?.filter((row) => row.date === newest).length, 64);
  assert.equal(view.modelsTruncated, true);
});

test("an unavailable view advertises no capabilities and no dated rows", async () => {
  const bundle = await loadInspectorBundle({ ...input, loadCurrent: async () => undefined });
  assert.deepEqual(bundle.current.active.capabilities, []);
  assert.equal(bundle.current.active.datedModels, undefined);
  assert.equal(bundle.current.active.daily, undefined);
});

test("the capability table is data, not client prose", () => {
  assert.deepEqual([CAPABILITIES.global, CAPABILITIES.history], [["overview"], ["overview"]]);
  assert.ok(CAPABILITIES.current.includes("environment"));
  assert.deepEqual(CAPABILITIES.current.filter((tab) => tab === "commands" || tab === "skills"), []);
});

test("identical projections set the flag, divergent ones clear it", async () => {
  const same = await loadInspectorBundle({ ...input, loadCurrent: async (scope) => modelFor(scope, ["2026-03-01T10:00:00.000Z"]) });
  assert.equal(same.current.sameReportProjection, true);
  const different = await loadInspectorBundle({
    ...input,
    loadCurrent: async (scope) => modelFor(scope, scope === "active" ? ["2026-03-01T10:00:00.000Z"] : ["2026-03-01T10:00:00.000Z", "2026-03-02T10:00:00.000Z"]),
  });
  assert.equal(different.current.sameReportProjection, false);
});
```

Three existing helpers in `tests/unit/bundle.test.ts` need work as part of this step: `modelFor`
must pass a `datedUsage` projection to `createCurrentTuiModel` (otherwise `model.datedUsage` is
`undefined` and the existing 366-row cap test fails), `modelForMany(scope, models)` does not exist
and must be created (one generation per model name on the newest date, all usage-bearing),
and the existing daily-row expectation gains `composition`.

- [ ] **Step 2 — run and see it fail**

`node --import tsx --test tests/unit/bundle.test.ts`

- [ ] **Step 3 — implement the fold**

```ts
// src/ui/daily.ts
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
 * Sums per-session dated rows by date (spec §5.4, R19). It never reads a
 * timestamp: a session that cannot be dated contributes nothing and is counted
 * only by the coverage line. `truncated` is true when any contribution was capped
 * or partial, or when the fold itself exceeds MAX_DATED_DATES.
 */
export function buildDailyRows(
  contributions: readonly { sessionId: string; rows: readonly DateUsageRow[]; truncated: boolean }[],
): { rows: DailyRow[]; truncated: boolean } { /* sum by date, newest MAX_DATED_DATES, OR the flags */ }
```

`bundle.ts` deletes its private `dailyRows()` and `DailyRow` (both move here / to Task 4's module)
and re-exports `export type { DailyRow } from "./daily.ts";` so `src/ui/html.ts:4` keeps resolving.
`html.ts` keeps `buildDailyActivityRows` **only** for the legacy `renderHtml(HtmlReport)` adapter
(`:499`, `:1222` — no production caller) and for its history/global branch (`:1241`, which **is**
production) changes to folding `input.report.sessions[].usageByDate`; that legacy current-view
bucketing is the one documented exception to R19 (spec §5.4, §15).

```ts
// src/ui/bundle.ts
export const CAPABILITIES: Readonly<Record<"current" | "history" | "global", readonly string[]>> = {
  // `environment` replaces the separate commands/skills tabs; breakdowns across
  // sessions are deferred (spec §15), so aggregates expose overview only.
  current: ["overview", "models", "tools", "environment", "agents", "integrations", "errors", "ledger"],
  history: ["overview"],
  global: ["overview"],
};
const NO_CAPABILITIES: readonly string[] = [];

// inside currentView()
  const projection = model.datedUsage;
  const daily = projection === undefined ? undefined : buildDailyRows([
    { sessionId: model.report.sessionId, rows: projection.dates, truncated: projection.truncated },
  ]);
  return {
    availability: "available",
    report: model.report,
    ...(projection === undefined
      ? {}
      : { usageByDate: projection.dates, datedModels: projection.models, modelsTruncated: projection.modelsTruncated }),
    ...(daily === undefined ? {} : { daily: daily.rows, dailyTruncated: daily.truncated }),
    capabilities: CAPABILITIES.current,
  };
```

An absent projection means **absent keys**, never zero; the unavailable view keeps
`capabilities: NO_CAPABILITIES` and no rows.

- [ ] **Step 4 — identical-projection flag**

`loadInspectorBundle` returns `current: { active, tree, sameReportProjection: sameReportProjection(active, tree) }`,
where the helper compares `availability` (and `diagnostic` for unavailable views) and then a
stable `canonical(value)` serialization of `report`, `daily` and `datedModels` (sorted object
keys, arrays in documented order, `undefined` entries dropped). This step also adds the catalog
entries the copy needs (`scope.active: "Active path"`, `scope.tree: "Full session tree"`, the two
sub-labels, `scope.sameReport: "Active path and Full session tree produce the same report data for
this session."`); the client that renders them is Task 7.

- [ ] **Step 5 — verify and commit**

`node --import tsx --test tests/unit/bundle.test.ts tests/unit/html.test.ts && npm run format:check && npm run lint && npm run typecheck && npm test`

`git add src/ui/daily.ts src/ui/bundle.ts src/ui/html.ts tests/unit/bundle.test.ts tests/unit/html.test.ts`
`git commit -m "feat: fold the dated projection into daily rows and add the capability table"`

## Task 6: Pure range module

**Files:** `src/ui/range.ts` (new) · tests `tests/unit/range.test.ts` (new),
`tests/unit/report-range.test.ts` (new)

**Depends on:** nothing (pure); consumed by Tasks 7 and 13.

**Interfaces (create here):** `RangeState`, `RangeIntent`, `resolveRange`, `isInRange`,
`presetRange`, `shiftUtcDay`, `latestObservedDate`, `parseRangeQuery`, `serializeRangeQuery`,
`ViewRows`, `filterView`, `HistoryRowRange`, `historyRowRange`.

**Inlining constraint:** every exported function here is inlined into the document by
`Function.prototype.toString()`, so each must be self-contained — no module-scope constant, no
Node/DOM API. Declare constants inside the functions that use them.

- [ ] **Step 1 — failing test**

```ts
// tests/unit/range.test.ts
import assert from "node:assert/strict";
import { test } from "node:test";
import { filterView, historyRowRange, isInRange, latestObservedDate, parseRangeQuery, presetRange, resolveRange, serializeRangeQuery, shiftUtcDay, type RangeState } from "../../src/ui/range.ts";

const dates = ["2026-09-01", "2026-09-11", "2026-09-12"];

test("presets are anchored on the latest observed date, inclusively", () => {
  assert.deepEqual(presetRange(7, dates), { preset: 7, from: "2026-09-06", to: "2026-09-12" });
  assert.deepEqual(presetRange(14, dates), { preset: 14, from: "2026-08-30", to: "2026-09-12" });
  assert.deepEqual(presetRange(30, dates), { preset: 30, from: "2026-08-14", to: "2026-09-12" });
  assert.equal(presetRange(7, []), undefined);
});

test("boundaries are inclusive and defaults are span/14D", () => {
  assert.equal(isInRange("2026-09-12", { preset: null, from: "2026-09-12", to: "2026-09-12" }), true);
  assert.equal(isInRange("2026-09-11", { preset: null, from: "2026-09-12", to: "2026-09-12" }), false);
  assert.deepEqual(resolveRange(undefined, dates, "current"), { preset: null, from: "2026-09-01", to: "2026-09-12" });
  assert.deepEqual(resolveRange(undefined, dates, "aggregate"), { preset: 14, from: "2026-08-30", to: "2026-09-12" });
  assert.equal(resolveRange(undefined, [], "current"), undefined);
  assert.equal(resolveRange(undefined, [], "aggregate"), undefined);
});

test("a preset stays an unresolved intent until it meets a view's dates", () => {
  assert.deepEqual(parseRangeQuery("preset=7"), { kind: "preset", preset: 7 });
  assert.deepEqual(parseRangeQuery("preset=30&from=2026-09-01&to=2026-09-12"), { kind: "preset", preset: 30 });
  assert.deepEqual([parseRangeQuery("preset=99"), parseRangeQuery("preset=")], [undefined, undefined]);
  assert.deepEqual(serializeRangeQuery({ kind: "preset", preset: 7 }), [["preset", "7"]]);
  assert.equal(resolveRange({ kind: "preset", preset: 7 }, [], "current"), undefined);
});

test("a custom range survives only as a valid pair", () => {
  assert.deepEqual(parseRangeQuery("from=2026-09-01&to=2026-09-12"), { kind: "custom", from: "2026-09-01", to: "2026-09-12" });
  for (const query of ["", "from=2026-09-01", "to=2026-09-12", "from=2026-09-12&to=2026-09-01", "from=x&to=y", "preset=99"]) {
    assert.equal(parseRangeQuery(query), undefined, query);
  }
  assert.deepEqual(serializeRangeQuery({ kind: "custom", from: "2026-09-01", to: "2026-09-12" }), [["from", "2026-09-01"], ["to", "2026-09-12"]]);
});

test("no helper can produce the 1970 sentinel", () => {
  const pairs = [
    ...serializeRangeQuery({ kind: "custom", from: "2026-09-01", to: "2026-09-12" }),
    ...serializeRangeQuery({ kind: "preset", preset: 14 }),
  ];
  assert.equal(pairs.some(([, value]) => value.startsWith("1970")), false);
});

test("day shifting is UTC-stable and bad dates are ignored", () => {
  assert.equal(shiftUtcDay("2026-03-01", -1), "2026-02-28");
  assert.equal(shiftUtcDay("2026-01-01", -1), "2025-12-31");
  assert.equal(latestObservedDate(["bogus", "2026-09-12", "2026-09-01"]), "2026-09-12");
});

test("one filter decides every tab's rows", () => {
  const view = {
    rows: [{ date: "2026-09-01" }, { date: "2026-09-12" }],
    models: [{ date: "2026-09-01" }, { date: "2026-09-12" }],
    tools: [{ date: "2026-09-01" }, { date: "2026-09-12" }],
    agents: [{ observedAt: "2026-09-01T23:00:00.000Z" }, { observedAt: undefined }],
    errors: [{ timestamp: "2026-09-12T00:01:00.000Z" }],
  };
  const seven = filterView(view, presetRange(7, dates) as RangeState);
  assert.deepEqual([seven.rows.length, seven.models.length, seven.tools.length, seven.agents.length, seven.errors.length], [1, 1, 1, 0, 1]);
});

test("aggregate membership needs an in-range record, truncation decides first", () => {
  const usageRow = (date: string, totalTokens: number) => ({ date, totalTokens, cost: totalTokens / 100 });
  const range = { preset: null, from: "2026-09-01", to: "2026-09-12" };
  assert.deepEqual(historyRowRange({ usageByDate: [usageRow("2026-01-01", 10), usageRow("2026-09-12", 20)] }, range), { member: true, totalTokens: 20, cost: 0.2, partial: false });
  assert.deepEqual(historyRowRange({ usageByDate: [usageRow("2026-01-01", 10)] }, range), { member: false, totalTokens: 0, cost: 0, partial: false });
  const retained = { usageByDate: [usageRow("2029-06-21", 5)], usageByDateTruncated: true };
  assert.deepEqual(historyRowRange(retained, { preset: null, from: "2029-06-21", to: "2029-06-21" }), { member: true, totalTokens: 5, cost: 0.05, partial: false });
  assert.deepEqual(historyRowRange(retained, { preset: null, from: "2020-01-01", to: "2029-06-21" }), { member: true, totalTokens: 5, cost: 0.05, partial: true });
  assert.deepEqual(historyRowRange(retained, { preset: null, from: "2020-01-01", to: "2020-12-31" }), { member: false, totalTokens: null, cost: null, partial: true });
});
```

- [ ] **Step 2 — run and see it fail**

`node --import tsx --test tests/unit/range.test.ts`

- [ ] **Step 3 — implement**

Implement the module with the four functions `latestObservedDate`, `shiftUtcDay`, `presetRange`,
`resolveRange`, `isInRange`, `serializeRangeQuery`, `parseRangeQuery` (preset wins over a pair;
unknown/invalid preset, lone endpoint, malformed date or inverted pair all yield `undefined`), the
`RangeState`/`RangeIntent` types, `filterView` (keeps `rows`/`models`/`tools` by `date`,
`agents` by `observedAt`, `errors` by `timestamp`) and `historyRowRange` (truncation verdict
decided before the sum, `null` usage for a range entirely inside omitted history).

- [ ] **Step 4 — verify and commit**

`node --import tsx --test tests/unit/range.test.ts && npm run format:check && npm run lint && npm run typecheck && npm test`

`git add src/ui/range.ts tests/unit/range.test.ts`
`git commit -m "feat: add the pure range module with pair validation and UTC presets"`

## Task 7: One range filter and the scope copy in the client

**Files:** `src/ui/html.ts` (client range/scope wiring) · `src/ui/bundle.ts` (history projection
carries `usageByDate`) · tests `tests/unit/report-range.test.ts`, `tests/unit/html-bundle.test.ts`

**Depends on:** Tasks 4, 5, 6. The canonical row timestamps the client filters on
(`Tool.timestamp`, `AgentRun.observedAt`, `ErrorRecord.timestamp`) reach the projection in Task 8;
this task lands the single filter and the membership rule.

**Interfaces (create here):** catalog keys `range.truncated`, `range.restored`,
`history.dailyTruncated`, and the client-side `inPeriodRow`/`historyMetrics` helpers reading
`historyRowRange`. Closes the P0-B size gate.

- [ ] **Step 1 — failing test**

```ts
// tests/unit/report-range.test.ts (extend; `filterView`/`historyRowRange` unit cases live in range.test.ts)
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { reduceEntries } from "../../src/core/reduce.ts";
import { toSessionReport } from "../../src/core/reports.ts";
import { parseSessionJsonl } from "../../src/pi/adapter.ts";
import { filterView, type RangeState } from "../../src/ui/range.ts";

test("tool usage stays on the call day while its error is observed the next day", () => {
  const entries = parseSessionJsonl(readFileSync("tests/fixtures/pi/0.85.1/cross-midnight.jsonl", "utf8")).entries;
  const report = toSessionReport(reduceEntries("cross-midnight-session", entries));
  assert.deepEqual(
    [report.tools[0]?.timestamp, report.tools[0]?.usage?.totalTokens, report.errors[0]?.timestamp, report.errors[0]?.kind],
    ["2026-09-11T23:59:00.000Z", 2, "2026-09-12T00:01:00.000Z", "tool-error"],
  );
  const callDay = filterView({ rows: [], models: [], tools: report.tools, agents: [], errors: report.errors }, { preset: null, from: "2026-09-11", to: "2026-09-11" });
  const nextDay = filterView({ rows: [], models: [], tools: report.tools, agents: [], errors: report.errors }, { preset: null, from: "2026-09-12", to: "2026-09-12" });
  assert.deepEqual([callDay.tools.length, callDay.errors.length, nextDay.tools.length, nextDay.errors.length], [1, 0, 0, 1]);
});
```

```jsonl
// tests/fixtures/pi/0.85.1/cross-midnight.jsonl
{"type":"session","version":3,"id":"cross-midnight-session","timestamp":"2026-09-11T23:58:00.000Z","cwd":"/fixture"}
{"type":"custom","id":"marker","parentId":null,"timestamp":"2026-09-11T23:58:30.000Z","customType":"session-inspector:tracking-start","data":{"schemaVersion":1}}
{"type":"message","id":"g1","parentId":"marker","timestamp":"2026-09-11T23:59:00.000Z","message":{"role":"assistant","provider":"anthropic","model":"claude-x","content":[{"type":"toolCall","id":"call-1","name":"bash"}],"usage":{"input":10,"output":5,"cacheRead":0,"cacheWrite":0,"totalTokens":15,"cost":{"input":0.3,"output":0.2,"cacheRead":0,"cacheWrite":0,"total":0.5}}}}
{"type":"message","id":"r1","parentId":"g1","timestamp":"2026-09-12T00:01:00.000Z","message":{"role":"toolResult","toolCallId":"call-1","toolName":"bash","isError":true,"content":"sanitized","usage":{"input":1,"output":1,"cacheRead":0,"cacheWrite":0,"totalTokens":2,"cost":{"input":0.1,"output":0.15,"cacheRead":0,"cacheWrite":0,"total":0.25}}}}
```

```ts
// append to tests/unit/html-bundle.test.ts
test("client range wiring replaced the per-section period and the clamp", () => {
  const html = renderInspectorBundle(bundleFixture());
  for (const fragment of ["function filterView", "function historyRowRange", "const parseRangeQuery", "Range could not be restored; showing the default range."]) {
    assert.equal(html.includes(fragment), true, fragment);
  }
  assert.equal(/1970-01-01/.test(html), false);
  assert.equal(html.includes("periods[state.section]"), false);
});

test("scope copy names the ancestry and claims only report equality", () => {
  const html = renderInspectorBundle(bundleFixture());
  for (const fragment of ["Active path", "Full session tree", "Selected entry and its parent ancestry", "All tracked branches in this session"]) {
    assert.equal(html.includes(fragment), true, fragment);
  }
  assert.equal(/children/.test(html), false);
});
```

- [ ] **Step 2 — run and see it fail**

`node --import tsx --test tests/unit/report-range.test.ts tests/unit/html-bundle.test.ts`

- [ ] **Step 3 — inline the range module and rewire the client**

Add to the inlined-function list: `shiftUtcDay`, `latestObservedDate`, `presetRange`,
`resolveRange`, `isInRange`, `serializeRangeQuery`, `parseRangeQuery`, `filterView`,
`historyRowRange` (Task 14 adds the route functions to the same list). Replace the client's
`periods[state.section]` model with one range per **view identity** (`current`, `history:aggregate`,
`history:<sessionId>`, `global`) held in the client state; the active one is resolved through
`resolveRange(intent, observedDates, kind)`.

Required behaviour (spec §5.1-§5.6):

- presets anchor on `latestObservedDate` of the active view; no `1970-01-01` sentinel anywhere;
- custom dialog: both inputs required, `from <= to`, otherwise keep the dialog open and show
  `range.error` with no state change; **no clamping** to observed data;
- every tab renders from `filterView(...)`; the history list renders rows through
  `historyRowRange`, grouping `member === false && partial === true` rows under the
  `Unavailable · dates unknown` group;
- `dailyTruncated` (and any contributing `partial` row) shows the bounded truncation notice next
  to the range label;
- scope buttons and labels: `scope.active`/`scope.tree` retitle to the Task 5 catalog keys, the
  sub-label follows the pressed scope, and the same-projection note renders only when
  `data.current.sameReportProjection === true`.

- [ ] **Step 4 — expose the history rows to the browser**

`sectionProjection`'s history branch maps `usageByDate`/`usageByDateTruncated` into each session
row (they are already on `HistoricalSession` after Task 4); the global branch exposes its folded
`dates` with the same composition shape.

- [ ] **Step 5 — verify, record the size gate, commit**

`node --import tsx --test tests/unit/report-range.test.ts tests/unit/html-bundle.test.ts tests/unit/html.test.ts && npm run format:check && npm run lint && npm run typecheck && npm test`
Record the after-size and the relative delta in the task report (Task 5 recorded the baseline).

`git add src/ui/range.ts src/ui/html.ts src/ui/bundle.ts tests/unit/report-range.test.ts tests/unit/html-bundle.test.ts tests/fixtures/pi/0.85.1/cross-midnight.jsonl`
`git commit -m "feat: filter every tab through one range projection with honest aggregate membership"`

---

# Slice C — Browser semantic projection

## Task 8: Projection integrity — time, identity, role, error join

**Files:** `src/ui/html.ts` (`sessionView` ~946, `toolRows` ~904, `agentRows` ~917, `modelRows`
~824, the inline error map — one definition each) · tests `tests/unit/html-bundle.test.ts`,
`tests/unit/integration-privacy.test.ts`

**Depends on:** Task 7 (client state).

**Interfaces (create here):** `ToolRow.timestamp`; `AgentRow` gains
`agent`/`artifacts`/`observedAt`/`model`/`thinking`/`failure`/`evidenceToolId`;
`errorRows(report)` in `html.ts` returning `toolName`/`toolSource`/`relatedChildIds`.
This task defines the test helpers its tests need (`embedOf`, `currentModelWithAgents`,
`currentModelWithTools`, `modelWithToolError`, `modelWithToolErrorAndTwoChildren`); none exists.

- [ ] **Step 1 — failing test**

```ts
// append to tests/unit/html-bundle.test.ts — define a local `embedOf(html)` helper
// (decode the embedded payload with the same regex as `embeddedJson`) if you need it.
test("tool and agent rows keep time, role and identity", async () => {
  const html = renderInspectorBundle(await loadInspectorBundle({ ...input, loadCurrent: async () => currentModelWithAgents() }));
  const report = (embedOf(html).current.active as { report: { tools: Record<string, unknown>[]; agents: Record<string, unknown>[] } }).report;
  assert.ok("timestamp" in (report.tools[0] as Record<string, unknown>));
  const agent = report.agents[0] as Record<string, unknown>;
  for (const key of ["agent", "artifacts", "observedAt", "model", "thinking", "failure", "evidenceToolId"]) assert.ok(key in agent, key);
});

test("an error row is joined to its tool and to every child run that published through it", async () => {
  const html = renderInspectorBundle(await loadInspectorBundle({ ...input, loadCurrent: async () => modelWithToolErrorAndTwoChildren() }));
  const report = (embedOf(html).current.active as { report: { errors: Record<string, unknown>[] } }).report;
  const error = report.errors[0] as Record<string, unknown>;
  assert.deepEqual([error.toolName, error.toolSource, (error.relatedChildIds as unknown[]).length], ["bash", null, 2]);
});

test("the browser payload never carries producer text or paths", () => {
  const html = renderInspectorBundle(bundleFixture());
  for (const forbidden of ["task", "finalOutput", "progressSummary", "transcriptPath", "artifactPaths", "sessionFile"]) {
    assert.equal(html.includes(`"${forbidden}"`), false, forbidden);
  }
});
```

- [ ] **Step 2 — run and see it fail**

`node --import tsx --test tests/unit/html-bundle.test.ts`

- [ ] **Step 3 — implement**

`toolRows` passes `timestamp: tool.timestamp` through. `agentRows` passes every `AgentRun` field
through, defaulting absent ones to `null` (never `""` or a placeholder). The error map moves into
`errorRows(report)`: join `report.tools` by `error.id`, collect `relatedChildIds` from every run
whose `evidenceToolId === error.id` (one-to-many, no causal claim), and keep the bounded
`message` when present. Tables read only these rows; no `report.*` array access remains in the
client for table rendering.

- [ ] **Step 4 — verify and commit**

`node --import tsx --test tests/unit/html-bundle.test.ts tests/unit/integration-privacy.test.ts && npm run format:check && npm run lint && npm run typecheck && npm test`

`git add src/ui/html.ts tests/unit/html-bundle.test.ts tests/unit/integration-privacy.test.ts`
`git commit -m "feat: preserve agent role, observation time and tool timestamps in the browser projection"`

## Task 9: Agents semantics — child runs, activity, derived usage fraction

**Files:** `src/core/reports.ts` (`toSessionReport`) · `src/ui/html.ts` (`agentsPanel`) ·
tests `tests/unit/reports-integrations.test.ts`, `tests/unit/html-bundle.test.ts`

**Depends on:** Task 8.

**Interfaces (create here):** `SessionReport.agentUsage: { runsTotal: number; runsWithUsage: number }`.
Catalog keys `agents.childRuns`, `agents.succeeded`, `agents.failed`, `agents.interrupted`,
`agents.running`, `agents.unknown`, `agents.knownTokens`, `agents.knownCost`,
`agents.knownFailedCost`, `agents.usageFraction`, `panel.agentActivity`,
`agents.parentOutsideScope`, `agents.parentUnknown`.

**Ruling (do not deviate):** `agentUsage` is **derived from the projected run set** in
`toSessionReport`; it is **not** added to `SubagentEvidence` or any integration evidence type.
In the browser the fraction is derived from the **rendered** agent rows, so a range filter cannot
reuse a full-session fraction.

- [ ] **Step 1 — failing test**

```ts
// append to tests/unit/reports-integrations.test.ts — reuse this file's existing
// reduced-session/activity builders; if the names differ, adapt to whatever they are.
test("agent usage is derived from the projected run set and bounded", () => {
  const report = toSessionReport(reduced(), {
    agents: { state: "supported", runs: [
      { id: `subagent-${"a".repeat(64)}`, status: "succeeded", confidence: "cooperative", usage: { totalTokens: 5, cost: 0.05 } },
      { id: `subagent-${"b".repeat(64)}`, status: "failed", confidence: "cooperative" },
      { id: `subagent-${"c".repeat(64)}`, status: "running", confidence: "cooperative" },
    ] },
    agentActivity: unavailableActivity(),
  });
  assert.deepEqual(report.agentUsage, { runsTotal: 3, runsWithUsage: 1 });
});

test("an agent set with no usage reports zero of N, never a fabricated total", () => {
  const report = toSessionReport(reduced(), {
    agents: { state: "supported", runs: [{ id: `subagent-${"d".repeat(64)}`, status: "unknown", confidence: "cooperative" }] },
    agentActivity: unavailableActivity(),
  });
  assert.deepEqual(report.agentUsage, { runsTotal: 1, runsWithUsage: 0 });
});
```

```ts
// append to tests/unit/html-bundle.test.ts
test("the agents panel separates child runs from native agent tool activity", async () => {
  const html = renderInspectorBundle(await loadInspectorBundle({ ...input, loadCurrent: async () => modelWithActivityAndRuns({ calls: 174, runs: 23, runsWithUsage: 18 }) }));
  assert.match(html, /Child runs/);
  assert.match(html, /Agent tool activity/);
  assert.match(html, /18 of 23 runs reported usage/);
  assert.equal(/"label":"Agent calls"/.test(html), false);
});

test("child run statuses each keep their own bucket", async () => {
  const html = renderInspectorBundle(await loadInspectorBundle({ ...input, loadCurrent: async () => modelWithStatuses(["succeeded", "failed", "interrupted", "running", "unknown"]) }));
  for (const label of ["Child runs", "Succeeded", "Failed", "Interrupted", "Running", "Unknown"]) assert.match(html, new RegExp(label));
});

test("a parent outside the selected projection is labelled, not linked", async () => {
  const html = renderInspectorBundle(await loadInspectorBundle({ ...input, loadCurrent: async (scope) => (scope === "active" ? modelWithOrphanChild() : modelWithOrphanChildAndParent()) }));
  assert.match(html, /Parent: outside selected scope|agents\.parentOutsideScope/);
});
```

This task defines the `modelWith*` helpers its tests need (they do not exist).

- [ ] **Step 2 — run and see it fail**

`node --import tsx --test tests/unit/reports-integrations.test.ts tests/unit/html-bundle.test.ts`

- [ ] **Step 3 — derive the DTO fraction**

```ts
// src/core/reports.ts
export type SessionReport = { /* existing fields */ agentUsage: { runsTotal: number; runsWithUsage: number } };
// inside toSessionReport, from the already-projected run set:
const runsTotal = projectedAgents.length;
const runsWithUsage = projectedAgents.filter((run) => run.usage !== undefined).length;
```

Both counts are derived from validated rows, so they are non-negative safe integers by
construction; assert `runsWithUsage <= runsTotal` with a comment rather than inventing a clamp.
`agentUsage` is always present (0/0 for an empty set — the UI renders that as `Unavailable`,
never `$0.00`).

- [ ] **Step 4 — rebuild the panel**

`agentsPanel` shows, in order: (1) the child-run summary — `Child runs: N`, one metric per
non-zero status bucket, `Known child tokens`/`Known child cost` with the qualifier
`{withUsage} of {total} runs reported usage`, `Known failed-run cost` when a failed run reported
usage, and `Unavailable` whenever `withUsage === 0`; then the run table (Role | Status | Model |
Tokens | Cost | Artifacts | Parent); (2) a clearly separate `Agent tool activity` card with the
native call counts and per-tool rows. The fraction count comes from the **rendered** rows:

```js
var total = view.agents.length;
var withUsage = view.agents.filter(function (run) { return !!run.usage; }).length;
```

Parent resolution (spec §7.4): in-scope → anchor; present only in the tree projection → the
`agents.parentOutsideScope` label with no link; unknown → `agents.parentUnknown`. Child
`model`/`thinking` are detail metadata only — **no** Agent → Models link.

- [ ] **Step 5 — verify and commit**

`node --import tsx --test tests/unit/reports-integrations.test.ts tests/unit/html-bundle.test.ts && npm run format:check && npm run lint && npm run typecheck && npm test`

`git add src/core/reports.ts src/ui/html.ts tests/unit/reports-integrations.test.ts tests/unit/html-bundle.test.ts`
`git commit -m "feat: split child-run metrics from agent tool activity and derive the usage fraction"`

## Task 10: Tools summary and calls timeline

**Files:** `src/ui/html.ts` (client `detail()` tools branch) · test `tests/unit/html-bundle.test.ts`

**Depends on:** Task 8.

**Interfaces (create here):** catalog keys `tools.summary`, `tools.calls`, `tools.lastUsed`,
`tools.usageFraction`, `tools.filteredBy`, `tools.clearFilter`; internal `toolSummary(view)`,
`toolCalls(view, filter)`.

- [ ] **Step 1 — failing test**

```ts
// append to tests/unit/html-bundle.test.ts
test("tools summary aggregates and the calls view keeps real timestamps", async () => {
  const html = renderInspectorBundle(await loadInspectorBundle({ ...input, loadCurrent: async () => currentModelWithTools() }));
  assert.match(html, /tools\.summary|Tools summary/);
  assert.match(html, /2026-03-01T10:00:00\.000Z/);
  assert.match(html, /tools\.lastUsed|Last used/);
});

test("partial tool usage is stated, never extrapolated", async () => {
  const html = renderInspectorBundle(await loadInspectorBundle({ ...input, loadCurrent: async () => currentModelWithPartialToolUsage() }));
  assert.match(html, /1 of 3 calls reported usage/);
  assert.match(html, /Known tokens/);
});

test("tool tables never render arguments or result bodies", async () => {
  const html = renderInspectorBundle(await loadInspectorBundle({ ...input, loadCurrent: async () => currentModelWithHostileToolArguments() }));
  assert.equal(/SECRET_ARGUMENT|SECRET_RESULT/.test(html), false);
});
```

- [ ] **Step 2 — run and see it fail**

`node --import tsx --test tests/unit/html-bundle.test.ts`

- [ ] **Step 3 — implement both views over one projection**

`toolSummary(view)` groups `view.tools` by name (`calls`, `succeeded`, `failed`, `interrupted`,
`tokens`, `cost`, `withUsage`, `lastUsed` = max timestamp, first known `source`), sorted by name.
`toolCalls(view, filter)` filters by name and sorts newest first. The summary rows are anchors
that set the calls filter; the calls table renders `Time | Tool | Source | Status | Tokens |
Cost | Duration`. Missing usage and missing live duration render `Unavailable` — duration only
when `durationEvidence === "supported"`, never estimated from neighbouring timestamps.
This task defines the test helpers its tests need (`currentModelWithTools`,
`currentModelWithPartialToolUsage`, `currentModelWithHostileToolArguments`); the first is shared
with Task 8, so define each helper once and reuse it.

- [ ] **Step 4 — verify and commit**

`node --import tsx --test tests/unit/html-bundle.test.ts && npm run format:check && npm run lint && npm run typecheck && npm test`

`git add src/ui/html.ts tests/unit/html-bundle.test.ts`
`git commit -m "feat: add tools summary and calls timeline over the canonical projection"`

## Task 11: Errors — identity-first rendering and one-to-many children

**Files:** `src/ui/html.ts` (client errors branch + error detail) · tests
`tests/unit/html-bundle.test.ts`, `tests/unit/error-ledger.test.ts`

**Depends on:** Tasks 8 (join), 9 (child links).

**Interfaces (create here):** catalog keys `errors.failed`, `errors.toolFailed`,
`errors.relatedTool`, `errors.relatedChildren`, `errors.messageUnavailable`,
`errors.generation`, `errors.message`.

- [ ] **Step 1 — failing test**

```ts
// append to tests/unit/html-bundle.test.ts
test("a tool error leads with the tool identity, not the internal id", async () => {
  const html = renderInspectorBundle(await loadInspectorBundle({ ...input, loadCurrent: async () => modelWithToolError() }));
  assert.match(html, /bash failed/);
  assert.match(html, /tool-error/);
  assert.equal(/<td[^>]*>tool:call-1</.test(html), false);
});

test("a tool error without a safe message says Unavailable", async () => {
  const html = renderInspectorBundle(await loadInspectorBundle({ ...input, loadCurrent: async () => modelWithToolError() }));
  assert.match(html, /Message: Unavailable|errors\.messageUnavailable/);
});

test("related child runs are one-to-many and never causal", async () => {
  const html = renderInspectorBundle(await loadInspectorBundle({ ...input, loadCurrent: async () => modelWithErrorAndThreeChildren() }));
  assert.equal((html.match(/data-child-link=/g) ?? []).length, 3);
  assert.equal(/caused by|cause of/.test(html), false);
});

test("a generation error keeps its bounded redacted message", async () => {
  const html = renderInspectorBundle(await loadInspectorBundle({ ...input, loadCurrent: async () => modelWithGenerationError("Request failed at [URL]") }));
  assert.match(html, /Request failed at \[URL\]/);
});
```

- [ ] **Step 2 — run and see it fail**

`node --import tsx --test tests/unit/html-bundle.test.ts`

- [ ] **Step 3 — render**

Headline: `<tool name> failed` when the joined tool is known, else the error kind. Detail panel:
kind, confidence, UTC timestamp, tool name, tool source, tool status, a link to the tool call,
`Related child run(s)` listing every candidate as an anchor labelled with its role (or
`Unavailable`) — zero candidates omits the section entirely — and `Message:` from the bounded
redacted `message` when present, otherwise `Unavailable` (never text from `content`, arguments or
child output). The raw `tool:call_…` id stays in the details, not the first column.
This task defines the test helpers its tests need (`modelWithErrorAndThreeChildren`,
`modelWithGenerationError`); `modelWithToolError` is Task 8's.

- [ ] **Step 4 — verify and commit**

`node --import tsx --test tests/unit/html-bundle.test.ts tests/unit/error-ledger.test.ts && npm run format:check && npm run lint && npm run typecheck && npm test`

`git add src/ui/html.ts tests/unit/html-bundle.test.ts tests/unit/error-ledger.test.ts`
`git commit -m "feat: present tool errors by identity with deterministic one-to-many child links"`

## Task 12: Environment grouping and four-column integrations

**Files:** `src/ui/html.ts` (tab strip, environment panel, integrations panel) · test
`tests/unit/html-bundle.test.ts`

**Depends on:** Task 5 (capabilities).

**Interfaces (create here):** catalog keys `tab.environment`, `env.commands`, `env.skills`,
`env.resources`, `env.available`, `env.observed`, `env.invocationsUnavailable`,
`env.invocationsObserved`, `env.sources`, `env.note`, `integration.detected`,
`integration.telemetry`, `integration.activity`, `integration.version`, `integration.sessionTotal`,
`integration.reasonUnsupported`, `integration.reasonMissing`, `integration.noteNotDetected`;
internal `environmentPanel(view, title)`, `integrationsTable(view)`.

- [ ] **Step 1 — failing test**

```ts
// append to tests/unit/html-bundle.test.ts
test("inventory renders as environment with no activity claim", async () => {
  const html = renderInspectorBundle(await loadInspectorBundle({ ...input, loadCurrent: async () => modelWithInventory() }));
  assert.match(html, /Available: 119/);
  assert.match(html, /Observed invocations: Unavailable/);
  assert.match(html, /Explicit invocations observed: 3/);
  assert.equal(/119 (used|invoked|calls)/.test(html), false);
});

test("integrations render four independent columns", async () => {
  const html = renderInspectorBundle(await loadInspectorBundle({ ...input, loadCurrent: async () => modelWithIntegrations() }));
  for (const label of ["Detected", "Telemetry", "Activity", "Version", "Session total"]) assert.match(html, new RegExp(label));
});

test("an absent producer with persisted telemetry stays a valid row", async () => {
  const html = renderInspectorBundle(await loadInspectorBundle({ ...input, loadCurrent: async () => modelWithAbsentDetectedTelemetry() }));
  assert.match(html, /no telemetry observed in this session|no compatible telemetry evidence/);
  assert.match(html, /producer not detected in current inventory/);
});
```

- [ ] **Step 2 — run and see it fail**

`node --import tsx --test tests/unit/html-bundle.test.ts`

- [ ] **Step 3 — implement**

One `environmentPanel` renders the summary lines (`Commands Available: n · Observed invocations:
Unavailable`, `Skills Available: n · Explicit invocations observed: m`,
`Resources Sources: n`) plus the three inventory tables behind a sub-navigation, with search
kept. Inventory is environment state: no inventory count is ever presented as usage, and it is
never range-filtered. `integrationsTable` renders `Integration | Detected | Telemetry | Activity |
Version` with the closed telemetry reasons
(`integration.reasonUnsupported` for `unsupported`, `integration.reasonMissing` for `unavailable`),
the non-state note `producer not detected in current inventory` for `presence === "absent"`,
counters verbatim as `key: value` pairs labelled `Session total`, `Unavailable` for an absent
counter object, and a validated integer or `Unavailable` for the version — never `0`.
This task defines the test helpers its tests need (`modelWithInventory`, `modelWithIntegrations`,
`modelWithAbsentDetectedTelemetry`).

- [ ] **Step 4 — verify and commit**

`node --import tsx --test tests/unit/html-bundle.test.ts && npm run format:check && npm run lint && npm run typecheck && npm test`

`git add src/ui/html.ts tests/unit/html-bundle.test.ts`
`git commit -m "feat: group inventory under environment and split integration detection from telemetry"`

---

# Slice D — Route and cross-navigation

## Task 13: Pure route module

**Files:** `src/ui/route.ts` (new) · test `tests/unit/route.test.ts` (new)

**Depends on:** Task 6 (`RangeState`, range query helpers).

**Interfaces (create here):** `EntityRef`, `InspectorRoute`, `parseRoute`, `serializeRoute`,
`routeKey`, `deriveView`. Inlined later (Task 14), so the same self-containment rule as
`src/ui/range.ts` applies.

- [ ] **Step 1 — failing test**

```ts
// tests/unit/route.test.ts
import assert from "node:assert/strict";
import { test } from "node:test";
import { deriveView, parseRoute, routeKey, serializeRoute, type InspectorRoute } from "../../src/ui/route.ts";

const capabilities = { current: ["overview", "models", "tools", "environment", "agents", "integrations", "errors", "ledger"], history: ["overview"], global: ["overview"] };
const observed = ["2026-09-01", "2026-09-11", "2026-09-12"];
const defaults = { scope: "active" as const, capabilities, knownIds: new Set(["tool:call-abc", "subagent-aaaa"]) };

test("a route round-trips with the canonical parameter order", () => {
  const route: InspectorRoute = {
    section: "current", tab: "tools", scope: "tree",
    range: { kind: "preset", preset: 7 },
    entity: { kind: "tool", id: "tool:call-abc" },
    table: { query: "bash", sort: "cost" },
  };
  const hash = serializeRoute(route);
  assert.equal(hash, "#/current/tools?scope=tree&preset=7&entity=tool%3Atool%3Acall-abc&q=bash&sort=cost");
  assert.deepEqual(parseRoute(hash, defaults).route, route);
  assert.equal(routeKey(parseRoute(hash, defaults).route), hash);
});

test("a preset stays unresolved in the hash and resolves against the view's dates", () => {
  const { route } = parseRoute("#/current/tools?scope=tree&preset=7", defaults);
  assert.deepEqual(route.range, { kind: "preset", preset: 7 });
  assert.equal(serializeRoute(route), "#/current/tools?scope=tree&preset=7");
  assert.deepEqual(deriveView(route, capabilities, observed).range, { preset: 7, from: "2026-09-06", to: "2026-09-12" });
});

test("a view with nothing observed has no range and no sentinel", () => {
  const view = deriveView(parseRoute("#/current/tools", defaults).route, capabilities, []);
  assert.equal(view.range, undefined);
  assert.equal(/1970-01-01/.test(serializeRoute(parseRoute("#/current/tools", defaults).route)), false);
});

test("custom ranges round-trip; lone or inverted endpoints fall back with a notice", () => {
  const route: InspectorRoute = { section: "current", tab: "tools", scope: "tree", range: { kind: "custom", from: "2026-09-01", to: "2026-09-12" } };
  assert.equal(serializeRoute(route), "#/current/tools?scope=tree&from=2026-09-01&to=2026-09-12");
  assert.deepEqual(parseRoute(serializeRoute(route), defaults).route.range, route.range);
  for (const hash of ["#/current/tools?from=2026-09-01", "#/current/tools?from=2026-09-12&to=2026-09-01", "#/current/tools?preset=99"]) {
    const parsed = parseRoute(hash, defaults);
    assert.deepEqual([parsed.route.range, parsed.notice], [undefined, "range-restored"], hash);
  }
});

test("unsupported sections and tabs degrade with a notice", () => {
  const global = parseRoute("#/global/models", defaults);
  assert.deepEqual([global.route.tab, global.notice], ["overview", "tab-unavailable"]);
  const unknown = parseRoute("#/nope/overview", defaults);
  assert.deepEqual([unknown.route.section, unknown.notice], ["current", "section-unavailable"]);
});

test("unknown ids are dropped, never echoed", () => {
  assert.equal(parseRoute("#/current/tools?entity=agent%3ASECRET%20TEXT", defaults).route.entity, undefined);
});

test("deriveView exposes exactly the state that drives rendering", () => {
  const view = deriveView({ section: "global", tab: "models", scope: "tree", range: { kind: "preset", preset: 30 } }, capabilities, observed);
  assert.deepEqual([view.activeSection, view.activeTab, view.notice, view.focusTarget], ["global", "overview", "tab-unavailable", "section-heading"]);
  assert.deepEqual([view.visibleTabs, view.range], [["overview"], { preset: 30, from: "2026-08-14", to: "2026-09-12" }]);
});
```

- [ ] **Step 2 — run and see it fail**

`node --import tsx --test tests/unit/route.test.ts`

- [ ] **Step 3 — implement**

Parameter order `scope, preset, from, to, session, entity, q, sort`; `scope` serialized only for
`current`; a preset serializes alone; `from`/`to` only as a validated pair; unknown params
ignored; `parseRoute` validates section/tab against the capability table, drops unknown entity
ids, and returns the notice codes `section-unavailable` / `tab-unavailable` / `range-restored`;
`deriveView` resolves the range against the view's dates and returns
`{ activeSection, activeTab, visibleTabs, scope, range?, entity?, notice?, focusTarget }`.

- [ ] **Step 4 — verify and commit**

`node --import tsx --test tests/unit/route.test.ts && npm run format:check && npm run lint && npm run typecheck && npm test`

`git add src/ui/route.ts tests/unit/route.test.ts`
`git commit -m "feat: add the pure route module with capability-aware parsing and canonical serialization"`

## Task 14: Client routing — inlined modules, one `applyLocation`, derived active state

**Files:** `src/ui/html.ts` (module inlining, client bootstrap, `render()`) · `src/ui/bundle.ts`
(capabilities in the payload) · tests `tests/unit/html-navigation.test.ts` (new),
`tests/unit/html-bundle.test.ts`

**Depends on:** Tasks 6, 13.

**Interfaces (create here):** inline list extended with the route functions;
`inlineModuleSource()`, exported `assertInlinedModulesEvaluate()`; `applyLocation()`, `navigate()`;
`data.capabilities` in the payload; catalog key `range.restored` (already in Task 7) and
`nav.entityFocus` (Task 15).

- [ ] **Step 1 — failing test**

```ts
// tests/unit/html-navigation.test.ts (new) — this file defines its own bundleFixture()
// by reading tests/fixtures/bundles/inspector-bundle.json, like html-bundle.test.ts.
test("the document inlines the same pure modules the tests import", () => {
  const html = renderInspectorBundle(bundleFixture());
  for (const fragment of ["const parseRoute=", "const serializeRoute=", "const filterView=", "const deriveView="]) {
    assert.equal(html.includes(fragment), true, fragment);
  }
});

test("no active-state attribute is hardcoded in the initial markup", () => {
  const body = renderInspectorBundle(bundleFixture()).split("<body")[1] ?? "";
  for (const attribute of ["aria-current=", "aria-selected="]) assert.equal(body.includes(attribute), false, attribute);
});

test("the document embeds the capability table", () => {
  const parsed = JSON.parse(/"capabilities":(\{.*?\})/.exec(renderInspectorBundle(bundleFixture()))?.[1] as string) as Record<string, string[]>;
  assert.deepEqual([parsed.global, parsed.current.includes("environment")], [["overview"], true]);
});

test("one event path handles hashchange and popstate without double rendering", () => {
  const html = renderInspectorBundle(bundleFixture());
  assert.match(html, /function applyLocation\(/);
  assert.equal((html.match(/addEventListener\("hashchange"/g) ?? []).length, 1);
  assert.equal((html.match(/addEventListener\("popstate"/g) ?? []).length, 1);
  assert.match(html, /if\(key===lastAppliedKey\)return/);
});

test("the emitted script is complete and callable without a DOM", () => {
  assert.doesNotThrow(() => assertInlinedModulesEvaluate());
});
```

- [ ] **Step 2 — run and see it fail**

`node --import tsx --test tests/unit/html-navigation.test.ts`

- [ ] **Step 3 — inline and rewire**

```ts
// src/ui/html.ts
const INLINED_FUNCTIONS = [
  shiftUtcDay, latestObservedDate, presetRange, resolveRange, isInRange,
  serializeRangeQuery, parseRangeQuery, filterView, historyRowRange,
  serializeRoute, routeKey, parseRoute, deriveView,
] as const;

function inlineModuleSource(): string { return INLINED_FUNCTIONS.map((fn) => String(fn)).join("\n"); }

/** Evaluates the emitted source with no DOM and no imports, so an inlined helper
 *  that reaches for module scope fails in a test instead of in the browser. */
export function assertInlinedModulesEvaluate(): void { /* new Function(source)() and call two of them */ }
```

Client state becomes the route: `parseRoute(location.hash, { scope: data.initialScope,
capabilities: data.capabilities, knownIds })`, `render()` derives everything from `deriveView`,
and the only writers are `navigate(route)` (sets `location.hash`) and `applyLocation()`. One
`applyLocation` is bound to both `hashchange` and `popstate` and returns early when the canonical
route key is unchanged, so one navigation renders exactly once. Click handlers only mutate the
route; `aria-current`/`aria-selected`/`aria-pressed`, the visible tab set, the search/sort
values and the range controls are all written from the derived view. Inactive view ranges and
per-table settings live in an ephemeral in-memory cache keyed by `(section,tab)`, never in the
deep link. Keyboard: sidebar/tabs are anchors (`<a href="#/…">`); focus moves to the section
heading on a section change and is not stolen by a range-only change.

- [ ] **Step 4 — verify and commit**

`node --import tsx --test tests/unit/html-navigation.test.ts tests/unit/html-bundle.test.ts && npm run format:check && npm run lint && npm run typecheck && npm test`

`git add src/ui/html.ts src/ui/bundle.ts tests/unit/html-navigation.test.ts tests/unit/html-bundle.test.ts`
`git commit -m "feat: drive the document from one inlined route with derived active state"`

## Task 15: Cross-navigation links and entity focus

**Files:** `src/ui/html.ts` · test `tests/unit/html-navigation.test.ts`

**Depends on:** Task 14.

**Interfaces (create here):** `routeFor(patch)`, `linkRow(kind, id, label)`, `tabFor(kind)`,
`focusEntity(view)`; catalog key `nav.entityFocus`.

- [ ] **Step 1 — failing test**

```ts
// append to tests/unit/html-navigation.test.ts
test("rows link to their destination with the route context preserved", () => {
  const html = renderInspectorBundle(bundleFixture());
  assert.match(html, /href="#\/current\/models\?scope=/);
  assert.match(html, /entity=tool%3A/);
  assert.match(html, /\.entity-focus\{/);
  assert.match(html, /classList\.add\("entity-focus"\)/);
});

test("there is no Agent to Models link", () => {
  const html = renderInspectorBundle(bundleFixture());
  const agentBlock = html.slice(html.indexOf("function agentsTable"), html.indexOf("function toolsCallsTable"));
  assert.equal(/#\/current\/models|entity=model/.test(agentBlock), false);
});

test("an entity anchor carries an id already present in the payload", () => {
  const html = renderInspectorBundle(bundleFixture());
  const ids = new Set([...html.matchAll(/"id":"((?:tool|subagent)[^"]+)"/g)].map((match) => match[1]));
  for (const match of html.matchAll(/entity=[^"&]*%3A([^"&]+)/g)) assert.ok(ids.has(decodeURIComponent(match[1] as string)), match[1]);
});
```

- [ ] **Step 2 — run and see it fail**

`node --import tsx --test tests/unit/html-navigation.test.ts`

- [ ] **Step 3 — implement the links**

Destinations (spec §9.4): overview model row → Models (entity focus); overview tool row → Tools
summary; tool summary row → Tools calls filtered by that tool; failed tool call → Errors with the
matching error focused; error row → related tool call or `Related child run(s)`; agent row →
parent/child run; integration row → its detail panel; command/skill/resource row → the environment
sub-section. Each link is an anchor built with `routeFor`, carrying `data-entity="<kind>:<id>"`;
after render the focused entity gets the `entity-focus` class (visible focus ring) and is focused
unless the change was range-only. Non-linked labels stay plain text.

- [ ] **Step 4 — verify and commit**

`node --import tsx --test tests/unit/html-navigation.test.ts && npm run format:check && npm run lint && npm run typecheck && npm test`

`git add src/ui/html.ts tests/unit/html-navigation.test.ts`
`git commit -m "feat: add cross-navigation links with entity focus and context preservation"`

---

# Slice E — Autocomplete

## Task 16: Span-aware scanner and raw-prefix completion values

**Files:** `src/commands/grammar.ts`, `src/commands/completions.ts` · tests
`tests/unit/command-grammar.test.ts`, `tests/unit/command-completions.test.ts`

**Depends on:** nothing (independent of the client script). Task 20 in the previous numbering is
merged here: the boundary regression is Task 17.

**Interfaces (create here):** `RawToken { raw, text, start, end, quoted }`, `scanInspectorArgs`;
`tokenizeInspectorArgs` becomes a projection of the scanner; completion items carry the rewritten
raw prefix as `value` and the bare token as `label`.

**Migration note.** `tests/unit/command-completions.test.ts` currently asserts `item.value` equals
the bare token (`values("ui -")` → `["--scope", …]`). After this task `value` is the rewritten
argument text, so that file must switch its intent assertions to `item.label` (semantics
unchanged) and keep `value` assertions only in the new tests below. `tests/unit/command-grammar.test.ts`
is the parity guard: its existing tokenization expectations must keep passing untouched.

- [ ] **Step 1 — failing tests**

```ts
// append to tests/unit/command-grammar.test.ts
test("scanned tokens carry raw spans and the parser's own text", () => {
  const scanned = scanInspectorArgs('ui --output "/tmp/my report.json" --th');
  assert.deepEqual(scanned?.tokens.map((token) => [token.raw, token.start, token.end, token.quoted]), [
    ["ui", 0, 2, false],
    ["--output", 3, 11, false],
    ['"/tmp/my report.json"', 12, 35, true],
    ["--th", 36, 40, false],
  ]);
  assert.equal(scanned?.tokens[2]?.text, "/tmp/my report.json");
  assert.equal(scanned?.trailingWhitespace, false);
});

test("the scanner keeps the parser's quote behaviour exactly", () => {
  const single = scanInspectorArgs("json history --output '/tmp/a b.json'");
  assert.deepEqual([single?.tokens.at(-1)?.text, single?.tokens.at(-1)?.quoted], ["/tmp/a b.json", true]);
  const midToken = scanInspectorArgs('ui --output="/tmp/a b.json" --th');
  assert.deepEqual(midToken?.tokens.map((token) => token.text), ["ui", "--output=/tmp/a b.json", "--th"]);
  assert.equal(midToken?.tokens[1]?.raw, '--output="/tmp/a b.json"');
  assert.equal(scanInspectorArgs('ui --output="/tmp/a b.json'), undefined);
});

test("the stripped tokenizer is a projection of the scanner", () => {
  const prefix = 'json history --output "/tmp/a b.json" ';
  assert.deepEqual(tokenizeInspectorArgs(prefix)?.tokens, ["json", "history", "--output", "/tmp/a b.json"]);
  assert.equal(tokenizeInspectorArgs(prefix)?.trailingWhitespace, scanInspectorArgs(prefix)?.trailingWhitespace);
});
```

```ts
// append to tests/unit/command-completions.test.ts
// Migrate the file's existing `values()` helper to `labels()` (assert `item.label`) so the
// suggestion-set tests keep their intent; add the value assertions below.
test("completion values rewrite the raw prefix instead of re-joining tokens", () => {
  const items = completeInspectorCommand('ui --output "/tmp/my report.json" --th');
  assert.deepEqual(items?.map((item) => item.value), ['ui --output "/tmp/my report.json" --theme']);
  assert.equal(items?.[0]?.label, "--theme");
});

test("a trailing space keeps the quotes and offers the next token", () => {
  const items = completeInspectorCommand('json history --output "/tmp/a b.json" ');
  assert.ok(items?.every((item) => item.value.startsWith('json history --output "/tmp/a b.json"')));
});

test("an option already present is not offered again", () => {
  const items = completeInspectorCommand("ui --theme dark --");
  assert.deepEqual([items?.some((item) => item.label === "--theme"), items?.some((item) => item.label === "--scope")], [false, true]);
});
```

- [ ] **Step 2 — run and see it fail**

`node --import tsx --test tests/unit/command-grammar.test.ts tests/unit/command-completions.test.ts`

- [ ] **Step 3 — implement the scanner**

```ts
// src/commands/grammar.ts
export type RawToken = { raw: string; text: string; start: number; end: number; quoted: boolean };

/**
 * One scanner serves the parser and the completer. It reproduces the parser's
 * tokenization exactly: whitespace splits tokens, `"` and `'` toggle quoting
 * anywhere inside a token, quote characters never enter `text`, no escapes.
 * `raw` is the original span (used for replacement), `text` the parser value
 * (used for matching). Returns undefined for an unterminated quote.
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
    let text = "";
    let quote: string | undefined;
    let quoted = false;
    while (index < prefix.length) {
      const current = prefix[index] as string;
      if (quote !== undefined) {
        if (current === quote) quote = undefined;
        else text += current;
        index += 1;
        continue;
      }
      if (current === '"' || current === "'") {
        quote = current;
        quoted = true;
        index += 1;
        continue;
      }
      if (/\s/.test(current)) break;
      text += current;
      index += 1;
    }
    if (quote !== undefined) return undefined;
    tokens.push({ raw: prefix.slice(start, index), text, start, end: index, quoted });
  }
  return { tokens, trailingWhitespace: prefix.length > 0 && trailingWhitespace };
}

/** Now a projection of the scanner, so parsing and completion cannot drift. */
export function tokenizeInspectorArgs(prefix: string): { tokens: string[]; trailingWhitespace: boolean } | undefined {
  const scanned = scanInspectorArgs(prefix);
  return scanned === undefined ? undefined : { tokens: scanned.tokens.map((token) => token.text), trailingWhitespace: scanned.trailingWhitespace };
}
```

- [ ] **Step 4 — implement the values**

```ts
// src/commands/completions.ts
/** Replaces only the current raw token span; every preceding character survives. */
function withReplacement(prefix: string, span: { start: number; end: number }, replacement: string): string {
  return prefix.slice(0, span.start) + replacement + prefix.slice(span.end);
}

/** `current` is the token's parser text (empty for the trailing span). */
function items(values: readonly string[], current: string, prefix: string, span: { start: number; end: number }): AutocompleteItem[] | null {
  const matches = values.filter((value) => value.startsWith(current));
  if (matches.length === 0) return null;
  return matches.map((value) => ({ value: withReplacement(prefix, span, value), label: value }));
}
```

`completeInspectorCommand` keeps its control flow and `null` returns; it locates the current
token's span (the empty span at the end when the prefix ends in whitespace) and passes it to
`items`. Grammar decisions keep using `tokenizeInspectorArgs`.

- [ ] **Step 5 — verify and commit**

`node --import tsx --test tests/unit/command-grammar.test.ts tests/unit/command-completions.test.ts && npm run format:check && npm run lint && npm run typecheck && npm test`

`git add src/commands/grammar.ts src/commands/completions.ts tests/unit/command-grammar.test.ts tests/unit/command-completions.test.ts`
`git commit -m "feat: rebuild completion values from raw argument spans"`

## Task 17: Pi autocomplete boundary regression

**Files:** `tests/unit/command-completion-application.test.ts` (new),
`tests/unit/helpers/pi-autocomplete.ts` (new; the directory does not exist yet)

**Depends on:** Task 16.

**Interfaces (create here):** `applyCompletionFor(line, cursor, label)` driving the real
`CombinedAutocompleteProvider` from `@earendil-works/pi-tui@0.85.1` (already installed as a
peerDependency — **no `package.json` change**).

- [ ] **Step 1 — write the helper and the failing test**

```ts
// tests/unit/helpers/pi-autocomplete.ts
import { CombinedAutocompleteProvider } from "@earendil-works/pi-tui";
import { completeInspectorCommand } from "../../../src/commands/completions.ts";

const provider = new CombinedAutocompleteProvider(
  [{ name: "session-inspector", getArgumentCompletions: (prefix: string) => completeInspectorCommand(prefix) }],
  "/tmp",
);

/** Drives the real provider: suggest → select → apply, exactly as the editor does. */
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
    const result = await applyCompletionFor(line, line.length, label);
    assert.deepEqual([result.line, result.cursor], [expected, expected.length], line);
  }
});

test("a mid-token cursor keeps the text after the cursor intact", async () => {
  const applied = await applyCompletionFor("/session-ins ui --theme", "/session-ins ui --the".length, "--theme");
  assert.deepEqual([applied.line, applied.cursor], ["/session-ins ui --theme", "/session-ins ui --theme".length]);
});

test("mode completion replaces the whole empty argument region", async () => {
  const applied = await applyCompletionFor("/session-ins ", "/session-ins ".length, "ui");
  assert.deepEqual([applied.line, applied.cursor], ["/session-ins ui", "/session-ins ui".length]);
});
```

- [ ] **Step 2 — verify the dependency and the failure mode**

`node -e 'import("@earendil-works/pi-tui").then(m => console.log(m.CombinedAutocompleteProvider.name))'`
Expected: `CombinedAutocompleteProvider`.

Then, with the span-based implementation temporarily reverted to `{ value, label: value }`, the
third case must fail with `/session-ins --theme` — proving the test detects the original defect.
Restore immediately.

- [ ] **Step 3 — verify and commit**

`node --import tsx --test tests/unit/command-completion-application.test.ts && npm run format:check && npm run lint && npm run typecheck && npm test`

`git add tests/unit/command-completion-application.test.ts tests/unit/helpers/pi-autocomplete.ts`
`git commit -m "test: prove completion token replacement through the real Pi provider"`

---

# Slice F — Presentation, release, final verification

## Task 18: Table presentation polish

**Files:** `src/ui/html.ts` (`STYLES` ~419 + table rendering) · test `tests/unit/html-bundle.test.ts`

**Depends on:** Tasks 8-12 (tables exist).

**Interfaces (create here):** column classes `num`, `wrap`, `id-cell`, `status-cell`; catalog key
`table.copyId`.

- [ ] **Step 1 — failing test**

```ts
// append to tests/unit/html-bundle.test.ts
test("numbers right-align, messages wrap, ids truncate but stay copyable", () => {
  const html = renderInspectorBundle(bundleFixture());
  assert.match(html, /\.num\{text-align:right/);
  assert.match(html, /\.wrap\{white-space:normal/);
  assert.match(html, /\.id-cell\{[^}]*text-overflow:ellipsis/);
  assert.match(html, /data-full-id="/);
  assert.match(html, /table\.copyId/);
  assert.equal(/table\{width:100%;border-collapse:collapse;text-align:left;white-space:nowrap\}/.test(html), false);
  assert.equal(/td:last-child\{text-align:right\}/.test(html), false);
});

test("no decorative dashboard was added", () => {
  const html = renderInspectorBundle(bundleFixture());
  assert.equal(/sparkline|gauge|donut|hero-chart/.test(html), false);
});
```

- [ ] **Step 2 — run and see it fail**

`node --import tsx --test tests/unit/html-bundle.test.ts`

- [ ] **Step 3 — replace the global rules with column classes**

```css
table{width:100%;border-collapse:collapse;text-align:left}
th,td{padding:13px 22px;border-top:1px solid var(--line);vertical-align:top}
.num{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}
.wrap{white-space:normal}
.id-cell{max-width:18ch;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-family:var(--mono)}
.status-cell{white-space:nowrap}
```

Every numeric/token/cost column gets `class="num"`, description/message columns `class="wrap"`,
opaque ids `class="id-cell" data-full-id="<id>"` plus a copy control, and status/identity columns
`class="status-cell"`. No new summary cards.

- [ ] **Step 4 — verify and commit**

`node --import tsx --test tests/unit/html-bundle.test.ts && npm run format:check && npm run lint && npm run typecheck && npm test`

`git add src/ui/html.ts tests/unit/html-bundle.test.ts`
`git commit -m "feat: align and wrap table columns per column type"`

## Task 19: ADR 0017, v1 spec section, CHANGELOG, version 0.9.0

**Files:** `docs/architecture/adr/0017-report-coverage-attribution-and-navigation.md` (new),
`docs/architecture/adr/README.md`, `docs/specs/pi-session-inspector-v1.md`, `CHANGELOG.md`,
`package.json`, `package-lock.json` · no test

**Depends on:** every implementation task (documents their contracts).

- [ ] **Step 1 — ADR 0017** (status: accepted) recording: session coverage with the
  unknown-denominator rule; logical-call attribution implemented once in the canonical builder and
  projected, never re-derived; one `usageByDate` truncation/partial flag; the derived
  `agentUsage` fraction (never on integration evidence); environment vs activity separation; route
  authority with ephemeral caches; no Agent → Models link; autocomplete full-argument rewrite; no
  new persistence. Add the row to the ADR index in its existing format.

- [ ] **Step 2 — v1 spec** gains a “Report semantics” subsection stating the coverage contract and
  wording rules, the attribution table, range/scope defaults, capability-driven tabs, route
  authority and the unsupported/deferred list. Keep every existing section.

- [ ] **Step 3 — CHANGELOG and version**

```markdown
## 0.9.0

- Coverage: session coverage with bounded per-session reasons, capped-discovery honesty, and
  `Known`/`Unavailable` wording instead of unqualified totals.
- Range: one shared range projection for every tab, per-view ranges, validated custom-range hash
  round-trips, logical-call timestamp attribution.
- Agents/Tools/Errors: child-run metrics separated from native agent tool activity, the child usage
  fraction derived from the rendered runs, `Related child run(s)` joins, errors led by tool identity.
- Projection: agent role, artifact state, observation time, tool timestamps and per-date
  model/composition rows reach the browser through one canonical projection.
- Navigation: authoritative hash route with Back/Forward, deep links, capability-filtered tabs,
  entity focus.
- Environment/Integrations: inventory grouped as environment; detection, telemetry, activity and
  version shown independently.
- Completion: `/session-inspector` completion preserves every preceding argument, quoted values included.
```

`npm version 0.9.0 --no-git-tag-version`, then `npm pack --dry-run 2>&1 | tail -5` →
`pi-session-inspector-0.9.0.tgz`, no `tests/`, no `.superpowers`, no `.pi`.

- [ ] **Step 4 — commit**

`git add docs/architecture/adr/0017-report-coverage-attribution-and-navigation.md docs/architecture/adr/README.md docs/specs/pi-session-inspector-v1.md CHANGELOG.md package.json package-lock.json`
`git commit -m "docs: record coverage, attribution and navigation decisions and bump to 0.9.0"`

## Task 20: Privacy corpus, determinism, fixtures, publication regressions, UAT

**Files:** `tests/unit/integration-privacy.test.ts`, `tests/unit/uat-evidence.test.ts`,
`tests/unit/subagents.test.ts`, `tests/fixtures/bundles/inspector-bundle.json` · whole suite

**Depends on:** every implementation task.

- [ ] **Step 1 — subagent publication regressions (moved out of the retired work)**

`tests/unit/subagents.test.ts` already covers joined publication (“counts only subagent tool calls
and their joined results”). Add only what is missing, keeping each case single-purpose and
asserting real values:

```ts
// append to tests/unit/subagents.test.ts — reuse this file's existing `resultEntry`/
// `callEntry` helpers (adapt the names to what the file actually has).
test("a joined run carries the publishing entry's observation time and canonical tool id", () => {
  const evidence = readSubagentEvidence([
    callEntry({ id: "a1", at: "2026-09-11T23:59:00.000Z", callId: "call-1", name: "subagent" }),
    resultEntry({ id: "r1", at: "2026-09-12T00:01:00.000Z", callId: "call-1", name: "subagent", details: { results: [{ runId: "run-1", success: true }] } }),
  ]);
  assert.deepEqual([evidence.runs[0]?.observedAt, evidence.runs[0]?.evidenceToolId], ["2026-09-12T00:01:00.000Z", "tool:call-1"]);
});

test("a result that cannot be joined publishes no run", () => {
  const evidence = readSubagentEvidence([
    resultEntry({ id: "r1", at: "2026-09-12T00:01:00.000Z", callId: undefined, name: "subagent", details: { results: [{ runId: "run-1", success: true }] } }),
  ]);
  assert.equal(evidence.runs.length, 0);
});

test("a call without a result publishes no run while activity still counts it", () => {
  const evidence = readSubagentEvidence([callEntry({ id: "a1", at: "2026-09-11T23:59:00.000Z", callId: "call-1", name: "subagent" })]);
  assert.deepEqual([evidence.runs.length, evidence.activity.calls], [0, 1]);
});
```

Record in the task report which of the three already existed. This is the only regression coverage
that survives from the retired `observedAt`/`evidenceToolId` task — the derivation itself already
ships in v0.8.0 and is not reimplemented.

- [ ] **Step 2 — privacy corpus**

Define the two helpers this step needs in the test file if they are not already there:
`hostileBundle()` returns the fixture bundle with hostile producer strings planted in fields that
must not be projected, and `bundleWithHostileStrings(markup)` plants `markup` in the bundle's
string fields.

```ts
// append to tests/unit/integration-privacy.test.ts
test("the browser payload never carries raw producer text or paths", () => {
  const html = renderInspectorBundle(hostileBundle());
  for (const forbidden of ["SECRET_PROMPT", "SECRET_TASK", "SECRET_RESULT", "SECRET_ARGUMENT", "SECRET_OUTPUT",
    "progressSummary", "finalOutput", "transcriptPath", "artifactPaths", "sessionFile", "/home/", "https://"]) {
    assert.equal(html.includes(forbidden), false, forbidden);
  }
});

test("hostile strings cannot break out of the inlined payload", () => {
  assert.equal(/<\/script><script>alert\(1\)/.test(renderInspectorBundle(bundleWithHostileStrings('</script><script>alert(1)</script>'))), false);
});
```

- [ ] **Step 3 — determinism and fixtures**

Define `input`/`hostileBundle`-style fixtures locally where they are missing, following the
pattern of the file you are editing.

```ts
// append to tests/unit/uat-evidence.test.ts
test("two identical generations are byte-identical", async () => {
  const first = renderInspectorBundle(await loadInspectorBundle(input));
  const second = renderInspectorBundle(await loadInspectorBundle(input));
  assert.equal(first, second);
});
```

Add `tests/fixtures/reports/coverage-partial.json` (5 of 27, reasons), `coverage-capped.json`
(206 inspected, capped), `tests/fixtures/pi/0.85.1/long-session.jsonl` (>366 observed days, marker
first), and refresh `tests/fixtures/bundles/inspector-bundle.json` so it carries `capabilities`,
`datedModels`, `daily[].composition`, `coverage` and `sameReportProjection`. Assert the second
partial cause as well: a session whose `evidenceHealth.usage.dated === "partial"` reports
`usageByDateTruncated === true`.

- [ ] **Step 4 — full verification**

```bash
npm run format:check && npm run lint && npm run typecheck && npm test && npm pack --dry-run
```

Expected: clean; `# fail 0`; the tarball name carries `0.9.0`.

- [ ] **Step 5 — manual UAT (record each result in the task report)**

1. `/session-inspector ui` → current overview renders; no coverage panel on a selected session.
2. Switch to **Full session tree**; the note appears only when the projections match.
3. Custom range: validation, inclusive UTC boundaries, and the cross-midnight fixture on both
   adjacent single days (tool usage on the call day, error on the observation day).
4. Agents: `Child runs` ≠ `Agent tool activity`; the usage fraction follows the filtered rows;
   one-to-many `Related child run(s)`; no Agent → Models link.
5. Errors: follow a tool link and a child link; `Message: Unavailable` for tool errors.
6. Back/Forward and reload of a deep link restore content **and** active styling; a custom-range
   hash round-trips; a lone/inverted pair falls back with the notice.
7. History/Global: `Known native cost` / `5 / 27 sessions`; capped wording when applicable;
   `Unavailable` (never `$0.00`) when nothing is available.
8. `/session-inspector json history` carries `coverage`, per-session `reason` and
   `usageByDateTruncated`.
9. `/session-ins ui --output "/tmp/my report.json" --th` + TAB completes `--theme` keeping the quote.
10. The generated HTML opens with networking disabled and issues no network request.
11. A session with `usageByDateTruncated`/`dated === "partial"` reads `Known` for ranges reaching
    into omitted history, never `$0` or complete.
12. P0-B size gate: record the before/after `renderInspectorBundle(bundleFixture()).length` and the
    relative delta (≤ +15 %).

- [ ] **Step 6 — commit**

`git add tests/ package.json package-lock.json`
`git commit -m "test: extend the privacy corpus, add coverage fixtures, and verify the milestone"`

---

## Review history (audit trail, not an execution contract)

- v2 amendments (2026-09-12): re-baselined onto v0.8.0; Tasks 4/10 retired as already shipped;
  coverage renamed `SessionCoverage` (R18); one dated projection (R19); coverage reasons map onto
  existing codes (R20); version 0.9.0 / ADR 0017.
- Independent review passes found 13 + 6 issues (invalid fixture usage shape, forward references,
  duplicated `SafeUsage`/`DailyRow` definitions, a scanner that dropped single-quote parity,
  undeclared test helpers) — all closed in this v3 rewrite.
- v3 (this file): historic task bodies deleted; retired work removed from the sequence; every task
  states its own Files/Interfaces/Steps/Verification/Commit; `agentUsage` is report-derived rather
  than integration-evidence state; the mixed-usage fixture carries a real tracking marker.
