# Evidence Foundation & Canonical Session Model Design

- **Status:** Proposed — awaiting human approval
- **Date:** 2026-09-12
- **Milestone:** Evidence Foundation (proposed `0.8.0`)
- **Downstream consumer:** `2026-09-12-report-semantics-diagnostics-navigation-design.md` and its 23-task implementation plan
- **Implementation:** Not started

---

## 1. Decision

Adopt **Approach B: a privacy-safe evidence layer with distinct atomic and folded-aggregate inputs (L0), an in-memory reconciled canonical session model (L1), and existing report/navigation DTOs as projections (L2)**.

Pi session JSONL remains authoritative for native session facts. Inspector WAL remains authoritative only for bounded live observations that Pi does not persist. Cooperative integration evidence remains explicitly cooperative. Checkpoints remain rebuildable aggregate caches, not event or session authority.

Do **not** add a canonical-session database or duplicate Pi event store. Add only:

1. an in-memory L0/L1 boundary that distinguishes atomic detail from checkpoint-surviving folded aggregates;
2. additive correlation metadata on existing `live_timing` WAL records;
3. additive observation/retention metadata on existing inventory and checkpoint formats;
4. bounded provenance and evidence-health DTOs.

This is the smallest design that fixes the current semantic losses without creating a second source of truth.

---

## 2. Scope

This milestone defines:

- every accepted evidence source and its authority;
- privacy-safe L0 atomic facts and separately typed folded aggregate evidence;
- deterministic L1 identity, relationship, timestamp, usage, and reconciliation rules;
- L2 projection boundaries for current/history/global reports and the approved report/navigation work;
- WAL correlation, checkpoint completeness, inventory observation time, retention, and recovery semantics;
- bounded evidence-health JSON;
- validation invariants and test coverage;
- the dependency map for the approved downstream 23-task plan.

### 2.1 Non-goals

- No production implementation in this design task.
- No execution or rewriting of the approved downstream implementation plan.
- No canonical SQLite database, search index, or copied Pi event log.
- No prompt, response, message body, tool argument/result, child task/output, provider payload, path, URL, or secret persistence.
- No inferred timestamps, parentage, execution order, branch identifiers, usage, or integration activity.
- No historical Lens diagnostics archive or file-touch archive without an approved report consumer.
- No provider/model latency claim: the pinned Pi lifecycle API exposes no safe provider/model timing boundary.
- No Pi session JSONL writes except the existing `session-inspector:tracking-start` marker.

### 2.2 Existing invariants remain normative

1. Pi persisted data is billing and native-fact authority.
2. Inspector remains observer-only; every hook, integration, telemetry, storage, and projection failure is swallowed.
3. Native usage is counted once. Child usage is a non-additive breakdown.
4. Active scope is selected-leaf ancestry after the marker. Tree scope is every entry after the marker.
5. One immutable random writer ID owns one WAL shard. Only maintenance acquires the checkpoint lease.
6. TUI, HTML, and JSON consume the same L2 report DTOs.
7. Unknown formats and integrations become `unsupported` or `unavailable`, never guesses.
8. Storage remains local, bounded, derived, recoverable, and privacy-safe.

---

## 3. Audit method and pinned contracts

The design was derived from source and persisted evidence, not from the current report shape.

### 3.1 Repository paths audited

- Pi parsing/scoping: `src/pi/adapter.ts`, `src/pi/sessions.ts`
- Native reduction: `src/core/events.ts`, `src/core/reduce.ts`
- Report projection/loaders: `src/core/reports.ts`, `src/ui/load-current.ts`, history/global loaders
- Live observation: `src/pi/live.ts`, `src/pi/live-wal.ts`
- WAL/recovery/checkpoint/maintenance/retention: `src/storage/*`
- Tracking/inventory: `src/storage/tracking.ts`, `src/storage/inventory-snapshot.ts`
- Integration adapters: `src/integrations/*`
- Privacy/telemetry: `src/pi/telemetry.ts`, ADR 0010 and ADR 0011
- Existing ADRs 0001–0015, v1 spec/plan, ecosystem research, and both 2026-09-11/12 Superpowers designs/plans

### 3.2 Producer contracts audited

| Producer | Audited contract | Relevant evidence |
| --- | --- | --- |
| Pi coding agent `0.85.1` | session JSONL v3 and installed extension event types | entry IDs/parents/timestamps; provider/model/usage/error; tool call/result IDs; `turnIndex`; `toolCallId`; lifecycle boundaries |
| `pi-subagents` `0.59.0` | `Details`, `SingleResult`, completion/archive replay, workflow child summaries | opaque run IDs, parent IDs, status, model, thinking, usage, output state, process signal, artifacts, publishing result |
| Permission System `31.1.3` | `permissions:ready`, `permissions:ui_prompt`, `permissions:decision` | bounded readiness/prompt/decision events and request IDs |
| Context Mode `1.0.169` | native `ctx_*` calls and versioned custom entries | invocation evidence without arguments/results |
| RTK `0.9.0` | persisted `details.rtkCompaction` | applied state and bounded compaction counters |
| Ponytail local commit `356918e` | persisted `ponytail-mode` custom entry | closed mode transitions |
| Caveman `1.0.8` / commit `8d326c4` | persisted `caveman-level` custom entry | closed level transitions |
| Pi Lens `4.1.6` | native tool calls and additive v1 bus events | tool activity; volatile file-touch and diagnostics summaries |

These are the implemented Pre-M8 contract pins. The locally installed Permission System `32.0.2` source was cross-checked during this audit, but it does not supersede the pinned `31.1.3` contract. Implementation must re-open the pinned tarball/integrity evidence before changing that adapter. Pinned source wins over assumptions. A new producer version is unsupported until its schema is explicitly accepted.

### 3.3 Privacy-safe corpus procedure

The real corpus audit parsed only structure and bounded enums. It emitted aggregate counts and field names. It did not print or retain message content, tool input/output, child task/output, paths, URLs, raw IDs, provider payloads, or secrets.

---

## 4. Evidence inventory and current losses

### 4.1 Authority hierarchy

| Source | Authority | Durable | Exact after restart | Permitted role |
| --- | --- | --- | --- | --- |
| Pi JSONL v3 | `native` | yes | yes | session header, entry graph, state transitions, generations, tools/results, native errors, native usage, compaction/branch summaries, persisted integration evidence |
| Inspector WAL | `live` | hot/bounded | yes while retained | lifecycle duration, first-class explicit skill invocation, and bounded telemetry unavailable from Pi JSONL |
| pi-subagents details/archive | `cooperative` | through Pi result and validated archive | yes when source remains | child run metadata and non-additive child usage |
| Inventory snapshot | `observed` | bounded | yes while retained | observed commands/skills/resources/tool-source labels; availability, not activity |
| Current environment observation | `observed` | no | no | current installation/presence only |
| Checkpoint | `derived` | yes | aggregate only | exact cursor-bounded folded integration/skill/presence counts, resource-count fallback, replay acceleration, and retention/completeness metadata |
| Session/history/global report | `derived` | output only | rebuildable | renderer/API projection; never authority |

An authoritative source can still be malformed, unsupported, partial, or unavailable. Authority never converts missing evidence into zero.

### 4.2 Pi session JSONL v3

Available native evidence:

- header `id`, `version`, `timestamp`;
- header `parentSession` path when forked;
- entry `id`, `parentId`, `timestamp`, and type;
- assistant `provider`, `model`, usage, stop reason, and bounded error message;
- tool call `id` and `name`;
- tool result `toolCallId`, `toolName`, `isError`, optional usage, and details;
- compaction and branch-summary usage;
- model and thinking-level state changes;
- versioned/custom integration entries.

Current loss:

- `parseSessionJsonl()` retains only header ID and a boolean; it drops format version and session creation timestamp;
- entry graph survives only as `SessionEntry[]`, not as explicit provenance;
- `ReducedSession` merges tool calls/results early and discards result entry identity/time except tool errors;
- model/thinking transitions are not canonical facts;
- unknown/malformed evidence is reduced to coarse counters;
- nested message timestamps coexist with entry timestamps without a normative distinction.

Required rule: Pi entry wrapper timestamp is the native occurrence timestamp. Nested message timestamps are ignored for report attribution.

Header `cwd` and raw `parentSession` paths never enter L0/L1/L2. Parent resolution is a source-adapter-only operation with bounded input/read, approved-root containment, regular-file and symlink checks, and a validated v3 parent header (§8.7). Basename/path parsing is never identity. Failure leaves parentage unavailable and emits only `parent-session-unavailable`.

### 4.3 Tracking marker and metadata

The marker is the only permitted Pi write. Metadata v2 locates the source with a stored basename. Metadata v1 lacks that locator.

Current loss:

- multiple markers are silently tolerated without a diagnostic;
- missing marker currently falls back to all entries;
- neither marker nor metadata yields a first-class tracking-start fact;
- metadata contains no observation timestamp.

Required rule:

- earliest valid marker is the immutable boundary;
- later valid markers are duplicates, reported in health, and never reset scope;
- tracked metadata with no valid marker has unavailable scope and no tracked facts;
- metadata v1 is not upgraded by guessing a filename.

### 4.4 Inspector WAL

Current durable records:

- anonymous `live_timing` rows for agent/turn/tool timing;
- validated `pi.telemetry.v1` event/counter/gauge envelopes;
- explicit `skill.invocation` telemetry with bounded skill name;
- immutable writer ID, writer-local sequence, event ID, and timestamp.

Current loss:

- Pi exposes `toolCallId`, but `registerLiveObserver()` discards every hook payload;
- tool timing therefore cannot join the native tool call;
- FIFO category queues are unsafe for concurrent/out-of-order tool completions;
- provider/model `unsupported` rows are persisted once per session/writer registration although unsupported capability is static;
- permission prompt/decision records discard their exact request relationship;
- explicit skill invocations are folded but omitted from the proposed first-class canonical fact union;
- folded counters retain totals but lose temporal detail after WAL retention.

### 4.5 Checkpoint

Current schema v1 retains:

- Pi line/revision cursor;
- per-writer WAL fold cursors and prune seals;
- total tokens/cost and generation/tool/compaction counters;
- `integrationCounters`;
- named `skillInvocations` plus `skillOverflowInvocations`;
- permission presence;
- selected `resourceCounts`.

Current loss:

- checkpoint values are not represented as a distinct L0 input or L1 canonical aggregate;
- current/history loaders can read checkpoint aggregates directly while constructing L2 reports;
- no `checkpointedAt`;
- no explicit known/partial/unavailable usage completeness;
- no temporal bound for pruned detail;
- no inventory observation time;
- resource-count preservation is incomplete;
- a checkpoint can prove aggregate survival but not fabricate event rows or event timestamps.

### 4.6 Inventory snapshot

Current schema v1 retains bounded commands, skills, resources, tool-source labels, and optional bounded/sanitized command and skill descriptions.

Current loss:

- no `observedAt` or `capturedAt`;
- unchanged snapshots deliberately preserve old mtime;
- mtime therefore means neither occurrence time nor reliable observation time;
- freshness therefore cannot be recovered from stored state and must be made explicit: `observedAt` is the latest successful observation time and advances even when inventory content is byte-equivalent.
- retention can remove detail while checkpoint counts remain, but reports cannot explain the boundary exactly.

### 4.7 Integration evidence

| Integration | Durable evidence now | Safe canonical facts | Gap |
| --- | --- | --- | --- |
| Context Mode | `ctx_*` calls; versioned `ctx_*` custom entries | native call facts and cooperative custom event facts | paths cannot be exactly deduplicated without a shared ID; current `max(custom, tool)` hides this ambiguity |
| RTK | result `details.rtkCompaction` | relation to publishing tool result; applied/counter facts | current report keeps only aggregate row |
| Ponytail | `ponytail-mode` custom entry | closed transition with Pi entry time | no real-corpus sample in the audited direct sessions |
| Caveman | `caveman-level` custom entry | closed transition with Pi entry time | current report drops transition time |
| Permission | WAL telemetry | per-event fact with observer time | request relationship discarded; detail expires to counters |
| Explicit skills | WAL telemetry derived from `/skill:<name>` input; named/overflow checkpoint counts | first-class invocation fact with bounded skill token, WAL identity/provenance, and observer time | inventory remains separate availability evidence; expired detail survives only as aggregate-only named/overflow counts |
| pi-subagents | persisted result details plus validated archive | agent observations with publication time and tool relationship | model/thinking/failure/publication relation currently dropped; no run start/end timestamp in pinned result rows |
| Lens | native Lens tool calls; volatile v1 bus events | version-pinned native tool call facts | current adapter recognizes only exact tool name `lens`; audited calls use names such as `module_report`, `read_symbol`, and `lens_diagnostics` |
| Presence | current settings/package inspection | current-environment observation | not historical; no time is persisted |

Context Mode rule: native `ctx_*` tool calls are the exact call count when present. Cooperative `ctx_*` custom events remain a separate count. They are never summed or paired by time, and `max()` is not described as exact deduplication.

Lens rule: use a version-pinned allowlist of native tool names. Unknown names are unavailable, not attributed by similarity. Lens bus events include prohibited paths/messages; no bus event is persisted in this milestone because no approved report consumer needs it.

### 4.8 Real corpus findings

Snapshot taken during design; the active session continued to append afterward.

#### Direct Pi sessions

- 8 direct project session files; all 8 had valid v3 headers and valid header timestamps.
- 4,645 entries; every entry timestamp parsed; no duplicate entry IDs or missing parent targets.
- All 8 were tracked. Corpus had 30 tracking markers with per-session counts `1, 1, 1, 2, 3, 4, 8, 10`.
- 3,689 entries were after each session's earliest marker.
- No audited tracked session contained a branch; branch behavior remains fixture-driven.
- 2,176 tool calls had IDs; 2,174 persisted results joined by exact call ID; no duplicate call ID appeared.
- 2,065 native usage records were structurally complete; no token-total mismatch appeared.
- 89 persisted tool results were native failures.
- 70 RTK records were valid and applied.

#### pi-subagents

- 393 subagent-family calls and 393 persisted results.
- 121 run-result rows, 46 completion rows, and 11 workflow-child rows.
- 121 rows carried complete child usage; 83 carried model and thinking metadata.
- 11 rows carried bounded failure-class evidence.
- 45 validated archive references were present.
- No audited producer row carried a run start/end timestamp. Parent Pi result entries did carry timestamps, so `AgentRun.observedAt` is available but execution duration is not.

#### Integration call census

- 165 native Context Mode calls across the audited `ctx_*` tool names.
- At least 148 native Lens calls across the pinned names sampled by the audit.
- No call used the literal tool name `lens`; the current exact-name Lens counter therefore misses real Lens activity.
- Caveman persisted 8 closed-level transitions. Ponytail had no direct-session transition sample.

#### Inspector artifacts

- 28 session directories; 27 metadata files: 16 schema v1 and 11 schema v2.
- 5 checkpoints and 5 inventory snapshots, all schema v1.
- No checkpoint had `checkpointedAt`; no inventory had an observation timestamp.
- 41 WAL writers, 44 segments, and 7,042 valid JSON records.
- 6,522 `live_timing` rows and 440 telemetry rows; none of the timing rows had a correlation subject.
- 80 older lifecycle-kind rows were structurally valid legacy evidence but unsupported by the current WAL parser.
- No writer-sequence gap, duplicate event ID, or malformed JSON record appeared.
- Permission telemetry included 431 decisions, 7 prompts, and 2 readiness events; none retained request attribution.

These findings justify correlation and health metadata. They do not justify a second event store. No `skill.invocation` envelope appeared in the audited local WAL, so explicit skill invocation is a pinned producer contract rather than a locally observed sample; the metric/dimension shape is unchanged and already exercised by the counter fold.

---

## 5. Approach comparison

### Approach A — keep extending `SessionReport`

Add agent fields, timestamps, diagnostics, and source metadata directly to current report DTOs and continue reducing source evidence independently in each loader.

**Advantages**

- smallest immediate diff;
- no new internal model.

**Failures**

- keeps `SessionReport` as both semantic store and renderer boundary;
- repeats reconciliation in current/history/global paths;
- cannot preserve atomic provenance or explain discarded facts;
- encourages renderer requirements to reshape source semantics;
- does not fix WAL correlation or retention truth.

**Decision:** reject. Short implementation, long-lived semantic debt.

### Approach B — L0 atomic evidence, L1 canonical session, L2 projections

Parse every source into bounded source-specific facts, reconcile once in memory, and derive all reports/navigation from the same model.

**Advantages**

- keeps authority explicit;
- preserves exact identities and time bases until projection;
- centralizes usage and relationship rules;
- supports evidence health and honest retention states;
- avoids persistent duplication of Pi;
- gives the approved downstream report work one stable source.

**Costs**

- introduces one internal boundary and migration seam;
- requires loaders/adapters to converge on the builder.

**Decision:** adopt.

### Approach C — materialized canonical event/session database

Persist normalized facts in SQLite or another indexed store and query it for every report.

**Advantages**

- fast cross-session queries;
- convenient temporal indexes;
- independent report execution after source removal.

**Failures**

- duplicates Pi's authority;
- creates migrations, synchronization, invalidation, and delete semantics;
- expands privacy and corruption surface;
- risks stale or double-counted usage;
- no measured performance requirement demands it.

**Decision:** reject for this milestone. Reconsider only after streaming L0/L1 replay is measured and shown inadequate for an approved query.

---

## 6. Three-layer architecture

```text
Pi JSONL ──────────────┐
Inspector WAL ─────────┤
Checkpoint ────────────┤
Inventory snapshot ────┼─> L0 Safe Evidence
Subagent details/archive┤      AtomicEvidence
Current environment ───┤  FoldedAggregateEvidence
Checkpoint ─────────────┘          │
                                  v
                              L1 Canonical Session
                               /        |        \
                              v         v         v
                    current report   history   global
                              \         |         /
                               L2 report/navigation DTOs
                                  TUI / HTML / JSON
```

### 6.1 L0 — safe atomic and folded evidence

L0 exposes two disjoint input classes:

- `AtomicEvidence`: one validated source observation per fact, including every structurally valid Pi graph node, retained WAL events, explicit skill invocations, cooperative publications, and retained inventory detail;
- `FoldedAggregateEvidence`: already-folded checkpoint counters/counts plus their exact cursor/seal boundary and aggregate-only provenance.

Atomic adapters perform:

- structural validation;
- string bounds and redaction;
- enum validation;
- timestamp parsing without inference;
- source-specific provenance assignment;
- prohibited-field removal before the fact enters shared code;
- record acceptance/rejection accounting.

Folded adapters validate the checkpoint, cursor/seal maps, aggregate bounds, and provenance. They do not manufacture fact IDs, event rows, timestamps, or relationships from counts.

L0 does not merge calls/results, deduplicate producer snapshots, select scope, combine atomic and folded values, compute totals, or infer relationships.

### 6.2 L1 — reconciled canonical session

L1:

- validates session identity and marker boundary;
- owns the full native entry graph for relationship resolution;
- reconciles exact call/result and live timing identities;
- reconciles repeated cooperative child observations;
- exposes explicit skill invocation detail while retained;
- reconciles retained atomic telemetry against checkpoint fold boundaries and keeps only the non-overlapping aggregate supplement;
- builds native and child usage ledgers;
- classifies timestamp attribution;
- exposes source/relationship/retention health;
- remains independent of tabs, routes, copy, table layouts, and date controls.

L1 is rebuilt in memory. It is never written as a canonical session file.

### 6.3 L2 — report and navigation projections

L2 contains bounded DTOs consumed verbatim by TUI, HTML, and JSON. It:

- projects active/tree scope from one L1 model;
- applies date-range projections using canonical attribution dates;
- creates bounded `usageByDate` history evidence;
- hides internal IDs when the approved UI contract says to hide them;
- maps provenance to existing confidence/source fields and evidence-health summaries;
- never reads WAL, checkpoint, inventory, or producer archives directly;
- never re-reads raw source evidence, folds checkpoint counters, subtracts cursor overlap, or recomputes joins.

Only the L0 source coordinator may call storage/source readers for semantic evidence. Maintenance/retention may still read storage for storage ownership, but no L2 loader or projection may bypass L1.

---

## 7. L0 contracts

The exact implementation may split files, but the semantic contract is:

```ts
type EvidenceAuthority = "native" | "live" | "cooperative" | "observed" | "derived";

type EvidenceSource =
  | "pi-jsonl"
  | "inspector-wal"
  | "checkpoint"
  | "inventory"
  | "subagent-result"
  | "subagent-archive"
  | "integration-telemetry"
  | "current-environment";

type TimeEvidence =
  | {
      state: "known";
      at: string; // normalized ISO-8601 UTC instant
      basis:
        | "pi-session-header"
        | "pi-entry"
        | "pi-publication-entry"
        | "wal-observer"
        | "inventory-observer"
        | "current-observer"
        | "checkpoint-observer";
    }
  | { state: "unavailable" };

type FactProvenance = {
  source: EvidenceSource;
  authority: EvidenceAuthority;
  /** Safe native or Inspector-generated record identity; never a path. */
  recordId?: string;
  schemaVersion?: number;
};

type L0FactBase = {
  factId: string;
  sessionId: string;
  provenance: FactProvenance;
  time: TimeEvidence;
};

type L0Evidence = {
  atomic: AtomicEvidence[];
  folded: FoldedAggregateEvidence[];
};
```

All IDs and labels have explicit byte bounds. Producer-controlled labels pass the existing secret/path/URL redaction policy. Unknown fields never flow through generic object spreads.

### 7.1 Required fact families

```ts
type AtomicEvidence =
  | SessionHeaderFact
  | TrackingBoundaryFact
  | EntryNodeFact
  | GenerationObservation
  | ToolCallObservation
  | ToolResultObservation
  | NativeUsageObservation
  | StateTransitionObservation
  | CompactionObservation
  | IntegrationEventObservation
  | SkillInvocationObservation
  | AgentRunObservation
  | ChildUsageObservation
  | LiveTimingObservation
  | InventoryObservation;

type SkillInvocationObservation = L0FactBase & {
  kind: "skill-invocation";
  skill: string; // SKILL_NAME_PATTERN, max 64 characters
  wal: { eventId: string; writerId: string; writerSequence: number };
  provenance: FactProvenance & {
    source: "integration-telemetry";
    authority: "live";
    schemaVersion: 1;
  };
  time: { state: "known"; at: string; basis: "wal-observer" };
};

type FoldedAggregateEvidence =
  | {
      kind: "checkpoint-wal-aggregates";
      sessionId: string;
      foldedThrough: Record<string, number>; // writerId -> cursor
      sealedThrough: Record<string, number>; // writerId -> safe prune cursor
      integrationCounters?: Record<string, Record<string, number>>;
      skillInvocations?: Record<string, number>;
      skillOverflowInvocations?: number;
      presence?: { permission?: true };
      checkpointedAt: TimeEvidence;
      provenance: {
        source: "checkpoint";
        authority: "derived";
        schemaVersion: 1;
      };
    }
  | {
      kind: "checkpoint-resource-aggregates";
      sessionId: string;
      resourceCounts: {
        commands?: number;
        skills?: number;
        resources?: number;
        toolSources?: number;
      };
      observedAt: TimeEvidence;
      checkpointedAt: TimeEvidence;
      provenance: {
        source: "checkpoint";
        authority: "derived";
        schemaVersion: 1;
      };
    };
```

Minimum source-specific fields:

| Fact | Required safe fields |
| --- | --- |
| `SessionHeaderFact` | session ID, v3 format, created time, safe parent-session resolution state |
| `TrackingBoundaryFact` | marker entry ID and Pi entry time |
| `EntryNodeFact` | entry ID, parent ID/null, append ordinal, Pi entry time state, and `known | unknown` semantic type state; unknown raw type/payload is dropped |
| `GenerationObservation` | entry ID, provider/model labels, stop/error class, bounded redacted error message |
| `ToolCallObservation` | entry ID, native call ID, tool name |
| `ToolResultObservation` | entry ID, native call ID, tool name, error boolean |
| `NativeUsageObservation` | source entry ID, owner kind/ID, validated token/cost fields |
| `StateTransitionObservation` | model or thinking kind and bounded value |
| `CompactionObservation` | entry ID and compaction/branch-summary kind |
| `IntegrationEventObservation` | integration, version, event kind, closed dimensions, exact related fact when published by a tool result |
| `SkillInvocationObservation` | bounded validated skill name, session ID, WAL event/writer/sequence identity, observer timestamp, and `live` provenance |
| `FoldedAggregateEvidence` | checkpoint-only aggregate values plus fold cursors, seals, materialization/observation time state, and `derived` aggregate-only provenance; never an event fact |
| `AgentRunObservation` | hashed run ID, optional hashed parent ID, closed status, role/model/thinking, artifact state, bounded failure, publishing tool ID |
| `ChildUsageObservation` | hashed run ID and validated usage; explicitly non-additive |
| `LiveTimingObservation` | category, running/complete/unsupported boundary state, observer times, optional safe subject ID; persisted `unknown` plus a valid end maps to canonical `complete` while outcome remains unknown |
| `InventoryObservation` | observed time plus bounded commands/skills/resources/tool-source labels and optional ADR-0015-bounded descriptions |

### 7.2 Source read gates

1. Session header missing: Pi source unavailable; no L1 session.
2. Header version not `3`: Pi source unsupported; no best-effort semantic parse.
3. Header ID invalid or metadata ID mismatch: identity conflict; no L1 session.
4. Every structurally valid v3 entry emits `EntryNodeFact`, whether or not its semantic type is known.
5. Unknown semantic entry type: keep the node with `semanticType.state: "unknown"`, emit no semantic payload fact, increment `unknown-entry`, and mark semantic evidence partial.
6. Malformed or structurally invalid line: emit no node/fact, source becomes partial, and never echo the line.
7. Missing/invalid event timestamp: retain the structurally valid node and identity/relationship metadata; date attribution is unavailable.
8. Invalid usage: reject usage only; preserve its owner fact and mark usage partial.
9. Invalid cooperative field: omit that field; do not reject unrelated valid fields.
10. Invalid archive/reference: no path leaves the adapter; artifact/evidence state becomes unavailable or missing according to the existing validated contract.
11. Invalid checkpoint cursor/seal or aggregate: reject the affected `FoldedAggregateEvidence`; never coerce or repair it.

---

## 8. Canonical identity and relationships

### 8.1 Identity rules

| Entity | Canonical identity |
| --- | --- |
| session | exact validated Pi header ID |
| entry | exact validated Pi entry ID |
| generation | `generation:<entryId>` |
| tool call | `tool:<nativeToolCallId>` |
| tool result observation | result entry ID; related to tool by exact `toolCallId` |
| compaction/branch summary | `compaction:<entryId>` |
| mode/state transition | source entry ID plus transition kind |
| agent run | `subagent-<canonicalOpaqueDigest("subagent-run", ...)>`; raw producer run ID never leaves adapter |
| permission request | `permission-request-<canonicalOpaqueDigest("permission-request", ...)>`; never raw request ID |
| live tool subject | `live-tool-<canonicalOpaqueDigest("live-tool", ...)>` |
| live agent/turn subject | Inspector-generated writer-local opaque ID |

No timestamp, array position, label, task text, model, tool name, or filename creates identity.

#### 8.1.1 Canonical opaque identity algorithm

Every raw producer identity that must correlate across adapters without Inspector persistence uses one helper and contract:

```ts
type OpaqueIdentityDomain =
  | "live-tool"
  | "permission-request"
  | "subagent-run";

canonicalOpaqueDigest(
  domain: OpaqueIdentityDomain,
  sessionId: string,
  rawId: string,
): string; // exactly 64 lowercase hexadecimal characters
```

Validation and encoding are binding:

1. `domain` is one registered ASCII enum above.
2. `sessionId` is the validated canonical Pi session ID.
3. `rawId` is a source-adapter-only string of at most 512 UTF-8 bytes; empty/control-containing input is rejected.
4. No Unicode normalization occurs; accepted JavaScript string values encode as exact UTF-8 bytes.
5. Preimage byte order is exactly:
   `UTF8("pi-session-inspector") || NUL || UTF8("opaque-id") || NUL || UTF8("v1") || NUL || UTF8(domain) || NUL || UTF8(sessionId) || NUL || UTF8(rawId)`.
6. Digest is SHA-256 of that preimage.
7. Helper output is the 32 digest bytes encoded as 64 lowercase hexadecimal characters. Entity fields add only the fixed prefixes shown in §8.1.

Hook adapters, WAL recovery/correlation code, and L1 reconcilers must import this helper; no caller rebuilds the preimage. A WAL reader with no raw source ID validates and carries the encoded opaque ID unchanged; any recovery path given raw source input computes it through the same helper. Tool hook and Pi replay calculations must therefore be byte-identical.

Only the opaque form enters Inspector WAL/checkpoint/report evidence. The raw permission/subagent identity is dropped in the adapter call frame. Pi's own authoritative JSONL remains unchanged and already contains its native tool call ID; Inspector-owned durable records never persist that raw ID as correlation evidence beside the opaque form.

Pi's native tool call ID remains the approved public `tool:<id>` identity because Pi persists it and Inspector does not own that field. The `live-tool` digest is L0/L1-internal correlation evidence and is never projected beside the native tool identity in L2.

This session-scoped `subagent-run` digest intentionally supersedes the pre-`0.8.0` process-global digest. Public agent IDs keep the `subagent-<64hex>` shape but change value at the foundation version boundary; all links are regenerated from the same L1 report.

Existing public generation/tool/compaction ID values remain byte-stable. L0/L1 may carry additional internal fact IDs but L2 does not rewrite those IDs.

### 8.2 Entry graph and scope

The source adapter emits one graph node for every structurally valid v3 entry, including pre-marker and unknown-semantic nodes needed to follow ancestry:

```ts
type EntryNodeFact = L0FactBase & {
  kind: "entry-node";
  entryId: string;
  parentId: string | null;
  appendOrdinal: number;
  semanticType:
    | { state: "known"; type: KnownPiEntryType }
    | { state: "unknown" };
};
```

Structural validity requires bounded valid entry/parent IDs, a bounded type token, and the required scalar shapes. Timestamp parsing is represented by `time`; an invalid timestamp does not remove an otherwise valid node. Unknown raw type text and payload are discarded after setting `semanticType.state`.

Semantic facts are admitted only after the earliest valid marker.

- **Tree graph:** every structurally valid post-marker node in Pi append order; semantic collections contain only understood payload facts.
- **Active graph:** every node on the exact `parentId` ancestry of the selected Pi leaf, including unknown-semantic nodes; semantic collections contain the understood facts on that path.
- A null, missing, duplicated, or cyclic selected path makes active scope unavailable; it never falls back to tree.
- Missing marker makes both tracked projections unavailable.
- Later duplicate markers remain ordinary post-boundary custom entries but never reset the boundary.
- No branch ID is synthesized.

### 8.3 Relationship states

Canonical relationships use:

```ts
type CanonicalRelationship =
  | { state: "known"; id: string }
  | { state: "unavailable" };

type ProjectedParentRelationship =
  | { state: "resolved"; id: string }
  | { state: "outside-selected-scope" }
  | { state: "unavailable" };
```

L1 may retain a safe internal known parent ID. L2 hides it for `outside-selected-scope`, matching the approved report design.

Relationships are admitted only from:

- Pi entry `parentId`;
- exact Pi tool `toolCallId` correlation;
- safely resolved Pi parent-session header;
- validated pi-subagents `parentId`;
- the persisted tool result that published child evidence;
- validated permission request attribution;
- exact live tool subject hashing.

Temporal proximity never creates a relationship.

### 8.4 Tool call/result reconciliation

1. Index calls by native call ID.
2. Index results by exact native `toolCallId`.
3. One call + first persisted result determines succeeded/failed status and tool error.
4. No result yields existing `interrupted` semantics: “no persisted result at this replay boundary,” not proof of process cause.
5. First valid usage-bearing result for a call supplies tool usage; later results cannot add or overwrite it.
6. Duplicate calls/results generate health diagnostics. Ambiguous rows do not create extra tool entities.
7. Result-observation time remains available for errors even though tool usage is attributed to call time.
8. Unmatched results never attach by name/time. Their facts remain health-visible; no tool row is fabricated.

### 8.5 Child-run reconciliation

Each persisted result/archive row becomes an atomic `AgentRunObservation` linked to the result that published it.

For repeated observations of the same hashed run ID:

1. Sort by publishing Pi entry ordinal, then producer row index.
2. `observedAt` and `evidenceToolId` come from the latest accepted publication.
3. Mutable fields use the latest valid published value; missing later fields do not erase earlier valid fields.
4. Identity-like fields (`agent`, parent ID) must agree across non-missing observations. Conflict removes the field and emits `cooperative-evidence-conflict`.
5. Conflicting terminal statuses, or terminal-to-running regression, produce canonical `unknown` plus the same diagnostic.
6. Child usage is selected, never summed across repeated publications.
7. `artifacts` remains only `available | missing`; archive/session/transcript paths never enter the fact.
8. Pinned Pi result rows publish no run start/end timestamp. Completion-replay/output archives do contain `completedAt`/`createdAt`, but the validated archive contract is deliberately presence/identity-only; those archive times do not enter `AgentRun`, matching the approved downstream `observedAt`-only contract. Execution start/end/duration remain unavailable.

Bounded failure remains exactly the downstream contract:

```ts
type AgentFailure = {
  reason:
    | "exit-nonzero"
    | "process-signal"
    | "completion-failed"
    | "output-absent";
  detail?: number | string; // safe exit code or bounded signal enum only
};
```

### 8.6 Integration relationships

- RTK facts link to the exact tool-result fact carrying `rtkCompaction`.
- Child observations link to the exact `tool:<toolCallId>` that published them. One result may publish many runs.
- Permission prompt/decision telemetry adds `attribution.request`, a session-scoped hash of validated producer request ID. This is additive telemetry metadata, not a new WAL kind. Implementation ADR 0016 must explicitly supersede ADR 0014's narrower “never read `request`” rule and authorize only this hashed form; raw request IDs remain prohibited.
- Context tool/custom evidence remains separate because no producer identity links the two.
- Lens attribution uses pinned tool names, not fuzzy prefixes or timing.

### 8.7 Parent-session resolution

Raw Pi `parentSession` path exists only inside the Pi source adapter. Resolution is all-or-unavailable:

1. Reject non-string, empty, NUL-containing, or over-4,096-UTF-8-byte input.
2. Require a configured/approved Pi session root; resolve its real path once for the adapter operation.
3. Resolve the candidate without basename extraction. Require lexical containment using a platform-safe relative-path check, never string-prefix comparison.
4. `lstat` every candidate component beneath the approved root and reject any symbolic link. Require the final target to be a regular file.
5. Resolve the candidate real path and require containment inside the approved root again.
6. Open read-only; `fstat` the opened handle as a regular file and, where platform identity fields are available, require it to match the checked target to reduce replacement races.
7. Read only the first non-empty header line, bounded to 16 KiB including the newline; reject an over-bound/missing header without reading the session body.
8. Require a supported Pi v3 session header and a validated canonical parent session ID different from the child ID.
9. Close the handle in every outcome and drop the raw path before returning.

Only `{ state: "known", id: <validated session id> }` may leave the adapter. Every failure returns `{ state: "unavailable" }` and increments `parent-session-unavailable`; diagnostics never include path text, filesystem errors, or candidate IDs. Parent identity is never inferred from basename, directory name, or path shape.

---

## 9. Timestamp model

### 9.1 Time vocabulary

- `createdAt`: Pi session header time.
- `trackingStartedAt`: earliest marker entry time.
- `occurredAt`: native Pi entry time for native facts.
- `observedAt`: observer/publication time for cooperative, live, inventory, or current-environment evidence.
- `checkpointedAt`: cache materialization time only.
- `startedAt`/`endedAt`: live observer lifecycle boundaries only.
- `attributedAt`: deterministic usage/date attribution after relationship reconciliation.

Names are not interchangeable.

### 9.2 Normative attribution table

| Fact | Canonical time | Date attribution |
| --- | --- | --- |
| session creation | header timestamp | not session activity |
| tracking boundary | marker entry timestamp | not usage |
| generation and generation error | assistant entry timestamp | same UTC date |
| tool call/status/attached usage | assistant call entry timestamp | call UTC date |
| tool error | result entry timestamp | result UTC date |
| compaction/branch summary | its entry timestamp | same UTC date |
| model/thinking/mode transition | its entry timestamp | same UTC date |
| child run | publishing result entry timestamp as `observedAt` | observation UTC date only |
| RTK event | publishing result entry timestamp | observation UTC date |
| explicit skill invocation | WAL observer timestamp as `observedAt` | observer UTC date while the atomic record is retained; no date is attributed to a pruned invocation |
| permission prompt/decision telemetry | WAL observer timestamp | observer UTC date while retained |
| live duration | WAL `startedAt`/`endedAt` | duration display only; never usage attribution |
| inventory/presence | capture `observedAt` | environment freshness only |
| checkpoint | `checkpointedAt` | no event attribution |

All accepted instants normalize to UTC without changing the instant. Invalid times become unavailable. No neighboring timestamp fills a gap.

### 9.3 Ordering

- Pi entries: native append ordinal is causal order; timestamps are display/attribution time.
- One WAL writer: `writerSequence` is order.
- Different WAL writers: no causal order; display may sort by timestamp, writer ID, sequence for determinism only.
- Different sources: timestamps support a display timeline, not an inferred causal relationship.
- Clock regression emits health diagnostics; timestamps are not rewritten.

---

## 10. Usage ledger and reconciliation

### 10.1 Canonical line contract

```ts
type UsageDomain = "native-session" | "child-breakdown";
type NativeUsageBucket =
  | "generation"
  | "tool-result"
  | "compaction"
  | "branch-summary";

type CanonicalUsageLine = {
  id: string;
  ownerId: string;
  domain: UsageDomain;
  bucket: NativeUsageBucket | "child-run";
  usage: Usage;
  contributesToSession: boolean;
  observedAt: TimeEvidence;
  attributedAt: TimeEvidence;
  provenance: FactProvenance;
};
```

### 10.2 Native totals

Session known usage is the sum of unique lines where:

- `domain === "native-session"`;
- `contributesToSession === true`;
- usage passed numeric/bounds validation;
- the logical owner was not already counted.

Owners:

- generation: generation entry ID;
- tool result: native tool call ID, first valid usage only;
- compaction/branch summary: entry ID.

When aggregate arithmetic remains within bounds, the four composition buckets must sum exactly to the session known total. The fold preflights every unique line against the same global bound before adding it to a bucket or the total. If any field would overflow, no clamped/saturated aggregate is published: individual bounded lines remain available, aggregate state becomes unavailable, usage health becomes partial/truncated, and `usage-overflow` is emitted. An in-range composition mismatch remains a failed invariant.

Missing usage never creates a zero-valued line. Report totals are “known usage” unless source coverage proves completeness.

### 10.3 Child usage

Child lines always have:

```ts
contributesToSession: false;
domain: "child-breakdown";
```

They can appear in agent detail and child rollups. They never enter:

- session total;
- native usage composition;
- model/provider native totals;
- history/global native totals.

Repeated publications of one run select one current child line; they never add.

### 10.4 Coverage

```ts
type UsageCoverage = {
  state: "complete" | "partial" | "unavailable";
  owners: number;
  ownersWithUsage: number;
};
```

Generation/compaction producers normally publish usage, so a missing value makes that bucket partial. Tool-result usage is optional; reports show `n of m calls reported usage` and label the sum as known. Absence is not zero.

### 10.5 Date aggregation

Daily and range totals group canonical lines by `attributedAt`, never by result arrival except error facts. A line with unavailable attribution contributes to session known total but not a dated bucket; date coverage becomes partial.

This directly supplies the approved cross-midnight and 366-day truncation behavior.

---

## 11. Canonical session contract

```ts
type CanonicalUsageSummary =
  | {
      state: "known";
      known: Usage;
      composition: UsageComposition;
      lines: CanonicalUsageLine[];
      coverage: Record<NativeUsageBucket | "child-run", UsageCoverage>;
    }
  | {
      state: "unavailable";
      reason: "overflow";
      lines: CanonicalUsageLine[];
      coverage: Record<NativeUsageBucket | "child-run", UsageCoverage>;
    };

type CanonicalSession = {
  schemaVersion: 1;
  sessionId: string;
  formatVersion: 3;
  createdAt: TimeEvidence;
  trackingStartedAt: TimeEvidence;
  parentSession: CanonicalRelationship;

  /** Full validated graph; pre-marker nodes exist only for ancestry. */
  graph: CanonicalEntryGraph;
  markerEntryId: string;

  generations: CanonicalGeneration[];
  tools: CanonicalTool[];
  compactions: CanonicalCompaction[];
  errors: CanonicalError[];
  agents: CanonicalAgentRun[];
  stateTransitions: CanonicalStateTransition[];
  integrationEvents: CanonicalIntegrationEvent[];
  skillInvocations: CanonicalSkillInvocation[];
  liveTimings: CanonicalLiveTiming[];
  inventory?: CanonicalInventoryObservation;

  usage: CanonicalUsageSummary;

  /** Checkpoint-surviving counters/counts that outlive pruned detail. */
  retainedAggregates: CanonicalRetainedAggregates;

  health: SessionEvidenceHealth;
};

type CanonicalSkillInvocation = {
  id: string; // `skill-invocation:<walEventId>`; Inspector-generated, not producer identity
  skill: string; // bounded validated name, SKILL_NAME_PATTERN
  observedAt: TimeEvidence; // basis: wal-observer
  provenance: {
    source: "integration-telemetry";
    authority: "live";
    recordId: string; // WAL event ID
    wal: { writerId: string; writerSequence: number };
    schemaVersion: 1;
  };
};

/**
 * One aggregate value that may be the only survivor of pruned detail.
 * `state` is always explicit; an aggregate is never rendered as atomic detail
 * and never gains a synthetic event time.
 */
type AggregateValue<T> = {
  value: T;
  state: "aggregate-only";
  /** Exact disjointness boundary against retained atomic evidence. */
  boundary: {
    foldedThrough: Record<string, number>; // writerId -> fold cursor
    sealedThrough: Record<string, number>; // writerId -> prune seal
  };
};

type CanonicalRetainedAggregates = {
  schemaVersion: 1;
  /**
   * Post-cursor atomic counters already folded here are never added again:
   * `foldedThrough` is the inclusive fold boundary and L1 adds only retained
   * atomic records strictly after it. `sealedThrough` marks pruned streams
   * whose detail no longer exists. `detail` states what remains observable.
   */
  boundary: {
    detail: "full" | "aggregate-only" | "expired";
    foldedThrough: Record<string, number>;
    sealedThrough: Record<string, number>;
    checkpointedAt: TimeEvidence;
    detailExpiredBefore?: string;
  };
  integration?: Partial<
    Record<IntegrationKey, AggregateValue<Record<string, number>>>
  >;
  skillInvocations?: {
    named?: AggregateValue<Record<string, number>>;
    overflow?: AggregateValue<number>;
  };
  permissionPresence?: AggregateValue<true>;
  resources?: {
    counts: {
      commands?: number;
      skills?: number;
      resources?: number;
      toolSources?: number;
    };
    state: "observed" | "aggregate-only";
    observedAt: TimeEvidence;
  };
};

type CanonicalSessionBuildResult =
  | { state: "ready"; session: CanonicalSession }
  | {
      state: "unavailable" | "unsupported";
      health: SessionEvidenceHealth;
    };
```

A missing/invalid marker still permits L0 graph validation and health construction, but it returns `state: "unavailable"`: no `CanonicalSession` and no tracked facts. An unsupported Pi format returns `state: "unsupported"`. Therefore required `markerEntryId` exists on every ready model without weakening missing-marker semantics.

Arrays retain native append/publication order in L1. L2 sort keys are explicit and stable. Builders cannot read renderer state.

### 11.1 Build pipeline

```text
read bounded source
  -> validate source/version/header
  -> project safe L0 facts
  -> validate graph/marker
  -> reconcile exact identities
  -> reconcile retained atomic evidence against folded aggregate boundaries
  -> construct usage ledger
  -> construct health
  -> freeze canonical session
  -> project scope/range/report
```

A source adapter returns facts plus health; it never throws across the observer boundary.

---

## 12. Evidence-health JSON

Health is machine-readable, bounded, deterministic, and free of producer text.

```ts
type EvidenceHealthState =
  | "supported"
  | "partial"
  | "unavailable"
  | "unsupported"
  | "expired";

type EvidenceDiagnosticCode =
  | "source-not-found"
  | "source-format-unsupported"
  | "source-malformed"
  | "unknown-entry"
  | "duplicate-entry-id"
  | "missing-entry-parent"
  | "tracking-marker-missing"
  | "tracking-marker-duplicate"
  | "active-leaf-unavailable"
  | "tool-call-id-duplicate"
  | "tool-result-orphan"
  | "tool-result-duplicate"
  | "usage-invalid"
  | "usage-overflow"
  | "usage-reconciliation-mismatch"
  | "wal-record-legacy"
  | "wal-record-invalid"
  | "wal-sequence-gap"
  | "wal-detail-expired"
  | "live-correlation-missing"
  | "inventory-observation-time-missing"
  | "aggregate-supplement-applied"
  | "aggregate-only-fallback"
  | "checkpoint-aggregate-invalid"
  | "parent-session-unavailable"
  | "integration-contract-unsupported"
  | "cooperative-evidence-conflict"
  | "archive-unavailable"
  | "archive-invalid"
  | "clock-regression";

type SourceEvidenceHealth = {
  source: EvidenceSource;
  authority: EvidenceAuthority;
  state: EvidenceHealthState;
  schemaVersion?: number;
  recordsSeen: number;
  factsAccepted: number;
  recordsRejected: number;
  detail: "full" | "aggregate-only" | "not-observed" | "unsupported";
  observedAt?: string;
  expiredBefore?: string; // UTC instant/date policy boundary, when known
};

type SessionEvidenceHealth = {
  schemaVersion: 1;
  core: EvidenceHealthState; // Pi+marker reportability only
  sources: SourceEvidenceHealth[];
  joins: {
    toolCalls: number;
    toolResults: number;
    matchedToolResults: number;
    matchedLiveToolTimings: number;
    agentRuns: number;
    knownAgentParents: number;
  };
  usage: {
    nativeLines: number;
    childLines: number;
    compositionReconciled: boolean;
    dated: EvidenceHealthState;
  };
  aggregates: {
    detail: "full" | "aggregate-only" | "expired";
    integrationCounters: number;
    skillInvocations: {
      names: number;
      overflow: number;
      retainedInvocations: number;
    };
    permissionPresence: EvidenceHealthState;
    resources: EvidenceHealthState;
  };
  diagnostics: {
    code: EvidenceDiagnosticCode;
    severity: "info" | "warning" | "error";
    count: number;
    source: EvidenceSource;
  }[];
  truncated?: boolean;
};
```

Rules:

- No path, raw ID, error text, diagnostic message, tool input/output, model payload, or producer string appears.
- Counts saturate at the project safe-integer bound; saturation sets `truncated`.
- Sources sort by fixed enum order; diagnostics sort by source then code.
- `core` describes Pi/marker reportability only. Optional unavailable integrations do not make native session facts partial.
- A source state of `expired` means its event detail is gone; any surviving counts come from `aggregates` and are labelled `aggregate-only`.
- `unavailable`, `unsupported`, `partial`, and `expired` never serialize as zero evidence.
- `aggregates.detail` is `full` only when retained atomic telemetry covers every recorded stream end, `aggregate-only` when counters survive with an exact fold/seal boundary but their events do not, and `expired` when even the fold is incomplete or absent so no aggregate value may be published.
- `retainedInvocations` counts canonical skill invocation facts; a named skill count larger than its retained facts is aggregate-only and must be labelled so.
- L2 may down-project health to the approved bounded diagnostics, but every renderer receives the same result.

Example:

```json
{
  "schemaVersion": 1,
  "core": "supported",
  "sources": [
    {
      "source": "pi-jsonl",
      "authority": "native",
      "state": "supported",
      "schemaVersion": 3,
      "recordsSeen": 120,
      "factsAccepted": 119,
      "recordsRejected": 0,
      "detail": "full"
    },
    {
      "source": "inspector-wal",
      "authority": "live",
      "state": "expired",
      "recordsSeen": 0,
      "factsAccepted": 0,
      "recordsRejected": 0,
      "detail": "aggregate-only",
      "expiredBefore": "2026-09-01"
    }
  ],
  "joins": {
    "toolCalls": 12,
    "toolResults": 11,
    "matchedToolResults": 11,
    "matchedLiveToolTimings": 0,
    "agentRuns": 2,
    "knownAgentParents": 1
  },
  "usage": {
    "nativeLines": 15,
    "childLines": 2,
    "compositionReconciled": true,
    "dated": "supported"
  },
  "aggregates": {
    "detail": "aggregate-only",
    "integrationCounters": 1,
    "skillInvocations": { "names": 2, "overflow": 0, "retainedInvocations": 3 },
    "permissionPresence": "supported",
    "resources": "supported"
  },
  "diagnostics": [
    {
      "code": "wal-detail-expired",
      "severity": "info",
      "count": 1,
      "source": "inspector-wal"
    }
  ]
}
```

---

## 13. WAL recommendation

### 13.1 No new WAL kind

Do not add a second lifecycle record family. Extend existing `live_timing` additively:

```ts
type LiveTiming = {
  category: "agent" | "turn" | "tool" | "provider" | "model";
  status: "running" | "unknown" | "unsupported";
  confidence: "live" | "unsupported";
  subjectId?: string; // bounded ASCII token
  startedAt?: string;
  endedAt?: string;
  durationMs?: number;
};
```

- Tool `subjectId` is `live-tool-` plus `canonicalOpaqueDigest("live-tool", sessionId, toolCallId)` from §8.1.1; the hook, WAL reader, and reconciler must compute byte-identical output through that helper.
- Agent/turn `subjectId` is an Inspector-generated writer-local opaque ID created at the observed start and carried to its end.
- Tool starts are stored in a map keyed by the safe subject, not a FIFO category queue.
- Open subjects retain the existing bound of 64 per category/session. Overflow drops the new start, marks the current live source partial with a bounded count, and never evicts an older subject that may still receive an end.
- Old rows without a subject remain valid anonymous timing but cannot populate per-tool duration.
- New writers stop appending provider/model unsupported rows; the pinned lifecycle API exposes no safe provider/model boundary (§2.1), so no timing claim exists to persist.

Persisted `status: "unknown"` with a valid `endedAt` means the live boundary pair closed while execution outcome remains unknown. L0 maps that boundary state to `complete`; tool success/failure still comes only from the native Pi result.

This evidence is warranted because exact per-tool duration is not reconstructible from Pi JSONL and is required by the approved report design.

### 13.2 Safe hook extraction

`registerLiveObserver()` must pass a discriminated, privacy-safe event:

- lifecycle kind;
- `toolCallId` for tool start/end;
- `turnIndex` only if needed to manage local pairing.

It must never pass `args`, `result`, messages, provider payload, prompts, or model objects to the WAL adapter.

### 13.3 Telemetry enrichment

Keep `pi.telemetry.v1`. Add only bounded fields from pinned contracts:

- permission prompt/decision: `attribution.request` = `permission-request-` plus `canonicalOpaqueDigest("permission-request", sessionId, rawRequestId)`;
- permission surface: closed allowlist or `other`;
- existing resolution/result/prompt-source enums;
- skill invocation: existing bounded skill token, unchanged metric/dimension shape.

Skill handling is explicit:

- a validated `skill.invocation` event becomes `SkillInvocationObservation` (L0) and `CanonicalSkillInvocation` (L1) while the WAL record is retained;
- `skillInvocations`/`skillOverflowInvocations` survive as checkpoint aggregates after pruning;
- skill **inventory** (available skills) remains inventory evidence only and is never merged with invocation activity;
- an overflow invocation increments the aggregate overflow count only and creates no synthetic name or event row.

Do not persist Lens path/message payloads. Do not add a new event kind for Context, RTK, modes, agents, or Lens tool activity because Pi JSONL already persists the needed evidence.

---

## 14. Checkpoint and inventory evolution

### 14.1 Checkpoint remains schema v1, additive

A storage-directory or schema-version bump is unnecessary. Exactly one physical representation is defined: existing `aggregates.resourceCounts` is **extended in place**, and one sibling `evidence` object is added. No second resource-count location and no second metadata object may be introduced.

```ts
type Checkpoint = {
  schemaVersion: 1;
  cursors: {
    pi: PiSourceCursor;
    wal: Record<string, number>;
  };
  aggregates: {
    totalTokens: number;
    totalCost: number;
    generations: number;
    tools: number;
    compactions: number;
    integrationCounters?: Record<string, Record<string, number>>;
    skillInvocations?: Record<string, number>;
    skillOverflowInvocations?: number;
    presence?: { permission?: boolean };
    /** Extended in place; never duplicated elsewhere. */
    resourceCounts?: {
      commands: number;
      skills: number;
      resources?: number;
      toolSources?: number;
      observedAt?: string;
    };
  };
  /** Cursors whose analyzer-owned detail was safely expired after sealing. */
  sealedWal?: Record<string, number>;
  sealingVersion?: 1;
  /** Single additive metadata sibling; no other metadata object exists. */
  evidence?: {
    checkpointedAt?: string;
    detailCoverage?: {
      walDetailExpiredBefore?: string;
      inventoryDetailExpiredAt?: string;
    };
    usageCoverage?: {
      generations: "complete" | "partial" | "unavailable";
      toolResults: "complete" | "partial" | "unavailable";
      compactions: "complete" | "partial" | "unavailable";
      branchSummaries: "complete" | "partial" | "unavailable";
    };
  };
};
```

Rules:

- `resourceCounts` remains under `checkpoint.aggregates`; its existing `commands`/`skills` keys stay required when present, and `resources`, `toolSources`, `observedAt` are additive optional keys.
- `evidence` is the only new top-level object. Readers ignore unknown keys; writers never relocate or mirror `resourceCounts` into it.
- `resourceCounts.observedAt` is the observation time of the inventory snapshot that produced the counts, never the checkpoint write time. `evidence.checkpointedAt` is materialization time only.
- Checkpoint stores no atomic events, per-tool rows, agent rows, raw IDs, or paths. It cannot recreate a timeline after detail expiration.

#### 14.1.1 Normative aggregate supplementation

Checkpoint aggregates enter L1 only through `FoldedAggregateEvidence` and only under this contract:

1. Atomic detail wins while valid and retained. A retained WAL counter for a key is authoritative for the records it covers.
2. The checkpoint supplies only the disjoint portion whose contributing records are at or before `foldedThrough[writerId]` or were pruned past `sealedThrough[writerId]`.
3. Already-folded atomic records are never added again; the cursor/seal maps are the exact boundary, not an estimate.
4. Total per key = folded prefix + retained atomic suffix, unioned once. L1 must reject a snapshot whose cursors exceed observed retained sequences without a matching seal rather than guess.
5. Every aggregate-only value is labelled `aggregate-only` with its exact boundary. It never appears as an atomic row, timestamp, or `observedAt`.
6. No synthetic skill, permission, integration, or resource event is created from counts.
7. Checkpoint usage fields (`totalTokens`, `totalCost`, `generations`, `tools`, `compactions`) are **not** canonical usage input: Pi JSONL replay is authoritative and complete. They remain verification/health evidence only, so usage can never double count or survive as a stale total.
8. Invalid, contradictory, or out-of-bound aggregate values are rejected as `checkpoint-aggregate-invalid`; they are never repaired.

Per evidence class:

| Class | Retained atomic | After pruning |
| --- | --- | --- |
| integration counters | events after fold cursor | checkpoint counts, aggregate-only |
| skill invocations | `CanonicalSkillInvocation` facts | named/overflow counts, aggregate-only |
| permission presence | readiness events; durable boolean OR | checkpoint presence boolean |
| resource counts | inventory snapshot rows plus `observedAt` | checkpoint counts with last known `observedAt`, or unavailable |
| native usage | Pi JSONL replay (always authoritative) | unchanged; checkpoint totals ignored |

### 14.2 Inventory remains schema v1, additive

Add required-on-new-write `observedAt`:

```ts
type InventorySnapshotV1 = {
  schemaVersion: 1;
  observedAt?: string; // absent only on legacy snapshots
  commands: ...;
  skills: ...;
  resources: ...;
  toolSources: ...;
};
```

New capture writes the actual completion time of that observation. Legacy snapshots without it remain readable but health reports `inventory-observation-time-missing`.

#### 14.2.1 Observation freshness is normative

`observedAt` is the time of the **latest successful inventory observation**, never the time the inventory content last changed:

1. Observation at `T1` writes the inventory snapshot with `observedAt = T1`.
2. A later successful observation at `T2` with byte-equivalent inventory content **must** advance `observedAt` to `T2`.
3. Content equality may skip rebuilding or revalidating unchanged payload data; it must never preserve a stale observation timestamp.
4. If a snapshot is retained while a newer observation exists, the newer `observedAt` is authoritative for freshness and retention; the payload may still be the older reused content.
5. `mtime` is never evidence time, never a freshness input, and never a retention input once `observedAt` exists.
6. A failed observation leaves the previous `observedAt` untouched and never advances it.

Retention uses explicit observation metadata, not mtime, once available: a cutoff between `T1` and `T2` keeps the snapshot because the latest successful observation is `T2`. While the snapshot is retained it is the atomic resource observation and takes precedence; once it is gone, checkpoint `resourceCounts` may stand in only as `aggregate-only` with the last known `observedAt`.

### 14.3 Downgrade behavior

- Old WAL readers accept additive `subjectId` but ignore it; aggregate timing still works.
- Old writers continue producing anonymous rows; new readers mark correlation unavailable.
- Older WAL writers persist no skill-invocation detail; retained counts appear only after the fold boundary and health reports the aggregate-only state rather than inventing invocation rows.
- Old checkpoint writers may drop the additive `evidence` object and additive `resourceCounts` keys when rewriting. Pi facts remain recoverable; affected health becomes unavailable, never fabricated.
- Old inventory readers may ignore `observedAt`. A new writer keeps `observedAt` on the same physical snapshot, so an observation-time update also republishes the snapshot even when payload content is byte-equivalent; payload reuse is an implementation choice, timestamp reuse is not.
- If an old writer rewrites inventory content and drops `observedAt`, a new reader reports `inventory-observation-time-missing` and never fabricates freshness.
- Metadata v1 remains unavailable for source location; no guessed migration.
- The 80 observed legacy lifecycle-kind rows are counted as `wal-record-legacy` and not treated as corrupt current events.

Compatibility tests must exercise mixed old/new readers and writers before release.

---

## 15. Recovery, retention, and freshness

### 15.1 Recovery

1. Replay Pi JSONL independently of checkpoint.
2. Validate checkpoint cursor/revision before using any aggregate.
3. Replay WAL by writer sequence after each validated seal.
4. Detect gaps/duplicates/invalid/legacy rows without throwing.
5. Reconcile timing only when a subject matches exactly.
6. Treat running rows without a complete partner as incomplete live evidence.
7. Prefer canonical Pi facts over checkpoint copies when Pi detail exists.
8. Reconcile retained atomic counters against the checkpoint fold boundary: add only records strictly after each `foldedThrough` cursor, keep pruned streams as labelled aggregates, and reject boundary inconsistencies.
9. Rebuild skill invocation detail only from retained atomic records; never synthesize a row for a pruned or overflow count.
10. On any storage failure, return the strongest still-valid source subset and corresponding health.

### 15.2 Retention

Existing hot-retention policy remains:

- prune only sealed WAL segments;
- checkpoint before prune;
- hold maintenance lease;
- retain aggregate counters;
- record the UTC expiration boundary in checkpoint metadata;
- report event detail as `expired`, never empty/zero.

Pruning survives per evidence class exactly as tabulated in §14.1.1: integration counters, named/overflow skill counts, permission presence, and resource counts remain available as `aggregate-only`; skill invocation rows, per-event permission telemetry, live timing rows, and inventory rows do not. `aggregates.detail` in evidence health states which of the two the reader is holding.

Inventory detail follows its own retention policy and is measured against `observedAt` (latest successful observation, §14.2.1), never file mtime or content-change time. Preserved checkpoint counts remain aggregate-only and carry the last valid inventory observation time when known.

### 15.3 Freshness

- Pi source revision uses the existing internal line-count/SHA-256 cursor; revision hash is not exposed in report JSON.
- WAL freshness uses writer sequences and latest observer time.
- Inventory freshness uses `observedAt`, defined as the latest successful observation time; content equality never freezes it and mtime is never a substitute.
- Aggregate freshness is the fold boundary, never a derived timestamp: `checkpointedAt` describes materialization and no aggregate value may claim an event time it does not have.
- Current environment presence is stamped in memory at collection and labeled current; it is never presented as historical session state.
- Checkpoint time describes materialization only.

---

## 16. Privacy and provenance

### 16.1 Prohibited data

The following must not enter WAL, checkpoint, inventory diagnostics, L0/L1 shared DTOs, evidence-health JSON, reports, logs, fixtures, or test snapshots:

- prompt or response text;
- raw message content;
- tool arguments/results or partial results;
- child tasks/output/final output/progress text;
- provider requests/responses/headers;
- filesystem paths or URLs;
- environment values;
- credentials, secrets, or secret-like strings;
- unbounded producer strings;
- raw subagent run/request identities where the contract requires hashing;
- any raw producer identity for a canonical opaque domain (`live-tool`, `permission-request`, `subagent-run`) persisted beside its opaque form: Inspector WAL/checkpoint records carry only `canonicalOpaqueDigest` output, never the pre-image. Pi's own native tool-call ID is exempt because Pi persists it and Inspector does not own that field; it stays the approved public `tool:<id>`.

Allowed bounded producer text is limited to existing ADR-0015 command/skill descriptions and the bounded/redacted generation `errorMessage`. Both use explicit byte caps and path/URL/secret rejection; L0 may keep only those already-authorized sanitized forms. Generation `errorMessage` remains the sole bounded error-text exception.

### 16.2 Adapter rule

Raw producer objects may exist only inside the source adapter call frame. Adapters construct explicit safe fields. No object spread from raw producer data crosses the L0 boundary.

### 16.3 Provenance rule

Every canonical field is either:

- copied from one accepted fact;
- selected deterministically from repeated facts;
- computed from an explicitly listed set of fact IDs;
- unavailable.

Derived totals retain source line membership internally. Public JSON exposes bounded source class/confidence and health, not raw source locators. A field sourced from `FoldedAggregateEvidence` carries `aggregate-only` provenance plus its fold/seal boundary and never inherits an event time.

### 16.4 Diagnostic rule

Diagnostics are code + severity + count + source. They never contain exception strings, paths, record bodies, IDs, tool names, models, or producer values.

---

## 17. Validation invariants

Implementation is accepted only if all invariants hold:

1. Unknown Pi format produces no semantic facts.
2. Every native semantic fact traces to one valid Pi header/entry.
3. Every live fact traces to one validated WAL record and writer sequence.
4. Every cooperative fact traces to one persisted publishing result or validated archive.
5. Earliest valid marker is the sole tracking boundary.
6. Missing marker never means “all entries.”
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
25. TUI/HTML/JSON consume the same L2 DTO.
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

---

## 18. Test strategy

Use existing Node test infrastructure and sanitized synthetic fixtures. Add no test framework.

### 18.1 Parser and L0

- valid v3 header preserves ID/version/created time but drops `cwd` and raw `parentSession`;
- unsupported version yields `unsupported` with no facts;
- malformed/unknown lines produce partial health without raw text;
- unknown semantic entry type keeps its graph node with `semanticType.state: "unknown"` and emits no payload fact;
- invalid timestamps preserve safe identity but no date attribution;
- all known entry types, including branch summary and session info;
- bounded/redacted provider/model/error labels;
- prohibited-key adversarial payloads.

### 18.2 Marker and graph

- missing marker yields unavailable scope;
- duplicate markers use earliest and emit exact count;
- pre-marker ancestry is traversable but excluded;
- active/tree branch fixture;
- missing parent, duplicate ID, and cycle handling;
- invalid leaf never falls back to tree;
- unknown-semantic node between a known node and the known selected leaf keeps Active ancestry resolvable;
- safe parent-session dereference and outside-root rejection;
- parent resolution rejects symlinked candidate/component, non-regular file, oversized or missing header, wrong format version, and basename-derived identity; every failure is `unavailable`.

### 18.3 Tools/errors/timing

- one call/result exact join;
- orphan and duplicate call/result cases;
- first-result status and first-valid-usage rules;
- cross-midnight call/result error attribution;
- concurrent tools complete out of order and join through hashed subjects;
- old anonymous timing remains aggregate-only;
- running timing remains incomplete;
- legacy lifecycle rows become health diagnostics;
- provider/model unsupported capability produces no repeated WAL rows.

### 18.4 Usage

- all four native buckets reconcile;
- missing usage is partial, not zero;
- duplicate result usage counted once;
- child usage cannot change native totals;
- repeated child publications do not add;
- invalid numeric values are rejected;
- aggregate overflow preserves bounded lines, omits clamped totals, and emits partial/truncated health;
- dated line absent while undated known usage remains in session total;
- 366-day bounded daily projection and truncation diagnostics.

### 18.5 Agents and integrations

- model/thinking/failure/artifact projection from validated subagent rows;
- `observedAt` and `evidenceToolId` from publishing result;
- one result publishing multiple runs;
- parent resolved/outside/unavailable states;
- conflict resolution and terminal regression;
- archive paths never leave adapter;
- Context native/custom paths remain separate;
- RTK relation to publishing result;
- Ponytail/Caveman closed transitions;
- permission request hash joins prompt/decision without exposing raw ID;
- explicit skill invocation produces a bounded canonical fact with WAL writer/sequence provenance, and skill inventory never merges with it;
- overflow skill invocations increment only the aggregate counter with no synthetic name or row;
- pinned Lens tool-name census, including `module_report`, `read_symbol`, and `lens_diagnostics`;
- unknown integration version is unsupported.

### 18.6 Storage/recovery/retention

- additive `live_timing.subjectId` old/new reader compatibility;
- checkpoint additive `evidence` round-trip and old-writer downgrade of `evidence`/`resourceCounts` extension keys;
- inventory `observedAt` round-trip, legacy absence, and old-writer rewrite loss;
- observation freshness: `T1` write, byte-equivalent successful `T2` observation advances `observedAt` without payload rebuild, failed observation does not advance it, and a retention cutoff between `T1` and `T2` keeps the snapshot without consulting mtime;
- writer gap/duplicate detection;
- seal-before-prune enforcement;
- aggregate-only state after WAL/inventory expiry;
- folded aggregates reconcile with retained atomic counters exactly once across a cursor/seal boundary;
- boundary inconsistency (cursor ahead of retained sequence with no seal) is rejected as `checkpoint-aggregate-invalid`;
- pruned skill/integration/permission/resource counts survive as labelled `aggregate-only` values with no synthetic rows or timestamps;
- checkpoint usage totals are never used as canonical usage;
- official opaque-ID vectors: hook-computed, WAL-reader-validated, and reconciler-computed live-tool IDs are byte-identical; permission-request and subagent-run IDs stay collision-isolated across domains and sessions;
- checkpoint revision mismatch forces replay;
- crashes/partial final lines never escape observer boundary.

### 18.7 Projection and privacy

- current/history/global parity from one canonical fixture;
- TUI/HTML/JSON receive identical report semantics;
- evidence-health ordering and byte determinism;
- `unavailable`, `unsupported`, `partial`, and `expired` never become zero;
- JSON key/value scanner over WAL/checkpoint/inventory/health/report artifacts;
- raw producer identities for canonical opaque domains never appear beside their opaque counterpart in Inspector WAL/checkpoint artifacts;
- L2 boundary test: current/history/global loaders inject no WAL, checkpoint, inventory, or archive reader and still produce every required field from L1;
- sanitized corpus fixture reproduces observed shapes, marker multiplicity, legacy WAL rows, subagent repeated publications, and integration tool names without copying real content or IDs.

### 18.8 Required release checks

- focused tests;
- full `npm test`;
- `npm run typecheck`;
- `npm run lint`;
- LSP diagnostics on changed TypeScript paths;
- `npm pack --dry-run` for packaging-affecting implementation;
- deterministic twice-run JSON comparison;
- privacy corpus scan.

---

## 19. L2 and downstream report/navigation mapping

The approved design and its 23-task plan remain unchanged files and are not executed by this milestone. Before execution, its task dependencies must be rebased onto L1 rather than re-implementing canonical semantics inside `SessionReport`.

| Downstream task | Foundation dependency / change in responsibility |
| --- | --- |
| 1. Per-session coverage reasons | Keep workspace discovery-cap logic; consume L1 source diagnostics for session evidence reasons instead of inventing parallel reasons. |
| 2. Shared `CoverageSummary` | Assemble workspace coverage plus bounded `SessionEvidenceHealth`, including `aggregates.detail`; no raw loader exceptions. |
| 3. Coverage surfaces/copy | Presentation work remains; copy maps `partial/unavailable/unsupported/expired` and `aggregate-only` honestly. |
| 4. `AgentRun.observedAt` / cross-midnight | `observedAt`, publication provenance, and attribution are produced by L1. Task becomes L2 wiring and regression coverage. |
| 5. `usageByDate` | Build from canonical usage lines and health; truncation remains L2 bounded-history policy. |
| 6. Dated model/composition rows | Project canonical generation/state/usage facts; do not reparse entries in bundle code. |
| 7. `sameReportProjection` | Unchanged; compare L2 projections. |
| 8. Pure range module | Unchanged; range validation remains presentation-domain logic. |
| 9. Apply range everywhere | Filter L2 dated rows/events supplied by L1; never reattribute timestamps. |
| 10. Agent enrichment | Model, thinking, failure, artifacts, parent, and `evidenceToolId` are L1 responsibilities. Task becomes projection/UI tests. |
| 11. Browser projection integrity | Keep; assert no L1 field needed by approved UI is dropped. |
| 12. Agents tab semantics | Keep; consume canonical child runs and separate native subagent-tool activity. |
| 13. Tools summary/calls | Keep; duration appears only from correlated live timing. |
| 14. Errors | Keep; deterministic tool/error/agent joins come from L1. |
| 15. Environment/integrations | Keep; use canonical native/cooperative/current observations, canonical skill invocation facts, and `retainedAggregates` with `aggregate-only` labels for pruned counts. |
| 16. Route module | Unchanged. |
| 17. Client routing | Unchanged. |
| 18. Cross-navigation | Unchanged; use stable L2 IDs. |
| 19. Argument scanning/completion | Unchanged. |
| 20. Pi autocomplete boundary | Unchanged. |
| 21. Presentation polish | Unchanged. |
| 22. ADR/spec/changelog/version | Foundation implementation owns `0.8.0` and ADR 0016. Downstream milestone must become the next SemVer feature release (`0.9.0` unless intervening work changes it). Do not edit now. |
| 23. Privacy/determinism/final verification | Keep and add canonical/evidence-health fixtures; foundation tests remain prerequisites. |

### 19.1 Stable downstream semantics

This foundation explicitly preserves:

- logical-call timestamp attribution;
- `AgentRun.observedAt` as publication time only;
- one-to-many `evidenceToolId` relationships;
- resolved/outside/unavailable parent semantics;
- `unavailable != 0`;
- child usage as non-additive;
- duration only from correlated live evidence;
- one report DTO shared across renderers;
- explicit skill invocation detail while retained, with pruned counts shown as aggregate-only;
- folded aggregates reaching L2 only through L1 with their exact boundary.

---

## 20. Implementation boundaries after approval

This is a design boundary, not an execution plan.

1. **Canonical types and safe adapters:** introduce L0/L1 internal contracts and the `AtomicEvidence`/`FoldedAggregateEvidence` split without changing renderer output.
2. **Native reconciler:** move graph (including unknown-semantic nodes), tool/error, state, timestamp, skill invocation, and usage semantics into one builder.
3. **Cooperative/live reconciler:** preserve subagent publications, add exact live timing subjects, and compute opaque IDs only through the canonical helper.
4. **Storage metadata:** add checkpoint/inventory observation, expiration, and resource-count metadata additively, plus the aggregate supplementation boundary.
5. **Parent resolution hardening:** approved-root containment, symlink/regular-file checks, bounded header read, and v3 validation inside the Pi adapter only.
6. **Health projection:** expose bounded deterministic evidence-health JSON including aggregate detail state.
7. **Loader convergence:** current/history/global call the same builder and never read storage directly.
8. **Downstream rebase:** execute the approved 23-task report/navigation plan against L1, after its version/task assumptions are updated in a separate approved plan revision.

Architecture boundary changes require ADR 0016 during implementation. This design task commits only this specification, as requested.

---

## 21. Deferred decisions

Revisit only with measured need or a separate approved design:

- persistent canonical database or cross-session event index;
- Lens file-touch/diagnostics telemetry;
- provider/model latency;
- child run execution start/end/duration;
- Context custom/tool exact deduplication without a producer correlation ID;
- raw source inspection UI;
- retention longer than existing policy;
- cross-workspace parent-session traversal outside approved roots.

---

## 22. Approval gate

No production code, ADR, version, downstream spec, or implementation-plan change follows until this design is approved.

Approval authorizes a separate implementation plan for the foundation milestone. It does not authorize execution of the existing 23-task report/navigation plan.
