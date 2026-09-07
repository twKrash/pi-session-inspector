# ADR 0004: per-writer WAL

**Status:** accepted.

## Context

Pi session persistence has no Inspector-owned cross-process lock. Live timing, permission, and cooperative facts cannot always be replayed from Pi JSONL; synchronous shared writes would risk affecting agent execution.

## Decision

Each Inspector process creates one immutable random writer ID, exclusively claims one logical WAL shard, and appends only its own dated segments. Flushes are bounded and failure disables that writer rather than blocking Pi. A maintenance lease is not required for append.

## Alternatives considered

- One shared WAL with a global lock: rejected; hot-path contention/failure couples telemetry to agent work.
- Append Inspector data to Pi JSONL: rejected; Pi is source authority and must remain observer-owned.
- SQLite/daemon: rejected for v1; unnecessary operational surface.

## Consequences

Cross-writer ordering is approximate outside each writer sequence. Recovery merges shards deterministically. Dated segments enable strict 14-calendar-day detail retention without rewriting an active append file.
