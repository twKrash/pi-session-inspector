# Pi Session Inspector Roadmap

**Current release:** `0.9.2`

**Current state:** M0–M7, the follow-up evidence/report milestones, and
Pre-M8.1–Pre-M8.2 are complete. M8 is not started.

**Next gate:** complete the Pre-M8 readiness sequence below before starting M8.

This is the durable roadmap. Superpowers execution specs, task briefs, ledgers,
and review reports are working artifacts, not product documentation. Tracked
`docs/superpowers/**` material is removed by Pre-M8.1 after useful decisions are
promoted to ADRs, product specs, benchmark records, this roadmap, the README, or
the CHANGELOG. The tracked v1 implementation plan is a temporary exception: it
remains available during M8 as an execution/history guide, then is retired only
by the explicitly named post-M8 cleanup tail.

## Delivery rules

- Keep each sub-milestone independently mergeable.
- Split work into small deliverables and PRs: target 2–5 SDD tasks per PR and
  roughly no more than 5–8 production files or 1–3k meaningful changed lines
  where the architecture permits it.
- Run focused checks, full tests, format, lint, typecheck, and packaging checks
  for every implementation PR. Keep the main branch green.
- A roadmap-only edit does not bump the package version. Compatible Pre-M8
  slices may ship as `0.9.x` patch releases (`0.9.1`, `0.9.2`, …). A public
  contract change still follows SemVer review. Successful M8 publication is
  `1.0.0` unless that target is deliberately changed before publication.
- Pi persisted data remains billing/source authority. Inspector remains
  observer-only, local-only, bounded, redacted, and deterministic.
- Missing or unsupported evidence stays `unavailable`/`unsupported`; it never
  becomes synthetic `0`, `$0.00`, or `0%`.
- Audit reports are evidence for decisions. Do not apply tool output blindly;
  validate false positives and record accepted/rejected findings.
- Every newly introduced npm package/tool is subject to the same supply-chain
  review, whether it is a runtime, dev, build, test, benchmark, or audit
  dependency. This includes `knip`, `jscpd`, `dependency-cruiser`, `fast-check`,
  `publint`, and `esbuild`. One-shot tools may run at an explicitly pinned
  version without becoming project dependencies.
- Review package purpose, transitive graph, license, repository/maintainer
  provenance, release history, install scripts, lockfile pinning, known
  advisories, and source/provenance concerns before adoption. Suspicious or
  unexplained provenance/install behaviour is a rejection reason.
- No unresolved Critical/Important security, privacy, data-loss, contract, or
  deterministic-output issue may ship. Lower-risk known issues require explicit
  rationale, owner, and follow-up; there is no accidental zero-vulnerability
  requirement for every dev-only transitive dependency.

## Document authority

- Accepted ADRs and the durable v1 spec are normative. This roadmap records
  planned work and cannot silently override a current normative contract before
  the relevant durable document is amended and accepted.
- Once accepted, a later ADR, durable spec amendment, or roadmap decision
  supersedes conflicting portions of the original v1 implementation plan. The
  plan remains an execution/history guide only where it has not been superseded.
- Pre-M8.4 must first update the relevant durable ADR/spec (and any mirrored
  public documentation) to adopt the localhost transport. Until that gate is
  accepted, the current spec's no-server wording remains normative; no server
  implementation may begin.
- Transport changes preserve existing semantic contracts: canonical report
  loading, navigation/routing, ranges, active/tree scope, projections,
  evidence/coverage, privacy, determinism, and unsupported/unavailable
  behaviour. A transport decision is not permission to redefine those rules.

## Completed milestones

| Milestone | Status | Durable record |
| --- | --- | --- |
| M0 — package skeleton | Complete | [v1 implementation plan](plans/pi-session-inspector-v1-implementation.md) |
| M1 — replay-to-JSON | Complete | [v1 implementation plan](plans/pi-session-inspector-v1-implementation.md) |
| M2 — live tracking | Complete | [v1 implementation plan](plans/pi-session-inspector-v1-implementation.md) |
| M3 — checkpoint, recovery, history | Complete | [ADR 0005](architecture/adr/0005-checkpoints-and-reconciliation.md) |
| M4 — current TUI and ledger | Complete | [ADR 0003](architecture/adr/0003-derived-ledger.md) |
| M5 — integration and agent roll-up | Complete | [ADR 0007](architecture/adr/0007-subagent-rollup.md) |
| M6 — HTML, i18n, export | Complete | [CHANGELOG](../CHANGELOG.md#040) |
| M7 — sealing, retention, scale | Complete; release gates deferred | [M7 benchmark baseline](benchmarks/m7-baseline.md) |
| Evidence coverage and resource inventory | Complete in `0.7.0` | [CHANGELOG](../CHANGELOG.md#070) |
| Evidence foundation and canonical session model | Complete in `0.8.0` | [ADR 0016](architecture/adr/0016-evidence-foundation-and-canonical-session-model.md) |
| Report semantics, diagnostics, and navigation | Complete in `0.9.0` | [ADR 0017](architecture/adr/0017-report-coverage-attribution-and-navigation.md) |

## M8 — hardening and release

**Status:** Planned. M8 starts only after all Pre-M8 readiness sub-milestones
pass their acceptance gates. Successful publication is the planned **`1.0.0`**
release unless a deliberate SemVer decision changes that before publication.

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

The original v1 implementation plan remains available during M8 as an
execution/history guide only where it has not been superseded. Later accepted
ADRs, durable specs, and roadmap decisions supersede conflicting plan text.
Pre-M8.1 does not depend on M8 and does not retire the active plan; plan
retirement occurs only in its named post-M8 cleanup tail.

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
   Its retirement is not a Pre-M8.1 deliverable or acceptance condition.
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
- No Pre-M8.1 acceptance condition depends on M8 completion. The active plan may
  remain tracked during M8 as the stated temporary exception.
- No session data, prompts, outputs, credentials, or execution logs enter Git;
  documentation links and package-facing docs pass review.

#### Post-M8 cleanup tail (not a Pre-M8.1 gate)

After successful M8 publication:

1. Review the final implementation plan against the published commit and
   promote useful historical information to `docs/roadmap.md`, ADRs, specs,
   benchmarks, README, or CHANGELOG.
2. Repair all links that pointed to the temporary plan.
3. Remove `docs/plans/pi-session-inspector-v1-implementation.md` from Git only
   after its durable history has been promoted.
4. Verify the plan is untracked/absent and that the roadmap remains sufficient
   as the historical milestone record.

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

**Status:** Planned. **Depends on:** Pre-M8.2.

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

### Pre-M8.4 — ephemeral localhost UI server and normal client

**Status:** Planned. **Depends on:** Pre-M8.3. **Must precede:** HTML
optimization and release hardening.

Replace the fragile browser-side report logic in interactive `ui` with a small,
read-only localhost server. This is an in-process command facility, not a
background product service.

**Authority and adoption gate**

Pre-M8.4 owns and accepts the localhost transport architecture; it is not a
prototype awaiting a later bundler decision. Before any production migration
PR, update the relevant durable ADR/spec and mirrored public documentation to
replace the current no-server transport wording. That amendment must preserve
all existing semantic contracts listed below. Until the amendment is accepted,
that current no-server wording remains normative and no server implementation
may merge.

**Required boundary**

- Use Node's built-in `node:http` and `node:crypto` facilities. Do **not** add
  Express, Fastify, or another server framework.
- `/session-ins ui` starts one ephemeral server instance for that Pi process,
  binds only to `127.0.0.1:0`, prints/opens its tokenized URL, and exposes an
  explicit close path for tests. No daemon, service, autostart, global listener,
  or cross-process server is allowed.
- `loadInspectorBundle` remains the only report loader. The browser obtains
  Current (active/tree), History, and Global through bounded API calls; JSON and
  HTML exporters consume the same DTO rather than re-deriving report state.
- The interactive browser client is a normal JavaScript client. It must not
  depend on `Function.prototype.toString()` to inline `route.ts`, `range.ts`,
  or any other module.
- Recommended compatibility boundary: the localhost server is the interactive
  `ui` default; explicit static HTML remains available as an offline
  `file://` export/fallback and does not require the server.
- Theme preference is browser-local (for example, local storage); the server
  does not persist user preference or accept arbitrary state mutations.

**HTTP/security contract**

- Accept only documented `GET`/`HEAD` shell, asset, API, export, and bounded
  read-only refresh routes. No POST/PUT/PATCH/DELETE mutation API.
- Bind only to `127.0.0.1:0`. Validate the `Host` header and peer address as
  loopback for every request; reject non-loopback, malformed, or missing
  host/peer state.
- The initial browser URL carries a random process/server-instance capability
  token in the URL fragment, for example:
  `http://127.0.0.1:<port>/#token=<random-token>`.
  The fragment is never transmitted in the HTTP request, so the server must not
  depend on receiving the bootstrap token through the request URL.
- The shell document and known static JavaScript/CSS assets may be served
  without the capability token because they contain no report, session, user,
  evidence, filesystem, or other Inspector-derived data. They are immutable
  application assets only. No report DTO or session-specific state may be
  embedded in the unauthenticated shell or static assets.
- The bootstrap fragment is the only permitted transient non-route hash state.
  On startup, before route parsing begins, the client recognizes exactly the
  bounded bootstrap form `#token=<random-token>`, extracts and validates the
  capability token, and retains it only in memory. It then immediately replaces
  the bootstrap fragment with the canonical default Inspector route produced by
  the existing route serializer, using same-document `history.replaceState`
  rather than adding a history entry. After this transition, hash-route
  authority applies normally and every visible hash must conform to the
  canonical route grammar. The bootstrap fragment must never be interpreted as
  an Inspector route, persisted as route state, restored by Back/Forward
  navigation, or exposed to report/export logic.
- Every report-bearing or Inspector-data-bearing API request, including
  Current, History, Global, refresh, JSON export, and any future bounded
  diagnostic/report endpoint, requires one explicit authentication header such
  as `Authorization: Bearer <token>`. Reject missing, malformed, oversized,
  expired, or incorrect credentials without echoing them.
- Reloading after the bootstrap fragment has been replaced does not restore
  authentication state. The user must reopen a fresh bootstrap URL generated by
  the running Inspector instance. Do not persist the capability token in
  cookies, local storage, session storage, browser databases, Inspector state,
  route state, or exported files.
- The expected browser API origin is the exact server origin
  `http://127.0.0.1:<port>`. A present unexpected `Origin`, including `null`
  for protected API calls, is rejected. Requests without `Origin` are allowed
  only for documented same-origin navigations/static assets and intended
  non-browser/internal calls that still satisfy the applicable host, peer, and
  authentication checks.
- Disable CORS and arbitrary filesystem/path APIs. Serve only the known
  shell/client assets plus explicitly bounded report/export routes. Do not
  follow user-supplied redirects or expose arbitrary local paths.
- Send a restrictive CSP at minimum equivalent to:
  `default-src 'self'`; `script-src 'self'`; `style-src 'self'`;
  `connect-src 'self'`; `object-src 'none'`; `base-uri 'none'`;
  `frame-ancestors 'none'`.
  Add only directives required by the final normal-client implementation; never
  weaken the boundary for convenience.
- Capability tokens, token-bearing bootstrap URLs/fragments, authorization
  headers, report payloads, and raw exception text must never enter logs,
  diagnostics, referrers, exported HTML, persisted Inspector state, or other
  durable storage.
- Set no-cache and no-referrer protections. A refresh recomputes bounded reports
  safely and must not write Pi session JSONL or double-count WAL/checkpoint
  evidence.

**Logging and error reporting**

- Add one bounded diagnostic path using existing standard output/error
  facilities; do not introduce a logging framework for this feature.
- Startup, asset, API, refresh, and export failures log an event code, phase,
  bounded status, correlation/request id, and `redactBoundedText`-sanitized
  reason. Token-bearing URLs and raw exception text never leave the process.
- `/session-ins ui` reports a concise actionable startup/render failure instead
  of silently failing. API failures return a bounded structured error envelope;
  the browser renders an error state with retry guidance and the correlation
  id. Inspector errors remain isolated from Pi execution.
- Logging itself is best-effort and must not block or change command/agent flow.

**Semantic/UI compatibility requirements**

The transport migration must preserve the existing browser contracts, not merely
make an HTML page load:

- hash route authority, canonical deep links, active sidebar state, active tab
  state, and capability-driven tabs;
- active/tree scope and per-view range state, including 7D/14D/30D presets,
  validated custom ranges, remembered view state, and range membership;
- Back/Forward navigation, entity cross-navigation, entity focus, search/sort
  route semantics, and safe degraded/unavailable/unsupported routes and
  rendering;
- the pinned autocomplete contract: preserve preceding argument text and quoted
  values, retain the real provider-boundary mid-token limitation test, and do
  not claim Inspector can fix Pi's provider-side append behaviour;
- one canonical `loadInspectorBundle`/report projection path, with no
  browser-only business-rule arithmetic, duplicate reconciliation, or new
  renderer-specific evidence semantics.

Existing route/navigation/range/autocomplete tests should continue unchanged
where possible. Replace a test only when the replacement gives equivalent or
stronger coverage, and keep the pinned provider limitation documented.

**Small deliverables**

1. Server lifecycle, route/method allowlist, loopback binding, token handling,
   shutdown, and security tests; no report migration yet.
2. Read-only bundle/current/history/global API and bounded error envelope,
   backed directly by `loadInspectorBundle`.
3. Normal browser client fetch/bootstrap, loading/error states, offline-safe
   static exporter compatibility, and browser-local theme preference.
4. JSON export, safe refresh, removal of the module-to-string client path, and
   focused determinism/no-double-count tests.
5. Measure the accepted server migration against the pre-existing static path
   without reopening the transport decision; record regressions and follow-up
   work in the RC evidence package.

**Acceptance gates**

- A normal `/session-ins ui` invocation starts an ephemeral loopback server and
  the browser receives Current, History, and Global from API responses.
- Wrong host, peer, API token, method, route, path, and origin cases fail
  safely; protected API routes reject missing authentication, while the
  unauthenticated shell/static assets expose no report or session data. No CORS
  or arbitrary filesystem access exists.
- Refresh and repeated reads remain byte/datum deterministic, preserve native
  usage authority, and do not double-count or mutate Pi data.
- JSON, interactive UI, and explicit static HTML use the same bounded DTO;
  the UI can request JSON export through the API, and static HTML still works
  offline when the server is absent.
- Startup/API/render failures are visible to both CLI and browser users without
  leaking secrets or unbounded data.
- Existing route, navigation, scope, range, deep-link, cross-navigation,
  entity-focus, search/sort, capability, unavailable/unsupported rendering, and
  autocomplete boundary tests remain green or are replaced only by stronger
  equivalent tests; no provider-side autocomplete limitation is falsely marked
  fixed.
- Bootstrap-to-route transition is deterministic: `#token=...` is consumed
  before route parsing, replaced without adding a history entry, and leaves the
  browser on the canonical default route. Back/Forward navigation can never
  restore the bootstrap token fragment, and subsequent route
  parsing/serialization remains canonical and idempotent.
- No browser-only reconciliation or business-rule arithmetic is introduced.
- No Express/Fastify/server daemon/autostart is present, and the server has no
  production dependency beyond Node/Pi facilities.

**Release:** compatible implementation slices may bump the next patch version;
any public command-contract change requires SemVer review.

### Pre-M8.5 — executable reconciliation and property suite

**Status:** Planned. **Depends on:** Pre-M8.4.

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

**Release:** compatible test-only hardening may bump the next patch version.

### Pre-M8.6 — code optimization and client-bundle evaluation

**Status:** Planned. **Depends on:** Pre-M8.5 and the Pre-M8.3 dependency
review. **Related:** Pre-M8.4 localhost UI server.

Look for smaller, safer implementations before adding code or dependencies.
Use Context7 to verify current package APIs, but adopt an npm package only when
it is measurably better and passes the supply-chain gate.

**Client-build experiment**

Compare the normal client produced by Pre-M8.4 with an optional bundled-client
candidate using the same sanitized fixture, Node version, host, and benchmark
method. Pre-M8.6 may adopt or reject only the client build/bundling strategy;
it must not re-decide whether the accepted localhost server exists.

| Metric | Pre-M8.4 normal client | Optional bundled-client candidate | Delta | Evidence |
| --- | ---: | ---: | ---: | --- |
| Client source LOC | measured | measured | measured | reproducible command |
| Generated HTML bytes | measured | measured | measured | same report fixture |
| Render time | measured | measured | measured | repeated warm/cold samples |
| Package bytes | measured | measured | measured | `npm pack --dry-run` |

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

**Release:** compatible optimization or rejected-prototype documentation may
bump the next patch version only when it changes the shipped product.

### Pre-M8.7 — RC hardening and package audit

**Status:** Planned. **Depends on:** Pre-M8.1–Pre-M8.6.

Produce a release-candidate evidence package before M8 publication work. This
is the final readiness gate, not a license to skip the smaller preceding
reviews.

**Deliverables**

1. Run the executable invariant/property suite, dependency rules, static
   inventory dispositions, privacy corpus, and deterministic regression suite
   from a clean checkout.
2. Run `publint` and `npm pack --dry-run`; inspect the actual tarball contents,
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

**Release:** a compatible RC hardening pass may bump the next patch version;
publication remains part of M8.
