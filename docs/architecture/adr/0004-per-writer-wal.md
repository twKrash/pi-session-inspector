# ADR 0004: per-writer WAL

**Status:** accepted.

Each Inspector process owns a random, exclusively claimed append-only WAL shard. This avoids cross-process lock contention on agent paths and preserves best-effort telemetry without blocking Pi.
