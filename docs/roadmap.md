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
