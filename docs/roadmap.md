# Pi Session Inspector Roadmap

**Current release:** `1.2.0`

**Current state:** M0–M7, the follow-up evidence/report milestones,
Pre-M8.1–Pre-M8.8, the integration-architecture/configuration/debug milestone,
and M8 (publication and release) are complete. `1.0.0` is published to npm as
`@twkrash/pi-session-inspector` and released on GitHub as `v1.0.0`. The `1.0.x`
patch line has continued past it — `1.0.1` through `1.0.3` are published the same
way, `1.1.0` added the post-1.0 `mcp` semantic integration, and `1.2.0` is the
current release; it adds the multi-metric chart selection.

**Next gate:** none for `1.0.0`. The post-1.0 follow-ups below are the next
recorded work; they gate nothing and are not required for the published
release. MCP semantic integration shipped in `1.1.0` and multi-metric chart
selection in `1.2.0`. The maintenance and hardening backlog recorded after that
release is unscheduled too: it blocks nothing and carries no version.

**Post-1.0:** ten follow-ups are recorded at the end of this document — MCP
semantic integration (shipped in `1.1.0`), skill invocation evidence, Pi native
telemetry integration, push-based live updates, multi-metric chart selection
(shipped in `1.2.0`), usage attribution, working tool/skill links, additional
locales, other harnesses, and the loading state with a first-paint theme. None is
a release gate, and none blocks M8.

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
- Pre-M8.4's durable ADR/spec and mirrored public documentation adopted the
  localhost transport and immutable snapshot split, the adoption gate was
  accepted, and the implementation shipped in `0.10.0`.
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

## Post-1.0 — product, platform, integration, and evidence follow-ups

**Status:** Planned. **Depends on:** successful M8 / `1.0.0` publication.

This milestone is explicitly **not** a `1.0.0` release gate. It collects
product-facing follow-ups discovered during Pre-M8 hardening plus candidate
work raised after the `1.0.0` publication. Both halves follow the same rules:
items 1–3 are integration/evidence follow-ups with a recorded research
baseline, and items 4–10 are candidate product and platform work whose research
question is still open. Nothing in this section is scheduled, and no item in it
blocks a release.

### 1. MCP semantic integration

**Status:** Complete in `1.1.0`. The `pi-mcp-adapter` integration proven during
the integration-authoring architecture spike was squashed onto post-1.0 `main`
as `8cdd19d` on `feat/post1.0-mcp-integration`.

**Implementation record.** The spike branch `spike/mcp-integration` (pushed to
`origin`) and its head commit remain the durable research record: exact producer
contract, files and lines changed, the architecture measurement, the
negative-control result, and the verification evidence behind this baseline. The
shipped change is one adapter (`src/integrations/adapters/mcp.ts`), two
registration lines, focused tests, and the `docs/integrations.md` and README
matrix rows.

Research baseline:

- inspected producer: `pi-mcp-adapter 2.34.0`;
- producer exposes a versioned sanitized status channel:
  `pi-mcp-adapter/status/v1`;
- persisted approval evidence uses the versioned `mcp-approval-v1` entry;
- evidence contains bounded identifiers/hashes and no user prose;
- server/tool identifiers and hashes are discarded by Inspector where they are
  not required for the report;
- status is treated as presence/gauge evidence, never as an event counter;
- the spike required zero integration-specific production edits outside the
  adapter and registration surface.

Expected implementation shape:

- one `mcp` integration adapter;
- registration in the integration composition root;
- focused tests;
- `docs/integrations.md` and README matrix updates;
- no MCP-server-specific integrations;
- no core/report/UI integration-key lists;
- no parsing of arbitrary MCP arguments, results, prompts, or errors.

Before-merge items (all closed):

1. the producer-contract review was repeated against `pi-mcp-adapter 2.34.0`,
   the version the next release targets: the status channel and snapshot
   version, the `mcp-approval-v1` tool/iframe record shapes, the exact key
   lists, and the SHA-256 hex rule all match the adapter's readers;
2. the mechanical integration-count mirrors were replaced by the declaration
   itself (`reportIntegrations(integrations).length`);
3. the adapters barrel review concluded *keep*: it is the single import seam for
   the composition root and the adapter test, so removing it would trade one
   re-export line for explicit imports in two files. Every site that described
   registration as one line now names the re-export line as well (README,
   `docs/integrations.md`, ADR 0019, the composition-root comment);
4. the privacy/dedup/status review and the verification suite were run: 1000
   production tests, 35 invariants, typecheck, lint, format, dependency rules,
   `knip`, `publint --strict`, and `build:web:check` all pass.

Architecture acceptance:

- ordinary integration-specific core edits outside adapter/registration remain
  zero;
- presence, persisted evidence, live telemetry, retention, report ordering, and
  UI observation continue to derive from the generic integration descriptors;
- adding `mcp` must not reopen the integration architecture.

### 2. Skill invocation evidence follow-up

Preserve the findings from the Pi skill-attribution investigation and do not
infer skill use from presentation-only signals.

Research baseline (`@earendil-works/pi-coding-agent 0.85.1`):

Pi can render the same visual form:

    [skill] <name>

from two semantically different sources.

**Compact read renderer**

A normal read of a path whose basename is `SKILL.md` is rendered compactly as
`[skill] <parent-directory>`.

This is presentation-only:

- the label is derived from the read-tool path;
- it does not prove that Pi resolved or invoked a skill;
- the parent directory is not guaranteed to equal the declared skill name;
- no dedicated skill event or persisted skill marker exists.

Inspector must therefore continue to treat ordinary `SKILL.md` reads as
insufficient skill-invocation evidence.

**Expanded skill envelope**

An explicit/resolved `/skill:<name>` expansion can be persisted as a normal
`role:"user"` message containing an anchored envelope such as:

    <skill name="..." location="...">
      ...
    </skill>

Pi exports `parseSkillBlock()`, and the skill name can be recovered without
retaining the body/location.

However this representation is:

- serialized message content rather than a dedicated entry type;
- undocumented;
- unversioned;
- path-bearing;
- not a stable telemetry contract;
- not identity-correlated with Inspector's existing live `/skill:` observation.

The same explicit invocation may therefore be visible through both:

    live input `/skill:<name>`
    persisted skill envelope

and no exact shared invocation identity exists.

Do **not** adopt count-level `min()` / `max()` pairing as deduplication without
a stronger producer invariant. Live-only and envelope-only observations can
coexist for the same skill, so aggregate cancellation can undercount distinct
events.

Post-1.0 options:

1. Prefer an upstream/versioned Pi skill-invocation signal carrying a bounded
   skill name, stable invocation identity, source, and lifecycle state.
2. If Inspector adopts the current skill envelope, treat it as its own explicit
   evidence class (`skill-envelope`, Pi JSONL/native), with documented stability
   risk, privacy stripping, and a reviewed identity/dedup contract.
3. Consider replacing the pre-expansion `/skill:` counter with a single
   successful-expansion authority only if the product intentionally changes the
   meaning from "explicit skill request observed" to "successful Pi skill
   expansion observed".
4. Do not infer invocation from:
   - `read(.../SKILL.md)`;
   - filesystem paths;
   - tool names;
   - prompts or assistant prose;
   - skill body content.

Any implementation that broadens `skills.invocationCount` /
`SkillRow.explicitInvocations` must review and update their semantic naming and
documentation rather than silently changing the meaning of "explicit".

### 3. Pi native telemetry integration

Evaluate Pi's native telemetry contracts as a live timing/lifecycle evidence
source. Inspected 2026-09-16 against pinned
`@earendil-works/pi-coding-agent 0.85.1` (nested `pi-telemetry`,
`pi-agent-core`, `pi-ai` at the same version) and upstream `main` HEAD
`6671c60`.

Current status:

- schemas exist: `@earendil-works/pi-telemetry` owns the vendor-neutral
  `TelemetryContext`/`TelemetrySpan` contract, and `pi-agent-core` declares
  `AI_TELEMETRY_SCHEMA` (`pi.ai.request`) plus `HARNESS_TELEMETRY_SCHEMA`
  (`pi.harness.*` and `pi.session.write`);
- the stock coding-agent does not emit them: the CLI never constructs or
  accepts a `TelemetryContext`, and the normal `AgentSession`/`Agent` path does
  not use the harness (harness imports exist only under `experimental/`). The
  pinned dependency tree has exactly one span start site, `pi.harness.hook`,
  and with no context every span resolves to `NOOP_TELEMETRY_CONTEXT`;
- no extension injection/subscription seam exists: `ExtensionAPI`,
  `ExtensionContext`, `ResourceLoader`, and the AgentSession runtime services
  expose no telemetry, and the process-local `EventBus` carries no spans;
- `pi-ai` only forwards `telemetryContext` into provider request options and
  owns no schema.

Upstream dependency (all three are required; none exists today):

1. instrument the coding-agent path so the declared spans are actually started
   (at minimum `pi.ai.request` around provider calls);
2. accept a `TelemetryContext` at the SDK/host boundary (for example
   `CreateAgentSessionOptions.telemetryContext`, defaulting to the no-op
   context) and thread it to `pi-ai` and the harness;
3. expose one bounded completed-span observer to extensions (span name,
   schema-declared non-sensitive attributes, status), reusing
   `ExtensionAPI.on` rather than a new transport or a backend object.

Inspector usage rules if that seam lands:

- telemetry enriches timing/lifecycle evidence only (provider attempt
  boundaries, streaming latency, operation identity/recovery, terminal
  outcome); it never replaces persisted Pi facts;
- persisted Pi JSONL remains the usage/cost authority; telemetry usage is at
  most a cross-check for requests that persisted no assistant entry, counted
  once and never additive to native usage;
- only schema-declared, non-`sensitive` attributes may reach Inspector WAL or
  reports; prompts, completions, tool arguments/results, file contents,
  provider payloads, headers, credentials, and free-form error text stay out;
- high-cardinality `pi.*` identifiers (session, response, operation) are
  bounded or hashed, never stored raw;
- no monkey-patching, Pi-internal wrapping, `createAgentSession` replacement,
  or upstream modification is accepted; with no public seam the integration
  stays `unsupported`/`unavailable` rather than approximated from private
  internals.

### 4. Push-based live updates (WebSocket) — research required

**Status:** Research. **Depends on:** nothing; independent of the localhost
transport that shipped in `0.10.0`.

**Current state:** the localhost UI fetches a full payload on load and on the
explicit Refresh action (the `refresh` handler in `scripts/web/client.js`), and
`src/ui/server.ts` reads Inspector's own store per request. Nothing watches the
WAL, so a reader watching a running session sees stale numbers until they
refresh, and staying current costs one full payload per refresh.

Research questions:

- where can a change signal honestly come from: an in-process event on the
  observer's write path, a filesystem watch on the exclusive WAL shard, or a
  polling tail with an offset? Each candidate has to hold invariant 1 (Pi
  remains the authority) and invariant 6 (one writer id owns one shard);
- what is the bounded message shape? A push channel must not become a second
  report path: either it signals "something changed, refetch", or it carries the
  same DTO deltas the report path already produces;
- how does this stay additive? The static HTML report has no server, so the
  localhost UI gains push, the static report keeps its behaviour, and the DTO
  stays identical;
- what happens on reconnect, on multiple tabs, on a stale client, and on a
  session that stops writing;
- transport: a WebSocket on the existing loopback server is the candidate, but
  it is a new protocol surface on a server that speaks bounded HTTP GETs today.
  Compare Server-Sent Events (one-way, text-only, no framing dependency) before
  committing to either.

Expected implementation shape:

- an ADR for the transport and its lifetime;
- one bounded change notification;
- no new dependency unless the ADR justifies it;
- the existing range/tab routes unchanged.

Before merge:

1. the transport ADR is accepted;
2. a test proves an unchanged payload is not re-sent;
3. a `file://` report is verified unchanged.

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

### 6. Attributing tokens and cost to tools, skills, environment, and more

**Status:** Research. **Depends on:** item 2 above — attribution cannot precede
the evidence it would attribute.

**Current state:** usage is aggregated per session/day/model, and skill evidence
is invocation-level only. Invariant 4 binds the result: native usage is counted
once and every breakdown is a breakdown, never an additive parent total.

Research questions:

- what does Pi persist that correlates a usage record with a tool call, a skill
  invocation, or an environment fact? The correlation must come from persisted
  data, not from inference over adjacent entries;
- attribution windows: a tool call has no usage of its own, so the candidate
  models (per-turn boundaries, per-message deltas, proportional shares) each need
  a stated accuracy claim, and the report must name the method instead of
  implying measurement;
- the honest fallback for anything unattributable is an explicit `unattributed`
  bucket, not a spread;
- privacy: attribution must not pull tool arguments, results, prompts, or file
  contents into Inspector state (invariant 3); dimension keys stay bounded and
  redacted like every other producer string.

Expected implementation shape:

- projection-level work with no new source of truth;
- a documented attribution method, stated visibly wherever a breakdown appears;
- per-dimension breakdown rows in the existing report DTO.

### 7. Make the tool and skill link affordances navigate

**Status:** Defect to reproduce, then a design decision. **Depends on:** nothing.

**Current state:** the localhost client builds a real hash-route anchor only for
entity kinds whose id the payload publishes (`entityLink`/`entityMark` in
`scripts/web/client.js`), and every other kind falls back to a plain span; the
static report (`src/ui/snapshot.ts`) emits no content anchors beyond the skip
link. An anchor that renders without a route therefore cannot come from either
surface as written, which leaves the reproduction, the surface, and the intended
destination open. Reported symptom: rows in Tools and Skills present a link
affordance that does nothing when clicked.

Expected implementation shape:

- the surface is named in the reproduction (static report opened from disk,
  localhost UI, or the TUI) together with the element and section involved;
- the destination is chosen on purpose. Two candidates exist: navigate to the
  entity's own subview/filter, which the client route already supports, or open a
  file path in the reader's editor or file manager;
- opening a local path is constrained by the browser and must be designed for it:
  a page served from `http://127.0.0.1` cannot open local paths, so this needs an
  explicit loopback endpoint or an editor URL scheme, and either choice exposes
  paths and therefore needs privacy review;
- an affordance that cannot lead anywhere stops looking like a link; a visibly
  non-interactive style is the fallback, not a dead anchor.

Before merge:

1. every interactive-looking affordance either navigates, opens the intended
   target, or is visibly not a link;
2. verified in the static report and in the localhost UI;
3. a test covers the anchor's `href` for each entity kind that publishes an id.

### 8. Additional UI languages (German, Russian, Ukrainian)

**Status:** Ready for a spec. **Depends on:** nothing; the Inspector-owned
settings schema already exists.

**Current state:** UI copy is centralized in `src/ui/i18n/catalog.ts`
(`ENGLISH_CATALOG`) behind the `t()` helper (`src/ui/i18n.ts`), and the TUI, the
localhost client, and the static report all read their strings from it.

Expected implementation shape:

- a key in the Inspector-owned settings schema (`src/config/settings.ts`,
  ADR 0019): `language`, a closed enum, default `"en"`. The schema's existing
  rules cover the rest: an unknown key is ignored, a malformed document degrades
  to defaults with a bounded diagnostic, and no new failure mode may prevent
  startup;
- `de`, `ru`, and `uk` catalogs; a missing key falls back to English rather than
  to the key name or an empty string;
- the preference reaches each surface deliberately: the localhost UI can carry it
  in the payload, the static report can bake it, and the TUI reads it directly;
- what is never translated is decided explicitly: canonical report values, entity
  ids, metric and model identifiers, statuses that are part of the DTO contract,
  and the JSON report;
- a stated overflow rule for the TUI's fixed-width columns and the report's
  tables, because German and Ukrainian strings are longer than their English
  counterparts;
- the preference is not evidence: it never enters the report DTO as
  usage-relevant data.

Before merge:

1. switching `language` changes the TUI, the localhost UI, and the static report
   consistently;
2. an unsupported value falls back to English with a bounded diagnostic;
3. tests cover the fallback and one non-English catalog per surface.

### 9. Support for other harnesses (Claude Code, Codex, Hermes, others)

**Status:** Research and architecture spike. **Depends on:** nothing, but it is
the largest item in this section.

**Current state:** Pi's persisted session data is the source authority and
`src/pi/adapter.ts` (`parseSessionJsonl()`) is the only producer of canonical
entries. Anything Inspector cannot read honestly is reported `unsupported` or
`unavailable`.

Research questions:

- for each candidate harness: does it persist sessions locally at all, in what
  format, with what stability guarantee, and does it persist usage/cost or only
  messages? A harness that stores nothing locally cannot be observed from disk;
- the identity model: each harness has its own session ids, project roots, and
  possibly its own usage semantics, so per-harness totals stay separate and no
  cross-harness figure is presented as one measurement (invariant 4 applies
  across sources, not only inside one);
- what scope and active ancestry mean for a harness with a different tree shape
  (invariant 5 forbids inventing branch ids);
- privacy: a second format brings its own payloads, prompts, and tool records, so
  the same redaction and bounded-string rules apply before anything reaches
  Inspector state (invariant 3);
- packaging: harness support must not add a runtime dependency without an ADR, and
  the package has to stay installable where that harness is absent.

Expected implementation shape:

- extend the existing pattern — integrations are descriptor-driven and adapters
  translate a producer into evidence — to a *session source* dimension;
- an ADR for the source model;
- one adapter per harness with a documented stability contract;
- honest `unsupported` behaviour for the rest.

Before merge:

1. one non-Pi harness is read end-to-end from its own persisted data;
2. per-source usage authority holds, with the source named in the report;
3. a fixture matrix of sanitized samples exists for that harness;
4. Pi-path behaviour is unchanged.

**Research input: Claude Code as the first candidate.** An external
architectural review proposed Claude Code as the plausible first non-Pi source:
its sessions are local JSONL with parent-linked records, model and usage data,
tool calls and results, and sidecar subagent transcripts. These are leads from
that review, **not accepted source contracts** — nothing about the shape or
stability of that format has been verified here. The useful part is the pipeline
shape, not a commitment to a harness:

```text
harness/session source → source adapter → canonical model
                      → reports / L2 projection → JSON, HTML, TUI
```

**Prerequisite before choosing Claude Code as the first implementation.** Run a
dedicated source investigation and record it as a research document; adopt a
source model only through an ADR. The investigation must establish:

- persisted session location, schema, and version-drift behaviour;
- record identity, parent linkage, rewind/branch semantics, and active ancestry;
- per-metric evidence authority: `native`, `inferred`, or `unavailable`;
- compaction behaviour and which evidence survives it;
- subagent persistence, parent linkage, and the availability of status, model,
  and usage;
- lifecycle hooks, and whether they carry evidence the persisted data does not;
- privacy and redaction implications of the second format;
- the mapping onto the existing canonical model;
- which Pi-specific concepts need a source-specific replacement.

Known caveats that must survive that investigation:

- cost may have to be derived rather than read as native, which is a different
  evidence class and must be named as such wherever it appears;
- there is no Pi tracking-marker equivalent, so active-scope semantics need a
  source-specific anchor instead of a reused marker;
- compaction usage may stay `unavailable`, and subagent evidence comes from a
  different persisted source than Pi's tool results;
- the in-Pi TUI and the Pi inventory semantics do not port to another harness.

The progression is deliberate, and no stage may be skipped:

```text
preliminary lead → dedicated research document → source-model ADR
                 → implementation plan → code
```

No CLI/bin surface, no lifecycle hooks, no adapter, and no implementation task is
added for a harness that has not passed the investigation above.

### 10. Loading state and first-paint theme

**Status:** Ready for a spec. **Depends on:** nothing. Distinct from item 4:
push decides when data arrives, this decides what the reader sees while it has
not arrived yet.

**Current state:** `src/ui/web/shell.html` carries one hidden `#loading` line
("Loading report…") that `setLoading()` in `scripts/web/client.js` toggles, so a
cold load shows a single sentence where the report will be. Theme is
browser-local: a click toggles `theme-dark` on `body` and nothing is persisted —
the browser regression asserts zero storage writes — while
`src/config/settings.ts` already resolves `theme` with `CLI option >
settings.json > product default` precedence and reports its `themeSource`. The
interactive server serves the shell untinted, so the first paint is always the
product default: the reader sees the other theme until the data lands, and the
click is lost on reload.

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

Before merge:

1. a cold load paints the resolved theme before any report data arrives;
2. the loading window is asserted through the client harness — visible while a
   response is deferred, gone after the render, and announced once;
3. a reload paints the resolved preference again with the storage-write
   assertion still empty.

### Acceptance

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

## Maintenance and hardening backlog

**Status:** Recorded, unscheduled. **Depends on:** nothing. No item here is a
release gate and none is required for the published `1.2.0`.

An external architectural/code review of `main` after `1.2.0` produced the
findings below. Each one was checked against the tree before it was recorded, and
findings already covered by an existing item are cross-referenced rather than
restated. The review's praise is not repeated here, because praise is not work.
Nothing below weakens the observer-only, privacy, determinism, or lifecycle
invariants.

### Immediate — confirmed defect: macOS parent-session containment

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

### Near term — duplication with one semantic owner

- `roundCost()` exists as six byte-identical private copies — `core/canonical.ts`,
  `core/reports.ts`, `core/reduce.ts`, `integrations/subagents.ts`,
  `ui/report-projection.ts`, `ui/ui-projection.ts`. They encode one accounting
  semantic (the retained-precision cost rounding), so one shared home keeps the
  rule from drifting between layers or projections.
- `integrations/subagents.ts` does **not** duplicate the ID digest: the helper
  `opaqueSubagentId()` is the single producer. What is duplicated is the
  resolution around it — the six-line "own run id, else the aggregate run id plus
  `#index`" fallback appears for both `results[]` and
  `workflowChildren.children[]`. Consolidate the expression, not the digest.
- Record guards named `isRecord` exist with three distinct semantics: a
  non-array record (`core/canonical.ts`, `core/retained-aggregates.ts`), a loose
  object that admits arrays (`core/reduce.ts`, `core/live-counter-fold.ts`,
  `integrations/adapters/shared.ts`, `pi/adapter.ts`, `pi/scope.ts`), and a
  plain-prototype record (`storage/recovery.ts`). Only identical predicates may
  be merged; the distinctions are deliberate and stay visible.

### Medium term — maintenance and investigation

- **Composition root.** `src/index.ts` owns several unrelated responsibilities —
  command handling, runtime/session state, evidence assembly, and UI/server
  composition. Prefer incremental extraction of those boundaries over a rewrite,
  preserving every lifecycle semantic and the existing dependency-cruiser edges.
- **`liveSessions` lifecycle.** The process-global `Map` in `src/index.ts` has no
  eviction path — nothing deletes an entry. Establish ownership first (per
  session, per runtime, or per process), then choose a cap or retention rule.
  This is an investigation, not a scheduled change.
- **Authored browser sources.** The authored sources under `scripts/web/` are
  plain JavaScript and sit outside `tsc` — `tsconfig.json` includes
  `scripts/**/*.ts` only — so the route, range, and client logic is untyped.
  Prefer migrating it to TypeScript through the existing esbuild pipeline over
  adding a large JSDoc layer, with shipped behavior, the three-file asset
  contract, and the deterministic build unchanged.
- **Observer failure visibility.** Many observer failure paths swallow their
  errors to preserve the "never break Pi" rule, and only a few surface a bounded
  reason through the debug log. Extend bounded failure reasons into debug mode
  only — event code, phase, and a `redactBoundedText`-sanitized reason. Raw
  exceptions, paths, producer payloads, prompts, and credentials must not reach
  the log, and the privacy model does not change to make the output nicer.
- **Test hardening.** No coverage tooling exists (`test` and `test:invariants`
  only). Add informational coverage first, with no percentage gate. Add one more
  Pi persisted-format version or an explicit format-drift fixture. The
  hand-rolled browser harness has known limits: record that as a testing risk
  rather than prescribing a replacement, and do not make process or
  version-string assertions more brittle.
- **Documentation.** Contributor-facing documentation is dense and this roadmap
  has accumulated implementation history. Shorter onboarding, and a roadmap that
  keeps to current and planned work with durable decisions in ADRs and specs, is
  a reasonable future cleanup; no historical material is deleted for it.

### Later — research

- Other harnesses stay item 9 above. The external review's Claude Code
  observation is recorded there rather than as a parallel initiative.

**Not recorded on purpose:** reviewer style preferences, module size treated as
a defect by itself, an arbitrary coverage percentage gate, replacing the browser
harness, merging record guards whose semantics differ, and rewriting historical
1.x roadmap material.
