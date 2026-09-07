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

```text
/session-inspector [current|history|global|ledger] [--scope active|tree] [--format tui|html|json] [--output PATH] [--no-open]
/session-ins ...
```

| Invocation | Default |
| --- | --- |
| `current` | `active`, TUI |
| `history` | `tree`, TUI picker |
| `global` | `tree`, HTML |
| `ledger` | `active`, TUI ledger |

`--format` controls rendering only. `--scope` controls selected Pi entry set. Ephemeral (`--no-session`) runs may show current in-memory state but are explicitly non-durable and unavailable to history/global.

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

## 5. Source precedence and reducer

1. Persisted Pi assistant, tool-result, compaction and branch-summary usage/cost is billing authority and counted once.
2. WAL augments duration/state only; it cannot replace Pi usage/cost.
3. Integrations enrich attribution/metrics. Child usage is a breakdown, never added to parent total.
4. Checkpoints cache reducer state; source mismatch invalidates/replays them.
5. Sealed checkpoints are authority only for safely expired analyzer-owned WAL facts. Pi remains replayable authority.

One deterministic reducer produces immutable `SessionReport` and `GlobalReport`; ledger is a lazy projection from the same normalized records.

## 6. Live observer and telemetry protocol

Subscribe only to observer lifecycle surfaces: session, agent, turn, message, tool, compaction/tree, model/thinking, shutdown. Never inspect/provider-copy bodies, mutate payloads, return hook results, or subscribe to control hooks for observation.

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

## 7. Storage, recovery, and retention

Root uses Pi agent-dir API when available:

```text
~/.pi/agent/session-inspector/v1/
  sessions/<full-session-id>/{meta.json,checkpoint.json,maintenance.lease,writers/,wal/}
  reports/{<session-id>.html,global.html}
```

Tracking: create pending session metadata; append native `session-inspector:tracking-start`; atomically promote metadata. Earliest valid marker establishes boundary. Pending state recovers marker/manifest crash. Missing entire analyzer root needs explicit repair scan—not normal discovery.

Each process creates an immutable random writer ID, exclusively claims its active marker, then owns only matching WAL shard. Flush at 200 ms, 64 events, or 256 KiB; immediate on lifecycle boundary. Do not `fsync` each event. Queue cap is 1 MiB: shed coalescible data, record drop when possible, then disable writer. Process-crash durability is target; power-loss durability is not.

Checkpoint/reconcile/retention acquire one short per-session maintenance lease via atomic create/mkdir with PID/writer/timestamp. Stale recovery requires dead PID and age threshold. Holder rereads cursors, writes/validates temp in same directory, atomically renames, releases in `finally`. Contenders skip maintenance and replay. Bad/partial checkpoint replays valid durable input. Partial final WAL line is ignored and diagnosed. Unmatched starts stay `running` while active, become `interrupted` only at terminal reconciliation.

Detailed Inspector data has a **maximum 14-calendar-day window from record creation**, not 14 days after a session becomes inactive. Each writer owns a logical WAL shard and rotates immutable dated segments at least daily; an active writer rotates before its current segment can cross the cutoff. Under maintenance lease, a segment is deleted only after a validated checkpoint includes it and its newest record is older than the cutoff. Checkpoints retain aggregates and cursors, not detailed telemetry. Regenerable report cache expires 14 days after generation (access does not extend it) and is capped at 100 MiB oldest-first. Explicit `--output` files are user-owned and never pruned. This bounds Inspector-held detailed metadata even for long-running sessions, at cost of cold reports showing aggregate/native data only.

## 8. Privacy and security

Default local-only means no network calls, analytics, external assets, or native-content duplication. WAL permits IDs, times, statuses, bounded numeric/boolean metrics, bounded redacted string state, and redacted bounded metadata only. UI reads local source detail only on demand; exports omit bodies and redact commands/paths.

Redact secret-like keys, bearer/authorization values, JWT/token/private-key shapes, credential URLs, environment assignments, and `.env`/credential paths. Redaction is defense-in-depth, not a safe-sharing guarantee. Reports show warning. Create Inspector directories/files user-only when supported.

Threat boundary: Inspector cannot protect against same-user processes reading source sessions or user-selected exports. It must not create a broader sensitive-data copy.

## 9. UX and performance

Tabs: Overview, Models, Tools, Commands, Agents, Skills, Integrations, Errors, Ledger. Narrow terminals use selector. Ledger materializes on opening. English catalog ships; all labels are translation keys.

HTML inlines escaped report JSON, CSS and vanilla JS. v1 charts: daily sessions/cost/tokens and model/tool bars. Browser opening failure returns path, not command failure.

Initial target SLOs (not v1 release blockers until measured): observer scheduling p95 <1 ms/p99 <5 ms; no high-frequency synchronous disk; <=10 MiB incremental memory for 10k records; current TUI warm paint <150 ms; 10k delta reconcile <250 ms; cold 100-MiB replay <2 s; global fold 1,000 checkpoints <2 s; HTML <3 s/<5 MiB; startup p95 <25 ms warm/<75 ms cold.

Benchmark corpus is fixed seed/versioned. Early CI smoke fails only timeout, correctness failure, or gross 5x regression. Release jobs run 10 warm/3 cold samples on pinned Node/image and publish machine/image/variance artifacts. After two accepted release artifacts establish variance, maintainers may promote stable targets to hard SLOs; then an absolute-SLO breach or >20% median/p95 regression blocks release unless a reviewed baseline exception and changelog note exist. Safety, privacy, source-precedence, and recovery tests remain hard blockers from the first release.

## 10. Integration policy

| Integration | v1 handling | Non-claim |
| --- | --- | --- |
| Pi core | mandatory replay + live observer | exact provider retry spans |
| pi-subagents | public artifacts/status/results; nested agent runs | timestamp-guessed parentage |
| Permission System | public permission events | internal parser import |
| RTK | persisted `rtkCompaction` details | rewrite decision/savings not persisted |
| Context Mode | `ctx_*` use | exact Context Mode savings |
| Caveman/Ponytail | mode custom entries | exact duration after crash |
| Lens | generic native tool use | rich Lens dashboard in v1 |
| Hermes | unsupported | adapter implementation |

## 11. Failure behavior, migrations, and risks

Unknown Pi entries/fields, telemetry schema, integration version, artifact absence, corrupted WAL tail, stale checkpoint, source rewrite, missing browser, and storage errors must degrade to diagnostics/confidence—not crashes or Pi behavior changes.

Persisted schema starts at v1. Additive reads ignore unknown fields. Breaking schema changes require explicit migration/reader, fixture proof, and ADR. Pre-1.0 minor may change persisted/public formats only with migration note.

Release blockers: empirical validation of provider timing confidence, maintenance/retention crash races, and usage non-double-counting. Other risks: Pi API drift, subagent artifact drift, writer clock skew, metadata privacy leakage, scale beyond corpus, and npm/release ownership. See [research](../research/pi-ecosystem.md) and [implementation plan](../plans/pi-session-inspector-v1-implementation.md).
