# ADR 0010: telemetry protocol v1

**Status:** accepted.

## Context

Extensions need optional metrics Pi cannot persist. Protocol must work with no Inspector consumer and must not create a new payload/secret channel.

## Decision

Use bounded `pi-session-inspector:telemetry:v1` process-local, best-effort bus envelopes. `value` is finite number, boolean, or bounded/redacted string state; counters require numbers, while events/gauges may represent states such as `caveman=full`. Validate and redact every accepted string before aggregation, WAL, or diagnostics. No acknowledgement, retry, cross-process, or exactly-once claim.

## Alternatives considered

- Boolean-only values: rejected; awkward/lossy mode state encoding.
- Arbitrary strings: rejected; privacy and unbounded-cardinality risk.
- Persistent RPC/daemon: rejected; operational and failure coupling.

## Consequences

Producer semantics remain independent. Invalid input is discarded with code-only diagnostics; integration adapters must use low-cardinality state values.
