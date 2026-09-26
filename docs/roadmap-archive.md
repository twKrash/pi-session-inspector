# Pi Session Inspector Roadmap Archive

Completed roadmap material lives here so `docs/roadmap.md` can stay focused on
current and future work. Normative behavior remains in the ADRs and product
spec; release history remains in `CHANGELOG.md`.

## Completed milestones

| Milestone | Status | Durable record |
| --- | --- | --- |
| M0 — package skeleton | Complete | [package contract](../tests/unit/package-contract.test.ts) |
| M1 — replay-to-JSON | Complete | [ADR 0016](architecture/adr/0016-evidence-foundation-and-canonical-session-model.md) |
| M2 — live tracking | Complete | [ADR 0004](architecture/adr/0004-per-writer-wal.md), [ADR 0010](architecture/adr/0010-telemetry-protocol-v1.md) |
| M3 — checkpoint, recovery, history | Complete | [ADR 0005](architecture/adr/0005-checkpoints-and-reconciliation.md) |
| M4 — current TUI and ledger | Complete | [ADR 0003](architecture/adr/0003-derived-ledger.md) |
| M5 — integration and agent roll-up | Complete | [ADR 0007](architecture/adr/0007-subagent-rollup.md) |
| M6 — HTML, i18n, export | Complete | [CHANGELOG](../CHANGELOG.md#040) |
| M7 — sealing, retention, scale | Complete; release gates deferred | [M7 benchmark baseline](benchmarks/m7-baseline.md) |
| Evidence coverage and resource inventory | Complete in `0.7.0` | [CHANGELOG](../CHANGELOG.md#070) |
| Evidence foundation and canonical session model | Complete in `0.8.0` | [ADR 0016](architecture/adr/0016-evidence-foundation-and-canonical-session-model.md) |
| Report semantics, diagnostics, and navigation | Complete in `0.9.0` | [ADR 0017](architecture/adr/0017-report-coverage-attribution-and-navigation.md) |
| M8 — hardening and release | Complete in `1.0.0` | [1.0.0 RC evidence package](release/1.0.0-rc-evidence.md) |

## M8 — hardening and release

**Status:** Complete. `1.0.0` was published to npm as
`@twkrash/pi-session-inspector@1.0.0` and released on GitHub as `v1.0.0` on the
release commit `e907d95`; the registry's `dist.shasum` and `dist.integrity`
match the qualified candidate, and the published artifact was installed from the
registry and exercised. The steps below are the procedure that was followed.

Post-release hardening adds what this milestone could not assume: continuous
integration (`.github/workflows/ci.yml`, two required jobs plus a next-major Node
job), a tag-triggered publish workflow (`.github/workflows/release.yml`), and
branch protection on `main` requiring a pull request, one approval, and the
`quality` and `test` checks.

M8 consumes the immutable release-candidate evidence package from Pre-M8.7. It
must not silently repeat the entire qualification suite under a different name.
M8 owns final candidate verification and publication:

1. Verify the release commit, package candidate, and package hash are unchanged
   from the accepted Pre-M8.7 evidence. If production-affecting code or package
   contents changed, re-run the affected Pre-M8.7 gates before continuing.
2. Complete final public documentation, release notes, CHANGELOG/version checks,
   supported-Pi review, migration review, and accepted-risk review.
3. Configure and run the final CI/release workflow, including the already
   accepted qualification evidence and publication checks.
4. Publish the exact qualified npm artifact with 2FA; configure and validate the
   exact-repository trusted-publisher/OIDC provenance path.
5. Create the Git tag/GitHub release when applicable, then install and verify
   the actual published npm artifact rather than only the local tarball.

The original v1 implementation plan served M8 as an execution/history guide only
where later accepted ADRs, durable specs, and roadmap decisions had not
superseded it; it was reviewed against the published commit and retired in
`1.3.0`.

## Pre-M8 readiness sequence

These are separate, ordered sub-milestones. Each has its own small deliverables,
review gate, and optional patch release. No sub-milestone installs a dependency
or changes production behavior merely because a tool suggested it.

### Pre-M8.1 — repository and documentation hygiene

**Status:** Complete. **Order:** First.

Remove execution-process material from the tracked product surface while
preserving durable decisions and keeping the active M8 plan available until M8
finishes.

**Deliverables**

1. Classify tracked documentation as durable product/architecture material or
   local execution material; record any missing durable links in the roadmap.
2. Promote any still-needed decisions from tracked `docs/superpowers/**` into
   the appropriate ADR, product spec, benchmark record, README, CHANGELOG, or
   this roadmap.
3. Remove tracked `docs/superpowers/**` specs/plans from Git. Keep local
   `.superpowers/**` ignored and available for future execution work.
4. Keep `docs/plans/pi-session-inspector-v1-implementation.md` available during
   M8 because it is the active execution/history guide where not superseded.
   Its retirement was not a Pre-M8.1 deliverable or acceptance condition, and it
   was retired later, by the post-M8 cleanup tail below.
5. Normalize the ignore policy to explicit directory entries:
   `.superpowers/` and `docs/superpowers/`. Remember that `.gitignore` does not
   untrack files already committed.
6. Repair documentation links and verify that no tracked file depends on a
   deleted Superpowers path.

**Acceptance gates**

- Both execution-material locations are untracked:
  `test -z "$(git ls-files docs/superpowers)"` and
  `test -z "$(git ls-files .superpowers)"`.
- `.gitignore` contains the explicit directory entries `.superpowers/` and
  `docs/superpowers/`; this cleanup also verifies that ignore rules are not
  mistaken for untracking.
- Tracked documentation contains durable ADRs, product specs, benchmark
  records, roadmap, README, CHANGELOG, necessary research material, and the
  explicitly temporary v1 M8 execution plan.
- No Pre-M8.1 acceptance condition depends on M8 completion. The plan stayed
  tracked through M8 as a stated temporary exception, and was retired afterwards
  by the post-M8 cleanup tail.
- No session data, prompts, outputs, credentials, or execution logs enter Git;
  documentation links and package-facing docs pass review.

#### Post-M8 cleanup tail (not a Pre-M8.1 gate)

Completed in `1.3.0`; recorded as the procedure that was followed:

1. The final implementation plan was reviewed against the published commit. Its
   durable content was confirmed to already live elsewhere — the module
   boundaries in the spec's L0/L1/L2 sections and the enforced
   `.dependency-cruiser.cjs` edges, the dependency and fixture discipline in
   `CONTRIBUTING.md` and this roadmap, the milestone outcomes in the CHANGELOG,
   the ADRs, and the benchmark and release records — so no historical material
   needed promoting beyond the milestone table's durable-record column.
2. Every link that pointed to the plan was repaired: the `README.md`
   documentation index, the `CONTRIBUTING.md` and `AGENTS.md` read-first lists,
   the spec's risk section, this roadmap's completed-milestone table, and the
   two roadmap passages that described the plan's temporary status.
3. `docs/plans/pi-session-inspector-v1-implementation.md` was removed from Git,
   together with the now-empty `docs/plans/` directory.
4. Verified: no tracked file references the removed path, and this roadmap
   remains the historical milestone record. The file is still reachable through
   Git history (`git log --follow docs/plans/pi-session-inspector-v1-implementation.md`),
   so it was removed rather than archived in-tree: a tracked, unmaintained plan
   is exactly what readers would mistake for current design authority.

**Release:** compatible documentation cleanup may bump the next patch version;
the roadmap-only change itself does not.

### Pre-M8.2 — static inventory and dead-code cleanup

**Status:** Complete. **Depends on:** Pre-M8.1.

Use static analysis to find unused exports, files, dependencies, and duplicated
code, but treat every finding as a hypothesis. Dynamic registration, Pi
extension loading, reflection, generated HTML, public package exports, tests,
and compatibility shims can look unused while remaining required.

**Deliverables**

1. Run `knip` against the supported package, test, benchmark, and extension
   entry points. Produce a bounded inventory report with each finding labelled
   `accepted`, `false-positive`, `intentional`, or `needs-investigation`.
2. Validate every `knip` finding against imports, runtime registration,
   package exports, Pi discovery, generated output, and tests before deletion.
3. Run `jscpd` over the relevant TypeScript/test/benchmark sources. Separate
   meaningful duplicated logic from fixtures, generated strings, test data, and
   intentional parallel projections.
4. Apply only accepted removals or simplifications in small, independently
   reviewed PRs. Add or retain a regression check for each removed path that
   protects a public command, report DTO, privacy boundary, or invariant.
5. Keep raw audit output local unless a finding changes a durable architecture,
   security, or release decision; promote only that decision to an ADR,
   roadmap, spec, or CHANGELOG.

**Outcome:** Knip now records validated manual/test seams and intentional type
contracts; seven stale exports/types were removed. The jscpd source clones were
reviewed without a safe production extraction.

**Acceptance gates**

- Every proposed deletion has a human-validated disposition; no blind bulk
  deletion from `knip` or `jscpd` output.
- `npm test`, format, lint, typecheck, and package checks remain green after
  each cleanup slice.
- No public Pi command, exporter, report DTO, lazy ledger path, integration
  adapter, or runtime registration is removed without an explicit contract
  decision.
- Duplication is reduced only where the replacement preserves deterministic
  output, privacy, and scope semantics.

**Release:** each compatible cleanup slice may bump the next patch version.

### Pre-M8.3 — architecture, invariant, and reconciliation audit

**Status:** Complete. **Depends on:** Pre-M8.2.

Establish machine-enforced module boundaries and verify that canonical
reconciliation, scope, range, coverage, privacy, and renderer projections have
one authoritative owner. This audit defines the contracts that Pre-M8.5 will
turn into executable checks; it does not replace those checks.

**Deliverables**

1. Map actual imports and runtime registration paths. Compare the result with
   the documented direction and boundaries: source adapters/storage/integrations
   feed core, reports and projections feed UI, and command registration only
   composes boundaries.
2. Evaluate `dependency-cruiser` as a dev-time rule checker. Encode only
   verified forbidden edges, such as core importing Pi/UI/I/O, renderers
   re-deriving business rules, storage writing Pi source data, or adapters
   bypassing privacy/canonical layers. Record intentional exceptions explicitly.
3. Trace one report from Pi/native and Inspector evidence through L0, L1, L2,
   `loadInspectorBundle`, JSON, HTML, and TUI. Identify duplicate folds,
   divergent scope/range logic, and places where unavailable evidence can be
   mistaken for zero.
4. Use Graphify for structural/document relationship exploration and
   context-mode for bounded source/report analysis. Treat inferred graph edges
   and tool suggestions as leads requiring code or documentation confirmation.
5. Split accepted architecture fixes and rule additions into small PRs; keep
   pure audit reports local unless a durable rule or decision is promoted.

**Acceptance gates**

- `dependency-cruiser` rules run deterministically and every exception has an
  owner, reason, and bounded scope.
- Each canonical invariant has one producing layer and named consumers; no
  second renderer-side reconciliation path remains unexplained.
- Audit confirms Pi source-of-truth, observer-only, privacy, active/tree scope,
  non-additive child usage, and unavailable-evidence boundaries.
- Findings are classified as accepted, false-positive, intentional, deferred,
  or unsupported; no automated tool output is applied blindly.

**Release:** compatible rule/audit changes may bump the next patch version.

### Pre-M8.4 — ephemeral localhost UI, normal client, and immutable snapshots

**Status:** Complete (`0.10.0`). **Depends on:** Pre-M8.3.
**Must precede:** HTML optimization and release hardening.

Replace the fragile browser-side report logic in interactive `ui` with a small,
read-only localhost application. Make `snapshot` the only immutable HTML
artifact command. This is an in-process command facility, not a background
product service.

**Authority and adoption gate**

Pre-M8.4 owns the accepted transport boundary. ADR 0018, the v1 spec, this
roadmap, README, command help, and CHANGELOG must remain mirrored before the
implementation PR. The design preserves existing L0/L1/L2, privacy,
availability, coverage, attribution, scope, navigation, usage, deterministic,
and autocomplete contracts. No implementation may merge until the written
records have received final user approval; no later bundler decision may reopen
whether the localhost server exists.

**Product surfaces and command boundary**

- `ui` is exclusively the interactive localhost application. It starts or
  reuses one lazy server, opens a tokenized URL, and rejects `--output`.
- `snapshot current|history|global|session <sessionId>` is the only immutable
  HTML artifact command and requires an explicit target. `snapshot` never
  starts the server. It renders one already-resolved L2 projection and remains
  self-contained/offline through `file://`.
- `snapshot current` accepts `--scope active|tree` and range options;
  `snapshot history|global` accept range options and are full-tree;
  `snapshot session <sessionId>` is atomic and rejects scope/range options.
  Range input is either `--preset 7|14|30` or a complete `--from`/`--to` pair.
- `--output` is valid only for `snapshot` and `json`. Without it, snapshots use
  the generated report cache under `session-inspector/v1/reports/`; explicit
  output is user-owned. `--no-open` suppresses only the platform opener. It
  does not suppress generation, server startup, or path/URL notification.
- `json` remains deterministic and `tui` remains interactive. Their report
  semantics and output contracts are unchanged.

**Required boundary**

- Use Node's built-in `node:http` and `node:crypto` facilities. Do **not** add
  Express, Fastify, a generic query DSL, runtime TypeScript, or another server
  framework. The separately evaluated client build may use build-time tooling;
  it must not become a runtime server or browser dependency.
- `/session-ins ui` starts one ephemeral server instance for that Pi process,
  binds only to `127.0.0.1:0`, prints/opens its tokenized URL, and exposes an
  explicit `close()` path for tests. No daemon, service, autostart, global
  listener, or cross-process server is allowed.
- `loadInspectorBundle()` remains the only aggregate report loader. A
  `/api/v1/ui` request calls it once and runs TypeScript L2 projection to emit
  one `InspectorUiSnapshot` containing Current active/tree, History, and
  Global. JSON, TUI, API, and snapshot renderers never re-derive report state.
- Independent `/api/v1/reports/sessions/{sessionId}` and
  `/api/v1/reports/global` requests are independent observations; no
  cross-request snapshot guarantee exists. The session resource is one bounded
  atomic `SessionReport` and rejects `scope` and range input; range returns
  `400 range-not-supported`.
- L2 owns scope, ranges, attribution, aggregation, coverage, truncation,
  evidence health, unavailable-vs-zero semantics, and native/child usage.
  HTTP handlers own only routing, bounded validation, callbacks, auth, and
  serialization. Browser code owns interaction/presentation only.
- Interactive assets are three known files under `src/ui/web/`: `shell.html`,
  `style.css`, and generated `client.js`. The latter is a deterministic
  build-time bundle from readable route/range/client sources under
  `scripts/web/`; it does not use `Function.prototype.toString()` or runtime
  module loading.
- Browser-local theme preference is allowed; the server persists no preference
  and accepts no arbitrary state mutation.

**HTTP/security contract**

- Use only Node `node:http` and `node:crypto`. Shell/assets allow `GET` and
  `HEAD`; `/api/v1/*` allows `GET` only. No POST/PUT/PATCH/DELETE mutation API,
  generic query DSL, redirect, or arbitrary filesystem/path route exists.
- Bind only to `127.0.0.1:0`. Validate exact `Host` and loopback peer for every
  request; reject malformed/missing/non-loopback values. Normalize only the
  equivalent IPv4-mapped loopback representation. Do not add IPv6/private-
  network exceptions or trust forwarded headers.
- The initial URL is
  `http://127.0.0.1:<port>/#token=<token>`. Generate `<token>` with at least
  256 random bits (`randomBytes(32)` encoded bounded base64url). The fragment
  is not sent in HTTP and the token remains in memory only.
- The shell and known static assets are unauthenticated because they contain no
  report, session, user, evidence, filesystem, or other Inspector-derived data.
  Every report-bearing API request uses exactly one bounded
  `Authorization: Bearer <token>` credential. Reject missing, malformed,
  oversized, expired, or incorrect credentials without echoing them.
- Before route parsing, consume exactly `#token=<token>`, retain its value only
  in memory, and use `history.replaceState()` to replace it with the canonical
  default route without adding history. The token fragment is never route
  state, export state, diagnostics, or a Back/Forward-restorable fragment.
  Reloading the sanitized route loses authentication and requires a fresh URL.
- Validate a present `Origin` against exact
  `http://127.0.0.1:<port>`; reject `null`, aliases, and other origins. Missing
  Origin is allowed for documented shell/static-asset navigations after Host/
  peer validation; non-browser/internal protected API calls may omit it only
  after Host/peer and bearer-auth validation. Disable CORS.
- Server responses use restrictive same-origin CSP equivalent to
  `default-src 'self'`; `script-src 'self'`; `style-src 'self'`;
  `connect-src 'self'`; `object-src 'none'`; `base-uri 'none'`;
  `form-action 'none'`; `frame-ancestors 'none'`. Snapshot CSP is separate:
  no executable JavaScript/network permission and only the exact stylesheet
  hash may be allowed.
- Capability tokens, token-bearing URLs/fragments, auth headers, report
  payloads, paths, and raw exceptions never enter logs, diagnostics, referrers,
  exported HTML, persisted Inspector state, or other durable storage. Use
  no-store/no-cache and no-referrer protections.
- WSL2-to-Windows-browser localhost forwarding is an explicit UAT case. If it
  presents a non-loopback peer, record the conflict; do not weaken validation
  preemptively.

**Logging and error reporting**

- Add one bounded diagnostic path using existing standard output/error
  facilities; do not introduce a logging framework for this feature.
- Transport failures return bounded RFC 9457-style `application/problem+json`
  with fixed safe fields/codes, status, retryability, and opaque correlation
  id. Report-level degradation remains an HTTP 200 DTO state.
- Startup, asset, API, refresh, and snapshot/export failures log only event
  code, phase, bounded status, correlation/request id, and
  `redactBoundedText`-sanitized bounded reason. Token-bearing URLs, auth
  headers, paths, report payloads, and raw exceptions never leave the process.
- `/session-ins ui` reports concise actionable startup/render failure instead
  of silently failing. The browser renders bounded error state with retry
  guidance and correlation id. Inspector errors remain isolated from Pi.
- Logging is best-effort and must not block or change command/agent flow.

**Semantic/UI compatibility requirements**

The migration must preserve the existing browser contracts, not merely make a
page load:

- hash route authority, canonical deep links, active sidebar/tab state,
  capability-driven tabs, Back/Forward behavior, entity cross-navigation and
  focus, search/sort route semantics, and safe degraded/unavailable/unsupported
  rendering;
- active/tree scope and per-view range intent, including 7D/14D/30D presets,
  complete validated custom ranges, remembered view state, and inclusive range
  membership; each UI projection carries its own resolved range metadata;
- `#token=...` bootstrap consumption before route parsing, canonical
  `replaceState` transition without a history entry, in-memory auth only, and
  no Back/Forward restoration of the token fragment;
- immutable snapshots contain one resolved projection only and do not provide
  offline navigation, refresh, range runtime, API/auth runtime, or executable
  JavaScript;
- the pinned autocomplete contract: preserve preceding argument text and quoted
  values, retain the real provider-boundary mid-token limitation test, and do
  not claim Inspector can fix Pi's provider-side append behaviour;
- one canonical `loadInspectorBundle`/L2 projection path, with no browser-only
  business-rule arithmetic, duplicate reconciliation, or new renderer-specific
  evidence semantics. Snapshot HTML escapes each value for its output context.

Existing route/navigation/range/autocomplete tests should continue unchanged
where possible. Replace a test only when the replacement gives equivalent or
stronger coverage, and keep the pinned provider limitation documented.

**Small deliverables**

1. Server lifecycle, route/method allowlist, exact loopback Host/peer/origin
   validation, token handling, shutdown, and security tests; no report
   migration yet.
2. TypeScript L2 `InspectorUiSnapshot` projection and protected UI/session/
   global API with strict range validation, bounded Problem Details, and
   request-time callbacks.
3. Normal browser assets with token bootstrap, canonical route transition,
   loading/error states, API refresh, per-view range metadata, and browser-local
   theme preference.
4. Immutable snapshot DTO/HTML renderer with one-target projection, no
   JavaScript/network/runtime, deterministic CSP, context escaping, generated
   cache output, and `--no-open` behavior.
5. JSON/TUI compatibility, removal of the module-to-string client path, and
   focused determinism/no-double-count/privacy tests.
6. WSL2-to-Windows-browser UAT and measurement against the pre-existing static
   path; record regressions and follow-up work in the RC evidence package
   without reopening the transport decision.

**Acceptance gates**

- A normal `/session-ins ui` invocation starts one ephemeral loopback server;
  the browser receives Current, History, and Global from `/api/v1/ui`.
- `/api/v1/ui` calls `loadInspectorBundle()` once per response; session/global
  resources are bounded and independently observed; no browser arithmetic or
  cross-request consistency claim exists.
- `snapshot current|history|global|session <sessionId>` requires an explicit
  target, writes one immutable self-contained projection, and works offline
  through `file://` without executable JavaScript or network access.
- Wrong host, peer, bearer token, method, route, path, range, and origin cases
  fail safely; shell/assets contain no report/session data; no CORS or
  arbitrary filesystem access exists.
- Refresh and repeated reads remain deterministic, preserve native usage
  authority, do not double-count, do not mutate Pi data, and keep unavailable
  evidence distinct from zero.
- `--output` is accepted only by `snapshot` and `json`; default snapshots use
  generated cache output; `--no-open` suppresses only the opener and the CLI
  still reports the generated path or server URL.
- Existing route, navigation, scope, range, deep-link, cross-navigation,
  entity-focus, search/sort, capability, unavailable/unsupported rendering,
  and autocomplete boundary tests remain green or gain stronger equivalents;
  provider-side autocomplete limitations are not falsely marked fixed.
- Bootstrap-to-route transition consumes `#token=...` before parsing, uses
  `replaceState` without adding history, and never restores the token through
  Back/Forward. Route parse/serialize remains canonical and idempotent.
- Startup/API/render failures are visible to CLI/browser users with bounded
  redacted diagnostics and correlation IDs. No Express/Fastify/server
  daemon/autostart or production dependency beyond Node/Pi facilities exists.

**Release:** this intentional pre-1.0 command/transport break is planned for
`0.10.0`; compatible implementation slices may bump the next patch version.

### Pre-M8.5 — executable reconciliation and property suite

**Status:** Complete. **Depends on:** Pre-M8.4.

Turn the approved report contracts into an executable release gate. The suite
proves that UI/JSON/TUI projections agree with canonical Pi-native evidence; it
does not claim to independently verify an external provider's billing system.

**Deterministic invariant suite**

Run the same assertions against sanitized fixture reports, current/tree views,
history/global projections, API payloads, JSON exports, and the rendered data
used by HTML/TUI:

```text
coverage.inspected
  = coverage.available + coverage.unavailable

sum(tool status buckets)
  = tool calls

sum(agent activity tool counts)
  = agentActivity.calls

native usage
  = generations + toolResults + compactions + branchSummaries
    where coverage is complete

fold(DateUsageRow)
  = canonical attributable usage
    for the retained complete window

fold(DatedModelRow)
  = model totals for the same range

inventory.count
  = inventory.items.length

resources per-source totals
  = command + skill + prompt + tool counts

current/tree sameReportProjection=true
  => semantically equal report projection

unavailable evidence
  => never synthetic 0 / $0.00 / 0%
```

The suite must also verify bounded partial/aggregate-only/truncated states,
range membership, native-vs-child usage non-additivity, and repeated reads or
refreshes without double counting. An equality is asserted only under its
precondition; for example, native usage reconciliation is not claimed for an
incomplete coverage set.

**Property-based checks**

After deterministic fixture invariants pass, use `fast-check` for bounded
sanitized generated inputs:

- random permutation of valid records does not change deterministic projections
  where order is not semantic; ordinal, cursor, timestamp, and ancestry order
  remain semantic where the contract says they are;
- malformed or unknown entities do not break graph ancestry or cause a report
  crash, and are ignored/degraded according to the evidence contract;
- route parse/serialize is canonical and idempotent for valid and rejected
  inputs;
- range and report projection operations remain bounded and do not turn
  unavailable evidence into zero;
- repeated canonical reduction is stable and does not duplicate usage.

Every property has bounded case counts, a reproducible seed on failure, and
sanitized shrinking output. Raw prompts, responses, tool arguments/results,
provider payloads, paths, secrets, and arbitrary generated strings must not
enter committed fixtures or diagnostics.

**Small deliverables**

1. Invariant runner and sanitized fixture matrix for canonical reports and
   report-level DTOs.
2. Usage/date/model/inventory/resource reconciliation assertions.
3. Evidence availability, coverage, scope, child-usage, and no-synthetic-zero
   assertions across JSON and UI projections.
4. Bounded `fast-check` properties for ordering, malformed entities, routing,
   range projection, and repeated reduction.
5. CI-friendly machine-readable output with failing invariant name, bounded
   fixture/property seed, and redacted diagnostic context.

**Acceptance gates**

- All deterministic invariants pass on current, history, global, active, tree,
  complete, partial, aggregate-only, expired, and unavailable fixture cases.
- `fast-check` passes with reproducible seeds and no privacy-boundary violation.
- JSON and UI consume the same canonical values; no browser-only arithmetic is
  required to make the equations pass.
- Any intentionally unsupported or deferred equality is named and excluded,
  never silently weakened.
- The suite runs as one bounded command suitable for local use and CI, without
  requiring a live Pi account, network, or external service.

**Release:** This test-only hardening does not require a SemVer bump; the
project remains on `0.10.0`.

**Deferred follow-up:** resolved. `publint` is pinned dev tooling with an
explicit `npm run publint` script, so `knip` and the pre-commit hook pass again;
`esbuild` is used by the adopted build script and is no longer an unused
declaration.

### Pre-M8.6 — code optimization and client-bundle evaluation

**Status:** Complete. **Depends on:** Pre-M8.5 and the Pre-M8.3 dependency
review. **Related:** Pre-M8.4 localhost UI server.

Look for smaller, safer implementations before adding code or dependencies.
Use Context7 to verify current package APIs, but adopt an npm package only when
it is measurably better and passes the supply-chain gate.

**Client-build experiment**

Compare the normal client produced by Pre-M8.4 with an optional bundled-client
candidate using the same sanitized fixture, Node version, host, and benchmark
method. Pre-M8.6 may adopt or reject only the client build/bundling strategy;
it must not re-decide whether the accepted localhost server exists.

| Metric | Pre-M8.4 normal client | Adopted bundled client | Delta | Evidence |
| --- | ---: | ---: | ---: | --- |
| Client source LOC | 3,224 | 3,415 | +191 | `git show`/`wc -l` vs `wc -l scripts/web/*` (includes the 297-line chart adapter) |
| Client asset raw / gzip bytes | 113,563 / 26,786 | 264,631 / 88,429 | +151,068 / +61,643 | `benchmark:browser:release`, gzip level 9 |
| Generated shell bytes | 4,125 | 4,057 | −68 | same fixture |
| Bundle evaluation median / p95 ms | 0.82 / 1.39 | 1.52 / 3.22 | +0.70 / +1.83 | maintained harness, 40 samples after 5 warmups |
| Startup median / p95 ms | 2.13 / 4.71 | 8.71 / 12.36 | +6.58 / +7.65 | same harness and fixture |
| Route-change re-render median / p95 ms | — | 0.54 / 0.82 | — | same harness and fixture |
| Chart create / update median ms | — | 1.14 / 0.77 | — | same harness and fixture |
| Tarball / unpacked / files | 230,983 / 908,323 / 72 | 295,498 / 1,065,738 / 73 | +64,515 / +157,415 / +1 | `npm pack --dry-run --json` |

The asset is deliberately larger: bundle size is not the winning metric. Chart.js
is adopted for the generic chart representation Inspector would otherwise keep
own; the harness numbers include drawing the chart on a canvas, and the earlier
`2.48 ms` startup figure came from a local one-off harness rather than this one.

**Regression baseline:** `benchmark/browser.ts` measures evaluation, startup, a
route change that re-renders the loaded view, chart create, and chart update for
the shipped asset, and asserts the behavior invariants on every sample: one
authorized fetch (the route change adds none), the token out of URL/storage, no
storage writes, exactly one initial render, a rendered chart, and exactly one
render caused by the route change, whose applied route is recorded and checked. The accepted
baseline is `benchmark/baselines/browser.json`, identified by the shipped asset's
SHA-256 and checked by `npm run benchmark:browser:check`; sizes must match
exactly and a wall-time median may not exceed `2.5×` its recorded value. Each
metric records median, p95, min, max, and sample standard deviation, so a figure
is read against its variance rather than in isolation; for the adopted figures
that spread is evaluation `0.56`, startup `1.44`, route-change re-render `0.26`,
chart create `0.49`, and chart update `0.39` ms. The numbers above are that
baseline; the raw artifact is written to `benchmark/artifacts/` and is not
committed. Server startup/refresh stays with
the Pre-M8.7 release job.

Server startup/refresh belongs to the accepted Pre-M8.4 architecture and the
Pre-M8.7 RC benchmark, not to this bundler adoption decision.

`esbuild` is a dev-time candidate, not an automatic runtime dependency. Record
the exact command, version, fixture, sample count, median, p95, variance, and
rejected alternatives. A smaller file is not sufficient if it increases
startup time, hides diagnostics, breaks `file://` export, weakens CSP/privacy,
or changes deterministic output.

**Bundler-specific review**

1. Prefer Node/Pi facilities and existing dependencies when they meet the
   contract; do not replace clear code for novelty or line-count reduction.
2. Apply the top-level supply-chain policy to `esbuild` or any alternative:
   record purpose, transitive dependencies, license, maintainer/repository
   provenance, release history, install scripts, lockfile pin, advisories, and
   source/provenance concerns.
3. Run appropriate npm vulnerability/signature/provenance checks and inspect
   the exact tarball. Critical/Important unresolved findings block adoption;
   lower-risk findings require the explicit rationale, owner, and follow-up
   required by the top-level policy.
4. Keep build-only tooling out of the shipped runtime dependency graph unless a
   measured design decision explicitly requires it.

**Small deliverables**

1. Reproducible baseline measurement command and current-path numbers.
2. Isolated bundled-client prototype using the smallest viable build setup.
3. Side-by-side measurement report with deltas and variance; no production
   adoption in the measurement PR.
4. Security/provenance review and explicit adopt/reject decision.
5. If adopted, one narrowly scoped client-build migration PR guarded by the
   executable invariant suite; it must not alter the accepted server transport.
   If rejected, delete the candidate and retain the decision.

**Acceptance gates**

- Current and candidate measurements use identical data and environment
  controls, with raw benchmark artifacts kept local and summarized durably.
- Candidate preserves API/export parity, offline static export, token/host
  security, diagnostics, privacy, deterministic output, and all executable
  invariants.
- Any new package satisfies the top-level supply-chain policy and is justified
  by measured benefit; suspicious or unexplained provenance/install behaviour
  rejects adoption, while lower-risk known issues follow the explicit owner and
  follow-up policy.
- The candidate does not re-decide or alter the accepted localhost server
  architecture.
- No optimization PR bundles unrelated cleanup, server migration, or UI
  redesign.

**Outcome:** esbuild `0.28.2` is adopted as build-time bundling only. The
readable `scripts/web/` sources emit one deterministic classic client asset;
server transport and browser semantic ownership are unchanged. i18next
`26.4.2` is adopted behind the Inspector-owned synchronous translator with one
local catalog, explicit English fallback, and no detector/backend/persistence.
**Delivered (chart representation).** Chart rendering is delegated to Chart.js
`4.5.1` behind `scripts/web/chart.ts`, the only file that imports it (enforced by
dependency-cruiser). The adapter receives labels and values already projected
from the DTO: it owns the datasets, axis assignment, formatter callbacks, theme
palette, and the canvas aria summary, and it owns no range resolution,
aggregation, attribution, evidence, or unavailable-versus-zero rule. The custom
SVG renderer is replaced by a canvas chart; the exact-value table stays the
accessible representation. Two flagged byte patterns were investigated before
adoption: the `"import "` hit is a vendor `console.warn` string, and the
`Date.now` sites are animation and time-scale internals that this configuration
never reaches (`animation: false`, no time scale). Shipped-asset gates therefore
assert capability by parsing the bundle for module loading, host loaders,
`import.meta`, and dynamic code evaluation; the calendar rule is scoped to the
sources Inspector writes; and the shipped client is executed in a realm whose
`Date` throws, where the chart must still draw. `publint` is pinned dev tooling
with an explicit `npm run publint` script. Runtime audit is clean; the full
audit's one low
advisory is confined to `tsx`'s nested `esbuild@0.27.7` Windows
development-server path and is deferred with `tsx`. Durable comparison evidence
is recorded in the table above; detailed candidate audit and the gate
classification remain local working evidence. The chart-library boundary is
enforced by dependency-cruiser (only `scripts/web/chart.ts` may import
`chart.js`), and the browser regression baseline is machine-readable in
`benchmark/baselines/browser.json`, checked by
`npm run benchmark:browser:check`.

**Release:** the chart change is product-visible (rendering and asset size), but
it is not published separately: the package stays on `0.10.0` and the RC/release
step names the version that actually ships. See ADR 0018.

### Integration architecture, configuration, and debug diagnostics

**Status:** Complete (`0.11.0`). **Depends on:** Pre-M8.5 and the evidence
foundation.

Integration knowledge was spread across seven hand-synchronized sites, so one
new integration required edits to core enums, presence detection, Pi-entry
parsing, counter allowlists, report order/validation, retained aggregates,
observation defaults, tests, and sometimes live subscriptions. There was also no
settings surface and no way to explain a `Present / Unavailable` row or a
persisted `durationMs: 0`.

**Deliverables**

1. Integrations are descriptors with optional typed hooks
   (`presence`, `persisted`, `live`, `telemetry`, `canonical`); the supported set
   and its report order are one explicit array in `src/integrations/index.ts`,
   and `src/integrations/catalog.ts` owns validation and lookup only. Each
   subsystem iterates the list and invokes the hook it owns, so adding an
   integration is one definition file, one registration line, tests, and one
   `docs/integrations.md` row (ADR 0019).
2. One Inspector-owned `settings.json` (`theme`, `debug`) with
   `CLI option > settings.json > product default` precedence and fail-safe
   malformed handling.
3. A local, bounded, `0o600` JSONL debug log (off by default) with an
   allowlisted field vocabulary that never carries prompts, tool arguments or
   results, environment values, or producer payloads, never reaches a report,
   and fails closed when its private modes cannot be enforced.
4. Real-session UAT on `01a0a14a-2bb3-75af-aa91-715c8f92d3e1` explaining every
   integration row, fixing the lens and subagents evidence mismatches, and
   localizing the persisted `durationMs: 0` to an honest millisecond-resolution
   floor in the live producer.

**Acceptance gates**

- Adding a fixture integration flows through presence, persisted evidence,
  telemetry, live registration, canonical contribution, and the report with no
  core edit.
- One failing integration cannot break another; duplicate keys, alias
  collisions, and malformed schemas are rejected at definition time.
- Existing privacy, determinism, and retention semantics are unchanged and the
  suite stays green.
- Debug logging is bounded, local, non-fatal, absent from every report surface,
  and documented in `docs/integrations.md`.

### Pre-M8.7 — RC hardening and package audit

**Status:** Complete. **Depends on:** Pre-M8.1–Pre-M8.6 and Pre-M8.8.

**Evidence:** [1.0.0 RC evidence package](release/1.0.0-rc-evidence.md) —
release commit `e907d95`, npm name `@twkrash/pi-session-inspector`, package
version `1.0.0`, tarball `twkrash-pi-session-inspector-1.0.0.tgz`
(`sha512 15d96839…`), qualified from a clean checkout cloned from the public
repository. The artifact is the replacement for the original candidate, which
was superseded before publication because the unscoped npm name belongs to
another publisher: only the npm coordinate changed, never the source. The
owner-verified manual browser/TUI/privacy matrix and the WSL2 case passed. Two
target-SLO variances were accepted for the 1.0 baseline: the 10k-record HTML
size ceiling was revised from `< 5 MiB` to `< 10 MiB`, and the warm/cold replay
and HTML render times are accepted with their absolute SLOs unchanged. Hard
regression gates stay disabled with two accepted baselines recorded; enabling
them is a post-1.0 follow-up.

Produce a release-candidate evidence package before M8 publication work. This
is the final readiness gate, not a license to skip the smaller preceding
reviews.

**Deliverables**

1. Run the executable invariant/property suite, dependency rules, static
   inventory dispositions, privacy corpus, and deterministic regression suite
   from a clean checkout.
2. Run `npm run publint` and `npm pack --dry-run`; inspect the actual tarball
   contents,
   package entry points, ESM/Node engine metadata, file allowlist, license,
   README, CHANGELOG, and repository URLs.
3. Install the packed artifact on a clean machine/container with no repository
   checkout assumptions. Exercise Pi extension discovery, `/session-ins ui`,
   JSON export, static HTML export, and failure reporting.
4. Run the release benchmark job and preserve bounded measurements for replay,
   reconcile/fold, report generation, server startup/refresh, current TUI, and
   package size. Record target-SLO variance and whether a second accepted
   baseline exists.
5. Run the final manual browser/TUI/privacy matrix, including loopback token
   rejection, offline static HTML, API failure display, no-double-count refresh,
   and no external network request. Include an explicit WSL2 case: Pi/Inspector
   runs inside WSL2, the Windows host browser opens the tokenized URL, API
   refresh succeeds, token/Host/Origin protections still behave correctly, and
   no unexpected non-loopback exposure appears.
6. Produce an immutable release checklist/evidence package with accepted risks,
   deferred work, rejected dependency/prototype decisions, exact commit, exact
   package version, tarball hash, and next release target. M8 consumes this
   package; it does not silently redo or bypass it.

**Acceptance gates**

- `publint`, pack/install, executable invariants, dependency rules, tests,
  format, lint, typecheck, privacy checks, and benchmark smoke all pass.
- Tarball contains only approved package files and runs without the source
  repository or development-only dependencies.
- Clean-machine and live command checks show actionable bounded errors when
  startup, API, export, or report generation fails.
- No unresolved Critical/Important security, privacy, data-loss, contract, or
  deterministic-output finding remains. Lower-risk items are explicitly
  recorded with an owner and follow-up.
- Release measurements are reproducible; hard performance gates remain
  disabled until two accepted release baselines, as specified.
- The RC evidence package names one exact commit, package version, and tarball
  hash. M8 may publish only that unchanged candidate or must requalify a
  changed candidate through the affected gates.

### Pre-M8.8 — Production hardening and review follow-ups

**Status:** Complete. **Evidence:** each item below carries its own outcome
record — the release or commit that closed it.

Address release-blocking defects, high-risk validation gaps, and actionable
review findings before the public release. This milestone must leave the
production paths validated and the remaining non-blocking technical debt
explicitly documented.

1. P1 — Same-session replacement / stale live-counter registration

   - `src/integrations/live-counters.ts` keeps module-global
     `activeRegistrations`.
   - `src/index.ts:setupProductionSessionWal` currently discards the
     `LiveCounterRegistration` disposer.
   - Pi 0.85.1 tears down the previous session runtime and removes its old
     listeners, so cross-session event contamination is unlikely.
   - A remaining lifecycle mismatch may occur on `A → B → A`: the cached
     registration for A can survive after Pi removed its underlying listeners,
     causing the resumed session to reuse an inert registration and silently
     undercount permission/skill telemetry.

   Required work:
   - Make live-counter registration ownership and disposal explicit.
   - Ensure stale registrations cannot survive session replacement.
   - Add regression coverage for same-session reactivation.
   - Run production-path UAT covering `/new`, `/resume`, `/fork`, and `/reload`.

   Exit criteria:
   - No duplicated or missing permission/skill telemetry across session
     transitions.
   - `A → B → A` resumes counting correctly.
   - Production-path lifecycle UAT passes.
   - Any failure is release-blocking.

   **Outcome: Complete.** Runtime-owned live registration with disposal on
   every `session_shutdown` reason, `A → B → A` reactivation, and the
   runtime-scoped read-boundary attempt memo (`0.13.2`; `9109934`;
   `tests/integration/lifecycle-reactivation.test.ts`). The real-session UAT
   covered `/new`, `/resume`, and `/reload`, and killed the pre-fix mutant
   (owner-reported; not reproducible from the repository).

   **Bounded validation limitation:** `/fork` is exercised by the lifecycle
   integration test's reason matrix — `session_shutdown` runs for `new`,
   `resume`, `fork`, `reload`, and `quit` — but it was not exercised in the
   real UAT, because Pi requires a saved assistant turn. That is a validation
   limitation, not an open defect.

2. High-risk storage and recovery validation

   Highest-consequence modules:

   - `src/storage/wal.ts`
   - `src/storage/checkpoint.ts`
   - `src/storage/recovery.ts`
   - `src/storage/maintenance.ts`
   - `src/storage/retention.ts`

   Validate:
   - crash recovery and interrupted writes;
   - cursor monotonicity;
   - exact-once / non-duplicating folds across checkpoint + WAL recovery;
   - WAL sealing and segment rotation;
   - checkpoint replacement and recovery;
   - retention/deletion boundaries;
   - recovery from stale, partial, or corrupted durable state.

   Exit criteria:
   - Failure-path and crash-recovery tests cover the critical durability
     invariants.
   - No known path can silently double-count, lose retained evidence, or delete
     data outside the documented retention contract.

   **Outcome: Complete.** `0.13.3` and `a5dddf0`: interrupted
   recovery/publication replays identically and folds each record once, atomic
   checkpoint replacement exposes the previous or the new complete checkpoint
   and never a partial one, a dropped seal and a seal/cursor regression are
   rejected, a missing WAL directory reports the bounded
   `wal-directory-missing` diagnostic, a WAL shorter than a sealed cursor is
   accepted without rewinding or inventing records, and ADR 0005 states the
   process-crash-only durability scope.

3. P2 — Tighten architectural layering

   Finding:
   - The directory-level dependency graph contains an SCC spanning
     `core`, `integrations`, `pi`, and `storage`.
   - There is no file-level import cycle; `npm run depcruise` reports
     0 errors.
   - This was classified as a maintainability concern rather than an immediate
     release blocker.

   Required work:
   - Define explicit allowed dependency directions between architectural layers.
   - Encode the important boundaries in dependency-cruiser rules.
   - Break the directory-level SCC where doing so does not require speculative
     restructuring.

   Exit criteria:
   - Layer boundaries are machine-checkable.
   - Any intentionally retained exceptions are documented.
   - `npm run depcruise` remains clean.

   **Outcome: Complete.** `.dependency-cruiser.cjs` pins the permitted layer
   edges — `3d31a3b` added `core-not-to-pi-and-storage-runtime`,
   `storage-not-to-pi-implementation`, `integrations-not-to-canonical-owners`,
   and `integrations-not-to-pi-or-storage` beside the loader, adapter, and
   renderer rules — and the cruise reports 0 errors and no circular
   relationship, so no file-level cycle exists. The one directory-level SCC
   spanning `core`, `integrations`, `pi`, and `storage` is a documented
   exception: `core -> integrations` registry/contract lookups are sanctioned
   by ADR 0019 and the `pi <-> storage` pair is the composition seam. Breaking
   the SCC would require speculative restructuring, so no release-blocking
   layering issue remains.

4. P2 — Eliminate competing report projection paths

   Relevant paths:

   - `src/core/reports.ts:toSessionReport`
   - legacy `ReducedSession` projection paths

   Risk:
   - Parallel projection logic can evolve into multiple semantic authorities
     for the same report data, causing HTML/TUI/JSON views to disagree.

   Required work:
   - Establish one canonical semantic projection.
   - Make UI-specific code presentation-only where practical.
   - Deprecate, isolate, or remove legacy `ReducedSession` paths.

   Exit criteria:
   - HTML, TUI, and JSON derive equivalent values from the same canonical
     report semantics.
   - Legacy compatibility paths cannot silently become an alternative source
     of truth.

   **Outcome: Complete by isolation, not deletion.** Production report callers
   are exactly the canonical loaders `src/ui/load-current.ts` and
   `src/ui/load-history.ts`, and
   `tests/unit/report-projection-authority.test.ts` fails if another appears
   (`7931484`, `20eff93`). The guard is reference-based — it resolves
   TypeScript symbols rather than matching source text — so an aliased or
   re-exported caller is still caught. `ReducedSession` remains a compatibility
   surface for pre-0.8 reducer-shaped fixtures and the benchmark harness: test
   and benchmark input only, with `toSessionReport` documenting that it must
   never become a report authority again. `ReducedSession` itself was not
   removed.

5. Low — Dependency hygiene

   - Verify whether `publint` is used by build, packaging, CI, or release
     validation. (Resolved: it is pinned dev tooling with an explicit
     `npm run publint` script, so `knip` and the pre-commit hook pass.)
   - If it is tooling-only, move it to `devDependencies`.
   - Remove it if unused.

   **Outcome: Complete.** `publint` is pinned dev tooling (`0.3.24`) behind
   `npm run publint`; `knip`, `depcruise`, `format:check`, and the package
   checks are green.

**Release:** a compatible RC hardening pass may bump the next patch version;
publication remains part of M8.

## Completed post-1.0 follow-ups

### 5. Multi-metric charts with metric selection

**Status:** Complete in `1.2.0`.

**Current state:** `scripts/web/chart.ts` already draws N series — each series
carries its own `key`, `axis`, `format`, and palette entry, and the axis
formatter is per-series, so a cost axis and a token axis can already differ. The
client now projects one series per selected metric and offers a picker for the
selection; before that it projected exactly one series and no UI offered metric
selection.

Decisions this item had to make:

- the picker is a pressed-toggle group (`button.metric-toggle`), not a
  multi-select `<select>`: a modifier-key list is not a control a report should
  require, and the client's availability filters already use this pattern. The
  selection is this view's own browser state, remembered per view, so it
  survives a tab switch and writes no storage;
- the default pair is `cost` + `tokens`, which is the pair whose units differ, so
  the axis rule is visible before the reader chooses anything;
- the axis rule: a chart of more than one metric splits by unit — `cost` on the
  right axis, the count metrics on the left one — and a chart of a single metric
  draws on the left axis whatever it is, which is the rendering a lone metric has
  always had. The panel states the rule in one line; the legend and the tooltips
  carry one entry per series, each with its own value formatter;
- `null` stays a gap. A day that does not publish a metric is a `null` point in
  that line, and the exact-value table states `Unavailable` for that cell rather
  than formatting it — `formatCost` would otherwise have printed `< $0.0001` for
  a cost the row never held;
- a selected metric the rows cannot fill is named (`Unavailable in this range:
  …`) and stays selected, so an empty metric is distinguishable from one that was
  never picked. A chart whose every selected metric is unavailable still draws
  nothing and keeps the earlier single `Unavailable` panel;
- the JSON report is unchanged: the picker is browser state, never a DTO field,
  and the last pressed metric cannot be turned off because a chart of nothing is
  not a state the view offers.

Before-merge items (all closed):

1. selecting a second metric renders two (then three) series with the axes above
   and per-series formatters, asserted on the client's own projected chart input
   through the client harness (`chartInputs()`);
2. the selection survives a tab switch inside the session, and the last pressed
   metric stays pressed;
3. JSON output is unchanged. The change is `scripts/web/client.js` plus the
   catalog and stylesheet it reads; `scripts/web/chart.ts` and every report DTO
   are untouched.

The shipped asset changed, so the accepted browser regression baseline was
re-recorded (`benchmark/baselines/browser.json`): asset 264,873 → 282,367 bytes
(gzip 88,537 → 93,821) with the new asset SHA-256, and
`npm run benchmark:browser:check` passes against the new figures with the behavior
invariants unchanged — one authorized fetch, no token in URL or storage, no
storage writes, exactly one initial render, a rendered chart, and one render per
route change.
### 10. Loading state and first-paint theme

**Status:** Delivered in `1.3.0`; the checks below are covered by
`tests/unit/server.test.ts` (the served shell carries one theme class, the light
theme is the shipped bytes), `tests/unit/web-assets.test.ts` (a deferred payload
paints the resolved theme first, the loading copy announces once and the applied
route replaces it, and the storage-write assertion stays empty), and
`tests/helpers/client-harness.ts`, which now renders its stub shell through the
same `renderShell()` the server uses. **Depends on:** nothing. Distinct from
item 4: push decides when data arrives, this decides what the reader sees while
it has not arrived yet.

**Current state:** `src/ui/web/shell.html` carries one hidden `#loading` line
("Loading report…") that `setLoading()` in `scripts/web/client.js` toggles, so a
cold load shows a single sentence where the report will be. Theme is
browser-local: a click toggles `theme-dark` on `body` and nothing is persisted —
the browser regression asserts zero storage writes — while
`src/config/settings.ts` already resolves `theme` with `CLI option >
settings.json > product default` precedence and reports its `themeSource`. The
resolved theme is now rendered into the shell the server serves and into every
static snapshot, so the first paint is the reader's theme and the toggle starts
on the state the document is already in; the toggle stays browser-local and
persists nothing. The visible loading line is the shared notice component, and
the one live region carries the loading message and then the applied route.

Expected implementation shape:

- a loading window that states what is loading and keeps the shell navigable,
  reusing the existing live-region vocabulary instead of a spinner-only screen;
- the resolved theme reaches the first paint — server-rendered into the shell, or
  applied by the earliest asset the shell already loads — so showing the reader
  their own theme needs no data fetch;
- the browser-local toggle keeps meaning the current document, and delivering the
  resolved preference must not become a URL, a route, or a report field;
- no new asset, no runtime module loading, no CSP change, and no change to the
  three-file asset contract.

Before merge (all met in `1.3.0`):

1. a cold load paints the resolved theme before any report data arrives;
2. the loading window is asserted through the client harness — visible while a
   response is deferred, gone after the render, and announced once;
3. a reload paints the resolved preference again with the storage-write
   assertion still empty.
### 11. Token economics and cache accounting

**Status:** Shipped in `1.4.0`. **Depends on:** nothing.

**Durable record:** ADR 0020 and product spec §13.7.

**Current state:** Pi-native input, output, cache-read, cache-write, reasoning,
and per-bucket cost evidence now flows through canonical usage, dated/history/
global aggregation, JSON projections, TUI, static HTML, and browser charts.
Coverage remains explicit and missing values stay unavailable; cache reuse uses
one shared projection and denominator.

The goal is to make token economics visible without creating a second usage
authority.

Expected semantics:

- preserve Pi's native `input`, `output`, `cacheRead`, and `cacheWrite` buckets;
- keep persisted `totalTokens` and total cost authoritative;
- retain native per-bucket cost where Pi provides it;
- expose cache reuse only as an explicitly documented derived metric;
- never infer reasoning tokens: expose them only when a stable native source
  provides them, otherwise report `unavailable`;
- preserve unavailable-vs-zero semantics for every token and cost bucket;
- expose coverage when an aggregate contains only partial bucket evidence.

Expected presentation:

- session/history/global views can show input, output, cache-read, and
  cache-write tokens separately;
- daily charts may select those token metrics through the existing
  multi-metric chart surface;
- cost breakdown identifies the contribution of input, output, cache reads,
  and cache writes when native evidence supports it;
- cache reuse is shown alongside its documented denominator and evidence
  coverage.

Before merge:

1. fixture-backed tests prove native token and cost buckets survive parsing,
   canonicalization, history aggregation, and report projection;
2. partial bucket evidence never becomes a fabricated complete total or zero;
3. the documented cache-reuse formula is shared by JSON, HTML, and TUI
   projections rather than reimplemented per surface;
4. providers without a bucket or reasoning-token signal report it as
   unavailable;
5. existing `totalTokens` and total-cost values remain unchanged.

### Acceptance (met)

- Native token/cost/reasoning evidence survives parsing, canonicalization,
  dated/history/global aggregation, and report projection.
- Partial bucket evidence stays partial; absent evidence stays unavailable;
  observed zero remains zero.
- JSON, TUI, static HTML, and browser charts consume the shared economics
  projection and preserve the cache-reuse denominator.

- None of the MCP, skill-attribution, or native-telemetry work is required for
  `1.0.0`.
- Post-1.0 changes preserve observer-only, local-only, bounded, redacted, and
  deterministic behavior.
- New semantic evidence is accepted only from a producer contract strong enough
  to support historical replay and honest unavailable-vs-zero behavior.
- No presentation-only heuristic becomes canonical evidence.
- No item in this section adds a runtime dependency, a database, a server, an
  LLM step, or raw-content persistence without an ADR.
- Presentational work (locales, metric selection, link targets) does not change
  report DTO semantics: TUI, HTML, and JSON keep consuming the same DTO.
- An item leaves this section when its research questions are answered, its
  constraints are written into the spec or an ADR, and its work is small enough
  to enter `main` as independently mergeable pull requests. A new dimension,
  source, or metric gets its own name and its own documented method before it
  gets a place in the DTO.

### Subagent AgentRun observability (shipped in `1.5.0`)

Item 13 defined the per-run effort contract. The work that completed the
subagent evidence model was carried as a bounded migration with one ADR per new
boundary:

- **ADR 0021** — per-run AgentRun effort and coverage, item 13's contract.
- **ADR 0022** — pi-subagents observability contract and reconciliation
  boundary. Persisted Pi JSONL stays the historical authority; adapters validate
  producer shapes, bound values, and emit ordered observations with private
  opaque source identities; canonical reconciliation merges only exact identities
  and explicit aliases; a validated RPC v1 `ping` capability matrix is pinned but
  never activated at runtime, so no report depends on a running producer process.
  Amended for the single-run completion child-usage contract.
- **ADR 0023** — detached foreground terminal history. The `Detached` disposition
  is separate from outcome, the launch sentinel `-2` never means failure, and
  only an exact current-session `foreground-history.json` entry may settle the
  status; historical reports never read that file.

Migration steps, shipped in `1.5.0` by PRs #44–#58: `A` history usage regression,
`B` observation/reconciliation foundation, `C1` persisted async visibility with
one stable public ID per logical run, `C2` referenced lifecycle enrichment, the
detached foreground regression, `D` removal of the superseded producer
reconstruction, `E1` single-run completion usage attribution, and `E2` the
Agents-view disclosure for a native call with no run row. Live pre-cleanup and
post-cleanup UAT records stay local working artifacts; the release artifact
record is [`release/1.5.0-evidence.md`](release/1.5.0-evidence.md).

## Resolved maintenance and hardening

### Resolved in `1.3.0` — macOS parent-session containment

`src/pi/parent-session.ts` mixes a canonical root with a lexical candidate: it
canonicalizes `realpath(sessionRoot)` into `approvedRoot` and then tests
containment with `relative(approvedRoot, resolve(parentPath))`. On macOS `/var`
commonly resolves to `/private/var`, so a parent transcript under the same
physical root can be judged outside it and the child is reported `unavailable`
instead of linked. The failure is platform-specific and silent, and it is a
defect rather than a style concern.

Fix direction:

- do lexical containment with `resolve()` on both root and candidate;
- do canonical containment separately with `realpath()` on both;
- keep the existing component walk and its symlink rejection unchanged;
- add regression coverage for the canonical/lexical divergence;
- add macOS CI coverage so this class of platform bug is caught here rather than
  by a reader on that platform.

**Outcome (`1.3.0`):** the two containment checks each use their own pair —
`resolve()` on the root and the candidate, then `realpath()` on the root and the
candidate — with the component walk and its symlink rejection unchanged, so a
parent inside the approved root resolves again on the platforms where the root
itself has a link component. `tests/unit/parent-session.test.ts` covers the
divergence with a linked root, and pins that containment is not weakened to get
there (a sibling of the root, reached through the same link, is still
`unavailable`), so the class is caught on any platform rather than only on macOS.
**Still open:** macOS CI coverage. No workflow runs this suite on macOS yet, so
a macOS-only divergence would still reach a reader before it reaches CI; the
regression test reproduces the shape, not the platform.
### Resolved in `1.3.0` — shared cost rounding

- `roundCost()` existed as six byte-identical private copies — `core/canonical.ts`,
  `core/reports.ts`, `core/reduce.ts`, `integrations/subagents.ts`,
  `ui/report-projection.ts`, `ui/ui-projection.ts`. They encode one accounting
  semantic (the retained-precision cost rounding), so one shared home keeps the
  rule from drifting between layers or projections. **Resolved in `1.3.0`:**
  they are one function in `src/core/rounding.ts`, imported by all six sites;
  no accounting value changes.

### Resolved since recording

- **TUI scope-toggle flake and its siblings.** `tests/unit/index-current-ui.test.ts`
  waited a fixed 20 ms for the asynchronous scope reload and asserted the stale
  report on a slower runner. It waits for the rendered report now, and the same
  fixed-delay pattern is gone from `tests/unit/wal.test.ts` and
  `tests/unit/index-report-command.test.ts`; `tests/helpers/wait.ts` holds the one
  condition-based `waitFor`, which `tests/integration/lifecycle-reactivation.test.ts`
  uses in place of its local copy. PR #26 (`e53b08e`), recorded in the
  changelog's `[1.2.1]` section.
