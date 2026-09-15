# Pi Session Inspector v1 specification

**Status:** approved design baseline. **Implemented as of `0.8.0`; the Evidence Foundation (canonical session model, L0/L1/L2 pipeline), the pre-M8 evidence-coverage milestone, and the `0.9.0` report-semantics/diagnostics/navigation milestone have landed.**

## 1. Product contract

Pi Session Inspector is a deterministic, local-only Pi extension that reconstructs session analytics from Pi-native persisted data, with narrowly scoped live/cooperative telemetry for facts Pi cannot reconstruct. It never calls an LLM for analysis and never changes, blocks, delays, or supplies Pi agent execution.

### Scope

| Version | Included |
| --- | --- |
| v1 | latest stable Pi only; current/history/global reports; active/tree selection; full-screen TUI; localhost interactive UI; immutable self-contained HTML snapshots; deterministic JSON; Pi replay; metadata WAL/checkpoint/recovery; 14-day hot retention; integrations in §10 |
| v1.x | German/Russian catalogs, richer charts, Lens-specific view, RTK rewrite telemetry if upstream supports it, repair command, Markdown export, comparison, configurable retention/redaction |
| Later | Hermes adapter, external SDK, database justified by benchmark, performance regression detector, semantic skill effectiveness, external export |

### Explicit exclusions

No cloud service, persistent backend, daemon, or always-running service,
SQLite, mandatory Bun, provider wire tracing, prompt/output/raw-argument
storage, generic extension scraping, output scraping, or Hermes implementation.
The `ui` command may start one lazy, process-local, loopback-only HTTP server;
it is not a service or persistent backend.

## 2. Requirements

| ID | Requirement |
| --- | --- |
| PRD-01 | Analytics are deterministic: same normalized inputs produce byte-identical JSON. |
| PRD-02 | Pi JSONL remains source of truth. Inspector never rewrites/appends Pi sessions except one namespaced `appendEntry` tracking marker. |
| PRD-03 | Telemetry failure is isolated: hooks return no mutation and bounded storage failures disable Inspector writer, never Pi. |
| PRD-04 | Current view defaults to active branch; history/global resource views default to full tree. Scope and renderer are independent. |
| PRD-05 | UI distinguishes `0` from unavailable, unsupported, inferred, or partial observation. |
| PRD-06 | Reports include models/usage/cost, generations, tools, errors, command families, compactions, agents, skills, integrations, and chronological ledger only where evidence permits. |
| PRD-07 | JSON is deterministic; `snapshot` HTML is immutable, self-contained/offline, contains no executable JavaScript, and uses no CDN/network; `ui` is a local HTTP application; TUI uses full-screen `ctx.ui.custom()`. |
| PRD-08 | Local persistence excludes prompt/output/result/raw arguments and applies allowlist/redaction before any Inspector write. |
| PRD-09 | Per-process writers are append-only shards; maintenance is crash-recoverable and cannot regress source cursors. |
| PRD-10 | History discovery is bounded to Inspector manifests, not a full Pi-session rescan. |
| PRD-11 | v1 supports Pi `0.85.1` API/format baseline and latest stable Pi at implementation release; older versions are unsupported. |
| PRD-12 | Public telemetry is process-local, best-effort, at-most-once as observed; it is safe with no consumer. |

## 3. Commands and scope

The renderer is positional. `ui` is the localhost interactive application;
`snapshot` is the only static HTML artifact command. The previous `--format`
flag and the `current|history|global|ledger` first-token targets are removed.

```text
/session-inspector [ui|snapshot|tui|json] [target] [options]
/session-ins ...                                  # identical alias

modes
  ui       localhost interactive browser application
  snapshot immutable self-contained HTML artifact
  tui      interactive Pi full-screen TUI
  json     deterministic JSON export

targets
  ui       — no target; the application carries its own navigation
  snapshot current | history | global | session <sessionId>
  tui      current | ledger           (default current)
  json     current | history | global (default current)

snapshot options
  current  --scope active|tree; range options allowed
  history  full-tree; range options allowed
  global   full-tree; range options allowed
  session  atomic; scope and range options rejected

shared snapshot options
  --preset 7|14|30
  --from YYYY-MM-DD --to YYYY-MM-DD
  --theme dark|light
  --output PATH
  --no-open

ui options
  --scope active|tree    default active; selects initial current view
  --theme dark|light
  --no-open

json options
  --scope active|tree    current only; history/global stay full tree
  --output PATH

help | --help | -h        usage panel (esc/q closes)
```

- No arguments behaves as the common case: `/session-inspector` → `tui current`.
- `ui` starts or reuses one lazy loopback server and opens its tokenized URL.
  It never accepts `--output`, range options, or a static-export alias.
- `snapshot` requires one target and renders one resolved L2 projection. It
  does not start the localhost server. With no `--output`, it writes to the
  generated report cache under Pi's `session-inspector/v1/reports/` directory;
  explicit output files are user-owned and are not pruned by cache cleanup.
  `--no-open` suppresses only the platform browser opener: it does not suppress
  generation, server startup for `ui`, or the user-visible output path/URL.
- `snapshot current` accepts scope and range. `snapshot history` and
  `snapshot global` are full-tree and accept range only. `snapshot session
  <sessionId>` accepts neither scope nor range because the session report is
  atomic.
- Range presets resolve against each projection's latest observed date. Custom
  ranges use inclusive real calendar dates. Invalid, mixed, duplicate, or
  unsupported range input is rejected; no range is silently clamped or
  substituted.
- `getArgumentCompletions(prefix)` is implemented on both registrations and is
  token-aware: first token → modes plus `help`; after a mode → that mode's
  targets; after `-`/`--` → options valid for that mode; after a value option
  → its values; `null` when nothing matches.
- `--format`, `current|history|global|ledger` as a first token, unknown
  modes/targets/options, missing or empty values, `ui --output`, snapshot scope
  or range options in `snapshot session`, scope in `snapshot history|global`,
  invalid range forms, `--theme` with `tui`/`json`, `--output` with `ui`/`tui`,
  and `--no-open` with `json` return one-line usage plus `Run
  /session-inspector help`, never generic failure text.
- Runtime unavailability (current session unavailable / history TUI unavailable)
  keeps its own distinct message so bad syntax and no data are never conflated.
- For `tui`/`json current` and `snapshot current`, `--scope` selects the
  replayed/projected entry set. Ephemeral (`--no-session`) runs may show
  current in-memory state but are explicitly non-durable and unavailable to
  history/global.

### Localhost UI and immutable snapshots

The localhost application serves known immutable assets and obtains an
`InspectorUiSnapshot` through protected API requests. The browser owns route,
range intent, navigation, loading/error state, and presentation only. It does
not resolve report ranges, filter report rows, aggregate usage, or interpret
evidence.

The initial protected API surface is:

```text
GET /api/v1/ui
GET /api/v1/reports/sessions/{sessionId}
GET /api/v1/reports/global
```

`GET /api/v1/ui` calls `loadInspectorBundle()` once per response and then runs
TypeScript L2 projection. Its range metadata is per projection/view: the
shared intent is retained, while `current.active`, `current.tree`, History,
and Global may carry different resolved anchors. Independent session/global
resource calls are independent observations and do not promise cross-request
snapshot consistency. The atomic session resource rejects `scope` and range
input; range input returns `400 range-not-supported`.

An immutable snapshot is one resolved projection only. It contains no router,
API client, authentication/bootstrap runtime, refresh path, range projection,
or executable JavaScript. It uses native HTML/CSS and is self-contained for
`file://`; custom ranges are resolved before rendering by TypeScript L2.
Snapshot HTML context-escapes every dynamic value. Report/session/model/tool/
diagnostic values are data, never trusted markup.

The interactive surface has three known assets under `src/ui/web/`:
`shell.html`, `style.css`, and generated `client.js`. `client.js` is a
build-time deterministic classic bundle from the readable route, range, and
client sources under `scripts/web/`; the server serves the generated asset
without runtime module loading. The static snapshot does not include the
interactive client. Browsers may probe exact `/favicon.ico`; `GET` and `HEAD`
return an empty `204` response without report data or a diagnostic, and this
compatibility route is not an additional browser asset.

### Pre-M8.4 HTTP and security contract

The server uses Node `node:http` and `node:crypto`, binds only to
`127.0.0.1:0`, and is one lazy singleton per Pi process. Shell/assets accept
`GET` and `HEAD`; the exact `/favicon.ico` compatibility route returns empty
`204` for `GET` and `HEAD`; `/api/v1/*` accepts `GET` only. Unsupported methods
return a bounded structured error.

The server generates a process/server-instance capability token from 32 bytes
of `node:crypto.randomBytes`, encoded base64url. It is not derived from any
session, report, process, path, or timestamp data and remains in memory only.
The bootstrap fragment is consumed before route parsing, replaced with the
canonical default route using `history.replaceState()` without adding history,
and can never return through Back/Forward. Reloading the sanitized canonical URL
loses authentication and requires a fresh bootstrap URL.

Every report-bearing request uses `Authorization: Bearer <token>`. Exact Host,
loopback peer, and exact Origin checks apply; CORS, redirects, forwarded-header
trust, private-network exceptions, and arbitrary filesystem paths do not.
Missing Origin is allowed for documented shell/static-asset navigations after
Host/peer validation; non-browser/internal protected API calls may omit it only
after Host/peer and bearer-auth validation. WSL2-to-Windows-browser localhost
forwarding remains an explicit UAT case; a non-loopback peer is test evidence
for a deliberate future security decision, not a reason to weaken this contract
preemptively.

API errors use bounded RFC 9457-style `application/problem+json` with fixed safe
codes/messages, status, retryability, and an opaque correlation ID. Startup,
asset, API, refresh, and export failures emit one-line bounded JSON stderr
records. Logging is best-effort and never changes Pi execution.

Server CSP is same-origin and permits only the normal client assets and API.
Snapshot CSP is separate and deterministic: snapshot HTML has no executable
JavaScript, no network permission, and only the exact inlined stylesheet may be
allowed by hash. Both modes use no-referrer and no-store/no-cache protections.

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

### Evidence foundation: L0, L1, L2

Report data flows through exactly three layers (ADR 0016):

- **L0 safe evidence.** Source adapters are the only code that reads Inspector-owned raw sources (Inspector WAL, checkpoint, inventory snapshot, pi-subagents results/archives, producer telemetry, current environment). The Pi session file is read only to hand its bytes to the L0 parser — by the Pi adapter, its composition-root/maintenance callers, and the L2 loaders — while Inspector-owned sources (WAL, checkpoint, inventory, archives) remain off-limits to L2 except the ruled manifest-discovery import in `src/ui/load-history.ts`. An adapter validates structure, bounds, redaction, enums, timestamps, and provenance, drops prohibited fields, and emits exactly two disjoint classes: `AtomicEvidence` (one validated observation per fact) and `FoldedAggregateEvidence` (already-folded checkpoint counters plus their exact cursor/seal boundary). L0 never merges, selects scope, combines atomic and folded values, computes totals, or infers relationships.
- **L1 canonical session.** `buildCanonicalSession` is the single semantic boundary. It validates identity/marker, owns the full entry graph, reconciles exact call/result and live-timing identities, reconciles repeated cooperative child observations, exposes retained explicit skill-invocation detail, reconciles retained atomic telemetry against the checkpoint boundary, builds native/child usage ledgers, classifies timestamps, and emits evidence health. L1 is rebuilt in memory and never written as a file.
- **L2 report/navigation projections.** L2 consumes the L1 model and emits the bounded DTOs consumed by TUI/JSON, the localhost UI API, and the immutable HTML snapshot renderer. L2 projects scope and date ranges and maps provenance to confidence/health. L2 never reads WAL, checkpoint, inventory, or producer archives directly, and never folds counters, subtracts cursor overlap, recomputes joins, or re-derives scope. Only the L0 source coordinator in the composition root may read storage for semantic evidence; history/global receive it through an injected `SessionEvidenceProvider`, where a throw or absent result degrades exactly that session to `unavailable` (never a fabricated zero). Maintenance/retention may read storage for storage ownership only. Browser assets and snapshot HTML never become a second L2 owner.

### Canonical session additions

Three additive `CanonicalSession` fields carry decisions L2 must not recompute:

- `scopedEntryIds: string[]` — the builder's scope decision in resolution order (active ancestry after the marker, or every post-marker entry for tree scope). L2 maps these ids back to parsed entries (dropping ids with no parsed entry); loaders never re-derive scope. The full entry graph is deliberately not the scoped set.
- `effectiveCounters` — the effective producer counters (integration counts, named/overflow skill counts, permission presence) computed once from the folded prefix plus the retained atomic suffix, unioned once. Its explicit state is `retained` (total is exactly the retained atomic records), `aggregate-only` (a folded or pruned contribution is included), or `unavailable` (no checkpoint boundary exists, so pruning cannot be ruled out). Values publish only for the first two states; `unavailable` publishes no values, never zeros. L2 never adds facts on top of a published total.
- `retainedSkillInvocations` — when effective counters are unavailable, L1's bounded count of explicitly retained skill facts (named rows plus exact overflow) remains available as a separate detail projection. L2 copies it; it never recounts `skillInvocations`.

### Scope semantics

- **Active:** ancestor path to active leaf, intersected with append-order entries after earliest valid tracking marker.
- **Tree:** all append-order entries after earliest valid tracking marker.
- A branch is a position (leaf/path), not an invented persistent Pi branch ID.
- Fork/clone are separate session files and are never silently merged.

### Report DTO additions

All additions are additive and keep JSON byte-identical for a given input.

```ts
type IntegrationPresence = "present" | "absent" | "unknown";
type EvidenceState = "supported" | "unavailable" | "unsupported";
type CanonicalRetainedAggregates = import("../../src/core/retained-aggregates.ts").CanonicalRetainedAggregates;

type SessionReport = {
  // existing fields unchanged
  tools: (Tool & { source?: string })[];             // inventory source label; absent when the name is unknown
  commands: { state: EvidenceState; items: readonly CommandRow[]; count: number | null };
  skills: {
    state: EvidenceState;                            // inventory availability only
    items: readonly SkillRow[];                      // inventory names ∪ retained invocation names
    count: number | null;                            // INVENTORY skill rows only, counted before any retained invocation name is appended, so activity never inflates availability; `null` means no snapshot
    invocationState: EvidenceState;                  // projected from L1 `effectiveCounters`/retained skill facts, never re-folded in L2; state vocabulary (`supported`/`unavailable`) unchanged
    invocationCount: number | null;                  // exact: sum(counts) + otherInvocations
    otherInvocations: number | null;                 // exact overflow beyond the 64-name cap
  };
  resources: { state: EvidenceState; items: readonly ResourceSourceRow[] };
  agentActivity: AgentToolActivity;                  // native subagent tool activity, breakdown only
  agents: AgentRun[];                                // rich layer; optional bounded agent/artifacts
  agentEvidence: EvidenceState;
  integrations: IntegrationObservation[];            // one row per known key, ordered
  errors: (ErrorRecord & { message?: string })[];    // bounded, redacted message only
  evidenceHealth: SessionEvidenceHealth;             // always present; canonical bounded health
  retainedAggregates?: CanonicalRetainedAggregates;  // present only with a checkpoint boundary
};
```

This is the `0.8.0` delta against `0.7.0`, derived from the shipped `SessionReport` type: two new top-level fields, plus `agents[]` additions. `skills.invocationState`/`invocationCount`/`otherInvocations` and `SkillRow.explicitInvocations` keep their existing shape but are now fed from the L1 `effectiveCounters`/retained skill evidence rather than an L2 fold.

- `evidenceHealth` is always present and is the canonical bounded health DTO (below); when no health is supplied the report carries an `unavailable` shape so every renderer sees the same DTO, and `unavailable` never degrades to a fabricated zero.
- `retainedAggregates` is present only when a checkpoint boundary exists. It carries `boundary.detail` (`full` | `aggregate-only` | `expired`), the exact `foldedThrough`/`sealedThrough` cursor maps, `checkpointedAt` (materialization time only), the optional exact `detailExpiredBefore`, and only those aggregate values that survive pruning (`integration`, `skillInvocations`, `permissionPresence`, `resources`). Aggregate values never appear as atomic rows and never gain an event time.
- `Tool.source` is the sanitized source label of that tool name in the current inventory; it is absent when the name is not in the inventory and never inferred from the tool-name prefix.
- `SkillRow` keeps `name`, optional `sourceLabel`/`scope`/`origin`/`description`, and optional exact `explicitInvocations`; a name with no retained invocation evidence omits the field. Absent means unavailable, never `0`.
- `AgentRun` keeps `id`, optional `parentId`, optional bounded `agent` label, `status`, optional `usage`, and optional `artifacts: "available" | "missing"`. `artifacts` is present only when a validated published reference exists for a completed run. The `0.8.0` additions are `observedAt` (publication time of the persisted result that observed the run — never a run start/end/duration), `evidenceToolId` (canonical `tool:<toolCallId>` of the publishing result), bounded `model` and `thinking` labels, and a bounded `failure` (`reason: "exit-nonzero" | "process-signal" | "completion-failed" | "output-absent"`, with an `exit-nonzero` integer exit code or a `process-signal` bounded signal token only). Every added field is absent when the producer published no valid value.

### Evidence health DTO

`evidenceHealth` is the bounded projection of L1 health. It contains no path, raw ID, error text, tool input/output, model payload, or producer string. `EvidenceHealthState` is `"supported" | "partial" | "unavailable" | "unsupported" | "expired"`; `SourceEvidenceHealth`, `EvidenceDiagnosticCode`, and `EvidenceSource` are the bounded record/enum types in `src/core/evidence-health.ts` and `src/core/evidence.ts` (design §12).

```ts
type SessionEvidenceHealth = {
  schemaVersion: 1;
  core: EvidenceHealthState;      // Pi+marker reportability only
  sources: SourceEvidenceHealth[]; // fixed enum order
  joins: {
    toolCalls: number; toolResults: number; matchedToolResults: number;
    matchedLiveToolTimings: number; agentRuns: number; knownAgentParents: number;
  };
  usage: { nativeLines: number; childLines: number; compositionReconciled: boolean; dated: EvidenceHealthState };
  aggregates: {
    detail: "full" | "aggregate-only" | "expired";
    integrationCounters: number;
    skillInvocations: { names: number; overflow: number; retainedInvocations: number };
    permissionPresence: EvidenceHealthState;
    resources: EvidenceHealthState;
  };
  diagnostics: { code: EvidenceDiagnosticCode; severity: "info" | "warning" | "error"; count: number; source: EvidenceSource }[];
  truncated?: boolean;
};
```

Counts saturate at the project safe-integer bound and saturation sets `truncated`; sources sort by fixed enum order and diagnostics by source then code; `core` describes Pi/marker reportability only, so an unavailable optional integration never makes native facts partial. `aggregates.detail` is `full` only when retained atomic telemetry covers every recorded stream end, `aggregate-only` when counters survive with an exact fold/seal boundary but their events do not, and `expired` when even the fold is incomplete or absent so no aggregate value may be published. `unavailable`, `unsupported`, `partial`, and `expired` never serialize as zero evidence. L2 may down-project health, but every renderer receives the same result.

- `IntegrationObservation` carries `integration`, `presence`, `state`, optional `version`, and optional allowlisted `counters`; presence never implies activity and state never implies installation.
- `ErrorRecord.message` is derived from Pi-persisted assistant `errorMessage` or text from an errored tool result, bounded to one single-line value (≤200 bytes) with secret/path/URL redaction; tool arguments, non-text blocks, and raw tool-result content are never retained.
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

- **Permission System bus.** `permissions:ready`, `permissions:ui_prompt`, and `permissions:decision` on Pi's public event bus. They are translated to a fixed bounded counter set; `origin`, `value`, `matchedPattern`, `agentName`, `forwarding`, and raw `request` are never read outside the permission adapter. The one permitted exception is the hashed `attribution.request` form `permission-request-<canonicalOpaqueDigest("permission-request", sessionId, rawRequestId)>` (ADR 0016 partial supersession of ADR 0014): it is additive envelope metadata only, never folded, never a join key, and never paired with a decision or any other outcome; the raw request ID and its preimage never leave the adapter call frame, and a missing/empty/oversized/malformed ID yields no attribution. `ready` is presence only.
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

Allowlisted `kind: "counter"` envelopes from the foreign surfaces above are folded, cursor-based, into checkpoint aggregates (`integrationCounters`, `skillInvocations`, `skillOverflowInvocations`, `presence`) and read back as `effective = merge(checkpointAggregates, deltaCounters)` (ADR 0014). Only records strictly after each writer's checkpoint cursor are folded, so repeated reads, repeated maintenance passes, and `/resume` writer shards never double-count; the extension flushes its live writer before a report fold so observed events are already durable. An explicit `/skill:<name>` observation is first-class evidence while its WAL record is retained (`CanonicalSkillInvocation` in L1); after detail expiry only the named and overflow counts survive as aggregate-only checkpoint values, and a count never creates a synthetic invocation row. L1 computes the effective producer counters once (`CanonicalSession.effectiveCounters`, states `retained`/`aggregate-only`/`unavailable`) and L2 projects them without re-folding. `event`/`gauge` envelopes remain write-only. The surfaces are process-local, have no backfill, and their detail expires with the 14-day cutoff while the folded aggregates survive.

## 7. Storage, recovery, and retention

Root uses Pi agent-dir API when available:

```text
~/.pi/agent/session-inspector/v1/
  sessions/<full-session-id>/{meta.json,checkpoint.json,inventory.json,maintenance.lease,writers/,wal/}
  reports/{<session-id>.html,global.html}
```

### Checkpoint aggregates and inventory artifact

Checkpoint `aggregates` carries strictly validated, additive fields (`schemaVersion` stays `1`; absence means "not folded yet"): `integrationCounters` (allowlisted safe integers, ≤16 keys per integration), `skillInvocations` (`Record<sanitizedSkillName, number>`, ≤64 names matching the skill-name grammar), `skillOverflowInvocations` (exact invocation count for names beyond the cap, counted per invocation), `presence` (`{ permission?: boolean }` only), and `resourceCounts`. `resourceCounts` is extended in place: `commands`/`skills` stay required when present, and `resources`, `toolSources`, `observedAt` are additive optional keys — there is no second resource-count location. `resourceCounts.observedAt` is the observation time of the inventory snapshot that produced the counts, never the checkpoint write time. Invalid values reject the checkpoint rather than being repaired. Maintenance writes `existing + newly folded` under the lease and never regresses a cursor; the per-skill invocation map is aggregate metadata (no body, path, argument, or per-invocation record) retained like `totalTokens`/`generations`, so it survives WAL detail expiry and deletion of `inventory.json`.

Exactly one additive `evidence` object is the checkpoint's only metadata sibling (no second metadata object exists):

```ts
type CheckpointEvidence = {
  checkpointedAt?: string;            // materialization time only
  detailCoverage?: {
    walDetailExpiredBefore?: string;  // exact instant of the newest pruned WAL record
    inventoryDetailExpiredAt?: string; // pruned snapshot's `observedAt`
  };
  usageCoverage?: { generations: UsageCoverageState; toolResults: UsageCoverageState; compactions: UsageCoverageState; branchSummaries: UsageCoverageState };
};
```

`UsageCoverageState` is `"complete" | "partial" | "unavailable"` (`src/storage/checkpoint.ts`). `usageCoverage` is schema-reserved but currently unwritten: the maintenance pass deliberately declines to fabricate it, so it is validated on read and absent in practice until a writer populates it.

`detailCoverage.walDetailExpiredBefore` is the exact timestamp of the newest WAL record in the pruned (sealed and deleted) prefix — the exact instant before which no detail exists. It is written only in the same write that publishes a new seal, only when a prune actually removed detail, and is monotonic across passes (the maximum of the stored and newly pruned value); it is never the cutoff day, a file mtime, or the process clock. `detailCoverage.inventoryDetailExpiredAt` is the pruned snapshot's `observedAt` (the observation instant whose rows were removed) and is written only on an actual inventory unlink, monotonically. `checkpointedAt` describes materialization only and no aggregate may claim an event time it does not have. Because these fields are written only by the prune path, a checkpoint sealed by an older version can never gain `walDetailExpiredBefore`; a newer reader degrades that case to the absent-boundary behaviour rather than inventing one.

`sessions/<sessionId>/inventory.json` is an analyzer-owned, `schemaVersion: 1`, mode `0o600`, ≤64 KiB sanitized snapshot of the command/skill/resource-source inventory (names, labels, scope/origin, optional bounded descriptions — no paths, bodies, or invocation data). It is atomically renamed into place. Missing or unreadable → inventory `unavailable`, never an empty list. Refresh triggers are session start after tracking promotion, a `resources_discover` event with `reason === "reload"`, and any current-session report load (`ui`, `tui current`/`ledger`, `json current`); history/global exports do not re-read the producer. Each refresh re-reads the producer, hash-compares the bounded sanitized set against the persisted snapshot, and rewrites only on change — a changed hash triggers one atomic rewrite, while an unchanged hash may reuse the payload but never freezes the timestamp. A current-session report load keeps the in-memory observed snapshot (`presence`, the live-counter skill allowlist, the observation instant, and the current report's injection) in sync with the refreshed one; a missing or throwing producer read keeps the last readable snapshot and never fabricates an empty inventory. Dynamic runtime registrations are therefore picked up at the next current-session report load or reload at the latest; Inspector never polls or watches the filesystem.

Inventory observation freshness is normative. `observedAt` is the time of the **latest successful observation**, not the time the content last changed: the snapshot file, the in-memory mirror handed to the builder, and `aggregates.resourceCounts.observedAt` all carry the same observation instant when one is known; a later successful observation with byte-equivalent content advances `observedAt`; a failed observation leaves the previous value untouched and never advances it; `mtime` is never evidence time, never a freshness input, and never a retention input once `observedAt` exists. Retention measures inventory expiry against `observedAt`. The `inventory-observation-time-missing` diagnostic therefore signals genuinely instant-less inventory evidence (a legacy or otherwise observation-time-free snapshot); it is not a statement about the shape of the in-memory mirror, so a readable snapshot with a known instant must not raise it while the same report publishes a known `resourceCounts.observedAt`.

Tracking: create pending session metadata; append native `session-inspector:tracking-start`; atomically promote metadata. Earliest valid marker establishes boundary. Pending state recovers marker/manifest crash. Missing entire analyzer root needs explicit repair scan—not normal discovery.

Each process creates an immutable random writer ID, exclusively claims its active marker, then owns only matching WAL shard. Flush at 200 ms, 64 events, or 256 KiB; immediate on lifecycle boundary. Do not `fsync` each event. Queue cap is 1 MiB: shed coalescible data, record drop when possible, then disable writer. Process-crash durability is target; power-loss durability is not.

Checkpoint/reconcile/retention acquire one short per-session maintenance lease via atomic create/mkdir with PID/writer/timestamp. Stale recovery requires dead PID and age threshold. Holder rereads cursors, writes/validates temp in same directory, atomically renames, releases in `finally`. Contenders skip maintenance and replay. Bad/partial checkpoint replays valid durable input. Partial final WAL line is ignored and diagnosed. Unmatched starts stay `running` while active, become `interrupted` only at terminal reconciliation. WAL recovery is the single validation path for retained live detail: `recoverSession` exposes the bounded, already-validated retained records it parsed in the `RecoveredWalRecord` shape L1 consumes (capped by the existing replay budget, carrying only a validated telemetry envelope or validated lifecycle payload with an optional bounded `subjectId`) and L1 consumes exactly that output. A record is never parsed twice, a raw producer ID is never carried, and a partial replay exposes no records (like its `deltaCounters`), so an incomplete suffix can never be folded downstream.

Detailed Inspector data has a **maximum 14-calendar-day window from record creation**, not 14 days after a session becomes inactive. Each writer owns a logical WAL shard and rotates immutable dated segments at least daily; an active writer rotates before its current segment can cross the cutoff. Under maintenance lease, a segment is deleted only after a validated checkpoint includes it and its newest record is older than the cutoff. Checkpoints retain aggregates and cursors, not detailed telemetry. Missing WAL is authorized only by versioned, validated contiguous-prefix seals; ordinary checkpoint cursors are not deletion evidence. Closed markers (or an owner PID proven dead by ESRCH) protect mutable append paths; only a legacy shard whose `.owner` record is genuinely missing, empty, or unparseable may be deleted on quiescence alone, and only when its mtime is strictly before the cutoff day and that exact size, mtime, device, and inode are re-verified immediately before unlink (the stat-then-unlink window is not atomic, so this catches a delayed append in the overwhelming majority of cases but not every write that lands inside it); a live owner, a non-ESRCH liveness-probe failure such as EPERM, and an owner record that exists but cannot be read are always refused. Incremental bounded-memory retention proceeds independently of full replay budgets; unversioned legacy seals degrade to unavailable rather than guessing. See ADR 0012 for the protocol, whole-segment budget exception, and conservative retention limitations. Regenerable report cache expires 14 days after generation (access does not extend it) and is capped at 100 MiB oldest-first. Explicit `--output` files are user-owned and never pruned. This bounds Inspector-held detailed metadata even for long-running sessions, at cost of cold reports showing aggregate/native data only. The same maintenance pass deletes `inventory.json` once its latest successful observation (`observedAt`) is strictly before the cutoff day, re-verifying size/mtime/device/inode immediately before unlink so a concurrent refresh aborts the deletion, and records the removed snapshot's `observedAt` in `evidence.detailCoverage.inventoryDetailExpiredAt`; inventory counts survive in `aggregates.resourceCounts` and per-skill invocation counts in `aggregates.skillInvocations`, so only detailed inventory rows expire, never the exact totals. Each WAL prune that actually removes detail records the newest pruned record's exact instant in `evidence.detailCoverage.walDetailExpiredBefore`, so the report can state the instant before which live detail no longer exists rather than only "expired".

## 8. Privacy and security

Default local-only means no external network calls, analytics, external assets,
or native-content duplication. The interactive UI uses only its loopback HTTP
server; snapshots use no network. WAL permits IDs, times, statuses, bounded
numeric/boolean metrics, bounded redacted string state, and redacted bounded
metadata only. UI reads local source detail only on demand; exports omit bodies
and redact commands/paths.

Redact secret-like keys, bearer/authorization values, JWT/token/private-key shapes, credential URLs, environment assignments, and `.env`/credential paths. Redaction is defense-in-depth, not a safe-sharing guarantee. Reports show warning. Create Inspector directories/files user-only when supported.

Threat boundary: Inspector cannot protect against same-user processes reading source sessions or user-selected exports. It must not create a broader sensitive-data copy.

## 9. UX and performance

Tabs: Overview, Models, Tools, Commands, Agents, Skills, Integrations, Errors, Ledger. Narrow terminals use selector. Ledger materializes on opening. English catalog ships; all labels are translation keys. Commands/Skills render sanitized inventory tables with explicit "inventory ≠ invocations" copy; Agents renders native `agentActivity` above the rich rows (never empty when native activity exists); Integrations renders presence + evidence state + version + allowlisted counters with distinct `not observed`/`unavailable`/`unsupported` labels plus the generic resource-source table (loaded/available only); Errors gains the bounded message column.

`help`/`--help`/`-h` opens a compact full-screen `ctx.ui.custom()` panel (esc/q closes, width-safe), listing modes, targets, options, defaults, and a few valid examples only. `getArgumentCompletions` is token-aware and returns `null` when nothing valid matches. `ui --theme dark|light` sets the initial browser theme class; the in-page toggle
keeps working from that state. `ui --output` and `--theme` on `tui`/`json` are
rejected with usage; `snapshot` accepts `--theme`. Parsing, completions, and
help are deterministic and table-driven.

The interactive `ui` serves three classic browser assets, including one
build-time-generated client bundle, and obtains bounded report DTOs from its
protected localhost API. Its charts and controls are
presentation only; TypeScript L2 owns all report arithmetic. `snapshot` renders
one already-resolved projection as self-contained HTML/CSS with no executable
JavaScript, embedded DTO for later interpretation, network access, or offline
range/navigation runtime. Browser opening failure returns the saved snapshot
path or server URL, not command failure.

Initial target SLOs (not v1 release blockers until measured): observer scheduling p95 <1 ms/p99 <5 ms; no high-frequency synchronous disk; <=10 MiB incremental memory for 10k records; current TUI warm paint <150 ms; 10k delta reconcile <250 ms; cold 100-MiB replay <2 s; global fold 1,000 checkpoints <2 s; HTML <3 s/<5 MiB; startup p95 <25 ms warm/<75 ms cold.

Benchmark corpus is fixed seed/versioned. Early CI smoke fails only timeout, correctness failure, or gross 5x regression. Release jobs run 10 warm/3 cold samples on pinned Node/image and publish machine/image/variance artifacts. After two accepted release artifacts establish variance, maintainers may promote stable targets to hard SLOs; then an absolute-SLO breach or >20% median/p95 regression blocks release unless a reviewed baseline exception and changelog note exist. Safety, privacy, source-precedence, and recovery tests remain hard blockers from the first release.

## 10. Integration policy

| Integration | v1 handling | Non-claim |
| --- | --- | --- |
| Pi core | mandatory replay + live observer | exact provider retry spans |
| pi-subagents | automatic discovery from persisted tool results: native tool activity plus rich runs from `details.completions[]`/`details.results[]`, with archive references followed only from `details.completions[]` after strict validation | timestamp-guessed parentage; no manual `--subagents-artifact` input; child Pi session files not replayed |
| Permission System | public bus counters (`permissions:ready\|ui_prompt\|decision`) folded into durable aggregates; additive hashed `attribution.request` metadata only | internal parser import; no raw producer payload fields; raw request ID never read |
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

### Pre-M8.4 transport and command migration

- `ui` changes from a self-contained interactive HTML document to the normal
  localhost application. It starts one lazy process-local server on
  `127.0.0.1:0`, and the browser receives protected API DTOs.
- `snapshot current|history|global|session <sessionId>` becomes the only static
  HTML artifact command. `snapshot` requires an explicit target and emits one
  already-resolved immutable projection that works without a server or network.
- `ui --output` is invalid. `--output` is valid only for `snapshot` and `json`.
  `--no-open` suppresses only the platform browser opener.
- The removed no-server wording applies to `ui`'s prior transport only; no
  daemon, always-running service, cross-process listener, or generic backend is
  introduced. JSON/TUI behavior and report DTO semantics remain unchanged.
- This is an intentional pre-1.0 breaking command change, released in
  `0.10.0`. See ADR 0018 and §3 for the complete server, token, API, range,
  snapshot, CSP, and error contracts.

### 0.6.1 → 0.7.0 migration

- Command syntax changed: positional `ui|tui|json` modes replace `--format` and the `current|history|global|ledger` first tokens. The removed syntax now returns usage help.
- Report key change: the single `mode` integration is split into `ponytail` and `caveman`. The projection still accepts legacy `mode` v1 evidence for compatibility, but no adapter emits it.
- `--subagents-artifact` and its `{version:1, runs:[…]}` reader are removed; subagent runs are auto-discovered from persisted tool results.
- `ui` now emits one complete document covering Current, History, and Global.
- Checkpoint `aggregates` gains the additive fields listed in §7; absent fields mean "not folded yet".

### 0.7.0 → 0.8.0 migration

- Reports are now produced by one canonical pipeline (L0 → L1 → L2). TUI, HTML, and JSON consume the same L1-derived DTO; loaders no longer re-derive scope or re-fold checkpoint counters.
- Report DTO: `SessionReport` gains `evidenceHealth` (always present) and optional `retainedAggregates`; `agents[]` rows gain optional `observedAt`, `evidenceToolId`, `model`, `thinking`, and `failure`; `skills` invocation fields are now fed from L1 effective counters (`retained`/`aggregate-only`/`unavailable`) instead of an L2 fold.
- Public subagent agent IDs keep the `subagent-<64hex>` shape but change value: the digest is now session-scoped (`canonicalOpaqueDigest("subagent-run", sessionId, rawRunId)`) instead of process-global. Generation/tool/compaction public ID values are byte-stable; stale references from before `0.8.0` do not resolve and are regenerated from the same report.
- Checkpoint `aggregates.resourceCounts` is extended in place with `resources`, `toolSources`, and `observedAt`, and exactly one additive `evidence` object is added (`checkpointedAt`, `detailCoverage`, plus the schema-reserved `usageCoverage`, which no writer currently populates). Inventory snapshots gain `observedAt` and report `inventory-observation-time-missing` only when no observation instant genuinely exists.
- Permission telemetry may now carry the hashed `attribution.request` form described in §6 and ADR 0016; the raw request ID remains prohibited. ADR 0016 supersedes ADR 0014's narrow "never read `request`" rule for exactly that hashed form.

### Downgrade-write semantics (`schemaVersion` stays `1`)

A 0.8.0 checkpoint may carry every additive field from `0.7.0` plus the extended `resourceCounts` keys and the `evidence` object. An older process ignores those unknown aggregate/evidence fields and its next maintenance write recomputes aggregates from the Pi source alone, dropping the folded live counters, skill invocation counts, resource counts, and the recorded expiration boundaries. This causes no corruption, no crash, and never touches Pi data. On a later 0.8.0 run, counters are refolded for sessions whose WAL detail is still present; counters and skill counts for already sealed-and-pruned sessions become permanently `unavailable`, never `0`, while inventory rows are re-derived from the on-disk snapshot and counts from WAL when available.

A checkpoint sealed by an older version can never gain `walDetailExpiredBefore`: the field is written only by the prune path, in the same write that publishes a new seal and only when a prune actually removed detail. Sessions sealed before `0.8.0` keep the older absent-boundary behaviour and report WAL detail as `expired` without claiming an exact instant, rather than a backfilled or guessed one. The same rule applies to `inventoryDetailExpiredAt`.

`schemaVersion` deliberately stays `1`: the fields are additive and carry cooperative live evidence only, whereas a version bump would make older readers treat the whole checkpoint as unreadable and lose sealed-cursor knowledge, which is the more dangerous failure. `0.8.0` never writes state it cannot itself re-read and never relies on the new fields to authorize a seal or deletion.

Release blockers: empirical validation of provider timing confidence, maintenance/retention crash races, and usage non-double-counting. Other risks: Pi API drift, subagent artifact drift, writer clock skew, metadata privacy leakage, scale beyond corpus, and npm/release ownership. See [research](../research/pi-ecosystem.md) and [implementation plan](../plans/pi-session-inspector-v1-implementation.md).

## 12. Validation invariants

The Evidence Foundation (ADR 0016) is accepted only if all of the following hold. They are the normative invariant list of the approved design (design §17) and are checked by the milestone test suite.

1. Unknown Pi format produces no semantic facts.
2. Every native semantic fact traces to one valid Pi header/entry.
3. Every live fact traces to one validated WAL record and writer sequence.
4. Every cooperative fact traces to one persisted publishing result or validated archive.
5. Earliest valid marker is the sole tracking boundary.
6. Missing marker never means "all entries."
7. Active/tree projections implement existing ancestry/tree semantics exactly.
8. Relationships use source IDs only; time/name proximity never links facts.
9. Tool status/error/usage use deterministic exact-call reconciliation.
10. Per-tool duration requires exact live subject correlation.
11. Child `observedAt` is publication time, never run start/end.
12. Child usage never contributes to session/native/model/history/global totals.
13. Every native usage owner contributes at most once.
14. When aggregate usage is `known`, four native usage composition buckets equal the native known total; overflow publishes no clamped aggregate.
15. Every dated usage line has exactly one normative UTC attribution date.
16. Missing/invalid time can make dated evidence partial without erasing known session usage.
17. Missing evidence never serializes as zero.
18. Expired detail never serializes as absent activity.
19. Checkpoints never become semantic authority.
20. Inventory mtime is never evidence time; `observedAt` advances on every successful observation, including byte-equivalent content, and a failed observation never advances it.
21. All numbers are finite, nonnegative, and bounded.
22. Every producer string is enum-validated, bounded/redacted, hashed, or dropped.
23. Privacy scanner finds no prohibited key/value in WAL, checkpoints, health JSON, or report JSON.
24. Current/history/global derive from the same canonical builder.
25. TUI/JSON, the localhost UI API, and immutable snapshot HTML consume the same L2 DTO.
26. Replaying unchanged sources yields byte-identical canonical JSON and reports.
27. Adapter/storage failures never alter Pi execution.
28. Inspector never mutates Pi JSONL except the tracking marker.
29. Explicit skill invocation is a first-class fact while retained; pruned or overflow counts never fabricate invocation rows.
30. Folded aggregate and retained atomic contributions are disjoint by cursor/seal boundary and are counted exactly once.
31. Aggregate-only values are labelled, bounded, and never rendered as atomic detail or given a synthetic timestamp.
32. No L2 loader or projection reads WAL, checkpoint, inventory, or producer archives directly; all semantic evidence reaches L2 through L1.
33. Opaque IDs are deterministic, session-scoped, domain-separated, and computed only through the canonical helper; raw IDs never persist beside them.
34. Parent-session resolution enforces approved-root containment, regular-file and symlink checks, bounded header read, and v3 header validation; every failure is `unavailable` with no path leakage.
35. Skill inventory and skill invocation remain separate evidence classes and are never summed together.
36. `GET /api/v1/ui` invokes `loadInspectorBundle()` once per response; independent resource requests make no cross-request consistency claim.
37. Valid range intent is resolved by TypeScript L2 per projection; invalid, mixed, duplicate, oversized, inverted, or half ranges never fall back or clamp, and unavailable evidence never becomes zero.
38. The bootstrap token is 32 random bytes encoded base64url, consumed before route parsing, replaced with the canonical route without a history entry, retained in memory only, and never restored by Back/Forward.
39. Unauthenticated shell/assets contain no Inspector-derived data; immutable snapshots contain no executable JavaScript or network capability and escape every dynamic value in its output context.
40. The server accepts only its documented methods/routes, exact loopback Host/peer/Origin, and bearer authentication for report data; CSP/no-store/no-referrer and bounded redacted diagnostics are enforced.

## 13. Report semantics

This section states the `0.9.0` report-semantics contracts in [ADR 0017](../architecture/adr/0017-report-coverage-attribution-and-navigation.md).
Every report/evidence addition here is additive: no persisted field, no
collector, no WAL/checkpoint/retention change, no `schemaVersion` bump, and no
Pi mutation beyond the existing tracking marker. Pre-M8.4 intentionally changes
the public command/transport surface as documented in §3 and the migration
note above. The fields live on report DTOs (`json` writes them verbatim), the
localhost UI payload, and the resolved immutable snapshot; they remain read-time
derivations of already-persisted evidence.

### 13.1 Coverage contract and wording rules

`HistoryReport` and `GlobalReport` gain an optional `coverage` and unavailable
session rows gain an optional bounded `reason`:

```ts
type CoverageReason =
  | "no-manifest"          // neither metadata nor a pending manifest was readable
  | "manifest-unavailable" // source missing/unresolvable/rejected, lease unavailable, promotion threw
  | "marker-unavailable"   // source readable, tracking-marker evidence failed
  | "session-unreadable"   // parse failure, malformed JSON, no header, id mismatch
  | "replay-failed";       // evidence provider, canonical builder or report projection failed

type SessionCoverage = {
  inspected: number;       // the capped discovery set; available + unavailable === inspected
  available: number;
  unavailable: number;
  sessionRatio: number | null; // available / inspected (4 decimals); null when inspected === 0 or discoveryLimited
  complete: boolean;           // inspected > 0 && available === inspected && !discoveryLimited (an unavailable aggregate publishes no coverage at all)
  discoveryLimited: boolean;   // discovery stopped at MAX_HISTORY_SESSIONS (206): more sessions exist, uninspected
  reasons: Readonly<Partial<Record<CoverageReason, number>>>; // counts; zero-occurrence keys omitted
};
```

- `CoverageReason` is a **runnability** vocabulary: every member is the projection
  of an `EvidenceDiagnosticCode` or `HistoryDiagnostic` that already exists, so a
  new reason cannot be invented and no filesystem error string, path, or producer
  text can enter it.
- A capped discovery has an unknown workspace denominator, so `sessionRatio` is
  `null` and **no percentage or `N / N` fraction may be rendered** — not even for
  an all-available capped set. Counts plus `additional sessions not inspected` is
  the honest form.
- An **empty** inspection set is not complete; its usage reads `Unavailable`,
  never `$0.00`, and its session line reads `No tracked sessions`.
- When the report itself is `availability: "unavailable"`, `coverage` is
  **omitted** — unavailable, not zero.
- Unavailable sessions contribute nothing to any usage, date, chart, or count
  other than the coverage line, and are never rendered as a zero-cost row.
- Wording is part of the contract. Partial aggregates are labelled
  `Known native cost` / `Known tokens` (and `Known native cost — completeness
  unknown` when no coverage exists at all); no partial figure is **headlined**
  `Total`, and the `usage.total` label survives on the detail rows it names (the
  metric breakdown and the composition total), kept for compatibility. Unavailable
  values read `Unavailable`, never `0`, `$0.00`, or a guessed reason. `Known` is
  the only qualifier for partial figures: never "approximate", "estimated", or an
  extrapolation.
- Coverage belongs to the **aggregate** sections (history aggregate, global). A
  selected history session's own detail shows no coverage **panel** and no
  coverage-driven qualifier — that session replayed, so its own figures are
  complete for that session's replay. Two range-scoped cases still render `Known`
  inside a session detail, and both qualify the selected **range**, not the
  replay: a range that reaches before the session's retained dated window
  (`rangeTruncated()`, driven by `usageByDateTruncated`, §13.2), and a breakdown
  that reports usage for only `n` of `m` calls/runs. The TUI has no
  history/global section and gains no coverage surface; `json history|global`
  expose `coverage` verbatim.
- Per-day coverage is **not** rendered: an unreadable session's dates are unknown.

### 13.2 Attribution, ranges, and scope

Every range-filtered number is attributable to exactly one UTC calendar date,
attributed by **logical call** — never by result arrival, and never by inferring a
start, end, or duration:

| Evidence | Date comes from | Consequence |
| --- | --- | --- |
| generation usage | `Generation.timestamp` | native parent-session usage |
| tool call identity, status, and its attached usage | `Tool.timestamp` (the call time) | a call at `23:59` whose result arrives at `00:01` carries its usage/cost on the **call day** |
| tool error event | `ErrorRecord.timestamp` (observation time) | the error can land on the **next day** than that call's usage |
| child run | `AgentRun.observedAt` (publication time of the publishing result) | observation time only, never a run start/end/duration |
| compaction / branch summary | its own persisted entry timestamp | — |

- The attribution is computed **once**, by the canonical builder
  (`CanonicalUsageLine.attributedAt`/`domain`/`bucket`), and is only projected:
  one dated projection (`sessionDatedUsage`) feeds every range-aware widget, and
  nothing re-walks report timestamps to build a second dated view. The one
  documented exception is the `sessionView` path's
  `sessionSpanMs`/`reportDates` in `src/ui/report-projection.ts`, which walk
  native record timestamps to produce one **span/duration label** (the Overview
  Duration card and the history entry's first/last dates), never a per-date
  usage figure — every dated number still comes from `sessionDatedUsage`.
  Tools, agents, and errors are filtered from their own canonical rows (one row
  per call/run/error); date-indexed duplicates for them do not exist.
- Boundaries are inclusive UTC dates (`from <= date <= to`); presets are anchored
  on the view's **latest observed date**, never the machine clock, so exports stay
  byte-identical.
- Defaults: `current` = full observed span; `history`/`global` = 14 days ending at
  the latest observed date. Scope defaults: `current` = `active` (active ancestry
  after the marker), history/global = `tree` (all post-marker entries).
- Range state is keyed by **view identity** (`current`, `history:aggregate`,
  `history:<sessionId>`, `global`), so a selected session never inherits the
  aggregate's range. The active view's range and table state are route state
  (§13.4); other views' ranges and table settings are **ephemeral in-memory
  caches**, never deep-link state, and die with the document.
- A per-session dated window (`usageByDate`, ≤ 366 newest dates) carries one
  boolean, `usageByDateTruncated`, set when the window cannot represent the
  session's whole native usage: the 366-date cap, a native usage line with no
  known attribution (`evidenceHealth.usage.dated === "partial"`), or an
  unavailable/overflowed usage aggregate with native lines. All three causes share
  the one flag and one `Known` render path; global aggregate rows carry the same
  flag (`GlobalSessionRow.usageByDateTruncated`, required) so a partial
  contribution makes the aggregate visibly partial. Omitted or undatable history
  is never silently excluded, never counted as zero, and never extrapolated.
- Silent custom-range clamping is removed: a range outside the observed data is
  accepted and produces the affected widgets' empty state, and an invalid
  (`from > to`) or half range pair is never partially applied.
- A widget that is intentionally not range-filtered renders an explicit label from
  the projection (`All report dates` / `Current environment` / `Session total`).
  No page shows a range-filtered cost beside an unlabelled all-period breakdown.
- Child usage remains a **breakdown**: it is never added to any session, model,
  history, or global total, and its completeness is a derived fraction of the
  rendered runs (`agentUsage`), never extrapolated and never carried on
  integration evidence.

### 13.3 Capability-driven tabs

Tabs are computed server-side per section from the data contract, and the client
renders only capable tabs; a route naming an unsupported tab coerces to the
section default with a bounded notice. No tab is ever "present but guaranteed
`Unavailable`".

| Section | Tabs |
| --- | --- |
| current (view available) | overview, models, tools, environment (commands / skills / resources), agents, integrations, errors, ledger |
| current (view unavailable) | none — a single `Unavailable` panel with the bounded diagnostic |
| history (aggregate) | overview (chart, session list) |
| history (session selected) | all tabs (the session carries a full `SessionReport`) |
| global | overview (chart) |

Commands, Skills, and Resources are **environment** inventory and are grouped under
one Environment tab in the browser; inventory is environment state (never a
"used"/"invocation" claim) and is never range-filtered, while skill invocations
come only from explicit folded counters and integration rows keep detection,
telemetry, activity, and version independent (ADR 0017, ADR 0009, ADR 0014). The
TUI keeps its own fixed tab list and is not re-taxonomized; both surfaces consume
the same `SessionReport`.

### 13.4 Route authority

The hash (`#/…`) is the single authority for browser navigation state. API query
parameters are transport inputs only and never become route state; the server
never parses or owns browser navigation. One canonical parameter order —
`scope, preset, from, to, session, entity, q, sort` — means one route has exactly
one string. The bootstrap `#token=…` fragment is the one bounded exception: it
is consumed before route parsing and replaced with the canonical default route.

- `render()` derives **all** state from the route: content, the active sidebar item
  and the active tab (`aria-current="page"`), the scope button and the range preset
  (both `aria-pressed`), the search/sort control values, and the focus target.
  Click handlers only mutate the route. (The environment sub-tab and the theme
  toggle also use `aria-pressed`, but they are ephemeral client state outside the
  route.)
- A **discrete** route change (section, tab, scope, session, entity, range preset,
  custom range, sort) **pushes** a history entry so Back restores the previous
  state; only in-progress search typing **replaces** the current entry. The Tools
  summary → calls tool filter is per-view-identity ephemeral client state, not
  route state, and pushes nothing.
- Parsing is total and never throws: any unknown section/tab/option/date degrades
  to the section default with a bounded one-line notice. A custom range serializes
  only as a validated `from`/`to` pair; a preset serializes alone; mixed
  preset/custom forms are rejected rather than resolved by precedence. Ids
  (session, entity) are validated against the id set the projection already
  exposes and are dropped, never echoed, otherwise, so no prompt/argument/result/
  path text can reach the hash.
- Capabilities are parsed from the payload; a history route with a selected
  session uses the session-selected capability set (§13.3).
- Environment degradation is explicit: in an environment that refuses the History
  API (`SecurityError` on `file://`), every write is guarded and the document still
  renders. A refused canonicalization keeps the applied route in memory; a refused
  in-progress replacement falls back to a same-document hash assignment (costing
  one entry per keystroke in that environment only).

### 13.5 Completion contract

`getArgumentCompletions(prefix)` keeps its signature and grammar decisions. Each
returned item's `value` is the **full replacement argument text**: the raw prefix
with only the current raw token span replaced, located on the raw string (quotes
included) so every preceding character is copied byte-identically and quoting is
preserved (`--output "/tmp/my report.json"` survives completion). A bare token
value is returned only when there is no preceding content. This is required
because the pinned provider hands the extension the whole argument region and
replaces that whole region on selection; a token re-join would strip quotes.

Pinned-API limitation (ADR 0017): with `@earendil-works/pi-tui@0.85.1`,
`getSuggestions` sees only the pre-cursor text and `applyCompletion` appends the
post-cursor remainder verbatim, so a mid-token completion of
`/session-ins ui --the|me` yields `/session-ins ui --thememe`. No extension-side
`value` can prevent that append; the milestone pins the provider's actual
composition in a boundary test rather than asserting the unreachable result.
Engine-independent guarantees remain: prior characters are preserved,
option-repeat suppression, and `null` for an unparsable stream.

### 13.6 Unsupported and deferred

Two different verdicts. **Unsupported** means no safe evidence exists, so the
value can only ever render `Unavailable`. **Deferred (out of scope)** means the
evidence exists but this milestone deliberately does not aggregate or expose it;
nothing about it is fabricated in the meantime.

| Requested capability | Verdict | Reason |
| --- | --- | --- |
| Per-day coverage (which days are incomplete) | Unsupported | Unavailable sessions are unreadable by definition; their dates are unknown |
| Usage-coverage ratio / estimated unavailable usage | Unsupported | Would fabricate usage; only the session ratio exists, and it is omitted when the denominator is unknown |
| Tool-error message text | Supported, bounded | Text-only `content` from an errored tool result passes shared secret/path/URL redaction and a 200-byte cap; arguments, non-text blocks, and unusable values render `Message: Unavailable` |
| Tool result content / arguments in any view | Unsupported by design | Privacy boundary |
| Agent run duration | Unsupported | No producer duration field; differencing timestamps would be an estimate |
| Agent free-text failure reason | Unsupported | The producer exposes bounded enums only |
| Agent task description / summary | Unsupported | Prompt text; privacy boundary |
| Agent model / thinking level | Supported, conditional | Present for the pinned producer; validated, optional, `Unavailable` otherwise |
| Global/history per-model, per-tool, per-agent breakdowns | Deferred (out of scope) | Every scanned session is replayed into a full `SessionReport`, but this milestone does not aggregate across sessions |
| Inventory invocation counts for commands/prompts | Unsupported | No counter evidence exists; skills have counters, commands do not |
| Live duration for historical sessions | Unsupported | Duration evidence is live-correlation only |
| Integration version when the producer publishes none | Unsupported | Rendered `Unavailable`, never `0` |
| Exact aggregate-row/detail reconciliation for ranges older than a session's retained dated window | Unsupported (bounded projection) | The window holds 366 dates; the omitted portion is reported as partial/`Known` with a truncation diagnostic, never reconstructed |
| Child usage completeness when some runs report none | Known-only | Shown as `Known … (n of m runs)`; never extrapolated |
