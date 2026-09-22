# Pi Session Inspector Roadmap

**Current release:** `1.4.0`

**Current state:** M0–M8 are complete, and token economics/cache accounting
shipped in `1.4.0`. Current and future work is listed below; completed milestone
history is preserved in the [roadmap archive](roadmap-archive.md).

**Next gate:** no release gate is currently scheduled. The open work below is
planning context, not a prerequisite for the published release.

## Delivery rules

- Keep each sub-milestone independently mergeable.
- Split work into small deliverables and PRs: target 2–5 SDD tasks per PR and
  roughly no more than 5–8 production files or 1–3k meaningful changed lines
  where the architecture permits it.
- Run focused checks, full tests, format, lint, typecheck, and packaging checks
  for every implementation PR. Keep the main branch green.
- A roadmap-only edit does not bump the package version. Compatible Pre-M8
  slices may ship as `0.9.x` patch releases (`0.9.1`, `0.9.2`, …). A public
  contract change still follows SemVer review.
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
- Transport changes preserve existing semantic contracts: canonical report
  loading, navigation/routing, ranges, active/tree scope, projections,
  evidence/coverage, privacy, determinism, and unsupported/unavailable
  behaviour. A transport decision is not permission to redefine those rules.

## Current and future work

Original follow-up numbers remain stable so existing references do not drift.
Completed follow-ups are in the archive.

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

**Status:** Implemented. **Depends on:** nothing.

**Decision:** choose the entity's existing navigation surface, not a local path. In the localhost UI, Tools tool-name affordances are real `entity=tool:<name>` route anchors: they filter Calls, focus the summary row, preserve route context, and clear through the route. Skills keep their published entity routes. In static HTML, tool and skill names are same-document anchors to the corresponding `#tools` and `#skills` sections; no filesystem path or producer string is exposed.

**Current state:** Both surfaces now have destinations for every rendered tool/skill affordance. The route remains bounded by published ids, static hrefs are fixed section fragments, and TUI output has no interactive link affordance to fix.

Expected implementation shape:
Acceptance verified:

- localhost tool and skill affordances use real route anchors with tests for `href`, filtering, and focus;
- static report tool and skill links resolve to emitted `#tools`/`#skills` targets with CSP/privacy tests;
- no local-path endpoint, editor scheme, or new persistence added; TUI has no interactive affordance for this item.

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

## Maintenance and hardening backlog

**Status:** Active and unscheduled. No item below is a release gate.

The unresolved maintenance and investigation items are kept here; resolved
items moved to the archive.

### Near term — duplication with one semantic owner

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
  version-string assertions more brittle. A fixed delay standing in for
  asynchronous work is that same brittleness — assert the condition instead,
  except where the assertion is an absence and keeps a documented settle.
- **Documentation.** Contributor-facing documentation remains dense. Shorter
  onboarding and clearer links from current work to durable decisions in ADRs and
  specs are reasonable future cleanup.

### Later — research

- Other harnesses stay item 9 above. The external review's Claude Code
  observation is recorded there rather than as a parallel initiative.

### 12. Theo pi-jev integration telemetry

**Status:** Research / upstream dependency.
**Depends on:** integration adapter registry only.

Integrate specifically with the `pi-jev` npm package published from
`TheoOliveira/pi-jev`. This is not a generic Jev integration and must not be
confused with the separate `@alexlikevibe/pi-jev` package from `iefnaf/pi-jev`.

Canonical Inspector integration key:

    pi-jev-theo

Presence must not be inferred from the generic `/jev` command because multiple
independent packages expose that command.

Current safe presence vocabulary:

    jev_find_tools
    jev_find_skill
    jev_evaluate

Persisted native tool calls may report explicitly observed calls to those tools,
but they must not be labeled as total Jev requests because automatic routing,
compaction, guards, orchestration, and other internal paths call Jev without
producing those Pi tool calls.

The current producer keeps request count, token usage, latency, and error state
only in process-local `JevClient.stats` and renders them through `/jev status`.
Inspector must not scrape status UI text, import producer internals, monkey-patch
the client, inspect API credentials, or infer hidden Jev requests.

Preferred upstream contract:

    pi-jev:telemetry:v1

A producer-owned, versioned Pi event carrying only bounded non-sensitive fields
such as event class, success, token count, elapsed time, activated-tool count,
recommended-skill count, and model-switch boolean.

No prompts, Jev state/questions/answers, tool names, skill bodies, tool
arguments/results, API keys, filesystem paths, or raw errors may reach Inspector
telemetry.

Candidate v1 Inspector counters:

    requests
    tokens
    errors
    autoRoutes
    toolsActivated
    skillsRecommended
    modelRouteDecisions
    modelSwitches
    compactions
    guardChecks
    agentDispatches

Do not derive `savedTokens` or `savedCost`. Savings remain an analysis over Pi's
native usage/cost evidence, not a producer counter.

Until the upstream telemetry seam exists:

- presence may be supported;
- explicit `jev_*` native tool activity may be reported under explicitly named
  counters;
- total Jev request/token accounting remains unavailable.

### 13. Subagent run outcome and effort breakdown

**Status:** Research / product follow-up.
**Depends on:** existing Agent execution evidence and subagent run attribution.

**Motivation:** token and cost totals answer which subagent runs were expensive,
but not whether that effort led to a terminal outcome or whether a run spent a
large amount of work before failing, being cancelled, or remaining incomplete.

Invariant: **Inspector observes runs, not role taxonomies.**

The goal is to make deterministic execution effort visible per subagent run
without inventing a semantic quality or "success" score.

A useful comparison should make cases such as these obvious from observed
evidence:

    <subagent A>   completed   6 tool calls    9k tokens    42s
    <subagent B>   failed     20 tool calls   31k tokens   3m12s

Subagent names, roles, and topology are producer-defined evidence. Inspector
must not assume or hard-code a role vocabulary such as `worker`, `scout`,
`reviewer`, or any orchestration-specific agent name.

The report must not infer that the first run solved its task correctly or that
the second "wandered". It reports execution outcome and effort only. Semantic
task quality remains unavailable unless a producer publishes an explicit,
bounded outcome contract.

**Current state:** Agent execution already exposes persisted subagent topology,
model, producer-reported status, usage/cost where available, and explicit
coverage/partiality. It does not yet provide a complete per-run effort breakdown
that answers how much execution activity occurred before that terminal state.

Research questions:

- which per-run facts are durably available from Pi and supported subagent
  producers: terminal status, start/end time, duration, generations, tool calls,
  errors, token usage, and cost;
- which activity can be attributed to a specific subagent run by stable
  persisted identity rather than by adjacency, timing windows, prompt text, or
  other inference;
- whether nested subagent activity belongs to the parent's effort breakdown,
  the child's breakdown, or both as explicitly labelled topology without
  double-counting;
- how async/incomplete runs are represented when the producer has not yet
  published terminal evidence;
- how coverage is expressed when usage is known but tool/generation activity is
  not, or vice versa;
- whether any producer-reported "completed" state means only execution
  completion rather than semantic task success. Inspector must preserve that
  distinction in naming and UI copy;
- how producer-defined subagent identity, role/name, and topology are represented
  without assuming a fixed agent vocabulary; unknown or new producer roles must
  remain renderable without code changes unless their evidence shape itself is
  unsupported.

Expected implementation shape:

- extend the existing Agent execution Tree/Table projections rather than add a
  separate analytics subsystem;
- expose only evidence-backed per-run fields, candidates being:
  - terminal status/outcome;
  - duration;
  - generation count;
  - tool-call count;
  - bounded error count/status;
  - token usage;
  - cost;
- retain `unavailable` / partial coverage independently for each evidence class;
- keep child usage a breakdown of already-counted native usage, never an
  additive total;
- derive only mechanically valid measures from observed facts, for example
  tokens per generation or tool calls per run, and only when their denominators
  have complete enough evidence;
- do not introduce an Inspector-defined quality, productivity, wandering, or
  success score;
- do not use an LLM/eval pass to judge whether the subagent solved its task;
- no new dependency or remote tracing backend is required;
- treat subagent names and roles as bounded producer evidence, not as Inspector
  enums or hard-coded categories;
- render arbitrary supported subagent identities consistently across Tree/Table,
  JSON, snapshot, and TUI surfaces;
- do not derive semantics from names such as `worker`, `scout`, `reviewer`,
  `oracle`, or orchestration-specific aliases.

Before implementation:

1. document the exact persisted evidence available for each supported subagent
   producer and distinguish observed facts from inferred ones;
2. define the per-run DTO/coverage contract before changing UI projections;
3. prove with fixtures that parent/child attribution does not double-count
   tokens, cost, generations, or tool activity;
4. include at least one completed, failed/cancelled, partial, and unavailable
   run case;
5. verify that identical canonical evidence renders the same outcome/effort
   semantics in the localhost UI, immutable snapshot, TUI where applicable, and
   JSON report.

Wont do:
- Cross-session delegated agents are out of scope here; they require explicit 
  producer-backed session correlation and are tracked separately in item 14.

### 14. Cross-session delegated agent correlation

**Status:** Research.
**Depends on:** item 13 only for presentation reuse; discovery/correlation is a
separate evidence problem.

**Motivation:** some orchestration tools launch delegated agents as independent
Pi sessions rather than as subagent runs persisted inside the parent session.
For example, a `herdrd-delegate` invocation may create work that is invisible to
the current session's native Agent execution tree even though it is logically
part of the same orchestration.

Inspector should be able to represent these delegated sessions only when a
producer exposes a stable, bounded correlation contract. It must not infer
parent/child relationships from timestamps, working directories, prompts,
session proximity, agent names, or other heuristics.

Research questions:

- which orchestration producers launch work in independent Pi sessions;
- whether they expose stable parent session, delegated session, run, task, or
  invocation identities;
- whether correlation evidence is persisted, live-only, or recoverable after
  restart;
- how delegated-session lifecycle maps to existing Agent execution semantics:
  started, running, completed, failed, cancelled, unavailable;
- whether a delegated session may itself launch further delegated sessions and
  therefore form a cross-session tree;
- how usage/cost is presented without double-counting the delegated session in
  both its own native session totals and the parent's orchestration breakdown;
- how historical/global reports distinguish physical Pi sessions from logical
  orchestration ancestry;
- what privacy/redaction rules apply to producer identities and correlation ids.

Expected implementation shape:

- keep Pi session identity and orchestration identity separate;
- add a producer adapter only when the producer publishes a real correlation
  contract;
- represent delegated sessions as linked session-backed runs rather than
  pretending they are native in-session AgentRuns;
- reuse the existing Agent execution projection where semantics genuinely
  match, but preserve the distinction between native subagent runs and
  cross-session delegated work;
- subagent/delegate names and roles remain producer-defined evidence, never an
  Inspector enum;
- no heuristic joins by time, cwd, prompt text, model, command name, or nearby
  session creation;
- missing correlation stays unavailable rather than guessed.

Initial producer candidate:

- `herdrd` / `herdrd-delegate`, subject to verifying that it exposes a stable
  parent/delegate correlation contract.

Before implementation:

1. document Herdrd's actual persisted/live correlation surface;
2. prove that parent and delegated sessions can be joined by explicit producer
   identity rather than inference;
3. define accounting semantics for parent orchestration views versus native
   per-session totals;
4. cover nested delegation, missing delegate session, incomplete work, restart,
   and duplicate/replayed evidence;
5. ensure global/history totals remain native session totals and are never
   inflated by logical orchestration links.
