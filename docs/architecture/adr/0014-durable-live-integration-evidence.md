# ADR 0014: durable live integration evidence

**Status:** accepted.

## Context

Some supported integrations expose facts only through process-local, best-effort surfaces: the Permission System publishes `permissions:ready`, `permissions:ui_prompt`, and `permissions:decision` on Pi's public event bus, and Pi emits an `input` event on every user prompt. Inspector counts explicit `/skill:<name>` invocations from that input event. Neither surface is persisted by Pi, so a session resumed in another process loses the evidence, and history/global replay cannot reconstruct it. The model also needs to distinguish "not observed" from "observed as zero": absence of a bus event must never render as `0`.

The v1 WAL already has one validated bounded telemetry record kind (`pi-session-inspector:telemetry:v1`), and checkpoints already retain aggregates after the 14-calendar-day detailed-data cutoff. Durable live evidence therefore needs no new record kind and no second store.

## Decision

Producer adapters translate the public producer events into bounded counter envelopes and append them through the session writer's existing `appendTelemetry`, which validates every envelope through `validateTelemetry` before persisting. No raw producer payload, path, or free text enters the WAL; only fixed identifiers and bounded dimension values do:

| Surface | source | metric | dimensions | fold result |
| --- | --- | --- | --- | --- |
| `permissions:decision` | `permission-system` | `permission.decision` | `result: allow\|deny`, `resolution: <closed class or "other">` | `permission.decisions`, `allowed`/`denied`, `gateErrors` (`resolution === "gate_error"`) |
| `permissions:ui_prompt` | `permission-system` | `permission.prompt` | `promptSource: tool_call\|skill_input\|skill_read` | `permission.prompts`, `promptToolCall`/`promptSkillInput`/`promptSkillRead` |
| `permissions:ready` | `permission-system` | `permission.ready` | — | durable `presence.permission = true` only, never a counter |
| `input` (`/skill:<name>`) | `pi-input` | `skill.invocation` | `skill: <validated inventory name>` | `skillInvocations[name]` |

The permission `resolution` vocabulary is a closed class set defined by the adapter; any unrecognized producer value is stored as the bounded placeholder `other`. Producer fields such as `origin`, `value`, `matchedPattern`, `agentName`, `forwarding`, and `request` are never read, persisted, or rendered. `permissions:ready` is idempotent-by-contract and repeats per process, so it is presence only.

**Fold and cursor discipline.** Recovery folds only envelopes strictly after each writer's checkpoint WAL cursor into `deltaCounters`. Checkpoint aggregates (`aggregates.integrationCounters`, `aggregates.skillInvocations`, `aggregates.skillOverflowInvocations`, `aggregates.presence`) mean "already folded". Reports read `effective = merge(checkpointAggregates, deltaCounters)`; maintenance persists that same merge exactly once per pass. Repeated folds, repeated reads, and `/resume` writer shards therefore never double-count, and a report read never writes a checkpoint. Fold sums are integer and order-independent, so JSON output stays byte-stable (PRD-01).

**Bounds.** The fold table is hard-coded; unknown metrics and dimensions are ignored, never generically keyed. Each integration keeps at most 16 counter keys, the skill map at most 64 validated names, and every count is a non-negative safe integer capped at `1_000_000_000`. Skill names are not `IntegrationKey`s, so they use a dedicated bounded name→count map instead of being forced into the integration-counter shape.

**Exact overflow.** A skill invocation whose name would exceed the 64-key cap is not tracked per name, but the invocation itself is counted exactly: the name's whole count is added to `skillOverflowInvocations` (surfaced as `skills.otherInvocations`), per invocation rather than per omitted key. Incremental folds, resume, and checkpoint merges therefore keep `invocationCount = sum(counts) + otherInvocations` exact. A counter key that would exceed 16 keys for its integration is dropped rather than truncated.

**flush-before-read.** The extension holds the current writer handle and flushes it before any report fold, so an event observed moments before the command is already in WAL and on disk. This replaces any in-memory counter shadow: WAL + checkpoint is the single source of truth and cannot be double-counted.

**Durable presence.** `permission.ready` folds to the boolean `presence.permission` and never into a counter key, so a session whose permission bus was observed in an earlier process still reports the `permission` row as `present` after `/resume` and in history. The row is `present` when the live bus signal or the persisted aggregate is set, and never inferred as `absent` from silence.

**Why `event` and `gauge` are not folded.** Only `kind: "counter"` with numeric `value: 1` participates. `event`/`gauge` remain write-only: folding them would require ordering and de-duplication semantics that the best-effort, at-most-once bus does not provide, so Inspector would risk inventing transitions rather than counting observations.

**Limits, stated rather than hidden.** The bus is process-local; there is no cross-process delivery, acknowledgement, retry, or exactly-once claim. Detailed WAL is retained at most 14 calendar days; folded counters survive the cutoff as checkpoint aggregates, but no backfill exists. A session with sealed detail and no folded counters reports `unavailable`, never `0`. If a 0.6.x process later rewrites the checkpoint, the additive aggregate fields are dropped (see the v1 spec downgrade-write notes): counters degrade to `unavailable` rather than to a wrong number, and Pi data is untouched.

## Alternatives considered

- In-memory counters only: rejected; lost on `/resume`, invisible to history/global.
- New WAL record kind or a second counter store: rejected; duplicates the validated telemetry path and the retention model.
- Generic `metric`/`dimension` keyed fold: rejected; unbounded cardinality and a new persistence surface for producer text.
- Fold `event`/`gauge` too: rejected; ordering ambiguity would fabricate state transitions.
- Counter key following the skill name: rejected; skill names are not integrations and mixing them into `integrationCounters` breaks the allowlist contract.
- Persisting presence as a counter: rejected; repeated `ready` events would inflate a count that does not exist.

## Consequences

Live-only integration facts become durable and replay-visible while Pi remains the sole billing/source authority. The checkpoint gains strictly validated additive fields that older readers ignore. The overflow rule keeps per-skill totals exact without an unbounded map, and skill counts survive inventory expiry. The cost is explicit: process-local observation, a 14-day detail window, no backfill, and cooperative producer contracts that can drift. See ADR 0010 for the telemetry envelope contract and ADR 0012 for retention.
