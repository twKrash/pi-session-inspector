# Pi Session Inspector v1 specification

**Status:** approved design baseline. **This document specifies future work; no production implementation exists yet.**

## 1. Product contract

Pi Session Inspector is a deterministic, local-only Pi extension that reconstructs session analytics from Pi-native persisted data, with narrowly scoped live/cooperative telemetry for facts Pi cannot reconstruct. It never calls an LLM for analysis and never changes, blocks, delays, or supplies Pi agent execution.

### Scope

| Version | Included |
| --- | --- |
| v1 | latest stable Pi only; current/history/global reports; active/tree selection; full-screen TUI; self-contained HTML; deterministic JSON; Pi replay; metadata WAL/checkpoint/recovery; 14-day hot retention; integrations in §10 |
| v1.x | German/Russian catalogs, richer charts, Lens-specific view, RTK rewrite telemetry if upstream supports it, repair command, Markdown export, comparison, configurable retention/redaction |
| Later | Hermes adapter, external SDK, database justified by benchmark, performance regression detector, semantic skill effectiveness, external export |

### Explicit exclusions

No cloud/backend/daemon/always-running server, SQLite, mandatory Bun, provider wire tracing, prompt/output/raw-argument storage, generic extension scraping, output scraping, or Hermes implementation.

## 2. Requirements

| ID | Requirement |
| --- | --- |
| PRD-01 | Analytics are deterministic: same normalized inputs produce byte-identical JSON. |
| PRD-02 | Pi JSONL remains source of truth. Inspector never rewrites/appends Pi sessions except one namespaced `appendEntry` tracking marker. |
| PRD-03 | Telemetry failure is isolated: hooks return no mutation and bounded storage failures disable Inspector writer, never Pi. |
| PRD-04 | Current view defaults to active branch; history/global resource views default to full tree. Scope and renderer are independent. |
| PRD-05 | UI distinguishes `0` from unavailable, unsupported, inferred, or partial observation. |
| PRD-06 | Reports include models/usage/cost, generations, tools, errors, command families, compactions, agents, skills, integrations, and chronological ledger only where evidence permits. |
| PRD-07 | JSON is deterministic; HTML is self-contained/offline and uses no CDN/network; TUI uses full-screen `ctx.ui.custom()`. |
| PRD-08 | Local persistence excludes prompt/output/result/raw arguments and applies allowlist/redaction before any Inspector write. |
| PRD-09 | Per-process writers are append-only shards; maintenance is crash-recoverable and cannot regress source cursors. |
| PRD-10 | History discovery is bounded to Inspector manifests, not a full Pi-session rescan. |
| PRD-11 | v1 supports Pi `0.85.1` API/format baseline and latest stable Pi at implementation release; older versions are unsupported. |
| PRD-12 | Public telemetry is process-local, best-effort, at-most-once as observed; it is safe with no consumer. |

## 3. Commands and scope

The renderer is positional; the previous `--format` flag and the `current|history|global|ledger` first-token targets are removed.

```text
/session-inspector [ui|tui|json] [target] [options]
/session-ins ...                                  # identical alias

modes
  ui       one self-contained HTML document containing Current, History, and Global
  tui      interactive Pi full-screen TUI
  json     deterministic JSON export

targets
  tui   current | ledger           (default current)
  json  current | history | global (default current)
  ui    — none: the document carries its own in-page navigation

options
  --scope active|tree    default active; for `ui` it selects only the initial view; for
                         json history|global it stays fixed at tree
  --theme dark|light     ui only
  --output PATH          ui, json
  --no-open              ui only
  help | --help | -h     usage panel (esc/q closes)
```

- No arguments behaves as the common case: `/session-inspector` → `tui current`.
- `ui` always produces exactly one bundle with both precomputed current views (active and tree); `--scope` never changes what is precomputed, only which view renders first.
- `getArgumentCompletions(prefix)` is implemented on both registrations and is token-aware: first token → modes plus `help`; after a mode → that mode's targets; after `-`/`--` → options valid for that mode; after `--theme`/`--scope` → their values; `null` when nothing matches.
- `--format`, `current|history|global|ledger` as a first token, unknown modes/targets/options, missing or empty values, `--scope active` with `json history|global`, `--theme` with `tui`/`json`, `--output` with `tui`, and `--no-open` with `json` all return one-line usage plus `Run /session-inspector help`, never the generic failure text.
- Runtime unavailability (current session unavailable / history TUI unavailable) keeps its own distinct message so bad syntax and no data are never conflated.
- For `tui`/`json current` `--scope` selects the replayed entry set. Ephemeral (`--no-session`) runs may show current in-memory state but are explicitly non-durable and unavailable to history/global.

### Offline `ui` bundle

`ui` returns one self-contained document (`InspectorBundle`, `schemaVersion: 1`) with the theme, initial scope, both precomputed `CurrentView`s, `history`, and `global`. Report-derived tables live only under `view.report.*` with bounded `daily` range rows and a precomputed `evidence?` sibling; `--scope` only selects the initially displayed view, and in-page scope switching swaps the two precomputed DTOs with no host call, re-replay, or browser-side fold. Range presets filter only the embedded bounded rows. A section or view that fails becomes `availability: "unavailable"` with a bounded diagnostic code while the rest renders; rows past a cap are marked truncated rather than silently dropped. The document inlines escaped JSON with no network, CDN, or server and is byte-identical for identical inputs.

## 4. Canonical data model

All records have schema version, ID, harness, source kind, session ID, timestamp, category/action, status, confidence, and bounded metadata. Optional native entry/tool IDs and agent parentage are preserved where known.

```ts
type Status =
  | "attempted" | "blocked" | "running" | "succeeded"
  | "failed" | "interrupted" | "unknown";

type Confidence =
  | "native" | "live" | "cooperative" | "inferred"
  | "unavailable" | "unsupported";

type CanonicalRecord =
  | SessionRecord | AgentRunRecord | GenerationRecord | ToolExecutionRecord
  | BranchSelectionRecord | IntegrationObservationRecord | LedgerRecord;
```

Native Pi IDs are never relabeled as derived IDs. Derived turn/agent IDs derive from stable source IDs using SHA-256. WAL event IDs and process writer IDs use full `crypto.randomUUID()`; no truncation. Ordering is timestamp, writer ID, writer sequence, event ID. Only per-writer order is exact; merged order is marked approximate when clocks collide/skew.

### Scope semantics

- **Active:** ancestor path to active leaf, intersected with append-order entries after earliest valid tracking marker.
- **Tree:** all append-order entries after earliest valid tracking marker.
- A branch is a position (leaf/path), not an invented persistent Pi branch ID.
- Fork/clone are separate session files and are never silently merged.

### Report DTO additions

All additions are additive and keep JSON byte-identical for a given input.

```ts
type IntegrationPresence = "present" | "absent" | "unknown";

type SessionReport = {
  // existing fields unchanged
  tools: (Tool & { source?: string })[];             // inventory source label; absent when the name is unknown
  commands: { state: EvidenceState; items: readonly CommandRow[]; count: number | null };
  skills: {
    state: EvidenceState;                            // inventory availability only
    items: readonly SkillRow[];                      // inventory names ∪ counted invocation names
    invocationState: EvidenceState;
    invocationCount: number | null;                  // exact: sum(counts) + otherInvocations
    otherInvocations: number | null;                 // exact overflow beyond the 64-name cap
  };
  resources: { state: EvidenceState; items: readonly ResourceSourceRow[] };
  agentActivity: AgentToolActivity;                  // native subagent tool activity, breakdown only
  agents: AgentRun[];                                // rich layer; optional bounded agent/artifacts
  agentEvidence: EvidenceState;
  integrations: IntegrationObservation[];            // one row per known key, ordered
  errors: (ErrorRecord & { message?: string })[];    // bounded, redacted message only
};
```

- `Tool.source` is the sanitized source label of that tool name in the current inventory; it is absent when the name is not in the inventory and never inferred from the tool-name prefix.
- `SkillRow` keeps `name`, optional `sourceLabel`/`scope`/`origin`/`description`, and optional exact `explicitInvocations`; absent means unavailable, never `0`.
- `AgentRun` keeps `id`, optional `parentId`, optional bounded `agent` label, `status`, optional `usage`, and optional `artifacts: "available" | "missing"`. `artifacts` is present only when a validated published reference exists for a completed run.
- `IntegrationObservation` carries `integration`, `presence`, `state`, optional `version`, and optional allowlisted `counters`; presence never implies activity and state never implies installation.
- `ErrorRecord.message` is derived only from Pi-persisted `errorMessage`, bounded to one single-line value (≤200 bytes) with secret/path/URL redaction; tool-result text is never read.
- History/global add `inventory: { commands: number | null; skills: number | null; resources: number | null }`; `null` means unknown, never zero.

## 5. Source precedence and reducer

1. Persisted Pi assistant, tool-result, compaction and branch-summary usage/cost is billing authority and counted once.
2. WAL augments duration/state only; it cannot replace Pi usage/cost.
3. Integrations enrich attribution/metrics. Child usage is a breakdown, never added to parent total.
4. Checkpoints cache reducer state; source mismatch invalidates/replays them.
5. Sealed checkpoints are authority only for safely expired analyzer-owned WAL facts. Pi remains replayable authority.

One deterministic reducer produces immutable `SessionReport` and `GlobalReport`; ledger is a lazy projection from the same normalized records.

## 6. Live observer and telemetry protocol

Subscribe only to observer lifecycle surfaces: session, agent, turn, message, tool, compaction/tree, model/thinking, shutdown. Never inspect/provider-copy bodies, mutate payloads, return hook results, or subscribe to control hooks for observation.

### Foreign public bus and the bounded `input` observation

Two foreign public surfaces are also observed, observer-only and failure-isolated:

- **Permission System bus.** `permissions:ready`, `permissions:ui_prompt`, and `permissions:decision` on Pi's public event bus. They are translated to a fixed bounded counter set; `origin`, `value`, `matchedPattern`, `agentName`, `forwarding`, and `request` are never read. `ready` is presence only.
- **Pi `input`.** Subscribed **solely** to count explicit `/skill:<name>` invocations. The handler returns nothing, never transforms, blocks, or handles, inspects only the leading `/skill:` token, accepts the name only when it matches the bounded skill-name grammar and the current `source === "skill"` inventory, discards everything after the name (arguments, prompt text), and swallows any throw. Model-driven skill loads (`read`/`bash` on `SKILL.md`) are not observable safely and stay explicitly `unavailable`; Inspector never infers usage from tool names or file reads.

### Bus `pi-session-inspector:telemetry:v1`

```ts
type TelemetryEnvelope = {
  schemaVersion: 1;
  source: string; metric: string; value: number | string | boolean;
  unit?: string; kind: "event" | "counter" | "gauge";
  dimensions?: Record<string, string | number | boolean>;
  timestamp?: number;
  attribution?: Record<string, string>;
};
```

Validation before clone/stringify: envelope <=8 KiB; source <=64 bytes; metric <=96; unit <=24; string `value` <=128; <=12 dimensions; key <=48, string dimension value <=128; attribution IDs <=128; numbers/timestamps finite; identity keys satisfy conservative ASCII-token grammar. String values are bounded **state values** (for example `"full"` for `caveman` mode), not arbitrary payload text; they are redacted before cardinality, aggregation, WAL, and diagnostics. `counter` requires numeric value; `event` and `gauge` may use redacted string/boolean state. Invalid/oversize input is discarded with rate-limited code-only diagnostics. At most 256 redacted dimension signatures per source/metric/session; overflow increments a counter without storing supplied values. Counters may coalesce; events never do; gauges retain last value per window.

Producer and consumer both swallow failures. No acknowledgement, retries, cross-process delivery, schema negotiation, or exact-once claim exists.

### Durable fold of live counters

Allowlisted `kind: "counter"` envelopes from the foreign surfaces above are folded, cursor-based, into checkpoint aggregates (`integrationCounters`, `skillInvocations`, `skillOverflowInvocations`, `presence`) and read back as `effective = merge(checkpointAggregates, deltaCounters)` (ADR 0014). Only records strictly after each writer's checkpoint cursor are folded, so repeated reads, repeated maintenance passes, and `/resume` writer shards never double-count; the extension flushes its live writer before a report fold so observed events are already durable. `event`/`gauge` envelopes remain write-only. The surfaces are process-local, have no backfill, and their detail expires with the 14-day cutoff while the folded aggregates survive.

## 7. Storage, recovery, and retention

Root uses Pi agent-dir API when available:

```text
~/.pi/agent/session-inspector/v1/
  sessions/<full-session-id>/{meta.json,checkpoint.json,inventory.json,maintenance.lease,writers/,wal/}
  reports/{<session-id>.html,global.html}
```

### Checkpoint aggregates and inventory artifact

Checkpoint `aggregates` carries strictly validated, additive fields (`schemaVersion` stays `1`; absence means "not folded yet"): `integrationCounters` (allowlisted safe integers, ≤16 keys per integration), `skillInvocations` (`Record<sanitizedSkillName, number>`, ≤64 names matching the skill-name grammar), `skillOverflowInvocations` (exact invocation count for names beyond the cap, counted per invocation), `presence` (`{ permission?: boolean }` only), and `resourceCounts` (`{ commands: number; skills: number }`). Invalid values reject the checkpoint rather than being repaired. Maintenance writes `existing + newly folded` under the lease and never regresses a cursor; the per-skill invocation map is aggregate metadata (no body, path, argument, or per-invocation record) retained like `totalTokens`/`generations`, so it survives WAL detail expiry and deletion of `inventory.json`.

`sessions/<sessionId>/inventory.json` is an analyzer-owned, `schemaVersion: 1`, mode `0o600`, ≤64 KiB sanitized snapshot of the command/skill/resource-source inventory (names, labels, scope/origin, optional bounded descriptions — no paths, bodies, or invocation data). It is atomically renamed into place. Missing or unreadable → inventory `unavailable`, never an empty list. Refresh triggers are session start after tracking promotion, a `resources_discover` event with `reason === "reload"`, and any report load; each refresh re-reads the producer, hash-compares the bounded sanitized set against the persisted snapshot, and rewrites only on change — a changed hash triggers one atomic rewrite, an unchanged hash writes nothing. A report load keeps the in-memory observed snapshot (`presence`, the live-counter skill allowlist, and the current report's injection) in sync with the refreshed one; a missing or throwing producer read keeps the last readable snapshot and never fabricates an empty inventory. Dynamic runtime registrations are therefore picked up at the next report load or reload at the latest; Inspector never polls or watches the filesystem.

Tracking: create pending session metadata; append native `session-inspector:tracking-start`; atomically promote metadata. Earliest valid marker establishes boundary. Pending state recovers marker/manifest crash. Missing entire analyzer root needs explicit repair scan—not normal discovery.

Each process creates an immutable random writer ID, exclusively claims its active marker, then owns only matching WAL shard. Flush at 200 ms, 64 events, or 256 KiB; immediate on lifecycle boundary. Do not `fsync` each event. Queue cap is 1 MiB: shed coalescible data, record drop when possible, then disable writer. Process-crash durability is target; power-loss durability is not.

Checkpoint/reconcile/retention acquire one short per-session maintenance lease via atomic create/mkdir with PID/writer/timestamp. Stale recovery requires dead PID and age threshold. Holder rereads cursors, writes/validates temp in same directory, atomically renames, releases in `finally`. Contenders skip maintenance and replay. Bad/partial checkpoint replays valid durable input. Partial final WAL line is ignored and diagnosed. Unmatched starts stay `running` while active, become `interrupted` only at terminal reconciliation.

Detailed Inspector data has a **maximum 14-calendar-day window from record creation**, not 14 days after a session becomes inactive. Each writer owns a logical WAL shard and rotates immutable dated segments at least daily; an active writer rotates before its current segment can cross the cutoff. Under maintenance lease, a segment is deleted only after a validated checkpoint includes it and its newest record is older than the cutoff. Checkpoints retain aggregates and cursors, not detailed telemetry. Missing WAL is authorized only by versioned, validated contiguous-prefix seals; ordinary checkpoint cursors are not deletion evidence. Closed markers (or an owner PID proven dead by ESRCH) protect mutable append paths; only a legacy shard whose `.owner` record is genuinely missing, empty, or unparseable may be deleted on quiescence alone, and only when its mtime is strictly before the cutoff day and that exact size, mtime, device, and inode are re-verified immediately before unlink (the stat-then-unlink window is not atomic, so this catches a delayed append in the overwhelming majority of cases but not every write that lands inside it); a live owner, a non-ESRCH liveness-probe failure such as EPERM, and an owner record that exists but cannot be read are always refused. Incremental bounded-memory retention proceeds independently of full replay budgets; unversioned legacy seals degrade to unavailable rather than guessing. See ADR 0012 for the protocol, whole-segment budget exception, and conservative retention limitations. Regenerable report cache expires 14 days after generation (access does not extend it) and is capped at 100 MiB oldest-first. Explicit `--output` files are user-owned and never pruned. This bounds Inspector-held detailed metadata even for long-running sessions, at cost of cold reports showing aggregate/native data only. The same maintenance pass deletes `inventory.json` once older than the cutoff; inventory counts survive in `aggregates.resourceCounts` and per-skill invocation counts in `aggregates.skillInvocations`, so only detailed inventory rows expire, never the exact totals.

## 8. Privacy and security

Default local-only means no network calls, analytics, external assets, or native-content duplication. WAL permits IDs, times, statuses, bounded numeric/boolean metrics, bounded redacted string state, and redacted bounded metadata only. UI reads local source detail only on demand; exports omit bodies and redact commands/paths.

Redact secret-like keys, bearer/authorization values, JWT/token/private-key shapes, credential URLs, environment assignments, and `.env`/credential paths. Redaction is defense-in-depth, not a safe-sharing guarantee. Reports show warning. Create Inspector directories/files user-only when supported.

Threat boundary: Inspector cannot protect against same-user processes reading source sessions or user-selected exports. It must not create a broader sensitive-data copy.

## 9. UX and performance

Tabs: Overview, Models, Tools, Commands, Agents, Skills, Integrations, Errors, Ledger. Narrow terminals use selector. Ledger materializes on opening. English catalog ships; all labels are translation keys. Commands/Skills render sanitized inventory tables with explicit "inventory ≠ invocations" copy; Agents renders native `agentActivity` above the rich rows (never empty when native activity exists); Integrations renders presence + evidence state + version + allowlisted counters with distinct `not observed`/`unavailable`/`unsupported` labels plus the generic resource-source table (loaded/available only); Errors gains the bounded message column.

`help`/`--help`/`-h` opens a compact full-screen `ctx.ui.custom()` panel (esc/q closes, width-safe), listing modes, targets, options, defaults, and a few valid examples only. `getArgumentCompletions` is token-aware and returns `null` when nothing valid matches. `ui --theme dark|light` sets the initial HTML theme class; the in-page toggle keeps working from that state, and `--theme` on `tui`/`json` is rejected with usage. Parsing, completions, and help are deterministic and table-driven.

HTML inlines escaped report JSON, CSS and vanilla JS. v1 charts: daily sessions/cost/tokens and model/tool bars. Browser opening failure returns path, not command failure.

Initial target SLOs (not v1 release blockers until measured): observer scheduling p95 <1 ms/p99 <5 ms; no high-frequency synchronous disk; <=10 MiB incremental memory for 10k records; current TUI warm paint <150 ms; 10k delta reconcile <250 ms; cold 100-MiB replay <2 s; global fold 1,000 checkpoints <2 s; HTML <3 s/<5 MiB; startup p95 <25 ms warm/<75 ms cold.

Benchmark corpus is fixed seed/versioned. Early CI smoke fails only timeout, correctness failure, or gross 5x regression. Release jobs run 10 warm/3 cold samples on pinned Node/image and publish machine/image/variance artifacts. After two accepted release artifacts establish variance, maintainers may promote stable targets to hard SLOs; then an absolute-SLO breach or >20% median/p95 regression blocks release unless a reviewed baseline exception and changelog note exist. Safety, privacy, source-precedence, and recovery tests remain hard blockers from the first release.

## 10. Integration policy

| Integration | v1 handling | Non-claim |
| --- | --- | --- |
| Pi core | mandatory replay + live observer | exact provider retry spans |
| pi-subagents | automatic discovery from persisted tool results: native tool activity plus rich runs from `details.completions[]`/`details.results[]`, with archive references followed only from `details.completions[]` after strict validation | timestamp-guessed parentage; no manual `--subagents-artifact` input; child Pi session files not replayed |
| Permission System | public bus counters (`permissions:ready\|ui_prompt\|decision`) folded into durable aggregates | internal parser import; no producer payload fields |
| RTK | persisted `rtkCompaction` details | rewrite decision/savings not persisted |
| Context Mode | `ctx_*` use | exact Context Mode savings |
| Ponytail | schema-less `ponytail-mode` custom entries | exact active duration after crash |
| Caveman | schema-less `caveman-level` custom entries | exact active duration after crash |
| Generic resources | sanitized `(sourceLabel, scope, origin)` inventory from `getCommands()` + `getAllTools()` | loaded/available resources, never activity or installation status |
| Lens | generic native tool use | rich Lens dashboard in v1 |
| Hermes | unsupported | adapter implementation |

## 11. Failure behavior, migrations, and risks

Unknown Pi entries/fields, telemetry schema, integration version, artifact absence, corrupted WAL tail, stale checkpoint, source rewrite, missing browser, and storage errors must degrade to diagnostics/confidence—not crashes or Pi behavior changes.

Persisted schema starts at v1. Additive reads ignore unknown fields. Breaking schema changes require explicit migration/reader, fixture proof, and ADR. Pre-1.0 minor may change persisted/public formats only with migration note.

### 0.6.1 → 0.7.0 migration

- Command syntax changed: positional `ui|tui|json` modes replace `--format` and the `current|history|global|ledger` first tokens. The removed syntax now returns usage help.
- Report key change: the single `mode` integration is split into `ponytail` and `caveman`. The projection still accepts legacy `mode` v1 evidence for compatibility, but no adapter emits it.
- `--subagents-artifact` and its `{version:1, runs:[…]}` reader are removed; subagent runs are auto-discovered from persisted tool results.
- `ui` now emits one complete document covering Current, History, and Global.
- Checkpoint `aggregates` gains the additive fields listed in §7; absent fields mean "not folded yet".

### Downgrade-write semantics (`schemaVersion` stays `1`)

A 0.7.0 checkpoint may carry `integrationCounters`, `skillInvocations`, `skillOverflowInvocations`, `presence`, and `resourceCounts`. A 0.6.x process ignores those unknown aggregate fields and its next maintenance write recomputes aggregates from the Pi source alone, dropping the folded live counters, skill invocation counts, and resource counts. This causes no corruption, no crash, and never touches Pi data. On a later 0.7.0 run, counters are refolded for sessions whose WAL detail is still present; counters and skill counts for already sealed-and-pruned sessions become permanently `unavailable`, never `0`, while inventory rows are re-derived from the on-disk snapshot and counts from WAL when available. `schemaVersion` deliberately stays `1`: the fields are additive and carry cooperative live evidence only, whereas a version bump would make 0.6.x treat the whole checkpoint as unreadable and lose sealed-cursor knowledge, which is the more dangerous failure. 0.7.0 never writes state it cannot itself re-read and never relies on the new fields to authorize a seal or deletion.

Release blockers: empirical validation of provider timing confidence, maintenance/retention crash races, and usage non-double-counting. Other risks: Pi API drift, subagent artifact drift, writer clock skew, metadata privacy leakage, scale beyond corpus, and npm/release ownership. See [research](../research/pi-ecosystem.md) and [implementation plan](../plans/pi-session-inspector-v1-implementation.md).
